import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Handle, Position, type EdgeProps, type NodeProps, type Node } from "@xyflow/react";
import clsx from "clsx";
import { Boxes, Layers, Puzzle, ShieldAlert, Database } from "lucide-react";
import { memo } from "react";
import { AWS_CLOUD_ICON, nodeInfo, PRIVATE_SUBNET_ICON, providerColor, PUBLIC_SUBNET_ICON, VPC_ICON } from "../catalog";
import { useStore } from "../store";
import { ACTIONS, money } from "../ui";
import { useHighlight } from "./context";
import type { LeafData } from "./layout";
import { providerSublabel, type Item } from "./model";

function Handles() {
  const dir = useStore((s) => s.view.direction);
  const horiz = dir === "RIGHT";
  return (
    <>
      <Handle type="target" position={horiz ? Position.Left : Position.Top} isConnectable={false} />
      <Handle type="source" position={horiz ? Position.Right : Position.Bottom} isConnectable={false} />
    </>
  );
}

function useOverlay(item: Item) {
  const id = item.id;
  const overlay = useStore((s) => s.view.overlay);
  const planNode = useStore((s) => s.plan?.nodes[id]);
  const foldedChange = useStore((s) => {
    if (!s.plan) return undefined;
    for (const f of item.folded) {
      const a = s.plan.nodes[f.id]?.action;
      if (a && a !== "no-op" && a !== "read") return a;
    }
    return undefined;
  });
  const hasPlan = useStore((s) => !!s.plan);
  const findings = useStore((s) => {
    if (!s.security) return 0;
    let n = s.security.nodes[id] ?? 0;
    for (const f of item.folded) n += s.security.nodes[f.id] ?? 0;
    return n;
  });
  const cost = useStore((s) => {
    if (!s.cost) return undefined;
    let total: number | undefined;
    for (const k of [id, ...item.folded.map((f) => f.id)]) {
      const c = s.cost.nodes[k];
      if (c) total = (total ?? 0) + c.monthlyCost;
    }
    return total;
  });
  const currency = useStore((s) => s.cost?.currency ?? "USD");
  const action = item.ghost ? item.ghost.action : planNode?.action;
  const effective = action && action !== "no-op" && action !== "read" ? action : foldedChange ? "update" : action;
  return { overlay, action: effective, instances: planNode?.instances ?? 0, hasPlan, findings, cost, currency };
}

function useDim(id: string) {
  const h = useHighlight();
  const selected = useStore((s) => s.selected === id);
  const searching = !!h.matches;
  const match = h.matches?.has(id) ?? false;
  const related = h.focus === id || h.neighbors.has(id);
  const dimmed = (searching && !match) || (!!h.focus && !related && !searching);
  return { selected, dimmed, match: searching && match, related: !!h.focus && related };
}

function Icon({ item, size = 34 }: { item: Item; size?: number }) {
  const n = item.node!;
  const info = nodeInfo(n);
  if (info.icon) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-lg"
        style={{ width: size, height: size, background: info.icon.includes("/resource/") ? `color-mix(in srgb, ${info.color} 12%, transparent)` : undefined }}
      >
        <img src={info.icon} alt="" draggable={false} className="rounded-md" style={{ width: info.icon.includes("/resource/") ? size - 8 : size, height: info.icon.includes("/resource/") ? size - 8 : size }} />
      </div>
    );
  }
  const color = n.kind === "module" ? "#7B8494" : providerColor(n.provider);
  return (
    <div className="flex shrink-0 items-center justify-center rounded-lg text-white" style={{ width: size, height: size, background: color }}>
      {n.kind === "module" ? <Puzzle size={size * 0.5} /> : <span className="text-[11px] font-bold uppercase">{n.provider.slice(0, 2)}</span>}
    </div>
  );
}

export const LeafNode = memo(function LeafNode({ data }: NodeProps<Node<LeafData>>) {
  const item = data.item;
  const n = item.node!;
  const info = nodeInfo(n);
  const { overlay, action, instances, hasPlan, findings, cost, currency } = useOverlay(item);
  const { selected, dimmed, match, related } = useDim(item.id);
  const maxCost = useHighlight().maxCost;

  let border = "var(--c-line)";
  let tint: string | undefined;
  let faded = false;
  if (overlay === "plan" && hasPlan) {
    if (action && action !== "no-op" && action !== "read") {
      border = ACTIONS[action].color;
      tint = ACTIONS[action].color;
    } else faded = true;
  } else if (overlay === "security" && findings > 0) {
    border = "var(--color-delete)";
    tint = "var(--color-delete)";
  } else if (overlay === "cost" && cost !== undefined && maxCost > 0) {
    const r = cost / maxCost;
    const c = r > 0.5 ? "#ef4444" : r > 0.15 ? "#f59e0b" : "#22c55e";
    border = c;
    tint = c;
  }
  const ghost = !!item.ghost;

  return (
    <div
      className={clsx(
        "group relative flex h-full w-full items-center gap-2.5 rounded-xl border px-2.5 transition-all duration-150",
        selected && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
        match && "ring-2 ring-update",
        ghost && "border-dashed",
      )}
      style={{
        borderColor: border,
        borderWidth: tint ? 1.5 : 1,
        background: tint ? `color-mix(in srgb, ${tint} 7%, var(--c-node))` : "var(--c-node)",
        boxShadow: related || selected ? "0 4px 18px -4px color-mix(in srgb, var(--c-accent) 45%, transparent)" : "var(--c-shadow)",
        opacity: dimmed ? 0.28 : faded ? 0.55 : 1,
      }}
    >
      <Handles />
      <Icon item={item} />
      <div className="min-w-0 flex-1">
        <div className={clsx("truncate text-[13px] font-semibold leading-tight text-fg", ghost && "line-through decoration-delete/70")} title={item.id}>
          {item.label}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] leading-tight text-muted">
          {n.kind === "data" && <Database size={10} className="shrink-0" />}
          <span className="truncate" title={n.type}>
            {n.kind === "module" ? info.service : info.service}
          </span>
          {n.multi && (
            <span className="shrink-0 rounded bg-panel-3 px-1 font-mono text-[10px] text-fg/80" title={`${n.multi} = ${n.multiExpr}`}>
              {instances > 1 ? `×${instances}` : n.multi === "count" ? "×n" : "×each"}
            </span>
          )}
          {item.folded.length > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 rounded bg-panel-3 px-1 text-[10px] text-fg/70" title={item.folded.map((f) => f.type + "." + f.name).join("\n")}>
              <Layers size={9} />
              {item.folded.length}
            </span>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute -top-2.5 right-2 flex gap-1">
        {action && action !== "no-op" && hasPlan && (
          <span
            className="flex h-5 items-center gap-1 rounded-full px-1.5 text-[10px] font-bold text-white shadow"
            style={{ background: ACTIONS[action].color }}
            title={`${ACTIONS[action].label}${instances > 1 ? ` (${instances} instances)` : ""}`}
          >
            {ACTIONS[action].symbol} {ACTIONS[action].label.toLowerCase()}
          </span>
        )}
        {findings > 0 && (
          <span className="flex h-5 items-center gap-0.5 rounded-full bg-delete px-1.5 text-[10px] font-bold text-white shadow" title={`${findings} failed security checks`}>
            <ShieldAlert size={10} />
            {findings}
          </span>
        )}
      </div>
      {cost !== undefined && cost > 0 && (
        <span className="pointer-events-none absolute -bottom-2.5 right-2 rounded-full border border-line bg-panel px-1.5 text-[10px] font-semibold text-fg shadow-sm">
          {money(cost, currency)}/mo
        </span>
      )}
    </div>
  );
});

const CONTAINER_STYLE: Record<string, { color: string; icon?: string }> = {
  provider: { color: "#7B8494", icon: AWS_CLOUD_ICON },
  vpc: { color: "#8C4FFF", icon: VPC_ICON },
  public: { color: "#7AA116", icon: PUBLIC_SUBNET_ICON },
  private: { color: "#00A4A6", icon: PRIVATE_SUBNET_ICON },
  module: { color: "#7B8494" },
};

export const ContainerNode = memo(function ContainerNode({ data }: NodeProps<Node<LeafData>>) {
  const item = data.item;
  const kind = item.containerKind!;
  const styleKey = kind === "subnet" ? item.tone ?? "private" : kind;
  const st = CONTAINER_STYLE[styleKey];
  const color = kind === "provider" && item.provider !== "aws" ? providerColor(item.provider ?? "") : st.color;
  const { selected, dimmed, match } = useDim(item.id);
  const { overlay, action, hasPlan, findings } = useOverlay(item);
  const n = item.node;
  const selectable = !!n || !!item.module;
  const plannedCidrs = useStore((s) => {
    if (item.sublabel || !s.plan || !n) return "";
    const cidrs = s.plan.changes
      .filter((c) => c.configAddress === item.id)
      .map((c) => c.attrs.find((a) => a.path === "cidr_block")?.after)
      .filter((v): v is string => typeof v === "string");
    return cidrs.length ? cidrs[0] + (cidrs.length > 1 ? `  +${cidrs.length - 1} more` : "") : "";
  });
  const plannedRegion = useStore((s) => (item.providerKey ? s.plan?.providerRegions?.[item.providerKey] : undefined));
  const sublabel = plannedRegion ? providerSublabel(item.providerKey!, plannedRegion) : item.sublabel ?? (plannedCidrs || undefined);

  return (
    <div
      className={clsx(
        "relative h-full w-full rounded-2xl transition-all",
        kind === "module" && "border-dashed",
        selected && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
        match && "ring-2 ring-update",
      )}
      style={{
        border: `${kind === "provider" ? 1 : 1.5}px ${kind === "module" ? "dashed" : "solid"} color-mix(in srgb, ${color} ${kind === "provider" ? 45 : 70}%, transparent)`,
        background: kind === "provider" ? "color-mix(in srgb, var(--c-panel) 35%, transparent)" : `color-mix(in srgb, ${color} ${kind === "subnet" ? 6 : 4}%, transparent)`,
        opacity: dimmed ? 0.55 : 1,
        pointerEvents: "none",
      }}
    >
      <Handles />
      <div
        className={clsx("absolute left-0 right-0 top-0 flex h-[46px] items-center gap-2.5 px-3", selectable && "cursor-pointer")}
        style={{ pointerEvents: selectable ? "all" : "none" }}
      >
        {st.icon && (kind !== "provider" || item.provider === "aws") ? (
          <img src={st.icon} alt="" className="h-7 w-7 shrink-0 rounded-md" draggable={false} />
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white" style={{ background: color }}>
            {kind === "module" ? <Boxes size={15} /> : <span className="text-[10px] font-bold uppercase">{(item.provider ?? "?").slice(0, 2)}</span>}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-fg">{item.label}</span>
            {kind === "subnet" && (
              <span className="rounded px-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}>
                {item.tone}
              </span>
            )}
            {n?.multi && (
              <span className="rounded bg-panel-3 px-1 font-mono text-[10px] text-fg/80" title={`${n.multi} = ${n.multiExpr}`}>
                {n.multi === "count" ? "count" : "for_each"}
              </span>
            )}
            {item.module?.multi && <span className="rounded bg-panel-3 px-1 font-mono text-[10px] text-fg/80">{item.module.multi}</span>}
          </div>
          {sublabel && <div className="truncate font-mono text-[11px] text-muted">{sublabel}</div>}
        </div>
        <div className="flex gap-1">
          {overlay === "plan" && hasPlan && action && action !== "no-op" && action !== "read" && (
            <span className="flex h-5 items-center rounded-full px-1.5 text-[10px] font-bold text-white" style={{ background: ACTIONS[action].color }}>
              {ACTIONS[action].symbol} {ACTIONS[action].label.toLowerCase()}
            </span>
          )}
          {findings > 0 && (
            <span className="flex h-5 items-center gap-0.5 rounded-full bg-delete px-1.5 text-[10px] font-bold text-white">
              <ShieldAlert size={10} />
              {findings}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

export const DepEdge = memo(function DepEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const h = useHighlight();
  const mode = useStore((s) => s.view.edges);
  const active = h.edges.has(id);
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14, offset: 18 });
  if (mode === "none" || (mode === "focus" && !active)) return null;
  const faded = !!h.focus && !active;
  const dashed = (data as { kind?: string })?.kind === "depends_on";
  const attrs = ((data as { attrs?: string[] })?.attrs ?? []).filter((a) => a !== "depends_on");
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={active ? "edge-flow" : undefined}
        markerEnd={`url(#arrow-${active ? "active" : "idle"})`}
        style={{
          stroke: active ? "var(--c-accent)" : "var(--c-edge)",
          strokeWidth: active ? 2 : 1.25,
          strokeDasharray: dashed && !active ? "4 4" : undefined,
          opacity: faded ? 0.12 : active ? 1 : 0.7,
          transition: "opacity 120ms",
        }}
      />
      {active && attrs.length > 0 && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-md border border-line bg-panel px-1.5 py-0.5 font-mono text-[10px] text-muted shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, zIndex: 2000 }}
          >
            {attrs.slice(0, 2).join(", ")}
            {attrs.length > 2 && ` +${attrs.length - 2}`}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export const nodeTypes = { leaf: LeafNode, container: ContainerNode };
export const edgeTypes = { dep: DepEdge };
