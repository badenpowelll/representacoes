import type { ComponentProps, ReactNode } from "react";

export function Field({
  label,
  name,
  error,
  hint,
  ...props
}: { label: string; name: string; error?: string; hint?: string } & ComponentProps<"input">) {
  const describedBy = [error ? `${name}-erro` : null, hint ? `${name}-dica` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium text-argos-navy">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="w-full rounded-[10px] px-3 py-2"
        {...props}
      />
      {hint && (
        <p id={`${name}-dica`} className="text-xs text-neutral-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${name}-erro`} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function Button({ children, ...props }: ComponentProps<"button">) {
  return (
    <button
      className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[10px] bg-argos-orange px-5 py-2 font-semibold text-argos-navy shadow-sm transition-colors hover:bg-[#e65400] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-argos-navy disabled:cursor-not-allowed disabled:opacity-60"
      {...props}
    >
      {children}
    </button>
  );
}

export function Alert({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-argos-rust/30 border-l-argos-rust bg-[#fdeee9] text-[#7f1b00]",
    success: "border-green-300 border-l-green-700 bg-green-50 text-green-900",
    info: "border-argos-tint-navy border-l-argos-navy bg-[#eef1f7] text-argos-navy",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-[10px] border border-l-4 px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[14px] border border-dashed border-neutral-300 bg-white/60 px-6 py-10 text-center">
      <span aria-hidden="true" className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-argos-tint-orange text-lg text-[#c84a00]">
        ◎
      </span>
      <p className="font-semibold text-argos-navy">{title}</p>
      {children && <div className="mt-2 text-sm text-neutral-500">{children}</div>}
    </div>
  );
}
