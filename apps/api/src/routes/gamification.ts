import { getPrisma } from "@tsc-capacita/db";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import { rankInfo, totalXp } from "../lib/gamification.js";

/**
 * Rutas de gamificacion del estudiante ("carrera del guardia").
 *
 * GET /me/progress  -> XP total, rango derivado, codigo de empleado, servicio y
 *                      conteos de avance.
 * GET /me/badges    -> catalogo de insignias con el estado (obtenida/bloqueada)
 *                      del usuario y la fecha de obtencion.
 */
export async function registerGamificationRoutes(server: FastifyInstance) {
  server.get("/me/progress", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const prisma = getPrisma();

    const [user, xp, coursesCompleted, coursesInProgress, lessonsCompleted, certificates] = await Promise.all([
      prisma.user.findUnique({
        where: { id: auth.userId },
        select: { employeeCode: true, serviceLabel: true, currentStreak: true, lastActiveDate: true }
      }),
      totalXp(prisma, auth.userId),
      prisma.enrollment.count({ where: { userId: auth.userId, status: "COMPLETED" } }),
      prisma.enrollment.count({ where: { userId: auth.userId, status: "ACTIVE" } }),
      prisma.lessonProgress.count({ where: { userId: auth.userId, completedAt: { not: null } } }),
      prisma.certificate.count({ where: { userId: auth.userId, status: "ISSUED" } })
    ]);

    if (!user) {
      return reply.code(404).send({ error: "Usuario no encontrado" });
    }

    return {
      xp,
      rank: rankInfo(xp),
      employeeCode: user.employeeCode,
      serviceLabel: user.serviceLabel,
      // Racha diaria (aditivo, Ola 2 Fase A).
      streak: {
        current: user.currentStreak,
        lastActiveDate: user.lastActiveDate
      },
      counts: {
        coursesCompleted,
        coursesInProgress,
        lessonsCompleted,
        certificates
      }
    };
  });

  server.get("/me/badges", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const prisma = getPrisma();

    const [achievements, awards] = await Promise.all([
      prisma.achievement.findMany({
        orderBy: [{ points: "asc" }, { title: "asc" }],
        include: {
          steps: {
            orderBy: { position: "asc" },
            include: {
              course: { select: { id: true, title: true } },
              quiz: { select: { id: true, title: true } }
            }
          }
        }
      }),
      prisma.achievementAward.findMany({
        where: { userId: auth.userId },
        orderBy: { awardedAt: "asc" }
      })
    ]);

    // Primera fecha de obtencion por logro (puede haber varios awards migrados).
    const earnedAt = new Map<string, Date>();
    for (const award of awards) {
      const current = earnedAt.get(award.achievementId);
      if (!current || award.awardedAt < current) {
        earnedAt.set(award.achievementId, award.awardedAt);
      }
    }

    const badges = achievements.map((achievement) => {
      const awardedAt = earnedAt.get(achievement.id) ?? null;
      return {
        id: achievement.id,
        slug: achievement.slug,
        title: achievement.title,
        description: achievement.description,
        points: achievement.points,
        earned: awardedAt !== null,
        status: awardedAt !== null ? "earned" : "locked",
        awardedAt,
        steps: achievement.steps.map((step) => ({
          trigger: step.trigger,
          requiredCount: step.requiredCount,
          courseId: step.courseId,
          courseTitle: step.course?.title ?? null,
          quizId: step.quizId,
          quizTitle: step.quiz?.title ?? null
        }))
      };
    });

    return {
      badges,
      earnedCount: badges.filter((badge) => badge.earned).length,
      totalCount: badges.length
    };
  });
}
