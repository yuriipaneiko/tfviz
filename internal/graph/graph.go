// Package graph turns a parsed Terraform module tree into a diagram model:
// nodes, dependency edges, module containers and AWS network placement.
package graph

import (
	"path/filepath"
	"sort"
	"strings"

	"github.com/yuriipaneiko/tf-visualise/internal/config"
)

type AttrView struct {
	Path string   `json:"path"`
	Text string   `json:"text"`
	Refs []string `json:"refs,omitempty"` // resolved node ids
}

type Network struct {
	Role   string   `json:"role,omitempty"`   // "vpc" | "subnet"
	Parent string   `json:"parent,omitempty"` // container id
	Spans  []string `json:"spans,omitempty"`  // subnets when placed across several
}

type Node struct {
	ID             string     `json:"id"`
	Kind           string     `json:"kind"` // resource | data | module
	Type           string     `json:"type"`
	Name           string     `json:"name"`
	Provider       string     `json:"provider"`
	ProviderConfig string     `json:"providerConfig,omitempty"`
	Module         string     `json:"module"`
	Multi          string     `json:"multi,omitempty"` // count | for_each
	MultiExpr      string     `json:"multiExpr,omitempty"`
	File           string     `json:"file"`
	AbsFile        string     `json:"absFile"`
	Line           int        `json:"line"`
	EndLine        int        `json:"endLine"`
	TextLine       int        `json:"textLine"`
	Source         string     `json:"source"`
	Attrs          []AttrView `json:"attrs"`
	Network        *Network   `json:"network,omitempty"`
	FoldInto       string     `json:"foldInto,omitempty"`
	ModuleSource   string     `json:"moduleSource,omitempty"`
	ModuleVersion  string     `json:"moduleVersion,omitempty"`
}

type Edge struct {
	ID     string   `json:"id"`
	Source string   `json:"source"` // the referencing object
	Target string   `json:"target"` // the referenced object
	Attrs  []string `json:"attrs"`
	Kind   string   `json:"kind"` // ref | depends_on
}

type VarView struct {
	Name        string `json:"name"`
	Type        string `json:"type,omitempty"`
	Default     string `json:"default,omitempty"`
	Description string `json:"description,omitempty"`
	Sensitive   bool   `json:"sensitive,omitempty"`
	Value       string `json:"value,omitempty"` // module call argument (child modules only)
}

type OutputView struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Value       string   `json:"value"`
	Refs        []string `json:"refs,omitempty"`
	Sensitive   bool     `json:"sensitive,omitempty"`
}

type ModuleInfo struct {
	ID        string       `json:"id"` // "" for root
	Name      string       `json:"name"`
	Parent    string       `json:"parent"`
	Source    string       `json:"source,omitempty"`
	Version   string       `json:"version,omitempty"`
	Dir       string       `json:"dir"`
	Expanded  bool         `json:"expanded"`
	Multi     string       `json:"multi,omitempty"`
	MultiExpr string       `json:"multiExpr,omitempty"`
	File      string       `json:"file,omitempty"`
	AbsFile   string       `json:"absFile,omitempty"`
	Line      int          `json:"line,omitempty"`
	Variables []VarView    `json:"variables"`
	Outputs   []OutputView `json:"outputs"`
	Resources int          `json:"resources"`
}

type Container struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Kind   string `json:"kind"` // subnet
	Parent string `json:"parent"`
}

type ProviderView struct {
	Name    string `json:"name"`
	Alias   string `json:"alias,omitempty"`
	Region  string `json:"region,omitempty"`
	Source  string `json:"source,omitempty"`
	Version string `json:"version,omitempty"`
}

type Graph struct {
	Stack       string         `json:"stack"`
	Nodes       []*Node        `json:"nodes"`
	Edges       []*Edge        `json:"edges"`
	Modules     []*ModuleInfo  `json:"modules"`
	Containers  []*Container   `json:"containers"`
	Providers   []ProviderView `json:"providers"`
	Backend     string         `json:"backend,omitempty"`
	Diagnostics []string       `json:"diagnostics"`
}

type target struct {
	id     string
	output string // set when the target is an unexpanded module (module output name)
}

type attrTargets struct {
	path    string
	targets []target
}

type builder struct {
	projectDir string
	g          *Graph
	nodes      map[string]*Node
	res        map[string]*config.Resource
	attrs      map[string][]attrTargets
	modules    map[string]*config.Module // module address -> module
	cache      map[string][]target
	inFlight   map[string]bool
}

// Build creates the diagram model for a root module.
func Build(root *config.Module, stackID, projectDir string) *Graph {
	b := &builder{
		projectDir: projectDir,
		g:          &Graph{Stack: stackID, Nodes: []*Node{}, Edges: []*Edge{}, Modules: []*ModuleInfo{}, Containers: []*Container{}, Diagnostics: []string{}},
		nodes:      map[string]*Node{},
		res:        map[string]*config.Resource{},
		attrs:      map[string][]attrTargets{},
		modules:    map[string]*config.Module{},
		cache:      map[string][]target{},
		inFlight:   map[string]bool{},
	}
	b.collect(root)
	b.buildEdges(root)
	b.computeNetwork()
	b.computeFolds()
	b.collectProviders(root)
	b.g.Backend = root.Backend
	return b.g
}

func (b *builder) rel(abs string) string {
	if r, err := filepath.Rel(b.projectDir, abs); err == nil {
		return filepath.ToSlash(r)
	}
	return abs
}

func multiOf(count, forEach *config.Expr) (string, string) {
	if count != nil {
		return "count", count.Text
	}
	if forEach != nil {
		return "for_each", forEach.Text
	}
	return "", ""
}

func (b *builder) collect(root *config.Module) {
	root.Walk(func(m *config.Module) {
		addr := m.Address()
		b.modules[addr] = m
		b.g.Diagnostics = append(b.g.Diagnostics, m.Diagnostics...)

		info := &ModuleInfo{ID: addr, Name: "root", Dir: b.rel(m.Dir), Expanded: true, Resources: len(m.Resources)}
		if m.Call != nil {
			info.Name = m.Call.Name
			info.Parent = m.Parent.Address()
			info.Source = m.Call.Source
			info.Version = m.Call.Version
			info.Multi, info.MultiExpr = multiOf(m.Call.Count, m.Call.ForEach)
			info.File, info.AbsFile, info.Line = b.rel(m.Call.Pos.File), m.Call.Pos.File, m.Call.Pos.StartLine
		}
		info.Variables = variableViews(m)
		info.Outputs = []OutputView{}
		b.g.Modules = append(b.g.Modules, info)

		for _, r := range m.Resources {
			kind := "resource"
			if r.Mode == "data" {
				kind = "data"
			}
			multi, multiExpr := multiOf(r.Count, r.ForEach)
			n := &Node{
				ID:             config.JoinAddress(addr, r.Key()),
				Kind:           kind,
				Type:           r.Type,
				Name:           r.Name,
				Provider:       r.ProviderName(),
				ProviderConfig: r.Provider,
				Module:         addr,
				Multi:          multi,
				MultiExpr:      multiExpr,
				File:           b.rel(r.Pos.File),
				AbsFile:        r.Pos.File,
				Line:           r.Pos.StartLine,
				EndLine:        r.Pos.EndLine,
				TextLine:       r.Pos.TextLine,
				Source:         r.Source,
				Attrs:          []AttrView{},
			}
			b.addNode(n)
			b.res[n.ID] = r
		}
		for _, name := range m.CallOrder {
			c := m.Calls[name]
			if c.Child != nil {
				continue
			}
			multi, multiExpr := multiOf(c.Count, c.ForEach)
			id := config.JoinAddress(addr, "module."+name)
			b.addNode(&Node{
				ID:            id,
				Kind:          "module",
				Type:          "module",
				Name:          name,
				Provider:      moduleProvider(c.Source),
				Module:        addr,
				Multi:         multi,
				MultiExpr:     multiExpr,
				File:          b.rel(c.Pos.File),
				AbsFile:       c.Pos.File,
				Line:          c.Pos.StartLine,
				EndLine:       c.Pos.EndLine,
				TextLine:      c.Pos.TextLine,
				Source:        c.Text,
				Attrs:         []AttrView{},
				ModuleSource:  c.Source,
				ModuleVersion: c.Version,
			})
			b.g.Modules = append(b.g.Modules, &ModuleInfo{
				ID: id, Name: name, Parent: addr, Source: c.Source, Version: c.Version,
				Expanded: false, Multi: multi, MultiExpr: multiExpr,
				File: b.rel(c.Pos.File), AbsFile: c.Pos.File, Line: c.Pos.StartLine,
				Variables: argViews(c), Outputs: []OutputView{},
			})
		}
	})
}

// moduleProvider guesses the provider from registry sources like
// "terraform-aws-modules/vpc/aws".
func moduleProvider(src string) string {
	parts := strings.Split(strings.SplitN(src, "//", 2)[0], "/")
	if len(parts) == 3 && !strings.Contains(src, ":") && !config.IsLocalSource(src) {
		return parts[2]
	}
	if strings.Contains(src, "terraform-aws-") || strings.Contains(src, "/aws") {
		return "aws"
	}
	return "module"
}

func variableViews(m *config.Module) []VarView {
	names := make([]string, 0, len(m.Variables))
	for n := range m.Variables {
		names = append(names, n)
	}
	sort.Strings(names)
	out := []VarView{}
	for _, n := range names {
		v := m.Variables[n]
		vv := VarView{Name: n, Type: v.Type, Default: v.Default, Description: v.Description, Sensitive: v.Sensitive}
		if m.Call != nil {
			if e := m.Call.Args[n]; e != nil {
				vv.Value = e.Text
			}
		}
		out = append(out, vv)
	}
	return out
}

func argViews(c *config.ModuleCall) []VarView {
	out := []VarView{}
	for _, n := range c.ArgOrder {
		out = append(out, VarView{Name: n, Value: c.Args[n].Text})
	}
	return out
}

func (b *builder) addNode(n *Node) {
	if _, dup := b.nodes[n.ID]; dup {
		return
	}
	b.nodes[n.ID] = n
	b.g.Nodes = append(b.g.Nodes, n)
}

// resolve follows a reference through locals, variables and module outputs until
// it reaches resources, data sources or unexpanded modules.
func (b *builder) resolve(m *config.Module, ref config.Ref) []target {
	key := m.Address() + "|" + ref.String()
	if t, ok := b.cache[key]; ok {
		return t
	}
	if b.inFlight[key] {
		return nil
	}
	b.inFlight[key] = true
	defer delete(b.inFlight, key)

	var out []target
	resolveExpr := func(mod *config.Module, e *config.Expr) {
		if e == nil {
			return
		}
		for _, r := range e.Refs {
			out = append(out, b.resolve(mod, r)...)
		}
	}
	switch ref.Kind {
	case config.RefResource, config.RefData:
		local := ref.Type + "." + ref.Name
		if ref.Kind == config.RefData {
			local = "data." + local
		}
		if m.Resource(local) != nil {
			out = append(out, target{id: config.JoinAddress(m.Address(), local)})
		}
	case config.RefLocal:
		resolveExpr(m, m.Locals[ref.Name])
	case config.RefVar:
		if m.Parent != nil && m.Call != nil {
			resolveExpr(m.Parent, m.Call.Args[ref.Name])
		}
	case config.RefModule:
		c := m.Calls[ref.Name]
		if c == nil {
			break
		}
		if c.Child == nil {
			out = append(out, target{id: config.JoinAddress(m.Address(), "module."+ref.Name), output: ref.Attr})
			break
		}
		if ref.Attr != "" {
			if o := c.Child.Outputs[ref.Attr]; o != nil {
				resolveExpr(c.Child, o.Value)
			}
		} else {
			for _, o := range c.Child.Outputs {
				resolveExpr(c.Child, o.Value)
			}
		}
	}
	out = dedupeTargets(out)
	b.cache[key] = out
	return out
}

func dedupeTargets(in []target) []target {
	seen := map[target]bool{}
	out := in[:0:0]
	for _, t := range in {
		if !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}

func (b *builder) resolveRefs(m *config.Module, refs []config.Ref) []target {
	var out []target
	for _, r := range refs {
		out = append(out, b.resolve(m, r)...)
	}
	return dedupeTargets(out)
}

func targetIDs(ts []target) []string {
	seen := map[string]bool{}
	var out []string
	for _, t := range ts {
		if !seen[t.id] {
			seen[t.id] = true
			out = append(out, t.id)
		}
	}
	return out
}

type edgeAcc struct {
	edges map[string]*Edge
	order []string
}

func (a *edgeAcc) add(src, dst, attr, kind string) {
	if src == dst {
		return
	}
	id := src + "->" + dst
	e := a.edges[id]
	if e == nil {
		e = &Edge{ID: id, Source: src, Target: dst, Kind: kind, Attrs: []string{}}
		a.edges[id] = e
		a.order = append(a.order, id)
	}
	if kind == "ref" {
		e.Kind = "ref"
	}
	for _, x := range e.Attrs {
		if x == attr {
			return
		}
	}
	e.Attrs = append(e.Attrs, attr)
}

func (b *builder) buildEdges(root *config.Module) {
	acc := &edgeAcc{edges: map[string]*Edge{}}
	root.Walk(func(m *config.Module) {
		addr := m.Address()
		for _, r := range m.Resources {
			id := config.JoinAddress(addr, r.Key())
			n := b.nodes[id]
			var ats []attrTargets
			addAttr := func(path string, e *config.Expr, kind string) {
				ts := b.resolveRefs(m, e.Refs)
				ats = append(ats, attrTargets{path: path, targets: ts})
				for _, t := range ts {
					acc.add(id, t.id, path, kind)
				}
			}
			if r.Count != nil {
				addAttr("count", r.Count, "ref")
			}
			if r.ForEach != nil {
				addAttr("for_each", r.ForEach, "ref")
			}
			for _, a := range r.Attrs {
				addAttr(a.Path, a.Expr, "ref")
				n.Attrs = append(n.Attrs, AttrView{Path: a.Path, Text: a.Expr.Text, Refs: targetIDs(ats[len(ats)-1].targets)})
			}
			if len(r.DependsOn) > 0 {
				addAttr("depends_on", &config.Expr{Refs: r.DependsOn}, "depends_on")
			}
			b.attrs[id] = ats
		}
		for _, name := range m.CallOrder {
			c := m.Calls[name]
			if c.Child != nil {
				continue
			}
			id := config.JoinAddress(addr, "module."+name)
			n := b.nodes[id]
			for _, arg := range c.ArgOrder {
				ts := b.resolveRefs(m, c.Args[arg].Refs)
				for _, t := range ts {
					acc.add(id, t.id, arg, "ref")
				}
				n.Attrs = append(n.Attrs, AttrView{Path: arg, Text: c.Args[arg].Text, Refs: targetIDs(ts)})
			}
			for _, t := range b.resolveRefs(m, c.DependsOn) {
				acc.add(id, t.id, "depends_on", "depends_on")
			}
		}
		// Resolved output references, for the module details panel.
		for _, info := range b.g.Modules {
			if info.ID != addr || !info.Expanded {
				continue
			}
			names := make([]string, 0, len(m.Outputs))
			for n := range m.Outputs {
				names = append(names, n)
			}
			sort.Strings(names)
			for _, n := range names {
				o := m.Outputs[n]
				info.Outputs = append(info.Outputs, OutputView{
					Name: n, Description: o.Description, Value: o.Value.Text, Sensitive: o.Sensitive,
					Refs: targetIDs(b.resolveRefs(m, o.Value.Refs)),
				})
			}
		}
	})
	for _, id := range acc.order {
		b.g.Edges = append(b.g.Edges, acc.edges[id])
	}
}

func (b *builder) collectProviders(root *config.Module) {
	req := map[string]config.RequiredProvider{}
	for _, rp := range root.RequiredProviders {
		req[rp.Name] = rp
	}
	seen := map[string]bool{}
	for _, p := range root.Providers {
		v := ProviderView{Name: p.Name, Alias: p.Alias, Region: root.ResolveString(p.Region)}
		if rp, ok := req[p.Name]; ok {
			v.Source, v.Version = rp.Source, rp.Version
		}
		seen[p.Name] = true
		b.g.Providers = append(b.g.Providers, v)
	}
	for _, rp := range root.RequiredProviders {
		if !seen[rp.Name] {
			b.g.Providers = append(b.g.Providers, ProviderView{Name: rp.Name, Source: rp.Source, Version: rp.Version})
		}
	}
	if b.g.Providers == nil {
		b.g.Providers = []ProviderView{}
	}
}
