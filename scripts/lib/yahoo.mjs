import YahooFinance from 'yahoo-finance2';
import { retry, sig, toDay, clean } from './util.mjs';

export const yf = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  queue: { concurrency: 3 },
});

// 검증 실패 시에도 (타입 변환은 적용된) 결과를 받기 위해 validateResult:false 사용
const NOVAL = { validateResult: false };

const DAY_MS = 86400000;

// 차트 → 열 지향(columnar) 압축 포맷. t = 거래소 현지 기준 epoch day
export async function chart(symbol, period1, { full = true } = {}) {
  const r = await retry(() => yf.chart(symbol, { period1, interval: '1d', events: 'div|split' }, NOVAL), `chart ${symbol}`);
  const off = (r.meta?.gmtoffset || 0) * 1000;
  const rows = new Map();
  for (const q of r.quotes || []) {
    if (!q || q.close === null || q.close === undefined || !Number.isFinite(q.close)) continue;
    const day = Math.floor((new Date(q.date).getTime() + off) / DAY_MS);
    rows.set(day, q); // 같은 날짜가 중복되면 마지막 값 유지
  }
  const days = [...rows.keys()].sort((a, b) => a - b);
  // Yahoo 일봉에 최신 거래일이 아직 비어 있으면(종가 null) 시세 메타데이터로 보충
  const m0 = r.meta || {};
  if (m0.regularMarketTime && Number.isFinite(m0.regularMarketPrice) && days.length) {
    const mDay = Math.floor((new Date(m0.regularMarketTime).getTime() + off) / DAY_MS);
    const lastDay = days[days.length - 1];
    if (mDay > lastDay && mDay - lastDay <= 7) {
      const prev = rows.get(lastDay), px = m0.regularMarketPrice;
      rows.set(mDay, { close: px, adjclose: px, open: prev.close, high: Math.max(px, m0.regularMarketDayHigh ?? px), low: Math.min(px, m0.regularMarketDayLow ?? px), volume: m0.regularMarketVolume ?? 0 });
      days.push(mDay);
    }
  }
  const p = { t: [], c: [], ac: [] };
  if (full) Object.assign(p, { o: [], h: [], l: [], v: [] });
  for (const d of days) {
    const q = rows.get(d);
    p.t.push(d);
    p.c.push(sig(q.close));
    p.ac.push(sig(q.adjclose ?? q.close));
    if (full) {
      p.o.push(sig(q.open ?? q.close));
      p.h.push(sig(q.high ?? q.close));
      p.l.push(sig(q.low ?? q.close));
      p.v.push(q.volume ?? 0);
    }
  }
  if (!full) delete p.ac; // 매크로 시계열은 종가만
  const m = r.meta || {};
  return {
    meta: {
      currency: m.currency, exchange: m.exchangeName, exchangeFull: m.fullExchangeName, timezone: m.exchangeTimezoneName,
      gmtoffset: m.gmtoffset, instrumentType: m.instrumentType, longName: m.longName, shortName: m.shortName,
      firstTradeDate: toDay(m.firstTradeDate), regularMarketPrice: m.regularMarketPrice,
      regularMarketTime: m.regularMarketTime ? new Date(m.regularMarketTime).toISOString() : null,
      fiftyTwoWeekHigh: m.fiftyTwoWeekHigh, fiftyTwoWeekLow: m.fiftyTwoWeekLow,
    },
    prices: p,
    dividends: (r.events?.dividends || []).map(d => [toDay(d.date), sig(d.amount)]).filter(d => d[0]),
    splits: (r.events?.splits || []).map(s => [toDay(s.date), s.numerator / s.denominator]).filter(s => s[0]),
  };
}

export const STOCK_MODULES = [
  'price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile', 'calendarEvents',
  'earnings', 'earningsHistory', 'earningsTrend', 'recommendationTrend', 'upgradeDowngradeHistory',
  'insiderTransactions', 'netSharePurchaseActivity', 'institutionOwnership', 'majorHoldersBreakdown', 'quoteType',
];
export const ETF_MODULES = ['price', 'summaryDetail', 'defaultKeyStatistics', 'topHoldings'];

export async function summary(symbol, modules) {
  const r = await retry(() => yf.quoteSummary(symbol, { modules }, NOVAL), `quoteSummary ${symbol}`);
  const s = clean(r) || {};
  const yearAgo = Date.now() - 400 * DAY_MS;
  // 용량 절감: 오래된 이력은 잘라냄
  if (s.upgradeDowngradeHistory?.history) {
    s.upgradeDowngradeHistory.history = s.upgradeDowngradeHistory.history
      .filter(h => new Date(h.epochGradeDate).getTime() > yearAgo).slice(0, 60);
  }
  if (s.insiderTransactions?.transactions) {
    s.insiderTransactions.transactions = s.insiderTransactions.transactions
      .filter(h => new Date(h.startDate).getTime() > yearAgo).slice(0, 40)
      .map(({ filerUrl, ...rest }) => rest);
  }
  if (s.institutionOwnership?.ownershipList) s.institutionOwnership.ownershipList = s.institutionOwnership.ownershipList.slice(0, 10);
  if (s.assetProfile) {
    delete s.assetProfile.companyOfficers;
    delete s.assetProfile.executiveTeam;
    if (s.assetProfile.longBusinessSummary) s.assetProfile.longBusinessSummary = s.assetProfile.longBusinessSummary.slice(0, 1200);
  }
  if (s.topHoldings) {
    s.topHoldings = {
      equityHoldings: s.topHoldings.equityHoldings,
      sectorWeightings: s.topHoldings.sectorWeightings,
      holdings: (s.topHoldings.holdings || []).slice(0, 10),
    };
  }
  return s;
}

// 재무제표 필드 화이트리스트
const FTS_FIELDS = [
  'totalRevenue', 'costOfRevenue', 'grossProfit', 'operatingIncome', 'EBIT', 'EBITDA', 'netIncome',
  'netIncomeCommonStockholders', 'dilutedEPS', 'basicEPS', 'dilutedAverageShares', 'researchAndDevelopment',
  'sellingGeneralAndAdministration', 'interestExpense', 'pretaxIncome', 'taxProvision', 'reconciledDepreciation',
  'totalAssets', 'currentAssets', 'currentLiabilities', 'totalLiabilitiesNetMinorityInterest', 'stockholdersEquity',
  'commonStockEquity', 'retainedEarnings', 'workingCapital', 'totalDebt', 'longTermDebt', 'cashAndCashEquivalents',
  'cashCashEquivalentsAndShortTermInvestments', 'accountsReceivable', 'receivables', 'inventory', 'netPPE', 'grossPPE',
  'goodwillAndOtherIntangibleAssets', 'investedCapital', 'ordinarySharesNumber', 'shareIssued', 'operatingCashFlow',
  'capitalExpenditure', 'freeCashFlow', 'repurchaseOfCapitalStock', 'cashDividendsPaid', 'commonStockIssuance',
  'stockBasedCompensation', 'depreciationAndAmortization', 'netDebt', 'tangibleBookValue', 'availableForSaleSecurities',
  'otherShortTermInvestments', 'longTermEquityInvestment', 'netInterestIncome', 'totalDeposits', 'netLoan',
  'depreciationAmortizationDepletion',
];

function pickFts(rows) {
  return (rows || [])
    .map(r => {
      const o = { date: toDay(r.date) };
      for (const f of FTS_FIELDS) if (Number.isFinite(r[f])) o[f] = r[f];
      return o;
    })
    .filter(o => o.date && Object.keys(o).length > 3)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fundamentals(symbol) {
  const annual = await retry(() => yf.fundamentalsTimeSeries(symbol, { period1: '2018-01-01', type: 'annual', module: 'all' }, NOVAL), `fts-annual ${symbol}`);
  const p1 = new Date(Date.now() - 3.2 * 365 * DAY_MS);
  const quarterly = await retry(() => yf.fundamentalsTimeSeries(symbol, { period1: p1, type: 'quarterly', module: 'all' }, NOVAL), `fts-quarterly ${symbol}`);
  return { annual: pickFts(annual), quarterly: pickFts(quarterly) };
}

export async function news(query, count = 20) {
  const r = await retry(() => yf.search(query, { quotesCount: 0, newsCount: count, enableFuzzyQuery: false }, NOVAL), `news ${query}`);
  return (r?.news || []).map(n => ({
    title: n.title,
    publisher: n.publisher,
    time: n.providerPublishTime ? new Date(n.providerPublishTime).toISOString() : null,
    link: n.link,
    tickers: n.relatedTickers || [],
  })).filter(n => n.title);
}

export async function insights(symbol) {
  const r = await retry(() => yf.insights(symbol, { reportsCount: 0 }, NOVAL), `insights ${symbol}`);
  const c = clean(r) || {};
  return {
    instrumentInfo: c.instrumentInfo || null,
    companySnapshot: c.companySnapshot || null,
    recommendation: c.recommendation || null,
    sigDevs: (c.sigDevs || []).slice(0, 12).map(d => ({ headline: d.headline, date: toDay(d.date) })),
  };
}

export async function peers(symbol) {
  const r = await retry(() => yf.recommendationsBySymbol(symbol, {}, NOVAL), `peers ${symbol}`);
  const one = Array.isArray(r) ? r[0] : r;
  return (one?.recommendedSymbols || []).slice(0, 6).map(x => x.symbol);
}

// 옵션: 약 30일 만기 ATM 내재변동성과 풋/콜 비율
export async function optionsSnapshot(symbol) {
  const first = await retry(() => yf.options(symbol, {}, NOVAL), `options ${symbol}`);
  const now = Date.now();
  const exps = (first?.expirationDates || []).map(d => new Date(d)).filter(d => d.getTime() - now > 12 * DAY_MS);
  const target = now + 30 * DAY_MS;
  exps.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
  const chain = exps[0] ? await retry(() => yf.options(symbol, { date: exps[0] }, NOVAL), `options2 ${symbol}`) : first;
  const o = chain?.options?.[0];
  const spot = chain?.quote?.regularMarketPrice;
  if (!o || !spot) return null;
  const nearIV = list => {
    const ok = (list || []).filter(x => x.impliedVolatility > 0.01 && x.impliedVolatility < 5)
      .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot)).slice(0, 3)
      .map(x => x.impliedVolatility).sort((a, b) => a - b);
    return ok.length ? ok[Math.floor(ok.length / 2)] : null;
  };
  const sum = (list, f) => (list || []).reduce((s, x) => s + (Number.isFinite(x[f]) ? x[f] : 0), 0);
  const civ = nearIV(o.calls), piv = nearIV(o.puts);
  const ivs = [civ, piv].filter(Number.isFinite);
  const cv = sum(o.calls, 'volume'), pv = sum(o.puts, 'volume');
  const coi = sum(o.calls, 'openInterest'), poi = sum(o.puts, 'openInterest');
  const exp = new Date(o.expirationDate);
  return {
    expiry: toDay(exp), days: Math.round((exp - now) / DAY_MS), spot,
    atmIV: ivs.length ? ivs.reduce((a, b) => a + b) / ivs.length : null,
    callIV: civ, putIV: piv,
    pcVolume: cv > 0 ? pv / cv : null, pcOI: coi > 0 ? poi / coi : null,
  };
}

export async function quotes(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 40) {
    const chunk = symbols.slice(i, i + 40);
    try {
      const r = await retry(() => yf.quote(chunk, {}, NOVAL), `quote batch`);
      for (const q of (Array.isArray(r) ? r : [r])) {
        if (!q?.symbol) continue;
        out[q.symbol] = {
          name: q.shortName || q.longName, currency: q.currency, marketCap: q.marketCap, price: q.regularMarketPrice,
          trailingPE: q.trailingPE, forwardPE: q.forwardPE, priceToBook: q.priceToBook, eps: q.epsTrailingTwelveMonths,
          change52w: q.fiftyTwoWeekChangePercent, rating: q.averageAnalystRating, quoteType: q.quoteType,
        };
      }
    } catch (e) {
      console.warn('quote batch failed', e.message);
    }
  }
  return out;
}
