#!/usr/bin/env node
// Import Terra Archive EN autochess JS into:
//   tools/i18n/terra-act3-en.json        — flat zh→en (for reuse-misses)
//   tools/i18n/terra-act3-en-paths.json  — {file,id,path,en} leaves keyed by act3 ids
//
// Chess ids are reused across seasons (act1 Mudrock is chess_char_6_16_a; act3 Talulah is too).
// Only the act3autochess season block is read. Operator `n:null` means Terra has no EN name yet —
// fall back to the record's Latin appellation (or a small Cyrillic map), never the backup `bk.n`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DICT_OUT = join(ROOT, 'tools/i18n/terra-act3-en.json');
const PATHS_OUT = join(ROOT, 'tools/i18n/terra-act3-en-paths.json');
const CACHE = join(ROOT, '.cache/terra-autochess-en.js');
const SRC = 'https://terra-archive.net/assets/autochess-en-DxX1_XUQ.js';

/** Cyrillic appellations → Latin for the English UI. */
const CYR_APP = Object.freeze({ Ольга: 'Olga', Тоска: 'Toska' });

const unmd = (s) => String(s || '').replace(/\*\*/g, '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
const unescapeJson = (s) => String(s || '').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
/** Terra `**bold**` → official value-up spans (Current Effect highlights). */
const boldToVup = (s) => String(s || '').replace(/\*\*([^*]+)\*\*/g, '<@ba.vup>$1</>');
const stripTags = (s) => String(s || '').replace(/<[@$][^>]+>/g, '').replace(/<\/>/g, '');

/**
 * Terra alliance `steps:[{c?,t},…]` → Current Effect body (`<cond>text` lines).
 * When the count of "(affected by no. of stacks)" matches ZH `{i:fmt}` placeholders, wrap each
 * so formatBondEffect can resolve layer numbers (DATA.md §3).
 */
function parseBondSteps(obj) {
  const stepsStart = obj.indexOf('steps:[');
  if (stepsStart < 0) return [];
  let i = stepsStart + 6, depth = 0, inTick = false, end = -1;
  for (; i < obj.length; i++) {
    const ch = obj[i];
    if (ch === '`') { inTick = !inTick; continue; }
    if (inTick) continue;
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return [];
  const arr = obj.slice(stepsStart + 6, end);
  const steps = [];
  const re = /\{(?:c:`([^`]*)`,)?t:`([^`]*)`/g;
  let m;
  while ((m = re.exec(arr))) steps.push({ c: m[1] || null, t: m[2] });
  return steps;
}

function injectStackPlaceholders(en, zhRaw) {
  const phs = [...String(zhRaw || '').matchAll(/\{(\d+)(?::([^{}]*))?\}/g)]
    .map((m) => ({ index: m[1], format: m[2] || '0' }));
  if (!phs.length) return en;
  // Longer alternative first so "a period of time (affected…)" is one token (ZH `{i:0}秒`).
  const tokenRe = /a period of time \(affected by no\. of stacks\)|\(affected by no\. of stacks\)/gi;
  const hits = [...en.matchAll(tokenRe)];
  if (hits.length !== phs.length) return en;
  let i = 0;
  return en.replace(tokenRe, (whole) => {
    const p = phs[i++];
    if (/^a period of time/i.test(whole)) {
      return `<@ba.vup>{${p.index}:${p.format}}</> seconds <@ba.acrem>(affected by no. of stacks)</>`;
    }
    return `<@ba.vup>{${p.index}:${p.format}}</> <@ba.acrem>(affected by no. of stacks)</>`;
  });
}

function effectEnFromSteps(steps, zhRaw) {
  if (!steps.length) return null;
  const body = steps.map((s) => {
    const t = boldToVup(s.t);
    return s.c ? `<${boldToVup(s.c)}>${t}` : t;
  }).join('\n');
  return injectStackPlaceholders(body, zhRaw);
}

/** Terra sometimes concatenates unlock + use on one line ("Unlocks on Round 4Drag to use"). */
function normalizeBandBodyEn(body) {
  let s = unmd(body);
  s = s.replace(/(Unlocks on Round \d+)\s*(?=(?:Drag|Click) to use)/i, '$1\n');
  s = s.replace(/(Unlocks[^\n]*?)\s*(?=(?:Drag|Click) to use|Passive)/i, (_, a) => `${a.trim()}\n`);
  return s.trim();
}

/**
 * Skill / effect row EN from Terra's band body. Skill rows omit cost (shown separately in the UI) and may be
 * locked or leveled variants of the strategy card text.
 */
function skillDescEn(effectNameEn, terraBody, skillZh) {
  const zh = String(skillZh || '');
  let body = normalizeBandBodyEn(terraBody || '');
  if (!body && !effectNameEn) return null;
  if (!/消耗/.test(zh)) body = body.replace(/\s*\(Cost \d+\)/g, '');
  if (!/解锁/.test(zh)) body = body.replace(/^Unlocks[^\n]*\n+/im, '');
  const zhTitle = (zh.match(/【([^】]+)】/) || [])[1] || '';
  let title = unmd(effectNameEn) || zhTitle;
  if (/未解锁/.test(zhTitle)) title = `${title} - Locked`;
  else {
    const lv = zhTitle.match(/-(\d+)级$/);
    if (lv) title = `${title} - Lv.${lv[1]}`;
  }
  const head = title ? `【${title}】` : '';
  return [head, body].filter(Boolean).join('\n');
}

async function loadModule() {
  try {
    const t = readFileSync(CACHE, 'utf8');
    if (t.includes('act3autochess') && t.includes('Minimalist')) return t;
  } catch { /* fetch */ }
  const t = await (await fetch(SRC, { headers: { 'user-agent': 'stronghold-protocol-i18n' } })).text();
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, t);
  return t;
}

/** The act3autochess season object text (through EOF — Terra currently ends with act3). */
function act3Block(src) {
  const start = src.indexOf('id:`act3autochess`');
  if (start < 0) throw new Error('act3autochess season not found in Terra EN module');
  const next = src.indexOf('id:`act', start + 10);
  return src.slice(start, next > 0 ? next : src.length);
}

function extractObjects(src, idPrefix) {
  const out = [];
  const re = new RegExp(`\\{id:\`${idPrefix}[^\`]*\``, 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = m.index, depth = 0, inTick = false, end = -1;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '`') { inTick = !inTick; continue; }
      if (inTick) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end > 0) out.push(src.slice(m.index, end));
  }
  return out;
}

/** Backtick field; `(?:^|[,{])` so `icon:` does not match key `n`. */
const field = (obj, key) => (obj.match(new RegExp(`(?:^|[,{])${key}:\`([^\`]*)\``)) || [])[1] || null;

/**
 * Act3-only EN that Terra's season block lacks (new faction types / leaders). Flat zh→en for the builder.
 * [ASSUMED] OpFor Mech/Cocoon/Fin and 矩兽 follow the same OpFor / beast naming as Terra's other leaders.
 */
const EXTRA_DICT = Object.freeze({
  '特训敌人·复苏': 'Tactical Training/Resurgence',
  '此类敌人首次被击倒后会重生': 'This enemy type revives after being defeated for the first time',
  '特训敌人·致命': 'Tactical Training/Fatal',
  '此类敌人在特定条件下造成高额伤害': 'This enemy type deals high damage under specific conditions',
  '假想敌：械': 'OpFor: Mech',
  '假想敌：茧': 'OpFor: Cocoon',
  '假想敌：鳍': 'OpFor: Fin',
  '矩兽': 'Rectangular Beast',
});

/** Top-level chess `n:` after `op:` — never `bk.n` (Sharp, Mechanist, …). */
function chessName(obj) {
  const m = obj.match(/,op:`[^`]+`,n:(null|`([^`]*)`)/);
  if (!m) return null;
  if (m[1] === 'null') return null;
  return m[2] || null;
}

/**
 * Garrison EN texts are embedded as JSON-style maps: "garrison_23_a":{"d":"<In battle>…","t":"Can stack",…}.
 * Earlier seasons appear first; later duplicate ids win (act3).
 */
function parseGarrisonMap(src) {
  /** @type {Map<string, { d: string, t: string }>} */
  const by = new Map();
  const re = /"(garrison_\d+_[ab])":\{"d":"((?:\\.|[^"\\])*)","t":"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(src))) {
    by.set(m[1], { d: unescapeJson(m[2]), t: unescapeJson(m[3]) });
  }
  return by;
}

function nameFallback(rec) {
  const app = typeof rec?.appellation === 'string' ? rec.appellation.trim() : '';
  if (!app) return null;
  if (CYR_APP[app]) return CYR_APP[app];
  // Latin / ASCII appellation (Talulah, Clementia, Homebound, …)
  if (/^[\x20-\x7E]+$/.test(app)) return app;
  return null;
}

const src = await loadModule();
const block = act3Block(src);
const chessZh = JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/chess.json'), 'utf8'));
const chessRows = chessZh.chess || chessZh;
const bondRows = (JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/bonds.json'), 'utf8')).bonds
  || JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/bonds.json'), 'utf8')));
const garRows = (JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/garrisons.json'), 'utf8')).garrisons
  || JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/garrisons.json'), 'utf8')));
const itemRows = (JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/items.json'), 'utf8')).items
  || JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/items.json'), 'utf8')));
const bandRows = (JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/bands.json'), 'utf8')).bands
  || JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/bands.json'), 'utf8')));
const effectRows = (JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/effects.json'), 'utf8')).effects
  || JSON.parse(readFileSync(join(ROOT, 'data/versions/act3autochess-v3_1/effects.json'), 'utf8')));

/** @type {Record<string, string>} */
const dict = Object.create(null);
/** @type {{ file: string, id: string, path: (string|number)[], en: string }[]} */
const paths = [];
const addDict = (zh, en) => {
  const e = unmd(en); if (!zh || !e || zh === e || !/[\u4e00-\u9fff]/.test(zh)) return;
  if (!dict[zh]) dict[zh] = e;
};
const addPath = (file, id, path, en, zh) => {
  const e = unmd(en); if (!e) return;
  paths.push({ file, id, path, en: e });
  if (zh) addDict(zh, e);
};
/** Path leaf that already carries official `<@ba.*>` / `$` markup (do not strip). */
const addPathKeep = (file, id, path, en, zh) => {
  const e = String(en || '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
  if (!e) return;
  paths.push({ file, id, path, en: e });
  if (zh) addDict(zh, stripTags(e) || e);
};
for (const [zh, en] of Object.entries(EXTRA_DICT)) addDict(zh, en);

// Bonds (act3 block only — same Ship ids across seasons)
let bondEffectHits = 0;
for (const obj of extractObjects(block, '')) {
  const id = field(obj, 'id');
  if (!id || !id.endsWith('Ship') || !bondRows[id]) continue;
  const n = field(obj, 'n');
  if (n) addPath('bonds', id, ['name'], n, bondRows[id].name);
  const steps = parseBondSteps(obj);
  const step0 = steps[0]?.t || (obj.match(/steps:\[\s*\{[^}]*t:`([^`]*)`/) || [])[1];
  if (step0) {
    if (bondRows[id].desc) addPath('bonds', id, ['desc'], step0, bondRows[id].desc);
    if (bondRows[id].descRaw) addPath('bonds', id, ['descRaw'], step0, bondRows[id].descRaw);
  }
  // Current Effect = full Terra steps (Alliance Effect stays step0 / desc)
  const effectEn = effectEnFromSteps(steps, bondRows[id].effectDescRaw);
  if (effectEn) {
    bondEffectHits++;
    const plain = stripTags(effectEn);
    if (bondRows[id].effectDescRaw) addPathKeep('bonds', id, ['effectDescRaw'], effectEn, bondRows[id].effectDescRaw);
    if (bondRows[id].effectDesc) addPath('bonds', id, ['effectDesc'], plain, bondRows[id].effectDesc);
    const eid = bondRows[id].effectId;
    const eff = eid ? effectRows[eid] : null;
    if (eff) {
      if (eff.descRaw) addPathKeep('effects', eid, ['descRaw'], effectEn, eff.descRaw);
      if (eff.desc) addPath('effects', eid, ['desc'], plain, eff.desc);
    }
  }
}

// Garrisons — JSON maps in the full module (last duplicate id = act3)
const garMap = parseGarrisonMap(src);
let garHits = 0;
for (const [id, en] of garMap) {
  const rec = garRows[id];
  if (!rec) continue;
  garHits++;
  if (rec.desc) addPath('garrisons', id, ['desc'], en.d, rec.desc);
  if (rec.descRaw) addPath('garrisons', id, ['descRaw'], en.d, rec.descRaw);
  if (rec.eventTypeDesc && en.t) addPath('garrisons', id, ['eventTypeDesc'], en.t, rec.eventTypeDesc);
}

// Chess (act3 block only)
let chessHits = 0;
let nameFromApp = 0;
for (const obj of extractObjects(block, 'chess_char_')) {
  const id = field(obj, 'id');
  if (!id || !chessRows[id]) continue;
  chessHits++;
  const rec = chessRows[id];
  let n = chessName(obj);
  if (!n) {
    n = nameFallback(rec);
    if (n) nameFromApp++;
  }
  if (n) addPath('chess', id, ['name'], n, rec.name);

  const skillObjs = [...obj.matchAll(/\{n:`([^`]*)`,i:(\d+),ic:`([^`]*)`,d:`([^`]*)`,lv:(\d+)(?:,dG:`([^`]*)`,lvG:(\d+))?(,df:1)?\}/g)];
  let chosen = skillObjs.find((s) => s[8]) || skillObjs.find((s) => s[6]) || skillObjs[0];
  if (rec.skill?.name) {
    const byName = skillObjs.find((s) => s[1] === rec.skill.name) || skillObjs.find((s) => unmd(s[1]) === rec.skill.name);
    if (byName) chosen = byName;
  }
  if (chosen && rec.skill) {
    addPath('chess', id, ['skill', 'name'], chosen[1], rec.skill.name);
    addPath('chess', id, ['skill', 'descRaw'], chosen[4], rec.skill.descRaw);
    if (rec.skill.desc) addPath('chess', id, ['skill', 'desc'], chosen[4], rec.skill.desc);
  }
  if (Array.isArray(rec.skills) && skillObjs.length) {
    for (let i = 0; i < Math.min(rec.skills.length, skillObjs.length); i++) {
      const s = rec.skills[i], sk = skillObjs[i];
      if (!s || !sk) continue;
      if (s.name) addPath('chess', id, ['skills', i, 'name'], sk[1], s.name);
      if (s.descRaw) addPath('chess', id, ['skills', i, 'descRaw'], sk[4], s.descRaw);
      if (s.desc) addPath('chess', id, ['skills', i, 'desc'], sk[4], s.desc);
    }
  }
  if (rec.goldenId && chessRows[rec.goldenId]) {
    const g = chessRows[rec.goldenId];
    if (n) addPath('chess', rec.goldenId, ['name'], n, g.name);
    if (chosen?.[6]) {
      if (g.skill?.descRaw) addPath('chess', rec.goldenId, ['skill', 'descRaw'], chosen[6], g.skill.descRaw);
      if (g.skill?.desc) addPath('chess', rec.goldenId, ['skill', 'desc'], chosen[6], g.skill.desc);
      if (g.skill?.name) addPath('chess', rec.goldenId, ['skill', 'name'], chosen[1], g.skill.name);
    }
  }
  const trait = (obj.match(/trait:`([^`]*)`/) || [])[1];
  if (trait && rec.trait) {
    if (typeof rec.trait === 'string') addPath('chess', id, ['trait'], trait, rec.trait);
    if (rec.trait.descRaw) addPath('chess', id, ['trait', 'descRaw'], trait, rec.trait.descRaw);
    if (rec.trait.desc) addPath('chess', id, ['trait', 'desc'], trait, rec.trait.desc);
  }
}

// Items (act3)
for (const obj of extractObjects(block, 'chess_item_')) {
  const id = field(obj, 'id');
  if (!id || !itemRows[id]) continue;
  const n = field(obj, 'n'), d = field(obj, 'd');
  if (n) addPath('items', id, ['name'], n, itemRows[id].name);
  if (d && itemRows[id].descRaw) addPath('items', id, ['descRaw'], d, itemRows[id].descRaw);
  if (d && itemRows[id].desc) addPath('items', id, ['desc'], d, itemRows[id].desc);
}

// Strategies / Commands (bands): Terra `by` = operator name, `n` = effect name, `d` = body
let bandHits = 0;
let bandSkillHits = 0;
for (const obj of extractObjects(block, 'band_')) {
  const id = field(obj, 'id');
  if (!id || !bandRows[id]) continue;
  bandHits++;
  const rec = bandRows[id];
  const by = field(obj, 'by');
  const effect = field(obj, 'n');
  const body = field(obj, 'd');
  if (by) addPath('bands', id, ['name'], by, rec.name);
  if (effect) addPath('bands', id, ['effectName'], effect, rec.effectName);
  if (body) {
    const plain = normalizeBandBodyEn(body);
    const full = effect ? `【${unmd(effect)}】\n${plain}` : plain;
    if (rec.desc) addPath('bands', id, ['desc'], full, rec.desc);
    if (rec.descRaw) addPath('bands', id, ['descRaw'], full, rec.descRaw);
  }
  const unlock = field(obj, 'un');
  if (unlock && rec.unlockDesc) addPath('bands', id, ['unlockDesc'], unlock, rec.unlockDesc);
  // Command replace draft / HUD use skills[].descRaw (and effects[effectId]), not the band card text
  if (Array.isArray(rec.skills) && (effect || body)) {
    for (let i = 0; i < rec.skills.length; i++) {
      const sk = rec.skills[i];
      if (!sk) continue;
      const enSkill = skillDescEn(effect, body, sk.desc || sk.descRaw);
      if (!enSkill) continue;
      bandSkillHits++;
      if (sk.desc) addPath('bands', id, ['skills', i, 'desc'], enSkill, sk.desc);
      if (sk.descRaw) addPath('bands', id, ['skills', i, 'descRaw'], enSkill, sk.descRaw);
      const eff = sk.effectId ? effectRows[sk.effectId] : null;
      if (eff) {
        if (effect && eff.name) addPath('effects', sk.effectId, ['name'], effect, eff.name);
        if (eff.desc) addPath('effects', sk.effectId, ['desc'], enSkill, eff.desc);
        if (eff.descRaw) addPath('effects', sk.effectId, ['descRaw'], enSkill, eff.descRaw);
      }
    }
  }
}

const meta = {
  source: SRC,
  generated: new Date().toISOString().slice(0, 10),
  entries: Object.keys(dict).length,
  paths: paths.length,
  chessHits,
  nameFromAppellation: nameFromApp,
  garrisonHits: garHits,
  bandHits,
  bandSkillHits,
  bondEffectHits,
};
dict._meta = meta;
writeFileSync(DICT_OUT, `${JSON.stringify(dict, null, 2)}\n`);
writeFileSync(PATHS_OUT, `${JSON.stringify({ _meta: meta, leaves: paths }, null, 2)}\n`);
console.log('wrote', DICT_OUT, PATHS_OUT, meta);
