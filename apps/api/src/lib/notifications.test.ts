import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderNotificationEmail } from "./notifications.js";

describe("notifications", () => {
  it("renders pass/fail email body compatible with the WordPress template intent", () => {
    const pass = renderNotificationEmail(
      {
        id: "log",
        eventType: "QUIZ_PASSED",
        userId: "user",
        courseId: "course",
        payload: { quizTitle: "Final", scorePercent: 90, passingScorePercent: 80 },
        sentTo: ["admin@example.com"],
        providerId: null,
        status: "PENDING",
        createdAt: new Date()
      },
      null
    );

    assert.match(pass.subject, /Aprobado/);
    assert.match(pass.html, /APROBADO/);
    assert.match(pass.html, /90/);
  });
});
