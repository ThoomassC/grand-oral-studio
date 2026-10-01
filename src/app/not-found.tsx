import { ButtonLink } from "@/components/ui/ButtonLink";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <div className="opale-card opale-card--e1 block p-6">
        <h1 className="text-xl font-bold">Page introuvable</h1>
        <p className="mt-2 text-muted">
          Ce contenu n&apos;existe pas ou ne vous appartient pas. Il a peut-être été supprimé.
        </p>
        <ButtonLink href="/projets" className="mt-5">
          Retour aux projets
        </ButtonLink>
      </div>
    </div>
  );
}
