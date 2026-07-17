/**
 * Seed idempotente para la base local de desarrollo del LMS.
 *
 * Se apoya en claves unicas del esquema (email, slug, [courseId, position], etc.)
 * y en el par [sourceSystem, sourceId] para los modelos sin clave de negocio
 * natural (QuizAttempt, AchievementAward, AchievementEvent, CourseReview). Volver
 * a correrlo converge al mismo estado sin duplicar filas.
 *
 * Las contrasenas se generan con hashApplicationPassword (bcrypt cost 12), el
 * mismo esquema que verifica y rehashea POST /auth/login, para que el login real
 * funcione contra estos usuarios.
 *
 * Correr:  pnpm db:seed   (o: pnpm --filter @tsc-capacita/db run db:seed)
 */
import { PrismaClient } from "@prisma/client";
import type { QuestionType, Role } from "@prisma/client";
import { hashApplicationPassword } from "@tsc-capacita/wp-compat";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();

const DEV_PASSWORD = "Capacita2026!";
const SEED = "seed"; // marcador sourceSystem para filas propias del seed

// Fechas fijas => folios, codigos de verificacion y timestamps deterministas.
const ENROLLED_PROTECCION = new Date("2026-04-01T15:00:00.000Z");
const COMPLETED_PROTECCION = new Date("2026-05-15T18:00:00.000Z");
const ENROLLED_CUSTODIA = new Date("2026-06-01T15:00:00.000Z");
const ENROLLED_INTRAMUROS = new Date("2026-06-20T15:00:00.000Z");

// ---------------------------------------------------------------------------
// Helpers de certificado (replicados de apps/api/src/lib/certificates.ts para
// no acoplar packages/db con apps/api; deben producir los mismos valores).
// ---------------------------------------------------------------------------
function certificateFolio(userId: string, courseId: string, issuedAt: Date) {
  const date = issuedAt.toISOString().slice(0, 10).replaceAll("-", "");
  const hash = createHash("sha256").update(`${userId}:${courseId}:${date}`).digest("hex").slice(0, 8).toUpperCase();
  return `TSC-${date}-${hash}`;
}

function certificateVerificationCode(userId: string, courseId: string, issuedAt: Date) {
  return createHash("sha256")
    .update(`tsc-certificate:${userId}:${courseId}:${issuedAt.toISOString()}`)
    .digest("hex")
    .slice(0, 24);
}

function certificateStorageKey(folio: string) {
  return `certificates/generated-on-demand/${folio}.pdf`;
}

// ---------------------------------------------------------------------------
// Guarda de entorno: el seed reescribe datos y SOLO debe correr contra la base
// local de desarrollo. Aborta (sin escribir nada) si NODE_ENV es production o si
// DATABASE_URL apunta a un host que no sea local. ALLOW_SEED=1 fuerza la corrida
// bajo responsabilidad de quien la ejecuta (p. ej. una base local con otro host).
// ---------------------------------------------------------------------------
function assertLocalSeedTarget() {
  if (process.env.ALLOW_SEED === "1") {
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "db:seed abortado: NODE_ENV=production. El seed solo debe correr contra una base local de desarrollo. Usa ALLOW_SEED=1 para forzarlo bajo tu propia responsabilidad."
    );
  }

  const rawUrl = process.env.DATABASE_URL ?? "";
  let host: string;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    throw new Error(
      "db:seed abortado: DATABASE_URL ausente o no parseable. El seed solo corre contra una base local (localhost/127.0.0.1). Usa ALLOW_SEED=1 para forzarlo."
    );
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(host)) {
    throw new Error(
      `db:seed abortado: DATABASE_URL apunta a un host no local (${host}). El seed solo corre contra localhost/127.0.0.1 (base de desarrollo, típicamente :5433). Usa ALLOW_SEED=1 para forzarlo bajo tu propia responsabilidad.`
    );
  }
}

// ---------------------------------------------------------------------------
// Upserts base
// ---------------------------------------------------------------------------
async function upsertUser(opts: {
  email: string;
  displayName: string;
  role: Role;
  passwordHash: string;
  serviceLabel?: string;
  employeeCode?: string;
}) {
  const email = opts.email.toLowerCase();
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      displayName: opts.displayName,
      status: "ACTIVE",
      passwordHash: opts.passwordHash,
      legacyPasswordHash: null,
      legacyPasswordAlgo: null,
      serviceLabel: opts.serviceLabel ?? null,
      employeeCode: opts.employeeCode ?? null
    },
    create: {
      email,
      displayName: opts.displayName,
      status: "ACTIVE",
      passwordHash: opts.passwordHash,
      serviceLabel: opts.serviceLabel ?? null,
      employeeCode: opts.employeeCode ?? null
    }
  });

  await prisma.userRole.upsert({
    where: { userId_role: { userId: user.id, role: opts.role } },
    update: {},
    create: { userId: user.id, role: opts.role }
  });

  return user;
}

async function upsertCourse(opts: {
  slug: string;
  title: string;
  excerpt: string;
  description: string;
  level: string;
  durationSec: number;
  teacherId: string;
  publishedAt: Date;
}) {
  return prisma.course.upsert({
    where: { slug: opts.slug },
    update: {
      title: opts.title,
      excerpt: opts.excerpt,
      description: opts.description,
      level: opts.level,
      durationSec: opts.durationSec,
      teacherId: opts.teacherId,
      status: "PUBLISHED",
      publishedAt: opts.publishedAt
    },
    create: {
      slug: opts.slug,
      title: opts.title,
      excerpt: opts.excerpt,
      description: opts.description,
      level: opts.level,
      durationSec: opts.durationSec,
      teacherId: opts.teacherId,
      status: "PUBLISHED",
      publishedAt: opts.publishedAt
    }
  });
}

async function upsertModule(courseId: string, position: number, title: string) {
  return prisma.courseModule.upsert({
    where: { courseId_position: { courseId, position } },
    update: { title },
    create: { courseId, position, title }
  });
}

type LessonSpec = {
  slug: string;
  title: string;
  kind: "TEXT" | "VIDEO" | "MIXED" | "RESOURCE";
  position: number;
  body?: string;
  videoProvider?: string;
  videoUrl?: string;
  durationSec?: number;
};

async function upsertLesson(courseId: string, moduleId: string, spec: LessonSpec) {
  return prisma.lesson.upsert({
    where: { courseId_slug: { courseId, slug: spec.slug } },
    update: {
      moduleId,
      title: spec.title,
      kind: spec.kind,
      position: spec.position,
      body: spec.body ?? null,
      videoProvider: spec.videoProvider ?? null,
      videoUrl: spec.videoUrl ?? null,
      durationSec: spec.durationSec ?? null
    },
    create: {
      courseId,
      moduleId,
      title: spec.title,
      slug: spec.slug,
      kind: spec.kind,
      position: spec.position,
      body: spec.body ?? null,
      videoProvider: spec.videoProvider ?? null,
      videoUrl: spec.videoUrl ?? null,
      durationSec: spec.durationSec ?? null
    }
  });
}

type OptionSpec = { label: string; value: string; isCorrect?: boolean; gapMatch?: string };
type QuestionSpec = {
  type: QuestionType;
  prompt: string;
  explanation?: string;
  points?: number;
  options: OptionSpec[];
};

type SeededQuestion = {
  id: string;
  type: QuestionType;
  points: number;
  options: Array<{ id: string; position: number; isCorrect: boolean; value: string; gapMatch: string | null }>;
};

async function upsertQuiz(
  courseId: string,
  moduleId: string,
  quiz: { slug: string; title: string; position: number; passingScorePercent: number; timeLimitSec?: number; maxAttempts?: number },
  questions: QuestionSpec[]
): Promise<{ quizId: string; questions: SeededQuestion[] }> {
  const created = await prisma.quiz.upsert({
    where: { courseId_slug: { courseId, slug: quiz.slug } },
    update: {
      moduleId,
      title: quiz.title,
      status: "PUBLISHED",
      position: quiz.position,
      passingScorePercent: quiz.passingScorePercent,
      timeLimitSec: quiz.timeLimitSec ?? null,
      maxAttempts: quiz.maxAttempts ?? null
    },
    create: {
      courseId,
      moduleId,
      title: quiz.title,
      slug: quiz.slug,
      status: "PUBLISHED",
      position: quiz.position,
      passingScorePercent: quiz.passingScorePercent,
      timeLimitSec: quiz.timeLimitSec ?? null,
      maxAttempts: quiz.maxAttempts ?? null
    }
  });

  const seededQuestions: SeededQuestion[] = [];

  for (let q = 0; q < questions.length; q += 1) {
    const spec = questions[q]!;
    const position = q + 1;
    const points = spec.points ?? 1;
    const question = await prisma.question.upsert({
      where: { quizId_position: { quizId: created.id, position } },
      update: { type: spec.type, prompt: spec.prompt, explanation: spec.explanation ?? null, points },
      create: { quizId: created.id, position, type: spec.type, prompt: spec.prompt, explanation: spec.explanation ?? null, points }
    });

    const seededOptions: SeededQuestion["options"] = [];
    for (let o = 0; o < spec.options.length; o += 1) {
      const optSpec = spec.options[o]!;
      const optPosition = o + 1;
      const option = await prisma.questionOption.upsert({
        where: { questionId_position: { questionId: question.id, position: optPosition } },
        update: {
          label: optSpec.label,
          value: optSpec.value,
          isCorrect: optSpec.isCorrect ?? false,
          gapMatch: optSpec.gapMatch ?? null
        },
        create: {
          questionId: question.id,
          position: optPosition,
          label: optSpec.label,
          value: optSpec.value,
          isCorrect: optSpec.isCorrect ?? false,
          gapMatch: optSpec.gapMatch ?? null
        }
      });
      seededOptions.push({
        id: option.id,
        position: option.position,
        isCorrect: option.isCorrect,
        value: option.value,
        gapMatch: option.gapMatch
      });
    }

    seededQuestions.push({ id: question.id, type: spec.type, points, options: seededOptions });
  }

  return { quizId: created.id, questions: seededQuestions };
}

async function upsertEnrollment(opts: {
  userId: string;
  courseId: string;
  status: "ACTIVE" | "COMPLETED" | "SUSPENDED";
  progressPercent: number;
  enrolledAt: Date;
  completedAt?: Date;
}) {
  return prisma.enrollment.upsert({
    where: { userId_courseId: { userId: opts.userId, courseId: opts.courseId } },
    update: {
      status: opts.status,
      progressPercent: opts.progressPercent,
      enrolledAt: opts.enrolledAt,
      completedAt: opts.completedAt ?? null
    },
    create: {
      userId: opts.userId,
      courseId: opts.courseId,
      status: opts.status,
      progressPercent: opts.progressPercent,
      enrolledAt: opts.enrolledAt,
      completedAt: opts.completedAt ?? null
    }
  });
}

async function upsertPrerequisite(courseId: string, requiresId: string) {
  return prisma.coursePrerequisite.upsert({
    where: { courseId_requiresId: { courseId, requiresId } },
    update: {},
    create: { courseId, requiresId }
  });
}

async function completeLesson(userId: string, lessonId: string, when: Date) {
  return prisma.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    update: { completedAt: when, lastSeenAt: when },
    create: { userId, lessonId, completedAt: when, lastSeenAt: when }
  });
}

// Construye la respuesta correcta (forma QuestionGrade que persiste el submit real)
// para cada tipo que califica grading.ts.
function buildCorrectGrade(question: SeededQuestion) {
  const correctIds = question.options.filter((o) => o.isCorrect).map((o) => o.id);
  let selectedOptionIds: string[] = [];
  let text: string | null = null;
  let matches: Array<{ optionId: string; value: string }> = [];

  switch (question.type) {
    case "SINGLE_CHOICE":
    case "TRUE_FALSE":
      selectedOptionIds = correctIds.slice(0, 1);
      break;
    case "MULTIPLE_CHOICE":
      selectedOptionIds = correctIds;
      break;
    case "SHORT_TEXT":
    case "FILL_IN_THE_BLANK": {
      const accepted = question.options.find((o) => o.isCorrect) ?? question.options[0];
      text = accepted ? accepted.value : "";
      break;
    }
    case "MATCHING":
      matches = question.options
        .filter((o) => o.gapMatch && o.gapMatch.trim().length > 0)
        .map((o) => ({ optionId: o.id, value: o.gapMatch as string }));
      break;
    case "ORDERING":
      selectedOptionIds = [...question.options].sort((a, b) => a.position - b.position).map((o) => o.id);
      break;
    default:
      break;
  }

  return {
    questionId: question.id,
    selectedOptionIds,
    text,
    matches,
    isCorrect: true,
    score: question.points
  };
}

// Siembra un intento APROBADO al 100% con sus respuestas correctas.
async function seedPassedAttempt(opts: {
  quizId: string;
  userId: string;
  questions: SeededQuestion[];
  sourceId: string;
  startedAt: Date;
  submittedAt: Date;
  // Sello de evaluación (opcional): congela el umbral/tiempo/preguntas al presentar
  // el examen. Sin esto, el intento queda "sin sellar" y el reporte cae al umbral
  // vivo (comportamiento previo al sello). Con esto, "Resultados con sello" muestra
  // un veredicto congelado real (rulesVersion + hash), como en producción.
  seal?: { passingScorePercent: number; timeLimitSec: number | null; courseVersion: number };
}) {
  const totalMarks = opts.questions.reduce((sum, q) => sum + q.points, 0);
  const questionOrder = opts.questions.map((q) => q.id);

  // Snapshot inmutable con la MISMA forma que buildRulesSnapshot del API
  // (format 1): así el reporte lo parsea, calcula effectivePassingPercent y firma
  // un sello estable. Los datos salen de las preguntas realmente sembradas.
  const rulesSnapshot = opts.seal
    ? {
        format: 1,
        capturedAt: opts.submittedAt.toISOString(),
        courseVersion: opts.seal.courseVersion,
        passingScorePercent: opts.seal.passingScorePercent,
        timeLimitSec: opts.seal.timeLimitSec,
        totalMarks,
        questions: opts.questions.map((q) => ({
          id: q.id,
          type: q.type,
          points: q.points,
          options: q.options.map((o) => ({
            id: o.id,
            label: o.value,
            value: o.value,
            gapMatch: o.gapMatch ?? null,
            isCorrect: o.isCorrect,
            position: o.position
          }))
        }))
      }
    : undefined;
  const rulesVersion = opts.seal ? opts.seal.courseVersion : null;

  const attempt = await prisma.quizAttempt.upsert({
    where: { sourceSystem_sourceId: { sourceSystem: SEED, sourceId: opts.sourceId } },
    update: {
      quizId: opts.quizId,
      userId: opts.userId,
      status: "PASSED",
      startedAt: opts.startedAt,
      submittedAt: opts.submittedAt,
      scorePercent: 100,
      totalQuestions: opts.questions.length,
      totalAnsweredQuestions: opts.questions.length,
      totalMarks,
      earnedMarks: totalMarks,
      result: "pass",
      questionOrder,
      rulesSnapshot: rulesSnapshot ?? undefined,
      rulesVersion
    },
    create: {
      sourceSystem: SEED,
      sourceId: opts.sourceId,
      quizId: opts.quizId,
      userId: opts.userId,
      status: "PASSED",
      startedAt: opts.startedAt,
      submittedAt: opts.submittedAt,
      scorePercent: 100,
      totalQuestions: opts.questions.length,
      totalAnsweredQuestions: opts.questions.length,
      totalMarks,
      earnedMarks: totalMarks,
      result: "pass",
      questionOrder,
      rulesSnapshot: rulesSnapshot ?? undefined,
      rulesVersion
    }
  });

  for (const question of opts.questions) {
    const grade = buildCorrectGrade(question);
    await prisma.quizAnswer.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId: question.id } },
      update: { response: grade, score: grade.score, gradedAt: opts.submittedAt },
      create: { attemptId: attempt.id, questionId: question.id, response: grade, score: grade.score, gradedAt: opts.submittedAt }
    });
  }

  return attempt;
}

// ---------------------------------------------------------------------------
// Contenido de cursos
// ---------------------------------------------------------------------------
const PROTECCION_QUESTIONS: QuestionSpec[] = [
  {
    type: "SINGLE_CHOICE",
    prompt: "En un dispositivo de proteccion ejecutiva, cual es la prioridad numero uno del agente?",
    explanation: "La integridad fisica del protegido esta por encima de cualquier otro objetivo.",
    options: [
      { label: "Preservar la vida e integridad del protegido", value: "vida", isCorrect: true },
      { label: "Proteger los bienes materiales", value: "bienes" },
      { label: "Documentar el incidente", value: "documentar" },
      { label: "Perseguir al agresor", value: "perseguir" }
    ]
  },
  {
    type: "MULTIPLE_CHOICE",
    prompt: "Cuales son elementos de una avanzada de seguridad? (selecciona todas las correctas)",
    explanation: "La avanzada verifica rutas, tiempos y puntos vulnerables antes del arribo del protegido.",
    options: [
      { label: "Reconocimiento de la ruta principal", value: "ruta-principal", isCorrect: true },
      { label: "Definicion de rutas alternas", value: "rutas-alternas", isCorrect: true },
      { label: "Identificacion de hospitales cercanos", value: "hospitales", isCorrect: true },
      { label: "Publicar el itinerario en redes sociales", value: "redes-sociales" }
    ]
  },
  {
    type: "TRUE_FALSE",
    prompt: "El agente de proteccion debe mantener siempre una via de evacuacion identificada.",
    explanation: "Tener una salida planificada es un principio basico de la proteccion de personas.",
    options: [
      { label: "Verdadero", value: "true", isCorrect: true },
      { label: "Falso", value: "false" }
    ]
  },
  {
    type: "SHORT_TEXT",
    prompt: "Como se llama la formacion de proteccion que rodea al protegido durante un desplazamiento a pie?",
    explanation: "El anillo o circulo de proteccion cubre los 360 grados alrededor del protegido.",
    options: [{ label: "Respuesta aceptada", value: "anillo de proteccion", isCorrect: true }]
  },
  {
    type: "MATCHING",
    prompt: "Relaciona cada nivel de alerta con su significado operativo.",
    explanation: "Los niveles de alerta guian la postura del dispositivo segun el riesgo.",
    options: [
      { label: "Alerta verde", value: "Alerta verde", gapMatch: "Situacion normal" },
      { label: "Alerta amarilla", value: "Alerta amarilla", gapMatch: "Precaucion incrementada" },
      { label: "Alerta roja", value: "Alerta roja", gapMatch: "Amenaza inminente" }
    ]
  },
  {
    type: "ORDERING",
    prompt: "Ordena las fases de una reaccion ante una agresion directa al protegido.",
    explanation: "Cubrir, evacuar y luego asegurar es la secuencia estandar de reaccion.",
    options: [
      { label: "Detectar la amenaza", value: "detectar" },
      { label: "Cubrir al protegido", value: "cubrir" },
      { label: "Evacuar de la zona de riesgo", value: "evacuar" },
      { label: "Asegurar un punto seguro", value: "asegurar" }
    ]
  }
];

const CUSTODIA_QUESTIONS: QuestionSpec[] = [
  {
    type: "SINGLE_CHOICE",
    prompt: "Que documento ampara legalmente la mercancia durante el traslado?",
    options: [
      { label: "La carta porte", value: "carta-porte", isCorrect: true },
      { label: "La bitacora del vehiculo", value: "bitacora" },
      { label: "El gafete del custodio", value: "gafete" },
      { label: "El manual de la unidad", value: "manual" }
    ]
  },
  {
    type: "MULTIPLE_CHOICE",
    prompt: "Que acciones reducen el riesgo de robo durante la custodia de mercancia?",
    options: [
      { label: "Variar rutas y horarios", value: "variar-rutas", isCorrect: true },
      { label: "Mantener comunicacion con el centro de monitoreo", value: "monitoreo", isCorrect: true },
      { label: "Evitar paradas no planeadas", value: "evitar-paradas", isCorrect: true },
      { label: "Compartir la ruta con desconocidos", value: "compartir-ruta" }
    ]
  }
];

const INTRAMUROS_QUESTIONS: QuestionSpec[] = [
  {
    type: "SINGLE_CHOICE",
    prompt: "Cual es la funcion principal del control de acceso en seguridad intramuros?",
    options: [
      { label: "Autorizar y registrar el ingreso de personas y vehiculos", value: "control-acceso", isCorrect: true },
      { label: "Vender productos en la caseta", value: "vender" },
      { label: "Estacionar los vehiculos de visitantes", value: "estacionar" },
      { label: "Limpiar las instalaciones", value: "limpiar" }
    ]
  },
  {
    type: "TRUE_FALSE",
    prompt: "La bitacora de novedades debe registrar todo evento relevante del turno.",
    options: [
      { label: "Verdadero", value: "true", isCorrect: true },
      { label: "Falso", value: "false" }
    ]
  }
];

async function seedCourse(opts: {
  slug: string;
  title: string;
  excerpt: string;
  description: string;
  level: string;
  durationSec: number;
  teacherId: string;
  publishedAt: Date;
  videoUrl: string;
  quizSlug: string;
  quizTitle: string;
  questions: QuestionSpec[];
}) {
  const course = await upsertCourse({
    slug: opts.slug,
    title: opts.title,
    excerpt: opts.excerpt,
    description: opts.description,
    level: opts.level,
    durationSec: opts.durationSec,
    teacherId: opts.teacherId,
    publishedAt: opts.publishedAt
  });

  const moduleFund = await upsertModule(course.id, 1, "Fundamentos");
  const modulePractica = await upsertModule(course.id, 2, "Practica y evaluacion");

  const lesson1 = await upsertLesson(course.id, moduleFund.id, {
    slug: `${opts.slug}-introduccion`,
    title: `Introduccion a ${opts.title}`,
    kind: "TEXT",
    position: 1,
    body: `Esta leccion presenta los conceptos base de ${opts.title} y el marco de actuacion del personal de seguridad privada.`,
    durationSec: 600
  });

  const lesson2 = await upsertLesson(course.id, moduleFund.id, {
    slug: `${opts.slug}-video-demostrativo`,
    title: `Video demostrativo: ${opts.title}`,
    kind: "VIDEO",
    position: 2,
    videoProvider: "youtube",
    videoUrl: opts.videoUrl,
    durationSec: 900
  });

  const lesson3 = await upsertLesson(course.id, modulePractica.id, {
    slug: `${opts.slug}-protocolo-operativo`,
    title: `Protocolo operativo de ${opts.title}`,
    kind: "MIXED",
    position: 3,
    body: `Repaso practico del protocolo operativo. Al terminar esta leccion el alumno puede presentar la evaluacion del modulo de ${opts.title}.`,
    durationSec: 720
  });

  const quiz = await upsertQuiz(
    course.id,
    modulePractica.id,
    { slug: opts.quizSlug, title: opts.quizTitle, position: 1, passingScorePercent: 80, timeLimitSec: 1800, maxAttempts: 3 },
    opts.questions
  );

  return { course, lessons: [lesson1, lesson2, lesson3], quiz };
}

// ---------------------------------------------------------------------------
// Gamificacion
// ---------------------------------------------------------------------------
async function upsertAchievement(opts: { slug: string; title: string; description: string; points: number }) {
  return prisma.achievement.upsert({
    where: { slug: opts.slug },
    update: { title: opts.title, description: opts.description, points: opts.points },
    create: { slug: opts.slug, title: opts.title, description: opts.description, points: opts.points }
  });
}

async function upsertAchievementStep(opts: {
  achievementId: string;
  position: number;
  trigger: "QUIZ_PASSED" | "COURSE_COMPLETED";
  courseId?: string;
  quizId?: string;
  requiredCount?: number;
}) {
  return prisma.achievementStep.upsert({
    where: { achievementId_position: { achievementId: opts.achievementId, position: opts.position } },
    update: { trigger: opts.trigger, courseId: opts.courseId ?? null, quizId: opts.quizId ?? null, requiredCount: opts.requiredCount ?? 1 },
    create: {
      achievementId: opts.achievementId,
      position: opts.position,
      trigger: opts.trigger,
      courseId: opts.courseId ?? null,
      quizId: opts.quizId ?? null,
      requiredCount: opts.requiredCount ?? 1
    }
  });
}

async function upsertAchievementAward(opts: { sourceId: string; userId: string; achievementId: string; courseId?: string; points: number; awardedAt: Date }) {
  return prisma.achievementAward.upsert({
    where: { sourceSystem_sourceId: { sourceSystem: SEED, sourceId: opts.sourceId } },
    update: { userId: opts.userId, achievementId: opts.achievementId, courseId: opts.courseId ?? null, points: opts.points, awardedAt: opts.awardedAt },
    create: {
      sourceSystem: SEED,
      sourceId: opts.sourceId,
      userId: opts.userId,
      achievementId: opts.achievementId,
      courseId: opts.courseId ?? null,
      points: opts.points,
      awardedAt: opts.awardedAt
    }
  });
}

async function upsertAchievementEvent(opts: { sourceId: string; userId: string; title: string; points: number; pointsType: string; occurredAt: Date }) {
  return prisma.achievementEvent.upsert({
    where: { sourceSystem_sourceId: { sourceSystem: SEED, sourceId: opts.sourceId } },
    update: { userId: opts.userId, title: opts.title, points: opts.points, pointsType: opts.pointsType, occurredAt: opts.occurredAt },
    create: {
      sourceSystem: SEED,
      sourceId: opts.sourceId,
      userId: opts.userId,
      title: opts.title,
      points: opts.points,
      pointsType: opts.pointsType,
      occurredAt: opts.occurredAt
    }
  });
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  assertLocalSeedTarget();

  const passwordHash = await hashApplicationPassword(DEV_PASSWORD);

  // --- Usuarios ---
  const admin = await upsertUser({ email: "admin@tsc.local", displayName: "Admin TSC", role: "ADMIN", passwordHash });
  const instructor = await upsertUser({ email: "instructor@tsc.local", displayName: "Instructor TSC", role: "TEACHER", passwordHash });
  const guardia = await upsertUser({
    email: "guardia@tsc.local",
    displayName: "Marcos Martinez",
    role: "STUDENT",
    passwordHash,
    serviceLabel: "Seguridad Intramuros",
    employeeCode: "TSC-0427"
  });

  // --- Cursos publicados (propiedad del instructor) ---
  const proteccion = await seedCourse({
    slug: "proteccion-ejecutiva",
    title: "Proteccion Ejecutiva",
    excerpt: "Formacion para agentes de proteccion de personas de alto perfil.",
    description: "Programa especializado en proteccion ejecutiva: avanzadas de seguridad, formaciones de proteccion, evacuacion y reaccion ante agresiones.",
    level: "Avanzado",
    durationSec: 7200,
    teacherId: instructor.id,
    publishedAt: new Date("2026-03-01T12:00:00.000Z"),
    videoUrl: "https://www.youtube.com/watch?v=kWsZrtGFip0",
    quizSlug: "proteccion-ejecutiva-examen",
    quizTitle: "Examen final de Proteccion Ejecutiva",
    questions: PROTECCION_QUESTIONS
  });

  const custodia = await seedCourse({
    slug: "custodia-de-mercancia",
    title: "Custodia de Mercancia",
    excerpt: "Traslado seguro y custodia de mercancia en transito.",
    description: "Tecnicas de custodia de mercancia: documentacion legal, gestion de rutas, comunicacion con monitoreo y prevencion de robo en carretera.",
    level: "Intermedio",
    durationSec: 5400,
    teacherId: instructor.id,
    publishedAt: new Date("2026-03-10T12:00:00.000Z"),
    videoUrl: "https://www.youtube.com/watch?v=Ng18yL1hDDo",
    quizSlug: "custodia-de-mercancia-examen",
    quizTitle: "Examen final de Custodia de Mercancia",
    questions: CUSTODIA_QUESTIONS
  });

  const intramuros = await seedCourse({
    slug: "seguridad-intramuros",
    title: "Seguridad Intramuros",
    excerpt: "Control de acceso y vigilancia en instalaciones fijas.",
    description: "Operacion de seguridad intramuros: control de acceso, rondines, bitacora de novedades y respuesta ante contingencias.",
    level: "Basico",
    durationSec: 3600,
    teacherId: instructor.id,
    publishedAt: new Date("2026-03-20T12:00:00.000Z"),
    videoUrl: "https://www.youtube.com/watch?v=cpcqOQSIGY0",
    quizSlug: "seguridad-intramuros-examen",
    quizTitle: "Examen final de Seguridad Intramuros",
    questions: INTRAMUROS_QUESTIONS
  });

  // --- Inscripciones del guardia ---
  // 1) Proteccion Ejecutiva: COMPLETADA (todas las lecciones + examen aprobado + certificado)
  await upsertEnrollment({
    userId: guardia.id,
    courseId: proteccion.course.id,
    status: "COMPLETED",
    progressPercent: 100,
    enrolledAt: ENROLLED_PROTECCION,
    completedAt: COMPLETED_PROTECCION
  });
  for (const lesson of proteccion.lessons) {
    await completeLesson(guardia.id, lesson.id, COMPLETED_PROTECCION);
  }
  await seedPassedAttempt({
    quizId: proteccion.quiz.quizId,
    userId: guardia.id,
    questions: proteccion.quiz.questions,
    sourceId: "attempt-proteccion-guardia",
    startedAt: new Date(COMPLETED_PROTECCION.getTime() - 30 * 60 * 1000),
    submittedAt: COMPLETED_PROTECCION,
    // Sella el intento con el umbral vivo real del examen (80%, 30 min, v1): el
    // reporte del instructor muestra un veredicto congelado real, no simulado.
    seal: { passingScorePercent: 80, timeLimitSec: 1800, courseVersion: 1 }
  });

  const folio = certificateFolio(guardia.id, proteccion.course.id, COMPLETED_PROTECCION);
  await prisma.certificate.upsert({
    where: { folio },
    update: {
      userId: guardia.id,
      courseId: proteccion.course.id,
      status: "ISSUED",
      verificationCode: certificateVerificationCode(guardia.id, proteccion.course.id, COMPLETED_PROTECCION),
      pdfStorageKey: certificateStorageKey(folio),
      issuedAt: COMPLETED_PROTECCION
    },
    create: {
      userId: guardia.id,
      courseId: proteccion.course.id,
      status: "ISSUED",
      folio,
      verificationCode: certificateVerificationCode(guardia.id, proteccion.course.id, COMPLETED_PROTECCION),
      pdfStorageKey: certificateStorageKey(folio),
      issuedAt: COMPLETED_PROTECCION
    }
  });

  // 2) Custodia de Mercancia: EN PROGRESO (2 de 3 lecciones completas => 66.67%)
  await upsertEnrollment({
    userId: guardia.id,
    courseId: custodia.course.id,
    status: "ACTIVE",
    progressPercent: 66.67,
    enrolledAt: ENROLLED_CUSTODIA
  });
  await completeLesson(guardia.id, custodia.lessons[0]!.id, new Date("2026-06-05T16:00:00.000Z"));
  await completeLesson(guardia.id, custodia.lessons[1]!.id, new Date("2026-06-08T16:00:00.000Z"));

  // 3) Seguridad Intramuros: inscrita sin empezar
  await upsertEnrollment({
    userId: guardia.id,
    courseId: intramuros.course.id,
    status: "ACTIVE",
    progressPercent: 0,
    enrolledAt: ENROLLED_INTRAMUROS
  });

  // --- Prerrequisitos de curso (Ola 2) ---
  // Custodia y Seguridad Intramuros exigen haber COMPLETADO Proteccion Ejecutiva.
  // Marcos ya la completo, asi que para el quedan DESBLOQUEADOS (el e2e de Ola 1
  // sigue verde), pero el mecanismo queda demostrable para un usuario nuevo.
  //
  // Verificacion explicita del invariante del que dependen estos prerrequisitos:
  // si Marcos no tiene Proteccion COMPLETED, la premisa "quedan desbloqueados para
  // el" seria falsa; abortamos el seed antes de sembrar datos inconsistentes.
  const protEnrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId: guardia.id, courseId: proteccion.course.id } },
    select: { status: true }
  });
  if (protEnrollment?.status !== "COMPLETED") {
    throw new Error(
      `Seed abortado: Marcos deberia tener Proteccion Ejecutiva COMPLETED (esta: ${protEnrollment?.status ?? "sin inscripcion"}). Los prerrequisitos demo asumen ese estado.`
    );
  }
  await upsertPrerequisite(custodia.course.id, proteccion.course.id);
  await upsertPrerequisite(intramuros.course.id, proteccion.course.id);

  // Racha demo de Marcos: 3 dias activos hasta hoy. No altera su XP (450, que sale
  // de AchievementEvent) ni ningun campo que el e2e verifique.
  await prisma.user.update({
    where: { id: guardia.id },
    data: { currentStreak: 3, lastActiveDate: new Date() }
  });

  // --- Gamificacion ---
  // Insignias del motor real. Los pasos se dejan genericos (sin course/quiz
  // fijo) porque el otorgamiento vive en los triggers reales por slug; el paso
  // solo describe el requisito ("completa 1 curso", "aprueba 1 examen", etc.).
  const achDiploma = await upsertAchievement({
    slug: "primer-diploma",
    title: "Primer diploma",
    description: "Se otorga al completar el primer curso y obtener su diploma.",
    points: 200
  });
  await upsertAchievementStep({
    achievementId: achDiploma.id,
    position: 1,
    trigger: "COURSE_COMPLETED",
    requiredCount: 1
  });

  const achExamen = await upsertAchievement({
    slug: "examinador-aprobado",
    title: "Examinador aprobado",
    description: "Se otorga al aprobar el primer examen de un curso.",
    points: 100
  });
  await upsertAchievementStep({
    achievementId: achExamen.id,
    position: 1,
    trigger: "QUIZ_PASSED",
    requiredCount: 1
  });

  const achPerfecto = await upsertAchievement({
    slug: "examen-perfecto",
    title: "Examen perfecto",
    description: "Se otorga al aprobar un examen con 100% de aciertos.",
    points: 150
  });
  await upsertAchievementStep({
    achievementId: achPerfecto.id,
    position: 1,
    trigger: "QUIZ_PASSED",
    requiredCount: 1
  });

  const achTresCursos = await upsertAchievement({
    slug: "tres-cursos",
    title: "Tres cursos",
    description: "Se otorga al completar tres cursos de la plataforma.",
    points: 300
  });
  await upsertAchievementStep({
    achievementId: achTresCursos.id,
    position: 1,
    trigger: "COURSE_COMPLETED",
    requiredCount: 3
  });

  await upsertAchievementAward({
    sourceId: "award-primer-diploma-guardia",
    userId: guardia.id,
    achievementId: achDiploma.id,
    courseId: proteccion.course.id,
    points: 200,
    awardedAt: COMPLETED_PROTECCION
  });
  await upsertAchievementAward({
    sourceId: "award-examinador-guardia",
    userId: guardia.id,
    achievementId: achExamen.id,
    courseId: proteccion.course.id,
    points: 100,
    awardedAt: COMPLETED_PROTECCION
  });
  // El intento sembrado del guardia fue 100%, asi que ya tiene "Examen perfecto".
  await upsertAchievementAward({
    sourceId: "award-examen-perfecto-guardia",
    userId: guardia.id,
    achievementId: achPerfecto.id,
    courseId: proteccion.course.id,
    points: 150,
    awardedAt: COMPLETED_PROTECCION
  });

  // Historial de XP: total = 450 (rango intermedio).
  const events: Array<{ sourceId: string; title: string; points: number; pointsType: string; occurredAt: Date }> = [
    { sourceId: "event-welcome-guardia", title: "Bienvenida a la plataforma", points: 50, pointsType: "onboarding", occurredAt: ENROLLED_PROTECCION },
    { sourceId: "event-lessons-proteccion-guardia", title: "Lecciones de Proteccion Ejecutiva completadas", points: 100, pointsType: "lesson", occurredAt: COMPLETED_PROTECCION },
    { sourceId: "event-quiz-proteccion-guardia", title: "Examen aprobado: Proteccion Ejecutiva", points: 150, pointsType: "quiz", occurredAt: COMPLETED_PROTECCION },
    { sourceId: "event-course-proteccion-guardia", title: "Curso completado: Proteccion Ejecutiva", points: 150, pointsType: "course", occurredAt: COMPLETED_PROTECCION }
  ];
  for (const event of events) {
    await upsertAchievementEvent({ userId: guardia.id, ...event });
  }

  // --- Resena del guardia (opcional) ---
  await prisma.courseReview.upsert({
    where: { sourceSystem_sourceId: { sourceSystem: SEED, sourceId: "review-proteccion-guardia" } },
    update: {
      courseId: proteccion.course.id,
      userId: guardia.id,
      authorName: "Marcos Martinez",
      rating: 5,
      body: "Excelente curso, muy aplicable al trabajo diario en campo.",
      status: "APPROVED",
      createdAt: COMPLETED_PROTECCION
    },
    create: {
      sourceSystem: SEED,
      sourceId: "review-proteccion-guardia",
      courseId: proteccion.course.id,
      userId: guardia.id,
      authorName: "Marcos Martinez",
      rating: 5,
      body: "Excelente curso, muy aplicable al trabajo diario en campo.",
      status: "APPROVED",
      createdAt: COMPLETED_PROTECCION
    }
  });

  // --- Resumen ---
  const [users, roles, courses, modules, lessons, quizzes, questions, options, enrollments, progress, attempts, answers, certs, achievements, steps, awards, achEvents, reviews, prerequisites] =
    await Promise.all([
      prisma.user.count(),
      prisma.userRole.count(),
      prisma.course.count(),
      prisma.courseModule.count(),
      prisma.lesson.count(),
      prisma.quiz.count(),
      prisma.question.count(),
      prisma.questionOption.count(),
      prisma.enrollment.count(),
      prisma.lessonProgress.count(),
      prisma.quizAttempt.count(),
      prisma.quizAnswer.count(),
      prisma.certificate.count(),
      prisma.achievement.count(),
      prisma.achievementStep.count(),
      prisma.achievementAward.count(),
      prisma.achievementEvent.count(),
      prisma.courseReview.count(),
      prisma.coursePrerequisite.count()
    ]);

  const xpTotal = await prisma.achievementEvent.aggregate({ where: { userId: guardia.id }, _sum: { points: true } });

  console.log("Seed aplicado. Conteos:");
  console.table({
    users,
    roles,
    courses,
    modules,
    lessons,
    quizzes,
    questions,
    options,
    enrollments,
    lessonProgress: progress,
    quizAttempts: attempts,
    quizAnswers: answers,
    certificates: certs,
    achievements,
    achievementSteps: steps,
    achievementAwards: awards,
    achievementEvents: achEvents,
    courseReviews: reviews,
    coursePrerequisites: prerequisites
  });
  console.log(`XP total del guardia (AchievementEvent.points): ${xpTotal._sum.points ?? 0}`);
  console.log(`Certificado folio: ${folio}`);
  console.log("Usuarios: admin@tsc.local / instructor@tsc.local / guardia@tsc.local  (password: Capacita2026!)");
  console.log("SEED OK");
}

main()
  .catch((error) => {
    console.error("SEED FALLO:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
