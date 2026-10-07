import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const WRITER: Parameters<typeof DayJourney>[0]["writer"] = {
  label: "Sans IA",
  outlineOnly: true,
  waitHint: "Cela prend quelques secondes.",
  engine: "free",
  keySource: null,
  ready: true,
  problem: null,
};
/** Options de génération envoyées par défaut : jour J, chrono absent, rédacteur enregistré. */
const DEFAULT_OPTIONS = { practice: false, prepStartedAt: null, override: null };

/** Réponse de generateFinalDeck en cas de succès (contrat v1.2 : avertissements, réutilisation, moteur). */
function succeeded(deckId: string) {
  return { ok: true, data: { deckId, warnings: [], reused: false, engine: "free" } };
}

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
    generate.mockResolvedValue(succeeded("d1"));
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
    expect(generate).toHaveBeenCalledWith("p1", null, PROBLEM, DEFAULT_OPTIONS);
    expect(push).toHaveBeenCalledWith("/projets/p1/decks/d1?nouveau=1");
  });
});

describe("DayJourney — génération longue", () => {
  afterEach(() => vi.restoreAllMocks());

  it("devrait proposer « Recharger la page » et dire où apparaîtra le diaporama terminé entre-temps", async () => {
    generate.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderJourney([]);
    await typeProblem(user);
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    const start = Date.now();
    await user.click(screen.getByRole("button", { name: "Générer le diaporama" }));
    // Plus de 3 minutes plus tard (horloge lue à chaque seconde).
    vi.spyOn(Date, "now").mockReturnValue(start + 4 * 60 * 1000);
    const reload = await screen.findByRole("button", { name: "Recharger la page" }, { timeout: 2500 });
    expect(reload).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Relancer" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Si le diaporama se termine entre-temps, il apparaîtra en haut de cette page et dans Diaporamas : attendez avant de générer à nouveau\./),
    ).toBeInTheDocument();
  });
});

describe("DayJourney — un seul sujet", () => {
  it("devrait présélectionner le sujet sans reconnaissance, avec l'option « Sans sujet »", async () => {
    generate.mockResolvedValue(succeeded("d1"));
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
    expect(generate).toHaveBeenCalledWith("p1", "t1", PROBLEM, DEFAULT_OPTIONS);
  });

  it("devrait envoyer null quand « Sans sujet » est choisi", async () => {
    generate.mockResolvedValue(succeeded("d1"));
    const user = userEvent.setup();
    renderJourney([THEMES[0] as DayTheme]);
    await typeProblem(user);
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await user.click(screen.getByRole("radio", { name: "Sans sujet (problématique et trame seules)" }));
    expect(screen.getByText(/à partir de la problématique et de la trame/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Générer le diaporama" }));
    expect(generate).toHaveBeenCalledWith("p1", null, PROBLEM, DEFAULT_OPTIONS);
  });
});

describe("DayJourney — plusieurs sujets", () => {
  it("devrait reconnaître le sujet et proposer « Sans sujet », qui envoie null", async () => {
    generate.mockResolvedValue(succeeded("d1"));
    const user = await recognize(outcome({}));
    expect(classify).toHaveBeenCalledWith("p1", { problem: PROBLEM, hintedThemeId: null });
    const group = screen.getByRole("group", { name: "Sujet retenu pour le diaporama" });
    expect(within(group).getByRole("radio", { name: /Transition énergétique/ })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Un autre sujet du projet" })).toBeInTheDocument();
    await user.click(within(group).getByRole("radio", { name: "Sans sujet (problématique et trame seules)" }));
    await user.click(screen.getByRole("button", { name: "Générer le diaporama" }));
    expect(generate).toHaveBeenCalledWith("p1", null, PROBLEM, DEFAULT_OPTIONS);
  });

  it("devrait continuer avec le sujet indiqué sur l'énoncé sans reconnaissance", async () => {
    generate.mockResolvedValue(succeeded("d1"));
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
    expect(generate).toHaveBeenCalledWith("p1", "t2", PROBLEM, DEFAULT_OPTIONS);
  });

  it("ne devrait lancer qu'une génération sur un double clic", async () => {
    generate.mockReturnValue(new Promise(() => {}));
    const user = await recognize(outcome({}));
    await user.dblClick(screen.getByRole("button", { name: /Générer le diaporama|Génération en cours/ }));
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("DayJourney — « Reconnaître le sujet » depuis l'étape 2 (focus)", () => {
  beforeEach(() => {
    // jsdom ne calcule pas de boîtes : focusLater exige getClientRects() non vide.
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
  });
  afterEach(() => vi.restoreAllMocks());

  /** Sujet indiqué sur l'énoncé, « Continuer avec ce sujet », puis « Reconnaître le sujet » à l'étape 2. */
  async function recognizeFromStep2(user: ReturnType<typeof userEvent.setup>) {
    renderJourney();
    await typeProblem(user);
    await user.selectOptions(screen.getByLabelText(/Sujet indiqué sur l'énoncé/), "t2");
    await user.click(screen.getByRole("button", { name: "Continuer avec ce sujet" }));
    const step2 = screen.getByRole("region", { name: /Étape 2 sur 3/ });
    const button = within(step2).getByRole("button", { name: "Reconnaître le sujet" });
    await user.click(button);
    return button;
  }

  it("devrait placer le focus sur la problématique, puis y laisser l'erreur compréhensible", async () => {
    classify.mockRejectedValue(new TypeError("fetch failed"));
    const user = userEvent.setup();
    const button = await recognizeFromStep2(user);
    expect(button).not.toBeInTheDocument();
    const problem = screen.getByLabelText("Problématique tirée au sort");
    await waitFor(() => expect(problem).toHaveFocus());
    expect(
      await screen.findByText("La connexion a été interrompue. Votre problématique est conservée : réessayez."),
    ).toBeInTheDocument();
    expect(problem).toHaveValue(PROBLEM);
    expect(problem).toHaveFocus();
  });

  it("devrait placer le focus sur le titre de l'étape 2 une fois le sujet reconnu", async () => {
    classify.mockResolvedValue({ ok: true, data: outcome({}) });
    const user = userEvent.setup();
    await recognizeFromStep2(user);
    expect(classify).toHaveBeenCalledWith("p1", { problem: PROBLEM, hintedThemeId: "t2" });
    await waitFor(() => expect(screen.getByRole("heading", { name: /Étape 2 sur 3 :\s*Le sujet/ })).toHaveFocus());
  });
});

describe("DayJourney — titres", () => {
  it("devrait titrer les étapes au niveau 3, sous le titre « Jour J » de la page", async () => {
    const user = userEvent.setup();
    renderJourney([]);
    expect(screen.getByRole("heading", { name: /Étape 1 sur 2 :\s*La problématique/, level: 3 })).toBeInTheDocument();
    await typeProblem(user);
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    expect(screen.getByRole("heading", { name: /Étape 2 sur 2 :\s*Le diaporama/, level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
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
    // Rappel en fin de parcours (le bandeau du haut est vérifié à part).
    const step3 = screen.getByRole("region", { name: /Étape 3 sur 3/ });
    expect(within(step3).getByText(/Rédaction :/).closest("p")).toHaveTextContent(
      "Rédaction : Sans IA",
    );
    expect(within(step3).getByRole("link", { name: /Changer/ })).toHaveAttribute("href", "/configuration-ia");
    expect(document.body.textContent).not.toMatch(/squelette|thème/i);
  });
});

// ---------------------------------------------------------------------------
// v1.2 : bandeau du rédacteur, repli en un clic, entraînement, tirage au hasard
// ---------------------------------------------------------------------------

type Props = Parameters<typeof DayJourney>[0];
const MISTRAL_WRITER: Props["writer"] = {
  label: "Mistral (votre clé)",
  outlineOnly: false,
  waitHint: "Comptez une à deux minutes.",
  engine: "mistral",
  keySource: "user",
  ready: true,
  problem: null,
};
const CHOICES: NonNullable<Props["engineChoices"]> = [
  { override: { engine: "mistral", keySource: "user" }, label: "Mistral (votre clé)" },
  { override: { engine: "claude", keySource: "server" }, label: "Claude (clé d'équipe)" },
  { override: { engine: "openai", keySource: "user" }, label: "OpenAI (votre clé)" },
];
const RATE_LIMITED = {
  ok: false,
  error: "Mistral limite le nombre de requêtes en ce moment. Réessayez dans 30 s, ou choisissez un autre rédacteur.",
  code: "AI_RATE_LIMITED",
};

function renderWith(props: Partial<Props> = {}) {
  return render(<DayJourney programId="p1" themes={[]} recentDeck={null} writer={MISTRAL_WRITER} {...props} />);
}

/** Saisie, « Continuer », « Générer le diaporama » : l'échec est affiché. */
async function failOnce(props: Partial<Props> = {}, failure: unknown = RATE_LIMITED) {
  generate.mockResolvedValueOnce(failure);
  const user = userEvent.setup();
  renderWith(props);
  await typeProblem(user);
  await user.click(screen.getByRole("button", { name: "Continuer" }));
  await user.click(screen.getByRole("button", { name: /Générer le diaporama/ }));
  await screen.findByText(/limite le nombre de requêtes|introuvable|interrompue|Trop de générations/);
  return user;
}

describe("DayJourney — bandeau « Rédaction »", () => {
  it("devrait annoncer le rédacteur dès la saisie, avec un lien « Changer »", () => {
    renderWith();
    const banner = screen.getByText("Rédaction : Mistral (votre clé)").closest(".opale-feedback") as HTMLElement;
    expect(banner).not.toBeNull();
    expect(within(banner).getByRole("link", { name: /Changer/ })).toHaveAttribute("href", "/configuration-ia");
    // Avant l'étape 1 dans l'ordre du document.
    const problem = screen.getByLabelText("Problématique tirée au sort");
    expect(banner.compareDocumentPosition(problem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("devrait expliquer ce que produit « Sans IA »", () => {
    renderWith({ writer: { ...WRITER, label: "Sans IA" } });
    expect(screen.getByText("Rédaction : Sans IA")).toBeInTheDocument();
    expect(screen.getByText(/un diaporama à compléter, construit avec votre trame et vos notes/)).toBeInTheDocument();
  });

  it("devrait dire pourquoi le rédacteur choisi ne fonctionnera pas", () => {
    renderWith({
      writer: { ...MISTRAL_WRITER, ready: false, problem: "Ajoutez votre clé API Mistral dans la Rédaction IA pour lancer une génération." },
    });
    expect(screen.getByText(/Ajoutez votre clé API Mistral/)).toBeInTheDocument();
  });
});

describe("DayJourney — repli en un clic", () => {
  it("devrait proposer Réessayer, chaque autre connexion et « Sans IA », sans le rédacteur en échec", async () => {
    await failOnce({ engineChoices: CHOICES });
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(/Votre problématique et votre choix sont conservés/)).toBeInTheDocument();
    expect(within(alert).getByRole("link", { name: /Rédaction IA/ })).toHaveAttribute("href", "/configuration-ia");
    expect(alert).not.toHaveTextContent("Configuration IA");
    expect(within(alert).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Réessayer",
      "Générer avec Claude (clé d'équipe)",
      "Générer avec OpenAI (votre clé)",
      "Générer sans IA maintenant",
    ]);
  });

  it("devrait relancer avec le même moteur, avec une autre connexion, ou sans IA", async () => {
    const user = await failOnce({ engineChoices: CHOICES });
    generate.mockResolvedValueOnce(RATE_LIMITED);
    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(generate).toHaveBeenLastCalledWith("p1", null, PROBLEM, DEFAULT_OPTIONS);

    generate.mockResolvedValueOnce(RATE_LIMITED);
    await user.click(await screen.findByRole("button", { name: "Générer avec Claude (clé d'équipe)" }));
    expect(generate).toHaveBeenLastCalledWith("p1", null, PROBLEM, {
      ...DEFAULT_OPTIONS,
      override: { engine: "claude", keySource: "server" },
    });

    generate.mockResolvedValueOnce({ ok: true, data: { deckId: "d9", warnings: [], reused: false, engine: "free" } });
    await user.click(await screen.findByRole("button", { name: "Générer sans IA maintenant" }));
    expect(generate).toHaveBeenLastCalledWith("p1", null, PROBLEM, { ...DEFAULT_OPTIONS, override: { engine: "free" } });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projets/p1/decks/d9?nouveau=1"));
  });

  it("ne devrait proposer que « Réessayer » et « Sans IA » sans autre connexion", async () => {
    await failOnce({ engineChoices: [CHOICES[0]!] });
    expect(within(screen.getByRole("alert")).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Réessayer",
      "Générer sans IA maintenant",
    ]);
  });

  it("ne devrait pas proposer « Sans IA » quand c'est déjà le rédacteur", async () => {
    await failOnce(
      { writer: { ...WRITER, label: "Sans IA" } },
      { ok: false, error: "Trop de générations en peu de temps. Réessayez dans 2 min.", code: "RATE_LIMITED" },
    );
    const alert = await screen.findByRole("alert");
    expect(within(alert).queryByRole("button", { name: "Générer sans IA maintenant" })).not.toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("devrait remplacer « Réessayez dans … » par l'heure quand le serveur précise l'attente", async () => {
    await failOnce({ engineChoices: CHOICES }, { ...RATE_LIMITED, retryAfterSeconds: 90 });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Mistral limite le nombre de requêtes en ce moment\. Réessayez à \d{2}:\d{2}, ou choisissez un autre rédacteur\./);
    expect(alert).not.toHaveTextContent("Réessayez dans 30 s");
  });

  it("ne devrait rien proposer pour une erreur qui n'est pas due au rédacteur", async () => {
    await failOnce({ engineChoices: CHOICES }, { ok: false, error: "Ce projet est introuvable.", code: "NOT_FOUND" });
    expect(within(screen.getByRole("alert")).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("DayJourney — entraînement", () => {
  const WITH_PROBLEMS: DayTheme[] = [
    { id: "t1", name: "Transition énergétique", problems: ["Faut-il taxer le kérosène des avions ?"] },
    { id: "t2", name: "Économie circulaire", problems: [] },
  ];

  afterEach(() => vi.restoreAllMocks());

  it("devrait tirer une problématique au hasard et indiquer son sujet", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const user = userEvent.setup();
    renderWith({ themes: WITH_PROBLEMS, practice: true });
    await user.click(screen.getByRole("button", { name: "Tirer une problématique au hasard" }));
    expect(screen.getByLabelText("Problématique tirée au sort")).toHaveValue("Faut-il taxer le kérosène des avions ?");
    expect(screen.getByLabelText(/Sujet indiqué sur l'énoncé/)).toHaveValue("t1");
  });

  it("ne devrait pas proposer de tirage sans problématique enregistrée, ni le jour J", () => {
    renderWith({ themes: THEMES, practice: true });
    expect(screen.queryByRole("button", { name: "Tirer une problématique au hasard" })).not.toBeInTheDocument();
    cleanup();
    renderWith({ themes: WITH_PROBLEMS });
    expect(screen.queryByRole("button", { name: "Tirer une problématique au hasard" })).not.toBeInTheDocument();
  });

  it("devrait générer un diaporama d'entraînement, avec un brouillon distinct du jour J", async () => {
    generate.mockResolvedValue({ ok: true, data: { deckId: "d1", warnings: [], reused: false, engine: "mistral" } });
    const user = userEvent.setup();
    renderWith({ practice: true });
    await typeProblem(user);
    expect(window.sessionStorage.getItem("grand-oral-studio:jour-j:p1")).toBeNull();
    expect(window.sessionStorage.getItem("grand-oral-studio:jour-j:p1:entrainement")).toContain(PROBLEM);
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await user.click(screen.getByRole("button", { name: "Générer le diaporama d'entraînement" }));
    expect(generate).toHaveBeenCalledWith("p1", null, PROBLEM, { ...DEFAULT_OPTIONS, practice: true });
  });
});

describe("DayJourney — avertissements de génération", () => {
  it("devrait ranger les avertissements pour la page du diaporama", async () => {
    generate.mockResolvedValue({ ok: true, data: { deckId: "d7", warnings: ["Conclusion à relire."], reused: false, engine: "mistral" } });
    const user = userEvent.setup();
    renderWith();
    await typeProblem(user);
    await user.click(screen.getByRole("button", { name: "Continuer" }));
    await user.click(screen.getByRole("button", { name: "Générer le diaporama" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(JSON.parse(window.sessionStorage.getItem("grand-oral-studio:deck-notice:d7") ?? "null")).toEqual({
      v: 1,
      warnings: ["Conclusion à relire."],
    });
  });
});
