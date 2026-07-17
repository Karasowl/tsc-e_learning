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
  Award,
  BarChart3,
  Bell,
  Boxes,
  Check,
  ClipboardList,
  Clock,
  Contact,
  Download,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Moon,
  RefreshCw,
  ScrollText,
  Search,
  Send,
  Sun,
  Trash2,
  Users,
  X
} from "lucide-react";
import { API_URL, authFetch, errorText } from "./apiClient";
import { AuthoringView } from "./authoring";
import { ShieldMark } from "./guardApp";
import { TeachersDirectory } from "./panels";
import { buildReportPrintHtml } from "./reportPrint";
import { toast } from "./ui";
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
  const response = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${token}` } });
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
            <button
              className="icon-button ops-bell"
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

function OpsDashboard({ token, onNavigate }: { token: string; onNavigate: (view: OpsView) => void }) {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setBusy(true);
        setError(null);
      }
      try {
        const data = await authFetch<{ kpis: Kpis; activity: ActivityItem[] }>(token, "/admin/overview");
        setKpis(data.kpis);
        setActivity(data.activity);
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
    </section>
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

function OpsEnrollments({ token }: { token: string }) {
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
      await downloadWithAuth(token, "/reports/students/export.xlsx", `reporte-colaboradores-${new Date().toISOString().slice(0, 10)}.xlsx`);
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
    printWindow.document.write(buildReportPrintHtml(rows, summary));
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

// ─── DIPLOMAS: diplomas emitidos reales (ver / descargar) ───────────────────
type Certificate = {
  id: string;
  folio: string;
  issuedAt: string;
  user: { displayName: string; email: string };
  course: { title: string };
};

function OpsDiplomas({ token }: { token: string }) {
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const response = await fetch(`${API_URL}/certificates/${id}/html`, { headers: { authorization: `Bearer ${token}` } });
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

  return (
    <section className="data-section ops-diplomas">
      <div className="section-header">
        <h2>Diplomas emitidos</h2>
        <button className="icon-button" disabled={busy} onClick={() => void load()} title="Actualizar" type="button">
          <RefreshCw aria-hidden />
        </button>
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
                <small>{new Date(cert.issuedAt).toLocaleDateString("es-MX")}</small>
              </div>
              <div className="tile-actions">
                <button className="icon-button" onClick={() => void view(cert.id)} title="Ver diploma" type="button">
                  <FileText aria-hidden />
                </button>
                <button className="icon-button" onClick={() => void download(cert.id, cert.folio)} title="Descargar PDF" type="button">
                  <Download aria-hidden />
                </button>
              </div>
            </article>
          ))}
        </div>
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
  CERTIFICATE_ISSUED: "Diploma emitido"
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

function OpsNotifications({ token }: { token: string }) {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function process() {
    setBusy(true);
    try {
      await authFetch(token, "/notifications/process?limit=25", { method: "POST", body: "{}" });
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
            <div className="rule-row" key={rule.id}>
              <Bell aria-hidden />
              <span>{NOTIFICATION_EVENT_LABELS[rule.eventType] ?? humanizeEnum(rule.eventType)}</span>
              <small>{rule.recipients.join(", ")}</small>
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
  ENROLLMENT_REVOKED: "Acceso revocado"
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
