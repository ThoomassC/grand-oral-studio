import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTemplate } from "@/domain/defaults";
import type { PromptTemplate } from "@/domain/schemas";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/trame", useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/server/actions/programs", () => ({ updateBrand: vi.fn(), updateTemplate: vi.fn() }));
vi.mock("@/server/actions/imports", () => ({ analyzeTemplatePrompt: vi.fn() }));
const listSharedModels = vi.fn();
const applyModel = vi.fn();
vi.mock("@/server/actions/shared-models", () => ({
  publishModel: vi.fn(),
  listSharedModels: (...args: unknown[]) => listSharedModels(...args),
  applyModel: (...args: unknown[]) => applyModel(...args),
  deleteModel: vi.fn(),
}));

const { TemplateWorkspace } = await import("@/components/template/TemplateWorkspace");

const V0 = "2026-10-01T08:00:00.000Z";
const V1 = "2026-10-01T08:05:00.000Z";

const CURRENT: PromptTemplate = {
  ...defaultTemplate(),
  durationMinutes: 20,
  sections: [{ id: "a", title: "Contexte actuel", guidance: "Enjeu", slides: 2, seconds: 180 }],
};
const FROM_MODEL: PromptTemplate = {
  ...defaultTemplate(),
  durationMinutes: 15,
  sections: [
    { id: "x", title: "Accroche du modèle", guidance: "", slides: 1 },
    { id: "y", title: "Développement", guidance: "Deux parties", slides: 4 },
  ],
};

const MODEL = {
  id: "m1",
  kind: "template" as const,
  name: "Trame grand oral",
  authorName: "Bruno",
  isMine: false,
  createdAt: "2026-10-01T08:00:00.000Z",
  preview: {
    kind: "template" as const,
    format: "16:9" as const,
    language: "fr" as const,
    durationMinutes: 15,
    sections: [
      { title: "Accroche du modèle", slides: 1 },
      { title: "Développement", slides: 4 },
    ],
  },
};

afterEach(async () => {
  cleanup();
  refresh.mockReset();
  listSharedModels.mockReset();
  applyModel.mockReset();
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
});

describe("Page Trame — bibliothèque de l'équipe", () => {
  it("devrait reprendre dans l'éditeur la trame d'un modèle appliqué, une fois la page rafraîchie", async () => {
    listSharedModels.mockResolvedValue({ ok: true, data: [MODEL] });
    applyModel.mockResolvedValue({ ok: true, data: { kind: "template" } });
    const user = userEvent.setup();
    const { rerender } = render(<TemplateWorkspace programId="p1" initialTemplate={CURRENT} savedAt={V0} />);
    expect(screen.getByDisplayValue("Contexte actuel")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Voir la bibliothèque" }));
    expect(listSharedModels).toHaveBeenCalledWith("template");
    const item = (await screen.findByRole("heading", { name: "Trame grand oral", level: 4 })).closest("li") as HTMLElement;
    expect(item).toHaveTextContent("15 min · 2 lignes · 16:9");
    await user.click(within(item).getByRole("button", { name: "Appliquer « Trame grand oral » à ce projet" }));
    const confirm = await screen.findByRole("dialog", { name: "Remplacer la trame ?" });
    expect(confirm).toHaveAccessibleDescription(/modifications non enregistrées seront perdues/);
    await user.click(within(confirm).getByRole("button", { name: "Remplacer la trame" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(applyModel).toHaveBeenCalledWith("p1", "m1");

    // Rafraîchissement serveur : nouvelle trame, nouvelle version.
    rerender(<TemplateWorkspace programId="p1" initialTemplate={FROM_MODEL} savedAt={V1} />);
    await waitFor(() => expect(screen.getByDisplayValue("Accroche du modèle")).toBeInTheDocument());
    expect(screen.queryByDisplayValue("Contexte actuel")).not.toBeInTheDocument();
  });

  it("ne devrait proposer la publication qu'au propriétaire du projet", () => {
    render(<TemplateWorkspace programId="p1" initialTemplate={CURRENT} savedAt={V0} />);
    expect(screen.getByRole("button", { name: "Voir la bibliothèque" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publier dans la bibliothèque" })).not.toBeInTheDocument();
    cleanup();
    render(<TemplateWorkspace programId="p1" initialTemplate={CURRENT} savedAt={V0} canPublish />);
    expect(screen.getByRole("button", { name: "Publier dans la bibliothèque" })).toBeInTheDocument();
  });

  it("ne devrait pas remplacer la saisie de l'éditeur quand aucun modèle n'a été appliqué", () => {
    const { rerender } = render(<TemplateWorkspace programId="p1" initialTemplate={CURRENT} savedAt={V0} />);
    rerender(<TemplateWorkspace programId="p1" initialTemplate={FROM_MODEL} savedAt={V1} />);
    expect(screen.getByDisplayValue("Contexte actuel")).toBeInTheDocument();
  });
});

describe("Page Trame — lecteur", () => {
  it("devrait montrer la trame en lecture seule, sans import, éditeur ni bibliothèque", () => {
    render(<TemplateWorkspace programId="p1" initialTemplate={FROM_MODEL} savedAt={V0} readOnly />);
    expect(screen.getByRole("heading", { name: "Diapos de la trame", level: 3 })).toBeInTheDocument();
    const lines = screen.getByRole("list", { name: /Lignes/ });
    expect(within(lines).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Accroche du modèle — 1 diapo",
      "Développement — 4 diaposDeux parties",
    ]);
    expect(screen.getByText("15 min")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
