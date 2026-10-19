import clsx from "clsx";
import { Boxes, ChevronDown, ChevronRight, CircleDot, FolderTree, Layers, Network, Rows3, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CATEGORIES, nodeInfo, providerColor, providerLabel, type Category } from "../catalog";
import { useStore } from "../store";
import { ACTIONS, SectionTitle, Segmented, Switch } from "../ui";

function StackList() {
  const project = useStore((s) => s.project);
  const stackId = useStore((s) => s.stackId);
  const envId = useStore((s) => s.envId);
  const selectStack = useStore((s) => s.selectStack);
  const jobs = useStore((s) => s.jobs);
  const [filter, setFilter] = useState("");
  const [showModules, setShowModules] = useState(false);
  if (!project) return null;
  const f = filter.toLowerCase();
  const roots = project.stacks.filter((s) => s.kind === "root" && (s.id.toLowerCase().includes(f) || s.envs?.some((e) => e.name.toLowerCase().includes(f))));
  const modules = project.stacks.filter((s) => s.kind === "module" && s.id.toLowerCase().includes(f));
  const running = new Set(Object.values(jobs).filter((j) => j.status === "running").map((j) => j.stack));

  const row = (s: (typeof project.stacks)[number]) => {
    const envs = s.envs ?? [];
    const active = stackId === s.id;
    return (
      <div key={s.id} className={clsx("rounded-lg", active && "bg-accent/12 ring-1 ring-accent/30")}>
        <button
          onClick={() => selectStack(s.id)}
          className={clsx(
            "group flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors",
            active ? "text-fg" : "text-fg/85 hover:bg-panel-2 rounded-lg",
          )}
          title={s.dir}
        >
          {s.kind === "root" ? <FolderTree size={14} className="shrink-0 text-muted" /> : <Boxes size={14} className="shrink-0 text-muted" />}
          <span className="min-w-0 flex-1 truncate text-[13px]">{s.id === "." ? s.name : s.id}</span>
          {running.has(s.id) && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" title="Job running" />}
          {envs.length === 0 && (
            <span className="flex shrink-0 gap-0.5">
              {s.providers.slice(0, 3).map((p) => (
                <span key={p} className="h-1.5 w-1.5 rounded-full" style={{ background: providerColor(p) }} title={providerLabel(p)} />
              ))}
            </span>
          )}
        </button>
        {envs.length > 0 && (
          <div className="flex flex-wrap gap-1 px-2 pb-1.5 pl-8">
            {envs.map((e) => {
              const on = active && envId === e.name;
              return (
                <button
                  key={e.name}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    selectStack(s.id, e.name);
                  }}
                  className={clsx(
                    "h-5 rounded-md px-1.5 text-[10px] font-medium leading-none",
                    on ? "bg-accent text-white" : "bg-panel-2 text-muted hover:text-fg",
                  )}
                  title={[e.varFile, e.backendConfig].filter(Boolean).join(" · ")}
                >
                  {e.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <SectionTitle right={<span className="text-[11px] text-faint">{project.stacks.length}</span>}>Stacks</SectionTitle>
      {project.stacks.length > 6 && (
        <div className="relative mb-2">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter stacks"
            className="h-7 w-full rounded-lg border border-line bg-panel-2 pl-7 pr-2 text-xs outline-none focus:border-accent"
          />
        </div>
      )}
      <div className="space-y-0.5">{roots.map(row)}</div>
      {modules.length > 0 && (
        <>
          <button onClick={() => setShowModules((v) => !v)} className="mt-2 flex items-center gap-1 px-1 text-[11px] font-medium text-muted hover:text-fg">
            {showModules ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Reusable modules ({modules.length})
          </button>
          {showModules && <div className="mt-1 space-y-0.5">{modules.map(row)}</div>}
        </>
      )}
      {project.stacks.length === 0 && <p className="text-xs text-muted">No Terraform files found in {project.dir}</p>}
    </div>
  );
}

function ViewOptions() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const plan = useStore((s) => s.plan);
  const security = useStore((s) => s.security);
  const cost = useStore((s) => s.cost);
  return (
    <div className="space-y-3">
      <div>
        <SectionTitle>Group by</SectionTitle>
        <Segmented
          value={view.grouping}
          onChange={(grouping) => setView({ grouping })}
          options={[
            { value: "network", label: <><Network size={13} /> Network</>, title: "AWS cloud › VPC › subnet" },
            { value: "module", label: <><Boxes size={13} /> Modules</>, title: "Terraform module tree" },
            { value: "flat", label: <><Rows3 size={13} /> Flat</>, title: "Pure dependency graph" },
          ]}
        />
      </div>
      <div>
        <SectionTitle>Overlay</SectionTitle>
        <Segmented
          size="sm"
          value={view.overlay}
          onChange={(overlay) => setView({ overlay })}
          options={[
            { value: "plan", label: "Plan", disabled: !plan },
            { value: "security", label: "Security", disabled: !security },
            { value: "cost", label: "Cost", disabled: !cost },
            { value: "none", label: "None" },
          ]}
        />
      </div>
      <div>
        <SectionTitle>Dependencies</SectionTitle>
        <Segmented
          size="sm"
          value={view.edges}
          onChange={(edges) => setView({ edges })}
          options={[
            { value: "all", label: "All" },
            { value: "focus", label: "On focus", title: "Only show edges of the selected / hovered resource" },
            { value: "none", label: "Hidden" },
          ]}
        />
      </div>
      <div className="space-y-0.5">
        <Switch checked={view.foldHelpers} onChange={(foldHelpers) => setView({ foldHelpers })} label="Fold helper resources" hint="Draw policy attachments, rules, associations… inside the resource they configure" />
        <Switch checked={view.showData} onChange={(showData) => setView({ showData })} label="Show data sources" />
        <Switch checked={view.changesOnly} onChange={(changesOnly) => setView({ changesOnly })} label="Only planned changes" hint={plan ? undefined : "Run a plan first"} />
      </div>
    </div>
  );
}

function Filters() {
  const graph = useStore((s) => s.graph);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const { cats, providers } = useMemo(() => {
    const cats = new Map<Category, number>();
    const providers = new Map<string, number>();
    for (const n of graph?.nodes ?? []) {
      providers.set(n.provider, (providers.get(n.provider) ?? 0) + 1);
      if (n.kind === "module") continue;
      if (n.kind === "data" && !view.showData) continue;
      if (view.foldHelpers && n.foldInto) continue;
      const c = nodeInfo(n).category;
      cats.set(c, (cats.get(c) ?? 0) + 1);
    }
    return { cats: [...cats.entries()].sort((a, b) => b[1] - a[1]), providers: [...providers.entries()].sort((a, b) => b[1] - a[1]) };
  }, [graph, view.showData, view.foldHelpers]);

  const toggleCat = (c: Category) => {
    const hidden = new Set(view.hiddenCategories);
    hidden.has(c) ? hidden.delete(c) : hidden.add(c);
    setView({ hiddenCategories: [...hidden] });
  };
  const toggleProvider = (p: string) => {
    const hidden = new Set(view.hiddenProviders);
    hidden.has(p) ? hidden.delete(p) : hidden.add(p);
    setView({ hiddenProviders: [...hidden] });
  };

  return (
    <div className="space-y-4">
      {providers.length > 1 && (
        <div>
          <SectionTitle>Providers</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {providers.map(([p, n]) => {
              const off = view.hiddenProviders.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => toggleProvider(p)}
                  className={clsx("flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] transition", off ? "border-line text-faint line-through" : "border-line-strong text-fg")}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: providerColor(p), opacity: off ? 0.3 : 1 }} />
                  {providerLabel(p)} <span className="text-faint">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <SectionTitle
          right={
            view.hiddenCategories.length > 0 && (
              <button className="text-[11px] text-accent" onClick={() => setView({ hiddenCategories: [] })}>
                Show all
              </button>
            )
          }
        >
          Categories
        </SectionTitle>
        <div className="space-y-0.5">
          {cats.map(([c, n]) => {
            const off = view.hiddenCategories.includes(c);
            return (
              <button key={c} onClick={() => toggleCat(c)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-panel-2">
                <span className="h-2.5 w-2.5 rounded-sm transition" style={{ background: CATEGORIES[c].color, opacity: off ? 0.2 : 1 }} />
                <span className={clsx("flex-1", off ? "text-faint line-through" : "text-fg/90")}>{CATEGORIES[c].label}</span>
                <span className="text-[11px] text-faint">{n}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const plan = useStore((s) => s.plan);
  const overlay = useStore((s) => s.view.overlay);
  if (!plan || overlay !== "plan") return null;
  return (
    <div>
      <SectionTitle>Legend</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5 text-[12px]">
        {(["create", "update", "replace", "delete"] as const).map((a) => (
          <div key={a} className="flex items-center gap-1.5 text-fg/85">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: ACTIONS[a].color }} />
            {ACTIONS[a].label}
          </div>
        ))}
        <div className="col-span-2 flex items-center gap-1.5 text-muted">
          <CircleDot size={11} /> Faded = no changes
        </div>
      </div>
    </div>
  );
}

function Diagnostics() {
  const graph = useStore((s) => s.graph);
  const [open, setOpen] = useState(false);
  if (!graph?.diagnostics.length) return null;
  return (
    <div className="rounded-lg border border-update/30 bg-update/8 p-2 text-[12px]">
      <button className="flex w-full items-center gap-1 font-medium text-update" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {graph.diagnostics.length} parse warning{graph.diagnostics.length > 1 && "s"}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 font-mono text-[11px] text-muted">
          {graph.diagnostics.map((d, i) => (
            <li key={i} className="break-words">
              {d}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Sidebar() {
  const open = useStore((s) => s.sidebarOpen);
  if (!open) return null;
  return (
    <aside className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-r border-line bg-panel">
      <div className="space-y-6 p-3.5">
        <StackList />
        <div className="h-px bg-line" />
        <ViewOptions />
        <Legend />
        <div className="h-px bg-line" />
        <Filters />
        <Diagnostics />
        <div className="flex items-center gap-1.5 pt-2 text-[11px] text-faint">
          <Layers size={11} /> Click a resource for details · <kbd>⌘K</kbd> to search
        </div>
      </div>
    </aside>
  );
}
