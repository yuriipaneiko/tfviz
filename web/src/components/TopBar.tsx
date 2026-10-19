import clsx from "clsx";
import { CircleDollarSign, Moon, PanelLeft, Play, Search, Settings, ShieldCheck, Sun, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore, type Editor } from "../store";
import { Button, IconButton, money, Pill, Spinner } from "../ui";

function useRunning(...kinds: string[]) {
  return useStore((s) => Object.values(s.jobs).some((j) => kinds.includes(j.kind) && j.status === "running" && j.stack === s.stackId));
}

function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const editor = useStore((s) => s.editor);
  const setEditor = useStore((s) => s.setEditor);
  const tools = useStore((s) => s.tools);
  const loadTools = useStore((s) => s.loadTools);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <IconButton title="Settings" onClick={() => setOpen((o) => !o)} active={open}>
        <Settings size={16} />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-line bg-panel p-3 shadow-2xl">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Open files in</div>
          <div className="mb-4 flex gap-1">
            {(["cursor", "vscode", "none"] as Editor[]).map((e) => (
              <button
                key={e}
                onClick={() => setEditor(e)}
                className={clsx("h-7 flex-1 rounded-md border text-xs capitalize", editor === e ? "border-accent bg-accent/10 text-fg" : "border-line text-muted hover:text-fg")}
              >
                {e === "vscode" ? "VS Code" : e}
              </button>
            ))}
          </div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Tools</span>
            <button className="text-[11px] text-accent" onClick={() => loadTools(true)}>
              Re-detect
            </button>
          </div>
          <div className="space-y-2">
            {tools &&
              [tools.terraform, tools.checkov, tools.c3x].map((t) => (
                <div key={t.name} className="rounded-lg border border-line bg-panel-2 px-2.5 py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.name}</span>
                    {t.available ? <Pill color="var(--color-create)">v{t.version}</Pill> : <Pill color="var(--color-update)">not installed</Pill>}
                  </div>
                  {t.available ? (
                    <div className="mt-0.5 truncate font-mono text-[10px] text-faint" title={t.path}>
                      {t.path}
                    </div>
                  ) : (
                    <code className="mt-1 block select-all rounded bg-panel-3 px-1.5 py-1 font-mono text-[11px] text-muted">{t.install}</code>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const project = useStore((s) => s.project);
  const stackId = useStore((s) => s.stackId);
  const envId = useStore((s) => s.envId);
  const graph = useStore((s) => s.graph);
  const security = useStore((s) => s.security);
  const cost = useStore((s) => s.cost);
  const tools = useStore((s) => s.tools);
  const theme = useStore((s) => s.theme);
  const connected = useStore((s) => s.connected);
  const bottomOpen = useStore((s) => s.bottomOpen);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const set = useStore((s) => s.set);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const runSecurity = useStore((s) => s.runSecurity);
  const runCost = useStore((s) => s.runCost);
  const setView = useStore((s) => s.setView);
  const planning = useRunning("plan", "init");
  const scanning = useRunning("security");
  const costing = useRunning("cost");
  const stack = project?.stacks.find((s) => s.id === stackId);
  const resources = graph?.nodes.filter((n) => n.kind === "resource").length ?? 0;
  const modules = graph?.modules.filter((m) => m.id).length ?? 0;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2.5">
      <IconButton title="Toggle sidebar" onClick={() => set({ sidebarOpen: !sidebarOpen })}>
        <PanelLeft size={16} />
      </IconButton>
      <div className="flex items-center gap-2 pr-2">
        <img src="/favicon.svg" className="h-6 w-6" alt="" />
        <span className="text-[14px] font-semibold tracking-tight">tfviz</span>
      </div>
      <div className="h-5 w-px bg-line" />
      <div className="flex min-w-0 items-center gap-2 px-1">
        <span className="truncate text-[13px] text-muted" title={project?.dir}>
          {project?.name}
        </span>
        {stack && (
          <>
            <span className="text-faint">/</span>
            <span className="truncate text-[13px] font-semibold">{stack.id === "." ? stack.name : stack.id}</span>
            {envId && stack.envs?.some((e) => e.name === envId) && (
              <Pill color="var(--color-accent)" title="Environment">{envId}</Pill>
            )}
            {stack.kind === "module" && <Pill color="var(--c-muted)">module</Pill>}
            {stack.backend && <Pill color="var(--c-muted)" title="Backend">{stack.backend}</Pill>}
            {!stack.initialized && stack.kind === "root" && (
              <Pill color="var(--color-update)" title="terraform init has not been run; remote modules are shown collapsed">
                not initialised
              </Pill>
            )}
            <span className="hidden text-[12px] text-faint xl:inline">
              {resources} resources{modules > 0 && ` · ${modules} modules`}
            </span>
          </>
        )}
      </div>

      <div className="flex flex-1 justify-center px-3">
        <button
          onClick={() => set({ paletteOpen: true })}
          className="flex h-8 w-full max-w-[380px] items-center gap-2 rounded-lg border border-line bg-panel-2 px-2.5 text-[13px] text-faint transition hover:border-line-strong"
        >
          <Search size={14} />
          <span className="flex-1 truncate text-left">Search resources, types, modules…</span>
          <kbd>⌘K</kbd>
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          icon={scanning ? <Spinner className="h-3.5 w-3.5" /> : <ShieldCheck size={14} className={security?.failed ? "text-delete" : undefined} />}
          onClick={() => (security && !scanning ? (setView({ overlay: "security" }), set({ bottomOpen: true, bottomTab: "security" })) : runSecurity())}
          disabled={scanning || !stack}
          title={tools && !tools.checkov.available ? `Checkov not installed: ${tools.checkov.install}` : "Security scan with Checkov"}
        >
          {security ? (
            <>
              <span className={security.failed ? "text-delete" : "text-create"}>{security.failed}</span> issues
            </>
          ) : (
            "Security"
          )}
        </Button>
        <Button
          variant="secondary"
          icon={costing ? <Spinner className="h-3.5 w-3.5" /> : <CircleDollarSign size={14} />}
          onClick={() => (cost && !costing ? (setView({ overlay: "cost" }), set({ bottomOpen: true, bottomTab: "cost" })) : runCost())}
          disabled={costing || !stack}
          title={tools && !tools.c3x.available ? `C3X not installed: ${tools.c3x.install}` : "Estimate monthly cost with C3X"}
        >
          {cost ? `${money(cost.totalMonthly, cost.currency)}/mo` : "Cost"}
        </Button>
        <Button
          variant="primary"
          icon={planning ? <Spinner className="h-3.5 w-3.5" /> : <Play size={13} fill="currentColor" />}
          onClick={() => set({ planDialogOpen: true })}
          disabled={!stack || stack.kind === "module"}
          title={stack?.kind === "module" ? "Reusable modules can't be planned directly" : "Run terraform plan"}
        >
          {planning ? "Planning…" : "Plan"}
        </Button>
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton title="Console" active={bottomOpen} onClick={() => set({ bottomOpen: !bottomOpen })}>
          <Terminal size={16} />
        </IconButton>
        <IconButton title="Toggle theme" onClick={toggleTheme}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
        <SettingsMenu />
        <span
          className={clsx("ml-1 h-2 w-2 rounded-full", connected ? "bg-create" : "bg-delete")}
          title={connected ? (project?.watch ? "Live: watching files for changes" : "Connected") : "Disconnected from tfviz server"}
        />
      </div>
    </header>
  );
}
