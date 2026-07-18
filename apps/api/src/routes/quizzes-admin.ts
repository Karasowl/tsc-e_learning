import { getPrisma } from "@tsc-capacita/db";
import type { Prisma, QuestionType, QuizStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAdmin, isTeacherOrAdmin, requireAuth, type AuthContext } from "../lib/auth.js";
import { recomputeCourseCompletionForCourse } from "../lib/course-progress.js";

const courseIdParamSchema = z.object({
  courseId: z.string().min(1)
});

const quizIdParamSchema = z.object({
  quizId: z.string().min(1)
});

const questionIdParamSchema = z.object({
  questionId: z.string().min(1)
});

const quizStatusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);

// OPEN_ENDED is intentionally excluded: open answers can't be auto-graded, so
// the product does not create them. Leaving it out of the accepted input types
// makes both create and update reject OPEN_ENDED with a 400. The Prisma enum
// still carries OPEN_ENDED so any imported/legacy question keeps rendering.
const questionTypeSchema = z.enum([
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
  "FILL_IN_THE_BLANK",
  "SHORT_TEXT",
  "MATCHING",
  "ORDERING"
]);

const createQuizSchema = z.object({
  title: z.string().min(1),
  moduleId: z.string().min(1).optional(),
  timeLimitSec: z.number().int().positive().optional(),
  passingScorePercent: z.number().min(0).max(100).optional(),
  maxAttempts: z.number().int().positive().optional(),
  feedbackMode: z.string().min(1).optional(),
  questionsOrder: z.string().min(1).optional(),
  autoStart: z.boolean().optional(),
  hideTimeDisplay: z.boolean().optional(),
  status: quizStatusSchema.optional()
});

const updateQuizSchema = z.object({
  title: z.string().min(1).optional(),
  moduleId: z.string().min(1).nullable().optional(),
  timeLimitSec: z.number().int().positive().nullable().optional(),
  passingScorePercent: z.number().min(0).max(100).nullable().optional(),
  maxAttempts: z.number().int().positive().nullable().optional(),
  feedbackMode: z.string().min(1).nullable().optional(),
  questionsOrder: z.string().min(1).nullable().optional(),
  autoStart: z.boolean().optional(),
  hideTimeDisplay: z.boolean().optional(),
  status: quizStatusSchema.optional()
});

const optionInputSchema = z.object({
  label: z.string().optional(),
  value: z.string().min(1),
  gapMatch: z.string().optional(),
  isCorrect: z.boolean().optional(),
  position: z.number().int().min(0).optional()
});

const createQuestionSchema = z.object({
  type: questionTypeSchema,
  prompt: z.string().min(1),
  description: z.string().optional(),
  explanation: z.string().optional(),
  points: z.number().positive().optional(),
  position: z.number().int().min(0).optional(),
  correctValue: z.boolean().optional(),
  options: z.array(optionInputSchema).optional()
});

const updateQuestionSchema = z.object({
  type: questionTypeSchema.optional(),
  prompt: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  explanation: z.string().nullable().optional(),
  points: z.number().positive().optional(),
  position: z.number().int().min(0).optional(),
  correctValue: z.boolean().optional(),
  options: z.array(optionInputSchema).optional()
});

type OptionInput = z.infer<typeof optionInputSchema>;

export async function registerQuizAdminRoutes(server: FastifyInstance) {
  server.post("/admin/courses/:courseId/quizzes", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = courseIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const body = createQuizSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const course = await getPrisma().course.findUnique({
      where: { id: params.data.courseId }
    });

    if (!course) {
      return reply.code(404).send({ error: "No se encontró el curso" });
    }

    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
    }

    if (body.data.moduleId) {
      const moduleOk = await moduleBelongsToCourse(body.data.moduleId, course.id);
      if (!moduleOk) {
        return reply.code(400).send({ error: "La sección no pertenece a este curso" });
      }
    }

    const slug = await uniqueQuizSlug(course.id, body.data.title);
    const position = await nextQuizPosition(course.id);

    const quiz = await getPrisma().quiz.create({
      data: {
        courseId: course.id,
        moduleId: body.data.moduleId ?? null,
        title: body.data.title,
        slug,
        status: (body.data.status ?? "DRAFT") as QuizStatus,
        position,
        timeLimitSec: body.data.timeLimitSec ?? null,
        passingScorePercent: body.data.passingScorePercent ?? null,
        maxAttempts: body.data.maxAttempts ?? null,
        feedbackMode: body.data.feedbackMode ?? null,
        questionsOrder: body.data.questionsOrder ?? null,
        autoStart: body.data.autoStart ?? false,
        hideTimeDisplay: body.data.hideTimeDisplay ?? false
      }
    });

    return reply.code(201).send({ quiz: serializeQuiz(quiz) });
  });

  server.get("/admin/quizzes/:quizId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = quizIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const quiz = await getPrisma().quiz.findUnique({
      where: { id: params.data.quizId },
      include: {
        course: true,
        questions: {
          orderBy: { position: "asc" },
          include: { options: { orderBy: { position: "asc" } } }
        }
      }
    });

    if (!quiz) {
      return reply.code(404).send({ error: "No se encontró el examen" });
    }

    if (!canEditCourse(auth, quiz.course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
    }

    return {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        moduleId: quiz.moduleId,
        status: quiz.status,
        timeLimitSec: quiz.timeLimitSec,
        passingScorePercent: quiz.passingScorePercent === null ? null : Number(quiz.passingScorePercent),
        maxAttempts: quiz.maxAttempts,
        feedbackMode: quiz.feedbackMode,
        questionsOrder: quiz.questionsOrder,
        autoStart: quiz.autoStart,
        hideTimeDisplay: quiz.hideTimeDisplay,
        questions: quiz.questions.map((question) => ({
          id: question.id,
          type: question.type,
          prompt: question.prompt,
          description: question.description,
          explanation: question.explanation,
          position: question.position,
          points: Number(question.points),
          options: question.options.map((option) => ({
            id: option.id,
            label: option.label,
            value: option.value,
            gapMatch: option.gapMatch,
            position: option.position,
            isCorrect: option.isCorrect
          }))
        }))
      }
    };
  });

  server.put("/admin/quizzes/:quizId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = quizIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const body = updateQuizSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const quiz = await getPrisma().quiz.findUnique({
      where: { id: params.data.quizId },
      include: { course: true }
    });

    if (!quiz) {
      return reply.code(404).send({ error: "No se encontró el examen" });
    }

    if (!canEditCourse(auth, quiz.course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
    }

    if (body.data.moduleId) {
      const moduleOk = await moduleBelongsToCourse(body.data.moduleId, quiz.courseId);
      if (!moduleOk) {
        return reply.code(400).send({ error: "La sección no pertenece a este curso" });
      }
    }

    const data: Prisma.QuizUpdateInput = {};
    if (body.data.title !== undefined) {
      data.title = body.data.title;
    }
    if (body.data.moduleId !== undefined) {
      data.module = body.data.moduleId
        ? { connect: { id: body.data.moduleId } }
        : { disconnect: true };
    }
    if (body.data.timeLimitSec !== undefined) {
      data.timeLimitSec = body.data.timeLimitSec;
    }
    if (body.data.passingScorePercent !== undefined) {
      data.passingScorePercent = body.data.passingScorePercent;
    }
    if (body.data.maxAttempts !== undefined) {
      data.maxAttempts = body.data.maxAttempts;
    }
    if (body.data.feedbackMode !== undefined) {
      data.feedbackMode = body.data.feedbackMode;
    }
    if (body.data.questionsOrder !== undefined) {
      data.questionsOrder = body.data.questionsOrder;
    }
    if (body.data.autoStart !== undefined) {
      data.autoStart = body.data.autoStart;
    }
    if (body.data.hideTimeDisplay !== undefined) {
      data.hideTimeDisplay = body.data.hideTimeDisplay;
    }
    if (body.data.status !== undefined) {
      data.status = body.data.status as QuizStatus;
    }

    const updated = await getPrisma().quiz.update({
      where: { id: quiz.id },
      data
    });

    // Despublicar un examen puede dejar el curso sin requisito de examen: los
    // alumnos con lecciones al 100% deben poder completar sin acción posible de
    // su lado, así que se recomputa aquí (best-effort, tras la mutación).
    if (body.data.status !== undefined && quiz.status === "PUBLISHED" && body.data.status !== "PUBLISHED") {
      await recomputeCompletionsBestEffort(quiz.courseId, quiz.course.title, request.log);
    }

    return { quiz: serializeQuiz(updated) };
  });

  server.delete("/admin/quizzes/:quizId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = quizIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const quiz = await getPrisma().quiz.findUnique({
      where: { id: params.data.quizId },
      include: { course: true }
    });

    if (!quiz) {
      return reply.code(404).send({ error: "No se encontró el examen" });
    }

    if (!canEditCourse(auth, quiz.course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
    }

    await getPrisma().quiz.delete({ where: { id: quiz.id } });

    // Borrar un examen publicado puede eliminar el último requisito de examen
    // del curso: recomputa la finalización de los alumnos con lecciones al 100%.
    if (quiz.status === "PUBLISHED") {
      await recomputeCompletionsBestEffort(quiz.courseId, quiz.course.title, request.log);
    }

    return { deleted: true };
  });

  server.post("/admin/quizzes/:quizId/questions", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = quizIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const body = createQuestionSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const quiz = await getPrisma().quiz.findUnique({
      where: { id: params.data.quizId },
      include: { course: true }
    });

    if (!quiz) {
      return reply.code(404).send({ error: "No se encontró el examen" });
    }

    if (!canEditCourse(auth, quiz.course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
    }

    const options = buildOptionsForType(body.data.type, body.data.options, body.data.correctValue);
    const position = body.data.position ?? (await nextQuestionPosition(quiz.id));

    const question = await getPrisma().$transaction(async (tx) => {
      const created = await tx.question.create({
        data: {
          quizId: quiz.id,
          type: body.data.type as QuestionType,
          prompt: body.data.prompt,
          description: body.data.description ?? null,
          explanation: body.data.explanation ?? null,
          position,
          points: body.data.points ?? 1
        }
      });

      if (options.length > 0) {
        await tx.questionOption.createMany({
          data: options.map((option) => ({
            questionId: created.id,
            label: option.label,
            value: option.value,
            gapMatch: option.gapMatch,
            position: option.position,
            isCorrect: option.isCorrect
          }))
        });
      }

      return tx.question.findUniqueOrThrow({
        where: { id: created.id },
        include: { options: { orderBy: { position: "asc" } } }
      });
    });

    return reply.code(201).send({ question: serializeQuestion(question) });
  });

  server.put("/admin/questions/:questionId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = questionIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const body = updateQuestionSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const question = await getPrisma().question.findUnique({
      where: { id: params.data.questionId },
      include: { quiz: { include: { course: true } } }
    });

    if (!question) {
      return reply.code(404).send({ error: "No se encontró la pregunta" });
    }

    if (!canEditCourse(auth, question.quiz.course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
    }

    // The effective type drives how new options are interpreted, even when only
    // the options array is replaced without changing the stored type.
    const effectiveType = (body.data.type ?? question.type) as QuestionType;
    const options = body.data.options
      ? buildOptionsForType(effectiveType, body.data.options, body.data.correctValue)
      : null;

    const updated = await getPrisma().$transaction(async (tx) => {
      const data: Prisma.QuestionUpdateInput = {};
      if (body.data.type !== undefined) {
        data.type = body.data.type as QuestionType;
      }
      if (body.data.prompt !== undefined) {
        data.prompt = body.data.prompt;
      }
      if (body.data.description !== undefined) {
        data.description = body.data.description;
      }
      if (body.data.explanation !== undefined) {
        data.explanation = body.data.explanation;
      }
      if (body.data.points !== undefined) {
        data.points = body.data.points;
      }
      if (body.data.position !== undefined) {
        data.position = body.data.position;
      }

      await tx.question.update({
        where: { id: question.id },
        data
      });

      if (options) {
        await tx.questionOption.deleteMany({ where: { questionId: question.id } });
        if (options.length > 0) {
          await tx.questionOption.createMany({
            data: options.map((option) => ({
              questionId: question.id,
              label: option.label,
              value: option.value,
              gapMatch: option.gapMatch,
              position: option.position,
              isCorrect: option.isCorrect
            }))
          });
        }
      }

      return tx.question.findUniqueOrThrow({
        where: { id: question.id },
        include: { options: { orderBy: { position: "asc" } } }
      });
    });

    return { question: serializeQuestion(updated) };
  });

  server.delete("/admin/questions/:questionId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = questionIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const question = await getPrisma().question.findUnique({
      where: { id: params.data.questionId },
      include: { quiz: { include: { course: true } } }
    });

    if (!question) {
      return reply.code(404).send({ error: "No se encontró la pregunta" });
    }

    if (!canEditCourse(auth, question.quiz.course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
    }

    await getPrisma().question.delete({ where: { id: question.id } });

    return { deleted: true };
  });
}

function canEditCourse(auth: AuthContext, course: { teacherId: string | null }) {
  return isAdmin(auth) || (auth.roles.includes("TEACHER") && course.teacherId === auth.userId);
}

/**
 * Barrido de finalización tras quitar un examen publicado (borrado o
 * despublicación). Best-effort: la mutación principal ya ocurrió y un fallo
 * aquí no debe convertirla en error; solo se registra en el log.
 */
async function recomputeCompletionsBestEffort(
  courseId: string,
  courseTitle: string,
  logger: { warn: (obj: unknown, msg?: string) => void }
) {
  try {
    await recomputeCourseCompletionForCourse(getPrisma(), { courseId, courseTitle });
  } catch (error) {
    logger.warn({ err: error, courseId }, "No se pudo recomputar la finalización del curso tras quitar el examen");
  }
}

type NormalizedOption = {
  label: string;
  value: string;
  gapMatch: string | null;
  position: number;
  isCorrect: boolean;
};

function buildOptionsForType(
  type: QuestionType,
  options: OptionInput[] | undefined,
  correctValue: boolean | undefined
): NormalizedOption[] {
  if (type === "TRUE_FALSE" && (!options || options.length === 0)) {
    return [
      { label: "Verdadero", value: "Verdadero", gapMatch: null, position: 0, isCorrect: correctValue === true },
      { label: "Falso", value: "Falso", gapMatch: null, position: 1, isCorrect: correctValue === false }
    ];
  }

  if (type === "OPEN_ENDED") {
    // Open-ended answers are graded manually; no stored options.
    return [];
  }

  if (!options || options.length === 0) {
    return [];
  }

  return options.map((option, index) => {
    const value = option.value;
    // ORDERING uses position as the correct order (0..n); other types simply
    // need stable, collision-free positions for the @@unique([questionId, position]).
    const position = option.position ?? index;
    return {
      label: option.label ?? value,
      value,
      gapMatch: option.gapMatch ?? null,
      position,
      isCorrect: resolveIsCorrect(type, option)
    };
  });
}

function resolveIsCorrect(type: QuestionType, option: OptionInput): boolean {
  switch (type) {
    // Accepted-answer style questions: every supplied option is a correct answer.
    case "FILL_IN_THE_BLANK":
    case "SHORT_TEXT":
    // Matching pairs and ordered items are always "correct" rows; the pairing /
    // position carries the grading information.
    case "MATCHING":
    case "ORDERING":
      return true;
    // Choice-style questions honor the explicit isCorrect flag.
    case "SINGLE_CHOICE":
    case "MULTIPLE_CHOICE":
    case "TRUE_FALSE":
    default:
      return option.isCorrect === true;
  }
}

async function moduleBelongsToCourse(moduleId: string, courseId: string) {
  const module = await getPrisma().courseModule.findUnique({
    where: { id: moduleId }
  });
  return Boolean(module && module.courseId === courseId);
}

async function nextQuizPosition(courseId: string) {
  const top = await getPrisma().quiz.findFirst({
    where: { courseId },
    orderBy: { position: "desc" },
    select: { position: true }
  });
  return top ? top.position + 1 : 0;
}

async function nextQuestionPosition(quizId: string) {
  const top = await getPrisma().question.findFirst({
    where: { quizId },
    orderBy: { position: "desc" },
    select: { position: true }
  });
  return top ? top.position + 1 : 0;
}

async function uniqueQuizSlug(courseId: string, title: string) {
  const base = slugify(title) || "quiz";
  let candidate = base;
  let suffix = 1;

  // Guard against the @@unique([courseId, slug]) constraint.
  while (await getPrisma().quiz.findUnique({ where: { courseId_slug: { courseId, slug: candidate } } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function serializeQuiz(quiz: {
  id: string;
  courseId: string;
  moduleId: string | null;
  title: string;
  slug: string;
  status: QuizStatus;
  position: number;
  timeLimitSec: number | null;
  passingScorePercent: Prisma.Decimal | null;
  maxAttempts: number | null;
  feedbackMode: string | null;
  questionsOrder: string | null;
  autoStart: boolean;
  hideTimeDisplay: boolean;
}) {
  return {
    id: quiz.id,
    courseId: quiz.courseId,
    moduleId: quiz.moduleId,
    title: quiz.title,
    slug: quiz.slug,
    status: quiz.status,
    position: quiz.position,
    timeLimitSec: quiz.timeLimitSec,
    passingScorePercent: decimalToNumber(quiz.passingScorePercent),
    maxAttempts: quiz.maxAttempts,
    feedbackMode: quiz.feedbackMode,
    questionsOrder: quiz.questionsOrder,
    autoStart: quiz.autoStart,
    hideTimeDisplay: quiz.hideTimeDisplay
  };
}

function serializeQuestion(question: {
  id: string;
  quizId: string;
  type: QuestionType;
  prompt: string;
  description: string | null;
  explanation: string | null;
  position: number;
  points: Prisma.Decimal;
  options: Array<{
    id: string;
    label: string;
    value: string;
    gapMatch: string | null;
    position: number;
    isCorrect: boolean;
  }>;
}) {
  return {
    id: question.id,
    quizId: question.quizId,
    type: question.type,
    prompt: question.prompt,
    description: question.description,
    explanation: question.explanation,
    position: question.position,
    points: question.points.toNumber(),
    options: question.options.map((option) => ({
      id: option.id,
      label: option.label,
      value: option.value,
      gapMatch: option.gapMatch,
      position: option.position,
      isCorrect: option.isCorrect
    }))
  };
}

function decimalToNumber(value: Prisma.Decimal | null) {
  return value === null ? null : value.toNumber();
}
