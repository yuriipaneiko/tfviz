// Package runner executes long-running CLI commands (terraform, checkov,
// c3x) as jobs whose output is streamed to subscribers.
package runner

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type Status string

const (
	Running   Status = "running"
	Succeeded Status = "succeeded"
	Failed    Status = "failed"
	Cancelled Status = "cancelled"
)

const maxLogLines = 20000

type LogLine struct {
	Seq    int    `json:"seq"`
	Stream string `json:"stream"` // stdout | stderr | info
	Text   string `json:"text"`
}

type Job struct {
	ID         string     `json:"id"`
	Kind       string     `json:"kind"` // plan | init | security | cost
	Stack      string     `json:"stack"`
	Title      string     `json:"title"`
	Status     Status     `json:"status"`
	Error      string     `json:"error,omitempty"`
	StartedAt  time.Time  `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`

	mu     sync.Mutex
	logs   []LogLine
	seq    int
	cancel context.CancelFunc
	ctx    context.Context
	m      *Manager
}

type Event struct {
	Type string `json:"type"` // job | log
	Job  *Job   `json:"job,omitempty"`
	Log  *struct {
		JobID string  `json:"jobId"`
		Line  LogLine `json:"line"`
	} `json:"log,omitempty"`
}

type Manager struct {
	mu      sync.Mutex
	jobs    map[string]*Job
	order   []string
	nextID  int
	publish func(Event)
}

func NewManager(publish func(Event)) *Manager {
	return &Manager{jobs: map[string]*Job{}, publish: publish}
}

// ErrBusy is returned when a job of the same kind is already running for the stack.
var ErrBusy = errors.New("a job is already running for this stack")

// Start runs fn in the background. Only one job per stack runs at a time,
// because terraform commands on the same directory conflict.
func (m *Manager) Start(kind, stack, title string, fn func(j *Job) error) (*Job, error) {
	m.mu.Lock()
	for _, id := range m.order {
		if j := m.jobs[id]; j.Stack == stack && j.Status == Running {
			m.mu.Unlock()
			return nil, ErrBusy
		}
	}
	m.nextID++
	ctx, cancel := context.WithCancel(context.Background())
	j := &Job{
		ID: fmt.Sprintf("job-%d", m.nextID), Kind: kind, Stack: stack, Title: title,
		Status: Running, StartedAt: time.Now(), ctx: ctx, cancel: cancel, m: m,
	}
	m.jobs[j.ID] = j
	m.order = append(m.order, j.ID)
	if len(m.order) > 50 {
		old := m.order[0]
		if m.jobs[old].Status != Running {
			delete(m.jobs, old)
			m.order = m.order[1:]
		}
	}
	m.mu.Unlock()
	m.emitJob(j)

	go func() {
		err := fn(j)
		j.mu.Lock()
		now := time.Now()
		j.FinishedAt = &now
		switch {
		case ctx.Err() != nil:
			j.Status = Cancelled
		case err != nil:
			j.Status = Failed
			j.Error = err.Error()
		default:
			j.Status = Succeeded
		}
		j.mu.Unlock()
		if err != nil && ctx.Err() == nil {
			j.Info("✗ " + err.Error())
		}
		m.emitJob(j)
		cancel()
	}()
	return j, nil
}

func (m *Manager) emitJob(j *Job) {
	if m.publish != nil {
		m.publish(Event{Type: "job", Job: j.Snapshot()})
	}
}

func (m *Manager) Get(id string) *Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.jobs[id]
}

func (m *Manager) List() []*Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*Job, 0, len(m.order))
	for i := len(m.order) - 1; i >= 0; i-- {
		out = append(out, m.jobs[m.order[i]].Snapshot())
	}
	return out
}

func (j *Job) Snapshot() *Job {
	j.mu.Lock()
	defer j.mu.Unlock()
	return &Job{
		ID: j.ID, Kind: j.Kind, Stack: j.Stack, Title: j.Title, Status: j.Status,
		Error: j.Error, StartedAt: j.StartedAt, FinishedAt: j.FinishedAt,
	}
}

func (j *Job) Logs() []LogLine {
	j.mu.Lock()
	defer j.mu.Unlock()
	return append([]LogLine(nil), j.logs...)
}

func (j *Job) Cancel() { j.cancel() }

func (j *Job) Context() context.Context { return j.ctx }

func (j *Job) log(stream, text string) {
	j.mu.Lock()
	j.seq++
	line := LogLine{Seq: j.seq, Stream: stream, Text: text}
	j.logs = append(j.logs, line)
	if len(j.logs) > maxLogLines {
		j.logs = j.logs[len(j.logs)-maxLogLines:]
	}
	j.mu.Unlock()
	if j.m.publish != nil {
		ev := Event{Type: "log"}
		ev.Log = &struct {
			JobID string  `json:"jobId"`
			Line  LogLine `json:"line"`
		}{JobID: j.ID, Line: line}
		j.m.publish(ev)
	}
}

// Info writes a status line to the job log.
func (j *Job) Info(text string) { j.log("info", text) }

type CmdOpts struct {
	Dir     string
	Env     []string
	Capture bool // collect stdout and return it instead of streaming it
	Quiet   bool // don't stream stderr either
}

// Run executes a command, streaming its output into the job log. Cancelling
// the job sends SIGINT first so terraform can release state locks.
func (j *Job) Run(opts CmdOpts, name string, args ...string) ([]byte, error) {
	if !opts.Capture {
		j.Info("$ " + name + " " + strings.Join(args, " "))
	}
	cmd := exec.CommandContext(j.ctx, name, args...)
	cmd.Dir = opts.Dir
	cmd.Env = append(os.Environ(), opts.Env...)
	cmd.Cancel = func() error { return cmd.Process.Signal(os.Interrupt) }
	cmd.WaitDelay = 20 * time.Second

	var stdout bytes.Buffer
	var wg sync.WaitGroup
	stream := func(r io.Reader, name string) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
		for sc.Scan() {
			j.log(name, sc.Text())
		}
	}
	errPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	var outPipe io.ReadCloser
	if opts.Capture {
		cmd.Stdout = &stdout
	} else if outPipe, err = cmd.StdoutPipe(); err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	wg.Add(1)
	if opts.Quiet {
		go func() { defer wg.Done(); _, _ = io.Copy(io.Discard, errPipe) }()
	} else {
		go stream(errPipe, "stderr")
	}
	if outPipe != nil {
		wg.Add(1)
		go stream(outPipe, "stdout")
	}
	wg.Wait()
	err = cmd.Wait()
	if j.ctx.Err() != nil {
		return stdout.Bytes(), j.ctx.Err()
	}
	if err != nil {
		return stdout.Bytes(), fmt.Errorf("%s exited: %w", name, err)
	}
	return stdout.Bytes(), nil
}
