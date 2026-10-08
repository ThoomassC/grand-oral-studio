import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectProgressSummary } from "@/components/projects/ProjectProgressSummary";

afterEach(cleanup);

const TODO = { doneCount: 2, total: 3, nextStep: "day", rehearsalCount: 0 } as const;
const READY = { doneCount: 3, total: 3, nextStep: null, rehearsalCount: 4 } as const;

describe("ProjectProgressSummary", () => {
  it("devrait afficher l'avancement et proposer de reprendre à l'étape suivante", () => {
    render(
      <ProjectProgressSummary
        programId="p1"
        programName="Master"
        role="owner"
        progress={{ doneCount: 1, total: 3, nextStep: "template", rehearsalCount: 0 }}
      />,
    );
    expect(screen.getByText("1/3 étapes")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 étape faite sur 3" })).toBeInTheDocument();
    const resume = screen.getByRole("link", { name: /Reprendre : Trame/ });
    expect(resume).toHaveAttribute("href", "/projets/p1/trame");
    expect(resume).toHaveAccessibleName(/Master/);
  });

  it("devrait accorder l'avancement au pluriel", () => {
    render(<ProjectProgressSummary programId="p1" programName="Master" role="owner" progress={TODO} />);
    expect(screen.getByRole("img", { name: "2 étapes faites sur 3" })).toBeInTheDocument();
  });

  it("devrait proposer « S'entraîner » et « Jour J » au lieu de « Commencer le Jour J »", () => {
    for (const progress of [TODO, READY]) {
      render(<ProjectProgressSummary programId="p1" programName="Master" role="editor" progress={progress} />);
      const practice = screen.getByRole("link", { name: /^S'entraîner\s*— Master$/ });
      expect(practice).toHaveAttribute("href", "/projets/p1/jour-j?mode=entrainement");
      expect(practice).toHaveClass("opale-button--primary");
      const day = screen.getByRole("link", { name: /^Jour J\s*— Master$/ });
      expect(day).toHaveAttribute("href", "/projets/p1/jour-j");
      expect(day).toHaveClass("opale-button--ghost");
      expect(screen.queryByRole("link", { name: /Commencer le Jour J/ })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("devrait dire « Prêt pour le jour J · N répétitions faites » quand le projet est prêt", () => {
    render(<ProjectProgressSummary programId="p1" programName="Master" role="owner" progress={READY} />);
    expect(screen.getByText("Prêt pour le jour J · 4 répétitions faites")).toBeInTheDocument();
    expect(screen.queryByText("3/3 étapes")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "3 étapes faites sur 3" })).toBeInTheDocument();
  });

  it("devrait garder « n/3 étapes » tant que le projet n'est pas prêt", () => {
    render(<ProjectProgressSummary programId="p1" programName="Master" role="owner" progress={{ ...TODO, rehearsalCount: 1 }} />);
    expect(screen.getByText("2/3 étapes")).toBeInTheDocument();
    expect(screen.queryByText(/Prêt pour le jour J/)).not.toBeInTheDocument();
  });

  it("devrait mentionner le rédacteur actuel de l'utilisateur", () => {
    render(<ProjectProgressSummary programId="p1" programName="Master" role="owner" progress={TODO} writerLabel="Mistral" />);
    expect(screen.getByText("Rédaction : Mistral")).toBeInTheDocument();
  });

  it("ne devrait proposer à un lecteur ni l'entraînement ni le Jour J, seulement « Ouvrir »", () => {
    render(<ProjectProgressSummary programId="p1" programName="Master" role="viewer" progress={TODO} writerLabel="Mistral" />);
    expect(screen.queryByRole("link", { name: /S'entraîner/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Jour J/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Rédaction :/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Ouvrir\s*— Master$/ })).toHaveAttribute("href", "/projets/p1/apparence");
  });
});
