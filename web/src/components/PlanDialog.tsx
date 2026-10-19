import clsx from "clsx";
import { Info, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type PlanOptions, type StackEnv } from "../api";
import { optionsKey, suggestProfile, useStore } from "../store";
import { Button, Switch } from "../ui";

export function PlanDialog() {
  const open = useStore((s) => s.planDialogOpen);
  const set = useStore((s) => s.set);
  const stack = useStore((s) => s.project?.stacks.find((x) => x.id === s.stackId));
  const tools = useStore((s) => s.tools);
  const envId = useStore((s) => s.envId);
  const lastAll = useStore((s) => s.lastPlanOptions);
  const runPlan = useStore((s) => s.runPlan);
  const [opts, setOpts] = useState<PlanOptions | null>(null);
  const [workspaces, setWorkspaces] = useState<{ list: string[]; current: string }>({ list: [], current: "" });

  useEffect(() => {
    if (!open || !stack) return;
    const env = stack.envs?.find((e) => e.name === envId) ?? stack.envs?.[0];
    const last = lastAll[optionsKey(stack.id, env?.name)];
    setOpts(defaultsFor(stack.id, env, last, stack.varFiles, stack.initialized, tools?.awsProfiles ?? []));
    if (stack.initialized) api.workspaces(stack.id).then((w) => setWorkspaces({ list: w.workspaces, current: w.current }));
    else setWorkspaces({ list: [], current: "" });
  }, [open, stack, envId, lastAll, tools?.awsProfiles]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && set({ planDialogOpen: false });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, set]);

  if (!open || !stack || !opts) return null;
  const tf = tools?.terraform;
  const patch = (p: Partial<PlanOptions>) => setOpts({ ...opts, ...p });
  const applyEnv = (e: StackEnv) => {
    const last = lastAll[optionsKey(stack.id, e.name)];
    setOpts(defaultsFor(stack.id, e, last, stack.varFiles, stack.initialized, tools?.awsProfiles ?? [], opts));
  };
  const initCmd = opts.init
    ? [
        tf?.name ?? "terraform",
        "init",
        opts.backendConfig && `-backend-config=${opts.backendConfig}`,
        stack.initialized && opts.backendConfig && "-reconfigure",
        opts.upgrade && "-upgrade",
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const cmd = [
    tf?.name ?? "terraform",
    "plan",
    ...opts.varFiles.map((v) => `-var-file=${v}`),
    !opts.refresh && "-refresh=false",
    opts.destroy && "-destroy",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => set({ planDialogOpen: false })}>
      <div className="w-[520px] overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <div className="text-[15px] font-semibold">Run terraform plan</div>
            <div className="font-mono text-[12px] text-muted">
              {stack.id}
              {opts.env ? ` · ${opts.env}` : ""}
            </div>
          </div>
          <button className="rounded-md p-1 text-faint hover:bg-panel-2 hover:text-fg" onClick={() => set({ planDialogOpen: false })}>
            <X size={16} />
          </button>
        </div>
        <div className="space-y-5 px-5 py-4">
          {!tf?.available && (
            <div className="rounded-lg border border-delete/30 bg-delete/10 p-3 text-[12px]">
              Terraform was not found on your PATH. Install it with <code className="font-mono">{tf?.install}</code>.
            </div>
          )}
          {stack.envs && stack.envs.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-muted">Environment</div>
              <div className="flex flex-wrap gap-1.5">
                {stack.envs.map((e) => {
                  const on = opts.env === e.name;
                  return (
                    <button
                      key={e.name}
                      onClick={() => applyEnv(e)}
                      className={clsx("h-7 rounded-md border px-2.5 text-[12px] font-medium transition", on ? "border-accent bg-accent/12 text-fg" : "border-line text-muted hover:text-fg")}
                      title={[e.varFile && `-var-file=${e.varFile}`, e.backendConfig && `-backend-config=${e.backendConfig}`].filter(Boolean).join("\n")}
                    >
                      {e.name}
                    </button>
                  );
                })}
              </div>
              {(() => {
                const e = stack.envs.find((x) => x.name === opts.env);
                if (!e) return null;
                return (
                  <div className="mt-1 font-mono text-[11px] text-faint">
                    {e.varFile && <div>-var-file={e.varFile}</div>}
                    {e.backendConfig && <div>-backend-config={e.backendConfig}</div>}
                    {!e.varFile && !e.backendConfig && <div>no extra files</div>}
                  </div>
                );
              })()}
            </div>
          )}
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted">Variable files</div>
            {stack.varFiles.length === 0 ? (
              <div className="text-[12px] text-faint">No .tfvars files in this directory or env/.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {stack.varFiles.map((v) => {
                  const on = opts.varFiles.includes(v);
                  return (
                    <button
                      key={v}
                      onClick={() => patch({ varFiles: on ? opts.varFiles.filter((x) => x !== v) : [...opts.varFiles, v] })}
                      className={clsx("h-7 rounded-md border px-2.5 font-mono text-[12px] transition", on ? "border-accent bg-accent/12 text-fg" : "border-line text-muted hover:text-fg")}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-1 text-[11px] text-faint">terraform.tfvars and *.auto.tfvars are always loaded by Terraform.</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="mb-1.5 text-[12px] font-medium text-muted">Workspace</div>
              <select
                value={opts.workspace}
                onChange={(e) => patch({ workspace: e.target.value })}
                disabled={workspaces.list.length === 0}
                className="h-8 w-full rounded-lg border border-line bg-panel-2 px-2 text-[13px] outline-none focus:border-accent disabled:opacity-60"
              >
                <option value="">{workspaces.current ? `current (${workspaces.current})` : "default"}</option>
                {workspaces.list.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="mb-1.5 text-[12px] font-medium text-muted">AWS profile</div>
              <select
                value={opts.awsProfile}
                onChange={(e) => patch({ awsProfile: e.target.value })}
                className="h-8 w-full rounded-lg border border-line bg-panel-2 px-2 text-[13px] outline-none focus:border-accent"
              >
                <option value="">{tools?.awsProfile ? `environment (${tools.awsProfile})` : "environment default"}</option>
                {tools?.awsProfiles.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-0.5 rounded-xl border border-line px-3 py-1.5">
            <Switch checked={opts.refresh} onChange={(refresh) => patch({ refresh })} label="Refresh state from the cloud" hint="Disable for faster plans that skip reading real infrastructure" />
            <Switch checked={opts.destroy} onChange={(destroy) => patch({ destroy })} label="Destroy plan (preview terraform destroy)" />
            <Switch
              checked={opts.init}
              onChange={(init) => patch({ init })}
              label={
                opts.backendConfig
                  ? stack.initialized
                    ? `Init with ${opts.backendConfig} (-reconfigure)`
                    : `Init with ${opts.backendConfig}`
                  : stack.initialized
                    ? "Re-run terraform init first"
                    : "Run terraform init first (required)"
              }
            />
            {opts.init && <Switch checked={!!opts.upgrade} onChange={(upgrade) => patch({ upgrade })} label="Upgrade providers and modules (-upgrade)" />}
          </div>

          <div className="space-y-1 rounded-lg bg-panel-2 px-3 py-2 font-mono text-[12px] text-muted">
            {initCmd && (
              <div>
                <span className="text-faint">$ </span>
                {initCmd}
              </div>
            )}
            <div>
              <span className="text-faint">$ </span>
              {cmd}
            </div>
          </div>
          <div className="flex items-start gap-2 text-[11px] text-faint">
            <Info size={12} className="mt-px shrink-0" />
            Plan is read-only and never changes infrastructure. It runs locally with your credentials, and the state lock is held while it runs.
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-panel-2/50 px-5 py-3">
          <Button variant="ghost" onClick={() => set({ planDialogOpen: false })}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Play size={12} fill="currentColor" />} onClick={() => runPlan(opts)} disabled={!tf?.available} autoFocus>
            Run plan
          </Button>
        </div>
      </div>
    </div>
  );
}

function defaultsFor(
  stackId: string,
  env: StackEnv | undefined,
  last: Partial<PlanOptions> | undefined,
  varFiles: string[],
  initialized: boolean,
  profiles: string[],
  prev?: PlanOptions | null,
): PlanOptions {
  const selected =
    last?.varFiles?.filter((v) => varFiles.includes(v)) ??
    (env?.varFile ? [env.varFile] : varFiles.length === 1 ? varFiles : []);
  const backendConfig = env?.backendConfig ?? last?.backendConfig ?? "";
  const suggested = env ? suggestProfile(env.name, profiles) : undefined;
  return {
    stack: stackId,
    env: env?.name,
    varFiles: selected,
    backendConfig,
    workspace: last?.workspace ?? prev?.workspace ?? "",
    awsProfile: last?.awsProfile ?? suggested ?? prev?.awsProfile ?? "",
    refresh: last?.refresh ?? prev?.refresh ?? true,
    destroy: false,
    init: !initialized || (!!backendConfig && last?.backendConfig !== backendConfig),
    upgrade: false,
  };
}
