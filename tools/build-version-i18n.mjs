#!/usr/bin/env node
// tools/build-version-i18n.mjs — build data/versions/<slug>/i18n/<lang>.json from a version's Chinese tables,
// reusing shared data/i18n/<lang>.json where the Chinese leaf text matches, then a flat dictionary
// (tools/i18n/terra-act3-en.json). Format: shared/i18nData.js. Used for act3autochess@V3_1 English (M3).

import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecordOverlay, OVERLAY_VERSION } from '../shared/i18nData.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Player-facing tables under a version dir (same family as tools/build-i18n.mjs DATA_FILES). */
export const VERSION_TEXT_FILES = Object.freeze([
  'chess', 'backups', 'tokens', 'bonds', 'garrisons', 'items', 'bands', 'effects',
  'choices', 'enemies', 'factions', 'stages', 'bosses', 'config',
]);

const NAME_KEYS = new Set(['name', 'nameCn', 'label', 'title', 'appellation']);

/**
 * Walk string leaves of a record.
 * @param {any} node
 * @param {(string|number)[]} path
 * @param {(path: (string|number)[], text: string, key: string) => void} visit
 */
function walkStrings(node, path, visit) {
  if (typeof node === 'string') {
    visit(path, node, path.length ? String(path[path.length - 1]) : '');
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) walkStrings(node[i], [...path, i], visit);
    return;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) walkStrings(node[k], [...path, k], visit);
  }
}

/**
 * Build zh → en from a shared overlay + the Chinese data files it was built against.
 * @param {any} baseEn data/i18n/en.json
 * @param {Record<string, any>} baseData data/*.json (default season)
 */
export function reuseMapFromBase(baseEn, baseData) {
  /** @type {Record<string, string>} */
  const map = Object.create(null);
  if (baseEn?.names && typeof baseEn.names === 'object') {
    for (const [zh, en] of Object.entries(baseEn.names)) {
      if (typeof zh === 'string' && typeof en === 'string' && en && en !== zh) map[zh] = en;
    }
  }
  const files = baseEn?.files;
  if (!files || typeof files !== 'object') return map;
  for (const [file, fov] of Object.entries(files)) {
    const json = baseData[file];
    if (!json || typeof json !== 'object') continue;
    for (const [id, rov] of Object.entries(fov || {})) {
      const rec = json[id];
      if (rec == null || rov == null) continue;
      const zhLeaves = [];
      walkStrings(typeof rec === 'string' ? rec : rec, typeof rec === 'string' ? [] : [], (path, zh) => zhLeaves.push({ path, zh }));
      const enLeaves = [];
      walkStrings(rov, [], (path, en) => {
        if (path.length === 1 && path[0] === '_h') return;
        if (path.length === 1 && path[0] === '_s') enLeaves.push({ path: [], en });
        else if (path[0] !== '_h') enLeaves.push({ path, en });
      });
      // pair by path key
      const enBy = new Map(enLeaves.map((l) => [l.path.map(String).join('\0'), l.en]));
      for (const { path, zh } of zhLeaves) {
        const en = enBy.get(path.map(String).join('\0'));
        if (typeof en === 'string' && en && en !== zh) map[zh] = map[zh] || en;
      }
    }
  }
  return map;
}

/**
 * @param {{ data: Record<string, any>, reuseMap?: Record<string, string>, dict?: Record<string, string>,
 *   pathLeaves?: { file: string, id: string, path: (string|number)[], en: string }[], lang?: string, meta?: object }} input
 */
export function buildVersionOverlay({ data, reuseMap = {}, dict = {}, pathLeaves = [], lang = 'en', meta = null }) {
  const translate = (zh) => {
    if (typeof zh !== 'string' || !zh) return null;
    const en = reuseMap[zh] || dict[zh];
    if (typeof en !== 'string' || !en || en === zh) return null;
    return en;
  };
  /** file → id → pathKey → en */
  const byPath = new Map();
  for (const leaf of pathLeaves) {
    if (!leaf?.file || leaf.id == null || !Array.isArray(leaf.path) || typeof leaf.en !== 'string') continue;
    if (!byPath.has(leaf.file)) byPath.set(leaf.file, new Map());
    const ids = byPath.get(leaf.file);
    if (!ids.has(leaf.id)) ids.set(leaf.id, new Map());
    ids.get(leaf.id).set(leaf.path.map(String).join('\0'), leaf.en);
  }
  const files = {};
  const nameVotes = new Map();
  let texts = 0, translated = 0, fromReuse = 0, fromDict = 0, fromPaths = 0;
  for (const file of VERSION_TEXT_FILES) {
    const json = data[file];
    if (!json || typeof json !== 'object' || Array.isArray(json)) continue;
    const out = {};
    for (const [id, record] of Object.entries(json)) {
      if (record == null || (typeof record !== 'object' && typeof record !== 'string')) continue;
      /** @type {{ path: (string|number)[], zh: string, en: string }[]} */
      const leaves = [];
      const pathMap = byPath.get(file)?.get(id);
      walkStrings(typeof record === 'string' ? record : record, typeof record === 'string' ? [] : [], (path, zh, key) => {
        texts++;
        const pathEn = pathMap?.get(path.map(String).join('\0'));
        const en = (typeof pathEn === 'string' && pathEn && pathEn !== zh ? pathEn : null) || translate(zh);
        if (!en) return;
        translated++;
        if (pathEn && pathEn === en) fromPaths++;
        else if (reuseMap[zh]) fromReuse++;
        else fromDict++;
        leaves.push({ path, zh, en });
        const top = path.length === 1 || (path.length === 0);
        if (top && NAME_KEYS.has(key || 'name')) {
          const list = nameVotes.get(zh) || [];
          list.push(en);
          nameVotes.set(zh, list);
        }
      });
      const ov = buildRecordOverlay(leaves);
      if (ov) out[id] = ov;
    }
    if (Object.keys(out).length) files[file] = out;
  }
  const names = {};
  for (const zh of [...nameVotes.keys()].sort()) names[zh] = nameVotes.get(zh)[0];
  // also promote dict/reuse name-looking entries already in reuseMap that appear as record names
  for (const [zh, en] of Object.entries({ ...dict, ...reuseMap })) {
    if (names[zh] || !en || en === zh) continue;
    if ([...zh].some((ch) => ch >= '\u4e00' && ch <= '\u9fff')) names[zh] = en;
  }
  const overlay = {
    version: OVERLAY_VERSION,
    lang,
    meta: {
      generator: 'tools/build-version-i18n.mjs',
      ...(meta || {}),
      totals: { texts, translated, fromReuse, fromDict, fromPaths, pct: texts ? Math.round((translated / texts) * 1000) / 10 : 100 },
    },
    names,
    files,
  };
  return { overlay, report: { totals: overlay.meta.totals, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Object.keys(v).length])) } };
}

function parseArgs(argv) {
  const opts = {
    data: join(ROOT, 'data/versions/act3autochess-v3_1'),
    baseEn: join(ROOT, 'data/i18n/en.json'),
    baseData: join(ROOT, 'data'),
    dict: join(ROOT, 'tools/i18n/terra-act3-en.json'),
    paths: join(ROOT, 'tools/i18n/terra-act3-en-paths.json'),
    out: join(ROOT, 'data/versions/act3autochess-v3_1/i18n/en.json'),
    report: join(ROOT, '.cache/build-version-i18n-act3-en-report.json'),
    lang: 'en',
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v == null) throw new Error(`missing value for ${a}`); return v; };
    if (a === '--data') opts.data = resolve(next());
    else if (a === '--base-en') opts.baseEn = resolve(next());
    else if (a === '--base-data') opts.baseData = resolve(next());
    else if (a === '--dict') opts.dict = resolve(next());
    else if (a === '--paths') opts.paths = resolve(next());
    else if (a === '--out') opts.out = resolve(next());
    else if (a === '--report') opts.report = resolve(next());
    else if (a === '--lang') opts.lang = next();
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: node tools/build-version-i18n.mjs [--data dir] [--base-en file] [--base-data dir] [--dict file] [--paths file] [--out file] [--report file] [--lang en] [--quiet]');
      process.exit(0);
    } else throw new Error(`unknown arg ${a}`);
  }
  return opts;
}

async function loadJson(p, fallback = null) {
  if (!existsSync(p)) return fallback;
  return JSON.parse(await readFile(p, 'utf8'));
}

async function loadDataDir(dir) {
  /** @type {Record<string, any>} */
  const data = {};
  for (const file of VERSION_TEXT_FILES) {
    const p = join(dir, `${file}.json`);
    if (!existsSync(p)) continue;
    data[file] = JSON.parse(await readFile(p, 'utf8'));
  }
  return data;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const log = (...a) => { if (!opts.quiet) console.log(...a); };
  const data = await loadDataDir(opts.data);
  const baseEn = await loadJson(opts.baseEn, { names: {}, files: {} });
  const baseData = await loadDataDir(opts.baseData);
  const dictRaw = await loadJson(opts.dict, {});
  const dict = Object.fromEntries(Object.entries(dictRaw || {}).filter(([k]) => !k.startsWith('_') && typeof dictRaw[k] === 'string'));
  const pathsDoc = await loadJson(opts.paths, { leaves: [] });
  const pathLeaves = Array.isArray(pathsDoc?.leaves) ? pathsDoc.leaves : [];
  const reuseMap = reuseMapFromBase(baseEn, baseData);
  log(`build-version-i18n: ${opts.lang} · data ${relative(ROOT, opts.data)} · reuse ${Object.keys(reuseMap).length} · dict ${Object.keys(dict).length} · paths ${pathLeaves.length}`);
  const { overlay, report } = buildVersionOverlay({
    data, reuseMap, dict, pathLeaves, lang: opts.lang,
    meta: {
      source: {
        dict: relative(ROOT, opts.dict).replace(/\\/g, '/'),
        paths: relative(ROOT, opts.paths).replace(/\\/g, '/'),
        baseEn: relative(ROOT, opts.baseEn).replace(/\\/g, '/'),
      },
    },
  });
  const text = `${JSON.stringify(overlay)}\n`;
  await mkdir(dirname(opts.out), { recursive: true });
  const tmp = `${opts.out}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, opts.out);
  await mkdir(dirname(opts.report), { recursive: true });
  await writeFile(opts.report, `${JSON.stringify({ ...report, out: relative(ROOT, opts.out).replace(/\\/g, '/'), bytes: Buffer.byteLength(text) }, null, 2)}\n`);
  log(`  ${report.totals.translated} / ${report.totals.texts} (${report.totals.pct} %) · reuse ${report.totals.fromReuse} · dict ${report.totals.fromDict}`);
  log(`  wrote ${relative(ROOT, opts.out)}`);
  return { overlay, report };
}

const isMain = (() => {
  try { return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || ''); } catch { return false; }
})();
if (isMain) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
