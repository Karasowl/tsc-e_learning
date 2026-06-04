"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Boxes, FilePlus2, FolderPlus, ImagePlus, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { RichTextEditor } from "./RichTextEditor";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function assetFileUrl(assetId: string) {
  return `${API_URL}/assets/${assetId}/file`;
}

async function authFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: unknown };
    throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function uploadAsset(token: string, file: File): Promise<{ id: string }> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_URL}/assets`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form
  });
  if (!response.ok) {
    throw new Error("No se pudo subir el archivo");
  }
  const data = (await response.json()) as { asset: { id: string } };
  return data.asset;
}

type AdminCourse = {
  id: string;
  title: string;
  status: string;
  teacher?: { id: string; displayName: string } | null;
  _count?: { modules: number; lessons: number; quizzes: number; enrollments: number };
};

type EditorLesson = {
  id: string;
  moduleId: string | null;
  title: string;
  kind: string;
  body: string | null;
  videoUrl: string | null;
};

type EditorModule = {
  id: string;
  title: string;
  position: number;
  lessons: EditorLesson[];
  quizzes: { id: string; title: string }[];
};

type EditorCourse = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  excerpt: string | null;
  level: string | null;
  status: string;
  thumbnail?: { id: string } | null;
  modules: EditorModule[];
};

export function AuthoringView({ token, isAdmin }: { token: string; isAdmin: boolean }) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (editingId) {
    return <CourseEditor token={token} courseId={editingId} onBack={() => setEditingId(null)} />;
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
    if (!window.confirm("¿Eliminar este curso y todo su contenido?")) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${id}`, { method: "DELETE" });
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
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
                  <button className="icon-button" disabled={busy} onClick={() => void remove(course.id)} title="Eliminar" type="button">
                    <Trash2 aria-hidden />
                  </button>
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

function CourseEditor({ token, courseId, onBack }: { token: string; courseId: string; onBack: () => void }) {
  const [course, setCourse] = useState<EditorCourse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const data = await authFetch<{ course: EditorCourse }>(token, `/courses/${courseId}`);
      setCourse(data.course);
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
    try {
      await authFetch(token, `/admin/courses/${course.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: course.title,
          excerpt: course.excerpt,
          description: course.description,
          level: course.level,
          status: course.status
        })
      });
      setSavedAt(new Date().toLocaleTimeString("es-MX"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
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
    } catch (coverError) {
      setError(coverError instanceof Error ? coverError.message : String(coverError));
    } finally {
      setBusy(false);
    }
  }

  async function addModule() {
    if (!course) {
      return;
    }
    const title = window.prompt("Nombre de la sección:");
    if (!title) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${course.id}/modules`, { method: "POST", body: JSON.stringify({ title }) });
      await load();
    } catch (moduleError) {
      setError(moduleError instanceof Error ? moduleError.message : String(moduleError));
    } finally {
      setBusy(false);
    }
  }

  async function removeModule(id: string) {
    if (!window.confirm("¿Eliminar esta sección y sus clases?")) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/modules/${id}`, { method: "DELETE" });
      await load();
    } catch (moduleError) {
      setError(moduleError instanceof Error ? moduleError.message : String(moduleError));
    } finally {
      setBusy(false);
    }
  }

  async function addLesson(moduleId: string) {
    if (!course) {
      return;
    }
    const title = window.prompt("Título de la clase:");
    if (!title) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/courses/${course.id}/lessons`, {
        method: "POST",
        body: JSON.stringify({ title, moduleId })
      });
      await load();
    } catch (lessonError) {
      setError(lessonError instanceof Error ? lessonError.message : String(lessonError));
    } finally {
      setBusy(false);
    }
  }

  if (!course) {
    return (
      <section className="data-section">
        <button className="ghost-button" onClick={onBack} type="button">
          <ArrowLeft aria-hidden /> Volver
        </button>
        {error ? <p className="error-line">{error}</p> : <p className="empty-state">Cargando curso…</p>}
      </section>
    );
  }

  return (
    <section className="data-section editor">
      <div className="section-header">
        <button className="ghost-button" onClick={onBack} type="button">
          <ArrowLeft aria-hidden /> Volver
        </button>
        <div className="quiz-actions">
          {savedAt ? <small className="muted">Guardado {savedAt}</small> : null}
          <button className="primary-button" disabled={busy} onClick={() => void saveCourse()} type="button">
            <Save aria-hidden /> Guardar curso
          </button>
        </div>
      </div>

      {error ? <p className="error-line">{error}</p> : null}

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
            {course.thumbnail ? <img className="cover-thumb" src={assetFileUrl(course.thumbnail.id)} alt="" /> : <div className="cover-thumb empty"><Boxes aria-hidden /></div>}
            <label className="secondary-button file-button">
              <ImagePlus aria-hidden /> Subir imagen
              <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void changeCover(f); }} />
            </label>
          </div>
        </label>
      </div>

      <label>
        Resumen
        <input value={course.excerpt ?? ""} onChange={(e) => patchCourse({ excerpt: e.target.value })} placeholder="Descripción corta para el catálogo" />
      </label>
      <label>
        Descripción
        <textarea rows={3} value={course.description ?? ""} onChange={(e) => patchCourse({ description: e.target.value })} />
      </label>

      <div className="section-header">
        <h3>Contenido del curso</h3>
        <button className="secondary-button" disabled={busy} onClick={() => void addModule()} type="button">
          <FolderPlus aria-hidden /> Sección
        </button>
      </div>

      {course.modules.map((module) => (
        <div className="module-edit" key={module.id}>
          <div className="module-edit-head">
            <strong>{module.title}</strong>
            <div className="quiz-actions">
              <button className="secondary-button" disabled={busy} onClick={() => void addLesson(module.id)} type="button">
                <FilePlus2 aria-hidden /> Clase
              </button>
              <button className="icon-button" disabled={busy} onClick={() => void removeModule(module.id)} title="Eliminar sección" type="button">
                <Trash2 aria-hidden />
              </button>
            </div>
          </div>
          {module.lessons.length === 0 ? (
            <p className="empty-state">Sin clases todavía.</p>
          ) : (
            module.lessons.map((lesson) => (
              <LessonEditor key={lesson.id} token={token} lesson={lesson} onChanged={load} setBusy={setBusy} setError={setError} />
            ))
          )}
          {module.quizzes.length > 0 ? (
            <p className="muted"><small>{module.quizzes.length} examen(es) en esta sección — edición de exámenes próximamente.</small></p>
          ) : null}
        </div>
      ))}
      {course.modules.length === 0 ? <p className="empty-state">Agrega una sección para empezar a poner clases.</p> : null}
    </section>
  );
}

function LessonEditor({
  token,
  lesson,
  onChanged,
  setBusy,
  setError
}: {
  token: string;
  lesson: EditorLesson;
  onChanged: () => Promise<void>;
  setBusy: (value: boolean) => void;
  setError: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(lesson.title);
  const [body, setBody] = useState(lesson.body ?? "");
  const [videoUrl, setVideoUrl] = useState(lesson.videoUrl ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await authFetch(token, `/admin/lessons/${lesson.id}`, {
        method: "PUT",
        body: JSON.stringify({ title, body, videoUrl: videoUrl || null })
      });
      await onChanged();
      setOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("¿Eliminar esta clase?")) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/lessons/${lesson.id}`, { method: "DELETE" });
      await onChanged();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lesson-edit">
      <div className="lesson-edit-head">
        <button className="link-button" onClick={() => setOpen((value) => !value)} type="button">
          {lesson.title}
        </button>
        <button className="icon-button" onClick={() => void remove()} title="Eliminar clase" type="button">
          <Trash2 aria-hidden />
        </button>
      </div>
      {open ? (
        <div className="lesson-edit-body">
          <label>
            Título de la clase
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Video (enlace de YouTube, opcional)
            <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtu.be/…" />
          </label>
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
          <div className="quiz-actions">
            <button className="primary-button" onClick={() => void save()} type="button">
              <Save aria-hidden /> Guardar clase
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusTag({ status }: { status: string }) {
  const label = status === "PUBLISHED" ? "Publicado" : status === "ARCHIVED" ? "Archivado" : "Borrador";
  return <span className={`status-pill ${status.toLowerCase()}`}>{label}</span>;
}
