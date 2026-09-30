// 3. 거시경제: 글로벌 거시 레짐 + 자국 시장 환경 + 종목의 실증 거시 민감도(금리·환율 베타)
import { makeFactor } from './base.js';
import { isNum, lin, soft, sma, pctChange, diffChange, alignTo, weeklyReturns, beta as betaOf, lastOf } from '../stats.js';
import { spct, fixed, signed, pct } from '../format.js';

// 금리 민감도: 2년 실증 베타는 국면 특이적 동행(예: 성장 호황기 금리·주가 동반 상승)에 오염되기 쉬워
// 업종별 이론적 사전값(주식 듀레이션)과 50:50으로 혼합합니다.
export function rateBeta(A, ctx) {
  const tnxW = weeklyReturns(alignTo(A.t, ctx.series['^TNX'], 'c', 5).map(x => Math.exp(x / 100)), 104).map(x => x * 100);
  const emp = betaOf(A.wk, tnxW);
  const sec = A.summary?.assetProfile?.sector;
  const prior = A.kind === 'index' ? -0.03 : sec === 'Financial Services' ? 0.01
    : ['Technology', 'Communication Services', 'Real Estate', 'Utilities', 'Consumer Cyclical'].includes(sec) ? -0.045 : -0.025;
  return { emp, prior, beta: isNum(emp) ? 0.5 * emp + 0.5 * prior : prior };
}

export function macroFactor(A, ctx) {
  const f = makeFactor('macro');
  const G = f.group('글로벌 거시 환경', 1.5);
  for (const g of ctx.macro.groups) G.add(g.group, isNum(g.score) ? signed(g.score, 2) : null, g.score, groupNote(g.group, ctx));

  // 자국 시장
  const L = f.group(`${A.M.name} 시장 환경`, 1);
  if (A.kind !== 'index') {
    const b = A.bench.filter(isNum), m = sma(b, 200), d = b[b.length - 1] / m[m.length - 1] - 1;
    L.add(`${A.benchSym} 200일선 이격`, spct(d), lin(d, -0.08, 0.08), '자국 대표 지수의 장기 추세');
  }
  if (A.M.fx) {
    const fx3 = pctChange(ctx.series[A.M.fx], 91);
    L.add(`${A.M.ccy} 환율 (달러당, 3개월)`, spct(fx3), lin(fx3, 0.05, -0.05), '상승 = 자국통화 약세 → 외국인 자금 이탈 압력');
  } else {
    const dxy = pctChange(ctx.series['DX-Y.NYB'], 91);
    L.add('달러 인덱스 (3개월)', spct(dxy), lin(dxy, 0.06, -0.06), '달러 강세는 미국 다국적 기업 이익에 부담', 0.6);
  }
  const rfS = A.M.rf && A.M.rf !== 'US' && ctx.fred[A.M.rf] ? { t: ctx.fred[A.M.rf].t, c: ctx.fred[A.M.rf].v } : A.M.rf === 'US' ? ctx.series['^IRX'] : null;
  const dRate = rfS ? diffChange(rfS, 182) : null;
  L.add('자국 단기금리 변화 (6개월)', isNum(dRate) ? `${signed(dRate)}%p (현재 ${fixed(lastOf(rfS)?.value, 2)}%)` : null, lin(dRate, 0.75, -0.75), '금리 인하 국면은 주식에 우호적');

  // 실증 민감도
  const S = f.group('거시 민감도 (2년 주간 회귀)', 1.2);
  const wk = A.wk;
  const rb = rateBeta(A, ctx);
  const dT = diffChange(ctx.series['^TNX'], 91);
  if (isNum(dT)) {
    const im = rb.beta * dT * 0.5;
    S.add(`금리 민감도 (10년물 1%p당 ${spct(rb.beta)})`, `최근 3개월 ${signed(dT)}%p → 영향 ${spct(im)}`, soft(im, 0.04),
      `실증 베타 ${spct(rb.emp)}와 업종 이론값 ${spct(rb.prior)}의 평균. 금리 추세 절반 지속 가정`);
  }
  const fxSym = A.M.fx || 'DX-Y.NYB';
  const fxW = weeklyReturns(alignTo(A.t, ctx.series[fxSym], 'c', 5), 104);
  const bFx = betaOf(wk, fxW), fx3 = pctChange(ctx.series[fxSym], 91);
  if (isNum(bFx) && isNum(fx3)) {
    const im = bFx * Math.log(1 + fx3) * 0.5;
    S.add(`환율 민감도 (${fxSym} 베타 ${fixed(bFx, 2)})`, `환율 3개월 ${spct(fx3)} → 영향 ${spct(im)}`, soft(im, 0.04), A.M.fx ? '양(+)이면 자국통화 약세 수혜(수출주 성격)' : '달러 강세 시 반응');
  }
  const bG = A.beta.global;
  if (isNum(bG)) S.add(`시장 베타 × 거시 방향`, `베타 ${fixed(bG, 2)} × 거시점수 ${signed(ctx.macro.score, 2)}`, soft((bG - 1) * ctx.macro.score * 2, 1), '고베타 종목은 거시 환경 변화에 증폭 반응', 0.6);
  f.hi(`글로벌 거시 환경: ${ctx.macro.regime} (${signed(ctx.macro.score, 2)})`, ctx.macro.score > 0.05 ? 1 : ctx.macro.score < -0.05 ? -1 : 0);
  return f.done();
}

function groupNote(g, ctx) {
  const its = ctx.macro.items.filter(i => i.group === g && i.value).slice(0, 2);
  return its.map(i => `${i.label} ${i.value}`).join(' · ');
}
