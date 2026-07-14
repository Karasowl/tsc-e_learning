"use client";

/* ============================================================================
   Cáscara móvil del GUARDIA (estudiante) — "carrera del guardia".
   Presentación gamificada que envuelve la experiencia real ya existente
   (catálogo, lecciones, examen calificado, diploma). Aquí viven solo las
   piezas de chrome/gamificación puras y prop-driven; el motor de examen y el
   fetching siguen en page.tsx (Home) y se reutilizan tal cual.
   ============================================================================ */

import { useEffect } from "react";
import {
  ArrowRight,
  Award,
  BookOpen,
  Check,
  Crosshair,
  Lock,
  ShieldCheck,
  Target,
  User
} from "lucide-react";

// ─── Tipos de gamificación (espejo de las respuestas reales del API) ────────
export type RankInfo = {
  level: number;
  name: string;
  xp: number;
  floor: number;
  next: number | null;
  toNext: number | null;
  pct: number;
};

export type MeProgress = {
  xp: number;
  rank: RankInfo;
  employeeCode: string | null;
  serviceLabel: string | null;
  counts: {
    coursesCompleted: number;
    coursesInProgress: number;
    lessonsCompleted: number;
    certificates: number;
  };
};

export type Badge = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  points: number;
  earned: boolean;
  status: "earned" | "locked";
  awardedAt: string | null;
};

export type BadgesPayload = {
  badges: Badge[];
  earnedCount: number;
  totalCount: number;
};

export type GuardIdentity = {
  id: string;
  email: string;
  displayName: string;
  serviceLabel: string | null;
  employeeCode: string | null;
  roles: string[];
  lastLoginAt: string | null;
  createdAt: string | null;
};

export type GuardTab = "rank" | "courses" | "achievements" | "profile";

type BasicUser = { displayName: string; email: string; roles: string[] };
type ContinueCourse = { id: string; title: string; progressPercent: number | null } | null;

// Escalafón canónico (1..6). Debe coincidir con RANKS del motor del servidor.
export const RANK_LADDER: Array<{ level: number; name: string; floor: number }> = [
  { level: 1, name: "Aspirante", floor: 0 },
  { level: 2, name: "Guardia", floor: 400 },
  { level: 3, name: "Guardia 1ª", floor: 1000 },
  { level: 4, name: "Supervisor", floor: 1500 },
  { level: 5, name: "Jefe de Turno", floor: 2400 },
  { level: 6, name: "Comandante", floor: 3600 }
];

function formatXp(xp: number): string {
  return Math.max(0, Math.round(xp)).toLocaleString("es-MX");
}

function nextRankName(level: number): string | null {
  return RANK_LADDER.find((rank) => rank.level === level + 1)?.name ?? null;
}

// ─── Ancla de marca: escudo inline (el png es oscuro sobre oscuro) ──────────
export function ShieldMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="shield-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
    >
      <path
        d="M12 1.8 20.4 4.9 V11 c0 5.2 -3.6 9.3 -8.4 11.4 C7.2 20.3 3.6 16.2 3.6 11 V4.9 Z"
        fill="var(--tsc-red)"
      />
      <path
        d="M12 1.8 20.4 4.9 V11 c0 5.2 -3.6 9.3 -8.4 11.4 C7.2 20.3 3.6 16.2 3.6 11 V4.9 Z"
        fill="none"
        stroke="var(--tsc-red-bright)"
        strokeWidth="0.6"
      />
      <path
        d="M8.6 12.2 11 14.6 15.6 9.4"
        fill="none"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Barra de avance (mono, ink) ────────────────────────────────────────────
export function GuardProgressBar({ pct }: { pct: number }) {
  const value = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="guard-progress"
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Avance ${Math.round(value)}%`}
    >
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

// ─── Barra superior de identidad ────────────────────────────────────────────
export function GuardTopBar({
  user,
  identity,
  progress
}: {
  user: BasicUser;
  identity: GuardIdentity | null;
  progress: MeProgress | null;
}) {
  const employeeCode = identity?.employeeCode ?? progress?.employeeCode ?? null;
  const rank = progress?.rank ?? null;
  const xp = progress?.xp ?? rank?.xp ?? 0;
  return (
    <header className="guard-topbar">
      <div className="guard-topbar-row">
        <div className="guard-brand">
          <ShieldMark size={30} />
          <span className="guard-wordmark">CAPACITA</span>
        </div>
        {rank ? (
          <div className="guard-rankchip" title={`${rank.name} · ${formatXp(xp)} XP`}>
            <ShieldCheck aria-hidden />
            <span className="guard-rankchip-name">{rank.name}</span>
            <span className="guard-rankchip-xp">{formatXp(xp)} XP</span>
          </div>
        ) : null}
      </div>
      <div className="guard-identity">
        <p className="guard-eyebrow">COLABORADOR{employeeCode ? ` · ${employeeCode}` : ""}</p>
        <strong className="guard-name">{user.displayName}</strong>
      </div>
    </header>
  );
}

// ─── Tabbar inferior fija ───────────────────────────────────────────────────
const TABS: Array<{ key: GuardTab; label: string; Icon: typeof BookOpen }> = [
  { key: "courses", label: "Cursos", Icon: BookOpen },
  { key: "achievements", label: "Logros", Icon: Award },
  { key: "rank", label: "Rango", Icon: ShieldCheck },
  { key: "profile", label: "Perfil", Icon: User }
];

export function GuardTabBar({
  active,
  onChange
}: {
  active: GuardTab;
  onChange: (tab: GuardTab) => void;
}) {
  return (
    <nav className="guard-tabbar" aria-label="Navegación principal">
      {TABS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`guard-tab ${active === key ? "active" : ""}`}
          aria-current={active === key ? "page" : undefined}
          onClick={() => onChange(key)}
        >
          <Icon aria-hidden />
          <span>{label}</span>
        </button>
      ))}
      <span className="guard-home-indicator" aria-hidden />
    </nav>
  );
}

// ─── Métrica mono ───────────────────────────────────────────────────────────
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rank-metric">
      <strong>{value}</strong>
      <span className="mono-label">{label}</span>
    </div>
  );
}

// ─── Tab RANGO (hub) ────────────────────────────────────────────────────────
export function RankTab({
  progress,
  continueCourse,
  onContinue,
  onGoCourses
}: {
  progress: MeProgress | null;
  continueCourse: ContinueCourse;
  onContinue: (courseId: string) => void;
  onGoCourses: () => void;
}) {
  if (!progress) {
    return <p className="guard-empty">Cargando tu rango…</p>;
  }
  const { rank, xp, counts } = progress;
  const atMax = rank.next === null;
  const nextName = nextRankName(rank.level);
  return (
    <section className="rank-tab">
      <div className="rank-hero card">
        <p className="mono-label">RANGO ACTUAL · NIVEL {rank.level}</p>
        <h2 className="rank-name">{rank.name}</h2>
        <p className="rank-xp">
          <strong>{formatXp(xp)}</strong>
          <span className="mono-label">XP TOTAL</span>
        </p>
        <div className="rank-progress-block">
          <GuardProgressBar pct={rank.pct} />
          <p className="rank-progress-meta mono-label">
            {atMax
              ? "RANGO MÁXIMO ALCANZADO"
              : `${formatXp(rank.toNext ?? 0)} XP PARA ${(nextName ?? "").toUpperCase()}`}
          </p>
        </div>
      </div>

      {continueCourse ? (
        <button
          className="mission-card card"
          type="button"
          onClick={() => onContinue(continueCourse.id)}
        >
          <span className="mission-head">
            <Crosshair aria-hidden />
            <span className="guard-eyebrow">CONTINUAR TU MISIÓN</span>
          </span>
          <strong className="mission-title">{continueCourse.title}</strong>
          <span className="mission-progress">
            <GuardProgressBar pct={continueCourse.progressPercent ?? 0} />
            <span className="mono-label">{Math.round(continueCourse.progressPercent ?? 0)}%</span>
          </span>
          <span className="mission-go">
            Continuar <ArrowRight aria-hidden />
          </span>
        </button>
      ) : (
        <button className="mission-card card mission-empty" type="button" onClick={onGoCourses}>
          <span className="mission-head">
            <Target aria-hidden />
            <span className="guard-eyebrow">SIN MISIÓN ACTIVA</span>
          </span>
          <strong className="mission-title">Explora tus cursos y empieza uno</strong>
          <span className="mission-go">
            Ver cursos <ArrowRight aria-hidden />
          </span>
        </button>
      )}

      <div className="rank-metrics">
        <Metric label="APROBADOS" value={counts.coursesCompleted} />
        <Metric label="EN CURSO" value={counts.coursesInProgress} />
        <Metric label="LECCIONES" value={counts.lessonsCompleted} />
        <Metric label="DIPLOMAS" value={counts.certificates} />
      </div>
    </section>
  );
}

// ─── Tab LOGROS (escalafón + insignias) ─────────────────────────────────────
export function AchievementsTab({
  badges,
  progress
}: {
  badges: BadgesPayload | null;
  progress: MeProgress | null;
}) {
  const currentLevel = progress?.rank.level ?? 0;
  return (
    <section className="ach-tab">
      <div className="ladder-card card">
        <div className="guard-block-head">
          <ShieldCheck aria-hidden />
          <h3>Escalafón del guardia</h3>
        </div>
        <ol className="rank-ladder">
          {RANK_LADDER.map((rank) => {
            const state =
              rank.level === currentLevel ? "current" : rank.level < currentLevel ? "passed" : "locked";
            return (
              <li key={rank.level} className={`ladder-step ${state}`}>
                <span className="ladder-level mono-label">N{rank.level}</span>
                <span className="ladder-name">{rank.name}</span>
                <span className="ladder-floor mono-label">{formatXp(rank.floor)} XP</span>
                {state === "current" ? (
                  <span className="pill pill--live ladder-tag">ACTUAL</span>
                ) : state === "passed" ? (
                  <Check className="ladder-check" aria-hidden />
                ) : (
                  <Lock className="ladder-lock" aria-hidden />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="guard-block-head badges-head">
        <h3>Insignias</h3>
        <span className="mono-label">
          {badges?.earnedCount ?? 0}/{badges?.totalCount ?? 0}
        </span>
      </div>
      {badges && badges.badges.length > 0 ? (
        <div className="badge-grid">
          {badges.badges.map((badge) => (
            <div key={badge.id} className={`badge-card card ${badge.earned ? "earned" : "locked"}`}>
              <span className="badge-icon">
                {badge.earned ? <Award aria-hidden /> : <Lock aria-hidden />}
              </span>
              <strong className="badge-title">{badge.title}</strong>
              {badge.description ? <p className="badge-desc">{badge.description}</p> : null}
              <span className="badge-points mono-label">
                {badge.earned ? <Check className="badge-check" aria-hidden /> : null}
                {badge.points} PTS
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="guard-empty">Aún no hay insignias disponibles.</p>
      )}
    </section>
  );
}

// ─── Celebración de ascenso de rango ────────────────────────────────────────
export function AscendOverlay({
  rankName,
  onDismiss
}: {
  rankName: string | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!rankName) {
      return;
    }
    const timer = window.setTimeout(onDismiss, 4200);
    return () => window.clearTimeout(timer);
  }, [rankName, onDismiss]);

  if (!rankName) {
    return null;
  }

  return (
    <div className="ascend-overlay" role="status" aria-live="assertive" onClick={onDismiss}>
      <div className="ascend-card" onClick={(event) => event.stopPropagation()}>
        <span className="ascend-mark">
          <ShieldMark size={72} />
        </span>
        <p className="guard-eyebrow">ASCENSO DE RANGO</p>
        <h2 className="ascend-rank">{rankName}</h2>
        <p className="ascend-copy">Subiste de rango en tu carrera del guardia.</p>
        <button className="btn btn--brand ascend-cta" type="button" onClick={onDismiss}>
          Continuar
        </button>
      </div>
    </div>
  );
}
