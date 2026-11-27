// 解析財政部稅務入口網「統一發票中獎號碼」頁面（ETW183W2_期別代碼）。
// 以純文字比對；頁面版型改變時會驗證失敗，而不是寫入錯誤資料。
import { claimWindow } from './engine.js';

const roc = (y, m, d) => `${+y + 1911}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function parseDrawHtml(html) {
  const lines = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ').split('\n').map(s => s.trim()).filter(Boolean);
  const text = lines.join(' ');
  const collect = (label, re) => {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === label && re.test(lines[i + 1] ?? '')) {
        const out = [];
        for (let j = i + 1; j < lines.length && re.test(lines[j]); j++) out.push(lines[j]);
        return out;
      }
    }
    return [];
  };
  const head = text.match(/(\d{3})\s*年\s*(\d{1,2})\s*~\s*(\d{1,2})\s*月/);
  const claim = text.match(/領獎期間自\s*(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*起\s*至\s*(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*止/);
  return {
    headCode: head ? `${head[1]}${String(head[2]).padStart(2, '0')}` : null,
    headEnd: head ? +head[3] : null,
    special: collect('特別獎', /^\d{8}$/)[0] ?? null,
    grand: collect('特獎', /^\d{8}$/)[0] ?? null,
    first: collect('頭獎', /^\d{8}$/),
    additionalSixth: collect('增開六獎', /^\d{3}$/),
    claimStart: claim ? roc(claim[1], claim[2], claim[3]) : null,
    claimEnd: claim ? roc(claim[4], claim[5], claim[6]) : null,
  };
}

/** 驗證失敗即丟出錯誤；通過則回傳可寫入 draws.json 的物件。 */
export function validateDraw(p, code) {
  const err = m => { throw new Error(`期別 ${code} 驗證失敗：${m}`); };
  if (p.headCode !== code || p.headEnd !== +String(code).slice(3) + 1) err('頁面期別與預期不符');
  if (!/^\d{8}$/.test(p.special ?? '')) err('特別獎格式不符');
  if (!/^\d{8}$/.test(p.grand ?? '')) err('特獎格式不符');
  if (p.first.length !== 3) err(`頭獎應為 3 組，實得 ${p.first.length} 組`);
  const w = claimWindow(code);
  if (p.claimStart !== w.start || p.claimEnd !== w.end) err(`領獎期間 ${p.claimStart}~${p.claimEnd} 與計算值 ${w.start}~${w.end} 不符`);
  return {
    periodCode: code, claimStart: p.claimStart, claimEnd: p.claimEnd,
    special: p.special, grand: p.grand, first: p.first, additionalSixth: p.additionalSixth,
  };
}
