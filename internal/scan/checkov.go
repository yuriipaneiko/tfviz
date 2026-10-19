// Package scan wraps external analysers (Checkov for security, C3X for
// cost) and normalises their output.
package scan

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type Finding struct {
	CheckID   string   `json:"checkId"`
	Name      string   `json:"name"`
	Severity  string   `json:"severity"`
	Guideline string   `json:"guideline,omitempty"`
	Resource  string   `json:"resource"`
	Address   string   `json:"address,omitempty"`
	File      string   `json:"file"`
	AbsFile   string   `json:"absFile"`
	Lines     [2]int   `json:"lines"`
	Nodes     []string `json:"nodes"`
}

type SecurityReport struct {
	Stack     string         `json:"stack"`
	Tool      string         `json:"tool"`
	Version   string         `json:"version,omitempty"`
	CreatedAt time.Time      `json:"createdAt"`
	Passed    int            `json:"passed"`
	Failed    int            `json:"failed"`
	Skipped   int            `json:"skipped"`
	Findings  []*Finding     `json:"findings"`
	Nodes     map[string]int `json:"nodes"` // node id -> failed checks
	Unmapped  int            `json:"unmapped"`
}

type checkovCheck struct {
	CheckID         string `json:"check_id"`
	CheckName       string `json:"check_name"`
	Severity        any    `json:"severity"`
	Guideline       string `json:"guideline"`
	Resource        string `json:"resource"`
	ResourceAddress string `json:"resource_address"`
	FilePath        string `json:"file_path"`
	FileAbsPath     string `json:"file_abs_path"`
	FileLineRange   []int  `json:"file_line_range"`
}

type checkovReport struct {
	CheckType string `json:"check_type"`
	Results   struct {
		FailedChecks []checkovCheck `json:"failed_checks"`
	} `json:"results"`
	Summary struct {
		Passed         int    `json:"passed"`
		Failed         int    `json:"failed"`
		Skipped        int    `json:"skipped"`
		CheckovVersion string `json:"checkov_version"`
	} `json:"summary"`
}

// ParseCheckov accepts the `checkov -o json` output, which is either a single
// report object or a list of reports (one per framework).
func ParseCheckov(data []byte, stack string) (*SecurityReport, error) {
	trimmed := strings.TrimSpace(string(data))
	var reports []checkovReport
	switch {
	case strings.HasPrefix(trimmed, "["):
		if err := json.Unmarshal([]byte(trimmed), &reports); err != nil {
			return nil, fmt.Errorf("parse checkov output: %w", err)
		}
	case strings.HasPrefix(trimmed, "{"):
		var r checkovReport
		if err := json.Unmarshal([]byte(trimmed), &r); err != nil {
			return nil, fmt.Errorf("parse checkov output: %w", err)
		}
		reports = []checkovReport{r}
	default:
		return nil, fmt.Errorf("unexpected checkov output: %.200s", trimmed)
	}

	rep := &SecurityReport{Stack: stack, Tool: "checkov", CreatedAt: time.Now(), Findings: []*Finding{}, Nodes: map[string]int{}}
	for _, r := range reports {
		if r.CheckType != "" && r.CheckType != "terraform" {
			continue
		}
		rep.Passed += r.Summary.Passed
		rep.Failed += r.Summary.Failed
		rep.Skipped += r.Summary.Skipped
		if r.Summary.CheckovVersion != "" {
			rep.Version = r.Summary.CheckovVersion
		}
		for _, c := range r.Results.FailedChecks {
			f := &Finding{
				CheckID:   c.CheckID,
				Name:      c.CheckName,
				Severity:  severity(c.Severity),
				Guideline: c.Guideline,
				Resource:  c.Resource,
				Address:   c.ResourceAddress,
				File:      strings.TrimPrefix(c.FilePath, "/"),
				AbsFile:   c.FileAbsPath,
				Nodes:     []string{},
			}
			if len(c.FileLineRange) == 2 {
				f.Lines = [2]int{c.FileLineRange[0], c.FileLineRange[1]}
			}
			rep.Findings = append(rep.Findings, f)
		}
	}
	return rep, nil
}

func severity(v any) string {
	if s, ok := v.(string); ok && s != "" {
		return strings.ToUpper(s)
	}
	return "UNKNOWN"
}

// NodeRef is the minimal node information used to map findings.
type NodeRef struct {
	ID      string
	Local   string // "aws_s3_bucket.this"
	AbsFile string
	Line    int
	EndLine int
}

// MapFindings attaches each finding to diagram nodes.
func (r *SecurityReport) MapFindings(nodes []NodeRef, stripIndices func(string) string) {
	byID := map[string]bool{}
	byLocal := map[string][]NodeRef{}
	for _, n := range nodes {
		byID[n.ID] = true
		byLocal[n.Local] = append(byLocal[n.Local], n)
	}
	r.Nodes = map[string]int{}
	r.Unmapped = 0
	for _, f := range r.Findings {
		f.Nodes = []string{}
		for _, cand := range []string{f.Address, f.Resource} {
			if a := stripIndices(cand); a != "" && byID[a] {
				f.Nodes = []string{a}
				break
			}
		}
		if len(f.Nodes) == 0 {
			local := stripIndices(f.Resource)
			if parts := strings.Split(local, "."); len(parts) >= 2 {
				local = strings.Join(parts[len(parts)-2:], ".")
			}
			cands := byLocal[local]
			var exact []string
			for _, n := range cands {
				if f.AbsFile != "" && n.AbsFile == f.AbsFile && f.Lines[0] >= n.Line && f.Lines[0] <= n.EndLine {
					exact = append(exact, n.ID)
				}
			}
			switch {
			case len(exact) > 0:
				f.Nodes = exact
			case len(cands) == 1:
				f.Nodes = []string{cands[0].ID}
			}
		}
		if len(f.Nodes) == 0 {
			r.Unmapped++
		}
		for _, id := range f.Nodes {
			r.Nodes[id]++
		}
	}
}
