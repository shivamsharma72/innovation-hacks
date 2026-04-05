"""
Plain-text cleanup for tool payloads and voice-oriented assistant replies.
"""

from __future__ import annotations

import re


def strip_markdown_for_speech(text: str) -> str:
    """
    Remove common Markdown noise so TTS and chat bubbles sound natural.
    Not a full MD parser — good enough for model output and tool dumps.
    """
    if not text:
        return text
    s = text.replace("\r\n", "\n")

    # Fenced code blocks → inner text only
    s = re.sub(r"```(?:\w+)?\n(.*?)```", r"\1", s, flags=re.DOTALL | re.IGNORECASE)

    # Headings: lines starting with #s
    s = re.sub(r"(?m)^#{1,6}\s*", "", s)

    # Bold / italic markers
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"__([^_]+)__", r"\1", s)
    s = re.sub(r"(?<!\*)\*(?!\*)([^*]+)\*(?!\*)", r"\1", s)
    s = re.sub(r"(?<!_)_(?!_)([^_]+)_(?!_)", r"\1", s)

    # Bullets: - or * at line start
    s = re.sub(r"(?m)^\s*[-*+]\s+", "", s)

    # Numbered list markers at line start
    s = re.sub(r"(?m)^\s*\d+\.\s+", "", s)

    # Horizontal rules
    s = re.sub(r"(?m)^\s*[-*_]{3,}\s*$", "", s)

    # Backticks
    s = s.replace("`", "")

    # Collapse excessive blank lines
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def condense_tool_text(text: str, tool_name: str, *, max_chars: int) -> str:
    """
    Shrink huge MCP tool results for the model context with a clear truncation note.
    Keeps the start (metadata / headers) when email-style sections exist.
    """
    if not text or len(text) <= max_chars:
        return text

    lower = tool_name.lower()
    # Prefer preserving email headers when body is huge
    for marker in ("\n--- BODY ---\n", "\n--- RAW MIME ---\n", "\n--- body ---\n"):
        idx = text.find(marker)
        if idx != -1 and idx < max_chars // 2:
            head = text[: idx + len(marker)]
            rest = text[idx + len(marker) :]
            budget = max_chars - len(head) - 120
            if budget < 200:
                break
            return (
                head
                + rest[:budget]
                + f"\n\n[Truncated: {len(text)} characters total in tool result; "
                "summarize key points for the user—do not read this verbatim.]"
            )

    if "gmail" in lower or "message" in lower or "document" in lower or "spreadsheet" in lower:
        take = max_chars - 150
        return (
            text[:take]
            + f"\n\n[Truncated Gmail/Docs-style payload: {len(text)} chars total. "
            "Give a short summary; offer detail only if the user asks.]"
        )

    take = max_chars - 120
    return (
        text[:take]
        + f"\n\n[Truncated tool output ({len(text)} chars). Summarize essentials only.]"
    )


def tool_result_char_budget(*, voice_mode: bool) -> int:
    """Max characters of each tool result passed back into the model."""
    return 2800 if voice_mode else 6000
