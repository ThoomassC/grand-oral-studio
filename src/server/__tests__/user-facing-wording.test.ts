import { describe, expect, it } from "vitest";
import { NotFoundError } from "@/server/errors";
import { ProgramMetaSchema } from "@/server/validation";

describe("vocabulaire affiché à l'utilisateur : « projet »", () => {
  it("annonce un projet introuvable, jamais un « programme »", () => {
    expect(new NotFoundError("programme").userMessage).toBe("Ce projet est introuvable.");
    expect(new NotFoundError().userMessage).toBe("Ce projet est introuvable.");
    expect(new NotFoundError("thème").userMessage).toBe("Ce thème est introuvable.");
  });

  it("parle du nom du projet dans les erreurs de validation", () => {
    const result = ProgramMetaSchema.safeParse({ name: "x", description: "" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("Le nom du projet doit faire au moins 2 caractères.");
  });
});
