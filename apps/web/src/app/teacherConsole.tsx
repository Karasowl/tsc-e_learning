"use client";

/* ============================================================================
   CONSOLA DEL INSTRUCTOR (rol TEACHER puro).
   Cáscara de marca dark-first, SIN sidebar (ese patrón se reserva al admin).
   Envuelve la autoría real ya existente (CourseEditor / QuizBuilder) y surfacea
   las capacidades del backend: conteos reales (_count), versión del curso y el
   SELLO de evaluación (umbral congelado vs vivo). Datos reales, sin simulación.
   ============================================================================ */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  BarChart3,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  GitBranch,
  Layers,
  LayoutList,
  Lock,
  LogOut,
  Megaphone,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  Users,
  Video,
  X
} from "lucide-react";
import { API_URL, authFetch, errorText } from "./apiClient";
import { CourseEditor, type CourseMeta } from "./authoring";
import { ProfileView } from "./panels";
import { ShieldMark } from "./guardApp";
import { Modal, Wizard, confirmDialog, toast, type WizardStep } from "./ui";

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
  questionsOrder: string | null;
  questionCount: number;
};

type DetailLesson = {
  id: string;
  title: string;
  kind: string;
  videoUrl: string | null;
  videoProvider?: string | null;
  videoEmbed?: string | null;
  body?: string | null;
  durationSec?: number | null;
};

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

type NewCourseInput = {
  title: string;
  excerpt: string;
  description: string;
  level: string;
  serviceLine: string;
  moduleTitles: string[];
};

type CertificateTemplate = {
  id: string;
  name: string;
  body: { title?: string; legend?: string; backgroundUrl?: string } & Record<string, unknown>;
  courseIds: string[];
};

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
  const [newCourseOpen, setNewCourseOpen] = useState(false);

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

  async function createCourseFromWizard(input: NewCourseInput) {
    const title = input.title.trim();
    if (!title) {
      return;
    }
    setCreating(true);
    try {
      // No hay campo dedicado de "línea de servicio" en el curso todavía: se conserva
      // como primera línea de la descripción para no perder la elección del asistente.
      const descriptionParts: string[] = [];
      if (input.serviceLine.trim()) {
        descriptionParts.push(`Línea de servicio: ${input.serviceLine.trim()}`);
      }
      if (input.description.trim()) {
        descriptionParts.push(input.description.trim());
      }
      const body: Record<string, unknown> = { title };
      if (input.excerpt.trim()) {
        body.excerpt = input.excerpt.trim();
      }
      if (input.level.trim()) {
        body.level = input.level.trim();
      }
      if (descriptionParts.length > 0) {
        body.description = descriptionParts.join("\n\n");
      }
      const data = await authFetch<{ course: { id: string; title?: string; status?: string; version?: number } }>(
        token,
        "/admin/courses",
        { method: "POST", body: JSON.stringify(body) }
      );
      const courseId = data.course.id;
      // Plantilla de estructura: crea las secciones iniciales salvo "En blanco".
      if (input.moduleTitles.length > 0) {
        for (const moduleTitle of input.moduleTitles) {
          await authFetch(token, `/admin/courses/${courseId}/modules`, {
            method: "POST",
            body: JSON.stringify({ title: moduleTitle })
          });
        }
      }
      setNewCourseOpen(false);
      setSelectedId(courseId);
      setHeader({
        title: data.course.title ?? title,
        status: data.course.status ?? "DRAFT",
        version: data.course.version ?? 1
      });
      setDetail(null);
      setTab("estructura");
      toast.success("Curso creado.");
      void loadDetail(courseId);
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
            {tab === "vista" ? <VistaPreviaTab token={token} detail={detail} error={detailError} /> : null}
            {tab === "anuncios" ? <AnunciosTab token={token} courseId={selectedId} /> : null}
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

                <PrerequisitesBlock token={token} courseId={selectedId} />

                <CertificateBlock token={token} courseId={selectedId} />

                <div className="tconsole-soon-inline card">
                  <div className="tconsole-block-head">
                    <Clock aria-hidden />
                    <h3>Liberación por goteo</h3>
                    <span className="pill tconsole-soon-pill">Próximamente</span>
                  </div>
                  <p className="muted">
                    Programar la apertura escalonada de secciones llegará pronto. Por ahora, el contenido publicado está
                    disponible desde el primer día.
                  </p>
                </div>

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
            onNew={() => setNewCourseOpen(true)}
            onOpen={openCourse}
            onRefresh={() => void loadCourses()}
          />
        )}
      </div>

      {newCourseOpen ? (
        <NewCourseWizard busy={creating} onCancel={() => setNewCourseOpen(false)} onFinish={createCourseFromWizard} />
      ) : null}

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
  onNew,
  onOpen,
  onRefresh
}: {
  courses: AdminCourse[];
  busy: boolean;
  error: string | null;
  onNew: () => void;
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
        <div className="tconsole-list-actions">
          <button className="icon-button" disabled={busy} onClick={onRefresh} title="Actualizar" type="button">
            <RefreshCw aria-hidden />
          </button>
          <button className="btn btn--brand" onClick={onNew} type="button">
            <Plus aria-hidden /> Nuevo curso
          </button>
        </div>
      </div>

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

// ─── Asistente Nuevo curso (3 pasos) sobre la primitiva Wizard ──────────────────
const SERVICE_LINES = ["Protección ejecutiva", "Custodia de mercancía", "Seguridad intramuros"];
const LEVELS = ["Básico", "Intermedio", "Avanzado"];
const COURSE_TEMPLATES: Array<{ id: string; name: string; description: string; modules: string[] }> = [
  {
    id: "basico",
    name: "Básico",
    description: "Dos secciones para arrancar: Fundamentos y Práctica y evaluación.",
    modules: ["Fundamentos", "Práctica y evaluación"]
  },
  {
    id: "blanco",
    name: "En blanco",
    description: "Empieza sin secciones y arma la estructura a tu ritmo.",
    modules: []
  }
];

function NewCourseWizard({
  busy,
  onCancel,
  onFinish
}: {
  busy: boolean;
  onCancel: () => void;
  onFinish: (input: NewCourseInput) => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [level, setLevel] = useState("");
  const [serviceLine, setServiceLine] = useState("");
  const [templateId, setTemplateId] = useState("basico");

  const steps: WizardStep[] = [
    {
      key: "datos",
      title: "Datos base",
      validate: () => (title.trim() ? null : "Escribe el título del curso."),
      render: () => (
        <div className="wizard-field-grid">
          <label className="wizard-field">
            Título del curso
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="p. ej. Protección de dignatarios" />
          </label>
          <label className="wizard-field">
            Resumen (descripción corta)
            <textarea rows={3} value={excerpt} onChange={(event) => setExcerpt(event.target.value)} placeholder="Una o dos frases para el catálogo." />
          </label>
          <div className="wizard-field">
            <span>Nivel</span>
            <div className="wizard-chips">
              {LEVELS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`wizard-chip${level === option ? " is-active" : ""}`}
                  onClick={() => setLevel(level === option ? "" : option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <input
              className="wizard-chip-custom"
              value={LEVELS.includes(level) ? "" : level}
              onChange={(event) => setLevel(event.target.value)}
              placeholder="u otro nivel"
              aria-label="Otro nivel"
            />
          </div>
        </div>
      )
    },
    {
      key: "servicio",
      title: "Línea de servicio",
      render: () => (
        <div className="wizard-field-grid">
          <p className="muted">¿Para qué servicio entrena este curso? Elige una línea o escribe la tuya.</p>
          <div className="wizard-chips">
            {SERVICE_LINES.map((option) => (
              <button
                key={option}
                type="button"
                className={`wizard-chip${serviceLine === option ? " is-active" : ""}`}
                onClick={() => setServiceLine(option)}
              >
                <Sparkles aria-hidden /> {option}
              </button>
            ))}
          </div>
          <label className="wizard-field">
            Línea de servicio
            <input
              value={serviceLine}
              onChange={(event) => setServiceLine(event.target.value)}
              placeholder="Escribe una línea propia"
            />
          </label>
        </div>
      )
    },
    {
      key: "estructura",
      title: "Estructura",
      render: () => (
        <div className="wizard-field-grid">
          <p className="muted">Elige una plantilla de estructura. Podrás editar todo después.</p>
          <div className="wizard-templates">
            {COURSE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`wizard-template-card${templateId === template.id ? " is-active" : ""}`}
                onClick={() => setTemplateId(template.id)}
                aria-pressed={templateId === template.id}
              >
                <span className="wizard-template-check">{templateId === template.id ? <Check aria-hidden /> : null}</span>
                <strong>{template.name}</strong>
                <span className="muted">{template.description}</span>
                {template.modules.length > 0 ? (
                  <span className="wizard-template-modules">
                    {template.modules.map((moduleTitle) => (
                      <span className="mono-label" key={moduleTitle}>
                        <Layers aria-hidden /> {moduleTitle}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      )
    }
  ];

  function finish() {
    const template = COURSE_TEMPLATES.find((entry) => entry.id === templateId);
    void onFinish({
      title,
      excerpt,
      description: "",
      level,
      serviceLine,
      moduleTitles: template?.modules ?? []
    });
  }

  return (
    <Wizard title="Nuevo curso" steps={steps} onFinish={finish} onCancel={onCancel} finishLabel="Crear curso" busy={busy} />
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
            Publicar activa el curso y sube su versión. El temario puede seguir editándose. Cada intento se sella con el umbral
            vigente al presentarlo, y los intentos ya iniciados por los colaboradores conservan el sello de su versión anterior.
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
  const [randomize, setRandomize] = useState<boolean>(quiz.questionsOrder === "rand");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await authFetch(token, `/admin/quizzes/${quiz.id}`, {
        method: "PUT",
        body: JSON.stringify({
          passingScorePercent: passing ? Number(passing) : null,
          timeLimitSec: minutes ? Number(minutes) * 60 : null,
          maxAttempts: attempts ? Number(attempts) : null,
          questionsOrder: randomize ? "rand" : null
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
      <label className="inline-radio tconsole-rule-random">
        <input type="checkbox" checked={randomize} onChange={(event) => setRandomize(event.target.checked)} />
        <span>Aleatorizar preguntas</span>
      </label>
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
      // Pasamos el courseId al servidor: el reporte del dueño incluye su curso
      // aunque siga en borrador. Sin filtro en cliente.
      const params = new URLSearchParams({ courseId });
      const data = await authFetch<{ rows: ReportRow[] }>(token, `/reports/students?${params.toString()}`);
      setRows(data.rows);
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

// ─── Prerrequisitos: cursos que deben completarse antes de este (grafo simple) ──
type Prerequisite = { id: string; requiresId: string; requiresTitle: string };

function PrerequisitesBlock({ token, courseId }: { token: string; courseId: string }) {
  const [prereqs, setPrereqs] = useState<Prerequisite[]>([]);
  const [catalog, setCatalog] = useState<AdminCourse[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [prereqData, catalogData] = await Promise.all([
        authFetch<{ prerequisites: Prerequisite[] }>(token, `/admin/courses/${courseId}/prerequisites`),
        authFetch<{ courses: AdminCourse[] }>(token, "/admin/courses")
      ]);
      setPrereqs(prereqData.prerequisites);
      setCatalog(catalogData.courses);
    } catch (loadError) {
      setError(errorText(loadError));
    }
  }, [token, courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const options = catalog.filter(
    (course) => course.id !== courseId && !prereqs.some((prereq) => prereq.requiresId === course.id)
  );

  async function add() {
    if (!selected) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${courseId}/prerequisites`, {
        method: "POST",
        body: JSON.stringify({ requiresId: selected })
      });
      setSelected("");
      toast.success("Prerrequisito agregado.");
      await load();
    } catch (addError) {
      // Un ciclo (A→B→A) o el auto-prerrequisito llegan como 400 con mensaje claro.
      toast.error(errorText(addError));
    } finally {
      setBusy(false);
    }
  }

  async function remove(requiresId: string) {
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${courseId}/prerequisites/${requiresId}`, { method: "DELETE" });
      setPrereqs((current) => current.filter((prereq) => prereq.requiresId !== requiresId));
      toast.success("Prerrequisito quitado.");
    } catch (removeError) {
      toast.error(errorText(removeError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tconsole-settings-block card">
      <div className="tconsole-block-head">
        <GitBranch aria-hidden />
        <h3>Prerrequisitos</h3>
      </div>
      <p className="muted">Cursos que un colaborador debe completar antes de entrar a este.</p>
      {error ? <p className="error-line">{error}</p> : null}
      {prereqs.length === 0 ? (
        <p className="empty-state">Sin prerrequisitos. Este curso está disponible sin cursos previos.</p>
      ) : (
        <ul className="tconsole-chip-list">
          {prereqs.map((prereq) => (
            <li className="tconsole-req-chip" key={prereq.id}>
              <BookOpen aria-hidden />
              <span>{prereq.requiresTitle}</span>
              <button
                className="icon-button"
                type="button"
                disabled={busy}
                onClick={() => void remove(prereq.requiresId)}
                title="Quitar prerrequisito"
                aria-label={`Quitar ${prereq.requiresTitle}`}
              >
                <X aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="tconsole-inline-form">
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          aria-label="Curso prerrequisito"
          disabled={options.length === 0}
        >
          <option value="">{options.length === 0 ? "No hay más cursos disponibles" : "Elige un curso…"}</option>
          {options.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title}
            </option>
          ))}
        </select>
        <button className="btn btn--dark" type="button" disabled={busy || !selected} onClick={() => void add()}>
          <Plus aria-hidden /> Agregar
        </button>
      </div>
    </div>
  );
}

// ─── Certificado del curso: vincular/quitar plantilla + acceso al diseñador ─────
function CertificateBlock({ token, courseId }: { token: string; courseId: string }) {
  const [templates, setTemplates] = useState<CertificateTemplate[]>([]);
  const [restricted, setRestricted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [designerOpen, setDesignerOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await authFetch<{ templates: CertificateTemplate[] }>(token, "/admin/certificate-templates");
      setTemplates(data.templates);
      setRestricted(false);
    } catch (loadError) {
      const message = errorText(loadError);
      // La biblioteca de plantillas es de administración: un instructor puro no la lista.
      if (/admin/i.test(message) || /role/i.test(message) || /403/.test(message)) {
        setRestricted(true);
      } else {
        setError(message);
      }
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const linked = templates.find((template) => template.courseIds.includes(courseId)) ?? null;

  async function assign() {
    if (!selected) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${courseId}/certificate-template`, {
        method: "POST",
        body: JSON.stringify({ templateId: selected })
      });
      setSelected("");
      toast.success("Plantilla de certificado asignada.");
      await load();
    } catch (assignError) {
      toast.error(errorText(assignError));
    } finally {
      setBusy(false);
    }
  }

  async function unassign() {
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${courseId}/certificate-template`, { method: "DELETE" });
      toast.success("Se quitó la plantilla. El curso vuelve al diseño por defecto.");
      await load();
    } catch (unassignError) {
      toast.error(errorText(unassignError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tconsole-settings-block card">
      <div className="tconsole-block-head">
        <Award aria-hidden />
        <h3>Certificado del curso</h3>
        {!restricted ? (
          <button className="btn btn--ghost tconsole-block-action" type="button" onClick={() => setDesignerOpen(true)}>
            <Palette aria-hidden /> Diseñar plantillas
          </button>
        ) : null}
      </div>

      {restricted ? (
        <p className="muted">
          La biblioteca de plantillas de certificado la administra un administrador. Pídele que cree una plantilla y la
          vincule a este curso.
        </p>
      ) : (
        <>
          {error ? <p className="error-line">{error}</p> : null}
          {linked ? (
            <div className="tconsole-cert-linked">
              <span className="mono-label">
                <Check aria-hidden /> Plantilla activa
              </span>
              <strong>{linked.name}</strong>
              <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => void unassign()}>
                <X aria-hidden /> Quitar
              </button>
            </div>
          ) : (
            <>
              <p className="muted">
                Este curso usa el diseño de certificado por defecto. Asigna una plantilla para personalizarlo.
              </p>
              <div className="tconsole-inline-form">
                <select
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                  aria-label="Plantilla de certificado"
                  disabled={templates.length === 0}
                >
                  <option value="">{templates.length === 0 ? "Aún no hay plantillas" : "Elige una plantilla…"}</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <button className="btn btn--dark" type="button" disabled={busy || !selected} onClick={() => void assign()}>
                  <Check aria-hidden /> Asignar
                </button>
              </div>
            </>
          )}
        </>
      )}

      {designerOpen ? (
        <CertificateDesigner token={token} templates={templates} onClose={() => setDesignerOpen(false)} onChanged={load} />
      ) : null}
    </div>
  );
}

// ─── Diseñador de certificados: CRUD de plantillas con vista previa en vivo ──────
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

function CertificateDesigner({
  token,
  templates,
  onClose,
  onChanged
}: {
  token: string;
  templates: CertificateTemplate[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [legend, setLegend] = useState("");
  const [backgroundUrl, setBackgroundUrl] = useState("");
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setEditingId(null);
    setName("");
    setTitle("");
    setLegend("");
    setBackgroundUrl("");
  }

  function editTemplate(template: CertificateTemplate) {
    setEditingId(template.id);
    setName(template.name);
    setTitle(template.body.title ?? "");
    setLegend(template.body.legend ?? "");
    setBackgroundUrl(template.body.backgroundUrl ?? "");
  }

  async function save() {
    if (!name.trim()) {
      toast.error("La plantilla necesita un nombre.");
      return;
    }
    setBusy(true);
    const body: Record<string, string> = {};
    if (title.trim()) {
      body.title = title.trim();
    }
    if (legend.trim()) {
      body.legend = legend.trim();
    }
    if (backgroundUrl.trim()) {
      body.backgroundUrl = backgroundUrl.trim();
    }
    try {
      if (editingId) {
        await authFetch(token, `/admin/certificate-templates/${editingId}`, {
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
      resetForm();
      await onChanged();
    } catch (saveError) {
      toast.error(errorText(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const confirmed = await confirmDialog({
      title: "Eliminar plantilla",
      message: "Los cursos vinculados volverán al diseño de certificado por defecto.",
      confirmLabel: "Eliminar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/certificate-templates/${id}`, { method: "DELETE" });
      if (editingId === id) {
        resetForm();
      }
      toast.success("Plantilla eliminada.");
      await onChanged();
    } catch (removeError) {
      toast.error(errorText(removeError));
    } finally {
      setBusy(false);
    }
  }

  const previewTitle = fillCertMarkers(title.trim() || "Constancia de finalización");
  const previewLegend = fillCertMarkers(legend.trim() || "Se otorga a {{studentName}} por completar {{courseTitle}}.");

  return (
    <Modal title="Diseñador de certificados" onClose={onClose} size="xl" bodyClassName="cert-designer-body">
      <div className="cert-designer">
        <div className="cert-designer-form">
          <div className="cert-designer-list">
            <div className="tconsole-block-head">
              <h3>Plantillas</h3>
              <button className="btn btn--ghost tconsole-block-action" type="button" onClick={resetForm}>
                <Plus aria-hidden /> Nueva
              </button>
            </div>
            {templates.length === 0 ? (
              <p className="empty-state">Aún no hay plantillas. Crea la primera.</p>
            ) : (
              <ul className="cert-template-list">
                {templates.map((template) => (
                  <li className={`cert-template-item${editingId === template.id ? " is-active" : ""}`} key={template.id}>
                    <button type="button" className="cert-template-open" onClick={() => editTemplate(template)}>
                      <Award aria-hidden />
                      <span>{template.name}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={busy}
                      onClick={() => void remove(template.id)}
                      title="Eliminar plantilla"
                      aria-label={`Eliminar ${template.name}`}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label>
            Nombre de la plantilla
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="p. ej. Protección ejecutiva 2026" />
          </label>
          <label>
            Título del certificado
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
            {editingId ? (
              <button className="btn btn--ghost" type="button" onClick={resetForm} disabled={busy}>
                Cancelar edición
              </button>
            ) : null}
            <button className="btn btn--brand" type="button" onClick={() => void save()} disabled={busy}>
              <Save aria-hidden /> {editingId ? "Guardar cambios" : "Crear plantilla"}
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
          <small className="muted">Datos de ejemplo. En el certificado real se sustituyen por los del colaborador.</small>
        </div>
      </div>
    </Modal>
  );
}

// ─── Vista previa: contenido como lo ve un colaborador, en un marco tipo móvil ──
type PreviewMedia = { kind: "iframe"; src: string } | { kind: "asset"; assetId: string };

function sanitizePreviewHtml(html: string): string {
  if (typeof window === "undefined") {
    return html;
  }
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

function resolvePreviewMedia(lesson: DetailLesson): PreviewMedia | null {
  const embed = (lesson.videoEmbed ?? "").trim();
  const url = (lesson.videoUrl ?? "").trim();
  const primary = embed || url;
  const assetId = primary.match(/\/assets\/([^/?#]+)\/(?:file|stream)/i)?.[1];
  if (assetId) {
    return { kind: "asset", assetId };
  }
  if (embed) {
    return { kind: "iframe", src: embed };
  }
  const vimeoId = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i)?.[1];
  if (vimeoId) {
    return { kind: "iframe", src: `https://player.vimeo.com/video/${vimeoId}` };
  }
  const youtubeId = (url.match(/youtu\.be\/([^?&]+)/) ?? url.match(/[?&]v=([^?&]+)/))?.[1];
  if (youtubeId) {
    return { kind: "iframe", src: `https://www.youtube.com/embed/${youtubeId}` };
  }
  return null;
}

function usePreviewVideoToken(token: string, assetId: string | null) {
  const [state, setState] = useState<{ url: string | null; error: boolean }>({ url: null, error: false });
  useEffect(() => {
    if (!assetId) {
      setState({ url: null, error: false });
      return;
    }
    let cancelled = false;
    setState({ url: null, error: false });
    fetch(`${API_URL}/assets/${assetId}/video-token`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("token");
        }
        return (await response.json()) as { url: string };
      })
      .then((data) => {
        if (!cancelled) {
          setState({ url: data.url, error: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ url: null, error: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, token]);
  return state;
}

function PreviewMediaFrame({ token, media, title }: { token: string; media: PreviewMedia; title: string }) {
  const videoToken = usePreviewVideoToken(token, media.kind === "asset" ? media.assetId : null);
  return (
    <div className="tpreview-video">
      {media.kind === "iframe" ? (
        <iframe
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          src={media.src}
          title={title}
        />
      ) : videoToken.url ? (
        <video controls playsInline preload="metadata" src={videoToken.url} />
      ) : (
        <div className="tpreview-video-loading">{videoToken.error ? "No se pudo cargar el video." : "Cargando video…"}</div>
      )}
    </div>
  );
}

function PreviewLesson({ token, lesson }: { token: string; lesson: DetailLesson }) {
  const [open, setOpen] = useState(false);
  const media = open ? resolvePreviewMedia(lesson) : null;
  const minutes = lesson.durationSec ? Math.max(1, Math.round(lesson.durationSec / 60)) : null;
  return (
    <div className={`tpreview-lesson${open ? " is-open" : ""}`}>
      <button className="tpreview-row" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {media || lesson.videoUrl || lesson.kind === "VIDEO" ? <Video aria-hidden /> : <BookOpen aria-hidden />}
        <span className="tpreview-row-title">{lesson.title}</span>
        <span className="mono-label">{minutes ? `${minutes} min` : lessonKindLabel(lesson)}</span>
        <ChevronDown className={`tpreview-caret${open ? " is-open" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div className="tpreview-lesson-body">
          {media ? <PreviewMediaFrame token={token} media={media} title={lesson.title} /> : null}
          {lesson.body && lesson.body.trim() ? (
            <div className="lesson-body" dangerouslySetInnerHTML={{ __html: sanitizePreviewHtml(lesson.body) }} />
          ) : !media ? (
            <p className="muted">Esta clase aún no tiene contenido.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type PreviewQuestion = {
  id: string;
  type: string;
  prompt: string;
  options: Array<{ id: string; value: string; gapMatch: string | null }>;
};

function previewQuestionTypeLabel(type: string): string {
  switch (type) {
    case "SINGLE_CHOICE":
      return "Opción única";
    case "MULTIPLE_CHOICE":
      return "Opción múltiple";
    case "TRUE_FALSE":
      return "Verdadero / Falso";
    case "FILL_IN_THE_BLANK":
      return "Completar";
    case "SHORT_TEXT":
      return "Respuesta corta";
    case "MATCHING":
      return "Enlazar";
    case "ORDERING":
      return "Ordenar";
    default:
      return "Pregunta";
  }
}

function previewOptionText(question: PreviewQuestion): string[] {
  if (question.type === "TRUE_FALSE") {
    return ["Verdadero", "Falso"];
  }
  return question.options
    .map((option) =>
      question.type === "MATCHING" && option.gapMatch ? `${option.value} → ${option.gapMatch}` : option.value
    )
    .filter((value) => value.trim().length > 0);
}

function PreviewQuiz({ token, quiz }: { token: string; quiz: DetailQuiz }) {
  const [open, setOpen] = useState(false);
  const [questions, setQuestions] = useState<PreviewQuestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && questions === null && !loading) {
      setLoading(true);
      setError(null);
      try {
        const data = await authFetch<{ quiz: { questions: PreviewQuestion[] } }>(token, `/admin/quizzes/${quiz.id}`);
        setQuestions(data.quiz.questions);
      } catch (loadError) {
        setError(errorText(loadError));
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className={`tpreview-lesson tpreview-quiz${open ? " is-open" : ""}`}>
      <button className="tpreview-row" type="button" onClick={() => void toggle()} aria-expanded={open}>
        <SlidersHorizontal aria-hidden />
        <span className="tpreview-row-title">{quiz.title}</span>
        <span className="mono-label">
          <Clock aria-hidden />
          {quiz.timeLimitSec ? `${Math.round(quiz.timeLimitSec / 60)} min` : "sin límite"}
          {quiz.passingScorePercent != null ? ` · ${quiz.passingScorePercent}%` : ""}
        </span>
        <ChevronDown className={`tpreview-caret${open ? " is-open" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div className="tpreview-lesson-body">
          {loading ? <p className="muted">Cargando preguntas…</p> : null}
          {error ? <p className="error-line">{error}</p> : null}
          {questions && questions.length === 0 ? <p className="muted">Este examen aún no tiene preguntas.</p> : null}
          {questions && questions.length > 0 ? (
            <ol className="tpreview-questions">
              {questions.map((question, index) => (
                <li className="tpreview-question" key={question.id}>
                  <span className="mono-label">
                    {index + 1}. {previewQuestionTypeLabel(question.type)}
                  </span>
                  <p className="tpreview-question-prompt">{question.prompt}</p>
                  {previewOptionText(question).length > 0 ? (
                    <ul className="tpreview-options">
                      {previewOptionText(question).map((option, optionIndex) => (
                        <li key={optionIndex}>{option}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function VistaPreviaTab({ token, detail, error }: { token: string; detail: CourseDetail | null; error: string | null }) {
  if (error) {
    return <p className="error-line">{error}</p>;
  }
  if (!detail) {
    return <p className="empty-state">Cargando vista previa…</p>;
  }
  return (
    <section className="tconsole-preview">
      <div className="tconsole-preview-banner">
        <Eye aria-hidden /> Vista previa. Así ve un colaborador el contenido de este curso.
      </div>
      <div className="tpreview-phone">
        <div className="tpreview-phone-notch" aria-hidden />
        <div className="tpreview-phone-screen">
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
                    <div className="tpreview-items">
                      {module.lessons.map((lesson) => (
                        <PreviewLesson token={token} lesson={lesson} key={lesson.id} />
                      ))}
                      {module.quizzes.map((quiz) => (
                        <PreviewQuiz token={token} quiz={quiz} key={quiz.id} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Anuncios: compositor real + lista de avisos publicados con borrar ──────────
type CourseAnnouncement = {
  id: string;
  title: string;
  body: string;
  author: string | null;
  publishedAt: string | null;
  createdAt: string;
};

function AnunciosTab({ token, courseId }: { token: string; courseId: string }) {
  const [announcements, setAnnouncements] = useState<CourseAnnouncement[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authFetch<{ announcements: CourseAnnouncement[] }>(
        token,
        `/admin/courses/${courseId}/announcements`
      );
      setAnnouncements(data.announcements);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [token, courseId]);

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
      const data = await authFetch<{ announcement: CourseAnnouncement; notified: number }>(
        token,
        `/admin/courses/${courseId}/announcements`,
        { method: "POST", body: JSON.stringify({ title: title.trim(), body: body.trim() }) }
      );
      setTitle("");
      setBody("");
      toast.success(
        data.notified === 1
          ? "Anuncio publicado. Se notificó a 1 colaborador."
          : `Anuncio publicado. Se notificó a ${data.notified} colaboradores.`
      );
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
      setAnnouncements((current) => current.filter((item) => item.id !== id));
      toast.success("Anuncio eliminado.");
    } catch (removeError) {
      toast.error(errorText(removeError));
    }
  }

  return (
    <section className="tconsole-anuncios">
      <div className="tconsole-block-head">
        <Megaphone aria-hidden />
        <h3>Anuncios del curso</h3>
      </div>
      <p className="muted tconsole-reglas-note">
        Publica un aviso y cada colaborador con acceso lo recibe en su bandeja al abrir el curso.
      </p>

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
            placeholder="Escribe el aviso para tus colaboradores…"
            maxLength={5000}
          />
        </label>
        <div className="tconsole-anuncio-actions">
          <button className="btn btn--brand" type="submit" disabled={busy || !title.trim() || !body.trim()}>
            <Send aria-hidden /> {busy ? "Publicando…" : "Publicar"}
          </button>
        </div>
      </form>

      {error ? <p className="error-line">{error}</p> : null}

      {loading && announcements.length === 0 ? (
        <p className="empty-state">Cargando anuncios…</p>
      ) : announcements.length === 0 ? (
        <p className="empty-state">Aún no has publicado anuncios en este curso.</p>
      ) : (
        <ul className="tconsole-anuncio-list">
          {announcements.map((item) => (
            <li className="tconsole-anuncio card" key={item.id}>
              <div className="tconsole-anuncio-top">
                <strong>{item.title}</strong>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => void remove(item.id)}
                  title="Eliminar anuncio"
                  aria-label="Eliminar anuncio"
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
              <p className="tconsole-anuncio-body">{item.body}</p>
              <span className="mono-label tconsole-anuncio-meta">
                {item.author ? `${item.author} · ` : ""}
                {formatDateTime(item.publishedAt ?? item.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
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
