"use client";

import { ErrorPanel } from "@/components/ui/ErrorPanel";

export default function ProfileError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel title="Le profil n'a pas pu être chargé" error={error} retry={retry} />;
}
