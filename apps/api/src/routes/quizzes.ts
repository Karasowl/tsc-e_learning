import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { gradeQuizSubmission, type GradingQuestion, type SubmittedAnswer } from "../lib/grading.js";
import {
  buildRulesSnapshot,
  effectivePassingPercent,
  parseRulesSnapshot,
  snapshotGradingQuestions
} from "../lib/rules-snapshot.js";
import { isAdmin, requireAuth, type AuthContext } from "../lib/auth.js";
import { recomputeCourseCompletion } from "../lib/course-progress.js";
import { emitStudentNotification } from "../lib/notifications.js";
import { awardQuizPassedBadges } from "../lib/gamification.js";
import { computeCourseLock, computeExamLocked, type CoursePrereq } from "../lib/gating.js";

const startAttemptSchema = z.object({
  quizId: z.string().min(1)
});

const attemptRefSchema = z.object({
  attemptId: z.string().min(1)
});

const submitAttemptSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      selectedOptionIds: z.array(z.string().min(1)).optional(),
      text: z.string().optional(),
      matches: z
        .array(z.object({ optionId: z.string().min(1), value: z.string() }))
        .optional()
    })
  )
});

type QuizWithCourseAndQuestions = Awaited<ReturnType<typeof loadQuizForAttempt>>;

export async function registerQuizRoutes(server: FastifyInstance) {
  server.post("/quizzes/attempts", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const parsed = startAttemptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const quiz = await loadQuizForAttempt(parsed.data.quizId, auth.userId);
    if (!quiz) {
      return reply.code(404).send({ error: "No se encontró el examen" });
    }

    if (!canUseQuiz(auth, quiz.course.teacherId, quiz.course.enrollments.length > 0)) {
      return reply.code(403).send({ error: "No tienes acceso a este examen" });
    }

    // Un examen no publicado (borrador o archivado) no existe para el alumno:
    // solo el dueño del curso o un admin pueden presentarlo (preview/autoría).
    // La completitud del curso solo cuenta exámenes PUBLISHED, así que dejar
    // iniciar intentos de borradores producía intentos que jamás contaban.
    if (!quizAvailableForAttempt({
      status: quiz.status,
      isOwnerTeacher: auth.roles.includes("TEACHER") && quiz.course.teacherId === auth.userId,
      isAdmin: isAdmin(auth)
    })) {
      return reply.code(404).send({ error: "No se encontró el examen" });
    }

    // Bloqueo duro (Fase C): el estudiante no puede presentar el examen si el
    // curso esta bloqueado por prerrequisitos o si aun no completo TODAS las
    // lecciones del curso. Docentes/admin quedan exentos (preview/autoria). El
    // rechazo es 409 y ocurre antes de crear/retomar cualquier intento.
    if (!isTeacherOrAdmin(auth)) {
      const [prerequisites, completedCourseIds, totalLessons, completedLessons] = await Promise.all([
        coursePrerequisites(quiz.courseId),
        completedCourseIdSet(auth.userId),
        getPrisma().lesson.count({ where: { courseId: quiz.courseId } }),
        getPrisma().lessonProgress.count({
          where: { userId: auth.userId, lesson: { courseId: quiz.courseId }, completedAt: { not: null } }
        })
      ]);
      const gate = resolveExamStartGate({ prerequisites, completedCourseIds, totalLessons, completedLessons });
      if (!gate.allowed) {
        return reply.code(409).send({ error: gate.message });
      }
    }

    const activeAttempt = await getPrisma().quizAttempt.findFirst({
      where: {
        quizId: quiz.id,
        userId: auth.userId,
        status: "IN_PROGRESS"
      },
      orderBy: { startedAt: "desc" }
    });

    if (activeAttempt && (!activeAttempt.dueAt || activeAttempt.dueAt > new Date())) {
      return {
        attempt: serializeAttempt(activeAttempt),
        questions: publicQuestions(orderQuestionsForAttempt(quiz.questions, activeAttempt.questionOrder), activeAttempt.id)
      };
    }

    if (!isTeacherOrAdmin(auth) && quiz.maxAttempts) {
      const usedAttempts = await getPrisma().quizAttempt.count({
        where: {
          quizId: quiz.id,
          userId: auth.userId,
          status: { not: "VOIDED" }
        }
      });

      if (usedAttempts >= quiz.maxAttempts) {
        return reply.code(409).send({ error: "Alcanzaste el límite de intentos de este examen" });
      }
    }

    const startedAt = new Date();
    const dueAt = quiz.timeLimitSec ? new Date(startedAt.getTime() + quiz.timeLimitSec * 1000) : null;
    const questions = orderedQuestionsForNewAttempt(quiz);
    const totalMarks = questions.reduce((sum, question) => sum + question.points.toNumber(), 0);

    // Freeze the rules the student rents this attempt under: passing threshold,
    // questions + correct keys, and the timer. Grading and the report read this
    // seal, so editing the exam afterward can't rewrite the historical verdict.
    const rulesSnapshot = buildRulesSnapshot({
      courseVersion: quiz.course.version,
      passingScorePercent: quiz.passingScorePercent === null ? null : quiz.passingScorePercent.toNumber(),
      timeLimitSec: quiz.timeLimitSec,
      questions: toGradingQuestions(questions),
      capturedAt: startedAt
    });

    const attempt = await getPrisma().quizAttempt.create({
      data: {
        quizId: quiz.id,
        userId: auth.userId,
        startedAt,
        dueAt,
        totalQuestions: questions.length,
        totalMarks,
        questionOrder: questions.map((question) => question.id),
        rulesSnapshot: rulesSnapshot as unknown as Prisma.InputJsonValue,
        rulesVersion: quiz.course.version
      }
    });

    return reply.code(201).send({
      attempt: serializeAttempt(attempt),
      questions: publicQuestions(questions, attempt.id)
    });
  });

  server.get("/quizzes/attempts/:attemptId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const parsed = attemptRefSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const attempt = await getPrisma().quizAttempt.findUnique({
      where: { id: parsed.data.attemptId },
      include: {
        quiz: {
          include: {
            questions: {
              include: { options: true },
              orderBy: { position: "asc" }
            },
            course: {
              include: {
                enrollments: {
                  where: { userId: auth.userId },
                  take: 1
                }
              }
            }
          }
        },
        answers: true
      }
    });

    if (!attempt) {
      return reply.code(404).send({ error: "No se encontró el intento" });
    }

    if (attempt.userId !== auth.userId && !canUseQuiz(auth, attempt.quiz.course.teacherId, attempt.quiz.course.enrollments.length > 0)) {
      return reply.code(403).send({ error: "No tienes acceso a este intento" });
    }

    const questions = orderQuestionsForAttempt(attempt.quiz.questions, attempt.questionOrder);

    return {
      attempt: serializeAttempt(attempt),
      questions: publicQuestions(questions, attempt.id),
      answers: attempt.answers.map((answer) => ({
        questionId: answer.questionId,
        response: answer.response,
        score: decimalToNumber(answer.score),
        gradedAt: answer.gradedAt
      }))
    };
  });

  server.post("/quizzes/attempts/:attemptId/submit", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const params = attemptRefSchema.safeParse(request.params);
    const body = submitAttemptSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: {
          params: params.success ? undefined : params.error.flatten(),
          body: body.success ? undefined : body.error.flatten()
        }
      });
    }

    const attempt = await getPrisma().quizAttempt.findUnique({
      where: { id: params.data.attemptId },
      include: {
        quiz: {
          include: {
            questions: {
              include: { options: true },
              orderBy: { position: "asc" }
            },
            course: true
          }
        }
      }
    });

    if (!attempt) {
      return reply.code(404).send({ error: "No se encontró el intento" });
    }

    if (attempt.userId !== auth.userId) {
      return reply.code(403).send({ error: "Solo quien inició el intento puede enviar respuestas" });
    }

    if (attempt.status !== "IN_PROGRESS") {
      return reply.code(409).send({ error: "Este intento ya no está en curso", attempt: serializeAttempt(attempt) });
    }

    const now = new Date();
    if (attempt.dueAt && attempt.dueAt < now) {
      const expired = await getPrisma().quizAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "EXPIRED",
          submittedAt: now
        }
      });

      return reply.code(409).send({ error: "Se agotó el tiempo del examen", attempt: serializeAttempt(expired) });
    }

    // Grade against the sealed rules (frozen questions + correct keys + passing
    // threshold) when the attempt has a snapshot; older attempts without one
    // fall back to the live quiz, preserving prior behavior.
    const snapshot = parseRulesSnapshot(attempt.rulesSnapshot);
    const liveQuestions = orderQuestionsForAttempt(attempt.quiz.questions, attempt.questionOrder);
    const gradingQuestions = snapshot ? snapshotGradingQuestions(snapshot) : toGradingQuestions(liveQuestions);
    const grade = gradeQuizSubmission(gradingQuestions, body.data.answers as SubmittedAnswer[]);
    const passingScorePercent = effectivePassingPercent(
      snapshot,
      attempt.quiz.passingScorePercent === null ? null : attempt.quiz.passingScorePercent.toNumber()
    );
    const passed = grade.scorePercent >= passingScorePercent;
    const status = passed ? "PASSED" : "FAILED";
    const result = passed ? "pass" : "fail";

    await Promise.all(
      grade.results.map((questionGrade) =>
        getPrisma().quizAnswer.upsert({
          where: {
            attemptId_questionId: {
              attemptId: attempt.id,
              questionId: questionGrade.questionId
            }
          },
          update: {
            response: questionGrade,
            score: questionGrade.score,
            gradedAt: now
          },
          create: {
            attemptId: attempt.id,
            questionId: questionGrade.questionId,
            response: questionGrade,
            score: questionGrade.score,
            gradedAt: now
          }
        })
      )
    );

    const updatedAttempt = await getPrisma().quizAttempt.update({
      where: { id: attempt.id },
      data: {
        status,
        submittedAt: now,
        totalQuestions: grade.totalQuestions,
        totalAnsweredQuestions: grade.totalAnsweredQuestions,
        totalMarks: grade.totalMarks,
        earnedMarks: grade.earnedMarks,
        scorePercent: grade.scorePercent,
        result
      }
    });

    await logQuizOutcome(updatedAttempt.id, attempt.quiz.courseId, auth.userId, passed, {
      quizId: attempt.quizId,
      quizTitle: attempt.quiz.title,
      courseTitle: attempt.quiz.course.title,
      scorePercent: grade.scorePercent,
      passingScorePercent
    });

    // Insignias reales por aprobar examen (y por 100% de aciertos). Idempotente.
    // Al aprobar tambien se recalcula la finalizacion del curso: el examen final
    // se desbloquea con todas las lecciones completas, asi que este es el ultimo
    // requisito y sin este recomputo la inscripcion quedaba ACTIVE al 100% para
    // siempre (y el diploma, inalcanzable). Dispara exactamente los mismos
    // efectos de finalizacion que la ruta de completar leccion.
    let courseProgress = null;
    if (passed) {
      await awardQuizPassedBadges(getPrisma(), {
        userId: auth.userId,
        courseId: attempt.quiz.courseId,
        scorePercent: grade.scorePercent
      });
      courseProgress = await recomputeCourseCompletion(getPrisma(), {
        userId: auth.userId,
        courseId: attempt.quiz.courseId,
        courseTitle: attempt.quiz.course.title,
        completedAt: now
      });
    }

    return {
      attempt: serializeAttempt(updatedAttempt),
      grade,
      // Aditivo: el frontend refresca por GET, pero aqui ya puede saber si el
      // curso quedo completado con este envio.
      courseProgress
    };
  });
}

async function loadQuizForAttempt(quizId: string, userId: string) {
  return getPrisma().quiz.findUnique({
    where: { id: quizId },
    include: {
      course: {
        include: {
          enrollments: {
            where: { userId },
            take: 1
          }
        }
      },
      questions: {
        include: {
          options: true
        },
        orderBy: { position: "asc" }
      }
    }
  });
}

/**
 * Un examen solo puede presentarse cuando está PUBLISHED, salvo para el docente
 * dueño del curso o un admin (preview/autoría de borradores y archivados).
 * Pura y total para poder probarla sin base de datos.
 */
export function quizAvailableForAttempt(input: {
  status: string;
  isOwnerTeacher: boolean;
  isAdmin: boolean;
}): boolean {
  return input.status === "PUBLISHED" || input.isOwnerTeacher || input.isAdmin;
}

/**
 * Enforcement (bloqueo duro, Fase C) para iniciar el intento de examen. El
 * examen queda bloqueado si el curso tiene prerrequisitos sin completar o si el
 * estudiante no ha completado TODAS las lecciones del curso. Pura y total para
 * poder probarla sin base de datos.
 */
export function resolveExamStartGate(input: {
  prerequisites: CoursePrereq[];
  completedCourseIds: Set<string>;
  totalLessons: number;
  completedLessons: number;
}): { allowed: boolean; message?: string } {
  const lock = computeCourseLock(input.prerequisites, input.completedCourseIds);
  if (lock.locked) {
    return { allowed: false, message: `Este curso está bloqueado: ${lock.lockReason}` };
  }

  if (computeExamLocked(input.totalLessons, input.completedLessons)) {
    return { allowed: false, message: "Completa todas las lecciones antes de presentar el examen." };
  }

  return { allowed: true };
}

/** Prerrequisitos del curso, mapeados a la forma que consume computeCourseLock. */
async function coursePrerequisites(courseId: string): Promise<CoursePrereq[]> {
  const rows = await getPrisma().coursePrerequisite.findMany({
    where: { courseId },
    include: { requires: { select: { id: true, title: true } } }
  });
  return rows.map((row) => ({ requiresId: row.requiresId, requiresTitle: row.requires.title }));
}

/** Conjunto de courseId que el usuario ya COMPLETO (inscripcion COMPLETED). */
async function completedCourseIdSet(userId: string): Promise<Set<string>> {
  const rows = await getPrisma().enrollment.findMany({
    where: { userId, status: "COMPLETED" },
    select: { courseId: true }
  });
  return new Set(rows.map((row) => row.courseId));
}

function canUseQuiz(auth: AuthContext, teacherId: string | null, isEnrolled: boolean) {
  return isAdmin(auth) || (auth.roles.includes("TEACHER") && teacherId === auth.userId) || isEnrolled;
}

function isTeacherOrAdmin(auth: AuthContext) {
  return auth.roles.includes("ADMIN") || auth.roles.includes("TEACHER");
}

function orderedQuestionsForNewAttempt(quiz: NonNullable<QuizWithCourseAndQuestions>) {
  const questions = [...quiz.questions];
  if (quiz.questionsOrder === "rand") {
    return shuffle(questions);
  }
  return questions;
}

function orderQuestionsForAttempt<T extends { id: string; position: number }>(questions: T[], questionOrder: string[]) {
  if (questionOrder.length === 0) {
    return [...questions].sort((left, right) => left.position - right.position);
  }

  const order = new Map(questionOrder.map((questionId, index) => [questionId, index]));
  return [...questions].sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}

function publicQuestions(
  questions: Array<{
    id: string;
    type: string;
    prompt: string;
    description: string | null;
    position: number;
    points: Prisma.Decimal;
    options: Array<{
      id: string;
      label: string;
      value: string;
      gapMatch: string | null;
      position: number;
    }>;
  }>,
  attemptId: string
) {
  return questions.map((question, index) => {
    const base = {
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      description: question.description,
      position: index + 1,
      points: question.points.toNumber()
    };

    // MATCHING: expose left terms in order + a shuffled pool of the right-side
    // matches (never paired, so the answer is not revealed).
    if (question.type === "MATCHING") {
      const left = [...question.options]
        .sort((leftOption, rightOption) => leftOption.position - rightOption.position)
        .map((option) => ({ id: option.id, label: option.label, value: option.value }));
      const matchPool = seededShuffle(
        Array.from(new Set(question.options.map((option) => option.gapMatch ?? "").filter((value) => value.length > 0))),
        `${attemptId}:${question.id}:pool`
      );
      return { ...base, options: left, matchPool };
    }

    // ORDERING: shuffle the items (stable per attempt) so the correct order is
    // not revealed; the student reorders them.
    if (question.type === "ORDERING") {
      const shuffled = seededShuffle([...question.options], `${attemptId}:${question.id}`).map((option) => ({
        id: option.id,
        label: option.label,
        value: option.value
      }));
      return { ...base, options: shuffled };
    }

    const options = [...question.options]
      .sort((leftOption, rightOption) => leftOption.position - rightOption.position)
      .map((option) => ({ id: option.id, label: option.label, value: option.value }));
    return { ...base, options };
  });
}

// Deterministic shuffle (mulberry32-style PRNG seeded by a string) so options
// stay stable across reloads of the same attempt without persisting extra state.
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

function toGradingQuestions(
  questions: Array<{
    id: string;
    type: string;
    points: Prisma.Decimal;
    options: Array<{
      id: string;
      label: string;
      value: string;
      gapMatch: string | null;
      isCorrect: boolean;
      position: number;
    }>;
  }>
): GradingQuestion[] {
  return questions.map((question) => ({
    id: question.id,
    type: question.type as GradingQuestion["type"],
    points: question.points.toNumber(),
    options: question.options.map((option) => ({
      id: option.id,
      label: option.label,
      value: option.value,
      gapMatch: option.gapMatch,
      isCorrect: option.isCorrect,
      position: option.position
    }))
  }));
}

async function logQuizOutcome(
  attemptId: string,
  courseId: string,
  userId: string,
  passed: boolean,
  payload: Record<string, unknown>
) {
  await emitStudentNotification({
    eventType: passed ? "QUIZ_PASSED" : "QUIZ_FAILED",
    userId,
    courseId,
    payload: {
      ...payload,
      attemptId
    }
  });
}

function serializeAttempt(attempt: {
  id: string;
  quizId: string;
  userId: string;
  status: string;
  startedAt: Date;
  dueAt: Date | null;
  submittedAt: Date | null;
  scorePercent: Prisma.Decimal | null;
  totalQuestions: number | null;
  totalAnsweredQuestions: number | null;
  totalMarks: Prisma.Decimal | null;
  earnedMarks: Prisma.Decimal | null;
  result: string | null;
}) {
  return {
    id: attempt.id,
    quizId: attempt.quizId,
    userId: attempt.userId,
    status: attempt.status,
    startedAt: attempt.startedAt,
    dueAt: attempt.dueAt,
    submittedAt: attempt.submittedAt,
    scorePercent: decimalToNumber(attempt.scorePercent),
    totalQuestions: attempt.totalQuestions,
    totalAnsweredQuestions: attempt.totalAnsweredQuestions,
    totalMarks: decimalToNumber(attempt.totalMarks),
    earnedMarks: decimalToNumber(attempt.earnedMarks),
    result: attempt.result
  };
}

function decimalToNumber(value: Prisma.Decimal | null) {
  return value === null ? null : value.toNumber();
}

function shuffle<T>(items: T[]) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = items[index]!;
    items[index] = items[swapIndex]!;
    items[swapIndex] = current;
  }
  return items;
}
