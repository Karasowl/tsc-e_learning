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
  position: number;
};

export type SubmittedMatch = {
  optionId: string;
  value: string;
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
  matches?: SubmittedMatch[];
};

export type QuestionGrade = {
  questionId: string;
  selectedOptionIds: string[];
  text: string | null;
  matches: SubmittedMatch[];
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
    const matches = (answer?.matches ?? []).filter((match) => match.optionId && match.value);
    const isCorrect = isQuestionCorrect(question, selectedOptionIds, text, matches);

    return {
      questionId: question.id,
      selectedOptionIds,
      text,
      matches,
      isCorrect,
      score: isCorrect ? question.points : 0
    };
  });

  const totalMarks = round2(questions.reduce((sum, question) => sum + question.points, 0));
  const earnedMarks = round2(results.reduce((sum, result) => sum + result.score, 0));
  const totalAnsweredQuestions = results.filter(
    (result) => result.selectedOptionIds.length > 0 || result.text !== null || result.matches.length > 0
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

function isQuestionCorrect(
  question: GradingQuestion,
  selectedOptionIds: string[],
  text: string | null,
  matches: SubmittedMatch[]
) {
  switch (question.type) {
    case "MULTIPLE_CHOICE":
      return sameSet(selectedOptionIds, correctOptionIds(question));
    case "SINGLE_CHOICE":
    case "TRUE_FALSE":
      return selectedOptionIds.length === 1 && correctOptionIds(question).includes(selectedOptionIds[0]!);
    // SHORT_TEXT is graded like a blank: the teacher stores the accepted
    // answer(s) and we compare the normalized text.
    case "FILL_IN_THE_BLANK":
    case "SHORT_TEXT":
      return text !== null && acceptedFillAnswers(question).includes(normalizeText(text));
    case "ORDERING":
      return isOrderingCorrect(question, selectedOptionIds);
    case "MATCHING":
      return isMatchingCorrect(question, matches);
    default:
      return false;
  }
}

// ORDERING: the student submits option ids in their chosen order
// (selectedOptionIds keeps insertion order); correct when it matches the
// options sorted by their stored position.
function isOrderingCorrect(question: GradingQuestion, orderedOptionIds: string[]) {
  const correctOrder = [...question.options].sort((left, right) => left.position - right.position).map((option) => option.id);
  if (correctOrder.length === 0 || orderedOptionIds.length !== correctOrder.length) {
    return false;
  }
  return correctOrder.every((id, index) => orderedOptionIds[index] === id);
}

// MATCHING: each option is a pair (value = left term, gapMatch = correct right
// term). Correct when every pair's submitted value matches its gapMatch.
function isMatchingCorrect(question: GradingQuestion, matches: SubmittedMatch[]) {
  const pairs = question.options.filter((option) => option.gapMatch !== null && option.gapMatch.trim().length > 0);
  if (pairs.length === 0 || matches.length < pairs.length) {
    return false;
  }
  const submitted = new Map(matches.map((match) => [match.optionId, normalizeText(match.value)]));
  return pairs.every((option) => submitted.get(option.id) === normalizeText(option.gapMatch ?? ""));
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
