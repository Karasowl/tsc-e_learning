import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  RANKS,
  grantXp,
  ledgerSourceId,
  rankInfo,
  sumPoints,
  totalXp,
  LEDGER_SOURCE
} from "./gamification.js";

// ---------------------------------------------------------------------------
// Fake Prisma (solo AchievementEvent) que replica la restriccion unica
// @@unique([sourceSystem, sourceId]) en memoria, para probar la idempotencia
// del ledger sin depender de una base de datos viva. Un create duplicado lanza
// un error con code "P2002", igual que Prisma/Postgres.
// ---------------------------------------------------------------------------
type Row = { id: string; userId: string; points: number; title: string; sourceSystem: string; sourceId: string };

function makeFakePrisma(seedRows: Array<{ userId: string; points: number; title?: string }> = []) {
  const rows: Row[] = [];
  let seq = 0;

  for (const seed of seedRows) {
    seq += 1;
    rows.push({
      id: `seed-${seq}`,
      userId: seed.userId,
      points: seed.points,
      title: seed.title ?? "seed",
      sourceSystem: "seed",
      sourceId: `seed-${seq}`
    });
  }

  const achievementEvent = {
    create: async ({ data }: { data: Omit<Row, "id"> }) => {
      const clash = rows.find((row) => row.sourceSystem === data.sourceSystem && row.sourceId === data.sourceId);
      if (clash) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      seq += 1;
      const row: Row = { id: `evt-${seq}`, ...data };
      rows.push(row);
      return row;
    },
    findUnique: async ({
      where
    }: {
      where: { sourceSystem_sourceId: { sourceSystem: string; sourceId: string } };
    }) => {
      const { sourceSystem, sourceId } = where.sourceSystem_sourceId;
      return rows.find((row) => row.sourceSystem === sourceSystem && row.sourceId === sourceId) ?? null;
    },
    aggregate: async ({ where }: { where: { userId: string } }) => {
      const sum = rows.filter((row) => row.userId === where.userId).reduce((total, row) => total + row.points, 0);
      return { _sum: { points: rows.some((row) => row.userId === where.userId) ? sum : null } };
    }
  };

  return { fake: { achievementEvent } as unknown as PrismaClient, rows };
}

describe("rankInfo", () => {
  it("mapea 450 XP al rango Guardia avanzando hacia Guardia 1ª", () => {
    const info = rankInfo(450);
    assert.equal(info.name, "Guardia");
    assert.equal(info.level, 2);
    assert.equal(info.floor, 400);
    assert.equal(info.next, 1000);
    assert.equal(info.toNext, 550);
    assert.equal(info.xp, 450);
    // (450 - 400) / (1000 - 400) = 50/600 = 8.33%
    assert.equal(info.pct, 8.33);
  });

  it("ubica 0 XP en Aspirante con 0% de avance", () => {
    const info = rankInfo(0);
    assert.equal(info.name, "Aspirante");
    assert.equal(info.level, 1);
    assert.equal(info.floor, 0);
    assert.equal(info.next, 400);
    assert.equal(info.toNext, 400);
    assert.equal(info.pct, 0);
  });

  it("trata cada umbral exacto como inicio del nuevo rango", () => {
    const expected = [
      { floor: 0, name: "Aspirante", level: 1, terminal: false },
      { floor: 400, name: "Guardia", level: 2, terminal: false },
      { floor: 1000, name: "Guardia 1ª", level: 3, terminal: false },
      { floor: 1500, name: "Supervisor", level: 4, terminal: false },
      { floor: 2400, name: "Jefe de Turno", level: 5, terminal: false },
      { floor: 3600, name: "Comandante", level: 6, terminal: true }
    ];
    for (const rank of expected) {
      const info = rankInfo(rank.floor);
      assert.equal(info.name, rank.name, `nombre en ${rank.floor}`);
      assert.equal(info.level, rank.level, `nivel en ${rank.floor}`);
      assert.equal(info.floor, rank.floor, `floor en ${rank.floor}`);
      // Al inicio de un rango intermedio el avance es 0%; el rango maximo satura en 100%.
      assert.equal(info.pct, rank.terminal ? 100 : 0, `pct en el umbral ${rank.floor}`);
    }
  });

  it("un XP por debajo de un umbral sigue en el rango anterior", () => {
    assert.equal(rankInfo(399).name, "Aspirante");
    assert.equal(rankInfo(399).pct, 99.75); // 399/400
    assert.equal(rankInfo(999).name, "Guardia");
    assert.equal(rankInfo(1499).name, "Guardia 1ª");
    assert.equal(rankInfo(3599).name, "Jefe de Turno");
  });

  it("satura en el rango maximo: next/toNext null y pct 100", () => {
    const top = rankInfo(3600);
    assert.equal(top.name, "Comandante");
    assert.equal(top.level, 6);
    assert.equal(top.next, null);
    assert.equal(top.toNext, null);
    assert.equal(top.pct, 100);

    const beyond = rankInfo(99999);
    assert.equal(beyond.name, "Comandante");
    assert.equal(beyond.next, null);
    assert.equal(beyond.pct, 100);
  });

  it("es total ante entradas invalidas (negativo / NaN => Aspirante 0)", () => {
    assert.equal(rankInfo(-50).name, "Aspirante");
    assert.equal(rankInfo(-50).xp, 0);
    assert.equal(rankInfo(Number.NaN).name, "Aspirante");
    assert.equal(rankInfo(Number.NaN).xp, 0);
  });

  it("los umbrales del motor coinciden con el diseño de la carrera", () => {
    assert.deepEqual(
      RANKS.map((rank) => [rank.floor, rank.name]),
      [
        [0, "Aspirante"],
        [400, "Guardia"],
        [1000, "Guardia 1ª"],
        [1500, "Supervisor"],
        [2400, "Jefe de Turno"],
        [3600, "Comandante"]
      ]
    );
  });
});

describe("ledger de XP", () => {
  it("ledgerSourceId namespacea la clave por usuario", () => {
    assert.equal(ledgerSourceId("u1", "LESSON:l1"), "u1:LESSON:l1");
    assert.notEqual(ledgerSourceId("u1", "LESSON:l1"), ledgerSourceId("u2", "LESSON:l1"));
  });

  it("sumPoints calcula el XP total como suma de puntos", () => {
    assert.equal(sumPoints([]), 0);
    assert.equal(sumPoints([{ points: 50 }, { points: 100 }, { points: 150 }, { points: 150 }]), 450);
  });

  it("totalXp = suma de AchievementEvent.points del usuario (historial incluido)", async () => {
    const { fake } = makeFakePrisma([
      { userId: "guardia", points: 50 },
      { userId: "guardia", points: 100 },
      { userId: "guardia", points: 150 },
      { userId: "guardia", points: 150 },
      { userId: "otro", points: 999 }
    ]);
    assert.equal(await totalXp(fake, "guardia"), 450);
    assert.equal(await totalXp(fake, "otro"), 999);
    assert.equal(await totalXp(fake, "sin-eventos"), 0);
  });

  it("otorgar dos veces la misma clave = un solo evento (idempotente)", async () => {
    const { fake, rows } = makeFakePrisma([
      { userId: "guardia", points: 50 },
      { userId: "guardia", points: 100 },
      { userId: "guardia", points: 150 },
      { userId: "guardia", points: 150 }
    ]);

    const first = await grantXp(fake, { userId: "guardia", key: "LESSON:l1", points: 10, title: "Leccion" });
    assert.equal(first.created, true);
    assert.equal(first.xpDelta, 10);
    assert.equal(first.xpTotal, 460);

    const second = await grantXp(fake, { userId: "guardia", key: "LESSON:l1", points: 10, title: "Leccion" });
    assert.equal(second.created, false, "el segundo otorgamiento no debe crear otro evento");
    assert.equal(second.xpDelta, 0, "sin XP adicional al re-otorgar");
    assert.equal(second.xpTotal, 460, "el total no cambia");

    // Exactamente un evento con esa clave idempotente.
    const ledgerRows = rows.filter((row) => row.sourceSystem === LEDGER_SOURCE && row.sourceId === "guardia:LESSON:l1");
    assert.equal(ledgerRows.length, 1);
  });

  it("distingue claves y usuarios distintos (no colisionan)", async () => {
    const { fake, rows } = makeFakePrisma();
    await grantXp(fake, { userId: "u1", key: "LESSON:l1", points: 10, title: "L1" });
    await grantXp(fake, { userId: "u1", key: "CERT:c1", points: 240, title: "Cert" });
    await grantXp(fake, { userId: "u2", key: "LESSON:l1", points: 10, title: "L1" });

    assert.equal(await totalXp(fake, "u1"), 250);
    assert.equal(await totalXp(fake, "u2"), 10);
    assert.equal(rows.filter((row) => row.sourceSystem === LEDGER_SOURCE).length, 3);
  });
});
