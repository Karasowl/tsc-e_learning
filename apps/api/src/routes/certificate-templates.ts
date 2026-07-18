import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAdmin, isTeacherOrAdmin, requireAuth, type AuthContext } from "../lib/auth.js";

const templateIdSchema = z.object({
  id: z.string().min(1)
});

const courseIdSchema = z.object({
  courseId: z.string().min(1)
});

// El diseño es JSON libre (objeto): la plantilla reconoce title/legend/backgroundUrl
// hoy, pero se guarda completo para que el diseñador pueda crecer sin migraciones.
const designBodySchema = z.record(z.string(), z.unknown());

const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  body: designBodySchema
});

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  body: designBodySchema.optional()
});

const linkTemplateSchema = z.object({
  templateId: z.string().min(1)
});

export function serializeTemplate(template: {
  id: string;
  name: string;
  body: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
  courseLinks?: Array<{ courseId: string }>;
}) {
  return {
    id: template.id,
    name: template.name,
    body: template.body,
    courseIds: (template.courseLinks ?? []).map((link) => link.courseId),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

function canEditCourse(auth: AuthContext, course: { teacherId: string | null }) {
  return isAdmin(auth) || (auth.roles.includes("TEACHER") && course.teacherId === auth.userId);
}

/**
 * La LECTURA del catálogo de plantillas está abierta a docentes y admins: el
 * instructor puede vincular una plantilla a su curso, así que también debe poder
 * listarlas y ver cuál está vinculada. Crear, editar y borrar siguen siendo solo
 * de admin. Pura para poder probarse sin base de datos.
 */
export function canReadCertificateTemplates(auth: AuthContext): boolean {
  return isTeacherOrAdmin(auth);
}

export async function registerCertificateTemplateRoutes(server: FastifyInstance) {
  server.get("/admin/certificate-templates", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!canReadCertificateTemplates(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const templates = await getPrisma().certificateTemplate.findMany({
      orderBy: { updatedAt: "desc" },
      include: { courseLinks: { select: { courseId: true } } }
    });

    return { templates: templates.map(serializeTemplate) };
  });

  server.post("/admin/certificate-templates", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const body = createTemplateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const template = await getPrisma().certificateTemplate.create({
      data: {
        name: body.data.name,
        body: body.data.body as Prisma.InputJsonValue
      },
      include: { courseLinks: { select: { courseId: true } } }
    });

    return reply.code(201).send({ template: serializeTemplate(template) });
  });

  server.put("/admin/certificate-templates/:id", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const params = templateIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }
    const body = updateTemplateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const existing = await getPrisma().certificateTemplate.findUnique({ where: { id: params.data.id } });
    if (!existing) {
      return reply.code(404).send({ error: "No se encontró la plantilla" });
    }

    const data: Prisma.CertificateTemplateUpdateInput = {};
    if (body.data.name !== undefined) {
      data.name = body.data.name;
    }
    if (body.data.body !== undefined) {
      data.body = body.data.body as Prisma.InputJsonValue;
    }

    const template = await getPrisma().certificateTemplate.update({
      where: { id: existing.id },
      data,
      include: { courseLinks: { select: { courseId: true } } }
    });

    return { template: serializeTemplate(template) };
  });

  server.delete("/admin/certificate-templates/:id", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const params = templateIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const existing = await getPrisma().certificateTemplate.findUnique({ where: { id: params.data.id } });
    if (!existing) {
      return reply.code(404).send({ error: "No se encontró la plantilla" });
    }

    // Los diplomas ya emitidos referencian templateId con onDelete SetNull, así que
    // borrar la plantilla no rompe los certificados: solo vuelven al diseño default.
    // Los vínculos a cursos (CertificateTemplateCourse) caen por cascade.
    await getPrisma().certificateTemplate.delete({ where: { id: existing.id } });

    return { deleted: true };
  });

  // Vincula una plantilla a un curso (dueño del curso o admin). Se fuerza una sola
  // plantilla activa por curso: se reemplaza cualquier vínculo previo del curso.
  server.post("/admin/courses/:courseId/certificate-template", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = courseIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }
    const body = linkTemplateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const course = await getPrisma().course.findUnique({ where: { id: params.data.courseId } });
    if (!course) {
      return reply.code(404).send({ error: "No se encontró el curso" });
    }
    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
    }

    const template = await getPrisma().certificateTemplate.findUnique({ where: { id: body.data.templateId } });
    if (!template) {
      return reply.code(404).send({ error: "No se encontró la plantilla" });
    }

    const link = await getPrisma().$transaction(async (tx) => {
      await tx.certificateTemplateCourse.deleteMany({ where: { courseId: course.id } });
      return tx.certificateTemplateCourse.create({
        data: { courseId: course.id, templateId: template.id }
      });
    });

    return reply.code(201).send({
      link: { id: link.id, courseId: link.courseId, templateId: link.templateId }
    });
  });

  // Desvincula la(s) plantilla(s) del curso: vuelve al diseño default.
  server.delete("/admin/courses/:courseId/certificate-template", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }
    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const params = courseIdSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const course = await getPrisma().course.findUnique({ where: { id: params.data.courseId } });
    if (!course) {
      return reply.code(404).send({ error: "No se encontró el curso" });
    }
    if (!canEditCourse(auth, course)) {
      return reply.code(403).send({ error: "No tienes acceso a este curso" });
    }

    const result = await getPrisma().certificateTemplateCourse.deleteMany({ where: { courseId: course.id } });

    return { deleted: result.count };
  });
}
