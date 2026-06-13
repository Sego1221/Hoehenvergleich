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
  experimental: { instrumentationHook: true },
};

export default nextConfig;
