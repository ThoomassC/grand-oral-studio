import { Card, DescriptionList } from "@thomascaron/opale-ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChangePasswordForm } from "@/components/profile/ChangePasswordForm";
import { DeleteAccountForm } from "@/components/profile/DeleteAccountForm";
import { ProfileNameForm } from "@/components/profile/ProfileNameForm";
import { formatDate, plural } from "@/components/ui/format";
import { getProfile, type SignInMethod } from "@/server/queries";
import { isEmailDeliveryEnabled } from "@/lib/auth-options";
import { requireUser } from "@/server/session";
import { deleteAccount, updateProfileName } from "./actions";

export const metadata: Metadata = { title: "Profil" };

const METHOD_LABEL: Record<SignInMethod, string> = {
  password: "E-mail et mot de passe",
  google: "Google",
};

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  if (!profile) notFound();

  const methods = profile.signInMethods.map((m) => METHOD_LABEL[m]).join(" ; ") || "—";
  const hasPassword = profile.signInMethods.includes("password");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-3xl sm:text-4xl">Informations du profil</h1>

      <div className="mt-8 flex flex-col gap-6">
        <section aria-labelledby="profil-infos">
          <Card elevation={1} className="p-5 sm:p-6">
            <h2 id="profil-infos" className="text-2xl">
              Votre compte
            </h2>
            <DescriptionList
              className="mt-4 break-words"
              items={[
                { term: "Nom", description: profile.name },
                { term: "Adresse e-mail", description: profile.email },
                { term: "Méthode de connexion", description: methods },
                { term: "Compte créé le", description: formatDate(new Date(profile.createdAt)) },
                { term: "Projets", description: <span className="num">{plural(profile.projectCount, "projet")}</span> },
              ]}
            />
          </Card>
        </section>

        <section aria-labelledby="profil-nom">
          <Card elevation={1} className="p-5 sm:p-6">
            <h2 id="profil-nom" className="text-2xl">
              Modifier le nom
            </h2>
            <p className="mt-1 text-muted">Il s&apos;affiche dans le menu du compte.</p>
            <div className="mt-5">
              <ProfileNameForm initialName={profile.name} action={updateProfileName} />
            </div>
          </Card>
        </section>

        <section aria-labelledby="profil-mot-de-passe">
          <Card elevation={1} className="p-5 sm:p-6">
            <h2 id="profil-mot-de-passe" className="text-2xl">
              Mot de passe
            </h2>
            {hasPassword ? (
              <>
                <p className="mt-1 text-muted">Vos autres sessions seront déconnectées.</p>
                <div className="mt-5">
                  <ChangePasswordForm />
                </div>
              </>
            ) : (
              <p className="mt-1 text-muted">
                Votre compte se connecte avec Google : il n&apos;a pas de mot de passe.
                {isEmailDeliveryEnabled(process.env)
                  ? " Pour en définir un, utilisez « Mot de passe oublié ? » sur la page de connexion."
                  : null}
              </p>
            )}
          </Card>
        </section>

        <section aria-labelledby="profil-suppression">
          <Card elevation={1} className="p-5 sm:p-6">
            <h2 id="profil-suppression" className="text-2xl">
              Supprimer le compte
            </h2>
            <p className="mt-1 text-muted">
              Votre compte et toutes vos données (projets, sujets, diaporamas, réglages IA) sont supprimés définitivement.
            </p>
            <div className="mt-5">
              <DeleteAccountForm email={profile.email} action={deleteAccount} />
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
