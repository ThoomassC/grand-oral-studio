import { z } from "zod";
import { brandFromTheme } from "./brand-from-theme";
import type { Brand } from "../schemas";

/**
 * Charte déduite par l'IA (vision) d'un PDF ou d'une image. Le modèle reçoit un
 * schéma PERMISSIF ; la réponse est convertie en thème puis passe par
 * `brandFromTheme` : mêmes garanties (contraste ≥ 4,5:1, polices sûres,
 * BrandSchema). Aucun logo n'est repris d'une sortie d'IA.
 */

export const RawBrandDraftSchema = z.object({
  name: z.string().optional(),
  colors: z
    .object({
      primary: z.string().optional(),
      secondary: z.string().optional(),
      accent: z.string().optional(),
      background: z.string().optional(),
      text: z.string().optional(),
    })
    .optional(),
  headingFont: z.string().optional(),
  bodyFont: z.string().optional(),
});
export type RawBrandDraft = z.infer<typeof RawBrandDraftSchema>;

/** « #1c9 », « 11CC99 », « #11cc99 » → « #11CC99 » ; sinon undefined. */
function hex(value: string | undefined): string | undefined {
  const v = value?.trim().replace(/^#/, "") ?? "";
  if (/^[0-9a-fA-F]{3}$/.test(v)) return `#${[...v].map((c) => c + c).join("").toUpperCase()}`;
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toUpperCase()}`;
  return undefined;
}

export function brandFromDraft(raw: RawBrandDraft): { brand: Brand; notes: string[] } {
  const c = raw.colors ?? {};
  const colors = Object.fromEntries(
    [
      ["accent1", hex(c.primary)],
      ["accent2", hex(c.secondary)],
      ["accent3", hex(c.accent)],
      ["lt1", hex(c.background)],
      ["dk1", hex(c.text)],
    ].filter((e): e is [string, string] => e[1] !== undefined),
  );
  return brandFromTheme({
    name: raw.name?.trim() || null,
    colors,
    fonts: { major: raw.headingFont?.trim() || null, minor: raw.bodyFont?.trim() || null },
    logoDataUrl: null,
    notes: [],
  });
}
