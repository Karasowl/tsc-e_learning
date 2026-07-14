import type { GradingQuestion, GradingQuestionType } from "./grading.js";

// Immutable evaluation seal.
//
// When a student starts a quiz attempt we freeze the rules they are graded
// against into `QuizAttempt.rulesSnapshot` (JSON) + `QuizAttempt.rulesVersion`
// (the course version at that moment). Grading (on submit) and the compliance
// report evaluate pass/fail against this snapshot, NOT the live quiz, so an
// instructor editing the exam later can never re-write a historical verdict.
//
// Attempts created before this feature (seed/migrated) have no snapshot; every
// reader falls back to the live quiz rule, preserving the previous behavior.

export const RULES_SNAPSHOT_FORMAT = 1;
export const DEFAULT_PASSING_PERCENT = 80;

export type RulesSnapshotOption = {
  id: string;
  label: string;
  value: string;
  gapMatch: string | null;
  isCorrect: boolean;
  position: number;
};

export type RulesSnapshotQuestion = {
  id: string;
  type: GradingQuestionType;
  points: number;
  options: RulesSnapshotOption[];
};

export type RulesSnapshot = {
  /** Snapshot format version, so the shape can evolve without misreading old rows. */
  format: number;
  /** ISO timestamp when the attempt (and thus the seal) was created. */
  capturedAt: string;
  /** Course version the attempt was rendered under (the "pill" the UI shows). */
  courseVersion: number | null;
  /** Frozen passing threshold (percent). */
  passingScorePercent: number;
  /** Frozen time limit in seconds, if the quiz had one. */
  timeLimitSec: number | null;
  /** Sum of question points at capture time. */
  totalMarks: number;
  /** Frozen questions + correct keys used to grade this attempt. */
  questions: RulesSnapshotQuestion[];
};

/** Null/blank passing thresholds default to the platform minimum (80%). */
export function normalizePassingPercent(passing: number | null | undefined): number {
  return typeof passing === "number" && Number.isFinite(passing) ? passing : DEFAULT_PASSING_PERCENT;
}

export function buildRulesSnapshot(input: {
  courseVersion: number | null;
  passingScorePercent: number | null;
  timeLimitSec: number | null;
  questions: GradingQuestion[];
  capturedAt?: Date;
}): RulesSnapshot {
  const questions: RulesSnapshotQuestion[] = input.questions.map((question) => ({
    id: question.id,
    type: question.type,
    points: question.points,
    options: question.options.map((option) => ({
      id: option.id,
      label: option.label,
      value: option.value,
      gapMatch: option.gapMatch,
      isCorrect: option.isCorrect,
      position: option.position
    }))
  }));

  const totalMarks = round2(questions.reduce((sum, question) => sum + question.points, 0));

  return {
    format: RULES_SNAPSHOT_FORMAT,
    capturedAt: (input.capturedAt ?? new Date()).toISOString(),
    courseVersion: input.courseVersion,
    passingScorePercent: normalizePassingPercent(input.passingScorePercent),
    timeLimitSec: input.timeLimitSec ?? null,
    totalMarks,
    questions
  };
}

/**
 * Parse a stored snapshot back into a typed object. Returns null when the value
 * is absent or malformed, which every caller treats as "fall back to the live
 * rule" (the pre-seal behavior). A snapshot is only usable if it carries a
 * numeric passing threshold and a questions array.
 */
export function parseRulesSnapshot(value: unknown): RulesSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.passingScorePercent !== "number" || !Number.isFinite(snapshot.passingScorePercent)) {
    return null;
  }
  if (!Array.isArray(snapshot.questions)) {
    return null;
  }

  const questions = snapshot.questions
    .map(parseSnapshotQuestion)
    .filter((question): question is RulesSnapshotQuestion => question !== null);

  return {
    format: typeof snapshot.format === "number" ? snapshot.format : 0,
    capturedAt: typeof snapshot.capturedAt === "string" ? snapshot.capturedAt : "",
    courseVersion: typeof snapshot.courseVersion === "number" ? snapshot.courseVersion : null,
    passingScorePercent: snapshot.passingScorePercent,
    timeLimitSec: typeof snapshot.timeLimitSec === "number" ? snapshot.timeLimitSec : null,
    totalMarks: typeof snapshot.totalMarks === "number" ? snapshot.totalMarks : round2(questions.reduce((sum, q) => sum + q.points, 0)),
    questions
  };
}

/** The passing threshold that governs an attempt: the frozen one if sealed, else live. */
export function effectivePassingPercent(snapshot: RulesSnapshot | null, livePassing: number | null): number {
  if (snapshot) {
    return snapshot.passingScorePercent;
  }
  return normalizePassingPercent(livePassing);
}

/** Grading questions to score an attempt against: the frozen set if sealed, else the caller's live set. */
export function snapshotGradingQuestions(snapshot: RulesSnapshot): GradingQuestion[] {
  return snapshot.questions.map((question) => ({
    id: question.id,
    type: question.type,
    points: question.points,
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

/**
 * Short, stable tag over the snapshot for the "Resultados con sello" UI. Same
 * snapshot -> same tag; any edit to the frozen rules would change it (though the
 * stored snapshot is never mutated, so the tag is a display/integrity marker).
 */
export function snapshotSeal(snapshot: RulesSnapshot): string {
  const json = JSON.stringify(snapshot);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseSnapshotQuestion(value: unknown): RulesSnapshotQuestion | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const question = value as Record<string, unknown>;
  if (typeof question.id !== "string" || typeof question.type !== "string") {
    return null;
  }
  const options = Array.isArray(question.options)
    ? question.options.map(parseSnapshotOption).filter((option): option is RulesSnapshotOption => option !== null)
    : [];
  return {
    id: question.id,
    type: question.type as GradingQuestionType,
    points: typeof question.points === "number" ? question.points : 0,
    options
  };
}

function parseSnapshotOption(value: unknown): RulesSnapshotOption | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const option = value as Record<string, unknown>;
  if (typeof option.id !== "string") {
    return null;
  }
  return {
    id: option.id,
    label: typeof option.label === "string" ? option.label : "",
    value: typeof option.value === "string" ? option.value : "",
    gapMatch: typeof option.gapMatch === "string" ? option.gapMatch : null,
    isCorrect: option.isCorrect === true,
    position: typeof option.position === "number" ? option.position : 0
  };
}

function round2(value: number) {
  return Number(value.toFixed(2));
}
