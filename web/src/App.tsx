import { AlertCircle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect } from "react";
import { subscribe } from "./api";
import { BottomPanel } from "./components/BottomPanel";
import { DetailsPanel } from "./components/Details";
import { Palette } from "./components/Palette";
import { PlanDialog } from "./components/PlanDialog";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Canvas } from "./diagram/Canvas";
import { useStore } from "./store";
import { Spinner } from "./ui";

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-14 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex gap-2.5 rounded-xl border border-line bg-panel p-3 shadow-xl">
          {t.kind === "success" ? (
            <CheckCircle2 size={16} className="mt-px shrink-0 text-create" />
          ) : t.kind === "error" ? (
            <XCircle size={16} className="mt-px shrink-0 text-delete" />
          ) : (
            <Info size={16} className="mt-px shrink-0 text-accent" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{t.title}</div>
            {t.body && <div className="mt-0.5 line-clamp-4 break-words text-[12px] text-muted">{t.body}</div>}
          </div>
          <button className="shrink-0 self-start text-faint hover:text-fg" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SearchChip() {
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  if (!search) return null;
  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-xl border border-update/40 bg-panel/95 py-1 pl-3 pr-1 text-[12px] shadow-lg backdrop-blur">
      Highlighting <span className="font-semibold text-update">“{search}”</span>
      <button className="rounded-md p-1 text-faint hover:bg-panel-2 hover:text-fg" onClick={() => setSearch("")}>
        <X size={13} />
      </button>
    </div>
  );
}

export default function App() {
  const init = useStore((s) => s.init);
  const handleEvent = useStore((s) => s.handleEvent);
  const set = useStore((s) => s.set);
  const projectError = useStore((s) => s.projectError);
  const project = useStore((s) => s.project);
  const graphError = useStore((s) => s.graphError);
  const graphLoading = useStore((s) => s.graphLoading);

  useEffect(() => {
    init();
    return subscribe(handleEvent, (connected) => {
      const was = useStore.getState().connected;
      set({ connected });
      if (connected && !was && useStore.getState().project) {
        useStore.getState().reloadProject();
        useStore.getState().reloadGraph(true);
      }
    });
  }, [init, handleEvent, set]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        set({ paletteOpen: !s.paletteOpen });
      } else if (e.key === "Escape" && !s.paletteOpen && !s.planDialogOpen) {
        if (s.search) s.setSearch("");
        else s.select(undefined);
      } else if (!typing && !e.metaKey && !e.ctrlKey && !s.paletteOpen && !s.planDialogOpen) {
        if (e.key === "/") {
          e.preventDefault();
          set({ paletteOpen: true });
        } else if (e.key === "f") document.querySelector<HTMLButtonElement>('[title^="Fit to screen"]')?.click();
        else if (e.key === "p" && s.project?.stacks.find((x) => x.id === s.stackId)?.kind === "root") set({ planDialogOpen: true });
        else if (e.key === "1") s.setView({ grouping: "network" });
        else if (e.key === "2") s.setView({ grouping: "module" });
        else if (e.key === "3") s.setView({ grouping: "flat" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);

  if (projectError && !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
        <AlertCircle className="text-delete" />
        <div className="text-[14px] font-medium text-fg">Can't reach the tfviz server</div>
        <div className="text-[12px]">{projectError}</div>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative min-w-0 flex-1">
          <Canvas />
          <SearchChip />
          {graphLoading && (
            <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-[12px] text-muted shadow">
              <Spinner className="h-3.5 w-3.5" /> Parsing configuration…
            </div>
          )}
          {graphError && (
            <div className="absolute inset-x-0 top-16 z-10 mx-auto w-fit max-w-xl rounded-xl border border-delete/30 bg-panel p-3 text-[12px] shadow-lg">
              <div className="font-medium text-delete">Failed to load configuration</div>
              <div className="mt-1 font-mono text-muted">{graphError}</div>
            </div>
          )}
        </main>
        <DetailsPanel />
      </div>
      <BottomPanel />
      <PlanDialog />
      <Palette />
      <Toasts />
    </div>
  );
}
