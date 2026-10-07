import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { isEmailDeliveryEnabled } from "@/lib/auth-options";

export const metadata: Metadata = { title: "Mot de passe oublié" };

/**
 * Page publique. Avec les e-mails (RESEND_API_KEY + EMAIL_FROM), demande d'un
 * lien de réinitialisation ; sans eux, la marche à suivre.
 */
export default function ForgotPasswordPage() {
  if (!isEmailDeliveryEnabled(process.env)) {
    return (
      <AuthCard title="Mot de passe oublié" intro="La réinitialisation par e-mail n'est pas disponible sur cette instance.">
        <div className="flex flex-col gap-4">
          <p>Contactez l&apos;administrateur de l&apos;instance pour retrouver l&apos;accès à votre compte.</p>
          <p>
            Si votre adresse est un compte Google, utilisez « Continuer avec Google » sur la page de connexion : aucun mot
            de passe n&apos;est nécessaire.
          </p>
          <ButtonLink href="/connexion" fullWidth>
            Retour à la connexion
          </ButtonLink>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Mot de passe oublié"
      intro="Indiquez l'adresse de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe."
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
