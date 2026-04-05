"""Build Canvas API base URL and MCP HTTP headers for the Python canvas-mcp server.

That server expects per-request credentials when using streamable-http:
  X-Canvas-Token: Canvas personal access token
  X-Canvas-URL:   full REST base, e.g. https://school.instructure.com/api/v1
"""

from __future__ import annotations


def normalize_canvas_host(domain: str) -> str:
    s = domain.strip().lower()
    s = s.replace("https://", "").replace("http://", "")
    return s.split("/")[0]


def canvas_api_v1_base_url(*, domain: str | None = None, api_url: str | None = None) -> str | None:
    """Return https://host/api/v1 style base URL, or None if not derivable."""
    raw = (api_url or "").strip()
    if raw:
        if not raw.startswith("http"):
            raw = f"https://{raw}"
        return raw.rstrip("/")
    d = (domain or "").strip()
    if not d:
        return None
    host = normalize_canvas_host(d)
    if not host:
        return None
    return f"https://{host}/api/v1"


def mcp_canvas_request_headers(*, api_token: str, domain: str | None, api_url: str | None) -> dict[str, str] | None:
    """Headers required by canvas-mcp HTTP middleware, or None if incomplete."""
    token = api_token.strip()
    base = canvas_api_v1_base_url(domain=domain, api_url=api_url)
    if not token or not base:
        return None
    return {
        "X-Canvas-Token": token,
        "X-Canvas-URL": base,
    }
