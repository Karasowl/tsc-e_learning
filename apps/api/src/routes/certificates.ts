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
  type CertificateView
} from "../lib/certificates.js";
import {
  renderCertificatePdf,
  DEFAULT_CERTIFICATE_BACKGROUND_PATH
} from "../lib/certificate-pdf.js";
import { isAdmin, requireAuth, type AuthContext } from "../lib/auth.js";
import {
  XP_CERTIFICATE_ISSUED,
  detectAscension,
  grantXp,
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
    const certificate = await getPrisma().certificate.create({
      data: {
        userId: auth.userId,
        courseId: course.id,
        templateId: course.templateLinks[0]?.templateId ?? null,
        status: "ISSUED",
        folio,
        verificationCode,
        pdfStorageKey: certificateStorageKey(folio),
        issuedAt
      },
      include: {
        user: { select: { id: true, displayName: true, email: true } },
        course: { select: { id: true, title: true, slug: true, teacherId: true } }
      }
    });

    await logCertificateIssued(certificate);

    // XP real por diploma emitido (+240), idempotente por curso (CERT:<courseId>).
    const grant = await grantXp(getPrisma(), {
      userId: auth.userId,
      key: `CERT:${course.id}`,
      points: XP_CERTIFICATE_ISSUED,
      title: `Diploma emitido: ${course.title}`,
      pointsType: "certificate",
      occurredAt: issuedAt
    });
    const ascension = detectAscension(grant.xpTotal - grant.xpDelta, grant.xpTotal);

    return reply.code(201).send({
      certificate: serializeCertificate(certificate),
      gamification: {
        xpDelta: grant.xpDelta,
        xpTotal: grant.xpTotal,
        ascended: ascension.ascended,
        rankName: ascension.rankName
      }
    });
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
        course: true
      }
    });

    if (!certificate) {
      return reply.code(404).send({ error: "Certificate not found" });
    }

    if (!canReadCertificate(auth, certificate.userId, certificate.course.teacherId)) {
      return reply.code(403).send({ error: "Certificate access denied" });
    }

    return reply
      .header("content-type", "text/html; charset=utf-8")
      .send(renderCertificateHtml(buildCertificateView(certificate, config)));
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
      include: { user: true, course: true }
    });

    if (!certificate) {
      return reply.code(404).send({ error: "Certificate not found" });
    }

    if (!canReadCertificate(auth, certificate.userId, certificate.course.teacherId)) {
      return reply.code(403).send({ error: "Certificate access denied" });
    }

    const pdf = await renderCertificatePdf(buildCertificateView(certificate, config), {
      backgroundPath: config.certificateBackgroundPath
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

async function logCertificateIssued(certificate: {
  id: string;
  userId: string;
  courseId: string;
  folio: string;
  verificationCode: string;
}) {
  const rules = await getPrisma().notificationRule.findMany({
    where: {
      eventType: "CERTIFICATE_ISSUED",
      enabled: true
    }
  });

  await Promise.all(
    rules.map((rule) =>
      getPrisma().notificationLog.create({
        data: {
          eventType: "CERTIFICATE_ISSUED",
          userId: certificate.userId,
          courseId: certificate.courseId,
          payload: {
            ruleId: rule.id,
            certificateId: certificate.id,
            folio: certificate.folio,
            verificationCode: certificate.verificationCode
          },
          sentTo: rule.recipients,
          status: "PENDING"
        }
      })
    )
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
