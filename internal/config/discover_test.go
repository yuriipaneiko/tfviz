package config

import (
	"os"
	"path/filepath"
	"testing"
)

func byID(t *testing.T, dir string) map[string]Stack {
	t.Helper()
	stacks, err := Discover(dir)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]Stack{}
	for _, s := range stacks {
		out[s.ID] = s
	}
	return out
}

func TestDiscoverNestedEnvs(t *testing.T) {
	s := byID(t, "testdata/layouts")["nested"]
	if s.Kind != "root" {
		t.Fatalf("kind = %q", s.Kind)
	}
	if s.Backend != "s3" {
		t.Errorf("backend = %q", s.Backend)
	}
	wantVars := []string{"env/dev.tfvars", "env/prod.tfvars", "terraform.tfvars"}
	if !equal(s.VarFiles, wantVars) {
		t.Errorf("varFiles = %v, want %v", s.VarFiles, wantVars)
	}
	wantBack := []string{"configs/dev.config", "configs/prod.config"}
	if !equal(s.BackendConfigs, wantBack) {
		t.Errorf("backendConfigs = %v, want %v", s.BackendConfigs, wantBack)
	}
	if len(s.Envs) != 2 || s.Envs[0].Name != "dev" || s.Envs[0].VarFile != "env/dev.tfvars" || s.Envs[0].BackendConfig != "configs/dev.config" {
		t.Errorf("envs[0] = %+v", s.Envs)
	}
	if s.Envs[1].Name != "prod" || s.Envs[1].VarFile != "env/prod.tfvars" || s.Envs[1].BackendConfig != "configs/prod.config" {
		t.Errorf("envs[1] = %+v", s.Envs)
	}
}

func TestDiscoverFlatEnvs(t *testing.T) {
	s := byID(t, "testdata/layouts")["flat"]
	if len(s.Envs) != 2 {
		t.Fatalf("envs = %+v", s.Envs)
	}
	if s.Envs[0].Name != "dev" || s.Envs[0].VarFile != "dev.tfvars" || s.Envs[0].BackendConfig != "dev.tfbackend" {
		t.Errorf("dev = %+v", s.Envs[0])
	}
	if s.Envs[1].Name != "staging" || s.Envs[1].VarFile != "staging.tfvars" || s.Envs[1].BackendConfig != "staging.tfbackend" {
		t.Errorf("staging = %+v", s.Envs[1])
	}
	for _, e := range s.Envs {
		if e.VarFile == "terraform.tfvars" {
			t.Fatal("shared terraform.tfvars should not be an env")
		}
	}
}

func TestDiscoverVarsOnly(t *testing.T) {
	s := byID(t, "testdata/layouts")["vars-only"]
	if len(s.Envs) != 1 || s.Envs[0].Name != "poc" || s.Envs[0].VarFile != "poc.tfvars" || s.Envs[0].BackendConfig != "" {
		t.Fatalf("envs = %+v", s.Envs)
	}
}

func TestEnvName(t *testing.T) {
	cases := map[string]string{
		"env/dev.tfvars":       "dev",
		"configs/prod.config":  "prod",
		"dev.tfbackend":        "dev",
		"backend-staging.hcl":  "staging",
		"prod-backend.hcl":     "prod",
		"foo.auto.tfvars":      "foo.auto",
		"terraform.tfvars":     "terraform",
	}
	for in, want := range cases {
		if got := envName(in); got != want {
			t.Errorf("envName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDiscoverBuildcheckLayout(t *testing.T) {
	dir := os.Getenv("TFVIZ_DISCOVER_DIR")
	if dir == "" {
		t.Skip("set TFVIZ_DISCOVER_DIR")
	}
	stacks, err := Discover(dir)
	if err != nil {
		t.Fatal(err)
	}
	var roots, paired int
	for _, s := range stacks {
		if s.Kind != "root" {
			continue
		}
		roots++
		for _, e := range s.Envs {
			if e.VarFile != "" && e.BackendConfig != "" {
				paired++
			}
			if paired <= 6 {
				t.Logf("%s [%s] var=%s backend=%s", s.ID, e.Name, e.VarFile, e.BackendConfig)
			}
		}
	}
	t.Logf("roots=%d paired=%d stacks=%d", roots, paired, len(stacks))
	if paired == 0 {
		t.Fatal("expected env/tfvars + backend config pairs")
	}
}

func TestDiscoverSkipsEnvSubdirsAsStacks(t *testing.T) {
	stacks := byID(t, "testdata/layouts")
	for id := range stacks {
		if filepath.Base(id) == "env" || filepath.Base(id) == "configs" {
			t.Errorf("subfolder %s should not be a stack", id)
		}
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
