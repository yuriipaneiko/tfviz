// Package plan parses `terraform show -json <planfile>` output into a model
// keyed by configuration address so it can be overlaid on the diagram.
package plan

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

type AttrChange struct {
	Path          string          `json:"path"`
	Before        json.RawMessage `json:"before,omitempty"`
	After         json.RawMessage `json:"after,omitempty"`
	AfterUnknown  bool            `json:"afterUnknown,omitempty"`
	Sensitive     bool            `json:"sensitive,omitempty"`
	ForcesReplace bool            `json:"forcesReplace,omitempty"`
}

type Change struct {
	Address       string       `json:"address"`
	ConfigAddress string       `json:"configAddress"`
	Module        string       `json:"module,omitempty"`
	Mode          string       `json:"mode"`
	Type          string       `json:"type"`
	Name          string       `json:"name"`
	Index         string       `json:"index,omitempty"`
	Provider      string       `json:"provider"`
	Action        string       `json:"action"`
	Actions       []string     `json:"actions"`
	ActionReason  string       `json:"actionReason,omitempty"`
	Attrs         []AttrChange `json:"attrs"`
	Imported      bool         `json:"imported,omitempty"`
	MovedFrom     string       `json:"movedFrom,omitempty"`
}

type NodeChange struct {
	Action    string         `json:"action"`
	Instances int            `json:"instances"`
	Counts    map[string]int `json:"counts"`
}

type OutputChange struct {
	Name      string          `json:"name"`
	Action    string          `json:"action"`
	Before    json.RawMessage `json:"before,omitempty"`
	After     json.RawMessage `json:"after,omitempty"`
	Unknown   bool            `json:"unknown,omitempty"`
	Sensitive bool            `json:"sensitive,omitempty"`
}

type Summary struct {
	Create  int `json:"create"`
	Update  int `json:"update"`
	Delete  int `json:"delete"`
	Replace int `json:"replace"`
	Read    int `json:"read"`
	NoOp    int `json:"noop"`
	Forget  int `json:"forget"`
	Drift   int `json:"drift"`
}

type Result struct {
	Stack            string                `json:"stack"`
	CreatedAt        time.Time             `json:"createdAt"`
	TerraformVersion string                `json:"terraformVersion"`
	Errored          bool                  `json:"errored"`
	Summary          Summary               `json:"summary"`
	Changes          []*Change             `json:"changes"`
	Nodes            map[string]NodeChange `json:"nodes"`
	Outputs          []OutputChange        `json:"outputs"`
	Drift            []*Change             `json:"drift"`
	Options          map[string]any        `json:"options,omitempty"`
	ProviderRegions  map[string]string     `json:"providerRegions,omitempty"`
}

type rawChange struct {
	Address       string `json:"address"`
	PrevAddress   string `json:"previous_address"`
	ModuleAddress string `json:"module_address"`
	Mode          string `json:"mode"`
	Type          string `json:"type"`
	Name          string `json:"name"`
	Index         any    `json:"index"`
	ProviderName  string `json:"provider_name"`
	ActionReason  string `json:"action_reason"`
	Change        struct {
		Actions         []string        `json:"actions"`
		Before          json.RawMessage `json:"before"`
		After           json.RawMessage `json:"after"`
		AfterUnknown    json.RawMessage `json:"after_unknown"`
		BeforeSensitive json.RawMessage `json:"before_sensitive"`
		AfterSensitive  json.RawMessage `json:"after_sensitive"`
		ReplacePaths    [][]any         `json:"replace_paths"`
		Importing       json.RawMessage `json:"importing"`
	} `json:"change"`
}

type rawPlan struct {
	TerraformVersion string                     `json:"terraform_version"`
	Errored          bool                       `json:"errored"`
	ResourceChanges  []rawChange                `json:"resource_changes"`
	ResourceDrift    []rawChange                `json:"resource_drift"`
	OutputChanges    map[string]json.RawMessage `json:"output_changes"`
	Variables        map[string]struct {
		Value json.RawMessage `json:"value"`
	} `json:"variables"`
	Configuration struct {
		ProviderConfig map[string]struct {
			Name        string `json:"name"`
			Alias       string `json:"alias"`
			Expressions struct {
				Region *struct {
					ConstantValue json.RawMessage `json:"constant_value"`
					References    []string        `json:"references"`
				} `json:"region"`
			} `json:"expressions"`
		} `json:"provider_config"`
	} `json:"configuration"`
}

// providerRegions maps root provider config keys ("aws", "aws.us_east_1") to
// the region they resolved to, when it is a constant or a plain variable.
func providerRegions(raw *rawPlan) map[string]string {
	out := map[string]string{}
	for key, pc := range raw.Configuration.ProviderConfig {
		r := pc.Expressions.Region
		if r == nil || strings.Contains(key, ":") {
			continue
		}
		var s string
		if len(r.ConstantValue) > 0 {
			_ = json.Unmarshal(r.ConstantValue, &s)
		} else if len(r.References) == 1 {
			if name, ok := strings.CutPrefix(r.References[0], "var."); ok {
				_ = json.Unmarshal(raw.Variables[name].Value, &s)
			}
		}
		if s != "" {
			out[key] = s
		}
	}
	return out
}

func Action(actions []string) string {
	switch {
	case len(actions) == 2:
		return "replace"
	case len(actions) == 1:
		return actions[0]
	}
	return "no-op"
}

// Parse converts the JSON plan representation.
func Parse(data []byte, stack string) (*Result, error) {
	var raw rawPlan
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	if err := dec.Decode(&raw); err != nil {
		return nil, fmt.Errorf("parse plan json: %w", err)
	}
	res := &Result{
		Stack:            stack,
		CreatedAt:        time.Now(),
		TerraformVersion: raw.TerraformVersion,
		Errored:          raw.Errored,
		Changes:          []*Change{},
		Nodes:            map[string]NodeChange{},
		Outputs:          []OutputChange{},
		Drift:            []*Change{},
		ProviderRegions:  providerRegions(&raw),
	}
	for _, rc := range raw.ResourceChanges {
		c := convert(rc)
		res.Changes = append(res.Changes, c)
		switch c.Action {
		case "create":
			res.Summary.Create++
		case "update":
			res.Summary.Update++
		case "delete":
			res.Summary.Delete++
		case "replace":
			res.Summary.Replace++
		case "read":
			res.Summary.Read++
		case "forget":
			res.Summary.Forget++
		default:
			res.Summary.NoOp++
		}
		nc := res.Nodes[c.ConfigAddress]
		if nc.Counts == nil {
			nc.Counts = map[string]int{}
		}
		nc.Instances++
		nc.Counts[c.Action]++
		nc.Action = aggregate(nc.Counts)
		res.Nodes[c.ConfigAddress] = nc
	}
	for _, rc := range raw.ResourceDrift {
		res.Drift = append(res.Drift, convert(rc))
	}
	res.Summary.Drift = len(res.Drift)

	names := make([]string, 0, len(raw.OutputChanges))
	for n := range raw.OutputChanges {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		var oc struct {
			Actions         []string        `json:"actions"`
			Before          json.RawMessage `json:"before"`
			After           json.RawMessage `json:"after"`
			AfterUnknown    json.RawMessage `json:"after_unknown"`
			BeforeSensitive json.RawMessage `json:"before_sensitive"`
			AfterSensitive  json.RawMessage `json:"after_sensitive"`
		}
		if json.Unmarshal(raw.OutputChanges[n], &oc) != nil {
			continue
		}
		res.Outputs = append(res.Outputs, OutputChange{
			Name:      n,
			Action:    Action(oc.Actions),
			Before:    nullToNil(oc.Before),
			After:     nullToNil(oc.After),
			Unknown:   string(oc.AfterUnknown) == "true",
			Sensitive: string(oc.AfterSensitive) == "true" || string(oc.BeforeSensitive) == "true",
		})
	}
	return res, nil
}

func aggregate(counts map[string]int) string {
	var acts []string
	for a, n := range counts {
		if n > 0 && a != "no-op" {
			acts = append(acts, a)
		}
	}
	switch len(acts) {
	case 0:
		return "no-op"
	case 1:
		return acts[0]
	}
	return "mixed"
}

func nullToNil(r json.RawMessage) json.RawMessage {
	if len(r) == 0 || string(r) == "null" {
		return nil
	}
	return r
}

func convert(rc rawChange) *Change {
	c := &Change{
		Address:      rc.Address,
		Module:       StripIndices(rc.ModuleAddress),
		Mode:         rc.Mode,
		Type:         rc.Type,
		Name:         rc.Name,
		Provider:     rc.ProviderName,
		Actions:      rc.Change.Actions,
		Action:       Action(rc.Change.Actions),
		ActionReason: rc.ActionReason,
		Imported:     len(rc.Change.Importing) > 0 && string(rc.Change.Importing) != "null",
		MovedFrom:    rc.PrevAddress,
	}
	if c.Actions == nil {
		c.Actions = []string{}
	}
	switch idx := rc.Index.(type) {
	case nil:
	case string:
		c.Index = strconv.Quote(idx)
	default:
		c.Index = fmt.Sprint(idx)
	}
	local := rc.Type + "." + rc.Name
	if rc.Mode == "data" {
		local = "data." + local
	}
	if c.Module != "" {
		c.ConfigAddress = c.Module + "." + local
	} else {
		c.ConfigAddress = local
	}
	c.Attrs = diffAttrs(rc)
	return c
}

// StripIndices turns `module.a[0].module.b["x"]` into `module.a.module.b`.
func StripIndices(addr string) string {
	var b strings.Builder
	depth := 0
	inStr := false
	for i := 0; i < len(addr); i++ {
		ch := addr[i]
		switch {
		case inStr:
			if ch == '\\' {
				i++
			} else if ch == '"' {
				inStr = false
			}
		case ch == '"' && depth > 0:
			inStr = true
		case ch == '[':
			depth++
		case ch == ']':
			depth--
		case depth == 0:
			b.WriteByte(ch)
		}
	}
	return b.String()
}

const maxDiffDepth = 8

func decode(r json.RawMessage) any {
	if len(r) == 0 {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(r))
	dec.UseNumber()
	var v any
	if dec.Decode(&v) != nil {
		return nil
	}
	return v
}

func diffAttrs(rc rawChange) []AttrChange {
	before := decode(rc.Change.Before)
	after := decode(rc.Change.After)
	unknown := decode(rc.Change.AfterUnknown)
	sens := mergeSensitive(decode(rc.Change.BeforeSensitive), decode(rc.Change.AfterSensitive))

	replace := map[string]bool{}
	for _, p := range rc.Change.ReplacePaths {
		replace[pathString(p)] = true
	}

	var out []AttrChange
	var walk func(path string, b, a, u, s any, depth int)
	walk = func(path string, b, a, u, s any, depth int) {
		if s == true {
			if !jsonEqual(b, a) || u == true {
				out = append(out, AttrChange{Path: path, Sensitive: true, AfterUnknown: u == true, ForcesReplace: forces(replace, path)})
			}
			return
		}
		if u == true {
			out = append(out, AttrChange{Path: path, Before: encode(b), AfterUnknown: true, ForcesReplace: forces(replace, path)})
			return
		}
		bm, bIsMap := b.(map[string]any)
		am, aIsMap := a.(map[string]any)
		um, _ := u.(map[string]any)
		sm, _ := s.(map[string]any)
		if depth < maxDiffDepth && (bIsMap || aIsMap) && (b == nil || bIsMap) && (a == nil || aIsMap) {
			keys := map[string]bool{}
			for k := range bm {
				keys[k] = true
			}
			for k := range am {
				keys[k] = true
			}
			for k := range um {
				keys[k] = true
			}
			sorted := make([]string, 0, len(keys))
			for k := range keys {
				sorted = append(sorted, k)
			}
			sort.Strings(sorted)
			for _, k := range sorted {
				walk(joinPath(path, k), bm[k], am[k], um[k], sm[k], depth+1)
			}
			return
		}
		bl, bIsList := b.([]any)
		al, aIsList := a.([]any)
		ul, _ := u.([]any)
		sl, _ := s.([]any)
		if depth < maxDiffDepth && (bIsList || aIsList) && (b == nil || bIsList) && (a == nil || aIsList) && hasObjects(bl, al) {
			n := max(len(bl), len(al), len(ul))
			for i := 0; i < n; i++ {
				walk(fmt.Sprintf("%s[%d]", path, i), at(bl, i), at(al, i), at(ul, i), at(sl, i), depth+1)
			}
			return
		}
		if jsonEqual(b, a) || (isEmpty(b) && isEmpty(a)) {
			return
		}
		out = append(out, AttrChange{Path: path, Before: encode(b), After: encode(a), ForcesReplace: forces(replace, path)})
	}
	walk("", before, after, unknown, sens, 0)
	if out == nil {
		out = []AttrChange{}
	}
	return out
}

func hasObjects(lists ...[]any) bool {
	for _, l := range lists {
		for _, v := range l {
			if _, ok := v.(map[string]any); ok {
				return true
			}
		}
	}
	return false
}

func isEmpty(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case []any:
		return len(x) == 0
	case map[string]any:
		return len(x) == 0
	}
	return false
}

func at(l []any, i int) any {
	if i < len(l) {
		return l[i]
	}
	return nil
}

func joinPath(base, k string) string {
	if base == "" {
		return k
	}
	return base + "." + k
}

func pathString(p []any) string {
	var s string
	for _, step := range p {
		switch x := step.(type) {
		case string:
			s = joinPath(s, x)
		default:
			s = fmt.Sprintf("%s[%v]", s, x)
		}
	}
	return s
}

func forces(replace map[string]bool, path string) bool {
	for p := range replace {
		if path == p || strings.HasPrefix(path, p+".") || strings.HasPrefix(path, p+"[") {
			return true
		}
	}
	return false
}

func mergeSensitive(a, b any) any {
	if a == true || b == true {
		return true
	}
	am, aok := a.(map[string]any)
	bm, bok := b.(map[string]any)
	if aok || bok {
		out := map[string]any{}
		for k, v := range am {
			out[k] = v
		}
		for k, v := range bm {
			out[k] = mergeSensitive(out[k], v)
		}
		return out
	}
	al, aok := a.([]any)
	bl, bok := b.([]any)
	if aok || bok {
		n := max(len(al), len(bl))
		out := make([]any, n)
		for i := range out {
			out[i] = mergeSensitive(at(al, i), at(bl, i))
		}
		return out
	}
	return nil
}

func encode(v any) json.RawMessage {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}

func jsonEqual(a, b any) bool {
	return bytes.Equal(encode(a), encode(b))
}
