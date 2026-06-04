import { getPrisma } from "@tsc-capacita/db";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { isAdmin, isTeacherOrAdmin, requireAuth } from "../lib/auth.js";

export async function registerDirectoryRoutes(server: FastifyInstance) {
  server.get("/teachers", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const teachers = await getPrisma().user.findMany({
      where: {
        roles: {
          some: { role: "TEACHER" }
        }
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        authoredCourses: {
          select: {
            id: true,
            title: true,
            status: true
          },
          orderBy: { title: "asc" }
        }
      },
      orderBy: { displayName: "asc" }
    });

    return teachers.map((teacher) => ({
      id: teacher.id,
      displayName: teacher.displayName,
      email: teacher.email,
      courseCount: teacher.authoredCourses.length,
      courses: teacher.authoredCourses
    }));
  });

  server.get("/admin/courses", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isTeacherOrAdmin(auth)) {
      return reply.code(403).send({ error: "Teacher or admin role required" });
    }

    const where: Prisma.CourseWhereInput = isAdmin(auth) ? {} : { teacherId: auth.userId };

    const courses = await getPrisma().course.findMany({
      where,
      include: {
        teacher: {
          select: {
            id: true,
            displayName: true
          }
        },
        _count: {
          select: {
            modules: true,
            lessons: true,
            quizzes: true,
            enrollments: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { title: "asc" }]
    });

    return {
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        slug: course.slug,
        status: course.status,
        teacher: course.teacher,
        counts: course._count
      }))
    };
  });

  server.get("/me/completed", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const enrollments = await getPrisma().enrollment.findMany({
      where: {
        userId: auth.userId,
        status: "COMPLETED"
      },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            slug: true
          }
        }
      },
      orderBy: [{ completedAt: "desc" }, { enrolledAt: "desc" }]
    });

    return {
      courses: enrollments.map((enrollment) => ({
        course: enrollment.course,
        completedAt: enrollment.completedAt,
        progressPercent: enrollment.progressPercent.toNumber()
      }))
    };
  });
}
