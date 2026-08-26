import { useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300",
    secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
    danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
    ghost: "text-indigo-600 hover:bg-indigo-50 disabled:text-slate-400",
  }[variant];
  return (
    <button
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${className}`}
      {...props}
    />
  );
}

/**
 * Number input that holds its own text while editing, so clearing the field
 * doesn't snap to a forced 0 (and then strand a leading zero when you type).
 * It emits a number via onValueChange only for non-empty input, re-syncs when
 * `value` is changed programmatically, and restores the last value on blur if
 * left empty.
 */
export function NumberInput({
  value,
  onValueChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onValueChange: (n: number) => void;
}) {
  const [text, setText] = useState(() => (Number.isFinite(value) ? String(value) : ""));
  const lastEmitted = useRef(value);

  // Re-sync when the value changes from outside (e.g. min/max tracking ideal),
  // but not in response to our own emit (which would fight manual editing).
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(Number.isFinite(value) ? String(value) : "");
      lastEmitted.current = value;
    }
  }, [value]);

  return (
    <Input
      {...props}
      type="number"
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t !== "") {
          const n = Number(t);
          lastEmitted.current = n;
          onValueChange(n);
        }
      }}
      onBlur={(e) => {
        if (e.target.value === "") setText(Number.isFinite(value) ? String(value) : "");
        props.onBlur?.(e);
      }}
    />
  );
}

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Card({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  /** Optional anchor, so a form can scroll to the card it is complaining about. */
  id?: string;
}) {
  return (
    <div id={id} className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Badge({
  tone = "gray",
  children,
}: {
  tone?: "gray" | "green" | "red" | "amber" | "indigo";
  children: ReactNode;
}) {
  const styles = {
    gray: "bg-slate-100 text-slate-700",
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-800",
    amber: "bg-amber-100 text-amber-800",
    indigo: "bg-indigo-100 text-indigo-800",
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    // role="status" so a screen reader announces the wait rather than sitting
    // in silence through a long PBKDF2 derivation or solver run.
    <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-slate-500">
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      {label ?? "Loading…"}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  // Errors here appear after an action rather than on load, so they need
  // announcing; assertive because they always mean the action did not happen.
  return (
    <p role="alert" className="text-sm text-red-600">
      {children}
    </p>
  );
}

/**
 * Confirmation modal, built on the native `<dialog>` element.
 *
 * Every destructive action in the app comes through here — purging student
 * data, deleting a session, withdrawing a response or an evaluation — and the
 * hand-rolled overlay this replaces was a plain div: no dialog role, no focus
 * trap, no Escape, no focus restoration. A keyboard user could tab straight
 * past it into the page behind and act on what it was asking about.
 * `showModal()` provides all of that from the platform.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Escape fires 'cancel' rather than a click, and the browser would close
      // the dialog on its own — route both back through onCancel so React state
      // stays the source of truth.
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClose={() => {
        if (open && !busy) onCancel();
      }}
      // A backdrop click lands on the dialog element itself — ::backdrop is not
      // an event target of its own — so compare against the box to tell it from
      // a click on the dialog's own padding, which must not dismiss anything.
      onClick={(e) => {
        if (busy || e.target !== ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const outside =
          e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if (outside) onCancel();
      }}
      className="max-w-md rounded-lg border border-slate-200 bg-white p-4 text-slate-700 shadow-xl backdrop:bg-slate-950/40"
    >
      <h2 id={titleId} className={`mb-2 text-lg font-semibold ${tone === "danger" ? "text-red-700" : "text-slate-950"}`}>
        {title}
      </h2>
      <div className="space-y-2 text-sm text-slate-600">{children}</div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" variant={tone === "danger" ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>
          {busy ? "Working..." : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
