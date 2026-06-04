# MVP Plan — Authoring + full LMS experience

Goal: reach the feature parity the Tutor LMS plugin gave (minus commented-out
code). The current app only consumes imported data; it has **no authoring**.

## Gap (confirmed)
- No write endpoints for courses/modules/lessons/quizzes/questions; no asset
  upload; no reviews write. Data model already supports everything (cover via
  `Course.thumbnailAssetId`, modules=sections, lessons with HTML `body` + video +
  assets, all `QuestionType`s incl. MATCHING/ORDERING via `gapMatch`/position,
  `CourseReview`). Quizzes are flat (Tutor had no quiz sections) → keep flat.

## Phase A — Backend authoring API (TEACHER/ADMIN; teachers limited to own courses)
- `routes/assets.ts` (+ storage read): `POST /assets` multipart upload, `GET /assets/:id/file` public stream. Covers, lesson images, video files.
- `routes/courses-admin.ts`: course/module/lesson CRUD + reorder + publish.
- `routes/quizzes-admin.ts`: quiz CRUD; question/option CRUD for all types (single/multiple/true-false/fill/short/open/matching/ordering) incl. correct answers.
- `routes/reviews.ts`: enrolled student create review (stars+comment); list per course; admin moderate (status APPROVED/HIDDEN/PENDING).
- `routes/directory.ts`: `GET /teachers` (+ their courses), `GET /admin/courses` (all), `GET /me/completed` (student passed courses).
- `lib/grading.ts` + `routes/quizzes.ts`: grade MATCHING (pairs value↔gapMatch) and ORDERING (positions); extend submit payload.

## Phase B — Frontend authoring + experience
- Rich-text lesson editor (titles, bold, italic, insert image) — Tiptap or minimal.
- Course editor: create/edit, cover upload, modules, lessons (text/video/upload).
- Quiz/exam builder: questions by type, timer, attempts, correct answers, matching/fill UI.
- Course reviews (stars + comments) on course detail.
- Teacher directory + their courses; all-courses admin view.
- Student panel: completed/passed courses.

## Phase C — Polish + assets migration + cutover
- Migrate WordPress uploads to the new storage + URL rewrite (before cutover).
- SMTP/Resend for email worker.
- DNS cutover capacita → Vercel.

Build order: A (this milestone) → B (incremental) → C.
