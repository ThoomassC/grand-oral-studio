import { Card, DescriptionList } from "@thomascaron/opale-ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileNameForm } from "@/components/profile/ProfileNameForm";
import { formatDate, plural } from "@/components/ui/format";
import { getProfile, type SignInMethod } from "@/server/queries";
import { requireUser } from "@/server/session";
import { updateProfileName } from "./actions";

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
      </div>
    </div>
  );
}
