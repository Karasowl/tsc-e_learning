import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { gradeQuizSubmission, type GradingQuestion, type SubmittedAnswer } from "../lib/grading.js";
import { isAdmin, requireAuth, type AuthContext } from "../lib/auth.js";
import { emitStudentNotification } from "../lib/notifications.js";
import { awardQuizPassedBadges } from "../lib/gamification.js";

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
      return reply.code(404).send({ error: "Quiz not found" });
    }

    if (!canUseQuiz(auth, quiz.course.teacherId, quiz.course.enrollments.length > 0)) {
      return reply.code(403).send({ error: "Quiz access denied" });
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
        return reply.code(409).send({ error: "Quiz attempt limit reached" });
      }
    }

    const startedAt = new Date();
    const dueAt = quiz.timeLimitSec ? new Date(startedAt.getTime() + quiz.timeLimitSec * 1000) : null;
    const questions = orderedQuestionsForNewAttempt(quiz);
    const totalMarks = questions.reduce((sum, question) => sum + question.points.toNumber(), 0);

    const attempt = await getPrisma().quizAttempt.create({
      data: {
        quizId: quiz.id,
        userId: auth.userId,
        startedAt,
        dueAt,
        totalQuestions: questions.length,
        totalMarks,
        questionOrder: questions.map((question) => question.id)
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
      return reply.code(404).send({ error: "Attempt not found" });
    }

    if (attempt.userId !== auth.userId && !canUseQuiz(auth, attempt.quiz.course.teacherId, attempt.quiz.course.enrollments.length > 0)) {
      return reply.code(403).send({ error: "Attempt access denied" });
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
      return reply.code(404).send({ error: "Attempt not found" });
    }

    if (attempt.userId !== auth.userId) {
      return reply.code(403).send({ error: "Only the attempt owner can submit answers" });
    }

    if (attempt.status !== "IN_PROGRESS") {
      return reply.code(409).send({ error: "Attempt is not in progress", attempt: serializeAttempt(attempt) });
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

      return reply.code(409).send({ error: "Attempt time limit expired", attempt: serializeAttempt(expired) });
    }

    const questions = orderQuestionsForAttempt(attempt.quiz.questions, attempt.questionOrder);
    const grade = gradeQuizSubmission(toGradingQuestions(questions), body.data.answers as SubmittedAnswer[]);
    const passingScorePercent = attempt.quiz.passingScorePercent?.toNumber() ?? 80;
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
    if (passed) {
      await awardQuizPassedBadges(getPrisma(), {
        userId: auth.userId,
        courseId: attempt.quiz.courseId,
        scorePercent: grade.scorePercent
      });
    }

    return {
      attempt: serializeAttempt(updatedAttempt),
      grade
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
