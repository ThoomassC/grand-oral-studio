import { describe, expect, it } from "vitest";
import { AiRefusalError, NotFoundError } from "@/server/errors";
import { ProgramMetaSchema } from "@/server/validation";

describe("vocabulaire affiché à l'utilisateur : « projet »", () => {
  it("annonce un projet introuvable, jamais un « programme »", () => {
    expect(new NotFoundError("programme").userMessage).toBe("Ce projet est introuvable.");
    expect(new NotFoundError().userMessage).toBe("Ce projet est introuvable.");
    expect(new NotFoundError("thème").userMessage).toBe("Ce sujet est introuvable.");
  });

  it("parle de sujet, jamais de thème, quand l'IA refuse une demande", () => {
    expect(new AiRefusalError(null).userMessage).toBe(
      "L'IA a refusé de traiter cette demande. Reformulez la problématique ou le sujet, puis réessayez.",
    );
  });

  it("parle du nom du projet dans les erreurs de validation", () => {
    const result = ProgramMetaSchema.safeParse({ name: "x", description: "" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Le nom du projet doit faire au moins 2 caractères.");
  });
});
