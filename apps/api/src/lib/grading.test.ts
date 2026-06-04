import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gradeQuizSubmission, type GradingQuestion } from "./grading.js";

const questions: GradingQuestion[] = [
  {
    id: "q1",
    type: "TRUE_FALSE",
    points: 1,
    options: [
      { id: "true", label: "Verdadero", value: "Verdadero", gapMatch: null, isCorrect: true },
      { id: "false", label: "Falso", value: "Falso", gapMatch: null, isCorrect: false }
    ]
  },
  {
    id: "q2",
    type: "MULTIPLE_CHOICE",
    points: 2,
    options: [
      { id: "a", label: "A", value: "A", gapMatch: null, isCorrect: true },
      { id: "b", label: "B", value: "B", gapMatch: null, isCorrect: true },
      { id: "c", label: "C", value: "C", gapMatch: null, isCorrect: false }
    ]
  },
  {
    id: "q3",
    type: "FILL_IN_THE_BLANK",
    points: 1,
    options: [
      { id: "gap", label: "Proteccion", value: "Proteccion", gapMatch: "Proteccion", isCorrect: true }
    ]
  }
];

describe("quiz grading", () => {
  it("grades true/false, exact multiple-choice sets, and fill-in-the-blank text", () => {
    const result = gradeQuizSubmission(questions, [
      { questionId: "q1", selectedOptionIds: ["true"] },
      { questionId: "q2", selectedOptionIds: ["b", "a"] },
      { questionId: "q3", text: "protección" }
    ]);

    assert.equal(result.totalMarks, 4);
    assert.equal(result.earnedMarks, 4);
    assert.equal(result.scorePercent, 100);
    assert.equal(result.totalAnsweredQuestions, 3);
  });

  it("requires exact option sets for multiple-choice answers", () => {
    const result = gradeQuizSubmission(questions, [{ questionId: "q2", selectedOptionIds: ["a"] }]);

    assert.equal(result.earnedMarks, 0);
    assert.equal(result.results.find((item) => item.questionId === "q2")?.isCorrect, false);
  });
});
