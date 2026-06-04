"use client";

import {
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  Download,
  FileText,
  GraduationCap,
  LogOut,
  Mail,
  Play,
  RefreshCw,
  ShieldCheck,
  UserRound
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type User = {
  id: string;
  email: string;
  displayName: string;
  roles: Array<"ADMIN" | "TEACHER" | "STUDENT">;
};

type CourseSummary = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  status: string;
  teacher: { displayName: string } | null;
  enrolled: boolean;
  progressPercent: number | null;
  counts: {
    enrollments: number;
    lessons: number;
    quizzes: number;
  };
};

type CourseDetail = CourseSummary & {
  description: string | null;
  enrollment: {
    status: string;
    progressPercent: number | null;
    completedAt: string | null;
  } | null;
  modules: CourseModule[];
};

type CourseModule = {
  id: string;
  title: string;
  position: number;
  lessons: Lesson[];
  quizzes: Quiz[];
};

type Lesson = {
  id: string;
  title: string;
  slug: string;
  kind: string;
  body: string | null;
  videoProvider: string | null;
  videoUrl: string | null;
  videoEmbed: string | null;
  position: number;
  durationSec: number | null;
  completed: boolean;
  completedAt: string | null;
  assets: Asset[];
};

type Asset = {
  id: string;
  title: string;
  mimeType: string | null;
  storageKey: string;
  originalUrl: string | null;
  sizeBytes: string | null;
};

type Quiz = {
  id: string;
  title: string;
  status: string;
  position: number;
  timeLimitSec: number | null;
  passingScorePercent: number | null;
  maxAttempts: number | null;
  feedbackMode: string | null;
  questionsOrder: string | null;
  autoStart: boolean;
  hideTimeDisplay: boolean;
  questionCount: number;
  lastAttempt: AttemptSummary | null;
};

type AttemptSummary = {
  id: string;
  status: string;
  dueAt: string | null;
  submittedAt: string | null;
  scorePercent: number | null;
  totalQuestions: number | null;
  totalAnsweredQuestions: number | null;
  result: string | null;
};

type QuizQuestion = {
  id: string;
  type: string;
  prompt: string;
  description: string | null;
  position: number;
  points: number;
  options: Array<{ id: string; label: string; value: string }>;
};

type QuizAttempt = {
  attempt: AttemptSummary & {
    quizId: string;
    startedAt: string;
    totalMarks: number | null;
    earnedMarks: number | null;
  };
  questions: QuizQuestion[];
};

type Certificate = {
  id: string;
  status: string;
  folio: string;
  verificationCode: string;
  issuedAt: string;
  user: { displayName: string; email: string };
  course: { id: string; title: string; slug: string };
};

type ReportRow = {
  studentName: string;
  email: string;
  serviceLabel: string | null;
  courseTitle: string;
  progressPercent: number | null;
  status: string;
  latestAttempt: {
    scorePercent: number | null;
    earnedMarks: number | null;
    totalMarks: number | null;
  } | null;
};

type NotificationRule = {
  id: string;
  eventType: string;
  recipients: string[];
  subject: string;
  enabled: boolean;
};

type NotificationLog = {
  id: string;
  eventType: string;
  sentTo: string[];
  status: string;
  createdAt: string;
};

type AnswerState = Record<string, { selectedOptionIds: string[]; text: string }>;

type View = "courses" | "report" | "certificates" | "notifications";

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("courses");
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<CourseDetail | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [quizAttempt, setQuizAttempt] = useState<QuizAttempt | null>(null);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [reportSummary, setReportSummary] = useState<Record<string, number>>({});
  const [notificationRules, setNotificationRules] = useState<NotificationRule[]>([]);
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isPrivileged = user?.roles.includes("ADMIN") || user?.roles.includes("TEACHER");
  const isAdmin = user?.roles.includes("ADMIN");
  const activeLesson = useMemo(() => {
    if (!selectedCourse) {
      return null;
    }
    return selectedCourse.modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === activeLessonId) ?? null;
  }, [activeLessonId, selectedCourse]);

  useEffect(() => {
    const storedToken = window.localStorage.getItem("tsc_token");
    const storedUser = window.localStorage.getItem("tsc_user");
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser) as User);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadInitialData(token);
  }, [token]);

  async function api<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText })) as { error?: unknown };
      throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async function loadInitialData(authToken = token) {
    if (!authToken) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const coursePayload = await api<{ courses: CourseSummary[] }>("/courses");
      setCourses(coursePayload.courses);
      if (coursePayload.courses[0]) {
        await loadCourse(coursePayload.courses[0].id);
      }
      await loadCertificates();
      if (isPrivileged) {
        await loadReport();
      }
      if (isAdmin) {
        await loadNotifications();
      }
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setBusy(false);
    }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const payload = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? "")
        })
      });

      if (!payload.ok) {
        throw new Error("Credenciales invalidas");
      }

      const body = await payload.json() as { token: string; user: User };
      window.localStorage.setItem("tsc_token", body.token);
      window.localStorage.setItem("tsc_user", JSON.stringify(body.user));
      setToken(body.token);
      setUser(body.user);
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setBusy(false);
    }
  }

  async function loadCourse(courseId: string) {
    setError(null);
    const payload = await api<{ course: CourseDetail }>(`/courses/${courseId}`);
    setSelectedCourse(payload.course);
    const firstLesson = payload.course.modules.flatMap((module) => module.lessons)[0];
    setActiveLessonId(firstLesson?.id ?? null);
    setQuizAttempt(null);
    setAnswers({});
  }

  async function loadCertificates() {
    const payload = await api<{ certificates: Certificate[] }>("/certificates");
    setCertificates(payload.certificates);
  }

  async function loadReport() {
    const payload = await api<{ summary: Record<string, number>; rows: ReportRow[] }>("/reports/students");
    setReportSummary(payload.summary);
    setReportRows(payload.rows);
  }

  async function loadNotifications() {
    const [rules, logs] = await Promise.all([
      api<{ rules: NotificationRule[] }>("/notifications/rules"),
      api<{ logs: NotificationLog[] }>("/notifications/logs")
    ]);
    setNotificationRules(rules.rules);
    setNotificationLogs(logs.logs);
  }

  async function completeLesson(lessonId: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/lessons/${lessonId}/complete`, { method: "POST", body: "{}" });
      if (selectedCourse) {
        await loadCourse(selectedCourse.id);
      }
      await loadCertificates();
    } catch (completeError) {
      setError(errorMessage(completeError));
    } finally {
      setBusy(false);
    }
  }

  async function startQuiz(quizId: string) {
    setBusy(true);
    setError(null);
    try {
      const payload = await api<QuizAttempt>("/quizzes/attempts", {
        method: "POST",
        body: JSON.stringify({ quizId })
      });
      setQuizAttempt(payload);
      setAnswers(Object.fromEntries(payload.questions.map((question) => [question.id, { selectedOptionIds: [], text: "" }])));
    } catch (quizError) {
      setError(errorMessage(quizError));
    } finally {
      setBusy(false);
    }
  }

  async function submitQuiz() {
    if (!quizAttempt) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = await api<{ attempt: AttemptSummary; grade: { scorePercent: number; earnedMarks: number; totalMarks: number } }>(
        `/quizzes/attempts/${quizAttempt.attempt.id}/submit`,
        {
          method: "POST",
          body: JSON.stringify({
            answers: Object.entries(answers).map(([questionId, answer]) => ({
              questionId,
              selectedOptionIds: answer.selectedOptionIds,
              text: answer.text
            }))
          })
        }
      );
      setQuizAttempt({
        ...quizAttempt,
        attempt: {
          ...quizAttempt.attempt,
          ...payload.attempt
        }
      });
      if (selectedCourse) {
        await loadCourse(selectedCourse.id);
      }
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  async function issueCertificate(courseId: string) {
    setBusy(true);
    setError(null);
    try {
      await api("/certificates/issue", {
        method: "POST",
        body: JSON.stringify({ courseId })
      });
      await loadCertificates();
      setView("certificates");
    } catch (certificateError) {
      setError(errorMessage(certificateError));
    } finally {
      setBusy(false);
    }
  }

  async function openCertificate(certificateId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/certificates/${certificateId}/html`, {
        headers: token ? { authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        throw new Error("No se pudo abrir el diploma");
      }
      const blob = new Blob([await response.text()], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
    } catch (certificateError) {
      setError(errorMessage(certificateError));
    } finally {
      setBusy(false);
    }
  }

  async function createNotificationRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/notifications/rules", {
        method: "POST",
        body: JSON.stringify({
          eventType: form.get("eventType"),
          subject: form.get("subject"),
          recipients: String(form.get("recipients") ?? "")
            .split(",")
            .map((recipient) => recipient.trim())
            .filter(Boolean),
          enabled: true
        })
      });
      event.currentTarget.reset();
      await loadNotifications();
    } catch (notificationError) {
      setError(errorMessage(notificationError));
    } finally {
      setBusy(false);
    }
  }

  async function processNotifications() {
    setBusy(true);
    setError(null);
    try {
      await api("/notifications/process?limit=25", { method: "POST", body: "{}" });
      await loadNotifications();
    } catch (notificationError) {
      setError(errorMessage(notificationError));
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    window.localStorage.removeItem("tsc_token");
    window.localStorage.removeItem("tsc_user");
    setToken(null);
    setUser(null);
    setSelectedCourse(null);
    setCourses([]);
    setCertificates([]);
    setReportRows([]);
  }

  if (!token || !user) {
    return (
      <main className="login-screen">
        <section className="login-copy">
          <img className="brand-logo" src="/tsc-logo.png" alt="TSC Private Security Consulting" />
          <h1>Capacitación TSC</h1>
          <p>Acceso operativo a cursos, evaluaciones, diplomas y reportes de colaboradores.</p>
          <dl>
            <div>
              <dt>Datos migrados</dt>
              <dd>Usuarios, cursos, quizzes, progresos y diplomas desde WordPress Tutor LMS.</dd>
            </div>
            <div>
              <dt>Backend propio</dt>
              <dd>API Dockerizada, PostgreSQL y almacenamiento local portable a VPS.</dd>
            </div>
          </dl>
        </section>
        <form className="login-panel" onSubmit={login}>
          <div className="panel-heading">
            <ShieldCheck aria-hidden />
            <div>
              <p className="eyebrow">Inicio de sesión</p>
              <h2>Entrar a la plataforma</h2>
            </div>
          </div>
          <label>
            Correo
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            Contraseña
            <input autoComplete="current-password" name="password" required type="password" />
          </label>
          {error ? <p className="error-line">{error}</p> : null}
          <button className="primary-button" disabled={busy} type="submit">
            <UserRound aria-hidden />
            {busy ? "Validando" : "Ingresar"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img className="sidebar-logo" src="/tsc-shield-light.png" alt="TSC" />
          <div>
            <strong>Capacita</strong>
            <small>Seguridad Privada</small>
          </div>
        </div>
        <nav className="nav-stack" aria-label="Secciones">
          <NavButton active={view === "courses"} icon={<BookOpen aria-hidden />} label="Cursos" onClick={() => setView("courses")} />
          {isPrivileged ? (
            <NavButton active={view === "report"} icon={<BarChart3 aria-hidden />} label="Reporte" onClick={() => setView("report")} />
          ) : null}
          <NavButton active={view === "certificates"} icon={<Award aria-hidden />} label="Diplomas" onClick={() => setView("certificates")} />
          {isAdmin ? (
            <NavButton
              active={view === "notifications"}
              icon={<Bell aria-hidden />}
              label="Notificaciones"
              onClick={() => setView("notifications")}
            />
          ) : null}
        </nav>
        <button className="ghost-button sidebar-logout" onClick={logout} type="button">
          <LogOut aria-hidden />
          Salir
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{user.roles.join(" · ")}</p>
            <h1>{sectionTitle(view)}</h1>
          </div>
          <div className="user-pill">
            <UserRound aria-hidden />
            <span>{user.displayName}</span>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        {view === "courses" ? (
          <section className="course-workspace">
            <div className="course-list" aria-label="Cursos">
              <div className="section-header">
                <h2>Cursos inscritos</h2>
                <button className="icon-button" disabled={busy} onClick={() => loadInitialData()} title="Actualizar" type="button">
                  <RefreshCw aria-hidden />
                </button>
              </div>
              {courses.map((course) => (
                <button
                  className={`course-row ${selectedCourse?.id === course.id ? "active" : ""}`}
                  key={course.id}
                  onClick={() => loadCourse(course.id)}
                  type="button"
                >
                  <span>
                    <strong>{course.title}</strong>
                    <small>
                      {course.counts.lessons} lecciones · {course.counts.quizzes} examenes
                    </small>
                  </span>
                  <ProgressBar value={course.progressPercent ?? 0} />
                </button>
              ))}
              {courses.length === 0 ? <p className="empty-state">No hay cursos visibles para este usuario.</p> : null}
            </div>

            <div className="course-detail">
              {selectedCourse ? (
                <>
                  <div className="course-title-row">
                    <div>
                      <p className="eyebrow">{selectedCourse.teacher?.displayName ?? "TSC Capacitación"}</p>
                      <h2>{selectedCourse.title}</h2>
                    </div>
                    <div className="completion-chip">{selectedCourse.enrollment?.progressPercent ?? 0}%</div>
                  </div>
                  <ProgressBar value={selectedCourse.enrollment?.progressPercent ?? 0} />

                  <div className="learning-layout">
                    <div className="curriculum">
                      {selectedCourse.modules.map((module) => (
                        <div className="module-block" key={module.id}>
                          <h3>{module.title}</h3>
                          {module.lessons.map((lesson) => (
                            <button
                              className={`lesson-row ${activeLessonId === lesson.id ? "active" : ""}`}
                              key={lesson.id}
                              onClick={() => setActiveLessonId(lesson.id)}
                              type="button"
                            >
                              {lesson.completed ? <Check aria-hidden /> : <Play aria-hidden />}
                              <span>{lesson.title}</span>
                            </button>
                          ))}
                          {module.quizzes.map((quiz) => (
                            <button className="quiz-row" key={quiz.id} onClick={() => startQuiz(quiz.id)} type="button">
                              <Clock aria-hidden />
                              <span>{quiz.title}</span>
                              <small>{quiz.timeLimitSec ? `${Math.round(quiz.timeLimitSec / 60)} min` : "Sin tiempo"}</small>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>

                    <div className="lesson-panel">
                      {quizAttempt ? (
                        <QuizPanel
                          answers={answers}
                          attempt={quizAttempt}
                          busy={busy}
                          onAnswerChange={setAnswers}
                          onClose={() => setQuizAttempt(null)}
                          onSubmit={submitQuiz}
                        />
                      ) : activeLesson ? (
                        <LessonPanel lesson={activeLesson} onComplete={completeLesson} />
                      ) : (
                        <p className="empty-state">Selecciona una lección.</p>
                      )}
                    </div>
                  </div>

                  {selectedCourse.enrollment?.status === "COMPLETED" ? (
                    <button className="secondary-button" disabled={busy} onClick={() => issueCertificate(selectedCourse.id)} type="button">
                      <Award aria-hidden />
                      Emitir diploma
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="empty-state">Selecciona un curso para ver su contenido.</p>
              )}
            </div>
          </section>
        ) : null}

        {view === "report" && isPrivileged ? (
          <section className="data-section">
            <div className="metrics-row">
              {Object.entries(reportSummary).map(([label, value]) => (
                <div className="metric" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
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
                  {reportRows.map((row, index) => (
                    <tr key={`${row.email}-${row.courseTitle}-${index}`}>
                      <td>
                        <strong>{row.studentName}</strong>
                        <small>{row.email}</small>
                      </td>
                      <td>{row.serviceLabel ?? "Sin servicio"}</td>
                      <td>{row.courseTitle}</td>
                      <td>{row.progressPercent ?? 0}%</td>
                      <td><StatusPill label={row.status} /></td>
                      <td>{row.latestAttempt?.scorePercent ?? "N/D"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {view === "certificates" ? (
          <section className="data-section">
            <div className="section-header">
              <h2>Diplomas emitidos</h2>
              <button className="icon-button" disabled={busy} onClick={loadCertificates} title="Actualizar" type="button">
                <RefreshCw aria-hidden />
              </button>
            </div>
            <div className="certificate-grid">
              {certificates.map((certificate) => (
                <article className="certificate-tile" key={certificate.id}>
                  <Award aria-hidden />
                  <div>
                    <strong>{certificate.course.title}</strong>
                    <span>{certificate.folio}</span>
                    <small>{new Date(certificate.issuedAt).toLocaleDateString("es-MX")}</small>
                  </div>
                  <button className="icon-button" onClick={() => openCertificate(certificate.id)} title="Abrir diploma" type="button">
                    <Download aria-hidden />
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {view === "notifications" && isAdmin ? (
          <section className="data-section split-section">
            <form className="rule-form" onSubmit={createNotificationRule}>
              <h2>Regla de correo</h2>
              <label>
                Evento
                <select name="eventType" required>
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
                Destinatarios
                <input name="recipients" placeholder="correo@tsc.com, otro@tsc.com" required />
              </label>
              <button className="primary-button" disabled={busy} type="submit">
                <Mail aria-hidden />
                Guardar regla
              </button>
            </form>
            <div className="notification-panel">
              <div className="section-header">
                <h2>Logs</h2>
                <button className="secondary-button" disabled={busy} onClick={processNotifications} type="button">
                  <RefreshCw aria-hidden />
                  Procesar pendientes
                </button>
              </div>
              <div className="rule-list">
                {notificationRules.map((rule) => (
                  <div className="rule-row" key={rule.id}>
                    <Bell aria-hidden />
                    <span>{rule.eventType}</span>
                    <small>{rule.recipients.join(", ")}</small>
                  </div>
                ))}
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
                    {notificationLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{log.eventType}</td>
                        <td>{log.status}</td>
                        <td>{new Date(log.createdAt).toLocaleString("es-MX")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} type="button">
      {icon}
      {label}
    </button>
  );
}

function ProgressBar({ value }: { value: number }) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-track" aria-label={`Avance ${percent}%`}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

function LessonPanel({ lesson, onComplete }: { lesson: Lesson; onComplete: (lessonId: string) => void }) {
  const embedUrl = youtubeEmbedUrl(lesson.videoUrl);
  return (
    <article className="content-surface">
      <div className="section-header">
        <div>
          <p className="eyebrow">{lesson.kind}</p>
          <h2>{lesson.title}</h2>
        </div>
        <button className="secondary-button" disabled={lesson.completed} onClick={() => onComplete(lesson.id)} type="button">
          <Check aria-hidden />
          {lesson.completed ? "Completada" : "Marcar completada"}
        </button>
      </div>
      {embedUrl ? (
        <div className="video-frame">
          <iframe allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen src={embedUrl} title={lesson.title} />
        </div>
      ) : null}
      {lesson.body ? <div className="lesson-body" dangerouslySetInnerHTML={{ __html: lesson.body }} /> : null}
      {lesson.assets.length > 0 ? (
        <div className="asset-list">
          {lesson.assets.map((asset) => (
            <a href={asset.originalUrl ?? "#"} key={asset.id} rel="noreferrer" target="_blank">
              <FileText aria-hidden />
              {asset.title}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function QuizPanel({
  answers,
  attempt,
  busy,
  onAnswerChange,
  onClose,
  onSubmit
}: {
  answers: AnswerState;
  attempt: QuizAttempt;
  busy: boolean;
  onAnswerChange: (answers: AnswerState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const remaining = useRemainingTime(attempt.attempt.dueAt);
  const submitted = attempt.attempt.status !== "IN_PROGRESS";

  function setQuestionAnswer(question: QuizQuestion, optionId: string, checked: boolean) {
    const current = answers[question.id] ?? { selectedOptionIds: [], text: "" };
    const selectedOptionIds =
      question.type === "MULTIPLE_CHOICE"
        ? checked
          ? Array.from(new Set([...current.selectedOptionIds, optionId]))
          : current.selectedOptionIds.filter((id) => id !== optionId)
        : [optionId];
    onAnswerChange({ ...answers, [question.id]: { ...current, selectedOptionIds } });
  }

  return (
    <article className="content-surface">
      <div className="section-header">
        <div>
          <p className="eyebrow">{attempt.questions.length} preguntas</p>
          <h2>Evaluación</h2>
        </div>
        <div className="quiz-actions">
          {attempt.attempt.dueAt && !submitted ? <span className="timer">{remaining}</span> : null}
          <button className="icon-button" onClick={onClose} title="Cerrar" type="button">
            <ChevronRight aria-hidden />
          </button>
        </div>
      </div>
      {attempt.questions.map((question) => (
        <fieldset className="question-block" disabled={submitted} key={question.id}>
          <legend>{question.prompt}</legend>
          {question.description ? <p>{question.description}</p> : null}
          {question.type === "FILL_IN_THE_BLANK" || question.type === "SHORT_TEXT" || question.type === "OPEN_ENDED" ? (
            <input
              value={answers[question.id]?.text ?? ""}
              onChange={(event) =>
                onAnswerChange({
                  ...answers,
                  [question.id]: { selectedOptionIds: answers[question.id]?.selectedOptionIds ?? [], text: event.target.value }
                })
              }
            />
          ) : (
            question.options.map((option) => (
              <label className="option-row" key={option.id}>
                <input
                  checked={(answers[question.id]?.selectedOptionIds ?? []).includes(option.id)}
                  name={question.id}
                  onChange={(event) => setQuestionAnswer(question, option.id, event.target.checked)}
                  type={question.type === "MULTIPLE_CHOICE" ? "checkbox" : "radio"}
                />
                {option.label}
              </label>
            ))
          )}
        </fieldset>
      ))}
      {submitted ? (
        <div className="result-strip">
          <strong>{attempt.attempt.status}</strong>
          <span>{attempt.attempt.scorePercent ?? 0}%</span>
        </div>
      ) : (
        <button className="primary-button" disabled={busy} onClick={onSubmit} type="button">
          <GraduationCap aria-hidden />
          Enviar evaluación
        </button>
      )}
    </article>
  );
}

function StatusPill({ label }: { label: string }) {
  return <span className={`status-pill ${label.toLowerCase().replaceAll(" ", "-")}`}>{label}</span>;
}

function useRemainingTime(dueAt: string | null) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  if (!dueAt) {
    return "";
  }

  const remainingMs = Math.max(0, new Date(dueAt).getTime() - now);
  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function youtubeEmbedUrl(url: string | null) {
  if (!url) {
    return null;
  }

  const shortMatch = url.match(/youtu\.be\/([^?&]+)/);
  const watchMatch = url.match(/[?&]v=([^?&]+)/);
  const id = shortMatch?.[1] ?? watchMatch?.[1];
  return id ? `https://www.youtube.com/embed/${id}` : url;
}

function sectionTitle(view: View) {
  switch (view) {
    case "report":
      return "Reporte de estudiantes";
    case "certificates":
      return "Diplomas";
    case "notifications":
      return "Notificaciones";
    case "courses":
    default:
      return "Cursos";
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
