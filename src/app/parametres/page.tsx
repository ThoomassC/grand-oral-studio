import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ApiKeySettings, type ApiKeyStatus } from "@/components/settings/ApiKeySettings";
import { EngineSettings, type EngineStatus } from "@/components/settings/EngineSettings";
import { AppearanceSettings } from "@/components/theme/AppearanceSettings";
import { parseExplicitTheme, THEME_COOKIE } from "@/components/theme/theme";
import { formatDateTime } from "@/components/ui/format";
import { getAiSettings } from "@/server/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Paramètres" };

const CONSOLE_URL = "https://console.anthropic.com/settings/keys";

export default async function SettingsPage() {
  const user = await requireUser();
  // Lectures indépendantes en parallèle.
  const [settings, cookieStore] = await Promise.all([getAiSettings(user.id), cookies()]);
  const themePreference = parseExplicitTheme(cookieStore.get(THEME_COOKIE)?.value) ?? "system";

  // DTO explicite : seulement ce que l'interface affiche.
  const status: ApiKeyStatus = {
    configured: settings.userKey.configured,
    last4: settings.userKey.last4,
    updatedAtLabel: settings.userKey.updatedAt ? formatDateTime(new Date(settings.userKey.updatedAt)) : null,
    effectiveSource: settings.effectiveSource,
    model: settings.model,
  };
  const engine: EngineStatus = {
    selected: settings.engine.selected,
    effective: settings.engine.effective,
    available: {
      claude: settings.engine.available.claude,
      ollama: {
        configured: settings.engine.available.ollama.configured,
        reachable: settings.engine.available.ollama.reachable,
        models: settings.engine.available.ollama.models,
        selectedModel: settings.engine.available.ollama.selectedModel,
      },
      free: true,
    },
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="eyebrow">Compte</p>
      <h1 className="mt-2 text-3xl sm:text-4xl">Paramètres</h1>
      <p className="mt-2 text-muted">
        Le moteur qui rédige vos diaporamas, votre clé d&apos;accès à Claude et l&apos;apparence de l&apos;application.
      </p>

      <div className="mt-8 flex flex-col gap-6">
        <section aria-labelledby="moteur" className="card card-bristol p-5 pt-7 sm:p-6 sm:pt-8">
          <h2 id="moteur" className="text-2xl">
            Moteur de rédaction
          </h2>
          <p className="mt-1 text-muted">
            Qui reconnaît le thème de votre problématique et rédige squelettes et decks du jour J.
          </p>
          <div className="mt-5">
            <EngineSettings status={engine} />
          </div>
        </section>

        <section aria-labelledby="cle-api" className="card p-5 sm:p-6">
          <h2 id="cle-api" tabIndex={-1} className="scroll-mt-6 text-2xl focus:outline-none">
            Clé API Anthropic
          </h2>
          <p className="mt-1 text-muted">
            Nécessaire pour le moteur Claude. Avec votre propre clé, les générations sont facturées sur votre compte
            Anthropic.
          </p>
          <div className="mt-5">
            <ApiKeySettings status={status} />
          </div>

          <div className="mt-6 rounded-lg bg-surface-2 p-4 text-sm">
            <h3 className="text-base">Bon à savoir</h3>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
              <li>
                Créez une clé dans la{" "}
                <a href={CONSOLE_URL} className="link font-semibold" target="_blank" rel="noopener noreferrer">
                  console Anthropic, rubrique API Keys
                  <span className="sr-only"> (nouvel onglet)</span>
                </a>
                , puis collez-la ci-dessus.
              </li>
              <li>
                Coût indicatif : quelques centimes par diaporama généré, selon sa longueur et le modèle. Le détail figure
                dans votre console Anthropic.
              </li>
              <li>
                La clé est chiffrée avant d&apos;être enregistrée et n&apos;est jamais réaffichée : seuls ses quatre
                derniers caractères restent visibles. Pour en changer, saisissez-en une nouvelle.
              </li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="apparence" className="card p-5 sm:p-6">
          <h2 id="apparence" className="text-2xl">
            Apparence
          </h2>
          <p className="mt-1 text-muted">
            Le bouton soleil / lune de l&apos;en-tête bascule entre clair et sombre ; « Système » suit le réglage de
            votre appareil.
          </p>
          <div className="mt-5">
            <AppearanceSettings serverPreference={themePreference} />
          </div>
        </section>
      </div>
    </div>
  );
}
