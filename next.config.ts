import type { NextConfig } from "next";
import { assertAiProviderEnv } from "./src/server/ai/resolve";
import { securityHeaders } from "./src/server/security-headers";

const production = process.env.NODE_ENV === "production";

// Échoue au démarrage plutôt qu'à la première génération (message explicite).
assertAiProviderEnv(process.env);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // En dev, Next journalise par défaut les arguments des Server Functions : la clé
  // API saisie dans Paramètres apparaîtrait en clair dans le terminal.
  logging: { serverFunctions: false },
  // Les pages des projets vivaient sous /programmes : les anciens liens et favoris restent valides.
  async redirects() {
    return [
      { source: "/programmes", destination: "/projets", permanent: true },
      { source: "/programmes/:path*", destination: "/projets/:path*", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders({ production }) }];
  },
};

export default nextConfig;
