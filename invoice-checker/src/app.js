import { parseInvoice, evaluate, lastThreeHint, summarize, periodLabel, latestExpectedPeriod, isExpired } from './engine.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const money = n => '$' + n.toLocaleString('en-US');
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const KEY = 'invoice-checker:v1';

const store = {
  read() { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v?.records) ? v : { records: [], opts: {} }; } catch { return { records: [], opts: {} }; } },
  write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 儲存被封鎖時仍可使用，僅不保留 */ } },
};
const state = { draws: [], code: null, ...store.read() };
const save = () => store.write({ records: state.records, opts: state.opts });
const draw = () => state.draws.find(d => d.periodCode === state.code);

async function init() {
  try {
    const res = await fetch('data/draws.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    state.draws = (await res.json()).draws;
  } catch {
    $('notes').replaceChildren(el('p', { className: 'note warn', textContent: '無法載入號碼資料。請透過本機伺服器或 GitHub Pages 開啟（直接開啟檔案無法讀取）。' }));
    return;
  }
  state.code = state.draws[0]?.periodCode;
  $('optNet').checked = !!state.opts.net; $('optWaive').checked = !!state.opts.waive;
  render();
}

function render() {
  const d = draw();
  $('tabs').replaceChildren(...state.draws.map(x => el('button', {
    className: 'tab', textContent: periodLabel(x.periodCode), type: 'button',
    onclick: () => { state.code = x.periodCode; $('inv').value = ''; render(); },
  })).map((b, i) => (b.setAttribute('aria-pressed', state.draws[i].periodCode === state.code), b)));

  const notes = [];
  const expected = latestExpectedPeriod(today);
  if (state.draws[0].periodCode < expected) notes.push(['warn', `資料可能落後：${periodLabel(expected)}已開獎或即將開獎，目前最新僅到${periodLabel(state.draws[0].periodCode)}。`]);
  if (isExpired(d, today)) notes.push(['warn', `本期已逾領獎期限（${d.claimEnd}），僅供查閱。`]);
  if (d.source?.kind === 'seed-manual') notes.push(['', '本期為人工建立的初始資料，尚未由排程對照官方頁面驗證。']);
  $('notes').replaceChildren(...notes.map(([c, t]) => el('p', { className: 'note ' + c, textContent: t })));

  const line = (name, val, sub = '') => el('div', { className: 'prize' }, el('span', { textContent: name }), el('b', { textContent: val }), el('span', { textContent: sub }));
  $('numbers').replaceChildren(
    line('特別獎', d.special, '1,000萬'), line('特獎', d.grand, '200萬'),
    ...d.first.map((f, i) => line(i ? '' : '頭獎', f, i ? '' : '20萬')),
    ...(d.additionalSixth?.length ? [line('增開六獎', d.additionalSixth.join('、'), '200元')] : []));
  $('claim').textContent = `領獎期間：${d.claimStart} 至 ${d.claimEnd}`;

  const mine = state.records.filter(r => r.period === d.periodCode);
  const s = summarize(mine, d, { waiveStamp: !!state.opts.waive });
  $('ledger').replaceChildren(...(s.rows.length ? s.rows.map(r => el('li', { className: r.hit ? 'win' : '' },
    el('span', { className: 'no', textContent: (r.serial ? r.serial + '-' : '') + r.number }),
    el('span', { className: 'res', textContent: r.hit ? `${r.hit.label} ${money(r.hit.amount)}` : '未中獎' }),
    el('button', { type: 'button', textContent: '刪除', ariaLabel: '刪除 ' + r.number, onclick: () => { state.records = state.records.filter(x => x.id !== r.id); save(); render(); } }),
  )) : [el('li', { className: 'empty', textContent: '尚未輸入發票。輸入 8 碼後按 Enter。' })]));
  $('gross').textContent = money(s.gross);
  $('stats').textContent = `已對 ${s.count} 張，中獎 ${s.wins} 張`;
  $('net').hidden = !state.opts.net; $('waiveRow').hidden = !state.opts.net;
  $('net').textContent = `稅後預估約 ${money(s.net)}（估算，實際以發獎單位扣繳為準）`;
  $('foot').replaceChildren(
    `號碼來源：財政部稅務入口網。本工具僅供參考，以財政部公告為準。`, el('br'),
    `僅對紙本實體發票；雲端發票專屬獎請至財政部電子發票整合服務平台或兌獎 APP 查詢。`, el('br'),
    d.source?.fetchedAt ? `資料抓取時間：${d.source.fetchedAt}` : '');
  updateHint();
}

function updateHint() {
  const { number } = parseInvoice($('inv').value), d = draw();
  const h = $('hint'); $('add').disabled = number.length !== 8;
  if (number.length === 3) {
    const t = lastThreeHint(number, d);
    h.textContent = t === 'sixth' ? '末 3 碼已符合頭獎末 3 碼，至少中六獎 200 元；輸入完整 8 碼確認是否更高。'
      : t === 'check' ? '末 3 碼與特別獎或特獎相同，請輸入完整 8 碼確認。' : '末 3 碼未符合任何獎項；仍請輸入完整 8 碼記錄。';
  } else if (number.length === 8) {
    const hit = evaluate(number, d); h.textContent = hit ? `${hit.label}：${money(hit.amount)}` : '未中獎';
  } else h.textContent = number.length ? `已輸入 ${number.length} 碼` : '';
}

function add() {
  const { serial, number } = parseInvoice($('inv').value);
  if (number.length !== 8) return;
  if (state.records.some(r => r.period === state.code && r.number === number && r.serial === serial)) {
    $('hint').textContent = '這張發票本期已記錄過。'; return;
  }
  state.records.unshift({ id: Date.now() + Math.random(), period: state.code, serial, number });
  save(); $('inv').value = ''; render(); $('inv').focus();
}

$('inv').addEventListener('input', updateHint);
$('inv').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
$('add').addEventListener('click', add);
$('optNet').addEventListener('change', e => { state.opts.net = e.target.checked; save(); render(); });
$('optWaive').addEventListener('change', e => { state.opts.waive = e.target.checked; save(); render(); });
$('clear').addEventListener('click', () => {
  if (confirm(`確定清除 ${periodLabel(state.code)} 的所有紀錄？`)) { state.records = state.records.filter(r => r.period !== state.code); save(); render(); }
});
init();
