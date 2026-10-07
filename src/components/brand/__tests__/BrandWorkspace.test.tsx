import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBrand } from "@/domain/defaults";
import type { Brand } from "@/domain/schemas";

vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/apparence", useRouter: () => ({ push: vi.fn() }) }));
const updateBrand = vi.fn();
vi.mock("@/server/actions/programs", () => ({ updateBrand: (...args: unknown[]) => updateBrand(...args) }));

const { BrandWorkspace } = await import("@/components/brand/BrandWorkspace");

/** Versions (brandSavedAt) de l'apparence : chargée avec la page, puis renvoyées par les enregistrements. */
const V0 = "2026-10-01T08:00:00.000Z";
const V1 = "2026-10-01T08:05:00.000Z";
const V2 = "2026-10-01T08:06:00.000Z";

afterEach(() => {
  cleanup();
  updateBrand.mockReset();
});

describe("Éditeur de la page Apparence", () => {
  it("ne devrait plus renvoyer vers une autre page pour importer (thèmes, sujets)", () => {
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/Thèmes/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Déposez votre présentation/)).not.toBeInTheDocument();
  });

  it("devrait garder l'apparence entièrement modifiable", () => {
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} format="16:9" />);
    expect(screen.getByLabelText(/^Principale/, { selector: "input:not([type=color])" })).toHaveValue("#1E3A5F");
    expect(screen.getByLabelText("Titres")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enregistrer/ })).toBeInTheDocument();
  });

  it("devrait garder « Apparence enregistrée. » quand la page se rafraîchit avec l'apparence enregistrée", async () => {
    updateBrand.mockResolvedValue({ ok: true, data: { brandSavedAt: V1 } });
    const initial = defaultBrand();
    const { rerender } = render(<BrandWorkspace programId="p1" initialBrand={initial} format="16:9" />);
    const name = screen.getByRole("textbox", { name: "Nom de l'apparence" });
    fireEvent.change(name, { target: { value: "Couleurs du master" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'apparence" }));
    await screen.findByText("Apparence enregistrée.");
    // Rafraîchissement serveur après l'enregistrement : même apparence, nouvelle date d'enregistrement.
    rerender(<BrandWorkspace programId="p1" initialBrand={{ ...initial, name: "Couleurs du master" }} format="16:9" />);
    expect(screen.getByText("Apparence enregistrée.")).toBeInTheDocument();
  });

  it("devrait reprendre l'apparence importée quand elle change côté serveur", async () => {
    const initial = defaultBrand();
    const { rerender } = render(<BrandWorkspace programId="p1" initialBrand={initial} format="16:9" />);
    const imported = { ...initial, name: "Apparence importée", colors: { ...initial.colors, primary: "#AA3300" } };
    rerender(<BrandWorkspace programId="p1" initialBrand={imported} format="16:9" />);
    await waitFor(() =>
      expect(screen.getByLabelText(/^Principale/, { selector: "input:not([type=color])" })).toHaveValue("#AA3300"),
    );
    expect(screen.getByRole("textbox", { name: "Nom de l'apparence" })).toHaveValue("Apparence importée");
  });

  it("devrait prévenir, sous le choix de police, qu'une police non système n'est pas incluse dans le .pptx", async () => {
    const initial: Brand = { ...defaultBrand(), fonts: { heading: "Arial", body: "Arial" } };
    render(<BrandWorkspace programId="p1" initialBrand={initial} format="16:9" />);
    const warning = /Cette police n'est pas incluse dans le fichier PowerPoint/;
    expect(screen.queryByText(warning)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Titres"), { target: { value: "Montserrat" } });
    const shown = await screen.findAllByText(warning);
    expect(shown).toHaveLength(1);
    // Sous le champ « Titres », pas sous « Texte ».
    const field = (label: string) =>
      document.querySelector(`label[for="${screen.getByLabelText(label).id}"]`)!.parentElement!;
    expect(field("Titres")).toContainElement(shown[0]!);
    expect(field("Texte")).not.toContainElement(shown[0]!);

    fireEvent.change(screen.getByLabelText("Titres"), { target: { value: "Georgia" } });
    await waitFor(() => expect(screen.queryByText(warning)).not.toBeInTheDocument());
  });
});

describe("Éditeur de la page Apparence — concurrence optimiste", () => {
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'apparence" }));

  it("devrait renvoyer la version reçue au chargement, puis celle du dernier enregistrement", async () => {
    updateBrand
      .mockResolvedValueOnce({ ok: true, data: { brandSavedAt: V1 } })
      .mockResolvedValueOnce({ ok: true, data: { brandSavedAt: V2 } });
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} savedAt={V0} format="16:9" />);
    save();
    await screen.findByText("Apparence enregistrée.");
    save();
    await waitFor(() => expect(updateBrand).toHaveBeenCalledTimes(2));
    expect(updateBrand.mock.calls.map((call) => call[2])).toEqual([V0, V1]);
  });

  it("devrait reprendre la version du serveur avec l'apparence importée", async () => {
    updateBrand.mockResolvedValue({ ok: true, data: { brandSavedAt: V2 } });
    const initial = defaultBrand();
    const { rerender } = render(<BrandWorkspace programId="p1" initialBrand={initial} savedAt={V0} format="16:9" />);
    rerender(<BrandWorkspace programId="p1" initialBrand={{ ...initial, name: "Importée" }} savedAt={V1} format="16:9" />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Nom de l'apparence" })).toHaveValue("Importée"));
    save();
    await waitFor(() => expect(updateBrand).toHaveBeenCalledTimes(1));
    expect(updateBrand.mock.calls[0]?.[2]).toBe(V1);
  });

  it("devrait afficher le conflit et garder la saisie quand l'apparence a changé entre-temps", async () => {
    const conflict = "L'apparence a été modifiée entre-temps (autre onglet ou autre membre du projet). Rechargez la page.";
    updateBrand.mockResolvedValue({ ok: false, error: conflict, code: "CONFLICT" });
    render(<BrandWorkspace programId="p1" initialBrand={defaultBrand()} savedAt={null} format="16:9" />);
    const name = screen.getByRole("textbox", { name: "Nom de l'apparence" });
    fireEvent.change(name, { target: { value: "Ma charte" } });
    save();
    expect(await screen.findByText(conflict)).toBeInTheDocument();
    expect(updateBrand.mock.calls[0]?.[2]).toBeNull();
    expect(name).toHaveValue("Ma charte");
  });
});
