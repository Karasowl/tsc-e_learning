import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gradeQuizSubmission, type GradingQuestion } from "./grading.js";

const questions: GradingQuestion[] = [
  {
    id: "q1",
    type: "TRUE_FALSE",
    points: 1,
    options: [
      { id: "true", label: "Verdadero", value: "Verdadero", gapMatch: null, isCorrect: true, position: 0 },
      { id: "false", label: "Falso", value: "Falso", gapMatch: null, isCorrect: false, position: 1 }
    ]
  },
  {
    id: "q2",
    type: "MULTIPLE_CHOICE",
    points: 2,
    options: [
      { id: "a", label: "A", value: "A", gapMatch: null, isCorrect: true, position: 0 },
      { id: "b", label: "B", value: "B", gapMatch: null, isCorrect: true, position: 1 },
      { id: "c", label: "C", value: "C", gapMatch: null, isCorrect: false, position: 2 }
    ]
  },
  {
    id: "q3",
    type: "FILL_IN_THE_BLANK",
    points: 1,
    options: [
      { id: "gap", label: "Proteccion", value: "Proteccion", gapMatch: "Proteccion", isCorrect: true, position: 0 }
    ]
  }
];

const matchingQuestion: GradingQuestion = {
  id: "qm",
  type: "MATCHING",
  points: 2,
  options: [
    { id: "m1", label: "", value: "Perro", gapMatch: "Dog", isCorrect: true, position: 0 },
    { id: "m2", label: "", value: "Gato", gapMatch: "Cat", isCorrect: true, position: 1 }
  ]
};

const orderingQuestion: GradingQuestion = {
  id: "qo",
  type: "ORDERING",
  points: 3,
  options: [
    { id: "o1", label: "", value: "Uno", gapMatch: null, isCorrect: false, position: 0 },
    { id: "o2", label: "", value: "Dos", gapMatch: null, isCorrect: false, position: 1 },
    { id: "o3", label: "", value: "Tres", gapMatch: null, isCorrect: false, position: 2 }
  ]
};

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

  it("grades matching questions by pair value", () => {
    const ok = gradeQuizSubmission([matchingQuestion], [
      { questionId: "qm", matches: [{ optionId: "m1", value: "dog" }, { optionId: "m2", value: "Cat" }] }
    ]);
    assert.equal(ok.earnedMarks, 2);
    assert.equal(ok.totalAnsweredQuestions, 1);

    const wrong = gradeQuizSubmission([matchingQuestion], [
      { questionId: "qm", matches: [{ optionId: "m1", value: "Cat" }, { optionId: "m2", value: "Dog" }] }
    ]);
    assert.equal(wrong.earnedMarks, 0);
  });

  it("grades ordering questions by submitted order", () => {
    const ok = gradeQuizSubmission([orderingQuestion], [
      { questionId: "qo", selectedOptionIds: ["o1", "o2", "o3"] }
    ]);
    assert.equal(ok.earnedMarks, 3);

    const wrong = gradeQuizSubmission([orderingQuestion], [
      { questionId: "qo", selectedOptionIds: ["o2", "o1", "o3"] }
    ]);
    assert.equal(wrong.earnedMarks, 0);
  });
});
