# Feature Inventory

This file tracks what must be copied from WordPress and why. Do not implement a plugin capability unless it is listed here with evidence.

| Area | Function | Evidence status | Notes |
| --- | --- | --- | --- |
| Auth | Student login with email/password | confirmed | Public login page is visible. Password migration requires DB backup. |
| Auth | Password reset | confirmed-disabled | LoginPress setting has password reset off and child theme hides lost-password UI. Verify whether admins reset manually before rebuilding self-service reset. |
| Users | Admin/teacher/student roles | confirmed | Parsed WordPress capabilities: 1 admin, 9 teachers, 88 students. |
| Users | Student service/company label | confirmed | 80 users have `empresa_servicio`; custom reports display it as `Servicio`. |
| Courses | Course catalog for enrolled users | confirmed | SQL dump contains Tutor LMS courses and 148 completed enrollment records. |
| Courses | Published courses | confirmed | 7 published course records in current Tutor LMS data. |
| Courses | Lessons/resources/videos | confirmed | 16 lessons, 10 lessons with YouTube video settings, 4 lesson attachment links. |
| Assets | WordPress media attachments | confirmed | `wp:export-catalog` exports 55 attachment records with file path, original URL, MIME type, and metadata for import. |
| Quizzes | Timed quizzes | confirmed | `wp:export-catalog` found 6 Tutor quizzes with positive time limits: 5, 30, and 45 minute examples. |
| Quizzes | Attempt limits | confirmed | All 14 Tutor quizzes have configured attempt limits; one production quiz allows 1 attempt, others show 10. |
| Quizzes | Question types used | confirmed | Production data uses true/false, multiple choice, and fill in the blank. Do not rebuild unused types unless intentionally selected. |
| Quizzes | Question options/answers | confirmed | `wp:export-catalog` found 157 Tutor answer/option records. |
| Quizzes | Attempts/results | confirmed | 143 quiz attempts, 1192 per-question answers, 91 pass results, 52 fail results. |
| Quizzes | Runtime attempt flow | implemented-api | API starts authenticated attempts, stores random question order per attempt, enforces timers/attempt limits, grades true/false, choice, multiple choice, and fill-in-the-blank answers, and logs pass/fail notification events when rules exist. |
| Progress | Enrollment/progress records | confirmed | 148 enrollments and 155 lesson completion records from Tutor LMS data. |
| Progress | Lesson completion runtime | implemented-api | API marks lessons complete and updates enrollment progress for the authenticated user. |
| Curriculum | Course sections and ordered items | confirmed | Tutor topics plus direct course items are exported into `sectionsByCourseId`. |
| Achievements | Course-completed recognition | confirmed | GamiPress has `Curso Completado` achievement with `Aprobar cuestionario final` and `Completar curso` steps. User earnings: 87 quiz-pass steps, 86 course-complete steps, 69 course-completed achievements. |
| Reports | Instructor student report | confirmed | Child theme adds `Reporte Estudiantes` admin submenu with Tutor enrollment/quiz status logic, filters, chart, Excel export, and PDF export. |
| Reports | Instructor report data endpoint | implemented-api | `GET /reports/students` rebuilds the WordPress status logic and returns rows plus summary counts. |
| Reports | Instructor report Excel/PDF export | implemented | `GET /reports/students/export.xlsx` returns a real ExcelJS workbook (data + summary sheets) reusing the shared report logic; web view also offers a TSC-branded print-to-PDF. |
| Certificates | Diploma page with signatures | confirmed | Page `Diploma` uses `diploma-detect.php`, `html2pdf.js`, and `diploma-fondo-v4.jpg`; signatures are embedded in the background image. Import dry-run maps 91 Tutor `course_completed` comments as certificate entitlements. |
| Certificates | Runtime diploma HTML and verification | implemented-api | API issues certificates, returns printable landscape HTML compatible with `diploma-detect.php`, supports `CERTIFICATE_BACKGROUND_URL` for migrated `diploma-fondo-v4.jpg`, and exposes public verification code lookup. |
| Certificates | Server-side diploma PDF | implemented | `GET /certificates/:id/pdf` builds a real downloadable PDF with `pdf-lib` (no headless browser), embedding the diploma background and a bundled OFL cursive font; faithful to the WordPress diploma layout. |
| Migration | Idempotent WordPress import | confirmed | `wp:import` dry-run covers users, roles, courses, modules, lessons, quizzes, questions, options, progress, attempts, answers, assets, achievements, certificate entitlements, reviews, and feature evidence. |
| UI | Hide Tutor LMS unused/commercial features | confirmed | Custom CSS hides purchase history, earnings, withdrawals, wishlist, Q&A, announcements, quiz attempts, reviews, share, profile/settings, detail columns, and selected menu/page items. |
| UI | Rename students label to collaborators | confirmed | Custom CSS replaces `Total de estudiantes` with `Total de Colaboradores` in Tutor dashboard. |
| UI | Student profile redirect | confirmed | Active Code Snippet `mi perfil` redirects Tutor profile to `/profile/{user_login}/?view=student`. |
| UI | Hide admin bar for non-admin users | confirmed | Active Code Snippet hides WordPress admin bar for users without `manage_options`. |
| Email | Notify selected emails on pass/fail | configured | WP Mail SMTP and GamiPress email paths exist; debug logs include GamiPress email attempts and SMTP failures. Need current working recipients, copy, and pass/fail conditions. |
| Email | Notification rules and SMTP processing | implemented-api | Admin rules/logs/process endpoints exist for quiz pass/fail, course completed, and certificate issued. Pending logs are sent through SMTP when configured. |
| Email | Automatic notification worker | implemented | In-process scheduled worker auto-delivers pending logs via SMTP (no extra infra); toggle/interval/batch via env; `POST /notifications/retry` re-queues failed deliveries. Verified end-to-end with a test SMTP account. |
