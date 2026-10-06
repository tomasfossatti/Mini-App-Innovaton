import { z } from "zod";
import { CAPABILITIES, REFLECTION_ACTIONS } from "@/lib/domain/constants";

const scale = z.number().int().min(1).max(5);

/** Validación de la reflexión final (02 §27), compartida por participante y carga en papel. */
export const ReflectionSchema = z.object({
  postClarity: scale,
  selectedActions: z.array(z.enum(REFLECTION_ACTIONS)).min(1, "Marcá al menos una cosa que hiciste."),
  primaryContributionText: z.string().max(500, "El texto puede tener hasta 500 caracteres.").nullable(),
  primaryCapability: z.enum(CAPABILITIES),
  perceivedValue: scale,
  initialModeUsefulness: scale,
});

export type ReflectionFormInput = z.input<typeof ReflectionSchema>;
