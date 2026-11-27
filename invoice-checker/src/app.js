import { parseInvoice, evaluate, lastThreeHint, evaluateRecord, summarize, periodLabel, latestExpectedPeriod, isExpired } from './engine.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const money = n => '$' + n.toLocaleString('en-US');
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const KEY = 'invoice-checker:v1';
const MODES = {
  r1: { tab: '第一輪：末3碼初篩', label: '輸入發票號碼（先輸入末3碼）', ph: '3 碼，按 Enter 加入兌獎', btn: '加入兌獎' },
  r2: { tab: '第二輪：完整8碼', label: '輸入發票號碼（完整8碼，確認初篩有中的發票）', ph: '8 碼，按 Enter 確認', btn: '確認8碼' },
};

const store = {
  read() { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v?.records) ? v : { records: [], opts: {} }; } catch { return { records: [], opts: {} }; } },
  write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 儲存被封鎖時仍可使用，僅不保留 */ } },
};
const state = { draws: [], code: null, mode: 'r1', last: null, ...store.read() };
const save = () => store.write({ records: state.records, opts: state.opts });
const draw = () => state.draws.find(d => d.periodCode === state.code);
const rec = id => state.records.find(r => r.id === id);
const newId = () => Date.now() + Math.random();
const setHint = t => { $('hint').textContent = t; };
const pressed = (b, on) => { b.setAttribute('aria-pressed', String(on)); return b; };

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
  render(); $('inv').focus();
}

function resultText(r) {
  if (r.state === 'pending') return r.hint === 'check' ? '末3碼同特別獎/特獎，須對8碼' : '至少六獎 $200，待對8碼';
  if (r.hit) return `${r.hit.label} ${money(r.hit.amount)}${r.hit.manual ? '（人工確認）' : ''}`;
  return '未中獎';
}

function render() {
  const d = draw();
  $('tabs').replaceChildren(...state.draws.map(x => pressed(el('button', {
    className: 'tab', type: 'button', textContent: periodLabel(x.periodCode),
    onclick: () => { state.code = x.periodCode; state.last = null; $('inv').value = ''; setHint(''); render(); $('inv').focus(); },
  }), x.periodCode === state.code)));

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

  const m = MODES[state.mode];
  $('modes').replaceChildren(...Object.entries(MODES).map(([k, v]) => pressed(el('button', {
    className: 'tab', type: 'button', textContent: v.tab,
    onclick: () => { state.mode = k; $('inv').value = ''; setHint(''); render(); $('inv').focus(); },
  }), k === state.mode)));
  $('invLabel').textContent = m.label; $('inv').placeholder = m.ph; $('add').textContent = m.btn;

  const s = summarize(state.records.filter(r => r.period === d.periodCode), d, { waiveStamp: !!state.opts.waive });
  const rank = r => r.state === 'pending' ? (r.hint === 'check' ? 0 : 1) : r.hit ? 2 : 3;
  const shown = s.rows.filter(r => r.state !== 'miss').sort((a, b) => rank(a) - rank(b) || b.min - a.min);
  $('ledger').replaceChildren(...(shown.length ? shown.map(r => {
    const acts = [];
    if (r.state === 'pending') acts.push(el('button', {
      type: 'button', className: 'mini', textContent: r.hint === 'check' ? '確認未中' : '僅六獎',
      title: r.hint === 'check' ? '已人工核對，未中特別獎/特獎' : '已人工核對，僅中六獎 200 元',
      onclick: () => { rec(r.id).manual = r.hint === 'check' ? 'none' : 'sixth'; state.last = { id: r.id, kind: 'manual' }; save(); render(); },
    }));
    acts.push(el('button', { type: 'button', className: 'mini', textContent: '刪除', onclick: () => { state.records = state.records.filter(x => x.id !== r.id); state.last = null; save(); render(); } }));
    return el('li', { className: r.state === 'pending' ? 'pending' : r.hit ? 'win' : '' },
      el('span', { className: 'no', textContent: r.number ? (r.serial ? r.serial + '-' : '') + r.number : '＊＊＊＊＊' + r.last3 }),
      el('span', { className: 'res', textContent: resultText(r) }), ...acts);
  }) : [el('li', { className: 'empty', textContent: '尚無符合的發票。第一輪輸入末 3 碼後按 Enter。' })]));

  $('listTitle').textContent = `末3碼有中的清單（${shown.length} 張）`;
  $('grossLabel').textContent = s.pending ? '中獎金額合計（至少）' : '中獎金額合計';
  $('gross').textContent = money(s.minGross);
  $('breakdown').textContent = s.pending ? `已確認 ${money(s.gross)}；尚有 ${s.pending} 張待對 8 碼（保底 ${money(s.pendingMin)}）` : `已確認 ${money(s.gross)}`;
  $('stats').textContent = `已輸入 ${s.count} 張，未中 ${s.rows.filter(r => r.state === 'miss').length} 張`;
  $('net').hidden = !state.opts.net; $('waiveRow').hidden = !state.opts.net;
  $('net').textContent = `稅後預估約 ${money(s.net)}（估算，含保底金額；實際以發獎單位扣繳為準）`;
  $('undo').disabled = !state.last;
  $('foot').replaceChildren(
    '號碼來源：財政部稅務入口網。本工具僅供參考，以財政部公告為準。', el('br'),
    '僅對紙本實體發票；雲端發票專屬獎請至財政部電子發票整合服務平台或兌獎 APP 查詢。', el('br'),
    d.source?.fetchedAt ? `資料抓取時間：${d.source.fetchedAt}` : '');
}

function updateHint() {
  const { number } = parseInvoice($('inv').value), d = draw(), n = number.length;
  if (!n) { setHint(''); return; }
  if (state.mode === 'r1') {
    if (n !== 3) return setHint(`已輸入 ${n} 碼（第一輪請輸入 3 碼）`);
    const t = lastThreeHint(number, d);
    setHint(t === 'sixth' ? '符合：至少六獎 $200，按 Enter 加入' : t === 'check' ? '末3碼同特別獎或特獎，按 Enter 加入後須對 8 碼' : '未符合，按 Enter 計入未中');
  } else {
    if (n !== 8) return setHint(`已輸入 ${n} 碼（第二輪請輸入 8 碼）`);
    const hit = evaluate(number, d);
    setHint(hit ? `${hit.label}：${money(hit.amount)}，按 Enter 確認` : '未中獎，按 Enter 確認');
  }
}

function done(msg) { save(); $('inv').value = ''; render(); setHint(msg); $('inv').focus(); }

function add() {
  const { serial, number } = parseInvoice($('inv').value), d = draw(), n = number.length;
  if (state.mode === 'r1') {
    if (n !== 3) return setHint(n ? `請輸入末 3 碼（目前 ${n} 碼）；完整 8 碼請切換到第二輪。` : '請先輸入末 3 碼。');
    const t = lastThreeHint(number, d), r = { id: newId(), period: state.code, last3: number };
    state.records.unshift(r); state.last = { id: r.id, kind: 'add' };
    return done(t === 'sixth' ? `${number}：至少六獎 $200，已加入清單`
      : t === 'check' ? `${number}：同特別獎/特獎末3碼，已加入清單，請於第二輪對 8 碼` : `${number}：未中`);
  }
  if (n !== 8) return setHint(n ? `請輸入完整 8 碼（目前 ${n} 碼）。` : '請輸入完整 8 碼。');
  if (state.records.some(r => r.period === state.code && r.number === number && (r.serial || '') === serial)) return setHint('這張發票本期已確認過。');
  const hit = evaluate(number, d), txt = hit ? `${hit.label} ${money(hit.amount)}` : '未中獎';
  const cand = state.records.find(r => r.period === state.code && !r.number && evaluateRecord(r, d).state === 'pending' && r.last3 === number.slice(-3));
  if (cand) { cand.number = number; cand.serial = serial; state.last = { id: cand.id, kind: 'resolve' }; return done(`已確認：${txt}`); }
  const r = { id: newId(), period: state.code, last3: number.slice(-3), number, serial };
  state.records.unshift(r); state.last = { id: r.id, kind: 'add' };
  done(`${txt}（不在初篩清單，已直接加入）`);
}

$('inv').addEventListener('input', updateHint);
$('inv').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
$('add').addEventListener('click', add);
$('undo').addEventListener('click', () => {
  const l = state.last; if (!l) return;
  const r = rec(l.id);
  if (l.kind === 'add') state.records = state.records.filter(x => x.id !== l.id);
  else if (r && l.kind === 'resolve') { delete r.number; delete r.serial; }
  else if (r && l.kind === 'manual') delete r.manual;
  state.last = null; save(); render(); setHint('已復原上一步。'); $('inv').focus();
});
$('optNet').addEventListener('change', e => { state.opts.net = e.target.checked; save(); render(); });
$('optWaive').addEventListener('change', e => { state.opts.waive = e.target.checked; save(); render(); });
$('clear').addEventListener('click', () => {
  if (confirm(`確定清除 ${periodLabel(state.code)} 的所有紀錄？`)) { state.records = state.records.filter(r => r.period !== state.code); state.last = null; save(); render(); }
});
init();
