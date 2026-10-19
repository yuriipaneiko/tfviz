import type { Graph, GraphNode, ModuleInfo, PlanChange, PlanResult } from "../api";
import { providerLabel, typeInfo } from "../catalog";
import type { ViewSettings } from "../store";

export type ContainerKind = "provider" | "vpc" | "subnet" | "module";

export interface Item {
  id: string;
  kind: "leaf" | "container";
  containerKind?: ContainerKind;
  node?: GraphNode; // resource behind a leaf, VPC/subnet container or unexpanded module
  module?: ModuleInfo;
  label: string;
  sublabel?: string;
  provider?: string;
  providerKey?: string; // "aws.us_east_1" for provider containers
  parent?: string;
  children: string[];
  folded: GraphNode[];
  ghost?: PlanChange;
  tone?: "public" | "private";
}

export interface DEdge {
  id: string;
  source: string;
  target: string;
  attrs: string[];
  kind: "ref" | "depends_on";
}

export interface Diagram {
  items: Map<string, Item>;
  roots: string[];
  edges: DEdge[];
  // graph node id -> item id it is displayed in (itself, or the resource it is folded into)
  displayOf: Map<string, string>;
}

const quiet = new Set(["no-op", "read"]);

function providerOf(source: string): string {
  // registry.terraform.io/hashicorp/aws -> aws
  return source.split("/").pop() ?? source;
}

function ghostNode(c: PlanChange): GraphNode {
  return {
    id: c.configAddress,
    kind: c.mode === "data" ? "data" : "resource",
    type: c.type,
    name: c.name,
    provider: providerOf(c.provider),
    module: c.module ?? "",
    file: "",
    absFile: "",
    line: 0,
    endLine: 0,
    textLine: 0,
    source: "",
    attrs: [],
  };
}

function attrText(n: GraphNode, path: string): string | undefined {
  return n.attrs.find((a) => a.path === path)?.text;
}

// Only literal strings are worth showing; expressions are resolved from the plan instead.
function literal(s?: string) {
  if (!s) return undefined;
  return s.startsWith('"') && s.endsWith('"') && !s.includes("${") ? s.slice(1, -1) : undefined;
}

export function providerSublabel(key: string, region?: string) {
  return [key.includes(".") ? key.split(".")[1] : undefined, region].filter(Boolean).join(" · ") || undefined;
}

const GENERIC_NAMES = new Set(["this", "main", "default", "self", "primary", "it", "resource", "this_resource"]);

export function displayName(n: GraphNode): string {
  if (n.kind === "module") return `module.${n.name}`;
  if (GENERIC_NAMES.has(n.name) && n.module) {
    const parts = n.module.split(".");
    return parts[parts.length - 1];
  }
  return n.name;
}

function subnetTone(n: GraphNode | undefined, label: string): "public" | "private" {
  const name = `${n?.name ?? ""} ${label}`.toLowerCase();
  if (n && attrText(n, "map_public_ip_on_launch") === "true") return "public";
  if (/public|pub\b|dmz|edge|ingress/.test(name)) return "public";
  return "private";
}

export function buildDiagram(graph: Graph, view: ViewSettings, plan?: PlanResult | null): Diagram {
  const nodes = new Map<string, GraphNode>();
  for (const n of graph.nodes) nodes.set(n.id, n);

  const ghosts = new Map<string, PlanChange>();
  if (plan) {
    for (const c of plan.changes) {
      if (!nodes.has(c.configAddress) && !ghosts.has(c.configAddress) && !quiet.has(c.action)) {
        ghosts.set(c.configAddress, c);
        nodes.set(c.configAddress, ghostNode(c));
      }
    }
  }

  const hiddenCats = new Set(view.hiddenCategories);
  const hiddenProv = new Set(view.hiddenProviders);
  const isContainerNode = (n: GraphNode) =>
    view.grouping === "network" && (n.network?.role === "vpc" || n.network?.role === "subnet");

  const baseVisible = (n: GraphNode): boolean => {
    if (hiddenProv.has(n.provider)) return false;
    if (isContainerNode(n)) return true;
    if (n.kind === "data" && !view.showData) return false;
    if (n.kind !== "module" && hiddenCats.has(typeInfo(n.type).category)) return false;
    return true;
  };

  // Representative item for each graph node.
  const displayOf = new Map<string, string>();
  const resolveRep = (id: string, depth = 0): string | undefined => {
    const n = nodes.get(id);
    if (!n || depth > 10) return undefined;
    if (view.foldHelpers && n.foldInto && nodes.has(n.foldInto)) {
      return resolveRep(n.foldInto, depth + 1);
    }
    return baseVisible(n) ? id : undefined;
  };
  for (const id of nodes.keys()) {
    const r = resolveRep(id);
    if (r) displayOf.set(id, r);
  }

  const items = new Map<string, Item>();
  const ensure = (item: Item) => {
    if (!items.has(item.id)) items.set(item.id, item);
    return items.get(item.id)!;
  };

  // Leaves and resource-backed containers.
  for (const [id, rep] of displayOf) {
    if (id !== rep) continue;
    const n = nodes.get(id)!;
    const container = isContainerNode(n) || (view.grouping === "network" && n.kind === "module" && n.network?.role === "vpc");
    let kind: ContainerKind | undefined;
    if (container) kind = n.network?.role === "subnet" ? "subnet" : "vpc";
    const label = displayName(n);
    const item = ensure({
      id,
      kind: container ? "container" : "leaf",
      containerKind: kind,
      node: n,
      label,
      provider: n.providerConfig || n.provider,
      children: [],
      folded: [],
      ghost: ghosts.get(id),
    });
    if (kind === "vpc") item.sublabel = literal(attrText(n, "cidr_block")) ?? (n.kind === "module" ? n.moduleSource : undefined);
    if (kind === "subnet") {
      item.tone = subnetTone(n, label);
      item.sublabel = literal(attrText(n, "cidr_block"));
    }
  }
  for (const [id, rep] of displayOf) {
    if (id !== rep) items.get(rep)?.folded.push(nodes.get(id)!);
  }

  // Containment.
  const parentOf = new Map<string, string>();
  if (view.grouping === "network") {
    for (const c of graph.containers) {
      if (!items.has(c.parent)) continue;
      ensure({ id: c.id, kind: "container", containerKind: "subnet", label: c.label, children: [], folded: [], tone: subnetTone(undefined, c.label) });
      parentOf.set(c.id, c.parent);
    }
    for (const item of items.values()) {
      const p = item.node?.network?.parent;
      if (item.node && p && items.has(p) && items.get(p)!.kind === "container") parentOf.set(item.id, p);
    }
    // Provider groups (e.g. "AWS · eu-west-1") around everything without a network parent.
    const providers = new Map(graph.providers.map((p) => [p.alias ? `${p.name}.${p.alias}` : p.name, p]));
    for (const item of [...items.values()]) {
      if (parentOf.has(item.id) || item.containerKind === "provider") continue;
      let key = item.provider ?? item.node?.provider;
      if (!key && item.containerKind === "subnet") continue;
      if (!key || key === "module") continue;
      const base = key.split(".")[0];
      const pv = providers.get(key) ?? providers.get(base);
      const gid = `provider:${key}`;
      ensure({
        id: gid,
        kind: "container",
        containerKind: "provider",
        label: base === "aws" ? "AWS Cloud" : providerLabel(base),
        sublabel: providerSublabel(key, pv?.region),
        provider: base,
        providerKey: key,
        children: [],
        folded: [],
      });
      parentOf.set(item.id, gid);
    }
  } else if (view.grouping === "module") {
    for (const m of graph.modules) {
      if (!m.id || !m.expanded) continue;
      ensure({ id: m.id, kind: "container", containerKind: "module", module: m, label: `module.${m.name}`, sublabel: m.source, children: [], folded: [] });
    }
    for (const m of graph.modules) {
      if (m.id && m.expanded && m.parent && items.has(m.parent)) parentOf.set(m.id, m.parent);
    }
    for (const item of items.values()) {
      const mod = item.node?.module;
      if (item.node && mod && items.has(mod)) parentOf.set(item.id, mod);
    }
  }

  // Changes-only filter: keep changed leaves and the containers around them.
  if (view.changesOnly && plan) {
    const changed = (id: string) => {
      const a = plan.nodes[id]?.action;
      return !!a && !quiet.has(a);
    };
    const keep = new Set<string>();
    for (const item of items.values()) {
      const n = item.node;
      const hit = changed(item.id) || item.folded.some((f) => changed(f.id));
      if (hit && n) {
        let cur: string | undefined = item.id;
        while (cur && !keep.has(cur)) {
          keep.add(cur);
          cur = parentOf.get(cur);
        }
      }
    }
    for (const id of [...items.keys()]) {
      if (!keep.has(id)) {
        items.delete(id);
        parentOf.delete(id);
      }
    }
    for (const [id, rep] of [...displayOf]) if (!items.has(rep)) displayOf.delete(id);
  }

  // Prune empty structural containers (provider/module/synthetic subnets).
  const childCount = new Map<string, number>();
  for (const [c, p] of parentOf) if (items.has(c)) childCount.set(p, (childCount.get(p) ?? 0) + 1);
  for (const item of [...items.values()]) {
    if (item.kind === "container" && !item.node && !childCount.get(item.id)) {
      items.delete(item.id);
      const p = parentOf.get(item.id);
      parentOf.delete(item.id);
      if (p) childCount.set(p, (childCount.get(p) ?? 1) - 1);
    }
  }

  const roots: string[] = [];
  for (const item of items.values()) {
    const p = parentOf.get(item.id);
    if (p && items.has(p)) {
      item.parent = p;
      items.get(p)!.children.push(item.id);
    } else {
      roots.push(item.id);
    }
  }

  const ancestors = (id: string) => {
    const out = new Set<string>();
    let cur = items.get(id)?.parent;
    while (cur) {
      out.add(cur);
      cur = items.get(cur)?.parent;
    }
    return out;
  };

  const edges = new Map<string, DEdge>();
  for (const e of graph.edges) {
    const s = displayOf.get(e.source);
    const t = displayOf.get(e.target);
    if (!s || !t || s === t || !items.has(s) || !items.has(t)) continue;
    if (ancestors(s).has(t) || ancestors(t).has(s)) continue;
    const id = `${s}->${t}`;
    const cur = edges.get(id);
    if (cur) {
      for (const a of e.attrs) if (!cur.attrs.includes(a)) cur.attrs.push(a);
      if (e.kind === "ref") cur.kind = "ref";
    } else {
      edges.set(id, { id, source: s, target: t, attrs: [...e.attrs], kind: e.kind });
    }
  }

  return { items, roots, edges: [...edges.values()], displayOf };
}
