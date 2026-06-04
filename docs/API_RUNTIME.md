# API Runtime

This file tracks migrated runtime behavior, separate from extraction/import.

## Authentication

- `POST /auth/login`
  - Validates imported WordPress password hashes.
  - Rehashes to the application password format after successful legacy login.
  - Returns JWT with user roles.

All course, quiz, progress, and report routes require `Authorization: Bearer <token>`.

## Courses And Progress

- `GET /courses`
  - Students see enrolled published courses.
  - Teachers see their authored courses and any enrolled courses.
  - Admins see non-archived courses.
  - Returns teacher, thumbnail, counts, enrollment state, and progress percent.

- `GET /courses/:courseRef`
  - Accepts course id or slug.
  - Returns modules, lessons, lesson assets, completion state, quizzes, timer settings, passing grade, attempt limit, feedback mode, random-order flag, and latest attempt summary.

- `POST /lessons/:lessonId/complete`
  - Marks the authenticated user's lesson complete.
  - Updates course enrollment progress and marks enrollment completed when all lessons are complete.

## Quizzes

- `POST /quizzes/attempts`
  - Starts an authenticated attempt for `{ "quizId": "..." }`.
  - Reuses an existing unexpired in-progress attempt.
  - Enforces access and Tutor-style max attempt limits for students.
  - Calculates `dueAt` from the quiz timer.
  - Stores per-attempt question order so random quizzes do not reshuffle between page loads.
  - Returns public question data without correct-answer flags.

- `GET /quizzes/attempts/:attemptId`
  - Returns attempt state, public questions in the stored order, and graded answers if available.

- `POST /quizzes/attempts/:attemptId/submit`
  - Accepts answers shaped as:

```json
{
  "answers": [
    { "questionId": "q1", "selectedOptionIds": ["option-id"] },
    { "questionId": "q2", "text": "respuesta" }
  ]
}
```

  - Grades the confirmed Tutor question types:
    - true/false
    - single choice
    - multiple choice with exact answer set
    - fill in the blank with normalized text
  - Marks attempts `PASSED`, `FAILED`, or `EXPIRED`.
  - Writes `QuizAnswer` rows.
  - Creates pending `NotificationLog` rows when enabled notification rules exist for `QUIZ_PASSED` or `QUIZ_FAILED`.

## Certificates

- `GET /certificates`
  - Lists certificates visible to the authenticated user.
  - Students see their own certificates.
  - Teachers see certificates for their courses and their own certificates.
  - Admins see all certificates.

- `POST /certificates/issue`
  - Issues or returns the existing certificate for `{ "courseId": "..." }`.
  - Students must have a completed enrollment.
  - Teachers/admins can issue for courses they control/administer.
  - Creates folio, verification code, and pending `CERTIFICATE_ISSUED` notification logs when rules exist.

- `GET /certificates/:certificateId/html`
  - Returns a printable landscape HTML diploma compatible with the WordPress `diploma-detect.php` layout.
  - Includes student name, course title, folio, verification code, and issue date.
  - Uses `CERTIFICATE_BACKGROUND_URL` when configured. This should point to the migrated `diploma-fondo-v4.jpg`, whose signatures are embedded in the image.
  - Locally smoke-tested against imported certificates.

- `GET /certificates/:certificateId/pdf`
  - Returns a real, downloadable PDF generated server-side with `pdf-lib` (no headless browser, so it stays portable to any VPS and serverless).
  - Same access control as the HTML route.
  - Embeds the bundled `apps/api/assets/diploma-fondo-v4.jpg` background (cover-fit) and draws the title, student name (cursive Great Vibes font, OFL, bundled), legend, and folio/verification/date at the WordPress diploma positions. Long names/titles auto-shrink to fit.
  - Background path is overridable with `CERTIFICATE_BACKGROUND_PATH`.

- `GET /certificates/verify/:verificationCode`
  - Public certificate verification endpoint.

## Notifications

- `GET /notifications/rules`
  - Admin-only notification rule list.

- `POST /notifications/rules`
  - Admin-only rule creation for `QUIZ_PASSED`, `QUIZ_FAILED`, `COURSE_COMPLETED`, and `CERTIFICATE_ISSUED`.

- `GET /notifications/logs`
  - Admin-only recent log list.

- `POST /notifications/process`
  - Admin-only processing of pending logs through the configured SMTP provider.
  - Pass/fail emails preserve the intent of the WordPress `course-completed.php` template: clear `APROBADO` or `REPROBADO` result and score context.

## Instructor Report

- `GET /reports/students`
  - Requires teacher or admin role.
  - Optional query: `courseId`.
  - Teachers see their published courses; admins see all published courses.
  - Rebuilds the child-theme report status logic:
    - `En Progreso`
    - `No hay examen`
    - `Pendiente`
    - `Examen sin realizar`
    - `Aprobado`
    - `Reprobado`
  - Returns row data and summary counts for the UI/export layer.
  - Locally smoke-tested against the imported 148 enrollment rows.

- `GET /reports/students/export.xlsx`
  - Requires teacher or admin role; same `courseId` filter and access scope as `/reports/students`.
  - Reuses the shared `buildStudentReport` logic (no duplicated status rules).
  - Returns a real `.xlsx` (ExcelJS) with a `Reporte estudiantes` sheet and a `Resumen` sheet of status counts.
  - The web report view also offers client-side PDF via a print-optimized HTML window (TSC-branded), mirroring the WordPress pdfMake approach.

## Still Pending

- Automatic background worker scheduling for notification processing. Manual admin processing exists.
- Full frontend screens for the operational LMS.
