// 머신러닝: 가격·거시 피처 → 릿지 회귀 + 그래디언트 부스팅 앙상블
// 퍼지드(purged) 워크포워드 검증으로 표본외 IC·적중률을 측정하고, 입증된 만큼만 예측에 반영합니다.
import { isNum, mean, spearman, ridgeFit, mulberry32, sma, rollingStd, rollingMax, rollingMin, alignTo } from './stats.js';
import { ML_HORIZONS } from './config.js';

const LN = Math.log;

export function buildFeatures(A, ctx) {
  const { ac, n, t } = A;
  const F = {};
  const lr = k => ac.map((x, i) => (i >= k ? LN(x / ac[i - k]) : NaN));
  F.r5 = lr(5); F.r20 = lr(20); F.r60 = lr(60); F.r120 = lr(120); F.r250 = lr(250);
  F.mom12_1 = ac.map((x, i) => (i >= 252 ? LN(ac[i - 21] / ac[i - 252]) : NaN));
  const m20 = sma(ac, 20), m50 = sma(ac, 50), m200 = sma(ac, 200);
  F.dma20 = ac.map((x, i) => x / m20[i] - 1); F.dma50 = ac.map((x, i) => x / m50[i] - 1); F.dma200 = ac.map((x, i) => x / m200[i] - 1);
  F.rsi = A.ind.rsi14.map(x => x / 100 - 0.5);
  F.macd = A.ind.macd.hist.map((x, i) => x / A.c[i]);
  F.stoch = A.ind.stoch.k.map(x => x / 100 - 0.5);
  F.bbp = A.ind.bb.pctB.map(x => x - 0.5);
  const vol20 = rollingStd(A.r, 20), vol60 = rollingStd(A.r, 60);
  F.vol20 = vol20.map(v => LN(v * Math.sqrt(252) + 1e-6));
  F.volRatio = vol20.map((v, i) => LN((v + 1e-9) / (vol60[i] + 1e-9)));
  if (A.hasVolume) {
    const v20 = sma(A.v, 20), v250 = sma(A.v, 250);
    F.vz = v20.map((x, i) => (v250[i] > 0 && x > 0 ? LN(x / v250[i]) : NaN));
    F.cmf = A.ind.cmf;
  }
  const hi = rollingMax(ac, 252), lo = rollingMin(ac, 252);
  F.hi52 = ac.map((x, i) => x / hi[i] - 1); F.lo52 = ac.map((x, i) => x / lo[i] - 1);
  if (A.bench) {
    const b = A.bench;
    F.rs20 = F.r20.map((x, i) => x - (i >= 20 ? LN(b[i] / b[i - 20]) : NaN));
    F.rs60 = F.r60.map((x, i) => x - (i >= 60 ? LN(b[i] / b[i - 60]) : NaN));
    const bm200 = sma(b.map(x => (isNum(x) ? x : NaN)), 200);
    F.bench200 = b.map((x, i) => x / bm200[i] - 1);
  }
  const S = sym => alignTo(t, ctx.series[sym], 'c', 5);
  const chg = (arr, k, log = true) => arr.map((x, i) => (i >= k ? (log ? LN(x / arr[i - k]) : x - arr[i - k]) : NaN));
  const vix = S('^VIX'), tnx = S('^TNX'), dxy = S('DX-Y.NYB'), oil = S('CL=F'), hyg = S('HYG'), ief = S('IEF'), cu = S('HG=F'), au = S('GC=F');
  F.vix = vix.map(x => LN(x));
  F.vixChg = chg(vix, 20);
  F.tnxChg = chg(tnx, 60, false);
  F.dxyChg = chg(dxy, 60);
  F.oilChg = chg(oil, 60);
  F.credit = hyg.map((x, i) => (i >= 20 ? LN(x / hyg[i - 20]) - LN(ief[i] / ief[i - 20]) : NaN));
  F.cuAu = cu.map((x, i) => (i >= 60 ? LN(x / au[i]) - LN(cu[i - 60] / au[i - 60]) : NaN));
  const month = t.map(d => new Date(d * 864e5).getUTCMonth());
  F.mSin = month.map(m => Math.sin((2 * Math.PI * m) / 12)); F.mCos = month.map(m => Math.cos((2 * Math.PI * m) / 12));
  return F;
}

// 히스토그램 기반 그래디언트 부스팅 (제곱오차, 얕은 트리)
function gbmFit(X, y, { trees = 70, depth = 2, lr = 0.05, minLeaf = 15, sub = 0.7, col = 0.8, bins = 16, seed = 7 } = {}) {
  const n = X.length, k = X[0].length, rng = mulberry32(seed);
  const edges = [];
  for (let j = 0; j < k; j++) {
    const s = X.map(r => r[j]).sort((a, b) => a - b), e = [];
    for (let b = 1; b < bins; b++) { const v = s[Math.floor((b / bins) * (n - 1))]; if (!e.length || v > e[e.length - 1]) e.push(v); }
    edges.push(e);
  }
  const binned = X.map(r => r.map((v, j) => { const e = edges[j]; let b = 0; while (b < e.length && v > e[b]) b++; return b; }));
  const f0 = mean(y), F = new Float64Array(n).fill(f0), imp = new Float64Array(k), model = [];
  const build = (rows, d, cols, res) => {
    let S = 0; for (const i of rows) S += res[i];
    const leaf = { v: (lr * S) / rows.length };
    if (d >= depth || rows.length < 2 * minLeaf) return leaf;
    let best = null;
    for (const j of cols) {
      const nb = edges[j].length + 1, hs = new Float64Array(nb), hc = new Float64Array(nb);
      for (const i of rows) { hs[binned[i][j]] += res[i]; hc[binned[i][j]]++; }
      let ls = 0, lc = 0;
      for (let b = 0; b < nb - 1; b++) {
        ls += hs[b]; lc += hc[b];
        const rc = rows.length - lc;
        if (lc < minLeaf || rc < minLeaf) continue;
        const gain = (ls * ls) / lc + ((S - ls) ** 2) / rc - (S * S) / rows.length;
        if (!best || gain > best.gain) best = { j, b, gain };
      }
    }
    if (!best || best.gain <= 1e-12) return leaf;
    imp[best.j] += best.gain;
    const L = rows.filter(i => binned[i][best.j] <= best.b), R = rows.filter(i => binned[i][best.j] > best.b);
    return { f: best.j, thr: edges[best.j][best.b], l: build(L, d + 1, cols, res), r: build(R, d + 1, cols, res) };
  };
  const walk = (node, row) => { while (node.f !== undefined) node = row[node.f] <= node.thr ? node.l : node.r; return node.v; };
  for (let m = 0; m < trees; m++) {
    const res = y.map((v, i) => v - F[i]);
    const rows = []; for (let i = 0; i < n; i++) if (rng() < sub) rows.push(i);
    const cols = []; for (let j = 0; j < k; j++) if (rng() < col) cols.push(j);
    if (rows.length < 2 * minLeaf || !cols.length) continue;
    const tree = build(rows, 0, cols, res);
    model.push(tree);
    for (let i = 0; i < n; i++) F[i] += walk(tree, X[i]);
  }
  return { predict: row => f0 + model.reduce((s, tr) => s + walk(tr, row), 0), importance: imp };
}

// 표본 구성: 5거래일 간격, 모든 피처·타깃이 유효한 시점만
function dataset(F, ac, H, names) {
  const n = ac.length, rows = [], ys = [], idx = [];
  for (let i = n - 1 - H; i >= 252; i -= 5) {
    const row = names.map(k => F[k][i]);
    if (!row.every(isNum)) continue;
    rows.push(row); ys.push(LN(ac[i + H] / ac[i])); idx.push(i);
  }
  return { X: rows.reverse(), y: ys.reverse(), idx: idx.reverse() };
}

export function mlForecast(A, ctx) {
  const F = buildFeatures(A, ctx);
  const n = A.n, last = n - 1;
  // 최근 5년 중 90% 이상 유효한 피처만 사용
  const names = Object.keys(F).filter(k => {
    let ok = 0, tot = 0;
    for (let i = Math.max(252, n - 1260); i < n; i++) { tot++; if (isNum(F[k][i])) ok++; }
    return tot > 0 && ok / tot > 0.9 && isNum(F[k][last]);
  });
  const out = {};
  for (const H of ML_HORIZONS) {
    const { X, y, idx } = dataset(F, A.ac, H, names);
    if (X.length < 180) { out[H] = null; continue; }
    const embargo = Math.ceil(H / 5) + 1, testLen = 50, firstTrain = Math.max(120, Math.floor(X.length * 0.45));
    const oosP = [], oosY = [];
    for (let s = firstTrain; s < X.length; s += testLen) {
      const trEnd = s - embargo;
      if (trEnd < 100) continue;
      const Xtr = X.slice(0, trEnd), ytr = y.slice(0, trEnd);
      const rd = ridgeFit(Xtr, ytr, 30), gb = gbmFit(Xtr, ytr, { seed: 11 + s });
      for (let i = s; i < Math.min(X.length, s + testLen); i++) { oosP.push(0.5 * rd.predict(X[i]) + 0.5 * gb.predict(X[i])); oosY.push(y[i]); }
    }
    if (oosP.length < 40) { out[H] = null; continue; }
    const ic = spearman(oosP, oosY);
    const hit = oosP.reduce((s, p, i) => s + ((p > 0) === (oosY[i] > 0) ? 1 : 0), 0) / oosP.length;
    const baseHit = oosY.filter(v => v > 0).length / oosY.length;
    const rd = ridgeFit(X, y, 30), gb = gbmFit(X, y, { seed: 99 });
    const xNow = names.map(k => F[k][last]);
    const pred = 0.5 * rd.predict(xNow) + 0.5 * gb.predict(xNow);
    const ym = mean(y);
    const totImp = gb.importance.reduce((a, b) => a + b, 0) || 1;
    const importance = names.map((k, j) => ({ f: k, w: gb.importance[j] / totImp })).sort((a, b) => b.w - a.w).slice(0, 6);
    // 예측값을 모델 자신의 표본외 예측 분포 대비 z-점수로 변환 (크기 보정)
    const pm = mean(oosP), psd = Math.sqrt(oosP.reduce((s, p) => s + (p - pm) ** 2, 0) / oosP.length) || 1e-9;
    const z = Math.max(-2.5, Math.min(2.5, (pred - pm) / psd));
    out[H] = { ic, hit, baseHit, nOOS: oosP.length, nTrain: X.length, pred, mean: ym, alpha: pred - ym, z, importance, oos: { p: oosP.slice(-60), y: oosY.slice(-60) } };
  }
  return out;
}

export const FEATURE_KO = {
  r5: '1주 수익률', r20: '1개월 수익률', r60: '3개월 수익률', r120: '6개월 수익률', r250: '1년 수익률', mom12_1: '12-1개월 모멘텀',
  dma20: '20일선 이격도', dma50: '50일선 이격도', dma200: '200일선 이격도', rsi: 'RSI', macd: 'MACD 히스토그램', stoch: '스토캐스틱',
  bbp: '볼린저 %B', vol20: '20일 변동성', volRatio: '변동성 변화', vz: '거래량 증감', cmf: '자금흐름(CMF)', hi52: '52주 고점 대비',
  lo52: '52주 저점 대비', rs20: '1개월 상대강도', rs60: '3개월 상대강도', bench200: '시장 200일선 이격', vix: 'VIX 수준',
  vixChg: 'VIX 변화', tnxChg: '10년물 금리 변화', dxyChg: '달러 변화', oilChg: '유가 변화', credit: '신용스프레드 변화',
  cuAu: '구리/금 비율 변화', mSin: '계절(월)', mCos: '계절(월)',
};
