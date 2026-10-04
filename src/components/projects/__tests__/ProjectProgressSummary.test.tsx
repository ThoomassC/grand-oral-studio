import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectProgressSummary } from "@/components/projects/ProjectProgressSummary";

afterEach(cleanup);

describe("ProjectProgressSummary", () => {
  it("devrait afficher l'avancement et proposer de reprendre à l'étape suivante", () => {
    render(<ProjectProgressSummary programId="p1" programName="Master" progress={{ doneCount: 1, total: 3, nextStep: "skeletons" }} />);
    expect(screen.getByText("1/3 étapes")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 étape faite sur 3" })).toBeInTheDocument();
    const resume = screen.getByRole("link", { name: /Reprendre : Squelettes/ });
    expect(resume).toHaveAttribute("href", "/projets/p1/squelettes");
    expect(resume).toHaveAccessibleName(/Master/);
  });

  it("devrait accorder l'avancement au pluriel", () => {
    render(<ProjectProgressSummary programId="p1" programName="Master" progress={{ doneCount: 2, total: 3, nextStep: "day" }} />);
    expect(screen.getByRole("img", { name: "2 étapes faites sur 3" })).toBeInTheDocument();
  });

  it("devrait reprendre à Préparer (les thèmes) pour un projet neuf", () => {
    render(<ProjectProgressSummary programId="p1" programName="Master" progress={{ doneCount: 0, total: 3, nextStep: "prepare" }} />);
    expect(screen.getByRole("link", { name: /Reprendre : Préparer/ })).toHaveAttribute("href", "/projets/p1");
  });

  it("devrait proposer de commencer le Jour J quand la préparation est faite", () => {
    for (const nextStep of ["day", null] as const) {
      render(<ProjectProgressSummary programId="p1" programName="Master" progress={{ doneCount: nextStep ? 2 : 3, total: 3, nextStep }} />);
      expect(screen.getByRole("link", { name: /Commencer le Jour J/ })).toHaveAttribute("href", "/projets/p1/jour-j");
      cleanup();
    }
  });
});
