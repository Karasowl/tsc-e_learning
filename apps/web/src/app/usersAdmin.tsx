"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, Copy, Link2, Mail, RefreshCw, Search, Send, ShieldCheck, UserPlus, X } from "lucide-react";
import { authFetch, errorText } from "./apiClient";
import { confirmDialog, promptDialog, toast } from "./ui";

type Role = "ADMIN" | "TEACHER" | "STUDENT";

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  serviceLabel: string | null;
  status: string;
  roles: Role[];
  lastLoginAt: string | null;
  createdAt: string;
};

type InvitationResult = {
  emailed: boolean;
  expiresAt: string;
  activationUrl: string | null;
};

function lastAccessEs(value: string | null) {
  if (!value) {
    return "Sin accesos aún";
  }
  return `Último acceso: ${new Date(value).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}`;
}

const ALL_ROLES: Role[] = ["ADMIN", "TEACHER", "STUDENT"];

function roleEs(role: Role) {
  return role === "ADMIN" ? "Administrador" : role === "TEACHER" ? "Instructor" : "Colaborador";
}

function statusEs(status: string) {
  return status === "ACTIVE" ? "Activo" : status === "DISABLED" ? "Suspendido" : "Invitado";
}

function statusClass(status: string) {
  return status === "ACTIVE" ? "activo" : status === "DISABLED" ? "disabled" : "invited";
}

export function UsersRolesAdmin({
  token,
  currentUserId,
  initialQuery,
  queryNonce
}: {
  token: string;
  currentUserId: string;
  initialQuery?: string;
  queryNonce?: number;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [term, setTerm] = useState(initialQuery ?? "");
  const [roleFilter, setRoleFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // Activation link surfaced when an invitation was created but not emailed
  // (dev / SMTP unavailable) so the admin can hand it off manually.
  const [pendingInvite, setPendingInvite] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function load(overrideTerm?: string) {
    setError(null);
    setBusy(true);
    try {
      const params = new URLSearchParams();
      const searchTerm = (overrideTerm ?? term).trim();
      if (searchTerm) {
        params.set("q", searchTerm);
      }
      if (roleFilter) {
        params.set("role", roleFilter);
      }
      const query = params.toString();
      const data = await authFetch<{ users: AdminUser[] }>(token, `/admin/users${query ? `?${query}` : ""}`);
      setUsers(data.users);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to a search driven from the Ops-Center topbar (jump-to-collaborators).
  useEffect(() => {
    if (queryNonce === undefined) {
      return;
    }
    const next = initialQuery ?? "";
    setTerm(next);
    void load(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryNonce]);

  function patchUser(userId: string, patch: Partial<AdminUser>) {
    setUsers((current) => current.map((user) => (user.id === userId ? { ...user, ...patch } : user)));
  }

  async function addRole(userId: string, role: Role) {
    setBusy(true);
    setError(null);
    try {
      const data = await authFetch<{ roles: Role[] }>(token, `/admin/users/${userId}/roles`, {
        method: "POST",
        body: JSON.stringify({ role })
      });
      patchUser(userId, { roles: data.roles });
      toast.success("Rol asignado.");
    } catch (addError) {
      const message = errorText(addError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function removeRole(userId: string, role: Role) {
    const confirmed = await confirmDialog({
      title: "Quitar rol",
      message: "El usuario perderá este rol y sus permisos asociados.",
      confirmLabel: "Quitar rol",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await authFetch<{ roles: Role[] }>(token, `/admin/users/${userId}/roles/${role}`, {
        method: "DELETE"
      });
      patchUser(userId, { roles: data.roles });
      toast.success("Rol retirado.");
    } catch (removeError) {
      const message = errorText(removeError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(userId: string, status: "ACTIVE" | "DISABLED") {
    if (status === "DISABLED") {
      const confirmed = await confirmDialog({
        title: "Suspender usuario",
        message: "El usuario no podrá iniciar sesión hasta que lo reactives.",
        confirmLabel: "Suspender",
        danger: true
      });
      if (!confirmed) {
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const data = await authFetch<{ user: AdminUser }>(token, `/admin/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify({ status })
      });
      patchUser(userId, { status: data.user.status });
      toast.success(status === "DISABLED" ? "Usuario suspendido." : "Usuario reactivado.");
    } catch (statusError) {
      const message = errorText(statusError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(userId: string, displayName: string) {
    const newPassword = await promptDialog({
      title: "Restablecer contraseña",
      message: `Define una nueva contraseña para ${displayName}.`,
      label: "Nueva contraseña",
      inputType: "password",
      placeholder: "Mínimo 8 caracteres",
      confirmLabel: "Restablecer"
    });
    if (newPassword === null) {
      return;
    }
    if (newPassword.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/users/${userId}/password`, {
        method: "POST",
        body: JSON.stringify({ newPassword })
      });
      toast.success("Contraseña restablecida.");
    } catch (resetError) {
      toast.error(errorText(resetError));
    } finally {
      setBusy(false);
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const data = new FormData(formEl);
    const displayName = String(data.get("displayName") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const role = String(data.get("role") ?? "STUDENT") as Role;
    if (!displayName || !email || password.length < 6) {
      setError("Completa nombre, correo y una contraseña de al menos 6 caracteres.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authFetch(token, "/admin/users", {
        method: "POST",
        body: JSON.stringify({ displayName, email, password, roles: [role] })
      });
      formEl.reset();
      setShowCreate(false);
      await load();
      toast.success("Usuario creado.");
    } catch (createError) {
      const message = errorText(createError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  // Real invitation: creates the account as INVITED with an activation token. The
  // invitee sets their own password from the link (emailed in prod; surfaced here
  // when it wasn't sent). No password is chosen by the admin — this is the fix for
  // the old "forced ACTIVE" simulation.
  async function inviteUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const data = new FormData(formEl);
    const displayName = String(data.get("displayName") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const role = String(data.get("role") ?? "STUDENT") as Role;
    if (!displayName || !email) {
      setError("Completa nombre y correo para invitar.");
      return;
    }
    setBusy(true);
    setError(null);
    setPendingInvite(null);
    setCopied(false);
    try {
      const result = await authFetch<{ user: AdminUser; invitation: InvitationResult }>(token, "/admin/users/invite", {
        method: "POST",
        body: JSON.stringify({ displayName, email, roles: [role] })
      });
      formEl.reset();
      setShowInvite(false);
      await load();
      if (result.invitation.emailed) {
        toast.success(`Invitación enviada por correo a ${email}.`);
      } else if (result.invitation.activationUrl) {
        setPendingInvite({ email, url: result.invitation.activationUrl });
        toast.success("Invitación creada. Comparte el enlace de activación.");
      } else {
        toast.success("Invitación creada.");
      }
    } catch (inviteError) {
      const message = errorText(inviteError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function copyInviteLink() {
    if (!pendingInvite) {
      return;
    }
    try {
      await navigator.clipboard.writeText(pendingInvite.url);
      setCopied(true);
      toast.success("Enlace copiado.");
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("No se pudo copiar. Selecciona y copia el enlace manualmente.");
    }
  }

  return (
    <section className="data-section users-admin">
      <div className="section-header">
        <h2>Colaboradores y roles</h2>
        <div className="quiz-actions">
          <button
            className="btn btn--brand"
            disabled={busy}
            onClick={() => {
              setShowInvite((value) => !value);
              setShowCreate(false);
            }}
            type="button"
          >
            <Send aria-hidden /> Invitar
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setShowCreate((value) => !value);
              setShowInvite(false);
            }}
            type="button"
          >
            <UserPlus aria-hidden /> Crear con contraseña
          </button>
          <button className="icon-button" disabled={busy} onClick={() => void load()} title="Actualizar" type="button">
            <RefreshCw aria-hidden />
          </button>
        </div>
      </div>

      {error ? <p className="error-line">{error}</p> : null}

      {pendingInvite ? (
        <div className="invite-link-panel card">
          <div className="invite-link-head">
            <Link2 aria-hidden />
            <div>
              <strong>Enlace de activación para {pendingInvite.email}</strong>
              <small className="muted">
                El correo automático solo se envía en producción. Comparte este enlace para que fije su contraseña y
                active su cuenta. Caduca en 7 días.
              </small>
            </div>
            <button className="icon-button" onClick={() => setPendingInvite(null)} title="Cerrar" type="button">
              <X aria-hidden />
            </button>
          </div>
          <div className="invite-link-row">
            <input readOnly value={pendingInvite.url} aria-label="Enlace de activación" onFocus={(e) => e.target.select()} />
            <button className="btn btn--dark" onClick={() => void copyInviteLink()} type="button">
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
      ) : null}

      {showInvite ? (
        <form className="rule-form invite-form" onSubmit={inviteUser}>
          <div className="invite-form-head">
            <Mail aria-hidden />
            <p className="muted">
              El colaborador recibe un enlace para fijar su propia contraseña. Queda como <strong>Invitado</strong> hasta
              que la active.
            </p>
          </div>
          <label>
            Nombre
            <input name="displayName" placeholder="Nombre y apellido" required />
          </label>
          <label>
            Correo
            <input name="email" type="email" placeholder="correo@ejemplo.com" required />
          </label>
          <label>
            Rol
            <select name="role" defaultValue="STUDENT">
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleEs(role)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn--brand" disabled={busy} type="submit">
            <Send aria-hidden /> Enviar invitación
          </button>
        </form>
      ) : null}

      {showCreate ? (
        <form className="rule-form create-student" onSubmit={createUser}>
          <label>
            Nombre
            <input name="displayName" placeholder="Nombre y apellido" required />
          </label>
          <label>
            Correo
            <input name="email" type="email" placeholder="correo@ejemplo.com" required />
          </label>
          <label>
            Contraseña
            <input name="password" type="password" autoComplete="new-password" placeholder="mínimo 6 caracteres" required />
          </label>
          <label>
            Rol
            <select name="role" defaultValue="STUDENT">
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleEs(role)}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" disabled={busy} type="submit">
            <ShieldCheck aria-hidden /> Crear cuenta
          </button>
        </form>
      ) : null}

      <form className="rule-form" onSubmit={(event) => { event.preventDefault(); void load(); }}>
        <label>
          Buscar
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Nombre o correo" />
        </label>
        <label>
          Rol
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">Todos</option>
            {ALL_ROLES.map((role) => (
              <option key={role} value={role}>
                {roleEs(role)}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" disabled={busy} type="submit">
          <Search aria-hidden /> Buscar
        </button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Roles</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              const missing = ALL_ROLES.filter((role) => !user.roles.includes(role));
              return (
                <tr key={user.id}>
                  <td>
                    <strong>{user.displayName}</strong>
                    <br />
                    <small className="muted">{user.email}</small>
                    <br />
                    <small className="muted">{lastAccessEs(user.lastLoginAt)}</small>
                  </td>
                  <td>
                    <div className="role-chips">
                      {user.roles.map((role) => (
                        <span className={`role-chip ${role.toLowerCase()}`} key={role}>
                          {roleEs(role)}
                          {user.roles.length > 1 && !(isSelf && role === "ADMIN") ? (
                            <button disabled={busy} onClick={() => void removeRole(user.id, role)} title="Quitar rol" type="button">
                              <X aria-hidden />
                            </button>
                          ) : null}
                        </span>
                      ))}
                      {missing.map((role) => (
                        <button
                          className="link-button"
                          disabled={busy}
                          key={role}
                          onClick={() => void addRole(user.id, role)}
                          type="button"
                        >
                          + {roleEs(role)}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={`status-pill ${statusClass(user.status)}`}>{statusEs(user.status)}</span>
                  </td>
                  <td>
                    {isSelf ? (
                      <small className="muted">Tú</small>
                    ) : (
                      <div className="row-actions">
                        {user.status === "ACTIVE" ? (
                          <button className="secondary-button" disabled={busy} onClick={() => void setStatus(user.id, "DISABLED")} type="button">
                            Suspender
                          </button>
                        ) : (
                          <button className="secondary-button" disabled={busy} onClick={() => void setStatus(user.id, "ACTIVE")} type="button">
                            Reactivar
                          </button>
                        )}
                        <button className="ghost-button" disabled={busy} onClick={() => void resetPassword(user.id, user.displayName)} type="button">
                          Contraseña
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <p className="empty-state">No hay usuarios para mostrar.</p>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
