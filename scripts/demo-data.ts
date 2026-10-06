// Desafíos FICTICIOS para probar el producto mientras no estén los briefs reales
// (docs/innovaton/04-startup-briefs.md). Todos llevan el prefijo "DEMO ·".
// Se reemplazan desde /staff/events/<id>/settings sin tocar código.

export interface DemoChallenge {
  startupName: string;
  title: string;
  description: string;
  brief: string;
  prize: string | null;
}

function brief(parts: {
  user: string;
  situation: string;
  evidence: string;
  problem: string;
  why: string;
  constraints: string;
  outOfScope: string;
  criteria: string;
}): string {
  return [
    "[DATOS FICTICIOS · DEMO]",
    `Usuario afectado: ${parts.user}`,
    `Situación actual: ${parts.situation}`,
    `Evidencia disponible: ${parts.evidence}`,
    `Problema: ${parts.problem}`,
    `Por qué importa: ${parts.why}`,
    `Restricciones: ${parts.constraints}`,
    `Fuera de alcance: ${parts.outOfScope}`,
    "Entregable: problema interpretado, hipótesis de solución, cómo funcionaría y primera prueba.",
    `Qué hace buena a una propuesta: ${parts.criteria}`,
  ].join("\n\n");
}

export const DEMO_CHALLENGES: DemoChallenge[] = [
  {
    startupName: "DEMO · Cosecha Directa",
    description: "Plataforma ficticia que conecta huertas periurbanas con almacenes de barrio.",
    title:
      "¿Cómo podríamos lograr que los almacenes repitan el pedido semanal sin sumar costos de logística?",
    prize: "DEMO · Una canasta de productos (ficticio)",
    brief: brief({
      user: "Dueñas y dueños de almacenes de barrio en Córdoba capital.",
      situation:
        "Los almacenes prueban el servicio una vez, pero 6 de cada 10 no hacen un segundo pedido.",
      evidence:
        "En llamadas de seguimiento dicen que se olvidan de pedir o que no saben qué verdura va a llegar.",
      problem: "El primer pedido no se convierte en hábito.",
      why: "Sin pedidos recurrentes no se puede planificar la cosecha y se pierde mercadería.",
      constraints: "Mismo camión, mismo recorrido semanal, sin app nueva para el almacén.",
      outOfScope: "Cambiar precios o sumar productos nuevos.",
      criteria: "Entiende por qué no repiten, es concreta y se puede probar con 5 almacenes en una semana.",
    }),
  },
  {
    startupName: "DEMO · TurnoYa",
    description: "Sistema ficticio de turnos para centros de salud barriales.",
    title:
      "¿Cómo podríamos reducir los turnos perdidos para que más vecinos se atiendan sin agregar personal administrativo?",
    prize: "DEMO · Mentoría de 1 hora (ficticio)",
    brief: brief({
      user: "Personas que sacan turno en un centro de salud barrial y el equipo de recepción.",
      situation: "1 de cada 4 turnos queda vacío porque la persona no avisa que no puede ir.",
      evidence: "Registro de ausencias de los últimos 3 meses y comentarios de recepción.",
      problem: "Cancelar un turno es más difícil que no ir.",
      why: "Hay lista de espera y esos turnos se pierden.",
      constraints: "Muchos pacientes no tienen datos móviles todo el mes. Sin presupuesto para SMS masivos.",
      outOfScope: "Rediseñar todo el sistema de turnos.",
      criteria: "Considera a quien tiene poca conectividad y propone una prueba simple de medir.",
    }),
  },
  {
    startupName: "DEMO · Segunda Vuelta",
    description: "Marketplace ficticio de ropa usada entre estudiantes universitarios.",
    title:
      "¿Cómo podríamos lograr que más estudiantes publiquen ropa para vender sin que tengan que sacar fotos profesionales?",
    prize: "DEMO · Crédito para usar en la plataforma (ficticio)",
    brief: brief({
      user: "Estudiantes que tienen ropa en buen estado que ya no usan.",
      situation: "Muchas personas se registran pero solo el 15% publica una prenda.",
      evidence: "Encuestas internas: publicar lleva mucho tiempo y las fotos salen mal.",
      problem: "Publicar se siente como demasiado trabajo para lo que se gana.",
      why: "Sin oferta no hay compradores y la comunidad no crece.",
      constraints: "Sin estudio de fotos ni personal extra. Funciona desde el celular.",
      outOfScope: "Logística de envíos y medios de pago.",
      criteria: "Baja el esfuerzo de publicar de forma concreta y se puede probar en una facultad.",
    }),
  },
  {
    startupName: "DEMO · Aula Abierta",
    description: "Programa ficticio de tutorías entre estudiantes de secundaria.",
    title:
      "¿Cómo podríamos lograr que los estudiantes pidan ayuda antes de un examen sin sentir vergüenza?",
    prize: null,
    brief: brief({
      user: "Estudiantes de 3º a 5º año de escuelas secundarias públicas.",
      situation: "Las tutorías están disponibles pero la mayoría consulta el día anterior al examen.",
      evidence: "Registro de consultas: el 70% llega en las últimas 24 horas.",
      problem: "Pedir ayuda temprano se percibe como admitir que no entendés.",
      why: "Con tan poco margen, la tutoría casi no cambia el resultado.",
      constraints: "Tutores voluntarios con 2 horas semanales. Sin cambiar el calendario escolar.",
      outOfScope: "Cambiar la forma de evaluar de la escuela.",
      criteria: "Entiende la vergüenza como parte del problema y propone algo probable en un curso.",
    }),
  },
  {
    startupName: "DEMO · Barrio Activo",
    description: "Agenda ficticia de actividades culturales gratuitas por barrio.",
    title:
      "¿Cómo podríamos lograr que más vecinos se enteren de las actividades de su barrio sin depender de redes sociales pagas?",
    prize: "DEMO · Entradas para un evento (ficticio)",
    brief: brief({
      user: "Vecinas y vecinos de barrios con centros culturales pequeños.",
      situation: "Las actividades tienen poca asistencia aunque son gratuitas.",
      evidence: "En encuestas a la salida, la mitad dice que se enteró por casualidad.",
      problem: "La información no llega a quien vive cerca.",
      why: "Los centros culturales pierden apoyo si no muestran asistencia.",
      constraints: "Presupuesto cero en publicidad. Voluntarios con poco tiempo.",
      outOfScope: "Diseñar una app nueva.",
      criteria: "Es barata, concreta y se puede probar en una cuadra en una semana.",
    }),
  },
  {
    startupName: "DEMO · Ruta Segura",
    description: "Servicio ficticio para volver acompañado de la facultad de noche.",
    title:
      "¿Cómo podríamos lograr que estudiantes que salen tarde vuelvan acompañados sin tener que coordinar con desconocidos?",
    prize: "DEMO · Viajes gratis por un mes (ficticio)",
    brief: brief({
      user: "Estudiantes que cursan de noche y vuelven en colectivo o caminando.",
      situation: "Existe un grupo para volver juntos, pero casi nadie lo usa.",
      evidence: "Entrevistas: da desconfianza coordinar con gente que no conocen.",
      problem: "La confianza es la barrera, más que la falta de compañía.",
      why: "Muchas personas dejan materias nocturnas por miedo a volver.",
      constraints: "Sin datos personales sensibles. Sin acuerdos con transporte público.",
      outOfScope: "Seguridad pública o iluminación de calles.",
      criteria: "Trabaja sobre la confianza y propone una primera prueba segura y chica.",
    }),
  },
];
