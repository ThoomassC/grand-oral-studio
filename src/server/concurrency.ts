/**
 * Sémaphore en mémoire (par processus) : borne le nombre d'opérations lourdes
 * simultanées (appels Ollama). Une attente est bornée ; au-delà,
 * SemaphoreTimeoutError. Les attentes sont servies dans l'ordre d'arrivée, et
 * une attente expirée ne consomme jamais de place.
 *
 * Limite : par instance. Plusieurs instances du serveur partagent un même Ollama
 * → le plafond réel est (instances × max) ; le quota global en base complète.
 */

export class SemaphoreTimeoutError extends Error {
  constructor() {
    super("attente d'une place dépassée");
    this.name = "SemaphoreTimeoutError";
  }
}

export interface Semaphore {
  run<T>(fn: () => Promise<T>, waitMs: number): Promise<T>;
  readonly active: number;
  readonly waiting: number;
}

interface Waiter {
  grant: () => void;
  settled: boolean;
}

export function createSemaphore(max: number): Semaphore {
  if (!Number.isInteger(max) || max < 1) throw new Error("createSemaphore: max entier ≥ 1 attendu");
  let active = 0;
  const queue: Waiter[] = [];

  function acquire(waitMs: number): Promise<void> {
    if (active < max) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        settled: false,
        grant: () => {
          clearTimeout(timer);
          waiter.settled = true;
          active += 1;
          resolve();
        },
      };
      const timer = setTimeout(() => {
        waiter.settled = true;
        const i = queue.indexOf(waiter);
        if (i >= 0) queue.splice(i, 1);
        reject(new SemaphoreTimeoutError());
      }, waitMs);
      queue.push(waiter);
    });
  }

  function release(): void {
    active -= 1;
    while (queue.length > 0) {
      const next = queue.shift();
      if (next && !next.settled) {
        next.grant();
        return;
      }
    }
  }

  return {
    async run(fn, waitMs) {
      await acquire(waitMs);
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
  };
}
