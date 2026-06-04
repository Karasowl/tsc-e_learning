import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readDumpStatements, splitSqlValues } from "./sql-dump.js";

type Args = {
  dumpPath: string;
  outPath: string;
};

type PostRecord = {
  id: string;
  authorId: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  status: string;
  type: string;
  parentId: string;
  guid: string;
  mimeType: string;
  menuOrder: number;
  createdAt: string;
  modifiedAt: string;
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
  contentLength: number;
  excerptLength: number;
  createdAt: string;
  modifiedAt: string;
  meta: Record<string, string[]>;
};

type CourseItem = CatalogItem & {
  platform: "tutor_lms" | "learnpress";
  priceType: string | null;
  level: string | null;
  duration: DurationValue | null;
  qaEnabled: boolean | null;
  publicCourse: boolean | null;
  thumbnailId: string | null;
  settings: Record<string, unknown> | null;
};

type LessonItem = CatalogItem & {
  platform: "tutor_lms" | "learnpress";
  courseId: string | null;
  topicId: string | null;
  video: VideoValue | null;
  attachmentIds: string[];
  durationSec: number | null;
};

type QuizItem = CatalogItem & {
  platform: "tutor_lms" | "learnpress";
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
  settings: Record<string, unknown> | null;
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
  settings: Record<string, unknown> | null;
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
  metaKey: string;
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
  answerCount: number;
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
  earnedBy: string | null;
  congratulationsText: string | null;
  steps: AchievementStepItem[];
};

type AchievementStepItem = CatalogItem & {
  triggerType: string | null;
  requiredCount: number | null;
  limit: number | null;
  limitType: string | null;
  userRoleRequired: string | null;
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
  metadata: Record<string, unknown> | null;
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

type QuizSettings = {
  attemptsAllowed: number | null;
  feedbackMode: string | null;
  hideQuestionOverview: boolean | null;
  hideTimeDisplay: boolean | null;
  maxQuestionsForAnswer: number | null;
  openEndedAnswerCharactersLimit: number | null;
  passIsRequired: boolean | null;
  passingGrade: number | null;
  questionLayoutView: string | null;
  questionsOrder: string | null;
  quizAutoStart: boolean | null;
  shortAnswerCharactersLimit: number | null;
  timeLimit: {
    type: string | null;
    value: number | null;
    seconds: number | null;
  } | null;
  raw: Record<string, unknown>;
};

type FeatureEvidence = {
  area: string;
  feature: string;
  status: "CONFIRMED" | "CONFIGURED" | "UNUSED" | "UNKNOWN";
  evidence: string;
};

type CatalogExport = {
  generatedAt: string;
  sourceDump: string;
  platformsDetected: string[];
  sourceTables: string[];
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
  attachments: AttachmentItem[];
  courseCompletionComments: TutorCourseCompletionCommentItem[];
  courseReviews: TutorCourseReviewItem[];
  sectionsByCourseId: Record<string, SectionItem[]>;
  lmsUsage: {
    userItemCounts: Record<string, number>;
    userItemStatusCounts: Record<string, number>;
    questionTypesUsed: Record<string, number>;
    quizResultCounts: Record<string, number>;
    quizAttemptStatusCounts: Record<string, number>;
    enrollmentStatusCounts: Record<string, number>;
    achievementAwardCounts: Record<string, number>;
    commentTypeCounts: Record<string, number>;
    featureEvidence: FeatureEvidence[];
  };
};

const WP_POST_COLUMNS = [
  "ID",
  "post_author",
  "post_date",
  "post_date_gmt",
  "post_content",
  "post_title",
  "post_excerpt",
  "post_status",
  "comment_status",
  "ping_status",
  "post_password",
  "post_name",
  "to_ping",
  "pinged",
  "post_modified",
  "post_modified_gmt",
  "post_content_filtered",
  "post_parent",
  "guid",
  "menu_order",
  "post_type",
  "post_mime_type",
  "comment_count"
];

const WP_POSTMETA_COLUMNS = ["meta_id", "post_id", "meta_key", "meta_value"];
const WP_USERMETA_COLUMNS = ["umeta_id", "user_id", "meta_key", "meta_value"];

const TUTOR_POST_TYPES = ["courses", "topics", "lesson", "tutor_quiz", "tutor_enrolled"];
const LEARNPRESS_POST_TYPES = ["lp_course", "lp_lesson", "lp_quiz", "lp_question"];
const GAMIPRESS_POST_TYPES = ["achievement-type", "curso_completados", "step"];
const MEDIA_POST_TYPES = ["attachment"];

function parseArgs(argv: string[]): Args {
  const dumpIndex = argv.indexOf("--dump");
  const outIndex = argv.indexOf("--out");

  if (dumpIndex === -1 || !argv[dumpIndex + 1]) {
    throw new Error("Missing --dump C:\\path\\to\\wordpress.sql");
  }

  const dumpPath = argv[dumpIndex + 1]!;
  const outPath = outIndex !== -1 && argv[outIndex + 1] ? argv[outIndex + 1]! : "tmp/wp-catalog.json";

  return {
    dumpPath,
    outPath
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tableColumns = new Map<string, string[]>();
  const sourceTables = new Set<string>();
  const posts = new Map<string, PostRecord>();
  const postMeta = new Map<string, Record<string, string[]>>();
  const commentMeta = new Map<string, Record<string, string[]>>();
  const userMeta = new Map<string, Record<string, string[]>>();
  const learnPressSections = new Map<string, Record<string, string>>();
  const learnPressSectionItems: Array<Record<string, string>> = [];
  const learnPressQuizQuestions: Array<Record<string, string>> = [];
  const learnPressQuestionAnswersByQuestion = new Map<string, number>();
  const learnPressUserItemCounts: Record<string, number> = {};
  const learnPressUserItemStatusCounts: Record<string, number> = {};
  const tutorQuestions = new Map<string, Record<string, string>>();
  const tutorAnswersByQuestion = new Map<string, QuestionAnswerItem[]>();
  const tutorAttempts: Array<Record<string, string>> = [];
  const tutorAttemptAnswers: QuizAttemptAnswerItem[] = [];
  const comments: Array<Record<string, string>> = [];
  const gamipressUserEarnings: Array<Record<string, string>> = [];

  for await (const statement of readDumpStatements(args.dumpPath)) {
    sourceTables.add(statement.table);

    if (statement.type === "create-table") {
      tableColumns.set(statement.table, statement.columns);
      continue;
    }

    const columns = statement.columns ?? tableColumns.get(statement.table) ?? fallbackColumns(statement.table);

    for (const row of statement.rows) {
      const values = splitSqlValues(row);
      const record = toRecord(columns, values);

      if (statement.table.endsWith("_posts")) {
        const post = toPost(record);
        if (
          TUTOR_POST_TYPES.includes(post.type) ||
          LEARNPRESS_POST_TYPES.includes(post.type) ||
          GAMIPRESS_POST_TYPES.includes(post.type) ||
          MEDIA_POST_TYPES.includes(post.type)
        ) {
          posts.set(post.id, post);
        }
        continue;
      }

      if (statement.table.endsWith("_comments")) {
        comments.push(record);
        continue;
      }

      if (statement.table.endsWith("_commentmeta")) {
        pushNestedValue(commentMeta, record.comment_id, record.meta_key, record.meta_value ?? "");
        continue;
      }

      if (statement.table.endsWith("_postmeta")) {
        pushNestedValue(postMeta, record.post_id, record.meta_key, record.meta_value ?? "");
        continue;
      }

      if (statement.table.endsWith("_usermeta")) {
        pushNestedValue(userMeta, record.user_id, record.meta_key, record.meta_value ?? "");
        continue;
      }

      if (statement.table.includes("learnpress_sections")) {
        const sectionId = pick(record, ["section_id", "id"]);
        if (sectionId) {
          learnPressSections.set(sectionId, record);
        }
        continue;
      }

      if (statement.table.includes("learnpress_section_items")) {
        learnPressSectionItems.push(record);
        continue;
      }

      if (statement.table.includes("learnpress_quiz_questions")) {
        learnPressQuizQuestions.push(record);
        continue;
      }

      if (statement.table.includes("learnpress_question_answers")) {
        const questionId = pick(record, ["question_id", "question"]);
        if (questionId) {
          learnPressQuestionAnswersByQuestion.set(
            questionId,
            (learnPressQuestionAnswersByQuestion.get(questionId) ?? 0) + 1
          );
        }
        continue;
      }

      if (statement.table.includes("learnpress_user_items")) {
        const itemType = pick(record, ["item_type", "ref_type", "type"]) || "unknown";
        const status = pick(record, ["status", "graduation"]) || "unknown";
        increment(learnPressUserItemCounts, itemType);
        increment(learnPressUserItemStatusCounts, `${itemType}:${status}`);
        continue;
      }

      if (statement.table.endsWith("_tutor_quiz_questions")) {
        const questionId = record.question_id;
        if (questionId) {
          tutorQuestions.set(questionId, record);
        }
        continue;
      }

      if (statement.table.endsWith("_tutor_quiz_question_answers")) {
        const answer = toTutorQuestionAnswer(record);
        if (answer.questionId) {
          tutorAnswersByQuestion.set(answer.questionId, [...(tutorAnswersByQuestion.get(answer.questionId) ?? []), answer]);
        }
        continue;
      }

      if (statement.table.endsWith("_tutor_quiz_attempts")) {
        tutorAttempts.push(record);
        continue;
      }

      if (statement.table.endsWith("_tutor_quiz_attempt_answers")) {
        tutorAttemptAnswers.push(toTutorAttemptAnswer(record));
        continue;
      }

      if (statement.table.endsWith("_gamipress_user_earnings")) {
        gamipressUserEarnings.push(record);
      }
    }
  }

  sortTutorAnswers(tutorAnswersByQuestion);

  const platformsDetected = detectPlatforms(sourceTables, posts);
  const tutorCourses = postsByType(posts, postMeta, "courses").map((course): CourseItem => {
    const meta = course.meta;
    const settings = parseSerializedRecord(firstMeta(meta, "_tutor_course_settings"));

    return {
      ...course,
      platform: "tutor_lms",
      priceType: firstMeta(meta, "_tutor_course_price_type"),
      level: firstMeta(meta, "_tutor_course_level"),
      duration: parseDuration(firstMeta(meta, "_course_duration")),
      qaEnabled: parseWpBoolean(firstMeta(meta, "_tutor_enable_qa")),
      publicCourse: parseWpBoolean(firstMeta(meta, "_tutor_is_public_course")),
      thumbnailId: firstMeta(meta, "_thumbnail_id"),
      settings
    };
  });

  const tutorLessons = postsByType(posts, postMeta, "lesson").map((lesson): LessonItem => {
    const topic = posts.get(lesson.sourceId);
    const topicId = topic?.parentId && topic.parentId !== "0" ? topic.parentId : null;
    const courseId = firstMeta(lesson.meta, "_tutor_course_id_for_lesson") ?? parentCourseId(posts, topicId);
    const video = parseVideo(firstMeta(lesson.meta, "_video"));

    return {
      ...lesson,
      platform: "tutor_lms",
      courseId,
      topicId,
      video,
      attachmentIds: parseStringList(firstMeta(lesson.meta, "_tutor_attachments")),
      durationSec: durationToSeconds(video?.runtime ?? null)
    };
  });

  const tutorQuizzes = postsByType(posts, postMeta, "tutor_quiz").map((quiz): QuizItem => {
    const post = posts.get(quiz.sourceId);
    const topicId = post?.parentId && post.parentId !== "0" ? post.parentId : null;
    const courseId = firstMeta(quiz.meta, "_tutor_course_id_for_lesson") ?? parentCourseId(posts, topicId);
    const questionIds = sortedTutorQuestionIdsForQuiz(tutorQuestions, quiz.sourceId);

    return {
      ...quiz,
      platform: "tutor_lms",
      courseId,
      topicId,
      questionIds,
      settings: parseQuizSettings(firstMeta(quiz.meta, "tutor_quiz_option"))
    };
  });

  const tutorQuestionItems = Array.from(tutorQuestions.values())
    .map((question): QuestionItem => {
      const sourceId = question.question_id ?? "";
      const answers = tutorAnswersByQuestion.get(sourceId) ?? [];

      return {
        sourceId,
        quizId: question.quiz_id ?? "",
        contentId: emptyToNull(question.content_id),
        title: question.question_title ?? "",
        description: question.question_description ?? "",
        explanation: question.answer_explanation ?? "",
        detectedType: normalizeQuestionType(question.question_type),
        points: parseNullableNumber(question.question_mark),
        order: parseNullableNumber(question.question_order),
        answerCount: answers.length,
        answers,
        settings: parseSerializedRecord(question.question_settings)
      };
    })
    .sort((left, right) => Number(left.quizId) - Number(right.quizId) || (left.order ?? 0) - (right.order ?? 0));

  const learnPressCourses = postsByType(posts, postMeta, "lp_course").map((course): CourseItem => ({
    ...course,
    platform: "learnpress",
    priceType: null,
    level: null,
    duration: null,
    qaEnabled: null,
    publicCourse: null,
    thumbnailId: firstMeta(course.meta, "_thumbnail_id"),
    settings: null
  }));

  const learnPressLessons = postsByType(posts, postMeta, "lp_lesson").map((lesson): LessonItem => ({
    ...lesson,
    platform: "learnpress",
    courseId: null,
    topicId: null,
    video: null,
    attachmentIds: [],
    durationSec: null
  }));

  const learnPressQuestions = postsByType(posts, postMeta, "lp_question").map((question): QuestionItem => {
    const detectedType = detectLearnPressQuestionType(question.meta);

    return {
      sourceId: question.sourceId,
      quizId: "",
      contentId: null,
      title: question.title,
      description: "",
      explanation: "",
      detectedType,
      points: null,
      order: null,
      answerCount: learnPressQuestionAnswersByQuestion.get(question.sourceId) ?? 0,
      answers: [],
      settings: null
    };
  });

  const learnPressQuizQuestionIds = groupLearnPressQuizQuestions(learnPressQuizQuestions);
  const learnPressQuizzes = postsByType(posts, postMeta, "lp_quiz").map((quiz): QuizItem => ({
    ...quiz,
    platform: "learnpress",
    courseId: null,
    topicId: null,
    questionIds: learnPressQuizQuestionIds[quiz.sourceId] ?? [],
    settings: null
  }));

  const courses = [...tutorCourses, ...learnPressCourses];
  const lessons = [...tutorLessons, ...learnPressLessons];
  const quizzes = [...tutorQuizzes, ...learnPressQuizzes];
  const questions = [...tutorQuestionItems, ...learnPressQuestions];
  const enrollments = buildTutorEnrollments(posts);
  const lessonProgress = buildTutorLessonProgress(userMeta);
  const quizAttemptAnswersByAttempt = groupAttemptAnswersByAttempt(tutorAttemptAnswers);
  const quizAttempts = tutorAttempts.map((attempt) => toTutorAttempt(attempt, quizAttemptAnswersByAttempt));
  const achievementSteps = buildAchievementSteps(posts, postMeta);
  const achievements = buildAchievements(posts, postMeta, achievementSteps);
  const achievementAwards = gamipressUserEarnings.map(toAchievementAward);
  const attachments = buildAttachments(posts, postMeta);
  const courseCompletionComments = buildCourseCompletionComments(comments);
  const courseReviews = buildCourseReviews(comments, commentMeta);

  const questionTypesUsed = countQuestionTypes(questions);
  const quizResultCounts = countBy(quizAttempts, (attempt) => attempt.result || "unknown");
  const quizAttemptStatusCounts = countBy(quizAttempts, (attempt) => attempt.status || "unknown");
  const enrollmentStatusCounts = countBy(enrollments, (enrollment) => enrollment.status || "unknown");
  const achievementAwardCounts = countBy(achievementAwards, (award) => award.title || "unknown");
  const commentTypeCounts = countBy(comments, (comment) => comment.comment_type || "comment");
  const sectionsByCourseId = {
    ...buildTutorSectionsByCourse(posts, postMeta),
    ...buildLearnPressSectionsByCourse(posts, learnPressSections, learnPressSectionItems)
  };
  const userItemCounts = mergeCounts(learnPressUserItemCounts, {
    tutor_enrolled: enrollments.length,
    tutor_lesson_completed: lessonProgress.length,
    tutor_quiz_attempt: quizAttempts.length
  });
  const userItemStatusCounts = mergeCounts(learnPressUserItemStatusCounts, {
    ...prefixCounts("tutor_enrolled", enrollmentStatusCounts),
    ...prefixCounts("tutor_quiz_attempt", quizAttemptStatusCounts),
    ...prefixCounts("tutor_quiz_result", quizResultCounts)
  });

  const payload: CatalogExport = {
    generatedAt: new Date().toISOString(),
    sourceDump: args.dumpPath,
    platformsDetected,
    sourceTables: Array.from(sourceTables).sort(),
    courses,
    lessons,
    quizzes,
    questions,
    enrollments,
    lessonProgress,
    quizAttempts,
    quizAttemptAnswers: tutorAttemptAnswers,
    achievements,
    achievementAwards,
    attachments,
    courseCompletionComments,
    courseReviews,
    sectionsByCourseId,
    lmsUsage: {
      userItemCounts,
      userItemStatusCounts,
      questionTypesUsed,
      quizResultCounts,
      quizAttemptStatusCounts,
      enrollmentStatusCounts,
      achievementAwardCounts,
      commentTypeCounts,
      featureEvidence: buildFeatureEvidence({
        courses,
        lessons,
        quizzes,
        questions,
        enrollments,
        lessonProgress,
        quizAttempts,
        quizAttemptAnswers: tutorAttemptAnswers,
        achievements,
        achievementAwards,
        attachments,
        courseCompletionComments,
        courseReviews,
        sectionsByCourseId,
        questionTypesUsed
      })
    }
  };

  await mkdir(path.dirname(args.outPath), { recursive: true });
  await writeFile(args.outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Wrote WordPress LMS catalog export to ${args.outPath}`);
  console.log(`Platforms: ${platformsDetected.join(", ") || "unknown"}`);
  console.log(`Courses: ${courses.length}`);
  console.log(`Lessons: ${lessons.length}`);
  console.log(`Quizzes: ${quizzes.length}`);
  console.log(`Questions: ${questions.length}`);
  console.log(`Enrollments: ${enrollments.length}`);
  console.log(`Quiz attempts: ${quizAttempts.length}`);
  console.log(`Achievements: ${achievements.length}`);
  console.log(`Achievement awards: ${achievementAwards.length}`);
  console.log(`Attachments: ${attachments.length}`);
}

function fallbackColumns(table: string) {
  if (table.endsWith("_posts")) {
    return WP_POST_COLUMNS;
  }

  if (table.endsWith("_postmeta")) {
    return WP_POSTMETA_COLUMNS;
  }

  if (table.endsWith("_usermeta")) {
    return WP_USERMETA_COLUMNS;
  }

  return [];
}

function toRecord(columns: string[], values: string[]) {
  const record: Record<string, string> = {};
  columns.forEach((column, index) => {
    record[column] = values[index] ?? "";
  });
  return record;
}

function toPost(record: Record<string, string>): PostRecord {
  return {
    id: record.ID ?? record.id ?? "",
    authorId: record.post_author ?? "",
    title: record.post_title ?? "",
    slug: record.post_name ?? "",
    content: record.post_content ?? "",
    excerpt: record.post_excerpt ?? "",
    status: record.post_status ?? "",
    type: record.post_type ?? "",
    parentId: record.post_parent ?? "",
    guid: record.guid ?? "",
    mimeType: record.post_mime_type ?? "",
    menuOrder: Number(record.menu_order ?? 0),
    createdAt: record.post_date ?? "",
    modifiedAt: record.post_modified ?? ""
  };
}

function postsByType(
  posts: Map<string, PostRecord>,
  postMeta: Map<string, Record<string, string[]>>,
  type: string
): CatalogItem[] {
  return Array.from(posts.values())
    .filter((post) => post.type === type)
    .sort((left, right) => {
      const leftParent = Number(left.parentId || 0);
      const rightParent = Number(right.parentId || 0);
      return (
        leftParent - rightParent ||
        left.menuOrder - right.menuOrder ||
        Number(left.id) - Number(right.id) ||
        left.title.localeCompare(right.title)
      );
    })
    .map((post) => ({
      sourceId: post.id,
      title: post.title,
      slug: post.slug,
      status: post.status,
      authorId: post.authorId,
      parentId: post.parentId,
      order: post.menuOrder,
      content: post.content,
      excerpt: post.excerpt,
      contentLength: post.content.length,
      excerptLength: post.excerpt.length,
      createdAt: post.createdAt,
      modifiedAt: post.modifiedAt,
      meta: postMeta.get(post.id) ?? {}
    }));
}

function buildAttachments(posts: Map<string, PostRecord>, postMeta: Map<string, Record<string, string[]>>) {
  return Array.from(posts.values())
    .filter((post) => post.type === "attachment")
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map((post): AttachmentItem => {
      const meta = postMeta.get(post.id) ?? {};
      return {
        sourceId: post.id,
        title: post.title,
        slug: post.slug,
        status: post.status,
        authorId: post.authorId,
        parentId: post.parentId,
        order: post.menuOrder,
        content: post.content,
        excerpt: post.excerpt,
        contentLength: post.content.length,
        excerptLength: post.excerpt.length,
        createdAt: post.createdAt,
        modifiedAt: post.modifiedAt,
        meta,
        guid: post.guid,
        mimeType: emptyToNull(post.mimeType),
        filePath: firstMeta(meta, "_wp_attached_file"),
        metadata: parseSerializedRecord(firstMeta(meta, "_wp_attachment_metadata"))
      };
    });
}

function buildTutorSectionsByCourse(posts: Map<string, PostRecord>, postMeta: Map<string, Record<string, string[]>>) {
  const topics = Array.from(posts.values())
    .filter((post) => post.type === "topics" && post.parentId && post.parentId !== "0")
    .sort((left, right) => Number(left.parentId) - Number(right.parentId) || left.menuOrder - right.menuOrder);

  const byCourse: Record<string, SectionItem[]> = {};

  for (const topic of topics) {
    const items = Array.from(posts.values())
      .filter((post) => post.parentId === topic.id && ["lesson", "tutor_quiz"].includes(post.type))
      .sort((left, right) => left.menuOrder - right.menuOrder || Number(left.id) - Number(right.id))
      .map((post) => ({
        sourceId: post.id,
        type: post.type,
        title: post.title,
        order: post.menuOrder
      }));

    byCourse[topic.parentId] = [
      ...(byCourse[topic.parentId] ?? []),
      {
        sourceId: topic.id,
        title: topic.title,
        order: topic.menuOrder,
        items
      }
    ].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  }

  const directItemsByCourse: Record<string, Array<{ sourceId: string; type: string; title: string; order: number | null }>> = {};
  for (const post of posts.values()) {
    if (!["lesson", "tutor_quiz"].includes(post.type) || (post.parentId && post.parentId !== "0")) {
      continue;
    }

    const courseId = firstMeta(postMeta.get(post.id) ?? {}, "_tutor_course_id_for_lesson");
    if (!courseId) {
      continue;
    }

    directItemsByCourse[courseId] = [
      ...(directItemsByCourse[courseId] ?? []),
      {
        sourceId: post.id,
        type: post.type,
        title: post.title,
        order: post.menuOrder
      }
    ].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || Number(left.sourceId) - Number(right.sourceId));
  }

  for (const [courseId, items] of Object.entries(directItemsByCourse)) {
    byCourse[courseId] = [
      {
        sourceId: `tutor-direct-${courseId}`,
        title: "Contenido del curso",
        order: 0,
        items
      },
      ...(byCourse[courseId] ?? [])
    ].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  }

  return byCourse;
}

function buildLearnPressSectionsByCourse(
  posts: Map<string, PostRecord>,
  sections: Map<string, Record<string, string>>,
  sectionItems: Array<Record<string, string>>
) {
  const sectionItemsBySectionId: Record<string, Array<Record<string, string>>> = {};
  for (const item of sectionItems) {
    const sectionId = pick(item, ["section_id", "section"]);
    if (!sectionId) {
      continue;
    }
    sectionItemsBySectionId[sectionId] = [...(sectionItemsBySectionId[sectionId] ?? []), item];
  }

  const byCourse: Record<string, SectionItem[]> = {};

  for (const [sectionId, section] of sections.entries()) {
    const courseId = pick(section, ["section_course_id", "course_id", "course"]);
    if (!courseId) {
      continue;
    }

    const sectionName = pick(section, ["section_name", "title", "name"]) || `Section ${sectionId}`;
    const order = parseNullableNumber(pick(section, ["section_order", "order", "position"]));
    const items = (sectionItemsBySectionId[sectionId] ?? [])
      .map((item) => {
        const itemId = pick(item, ["item_id", "item"]);
        const post = itemId ? posts.get(itemId) : undefined;
        return {
          sourceId: itemId ?? "",
          type: pick(item, ["item_type", "type"]) || post?.type || "unknown",
          title: post?.title ?? "",
          order: parseNullableNumber(pick(item, ["item_order", "order", "position"]))
        };
      })
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));

    byCourse[courseId] = [
      ...(byCourse[courseId] ?? []),
      {
        sourceId: sectionId,
        title: sectionName,
        order,
        items
      }
    ].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  }

  return byCourse;
}

function buildTutorEnrollments(posts: Map<string, PostRecord>) {
  return Array.from(posts.values())
    .filter((post) => post.type === "tutor_enrolled")
    .map((post): EnrollmentItem => ({
      sourceId: post.id,
      userId: post.authorId,
      courseId: post.parentId,
      status: post.status,
      enrolledAt: post.createdAt,
      completedAt: post.status === "completed" ? post.modifiedAt : null
    }))
    .sort((left, right) => Number(left.courseId) - Number(right.courseId) || Number(left.userId) - Number(right.userId));
}

function buildTutorLessonProgress(userMeta: Map<string, Record<string, string[]>>) {
  const progress: LessonProgressItem[] = [];

  for (const [userId, meta] of userMeta.entries()) {
    for (const [key, values] of Object.entries(meta)) {
      const match = key.match(/^_tutor_completed_lesson_id_(\d+)$/);
      if (!match?.[1]) {
        continue;
      }

      for (const value of values) {
        progress.push({
          userId,
          lessonId: match[1],
          completedAt: parseTutorTimestamp(value),
          metaKey: key
        });
      }
    }
  }

  return progress.sort((left, right) => Number(left.lessonId) - Number(right.lessonId) || Number(left.userId) - Number(right.userId));
}

function buildAchievementSteps(posts: Map<string, PostRecord>, postMeta: Map<string, Record<string, string[]>>) {
  return postsByType(posts, postMeta, "step").map((step): AchievementStepItem => ({
    ...step,
    triggerType: firstMeta(step.meta, "_gamipress_trigger_type"),
    requiredCount: parseNullableNumber(firstMeta(step.meta, "_gamipress_count")),
    limit: parseNullableNumber(firstMeta(step.meta, "_gamipress_limit")),
    limitType: firstMeta(step.meta, "_gamipress_limit_type"),
    userRoleRequired: firstMeta(step.meta, "_gamipress_user_role_required")
  }));
}

function buildAchievements(
  posts: Map<string, PostRecord>,
  postMeta: Map<string, Record<string, string[]>>,
  steps: AchievementStepItem[]
) {
  return postsByType(posts, postMeta, "curso_completados").map((achievement): AchievementItem => ({
    ...achievement,
    points: parseNullableNumber(firstMeta(achievement.meta, "_gamipress_points")),
    earnedBy: firstMeta(achievement.meta, "_gamipress_earned_by"),
    congratulationsText: firstMeta(achievement.meta, "_gamipress_congratulations_text"),
    steps
  }));
}

function toAchievementAward(record: Record<string, string>): AchievementAwardItem {
  return {
    sourceId: record.user_earning_id ?? "",
    userId: record.user_id ?? "",
    postId: record.post_id ?? "",
    postType: record.post_type ?? "",
    title: record.title ?? "",
    points: parseNullableNumber(record.points),
    pointsType: emptyToNull(record.points_type),
    awardedAt: record.date ?? ""
  };
}

function buildCourseCompletionComments(comments: Array<Record<string, string>>) {
  return comments
    .filter((comment) => comment.comment_type === "course_completed")
    .map((comment): TutorCourseCompletionCommentItem => ({
      sourceId: comment.comment_ID ?? "",
      courseId: comment.comment_post_ID ?? "",
      userId: comment.user_id ?? "",
      token: comment.comment_content ?? "",
      createdAt: comment.comment_date ?? ""
    }));
}

function buildCourseReviews(
  comments: Array<Record<string, string>>,
  commentMeta: Map<string, Record<string, string[]>>
) {
  return comments
    .filter((comment) => comment.comment_type === "tutor_course_rating")
    .map((comment): TutorCourseReviewItem => {
      const meta = commentMeta.get(comment.comment_ID ?? "") ?? {};
      return {
        sourceId: comment.comment_ID ?? "",
        courseId: comment.comment_post_ID ?? "",
        userId: comment.user_id ?? "",
        authorName: comment.comment_author ?? "",
        body: comment.comment_content ?? "",
        approved: comment.comment_approved ?? "",
        rating: parseNullableNumber(firstMeta(meta, "tutor_rating") ?? firstMeta(meta, "rating")),
        createdAt: comment.comment_date ?? ""
      };
    });
}

function toTutorQuestionAnswer(record: Record<string, string>): QuestionAnswerItem {
  return {
    sourceId: record.answer_id ?? "",
    questionId: record.belongs_question_id ?? "",
    title: record.answer_title ?? "",
    isCorrect: parseWpBoolean(record.is_correct),
    order: parseNullableNumber(record.answer_order),
    imageId: emptyToNull(record.image_id),
    gapMatch: emptyToNull(record.answer_two_gap_match),
    viewFormat: emptyToNull(record.answer_view_format),
    settings: parseSerializedRecord(record.answer_settings)
  };
}

function toTutorAttemptAnswer(record: Record<string, string>): QuizAttemptAnswerItem {
  return {
    sourceId: record.attempt_answer_id ?? "",
    attemptId: record.quiz_attempt_id ?? "",
    userId: record.user_id ?? "",
    quizId: record.quiz_id ?? "",
    questionId: record.question_id ?? "",
    givenAnswer: record.given_answer ?? "",
    questionMark: parseNullableNumber(record.question_mark),
    achievedMark: parseNullableNumber(record.achieved_mark),
    minusMark: parseNullableNumber(record.minus_mark),
    isCorrect: parseWpBoolean(record.is_correct)
  };
}

function toTutorAttempt(
  record: Record<string, string>,
  answersByAttempt: Record<string, QuizAttemptAnswerItem[]>
): QuizAttemptItem {
  const totalMarks = parseNullableNumber(record.total_marks);
  const earnedMarks = parseNullableNumber(record.earned_marks);

  return {
    sourceId: record.attempt_id ?? "",
    userId: record.user_id ?? "",
    courseId: record.course_id ?? "",
    quizId: record.quiz_id ?? "",
    totalQuestions: parseNullableNumber(record.total_questions),
    totalAnsweredQuestions: parseNullableNumber(record.total_answered_questions),
    totalMarks,
    earnedMarks,
    scorePercent: totalMarks && earnedMarks !== null ? Number(((earnedMarks / totalMarks) * 100).toFixed(2)) : null,
    status: record.attempt_status ?? "",
    result: record.result ?? "",
    startedAt: record.attempt_started_at ?? "",
    endedAt: emptyToNull(record.attempt_ended_at),
    answerCount: answersByAttempt[record.attempt_id ?? ""]?.length ?? 0,
    attemptInfo: parseSerializedRecord(record.attempt_info)
  };
}

function groupAttemptAnswersByAttempt(answers: QuizAttemptAnswerItem[]) {
  const grouped: Record<string, QuizAttemptAnswerItem[]> = {};

  for (const answer of answers) {
    grouped[answer.attemptId] = [...(grouped[answer.attemptId] ?? []), answer];
  }

  return grouped;
}

function sortTutorAnswers(answersByQuestion: Map<string, QuestionAnswerItem[]>) {
  for (const [questionId, answers] of answersByQuestion.entries()) {
    answersByQuestion.set(
      questionId,
      answers.sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || Number(left.sourceId) - Number(right.sourceId))
    );
  }
}

function sortedTutorQuestionIdsForQuiz(questions: Map<string, Record<string, string>>, quizId: string) {
  return Array.from(questions.values())
    .filter((question) => question.quiz_id === quizId)
    .sort((left, right) => Number(left.question_order ?? 0) - Number(right.question_order ?? 0))
    .map((question) => question.question_id ?? "")
    .filter(Boolean);
}

function groupLearnPressQuizQuestions(rows: Array<Record<string, string>>) {
  const grouped: Record<string, string[]> = {};

  for (const row of rows) {
    const quizId = pick(row, ["quiz_id", "quiz"]);
    const questionId = pick(row, ["question_id", "question"]);
    if (!quizId || !questionId) {
      continue;
    }

    grouped[quizId] = [...(grouped[quizId] ?? []), questionId];
  }

  return grouped;
}

function detectLearnPressQuestionType(meta: Record<string, string[]>) {
  const candidates = Object.entries(meta)
    .filter(([key]) => key.toLowerCase().includes("type"))
    .flatMap(([, values]) => values)
    .map((value) => value.toLowerCase());

  for (const value of candidates) {
    if (value.includes("multi") || value.includes("multiple")) {
      return "MULTIPLE_CHOICE";
    }
    if (value.includes("single") || value.includes("true") || value.includes("false")) {
      return value.includes("true") || value.includes("false") ? "TRUE_FALSE" : "SINGLE_CHOICE";
    }
    if (value.includes("fill") || value.includes("blank") || value.includes("short")) {
      return "SHORT_TEXT";
    }
  }

  return "UNKNOWN";
}

function normalizeQuestionType(value: string | undefined) {
  switch (value) {
    case "multiple_choice":
      return "MULTIPLE_CHOICE";
    case "true_false":
      return "TRUE_FALSE";
    case "fill_in_the_blank":
      return "FILL_IN_THE_BLANK";
    case "single_choice":
      return "SINGLE_CHOICE";
    case "open_ended":
      return "OPEN_ENDED";
    case "short_answer":
      return "SHORT_TEXT";
    default:
      return value ? value.toUpperCase() : "UNKNOWN";
  }
}

function parseQuizSettings(serialized: string | null): QuizSettings | null {
  const raw = parseSerializedRecord(serialized);
  if (!raw) {
    return null;
  }

  const timeLimitRaw = toRecordObject(raw.time_limit);
  const timeType = stringValue(timeLimitRaw?.time_type);
  const timeValue = numberValue(timeLimitRaw?.time_value);

  return {
    attemptsAllowed: numberValue(raw.attempts_allowed),
    feedbackMode: stringValue(raw.feedback_mode),
    hideQuestionOverview: booleanValue(raw.hide_question_number_overview),
    hideTimeDisplay: booleanValue(raw.hide_quiz_time_display),
    maxQuestionsForAnswer: numberValue(raw.max_questions_for_answer),
    openEndedAnswerCharactersLimit: numberValue(raw.open_ended_answer_characters_limit),
    passIsRequired: booleanValue(raw.pass_is_required),
    passingGrade: numberValue(raw.passing_grade),
    questionLayoutView: stringValue(raw.question_layout_view),
    questionsOrder: stringValue(raw.questions_order),
    quizAutoStart: booleanValue(raw.quiz_auto_start),
    shortAnswerCharactersLimit: numberValue(raw.short_answer_characters_limit),
    timeLimit: timeLimitRaw
      ? {
          type: timeType,
          value: timeValue,
          seconds: durationUnitToSeconds(timeType, timeValue)
        }
      : null,
    raw
  };
}

function parseVideo(serialized: string | null): VideoValue | null {
  const raw = parseSerializedRecord(serialized);
  if (!raw) {
    return null;
  }

  const runtime = parseDurationFromRecord(toRecordObject(raw.runtime));

  return {
    source: stringValue(raw.source),
    youtubeUrl: firstNonEmpty([raw.source_youtube, raw.source_video_id]),
    vimeoUrl: stringValue(raw.source_vimeo),
    externalUrl: stringValue(raw.source_external_url),
    embedded: stringValue(raw.source_embedded),
    html5: stringValue(raw.source_html5),
    runtime
  };
}

function parseDuration(serialized: string | null): DurationValue | null {
  return parseDurationFromRecord(parseSerializedRecord(serialized));
}

function parseDurationFromRecord(record: Record<string, unknown> | null | undefined): DurationValue | null {
  if (!record) {
    return null;
  }

  return {
    hours: numberValue(record.hours),
    minutes: numberValue(record.minutes),
    seconds: numberValue(record.seconds)
  };
}

function durationToSeconds(duration: DurationValue | null) {
  if (!duration) {
    return null;
  }

  return (duration.hours ?? 0) * 3600 + (duration.minutes ?? 0) * 60 + (duration.seconds ?? 0);
}

function durationUnitToSeconds(type: string | null, value: number | null) {
  if (value === null) {
    return null;
  }

  switch (type) {
    case "seconds":
    case "second":
      return value;
    case "hours":
    case "hour":
      return value * 3600;
    case "days":
    case "day":
      return value * 86400;
    case "weeks":
    case "week":
      return value * 604800;
    case "minutes":
    case "minute":
    default:
      return value * 60;
  }
}

function parseSerializedRecord(serialized: string | null | undefined): Record<string, unknown> | null {
  if (!serialized) {
    return null;
  }

  const parsed = parsePhpSerialized(serialized);
  return toRecordObject(parsed);
}

function parseStringList(serialized: string | null | undefined) {
  const parsed = parsePhpSerialized(serialized);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map((value) => String(value)).filter(Boolean);
}

function parsePhpSerialized(value: string | null | undefined): unknown {
  if (!value) {
    return null;
  }

  try {
    const parser = new PhpSerializedParser(value.replaceAll('\\"', '"'));
    return parser.parse();
  } catch {
    return null;
  }
}

class PhpSerializedParser {
  private index = 0;

  constructor(private readonly input: string) {}

  parse(): unknown {
    const type = this.input[this.index];
    this.index += 2;

    switch (type) {
      case "N":
        this.index -= 1;
        this.expect(";");
        return null;
      case "b":
        return this.parseBoolean();
      case "i":
        return this.parseInteger();
      case "d":
        return this.parseFloat();
      case "s":
        return this.parseString();
      case "a":
        return this.parseArray();
      default:
        throw new Error(`Unsupported PHP serialized type ${String(type)}`);
    }
  }

  private parseBoolean() {
    const raw = this.readUntil(";");
    return raw === "1";
  }

  private parseInteger() {
    return Number.parseInt(this.readUntil(";"), 10);
  }

  private parseFloat() {
    return Number.parseFloat(this.readUntil(";"));
  }

  private parseString() {
    const length = Number.parseInt(this.readUntil(":"), 10);
    this.expect('"');
    const value = this.input.slice(this.index, this.index + length);
    this.index += length;
    this.expect('"');
    this.expect(";");
    return value;
  }

  private parseArray() {
    const length = Number.parseInt(this.readUntil(":"), 10);
    this.expect("{");
    const entries: Array<[unknown, unknown]> = [];

    for (let index = 0; index < length; index += 1) {
      const key = this.parse();
      const value = this.parse();
      entries.push([key, value]);
    }

    this.expect("}");

    const isList = entries.every(([key], index) => Number(key) === index);
    if (isList) {
      return entries.map(([, value]) => value);
    }

    return Object.fromEntries(entries.map(([key, value]) => [String(key), value]));
  }

  private readUntil(char: string) {
    const end = this.input.indexOf(char, this.index);
    if (end === -1) {
      throw new Error(`Missing delimiter ${char}`);
    }

    const value = this.input.slice(this.index, end);
    this.index = end + 1;
    return value;
  }

  private expect(char: string) {
    if (this.input[this.index] !== char) {
      throw new Error(`Expected ${char}`);
    }
    this.index += 1;
  }
}

function buildFeatureEvidence(input: {
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
  attachments: AttachmentItem[];
  courseCompletionComments: TutorCourseCompletionCommentItem[];
  courseReviews: TutorCourseReviewItem[];
  sectionsByCourseId: Record<string, SectionItem[]>;
  questionTypesUsed: Record<string, number>;
}) {
  const evidence: FeatureEvidence[] = [];

  pushEvidence(evidence, "Courses", "Published course content", countStatus(input.courses, "publish"));
  pushEvidence(evidence, "Courses", "Draft/trash course records excluded from production flows", countNonPublish(input.courses));
  pushEvidence(evidence, "Courses", "Structured curriculum sections/topics", Object.keys(input.sectionsByCourseId).length);
  pushEvidence(evidence, "Courses", "Lessons/resources", countStatus(input.lessons, "publish"));
  pushEvidence(evidence, "Courses", "Video lessons", input.lessons.filter((lesson) => hasVideoSource(lesson.video)).length);
  pushEvidence(evidence, "Courses", "Lesson attachments", sumArray(input.lessons.map((lesson) => lesson.attachmentIds.length)));
  pushEvidence(evidence, "Quizzes", "Quiz modules", countStatus(input.quizzes, "publish"));
  pushEvidence(evidence, "Quizzes", "Quiz questions", input.questions.length);
  pushEvidence(evidence, "Quizzes", "Question options/answers", sumArray(input.questions.map((question) => question.answerCount)));
  pushEvidence(evidence, "Quizzes", "Timed quiz settings", input.quizzes.filter((quiz) => (quiz.settings?.timeLimit?.seconds ?? 0) > 0).length);
  pushEvidence(evidence, "Quizzes", "Quiz attempt limits", input.quizzes.filter((quiz) => (quiz.settings?.attemptsAllowed ?? 0) > 0).length);
  pushEvidence(evidence, "Progress", "Course enrollment records", input.enrollments.length);
  pushEvidence(evidence, "Progress", "Lesson completion records", input.lessonProgress.length);
  pushEvidence(evidence, "Progress", "Quiz attempts", input.quizAttempts.length);
  pushEvidence(evidence, "Progress", "Per-question attempt answers", input.quizAttemptAnswers.length);
  pushEvidence(evidence, "Achievements", "Course-completed achievement definitions", input.achievements.length);
  pushEvidence(evidence, "Achievements", "GamiPress user earnings/awards", input.achievementAwards.length);
  pushEvidence(evidence, "Assets", "WordPress media attachment records", input.attachments.length);
  pushEvidence(evidence, "Progress", "Tutor course completion comments", input.courseCompletionComments.length);
  pushEvidence(evidence, "Courses", "Tutor course ratings/reviews", input.courseReviews.length);

  for (const [questionType, count] of Object.entries(input.questionTypesUsed)) {
    pushEvidence(evidence, "Quizzes", `Question type ${questionType}`, count);
  }

  return evidence;
}

function pushEvidence(evidence: FeatureEvidence[], area: string, feature: string, count: number) {
  evidence.push({
    area,
    feature,
    status: count > 0 ? "CONFIRMED" : "UNKNOWN",
    evidence: `${count} matching production records in WordPress LMS dump`
  });
}

function detectPlatforms(sourceTables: Set<string>, posts: Map<string, PostRecord>) {
  const platforms = new Set<string>();

  if (
    Array.from(sourceTables).some((table) => table.includes("_tutor_")) ||
    Array.from(posts.values()).some((post) => TUTOR_POST_TYPES.includes(post.type))
  ) {
    platforms.add("tutor_lms");
  }

  if (
    Array.from(sourceTables).some((table) => table.includes("learnpress")) ||
    Array.from(posts.values()).some((post) => LEARNPRESS_POST_TYPES.includes(post.type))
  ) {
    platforms.add("learnpress");
  }

  return Array.from(platforms);
}

function countQuestionTypes(questions: Array<{ detectedType: string }>) {
  const counts: Record<string, number> = {};
  for (const question of questions) {
    increment(counts, question.detectedType);
  }
  return counts;
}

function countBy<T>(items: T[], selector: (item: T) => string) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    increment(counts, selector(item));
  }
  return counts;
}

function countStatus(items: Array<{ status: string }>, status: string) {
  return items.filter((item) => item.status === status).length;
}

function countNonPublish(items: Array<{ status: string }>) {
  return items.filter((item) => item.status !== "publish").length;
}

function sumArray(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

function mergeCounts(...maps: Array<Record<string, number>>) {
  const merged: Record<string, number> = {};

  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      increment(merged, key, value);
    }
  }

  return merged;
}

function prefixCounts(prefix: string, map: Record<string, number>) {
  const prefixed: Record<string, number> = {};

  for (const [key, value] of Object.entries(map)) {
    prefixed[`${prefix}:${key}`] = value;
  }

  return prefixed;
}

function parentCourseId(posts: Map<string, PostRecord>, topicId: string | null | undefined) {
  if (!topicId) {
    return null;
  }

  const topic = posts.get(topicId);
  if (!topic || !topic.parentId || topic.parentId === "0") {
    return null;
  }

  return topic.parentId;
}

function pushNestedValue(
  map: Map<string, Record<string, string[]>>,
  entityId: string | undefined,
  key: string | undefined,
  value: string
) {
  if (!entityId || !key) {
    return;
  }

  const existing = map.get(entityId) ?? {};
  existing[key] = [...(existing[key] ?? []), value];
  map.set(entityId, existing);
}

function firstMeta(meta: Record<string, string[]>, key: string) {
  return emptyToNull(meta[key]?.[0]);
}

function pick(record: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    if (record[key]) {
      return record[key];
    }
  }

  return undefined;
}

function emptyToNull(value: string | undefined | null) {
  return value ? value : null;
}

function parseNullableNumber(value: string | undefined | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseWpBoolean(value: string | undefined | null) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (["1", "yes", "true", "on"].includes(value.toLowerCase())) {
    return true;
  }

  if (["0", "no", "false", "off"].includes(value.toLowerCase())) {
    return false;
  }

  return null;
}

function parseTutorTimestamp(value: string | undefined) {
  if (!value) {
    return null;
  }

  const unix = Number(value);
  if (Number.isFinite(unix) && unix > 0) {
    return new Date(unix * 1000).toISOString();
  }

  return value;
}

function increment(map: Record<string, number>, key: string, amount = 1) {
  map[key] = (map[key] ?? 0) + amount;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    return parseWpBoolean(value);
  }

  return null;
}

function toRecordObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function firstNonEmpty(values: unknown[]) {
  for (const value of values) {
    const string = stringValue(value);
    if (string) {
      return string;
    }
  }

  return null;
}

function hasVideoSource(video: VideoValue | null) {
  if (!video) {
    return false;
  }

  return Boolean(video.youtubeUrl || video.vimeoUrl || video.externalUrl || video.embedded || video.html5);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
