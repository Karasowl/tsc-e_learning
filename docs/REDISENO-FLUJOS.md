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
12. **Migración de la rama rebrand:** ¿se acepta el cherry-pick de tokens+fuentes (descartando su dirección de tema), o se prefiere fusionarla y corregir encima?
