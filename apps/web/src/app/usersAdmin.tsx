"use client";

import { FormEvent, useEffect, useState } from "react";
import { RefreshCw, Search, ShieldCheck, UserPlus, X } from "lucide-react";
import { authFetch, errorText } from "./apiClient";

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

function lastAccessEs(value: string | null) {
  if (!value) {
    return "Sin accesos aún";
  }
  return `Último acceso: ${new Date(value).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}`;
}

const ALL_ROLES: Role[] = ["ADMIN", "TEACHER", "STUDENT"];

function roleEs(role: Role) {
  return role === "ADMIN" ? "Administrador" : role === "TEACHER" ? "Profesor" : "Estudiante";
}

function statusEs(status: string) {
  return status === "ACTIVE" ? "Activo" : status === "DISABLED" ? "Suspendido" : "Invitado";
}

function statusClass(status: string) {
  return status === "ACTIVE" ? "activo" : status === "DISABLED" ? "disabled" : "invited";
}

export function UsersRolesAdmin({ token, currentUserId }: { token: string; currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [term, setTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setError(null);
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (term.trim()) {
        params.set("q", term.trim());
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
    } catch (addError) {
      setError(errorText(addError));
    } finally {
      setBusy(false);
    }
  }

  async function removeRole(userId: string, role: Role) {
    setBusy(true);
    setError(null);
    try {
      const data = await authFetch<{ roles: Role[] }>(token, `/admin/users/${userId}/roles/${role}`, {
        method: "DELETE"
      });
      patchUser(userId, { roles: data.roles });
    } catch (removeError) {
      setError(errorText(removeError));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(userId: string, status: "ACTIVE" | "DISABLED") {
    setBusy(true);
    setError(null);
    try {
      const data = await authFetch<{ user: AdminUser }>(token, `/admin/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify({ status })
      });
      patchUser(userId, { status: data.user.status });
    } catch (statusError) {
      setError(errorText(statusError));
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
    } catch (createError) {
      setError(errorText(createError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="data-section users-admin">
      <div className="section-header">
        <h2>Usuarios y roles</h2>
        <div className="quiz-actions">
          <button className="secondary-button" disabled={busy} onClick={() => setShowCreate((value) => !value)} type="button">
            <UserPlus aria-hidden /> Crear usuario
          </button>
          <button className="icon-button" disabled={busy} onClick={() => void load()} title="Actualizar" type="button">
            <RefreshCw aria-hidden />
          </button>
        </div>
      </div>

      {error ? <p className="error-line">{error}</p> : null}

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
            <input name="password" type="text" placeholder="mínimo 6 caracteres" required />
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
                    ) : user.status === "ACTIVE" ? (
                      <button className="secondary-button" disabled={busy} onClick={() => void setStatus(user.id, "DISABLED")} type="button">
                        Suspender
                      </button>
                    ) : (
                      <button className="secondary-button" disabled={busy} onClick={() => void setStatus(user.id, "ACTIVE")} type="button">
                        Reactivar
                      </button>
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
