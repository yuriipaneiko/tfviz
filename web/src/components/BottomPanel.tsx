import clsx from "clsx";
import { Ban, CheckCircle2, ChevronDown, CircleDollarSign, Clock, FileDiff, Loader2, RefreshCw, ScrollText, ShieldCheck, Square, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Job, PlanAction } from "../api";
import { typeInfo } from "../catalog";
import { useStore, type BottomTab } from "../store";
import { ACTIONS, Button, formatValue, money, timeAgo } from "../ui";
import { Ansi } from "./Code";
import { FindingCard } from "./Details";

function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
      <div className="text-faint">{icon}</div>
      <div className="text-[13px] font-medium text-fg">{title}</div>
      {children && <div className="max-w-md text-[12px]">{children}</div>}
    </div>
  );
}

function ChangesTab() {
  const plan = useStore((s) => s.plan);
  const select = useStore((s) => s.select);
  const selected = useStore((s) => s.selected);
  const set = useStore((s) => s.set);
  const stack = useStore((s) => s.project?.stacks.find((x) => x.id === s.stackId));
  const [filter, setFilter] = useState<PlanAction | "all">("all");
  const [q, setQ] = useState("");
  const changes = useMemo(
    () =>
      (plan?.changes ?? [])
        .filter((c) => c.action !== "no-op" && (filter === "all" || c.action === filter))
        .filter((c) => !q || c.address.toLowerCase().includes(q.toLowerCase())),
    [plan, filter, q],
  );
  if (!plan)
    return (
      <Empty icon={<FileDiff size={26} />} title="No plan yet">
        Run <b>Plan</b> to see what Terraform would create, change or destroy, drawn right on the diagram.
        {stack?.kind === "root" && (
          <div className="mt-3">
            <Button variant="primary" size="sm" onClick={() => set({ planDialogOpen: true })}>
              Run plan
            </Button>
          </div>
        )}
      </Empty>
    );
  const order: PlanAction[] = ["delete", "replace", "update", "create", "read", "forget"];
  const sorted = [...changes].sort((a, b) => order.indexOf(a.action) - order.indexOf(b.action) || a.address.localeCompare(b.address));
  const counts: Partial<Record<PlanAction, number>> = {};
  for (const c of plan.changes) counts[c.action] = (counts[c.action] ?? 0) + 1;
  const outputs = plan.outputs.filter((o) => o.action !== "no-op");

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-line p-2">
        <FilterBtn active={filter === "all"} onClick={() => setFilter("all")} label="All changes" count={plan.changes.filter((c) => c.action !== "no-op").length} />
        {order.map((a) =>
          counts[a] ? <FilterBtn key={a} active={filter === a} onClick={() => setFilter(a)} label={ACTIONS[a].label} count={counts[a]!} color={ACTIONS[a].color} /> : null,
        )}
        <div className="mt-auto space-y-0.5 px-2 pb-1 text-[11px] text-faint">
          {plan.summary.drift > 0 && <div className="text-update">{plan.summary.drift} resources drifted outside Terraform</div>}
          <div>Terraform {plan.terraformVersion}</div>
          <div>{timeAgo(plan.createdAt)}</div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-line p-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by address…"
            className="h-7 w-72 rounded-md border border-line bg-panel-2 px-2 text-xs outline-none focus:border-accent"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sorted.length === 0 && <div className="p-4 text-[13px] text-muted">No matching changes.</div>}
          {sorted.map((c) => {
            const a = ACTIONS[c.action];
            const info = typeInfo(c.type);
            return (
              <button
                key={c.address}
                onClick={() => select(c.configAddress, true)}
                className={clsx("flex w-full items-center gap-2.5 border-b border-line/50 px-3 py-1.5 text-left hover:bg-panel-2", selected === c.configAddress && "bg-accent/8")}
              >
                <span className="w-4 text-center text-[14px] font-bold" style={{ color: a.color }}>
                  {a.symbol}
                </span>
                {info.icon ? <img src={info.icon} className="h-4 w-4 rounded-sm" alt="" /> : <span className="h-4 w-4" />}
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{c.address}</span>
                {c.actionReason && <span className="text-[11px] text-faint">{c.actionReason.replace(/_/g, " ").toLowerCase()}</span>}
                <span className="text-[11px] text-faint">{c.attrs.length} attrs</span>
              </button>
            );
          })}
          {outputs.length > 0 && filter === "all" && (
            <div className="p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Outputs</div>
              {outputs.map((o) => (
                <div key={o.name} className="flex items-center gap-2 py-0.5 font-mono text-[12px]">
                  <span style={{ color: ACTIONS[o.action]?.color }}>{ACTIONS[o.action]?.symbol}</span>
                  <span>{o.name}</span>
                  <span className="text-faint">=</span>
                  <span className="truncate text-muted">{o.sensitive ? "(sensitive)" : o.unknown ? "(known after apply)" : formatValue(o.after)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterBtn({ active, onClick, label, count, color }: { active: boolean; onClick: () => void; label: string; count: number; color?: string }) {
  return (
    <button onClick={onClick} className={clsx("flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]", active ? "bg-panel-2 text-fg" : "text-muted hover:text-fg")}>
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      <span className="flex-1">{label}</span>
      <span className="text-[11px] text-faint">{count}</span>
    </button>
  );
}

function SecurityTab() {
  const security = useStore((s) => s.security);
  const tools = useStore((s) => s.tools);
  const runSecurity = useStore((s) => s.runSecurity);
  const select = useStore((s) => s.select);
  const running = useStore((s) => Object.values(s.jobs).some((j) => j.kind === "security" && j.status === "running" && j.stack === s.stackId));
  const [group, setGroup] = useState<"resource" | "check">("resource");
  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof security>["findings"]>();
    for (const f of security?.findings ?? []) {
      const key = group === "resource" ? f.nodes[0] ?? f.resource : `${f.checkId}|${f.name}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(f);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [security, group]);

  if (!security)
    return (
      <Empty icon={<ShieldCheck size={26} />} title="No security scan yet">
        {tools?.checkov.available ? (
          <>
            Scan this stack with Checkov (v{tools.checkov.version}) to highlight misconfigurations like public buckets or open security groups.
            <div className="mt-3">
              <Button variant="primary" size="sm" onClick={() => runSecurity()} disabled={running}>
                {running ? "Scanning…" : "Run security scan"}
              </Button>
            </div>
          </>
        ) : (
          <>
            Install Checkov to enable security scanning:
            <code className="mt-2 block select-all rounded-md bg-panel-3 px-2 py-1 font-mono text-[11px]">{tools?.checkov.install}</code>
          </>
        )}
      </Empty>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2 text-[12px]">
        <span className="font-semibold text-delete">{security.failed} failed</span>
        <span className="text-create">{security.passed} passed</span>
        {security.skipped > 0 && <span className="text-muted">{security.skipped} skipped</span>}
        <span className="text-faint">
          checkov {security.version} · {timeAgo(security.createdAt)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md border border-line p-0.5 text-[11px]">
            {(["resource", "check"] as const).map((g) => (
              <button key={g} onClick={() => setGroup(g)} className={clsx("rounded px-2 py-0.5", group === g ? "bg-panel-3 text-fg" : "text-muted")}>
                by {g}
              </button>
            ))}
          </div>
          <Button size="sm" icon={<RefreshCw size={12} className={running ? "animate-spin" : undefined} />} onClick={() => runSecurity()} disabled={running}>
            Re-scan
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-3">
          {groups.map(([key, fs]) => (
            <div key={key} className="rounded-xl border border-line bg-panel-2/50">
              <button className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left" onClick={() => fs[0].nodes[0] && select(fs[0].nodes[0], true)}>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{group === "resource" ? key : fs[0].checkId}</span>
                <span className="rounded-full bg-delete/15 px-1.5 text-[11px] font-semibold text-delete">{fs.length}</span>
              </button>
              <div className="space-y-1.5 p-2">
                {group === "resource"
                  ? dedupe(fs).map((f) => <FindingCard key={f.checkId} f={f} />)
                  : dedupeBy(fs, (f) => f.nodes[0] ?? f.resource).map((f) => (
                      <button key={f.resource} className="block w-full truncate rounded-md px-2 py-1 text-left font-mono text-[12px] hover:bg-panel-3" onClick={() => f.nodes[0] && select(f.nodes[0], true)}>
                        {f.resource}
                      </button>
                    ))}
                {group === "check" && <div className="px-2 text-[12px] text-muted">{fs[0].name}</div>}
              </div>
            </div>
          ))}
        </div>
        {security.unmapped > 0 && <div className="mt-3 text-[12px] text-faint">{security.unmapped} findings couldn't be matched to a resource in the diagram.</div>}
      </div>
    </div>
  );
}

function dedupe<T extends { checkId: string }>(fs: T[]): T[] {
  return dedupeBy(fs, (f) => f.checkId);
}
function dedupeBy<T>(fs: T[], key: (f: T) => string): T[] {
  const seen = new Set<string>();
  return fs.filter((f) => (seen.has(key(f)) ? false : (seen.add(key(f)), true)));
}

function CostTab() {
  const cost = useStore((s) => s.cost);
  const tools = useStore((s) => s.tools);
  const runCost = useStore((s) => s.runCost);
  const select = useStore((s) => s.select);
  const plan = useStore((s) => s.plan);
  const running = useStore((s) => Object.values(s.jobs).some((j) => j.kind === "cost" && j.status === "running" && j.stack === s.stackId));
  if (!cost)
    return (
      <Empty icon={<CircleDollarSign size={26} />} title="No cost estimate yet">
        {tools?.c3x.available ? (
          <>
            Estimate monthly cost with C3X. {plan ? "The latest plan will be used for accuracy." : "Run a plan first for the most accurate numbers."}
            <div className="mt-3">
              <Button variant="primary" size="sm" onClick={() => runCost()} disabled={running}>
                {running ? "Estimating…" : "Estimate cost"}
              </Button>
            </div>
          </>
        ) : (
          <>
            Install C3X to enable cost estimates (no login):
            <code className="mt-2 block select-all rounded-md bg-panel-3 px-2 py-1 font-mono text-[11px]">{tools?.c3x.install}</code>
          </>
        )}
      </Empty>
    );
  const max = Math.max(1, ...cost.resources.map((r) => r.monthlyCost ?? 0));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2 text-[12px]">
        <span className="text-[15px] font-semibold">{money(cost.totalMonthly, cost.currency)}</span>
        <span className="text-muted">per month</span>
        <span className="text-faint">
          from {cost.source === "plan" ? "plan" : "HCL"} · {cost.supported} priced · {cost.noPrice} unpriced
          {cost.unsupported ? ` · ${cost.unsupported} other` : ""}
          {cost.caveats ? ` · ${cost.caveats} assumptions` : ""} · {timeAgo(cost.createdAt)}
        </span>
        <Button className="ml-auto" size="sm" icon={<RefreshCw size={12} className={running ? "animate-spin" : undefined} />} onClick={() => runCost()} disabled={running}>
          Re-estimate
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {cost.resources
          .filter((r) => r.monthlyCost)
          .map((r) => {
            const info = typeInfo(r.type);
            return (
              <button key={r.address} onClick={() => select(r.configAddress, true)} className="flex w-full items-center gap-3 border-b border-line/50 px-3 py-1.5 text-left hover:bg-panel-2">
                {info.icon ? <img src={info.icon} className="h-4 w-4 rounded-sm" alt="" /> : <span className="h-4 w-4" />}
                <span className="w-[45%] truncate font-mono text-[12px]">{r.address}</span>
                <span className="flex-1">
                  <span className="block h-1.5 rounded-full bg-create/70" style={{ width: `${((r.monthlyCost ?? 0) / max) * 100}%` }} />
                </span>
                <span className="w-24 text-right text-[12px] font-semibold">{money(r.monthlyCost ?? 0, cost.currency)}</span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: Job["status"] }) {
  if (status === "running") return <Loader2 size={13} className="animate-spin text-accent" />;
  if (status === "succeeded") return <CheckCircle2 size={13} className="text-create" />;
  if (status === "failed") return <XCircle size={13} className="text-delete" />;
  return <Ban size={13} className="text-muted" />;
}

function LogsTab() {
  const jobs = useStore((s) => s.jobs);
  const activeJobId = useStore((s) => s.activeJobId);
  const logs = useStore((s) => (activeJobId ? s.logs[activeJobId] : undefined));
  const openJob = useStore((s) => s.openJob);
  const cancelJob = useStore((s) => s.cancelJob);
  const list = Object.values(jobs).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const active = activeJobId ? jobs[activeJobId] : undefined;
  const scroller = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);

  useEffect(() => {
    if (activeJobId && !logs) openJob(activeJobId);
  }, [activeJobId, logs, openJob]);
  useEffect(() => {
    if (stick && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [logs, stick]);

  if (list.length === 0) return <Empty icon={<ScrollText size={26} />} title="No jobs yet">Output from terraform, Checkov and C3X appears here.</Empty>;
  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-line p-1.5">
        {list.map((j) => (
          <button
            key={j.id}
            onClick={() => openJob(j.id)}
            className={clsx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left", activeJobId === j.id ? "bg-panel-2" : "hover:bg-panel-2/60")}
          >
            <StatusIcon status={j.status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px]">{j.title}</span>
              <span className="flex items-center gap-1 text-[10px] text-faint">
                <Clock size={9} /> {timeAgo(j.startedAt)}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {active && (
          <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px]">
            <StatusIcon status={active.status} />
            <span className="font-medium">{active.title}</span>
            <span className="text-faint">{active.status}</span>
            {active.status === "running" && (
              <Button size="sm" variant="danger" className="ml-auto" icon={<Square size={10} fill="currentColor" />} onClick={() => cancelJob(active.id)}>
                Cancel
              </Button>
            )}
          </div>
        )}
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
          }}
          className="min-h-0 flex-1 overflow-auto bg-[#0a0c10] px-3 py-2 font-mono text-[12px] leading-[1.55] text-[#d4d8e0]"
        >
          {(logs ?? []).map((l) => (
            <div key={l.seq} className={clsx("whitespace-pre-wrap break-words", l.stream === "info" && "text-[#a78bfa]", l.stream === "stderr" && "text-[#fca5a5]")}>
              <Ansi text={l.text || " "} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BottomPanel() {
  const open = useStore((s) => s.bottomOpen);
  const tab = useStore((s) => s.bottomTab);
  const set = useStore((s) => s.set);
  const plan = useStore((s) => s.plan);
  const security = useStore((s) => s.security);
  const cost = useStore((s) => s.cost);
  const running = useStore((s) => Object.values(s.jobs).some((j) => j.status === "running"));
  const [height, setHeight] = useState(() => Number(localStorage.getItem("tfviz.bottomHeight")) || 300);

  const startDrag = (e: React.MouseEvent) => {
    const startY = e.clientY;
    const startH = height;
    const move = (ev: MouseEvent) => setHeight(Math.min(window.innerHeight - 160, Math.max(140, startH + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setHeight((h) => (localStorage.setItem("tfviz.bottomHeight", String(h)), h));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const changeCount = plan ? plan.changes.filter((c) => c.action !== "no-op").length : undefined;
  const tabs: { id: BottomTab; label: string; icon: ReactNode; badge?: ReactNode }[] = [
    { id: "changes", label: "Plan changes", icon: <FileDiff size={13} />, badge: changeCount },
    { id: "security", label: "Security", icon: <ShieldCheck size={13} />, badge: security?.failed },
    { id: "cost", label: "Cost", icon: <CircleDollarSign size={13} />, badge: cost ? money(cost.totalMonthly, cost.currency) : undefined },
    { id: "logs", label: "Logs", icon: <ScrollText size={13} />, badge: running ? <Loader2 size={11} className="animate-spin text-accent" /> : undefined },
  ];

  return (
    <div className="flex shrink-0 flex-col border-t border-line bg-panel" style={{ height: open ? height : 36 }}>
      {open && <div className="h-1 cursor-row-resize hover:bg-accent/40" onMouseDown={startDrag} />}
      <div className="flex h-8 shrink-0 items-center gap-1 px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => set({ bottomTab: t.id, bottomOpen: true })}
            className={clsx("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium", open && tab === t.id ? "bg-panel-2 text-fg" : "text-muted hover:text-fg")}
          >
            {t.icon}
            {t.label}
            {t.badge !== undefined && t.badge !== 0 && <span className="rounded-full bg-panel-3 px-1.5 text-[10px] text-fg/80">{t.badge}</span>}
          </button>
        ))}
        <button className="ml-auto rounded p-1 text-faint hover:text-fg" onClick={() => set({ bottomOpen: !open })} title={open ? "Collapse" : "Expand"}>
          <ChevronDown size={15} className={clsx("transition", !open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="min-h-0 flex-1 border-t border-line">
          {tab === "changes" && <ChangesTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "cost" && <CostTab />}
          {tab === "logs" && <LogsTab />}
        </div>
      )}
    </div>
  );
}
