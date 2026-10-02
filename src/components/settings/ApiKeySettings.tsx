"use client";

import { Badge, type BadgeTone, Button } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useId, useRef, useState, useTransition } from "react";
import { SaveApiKeyInputSchema } from "@/domain/api-key";
import { deleteAnthropicApiKey, saveAnthropicApiKey, testAnthropicApiKey } from "@/server/actions/settings";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid, focusLater } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { LiveRegion } from "@/components/ui/LiveRegion";

/** État de la clé tel que lu par le serveur (aucune donnée secrète). */
export interface ApiKeyStatus {
  configured: boolean;
  last4: string | null;
  /** Date d'enregistrement déjà formatée côté serveur (fuseau Europe/Paris). */
  updatedAtLabel: string | null;
  effectiveSource: "user" | "server" | "mock" | "none";
  model: string;
}

/** La clé saisie n'est jamais conservée dans cet état : seulement les messages. */
interface SaveState {
  status: FormStatusState;
  fieldErrors: FieldErrors;
}

const INITIAL: SaveState = { status: IDLE, fieldErrors: {} };
const NETWORK_ERROR = "La connexion a été interrompue. Réessayez.";

const SOURCE_SUMMARY: Record<ApiKeyStatus["effectiveSource"], { badge: string; text: string; tone: BadgeTone }> = {
  user: {
    badge: "Clé personnelle",
    text: "Vos générations utilisent votre propre clé API.",
    tone: "success",
  },
  server: {
    badge: "Clé du serveur",
    text: "Aucune clé personnelle : l'app utilise la clé du serveur.",
    tone: "neutral",
  },
  mock: {
    badge: "Démo",
    text: "Mode démo : contenus factices. Ajoutez votre clé pour obtenir de vrais diaporamas.",
    tone: "warning",
  },
  none: {
    badge: "Aucune clé",
    text: "Aucune clé API : Claude n'est pas disponible. Le moteur gratuit (sans IA) fonctionne sans clé.",
    tone: "neutral",
  },
};

export function ApiKeySettings({ status }: { status: ApiKeyStatus }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const baseId = useId();
  const ids = { key: `${baseId}-key`, hint: `${baseId}-hint`, current: `${baseId}-current` };
  const [testing, startTest] = useTransition();
  const [testStatus, setTestStatus] = useState<FormStatusState>(IDLE);
  const [announce, setAnnounce] = useState("");

  const [state, submit, saving] = useActionState<SaveState, FormData>(async (_prev, formData) => {
    const input = { apiKey: String(formData.get("apiKey") ?? "") };
    // Même schéma que la Server Action (format seulement ; la validité est vérifiée par le serveur).
    const checked = validateWith(SaveApiKeyInputSchema, input);
    if (!checked.ok) {
      focusFirstInvalid(formRef.current);
      return { status: { kind: "error", message: "La clé saisie n'a pas le bon format." }, fieldErrors: checked.fieldErrors };
    }
    let result: Awaited<ReturnType<typeof saveAnthropicApiKey>>;
    try {
      result = await saveAnthropicApiKey(checked.data);
    } catch {
      return { status: { kind: "error", message: NETWORK_ERROR }, fieldErrors: {} };
    }
    if (!result.ok) {
      const fieldErrors = result.fieldErrors ?? {};
      if (firstError(fieldErrors, "apiKey")) focusFirstInvalid(formRef.current);
      return { status: { kind: "error", message: result.error }, fieldErrors };
    }
    // Succès : on vide le champ, la clé ne reste nulle part côté client.
    formRef.current?.reset();
    setTestStatus(IDLE);
    setAnnounce("");
    router.refresh();
    return {
      status: { kind: "success", message: `Clé vérifiée et enregistrée (se termine par ${result.data.last4}).` },
      fieldErrors: {},
    };
  }, INITIAL);

  function test() {
    if (testing || saving) return;
    setTestStatus(IDLE);
    startTest(async () => {
      try {
        const result = await testAnthropicApiKey();
        if (!result.ok) {
          setTestStatus({ kind: "error", message: result.error });
          return;
        }
        const who = result.data.source === "user" ? "votre clé" : "la clé du serveur";
        setTestStatus({ kind: "success", message: `Connexion réussie avec ${who} (modèle ${result.data.model}).` });
      } catch {
        setTestStatus({ kind: "error", message: NETWORK_ERROR });
      }
    });
  }

  const summary = SOURCE_SUMMARY[status.effectiveSource];
  const canTest = status.effectiveSource === "user" || status.effectiveSource === "server";
  const busy = saving || testing;

  return (
    <div className="flex flex-col gap-6">
      {/* État actuel, en clair. */}
      <div id={ids.current} className="rounded-lg border border-border bg-surface-2 p-4">
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={summary.tone}>{summary.badge}</Badge>
          {status.effectiveSource !== "mock" ? (
            <span className="text-sm text-muted">
              Modèle : <span className="num text-text">{status.model}</span>
            </span>
          ) : null}
        </p>
        {status.configured ? (
          <p className="mt-3">
            Votre clé : <span className="num font-bold">sk-ant-…{status.last4 ?? "????"}</span>
            {status.updatedAtLabel ? <>, enregistrée le {status.updatedAtLabel}</> : null}.
          </p>
        ) : null}
        <p className={status.configured ? "mt-1 text-sm text-muted" : "mt-3"}>{summary.text}</p>
      </div>

      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          const data = new FormData(e.currentTarget);
          startTransition(() => submit(data));
        }}
      >
        <div>
          <label htmlFor={ids.key} className="opale-field__label">
            {status.configured ? "Remplacer par une nouvelle clé" : "Votre clé API Anthropic"}
          </label>
          <PasswordInput
            id={ids.key}
            name="apiKey"
            autoComplete="off"
            data-1p-ignore=""
            data-lpignore="true"
            placeholder="sk-ant-…"
            maxLength={256}
            {...errorProps(state.fieldErrors, "apiKey", `${ids.key}-err`, ids.hint)}
          />
          <p id={ids.hint} className="opale-field__helper">
            Elle commence par « sk-ant- ». Elle est vérifiée auprès d&apos;Anthropic avant d&apos;être enregistrée.
          </p>
          <FieldError id={`${ids.key}-err`} message={firstError(state.fieldErrors, "apiKey")} />
        </div>
        <FormStatus state={state.status} />
        <LiveRegion className="sr-only">{saving ? "Vérification de la clé auprès d'Anthropic…" : null}</LiveRegion>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" aria-disabled={busy || undefined}>
            <ButtonLabel idle="Vérifier et enregistrer" busy="Vérification de la clé…" isBusy={saving} />
          </Button>
        </div>
      </form>

      {canTest || status.configured ? (
        <div className="flex flex-col gap-3 border-t border-border pt-5">
          <div className="flex flex-wrap items-start gap-2">
            {canTest ? (
              <Button type="button" variant="ghost" onClick={test} aria-disabled={busy || undefined}>
                <ButtonLabel idle="Tester la connexion" busy="Test en cours…" isBusy={testing} />
              </Button>
            ) : null}
            {status.configured ? (
              <ConfirmAction
                triggerId={`${baseId}-delete`}
                triggerLabel="Supprimer ma clé"
                title="Supprimer votre clé ?"
                size="medium"
                triggerDisabled={busy}
                question={
                  status.effectiveSource === "user"
                    ? "Supprimer votre clé ? Elle est effacée du serveur ; l'app utilisera la clé du serveur s'il y en a une."
                    : "Supprimer votre clé ? Elle est effacée du serveur."
                }
                confirmLabel="Supprimer la clé"
                onConfirm={async () => {
                  const result = await deleteAnthropicApiKey();
                  if (!result.ok) return result.error;
                  setTestStatus(IDLE);
                  setAnnounce("Votre clé a été supprimée.");
                  router.refresh();
                  return null;
                }}
                onDone={() => focusLater([ids.key])}
              />
            ) : null}
          </div>
          <FormStatus state={testStatus} />
        </div>
      ) : null}
      <LiveRegion className="text-sm font-medium text-success">{announce || null}</LiveRegion>
    </div>
  );
}
