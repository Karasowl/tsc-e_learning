# Architecture

## Deployment Shape

The backend is designed to be self-hostable on any VPS with Docker Compose. Vercel can be used for the frontend, but it is not required for the full product to run.

```text
Next.js frontend
  -> LMS API
       -> PostgreSQL
       -> local VPS storage volume
       -> SMTP server
       -> worker jobs
```

## Why This Shape

- Avoids WordPress/plugin update breakage.
- Keeps the critical backend portable between providers.
- Avoids paid storage/email services during v1.
- Allows future storage/provider migration through interfaces rather than rewrites.

## Backend Modules

- Auth and roles.
- Users, students, teachers, admins.
- Courses, modules, lessons, assets.
- Quizzes, questions, attempts, answers, grading.
- Certificates/diplomas, templates, signature/background assets, verification.
- Achievements/recognitions and historical awards.
- Notifications and outbound email.
- Instructor reporting/statistics with export.
- WordPress audit and import.

Implemented API runtime is tracked in `docs/API_RUNTIME.md`.

## WordPress Compatibility Targets

The first compatible release should reproduce the production behaviors documented in `docs/WORDPRESS_FUNCTIONS_AUDIT.md`:

- Tutor LMS curriculum, direct course items, quizzes, attempts, and progress.
- GamiPress course-completed recognition history.
- The instructor student report status logic and Excel/PDF export.
- The current diploma page behavior, while allowing a better server-side certificate implementation.
- Login/dashboard UI restrictions that hide unused Tutor commerce/social/pro surfaces.

## Storage

V1 uses local VPS storage. The code must call a storage abstraction, not direct arbitrary filesystem paths in business logic.

The WordPress import keeps attachment records with legacy `storageKey`, original URL, MIME type, and local file size when `wp-content/uploads` is available. This supports a local VPS volume first and does not require paying for S3-compatible storage at the start.

Future-compatible drivers:

- Local volume.
- MinIO.
- Cloudflare R2.
- AWS S3.

## Email

V1 uses SMTP, preferably the existing Hostinger mailbox. Email sending must go through a provider abstraction.

Notification events are written as durable `NotificationLog` rows first. Admin processing can send pending logs through SMTP; this keeps quiz/certificate flows from failing just because SMTP is temporarily unavailable.

Future-compatible providers:

- SMTP.
- Resend.
- Mailgun.
- SendGrid.

## Import Idempotency

All WordPress-imported domain records use `sourceSystem` + `sourceId` unique keys where practical. This lets the migration run repeatedly during rehearsal, staging, and final delta import without duplicating users, courses, lessons, quizzes, attempts, attachments, achievements, certificates, or reviews.
