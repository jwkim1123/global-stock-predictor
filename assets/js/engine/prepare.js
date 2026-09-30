// 원자료 → 분석용 자산 객체 (지표·벤치마크·환율 정렬)
import { sma, logReturns, alignTo, isNum, lastOf, weeklyReturns, beta as betaOf } from './stats.js';
import * as I from './indicators.js';
import { MARKETS } from './config.js';

export function prepare(raw, ctx) {
  const p = raw.prices;
  const keep = p.c.map((x, i) => isNum(x) && x > 0 && isNum(p.ac?.[i] ?? x));
  const pick = arr => (arr ? arr.filter((_, i) => keep[i]) : null);
  const t = pick(p.t), c = pick(p.c), ac = pick(p.ac) || c;
  const o = pick(p.o) || c, h = pick(p.h) || c, l = pick(p.l) || c, v = pick(p.v) || c.map(() => 0);
  const n = c.length;
  // 고가/저가가 종가 범위를 벗어나는 오류 보정
  for (let i = 0; i < n; i++) { h[i] = Math.max(h[i], c[i], o[i]); l[i] = Math.min(l[i], c[i], o[i]); }
  const recentVol = v.slice(-250).filter(x => x > 0).length;
  const market = raw.market || 'US';
  const M = MARKETS[market] || MARKETS.US;
  const isIndex = raw.kind === 'index';
  const benchSym = isIndex ? 'ACWI' : M.bench;
  const bench = alignTo(t, ctx.series[benchSym], 'c', 5);
  const global = alignTo(t, ctx.series.ACWI, 'c', 5);
  const ind = {
    ma5: sma(c, 5), ma20: sma(c, 20), ma50: sma(c, 50), ma60: sma(c, 60), ma120: sma(c, 120), ma200: sma(c, 200),
    rsi14: I.rsi(c, 14), macd: I.macd(c), stoch: I.stochastic(h, l, c), bb: I.bollinger(c), atr14: I.atr(h, l, c, 14),
    adx: I.adx(h, l, c, 14), obv: I.obv(c, v), mf: I.moneyFlow(h, l, c, v, 20),
  };
  ind.cmf = ind.mf.cmf;
  const r = logReturns(ac);
  const wk = weeklyReturns(ac, 104), wkB = weeklyReturns(bench, 104), wkG = weeklyReturns(global, 104);
  const summary = raw.summary || {};
  const currency = raw.meta?.currency || summary.price?.currency || M.ccy;
  const finCcy = summary.financialData?.financialCurrency || currency;
  return {
    raw, kind: raw.kind, symbol: raw.symbol, market, M, summary, t, o, h, l, c, ac, v, n, r, ind, bench, global, benchSym,
    hasVolume: recentVol > 200, currency, finCcy,
    price: c[n - 1], day: t[n - 1],
    beta: { local: betaOf(wk, wkB), global: betaOf(wk, wkG) },
    wk, wkB, wkG,
    marketCap: summary.price?.marketCap ?? summary.summaryDetail?.marketCap ?? null,
    mcapCcy: currency === 'GBp' ? 'GBP' : currency, // 런던 상장주는 주가는 펜스, 시가총액은 파운드
    fx: ccy => fxToUSD(ctx, ccy),
  };
}

// 통화 1단위 → 달러 환산 계수
export function fxToUSD(ctx, ccy) {
  if (!ccy) return null;
  if (ccy === 'USD') return 1;
  if (ccy === 'GBp' || ccy === 'GBX') return fxToUSD(ctx, 'GBP') / 100;
  if (ccy === 'ZAc') return null;
  const s = ctx.series[`${ccy.toUpperCase()}=X`];
  const l = lastOf(s);
  return l && l.value > 0 ? 1 / l.value : null;
}
