package plan

import (
	"encoding/json"
	"testing"
)

const fixture = `{
  "format_version": "1.2",
  "terraform_version": "1.9.0",
  "variables": {"region": {"value": "eu-central-1"}},
  "configuration": {
    "provider_config": {
      "aws": {"name": "aws", "expressions": {"region": {"references": ["var.region"]}}},
      "aws.us_east_1": {"name": "aws", "alias": "us_east_1", "expressions": {"region": {"constant_value": "us-east-1"}}},
      "module.app:aws": {"name": "aws", "expressions": {"region": {"constant_value": "ignored"}}}
    }
  },
  "resource_changes": [
    {
      "address": "aws_instance.web",
      "mode": "managed", "type": "aws_instance", "name": "web",
      "provider_name": "registry.terraform.io/hashicorp/aws",
      "change": {
        "actions": ["update"],
        "before": {"instance_type": "t3.micro", "tags": {"Name": "web", "Env": "dev"}, "password": "a"},
        "after":  {"instance_type": "t3.small", "tags": {"Name": "web"}, "password": "b"},
        "after_unknown": {"tags": {}},
        "before_sensitive": {"password": true},
        "after_sensitive": {"password": true}
      }
    },
    {
      "address": "module.db[0].aws_db_instance.this",
      "module_address": "module.db[0]",
      "mode": "managed", "type": "aws_db_instance", "name": "this",
      "provider_name": "registry.terraform.io/hashicorp/aws",
      "action_reason": "replace_because_cannot_update",
      "change": {
        "actions": ["delete", "create"],
        "before": {"engine": "postgres", "id": "db-1"},
        "after":  {"engine": "mysql"},
        "after_unknown": {"id": true},
        "replace_paths": [["engine"]]
      }
    },
    {
      "address": "aws_subnet.private[\"a\"]",
      "index": "a",
      "mode": "managed", "type": "aws_subnet", "name": "private",
      "provider_name": "registry.terraform.io/hashicorp/aws",
      "change": {"actions": ["delete"], "before": {"cidr_block": "10.0.1.0/24"}, "after": null}
    },
    {
      "address": "aws_subnet.private[\"b\"]",
      "index": "b",
      "mode": "managed", "type": "aws_subnet", "name": "private",
      "provider_name": "registry.terraform.io/hashicorp/aws",
      "change": {"actions": ["no-op"], "before": {"cidr_block": "10.0.2.0/24"}, "after": {"cidr_block": "10.0.2.0/24"}}
    },
    {
      "address": "aws_subnet.private[\"c\"]",
      "index": "c",
      "mode": "managed", "type": "aws_subnet", "name": "private",
      "provider_name": "registry.terraform.io/hashicorp/aws",
      "change": {"actions": ["create"], "before": null, "after": {"cidr_block": "10.0.3.0/24"}, "after_unknown": {"id": true}}
    }
  ],
  "output_changes": {
    "secret": {"actions": ["update"], "before": "x", "after": "y", "after_sensitive": true}
  }
}`

func attr(c *Change, path string) *AttrChange {
	for i := range c.Attrs {
		if c.Attrs[i].Path == path {
			return &c.Attrs[i]
		}
	}
	return nil
}

func TestParse(t *testing.T) {
	res, err := Parse([]byte(fixture), "envs/dev")
	if err != nil {
		t.Fatal(err)
	}
	sm := res.Summary
	if sm.Update != 1 || sm.Replace != 1 || sm.Delete != 1 || sm.Create != 1 || sm.NoOp != 1 {
		t.Fatalf("summary = %+v", sm)
	}

	web := res.Changes[0]
	if a := attr(web, "instance_type"); a == nil || string(a.Before) != `"t3.micro"` || string(a.After) != `"t3.small"` {
		t.Errorf("instance_type diff = %+v", a)
	}
	if a := attr(web, "tags.Env"); a == nil || string(a.Before) != `"dev"` || a.After != nil {
		t.Errorf("tags.Env removal = %+v", a)
	}
	if attr(web, "tags.Name") != nil {
		t.Error("unchanged tags.Name reported as a change")
	}
	if a := attr(web, "password"); a == nil || !a.Sensitive || a.Before != nil || a.After != nil {
		t.Errorf("sensitive value leaked or missing: %+v", a)
	}

	db := res.Changes[1]
	if db.ConfigAddress != "module.db.aws_db_instance.this" || db.Action != "replace" {
		t.Errorf("db = %s %s", db.ConfigAddress, db.Action)
	}
	if a := attr(db, "engine"); a == nil || !a.ForcesReplace {
		t.Errorf("engine should force replacement: %+v", a)
	}
	if a := attr(db, "id"); a == nil || !a.AfterUnknown {
		t.Errorf("id should be unknown after apply: %+v", a)
	}

	if got := res.Changes[2].Index; got != `"a"` {
		t.Errorf("index = %s", got)
	}
	nc := res.Nodes["aws_subnet.private"]
	if nc.Instances != 3 || nc.Action != "mixed" || nc.Counts["delete"] != 1 || nc.Counts["create"] != 1 {
		t.Errorf("subnet aggregate = %+v", nc)
	}

	if len(res.Outputs) != 1 || !res.Outputs[0].Sensitive {
		t.Errorf("outputs = %+v", res.Outputs)
	}

	want := map[string]string{"aws": "eu-central-1", "aws.us_east_1": "us-east-1"}
	got, _ := json.Marshal(res.ProviderRegions)
	exp, _ := json.Marshal(want)
	if string(got) != string(exp) {
		t.Errorf("provider regions = %s, want %s", got, exp)
	}
}

func TestStripIndices(t *testing.T) {
	cases := map[string]string{
		`module.a[0].module.b["x"].aws_s3_bucket.c[2]`: "module.a.module.b.aws_s3_bucket.c",
		`aws_s3_bucket.b["we]ird\"key"]`:               "aws_s3_bucket.b",
		`module.vpc`:                                   "module.vpc",
	}
	for in, want := range cases {
		if got := StripIndices(in); got != want {
			t.Errorf("StripIndices(%q) = %q, want %q", in, got, want)
		}
	}
}
