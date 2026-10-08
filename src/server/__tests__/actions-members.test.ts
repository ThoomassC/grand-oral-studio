import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, RateLimitedError } from "@/server/errors";

/** Transport des actions de partage : validation, quota, revalidation, notification après commit. */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined, redirect: () => undefined }));
vi.mock("@/server/session", () => ({
  requireUser: async () => ({ id: "owner-1", email: "claire@lycee.fr", name: "Claire" }),
}));

const consumeQuota = vi.fn();
vi.mock("@/server/rate-limit", () => ({ consumeQuota: (...args: unknown[]) => consumeQuota(...args) }));

const repo = { inviteMember: vi.fn(), changeRole: vi.fn(), removeMember: vi.fn(), leaveProject: vi.fn() };
vi.mock("@/server/repo/members", () => ({
  inviteMember: (...args: unknown[]) => repo.inviteMember(...args),
  changeRole: (...args: unknown[]) => repo.changeRole(...args),
  removeMember: (...args: unknown[]) => repo.removeMember(...args),
  leaveProject: (...args: unknown[]) => repo.leaveProject(...args),
}));

const sendEmail = vi.fn();
vi.mock("@/server/email/resend", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));
const scheduled: (() => Promise<unknown>)[] = [];
vi.mock("@/server/email/auth-emails", () => ({ runAfterResponse: (task: () => Promise<unknown>) => scheduled.push(task) }));

const actions = await import("@/server/actions/members");

const INVITED = {
  programName: "BTS <SIO>",
  member: { userId: "u-lea", name: "Léa", email: "lea@lycee.fr", role: "editor", addedAt: "2026-10-07T08:00:00.000Z" },
};

beforeEach(() => {
  scheduled.length = 0;
  for (const fn of [revalidatePath, consumeQuota, sendEmail, ...Object.values(repo)]) fn.mockReset();
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("EMAIL_FROM", "noreply@example.test");
  vi.stubEnv("BETTER_AUTH_URL", "https://studio.example.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("inviteMember", () => {
  it("devrait inviter avec l'adresse normalisée, revalider, puis notifier après la réponse", async () => {
    repo.inviteMember.mockResolvedValue(INVITED);
    const result = await actions.inviteMember("prog1", { email: " Lea@Lycee.FR ", role: "editor" });
    expect(result).toEqual({ ok: true, data: { member: INVITED.member } });
    expect(consumeQuota).toHaveBeenCalledWith("invite:owner-1", 1, expect.objectContaining({ limit: 30 }), "user");
    expect(repo.inviteMember).toHaveBeenCalledWith("owner-1", "prog1", "lea@lycee.fr", "editor");
    expect(revalidatePath).toHaveBeenCalledWith("/projets/prog1", "layout");

    // Rien n'est envoyé pendant l'action : la tâche part après la réponse.
    expect(sendEmail).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    const [config, message, options] = sendEmail.mock.calls[0]!;
    expect(config).toEqual({ apiKey: "re_test_key", from: "noreply@example.test" });
    expect(message).toMatchObject({
      to: "lea@lycee.fr",
      subject: expect.stringContaining("Claire vous a ajouté au projet « BTS <SIO> »"),
      idempotencyKey: "member-added:prog1:u-lea:2026-10-07T08:00:00.000Z",
    });
    expect(message.text).toContain("https://studio.example.test/projets/prog1");
    expect(message.html).toContain("BTS &lt;SIO&gt;");
    expect(options).toMatchObject({ kind: "member-added" });
  });

  it("ne devrait rien envoyer quand les e-mails ne sont pas configurés", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    repo.inviteMember.mockResolvedValue(INVITED);
    expect((await actions.inviteMember("prog1", { email: "lea@lycee.fr", role: "viewer" })).ok).toBe(true);
    expect(scheduled).toHaveLength(0);
  });

  it("ne devrait rien envoyer sans BETTER_AUTH_URL (lien impossible)", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    repo.inviteMember.mockResolvedValue(INVITED);
    expect((await actions.inviteMember("prog1", { email: "lea@lycee.fr", role: "viewer" })).ok).toBe(true);
    expect(scheduled).toHaveLength(0);
  });

  it("ne devrait ni notifier ni revalider quand le dépôt refuse", async () => {
    repo.inviteMember.mockRejectedValue(new ConflictError("Cette personne est déjà membre du projet."));
    const result = await actions.inviteMember("prog1", { email: "lea@lycee.fr", role: "viewer" });
    expect(result).toEqual({ ok: false, error: "Cette personne est déjà membre du projet." });
    expect(scheduled).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("devrait refuser une entrée invalide avant de consommer le quota", async () => {
    const result = await actions.inviteMember("prog1", { email: "pas-une-adresse", role: "owner" as never });
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["email", "role"]);
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(repo.inviteMember).not.toHaveBeenCalled();
  });

  it("devrait parler d'invitations quand le quota est atteint", async () => {
    consumeQuota.mockRejectedValue(new RateLimitedError(600));
    const result = await actions.inviteMember("prog1", { email: "lea@lycee.fr", role: "viewer" });
    expect(result).toEqual({ ok: false, error: "Trop d'invitations en peu de temps. Réessayez dans 10 min." });
    expect(repo.inviteMember).not.toHaveBeenCalled();
  });
});

describe("gestion des membres", () => {
  it("devrait valider le rôle et l'identifiant du membre avant de changer le rôle", async () => {
    expect((await actions.changeMemberRole("prog1", "u-lea", "admin")).ok).toBe(false);
    expect((await actions.changeMemberRole("prog1", "../x", "viewer")).ok).toBe(false);
    expect(repo.changeRole).not.toHaveBeenCalled();
    repo.changeRole.mockResolvedValue(undefined);
    expect(await actions.changeMemberRole("prog1", "u-lea", "viewer")).toEqual({ ok: true, data: null });
    expect(repo.changeRole).toHaveBeenCalledWith("owner-1", "prog1", "u-lea", "viewer");
  });

  it("devrait retirer un membre et quitter un projet au nom de l'utilisateur de la session", async () => {
    repo.removeMember.mockResolvedValue({ removed: true });
    repo.leaveProject.mockResolvedValue(undefined);
    expect(await actions.removeMember("prog1", "u-lea")).toEqual({ ok: true, data: { removed: true } });
    expect(repo.removeMember).toHaveBeenCalledWith("owner-1", "prog1", "u-lea");
    expect(await actions.leaveProject("prog1")).toEqual({ ok: true, data: null });
    expect(repo.leaveProject).toHaveBeenCalledWith("owner-1", "prog1");
    expect(revalidatePath).toHaveBeenCalledWith("/projets");
  });
});
