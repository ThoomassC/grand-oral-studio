import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTemplate } from "@/domain/defaults";
import type { PromptTemplate } from "@/domain/schemas";

const update = vi.fn();
vi.mock("@/server/actions/programs", () => ({
  updateBrand: vi.fn(),
  updateTemplate: (...args: unknown[]) => update(...args),
}));

const { TemplateEditor } = await import("@/components/template/TemplateEditor");

/** Versions (templateSavedAt) de la trame : chargée avec la page, puis renvoyées par les enregistrements. */
const V0 = "2026-10-01T08:00:00.000Z";
const V1 = "2026-10-01T08:05:00.000Z";
const V2 = "2026-10-01T08:06:00.000Z";

const TIMED: PromptTemplate = {
  ...defaultTemplate(),
  durationMinutes: 20,
  sections: [
    { id: "a", title: "Contexte", guidance: "Enjeu et deux chiffres clés", slides: 2, seconds: 180 },
    { id: "b", title: "Pistes", guidance: "", slides: 3 },
  ],
};

function renderEditor(initial: PromptTemplate = defaultTemplate()) {
  return render(<TemplateEditor programId="p1" initialTemplate={initial} />);
}

/** La ligne n (1 = première ligne après la couverture). */
function line(n: number): HTMLElement {
  return screen.getByRole("group", { name: new RegExp(`^Ligne ${n}\\b`) });
}

beforeEach(() => {
  // jsdom ne calcule pas de boîtes : focusLater exige getClientRects() non vide.
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
});

afterEach(() => {
  cleanup();
  update.mockReset();
  vi.restoreAllMocks();
});

describe("Éditeur de trame — lignes et contenu type", () => {
  it("devrait montrer la couverture fixe puis la plage de diapos de chaque ligne", () => {
    renderEditor();
    // Sous-bloc de la page Trame (h2) : niveau 3.
    expect(screen.getByRole("heading", { name: "Diapos de la trame", level: 3 })).toBeInTheDocument();
    const cover = screen.getByText("Couverture").closest("li");
    expect(cover).toHaveTextContent("Diapo 1");
    expect(cover).toHaveTextContent("La problématique tirée et le titre du sujet. Ajoutée automatiquement.");
    expect(within(cover as HTMLElement).queryByRole("textbox")).toBeNull();
    expect(line(1)).toHaveAccessibleName(/^Ligne 1, diapo 2$/i);
    expect(line(4)).toHaveAccessibleName(/^Ligne 4, diapos 5-7$/i);
    expect(within(line(1)).getByLabelText("Titre de la ligne 1")).toHaveValue("Introduction");
    expect(within(line(1)).getByLabelText("Contenu type de la ligne 1")).toHaveAccessibleDescription(
      /Ce que disent ces diapos ; le jour J, ce contenu est développé pour la problématique\./,
    );
  });

  it("devrait recalculer les plages quand le nombre de diapos change", async () => {
    const user = userEvent.setup();
    renderEditor(TIMED);
    expect(line(2)).toHaveTextContent("Diapos 4-6");
    const slides = within(line(1)).getByLabelText("Nombre de diapos de la ligne 1");
    await user.clear(slides);
    await user.type(slides, "1");
    expect(line(1)).toHaveTextContent("Diapo 2");
    expect(line(2)).toHaveTextContent("Diapos 3-5");
    expect(screen.getByText("Modifications non enregistrées")).toBeInTheDocument();
  });

  it("devrait afficher la durée enregistrée d'une ligne et laisser « auto » aux autres", () => {
    renderEditor(TIMED);
    expect(within(line(1)).getByLabelText("Durée de la ligne 1")).toHaveValue("3:00");
    const auto = within(line(2)).getByLabelText("Durée de la ligne 2");
    expect(auto).toHaveValue("");
    expect(auto).toHaveAttribute("placeholder", "auto");
  });

  it("devrait résumer la trame en pied, avec les durées fixées", () => {
    renderEditor(TIMED);
    const footer = screen.getByText(/^6 diapos · 20 min/);
    expect(footer).toHaveTextContent("Durées fixées : 3:00 sur 20:00");
  });

  it("ne devrait pas parler de durées fixées quand aucune ligne n'en a", () => {
    renderEditor();
    expect(screen.getByText(/^13 diapos · 20 min/)).not.toHaveTextContent("Durées fixées");
  });

  it("ne devrait pas se signaler modifiée quand rien n'a changé (durée enregistrée)", () => {
    renderEditor(TIMED);
    expect(screen.queryByText("Modifications non enregistrées")).not.toBeInTheDocument();
  });
});

describe("Éditeur de trame — durée par ligne", () => {
  it("devrait enregistrer « 3:30 » comme 210 secondes, sans durée pour les lignes vides", async () => {
    update.mockResolvedValue({ ok: true, data: { templateSavedAt: V1 } });
    const user = userEvent.setup();
    renderEditor(TIMED);
    const duration = within(line(1)).getByLabelText("Durée de la ligne 1");
    await user.clear(duration);
    await user.type(duration, "3:30");
    expect(screen.getByText(/Durées fixées : 3:30 sur 20:00/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enregistrer la trame" }));

    expect(update).toHaveBeenCalledTimes(1);
    const sent = update.mock.calls[0]?.[1] as PromptTemplate;
    expect(update.mock.calls[0]?.[0]).toBe("p1");
    expect(sent.sections[0]?.seconds).toBe(210);
    expect("seconds" in (sent.sections[1] ?? {})).toBe(false);
    expect(await screen.findByText("Trame enregistrée.")).toBeInTheDocument();
    expect(screen.queryByText("Modifications non enregistrées")).not.toBeInTheDocument();
    expect(duration).toHaveValue("3:30");
  });

  it("devrait réécrire « 3 min » en « 3:00 » après l'enregistrement", async () => {
    update.mockResolvedValue({ ok: true, data: { templateSavedAt: V1 } });
    const user = userEvent.setup();
    renderEditor(TIMED);
    const duration = within(line(2)).getByLabelText("Durée de la ligne 2");
    await user.type(duration, "2 min");
    await user.click(screen.getByRole("button", { name: "Enregistrer la trame" }));
    expect(await screen.findByText("Trame enregistrée.")).toBeInTheDocument();
    expect(duration).toHaveValue("2:00");
    expect(screen.queryByText("Modifications non enregistrées")).not.toBeInTheDocument();
  });

  it("devrait retirer la durée d'une ligne dont le champ est vidé", async () => {
    update.mockResolvedValue({ ok: true, data: { templateSavedAt: V1 } });
    const user = userEvent.setup();
    renderEditor(TIMED);
    await user.clear(within(line(1)).getByLabelText("Durée de la ligne 1"));
    await user.click(screen.getByRole("button", { name: "Enregistrer la trame" }));
    const sent = update.mock.calls[0]?.[1] as PromptTemplate;
    expect("seconds" in (sent.sections[0] ?? {})).toBe(false);
  });

  it("devrait refuser « 3: » avec une erreur reliée au champ, focus dessus, sans appeler le serveur", async () => {
    const user = userEvent.setup();
    renderEditor(TIMED);
    const duration = within(line(2)).getByLabelText("Durée de la ligne 2");
    await user.type(duration, "3:");
    await user.click(screen.getByRole("button", { name: "Enregistrer la trame" }));

    expect(update).not.toHaveBeenCalled();
    expect(duration).toHaveAttribute("aria-invalid", "true");
    expect(duration).toHaveAccessibleDescription(/Durée attendue au format 3:30 \(minutes:secondes\)\./);
    await waitFor(() => expect(duration).toHaveFocus());
    expect(screen.getByText("1 champ est à corriger avant d'enregistrer.")).toBeInTheDocument();
    // La saisie n'est pas corrigée sous les doigts de l'utilisateur.
    expect(duration).toHaveValue("3:");
  });

  it("devrait refuser des durées qui dépassent l'oral, avec le message du schéma", async () => {
    const user = userEvent.setup();
    renderEditor(TIMED);
    const duration = within(line(2)).getByLabelText("Durée de la ligne 2");
    await user.type(duration, "19:00");
    expect(screen.getByText(/Durées fixées : 22:00 sur 20:00/)).toHaveTextContent("dépasse la durée de l'oral");
    await user.click(screen.getByRole("button", { name: "Enregistrer la trame" }));

    expect(update).not.toHaveBeenCalled();
    const message = await screen.findByText(/La durée des lignes dépasse celle de l'oral/);
    await waitFor(() => expect(message.closest("[tabindex='-1']")).toHaveFocus());
  });
});

describe("Éditeur de trame — ajout, suppression, ordre", () => {
  it("devrait ajouter une ligne en fin de liste, l'annoncer et placer le focus sur son titre", async () => {
    const user = userEvent.setup();
    renderEditor(TIMED);
    await user.click(screen.getByRole("button", { name: "Ajouter une ligne" }));
    const title = within(line(3)).getByLabelText("Titre de la ligne 3");
    expect(title).toHaveValue("Nouvelle ligne");
    expect(line(3)).toHaveTextContent("Diapo 7");
    expect(screen.getByText("Ligne ajoutée en fin de trame.")).toBeInTheDocument();
    await waitFor(() => expect(title).toHaveFocus());
  });

  it("devrait supprimer une ligne, l'annoncer et rendre le focus à la ligne suivante", async () => {
    const user = userEvent.setup();
    renderEditor(TIMED);
    await user.click(screen.getByRole("button", { name: "Supprimer la ligne 1 (Contexte)" }));
    expect(screen.queryByDisplayValue("Contexte")).not.toBeInTheDocument();
    expect(screen.getByText("Ligne « Contexte » supprimée.")).toBeInTheDocument();
    await waitFor(() => expect(within(line(1)).getByLabelText("Titre de la ligne 1")).toHaveFocus());
    expect(line(1)).toHaveTextContent("Diapos 2-4");
  });

  it("devrait déplacer une ligne avec sa durée et l'annoncer", async () => {
    update.mockResolvedValue({ ok: true, data: { templateSavedAt: V1 } });
    const user = userEvent.setup();
    renderEditor(TIMED);
    await user.click(screen.getByRole("button", { name: "Descendre la ligne 1 (Contexte)" }));
    expect(screen.getByText("Ligne « Contexte » déplacée en position 2.")).toBeInTheDocument();
    expect(within(line(2)).getByLabelText("Titre de la ligne 2")).toHaveValue("Contexte");
    expect(within(line(2)).getByLabelText("Durée de la ligne 2")).toHaveValue("3:00");
    await user.click(screen.getByRole("button", { name: "Enregistrer la trame" }));
    const sent = update.mock.calls[0]?.[1] as PromptTemplate;
    expect(sent.sections.map((s) => [s.title, s.seconds])).toEqual([
      ["Pistes", undefined],
      ["Contexte", 180],
    ]);
  });

  it("devrait annuler les modifications, l'annoncer et placer le focus sur « Enregistrer la trame »", async () => {
    const user = userEvent.setup();
    renderEditor(TIMED);
    await user.type(within(line(2)).getByLabelText("Durée de la ligne 2"), "2:00");
    const cancel = screen.getByRole("button", { name: "Annuler les modifications" });
    await user.click(cancel);

    expect(within(line(2)).getByLabelText("Durée de la ligne 2")).toHaveValue("");
    expect(cancel).not.toBeInTheDocument();
    // Le bouton cliqué a disparu : le focus ne doit pas retomber sur <body>.
    await waitFor(() => expect(screen.getByRole("button", { name: "Enregistrer la trame" })).toHaveFocus());
    expect(screen.getByText("Modifications annulées.").closest("[role='status']")).not.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("devrait recharger la trame par défaut sans enregistrer", async () => {
    const user = userEvent.setup();
    renderEditor(TIMED);
    await user.click(screen.getByRole("button", { name: "Revenir à la trame par défaut" }));
    expect(within(line(1)).getByLabelText("Titre de la ligne 1")).toHaveValue("Introduction");
    expect(within(line(1)).getByLabelText("Durée de la ligne 1")).toHaveValue("");
    expect(screen.getByText("Trame par défaut chargée. Enregistrez pour l'appliquer.")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("Éditeur de trame — concurrence optimiste", () => {
  it("devrait renvoyer la version reçue au chargement, puis celle du dernier enregistrement", async () => {
    update
      .mockResolvedValueOnce({ ok: true, data: { templateSavedAt: V1 } })
      .mockResolvedValueOnce({ ok: true, data: { templateSavedAt: V2 } });
    const user = userEvent.setup();
    render(<TemplateEditor programId="p1" initialTemplate={TIMED} savedAt={V0} />);
    await user.click(screen.getByRole("button", { name: "Enregistrer la trame" }));
    await screen.findByText("Trame enregistrée.");
    await user.click(screen.getByRole("button", { name: "Enregistrer la trame" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls.map((call) => call[2])).toEqual([V0, V1]);
  });

  it("devrait envoyer null pour une trame jamais enregistrée", async () => {
    update.mockResolvedValue({ ok: true, data: { templateSavedAt: V1 } });
    const user = userEvent.setup();
    render(<TemplateEditor programId="p1" initialTemplate={TIMED} savedAt={null} />);
    await user.click(screen.getByRole("button", { name: "Enregistrer la trame" }));
    await screen.findByText("Trame enregistrée.");
    expect(update.mock.calls[0]?.[2]).toBeNull();
  });

  it("devrait afficher le conflit et garder la saisie quand la trame a changé entre-temps", async () => {
    const conflict = "La trame a été modifiée entre-temps (autre onglet ou autre membre du projet). Rechargez la page.";
    update.mockResolvedValue({ ok: false, error: conflict, code: "CONFLICT" });
    const user = userEvent.setup();
    render(<TemplateEditor programId="p1" initialTemplate={TIMED} savedAt={V0} />);
    const title = within(line(1)).getByLabelText("Titre de la ligne 1");
    await user.clear(title);
    await user.type(title, "Ma ligne");
    await user.click(screen.getByRole("button", { name: "Enregistrer la trame" }));
    expect(await screen.findByText(conflict)).toBeInTheDocument();
    expect(title).toHaveValue("Ma ligne");
  });

  it("ne devrait pas reprendre une version serveur dont la trame diffère de celle tenue pour enregistrée", async () => {
    update.mockResolvedValue({ ok: true, data: { templateSavedAt: V2 } });
    const user = userEvent.setup();
    const { rerender } = render(<TemplateEditor programId="p1" initialTemplate={TIMED} savedAt={V0} />);
    // Une autre trame enregistrée ailleurs arrive avec la page rafraîchie : l'éditeur garde sa version.
    rerender(<TemplateEditor programId="p1" initialTemplate={{ ...TIMED, tone: "Autre ton" }} savedAt={V1} />);
    await user.click(screen.getByRole("button", { name: "Enregistrer la trame" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[2]).toBe(V0);
  });
});
