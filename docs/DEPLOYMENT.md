# Deployment

Shape: **web on Vercel**, **API + PostgreSQL + storage on a VPS** (Docker Compose),
fronted by **Caddy** for automatic HTTPS. The backend is VPS-agnostic — see
[VPS_RUNBOOK.md](./VPS_RUNBOOK.md) and the "Move to another VPS" section below.

```text
Browser ──HTTPS──> capacita.tscseguridadprivada.com.mx   (Vercel: Next.js web)
                          │  fetch
                          ▼
        api.capacita.tscseguridadprivada.com.mx           (VPS: Caddy TLS)
                          │ reverse_proxy
                          ▼
                       api:4000  ──>  db:5432  +  api_storage volume
```

## 0. Prerequisites

- A VPS with Docker + Docker Compose and root SSH (NOT shared hosting).
- DNS control for `tscseguridadprivada.com.mx`.
- Hostinger SMTP mailbox credentials for `capacitacion@…`.
- A Vercel account (web).

## 1. DNS records

- `A  api.capacita.tscseguridadprivada.com.mx  -> <VPS_IP>`  (create now — needed for TLS)
- `capacita.tscseguridadprivada.com.mx` — leave pointing at WordPress for now;
  it is cut over to Vercel last (step 6).

## 2. VPS: provision the stack

```bash
# On the VPS (Ubuntu/Debian example)
curl -fsSL https://get.docker.com | sh         # if Docker is not installed
git clone <repo-url> tsc-capacita && cd tsc-capacita
cp .env.production.example .env
# edit .env: strong JWT_SECRET + POSTGRES_PASSWORD (match DATABASE_URL),
# real SMTP_*, API_DOMAIN, WEB_PUBLIC_URL.
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm api node dist/scripts/... # (migrations: see below)
```

Apply the schema (Prisma):

```bash
docker compose -f docker-compose.prod.yml exec api npx prisma db push --schema=../../packages/db/prisma/schema.prisma
# or, once a migration history exists: npx prisma migrate deploy
```

Caddy provisions HTTPS for `API_DOMAIN` automatically. Verify:

```bash
curl https://api.capacita.tscseguridadprivada.com.mx/health
```

## 3. Load production data (real users, idempotent)

Do NOT restore a dump of the local QA database — it contains test passwords.
Load from the original WordPress exports so real users keep their existing
passwords (legacy hashes):

```bash
# with the tmp/ exports present and DATABASE_URL pointing at the prod DB
pnpm wp:import -- --users tmp/wp-users.json --catalog tmp/wp-catalog.json \
  --assets-root tmp/wp-content-extract/.../uploads --apply
```

The importer is idempotent (`sourceSystem`+`sourceId` keys), so it can be re-run
for the final delta import at cutover. See [MIGRATION_STRATEGY.md](./MIGRATION_STRATEGY.md).

## 4. Vercel: deploy the web

- Import the repo; root is `apps/web` (Next.js). Build command/output are standard.
- Set env var `NEXT_PUBLIC_API_URL=https://api.capacita.tscseguridadprivada.com.mx`.
- Add the custom domain `capacita.tscseguridadprivada.com.mx` in Vercel (it will be
  activated at cutover when DNS points here).

## 5. Verify end-to-end (before cutover)

Against the Vercel preview/temporary domain + the live API:

- Login with a real migrated user.
- Open a course, a lesson/video, start and submit a quiz.
- Issue/open a diploma and download the server-side PDF.
- Instructor report loads and exports Excel.
- A passing quiz creates a notification log and the worker sends it (check logs).

## 6. Cutover (last, reversible)

1. Freeze WordPress edits.
2. Run the final delta import (step 3) to capture last-minute data.
3. Reconcile counts and re-verify critical flows.
4. Point `capacita.tscseguridadprivada.com.mx` DNS at Vercel (per Vercel domain
   instructions).
5. Keep WordPress read-only as rollback until the new LMS is proven in production.

## 7. Backups (mandatory before cutover and on a schedule)

```bash
# Database
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > backup-db-$(date +%F).sql.gz
# Storage volume (videos/PDFs/diplomas)
docker run --rm -v tsc-capacita_api_storage:/data -v "$PWD":/out alpine \
  tar czf /out/backup-storage-$(date +%F).tgz -C /data .
```

## Move to another VPS (portability drill)

This is the procedure the company will use in a few years. It must be rehearsed
once before relying on it.

1. New VPS: install Docker, `git clone`, copy `.env` (update `API_DOMAIN`/IP if the
   hostname changes).
2. Restore the database dump:
   `gunzip -c backup-db.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"`
3. Restore the storage volume from `backup-storage.tgz` into the `api_storage` volume.
4. `docker compose -f docker-compose.prod.yml up -d`.
5. Repoint the `api.capacita…` DNS A record to the new VPS IP (Caddy re-issues TLS).
6. Verify login, quiz, diploma PDF, report. No application code changes required.
