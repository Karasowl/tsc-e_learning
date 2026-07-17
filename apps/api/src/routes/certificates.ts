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
      return reply.code(404).send({ error: "Course not found" });
    }

    const isOwnerTeacher = auth.roles.includes("TEACHER") && course.teacherId === auth.userId;
    const enrollment = course.enrollments[0] ?? null;
    if (!isAdmin(auth) && !isOwnerTeacher && enrollment?.status !== "COMPLETED") {
      return reply.code(403).send({ error: "Course completion is required before issuing a certificate" });
    }

    const existing = course.certificates[0];
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
    const folio = certificateFolio(auth.userId, course.id, issuedAt);
    const verificationCode = certificateVerificationCode(auth.userId, course.id, issuedAt);
    const templateId = course.templateLinks[0]?.templateId ?? null;
    const certInclude = {
      user: { select: { id: true, displayName: true, email: true } },
      course: { select: { id: true, title: true, slug: true, teacherId: true } }
    } satisfies Prisma.CertificateInclude;

    try {
      // Emisión atómica: el certificado, su notificación (log + correo al alumno si
      // tiene email real) y el XP del diploma se crean en una sola transacción, de
      // modo que un diploma real SIEMPRE queda con su evento de XP (no hay ventana
      // de fallo entre crear el cert y otorgar el XP).
      const { certificate, xpDelta, xpTotal } = await getPrisma().$transaction(async (tx) => {
        const created = await tx.certificate.create({
          data: {
            userId: auth.userId,
            courseId: course.id,
            templateId,
            status: "ISSUED",
            folio,
            verificationCode,
            pdfStorageKey: certificateStorageKey(folio),
            issuedAt
          },
          include: certInclude
        });

        // Incluye al alumno (si tiene email real) y a los destinatarios de reglas;
        // crea el log aunque no exista ninguna regla.
        await emitStudentNotification(
          {
            eventType: "CERTIFICATE_ISSUED",
            userId: auth.userId,
            courseId: course.id,
            payload: {
              certificateId: created.id,
              folio: created.folio,
              verificationCode: created.verificationCode
            }
          },
          tx
        );

        // XP +240 una sola vez (clave idempotente CERT:<courseId>). find-then-create
        // dentro de la tx: un P2002 capturado abortaría la transacción en Postgres,
        // así que comprobamos primero. Como el @@unique([userId, courseId]) del cert
        // serializa las emisiones, aquí no hay competencia por este evento.
        const xpSourceId = ledgerSourceId(auth.userId, `CERT:${course.id}`);
        const existingXp = await tx.achievementEvent.findUnique({
          where: { sourceSystem_sourceId: { sourceSystem: LEDGER_SOURCE, sourceId: xpSourceId } }
        });
        let delta = 0;
        if (!existingXp) {
          await tx.achievementEvent.create({
            data: {
              userId: auth.userId,
              title: `Diploma emitido: ${course.title}`,
              points: XP_CERTIFICATE_ISSUED,
              pointsType: "certificate",
              occurredAt: issuedAt,
              sourceSystem: LEDGER_SOURCE,
              sourceId: xpSourceId
            }
          });
          delta = XP_CERTIFICATE_ISSUED;
        }

        const total = await totalXp(tx, auth.userId);
        return { certificate: created, xpDelta: delta, xpTotal: total };
      });

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
      return reply.code(404).send({ error: "Certificate not found" });
    }

    if (!canReadCertificate(auth, certificate.userId, certificate.course.teacherId)) {
      return reply.code(403).send({ error: "Certificate access denied" });
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
      return reply.code(404).send({ error: "Certificate not found" });
    }

    if (!canReadCertificate(auth, certificate.userId, certificate.course.teacherId)) {
      return reply.code(403).send({ error: "Certificate access denied" });
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

    if (!certificate || certificate.status !== "ISSUED") {
      return reply.code(404).send({ valid: false });
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

function certificateAccessWhere(auth: AuthContext): Prisma.CertificateWhereInput {
  if (isAdmin(auth)) {
    return {};
  }

  if (auth.roles.includes("TEACHER")) {
    return {
      OR: [{ userId: auth.userId }, { course: { teacherId: auth.userId } }]
    };
  }

  return { userId: auth.userId };
}

function canReadCertificate(auth: AuthContext, userId: string, teacherId: string | null) {
  return isAdmin(auth) || auth.userId === userId || (auth.roles.includes("TEACHER") && teacherId === auth.userId);
}

// Prisma unique-constraint violation. Here it can only come from Certificate's
// @@unique (userId+courseId, or the day-derived folio for the same user+course),
// meaning "already issued" — handled as an idempotent success, never a 500.
function isUniqueViolation(error: unknown): boolean {
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
