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
  const upstream = await fetch(`${base}/chat/voice/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
  });

  if (!upstream.ok || !upstream.body) {
    const err = await upstream.text().catch(() => "upstream error");
    return new Response(err, { status: upstream.status });
  }

  // Pass SSE stream through verbatim
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
