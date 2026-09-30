// 수학·통계 유틸리티 (의존성 없음)

export const isNum = x => typeof x === 'number' && Number.isFinite(x);
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// x0 → -1, x1 → +1 로 선형 매핑 후 [-1, 1]로 자름 (x0 > x1 이면 역방향)
export function lin(x, x0, x1) {
  if (!isNum(x)) return null;
  return clamp(-1 + 2 * (x - x0) / (x1 - x0), -1, 1);
}
export const soft = (x, s) => (isNum(x) ? Math.tanh(x / s) : null);

export function sum(a) { let s = 0; for (const x of a) if (isNum(x)) s += x; return s; }
export function mean(a) {
  let s = 0, n = 0;
  for (const x of a) if (isNum(x)) { s += x; n++; }
  return n ? s / n : NaN;
}
export function variance(a) {
  const m = mean(a);
  let s = 0, n = 0;
  for (const x of a) if (isNum(x)) { s += (x - m) ** 2; n++; }
  return n > 1 ? s / (n - 1) : NaN;
}
export const std = a => Math.sqrt(variance(a));
export function sortedNums(a) { return a.filter(isNum).sort((x, y) => x - y); }
export function quantileSorted(s, q) {
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const quantile = (a, q) => quantileSorted(sortedNums(a), q);
export const median = a => quantile(a, 0.5);
export function skewness(a) {
  const v = a.filter(isNum), m = mean(v), s = std(v), n = v.length;
  if (n < 3 || !(s > 0)) return NaN;
  return v.reduce((acc, x) => acc + ((x - m) / s) ** 3, 0) / n;
}
export function exKurtosis(a) {
  const v = a.filter(isNum), m = mean(v), s = std(v), n = v.length;
  if (n < 4 || !(s > 0)) return NaN;
  return v.reduce((acc, x) => acc + ((x - m) / s) ** 4, 0) / n - 3;
}
export function percentileRank(a, x) {
  const v = a.filter(isNum);
  if (!v.length || !isNum(x)) return NaN;
  let below = 0;
  for (const y of v) if (y < x) below++; else if (y === x) below += 0.5;
  return below / v.length;
}

// 짝지은 유효값만 사용
function pairs(x, y) {
  const a = [], b = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (isNum(x[i]) && isNum(y[i])) { a.push(x[i]); b.push(y[i]); }
  return [a, b];
}
export function cov(x, y) {
  const [a, b] = pairs(x, y), n = a.length;
  if (n < 3) return NaN;
  const ma = mean(a), mb = mean(b);
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}
export function corr(x, y) {
  const [a, b] = pairs(x, y);
  if (a.length < 5) return NaN;
  const c = cov(a, b), sa = std(a), sb = std(b);
  return sa > 0 && sb > 0 ? c / (sa * sb) : NaN;
}
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
export function spearman(x, y) {
  const [a, b] = pairs(x, y);
  if (a.length < 8) return NaN;
  return corr(ranks(a), ranks(b));
}
export function beta(y, x) {
  const [a, b] = pairs(y, x);
  const v = variance(b);
  return v > 0 ? cov(a, b) / v : NaN;
}
export function linreg(x, y) {
  const [a, b] = pairs(x, y), n = a.length;
  if (n < 3) return { slope: NaN, intercept: NaN, r2: NaN };
  const ma = mean(a), mb = mean(b);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (a[i] - ma) * (b[i] - mb); sxx += (a[i] - ma) ** 2; syy += (b[i] - mb) ** 2; }
  const slope = sxx > 0 ? sxy / sxx : NaN;
  return { slope, intercept: mb - slope * ma, r2: sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0 };
}

// 가중 평균: [[값, 가중치], ...] 중 유효값만
export function wmean(items) {
  let s = 0, w = 0;
  for (const [v, wt] of items) if (isNum(v) && isNum(wt) && wt > 0) { s += v * wt; w += wt; }
  return w > 0 ? s / w : null;
}

// 시계열 도구 ------------------------------------------------------------
export function sma(a, n) {
  const out = new Array(a.length).fill(NaN);
  let s = 0, cnt = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i]; cnt++;
    if (cnt > n) { s -= a[i - n]; cnt--; }
    if (cnt === n) out[i] = s / n;
  }
  return out;
}
export function ema(a, n, start = 0) {
  const out = new Array(a.length).fill(NaN), k = 2 / (n + 1);
  let prev = NaN;
  for (let i = start; i < a.length; i++) {
    if (!isNum(a[i])) { out[i] = prev; continue; }
    prev = isNum(prev) ? a[i] * k + prev * (1 - k) : a[i];
    out[i] = prev;
  }
  return out;
}
export function rollingStd(a, n) {
  const out = new Array(a.length).fill(NaN);
  for (let i = n - 1; i < a.length; i++) out[i] = std(a.slice(i - n + 1, i + 1));
  return out;
}
export function rollingMax(a, n) {
  const out = new Array(a.length).fill(NaN);
  for (let i = 0; i < a.length; i++) { let m = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) if (a[j] > m) m = a[j]; out[i] = m; }
  return out;
}
export function rollingMin(a, n) {
  const out = new Array(a.length).fill(NaN);
  for (let i = 0; i < a.length; i++) { let m = Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) if (a[j] < m) m = a[j]; out[i] = m; }
  return out;
}
export function logReturns(p) {
  const r = new Array(p.length).fill(NaN);
  for (let i = 1; i < p.length; i++) if (p[i] > 0 && p[i - 1] > 0) r[i] = Math.log(p[i] / p[i - 1]);
  return r;
}
export function maxDrawdown(p) {
  let peak = -Infinity, mdd = 0;
  for (const x of p) { if (!isNum(x)) continue; if (x > peak) peak = x; if (peak > 0) mdd = Math.min(mdd, x / peak - 1); }
  return mdd;
}
// 이진 탐색: 정렬된 t에서 day 이하인 마지막 인덱스
export function idxAtOrBefore(t, day) {
  let lo = 0, hi = t.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (t[mid] <= day) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
// 시계열 {t, c|v}를 다른 날짜축에 맞춤 (as-of, 최대 lagDays 이내)
export function alignTo(days, series, key = 'c', lagDays = 7) {
  const out = new Array(days.length).fill(NaN);
  if (!series) return out;
  const vals = series[key] || series.v || series.c;
  let j = 0;
  for (let i = 0; i < days.length; i++) {
    while (j + 1 < series.t.length && series.t[j + 1] <= days[i]) j++;
    if (series.t[j] <= days[i] && days[i] - series.t[j] <= lagDays) out[i] = vals[j];
  }
  return out;
}
// 최근 값 & N일(달력) 전 값 대비 변화
export function lastOf(series, key = 'c') {
  if (!series?.t?.length) return null;
  const vals = series[key] || series.v || series.c;
  for (let i = vals.length - 1; i >= 0; i--) if (isNum(vals[i])) return { day: series.t[i], value: vals[i], i };
  return null;
}
export function valueDaysAgo(series, days, key = 'c') {
  const last = lastOf(series, key);
  if (!last) return null;
  const i = idxAtOrBefore(series.t, last.day - days);
  const vals = series[key] || series.v || series.c;
  return i >= 0 ? vals[i] : null;
}
export function pctChange(series, days, key = 'c') {
  const last = lastOf(series, key), prev = valueDaysAgo(series, days, key);
  return last && isNum(prev) && prev !== 0 ? last.value / prev - 1 : null;
}
export function diffChange(series, days, key = 'c') {
  const last = lastOf(series, key), prev = valueDaysAgo(series, days, key);
  return last && isNum(prev) ? last.value - prev : null;
}
// 주간(5거래일) 로그수익률: 끝에서부터 5일 간격 샘플링
export function weeklyReturns(p, weeks = 104) {
  const out = [];
  for (let i = p.length - 1; i - 5 >= 0 && out.length < weeks; i -= 5) {
    out.push(p[i] > 0 && p[i - 5] > 0 ? Math.log(p[i] / p[i - 5]) : NaN);
  }
  return out.reverse();
}

// 난수 (재현 가능한 시드) ------------------------------------------------
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function normalGen(rng) {
  let spare = null;
  return function () {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u, v, s;
    do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * m;
    return u * m;
  };
}
// Marsaglia–Tsang 감마 표본
export function gammaGen(rng, norm) {
  return function gamma(k) {
    if (k < 1) return gamma(k + 1) * Math.pow(rng(), 1 / k);
    const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x, v;
      do { x = norm(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      const u = rng();
      if (u < 1 - 0.0331 * x ** 4) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };
}
export function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// 최적화: Nelder–Mead ----------------------------------------------------
export function nelderMead(f, x0, { maxIter = 400, tol = 1e-8, step = 0.1 } = {}) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step * (Math.abs(x[i]) > 1e-3 ? Math.abs(x[i]) : 1); simplex.push(x); }
  let vals = simplex.map(f);
  for (let it = 0; it < maxIter; it++) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = order.map(i => simplex[i]); vals = order.map(i => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < tol) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const pt = (a, b, t) => a.map((ai, j) => ai + t * (b[j] - ai));
    const xr = pt(c, simplex[n], -1), fr = f(xr);
    if (fr < vals[0]) {
      const xe = pt(c, simplex[n], -2), fe = f(xe);
      if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { simplex[n] = xr; vals[n] = fr; }
    else {
      const xc = pt(c, simplex[n], 0.5), fc = f(xc);
      if (fc < vals[n]) { simplex[n] = xc; vals[n] = fc; }
      else for (let i = 1; i <= n; i++) { simplex[i] = pt(simplex[0], simplex[i], 0.5); vals[i] = f(simplex[i]); }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: simplex[best], fx: vals[best] };
}

// 선형대수: 릿지 회귀 (Cholesky) ---------------------------------------------
export function ridgeFit(X, y, lambda = 10) {
  const n = X.length, k = X[0].length;
  const mu = new Array(k).fill(0), sd = new Array(k).fill(0);
  for (const row of X) for (let j = 0; j < k; j++) mu[j] += row[j] / n;
  for (const row of X) for (let j = 0; j < k; j++) sd[j] += (row[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < k; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const ym = mean(y);
  const A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const z = X[i].map((v, j) => (v - mu[j]) / sd[j]);
    for (let a = 0; a < k; a++) { b[a] += z[a] * (y[i] - ym); for (let c = a; c < k; c++) A[a][c] += z[a] * z[c]; }
  }
  for (let a = 0; a < k; a++) { A[a][a] += lambda; for (let c = 0; c < a; c++) A[a][c] = A[c][a]; }
  const w = cholSolve(A, b);
  return { w, mu, sd, ym, predict: row => ym + row.reduce((s, v, j) => s + w[j] * (v - mu[j]) / sd[j], 0) };
}
export function cholSolve(A, b) {
  const n = A.length, L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j];
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j];
  }
  const z = new Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * z[k]; z[i] = s / L[i][i]; }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = z[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
}
