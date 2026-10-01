import { randomUUID } from "node:crypto";

/**
 * Journalisation structurée (une ligne JSON par évènement) avec identifiant de
 * corrélation. Les clés sensibles sont masquées récursivement : on ne journalise
 * jamais de secret, token, mot de passe ni contenu utilisateur volumineux.
 */

type Level = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|logo|dataurl/i;
const MAX_STRING = 500;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[profondeur]";
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[${value.length} car.]` : value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      // La pile reste côté serveur (journal), jamais renvoyée au client.
      stack: value.stack?.split("\n").slice(0, 8).join("\n"),
      cause: value.cause === undefined ? undefined : redact(value.cause, depth + 1),
    };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[masqué]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level: Level, event: string, fields: LogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(redact(fields) as LogFields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  readonly correlationId: string;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export function createLogger(base: LogFields = {}, correlationId: string = newCorrelationId()): Logger {
  const ctx = { correlationId, ...base };
  return {
    correlationId,
    debug: (e, f = {}) => {
      if (process.env.NODE_ENV !== "production") write("debug", e, { ...ctx, ...f });
    },
    info: (e, f = {}) => write("info", e, { ...ctx, ...f }),
    warn: (e, f = {}) => write("warn", e, { ...ctx, ...f }),
    error: (e, f = {}) => write("error", e, { ...ctx, ...f }),
    child: (f) => createLogger({ ...base, ...f }, correlationId),
  };
}

/** Identifiant court, lisible par l'utilisateur dans un message d'erreur (« réf. XXXX »). */
export function newCorrelationId(): string {
  return randomUUID().slice(0, 8);
}
