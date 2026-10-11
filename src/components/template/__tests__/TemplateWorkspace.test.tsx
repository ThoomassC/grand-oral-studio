import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTemplate } from "@/domain/defaults";
import type { PromptTemplate } from "@/domain/schemas";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/trame", useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("@/server/actions/programs", () => ({ updateBrand: vi.fn(), updateTemplate: vi.fn() }));
vi.mock("@/server/actions/imports", () => ({ analyzeTemplatePrompt: vi.fn() }));
const { TemplateWorkspace } = await import("@/components/template/TemplateWorkspace");

const V0 = "2026-10-01T08:00:00.000Z";
const V1 = "2026-10-01T08:05:00.000Z";

const CURRENT: PromptTemplate = {
  ...defaultTemplate(),
  durationMinutes: 20,
  sections: [{ id: "a", title: "Contexte actuel", guidance: "Enjeu", slides: 2, seconds: 180 }],
};
const OTHER_TEMPLATE: PromptTemplate = {
  ...defaultTemplate(),
  durationMinutes: 15,
  sections: [
    { id: "x", title: "Accroche de la trame", guidance: "", slides: 1 },
    { id: "y", title: "Développement", guidance: "Deux parties", slides: 4 },
  ],
};

afterEach(() => {
  cleanup();
  refresh.mockReset();
});

describe("Page Trame — édition", () => {
  it("ne devrait pas remplacer une saisie non enregistrée lors du rafraîchissement serveur", async () => {
    const { rerender } = render(<TemplateWorkspace programId="p1" initialTemplate={CURRENT} savedAt={V0} />);
    const user = userEvent.setup();
    await user.type(screen.getByDisplayValue("Contexte actuel"), " — brouillon");
    rerender(<TemplateWorkspace programId="p1" initialTemplate={OTHER_TEMPLATE} savedAt={V1} />);
    expect(screen.getByDisplayValue("Contexte actuel — brouillon")).toBeInTheDocument();
  });
});

describe("Page Trame — lecteur", () => {
  it("devrait montrer la trame en lecture seule, sans import ni éditeur", () => {
    render(<TemplateWorkspace programId="p1" initialTemplate={OTHER_TEMPLATE} savedAt={V0} readOnly />);
    expect(screen.getByRole("heading", { name: "Diapos de la trame", level: 3 })).toBeInTheDocument();
    const lines = screen.getByRole("list", { name: /Lignes/ });
    expect(within(lines).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Accroche de la trame — 1 diapo",
      "Développement — 4 diaposDeux parties",
    ]);
    expect(screen.getByText("15 min")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
