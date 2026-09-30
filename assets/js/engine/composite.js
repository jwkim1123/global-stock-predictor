// 종합 점수: 투자기간별 가중치 × 요인 신뢰도(데이터 확보율)로 가중평균
import { WEIGHTS, FACTORS } from './config.js';

export function composite(factors, H, override) {
  const W = override || WEIGHTS[H];
  let s = 0, w = 0;
  const eff = {};
  for (const { key } of FACTORS) {
    const fc = factors[key];
    if (!fc) continue;
    const e = (W[key] || 0) * Math.max(0, Math.min(1, fc.confidence));
    eff[key] = e; s += e * fc.score; w += e;
  }
  const weights = {}, contrib = {};
  for (const k of Object.keys(eff)) { weights[k] = w > 0 ? eff[k] / w : 0; contrib[k] = w > 0 ? (eff[k] * factors[k].score) / w : 0; }
  return { score: w > 0 ? s / w : 0, weights, contrib };
}
