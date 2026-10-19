package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
	"github.com/zclconf/go-cty/cty"
)

const maxModuleDepth = 25

// metaArgs are resource arguments that are not part of the resource schema.
var metaArgs = map[string]bool{
	"count": true, "for_each": true, "provider": true, "depends_on": true,
}

var metaBlocks = map[string]bool{
	"lifecycle": true, "provisioner": true, "connection": true,
}

type loader struct {
	rootDir  string
	manifest map[string]string // module key ("a.b") -> absolute dir
	files    map[string][]byte
}

// LoadRoot parses the root module in dir and every module it calls that can be
// found locally (relative paths or modules downloaded by `terraform init`).
func LoadRoot(dir string) (*Module, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	l := &loader{rootDir: abs, manifest: readManifest(abs), files: map[string][]byte{}}
	root := newModule(abs, nil, nil, nil)
	if err := l.loadModule(root, 0, map[string]bool{}); err != nil {
		return nil, err
	}
	return root, nil
}

// modules.json written by `terraform init`.
func readManifest(rootDir string) map[string]string {
	out := map[string]string{}
	data, err := os.ReadFile(filepath.Join(rootDir, ".terraform", "modules", "modules.json"))
	if err != nil {
		return out
	}
	var m struct {
		Modules []struct {
			Key string `json:"Key"`
			Dir string `json:"Dir"`
		} `json:"Modules"`
	}
	if json.Unmarshal(data, &m) != nil {
		return out
	}
	for _, e := range m.Modules {
		if e.Key == "" {
			continue
		}
		d := e.Dir
		if !filepath.IsAbs(d) {
			d = filepath.Join(rootDir, d)
		}
		out[e.Key] = filepath.Clean(d)
	}
	return out
}

func IsLocalSource(src string) bool {
	return strings.HasPrefix(src, "./") || strings.HasPrefix(src, "../") || src == "." || src == ".."
}

func tfFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasSuffix(name, ".tf") && !strings.HasPrefix(name, ".") {
			files = append(files, filepath.Join(dir, name))
		}
	}
	sort.Strings(files)
	return files, nil
}

func (l *loader) loadModule(m *Module, depth int, stack map[string]bool) error {
	files, err := tfFiles(m.Dir)
	if err != nil {
		return err
	}
	for _, f := range files {
		src, err := os.ReadFile(f)
		if err != nil {
			m.Diagnostics = append(m.Diagnostics, err.Error())
			continue
		}
		file, diags := hclsyntax.ParseConfig(src, f, hcl.InitialPos)
		for _, d := range diags {
			if d.Severity == hcl.DiagError {
				m.Diagnostics = append(m.Diagnostics, d.Error())
			}
		}
		if file == nil {
			continue
		}
		body, ok := file.Body.(*hclsyntax.Body)
		if !ok {
			continue
		}
		l.parseBody(m, body, src, f)
	}

	stack[m.Dir] = true
	defer delete(stack, m.Dir)
	for _, name := range m.CallOrder {
		call := m.Calls[name]
		dir := l.resolveModuleDir(m, call)
		if dir == "" {
			continue
		}
		if depth >= maxModuleDepth || stack[dir] {
			m.Diagnostics = append(m.Diagnostics, fmt.Sprintf("module %q: recursion limit reached", name))
			continue
		}
		if st, err := os.Stat(dir); err != nil || !st.IsDir() {
			continue
		}
		path := append(append([]string{}, m.Path...), name)
		child := newModule(dir, path, m, call)
		if err := l.loadModule(child, depth+1, stack); err != nil {
			m.Diagnostics = append(m.Diagnostics, fmt.Sprintf("module %q: %v", name, err))
			continue
		}
		call.Child = child
	}
	return nil
}

func (l *loader) resolveModuleDir(parent *Module, call *ModuleCall) string {
	key := strings.Join(append(append([]string{}, parent.Path...), call.Name), ".")
	if d, ok := l.manifest[key]; ok {
		return d
	}
	if IsLocalSource(call.Source) {
		return filepath.Clean(filepath.Join(parent.Dir, call.Source))
	}
	return ""
}

func (l *loader) parseBody(m *Module, body *hclsyntax.Body, src []byte, file string) {
	for _, block := range body.Blocks {
		pos := blockPos(block, file)
		text, textLine := blockText(block, src)
		pos.TextLine = textLine
		switch block.Type {
		case "resource", "data":
			if len(block.Labels) != 2 {
				continue
			}
			mode := "managed"
			if block.Type == "data" {
				mode = "data"
			}
			r := &Resource{Mode: mode, Type: block.Labels[0], Name: block.Labels[1], Pos: pos, Source: text}
			parseResourceBody(r, block.Body, src)
			if _, dup := m.resIndex[r.Key()]; !dup {
				m.Resources = append(m.Resources, r)
				m.resIndex[r.Key()] = r
			}
		case "module":
			if len(block.Labels) != 1 {
				continue
			}
			c := &ModuleCall{Name: block.Labels[0], Args: map[string]*Expr{}, Pos: pos, Text: text}
			for _, name := range sortedAttrNames(block.Body) {
				attr := block.Body.Attributes[name]
				switch name {
				case "source":
					c.Source = literalString(attr.Expr, src)
				case "version":
					c.Version = literalString(attr.Expr, src)
				case "count":
					c.Count = toExpr(attr.Expr, src)
				case "for_each":
					c.ForEach = toExpr(attr.Expr, src)
				case "depends_on":
					c.DependsOn = toExpr(attr.Expr, src).Refs
				case "providers":
				default:
					c.Args[name] = toExpr(attr.Expr, src)
					c.ArgOrder = append(c.ArgOrder, name)
				}
			}
			if _, dup := m.Calls[c.Name]; !dup {
				m.Calls[c.Name] = c
				m.CallOrder = append(m.CallOrder, c.Name)
			}
		case "variable":
			if len(block.Labels) != 1 {
				continue
			}
			v := &Variable{Name: block.Labels[0], Pos: pos}
			if a := block.Body.Attributes["type"]; a != nil {
				v.Type = exprText(a.Expr, src)
			}
			if a := block.Body.Attributes["default"]; a != nil {
				v.Default = exprText(a.Expr, src)
			}
			if a := block.Body.Attributes["description"]; a != nil {
				v.Description = literalString(a.Expr, src)
			}
			if a := block.Body.Attributes["sensitive"]; a != nil {
				v.Sensitive = exprText(a.Expr, src) == "true"
			}
			m.Variables[v.Name] = v
		case "output":
			if len(block.Labels) != 1 {
				continue
			}
			o := &Output{Name: block.Labels[0], Pos: pos, Value: &Expr{}}
			if a := block.Body.Attributes["value"]; a != nil {
				o.Value = toExpr(a.Expr, src)
			}
			if a := block.Body.Attributes["description"]; a != nil {
				o.Description = literalString(a.Expr, src)
			}
			if a := block.Body.Attributes["sensitive"]; a != nil {
				o.Sensitive = exprText(a.Expr, src) == "true"
			}
			m.Outputs[o.Name] = o
		case "locals":
			for name, attr := range block.Body.Attributes {
				m.Locals[name] = toExpr(attr.Expr, src)
			}
		case "provider":
			if len(block.Labels) != 1 {
				continue
			}
			p := Provider{Name: block.Labels[0], Pos: pos}
			if a := block.Body.Attributes["alias"]; a != nil {
				p.Alias = literalString(a.Expr, src)
			}
			if a := block.Body.Attributes["region"]; a != nil {
				p.Region = exprText(a.Expr, src)
			}
			m.Providers = append(m.Providers, p)
		case "terraform":
			if a := block.Body.Attributes["required_version"]; a != nil {
				m.RequiredVersion = literalString(a.Expr, src)
			}
			for _, inner := range block.Body.Blocks {
				switch inner.Type {
				case "backend":
					if len(inner.Labels) == 1 {
						m.Backend = inner.Labels[0]
					}
				case "cloud":
					m.Backend = "cloud"
				case "required_providers":
					for _, name := range sortedAttrNames(inner.Body) {
						rp := RequiredProvider{Name: name}
						if obj, ok := inner.Body.Attributes[name].Expr.(*hclsyntax.ObjectConsExpr); ok {
							for _, item := range obj.Items {
								k := literalString(item.KeyExpr, src)
								switch k {
								case "source":
									rp.Source = literalString(item.ValueExpr, src)
								case "version":
									rp.Version = literalString(item.ValueExpr, src)
								}
							}
						} else {
							rp.Version = literalString(inner.Body.Attributes[name].Expr, src)
						}
						m.RequiredProviders = append(m.RequiredProviders, rp)
					}
				}
			}
		}
	}
}

func parseResourceBody(r *Resource, body *hclsyntax.Body, src []byte) {
	for _, name := range sortedAttrNames(body) {
		attr := body.Attributes[name]
		switch name {
		case "count":
			r.Count = toExpr(attr.Expr, src)
		case "for_each":
			r.ForEach = toExpr(attr.Expr, src)
		case "provider":
			r.Provider = strings.TrimSpace(exprText(attr.Expr, src))
		case "depends_on":
			r.DependsOn = toExpr(attr.Expr, src).Refs
		default:
			r.Attrs = append(r.Attrs, Attr{Path: name, Expr: toExpr(attr.Expr, src)})
		}
	}
	walkNestedBlocks(body, "", src, func(path string, e *Expr) {
		r.Attrs = append(r.Attrs, Attr{Path: path, Expr: e})
	})
}

func walkNestedBlocks(body *hclsyntax.Body, prefix string, src []byte, emit func(string, *Expr)) {
	for _, b := range body.Blocks {
		if prefix == "" && metaBlocks[b.Type] {
			continue
		}
		if b.Type == "dynamic" && len(b.Labels) == 1 {
			name := prefix + b.Labels[0]
			if a := b.Body.Attributes["for_each"]; a != nil {
				emit(name, toExpr(a.Expr, src))
			}
			for _, inner := range b.Body.Blocks {
				if inner.Type == "content" {
					emitAttrs(inner.Body, name+".", src, emit)
					walkNestedBlocks(inner.Body, name+".", src, emit)
				}
			}
			continue
		}
		name := prefix + b.Type
		emitAttrs(b.Body, name+".", src, emit)
		walkNestedBlocks(b.Body, name+".", src, emit)
	}
}

func emitAttrs(body *hclsyntax.Body, prefix string, src []byte, emit func(string, *Expr)) {
	for _, name := range sortedAttrNames(body) {
		if prefix == "" && metaArgs[name] {
			continue
		}
		emit(prefix+name, toExpr(body.Attributes[name].Expr, src))
	}
}

func sortedAttrNames(body *hclsyntax.Body) []string {
	names := make([]string, 0, len(body.Attributes))
	for n := range body.Attributes {
		names = append(names, n)
	}
	sort.Slice(names, func(i, j int) bool {
		return body.Attributes[names[i]].SrcRange.Start.Byte < body.Attributes[names[j]].SrcRange.Start.Byte
	})
	return names
}

func blockPos(b *hclsyntax.Block, file string) Pos {
	r := b.Range()
	return Pos{File: file, StartLine: r.Start.Line, EndLine: r.End.Line}
}

// blockText returns the block source including comment lines directly above it,
// and the line number the returned text starts at.
func blockText(b *hclsyntax.Block, src []byte) (string, int) {
	r := b.Range()
	if r.End.Byte > len(src) {
		return "", r.Start.Line
	}
	start := lastLineStart(src, r.Start.Byte)
	line := r.Start.Line
	for start > 0 {
		prev := lastLineStart(src, start-1)
		text := strings.TrimSpace(string(src[prev : start-1]))
		if !strings.HasPrefix(text, "#") && !strings.HasPrefix(text, "//") {
			break
		}
		start = prev
		line--
	}
	return string(src[start:r.End.Byte]), line
}

func lastLineStart(src []byte, pos int) int {
	if pos <= 0 {
		return 0
	}
	if pos > len(src) {
		pos = len(src)
	}
	for i := pos - 1; i >= 0; i-- {
		if src[i] == '\n' {
			return i + 1
		}
	}
	return 0
}

func exprText(e hclsyntax.Expression, src []byte) string {
	r := e.Range()
	if r.End.Byte > len(src) || r.Start.Byte > r.End.Byte {
		return ""
	}
	return string(src[r.Start.Byte:r.End.Byte])
}

// literalString returns the value of a string literal, falling back to the raw source.
func literalString(e hclsyntax.Expression, src []byte) string {
	switch ex := e.(type) {
	case *hclsyntax.TemplateExpr:
		if ex.IsStringLiteral() {
			if v, diags := ex.Value(nil); !diags.HasErrors() && v.Type() == cty.String {
				return v.AsString()
			}
		}
	case *hclsyntax.LiteralValueExpr:
		if ex.Val.Type() == cty.String {
			return ex.Val.AsString()
		}
	case *hclsyntax.ScopeTraversalExpr:
		return ex.Traversal.RootName()
	case *hclsyntax.ObjectConsKeyExpr:
		if name := hcl.ExprAsKeyword(ex); name != "" {
			return name
		}
		return literalString(ex.Wrapped, src)
	}
	return exprText(e, src)
}

func toExpr(e hclsyntax.Expression, src []byte) *Expr {
	out := &Expr{Text: exprText(e, src)}
	seen := map[string]bool{}
	for _, t := range e.Variables() {
		ref, ok := refFromTraversal(t)
		if !ok {
			continue
		}
		key := ref.String() + "|" + ref.Attr
		if seen[key] {
			continue
		}
		seen[key] = true
		out.Refs = append(out.Refs, ref)
	}
	return out
}

var ignoredRoots = map[string]bool{
	"count": true, "each": true, "path": true, "terraform": true, "self": true,
}

func refFromTraversal(t hcl.Traversal) (Ref, bool) {
	root := t.RootName()
	if ignoredRoots[root] {
		return Ref{}, false
	}
	var names []string
	for _, step := range t[1:] {
		if a, ok := step.(hcl.TraverseAttr); ok {
			names = append(names, a.Name)
		}
	}
	at := func(i int) string {
		if i < len(names) {
			return names[i]
		}
		return ""
	}
	switch root {
	case "var":
		if len(names) == 0 {
			return Ref{}, false
		}
		return Ref{Kind: RefVar, Name: names[0]}, true
	case "local":
		if len(names) == 0 {
			return Ref{}, false
		}
		return Ref{Kind: RefLocal, Name: names[0]}, true
	case "module":
		if len(names) == 0 {
			return Ref{}, false
		}
		return Ref{Kind: RefModule, Name: names[0], Attr: at(1)}, true
	case "data":
		if len(names) < 2 {
			return Ref{}, false
		}
		return Ref{Kind: RefData, Type: names[0], Name: names[1], Attr: at(2)}, true
	default:
		if len(names) == 0 || !strings.Contains(root, "_") {
			return Ref{}, false
		}
		return Ref{Kind: RefResource, Type: root, Name: names[0], Attr: at(1)}, true
	}
}
