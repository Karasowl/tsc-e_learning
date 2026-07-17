"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  Clock,
  Download,
  FileText,
  GraduationCap,
  LogOut,
  Mail,
  Moon,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  UserRound,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { assetFileUrl, downloadAsset } from "./apiClient";
import { AuthoringView } from "./authoring";
import { AdminOpsCenter } from "./opsCenter";
import { TeacherConsole } from "./teacherConsole";
import { CompletedCourses, CourseReviews, ProfileView, TeachersDirectory } from "./panels";
import { UsersRolesAdmin } from "./usersAdmin";
import { CardSkeletonGrid, toast } from "./ui";
import {
  AchievementsTab,
  AscendOverlay,
  GuardTabBar,
  GuardTopBar,
  RankTab,
  type BadgesPayload,
  type GuardIdentity,
  type GuardTab,
  type MeProgress
} from "./guardApp";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

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
  level: string | null;
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

type View = "courses" | "manage" | "report" | "certificates" | "notifications" | "teachers" | "completed" | "users" | "profile";

// Bloque de gamificación que devuelven /lessons/:id/complete y /certificates/issue.
type Gamification = { xpDelta: number; xpTotal: number; ascended: boolean; rankName: string };

type ReportSortKey = "studentName" | "serviceLabel" | "courseTitle" | "progressPercent" | "status" | "scorePercent";

const REPORT_PAGE_SIZE = 25;

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
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  // Gamificación de la cáscara del guardia (solo STUDENT puro).
  const [progress, setProgress] = useState<MeProgress | null>(null);
  const [badges, setBadges] = useState<BadgesPayload | null>(null);
  const [identity, setIdentity] = useState<GuardIdentity | null>(null);
  const [guardTab, setGuardTab] = useState<GuardTab>("rank");
  const [ascend, setAscend] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<"all" | "in-progress" | "not-started" | "completed">("all");
  // Ids de cursos cuya portada migrada no cargó: caemos al placeholder de marca.
  const [coverFailed, setCoverFailed] = useState<Set<string>>(new Set());
  const markCoverFailed = useCallback((courseId: string) => {
    setCoverFailed((prev) => {
      if (prev.has(courseId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(courseId);
      return next;
    });
  }, []);
  const [reportQuery, setReportQuery] = useState("");
  const [reportStatusFilter, setReportStatusFilter] = useState("");
  const [reportSort, setReportSort] = useState<{ key: ReportSortKey; dir: "asc" | "desc" }>({ key: "studentName", dir: "asc" });
  const [reportPage, setReportPage] = useState(1);

  const isPrivileged = user?.roles.includes("ADMIN") || user?.roles.includes("TEACHER");
  const isAdmin = user?.roles.includes("ADMIN");
  // Estudiante "puro": solo STUDENT (sin TEACHER/ADMIN). Recibe la cáscara móvil
  // del guardia. Cualquier usuario con rol privilegiado conserva el shell actual
  // intacto, aunque también esté inscrito como estudiante.
  const isPureStudent = Boolean(
    user?.roles.includes("STUDENT") &&
      !user?.roles.includes("TEACHER") &&
      !user?.roles.includes("ADMIN")
  );
  // Instructor "puro": TEACHER sin ADMIN. Recibe la CONSOLA del instructor (sin
  // sidebar, de marca). Un ADMIN (aunque también sea instructor) conserva el
  // shell de administración completo. Espeja la lógica de isPureStudent.
  const isPureTeacher = Boolean(
    user?.roles.includes("TEACHER") && !user?.roles.includes("ADMIN")
  );
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

  const flatLessons = useMemo(
    () => (selectedCourse ? selectedCourse.modules.flatMap((module) => module.lessons) : []),
    [selectedCourse]
  );
  const activeLessonIndex = flatLessons.findIndex((lesson) => lesson.id === activeLessonId);

  const visibleCourses = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    return courses.filter((course) => {
      if (q && !course.title.toLowerCase().includes(q)) {
        return false;
      }
      const percent = course.progressPercent ?? 0;
      if (catalogFilter === "in-progress") {
        return percent > 0 && percent < 100;
      }
      if (catalogFilter === "not-started") {
        return percent <= 0;
      }
      if (catalogFilter === "completed") {
        return percent >= 100;
      }
      return true;
    });
  }, [courses, catalogQuery, catalogFilter]);

  const continueCourse = useMemo(
    () => courses.find((course) => (course.progressPercent ?? 0) > 0 && (course.progressPercent ?? 0) < 100) ?? null,
    [courses]
  );

  const filteredReportRows = useMemo(() => {
    const q = reportQuery.trim().toLowerCase();
    const rows = reportRows.filter((row) => {
      if (reportStatusFilter && row.status !== reportStatusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        row.studentName.toLowerCase().includes(q) ||
        row.email.toLowerCase().includes(q) ||
        (row.serviceLabel ?? "").toLowerCase().includes(q) ||
        row.courseTitle.toLowerCase().includes(q)
      );
    });
    const dir = reportSort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = reportSortValue(a, reportSort.key);
      const bv = reportSortValue(b, reportSort.key);
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv), "es") * dir;
    });
  }, [reportRows, reportQuery, reportStatusFilter, reportSort]);

  const reportTotalPages = Math.max(1, Math.ceil(filteredReportRows.length / REPORT_PAGE_SIZE));
  const reportPageClamped = Math.min(reportPage, reportTotalPages);
  const pagedReportRows = filteredReportRows.slice(
    (reportPageClamped - 1) * REPORT_PAGE_SIZE,
    reportPageClamped * REPORT_PAGE_SIZE
  );

  function toggleReportSort(key: ReportSortKey) {
    setReportSort((current) =>
      current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
    setReportPage(1);
  }

  function goToLesson(delta: number) {
    const next = flatLessons[activeLessonIndex + delta];
    if (next) {
      setQuizAttempt(null);
      setActiveLessonId(next.id);
    }
  }

  useEffect(() => {
    const storedToken = window.localStorage.getItem("tsc_token");
    const storedUser = window.localStorage.getItem("tsc_user");
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser) as User);
    }
  }, []);

  useEffect(() => {
    // Dark-first: sin data-theme = oscuro; solo 'light' explícito activa el papel.
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
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
      if (response.status === 401 && token) {
        window.localStorage.removeItem("tsc_token");
        window.localStorage.removeItem("tsc_user");
        window.location.reload();
      }
      const body = await response.json().catch(() => ({ error: response.statusText })) as { error?: unknown };
      throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async function loadInitialData(authToken = token) {
    if (!authToken) {
      return;
    }
    // Admins render the self-fetching Ops-Center shell, so Home's data loads
    // (courses/certificates/report/notifications) would be redundant work.
    if (user?.roles.includes("ADMIN")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const coursePayload = await api<{ courses: CourseSummary[] }>("/courses");
      setCourses(coursePayload.courses);
      await loadCertificates();
      if (isPureStudent) {
        await loadGamification();
      }
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

  const loginWithGoogle = useCallback(async (credential: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/auth/google`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({ error: "" }))) as { error?: unknown };
        throw new Error(
          typeof body.error === "string" && body.error ? body.error : "No se pudo iniciar sesión con Google"
        );
      }
      const body = (await response.json()) as { token: string; user: User };
      window.localStorage.setItem("tsc_token", body.token);
      window.localStorage.setItem("tsc_user", JSON.stringify(body.user));
      setToken(body.token);
      setUser(body.user);
    } catch (googleError) {
      setError(errorMessage(googleError));
    } finally {
      setBusy(false);
    }
  }, []);

  // preserveAttempt: se usa tras enviar un examen para NO borrar la pantalla de
  // resultado (QuizResult) ni resetear los datos del examen mientras se refresca
  // el temario/inscripción. Además, la lección activa se conserva si sigue
  // existiendo tras recargar (G-06): solo cae a la primera cuando no hay una
  // lección activa válida (p. ej. al abrir un curso distinto).
  async function loadCourse(courseId: string, options?: { preserveAttempt?: boolean }) {
    setError(null);
    const payload = await api<{ course: CourseDetail }>(`/courses/${courseId}`);
    setSelectedCourse(payload.course);
    const lessons = payload.course.modules.flatMap((module) => module.lessons);
    setActiveLessonId((current) =>
      current && lessons.some((lesson) => lesson.id === current) ? current : lessons[0]?.id ?? null
    );
    if (!options?.preserveAttempt) {
      setQuizAttempt(null);
      setAnswers({});
    }
  }

  async function loadCertificates() {
    const payload = await api<{ certificates: Certificate[] }>("/certificates");
    setCertificates(payload.certificates);
  }

  async function loadProgress() {
    const payload = await api<MeProgress>("/me/progress");
    setProgress(payload);
  }

  async function loadGamification() {
    // Identidad (employeeCode/serviceLabel), XP/rango y catálogo de insignias.
    const [me, prog, badgePayload] = await Promise.all([
      api<{ user: GuardIdentity }>("/me"),
      api<MeProgress>("/me/progress"),
      api<BadgesPayload>("/me/badges")
    ]);
    setIdentity(me.user);
    setProgress(prog);
    setBadges(badgePayload);
  }

  // Aplica el bloque de gamificación de una respuesta (toast de XP + ascenso) y
  // refresca el progreso. Solo para el estudiante puro (cáscara del guardia).
  async function applyGamification(gamification?: Gamification) {
    if (!isPureStudent) {
      return;
    }
    await loadProgress().catch(() => undefined);
    await api<BadgesPayload>("/me/badges")
      .then(setBadges)
      .catch(() => undefined);
    if (gamification && gamification.xpDelta > 0) {
      toast.success(`+${gamification.xpDelta} XP`);
    }
    if (gamification?.ascended) {
      setAscend(gamification.rankName);
    }
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
      const result = await api<{ gamification?: Gamification }>(`/lessons/${lessonId}/complete`, {
        method: "POST",
        body: "{}"
      });
      if (selectedCourse) {
        await loadCourse(selectedCourse.id);
      }
      await loadCertificates();
      await applyGamification(result.gamification);
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
        // Refresca temario/progreso e inscripción (para que aparezca el CTA de
        // diploma si el curso quedó completo) SIN borrar el resultado recién
        // enviado: QuizResult permanece hasta que el usuario pulse "Volver al
        // curso". Reintentar sigue creando un intento nuevo.
        await loadCourse(selectedCourse.id, { preserveAttempt: true });
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
      const result = await api<{ gamification?: Gamification }>("/certificates/issue", {
        method: "POST",
        body: JSON.stringify({ courseId })
      });
      await loadCertificates();
      if (isPureStudent) {
        // El guardia se queda en el curso; el toast confirma el diploma + XP.
        toast.success("Diploma reclamado");
        await applyGamification(result.gamification);
      } else {
        setView("certificates");
      }
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

  async function retryFailedNotifications() {
    setBusy(true);
    setError(null);
    try {
      const { requeued } = await api<{ requeued: number }>("/notifications/retry", { method: "POST", body: "{}" });
      if (requeued > 0) {
        await api("/notifications/process?limit=100", { method: "POST", body: "{}" });
        toast.success(`${requeued} correo${requeued === 1 ? "" : "s"} reencolado${requeued === 1 ? "" : "s"} para reenvío.`);
      } else {
        toast.info("No hay correos fallidos por reintentar.");
      }
      await loadNotifications();
    } catch (notificationError) {
      setError(errorMessage(notificationError));
    } finally {
      setBusy(false);
    }
  }

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      // Oscuro es el default: se activa quitando el atributo (no como valor).
      if (next === "light") {
        document.documentElement.dataset.theme = "light";
      } else {
        delete document.documentElement.dataset.theme;
      }
      window.localStorage.setItem("tsc_theme", next);
      return next;
    });
  }

  function updateDisplayName(displayName: string) {
    setUser((current) => {
      if (!current) {
        return current;
      }
      const next = { ...current, displayName };
      window.localStorage.setItem("tsc_user", JSON.stringify(next));
      return next;
    });
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
    setProgress(null);
    setBadges(null);
    setIdentity(null);
    setGuardTab("rank");
  }

  // Tab "Cursos" de la cáscara del guardia: reutiliza el catálogo real, el
  // detalle del curso, el reproductor de lección y el MOTOR DE EXAMEN existentes
  // (LessonPanel / QuizPanel). Solo cambia el envoltorio de presentación móvil.
  function renderCoursesTab() {
    if (!token) {
      return null;
    }
    if (selectedCourse) {
      return (
        <section className="guard-course-detail">
          <button className="guard-back" onClick={() => setSelectedCourse(null)} type="button">
            <ArrowLeft aria-hidden /> Volver a cursos
          </button>
          <div className="guard-course-head">
            <p className="eyebrow">{selectedCourse.teacher?.displayName ?? "TSC Capacitación"}</p>
            <h2>{selectedCourse.title}</h2>
            <div className="guard-course-progress">
              <ProgressBar value={selectedCourse.enrollment?.progressPercent ?? 0} />
              <span className="mono-label">{Math.round(selectedCourse.enrollment?.progressPercent ?? 0)}%</span>
            </div>
          </div>

          <div className="guard-curriculum">
            {selectedCourse.modules.map((module) => (
              <div className="module-block" key={module.id}>
                <h3>{module.title}</h3>
                {module.lessons.map((lesson) => (
                  <button
                    className={`lesson-row ${activeLessonId === lesson.id ? "active" : ""}`}
                    key={lesson.id}
                    onClick={() => {
                      setQuizAttempt(null);
                      setActiveLessonId(lesson.id);
                    }}
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

          <div className="guard-lesson-panel">
            {quizAttempt ? (
              <QuizPanel
                answers={answers}
                attempt={quizAttempt}
                busy={busy}
                onAnswerChange={setAnswers}
                onClose={() => setQuizAttempt(null)}
                onSubmit={submitQuiz}
                onRetry={startQuiz}
              />
            ) : activeLesson ? (
              <LessonPanel
                lesson={activeLesson}
                token={token}
                onComplete={completeLesson}
                onPrev={() => goToLesson(-1)}
                onNext={() => goToLesson(1)}
                hasPrev={activeLessonIndex > 0}
                hasNext={activeLessonIndex >= 0 && activeLessonIndex < flatLessons.length - 1}
              />
            ) : (
              <p className="empty-state">Selecciona una lección.</p>
            )}
          </div>

          {(() => {
            // Si el diploma ya fue emitido, el guardia lo abre y lo descarga aquí
            // mismo (reutilizando openCertificate/downloadCertificatePdf) y el CTA
            // deja de decir "Reclamar" en bucle. Si el curso está completo y aún no
            // hay diploma, se reclama; si no, se guía a aprobar el examen.
            const diploma = certificates.find((certificate) => certificate.course.id === selectedCourse.id);
            if (diploma) {
              return (
                <div className="quiz-result-actions">
                  <button className="btn btn--brand" disabled={busy} onClick={() => openCertificate(diploma.id)} type="button">
                    <Award aria-hidden />
                    Ver diploma
                  </button>
                  <button
                    className="btn btn--ghost"
                    disabled={busy}
                    onClick={() => downloadCertificatePdf(diploma.id, diploma.folio)}
                    type="button"
                  >
                    <Download aria-hidden />
                    Descargar PDF
                  </button>
                </div>
              );
            }
            if (selectedCourse.enrollment?.status === "COMPLETED") {
              return (
                <button
                  className="btn btn--brand guard-claim"
                  disabled={busy}
                  onClick={() => issueCertificate(selectedCourse.id)}
                  type="button"
                >
                  <Award aria-hidden />
                  Reclamar diploma
                </button>
              );
            }
            if ((selectedCourse.enrollment?.progressPercent ?? 0) >= 100) {
              return <p className="empty-state">Aprueba el examen del curso para obtener tu diploma.</p>;
            }
            return null;
          })()}

          <CourseReviews token={token} courseId={selectedCourse.id} />
        </section>
      );
    }
    return (
      <section className="guard-catalog">
        <div className="guard-block-head">
          <h3>Tus cursos</h3>
          <button className="icon-button" disabled={busy} onClick={() => loadInitialData()} title="Actualizar" type="button">
            <RefreshCw aria-hidden />
          </button>
        </div>
        {courses.length > 0 ? (
          <div className="catalog-toolbar">
            <div className="search-field">
              <Search aria-hidden />
              <input
                type="search"
                placeholder="Buscar curso…"
                value={catalogQuery}
                onChange={(event) => setCatalogQuery(event.target.value)}
                aria-label="Buscar curso"
              />
            </div>
            <div className="filter-chips" role="group" aria-label="Filtrar cursos">
              {([
                { key: "all", label: "Todos" },
                { key: "in-progress", label: "En curso" },
                { key: "not-started", label: "Sin iniciar" },
                { key: "completed", label: "Aprobados" }
              ] as const).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`filter-chip ${catalogFilter === option.key ? "active" : ""}`}
                  onClick={() => setCatalogFilter(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {busy && courses.length === 0 ? (
          <CardSkeletonGrid count={4} />
        ) : courses.length === 0 ? (
          <p className="empty-state">Aún no tienes cursos asignados. Pídele acceso a tu administrador.</p>
        ) : visibleCourses.length === 0 ? (
          <p className="empty-state">No hay cursos que coincidan con tu búsqueda.</p>
        ) : (
          <div className="guard-course-list">
            {visibleCourses.map((course) => {
              const percent = Math.round(course.progressPercent ?? 0);
              const tag =
                percent >= 100
                  ? { label: "APROBADO", cls: "pill--ok" }
                  : percent > 0
                    ? { label: `EN CURSO · ${percent}%`, cls: "pill--watch" }
                    : { label: "SIN INICIAR", cls: "" };
              return (
                <button
                  className="guard-course-card"
                  key={course.id}
                  onClick={() => loadCourse(course.id)}
                  type="button"
                  aria-label={`Abrir curso ${course.title}`}
                >
                  <CourseCover
                    thumbnail={course.thumbnail}
                    title={course.title}
                    failed={coverFailed.has(course.id)}
                    onFailed={() => markCoverFailed(course.id)}
                    variant="card"
                  />
                  <div className="guard-course-card-body">
                    <span className={`pill ${tag.cls}`}>{tag.label}</span>
                    <strong>{course.title}</strong>
                    <small className="mono-label">
                      {course.counts.lessons} lecciones · {course.counts.quizzes} exámenes
                    </small>
                    <div className="guard-course-progress">
                      <ProgressBar value={course.progressPercent ?? 0} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  if (isPureStudent && token && user) {
    return (
      <main className="guard-shell">
        <GuardTopBar user={user} identity={identity} progress={progress} />
        <div className="guard-scroll">
          {error ? <div className="error-banner">{error}</div> : null}
          {guardTab === "rank" ? (
            <RankTab
              progress={progress}
              continueCourse={continueCourse}
              onContinue={(courseId) => {
                setGuardTab("courses");
                void loadCourse(courseId);
              }}
              onGoCourses={() => setGuardTab("courses")}
            />
          ) : null}
          {guardTab === "courses" ? renderCoursesTab() : null}
          {guardTab === "achievements" ? <AchievementsTab badges={badges} progress={progress} /> : null}
          {guardTab === "profile" ? (
            <ProfileView
              token={token}
              onProfileUpdated={updateDisplayName}
              rank={progress ? { name: progress.rank.name, level: progress.rank.level, xp: progress.xp } : null}
              onLogout={logout}
            />
          ) : null}
        </div>
        <GuardTabBar active={guardTab} onChange={setGuardTab} />
        <AscendOverlay rankName={ascend} onDismiss={() => setAscend(null)} />
      </main>
    );
  }

  if (isPureTeacher && token && user) {
    return (
      <TeacherConsole
        token={token}
        user={user}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={logout}
        onDisplayName={updateDisplayName}
      />
    );
  }

  // Admin (rol ADMIN) aterriza en el Centro de Operaciones de marca. Espeja la
  // ramificación de isPureStudent / isPureTeacher; no toca esas cáscaras ni el
  // app-shell heredado (que queda como respaldo para cuentas sin rol).
  if (isAdmin && token && user) {
    return (
      <AdminOpsCenter
        token={token}
        user={user}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={logout}
      />
    );
  }

  if (!token || !user) {
    return (
      <main className="login-screen">
        <section className="login-copy">
          <img className="brand-logo" src="/tsc-logo.png" alt="TSC Private Security Consulting" />
          <h1>Capacitación TSC</h1>
          <p>Plataforma de capacitación de TSC. Inicia sesión para continuar tu formación en seguridad privada.</p>
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
          {GOOGLE_CLIENT_ID ? (
            <>
              <div className="auth-divider">
                <span>o</span>
              </div>
              <GoogleSignIn clientId={GOOGLE_CLIENT_ID} onCredential={loginWithGoogle} />
            </>
          ) : null}
          <DiplomaVerifier />
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
          <div className="topbar-actions">
            <button className="icon-button theme-toggle" onClick={toggleTheme} type="button" aria-label="Cambiar tema" title="Cambiar tema">
              {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
            </button>
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
                  <button
                    className="ghost-button profile-link"
                    onClick={() => {
                      setView("profile");
                      setProfileOpen(false);
                    }}
                    type="button"
                  >
                    <UserRound aria-hidden />
                    Mi perfil
                  </button>
                  <button className="ghost-button profile-logout" onClick={logout} type="button">
                    <LogOut aria-hidden />
                    Salir
                  </button>
                </div>
              </>
            ) : null}
          </div>
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
                      {courseLevelLabel(selectedCourse.level) ? (
                        <span className="course-level-chip">Nivel {courseLevelLabel(selectedCourse.level)}</span>
                      ) : null}
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
                          onRetry={startQuiz}
                        />
                      ) : activeLesson ? (
                        <LessonPanel
                          lesson={activeLesson}
                          token={token}
                          onComplete={completeLesson}
                          onPrev={() => goToLesson(-1)}
                          onNext={() => goToLesson(1)}
                          hasPrev={activeLessonIndex > 0}
                          hasNext={activeLessonIndex >= 0 && activeLessonIndex < flatLessons.length - 1}
                        />
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
                  ) : (selectedCourse.enrollment?.progressPercent ?? 0) >= 100 ? (
                    <p className="empty-state">Aprueba el examen del curso para obtener tu diploma.</p>
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
              {continueCourse ? (
                <div className="continue-card">
                  <CourseCover
                    thumbnail={continueCourse.thumbnail}
                    title={continueCourse.title}
                    failed={coverFailed.has(continueCourse.id)}
                    onFailed={() => markCoverFailed(continueCourse.id)}
                    variant="continue"
                  />
                  <div className="continue-body">
                    <p className="eyebrow">Continuar aprendiendo</p>
                    <strong>{continueCourse.title}</strong>
                    <div className="course-card-progress">
                      <ProgressBar value={continueCourse.progressPercent ?? 0} />
                      <span>{Math.round(continueCourse.progressPercent ?? 0)}%</span>
                    </div>
                  </div>
                  <button className="primary-button" onClick={() => loadCourse(continueCourse.id)} type="button">
                    <Play aria-hidden /> Continuar
                  </button>
                </div>
              ) : null}
              {courses.length > 0 ? (
                <div className="catalog-toolbar">
                  <div className="search-field">
                    <Search aria-hidden />
                    <input
                      type="search"
                      placeholder="Buscar curso…"
                      value={catalogQuery}
                      onChange={(event) => setCatalogQuery(event.target.value)}
                      aria-label="Buscar curso"
                    />
                  </div>
                  <div className="filter-chips" role="group" aria-label="Filtrar cursos">
                    {([
                      { key: "all", label: "Todos" },
                      { key: "in-progress", label: "En progreso" },
                      { key: "not-started", label: "Sin iniciar" },
                      { key: "completed", label: "Aprobados" }
                    ] as const).map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        className={`filter-chip ${catalogFilter === option.key ? "active" : ""}`}
                        onClick={() => setCatalogFilter(option.key)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {busy && courses.length === 0 ? (
                <CardSkeletonGrid count={6} />
              ) : courses.length === 0 ? (
                <p className="empty-state">Aún no tienes cursos asignados. Pídele acceso a tu administrador.</p>
              ) : visibleCourses.length === 0 ? (
                <p className="empty-state">No hay cursos que coincidan con tu búsqueda.</p>
              ) : (
                <div className="catalog-grid">
                  {visibleCourses.map((course) => (
                    <button
                      className="course-card"
                      key={course.id}
                      onClick={() => loadCourse(course.id)}
                      type="button"
                      aria-label={`Abrir curso ${course.title}`}
                    >
                      <CourseCover
                        thumbnail={course.thumbnail}
                        title={course.title}
                        failed={coverFailed.has(course.id)}
                        onFailed={() => markCoverFailed(course.id)}
                        variant="card"
                      />
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

        {view === "profile" && token ? <ProfileView token={token} onProfileUpdated={updateDisplayName} /> : null}

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
                <div className={`metric ${metricClass(label)}`} key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            {reportRows.length > 0 ? (
              <div className="catalog-toolbar">
                <div className="search-field">
                  <Search aria-hidden />
                  <input
                    type="search"
                    placeholder="Buscar colaborador, servicio o curso…"
                    value={reportQuery}
                    onChange={(event) => {
                      setReportQuery(event.target.value);
                      setReportPage(1);
                    }}
                    aria-label="Buscar en el reporte"
                  />
                </div>
                <div className="filter-chips" role="group" aria-label="Filtrar por resultado">
                  <button
                    type="button"
                    className={`filter-chip ${reportStatusFilter === "" ? "active" : ""}`}
                    onClick={() => {
                      setReportStatusFilter("");
                      setReportPage(1);
                    }}
                  >
                    Todos
                  </button>
                  {Object.keys(reportSummary).map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={`filter-chip ${reportStatusFilter === status ? "active" : ""}`}
                      onClick={() => {
                        setReportStatusFilter(status);
                        setReportPage(1);
                      }}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortHeader label="Colaborador" sortKey="studentName" sort={reportSort} onSort={toggleReportSort} />
                    <SortHeader label="Servicio" sortKey="serviceLabel" sort={reportSort} onSort={toggleReportSort} />
                    <SortHeader label="Curso" sortKey="courseTitle" sort={reportSort} onSort={toggleReportSort} />
                    <SortHeader label="Avance" sortKey="progressPercent" sort={reportSort} onSort={toggleReportSort} />
                    <SortHeader label="Resultado" sortKey="status" sort={reportSort} onSort={toggleReportSort} />
                    <SortHeader label="Puntaje" sortKey="scorePercent" sort={reportSort} onSort={toggleReportSort} />
                  </tr>
                </thead>
                <tbody>
                  {pagedReportRows.map((row, index) => (
                    <tr key={`${row.email}-${row.courseTitle}-${index}`}>
                      <td>
                        <strong>{row.studentName}</strong>
                        <small>{row.email}</small>
                      </td>
                      <td>{row.serviceLabel ?? "Sin servicio"}</td>
                      <td>{row.courseTitle}</td>
                      <td>{row.progressPercent ?? 0}%</td>
                      <td><StatusPill label={row.status} /></td>
                      <td>{row.latestAttempt?.scorePercent != null ? `${row.latestAttempt.scorePercent}%` : "N/D"}</td>
                    </tr>
                  ))}
                  {filteredReportRows.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <p className="empty-state">No hay filas que coincidan con el filtro.</p>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {reportTotalPages > 1 ? (
              <div className="pagination">
                <button
                  className="secondary-button"
                  disabled={reportPageClamped <= 1}
                  onClick={() => setReportPage((page) => Math.max(1, page - 1))}
                  type="button"
                >
                  Anterior
                </button>
                <span>
                  Página {reportPageClamped} de {reportTotalPages} · {filteredReportRows.length} filas
                </span>
                <button
                  className="secondary-button"
                  disabled={reportPageClamped >= reportTotalPages}
                  onClick={() => setReportPage((page) => Math.min(reportTotalPages, page + 1))}
                  type="button"
                >
                  Siguiente
                </button>
              </div>
            ) : null}
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
                <div className="quiz-actions">
                  <button className="ghost-button" disabled={busy} onClick={retryFailedNotifications} type="button">
                    <RefreshCw aria-hidden />
                    Reintentar fallidos
                  </button>
                  <button className="secondary-button" disabled={busy} onClick={processNotifications} type="button">
                    <RefreshCw aria-hidden />
                    Procesar pendientes
                  </button>
                </div>
              </div>
              <div className="rule-list">
                {notificationRules.map((rule) => (
                  <div className="rule-row" key={rule.id}>
                    <Bell aria-hidden />
                    <span>{notificationEventLabel(rule.eventType)}</span>
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
                        <td>{notificationEventLabel(log.eventType)}</td>
                        <td><StatusPill label={notificationStatusLabel(log.status)} /></td>
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
  if (!value) {
    return value;
  }
  const text = value.toLowerCase().replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function notificationEventLabel(value: string) {
  return NOTIFICATION_EVENT_LABELS[value] ?? humanizeEnum(value);
}

function notificationStatusLabel(value: string) {
  return NOTIFICATION_STATUS_LABELS[value] ?? humanizeEnum(value);
}

function GoogleSignIn({
  clientId,
  onCredential
}: {
  clientId: string;
  onCredential: (credential: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = window as unknown as {
      google?: {
        accounts: {
          id: {
            initialize: (options: unknown) => void;
            renderButton: (element: HTMLElement, options: unknown) => void;
          };
        };
      };
    };
    function render() {
      if (!w.google || !containerRef.current) {
        return;
      }
      w.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: { credential?: string }) => {
          if (response.credential) {
            onCredential(response.credential);
          }
        }
      });
      containerRef.current.innerHTML = "";
      w.google.accounts.id.renderButton(containerRef.current, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        locale: "es",
        width: 300
      });
    }
    if (w.google) {
      render();
      return;
    }
    const existing = document.getElementById("gsi-script");
    if (existing) {
      existing.addEventListener("load", render);
      return () => existing.removeEventListener("load", render);
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.id = "gsi-script";
    script.addEventListener("load", render);
    document.head.appendChild(script);
    return () => script.removeEventListener("load", render);
  }, [clientId, onCredential]);
  return <div className="google-signin" ref={containerRef} />;
}

type VerifyResult =
  | { valid: true; folio: string; issuedAt: string; studentName: string; courseTitle: string }
  | { valid: false };

function DiplomaVerifier() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function verify(event: FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`${API_URL}/certificates/verify/${encodeURIComponent(trimmed)}`);
      if (response.ok) {
        const data = (await response.json()) as { certificate: Omit<VerifyResult & { valid: true }, "valid"> };
        setResult({ valid: true, ...data.certificate });
      } else {
        setResult({ valid: false });
      }
    } catch {
      setResult({ valid: false });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="ghost-button verify-toggle" onClick={() => setOpen(true)} type="button">
        <ShieldCheck aria-hidden /> Verificar un diploma
      </button>
    );
  }

  return (
    <div className="verify-panel">
      <div className="panel-heading">
        <Award aria-hidden />
        <div>
          <p className="eyebrow">Validación pública</p>
          <h2>Verificar diploma</h2>
        </div>
      </div>
      <form onSubmit={verify}>
        <label>
          Código de verificación
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Aparece al pie del diploma" required />
        </label>
        <button className="primary-button" disabled={busy} type="submit">
          <Check aria-hidden /> {busy ? "Verificando" : "Verificar"}
        </button>
      </form>
      {result?.valid === true ? (
        <div className="verify-result ok">
          <p><strong>Diploma auténtico</strong></p>
          <p>{result.studentName}</p>
          <p className="muted">{result.courseTitle}</p>
          <p className="muted"><small>Folio {result.folio} · {new Date(result.issuedAt).toLocaleDateString("es-MX")}</small></p>
        </div>
      ) : result?.valid === false ? (
        <p className="error-line">No encontramos un diploma con ese código.</p>
      ) : null}
    </div>
  );
}

function reportSortValue(row: ReportRow, key: ReportSortKey): number | string {
  switch (key) {
    case "progressPercent":
      return row.progressPercent ?? 0;
    case "scorePercent":
      return row.latestAttempt?.scorePercent ?? -1;
    case "serviceLabel":
      return row.serviceLabel ?? "";
    case "courseTitle":
      return row.courseTitle;
    case "status":
      return row.status;
    case "studentName":
    default:
      return row.studentName;
  }
}

function metricClass(label: string): string {
  const value = label.toLowerCase();
  if (value.includes("aprobad")) return "ok";
  if (value.includes("reprobad")) return "bad";
  if (value.includes("progreso")) return "info";
  if (value.includes("pendiente")) return "warn";
  return "";
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort
}: {
  label: string;
  sortKey: ReportSortKey;
  sort: { key: ReportSortKey; dir: "asc" | "desc" };
  onSort: (key: ReportSortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th>
      <button type="button" className={`th-sort ${active ? "active" : ""}`} onClick={() => onSort(sortKey)}>
        {label}
        <span className="th-sort-ind" aria-hidden>
          {active ? (sort.dir === "asc" ? <ChevronUp /> : <ChevronDown />) : <ChevronsUpDown />}
        </span>
      </button>
    </th>
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

function CourseCover({
  thumbnail,
  title,
  failed,
  onFailed,
  variant
}: {
  thumbnail: { id: string } | null;
  title: string;
  failed: boolean;
  onFailed: () => void;
  variant: "card" | "continue";
}) {
  const coverClass = variant === "continue" ? "continue-cover" : "course-card-cover";
  if (thumbnail && !failed) {
    return (
      <div className={coverClass}>
        <img src={assetFileUrl(thumbnail.id)} alt="" onError={onFailed} />
      </div>
    );
  }
  return (
    <div className={`${coverClass} course-cover-fallback`}>
      <BookOpen aria-hidden />
      {variant === "card" ? <span className="course-cover-fallback-title">{title}</span> : null}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Avance ${percent}%`}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

function LessonPanel({
  lesson,
  token,
  onComplete,
  onPrev,
  onNext,
  hasPrev,
  hasNext
}: {
  lesson: Lesson;
  token: string;
  onComplete: (lessonId: string) => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const media = resolveLessonMedia(lesson);
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
      {media ? (
        <div className="video-frame">
          {media.kind === "file" ? (
            <video controls playsInline preload="metadata" src={media.src} style={{ display: "block", width: "100%", height: "100%" }} />
          ) : (
            <iframe allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen src={media.src} title={lesson.title} />
          )}
        </div>
      ) : null}
      {lesson.body ? <div className="lesson-body" dangerouslySetInnerHTML={{ __html: sanitizeHtml(lesson.body) }} /> : null}
      {lesson.assets.length > 0 ? (
        <div className="asset-list">
          {lesson.assets.map((asset) =>
            asset.originalUrl ? (
              <a href={asset.originalUrl} key={asset.id} rel="noreferrer" target="_blank">
                <FileText aria-hidden />
                {asset.title}
              </a>
            ) : (
              <button
                key={asset.id}
                type="button"
                onClick={() =>
                  void downloadAsset(token, asset.id, asset.title).catch(() =>
                    toast.error("No se pudo descargar el archivo")
                  )
                }
              >
                <FileText aria-hidden />
                {asset.title}
              </button>
            )
          )}
        </div>
      ) : null}
      <div className="lesson-nav">
        <button className="secondary-button" disabled={!hasPrev} onClick={onPrev} type="button">
          <ArrowLeft aria-hidden /> Anterior
        </button>
        <button className="secondary-button" disabled={!hasNext} onClick={onNext} type="button">
          Siguiente <ChevronRight aria-hidden />
        </button>
      </div>
    </article>
  );
}

function QuizPanel({
  answers,
  attempt,
  busy,
  onAnswerChange,
  onClose,
  onSubmit,
  onRetry
}: {
  answers: AnswerState;
  attempt: QuizAttempt;
  busy: boolean;
  onAnswerChange: (answers: AnswerState) => void;
  onClose: () => void;
  onSubmit: () => void;
  onRetry: (quizId: string) => void;
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
            <X aria-hidden />
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
        <QuizResult attempt={attempt.attempt} onRetry={() => onRetry(attempt.attempt.quizId)} onClose={onClose} />
      ) : (
        <button className="primary-button" disabled={busy} onClick={onSubmit} type="button">
          <GraduationCap aria-hidden />
          Enviar evaluación
        </button>
      )}
    </article>
  );
}

function QuizResult({
  attempt,
  onRetry,
  onClose
}: {
  attempt: AttemptSummary;
  onRetry: () => void;
  onClose: () => void;
}) {
  const passed = attempt.status === "PASSED";
  const score = Math.round(attempt.scorePercent ?? 0);
  return (
    <div className={`quiz-result ${passed ? "passed" : "failed"}`}>
      <span className="quiz-result-badge">{passed ? <Award aria-hidden /> : <RefreshCw aria-hidden />}</span>
      <h3>{passed ? "¡Aprobado!" : "No aprobado"}</h3>
      <p className="quiz-result-score">{score}%</p>
      <p className="muted">
        {passed
          ? "Superaste la evaluación. ¡Bien hecho!"
          : "No alcanzaste el puntaje mínimo. Puedes intentarlo de nuevo."}
      </p>
      <div className="quiz-result-actions">
        {!passed ? (
          <button className="primary-button" onClick={onRetry} type="button">
            <RefreshCw aria-hidden /> Reintentar
          </button>
        ) : null}
        <button className="secondary-button" onClick={onClose} type="button">
          Volver al curso
        </button>
      </div>
    </div>
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
            <button type="button" className="icon-button" onClick={() => move(index, -1)} title="Subir" aria-label="Subir"><ArrowUp aria-hidden /></button>
            <button type="button" className="icon-button" onClick={() => move(index, 1)} title="Bajar" aria-label="Bajar"><ArrowDown aria-hidden /></button>
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

function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") {
    return html;
  }
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
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

function vimeoEmbedUrl(url: string): string | null {
  // Acepta vimeo.com/ID y player.vimeo.com/video/ID.
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  return match?.[1] ? `https://player.vimeo.com/video/${match[1]}` : null;
}

// Resuelve el medio de la lección respetando videoProvider/videoEmbed:
//  - archivo (MP4/webm/…) => reproductor nativo <video controls>;
//  - embed explícito (videoEmbed) => se usa tal cual como src del iframe;
//  - Vimeo => player.vimeo.com/video/ID;
//  - en su defecto, YouTube (comportamiento previo intacto).
function resolveLessonMedia(lesson: Lesson): { kind: "iframe" | "file"; src: string } | null {
  const provider = (lesson.videoProvider ?? "").trim().toUpperCase();
  const embed = (lesson.videoEmbed ?? "").trim();
  const url = (lesson.videoUrl ?? "").trim();
  const primary = embed || url;

  const looksLikeFile = /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(primary);
  const providerIsFile = ["FILE", "MP4", "UPLOAD", "HTML5", "VIDEO_FILE"].includes(provider);
  if (primary && (providerIsFile || looksLikeFile)) {
    return { kind: "file", src: primary };
  }

  if (embed) {
    // El proveedor ya entregó una URL lista para incrustar.
    return { kind: "iframe", src: embed };
  }

  if (provider === "VIMEO" || /vimeo\.com/i.test(url)) {
    const vimeo = vimeoEmbedUrl(url);
    if (vimeo) {
      return { kind: "iframe", src: vimeo };
    }
  }

  const youtube = youtubeEmbedUrl(url || null);
  return youtube ? { kind: "iframe", src: youtube } : null;
}

function lessonKindLabel(lesson: { kind: string; videoUrl: string | null }) {
  if (lesson.videoUrl || lesson.kind === "VIDEO") {
    return "Video";
  }
  switch (lesson.kind?.toUpperCase()) {
    case "ASSIGNMENT":
      return "Tarea";
    case "QUIZ":
      return "Examen";
    case "TEXT":
    case "LESSON":
      return "Lección";
    default:
      return "Lección";
  }
}

// Mapea el nivel del curso (que puede venir migrado en inglés o como enum crudo)
// a una etiqueta en español. Si es texto libre desconocido, lo devuelve tal cual.
function courseLevelLabel(level: string | null | undefined): string | null {
  if (!level) {
    return null;
  }
  switch (level.trim().toUpperCase()) {
    case "BEGINNER":
    case "BASIC":
      return "Básico";
    case "INTERMEDIATE":
      return "Intermedio";
    case "ADVANCED":
    case "EXPERT":
      return "Avanzado";
    default:
      return level;
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
    case "profile":
      return "Mi perfil";
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
<body class="theme-light" onload="setTimeout(function(){ window.print(); }, 300)">
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
