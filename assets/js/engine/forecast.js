// 예측 입력 구성: 변동성 경로 + 기대수익(CAPM 기준선 + 요인 알파 + 검증된 ML 알파) + 블랙스완·실적 점프
import { HORIZONS, IC_PRIOR, EQUITY_RISK_PREMIUM, CRASH_BASE_INTENSITY, CRASH_MEAN, CRASH_SD } from './config.js';
import { garchPath } from './volatility.js';
import { isNum, clamp, hashSeed } from './stats.js';

const T = 250;

// ML 반영 비중: 겹치는 표본으로 부풀려진 IC를 유효 표본 수로 축소하고,
// 방향 적중률이 '항상 상승' 가정보다 낮으면 비중을 절반으로 줄입니다. (최대 50%)
export function mlWeight(m, H) {
  if (!m || !isNum(m.ic)) return 0;
  const nEff = (m.nOOS * 5) / H;
  const icAdj = m.ic * (nEff / (nEff + 20));
  let w = 0.5 * clamp(icAdj / 0.10, 0, 1);
  if (isNum(m.hit) && isNum(m.baseHit) && m.hit < m.baseHit - 0.02) w *= 0.5;
  return w;
}

export function forecastInputs(A, ctx, factors, comps, ml) {
  const vol = factors.quant.vol;
  const sdDaily = isNum(vol.ewma) ? vol.ewma : (vol.hv60 || 0.3) / Math.sqrt(252);
  let sig = vol.garchObj && vol.garchObj.persistence < 0.9995 ? garchPath(vol.garchObj, T) : new Float64Array(T).fill(sdDaily);
  sig = sig.map(s => clamp(s, 0.003, 0.08));
  if (isNum(vol.iv) && vol.iv > 0.05 && vol.iv < 3) {
    const ivd = vol.iv / Math.sqrt(252);
    sig = sig.map((s, t) => { const w = t < 21 ? 0.5 : t < 63 ? (0.5 * (63 - t)) / 42 : 0; return Math.sqrt((1 - w) * s * s + w * ivd * ivd); });
  }
  const stress = 1 + (0.3 * Math.max(0, ctx.blackSwan.value - 50)) / 50;
  sig = sig.map(s => s * stress);

  const beta = clamp(isNum(A.beta.global) ? A.beta.global : 1, 0.3, 2.5);
  const rf = ctx.rf[A.market]?.rate ?? 0.03;
  const baseAnnual = rf + beta * EQUITY_RISK_PREMIUM;
  const alphaByH = {}, alphaParts = {};
  let cum = 0, t = 0;
  for (const H of HORIZONS) {
    for (; t < H; t++) cum += sig[t] ** 2;
    const sH = Math.sqrt(cum);
    // Grinold: α = IC × σ_H × z. 요인 z와 ML z를 검증된 비중으로 결합해 같은 척도에서 알파를 계산
    const zF = clamp(comps[H].score * 2.5, -2.5, 2.5);
    const m = ml?.[H];
    const wML = mlWeight(m, H);
    const zML = m && isNum(m.z) ? m.z : 0;
    const z = (1 - wML) * zF + wML * zML;
    alphaByH[H] = IC_PRIOR[H] * sH * z;
    alphaParts[H] = { factor: IC_PRIOR[H] * sH * zF, ml: m ? IC_PRIOR[H] * sH * zML : null, zF, zML: m ? zML : null, wML, sigmaH: sH, z, signalScore: z / 2.5 };
  }
  const crash = { lambdaBase: CRASH_BASE_INTENSITY, mult: ctx.blackSwan.lambdaMult, mean: CRASH_MEAN, sd: CRASH_SD, beta, idio: 0.04 };
  const earnings = [];
  const cat = factors.catalyst;
  if (cat?.earnDay && isNum(cat.reaction?.excessSd)) for (let d = cat.earnDay; d <= T; d += 63) earnings.push({ day: d, sd: +cat.reaction.excessSd.toFixed(5) });
  return {
    S0: A.price, sigmas: Array.from(sig, x => +x.toFixed(6)), nu: +vol.nu.toFixed(2), baseAnnual, rf, beta,
    alphaByH, alphaParts, crash, earnings, seed: hashSeed(`${A.symbol}:${A.day}`),
  };
}
