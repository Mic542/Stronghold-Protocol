# Act3 English game-text overlay

Date: 2026-11-20  
Status: approved (chat)  
Reference: https://terra-archive.net/en/autochess/s3 (full season, including `#op`)

## Problem

English UI (`public/i18n/en.json`) does not localize operator/skill/bond/item text on **versioned** seasons. Those modes ignore shared `data/i18n/en.json` and only apply a content-set overlay under the version data dir. `act3autochess@V3_1` ships no `i18n/en.json`, so game text stays Chinese.

## Goal

Full English game text for Regulation season Ⅰ (`data/versions/act3autochess-v3_1/`), so English UI shows translated operators, skills, talents, bonds/alliances, items, enemies, stages, bosses, garrisons, effects, tokens, choices, factions, backups, and related string leaves.

Out of scope: UI pack strings; act1/act2 overlays; claiming official YoStar quality; in-game “unofficial” banners (per user: Terra Archive wording is accepted as-is).

## Approach

**Pipeline → one overlay file** (not hand-maintained forever).

Deliverable:

- `data/versions/act3autochess-v3_1/i18n/en.json` — same shape as shared overlays (`shared/i18nData.js`: `version`, `lang`, `meta`, `names`, `files` with `_h` hashes).
- A small rebuild tool under `tools/` that can regenerate that file from sources below.

Runtime already loads `dataDir/i18n/*.json` into content sets (`server/plugins/contentSet.js`). No client language-switch redesign.

## Translation sources (priority)

For each Chinese string leaf in act3 tables:

1. **Reuse** — if the exact Chinese text already maps in shared `data/i18n/en.json` (or its name map), use that English.
2. **Terra Archive** — S3 English for operators, alliances/bonds, items, and other pages covered by the site; match by stable ids / names where possible, else by Chinese source text.
3. **Leave Chinese** — missing leaves stay untranslated (runtime fallback). No fake filler.

Numbers and rich-text tags must stay consistent with remake data (same rule as `tools/build-i18n.mjs`: do not paste EN-server numbers over CN remake numbers). Prefer template-style fill when Terra/shared EN differs only by resolved blackboard values.

## Non-goals / constraints

- Do not hand-edit generated `data/*.json` gameplay tables; only add/regenerate the version `i18n/en.json` (and the generator).
- Do not copy `MANIFEST.json` / update-zip gates into the git tree.
- Stale overlay leaves (Chinese `_h` mismatch after a data rebuild) must not apply — player sees current Chinese, never wrong stats text.

## Verification

- Overlay applies cleanly to act3 tables (no mass stale failures).
- With UI language English and version `act3autochess@V3_1`, spot-check: operator name/skill, one bond, one item, one enemy/stage if present in overlay.
- Coverage report (translated / total leaves) written beside the build (e.g. under `.cache/`) for inspection.

## Risks

- Terra Archive HTML may lack a public JSON API; scraping or manual export may be needed for a durable dict.
- Site coverage will not equal every act3 leaf (especially `effects.json`); expect partial coverage until more dict entries exist.
- Id reuse across seasons is why shared EN is gated; the version overlay must be keyed to **act3** records only.
