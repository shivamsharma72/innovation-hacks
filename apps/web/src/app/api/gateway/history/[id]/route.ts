import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { gatewayFetch } from "@/lib/gateway";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  try {
    const { token } = await auth0.getAccessToken();
    if (!token) return NextResponse.json({ detail: "No access token" }, { status: 401 });
    const { id } = await params;
    const res = await gatewayFetch(`/history/${id}`, token);
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    return NextResponse.json({ detail: String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  try {
    const { token } = await auth0.getAccessToken();
    if (!token) return NextResponse.json({ detail: "No access token" }, { status: 401 });
    const { id } = await params;
    const res = await gatewayFetch(`/history/${id}`, token, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    return NextResponse.json({ detail: String(e) }, { status: 500 });
  }
}
