import { NextResponse } from "next/server";

/**
 * Next.js does not implement MCP. Clients that POST to /mcp on :3000 get a clear
 * pointer to the Google Workspace MCP server (typically :8002).
 */
const BODY = {
  error: "MCP is not served by this Next.js app.",
  googleWorkspaceMcpUrl: "http://127.0.0.1:8002/mcp",
  healthCheck: "http://127.0.0.1:8002/health",
  startScript: "From repo root: ./scripts/run-workspace-mcp-local.sh",
};

export async function POST() {
  return NextResponse.json(BODY, { status: 503 });
}

export async function GET() {
  return NextResponse.json(
    { ...BODY, method: "GET is OK for discovery; MCP JSON-RPC must go to googleWorkspaceMcpUrl." },
    { status: 200 },
  );
}
