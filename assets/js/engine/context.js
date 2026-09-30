// 전세계 공통 시장 환경: 거시경제 레짐, 공포·탐욕 지수, 블랙스완 위험 지수, 무위험금리, 업종·국가 밸류에이션
import { isNum, clamp, lin, mean, sma, lastOf, valueDaysAgo, pctChange, diffChange, percentileRank, wmean, weeklyReturns, corr, idxAtOrBefore, alignTo } from './stats.js';
import { MARKETS, SECTORS, SCHEDULED_EVENTS } from './config.js';
import { detectEvents, newsTone } from './text.js';
import { pct, spct, fixed, signed } from './format.js';

const inv = x => (isNum(x) && x > 0 ? (x < 1 ? 1 / x : x) : null);

function spark(series, days = 400, key = 'c') {
  if (!series?.t?.length) return null;
  const vals = series[key] || series.v || series.c;
  const last = series.t[series.t.length - 1];
  const i0 = Math.max(0, idxAtOrBefore(series.t, last - days));
  const step = Math.max(1, Math.floor((series.t.length - i0) / 120));
  const out = [];
  for (let i = i0; i < series.t.length; i += step) out.push([series.t[i], vals[i]]);
  if (out[out.length - 1][0] !== last) out.push([last, vals[vals.length - 1]]);
  return out;
}

export function buildContext(macro, indexRaws) {
  const series = { ...macro.series };
  const indexMap = {};
  for (const r of indexRaws) {
    indexMap[r.symbol] = r;
    series[r.symbol] = { t: r.prices.t, c: r.prices.ac || r.prices.c };
  }
  const fred = macro.fred || {};
  const nowMs = Date.parse(macro.fetchedAt);
  const S = sym => series[sym];
  const F = id => (fred[id] ? { t: fred[id].t, c: fred[id].v } : null);
  const L = sym => lastOf(S(sym))?.value ?? null;
  const FL = id => lastOf(F(id))?.value ?? null;
  const ctx = { series, fred, indexMap, nowMs, asOf: new Date(nowMs).toISOString(), peerQuotes: macro.peerQuotes || {} };

  // ---------- 밸류에이션 벤치마크 ----------
  ctx.sectorVal = {};
  for (const [etf, v] of Object.entries(macro.etfVal || {})) {
    const e = v.equity || {};
    ctx.sectorVal[etf] = { pe: v.pe ?? inv(e.priceToEarnings), pb: inv(e.priceToBook), ps: inv(e.priceToSales), pcf: inv(e.priceToCashflow), yield: v.yield };
  }
  ctx.indexVal = {};
  for (const r of indexRaws) {
    const s = r.proxySummary;
    if (!s) continue;
    const e = s.topHoldings?.equityHoldings || {};
    ctx.indexVal[r.symbol] = {
      proxy: r.proxy, pe: s.summaryDetail?.trailingPE ?? inv(e.priceToEarnings), pb: inv(e.priceToBook), ps: inv(e.priceToSales),
      yield: s.summaryDetail?.yield ?? s.summaryDetail?.trailingAnnualDividendYield ?? null,
    };
  }
  const vals = Object.values(ctx.indexVal);
  ctx.globalVal = { pe: mean(vals.map(v => v.pe)), pb: mean(vals.map(v => v.pb)), yield: mean(vals.map(v => v.yield)) };

  // ---------- 무위험금리 ----------
  ctx.rf = {};
  for (const [mk, m] of Object.entries(MARKETS)) {
    let r = null, src = '기본값';
    if (m.rf === 'US') { const v = L('^IRX'); if (isNum(v)) { r = v / 100; src = '미 3개월 국채'; } }
    else if (m.rf && F(m.rf)) {
      const l = lastOf(F(m.rf));
      if (l && (nowMs / 864e5 - l.day) < 270) { r = l.value / 100; src = 'OECD 3개월 금리'; }
    }
    ctx.rf[mk] = { rate: isNum(r) ? r : m.rfFallback, src };
  }

  // ---------- 지수 레짐(폭) ----------
  ctx.indexStats = {};
  for (const r of indexRaws) {
    const c = r.prices.ac || r.prices.c, n = c.length;
    const m200 = sma(c, 200), m50 = sma(c, 50);
    ctx.indexStats[r.symbol] = { above200: c[n - 1] > m200[n - 1], above50: c[n - 1] > m50[n - 1], dist200: c[n - 1] / m200[n - 1] - 1 };
  }
  const st = Object.values(ctx.indexStats);
  ctx.breadth200 = st.filter(s => s.above200).length / Math.max(1, st.length);
  ctx.breadth50 = st.filter(s => s.above50).length / Math.max(1, st.length);

  // ---------- 뉴스 기반 시장 이벤트 ----------
  ctx.marketNews = macro.news || [];
  ctx.marketEvents = detectEvents(ctx.marketNews, nowMs, 14);
  ctx.marketTone = newsTone(ctx.marketNews, nowMs, 14);
  const recentN = ctx.marketNews.filter(n => n.time && nowMs - Date.parse(n.time) < 14 * 864e5).length || 1;
  ctx.geoShare = (ctx.marketEvents.geopolitics || []).length / recentN;
  const today = new Date(nowMs).toISOString().slice(0, 10);
  ctx.scheduled = SCHEDULED_EVENTS.filter(e => e.date >= today);

  ctx.macro = computeMacro(ctx, S, F, L, FL);
  ctx.fearGreed = computeFearGreed(ctx, S, macro.spyOptions);
  ctx.blackSwan = computeBlackSwan(ctx, S, F, L, FL);
  return ctx;
}

// ---------------------------------------------------------------- 거시경제
function computeMacro(ctx, S, F, L, FL) {
  const items = [];
  const add = (group, key, label, value, score, note, sp, w = 1) => items.push({ group, key, label, value, score: isNum(score) ? score : null, note, spark: sp, w });
  const yoy = id => { const s = F(id), l = lastOf(s); const p = valueDaysAgo(s, 365); return l && isNum(p) ? l.value / p - 1 : null; };

  // 금리
  const tnx = L('^TNX'), dTnx = diffChange(S('^TNX'), 91);
  add('금리', 'us10y', '미국 10년 국채금리', isNum(tnx) ? tnx.toFixed(2) + '%' : null, lin(dTnx, 0.75, -0.75),
    `3개월 ${signed(dTnx)}%p — 금리 상승은 주식 할인율을 높여 밸류에이션에 부담`, spark(S('^TNX')), 1.5);
  const bei = FL('T10YIE'), real = isNum(tnx) && isNum(bei) ? tnx - bei : null;
  add('금리', 'real10y', '미국 10년 실질금리', isNum(real) ? real.toFixed(2) + '%' : null, lin(real, 2.5, 0.5), '명목금리 − 기대인플레이션. 2%를 넘으면 긴축적', null);
  const spyPE = ctx.indexVal['^GSPC']?.pe;
  const erp = isNum(spyPE) && isNum(real) ? 1 / spyPE - real / 100 : null;
  add('금리', 'erp', '주식 위험 프리미엄(ERP)', isNum(erp) ? pct(erp, 2) : null, lin(erp, 0, 0.035),
    `S&P500 이익수익률(1/PER ${fixed(spyPE, 1)}) − 실질금리. 낮을수록 채권 대비 주식 매력 저하`, null, 1.2);
  const ff = FL('FEDFUNDS'), dff = diffChange(F('FEDFUNDS'), 182);
  add('금리', 'fedfunds', '미국 기준금리(실효)', isNum(ff) ? ff.toFixed(2) + '%' : null, lin(dff, 0.5, -0.5), `6개월 ${signed(dff)}%p — 인하 기조는 유동성에 우호적`, spark(F('FEDFUNDS'), 1500), 0.8);
  const curve = FL('T10Y3M');
  add('금리', 'curve', '장단기 금리차(10Y−3M)', isNum(curve) ? signed(curve) + '%p' : null, lin(curve, -1, 1), '역전(음수)은 역사적으로 경기침체 선행 신호. 장기금리 급등에 의한 가팔라짐은 긍정 신호가 아님', spark(F('T10Y3M'), 1500), 0.6);

  // 인플레이션
  const cpi = yoy('CPIAUCSL'), core = yoy('CPILFESL');
  add('인플레이션', 'cpi', '미국 CPI (전년비)', pct(cpi), isNum(cpi) ? clamp(1 - Math.abs(cpi - 0.022) / 0.012, -1, 1) : null, '2% 안팎이 이상적, 3.4% 이상이면 중립 이하, 4.6% 이상이면 강한 긴축 압력', null, 1.2);
  const coreS = F('CPILFESL'), cl = lastOf(coreS), c3 = valueDaysAgo(coreS, 91);
  const core3 = cl && isNum(c3) ? (cl.value / c3) ** 4 - 1 : null;
  add('인플레이션', 'core', '근원 CPI (전년비 / 3개월 연율)', `${pct(core)} / ${pct(core3)}`, isNum(core3) && isNum(core) ? lin(core3 - core, 0.01, -0.01) : null, '최근 3개월 연율이 전년비보다 낮으면 둔화 추세', null);
  add('인플레이션', 'bei', '10년 기대인플레이션', isNum(bei) ? bei.toFixed(2) + '%' : null, isNum(bei) ? clamp(1 - Math.abs(bei - 2.2) / 0.6, -1, 1) : null, '시장이 예상하는 향후 10년 평균 물가상승률', spark(F('T10YIE'), 800));

  // 경기·성장
  const gdp = FL('A191RL1Q225SBEA');
  add('경기·성장', 'gdp', '미국 실질 GDP 성장률(연율)', isNum(gdp) ? gdp.toFixed(1) + '%' : null, lin(gdp, 0, 3), '최근 분기 성장률', null);
  const icsa = F('ICSA');
  let claims = null;
  if (icsa) { const v = icsa.c, n = v.length; claims = mean(v.slice(n - 4)) / mean(v.slice(n - 26)) - 1; }
  add('경기·성장', 'claims', '신규 실업수당 청구 추세', isNum(claims) ? spct(claims) : null, lin(claims, 0.15, -0.10), '4주 평균 / 26주 평균 − 1. 급증은 경기 둔화 신호', spark(icsa, 800));
  const cuau = S('HG=F') && S('GC=F') ? (pctChange(S('HG=F'), 91) + 1) / (pctChange(S('GC=F'), 91) + 1) - 1 : null;
  add('경기·성장', 'cuau', '구리/금 비율 (3개월 변화)', isNum(cuau) ? spct(cuau) : null, lin(cuau, -0.10, 0.10), '경기 선행지표: 구리(산업수요)가 금(안전자산)보다 강하면 확장 기대', null);
  const um = FL('UMCSENT');
  add('경기·성장', 'umich', '미시간대 소비자심리', isNum(um) ? um.toFixed(1) : null, lin(um, 50, 90), '소비 여력과 심리 (장기 평균 약 85)', spark(F('UMCSENT'), 1500), 0.6);

  // 고용
  const ur = F('UNRATE');
  let sahm = null;
  if (ur && ur.c.length > 15) {
    const v = ur.c, n = v.length, avg3 = i => (v[i] + v[i - 1] + v[i - 2]) / 3;
    let mn = Infinity; for (let i = n - 13; i < n - 1; i++) mn = Math.min(mn, avg3(i));
    sahm = avg3(n - 1) - mn;
  }
  add('고용', 'unrate', '미국 실업률 · 샴 지표', isNum(FL('UNRATE')) ? `${FL('UNRATE').toFixed(1)}% · ${signed(sahm)}` : null, lin(sahm, 0.5, 0),
    '샴 규칙: 3개월 평균 실업률이 12개월 최저 대비 0.5%p 이상 오르면 경기침체 진입 신호', spark(ur, 1500), 1.2);
  const wage = yoy('CES0500000003');
  add('고용', 'wage', '시간당 임금 상승률(전년비)', pct(wage), isNum(wage) ? clamp(1 - Math.abs(wage - 0.035) / 0.02, -1, 1) : null, '3~4%는 건전, 5% 이상은 물가 압력', null);

  // 유동성·신용
  const m2 = yoy('M2SL');
  add('유동성·신용', 'm2', 'M2 통화량 (전년비)', pct(m2), lin(m2, -0.02, 0.07), '통화량 증가는 자산가격에 우호적', spark(F('M2SL'), 1500));
  const bs = pctChange(F('WALCL'), 91);
  add('유동성·신용', 'walcl', '연준 총자산 (3개월 변화)', spct(bs), lin(bs, -0.03, 0.03), '감소 = 양적긴축(QT), 증가 = 양적완화(QE)', spark(F('WALCL'), 1500));
  const hy = FL('BAMLH0A0HYM2'), dhy = diffChange(F('BAMLH0A0HYM2'), 91);
  add('유동성·신용', 'hy', '하이일드 스프레드', isNum(hy) ? `${hy.toFixed(2)}%p (3개월 ${signed(dhy)})` : null,
    isNum(hy) ? 0.6 * lin(hy, 6, 3) + 0.4 * (lin(dhy, 1.0, -0.5) ?? 0) : null, '신용 위험 선호도. 확대(상승)는 위험회피 신호', spark(F('BAMLH0A0HYM2'), 800), 1.2);

  // 환율·원자재
  const dxy3 = pctChange(S('DX-Y.NYB'), 91);
  add('환율', 'dxy', '달러 인덱스 (3개월)', `${fixed(L('DX-Y.NYB'), 1)} (${spct(dxy3)})`, lin(dxy3, 0.05, -0.05), '달러 강세는 글로벌·신흥국 주식에 부담', spark(S('DX-Y.NYB')), 0.8);
  const krw3 = pctChange(S('KRW=X'), 91);
  add('환율', 'krw', '원/달러 환율 (3개월)', `${fixed(L('KRW=X'), 1)}원 (${spct(krw3)})`, null, '상승 = 원화 약세. 수출기업엔 유리, 외국인 수급엔 부담', spark(S('KRW=X')), 0);
  const oil3 = pctChange(S('CL=F'), 91);
  add('원자재', 'oil', 'WTI 유가 (3개월)', `$${fixed(L('CL=F'), 1)} (${spct(oil3)})`, lin(oil3, 0.30, -0.15), '급등은 인플레이션·소비 위축 우려', spark(S('CL=F')), 0.8);
  const gold3 = pctChange(S('GC=F'), 91);
  add('원자재', 'gold', '금 (3개월)', `$${fixed(L('GC=F'), 0)} (${spct(gold3)})`, null, '안전자산 수요의 척도', spark(S('GC=F')), 0);
  const cu3 = pctChange(S('HG=F'), 91);
  add('원자재', 'copper', '구리 (3개월)', `$${fixed(L('HG=F'), 2)} (${spct(cu3)})`, null, '산업 수요의 척도', spark(S('HG=F')), 0);

  // 시장 레짐
  const acwi = S('ACWI');
  const aDist = acwi ? (() => { const c = acwi.c, m = sma(c, 200); return c[c.length - 1] / m[c.length - 1] - 1; })() : null;
  add('시장 레짐', 'acwi', '전세계 주식(ACWI) 200일선 이격', spct(aDist), lin(aDist, -0.08, 0.08), '장기 추세 위(양수)면 위험선호 국면', spark(acwi));
  add('시장 레짐', 'breadth', '주요 지수 중 200일선 위 비율', pct(ctx.breadth200, 0), lin(ctx.breadth200, 0.2, 0.8), `${Object.keys(ctx.indexStats).length}개 지수 기준 시장 폭`, null);
  const spy6 = pctChange(S('SPY'), 182);
  add('시장 레짐', 'spy6', 'S&P500 6개월 모멘텀', spct(spy6), lin(spy6, -0.15, 0.15), '추세 추종 관점의 시장 방향', null);

  const groups = {};
  for (const it of items) (groups[it.group] ||= []).push(it);
  const GW = { '금리': 1.5, '인플레이션': 0.9, '경기·성장': 1, '고용': 0.8, '유동성·신용': 1.1, '환율': 0.5, '원자재': 0.8, '시장 레짐': 1.0 };
  const gScores = Object.entries(groups).map(([g, its]) => ({ group: g, score: wmean(its.map(i => [i.score, i.w])) }));
  const score = wmean(gScores.map(g => [g.score, GW[g.group] || 1])) ?? 0;
  const regime = score > 0.25 ? '우호적' : score > 0.05 ? '다소 우호적' : score > -0.05 ? '중립' : score > -0.25 ? '다소 비우호적' : '비우호적';
  return { items, groups: gScores, score, regime };
}

// ---------------------------------------------------------------- 공포·탐욕
function computeFearGreed(ctx, S, spyOpt) {
  const comps = [];
  const pr = (arr, invert = false) => {
    const v = arr.filter(isNum).slice(-504);
    if (v.length < 60) return null;
    const p = percentileRank(v, v[v.length - 1]) * 100;
    return invert ? 100 - p : p;
  };
  const retSeries = (s, k) => s.c.map((x, i) => (i >= k ? x / s.c[i - k] - 1 : NaN));
  const add = (label, value, note, w = 1) => { if (isNum(value)) comps.push({ label, value: clamp(value, 0, 100), note, w }); };
  const spy = S('SPY');
  if (spy) { const m = sma(spy.c, 125); add('시장 모멘텀', pr(spy.c.map((x, i) => x / m[i] - 1)), 'S&P500의 125일 이동평균 대비 위치'); }
  // 두 시계열의 k일 로그수익률 차이 (날짜 기준 정렬)
  const spread = (a, bSer, k) => { const b = alignTo(a.t, bSer, 'c', 3); return a.c.map((x, i) => (i >= k && isNum(b[i]) && isNum(b[i - k]) ? Math.log(x / a.c[i - k]) - Math.log(b[i] / b[i - k]) : NaN)); };
  const rsp = S('RSP');
  if (rsp && spy) add('시장 폭(동일가중 vs 시총가중)', pr(spread(rsp, spy, 60)), '소수 대형주 쏠림 여부');
  const hyg = S('HYG'), ief = S('IEF');
  if (hyg && ief) add('정크본드 수요', pr(spread(hyg, ief, 20)), '하이일드 vs 국채 20일 성과');
  const vix = S('^VIX');
  if (vix) { const m = sma(vix.c, 50); add('변동성', pr(vix.c.map((x, i) => x / m[i]), true), 'VIX의 50일 평균 대비 수준 (높을수록 공포)'); }
  const tlt = S('TLT');
  if (spy && tlt) add('안전자산 수요', pr(spread(spy, tlt, 20)), '주식 vs 장기국채 20일 성과');
  if (spyOpt?.pcVolume) add('풋/콜 비율', lin(spyOpt.pcVolume, 1.3, 0.6) * 50 + 50, `SPY 옵션 거래량 풋/콜 ${spyOpt.pcVolume.toFixed(2)}`, 0.6);
  const btc = S('BTC-USD');
  if (btc) add('암호자산 위험선호', pr(retSeries(btc, 30)), '비트코인 30일 수익률의 2년 백분위', 0.5);
  const value = wmean(comps.map(c => [c.value, c.w]));
  const label = value < 25 ? '극단적 공포' : value < 45 ? '공포' : value <= 55 ? '중립' : value <= 75 ? '탐욕' : '극단적 탐욕';
  return { value, label, components: comps };
}

// ---------------------------------------------------------------- 블랙스완 위험
function computeBlackSwan(ctx, S, F, L, FL) {
  const comps = [];
  const add = (label, stress, note, w = 1) => { if (isNum(stress)) comps.push({ label, stress: clamp(stress, 0, 1), note, w }); };
  const vix = L('^VIX'), vix3 = L('^VIX3M');
  add('VIX 수준', (vix - 15) / 25, `VIX ${fixed(vix, 1)} (15 이하 안정, 40 이상 패닉)`, 1.2);
  if (isNum(vix) && isNum(vix3)) add('VIX 기간구조', (vix / vix3 - 0.9) / 0.2, `VIX/VIX3M = ${fixed(vix / vix3, 2)} (1 초과 시 단기 공포 급증)`);
  const hy = FL('BAMLH0A0HYM2'), dhy = diffChange(F('BAMLH0A0HYM2'), 91);
  add('신용 스프레드 수준', (hy - 3) / 5, `하이일드 스프레드 ${fixed(hy, 2)}%p`);
  add('신용 스프레드 확대 속도', dhy / 2, `3개월 ${signed(dhy)}%p`);
  const t3m = F('T10Y3M');
  if (t3m) {
    const v = t3m.c, now = v[v.length - 1], minY = Math.min(...v.slice(-260));
    // 하루 이틀의 미미한 역전은 무시하고 −0.10%p 이하의 의미 있는 역전만 반영
    const s = now < 0 ? 0.6 + Math.min(0.4, -now / 2) : minY <= -0.1 ? 0.5 : 0.1;
    add('수익률 곡선', s, now < 0 ? '장단기 금리 역전 중' : minY <= -0.1 ? `1년 내 역전(최저 ${minY.toFixed(2)}%p) 후 정상화 — 역사적으로 침체 직전 패턴` : '정상 기울기', 0.8);
  }
  const ur = F('UNRATE');
  if (ur && ur.c.length > 15) {
    const v = ur.c, n = v.length, a3 = i => (v[i] + v[i - 1] + v[i - 2]) / 3;
    let mn = Infinity; for (let i = n - 13; i < n - 1; i++) mn = Math.min(mn, a3(i));
    add('샴 규칙(고용 악화)', (a3(n - 1) - mn) / 0.5, `샴 지표 ${signed(a3(n - 1) - mn)} (0.5 이상이면 침체 신호)`);
  }
  const spyPE = ctx.indexVal['^GSPC']?.pe;
  add('밸류에이션 과열', (spyPE - 18) / 12, `S&P500 PER ${fixed(spyPE, 1)}배 (고평가일수록 충격 시 낙폭 확대)`, 0.8);
  add('급락 속도', -pctChange(S('ACWI'), 30) / 0.10, `전세계 주식 1개월 ${spct(pctChange(S('ACWI'), 30))}`);
  add('지정학 뉴스 비중', ctx.geoShare / 0.3, `최근 2주 시장 뉴스 중 ${pct(ctx.geoShare, 0)}가 전쟁·제재·분쟁 관련`, 0.8);
  add('유가 쇼크', (pctChange(S('CL=F'), 91) - 0.1) / 0.4, `WTI 3개월 ${spct(pctChange(S('CL=F'), 91))}`, 0.8);
  add('금리 쇼크', diffChange(S('^TNX'), 91) / 1.0, `미 10년물 3개월 ${signed(diffChange(S('^TNX'), 91))}%p`, 0.8);
  add('달러 급등', pctChange(S('DX-Y.NYB'), 30) / 0.05, `달러 인덱스 1개월 ${spct(pctChange(S('DX-Y.NYB'), 30))}`, 0.5);
  // 지수 간 상관관계 급등(전염 효과)
  const idx = ['^GSPC', '^STOXX50E', '^N225', '^KS11', '^HSI', '^TWII'].map(s => ctx.series[s]).filter(Boolean);
  if (idx.length >= 4) {
    const wr = idx.map(s => weeklyReturns(s.c, 104));
    const avgCorr = (from, to) => { const cs = []; for (let a = 0; a < wr.length; a++) for (let b = a + 1; b < wr.length; b++) cs.push(corr(wr[a].slice(from, to), wr[b].slice(from, to))); return mean(cs); };
    const recent = avgCorr(-13), base = avgCorr(0, -13);
    add('자산 간 상관관계 급등', (recent - base) / 0.3, `최근 3개월 평균 상관 ${fixed(recent, 2)} vs 이전 ${fixed(base, 2)}`, 0.6);
  }
  const value = 100 * (wmean(comps.map(c => [c.stress, c.w])) ?? 0.3);
  const level = value < 25 ? '낮음' : value < 45 ? '보통' : value < 65 ? '높음' : '매우 높음';
  return { value, level, lambdaMult: 0.5 + 2.5 * (value / 100), components: comps.sort((a, b) => b.stress - a.stress) };
}
