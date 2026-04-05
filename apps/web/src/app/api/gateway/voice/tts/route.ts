import { auth0 } from "@/lib/auth0";
import { gatewayUrl } from "@/lib/gateway";

export async function POST(req: Request) {
  const session = await auth0.getSession();
  if (!session) return new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 });

  let token: string | undefined;
  try {
    const t = await auth0.getAccessToken();
    token = typeof t === "string" ? t : t?.token;
  } catch {
    token = undefined;
  }
  if (!token) return new Response(JSON.stringify({ detail: "No access token" }), { status: 401 });

  const base = gatewayUrl();
  if (!base) return new Response(JSON.stringify({ detail: "GATEWAY_URL not set" }), { status: 500 });

  const body = await req.text();
  const upstream = await fetch(`${base}/chat/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
  });

  const contentType = upstream.headers.get("content-type") ?? "application/json";
  if (contentType.includes("audio") && upstream.body) {
    return new Response(upstream.body, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  }

  // ElevenLabs not configured — return JSON so frontend can fallback to browser TTS
  const data = await upstream.json().catch(() => ({}));
  return new Response(JSON.stringify(data), {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
