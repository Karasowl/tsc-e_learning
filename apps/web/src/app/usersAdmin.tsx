"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  Award,
  BadgeCheck,
  Check,
  Copy,
  Eye,
  Flame,
  GraduationCap,
  IdCard,
  Link2,
  Mail,
  RefreshCw,
  ScrollText,
  Search,
  Send,
  ShieldCheck,
  UserPlus,
  X
} from "lucide-react";
import { authFetch, errorText } from "./apiClient";
import { confirmDialog, Modal, promptDialog, toast } from "./ui";

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
  const [statusFilter, setStatusFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // Activation link surfaced when an invitation was created but not emailed
  // (dev / SMTP unavailable) so the admin can hand it off manually.
  const [pendingInvite, setPendingInvite] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Expediente (ficha 360°) del colaborador seleccionado: perfil + rango + cursos +
  // diplomas + insignias + auditoría, en un Modal sobre esta misma tabla.
  const [dossierUserId, setDossierUserId] = useState<string | null>(null);

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
      if (statusFilter) {
        params.set("status", statusFilter);
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

  // Cuenta en estado Invitado (sin contraseña propia): "reactivarla" la rompería
  // porque no podría iniciar sesión. En su lugar se reenvía la invitación: el
  // servidor regenera el token y devuelve el enlace de activación si el correo
  // automático no salió.
  async function resendInvitation(user: AdminUser) {
    setBusy(true);
    setError(null);
    setPendingInvite(null);
    setCopied(false);
    try {
      const result = await authFetch<{ user: AdminUser; invitation: InvitationResult }>(token, "/admin/users/invite", {
        method: "POST",
        body: JSON.stringify({
          displayName: user.displayName,
          email: user.email,
          roles: user.roles.length > 0 ? user.roles : ["STUDENT"],
          ...(user.serviceLabel ? { serviceLabel: user.serviceLabel } : {})
        })
      });
      await load();
      if (result.invitation.emailed) {
        toast.success(`Invitación reenviada por correo a ${user.email}.`);
      } else if (result.invitation.activationUrl) {
        setPendingInvite({ email: user.email, url: result.invitation.activationUrl });
        toast.success("Invitación regenerada. Comparte el nuevo enlace de activación.");
      } else {
        toast.success("Invitación regenerada.");
      }
    } catch (resendError) {
      // Un 409 del servidor (p. ej. la cuenta ya se activó) llega con su mensaje.
      const message = errorText(resendError);
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
        <label>
          Estado
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Todos</option>
            <option value="ACTIVE">Activo</option>
            <option value="DISABLED">Suspendido</option>
            <option value="INVITED">Invitado</option>
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
                    <button
                      type="button"
                      className="linklike-name"
                      onClick={() => setDossierUserId(user.id)}
                      title="Ver expediente"
                    >
                      {user.displayName}
                    </button>
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
                    <div className="row-actions">
                      <button className="ghost-button" onClick={() => setDossierUserId(user.id)} type="button">
                        <Eye aria-hidden /> Expediente
                      </button>
                      {isSelf ? (
                        <small className="muted">Tú</small>
                      ) : (
                        <>
                          {user.status === "ACTIVE" ? (
                            <button className="secondary-button" disabled={busy} onClick={() => void setStatus(user.id, "DISABLED")} type="button">
                              Suspender
                            </button>
                          ) : user.status === "INVITED" ? (
                            <button className="secondary-button" disabled={busy} onClick={() => void resendInvitation(user)} type="button">
                              <Send aria-hidden /> Reenviar invitación
                            </button>
                          ) : (
                            <button className="secondary-button" disabled={busy} onClick={() => void setStatus(user.id, "ACTIVE")} type="button">
                              Reactivar
                            </button>
                          )}
                          <button className="ghost-button" disabled={busy} onClick={() => void resetPassword(user.id, user.displayName)} type="button">
                            Contraseña
                          </button>
                        </>
                      )}
                    </div>
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

      {dossierUserId ? (
        <UserDossier token={token} userId={dossierUserId} onClose={() => setDossierUserId(null)} />
      ) : null}
    </section>
  );
}

// ─── Expediente del colaborador: ficha 360° real desde GET /admin/users/:id ─────
type DossierRank = { level: number; name: string; xp: number; pct: number; toNext: number | null };
type DossierEnrollment = {
  id: string;
  courseId: string;
  courseTitle: string;
  status: string;
  progressPercent: number;
  enrolledAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
};
type DossierCertificate = { id: string; folio: string; issuedAt: string; courseId: string; courseTitle: string };
type DossierBadge = { slug: string; title: string; points: number; awardedAt: string };
type DossierAuditEvent = { id: string; action: string; summary: string; createdAt: string; actor: string | null };
type Dossier = {
  user: {
    id: string;
    email: string;
    displayName: string;
    employeeCode: string | null;
    serviceLabel: string | null;
    status: string;
    roles: Role[];
    lastLoginAt: string | null;
    currentStreak: number;
    createdAt: string;
  };
  gamification: { xp: number; rank: DossierRank };
  enrollments: DossierEnrollment[];
  certificates: DossierCertificate[];
  badges: DossierBadge[];
  auditEvents: DossierAuditEvent[];
};

const DOSSIER_AUDIT_LABELS: Record<string, string> = {
  USER_CREATED: "Cuenta creada",
  USER_INVITED: "Invitación enviada",
  USER_INVITE_ACTIVATED: "Cuenta activada",
  USER_STATUS_CHANGED: "Estado de cuenta",
  USER_ROLE_GRANTED: "Rol asignado",
  USER_ROLE_REVOKED: "Rol retirado",
  USER_PASSWORD_RESET: "Contraseña restablecida",
  ENROLLMENT_GRANTED: "Inscripción",
  ENROLLMENT_REVOKED: "Acceso revocado",
  ENROLLMENT_BULK_UPDATED: "Ajuste masivo de inscripciones"
};

function humanizeAction(value: string) {
  const text = value.toLowerCase().replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function enrollmentStatusEs(status: string, expired: boolean) {
  if (expired || status === "EXPIRED") {
    return "Vencido";
  }
  return status === "COMPLETED" ? "Completado" : status === "SUSPENDED" ? "Suspendido" : "Activo";
}

function enrollmentStatusClass(status: string, expired: boolean) {
  if (expired || status === "EXPIRED") {
    return "vencido";
  }
  return status === "COMPLETED" ? "completado" : status === "SUSPENDED" ? "disabled" : "activo";
}

function dossierInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function UserDossier({ token, userId, onClose }: { token: string; userId: string; onClose: () => void }) {
  const [data, setData] = useState<Dossier | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    authFetch<Dossier>(token, `/admin/users/${userId}`)
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(errorText(loadError));
        }
      });
    return () => {
      active = false;
    };
  }, [token, userId]);

  return (
    <Modal title="Expediente del colaborador" onClose={onClose} size="xl" bodyClassName="dossier-body">
      {error ? <p className="error-line">{error}</p> : null}
      {!data && !error ? <p className="empty-state">Cargando expediente…</p> : null}
      {data ? (
        <div className="dossier">
          <header className="dossier-hero">
            <span className="avatar xl" aria-hidden>
              {dossierInitials(data.user.displayName)}
            </span>
            <div className="dossier-hero-body">
              <h3>{data.user.displayName}</h3>
              <p className="muted">{data.user.email}</p>
              <div className="dossier-hero-tags">
                <span className={`status-pill ${statusClass(data.user.status)}`}>{statusEs(data.user.status)}</span>
                {data.user.roles.map((role) => (
                  <span className={`role-chip ${role.toLowerCase()}`} key={role}>
                    {roleEs(role)}
                  </span>
                ))}
              </div>
            </div>
            <div className="dossier-rank">
              <span className="dossier-rank-name">
                <ShieldCheck aria-hidden /> {data.gamification.rank.name}
              </span>
              <strong>{data.gamification.xp.toLocaleString("es-MX")} XP</strong>
              <div className="dossier-rank-bar" aria-hidden>
                <span style={{ width: `${Math.min(100, Math.max(0, data.gamification.rank.pct))}%` }} />
              </div>
              <span className="dossier-streak">
                <Flame aria-hidden /> Racha de {data.user.currentStreak} día{data.user.currentStreak === 1 ? "" : "s"}
              </span>
            </div>
          </header>

          <dl className="dossier-meta">
            {data.user.employeeCode ? (
              <div>
                <dt>
                  <IdCard aria-hidden /> Código de colaborador
                </dt>
                <dd className="mono">{data.user.employeeCode}</dd>
              </div>
            ) : null}
            {data.user.serviceLabel ? (
              <div>
                <dt>Servicio</dt>
                <dd>{data.user.serviceLabel}</dd>
              </div>
            ) : null}
            <div>
              <dt>Último acceso</dt>
              <dd>{lastAccessEs(data.user.lastLoginAt).replace("Último acceso: ", "")}</dd>
            </div>
            <div>
              <dt>Alta</dt>
              <dd>{new Date(data.user.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</dd>
            </div>
          </dl>

          <section className="dossier-section">
            <div className="dossier-section-head">
              <GraduationCap aria-hidden />
              <h4>Cursos e inscripciones</h4>
              <span className="mono-label">{data.enrollments.length}</span>
            </div>
            {data.enrollments.length === 0 ? (
              <p className="empty-state">Sin inscripciones registradas.</p>
            ) : (
              <div className="table-wrap compact">
                <table>
                  <thead>
                    <tr>
                      <th>Curso</th>
                      <th>Avance</th>
                      <th>Estado</th>
                      <th>Vigencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.enrollments.map((enrollment) => (
                      <tr key={enrollment.id}>
                        <td>{enrollment.courseTitle}</td>
                        <td>{Math.round(enrollment.progressPercent)}%</td>
                        <td>
                          <span className={`status-pill ${enrollmentStatusClass(enrollment.status, enrollment.expired)}`}>
                            {enrollmentStatusEs(enrollment.status, enrollment.expired)}
                          </span>
                        </td>
                        <td>
                          {enrollment.expiresAt
                            ? new Date(enrollment.expiresAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })
                            : "Sin vencimiento"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="dossier-section">
            <div className="dossier-section-head">
              <Award aria-hidden />
              <h4>Diplomas</h4>
              <span className="mono-label">{data.certificates.length}</span>
            </div>
            {data.certificates.length === 0 ? (
              <p className="empty-state">Todavía no tiene diplomas emitidos.</p>
            ) : (
              <ul className="dossier-cert-list">
                {data.certificates.map((cert) => (
                  <li key={cert.id}>
                    <Award aria-hidden />
                    <div>
                      <strong>{cert.courseTitle}</strong>
                      <span className="mono-label">{cert.folio}</span>
                    </div>
                    <time className="mono-label" dateTime={cert.issuedAt}>
                      {new Date(cert.issuedAt).toLocaleDateString("es-MX")}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dossier-section">
            <div className="dossier-section-head">
              <BadgeCheck aria-hidden />
              <h4>Insignias</h4>
              <span className="mono-label">{data.badges.length}</span>
            </div>
            {data.badges.length === 0 ? (
              <p className="empty-state">Aún no ha ganado insignias.</p>
            ) : (
              <div className="dossier-badges">
                {data.badges.map((badge) => (
                  <span className="dossier-badge" key={badge.slug} title={`${badge.points} puntos`}>
                    <BadgeCheck aria-hidden /> {badge.title}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="dossier-section">
            <div className="dossier-section-head">
              <ScrollText aria-hidden />
              <h4>Auditoría reciente</h4>
              <span className="mono-label">{data.auditEvents.length}</span>
            </div>
            {data.auditEvents.length === 0 ? (
              <p className="empty-state">Sin eventos de auditoría para este colaborador.</p>
            ) : (
              <ol className="dossier-audit">
                {data.auditEvents.slice(0, 12).map((event) => (
                  <li key={event.id}>
                    <div className="dossier-audit-top">
                      <span className="mono-label">{DOSSIER_AUDIT_LABELS[event.action] ?? humanizeAction(event.action)}</span>
                      <time className="mono-label" dateTime={event.createdAt}>
                        {new Date(event.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
                      </time>
                    </div>
                    <p>{event.summary}</p>
                    {event.actor ? <small className="muted">{event.actor}</small> : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : null}
    </Modal>
  );
}
