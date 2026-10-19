import clsx from "clsx";
import { ArrowLeft, ArrowRight, Boxes, Check, Copy, ExternalLink, FileCode2, Layers, MapPin, Puzzle, ShieldAlert, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { GraphNode, ModuleInfo, PlanChange } from "../api";
import { CATEGORIES, nodeInfo, providerLabel } from "../catalog";
import { useStore } from "../store";
import { ACTIONS, Button, editorLink, formatValue, money, Pill, SectionTitle } from "../ui";
import { displayName } from "../diagram/model";
import { HclCode, InlineHcl } from "./Code";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="rounded p-1 text-faint hover:bg-panel-2 hover:text-fg"
      title="Copy"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check size={13} className="text-create" /> : <Copy size={13} />}
    </button>
  );
}

function NodeLink({ id, suffix }: { id: string; suffix?: ReactNode }) {
  const graph = useStore((s) => s.graph);
  const select = useStore((s) => s.select);
  const hover = useStore((s) => s.hover);
  const n = graph?.nodes.find((x) => x.id === id);
  const info = n ? nodeInfo(n) : undefined;
  return (
    <button
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-panel-2"
      onClick={() => select(id, true)}
      onMouseEnter={() => hover(id)}
      onMouseLeave={() => hover(undefined)}
    >
      {info?.icon ? <img src={info.icon} className="h-5 w-5 shrink-0 rounded" alt="" /> : <Puzzle size={16} className="shrink-0 text-muted" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-fg">{n ? displayName(n) : id}</span>
        <span className="block truncate font-mono text-[10px] text-faint">{id}</span>
      </span>
      {suffix}
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-[13px]">
      <div className="w-24 shrink-0 text-muted">{label}</div>
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-line px-4">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={clsx("relative -mb-px flex h-9 items-center gap-1.5 border-b-2 px-2 text-[13px] font-medium transition", value === t.id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="rounded-full bg-panel-3 px-1.5 text-[10px] text-fg/80">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

function ValueCell({ v, unknown, sensitive }: { v: unknown; unknown?: boolean; sensitive?: boolean }) {
  if (sensitive) return <span className="italic text-faint">(sensitive)</span>;
  if (unknown) return <span className="italic text-read">(known after apply)</span>;
  if (v === undefined) return <span className="text-faint">—</span>;
  return <span className="break-all">{formatValue(v)}</span>;
}

export function ChangeDiff({ change }: { change: PlanChange }) {
  const a = ACTIONS[change.action];
  const [all, setAll] = useState(false);
  const attrs = change.attrs;
  const shown = all ? attrs : attrs.slice(0, 40);
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-2">
        <span className="flex h-5 items-center rounded-full px-1.5 text-[10px] font-bold text-white" style={{ background: a.color }}>
          {a.symbol} {a.label.toLowerCase()}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{change.address}</span>
      </div>
      {change.actionReason && <div className="border-b border-line px-3 py-1.5 text-[11px] text-muted">Reason: {change.actionReason.replace(/_/g, " ")}</div>}
      {change.movedFrom && <div className="border-b border-line px-3 py-1.5 text-[11px] text-muted">Moved from {change.movedFrom}</div>}
      {attrs.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-muted">No attribute changes</div>
      ) : (
        <table className="w-full text-[12px]">
          <tbody className="font-mono">
            {shown.map((at) => (
              <tr key={at.path} className="border-b border-line/60 last:border-0 align-top">
                <td className="w-[38%] px-3 py-1.5 text-fg/85">
                  <span className="break-all">{at.path || "(value)"}</span>
                  {at.forcesReplace && (
                    <span className="ml-1 rounded bg-replace/15 px-1 font-sans text-[10px] font-semibold text-replace" title="Changing this forces replacement">
                      forces replacement
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {change.action === "create" ? (
                    <span className="text-create">
                      <ValueCell v={at.after} unknown={at.afterUnknown} sensitive={at.sensitive} />
                    </span>
                  ) : change.action === "delete" ? (
                    <span className="text-delete line-through decoration-delete/40">
                      <ValueCell v={at.before} sensitive={at.sensitive} />
                    </span>
                  ) : (
                    <div className="space-y-0.5">
                      <div className="text-delete/90">
                        − <ValueCell v={at.before} sensitive={at.sensitive} />
                      </div>
                      <div className="text-create">
                        + <ValueCell v={at.after} unknown={at.afterUnknown} sensitive={at.sensitive} />
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {attrs.length > 40 && !all && (
        <button className="w-full border-t border-line py-1.5 text-[12px] text-accent hover:bg-panel-2" onClick={() => setAll(true)}>
          Show all {attrs.length} attributes
        </button>
      )}
    </div>
  );
}

type Tab = "overview" | "code" | "plan" | "security" | "cost";

function ResourceDetails({ node }: { node: GraphNode }) {
  const graph = useStore((s) => s.graph)!;
  const plan = useStore((s) => s.plan);
  const security = useStore((s) => s.security);
  const cost = useStore((s) => s.cost);
  const editor = useStore((s) => s.editor);
  const select = useStore((s) => s.select);
  const runInit = useStore((s) => s.runInit);
  const [tabState, setTab] = useState<Tab>("overview");
  const info = nodeInfo(node);

  const folded = useMemo(() => graph.nodes.filter((n) => n.foldInto === node.id), [graph, node.id]);
  const ids = useMemo(() => new Set([node.id, ...folded.map((f) => f.id)]), [node.id, folded]);
  const outgoing = graph.edges.filter((e) => e.source === node.id);
  const incoming = graph.edges.filter((e) => e.target === node.id);
  const changes = plan?.changes.filter((c) => ids.has(c.configAddress) && c.action !== "no-op") ?? [];
  const findings = security?.findings.filter((f) => f.nodes.some((n) => ids.has(n))) ?? [];
  const costs = cost?.resources.filter((r) => ids.has(r.configAddress)) ?? [];
  const totalCost = costs.reduce((s, r) => s + (r.monthlyCost ?? 0), 0);
  const nodeChange = plan?.nodes[node.id];
  const link = editorLink(editor, node.absFile, node.line);
  const network = node.network?.parent;
  const parentNode = network ? graph.nodes.find((n) => n.id === network) : undefined;
  const parentContainer = network ? graph.containers.find((c) => c.id === network) : undefined;

  const tabs: { id: Tab; label: ReactNode; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "code", label: "Code" },
  ];
  if (plan) tabs.push({ id: "plan", label: "Plan", count: changes.length });
  if (security) tabs.push({ id: "security", label: "Security", count: findings.length });
  if (cost) tabs.push({ id: "cost", label: "Cost" });
  const tab = tabs.some((t) => t.id === tabState) ? tabState : "overview";

  const uniqueFindings = useMemo(() => {
    const m = new Map<string, (typeof findings)[number] & { instances: number }>();
    for (const f of findings) {
      const k = f.checkId + f.nodes.join();
      const cur = m.get(k);
      if (cur) cur.instances++;
      else m.set(k, { ...f, instances: 1 });
    }
    return [...m.values()];
  }, [findings]);

  return (
    <>
      <div className="border-b border-line px-4 pb-3 pt-4">
        <div className="flex items-start gap-3">
          {info.icon ? (
            <img src={info.icon} className="h-11 w-11 shrink-0 rounded-lg" alt="" />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-panel-3">
              <Puzzle size={20} className="text-muted" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-semibold leading-tight">{node.kind === "module" ? `module.${node.name}` : node.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Pill color={info.color}>{info.service}</Pill>
              {node.kind === "data" && <Pill color="var(--color-read)">data source</Pill>}
              {node.kind !== "module" && <span className="font-mono text-[11px] text-muted">{node.type}</span>}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {nodeChange && nodeChange.action !== "no-op" && (
            <Pill color={ACTIONS[nodeChange.action].color}>
              {ACTIONS[nodeChange.action].symbol} {ACTIONS[nodeChange.action].label}
              {nodeChange.instances > 1 && ` · ${nodeChange.instances} instances`}
            </Pill>
          )}
          {nodeChange?.action === "no-op" && <Pill color="var(--c-muted)">No changes</Pill>}
          {findings.length > 0 && (
            <Pill color="var(--color-delete)">
              <ShieldAlert size={11} /> {uniqueFindings.length} failed checks
            </Pill>
          )}
          {costs.length > 0 && <Pill color="var(--color-create)">{money(totalCost, cost?.currency)}/mo</Pill>}
        </div>
        <div className="mt-3 flex gap-1.5">
          {link && (
            <a href={link}>
              <Button size="sm" icon={<FileCode2 size={13} />}>
                Open in editor
              </Button>
            </a>
          )}
          <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => navigator.clipboard.writeText(node.id)}>
            Copy address
          </Button>
        </div>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === "overview" && (
          <div className="space-y-5">
            <div>
              <Row label="Address">
                <span className="flex items-center gap-1 font-mono text-[12px]">
                  <span className="break-all">{node.id}</span>
                  <CopyButton text={node.id} />
                </span>
              </Row>
              {node.file && (
                <Row label="Location">
                  {link ? (
                    <a href={link} className="inline-flex items-center gap-1 font-mono text-[12px] text-accent hover:underline">
                      {node.file}:{node.line} <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span className="font-mono text-[12px]">
                      {node.file}:{node.line}
                    </span>
                  )}
                </Row>
              )}
              {node.module && (
                <Row label="Module">
                  <button className="font-mono text-[12px] text-accent hover:underline" onClick={() => select(node.module)}>
                    {node.module}
                  </button>
                </Row>
              )}
              <Row label="Provider">
                {providerLabel(node.provider)}
                {node.providerConfig && node.providerConfig.includes(".") && <span className="ml-1 font-mono text-[12px] text-muted">({node.providerConfig})</span>}
              </Row>
              {node.kind !== "module" && <Row label="Category">{CATEGORIES[info.category].label}</Row>}
              {node.multi && (
                <Row label={node.multi}>
                  <code className="font-mono text-[12px]">
                    <InlineHcl code={node.multiExpr ?? ""} />
                  </code>
                </Row>
              )}
              {(parentNode || parentContainer) && (
                <Row label="Placed in">
                  <button className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => select(network, true)}>
                    <MapPin size={12} />
                    {parentNode ? `${parentNode.name} (${nodeInfo(parentNode).service})` : parentContainer!.label}
                  </button>
                  {node.network?.spans && <div className="mt-0.5 text-[12px] text-muted">spans {node.network.spans.length} subnet groups</div>}
                </Row>
              )}
              {node.kind === "module" && (
                <>
                  <Row label="Source">
                    <span className="font-mono text-[12px]">{node.moduleSource}</span>
                  </Row>
                  {node.moduleVersion && (
                    <Row label="Version">
                      <span className="font-mono text-[12px]">{node.moduleVersion}</span>
                    </Row>
                  )}
                </>
              )}
            </div>

            {node.kind === "module" && (
              <div className="rounded-xl border border-line bg-panel-2 p-3 text-[12px] text-muted">
                This module's source isn't available locally, so its resources are shown collapsed. Run <code className="font-mono text-fg">terraform init</code> to download it and see everything inside.
                <div className="mt-2">
                  <Button size="sm" onClick={() => runInit()}>
                    Run terraform init
                  </Button>
                </div>
              </div>
            )}

            {folded.length > 0 && (
              <div>
                <SectionTitle>
                  <span className="flex items-center gap-1">
                    <Layers size={11} /> Folded helpers ({folded.length})
                  </span>
                </SectionTitle>
                <div className="space-y-0.5">
                  {folded.map((f) => (
                    <NodeLink key={f.id} id={f.id} suffix={plan?.nodes[f.id] && plan.nodes[f.id].action !== "no-op" ? <ActionDot action={plan.nodes[f.id].action} /> : undefined} />
                  ))}
                </div>
              </div>
            )}

            {outgoing.length > 0 && (
              <div>
                <SectionTitle>
                  <span className="flex items-center gap-1">
                    <ArrowRight size={11} /> Depends on ({outgoing.length})
                  </span>
                </SectionTitle>
                <div className="space-y-0.5">
                  {outgoing.map((e) => (
                    <NodeLink key={e.id} id={e.target} suffix={<span className="max-w-[110px] truncate font-mono text-[10px] text-faint">{e.attrs.join(", ")}</span>} />
                  ))}
                </div>
              </div>
            )}
            {incoming.length > 0 && (
              <div>
                <SectionTitle>
                  <span className="flex items-center gap-1">
                    <ArrowLeft size={11} /> Used by ({incoming.length})
                  </span>
                </SectionTitle>
                <div className="space-y-0.5">
                  {incoming.map((e) => (
                    <NodeLink key={e.id} id={e.source} suffix={<span className="max-w-[110px] truncate font-mono text-[10px] text-faint">{e.attrs.join(", ")}</span>} />
                  ))}
                </div>
              </div>
            )}

            {node.attrs.length > 0 && (
              <div>
                <SectionTitle>{node.kind === "module" ? "Inputs" : "Arguments"}</SectionTitle>
                <div className="overflow-hidden rounded-xl border border-line">
                  {node.attrs.map((a) => (
                    <div key={a.path} className="border-b border-line/60 px-3 py-1.5 last:border-0">
                      <div className="font-mono text-[11px] text-muted">{a.path}</div>
                      <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px]">
                        <InlineHcl code={a.text} />
                      </pre>
                      {a.refs && a.refs.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {a.refs.map((r) => (
                            <button key={r} onClick={() => select(r, true)} className="rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent hover:bg-accent/20">
                              → {r}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "code" &&
          (node.source ? (
            <div className="space-y-3">
              <HclCode code={node.source} startLine={node.textLine || node.line} />
              {folded.map((f) => (
                <div key={f.id}>
                  <div className="mb-1 font-mono text-[11px] text-muted">
                    {f.file}:{f.line}
                  </div>
                  <HclCode code={f.source} startLine={f.textLine || f.line} />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[13px] text-muted">This resource only exists in the state (it was removed from the configuration).</div>
          ))}

        {tab === "plan" && (
          <div className="space-y-3">
            {changes.length === 0 ? (
              <div className="text-[13px] text-muted">No changes planned for this resource.</div>
            ) : (
              changes.map((c) => <ChangeDiff key={c.address} change={c} />)
            )}
          </div>
        )}

        {tab === "security" && (
          <div className="space-y-2">
            {uniqueFindings.length === 0 ? (
              <div className="flex items-center gap-2 text-[13px] text-create">
                <Check size={14} /> All checks passed
              </div>
            ) : (
              uniqueFindings.map((f) => <FindingCard key={f.checkId + f.resource} f={f} instances={f.instances} />)
            )}
          </div>
        )}

        {tab === "cost" && (
          <div className="space-y-3">
            {costs.length === 0 ? (
              <div className="text-[13px] text-muted">C3X found no price for this resource (free, usage-based, or unpriced).</div>
            ) : (
              costs.map((r) => (
                <div key={r.address} className="overflow-hidden rounded-xl border border-line">
                  <div className="flex items-center justify-between border-b border-line bg-panel-2 px-3 py-2">
                    <span className="truncate font-mono text-[12px]">{r.address}</span>
                    <span className="font-semibold">{r.monthlyCost !== null ? money(r.monthlyCost, cost?.currency) : "—"}</span>
                  </div>
                  {!!r.caveats?.length && <div className="border-b border-line px-3 py-1 text-[10px] text-update">{r.caveats.join(" · ")}</div>}
                  <table className="w-full text-[12px]">
                    <tbody>
                      {r.components.map((c, i) => (
                        <tr key={i} className="border-b border-line/60 last:border-0">
                          <td className="px-3 py-1.5">
                            {c.name}
                            {c.usageBased && <span className="ml-1 text-[10px] text-update">usage-based</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right text-muted">
                            {c.monthlyQuantity !== undefined && `${+c.monthlyQuantity.toFixed(2)} ${c.unit}`}
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium">{c.monthlyCost !== undefined ? money(c.monthlyCost, cost?.currency) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ActionDot({ action }: { action: string }) {
  const a = ACTIONS[action as keyof typeof ACTIONS];
  return (
    <span className="rounded-full px-1.5 text-[10px] font-bold text-white" style={{ background: a?.color }}>
      {a?.symbol}
    </span>
  );
}

export function FindingCard({ f, instances }: { f: import("../api").Finding; instances?: number }) {
  const sevColor = f.severity === "CRITICAL" || f.severity === "HIGH" ? "var(--color-delete)" : f.severity === "MEDIUM" ? "var(--color-update)" : "var(--c-muted)";
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-start gap-2">
        <ShieldAlert size={14} className="mt-0.5 shrink-0 text-delete" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-snug">{f.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted">{f.checkId}</span>
            {f.severity !== "UNKNOWN" && <Pill color={sevColor}>{f.severity.toLowerCase()}</Pill>}
            {instances && instances > 1 && <Pill color="var(--c-muted)">{instances} instances</Pill>}
            {f.guideline && (
              <a href={f.guideline} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-accent hover:underline">
                Guideline <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModuleDetails({ mod }: { mod: ModuleInfo }) {
  const project = useStore((s) => s.project);
  const editor = useStore((s) => s.editor);
  const selectStack = useStore((s) => s.selectStack);
  const select = useStore((s) => s.select);
  const stack = project?.stacks.find((s) => s.id === mod.dir);
  const link = mod.absFile ? editorLink(editor, mod.absFile, mod.line) : undefined;
  return (
    <>
      <div className="border-b border-line px-4 pb-3 pt-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-panel-3">
            <Boxes size={20} className="text-muted" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold">{mod.id ? `module.${mod.name}` : "Root module"}</div>
            {mod.source && <div className="mt-1 truncate font-mono text-[12px] text-muted">{mod.source}</div>}
          </div>
        </div>
        <div className="mt-3 flex gap-1.5">
          {link && (
            <a href={link}>
              <Button size="sm" icon={<FileCode2 size={13} />}>
                Open call site
              </Button>
            </a>
          )}
          {stack && (
            <Button size="sm" variant="ghost" onClick={() => selectStack(stack.id)}>
              Open module on its own
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-3">
        <div>
          {mod.id && (
            <Row label="Address">
              <span className="font-mono text-[12px]">{mod.id}</span>
            </Row>
          )}
          <Row label="Directory">
            <span className="font-mono text-[12px]">{mod.dir}</span>
          </Row>
          {mod.version && <Row label="Version">{mod.version}</Row>}
          {mod.multi && (
            <Row label={mod.multi}>
              <span className="font-mono text-[12px]">{mod.multiExpr}</span>
            </Row>
          )}
          <Row label="Resources">{mod.resources}</Row>
          {mod.parent !== undefined && mod.id && (
            <Row label="Parent">
              <button className="font-mono text-[12px] text-accent hover:underline" onClick={() => select(mod.parent || undefined)}>
                {mod.parent || "root"}
              </button>
            </Row>
          )}
        </div>
        {mod.variables.length > 0 && (
          <div>
            <SectionTitle>Inputs ({mod.variables.length})</SectionTitle>
            <div className="overflow-hidden rounded-xl border border-line">
              {mod.variables.map((v) => (
                <div key={v.name} className="border-b border-line/60 px-3 py-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-semibold">{v.name}</span>
                    {v.type && <span className="font-mono text-[11px] text-faint">{v.type}</span>}
                    {v.sensitive && <Pill color="var(--color-update)">sensitive</Pill>}
                  </div>
                  {v.description && <div className="mt-0.5 text-[12px] text-muted">{v.description}</div>}
                  {v.value !== undefined ? (
                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px]">
                      = <InlineHcl code={v.value} />
                    </pre>
                  ) : v.default !== undefined && v.default !== "" ? (
                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] text-muted">
                      default <InlineHcl code={v.default} />
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}
        {mod.outputs.length > 0 && (
          <div>
            <SectionTitle>Outputs ({mod.outputs.length})</SectionTitle>
            <div className="overflow-hidden rounded-xl border border-line">
              {mod.outputs.map((o) => (
                <div key={o.name} className="border-b border-line/60 px-3 py-2 last:border-0">
                  <div className="font-mono text-[12px] font-semibold">{o.name}</div>
                  <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[12px]">
                    <InlineHcl code={o.value} />
                  </pre>
                  {o.refs && o.refs.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {o.refs.map((r) => (
                        <button key={r} onClick={() => select(r, true)} className="rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent hover:bg-accent/20">
                          → {r}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export function DetailsPanel() {
  const selected = useStore((s) => s.selected);
  const graph = useStore((s) => s.graph);
  const plan = useStore((s) => s.plan);
  const select = useStore((s) => s.select);
  if (!selected || !graph) return null;

  let body: ReactNode = null;
  const node = graph.nodes.find((n) => n.id === selected);
  const mod = graph.modules.find((m) => m.id === selected && m.expanded);
  const container = graph.containers.find((c) => c.id === selected);
  const ghost = !node && plan?.changes.find((c) => c.configAddress === selected);
  if (node) body = <ResourceDetails node={node} />;
  else if (mod) body = <ModuleDetails mod={mod} />;
  else if (ghost) {
    body = (
      <div className="space-y-3 p-4">
        <div className="text-[16px] font-semibold">{ghost.name}</div>
        <div className="font-mono text-[12px] text-muted">{ghost.configAddress}</div>
        <div className="rounded-xl border border-delete/30 bg-delete/8 p-3 text-[12px] text-muted">
          This resource is no longer in the configuration and will be destroyed.
        </div>
        {plan!.changes.filter((c) => c.configAddress === selected).map((c) => (
          <ChangeDiff key={c.address} change={c} />
        ))}
      </div>
    );
  } else if (container) {
    body = (
      <div className="space-y-2 p-4">
        <div className="text-[16px] font-semibold">{container.label}</div>
        <div className="text-[13px] text-muted">
          Subnets created inside <span className="font-mono">{container.parent}</span> and exposed through its <span className="font-mono">{container.label}</span> output. Run{" "}
          <code className="font-mono text-fg">terraform init</code> to see the individual resources.
        </div>
      </div>
    );
  } else if (selected.startsWith("provider:")) {
    const key = selected.slice("provider:".length);
    const [name, alias] = key.split(".");
    const p = graph.providers.find((x) => x.name === name && (x.alias ?? "") === (alias ?? ""));
    const count = graph.nodes.filter((n) => (n.providerConfig || n.provider) === key).length;
    body = (
      <div className="space-y-2 p-4">
        <div className="text-[16px] font-semibold">{providerLabel(name)}</div>
        <Row label="Config">
          <span className="font-mono text-[12px]">{key}</span>
        </Row>
        {p?.source && <Row label="Source">{p.source}</Row>}
        {p?.version && <Row label="Version">{p.version}</Row>}
        {p?.region && <Row label="Region">{p.region}</Row>}
        <Row label="Resources">{count}</Row>
      </div>
    );
  } else return null;

  return (
    <aside className="relative flex w-[420px] shrink-0 flex-col border-l border-line bg-panel">
      <button className="absolute right-2.5 top-2.5 z-10 rounded-md p-1 text-faint hover:bg-panel-2 hover:text-fg" onClick={() => select(undefined)} title="Close (Esc)">
        <X size={16} />
      </button>
      {body}
    </aside>
  );
}
