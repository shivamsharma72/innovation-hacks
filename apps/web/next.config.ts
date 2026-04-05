import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const devAllowedOrigins =
  process.env.NEXT_DEV_ALLOWED_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

const splineReactEntry = path.join(
  __dirname,
  "node_modules/@splinetool/react-spline/dist/react-spline.js",
);
const splineNextEntry = path.join(
  __dirname,
  "node_modules/@splinetool/react-spline/dist/react-spline-next.js",
);

// Use `$` so `@splinetool/react-spline` does not swallow `@splinetool/react-spline/next`.
const splineResolveAlias: Record<string, string> = {
  "@splinetool/react-spline/next$": splineNextEntry,
  "@splinetool/react-spline$": splineReactEntry,
};

const nextConfig: NextConfig = {
  transpilePackages: ["@splinetool/react-spline", "@splinetool/runtime"],
  // Package "exports" are import-only; map specifiers to dist files for webpack + Turbopack.
  turbopack: {
    resolveAlias: splineResolveAlias,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...splineResolveAlias,
    };
    return config;
  },
  // Monorepo: trace from this app so Vercel does not pick a parent lockfile
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Phone / LAN dev: e.g. NEXT_DEV_ALLOWED_ORIGINS=http://10.159.21.254:3000
  ...(devAllowedOrigins.length > 0
    ? { allowedDevOrigins: devAllowedOrigins }
    : {}),
};

export default nextConfig;
