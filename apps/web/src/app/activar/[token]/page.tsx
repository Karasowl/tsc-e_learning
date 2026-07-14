"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, ShieldCheck } from "lucide-react";
import { API_URL } from "../../apiClient";

type Invitation = { email: string; displayName: string; expiresAt: string };
type LoadState =
  | { phase: "loading" }
  | { phase: "invalid"; message: string }
  | { phase: "ready"; invitation: Invitation }
  | { phase: "done" };

export default function ActivateInvitation() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ phase: "invalid", message: "El enlace de activación no es válido." });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_URL}/auth/invitation/${encodeURIComponent(token)}`);
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          if (!cancelled) {
            setState({
              phase: "invalid",
              message: typeof body.error === "string" ? body.error : "La invitación no es válida o ya expiró."
            });
          }
          return;
        }
        const body = (await response.json()) as { invitation: Invitation };
        if (!cancelled) {
          setState({ phase: "ready", invitation: body.invitation });
        }
      } catch {
        if (!cancelled) {
          setState({ phase: "invalid", message: "No se pudo validar la invitación. Revisa tu conexión." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/auth/invitation/${encodeURIComponent(token)}/activate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(typeof body.error === "string" ? body.error : "No se pudo activar la cuenta.");
      }
      const body = (await response.json()) as { token: string; user: unknown };
      window.localStorage.setItem("tsc_token", body.token);
      window.localStorage.setItem("tsc_user", JSON.stringify(body.user));
      setState({ phase: "done" });
      // Full navigation so the root shell picks up the new session and lands the
      // freshly-activated user in the right role experience.
      window.setTimeout(() => {
        window.location.href = "/";
      }, 900);
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : String(activateError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="activate-screen">
      <section className="activate-panel">
        <div className="panel-heading">
          <ShieldCheck aria-hidden />
          <div>
            <p className="eyebrow">Activación de cuenta</p>
            <h2>Capacitación TSC</h2>
          </div>
        </div>

        {state.phase === "loading" ? <p className="activate-status">Validando tu invitación…</p> : null}

        {state.phase === "invalid" ? (
          <div className="activate-invalid">
            <p className="error-line">{state.message}</p>
            <p className="muted">Pídele a tu administrador que te envíe una nueva invitación.</p>
            <a className="ghost-button" href="/">Ir al inicio de sesión</a>
          </div>
        ) : null}

        {state.phase === "done" ? (
          <div className="activate-done">
            <span className="activate-done-icon"><Check aria-hidden /></span>
            <p><strong>¡Cuenta activada!</strong></p>
            <p className="muted">Entrando a la plataforma…</p>
          </div>
        ) : null}

        {state.phase === "ready" ? (
          <form className="activate-form" onSubmit={activate}>
            <p className="activate-greeting">
              Hola, <strong>{state.invitation.displayName}</strong>. Define una contraseña para activar tu cuenta
              (<span className="mono-label">{state.invitation.email}</span>).
            </p>
            <label>
              Contraseña
              <input
                autoComplete="new-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mínimo 8 caracteres"
                required
              />
            </label>
            <label>
              Confirmar contraseña
              <input
                autoComplete="new-password"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Repite tu contraseña"
                required
              />
            </label>
            {error ? <p className="error-line">{error}</p> : null}
            <button className="primary-button" disabled={busy} type="submit">
              <ShieldCheck aria-hidden /> {busy ? "Activando…" : "Activar mi cuenta"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
