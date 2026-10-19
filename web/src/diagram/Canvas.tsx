import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { nodeInfo } from "../catalog";
import { useStore } from "../store";
import { Spinner } from "../ui";
import { HighlightContext, type Highlight } from "./context";
import { layoutDiagram, type LeafData } from "./layout";
import { buildDiagram, type Diagram } from "./model";
import { edgeTypes, nodeTypes } from "./nodes";
import { CanvasToolbar, PlanPill } from "./Overlay";

export function matchesSearch(q: string, id: string, label: string, type?: string, extra?: string) {
  const s = q.toLowerCase();
  return id.toLowerCase().includes(s) || label.toLowerCase().includes(s) || (type?.toLowerCase().includes(s) ?? false) || (extra?.toLowerCase().includes(s) ?? false);
}

function Flow() {
  const graph = useStore((s) => s.graph);
  const graphVersion = useStore((s) => s.graphVersion);
  const view = useStore((s) => s.view);
  const plan = useStore((s) => s.plan);
  const cost = useStore((s) => s.cost);
  const selected = useStore((s) => s.selected);
  const hovered = useStore((s) => s.hovered);
  const search = useStore((s) => s.search);
  const focusRequest = useStore((s) => s.focusRequest);
  const select = useStore((s) => s.select);
  const hover = useStore((s) => s.hover);
  const theme = useStore((s) => s.theme);
  const rf = useReactFlow();

  const [nodes, setNodes] = useState<Node<LeafData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [layingOut, setLayingOut] = useState(false);
  const lastStack = useRef<string | undefined>(undefined);
  const lastStructure = useRef<string>("");

  // Plan affects structure only through ghost nodes / changes-only filter.
  const planKey = plan && (view.changesOnly || plan.changes.some((c) => c.action === "delete")) ? plan.createdAt : "";

  const diagram: Diagram | undefined = useMemo(
    () => (graph ? buildDiagram(graph, view, planKey ? plan : null) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, graphVersion, view.grouping, view.showData, view.foldHelpers, view.changesOnly, view.hiddenCategories, view.hiddenProviders, planKey],
  );

  useEffect(() => {
    if (!diagram) return;
    let cancelled = false;
    setLayingOut(true);
    layoutDiagram(diagram, view.direction)
      .then((l) => {
        if (cancelled) return;
        setNodes(l.nodes);
        setEdges(l.edges);
        const structure = `${graph?.stack}|${view.grouping}|${view.direction}|${view.changesOnly}`;
        const refit = lastStack.current !== graph?.stack || lastStructure.current !== structure;
        lastStack.current = graph?.stack;
        lastStructure.current = structure;
        if (refit) requestAnimationFrame(() => rf.fitView({ padding: 0.12, duration: 350, maxZoom: 1.1 }));
      })
      .catch((e) => console.error("layout failed", e))
      .finally(() => !cancelled && setLayingOut(false));
    return () => {
      cancelled = true;
    };
  }, [diagram, view.direction, rf, graph?.stack, view.grouping, view.changesOnly]);

  useEffect(() => {
    if (!focusRequest || !diagram) return;
    const target = diagram.displayOf.get(focusRequest.id) ?? focusRequest.id;
    // Wait a frame or two so the canvas has resized for the details panel.
    const t = setTimeout(() => {
      const n = rf.getInternalNode(target);
      if (!n) return;
      const { x, y } = n.internals.positionAbsolute;
      const w = n.measured.width ?? 236;
      const h = n.measured.height ?? 62;
      rf.setCenter(x + w / 2, y + h / 2, { zoom: Math.max(rf.getZoom(), w > 600 ? 0.6 : 1.05), duration: 450 });
    }, 60);
    return () => clearTimeout(t);
  }, [focusRequest, rf, diagram]);

  const highlight: Highlight = useMemo(() => {
    const focusRaw = hovered ?? selected;
    const focus = focusRaw ? diagram?.displayOf.get(focusRaw) ?? focusRaw : undefined;
    const neighbors = new Set<string>();
    const edgeSet = new Set<string>();
    if (focus && diagram) {
      for (const e of diagram.edges) {
        if (e.source === focus || e.target === focus) {
          edgeSet.add(e.id);
          neighbors.add(e.source === focus ? e.target : e.source);
        }
      }
      // Keep ancestors visible so the focused node stays in context.
      let p = diagram.items.get(focus)?.parent;
      while (p) {
        neighbors.add(p);
        p = diagram.items.get(p)?.parent;
      }
      for (const nb of [...neighbors]) {
        let pp = diagram.items.get(nb)?.parent;
        while (pp) {
          neighbors.add(pp);
          pp = diagram.items.get(pp)?.parent;
        }
      }
    }
    let matches: Set<string> | undefined;
    const q = search.trim();
    if (q && diagram) {
      matches = new Set();
      for (const item of diagram.items.values()) {
        const n = item.node;
        const svc = n ? nodeInfo(n).service : "";
        const hit =
          matchesSearch(q, item.id, item.label, n?.type, svc) || item.folded.some((f) => matchesSearch(q, f.id, f.name, f.type));
        if (hit) {
          matches.add(item.id);
          let p = item.parent;
          while (p) {
            matches.add(p);
            p = diagram.items.get(p)?.parent;
          }
        }
      }
    }
    let maxCost = 0;
    if (cost) for (const v of Object.values(cost.nodes)) maxCost = Math.max(maxCost, v.monthlyCost);
    return { focus: focus && diagram?.items.has(focus) ? focus : undefined, neighbors, edges: edgeSet, matches, maxCost };
  }, [hovered, selected, diagram, search, cost]);

  const isEmpty = graph && graph.nodes.length === 0;

  return (
    <HighlightContext.Provider value={highlight}>
      <svg style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <marker id="arrow-idle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--c-edge)" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--c-accent)" />
          </marker>
        </defs>
      </svg>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, n) => select(n.id)}
        onNodeMouseEnter={(_, n) => (n.type === "leaf" ? hover(n.id) : undefined)}
        onNodeMouseLeave={() => hover(undefined)}
        onPaneClick={() => select(undefined)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.05}
        maxZoom={2.5}
        attributionPosition="bottom-center"
        colorMode={theme}
        onlyRenderVisibleElements={nodes.length > 400}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} />
        <CanvasToolbar />
        <PlanPill />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeStrokeWidth={2}
          nodeColor={(n) => ((n.data as LeafData).item.kind === "leaf" ? "var(--c-line-strong)" : "transparent")}
          nodeStrokeColor={(n) => ((n.data as LeafData).item.kind === "leaf" ? "transparent" : "var(--c-line-strong)")}
          style={{ width: 180, height: 120 }}
        />
      </ReactFlow>
      {layingOut && nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted">
          <Spinner className="h-6 w-6" />
        </div>
      )}
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted">
          <div className="text-sm font-medium text-fg">No resources in this stack</div>
          <div className="text-xs">Add resources or pick another stack in the sidebar.</div>
        </div>
      )}
    </HighlightContext.Provider>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <div className="relative h-full w-full" id="tfviz-canvas">
        <Flow />
      </div>
    </ReactFlowProvider>
  );
}
