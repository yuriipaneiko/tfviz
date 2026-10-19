package graph

import (
	"path/filepath"
	"testing"

	"github.com/yuriipaneiko/tf-visualise/internal/config"
)

func load(t *testing.T, stack string) *Graph {
	t.Helper()
	project, _ := filepath.Abs("../../examples/aws-monorepo")
	root, err := config.LoadRoot(filepath.Join(project, stack))
	if err != nil {
		t.Fatal(err)
	}
	return Build(root, stack, project)
}

func node(t *testing.T, g *Graph, id string) *Node {
	t.Helper()
	for _, n := range g.Nodes {
		if n.ID == id {
			return n
		}
	}
	t.Fatalf("node %s not found", id)
	return nil
}

func parentOf(n *Node) string {
	if n.Network == nil {
		return ""
	}
	return n.Network.Parent
}

func hasEdge(g *Graph, src, dst string) bool {
	for _, e := range g.Edges {
		if e.Source == src && e.Target == dst {
			return true
		}
	}
	return false
}

func TestDevNetworkPlacement(t *testing.T) {
	g := load(t, "envs/dev")

	cases := map[string]string{
		"module.network.aws_subnet.private":     "module.network.aws_vpc.this",
		"module.network.aws_nat_gateway.this":   "module.network.aws_subnet.public",
		"module.app.aws_lb.this":                "module.network.aws_subnet.public",
		"module.app.aws_ecs_service.web":        "module.network.aws_subnet.private",
		"module.app.aws_lambda_function.worker": "module.network.aws_subnet.private",
		"module.app.aws_db_instance.this":       "module.network.aws_subnet.private",
		"module.app.aws_security_group.alb":     "module.network.aws_vpc.this",
		"module.app.aws_s3_bucket.uploads":      "",
	}
	for id, want := range cases {
		if got := parentOf(node(t, g, id)); got != want {
			t.Errorf("%s: parent = %q, want %q", id, got, want)
		}
	}
	if r := node(t, g, "module.network.aws_vpc.this").Network; r == nil || r.Role != "vpc" {
		t.Errorf("vpc role not set")
	}
}

func TestCrossModuleEdges(t *testing.T) {
	g := load(t, "envs/dev")
	if !hasEdge(g, "module.network.aws_flow_log.this", "aws_s3_bucket.logs") {
		t.Error("expected flow log -> root logs bucket edge through module variable")
	}
	if !hasEdge(g, "aws_cloudfront_distribution.site", "module.app.aws_lb.this") {
		t.Error("expected cloudfront -> alb edge through module output")
	}
	if !hasEdge(g, "module.app.aws_ecs_task_definition.web", "module.app.aws_db_instance.this") {
		t.Error("expected task definition -> db edge through jsonencode")
	}
}

func TestFolding(t *testing.T) {
	g := load(t, "envs/dev")
	cases := map[string]string{
		"module.app.aws_s3_bucket_versioning.uploads":          "module.app.aws_s3_bucket.uploads",
		"module.app.aws_iam_role_policy_attachment.worker_vpc": "module.app.aws_iam_role.worker",
		"module.app.aws_lb_listener.https":                     "module.app.aws_lb.this",
		"module.network.aws_route.private_nat":                 "module.network.aws_route_table.private",
		"module.app.aws_db_subnet_group.this":                  "module.app.aws_db_instance.this",
		"module.app.data.aws_iam_policy_document.ecs_assume":   "module.app.aws_iam_role.task_execution",
	}
	for id, want := range cases {
		if got := node(t, g, id).FoldInto; got != want {
			t.Errorf("%s: foldInto = %q, want %q", id, got, want)
		}
	}
}

func TestUnexpandedModuleContainers(t *testing.T) {
	g := load(t, "envs/prod")
	vpc := node(t, g, "module.vpc")
	if vpc.Kind != "module" || vpc.Network == nil || vpc.Network.Role != "vpc" {
		t.Fatalf("module.vpc should be an unexpanded VPC container, got %+v", vpc.Network)
	}
	if got := parentOf(node(t, g, "aws_instance.bastion")); got != "module.vpc/public_subnets" {
		t.Errorf("bastion parent = %q", got)
	}
	if got := parentOf(node(t, g, "module.app.aws_ecs_service.web")); got != "module.vpc/private_subnets" {
		t.Errorf("ecs service parent = %q", got)
	}
	if got := parentOf(node(t, g, "aws_security_group.bastion")); got != "module.vpc" {
		t.Errorf("bastion sg parent = %q", got)
	}
	if n := node(t, g, "cloudflare_record.api"); n.Provider != "cloudflare" {
		t.Errorf("provider = %q", n.Provider)
	}
	if n := node(t, g, "aws_wafv2_web_acl.api"); n.ProviderConfig != "aws.us_east_1" {
		t.Errorf("provider config = %q", n.ProviderConfig)
	}
}

func TestDiscover(t *testing.T) {
	stacks, err := config.Discover("../../examples/aws-monorepo")
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]string{}
	for _, s := range stacks {
		kinds[s.ID] = s.Kind
	}
	want := map[string]string{"envs/dev": "root", "envs/prod": "root", "modules/network": "module", "modules/web-app": "module"}
	for id, k := range want {
		if kinds[id] != k {
			t.Errorf("%s: kind = %q, want %q", id, kinds[id], k)
		}
	}
}
