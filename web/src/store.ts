import { create } from "zustand";
import {
  api,
  type CostReport,
  type Graph,
  type Job,
  type LogLine,
  type PlanOptions,
  type PlanResult,
  type Project,
  type SecurityReport,
  type ServerEvent,
  type Tools,
} from "./api";
import type { Category } from "./catalog";

export type Grouping = "network" | "module" | "flat";
export type EdgeMode = "all" | "focus" | "none";
export type Overlay = "plan" | "security" | "cost" | "none";
export type BottomTab = "changes" | "security" | "cost" | "logs";
export type Editor = "cursor" | "vscode" | "none";

export interface ViewSettings {
  grouping: Grouping;
  direction: "RIGHT" | "DOWN";
  showData: boolean;
  foldHelpers: boolean;
  edges: EdgeMode;
  changesOnly: boolean;
  hiddenCategories: Category[];
  hiddenProviders: string[];
  overlay: Overlay;
}

const defaultView: ViewSettings = {
  grouping: "network",
  direction: "RIGHT",
  showData: false,
  foldHelpers: true,
  edges: "all",
  changesOnly: false,
  hiddenCategories: [],
  hiddenProviders: [],
  overlay: "plan",
};

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  title: string;
  body?: string;
}

interface State {
  project?: Project;
  projectError?: string;
  stackId?: string;
  envId?: string;
  graph?: Graph;
  graphLoading: boolean;
  graphError?: string;
  graphVersion: number;
  plan?: PlanResult | null;
  planStale: boolean;
  security?: SecurityReport | null;
  cost?: CostReport | null;
  tools?: Tools;
  jobs: Record<string, Job>;
  logs: Record<string, LogLine[]>;
  activeJobId?: string;
  connected: boolean;

  selected?: string;
  hovered?: string;
  search: string;
  view: ViewSettings;
  theme: "dark" | "light";
  editor: Editor;

  sidebarOpen: boolean;
  bottomOpen: boolean;
  bottomTab: BottomTab;
  planDialogOpen: boolean;
  paletteOpen: boolean;
  focusRequest?: { id: string; n: number };
  toasts: Toast[];

  lastPlanOptions: Record<string, Partial<PlanOptions>>;

  init(): Promise<void>;
  selectStack(id: string, env?: string): Promise<void>;
  reloadProject(): Promise<void>;
  reloadGraph(silent?: boolean): Promise<void>;
  loadOverlays(): Promise<void>;
  loadTools(refresh?: boolean): Promise<void>;
  select(id?: string, focus?: boolean): void;
  hover(id?: string): void;
  setSearch(s: string): void;
  setView(patch: Partial<ViewSettings>): void;
  toggleTheme(): void;
  setEditor(e: Editor): void;
  set(patch: Partial<State>): void;
  runPlan(opts: PlanOptions): Promise<void>;
  runInit(): Promise<void>;
  runSecurity(): Promise<void>;
  runCost(): Promise<void>;
  clearPlan(): Promise<void>;
  cancelJob(id: string): Promise<void>;
  openJob(id: string): Promise<void>;
  handleEvent(e: ServerEvent): void;
  toast(t: Omit<Toast, "id">): void;
  dismissToast(id: number): void;
}

let toastId = 0;

function hashSelection(): { stack?: string; env?: string } {
  const stack = location.hash.match(/stack=([^&]+)/);
  const env = location.hash.match(/[&?]env=([^&]+)/);
  return {
    stack: stack ? decodeURIComponent(stack[1]) : undefined,
    env: env ? decodeURIComponent(env[1]) : undefined,
  };
}

function writeHash(stack: string, env?: string) {
  let hash = `#stack=${encodeURIComponent(stack)}`;
  if (env) hash += `&env=${encodeURIComponent(env)}`;
  history.replaceState(null, "", hash);
}

export function optionsKey(stack: string, env?: string) {
  return env ? `${stack}#${env}` : stack;
}

export function suggestProfile(env: string, profiles: string[]): string | undefined {
  const lower = env.toLowerCase();
  const matches = profiles.filter((p) => p.split(/[-_/]/).pop()?.toLowerCase() === lower);
  return matches.length === 1 ? matches[0] : undefined;
}

function pickEnv(names: string[], wanted?: string, remembered?: string): string {
  if (wanted && names.includes(wanted)) return wanted;
  if (remembered && names.includes(remembered)) return remembered;
  return names[0] ?? "";
}

export const useStore = create<State>((set, get) => ({
  graphLoading: false,
  graphVersion: 0,
  planStale: false,
  jobs: {},
  logs: {},
  connected: false,
  search: "",
  view: loadJSON("tfviz.view", defaultView),
  theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
  editor: (localStorage.getItem("tfviz.editor") as Editor) || "cursor",
  sidebarOpen: true,
  bottomOpen: false,
  bottomTab: "logs",
  planDialogOpen: false,
  paletteOpen: false,
  toasts: [],
  lastPlanOptions: loadJSON("tfviz.planOptions", {}),

  async init() {
    get().loadTools();
    await get().reloadProject();
    const { project } = get();
    if (!project) return;
    const wanted = hashSelection();
    const first =
      project.stacks.find((s) => s.id === wanted.stack) ?? project.stacks.find((s) => s.kind === "root") ?? project.stacks[0];
    if (first) await get().selectStack(first.id, wanted.env);
    api.jobs().then((jobs) => {
      const map: Record<string, Job> = {};
      for (const j of jobs) map[j.id] = j;
      set({ jobs: map });
    });
  },

  async reloadProject() {
    try {
      const project = await api.project();
      set({ project, projectError: undefined });
    } catch (e) {
      set({ projectError: (e as Error).message });
    }
  },

  async selectStack(id, env) {
    const stack = get().project?.stacks.find((s) => s.id === id);
    const names = stack?.envs?.map((e) => e.name) ?? [];
    const remembered = loadJSON<Record<string, string>>("tfviz.envByStack", {})[id];
    const envId = pickEnv(names, env, remembered);
    const stackChanged = get().stackId !== id;
    const envChanged = get().envId !== envId;
    if (!stackChanged && !envChanged) {
      await Promise.all([get().reloadGraph(), get().loadOverlays()]);
      return;
    }
    if (envId) {
      const by = { ...loadJSON<Record<string, string>>("tfviz.envByStack", {}), [id]: envId };
      localStorage.setItem("tfviz.envByStack", JSON.stringify(by));
    }
    writeHash(id, envId || undefined);
    if (stackChanged) {
      set({ stackId: id, envId, graph: undefined, plan: undefined, security: undefined, cost: undefined, selected: undefined, planStale: false });
      await Promise.all([get().reloadGraph(), get().loadOverlays()]);
      return;
    }
    set({ envId, plan: undefined, cost: undefined, planStale: false });
    await get().loadOverlays();
  },

  async reloadGraph(silent = false) {
    const id = get().stackId;
    if (!id) return;
    if (!silent) set({ graphLoading: true });
    try {
      const graph = await api.graph(id);
      if (get().stackId !== id) return;
      const sel = get().selected;
      const stillThere = !sel || graph.nodes.some((n) => n.id === sel) || graph.modules.some((m) => m.id === sel) || graph.containers.some((c) => c.id === sel);
      set((s) => ({ graph, graphError: undefined, graphLoading: false, graphVersion: s.graphVersion + 1, selected: stillThere ? sel : undefined }));
    } catch (e) {
      set({ graphError: (e as Error).message, graphLoading: false });
    }
  },

  async loadOverlays() {
    const id = get().stackId;
    const env = get().envId;
    if (!id) return;
    const [p, sec, cost] = await Promise.all([
      api.plan(id, env).catch(() => ({ plan: null, stale: false })),
      api.security(id).catch(() => ({ report: null })),
      api.cost(id, env).catch(() => ({ report: null })),
    ]);
    if (get().stackId !== id || get().envId !== env) return;
    set({ plan: p.plan, planStale: p.stale, security: sec.report, cost: cost.report });
  },

  async loadTools(refresh = false) {
    try {
      set({ tools: await api.tools(refresh) });
    } catch {
      /* server not ready */
    }
  },

  select(id, focus = false) {
    set((s) => ({ selected: id, focusRequest: focus && id ? { id, n: (s.focusRequest?.n ?? 0) + 1 } : s.focusRequest }));
  },
  hover(id) {
    if (get().hovered !== id) set({ hovered: id });
  },
  setSearch(search) {
    set({ search });
  },
  setView(patch) {
    const view = { ...get().view, ...patch };
    localStorage.setItem("tfviz.view", JSON.stringify(view));
    set({ view });
  },
  toggleTheme() {
    const theme = get().theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("tfviz.theme", theme);
    set({ theme });
  },
  setEditor(editor) {
    localStorage.setItem("tfviz.editor", editor);
    set({ editor });
  },
  set(patch) {
    set(patch);
  },

  async runPlan(opts) {
    const lastPlanOptions = { ...get().lastPlanOptions, [optionsKey(opts.stack, opts.env)]: opts };
    localStorage.setItem("tfviz.planOptions", JSON.stringify(lastPlanOptions));
    set({ lastPlanOptions, planDialogOpen: false });
    if (opts.env) {
      const by = { ...loadJSON<Record<string, string>>("tfviz.envByStack", {}), [opts.stack]: opts.env };
      localStorage.setItem("tfviz.envByStack", JSON.stringify(by));
      writeHash(opts.stack, opts.env);
      if (opts.stack === get().stackId) set({ envId: opts.env });
    }
    try {
      const job = await api.runPlan(opts);
      get().handleEvent({ type: "job", job });
      set({ activeJobId: job.id, bottomOpen: true, bottomTab: "logs" });
    } catch (e) {
      get().toast({ kind: "error", title: "Could not start plan", body: (e as Error).message });
    }
  },

  async runInit() {
    const id = get().stackId;
    if (!id) return;
    const env = get().envId;
    const stack = get().project?.stacks.find((s) => s.id === id);
    const variant = stack?.envs?.find((e) => e.name === env);
    const last = get().lastPlanOptions[optionsKey(id, env)];
    try {
      const job = await api.runInit({
        stack: id,
        env,
        backendConfig: variant?.backendConfig,
        awsProfile: last?.awsProfile,
      });
      get().handleEvent({ type: "job", job });
      set({ activeJobId: job.id, bottomOpen: true, bottomTab: "logs" });
    } catch (e) {
      get().toast({ kind: "error", title: "Could not start init", body: (e as Error).message });
    }
  },

  async runSecurity() {
    const id = get().stackId;
    if (!id) return;
    try {
      const job = await api.runSecurity(id);
      get().handleEvent({ type: "job", job });
      set({ activeJobId: job.id });
      get().toast({ kind: "info", title: "Security scan started", body: "Running Checkov…" });
    } catch (e) {
      get().toast({ kind: "error", title: "Could not start scan", body: (e as Error).message });
    }
  },

  async runCost() {
    const id = get().stackId;
    if (!id) return;
    try {
      const env = get().envId;
      const last = get().lastPlanOptions[optionsKey(id, env)];
      const variant = get().project?.stacks.find((s) => s.id === id)?.envs?.find((e) => e.name === env);
      const varFiles = last?.varFiles ?? (variant?.varFile ? [variant.varFile] : []);
      const job = await api.runCost(id, varFiles, env);
      get().handleEvent({ type: "job", job });
      set({ activeJobId: job.id });
      get().toast({ kind: "info", title: "Cost estimate started", body: "Running C3X…" });
    } catch (e) {
      get().toast({ kind: "error", title: "Could not start cost estimate", body: (e as Error).message });
    }
  },

  async clearPlan() {
    const id = get().stackId;
    if (!id) return;
    await api.clearPlan(id, get().envId);
    set({ plan: null, planStale: false });
  },

  async cancelJob(id) {
    await api.cancelJob(id).catch(() => undefined);
  },

  async openJob(id) {
    set({ activeJobId: id, bottomOpen: true, bottomTab: "logs" });
    const { job, logs } = await api.job(id);
    set((s) => ({ jobs: { ...s.jobs, [id]: job }, logs: { ...s.logs, [id]: logs } }));
  },

  handleEvent(e) {
    const s = get();
    switch (e.type) {
      case "job": {
        const prev = s.jobs[e.job.id];
        set({ jobs: { ...s.jobs, [e.job.id]: e.job } });
        if (prev?.status === "running" && e.job.status !== "running") {
          if (e.job.status === "failed") {
            get().toast({ kind: "error", title: `${e.job.title} failed`, body: e.job.error });
            if (e.job.kind !== "plan") set({ activeJobId: e.job.id, bottomOpen: true, bottomTab: "logs" });
          } else if (e.job.status === "succeeded" && e.job.stack === s.stackId) {
            if (e.job.kind === "plan") set({ bottomTab: "changes", bottomOpen: true });
            if (e.job.kind === "security") set({ bottomTab: "security", bottomOpen: true, view: { ...get().view, overlay: "security" } });
            if (e.job.kind === "cost") set({ bottomTab: "cost", bottomOpen: true, view: { ...get().view, overlay: "cost" } });
          }
        }
        break;
      }
      case "log":
        // Batch updates: logs can arrive at hundreds of lines per second.
        pendingLogs.push(e.log);
        if (!flushScheduled) {
          flushScheduled = true;
          requestAnimationFrame(flushLogs);
        }
        break;
      case "files-changed":
        get().reloadProject();
        if (!s.stackId || e.stacks.length === 0 || e.stacks.includes(s.stackId)) {
          get().reloadGraph(true);
          if (s.plan) set({ planStale: true });
        }
        if (e.files.length > 0) {
          get().toast({ kind: "info", title: "Configuration changed", body: e.files.slice(0, 3).join(", ") + (e.files.length > 3 ? ` +${e.files.length - 3} more` : "") });
        }
        break;
      case "plan":
        if (e.stack === s.stackId && (e.env ?? "") === (s.envId ?? "")) {
          api.plan(e.stack, e.env).then((p) => set({ plan: p.plan, planStale: p.stale }));
          get().reloadProject();
        }
        break;
      case "security":
        if (e.stack === s.stackId) api.security(e.stack).then((r) => set({ security: r.report }));
        break;
      case "cost":
        if (e.stack === s.stackId && (e.env ?? "") === (s.envId ?? "")) api.cost(e.stack, e.env).then((r) => set({ cost: r.report }));
        break;
    }
  },

  toast(t) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), t.kind === "error" ? 9000 : 4000);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

let pendingLogs: { jobId: string; line: LogLine }[] = [];
let flushScheduled = false;
function flushLogs() {
  flushScheduled = false;
  const batch = pendingLogs;
  pendingLogs = [];
  useStore.setState((s) => {
    const logs = { ...s.logs };
    for (const { jobId, line } of batch) {
      const arr = logs[jobId] === s.logs[jobId] ? [...(logs[jobId] ?? [])] : logs[jobId];
      arr.push(line);
      logs[jobId] = arr;
    }
    return { logs };
  });
}
