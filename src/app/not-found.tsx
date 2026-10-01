import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <div className="card p-6">
        <h1 className="text-xl font-bold">Page introuvable</h1>
        <p className="mt-2 text-muted">
          Ce contenu n&apos;existe pas ou ne vous appartient pas. Il a peut-être été supprimé.
        </p>
        <Link href="/programmes" className="btn btn-primary mt-5">
          Retour à mes programmes
        </Link>
      </div>
    </div>
  );
}
