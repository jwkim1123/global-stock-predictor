// SVG 차트: 가격+예측 팬차트, 요인 발산 막대, 수익률 분포 히스토그램, 계절성 막대
import { h, s, clear } from './ui.js';
import { isNum } from './engine/stats.js';
import { price as fmtPrice, pct, spct, dateKo } from './engine/format.js';
import { HORIZON_LABELS } from './engine/config.js';

function niceTicks(min, max, count = 5) {
  const span = max - min || Math.abs(max) || 1;
  const step0 = span / count, mag = 10 ** Math.floor(Math.log10(step0)), err = step0 / mag;
  const step = (err >= 7 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

function tooltip(box) {
  const tip = h('div', { class: 'tooltip', role: 'status', 'aria-live': 'polite' });
  box.appendChild(tip);
  return {
    show(x, y, title, rows) {
      clear(tip);
      tip.appendChild(h('div', { class: 'tt-title' }, title));
      for (const r of rows) tip.appendChild(h('div', { class: 'tt-row' }, h('span', { class: 'k' }, r.color ? h('i', { style: { background: r.color } }) : null, r.k), h('b', null, r.v)));
      tip.classList.add('show');
      const bw = box.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = x + 14; if (left + tw > bw) left = x - tw - 14;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${Math.max(0, Math.min(y - th / 2, box.clientHeight - th))}px`;
    },
    hide() { tip.classList.remove('show'); },
  };
}

const dayLabel = d => { const x = new Date(d * 864e5); return `${String(x.getUTCFullYear()).slice(2)}.${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };

// ------------------------------------------------------------------ 가격 + 예측 팬차트
export function priceChart(box, res, { horizon = 20, range = 250, fan = res.fan } = {}) {
  clear(box);
  const W = Math.max(320, box.clientWidth || 800), H = W < 560 ? 280 : 340;
  const ch = res.chart, ccy = res.currency;
  const tickW = Math.max(40, fmtPrice(Math.max(...ch.c.filter(isNum)) * 1.5, ccy).length * 6.6 + 10);
  const m = { l: tickW, r: 74, t: 14, b: 26 };
  const N = ch.t.length, start = Math.max(0, N - range);
  const hist = [];
  for (let i = start; i < N; i++) hist.push(i);
  const fDays = fan.days.filter(d => d <= horizon);
  const fi = fDays.map(d => fan.days.indexOf(d));
  const q = k => fi.map(j => fan.q[k][j]);
  const q05 = q(0), q25 = q(1), q50 = q(2), q75 = q(3), q95 = q(4);
  // 과거 구간과 예측 구간을 분할 척도로 배치 (예측 구간이 너무 좁아지지 않도록 최소 24% 확보)
  const histN = Math.max(1, hist.length - 1), plotW = W - m.l - m.r;
  const fw = Math.min(0.5, Math.max(0.24, horizon / (histN + horizon)));
  const histW = plotW * (1 - fw), fcW = plotW * fw;
  const xs = i => m.l + ((i - start) / histN) * histW;   // 과거 인덱스
  const xf = d => m.l + histW + (d / horizon) * fcW;      // 미래 거래일
  let lo = Infinity, hi = -Infinity;
  for (const i of hist) for (const v of [ch.c[i], ch.ma20[i], ch.ma60[i], ch.ma200[i]]) if (isNum(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (const v of [...q05, ...q95]) if (isNum(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${res.nameKo || res.name} 가격 추이와 ${HORIZON_LABELS[horizon]} 예측 범위` });

  // 격자·축
  for (const v of niceTicks(lo, hi, 5)) {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: 'var(--grid)', 'stroke-width': 1 }));
    svg.append(s('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'num' }, fmtPrice(v, ccy)));
  }
  let lastMonth = null, lastX = -99;
  for (const i of hist) {
    const mo = dayLabel(ch.t[i]);
    if (mo !== lastMonth) {
      lastMonth = mo;
      const x = xs(i);
      if (x - lastX > 56) { svg.append(s('text', { x, y: H - 8, 'text-anchor': 'middle' }, mo)); lastX = x; }
    }
  }
  const lastDay = ch.t[N - 1];
  const fLabelDay = lastDay + Math.round(horizon * 365 / 252);
  svg.append(s('text', { x: xf(horizon), y: H - 8, 'text-anchor': 'end' }, `${HORIZON_LABELS[horizon]} 후`));

  // 오늘 기준선
  svg.append(s('line', { x1: xf(0), x2: xf(0), y1: m.t, y2: H - m.b, stroke: 'var(--axis)', 'stroke-width': 1 }));

  // 예측 팬
  const area = (a, b) => {
    const top = fDays.map((d, k) => `${k ? 'L' : 'M'}${xf(d).toFixed(1)},${Y(b[k]).toFixed(1)}`).join('');
    const bot = fDays.map((d, k) => [d, a[k]]).reverse().map(([d, v]) => `L${xf(d).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    return `${top}${bot}Z`;
  };
  svg.append(s('path', { d: area(q05, q95), fill: 'var(--fan-90)' }), s('path', { d: area(q25, q75), fill: 'var(--fan-50)' }));
  svg.append(s('path', { d: fDays.map((d, k) => `${k ? 'L' : 'M'}${xf(d).toFixed(1)},${Y(q50[k]).toFixed(1)}`).join(''), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 2, 'stroke-dasharray': '5 4', 'stroke-linecap': 'round' }));

  // 지지·저항 (가시 범위 내만)
  const lvl = (arr, name) => (arr || []).slice(0, 2).forEach(l => {
    if (l.price < lo || l.price > hi) return;
    svg.append(s('line', { x1: xs(Math.max(start, N - 120)), x2: xf(0), y1: Y(l.price), y2: Y(l.price), stroke: 'var(--muted)', 'stroke-width': 1, opacity: 0.8 }));
    svg.append(s('text', { x: xs(Math.max(start, N - 120)) + 2, y: Y(l.price) - 4 }, `${name} ${fmtPrice(l.price, ccy)}`));
  });
  lvl(res.levels?.support, '지지'); lvl(res.levels?.resistance, '저항');

  // 이동평균·가격
  const line = (arr, color, w = 1.5) => {
    let d = '', pen = false;
    for (const i of hist) { const v = arr[i]; if (!isNum(v)) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${xs(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }
    svg.append(s('path', { d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  };
  line(ch.ma200, 'var(--s-ma200)'); line(ch.ma60, 'var(--s-ma60)'); line(ch.ma20, 'var(--s-ma20)');
  line(ch.c, 'var(--ink)', 2);

  // 끝점 라벨 (선택적 직접 라벨)
  const px = ch.c[N - 1];
  svg.append(s('circle', { cx: xf(0), cy: Y(px), r: 4, fill: 'var(--ink)', stroke: 'var(--surface)', 'stroke-width': 2 }));
  const endLab = (v, text, strong) => svg.append(s('text', { x: xf(horizon) + 6, y: Y(v) + 4, class: 'num', style: strong ? 'fill:var(--ink);font-weight:600' : '' }, text));
  endLab(q50[q50.length - 1], fmtPrice(q50[q50.length - 1], ccy), true);
  if (Math.abs(Y(q95[q95.length - 1]) - Y(q50[q50.length - 1])) > 14) endLab(q95[q95.length - 1], fmtPrice(q95[q95.length - 1], ccy));
  if (Math.abs(Y(q05[q05.length - 1]) - Y(q50[q50.length - 1])) > 14) endLab(q05[q05.length - 1], fmtPrice(q05[q05.length - 1], ccy));

  // 십자선 + 툴팁
  const cross = s('line', { y1: m.t, y2: H - m.b, stroke: 'var(--ink-2)', 'stroke-width': 1, opacity: 0 });
  const dot = s('circle', { r: 4, fill: 'var(--ink)', stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0 });
  svg.append(cross, dot);
  const hit = s('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent', tabindex: 0, 'aria-label': '차트 영역: 좌우 방향키로 날짜 이동' });
  svg.append(hit);
  box.appendChild(svg);
  const tip = tooltip(box);
  // 통합 스텝: 0..histN = 과거 봉, histN+j = 예측 지점 fDays[j]
  const totalSteps = histN + fDays.length - 1;
  const stepX = k => (k <= histN ? xs(start + k) : xf(fDays[k - histN]));
  let cur = histN;
  const showAt = idx => {
    idx = Math.max(0, Math.min(totalSteps, idx)); cur = idx;
    const scale = box.clientWidth / W;
    const x = stepX(idx);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('opacity', 1);
    if (idx <= histN) {
      const i = start + idx, v = ch.c[i];
      dot.setAttribute('cx', x); dot.setAttribute('cy', Y(v)); dot.setAttribute('opacity', 1);
      tip.show(x * scale, Y(v) * scale, dateKo(ch.t[i]), [
        { k: '종가', v: fmtPrice(v, ccy), color: 'var(--ink)' },
        isNum(ch.ma20[i]) && { k: '20일선', v: fmtPrice(ch.ma20[i], ccy), color: 'var(--s-ma20)' },
        isNum(ch.ma60[i]) && { k: '60일선', v: fmtPrice(ch.ma60[i], ccy), color: 'var(--s-ma60)' },
        isNum(ch.ma200[i]) && { k: '200일선', v: fmtPrice(ch.ma200[i], ccy), color: 'var(--s-ma200)' },
      ].filter(Boolean));
    } else {
      const k = idx - histN;
      const day = lastDay + Math.round((fDays[k] * 365) / 252);
      dot.setAttribute('cx', xf(fDays[k])); dot.setAttribute('cy', Y(q50[k])); dot.setAttribute('opacity', 1);
      tip.show(xf(fDays[k]) * scale, Y(q50[k]) * scale, `${dateKo(day)} 무렵 (${fDays[k]}거래일 후)`, [
        { k: '중앙값', v: `${fmtPrice(q50[k], ccy)} (${spct(q50[k] / px - 1)})` },
        { k: '50% 구간', v: `${fmtPrice(q25[k], ccy)} ~ ${fmtPrice(q75[k], ccy)}` },
        { k: '90% 구간', v: `${fmtPrice(q05[k], ccy)} ~ ${fmtPrice(q95[k], ccy)}` },
      ]);
    }
  };
  const fromEvent = e => {
    const r = svg.getBoundingClientRect();
    const xv = ((e.clientX - r.left) / r.width) * W;
    if (xv <= m.l + histW) return Math.round(((xv - m.l) / histW) * histN);
    const d = ((xv - m.l - histW) / fcW) * horizon;
    let j = 0;
    for (let k = 1; k < fDays.length; k++) if (Math.abs(fDays[k] - d) < Math.abs(fDays[j] - d)) j = k;
    return histN + j;
  };
  hit.addEventListener('pointermove', e => showAt(fromEvent(e)));
  hit.addEventListener('pointerleave', () => { tip.hide(); cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); });
  hit.addEventListener('focus', () => showAt(cur));
  hit.addEventListener('blur', () => { tip.hide(); cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); });
  hit.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); showAt(cur - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); showAt(cur + 1); }
  });
  return { fLabelDay };
}

export function priceLegend() {
  return h('div', { class: 'legend' },
    h('span', null, h('i', { class: 'ln', style: { background: 'var(--ink)' } }), '종가'),
    h('span', null, h('i', { class: 'ln', style: { background: 'var(--s-ma20)' } }), '20일 이동평균'),
    h('span', null, h('i', { class: 'ln', style: { background: 'var(--s-ma60)' } }), '60일 이동평균'),
    h('span', null, h('i', { class: 'ln', style: { background: 'var(--s-ma200)' } }), '200일 이동평균'),
    h('span', null, h('i', { class: 'ln dash' }), '예측 중앙값'),
    h('span', null, h('i', { class: 'sw', style: { background: 'var(--fan-50)' } }), '50% 예측 구간'),
    h('span', null, h('i', { class: 'sw', style: { background: 'var(--fan-90)' } }), '90% 예측 구간'));
}

// ------------------------------------------------------------------ 요인 점수 발산 막대
export function factorBars(box, rows) {
  // rows: [{label, score, sub, tip:[{k,v}]}]
  clear(box);
  const W = Math.max(320, box.clientWidth || 600), rowH = 34, H = rows.length * rowH + 24;
  const labW = W < 480 ? 86 : 118, valW = 52;
  const x0 = labW + (W - labW - valW) / 2, half = (W - labW - valW) / 2 - 8;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '9개 요인 점수 (−1 ~ +1)' });
  for (const t of [-1, -0.5, 0, 0.5, 1]) {
    svg.append(s('line', { x1: x0 + t * half, x2: x0 + t * half, y1: 4, y2: H - 20, stroke: t === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }));
    svg.append(s('text', { x: x0 + t * half, y: H - 6, 'text-anchor': 'middle' }, t > 0 ? `+${t}` : `${t}`));
  }
  const tip = tooltip(box);
  rows.forEach((r, k) => {
    const y = 4 + k * rowH, cy = y + rowH / 2 - 2;
    svg.append(s('text', { x: 0, y: cy + 4, style: 'fill:var(--ink);font-size:12.5px' }, r.label));
    if (!isNum(r.score)) { svg.append(s('text', { x: x0 + 6, y: cy + 4 }, '데이터 없음')); return; }
    const w = Math.max(2, Math.abs(r.score) * half), bh = 14, pos = r.score >= 0;
    const x = pos ? x0 : x0 - w, rad = Math.min(4, w / 2);
    const d = pos
      ? `M${x},${cy - bh / 2}h${w - rad}a${rad},${rad} 0 0 1 ${rad},${rad}v${bh - 2 * rad}a${rad},${rad} 0 0 1 -${rad},${rad}h-${w - rad}Z`
      : `M${x0},${cy - bh / 2}h-${w - rad}a${rad},${rad} 0 0 0 -${rad},${rad}v${bh - 2 * rad}a${rad},${rad} 0 0 0 ${rad},${rad}h${w - rad}Z`;
    const bar = s('path', { d, fill: pos ? 'var(--up)' : 'var(--down)', opacity: 0.35 + 0.65 * (r.conf ?? 1) });
    svg.append(bar);
    svg.append(s('text', { x: W - valW + 8, y: cy + 4, class: 'num', style: 'fill:var(--ink);font-weight:600' }, (r.score > 0 ? '+' : '') + r.score.toFixed(2)));
    const hitR = s('rect', { x: labW, y, width: W - labW, height: rowH, fill: 'transparent', tabindex: 0, 'aria-label': `${r.label} ${r.score.toFixed(2)}` });
    const show = () => { const sc = box.clientWidth / W; bar.setAttribute('opacity', 1); tip.show((pos ? x0 + w : x0 - w) * sc, cy * sc, r.label, r.tip || []); };
    const hide = () => { bar.setAttribute('opacity', 0.35 + 0.65 * (r.conf ?? 1)); tip.hide(); };
    hitR.addEventListener('pointermove', show); hitR.addEventListener('pointerleave', hide);
    hitR.addEventListener('focus', show); hitR.addEventListener('blur', hide);
    if (r.onClick) { hitR.style.cursor = 'pointer'; hitR.addEventListener('click', r.onClick); hitR.addEventListener('keydown', e => { if (e.key === 'Enter') r.onClick(); }); }
    svg.append(hitR);
  });
  box.appendChild(svg);
}

// ------------------------------------------------------------------ 수익률 분포 히스토그램
export function histogram(box, f, { horizon } = {}) {
  clear(box);
  const W = Math.max(320, box.clientWidth || 600), H = 220, m = { l: 8, r: 8, t: 16, b: 28 };
  const { lo, hi, counts } = f.hist, n = counts.length, total = counts.reduce((a, b) => a + b, 0) || 1;
  const bw = (W - m.l - m.r) / n, maxC = Math.max(...counts);
  const X = r => m.l + ((r - lo) / (hi - lo)) * (W - m.l - m.r);
  const Y = c => m.t + (1 - c / maxC) * (H - m.t - m.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${HORIZON_LABELS[horizon]} 수익률 분포` });
  svg.append(s('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, stroke: 'var(--axis)', 'stroke-width': 1 }));
  const tip = tooltip(box);
  const barW = Math.min(24, Math.max(2, bw - 2));
  counts.forEach((c, i) => {
    const a = lo + ((hi - lo) * i) / n, b = lo + ((hi - lo) * (i + 1)) / n, mid = (a + b) / 2;
    const x = m.l + i * bw + (bw - barW) / 2, y = Y(c), hgt = H - m.b - y;
    if (hgt <= 0) return;
    const r = Math.min(2, barW / 2, hgt);
    const d = `M${x},${H - m.b}v-${hgt - r}a${r},${r} 0 0 1 ${r},-${r}h${barW - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${hgt - r}Z`;
    const bar = s('path', { d, fill: mid >= 0 ? 'var(--up)' : 'var(--down)', opacity: 0.75 });
    svg.append(bar);
    const hr = s('rect', { x: m.l + i * bw, y: m.t, width: bw, height: H - m.t - m.b, fill: 'transparent' });
    hr.addEventListener('pointermove', () => { bar.setAttribute('opacity', 1); const sc = box.clientWidth / W; tip.show((x + barW / 2) * sc, y * sc, `${spct(a)} ~ ${spct(b)}`, [{ k: '확률', v: pct(c / total, 1) }]); });
    hr.addEventListener('pointerleave', () => { bar.setAttribute('opacity', 0.75); tip.hide(); });
    svg.append(hr);
  });
  const mark = (v, label, anchor) => {
    if (v < lo || v > hi) return;
    svg.append(s('line', { x1: X(v), x2: X(v), y1: m.t - 6, y2: H - m.b, stroke: 'var(--ink)', 'stroke-width': 1.5 }));
    svg.append(s('text', { x: X(v) + (anchor === 'end' ? -4 : 4), y: m.t + 2, 'text-anchor': anchor, style: 'fill:var(--ink);font-size:11.5px' }, label));
  };
  mark(f.q50, `중앙값 ${spct(f.q50)}`, 'start');
  mark(f.q05, `하위 5% ${spct(f.q05)}`, 'end');
  for (const v of niceTicks(lo, hi, 6)) if (v >= lo && v <= hi) svg.append(s('text', { x: X(v), y: H - 10, 'text-anchor': 'middle' }, spct(v, 0)));
  box.appendChild(svg);
}

// ------------------------------------------------------------------ 계절성 (월별 평균 수익률)
export function seasonChart(box, seas, currentMonth) {
  clear(box);
  const W = Math.max(320, box.clientWidth || 600), H = 200, m = { l: 36, r: 8, t: 12, b: 26 };
  const vals = seas.map(x => x.avg).filter(isNum);
  const ext = Math.max(0.02, ...vals.map(Math.abs)) * 1.15;
  const Y = v => m.t + ((ext - v) / (2 * ext)) * (H - m.t - m.b);
  const bw = (W - m.l - m.r) / 12, barW = Math.min(24, bw - 6);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '월별 평균 수익률' });
  for (const t of niceTicks(-ext, ext, 4)) {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: t === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }));
    svg.append(s('text', { x: m.l - 4, y: Y(t) + 4, 'text-anchor': 'end' }, spct(t, 0)));
  }
  const tip = tooltip(box);
  seas.forEach((x, i) => {
    const cx = m.l + i * bw + bw / 2;
    svg.append(s('text', { x: cx, y: H - 8, 'text-anchor': 'middle', style: i === currentMonth ? 'fill:var(--ink);font-weight:600' : '' }, `${x.m}월`));
    if (!isNum(x.avg)) return;
    const y0 = Y(0), y1 = Y(x.avg), top = Math.min(y0, y1), hgt = Math.max(1, Math.abs(y1 - y0));
    const r = Math.min(4, barW / 2, hgt);
    const pos = x.avg >= 0;
    const d = pos
      ? `M${cx - barW / 2},${y0}v-${hgt - r}a${r},${r} 0 0 1 ${r},-${r}h${barW - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${hgt - r}Z`
      : `M${cx - barW / 2},${y0}v${hgt - r}a${r},${r} 0 0 0 ${r},${r}h${barW - 2 * r}a${r},${r} 0 0 0 ${r},-${r}v-${hgt - r}Z`;
    const bar = s('path', { d, fill: pos ? 'var(--up)' : 'var(--down)', opacity: i === currentMonth || i === (currentMonth + 1) % 12 ? 1 : 0.55 });
    svg.append(bar);
    const hr = s('rect', { x: cx - bw / 2, y: m.t, width: bw, height: H - m.t - m.b, fill: 'transparent', tabindex: 0 });
    const show = () => { const sc = box.clientWidth / W; tip.show(cx * sc, top * sc, `${x.m}월 (${x.n}년)`, [{ k: '평균 수익률', v: spct(x.avg) }, { k: '상승 확률', v: pct(x.win, 0) }]); };
    hr.addEventListener('pointermove', show); hr.addEventListener('focus', show);
    hr.addEventListener('pointerleave', () => tip.hide()); hr.addEventListener('blur', () => tip.hide());
    svg.append(hr);
  });
  box.appendChild(svg);
}
