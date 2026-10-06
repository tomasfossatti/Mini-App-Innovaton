# 06 — Plan de implementación

## Objetivo

Pasar de documentación a un MVP usable en el evento sin agregar funcionalidades fuera de alcance.

No continuar diseñando features antes de que el core funcione.

---

## Fase 0 — Preparación

- inicializar Next.js + TypeScript;
- Tailwind;
- Supabase/Postgres;
- Drizzle;
- variables de entorno;
- migraciones;
- seed de evento local;
- seed de challenges ficticios para desarrollo.

Criterio de salida:

> proyecto ejecuta localmente y puede leer/escribir DB.

---

## Fase 1 — Participant flow

Construir:

1. landing;
2. sesión anónima;
3. claridad inicial;
4. 5 preguntas;
5. scoring;
6. desempate;
7. resultado E/C/I;
8. challenges;
9. first + second choice;
10. nombre + WhatsApp;
11. consentimientos;
12. confirmación;
13. Google Calendar + .ics.

Criterio de salida:

> una persona puede completar el registro de punta a punta sin staff.

---

## Fase 2 — Operación

Construir:

1. auth staff;
2. dashboard;
3. métricas;
4. check-in;
5. manual check-in;
6. matching;
7. warnings;
8. edición manual;
9. mesas;
10. publicación;
11. polling participante;
12. latecomers.

Criterio de salida:

> simular 30–50 personas, formar equipos y hacer que cada una vea Startup + Equipo + Mesa.

---

## Fase 3 — Sprint output

Construir:

1. vista de equipo;
2. upload A3;
3. founder assessment;
4. winner;
5. feedback;
6. observación individual founder.

Criterio de salida:

> cada equipo puede terminar con artefacto + evaluación persistida.

---

## Fase 4 — Educai

Construir:

1. reflexión;
2. evidence_items;
3. capability_signals;
4. evidence scoring;
5. interpretation snapshot;
6. recommendation engine;
7. outcome;
8. CTA Espacio IDI.

Criterio de salida:

> cada participante que completa reflexión obtiene interpretación prudente + próximo experimento.

---

## Fase 5 — Hardening

Probar:

- 1,2 personas en challenge;
- 3–13;
- 20+;
- todos mismo modo;
- second choice inviable;
- ANY;
- latecomer;
- doble check-in;
- doble submit;
- dos staff generando matching;
- regeneración pre-publicación;
- bloqueo post-publicación;
- refresh durante espera;
- teléfono sin sesión;
- internet lento;
- founder ausente;
- founder sin score.

Agregar:

- CSV export;
- mensajes de error;
- backups;
- impresión de materiales;
- ensayo analógico.

---

## Orden técnico recomendado

### Primero funciones puras

Implementar y testear:

- teamSizes()
- balanceByMode()
- generateMatching()
- determineEvidenceLevel()
- interpretationType()
- generateRecommendation()

### Después persistencia

- schema;
- repositories;
- Server Actions;
- transactions.

### Después UI

La lógica de dominio no debe vivir dentro de componentes React.

---

## No construir

Hasta después del evento:

- PWA;
- push;
- app nativa;
- chatbot;
- análisis IA del A3;
- transcripción del pitch;
- WhatsApp automático;
- ML para matching;
- perfiles profesionales;
- recomendaciones vocacionales;
- portfolio permanente;
- rankings;
- networking automático;
- gamificación avanzada.

---

## Definition of Done global

El MVP está terminado cuando:

~~~
QR
→ cuestionario
→ hipótesis
→ desafíos
→ inscripción
→ calendario
→ check-in
→ matching
→ revisión
→ publicación
→ mesa
→ sprint
→ evidencia
→ reflexión
→ interpretación
→ recomendación
→ CTA
~~~

funciona de punta a punta y existe una contingencia manual que permite continuar el evento sin la app.
