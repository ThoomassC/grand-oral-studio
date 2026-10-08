import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangePasswordSchema } from "@/components/profile/schema";

const changePassword = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { changePassword: (...args: unknown[]) => changePassword(...args) },
}));

const { ChangePasswordForm } = await import("@/components/profile/ChangePasswordForm");

afterEach(() => {
  cleanup();
  changePassword.mockReset();
  refresh.mockReset();
});

async function fill(current: string, next: string) {
  const user = userEvent.setup();
  render(<ChangePasswordForm />);
  if (current) await user.type(screen.getByLabelText("Mot de passe actuel"), current);
  if (next) await user.type(screen.getByLabelText("Nouveau mot de passe"), next);
  await user.click(screen.getByRole("button", { name: "Changer le mot de passe" }));
}

describe("ChangePasswordSchema", () => {
  it("devrait exiger le mot de passe actuel et un nouveau de 10 à 128 caractères, différent", () => {
    expect(ChangePasswordSchema.safeParse({ currentPassword: "ancien-mdp", newPassword: "nouveau-mdp-1" }).success).toBe(true);
    expect(ChangePasswordSchema.safeParse({ currentPassword: "", newPassword: "nouveau-mdp-1" }).success).toBe(false);
    expect(ChangePasswordSchema.safeParse({ currentPassword: "ancien-mdp", newPassword: "court" }).success).toBe(false);
    expect(ChangePasswordSchema.safeParse({ currentPassword: "a", newPassword: "x".repeat(129) }).success).toBe(false);
    expect(ChangePasswordSchema.safeParse({ currentPassword: "meme-mdp-123", newPassword: "meme-mdp-123" }).success).toBe(false);
  });
});

describe("ChangePasswordForm", () => {
  it("devrait refuser un nouveau mot de passe trop court sans appeler le serveur", async () => {
    await fill("ancien-mdp-1", "court");
    expect(await screen.findByText(/au moins 10 caractères/)).toBeInTheDocument();
    expect(screen.getByLabelText("Nouveau mot de passe")).toHaveAttribute("aria-invalid", "true");
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("devrait changer le mot de passe, déconnecter les autres sessions et vider les champs", async () => {
    changePassword.mockResolvedValue({ data: { token: "t" }, error: null });
    await fill("ancien-mdp-1", "nouveau-mdp-1");
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: "ancien-mdp-1",
      newPassword: "nouveau-mdp-1",
      revokeOtherSessions: true,
    });
    expect(await screen.findByText(/Mot de passe modifié/)).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe actuel")).toHaveValue("");
    expect(screen.getByLabelText("Nouveau mot de passe")).toHaveValue("");
  });

  it("devrait signaler un mot de passe actuel incorrect sur le bon champ", async () => {
    changePassword.mockResolvedValue({ data: null, error: { status: 400, code: "INVALID_PASSWORD" } });
    await fill("mauvais-mdp", "nouveau-mdp-1");
    expect(await screen.findByText("Le mot de passe actuel est incorrect.")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe actuel")).toHaveAttribute("aria-invalid", "true");
  });

  it("devrait expliquer qu'un compte Google n'a pas de mot de passe", async () => {
    changePassword.mockResolvedValue({ data: null, error: { status: 400, code: "CREDENTIAL_ACCOUNT_NOT_FOUND" } });
    await fill("quelque-chose", "nouveau-mdp-1");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Google/);
  });

  it("devrait signaler la limitation de débit et une coupure réseau", async () => {
    changePassword.mockResolvedValueOnce({ data: null, error: { status: 429 } });
    await fill("ancien-mdp-1", "nouveau-mdp-1");
    expect(await screen.findByText(/Trop de tentatives/)).toBeInTheDocument();
    cleanup();
    changePassword.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await fill("ancien-mdp-1", "nouveau-mdp-1");
    expect(await screen.findByText("La connexion a été interrompue. Réessayez.")).toBeInTheDocument();
  });
});
