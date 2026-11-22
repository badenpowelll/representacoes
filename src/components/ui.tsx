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
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus:outline-2 focus:outline-blue-600 dark:border-neutral-700"
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
      className="rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-60"
      {...props}
    >
      {children}
    </button>
  );
}

export function Alert({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
    success: "border-green-300 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200",
    info: "border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-neutral-500">{children}</div>}
    </div>
  );
}
