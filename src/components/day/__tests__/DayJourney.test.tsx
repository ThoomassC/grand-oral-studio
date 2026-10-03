import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassificationOutcome } from "@/domain/contracts";

const classify = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/server/actions/generation", () => ({
  classifyProblem: (...args: unknown[]) => classify(...args),
  generateFinalDeck: vi.fn(),
}));

const { DayJourney } = await import("@/components/day/DayJourney");

const THEMES = [
  { id: "t1", name: "Transition énergétique", hasSkeleton: true },
  { id: "t2", name: "Économie circulaire", hasSkeleton: false },
];

function outcome(overrides: Partial<ClassificationOutcome>): ClassificationOutcome {
  return {
    reformulatedProblem: "Comment financer la transition énergétique des PME ?",
    ranked: [{ themeId: "t1", themeName: "Transition énergétique", confidence: 0.3, rationale: "Mots en commun." }],
    source: "ai",
    fallbackReason: null,
    ...overrides,
  };
}

async function recognize(result: ClassificationOutcome) {
  classify.mockResolvedValue({ ok: true, data: result });
  const user = userEvent.setup();
  render(<DayJourney programId="p1" themes={THEMES} recentDeck={null} writer={{ label: "Gratuit (trame à compléter)", outlineOnly: true, waitHint: "Cela prend quelques secondes." }} />);
  await user.type(screen.getByLabelText("Problématique tirée au sort"), "Comment les PME peuvent-elles financer leur transition ?");
  await user.click(screen.getByRole("button", { name: "Reconnaître le thème" }));
  await screen.findByText("Thème retenu pour le diaporama");
}

afterEach(() => {
  cleanup();
  classify.mockReset();
  try {
    window.sessionStorage.clear();
  } catch {
    // stockage indisponible dans cet environnement
  }
});

describe("DayJourney — reconnaissance sans IA", () => {
  it("devrait expliquer le repli sur le moteur gratuit et inviter à vérifier le thème", async () => {
    await recognize(outcome({ source: "free", fallbackReason: "Claude est momentanément indisponible." }));
    expect(
      screen.getByText("Reconnaissance sans IA : Claude est momentanément indisponible. Vérifiez le thème proposé."),
    ).toBeInTheDocument();
  });

  it("devrait le mentionner discrètement quand le moteur gratuit est choisi", async () => {
    await recognize(outcome({ source: "free", fallbackReason: null }));
    expect(screen.getByText("Reconnaissance sans IA, par mots-clés")).toBeInTheDocument();
    expect(screen.queryByText(/Vérifiez le thème proposé/)).not.toBeInTheDocument();
  });

  it("ne devrait rien signaler pour une reconnaissance par IA", async () => {
    await recognize(outcome({ source: "ai" }));
    expect(screen.queryByText(/Reconnaissance sans IA/)).not.toBeInTheDocument();
  });

  it("devrait rappeler le moteur qui rédigera, avec un lien pour le changer", async () => {
    await recognize(outcome({ source: "free" }));
    expect(screen.getByText(/Rédaction :/).closest("p")).toHaveTextContent("Rédaction : Gratuit (trame à compléter)");
    expect(screen.getByRole("link", { name: /Changer/ })).toHaveAttribute("href", "/configuration-ia");
  });
});
