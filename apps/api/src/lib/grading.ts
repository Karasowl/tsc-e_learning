export type GradingQuestionType =
  | "SINGLE_CHOICE"
  | "MULTIPLE_CHOICE"
  | "TRUE_FALSE"
  | "FILL_IN_THE_BLANK"
  | "SHORT_TEXT"
  | "OPEN_ENDED"
  | "MATCHING"
  | "ORDERING";

export type GradingOption = {
  id: string;
  label: string;
  value: string;
  gapMatch: string | null;
  isCorrect: boolean;
};

export type GradingQuestion = {
  id: string;
  type: GradingQuestionType;
  points: number;
  options: GradingOption[];
};

export type SubmittedAnswer = {
  questionId: string;
  selectedOptionIds?: string[];
  text?: string;
};

export type QuestionGrade = {
  questionId: string;
  selectedOptionIds: string[];
  text: string | null;
  isCorrect: boolean;
  score: number;
};

export type QuizGrade = {
  totalQuestions: number;
  totalAnsweredQuestions: number;
  totalMarks: number;
  earnedMarks: number;
  scorePercent: number;
  results: QuestionGrade[];
};

export function gradeQuizSubmission(
  questions: GradingQuestion[],
  submittedAnswers: SubmittedAnswer[]
): QuizGrade {
  const answersByQuestion = new Map(submittedAnswers.map((answer) => [answer.questionId, answer]));
  const results = questions.map((question): QuestionGrade => {
    const answer = answersByQuestion.get(question.id);
    const selectedOptionIds = uniqueStrings(answer?.selectedOptionIds ?? []);
    const text = normalizeNullableText(answer?.text);
    const isCorrect = isQuestionCorrect(question, selectedOptionIds, text);

    return {
      questionId: question.id,
      selectedOptionIds,
      text,
      isCorrect,
      score: isCorrect ? question.points : 0
    };
  });

  const totalMarks = round2(questions.reduce((sum, question) => sum + question.points, 0));
  const earnedMarks = round2(results.reduce((sum, result) => sum + result.score, 0));
  const totalAnsweredQuestions = results.filter(
    (result) => result.selectedOptionIds.length > 0 || result.text !== null
  ).length;

  return {
    totalQuestions: questions.length,
    totalAnsweredQuestions,
    totalMarks,
    earnedMarks,
    scorePercent: totalMarks > 0 ? round2((earnedMarks / totalMarks) * 100) : 0,
    results
  };
}

function isQuestionCorrect(question: GradingQuestion, selectedOptionIds: string[], text: string | null) {
  switch (question.type) {
    case "MULTIPLE_CHOICE":
      return sameSet(selectedOptionIds, correctOptionIds(question));
    case "SINGLE_CHOICE":
    case "TRUE_FALSE":
      return selectedOptionIds.length === 1 && correctOptionIds(question).includes(selectedOptionIds[0]!);
    case "FILL_IN_THE_BLANK":
      return text !== null && acceptedFillAnswers(question).includes(normalizeText(text));
    default:
      return false;
  }
}

function correctOptionIds(question: GradingQuestion) {
  return question.options.filter((option) => option.isCorrect).map((option) => option.id);
}

function acceptedFillAnswers(question: GradingQuestion) {
  const explicitlyCorrect = question.options.filter((option) => option.isCorrect);
  const candidates = explicitlyCorrect.length > 0 ? explicitlyCorrect : question.options;

  return uniqueStrings(
    candidates
      .flatMap((option) => [option.label, option.value, option.gapMatch ?? ""])
      .map(normalizeText)
      .filter(Boolean)
  );
}

function sameSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const leftSet = new Set(left);
  return right.every((value) => leftSet.has(value));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeNullableText(value: string | undefined) {
  const normalized = value === undefined ? "" : value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function round2(value: number) {
  return Number(value.toFixed(2));
}
