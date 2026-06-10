"use client";

import {
  ArrowLeft,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
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
  UserRound,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { assetFileUrl } from "./apiClient";
import { AuthoringView } from "./authoring";
import { CompletedCourses, CourseReviews, TeachersDirectory } from "./panels";
import { UsersRolesAdmin } from "./usersAdmin";
import { CardSkeletonGrid } from "./ui";

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
  thumbnail: { id: string } | null;
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
  matchPool?: string[];
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

type AnswerState = Record<
  string,
  { selectedOptionIds: string[]; text: string; matches?: Record<string, string>; order?: string[] }
>;

type View = "courses" | "manage" | "report" | "certificates" | "notifications" | "teachers" | "completed" | "users";

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
  const [navOpen, setNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const isPrivileged = user?.roles.includes("ADMIN") || user?.roles.includes("TEACHER");
  const isAdmin = user?.roles.includes("ADMIN");
  // The learner view ("Cursos inscritos" / "Aprobados") is for students. An ADMIN
  // never sees it (they run the platform); but a TEACHER who is also enrolled as a
  // student still gets it, so multi-role users aren't locked out of their courses.
  const canLearn = Boolean(user?.roles.includes("STUDENT") && !isAdmin);
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

  // Land each role on the right home: admins/teachers manage the platform, students learn.
  useEffect(() => {
    if (!user) {
      return;
    }
    const privileged = user.roles.includes("ADMIN") || user.roles.includes("TEACHER");
    setView(privileged ? "manage" : "courses");
  }, [user]);

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
      setAnswers(
        Object.fromEntries(
          payload.questions.map((question) => [
            question.id,
            {
              selectedOptionIds: [],
              text: "",
              matches: {},
              order: question.type === "ORDERING" ? question.options.map((option) => option.id) : []
            }
          ])
        )
      );
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
              selectedOptionIds: answer.order && answer.order.length > 0 ? answer.order : answer.selectedOptionIds,
              text: answer.text,
              ...(answer.matches && Object.keys(answer.matches).length > 0
                ? { matches: Object.entries(answer.matches).map(([optionId, value]) => ({ optionId, value })) }
                : {})
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

  async function downloadCertificatePdf(certificateId: string, folio: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/certificates/${certificateId}/pdf`, {
        headers: token ? { authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        throw new Error("No se pudo generar el PDF del diploma");
      }
      downloadBlob(await response.blob(), `diploma-${folio}.pdf`);
    } catch (pdfError) {
      setError(errorMessage(pdfError));
    } finally {
      setBusy(false);
    }
  }

  async function exportReportExcel() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/reports/students/export.xlsx`, {
        headers: token ? { authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        throw new Error("No se pudo generar el Excel");
      }
      downloadBlob(await response.blob(), `reporte-colaboradores-${todayStamp()}.xlsx`);
    } catch (exportError) {
      setError(errorMessage(exportError));
    } finally {
      setBusy(false);
    }
  }

  function exportReportPdf() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("El navegador bloqueó la ventana emergente. Habilita las ventanas emergentes para exportar el PDF.");
      return;
    }
    printWindow.document.write(buildReportPrintHtml(reportRows, reportSummary));
    printWindow.document.close();
    printWindow.focus();
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
          <p>Tu plataforma de formación: cursos, evaluaciones y diplomas, en un solo lugar.</p>
          <dl>
            <div>
              <dt>Aprende a tu ritmo</dt>
              <dd>Accede a tus cursos, lecciones y videos cuando lo necesites.</dd>
            </div>
            <div>
              <dt>Obtén tu reconocimiento</dt>
              <dd>Presenta tus evaluaciones y descarga tus diplomas al aprobar.</dd>
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
      {navOpen ? (
        <button className="nav-backdrop" aria-label="Cerrar menú" onClick={() => setNavOpen(false)} type="button" />
      ) : null}
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <img className="sidebar-logo" src="/tsc-shield-light.png" alt="TSC" />
          <div>
            <strong>Capacita</strong>
            <small>Seguridad Privada</small>
          </div>
          <button className="icon-button nav-close" onClick={() => setNavOpen(false)} aria-label="Cerrar menú" type="button">
            <X aria-hidden />
          </button>
        </div>
        <nav className="nav-stack" aria-label="Secciones" onClick={() => setNavOpen(false)}>
          {canLearn ? (
            <NavButton active={view === "courses"} icon={<BookOpen aria-hidden />} label="Cursos inscritos" onClick={() => setView("courses")} />
          ) : null}
          {isPrivileged ? (
            <NavButton active={view === "manage"} icon={<Boxes aria-hidden />} label="Gestionar cursos" onClick={() => setView("manage")} />
          ) : null}
          {isPrivileged ? (
            <NavButton active={view === "report"} icon={<BarChart3 aria-hidden />} label="Reporte" onClick={() => setView("report")} />
          ) : null}
          {isPrivileged ? (
            <NavButton active={view === "teachers"} icon={<UserRound aria-hidden />} label="Instructores" onClick={() => setView("teachers")} />
          ) : null}
          {isAdmin ? (
            <NavButton active={view === "users"} icon={<ShieldCheck aria-hidden />} label="Usuarios y roles" onClick={() => setView("users")} />
          ) : null}
          <NavButton active={view === "certificates"} icon={<Award aria-hidden />} label="Diplomas" onClick={() => setView("certificates")} />
          {canLearn ? (
            <NavButton active={view === "completed"} icon={<GraduationCap aria-hidden />} label="Aprobados" onClick={() => setView("completed")} />
          ) : null}
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
          <div className="topbar-lead">
            <button className="nav-toggle" aria-label="Abrir menú" onClick={() => setNavOpen(true)} type="button">
              <span />
              <span />
              <span />
            </button>
            <div>
              <p className="eyebrow">{user.roles.map(roleLabel).join(" · ")}</p>
              <h1>{sectionTitle(view)}</h1>
            </div>
          </div>
          <div className="topbar-user">
            <button
              className="user-pill"
              onClick={() => setProfileOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              type="button"
            >
              <span className="avatar" aria-hidden>
                {initials(user.displayName)}
              </span>
              <span>{user.displayName}</span>
            </button>
            {profileOpen ? (
              <>
                <button
                  className="menu-backdrop"
                  aria-label="Cerrar menú"
                  onClick={() => setProfileOpen(false)}
                  type="button"
                />
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
                  <p className="profile-roles">{user.roles.map(roleLabel).join(" · ")}</p>
                  <button className="ghost-button profile-logout" onClick={logout} type="button">
                    <LogOut aria-hidden />
                    Salir
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        {view === "courses" && canLearn ? (
          selectedCourse ? (
            <section className="learner-detail">
              <div className="section-header">
                <button className="ghost-button" onClick={() => setSelectedCourse(null)} type="button">
                  <ArrowLeft aria-hidden /> Volver al catálogo
                </button>
              </div>
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

                  {token ? <CourseReviews token={token} courseId={selectedCourse.id} /> : null}
            </section>
          ) : (
            <section className="data-section">
              <div className="section-header">
                <h2>Cursos inscritos</h2>
                <button className="icon-button" disabled={busy} onClick={() => loadInitialData()} title="Actualizar" type="button">
                  <RefreshCw aria-hidden />
                </button>
              </div>
              {busy && courses.length === 0 ? (
                <CardSkeletonGrid count={6} />
              ) : courses.length === 0 ? (
                <p className="empty-state">Aún no tienes cursos asignados. Pídele acceso a tu administrador.</p>
              ) : (
                <div className="catalog-grid">
                  {courses.map((course) => (
                    <button className="course-card" key={course.id} onClick={() => loadCourse(course.id)} type="button">
                      <div className="course-card-cover">
                        {course.thumbnail ? (
                          <img
                            src={assetFileUrl(course.thumbnail.id)}
                            alt=""
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <BookOpen aria-hidden />
                        )}
                      </div>
                      <div className="course-card-body">
                        <strong>{course.title}</strong>
                        <small className="muted">{course.teacher?.displayName ?? "TSC Capacitación"}</small>
                        <small className="muted">
                          {course.counts.lessons} lecciones · {course.counts.quizzes} exámenes
                        </small>
                        <div className="course-card-progress">
                          <ProgressBar value={course.progressPercent ?? 0} />
                          <span>{Math.round(course.progressPercent ?? 0)}%</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )
        ) : null}

        {view === "manage" && isPrivileged && token ? (
          <AuthoringView token={token} isAdmin={Boolean(isAdmin)} />
        ) : null}

        {view === "teachers" && isPrivileged && token ? <TeachersDirectory token={token} /> : null}

        {view === "users" && isAdmin && token && user ? <UsersRolesAdmin token={token} currentUserId={user.id} /> : null}

        {view === "completed" && token ? <CompletedCourses token={token} /> : null}

        {view === "report" && isPrivileged ? (
          <section className="data-section">
            <div className="section-header">
              <h2>Reporte de colaboradores</h2>
              <div className="quiz-actions">
                <button className="icon-button" disabled={busy} onClick={loadReport} title="Actualizar" type="button">
                  <RefreshCw aria-hidden />
                </button>
                <button className="secondary-button" disabled={busy || reportRows.length === 0} onClick={exportReportExcel} type="button">
                  <Download aria-hidden />
                  Excel
                </button>
                <button className="secondary-button" disabled={reportRows.length === 0} onClick={exportReportPdf} type="button">
                  <FileText aria-hidden />
                  PDF
                </button>
              </div>
            </div>
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
                  <div className="tile-actions">
                    <button className="icon-button" disabled={busy} onClick={() => openCertificate(certificate.id)} title="Ver diploma" type="button">
                      <FileText aria-hidden />
                    </button>
                    <button className="icon-button" disabled={busy} onClick={() => downloadCertificatePdf(certificate.id, certificate.folio)} title="Descargar PDF" type="button">
                      <Download aria-hidden />
                    </button>
                  </div>
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
          <p className="eyebrow">{lessonKindLabel(lesson)}</p>
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
                  [question.id]: { ...(answers[question.id] ?? { selectedOptionIds: [], text: "" }), text: event.target.value }
                })
              }
            />
          ) : question.type === "MATCHING" ? (
            <MatchingInput question={question} answers={answers} onAnswerChange={onAnswerChange} />
          ) : question.type === "ORDERING" ? (
            <OrderingInput question={question} answers={answers} onAnswerChange={onAnswerChange} />
          ) : (
            question.options.map((option) => (
              <label className="option-row" key={option.id}>
                <input
                  checked={(answers[question.id]?.selectedOptionIds ?? []).includes(option.id)}
                  name={question.id}
                  onChange={(event) => setQuestionAnswer(question, option.id, event.target.checked)}
                  type={question.type === "MULTIPLE_CHOICE" ? "checkbox" : "radio"}
                />
                {option.label || option.value}
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

function MatchingInput({
  question,
  answers,
  onAnswerChange
}: {
  question: QuizQuestion;
  answers: AnswerState;
  onAnswerChange: (answers: AnswerState) => void;
}) {
  const current = answers[question.id]?.matches ?? {};
  function setMatch(optionId: string, value: string) {
    const prev = answers[question.id] ?? { selectedOptionIds: [], text: "" };
    onAnswerChange({
      ...answers,
      [question.id]: { ...prev, matches: { ...(prev.matches ?? {}), [optionId]: value } }
    });
  }
  return (
    <div className="match-input">
      {question.options.map((option) => (
        <div className="match-row" key={option.id}>
          <span>{option.value}</span>
          <select value={current[option.id] ?? ""} onChange={(event) => setMatch(option.id, event.target.value)}>
            <option value="">Elegir…</option>
            {(question.matchPool ?? []).map((match) => (
              <option key={match} value={match}>{match}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function OrderingInput({
  question,
  answers,
  onAnswerChange
}: {
  question: QuizQuestion;
  answers: AnswerState;
  onAnswerChange: (answers: AnswerState) => void;
}) {
  const order = answers[question.id]?.order ?? question.options.map((option) => option.id);
  const byId = new Map(question.options.map((option) => [option.id, option]));
  function move(index: number, delta: number) {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) {
      return;
    }
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    const prev = answers[question.id] ?? { selectedOptionIds: [], text: "" };
    onAnswerChange({ ...answers, [question.id]: { ...prev, order: next } });
  }
  return (
    <div className="order-input">
      {order.map((id, index) => (
        <div className="order-row" key={id}>
          <span className="order-num">{index + 1}</span>
          <span className="order-text">{byId.get(id)?.value ?? ""}</span>
          <span className="order-controls">
            <button type="button" className="icon-button" onClick={() => move(index, -1)} title="Subir">↑</button>
            <button type="button" className="icon-button" onClick={() => move(index, 1)} title="Bajar">↓</button>
          </span>
        </div>
      ))}
    </div>
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

function lessonKindLabel(lesson: { kind: string; videoUrl: string | null }) {
  if (lesson.videoUrl || lesson.kind === "VIDEO") {
    return "Video";
  }
  switch (lesson.kind) {
    case "ASSIGNMENT":
      return "Tarea";
    case "QUIZ":
      return "Evaluación";
    default:
      return "Lección";
  }
}

function roleLabel(role: string) {
  switch (role) {
    case "ADMIN":
      return "Administrador";
    case "TEACHER":
      return "Instructor";
    case "STUDENT":
      return "Colaborador";
    default:
      return role;
  }
}

function sectionTitle(view: View) {
  switch (view) {
    case "manage":
      return "Gestionar cursos";
    case "report":
      return "Reporte de colaboradores";
    case "teachers":
      return "Instructores";
    case "users":
      return "Usuarios y roles";
    case "certificates":
      return "Diplomas";
    case "completed":
      return "Cursos aprobados";
    case "notifications":
      return "Notificaciones";
    case "courses":
    default:
      return "Cursos inscritos";
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildReportPrintHtml(rows: ReportRow[], summary: Record<string, number>) {
  const issuedAt = new Date().toLocaleDateString("es-MX", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const summaryCards = Object.entries(summary)
    .map(
      ([label, value]) =>
        `<div class="card"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`
    )
    .join("");

  const tableRows = rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.studentName)}<br><small>${escapeHtml(row.email)}</small></td>
        <td>${escapeHtml(row.serviceLabel ?? "Sin servicio")}</td>
        <td>${escapeHtml(row.courseTitle)}</td>
        <td class="num">${row.progressPercent ?? 0}%</td>
        <td>${escapeHtml(row.status)}</td>
        <td class="num">${row.latestAttempt?.scorePercent ?? "N/D"}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Reporte de colaboradores TSC</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #131a2e; margin: 24px; }
  header { display: flex; align-items: center; gap: 14px; border-bottom: 3px solid #131a33; padding-bottom: 12px; margin-bottom: 16px; }
  header img { height: 54px; }
  header h1 { margin: 0; font-size: 20px; }
  header p { margin: 2px 0 0; color: #5d6b82; font-size: 12px; }
  .summary { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .card { border: 1px solid #dbe2ec; border-radius: 8px; padding: 8px 12px; min-width: 120px; }
  .card span { display: block; color: #5d6b82; font-size: 11px; text-transform: uppercase; }
  .card strong { font-size: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #131a33; color: #fff; text-align: left; padding: 8px; font-size: 11px; text-transform: uppercase; }
  td { border-bottom: 1px solid #e2e8f0; padding: 7px 8px; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; }
  small { color: #5d6b82; }
  .toolbar { text-align: right; margin-bottom: 12px; }
  .toolbar button { background: #8c1713; color: #fff; border: 0; border-radius: 6px; padding: 9px 16px; font-weight: 700; cursor: pointer; }
  @media print { .no-print { display: none !important; } body { margin: 10mm; } }
</style>
</head>
<body onload="setTimeout(function(){ window.print(); }, 300)">
  <div class="toolbar no-print"><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
  <header>
    <img src="${escapeHtml(typeof window !== "undefined" ? window.location.origin : "")}/tsc-logo.png" alt="TSC" onerror="this.remove()">
    <div>
      <h1>Reporte de colaboradores</h1>
      <p>TSC Capacita &middot; Generado el ${issuedAt} &middot; ${rows.length} registros</p>
    </div>
  </header>
  <div class="summary">${summaryCards}</div>
  <table>
    <thead>
      <tr><th>Colaborador</th><th>Servicio</th><th>Curso</th><th>Avance</th><th>Estado</th><th>Puntaje</th></tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;
}
