export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10" aria-busy="true">
      <p role="status" className="sr-only">
        Chargement des projets…
      </p>
      <div className="opale-skeleton h-4 w-40" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="opale-skeleton h-9 w-48" />
        <div className="opale-skeleton h-11 w-44" />
      </div>
      <div className="opale-skeleton mt-3 h-5 w-full max-w-xl" />
      <div className="mt-8 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="opale-skeleton h-32" />
        ))}
      </div>
    </div>
  );
}
