// Package config loads Terraform configuration (HCL) into a lightweight model
// that keeps every reference between objects, without needing `terraform init`.
package config

import (
	"strconv"
	"strings"
)

type RefKind string

const (
	RefResource RefKind = "resource"
	RefData     RefKind = "data"
	RefVar      RefKind = "var"
	RefLocal    RefKind = "local"
	RefModule   RefKind = "module"
)

// Ref is a single reference found inside an expression, e.g. `aws_vpc.main.id`
// or `module.network.private_subnet_ids`.
type Ref struct {
	Kind RefKind
	Type string // resource / data source type
	Name string // resource, variable, local or module call name
	Attr string // first attribute after the object (module output for module refs)
}

func (r Ref) String() string {
	switch r.Kind {
	case RefResource:
		return r.Type + "." + r.Name
	case RefData:
		return "data." + r.Type + "." + r.Name
	case RefModule:
		if r.Attr != "" {
			return "module." + r.Name + "." + r.Attr
		}
		return "module." + r.Name
	default:
		return string(r.Kind) + "." + r.Name
	}
}

type Expr struct {
	Text string
	Refs []Ref
}

// Pos points at a block in a source file. File is absolute.
type Pos struct {
	File      string
	StartLine int
	EndLine   int
	TextLine  int // first line of the captured source text (includes leading comments)
}

type Attr struct {
	Path string // dotted path, nested blocks included: "vpc_config.subnet_ids"
	Expr *Expr
}

type Resource struct {
	Mode      string // "managed" or "data"
	Type      string
	Name      string
	Provider  string // provider config address, e.g. "aws" or "aws.us_east_1"
	Attrs     []Attr
	Count     *Expr
	ForEach   *Expr
	DependsOn []Ref
	Pos       Pos
	Source    string
}

func (r *Resource) Key() string {
	if r.Mode == "data" {
		return "data." + r.Type + "." + r.Name
	}
	return r.Type + "." + r.Name
}

// ProviderName returns the local provider name (e.g. "aws" for "aws.us_east_1",
// or the type prefix when no provider meta-argument is set).
func (r *Resource) ProviderName() string {
	if r.Provider != "" {
		return strings.SplitN(r.Provider, ".", 2)[0]
	}
	return strings.SplitN(r.Type, "_", 2)[0]
}

func (r *Resource) AttrsMatching(pred func(path string) bool) []Attr {
	var out []Attr
	for _, a := range r.Attrs {
		if pred(a.Path) {
			out = append(out, a)
		}
	}
	return out
}

type ModuleCall struct {
	Name      string
	Source    string
	Version   string
	Args      map[string]*Expr
	ArgOrder  []string
	Count     *Expr
	ForEach   *Expr
	DependsOn []Ref
	Pos       Pos
	Text      string
	Child     *Module // nil when the module can't be resolved locally (remote, not initialised)
}

type Variable struct {
	Name        string
	Type        string
	Default     string
	Description string
	Sensitive   bool
	Pos         Pos
}

type Output struct {
	Name        string
	Description string
	Value       *Expr
	Sensitive   bool
	Pos         Pos
}

type Provider struct {
	Name  string
	Alias string
	// Region is the raw expression text; see Module.ResolveString.
	Region string
	Pos    Pos
}

// ResolveString returns the value of a literal string or a var reference with
// a literal default, and "" for anything that needs evaluation.
func (m *Module) ResolveString(expr string) string {
	expr = strings.TrimSpace(expr)
	if s, ok := unquoteLiteral(expr); ok {
		return s
	}
	if name, ok := strings.CutPrefix(expr, "var."); ok {
		if v := m.Variables[name]; v != nil {
			if s, ok := unquoteLiteral(strings.TrimSpace(v.Default)); ok {
				return s
			}
		}
	}
	return ""
}

func unquoteLiteral(s string) (string, bool) {
	if len(s) < 2 || s[0] != '"' || s[len(s)-1] != '"' || strings.Contains(s, "${") {
		return "", false
	}
	u, err := strconv.Unquote(s)
	return u, err == nil
}

type RequiredProvider struct {
	Name    string
	Source  string
	Version string
}

type Module struct {
	Path   []string // module call names from the root, empty for root
	Dir    string
	Parent *Module
	Call   *ModuleCall

	Resources         []*Resource
	resIndex          map[string]*Resource
	Calls             map[string]*ModuleCall
	CallOrder         []string
	Variables         map[string]*Variable
	Locals            map[string]*Expr
	Outputs           map[string]*Output
	Providers         []Provider
	RequiredProviders []RequiredProvider
	Backend           string
	RequiredVersion   string
	Diagnostics       []string
}

func newModule(dir string, path []string, parent *Module, call *ModuleCall) *Module {
	return &Module{
		Path:      path,
		Dir:       dir,
		Parent:    parent,
		Call:      call,
		resIndex:  map[string]*Resource{},
		Calls:     map[string]*ModuleCall{},
		Variables: map[string]*Variable{},
		Locals:    map[string]*Expr{},
		Outputs:   map[string]*Output{},
	}
}

// Address returns "module.a.module.b" (empty for root).
func (m *Module) Address() string {
	return ModuleAddress(m.Path)
}

func (m *Module) Resource(key string) *Resource {
	return m.resIndex[key]
}

func ModuleAddress(path []string) string {
	parts := make([]string, 0, len(path)*2)
	for _, p := range path {
		parts = append(parts, "module", p)
	}
	return strings.Join(parts, ".")
}

func JoinAddress(module, local string) string {
	if module == "" {
		return local
	}
	return module + "." + local
}

// Walk visits m and every resolved descendant module.
func (m *Module) Walk(fn func(*Module)) {
	fn(m)
	for _, name := range m.CallOrder {
		if c := m.Calls[name]; c.Child != nil {
			c.Child.Walk(fn)
		}
	}
}
