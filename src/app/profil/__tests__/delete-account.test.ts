import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Action de suppression du compte : adresse recopiée vérifiée côté serveur, erreurs Better Auth traduites. */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined, redirect: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "x" }) }));
vi.mock("@/server/session", () => ({
  requireUser: async () => ({ id: "user-1", email: "Eleve@Lycee-Exemple.fr", name: "Alice" }),
}));
const deleteUser = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: { api: { deleteUser: (...args: unknown[]) => deleteUser(...args) } } }));

const { deleteAccount } = await import("@/app/profil/actions");

beforeEach(() => {
  deleteUser.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("deleteAccount", () => {
  it("devrait refuser une adresse recopiée différente de celle du compte, sans rien supprimer", async () => {
    const result = await deleteAccount({ confirmEmail: "autre@lycee-exemple.fr" });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/ne correspond pas/) });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("devrait supprimer le compte de la session quand l'adresse est recopiée (casse et espaces ignorés)", async () => {
    deleteUser.mockResolvedValue({ success: true, message: "User deleted" });
    const result = await deleteAccount({ confirmEmail: "  eleve@lycee-exemple.fr " });
    expect(result).toEqual({ ok: true, data: null });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    const [arg] = deleteUser.mock.calls[0] as [{ body: unknown; headers: Headers }];
    // Aucun identifiant transmis : Better Auth supprime l'utilisateur de la session.
    expect(arg.body).toEqual({});
    expect(arg.headers).toBeInstanceOf(Headers);
  });

  it("devrait demander de se reconnecter quand la session n'est plus récente (SESSION_EXPIRED)", async () => {
    deleteUser.mockRejectedValue(
      APIError.from("BAD_REQUEST", { code: "SESSION_EXPIRED", message: "Session expired. Re-authenticate to perform this action." }),
    );
    const result = await deleteAccount({ confirmEmail: "eleve@lycee-exemple.fr" });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/reconnectez-vous/i) });
  });

  it("devrait traiter toute autre erreur comme une panne (message générique avec référence)", async () => {
    deleteUser.mockRejectedValue(new Error("connection reset"));
    const result = await deleteAccount({ confirmEmail: "eleve@lycee-exemple.fr" });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/référence/) });
    expect(JSON.stringify(result)).not.toContain("connection reset");
  });
});
