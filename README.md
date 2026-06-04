# TSC Capacita LMS

Migration project for `capacita.tscseguridadprivada.com.mx`.

The goal is to replace the current WordPress/plugin LMS with owned code while preserving the functions that are actually used today: students, teachers, courses, lessons, quizzes with timers, certificates with signatures, email notifications, progress, grades, and statistics.

## Current Direction

- Frontend: Next.js, deployable on Vercel or as a Docker image.
- Backend: Dockerized Node API, portable to any VPS.
- Database: PostgreSQL.
- Storage: local VPS volume for v1, abstracted so it can later move to MinIO/S3-compatible storage.
- Email: SMTP first, with provider abstraction for future transactional email services.

## Local Start

```powershell
pnpm install
Copy-Item .env.example .env
docker compose up -d db
pnpm prisma:generate
pnpm prisma:push
pnpm dev
```

The Docker Postgres service is exposed on host port `5433` to avoid collisions with local Postgres installs that commonly own `5432`.

## WordPress Audit

Do not migrate every plugin feature. Migrate only functions with evidence of real use in the current platform.

If using a Hostinger API token, first run read-only discovery:

```powershell
$env:HOSTINGER_API_TOKEN="paste-token-here"
pnpm hostinger:discover -- --domain tscseguridadprivada.com.mx --out tmp\hostinger-discovery.json
Remove-Item Env:\HOSTINGER_API_TOKEN
```

Hostinger API discovery does not replace the extraction step for shared hosting. The LMS data still needs a WordPress SQL dump plus `wp-content` files through SSH/SFTP, hPanel backup, or phpMyAdmin/WP-CLI.

When a SQL backup is available:

```powershell
pnpm wp:audit -- --dump C:\path\to\wordpress.sql --out tmp\wp-audit.json
pnpm wp:export-users -- --dump C:\path\to\wordpress.sql --out tmp\wp-users.json
pnpm wp:export-catalog -- --dump C:\path\to\wordpress.sql --out tmp\wp-catalog.json
```

`tmp\wp-users.json` contains password hashes. Keep it local and out of git.
`tmp\wp-catalog.json` is the first evidence map for courses, lessons, quizzes, question types, sections, progress, and used LMS behavior.

Current SQL evidence shows Tutor LMS, not LearnPress: 14 courses, 16 lessons, 14 quizzes, 62 questions, 148 enrollments, 155 lesson completions, 143 quiz attempts, and question types limited to true/false, multiple choice, and fill in the blank.

To audit the import plan without writing to Postgres:

```powershell
pnpm wp:import -- --users tmp\wp-users.json --catalog tmp\wp-catalog.json --assets-root tmp\wp-content-extract\unpacked\wp-content\uploads
```

To write to Postgres after `DATABASE_URL` is available:

```powershell
$env:DATABASE_URL="postgresql://tsc_capacita:tsc_capacita_dev@localhost:5433/tsc_capacita"
pnpm wp:import -- --users tmp\wp-users.json --catalog tmp\wp-catalog.json --assets-root tmp\wp-content-extract\unpacked\wp-content\uploads --apply
```

The current dry-run plan covers 92 users, 98 role assignments, 14 courses, 17 course modules, 16 lessons, 14 quizzes, 62 questions, 157 question options, 148 enrollments, 155 lesson progress records, 143 quiz attempts, 1192 quiz answers, 55 media attachments, 242 GamiPress events, 69 final achievement awards, 91 certificate entitlements, and 5 course reviews.

See [docs/ACCESS_NEEDED.md](./docs/ACCESS_NEEDED.md), [docs/MIGRATION_STRATEGY.md](./docs/MIGRATION_STRATEGY.md), [docs/WORDPRESS_FUNCTIONS_AUDIT.md](./docs/WORDPRESS_FUNCTIONS_AUDIT.md), and [docs/API_RUNTIME.md](./docs/API_RUNTIME.md).
