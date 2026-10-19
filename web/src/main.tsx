import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-xl rounded-xl border border-line bg-panel p-5">
          <div className="mb-1 text-[15px] font-semibold">Something went wrong</div>
          <div className="mb-3 text-[13px] text-muted">The UI hit an unexpected error. Your files and Terraform state are untouched.</div>
          <pre className="mb-4 max-h-60 overflow-auto rounded-lg bg-panel-2 p-3 font-mono text-[11px] text-delete">{error.stack ?? error.message}</pre>
          <button className="h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-white" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
