import { getNodesBounds, useReactFlow } from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";
import { AlertTriangle, ArrowDownToLine, ArrowRightToLine, Download, Image as ImageIcon, Maximize, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { ACTIONS, IconButton, timeAgo } from "../ui";
import type { PlanAction } from "../api";

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

export function CanvasToolbar() {
  const rf = useReactFlow();
  const direction = useStore((s) => s.view.direction);
  const setView = useStore((s) => s.setView);
  const stack = useStore((s) => s.stackId);
  const toast = useStore((s) => s.toast);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  const exportImage = async (format: "png" | "svg") => {
    setMenu(false);
    const el = document.querySelector<HTMLElement>("#tfviz-canvas .react-flow__viewport");
    if (!el) return;
    const bounds = getNodesBounds(rf.getNodes());
    const pad = 48;
    const width = Math.ceil(bounds.width + pad * 2);
    const height = Math.ceil(bounds.height + pad * 2);
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--c-bg").trim() || "#0b0e14";
    const opts = {
      backgroundColor: bg,
      width,
      height,
      pixelRatio: format === "png" ? (width * height > 16e6 ? 1 : 2) : 1,
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${pad - bounds.x}px, ${pad - bounds.y}px) scale(1)` },
    };
    try {
      const url = format === "png" ? await toPng(el, opts) : await toSvg(el, opts);
      download(url, `${(stack ?? "diagram").replace(/[^\w.-]+/g, "_")}.${format}`);
    } catch (e) {
      toast({ kind: "error", title: "Export failed", body: (e as Error).message });
    }
  };

  return (
    <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-xl border border-line bg-panel/95 p-1 shadow-lg backdrop-blur" ref={ref}>
      <IconButton title="Fit to screen (F)" onClick={() => rf.fitView({ padding: 0.12, duration: 300 })}>
        <Maximize size={15} />
      </IconButton>
      <IconButton
        title={direction === "RIGHT" ? "Layout: left → right" : "Layout: top → bottom"}
        onClick={() => setView({ direction: direction === "RIGHT" ? "DOWN" : "RIGHT" })}
      >
        {direction === "RIGHT" ? <ArrowRightToLine size={15} /> : <ArrowDownToLine size={15} />}
      </IconButton>
      <div className="relative">
        <IconButton title="Export diagram" onClick={() => setMenu((m) => !m)} active={menu}>
          <Download size={15} />
        </IconButton>
        {menu && (
          <div className="absolute right-0 top-10 w-44 overflow-hidden rounded-xl border border-line bg-panel p-1 shadow-xl">
            <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-panel-2" onClick={() => exportImage("png")}>
              <ImageIcon size={14} className="text-muted" /> Export as PNG
            </button>
            <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-panel-2" onClick={() => exportImage("svg")}>
              <ImageIcon size={14} className="text-muted" /> Export as SVG
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function PlanPill() {
  const plan = useStore((s) => s.plan);
  const stale = useStore((s) => s.planStale);
  const overlay = useStore((s) => s.view.overlay);
  const setView = useStore((s) => s.setView);
  const clearPlan = useStore((s) => s.clearPlan);
  const set = useStore((s) => s.set);
  if (!plan) return null;
  const sm = plan.summary;
  const items: [PlanAction, number][] = [
    ["create", sm.create],
    ["update", sm.update],
    ["replace", sm.replace],
    ["delete", sm.delete],
  ];
  const total = sm.create + sm.update + sm.replace + sm.delete;
  return (
    <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-140px)] items-center gap-2 overflow-hidden whitespace-nowrap rounded-xl border border-line bg-panel/95 py-1 pl-3 pr-1 shadow-lg backdrop-blur">
      <button
        className="flex items-center gap-2.5 text-[12px]"
        onClick={() => {
          setView({ overlay: "plan" });
          set({ bottomOpen: true, bottomTab: "changes" });
        }}
        title="Show plan changes"
      >
        <span className="font-semibold text-fg">{plan.options?.destroy ? "Destroy plan" : "Plan"}</span>
        {total === 0 ? (
          <span className="text-muted">No changes · infrastructure matches configuration</span>
        ) : (
          items.map(([a, n]) =>
            n > 0 ? (
              <span key={a} className="flex items-center gap-1 font-semibold" style={{ color: ACTIONS[a].color }}>
                <span className="text-[13px]">{ACTIONS[a].symbol}</span>
                {n} <span className="font-normal text-muted">{ACTIONS[a].verb}</span>
              </span>
            ) : null,
          )
        )}
        <span className="text-faint">· {timeAgo(plan.createdAt)}</span>
      </button>
      {stale && (
        <span className="flex items-center gap-1 rounded-md bg-update/15 px-1.5 py-0.5 text-[11px] font-medium text-update" title="Configuration changed since this plan was created">
          <AlertTriangle size={11} /> outdated
        </span>
      )}
      {overlay !== "plan" && (
        <button className="rounded-md px-1.5 py-0.5 text-[11px] text-accent hover:bg-panel-2" onClick={() => setView({ overlay: "plan" })}>
          Show
        </button>
      )}
      <IconButton className="h-7 w-7" title="Clear plan overlay" onClick={() => clearPlan()}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
