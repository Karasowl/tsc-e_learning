# Deployment

Shape: **web on Vercel**, **API + PostgreSQL + storage on the Hostinger VPS**
(`82.25.95.86`, Ubuntu 24.04, Docker). The API is routed by the VPS's existing
**Traefik** reverse proxy (automatic HTTPS via its `letsencrypt` resolver). The
backend is VPS-agnostic — see the "Move to another VPS" section and
[VPS_RUNBOOK.md](./VPS_RUNBOOK.md).

```text
Browser ─HTTPS─> capacita.tscseguridadprivada.com.mx        (Vercel: Next.js web)
                       │  fetch
                       ▼
        api-capacita.tscseguridadprivada.com.mx              (VPS: Traefik TLS)
                       │ traefik-proxy network (Host rule)
                       ▼
                    api:4000 ──internal──> db:5432 + api_storage volume
```

The VPS is **shared** with other production stacks (Traefik, Odoo, n8n,
whisperall-api, uptime-kuma, …) managed by Dockge under `/docker/<stack>/`. This
stack lives at `/docker/tsc-capacita/`, joins the existing `traefik-proxy`
network, publishes **no host ports**, and is memory/CPU-limited so it cannot
disturb the other apps.

## 1. DNS

- `A  api-capacita.tscseguridadprivada.com.mx  -> 82.25.95.86`  (create first — Traefik needs it for TLS)
- `capacita.tscseguridadprivada.com.mx` — stays on WordPress until cutover (step 6).

## 2. VPS: deploy the stack

The repo has no git remote, so it is synced over SSH (rsync, excluding
node_modules/.next/dist/tmp). On the VPS:

```bash
cd /docker/tsc-capacita
cp .env.production.example .env          # then edit: strong JWT_SECRET +
                                         # POSTGRES_PASSWORD (match DATABASE_URL),
                                         # real SMTP_*, API_DOMAIN, WEB_PUBLIC_URL
docker compose -f docker-compose.prod.yml up -d --build
# apply the schema:
docker compose -f docker-compose.prod.yml exec api npx prisma db push \
  --schema=/app/packages/db/prisma/schema.prisma
curl -s https://api-capacita.tscseguridadprivada.com.mx/health   # after DNS + TLS
```

## 3. Load production data (real users, idempotent)

Do NOT restore the local QA database (it has test passwords). Load from the
WordPress exports so real users keep their existing passwords (legacy hashes).
Run the idempotent importer against the prod DB (e.g. over an SSH tunnel to a
temporarily localhost-published db port, or from a one-off container on the VPS):

```bash
pnpm wp:import -- --users tmp/wp-users.json --catalog tmp/wp-catalog.json \
  --assets-root tmp/wp-content-extract/.../uploads --apply
```

Re-runnable for the final delta import at cutover. See
[MIGRATION_STRATEGY.md](./MIGRATION_STRATEGY.md).

## 4. Vercel: deploy the web

The Vercel CLI is already authenticated on the dev machine.

```bash
cd apps/web
vercel deploy --prod            # or link the repo in the Vercel dashboard
```

- Set env `NEXT_PUBLIC_API_URL=https://api-capacita.tscseguridadprivada.com.mx`.
- Add the custom domain `capacita.tscseguridadprivada.com.mx` (activated at cutover).

## 5. Verify end-to-end (before cutover)

Login (real user) · course/lesson/video · quiz start+submit · diploma PDF
download · instructor report + Excel · a passing quiz creates a notification log
and the worker sends it.

## 6. Cutover (last, reversible)

1. Freeze WordPress edits.
2. Final delta import (step 3).
3. Reconcile counts and re-verify critical flows.
4. Point `capacita.tscseguridadprivada.com.mx` at Vercel.
5. Keep WordPress read-only as rollback until proven.

## 7. Backups (before cutover and scheduled)

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > backup-db-$(date +%F).sql.gz
docker run --rm -v tsc-capacita_api_storage:/data -v "$PWD":/out alpine \
  tar czf /out/backup-storage-$(date +%F).tgz -C /data .
```

## Move to another VPS (portability drill)

1. New VPS: install Docker; copy the repo + `.env` (update `API_DOMAIN`/IP if the
   hostname changes); ensure a reverse proxy (reuse the host's, or add Caddy/Traefik).
2. Restore the DB dump into the `db` service and the storage volume from the tgz.
3. `docker compose -f docker-compose.prod.yml up -d`.
4. Repoint the `api-capacita` DNS A record to the new IP (TLS re-issues automatically).
5. Verify login, quiz, diploma PDF, report. No application code changes required.
