import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileNameSchema } from "@/components/profile/schema";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { ProfileNameForm } = await import("@/components/profile/ProfileNameForm");

afterEach(() => {
  cleanup();
  refresh.mockReset();
});

describe("ProfileNameSchema", () => {
  it("devrait accepter un nom de 2 à 80 caractères, espaces retirés", () => {
    expect(ProfileNameSchema.parse({ name: "  Alice  " })).toEqual({ name: "Alice" });
    expect(ProfileNameSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(ProfileNameSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
});

describe("ProfileNameForm", () => {
  it("devrait refuser un nom trop court sans appeler le serveur", async () => {
    const action = vi.fn();
    const user = userEvent.setup();
    render(<ProfileNameForm initialName="Alice" action={action} />);
    const input = screen.getByLabelText("Nom");
    await user.clear(input);
    await user.type(input, "A");
    await user.click(screen.getByRole("button", { name: "Enregistrer le nom" }));
    expect(await screen.findByText(/2 caractères au moins/)).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(action).not.toHaveBeenCalled();
  });

  it("devrait enregistrer le nom validé et l'annoncer", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, data: { name: "Alice Martin" } });
    const user = userEvent.setup();
    render(<ProfileNameForm initialName="Alice" action={action} />);
    const input = screen.getByLabelText("Nom");
    await user.clear(input);
    await user.type(input, "  Alice Martin ");
    await user.click(screen.getByRole("button", { name: "Enregistrer le nom" }));
    expect(action).toHaveBeenCalledWith({ name: "Alice Martin" });
    expect(await screen.findByText("Nom enregistré.")).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("devrait afficher l'erreur renvoyée par le serveur", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: "Le nom n'a pas pu être enregistré.", fieldErrors: { name: ["Nom refusé."] } });
    const user = userEvent.setup();
    render(<ProfileNameForm initialName="Alice" action={action} />);
    await user.click(screen.getByRole("button", { name: "Enregistrer le nom" }));
    expect(await screen.findByText("Nom refusé.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Le nom n'a pas pu être enregistré.");
  });
});
