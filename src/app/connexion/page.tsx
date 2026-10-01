import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";
import { safeNextPath } from "@/components/auth/next-path";
import { oauthErrorMessage } from "@/components/auth/oauth-error";
import { googleButtonState } from "@/lib/auth-options";
import { getUser } from "@/server/session";

export async function generateMetadata({ searchParams }: PageProps<"/connexion">): Promise<Metadata> {
  // Retour d'échec OAuth : l'erreur est la première chose lue (titre de l'onglet).
  return { title: oauthErrorMessage((await searchParams).error) ? "Erreur – Connexion" : "Connexion" };
}

export default async function LoginPage({ searchParams }: PageProps<"/connexion">) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (await getUser()) redirect(next);

  return (
    <AuthCard title="Connexion" intro="Retrouvez vos programmes, vos squelettes et vos decks.">
      <AuthForm
        mode="signin"
        next={next}
        google={googleButtonState(process.env)}
        initialError={oauthErrorMessage(params.error)}
      />
    </AuthCard>
  );
}
