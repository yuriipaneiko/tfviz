import { createContext, useContext } from "react";

export interface Highlight {
  focus?: string; // selected or hovered item
  neighbors: Set<string>;
  edges: Set<string>;
  matches?: Set<string>; // search hits (undefined when not searching)
  maxCost: number;
}

export const HighlightContext = createContext<Highlight>({ neighbors: new Set(), edges: new Set(), maxCost: 0 });

export const useHighlight = () => useContext(HighlightContext);
