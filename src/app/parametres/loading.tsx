export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10" aria-busy="true">
      <p role="status" className="sr-only">
        Chargement des paramètres…
      </p>
      <div className="opale-skeleton h-4 w-20" />
      <div className="opale-skeleton mt-3 h-10 w-56" />
      <div className="opale-skeleton mt-3 h-5 w-full max-w-md" />
      <div className="mt-8 flex flex-col gap-6">
        <div className="opale-skeleton h-[34rem]" />
        <div className="opale-skeleton h-56" />
      </div>
    </div>
  );
}
