"""Tests for course id resolution and cache helpers."""

from unittest.mock import AsyncMock, patch

import pytest

from canvas_mcp.core import cache as cache_module


@pytest.fixture(autouse=True)
def clear_caches():
    cache_module.course_code_to_id_cache.clear()
    cache_module.id_to_course_code_cache.clear()
    cache_module.normalized_course_code_to_id.clear()
    cache_module.course_substring_haystacks.clear()
    yield
    cache_module.course_code_to_id_cache.clear()
    cache_module.id_to_course_code_cache.clear()
    cache_module.normalized_course_code_to_id.clear()
    cache_module.course_substring_haystacks.clear()


class TestNormalizeCourseKey:
    def test_strips_non_alphanumeric(self):
        assert cache_module._normalize_course_key("SER 594") == "ser594"
        assert cache_module._normalize_course_key("ser-594") == "ser594"


@pytest.mark.asyncio
class TestGetCourseId:
    async def test_numeric_passthrough(self):
        assert await cache_module.get_course_id(252151) == "252151"
        assert await cache_module.get_course_id("252151") == "252151"

    async def test_sis_prefix_passthrough(self):
        assert await cache_module.get_course_id("sis_course_id:foo") == "sis_course_id:foo"

    async def test_normalized_short_code_from_enrollments(self):
        courses = [
            {"id": 999, "course_code": "SER 594", "sis_course_id": None},
        ]
        with patch(
            "canvas_mcp.core.cache.fetch_all_paginated_results",
            new_callable=AsyncMock,
            return_value=courses,
        ):
            cid = await cache_module.get_course_id("SER594")
        assert cid == "999"

    async def test_case_insensitive_course_code_key(self):
        cache_module.course_code_to_id_cache["CS101"] = "1"
        cache_module.normalized_course_code_to_id["cs101"] = "1"
        cid = await cache_module.get_course_id("cs101")
        assert cid == "1"

    async def test_underscore_fallback_to_sis_form(self):
        with patch(
            "canvas_mcp.core.cache.fetch_all_paginated_results",
            new_callable=AsyncMock,
            return_value=[],
        ):
            cid = await cache_module.get_course_id("badm_350_120251")
        assert cid == "sis_course_id:badm_350_120251"

    async def test_sis_api_fallback_returns_numeric_id(self):
        with patch(
            "canvas_mcp.core.cache.fetch_all_paginated_results",
            new_callable=AsyncMock,
            return_value=[],
        ), patch(
            "canvas_mcp.core.cache.make_canvas_request",
            new_callable=AsyncMock,
            return_value={"id": 252151, "course_code": "SER594"},
        ):
            cid = await cache_module.get_course_id("SER594")
        assert cid == "252151"

    async def test_substring_match_long_institution_course_code(self):
        courses = [
            {
                "id": 111,
                "course_code": "2025 Spring B - SER 594 - 12345",
                "name": "HCI Studio",
                "sis_course_id": None,
            },
        ]
        with patch(
            "canvas_mcp.core.cache.fetch_all_paginated_results",
            new_callable=AsyncMock,
            return_value=courses,
        ):
            cid = await cache_module.get_course_id("SER594")
        assert cid == "111"

    async def test_substring_match_on_course_name(self):
        courses = [
            {
                "id": 222,
                "course_code": "ASUONLINE-XYZ",
                "name": "CSE 240: Discrete Mathematics",
                "sis_course_id": None,
            },
        ]
        with patch(
            "canvas_mcp.core.cache.fetch_all_paginated_results",
            new_callable=AsyncMock,
            return_value=courses,
        ):
            cid = await cache_module.get_course_id("CSE240")
        assert cid == "222"

    async def test_substring_ambiguous_returns_none_then_raw(self):
        courses = [
            {
                "id": 1,
                "course_code": "CSE 240 Section A",
                "name": "A",
                "sis_course_id": None,
            },
            {
                "id": 2,
                "course_code": "CSE 240 Section B",
                "name": "B",
                "sis_course_id": None,
            },
        ]
        with patch(
            "canvas_mcp.core.cache.fetch_all_paginated_results",
            new_callable=AsyncMock,
            return_value=courses,
        ), patch(
            "canvas_mcp.core.cache.make_canvas_request",
            new_callable=AsyncMock,
            return_value={"error": "HTTP error: 404"},
        ):
            cid = await cache_module.get_course_id("CSE240")
        assert cid == "CSE240"
