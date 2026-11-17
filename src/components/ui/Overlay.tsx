"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

/** 확정·삭제 확인에만 쓰는 모달 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[calc(100%-48px)] max-w-sm rounded-3xl bg-sheet p-0 text-ink backdrop:bg-[var(--overlay)]"
    >
      <div className="p-6">
        <h2 className="text-heading font-semibold">{title}</h2>
        {message && <p className="mt-2 text-sm text-muted">{message}</p>}
        <div className="mt-6 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** 아래에서 올라오는 패널 (비식별 경고, QR, 붙여넣기).
    left·right를 주면 제목 줄이 [left] 제목(가운데) [right] 모양 (예: X 취소 · ✓ 저장).
    시트가 겹치면 Esc는 맨 위 시트만 닫는다 */
export function Sheet({
  open,
  onClose,
  title,
  left,
  right,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const sheets = document.querySelectorAll("[data-sheet]");
      if (sheets[sheets.length - 1] === root.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  const bar = left !== undefined || right !== undefined;
  return createPortal(
    <div ref={root} data-sheet className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="닫기" className="absolute inset-0 bg-[var(--overlay)]" onClick={onClose} />
      <div className="animate-rise relative mx-auto max-h-[88dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-sheet px-6 pt-2 pb-safe">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-dot-empty" aria-hidden />
        {bar ? (
          <div className="-mx-2 mb-4 grid grid-cols-[44px_1fr_44px] items-center">
            <div className="flex justify-start">{left}</div>
            <h2 className="text-center text-base font-semibold">{title}</h2>
            <div className="flex justify-end">{right}</div>
          </div>
        ) : (
          <h2 className="mb-4 text-heading font-semibold">{title}</h2>
        )}
        <div className="pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ── 토스트 ──
   기본: 화면 위쪽, 2.2초. 옵션으로 아래쪽(주요 버튼 위)·동작 버튼(예: 복사)을 쓸 수 있음 */
export interface ToastOptions {
  position?: "top" | "bottom";
  duration?: number;
  /** 동작 버튼. onClick이 true를 돌려주면 라벨을 doneLabel로 바꾸고 1.5초 더 보여줌 */
  action?: { label: string; doneLabel?: string; onClick: () => Promise<boolean> | boolean };
}
type ToastState = { msg: string; opts: ToastOptions; id: number; done: boolean };
type Listener = (msg: string, opts: ToastOptions) => void;
const listeners = new Set<Listener>();
export const toast = (msg: string, opts: ToastOptions = {}) => listeners.forEach((l) => l(msg, opts));

export function Toaster() {
  const [state, setState] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const l: Listener = (msg, opts) => {
      setState({ msg, opts, id: Date.now(), done: false });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState(null), opts.duration ?? 2200);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
      clearTimeout(timer.current);
    };
  }, []);

  const runAction = async () => {
    if (!state?.opts.action || state.done) return;
    const ok = await state.opts.action.onClick();
    if (!ok) return;
    setState((s) => (s ? { ...s, done: true } : s));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), 1500);
  };

  const bottom = state?.opts.position === "bottom";
  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-50 flex justify-center px-6 ${bottom ? "" : "top-[calc(env(safe-area-inset-top)+64px)]"}`}
      style={bottom ? { bottom: "calc(var(--spacing-tabbar) + var(--spacing-action) + 8px + env(safe-area-inset-bottom))" } : undefined}
    >
      {state && (
        <div key={state.id} className="animate-rise pointer-events-auto flex items-center gap-2 rounded-2xl bg-toast-bg py-1 pr-1 pl-4 font-medium text-toast-ink">
          <span className={`py-1 ${state.opts.action ? "" : "pr-3"}`}>{state.msg}</span>
          {state.opts.action && <span aria-hidden>·</span>}
          {state.opts.action && (
            <button type="button" onClick={runAction} className="min-h-12 rounded-xl px-4 font-semibold text-toast-ink underline underline-offset-4 active:opacity-80">
              {state.done ? (state.opts.action.doneLabel ?? state.opts.action.label) : state.opts.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
