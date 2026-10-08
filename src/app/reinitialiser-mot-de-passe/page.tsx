import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { ButtonLink } from "@/components/ui/ButtonLink";

// Le jeton est dans l'URL : il ne doit partir dans aucun en-tête Referer.
export const metadata: Metadata = { title: "Nouveau mot de passe", referrer: "no-referrer" };

/**
 * Arrivée depuis le lien de l'e-mail : Better Auth a vérifié le jeton puis
 * redirigé ici avec `?token=…`, ou avec `?error=INVALID_TOKEN` s'il est
 * inconnu ou expiré. Le jeton n'est consommé qu'à l'envoi du formulaire.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reinitialiser-mot-de-passe">) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token.trim() : "";
  const valid = !params.error && /^[A-Za-z0-9_-]{8,128}$/.test(token);

  if (!valid) {
    return (
      <AuthCard
        title="Lien expiré"
        intro="Ce lien de réinitialisation n'est plus valide : il a expiré (une heure) ou a déjà servi."
      >
        <ButtonLink href="/mot-de-passe-oublie" fullWidth>
          Demander un nouveau lien
        </ButtonLink>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Nouveau mot de passe" intro="Choisissez le mot de passe de votre compte.">
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
