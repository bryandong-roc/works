import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parseInvoice, lastThreeHint, summarize, netAmount, claimWindow, latestExpectedPeriod, previousPeriod, periodLabel, isExpired } from '../src/engine.js';
import { parseDrawHtml, validateDraw } from '../src/parse.js';

const D = { special: '38548029', grand: '10138845', first: ['24121106', '28589937', '83663333'], additionalSixth: [] };

test('特別獎、特獎、頭獎', () => {
  assert.equal(evaluate('38548029', D).amount, 10_000_000);
  assert.equal(evaluate('10138845', D).amount, 2_000_000);
  assert.equal(evaluate('28589937', D).label, '頭獎');
});
test('二至六獎（末7至3碼）', () => {
  assert.equal(evaluate('18589937', D).label, '二獎');
  assert.equal(evaluate('00589937', D).label, '三獎');
  assert.equal(evaluate('00089937', D).label, '四獎');
  assert.equal(evaluate('00009937', D).label, '五獎');
  assert.equal(evaluate('00000937', D).label, '六獎');
});
test('跨組取最高獎（舊版 bug）', () => {
  // 12345678 與第一組僅末3碼相同（六獎），與第二組末6碼相同（三獎）：應取三獎
  const d = { ...D, first: ['00000678', '99345678', '83663333'] };
  const hit = evaluate('12345678', d);
  assert.equal(hit.label, '三獎');
  assert.equal(hit.amount, 10000);
});
test('末3碼相符頭獎即六獎；未中回傳 null', () => {
  assert.equal(evaluate('99999106', D).amount, 200);
  assert.equal(evaluate('99999999', D), null);
  assert.equal(evaluate('123', D), null);
});
test('增開六獎（歷史期別）', () => {
  assert.equal(evaluate('99999420', { ...D, additionalSixth: ['420'] }).label, '增開六獎');
});
test('輸入正規化：全形與字軌', () => {
  assert.deepEqual(parseInvoice('ab-１２３４５６７８'), { serial: 'AB', number: '12345678' });
  assert.deepEqual(parseInvoice('12345678'), { serial: '', number: '12345678' });
});
test('末3碼初篩語意', () => {
  assert.equal(lastThreeHint('106', D), 'sixth');
  assert.equal(lastThreeHint('029', D), 'check');
  assert.equal(lastThreeHint('000', D), 'none');
});
test('當期累計與稅後預估', () => {
  const s = summarize([{ number: '38548029' }, { number: '99999106' }, { number: '99999999' }], D);
  assert.equal(s.count, 3); assert.equal(s.wins, 2); assert.equal(s.gross, 10_000_200);
  assert.equal(netAmount(200), 200);
  assert.equal(netAmount(1000), 996);
  assert.equal(netAmount(1000, { waiveStamp: true }), 1000);
  assert.equal(netAmount(10000, { waiveStamp: true }), 8000);
});
test('領獎期間與期別推算（已對照官方）', () => {
  assert.deepEqual(claimWindow('11505'), { start: '2026-08-06', end: '2026-11-05' });
  assert.deepEqual(claimWindow('11507'), { start: '2026-10-06', end: '2027-01-05' });
  assert.deepEqual(claimWindow('11509'), { start: '2026-12-06', end: '2027-03-05' });
  assert.equal(latestExpectedPeriod('2026-11-25'), '11509');
  assert.equal(latestExpectedPeriod('2026-11-24'), '11507');
  assert.equal(latestExpectedPeriod('2027-01-10'), '11509');
  assert.equal(previousPeriod('11501'), '11411');
  assert.equal(periodLabel('11507'), '115年07-08月');
  assert.equal(isExpired({ claimEnd: '2026-11-05' }, '2026-11-25'), true);
});

// 以官方號碼單的文字結構建立的測試資料（非即時抓取的原始 HTML，首次部署請實測）
const page = (extra = '', claim = '領獎期間自115年8月6日起至115年11月5日止') => `
<div>統一發票中獎號碼</div><div>年月份</div><div>115年 05 ~ 06 月</div>
<th>特別獎</th><td>38548029</td><td>同期統一發票收執聯8位數號碼與特別獎號碼相同者獎金1,000萬元</td>
<th>特獎</th><td>10138845</td>
<th>頭獎</th><td>24121106</td><td>28589937</td><td>83663333</td><td>同期…</td>
<th>六獎</th>${extra}<p>${claim}，中獎人請…</p><script>var x='特獎';</script>`;
test('解析官方頁面文字', () => {
  const d = validateDraw(parseDrawHtml(page()), '11505');
  assert.equal(d.special, '38548029'); assert.equal(d.grand, '10138845');
  assert.deepEqual(d.first, ['24121106', '28589937', '83663333']);
  assert.equal(d.claimEnd, '2026-11-05'); assert.deepEqual(d.additionalSixth, []);
});
test('解析增開六獎', () => {
  const d = validateDraw(parseDrawHtml(page('<th>增開六獎</th><td>420</td><td>523</td><td>554</td>')), '11505');
  assert.deepEqual(d.additionalSixth, ['420', '523', '554']);
});
test('驗證失敗即拒絕', () => {
  assert.throws(() => validateDraw(parseDrawHtml(page()), '11507'), /期別/);
  assert.throws(() => validateDraw(parseDrawHtml(page('', '領獎期間自115年8月6日起至115年12月5日止')), '11505'), /領獎期間/);
  assert.throws(() => validateDraw(parseDrawHtml(page().replace('83663333', 'x')), '11505'), /頭獎/);
});
