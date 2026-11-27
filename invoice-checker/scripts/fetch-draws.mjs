// 用法：node scripts/fetch-draws.mjs   （Node 18+）
// 從財政部稅務入口網抓取近數期號碼，驗證通過才合併寫入 data/draws.json。
import { readFile, writeFile } from 'node:fs/promises';
import { latestExpectedPeriod, previousPeriod, nominalDrawDate } from '../src/engine.js';
import { parseDrawHtml, validateDraw } from '../src/parse.js';

const FILE = new URL('../data/draws.json', import.meta.url);
const BASE = 'https://www.etax.nat.gov.tw/etw-main/ETW183W2_';
const KEEP = 8, FETCH_N = 4;
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // 台北日期
const core = d => JSON.stringify({ ...d, source: undefined });

let db = { schemaVersion: 1, generatedAt: null, draws: [] };
try { db = JSON.parse(await readFile(FILE, 'utf8')); } catch { /* 首次執行 */ }
const byCode = new Map(db.draws.map(d => [d.periodCode, d]));

const expected = latestExpectedPeriod(today);
let code = expected, changed = false;
for (let i = 0; i < FETCH_N; i++, code = previousPeriod(code)) {
  const url = `${BASE}${code}/`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'invoice-checker/1.0 (personal project)' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const draw = validateDraw(parseDrawHtml(await res.text()), code);
    const old = byCode.get(code);
    if (!old || core(old) !== core(draw)) {
      byCode.set(code, { ...draw, source: { kind: 'official-page', url, fetchedAt: new Date().toISOString() } });
      changed = true;
      console.log(`${old ? '更新' : '新增'} ${code}`);
    }
  } catch (e) { console.warn(`略過 ${code}：${e.message}`); }
  await new Promise(r => setTimeout(r, 500));
}

if (changed) {
  const draws = [...byCode.values()].sort((a, b) => b.periodCode.localeCompare(a.periodCode)).slice(0, KEEP);
  await writeFile(FILE, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), draws }, null, 2) + '\n');
}
// 開獎超過 2 天仍取不到最新一期：以失敗狀態提醒（Actions 會寄出通知）
const lag = (Date.parse(today) - Date.parse(nominalDrawDate(expected))) / 864e5;
if (!byCode.has(expected) && lag >= 2) { console.error(`最新期別 ${expected} 仍未取得`); process.exit(1); }
