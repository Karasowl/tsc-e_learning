# Operaciones — TSC Capacita (runbook vivo)

> Cómo funciona **de verdad** la plataforma en producción y cómo operarla. Documento vivo:
> si cambias algo en prod, actualízalo aquí. Complementa a [ARCHITECTURE.md](./ARCHITECTURE.md),
> [DEPLOYMENT.md](./DEPLOYMENT.md) y [VPS_RUNBOOK.md](./VPS_RUNBOOK.md).
> Última revisión grande: **2026-06-15**.

## 1. Estado actual de producción

| Pieza | Dónde | URL / ubicación |
| --- | --- | --- |
| Web (Next.js) | Vercel (proyecto `avanxia-labs/tsc-capacita`) | `https://tsc-capacita.vercel.app` (alias de prod; futuro `capacita.tscseguridadprivada.com.mx`) |
| API (Fastify) | VPS Hostinger `82.25.95.86`, Docker, detrás de Traefik | `https://api-capacita.tscseguridadprivada.com.mx` (interno: `api:4000`) |
| Base de datos | Contenedor `db` (Postgres 16) en el mismo VPS | red interna, sin puerto público |
| Archivos (imágenes/PDF/video) | Volumen Docker `tsc-capacita_api_storage` → `/app/storage` | host: `/var/lib/docker/volumes/tsc-capacita_api_storage/_data` |
| Correo saliente | Hostinger SMTP (buzón `rh@tscseguridadprivada.com.mx`) | `smtp.hostinger.com:587` |

El stack vive en el VPS en `/docker/tsc-capacita/` (repo completo + `.env`). El VPS es **compartido**
con otras apps de la empresa (Traefik, Odoo, n8n, whisperall, …); este stack no publica puertos y está
limitado en CPU/memoria. **No tocar** el sitio principal `tscseguridadprivada.com.mx`.

## 2. Secretos: dónde viven (NUNCA en el repo)

- **`.env` del VPS** en `/docker/tsc-capacita/.env` (permisos `600`): `JWT_SECRET`, `DATABASE_URL`/
  `POSTGRES_PASSWORD`, `SMTP_*`, `GOOGLE_CLIENT_ID`, `CERTIFICATE_BACKGROUND_URL`. Hay respaldos `.env.bak.*`.
- **Vercel env** (proyecto web): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (no son secretos).
- **Bitwarden** (fuente de verdad de credenciales de la empresa): SMTP/buzón `rh@` (item `mail.hostinger.com`
  / usuario `rh@tscseguridadprivada.com.mx`), hPanel de Hostinger, SSH del VPS, etc.
  - ⚠️ La contraseña de `rh@` guardada en Bitwarden estuvo **rotada** (Hostinger la rechazaba con 535). La
    vigente está en el `.env` del VPS. **Pendiente**: actualizar Bitwarden con la vigente para continuidad.

## 3. Correos / notificaciones (lo que más se pregunta)

**Resumen en una frase:** la plataforma envía los correos **ella misma, desde el VPS, por el SMTP de
Hostinger, con la cuenta `rh@tscseguridadprivada.com.mx`. NO usa Google para enviar correos.**

### Flujo
1. El API (en el VPS) se conecta a `smtp.hostinger.com:587` (STARTTLS) y se autentica como
   `rh@tscseguridadprivada.com.mx`.
2. Envía con remitente **`TSC Capacita <rh@tscseguridadprivada.com.mx>`**.
3. Hostinger entrega al destinatario.

`rh@` cumple **dos papeles**: es la cuenta que **envía** (el "De:") y a la vez la bandeja de RH que
**recibe copia** de cada resultado. (Si algún día se quiere separar, crear un buzón `notificaciones@` en el
panel de Hostinger y cambiar `SMTP_USER`/`SMTP_FROM`.)

### Quién recibe qué
- **Resultado de examen** (`QUIZ_PASSED`/`QUIZ_FAILED`) y **curso completado** (`COURSE_COMPLETED`):
  se envían **al estudiante + copia a RH** (paridad con el WordPress, que avisaba al alumno cada intento).
  Se genera **un solo** `NotificationLog` por evento, con `sentTo` deduplicado (alumno + `recipients` de
  reglas habilitadas). Se crea **aunque no exista ninguna regla** configurada (el alumno siempre recibe).
  Lógica en `apps/api/src/lib/notifications.ts` → `emitStudentNotification`, invocada desde
  `routes/quizzes.ts` y `routes/courses.ts`.
  - Las reglas de **copia a RH** (`rh@`) para `QUIZ_PASSED`/`QUIZ_FAILED`/`COURSE_COMPLETED` están
    **creadas y habilitadas** en `NotificationRule` (editables en el admin de notificaciones). Sin esas
    reglas, el correo iría solo al alumno. Nota: con las 3 activas, RH recibe copia de **cada intento** de
    examen; si es demasiado volumen, desactivar las de `QUIZ_*` y dejar solo `COURSE_COMPLETED`.
- `CERTIFICATE_ISSUED`: sigue dirigido solo a los `recipients` de regla (no al alumno).

### Worker de entrega
- `startNotificationWorker` (in-process, sin Redis) entrega los `NotificationLog` en estado `PENDING` por
  SMTP cada `NOTIFICATIONS_WORKER_INTERVAL_MS` (default 60000), en lotes de `NOTIFICATIONS_WORKER_BATCH` (25).
- Arranca **solo si** `SMTP_HOST`+`SMTP_USER`+`SMTP_PASSWORD` están y `NOTIFICATIONS_WORKER_ENABLED` ≠ `false`.
- Reintentos: `POST /notifications/retry` re-encola los `FAILED` a `PENDING`.

### Por qué llega bien (no a spam)
- **MX** de `tscseguridadprivada.com.mx` → `mx1/mx2.hostinger.com` (el correo del dominio vive en Hostinger).
- **SPF** → `v=spf1 include:_spf.mail.hostinger.com ~all` → el dominio **autoriza a Hostinger** a enviar.
  Como enviamos por `smtp.hostinger.com`, el envío está **alineado con SPF**. (El WordPress usaba este mismo
  camino y mandó >1000 correos.)

### Variables de entorno (en `.env` del VPS)
```
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=587
SMTP_USER=rh@tscseguridadprivada.com.mx
SMTP_PASSWORD=<en el .env del VPS, jamás en el repo>
SMTP_FROM=TSC Capacita <rh@tscseguridadprivada.com.mx>
NOTIFICATIONS_WORKER_ENABLED=true
```
Código del transporte: `apps/api/src/lib/email.ts` (nodemailer; `secure` solo en puerto 465, en 587 usa STARTTLS).

## 4. Almacenamiento y archivos (uploads)

- Driver local (`LOCAL_STORAGE_ROOT=/app/storage`), volumen `tsc-capacita_api_storage`. Portable (no S3, sin
  lock-in). Se sirve por `GET /assets/:id/file` (imágenes públicas; documentos exigen auth + acceso al curso).
- **Esquema de `storageKey`**:
  - Migrados del WordPress: la **ruta relativa del upload**, p. ej. `2025/03/Vector.png` → archivo en
    `/app/storage/2025/03/Vector.png`. (Por eso no hubo que reescribir la BD al migrar: el `storageKey` ya
    coincide con la ruta.)
  - Subidos por instructores: `authored/<uuid>/<archivo>`.
- **Migración de uploads (hecha 2026-06-15)**: los 55 archivos referenciados (~118 MB) se copiaron desde la
  copia local `tmp/wp-content-extract/unpacked/wp-content/uploads` al volumen del VPS. Receta en §10.
- **Fondo del diploma**: `apps/api/assets/diploma-fondo-v4.jpg` va **empaquetado en la imagen** del API. El PDF
  lo usa directo; el HTML lo toma de `CERTIFICATE_BACKGROUND_URL`, que apunta a la ruta propia
  `GET /certificates/diploma-background.jpg` (ya **no** depende del WordPress).

## 5. Despliegue

**Web (Vercel)** — el proyecto `tsc-capacita` tiene `rootDirectory=null`, así que el deploy se lanza
**desde `apps/web`** (no desde la raíz): el CLI detecta el workspace pnpm e incluye el contexto del
monorepo. El árbol del repo supera el límite de archivos de la subida normal, por eso `--archive=tgz`:
```bash
# vínculo (si .vercel/ no existe o apunta a otro proyecto):
vercel link --scope avanxia-labs --project tsc-capacita --yes
cp .vercel/project.json apps/web/.vercel/project.json   # el deploy corre desde apps/web
cd apps/web && vercel deploy --prod --yes --scope avanxia-labs --archive=tgz
```
`vercel` sube el árbol de trabajo (incluye cambios sin commitear). `NEXT_PUBLIC_API_URL` ya está en el env.
⚠️ No uses `vercel deploy` desde la raíz sin `rootDirectory`: crea un proyecto nuevo equivocado
(`tsc-e_learning`) y falla con "No Next.js version detected".

**API (VPS)** — el repo no tiene remoto git; se sincroniza por SSH (scp/rsync de `apps/api/src` y, si cambió,
`packages/db`), luego rebuild del contenedor:
```bash
scp apps/api/src/<archivos-cambiados> root@82.25.95.86:/docker/tsc-capacita/apps/api/src/<...>
ssh root@82.25.95.86 "docker compose -f /docker/tsc-capacita/docker-compose.prod.yml up -d --build api"
```
- Cambios **solo de `.env`** (p. ej. SMTP): no requieren rebuild, basta recrear → `up -d api`.
- El build de Docker **compila también los `.test.ts`**: si agregas campos a `AppConfig`, actualiza también
  los literales en `apps/api/src/lib/notifications-worker.test.ts` o el build falla.
- QA de prod: mi máquina no alcanza el VPS:443; se verifica con `curl` **desde el VPS** vía SSH.

## 6. Base de datos: respaldo y restauración

```bash
# Respaldo
ssh root@82.25.95.86 "docker compose -f /docker/tsc-capacita/docker-compose.prod.yml exec -T db \
  sh -lc 'pg_dump -U \$POSTGRES_USER \$POSTGRES_DB' | gzip" > backup-$(date +%F).sql.gz
# Restauración (en el VPS)
gunzip -c backup.sql.gz | docker compose -f /docker/tsc-capacita/docker-compose.prod.yml exec -T db \
  sh -lc 'psql -U $POSTGRES_USER -d $POSTGRES_DB'
```
Respaldo previo a la limpieza de datos: `/root/tsc-prehygiene-backup.sql.gz` en el VPS.
Relaciones: borrar un `Course` hace **cascade** a módulos/lecciones/exámenes/inscripciones/intentos; los
`Asset` quedan con `SetNull` (no se borran sus blobs al borrar el curso).

## 7. Higiene de datos (hecha 2026-06-15)

Catálogo migrado de 16 → **5 cursos publicados reales** (con respaldo previo). Se borraron 9 cursos basura
(0 inscritos), se fusionó el duplicado `INDUCCION A TSC`→`Inducción a TSC` (su inscrito único movido, dup
archivado), se renombraron títulos en MAYÚSCULAS y se **archivó** el curso plantilla "Título de Curso" (era
una prueba con ~10 alumnos reales; archivado = oculto pero reversible, registros intactos).
Pendiente menor: decidir sobre cuentas de instructor de prueba (`Ismael Tutor` isma@gmail.com,
`Ismael (Admin de prueba)`).

## 8. Autenticación

- Login `POST /auth/login`: valida hashes legados de WordPress (compat) y los re-hashea al formato propio.
- JWT con caducidad (`JWT_EXPIRES_IN`, default 30d) y **revalidación viva** de status/roles en cada request.
- **Login con Google** (`POST /auth/google`): es **opcional** y solo para el botón de inicio de sesión —
  **no tiene nada que ver con el correo**. Solo entran cuentas ya existentes y activas (no auto-registro).
  Depende de que el usuario agregue el origen JS autorizado en Google Cloud (ver §9). Si se decide no usar
  Google en absoluto, se puede quitar el botón del frontend y la ruta.

## 9. Pendiente de go-live (tareas del usuario)

1. **Google OAuth**: agregar `https://tsc-capacita.vercel.app` (y tras cutover
   `capacita.tscseguridadprivada.com.mx`) a "Orígenes de JavaScript autorizados" del cliente OAuth, o el botón
   de Google falla. (Omitible si se decide no usar login con Google.)
2. **Cutover DNS**: apuntar `capacita.tscseguridadprivada.com.mx` a Vercel; mantener WordPress como rollback.
   Al hacerlo, agregar también el dominio en Vercel.
3. Validar con el cliente el **texto final** de los correos de resultado/curso completado.

## 10. Recetas rápidas

**Cambiar la contraseña SMTP** (sin exponerla en logs):
```bash
printf '%s' '<password>' | ssh root@82.25.95.86 'PW=$(cat); cd /docker/tsc-capacita && \
  grep -vE "^SMTP_PASSWORD=" .env > .env.tmp && printf "SMTP_PASSWORD=%s\n" "$PW" >> .env.tmp && \
  mv .env.tmp .env && chmod 600 .env && docker compose -f docker-compose.prod.yml up -d api'
```

**Probar el SMTP sin enviar spam** (verify) o **enviar un correo de prueba**:
```bash
ssh root@82.25.95.86 "docker compose -f /docker/tsc-capacita/docker-compose.prod.yml exec -T api \
  node -e 'const nm=require(\"nodemailer\");const p=+process.env.SMTP_PORT;nm.createTransport({host:process.env.SMTP_HOST,port:p,secure:p===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}}).verify().then(()=>console.log(\"OK\")).catch(e=>console.log(\"FAIL\",e.message))'"
```

**Migrar uploads desde la copia local** (los `storageKey` migrados = ruta relativa del upload):
```bash
cd tmp/wp-content-extract/unpacked/wp-content/uploads
tar -czf /tmp/uploads.tgz <rutas>            # o todo el árbol
scp /tmp/uploads.tgz root@82.25.95.86:/tmp/
ssh root@82.25.95.86 "tar -xzf /tmp/uploads.tgz \
  -C /var/lib/docker/volumes/tsc-capacita_api_storage/_data/ && rm /tmp/uploads.tgz"
```

**Ver logs del API / del worker**:
```bash
ssh root@82.25.95.86 "docker compose -f /docker/tsc-capacita/docker-compose.prod.yml logs api --since 5m"
```

**Consultar la BD** (heredoc por stdin, robusto con nombres de tabla en comillas):
```bash
ssh root@82.25.95.86 'docker compose -f /docker/tsc-capacita/docker-compose.prod.yml exec -T db \
  sh -lc "psql -U \$POSTGRES_USER -d \$POSTGRES_DB"' <<'SQL'
SELECT status, count(*) FROM "Course" GROUP BY status;
SQL
```
