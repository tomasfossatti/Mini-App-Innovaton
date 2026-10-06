# 07 — Decisiones de implementación

Este documento registra cómo se resolvieron ambigüedades y adaptaciones al construir el MVP. Los documentos 00–06 siguen siendo la fuente de verdad funcional; acá queda el porqué de cada elección técnica.

## Proveedores

| Tema | Spec original | Implementación | Motivo |
|---|---|---|---|
| Base de datos | Postgres / Supabase | Cualquier Postgres vía `DATABASE_URL` (Neon, Supabase o local) | El código no depende del proveedor. Para el deploy recomendado alcanza con una sola cuenta (Vercel + Neon). El parámetro `channel_binding` que Neon agrega a sus URLs se descarta al conectar, porque postgres-js lo reenvía al servidor y Postgres rechaza la conexión. |
| Auth de staff | Supabase Auth | Cuentas propias: `staff_members` (scrypt) + `staff_sessions` (hash SHA-256 del token, 14 h) | Un servicio menos que configurar y se puede probar localmente. Se mantienen los roles ADMIN / STAFF y la verificación de sesión y rol en cada página, action y route. |
| Storage del A3 | Supabase Storage (bucket privado + signed URLs) | Tabla `artifact_blobs` (bytea) detrás de la interfaz `ArtifactStorage` | Un solo servicio que respaldar. El acceso sigue siendo privado: las fotos solo se sirven por una route que exige sesión de staff. Se comprimen en el navegador (máx. 1600 px, JPEG) antes de subir. Cambiar a un bucket implica escribir otro driver. |

## Flujo y estados

- **Fases controladas por el staff.** La lógica depende de `events.phase`, no del reloj. Los horarios del evento (14:20 / 14:25 / 14:30) se usan para el copy, el recordatorio de WhatsApp y el calendario. Así el staff decide si abre o cierra unos minutos antes o después.
- **Inscripción en fase CHECKIN = presente automático** (PRD §12). Se asume que quien se inscribe entre 14:20 y 14:25 está en el stand.
- **Inscripción tardía.** En MATCHING o SPRINT se puede seguir inscribiendo, con un aviso: la persona queda REGISTERED y el staff decide si la suma como latecomer. Así no se pierde su hipótesis ni su WhatsApp. En PITCH, REFLECTION y CLOSED la inscripción está cerrada.
- **Check-in desde el celular** solo en CHECKIN y MATCHING. Después de publicar, el check-in lo hace el staff (PRD §18: "después de 14:35, solo si el staff determina").
- **Consentimiento operativo obligatorio, el de comunidad opcional.** Sin poder escribirle por WhatsApp no se puede operar el evento; las comunicaciones futuras son opcionales (PRD §11).
- **WhatsApp ya inscripto en el evento.** Una segunda inscripción con ese número se rechaza y la pantalla deriva a pedir en el stand un código para recuperar el lugar. Así nadie puede pisar el nombre, las elecciones o los consentimientos de otra persona usando su número. Quien cambió de celular recupera su inscripción tal como estaba, con el check-in incluido.
- **Recuperación de sesión con código del staff.** La identidad sigue siendo el WhatsApp normalizado (spec §5), pero el número solo ya no abre una inscripción. Hace falta además un código de 6 dígitos que el staff genera desde la fila de la persona en el Panel y le dicta cara a cara. El código se guarda hasheado y atado a la participación, vence a los 15 minutos, es de un solo uso y se invalida tras 5 intentos fallidos; cada intento queda contado aunque falle. Número desconocido, código vencido, agotado o incorrecto dan el mismo mensaje. Al recuperar se rota el token, así que el dispositivo anterior deja de estar asociado. Es un desvío de spec §5, que recuperaba solo con el WhatsApp: así, conocer el número de otra persona alcanzaba para ver su mesa y su resultado o enviar su reflexión. Las cuentas STAFF también generan códigos, porque la recepción es la que atiende a quien perdió la sesión.
- **Polling del participante** (02 §11): cada 6 s mientras espera equipo, como pide la spec. Además consulta cada 15–20 s mientras espera que abra el check-in o la reflexión, para que el botón aparezca sin recargar, y se detiene cuando ya no hay nada que esperar. El JSON de `/api/participant/state` usa `team.startupName`, `team.teamNumber` y `team.tableNumber`.
- **Pasar a sprint, pitch o reflexión exige equipos publicados**: sin eso nadie ve su mesa ni puede reflexionar. Cerrar el evento sí se permite sin equipos.
- **Al abrir la reflexión**, quienes estaban MATCHED pasan a EXPERIENCE_COMPLETED. Al publicar, quienes estaban REGISTERED (nunca hicieron check-in) pasan a NO_SHOW. El staff igual puede hacerles check-in después.
- **Alta rápida por staff** para quien no tiene celular o para cargar planillas en papel: crea a la persona como presente. Si hizo el cuestionario en papel, el staff carga su modo E/C/I, que es la hipótesis inicial y nunca evidencia; sin cuestionario queda `initial_mode` nulo. El modo en papel solo completa uno vacío: nunca pisa el del celular.

## Matching

- Implementa §13–§16 con una pasada extra de **consolidación** antes del pool ANY: si las personas de grupos inviables pueden formar un grupo de 3 o más combinando primera y segunda opción, se forma. Resuelve el caso cruzado (2 eligen A con 2ª B y 2 eligen B con 2ª A → un equipo de 4) que el pseudocódigo literal dejaba en resolución manual.
- **ANY sin grupos existentes.** Si hay 3 o más personas ANY y ningún grupo viable, se forma un grupo en el desafío más elegido entre ellas.
- Todo es determinístico (orden de check-in, luego id), así dos regeneraciones con la misma entrada dan el mismo resultado.
- Límite conocido: la consolidación es greedy (forma primero el desafío con más candidatos). En combinaciones raras de varios desafíos inviables con segundas opciones cruzadas puede dejar a alguien sin equipo cuando otro reparto ubicaba a todos. Quedan listados en "Presentes sin equipo" y el staff los asigna a mano antes de publicar.
- Después de publicar, `assignLatecomer` admite como máximo un quinto integrante; mover a mano permite más, con advertencia en el tablero.
- Regenerar no borra borradores que ya tengan A3, evaluación u observaciones (error `DRAFT_HAS_RECORDS`).
- Deshacer un check-in después de publicar vuelve a NO_SHOW, igual que el resto de quienes no llegaron.
- Concurrencia: `pg_advisory_xact_lock(hashtext(event_id))` en generar, publicar, mover, crear equipo y cambiar mesa.
- **Dos personas del staff con la misma pantalla.** Generar y publicar mandan la versión del tablero que se estaba viendo (composición de cada equipo y su mesa). Si otra persona lo cambió en el medio, el servidor rechaza con «Otra persona cambió los equipos» y la pantalla se actualiza. Lo mismo pasa con la evaluación del founder y los bloques del A3: no se pisa lo que guardó otra persona.
- Sumar un latecomer como quinto exige confirmación explícita, también cuando dos staff suman a la vez al mismo equipo de 3.
- Cambiar la mesa de un equipo por una ocupada avisa y pide confirmación antes de intercambiarlas.
- Después del sprint no se puede dejar a alguien sin equipo (desaparecería del tablero y no podría reflexionar). Si se lo mueve a otro equipo y ya había reflexionado, su interpretación se recalcula con la evidencia del equipo nuevo.
- Después de publicar, el botón de regenerar desaparece y el servidor rechaza el pedido.
- **Muy poca gente.** Aunque el matching no forme ningún equipo, mientras haya presentes sin equipo en MATCHING el ADMIN ve **+ Equipo vacío** en cada desafío. Así arma a mano equipos de 1 o 2 personas para ensayos o asistencia muy baja y los publica; el tablero avisa que son chicos. El matching automático los sigue marcando como casos sin resolver.

## Educai

- **Nivel de evidencia:** se sigue el algoritmo exacto de 02 §22. Dos autodeclaraciones de la misma capacidad dan SIGNAL; para CONVERGENT hace falta evidencia observada (founder o facilitación) o de equipo compatible. Es más conservador que la frase "varias señales individuales" de 05, en línea con "una experiencia produce señales, no conclusiones".
- **Score del founder a capacidad** (05 no lo define): Problema → comprensión del problema, Valor → generación de alternativas, Prueba → experimentación. Strength: 5 → 1, 4 → 0.5, 3 o menos → 0. Con el peso 1.5, un 5 aporta 1.5 y un 4 aporta 0.75, los mismos umbrales de §22.
- **A3:** la foto se guarda y no genera evidencia (no hay análisis automático). El staff puede marcar a mano qué bloques quedaron completos: Problema → comprensión del problema, Hipótesis → generación de alternativas, Funcionamiento → síntesis y priorización, Prueba → experimentación (strength 0.75, peso 1).
- **Evidencia grupal:** se guarda una sola vez a nivel equipo (`scope = TEAM`) y solo suma a una capacidad individual cuando esa persona ya tiene evidencia individual de la misma capacidad.
- **Observación individual:** el staff indica si la hizo el founder (peso 3) o un facilitador (peso 2.5).
- **Clasificación ALIGNED / MIXED / DIVERGENT:** si la capacidad principal está en el modo inicial y no hay convergencia fuerte fuera de él → ALIGNED. Si está en el modo y además hay convergencia fuera → MIXED. DIVERGENT exige que la principal esté fuera del modo, sea CONVERGENT y no haya convergencia en el modo. COMMUNICATION es transversal: no confirma ni contradice.
- **Recomendación:** DIVERGENT → investigar la divergencia; dos capacidades convergentes → explorar una complementaria (mapa fijo); una convergente → replicar; una señal → juntar más evidencia; sin evidencia → experimento según el modo inicial. Nunca se recomienda "mejorar la más baja".
- **Reinterpretación:** si la evaluación u observación del founder llega después de la reflexión, se crea un snapshot nuevo (versionado) y el resultado del participante muestra el último.
- **Pregunta 3 de la reflexión:** el texto es opcional; la categoría es obligatoria. La evidencia sale de la categoría elegida por la persona y el texto se guarda como `raw_text`.
- **Reflexión en papel:** desde la vista de equipo, el staff carga la reflexión de quien la hizo en papel o no tiene celular (alta rápida). Pasa por el mismo servicio que la del participante: misma evidencia, interpretación e idempotencia. Si la persona no tenía modo inicial, el staff puede cargar el del cuestionario en papel; se guarda antes de interpretar y no crea evidencia. Ese campo va aparte del formulario del participante, que no puede fijar su propio modo.

## Roles y datos personales

| Acción | STAFF (founders, facilitación, recepción) | ADMIN (staff principal) |
|---|---|---|
| Panel con contadores y lista de inscriptos | sí, con teléfonos enmascarados (`•••• 4567`) | sí, con WhatsApp completo y link al recordatorio |
| Check-in manual, deshacer, alta rápida | sí | sí |
| Código para recuperar una sesión | sí | sí |
| Sumar latecomers con la sugerencia del tablero | sí (nunca mueve a quien ya tiene equipo) | sí |
| A3, evaluación, contribución individual, reflexión en papel | sí | sí |
| Kit en papel (sin datos personales) | sí | sí |
| Fases, generar, publicar, mover a mano, mesas, borrar equipos | no | sí |
| CSV, backup JSON y hoja de impresión con WhatsApp | no | sí |
| Configuración del evento, desafíos y cuentas | no | sí |

- Quien coordina el check-in, el matching y los latecomers (Responsable 2 de 03 §1) necesita una cuenta ADMIN. Founders y colaboradores usan STAFF. Conviene desactivar las cuentas de founders al cerrar el evento.
- Login de staff: tras 10 intentos fallidos seguidos la cuenta se bloquea 15 minutos (o hasta que un ADMIN le cambie la contraseña).
- El CSV de contingencia usa `;` como separador (lo que espera Excel en español; Google Sheets lo detecta solo), el WhatsApp en formato legible sin `+` y una columna con el link `wa.me`.

## Panel

- Contadores: Registrados, Presentes, Con equipo, Equipos y Finalizados (con reflexión). Combina el encabezado del PRD §27 con el de 02 §25.

## Founders

- Evalúan desde la vista de equipo con una cuenta STAFF (la crea un ADMIN) o la carga un facilitador. La lista de equipos se filtra por desafío para que cada founder vea solo los suyos. No se agregó un rol nuevo.

## Datos DEMO

- 6 startups ficticias con prefijo `DEMO ·` (`scripts/demo-data.ts`), creadas por el seed en el evento `innovaton-demo`. Se reemplazan desde Configuración (desactivar o borrar y cargar las reales) sin tocar código. El panel avisa si quedan desafíos DEMO activos.
