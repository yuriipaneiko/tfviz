package scan

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

type c3xCaveat struct {
	Code   string `json:"code"`
	Detail string `json:"detail"`
}

type c3xLine struct {
	Dimension   string      `json:"dimension"`
	Description string      `json:"description"`
	Unit        string      `json:"unit"`
	Quantity    decimal     `json:"quantity"`
	UnitRate    decimal     `json:"unit_rate"`
	MonthlyCost decimal     `json:"monthly_cost"`
	PriceSource string      `json:"price_source"`
	Caveats     []c3xCaveat `json:"caveats"`
}

type c3xCost struct {
	Resource        string      `json:"resource"`
	Kind            string      `json:"kind"`
	Name            string      `json:"name"`
	LineItems       []c3xLine   `json:"line_items"`
	MonthlySubtotal decimal     `json:"monthly_subtotal"`
	Currency        string      `json:"currency"`
	Caveats         []c3xCaveat `json:"caveats"`
}

type c3xEstimate struct {
	Costs        []c3xCost `json:"costs"`
	ProjectTotal decimal   `json:"project_total"`
	Currency     string    `json:"currency"`
	GeneratedAt  string    `json:"generated_at"`
	CaveatCount  int       `json:"caveat_count"`
}

func ParseC3X(data []byte, stack, source string, stripIndices func(string) string) (*CostReport, error) {
	var out c3xEstimate
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("parse c3x output: %w", err)
	}
	rep := &CostReport{
		Stack: stack, Source: source, Currency: out.Currency, CreatedAt: time.Now(),
		Resources: []*CostResource{}, Nodes: map[string]NodeCost{},
		TotalMonthly: out.ProjectTotal.f(), Caveats: out.CaveatCount,
	}
	if rep.Currency == "" {
		rep.Currency = "USD"
	}
	if ts, err := time.Parse(time.RFC3339, out.GeneratedAt); err == nil {
		rep.CreatedAt = ts
	}

	for _, r := range out.Costs {
		addr := r.Resource
		if addr == "" && r.Kind != "" {
			addr = r.Kind + "." + r.Name
		}
		codes := caveatCodes(r.Caveats)
		var comps []CostComponent
		usage := false
		for _, li := range r.LineItems {
			name := li.Description
			if name == "" {
				name = li.Dimension
			}
			ub := hasCode(li.Caveats, "usage_not_provided")
			if ub {
				usage = true
			}
			codes = append(codes, caveatCodes(li.Caveats)...)
			comps = append(comps, CostComponent{
				Name: name, Unit: li.Unit, MonthlyQuantity: li.Quantity.v,
				Price: li.UnitRate.v, MonthlyCost: li.MonthlyCost.v, UsageBased: ub,
			})
		}
		if comps == nil {
			comps = []CostComponent{}
		}
		if hasCode(r.Caveats, "usage_not_provided") {
			usage = true
		}
		cr := &CostResource{
			Address: addr, ConfigAddress: stripIndices(addr), Type: r.Kind,
			MonthlyCost: r.MonthlySubtotal.v, Components: comps, Caveats: uniqueStrings(codes),
		}
		rep.Resources = append(rep.Resources, cr)
		nc := rep.Nodes[cr.ConfigAddress]
		nc.Instances++
		if cr.MonthlyCost != nil {
			nc.MonthlyCost += *cr.MonthlyCost
		}
		if usage {
			nc.UsageBased = true
		}
		rep.Nodes[cr.ConfigAddress] = nc

		switch {
		case hasStr(cr.Caveats, "no_price"):
			rep.NoPrice++
		case cr.MonthlyCost != nil && *cr.MonthlyCost > 0:
			rep.Supported++
		default:
			rep.Unsupported++
		}
	}
	sort.SliceStable(rep.Resources, func(i, j int) bool {
		a, b := rep.Resources[i].MonthlyCost, rep.Resources[j].MonthlyCost
		if a == nil || b == nil {
			return a != nil
		}
		return *a > *b
	})
	return rep, nil
}

func caveatCodes(cs []c3xCaveat) []string {
	var out []string
	for _, c := range cs {
		if c.Code != "" {
			out = append(out, c.Code)
		}
	}
	return out
}

func hasCode(cs []c3xCaveat, code string) bool {
	for _, c := range cs {
		if c.Code == code {
			return true
		}
	}
	return false
}

func hasStr(ss []string, v string) bool {
	for _, s := range ss {
		if s == v {
			return true
		}
	}
	return false
}

func uniqueStrings(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
