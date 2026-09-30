// 몬테카를로 시뮬레이션: GARCH 변동성 경로 + t-분포 꼬리 + 블랙스완 점프 + 실적발표 점프
import { mulberry32, normalGen, gammaGen, quantileSorted } from './stats.js';
import { HORIZONS } from './config.js';

// inputs: { S0, sigmas[T], nu, baseAnnual, alphaByH{H:logα}, crash{lambdaBase, mult, mean, sd, beta, idio}, earnings[{day, sd}], seed }
export function buildDrift(inputs, T) {
  const { sigmas, baseAnnual, alphaByH, crash, earnings } = inputs;
  const drift = new Float64Array(T);
  const hs = HORIZONS.filter(h => h <= T);
  let prevH = 0, prevA = 0;
  const alphaDaily = new Float64Array(T);
  for (const h of hs) {
    const a = alphaByH[h] ?? prevA;
    for (let t = prevH; t < h; t++) alphaDaily[t] = (a - prevA) / (h - prevH);
    prevH = h; prevA = a;
  }
  // 기본 붕괴 위험은 주식위험프리미엄에 이미 반영 → 기본 강도만큼 보정, 초과 위험만 기대수익 감소
  let comp = 0;
  if (crash) {
    const ej = Math.exp(crash.beta * crash.mean + 0.5 * (crash.beta ** 2 * crash.sd ** 2 + crash.idio ** 2)) - 1;
    comp = -(crash.lambdaBase / 252) * ej;
  }
  const eMap = new Map((earnings || []).map(e => [e.day, e.sd]));
  for (let t = 0; t < T; t++) {
    const s = sigmas[Math.min(t, sigmas.length - 1)];
    const e = eMap.get(t + 1) || 0;
    drift[t] = baseAnnual / 252 - 0.5 * s * s + alphaDaily[t] + comp - 0.5 * e * e;
  }
  return drift;
}

export function simulate(inputs, { nPaths = 4000, T = 250, fanStep = 5 } = {}) {
  const { S0, sigmas, nu, crash, earnings, seed } = inputs;
  const drift = buildDrift(inputs, T);
  const rng = mulberry32(seed || 1), norm = normalGen(rng), gamma = gammaGen(rng, norm);
  const useT = nu && nu < 29;
  const tScale = useT ? Math.sqrt((nu - 2) / nu) : 1;
  const lamD = crash ? (crash.lambdaBase * crash.mult) / 252 : 0;
  const eMap = new Map((earnings || []).map(e => [e.day, e.sd]));
  const hs = HORIZONS.filter(h => h <= T);
  const hIndex = new Map(hs.map((h, k) => [h, k]));
  const term = hs.map(() => new Float64Array(nPaths));
  const mdd = hs.map(() => new Float64Array(nPaths));
  const fanDays = [];
  for (let d = fanStep; d <= T; d += fanStep) fanDays.push(d);
  const fanIdx = new Map(fanDays.map((d, k) => [d, k]));
  const fan = fanDays.map(() => new Float32Array(nPaths));
  let crashCount = 0;

  for (let p = 0; p < nPaths; p++) {
    let x = 0, peak = 0, dd = 0;
    for (let t = 1; t <= T; t++) {
      let z;
      if (useT) { const g = 2 * gamma(nu / 2); z = (norm() / Math.sqrt(g / nu)) * tScale; } else z = norm();
      let r = drift[t - 1] + sigmas[Math.min(t - 1, sigmas.length - 1)] * z;
      if (lamD > 0 && rng() < lamD) { r += crash.beta * (crash.mean + crash.sd * norm()) + crash.idio * norm(); crashCount++; }
      const e = eMap.get(t);
      if (e) r += e * norm();
      x += r;
      if (x > peak) peak = x;
      if (x - peak < dd) dd = x - peak;
      const hk = hIndex.get(t);
      if (hk !== undefined) { term[hk][p] = x; mdd[hk][p] = dd; }
      const fk = fanIdx.get(t);
      if (fk !== undefined) fan[fk][p] = x;
    }
  }

  const horizons = {};
  hs.forEach((h, k) => {
    const s = Float64Array.from(term[k]).sort();
    const q = v => quantileSorted(s, v);
    let sumSimple = 0, up = 0, up10 = 0, dn10 = 0, dn20 = 0;
    const l11 = Math.log(1.1), l09 = Math.log(0.9), l08 = Math.log(0.8);
    for (const v of s) { sumSimple += Math.exp(v); if (v > 0) up++; if (v > l11) up10++; if (v < l09) dn10++; if (v < l08) dn20++; }
    const cut = Math.max(1, Math.floor(s.length * 0.05));
    let tail = 0; for (let i = 0; i < cut; i++) tail += Math.exp(s[i]) - 1;
    let mddSum = 0, mdd20 = 0;
    for (const v of mdd[k]) { const m = Math.exp(v) - 1; mddSum += m; if (m < -0.2) mdd20++; }
    // 히스토그램 (단순수익률, 0.5%~99.5% 구간 40칸)
    const lo = Math.exp(q(0.005)) - 1, hi = Math.exp(q(0.995)) - 1, bins = 40, counts = new Array(bins).fill(0);
    for (const v of s) { const r = Math.exp(v) - 1; const b = Math.floor(((r - lo) / (hi - lo)) * bins); if (b >= 0 && b < bins) counts[b]++; }
    const n = s.length;
    horizons[h] = {
      mean: sumSimple / n - 1,
      q05: Math.exp(q(0.05)) - 1, q10: Math.exp(q(0.10)) - 1, q25: Math.exp(q(0.25)) - 1, q50: Math.exp(q(0.5)) - 1,
      q75: Math.exp(q(0.75)) - 1, q90: Math.exp(q(0.90)) - 1, q95: Math.exp(q(0.95)) - 1,
      pUp: up / n, pUp10: up10 / n, pDown10: dn10 / n, pDown20: dn20 / n,
      var95: -(Math.exp(q(0.05)) - 1), cvar95: -(tail / cut),
      mdd: mddSum / n, pMdd20: mdd20 / n,
      hist: { lo, hi, counts },
    };
  });
  const fq = [0.05, 0.25, 0.5, 0.75, 0.95];
  const fanOut = { days: [0, ...fanDays], q: fq.map(() => [S0]) };
  fan.forEach(arr => {
    const s = Float64Array.from(arr).sort();
    fq.forEach((v, i) => fanOut.q[i].push(S0 * Math.exp(quantileSorted(s, v))));
  });
  return { horizons, fan: fanOut, crashRate: crashCount / nPaths };
}
