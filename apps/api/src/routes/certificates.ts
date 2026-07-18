import { readFile } from "node:fs/promises";
import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../lib/config.js";
import {
  certificateFolio,
  certificateStorageKey,
  certificateVerificationCode,
  renderCertificateHtml,
  resolveCertificateTemplateBody,
  type CertificateView
} from "../lib/certificates.js";
import {
  renderCertificatePdf,
  DEFAULT_CERTIFICATE_BACKGROUND_PATH
} from "../lib/certificate-pdf.js";
import { isAdmin, requireAuth, type AuthContext } from "../lib/auth.js";
import { logAdminAction } from "../lib/audit.js";
import { emitStudentNotification } from "../lib/notifications.js";
import {
  LEDGER_SOURCE,
  XP_CERTIFICATE_ISSUED,
  detectAscension,
  ledgerSourceId,
  rankInfo,
  totalXp
} from "../lib/gamification.js";

const issueCertificateSchema = z.object({
  courseId: z.string().min(1)
});

const certificateRefSchema = z.object({
  certificateId: z.string().min(1)
});

const verificationSchema = z.object({
  verificationCode: z.string().min(1)
});

const adminIssueSchema = z.object({
  userId: z.string().min(1),
  courseId: z.string().min(1)
});

const certInclude = {
  user: { select: { id: true, displayName: true, email: true } },
  course: { select: { id: true, title: true, slug: true, teacherId: true } }
} satisfies Prisma.CertificateInclude;

/**
 * Resultado (puro) de la verificación pública por código. Un diploma REVOKED
 * conserva su fila pero deja de ser válido: la verificación lo dice de frente
 * en vez de fingir que nunca existió.
 */
export function certificateVerifyOutcome(
  certificate: { status: string } | null
): "valid" | "revoked" | "not_found" {
  if (!certificate) {
    return "not_found";
  }
  if (certificate.status === "REVOKED") {
    return "revoked";
  }
  return certificate.status === "ISSUED" ? "valid" : "not_found";
}

/**
 * Decisión (pura) de la emisión admin de un diploma: exige inscripción
 * COMPLETED, rechaza duplicar un diploma vigente y, si el existente está
 * revocado, la emisión procede REUTILIZANDO esa fila (nuevo folio y código,
 * misma restricción de un diploma por colaborador+curso).
 */
export function adminIssueDecision(input: {
  enrollmentStatus: string | null;
  existingStatus: string | null;
}): { kind: "issue" } | { kind: "reissue" } | { kind: "blocked"; reason: "not_completed" | "already_issued" } {
  if (input.enrollmentStatus !== "COMPLETED") {
    return { kind: "blocked", reason: "not_completed" };
  }
  if (input.existingStatus === "ISSUED") {
    return { kind: "blocked", reason: "already_issued" };
  }
  return input.existingStatus === "REVOKED" ? { kind: "reissue" } : { kind: "issue" };
}

/**
 * Filtra (puro) los candidatos a emisión admin: inscripciones COMPLETED cuyo
 * colaborador aún no tiene diploma vigente (ISSUED) de ese curso. Un diploma
 * revocado NO bloquea: ese colaborador vuelve a ser candidato a reemisión.
 */
export function certificateCandidates<T extends { userId: string; courseId: string }>(
  completedEnrollments: T[],
  issuedCertificates: Array<{ userId: string; courseId: string }>
): T[] {
  const taken = new Set(issuedCertificates.map((cert) => `${cert.userId}:${cert.courseId}`));
  return completedEnrollments.filter((enrollment) => !taken.has(`${enrollment.userId}:${enrollment.courseId}`));
}

type IssuedCertificateResult = {
  certificate: Prisma.CertificateGetPayload<{ include: typeof certInclude }>;
  xpDelta: number;
  xpTotal: number;
};

/**
 * La reemisión encontró que la fila ya NO está revocada (otro proceso la emitió
 * primero). Aborta la transacción sin pisar folio/código ni duplicar la
 * notificación; la ruta lo traduce a 409.
 */
export class CertificateReissueConflictError extends Error {
  constructor() {
    super("El diploma ya no está revocado: otra emisión ganó la carrera.");
    this.name = "CertificateReissueConflictError";
  }
}

/**
 * Núcleo COMPARTIDO de emisión de un diploma (autoservicio del alumno y emisión
 * admin usan exactamente este camino). Debe correr dentro de una transacción:
 * el certificado, su notificación (log + correo al alumno si tiene email real)
 * y el XP del diploma quedan atómicos, de modo que un diploma real SIEMPRE
 * tiene su evento de XP y su aviso.
 *
 * `reissueCertificateId` reutiliza la fila de un diploma REVOCADO del mismo
 * colaborador+curso (nuevo folio, nuevo código, nueva fecha, status ISSUED).
 * El XP es idempotente por curso (clave CERT:<courseId>): una reemisión no
 * vuelve a otorgar los +240, igual que el ledger conserva el XP del diploma
 * revocado (decisión de producto: el historial no se resta).
 */
export async function issueCertificateWithinTx(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    courseId: string;
    courseTitle: string;
    templateId: string | null;
    issuedAt: Date;
    reissueCertificateId?: string | null;
  }
): Promise<IssuedCertificateResult> {
  const folio = certificateFolio(args.userId, args.courseId, args.issuedAt);
  const verificationCode = certificateVerificationCode(args.userId, args.courseId, args.issuedAt);
  const data = {
    templateId: args.templateId,
    status: "ISSUED" as const,
    folio,
    verificationCode,
    pdfStorageKey: certificateStorageKey(folio),
    issuedAt: args.issuedAt,
    revokedAt: null
  };

  let certificate: IssuedCertificateResult["certificate"];
  if (args.reissueCertificateId) {
    // Reemisión CONDICIONADA dentro de la transacción: solo procede si la fila
    // sigue revocada. Si dos admins reemiten a la vez, el perdedor obtiene
    // count 0 y aborta ANTES de notificar (no pisa el folio/código del ganador
    // ni duplica el aviso al alumno).
    const { count } = await tx.certificate.updateMany({
      where: { id: args.reissueCertificateId, status: "REVOKED" },
      data
    });
    if (count !== 1) {
      throw new CertificateReissueConflictError();
    }
    certificate = await tx.certificate.findUniqueOrThrow({
      where: { id: args.reissueCertificateId },
      include: certInclude
    });
  } else {
    certificate = await tx.certificate.create({
      data: { userId: args.userId, courseId: args.courseId, ...data },
      include: certInclude
    });
  }

  // Incluye al alumno (si tiene email real) y a los destinatarios de reglas;
  // crea el log aunque no exista ninguna regla.
  await emitStudentNotification(
    {
      eventType: "CERTIFICATE_ISSUED",
      userId: args.userId,
      courseId: args.courseId,
      payload: {
        certificateId: certificate.id,
        folio: certificate.folio,
        verificationCode: certificate.verificationCode
      }
    },
    tx
  );

  // XP +240 una sola vez (clave idempotente CERT:<courseId>). find-then-create
  // dentro de la tx: un P2002 capturado abortaría la transacción en Postgres,
  // así que comprobamos primero. Como el @@unique([userId, courseId]) del cert
  // serializa las emisiones, aquí no hay competencia por este evento.
  const xpSourceId = ledgerSourceId(args.userId, `CERT:${args.courseId}`);
  const existingXp = await tx.achievementEvent.findUnique({
    where: { sourceSystem_sourceId: { sourceSystem: LEDGER_SOURCE, sourceId: xpSourceId } }
  });
  let xpDelta = 0;
  if (!existingXp) {
    await tx.achievementEvent.create({
      data: {
        userId: args.userId,
        title: `Diploma emitido: ${args.courseTitle}`,
        points: XP_CERTIFICATE_ISSUED,
        pointsType: "certificate",
        occurredAt: args.issuedAt,
        sourceSystem: LEDGER_SOURCE,
        sourceId: xpSourceId
      }
    });
    xpDelta = XP_CERTIFICATE_ISSUED;
  }

  const xpTotal = await totalXp(tx, args.userId);
  return { certificate, xpDelta, xpTotal };
}

export async function registerCertificateRoutes(server: FastifyInstance, config: AppConfig) {
  server.get("/certificates", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const certificates = await getPrisma().certificate.findMany({
      where: certificateAccessWhere(auth),
      include: {
        user: {
          select: { id: true, displayName: true, email: true }
        },
        course: {
          select: { id: true, title: true, slug: true, teacherId: true }
        }
      },
      orderBy: { issuedAt: "desc" }
    });

    return {
      certificates: certificates.map(serializeCertificate)
    };
  });

  server.post("/certificates/issue", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const parsed = issueCertificateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const course = await getPrisma().course.findUnique({
      where: { id: parsed.data.courseId },
      include: {
        enrollments: {
          where: { userId: auth.userId },
          take: 1
        },
        certificates: {
          where: { userId: auth.userId },
          take: 1
        },
        templateLinks: {
          include: { template: true },
          take: 1
        }
      }
    });

    if (!course) {
      return reply.code(404).send({ error: "No se encontró el curso" });
    }

    const isOwnerTeacher = auth.roles.includes("TEACHER") && course.teacherId === auth.userId;
    const enrollment = course.enrollments[0] ?? null;
    if (!isAdmin(auth) && !isOwnerTeacher && enrollment?.status !== "COMPLETED") {
      return reply.code(403).send({ error: "Course completion is required before issuing a certificate" });
    }

    const existing = course.certificates[0];
    if (existing?.status === "REVOKED") {
      // Un diploma revocado no se re-emite por autoservicio: la revocación es un
      // acto administrativo y solo un administrador puede volver a emitirlo.
      return reply.code(409).send({
        error: "El diploma de este curso fue revocado. Solo un administrador puede volver a emitirlo."
      });
    }
    if (existing) {
      // Diploma ya emitido: NO se re-otorga XP (evita duplicar el +240, y no
      // suma XP retroactivo por diplomas sembrados que nunca pasaron por aqui).
      const xpTotal = await totalXp(getPrisma(), auth.userId);
      return {
        certificate: serializeCertificate(
          await getPrisma().certificate.findUniqueOrThrow({
            where: { id: existing.id },
            include: {
              user: { select: { id: true, displayName: true, email: true } },
              course: { select: { id: true, title: true, slug: true, teacherId: true } }
            }
          })
        ),
        gamification: {
          xpDelta: 0,
          xpTotal,
          ascended: false,
          rankName: rankInfo(xpTotal).name
        }
      };
    }

    const issuedAt = new Date();
    const templateId = course.templateLinks[0]?.templateId ?? null;

    try {
      // Emisión atómica vía el núcleo compartido (mismo camino que la emisión
      // admin): certificado + notificación + XP en una sola transacción.
      const { certificate, xpDelta, xpTotal } = await getPrisma().$transaction((tx) =>
        issueCertificateWithinTx(tx, {
          userId: auth.userId,
          courseId: course.id,
          courseTitle: course.title,
          templateId,
          issuedAt
        })
      );

      const ascension = detectAscension(xpTotal - xpDelta, xpTotal);
      return reply.code(201).send({
        certificate: serializeCertificate(certificate),
        gamification: {
          xpDelta,
          xpTotal,
          ascended: ascension.ascended,
          rankName: ascension.rankName
        }
      });
    } catch (error) {
      // Emisión concurrente: otro request ya creó el diploma y chocamos con el
      // @@unique. No es un 500: devolvemos el existente. El ganador ya otorgó el XP
      // dentro de su propia transacción atómica, así que aquí xpDelta = 0.
      if (isUniqueViolation(error)) {
        const certificate = await getPrisma().certificate.findUniqueOrThrow({
          where: { userId_courseId: { userId: auth.userId, courseId: course.id } },
          include: certInclude
        });
        const xpTotal = await totalXp(getPrisma(), auth.userId);
        return {
          certificate: serializeCertificate(certificate),
          gamification: {
            xpDelta: 0,
            xpTotal,
            ascended: false,
            rankName: rankInfo(xpTotal).name
          }
        };
      }
      throw error;
    }
  });

  // Candidatos a emisión admin: inscripciones COMPLETED cuyo colaborador aún no
  // tiene diploma vigente del curso (un revocado NO bloquea: es reemisión).
  server.get("/admin/certificates/candidates", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const [completed, issued] = await Promise.all([
      getPrisma().enrollment.findMany({
        where: { status: "COMPLETED" },
        include: {
          user: { select: { id: true, displayName: true, email: true } },
          course: { select: { id: true, title: true } }
        },
        orderBy: [{ course: { title: "asc" } }, { user: { displayName: "asc" } }]
      }),
      getPrisma().certificate.findMany({
        where: { status: "ISSUED" },
        select: { userId: true, courseId: true }
      })
    ]);

    const candidates = certificateCandidates(completed, issued).map((enrollment) => ({
      userId: enrollment.user.id,
      displayName: enrollment.user.displayName,
      email: enrollment.user.email,
      courseId: enrollment.course.id,
      courseTitle: enrollment.course.title
    }));

    return { candidates };
  });

  // Emisión admin: emite el diploma a nombre de un colaborador con inscripción
  // COMPLETED y sin diploma vigente. Reutiliza el MISMO núcleo atómico que el
  // autoservicio (folio, notificación, XP idempotente). Si el diploma previo fue
  // revocado, la emisión reutiliza esa fila con folio y código nuevos.
  server.post("/admin/certificates", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const parsed = adminIssueSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const course = await getPrisma().course.findUnique({
      where: { id: parsed.data.courseId },
      include: {
        enrollments: { where: { userId: parsed.data.userId }, take: 1 },
        certificates: { where: { userId: parsed.data.userId }, take: 1 },
        templateLinks: { include: { template: true }, take: 1 }
      }
    });
    if (!course) {
      return reply.code(404).send({ error: "No se encontró el curso" });
    }
    const student = await getPrisma().user.findUnique({
      where: { id: parsed.data.userId },
      select: { id: true, displayName: true }
    });
    if (!student) {
      return reply.code(404).send({ error: "No se encontró al colaborador" });
    }

    const existing = course.certificates[0] ?? null;
    const decision = adminIssueDecision({
      enrollmentStatus: course.enrollments[0]?.status ?? null,
      existingStatus: existing?.status ?? null
    });
    if (decision.kind === "blocked") {
      return reply.code(409).send({
        error:
          decision.reason === "not_completed"
            ? "El colaborador todavía no completa este curso, así que no se puede emitir el diploma."
            : "El colaborador ya tiene un diploma vigente de este curso."
      });
    }

    const issuedAt = new Date();
    let issued: IssuedCertificateResult;
    try {
      issued = await getPrisma().$transaction((tx) =>
        issueCertificateWithinTx(tx, {
          userId: student.id,
          courseId: course.id,
          courseTitle: course.title,
          templateId: course.templateLinks[0]?.templateId ?? null,
          issuedAt,
          reissueCertificateId: decision.kind === "reissue" ? existing!.id : null
        })
      );
    } catch (error) {
      // Carreras: admin vs autoservicio del alumno (P2002 del @@unique) o dos
      // admins reemitiendo a la vez (la fila dejó de estar revocada). En ambos
      // casos el diploma vigente ya existe: 409 claro, nunca un 500.
      if (isUniqueViolation(error) || error instanceof CertificateReissueConflictError) {
        return reply.code(409).send({ error: "El colaborador ya tiene un diploma vigente de este curso." });
      }
      throw error;
    }
    const { certificate, xpDelta } = issued;

    // targetId = colaborador: así el evento aparece en la "Auditoría reciente"
    // de su expediente (el dossier filtra por targetId del usuario). El diploma
    // concreto viaja en metadata.
    await logAdminAction({
      actorId: auth.userId,
      action: "CERTIFICATE_ISSUED_BY_ADMIN",
      summary: `Emitió el diploma de ${student.displayName} en ${course.title} (folio ${certificate.folio})`,
      targetType: "user",
      targetId: student.id,
      metadata: {
        certificateId: certificate.id,
        courseId: course.id,
        folio: certificate.folio,
        reissued: decision.kind === "reissue",
        xpDelta
      },
      logger: request.log
    });

    return reply.code(201).send({ certificate: serializeCertificate(certificate) });
  });

  // Revocación admin: conserva la fila (status REVOKED + revokedAt). La
  // verificación pública responde que fue revocado, el alumno deja de verlo y
  // el XP histórico del ledger NO se resta (decisión de producto).
  server.post("/admin/certificates/:certificateId/revoke", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const parsed = certificateRefSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const certificate = await getPrisma().certificate.findUnique({
      where: { id: parsed.data.certificateId },
      include: certInclude
    });
    if (!certificate) {
      return reply.code(404).send({ error: "No se encontró el diploma" });
    }
    if (certificate.status === "REVOKED") {
      return reply.code(409).send({ error: "Este diploma ya está revocado." });
    }

    const revoked = await getPrisma().certificate.update({
      where: { id: certificate.id },
      data: { status: "REVOKED", revokedAt: new Date() },
      include: certInclude
    });

    // targetId = colaborador (igual que la emisión admin): el expediente filtra
    // su auditoría por targetId del usuario.
    await logAdminAction({
      actorId: auth.userId,
      action: "CERTIFICATE_REVOKED",
      summary: `Revocó el diploma de ${revoked.user.displayName} en ${revoked.course.title} (folio ${revoked.folio})`,
      targetType: "user",
      targetId: revoked.user.id,
      metadata: { certificateId: revoked.id, courseId: revoked.course.id, folio: revoked.folio },
      logger: request.log
    });

    return { certificate: serializeCertificate(revoked) };
  });

  server.get("/certificates/:certificateId/html", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const parsed = certificateRefSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const certificate = await getPrisma().certificate.findUnique({
      where: { id: parsed.data.certificateId },
      include: {
        user: true,
        course: true,
        template: true
      }
    });

    if (!certificate) {
      return reply.code(404).send({ error: "No se encontró el diploma" });
    }

    if (!canReadCertificate(auth, certificate.userId, certificate.course.teacherId)) {
      return reply.code(403).send({ error: "No tienes acceso a este diploma" });
    }

    // Un diploma revocado ya no se entrega como documento (410). El admin
    // conserva la vista para inspección.
    if (certificate.status === "REVOKED" && !isAdmin(auth)) {
      return reply.code(410).send({ error: "Este diploma fue revocado y ya no es válido." });
    }

    // Si el diploma se emitió con una plantilla vinculada, se renderiza desde su
    // diseño; si no, el camino por defecto queda intacto.
    const templateBody = resolveCertificateTemplateBody(certificate.template?.body ?? null);
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .send(renderCertificateHtml(buildCertificateView(certificate, config), templateBody));
  });

  server.get("/certificates/:certificateId/pdf", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const parsed = certificateRefSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const certificate = await getPrisma().certificate.findUnique({
      where: { id: parsed.data.certificateId },
      include: { user: true, course: true, template: true }
    });

    if (!certificate) {
      return reply.code(404).send({ error: "No se encontró el diploma" });
    }

    if (!canReadCertificate(auth, certificate.userId, certificate.course.teacherId)) {
      return reply.code(403).send({ error: "No tienes acceso a este diploma" });
    }

    if (certificate.status === "REVOKED" && !isAdmin(auth)) {
      return reply.code(410).send({ error: "Este diploma fue revocado y ya no es válido." });
    }

    const templateBody = resolveCertificateTemplateBody(certificate.template?.body ?? null);
    const pdf = await renderCertificatePdf(buildCertificateView(certificate, config), {
      backgroundPath: config.certificateBackgroundPath,
      template: templateBody ?? undefined
    });

    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `attachment; filename="diploma-${certificate.folio}.pdf"`)
      .send(Buffer.from(pdf));
  });

  server.get("/certificates/verify/:verificationCode", async (request, reply) => {
    const parsed = verificationSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const certificate = await getPrisma().certificate.findUnique({
      where: { verificationCode: parsed.data.verificationCode },
      include: {
        user: { select: { displayName: true } },
        course: { select: { title: true } }
      }
    });

    const outcome = certificateVerifyOutcome(certificate);
    if (!certificate || outcome === "not_found") {
      return reply.code(404).send({ valid: false });
    }
    if (outcome === "revoked") {
      // Se informa la revocación sin exponer datos del diploma ni del titular.
      return reply.code(410).send({ valid: false, revoked: true, error: "Este diploma fue revocado y ya no es válido." });
    }

    return {
      valid: true,
      certificate: {
        folio: certificate.folio,
        issuedAt: certificate.issuedAt,
        studentName: certificate.user.displayName,
        courseTitle: certificate.course.title
      }
    };
  });

  // Public: serves the diploma background image so the HTML view and PDF do not
  // depend on the legacy WordPress host. Referenced via CSS/<img>, hence no auth.
  server.get("/certificates/diploma-background.jpg", async (_request, reply) => {
    const backgroundPath = config.certificateBackgroundPath ?? DEFAULT_CERTIFICATE_BACKGROUND_PATH;

    let bytes: Buffer;
    try {
      bytes = await readFile(backgroundPath);
    } catch {
      return reply.code(404).send({ error: "Certificate background not found" });
    }

    return reply
      .header("content-type", "image/jpeg")
      .header("cache-control", "public, max-age=86400")
      .send(bytes);
  });
}

function buildCertificateView(
  certificate: {
    id: string;
    folio: string;
    verificationCode: string;
    issuedAt: Date;
    user: { displayName: string };
    course: { title: string };
  },
  config: AppConfig
): CertificateView {
  return {
    id: certificate.id,
    folio: certificate.folio,
    verificationCode: certificate.verificationCode,
    issuedAt: certificate.issuedAt,
    studentName: certificate.user.displayName,
    courseTitle: certificate.course.title,
    ...(config.certificateBackgroundUrl ? { backgroundUrl: config.certificateBackgroundUrl } : {})
  };
}

// Solo el admin ve los diplomas revocados (con su pill de estado en el Ops
// Center). Para alumnos e instructores un diploma revocado desaparece de las
// listas: dejó de ser un documento vigente.
function certificateAccessWhere(auth: AuthContext): Prisma.CertificateWhereInput {
  if (isAdmin(auth)) {
    return {};
  }

  if (auth.roles.includes("TEACHER")) {
    return {
      status: "ISSUED",
      OR: [{ userId: auth.userId }, { course: { teacherId: auth.userId } }]
    };
  }

  return { userId: auth.userId, status: "ISSUED" };
}

function canReadCertificate(auth: AuthContext, userId: string, teacherId: string | null) {
  return isAdmin(auth) || auth.userId === userId || (auth.roles.includes("TEACHER") && teacherId === auth.userId);
}

// Prisma unique-constraint violation. Here it can only come from Certificate's
// @@unique (userId+courseId, or the day-derived folio for the same user+course),
// meaning "already issued" — never a 500 (idempotent success in self-service,
// 409 in the admin route). Exported for tests.
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

function serializeCertificate(certificate: {
  id: string;
  status: string;
  folio: string;
  verificationCode: string;
  pdfStorageKey: string;
  issuedAt: Date;
  revokedAt: Date | null;
  user: { id: string; displayName: string; email: string };
  course: { id: string; title: string; slug: string; teacherId: string | null };
}) {
  return {
    id: certificate.id,
    status: certificate.status,
    folio: certificate.folio,
    verificationCode: certificate.verificationCode,
    pdfStorageKey: certificate.pdfStorageKey,
    issuedAt: certificate.issuedAt,
    revokedAt: certificate.revokedAt,
    user: certificate.user,
    course: {
      id: certificate.course.id,
      title: certificate.course.title,
      slug: certificate.course.slug
    }
  };
}
