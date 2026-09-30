// 기술적 지표 (배열 입력 → 같은 길이의 배열 출력, 워밍업 구간은 NaN)
import { sma, ema, isNum } from './stats.js';

function wilder(a, n) {
  const out = new Array(a.length).fill(NaN);
  let s = 0, cnt = 0, prev = NaN;
  for (let i = 0; i < a.length; i++) {
    if (!isNum(a[i])) { out[i] = prev; continue; }
    if (!isNum(prev)) {
      s += a[i]; cnt++;
      if (cnt === n) { prev = s / n; out[i] = prev; }
    } else {
      prev = (prev * (n - 1) + a[i]) / n;
      out[i] = prev;
    }
  }
  return out;
}

export function rsi(c, n = 14) {
  const up = new Array(c.length).fill(NaN), dn = new Array(c.length).fill(NaN);
  for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; up[i] = Math.max(d, 0); dn[i] = Math.max(-d, 0); }
  const au = wilder(up, n), ad = wilder(dn, n);
  return au.map((u, i) => (isNum(u) && isNum(ad[i]) ? (ad[i] === 0 ? 100 : 100 - 100 / (1 + u / ad[i])) : NaN));
}

export function macd(c, fast = 12, slow = 26, sig = 9) {
  const ef = ema(c, fast), es = ema(c, slow);
  const line = c.map((_, i) => (i >= slow - 1 ? ef[i] - es[i] : NaN));
  const signal = ema(line, sig, slow - 1);
  return { line, signal, hist: line.map((x, i) => x - signal[i]) };
}

export function stochastic(h, l, c, n = 14, sk = 3, sd = 3) {
  const raw = c.map((x, i) => {
    if (i < n - 1) return NaN;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) { if (h[j] > hh) hh = h[j]; if (l[j] < ll) ll = l[j]; }
    return hh > ll ? (100 * (x - ll)) / (hh - ll) : 50;
  });
  const k = sma(raw.map(x => (isNum(x) ? x : 0)), sk).map((x, i) => (i >= n - 1 + sk - 1 ? x : NaN));
  const d = sma(k.map(x => (isNum(x) ? x : 0)), sd).map((x, i) => (i >= n - 1 + sk + sd - 2 ? x : NaN));
  return { k, d };
}

export function bollinger(c, n = 20, m = 2) {
  const mid = sma(c, n), upper = [], lower = [], pctB = [], width = [];
  for (let i = 0; i < c.length; i++) {
    if (i < n - 1) { upper.push(NaN); lower.push(NaN); pctB.push(NaN); width.push(NaN); continue; }
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (c[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    upper.push(mid[i] + m * sd); lower.push(mid[i] - m * sd);
    pctB.push(sd > 0 ? (c[i] - (mid[i] - m * sd)) / (2 * m * sd) : 0.5);
    width.push(mid[i] > 0 ? (2 * m * sd) / mid[i] : NaN);
  }
  return { mid, upper, lower, pctB, width };
}

export function trueRange(h, l, c) {
  return c.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
}
export const atr = (h, l, c, n = 14) => wilder(trueRange(h, l, c), n);

export function adx(h, l, c, n = 14) {
  const pdm = [NaN], mdm = [NaN];
  for (let i = 1; i < c.length; i++) {
    const upMove = h[i] - h[i - 1], downMove = l[i - 1] - l[i];
    pdm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    mdm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const tr = trueRange(h, l, c); tr[0] = NaN;
  const atrN = wilder(tr, n), p = wilder(pdm, n), m = wilder(mdm, n);
  const pdi = p.map((x, i) => (atrN[i] > 0 ? (100 * x) / atrN[i] : NaN));
  const mdi = m.map((x, i) => (atrN[i] > 0 ? (100 * x) / atrN[i] : NaN));
  const dx = pdi.map((x, i) => (x + mdi[i] > 0 ? (100 * Math.abs(x - mdi[i])) / (x + mdi[i]) : NaN));
  return { adx: wilder(dx, n), pdi, mdi };
}

export function obv(c, v) {
  const out = [0];
  for (let i = 1; i < c.length; i++) out.push(out[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0));
  return out;
}

// 자금흐름 승수(Money Flow Multiplier) 기반 누적분산선·CMF
export function moneyFlow(h, l, c, v, n = 20) {
  const mfv = c.map((x, i) => (h[i] > l[i] ? (((x - l[i]) - (h[i] - x)) / (h[i] - l[i])) * v[i] : 0));
  const adl = [];
  mfv.reduce((acc, x, i) => (adl[i] = acc + x), 0);
  const cmf = c.map((_, i) => {
    if (i < n - 1) return NaN;
    let a = 0, b = 0;
    for (let j = i - n + 1; j <= i; j++) { a += mfv[j]; b += v[j]; }
    return b > 0 ? a / b : 0;
  });
  return { adl, cmf };
}

export function crossRecency(fast, slow, lookback = 20) {
  // 최근 lookback 봉 이내 교차: +k(골든) / -k(데드), 없으면 0. k = 경과 봉 수
  const n = fast.length;
  for (let i = n - 1; i >= Math.max(1, n - lookback); i--) {
    const a0 = fast[i - 1] - slow[i - 1], a1 = fast[i] - slow[i];
    if (!isNum(a0) || !isNum(a1)) break;
    if (a0 <= 0 && a1 > 0) return { type: 'golden', ago: n - 1 - i };
    if (a0 >= 0 && a1 < 0) return { type: 'dead', ago: n - 1 - i };
  }
  return null;
}
