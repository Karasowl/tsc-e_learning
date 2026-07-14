import { createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "./config.js";
import { SmtpEmailProvider } from "./email.js";

// Invitations stay valid for 7 days. After that the admin re-sends (which issues
// a fresh token and invalidates the old one).
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashInvitationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** A URL-safe random token plus the SHA-256 hash we persist (never the raw). */
export function generateInvitationToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashInvitationToken(raw) };
}

export type InvitationState = "valid" | "used" | "expired";

/**
 * The three ways an invitation resolves: already consumed, past its expiry, or
 * still live. Pure so the token lifecycle is unit-testable without a database.
 */
export function invitationState(
  record: { usedAt: Date | null; expiresAt: Date },
  now: Date = new Date()
): InvitationState {
  if (record.usedAt) {
    return "used";
  }
  if (record.expiresAt.getTime() < now.getTime()) {
    return "expired";
  }
  return "valid";
}

/** Public activation link the invitee opens to set their password. */
export function buildActivationUrl(config: AppConfig, rawToken: string): string {
  const base = config.webPublicUrl.replace(/\/+$/, "");
  return `${base}/activar/${rawToken}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderInvitationEmail(opts: { displayName: string; url: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const name = escapeHtml(opts.displayName);
  const url = escapeHtml(opts.url);
  const html = `<p>Hola, ${name}:</p>
<p>Se creó una cuenta para ti en la plataforma de Capacitación TSC. Para activarla, define tu contraseña con el siguiente enlace:</p>
<p><a href="${url}">Activar mi cuenta</a></p>
<p>Si el botón no funciona, copia y pega esta dirección en tu navegador:<br />${url}</p>
<p>Este enlace caduca en 7 días. Si no esperabas esta invitación, puedes ignorar este mensaje.</p>
<p>Un saludo,<br />El equipo de capacitación TSC</p>`;
  const text = `Hola, ${opts.displayName}:\n\nSe creó una cuenta para ti en la plataforma de Capacitación TSC. Activa tu cuenta y define tu contraseña aquí:\n${opts.url}\n\nEl enlace caduca en 7 días.\n\nEl equipo de capacitación TSC`;
  return { subject: "Activa tu cuenta de Capacitación TSC", html, text };
}

type InvitationLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

export type InvitationDelivery = { delivered: boolean; reason?: string };

/**
 * Attempt to email the activation link. Real delivery is a PRODUCTION concern:
 * to keep local/CI/e2e from ever hitting the real mailbox, we only send when
 * NODE_ENV === "production" and SMTP is configured. Otherwise (and on any send
 * failure) we log the link and report `delivered: false`, so the caller can
 * surface the activation URL to the admin as a hand-off fallback. Never throws.
 */
export async function deliverInvitationEmail(
  config: AppConfig,
  opts: { to: string; displayName: string; url: string },
  logger: InvitationLogger
): Promise<InvitationDelivery> {
  const smtpConfigured = Boolean(config.smtp.host && config.smtp.user && config.smtp.password);

  if (config.nodeEnv !== "production" || !smtpConfigured) {
    logger.info(
      { to: opts.to, activationUrl: opts.url },
      "Invitación creada sin envío de correo (entorno no productivo o SMTP no configurado). El enlace de activación se devuelve en la respuesta."
    );
    return { delivered: false, reason: smtpConfigured ? "non_production" : "smtp_unconfigured" };
  }

  try {
    const provider = new SmtpEmailProvider(config.smtp);
    const email = renderInvitationEmail({ displayName: opts.displayName, url: opts.url });
    await provider.send({ to: [opts.to], subject: email.subject, html: email.html, text: email.text });
    return { delivered: true };
  } catch (error) {
    logger.warn(
      { err: error, to: opts.to, activationUrl: opts.url },
      "No se pudo enviar el correo de invitación; se conserva el enlace de activación para entrega manual."
    );
    return { delivered: false, reason: "send_failed" };
  }
}
