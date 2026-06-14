"""Pull real Steam data from public endpoints and build :class:`Game` objects.

No Steam Web API key is required for the core difficulty signal: the global
achievement-percentage endpoint, the store appdetails endpoint, and SteamSpy are
all public. A key (``STEAM_API_KEY``) is only used, when present, to enrich
achievements with display names/descriptions via ``GetSchemaForGame``; otherwise
we best-effort scrape the public community stats page for those labels.

Stdlib only, so the engine stays dependency-free. Network calls are wrapped so a
single flaky endpoint degrades gracefully instead of failing the whole ingest.
"""

from __future__ import annotations

import html as _html
import json
import os
import re
import time
import urllib.parse
import urllib.request
from typing import Optional

from .catalog import Achievement, Game

_UA = "SteamBench/0.1 (+https://github.com/steambench) ingest"
_TIMEOUT = 20


def _get(url: str, *, as_json: bool = True, retries: int = 3):
    """GET with a browser-ish UA and basic retry/backoff."""
    last_err: Optional[Exception] = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _UA})
            with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw) if as_json else raw
        except Exception as e:  # noqa: BLE001 - network is best-effort
            last_err = e
            time.sleep(0.8 * (attempt + 1))
    if last_err:
        raise last_err
    return None


# --------------------------------------------------------------------------- #
# Individual public endpoints
# --------------------------------------------------------------------------- #


def fetch_global_percentages(appid: int) -> dict[str, float]:
    """{apiname: percent} from the public global-achievement endpoint.

    This is the authoritative difficulty signal and needs no API key.
    """
    url = (
        "https://api.steampowered.com/ISteamUserStats/"
        f"GetGlobalAchievementPercentagesForApp/v0002/?gameid={appid}&format=json"
    )
    data = _get(url)
    out: dict[str, float] = {}
    for row in (data or {}).get("achievementpercentages", {}).get("achievements", []):
        try:
            out[row["name"]] = float(row["percent"])
        except (KeyError, TypeError, ValueError):
            continue
    return out


def fetch_store_details(appid: int) -> dict:
    """Name, genres, header image, short description, achievement count."""
    url = (
        "https://store.steampowered.com/api/appdetails"
        f"?appids={appid}&filters=basic,genres,achievements&l=english"
    )
    data = _get(url) or {}
    entry = data.get(str(appid), {})
    if not entry.get("success"):
        return {}
    d = entry.get("data", {})
    return {
        "name": d.get("name", ""),
        "genres": [g.get("description", "") for g in d.get("genres", [])],
        "header_image": d.get("header_image", ""),
        "short_description": d.get("short_description", ""),
        "achievement_total": d.get("achievements", {}).get("total", 0),
    }


def fetch_steamspy(appid: int) -> dict:
    """Owner-count estimate + review counts from SteamSpy (popularity weight)."""
    url = f"https://steamspy.com/api.php?request=appdetails&appid={appid}"
    d = _get(url) or {}
    owners = _parse_owners_band(d.get("owners", ""))
    pos = int(d.get("positive", 0) or 0)
    neg = int(d.get("negative", 0) or 0)
    return {
        "owners_estimate": owners,
        "review_count": pos + neg,
        "name": d.get("name", ""),
    }


def _parse_owners_band(band: str) -> Optional[int]:
    """'20,000,000 .. 50,000,000' -> 35,000,000 (midpoint)."""
    nums = [int(x.replace(",", "")) for x in re.findall(r"[\d,]+", band or "")]
    if len(nums) >= 2:
        return (nums[0] + nums[1]) // 2
    if len(nums) == 1:
        return nums[0]
    return None


def fetch_schema_names(appid: int, api_key: Optional[str]) -> dict[str, dict]:
    """{apiname: {display_name, description, icon, icon_gray, hidden}} via the
    official schema endpoint. Requires an API key; returns {} without one."""
    if not api_key:
        return {}
    url = (
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/"
        f"?key={urllib.parse.quote(api_key)}&appid={appid}&l=english"
    )
    try:
        data = _get(url) or {}
    except Exception:
        return {}
    achs = (
        data.get("game", {})
        .get("availableGameStats", {})
        .get("achievements", [])
    )
    out: dict[str, dict] = {}
    for a in achs:
        out[a.get("name", "")] = {
            "display_name": a.get("displayName", ""),
            "description": a.get("description", ""),
            "icon": a.get("icon", ""),
            "icon_gray": a.get("icongray", ""),
            "hidden": bool(a.get("hidden", 0)),
        }
    return out


_SCRAPE_BLOCK = re.compile(
    r'<div class="achieveTxt"[^>]*>\s*<h3>(?P<name>.*?)</h3>\s*'
    r'<h5>(?P<desc>.*?)</h5>',
    re.DOTALL,
)
# Capture icon + name + desc from inside the SAME achievement row container so
# the icon can never desync from its label (the failure mode of two independent
# match lists zipped by count).
_SCRAPE_ROW = re.compile(
    r'<div class="achieveRow[^"]*">.*?<img[^>]+src="(?P<icon>[^"]+)".*?'
    r"<h3>(?P<name>.*?)</h3>\s*<h5>(?P<desc>.*?)</h5>",
    re.DOTALL,
)


def scrape_community_achievements(
    appid: int,
) -> tuple[list[tuple[str, str]], list[tuple[str, str, str]]]:
    """Best-effort scrape of the public stats page. Returns ``(names_only, rows)``:

    * ``rows``       -- ``[(name, desc, icon)]`` captured from the same row, so the
      icon is guaranteed to belong to that achievement (preferred).
    * ``names_only`` -- ``[(name, desc)]`` fallback for pages where the row regex
      under-matches but the simpler name regex still aligns.

    The page lists achievements in the *same schema order* as the global-%
    endpoint, so callers align positionally with no API key. Never raises.
    """
    url = f"https://steamcommunity.com/stats/{appid}/achievements/"
    try:
        page = _get(url, as_json=False) or ""
    except Exception:
        return [], []

    def _clean(s: str) -> str:
        return _html.unescape(re.sub(r"<.*?>", "", s).strip())

    rows: list[tuple[str, str, str]] = []
    for m in _SCRAPE_ROW.finditer(page):
        rows.append((_clean(m.group("name")), _clean(m.group("desc")), _html.unescape(m.group("icon").strip())))
    names_only: list[tuple[str, str]] = [
        (_clean(m.group("name")), _clean(m.group("desc"))) for m in _SCRAPE_BLOCK.finditer(page)
    ]
    return names_only, rows


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def build_game(appid: int, api_key: Optional[str] = None, *, enrich: bool = True) -> Game:
    """Fetch everything public about ``appid`` and assemble a :class:`Game`.

    Args:
        api_key: optional Steam Web API key (only for nicer achievement labels).
        enrich: if True, attempt schema/community-name enrichment.
    """
    api_key = api_key or os.environ.get("STEAM_API_KEY")

    percentages = fetch_global_percentages(appid)
    store = {}
    spy = {}
    try:
        store = fetch_store_details(appid)
    except Exception:
        pass
    try:
        spy = fetch_steamspy(appid)
    except Exception:
        pass

    names: dict[str, dict] = {}
    if enrich:
        names = fetch_schema_names(appid, api_key)
        if not names:
            # Keyless: align the community page's labels (and icons) to apinames by
            # position (same schema order). Prefer row-aligned (name+desc+icon
            # captured together); fall back to names-only. Only trust exact counts.
            names_only, rows = scrape_community_achievements(appid)
            n = len(percentages)
            if rows and len(rows) == n:
                for (api, _pct), (disp, desc, icon) in zip(percentages.items(), rows):
                    names[api] = {"display_name": disp, "description": desc,
                                  "icon": icon, "icon_gray": "", "hidden": False}
            elif names_only and len(names_only) == n:
                for (api, _pct), (disp, desc) in zip(percentages.items(), names_only):
                    names[api] = {"display_name": disp, "description": desc,
                                  "icon": "", "icon_gray": "", "hidden": False}

    achievements: list[Achievement] = []
    for apiname, percent in percentages.items():
        meta = names.get(apiname, {})
        achievements.append(
            Achievement(
                apiname=apiname,
                percent=percent,
                display_name=meta.get("display_name", ""),
                description=meta.get("description", ""),
                icon=meta.get("icon", ""),
                icon_gray=meta.get("icon_gray", ""),
                hidden=meta.get("hidden", False),
            )
        )

    # Sort hardest-first so the catalog reads like a difficulty ladder.
    achievements.sort(key=lambda a: a.bits, reverse=True)

    name = store.get("name") or spy.get("name") or f"App {appid}"
    return Game(
        appid=appid,
        name=name,
        achievements=achievements,
        genres=store.get("genres", []),
        owners_estimate=spy.get("owners_estimate"),
        review_count=spy.get("review_count"),
        header_image=store.get("header_image", ""),
        short_description=store.get("short_description", ""),
    )
