import clsx from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { PlanAction } from "./api";

export const ACTIONS: Record<PlanAction, { label: string; symbol: string; color: string; verb: string }> = {
  create: { label: "Create", symbol: "+", color: "var(--color-create)", verb: "to add" },
  update: { label: "Update", symbol: "~", color: "var(--color-update)", verb: "to change" },
  replace: { label: "Replace", symbol: "±", color: "var(--color-replace)", verb: "to replace" },
  delete: { label: "Destroy", symbol: "−", color: "var(--color-delete)", verb: "to destroy" },
  read: { label: "Read", symbol: "↻", color: "var(--color-read)", verb: "to read" },
  "no-op": { label: "No change", symbol: "·", color: "var(--c-faint)", verb: "unchanged" },
  forget: { label: "Forget", symbol: "⊘", color: "var(--c-muted)", verb: "to forget" },
  mixed: { label: "Mixed", symbol: "◆", color: "var(--color-update)", verb: "mixed" },
};

type Variant = "primary" | "secondary" | "ghost" | "danger";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; icon?: ReactNode }>(
  function Button({ variant = "secondary", size = "md", icon, className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={clsx(
          "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors select-none whitespace-nowrap",
          "disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-accent",
          size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
          variant === "primary" && "bg-accent text-accent-fg hover:brightness-110 shadow-sm",
          variant === "secondary" && "bg-panel-2 text-fg border border-line hover:bg-panel-3",
          variant === "ghost" && "text-muted hover:text-fg hover:bg-panel-2",
          variant === "danger" && "bg-delete/10 text-delete border border-delete/30 hover:bg-delete/20",
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);

export function IconButton({ className, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={clsx(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-2 hover:text-fg",
        active && "bg-panel-2 text-fg",
        className,
      )}
      {...rest}
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex w-full rounded-lg border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.title}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            "flex flex-1 items-center justify-center gap-1 rounded-md font-medium transition-all disabled:opacity-40",
            size === "sm" ? "h-6 px-1.5 text-[11px]" : "h-7 px-2 text-xs",
            value === o.value ? "bg-panel text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-[13px]" title={hint}>
      <span className="text-fg/90">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx("relative h-[18px] w-8 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-panel-3 ring-1 ring-line-strong")}
      >
        <span className={clsx("absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all", checked ? "left-[16px]" : "left-[2px]")} />
      </button>
    </label>
  );
}

export function Pill({ children, color, className, title }: { children: ReactNode; color?: string; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx("inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium leading-none whitespace-nowrap", className)}
      style={color ? { color, background: `color-mix(in srgb, ${color} 14%, transparent)` } : undefined}
    >
      {children}
    </span>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">{children}</h3>
      {right}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx("animate-spin", className ?? "h-4 w-4")} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function money(v: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: v < 10 ? 2 : 0 }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleString();
}

export function editorLink(editor: string, file: string, line?: number) {
  if (editor === "none" || !file) return undefined;
  return `${editor}://file${file.startsWith("/") ? "" : "/"}${file}${line ? `:${line}` : ""}`;
}

export function formatValue(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  return JSON.stringify(v, null, 1).replace(/\n\s*/g, " ");
}
