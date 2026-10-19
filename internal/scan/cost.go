package scan

import (
	"encoding/json"
	"strconv"
	"time"
)

type CostComponent struct {
	Name            string   `json:"name"`
	Unit            string   `json:"unit"`
	MonthlyQuantity *float64 `json:"monthlyQuantity,omitempty"`
	Price           *float64 `json:"price,omitempty"`
	MonthlyCost     *float64 `json:"monthlyCost,omitempty"`
	UsageBased      bool     `json:"usageBased,omitempty"`
}

type CostResource struct {
	Address       string          `json:"address"`
	ConfigAddress string          `json:"configAddress"`
	Type          string          `json:"type"`
	MonthlyCost   *float64        `json:"monthlyCost"`
	Components    []CostComponent `json:"components"`
	Caveats       []string        `json:"caveats,omitempty"`
}

type NodeCost struct {
	MonthlyCost float64 `json:"monthlyCost"`
	Instances   int     `json:"instances"`
	UsageBased  bool    `json:"usageBased"`
}

type CostReport struct {
	Stack        string              `json:"stack"`
	Source       string              `json:"source"` // plan | hcl
	Currency     string              `json:"currency"`
	CreatedAt    time.Time           `json:"createdAt"`
	TotalMonthly float64             `json:"totalMonthly"`
	Resources    []*CostResource     `json:"resources"`
	Nodes        map[string]NodeCost `json:"nodes"`
	Supported    int                 `json:"supported"`
	Unsupported  int                 `json:"unsupported"`
	NoPrice      int                 `json:"noPrice"`
	Caveats      int                 `json:"caveats,omitempty"`
}

// decimal accepts JSON numbers or decimal strings (C3X uses strings).
type decimal struct{ v *float64 }

func (d *decimal) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			d.v = &f
		}
		return nil
	}
	var f *float64
	if err := json.Unmarshal(b, &f); err != nil {
		return nil
	}
	d.v = f
	return nil
}

func (d decimal) f() float64 {
	if d.v == nil {
		return 0
	}
	return *d.v
}
