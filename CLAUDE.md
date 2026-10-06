@AGENTS.md

# Mini App Innovatón — convenciones del proyecto

Fuente de verdad funcional: `docs/innovaton/*.md` (no modificar 00–06). Decisiones de implementación: `docs/innovaton/07-implementation-decisions.md`.

## Stack
Next.js 16 App Router (params/cookies/searchParams son async; no hay `next lint`; `middleware` se llama `proxy`), React 19, TypeScript estricto, Tailwind 4, Drizzle + postgres-js, Zod 4, Vitest, Playwright.

## Capas (respetar la dirección de dependencias)
1. `src/lib/domain/*` — lógica PURA (sin DB, sin React, sin Next). Matching, cuestionario, evidencia, interpretación, recomendación, teléfono, calendario, CSV, copy. Toda la lógica de negocio vive acá y tiene tests unitarios en `tests/unit`.
2. `src/lib/services/*` — acceso a DB. Cada función recibe `db: DbOrTx` como primer parámetro (de `@/lib/db/client`), valida reglas de negocio y lanza `DomainError` (de `@/lib/services/errors`) con mensaje en español apto para mostrar. Operaciones de equipos usan transacción + `pg_advisory_xact_lock(hashtext(eventId))`. Todo lo que pueda repetirse por doble tap es idempotente. Tests de integración en `tests/integration` contra la base `innovaton_test` (ver `.env.test`).
3. `src/actions/*` — Server Actions (`"use server"`), wrappers finos: resuelven sesión (staff o participante), validan con Zod, llaman a services con `getDb()`, devuelven `ActionResult<T>` (`{ ok: true, data } | { ok: false, error }`) usando `runAction` de `@/actions/result`. Nunca lógica de negocio acá.
4. `src/app/*` — páginas (Server Components por defecto) y Route Handlers. `src/components/*` — UI (`ui/` primitivas, `participant/`, `staff/`).

La lógica de dominio no vive en componentes React.

## Reglas de producto que el código no puede romper
- El cuestionario genera una hipótesis (initial_mode) y NUNCA crea evidence_items.
- La evidencia de equipo (founder score, A3) solo suma a una capacidad individual si existe evidencia individual (self u observed) de esa capacidad.
- Ausencia de evidencia ≠ ausencia de capacidad: nunca mostrar "debilidades" ni porcentajes al participante.
- El matching trabaja solo con participantes CHECKED_IN. Después de publicar no se regenera (solo cambios manuales).
- Después de publicar, nunca mover miembros existentes para acomodar latecomers.

## UI
- Mobile-first, botones grandes (`min-h-14`), una decisión por pantalla, texto breve, copy en español rioplatense (voseo). Copy del PRD literal (ver `src/lib/domain/copy.ts`).
- Botones se deshabilitan mientras la acción está pendiente (tolerancia a doble tap). Errores visibles con opción de reintentar.
- Sin fuentes externas ni imágenes pesadas.

## Comandos
- `pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` (unit + integración) · `pnpm test:e2e`
- `pnpm db:generate` (tras cambiar `src/lib/db/schema.ts`) · `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:simulate`
- Postgres local: `pg_ctlcluster 16 main start`; bases `innovaton` (dev) e `innovaton_test` (tests), usuario/clave `innovaton`.
