// Act3 Terra import must scope to act3autochess — shared chess ids (e.g. 6_16) are Mudrock in act1 and Talulah in act3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PATHS = join(ROOT, 'tools/i18n/terra-act3-en-paths.json');
const EN = join(ROOT, 'data/versions/act3autochess-v3_1/i18n/en.json');

test('terra act3 paths: Talulah is not Mudrock/Sharp; garrison attrs have desc leaves', () => {
  assert.ok(existsSync(PATHS), 'run node tools/i18n/import-terra-act3-en.mjs');
  const { leaves } = JSON.parse(readFileSync(PATHS, 'utf8'));
  const names = leaves.filter((l) => l.file === 'chess' && l.id === 'chess_char_6_16_a' && l.path.join('.') === 'name');
  assert.ok(names.length >= 1);
  assert.equal(names[names.length - 1].en, 'Talulah');
  assert.ok(!names.some((l) => l.en === 'Sharp' || l.en === 'Mudrock'));

  const garDesc = leaves.filter((l) => l.file === 'garrisons' && l.path.join('.') === 'desc');
  assert.ok(garDesc.length > 200, `expected many garrison desc leaves, got ${garDesc.length}`);
  const ursus = garDesc.find((l) => l.id === 'garrison_23_a');
  assert.ok(ursus?.en.includes('[Ursus]'), ursus?.en);
});

test('built act3 en.json localizes Talulah, garrison_23_a, and Amiya strategy', () => {
  assert.ok(existsSync(EN), 'run node tools/build-version-i18n.mjs');
  const en = JSON.parse(readFileSync(EN, 'utf8'));
  assert.equal(en.files.chess.chess_char_6_16_a.name, 'Talulah');
  assert.ok(en.files.garrisons.garrison_23_a.desc.includes('[Ursus]'));
  assert.equal(en.files.bands.band_amiya.name, 'Amiya');
  assert.equal(en.files.bands.band_amiya.effectName, 'Wills As One');
  assert.ok(en.files.bands.band_amiya.desc.includes('Passive'));
  assert.equal(en.files.factions.types.REBORN.name, 'Tactical Training/Resurgence');
});

test('act3 Current Effect (effectDescRaw) comes from Terra alliance steps', () => {
  assert.ok(existsSync(PATHS), 'run node tools/i18n/import-terra-act3-en.mjs');
  assert.ok(existsSync(EN), 'run node tools/build-version-i18n.mjs');
  const { leaves } = JSON.parse(readFileSync(PATHS, 'utf8'));
  const sargonFx = leaves.filter((l) => l.file === 'bonds' && l.id === 'sargonShip' && l.path.join('.') === 'effectDescRaw');
  assert.ok(sargonFx.length >= 1, 'sargonShip effectDescRaw path');
  const enFx = sargonFx[sargonFx.length - 1].en;
  assert.ok(enFx.includes('quicksand'), enFx.slice(0, 120));
  assert.ok(enFx.includes('{0:'), 'layer placeholders preserved when stack notes align');
  assert.ok(!/[\u4e00-\u9fff]/.test(enFx), 'no CJK in Terra effect EN');

  const en = JSON.parse(readFileSync(EN, 'utf8'));
  const raw = en.files.bonds.sargonShip.effectDescRaw;
  assert.ok(raw.includes('quicksand'), raw.slice(0, 160));
  assert.ok(raw.includes('{0:'), raw);
  assert.ok(!/[\u4e00-\u9fff]/.test(raw));
  assert.ok(en.files.effects.bondeffect_sargon_2.descRaw.includes('quicksand'));
});

test('act3 command skills (replace-command draft) are English', () => {
  assert.ok(existsSync(EN), 'run node tools/build-version-i18n.mjs');
  const en = JSON.parse(readFileSync(EN, 'utf8'));
  const price = en.files.bands.band_price.skills[0].descRaw;
  assert.match(price, /Insider Supply/);
  assert.match(price, /Click to use/);
  assert.ok(!/消耗|内部货源/.test(price), price);
  assert.ok(!/\(Cost \d+\)/.test(price), 'skill row omits Cost (HUD shows it)');
  const jengaActive = en.files.bands.band_jenga.skills[1].descRaw;
  assert.match(jengaActive, /Clause Amendment/);
  assert.match(jengaActive, /Drag to use/);
  assert.ok(!/解锁|条文修正/.test(jengaActive), jengaActive);
  assert.ok(en.files.effects.aceffect_band_73.descRaw.includes('Insider Supply'));
  assert.ok(en.files.effects.aceffect_band_89.descRaw.includes('Clause Amendment'));
});
