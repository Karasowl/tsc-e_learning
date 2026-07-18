"use client";

/* ============================================================================
   CENTRO DE OPERACIONES (rol ADMIN).
   Cáscara de marca dark-first CON sidebar de secciones (el patrón reservado al
   admin), topbar con ancla de marca + reloj 24h + indicador EN VIVO + campana +
   buscador. Envuelve las capacidades admin REALES ya existentes (colaboradores,
   inscripciones, cursos, reportes, notificaciones, diplomas) y añade un TABLERO
   de aterrizaje y una BITÁCORA de auditoría. Todos los números salen de
   endpoints reales; nada se simula.
   ============================================================================ */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CalendarClock,
  Check,
  CheckCheck,
  ClipboardList,
  Clock,
  Contact,
  Download,
  Eye,
  FileText,
  Filter,
  GraduationCap,
  Inbox,
  Layers,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  Moon,
  Palette,
  RefreshCw,
  Save,
  ScrollText,
  Search,
  Send,
  Sun,
  Trash2,
  TrendingUp,
  Users,
  X
} from "lucide-react";
import { authFetch, authFetchRaw, errorText } from "./apiClient";
import { AuthoringView } from "./authoring";
import { ShieldMark } from "./guardApp";
import { TeachersDirectory } from "./panels";
import { buildReportPrintHtml, summarizeReportStatuses } from "./reportPrint";
import { confirmDialog, Modal, toast } from "./ui";
import { UsersRolesAdmin } from "./usersAdmin";

type User = {
  id: string;
  email: string;
  displayName: string;
  roles: Array<"ADMIN" | "TEACHER" | "STUDENT">;
};

type OpsView =
  | "dashboard"
  | "courses"
  | "enrollments"
  | "collaborators"
  | "directory"
  | "reports"
  | "diplomas"
  | "announcements"
  | "notifications"
  | "audit";

type NavItem = { key: OpsView; label: string; Icon: typeof LayoutDashboard };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operación",
    items: [
      { key: "dashboard", label: "Tablero", Icon: LayoutDashboard },
      { key: "courses", label: "Cursos", Icon: Boxes },
      { key: "enrollments", label: "Inscripciones", Icon: ClipboardList }
    ]
  },
  {
    label: "Personas",
    items: [
      { key: "collaborators", label: "Colaboradores", Icon: Users },
      { key: "directory", label: "Directorio", Icon: Contact }
    ]
  },
  {
    label: "Inteligencia",
    items: [
      { key: "reports", label: "Reportes", Icon: BarChart3 },
      { key: "diplomas", label: "Diplomas", Icon: Award },
      { key: "announcements", label: "Anuncios", Icon: Megaphone },
      { key: "notifications", label: "Correos automáticos", Icon: Mail },
      { key: "audit", label: "Bitácora", Icon: ScrollText }
    ]
  }
];

const VIEW_TITLES: Record<OpsView, string> = {
  dashboard: "Tablero",
  courses: "Cursos",
  enrollments: "Inscripciones",
  collaborators: "Colaboradores",
  directory: "Directorio",
  reports: "Reportes",
  diplomas: "Diplomas",
  announcements: "Anuncios",
  notifications: "Correos automáticos",
  audit: "Bitácora"
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

async function downloadWithAuth(token: string, path: string, filename: string) {
  // authFetchRaw centraliza el trato de sesión vencida (401 → salir y recargar).
  const response = await authFetchRaw(token, path);
  if (!response.ok) {
    throw new Error("No se pudo generar el archivo");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// ─── Reloj 24h (voz de datos operativa) ─────────────────────────────────────
function OpsClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!now) {
    // Avoid a hydration mismatch: render nothing until mounted on the client.
    return <span className="ops-clock" aria-hidden />;
  }
  const time = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const date = now.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });
  return (
    <span className="ops-clock" title={now.toLocaleString("es-MX")}>
      <Clock aria-hidden />
      <span className="ops-clock-time">{time}</span>
      <span className="ops-clock-date mono-label">{date}</span>
    </span>
  );
}

// ─── Campana in-app (bandeja real /me/notifications) ────────────────────────
type InAppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkType: string | null;
  linkId: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
};

function OpsInboxBell({ token }: { token: string }) {
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await authFetch<{ notifications: InAppNotification[]; unreadCount: number }>(token, "/me/notifications");
      setItems(data.notifications);
      setUnread(data.unreadCount);
    } catch {
      // La bandeja es auxiliar: un fallo de red no debe romper la topbar.
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 45000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function markOne(id: string) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
    setUnread((count) => Math.max(0, count - 1));
    try {
      await authFetch(token, `/me/notifications/${id}/read`, { method: "POST", body: "{}" });
    } catch {
      void load();
    }
  }

  async function markAll() {
    setBusy(true);
    try {
      await authFetch(token, "/me/notifications/read-all", { method: "POST", body: "{}" });
      await load();
    } catch (markError) {
      toast.error(errorText(markError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ops-inbox">
      <button
        className="icon-button ops-inbox-trigger"
        onClick={() => setOpen((value) => !value)}
        type="button"
        aria-label="Notificaciones"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Notificaciones"
      >
        <Bell aria-hidden />
        {unread > 0 ? <span className="ops-inbox-badge" aria-hidden>{unread > 99 ? "99+" : unread}</span> : null}
        {unread > 0 ? <span className="sr-only">{unread} sin leer</span> : null}
      </button>
      {open ? (
        <>
          <button className="menu-backdrop" aria-label="Cerrar notificaciones" onClick={() => setOpen(false)} type="button" />
          <div className="ops-inbox-panel" role="dialog" aria-label="Bandeja de notificaciones">
            <div className="ops-inbox-head">
              <strong>Notificaciones</strong>
              <button className="link-button" onClick={() => void markAll()} disabled={busy || unread === 0} type="button">
                <CheckCheck aria-hidden /> Marcar todo
              </button>
            </div>
            <div className="ops-inbox-list">
              {items.length === 0 ? (
                <p className="empty-state ops-inbox-empty">
                  <Inbox aria-hidden /> No tienes notificaciones.
                </p>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`ops-inbox-item${item.read ? "" : " is-unread"}`}
                    onClick={() => !item.read && void markOne(item.id)}
                  >
                    {!item.read ? <span className="ops-inbox-dot" aria-hidden /> : null}
                    <div className="ops-inbox-item-body">
                      <strong>{item.title}</strong>
                      {item.body ? <span>{item.body}</span> : null}
                      <time className="mono-label" dateTime={item.createdAt}>
                        {new Date(item.createdAt).toLocaleString("es-MX", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false
                        })}
                      </time>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function AdminOpsCenter({
  token,
  user,
  theme,
  onToggleTheme,
  onLogout
}: {
  token: string;
  user: User;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const [view, setView] = useState<OpsView>("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Drives the topbar "buscar colaborador" jump: bumping the nonce re-runs the
  // collaborators search with the typed term.
  const [collabQuery, setCollabQuery] = useState("");
  const [collabNonce, setCollabNonce] = useState(0);

  function go(next: OpsView) {
    setView(next);
    setNavOpen(false);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const value = search.trim();
    if (!value) {
      return;
    }
    setCollabQuery(value);
    setCollabNonce((n) => n + 1);
    go("collaborators");
  }

  return (
    <main className="ops-shell">
      {navOpen ? (
        <button className="ops-nav-backdrop" aria-label="Cerrar menú" onClick={() => setNavOpen(false)} type="button" />
      ) : null}

      <aside className={`ops-sidebar${navOpen ? " open" : ""}`}>
        <div className="ops-brand">
          <ShieldMark size={30} />
          <div className="ops-brand-text">
            <span className="ops-wordmark">CAPACITA</span>
            <span className="ops-brand-sub mono-label">Centro de operaciones</span>
          </div>
          <button className="icon-button ops-nav-close" onClick={() => setNavOpen(false)} aria-label="Cerrar menú" type="button">
            <X aria-hidden />
          </button>
        </div>

        <nav className="ops-nav" aria-label="Secciones">
          {NAV_GROUPS.map((group) => (
            <div className="ops-nav-group" key={group.label}>
              <p className="ops-nav-group-label">{group.label}</p>
              {group.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`ops-nav-item${view === item.key ? " active" : ""}`}
                  aria-current={view === item.key ? "page" : undefined}
                  onClick={() => go(item.key)}
                >
                  <item.Icon aria-hidden />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <button className="ghost-button ops-logout" onClick={onLogout} type="button">
          <LogOut aria-hidden /> Salir
        </button>
      </aside>

      <section className="ops-main">
        <header className="ops-topbar">
          <div className="ops-topbar-lead">
            <button className="ops-nav-toggle" aria-label="Abrir menú" onClick={() => setNavOpen(true)} type="button">
              <Menu aria-hidden />
            </button>
            <div className="ops-brand ops-brand-compact">
              <ShieldMark size={26} />
              <span className="ops-wordmark">CAPACITA</span>
            </div>
            <div className="ops-title-block">
              <p className="eyebrow">Administración</p>
              <h1 className="ops-title">{VIEW_TITLES[view]}</h1>
            </div>
          </div>

          <div className="ops-topbar-actions">
            <form className="ops-search" onSubmit={submitSearch} role="search">
              <Search aria-hidden />
              <input
                type="search"
                placeholder="Buscar colaborador…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Buscar colaborador"
              />
            </form>
            <OpsClock />
            <span className="ops-live" title="Datos en vivo desde la plataforma">
              <span className="ops-live-dot" aria-hidden />
              EN VIVO
            </span>
            <OpsInboxBell token={token} />
            <button
              className="icon-button ops-mail-shortcut"
              onClick={() => go("notifications")}
              type="button"
              aria-label="Correos automáticos"
              title="Correos automáticos"
            >
              <Mail aria-hidden />
            </button>
            <button className="icon-button" onClick={onToggleTheme} type="button" aria-label="Cambiar tema" title="Cambiar tema">
              {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
            </button>
            <div className="topbar-user">
              <button
                className="user-pill"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                type="button"
              >
                <span className="avatar" aria-hidden>{initials(user.displayName)}</span>
                <span>{user.displayName}</span>
              </button>
              {menuOpen ? (
                <>
                  <button className="menu-backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} type="button" />
                  <div className="profile-menu" role="menu">
                    <div className="profile-menu-head">
                      <span className="avatar lg" aria-hidden>{initials(user.displayName)}</span>
                      <div>
                        <strong>{user.displayName}</strong>
                        <small>{user.email}</small>
                      </div>
                    </div>
                    <p className="profile-roles">Administrador</p>
                    <button className="ghost-button profile-logout" onClick={onLogout} type="button">
                      <LogOut aria-hidden /> Salir
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </header>

        <div className="ops-scroll">
          {view === "dashboard" ? <OpsDashboard token={token} onNavigate={go} /> : null}
          {view === "courses" ? <AuthoringView token={token} isAdmin /> : null}
          {view === "enrollments" ? <OpsEnrollments token={token} /> : null}
          {view === "collaborators" ? (
            <UsersRolesAdmin token={token} currentUserId={user.id} initialQuery={collabQuery} queryNonce={collabNonce} />
          ) : null}
          {view === "directory" ? <TeachersDirectory token={token} /> : null}
          {view === "reports" ? <OpsReports token={token} /> : null}
          {view === "diplomas" ? <OpsDiplomas token={token} /> : null}
          {view === "announcements" ? <OpsAnnouncements token={token} /> : null}
          {view === "notifications" ? <OpsNotifications token={token} /> : null}
          {view === "audit" ? <OpsAudit token={token} /> : null}
        </div>
      </section>
    </main>
  );
}

// ─── TABLERO: KPIs reales + actividad reciente real ─────────────────────────
type Kpis = {
  activeCollaborators: number;
  totalCollaborators: number;
  invitedCollaborators: number;
  publishedCourses: number;
  completedCourses: number;
  diplomas: number;
};
type ActivityItem = {
  id: string;
  kind: "certificate" | "completion";
  label: string;
  actor: string;
  detail: string;
  reference: string | null;
  at: string;
};
// Bloques que el worker de API agrega a /admin/overview. Se tratan como opcionales
// para que el tablero siga funcionando aunque la API todavía no los devuelva.
type OpsAlert = { level: string; title: string; detail: string };
type ComplianceGroup = { total: number; completed: number; pct: number };
type ComplianceLine = ComplianceGroup & { line: string };
type ComplianceSite = ComplianceGroup & { site: string };
type Compliance = { byLine: ComplianceLine[]; bySite: ComplianceSite[] };
type CatalogItem = { id: string; title: string; status: string; enrolled: number; completed: number };
type BitacoraItem = { id: string; action: string; summary: string; createdAt: string; actor: string | null };
type OverviewResponse = {
  kpis: Kpis;
  activity: ActivityItem[];
  alert?: OpsAlert | null;
  compliance?: Compliance | null;
  catalog?: CatalogItem[] | null;
  bitacora24h?: BitacoraItem[] | null;
};

function alertToneClass(level: string): string {
  const value = level.toLowerCase();
  if (value === "danger" || value === "critical" || value === "error" || value === "high") return "danger";
  if (value === "warn" || value === "warning" || value === "medium") return "warn";
  return "info";
}

function courseStatusEs(status: string): string {
  const value = status.toUpperCase();
  if (value === "PUBLISHED") return "Publicado";
  if (value === "DRAFT") return "Borrador";
  if (value === "ARCHIVED") return "Archivado";
  return status;
}

function OpsDashboard({ token, onNavigate }: { token: string; onNavigate: (view: OpsView) => void }) {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [alert, setAlert] = useState<OpsAlert | null>(null);
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [bitacora, setBitacora] = useState<BitacoraItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setBusy(true);
        setError(null);
      }
      try {
        const data = await authFetch<OverviewResponse>(token, "/admin/overview");
        setKpis(data.kpis);
        setActivity(data.activity);
        setAlert(data.alert ?? null);
        setCompliance(data.compliance ?? null);
        setCatalog(data.catalog ?? []);
        setBitacora(data.bitacora24h ?? []);
        if (silent) {
          setError(null);
        }
      } catch (loadError) {
        // Un refresco de fondo fallido no debe tapar el tablero con un error.
        if (!silent) {
          setError(errorText(loadError));
        }
      } finally {
        if (!silent) {
          setBusy(false);
        }
      }
    },
    [token]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // "EN VIVO" real: re-consulta ligera del resumen cada 45s sin parpadeo,
  // limpiando el intervalo al desmontar.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void load(true);
    }, 45000);
    return () => window.clearInterval(timer);
  }, [load]);

  const cards: Array<{ label: string; value: number; Icon: typeof Award; target?: OpsView; tone: string }> = kpis
    ? [
        { label: "Colaboradores activos", value: kpis.activeCollaborators, Icon: Users, target: "collaborators", tone: "ok" },
        { label: "Cursos publicados", value: kpis.publishedCourses, Icon: Boxes, target: "courses", tone: "info" },
        { label: "Cursos completados", value: kpis.completedCourses, Icon: GraduationCap, target: "reports", tone: "" },
        { label: "Diplomas emitidos", value: kpis.diplomas, Icon: Award, target: "diplomas", tone: "brand" }
      ]
    : [];

  return (
    <section className="ops-dashboard">
      <div className="ops-section-head">
        <div>
          <p className="eyebrow">Resumen operativo</p>
          <h2>Estado de la plataforma</h2>
        </div>
        <button className="icon-button" disabled={busy} onClick={() => void load()} title="Actualizar" type="button">
          <RefreshCw aria-hidden />
        </button>
      </div>

      {error ? <p className="error-line">{error}</p> : null}

      {alert ? (
        <div className={`ops-alert card tone-${alertToneClass(alert.level)}`} role="status">
          <span className="ops-alert-icon" aria-hidden>
            <AlertTriangle aria-hidden />
          </span>
          <div className="ops-alert-body">
            <strong>{alert.title}</strong>
            <span>{alert.detail}</span>
          </div>
        </div>
      ) : null}

      <div className="ops-kpi-grid">
        {kpis
          ? cards.map((card) => (
              <button
                key={card.label}
                type="button"
                className={`ops-kpi card tone-${card.tone || "neutral"}`}
                onClick={() => card.target && onNavigate(card.target)}
              >
                <span className="ops-kpi-icon"><card.Icon aria-hidden /></span>
                <span className="ops-kpi-value">{card.value}</span>
                <span className="ops-kpi-label mono-label">{card.label}</span>
              </button>
            ))
          : Array.from({ length: 4 }).map((_, index) => <div className="ops-kpi card ops-kpi-skeleton" key={index} />)}
      </div>

      {kpis ? (
        <div className="ops-kpi-secondary">
          <span className="ops-chip">
            <Send aria-hidden /> {kpis.invitedCollaborators} invitación{kpis.invitedCollaborators === 1 ? "" : "es"} pendiente{kpis.invitedCollaborators === 1 ? "" : "s"}
          </span>
          <span className="ops-chip">
            <Users aria-hidden /> {kpis.totalCollaborators} colaborador{kpis.totalCollaborators === 1 ? "" : "es"} en total
          </span>
        </div>
      ) : null}

      <div className="ops-activity card">
        <div className="ops-block-head">
          <Activity aria-hidden />
          <h3>Actividad reciente</h3>
        </div>
        {busy && activity.length === 0 ? (
          <p className="empty-state">Cargando actividad…</p>
        ) : activity.length === 0 ? (
          <p className="empty-state">Aún no hay actividad registrada (diplomas emitidos o cursos completados aparecerán aquí).</p>
        ) : (
          <ul className="ops-activity-list">
            {activity.map((item) => (
              <li className="ops-activity-item" key={item.id}>
                <span className={`ops-activity-icon ${item.kind}`}>
                  {item.kind === "certificate" ? <Award aria-hidden /> : <GraduationCap aria-hidden />}
                </span>
                <div className="ops-activity-body">
                  <strong>{item.label}</strong>
                  <span>
                    {item.actor} · {item.detail}
                    {item.reference ? <span className="mono-label ops-activity-ref"> {item.reference}</span> : null}
                  </span>
                </div>
                <time className="ops-activity-time mono-label" dateTime={item.at}>
                  {new Date(item.at).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>

      {compliance && (compliance.byLine.length > 0 || compliance.bySite.length > 0) ? (
        <div className="ops-compliance-grid">
          <div className="ops-compliance card">
            <div className="ops-block-head">
              <TrendingUp aria-hidden />
              <h3>Cumplimiento por línea</h3>
            </div>
            {compliance.byLine.length === 0 ? (
              <p className="empty-state">Sin datos por línea todavía.</p>
            ) : (
              <ul className="ops-bars">
                {compliance.byLine.map((row) => (
                  <ComplianceBar key={`line-${row.line}`} label={row.line} completed={row.completed} total={row.total} pct={row.pct} />
                ))}
              </ul>
            )}
          </div>
          <div className="ops-compliance card">
            <div className="ops-block-head">
              <Building2 aria-hidden />
              <h3>Cumplimiento por sede</h3>
            </div>
            {compliance.bySite.length === 0 ? (
              <p className="empty-state">Sin datos por sede todavía.</p>
            ) : (
              <ul className="ops-bars">
                {compliance.bySite.map((row) => (
                  <ComplianceBar key={`site-${row.site}`} label={row.site} completed={row.completed} total={row.total} pct={row.pct} />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {catalog.length > 0 ? (
        <div className="ops-catalog card">
          <div className="ops-block-head">
            <Layers aria-hidden />
            <h3>Catálogo de cursos</h3>
          </div>
          <div className="table-wrap compact">
            <table>
              <thead>
                <tr>
                  <th>Curso</th>
                  <th>Estado</th>
                  <th>Inscritos</th>
                  <th>Completados</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((course) => (
                  <tr key={course.id}>
                    <td>{course.title}</td>
                    <td>
                      <span className={`status-pill ${course.status.toLowerCase()}`}>{courseStatusEs(course.status)}</span>
                    </td>
                    <td>{course.enrolled}</td>
                    <td>{course.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {bitacora.length > 0 ? (
        <div className="ops-bitacora card">
          <div className="ops-block-head">
            <ScrollText aria-hidden />
            <h3>Bitácora de las últimas 24 h</h3>
          </div>
          <ol className="ops-audit-list">
            {bitacora.map((event) => (
              <li className="ops-audit-item" key={event.id}>
                <span className="ops-audit-dot" aria-hidden />
                <div className="ops-audit-body">
                  <div className="ops-audit-top">
                    <span className="ops-audit-action mono-label">{AUDIT_ACTION_LABELS[event.action] ?? humanizeEnum(event.action)}</span>
                    <time className="ops-audit-time mono-label" dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
                    </time>
                  </div>
                  <p className="ops-audit-summary">{event.summary}</p>
                  {event.actor ? <small className="muted">{event.actor}</small> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function ComplianceBar({ label, completed, total, pct }: { label: string; completed: number; total: number; pct: number }) {
  const width = Math.min(100, Math.max(0, pct));
  return (
    <li className="ops-bar">
      <div className="ops-bar-top">
        <span className="ops-bar-label">{label}</span>
        <span className="ops-bar-figure mono-label">
          {completed}/{total} · {Math.round(pct)}%
        </span>
      </div>
      <div className="ops-bar-track" aria-hidden>
        <span className="ops-bar-fill" style={{ width: `${width}%` }} />
      </div>
    </li>
  );
}

// ─── INSCRIPCIONES: elige curso → gestiona su roster (endpoints reales) ─────
type AdminCourseLite = { id: string; title: string; status: string; _count: { enrollments: number } };
type EnrollmentRow = {
  userId: string;
  displayName: string;
  email: string;
  serviceLabel: string | null;
  status: string;
  progressPercent: number;
};
type StudentHit = { id: string; displayName: string; email: string; enrolled: boolean };

// Contenedor de INSCRIPCIONES: padrón maestro global (con filtros, paginación y
// acciones masivas) + la gestión por curso que ya existía (inscribir/revocar).
function OpsEnrollments({ token }: { token: string }) {
  const [mode, setMode] = useState<"master" | "course">("master");
  return (
    <section className="ops-enrollments-wrap">
      <div className="ops-enrollments-switch">
        <div className="ops-segmented" role="tablist" aria-label="Vista de inscripciones">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "master"}
            className={`ops-seg-btn${mode === "master" ? " is-active" : ""}`}
            onClick={() => setMode("master")}
          >
            <ClipboardList aria-hidden /> Padrón maestro
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "course"}
            className={`ops-seg-btn${mode === "course" ? " is-active" : ""}`}
            onClick={() => setMode("course")}
          >
            <Boxes aria-hidden /> Por curso
          </button>
        </div>
      </div>
      {mode === "master" ? <OpsEnrollmentsMaster token={token} /> : <OpsEnrollmentsByCourse token={token} />}
    </section>
  );
}

// ─── PADRÓN MAESTRO: GET /admin/enrollments con filtros, paginación y masivas ──
type MasterEnrollment = {
  id: string;
  userId: string;
  courseId: string;
  user: { id: string; displayName: string; email: string; employeeCode: string | null; serviceLabel: string | null };
  course: { id: string; title: string; slug: string };
  status: string;
  progressPercent: number;
  enrolledAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  sourceSystem: string | null;
};

const ENROLLMENT_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Todos los estados" },
  { value: "ACTIVE", label: "Activo" },
  { value: "COMPLETED", label: "Completado" },
  { value: "SUSPENDED", label: "Suspendido" },
  { value: "EXPIRED", label: "Vencido" }
];

function masterStatusEs(status: string, expired: boolean): string {
  if (expired || status === "EXPIRED") return "Vencido";
  return status === "COMPLETED" ? "Completado" : status === "SUSPENDED" ? "Suspendido" : "Activo";
}

function masterStatusClass(status: string, expired: boolean): string {
  if (expired || status === "EXPIRED") return "vencido";
  return status === "COMPLETED" ? "completado" : status === "SUSPENDED" ? "disabled" : "activo";
}

function sourceSystemEs(source: string | null): string {
  if (!source) return "Plataforma";
  const value = source.toLowerCase();
  if (value.includes("word") || value.includes("wp") || value.includes("tutor")) return "Migración";
  if (value === "seed") return "Plataforma";
  // Origen desconocido: se muestra humanizado (sin guiones bajos ni mayúsculas de sistema).
  return humanizeEnum(source);
}

// Conjunto estable de orígenes conocidos (no depende de la página visible):
// "wordpress" agrupa las inscripciones migradas de la plataforma anterior y el
// sentinela "none" agrupa las altas nativas (sin sistema de origen), que el
// servidor entiende como filtro de sourceSystem vacío. Cualquier valor nuevo
// observado en filas se fusiona como opción extra.
const BASE_SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "wordpress", label: "Migración" },
  { value: "none", label: "Plataforma" }
];

function OpsEnrollmentsMaster({ token }: { token: string }) {
  const [rows, setRows] = useState<MasterEnrollment[]>([]);
  const [courses, setCourses] = useState<AdminCourseLite[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [courseId, setCourseId] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [term, setTerm] = useState("");
  const [appliedTerm, setAppliedTerm] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiryDraft, setExpiryDraft] = useState("");

  // Opciones de origen: conjunto estable de valores conocidos fusionado con los
  // que aparezcan en las filas cargadas. El filtro se aplica en el servidor
  // ("none" es el sentinela para altas nativas sin sistema de origen). Si una
  // etiqueta se repite, se distingue con el nombre humanizado del valor.
  const sourceOptions = useMemo(() => {
    const map = new Map<string, string>(BASE_SOURCE_OPTIONS.map((option) => [option.value, option.label]));
    for (const row of rows) {
      if (row.sourceSystem && !map.has(row.sourceSystem)) {
        const base = sourceSystemEs(row.sourceSystem);
        const taken = new Set(map.values());
        map.set(row.sourceSystem, taken.has(base) ? `${base} · ${humanizeEnum(row.sourceSystem)}` : base);
      }
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (courseId) params.set("courseId", courseId);
      if (status) params.set("status", status);
      if (source) params.set("sourceSystem", source);
      if (appliedTerm.trim()) params.set("q", appliedTerm.trim());
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const data = await authFetch<{ enrollments: MasterEnrollment[]; total: number; page: number; pageSize: number }>(
        token,
        `/admin/enrollments?${params.toString()}`
      );
      setRows(data.enrollments);
      setTotal(data.total);
      setSelected(new Set());
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setBusy(false);
    }
  }, [token, courseId, status, source, appliedTerm, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    authFetch<{ courses: AdminCourseLite[] }>(token, "/admin/courses")
      .then((data) => setCourses(data.courses))
      .catch(() => setCourses([]));
  }, [token]);

  // Cualquier cambio de filtro vuelve a la primera página.
  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setAppliedTerm(term);
    setPage(1);
  }

  function toggleRow(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const allOnPageSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  function toggleAll() {
    setSelected((current) => {
      if (rows.every((row) => current.has(row.id))) {
        const next = new Set(current);
        for (const row of rows) {
          next.delete(row.id);
        }
        return next;
      }
      const next = new Set(current);
      for (const row of rows) {
        next.add(row.id);
      }
      return next;
    });
  }

  async function bulkUpdate(payload: { expiresAt?: string | null; status?: string }) {
    if (selected.size === 0) {
      return;
    }
    setBusy(true);
    try {
      const data = await authFetch<{ updated: number }>(token, "/admin/enrollments/bulk", {
        method: "POST",
        body: JSON.stringify({ enrollmentIds: Array.from(selected), ...payload })
      });
      toast.success(`${data.updated} inscripción${data.updated === 1 ? "" : "es"} actualizada${data.updated === 1 ? "" : "s"}.`);
      await load();
    } catch (bulkError) {
      toast.error(errorText(bulkError));
    } finally {
      setBusy(false);
    }
  }

  async function applyExpiry() {
    if (!expiryDraft) {
      toast.error("Elige una fecha de vencimiento.");
      return;
    }
    // El input date da YYYY-MM-DD; se envía como ISO de fin de día para incluir el día.
    const iso = new Date(`${expiryDraft}T23:59:59`).toISOString();
    await bulkUpdate({ expiresAt: iso });
    setExpiryDraft("");
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="data-section ops-enrollments-master">
      <div className="section-header">
        <div>
          <h3>Padrón maestro</h3>
          <small className="muted">Todas las inscripciones de la plataforma.</small>
        </div>
        <button className="icon-button" disabled={busy} onClick={() => void load()} title="Actualizar" type="button">
          <RefreshCw aria-hidden />
        </button>
      </div>

      {error ? <p className="error-line">{error}</p> : null}

      <div className="ops-master-filters">
        <label className="ops-filter">
          <span className="ops-filter-label">
            <Boxes aria-hidden /> Curso
          </span>
          <select value={courseId} onChange={(event) => changeFilter(setCourseId, event.target.value)}>
            <option value="">Todos los cursos</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </label>
        <label className="ops-filter">
          <span className="ops-filter-label">
            <Filter aria-hidden /> Estado
          </span>
          <select value={status} onChange={(event) => changeFilter(setStatus, event.target.value)}>
            {ENROLLMENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ops-filter">
          <span className="ops-filter-label">
            <Layers aria-hidden /> Origen
          </span>
          <select value={source} onChange={(event) => changeFilter(setSource, event.target.value)}>
            <option value="">Todos los orígenes</option>
            {sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <form className="ops-filter ops-filter-search" onSubmit={submitSearch} role="search">
          <span className="ops-filter-label">
            <Search aria-hidden /> Colaborador
          </span>
          <div className="ops-filter-search-row">
            <input
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Nombre, correo o código…"
              aria-label="Buscar colaborador"
            />
            <button className="secondary-button" disabled={busy} type="submit">
              Buscar
            </button>
          </div>
        </form>
      </div>

      {selected.size > 0 ? (
        <div className="ops-bulk-bar">
          <span className="ops-bulk-count">
            <Check aria-hidden /> {selected.size} seleccionada{selected.size === 1 ? "" : "s"}
          </span>
          <div className="ops-bulk-actions">
            <label className="ops-bulk-expiry">
              <CalendarClock aria-hidden />
              <input type="date" value={expiryDraft} onChange={(event) => setExpiryDraft(event.target.value)} aria-label="Fecha de vencimiento" />
              <button className="secondary-button" disabled={busy || !expiryDraft} onClick={() => void applyExpiry()} type="button">
                Fijar vencimiento
              </button>
            </label>
            <button className="secondary-button" disabled={busy} onClick={() => void bulkUpdate({ expiresAt: null })} type="button">
              Quitar vencimiento
            </button>
            <button className="secondary-button" disabled={busy} onClick={() => void bulkUpdate({ status: "SUSPENDED" })} type="button">
              Suspender
            </button>
            <button className="secondary-button" disabled={busy} onClick={() => void bulkUpdate({ status: "ACTIVE" })} type="button">
              Reactivar
            </button>
          </div>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="ops-master-table">
          <thead>
            <tr>
              <th className="ops-check-col">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAll}
                  aria-label="Seleccionar todo en esta página"
                />
              </th>
              <th>Colaborador</th>
              <th>Curso</th>
              <th>Origen</th>
              <th>Avance</th>
              <th>Estado</th>
              <th>Vence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={selected.has(row.id) ? "is-selected" : undefined}>
                <td className="ops-check-col">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                    aria-label={`Seleccionar ${row.user.displayName}`}
                  />
                </td>
                <td>
                  <strong>{row.user.displayName}</strong>
                  <br />
                  <small className="muted">{row.user.employeeCode ?? row.user.email}</small>
                </td>
                <td>{row.course.title}</td>
                <td>
                  <span className="mono-label">{sourceSystemEs(row.sourceSystem)}</span>
                </td>
                <td>{Math.round(row.progressPercent)}%</td>
                <td>
                  <span className={`status-pill ${masterStatusClass(row.status, row.expired)}`}>
                    {masterStatusEs(row.status, row.expired)}
                  </span>
                </td>
                <td>
                  {row.expiresAt
                    ? new Date(row.expiresAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })
                    : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !busy ? (
              <tr>
                <td colSpan={7}>
                  <p className="empty-state">No hay inscripciones que coincidan con los filtros.</p>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="ops-pagination">
        <span className="mono-label">
          {total} inscripción{total === 1 ? "" : "es"} · página {page} de {totalPages}
        </span>
        <div className="ops-pagination-controls">
          <button className="secondary-button" disabled={busy || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">
            Anterior
          </button>
          <button
            className="secondary-button"
            disabled={busy || page >= totalPages}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            type="button"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}

function OpsEnrollmentsByCourse({ token }: { token: string }) {
  const [courses, setCourses] = useState<AdminCourseLite[]>([]);
  const [courseId, setCourseId] = useState<string>("");
  const [roster, setRoster] = useState<EnrollmentRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [studentTerm, setStudentTerm] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [searching, setSearching] = useState(false);

  const loadCourses = useCallback(async () => {
    try {
      const data = await authFetch<{ courses: AdminCourseLite[] }>(token, "/admin/courses");
      setCourses(data.courses);
      setCourseId((current) => current || data.courses[0]?.id || "");
    } catch (loadError) {
      setError(errorText(loadError));
    }
  }, [token]);

  const loadRoster = useCallback(
    async (id: string) => {
      if (!id) {
        setRoster([]);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const data = await authFetch<{ enrollments: EnrollmentRow[] }>(token, `/admin/courses/${id}/enrollments`);
        setRoster(data.enrollments);
      } catch (loadError) {
        setError(errorText(loadError));
      } finally {
        setBusy(false);
      }
    },
    [token]
  );

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    if (courseId) {
      void loadRoster(courseId);
    }
  }, [courseId, loadRoster]);

  async function searchStudents(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (studentTerm.trim()) {
        params.set("q", studentTerm.trim());
      }
      if (courseId) {
        params.set("courseId", courseId);
      }
      const data = await authFetch<{ students: StudentHit[] }>(token, `/admin/students?${params.toString()}`);
      setHits(data.students);
    } catch (searchError) {
      toast.error(errorText(searchError));
    } finally {
      setSearching(false);
    }
  }

  async function enroll(userId: string) {
    if (!courseId) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${courseId}/enrollments`, {
        method: "POST",
        body: JSON.stringify({ userId })
      });
      toast.success("Acceso otorgado.");
      setHits((current) => current.map((hit) => (hit.id === userId ? { ...hit, enrolled: true } : hit)));
      await loadRoster(courseId);
    } catch (enrollError) {
      toast.error(errorText(enrollError));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string, displayName: string) {
    if (!courseId) {
      return;
    }
    // El DELETE es definitivo y borra el progreso del colaborador: se confirma antes.
    const confirmed = await confirmDialog({
      title: "Revocar inscripción",
      message:
        "Se quitará el acceso y se perderá el avance registrado de este colaborador en el curso. Esta acción no se puede deshacer.",
      confirmLabel: "Revocar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${courseId}/enrollments/${userId}`, { method: "DELETE" });
      toast.success(`Acceso de ${displayName} revocado.`);
      await loadRoster(courseId);
    } catch (revokeError) {
      toast.error(errorText(revokeError));
    } finally {
      setBusy(false);
    }
  }

  const activeCourse = courses.find((course) => course.id === courseId) ?? null;

  return (
    <section className="data-section ops-enrollments">
      <div className="section-header">
        <h2>Inscripciones por curso</h2>
        <button className="icon-button" disabled={busy} onClick={() => void loadRoster(courseId)} title="Actualizar" type="button">
          <RefreshCw aria-hidden />
        </button>
      </div>

      {error ? <p className="error-line">{error}</p> : null}

      <div className="ops-enroll-toolbar">
        <label className="ops-course-picker">
          Curso
          <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            {courses.length === 0 ? <option value="">Sin cursos</option> : null}
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title} · {course._count.enrollments} inscritos
              </option>
            ))}
          </select>
        </label>
        <form className="ops-student-search" onSubmit={searchStudents} role="search">
          <div className="search-field">
            <Search aria-hidden />
            <input
              type="search"
              placeholder="Buscar colaborador para inscribir…"
              value={studentTerm}
              onChange={(event) => setStudentTerm(event.target.value)}
              aria-label="Buscar colaborador para inscribir"
            />
          </div>
          <button className="secondary-button" disabled={searching || !courseId} type="submit">
            Buscar
          </button>
        </form>
      </div>

      {hits.length > 0 ? (
        <div className="ops-hits">
          {hits.map((hit) => (
            <div className="ops-hit" key={hit.id}>
              <div>
                <strong>{hit.displayName}</strong>
                <small className="muted">{hit.email}</small>
              </div>
              {hit.enrolled ? (
                <span className="status-pill activo">Ya inscrito</span>
              ) : (
                <button className="btn btn--brand" disabled={busy} onClick={() => void enroll(hit.id)} type="button">
                  <Check aria-hidden /> Inscribir
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Servicio</th>
              <th>Avance</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {roster.map((row) => (
              <tr key={row.userId}>
                <td>
                  <strong>{row.displayName}</strong>
                  <br />
                  <small className="muted">{row.email}</small>
                </td>
                <td>{row.serviceLabel ?? "Sin servicio"}</td>
                <td>{Math.round(row.progressPercent)}%</td>
                <td>
                  <span className={`status-pill ${row.status === "COMPLETED" ? "completado" : row.status === "SUSPENDED" ? "disabled" : "activo"}`}>
                    {row.status === "COMPLETED" ? "Completado" : row.status === "SUSPENDED" ? "Suspendido" : "Activo"}
                  </span>
                </td>
                <td>
                  <button className="ghost-button" disabled={busy} onClick={() => void revoke(row.userId, row.displayName)} type="button">
                    <Trash2 aria-hidden /> Revocar
                  </button>
                </td>
              </tr>
            ))}
            {roster.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <p className="empty-state">
                    {activeCourse ? "Nadie tiene acceso a este curso todavía. Búscalo arriba para inscribir." : "Elige un curso para ver su roster."}
                  </p>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── REPORTES: reporte real de colaboradores + export Excel/PDF ─────────────
type ReportRow = {
  studentName: string;
  email: string;
  serviceLabel: string | null;
  courseTitle: string;
  progressPercent: number | null;
  status: string;
  latestAttempt: { scorePercent: number | null } | null;
};

function OpsReports({ token }: { token: string }) {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await authFetch<{ summary: Record<string, number>; rows: ReportRow[] }>(token, "/reports/students");
      setSummary(data.summary);
      setRows(data.rows);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return rows;
    }
    return rows.filter(
      (row) =>
        row.studentName.toLowerCase().includes(q) ||
        row.email.toLowerCase().includes(q) ||
        (row.serviceLabel ?? "").toLowerCase().includes(q) ||
        row.courseTitle.toLowerCase().includes(q)
    );
  }, [rows, query]);

  async function exportExcel() {
    try {
      // El export respeta la búsqueda activa: el servidor filtra con `q`.
      const q = query.trim();
      const path = `/reports/students/export.xlsx${q ? `?q=${encodeURIComponent(q)}` : ""}`;
      await downloadWithAuth(token, path, `reporte-colaboradores-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (exportError) {
      toast.error(errorText(exportError));
    }
  }

  function exportPdf() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("El navegador bloqueó la ventana emergente. Habilítalas para exportar el PDF.");
      return;
    }
    // Se imprime lo que se ve: las filas ya filtradas por la búsqueda activa,
    // con el resumen recalculado sobre esas mismas filas (no el global).
    printWindow.document.write(buildReportPrintHtml(filtered, summarizeReportStatuses(filtered, summary)));
    printWindow.document.close();
    printWindow.focus();
  }

  return (
    <section className="data-section ops-reports">
      <div className="section-header">
        <h2>Reporte de colaboradores</h2>
        <div className="quiz-actions">
          <button className="icon-button" disabled={busy} onClick={() => void load()} title="Actualizar" type="button">
            <RefreshCw aria-hidden />
          </button>
          <button className="secondary-button" disabled={busy || rows.length === 0} onClick={() => void exportExcel()} type="button">
            <Download aria-hidden /> Excel
          </button>
          <button className="secondary-button" disabled={rows.length === 0} onClick={exportPdf} type="button">
            <FileText aria-hidden /> PDF
          </button>
        </div>
      </div>

      {error ? <p className="error-line">{error}</p> : null}

      <div className="metrics-row">
        {Object.entries(summary).map(([label, value]) => (
          <div className={`metric ${metricClass(label)}`} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      {rows.length > 0 ? (
        <div className="catalog-toolbar">
          <div className="search-field">
            <Search aria-hidden />
            <input
              type="search"
              placeholder="Buscar colaborador, servicio o curso…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Buscar en el reporte"
            />
          </div>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Servicio</th>
              <th>Curso</th>
              <th>Avance</th>
              <th>Resultado</th>
              <th>Puntaje</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, index) => (
              <tr key={`${row.email}-${row.courseTitle}-${index}`}>
                <td>
                  <strong>{row.studentName}</strong>
                  <br />
                  <small className="muted">{row.email}</small>
                </td>
                <td>{row.serviceLabel ?? "Sin servicio"}</td>
                <td>{row.courseTitle}</td>
                <td>{row.progressPercent ?? 0}%</td>
                <td>
                  <span className={`status-pill ${row.status.toLowerCase().replaceAll(" ", "-")}`}>{row.status}</span>
                </td>
                <td>{row.latestAttempt?.scorePercent != null ? `${row.latestAttempt.scorePercent}%` : "N/D"}</td>
              </tr>
            ))}
            {rows.length === 0 && !busy ? (
              <tr>
                <td colSpan={6}>
                  <p className="empty-state">Todavía no hay colaboradores inscritos en cursos publicados.</p>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <p className="empty-state">No hay filas que coincidan con la búsqueda.</p>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function metricClass(label: string): string {
  const value = label.toLowerCase();
  if (value.includes("aprobad")) return "ok";
  if (value.includes("reprobad")) return "bad";
  if (value.includes("progreso")) return "info";
  if (value.includes("pendiente")) return "warn";
  return "";
}

// ─── DIPLOMAS: emitidos reales (ver / descargar) + emisión y revocación admin ─
type Certificate = {
  id: string;
  status: string;
  folio: string;
  issuedAt: string;
  revokedAt: string | null;
  user: { displayName: string; email: string };
  course: { title: string };
};

// Candidato a emisión admin: inscripción COMPLETED sin diploma vigente.
type DiplomaCandidate = {
  userId: string;
  displayName: string;
  email: string;
  courseId: string;
  courseTitle: string;
};

function OpsDiplomas({ token }: { token: string }) {
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [candidates, setCandidates] = useState<DiplomaCandidate[]>([]);
  const [candidatesReady, setCandidatesReady] = useState(false);
  const [selected, setSelected] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await authFetch<{ certificates: Certificate[] }>(token, "/certificates");
      setCerts(data.certificates);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function view(id: string) {
    try {
      const response = await authFetchRaw(token, `/certificates/${id}/html`);
      if (!response.ok) {
        throw new Error("No se pudo abrir el diploma");
      }
      const blob = new Blob([await response.text()], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
    } catch (viewError) {
      toast.error(errorText(viewError));
    }
  }

  async function download(id: string, folio: string) {
    try {
      await downloadWithAuth(token, `/certificates/${id}/pdf`, `diploma-${folio}.pdf`);
    } catch (downloadError) {
      toast.error(errorText(downloadError));
    }
  }

  async function openIssue() {
    setIssueOpen(true);
    setSelected("");
    setCandidatesReady(false);
    try {
      const data = await authFetch<{ candidates: DiplomaCandidate[] }>(token, "/admin/certificates/candidates");
      setCandidates(data.candidates);
    } catch (candidatesError) {
      toast.error(errorText(candidatesError));
      setCandidates([]);
    } finally {
      setCandidatesReady(true);
    }
  }

  async function issue() {
    const candidate = candidates.find((row) => `${row.userId}:${row.courseId}` === selected);
    if (!candidate) {
      toast.error("Elige al colaborador y el curso del diploma.");
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, "/admin/certificates", {
        method: "POST",
        body: JSON.stringify({ userId: candidate.userId, courseId: candidate.courseId })
      });
      toast.success(`Diploma emitido a ${candidate.displayName}.`);
      setIssueOpen(false);
      await load();
    } catch (issueError) {
      toast.error(errorText(issueError));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(cert: Certificate) {
    const confirmed = await confirmDialog({
      title: "Revocar diploma",
      message: `El diploma quedará invalidado y la verificación pública lo mostrará como revocado. Colaborador: ${cert.user.displayName}. Curso: ${cert.course.title}.`,
      confirmLabel: "Revocar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/certificates/${cert.id}/revoke`, { method: "POST", body: "{}" });
      toast.success("Diploma revocado.");
      await load();
    } catch (revokeError) {
      toast.error(errorText(revokeError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <OpsCertificateTemplates token={token} />
      <section className="data-section ops-diplomas">
      <div className="section-header">
        <h2>Diplomas emitidos</h2>
        <div className="quiz-actions">
          <button className="secondary-button" disabled={busy} onClick={() => void openIssue()} type="button">
            <Award aria-hidden /> Emitir diploma
          </button>
          <button className="icon-button" disabled={busy} onClick={() => void load()} title="Actualizar" type="button">
            <RefreshCw aria-hidden />
          </button>
        </div>
      </div>

      {error ? <p className="error-line">{error}</p> : null}

      {certs.length === 0 && !busy ? (
        <p className="empty-state">Aún no se ha emitido ningún diploma.</p>
      ) : (
        <div className="certificate-grid">
          {certs.map((cert) => (
            <article className="certificate-tile" key={cert.id}>
              <Award aria-hidden />
              <div>
                <strong>{cert.course.title}</strong>
                <span>{cert.user.displayName}</span>
                <span className="mono-label">{cert.folio}</span>
                <small>
                  {new Date(cert.issuedAt).toLocaleDateString("es-MX")}
                  {cert.status === "REVOKED" && cert.revokedAt
                    ? ` · Revocado el ${new Date(cert.revokedAt).toLocaleDateString("es-MX")}`
                    : ""}
                </small>
                {cert.status === "REVOKED" ? <span className="status-pill disabled">Revocado</span> : null}
              </div>
              <div className="tile-actions">
                <button className="icon-button" onClick={() => void view(cert.id)} title="Ver diploma" type="button">
                  <FileText aria-hidden />
                </button>
                <button className="icon-button" onClick={() => void download(cert.id, cert.folio)} title="Descargar PDF" type="button">
                  <Download aria-hidden />
                </button>
                {cert.status === "REVOKED" ? null : (
                  <button
                    className="icon-button"
                    disabled={busy}
                    onClick={() => void revoke(cert)}
                    title="Revocar diploma"
                    aria-label="Revocar diploma"
                    type="button"
                  >
                    <Trash2 aria-hidden />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      </section>

      {issueOpen ? (
        <Modal onClose={() => setIssueOpen(false)} title="Emitir diploma">
          <div className="ops-issue-diploma">
            <p className="muted">
              Solo aparecen colaboradores que completaron un curso y todavía no tienen su diploma vigente.
            </p>
            {!candidatesReady ? (
              <p className="muted">Buscando colaboradores...</p>
            ) : candidates.length === 0 ? (
              <p className="empty-state">No hay diplomas pendientes por emitir.</p>
            ) : (
              <>
                <label>
                  Colaborador y curso
                  <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                    <option value="">Elige una opción</option>
                    {candidates.map((candidate) => (
                      <option key={`${candidate.userId}:${candidate.courseId}`} value={`${candidate.userId}:${candidate.courseId}`}>
                        {candidate.displayName} · {candidate.courseTitle}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="quiz-actions">
                  <button className="primary-button" disabled={busy || !selected} onClick={() => void issue()} type="button">
                    <Award aria-hidden /> Emitir diploma
                  </button>
                  <button className="ghost-button" disabled={busy} onClick={() => setIssueOpen(false)} type="button">
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ─── PLANTILLAS DE DIPLOMA (admin): CRUD + vista previa + asignar a curso ─────
type OpsCertTemplate = {
  id: string;
  name: string;
  body: { title?: string; legend?: string; backgroundUrl?: string } & Record<string, unknown>;
  courseIds: string[];
};

const CERT_SAMPLE = {
  courseTitle: "Protección ejecutiva",
  studentName: "María Fernanda López",
  folio: "TSC-2026-0148",
  verificationCode: "9F3A-77BD",
  issuedAt: "17 de julio de 2026"
};

function fillCertMarkers(text: string): string {
  return text
    .replaceAll("{{courseTitle}}", CERT_SAMPLE.courseTitle)
    .replaceAll("{{studentName}}", CERT_SAMPLE.studentName)
    .replaceAll("{{folio}}", CERT_SAMPLE.folio)
    .replaceAll("{{verificationCode}}", CERT_SAMPLE.verificationCode)
    .replaceAll("{{issuedAt}}", CERT_SAMPLE.issuedAt);
}

function OpsCertificateTemplates({ token }: { token: string }) {
  const [templates, setTemplates] = useState<OpsCertTemplate[]>([]);
  const [courses, setCourses] = useState<AdminCourseLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [designerOpen, setDesignerOpen] = useState(false);
  const [editing, setEditing] = useState<OpsCertTemplate | null>(null);
  const [assignCourse, setAssignCourse] = useState("");
  const [assignTemplate, setAssignTemplate] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [templateData, courseData] = await Promise.all([
        authFetch<{ templates: OpsCertTemplate[] }>(token, "/admin/certificate-templates"),
        authFetch<{ courses: AdminCourseLite[] }>(token, "/admin/courses")
      ]);
      setTemplates(templateData.templates);
      setCourses(courseData.courses);
    } catch (loadError) {
      setError(errorText(loadError));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const courseTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const course of courses) {
      map.set(course.id, course.title);
    }
    return map;
  }, [courses]);

  function openNew() {
    setEditing(null);
    setDesignerOpen(true);
  }

  function openEdit(template: OpsCertTemplate) {
    setEditing(template);
    setDesignerOpen(true);
  }

  async function remove(template: OpsCertTemplate) {
    const confirmed = await confirmDialog({
      title: "Eliminar plantilla",
      message: "Los cursos vinculados volverán al diseño de diploma por defecto.",
      confirmLabel: "Eliminar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/certificate-templates/${template.id}`, { method: "DELETE" });
      toast.success("Plantilla eliminada.");
      await load();
    } catch (removeError) {
      toast.error(errorText(removeError));
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    if (!assignCourse || !assignTemplate) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${assignCourse}/certificate-template`, {
        method: "POST",
        body: JSON.stringify({ templateId: assignTemplate })
      });
      toast.success("Plantilla asignada al curso.");
      setAssignCourse("");
      setAssignTemplate("");
      await load();
    } catch (assignError) {
      toast.error(errorText(assignError));
    } finally {
      setBusy(false);
    }
  }

  async function unassign(courseId: string) {
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${courseId}/certificate-template`, { method: "DELETE" });
      toast.success("El curso vuelve al diseño por defecto.");
      await load();
    } catch (unassignError) {
      toast.error(errorText(unassignError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="data-section ops-cert-templates">
      <div className="section-header">
        <div>
          <h2>Plantillas de diploma</h2>
          <small className="muted">Diseña el diploma y asígnalo a los cursos que quieras.</small>
        </div>
        <button className="btn btn--brand" type="button" onClick={openNew}>
          <Palette aria-hidden /> Diseñar plantilla
        </button>
      </div>

      {error ? <p className="error-line">{error}</p> : null}

      {templates.length === 0 ? (
        <p className="empty-state">Aún no hay plantillas. Crea la primera para personalizar los diplomas.</p>
      ) : (
        <ul className="ops-cert-list">
          {templates.map((template) => {
            const linkedCourses = template.courseIds.map((id) => courseTitleById.get(id) ?? "Curso").filter(Boolean);
            return (
              <li className="ops-cert-item" key={template.id}>
                <span className="ops-cert-icon" aria-hidden>
                  <Award aria-hidden />
                </span>
                <div className="ops-cert-item-body">
                  <strong>{template.name}</strong>
                  <span className="muted">
                    {linkedCourses.length === 0
                      ? "Sin cursos vinculados"
                      : `Vinculada a: ${linkedCourses.join(", ")}`}
                  </span>
                </div>
                <div className="ops-cert-item-actions">
                  <button className="ghost-button" type="button" onClick={() => openEdit(template)}>
                    <Eye aria-hidden /> Editar
                  </button>
                  <button className="icon-button" type="button" disabled={busy} onClick={() => void remove(template)} title="Eliminar plantilla" aria-label={`Eliminar ${template.name}`}>
                    <Trash2 aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="ops-cert-assign">
        <div className="ops-block-head">
          <Boxes aria-hidden />
          <h3>Asignar plantilla a un curso</h3>
        </div>
        <div className="ops-cert-assign-form">
          <select value={assignCourse} onChange={(event) => setAssignCourse(event.target.value)} aria-label="Curso">
            <option value="">Elige un curso…</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
          <select value={assignTemplate} onChange={(event) => setAssignTemplate(event.target.value)} aria-label="Plantilla" disabled={templates.length === 0}>
            <option value="">{templates.length === 0 ? "Sin plantillas" : "Elige una plantilla…"}</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <button className="btn btn--dark" type="button" disabled={busy || !assignCourse || !assignTemplate} onClick={() => void assign()}>
            <Check aria-hidden /> Asignar
          </button>
        </div>
        {courses.some((course) => templates.some((template) => template.courseIds.includes(course.id))) ? (
          <ul className="ops-cert-links">
            {courses
              .filter((course) => templates.some((template) => template.courseIds.includes(course.id)))
              .map((course) => {
                const template = templates.find((item) => item.courseIds.includes(course.id));
                return (
                  <li key={course.id}>
                    <span>
                      <strong>{course.title}</strong> · <span className="muted">{template?.name}</span>
                    </span>
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => void unassign(course.id)}>
                      <X aria-hidden /> Quitar
                    </button>
                  </li>
                );
              })}
          </ul>
        ) : null}
      </div>

      {designerOpen ? (
        <AdminCertificateDesigner
          token={token}
          template={editing}
          onClose={() => setDesignerOpen(false)}
          onSavedClose={async () => {
            setDesignerOpen(false);
            await load();
          }}
        />
      ) : null}
    </section>
  );
}

function AdminCertificateDesigner({
  token,
  template,
  onClose,
  onSavedClose
}: {
  token: string;
  template: OpsCertTemplate | null;
  onClose: () => void;
  onSavedClose: () => Promise<void> | void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [title, setTitle] = useState(template?.body.title ?? "");
  const [legend, setLegend] = useState(template?.body.legend ?? "");
  const [backgroundUrl, setBackgroundUrl] = useState(template?.body.backgroundUrl ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast.error("La plantilla necesita un nombre.");
      return;
    }
    setBusy(true);
    const body: Record<string, string> = {};
    if (title.trim()) body.title = title.trim();
    if (legend.trim()) body.legend = legend.trim();
    if (backgroundUrl.trim()) body.backgroundUrl = backgroundUrl.trim();
    try {
      if (template) {
        await authFetch(token, `/admin/certificate-templates/${template.id}`, {
          method: "PUT",
          body: JSON.stringify({ name: name.trim(), body })
        });
      } else {
        await authFetch(token, "/admin/certificate-templates", {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), body })
        });
      }
      toast.success("Plantilla guardada.");
      await onSavedClose();
    } catch (saveError) {
      toast.error(errorText(saveError));
    } finally {
      setBusy(false);
    }
  }

  const previewTitle = fillCertMarkers(title.trim() || "Constancia de finalización");
  const previewLegend = fillCertMarkers(legend.trim() || "Se otorga a {{studentName}} por completar {{courseTitle}}.");

  return (
    <Modal title={template ? "Editar plantilla de diploma" : "Nueva plantilla de diploma"} onClose={onClose} size="xl">
      <div className="cert-designer">
        <div className="cert-designer-form">
          <label>
            Nombre de la plantilla
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="p. ej. Protección ejecutiva 2026" />
          </label>
          <label>
            Título del diploma
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Constancia de finalización" />
          </label>
          <label>
            Leyenda
            <textarea
              rows={3}
              value={legend}
              onChange={(event) => setLegend(event.target.value)}
              placeholder="Se otorga a {{studentName}} por completar {{courseTitle}}."
            />
          </label>
          <label>
            Fondo (URL de imagen, opcional)
            <input value={backgroundUrl} onChange={(event) => setBackgroundUrl(event.target.value)} placeholder="https://…" />
          </label>
          <p className="muted cert-markers">
            Marcadores disponibles: {"{{courseTitle}} · {{studentName}} · {{folio}} · {{verificationCode}} · {{issuedAt}}"}
          </p>
          <div className="cert-designer-actions">
            <button className="btn btn--ghost" type="button" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button className="btn btn--brand" type="button" onClick={() => void save()} disabled={busy}>
              <Save aria-hidden /> {template ? "Guardar cambios" : "Crear plantilla"}
            </button>
          </div>
        </div>

        <div className="cert-preview-col">
          <span className="mono-label">
            <Eye aria-hidden /> Vista previa
          </span>
          <div
            className="cert-preview"
            style={backgroundUrl.trim() ? { backgroundImage: `url(${backgroundUrl.trim()})` } : undefined}
          >
            <div className="cert-preview-inner">
              <ShieldMark size={38} />
              <h2>{previewTitle}</h2>
              <p className="cert-preview-legend">{previewLegend}</p>
              <div className="cert-preview-meta">
                <span>Folio {CERT_SAMPLE.folio}</span>
                <span>Código {CERT_SAMPLE.verificationCode}</span>
                <span>{CERT_SAMPLE.issuedAt}</span>
              </div>
            </div>
          </div>
          <small className="muted">Datos de ejemplo. En el diploma real se sustituyen por los del colaborador.</small>
        </div>
      </div>
    </Modal>
  );
}

// ─── ANUNCIOS GLOBALES (admin): compositor + lista de publicados ─────────────
type AdminAnnouncement = {
  id: string;
  scope: string;
  courseId: string | null;
  courseTitle: string | null;
  title: string;
  body: string;
  author: string | null;
  publishedAt: string | null;
  createdAt: string;
};

function OpsAnnouncements({ token }: { token: string }) {
  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await authFetch<{ announcements: AdminAnnouncement[] }>(token, "/me/announcements");
      setItems(data.announcements.filter((item) => item.scope === "GLOBAL"));
    } catch (loadError) {
      setError(errorText(loadError));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !body.trim()) {
      toast.error("El anuncio necesita título y mensaje.");
      return;
    }
    setBusy(true);
    try {
      const data = await authFetch<{ announcement: AdminAnnouncement; notified: number }>(token, "/admin/announcements", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), body: body.trim() })
      });
      toast.success(
        data.notified === 1
          ? "Anuncio publicado. Se notificó a 1 colaborador."
          : `Anuncio publicado. Se notificó a ${data.notified} colaboradores.`
      );
      setTitle("");
      setBody("");
      await load();
    } catch (publishError) {
      toast.error(errorText(publishError));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const confirmed = await confirmDialog({
      title: "Eliminar anuncio",
      message: "El aviso dejará de mostrarse a los colaboradores.",
      confirmLabel: "Eliminar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    try {
      await authFetch(token, `/admin/announcements/${id}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== id));
      toast.success("Anuncio eliminado.");
    } catch (removeError) {
      toast.error(errorText(removeError));
    }
  }

  return (
    <section className="data-section ops-announcements">
      <div className="section-header">
        <div>
          <h2>Anuncios de la plataforma</h2>
          <small className="muted">Cada colaborador recibe el aviso en su campana.</small>
        </div>
      </div>

      <form className="tconsole-anuncio-form card" onSubmit={publish}>
        <label>
          Título
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título del anuncio" maxLength={200} />
        </label>
        <label>
          Mensaje
          <textarea
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Escribe el aviso para toda la plataforma…"
            maxLength={5000}
          />
        </label>
        <div className="tconsole-anuncio-actions">
          <button className="btn btn--brand" type="submit" disabled={busy || !title.trim() || !body.trim()}>
            <Send aria-hidden /> {busy ? "Publicando…" : "Publicar anuncio"}
          </button>
        </div>
      </form>

      {error ? <p className="error-line">{error}</p> : null}

      {items.length === 0 ? (
        <p className="empty-state">Todavía no has publicado anuncios globales.</p>
      ) : (
        <ul className="tconsole-anuncio-list">
          {items.map((item) => (
            <li className="tconsole-anuncio card" key={item.id}>
              <div className="tconsole-anuncio-top">
                <strong>{item.title}</strong>
                <button className="icon-button" type="button" onClick={() => void remove(item.id)} title="Eliminar anuncio" aria-label="Eliminar anuncio">
                  <Trash2 aria-hidden />
                </button>
              </div>
              <p className="tconsole-anuncio-body">{item.body}</p>
              <span className="mono-label tconsole-anuncio-meta">
                {item.author ? `${item.author} · ` : ""}
                {new Date(item.publishedAt ?? item.createdAt).toLocaleString("es-MX", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── NOTIFICACIONES: reglas de correo + logs (endpoints reales) ─────────────
type NotificationRule = { id: string; eventType: string; recipients: string[]; subject: string; enabled: boolean };
type NotificationLog = { id: string; eventType: string; sentTo: string[]; status: string; createdAt: string };

const NOTIFICATION_EVENT_LABELS: Record<string, string> = {
  QUIZ_PASSED: "Examen aprobado",
  QUIZ_FAILED: "Examen reprobado",
  COURSE_COMPLETED: "Curso completado",
  CERTIFICATE_ISSUED: "Diploma emitido",
  ANNOUNCEMENT_PUBLISHED: "Anuncio publicado"
};
const NOTIFICATION_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  SENT: "Enviado",
  FAILED: "Fallido",
  SENDING: "Enviando",
  SKIPPED: "Omitido"
};

function humanizeEnum(value: string) {
  const text = value.toLowerCase().replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Lee un conteo numérico tolerando variantes de nombre en la respuesta del servidor.
function readCount(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function OpsNotifications({ token }: { token: string }) {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Edición inline de una regla existente (asunto + destinatarios).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editRecipients, setEditRecipients] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [ruleData, logData] = await Promise.all([
        authFetch<{ rules: NotificationRule[] }>(token, "/notifications/rules"),
        authFetch<{ logs: NotificationLog[] }>(token, "/notifications/logs")
      ]);
      setRules(ruleData.rules);
      setLogs(logData.logs);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const data = new FormData(formEl);
    setBusy(true);
    try {
      await authFetch(token, "/notifications/rules", {
        method: "POST",
        body: JSON.stringify({
          eventType: data.get("eventType"),
          subject: data.get("subject"),
          recipients: String(data.get("recipients") ?? "")
            .split(",")
            .map((recipient) => recipient.trim())
            .filter(Boolean),
          enabled: true
        })
      });
      formEl.reset();
      await load();
      toast.success("Regla guardada.");
    } catch (createError) {
      toast.error(errorText(createError));
    } finally {
      setBusy(false);
    }
  }

  async function updateRule(
    ruleId: string,
    payload: { recipients?: string[]; subject?: string; enabled?: boolean },
    successMessage: string
  ): Promise<boolean> {
    setBusy(true);
    try {
      await authFetch(token, `/notifications/rules/${ruleId}`, { method: "PUT", body: JSON.stringify(payload) });
      toast.success(successMessage);
      await load();
      return true;
    } catch (updateError) {
      toast.error(errorText(updateError));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startEdit(rule: NotificationRule) {
    setEditingId(rule.id);
    setEditSubject(rule.subject);
    setEditRecipients(rule.recipients.join(", "));
  }

  async function saveEdit() {
    if (!editingId) {
      return;
    }
    const recipients = editRecipients
      .split(",")
      .map((recipient) => recipient.trim())
      .filter(Boolean);
    if (!editSubject.trim() || recipients.length === 0) {
      toast.error("La regla necesita asunto y al menos un destinatario.");
      return;
    }
    const saved = await updateRule(editingId, { subject: editSubject.trim(), recipients }, "Regla actualizada.");
    if (saved) {
      setEditingId(null);
    }
  }

  async function removeRule(rule: NotificationRule) {
    const eventLabel = NOTIFICATION_EVENT_LABELS[rule.eventType] ?? humanizeEnum(rule.eventType);
    const confirmed = await confirmDialog({
      title: "Eliminar regla",
      message: `Se dejará de enviar la copia por correo del evento "${eventLabel}".`,
      confirmLabel: "Eliminar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/notifications/rules/${rule.id}`, { method: "DELETE" });
      toast.success("Regla eliminada.");
      if (editingId === rule.id) {
        setEditingId(null);
      }
      await load();
    } catch (removeError) {
      toast.error(errorText(removeError));
    } finally {
      setBusy(false);
    }
  }

  async function process() {
    setBusy(true);
    try {
      const response = await authFetch<Record<string, unknown>>(token, "/notifications/process?limit=25", {
        method: "POST",
        body: "{}"
      });
      // El servidor devuelve los conteos anidados ({ result: { processed, sent,
      // failed } }); se desanida antes de leer, tolerando también la forma plana
      // y variantes de nombre. Con ello el toast informa el resultado real y, si
      // algo falló, la pista de revisión.
      const container = response && typeof response === "object" ? response : {};
      const nested = container.result;
      const payload = nested && typeof nested === "object" ? (nested as Record<string, unknown>) : container;
      const sent = readCount(payload, ["sent", "sentCount", "delivered"]);
      const failed = readCount(payload, ["failed", "failedCount", "errors"]);
      const processed = readCount(payload, ["processed", "processedCount", "total"]);
      if (failed != null && failed > 0) {
        toast.error(
          `Se enviaron ${sent ?? 0} correo${(sent ?? 0) === 1 ? "" : "s"} y fallaron ${failed}. Revisa la configuración de correo del servidor.`
        );
      } else if (sent != null && sent > 0) {
        toast.success(`Se enviaron ${sent} correo${sent === 1 ? "" : "s"}.`);
      } else if (processed != null && processed === 0) {
        toast.info("No había correos pendientes por procesar.");
      } else if (sent === 0) {
        toast.info("No se envió ningún correo nuevo.");
      } else {
        toast.success("Procesamiento completado.");
      }
      await load();
    } catch (processError) {
      toast.error(errorText(processError));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    try {
      const { requeued } = await authFetch<{ requeued: number }>(token, "/notifications/retry", { method: "POST", body: "{}" });
      if (requeued > 0) {
        await authFetch(token, "/notifications/process?limit=100", { method: "POST", body: "{}" });
        toast.success(`${requeued} correo${requeued === 1 ? "" : "s"} reencolado${requeued === 1 ? "" : "s"}.`);
      } else {
        toast.info("No hay correos fallidos por reintentar.");
      }
      await load();
    } catch (retryError) {
      toast.error(errorText(retryError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="data-section split-section ops-notifications">
      <form className="rule-form" onSubmit={createRule}>
        <h2>Regla de correo</h2>
        <label>
          Evento
          <select name="eventType" required defaultValue="QUIZ_PASSED">
            <option value="QUIZ_PASSED">Examen aprobado</option>
            <option value="QUIZ_FAILED">Examen reprobado</option>
            <option value="COURSE_COMPLETED">Curso completado</option>
            <option value="CERTIFICATE_ISSUED">Diploma emitido</option>
            <option value="ANNOUNCEMENT_PUBLISHED">Anuncio publicado</option>
          </select>
        </label>
        <label>
          Asunto
          <input name="subject" required />
        </label>
        <label>
          Destinatarios (copia a RH)
          <input name="recipients" placeholder="correo@tsc.com, otro@tsc.com" required />
        </label>
        <button className="primary-button" disabled={busy} type="submit">
          <Mail aria-hidden /> Guardar regla
        </button>
      </form>

      <div className="notification-panel">
        <div className="section-header">
          <h2>Correos</h2>
          <div className="quiz-actions">
            <button className="ghost-button" disabled={busy} onClick={() => void retry()} type="button">
              <RefreshCw aria-hidden /> Reintentar fallidos
            </button>
            <button className="secondary-button" disabled={busy} onClick={() => void process()} type="button">
              <RefreshCw aria-hidden /> Procesar pendientes
            </button>
          </div>
        </div>

        {error ? <p className="error-line">{error}</p> : null}

        <div className="rule-list">
          {rules.map((rule) => (
            <div className={`rule-row ops-rule-row${rule.enabled ? "" : " is-off"}`} key={rule.id}>
              <Bell aria-hidden />
              <div className="ops-rule-main">
                <div className="ops-rule-top">
                  <span>{NOTIFICATION_EVENT_LABELS[rule.eventType] ?? humanizeEnum(rule.eventType)}</span>
                  <span className={`status-pill ${rule.enabled ? "activo" : "disabled"}`}>
                    {rule.enabled ? "Activa" : "Inactiva"}
                  </span>
                </div>
                <small className="muted ops-rule-subject">Asunto: {rule.subject}</small>
                <small className="muted ops-rule-recipients">{rule.recipients.join(", ")}</small>
                {editingId === rule.id ? (
                  <div className="ops-rule-edit">
                    <label>
                      Asunto
                      <input value={editSubject} onChange={(event) => setEditSubject(event.target.value)} />
                    </label>
                    <label>
                      Destinatarios (separados por coma)
                      <input
                        value={editRecipients}
                        onChange={(event) => setEditRecipients(event.target.value)}
                        placeholder="correo@tsc.com, otro@tsc.com"
                      />
                    </label>
                    <div className="quiz-actions">
                      <button className="secondary-button" disabled={busy} onClick={() => void saveEdit()} type="button">
                        <Save aria-hidden /> Guardar
                      </button>
                      <button className="ghost-button" disabled={busy} onClick={() => setEditingId(null)} type="button">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="ops-rule-actions">
                {editingId === rule.id ? null : (
                  <button className="ghost-button" disabled={busy} onClick={() => startEdit(rule)} type="button">
                    Editar
                  </button>
                )}
                <button
                  className="ghost-button"
                  disabled={busy}
                  onClick={() =>
                    void updateRule(
                      rule.id,
                      { enabled: !rule.enabled },
                      rule.enabled ? "Regla desactivada." : "Regla activada."
                    )
                  }
                  type="button"
                >
                  {rule.enabled ? "Desactivar" : "Activar"}
                </button>
                <button
                  className="icon-button"
                  disabled={busy}
                  onClick={() => void removeRule(rule)}
                  title="Eliminar regla"
                  aria-label="Eliminar regla"
                  type="button"
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
            </div>
          ))}
          {rules.length === 0 ? <p className="empty-state">No hay reglas de copia a RH configuradas.</p> : null}
        </div>

        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>Evento</th>
                <th>Estado</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{NOTIFICATION_EVENT_LABELS[log.eventType] ?? humanizeEnum(log.eventType)}</td>
                  <td>
                    <span className={`status-pill ${(NOTIFICATION_STATUS_LABELS[log.status] ?? log.status).toLowerCase()}`}>
                      {NOTIFICATION_STATUS_LABELS[log.status] ?? humanizeEnum(log.status)}
                    </span>
                  </td>
                  <td>{new Date(log.createdAt).toLocaleString("es-MX")}</td>
                </tr>
              ))}
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    <p className="empty-state">Todavía no se ha generado ningún correo.</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ─── BITÁCORA: auditoría real de acciones admin ─────────────────────────────
type AuditEvent = {
  id: string;
  action: string;
  summary: string;
  targetType: string | null;
  actor: { displayName: string; email: string } | null;
  createdAt: string;
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  USER_CREATED: "Cuenta creada",
  USER_INVITED: "Invitación enviada",
  USER_INVITE_ACTIVATED: "Cuenta activada",
  USER_STATUS_CHANGED: "Estado de cuenta",
  USER_ROLE_GRANTED: "Rol asignado",
  USER_ROLE_REVOKED: "Rol retirado",
  USER_PASSWORD_RESET: "Contraseña restablecida",
  ENROLLMENT_GRANTED: "Inscripción",
  ENROLLMENT_REVOKED: "Acceso revocado",
  ENROLLMENT_BULK_UPDATED: "Ajuste masivo de acceso",
  ANNOUNCEMENT_PUBLISHED: "Anuncio publicado",
  NOTIFICATION_RULE_UPDATED: "Regla de correo actualizada",
  NOTIFICATION_RULE_DELETED: "Regla de correo eliminada",
  CERTIFICATE_ISSUED_BY_ADMIN: "Diploma emitido por administración",
  CERTIFICATE_REVOKED: "Diploma revocado"
};

function OpsAudit({ token }: { token: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await authFetch<{ events: AuditEvent[] }>(token, "/admin/audit");
      setEvents(data.events);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="data-section ops-audit">
      <div className="section-header">
        <div>
          <h2>Bitácora de auditoría</h2>
          <small className="muted">Registro real de las acciones administrativas de la plataforma.</small>
        </div>
        <button className="icon-button" disabled={busy} onClick={() => void load()} title="Actualizar" type="button">
          <RefreshCw aria-hidden />
        </button>
      </div>

      {error ? <p className="error-line">{error}</p> : null}

      {events.length === 0 && !busy ? (
        <p className="empty-state">
          No hay eventos registrados todavía. Las acciones administrativas (invitar, suspender, asignar roles, inscribir)
          se irán registrando aquí.
        </p>
      ) : (
        <ol className="ops-audit-list">
          {events.map((event) => (
            <li className="ops-audit-item" key={event.id}>
              <span className="ops-audit-dot" aria-hidden />
              <div className="ops-audit-body">
                <div className="ops-audit-top">
                  <span className="ops-audit-action mono-label">{AUDIT_ACTION_LABELS[event.action] ?? humanizeEnum(event.action)}</span>
                  <time className="ops-audit-time mono-label" dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
                  </time>
                </div>
                <p className="ops-audit-summary">{event.summary}</p>
                <small className="muted">
                  {event.actor ? `${event.actor.displayName} · ${event.actor.email}` : "Sistema"}
                </small>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
