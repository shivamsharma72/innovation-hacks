import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { gatewayFetch } from "@/lib/gateway";

export async function GET() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ items: [] });
  try {
    const { token } = await auth0.getAccessToken();
    if (!token) return NextResponse.json({ items: [] });
    const res = await gatewayFetch("/agent/hitl/pending", token);
    const data = await res.json().catch(() => ({ items: [] }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
