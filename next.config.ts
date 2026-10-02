import type { NextConfig } from "next";
import { assertAiProviderEnv } from "./src/server/ai/resolve";
import { securityHeaders } from "./src/server/security-headers";

const production = process.env.NODE_ENV === "production";

// Échoue au démarrage plutôt qu'à la première génération (message explicite).
assertAiProviderEnv(process.env);

/**
 * Corps maximal d'une Server Action : l'import de charte accepte un fichier de
 * 20 Mo (cf. BRAND_FILE_MAX_BYTES) ; la limite porte sur le corps HTTP brut,
 * enveloppe multipart comprise, d'où 1 Mo de marge — et pas davantage.
 */
export const SERVER_ACTION_BODY_LIMIT = "21mb";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: SERVER_ACTION_BODY_LIMIT },
    // src/proxy.ts couvre /projets/** : sans ce réglage, le corps y serait tronqué à 10 Mo.
    proxyClientMaxBodySize: SERVER_ACTION_BODY_LIMIT,
  },
  // En dev, Next journalise par défaut les arguments des Server Functions : la clé
  // API saisie dans la Configuration IA apparaîtrait en clair dans le terminal.
  logging: { serverFunctions: false },
  // Anciennes adresses : les liens et favoris restent valides. Les pages des projets
  // vivaient sous /programmes ; la page des réglages IA s'appelait /parametres.
  async redirects() {
    return [
      { source: "/programmes", destination: "/projets", permanent: true },
      { source: "/programmes/:path*", destination: "/projets/:path*", permanent: true },
      { source: "/parametres", destination: "/configuration-ia", permanent: true },
      { source: "/parametres/:path*", destination: "/configuration-ia/:path*", permanent: true },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders({ production }) }];
  },
};

export default nextConfig;
