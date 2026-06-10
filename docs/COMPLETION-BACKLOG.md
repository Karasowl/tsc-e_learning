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

### M4 — Higiene de lenguaje (regla de memoria: nada de enums crudos)  ⬜
- [ ] Mapear a español todos los enums visibles: notificaciones (`eventType`/`status`), resultado de quiz (`status`), summary del reporte, cualquier estado.
- [ ] Auditoría rápida de strings filtrados (WordPress/tecnología/proceso).

### M5 — Autenticación y cuenta (esenciales modernos)  ⬜
- [ ] **Perfil de usuario** self-service: `GET/PUT /me` + pantalla (datos, foto/iniciales, etiqueta servicio).
- [ ] **Cambio de contraseña** propio + **reset por admin**.
- [ ] **Recuperar contraseña** (forgot/reset por email con token) — usando el worker SMTP/Resend.
- [ ] **Login con Google** (OAuth/OIDC) — credenciales del cliente en `.env` (NO en repo). Vincular por email.

### M6 — Seguridad (endurecimiento)  ⬜
- [ ] JWT con **caducidad** (`expiresIn`) + revalidar `User.status`/roles vivos por request (hoy roles "horneados" persisten tras revocar/suspender).
- [ ] **Proteger `GET /assets/:id/file`** por inscripción/rol (hoy material privado descargable sin auth = IDOR).
- [ ] **Rate-limit** en `/auth/login` (anti fuerza bruta) y global razonable.
- [ ] Assert: en `NODE_ENV=production` el `JWT_SECRET` no puede ser el default.
- [ ] `GET /inventory/features` detrás de auth (filtra rutas de código).
- [ ] Allow-list de tipos/límite real en subida de archivos.
- [ ] Limpieza de blobs huérfanos al borrar curso/lección/asset.

### M7 — Admin y reportes  ⬜
- [ ] Tablas con **paginación + orden + filtros** (reporte, usuarios).
- [ ] Dashboard admin con **KPIs visuales** (charts) y reporte con gráfica.
- [ ] Reset de contraseña / reenviar invitación desde admin de usuarios.
- [ ] (Opcional) Audit log de acciones admin (crear/borrar curso, cambios de rol, revocar acceso).

### M8 — Autoría (pulido de profesor)  ⬜
- [ ] **Drag-and-drop** para reordenar módulos/clases/preguntas.
- [ ] Guard de cambios sin guardar a nivel **curso** (hoy solo el LessonModal) + autosave.
- [ ] Password al crear estudiante/usuario como `type="password"` + generador/medidor.
- [ ] Vista previa del examen como alumno; validación (no guardar single-choice sin correcta).
- [ ] (Opcional) Reemplazar `RichTextEditor` (execCommand deprecado) por editor moderno (Tiptap/Lexical) con sanitización.

### M9 — Robustez de dominio  ⬜
- [ ] Completar curso debe considerar **exámenes aprobados**, no solo lecciones (hoy se puede certificar sin pasar el examen final).
- [ ] Flujo de calificación manual de `OPEN_ENDED`/`SHORT_TEXT` (o excluirlos del builder si no se usan).
- [ ] No marcar progreso en cursos `ARCHIVED`.
- [ ] Reanudar curso: exponer "última lección vista" (`lastSeenAt`).

### M10 — Migración de contenido y cutover  ⬜
- [ ] Migrar uploads reales del WordPress (≈669MB: imágenes/PDFs/1 MP4) a la storage nueva + reescribir URLs (hoy enlazan al WP vivo); subir `diploma-fondo-v4.jpg` real a prod.
- [ ] SMTP/Resend real en `.env` del VPS (hoy worker apagado, notifs PENDING).
- [ ] Validar copy/destinatarios de email aprobado/reprobado/curso completado con el cliente.
- [ ] Cutover DNS `capacita` → Vercel con WordPress de rollback.

### M11 — Routing real (App Router)  ⬜ (grande, al final)
- [ ] URLs por vista/curso/lección (deep-link, refresh sin perder pantalla, compartir enlace).

### M12 — Accesibilidad y pulido transversal  ⬜
- [ ] Focus trap + retorno de foco en modales; `role="progressbar"`/`aria-valuenow`; `aria-label` en course-card.
- [ ] Contraste de `--muted` y sidebar inactivo a AA.
- [ ] Modo oscuro vía tokens.
- [ ] Tablas con `caption`/`scope`.

---

## YA HECHO (referencia — no rehacer)
Auth login (compat WP), CRUD cursos/módulos/clases, builder de exámenes (8 tipos, grading completo incl. MATCHING/ORDERING), tomar exámenes (todos los tipos), reviews con moderación, directorio de instructores, panel de aprobados, inscripción gestionada por admin, admin de roles/permisos, certificados (folio + verificación pública + PDF server-side), reporte de instructor + export Excel/PDF, worker de notificaciones SMTP in-process, marca TSC, tokens de diseño base, catálogo de tarjetas, fix CORS, fix SHORT_TEXT grading, fix storage absoluto, botón Editar curso, modal de clase con guardas.

## FUERA DE ALCANCE (decisiones, NO son brechas)
Assignments/tareas, Q&A público, anuncios, wishlist, marketplace/ecommerce/pagos/withdrawals, social share, prerequisitos, drip content, become-instructor. Ninguno tenía uso en producción (estaban ocultos por CSS en Tutor). NO construir salvo que el usuario lo pida.
GamiPress: historial importado; motor de puntos activo NO se reconstruye (se mapea a certificados) salvo petición.
