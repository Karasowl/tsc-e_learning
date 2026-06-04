# VPS Runbook

## Goal

The backend must be movable to any VPS owned by the company. The server should not contain special manual edits that are impossible to reproduce.

## Minimum VPS Requirements For V1

- Docker and Docker Compose.
- Enough disk for videos, images, PDFs, SQL backups, and logs.
- DNS access for the `capacita` subdomain.
- SMTP credentials, initially Hostinger if available.

## Deploy Shape

```powershell
Copy-Item .env.example .env
# edit .env with production values
docker compose up -d db
docker compose run --rm api pnpm prisma:migrate
docker compose up -d api web
```

## Backups

Back up both:

- PostgreSQL database.
- API storage volume.

The restore test is mandatory before production cutover:

1. Create a clean VPS or local Docker environment.
2. Restore the database dump.
3. Restore storage files.
4. Start API and web.
5. Verify login, quiz attempt, certificate PDF, and report pages.

## What Must Stay Portable

- Storage driver.
- Email provider.
- Database connection.
- Public URLs.
- Certificate templates and signatures.

Anything provider-specific must live in configuration, not business code.
