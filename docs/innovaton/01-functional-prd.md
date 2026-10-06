# 01 — PRD funcional de la mini app

## 1. Objetivo

Construir una web mobile-first que opere el Innovatón de punta a punta:

~~~
descubrir una hipótesis de aporte
→ elegir desafío
→ registrarse
→ volver
→ hacer check-in
→ formar equipos
→ participar
→ capturar evidencia
→ interpretar
→ recomendar próxima experiencia
~~~

La app sirve a tres actores:

### Participante
- entender cómo podría aportar;
- elegir un problema real;
- registrarse y recordar volver;
- encontrar equipo y mesa;
- reflexionar sobre lo que hizo;
- recibir una interpretación y próximo experimento.

### Staff
- controlar registros y presentes;
- formar y editar equipos;
- publicar asignaciones;
- resolver latecomers;
- registrar artefactos y evaluaciones.

### Educai
- capturar evidencia contextual;
- mapearla a capacidades;
- generar interpretación provisional;
- recomendar siguiente acción;
- conservar evidencia acumulable.

---

## 2. Principios

1. Experiencia presencial > celular.
2. Tecnología organiza, no protagoniza.
3. El cuestionario genera hipótesis, no diagnóstico.
4. La experiencia genera evidencia.
5. Ausencia de evidencia ≠ ausencia de capacidad.
6. Una experiencia produce señales, no conclusiones definitivas.
7. Matching simple > matching inteligente.
8. Todo debe poder ejecutarse manualmente.
9. Mobile-first.
10. El participante debe entender qué hacer sin staff.

---

## 3. Flujo completo

~~~
QR
↓
Inicio
↓
Claridad inicial
↓
5 preguntas situacionales
↓
Resultado provisional
↓
Elegir desafío 1 + desafío 2
↓
Nombre + WhatsApp
↓
Preinscripción
↓
Agregar al calendario
↓
Recordatorio WhatsApp manual
↓
Regreso 14:20–14:25
↓
Check-in
↓
Matching
↓
Startup + equipo + mesa
↓
Sprint físico
↓
A3 + pitch + founder
↓
Reflexión
↓
Interpretación Educai
↓
Recomendación
↓
CTA Espacio IDI
~~~

---

## 4. Estados del participante

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

## 5. Pantalla — Inicio

Título:

> Descubrí cómo podés aportar cuando resolvés un problema real.

Subtexto:

> En menos de 2 minutos te proponemos una forma de entrar al desafío. Después vas a ponerla a prueba con otras personas y una startup real.

CTA:

**DESCUBRIR CÓMO PUEDO APORTAR**

Texto secundario:

> No es un test de personalidad ni define quién sos.

---

## 6. Pantalla — Claridad inicial

Pregunta:

> Cuando trabajás con otras personas sobre un problema nuevo, ¿qué tan claro tenés cuál suele ser tu aporte para que el equipo avance?

Escala:

1 Nada claro → 5 Muy claro

Guardar como: pre_clarity.

No afecta el perfil.

---

## 7. Cuestionario situacional

Una pregunta por pantalla. Mostrar progreso 1/5. Randomizar orden visual de respuestas.

### Q1

> Te tiran un problema que nadie del equipo conoce. ¿Qué te sale hacer primero?

**E — Explorar:** Entender qué está pasando y hacer las preguntas que faltan.

**C — Crear:** Abrir varias posibilidades antes de casarnos con una.

**I — Impulsar:** Ordenar lo que sabemos y definir un primer paso.

### Q2

> Llevan 10 minutos y el equipo está trabado. ¿Dónde aparecés vos?

**E:** Detecto qué estamos dando por supuesto y lo cuestiono.

**C:** Cambio el enfoque y propongo una alternativa distinta.

**I:** Recorto opciones y empujo una decisión para seguir.

### Q3

> Aparece información que contradice la idea que venían armando. ¿Qué hacés?

**E:** Vuelvo al problema y reviso qué entendimos mal.

**C:** Uso ese dato para reformular la idea.

**I:** Ajusto la propuesta y defino qué tenemos que probar ahora.

### Q4

> Quedan pocos minutos y hay tres buenas ideas sobre la mesa. ¿Qué te sale hacer?

**E:** Comparo cuál responde mejor al problema real.

**C:** Combino lo mejor de varias para crear algo mejor.

**I:** Elijo una, ordeno al equipo y la llevamos a algo concreto.

### Q5

> Antes de presentar, ¿qué te gustaría tener más claro?

**E:** Por qué creemos que ese es el problema importante.

**C:** Qué hace valiosa o diferente nuestra propuesta.

**I:** Cómo funcionaría y cuál sería la primera prueba.

---

## 8. Scoring

Cada respuesta suma:

- E → explore +1
- C → create +1
- I → drive +1

Mayor puntaje = initial_mode.

Valores:

- EXPLORE
- CREATE
- DRIVE

### Empate 2–2–1

Mostrar una sola pregunta entre los dos modos empatados:

> Si hoy solo pudieras aportar una cosa al equipo, ¿cuál elegirías?

Opciones posibles:

**Explorar**
> Que entendamos mejor qué problema realmente vale la pena resolver.

**Crear**
> Que aparezca una posibilidad que antes nadie estaba viendo.

**Impulsar**
> Que salgamos con algo concreto que podamos poner a prueba.

No mostrar porcentajes.

---

## 9. Pantalla — Resultado inicial

Encabezado:

> Esto no define quién sos.

> De todo lo que sos, hoy te proponemos poner una capacidad en primer plano y ver qué pasa cuando la usás sobre un problema real.

### Explorar

> Hoy tu ventaja puede estar en ver lo que otros pasan por alto.

Misión:

> Hacé al menos una pregunta que cambie cómo el equipo entiende el problema.

### Crear

> Hoy tu ventaja puede estar en abrir caminos que todavía no están sobre la mesa.

Misión:

> Ayudá a que aparezcan varias posibilidades antes de quedarse con una.

### Impulsar

> Hoy tu ventaja puede estar en transformar conversación en avance.

Misión:

> Ayudá al equipo a salir con una decisión y una primera prueba.

CTA: **ELEGIR UN DESAFÍO**

---

## 10. Pantalla — Desafíos

Cada tarjeta muestra:

- startup;
- descripción breve;
- desafío;
- premio/beneficio opcional.

Selección:

1. primera opción obligatoria;
2. segunda opción obligatoria o “cualquiera, quiero participar”.

La segunda opción existe para resolver grupos inviables.

---

## 11. Pantalla — Datos e inscripción

Campos:

- nombre;
- WhatsApp.

Consentimientos separados:

1. operativo:
   > Acepto recibir mensajes operativos relacionados con este Innovatón.

2. comunidad:
   > Quiero recibir próximas oportunidades de Espacio IDI.

La persona puede participar sin aceptar comunicaciones futuras.

CTA: **INSCRIBIRME**

---

## 12. Inscripción presencial 14:20–14:25

Si una persona se registra desde el QR físico del stand entre 14:20 y 14:25:

- crear registro;
- marcar CHECKED_IN automáticamente;
- no pedir segundo check-in.

A las 14:25 cierra inscripción.

---

## 13. Pantalla — Confirmación

> Estás preinscripto.

> Volvé al stand de Espacio IDI entre 14:20 y 14:25.

> A las 14:30 empezamos.

CTA principal:

**AGREGAR AL CALENDARIO**

Crear evento:

- Innovatón — Espacio IDI
- hora de referencia: 14:20
- ubicación: Stand Espacio IDI
- alarma: 10 minutos antes.

Soportar Google Calendar y .ics.

---

## 14. WhatsApp

MVP manual.

Entre 14:10 y 14:20 se envía:

> En unos minutos empieza el Innovatón. Acercate al stand de Espacio IDI entre 14:20 y 14:25 para confirmar tu lugar. A las 14:30 arrancamos.

Dashboard debe mostrar nombre + teléfono para facilitar envío.

No automatizar WhatsApp en MVP.

---

## 15. Pantalla — Check-in

Desde 14:20:

> ¿Ya estás en el stand?

CTA:

**ESTOY ACÁ**

Al confirmar:

- status = CHECKED_IN
- checked_in_at = now

Mostrar:

> Listo. Estás adentro. Estamos formando los equipos con las personas que ya llegaron.

Solo los presentes entran al matching.

---

## 16. Matching

Prioridades:

1. presencia;
2. primera elección;
3. equipos de 3–4;
4. segunda elección para grupos inviables;
5. ANY;
6. diversidad E/C/I como desempate.

Los modos nunca pueden:

- cambiar innecesariamente el desafío;
- romper un equipo viable;
- dejar alguien afuera.

Particiones esperadas:

- 3 → 3
- 4 → 4
- 5 → 5 excepcional
- 6 → 3+3
- 7 → 3+4
- 8 → 4+4
- 9 → 3+3+3
- 10 → 3+3+4
- 11 → 3+4+4
- 12 → 4+4+4

Grupos de 1–2 se reasignan por segunda opción o pasan a resolución manual.

No hay límite por startup. El límite real es físico/operativo.

---

## 17. Publicación de equipos

El staff:

1. genera;
2. revisa;
3. edita si hace falta;
4. publica.

Después de publicar no se regenera.

El participante ve:

> MENTIUM  
> Equipo 2  
> Mesa 5

Sin colores ni símbolos.

---

## 18. Latecomers

### Hasta 14:25
Ingreso normal.

### 14:25–14:35
No regenerar.

Resolver así:

1. equipo de 3 de su challenge → sumar como cuarto;
2. equipo de 4 → quinto excepcional;
3. segunda opción;
4. si llegan 3 compatibles → nuevo equipo;
5. manual.

### Después de 14:35
Solo si staff determina que no rompe la dinámica.

---

## 19. Sprint

Durante el sprint la app deja de ser protagonista.

Material físico:

- brief;
- A3;
- marcadores.

A3:

1. Problema — ¿Qué está ocurriendo realmente?
2. Hipótesis — ¿Qué proponemos?
3. Funcionamiento — ¿Cómo funcionaría?
4. Prueba — ¿Cómo sabríamos rápidamente si sirve?

Duración: 30 minutos.

---

## 20. Pitch

Pitches paralelos por startup.

Cada founder escucha solo los equipos de su desafío.

Elevator pitch: 60 segundos.

Estructura:

> El problema que entendimos es...

> Proponemos...

> Funcionaría así...

> Lo primero que probaríamos es...

Sin slides.

---

## 21. Evaluación founder

Tres criterios:

- Problema 1–5
- Valor 1–5
- Prueba 1–5

Campo de feedback opcional.

El founder elige ganador/reconocimiento según criterio propio.

Premio definido por cada founder.

Opcional:

> ¿Hubo alguna contribución individual especialmente valiosa?

Si sí:

- participante;
- capacidad observada;
- nota opcional.

---

## 22. Captura de artefactos

Staff/founder puede cargar foto del A3 asociada a:

- evento;
- challenge;
- equipo.

En MVP se almacena; no se analiza automáticamente.

---

## 23. Reflexión final

### Pregunta 1
> Ahora que terminaste, ¿qué tan claro tenés cómo aportaste para que el equipo avanzara?

1–5.

### Pregunta 2
> ¿Qué hiciste concretamente durante el desafío?

Multiselección:

- hice preguntas para entender mejor;
- detecté un supuesto o información faltante;
- propuse alternativas;
- conecté ideas;
- ayudé a elegir entre opciones;
- organicé al equipo para avanzar;
- convertí una idea en una prueba;
- presenté o expliqué la propuesta;
- otra.

### Pregunta 3
> ¿Cuál sentís que fue tu aporte más importante?

Texto corto.

Luego categorizar en:

- entender el problema;
- cuestionar supuestos;
- generar alternativas;
- priorizar;
- diseñar una prueba;
- comunicar/coordinar.

### Pregunta 4
> ¿Sentís que tu aporte ayudó al equipo?

1–5.

### Pregunta 5
> ¿La sugerencia que recibiste al comienzo te ayudó a encontrar una forma de participar?

1–5.

---

## 24. Capacidades internas

- problem_understanding
- assumption_questioning
- ideation
- prioritization
- experimentation
- communication

Los modos E/C/I no reemplazan estas capacidades.

---

## 25. Resultado Educai

Pantalla con cuatro bloques:

### Tu punto de partida
Ejemplo:
> Entraste poniendo Explorar en primer plano.

### Lo que hiciste
Mostrar acciones registradas.

### Lo que esta experiencia sugiere
Ejemplo:
> Aparecieron varias señales de comprensión del problema y experimentación.

Disclaimer:
> Esta experiencia no define tus capacidades. Es una primera evidencia contextual sobre cómo actuaste hoy.

### Próximo experimento
Mostrar una acción pequeña y observable.

---

## 26. CTA Espacio IDI

> Hace menos de una hora no conocías este problema ni a tu equipo. Ahora tenés una evidencia más sobre cómo podés aportar en una situación real.

> Espacio IDI crea más oportunidades para seguir poniéndolo a prueba.

CTA:

**QUIERO PARTICIPAR DE LOS PRÓXIMOS DESAFÍOS**

---

## 27. Dashboard staff

Vista principal:

- Registrados
- Presentes
- Matched
- Finalizados

Por startup:

- registrados;
- presentes;
- equipos.

Acciones:

- cerrar inscripción;
- generar equipos;
- editar equipos;
- publicar equipos;
- descargar respaldo.

Buscador por nombre/teléfono para latecomers.

---

## 28. Vista de equipo

Mostrar:

- startup;
- número de equipo;
- mesa;
- participantes.

Acciones:

- cargar A3;
- puntuar Problema / Valor / Prueba;
- feedback;
- ganador;
- contribución individual.

---

## 29. Contingencia

Debe existir export CSV con:

- nombre;
- WhatsApp;
- modo inicial;
- first choice;
- second choice;
- checked_in;
- equipo;
- mesa.

Si cae internet:

- check-in en papel;
- matching manual;
- mesas numeradas;
- briefs impresos;
- A3 física;
- founder score en papel;
- reflexión en papel.

El evento no puede depender de la app.

---

## 30. Fuera del MVP

No construir todavía:

- PWA;
- push notifications;
- app nativa;
- chatbot;
- matching con IA/ML;
- análisis automático de A3;
- reconocimiento del pitch;
- WhatsApp automático;
- portfolio completo;
- recomendador de carrera;
- rankings;
- gamificación;
- networking automático;
- perfiles profesionales sofisticados.

---

## 31. Métricas

Funnel:

- questionnaire_completion_rate
- registration_rate
- registration_to_checkin
- checkin_to_completion
- reflection_completion
- community_conversion

Educai:

- pre_clarity
- post_clarity
- delta_clarity
- initial_mode_usefulness
- perceived_value
- cantidad de evidence_items
- % con interpretación suficiente
- alineación/divergencia entre hipótesis y evidencia

---

## 32. Definition of Done

El MVP está listo cuando una persona puede:

> escanear QR → responder → recibir hipótesis → elegir desafíos → dejar WhatsApp → agregar calendario → volver → check-in → recibir equipo/mesa → participar → dejar evidencia → recibir interpretación → recibir próximo experimento → sumarse a Espacio IDI.

Y, simultáneamente, el staff puede ejecutar la experiencia manualmente si la tecnología falla.
