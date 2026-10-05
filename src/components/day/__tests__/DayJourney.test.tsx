import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassificationOutcome } from "@/domain/contracts";

const classify = vi.fn();
const generate = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/server/actions/generation", () => ({
  classifyProblem: (...args: unknown[]) => classify(...args),
  generateFinalDeck: (...args: unknown[]) => generate(...args),
}));

const { DayJourney } = await import("@/components/day/DayJourney");
type DayTheme = Parameters<typeof DayJourney>[0]["themes"][number];

const THEMES: DayTheme[] = [
  { id: "t1", name: "Transition énergétique" },
  { id: "t2", name: "Économie circulaire" },
];
const PROBLEM = "Comment les PME peuvent-elles financer leur transition ?";
const WRITER = { label: "Sans IA (trame remplie avec vos notes)", outlineOnly: true, waitHint: "Cela prend quelques secondes." };

function outcome(overrides: Partial<ClassificationOutcome>): ClassificationOutcome {
  return {
    reformulatedProblem: "Comment financer la transition énergétique des PME ?",
    ranked: [{ themeId: "t1", themeName: "Transition énergétique", confidence: 0.3, rationale: "Mots en commun." }],
    source: "ai",
    fallbackReason: null,
    ...overrides,
  };
}

function renderJourney(themes: DayTheme[] = THEMES) {
  return render(<DayJourney programId="p1" themes={themes} recentDeck={null} writer={WRITER} />);
}

async function typeProblem(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Problématique tirée au sort"), PROBLEM);
}

async function recognize(result: ClassificationOutcome) {
  classify.mockResolvedValue({ ok: true, data: result });
  const user = userEvent.setup();
  renderJourney();
  await typeProblem(user);
  await user.click(screen.getByRole("button", { name: "Reconnaître le sujet" }));
  await screen.findByText("Sujet retenu pour le diaporama");
  return user;
}

afterEach(() => {
  cleanup();
  classify.mockReset();
  generate.mockReset();
  push.mockReset();
  try {
    window.sessionStorage.clear();
  } catch {
    // stockage indisponible dans cet environnement
  }
});

describe("DayJourney — projet sans sujet", () => {
  it("devrait passer de la problématique au diaporama, sans reconnaissance, et générer sans sujet", async () => {
    generate.mockResolvedValue({ ok: true, data: { deckId: "d1" } });
    const user = userEvent.setup();
    renderJourney([]);
    expect(screen.getByText("Sans sujet : le diaporama part de la problématique et de la trame.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ajouter des sujets" })).toHaveAttribute("href", "/projets/p1/trame/sujets");
    expect(screen.queryByLabelText(/Sujet indiqué sur l'énoncé/)).not.toBeInTheDocument();

    await typeProblem(user);
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(classify).not.toHaveBeenCalled();
    expect(screen.queryByText("Sujet retenu pour le diaporama")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Étape 2 sur 2 :\s*Le diaporama/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Générer le diaporama" }));
    expect(generate).toHaveBeenCalledWith("p1", null, PROBLEM);
    expect(push).toHaveBeenCalledWith("/projets/p1/decks/d1?nouveau=1");
  });
});

describe("DayJourney — un seul sujet", () => {
  it("devrait présélectionner le sujet sans reconnaissance, avec l'option « Sans sujet »", async () => {
    generate.mockResolvedValue({ ok: true, data: { deckId: "d1" } });
    const user = userEvent.setup();
    renderJourney([THEMES[0] as DayTheme]);
    expect(screen.queryByLabelText(/Sujet indiqué sur l'énoncé/)).not.toBeInTheDocument();
    await typeProblem(user);
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(classify).not.toHaveBeenCalled();

    const group = screen.getByRole("group", { name: "Sujet retenu pour le diaporama" });
    expect(within(group).getByRole("radio", { name: /Transition énergétique/ })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Sans sujet (problématique et trame seules)" })).not.toBeChecked();
    expect(within(group).queryByRole("radio", { name: "Un autre sujet du projet" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Générer le diaporama" }));
    expect(generate).toHaveBeenCalledWith("p1", "t1", PROBLEM);
  });

  it("devrait envoyer null quand « Sans sujet » est choisi", async () => {
    generate.mockResolvedValue({ ok: true, data: { deckId: "d1" } });
    const user = userEvent.setup();
    renderJourney([THEMES[0] as DayTheme]);
    await typeProblem(user);
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await user.click(screen.getByRole("radio", { name: "Sans sujet (problématique et trame seules)" }));
    expect(screen.getByText(/à partir de la problématique et de la trame/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Générer le diaporama" }));
    expect(generate).toHaveBeenCalledWith("p1", null, PROBLEM);
  });
});

describe("DayJourney — plusieurs sujets", () => {
  it("devrait reconnaître le sujet et proposer « Sans sujet », qui envoie null", async () => {
    generate.mockResolvedValue({ ok: true, data: { deckId: "d1" } });
    const user = await recognize(outcome({}));
    expect(classify).toHaveBeenCalledWith("p1", { problem: PROBLEM, hintedThemeId: null });
    const group = screen.getByRole("group", { name: "Sujet retenu pour le diaporama" });
    expect(within(group).getByRole("radio", { name: /Transition énergétique/ })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Un autre sujet du projet" })).toBeInTheDocument();
    await user.click(within(group).getByRole("radio", { name: "Sans sujet (problématique et trame seules)" }));
    await user.click(screen.getByRole("button", { name: "Générer le diaporama" }));
    expect(generate).toHaveBeenCalledWith("p1", null, PROBLEM);
  });

  it("devrait continuer avec le sujet indiqué sur l'énoncé sans reconnaissance", async () => {
    generate.mockResolvedValue({ ok: true, data: { deckId: "d1" } });
    const user = userEvent.setup();
    renderJourney();
    await typeProblem(user);
    const hint = screen.getByLabelText(/Sujet indiqué sur l'énoncé/);
    expect(within(hint).getByRole("option", { name: "Aucun sujet indiqué" })).toBeInTheDocument();
    await user.selectOptions(hint, "t2");
    expect(screen.getByRole("button", { name: "Reconnaître le sujet" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuer avec ce sujet" }));
    expect(classify).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /Économie circulaire/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Générer le diaporama" }));
    expect(generate).toHaveBeenCalledWith("p1", "t2", PROBLEM);
  });

  it("ne devrait lancer qu'une génération sur un double clic", async () => {
    generate.mockReturnValue(new Promise(() => {}));
    const user = await recognize(outcome({}));
    await user.dblClick(screen.getByRole("button", { name: /Générer le diaporama|Génération en cours/ }));
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("DayJourney — brouillon", () => {
  it("devrait revenir à l'étape 1, problématique conservée, quand le sujet choisi n'existe plus", async () => {
    window.sessionStorage.setItem(
      "grand-oral-studio:jour-j:p1",
      JSON.stringify({ problem: PROBLEM, hintedThemeId: "", stage: "chosen", result: null, choice: "supprime", otherThemeId: "" }),
    );
    renderJourney();
    expect(await screen.findByLabelText("Problématique tirée au sort")).toHaveValue(PROBLEM);
    expect(screen.queryByText("Sujet retenu pour le diaporama")).not.toBeInTheDocument();
  });
});

describe("DayJourney — reconnaissance sans IA", () => {
  it("devrait expliquer le repli sur le moteur sans IA et inviter à vérifier le sujet", async () => {
    await recognize(outcome({ source: "free", fallbackReason: "Claude est momentanément indisponible." }));
    expect(
      screen.getByText("Reconnaissance sans IA : Claude est momentanément indisponible. Vérifiez le sujet proposé."),
    ).toBeInTheDocument();
  });

  it("devrait le mentionner discrètement quand le moteur sans IA est choisi", async () => {
    await recognize(outcome({ source: "free", fallbackReason: null }));
    expect(screen.getByText("Reconnaissance sans IA, par mots-clés")).toBeInTheDocument();
    expect(screen.queryByText(/Vérifiez le sujet proposé/)).not.toBeInTheDocument();
  });

  it("ne devrait rien signaler pour une reconnaissance par IA", async () => {
    await recognize(outcome({ source: "ai" }));
    expect(screen.queryByText(/Reconnaissance sans IA/)).not.toBeInTheDocument();
  });

  it("devrait rappeler le moteur qui rédigera, avec un lien pour le changer, sans parler de squelette", async () => {
    await recognize(outcome({ source: "free" }));
    expect(screen.getByText(/Rédaction :/).closest("p")).toHaveTextContent(
      "Rédaction : Sans IA (trame remplie avec vos notes)",
    );
    expect(screen.getByRole("link", { name: /Changer/ })).toHaveAttribute("href", "/configuration-ia");
    expect(document.body.textContent).not.toMatch(/squelette|thème/i);
  });
});
