"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { X } from "lucide-react";

/* ============================================================
   Toasts — feedback ligero, sin dependencias ni context plumbing.
   Uso: import { toast } from "./ui";  toast.success("Guardado");
   Montar <Toaster /> una sola vez en la raíz.
   ============================================================ */
type ToastType = "success" | "error" | "info";
type ToastItem = { id: number; type: ToastType; message: string };

let toastItems: ToastItem[] = [];
const toastListeners = new Set<() => void>();
let nextToastId = 0;

function emitToasts() {
  for (const listener of toastListeners) listener();
}

function dismissToast(id: number) {
  toastItems = toastItems.filter((item) => item.id !== id);
  emitToasts();
}

function pushToast(type: ToastType, message: string, durationMs: number) {
  const id = ++nextToastId;
  toastItems = [...toastItems, { id, type, message }];
  emitToasts();
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs);
  }
  return id;
}

export const toast = {
  success: (message: string) => pushToast("success", message, 4200),
  error: (message: string) => pushToast("error", message, 6500),
  info: (message: string) => pushToast("info", message, 4200)
};

function subscribeToasts(callback: () => void) {
  toastListeners.add(callback);
  return () => {
    toastListeners.delete(callback);
  };
}

function getToastSnapshot() {
  return toastItems;
}

export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToastSnapshot, getToastSnapshot);
  return (
    <div className="toast-stack" role="region" aria-live="polite" aria-label="Notificaciones">
      {items.map((item) => (
        <div className={`toast toast-${item.type}`} key={item.id} role="status">
          <span>{item.message}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => dismissToast(item.id)}
            aria-label="Cerrar notificación"
          >
            <X aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Confirm dialog — reemplazo de window.confirm con estilo de marca.
   Uso: if (await confirmDialog({ title, message, danger: true })) { ... }
   Montar <ConfirmHost /> una sola vez en la raíz.
   ============================================================ */
type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type ConfirmState = (ConfirmOptions & { id: number; resolve: (value: boolean) => void }) | null;

let confirmState: ConfirmState = null;
const confirmListeners = new Set<() => void>();
let nextConfirmId = 0;

function emitConfirm() {
  for (const listener of confirmListeners) listener();
}

function subscribeConfirm(callback: () => void) {
  confirmListeners.add(callback);
  return () => {
    confirmListeners.delete(callback);
  };
}

function getConfirmSnapshot() {
  return confirmState;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState = { ...options, id: ++nextConfirmId, resolve };
    emitConfirm();
  });
}

function resolveConfirm(result: boolean) {
  if (!confirmState) return;
  const { resolve } = confirmState;
  confirmState = null;
  emitConfirm();
  resolve(result);
}

export function ConfirmHost() {
  const state = useSyncExternalStore(subscribeConfirm, getConfirmSnapshot, getConfirmSnapshot);

  useEffect(() => {
    if (!state) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") resolveConfirm(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  if (!state) return null;

  return (
    <div className="modal-overlay confirm-overlay" onMouseDown={() => resolveConfirm(false)}>
      <div
        className="modal-panel confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-label={state.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-body">
          <h3>{state.title}</h3>
          {state.message ? <p className="muted">{state.message}</p> : null}
        </div>
        <div className="modal-foot">
          <button type="button" className="secondary-button" onClick={() => resolveConfirm(false)}>
            {state.cancelLabel ?? "Cancelar"}
          </button>
          <button
            type="button"
            className={state.danger ? "primary-button danger" : "primary-button"}
            onClick={() => resolveConfirm(true)}
            autoFocus
          >
            {state.confirmLabel ?? "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Prompt dialog — input de una línea con estilo de marca.
   Uso: const value = await promptDialog({ title, inputType: "password" });
   value === null si se cancela. Montar <PromptHost /> una vez.
   ============================================================ */
type PromptOptions = {
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputType?: "text" | "password";
  initialValue?: string;
};
type PromptState = (PromptOptions & { id: number; resolve: (value: string | null) => void }) | null;

let promptState: PromptState = null;
const promptListeners = new Set<() => void>();
let nextPromptId = 0;

function emitPrompt() {
  for (const listener of promptListeners) listener();
}

function subscribePrompt(callback: () => void) {
  promptListeners.add(callback);
  return () => {
    promptListeners.delete(callback);
  };
}

function getPromptSnapshot() {
  return promptState;
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    promptState = { ...options, id: ++nextPromptId, resolve };
    emitPrompt();
  });
}

function resolvePrompt(value: string | null) {
  if (!promptState) return;
  const { resolve } = promptState;
  promptState = null;
  emitPrompt();
  resolve(value);
}

export function PromptHost() {
  const state = useSyncExternalStore(subscribePrompt, getPromptSnapshot, getPromptSnapshot);
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(state?.initialValue ?? "");
  }, [state?.id, state?.initialValue]);

  useEffect(() => {
    if (!state) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") resolvePrompt(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  if (!state) return null;

  return (
    <div className="modal-overlay confirm-overlay" onMouseDown={() => resolvePrompt(null)}>
      <form
        className="modal-panel confirm-panel"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          resolvePrompt(value);
        }}
      >
        <div className="confirm-body">
          <h3>{state.title}</h3>
          {state.message ? <p className="muted">{state.message}</p> : null}
          <label>
            {state.label ?? ""}
            <input
              autoFocus
              type={state.inputType ?? "text"}
              value={value}
              placeholder={state.placeholder ?? ""}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        </div>
        <div className="modal-foot">
          <button type="button" className="secondary-button" onClick={() => resolvePrompt(null)}>
            {state.cancelLabel ?? "Cancelar"}
          </button>
          <button type="submit" className="primary-button">
            {state.confirmLabel ?? "Aceptar"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ============================================================
   Skeletons — estados de carga sin saltos de layout.
   ============================================================ */
export function CardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="catalog-grid" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: count }).map((_, index) => (
        <div className="course-card" key={index}>
          <span className="skeleton skeleton-cover" />
          <div className="course-card-body">
            <span className="skeleton skeleton-line lg" />
            <span className="skeleton skeleton-line sm" />
            <span className="skeleton skeleton-line" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-skeleton" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          className="table-skeleton-row"
          key={rowIndex}
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }).map((_, colIndex) => (
            <span className="skeleton skeleton-line" key={colIndex} />
          ))}
        </div>
      ))}
    </div>
  );
}
