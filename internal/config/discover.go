package config

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
)

// Stack is a directory containing Terraform files. Kind is "root" for
// directories meant to be planned, or "module" for reusable modules.
type Stack struct {
	ID             string   `json:"id"`   // path relative to the project dir ("." for the project dir itself)
	Name           string   `json:"name"` // display name
	Dir            string   `json:"dir"`  // absolute
	Kind           string   `json:"kind"`
	Initialized    bool     `json:"initialized"`
	VarFiles       []string `json:"varFiles"`
	BackendConfigs []string `json:"backendConfigs,omitempty"`
	Envs           []Env    `json:"envs,omitempty"`
	Backend        string   `json:"backend,omitempty"`
	Providers      []string `json:"providers"`
	UsedBy         []string `json:"usedBy,omitempty"`
}

// Env is a named way to plan a root: a tfvars file and/or a partial backend
// config. Both may live in the module directory or in a conventional subfolder
// (env/, configs/, …).
type Env struct {
	Name          string `json:"name"`
	VarFile       string `json:"varFile,omitempty"`
	BackendConfig string `json:"backendConfig,omitempty"`
}

var skipDirs = map[string]bool{"node_modules": true, "vendor": true}

func ShouldSkipDir(name string) bool {
	return (strings.HasPrefix(name, ".") && name != ".") || skipDirs[name]
}

type dirInfo struct {
	localCalls  []string // absolute dirs of local module calls
	hasBackend  bool
	backend     string
	hasProvider bool
	providers   map[string]bool
}

// Discover finds every Terraform directory under projectDir.
func Discover(projectDir string) ([]Stack, error) {
	projectDir, err := filepath.Abs(projectDir)
	if err != nil {
		return nil, err
	}
	infos := map[string]*dirInfo{}
	err = filepath.WalkDir(projectDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if path != projectDir && ShouldSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".tf") {
			return nil
		}
		dir := filepath.Dir(path)
		info := infos[dir]
		if info == nil {
			info = &dirInfo{providers: map[string]bool{}}
			infos[dir] = info
		}
		scanFile(path, info)
		return nil
	})
	if err != nil {
		return nil, err
	}

	usedBy := map[string][]string{}
	for dir, info := range infos {
		for _, c := range info.localCalls {
			usedBy[c] = append(usedBy[c], dir)
		}
	}

	var stacks []Stack
	for dir, info := range infos {
		rel, _ := filepath.Rel(projectDir, dir)
		rel = filepath.ToSlash(rel)
		s := Stack{ID: rel, Dir: dir, Name: rel, Backend: info.backend, Providers: []string{}}
		if rel == "." {
			s.Name = filepath.Base(projectDir)
		}
		for p := range info.providers {
			s.Providers = append(s.Providers, p)
		}
		sort.Strings(s.Providers)
		s.Kind = classify(rel, info, len(usedBy[dir]) > 0)
		for _, u := range usedBy[dir] {
			r, _ := filepath.Rel(projectDir, u)
			s.UsedBy = append(s.UsedBy, filepath.ToSlash(r))
		}
		sort.Strings(s.UsedBy)
		if st, err := os.Stat(filepath.Join(dir, ".terraform")); err == nil && st.IsDir() {
			s.Initialized = true
		}
		s.VarFiles, s.BackendConfigs, s.Envs = discoverVariants(dir)
		stacks = append(stacks, s)
	}
	sort.Slice(stacks, func(i, j int) bool {
		if stacks[i].Kind != stacks[j].Kind {
			return stacks[i].Kind == "root"
		}
		return stacks[i].ID < stacks[j].ID
	})
	return stacks, nil
}

func classify(rel string, info *dirInfo, referenced bool) string {
	if info.hasBackend {
		return "root"
	}
	if referenced {
		return "module"
	}
	for _, seg := range strings.Split(rel, "/") {
		if seg == "modules" && !info.hasProvider {
			return "module"
		}
	}
	return "root"
}

var varFileDirs = []string{"env", "envs", "environments", "tfvars", "vars"}
var backendDirs = []string{"configs", "config", "backend", "backends"}

func discoverVariants(dir string) (varFiles, backendConfigs []string, envs []Env) {
	varFiles = collectVarFiles(dir)
	backendConfigs = collectBackendConfigs(dir, varFiles)
	envs = pairEnvs(varFiles, backendConfigs)
	return
}

func collectVarFiles(dir string) []string {
	var out []string
	out = append(out, listVarFiles(dir, "")...)
	for _, sub := range varFileDirs {
		out = append(out, listVarFiles(filepath.Join(dir, sub), sub)...)
	}
	sort.Strings(out)
	return unique(out)
}

func listVarFiles(abs, prefix string) []string {
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		n := e.Name()
		if !isVarFile(n) {
			continue
		}
		rel := n
		if prefix != "" {
			rel = prefix + "/" + n
		}
		out = append(out, rel)
	}
	return out
}

func isVarFile(name string) bool {
	return strings.HasSuffix(name, ".tfvars") || strings.HasSuffix(name, ".tfvars.json")
}

func implicitVarFile(rel string) bool {
	base := filepath.Base(rel)
	return base == "terraform.tfvars" || base == "terraform.tfvars.json" ||
		strings.HasSuffix(base, ".auto.tfvars") || strings.HasSuffix(base, ".auto.tfvars.json")
}

func collectBackendConfigs(dir string, varFiles []string) []string {
	varNames := map[string]bool{}
	for _, v := range varFiles {
		if !implicitVarFile(v) {
			varNames[envName(v)] = true
		}
	}
	var out []string
	out = append(out, listBackendConfigs(dir, "", varNames, true)...)
	for _, sub := range backendDirs {
		out = append(out, listBackendConfigs(filepath.Join(dir, sub), sub, varNames, false)...)
	}
	sort.Strings(out)
	return unique(out)
}

func listBackendConfigs(abs, prefix string, varNames map[string]bool, root bool) []string {
	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		n := e.Name()
		if !isBackendConfig(n, envName(n), varNames, root) {
			continue
		}
		rel := n
		if prefix != "" {
			rel = prefix + "/" + n
		}
		out = append(out, rel)
	}
	return out
}

func isBackendConfig(name, env string, varNames map[string]bool, root bool) bool {
	if strings.HasPrefix(name, ".") || strings.HasSuffix(name, ".lock.hcl") {
		return false
	}
	switch {
	case strings.HasSuffix(name, ".tfbackend"):
		return true
	case strings.HasPrefix(name, "backend-") && strings.HasSuffix(name, ".hcl"):
		return true
	case strings.HasPrefix(name, "backend_") && strings.HasSuffix(name, ".hcl"):
		return true
	case strings.HasSuffix(name, "-backend.hcl") || strings.HasSuffix(name, "_backend.hcl"):
		return true
	case strings.HasSuffix(name, ".config") || strings.HasSuffix(name, ".hcl"):
		if root {
			return varNames[env]
		}
		return true
	}
	return false
}

func pairEnvs(varFiles, backendConfigs []string) []Env {
	type bits struct{ vars, backend string }
	by := map[string]*bits{}
	take := func(name string) *bits {
		if b := by[name]; b != nil {
			return b
		}
		b := &bits{}
		by[name] = b
		return b
	}
	for _, v := range varFiles {
		if implicitVarFile(v) {
			continue
		}
		b := take(envName(v))
		b.vars = preferPath(b.vars, v)
	}
	for _, c := range backendConfigs {
		b := take(envName(c))
		b.backend = preferPath(b.backend, c)
	}
	names := make([]string, 0, len(by))
	for n := range by {
		if n != "" {
			names = append(names, n)
		}
	}
	sort.Strings(names)
	var envs []Env
	for _, n := range names {
		b := by[n]
		envs = append(envs, Env{Name: n, VarFile: b.vars, BackendConfig: b.backend})
	}
	return envs
}

// preferPath keeps the more nested path (env/dev.tfvars over dev.tfvars).
func preferPath(existing, candidate string) string {
	if existing == "" {
		return candidate
	}
	if strings.Count(candidate, "/") > strings.Count(existing, "/") {
		return candidate
	}
	return existing
}

func envName(rel string) string {
	base := filepath.Base(rel)
	for _, ext := range []string{".tfvars.json", ".tfvars", ".tfbackend", ".config", ".hcl"} {
		if strings.HasSuffix(base, ext) {
			base = strings.TrimSuffix(base, ext)
			break
		}
	}
	for _, p := range []string{"backend-", "backend_"} {
		if strings.HasPrefix(base, p) {
			base = strings.TrimPrefix(base, p)
		}
	}
	base = strings.TrimSuffix(base, "-backend")
	base = strings.TrimSuffix(base, "_backend")
	return base
}

func unique(in []string) []string {
	if len(in) < 2 {
		return in
	}
	out := in[:0]
	var prev string
	for _, s := range in {
		if s != prev {
			out = append(out, s)
			prev = s
		}
	}
	return out
}

func scanFile(path string, info *dirInfo) {
	src, err := os.ReadFile(path)
	if err != nil {
		return
	}
	file, _ := hclsyntax.ParseConfig(src, path, hcl.InitialPos)
	if file == nil {
		return
	}
	body, ok := file.Body.(*hclsyntax.Body)
	if !ok {
		return
	}
	dir := filepath.Dir(path)
	for _, b := range body.Blocks {
		switch b.Type {
		case "module":
			if a := b.Body.Attributes["source"]; a != nil {
				s := literalString(a.Expr, src)
				if IsLocalSource(s) {
					info.localCalls = append(info.localCalls, filepath.Clean(filepath.Join(dir, s)))
				}
			}
		case "provider":
			info.hasProvider = true
			if len(b.Labels) == 1 {
				info.providers[b.Labels[0]] = true
			}
		case "resource", "data":
			if len(b.Labels) == 2 {
				info.providers[strings.SplitN(b.Labels[0], "_", 2)[0]] = true
			}
		case "terraform":
			for _, inner := range b.Body.Blocks {
				if inner.Type == "backend" || inner.Type == "cloud" {
					info.hasBackend = true
					if len(inner.Labels) == 1 {
						info.backend = inner.Labels[0]
					} else if inner.Type == "cloud" {
						info.backend = "cloud"
					}
				}
			}
		}
	}
}
