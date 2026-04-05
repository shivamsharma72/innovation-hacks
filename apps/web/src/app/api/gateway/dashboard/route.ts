import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { gatewayFetch } from "@/lib/gateway";

export async function GET() {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  try {
    const { token } = await auth0.getAccessToken();
    if (!token) return NextResponse.json({ detail: "No access token" }, { status: 401 });
    const res = await gatewayFetch("/dashboard/courses", token);
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    return NextResponse.json({ detail: String(e) }, { status: 500 });
  }
}
