# Rediseño de Flujos — TSC Capacita LMS

> Roadmap unificado del rediseño "Centro de Operaciones" (dark-first).
> Fuente: auditoría por pista (estudiante, instructor, admin, fundaciones) — intención de diseño, brechas clasificadas y plan por pista.
> Diseño canónico vivo: Claude Design `projectId 019e274e-a7f3-722f-b2e9-10af532ee3ad` (resolver placeholders con DesignSync `get_file`).

---

## 0. Resumen ejecutivo (estado real, honesto)

El veredicto del usuario —"es una simulación, no algo usable"— **es falso a nivel de plomería y verdadero a nivel de producto/experiencia**. Hay que separar dos cosas que se confundieron:

1. **El núcleo funcional ES real y persiste.** En las cuatro pistas, lo implementado golpea Fastify + Prisma y guarda en Postgres. No se encontró **ninguna** simulación real (mock disfrazado de real) en estudiante, instructor ni fundaciones; en admin solo **una** (el estado "Invitación pendiente" es un enum muerto inalcanzable). Conteo agregado de la auditoría:

   | Pista | Real | Parcial | Simulación | Inexistente |
   |---|---|---|---|---|
   | Estudiante | 9 | 5 | **0** | 8 |
   | Instructor | 3 | 10 | **0** | 5 |
   | Admin | 1 | 10 | **1** | 11 |
   | Fundaciones | 1 | 12 | **0** | 7 |

2. **Lo que SÍ es "simulación" en sentido de producto** es que la aplicación **no se parece ni se comporta como el diseño que se prometió**. El diseño canónico es un "Centro de Operaciones" dark-first con dos shells (app móvil del guardia + consola de instructor sin sidebar) y una capa de gobierno (admin Ops-Center). Lo construido es **un LMS de escritorio genérico, tema claro, un solo shell con sidebar**, sin la cáscara móvil, sin gamificación, sin versionado/sello, sin bitácora, y con **el design-system canónico ausente de `main`** (vive solo en la rama sin fusionar `origin/design/tsc-security-rebrand`, que además invierte la ley dark-first declarando "Light is the default").

**Traducción para el roadmap:** no hay que "desmontar mocks"; hay que **(a)** corregir las fundaciones (tema invertido, tokens ausentes, shell único), **(b)** envolver el núcleo real en los shells y flujos del diseño, y **(c)** construir lo genuinamente inexistente (gamificación del guardia, versionado/sello inmutable, bitácora, anuncios, tablero admin). El riesgo dominante **no** es código falso: es **deuda de fidelidad de marca y de arquitectura de shell**.

### Decisión sobre la rama `origin/design/tsc-security-rebrand`
**Aprovechar parcialmente, rehacer la dirección.** La rama (commit `0c574bc`) toca solo 3 archivos (`globals.css`, `layout.tsx`, `page.tsx`, ~343 líneas) y aporta valor reutilizable: los **valores hex de la escala ink + rojo #A82431** y el **cableado `next/font` de Saira/Hanken/Plex Mono**. Pero comete el error central: deja `:root` en claro y trata dark como override (`[data-theme=dark]`), al revés de la ley (`[data-theme=light]` debe ser la variante). **Plan:** no fusionar la rama tal cual; **cherry-pick de sus valores de token y de la importación de fuentes**, reescribiendo el `:root` para que **dark sea el default** y `light` sea la variante de subárbol para diplomas/reportes. Así se ahorra el trabajo mecánico sin heredar el bug de dirección.

---

## 1. Estado de simulación (en términos de PRODUCTO)

Qué es "simulación" hoy, dicho como lo viviría un usuario, no en jerga técnica:

- **La app no se ve como lo prometido.** El guardia abre un panel de escritorio en **fondo claro** con barra lateral; nunca ve la app móvil oscura "Centro de Operaciones" con sus pestañas inferiores, su rango y su misión. El primer impacto visual contradice la marca.
- **No hay "carrera del guardia".** El diseño vende XP, rango, insignias, racha y escalafón como gancho de retención. **Nada de eso existe**: aprender funciona, pero la motivación gamificada que define el producto está ausente.
- **El instructor y el admin operan un LMS genérico, no la "Consola/Centro de Operaciones".** Crear curso es un input suelto en vez de un asistente; publicar es cambiar un desplegable en vez de versionar con sello; no hay tablero de mando, ni bitácora, ni anuncios, ni vista previa del guardia.
- **Promesas de cumplimiento/auditoría sin respaldo visible.** El "sello de evaluación inmutable" (congelar las reglas con que se aprobó un examen) —el corazón de valor para seguridad privada/compliance— **no existe**: si el instructor cambia el examen, el histórico se reevalúa contra la regla nueva.
- **Estados muertos que aparentan función.** El admin ve "Invitación pendiente" como si invitara por correo, pero el alta crea cuentas ya activas con contraseña fijada a mano; la invitación por correo **nunca ocurre**.

En cambio, **lo que NO es simulación** (y conviene proteger): login con sesión, catálogo por inscripción, completar lecciones, examen calificado en servidor al 80%, diploma con folio/código/PDF reales y verificación pública, reseñas, reportes con Excel/PDF reales, reglas de notificación por correo (incluida copia a RH) y toggle de tema persistido.

---

## 2. Fundaciones primero (trabajo transversal — bloqueante)

Estas piezas son precondición de **todo** lo demás. Sin ellas, cualquier flujo nuevo nace con la piel equivocada y el shell equivocado.

| # | Fundación | Qué es | designRef |
|---|---|---|---|
| F1 | **Tokens del Design System en `main`** | Portar los 113 tokens (escala ink `#090F12→#2C434D`, rojo único `--tsc-red #A82431` + `#E45D6C` sobre ink, `--fg-*`, `--line-*`, estatus, radios, sombras, motion) a `globals.css`. Cargar Saira Condensed/Hanken Grotesk/IBM Plex Mono vía `next/font` y retirar Inter. Mapear aliases legacy (`--bg`,`--brand`,…) sobre los nuevos para no romper componentes durante la migración. **Cherry-pick** valores de la rama rebrand. | `colors_and_type.css` (hoja única) |
| F2 | **Invertir la dirección del tema (dark = default)** | `:root` = escala ink (`color-scheme:dark`); mover warm-paper a `:root[data-theme="light"]`/`.theme-light`. Arreglar `layout.tsx:20` (themeScript) y `page.tsx:221,344` para que **un usuario sin `tsc_theme` aterrice en oscuro**. Verificación empírica: borrar localStorage → recargar → debe verse el centro de operaciones oscuro. | Ley de marca dark-first |
| F3 | **Forzar light solo en diploma/reporte impreso** | Envolver los subárboles de diploma imprimible y reporte PDF en `.theme-light` permanente, para que conserven papel cálido aunque el tema global sea oscuro. | `colors_and_type.css` bloque light |
| F4 | **Biblioteca de componentes al spec** | Implementar `.btn--brand/--light/--dark/--ghost/--wa` (píldora, press `translateY(1px)`, sin scale), `.pill`+`.pill--ok/--watch/--live` (mono 11px, punto `::before` 7px, pulso `tsc-pulse`), `.eyebrow` (Hanken 600 +0.18em rojo), `.mono-label`/`.label-caps`, `.card` (hairline, sin lift en hover), `.section/.rule/.rule--red`, `.inp` (foco rojo, label mono, icono Lucide líder). Aliasar las clases actuales. | `colors_and_type.css` |
| F5 | **Eliminar iconos prohibidos** | Reemplazar emoji `🌙/☀️` del toggle (`page.tsx:874`) por Lucide Sun; reemplazar `▲▼⇅↑↓` de orden/reordenamiento (`page.tsx:~1580,~1924`) por `Chevron*`/`Arrow*` Lucide. | Ley: solo Lucide stroke 1.6 |
| F6 | **Shell móvil del colaborador** | Para `STUDENT`: `.sb` (reloj 24h + señal/wifi/batería SVG), lienzo ink `.scr`, `.tabbar` inferior fija de 4 destinos, `.home-ind`, ancla escudo + "CAPACITA" + eyebrow de rol/ID. Sustituye el drawer del sidebar desktop en móvil. | Prototipo Guardia `.sb/.tabbar/.home-ind` |
| F7 | **Consola de instructor sin sidebar** | Topbar 62px + breadcrumb ("Mis cursos > {curso}" + status pill) + tira de 6 navtabs contextuales (Estructura·Reglas·Resultados·Vista previa·Anuncios·Ajustes) que se desbloquean en curso + CTA "Publicar". El sidebar dentro de la consola está **prohibido**; el sidebar Ops-Center solo se permite en admin. | Consola Instructor `.dc.html` |
| F8 | **Anclas de identidad cross-rol** | Escudo SVG (no PNG raster), wordmark "CAPACITA" Saira MAYÚSCULA, eyebrow de rol + ID mono constante en ambos shells. | Prototipo (escudo SVG) |

**Orden interno de fundaciones:** F1 → F2 → (F4, F5 en paralelo) → (F6, F7) → (F3, F8). F1 es la pieza más load-bearing: sin tokens, nada es dark-first.

---

## 3. Roadmap por fases (con dependencias)

Principio rector de priorización: **que el ESTUDIANTE tenga una experiencia real y de marca primero.** El núcleo de aprendizaje ya funciona; lo que falta es la cáscara y la gamificación. Por eso, tras fundaciones, el primer rol en cerrarse es el guardia.

### FASE 0 — Fundaciones transversales (bloqueante de todo)
**Objetivo:** la plataforma se ve y se comporta dark-first, con tokens, fuentes, componentes y los dos shells por rol.
Items: **F1–F8** (sección 2).
Salida medible: usuario nuevo aterriza en oscuro; `STUDENT` ve cáscara móvil; `TEACHER` ve consola con breadcrumb+tabs; cero emoji/unicode-como-icono.

### FASE 1 — Estudiante P0 (experiencia real de marca + motor de gamificación)
**Objetivo:** el guardia entra a su app móvil oscura, ve su rango/XP reales y completa un curso de principio a fin con recompensas trazadas en BD.
Backend (server-side, idempotente, sobre eventos reales):
- Ledger de XP reutilizando/extendiendo `AchievementEvent` (idempotencia por `LESSON:<id>` / `CERT:<id>`); preserva puntos GamiPress migrados.
- Rangos derivados (`rankInfo(xp)`) con umbrales Aspirante 0 / Guardia 400 / Guardia 1ª 1000 / Supervisor 1500 / Jefe de Turno 2400 / Comandante 3600.
- `GET /me/progress` (xp, rango, pct, toNext, conteos reales) y `GET /me/badges`.
- Otorgar XP en hooks reales: `+10` en `POST /lessons/:id/complete` (primera vez), `+240` en `POST /certificates/issue`; devolver `{xpDelta, xpTotal, ascended, rankName}`. Unificar recompensa a **+240** (resolver inconsistencia +150 del proto).
- Insignias reusando `Achievement`/`AchievementStep` (trigger `COURSE_COMPLETED`) + `AchievementAward` al completar curso.
Front (dentro del shell móvil F6):
- **Tab RANGO**: hub con `/me/progress` y `/me/badges`, tarjeta-hero "Continuar tu misión" desde el curso en progreso real.
- **Login "ACCESO OPERATIVO"** dark + aterrizaje en RANGO (no en `courses`).
Salida medible: completar Protección Ejecutiva suma XP real, otorga insignia y, si cruza umbral, asciende — todo persistido.

### FASE 2 — Estudiante P1 (cerrar el flujo de marca del guardia)
**Objetivo:** el catálogo, el temario, el examen y el resultado lucen y se comportan como el prototipo, sobre el motor real.
- **Tab CURSOS** móvil con tags de estado derivados (APROBADO/EN CURSO/%/BLOQUEADO) + **prerrequisitos** (`CoursePrerequisite`, `locked/lockReason` por usuario en `GET /courses`).
- **Detalle de curso**: bloqueo secuencial del temario (done/current/pending), examen gated por lecciones.
- **Examen paso a paso**: stepper, barra de segmentos, reloj real (`dueAt`), validación "Selecciona una respuesta" — **sin tocar el motor de calificación**.
- **Resultado + Reclamar diploma (+240 XP)** con ascenso; **Reproductor de lección** gamificado (+10 XP toast).
- **Tab LOGROS** (escalafón 6 rangos, check Lucide no unicode) y **Tab PERFIL** gamificado.
- `employeeCode` en `User`, expuesto en `/me` y `/me/progress`.

### FASE 3 — Instructor P0/P1 (Consola de Operaciones real)
**Objetivo:** la autoría real vive dentro del shell canónico y se construye la interacción-firma (versionado + sello).
- **Primitiva Modal/Wizard** reutilizable (fade .22s, scrim blur, sin spring) — base de los 4 wizards.
- **Backend versionado + sello inmutable**: `Course.version`, `QuizAttempt.rulesVersion` + `rulesSnapshot`; publish incrementa versión; snapshot al iniciar intento; `reports.ts` evalúa contra snapshot. *(Compartido con admin.)*
- **Modal Publicar** (diff vN→vN+1, checklist real, advertencia, éxito).
- **Builder de 2 paneles** (outline↔editor, barra roja 3px) + cablear reorder ya existente en backend.
- **Tab Reglas** (slider %, timer global, toggle aleatorizar ya persiste, banner "vista del guardia").
- **Tab Resultados por curso** (llamar `loadReport` con `courseId`, fila expandible con sello, pill versión, "Ver perfil →").
- **Asistente Nuevo curso** (3 pasos + LÍNEA DE SERVICIO + plantilla).
- **Anuncios** (`Announcement` + rutas + tab compositor/lista).
- **Tab Ajustes** (prerrequisito, drip, certificado+Diseñar, intentos, inscripción auto/asignación).

### FASE 4 — Admin P0 (Centro de Operaciones de gobierno)
**Objetivo:** el admin aterriza en un tablero, opera con auditoría y cierra la simulación de invitación.
- **Shell Ops-Center**: sidebar de 3 secciones (OPERACIÓN/PERSONAS/INTELIGENCIA), keyline rojo, badges; topbar con EN VIVO + reloj + campana + buscador global.
- **Componentes operativos** (KPI card alert, EN VIVO pulse, status pills mono, tabla operativa).
- **AuditEvent** + helper `logAdminAction` cableado en todas las mutaciones (base de la Bitácora).
- **Tablero** (4 KPI + 1 alert, cumplimiento por línea/sede, catálogo, bitácora 24h); cambiar landing del admin.
- **Invitar usuario** (wizard 3 pasos + estado `INVITED` real + correo de activación + aceptación pública) — corrige la única simulación.
- **Inscripciones** tabla maestra global + acciones masivas (`origin`, `expiresAt`, estado "Vencido").
- **Notificaciones in-app** (campana + bandeja).

### FASE 5 — Admin P1 + Instructor P2 (profundidad de gobierno y autoría)
- Admin: **Bitácora**, **Nueva inscripción** (wizard + roster, evento `ENROLLMENT_ASSIGNED` + copia RH), **Ficha de usuario/expediente** (lectura, con gamificación), **Directorio**, **Resultados con sello + Ver perfil**, **Reportes hub + Exportar 2 pasos**, **Reglas de notificación** (destinatarios tipados, in-app, toggle, plantilla), **Catálogo card grid**, **Anuncio global**.
- Instructor: **Vista previa del guardia** (WYSIWYG móvil), **Editor de clase** (formato/duración/dropzone MP4), **Detalle de colaborador**, **Modal Asignar**, **Modal Exportar** (scope + nombre `TSC_{curso}_{scope}`).

### FASE 6 — Pulido P2 transversal
- Estudiante: anuncios del instructor para el guardia + campana, racha real, toasts gamificados.
- Instructor: temporizador por pregunta, tipo OPEN_ENDED + bandeja de calificación manual, pulido de glifos.
- Admin: Indicadores (analítica/sparklines), Ajustes de plataforma (catálogos sede/línea, políticas, diseñador diploma), gamificación configurable, inventario `/inventory/features`, patrón Ops-Center para Reporte.
- Fundaciones: indicadores de progreso rojo/verde + segmentados, sitio corporativo público sticky (opcional, menos load-bearing).

---

## 4. Detalle por pista

### 4.1 Estudiante (Guardia)
La pista mejor posicionada: **0 simulaciones, 9 reales**. El núcleo LMS (login, catálogo, lecciones, examen al 80%, diploma real con PDF, reseñas, perfil, toasts, tema) ya persiste. Lo ausente es **la capa gamificada "carrera del guardia"** y la cáscara móvil dark-first.

Principio: **montar la gamificación ENCIMA del LMS real**, derivándola de eventos verdaderos y persistiéndola en Postgres (no localStorage como el proto). Reusar agresivamente los modelos `Achievement*` ya migrados (hoy código muerto).

Work items P0: tokens guardia (M), shell móvil (L), ledger XP (M), rangos + `/me/progress` (M), otorgar XP en eventos reales + ascenso (M), insignias (M), Tab RANGO (L).
Work items P1: login ACCESO OPERATIVO (S), prerrequisitos (M), Tab CURSOS (M), detalle con bloqueo secuencial (M), examen stepper (L), resultado + reclamar diploma (M), reproductor +10 XP (S), Tab LOGROS (M), employeeCode (S).
Work items P2: Tab PERFIL gamificado (S), anuncios para guardia + modelo (L), pantalla anuncios + campana (M), racha real (M), toasts gamificados (S).

### 4.2 Instructor — Consola de Instructor
**0 simulaciones, 3 reales, 10 parciales, 5 inexistentes.** Los CRUD de curso/módulo/clase/examen/pregunta (7 tipos adaptativos), subida de archivos, inscripción, reporte y exportación Excel/PDF **funcionan de verdad**. El trabajo es **re-encuadrar en el shell canónico** y **construir la interacción-firma inexistente**: versionado v→v+1 + sello inmutable por intento.

Lo más grave (inexistente, no simulación): **versionado + sello de evaluación** (sin campos `version`/`seal` en schema; `reports.ts` evalúa contra la regla viva). También inexistentes: vista previa del guardia, anuncios, asistente 3 pasos completo, modales de publicar/asignar/exportar.

Work items P0: tokens DS (L), primitiva Modal/Wizard (M), shell de curso 6 tabs (L), backend versionado+sello (L), modal Publicar (M).
Work items P1: builder 2 paneles + reorder (L), tab Reglas (M), tab Resultados por curso + sello (M), Anuncios modelo+API+tab (M), tab Ajustes (L), asistente Nuevo curso (M), vista previa guardia (M).
Work items P2: editor de clase formato/duración/MP4 (M), detalle de colaborador (M), modal Asignar (M), modal Exportar scope+nombre (M), perfil con métricas (M), temporizador por pregunta (M), OPEN_ENDED + calificación manual (M), pulido glifos→Lucide (S).

### 4.3 Administrador — Centro de Operaciones de Gobierno
**1 simulación (la peor), 1 real, 10 parciales, 11 inexistentes** — la pista menos construida. No hay prototipo dedicado: la IA se deriva del kit Ops-Center (DesignSync) + patrones del instructor.

Punto de partida real a proteger: usuarios/roles, inscribir/revocar por curso, reporte Excel/PDF, reglas de correo SMTP con copia a RH. El plan **envuelve** ese núcleo en el shell Ops-Center y cierra huecos.

Simulación a corregir: **invitación de usuario** (`INVITED` cableado pero inalcanzable; crear fija `ACTIVE` sin correo).
Inexistentes alta severidad: **Tablero**, **Ficha/expediente**, **Inscripciones tabla maestra**, **versionado/sello**, **Bitácora**.

Work items P0: dark-first (L), shell Ops-Center sidebar+topbar (L), componentes operativos (M), AuditEvent + logAdminAction (M), Tablero (M), Invitar usuario wizard + INVITED real (M), Inscripciones tabla maestra (L), Notificaciones in-app (M).
Work items P1: Bitácora (S), Nueva inscripción wizard+roster (M), Ficha/expediente (M), Directorio (S), versionado+sello (L, compartido con instructor), Resultados con sello (M), Reportes hub+Exportar (M), Reglas notificación upgrade (M), Catálogo card grid (M), Anuncio global (M).
Work items P2: Indicadores (M), Ajustes de plataforma (L), gamificación configurable (M), inventario features (S).

### 4.4 Fundaciones — Shell, IA, Tema, Design System
**0 simulaciones, 1 real, 12 parciales, 7 inexistentes.** La plomería del shell es real (auth, tema persistido, verificación de folio). Los problemas son **estructurales y de marca**: tema invertido, tokens ausentes en `main`, shell único colapsado.

Worst findings:
- **Dark-first INVERTIDO**: `:root` es claro; usuario nuevo nunca ve el centro de operaciones oscuro. (`globals.css:2,72`; `page.tsx:221`; `layout.tsx:20`)
- **Design-system canónico ausente de `main`**: solo en rama sin fusionar que declara "Light is the default". `main` sigue con navy `#131a33` + granate `#8c1713` + Inter.
- **Status pills cosméticas** (Hanken 800, sin punto 7px, sin `tsc-pulse`).
- **Iconos prohibidos** (emoji + unicode de orden).
- **Shell móvil del guardia y sitio público INEXISTENTES**; móvil = drawer del sidebar desktop.

Work items: ver sección 2 (F1–F8) + progreso rojo/verde (P2), Ops-Center para Reporte admin (P2), sitio corporativo público (P2, opcional), gamificación V3 (P2, requiere backend — no falsear).

---

## 5. Tabla maestra de dependencias (camino crítico)

```
F1 tokens ──┬─► F2 invertir tema ──► F3 light en diplomas
            ├─► F4 componentes ──┬─► F6 shell móvil ──► [Estudiante P0/P1]
            ├─► F5 iconos        └─► F7 consola instructor ──► [Instructor P0/P1]
            └────────────────────► shell Ops-Center ──► [Admin P0/P1]

Ledger XP ──► rangos /me/progress ──► otorgar XP+ascenso ──► insignias ──► Tab RANGO/LOGROS
Versionado+sello (backend) ──► Modal Publicar + Resultados con sello   [instructor ∩ admin]
AuditEvent ──► Bitácora + (toda mutación admin)
Modal/Wizard ──► Nuevo curso / Publicar / Asignar / Exportar / Invitar
```

**Compartidos entre pistas (hacer una sola vez):** tokens DS, primitiva Modal/Wizard, versionado+sello (instructor y admin), modelo Announcement (instructor y admin/guardia), Ficha de usuario (admin lee gamificación del guardia).

---

## 6. Preguntas abiertas (requieren decisión del usuario)

1. **✅ RESUELTO (2026-07-14): gamificación REAL (ledger en BD).** El usuario aprobó construir XP/rango/insignias derivados de eventos verdaderos, reusando los modelos `Achievement*` + `User.level` ya existentes. NO cosmético. Entra en Estudiante P0.
2. **✅ RESUELTO (2026-07-14): versionado + sello inmutable SÍ, como P1.** `Course.version` + snapshot de reglas por intento; el histórico se evalúa contra la regla con que se aprobó. Compartido instructor∩admin. Requiere migración de BD + tocar `reports.ts`.
3. **Recompensa de XP inconsistente:** el proto dice +150 en hero y +240 al diploma. El plan unifica a **+240**. ¿Correcto?
4. **Alcance del wizard móvil del guardia:** ¿solo V1 (Inicio·Cursos·Diplomas·Perfil) o también las variantes V3 gamificado (Rango·Logros), V4 táctico (Tablero), V5 sendero (Ruta)? V1 ya es usable con datos reales; V3+ requiere backend de XP.
5. **LÍNEA DE SERVICIO (chips del wizard Nuevo curso):** confirmados "Protección ejecutiva", "Custodia de mercancía", "Seguridad intramuros"; **sin confirmar** "Consultoría" y "Monitoreo". ¿Cuáles son las líneas oficiales?
6. **Tipo de pregunta abierta (OPEN_ENDED):** existe en backend, no en UI. ¿Se expone con bandeja de calificación manual, o se deja fuera?
7. **Canal de notificaciones in-app:** el plan asume Correo + In-app. ¿WhatsApp es canal de notificación o queda reservado solo a contacto (verde WA)?
8. **Sitio corporativo público:** ¿está dentro del alcance del LMS o es producto aparte? (Marcado P2 opcional.)
9. **Invitación por correo:** ¿se quiere flujo real de invitación (token + activación pública), o basta crear cuentas activas con contraseña fijada por admin? *(Define si la "simulación" se corrige o se documenta como diseño.)*
10. **Racha (streak):** ¿se calcula en servidor (requiere `lastActiveDate`/`currentStreak`) o se omite del MVP?
11. **Reordenamiento en builder:** el backend ya soporta `reorderModule/reorderLesson`. ¿Drag-and-drop o flechas?
12. **Migración de la rama rebrand:** ¿se acepta el cherry-pick de tokens+fuentes (descartando su dirección de tema), o se prefiere fusionarla y corregir encima? → RESUELTO: se hizo cherry-pick de valores + inversión a dark-first (no se fusionó la rama vieja).

---

## 7. Estado de implementación (noche del 2026-07-14)

Rama `redesign/dark-first-flows`: 14 commits sobre `main` (11 de construcción + `1369f73` doc §7 + `3d71d31` fix videos + `9beab60` test de ascenso). **Sin push, sin deploy** (el VPS está compartido con producción y no se tocó). Todo verificado en local.

### Construido y verificado
- **Fase 0 dark-first**: tokens escala ink + rojo `#A82431`, fuentes Saira/Hanken/Plex, tema invertido (oscuro por defecto, claro como variante), biblioteca de componentes al spec, iconos Lucide. Arreglado un bug de contraste (botones con texto invisible en oscuro).
- **Estudiante (guardia)**: app móvil "carrera del guardia" real. Cáscara móvil (barra de identidad + tabbar inferior de 4), tabs Rango/Cursos/Logros/Perfil, gamificación real (XP/rangos/insignias sobre el motor existente, endpoints `/me/progress` y `/me/badges`), toasts de XP y ascenso. Sobre el LMS real (login, catálogo, lecciones, examen calificado en servidor, diploma).
- **Instructor**: consola de marca (topbar + navtabs, sin sidebar). Conteos reales (arreglado "0 secciones", era mismatch `counts` vs `_count`). Versionado de curso (sube al publicar). Sello de evaluación inmutable (el histórico se califica contra la regla congelada del intento).
- **Admin**: Centro de Operaciones (sidebar por secciones + topbar EN VIVO/reloj/campana/buscador). Tablero con KPIs reales (`/admin/overview`). Invitación real (arreglada la única simulación: `INVITED` + token + activación pública). Bitácora de auditoría (`AuditEvent`).
- **PWA** instalable (manifest + service worker + iconos de marca, favicon arreglado) + guía `docs/PLAY_STORE.md`.
- **Infra**: entorno local (Postgres nativo :5433), seed idempotente (`pnpm db:seed`), E2E Playwright (`pnpm e2e`).

Verificación: **46 tests de API verde** (corridos de nuevo a mano), **e2e 10/10 verde**, build web+api verde, QA visual por captura de las pantallas clave de cada rol.

### Continuación y re-verificación de primera mano (2026-07-14, tras reinicios de la laptop)
Trabajo en trozos pequeños y commiteados uno por uno para resistir bloqueos del equipo. Re-verificación directa sobre la build real (no reportes de terceros):
- **Arreglado hueco real**: los TRES videos del seed tenían ids de YouTube ficticios que no reproducían (rompía "ver la clase" en cualquier curso). Reemplazados por videos reales embebibles verificados con oEmbed (200) y confirmados VISUALMENTE en la app: la lección del guardia carga `youtube.com/embed/kWsZrtGFip0` (captura en `tmp-qa/guardia-video-FIXED.png`).
- **Ascenso de rango blindado**: extraída `detectAscension()` pura (antes duplicada inline en las rutas de curso y diploma) y cubierta con 6 casos (cruce de umbral, umbral exacto, no-ascenso). Suite 46/46.
- **Falsa alarma descartada**: el "+ Administrador / + Instructor" en Colaboradores son botones para AGREGAR rol, no roles asignados; el backend devuelve los roles reales. No es bug.
- Confirmado de primera mano por captura: guardia gamificado (Rango 460 XP), instructor con conteos reales + versión V1, admin con invitación real (usuario INVITADO + enlace de activación de 7 días). Log de API limpio (200/204, cero 500).

### Decisiones autónomas tomadas (delegadas por el usuario "cualquier decisión que dependa de mí, tómala tú")
Gamificación real; versionado + sello P1; XP +10 lección / +240 diploma; `employeeCode` añadido al esquema; líneas de servicio = chips del diseño; reordenar con flechas Lucide; App Router diferido (no necesario para empaquetar); sitio corporativo fuera de alcance; instalado Postgres nativo para dev (no había Docker, reversible).

### Pendientes menores (no bloquean uso)
Tab "Anuncios" del instructor es placeholder honesto ("En construcción", sin backend) - decisión de producto pendiente (dejar/ocultar/construir); reporte del admin en Ops es versión lean; docs descriptivos (OPERATIONS/API_RUNTIME) sin actualizar (se hará al cutover); instalabilidad PWA verificada por assets/criterios, no por Lighthouse. (Resueltos: los 3 videos ficticios del seed y el test de ascenso.) **NO es bug** (verificado): el "solape" de la tabbar sobre el video en las capturas era artefacto de Playwright con `position: fixed` en screenshot full-page; el CSS despeja bien (`.guard-scroll` padding-bottom 104px vs tabbar ~71px). No tocar.

### Cómo probarlo en local
BD: `bash ~/.local/share/tsc-capacita-localpg-start.sh` (Postgres :5433). App: `pnpm dev` (web :3000, api :4000). Login: `guardia@tsc.local` / `instructor@tsc.local` / `admin@tsc.local`, password `Capacita2026!`. Pruebas: `pnpm e2e`. Re-sembrar: `pnpm db:seed`.

### Siguientes pasos (requieren decisión/credenciales del usuario)
1. Revisar la rama (local, o desplegando un preview NO-prod).
2. Deploy/cutover a producción con su visto bueno (no se tocó prod para proteger a los usuarios vivos).
3. Play Store: desplegar el origen HTTPS, luego TWA/Bubblewrap con su keystore + Play Console (ver `docs/PLAY_STORE.md`; la máquina ya tiene Android SDK + JDK).

---

## 8. Estado tras Olas 1 y 2 (implementado)

> Registro descriptivo del cierre real (2026-07-17). La §7 queda como historia; esta sección refleja el estado tras las dos olas. Rama `redesign/dark-first-flows`, **sin push ni deploy** (el VPS está compartido con producción). Todo verificado en local.

### Ola 1 — flujos usables sin huecos (commit `bf6a271`)
Se cerraron los huecos que dejaban a cada rol a medias, sobre el motor real:
- **Guardia**: el resultado del examen **persiste** (ya no se pierde al recargar); se **conserva la lección activa** al volver al curso; **acceso directo al diploma** ya emitido (Ver diploma / Descargar PDF, sin "Reclamar" cuando ya existe); reseñas **null-safe** con **prefill** de la reseña propia; **reproductor de video multi-proveedor** (YouTube/Vimeo/MP4).
- **Instructor**: **reordenar** secciones/clases cableado de punta a punta; **resultados por `courseId`**; copy **honesto** al publicar; toggle **"aleatorizar preguntas"** persiste; `OPEN_ENDED` **excluido** del builder.
- **Admin**: topbar **EN VIVO** con polling real; sección **"Correos automáticos"** con copy honesto; **observabilidad de SMTP**.
- **API**: correo de diploma al alumno **condicional a que tenga email**; **emisión atómica** de certificado + `unique` (sin folios duplicados en carreras); reseña `unique` + `viewerReview`; `/auth/google` responde **503** cuando no está configurado (no 500); **guarda de entorno** en el seed; enum de storage **recortado a `local`**; **FK de thumbnail** con `SetNull`.

### Ola 2 — el diseño materializado (los dos shells + gobierno)
- **A — esquema + gating** (`5b1b88f`): fundaciones de datos para prerrequisitos, versión/sello y gamificación.
- **B — APIs de feature** (`cc00d2b`): anuncios, notificaciones in-app, video firmado, plantillas de certificado, expediente, padrón.
- **C — guardia gated + enriquecido** (`3af129d`): temario con **candados** (prerrequisito duro), examen **stepper**, acceso a **diplomas**, **racha**, **campana in-app**, **video firmado**.
- **D — consola del instructor completa** (`dc45d60`): primitiva **Modal/Wizard**, **compositor de anuncios**, ajustes de prerrequisito/certificado, **asistente Nuevo curso** de 3 pasos, **editor de clase** (formato/duración/MP4), **builder de 2 paneles**, **vista previa** del guardia, **diseñador de plantilla de certificado**.
- **E — Centro de Operaciones de gobierno** (`f783b6d`): **tablero** (alerta + cumplimiento + catálogo + bitácora 24 h), **expediente 360** del colaborador, **padrón maestro** + acciones masivas + estado **"Vencido"**, **campana in-app**, **anuncio global**, **diseñador de certificado**, **directorio**. `Course.serviceLine` + `/admin/overview` extendido.

### Cierre de Fase F (2026-07-17)
- **Bitácora del anuncio**: publicar un anuncio (de curso o global) ahora deja rastro (`ANNOUNCEMENT_PUBLISHED`) en la Bitácora, igual que el resto de las mutaciones admin (`apps/api/src/routes/announcements.ts`, `lib/audit.ts`, etiqueta ES en `opsCenter.tsx`).
- **Línea de servicio como campo propio**: el asistente Nuevo curso guarda `serviceLine` en su campo (`Course.serviceLine`), ya **no como texto embebido en la descripción** (`teacherConsole.tsx`).
- **E2E endurecidos**: autenticación por **`storageState`** (login por API una vez por rol en el `global-setup`, sesión sembrada en `localStorage`), eliminando la mitigación por reintento + espera de 12 s contra el rate-limit de `/auth/login`. El tope global del API (300/min) se hizo configurable (`RATE_LIMIT_MAX`, default **300** = producción intacta) y se **eleva solo en el servidor de e2e**, porque la suite emite todo su tráfico desde una sola IP en ~90 s y, si no, roza ese límite y produce 429 ajenos a lo verificado.

### Decisiones tomadas
- Prerrequisitos = bloqueo **DURO** (no se puede iniciar sin cumplirlos).
- Versionado = **sello del examen** (regla de evaluación congelada por intento) + **contador de versión**; el **temario NO se congela**.
- **Racha (streak) construida** (server-side).
- **Diseñador de plantilla de certificado admin-owned**.
- `OPEN_ENDED` **excluido** (no se usa en prod).
- Correo de diploma **condicional** a que el alumno tenga email.

### Decisiones de producto pendientes (no bloquean)
- **Correo masivo de anuncios**: hoy los anuncios solo siembran la **bandeja in-app**; el envío por correo a todos los destinatarios queda pendiente de decisión.
- **Fondo custom de la plantilla de certificado**: hoy aplica en el **HTML**; el **PDF conserva el fondo empaquetado local**.
- **Cumplimiento y vencimiento**: una inscripción `COMPLETED` cuyo `expiresAt` ya pasó **cuenta como cumplida** (conserva su formación aprobada), no como vencida.

### Verificación (corrida completa del 2026-07-17, en local)
- **typecheck**: 0 errores (todos los paquetes).
- **Pruebas de API**: **139/139** verdes.
- **build** (web + api + paquetes): verde.
- **e2e** (Playwright): **29/29** verdes.
- Sin push ni deploy (VPS compartido con producción).

## 9. Auditoría de completitud y cierre de huecos (2026-07-17, misma rama)

> Auditoría adversarial de 5 agentes (guardia, instructor, admin, backend, transversal) que rastreó cada botón hasta endpoint y persistencia, más 3 unidades de arreglo y revisión independiente. Veredicto de la auditoría: **cero maquetas o simulaciones**, todo persiste; los hallazgos fueron huecos lógicos reales, ya cerrados.

### Bloqueante corregido
- **Aprobar el examen final nunca transitaba la inscripción a COMPLETED** (el submit del examen no recomputaba la finalización): el diploma era inalcanzable por el flujo normal y el guardia veía para siempre "Aprueba el examen para obtener tu diploma". Ahora `recomputeCourseCompletion` (`apps/api/src/lib/course-progress.ts`, extraída de courses.ts sin duplicación) corre al aprobar, con notificación, insignias y XP. Cubierto por e2e nuevo `guardia-diploma.spec.ts` (aprobar, reclamar diploma, +240 XP).

### Degradantes corregidos
- Cuenta INVITED ya no puede "activarse" a un estado inutilizable (409 sin credenciales, directo o en dos pasos); el admin ve "Reenviar invitación" en vez de "Reactivar".
- Curso ARCHIVED visible para su dueño y admin (banner de estado, pestañas funcionales); estudiantes lo siguen sin ver.
- Exámenes DRAFT ya no son visibles ni presentables por estudiantes; chips Borrador/Publicado en la consola; el reporte solo evalúa contra exámenes publicados; despublicar o borrar el último examen publicado recomputa la finalización de los alumnos al 100%.
- "Siguiente" del lector respeta lecciones bloqueadas; revocar inscripción pide confirmación; refresh de XP e insignias al aprobar examen sin recargar.
- Errores alcanzables por usuarios traducidos al español (API) y errores de validación legibles (ya no "HTTP 400"); fetch sueltos enrutados por el manejo central de 401.
- Instructor ve y asigna la plantilla de certificado de su curso (lista de solo lectura); el diseñador sigue siendo admin.
- Reglas de correo con editar, activar/desactivar y eliminar; "Procesar pendientes" reporta enviados/fallidos reales.
- Exports (Excel y PDF) coinciden con lo visible: filtro `q` y estado server-side, summary recalculado sobre filas filtradas.
- Padrón: filtro de origen estable con sentinela `none` para altas nativas; colaboradores con filtro por estado.
- Limpieza de huérfanos: blobs y filas de Asset al borrar curso/clase (conservando portadas reutilizadas), avisos in-app al borrar anuncio global; creación de anuncios transaccional.
- El PDF del diploma respeta el `backgroundUrl` de la plantilla (fail-soft al fondo por defecto). Esto resuelve la decisión pendiente de §8 "Fondo custom de la plantilla".
- `serviceLine` editable en el editor y expuesto en el detalle del curso.
- Seed: clase con documento PDF descargable real y anuncio global con aviso in-app del guardia. README con `pnpm db:seed` y credenciales demo; `.env.example` documenta Google login y `JWT_EXPIRES_IN`; scripts de reset con guarda anti-producción probada.
- E2E sin residuos: email de invitación fijo y limpieza `reset-qa-residues` en el global-setup (purgados 22 usuarios y 7 anuncios QA históricos de la BD local).

### Sin acción (documentado)
- Enums muertos `AttemptStatus.SUBMITTED`/`VOIDED`; endpoints sin consumidor `GET /quizzes/attempts/:id` y `/inventory/features`; imágenes públicas por assetId (decisión previa); emails `@tsc.local` del seed rebotarían si se enciende SMTP en demo.
- Carrera teórica de doble notificación de finalización (paridad con el patrón preexistente) y fetch de fondo de plantilla limitado a admins.
- Decisiones de producto abiertas: correo masivo de anuncios (sigue solo in-app) y gestión admin de diplomas (emitir/revocar quedó fuera de alcance según backlog). Borrar un anuncio de curso conserva sus avisos in-app (asimetría deliberada, revisable).

### Verificación final (2026-07-17)
- typecheck monorepo: 0 errores. API: **198/198** tests. Build web: verde. Seed idempotente. **e2e: 30/30** (incluye el spec nuevo de diploma). Revisión independiente: APROBADO_CON_OBSERVACIONES, todas las observaciones importantes y menores corregidas y re-verificadas. Sin push ni deploy.
