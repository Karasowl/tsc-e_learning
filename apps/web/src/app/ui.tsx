"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";

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

/* ============================================================
   Modal — primitiva de diálogo de marca (scrim con blur, fade .22s,
   foco atrapado, cierre por X / Escape / scrim, retorno de foco).
   Base reutilizable de asistentes y editores en overlay.
   Uso: <Modal title="Título" onClose={close} footer={...}>…</Modal>
   ============================================================ */
export function Modal({
  title,
  onClose,
  wide = false,
  size,
  children,
  footer,
  bodyClassName,
  labelledBy
}: {
  title?: string;
  onClose: () => void;
  wide?: boolean;
  size?: "md" | "lg" | "xl";
  children: ReactNode;
  footer?: ReactNode;
  bodyClassName?: string;
  labelledBy?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          ).filter((element) => element.offsetParent !== null)
        : [];
    (focusables()[0] ?? panel)?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "Tab" && panel) {
        const items = focusables();
        if (items.length === 0) {
          event.preventDefault();
          return;
        }
        const firstEl = items[0]!;
        const lastEl = items[items.length - 1]!;
        if (event.shiftKey && document.activeElement === firstEl) {
          event.preventDefault();
          lastEl.focus();
        } else if (!event.shiftKey && document.activeElement === lastEl) {
          event.preventDefault();
          firstEl.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const resolved = size ?? (wide ? "lg" : "md");
  const sizeClass = resolved === "lg" ? "wide" : resolved === "xl" ? "modal-panel--xl" : "";

  return (
    <div
      className="modal-overlay modal-overlay--blur"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className={`modal-panel modal-panel--anim ${sizeClass}`.trim()}
        role="dialog"
        aria-modal="true"
        {...(labelledBy ? { "aria-labelledby": labelledBy } : { "aria-label": title ?? "Diálogo" })}
        tabIndex={-1}
      >
        {title ? (
          <div className="modal-head">
            <h3>{title}</h3>
            <button className="icon-button" onClick={onClose} title="Cerrar" aria-label="Cerrar" type="button">
              <X aria-hidden />
            </button>
          </div>
        ) : null}
        <div className={`modal-body ${bodyClassName ?? ""}`.trim()}>{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ============================================================
   Wizard — stepper multipaso sobre <Modal>. Barra de pasos, botones
   Atrás / Siguiente / Finalizar y validación por paso (validate()
   devuelve un mensaje de error o null). No usa spring.
   ============================================================ */
export type WizardStep = {
  key: string;
  title: string;
  render: () => ReactNode;
  validate?: () => string | null;
};

export function Wizard({
  title,
  steps,
  onFinish,
  onCancel,
  finishLabel = "Finalizar",
  busy = false
}: {
  title: string;
  steps: WizardStep[];
  onFinish: () => void | Promise<void>;
  onCancel: () => void;
  finishLabel?: string;
  busy?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, steps.length - 1);
  const current = steps[safeIndex]!;
  const isLast = safeIndex === steps.length - 1;

  function goNext() {
    const error = current.validate?.();
    if (error) {
      toast.error(error);
      return;
    }
    if (isLast) {
      void onFinish();
      return;
    }
    setIndex(safeIndex + 1);
  }

  function goBack() {
    if (safeIndex > 0) {
      setIndex(safeIndex - 1);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onCancel}
      size="lg"
      bodyClassName="wizard-modal-body"
      footer={
        <>
          <span className="wizard-progress mono-label">
            Paso {safeIndex + 1} de {steps.length}
          </span>
          {safeIndex > 0 ? (
            <button className="btn btn--ghost" onClick={goBack} disabled={busy} type="button">
              <ChevronLeft aria-hidden /> Atrás
            </button>
          ) : null}
          <button className="btn btn--brand" onClick={goNext} disabled={busy} type="button">
            {isLast ? (
              <>
                <Check aria-hidden /> {finishLabel}
              </>
            ) : (
              <>
                Siguiente <ChevronRight aria-hidden />
              </>
            )}
          </button>
        </>
      }
    >
      <ol className="wizard-steps" aria-label="Pasos">
        {steps.map((step, stepIndex) => (
          <li
            key={step.key}
            className={`wizard-step${stepIndex === safeIndex ? " is-active" : ""}${stepIndex < safeIndex ? " is-done" : ""}`}
            aria-current={stepIndex === safeIndex ? "step" : undefined}
          >
            <span className="wizard-step-dot">{stepIndex < safeIndex ? <Check aria-hidden /> : stepIndex + 1}</span>
            <span className="wizard-step-label">{step.title}</span>
          </li>
        ))}
      </ol>
      <div className="wizard-panel">{current.render()}</div>
    </Modal>
  );
}
