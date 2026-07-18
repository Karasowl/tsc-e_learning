"use client";

import { ComponentType, FormEvent, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Boxes, Check, ChevronDown, ChevronUp, ClipboardList, Clock, Download, FilePlus2, FileText, FileType2, FolderPlus, GraduationCap, ImagePlus, LayoutList, Link2, Paperclip, Pencil, Plus, RefreshCw, Save, Search, Star, Trash2, UploadCloud, UserPlus, Users, Video, X } from "lucide-react";
import { RichTextEditor } from "./RichTextEditor";
import { QuizBuilder } from "./QuizBuilder";
import { ReviewsModeration } from "./panels";
import { assetFileUrl, authFetch, downloadAsset, errorText, uploadAsset } from "./apiClient";
import { Modal, confirmDialog, toast } from "./ui";

type AdminCourse = {
  id: string;
  title: string;
  status: string;
  teacher?: { id: string; displayName: string } | null;
  _count?: { modules: number; lessons: number; quizzes: number; enrollments: number };
};

type LessonAsset = {
  id: string;
  title: string;
  mimeType: string | null;
};

type EditorLesson = {
  id: string;
  moduleId: string | null;
  title: string;
  kind: string;
  position: number;
  body: string | null;
  videoUrl: string | null;
  durationSec?: number | null;
  assets?: LessonAsset[];
};

// Líneas de servicio sugeridas: las comparte el asistente "Nuevo curso" de la
// consola del instructor y el campo editable del editor de curso.
export const SERVICE_LINES = ["Protección ejecutiva", "Custodia de mercancía", "Seguridad intramuros"];

const LESSON_KINDS: Array<{ value: string; label: string }> = [
  { value: "TEXT", label: "Texto" },
  { value: "VIDEO", label: "Video" },
  { value: "RESOURCE", label: "Recurso" },
  { value: "MIXED", label: "Mixto" }
];

// Un videoUrl que apunta a /assets/:id/(file|stream) es un MP4 subido a la
// plataforma (no un enlace externo). El player del alumno lo reconoce por esa ruta.
function uploadedVideoAssetId(videoUrl: string | null | undefined): string | null {
  if (!videoUrl) {
    return null;
  }
  const match = videoUrl.match(/\/assets\/([^/?#]+)\/(?:file|stream)/i);
  return match?.[1] ?? null;
}

type EditorModule = {
  id: string;
  title: string;
  position: number;
  lessons: EditorLesson[];
  quizzes: { id: string; title: string; status?: string }[];
};

type EditorCourse = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  excerpt: string | null;
  level: string | null;
  // Línea de servicio del curso. Opcional porque el detalle público puede no
  // exponerla todavía: si no llega, el campo inicia vacío y NO se pisa al guardar.
  serviceLine?: string | null;
  status: string;
  version: number;
  thumbnail?: { id: string } | null;
  modules: EditorModule[];
};

// Metadatos que el editor reporta hacia arriba (breadcrumb + pills de la consola
// del instructor): título, estado y versión vigentes tras cargar o guardar.
export type CourseMeta = { title: string; status: string; version: number };

export function AuthoringView({ token, isAdmin }: { token: string; isAdmin: boolean }) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (editingId) {
    return <CourseEditor token={token} courseId={editingId} isAdmin={isAdmin} onBack={() => setEditingId(null)} />;
  }
  return <CourseManager token={token} isAdmin={isAdmin} onOpen={setEditingId} />;
}

function CourseManager({ token, isAdmin, onOpen }: { token: string; isAdmin: boolean; onOpen: (id: string) => void }) {
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const data = await authFetch<{ courses: AdminCourse[] }>(token, "/admin/courses");
      setCourses(data.courses);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const title = String(new FormData(formEl).get("title") ?? "").trim();
    if (!title) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await authFetch<{ course: { id: string } }>(token, "/admin/courses", {
        method: "POST",
        body: JSON.stringify({ title })
      });
      formEl.reset();
      onOpen(data.course.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const confirmed = await confirmDialog({
      title: "Eliminar curso",
      message: "Se eliminará el curso y todo su contenido. Esta acción no se puede deshacer.",
      confirmLabel: "Eliminar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${id}`, { method: "DELETE" });
      await load();
      toast.success("Curso eliminado.");
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : String(removeError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="data-section">
      <div className="section-header">
        <h2>{isAdmin ? "Todos los cursos" : "Mis cursos"}</h2>
        <button className="icon-button" disabled={busy} onClick={() => void load()} title="Actualizar" type="button">
          <RefreshCw aria-hidden />
        </button>
      </div>

      <form className="rule-form" onSubmit={createCourse}>
        <label>
          Nuevo curso
          <input name="title" placeholder="Título del curso" required />
        </label>
        <button className="primary-button" disabled={busy} type="submit">
          <Plus aria-hidden />
          Crear curso
        </button>
      </form>

      {error ? <p className="error-line">{error}</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Curso</th>
              <th>Estado</th>
              <th>Contenido</th>
              {isAdmin ? <th>Instructor</th> : null}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => (
              <tr key={course.id}>
                <td>
                  <button className="link-button" onClick={() => onOpen(course.id)} type="button">
                    {course.title}
                  </button>
                </td>
                <td><StatusTag status={course.status} /></td>
                <td>
                  <small>
                    {course._count?.modules ?? 0} secciones · {course._count?.lessons ?? 0} clases · {course._count?.quizzes ?? 0} exámenes
                  </small>
                </td>
                {isAdmin ? <td>{course.teacher?.displayName ?? "—"}</td> : null}
                <td>
                  <div className="row-actions">
                    <button className="secondary-button" disabled={busy} onClick={() => onOpen(course.id)} type="button">
                      <Pencil aria-hidden /> Editar
                    </button>
                    <button className="icon-button" disabled={busy} onClick={() => void remove(course.id)} title="Eliminar curso" type="button">
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {courses.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 5 : 4}>
                  <p className="empty-state">Aún no hay cursos. Crea el primero arriba.</p>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CourseEditor({
  token,
  courseId,
  isAdmin,
  onBack,
  embedded = false,
  section,
  onMeta
}: {
  token: string;
  courseId: string;
  isAdmin: boolean;
  onBack: () => void;
  // Cuando `embedded`, el editor vive DENTRO de la consola del instructor: oculta
  // su cabecera "Volver" y sus propias pestañas (la consola las provee), y usa
  // `section` como pestaña controlada. Sin estos props, el comportamiento es
  // idéntico al del panel de admin (compatibilidad hacia atrás).
  embedded?: boolean;
  section?: "content" | "students" | "reviews";
  onMeta?: (meta: CourseMeta) => void;
}) {
  const [course, setCourse] = useState<EditorCourse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [editingQuizId, setEditingQuizId] = useState<string | null>(null);
  const [tab, setTab] = useState<"content" | "students" | "reviews">("content");
  const activeTab = embedded ? section ?? "content" : tab;
  const [lessonModal, setLessonModal] = useState<{ moduleId: string; lesson?: EditorLesson } | null>(null);
  const [coverError, setCoverError] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<{
    title: string;
    excerpt: string | null;
    description: string | null;
    level: string | null;
    serviceLine: string | null;
    status: string;
  } | null>(null);

  async function load() {
    setError(null);
    try {
      const data = await authFetch<{ course: EditorCourse }>(token, `/courses/${courseId}`);
      setCourse(data.course);
      setSavedSnapshot({
        title: data.course.title,
        excerpt: data.course.excerpt ?? null,
        description: data.course.description ?? null,
        level: data.course.level ?? null,
        serviceLine: data.course.serviceLine ?? null,
        status: data.course.status
      });
      setCoverError(false);
      onMeta?.({ title: data.course.title, status: data.course.status, version: data.course.version });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  function patchCourse(patch: Partial<EditorCourse>) {
    setCourse((current) => (current ? { ...current, ...patch } : current));
  }

  async function saveCourse() {
    if (!course) {
      return;
    }
    setBusy(true);
    setError(null);
    // La línea de servicio solo viaja cuando el usuario la cambió: si el detalle
    // aún no la expone, un guardado sin tocarla no borra el valor existente.
    const serviceLineNormalized = (course.serviceLine ?? "").trim() || null;
    const serviceLineChanged = Boolean(savedSnapshot && serviceLineNormalized !== savedSnapshot.serviceLine);
    try {
      const updated = await authFetch<{ course: { title: string; status: string; version: number } }>(
        token,
        `/admin/courses/${course.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            title: course.title,
            excerpt: course.excerpt,
            description: course.description,
            level: course.level,
            status: course.status,
            ...(serviceLineChanged ? { serviceLine: serviceLineNormalized } : {})
          })
        }
      );
      // Guardar el estado como PUBLISHED (desde un estado no publicado) corta una
      // nueva versión en el servidor: reflejamos la versión devuelta en el editor.
      patchCourse({ version: updated.course.version });
      setSavedAt(new Date().toLocaleTimeString("es-MX"));
      setSavedSnapshot({
        title: course.title,
        excerpt: course.excerpt ?? null,
        description: course.description ?? null,
        level: course.level ?? null,
        serviceLine: serviceLineChanged ? serviceLineNormalized : savedSnapshot?.serviceLine ?? null,
        status: course.status
      });
      onMeta?.({ title: updated.course.title, status: updated.course.status, version: updated.course.version });
      toast.success("Curso guardado.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function changeCover(file: File) {
    if (!course) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const asset = await uploadAsset(token, file);
      await authFetch(token, `/admin/courses/${course.id}`, {
        method: "PUT",
        body: JSON.stringify({ thumbnailAssetId: asset.id })
      });
      patchCourse({ thumbnail: { id: asset.id } });
      setCoverError(false);
      toast.success("Portada actualizada.");
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function addModule(title: string): Promise<boolean> {
    if (!course || !title.trim()) {
      return false;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${course.id}/modules`, { method: "POST", body: JSON.stringify({ title: title.trim() }) });
      await load();
      return true;
    } catch (moduleError) {
      setError(moduleError instanceof Error ? moduleError.message : String(moduleError));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeModule(id: string) {
    const confirmed = await confirmDialog({
      title: "Eliminar sección",
      message: "Se eliminará la sección junto con sus clases.",
      confirmLabel: "Eliminar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/modules/${id}`, { method: "DELETE" });
      await load();
      toast.success("Sección eliminada.");
    } catch (moduleError) {
      const message = moduleError instanceof Error ? moduleError.message : String(moduleError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function removeLesson(lessonId: string) {
    const confirmed = await confirmDialog({
      title: "Eliminar clase",
      message: "Se eliminará la clase junto con sus documentos.",
      confirmLabel: "Eliminar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/lessons/${lessonId}`, { method: "DELETE" });
      await load();
      toast.success("Clase eliminada.");
    } catch (lessonError) {
      const message = lessonError instanceof Error ? lessonError.message : String(lessonError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  // Reordenar secciones/clases. El backend acepta `position` (1-based) en
  // PUT /admin/modules/:id y PUT /admin/lessons/:id y renumera en cadena.
  async function persistPosition(kind: "modules" | "lessons", id: string, position: number) {
    setBusy(true);
    setError(null);
    try {
      await authFetch(token, `/admin/${kind}/${id}`, {
        method: "PUT",
        body: JSON.stringify({ position })
      });
      await load();
    } catch (reorderError) {
      const message = errorText(reorderError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  function moveModule(index: number, direction: -1 | 1) {
    if (!course) {
      return;
    }
    const target = index + direction;
    if (target < 0 || target >= course.modules.length) {
      return;
    }
    // Intercambiar con el vecino equivale a pedir su posición (índice + 1).
    void persistPosition("modules", course.modules[index]!.id, target + 1);
  }

  function moveLesson(moduleId: string, localIndex: number, direction: -1 | 1) {
    if (!course) {
      return;
    }
    const parentModule = course.modules.find((entry) => entry.id === moduleId);
    if (!parentModule) {
      return;
    }
    const neighborLocal = localIndex + direction;
    if (neighborLocal < 0 || neighborLocal >= parentModule.lessons.length) {
      return;
    }
    // El backend reordena lecciones por el orden GLOBAL del curso (no por módulo).
    // Traducimos el intercambio dentro del módulo a la posición global del vecino.
    const neighbor = parentModule.lessons[neighborLocal]!;
    const globalLessons = course.modules
      .flatMap((entry) => entry.lessons)
      .sort((left, right) => left.position - right.position);
    const neighborGlobalIndex = globalLessons.findIndex((entry) => entry.id === neighbor.id);
    if (neighborGlobalIndex < 0) {
      return;
    }
    void persistPosition("lessons", parentModule.lessons[localIndex]!.id, neighborGlobalIndex + 1);
  }

  async function addQuiz(moduleId: string, title: string): Promise<boolean> {
    if (!course || !title.trim()) {
      return false;
    }
    setBusy(true);
    try {
      const data = await authFetch<{ quiz: { id: string } }>(token, `/admin/courses/${course.id}/quizzes`, {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), moduleId })
      });
      setEditingQuizId(data.quiz.id);
      return true;
    } catch (quizError) {
      setError(quizError instanceof Error ? quizError.message : String(quizError));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeQuiz(quizId: string) {
    const confirmed = await confirmDialog({
      title: "Eliminar examen",
      message: "Se eliminará el examen junto con sus preguntas e intentos de los estudiantes.",
      confirmLabel: "Eliminar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/quizzes/${quizId}`, { method: "DELETE" });
      await load();
      toast.success("Examen eliminado.");
    } catch (quizError) {
      const message = quizError instanceof Error ? quizError.message : String(quizError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  const dirty = Boolean(
    course &&
      savedSnapshot &&
      (course.title !== savedSnapshot.title ||
        (course.excerpt ?? null) !== savedSnapshot.excerpt ||
        (course.description ?? null) !== savedSnapshot.description ||
        (course.level ?? null) !== savedSnapshot.level ||
        ((course.serviceLine ?? "").trim() || null) !== savedSnapshot.serviceLine ||
        course.status !== savedSnapshot.status)
  );

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function handleBack() {
    if (dirty) {
      const leave = await confirmDialog({
        title: "Cambios sin guardar",
        message: "Tienes cambios sin guardar en el curso. ¿Salir sin guardar?",
        confirmLabel: "Salir sin guardar",
        cancelLabel: "Seguir editando",
        danger: true
      });
      if (!leave) {
        return;
      }
    }
    onBack();
  }

  if (!course) {
    return (
      <section className="data-section">
        {embedded ? null : (
          <button className="ghost-button" onClick={onBack} type="button">
            <ArrowLeft aria-hidden /> Volver
          </button>
        )}
        {error ? <p className="error-line">{error}</p> : <p className="empty-state">Cargando curso…</p>}
      </section>
    );
  }

  if (editingQuizId) {
    return (
      <section className="data-section">
        <QuizBuilder
          token={token}
          quizId={editingQuizId}
          onBack={async () => {
            setEditingQuizId(null);
            await load();
          }}
        />
      </section>
    );
  }

  return (
    <section className={`data-section editor${embedded ? " editor--embedded" : ""}`}>
      {embedded ? (
        activeTab === "content" ? (
          <div className="section-header editor-save-row">
            {savedAt ? <small className="muted">Guardado {savedAt}</small> : dirty ? <small className="muted">Cambios sin guardar</small> : null}
            <button className="btn btn--brand" disabled={busy || !dirty} onClick={() => void saveCourse()} type="button">
              <Save aria-hidden /> Guardar cambios
            </button>
          </div>
        ) : null
      ) : (
        <div className="section-header">
          <button className="ghost-button" onClick={() => void handleBack()} type="button">
            <ArrowLeft aria-hidden /> Volver
          </button>
          <div className="quiz-actions">
            {savedAt ? <small className="muted">Guardado {savedAt}</small> : null}
            <button className="primary-button" disabled={busy} onClick={() => void saveCourse()} type="button">
              <Save aria-hidden /> Guardar curso
            </button>
          </div>
        </div>
      )}

      {error ? <p className="error-line">{error}</p> : null}

      {course.status === "ARCHIVED" ? (
        <div className="ops-alert card tone-warn" role="status">
          <span className="ops-alert-icon" aria-hidden>
            <AlertTriangle aria-hidden />
          </span>
          <div className="ops-alert-body">
            <strong>Curso archivado</strong>
            <span>Los colaboradores no ven este curso. Cambia el estado para reactivarlo.</span>
          </div>
        </div>
      ) : null}

      {embedded ? null : (
        <div className="editor-tabs">
          <button className={`tab-button ${tab === "content" ? "active" : ""}`} onClick={() => setTab("content")} type="button">
            <LayoutList aria-hidden /> Contenido
          </button>
          <button className={`tab-button ${tab === "students" ? "active" : ""}`} onClick={() => setTab("students")} type="button">
            <Users aria-hidden /> Estudiantes con acceso
          </button>
          {isAdmin ? (
            <button className={`tab-button ${tab === "reviews" ? "active" : ""}`} onClick={() => setTab("reviews")} type="button">
              <Star aria-hidden /> Reseñas
            </button>
          ) : null}
        </div>
      )}

      {activeTab === "students" ? (
        <EnrollmentManager token={token} courseId={course.id} />
      ) : activeTab === "reviews" ? (
        <ReviewsModeration token={token} courseId={course.id} />
      ) : (
        <div className="editor-2pane">
      <div className="editor-pane editor-pane--tree">
      <div className="section-header">
        <h3>Contenido del curso</h3>
        <InlineAdd label="Sección" placeholder="Nombre de la sección" icon={FolderPlus} busy={busy} onAdd={addModule} />
      </div>

      {course.modules.map((module, moduleIndex) => (
        <div className="module-edit" key={module.id}>
          <div className="module-edit-head">
            <strong>{module.title}</strong>
            <div className="quiz-actions">
              <span className="order-controls">
                <button className="icon-button" disabled={busy || moduleIndex === 0} onClick={() => moveModule(moduleIndex, -1)} title="Subir sección" aria-label="Subir sección" type="button">
                  <ChevronUp aria-hidden />
                </button>
                <button className="icon-button" disabled={busy || moduleIndex === course.modules.length - 1} onClick={() => moveModule(moduleIndex, 1)} title="Bajar sección" aria-label="Bajar sección" type="button">
                  <ChevronDown aria-hidden />
                </button>
              </span>
              <button className="secondary-button" disabled={busy} onClick={() => setLessonModal({ moduleId: module.id })} type="button">
                <FilePlus2 aria-hidden /> Clase
              </button>
              <InlineAdd label="Examen" placeholder="Título del examen" icon={ClipboardList} busy={busy} onAdd={(title) => addQuiz(module.id, title)} />
              <button className="icon-button" disabled={busy} onClick={() => void removeModule(module.id)} title="Eliminar sección" type="button">
                <Trash2 aria-hidden />
              </button>
            </div>
          </div>
          {module.lessons.length === 0 ? (
            <p className="empty-state">Sin clases todavía.</p>
          ) : (
            <div className="lesson-rows">
              {module.lessons.map((lesson, lessonIndex) => (
                <div className="lesson-row-edit" key={lesson.id}>
                  <button className="lesson-row-open" onClick={() => setLessonModal({ moduleId: module.id, lesson })} type="button">
                    <FileText aria-hidden />
                    <span>{lesson.title}</span>
                    {lesson.assets && lesson.assets.length > 0 ? (
                      <small className="muted doc-count"><Paperclip aria-hidden /> {lesson.assets.length}</small>
                    ) : null}
                    <Pencil className="row-edit-hint" aria-hidden />
                  </button>
                  <span className="order-controls">
                    <button className="icon-button" disabled={busy || lessonIndex === 0} onClick={() => moveLesson(module.id, lessonIndex, -1)} title="Subir clase" aria-label="Subir clase" type="button">
                      <ChevronUp aria-hidden />
                    </button>
                    <button className="icon-button" disabled={busy || lessonIndex === module.lessons.length - 1} onClick={() => moveLesson(module.id, lessonIndex, 1)} title="Bajar clase" aria-label="Bajar clase" type="button">
                      <ChevronDown aria-hidden />
                    </button>
                  </span>
                  <button className="icon-button" disabled={busy} onClick={() => void removeLesson(lesson.id)} title="Eliminar clase" type="button">
                    <Trash2 aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
          {module.quizzes.length > 0 ? (
            <div className="quiz-list">
              {module.quizzes.map((quiz) => (
                <div className="quiz-list-row" key={quiz.id}>
                  <button className="quiz-list-item" onClick={() => setEditingQuizId(quiz.id)} type="button">
                    <ClipboardList aria-hidden /> {quiz.title}
                    {quiz.status ? (
                      <span className={quiz.status === "PUBLISHED" ? "pill pill--ok" : "pill pill--watch"}>
                        {quiz.status === "PUBLISHED" ? "Publicado" : "Borrador"}
                      </span>
                    ) : null}
                  </button>
                  <button className="icon-button" disabled={busy} onClick={() => void removeQuiz(quiz.id)} title="Eliminar examen" type="button">
                    <Trash2 aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      {course.modules.length === 0 ? <p className="empty-state">Agrega una sección para empezar a poner clases.</p> : null}
      {course.modules.some((module) => module.quizzes.some((quiz) => quiz.status && quiz.status !== "PUBLISHED")) ? (
        <p className="muted quiz-draft-note">
          Los exámenes en borrador no cuentan para aprobar el curso ni son visibles para los colaboradores.
        </p>
      ) : null}
      </div>

      <aside className="editor-pane editor-pane--detail">
        <div className="section-header">
          <h3>Detalles del curso</h3>
        </div>
        <div className="editor-grid">
          <label>
            Título
            <input value={course.title} onChange={(e) => patchCourse({ title: e.target.value })} />
          </label>
          <label>
            Nivel
            <input value={course.level ?? ""} onChange={(e) => patchCourse({ level: e.target.value })} placeholder="básico, intermedio…" />
          </label>
          <label>
            Estado
            <select value={course.status} onChange={(e) => patchCourse({ status: e.target.value })}>
              <option value="DRAFT">Borrador</option>
              <option value="PUBLISHED">Publicado</option>
              <option value="ARCHIVED">Archivado</option>
            </select>
          </label>
          <label className="cover-field">
            Portada
            <div className="cover-row">
              {course.thumbnail && !coverError ? (
                <img className="cover-thumb" src={assetFileUrl(course.thumbnail.id)} alt="" onError={() => setCoverError(true)} />
              ) : (
                <div className="cover-thumb empty"><Boxes aria-hidden /></div>
              )}
              <label className="secondary-button file-button">
                <ImagePlus aria-hidden /> Subir imagen
                <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void changeCover(f); }} />
              </label>
            </div>
          </label>
        </div>

        <div className="service-line-field">
          <label>
            Línea de servicio
            <input
              value={course.serviceLine ?? ""}
              onChange={(e) => patchCourse({ serviceLine: e.target.value })}
              placeholder="p. ej. Protección ejecutiva"
            />
          </label>
          <div className="wizard-chips" role="group" aria-label="Líneas de servicio sugeridas">
            {SERVICE_LINES.map((option) => (
              <button
                key={option}
                type="button"
                className={`wizard-chip${(course.serviceLine ?? "") === option ? " is-active" : ""}`}
                onClick={() => patchCourse({ serviceLine: (course.serviceLine ?? "") === option ? "" : option })}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <label>
          Resumen
          <input value={course.excerpt ?? ""} onChange={(e) => patchCourse({ excerpt: e.target.value })} placeholder="Descripción corta para el catálogo" />
        </label>
        <label>
          Descripción
          <textarea rows={3} value={course.description ?? ""} onChange={(e) => patchCourse({ description: e.target.value })} />
        </label>
      </aside>
        </div>
      )}

      {lessonModal ? (
        <LessonModal
          token={token}
          courseId={course.id}
          moduleId={lessonModal.moduleId}
          lesson={lessonModal.lesson}
          onClose={() => setLessonModal(null)}
          onSaved={load}
        />
      ) : null}
    </section>
  );
}

function EnrollmentManager({ token, courseId }: { token: string; courseId: string }) {
  type Enrollment = {
    userId: string;
    displayName: string;
    email: string;
    serviceLabel: string | null;
    status: string;
    progressPercent: number;
    completedAt: string | null;
  };
  type StudentResult = { id: string; displayName: string; email: string; enrolled: boolean };

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<StudentResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setError(null);
    try {
      const data = await authFetch<{ enrollments: Enrollment[] }>(token, `/admin/courses/${courseId}/enrollments`);
      setEnrollments(data.enrollments);
    } catch (loadError) {
      setError(errorText(loadError));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ courseId });
      if (term.trim()) {
        params.set("q", term.trim());
      }
      const data = await authFetch<{ students: StudentResult[] }>(token, `/admin/students?${params.toString()}`);
      setResults(data.students);
    } catch (searchError) {
      setError(errorText(searchError));
    } finally {
      setBusy(false);
    }
  }

  async function enroll(userId: string) {
    setBusy(true);
    setError(null);
    try {
      await authFetch(token, `/admin/courses/${courseId}/enrollments`, {
        method: "POST",
        body: JSON.stringify({ userId })
      });
      await load();
      setResults((current) => (current ? current.map((s) => (s.id === userId ? { ...s, enrolled: true } : s)) : current));
      toast.success("Acceso concedido al estudiante.");
    } catch (enrollError) {
      const message = errorText(enrollError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string) {
    const confirmed = await confirmDialog({
      title: "Quitar acceso",
      message:
        "Se quitará el acceso y se perderá el avance registrado de este colaborador en el curso. Esta acción no se puede deshacer.",
      confirmLabel: "Quitar acceso",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authFetch(token, `/admin/courses/${courseId}/enrollments/${userId}`, { method: "DELETE" });
      await load();
      toast.success("Acceso retirado.");
    } catch (revokeError) {
      const message = errorText(revokeError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function createStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const data = new FormData(formEl);
    const displayName = String(data.get("displayName") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (!displayName || !email || password.length < 6) {
      setError("Completa nombre, correo y una contraseña de al menos 6 caracteres.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await authFetch<{ student: { id: string } }>(token, "/admin/students", {
        method: "POST",
        body: JSON.stringify({ displayName, email, password })
      });
      await authFetch(token, `/admin/courses/${courseId}/enrollments`, {
        method: "POST",
        body: JSON.stringify({ userId: created.student.id })
      });
      formEl.reset();
      setShowCreate(false);
      await load();
      toast.success("Estudiante creado e inscrito.");
    } catch (createError) {
      const message = errorText(createError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="enroll-manager">
      {error ? <p className="error-line">{error}</p> : null}

      <div className="section-header">
        <h3>Estudiantes con acceso ({enrollments.length})</h3>
        <button className="secondary-button" disabled={busy} onClick={() => setShowCreate((value) => !value)} type="button">
          <UserPlus aria-hidden /> Crear estudiante
        </button>
      </div>

      {showCreate ? (
        <form className="rule-form create-student" onSubmit={createStudent}>
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
          <button className="primary-button" disabled={busy} type="submit">
            <GraduationCap aria-hidden /> Crear y dar acceso
          </button>
        </form>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Estudiante</th>
              <th>Progreso</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {enrollments.map((enrollment) => (
              <tr key={enrollment.userId}>
                <td>
                  <strong>{enrollment.displayName}</strong>
                  <br />
                  <small className="muted">{enrollment.email}</small>
                </td>
                <td>{Math.round(enrollment.progressPercent)}%</td>
                <td><EnrollStatusTag status={enrollment.status} /></td>
                <td>
                  <button className="icon-button" disabled={busy} onClick={() => void revoke(enrollment.userId)} title="Quitar acceso" type="button">
                    <Trash2 aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
            {enrollments.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <p className="empty-state">Nadie tiene acceso todavía. Busca o crea estudiantes abajo.</p>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="section-header">
        <h3>Dar acceso a un estudiante</h3>
      </div>
      <form className="rule-form" onSubmit={search}>
        <label>
          Buscar estudiante
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Nombre o correo" />
        </label>
        <button className="secondary-button" disabled={busy} type="submit">
          <Search aria-hidden /> Buscar
        </button>
      </form>

      {results ? (
        <div className="search-results">
          {results.length === 0 ? (
            <p className="empty-state">No se encontraron estudiantes. Puedes crear uno nuevo arriba.</p>
          ) : (
            results.map((student) => (
              <div className="search-result-row" key={student.id}>
                <div>
                  <strong>{student.displayName}</strong>
                  <br />
                  <small className="muted">{student.email}</small>
                </div>
                {student.enrolled ? (
                  <span className="status-pill published">Ya tiene acceso</span>
                ) : (
                  <button className="secondary-button" disabled={busy} onClick={() => void enroll(student.id)} type="button">
                    <UserPlus aria-hidden /> Dar acceso
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function InlineAdd({
  label,
  placeholder,
  icon: Icon,
  busy,
  onAdd
}: {
  label: string;
  placeholder: string;
  icon: ComponentType<{ "aria-hidden"?: boolean }>;
  busy: boolean;
  onAdd: (title: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  if (!open) {
    return (
      <button className="secondary-button" disabled={busy} onClick={() => setOpen(true)} type="button">
        <Icon aria-hidden /> {label}
      </button>
    );
  }

  return (
    <form
      className="inline-add"
      onSubmit={async (event) => {
        event.preventDefault();
        const created = await onAdd(value);
        if (created) {
          setValue("");
          setOpen(false);
        }
      }}
    >
      <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
      <button className="primary-button" disabled={busy || !value.trim()} title="Agregar" type="submit">
        <Check aria-hidden />
      </button>
      <button className="icon-button" onClick={() => { setOpen(false); setValue(""); }} title="Cancelar" type="button">
        <X aria-hidden />
      </button>
    </form>
  );
}

function EnrollStatusTag({ status }: { status: string }) {
  const label = status === "COMPLETED" ? "Completado" : status === "SUSPENDED" ? "Suspendido" : "Activo";
  const cls = status === "COMPLETED" ? "published" : status === "SUSPENDED" ? "archived" : "draft";
  return <span className={`status-pill ${cls}`}>{label}</span>;
}

function LessonModal({
  token,
  courseId,
  moduleId,
  lesson,
  onClose,
  onSaved
}: {
  token: string;
  courseId: string;
  moduleId: string;
  lesson: EditorLesson | undefined;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [lessonId, setLessonId] = useState<string | null>(lesson?.id ?? null);
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [body, setBody] = useState(lesson?.body ?? "");
  const [videoUrl, setVideoUrl] = useState(lesson?.videoUrl ?? "");
  const [kind, setKind] = useState(lesson?.kind ?? "TEXT");
  const [durationMin, setDurationMin] = useState(
    lesson?.durationSec != null ? String(Math.round(lesson.durationSec / 60)) : ""
  );
  const [assets, setAssets] = useState<LessonAsset[]>(lesson?.assets ?? []);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [saved, setSaved] = useState({
    title: lesson?.title ?? "",
    body: lesson?.body ?? "",
    videoUrl: lesson?.videoUrl ?? "",
    kind: lesson?.kind ?? "TEXT",
    durationMin: lesson?.durationSec != null ? String(Math.round(lesson.durationSec / 60)) : ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadedAssetId = uploadedVideoAssetId(videoUrl);
  const dirty =
    title !== saved.title ||
    body !== saved.body ||
    videoUrl !== saved.videoUrl ||
    kind !== saved.kind ||
    durationMin !== saved.durationMin;

  // Browser-level guard: warn before the tab is closed/reloaded with unsaved edits.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function attemptClose() {
    if (dirty) {
      const leave = await confirmDialog({
        title: "Cambios sin guardar",
        message: "Tienes cambios sin guardar en esta clase. ¿Salir sin guardar?",
        confirmLabel: "Salir sin guardar",
        cancelLabel: "Seguir editando",
        danger: true
      });
      if (!leave) {
        return;
      }
    }
    onClose();
  }

  async function save() {
    if (!title.trim()) {
      setError("La clase necesita un título.");
      return;
    }
    setBusy(true);
    setError(null);
    const durationSec = durationMin.trim() ? Math.max(0, Math.round(Number(durationMin) * 60)) : null;
    try {
      if (lessonId) {
        await authFetch(token, `/admin/lessons/${lessonId}`, {
          method: "PUT",
          body: JSON.stringify({ title: title.trim(), body, videoUrl: videoUrl || null, kind, durationSec })
        });
      } else {
        const created = await authFetch<{ lesson: { id: string } }>(token, `/admin/courses/${courseId}/lessons`, {
          method: "POST",
          body: JSON.stringify({ title: title.trim(), moduleId, body, videoUrl: videoUrl || null, kind, durationSec })
        });
        setLessonId(created.lesson.id);
      }
      setSaved({ title: title.trim(), body, videoUrl, kind, durationMin });
      await onSaved();
      toast.success("Clase guardada.");
    } catch (saveError) {
      const message = errorText(saveError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  // Sube un MP4 a la plataforma y apunta videoUrl a /assets/:id/stream, la ruta que
  // el reproductor del alumno reconoce como video propio (token corto, no URL cruda).
  async function uploadVideo(file: File) {
    setUploadingVideo(true);
    setError(null);
    try {
      const asset = await uploadAsset(token, file);
      // Ruta relativa: el reproductor sólo extrae el id del asset, así el enlace no
      // queda atado al host de un entorno concreto.
      setVideoUrl(`/assets/${asset.id}/stream`);
      if (kind === "TEXT") {
        setKind("VIDEO");
      }
      toast.success("Video subido. Recuerda guardar la clase.");
    } catch (uploadError) {
      const message = errorText(uploadError);
      setError(message);
      toast.error(message);
    } finally {
      setUploadingVideo(false);
    }
  }

  async function uploadDoc(file: File) {
    if (!lessonId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const asset = await uploadAsset(token, file, { lessonId });
      setAssets((current) => [...current, { id: asset.id, title: asset.title, mimeType: asset.mimeType }]);
      await onSaved();
      toast.success("Documento subido.");
    } catch (uploadError) {
      const message = errorText(uploadError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function removeDoc(assetId: string) {
    const confirmed = await confirmDialog({
      title: "Eliminar documento",
      message: "El documento dejará de estar disponible para los estudiantes.",
      confirmLabel: "Eliminar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authFetch(token, `/admin/assets/${assetId}`, { method: "DELETE" });
      setAssets((current) => current.filter((asset) => asset.id !== assetId));
      await onSaved();
      toast.success("Documento eliminado.");
    } catch (removeError) {
      const message = errorText(removeError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={lessonId ? "Editar clase" : "Nueva clase"}
      onClose={attemptClose}
      wide
      footer={
        <>
          <small className="muted">{dirty ? "Cambios sin guardar" : "Todo guardado"}</small>
          <button className="ghost-button" disabled={busy} onClick={attemptClose} type="button">
            Cerrar
          </button>
          <button className="primary-button" disabled={busy || (!!lessonId && !dirty)} onClick={() => void save()} type="button">
            <Save aria-hidden /> {lessonId ? "Guardar" : "Crear clase"}
          </button>
        </>
      }
    >
      {error ? <p className="error-line">{error}</p> : null}
      <label>
        Título de la clase
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título de la clase" />
      </label>

      <div className="editor-grid">
        <label>
          <span className="field-label-icon"><FileType2 aria-hidden /> Formato</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {LESSON_KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label-icon"><Clock aria-hidden /> Duración (min)</span>
          <input
            type="number"
            min={0}
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
            placeholder="p. ej. 8"
          />
        </label>
      </div>

      <div className="lesson-video-field">
        <div className="lesson-video-head">
          <strong><Video aria-hidden /> Video de la clase</strong>
          {uploadedAssetId ? <span className="pill pill--ok">MP4 subido</span> : null}
        </div>
        <label className="lesson-video-drop file-button">
          <UploadCloud aria-hidden />
          <span>{uploadingVideo ? "Subiendo video…" : "Subir MP4 (arrastra o elige un archivo)"}</span>
          <input
            type="file"
            accept="video/mp4,video/*"
            hidden
            disabled={uploadingVideo}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void uploadVideo(file);
              }
              e.target.value = "";
            }}
          />
        </label>
        <label className="lesson-video-url">
          <span className="field-label-icon"><Link2 aria-hidden /> O pega un enlace de YouTube / Vimeo</span>
          <div className="lesson-video-url-row">
            <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtu.be/…" />
            {videoUrl ? (
              <button
                type="button"
                className="icon-button"
                onClick={() => setVideoUrl("")}
                title="Quitar video"
                aria-label="Quitar video"
              >
                <X aria-hidden />
              </button>
            ) : null}
          </div>
          {uploadedAssetId ? (
            <small className="muted">Este video vive en la plataforma. Se reproduce dentro de la clase.</small>
          ) : null}
        </label>
      </div>

      <label>
        Contenido
        <RichTextEditor
          value={body}
          onChange={setBody}
          onRequestImage={async () => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            return new Promise<string | null>((resolve) => {
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) {
                  resolve(null);
                  return;
                }
                try {
                  const asset = await uploadAsset(token, file);
                  resolve(assetFileUrl(asset.id));
                } catch {
                  resolve(null);
                }
              };
              input.click();
            });
          }}
        />
      </label>

      <div className="docs-section">
        <div className="docs-head">
          <strong>
            <Paperclip aria-hidden /> Documentos
          </strong>
          {lessonId ? (
            <label className="secondary-button file-button">
              <UploadCloud aria-hidden /> Subir documento
              <input
                type="file"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void uploadDoc(file);
                  }
                  e.target.value = "";
                }}
              />
            </label>
          ) : null}
        </div>
        {!lessonId ? (
          <p className="empty-state">Guarda la clase para poder adjuntar documentos.</p>
        ) : assets.length === 0 ? (
          <p className="empty-state">Sin documentos. Sube PDFs, guías u otros archivos.</p>
        ) : (
          <ul className="docs-list">
            {assets.map((asset) => (
              <li className="doc-item" key={asset.id}>
                <button
                  className="doc-link"
                  type="button"
                  onClick={() =>
                    void downloadAsset(token, asset.id, asset.title).catch(() =>
                      toast.error("No se pudo descargar el archivo")
                    )
                  }
                >
                  <FileText aria-hidden />
                  <span>{asset.title}</span>
                  <Download aria-hidden />
                </button>
                <button className="icon-button" disabled={busy} onClick={() => void removeDoc(asset.id)} title="Eliminar documento" type="button">
                  <Trash2 aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function StatusTag({ status }: { status: string }) {
  const label = status === "PUBLISHED" ? "Publicado" : status === "ARCHIVED" ? "Archivado" : "Borrador";
  return <span className={`status-pill ${status.toLowerCase()}`}>{label}</span>;
}
