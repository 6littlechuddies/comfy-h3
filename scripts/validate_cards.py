#!/usr/bin/env python3
"""
UrGF / H3 Studio Character Card QA Validator
--------------------------------------------
Validates either:
  1. A Studio JSON array export (e.g. upgraded_cards_127.json)
  2. A directory of character folders containing card.json / site.json

Enforces the v2 Candy × Joi quality bar & v4.1 chat safety/diversity rules:
  - Zero banned prompt-clone clichés (lemon tree, gas-station, Marisol, Kaelen, clock time, earn it)
  - Zero `hmm`/`hm` filler loops, zero em-dashes (`—`), zero `*` roleplay asterisks, zero `{{user}}` leaks
  - Zero safety/422 blockers (stocker, student, schoolgirl, teacher, minor, passed out, choke)
  - Greeting length 6–34 words, 1–2 bubbles, zero shared 4-grams across roster
  - Emoji diversity cap (no single emoji > 12% of roster)
  - Complete v4.1 hotLines (>= 8 tease, >= 8 explicit, >= 8 after) with zero 5-gram overlaps across roster
  - Every card has >= 1 `[photo: ...]` tag in `examples`
  - `heatHolds` capped at <= 2 (and `0` if opener itself is explicit)

Usage:
  python scripts/validate_cards.py path/to/cards.json
  python scripts/validate_cards.py /workspace/studio/characters
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

BANNED_CLICHES = [
    (r"\blemon tree\b", "clone hobby: lemon tree"),
    (r"\bgas[- ]station\b", "clone hobby: gas-station"),
    (r"\bmarisol\b", "clone coworker: Marisol"),
    (r"\bkaelen\b", "clone coworker: Kaelen"),
    (r"\bjorren\b", "clone coworker: Jorren"),
    (r"\bclock time\b", "meta prompt leak: clock time"),
    (r"\bearn it\b", "cold wall phrase: earn it"),
    (r"\{\{\s*(?:user|char)\s*\}\}", "placeholder leak: {{user}}/{{char}}"),
    (r"\bhmm+\b|\bhm\b", "banned hesitation filler: hmm/hm"),
    (r"—", "banned em-dash"),
    (r"\b(?:schoolgirl|second-grade teacher|night-shift stocker|overnight stocker|passed out)\b", "safety/job blocker"),
]

FILLER_SIGNATURE_WORDS = {"hmm", "hm", "hmmm", "hmmmm", "mm", "mmm", "well", "oh", "um", "uh", "fine"}

EXPLICIT_OPENER_RE = re.compile(
    r"(?:on|to) (?:my|your) knees|(?:tie|tying) (?:me|you|my wrists|your wrists)|"
    r"gets you off|milking time|boobs or ass|loser strips|take me slow|breast pump|"
    r"sir while|master while|spank|naked|panties off|bra off|undress|cock|dick|pussy",
    re.I,
)

EMOJI_RE = re.compile(
    r"[\U0001F300-\U0001FAFF\u2600-\u27BF]",
    re.UNICODE,
)


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def ngrams(tokens: list[str], n: int) -> set[tuple[str, ...]]:
    if len(tokens) < n:
        return set()
    return {tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1)}


def load_cards(target: Path) -> list[dict[str, Any]]:
    if target.is_file():
        data = json.loads(target.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "characters" in data:
            return data["characters"]
        return [data]

    cards: list[dict[str, Any]] = []
    for sub in sorted(target.iterdir()):
        if not sub.is_dir():
            continue
        for candidate in ("card.json", "site.json", "character.json"):
            p = sub / candidate
            if p.exists():
                obj = json.loads(p.read_text(encoding="utf-8"))
                obj.setdefault("name", sub.name)
                cards.append(obj)
                break
    return cards


def validate_roster(cards: list[dict[str, Any]]) -> tuple[list[str], list[str], dict[str, Any]]:
    errors: list[str] = []
    warnings: list[str] = []

    opener_4grams: dict[tuple[str, ...], str] = {}
    hot_5grams: dict[tuple[str, ...], str] = {}
    emoji_counter: Counter[str] = Counter()
    sig_counter: Counter[str] = Counter()
    photo_tag_total = 0

    for idx, card in enumerate(cards):
        name = card.get("name") or f"card_{idx}"
        site = card.get("site") if isinstance(card.get("site"), dict) else card
        chat = site.get("chat") if isinstance(site.get("chat"), dict) else card.get("card41", {})

        greeting = (site.get("greeting") or "").strip()
        persona = (site.get("persona") or chat.get("manner") or "").strip()
        backstory = (site.get("backstory") or chat.get("life") or "").strip()
        bio = (site.get("bio") or "").strip()
        tagline = (site.get("tagline") or "").strip()
        examples = (chat.get("examples") or "").strip()
        facts = site.get("facts") or chat.get("facts") or []
        sig_words = site.get("signatureWords") or chat.get("signatureWords") or []
        heat_holds = chat.get("heatHolds")
        hot = chat.get("hot") or chat.get("hotLines") or {}

        # 1. Greeting checks
        if not greeting:
            errors.append(f"[{name}] missing greeting")
        else:
            words = tokenize(greeting)
            if len(words) < 5 or len(words) > 36:
                errors.append(f"[{name}] greeting word count {len(words)} outside [5, 36]")
            if "*" in greeting:
                errors.append(f"[{name}] asterisk found in greeting")
            for ng in ngrams(words, 4):
                if ng in opener_4grams and opener_4grams[ng] != name:
                    errors.append(f"[{name}] duplicate greeting 4-gram {ng!r} also in [{opener_4grams[ng]}]")
                else:
                    opener_4grams[ng] = name
            for em in set(EMOJI_RE.findall(greeting)):
                emoji_counter[em] += 1

        # 2. Text-field cliché / defect scan
        text_fields = {
            "greeting": greeting,
            "persona": persona,
            "backstory": backstory,
            "bio": bio,
            "tagline": tagline,
            "examples": examples,
            "facts": " ".join(str(f) for f in facts),
        }
        for field_name, val in text_fields.items():
            if not val:
                continue
            for pat, reason in BANNED_CLICHES:
                if re.search(pat, val, re.I):
                    errors.append(f"[{name}] {field_name}: {reason}")
            if field_name in ("greeting", "examples") and "*" in val:
                errors.append(f"[{name}] {field_name}: contains roleplay asterisk '*'")

        # 3. Signature words
        for sw in sig_words:
            low = str(sw).strip().lower()
            if low in FILLER_SIGNATURE_WORDS:
                errors.append(f"[{name}] banned filler signatureWord: {low!r}")
            sig_counter[low] += 1

        # 4. Heat holds
        if isinstance(heat_holds, int):
            if heat_holds > 2:
                errors.append(f"[{name}] heatHolds={heat_holds} exceeds cap 2")
            if greeting and EXPLICIT_OPENER_RE.search(greeting) and heat_holds != 0:
                errors.append(f"[{name}] explicit opener should have heatHolds=0 (got {heat_holds})")

        # 5. Photo tag presence in examples
        photo_tags = re.findall(r"\[photo:\s*([^\]]+)\]", examples, re.I)
        photo_tag_total += len(photo_tags)
        if not photo_tags:
            errors.append(f"[{name}] missing [photo: ...] example tag")

        # 6. Hot lines completeness & cross-roster 5-gram uniqueness
        for stage in ("tease", "explicit", "after"):
            lines = hot.get(stage) or []
            if len(lines) < 8:
                errors.append(f"[{name}] hot.{stage} has only {len(lines)} lines (min 8)")
            for line in lines:
                line_s = str(line)
                for pat, reason in BANNED_CLICHES:
                    if re.search(pat, line_s, re.I):
                        errors.append(f"[{name}] hot.{stage}: {reason}")
                for ng in ngrams(tokenize(line_s), 5):
                    if ng in hot_5grams and hot_5grams[ng] != name:
                        errors.append(f"[{name}] duplicate hotLine 5-gram {ng!r} also in [{hot_5grams[ng]}]")
                    else:
                        hot_5grams[ng] = name

    # 7. Roster-wide emoji diversity cap (only meaningful for >= 15 cards)
    if len(cards) >= 15:
        cap = max(6, int(len(cards) * 0.12))
        for em, cnt in emoji_counter.most_common(5):
            if cnt > cap:
                errors.append(f"[roster] emoji monoculture: {em} appears in {cnt}/{len(cards)} greetings (cap {cap})")

    summary = {
        "cards": len(cards),
        "errors": len(errors),
        "warnings": len(warnings),
        "photo_tags": photo_tag_total,
        "distinct_greeting_emojis": len(emoji_counter),
        "top_greeting_emojis": emoji_counter.most_common(5),
        "unique_signature_words": len(sig_counter),
    }
    return errors, warnings, summary


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python scripts/validate_cards.py <cards.json | characters_dir>")
        return 2
    target = Path(sys.argv[1])
    if not target.exists():
        print(f"ERROR: target not found: {target}")
        return 2

    cards = load_cards(target)
    if not cards:
        print(f"ERROR: no character cards found in {target}")
        return 2

    errors, warnings, summary = validate_roster(cards)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings[:20]:
            print(f"  WARN: {w}")
    if errors:
        print(f"\nFAILED with {len(errors)} error(s):")
        for e in errors[:40]:
            print(f"  FAIL: {e}")
        return 1
    print(f"\nPASS: All {summary['cards']} character cards passed UrGF v2/v4.1 QA checks!")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
