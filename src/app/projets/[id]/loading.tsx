export default function Loading() {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        Chargement…
      </p>
      <div className="opale-skeleton h-7 w-48" />
      <div className="opale-skeleton mt-3 h-5 w-full max-w-lg" />
      <div className="mt-6 grid gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="opale-skeleton h-20" />
        ))}
      </div>
    </div>
  );
}
