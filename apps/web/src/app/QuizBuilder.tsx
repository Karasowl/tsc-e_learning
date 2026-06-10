"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, GripVertical, Plus, Save, Trash2 } from "lucide-react";
import { authFetch, errorText } from "./apiClient";
import { confirmDialog, toast } from "./ui";

const QUESTION_TYPES: { value: string; label: string }[] = [
  { value: "SINGLE_CHOICE", label: "Opción única" },
  { value: "MULTIPLE_CHOICE", label: "Opción múltiple" },
  { value: "TRUE_FALSE", label: "Verdadero / Falso" },
  { value: "FILL_IN_THE_BLANK", label: "Completar" },
  { value: "SHORT_TEXT", label: "Respuesta corta" },
  { value: "MATCHING", label: "Enlazar" },
  { value: "ORDERING", label: "Ordenar" }
];

function typeLabel(type: string) {
  return QUESTION_TYPES.find((item) => item.value === type)?.label ?? type;
}

type BuilderOption = {
  id: string;
  label: string;
  value: string;
  gapMatch: string | null;
  position: number;
  isCorrect: boolean;
};

type BuilderQuestion = {
  id: string;
  type: string;
  prompt: string;
  points: number;
  options: BuilderOption[];
};

type BuilderQuiz = {
  id: string;
  title: string;
  status: string;
  timeLimitSec: number | null;
  passingScorePercent: number | null;
  maxAttempts: number | null;
  questions: BuilderQuestion[];
};

export function QuizBuilder({ token, quizId, onBack }: { token: string; quizId: string; onBack: () => void }) {
  const [quiz, setQuiz] = useState<BuilderQuiz | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const data = await authFetch<{ quiz: BuilderQuiz }>(token, `/admin/quizzes/${quizId}`);
      setQuiz(data.quiz);
    } catch (loadError) {
      setError(errorText(loadError));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId]);

  function patch(next: Partial<BuilderQuiz>) {
    setQuiz((current) => (current ? { ...current, ...next } : current));
  }

  async function saveSettings() {
    if (!quiz) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authFetch(token, `/admin/quizzes/${quiz.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: quiz.title,
          status: quiz.status,
          timeLimitSec: quiz.timeLimitSec,
          passingScorePercent: quiz.passingScorePercent,
          maxAttempts: quiz.maxAttempts
        })
      });
      await load();
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function removeQuestion(id: string) {
    const confirmed = await confirmDialog({
      title: "Eliminar pregunta",
      message: "La pregunta se eliminará del examen.",
      confirmLabel: "Eliminar",
      danger: true
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await authFetch(token, `/admin/questions/${id}`, { method: "DELETE" });
      await load();
      toast.success("Pregunta eliminada.");
    } catch (removeError) {
      const message = errorText(removeError);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  if (!quiz) {
    return (
      <div className="quiz-builder">
        <button className="ghost-button" onClick={onBack} type="button">
          <ArrowLeft aria-hidden /> Volver al curso
        </button>
        {error ? <p className="error-line">{error}</p> : <p className="empty-state">Cargando examen…</p>}
      </div>
    );
  }

  return (
    <div className="quiz-builder">
      <div className="section-header">
        <button className="ghost-button" onClick={onBack} type="button">
          <ArrowLeft aria-hidden /> Volver al curso
        </button>
        <button className="primary-button" disabled={busy} onClick={() => void saveSettings()} type="button">
          <Save aria-hidden /> Guardar ajustes
        </button>
      </div>

      {error ? <p className="error-line">{error}</p> : null}

      <div className="editor-grid">
        <label>
          Título del examen
          <input value={quiz.title} onChange={(e) => patch({ title: e.target.value })} />
        </label>
        <label>
          Estado
          <select value={quiz.status} onChange={(e) => patch({ status: e.target.value })}>
            <option value="DRAFT">Borrador</option>
            <option value="PUBLISHED">Publicado</option>
            <option value="ARCHIVED">Archivado</option>
          </select>
        </label>
        <label>
          Tiempo límite (minutos, vacío = sin límite)
          <input
            type="number"
            min={0}
            value={quiz.timeLimitSec ? Math.round(quiz.timeLimitSec / 60) : ""}
            onChange={(e) => patch({ timeLimitSec: e.target.value ? Number(e.target.value) * 60 : null })}
          />
        </label>
        <label>
          % para aprobar
          <input
            type="number"
            min={0}
            max={100}
            value={quiz.passingScorePercent ?? ""}
            onChange={(e) => patch({ passingScorePercent: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
        <label>
          Intentos permitidos (vacío = ilimitado)
          <input
            type="number"
            min={1}
            value={quiz.maxAttempts ?? ""}
            onChange={(e) => patch({ maxAttempts: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
      </div>

      <div className="section-header">
        <h3>Preguntas ({quiz.questions.length})</h3>
        {!adding && !editingId ? (
          <button className="secondary-button" onClick={() => setAdding(true)} type="button">
            <Plus aria-hidden /> Agregar pregunta
          </button>
        ) : null}
      </div>

      {adding ? (
        <QuestionForm
          token={token}
          quizId={quiz.id}
          onDone={async () => {
            setAdding(false);
            await load();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {quiz.questions.map((question, index) =>
        editingId === question.id ? (
          <QuestionForm
            key={question.id}
            token={token}
            quizId={quiz.id}
            question={question}
            onDone={async () => {
              setEditingId(null);
              await load();
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <div className="question-card" key={question.id}>
            <div className="question-card-head">
              <div>
                <span className="qtype">{index + 1}. {typeLabel(question.type)}</span>
                <p className="qprompt">{question.prompt}</p>
              </div>
              <div className="quiz-actions">
                <button className="secondary-button" onClick={() => setEditingId(question.id)} type="button">Editar</button>
                <button className="icon-button" onClick={() => void removeQuestion(question.id)} title="Eliminar" type="button">
                  <Trash2 aria-hidden />
                </button>
              </div>
            </div>
          </div>
        )
      )}
      {quiz.questions.length === 0 && !adding ? <p className="empty-state">Aún no hay preguntas. Agrega la primera.</p> : null}
    </div>
  );
}

type Row = { value: string; gapMatch: string };

function QuestionForm({
  token,
  quizId,
  question,
  onDone,
  onCancel
}: {
  token: string;
  quizId: string;
  question?: BuilderQuestion;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [type, setType] = useState(question?.type ?? "SINGLE_CHOICE");
  const [prompt, setPrompt] = useState(question?.prompt ?? "");
  const [points, setPoints] = useState(question?.points ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<Row[]>(() => initialRows(question));
  const [correctIndex, setCorrectIndex] = useState<number>(() => initialCorrectIndex(question));
  const [correctSet, setCorrectSet] = useState<Set<number>>(() => initialCorrectSet(question));
  const [trueFalse, setTrueFalse] = useState<boolean>(() => initialTrueFalse(question));

  function addRow() {
    setRows((current) => [...current, { value: "", gapMatch: "" }]);
  }
  function updateRow(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }
  function move(index: number, delta: number) {
    setRows((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) {
        return current;
      }
      const tmp = next[index]!;
      next[index] = next[target]!;
      next[target] = tmp;
      return next;
    });
  }

  function buildPayload() {
    const base: Record<string, unknown> = { type, prompt, points };
    if (type === "TRUE_FALSE") {
      base.correctValue = trueFalse;
      return base;
    }
    if (type === "SINGLE_CHOICE") {
      base.options = rows.map((row, i) => ({ value: row.value, isCorrect: i === correctIndex }));
      return base;
    }
    if (type === "MULTIPLE_CHOICE") {
      base.options = rows.map((row, i) => ({ value: row.value, isCorrect: correctSet.has(i) }));
      return base;
    }
    if (type === "FILL_IN_THE_BLANK" || type === "SHORT_TEXT") {
      base.options = rows.map((row) => ({ value: row.value, isCorrect: true }));
      return base;
    }
    if (type === "MATCHING") {
      base.options = rows.map((row) => ({ value: row.value, gapMatch: row.gapMatch, isCorrect: true }));
      return base;
    }
    if (type === "ORDERING") {
      base.options = rows.map((row, i) => ({ value: row.value, position: i }));
      return base;
    }
    return base;
  }

  function validateQuestion(): string | null {
    if (!prompt.trim()) {
      return "Escribe el enunciado de la pregunta.";
    }
    if (type === "SINGLE_CHOICE") {
      if (rows.filter((row) => row.value.trim()).length < 2) {
        return "Agrega al menos dos opciones.";
      }
      if (correctIndex < 0 || correctIndex >= rows.length || !rows[correctIndex]?.value.trim()) {
        return "Marca la opción correcta.";
      }
    }
    if (type === "MULTIPLE_CHOICE") {
      if (rows.filter((row) => row.value.trim()).length < 2) {
        return "Agrega al menos dos opciones.";
      }
      if (!rows.some((row, index) => correctSet.has(index) && row.value.trim())) {
        return "Marca al menos una opción correcta.";
      }
    }
    if (type === "FILL_IN_THE_BLANK" || type === "SHORT_TEXT") {
      if (!rows.some((row) => row.value.trim())) {
        return "Agrega al menos una respuesta aceptada.";
      }
    }
    if (type === "MATCHING") {
      if (rows.filter((row) => row.value.trim() && (row.gapMatch ?? "").trim()).length < 2) {
        return "Agrega al menos dos pares (término y coincidencia).";
      }
    }
    if (type === "ORDERING") {
      if (rows.filter((row) => row.value.trim()).length < 2) {
        return "Agrega al menos dos elementos para ordenar.";
      }
    }
    return null;
  }

  async function save() {
    const validationError = validateQuestion();
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = buildPayload();
      if (question) {
        await authFetch(token, `/admin/questions/${question.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await authFetch(token, `/admin/quizzes/${quizId}/questions`, { method: "POST", body: JSON.stringify(payload) });
      }
      await onDone();
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setBusy(false);
    }
  }

  const usesRows = type !== "TRUE_FALSE";

  return (
    <div className="question-form">
      <div className="editor-grid">
        <label>
          Tipo de pregunta
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {QUESTION_TYPES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          Puntos
          <input type="number" min={0} step={0.5} value={points} onChange={(e) => setPoints(Number(e.target.value) || 1)} />
        </label>
      </div>
      <label>
        Enunciado
        <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>

      {type === "TRUE_FALSE" ? (
        <div className="tf-row">
          <label className="inline-radio">
            <input type="radio" checked={trueFalse} onChange={() => setTrueFalse(true)} /> Verdadero
          </label>
          <label className="inline-radio">
            <input type="radio" checked={!trueFalse} onChange={() => setTrueFalse(false)} /> Falso
          </label>
        </div>
      ) : null}

      {usesRows ? (
        <div className="rows">
          <p className="muted"><small>{rowHint(type)}</small></p>
          {rows.map((row, index) => (
            <div className="opt-row" key={index}>
              {type === "ORDERING" ? <GripVertical aria-hidden className="grip" /> : null}
              {type === "SINGLE_CHOICE" ? (
                <input type="radio" checked={correctIndex === index} onChange={() => setCorrectIndex(index)} title="Correcta" />
              ) : null}
              {type === "MULTIPLE_CHOICE" ? (
                <input
                  type="checkbox"
                  checked={correctSet.has(index)}
                  onChange={(e) =>
                    setCorrectSet((current) => {
                      const next = new Set(current);
                      if (e.target.checked) {
                        next.add(index);
                      } else {
                        next.delete(index);
                      }
                      return next;
                    })
                  }
                  title="Correcta"
                />
              ) : null}
              <input
                value={row.value}
                placeholder={type === "MATCHING" ? "Término" : "Opción"}
                onChange={(e) => updateRow(index, { value: e.target.value })}
              />
              {type === "MATCHING" ? (
                <input value={row.gapMatch} placeholder="Coincide con…" onChange={(e) => updateRow(index, { gapMatch: e.target.value })} />
              ) : null}
              {type === "ORDERING" ? (
                <span className="order-controls">
                  <button type="button" className="icon-button" onClick={() => move(index, -1)} title="Subir">↑</button>
                  <button type="button" className="icon-button" onClick={() => move(index, 1)} title="Bajar">↓</button>
                </span>
              ) : null}
              <button type="button" className="icon-button" onClick={() => removeRow(index)} title="Quitar">
                <Trash2 aria-hidden />
              </button>
            </div>
          ))}
          <button type="button" className="secondary-button" onClick={addRow}>
            <Plus aria-hidden /> {type === "MATCHING" ? "Agregar par" : type === "ORDERING" ? "Agregar elemento" : "Agregar opción"}
          </button>
        </div>
      ) : null}

      {error ? <p className="error-line">{error}</p> : null}
      <div className="quiz-actions">
        <button className="primary-button" disabled={busy} onClick={() => void save()} type="button">
          <Save aria-hidden /> Guardar pregunta
        </button>
        <button className="ghost-button" onClick={onCancel} type="button">Cancelar</button>
      </div>
    </div>
  );
}

function rowHint(type: string) {
  switch (type) {
    case "SINGLE_CHOICE":
      return "Marca la opción correcta.";
    case "MULTIPLE_CHOICE":
      return "Marca todas las opciones correctas.";
    case "FILL_IN_THE_BLANK":
    case "SHORT_TEXT":
      return "Escribe las respuestas aceptadas (una por fila).";
    case "MATCHING":
      return "Cada fila es un par: término y su coincidencia correcta.";
    case "ORDERING":
      return "Escribe los elementos en el orden correcto.";
    default:
      return "";
  }
}

function initialRows(question?: BuilderQuestion): Row[] {
  if (!question) {
    return [{ value: "", gapMatch: "" }, { value: "", gapMatch: "" }];
  }
  if (question.type === "TRUE_FALSE") {
    return [];
  }
  if (question.options.length === 0) {
    return [{ value: "", gapMatch: "" }];
  }
  return question.options.map((option) => ({ value: option.value, gapMatch: option.gapMatch ?? "" }));
}

function initialCorrectIndex(question?: BuilderQuestion) {
  if (!question) {
    return 0;
  }
  const index = question.options.findIndex((option) => option.isCorrect);
  return index >= 0 ? index : 0;
}

function initialCorrectSet(question?: BuilderQuestion) {
  const set = new Set<number>();
  question?.options.forEach((option, index) => {
    if (option.isCorrect) {
      set.add(index);
    }
  });
  return set;
}

function initialTrueFalse(question?: BuilderQuestion) {
  if (!question || question.type !== "TRUE_FALSE") {
    return true;
  }
  const correct = question.options.find((option) => option.isCorrect);
  return correct ? /verdad|true|^s[ií]$/i.test(correct.value) : true;
}
