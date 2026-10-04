import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PasswordInput } from "@/components/auth/PasswordInput";

// globals: false dans vitest.config → pas de nettoyage automatique de Testing Library.
afterEach(cleanup);

function setup() {
  render(
    <form onSubmit={(e) => e.preventDefault()}>
      <label htmlFor="pwd">Mot de passe</label>
      <PasswordInput id="pwd" name="password" autoComplete="current-password" />
      <button type="submit">Se connecter</button>
    </form>,
  );
  const input = screen.getByLabelText("Mot de passe", { selector: "input" });
  const toggle = screen.getByRole("button", { name: "Afficher le mot de passe" });
  return { input, toggle };
}

describe("PasswordInput", () => {
  it("devrait masquer le mot de passe par défaut, sans toucher à l'autocomplétion", () => {
    const { input, toggle } = setup();
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "current-password");
    expect(input).toHaveAttribute("name", "password");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-controls", "pwd");
    expect(toggle).toHaveAttribute("title", "Afficher le mot de passe");
  });

  it("ne devrait pas envoyer le mot de passe affiché à un correcteur", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("autocapitalize", "none");
  });

  it("devrait afficher puis masquer le mot de passe, le focus restant sur le bouton", async () => {
    const user = userEvent.setup();
    const { input, toggle } = setup();

    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAccessibleName("Afficher le mot de passe");
    expect(toggle).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(input).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveFocus();
  });

  it("devrait conserver la position du curseur dans le champ", async () => {
    const user = userEvent.setup();
    const { input, toggle } = setup();
    const field = input as HTMLInputElement;
    await user.type(field, "motdepasse");
    field.setSelectionRange(3, 3);

    await user.click(toggle);
    expect(field.selectionStart).toBe(3);
    expect(field.selectionEnd).toBe(3);
  });

  it("devrait remasquer le mot de passe à la soumission du formulaire", async () => {
    const user = userEvent.setup();
    const { input, toggle } = setup();
    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");

    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(input).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });
});
