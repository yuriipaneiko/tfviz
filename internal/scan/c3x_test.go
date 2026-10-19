package scan

import (
	"testing"

	"github.com/yuriipaneiko/tf-visualise/internal/plan"
)

const c3xFixture = `{
  "costs": [
    {
      "resource": "module.app.aws_db_instance.this[0]",
      "kind": "aws_db_instance",
      "name": "this",
      "line_items": [
        {
          "dimension": "instance",
          "description": "Database instance (on-demand, db.t3.micro)",
          "unit": "hours",
          "quantity": "730",
          "unit_rate": "0.017",
          "monthly_cost": "12.41"
        },
        {
          "dimension": "storage",
          "description": "Storage (gp3)",
          "unit": "GB",
          "quantity": "20",
          "unit_rate": "0.08",
          "monthly_cost": "1.60"
        }
      ],
      "monthly_subtotal": "14.01",
      "currency": "USD"
    },
    {
      "resource": "aws_nat_gateway.this",
      "kind": "aws_nat_gateway",
      "name": "this",
      "line_items": [
        {
          "dimension": "hours",
          "description": "NAT gateway",
          "unit": "hours",
          "quantity": "730",
          "unit_rate": "0.045",
          "monthly_cost": "32.85"
        },
        {
          "dimension": "data",
          "description": "Data processed",
          "unit": "GB",
          "quantity": "0",
          "unit_rate": "0.045",
          "monthly_cost": "0",
          "caveats": [{"code": "usage_not_provided", "detail": "no usage file"}]
        }
      ],
      "monthly_subtotal": "32.85",
      "currency": "USD"
    },
    {
      "resource": "aws_instance.odd",
      "kind": "aws_instance",
      "name": "odd",
      "line_items": [],
      "monthly_subtotal": "0",
      "currency": "USD",
      "caveats": [{"code": "no_price", "detail": "no match"}]
    }
  ],
  "project_total": "46.86",
  "currency": "USD",
  "generated_at": "2026-10-18T18:00:00Z",
  "caveat_count": 2
}`

func TestParseC3X(t *testing.T) {
	rep, err := ParseC3X([]byte(c3xFixture), "envs/dev", "plan", plan.StripIndices)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Currency != "USD" || rep.TotalMonthly < 46.8 || rep.TotalMonthly > 46.9 {
		t.Fatalf("total = %v %s", rep.TotalMonthly, rep.Currency)
	}
	if rep.Supported != 2 || rep.NoPrice != 1 || rep.Caveats != 2 {
		t.Fatalf("counts supported=%d noPrice=%d caveats=%d", rep.Supported, rep.NoPrice, rep.Caveats)
	}
	if len(rep.Resources) != 3 {
		t.Fatalf("resources = %d", len(rep.Resources))
	}
	nat := rep.Resources[0]
	if nat.Address != "aws_nat_gateway.this" || nat.MonthlyCost == nil || *nat.MonthlyCost < 32.8 || *nat.MonthlyCost > 32.9 {
		t.Errorf("sorted first = %+v", nat)
	}
	if !rep.Nodes["aws_nat_gateway.this"].UsageBased {
		t.Error("NAT should be usage-based")
	}
	db := rep.Nodes["module.app.aws_db_instance.this"]
	if db.Instances != 1 || db.MonthlyCost < 14 {
		t.Errorf("stripped db node = %+v", db)
	}
	if got := rep.Resources[1].ConfigAddress; got != "module.app.aws_db_instance.this" {
		t.Errorf("config address = %s", got)
	}
}
