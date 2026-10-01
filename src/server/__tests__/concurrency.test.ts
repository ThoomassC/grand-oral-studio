import { describe, expect, it } from "vitest";
import { createSemaphore, SemaphoreTimeoutError } from "@/server/concurrency";

describe("createSemaphore", () => {
  it("devrait limiter la concurrence et libérer la place après exécution, même en cas d'erreur", async () => {
    const sem = createSemaphore(1);
    let release: (() => void) | undefined;
    const held = sem.run(() => new Promise<void>((r) => (release = r)), 1_000);
    await expect(sem.run(async () => "x", 20)).rejects.toBeInstanceOf(SemaphoreTimeoutError);
    while (!release) await new Promise((r) => setTimeout(r, 0));
    release();
    await held;
    await expect(sem.run(async () => Promise.reject(new Error("boom")), 20)).rejects.toThrow("boom");
    await expect(sem.run(async () => "ok", 20)).resolves.toBe("ok");
    expect(sem.active).toBe(0);
  });

  it("devrait servir les attentes dans l'ordre quand une place se libère", async () => {
    const sem = createSemaphore(1);
    const order: number[] = [];
    let release: (() => void) | undefined;
    const first = sem.run(() => new Promise<void>((r) => (release = r)), 1_000);
    const second = sem.run(async () => void order.push(2), 1_000);
    const third = sem.run(async () => void order.push(3), 1_000);
    while (!release) await new Promise((r) => setTimeout(r, 0));
    expect(sem.waiting).toBe(2);
    release();
    await Promise.all([first, second, third]);
    expect(order).toEqual([2, 3]);
  });

  it("ne devrait pas laisser une attente expirée consommer une place plus tard", async () => {
    const sem = createSemaphore(1);
    let release: (() => void) | undefined;
    const held = sem.run(() => new Promise<void>((r) => (release = r)), 1_000);
    await expect(sem.run(async () => "late", 10)).rejects.toBeInstanceOf(SemaphoreTimeoutError);
    while (!release) await new Promise((r) => setTimeout(r, 0));
    release();
    await held;
    expect(sem.active).toBe(0);
    await expect(sem.run(async () => "ok", 10)).resolves.toBe("ok");
  });
});
