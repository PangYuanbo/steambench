#!/usr/bin/env python3
"""Ingest a curated set of popular Steam games into a seed catalog.

Pulls REAL public Steam data (global achievement %, store details, SteamSpy
owner estimates), runs each game through the SteamBench difficulty engine, and
writes a single ``catalog.json`` the web app and demos consume. No API key
required.

Usage:
    python scripts/ingest_seed.py                 # default curated list
    python scripts/ingest_seed.py 1145360 413150  # specific appids
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

# Make the engine importable whether run from repo root or scripts/.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))

from steambench.ingest import build_game  # noqa: E402
from steambench.difficulty import Tier  # noqa: E402

# Curated for: popularity, rich + well-distributed achievement ladders, genre
# spread, and games an AI agent could plausibly be benchmarked on later.
CURATED = [
    (1145360, "Hades"),
    (413150, "Stardew Valley"),
    (105600, "Terraria"),
    (367520, "Hollow Knight"),
    (504230, "Celeste"),
    (268910, "Cuphead"),
    (1794680, "Vampire Survivors"),
    (620, "Portal 2"),
    (646570, "Slay the Spire"),
    (588650, "Dead Cells"),
    (632360, "Risk of Rain 2"),
    (294100, "RimWorld"),
    (427520, "Factorio"),
    (322330, "Don't Starve Together"),
    (1086940, "Baldur's Gate 3"),
    (1245620, "Elden Ring"),
    (292030, "The Witcher 3"),
    (814380, "Sekiro"),
    (236430, "Dark Souls II"),
    (391540, "Undertale"),
    (250900, "The Binding of Isaac: Rebirth"),
    (242760, "The Forest"),
    # --- expanded catalog: more popular, achievement-rich games ---
    (1091500, "Cyberpunk 2077"),
    (264710, "Subnautica"),
    (753640, "Outer Wilds"),
    (632470, "Disco Elysium"),
    (1313140, "Cult of the Lamb"),
    (548430, "Deep Rock Galactic"),
    (892970, "Valheim"),
    (1092790, "Inscryption"),
    (553420, "TUNIC"),
    (2379780, "Balatro"),
    (736260, "Baba Is You"),
    (418530, "Spelunky 2"),
    (220, "Half-Life 2"),
    (400, "Portal"),
    (782330, "DOOM Eternal"),
    (1145350, "Hades II"),
    (1868140, "Dave the Diver"),
    (1244090, "Sea of Stars"),
    (526870, "Satisfactory"),
    (322170, "Geometry Dash"),
    # --- third wave: more all-time popular, achievement-rich titles ---
    (550, "Left 4 Dead 2"),
    (252490, "Rust"),
    (49520, "Borderlands 2"),
    (489830, "Skyrim Special Edition"),
    (377160, "Fallout 4"),
    (582010, "Monster Hunter: World"),
    (289070, "Civilization VI"),
    (281990, "Stellaris"),
    (387290, "Ori and the Blind Forest"),
    (1057090, "Ori and the Will of the Wisps"),
    (219150, "Hotline Miami"),
    (311690, "Enter the Gungeon"),
    (460950, "Katana ZERO"),
    (1966720, "Lethal Company"),
    (224760, "FEZ"),
    (40700, "Machinarium"),
    (35140, "Batman: Arkham Asylum"),
    # --- fourth wave ---
    (440, "Team Fortress 2"),
    (218620, "PAYDAY 2"),
    (255710, "Cities: Skylines"),
    (205100, "Dishonored"),
    (8870, "BioShock Infinite"),
    (524220, "NieR:Automata"),
    (894020, "Death's Door"),
    (253230, "A Hat in Time"),
    (219990, "Grim Dawn"),
    (1158310, "Crusader Kings III"),
    (1282730, "Loop Hero"),
    (221910, "The Stanley Parable"),
    (323190, "Frostpunk"),
    (433340, "Slime Rancher"),
    (1942280, "Brotato"),
    # --- fifth wave: AAA + acclaimed titles, all achievement-rich ---
    (1174180, "Red Dead Redemption 2"),
    (271590, "Grand Theft Auto V"),
    (1593500, "God of War"),
    (1817070, "Marvel's Spider-Man Remastered"),
    (1817190, "Marvel's Spider-Man: Miles Morales"),
    (2050650, "Resident Evil 4"),
    (1196590, "Resident Evil Village"),
    (990080, "Hogwarts Legacy"),
    (601150, "Devil May Cry 5"),
    (374320, "DARK SOULS III"),
    (570940, "DARK SOULS: REMASTERED"),
    (1888160, "ARMORED CORE VI"),
    (1716740, "Starfield"),
    (275850, "No Man's Sky"),
    (394360, "Hearts of Iron IV"),
    (236850, "Europa Universalis IV"),
    (812140, "Assassin's Creed Odyssey"),
    (582160, "Assassin's Creed Origins"),
    (1328670, "Mass Effect Legendary Edition"),
    (1426210, "It Takes Two"),
    (739630, "Phasmophobia"),
    (648800, "Raft"),
    (1144200, "Ready or Not"),
    (210970, "The Witness"),
    (435150, "Divinity: Original Sin 2"),
    (286690, "Middle-earth: Shadow of Mordor"),
    (530700, "Conan Exiles"),
    (251570, "7 Days to Die"),
    (105450, "Age of Empires II: Definitive Edition"),
    (945360, "Among Us"),
]


def main() -> None:
    args = [int(a) for a in sys.argv[1:] if a.isdigit()]
    targets = [(a, "") for a in args] if args else CURATED

    out_dir = ROOT / "data" / "seed"
    out_dir.mkdir(parents=True, exist_ok=True)

    games = []
    seen_appids: set[int] = set()
    for appid, hint in targets:
        if appid in seen_appids:
            continue
        seen_appids.add(appid)
        label = hint or str(appid)
        try:
            g = build_game(appid)
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {label} ({appid}): {e}")
            continue
        if not g.achievements:
            print(f"  – {g.name or label} ({appid}): no public achievements, skipping")
            continue
        games.append(g)
        hardest = g.hardest
        print(
            f"  ✓ {g.name:<32} {g.num_achievements:>3} ach  "
            f"{g.total_bits:>7.1f} bits  hardest={hardest.percent:>5.2f}% "
            f"({hardest.tier.label})"
        )
        time.sleep(0.4)  # be polite to public endpoints

    catalog = {
        "version": 1,
        "generated_by": "steambench/scripts/ingest_seed.py",
        "num_games": len(games),
        "games": [g.as_dict(include_tasks=True) for g in games],
    }
    out_path = out_dir / "catalog.json"
    out_path.write_text(json.dumps(catalog, indent=2))

    # Also emit a compact difficulty summary for quick inspection / docs.
    summary = {
        "num_games": len(games),
        "total_tasks": sum(g.num_achievements for g in games),
        "by_tier": _global_tier_histogram(games),
        "hardest_overall": _hardest_overall(games),
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))

    print(f"\nWrote {out_path} ({len(games)} games, {summary['total_tasks']} tasks)")
    print("Tier distribution across all tasks:")
    for tier in Tier:
        print(f"  {tier.label:<10} {summary['by_tier'].get(tier.value, 0)}")
    print("\nTop 5 hardest objectives across all games:")
    for h in summary["hardest_overall"][:5]:
        print(f"  {h['percent']:>5.2f}%  {h['points']:>5} pts  {h['game']} — {h['name']}")


def _global_tier_histogram(games) -> dict:
    hist: dict[str, int] = {t.value: 0 for t in Tier}
    for g in games:
        for k, v in g.tier_histogram().items():
            hist[k] += v
    return hist


def _hardest_overall(games) -> list:
    rows = []
    for g in games:
        for a in g.achievements:
            rows.append(
                {
                    "game": g.name,
                    "appid": g.appid,
                    "name": a.name,
                    "percent": round(a.percent, 3),
                    "points": a.points,
                    "tier": a.tier.value,
                }
            )
    rows.sort(key=lambda r: r["percent"])
    return rows[:50]


if __name__ == "__main__":
    main()
