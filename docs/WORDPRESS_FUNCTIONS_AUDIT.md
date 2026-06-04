# WordPress Functions Audit

This document tracks production behavior confirmed from the current `capacita` WordPress LMS. The migration should preserve these behaviors first and should not rebuild plugin possibilities that are only present in code.

## Evidence Sources

Local sensitive extracts are under `tmp/` and must not be committed:

- `tmp/wordpress.sql`
- `tmp/wp-audit.json`
- `tmp/wp-users.json`
- `tmp/wp-catalog.json`
- `tmp/wp-content-extract/archives/*.zip`
- `tmp/wp-content-extract/unpacked`
- `tmp/wp-plugin-checksums.json`

Remote temporary PHP and ZIP files used for extraction were deleted after download.

## Platform

- WordPress 7.0, PHP 8.3.30.
- LMS plugin in use: Tutor LMS.
- Active theme: `astra-child`, parent `astra`.
- Core plugin source checked against WordPress.org checksums: ACF, Code Snippets, Elementor, GamiPress, Import Users from CSV, Loco Translate, LoginPress, Nextend Social Login, Tutor LMS, Spectra/UAG, User Role Editor, WP Force Login, WP Mail SMTP, WPForms Lite, and Peter's Login Redirect all matched stock plugin files for installed versions.
- Practical conclusion: production custom behavior lives in the child theme, database options/snippets, CSS, and content data rather than edited plugin source files.

## Confirmed Data Counts

- Users: 92.
- Roles after parsing WordPress capabilities: 1 admin, 9 teachers, 88 students. Some teachers also have student role.
- Users with `empresa_servicio`: 80.
- Courses: 14 total, 7 published.
- Lessons: 16.
- Video lessons: 10.
- Lesson/course attachments downloaded or referenced: PDFs, PPTX, DOC, images, and one MP4.
- Quizzes: 14.
- Questions: 62.
- Question types used: true/false, multiple choice, fill in the blank.
- Question options/answers: 157.
- Course enrollments: 148.
- Lesson completion records: 155.
- Quiz attempts: 143.
- Per-question attempt answers: 1192.
- Tutor course completion comments: 91.
- Tutor course ratings: 5.
- GamiPress user earnings: 242.

## Confirmed Course And Quiz Behavior

- Course URL base is `capacitacion`; lesson URL base is `leccion`.
- Courses are free; marketplace is off.
- Instructor publishing is enabled.
- Become-instructor button is off.
- Dashboard page is WordPress page ID 12, slug `dashboard`.
- Quiz settings are per-quiz, not global only.
- All 14 quizzes have attempt limits.
- Six quizzes have positive timers: examples include 5, 30, and 45 minutes.
- Passing grade is stored per quiz, commonly 80%, with one observed 60% quiz.
- Question order is configured as random.
- One production quiz has `quiz_auto_start` on and only 1 attempt.
- Some course items are direct course children through `_tutor_course_id_for_lesson`, not only topic children. The importer must preserve both topic sections and direct course items.

## Reports

The active child theme creates a custom admin submenu:

- Menu: `Reporte Estudiantes`.
- Capability: `read`.
- Data source: instructor's published courses, Tutor enrollments, latest final quiz attempt, and usermeta `empresa_servicio`.
- Status logic:
  - `publish` enrollment -> `En Progreso`.
  - `completed` with no final quiz -> `No hay examen`.
  - `completed` with no attempt -> `Pendiente`.
  - attempt with no marks -> `Examen sin realizar`.
  - earned percentage >= quiz passing grade -> `Aprobado`.
  - otherwise -> `Reprobado`.
- UI includes stats cards, doughnut chart, filters, search, Excel export, and PDF export through DataTables/pdfMake.

This report is a first-class function to rebuild, not just an admin nicety.

## Diploma / Recognition PDF

Confirmed published page:

- Page ID 189, title `Diploma`, slug `diploma`.
- Template: `diploma-detect.php`.

Current behavior:

- Requires logged-in user.
- Reads `course_id` from query string.
- Renders a landscape diploma using `diploma-fondo-v4.jpg`.
- Student name comes from `wp_get_current_user()->display_name`.
- Course title comes from `get_the_title(course_id)`.
- PDF is generated client-side through `html2pdf.js`.
- Filename is `diploma-{user_login}.pdf`.
- The background image already includes the visual signatures for Magali Lopez and Mario Carrillo.

No server-side folio, verification code, or persisted PDF issuance was found in the WordPress evidence. The new platform can improve this with server-side certificates, but compatibility must preserve current student-facing diploma generation.

## GamiPress Recognition

Confirmed achievement type:

- `Curso Completado`.
- Points: 10.
- Congratulations text: `¡Felicidades! Has completado un curso. Sigue avanzando en tu formación.`

Confirmed steps:

- `Aprobar cuestionario final` via `gamipress_tutor_pass_quiz`.
- `Completar curso` via `gamipress_tutor_complete_course`.

Confirmed user earning counts:

- `Aprobar cuestionario final`: 87.
- `Completar curso`: 86.
- `Curso Completado`: 69.

The new system should preserve historical achievements/awards or map them to certificates/recognitions deliberately.

## Email

Confirmed configuration:

- WP Mail SMTP configured for Hostinger SMTP, TLS, port 587.
- From name: `TSC Capacita`.
- WP Mail SMTP sent counter: 1066.
- Debug events: 43 total, 41 initiated by WP Mail SMTP and 2 by GamiPress.
- Debug events show SMTP failures, including authentication/sender issues.

Confirmed template file in child theme:

- `course-completed.php` contains a custom completion email body that reports `APROBADO` or `REPROBADO` based on quiz attempts.

Unconfirmed:

- Whether the custom template is currently wired into Tutor/GamiPress email hooks.
- Exact pass/fail recipient list and current email copy in successful production sends.

Implementation stance: build notification rules and logs, but do not assume old SMTP delivery was healthy.

## UI And Access Customizations

Active Code Snippets:

- `Disable admin bar`: hides WordPress admin bar for non-admin users.
- `mi perfil`: rewrites Tutor profile URL to `/profile/{user_login}/?view=student`.

Child theme behavior:

- Adds frontend dashboard profile URL rewrite.
- Rewrites `Cursos inscritos` menu link to `/cursos-inscritos`.
- Adds `[tutor_enrolled_courses]` shortcode and injects it into page `cursos-inscritos`.
- Hides LoginPress lost-password/register UI.
- Forces Tutor builder label translations such as `Currículo`, `Básicos`, `Añadir sección`, `Siguiente`, `Anterior`.
- Translates Tutor `Retry` label to `Default`.
- Removes/blocks commercial/pro UI fragments for instructors/students.
- Shows a custom `Has reprobado este curso` notice when course progress is below 100%.
- Adds `Estudiantes` submenu under Tutor LMS for instructors.
- Adds/forces `Trash` tab visibility for admin/instructors, while CSS also hides draft/trash by default.
- Permanently deletes Tutor course posts when they are trashed.

Custom CSS hides or suppresses:

- purchase history
- earnings / total earnings
- withdrawals
- wishlist
- Q&A
- announcements
- quiz attempts
- reviews
- course share
- profile/settings
- details columns
- selected page/menu items

Custom CSS also renames `Total de estudiantes` to `Total de Colaboradores`.

## Preserve Versus Do Not Rebuild Blindly

Preserve:

- Tutor course/lesson/topic/quiz structure.
- Direct course items and topic sections.
- Timed quizzes, random question order, attempt limits, passing grade, feedback mode, auto-start where configured.
- Student/teacher/admin roles and legacy WordPress password hashes.
- `empresa_servicio` for reporting.
- Instructor report with filters, statistics, Excel/PDF export, and approval logic.
- Diploma page behavior and background/signature visual.
- GamiPress completion achievement history.
- Login/dashboard visual and access customizations.
- Email notification capability with pass/fail/course-completed events.

Do not rebuild by default unless the user selects it:

- Marketplace/ecommerce/earnings/withdrawals.
- Public Q&A.
- Wishlist.
- Announcements.
- Reviews UI, despite five historical ratings.
- Social sharing.
- Student profile editing/settings.
- Plugin admin/pro upsell surfaces.
