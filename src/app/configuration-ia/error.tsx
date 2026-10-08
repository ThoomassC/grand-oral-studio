"use client";

import { ErrorPanel } from "@/components/ui/ErrorPanel";

export default function SettingsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel title="La page Rédaction IA n'a pas pu être chargée" error={error} retry={retry} />;
}
