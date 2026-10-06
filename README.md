# Mini App Innovatón · Espacio IDI + Educai

Web mobile-first que opera el Innovatón de punta a punta. El participante descubre una hipótesis de aporte, elige desafío, se inscribe, vuelve, hace check-in, recibe startup, equipo y mesa, reflexiona y recibe una interpretación con un próximo experimento. El staff controla registros y presentes, arma y publica equipos, resuelve latecomers, registra el A3 y las evaluaciones y descarga respaldos para seguir en papel si hace falta.

**Deployment:** pendiente del único paso manual descrito en [Deploy](#deploy). Al completarlo, la URL queda en esta línea: `https://<proyecto>.vercel.app`.

## Documentación

- [00 — Visión y principios](docs/innovaton/00-vision.md)
- [01 — PRD funcional](docs/innovaton/01-functional-prd.md)
- [02 — Especificación técnica](docs/innovaton/02-technical-spec.md)
- [03 — Operación presencial](docs/innovaton/03-operations.md)
- [04 — Briefs de startups](docs/innovaton/04-startup-briefs.md)
- [05 — Evidencia, interpretación y recomendación](docs/innovaton/05-evidence-interpretation.md)
- [06 — Plan de implementación](docs/innovaton/06-build-plan.md)
- [07 — Decisiones de implementación](docs/innovaton/07-implementation-decisions.md): qué se adaptó de la spec y por qué.

El loop central sigue siendo Experiencia → Evidencia → Interpretación → Recomendación → Nueva experiencia. El cuestionario inicial genera una **hipótesis**; la experiencia genera la **evidencia**.

## Correr localmente

Requisitos: Node 20.9+ (probado con 22), pnpm 10 y PostgreSQL 14+.

```bash
pnpm install
cp .env.example .env            # completar DATABASE_URL, ADMIN_EMAIL y ADMIN_PASSWORD
createdb innovaton              # o la base que indique DATABASE_URL
pnpm db:migrate                 # crea las tablas
pnpm db:seed                    # crea la cuenta ADMIN y el evento DEMO con 6 desafíos ficticios
pnpm dev                        # http://localhost:3000
```

- Participante: `http://localhost:3000` redirige al evento activo (`/e/innovaton-demo`).
- Staff: `http://localhost:3000/staff/login` con `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Ensayo con gente simulada: `pnpm db:simulate 40` crea el evento `innovaton-simulacion` con 40 inscriptos (la mayoría presentes) en fase de matching.

### Calidad

```bash
pnpm lint         # ESLint
pnpm typecheck    # tipos de rutas de Next + tsc
pnpm test         # 550+ tests unitarios y de integración (requiere la base innovaton_test, ver .env.test)
pnpm test:e2e     # build de producción + Playwright en viewport móvil (base innovaton_e2e)
```

Las bases de prueba se crean una vez con `createdb innovaton_test` y `createdb innovaton_e2e` (usuario y clave `innovaton`, ver `.env.test` y `playwright.config.ts`).

## Arquitectura

```
Participante (celular) ──┐
                         ├─► Next.js 16 (App Router, Vercel)
Staff / founders ────────┘     ├─ Server Components (pantallas)
                               ├─ Server Actions (mutaciones, validadas con Zod)
                               ├─ Route Handlers (polling, .ics, CSV, backup, fotos A3, health)
                               └─ Dominio puro: matching, cuestionario, Evidence / Interpretation /
                                  Recommendation Engine
                                        │
                                   PostgreSQL (Drizzle ORM): datos + fotos del A3 (bytea)
```

| Capa | Carpeta | Qué contiene |
|---|---|---|
| Dominio puro | `src/lib/domain` | Reglas de negocio sin DB ni React: matching (§13–§18), cuestionario y desempate, evidencia, interpretación, recomendación, teléfono, calendario, CSV, router de pasos. |
| Servicios | `src/lib/services` | Acceso a la base, transacciones, locks por evento (`pg_advisory_xact_lock`) e idempotencia. |
| Actions | `src/actions` | Server Actions: sesión, validación Zod, llamada al servicio. |
| UI | `src/app`, `src/components` | Pantallas del participante (`/e/[slug]/…`) y del staff (`/staff/…`). |
| Base | `src/lib/db/schema.ts`, `drizzle/` | Esquema y migraciones SQL. |

Principios que el código respeta y los tests verifican:

- El matching usa solo personas presentes (CHECKED_IN), es determinístico y no se regenera después de publicar.
- El cuestionario nunca crea evidencia.
- La evidencia grupal (score del founder, A3) solo suma a una capacidad cuando la persona tiene evidencia individual de esa capacidad.
- Ausencia de evidencia ≠ ausencia de capacidad: al participante nunca se le muestran porcentajes ni "debilidades".
- Doble tap, refresh, dos staff a la vez y conexión lenta no duplican datos ni rompen el flujo.

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | sí | Postgres. En Neon/Supabase usar la URL con pooler. La URL de Neon se usa tal cual: el parámetro `channel_binding`, que el driver no soporta, se descarta al conectar. |
| `MIGRATION_DATABASE_URL` | no | URL directa para migraciones. Si falta se usa `DATABASE_URL_UNPOOLED` (la crea Neon) o `DATABASE_URL`. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | sí (primer deploy) | Cuenta ADMIN que crea el seed si no existe. No pisa contraseñas existentes. La contraseña necesita 8 caracteres o más (si no, el build falla con un mensaje claro) y tiene que ser propia, nunca el valor de ejemplo de `.env.example`, que es público. |
| `ADMIN_NAME` | no | Nombre visible de esa cuenta. |
| `DEFAULT_EVENT_SLUG` | no (recomendada el día del evento) | Evento al que redirige `/` (la URL corta del QR). Si falta, se usa el evento abierto con inicio más tardío, que puede ser el DEMO. |
| `SEED_DEMO` | no | `false` para no crear el evento DEMO. Por defecto se crea, sirve para ensayar en producción y no se vuelve a crear si después se cierra. |
| `DEMO_EVENT_DATE` | no | Fecha del evento DEMO (`YYYY-MM-DD`). |
| `DEFAULT_PHONE_COUNTRY` | no | País para normalizar WhatsApp (por defecto `AR`). |
| `PUBLIC_BASE_URL` | recomendada en producción | URL pública para el QR imprimible, por ejemplo `https://<proyecto>.vercel.app`. Si falta, el QR usa el dominio desde el que se abrió **Imprimir**, y un dominio de preview de Vercel puede pedir login a los participantes. |

## Operación

### Crear un evento

1. Entrar a `/staff` con una cuenta ADMIN.
2. Completar **Nuevo evento**: nombre, identificador de URL (queda `/e/<identificador>`), fecha, lugar y horarios (abre inscripción, check-in 14:20, cierre 14:25, inicio 14:30, fin). Opcional: link a la comunidad de Espacio IDI, que se muestra después del CTA final.
3. El evento nace en **Borrador**. Para usarlo como URL corta del QR, poner su identificador en `DEFAULT_EVENT_SLUG`, o imprimir el QR de la pestaña **Imprimir**, que apunta directo a `/e/<identificador>`.

### Cargar desafíos

En el evento, pestaña **Configuración** (solo ADMIN): cada desafío lleva startup, descripción breve, desafío (formato "¿Cómo podríamos…?"), brief completo, premio opcional, orden y activo. Para pasar de DEMO a real, desactivar o borrar los desafíos `DEMO ·` y cargar los briefs validados según [04-startup-briefs.md](docs/innovaton/04-startup-briefs.md). No hace falta tocar código. Un desafío que alguien ya eligió no se puede borrar, solo desactivar.

### Dashboard y día del evento

`/staff/login` → evento → pestaña **Panel**. Se actualiza solo cada 10 segundos y lo pueden usar varias personas del staff a la vez.

| Hora | Acción en la app |
|---|---|
| Antes | **Abrir inscripción**. Monitorear registrados por desafío. Imprimir la hoja del evento y el **Kit analógico** (pestaña **Imprimir**) mientras hay conexión, e iniciar sesión en los celulares del staff y de los founders. |
| 14:10–14:20 | Recordatorio por WhatsApp: tocar el teléfono de cada persona abre WhatsApp con el mensaje listo. |
| 14:15 | **Descargar CSV** (respaldo). |
| 14:20 | **Abrir check-in**. Quien se inscribe desde ahora queda presente automáticamente. Check-in manual con el buscador; **Alta rápida** para quien no tiene celular, con su modo E/C/I si hizo el cuestionario en papel. |
| 14:25 | **Cerrar inscripción**. Descargar CSV otra vez. |
| 14:25–14:30 | Pestaña **Equipos** → **Generar equipos** (solo presentes) → revisar, mover personas, cambiar mesas → **Publicar equipos**. Cada participante ve startup, equipo y mesa en su celular. Con muy poca gente, si no se forma ningún equipo: **+ Equipo vacío** en el desafío y asignar a mano, aunque sean 1 o 2. |
| 14:30–14:40 | Latecomers: aparecen en **Equipos** con una sugerencia de un toque (equipo de 3, quinto excepcional, segunda opción, equipo nuevo con 3 compatibles). |
| Sprint y pitch | **A3 y evaluación** por equipo: foto del A3, bloques completos, Problema / Valor / Prueba, feedback, reconocimiento y contribución individual. Los founders pueden usar una cuenta STAFF y filtrar sus equipos. |
| 15:27 | **Pasar a pitch** → **Abrir reflexión**. Cada participante completa la reflexión y recibe interpretación, próximo experimento y CTA de Espacio IDI. Quien la hizo en papel o no tiene celular se carga desde **A3 y evaluación** → «Reflexión en papel», con el modo del cuestionario en papel si faltaba. |

**Cuentas y roles.** Se crean en **Cuentas** (ADMIN) o con `pnpm staff:create <email> <clave> "<nombre>" <ADMIN|STAFF>`.

- **ADMIN**: staff principal (Director/Host y Control de 03 §1). Maneja fases, matching, publicación, movimientos, mesas, respaldos con WhatsApp y configuración.
- **STAFF**: founders, facilitación y recepción. Hacen check-in, alta rápida, generan códigos para recuperar una sesión, suman latecomers con la sugerencia del tablero y cargan A3, evaluación, contribución individual y reflexión en papel. Ven los teléfonos enmascarados (`•••• 4567`) y no descargan respaldos.
- Tras 10 intentos fallidos de login la cuenta se bloquea 15 minutos (o hasta que un ADMIN le cambie la contraseña). Conviene desactivar las cuentas de founders al cerrar el evento.

**Recuperar una sesión.** Si alguien cambió de celular o se le borró la sesión, en el Panel se toca **Código para recuperar** en su fila y se le dicta el código de 6 dígitos. La persona lo ingresa con su WhatsApp en «Recuperá tu lugar». El código vence a los 15 minutos, sirve una sola vez y se invalida tras 5 intentos fallidos. El WhatsApp solo no alcanza para abrir una inscripción.

El detalle completo está en [07 — Roles y datos personales](docs/innovaton/07-implementation-decisions.md#roles-y-datos-personales).

### Backup y contingencia

- **CSV** (Panel → Descargar CSV, solo ADMIN): nombre, WhatsApp, link `wa.me`, estado, modo, desafío 1, desafío 2, presencia, hora de check-in, desafío asignado, equipo, mesa y consentimientos. Usa `;` como separador, así abre bien con doble clic en Excel en español; Google Sheets lo detecta solo. Alcanza para seguir el evento en papel.
- **Backup completo (JSON)**: todo el evento, incluidas reflexiones, evidencia e interpretaciones (sin las fotos).
- **Imprimir**: QR de inscripción, equipos por mesa, tarjetas de mesa, lista de check-in y briefs con el A3 en blanco.
- **Base completa**: `pg_dump "$DATABASE_URL" > innovaton-$(date +%F).sql` (incluye las fotos del A3). Neon también ofrece restauración a un punto en el tiempo desde su panel.

Si cae internet, el evento sigue con el kit analógico de [03-operations.md](docs/innovaton/03-operations.md) §13, que hay que imprimir antes (pestaña **Imprimir** → «Kit analógico»: cuestionario con clave E/C/I, inscripción, evaluación del founder y reflexión en papel). Con la lista de check-in impresa, que trae 1ª y 2ª opción, los equipos se arman a mano: separar por desafío, equipos de 3–4 y segunda opción para quien quede en grupos de 1–2. Los datos se cargan después: alta rápida y check-in manual, **+ Equipo vacío** y mover personas para recrear los equipos de papel sin regenerar, cambiar mesas, publicar, y cargar evaluaciones y reflexiones en papel. Si el panel pierde conexión, muestra «Sin conexión · datos de las HH:MM» y conserva lo último que vio.

## Deploy

Todo está listo para Vercel + Postgres (Neon). `vercel-build` corre migraciones, el seed idempotente y el build. `vercel.json` fija la región `gru1` (São Paulo), la más cercana a Córdoba.

**Único paso manual** (requiere una cuenta y no se puede hacer desde la sesión que construyó el MVP, porque su red no tenía acceso a las APIs de Vercel ni de Neon):

1. Mergear el PR de la rama `claude/exciting-cori-q4tu2d` a `main`. Vercel publica en producción la rama por defecto, y antes del merge `main` solo tiene los documentos.
2. En [vercel.com/new](https://vercel.com/new), importar el repositorio `tomasfossatti/Mini-App-Innovaton`. Vercel detecta Next.js y toma el build de `vercel.json`; no hace falta cambiar nada.
3. En el proyecto: **Storage → Create Database → Neon (Postgres)**, región São Paulo (`sa-east-1`), y conectarla al proyecto para todos los entornos, dejando el prefijo por defecto. Esto define `DATABASE_URL` y `DATABASE_URL_UNPOOLED`.
4. En **Settings → Environment Variables** (entorno Production), agregar:
   - `ADMIN_EMAIL`: el email de la cuenta ADMIN.
   - `ADMIN_PASSWORD`: una contraseña propia de 8 caracteres o más.
   - `PUBLIC_BASE_URL`: el dominio de producción, `https://<proyecto>.vercel.app` (o el dominio propio si se configura uno).
5. **Deploy** (o **Redeploy** si el primer build corrió antes de conectar la base). El log del build muestra `[migrate] OK` y `[seed] ADMIN creado`.
6. Verificar `https://<proyecto>.vercel.app/api/health` → `{"ok":true,"db":"up"}`, entrar a `/staff/login` con la cuenta ADMIN y anotar la URL en la línea «Deployment» de este README.

Antes del evento real: crear el evento y cargar los desafíos (ver [Operación](#operación)), agregar `DEFAULT_EVENT_SLUG=<identificador del evento>` y hacer **Redeploy** (Vercel aplica las variables en el deploy siguiente), y pasar el evento DEMO a **Cerrado** si se usó para ensayar.

Supabase funciona igual: alcanza con usar su connection string con pooler como `DATABASE_URL`.

## Limitaciones conocidas

- **Personas que el matching no ubica.** El matching no arma equipos de menos de 3 y, en casos raros, la consolidación deja a alguien sin equipo. Nadie se pierde: aparece en **Presentes sin equipo** con su 1ª y 2ª opción, y el ADMIN lo asigna a mano. Con muy poca gente, aunque no se haya formado ningún equipo, **+ Equipo vacío** permite armar uno de 1 o 2 personas y publicarlo; el tablero avisa que es chico.
- **Bloqueo de login.** Diez intentos fallidos bloquean la cuenta 15 minutos, aunque después se use la contraseña correcta. Las sesiones abiertas no se ven afectadas: conviene que el staff inicie sesión antes del evento y tener dos cuentas ADMIN.

## Fuera del MVP

PWA, push, chatbot, matching con IA o ML, análisis automático del A3, reconocimiento del pitch, WhatsApp automático, portfolio Educai, recomendador profesional, rankings, networking automático y gamificación quedaron fuera a propósito (01 §30, 06).
