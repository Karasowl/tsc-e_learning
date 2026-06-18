import { getPrisma } from "@tsc-capacita/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAdmin, requireAuth } from "../lib/auth.js";

const courseParamsSchema = z.object({
  courseId: z.string().min(1)
});

const reviewParamsSchema = z.object({
  reviewId: z.string().min(1)
});

const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().optional()
});

const moderateReviewSchema = z.object({
  status: z.enum(["APPROVED", "HIDDEN", "PENDING"])
});

export async function registerReviewRoutes(server: FastifyInstance) {
  server.post("/courses/:courseId/reviews", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const params = courseParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const body = createReviewSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const enrollment = await getPrisma().enrollment.findUnique({
      where: {
        userId_courseId: {
          userId: auth.userId,
          courseId: params.data.courseId
        }
      }
    });

    if (!enrollment) {
      return reply.code(403).send({ error: "Enrollment required" });
    }

    const existing = await getPrisma().courseReview.findFirst({
      where: {
        courseId: params.data.courseId,
        userId: auth.userId
      }
    });

    if (existing) {
      const review = await getPrisma().courseReview.update({
        where: { id: existing.id },
        data: {
          rating: body.data.rating,
          body: body.data.body ?? null
        }
      });

      return { review: serializeReview(review) };
    }

    const user = await getPrisma().user.findUnique({
      where: { id: auth.userId }
    });

    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    const review = await getPrisma().courseReview.create({
      data: {
        courseId: params.data.courseId,
        userId: auth.userId,
        authorName: user.displayName,
        rating: body.data.rating,
        body: body.data.body ?? null,
        status: "APPROVED",
        createdAt: new Date()
      }
    });

    return { review: serializeReview(review) };
  });

  server.get("/courses/:courseId/reviews", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    const params = courseParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const reviews = await getPrisma().courseReview.findMany({
      where: {
        courseId: params.data.courseId,
        status: "APPROVED"
      },
      orderBy: { createdAt: "desc" }
    });

    const ratings = reviews
      .map((review) => review.rating)
      .filter((rating): rating is number => rating !== null);
    const averageRating =
      ratings.length > 0
        ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2))
        : null;

    return {
      reviews: reviews.map((review) => ({
        rating: review.rating,
        body: review.body,
        authorName: review.authorName,
        createdAt: review.createdAt
      })),
      averageRating,
      count: reviews.length
    };
  });

  server.put("/admin/reviews/:reviewId", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const params = reviewParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const body = moderateReviewSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const existing = await getPrisma().courseReview.findUnique({
      where: { id: params.data.reviewId }
    });

    if (!existing) {
      return reply.code(404).send({ error: "Review not found" });
    }

    const review = await getPrisma().courseReview.update({
      where: { id: existing.id },
      data: { status: body.data.status }
    });

    return { review: serializeReview(review) };
  });

  // Admin moderation: list every review of a course (including HIDDEN/PENDING),
  // with id + status so the editor can show toggle controls. The public GET only
  // returns APPROVED reviews and omits ids on purpose.
  server.get("/admin/courses/:courseId/reviews", async (request, reply) => {
    const auth = await requireAuth(server, request, reply);
    if (!auth) {
      return;
    }

    if (!isAdmin(auth)) {
      return reply.code(403).send({ error: "Admin role required" });
    }

    const params = courseParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const reviews = await getPrisma().courseReview.findMany({
      where: { courseId: params.data.courseId },
      orderBy: { createdAt: "desc" }
    });

    return { reviews: reviews.map(serializeReview) };
  });
}

function serializeReview(review: {
  id: string;
  courseId: string;
  userId: string | null;
  authorName: string;
  rating: number | null;
  body: string | null;
  status: string;
  createdAt: Date;
}) {
  return {
    id: review.id,
    courseId: review.courseId,
    userId: review.userId,
    authorName: review.authorName,
    rating: review.rating,
    body: review.body,
    status: review.status,
    createdAt: review.createdAt
  };
}
