import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gradeQuizSubmission, type GradingQuestion } from "./grading.js";
import {
  buildRulesSnapshot,
  effectivePassingPercent,
  parseRulesSnapshot,
  snapshotGradingQuestions,
  snapshotSeal,
  DEFAULT_PASSING_PERCENT
} from "./rules-snapshot.js";

// A quiz the student rendered under: one right, one wrong -> 50% score.
const originalQuestions: GradingQuestion[] = [
  {
    id: "q1",
    type: "SINGLE_CHOICE",
    points: 1,
    options: [
      { id: "q1a", label: "A", value: "A", gapMatch: null, isCorrect: true, position: 0 },
      { id: "q1b", label: "B", value: "B", gapMatch: null, isCorrect: false, position: 1 }
    ]
  },
  {
    id: "q2",
    type: "SINGLE_CHOICE",
    points: 1,
    options: [
      { id: "q2a", label: "A", value: "A", gapMatch: null, isCorrect: true, position: 0 },
      { id: "q2b", label: "B", value: "B", gapMatch: null, isCorrect: false, position: 1 }
    ]
  }
];

// The student picks q1 correct, q2 wrong -> 50%.
const studentAnswers = [
  { questionId: "q1", selectedOptionIds: ["q1a"] },
  { questionId: "q2", selectedOptionIds: ["q2b"] }
];

// Simulates persisting to a Json column and reading it back.
function roundTrip(snapshot: unknown) {
  return parseRulesSnapshot(JSON.parse(JSON.stringify(snapshot)));
}

describe("evaluation seal - snapshot capture", () => {
  it("freezes passing threshold, timer, total marks, and questions with their correct keys", () => {
    const snapshot = buildRulesSnapshot({
      courseVersion: 3,
      passingScorePercent: 40,
      timeLimitSec: 1800,
      questions: originalQuestions,
      capturedAt: new Date("2026-07-14T10:00:00.000Z")
    });

    assert.equal(snapshot.passingScorePercent, 40);
    assert.equal(snapshot.timeLimitSec, 1800);
    assert.equal(snapshot.courseVersion, 3);
    assert.equal(snapshot.totalMarks, 2);
    assert.equal(snapshot.capturedAt, "2026-07-14T10:00:00.000Z");
    assert.equal(snapshot.questions.length, 2);
    // Correct key is frozen: q1a is the right answer for q1.
    const q1 = snapshot.questions.find((question) => question.id === "q1");
    assert.equal(q1?.options.find((option) => option.id === "q1a")?.isCorrect, true);
    assert.equal(q1?.options.find((option) => option.id === "q1b")?.isCorrect, false);
  });

  it("defaults a null passing threshold to the platform minimum", () => {
    const snapshot = buildRulesSnapshot({
      courseVersion: 1,
      passingScorePercent: null,
      timeLimitSec: null,
      questions: originalQuestions
    });
    assert.equal(snapshot.passingScorePercent, DEFAULT_PASSING_PERCENT);
  });

  it("survives a JSON round-trip (store/read from the Json column)", () => {
    const snapshot = buildRulesSnapshot({
      courseVersion: 2,
      passingScorePercent: 40,
      timeLimitSec: null,
      questions: originalQuestions
    });
    const parsed = roundTrip(snapshot);
    assert.ok(parsed);
    assert.equal(parsed?.passingScorePercent, 40);
    assert.equal(parsed?.questions.length, 2);
    // A stored snapshot yields a stable integrity tag.
    assert.equal(snapshotSeal(snapshot), snapshotSeal(parsed!));
  });
});

describe("evaluation seal - editing the exam later cannot rewrite history", () => {
  it("keeps the historical verdict (Aprobado) even after the live passing % is raised above the score", () => {
    // Student rendered under a 40% threshold and scored 50% -> passed.
    const snapshot = buildRulesSnapshot({
      courseVersion: 1,
      passingScorePercent: 40,
      timeLimitSec: null,
      questions: originalQuestions
    });
    const stored = roundTrip(snapshot);

    const grade = gradeQuizSubmission(snapshotGradingQuestions(stored!), studentAnswers);
    assert.equal(grade.scorePercent, 50);

    // Instructor later raises the bar to 90% (live rule).
    const liveEditedPassing = 90;

    // Verdict is locked to the sealed 40%, so the score of 50 still passes.
    const sealedThreshold = effectivePassingPercent(stored, liveEditedPassing);
    assert.equal(sealedThreshold, 40);
    assert.equal(grade.scorePercent >= sealedThreshold, true); // Aprobado

    // Proof it would have flipped if we (wrongly) used the live rule.
    assert.equal(grade.scorePercent >= liveEditedPassing, false); // Reprobado
  });

  it("grades against the frozen answer key, so flipping correct options later does not change the score", () => {
    const snapshot = buildRulesSnapshot({
      courseVersion: 1,
      passingScorePercent: 40,
      timeLimitSec: null,
      questions: originalQuestions
    });
    const stored = roundTrip(snapshot);

    // Instructor edits the LIVE quiz: swaps which option is correct on both questions.
    const editedLiveQuestions: GradingQuestion[] = originalQuestions.map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option, isCorrect: !option.isCorrect }))
    }));

    const sealedGrade = gradeQuizSubmission(snapshotGradingQuestions(stored!), studentAnswers);
    const liveGrade = gradeQuizSubmission(editedLiveQuestions, studentAnswers);

    // Same answers, different keys: the seal holds at 50%, the live rule would say 50% the other way.
    assert.equal(sealedGrade.scorePercent, 50);
    // Under the edited key the student's q2 (wrong before) is now right and q1 wrong: still 50 but on different items.
    assert.equal(
      sealedGrade.results.find((result) => result.questionId === "q1")?.isCorrect,
      true
    );
    assert.equal(
      liveGrade.results.find((result) => result.questionId === "q1")?.isCorrect,
      false
    );
  });
});

describe("evaluation seal - fallback without a snapshot", () => {
  it("parses absent/malformed snapshots as null", () => {
    assert.equal(parseRulesSnapshot(null), null);
    assert.equal(parseRulesSnapshot(undefined), null);
    assert.equal(parseRulesSnapshot({}), null);
    assert.equal(parseRulesSnapshot({ passingScorePercent: "x", questions: [] }), null);
    assert.equal(parseRulesSnapshot([]), null);
  });

  it("falls back to the live passing threshold when there is no seal (preserves prior behavior)", () => {
    // A seeded/migrated attempt: no snapshot. Score 100 vs live passing 80 -> passes.
    const noSnapshot = parseRulesSnapshot(null);
    assert.equal(effectivePassingPercent(noSnapshot, 80), 80);
    assert.equal(100 >= effectivePassingPercent(noSnapshot, 80), true); // Aprobado, as before

    // And a null live threshold falls back to the platform minimum.
    assert.equal(effectivePassingPercent(noSnapshot, null), DEFAULT_PASSING_PERCENT);
  });
});
