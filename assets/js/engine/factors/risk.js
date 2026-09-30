// 9. 리스크: 소송·규제, 회계(베니시 M-점수·발생액), 유동성, 재무 부실, 꼬리위험, 블랙스완(시장 스트레스)
import { makeFactor, mergeByDate, ratio } from './base.js';
import { isNum, lin, soft, std, mean, quantile, sortedNums } from '../stats.js';
import { pct, spct, fixed, big } from '../format.js';
import { eventScore } from '../text.js';

export function beneish(a, b) {
  const R = x => x.accountsReceivable ?? x.receivables;
  const need = [R(a), R(b), a.totalRevenue, b.totalRevenue, a.totalAssets, b.totalAssets, a.netIncome, a.operatingCashFlow];
  if (!need.every(isNum) || b.totalRevenue <= 0 || a.totalRevenue <= 0) return null;
  const gm = x => (isNum(x.grossProfit) ? x.grossProfit / x.totalRevenue : isNum(x.costOfRevenue) ? 1 - x.costOfRevenue / x.totalRevenue : null);
  const DSRI = (R(a) / a.totalRevenue) / (R(b) / b.totalRevenue);
  const GMI = isNum(gm(a)) && isNum(gm(b)) && gm(a) !== 0 ? gm(b) / gm(a) : 1;
  const hard = x => (x.currentAssets ?? 0) + (x.netPPE ?? 0) + (x.availableForSaleSecurities ?? 0);
  const AQI = isNum(a.currentAssets) && isNum(b.currentAssets) ? (1 - hard(a) / a.totalAssets) / Math.max(1e-6, 1 - hard(b) / b.totalAssets) : 1;
  const SGI = a.totalRevenue / b.totalRevenue;
  const dep = x => x.reconciledDepreciation ?? x.depreciationAndAmortization;
  const DEPI = isNum(dep(a)) && isNum(dep(b)) && isNum(a.netPPE) && isNum(b.netPPE) ? (dep(b) / (dep(b) + b.netPPE)) / (dep(a) / (dep(a) + a.netPPE)) : 1;
  const SGAI = isNum(a.sellingGeneralAndAdministration) && isNum(b.sellingGeneralAndAdministration) ? (a.sellingGeneralAndAdministration / a.totalRevenue) / (b.sellingGeneralAndAdministration / b.totalRevenue) : 1;
  const lev = x => ((x.currentLiabilities ?? 0) + (x.longTermDebt ?? 0)) / x.totalAssets;
  const LVGI = lev(b) > 0 ? lev(a) / lev(b) : 1;
  const TATA = (a.netIncome - a.operatingCashFlow) / a.totalAssets;
  const clampR = x => (isNum(x) ? Math.max(0, Math.min(x, 5)) : 1);
  return -4.84 + 0.92 * clampR(DSRI) + 0.528 * clampR(GMI) + 0.404 * clampR(AQI) + 0.892 * clampR(SGI) + 0.115 * clampR(DEPI) - 0.172 * clampR(SGAI) + 4.679 * TATA - 0.327 * clampR(LVGI);
}

export function risk(A, ctx, ev) {
  const f = makeFactor('risk');
  const s = A.summary, ap = s.assetProfile || {}, fd = s.financialData || {}, now = ctx.nowMs;
  const isFin = ap.sector === 'Financial Services';
  const ann = mergeByDate(A.raw.fts?.annual), a0 = ann[ann.length - 1] || {}, a1 = ann[ann.length - 2] || {};

  if (A.kind !== 'index') {
    // 소송·규제
    const Lg = f.group('소송·규제 리스크', 1);
    const lit = (ev.lawsuit?.length || 0), inv = (ev.investigation?.length || 0), reg = (ev.regulation?.length || 0);
    Lg.add('소송·조사·제재 뉴스 (30일)', `소송 ${lit} · 조사 ${inv} · 규제 ${reg}`, lit + inv + reg ? eventScore(ev, ['lawsuit', 'investigation', 'regulation', 'recall'], now) : 0.3, '최신 기사일수록 가중');
    if (isNum(ap.boardRisk)) Lg.add('이사회·주주권 위험 (ISS)', `이사회 ${ap.boardRisk} · 주주권리 ${ap.shareHolderRightsRisk ?? '—'}`, lin((ap.boardRisk + (ap.shareHolderRightsRisk ?? ap.boardRisk)) / 2, 9, 2), '1(낮음)~10(높음)', 0.5);

    // 회계
    const Ac = f.group('회계 신뢰성', 1);
    const m = isFin ? null : beneish(a0, a1);
    Ac.add('베니시 M-점수 (이익 조작 가능성)', isNum(m) ? fixed(m, 2) : isFin ? '금융업 제외' : null, isNum(m) ? (m > -1.78 ? -1 : m > -2.22 ? -0.3 : 0.4) : null, '−1.78 초과 시 조작 가능성 높음 (8변수 모형)');
    const accr = isNum(a0.netIncome) && isNum(a0.operatingCashFlow) && a0.totalAssets > 0 ? (a0.netIncome - a0.operatingCashFlow) / a0.totalAssets : null;
    if (!isFin) Ac.add('발생액 비율 ((순이익−영업현금흐름)/총자산)', spct(accr), lin(accr, 0.10, -0.05), '높으면 현금 뒷받침 없는 이익 (이익의 질 낮음)');
    if (isNum(ap.auditRisk)) Ac.add('감사 위험 (ISS)', `${ap.auditRisk}/10`, lin(ap.auditRisk, 9, 2), '', 0.6);
    const accN = ev.accounting?.length || 0;
    Ac.add('회계 이슈 뉴스 (30일)', `${accN}건`, accN ? -1 : 0.2, '정정·감사인 사임·공매도 리포트 등');
    if (isNum(m) && m > -1.78) f.hi(`베니시 M-점수 ${fixed(m, 2)} — 회계 신뢰성 점검 필요`, -1);
  }

  // 유동성
  const Lq = f.group('유동성 리스크', 0.8);
  if (A.hasVolume) {
    const k = Math.min(60, A.n);
    let dv = 0, am = 0, zero = 0;
    for (let j = A.n - k; j < A.n; j++) { const d = A.c[j] * A.v[j]; dv += d; if (d > 0 && isNum(A.r[j])) am += Math.abs(A.r[j]) / d; if (A.v[j] === 0) zero++; }
    const adv = dv / k, fx = A.fx(A.currency) ?? A.fx(A.mcapCcy), advUSD = fx ? adv * fx : null;
    const advTxt = A.currency === 'GBp' ? big(adv / 100, 'GBP') : big(adv, A.currency);
    Lq.add('일평균 거래대금 (60일)', `${advTxt}${isNum(advUSD) && A.currency !== 'USD' ? ` (≈${big(advUSD, 'USD')})` : ''}`, isNum(advUSD) ? lin(Math.log10(advUSD), 5.5, 8) : null, '100만 달러 미만이면 유동성 위험');
    Lq.info('아미후드 비유동성', (am / k).toExponential(2), '거래대금 대비 가격 충격 (작을수록 유동적)');
    if (zero) Lq.add('거래 없는 날 (60일)', `${zero}일`, -soft(zero, 3), '');
  } else Lq.info('유동성', A.kind === 'index' ? '지수 — 해당 없음' : '거래량 데이터 없음', '');

  // 재무 부실
  if (A.kind !== 'index' && !isFin) {
    const Ds = f.group('재무 부실 위험', 0.8);
    const fcf = fd.freeCashflow, cash = fd.totalCash;
    if (isNum(fcf) && fcf < 0 && isNum(cash)) {
      const runway = cash / -fcf;
      Ds.add('현금 소진 기간 (현금/연간 FCF 적자)', `${fixed(runway, 1)}년`, lin(runway, 1, 4), '1.5년 미만이면 자금조달 필요성 → 희석 위험');
    } else Ds.add('잉여현금흐름', isNum(fcf) ? (fcf >= 0 ? '흑자' : '적자') : null, isNum(fcf) ? (fcf >= 0 ? 0.5 : -0.5) : null, '');
    const neg = isNum(a0.stockholdersEquity) && a0.stockholdersEquity < 0;
    if (neg) Ds.add('자본잠식', '자기자본 음수', -0.6, '자사주 매입으로 인한 경우도 있어 해석 주의', 0.6);
  }

  // 꼬리위험
  const Tl = f.group('꼬리위험 (극단적 하락)', 1);
  const r5 = A.r.slice(-1260).filter(isNum);
  if (r5.length > 250) {
    const sd = std(r5), s = sortedNums(r5);
    const cvar99 = mean(s.slice(0, Math.max(1, Math.floor(s.length * 0.01))));
    const big4 = r5.filter(x => x < -4 * sd).length;
    Tl.add('CVaR 99% (일간, 5년)', pct(cvar99, 1), lin(cvar99, -0.09, -0.03), '최악 1% 거래일의 평균 손실');
    Tl.add('4σ 이상 급락일 (5년)', `${big4}일 (정규분포 기대 ≈ 0일)`, lin(big4, 8, 0), '정규분포 가정보다 극단 사건이 잦은 정도');
    Tl.info('최악의 하루 (5년)', pct(s[0], 1), '');
  }

  // 블랙스완(시장 스트레스)
  const Bs = f.group('블랙스완 (시장 전체 스트레스)', 1.2);
  const bsv = ctx.blackSwan.value, bg = isNum(A.beta.global) ? Math.max(0.3, A.beta.global) : 1;
  Bs.add('블랙스완 위험 지수 × 시장 베타', `${fixed(bsv, 0)}/100 (${ctx.blackSwan.level}) × 베타 ${fixed(bg, 2)}`, lin(bsv * bg, 70, 20), '시장 스트레스 요인 합성 — 몬테카를로의 급락 점프 확률에 반영');
  for (const c of ctx.blackSwan.components.slice(0, 3)) Bs.info(`주요 스트레스: ${c.label}`, `${fixed(c.stress * 100, 0)}/100`, c.note);
  if (bsv >= 45) f.hi(`블랙스완 위험 지수 ${fixed(bsv, 0)} (${ctx.blackSwan.level})`, -1);
  return f.done();
}
