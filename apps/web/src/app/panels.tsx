"use client";

import { FormEvent, useEffect, useState } from "react";
import { Award, GraduationCap, LogOut, Save, ShieldCheck, Star, UserRound } from "lucide-react";
import { authFetch, errorText } from "./apiClient";
import { toast } from "./ui";

type Review = { rating: number | null; body: string | null; authorName: string; createdAt: string };

export function CourseReviews({ token, courseId }: { token: string; courseId: string }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [average, setAverage] = useState<number | null>(0);
  const [count, setCount] = useState(0);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function load() {
    try {
      const data = await authFetch<{
        reviews: Review[];
        averageRating: number | null;
        count: number;
        viewerReview?: { rating: number | null; body: string | null } | null;
      }>(token, `/courses/${courseId}/reviews`);
      setReviews(data.reviews);
      setAverage(data.averageRating);
      setCount(data.count);
      // G-09: si el usuario ya reseñó este curso, precarga su calificación/texto y
      // el CTA pasa a "Actualizar reseña". Si el backend no envía el campo, se
      // degrada de forma segura (formulario vacío, "Enviar reseña").
      if (data.viewerReview) {
        setRating(data.viewerReview.rating ?? 5);
        setBody(data.viewerReview.body ?? "");
        setDone(true);
      }
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
            {typeof average === "number" ? (
              <>
                <Stars value={Math.round(average)} /> {average.toFixed(1)} ·{" "}
              </>
            ) : (
              <>Sin calificaciones · </>
            )}
            {count} reseña{count === 1 ? "" : "s"}
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

type ManagedReview = {
  id: string;
  rating: number | null;
  body: string | null;
  authorName: string;
  status: string;
  createdAt: string;
};

export function ReviewsModeration({ token, courseId }: { token: string; courseId: string }) {
  const [reviews, setReviews] = useState<ManagedReview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const data = await authFetch<{ reviews: ManagedReview[] }>(token, `/admin/courses/${courseId}/reviews`);
      setReviews(data.reviews);
    } catch (loadError) {
      setError(errorText(loadError));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  async function setStatus(id: string, status: "APPROVED" | "HIDDEN") {
    setBusy(true);
    try {
      await authFetch(token, `/admin/reviews/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
      await load();
      toast.success(status === "HIDDEN" ? "Reseña oculta." : "Reseña visible de nuevo.");
    } catch (moderateError) {
      toast.error(errorText(moderateError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="data-section">
      <div className="section-header">
        <h3>Reseñas del curso</h3>
      </div>
      {error ? <p className="error-line">{error}</p> : null}
      {reviews.length === 0 ? (
        <p className="empty-state">Este curso aún no tiene reseñas.</p>
      ) : (
        <div className="review-list">
          {reviews.map((review) => (
            <div className={`review-item${review.status === "HIDDEN" ? " is-hidden" : ""}`} key={review.id}>
              <div className="review-item-head">
                <UserRound aria-hidden />
                <strong>{review.authorName}</strong>
                <Stars value={review.rating ?? 0} />
                {review.status === "HIDDEN" ? <span className="muted"><small>· Oculta</small></span> : null}
              </div>
              {review.body ? <p>{review.body}</p> : null}
              <div className="quiz-actions">
                {review.status === "HIDDEN" ? (
                  <button className="secondary-button" disabled={busy} onClick={() => void setStatus(review.id, "APPROVED")} type="button">
                    Mostrar
                  </button>
                ) : (
                  <button className="ghost-button" disabled={busy} onClick={() => void setStatus(review.id, "HIDDEN")} type="button">
                    Ocultar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
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

type MeProfile = {
  id: string;
  email: string;
  displayName: string;
  serviceLabel: string | null;
  employeeCode: string | null;
  status: string;
  roles: string[];
  lastLoginAt: string | null;
  createdAt: string | null;
};

function roleEs(role: string) {
  return role === "ADMIN"
    ? "Administrador"
    : role === "TEACHER"
      ? "Instructor"
      : role === "STUDENT"
        ? "Colaborador"
        : role;
}

function profileInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function ProfileView({
  token,
  onProfileUpdated,
  rank,
  onLogout
}: {
  token: string;
  onProfileUpdated: (displayName: string) => void;
  // Cuando se provee (cáscara del guardia), el perfil se muestra gamificado:
  // chip de rango+XP y botón de salir. El shell privilegiado no los pasa y
  // conserva su perfil idéntico.
  rank?: { name: string; level: number; xp: number } | null;
  onLogout?: () => void;
}) {
  const [me, setMe] = useState<MeProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [serviceLabel, setServiceLabel] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    let active = true;
    authFetch<{ user: MeProfile }>(token, "/me")
      .then((data) => {
        if (!active) {
          return;
        }
        setMe(data.user);
        setDisplayName(data.user.displayName);
        setServiceLabel(data.user.serviceLabel ?? "");
      })
      .catch((loadError) => {
        if (active) {
          setError(errorText(loadError));
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!displayName.trim()) {
      setError("El nombre no puede estar vacío.");
      return;
    }
    setSavingProfile(true);
    setError(null);
    try {
      const data = await authFetch<{ user: MeProfile }>(token, "/me", {
        method: "PUT",
        body: JSON.stringify({ displayName: displayName.trim(), serviceLabel: serviceLabel.trim() || null })
      });
      setMe((current) =>
        current ? { ...current, displayName: data.user.displayName, serviceLabel: data.user.serviceLabel } : current
      );
      onProfileUpdated(data.user.displayName);
      toast.success("Perfil actualizado.");
    } catch (saveError) {
      const message = errorText(saveError);
      setError(message);
      toast.error(message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast.error("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("La confirmación no coincide.");
      return;
    }
    setSavingPassword(true);
    try {
      await authFetch(token, "/me/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Contraseña actualizada.");
    } catch (saveError) {
      toast.error(errorText(saveError));
    } finally {
      setSavingPassword(false);
    }
  }

  if (!me) {
    return (
      <section className="data-section">
        <p className="empty-state">{error ?? "Cargando…"}</p>
      </section>
    );
  }

  return (
    <div className="profile-view">
      <section className="data-section">
        <div className="profile-hero">
          <span className="avatar xl" aria-hidden>
            {profileInitials(me.displayName)}
          </span>
          <div>
            <h2>{me.displayName}</h2>
            <p className="muted">{me.email}</p>
            {rank ? (
              <span className="pill guard-rank-pill">
                <ShieldCheck aria-hidden /> {rank.name} · {rank.xp.toLocaleString("es-MX")} XP
              </span>
            ) : null}
            <div className="role-chips">
              {me.roles.map((role) => (
                <span className="role-chip" key={role}>
                  {roleEs(role)}
                </span>
              ))}
            </div>
          </div>
        </div>
        <dl className="profile-meta">
          {me.employeeCode ? (
            <div>
              <dt>Código de colaborador</dt>
              <dd className="mono">{me.employeeCode}</dd>
            </div>
          ) : null}
          {me.serviceLabel ? (
            <div>
              <dt>Servicio</dt>
              <dd>{me.serviceLabel}</dd>
            </div>
          ) : null}
          {me.lastLoginAt ? (
            <div>
              <dt>Último acceso</dt>
              <dd>{new Date(me.lastLoginAt).toLocaleString("es-MX")}</dd>
            </div>
          ) : null}
          {me.createdAt ? (
            <div>
              <dt>Miembro desde</dt>
              <dd>{new Date(me.createdAt).toLocaleDateString("es-MX")}</dd>
            </div>
          ) : null}
        </dl>
        {onLogout ? (
          <button className="btn btn--ghost guard-logout" type="button" onClick={onLogout}>
            <LogOut aria-hidden /> Cerrar sesión
          </button>
        ) : null}
      </section>

      <section className="data-section">
        <h2>Editar perfil</h2>
        <form className="profile-form" onSubmit={saveProfile}>
          <label>
            Nombre
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            Servicio / empresa
            <input
              value={serviceLabel}
              onChange={(event) => setServiceLabel(event.target.value)}
              placeholder="Opcional"
            />
          </label>
          {error ? <p className="error-line">{error}</p> : null}
          <button className="primary-button" disabled={savingProfile} type="submit">
            <Save aria-hidden /> Guardar cambios
          </button>
        </form>
      </section>

      <section className="data-section">
        <h2>Cambiar contraseña</h2>
        <form className="profile-form" onSubmit={savePassword}>
          <label>
            Contraseña actual
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            Nueva contraseña
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirmar nueva contraseña
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button
            className="primary-button"
            disabled={savingPassword || !currentPassword || !newPassword}
            type="submit"
          >
            <Save aria-hidden /> Actualizar contraseña
          </button>
        </form>
      </section>
    </div>
  );
}

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
