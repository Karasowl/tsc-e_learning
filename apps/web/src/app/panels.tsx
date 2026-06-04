"use client";

import { useEffect, useState } from "react";
import { Award, GraduationCap, Star, UserRound } from "lucide-react";
import { authFetch, errorText } from "./apiClient";

type Review = { rating: number | null; body: string | null; authorName: string; createdAt: string };

export function CourseReviews({ token, courseId }: { token: string; courseId: string }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [average, setAverage] = useState(0);
  const [count, setCount] = useState(0);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function load() {
    try {
      const data = await authFetch<{ reviews: Review[]; averageRating: number; count: number }>(token, `/courses/${courseId}/reviews`);
      setReviews(data.reviews);
      setAverage(data.averageRating);
      setCount(data.count);
    } catch {
      // reviews are non-critical; ignore load errors
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await authFetch(token, `/courses/${courseId}/reviews`, {
        method: "POST",
        body: JSON.stringify({ rating, body: body || null })
      });
      setDone(true);
      setBody("");
      await load();
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reviews">
      <div className="reviews-head">
        <h3>Reseñas</h3>
        {count > 0 ? (
          <span className="rating-summary">
            <Stars value={Math.round(average)} /> {average.toFixed(1)} · {count} reseña{count === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="muted"><small>Aún sin reseñas</small></span>
        )}
      </div>

      <div className="review-form">
        <div className="star-input" role="radiogroup" aria-label="Calificación">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={`star-button ${n <= rating ? "on" : ""}`}
              onClick={() => setRating(n)}
              aria-label={`${n} estrellas`}
            >
              <Star aria-hidden />
            </button>
          ))}
        </div>
        <textarea rows={2} value={body} placeholder="Cuéntanos tu opinión (opcional)" onChange={(e) => setBody(e.target.value)} />
        <div className="quiz-actions">
          <button className="secondary-button" disabled={busy} onClick={() => void submit()} type="button">
            {done ? "Actualizar reseña" : "Enviar reseña"}
          </button>
          {error ? <small className="error-line">{error}</small> : null}
        </div>
      </div>

      <div className="review-list">
        {reviews.map((review, index) => (
          <div className="review-item" key={index}>
            <div className="review-item-head">
              <UserRound aria-hidden />
              <strong>{review.authorName}</strong>
              <Stars value={review.rating ?? 0} />
            </div>
            {review.body ? <p>{review.body}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={n <= value ? "on" : "off"} />
      ))}
    </span>
  );
}

type DirectoryTeacher = {
  id: string;
  displayName: string;
  email: string;
  courseCount: number;
  courses: { id: string; title: string; status: string }[];
};

export function TeachersDirectory({ token }: { token: string }) {
  const [teachers, setTeachers] = useState<DirectoryTeacher[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch<{ teachers?: DirectoryTeacher[] } | DirectoryTeacher[]>(token, "/teachers")
      .then((data) => setTeachers(Array.isArray(data) ? data : data.teachers ?? []))
      .catch((loadError) => setError(errorText(loadError)));
  }, [token]);

  return (
    <section className="data-section">
      <div className="section-header">
        <h2>Instructores</h2>
      </div>
      {error ? <p className="error-line">{error}</p> : null}
      <div className="teacher-grid">
        {teachers.map((teacher) => (
          <article className="teacher-card" key={teacher.id}>
            <div className="teacher-card-head">
              <GraduationCap aria-hidden />
              <div>
                <strong>{teacher.displayName}</strong>
                <small>{teacher.courseCount} curso{teacher.courseCount === 1 ? "" : "s"}</small>
              </div>
            </div>
            <ul>
              {teacher.courses.slice(0, 6).map((course) => (
                <li key={course.id}>{course.title}</li>
              ))}
            </ul>
          </article>
        ))}
        {teachers.length === 0 && !error ? <p className="empty-state">Cargando…</p> : null}
      </div>
    </section>
  );
}

type CompletedItem = {
  course: { id: string; title: string; slug: string };
  completedAt: string | null;
  progressPercent: number | null;
};

export function CompletedCourses({ token }: { token: string }) {
  const [items, setItems] = useState<CompletedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch<{ courses: CompletedItem[] }>(token, "/me/completed")
      .then((data) => setItems(data.courses))
      .catch((loadError) => setError(errorText(loadError)));
  }, [token]);

  return (
    <section className="data-section">
      <div className="section-header">
        <h2>Cursos aprobados</h2>
      </div>
      {error ? <p className="error-line">{error}</p> : null}
      {items.length === 0 && !error ? (
        <p className="empty-state">Todavía no tienes cursos completados. ¡Sigue avanzando!</p>
      ) : (
        <div className="certificate-grid">
          {items.map((item) => (
            <article className="certificate-tile" key={item.course.id}>
              <Award aria-hidden />
              <div>
                <strong>{item.course.title}</strong>
                <small>{item.completedAt ? `Completado ${new Date(item.completedAt).toLocaleDateString("es-MX")}` : "Completado"}</small>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
