package server

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

type Tool struct {
	Name      string `json:"name"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
	Available bool   `json:"available"`
	Install   string `json:"install"`
}

type Tools struct {
	Terraform   Tool     `json:"terraform"`
	Checkov     Tool     `json:"checkov"`
	C3X         Tool     `json:"c3x"`
	AWSProfiles []string `json:"awsProfiles"`
	AWSProfile  string   `json:"awsProfile,omitempty"` // AWS_PROFILE from the environment
}

var versionRe = regexp.MustCompile(`v?(\d+\.\d+\.\d+[\w.-]*)`)

// findBinary looks in $PATH, then an env override, then a project-local virtualenv.
func findBinary(name, envVar, projectDir string, extra ...string) string {
	if v := os.Getenv(envVar); v != "" {
		return v
	}
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	for _, e := range extra {
		if st, err := os.Stat(e); err == nil && !st.IsDir() {
			return e
		}
	}
	return ""
}

func probeVersion(path string, args ...string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, args...).Output()
	if err != nil {
		return ""
	}
	if m := versionRe.FindStringSubmatch(string(out)); m != nil {
		return m[1]
	}
	return strings.TrimSpace(string(out))
}

func detectTools(projectDir, terraformBin string) Tools {
	home, _ := os.UserHomeDir()
	exe, _ := os.Executable()
	exeDir := filepath.Dir(exe)
	t := Tools{
		Terraform: Tool{Name: "terraform", Install: "brew install hashicorp/tap/terraform"},
		Checkov:   Tool{Name: "checkov", Install: "pipx install checkov  (or: brew install checkov)"},
		C3X:       Tool{Name: "c3x", Install: "brew install c3xdev/tap/c3x"},
	}
	t.Terraform.Path = terraformBin
	if t.Terraform.Path == "" {
		t.Terraform.Path = findBinary("terraform", "TFVIZ_TERRAFORM", projectDir)
		if t.Terraform.Path == "" {
			if p := findBinary("tofu", "TFVIZ_TOFU", projectDir); p != "" {
				t.Terraform.Path, t.Terraform.Name = p, "tofu"
			}
		}
	} else if p, err := exec.LookPath(terraformBin); err == nil {
		t.Terraform.Path = p
		t.Terraform.Name = filepath.Base(p)
	}
	t.Checkov.Path = findBinary("checkov", "TFVIZ_CHECKOV", projectDir,
		filepath.Join(projectDir, ".venv", "bin", "checkov"),
		filepath.Join(exeDir, "..", ".venv", "bin", "checkov"),
		filepath.Join(home, ".local", "bin", "checkov"))
	t.C3X.Path = findBinary("c3x", "TFVIZ_C3X", projectDir,
		filepath.Join(home, ".local", "bin", "c3x"))

	var wg sync.WaitGroup
	probe := func(tool *Tool, args ...string) {
		defer wg.Done()
		if tool.Path == "" {
			return
		}
		tool.Version = probeVersion(tool.Path, args...)
		tool.Available = tool.Version != ""
	}
	wg.Add(3)
	go probe(&t.Terraform, "version")
	go probe(&t.Checkov, "--version")
	go probe(&t.C3X, "--version")
	wg.Wait()

	t.AWSProfiles = awsProfiles(home)
	t.AWSProfile = os.Getenv("AWS_PROFILE")
	return t
}

var sectionRe = regexp.MustCompile(`^\s*\[\s*(?:profile\s+)?([^\]\s]+)\s*\]`)

func awsProfiles(home string) []string {
	seen := map[string]bool{}
	for _, f := range []string{
		envOr("AWS_CONFIG_FILE", filepath.Join(home, ".aws", "config")),
		envOr("AWS_SHARED_CREDENTIALS_FILE", filepath.Join(home, ".aws", "credentials")),
	} {
		fh, err := os.Open(f)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(fh)
		for sc.Scan() {
			line := sc.Text()
			if strings.Contains(line, "sso-session") || strings.Contains(line, "services ") {
				continue
			}
			if m := sectionRe.FindStringSubmatch(line); m != nil {
				seen[m[1]] = true
			}
		}
		fh.Close()
	}
	out := []string{}
	for p := range seen {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func listWorkspaces(tf, dir string) ([]string, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, tf, "workspace", "list")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "TF_IN_AUTOMATION=1")
	out, err := cmd.Output()
	if err != nil {
		return nil, "", err
	}
	var list []string
	current := ""
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "*") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "*"))
			current = line
		}
		list = append(list, line)
	}
	return list, current, nil
}

func writeJSON(w interface{ Write([]byte) (int, error) }, v any) error {
	enc := json.NewEncoder(w)
	return enc.Encode(v)
}
