"""Course caching system for Canvas API."""

import re
from collections import defaultdict
from urllib.parse import quote

from .client import fetch_all_paginated_results, make_canvas_request
from .logging import log_error, log_info, log_warning
from .validation import validate_params

# Global cache for course codes to IDs
course_code_to_id_cache: dict[str, str] = {}
id_to_course_code_cache: dict[str, str] = {}
# Normalized course_code (alphanumeric only, lower) -> Canvas id when unambiguous
normalized_course_code_to_id: dict[str, str] = {}
# (course_id, normalized haystack) for substring match when shorthand appears inside long ASU-style codes
course_substring_haystacks: list[tuple[str, str]] = []
# Min length for user shorthand before substring match (avoids "math" matching many titles)
_MIN_SUBSTRING_QUERY_LEN = 5


def _normalize_course_key(value: str) -> str:
    """Lowercase alphanumeric only — matches 'SER594' to 'SER 594', 'ser-594', etc."""
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


async def refresh_course_cache() -> bool:
    """Refresh the global course cache."""
    global course_code_to_id_cache, id_to_course_code_cache, normalized_course_code_to_id
    global course_substring_haystacks

    log_info("Refreshing course cache")
    courses = await fetch_all_paginated_results("/courses", {"per_page": 100})

    if isinstance(courses, dict) and "error" in courses:
        log_error("Error building course cache", error=courses.get("error"))
        return False

    # Build caches for bidirectional lookups
    course_code_to_id_cache = {}
    id_to_course_code_cache = {}
    normalized_groups: defaultdict[str, set[str]] = defaultdict(set)
    course_substring_haystacks = []

    for course in courses:
        course_id = str(course.get("id"))
        course_code = course.get("course_code")
        sis_course_id = course.get("sis_course_id")
        course_name = course.get("name")

        hay_parts: list[str] = []
        for raw in (course_code, course_name, sis_course_id):
            if raw is not None:
                chunk = str(raw).strip()
                if chunk:
                    hn = _normalize_course_key(chunk)
                    if hn:
                        hay_parts.append(hn)

        if course_id and hay_parts:
            uniq_h: list[str] = []
            seen_h: set[str] = set()
            for h in hay_parts:
                if h not in seen_h:
                    seen_h.add(h)
                    uniq_h.append(h)
            course_substring_haystacks.append((course_id, "|".join(uniq_h)))

        if course_code and course_id:
            course_code_to_id_cache[course_code] = course_id
            id_to_course_code_cache[course_id] = course_code
            nk = _normalize_course_key(course_code)
            if nk:
                normalized_groups[nk].add(course_id)

        if sis_course_id is not None and course_id:
            sis_str = str(sis_course_id).strip()
            if sis_str:
                course_code_to_id_cache[sis_str] = course_id
                nk_sis = _normalize_course_key(sis_str)
                if nk_sis:
                    normalized_groups[nk_sis].add(course_id)

    normalized_course_code_to_id = {}
    for nk, id_set in normalized_groups.items():
        if len(id_set) == 1:
            normalized_course_code_to_id[nk] = next(iter(id_set))
        else:
            log_warning(
                "Skipping ambiguous normalized course key",
                normalized_key=nk,
                course_ids=list(id_set),
            )

    log_info(f"Cached {len(course_code_to_id_cache)} course codes")
    return True


async def _try_resolve_numeric_id_via_sis(sis_fragment: str) -> str | None:
    """Resolve a SIS-style fragment to numeric course id via GET /courses/sis_course_id:..."""
    encoded = quote(sis_fragment, safe="")
    response = await make_canvas_request("get", f"/courses/sis_course_id:{encoded}")
    if isinstance(response, dict) and "error" in response:
        return None
    cid = response.get("id") if isinstance(response, dict) else None
    if cid is None:
        return None
    course_id = str(cid)
    # Opportunistically warm string-key caches (best-effort)
    global course_code_to_id_cache, id_to_course_code_cache, normalized_course_code_to_id
    cc = response.get("course_code") if isinstance(response, dict) else None
    if cc:
        course_code_to_id_cache[str(cc)] = course_id
        id_to_course_code_cache[course_id] = str(cc)
        nk = _normalize_course_key(str(cc))
        if nk and nk not in normalized_course_code_to_id:
            normalized_course_code_to_id[nk] = course_id
    return course_id


def _lookup_cached_course_id(course_str: str) -> str | None:
    """Resolve course_str using in-memory caches (must be populated)."""
    if course_str in course_code_to_id_cache:
        return course_code_to_id_cache[course_str]

    lower = course_str.lower()
    for code, cid in course_code_to_id_cache.items():
        if code.lower() == lower:
            return cid

    nk = _normalize_course_key(course_str)
    if nk and nk in normalized_course_code_to_id:
        return normalized_course_code_to_id[nk]

    return _lookup_cached_course_id_by_substring(nk)


def _lookup_cached_course_id_by_substring(user_norm: str) -> str | None:
    """Match shorthand (e.g. ser594) inside long normalized course_code or course name."""
    if len(user_norm) < _MIN_SUBSTRING_QUERY_LEN:
        return None
    matches: set[str] = set()
    for cid, hay in course_substring_haystacks:
        if user_norm in hay:
            matches.add(cid)
    if len(matches) == 1:
        return next(iter(matches))
    if len(matches) > 1:
        log_warning(
            "Ambiguous course shorthand substring; use numeric id from list_courses",
            query=user_norm,
            course_ids=list(matches),
        )
    return None


@validate_params
async def get_course_id(course_identifier: str | int) -> str | None:
    """Get course ID from either course code or ID, with caching.

    Args:
        course_identifier: The course identifier, which can be:
                          - A course code (e.g., 'badm_554_120251_246794')
                          - A shorthand like 'SER594' matching Canvas course_code after normalization
                          - A numeric course ID (as string or int)
                          - A SIS ID format (e.g., 'sis_course_id:xxx')

    Returns:
        The course ID as a string
    """
    global course_code_to_id_cache, id_to_course_code_cache

    # Convert to string for consistent handling
    course_str = str(course_identifier).strip()
    if not course_str:
        return None

    # If it looks like a numeric ID
    if course_str.isdigit():
        return course_str

    # If it's a SIS ID format
    if course_str.startswith("sis_course_id:"):
        return course_str

    had_cache = bool(course_code_to_id_cache)
    if not had_cache:
        await refresh_course_cache()

    resolved = _lookup_cached_course_id(course_str)
    if resolved:
        return resolved

    # If we had a populated cache but no hit, refresh once (new enrollment / stale list)
    if had_cache:
        await refresh_course_cache()
        resolved = _lookup_cached_course_id(course_str)
        if resolved:
            return resolved

    # Long underscore-heavy codes are commonly valid SIS course ids in Canvas
    if "_" in course_str:
        return f"sis_course_id:{course_str}"

    # Short codes (e.g. SER594) are not valid path segments; try explicit SIS resolution
    sis_resolved = await _try_resolve_numeric_id_via_sis(course_str)
    if sis_resolved:
        return sis_resolved

    log_warning(
        "Course identifier not resolved; Canvas may return 404",
        course_identifier=course_str,
    )
    return course_str


async def get_course_code(course_id: str | int) -> str | None:
    """Get course code from ID, with caching."""
    global id_to_course_code_cache, course_code_to_id_cache

    course_id = str(course_id)

    # If it's already a code-like string with underscores
    if "_" in course_id:
        return course_id

    # If it's in our cache, return the code
    if course_id in id_to_course_code_cache:
        return id_to_course_code_cache[course_id]

    # Try to refresh cache if it's not there
    if not id_to_course_code_cache:
        await refresh_course_cache()
        if course_id in id_to_course_code_cache:
            return id_to_course_code_cache[course_id]

    # If we can't find a code, try to fetch the course directly
    response = await make_canvas_request("get", f"/courses/{course_id}")
    if "error" not in response and "course_code" in response:
        code = response.get("course_code", "")
        # Update our cache
        if code:
            id_to_course_code_cache[course_id] = code
            course_code_to_id_cache[code] = course_id
        return code

    # Last resort, return the ID
    return course_id
