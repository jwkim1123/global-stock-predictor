// 변동성 모델: EWMA, GARCH(1,1) 최우추정, 표준화 잔차의 첨도로 t-분포 자유도 추정
import { isNum, mean, variance, exKurtosis, nelderMead, clamp } from './stats.js';

export function ewmaSigma(r, lambda = 0.94) {
  const x = r.filter(isNum);
  if (x.length < 30) return NaN;
  let v = variance(x.slice(0, 30));
  for (const y of x.slice(30)) v = lambda * v + (1 - lambda) * y * y;
  return Math.sqrt(v);
}

const sigm = z => 1 / (1 + Math.exp(-z));
const logit = p => Math.log(p / (1 - p));

// 분산 목표화(variance targeting) GARCH(1,1): ω = σ²(1-α-β)
export function garchFit(returns, window = 756) {
  const x = returns.filter(isNum).slice(-window);
  if (x.length < 250) return null;
  const m = mean(x), r = x.map(v => v - m), vs = variance(r);
  const decode = z => { const a = 0.3 * sigm(z[0]); const b = (0.998 - a) * sigm(z[1]); return [a, b]; };
  const nll = z => {
    const [a, b] = decode(z), w = vs * (1 - a - b);
    let h = vs, ll = 0;
    for (const e of r) { ll += Math.log(h) + (e * e) / h; h = w + a * e * e + b * h; }
    return ll / 2;
  };
  const opt = nelderMead(nll, [logit(0.08 / 0.3), logit(0.9 / 0.918)], { maxIter: 300, tol: 1e-7 });
  const [alpha, beta] = decode(opt.x), omega = vs * (1 - alpha - beta);
  let h = vs; const z = [];
  for (const e of r) { z.push(e / Math.sqrt(h)); h = omega + alpha * e * e + beta * h; }
  return { alpha, beta, omega, persistence: alpha + beta, longRunVar: vs, hNext: h, z };
}

// h=1..T 일별 σ 경로 (장기분산으로 평균회귀)
export function garchPath(fit, T) {
  const out = new Float64Array(T);
  const p = fit.persistence, VL = fit.longRunVar;
  let v = fit.hNext;
  for (let t = 0; t < T; t++) { out[t] = Math.sqrt(Math.max(v, 1e-10)); v = VL + p * (v - VL); }
  return out;
}

export function tDof(z) {
  const k = exKurtosis(z);
  if (!isNum(k) || k <= 0.05) return 30;
  return clamp(4 + 6 / k, 3, 30);
}

// Hurst 지수 (R/S 분석): >0.5 추세 지속, <0.5 평균회귀
export function hurst(r) {
  const x = r.filter(isNum);
  if (x.length < 200) return NaN;
  const sizes = [16, 32, 64, 128].filter(s => s * 2 <= x.length);
  const pts = [];
  for (const s of sizes) {
    const rs = [];
    for (let i = 0; i + s <= x.length; i += s) {
      const seg = x.slice(i, i + s), m = mean(seg);
      let cum = 0, mx = -Infinity, mn = Infinity, ss = 0;
      for (const v of seg) { cum += v - m; mx = Math.max(mx, cum); mn = Math.min(mn, cum); ss += (v - m) ** 2; }
      const sd = Math.sqrt(ss / s);
      if (sd > 0) rs.push((mx - mn) / sd);
    }
    if (rs.length) pts.push([Math.log(s), Math.log(mean(rs))]);
  }
  if (pts.length < 3) return NaN;
  const mx = mean(pts.map(p => p[0])), my = mean(pts.map(p => p[1]));
  let num = 0, den = 0;
  for (const [a, b] of pts) { num += (a - mx) * (b - my); den += (a - mx) ** 2; }
  return num / den;
}
