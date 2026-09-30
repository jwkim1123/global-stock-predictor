// 분석 엔진 진입점: 원자료 + 시장 환경 → 9개 요인 → 종합점수 → ML → 몬테카를로 예측 → 시나리오·요약
import { HORIZONS, DEFAULT_HORIZON, FACTORS, SECTORS, MARKETS, MC_PATHS, signalOf } from './config.js';
import { isNum, median, mean, sma, idxAtOrBefore, alignTo, weeklyReturns, beta as betaOf, diffChange } from './stats.js';
import { prepare } from './prepare.js';
import { detectEvents } from './text.js';
import { fundamental } from './factors/fundamental.js';
import { industry, themeOf } from './factors/industry.js';
import { macroFactor, rateBeta } from './factors/macro.js';
import { technical } from './factors/technical.js';
import { flow } from './factors/flow.js';
import { sentiment } from './factors/sentiment.js';
import { catalyst } from './factors/catalyst.js';
import { quant } from './factors/quant.js';
import { risk } from './factors/risk.js';
import { composite } from './composite.js';
import { mlForecast } from './ml.js';
import { forecastInputs } from './forecast.js';
import { simulate } from './simulate.js';

export { buildContext } from './context.js';

// 유니버스 업종별 중앙값 (점유율 프록시·동종 비교용)
export function attachUniverse(ctx, stockRaws) {
  const bySec = {}, byInd = {};
  for (const r of stockRaws) {
    const ap = r.summary?.assetProfile || {}, fd = r.summary?.financialData || {}, ks = r.summary?.defaultKeyStatistics || {};
    if (!ap.sector) continue;
    const a = r.fts?.annual?.[r.fts.annual.length - 1];
    const row = { rev: fd.revenueGrowth, om: fd.operatingMargins, ev: ks.enterpriseToEbitda, rnd: a && a.totalRevenue > 0 && isNum(a.researchAndDevelopment) ? a.researchAndDevelopment / a.totalRevenue : NaN };
    (bySec[ap.sector] ||= []).push(row);
    if (ap.industryKey) (byInd[ap.industryKey] ||= []).push(row);
  }
  const agg = (arr, level) => ({
    n: arr.length, level, revGrowth: arr.length >= 2 ? median(arr.map(x => x.rev)) : null, opMargin: arr.length >= 2 ? median(arr.map(x => x.om)) : null,
    evEbitda: arr.length >= 2 ? median(arr.map(x => (x.ev > 0 && x.ev < 100 ? x.ev : NaN))) : null, rnd: arr.length >= 2 ? median(arr.map(x => x.rnd)) : null,
  });
  ctx.universeSec = Object.fromEntries(Object.entries(bySec).map(([k, v]) => [k, agg(v, '동일 섹터')]));
  ctx.universeInd = Object.fromEntries(Object.entries(byInd).map(([k, v]) => [k, agg(v, '동일 산업')]));
  // 동일 산업 3곳 이상이면 산업 기준, 아니면 섹터 기준 비교
  ctx.peerStats = ap => (ctx.universeInd[ap?.industryKey]?.n >= 3 ? ctx.universeInd[ap.industryKey] : ctx.universeSec[ap?.sector] || null);
  ctx.sectorEtfOf = A => SECTORS[A.summary?.assetProfile?.sector]?.etf || null;
  return ctx;
}

const SCENARIOS = [
  { name: '2008 글로벌 금융위기', from: '2008-09-01', to: '2009-03-09' },
  { name: '2011 유럽 재정위기', from: '2011-07-07', to: '2011-10-03' },
  { name: '2018년 4분기 긴축 발작', from: '2018-09-20', to: '2018-12-24' },
  { name: '2020 코로나19 쇼크', from: '2020-02-19', to: '2020-03-23' },
  { name: '2022 금리 급등기', from: '2022-01-03', to: '2022-10-12' },
];

function windowReturn(t, p, from, to) {
  const d0 = Date.parse(from) / 864e5, d1 = Date.parse(to) / 864e5;
  if (!t?.length || t[0] > d0 + 5) return null;
  const i0 = idxAtOrBefore(t, d0), i1 = idxAtOrBefore(t, d1);
  return i0 >= 0 && i1 > i0 && p[i0] > 0 ? p[i1] / p[i0] - 1 : null;
}

function scenarios(A, ctx) {
  const mSym = A.kind === 'index' ? 'ACWI' : A.benchSym;
  const idx = ctx.series[A.kind === 'index' ? A.symbol : A.benchSym];
  const bL = isNum(A.beta.local) ? A.beta.local : 1, bG = isNum(A.beta.global) ? A.beta.global : 1;
  const out = SCENARIOS.map(sc => {
    const own = windowReturn(A.t, A.ac, sc.from, sc.to);
    const mk = windowReturn(idx?.t, idx?.c, sc.from, sc.to);
    return { name: sc.name, period: `${sc.from} ~ ${sc.to}`, market: mk, marketName: A.kind === 'index' ? A.symbol : mSym, asset: own ?? (isNum(mk) ? Math.max(-0.95, (A.kind === 'index' ? 1 : bL) * mk) : null), basis: isNum(own) ? '실제 과거 수익률' : '베타 기반 추정' };
  });
  const wb = sym => betaOf(A.wk, weeklyReturns(alignTo(A.t, ctx.series[sym], 'c', 5), 104));
  const bRate = rateBeta(A, ctx).beta, bOil = wb('CL=F'), bUsd = wb('DX-Y.NYB');
  out.push({ name: '블랙먼데이형 폭락 (전세계 −20%)', period: '가상 시나리오', market: -0.2, marketName: 'ACWI', asset: Math.max(-0.95, bG * -0.2), basis: `글로벌 베타 ${bG.toFixed(2)}` });
  if (isNum(bRate)) out.push({ name: '미 10년물 금리 +1%p 급등', period: '가상 시나리오', market: null, asset: bRate * 1, basis: `금리 베타 ${bRate.toFixed(3)} (실증·이론 혼합)` });
  if (isNum(bOil)) out.push({ name: '유가 +50% 쇼크', period: '가상 시나리오', market: null, asset: bOil * Math.log(1.5), basis: `유가 베타 ${bOil.toFixed(2)}` });
  if (isNum(bUsd)) out.push({ name: '달러 +10% 급등', period: '가상 시나리오', market: null, asset: bUsd * Math.log(1.1), basis: `달러 베타 ${bUsd.toFixed(2)}` });
  return out;
}

function changes(A) {
  const i = A.n - 1, c = A.c;
  const back = days => { const j = idxAtOrBefore(A.t, A.day - days); return j >= 0 ? c[i] / c[j] - 1 : null; };
  const y0 = Date.UTC(new Date(A.day * 864e5).getUTCFullYear(), 0, 1) / 864e5;
  const jy = idxAtOrBefore(A.t, y0 - 1);
  return { d1: c[i] / c[i - 1] - 1, w1: back(7), m1: back(30), m3: back(91), ytd: jy >= 0 ? c[i] / c[jy] - 1 : null, y1: back(365) };
}

function chartData(A, days = 504) {
  const s = Math.max(0, A.n - days), r = arr => arr.slice(s).map(x => (isNum(x) ? +x.toPrecision(6) : null));
  return { t: A.t.slice(s), o: r(A.o), h: r(A.h), l: r(A.l), c: r(A.c), v: A.hasVolume ? A.v.slice(s) : null, ma20: r(A.ind.ma20), ma60: r(A.ind.ma60), ma200: r(A.ind.ma200) };
}

// 요인별 그룹 점수 → 강점·약점 문장
function narrative(factors, comp) {
  const groups = [];
  for (const { key, short } of FACTORS) {
    const f = factors[key];
    for (const g of f.groups) if (isNum(g.score) && g.coverage > 0.3) groups.push({ factor: short, key, name: g.name, score: g.score, w: g.weight * Math.abs(g.score) * (comp.weights[key] || 0.05) });
  }
  const pos = groups.filter(g => g.score > 0.2).sort((a, b) => b.w - a.w).slice(0, 4);
  const neg = groups.filter(g => g.score < -0.2).sort((a, b) => b.w - a.w).slice(0, 4);
  const highlights = [];
  for (const { key } of FACTORS) for (const h of factors[key].highlights || []) highlights.push({ ...h, factor: key });
  return { strengths: pos.map(g => `${g.factor} · ${g.name}`), weaknesses: neg.map(g => `${g.factor} · ${g.name}`), highlights };
}

export function analyzeAsset(raw, ctx, { paths = MC_PATHS, withML = true } = {}) {
  const A = prepare(raw, ctx);
  const ev = detectEvents(raw.news || [], ctx.nowMs, 30);
  const factors = {
    fundamental: fundamental(A, ctx),
    industry: industry(A, ctx, ev),
    macro: macroFactor(A, ctx),
    technical: technical(A, ctx),
    flow: flow(A, ctx, ev),
    sentiment: sentiment(A, ctx),
    catalyst: catalyst(A, ctx, ev),
    quant: quant(A, ctx),
    risk: risk(A, ctx, ev),
  };
  const comps = {};
  for (const H of HORIZONS) comps[H] = composite(factors, H);
  const ml = withML ? mlForecast(A, ctx) : {};
  const inputs = forecastInputs(A, ctx, factors, comps, ml);
  for (const H of Object.keys(ml || {})) if (ml[H]) ml[H].weight = inputs.alphaParts[H]?.wML ?? 0;
  const sim = simulate(inputs, { nPaths: paths });
  const ap = raw.summary?.assetProfile || {};
  const sec = SECTORS[ap.sector];
  const quantExtra = factors.quant;
  const nar = narrative(factors, comps[DEFAULT_HORIZON]);
  const mcapUSD = isNum(A.marketCap) && A.fx(A.mcapCcy) ? A.marketCap * A.fx(A.mcapCcy) : null;

  // 직렬화 시 무거운 객체 제거
  const strip = f => { const { vol, garchObj, ...rest } = f; return rest; };
  const factorOut = {};
  for (const { key } of FACTORS) {
    const f = { ...factors[key] };
    if (key === 'quant') { delete f.vol; f.volSummary = { ...quantExtra.vol, garchObj: undefined }; }
    factorOut[key] = f;
  }

  return {
    symbol: raw.symbol, kind: raw.kind, market: A.market, marketName: MARKETS[A.market]?.name || A.market, region: raw.region || null,
    name: raw.summary?.price?.longName || raw.meta?.longName || raw.name || raw.symbol, nameKo: raw.nameKo || null,
    currency: A.currency, exchange: raw.meta?.exchangeFull || raw.meta?.exchange, sector: ap.sector || null, sectorKo: sec?.ko || null,
    industry: ap.industryDisp || ap.industry || null, theme: themeOf(ap.industryKey)?.ko || null,
    asOf: new Date(A.day * 864e5).toISOString().slice(0, 10), fetchedAt: raw.fetchedAt, price: A.price, changes: changes(A), mcapUSD,
    profile: { summary: ap.longBusinessSummary || null, website: ap.website || null, employees: ap.fullTimeEmployees || null, country: ap.country || null },
    chart: chartData(A), levels: factors.technical.levels, patterns: factors.technical.patterns,
    factors: factorOut, composite: comps, ml, forecast: sim.horizons, fan: sim.fan, crashRate: sim.crashRate,
    mcInputs: inputs, scenarios: scenarios(A, ctx), seasonality: quantExtra.seasonality,
    beta: A.beta, betaDown: quantExtra.betaDown, corrs: quantExtra.corrs,
    flows: raw.flows ? raw.flows.slice(-30) : null, options: raw.options || null,
    events: { upcoming: factors.catalyst.upcoming, recent: factors.catalyst.recent }, news: factors.sentiment.newsItems,
    signalScores: Object.fromEntries(HORIZONS.map(H => [H, inputs.alphaParts[H].signalScore])),
    signal: { ...signalOf(inputs.alphaParts[DEFAULT_HORIZON].signalScore), score: inputs.alphaParts[DEFAULT_HORIZON].signalScore }, narrative: nar,
  };
}

// 목록·랭킹용 요약 행
export function summarize(res) {
  const fc = {};
  for (const H of HORIZONS) {
    const f = res.forecast[H];
    if (f) fc[H] = { exp: +f.mean.toFixed(4), med: +f.q50.toFixed(4), q05: +f.q05.toFixed(4), q95: +f.q95.toFixed(4), pUp: +f.pUp.toFixed(3), pDown20: +f.pDown20.toFixed(3), alpha: +res.mcInputs.alphaByH[H].toFixed(4) };
  }
  const scores = {}, conf = {};
  for (const { key } of FACTORS) { scores[key] = +res.factors[key].score.toFixed(3); conf[key] = +res.factors[key].confidence.toFixed(2); }
  const comp = {}, sig = {};
  for (const H of HORIZONS) { comp[H] = +res.composite[H].score.toFixed(3); sig[H] = +res.signalScores[H].toFixed(3); }
  const c = res.chart.c;
  return {
    symbol: res.symbol, kind: res.kind, name: res.name, nameKo: res.nameKo, market: res.market, marketName: res.marketName, region: res.region,
    sector: res.sector, sectorKo: res.sectorKo, currency: res.currency, price: res.price, changes: res.changes, mcapUSD: res.mcapUSD, asOf: res.asOf,
    scores, conf, comp, sig, fc, signal: res.signal, spark: c.slice(-66).map(x => (isNum(x) ? +x.toPrecision(5) : null)),
    vol: res.factors.quant.volSummary?.hv60 ?? null, nextEvent: res.events.upcoming[0] || null,
  };
}
