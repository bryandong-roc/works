// 對獎引擎：純函式，不依賴 DOM 或網路。
export const SPECIAL = 10_000_000;
export const GRAND = 2_000_000;
// [比對末幾碼, 獎別, 金額]；由高到低排列
export const TIERS = [
  [8, '頭獎', 200000], [7, '二獎', 40000], [6, '三獎', 10000],
  [5, '四獎', 4000], [4, '五獎', 1000], [3, '六獎', 200],
];

/** 全形轉半形，分離字軌（2 碼英文）與數字。 */
export function parseInvoice(input) {
  const s = String(input ?? '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const serial = (s.match(/[A-Za-z]{2}/) || [''])[0].toUpperCase();
  return { serial, number: s.replace(/\D/g, '') };
}

/** 回傳該張發票的最高獎 {label, amount}，未中獎回傳 null。 */
export function evaluate(number, draw) {
  if (!/^\d{8}$/.test(number)) return null;
  const hits = [];
  if (number === draw.special) hits.push({ label: '特別獎', amount: SPECIAL });
  if (number === draw.grand) hits.push({ label: '特獎', amount: GRAND });
  for (const first of draw.first) {
    for (const [n, label, amount] of TIERS) {
      if (number.slice(-n) === first.slice(-n)) { hits.push({ label, amount }); break; }
    }
  }
  for (const t of draw.additionalSixth ?? []) {
    if (number.slice(-3) === t) hits.push({ label: '增開六獎', amount: 200 });
  }
  return hits.sort((a, b) => b.amount - a.amount)[0] ?? null;
}

/** 末 3 碼初篩：'sixth' 表示已確定至少中六獎；'check' 表示僅特別獎/特獎末3碼相符，須輸入 8 碼。 */
export function lastThreeHint(three, draw) {
  if (!/^\d{3}$/.test(three)) return 'invalid';
  if (draw.first.some(f => f.slice(-3) === three) || (draw.additionalSixth ?? []).includes(three)) return 'sixth';
  if (draw.special.slice(-3) === three || draw.grand.slice(-3) === three) return 'check';
  return 'none';
}

/** 稅後預估：中三獎(含)以上扣 20%；中五獎(含)以上 0.4% 印花稅（已設定領獎帳戶者免繳）。僅供參考。 */
export function netAmount(amount, { waiveStamp = false } = {}) {
  const tax = amount >= 10000 ? amount * 0.2 : 0;
  const stamp = !waiveStamp && amount >= 1000 ? amount * 0.004 : 0;
  return Math.round(amount - tax - stamp);
}

/** 當期累計：每次都由「號碼＋期別」重算，不依賴儲存時的結果。 */
export function summarize(records, draw, opts = {}) {
  let gross = 0, net = 0, wins = 0;
  const rows = records.map(r => {
    const hit = evaluate(r.number, draw);
    if (hit) { wins++; gross += hit.amount; net += netAmount(hit.amount, opts); }
    return { ...r, hit };
  });
  return { rows, count: rows.length, wins, gross, net };
}

// ---- 期別工具：期別代碼如 11507＝民國115年7-8月 ----
const iso = d => d.toISOString().slice(0, 10);
const mm = n => String(n).padStart(2, '0');
export const periodLabel = code => `${+String(code).slice(0, 3)}年${mm(+String(code).slice(3))}-${mm(+String(code).slice(3) + 1)}月`;
export function claimWindow(code) {
  const y = +String(code).slice(0, 3) + 1911, m = +String(code).slice(3);
  return { start: iso(new Date(Date.UTC(y, m + 2, 6))), end: iso(new Date(Date.UTC(y, m + 5, 5))) };
}
/** 名義開獎日（開獎月 25 日）；實際遇假日是否順延未查證，僅用於判斷資料是否落後。 */
export function nominalDrawDate(code) {
  const y = +String(code).slice(0, 3) + 1911, m = +String(code).slice(3);
  return iso(new Date(Date.UTC(y, m + 1, 25)));
}
export function previousPeriod(code) {
  const y = +String(code).slice(0, 3), m = +String(code).slice(3);
  return m <= 1 ? `${y - 1}11` : `${y}${mm(m - 2)}`;
}
export function latestExpectedPeriod(todayISO) {
  const y = +todayISO.slice(0, 4) - 1911;
  for (const yy of [y, y - 1]) {
    for (const m of ['11', '09', '07', '05', '03', '01']) {
      const code = `${yy}${m}`;
      if (nominalDrawDate(code) <= todayISO) return code;
    }
  }
}
export const isExpired = (draw, todayISO) => todayISO > draw.claimEnd;
