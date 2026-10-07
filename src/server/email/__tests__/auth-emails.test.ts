import { describe, expect, it, vi } from "vitest";
import { createAuthEmails, runAfterResponse } from "@/server/email/auth-emails";

const CONFIG = { apiKey: "re_x", from: "noreply@exemple.fr" };
const USER = { email: "eleve@lycee-exemple.fr", name: "Alice" };

describe("createAuthEmails", () => {
  it("ne devrait pas attendre l'envoi : la réponse HTTP ne dépend ni de Resend ni de l'existence du compte", async () => {
    const tasks: Array<() => Promise<unknown>> = [];
    const send = vi.fn(() => new Promise(() => {}));
    const emails = createAuthEmails(CONFIG, { send, schedule: (t) => void tasks.push(t) });

    await emails.sendResetPassword({ user: USER, url: "https://app.exemple.fr/api/auth/reset-password/tok", token: "tok" });
    expect(send).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);

    void tasks[0]!();
    expect(send).toHaveBeenCalledTimes(1);
    const [message, kind] = send.mock.calls[0] as unknown as [Record<string, string>, string];
    expect(kind).toBe("reset-password");
    expect(message.to).toBe(USER.email);
    expect(message.text).toContain("https://app.exemple.fr/api/auth/reset-password/tok");
  });

  it("devrait dériver une clé d'idempotence stable du jeton, sans le recopier", async () => {
    const keys: string[] = [];
    const run = (t: () => Promise<unknown>) => void t();
    const send = vi.fn(async (m: { idempotencyKey?: string }) => void keys.push(m.idempotencyKey ?? ""));
    const emails = createAuthEmails(CONFIG, { send, schedule: run });
    const data = { user: USER, url: "https://app.exemple.fr/v?token=jeton-unique", token: "jeton-unique" };
    await emails.sendVerificationEmail(data);
    await emails.sendVerificationEmail(data);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^verification:[0-9a-f]{40}$/);
    expect(keys[0]).not.toContain("jeton-unique");
  });
});

describe("runAfterResponse", () => {
  it("devrait lancer la tâche sans l'attendre hors contexte de requête, en avalant son échec", async () => {
    const task = vi.fn(() => Promise.reject(new Error("panne")));
    expect(() => runAfterResponse(task)).not.toThrow();
    expect(task).toHaveBeenCalledTimes(1);
  });
});
