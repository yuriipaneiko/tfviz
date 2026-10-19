export interface StackEnv {
  name: string;
  varFile?: string;
  backendConfig?: string;
}

export interface Stack {
  id: string;
  name: string;
  dir: string;
  kind: "root" | "module";
  initialized: boolean;
  varFiles: string[];
  backendConfigs?: string[];
  envs?: StackEnv[];
  backend?: string;
  providers: string[];
  usedBy?: string[];
}

export interface Project {
  dir: string;
  name: string;
  stacks: Stack[];
  watch: boolean;
}

export interface AttrView {
  path: string;
  text: string;
  refs?: string[];
}

export interface Network {
  role?: "vpc" | "subnet";
  parent?: string;
  spans?: string[];
}

export interface GraphNode {
  id: string;
  kind: "resource" | "data" | "module";
  type: string;
  name: string;
  provider: string;
  providerConfig?: string;
  module: string;
  multi?: "count" | "for_each";
  multiExpr?: string;
  file: string;
  absFile: string;
  line: number;
  endLine: number;
  textLine: number;
  source: string;
  attrs: AttrView[];
  network?: Network;
  foldInto?: string;
  moduleSource?: string;
  moduleVersion?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  attrs: string[];
  kind: "ref" | "depends_on";
}

export interface VarView {
  name: string;
  type?: string;
  default?: string;
  description?: string;
  sensitive?: boolean;
  value?: string;
}

export interface OutputView {
  name: string;
  description?: string;
  value: string;
  refs?: string[];
  sensitive?: boolean;
}

export interface ModuleInfo {
  id: string;
  name: string;
  parent: string;
  source?: string;
  version?: string;
  dir: string;
  expanded: boolean;
  multi?: string;
  multiExpr?: string;
  file?: string;
  absFile?: string;
  line?: number;
  variables: VarView[];
  outputs: OutputView[];
  resources: number;
}

export interface Container {
  id: string;
  label: string;
  kind: "subnet";
  parent: string;
}

export interface ProviderView {
  name: string;
  alias?: string;
  region?: string;
  source?: string;
  version?: string;
}

export interface Graph {
  stack: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  modules: ModuleInfo[];
  containers: Container[];
  providers: ProviderView[];
  backend?: string;
  diagnostics: string[];
}

export type PlanAction = "create" | "update" | "delete" | "replace" | "read" | "no-op" | "forget" | "mixed";

export interface AttrChange {
  path: string;
  before?: unknown;
  after?: unknown;
  afterUnknown?: boolean;
  sensitive?: boolean;
  forcesReplace?: boolean;
}

export interface PlanChange {
  address: string;
  configAddress: string;
  module?: string;
  mode: string;
  type: string;
  name: string;
  index?: string;
  provider: string;
  action: PlanAction;
  actions: string[];
  actionReason?: string;
  attrs: AttrChange[];
  imported?: boolean;
  movedFrom?: string;
}

export interface NodeChange {
  action: PlanAction;
  instances: number;
  counts: Record<string, number>;
}

export interface PlanResult {
  stack: string;
  createdAt: string;
  terraformVersion: string;
  errored: boolean;
  summary: { create: number; update: number; delete: number; replace: number; read: number; noop: number; forget: number; drift: number };
  changes: PlanChange[];
  nodes: Record<string, NodeChange>;
  outputs: { name: string; action: PlanAction; before?: unknown; after?: unknown; unknown?: boolean; sensitive?: boolean }[];
  drift: PlanChange[];
  options?: Record<string, unknown>;
  providerRegions?: Record<string, string>;
}

export interface Finding {
  checkId: string;
  name: string;
  severity: string;
  guideline?: string;
  resource: string;
  address?: string;
  file: string;
  absFile: string;
  lines: [number, number];
  nodes: string[];
}

export interface SecurityReport {
  stack: string;
  tool: string;
  version?: string;
  createdAt: string;
  passed: number;
  failed: number;
  skipped: number;
  findings: Finding[];
  nodes: Record<string, number>;
  unmapped: number;
}

export interface CostComponent {
  name: string;
  unit: string;
  monthlyQuantity?: number;
  price?: number;
  monthlyCost?: number;
  usageBased?: boolean;
}

export interface CostReport {
  stack: string;
  source: "plan" | "hcl";
  currency: string;
  createdAt: string;
  totalMonthly: number;
  resources: { address: string; configAddress: string; type: string; monthlyCost: number | null; components: CostComponent[]; caveats?: string[] }[];
  nodes: Record<string, { monthlyCost: number; instances: number; usageBased: boolean }>;
  supported: number;
  unsupported: number;
  noPrice: number;
  caveats?: number;
}

export interface Tool {
  name: string;
  path?: string;
  version?: string;
  available: boolean;
  install: string;
}

export interface Tools {
  terraform: Tool;
  checkov: Tool;
  c3x: Tool;
  awsProfiles: string[];
  awsProfile?: string;
}

export type JobStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface Job {
  id: string;
  kind: "plan" | "init" | "security" | "cost";
  stack: string;
  title: string;
  status: JobStatus;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface LogLine {
  seq: number;
  stream: "stdout" | "stderr" | "info";
  text: string;
}

export interface PlanOptions {
  stack: string;
  env?: string;
  varFiles: string[];
  backendConfig?: string;
  workspace: string;
  awsProfile: string;
  refresh: boolean;
  destroy: boolean;
  init: boolean;
  upgrade?: boolean;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-TFViz": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error ?? (text || res.statusText);
    throw new Error(msg);
  }
  return data as T;
}

const q = (stack: string, env?: string) => {
  const p = new URLSearchParams({ stack });
  if (env) p.set("env", env);
  return p.toString();
};

export const api = {
  project: () => request<Project>("GET", "/api/project"),
  tools: (refresh = false) => request<Tools>("GET", `/api/tools${refresh ? "?refresh=1" : ""}`),
  graph: (stack: string) => request<Graph>("GET", `/api/graph?${q(stack)}`),
  workspaces: (stack: string) => request<{ workspaces: string[]; current: string; error?: string }>("GET", `/api/workspaces?${q(stack)}`),
  plan: (stack: string, env?: string) => request<{ plan: PlanResult | null; stale: boolean }>("GET", `/api/plan?${q(stack, env)}`),
  clearPlan: (stack: string, env?: string) => request("DELETE", `/api/plan?${q(stack, env)}`),
  runPlan: (opts: PlanOptions) => request<Job>("POST", "/api/plan", opts),
  runInit: (opts: Partial<PlanOptions> & { stack: string }) => request<Job>("POST", "/api/init", opts),
  security: (stack: string) => request<{ report: SecurityReport | null }>("GET", `/api/security?${q(stack)}`),
  runSecurity: (stack: string) => request<Job>("POST", "/api/security", { stack }),
  cost: (stack: string, env?: string) => request<{ report: CostReport | null }>("GET", `/api/cost?${q(stack, env)}`),
  runCost: (stack: string, varFiles: string[], env?: string) => request<Job>("POST", "/api/cost", { stack, varFiles, env }),
  jobs: () => request<Job[]>("GET", "/api/jobs"),
  job: (id: string) => request<{ job: Job; logs: LogLine[] }>("GET", `/api/jobs/${id}`),
  cancelJob: (id: string) => request("POST", `/api/jobs/${id}/cancel`),
};

export type ServerEvent =
  | { type: "job"; job: Job }
  | { type: "log"; log: { jobId: string; line: LogLine } }
  | { type: "files-changed"; files: string[]; stacks: string[] }
  | { type: "plan"; stack: string; env?: string }
  | { type: "security"; stack: string }
  | { type: "cost"; stack: string; env?: string };

export function subscribe(onEvent: (e: ServerEvent) => void, onStatus: (connected: boolean) => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    es = new EventSource("/api/events");
    es.onopen = () => onStatus(true);
    es.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore malformed events */
      }
    };
    es.onerror = () => {
      onStatus(false);
      es?.close();
      if (!closed) retry = setTimeout(connect, 1500);
    };
  };
  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    es?.close();
  };
}
