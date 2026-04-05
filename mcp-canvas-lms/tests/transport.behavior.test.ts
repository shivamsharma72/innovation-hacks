import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasMCPServer, loadConfigFromEnvironment } from "../src/index.js";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
};

function createMockClient() {
  return {
    healthCheck: async () => ({
      status: "ok",
      timestamp: "2026-02-24T00:00:00.000Z",
      user: { id: 1, name: "Test User" }
    })
  };
}

function parseJson(text: string) {
  return JSON.parse(text) as Record<string, unknown>;
}

async function waitForResponse(
  responseMap: Map<number | string, JsonRpcMessage>,
  id: number,
  timeoutMs = 3000
): Promise<JsonRpcMessage> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const message = responseMap.get(id);
    if (message) {
      return message;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for JSON-RPC response ${id}`);
}

function buildStdioServer(): CanvasMCPServer {
  const config = loadConfigFromEnvironment({
    CANVAS_API_TOKEN: "test-token",
    CANVAS_DOMAIN: "test.instructure.com",
    MCP_TRANSPORT: "stdio"
  });
  return new CanvasMCPServer(config, createMockClient() as any);
}

function buildHttpServer(allowedOrigins: string[]): CanvasMCPServer {
  const config = loadConfigFromEnvironment({
    CANVAS_API_TOKEN: "test-token",
    CANVAS_DOMAIN: "test.instructure.com",
    MCP_TRANSPORT: "streamable-http",
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_HTTP_PORT: "0",
    MCP_HTTP_PATH: "/mcp",
    MCP_HTTP_ALLOWED_ORIGINS: allowedOrigins.join(",")
  });
  return new CanvasMCPServer(config, createMockClient() as any);
}

describe("stdio transport", () => {
  let server: CanvasMCPServer | undefined;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("supports initialize, tools/list, tools/call success, and structured tool errors", async () => {
    server = buildStdioServer();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const responses = new Map<number | string, JsonRpcMessage>();
    let buffer = "";

    stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          const message = JSON.parse(line) as JsonRpcMessage;
          if (message.id !== undefined) {
            responses.set(message.id, message);
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    });

    await server.connectStdio(stdin, stdout);

    stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1.0.0" }
        }
      })}\n`
    );
    const initializeResponse = await waitForResponse(responses, 1);
    expect(initializeResponse.result).toBeTruthy();

    stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {}
      })}\n`
    );

    stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      })}\n`
    );
    const listResponse = await waitForResponse(responses, 2);
    const tools = (listResponse.result?.tools as Array<Record<string, unknown>>) ?? [];
    const healthTool = tools.find((tool) => tool.name === "canvas_health_check");
    expect(healthTool).toBeTruthy();
    expect((healthTool?.description as string) ?? "").toContain("Required fields");
    expect((healthTool?.inputSchema as Record<string, unknown>)?.additionalProperties).toBe(false);

    stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "canvas_health_check", arguments: {} }
      })}\n`
    );
    const callSuccess = await waitForResponse(responses, 3);
    const successText = ((callSuccess.result?.content as Array<Record<string, unknown>>)[0]
      ?.text ?? "{}") as string;
    expect(parseJson(successText).status).toBe("ok");

    stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "canvas_get_course", arguments: {} }
      })}\n`
    );
    const callFailure = await waitForResponse(responses, 4);
    const failureResult = callFailure.result as Record<string, unknown>;
    const structuredError = failureResult.structuredContent as Record<string, unknown>;
    expect(failureResult.isError).toBe(true);
    expect(structuredError.status).toBe("error");
    expect(structuredError.retryable).toBe(false);
    expect(structuredError.suggestion).toBeTruthy();
  });
});

describe("streamable-http transport", () => {
  let server: CanvasMCPServer | undefined;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("supports initialize, tools/list, tools/call success/failure, and returns 405 for unsupported methods", async () => {
    server = buildHttpServer([]);
    await server.connectStreamableHttp();

    const url = server.getStreamableHttpUrl();
    expect(url).toBeTruthy();

    const request = async (
      body: Record<string, unknown>,
      options?: { origin?: string; sessionId?: string }
    ) => {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25"
      };
      if (options?.origin) {
        headers.origin = options.origin;
      }
      if (options?.sessionId) {
        headers["mcp-session-id"] = options.sessionId;
      }

      return fetch(url as string, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
    };

    const initResponse = await request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "vitest", version: "1.0.0" }
      }
    });
    expect(initResponse.status).toBe(200);
    const sessionId = initResponse.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    const initJson = (await initResponse.json()) as JsonRpcMessage;
    expect(initJson.result).toBeTruthy();

    const initializedResponse = await request({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {}
    }, { sessionId: sessionId ?? undefined });
    expect(initializedResponse.status).toBe(202);

    const listResponse = await request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    }, { sessionId: sessionId ?? undefined });
    expect(listResponse.status).toBe(200);
    const listJson = (await listResponse.json()) as JsonRpcMessage;
    expect(((listJson.result?.tools as unknown[]) ?? []).length).toBeGreaterThan(0);

    const successCall = await request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "canvas_health_check", arguments: {} }
    }, { sessionId: sessionId ?? undefined });
    expect(successCall.status).toBe(200);
    const successJson = (await successCall.json()) as JsonRpcMessage;
    const successText = ((successJson.result?.content as Array<Record<string, unknown>>)[0]
      ?.text ?? "{}") as string;
    expect(parseJson(successText).status).toBe("ok");

    const failedCall = await request({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "canvas_get_course", arguments: {} }
    }, { sessionId: sessionId ?? undefined });
    expect(failedCall.status).toBe(200);
    const failedJson = (await failedCall.json()) as JsonRpcMessage;
    const failedResult = failedJson.result as Record<string, unknown>;
    const structuredError = failedResult.structuredContent as Record<string, unknown>;
    expect(failedResult.isError).toBe(true);
    expect(structuredError.status).toBe("error");
    expect(structuredError.retryable).toBe(false);
    expect(structuredError.suggestion).toBeTruthy();

    const putResponse = await fetch(url as string, { method: "PUT" });
    expect(putResponse.status).toBe(405);
  });

  it("returns 403 for invalid Origin header when allowed origins are configured", async () => {
    server = buildHttpServer(["https://allowed.example"]);
    await server.connectStreamableHttp();
    const url = server.getStreamableHttpUrl();
    expect(url).toBeTruthy();

    const response = await fetch(url as string, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        origin: "https://malicious.example"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1.0.0" }
        }
      })
    });

    expect(response.status).toBe(403);
  });
});
