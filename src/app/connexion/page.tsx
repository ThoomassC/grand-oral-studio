import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginExperience } from "@/components/auth/LoginExperience";
import { AuthForm } from "@/components/auth/AuthForm";
import { postLoginDestination, postLoginPath } from "@/components/auth/next-path";
import { oauthErrorMessage } from "@/components/auth/oauth-error";
import { googleButtonState, isEmailDeliveryEnabled } from "@/lib/auth-options";
import { getUser } from "@/server/session";

export async function generateMetadata({ searchParams }: PageProps<"/connexion">): Promise<Metadata> {
  // Retour d'échec OAuth : l'erreur est la première chose lue (titre de l'onglet).
  return { title: oauthErrorMessage((await searchParams).error) ? "Erreur – Connexion" : "Connexion" };
}

export default async function LoginPage({ searchParams }: PageProps<"/connexion">) {
  const params = await searchParams;
  const next = postLoginDestination(params.next);
  if (await getUser()) redirect(postLoginPath(next));

  return (
    <LoginExperience>
      <AuthForm
        mode="signin"
        appearance="studio"
        next={next}
        google={googleButtonState(process.env)}
        initialError={oauthErrorMessage(params.error)}
        verifyEmail={isEmailDeliveryEnabled(process.env)}
      />
    </LoginExperience>
  );
}
