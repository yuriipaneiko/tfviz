import clsx from "clsx";
import { Boxes, CircleDollarSign, FolderTree, Highlighter, Moon, Network, Play, Puzzle, Rows3, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { nodeInfo } from "../catalog";
import { displayName } from "../diagram/model";
import { useStore } from "../store";
import { ACTIONS } from "../ui";

interface Entry {
  id: string;
  group: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  score: number;
  run: () => void;
}

function score(q: string, ...fields: (string | undefined)[]) {
  let best = 0;
  for (const [i, f] of fields.entries()) {
    if (!f) continue;
    const s = f.toLowerCase();
    const w = 1 - i * 0.15;
    if (s === q) best = Math.max(best, 100 * w);
    else if (s.startsWith(q)) best = Math.max(best, 80 * w);
    else if (s.includes(q)) best = Math.max(best, 50 * w - s.indexOf(q) * 0.1);
    else {
      // Subsequence match (e.g. "albsg" -> "alb_security_group")
      let j = 0;
      for (const ch of s) if (ch === q[j]) j++;
      if (j === q.length) best = Math.max(best, 20 * w);
    }
  }
  return best;
}

export function Palette() {
  const open = useStore((s) => s.paletteOpen);
  const set = useStore((s) => s.set);
  const graph = useStore((s) => s.graph);
  const plan = useStore((s) => s.plan);
  const project = useStore((s) => s.project);
  const select = useStore((s) => s.select);
  const selectStack = useStore((s) => s.selectStack);
  const setSearch = useStore((s) => s.setSearch);
  const setView = useStore((s) => s.setView);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const runSecurity = useStore((s) => s.runSecurity);
  const runCost = useStore((s) => s.runCost);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
    }
  }, [open]);

  const close = () => set({ paletteOpen: false });

  const entries = useMemo(() => {
    const query = q.trim().toLowerCase();
    const out: Entry[] = [];
    const actions: Omit<Entry, "score">[] = [
      { id: "a:plan", group: "Actions", icon: <Play size={14} />, title: "Run terraform plan…", run: () => set({ planDialogOpen: true }) },
      { id: "a:sec", group: "Actions", icon: <ShieldCheck size={14} />, title: "Run security scan (Checkov)", run: () => runSecurity() },
      { id: "a:cost", group: "Actions", icon: <CircleDollarSign size={14} />, title: "Estimate cost (C3X)", run: () => runCost() },
      { id: "a:net", group: "Actions", icon: <Network size={14} />, title: "Group by network", run: () => setView({ grouping: "network" }) },
      { id: "a:mod", group: "Actions", icon: <Boxes size={14} />, title: "Group by module", run: () => setView({ grouping: "module" }) },
      { id: "a:flat", group: "Actions", icon: <Rows3 size={14} />, title: "Flat dependency graph", run: () => setView({ grouping: "flat" }) },
      { id: "a:theme", group: "Actions", icon: <Moon size={14} />, title: "Toggle dark / light theme", run: () => toggleTheme() },
    ];
    if (query) {
      out.push({
        id: "hl",
        group: "Highlight",
        icon: <Highlighter size={14} />,
        title: `Highlight all matches for “${q.trim()}”`,
        subtitle: "Dims everything else on the canvas",
        score: 1000,
        run: () => setSearch(q.trim()),
      });
    }
    for (const n of graph?.nodes ?? []) {
      const info = nodeInfo(n);
      const label = displayName(n);
      const sc = query ? score(query, label, n.name, n.id, n.type, info.service) : 1;
      if (sc <= 0) continue;
      const a = plan?.nodes[n.id]?.action;
      out.push({
        id: n.id,
        group: "Resources",
        icon: info.icon ? <img src={info.icon} className="h-5 w-5 rounded" alt="" /> : <Puzzle size={14} />,
        title: label,
        subtitle: n.id,
        right: (
          <span className="flex items-center gap-2">
            {a && a !== "no-op" && (
              <span className="text-[12px] font-bold" style={{ color: ACTIONS[a].color }}>
                {ACTIONS[a].symbol}
              </span>
            )}
            <span className="text-[11px] text-faint">{info.service}</span>
          </span>
        ),
        score: sc + (n.kind === "data" ? -5 : 0) + (n.foldInto ? -3 : 0),
        run: () => select(n.id, true),
      });
    }
    for (const m of graph?.modules ?? []) {
      if (!m.id || !m.expanded) continue;
      const sc = query ? score(query, m.name, m.id, m.source) : 1;
      if (sc <= 0) continue;
      out.push({ id: m.id, group: "Modules", icon: <Boxes size={14} />, title: `module.${m.name}`, subtitle: m.source, score: sc, run: () => select(m.id, true) });
    }
    for (const s of project?.stacks ?? []) {
      const sc = query ? score(query, s.id, s.name) : 0.5;
      if (sc <= 0) continue;
      out.push({ id: "s:" + s.id, group: "Stacks", icon: <FolderTree size={14} />, title: s.id, subtitle: s.kind === "module" ? "reusable module" : "root module", score: sc, run: () => selectStack(s.id) });
      for (const e of s.envs ?? []) {
        const esc = query ? score(query, e.name, s.id, e.varFile, e.backendConfig) : 0;
        if (esc <= 0) continue;
        out.push({
          id: `s:${s.id}#${e.name}`,
          group: "Stacks",
          icon: <FolderTree size={14} />,
          title: `${s.id} · ${e.name}`,
          subtitle: [e.varFile, e.backendConfig].filter(Boolean).join(" · "),
          score: esc + 2,
          run: () => selectStack(s.id, e.name),
        });
      }
    }
    for (const a of actions) {
      const sc = query ? score(query, a.title) : 0.2;
      if (sc > 0) out.push({ ...a, score: sc });
    }
    out.sort((a, b) => b.score - a.score);
    return query ? out.slice(0, 60) : [...out.filter((e) => e.group === "Actions"), ...out.filter((e) => e.group === "Resources").slice(0, 12)];
  }, [q, graph, plan, project, set, select, selectStack, setSearch, setView, toggleTheme, runSecurity, runCost]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(entries.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const entry = entries[idx];
      if (entry) {
        close();
        entry.run();
      }
    } else if (e.key === "Escape") close();
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[14vh] backdrop-blur-[2px]" onMouseDown={close}>
      <div className="w-[620px] overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={onKey}
            placeholder="Search resources, types, modules, stacks, actions…"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          <kbd>esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[420px] overflow-y-auto p-1.5">
          {entries.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-muted">No results</div>}
          {entries.map((e, i) => {
            const header = e.group !== lastGroup;
            lastGroup = e.group;
            return (
              <div key={e.id}>
                {header && <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{e.group}</div>}
                <button
                  data-idx={i}
                  onMouseMove={() => setIdx(i)}
                  onClick={() => {
                    close();
                    e.run();
                  }}
                  className={clsx("flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left", i === idx ? "bg-panel-2" : undefined)}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center text-muted">{e.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{e.title}</span>
                    {e.subtitle && <span className="block truncate font-mono text-[11px] text-faint">{e.subtitle}</span>}
                  </span>
                  {e.right}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 border-t border-line px-4 py-2 text-[11px] text-faint">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
        </div>
      </div>
    </div>
  );
}
