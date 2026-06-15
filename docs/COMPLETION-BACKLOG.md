# TSC Capacita — Backlog de Completitud (cerebro del /loop)

> Documento vivo. Es la **fuente de verdad** del loop autónomo que lleva la plataforma a
> nivel "e-learning de seguridad 2026". Sobrevive a compactaciones de contexto: al retomar,
> **leer este archivo primero**, ejecutar los siguientes items sin marcar, verificar, desplegar,
> marcar `[x]`, y continuar. No detenerse hasta que todas las milestones estén completas.

## Misión / definición de "completo"
Que un guardia (estudiante), un instructor y un administrador vivan una experiencia moderna,
pulida, móvil-real y segura — igual o mejor que cualquier LMS de 2026 — sin lenguaje técnico
filtrado, sin pantallas rotas, con los flujos esenciales (perfil, contraseñas, login Google,
reproductor de curso, resultados de examen claros) y con la seguridad endurecida.

## Estrategia
- **NO** reescribir a otro framework (se mantiene la consola propia Next.js + CSS tokenizado, decisión del usuario). Se hace **overhaul incremental agresivo** que eleva la percepción sin rearquitectura riesgosa.
- Cada iteración: cambio coherente y desplegable → verificar (build/typecheck local; curl prod desde el VPS) → desplegar (web Vercel CLI + API scp/compose) → marcar progreso → siguiente.
- No introducir lock-in de proveedor (requisito duro). Secretos solo en `.env`/Vercel env, nunca en el repo.

## Verificación y despliegue (recordatorio operativo)
- Web: `pnpm --filter @tsc-capacita/web build` local valida; deploy `vercel deploy --prod --yes` (proyecto avanxia-labs/tsc-capacita). `NEXT_PUBLIC_API_URL` ya en env de Vercel.
- API: scp de `apps/api/src/...` al VPS `/docker/tsc-capacita/...` + `ssh root@82.25.95.86 "cd /docker/tsc-capacita && docker compose -f docker-compose.prod.yml up -d --build api"`.
- Mi máquina NO alcanza VPS:443 → QA prod por curl desde el VPS via SSH + JWT HS256 minteado con el JWT_SECRET del contenedor.
- Storage del VPS: `LOCAL_STORAGE_ROOT=/app/storage` (absoluto, ya fijado).

---

## AUDITORÍA DE PARIDAD (2026-06-15) — corrección de realidad vs WordPress
> Resultado de un análisis de 5 agentes (funciones reales del WP en el dump SQL/tema hijo + diseño +
> backend/frontend verificados **contra código** + diff visual de screenshots). Veredicto: la app nueva
> está **por encima** del WP en casi todo el núcleo; faltan estas cosas para paridad/go-live real:

**P0 (bloquean paridad / cutover):**
1. **Correo de resultado de examen AL ESTUDIANTE por intento** — REGRESIÓN real frente al WP, antes
   marcada como "hecha". Hoy `logQuizOutcome` (quizzes.ts:447-471) y `logCourseCompleted`
   (courses.ts:270-294) crean `NotificationLog` con `sentTo = rule.recipients` (destinatarios fijos del
   admin) y **nunca** al email del estudiante; si no hay regla, no se envía nada. El WP enviaba al alumno
   APROBADO/REPROBADO cada intento (>200 usermeta `correo_enviado_attempt_N` lo prueban). (M)
2. **Migrar uploads del WP (~669MB) + reescribir URLs** — portadas rotas/negras en el catálogo (el asset
   apunta a un blob inexistente; el fallback BookOpen solo aplica si `thumbnail` es null) y PDFs como URL
   cruda wp-content en el cuerpo de lección; subir `diploma-fondo-v4.jpg` real. (L)
3. **SMTP real + encender worker** — worker apagado, notifs PENDING; sin esto no sale ningún correo. (S)

**P1:**
4. **Higiene de datos migrados** — cursos duplicados por mayúsculas ("INDUCCION" vs "Induccion"),
   instructores duplicados, cursos basura "Nuevo curso", y conteo "0 secciones/0 clases/0 exámenes" en
   cursos con contenido (contenido migrado sin vincular por FK; el `_count` de Prisma es correcto). (M)
5. **Placeholder de portada de marca + `onError`** (rectángulo negro → fallback elegante). (S)
6. **Quitar jerga WP filtrada al usuario**: copy técnico del login, folio de diploma con prefijo "WP-149",
   URLs wp-content visibles. (S)
7. **Validar copy/destinatarios de correos con el cliente**. (S)

**P2 (deseable 2026, NO brecha de paridad):** forgot-password (el WP lo tenía **deshabilitado a
propósito** → no rompe paridad), drag&drop real, etiquetas de tipo de lección crudas ("TEXT"), render del
PDF del reporte, reemplazo del RichTextEditor (execCommand), pulido de marca (emojis del theme toggle, etc.).

**Confirmado FUERA DE ALCANCE (NO son brechas — no se usaban en prod del WP):** OPEN_ENDED/SHORT_TEXT con
calificación manual (solo 3 tipos reales), builder de plantillas de diploma y revocación de certificado,
motor de puntos GamiPress, marketplace/pagos/withdrawals, Q&A/anuncios/wishlist/reseñas, social login
Nextend, prerequisitos/drip/become-instructor.

### Estado de la iteración (2026-06-15)
- ✅ **P0-1 Correo al estudiante + copia a RH** — implementado (un solo `NotificationLog` con `sentTo`
  dedup = alumno + recipients de reglas; se crea aunque no haya regla), 12 tests verdes, **desplegado** al VPS.
- ✅ **P0-2 Migración de uploads** — 55 archivos referenciados (118M) copiados al volumen
  `tsc-capacita_api_storage`; `storageKey` ya coincidía con la ruta → sin reescritura de BD.
  **Verificado en prod**: portada `Vector.png` responde HTTP 200 image/png.
- ✅ **P0-3 SMTP** — RESUELTO. Contraseña vigente de rh@ aplicada al `.env` del VPS; worker encendido;
  **envío de prueba real aceptado por Hostinger** (smtp.hostinger.com:587 TLS, from "TSC Capacita <rh@>").
  Pendiente menor: actualizar la contraseña en Bitwarden para continuidad.
- ✅ **P1-5/6 Pulido** — placeholder de portada de marca + `onError`, copy del login sin jerga, etiquetas
  de tipo de lección/nivel en español. Build limpio, **desplegado a Vercel**.
- ✅ **Fondo del diploma HTML desacoplado de WordPress** — nueva ruta pública `GET /certificates/
  diploma-background.jpg` (sirve el jpg empaquetado); `CERTIFICATE_BACKGROUND_URL` ahora apunta al API.
  Verificado HTTP 200 image/jpeg. (El PDF ya usaba el fondo empaquetado.)
- ✅ **P1-4 Higiene de datos migrados** — HECHO (con respaldo `pg_dump` previo en VPS `/root/`). Catálogo
  de 16→6 cursos publicados limpios: borrados 9 cursos basura (0 inscritos), fusionado el duplicado
  INDUCCION (movido su inscrito único al bueno → 38; dup archivado), renombrados títulos en MAYÚSCULAS.
  PENDIENTE: "Título de Curso" (13 inscritos) necesita nombre real del usuario; cuentas de instructor de
  prueba (Ismael Tutor isma@gmail.com, Ismael Admin de prueba) por decidir.
- ⬜ **P1-7 Validar copy de correos con el cliente** — pendiente (depende de que el SMTP envíe).
- 👤 **Usuario**: contraseña SMTP vigente; origen OAuth de Google; cutover DNS.

---

## MILESTONES

### M1 — Base de diseño (el mayor salto visual)  ✅ DESPLEGADA (2026-06-10)
- [x] Webfont de marca self-hosted vía `next/font` (Inter, sin lock-in) — adiós a la stack del sistema.
- [x] Escala tipográfica tokenizada (`--text-xs..3xl`, line-heights, pesos) aplicada a base + headings.
- [x] Refinados tokens `:root`: superficies, bordes, sombras (más premium), radios (8/10/14/18); tokenizados los hex crudos de pills/role-chips/timer/completion/error.
- [x] Primitivas pulidas: botones (active press + sombras), inputs/textarea unificados (radio + transición + placeholder), superficies con sombra-sm, tablas (números tabulares + header pegajoso), barra de progreso animada, métricas auto-fit, contraste de nav subido.
- [ ] (Diferido a M4) Unificar los 3 `StatusPill`/`StatusTag`/`EnrollStatusTag` duplicados en un solo componente + mapa de etiquetas ES — se hace junto con la higiene de enums.

### M2 — Feedback, shell y navegación  ✅ DESPLEGADA (2026-06-10)
- [x] Sistema de **toasts** (éxito/error/info) — `ui.tsx` (store sin context, montado en `layout.tsx`) + CSS. Cableado en authoring, QuizBuilder y usersAdmin.
- [x] **Diálogo de confirmación de marca** — `confirmDialog()` async reemplaza los 6 `window.confirm` + borrar documento + (nuevos) quitar rol y suspender usuario.
- [x] **Navegación móvil real** — drawer off-canvas (≤860px) + hamburguesa + backdrop + botón cerrar; nav cierra al elegir sección.
- [x] **Topbar** con menú de perfil/avatar (iniciales) + email + roles + "Salir".
- [x] **Skeletons** aplicados al catálogo del estudiante; primitivas listas para tablas admin.
- [~] (Polish diferido a M12) aplicar skeletons en tablas admin (cursos/usuarios/reporte) y estados vacíos con ilustración/CTA.

### M3 — Experiencia del estudiante  ⏳ EN CURSO
- [x] **Reproductor de lección**: navegación Anterior/Siguiente entre lecciones + barra de progreso animada (M1). (Autoavance e íconos por tipo: pendientes menores.)
- [x] **Resultado de examen rico**: tarjeta aprobado/reprobado clara, puntaje grande, botón **Reintentar**, sin enum crudo (`QuizResult`); icono de cerrar corregido (X).
- [x] **Búsqueda + filtros** en catálogo del estudiante (todos / en progreso / sin iniciar / aprobados) con buscador en vivo y estado "sin resultados".
- [ ] Soporte de video más allá de YouTube (Vimeo/MP4/archivo propio) + "marcar visto al terminar".
- [ ] Desglose por pregunta + explicación en el resultado (requiere que el backend devuelva correctitud por pregunta — coord. con M9).
- [x] **Dashboard del estudiante**: banner "Continuar aprendiendo" (curso en progreso) con barra de avance y botón Continuar.
- [x] Sanitizar `dangerouslySetInnerHTML` del cuerpo de lección (XSS) con **DOMPurify**.
- [ ] Certificados: verificación pública por código desde la UI; placeholder de portada decente (catálogo + editor).

### M4 — Higiene de lenguaje (regla de memoria: nada de enums crudos)  ✅ DESPLEGADA (2026-06-10)
- [x] Notificaciones: `eventType` (regla + log) y `status` mapeados a español (`notificationEventLabel`/`notificationStatusLabel` + `humanizeEnum` de fallback); status como pill de color.
- [x] Auditoría completa del frontend: el resto ya estaba en español — resultado de quiz (M3 `QuizResult`), summary del reporte (claves ya en español desde el backend), `StatusTag`/`EnrollStatusTag`/`statusEs` (cursos/inscripción/usuarios), selects de estado con opciones en español. No quedan enums crudos visibles.
- [~] (Opcional, sin impacto visible) unificar `StatusPill`/`StatusTag`/`EnrollStatusTag` en un componente — los 3 ya producen español correcto; se deja como limpieza futura de bajo valor.

### M5 — Autenticación y cuenta (esenciales modernos)  ✅ DESPLEGADA (2026-06-10) (falta forgot-password → depende de SMTP M10)
- [x] **Perfil self-service**: backend `GET/PUT /me` (`apps/api/src/routes/account.ts`) + pantalla "Mi perfil" (avatar de iniciales, email, roles, servicio, último acceso/alta) con edición de nombre+servicio. Verificado en prod.
- [x] **Cambio de contraseña propio**: `POST /me/password` (verifica la actual con wp-compat) + formulario en "Mi perfil".
- [x] **Reset por admin (backend)**: `POST /admin/users/:userId/password` (isAdmin). Falta UI en usersAdmin (modal con input) — pendiente menor.
- [x] **Login con Google** (OIDC) — backend `POST /auth/google` (verifica el ID token con `google-auth-library`; **solo entran cuentas ya existentes y activas**, no auto-registro) + botón GIS en el login. `GOOGLE_CLIENT_ID` en `.env` del VPS + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` en Vercel (no son secretos). Verificado: ruta 400/401 correctas, client id horneado en el bundle. **DEPENDE de que el usuario agregue `https://tsc-capacita.vercel.app` (y luego `capacita.tscseguridadprivada.com.mx`) en "Orígenes de JavaScript autorizados" del cliente OAuth en Google Cloud** para que el botón funcione al hacer clic.
- [ ] **Recuperar contraseña** (forgot/reset por email con token) — depende de SMTP/Resend (M10).

### M6 — Seguridad (endurecimiento)  ✅ DESPLEGADA (2026-06-10)
- [x] JWT con **caducidad** (`JWT_EXPIRES_IN`, default 30d) + **revalidación viva** de `User.status`/roles en cada request (`requireAuth` consulta la BD; roles ya no se "hornean" en el token → revocar rol/suspender surte efecto al instante). Verificado.
- [x] **Rate-limit**: global 300/min + `/auth/login` 10/min (`@fastify/rate-limit`). Verificado en prod (429 tras la ráfaga).
- [x] Assert: en `NODE_ENV=production` el `JWT_SECRET` no puede ser el default (config.ts lanza error).
- [x] `GET /inventory/features` detrás de auth+isAdmin (antes público). Verificado (401 sin token).
- [x] Frontend: respuesta **401 → cierra sesión** y vuelve al login (authFetch + api()).
- [x] (Parte B) **Protección de descargas**: imágenes (portadas/embebidas) siguen públicas para `<img>`; los **documentos (PDF/Office/video/etc.) exigen auth + acceso al curso** (admin / profesor dueño / inscrito). Frontend descarga documentos autenticados (blob) en learner y authoring. Verificado: doc sin token → 401, imagen pública, admin pasa el gate.
- [x] (Parte B) Allow-list de tipos en subida (`POST /assets` → 415 si no permitido).
- [x] (Parte B) Limpieza de blob al borrar asset (`deleteObject`).
- [~] (menor) Limpieza de blobs en cascada al borrar curso/lección (assets quedan con `onDelete: SetNull`) — pendiente para M10/limpieza.

### M7 — Admin y reportes  ✅ DESPLEGADA (2026-06-10)
- [x] **Reset de contraseña desde el admin** de usuarios (botón "Contraseña" por fila → `promptDialog` con input password → `POST /admin/users/:id/password`). Nuevo `promptDialog`/`PromptHost` reutilizable en `ui.tsx` (montado en layout).
- [x] **Reporte de colaboradores**: encabezados ordenables (todas las columnas), buscador en vivo, filtro por resultado (chips desde el summary) y **paginación** (25/página). KPIs con acento de color por estado.
- [~] (menor) paginación de la tabla de usuarios (hoy máx 200 con búsqueda/rol server-side) — diferido; charts del dashboard → diferidos (sin lib de gráficas).
- [ ] (Opcional) Audit log de acciones admin — diferido (no era requisito).

### M8 — Autoría (pulido de profesor)  ⏳ EN CURSO
- [x] Password al crear estudiante/usuario como `type="password"` (antes texto visible).
- [x] **Validación del constructor de exámenes**: no guardar opción única/múltiple sin respuesta correcta; mínimos por tipo (completar/enlazar/ordenar); enunciado obligatorio.
- [ ] **Drag-and-drop** para reordenar módulos/clases/preguntas. (L)
- [x] Guard de cambios sin guardar a nivel **curso** (snapshot de metadatos + `beforeunload` + confirm al volver). (Autosave no necesario con el guard.)
- [ ] Vista previa del examen como alumno.
- [ ] (Opcional) Reemplazar `RichTextEditor` (execCommand) por editor moderno (Tiptap/Lexical). (L)

### M9 — Robustez de dominio  ⏳ EN CURSO
- [x] **Completar curso exige aprobar los exámenes publicados** además de las lecciones (`updateCourseProgress`); no degrada ni borra los completados migrados (preserva `completedAt`/status). Aviso al estudiante "Aprueba el examen para obtener tu diploma". Desplegado.
- [x] No marcar progreso en cursos `ARCHIVED` (409 en `POST /lessons/:id/complete`).
- [ ] Flujo de calificación manual de `OPEN_ENDED`/`SHORT_TEXT` (o excluirlos del builder si no se usan en prod — solo se usaban 3 tipos).
- [ ] Reanudar curso: exponer "última lección vista" (`lastSeenAt`).

### M10 — Migración de contenido y cutover  ⬜
- [ ] Migrar uploads reales del WordPress (≈669MB: imágenes/PDFs/1 MP4) a la storage nueva + reescribir URLs (hoy enlazan al WP vivo); subir `diploma-fondo-v4.jpg` real a prod.
- [ ] SMTP/Resend real en `.env` del VPS (hoy worker apagado, notifs PENDING).
- [ ] Validar copy/destinatarios de email aprobado/reprobado/curso completado con el cliente.
- [ ] Cutover DNS `capacita` → Vercel con WordPress de rollback.

### M11 — Routing real (App Router)  ⬜ (grande, al final)
- [ ] URLs por vista/curso/lección (deep-link, refresh sin perder pantalla, compartir enlace).

### M12 — Accesibilidad y pulido transversal  ⏳ EN CURSO
- [x] **Modo oscuro** completo vía tokens (`[data-theme="dark"]`) + interruptor en la topbar + script anti-parpadeo en `layout.tsx` (respeta preferencia guardada y del sistema). Tokenizados los `white`/`#fff` hardcodeados que lo impedían.
- [x] **Focus trap + retorno de foco** en el modal de autoría; `role="progressbar"`+`aria-valuenow/min/max` en la barra de progreso; `aria-label` en las tarjetas de curso. (Confirm/Prompt ya enfocan su botón principal.)
- [~] (menor) `caption`/`scope` en tablas — pendiente, bajo impacto.

---

## YA HECHO (referencia — no rehacer)
Auth login (compat WP), CRUD cursos/módulos/clases, builder de exámenes (8 tipos, grading completo incl. MATCHING/ORDERING), tomar exámenes (todos los tipos), reviews con moderación, directorio de instructores, panel de aprobados, inscripción gestionada por admin, admin de roles/permisos, certificados (folio + verificación pública + PDF server-side), reporte de instructor + export Excel/PDF, worker de notificaciones SMTP in-process (OJO: hoy NO envía al
estudiante ni está encendido — ver AUDITORÍA P0-1/P0-3), marca TSC, tokens de diseño base, catálogo de tarjetas, fix CORS, fix SHORT_TEXT grading, fix storage absoluto, botón Editar curso, modal de clase con guardas.

## FUERA DE ALCANCE (decisiones, NO son brechas)
Assignments/tareas, Q&A público, anuncios, wishlist, marketplace/ecommerce/pagos/withdrawals, social share, prerequisitos, drip content, become-instructor. Ninguno tenía uso en producción (estaban ocultos por CSS en Tutor). NO construir salvo que el usuario lo pida.
GamiPress: historial importado; motor de puntos activo NO se reconstruye (se mapea a certificados) salvo petición.
