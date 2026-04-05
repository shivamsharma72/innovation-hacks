import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

const gatewayUrl = () =>
  process.env.GATEWAY_INTERNAL_URL || process.env.GATEWAY_URL || "";

export async function POST(req: Request) {
  const session = await auth0.getSession();
  if (!session) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const base = gatewayUrl();
  if (!base) {
    return NextResponse.json(
      { detail: "GATEWAY_URL is not configured" },
      { status: 500 },
    );
  }

  let accessToken: string | undefined;
  try {
    const t = await auth0.getAccessToken();
    accessToken = typeof t === "string" ? t : t?.token;
  } catch {
    accessToken = undefined;
  }

  if (!accessToken) {
    return NextResponse.json(
      {
        detail:
          "No API access token. Set AUTH0_AUDIENCE to your Auth0 API identifier and log in again.",
      },
      { status: 401 },
    );
  }

  const body = await req.json();
  const res = await fetch(`${base}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
