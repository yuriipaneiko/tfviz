import type { GraphNode } from "./api";

const serviceIcons = import.meta.glob("../node_modules/aws-icons/icons/architecture-service/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;
const resourceIcons = import.meta.glob("../node_modules/aws-icons/icons/resource/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;
const groupIcons = import.meta.glob("../node_modules/aws-icons/icons/architecture-group/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

function byName(map: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(map)) {
    out[path.split("/").pop()!.replace(/\.svg$/, "")] = url;
  }
  return out;
}

const SVC = byName(serviceIcons);
const RES = byName(resourceIcons);
export const GROUP = byName(groupIcons);

export type Category =
  | "compute"
  | "containers"
  | "storage"
  | "database"
  | "networking"
  | "security"
  | "integration"
  | "management"
  | "analytics"
  | "ml"
  | "devtools"
  | "frontend"
  | "other";

export const CATEGORIES: Record<Category, { label: string; color: string }> = {
  compute: { label: "Compute", color: "#ED7100" },
  containers: { label: "Containers", color: "#F58534" },
  storage: { label: "Storage", color: "#7AA116" },
  database: { label: "Database", color: "#C925D1" },
  networking: { label: "Networking", color: "#8C4FFF" },
  security: { label: "Security & Identity", color: "#DD344C" },
  integration: { label: "App Integration", color: "#E7157B" },
  management: { label: "Management", color: "#E7157B" },
  analytics: { label: "Analytics", color: "#7D5BF5" },
  ml: { label: "AI / ML", color: "#01A88D" },
  devtools: { label: "Developer Tools", color: "#3F8CFF" },
  frontend: { label: "Front-end & Web", color: "#DD344C" },
  other: { label: "Other", color: "#7B8494" },
};

interface Entry {
  match: string | RegExp;
  service: string;
  icon: string; // "svc:Name" | "res:Name"
  category: Category;
}

// First match wins: put specific types before their service prefix.
const ENTRIES: Entry[] = [
  // Networking
  { match: /^aws_(default_)?vpc$/, service: "VPC", icon: "res:AmazonVPCVirtualprivatecloudVPC", category: "networking" },
  { match: /^aws_(default_)?subnet$/, service: "Subnet", icon: "res:AmazonVPCRouter", category: "networking" },
  { match: "aws_internet_gateway", service: "Internet Gateway", icon: "res:AmazonVPCInternetGateway", category: "networking" },
  { match: "aws_egress_only_internet_gateway", service: "Egress-only IGW", icon: "res:AmazonVPCInternetGateway", category: "networking" },
  { match: "aws_nat_gateway", service: "NAT Gateway", icon: "res:AmazonVPCNATGateway", category: "networking" },
  { match: /^aws_(default_)?route_table/, service: "Route Table", icon: "res:AmazonRoute53RouteTable", category: "networking" },
  { match: /^aws_route$/, service: "Route", icon: "res:AmazonRoute53RouteTable", category: "networking" },
  { match: "aws_eip", service: "Elastic IP", icon: "res:AmazonVPCElasticNetworkInterface", category: "networking" },
  { match: "aws_network_interface", service: "Network Interface", icon: "res:AmazonVPCElasticNetworkInterface", category: "networking" },
  { match: /^aws_(default_)?network_acl/, service: "Network ACL", icon: "res:AmazonVPCNetworkAccessControlList", category: "networking" },
  { match: "aws_vpc_endpoint", service: "VPC Endpoint", icon: "res:AmazonVPCEndpoints", category: "networking" },
  { match: "aws_vpc_peering", service: "VPC Peering", icon: "res:AmazonVPCPeeringConnection", category: "networking" },
  { match: "aws_flow_log", service: "VPC Flow Logs", icon: "res:AmazonVPCFlowLogs", category: "networking" },
  { match: "aws_vpn_gateway", service: "VPN Gateway", icon: "res:AmazonVPCVPNGateway", category: "networking" },
  { match: "aws_customer_gateway", service: "Customer Gateway", icon: "res:AmazonVPCCustomerGateway", category: "networking" },
  { match: "aws_vpn_connection", service: "VPN Connection", icon: "res:AmazonVPCVPNConnection", category: "networking" },
  { match: "aws_ec2_transit_gateway", service: "Transit Gateway", icon: "svc:AWSTransitGateway", category: "networking" },
  { match: "aws_vpclattice", service: "VPC Lattice", icon: "svc:AmazonVPCLattice", category: "networking" },
  { match: /^aws_(default_)?security_group/, service: "Security Group", icon: "svc:AWSNetworkFirewall", category: "security" },
  { match: "aws_vpc_security_group", service: "Security Group Rule", icon: "svc:AWSNetworkFirewall", category: "security" },
  { match: "aws_vpc", service: "VPC", icon: "svc:AmazonVirtualPrivateCloud", category: "networking" },
  { match: /^aws_(lb|alb)$/, service: "Load Balancer", icon: "res:ElasticLoadBalancingApplicationLoadBalancer", category: "networking" },
  { match: /^aws_(lb|alb)_target_group/, service: "Target Group", icon: "svc:ElasticLoadBalancing", category: "networking" },
  { match: /^aws_(lb|alb)_listener/, service: "Listener", icon: "svc:ElasticLoadBalancing", category: "networking" },
  { match: "aws_elb", service: "Classic Load Balancer", icon: "res:ElasticLoadBalancingClassicLoadBalancer", category: "networking" },
  { match: "aws_cloudfront", service: "CloudFront", icon: "svc:AmazonCloudFront", category: "networking" },
  { match: "aws_route53_zone", service: "Hosted Zone", icon: "res:AmazonRoute53HostedZone", category: "networking" },
  { match: "aws_route53_resolver", service: "Route 53 Resolver", icon: "res:AmazonRoute53Resolver", category: "networking" },
  { match: "aws_route53", service: "Route 53", icon: "svc:AmazonRoute53", category: "networking" },
  { match: /^aws_api_gateway|^aws_apigatewayv2/, service: "API Gateway", icon: "svc:AmazonAPIGateway", category: "networking" },
  { match: "aws_globalaccelerator", service: "Global Accelerator", icon: "svc:AWSGlobalAccelerator", category: "networking" },
  { match: "aws_dx_", service: "Direct Connect", icon: "svc:AWSDirectConnect", category: "networking" },
  { match: "aws_service_discovery", service: "Cloud Map", icon: "svc:AWSCloudMap", category: "networking" },
  { match: "aws_networkfirewall", service: "Network Firewall", icon: "svc:AWSNetworkFirewall", category: "security" },

  // Compute
  { match: /^aws_(instance|spot_instance_request)$/, service: "EC2 Instance", icon: "res:AmazonEC2Instance", category: "compute" },
  { match: "aws_launch_template", service: "Launch Template", icon: "svc:AmazonEC2", category: "compute" },
  { match: "aws_autoscaling", service: "Auto Scaling", icon: "svc:AmazonEC2AutoScaling", category: "compute" },
  { match: "aws_appautoscaling", service: "Application Auto Scaling", icon: "svc:AWSApplicationAutoScaling", category: "compute" },
  { match: "aws_ami", service: "AMI", icon: "svc:AmazonEC2", category: "compute" },
  { match: "aws_key_pair", service: "Key Pair", icon: "svc:AmazonEC2", category: "compute" },
  { match: /^aws_(ebs|volume_attachment)/, service: "EBS", icon: "svc:AmazonElasticBlockStore", category: "storage" },
  { match: "aws_ec2_", service: "EC2", icon: "svc:AmazonEC2", category: "compute" },
  { match: "aws_lambda", service: "Lambda", icon: "svc:AWSLambda", category: "compute" },
  { match: "aws_batch", service: "Batch", icon: "svc:AWSBatch", category: "compute" },
  { match: "aws_elastic_beanstalk", service: "Elastic Beanstalk", icon: "svc:AWSElasticBeanstalk", category: "compute" },
  { match: "aws_lightsail", service: "Lightsail", icon: "svc:AmazonLightsail", category: "compute" },
  { match: "aws_apprunner", service: "App Runner", icon: "svc:AWSAppRunner", category: "compute" },

  // Containers
  { match: "aws_ecs_service", service: "ECS Service", icon: "svc:AWSFargate", category: "containers" },
  { match: "aws_ecs", service: "ECS", icon: "svc:AmazonElasticContainerService", category: "containers" },
  { match: "aws_eks", service: "EKS", icon: "svc:AmazonElasticKubernetesService", category: "containers" },
  { match: "aws_ecr", service: "ECR", icon: "svc:AmazonElasticContainerRegistry", category: "containers" },

  // Storage
  { match: /^aws_s3_bucket$/, service: "S3 Bucket", icon: "res:AmazonSimpleStorageServiceBucket", category: "storage" },
  { match: "aws_s3_object", service: "S3 Object", icon: "res:AmazonSimpleStorageServiceBucketWithObjects", category: "storage" },
  { match: "aws_s3", service: "S3", icon: "svc:AmazonSimpleStorageService", category: "storage" },
  { match: "aws_glacier", service: "Glacier", icon: "svc:AmazonSimpleStorageServiceGlacier", category: "storage" },
  { match: "aws_efs", service: "EFS", icon: "svc:AmazonEFS", category: "storage" },
  { match: "aws_fsx", service: "FSx", icon: "svc:AmazonFSx", category: "storage" },
  { match: "aws_backup", service: "Backup", icon: "svc:AWSBackup", category: "storage" },
  { match: "aws_storagegateway", service: "Storage Gateway", icon: "svc:AWSStorageGateway", category: "storage" },

  // Database
  { match: /^aws_rds_cluster|^aws_db_cluster/, service: "Aurora", icon: "svc:AmazonAurora", category: "database" },
  { match: "aws_db_proxy", service: "RDS Proxy", icon: "res:AmazonRDSProxyInstance", category: "database" },
  { match: /^aws_db_|^aws_rds/, service: "RDS", icon: "svc:AmazonRDS", category: "database" },
  { match: "aws_dynamodb", service: "DynamoDB", icon: "svc:AmazonDynamoDB", category: "database" },
  { match: "aws_elasticache", service: "ElastiCache", icon: "svc:AmazonElastiCache", category: "database" },
  { match: "aws_memorydb", service: "MemoryDB", icon: "svc:AmazonMemoryDB", category: "database" },
  { match: "aws_docdb", service: "DocumentDB", icon: "svc:AmazonDocumentDB", category: "database" },
  { match: "aws_neptune", service: "Neptune", icon: "svc:AmazonNeptune", category: "database" },
  { match: "aws_redshift", service: "Redshift", icon: "svc:AmazonRedshift", category: "analytics" },
  { match: "aws_keyspaces", service: "Keyspaces", icon: "svc:AmazonKeyspaces", category: "database" },
  { match: "aws_timestream", service: "Timestream", icon: "svc:AmazonTimestream", category: "database" },
  { match: "aws_dms", service: "DMS", icon: "svc:AWSDatabaseMigrationService", category: "database" },

  // App integration
  { match: "aws_sqs", service: "SQS", icon: "svc:AmazonSimpleQueueService", category: "integration" },
  { match: "aws_sns", service: "SNS", icon: "svc:AmazonSimpleNotificationService", category: "integration" },
  { match: /^aws_cloudwatch_event|^aws_scheduler|^aws_pipes/, service: "EventBridge", icon: "svc:AmazonEventBridge", category: "integration" },
  { match: "aws_sfn", service: "Step Functions", icon: "svc:AWSStepFunctions", category: "integration" },
  { match: "aws_mq", service: "Amazon MQ", icon: "svc:AmazonMQ", category: "integration" },
  { match: "aws_appsync", service: "AppSync", icon: "svc:AWSAppSync", category: "integration" },
  { match: "aws_ses", service: "SES", icon: "svc:AmazonSimpleEmailService", category: "integration" },

  // Analytics & streaming
  { match: "aws_kinesis_firehose", service: "Data Firehose", icon: "svc:AmazonDataFirehose", category: "analytics" },
  { match: "aws_kinesis", service: "Kinesis", icon: "svc:AmazonKinesisDataStreams", category: "analytics" },
  { match: "aws_msk", service: "MSK", icon: "svc:AmazonManagedStreamingforApacheKafka", category: "analytics" },
  { match: /^aws_opensearch|^aws_elasticsearch/, service: "OpenSearch", icon: "svc:AmazonOpenSearchService", category: "analytics" },
  { match: "aws_athena", service: "Athena", icon: "svc:AmazonAthena", category: "analytics" },
  { match: "aws_glue", service: "Glue", icon: "svc:AWSGlue", category: "analytics" },
  { match: "aws_emr", service: "EMR", icon: "svc:AmazonEMR", category: "analytics" },
  { match: "aws_lakeformation", service: "Lake Formation", icon: "svc:AWSLakeFormation", category: "analytics" },
  { match: "aws_quicksight", service: "QuickSight", icon: "svc:AmazonQuickSuite", category: "analytics" },

  // Security & identity
  { match: "aws_iam_role", service: "IAM Role", icon: "res:AWSIdentityAccessManagementRole", category: "security" },
  { match: "aws_iam_policy_document", service: "IAM Policy Document", icon: "svc:AWSIdentityandAccessManagement", category: "security" },
  { match: "aws_iam", service: "IAM", icon: "svc:AWSIdentityandAccessManagement", category: "security" },
  { match: "aws_kms", service: "KMS", icon: "svc:AWSKeyManagementService", category: "security" },
  { match: "aws_secretsmanager", service: "Secrets Manager", icon: "svc:AWSSecretsManager", category: "security" },
  { match: /^aws_acm(pca)?_/, service: "Certificate Manager", icon: "svc:AWSCertificateManager", category: "security" },
  { match: /^aws_wafv2|^aws_waf/, service: "WAF", icon: "svc:AWSWAF", category: "security" },
  { match: "aws_shield", service: "Shield", icon: "svc:AWSShield", category: "security" },
  { match: "aws_guardduty", service: "GuardDuty", icon: "svc:AmazonGuardDuty", category: "security" },
  { match: "aws_securityhub", service: "Security Hub", icon: "svc:AWSSecurityHub", category: "security" },
  { match: "aws_inspector", service: "Inspector", icon: "svc:AmazonInspector", category: "security" },
  { match: "aws_macie", service: "Macie", icon: "svc:AmazonMacie", category: "security" },
  { match: "aws_cognito", service: "Cognito", icon: "svc:AmazonCognito", category: "security" },
  { match: "aws_ssoadmin", service: "IAM Identity Center", icon: "svc:AWSIAMIdentityCenter", category: "security" },
  { match: "aws_organizations", service: "Organizations", icon: "svc:AWSOrganizations", category: "management" },
  { match: "aws_caller_identity", service: "Caller Identity", icon: "svc:AWSIdentityandAccessManagement", category: "security" },

  // Management & governance
  { match: "aws_cloudwatch_log", service: "CloudWatch Logs", icon: "res:AmazonCloudWatchLogs", category: "management" },
  { match: "aws_cloudwatch_metric_alarm", service: "CloudWatch Alarm", icon: "res:AmazonCloudWatchAlarm", category: "management" },
  { match: "aws_cloudwatch", service: "CloudWatch", icon: "svc:AmazonCloudWatch", category: "management" },
  { match: "aws_cloudtrail", service: "CloudTrail", icon: "svc:AWSCloudTrail", category: "management" },
  { match: "aws_config", service: "Config", icon: "svc:AWSConfig", category: "management" },
  { match: "aws_ssm", service: "Systems Manager", icon: "svc:AWSSystemsManager", category: "management" },
  { match: "aws_cloudformation", service: "CloudFormation", icon: "svc:AWSCloudFormation", category: "management" },
  { match: "aws_budgets", service: "Budgets", icon: "svc:AWSBudgets", category: "management" },
  { match: "aws_xray", service: "X-Ray", icon: "svc:AWSXRay", category: "management" },
  { match: "aws_grafana", service: "Managed Grafana", icon: "svc:AmazonManagedGrafana", category: "management" },
  { match: "aws_prometheus", service: "Managed Prometheus", icon: "svc:AmazonManagedServiceforPrometheus", category: "management" },
  { match: /^aws_(region|availability_zones?|partition)$/, service: "AWS", icon: "svc:AWSManagementConsole", category: "management" },

  // Dev tools & front-end
  { match: "aws_codebuild", service: "CodeBuild", icon: "svc:AWSCodeBuild", category: "devtools" },
  { match: "aws_codepipeline", service: "CodePipeline", icon: "svc:AWSCodePipeline", category: "devtools" },
  { match: "aws_codecommit", service: "CodeCommit", icon: "svc:AWSCodeCommit", category: "devtools" },
  { match: "aws_codedeploy", service: "CodeDeploy", icon: "svc:AWSCodeDeploy", category: "devtools" },
  { match: "aws_codeartifact", service: "CodeArtifact", icon: "svc:AWSCodeArtifact", category: "devtools" },
  { match: "aws_amplify", service: "Amplify", icon: "svc:AWSAmplify", category: "frontend" },

  // AI / ML
  { match: "aws_sagemaker", service: "SageMaker", icon: "svc:AmazonSageMakerAI", category: "ml" },
  { match: "aws_bedrock", service: "Bedrock", icon: "svc:AmazonBedrock", category: "ml" },
];

export interface TypeInfo {
  service: string;
  label: string;
  icon?: string;
  category: Category;
  color: string;
}

const cache = new Map<string, TypeInfo>();

const ACRONYMS = new Set(["iam", "vpc", "lb", "alb", "elb", "ec2", "ecs", "eks", "ecr", "s3", "sqs", "sns", "kms", "acm", "db", "rds", "api", "ip", "eip", "nat", "dns", "waf", "ssm", "efs", "ebs", "msk", "id", "arn", "url", "acl", "tls", "ssh", "gcp", "gke", "aks"]);

export function humanize(type: string): string {
  const parts = type.split("_");
  if (parts.length > 1) parts.shift();
  return parts.map((p) => (ACRONYMS.has(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
}

const LABELS: Record<string, string> = {
  aws_acm_certificate: "ACM Certificate",
  aws_acm_certificate_validation: "ACM Validation",
  aws_db_instance: "RDS Instance",
  aws_lb: "Load Balancer",
  aws_alb: "Load Balancer",
  aws_instance: "EC2 Instance",
  aws_iam_policy_document: "IAM Policy Document",
  aws_cloudwatch_log_group: "Log Group",
  aws_cloudwatch_metric_alarm: "CloudWatch Alarm",
  aws_wafv2_web_acl: "WAF Web ACL",
  aws_route53_zone: "Hosted Zone",
};

// "ECS" + aws_ecs_task_definition -> "ECS Task Definition"
function serviceLabel(type: string, e: Entry): string {
  if (LABELS[type]) return LABELS[type];
  const rest = typeof e.match === "string" ? type.slice(e.match.length) : type.replace(e.match, "");
  const words = rest.split("_").filter(Boolean);
  if (words.length === 0 || e.service.split(" ").length > 1) return e.service;
  return `${e.service} ${words.map((p) => (ACRONYMS.has(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1))).join(" ")}`;
}

function iconUrl(ref: string): string | undefined {
  const [kind, name] = ref.split(":");
  return kind === "svc" ? SVC[name] : RES[name];
}

export function typeInfo(type: string): TypeInfo {
  const hit = cache.get(type);
  if (hit) return hit;
  let info: TypeInfo | undefined;
  if (type.startsWith("aws_")) {
    const e = ENTRIES.find((e) => (typeof e.match === "string" ? type.startsWith(e.match) : e.match.test(type)));
    if (e) {
      info = { service: serviceLabel(type, e), label: humanize(type), icon: iconUrl(e.icon), category: e.category, color: CATEGORIES[e.category].color };
    } else {
      info = { service: "AWS", label: humanize(type), icon: SVC["AWSManagementConsole"], category: "other", color: CATEGORIES.other.color };
    }
  } else {
    info = { service: providerLabel(type.split("_")[0]), label: humanize(type), category: "other", color: providerColor(type.split("_")[0]) };
  }
  cache.set(type, info);
  return info;
}

const PROVIDERS: Record<string, { label: string; color: string }> = {
  aws: { label: "AWS", color: "#FF9900" },
  google: { label: "Google Cloud", color: "#4285F4" },
  azurerm: { label: "Azure", color: "#0078D4" },
  azuread: { label: "Entra ID", color: "#0078D4" },
  kubernetes: { label: "Kubernetes", color: "#326CE5" },
  helm: { label: "Helm", color: "#0F1689" },
  cloudflare: { label: "Cloudflare", color: "#F38020" },
  github: { label: "GitHub", color: "#8B949E" },
  datadog: { label: "Datadog", color: "#632CA6" },
  random: { label: "Random", color: "#7B8494" },
  null: { label: "Null", color: "#7B8494" },
  tls: { label: "TLS", color: "#7B8494" },
  local: { label: "Local", color: "#7B8494" },
  archive: { label: "Archive", color: "#7B8494" },
  time: { label: "Time", color: "#7B8494" },
  vault: { label: "Vault", color: "#FFD814" },
  tfe: { label: "Terraform Cloud", color: "#7B42BC" },
  module: { label: "Module", color: "#7B8494" },
};

export function providerLabel(p: string) {
  return PROVIDERS[p]?.label ?? p.charAt(0).toUpperCase() + p.slice(1);
}

export function providerColor(p: string) {
  return PROVIDERS[p]?.color ?? "#7B8494";
}

export function nodeInfo(n: GraphNode): TypeInfo {
  if (n.kind === "module") {
    const src = n.moduleSource ?? "";
    const m = src.match(/terraform-aws-modules\/([\w-]+)\/aws/);
    if (m) {
      const inner = typeInfo("aws_" + m[1].replace(/-/g, "_"));
      return { ...inner, service: `Module · ${m[1]}`, label: src };
    }
    return { service: "Module", label: src, category: "other", color: providerColor(n.provider), icon: undefined };
  }
  return typeInfo(n.type);
}

export const AWS_CLOUD_ICON = GROUP["AWSCloudlogo"] ?? GROUP["AWSCloud"];
export const VPC_ICON = GROUP["VirtualprivatecloudVPC"];
export const PUBLIC_SUBNET_ICON = GROUP["Publicsubnet"];
export const PRIVATE_SUBNET_ICON = GROUP["Privatesubnet"];
export const REGION_ICON = GROUP["Region"];
