import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const devAllowedOrigins =
  process.env.NEXT_DEV_ALLOWED_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  // Monorepo: trace from this app so Vercel does not pick a parent lockfile
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Phone / LAN dev: e.g. NEXT_DEV_ALLOWED_ORIGINS=http://10.159.21.254:3000
  ...(devAllowedOrigins.length > 0
    ? { allowedDevOrigins: devAllowedOrigins }
    : {}),
};

export default nextConfig;
