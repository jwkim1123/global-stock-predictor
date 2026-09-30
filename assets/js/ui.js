// DOM 도우미 — 외부 데이터(뉴스 제목 등)는 항상 textContent로 삽입
import { isNum } from './engine/stats.js';
import { pct, spct } from './engine/format.js';

const SVGNS = 'http://www.w3.org/2000/svg';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  setAttrs(el, attrs, true);
  append(el, children);
  return el;
}
function setAttrs(el, attrs, svg = false) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') svg ? el.setAttribute('class', v) : (el.className = v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// 화면 폭 변경 시 차트 다시 그리기 (요소가 사라지면 자동 해제)
export function onChartResize(el, fn) {
  const handler = () => {
    if (!document.body.contains(el)) { window.removeEventListener('chart-resize', handler); return; }
    fn();
  };
  window.addEventListener('chart-resize', handler);
}

const cache = new Map();
export function getJSON(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); })
      .catch(e => { cache.delete(url); throw e; }));
  }
  return cache.get(url);
}

export function safeHref(u) {
  try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; }
}
export function extLink(url, text) {
  const href = safeHref(url);
  return href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text) : h('span', null, text);
}

export const cls = x => (!isNum(x) ? 'flat' : x > 0 ? 'up' : x < 0 ? 'down' : 'flat');
export function chg(x, d = 1) {
  return h('span', { class: `num ${cls(x)}` }, isNum(x) ? `${x > 0 ? '▲' : x < 0 ? '▼' : ''}${pct(Math.abs(x), d)}` : '—');
}
export function signed(x, d = 1) { return h('span', { class: `num ${cls(x)}` }, spct(x, d)); }

export function signalBadge(sig) {
  if (!sig) return null;
  return h('span', { class: `badge sig-${sig.key}` }, sig.label);
}

export function scoreBar(score, title) {
  const wrap = h('div', { class: 'scorebar', role: 'img', 'aria-label': isNum(score) ? `점수 ${score.toFixed(2)}` : '데이터 없음', title });
  if (!isNum(score)) { wrap.appendChild(h('div', { class: 'na' }, '데이터 없음')); return wrap; }
  wrap.append(h('div', { class: 'track' }), h('div', { class: 'zero' }));
  const w = Math.min(1, Math.abs(score)) * 50;
  if (w > 0.5) wrap.appendChild(h('div', { class: `fill ${score > 0 ? 'pos' : 'neg'}`, style: { width: `${w}%` } }));
  return wrap;
}

export function heat(score) {
  if (!isNum(score)) return h('span', { class: 'heat muted' }, '—');
  const p = Math.round(Math.min(1, Math.abs(score)) * 55);
  const col = score >= 0 ? 'var(--up)' : 'var(--down)';
  return h('span', { class: 'heat', style: { background: `color-mix(in srgb, ${col} ${p}%, transparent)` }, title: score.toFixed(2) }, (score > 0 ? '+' : '') + score.toFixed(2));
}

export function sparkline(values, { w = 96, h: ht = 28, change } = {}) {
  const v = (values || []).filter(isNum);
  const svg = s('svg', { viewBox: `0 0 ${w} ${ht}`, width: w, height: ht, 'aria-hidden': 'true', style: 'display:block' });
  if (v.length < 2) return svg;
  const mn = Math.min(...v), mx = Math.max(...v), pad = 3;
  const X = i => pad + (i / (v.length - 1)) * (w - 2 * pad);
  const Y = x => pad + (1 - (x - mn) / (mx - mn || 1)) * (ht - 2 * pad);
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join('');
  const dir = isNum(change) ? change : v[v.length - 1] - v[0];
  svg.append(
    s('path', { d, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
    s('circle', { cx: X(v.length - 1), cy: Y(v[v.length - 1]), r: 3, fill: dir >= 0 ? 'var(--up)' : 'var(--down)', stroke: 'var(--surface)', 'stroke-width': 1.5 }),
  );
  return svg;
}

export function segmented(options, value, onChange, label) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const o of options) {
    const b = h('button', { type: 'button', 'aria-pressed': String(o.value === value) }, o.label);
    b.addEventListener('click', () => {
      for (const x of wrap.children) x.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      onChange(o.value);
    });
    wrap.appendChild(b);
  }
  return wrap;
}

// 정렬 가능한 표: columns = [{key, label, num, render(row), sort(row) , cls}]
export function sortableTable({ columns, rows, sortKey, sortDir = -1, onRowClick, caption }) {
  const table = h('table');
  if (caption) table.appendChild(h('caption', { class: 'sr-only' }, caption));
  const thead = h('thead'), tbody = h('tbody');
  const tr = h('tr');
  let key = sortKey, dir = sortDir;
  const ths = columns.map(c => {
    const th = h('th', { class: `${c.num ? 'num ' : ''}${c.sort ? 'sortable' : ''}`, scope: 'col', tabindex: c.sort ? 0 : null }, c.label);
    if (c.sort) {
      const act = () => { if (key === c.key) dir = -dir; else { key = c.key; dir = c.num ? -1 : 1; } render(); };
      th.addEventListener('click', act);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    }
    return th;
  });
  tr.append(...ths); thead.appendChild(tr);
  table.append(thead, tbody);
  function render() {
    const col = columns.find(c => c.key === key);
    const data = col?.sort ? [...rows].sort((a, b) => {
      const x = col.sort(a), y = col.sort(b);
      if (!isNum(x) && typeof x !== 'string') return 1;
      if (!isNum(y) && typeof y !== 'string') return -1;
      return (typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y) * dir;
    }) : rows;
    ths.forEach((th, i) => th.setAttribute('aria-sort', columns[i].key === key ? (dir > 0 ? 'ascending' : 'descending') : 'none'));
    clear(tbody);
    for (const r of data) {
      const row = h('tr', { class: onRowClick ? 'clickable' : '' });
      if (onRowClick) {
        row.tabIndex = 0;
        row.addEventListener('click', () => onRowClick(r));
        row.addEventListener('keydown', e => { if (e.key === 'Enter') onRowClick(r); });
      }
      for (const c of columns) row.appendChild(h('td', { class: `${c.num ? 'num' : ''} ${c.cls || ''}` }, c.render ? c.render(r) : r[c.key]));
      tbody.appendChild(row);
    }
  }
  render();
  return h('div', { class: 'table-wrap' }, table);
}

export function statusOf(level) {
  const m = { '낮음': ['var(--good)', '●'], '보통': ['var(--warning)', '▲'], '높음': ['var(--serious)', '▲'], '매우 높음': ['var(--critical)', '■'] };
  const [c] = m[level] || ['var(--muted)'];
  return h('span', { class: 'status' }, h('i', { style: { background: c } }), level);
}

export function tile(label, value, { delta, note, extra } = {}) {
  return h('div', { class: 'card tile' },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value),
    delta ? h('div', { class: 'delta' }, delta) : null,
    extra || null,
    note ? h('div', { class: 'note' }, note) : null);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
export function ago(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!isNum(ms)) return '';
  const hr = ms / 3600000;
  return hr < 1 ? '방금' : hr < 24 ? `${Math.floor(hr)}시간 전` : `${Math.floor(hr / 24)}일 전`;
}
