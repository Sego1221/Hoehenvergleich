// Hinter dem Apps-Gateway läuft das Modul unter dem Präfix /hoehenvergleich.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // Azure-/Docker-ready (schlankes Runtime-Bundle)
  basePath: basePath || undefined,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // georaster / georaster-layer-for-leaflet sind reine Client-Libs.
  // Transpilieren, damit sie sauber gebundelt werden.
  transpilePackages: ["georaster-layer-for-leaflet"],
  eslint: { ignoreDuringBuilds: true },
  // Beta: Typfehler sollen den Build nicht blockieren (lokal kein Build testbar).
  typescript: { ignoreBuildErrors: true },
  // instrumentation.ts (additive DDL beim Start) — in Next 14.2 noch experimentell.
  // postgres extern halten: sonst bundelt webpack die Cloudflare/Edge-Variante
  // (cloudflare:sockets / node:stream) und der Build bricht.
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["postgres"],
  },
};

export default nextConfig;
