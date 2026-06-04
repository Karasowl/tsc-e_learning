# Migration Strategy

## Principle

Migrate used behavior, not plugin possibility.

The old platform was assembled by modifying existing e-learning plugins. That means plugin source code contains more functionality than the business actually uses, and plugin updates can break patched behavior. The new platform must be based on observed production behavior and data evidence.

## Evidence Levels

- `confirmed`: observed in WordPress UI or backed by non-empty production data.
- `configured`: enabled by settings but not yet proven with user data.
- `unused`: present in plugin code or schema but no evidence of use.
- `unknown`: needs access or manual review.

Only `confirmed` and intentionally selected `configured` behavior should be implemented.

## Tutor LMS Evidence Targets

The current production LMS is Tutor LMS, not LearnPress. The first SQL audit confirmed the active plugin `tutor/tutor.php` and Tutor LMS tables/post types.

Confirmed data structures:

- Custom post types: `courses`, `topics`, `lesson`, `tutor_quiz`, `tutor_enrolled`.
- Quiz tables: `wp_tutor_quiz_questions`, `wp_tutor_quiz_question_answers`.
- Attempt tables: `wp_tutor_quiz_attempts`, `wp_tutor_quiz_attempt_answers`.
- Lesson progress: usermeta keys shaped like `_tutor_completed_lesson_id_{lessonId}`.
- Tutor settings in postmeta: `tutor_quiz_option`, `_video`, `_course_duration`, `_tutor_course_settings`, `_tutor_course_id_for_lesson`, `_tutor_attachments`.

The exporter still keeps basic LearnPress fallback support because the original migration research did not know the LMS plugin in advance, but production evidence should now be treated as Tutor LMS first.

## First Audit Pass

1. Identify active plugins and theme.
2. Identify LMS plugin tables and custom post types.
3. Count courses, lessons, quizzes, questions, attempts, enrollments, grades, certificates, notifications, media, and active users.
4. Open representative courses in staging and record flows:
   - Student login.
   - Course navigation.
   - Lesson/video/resource view.
   - Quiz start, timer, answer types, submit, pass/fail.
   - Certificate PDF generation.
   - Email notification recipients.
   - Teacher/admin statistics.
5. Mark unused plugin capabilities explicitly so they are not rebuilt by accident.

When the SQL dump is available, run:

```powershell
pnpm wp:audit -- --dump C:\path\to\wordpress.sql --out tmp\wp-audit.json
pnpm wp:export-users -- --dump C:\path\to\wordpress.sql --out tmp\wp-users.json
pnpm wp:export-catalog -- --dump C:\path\to\wordpress.sql --out tmp\wp-catalog.json
```

`tmp\wp-users.json` contains legacy password hashes. Keep it local, never commit it, and do not paste it into chats.
`tmp\wp-catalog.json` is the first source of truth for functions used by real LMS data.

## First Production SQL Findings

From the current SQL dump:

- LMS platform detected: Tutor LMS.
- Active plugin count: 17.
- Users exported: 92.
- Courses: 14 total, 7 published.
- Lessons: 16.
- Quizzes: 14.
- Quiz questions: 62.
- Question types used: true/false, multiple choice, fill in the blank.
- Question options/answers: 157.
- Course enrollments: 148.
- Lesson completion records: 155.
- Quiz attempts: 143.
- Per-question attempt answers: 1192.
- Timed quiz settings: 6 quizzes have a positive timer.
- Quiz attempt limits: all 14 quizzes have an attempt limit.
- GamiPress records: 242 user earnings, including 87 "Aprobar cuestionario final", 86 "Completar curso", and 69 "Curso Completado".
- GamiPress triggers configured: `gamipress_tutor_pass_quiz` and `gamipress_tutor_complete_course`.
- Tutor comment records: 91 `course_completed` comments and 5 `tutor_course_rating` comments.
- WordPress media attachments exported for import: 55.
- Tutor UI custom CSS hides commercial/social/admin elements such as purchase history, earnings, withdrawals, wishlist, Q&A, announcements, quiz attempts, reviews, share, profile/settings, and detail columns.
- WP Mail SMTP logs include 43 debug events: 41 initiated by WP Mail SMTP and 2 by GamiPress. Debug events show SMTP failures, so treat notification behavior as configured but requiring live verification of working recipients and copy.
- WordPress.org plugin checksum verification found no local modifications in the main active plugins checked. The effective customizations are in `astra-child`, Code Snippets/options, CSS, and content data.

The detailed behavior list is in `docs/WORDPRESS_FUNCTIONS_AUDIT.md`.

## Password Migration

WordPress user password hashes should be imported into `legacyPasswordHash`. The new LMS validates common WordPress user-password formats during first login:

- WordPress 6.8+ `$wp$2y$` bcrypt with SHA-384 prehash.
- Legacy `$P$` / `$H$` phpass.
- Legacy 32-character MD5.
- Plain bcrypt variants used by plugins.

After a successful login, the LMS stores a modern application bcrypt hash and clears the legacy hash. If a hash format is unsupported, the account must use secure password reset instead of weakening login rules.

## Migration Pipeline

```text
WordPress backup
  -> audit report
  -> users export
  -> catalog/function evidence export
  -> normalized JSON exports
  -> import dry-run
  -> Postgres import
  -> count reconciliation
  -> UI flow verification
  -> delta import
  -> DNS cutover
```

## Import Pipeline

The repository includes `@tsc-capacita/wp-import` for idempotent import from `tmp/wp-users.json` and `tmp/wp-catalog.json` into Prisma/Postgres.

Dry-run:

```powershell
pnpm wp:import -- --users tmp\wp-users.json --catalog tmp\wp-catalog.json --assets-root tmp\wp-content-extract\unpacked\wp-content\uploads
```

Apply:

```powershell
$env:DATABASE_URL="postgresql://tsc_capacita:tsc_capacita_dev@localhost:5433/tsc_capacita"
pnpm wp:import -- --users tmp\wp-users.json --catalog tmp\wp-catalog.json --assets-root tmp\wp-content-extract\unpacked\wp-content\uploads --apply
```

The current dry-run plan imports:

- 92 users and 98 role assignments.
- 14 courses and 17 course modules.
- 16 lessons, 14 quizzes, 62 questions, and 157 question options.
- 148 enrollments, 155 lesson progress records, 143 quiz attempts, and 1192 per-question answers.
- 55 WordPress media attachments.
- 1 GamiPress achievement, 2 achievement steps, 242 achievement events, and 69 final achievement awards.
- 91 certificate entitlements from Tutor `course_completed` comments.
- 5 hidden course reviews and 23 feature evidence rows.

Current dry-run warnings are historical orphan records, not active functionality:

- Quiz `96` titled `test` points to missing course `94`.
- Quiz attempts `134` to `137` belong to deleted users and the orphan test quiz.
- Lesson progress rows reference missing/deleted lessons `252`, `406`, `459`, and `464`.

Do not create production users, courses, or lessons just to satisfy those orphan rows. Keep them in warnings unless later business review proves they are needed.

## Local Apply Reconciliation

The import has been applied successfully to local Docker Postgres on host port `5433` after `pnpm prisma:push`.

Imported local DB counts:

- Users: 92.
- User roles: 98.
- Courses: 14.
- Course modules: 16.
- Lessons: 16.
- Quizzes: 13.
- Questions: 52.
- Question options: 137.
- Enrollments: 148.
- Lesson progress rows: 145.
- Quiz attempts: 139.
- Quiz answers: 1080.
- Assets: 55.
- Achievement events: 242.
- Final achievement awards: 69.
- Certificates: 91.
- Course reviews: 5.

Differences from the raw dry-run plan are expected and come from orphan historical rows:

- Quiz `96` (`test`) and its 10 questions point to deleted/missing course `94`.
- Quiz attempts `134` to `137` belong to deleted users and the orphan test quiz.
- Some lesson progress rows point to deleted/missing lessons `252`, `406`, `459`, and `464`.

The applied database was smoke-tested with Fastify injection:

- Enrolled student can list courses and open course detail.
- Admin can load `/reports/students`.
- Public certificate verification works.
- Certificate printable HTML contains the diploma layout text.

## Cutover

- Freeze WordPress edits.
- Run final delta import.
- Verify count parity and critical flows.
- Switch `capacita` DNS.
- Keep WordPress read-only as rollback source until the new LMS is proven in production.
