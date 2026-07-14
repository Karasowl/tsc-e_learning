"use client";

/* ============================================================================
   CONSOLA DEL INSTRUCTOR (rol TEACHER puro).
   Cáscara de marca dark-first, SIN sidebar (ese patrón se reserva al admin).
   Envuelve la autoría real ya existente (CourseEditor / QuizBuilder) y surfacea
   las capacidades del backend: conteos reales (_count), versión del curso y el
   SELLO de evaluación (umbral congelado vs vivo). Datos reales, sin simulación.
   ============================================================================ */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  Eye,
  Layers,
  LayoutList,
  Lock,
  LogOut,
  Megaphone,
  Moon,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserRound,
  Users
} from "lucide-react";
import { authFetch, errorText } from "./apiClient";
import { CourseEditor, type CourseMeta } from "./authoring";
import { ProfileView } from "./panels";
import { ShieldMark } from "./guardApp";
import { confirmDialog, toast } from "./ui";

type User = {
  id: string;
  email: string;
  displayName: string;
  roles: Array<"ADMIN" | "TEACHER" | "STUDENT">;
};

type AdminCourse = {
  id: string;
  title: string;
  slug: string;
  status: string;
  version: number;
  teacher: { id: string; displayName: string } | null;
  _count: { modules: number; lessons: number; quizzes: number; enrollments: number };
};

type DetailQuiz = {
  id: string;
  title: string;
  timeLimitSec: number | null;
  passingScorePercent: number | null;
  maxAttempts: number | null;
  questionCount: number;
};

type DetailLesson = { id: string; title: string; kind: string; videoUrl: string | null };

type DetailModule = {
  id: string;
  title: string;
  position: number;
  lessons: DetailLesson[];
  quizzes: DetailQuiz[];
};

type CourseDetail = {
  id: string;
  title: string;
  slug: string;
  status: string;
  version: number;
  level: string | null;
  excerpt: string | null;
  description: string | null;
  modules: DetailModule[];
};

type ReportRow = {
  studentId: string;
  studentName: string;
  email: string;
  serviceLabel: string | null;
  courseId: string;
  courseTitle: string;
  progressPercent: number | null;
  status: string;
  finalQuiz: { id: string; title: string; passingScorePercent: number } | null;
  latestAttempt: {
    scorePercent: number | null;
    sealed: boolean;
    rulesVersion: number | null;
    passingScorePercent: number;
    sealedAt: string | null;
    seal: string | null;
  } | null;
};

type ConsoleTab = "estructura" | "reglas" | "resultados" | "vista" | "anuncios" | "ajustes";

const TABS: Array<{ key: ConsoleTab; label: string; Icon: typeof LayoutList }> = [
  { key: "estructura", label: "Estructura", Icon: LayoutList },
  { key: "reglas", label: "Reglas", Icon: SlidersHorizontal },
  { key: "resultados", label: "Resultados", Icon: BarChart3 },
  { key: "vista", label: "Vista previa", Icon: Eye },
  { key: "anuncios", label: "Anuncios", Icon: Megaphone },
  { key: "ajustes", label: "Ajustes", Icon: Settings }
];

function statusLabel(status: string): string {
  switch (status) {
    case "PUBLISHED":
      return "Publicado";
    case "ARCHIVED":
      return "Archivado";
    case "DRAFT":
    default:
      return "Borrador";
  }
}

function statusPillClass(status: string): string {
  switch (status) {
    case "PUBLISHED":
      return "pill pill--ok";
    case "ARCHIVED":
      return "pill";
    case "DRAFT":
    default:
      return "pill pill--watch";
  }
}

function lessonKindLabel(lesson: DetailLesson): string {
  if (lesson.videoUrl || lesson.kind === "VIDEO") {
    return "Video";
  }
  switch (lesson.kind?.toUpperCase()) {
    case "ASSIGNMENT":
      return "Tarea";
    case "QUIZ":
      return "Examen";
    default:
      return "Lección";
  }
}

export function TeacherConsole({
  token,
  user,
  theme,
  onToggleTheme,
  onLogout,
  onDisplayName
}: {
  token: string;
  user: User;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
  onDisplayName: (displayName: string) => void;
}) {
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [header, setHeader] = useState<CourseMeta | null>(null);
  const [tab, setTab] = useState<ConsoleTab>("estructura");
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const loadCourses = useCallback(async () => {
    setListBusy(true);
    setListError(null);
    try {
      const data = await authFetch<{ courses: AdminCourse[] }>(token, "/admin/courses");
      setCourses(data.courses);
    } catch (error) {
      setListError(errorText(error));
    } finally {
      setListBusy(false);
    }
  }, [token]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  const loadDetail = useCallback(
    async (courseId: string) => {
      setDetailError(null);
      try {
        const data = await authFetch<{ course: CourseDetail }>(token, `/courses/${courseId}`);
        setDetail(data.course);
        setHeader({ title: data.course.title, status: data.course.status, version: data.course.version });
      } catch (error) {
        setDetail(null);
        setDetailError(errorText(error));
      }
    },
    [token]
  );

  function openCourse(course: AdminCourse) {
    setSelectedId(course.id);
    setHeader({ title: course.title, status: course.status, version: course.version });
    setDetail(null);
    setTab("estructura");
    void loadDetail(course.id);
  }

  function backToList() {
    setSelectedId(null);
    setHeader(null);
    setDetail(null);
    void loadCourses();
  }

  async function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const title = String(new FormData(formEl).get("title") ?? "").trim();
    if (!title) {
      return;
    }
    setCreating(true);
    try {
      const data = await authFetch<{ course: { id: string; title?: string; status?: string; version?: number } }>(
        token,
        "/admin/courses",
        { method: "POST", body: JSON.stringify({ title }) }
      );
      formEl.reset();
      // Un curso nuevo nace como Borrador v1; el detalle real lo confirma al abrir.
      setSelectedId(data.course.id);
      setHeader({
        title: data.course.title ?? title,
        status: data.course.status ?? "DRAFT",
        version: data.course.version ?? 1
      });
      setDetail(null);
      setTab("estructura");
      void loadDetail(data.course.id);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setCreating(false);
    }
  }

  async function confirmPublish() {
    if (!selectedId) {
      return;
    }
    setPublishing(true);
    try {
      const data = await authFetch<{ course: { title: string; status: string; version: number } }>(
        token,
        `/admin/courses/${selectedId}`,
        { method: "PUT", body: JSON.stringify({ status: "PUBLISHED" }) }
      );
      setHeader({ title: data.course.title, status: data.course.status, version: data.course.version });
      setPublishOpen(false);
      toast.success(`Curso publicado (v${data.course.version}).`);
      await loadDetail(selectedId);
      void loadCourses();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setPublishing(false);
    }
  }

  async function deleteCourse() {
    if (!selectedId) {
      return;
    }
    const confirmed = await confirmDialog({
      title: "Eliminar curso",
      message: "Se eliminará el curso y todo su contenido. Esta acción no se puede deshacer.",
      confirmLabel: "Eliminar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    try {
      await authFetch(token, `/admin/courses/${selectedId}`, { method: "DELETE" });
      toast.success("Curso eliminado.");
      backToList();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  const onMeta = useCallback((meta: CourseMeta) => setHeader(meta), []);
  const status = header?.status ?? "DRAFT";
  const canPublish = Boolean(selectedId) && status !== "PUBLISHED";

  return (
    <main className="tconsole-shell">
      <header className="tconsole-topbar">
        <div className="tconsole-topbar-lead">
          <div className="tconsole-brand">
            <ShieldMark size={30} />
            <span className="tconsole-wordmark">CAPACITA</span>
          </div>
          <nav className="tconsole-crumbs" aria-label="Ruta">
            <button
              type="button"
              className={`tconsole-crumb${selectedId ? " is-link" : " is-current"}`}
              onClick={selectedId ? backToList : undefined}
              disabled={!selectedId}
            >
              Mis cursos
            </button>
            {header ? (
              <>
                <ChevronRight className="tconsole-crumb-sep" aria-hidden />
                <span className="tconsole-crumb is-current" title={header.title}>
                  {header.title}
                </span>
              </>
            ) : null}
          </nav>
        </div>

        <div className="tconsole-topbar-actions">
          {selectedId && header ? (
            <>
              <span className={statusPillClass(status)}>{statusLabel(status)}</span>
              <span className="pill tconsole-version" title={`Versión ${header.version}`}>
                v{header.version}
              </span>
              {canPublish ? (
                <button className="btn btn--brand tconsole-publish" type="button" onClick={() => setPublishOpen(true)}>
                  <Rocket aria-hidden /> Publicar
                </button>
              ) : (
                <span className="tconsole-published-note mono-label">
                  <Check aria-hidden /> En vivo
                </span>
              )}
            </>
          ) : null}

          <button
            className="icon-button tconsole-theme"
            onClick={onToggleTheme}
            type="button"
            aria-label="Cambiar tema"
            title="Cambiar tema"
          >
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
              <span className="avatar" aria-hidden>
                {initials(user.displayName)}
              </span>
              <span>{user.displayName}</span>
            </button>
            {menuOpen ? (
              <>
                <button className="menu-backdrop" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} type="button" />
                <div className="profile-menu" role="menu">
                  <div className="profile-menu-head">
                    <span className="avatar lg" aria-hidden>
                      {initials(user.displayName)}
                    </span>
                    <div>
                      <strong>{user.displayName}</strong>
                      <small>{user.email}</small>
                    </div>
                  </div>
                  <p className="profile-roles">Instructor</p>
                  <button
                    className="ghost-button profile-link"
                    onClick={() => {
                      setProfileOpen(true);
                      setMenuOpen(false);
                    }}
                    type="button"
                  >
                    <UserRound aria-hidden /> Mi perfil
                  </button>
                  <button className="ghost-button profile-logout" onClick={onLogout} type="button">
                    <LogOut aria-hidden /> Salir
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      {selectedId ? (
        <nav className="tconsole-tabs" aria-label="Secciones del curso">
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className={`tconsole-tab${tab === key ? " active" : ""}`}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => setTab(key)}
            >
              <Icon aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      ) : null}

      <div className="tconsole-scroll">
        {selectedId ? (
          <>
            {tab === "estructura" ? (
              <CourseEditor
                token={token}
                courseId={selectedId}
                isAdmin={false}
                onBack={backToList}
                embedded
                section="content"
                onMeta={onMeta}
              />
            ) : null}
            {tab === "reglas" ? <ReglasTab token={token} detail={detail} error={detailError} onSaved={() => loadDetail(selectedId)} /> : null}
            {tab === "resultados" ? <ResultadosTab token={token} courseId={selectedId} /> : null}
            {tab === "vista" ? <VistaPreviaTab detail={detail} error={detailError} /> : null}
            {tab === "anuncios" ? <AnunciosTab /> : null}
            {tab === "ajustes" ? (
              <div className="tconsole-ajustes">
                <div className="tconsole-block-head">
                  <Users aria-hidden />
                  <h3>Acceso de colaboradores</h3>
                </div>
                <CourseEditor
                  token={token}
                  courseId={selectedId}
                  isAdmin={false}
                  onBack={backToList}
                  embedded
                  section="students"
                  onMeta={onMeta}
                />
                <div className="tconsole-danger card">
                  <div className="tconsole-block-head">
                    <AlertTriangle aria-hidden />
                    <h3>Zona de peligro</h3>
                  </div>
                  <p className="muted">Eliminar el curso borra su temario, exámenes e inscripciones. No se puede deshacer.</p>
                  <button className="btn btn--ghost tconsole-danger-btn" type="button" onClick={() => void deleteCourse()}>
                    <Trash2 aria-hidden /> Eliminar curso
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <CourseList
            courses={courses}
            busy={listBusy}
            error={listError}
            creating={creating}
            onCreate={createCourse}
            onOpen={openCourse}
            onRefresh={() => void loadCourses()}
          />
        )}
      </div>

      {publishOpen && header ? (
        <PublishModal
          version={header.version}
          busy={publishing}
          onCancel={() => setPublishOpen(false)}
          onConfirm={() => void confirmPublish()}
        />
      ) : null}

      {profileOpen ? (
        <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && setProfileOpen(false)}>
          <div className="modal-panel wide tconsole-profile-modal" role="dialog" aria-modal="true" aria-label="Mi perfil">
            <div className="modal-head">
              <h3>Mi perfil</h3>
              <button className="icon-button" onClick={() => setProfileOpen(false)} title="Cerrar" type="button">
                <ArrowLeft aria-hidden />
              </button>
            </div>
            <div className="modal-body">
              <ProfileView token={token} onProfileUpdated={onDisplayName} />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

// ─── Lista de cursos (tarjetas de marca con conteos reales + versión + estado) ──
function CourseList({
  courses,
  busy,
  error,
  creating,
  onCreate,
  onOpen,
  onRefresh
}: {
  courses: AdminCourse[];
  busy: boolean;
  error: string | null;
  creating: boolean;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onOpen: (course: AdminCourse) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="tconsole-list">
      <div className="tconsole-list-head">
        <div>
          <p className="eyebrow">Consola del instructor</p>
          <h1 className="tconsole-title">Mis cursos</h1>
        </div>
        <button className="icon-button" disabled={busy} onClick={onRefresh} title="Actualizar" type="button">
          <RefreshCw aria-hidden />
        </button>
      </div>

      <form className="tconsole-create" onSubmit={onCreate}>
        <div className="tconsole-create-field">
          <Plus aria-hidden />
          <input name="title" placeholder="Título del curso nuevo" required aria-label="Título del curso nuevo" />
        </div>
        <button className="btn btn--brand" disabled={creating} type="submit">
          Crear curso
        </button>
      </form>

      {error ? <p className="error-line">{error}</p> : null}

      {busy && courses.length === 0 ? (
        <p className="empty-state">Cargando tus cursos…</p>
      ) : courses.length === 0 ? (
        <p className="empty-state">Aún no tienes cursos. Crea el primero arriba.</p>
      ) : (
        <div className="tconsole-cards">
          {courses.map((course) => (
            <button key={course.id} type="button" className="tconsole-card card" onClick={() => onOpen(course)}>
              <div className="tconsole-card-top">
                <span className={statusPillClass(course.status)}>{statusLabel(course.status)}</span>
                <span className="pill tconsole-version">v{course.version}</span>
              </div>
              <strong className="tconsole-card-title">{course.title}</strong>
              <div className="tconsole-card-counts">
                <span className="mono-label">
                  <Layers aria-hidden /> {course._count.modules} secciones
                </span>
                <span className="mono-label">
                  <BookOpen aria-hidden /> {course._count.lessons} clases
                </span>
                <span className="mono-label">
                  <SlidersHorizontal aria-hidden /> {course._count.quizzes} exámenes
                </span>
                <span className="mono-label">
                  <Users aria-hidden /> {course._count.enrollments} inscritos
                </span>
              </div>
              <span className="tconsole-card-go mono-label">
                Abrir <ChevronRight aria-hidden />
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Modal de publicación (refleja el salto de versión vN a vN+1) ───────────────
function PublishModal({
  version,
  busy,
  onCancel,
  onConfirm
}: {
  version: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal-panel confirm-panel tconsole-publish-modal" role="alertdialog" aria-modal="true" aria-label="Publicar curso">
        <div className="confirm-body">
          <div className="tconsole-publish-icon">
            <Rocket aria-hidden />
          </div>
          <h3>Publicar curso</h3>
          <p className="muted">
            Publicar corta una nueva versión inmutable del curso. La versión sube y los intentos que los colaboradores ya
            iniciaron conservan el sello de su versión anterior.
          </p>
          <div className="tconsole-version-jump">
            <span className="pill tconsole-version">v{version}</span>
            <ChevronRight aria-hidden />
            <span className="pill tconsole-version tconsole-version-next">v{version + 1}</span>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn--brand" onClick={onConfirm} disabled={busy}>
            <Rocket aria-hidden /> {busy ? "Publicando…" : `Publicar v${version + 1}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reglas: umbral de aprobación / tiempo / intentos por examen (umbral VIVO) ──
function ReglasTab({
  token,
  detail,
  error,
  onSaved
}: {
  token: string;
  detail: CourseDetail | null;
  error: string | null;
  onSaved: () => void;
}) {
  const quizzes = useMemo(() => (detail ? detail.modules.flatMap((module) => module.quizzes) : []), [detail]);

  if (error) {
    return <p className="error-line">{error}</p>;
  }
  if (!detail) {
    return <p className="empty-state">Cargando exámenes…</p>;
  }
  if (quizzes.length === 0) {
    return (
      <section className="data-section">
        <p className="empty-state">Este curso aún no tiene exámenes. Agrégalos desde la pestaña Estructura.</p>
      </section>
    );
  }
  return (
    <section className="tconsole-reglas">
      <div className="tconsole-block-head">
        <SlidersHorizontal aria-hidden />
        <h3>Reglas de evaluación</h3>
      </div>
      <p className="muted tconsole-reglas-note">
        El umbral vigente (vivo) decide a partir de ahora. Los intentos ya sellados se siguen calificando con su umbral
        congelado (ver pestaña Resultados).
      </p>
      <div className="tconsole-reglas-grid">
        {quizzes.map((quiz) => (
          <QuizRuleCard key={quiz.id} token={token} quiz={quiz} onSaved={onSaved} />
        ))}
      </div>
    </section>
  );
}

function QuizRuleCard({ token, quiz, onSaved }: { token: string; quiz: DetailQuiz; onSaved: () => void }) {
  const [passing, setPassing] = useState<string>(quiz.passingScorePercent != null ? String(quiz.passingScorePercent) : "");
  const [minutes, setMinutes] = useState<string>(quiz.timeLimitSec ? String(Math.round(quiz.timeLimitSec / 60)) : "");
  const [attempts, setAttempts] = useState<string>(quiz.maxAttempts != null ? String(quiz.maxAttempts) : "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await authFetch(token, `/admin/quizzes/${quiz.id}`, {
        method: "PUT",
        body: JSON.stringify({
          passingScorePercent: passing ? Number(passing) : null,
          timeLimitSec: minutes ? Number(minutes) * 60 : null,
          maxAttempts: attempts ? Number(attempts) : null
        })
      });
      toast.success("Reglas del examen guardadas.");
      onSaved();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tconsole-rule card">
      <div className="tconsole-rule-head">
        <strong>{quiz.title}</strong>
        <span className="mono-label">{quiz.questionCount} preguntas</span>
      </div>
      <div className="tconsole-rule-fields">
        <label>
          % para aprobar (vivo)
          <input
            type="number"
            min={0}
            max={100}
            value={passing}
            onChange={(event) => setPassing(event.target.value)}
            placeholder="80"
          />
        </label>
        <label>
          Tiempo límite (min)
          <input
            type="number"
            min={0}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            placeholder="sin límite"
          />
        </label>
        <label>
          Intentos
          <input
            type="number"
            min={1}
            value={attempts}
            onChange={(event) => setAttempts(event.target.value)}
            placeholder="ilimitado"
          />
        </label>
      </div>
      <button className="btn btn--dark tconsole-rule-save" type="button" disabled={busy} onClick={() => void save()}>
        <Save aria-hidden /> Guardar reglas
      </button>
    </div>
  );
}

// ─── Resultados: reporte del curso con el SELLO (umbral congelado vs vivo) ───────
function ResultadosTab({ token, courseId }: { token: string; courseId: string }) {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await authFetch<{ rows: ReportRow[] }>(token, "/reports/students");
      setRows(data.rows.filter((row) => row.courseId === courseId));
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setBusy(false);
    }
  }, [token, courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const anySealed = rows.some((row) => row.latestAttempt?.sealed);

  return (
    <section className="tconsole-resultados">
      <div className="tconsole-block-head">
        <BarChart3 aria-hidden />
        <h3>Resultados con sello</h3>
        <button className="icon-button" disabled={busy} onClick={() => void load()} title="Actualizar" type="button">
          <RefreshCw aria-hidden />
        </button>
      </div>
      <p className="muted tconsole-reglas-note">
        Cada intento se califica con el umbral congelado al momento de presentarlo (su sello). Si editas el umbral vivo,
        aquí verás la diferencia, pero el veredicto sellado no cambia.
      </p>

      {error ? <p className="error-line">{error}</p> : null}

      {busy && rows.length === 0 ? (
        <p className="empty-state">Cargando resultados…</p>
      ) : rows.length === 0 ? (
        <p className="empty-state">Todavía no hay colaboradores con acceso a este curso publicado.</p>
      ) : (
        <div className="table-wrap">
          <table className="tconsole-report">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Servicio</th>
                <th>Avance</th>
                <th>Resultado</th>
                <th>Puntaje</th>
                <th>Umbral</th>
                <th>Sello</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const attempt = row.latestAttempt;
                const live = row.finalQuiz?.passingScorePercent ?? null;
                const frozen = attempt?.passingScorePercent ?? null;
                const drifted = Boolean(attempt?.sealed && live != null && frozen != null && frozen !== live);
                return (
                  <tr key={`${row.studentId}-${row.courseId}`}>
                    <td>
                      <strong>{row.studentName}</strong>
                      <small>{row.email}</small>
                    </td>
                    <td>{row.serviceLabel ?? "Sin servicio"}</td>
                    <td>{Math.round(row.progressPercent ?? 0)}%</td>
                    <td>
                      <span className={`status-pill ${row.status.toLowerCase().replaceAll(" ", "-")}`}>{row.status}</span>
                    </td>
                    <td>{attempt?.scorePercent != null ? `${Math.round(attempt.scorePercent)}%` : "N/D"}</td>
                    <td>
                      {frozen != null ? (
                        <div className="tconsole-threshold">
                          <span className="tconsole-threshold-main">{frozen}%</span>
                          <span className="mono-label">{attempt?.sealed ? "sellado" : "vivo"}</span>
                          {drifted ? (
                            <span className="tconsole-drift" title={`Sellado ${frozen}% · umbral vivo ${live}%`}>
                              <AlertTriangle aria-hidden /> vivo {live}%
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        "N/D"
                      )}
                    </td>
                    <td>
                      {!attempt ? (
                        <span className="mono-label">Sin intento</span>
                      ) : attempt.sealed ? (
                        <span className="tconsole-seal" title={attempt.sealedAt ? `Sellado ${new Date(attempt.sealedAt).toLocaleString("es-MX")}` : "Sellado"}>
                          <Lock aria-hidden />
                          <span className="tconsole-seal-tag mono">{attempt.seal}</span>
                          {attempt.rulesVersion != null ? <span className="mono-label">v{attempt.rulesVersion}</span> : null}
                        </span>
                      ) : (
                        <span className="tconsole-unsealed mono-label">Sin sellar</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!anySealed && rows.length > 0 ? (
        <p className="muted tconsole-seal-hint">
          <ShieldCheck aria-hidden /> Los intentos presentados antes de activar el sello aparecen como Sin sellar y se
          califican con el umbral vivo.
        </p>
      ) : null}
    </section>
  );
}

// ─── Vista previa: temario tal como lo ve un colaborador (solo lectura) ─────────
function VistaPreviaTab({ detail, error }: { detail: CourseDetail | null; error: string | null }) {
  if (error) {
    return <p className="error-line">{error}</p>;
  }
  if (!detail) {
    return <p className="empty-state">Cargando vista previa…</p>;
  }
  return (
    <section className="tconsole-preview">
      <div className="tconsole-preview-banner">
        <Eye aria-hidden /> Vista previa. Así ve un colaborador el temario de este curso.
      </div>
      <div className="tconsole-preview-hero">
        {detail.level ? <span className="course-level-chip">Nivel {detail.level}</span> : null}
        <h2>{detail.title}</h2>
        {detail.excerpt ? <p className="lead">{detail.excerpt}</p> : null}
      </div>
      {detail.modules.length === 0 ? (
        <p className="empty-state">Este curso todavía no tiene contenido.</p>
      ) : (
        <div className="tconsole-preview-modules">
          {detail.modules.map((module) => (
            <div className="tconsole-preview-module card" key={module.id}>
              <h3>{module.title}</h3>
              {module.lessons.length === 0 && module.quizzes.length === 0 ? (
                <p className="empty-state">Sección vacía.</p>
              ) : (
                <ul className="tconsole-preview-list">
                  {module.lessons.map((lesson) => (
                    <li key={lesson.id}>
                      <BookOpen aria-hidden />
                      <span>{lesson.title}</span>
                      <span className="mono-label">{lessonKindLabel(lesson)}</span>
                    </li>
                  ))}
                  {module.quizzes.map((quiz) => (
                    <li key={quiz.id} className="tconsole-preview-quiz">
                      <SlidersHorizontal aria-hidden />
                      <span>{quiz.title}</span>
                      <span className="mono-label">
                        <Clock aria-hidden />
                        {quiz.timeLimitSec ? `${Math.round(quiz.timeLimitSec / 60)} min` : "sin límite"}
                        {quiz.passingScorePercent != null ? ` · ${quiz.passingScorePercent}%` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Anuncios: honesto placeholder (aún no hay backend de anuncios por curso) ────
function AnunciosTab() {
  return (
    <section className="tconsole-soon">
      <div className="tconsole-soon-card card">
        <span className="tconsole-soon-icon">
          <Bell aria-hidden />
        </span>
        <p className="eyebrow">En construcción</p>
        <h3>Anuncios del curso</h3>
        <p className="muted">
          Todavía no puedes publicar anuncios del curso desde aquí. Cuando esté disponible, tus colaboradores verán tus
          avisos al abrir el curso. No hay datos que mostrar aún.
        </p>
      </div>
    </section>
  );
}

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
