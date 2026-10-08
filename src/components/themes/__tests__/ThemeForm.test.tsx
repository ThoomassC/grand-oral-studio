import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/trame/sujets", useRouter: () => ({ push: vi.fn() }) }));

const { ThemeForm } = await import("@/components/themes/ThemeForm");

const P1 = "Faut-il taxer le kérosène pour décarboner l'aviation ?";
const P2 = "La sobriété énergétique est-elle compatible avec la croissance ?";

afterEach(async () => {
  cleanup();
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
});

function renderForm(onSubmit = vi.fn().mockResolvedValue({ ok: true, data: null }), initial?: Parameters<typeof ThemeForm>[0]["initial"]) {
  render(<ThemeForm initial={initial} submitLabel="Enregistrer" pendingLabel="Enregistrement…" onSubmit={onSubmit} />);
  return onSubmit;
}

const problemsField = () => screen.getByLabelText(/^Problématiques possibles/);

describe("ThemeForm — banque de problématiques", () => {
  it("devrait proposer un champ « Problématiques possibles », une par ligne, décrit par ses bornes", () => {
    renderForm();
    expect(problemsField().tagName).toBe("TEXTAREA");
    expect(problemsField()).toHaveAccessibleDescription(/Une par ligne.*30 au plus.*10 à 1\s500 caractères/);
    expect(screen.getByText("0 / 30 problématiques")).toBeInTheDocument();
  });

  it("devrait envoyer une problématique par ligne non vide, espaces retirés", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText("Nom du sujet"), "Énergie");
    fireEvent.change(problemsField(), { target: { value: `  ${P1}  \n\n${P2}\n   ` } });
    expect(screen.getByText("2 / 30 problématiques")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Énergie", description: "", keywords: [], notes: "", problems: [P1, P2] });
  });

  it("devrait reprendre les problématiques enregistrées, une par ligne, et pouvoir toutes les retirer", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm(undefined, { name: "Énergie", description: "", keywords: [], notes: "", problems: [P1, P2] });
    expect(problemsField()).toHaveValue(`${P1}\n${P2}`);
    await user.clear(problemsField());
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ problems: [] }));
  });

  it("devrait refuser une problématique trop courte, avec son rang, sans envoyer", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText("Nom du sujet"), "Énergie");
    fireEvent.change(problemsField(), { target: { value: `${P1}\nCourt ?` } });
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(problemsField()).toHaveAttribute("aria-invalid", "true");
    expect(problemsField()).toHaveAccessibleDescription(/Problématique 2 : Une problématique doit faire au moins 10 caractères\./);
  });

  it("devrait refuser plus de 30 problématiques", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await user.type(screen.getByLabelText("Nom du sujet"), "Énergie");
    const many = Array.from({ length: 31 }, (_, i) => `Problématique numéro ${i + 1} ?`).join("\n");
    fireEvent.change(problemsField(), { target: { value: many } });
    expect(screen.getByText("31 / 30 problématiques")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(problemsField()).toHaveAccessibleDescription(/30 problématiques au plus\./);
  });
});
