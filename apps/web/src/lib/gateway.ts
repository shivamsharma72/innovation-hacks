/**
 * Shared gateway helpers used by all Next.js API proxy routes.
 */

export function gatewayUrl(): string {
  return process.env.GATEWAY_INTERNAL_URL || process.env.GATEWAY_URL || "";
}

export async function gatewayFetch(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = gatewayUrl();
  if (!base) {
    throw new Error("GATEWAY_URL is not configured");
  }
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}
