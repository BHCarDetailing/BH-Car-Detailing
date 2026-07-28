import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/**
 * App-wide toast + undo system. `useToast()` returns a `toast(opts)` function.
 * For destructive actions, pair it with `removeWithUndo` in useCollection so a
 * delete can be reversed inside the grace window (Gmail/Linear pattern).
 */
export interface ToastOpts {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number; // ms; 0 = sticky. default 4000
  tone?: "default" | "success" | "error";
}
interface ToastItem extends ToastOpts { id: number }
export type ToastFn = (opts: ToastOpts) => number;

const ToastCtx = createContext<ToastFn>(() => 0);
export function useToast(): ToastFn { return useContext(ToastCtx); }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((p) => p.filter((t) => t.id !== id)), []);

  const toast = useCallback<ToastFn>((opts) => {
    const id = ++seq.current;
    setItems((p) => [...p, { ...opts, id }]);
    const dur = opts.duration ?? 4000;
    if (dur > 0) setTimeout(() => dismiss(id), dur);
    return id;
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {items.map((t) => (
          <div key={t.id}
            className="pointer-events-auto flex max-w-[92vw] items-center gap-3 rounded-xl bg-graphite-900 px-4 py-3 text-sm text-white shadow-2xl ring-1 ring-white/10"
            style={{ animation: "bh-toast-in 0.18s ease-out both" }} role="status">
            <span className={t.tone === "error" ? "text-rose-300" : t.tone === "success" ? "text-emerald-300" : ""}>{t.message}</span>
            {t.actionLabel && (
              <button onClick={() => { t.onAction?.(); dismiss(t.id); }}
                className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/20">
                {t.actionLabel}
              </button>
            )}
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="shrink-0 text-chrome-400 transition hover:text-white">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
