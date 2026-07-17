import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { serializeMasterEnrollment } from "./enrollments-admin.js";

function baseRow(overrides: Partial<Parameters<typeof serializeMasterEnrollment>[0]> = {}) {
  return {
    id: "e1",
    userId: "u1",
    courseId: "c1",
    status: "ACTIVE",
    progressPercent: new Prisma.Decimal(42.5),
    enrolledAt: new Date("2026-01-01T00:00:00Z"),
    completedAt: null,
    expiresAt: null,
    sourceSystem: null,
    user: { id: "u1", displayName: "Juan", email: "j@ej.com", employeeCode: "E-1", serviceLabel: "Turno A" },
    course: { id: "c1", title: "Custodia", slug: "custodia" },
    ...overrides
  };
}

describe("serializeMasterEnrollment (padrón maestro)", () => {
  const now = new Date("2026-07-17T00:00:00Z");

  it("deriva expired=false sin fecha de vencimiento", () => {
    const row = serializeMasterEnrollment(baseRow(), now);
    assert.equal(row.expired, false);
    assert.equal(row.progressPercent, 42.5);
    assert.equal(row.user.employeeCode, "E-1");
  });

  it("deriva expired=true cuando expiresAt ya pasó", () => {
    const row = serializeMasterEnrollment(baseRow({ expiresAt: new Date("2026-07-01T00:00:00Z") }), now);
    assert.equal(row.expired, true);
  });

  it("deriva expired=false cuando expiresAt es futuro", () => {
    const row = serializeMasterEnrollment(baseRow({ expiresAt: new Date("2026-08-01T00:00:00Z") }), now);
    assert.equal(row.expired, false);
  });
});
