import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkeletonBoard, type SkeletonThemeItem } from "@/components/skeletons/SkeletonBoard";

vi.mock("next/navigation", () => ({ usePathname: () => "/projets/p1/squelettes", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/actions/generation", () => ({ generateSkeleton: vi.fn(), generateAllSkeletons: vi.fn() }));

const brand = {
  colors: { primary: "#1F4E79", secondary: "#5B8DB8", accent: "#E07A1F", background: "#FFFFFF", text: "#222222" },
  fonts: { heading: "Montserrat", body: "Open Sans" },
  logoDataUrl: null,
} as const;

function theme(id: string, staleReason: string | null): SkeletonThemeItem {
  return {
    id,
    name: `Thème ${id}`,
    skeleton: {
      deckId: `deck-${id}`,
      engine: "ollama",
      slideCount: 17,
      updatedAtLabel: "mis à jour le 3 octobre",
      cover: { layout: "title", title: "Green IT", subtitle: "", bullets: [] },
      staleReason,
    },
  };
}

describe("SkeletonBoard — squelette périmé", () => {
  afterEach(cleanup);

  it("devrait afficher « À régénérer » et la raison quand le squelette ne suit plus le gabarit", () => {
    render(
      <SkeletonBoard
        programId="p1"
        themes={[theme("a", "Ne suit plus le gabarit actuel : 17 diapos au lieu de 31.")]}
        brand={{ ...brand, colors: { ...brand.colors }, fonts: { ...brand.fonts } }}
        format="16:9"
      />,
    );
    expect(screen.getByText("À régénérer")).toBeInTheDocument();
    expect(screen.queryByText("Généré")).not.toBeInTheDocument();
    expect(screen.getByText("Ne suit plus le gabarit actuel : 17 diapos au lieu de 31.")).toBeInTheDocument();
  });

  it("devrait afficher « Généré » pour un squelette à jour", () => {
    render(
      <SkeletonBoard programId="p1" themes={[theme("b", null)]} brand={{ ...brand, colors: { ...brand.colors }, fonts: { ...brand.fonts } }} format="16:9" />,
    );
    expect(screen.getByText("Généré")).toBeInTheDocument();
    expect(screen.queryByText("À régénérer")).not.toBeInTheDocument();
  });
});
