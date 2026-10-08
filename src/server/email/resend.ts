import { z } from "zod";
import { createLogger, type Logger } from "../logger";

/**
 * Envoi d'un e-mail transactionnel par l'API HTTP de Resend (fetch, sans SDK).
 *
 * - Ne lève jamais : renvoie un résultat typé. Un e-mail perdu ne doit pas faire
 *   échouer l'inscription ni révéler quoi que ce soit à l'appelant HTTP.
 * - Chaque tentative est bornée par un délai (AbortSignal).
 * - Nouvelle tentative avec attente croissante, UNIQUEMENT si le message porte
 *   une clé d'idempotence (Resend dédoublonne sur `Idempotency-Key`) et
 *   seulement sur panne passagère (réseau, délai, 429, 5xx). Un refus 4xx est
 *   définitif.
 * - Journal : statut, tentative, identifiant Resend. Jamais la clé, le
 *   destinataire, l'objet ni le corps (qui contient un lien à jeton).
 */

export const RESEND_API_URL = "https://api.resend.com/emails";

export interface ResendConfig {
  apiKey: string;
  from: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Clé de dédoublonnage côté Resend ; sans elle, aucune nouvelle tentative. */
  idempotencyKey?: string;
}

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; reason: "rejected" | "unavailable"; status?: number };

export interface SendEmailOptions {
  fetch?: typeof fetch;
  /** Délai par tentative. Défaut : 10 s. */
  timeoutMs?: number;
  /** Attente avant la 1re nouvelle tentative (doublée ensuite). Défaut : 500 ms. */
  retryDelayMs?: number;
  /** Tentatives au total quand l'envoi est idempotent. Défaut : 3. */
  maxAttempts?: number;
  log?: Logger;
  /** Étiquette non sensible pour le journal (« verification », « reset-password »). */
  kind?: string;
}

const ResendSuccess = z.object({ id: z.string() });

const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

type Attempt =
  | { kind: "sent"; id: string | null }
  | { kind: "rejected"; status: number }
  | { kind: "transient"; status?: number; cause: string };

export async function sendEmail(
  config: ResendConfig,
  message: EmailMessage,
  options: SendEmailOptions = {},
): Promise<SendEmailResult> {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const baseDelay = options.retryDelayMs ?? 500;
  const maxAttempts = message.idempotencyKey ? Math.max(1, options.maxAttempts ?? 3) : 1;
  const log = (options.log ?? createLogger()).child({ provider: "resend", emailKind: options.kind ?? "transactional" });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };
  if (message.idempotencyKey) headers["Idempotency-Key"] = message.idempotencyKey;
  const body = JSON.stringify({
    from: config.from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  let last: Attempt | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(baseDelay * 2 ** (attempt - 2));
    last = await tryOnce(doFetch, headers, body, timeoutMs);
    if (last.kind === "sent") {
      log.info("email.sent", { attempt, messageId: last.id });
      return { ok: true, id: last.id };
    }
    if (last.kind === "rejected") {
      log.error("email.rejected", { attempt, status: last.status });
      return { ok: false, reason: "rejected", status: last.status };
    }
    log.warn("email.attempt_failed", { attempt, maxAttempts, status: last.status, cause: last.cause });
  }
  const status = last?.kind === "transient" ? last.status : undefined;
  log.error("email.unavailable", { attempts: maxAttempts, status });
  return status === undefined ? { ok: false, reason: "unavailable" } : { ok: false, reason: "unavailable", status };
}

async function tryOnce(doFetch: typeof fetch, headers: Record<string, string>, body: string, timeoutMs: number): Promise<Attempt> {
  let response: Response;
  try {
    response = await doFetch(RESEND_API_URL, { method: "POST", headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    // Nom de l'erreur seulement : son message pourrait reprendre l'URL ou le corps.
    const cause = error instanceof Error && error.name === "TimeoutError" ? "timeout" : error instanceof Error ? error.name : "unknown";
    return { kind: "transient", cause };
  }
  if (response.ok) {
    const parsed = ResendSuccess.safeParse(await response.json().catch(() => null));
    // Accepté par Resend : envoyé, même si la réponse n'a pas la forme attendue.
    return { kind: "sent", id: parsed.success ? parsed.data.id : null };
  }
  // Le corps d'erreur n'est pas journalisé : il peut citer le destinataire.
  await response.body?.cancel().catch(() => {});
  if (response.status === 429 || response.status >= 500) {
    return { kind: "transient", status: response.status, cause: "http" };
  }
  return { kind: "rejected", status: response.status };
}
