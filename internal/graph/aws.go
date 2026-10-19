package graph

import (
	"sort"
	"strings"
)

var vpcTypes = map[string]bool{"aws_vpc": true, "aws_default_vpc": true}
var subnetTypes = map[string]bool{"aws_subnet": true, "aws_default_subnet": true}

func lastSeg(path string) string {
	if i := strings.LastIndex(path, "."); i >= 0 {
		return path[i+1:]
	}
	return path
}

func isSubnetAttr(path string) bool {
	l := lastSeg(path)
	return strings.Contains(l, "subnet") || l == "vpc_zone_identifier"
}

func isVPCAttr(path string) bool {
	return lastSeg(path) == "vpc_id"
}

func isSGAttr(path string) bool {
	l := lastSeg(path)
	return l == "security_groups" || l == "vpc_security_group_ids" || l == "security_group_ids" || l == "security_group_id"
}

func (b *builder) targetsWhere(id string, pred func(string) bool) []target {
	var out []target
	for _, at := range b.attrs[id] {
		if pred(at.path) {
			out = append(out, at.targets...)
		}
	}
	return dedupeTargets(out)
}

// syntheticSubnet creates a "subnet" container inside an unexpanded module (e.g.
// terraform-aws-modules/vpc) for each subnet-like output that is referenced.
func (b *builder) syntheticSubnet(moduleID, output string, synth map[string]*Container) string {
	b.markModuleVPC(moduleID)
	id := moduleID + "/" + output
	if _, ok := synth[id]; !ok {
		c := &Container{ID: id, Label: output, Kind: "subnet", Parent: moduleID}
		synth[id] = c
		b.g.Containers = append(b.g.Containers, c)
	}
	return id
}

func (b *builder) markModuleVPC(moduleID string) {
	if n := b.nodes[moduleID]; n != nil && n.Kind == "module" {
		if n.Network == nil {
			n.Network = &Network{}
		}
		n.Network.Role = "vpc"
	}
}

func (b *builder) vpcOf(id string) string {
	for _, t := range b.targetsWhere(id, isVPCAttr) {
		n := b.nodes[t.id]
		if n == nil {
			continue
		}
		if vpcTypes[n.Type] {
			return n.ID
		}
		if n.Kind == "module" {
			b.markModuleVPC(n.ID)
			return n.ID
		}
	}
	return ""
}

func (b *builder) subnetsOf(id string, depth int, synth map[string]*Container) []string {
	var out []string
	for _, t := range b.targetsWhere(id, isSubnetAttr) {
		n := b.nodes[t.id]
		if n == nil || t.id == id {
			continue
		}
		switch {
		case subnetTypes[n.Type]:
			out = append(out, n.ID)
		case n.Kind == "module" && t.output != "":
			out = append(out, b.syntheticSubnet(n.ID, t.output, synth))
		case depth == 0 && strings.HasSuffix(n.Type, "_subnet_group"):
			out = append(out, b.subnetsOf(n.ID, 1, synth)...)
		}
	}
	return uniqStrings(out)
}

func uniqStrings(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func (b *builder) containerParent(id string, synth map[string]*Container) string {
	if c, ok := synth[id]; ok {
		return c.Parent
	}
	if n := b.nodes[id]; n != nil && n.Network != nil {
		return n.Network.Parent
	}
	return ""
}

func (b *builder) computeNetwork() {
	synth := map[string]*Container{}
	for _, n := range b.g.Nodes {
		if n.Kind == "resource" && vpcTypes[n.Type] {
			n.Network = &Network{Role: "vpc"}
		}
	}
	for _, n := range b.g.Nodes {
		if n.Kind == "resource" && subnetTypes[n.Type] {
			n.Network = &Network{Role: "subnet", Parent: b.vpcOf(n.ID)}
		}
	}
	for _, n := range b.g.Nodes {
		if n.Kind != "resource" || n.Provider != "aws" || vpcTypes[n.Type] || subnetTypes[n.Type] {
			continue
		}
		place := func(parent string, spans []string) {
			if parent == "" {
				return
			}
			n.Network = &Network{Parent: parent, Spans: spans}
		}
		subnets := b.subnetsOf(n.ID, 0, synth)
		switch {
		case len(subnets) == 1:
			place(subnets[0], nil)
			continue
		case len(subnets) > 1:
			vpcs := map[string]bool{}
			for _, s := range subnets {
				vpcs[b.containerParent(s, synth)] = true
			}
			if len(vpcs) == 1 {
				for v := range vpcs {
					sort.Strings(subnets)
					place(v, subnets)
				}
			}
			continue
		}
		if v := b.vpcOf(n.ID); v != "" {
			place(v, nil)
			continue
		}
		for _, t := range b.targetsWhere(n.ID, isSGAttr) {
			if sg := b.nodes[t.id]; sg != nil && sg.Type == "aws_security_group" {
				if v := b.vpcOf(sg.ID); v != "" {
					place(v, nil)
					break
				}
			}
		}
	}
}

// foldForward lists helper resource types that are drawn inside the resource
// they configure, found through the given attribute.
var foldForward = map[string][]string{
	"aws_iam_role_policy_attachment":          {"role"},
	"aws_iam_role_policy":                     {"role"},
	"aws_iam_role_policies_exclusive":         {"role_name"},
	"aws_iam_user_policy_attachment":          {"user"},
	"aws_iam_user_policy":                     {"user"},
	"aws_iam_group_policy_attachment":         {"group"},
	"aws_iam_group_policy":                    {"group"},
	"aws_iam_group_membership":                {"group"},
	"aws_iam_access_key":                      {"user"},
	"aws_route":                               {"route_table_id"},
	"aws_route_table_association":             {"route_table_id"},
	"aws_main_route_table_association":        {"route_table_id"},
	"aws_security_group_rule":                 {"security_group_id"},
	"aws_vpc_security_group_ingress_rule":     {"security_group_id"},
	"aws_vpc_security_group_egress_rule":      {"security_group_id"},
	"aws_network_acl_rule":                    {"network_acl_id"},
	"aws_network_acl_association":             {"network_acl_id"},
	"aws_lb_listener":                         {"load_balancer_arn"},
	"aws_alb_listener":                        {"load_balancer_arn"},
	"aws_lb_listener_rule":                    {"listener_arn"},
	"aws_alb_listener_rule":                   {"listener_arn"},
	"aws_lb_listener_certificate":             {"listener_arn"},
	"aws_lb_target_group_attachment":          {"target_group_arn"},
	"aws_alb_target_group_attachment":         {"target_group_arn"},
	"aws_lambda_permission":                   {"function_name"},
	"aws_lambda_alias":                        {"function_name"},
	"aws_lambda_function_url":                 {"function_name"},
	"aws_lambda_event_source_mapping":         {"function_name"},
	"aws_lambda_function_event_invoke_config": {"function_name"},
	"aws_sns_topic_subscription":              {"topic_arn"},
	"aws_sns_topic_policy":                    {"arn"},
	"aws_sqs_queue_policy":                    {"queue_url"},
	"aws_sqs_queue_redrive_policy":            {"queue_url"},
	"aws_sqs_queue_redrive_allow_policy":      {"queue_url"},
	"aws_ecr_lifecycle_policy":                {"repository"},
	"aws_ecr_repository_policy":               {"repository"},
	"aws_kms_alias":                           {"target_key_id"},
	"aws_eip_association":                     {"instance_id", "allocation_id"},
	"aws_volume_attachment":                   {"instance_id"},
	"aws_secretsmanager_secret_version":       {"secret_id"},
	"aws_secretsmanager_secret_rotation":      {"secret_id"},
	"aws_secretsmanager_secret_policy":        {"secret_arn"},
	"aws_cloudwatch_log_stream":               {"log_group_name"},
	"aws_autoscaling_attachment":              {"autoscaling_group_name"},
	"aws_autoscaling_policy":                  {"autoscaling_group_name"},
	"aws_autoscaling_schedule":                {"autoscaling_group_name"},
	"aws_apigatewayv2_stage":                  {"api_id"},
	"aws_apigatewayv2_route":                  {"api_id"},
	"aws_apigatewayv2_integration":            {"api_id"},
	"aws_apigatewayv2_deployment":             {"api_id"},
	"aws_apigatewayv2_authorizer":             {"api_id"},
	"aws_api_gateway_resource":                {"rest_api_id"},
	"aws_api_gateway_method":                  {"rest_api_id"},
	"aws_api_gateway_method_response":         {"rest_api_id"},
	"aws_api_gateway_integration":             {"rest_api_id"},
	"aws_api_gateway_integration_response":    {"rest_api_id"},
	"aws_api_gateway_deployment":              {"rest_api_id"},
	"aws_api_gateway_stage":                   {"rest_api_id"},
	"aws_api_gateway_authorizer":              {"rest_api_id"},
	"aws_cloudwatch_event_target":             {"rule"},
	"aws_acm_certificate_validation":          {"certificate_arn"},
	"aws_ecs_cluster_capacity_providers":      {"cluster_name"},
	"aws_eks_addon":                           {"cluster_name"},
	"aws_eks_access_entry":                    {"cluster_name"},
	"aws_eks_access_policy_association":       {"cluster_name"},
	"aws_eks_pod_identity_association":        {"cluster_name"},
	"aws_dynamodb_table_item":                 {"table_name"},
	"aws_s3_object":                           {"bucket"},
	"aws_wafv2_web_acl_association":           {"web_acl_arn"},
	"aws_db_proxy_default_target_group":       {"db_proxy_name"},
	"aws_db_proxy_target":                     {"db_proxy_name"},
	"aws_rds_cluster_instance":                {"cluster_identifier"},
	"aws_cognito_user_pool_client":            {"user_pool_id"},
	"aws_cognito_user_pool_domain":            {"user_pool_id"},
	"aws_cloudfront_monitoring_subscription":  {"distribution_id"},
	"aws_route53_zone_association":            {"zone_id"},
}

// foldReverse lists types that are drawn inside the single resource that uses them.
var foldReverse = map[string]bool{
	"aws_db_subnet_group":             true,
	"aws_elasticache_subnet_group":    true,
	"aws_redshift_subnet_group":       true,
	"aws_docdb_subnet_group":          true,
	"aws_neptune_subnet_group":        true,
	"aws_db_parameter_group":          true,
	"aws_db_option_group":             true,
	"aws_rds_cluster_parameter_group": true,
	"aws_elasticache_parameter_group": true,
	"aws_iam_instance_profile":        true,
	"aws_iam_policy_document":         true,
	"aws_launch_template":             true,
	"aws_ecs_task_definition":         false,
}

func forwardAttrs(typ string) []string {
	if a, ok := foldForward[typ]; ok {
		return a
	}
	if strings.HasPrefix(typ, "aws_s3_bucket_") {
		return []string{"bucket"}
	}
	return nil
}

func (b *builder) computeFolds() {
	direct := map[string]string{}
	for _, n := range b.g.Nodes {
		if n.Kind != "resource" {
			continue
		}
		for _, attr := range forwardAttrs(n.Type) {
			for _, t := range b.targetsWhere(n.ID, func(p string) bool { return p == attr }) {
				if tn := b.nodes[t.id]; tn != nil && tn.Kind != "data" && t.id != n.ID {
					direct[n.ID] = t.id
					break
				}
			}
			if direct[n.ID] != "" {
				break
			}
		}
	}

	referencers := map[string]map[string]bool{}
	for _, e := range b.g.Edges {
		if _, folded := direct[e.Source]; folded {
			continue
		}
		if referencers[e.Target] == nil {
			referencers[e.Target] = map[string]bool{}
		}
		referencers[e.Target][e.Source] = true
	}
	for _, n := range b.g.Nodes {
		if !foldReverse[n.Type] || direct[n.ID] != "" {
			continue
		}
		if refs := referencers[n.ID]; len(refs) == 1 {
			for src := range refs {
				if b.nodes[src].Kind != "module" {
					direct[n.ID] = src
				}
			}
		}
	}

	for id := range direct {
		cur, seen := id, map[string]bool{id: true}
		for {
			next, ok := direct[cur]
			if !ok || seen[next] {
				break
			}
			seen[next] = true
			cur = next
		}
		if cur != id {
			b.nodes[id].FoldInto = cur
		}
	}
}
