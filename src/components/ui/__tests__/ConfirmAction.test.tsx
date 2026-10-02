import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmAction } from "@/components/ui/ConfirmAction";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const BASE = {
  triggerLabel: "Supprimer",
  triggerAccessibleLabel: "Supprimer le projet BTS",
  title: "Supprimer le projet ?",
  question: "Supprimer « BTS », ses thèmes, squelettes et decks ? Cette action est définitive.",
  confirmLabel: "Supprimer définitivement",
};

describe("ConfirmAction (modale d'Opale)", () => {
  it("devrait ouvrir une modale titrée, décrite, avec le focus sur Annuler", async () => {
    const user = userEvent.setup();
    render(<ConfirmAction {...BASE} onConfirm={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Supprimer le projet BTS" }));
    const dialog = screen.getByRole("dialog", { name: "Supprimer le projet ?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/Cette action est définitive/);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Annuler" })).toHaveFocus());
    expect(within(dialog).getByRole("button", { name: "Supprimer définitivement" })).toHaveClass("opale-button--danger");
  });

  it("devrait annuler (bouton ou Échap) et rendre le focus au déclencheur", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmAction {...BASE} onConfirm={onConfirm} />);
    const trigger = screen.getByRole("button", { name: "Supprimer le projet BTS" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("devrait exiger la recopie du nom avant de confirmer", async () => {
    const onConfirm = vi.fn().mockResolvedValue(null);
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmAction {...BASE} requireText="BTS" onConfirm={onConfirm} onDone={onDone} />);
    await user.click(screen.getByRole("button", { name: "Supprimer le projet BTS" }));
    const input = screen.getByLabelText("Recopiez « BTS » pour confirmer");
    await waitFor(() => expect(input).toHaveFocus());
    const confirm = screen.getByRole("button", { name: "Supprimer définitivement" });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(input, "BTS");
    expect(confirm).not.toHaveAttribute("aria-disabled");
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onDone).toHaveBeenCalled();
  });

  it("devrait bloquer la fermeture pendant l'action puis afficher l'erreur", async () => {
    const pending = deferred<string | null>();
    const user = userEvent.setup();
    render(<ConfirmAction {...BASE} onConfirm={() => pending.promise} />);
    await user.click(screen.getByRole("button", { name: "Supprimer le projet BTS" }));
    await user.click(screen.getByRole("button", { name: "Supprimer définitivement" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toHaveAttribute("aria-disabled", "true");

    pending.resolve("Projet introuvable.");
    const error = await screen.findByText("Projet introuvable.");
    expect(error.closest("[role=alert]")).not.toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
