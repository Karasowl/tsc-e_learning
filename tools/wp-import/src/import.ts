import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

const SOURCE_SYSTEM = "wordpress";

type Args = {
  usersPath: string;
  catalogPath: string;
  assetsRoot?: string;
  apply: boolean;
};

type UsersExport = {
  users: ExportedUser[];
};

type ExportedUser = {
  sourceId: string;
  email: string;
  displayName: string;
  registeredAt: string | null;
  status: "ACTIVE" | "DISABLED";
  serviceLabel: string | null;
  legacyPasswordHash: string;
  legacyPasswordAlgo: string;
  mappedRoles: Array<"ADMIN" | "TEACHER" | "STUDENT">;
};

type CatalogExport = {
  courses: CourseItem[];
  lessons: LessonItem[];
  quizzes: QuizItem[];
  questions: QuestionItem[];
  enrollments: EnrollmentItem[];
  lessonProgress: LessonProgressItem[];
  quizAttempts: QuizAttemptItem[];
  quizAttemptAnswers: QuizAttemptAnswerItem[];
  achievements: AchievementItem[];
  achievementAwards: AchievementAwardItem[];
  attachments?: AttachmentItem[];
  courseCompletionComments: TutorCourseCompletionCommentItem[];
  courseReviews: TutorCourseReviewItem[];
  sectionsByCourseId: Record<string, SectionItem[]>;
  lmsUsage?: {
    featureEvidence?: FeatureEvidenceItem[];
  };
};

type CatalogItem = {
  sourceId: string;
  title: string;
  slug: string;
  status: string;
  authorId: string;
  parentId: string;
  order: number;
  content: string;
  excerpt: string;
  createdAt: string;
  modifiedAt: string;
  meta: Record<string, string[]>;
};

type DurationValue = {
  hours: number | null;
  minutes: number | null;
  seconds: number | null;
};

type VideoValue = {
  source: string | null;
  youtubeUrl: string | null;
  vimeoUrl: string | null;
  externalUrl: string | null;
  embedded: string | null;
  html5: string | null;
  runtime: DurationValue | null;
};

type CourseItem = CatalogItem & {
  level: string | null;
  duration: DurationValue | null;
  thumbnailId: string | null;
};

type LessonItem = CatalogItem & {
  courseId: string | null;
  topicId: string | null;
  video: VideoValue | null;
  attachmentIds: string[];
  durationSec: number | null;
};

type QuizSettings = {
  attemptsAllowed: number | null;
  feedbackMode: string | null;
  hideTimeDisplay: boolean | null;
  passingGrade: number | null;
  questionsOrder: string | null;
  quizAutoStart: boolean | null;
  timeLimit: {
    seconds: number | null;
  } | null;
};

type QuizItem = CatalogItem & {
  courseId: string | null;
  topicId: string | null;
  questionIds: string[];
  settings: QuizSettings | null;
};

type QuestionItem = {
  sourceId: string;
  quizId: string;
  contentId: string | null;
  title: string;
  description: string;
  explanation: string;
  detectedType: string;
  points: number | null;
  order: number | null;
  answerCount: number;
  answers: QuestionAnswerItem[];
};

type QuestionAnswerItem = {
  sourceId: string;
  questionId: string;
  title: string;
  isCorrect: boolean | null;
  order: number | null;
  imageId: string | null;
  gapMatch: string | null;
  viewFormat: string | null;
};

type SectionItem = {
  sourceId: string;
  title: string;
  order: number | null;
  items: Array<{
    sourceId: string;
    type: string;
    title: string;
    order: number | null;
  }>;
};

type EnrollmentItem = {
  sourceId: string;
  userId: string;
  courseId: string;
  status: string;
  enrolledAt: string;
  completedAt: string | null;
};

type LessonProgressItem = {
  userId: string;
  lessonId: string;
  completedAt: string | null;
};

type QuizAttemptItem = {
  sourceId: string;
  userId: string;
  courseId: string;
  quizId: string;
  totalQuestions: number | null;
  totalAnsweredQuestions: number | null;
  totalMarks: number | null;
  earnedMarks: number | null;
  scorePercent: number | null;
  status: string;
  result: string;
  startedAt: string;
  endedAt: string | null;
  attemptInfo: Record<string, unknown> | null;
};

type QuizAttemptAnswerItem = {
  sourceId: string;
  attemptId: string;
  userId: string;
  quizId: string;
  questionId: string;
  givenAnswer: string;
  questionMark: number | null;
  achievedMark: number | null;
  minusMark: number | null;
  isCorrect: boolean | null;
};

type AchievementItem = CatalogItem & {
  points: number | null;
  steps: AchievementStepItem[];
};

type AchievementStepItem = CatalogItem & {
  triggerType: string | null;
  requiredCount: number | null;
};

type AchievementAwardItem = {
  sourceId: string;
  userId: string;
  postId: string;
  postType: string;
  title: string;
  points: number | null;
  pointsType: string | null;
  awardedAt: string;
};

type AttachmentItem = CatalogItem & {
  guid: string;
  mimeType: string | null;
  filePath: string | null;
};

type TutorCourseCompletionCommentItem = {
  sourceId: string;
  courseId: string;
  userId: string;
  token: string;
  createdAt: string;
};

type TutorCourseReviewItem = {
  sourceId: string;
  courseId: string;
  userId: string;
  authorName: string;
  body: string;
  approved: string;
  rating: number | null;
  createdAt: string;
};

type FeatureEvidenceItem = {
  area: string;
  feature: string;
  status: "CONFIRMED" | "CONFIGURED" | "UNUSED" | "UNKNOWN";
  evidence: string;
};

type Placement = {
  moduleSourceId: string;
  position: number;
};

type ImportContext = {
  userIdBySource: Map<string, string>;
  courseIdBySource: Map<string, string>;
  moduleIdBySource: Map<string, string>;
  lessonIdBySource: Map<string, string>;
  quizIdBySource: Map<string, string>;
  questionIdBySource: Map<string, string>;
  attemptIdBySource: Map<string, string>;
  achievementIdBySource: Map<string, string>;
  assetIdBySource: Map<string, string>;
};

type WarningCollector = {
  warnings: string[];
  warn: (message: string) => void;
};

function parseArgs(argv: string[]): Args {
  const usersPath = valueAfter(argv, "--users") ?? "tmp/wp-users.json";
  const catalogPath = valueAfter(argv, "--catalog") ?? "tmp/wp-catalog.json";
  const assetsRoot = valueAfter(argv, "--assets-root");
  const apply = argv.includes("--apply");

  return assetsRoot ? { usersPath, catalogPath, assetsRoot, apply } : { usersPath, catalogPath, apply };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [usersExport, catalog] = await Promise.all([
    readJson<UsersExport>(args.usersPath),
    readJson<CatalogExport>(args.catalogPath)
  ]);
  const warnings = collectWarnings(usersExport, catalog, args.assetsRoot);
  const plan = buildPlan(usersExport, catalog);

  printPlan(plan, warnings.warnings, args.apply);

  if (!args.apply) {
    console.log("Dry run only. Use --apply with DATABASE_URL to write to Postgres.");
    return;
  }

  const prisma = new PrismaClient();
  try {
    await applyImport(prisma, usersExport, catalog, args, warnings);
  } finally {
    await prisma.$disconnect();
  }
}

async function applyImport(
  prisma: PrismaClient,
  usersExport: UsersExport,
  catalog: CatalogExport,
  args: Args,
  warningCollector: WarningCollector
) {
  const ctx: ImportContext = {
    userIdBySource: new Map(),
    courseIdBySource: new Map(),
    moduleIdBySource: new Map(),
    lessonIdBySource: new Map(),
    quizIdBySource: new Map(),
    questionIdBySource: new Map(),
    attemptIdBySource: new Map(),
    achievementIdBySource: new Map(),
    assetIdBySource: new Map()
  };

  await importUsers(prisma, usersExport, ctx);
  await importCourses(prisma, catalog, ctx, warningCollector);
  await importModules(prisma, catalog, ctx, warningCollector);
  await importLessons(prisma, catalog, ctx, warningCollector);
  await importQuizzes(prisma, catalog, ctx, warningCollector);
  await importQuestions(prisma, catalog, ctx, warningCollector);
  await importAssets(prisma, catalog, ctx, args.assetsRoot);
  await linkCourseThumbnails(prisma, catalog, ctx);
  await importEnrollments(prisma, catalog, ctx, warningCollector);
  await importLessonProgress(prisma, catalog, ctx, warningCollector);
  await importQuizAttempts(prisma, catalog, ctx, warningCollector);
  await importAchievements(prisma, catalog, ctx, warningCollector);
  await importAchievementEvents(prisma, catalog, ctx, warningCollector);
  await importCertificates(prisma, catalog, ctx, warningCollector);
  await importCourseReviews(prisma, catalog, ctx, warningCollector);
  await importFeatureEvidence(prisma, catalog);

  console.log("Import applied successfully.");
  if (warningCollector.warnings.length > 0) {
    console.log(`Warnings after apply: ${warningCollector.warnings.length}`);
  }
}

async function importUsers(prisma: PrismaClient, usersExport: UsersExport, ctx: ImportContext) {
  for (const user of usersExport.users) {
    const createdAt = dateOrNow(user.registeredAt);
    const dbUser = await prisma.user.upsert({
      where: sourceWhere(user.sourceId),
      update: {
        email: user.email,
        displayName: user.displayName,
        serviceLabel: user.serviceLabel,
        status: user.status,
        legacyPasswordHash: user.legacyPasswordHash,
        legacyPasswordAlgo: user.legacyPasswordAlgo
      },
      create: {
        email: user.email,
        displayName: user.displayName,
        serviceLabel: user.serviceLabel,
        status: user.status,
        legacyPasswordHash: user.legacyPasswordHash,
        legacyPasswordAlgo: user.legacyPasswordAlgo,
        sourceSystem: SOURCE_SYSTEM,
        sourceId: user.sourceId,
        createdAt
      }
    });

    ctx.userIdBySource.set(user.sourceId, dbUser.id);
    await prisma.userRole.deleteMany({
      where: {
        userId: dbUser.id,
        role: { notIn: user.mappedRoles }
      }
    });

    for (const role of user.mappedRoles) {
      await prisma.userRole.upsert({
        where: {
          userId_role: {
            userId: dbUser.id,
            role
          }
        },
        update: {},
        create: {
          userId: dbUser.id,
          role
        }
      });
    }
  }
}

async function importCourses(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  warningCollector: WarningCollector
) {
  const slugBySource = uniqueSlugBySource(catalog.courses, "course");

  for (const course of catalog.courses) {
    const teacherId = ctx.userIdBySource.get(course.authorId) ?? null;
    const slug = slugBySource.get(course.sourceId) ?? slugOrFallback(course.slug, "course", course.sourceId);
    if (!teacherId && course.authorId) {
      warningCollector.warn(`Course ${course.sourceId} has missing teacher user ${course.authorId}`);
    }

    const dbCourse = await prisma.course.upsert({
      where: sourceWhere(course.sourceId),
      update: {
        title: course.title,
        slug,
        description: nullIfEmpty(course.content),
        excerpt: course.excerpt || null,
        status: mapCourseStatus(course.status),
        teacherId,
        level: course.level,
        durationSec: durationToSeconds(course.duration),
        publishedAt: course.status === "publish" ? dateOrNow(course.createdAt) : null
      },
      create: {
        title: course.title,
        slug,
        description: nullIfEmpty(course.content),
        excerpt: course.excerpt || null,
        status: mapCourseStatus(course.status),
        teacherId,
        level: course.level,
        durationSec: durationToSeconds(course.duration),
        publishedAt: course.status === "publish" ? dateOrNow(course.createdAt) : null,
        sourceSystem: SOURCE_SYSTEM,
        sourceId: course.sourceId,
        createdAt: dateOrNow(course.createdAt)
      }
    });

    ctx.courseIdBySource.set(course.sourceId, dbCourse.id);
  }
}

async function importModules(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  warningCollector: WarningCollector
) {
  for (const course of catalog.courses) {
    const courseId = ctx.courseIdBySource.get(course.sourceId);
    if (!courseId) {
      continue;
    }

    const sections = sortedSections(catalog.sectionsByCourseId[course.sourceId] ?? []);
    for (const [index, section] of sections.entries()) {
      const position = index + 1;
      const moduleSourceId = section.sourceId || `${course.sourceId}:section:${position}`;
      const dbModule = await prisma.courseModule.upsert({
        where: sourceWhere(moduleSourceId),
        update: {
          courseId,
          title: section.title || `Modulo ${position}`,
          position
        },
        create: {
          courseId,
          title: section.title || `Modulo ${position}`,
          position,
          sourceSystem: SOURCE_SYSTEM,
          sourceId: moduleSourceId
        }
      });

      ctx.moduleIdBySource.set(moduleSourceId, dbModule.id);
    }

    if (sections.length === 0) {
      warningCollector.warn(`Course ${course.sourceId} has no curriculum sections`);
    }
  }
}

async function importLessons(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  warningCollector: WarningCollector
) {
  const placementByItem = buildPlacementMap(catalog);

  for (const lesson of catalog.lessons) {
    if (!lesson.courseId) {
      warningCollector.warn(`Lesson ${lesson.sourceId} has no course id`);
      continue;
    }

    const courseId = ctx.courseIdBySource.get(lesson.courseId);
    if (!courseId) {
      warningCollector.warn(`Lesson ${lesson.sourceId} references missing course ${lesson.courseId}`);
      continue;
    }

    const placement = placementByItem.get(lesson.sourceId);
    const moduleId = placement ? ctx.moduleIdBySource.get(placement.moduleSourceId) ?? null : null;
    const dbLesson = await prisma.lesson.upsert({
      where: sourceWhere(lesson.sourceId),
      update: {
        courseId,
        moduleId,
        title: lesson.title,
        slug: slugOrFallback(lesson.slug, "lesson", lesson.sourceId),
        kind: lessonKind(lesson),
        body: nullIfEmpty(lesson.content),
        videoProvider: lesson.video?.source ?? null,
        videoUrl: lessonVideoUrl(lesson.video),
        videoEmbed: lesson.video?.embedded ?? null,
        position: placement?.position ?? positivePosition(lesson.order),
        durationSec: lesson.durationSec
      },
      create: {
        courseId,
        moduleId,
        title: lesson.title,
        slug: slugOrFallback(lesson.slug, "lesson", lesson.sourceId),
        kind: lessonKind(lesson),
        body: nullIfEmpty(lesson.content),
        videoProvider: lesson.video?.source ?? null,
        videoUrl: lessonVideoUrl(lesson.video),
        videoEmbed: lesson.video?.embedded ?? null,
        position: placement?.position ?? positivePosition(lesson.order),
        durationSec: lesson.durationSec,
        sourceSystem: SOURCE_SYSTEM,
        sourceId: lesson.sourceId
      }
    });

    ctx.lessonIdBySource.set(lesson.sourceId, dbLesson.id);
  }
}

async function importQuizzes(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  warningCollector: WarningCollector
) {
  const placementByItem = buildPlacementMap(catalog);

  for (const quiz of catalog.quizzes) {
    if (!quiz.courseId) {
      warningCollector.warn(`Quiz ${quiz.sourceId} has no course id`);
      continue;
    }

    const courseId = ctx.courseIdBySource.get(quiz.courseId);
    if (!courseId) {
      warningCollector.warn(`Quiz ${quiz.sourceId} references missing course ${quiz.courseId}`);
      continue;
    }

    const placement = placementByItem.get(quiz.sourceId);
    const moduleId = placement ? ctx.moduleIdBySource.get(placement.moduleSourceId) ?? null : null;
    const dbQuiz = await prisma.quiz.upsert({
      where: sourceWhere(quiz.sourceId),
      update: {
        courseId,
        moduleId,
        title: quiz.title,
        slug: slugOrFallback(quiz.slug, "quiz", quiz.sourceId),
        status: mapQuizStatus(quiz.status),
        position: placement?.position ?? positivePosition(quiz.order),
        timeLimitSec: quiz.settings?.timeLimit?.seconds ?? null,
        passingScorePercent: decimalOrNull(quiz.settings?.passingGrade),
        maxAttempts: quiz.settings?.attemptsAllowed ?? null,
        feedbackMode: quiz.settings?.feedbackMode ?? null,
        questionsOrder: quiz.settings?.questionsOrder ?? null,
        autoStart: quiz.settings?.quizAutoStart ?? false,
        hideTimeDisplay: quiz.settings?.hideTimeDisplay ?? false
      },
      create: {
        courseId,
        moduleId,
        title: quiz.title,
        slug: slugOrFallback(quiz.slug, "quiz", quiz.sourceId),
        status: mapQuizStatus(quiz.status),
        position: placement?.position ?? positivePosition(quiz.order),
        timeLimitSec: quiz.settings?.timeLimit?.seconds ?? null,
        passingScorePercent: decimalOrNull(quiz.settings?.passingGrade),
        maxAttempts: quiz.settings?.attemptsAllowed ?? null,
        feedbackMode: quiz.settings?.feedbackMode ?? null,
        questionsOrder: quiz.settings?.questionsOrder ?? null,
        autoStart: quiz.settings?.quizAutoStart ?? false,
        hideTimeDisplay: quiz.settings?.hideTimeDisplay ?? false,
        sourceSystem: SOURCE_SYSTEM,
        sourceId: quiz.sourceId
      }
    });

    ctx.quizIdBySource.set(quiz.sourceId, dbQuiz.id);
  }
}

async function importQuestions(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  warningCollector: WarningCollector
) {
  for (const quiz of catalog.quizzes) {
    const quizId = ctx.quizIdBySource.get(quiz.sourceId);
    if (!quizId) {
      continue;
    }

    const questions = questionsForQuiz(catalog, quiz);
    for (const [questionIndex, question] of questions.entries()) {
      const position = questionIndex + 1;
      const dbQuestion = await prisma.question.upsert({
        where: sourceWhere(question.sourceId),
        update: {
          quizId,
          type: mapQuestionType(question.detectedType),
          prompt: question.title,
          description: nullIfEmpty(question.description),
          explanation: nullIfEmpty(question.explanation),
          position,
          points: decimalOrDefault(question.points, 1)
        },
        create: {
          quizId,
          type: mapQuestionType(question.detectedType),
          prompt: question.title,
          description: nullIfEmpty(question.description),
          explanation: nullIfEmpty(question.explanation),
          position,
          points: decimalOrDefault(question.points, 1),
          sourceSystem: SOURCE_SYSTEM,
          sourceId: question.sourceId
        }
      });

      ctx.questionIdBySource.set(question.sourceId, dbQuestion.id);

      for (const [answerIndex, answer] of question.answers.entries()) {
        const optionSourceId = answer.sourceId || `${question.sourceId}:answer:${answerIndex + 1}`;
        await prisma.questionOption.upsert({
          where: sourceWhere(optionSourceId),
          update: {
            questionId: dbQuestion.id,
            label: answer.title,
            value: answer.title,
            gapMatch: answer.gapMatch,
            viewFormat: answer.viewFormat,
            position: answerIndex + 1,
            isCorrect: answer.isCorrect ?? false
          },
          create: {
            questionId: dbQuestion.id,
            label: answer.title,
            value: answer.title,
            gapMatch: answer.gapMatch,
            viewFormat: answer.viewFormat,
            position: answerIndex + 1,
            isCorrect: answer.isCorrect ?? false,
            sourceSystem: SOURCE_SYSTEM,
            sourceId: optionSourceId
          }
        });
      }
    }
  }

  for (const question of catalog.questions) {
    if (!ctx.quizIdBySource.has(question.quizId)) {
      warningCollector.warn(`Question ${question.sourceId} references missing quiz ${question.quizId}`);
    }
  }
}

async function importAssets(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  assetsRoot: string | undefined
) {
  const courseIdByThumbnailId = new Map<string, string>();
  for (const course of catalog.courses) {
    const courseId = ctx.courseIdBySource.get(course.sourceId);
    if (course.thumbnailId && courseId) {
      courseIdByThumbnailId.set(course.thumbnailId, courseId);
    }
  }

  const lessonIdByAttachmentId = new Map<string, string>();
  for (const lesson of catalog.lessons) {
    const lessonId = ctx.lessonIdBySource.get(lesson.sourceId);
    if (!lessonId) {
      continue;
    }
    for (const attachmentId of lesson.attachmentIds) {
      lessonIdByAttachmentId.set(attachmentId, lessonId);
    }
  }

  for (const attachment of catalog.attachments ?? []) {
    const sizeBytes = await assetSize(assetsRoot, attachment.filePath);
    const dbAsset = await prisma.asset.upsert({
      where: sourceWhere(attachment.sourceId),
      update: {
        title: attachment.title || attachment.filePath || `WordPress attachment ${attachment.sourceId}`,
        mimeType: attachment.mimeType,
        storageKey: attachment.filePath || `wordpress/attachment-${attachment.sourceId}`,
        originalUrl: attachment.guid || null,
        sizeBytes,
        courseId: courseIdByThumbnailId.get(attachment.sourceId) ?? null,
        lessonId: lessonIdByAttachmentId.get(attachment.sourceId) ?? null
      },
      create: {
        title: attachment.title || attachment.filePath || `WordPress attachment ${attachment.sourceId}`,
        mimeType: attachment.mimeType,
        storageKey: attachment.filePath || `wordpress/attachment-${attachment.sourceId}`,
        originalUrl: attachment.guid || null,
        sizeBytes,
        courseId: courseIdByThumbnailId.get(attachment.sourceId) ?? null,
        lessonId: lessonIdByAttachmentId.get(attachment.sourceId) ?? null,
        sourceSystem: SOURCE_SYSTEM,
        sourceId: attachment.sourceId
      }
    });

    ctx.assetIdBySource.set(attachment.sourceId, dbAsset.id);
  }
}

async function linkCourseThumbnails(prisma: PrismaClient, catalog: CatalogExport, ctx: ImportContext) {
  for (const course of catalog.courses) {
    const courseId = ctx.courseIdBySource.get(course.sourceId);
    const assetId = course.thumbnailId ? ctx.assetIdBySource.get(course.thumbnailId) : undefined;
    if (!courseId || !assetId) {
      continue;
    }

    await prisma.course.update({
      where: { id: courseId },
      data: { thumbnailAssetId: assetId }
    });
  }
}

async function importEnrollments(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  warningCollector: WarningCollector
) {
  for (const enrollment of catalog.enrollments) {
    const userId = ctx.userIdBySource.get(enrollment.userId);
    const courseId = ctx.courseIdBySource.get(enrollment.courseId);
    if (!userId || !courseId) {
      warningCollector.warn(`Enrollment ${enrollment.sourceId} has missing user/course reference`);
      continue;
    }

    await prisma.enrollment.upsert({
      where: sourceWhere(enrollment.sourceId),
      update: {
        userId,
        courseId,
        status: mapEnrollmentStatus(enrollment.status),
        progressPercent: enrollment.completedAt ? new Prisma.Decimal(100) : new Prisma.Decimal(0),
        enrolledAt: dateOrNow(enrollment.enrolledAt),
        completedAt: nullableDate(enrollment.completedAt)
      },
      create: {
        userId,
        courseId,
        status: mapEnrollmentStatus(enrollment.status),
        progressPercent: enrollment.completedAt ? new Prisma.Decimal(100) : new Prisma.Decimal(0),
        enrolledAt: dateOrNow(enrollment.enrolledAt),
        completedAt: nullableDate(enrollment.completedAt),
        sourceSystem: SOURCE_SYSTEM,
        sourceId: enrollment.sourceId
      }
    });
  }
}

async function importLessonProgress(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  warningCollector: WarningCollector
) {
  for (const progress of catalog.lessonProgress) {
    const userId = ctx.userIdBySource.get(progress.userId);
    const lessonId = ctx.lessonIdBySource.get(progress.lessonId);
    if (!userId || !lessonId) {
      warningCollector.warn(`Lesson progress user ${progress.userId} lesson ${progress.lessonId} has missing reference`);
      continue;
    }

    await prisma.lessonProgress.upsert({
      where: {
        userId_lessonId: {
          userId,
          lessonId
        }
      },
      update: {
        completedAt: nullableDate(progress.completedAt),
        lastSeenAt: nullableDate(progress.completedAt)
      },
      create: {
        userId,
        lessonId,
        completedAt: nullableDate(progress.completedAt),
        lastSeenAt: nullableDate(progress.completedAt)
      }
    });
  }
}

async function importQuizAttempts(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  warningCollector: WarningCollector
) {
  for (const attempt of catalog.quizAttempts) {
    const userId = ctx.userIdBySource.get(attempt.userId);
    const quizId = ctx.quizIdBySource.get(attempt.quizId);
    if (!userId || !quizId) {
      warningCollector.warn(`Quiz attempt ${attempt.sourceId} has missing user/quiz reference`);
      continue;
    }

    const dbAttempt = await prisma.quizAttempt.upsert({
      where: sourceWhere(attempt.sourceId),
      update: {
        quizId,
        userId,
        status: mapAttemptStatus(attempt.status, attempt.result),
        startedAt: dateOrNow(attempt.startedAt),
        submittedAt: nullableDate(attempt.endedAt),
        scorePercent: decimalOrNull(attempt.scorePercent),
        totalQuestions: attempt.totalQuestions,
        totalAnsweredQuestions: attempt.totalAnsweredQuestions,
        totalMarks: decimalOrNull(attempt.totalMarks),
        earnedMarks: decimalOrNull(attempt.earnedMarks),
        result: attempt.result || null
      },
      create: {
        quizId,
        userId,
        status: mapAttemptStatus(attempt.status, attempt.result),
        startedAt: dateOrNow(attempt.startedAt),
        submittedAt: nullableDate(attempt.endedAt),
        scorePercent: decimalOrNull(attempt.scorePercent),
        totalQuestions: attempt.totalQuestions,
        totalAnsweredQuestions: attempt.totalAnsweredQuestions,
        totalMarks: decimalOrNull(attempt.totalMarks),
        earnedMarks: decimalOrNull(attempt.earnedMarks),
        result: attempt.result || null,
        sourceSystem: SOURCE_SYSTEM,
        sourceId: attempt.sourceId
      }
    });

    ctx.attemptIdBySource.set(attempt.sourceId, dbAttempt.id);
  }

  for (const answer of catalog.quizAttemptAnswers) {
    const attemptId = ctx.attemptIdBySource.get(answer.attemptId);
    const questionId = ctx.questionIdBySource.get(answer.questionId);
    if (!attemptId || !questionId) {
      warningCollector.warn(`Quiz answer ${answer.sourceId} has missing attempt/question reference`);
      continue;
    }

    await prisma.quizAnswer.upsert({
      where: {
        attemptId_questionId: {
          attemptId,
          questionId
        }
      },
      update: {
        response: quizAnswerResponse(answer),
        score: decimalOrNull(answer.achievedMark),
        gradedAt: nullableDate(catalog.quizAttempts.find((attempt) => attempt.sourceId === answer.attemptId)?.endedAt ?? null)
      },
      create: {
        attemptId,
        questionId,
        response: quizAnswerResponse(answer),
        score: decimalOrNull(answer.achievedMark),
        gradedAt: nullableDate(catalog.quizAttempts.find((attempt) => attempt.sourceId === answer.attemptId)?.endedAt ?? null)
      }
    });
  }
}

async function importAchievements(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  warningCollector: WarningCollector
) {
  for (const achievement of catalog.achievements) {
    const dbAchievement = await prisma.achievement.upsert({
      where: sourceWhere(achievement.sourceId),
      update: {
        title: achievement.title,
        slug: slugOrFallback(achievement.slug, "achievement", achievement.sourceId),
        description: nullIfEmpty(achievement.content),
        points: achievement.points ?? 0
      },
      create: {
        title: achievement.title,
        slug: slugOrFallback(achievement.slug, "achievement", achievement.sourceId),
        description: nullIfEmpty(achievement.content),
        points: achievement.points ?? 0,
        sourceSystem: SOURCE_SYSTEM,
        sourceId: achievement.sourceId
      }
    });

    ctx.achievementIdBySource.set(achievement.sourceId, dbAchievement.id);

    for (const [index, step] of achievement.steps.entries()) {
      const trigger = mapAchievementTrigger(step.triggerType);
      if (!trigger) {
        warningCollector.warn(`Achievement step ${step.sourceId} has unsupported trigger ${step.triggerType ?? "unknown"}`);
        continue;
      }

      await prisma.achievementStep.upsert({
        where: sourceWhere(step.sourceId),
        update: {
          achievementId: dbAchievement.id,
          trigger,
          requiredCount: step.requiredCount ?? 1,
          position: index + 1
        },
        create: {
          achievementId: dbAchievement.id,
          trigger,
          requiredCount: step.requiredCount ?? 1,
          position: index + 1,
          sourceSystem: SOURCE_SYSTEM,
          sourceId: step.sourceId
        }
      });
    }
  }
}

async function importAchievementEvents(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  warningCollector: WarningCollector
) {
  for (const award of catalog.achievementAwards) {
    const userId = ctx.userIdBySource.get(award.userId);
    if (!userId) {
      warningCollector.warn(`Achievement event ${award.sourceId} references missing user ${award.userId}`);
      continue;
    }

    await prisma.achievementEvent.upsert({
      where: sourceWhere(award.sourceId),
      update: {
        userId,
        sourcePostId: award.postId || null,
        sourcePostType: award.postType || null,
        title: award.title,
        points: award.points ?? 0,
        pointsType: award.pointsType,
        occurredAt: dateOrNow(award.awardedAt)
      },
      create: {
        userId,
        sourcePostId: award.postId || null,
        sourcePostType: award.postType || null,
        title: award.title,
        points: award.points ?? 0,
        pointsType: award.pointsType,
        occurredAt: dateOrNow(award.awardedAt),
        sourceSystem: SOURCE_SYSTEM,
        sourceId: award.sourceId
      }
    });

    if (award.postType !== "curso_completados") {
      continue;
    }

    const achievementId = ctx.achievementIdBySource.get(award.postId);
    if (!achievementId) {
      warningCollector.warn(`Achievement award ${award.sourceId} references missing achievement ${award.postId}`);
      continue;
    }

    await prisma.achievementAward.upsert({
      where: sourceWhere(award.sourceId),
      update: {
        userId,
        achievementId,
        awardedAt: dateOrNow(award.awardedAt),
        points: award.points ?? 0
      },
      create: {
        userId,
        achievementId,
        awardedAt: dateOrNow(award.awardedAt),
        points: award.points ?? 0,
        sourceSystem: SOURCE_SYSTEM,
        sourceId: award.sourceId
      }
    });
  }
}

async function importCertificates(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  warningCollector: WarningCollector
) {
  const template = await findOrCreateCertificateTemplate(prisma);

  for (const completion of catalog.courseCompletionComments) {
    const userId = ctx.userIdBySource.get(completion.userId);
    const courseId = ctx.courseIdBySource.get(completion.courseId);
    if (!userId || !courseId) {
      warningCollector.warn(`Course completion comment ${completion.sourceId} has missing user/course reference`);
      continue;
    }

    await prisma.certificateTemplateCourse.upsert({
      where: {
        templateId_courseId: {
          templateId: template.id,
          courseId
        }
      },
      update: {},
      create: {
        templateId: template.id,
        courseId
      }
    });

    await prisma.certificate.upsert({
      where: sourceWhere(completion.sourceId),
      update: {
        userId,
        courseId,
        templateId: template.id,
        status: "ISSUED",
        folio: certificateFolio(completion),
        verificationCode: certificateVerificationCode(completion),
        pdfStorageKey: certificateStorageKey(completion),
        issuedAt: dateOrNow(completion.createdAt)
      },
      create: {
        userId,
        courseId,
        templateId: template.id,
        status: "ISSUED",
        folio: certificateFolio(completion),
        verificationCode: certificateVerificationCode(completion),
        pdfStorageKey: certificateStorageKey(completion),
        issuedAt: dateOrNow(completion.createdAt),
        sourceSystem: SOURCE_SYSTEM,
        sourceId: completion.sourceId
      }
    });
  }
}

async function importCourseReviews(
  prisma: PrismaClient,
  catalog: CatalogExport,
  ctx: ImportContext,
  warningCollector: WarningCollector
) {
  for (const review of catalog.courseReviews) {
    const courseId = ctx.courseIdBySource.get(review.courseId);
    if (!courseId) {
      warningCollector.warn(`Course review ${review.sourceId} references missing course ${review.courseId}`);
      continue;
    }

    await prisma.courseReview.upsert({
      where: sourceWhere(review.sourceId),
      update: {
        courseId,
        userId: ctx.userIdBySource.get(review.userId) ?? null,
        authorName: review.authorName || "WordPress user",
        rating: review.rating,
        body: review.body || null,
        status: "HIDDEN",
        createdAt: dateOrNow(review.createdAt)
      },
      create: {
        courseId,
        userId: ctx.userIdBySource.get(review.userId) ?? null,
        authorName: review.authorName || "WordPress user",
        rating: review.rating,
        body: review.body || null,
        status: "HIDDEN",
        createdAt: dateOrNow(review.createdAt),
        sourceSystem: SOURCE_SYSTEM,
        sourceId: review.sourceId
      }
    });
  }
}

async function importFeatureEvidence(prisma: PrismaClient, catalog: CatalogExport) {
  for (const evidence of catalog.lmsUsage?.featureEvidence ?? []) {
    const existing = await prisma.featureEvidence.findFirst({
      where: {
        area: evidence.area,
        feature: evidence.feature
      }
    });

    if (existing) {
      await prisma.featureEvidence.update({
        where: { id: existing.id },
        data: {
          status: evidence.status,
          evidence: evidence.evidence,
          sourcePath: "tmp/wp-catalog.json"
        }
      });
      continue;
    }

    await prisma.featureEvidence.create({
      data: {
        area: evidence.area,
        feature: evidence.feature,
        status: evidence.status,
        evidence: evidence.evidence,
        sourcePath: "tmp/wp-catalog.json"
      }
    });
  }
}

async function findOrCreateCertificateTemplate(prisma: PrismaClient) {
  const existing = await prisma.certificateTemplate.findFirst({
    where: { name: "WordPress diploma-detect legacy template" }
  });

  if (existing) {
    return existing;
  }

  return prisma.certificateTemplate.create({
    data: {
      name: "WordPress diploma-detect legacy template",
      body: {
        source: "astra-child/diploma-detect.php",
        rendering: "html2pdf-compatible",
        background: "diploma-fondo-v4.jpg",
        note: "Legacy WordPress generated diplomas client-side; PDFs are generated on demand in the migrated app."
      }
    }
  });
}

function buildPlan(usersExport: UsersExport, catalog: CatalogExport) {
  return {
    users: usersExport.users.length,
    roleAssignments: usersExport.users.reduce((sum, user) => sum + user.mappedRoles.length, 0),
    courses: catalog.courses.length,
    courseModules: Object.values(catalog.sectionsByCourseId).reduce((sum, sections) => sum + sections.length, 0),
    lessons: catalog.lessons.length,
    quizzes: catalog.quizzes.length,
    questions: catalog.questions.length,
    questionOptions: catalog.questions.reduce((sum, question) => sum + question.answers.length, 0),
    enrollments: catalog.enrollments.length,
    lessonProgress: catalog.lessonProgress.length,
    quizAttempts: catalog.quizAttempts.length,
    quizAnswers: catalog.quizAttemptAnswers.length,
    attachments: catalog.attachments?.length ?? 0,
    achievements: catalog.achievements.length,
    achievementSteps: catalog.achievements.reduce((sum, achievement) => sum + achievement.steps.length, 0),
    achievementEvents: catalog.achievementAwards.length,
    achievementAwards: catalog.achievementAwards.filter((award) => award.postType === "curso_completados").length,
    courseReviews: catalog.courseReviews.length,
    certificateEntitlements: catalog.courseCompletionComments.length,
    featureEvidence: catalog.lmsUsage?.featureEvidence?.length ?? 0
  };
}

function collectWarnings(usersExport: UsersExport, catalog: CatalogExport, assetsRoot: string | undefined): WarningCollector {
  const warnings: string[] = [];
  const userIds = new Set(usersExport.users.map((user) => user.sourceId));
  const courseIds = new Set(catalog.courses.map((course) => course.sourceId));
  const lessonIds = new Set(catalog.lessons.map((lesson) => lesson.sourceId));
  const quizIds = new Set(catalog.quizzes.map((quiz) => quiz.sourceId));
  const questionIds = new Set(catalog.questions.map((question) => question.sourceId));
  const attemptIds = new Set(catalog.quizAttempts.map((attempt) => attempt.sourceId));
  const attachmentIds = new Set((catalog.attachments ?? []).map((attachment) => attachment.sourceId));
  const warn = (message: string) => warnings.push(message);

  for (const user of usersExport.users) {
    if (user.mappedRoles.length === 0) {
      warn(`User ${user.sourceId} has no mapped roles`);
    }
  }

  for (const course of catalog.courses) {
    if (course.authorId && !userIds.has(course.authorId)) {
      warn(`Course ${course.sourceId} references missing teacher ${course.authorId}`);
    }
    if (course.thumbnailId && !attachmentIds.has(course.thumbnailId)) {
      warn(`Course ${course.sourceId} references missing thumbnail attachment ${course.thumbnailId}`);
    }
  }

  for (const lesson of catalog.lessons) {
    if (!lesson.courseId || !courseIds.has(lesson.courseId)) {
      warn(`Lesson ${lesson.sourceId} references missing course ${lesson.courseId ?? "null"}`);
    }
    for (const attachmentId of lesson.attachmentIds) {
      if (!attachmentIds.has(attachmentId)) {
        warn(`Lesson ${lesson.sourceId} references missing attachment ${attachmentId}`);
      }
    }
  }

  for (const quiz of catalog.quizzes) {
    if (!quiz.courseId || !courseIds.has(quiz.courseId)) {
      warn(`Quiz ${quiz.sourceId} references missing course ${quiz.courseId ?? "null"}`);
    }
  }

  for (const question of catalog.questions) {
    if (!quizIds.has(question.quizId)) {
      warn(`Question ${question.sourceId} references missing quiz ${question.quizId}`);
    }
  }

  for (const enrollment of catalog.enrollments) {
    if (!userIds.has(enrollment.userId) || !courseIds.has(enrollment.courseId)) {
      warn(`Enrollment ${enrollment.sourceId} references missing user/course`);
    }
  }

  for (const progress of catalog.lessonProgress) {
    if (!userIds.has(progress.userId) || !lessonIds.has(progress.lessonId)) {
      warn(`Lesson progress user ${progress.userId} lesson ${progress.lessonId} references missing user/lesson`);
    }
  }

  for (const attempt of catalog.quizAttempts) {
    if (!userIds.has(attempt.userId) || !quizIds.has(attempt.quizId)) {
      warn(`Quiz attempt ${attempt.sourceId} references missing user/quiz`);
    }
  }

  for (const answer of catalog.quizAttemptAnswers) {
    if (!attemptIds.has(answer.attemptId) || !questionIds.has(answer.questionId)) {
      warn(`Quiz answer ${answer.sourceId} references missing attempt/question`);
    }
  }

  for (const review of catalog.courseReviews) {
    if (!courseIds.has(review.courseId)) {
      warn(`Course review ${review.sourceId} references missing course ${review.courseId}`);
    }
  }

  for (const completion of catalog.courseCompletionComments) {
    if (!userIds.has(completion.userId) || !courseIds.has(completion.courseId)) {
      warn(`Course completion ${completion.sourceId} references missing user/course`);
    }
  }

  if (assetsRoot) {
    const missingFileCount = (catalog.attachments ?? []).filter((attachment) => {
      if (!attachment.filePath) {
        return false;
      }
      return !path.isAbsolute(attachment.filePath) && attachment.filePath.includes("..");
    }).length;
    if (missingFileCount > 0) {
      warn(`${missingFileCount} attachment paths contain unsafe relative segments`);
    }
  }

  return { warnings, warn };
}

function printPlan(plan: Record<string, number>, warnings: string[], apply: boolean) {
  console.log(apply ? "WordPress import apply plan:" : "WordPress import dry-run plan:");
  for (const [key, value] of Object.entries(plan)) {
    console.log(`  ${key}: ${value}`);
  }

  console.log(`Warnings: ${warnings.length}`);
  for (const warning of warnings.slice(0, 25)) {
    console.log(`  - ${warning}`);
  }
  if (warnings.length > 25) {
    console.log(`  ... ${warnings.length - 25} more warnings`);
  }
}

function buildPlacementMap(catalog: CatalogExport) {
  const placementByItem = new Map<string, Placement>();

  for (const sections of Object.values(catalog.sectionsByCourseId)) {
    for (const section of sortedSections(sections)) {
      const moduleSourceId = section.sourceId;
      for (const [index, item] of section.items.entries()) {
        placementByItem.set(item.sourceId, {
          moduleSourceId,
          position: index + 1
        });
      }
    }
  }

  return placementByItem;
}

function sortedSections(sections: SectionItem[]) {
  return [...sections].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.sourceId.localeCompare(right.sourceId));
}

function questionsForQuiz(catalog: CatalogExport, quiz: QuizItem) {
  const order = new Map(quiz.questionIds.map((questionId, index) => [questionId, index]));
  return catalog.questions
    .filter((question) => question.quizId === quiz.sourceId)
    .sort((left, right) => {
      const leftOrder = order.get(left.sourceId) ?? left.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(right.sourceId) ?? right.order ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || Number(left.sourceId) - Number(right.sourceId);
    });
}

function lessonKind(lesson: LessonItem) {
  const hasVideo = Boolean(
    lesson.video?.youtubeUrl ||
      lesson.video?.vimeoUrl ||
      lesson.video?.externalUrl ||
      lesson.video?.embedded ||
      lesson.video?.html5
  );
  const hasAttachments = lesson.attachmentIds.length > 0;
  if (hasVideo && hasAttachments) {
    return "MIXED";
  }
  if (hasVideo) {
    return "VIDEO";
  }
  if (hasAttachments) {
    return "RESOURCE";
  }
  return lesson.content ? "TEXT" : "MIXED";
}

function lessonVideoUrl(video: VideoValue | null) {
  if (!video) {
    return null;
  }

  return video.youtubeUrl ?? video.vimeoUrl ?? video.externalUrl ?? video.html5 ?? null;
}

function mapCourseStatus(status: string) {
  switch (status) {
    case "publish":
      return "PUBLISHED";
    case "trash":
      return "ARCHIVED";
    default:
      return "DRAFT";
  }
}

function mapQuizStatus(status: string) {
  switch (status) {
    case "publish":
      return "PUBLISHED";
    case "trash":
      return "ARCHIVED";
    default:
      return "DRAFT";
  }
}

function mapEnrollmentStatus(status: string) {
  switch (status) {
    case "completed":
      return "COMPLETED";
    case "trash":
      return "SUSPENDED";
    default:
      return "ACTIVE";
  }
}

function mapAttemptStatus(status: string, result: string) {
  if (status === "attempt_started") {
    return "IN_PROGRESS";
  }
  if (result === "pass") {
    return "PASSED";
  }
  if (result === "fail") {
    return "FAILED";
  }
  return "SUBMITTED";
}

function mapQuestionType(type: string) {
  switch (type) {
    case "MULTIPLE_CHOICE":
      return "MULTIPLE_CHOICE";
    case "TRUE_FALSE":
      return "TRUE_FALSE";
    case "FILL_IN_THE_BLANK":
      return "FILL_IN_THE_BLANK";
    case "SINGLE_CHOICE":
      return "SINGLE_CHOICE";
    case "OPEN_ENDED":
      return "OPEN_ENDED";
    case "SHORT_TEXT":
      return "SHORT_TEXT";
    default:
      return "SHORT_TEXT";
  }
}

function mapAchievementTrigger(trigger: string | null) {
  switch (trigger) {
    case "gamipress_tutor_pass_quiz":
      return "QUIZ_PASSED";
    case "gamipress_tutor_complete_course":
      return "COURSE_COMPLETED";
    default:
      return null;
  }
}

function sourceWhere(sourceId: string) {
  return {
    sourceSystem_sourceId: {
      sourceSystem: SOURCE_SYSTEM,
      sourceId
    }
  };
}

function slugOrFallback(slug: string, prefix: string, sourceId: string) {
  return slug || `${prefix}-${sourceId}`;
}

function uniqueSlugBySource(items: Array<{ sourceId: string; slug: string }>, prefix: string) {
  const counts = new Map<string, number>();
  const slugBySource = new Map<string, string>();

  for (const item of items) {
    const baseSlug = slugOrFallback(item.slug, prefix, item.sourceId);
    const count = counts.get(baseSlug) ?? 0;
    counts.set(baseSlug, count + 1);
    slugBySource.set(item.sourceId, count === 0 ? baseSlug : `${baseSlug}-${item.sourceId}`);
  }

  return slugBySource;
}

function positivePosition(value: number | null | undefined) {
  return value && value > 0 ? value : 1;
}

function nullIfEmpty(value: string | null | undefined) {
  return value && value.trim().length > 0 ? value : null;
}

function durationToSeconds(duration: DurationValue | null) {
  if (!duration) {
    return null;
  }
  return (duration.hours ?? 0) * 3600 + (duration.minutes ?? 0) * 60 + (duration.seconds ?? 0);
}

function decimalOrNull(value: number | null | undefined) {
  return value === null || value === undefined ? null : new Prisma.Decimal(value);
}

function decimalOrDefault(value: number | null | undefined, fallback: number) {
  return new Prisma.Decimal(value ?? fallback);
}

function dateOrNow(value: string | null | undefined) {
  return nullableDate(value) ?? new Date();
}

function nullableDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function assetSize(assetsRoot: string | undefined, filePath: string | null) {
  if (!assetsRoot || !filePath || filePath.includes("..")) {
    return null;
  }

  try {
    const info = await stat(path.join(resolveWorkspacePath(assetsRoot), filePath));
    return BigInt(info.size);
  } catch {
    return null;
  }
}

function quizAnswerResponse(answer: QuizAttemptAnswerItem) {
  return {
    sourceId: answer.sourceId,
    givenAnswer: answer.givenAnswer,
    isCorrect: answer.isCorrect,
    questionMark: answer.questionMark,
    minusMark: answer.minusMark
  };
}

function certificateFolio(completion: TutorCourseCompletionCommentItem) {
  return `WP-${completion.sourceId}`;
}

function certificateVerificationCode(completion: TutorCourseCompletionCommentItem) {
  const hash = createHash("sha256").update(`${completion.sourceId}:${completion.token}`).digest("hex").slice(0, 24);
  return `wp-${completion.sourceId}-${hash}`;
}

function certificateStorageKey(completion: TutorCourseCompletionCommentItem) {
  return `certificates/generated-on-demand/wp-${completion.sourceId}.pdf`;
}

async function readJson<T>(filePath: string) {
  return JSON.parse(await readFile(resolveWorkspacePath(filePath), "utf8")) as T;
}

function resolveWorkspacePath(filePath: string) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  const cwdCandidate = path.resolve(process.cwd(), filePath);
  if (existsSync(cwdCandidate)) {
    return cwdCandidate;
  }

  const repoCandidate = path.resolve(process.cwd(), "..", "..", filePath);
  if (existsSync(repoCandidate)) {
    return repoCandidate;
  }

  return cwdCandidate;
}

function valueAfter(argv: string[], name: string) {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
