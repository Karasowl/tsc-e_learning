import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import {
  CertificateReissueConflictError,
  adminIssueDecision,
  certificateCandidates,
  certificateVerifyOutcome,
  isUniqueViolation,
  issueCertificateWithinTx
} from "./certificates.js";
import { XP_CERTIFICATE_ISSUED } from "../lib/gamification.js";

describe("adminIssueDecision (emisión admin de diplomas)", () => {
  it("emite cuando la inscripción está COMPLETED y no hay diploma previo", () => {
    assert.deepEqual(adminIssueDecision({ enrollmentStatus: "COMPLETED", existingStatus: null }), { kind: "issue" });
  });

  it("bloquea sin inscripción COMPLETED (incluye ACTIVE y sin inscripción)", () => {
    assert.deepEqual(adminIssueDecision({ enrollmentStatus: "ACTIVE", existingStatus: null }), {
      kind: "blocked",
      reason: "not_completed"
    });
    assert.deepEqual(adminIssueDecision({ enrollmentStatus: null, existingStatus: null }), {
      kind: "blocked",
      reason: "not_completed"
    });
  });

  it("bloquea cuando ya existe un diploma vigente", () => {
    assert.deepEqual(adminIssueDecision({ enrollmentStatus: "COMPLETED", existingStatus: "ISSUED" }), {
      kind: "blocked",
      reason: "already_issued"
    });
  });

  it("un diploma revocado habilita la reemisión (reutiliza la fila con folio nuevo)", () => {
    assert.deepEqual(adminIssueDecision({ enrollmentStatus: "COMPLETED", existingStatus: "REVOKED" }), {
      kind: "reissue"
    });
  });
});

describe("certificateVerifyOutcome (verificación pública por código)", () => {
  it("un diploma vigente es válido", () => {
    assert.equal(certificateVerifyOutcome({ status: "ISSUED" }), "valid");
  });

  it("un diploma revocado se reporta como revocado, no como inexistente", () => {
    assert.equal(certificateVerifyOutcome({ status: "REVOKED" }), "revoked");
  });

  it("sin fila no hay diploma", () => {
    assert.equal(certificateVerifyOutcome(null), "not_found");
  });
});

describe("certificateCandidates (candidatos a emisión admin)", () => {
  const completed = [
    { userId: "u1", courseId: "c1" },
    { userId: "u1", courseId: "c2" },
    { userId: "u2", courseId: "c1" }
  ];

  it("excluye a quien ya tiene diploma vigente de ese curso", () => {
    const result = certificateCandidates(completed, [{ userId: "u1", courseId: "c1" }]);
    assert.deepEqual(result, [
      { userId: "u1", courseId: "c2" },
      { userId: "u2", courseId: "c1" }
    ]);
  });

  it("un diploma revocado NO bloquea: la lista solo recibe los ISSUED", () => {
    // El endpoint consulta únicamente certificados con status ISSUED, así que a
    // este filtro los revocados ni siquiera llegan y el colaborador reaparece.
    const result = certificateCandidates(completed, []);
    assert.equal(result.length, 3);
  });
});

// ─── Núcleo atómico compartido de emisión (stub de la transacción Prisma) ────

type TxStubOptions = {
  hasXpEvent?: boolean;
  xpSum?: number;
  // Filas que updateMany "encuentra" en la reemisión condicionada (0 = otra
  // emisión ganó la carrera y la fila ya no está REVOKED).
  reissueMatches?: number;
};

function issueTxStub(options: TxStubOptions = {}) {
  const state = {
    created: [] as Array<Record<string, unknown>>,
    updated: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
    notificationLogs: [] as Array<Record<string, unknown>>,
    xpEvents: [] as Array<Record<string, unknown>>
  };
  const relations = {
    user: { id: "u1", displayName: "Guardia Uno", email: "guardia@tsc.com.mx" },
    course: { id: "c1", title: "Custodia de valores", slug: "custodia", teacherId: null }
  };
  const tx = {
    certificate: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.created.push(data);
        return { id: "cert-nuevo", revokedAt: null, ...data, ...relations };
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const count = options.reissueMatches ?? 1;
        if (count > 0) {
          state.updated.push({ where, data });
        }
        return { count };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const data = state.updated.at(-1)?.data ?? {};
        return { id: where.id, userId: "u1", courseId: "c1", ...data, ...relations };
      }
    },
    user: {
      findUnique: async () => ({ email: relations.user.email, displayName: relations.user.displayName })
    },
    notificationRule: { findMany: async () => [] },
    notificationLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.notificationLogs.push(data);
        return data;
      }
    },
    achievementEvent: {
      findUnique: async () => (options.hasXpEvent ? { id: "xp-previo" } : null),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.xpEvents.push(data);
        return data;
      },
      aggregate: async () => ({ _sum: { points: options.xpSum ?? 0 } })
    }
  } as unknown as Prisma.TransactionClient;
  return { tx, state };
}

describe("issueCertificateWithinTx (núcleo compartido: autoservicio y admin)", () => {
  const issuedAt = new Date("2026-07-17T12:00:00Z");
  const baseArgs = {
    userId: "u1",
    courseId: "c1",
    courseTitle: "Custodia de valores",
    templateId: null,
    issuedAt
  };

  it("emisión feliz: crea el diploma ISSUED con folio, notifica CERTIFICATE_ISSUED y otorga +240 XP", async () => {
    const { tx, state } = issueTxStub({ xpSum: 690 });

    const result = await issueCertificateWithinTx(tx, baseArgs);

    assert.equal(state.created.length, 1);
    assert.equal(state.updated.length, 0);
    const cert = state.created[0]!;
    assert.equal(cert.status, "ISSUED");
    assert.match(String(cert.folio), /^TSC-20260717-[0-9A-F]{8}$/);
    assert.equal(cert.revokedAt, null);

    assert.equal(state.notificationLogs.length, 1);
    const log = state.notificationLogs[0]!;
    assert.equal(log.eventType, "CERTIFICATE_ISSUED");
    assert.deepEqual(log.sentTo, ["guardia@tsc.com.mx"]);

    assert.equal(state.xpEvents.length, 1);
    assert.equal(state.xpEvents[0]!.points, XP_CERTIFICATE_ISSUED);
    assert.equal(result.xpDelta, XP_CERTIFICATE_ISSUED);
    assert.equal(result.xpTotal, 690);
  });

  it("reemisión tras revocación: reutiliza la fila (update), vuelve a ISSUED y NO duplica el XP", async () => {
    const { tx, state } = issueTxStub({ hasXpEvent: true, xpSum: 690 });

    const result = await issueCertificateWithinTx(tx, { ...baseArgs, reissueCertificateId: "cert-revocado" });

    assert.equal(state.created.length, 0);
    assert.equal(state.updated.length, 1);
    const { where, data } = state.updated[0]!;
    // El update es CONDICIONADO: solo toca la fila si sigue revocada.
    assert.deepEqual(where, { id: "cert-revocado", status: "REVOKED" });
    assert.equal(data.status, "ISSUED");
    assert.equal(data.revokedAt, null);
    assert.match(String(data.folio), /^TSC-20260717-[0-9A-F]{8}$/);

    // La reemisión sí vuelve a avisar al alumno (nuevo folio), pero el XP del
    // curso ya está en el ledger y no se re-otorga.
    assert.equal(state.notificationLogs.length, 1);
    assert.equal(state.xpEvents.length, 0);
    assert.equal(result.xpDelta, 0);
  });

  it("carrera de reemisión: si la fila ya no está revocada aborta con conflicto, sin notificar ni pisar nada", async () => {
    const { tx, state } = issueTxStub({ hasXpEvent: true, reissueMatches: 0 });

    await assert.rejects(
      issueCertificateWithinTx(tx, { ...baseArgs, reissueCertificateId: "cert-revocado" }),
      CertificateReissueConflictError
    );

    // El perdedor no crea certificado, no duplica la notificación ni toca XP:
    // la ruta admin traduce este conflicto a un 409.
    assert.equal(state.created.length, 0);
    assert.equal(state.updated.length, 0);
    assert.equal(state.notificationLogs.length, 0);
    assert.equal(state.xpEvents.length, 0);
  });
});

describe("isUniqueViolation (carrera admin vs autoservicio)", () => {
  it("clasifica el P2002 de Prisma como diploma ya emitido (la ruta admin responde 409, no 500)", () => {
    assert.equal(isUniqueViolation({ code: "P2002" }), true);
  });

  it("no confunde otros errores con la carrera de emisión", () => {
    assert.equal(isUniqueViolation(new Error("boom")), false);
    assert.equal(isUniqueViolation({ code: "P2025" }), false);
    assert.equal(isUniqueViolation(null), false);
  });
});
