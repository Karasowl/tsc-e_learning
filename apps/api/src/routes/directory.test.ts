import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { serializeAdminCourse } from "./directory.js";

describe("authoring course list counts", () => {
  it("exposes section/lesson/quiz counts under `_count` (the key authoring.tsx reads)", () => {
    const row = serializeAdminCourse({
      id: "c1",
      title: "Custodia de Mercancia",
      slug: "custodia-de-mercancia",
      status: "PUBLISHED",
      version: 1,
      teacher: { id: "t1", displayName: "Instructor" },
      _count: { modules: 2, lessons: 3, quizzes: 1, enrollments: 5 }
    });

    // The real counts must reach the UI, not fall back to 0.
    assert.equal(row._count.modules, 2);
    assert.equal(row._count.lessons, 3);
    assert.equal(row._count.quizzes, 1);
  });

  it("does NOT emit the counts under the legacy `counts` key (the bug that showed 0/0/0)", () => {
    const row = serializeAdminCourse({
      id: "c1",
      title: "T",
      slug: "t",
      status: "DRAFT",
      version: 1,
      teacher: null,
      _count: { modules: 2, lessons: 3, quizzes: 1, enrollments: 0 }
    });

    assert.ok("_count" in row, "row must carry _count");
    assert.ok(!("counts" in row), "row must not carry the legacy counts key");
  });

  it("surfaces the course version for the publish vN->vN+1 UI", () => {
    const row = serializeAdminCourse({
      id: "c1",
      title: "T",
      slug: "t",
      status: "PUBLISHED",
      version: 4,
      teacher: null,
      _count: { modules: 1, lessons: 1, quizzes: 1, enrollments: 0 }
    });
    assert.equal(row.version, 4);
  });
});
