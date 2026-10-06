# 02 — Especificación técnica y arquitectura de implementación

## 1. Stack

MVP recomendado:

- Next.js App Router
- TypeScript
- Tailwind CSS
- PostgreSQL / Supabase
- Drizzle ORM
- Supabase Storage para A3
- Supabase Auth solo para staff
- Zod para validación
- Vercel para deploy

Decisiones:

- participantes sin cuenta;
- staff autenticado;
- Server Actions para mutaciones;
- Route Handlers para polling, .ics y export;
- sin WebSockets;
- sin realtime obligatorio;
- matching e interpretación determinísticos.

---

## 2. Arquitectura

~~~
PARTICIPANTE MOBILE WEB
        ↓
NEXT.JS APP
- Server Components
- Client Components
- Server Actions
- Matching Engine
- Evidence Engine
- Interpretation Engine
- Recommendation Engine
        ↓
POSTGRES / SUPABASE
        +
SUPABASE STORAGE

STAFF DASHBOARD
        ↑
        └──── misma app
~~~

---

## 3. Rutas

### Participante

- /e/[eventSlug]
- /e/[eventSlug]/clarity
- /e/[eventSlug]/assessment
- /e/[eventSlug]/result
- /e/[eventSlug]/challenges
- /e/[eventSlug]/register
- /e/[eventSlug]/status
- /e/[eventSlug]/reflection
- /e/[eventSlug]/outcome

### Staff

- /staff/login
- /staff/events/[eventId]
- /staff/events/[eventId]/teams
- /staff/events/[eventId]/teams/[teamId]

### API

- GET /api/participant/state
- GET /api/events/[eventId]/calendar.ics
- GET /api/staff/events/[eventId]/export.csv

---

## 4. Estructura sugerida

~~~
src/
├── app/
│   ├── (participant)/
│   ├── staff/
│   └── api/
├── actions/
│   ├── participant.ts
│   ├── matching.ts
│   ├── reflection.ts
│   ├── founder.ts
│   └── staff.ts
├── components/
│   ├── participant/
│   └── staff/
├── lib/
│   ├── db/
│   ├── auth/
│   ├── domain/
│   │   ├── questionnaire.ts
│   │   ├── matching.ts
│   │   ├── evidence.ts
│   │   ├── interpretation.ts
│   │   └── recommendations.ts
│   └── validation/
└── types/
~~~

---

## 5. Sesión participante

No exigir login.

Al comenzar:

1. crear participation anónima;
2. generar token aleatorio de 32 bytes;
3. guardar solo SHA256(token);
4. cookie HttpOnly, Secure, SameSite=Lax;
5. cuando deja WhatsApp, asociar con participant persistente.

La identidad persistente se resuelve por WhatsApp normalizado.

---

## 6. Estados

### event_phase

- DRAFT
- REGISTRATION
- CHECKIN
- MATCHING
- SPRINT
- PITCH
- REFLECTION
- CLOSED

### participation_status

- STARTED
- PROFILE_COMPLETED
- REGISTERED
- CHECKED_IN
- MATCHED
- EXPERIENCE_COMPLETED
- REFLECTION_COMPLETED
- INTERPRETED
- NO_SHOW

---

## 7. Esquema SQL lógico

### participants

- id UUID PK
- name text
- whatsapp_normalized text unique
- created_at
- updated_at

### events

- id UUID PK
- slug unique
- name
- timezone
- registration_opens_at
- checkin_opens_at
- registration_closes_at
- starts_at
- phase

### challenges

- id UUID PK
- event_id FK
- startup_name
- title
- description
- brief
- prize
- sort_order
- active

No usar capacity por startup.

### participations

- id UUID PK
- event_id FK
- participant_id nullable FK
- status
- resume_token_hash
- pre_clarity
- explore_score
- create_score
- drive_score
- initial_mode
- first_choice FK
- second_choice FK
- second_choice_any boolean
- operational_consent_at
- community_consent_at
- checked_in_at
- team_id nullable FK
- assignment_source
- created_at
- updated_at

### questionnaire_answers

- id UUID PK
- participation_id FK
- question_key
- selected_mode
- unique(participation_id, question_key)

### teams

- id UUID PK
- event_id FK
- challenge_id FK
- team_number
- table_number
- published_at
- unique(event_id, challenge_id, team_number)
- unique(event_id, table_number)

### reflections

- id UUID PK
- participation_id FK unique
- post_clarity
- perceived_value
- initial_mode_usefulness
- selected_actions text[]
- primary_contribution_text
- primary_capability
- created_at

### artifacts

- id UUID PK
- event_id FK
- team_id FK
- type
- storage_path
- created_at

### founder_assessments

- id UUID PK
- team_id FK unique
- problem_score 1–5
- value_score 1–5
- test_score 1–5
- feedback
- winner boolean

### evidence_items

- id UUID PK
- event_id FK
- participation_id nullable FK
- team_id nullable FK
- source_type
- scope
- raw_code
- raw_text
- source_weight numeric
- confidence numeric
- created_at

### capability_signals

- id UUID PK
- evidence_item_id FK
- capability
- strength

### interpretation_snapshots

- id UUID PK
- participation_id FK
- algorithm_version
- type
- primary_capability
- secondary_capability
- summary
- evidence_snapshot JSONB
- created_at

### recommendations

- id UUID PK
- interpretation_id FK unique
- capability
- type
- action
- rationale

### staff_members

- auth_user_id UUID PK
- role ADMIN | STAFF

---

## 8. Enums

### initial_mode
- EXPLORE
- CREATE
- DRIVE

### capability_key
- PROBLEM_UNDERSTANDING
- ASSUMPTION_QUESTIONING
- IDEATION
- PRIORITIZATION
- EXPERIMENTATION
- COMMUNICATION

### assignment_source
- FIRST_CHOICE
- SECOND_CHOICE
- ANY
- MANUAL

### evidence_scope
- INDIVIDUAL
- TEAM

### evidence_source
- SELF_REPORT_ACTION
- SELF_REFLECTION_PRIMARY
- FOUNDER_INDIVIDUAL
- FACILITATOR_OBSERVATION
- FOUNDER_TEAM_SCORE
- TEAM_ARTIFACT

### interpretation_type
- INSUFFICIENT
- ALIGNED
- DIVERGENT
- MIXED

### recommendation_type
- REPLICATE_SIGNAL
- INVESTIGATE_DIVERGENCE
- GATHER_MORE_EVIDENCE
- EXPLORE_COMPLEMENT

---

## 9. Server Actions — participante

### startParticipation(eventSlug)

- validar evento;
- comprobar registro abierto;
- crear participation;
- generar token y cookie;
- devolver siguiente ruta.

### savePreClarity(value)

- validar 1–5;
- guardar pre_clarity.

### saveQuestionAnswer(questionKey, selectedMode)

- UPSERT;
- recalcular E/C/I.

### finalizeAssessment()

- calcular modo;
- si 2–2–1 marcar desempate;
- si no, guardar initial_mode y PROFILE_COMPLETED.

### saveTieBreak(selectedMode)

- aceptar solo uno de los dos empatados.

### saveChallengeChoices(firstChoice, secondChoice?, secondChoiceAny)

- first obligatorio;
- second distinto;
- second o ANY obligatorio.

### registerParticipant(data)

- normalizar WhatsApp;
- buscar o crear participant;
- asociar participation;
- guardar consentimientos;
- status REGISTERED;
- si está entre 14:20–14:25 desde stand, CHECKED_IN.

### checkIn()

Idempotente.

- si ya está presente → success;
- si estaba registrado → CHECKED_IN + timestamp.

### submitReflection(data)

Transacción:

1. guardar reflection;
2. crear evidence_items;
3. crear capability_signals;
4. status REFLECTION_COMPLETED;
5. ejecutar interpretation engine;
6. ejecutar recommendation engine;
7. status INTERPRETED.

---

## 10. Server Actions — staff

### setEventPhase(eventId, phase)

Staff-only.

### manualCheckIn(participationId)

Staff-only.

### generateTeams(eventId)

Precondiciones:

- phase MATCHING;
- equipos no publicados.

### moveParticipant(participationId, targetTeamId)

- assignment_source = MANUAL.

### publishTeams(eventId)

Transacción:

- published_at = now en todos los teams;
- participations asignadas → MATCHED;
- event.phase → SPRINT.

### addFounderAssessment(teamId, payload)

- guarda Problema/Valor/Prueba;
- feedback;
- winner.

### addFounderObservation(participationId, capability, note)

Crea evidencia individual externa fuerte.

---

## 11. Polling participante

GET /api/participant/state

Respuesta típica:

~~~json
{
  "status": "MATCHED",
  "eventPhase": "SPRINT",
  "team": {
    "startup": "Mentium",
    "teamNumber": 2,
    "tableNumber": 5,
    "published": true
  }
}
~~~

Polling cada 5–10 segundos solo mientras espera equipo.

Detener cuando published = true.

---

## 12. Calendar endpoint

GET /api/events/:eventId/calendar.ics

Generar VEVENT con:

- título;
- 14:20;
- timezone America/Argentina/Cordoba;
- ubicación stand;
- VALARM 10 minutos antes.

Agregar también link a Google Calendar.

---

## 13. Matching — teamSizes

Pseudocódigo:

~~~
function teamSizes(n):
  if n <= 0: return []
  if n in [1,2]: return UNRESOLVED
  if n == 3: return [3]
  if n == 4: return [4]
  if n == 5: return [5]

  remainder = n % 4

  if remainder == 0:
    return [4 repeated n/4]

  if remainder == 3:
    return [3] + [4 repeated (n-3)/4]

  if remainder == 2:
    return [3,3] + [4 repeated (n-6)/4]

  if remainder == 1:
    if n == 9:
      return [3,3,3]
    return [3,3,3] + [4 repeated (n-9)/4]
~~~

Ejemplos:

- 6 → 3+3
- 7 → 3+4
- 8 → 4+4
- 9 → 3+3+3
- 10 → 3+3+4
- 11 → 3+4+4
- 12 → 4+4+4
- 13 → 3+3+3+4

---

## 14. Matching completo

~~~
function generateMatching(eventId):

  begin transaction
  acquire event advisory lock

  assert event.phase == MATCHING
  assert no published teams exist

  delete draft teams
  clear draft assignments

  participants =
    fetch CHECKED_IN participants

  groups = groupBy(first_choice)
  unresolved = []

  # first choice
  for each group:
    if size >= 3:
      keep
    else:
      unresolved += members
      remove group

  # second choice
  for p in unresolved:
    if p.second_choice:
      groups[p.second_choice].add(p)
      p.assignment_source = SECOND_CHOICE
    else if p.second_choice_any:
      anyPool.add(p)
    else:
      manualPool.add(p)

  # verify groups again
  repeat until stable:
    for group in groups:
      if size in [1,2]:
        move members to anyPool/manualPool
        delete group

  # ANY
  for p in anyPool:
    target = chooseBestExistingChallenge(groups)
    if target:
      groups[target].add(p)
      p.assignment_source = ANY
    else:
      manualPool.add(p)

  # create teams
  tableNumber = 1

  for challenge in deterministic order:
    sizes = teamSizes(size(groups[challenge]))
    teams = createEmptyTeams(sizes)
    assignMembersBalancedByMode(members, teams)

    for team:
      team.table_number = tableNumber++
      save team + assignments

  commit

  return teams + manualPool
~~~

---

## 15. ANY assignment

Elegir challenge que deje la partición más sana.

Penalty sugerida:

- solo equipos 3–4 → 0
- incluye 5 → 1
- deja 1–2 → 100

Desempate:

1. menor penalty;
2. menor cantidad total;
3. challenge id determinístico.

---

## 16. Balance por modo

Solo después de resolver desafío y tamaños.

~~~
group participants by initial_mode

for each mode group:
  for each participant:
    candidate teams = teams with capacity

    choose team by:
      sameModeCount ASC
      totalMembers ASC
      teamNumber ASC
~~~

Nunca usar modos para mover a alguien de challenge.

---

## 17. Regeneración

Permitida solo antes de publicar.

Después de published_at:

**NO REGENERAR.**

Todo cambio posterior es manual.

---

## 18. Latecomers

~~~
sameChallenge team with 3 → add as 4th

else sameChallenge team with 4
  → optional 5th with staff approval

else repeat with second_choice

else manual resolution
~~~

Nunca mover miembros existentes para acomodar latecomer.

---

## 19. Evidence Engine

Mapping:

### ASKED_QUESTIONS
- PROBLEM_UNDERSTANDING 1
- ASSUMPTION_QUESTIONING 0.5

### FOUND_ASSUMPTION
- ASSUMPTION_QUESTIONING 1

### PROPOSED_ALTERNATIVES
- IDEATION 1

### CONNECTED_IDEAS
- IDEATION 0.75
- COMMUNICATION 0.25

### HELPED_CHOOSE
- PRIORITIZATION 1

### ORGANIZED_TEAM
- PRIORITIZATION 0.75
- COMMUNICATION 0.5

### CREATED_TEST
- EXPERIMENTATION 1

### PRESENTED
- COMMUNICATION 1

---

## 20. Pesos

- SELF_REPORT_ACTION = 1
- SELF_REFLECTION_PRIMARY = 1.5
- FOUNDER_INDIVIDUAL = 3
- FACILITATOR_OBSERVATION = 2.5
- FOUNDER_TEAM_SCORE = 1.5
- TEAM_ARTIFACT = 1

El cuestionario inicial pesa 0 como evidencia.

---

## 21. Evidence scores

Para cada capacidad:

- selfScore;
- observedScore;
- teamScore.

### Self
Incluye autodeclaración y reflexión abierta.

Cap: min(rawSelfScore, 2).

### Observed
Founder individual + facilitador.

### Team
Founder score + artefactos.

Cap: min(rawTeamScore, 1.5).

La evidencia grupal solo cuenta si existe evidencia individual compatible.

Effective score:

~~~
if selfScore > 0 or observedScore > 0:
  effective = self + observed + team
else:
  effective = 0
~~~

---

## 22. Nivel de evidencia

~~~
if self == 0 and observed == 0:
  INSUFFICIENT

else if observed >= 2.5:
  CONVERGENT

else if self >= 1 and team >= 0.75:
  CONVERGENT

else if self >= 1 and observed >= 1:
  CONVERGENT

else:
  SIGNAL
~~~

---

## 23. Interpretación

Relación:

- EXPLORE → PROBLEM_UNDERSTANDING + ASSUMPTION_QUESTIONING
- CREATE → IDEATION
- DRIVE → PRIORITIZATION + EXPERIMENTATION
- COMMUNICATION → transversal

Tipos:

### ALIGNED
Primary dentro del modo inicial.

### DIVERGENT
Primary convergente fuera del modo inicial y sin convergencia relevante en el modo inicial.

### MIXED
Señales del modo inicial + otras.

### INSUFFICIENT
No hay evidencia individual suficiente.

Mostrar máximo dos capacidades.

---

## 24. Recommendation Engine

Orden:

1. DIVERGENT → INVESTIGATE_DIVERGENCE
2. primary CONVERGENT → REPLICATE_SIGNAL
3. primary SIGNAL → GATHER_MORE_EVIDENCE
4. sin señal → acción basada en modo inicial para generar evidencia

Templates:

- Problem understanding: “Antes de buscar soluciones, formulá en una frase cuál creés que es el problema real.”
- Assumption questioning: “Identificá un supuesto que el equipo esté dando por cierto y preguntá cómo podrían comprobarlo.”
- Ideation: “Generá al menos tres alternativas antes de elegir una.”
- Prioritization: “Cuando haya varias opciones, proponé un criterio y ayudá al equipo a decidir.”
- Experimentation: “Convertí una idea en la prueba más pequeña posible para aprender algo.”
- Communication: “Tomá una idea compleja del equipo e intentá explicarla claramente en menos de 30 segundos.”

---

## 25. Dashboard

Header:

- Registrados
- Presentes
- Equipos
- Reflexiones

Por challenge:

- registrados;
- presentes;
- equipos.

Acciones:

- abrir check-in;
- cerrar inscripción;
- generar equipos;
- editar;
- publicar;
- abrir reflexión;
- exportar CSV.

---

## 26. Seguridad

Participante:

- sin acceso directo a DB;
- token hash, nunca token plano;
- cookie HttpOnly + Secure + SameSite=Lax.

Staff:

- Supabase Auth;
- roles ADMIN / STAFF;
- todas las acciones verifican sesión y rol.

Storage:

- bucket privado;
- signed URLs para visualizar A3.

---

## 27. Validación

Usar Zod en todas las Server Actions.

Reflexión:

- postClarity 1–5;
- selectedActions mínimo 1;
- texto máximo 500;
- capability enum;
- perceivedValue 1–5;
- usefulness 1–5.

---

## 28. Idempotencia

- checkIn: idempotente;
- saveQuestionAnswer: UPSERT;
- submitReflection: UPSERT/transacción;
- publishTeams: si ya publicado devuelve estado actual;
- generateTeams: regenerable solo pre-publicación.

---

## 29. Concurrencia

generateTeams debe correr en transacción y lock por evento.

Postgres:

~~~
SELECT pg_advisory_xact_lock(hashtext(event_id::text));
~~~

Evita dos generaciones simultáneas.

---

## 30. Contingencia

Export CSV:

- name
- whatsapp
- status
- initial_mode
- first_choice
- second_choice
- checked_in_at
- challenge_assigned
- team_number
- table_number

El sistema debe ser reemplazable por papel sin cancelar el evento.

---

## 31. Tests críticos

Unit tests:

- teamSizes()
- generateMatching()
- balanceByMode()
- determineEvidenceLevel()
- interpretationType()
- generateRecommendation()

Escenarios:

- 1,2,3,4,5,6,7,8,9,10,11,20+ por challenge;
- todos mismo modo;
- second choice inviable;
- ANY;
- latecomer;
- doble check-in;
- doble submit;
- regenerar pre-publicación;
- bloquear regeneración post-publicación;
- founder sin score;
- sesión perdida;
- internet lento.

---

## 32. Regla arquitectónica

Mantener siempre:

~~~
PERSON
↓
EXPERIENCE
↓
PARTICIPATION
↓
EVIDENCE
↓
CAPABILITY SIGNALS
↓
INTERPRETATION
↓
RECOMMENDATION
~~~

Nunca:

~~~
PERSON
↓
PROFILE = EXPLORADOR
~~~

Explorar / Crear / Impulsar pertenece a la experiencia del Innovatón.

La arquitectura persistente de Educai es evidencia acumulada + capacidades + interpretaciones versionadas + próximas experiencias.
