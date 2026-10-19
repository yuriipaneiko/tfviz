import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { Edge, Node } from "@xyflow/react";
import type { Diagram, Item } from "./model";

export const LEAF_W = 236;
export const LEAF_H = 62;
const HEADER = 46;

const elk = new ELK();

export interface LeafData extends Record<string, unknown> {
  item: Item;
}

export interface Layout {
  nodes: Node<LeafData>[];
  edges: Edge[];
}

function containerPadding(item: Item) {
  const side = item.containerKind === "provider" ? 28 : 22;
  return `[top=${HEADER + 10},left=${side},bottom=${side},right=${side}]`;
}

export async function layoutDiagram(d: Diagram, direction: "RIGHT" | "DOWN"): Promise<Layout> {
  const toElk = (id: string): ElkNode => {
    const item = d.items.get(id)!;
    if (item.kind === "leaf") return { id, width: LEAF_W, height: LEAF_H };
    return {
      id,
      layoutOptions: {
        "elk.padding": containerPadding(item),
        "elk.nodeSize.constraints": "MINIMUM_SIZE",
        "elk.nodeSize.minimum": "(260, 110)",
      },
      children: item.children.map(toElk),
    };
  };

  const edges: ElkExtendedEdge[] = d.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));
  const root: ElkNode = {
    id: "__root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64",
      "elk.spacing.nodeNode": "26",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.componentComponent": "48",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
      "elk.separateConnectedComponents": "true",
      "elk.aspectRatio": "1.6",
      "elk.edgeRouting": "ORTHOGONAL",
    },
    children: d.roots.map(toElk),
    edges,
  };

  const res = await elk.layout(root);

  const nodes: Node<LeafData>[] = [];
  const walk = (n: ElkNode, parent?: string, depth = 0) => {
    const item = d.items.get(n.id);
    if (item) {
      nodes.push({
        id: n.id,
        type: item.kind === "leaf" ? "leaf" : "container",
        position: { x: n.x ?? 0, y: n.y ?? 0 },
        parentId: parent,
        data: { item },
        width: n.width,
        height: n.height,
        style: { width: n.width, height: n.height },
        draggable: false,
        selectable: true,
        zIndex: item.kind === "leaf" ? 1000 + depth : depth,
      });
    }
    for (const c of n.children ?? []) walk(c, item ? n.id : undefined, depth + 1);
  };
  for (const c of res.children ?? []) walk(c);

  const flowEdges: Edge[] = d.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "dep",
    data: { attrs: e.attrs, kind: e.kind },
    zIndex: 900,
  }));

  return { nodes, edges: flowEdges };
}
