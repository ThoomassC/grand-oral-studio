import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { AuthForm } from "@/components/auth/AuthForm";
import { safeNextPath } from "@/components/auth/next-path";
import { isGoogleSignInEnabled } from "@/lib/auth-options";
import { getUser } from "@/server/session";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function SignupPage({ searchParams }: PageProps<"/inscription">) {
  const next = safeNextPath((await searchParams).next);
  if (await getUser()) redirect(next);

  return (
    <AuthCard title="Créer un compte" intro="Un compte suffit pour préparer tous vos programmes.">
      <AuthForm mode="signup" next={next} googleEnabled={isGoogleSignInEnabled(process.env)} />
    </AuthCard>
  );
}
