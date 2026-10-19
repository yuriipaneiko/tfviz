// Package server exposes the project model, terraform plans and scanner
// results over a local HTTP API and serves the web UI.
package server

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/yuriipaneiko/tf-visualise/internal/config"
	"github.com/yuriipaneiko/tf-visualise/internal/graph"
	"github.com/yuriipaneiko/tf-visualise/internal/plan"
	"github.com/yuriipaneiko/tf-visualise/internal/runner"
	"github.com/yuriipaneiko/tf-visualise/internal/scan"
)

type Options struct {
	ProjectDir   string
	TerraformBin string
	UI           fs.FS // nil in dev mode (Vite serves the UI)
	Watch        bool
}

type Server struct {
	opts   Options
	hub    *Hub
	jobs   *runner.Manager
	tmpDir string

	mu          sync.Mutex
	stacks      []config.Stack
	graphs      map[string]*graph.Graph
	plans       map[string]*plan.Result
	planJSON    map[string]string // overlay key -> plan json file on disk (for c3x)
	planStale   map[string]bool
	security    map[string]*scan.SecurityReport
	costs       map[string]*scan.CostReport
	lastBackend map[string]string // stack ID -> last -backend-config used for init

	toolsMu sync.Mutex
	tools   *Tools
}

func New(opts Options) (*Server, error) {
	abs, err := filepath.Abs(opts.ProjectDir)
	if err != nil {
		return nil, err
	}
	opts.ProjectDir = abs
	tmp, err := os.MkdirTemp("", "tfviz-")
	if err != nil {
		return nil, err
	}
	s := &Server{
		opts: opts, hub: NewHub(), tmpDir: tmp,
		graphs: map[string]*graph.Graph{}, plans: map[string]*plan.Result{},
		planJSON: map[string]string{}, planStale: map[string]bool{},
		security: map[string]*scan.SecurityReport{}, costs: map[string]*scan.CostReport{},
		lastBackend: map[string]string{},
	}
	s.jobs = runner.NewManager(func(ev runner.Event) { s.hub.Publish(ev) })
	if err := s.rediscover(); err != nil {
		return nil, err
	}
	go s.getTools(false)
	return s, nil
}

func (s *Server) Close() { os.RemoveAll(s.tmpDir) }

func (s *Server) Stacks() []config.Stack {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]config.Stack(nil), s.stacks...)
}

func (s *Server) rediscover() error {
	stacks, err := config.Discover(s.opts.ProjectDir)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.stacks = stacks
	s.graphs = map[string]*graph.Graph{}
	s.mu.Unlock()
	return nil
}

func (s *Server) stack(id string) (config.Stack, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, st := range s.stacks {
		if st.ID == id {
			return st, true
		}
	}
	return config.Stack{}, false
}

func (s *Server) graph(st config.Stack) (*graph.Graph, error) {
	s.mu.Lock()
	g := s.graphs[st.ID]
	s.mu.Unlock()
	if g != nil {
		return g, nil
	}
	root, err := config.LoadRoot(st.Dir)
	if err != nil {
		return nil, err
	}
	g = graph.Build(root, st.ID, s.opts.ProjectDir)
	s.mu.Lock()
	s.graphs[st.ID] = g
	s.mu.Unlock()
	return g, nil
}

func (s *Server) getTools(refresh bool) Tools {
	s.toolsMu.Lock()
	defer s.toolsMu.Unlock()
	if s.tools == nil || refresh {
		t := detectTools(s.opts.ProjectDir, s.opts.TerraformBin)
		s.tools = &t
	}
	return *s.tools
}

func (s *Server) onFilesChanged(files []string) {
	s.mu.Lock()
	oldGraphs := s.graphs
	s.mu.Unlock()
	affected := map[string]bool{}
	for id, g := range oldGraphs {
		for _, m := range g.Modules {
			dir := filepath.Join(s.opts.ProjectDir, m.Dir)
			for _, f := range files {
				if strings.HasPrefix(f, dir+string(filepath.Separator)) || f == dir {
					affected[id] = true
				}
			}
		}
	}
	if err := s.rediscover(); err != nil {
		log.Printf("rediscover: %v", err)
	}
	s.mu.Lock()
	for key := range s.plans {
		if affected[overlayStack(key)] {
			s.planStale[key] = true
		}
	}
	s.mu.Unlock()
	rel := make([]string, 0, len(files))
	for _, f := range files {
		if r, err := filepath.Rel(s.opts.ProjectDir, f); err == nil {
			rel = append(rel, filepath.ToSlash(r))
		}
	}
	stacks := make([]string, 0, len(affected))
	for id := range affected {
		stacks = append(stacks, id)
	}
	s.hub.Publish(map[string]any{"type": "files-changed", "files": rel, "stacks": stacks})
}

// ---------------------------------------------------------------- HTTP

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/project", s.handleProject)
	mux.HandleFunc("GET /api/tools", s.handleTools)
	mux.HandleFunc("GET /api/graph", s.handleGraph)
	mux.HandleFunc("GET /api/workspaces", s.handleWorkspaces)
	mux.HandleFunc("GET /api/plan", s.handleGetPlan)
	mux.HandleFunc("DELETE /api/plan", s.handleClearPlan)
	mux.HandleFunc("POST /api/plan", s.handleRunPlan)
	mux.HandleFunc("POST /api/init", s.handleInit)
	mux.HandleFunc("GET /api/security", s.handleGetSecurity)
	mux.HandleFunc("POST /api/security", s.handleRunSecurity)
	mux.HandleFunc("GET /api/cost", s.handleGetCost)
	mux.HandleFunc("POST /api/cost", s.handleRunCost)
	mux.HandleFunc("GET /api/jobs", s.handleJobs)
	mux.HandleFunc("GET /api/jobs/{id}", s.handleJob)
	mux.HandleFunc("POST /api/jobs/{id}/cancel", s.handleCancelJob)
	mux.Handle("GET /api/events", s.hub)
	if s.opts.UI != nil {
		mux.Handle("/", spaHandler(s.opts.UI))
	}
	return guard(mux)
}

// guard only allows requests addressed to localhost (blocks DNS rebinding), and
// requires a custom header on mutating requests (blocks cross-site form posts,
// since custom headers force a CORS preflight that we never approve).
func guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		if host != "localhost" && host != "127.0.0.1" && host != "::1" && host != "[::1]" {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("X-TFViz") != "1" {
			http.Error(w, "missing X-TFViz header", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func spaHandler(ui fs.FS) http.Handler {
	files := http.FileServer(http.FS(ui))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(ui, p); err != nil {
			if _, err := fs.Stat(ui, "index.html"); err != nil {
				http.Error(w, "UI is not built. Run `make build` (or use `make dev`).", http.StatusNotFound)
				return
			}
			r = r.Clone(r.Context())
			r.URL.Path = "/"
		}
		if strings.HasPrefix(p, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
}

func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = writeJSON(w, v)
}

func fail(w http.ResponseWriter, status int, err error) {
	respond(w, status, map[string]string{"error": err.Error()})
}

func overlayKey(stack, env string) string {
	env = strings.TrimSpace(env)
	if env == "" {
		return stack
	}
	return stack + "\x1f" + env
}

func overlayStack(key string) string {
	if i := strings.IndexByte(key, '\x1f'); i >= 0 {
		return key[:i]
	}
	return key
}

func (s *Server) stackParam(w http.ResponseWriter, r *http.Request) (config.Stack, bool) {
	id := r.URL.Query().Get("stack")
	st, ok := s.stack(id)
	if !ok {
		fail(w, http.StatusNotFound, fmt.Errorf("unknown stack %q", id))
	}
	return st, ok
}

func (s *Server) overlayParam(w http.ResponseWriter, r *http.Request) (config.Stack, string, bool) {
	st, ok := s.stackParam(w, r)
	return st, r.URL.Query().Get("env"), ok
}

// safeRel rejects paths that would escape the stack directory.
func safeRel(rel string) error {
	if rel == "" {
		return nil
	}
	if filepath.IsAbs(rel) || strings.Contains(rel, "..") {
		return fmt.Errorf("invalid path %q", rel)
	}
	return nil
}

func (s *Server) handleProject(w http.ResponseWriter, r *http.Request) {
	respond(w, 200, map[string]any{
		"dir":    s.opts.ProjectDir,
		"name":   filepath.Base(s.opts.ProjectDir),
		"stacks": s.Stacks(),
		"watch":  s.opts.Watch,
	})
}

func (s *Server) handleTools(w http.ResponseWriter, r *http.Request) {
	respond(w, 200, s.getTools(r.URL.Query().Get("refresh") == "1"))
}

func (s *Server) handleGraph(w http.ResponseWriter, r *http.Request) {
	st, ok := s.stackParam(w, r)
	if !ok {
		return
	}
	g, err := s.graph(st)
	if err != nil {
		fail(w, 500, err)
		return
	}
	respond(w, 200, g)
}

func (s *Server) handleWorkspaces(w http.ResponseWriter, r *http.Request) {
	st, ok := s.stackParam(w, r)
	if !ok {
		return
	}
	if !st.Initialized {
		respond(w, 200, map[string]any{"workspaces": []string{}, "current": ""})
		return
	}
	list, cur, err := listWorkspaces(s.getTools(false).Terraform.Path, st.Dir)
	if err != nil {
		respond(w, 200, map[string]any{"workspaces": []string{}, "current": "", "error": err.Error()})
		return
	}
	respond(w, 200, map[string]any{"workspaces": list, "current": cur})
}

type planState struct {
	Plan  *plan.Result `json:"plan"`
	Stale bool         `json:"stale"`
}

func (s *Server) handleGetPlan(w http.ResponseWriter, r *http.Request) {
	st, env, ok := s.overlayParam(w, r)
	if !ok {
		return
	}
	key := overlayKey(st.ID, env)
	s.mu.Lock()
	defer s.mu.Unlock()
	respond(w, 200, planState{Plan: s.plans[key], Stale: s.planStale[key]})
}

func (s *Server) handleClearPlan(w http.ResponseWriter, r *http.Request) {
	st, env, ok := s.overlayParam(w, r)
	if !ok {
		return
	}
	key := overlayKey(st.ID, env)
	s.mu.Lock()
	delete(s.plans, key)
	delete(s.planStale, key)
	s.mu.Unlock()
	s.hub.Publish(map[string]any{"type": "plan", "stack": st.ID, "env": env})
	respond(w, 200, map[string]bool{"ok": true})
}

type PlanRequest struct {
	Stack         string   `json:"stack"`
	Env           string   `json:"env,omitempty"`
	VarFiles      []string `json:"varFiles"`
	BackendConfig string   `json:"backendConfig,omitempty"`
	Workspace     string   `json:"workspace"`
	AWSProfile    string   `json:"awsProfile"`
	Refresh       bool     `json:"refresh"`
	Destroy       bool     `json:"destroy"`
	Init          bool     `json:"init"`
	Upgrade       bool     `json:"upgrade"`
}

func decodeBody(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20)).Decode(v)
}

func (s *Server) startJob(w http.ResponseWriter, kind string, st config.Stack, title string, fn func(*runner.Job) error) {
	j, err := s.jobs.Start(kind, st.ID, title, fn)
	if err != nil {
		status := 500
		if errors.Is(err, runner.ErrBusy) {
			status = http.StatusConflict
		}
		fail(w, status, err)
		return
	}
	respond(w, 202, j.Snapshot())
}

func (s *Server) tfEnv(profile string) []string {
	env := []string{"TF_IN_AUTOMATION=1", "TF_INPUT=0"}
	if profile != "" {
		env = append(env, "AWS_PROFILE="+profile)
	}
	return env
}

func (s *Server) stackTmp(id, env string) (string, error) {
	sum := sha1.Sum([]byte(overlayKey(id, env)))
	dir := filepath.Join(s.tmpDir, hex.EncodeToString(sum[:6]))
	return dir, os.MkdirAll(dir, 0o700)
}

func (s *Server) terraformInit(j *runner.Job, st config.Stack, env []string, upgrade bool, backendConfig string) error {
	tf := s.getTools(false).Terraform
	if !tf.Available {
		return fmt.Errorf("terraform not found; install it with: %s", tf.Install)
	}
	args := []string{"init", "-input=false"}
	if upgrade {
		args = append(args, "-upgrade")
	}
	if backendConfig != "" {
		args = append(args, "-backend-config="+backendConfig)
		if st.Initialized {
			args = append(args, "-reconfigure")
		}
	}
	if _, err := j.Run(runner.CmdOpts{Dir: st.Dir, Env: env}, tf.Path, args...); err != nil {
		return err
	}
	if backendConfig != "" {
		s.mu.Lock()
		s.lastBackend[st.ID] = backendConfig
		s.mu.Unlock()
	}
	// Modules may now resolve to downloaded sources.
	_ = s.rediscover()
	s.hub.Publish(map[string]any{"type": "files-changed", "files": []string{}, "stacks": []string{st.ID}})
	return nil
}

func (s *Server) handleInit(w http.ResponseWriter, r *http.Request) {
	var req PlanRequest
	if err := decodeBody(r, &req); err != nil {
		fail(w, 400, err)
		return
	}
	st, ok := s.stack(req.Stack)
	if !ok {
		fail(w, 404, fmt.Errorf("unknown stack %q", req.Stack))
		return
	}
	if err := safeRel(req.BackendConfig); err != nil {
		fail(w, 400, err)
		return
	}
	title := "terraform init · " + st.Name
	if req.Env != "" {
		title += " · " + req.Env
	}
	s.startJob(w, "init", st, title, func(j *runner.Job) error {
		if err := s.terraformInit(j, st, s.tfEnv(req.AWSProfile), req.Upgrade, req.BackendConfig); err != nil {
			return err
		}
		j.Info("✓ Initialised")
		return nil
	})
}

func (s *Server) handleRunPlan(w http.ResponseWriter, r *http.Request) {
	var req PlanRequest
	if err := decodeBody(r, &req); err != nil {
		fail(w, 400, err)
		return
	}
	st, ok := s.stack(req.Stack)
	if !ok {
		fail(w, 404, fmt.Errorf("unknown stack %q", req.Stack))
		return
	}
	for _, vf := range req.VarFiles {
		if err := safeRel(vf); err != nil {
			fail(w, 400, err)
			return
		}
	}
	if err := safeRel(req.BackendConfig); err != nil {
		fail(w, 400, err)
		return
	}
	title := "terraform plan · " + st.Name
	if req.Destroy {
		title = "terraform plan -destroy · " + st.Name
	}
	if req.Env != "" {
		title += " · " + req.Env
	}
	s.startJob(w, "plan", st, title, func(j *runner.Job) error { return s.runPlan(j, st, req) })
}

func (s *Server) runPlan(j *runner.Job, st config.Stack, req PlanRequest) error {
	tf := s.getTools(false).Terraform
	if !tf.Available {
		return fmt.Errorf("terraform not found; install it with: %s", tf.Install)
	}
	env := s.tfEnv(req.AWSProfile)
	opts := runner.CmdOpts{Dir: st.Dir, Env: env}
	s.mu.Lock()
	prevBackend := s.lastBackend[st.ID]
	s.mu.Unlock()
	needInit := req.Init || !st.Initialized
	if req.BackendConfig != "" && req.BackendConfig != prevBackend {
		needInit = true
		if st.Initialized {
			j.Info("Backend config changed; running terraform init -reconfigure")
		}
	}
	if needInit {
		if err := s.terraformInit(j, st, env, req.Upgrade, req.BackendConfig); err != nil {
			return err
		}
	}
	if req.Workspace != "" {
		if _, err := j.Run(opts, tf.Path, "workspace", "select", req.Workspace); err != nil {
			return err
		}
	}
	tmp, err := s.stackTmp(st.ID, req.Env)
	if err != nil {
		return err
	}
	planFile := filepath.Join(tmp, "tfplan")
	args := []string{"plan", "-input=false", "-out=" + planFile}
	for _, vf := range req.VarFiles {
		args = append(args, "-var-file="+vf)
	}
	if !req.Refresh {
		args = append(args, "-refresh=false")
	}
	if req.Destroy {
		args = append(args, "-destroy")
	}
	if _, err := j.Run(opts, tf.Path, args...); err != nil {
		return err
	}
	j.Info("Reading plan…")
	out, err := j.Run(runner.CmdOpts{Dir: st.Dir, Env: env, Capture: true}, tf.Path, "show", "-json", planFile)
	if err != nil {
		return err
	}
	jsonFile := filepath.Join(tmp, "plan.json")
	if err := os.WriteFile(jsonFile, out, 0o600); err != nil {
		return err
	}
	res, err := plan.Parse(out, st.ID)
	if err != nil {
		return err
	}
	res.Options = map[string]any{
		"varFiles": req.VarFiles, "backendConfig": req.BackendConfig, "env": req.Env,
		"workspace": req.Workspace, "awsProfile": req.AWSProfile,
		"refresh": req.Refresh, "destroy": req.Destroy,
	}
	key := overlayKey(st.ID, req.Env)
	s.mu.Lock()
	s.plans[key] = res
	s.planJSON[key] = jsonFile
	delete(s.planStale, key)
	s.mu.Unlock()
	sm := res.Summary
	j.Info(fmt.Sprintf("✓ Plan: %d to add, %d to change, %d to replace, %d to destroy", sm.Create, sm.Update, sm.Replace, sm.Delete))
	s.hub.Publish(map[string]any{"type": "plan", "stack": st.ID, "env": req.Env})
	return nil
}

func (s *Server) handleGetSecurity(w http.ResponseWriter, r *http.Request) {
	st, ok := s.stackParam(w, r)
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	respond(w, 200, map[string]any{"report": s.security[st.ID]})
}

func nodeRefs(g *graph.Graph) []scan.NodeRef {
	refs := make([]scan.NodeRef, 0, len(g.Nodes))
	for _, n := range g.Nodes {
		local := n.Type + "." + n.Name
		if n.Kind == "data" {
			local = "data." + local
		}
		refs = append(refs, scan.NodeRef{ID: n.ID, Local: local, AbsFile: n.AbsFile, Line: n.Line, EndLine: n.EndLine})
	}
	return refs
}

func (s *Server) handleRunSecurity(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Stack string `json:"stack"`
	}
	if err := decodeBody(r, &req); err != nil {
		fail(w, 400, err)
		return
	}
	st, ok := s.stack(req.Stack)
	if !ok {
		fail(w, 404, fmt.Errorf("unknown stack %q", req.Stack))
		return
	}
	s.startJob(w, "security", st, "checkov · "+st.Name, func(j *runner.Job) error {
		tool := s.getTools(false).Checkov
		if !tool.Available {
			return fmt.Errorf("checkov not found; install it with: %s", tool.Install)
		}
		j.Info("$ checkov -d " + st.Dir + " --framework terraform -o json")
		out, err := j.Run(runner.CmdOpts{Dir: st.Dir, Capture: true, Env: []string{"BC_SKIP_MAPPING=TRUE", "LOG_LEVEL=WARNING"}},
			tool.Path, "-d", ".", "--framework", "terraform", "-o", "json", "--soft-fail", "--quiet", "--compact", "--skip-results-upload")
		if err != nil {
			return err
		}
		rep, err := scan.ParseCheckov(out, st.ID)
		if err != nil {
			return err
		}
		g, err := s.graph(st)
		if err != nil {
			return err
		}
		rep.MapFindings(nodeRefs(g), plan.StripIndices)
		s.mu.Lock()
		s.security[st.ID] = rep
		s.mu.Unlock()
		j.Info(fmt.Sprintf("✓ %d passed, %d failed checks", rep.Passed, rep.Failed))
		s.hub.Publish(map[string]any{"type": "security", "stack": st.ID})
		return nil
	})
}

func (s *Server) handleGetCost(w http.ResponseWriter, r *http.Request) {
	st, env, ok := s.overlayParam(w, r)
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	respond(w, 200, map[string]any{"report": s.costs[overlayKey(st.ID, env)]})
}

func (s *Server) handleRunCost(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Stack    string   `json:"stack"`
		Env      string   `json:"env,omitempty"`
		VarFiles []string `json:"varFiles"`
	}
	if err := decodeBody(r, &req); err != nil {
		fail(w, 400, err)
		return
	}
	st, ok := s.stack(req.Stack)
	if !ok {
		fail(w, 404, fmt.Errorf("unknown stack %q", req.Stack))
		return
	}
	title := "c3x · " + st.Name
	if req.Env != "" {
		title += " · " + req.Env
	}
	s.startJob(w, "cost", st, title, func(j *runner.Job) error {
		tool := s.getTools(false).C3X
		if !tool.Available {
			return fmt.Errorf("c3x not found; install it with: %s", tool.Install)
		}
		key := overlayKey(st.ID, req.Env)
		s.mu.Lock()
		planFile := s.planJSON[key]
		s.mu.Unlock()
		source := "hcl"
		args := []string{"estimate", "--format", "json", "--allow-file-functions"}
		if offline := os.Getenv("TFVIZ_C3X_OFFLINE"); offline != "" && offline != "0" && offline != "false" {
			args = append(args, "--offline")
		}
		if planFile != "" {
			source = "plan"
			args = append(args, "--path", planFile)
			j.Info("Using the latest terraform plan for accurate costs")
		} else {
			args = append(args, "--path", ".")
			for _, vf := range req.VarFiles {
				args = append(args, "--var-file", vf)
			}
			j.Info("No plan available, estimating from HCL (run a plan for more accurate results)")
		}
		j.Info("$ c3x " + strings.Join(args, " "))
		out, err := j.Run(runner.CmdOpts{Dir: st.Dir, Capture: true}, tool.Path, args...)
		if err != nil {
			return err
		}
		rep, err := scan.ParseC3X(out, st.ID, source, plan.StripIndices)
		if err != nil {
			return err
		}
		s.mu.Lock()
		s.costs[key] = rep
		s.mu.Unlock()
		j.Info(fmt.Sprintf("✓ Estimated %.2f %s / month", rep.TotalMonthly, rep.Currency))
		s.hub.Publish(map[string]any{"type": "cost", "stack": st.ID, "env": req.Env})
		return nil
	})
}

func (s *Server) handleJobs(w http.ResponseWriter, r *http.Request) {
	respond(w, 200, s.jobs.List())
}

func (s *Server) handleJob(w http.ResponseWriter, r *http.Request) {
	j := s.jobs.Get(r.PathValue("id"))
	if j == nil {
		fail(w, 404, errors.New("job not found"))
		return
	}
	respond(w, 200, map[string]any{"job": j.Snapshot(), "logs": j.Logs()})
}

func (s *Server) handleCancelJob(w http.ResponseWriter, r *http.Request) {
	j := s.jobs.Get(r.PathValue("id"))
	if j == nil {
		fail(w, 404, errors.New("job not found"))
		return
	}
	j.Info("Cancelling…")
	j.Cancel()
	respond(w, 200, map[string]bool{"ok": true})
}

// Serve listens on addr (falling back to the next free ports) and blocks.
func (s *Server) Serve(host string, port int, onReady func(url string)) error {
	var ln net.Listener
	var err error
	for p := port; p < port+20; p++ {
		ln, err = net.Listen("tcp", net.JoinHostPort(host, fmt.Sprint(p)))
		if err == nil {
			break
		}
	}
	if err != nil {
		return err
	}
	if s.opts.Watch {
		stop := make(chan struct{})
		defer close(stop)
		if err := watch(s.opts.ProjectDir, stop, s.onFilesChanged); err != nil {
			log.Printf("file watching disabled: %v", err)
		}
	}
	addr := ln.Addr().(*net.TCPAddr)
	url := fmt.Sprintf("http://%s:%d", displayHost(host), addr.Port)
	if onReady != nil {
		onReady(url)
	}
	srv := &http.Server{Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	return srv.Serve(ln)
}

func displayHost(h string) string {
	if h == "" || h == "127.0.0.1" || h == "0.0.0.0" {
		return "localhost"
	}
	return h
}
