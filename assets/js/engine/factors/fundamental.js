// 1. 기업 펀더멘털: 실적·밸류에이션·재무건전성·수익성·성장성·지배구조·경쟁우위
import { makeFactor, mergeByDate, growth, ratio, quarterLabel } from './base.js';
import { isNum, lin, soft, median, std, clamp, idxAtOrBefore } from '../stats.js';
import { SECTORS } from '../config.js';
import { pct, spct, pp, times, fixed, big } from '../format.js';

const LN = Math.log;

export function fundamental(A, ctx) {
  if (A.kind === 'index') return indexFundamental(A, ctx);
  const f = makeFactor('fundamental');
  const s = A.summary, fd = s.financialData || {}, sd = s.summaryDetail || {}, ks = s.defaultKeyStatistics || {}, ap = s.assetProfile || {};
  const isFin = ap.sector === 'Financial Services';
  const ann = mergeByDate(A.raw.fts?.annual), q = mergeByDate(A.raw.fts?.quarterly);
  const a0 = ann[ann.length - 1] || {}, a1 = ann[ann.length - 2] || {};
  const q0 = q[q.length - 1] || {}, qPrev = q[q.length - 2] || {};
  const qYoY = q0.date ? q.find(r => Math.abs((Date.parse(q0.date) - Date.parse(r.date)) / 864e5 - 365) < 45) : null;
  const sec = SECTORS[ap.sector], secVal = sec ? ctx.sectorVal[sec.etf] : null, uni = ctx.peerStats?.(ap);
  const fxM = A.fx(A.mcapCcy), fxF = A.fx(A.finCcy);
  const mcapUSD = isNum(A.marketCap) && fxM ? A.marketCap * fxM : null;
  const mcapFin = isNum(mcapUSD) && fxF ? mcapUSD / fxF : null;          // 시가총액(재무통화 환산)

  // ---- 실적 ----
  const E = f.group('실적 (매출·이익 성장)', 1.2);
  const qLbl = q0.date ? quarterLabel(q0.date) : '';
  const revY = growth(q0.totalRevenue, qYoY?.totalRevenue) ?? fd.revenueGrowth ?? null;
  E.add('매출 성장률 (전년 동기 대비)', spct(revY), lin(revY, -0.10, 0.25), qLbl ? `${qLbl} 기준` : '최근 분기 기준', 1.2);
  const opY = yoyWithTurn(q0.operatingIncome, qYoY?.operatingIncome);
  E.add('영업이익 성장률 (전년 동기 대비)', opY.text, opY.score, opY.note, 1.2);
  const niY = yoyWithTurn(q0.netIncome, qYoY?.netIncome, fd.earningsGrowth);
  E.add('순이익 성장률 (전년 동기 대비)', niY.text, niY.score, niY.note);
  const revQ = growth(q0.totalRevenue, qPrev.totalRevenue);
  E.add('매출 성장률 (전분기 대비)', spct(revQ), lin(revQ, -0.10, 0.10), '계절성 영향 가능', 0.5);
  const opQ = yoyWithTurn(q0.operatingIncome, qPrev.operatingIncome);
  E.add('영업이익 성장률 (전분기 대비)', opQ.text, isNum(opQ.score) ? opQ.score * 0.8 : null, '계절성 영향 가능', 0.5);
  const hist = (s.earningsHistory?.history || []).filter(h => isNum(h.surprisePercent));
  if (hist.length) {
    const avgS = hist.reduce((a, h) => a + clamp(h.surprisePercent, -0.5, 0.5), 0) / hist.length;
    const beats = hist.filter(h => h.surprisePercent > 0).length;
    E.add('EPS 서프라이즈 (최근 4분기)', `평균 ${spct(avgS)} · ${beats}/${hist.length}회 상회`, 0.6 * lin(avgS, -0.05, 0.08) + 0.4 * lin(beats / hist.length, 0.25, 1), '컨센서스 대비 실제 EPS');
    if (beats === hist.length && hist.length >= 4) f.hi(`최근 ${hist.length}분기 연속 실적이 컨센서스를 상회`, 1);
  } else E.add('EPS 서프라이즈 (최근 4분기)', null, null);
  if (isNum(revY) && revY > 0.3) f.hi(`매출이 전년 대비 ${spct(revY, 0)} 급성장`, 1);
  if (isNum(revY) && revY < -0.1) f.hi(`매출이 전년 대비 ${spct(revY, 0)} 감소`, -1);

  // ---- 밸류에이션 ----
  const V = f.group('밸류에이션 (동종업계 대비)', 1.2);
  const peerQ = (A.raw.peers || []).map(p => ctx.peerQuotes[p]).filter(Boolean);
  const peerPE = median(peerQ.map(p => (p.trailingPE > 0 && p.trailingPE < 300 ? p.trailingPE : NaN)));
  const peerPB = median(peerQ.map(p => (p.priceToBook > 0 && p.priceToBook < 100 ? p.priceToBook : NaN)));
  const geo = arr => { const v = arr.filter(x => isNum(x) && x > 0); return v.length ? Math.exp(v.reduce((a, x) => a + LN(x), 0) / v.length) : NaN; };
  const ttmNI = ks.netIncomeToCommon;
  // 후행 PER 누락 시: 주가/EPS → 시가총액/순이익(재무통화 환산) 순으로 대체
  const pe = sd.trailingPE ?? (ks.trailingEps > 0 && A.finCcy === A.currency ? A.price / ks.trailingEps : null)
    ?? (isNum(ttmNI) && ttmNI > 0 && isNum(mcapFin) ? mcapFin / ttmNI : null);
  const benchPE = geo([secVal?.pe, peerPE]);
  if (isNum(pe) && pe > 0) {
    const rel = LN(pe / benchPE);
    V.add('PER (주가수익비율)', `${times(pe)} (비교군 ${times(benchPE)})`, isNum(rel) ? -soft(rel, 0.45) : null,
      `업종 ETF ${sec?.etf || '—'} ${times(secVal?.pe)} · 유사기업 중앙값 ${times(peerPE)}`, 1.2);
  } else if (isNum(ttmNI) && ttmNI < 0) V.add('PER (주가수익비율)', '적자 (산출 불가)', -0.4, '최근 12개월 순손실', 1.2);
  else V.add('PER (주가수익비율)', null, null, '', 1.2);
  const pb = ks.priceToBook, benchPB = geo([secVal?.pb, peerPB]);
  V.add('PBR (주가순자산비율)', isNum(pb) ? `${times(pb, 2)} (비교군 ${times(benchPB, 2)})` : null, isNum(pb) && pb > 0 && isNum(benchPB) ? -soft(LN(pb / benchPB), 0.5) : null,
    isFin ? '금융업은 PBR이 핵심 지표' : 'ROE가 높으면 높은 PBR이 정당화될 수 있음', isFin ? 1.3 : 0.8);
  const ps = sd.priceToSalesTrailing12Months;
  V.add('PSR (주가매출비율)', isNum(ps) ? `${times(ps, 2)} (업종 ${times(secVal?.ps, 2)})` : null, isNum(ps) && ps > 0 && isNum(secVal?.ps) ? -soft(LN(ps / secVal.ps), 0.5) : null, '매출 대비 시가총액', isFin ? 0.3 : 0.7);
  const eve = ks.enterpriseToEbitda;
  if (!isFin) V.add('EV/EBITDA', isNum(eve) ? `${times(eve)}${isNum(uni?.evEbitda) ? ` (${uni.level} 중앙값 ${times(uni.evEbitda)})` : ''}` : null,
    isNum(eve) && eve > 0 ? -soft(LN(eve / (isNum(uni?.evEbitda) ? Math.sqrt(uni.evEbitda * 12) : 12)), 0.5) : isNum(eve) ? -0.5 : null, '부채를 포함한 기업가치 대비 현금창출력');
  const tr = s.earningsTrend?.trend || [];
  const t1y = tr.find(x => x.period === '+1y'), t0y = tr.find(x => x.period === '0y');
  const g1 = t1y?.earningsEstimate?.growth ?? t1y?.growth;
  const fpe = sd.forwardPE ?? ks.forwardPE;
  const peg = isNum(fpe) && fpe > 0 && isNum(g1) && g1 > 0.01 ? fpe / (g1 * 100) : null;
  V.add('PEG (성장 대비 PER)', isNum(peg) ? fixed(peg, 2) : null, lin(peg, 2.5, 0.8), `선행 PER ${times(fpe)} ÷ 내년 EPS 성장률 ${pct(g1)}`, 0.8);
  const fcf = fd.freeCashflow, fcfY = isNum(fcf) && isNum(mcapFin) && mcapFin > 0 ? fcf / mcapFin : null;
  V.add('FCF 수익률 (잉여현금흐름/시총)', pct(fcfY), lin(fcfY, 0, 0.06), '높을수록 현금창출력 대비 저평가');
  // 자기 과거 대비 PER (회계연도 말 주가 ÷ 연간 EPS)
  const histPE = ann.map(r => {
    const d = Math.floor(Date.parse(r.date) / 864e5), i = idxAtOrBefore(A.t, d);
    return i >= 0 && r.dilutedEPS > 0 ? A.c[i] / r.dilutedEPS : NaN;
  }).filter(x => isNum(x) && x < 300);
  if (histPE.length >= 3 && isNum(pe) && pe > 0) {
    const mp = median(histPE);
    V.add('과거 평균 대비 PER', `${times(pe)} vs 과거 중앙값 ${times(mp)}`, -soft(LN(pe / mp), 0.45), `최근 ${histPE.length}개 회계연도 말 기준 (환율·분할 영향 가능)`, 0.7);
  }
  if (isNum(fpe) && isNum(pe) && pe > 0 && fpe > 0) V.add('선행 PER / 후행 PER', `${times(fpe)} / ${times(pe)}`, lin(fpe / pe - 1, 0.15, -0.3), '선행 PER이 낮으면 이익 증가 기대', 0.5);

  // ---- 재무 건전성 ----
  const Hh = f.group('재무 건전성', 1);
  if (!isFin) {
    const debtR = ratio(a0.totalLiabilitiesNetMinorityInterest ?? q0.totalLiabilitiesNetMinorityInterest, a0.stockholdersEquity ?? q0.stockholdersEquity);
    const bsQ = q0.totalAssets ? q0 : a0;
    const debtRq = ratio(bsQ.totalLiabilitiesNetMinorityInterest, bsQ.stockholdersEquity) ?? debtR;
    Hh.add('부채비율 (총부채/자기자본)', isNum(debtRq) ? pct(debtRq, 0) : null, isNum(debtRq) && debtRq < 0 ? -1 : lin(debtRq, 2.5, 0.5), '100% 이하 안정, 200% 초과 주의');
    const de = isNum(fd.debtToEquity) ? fd.debtToEquity / 100 : null;
    Hh.add('차입금/자기자본 (D/E)', isNum(de) ? times(de, 2) : null, lin(de, 2.0, 0.3), '이자부 부채 기준', 0.6);
    Hh.add('유동비율', isNum(fd.currentRatio) ? times(fd.currentRatio, 2) : null, lin(fd.currentRatio, 0.8, 2.0), '1배 미만이면 단기 지급능력 주의', 0.8);
    const intExp = Math.abs(a0.interestExpense || 0), ebit = a0.EBIT ?? a0.operatingIncome;
    const icr = intExp > 0 && isNum(ebit) ? ebit / intExp : null;
    Hh.add('이자보상배율 (EBIT/이자비용)', isNum(icr) ? times(icr, 1) : intExp === 0 && isNum(ebit) ? '이자비용 없음' : null, isNum(icr) ? lin(icr, 1.5, 12) : intExp === 0 && ebit > 0 ? 1 : null, '1.5배 미만이면 이자 부담 위험', 0.8);
    const z = altmanZ(a0, mcapFin);
    Hh.add('알트만 Z-점수 (부도 위험)', isNum(z) ? fixed(z, 2) : null, lin(z, 1.8, 3.0), '3.0 초과 안전 · 1.8 미만 부실 위험');
    if (isNum(z) && z < 1.8) f.hi(`알트만 Z-점수 ${fixed(z, 2)} — 재무 부실 위험 구간`, -1);
  } else {
    const eqTa = ratio(a0.stockholdersEquity, a0.totalAssets);
    Hh.add('자기자본/총자산 (레버리지)', pct(eqTa), lin(eqTa, 0.05, 0.12), '금융업은 부채비율 대신 자본 적정성으로 평가');
  }
  const fcfM = ratio(fd.freeCashflow, fd.totalRevenue);
  Hh.add('FCF 마진 (잉여현금흐름/매출)', pct(fcfM), lin(fcfM, -0.05, 0.20), isFin ? '금융업은 참고용' : '양(+)의 FCF는 배당·투자 여력', isFin ? 0.3 : 1);
  const netCash = isNum(fd.totalCash) && isNum(fd.totalDebt) && isNum(mcapFin) && mcapFin > 0 ? (fd.totalCash - fd.totalDebt) / mcapFin : null;
  if (!isFin) Hh.add('순현금/시가총액', spct(netCash), lin(netCash, -0.5, 0.2), '(현금 − 차입금) ÷ 시총', 0.7);
  const fs = piotroski(a0, a1);
  Hh.add('피오트로스키 F-점수', isNum(fs.score) ? `${fs.score}/9` : null, isNum(fs.score) ? (fs.score - 4.5) / 4.5 : null, fs.note);

  // ---- 수익성 ----
  const P = f.group('수익성', 1);
  const roe = fd.returnOnEquity;
  P.add('ROE (자기자본이익률)', pct(roe), isNum(roe) ? lin(Math.min(roe, 0.6), 0, 0.25) : null, '15% 이상 우수');
  P.add('ROA (총자산이익률)', pct(fd.returnOnAssets), isFin ? lin(fd.returnOnAssets, 0, 0.015) : lin(fd.returnOnAssets, 0, 0.12), isFin ? '금융업 1% 이상 우수' : '');
  P.add('영업이익률', pct(fd.operatingMargins), lin(fd.operatingMargins, 0, 0.30), isNum(uni?.opMargin) ? `유니버스 동종 중앙값 ${pct(uni.opMargin)}` : '', isFin ? 0.5 : 1);
  P.add('순이익률', pct(fd.profitMargins), lin(fd.profitMargins, -0.05, 0.25));
  const taxR = isNum(a0.taxProvision) && isNum(a0.pretaxIncome) && a0.pretaxIncome > 0 ? clamp(a0.taxProvision / a0.pretaxIncome, 0, 0.4) : 0.22;
  const roic = isNum(a0.EBIT) && isNum(a0.investedCapital) && a0.investedCapital > 0 ? (a0.EBIT * (1 - taxR)) / a0.investedCapital : null;
  if (!isFin) P.add('ROIC (투하자본이익률)', pct(roic), lin(roic, 0.03, 0.20), '자본비용(약 8%)을 넘으면 가치 창출');
  const om0 = ratio(a0.operatingIncome, a0.totalRevenue), om1 = ratio(a1.operatingIncome, a1.totalRevenue);
  const dOm = isNum(om0) && isNum(om1) ? om0 - om1 : null;
  P.add('영업이익률 변화 (전년 대비)', pp(dOm), lin(dOm, -0.05, 0.05), '마진 개선 = 가격결정력·효율 향상', 0.7);

  // ---- 성장성 ----
  const G = f.group('성장성', 1);
  const revs = ann.filter(r => isNum(r.totalRevenue) && r.totalRevenue > 0);
  if (revs.length >= 3) {
    const k = Math.min(3, revs.length - 1), cagr = (revs[revs.length - 1].totalRevenue / revs[revs.length - 1 - k].totalRevenue) ** (1 / k) - 1;
    G.add(`매출 연평균 성장률 (${k}년)`, pct(cagr), lin(cagr, -0.05, 0.25), '');
  } else G.add('매출 연평균 성장률', null, null);
  G.add('내년 EPS 성장 전망', pct(g1), lin(g1, -0.05, 0.25), `애널리스트 ${t1y?.earningsEstimate?.numberOfAnalysts ?? '—'}명 컨센서스`);
  const rg1 = t1y?.revenueEstimate?.growth ?? t0y?.revenueEstimate?.growth;
  G.add('매출 성장 전망', pct(rg1), lin(rg1, -0.05, 0.20), '');
  if (isNum(revY) && isNum(uni?.revGrowth)) {
    const gap = revY - uni.revGrowth;
    G.add('시장점유율 변화 (프록시)', pp(gap), lin(gap, -0.15, 0.15), `매출 성장률 − 분석 대상 중 ${uni.level} ${uni.n}곳 중앙값(${pct(uni.revGrowth)})`, uni.level === '동일 산업' ? 0.8 : 0.5);
  } else G.add('시장점유율 변화 (프록시)', null, null, '동종 비교군 부족', 0.5);
  const rnd = ratio(a0.researchAndDevelopment, a0.totalRevenue);
  const rndMatters = ['Technology', 'Healthcare', 'Communication Services'].includes(ap.sector);
  if (isNum(rnd)) G.add('R&D 투자 강도 (파이프라인 프록시)', pct(rnd), rndMatters ? lin(rnd, 0.02, 0.15) : null, '신제품·신사업 파이프라인의 대리지표', rndMatters ? 0.7 : 0);
  else G.info('R&D 투자 강도', null, '공시 항목 없음');

  // ---- 경영진·지배구조·주주환원 ----
  const Mg = f.group('경영진·지배구조·주주환원', 0.8);
  if (isNum(ap.overallRisk)) Mg.add('지배구조 위험 (ISS, 1~10)', `${ap.overallRisk} (감사 ${ap.auditRisk ?? '—'}, 이사회 ${ap.boardRisk ?? '—'}, 보상 ${ap.compensationRisk ?? '—'})`, lin(ap.overallRisk, 9, 2), '낮을수록 양호');
  const div = -(a0.cashDividendsPaid || 0), rep = -(a0.repurchaseOfCapitalStock || 0);
  const shy = isNum(mcapFin) && mcapFin > 0 && (div > 0 || rep > 0) ? (Math.max(div, 0) + Math.max(rep, 0)) / mcapFin : isNum(mcapFin) ? 0 : null;
  Mg.add('주주환원율 (배당+자사주)/시총', pct(shy), lin(shy, 0, 0.06), `배당 ${big(div, A.finCcy)} · 자사주 ${big(rep, A.finCcy)} (최근 회계연도)`);
  const dv = A.raw.dividends || [], now = A.day;
  const sumDiv = (from, to) => dv.filter(([d]) => { const x = Date.parse(d) / 864e5; return x > now - from && x <= now - to; }).reduce((a, [, v]) => a + v, 0);
  const d12 = sumDiv(365, 0), d24 = sumDiv(730, 365);
  if (d12 > 0 || d24 > 0) Mg.add('배당 성장 (최근 12개월)', d24 > 0 ? spct(d12 / d24 - 1) : '신규 배당', d24 > 0 ? lin(d12 / d24 - 1, -0.15, 0.10) : 0.3, `배당수익률 ${pct(sd.dividendYield ?? sd.trailingAnnualDividendYield, 2)}`);
  if (isNum(sd.payoutRatio) && sd.payoutRatio > 0) Mg.add('배당성향', pct(sd.payoutRatio, 0), sd.payoutRatio > 1 ? -0.8 : sd.payoutRatio > 0.8 ? -0.3 : sd.payoutRatio >= 0.2 ? 0.3 : 0, '100% 초과 시 배당 지속성 의문', 0.5);
  const sh0 = a0.ordinarySharesNumber ?? a0.dilutedAverageShares, sh1 = a1.ordinarySharesNumber ?? a1.dilutedAverageShares;
  const dSh = growth(sh0, sh1);
  Mg.add('발행주식 수 변화 (전년 대비)', spct(dSh), lin(dSh, 0.04, -0.03), '감소 = 자사주 소각, 증가 = 희석', 0.8);
  const nsp = s.netSharePurchaseActivity;
  if (nsp && isNum(nsp.netPercentInsiderShares)) Mg.add('내부자 순매수 (6개월)', `${spct(nsp.netPercentInsiderShares, 2)} (매수 ${nsp.buyInfoCount ?? 0}건/매도 ${nsp.sellInfoCount ?? 0}건)`, lin(nsp.netPercentInsiderShares, -0.03, 0.01), '보유 주식 대비 순매수 비율');
  const inst = s.institutionOwnership?.ownershipList || [];
  if (inst.length) {
    const w = inst.reduce((a, o) => a + (o.pctHeld || 0), 0) || 1;
    const chg = inst.reduce((a, o) => a + (o.pctChange || 0) * (o.pctHeld || 0), 0) / w;
    Mg.add('대주주·기관 지분 변화 (상위 10곳)', spct(chg), lin(chg, -0.15, 0.15), '보유 비중 가중 평균 지분 증감률 (최근 보고 기준)', 0.6);
  }
  if (hist.length >= 3) Mg.add('경영 실행력 (실적 약속 이행)', `${hist.filter(h => h.surprisePercent >= 0).length}/${hist.length}분기 컨센서스 충족`, lin(hist.filter(h => h.surprisePercent >= 0).length / hist.length, 0.25, 1), '가이던스·컨센서스 달성 일관성', 0.6);
  if (isNum(ks.heldPercentInsiders)) Mg.info('내부자·대주주 지분율', pct(ks.heldPercentInsiders), '');

  // ---- 경쟁우위(모트) ----
  const W = f.group('경쟁우위(모트) 대리지표', 0.8);
  W.add('매출총이익률 (가격결정력)', pct(fd.grossMargins), isFin ? null : lin(fd.grossMargins, 0.2, 0.6), '높을수록 브랜드·기술 프리미엄');
  const roes = ann.map(r => ratio(r.netIncome, r.stockholdersEquity)).filter(isNum);
  if (roes.length >= 3) {
    const k = roes.filter(x => x >= 0.15).length;
    W.add('고수익성 지속 (ROE 15% 이상 연도)', `${k}/${roes.length}년`, (k / roes.length) * 2 - 1, '지속적 초과수익 = 해자 존재 신호');
  }
  const oms = ann.map(r => ratio(r.operatingIncome, r.totalRevenue)).filter(isNum);
  if (oms.length >= 3 && !isFin) W.add('영업이익률 안정성 (표준편차)', pp(std(oms)), lin(std(oms), 0.08, 0.01), '변동이 작을수록 사업 안정성 높음', 0.7);
  W.add('규모 (시가총액)', mcapUSD ? big(mcapUSD, 'USD') : null, isNum(mcapUSD) ? lin(Math.log10(mcapUSD), 9.5, 12) : null, '규모의 경제·진입장벽', 0.5);
  const cs = A.raw.insights?.companySnapshot;
  if (isNum(cs?.company?.innovativeness)) W.add('혁신성 (업종 대비)', `${fixed(cs.company.innovativeness, 2)} vs 업종 ${fixed(cs.sector?.innovativeness ?? 0.5, 2)}`, lin(cs.company.innovativeness - (cs.sector?.innovativeness ?? 0.5), -0.3, 0.3), '특허·R&D 기반 혁신 점수 (Yahoo 인사이트)', 0.6);

  if (isNum(pe) && isNum(benchPE) && pe > benchPE * 1.6) f.hi(`PER ${times(pe)}로 비교군(${times(benchPE)}) 대비 고평가`, -1);
  if (isNum(pe) && isNum(benchPE) && pe < benchPE * 0.65) f.hi(`PER ${times(pe)}로 비교군(${times(benchPE)}) 대비 저평가`, 1);
  return f.done();
}

function yoyWithTurn(now, prev, fallback) {
  if (isNum(now) && isNum(prev)) {
    if (prev <= 0 && now > 0) return { text: '흑자 전환', score: 0.9, note: '적자에서 흑자로 전환' };
    if (prev > 0 && now <= 0) return { text: '적자 전환', score: -1, note: '흑자에서 적자로 전환' };
    if (prev < 0 && now < 0) { const g = (now - prev) / Math.abs(prev); return { text: `적자 ${g > 0 ? '축소' : '확대'}`, score: lin(g, -0.5, 0.5) * 0.6, note: '적자 지속' }; }
    const g = now / prev - 1;
    return { text: spct(g), score: lin(g, -0.2, 0.3), note: '' };
  }
  if (isNum(fallback)) return { text: spct(fallback), score: lin(fallback, -0.2, 0.3), note: '분기 전년비 (Yahoo 제공치)' };
  return { text: null, score: null, note: '' };
}

function altmanZ(a, mveFin) {
  const TA = a.totalAssets, TL = a.totalLiabilitiesNetMinorityInterest;
  if (!isNum(TA) || TA <= 0 || !isNum(TL) || TL <= 0 || !isNum(mveFin)) return null;
  const WC = a.workingCapital ?? (isNum(a.currentAssets) && isNum(a.currentLiabilities) ? a.currentAssets - a.currentLiabilities : null);
  const RE = a.retainedEarnings, EBIT = a.EBIT ?? a.operatingIncome, S = a.totalRevenue;
  if (![WC, RE, EBIT, S].every(isNum)) return null;
  return 1.2 * WC / TA + 1.4 * RE / TA + 3.3 * EBIT / TA + 0.6 * mveFin / TL + 1.0 * S / TA;
}

function piotroski(a, b) {
  const need = ['netIncome', 'totalAssets', 'operatingCashFlow', 'totalRevenue'];
  if (!need.every(k => isNum(a[k]) && isNum(b[k]))) return { score: null, note: '2개년 재무제표 필요' };
  let s = 0, n = 0;
  const t = (cond) => { if (cond === null) return; n++; if (cond) s++; };
  const roaA = a.netIncome / a.totalAssets, roaB = b.netIncome / b.totalAssets;
  t(roaA > 0); t(a.operatingCashFlow > 0); t(roaA > roaB); t(a.operatingCashFlow / a.totalAssets > roaA);
  t(isNum(a.longTermDebt) && isNum(b.longTermDebt) ? a.longTermDebt / a.totalAssets <= b.longTermDebt / b.totalAssets : null);
  t(isNum(a.currentAssets) && isNum(a.currentLiabilities) && isNum(b.currentAssets) && isNum(b.currentLiabilities) ? a.currentAssets / a.currentLiabilities > b.currentAssets / b.currentLiabilities : null);
  const shA = a.ordinarySharesNumber ?? a.dilutedAverageShares, shB = b.ordinarySharesNumber ?? b.dilutedAverageShares;
  t(isNum(shA) && isNum(shB) ? shA <= shB * 1.005 : null);
  t(isNum(a.grossProfit) && isNum(b.grossProfit) ? a.grossProfit / a.totalRevenue > b.grossProfit / b.totalRevenue : null);
  t(a.totalRevenue / a.totalAssets > b.totalRevenue / b.totalAssets);
  if (n < 6) return { score: null, note: '항목 부족' };
  const score = Math.round((s / n) * 9);
  return { score, note: '수익성·재무·효율 9개 항목 개선 여부 (7점 이상 우량)' };
}

// 지수: 대표 ETF 포트폴리오 밸류에이션으로 평가
function indexFundamental(A, ctx) {
  const f = makeFactor('fundamental');
  const v = ctx.indexVal[A.symbol];
  const V = f.group('지수 밸류에이션 (대표 ETF 기준)', 1.5);
  const Y = f.group('주식 vs 채권 매력도', 1);
  if (!v) { V.add('PER', null, null, '대표 ETF 없음'); return f.done(); }
  const gv = ctx.globalVal;
  V.add('PER', `${times(v.pe)} (주요국 평균 ${times(gv.pe)})`, isNum(v.pe) && isNum(gv.pe) ? -soft(LN(v.pe / gv.pe), 0.45) : null, `${v.proxy} 편입종목 기준`, 1.2);
  V.add('PBR', `${times(v.pb, 2)} (주요국 평균 ${times(gv.pb, 2)})`, isNum(v.pb) && isNum(gv.pb) ? -soft(LN(v.pb / gv.pb), 0.5) : null, '');
  V.add('PSR', times(v.ps, 2), isNum(v.ps) ? -soft(LN(v.ps / 2.0), 0.6) : null, '', 0.5);
  V.add('배당수익률', pct(v.yield, 2), lin(v.yield, 0.005, 0.04), '', 0.6);
  const rf = ctx.rf[A.market]?.rate;
  const ey = isNum(v.pe) && v.pe > 0 ? 1 / v.pe : null;
  Y.add('이익수익률 − 단기금리', isNum(ey) && isNum(rf) ? pp(ey - rf) : null, isNum(ey) && isNum(rf) ? lin(ey - rf, -0.01, 0.06) : null, `이익수익률 ${pct(ey)} vs ${ctx.rf[A.market]?.src || ''} ${pct(rf)}`);
  if (isNum(v.pe) && isNum(gv.pe) && v.pe > gv.pe * 1.3) f.hi(`PER ${times(v.pe)} — 주요국 평균(${times(gv.pe)}) 대비 고평가`, -1);
  if (isNum(v.pe) && isNum(gv.pe) && v.pe < gv.pe * 0.75) f.hi(`PER ${times(v.pe)} — 주요국 평균(${times(gv.pe)}) 대비 저평가`, 1);
  return f.done();
}
