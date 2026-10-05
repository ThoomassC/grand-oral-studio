import type { Metadata } from "next";
import { AiSetup } from "@/components/settings/AiSetup";
import { toAiSetupStatus } from "@/components/settings/ai-status";
import { formatDateTime } from "@/components/ui/format";
import { getAiSettings } from "@/server/queries";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Configuration IA" };

export default async function AiConfigurationPage() {
  const user = await requireUser();
  const settings = await getAiSettings(user.id);
  // DTO explicite : seulement ce que l'interface affiche (de la clé, ses 4 derniers caractères).
  const status = toAiSetupStatus(settings, (iso) => formatDateTime(new Date(iso)));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="eyebrow">Compte</p>
      <h1 className="mt-2 text-3xl sm:text-4xl">Configuration IA</h1>
      <p className="mt-2 text-muted">
        L&apos;IA n&apos;intervient qu&apos;au jour J, pour rédiger le diaporama : tout le reste se prépare sans elle.
        Thème, taille du texte et animations se règlent dans Réglages, depuis l&apos;en-tête.
      </p>
      <div className="mt-8">
        <AiSetup status={status} />
      </div>
    </div>
  );
}
