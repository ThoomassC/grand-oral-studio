import { Card, DescriptionList } from "@thomascaron/opale-ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/layout/PageHeading";
import { ProfileSettings } from "@/components/profile/ProfileSettings";
import { formatDate, plural } from "@/components/ui/format";
import { countSharedOwnedPrograms, getProfile, type SignInMethod } from "@/server/queries";
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
  const [profile, sharedOwned] = await Promise.all([getProfile(user.id), countSharedOwnedPrograms(user.id)]);
  if (!profile) notFound();

  const methods = profile.signInMethods.map((m) => METHOD_LABEL[m]).join(" ; ") || "—";
  const hasPassword = profile.signInMethods.includes("password");

  return (
    <div className="studio-container studio-container--narrow">
      <PageHeading title="Informations du profil" actions={
        <ProfileSettings
          name={profile.name}
          email={profile.email}
          hasPassword={hasPassword}
          canResetPassword={isEmailDeliveryEnabled(process.env)}
          sharesProjects={sharedOwned > 0}
          updateNameAction={updateProfileName}
          deleteAccountAction={deleteAccount}
        />
      } />

      <div className="mt-8 flex flex-col gap-6">
        <section aria-label="Informations du compte">
          <Card elevation={1} className="p-5 sm:p-6">
            <DescriptionList
              className="break-words"
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
      </div>
    </div>
  );
}
