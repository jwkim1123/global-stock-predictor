// 데이터 수집기 (GitHub Actions에서 하루 1회 실행)
// 사용법: node scripts/collect.mjs [--force] [--only=AAPL,005930.KS] [--skip-macro]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MACRO_SYMBOLS, SECTORS, THEMES, FRED_SERIES, fileKey } from '../assets/js/engine/config.js';
import * as Y from './lib/yahoo.mjs';
import { fred, naverFlows } from './lib/sources.mjs';
import { readJSON, writeJSON, pool, log, yearsAgo } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const CACHE = path.join(ROOT, '.cache');
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const SKIP_MACRO = argv.includes('--skip-macro');
const ONLY = (argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const BUDGET_MS = 15 * 60 * 1000; // 무료 티어를 고려한 수집 시간 상한
const t0 = Date.now();
const overBudget = () => Date.now() - t0 > BUDGET_MS;

const universe = readJSON(path.join(ROOT, 'universe.json'));
const stats = { ok: [], stale: [], failed: [], errors: [], fetched: 0, cacheHits: 0 };

// TTL 캐시: 신선하면 재사용, 수집 실패 시 오래된 값이라도 사용 (Actions 캐시로 실행 간 유지)
async function cached(kind, key, ttlDays, fn) {
  const f = path.join(CACHE, kind, fileKey(key) + '.json');
  const c = readJSON(f);
  if (c && !FORCE && Date.now() - c.at < ttlDays * 86400000) { stats.cacheHits++; return c.data; }
  if (overBudget() && c) return c.data;
  try {
    const data = await fn();
    stats.fetched++;
    writeJSON(f, { at: Date.now(), data });
    return data;
  } catch (e) {
    stats.errors.push(`${kind} ${key}: ${String(e.message).slice(0, 160)}`);
    return c ? c.data : null;
  }
}

function dedupeNews(list) {
  const seen = new Set();
  return list.filter(n => {
    const k = n.title.toLowerCase().slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => (b.time || '').localeCompare(a.time || ''));
}

async function collectStock(e) {
  const sym = e.symbol;
  const ch = await cached('chart', sym, 0.4, () => Y.chart(sym, yearsAgo(10)));
  if (!ch) { stats.failed.push(sym); return null; }
  const out = { symbol: sym, kind: 'stock', market: e.market, nameKo: e.nameKo, fetchedAt: new Date().toISOString(), ...ch };
  out.summary = await cached('summary', sym, 0.4, () => Y.summary(sym, Y.STOCK_MODULES)) || {};
  out.fts = await cached('fts', sym, 7, () => Y.fundamentals(sym));
  out.insights = await cached('insights', sym, 3, () => Y.insights(sym));
  out.peers = await cached('peers', sym, 14, () => Y.peers(sym)) || [];
  out.news = await cached('news', sym, 0.4, async () => {
    let n = await Y.news(sym, 20).catch(() => []);
    const nm = out.summary?.price?.shortName || out.meta?.shortName;
    if (n.length < 6 && nm) n = n.concat(await Y.news(nm.replace(/,? (Inc|Co|Corp|Ltd|Limited|Holdings|plc)\.?$/i, ''), 15).catch(() => []));
    return dedupeNews(n).slice(0, 25);
  }) || [];
  if (e.market === 'US') out.options = await cached('options', sym, 0.4, () => Y.optionsSnapshot(sym));
  if (e.market === 'KR') out.flows = await cached('flows', sym, 0.4, () => naverFlows(sym.split('.')[0], 60));
  writeJSON(path.join(RAW, fileKey(sym) + '.json'), out);
  stats.ok.push(sym);
  return sym;
}

async function collectIndex(e) {
  const sym = e.symbol;
  const ch = await cached('chart', sym, 0.4, () => Y.chart(sym, '2007-01-01'));
  if (!ch) { stats.failed.push(sym); return null; }
  const out = { ...e, kind: 'index', fetchedAt: new Date().toISOString(), ...ch };
  if (e.proxy) out.proxySummary = await cached('etf', e.proxy, 3, () => Y.summary(e.proxy, Y.ETF_MODULES));
  writeJSON(path.join(RAW, fileKey(sym) + '.json'), out);
  stats.ok.push(sym);
  return sym;
}

async function collectMacro(stocks) {
  const sectorEtfs = Object.values(SECTORS).map(s => s.etf);
  const themeEtfs = THEMES.map(t => t.etf);
  const syms = [...new Set([...Object.values(MACRO_SYMBOLS).flat(), ...sectorEtfs, ...themeEtfs])];
  const series = {};
  await pool(syms, 4, async s => {
    const ch = await cached('macro', s, 0.4, () => Y.chart(s, yearsAgo(6), { full: false }));
    if (ch) series[s] = ch.prices;
  });
  log(`macro series ${Object.keys(series).length}/${syms.length}`);

  const fredData = {};
  await pool(Object.keys(FRED_SERIES), 3, async id => {
    const d = await cached('fred', id, 0.9, () => fred(id, '2012-01-01'));
    if (d) fredData[id] = d;
  });
  log(`fred ${Object.keys(fredData).length}/${Object.keys(FRED_SERIES).length}`);

  const etfVal = {};
  await pool(sectorEtfs, 3, async etf => {
    const s = await cached('etf', etf, 3, () => Y.summary(etf, Y.ETF_MODULES));
    if (s) etfVal[etf] = { equity: s.topHoldings?.equityHoldings || null, pe: s.summaryDetail?.trailingPE ?? null, yield: s.summaryDetail?.yield ?? null };
  });

  const peerSyms = [...new Set(stocks.flatMap(s => s.peers || []))];
  const peerQuotes = await cached('quotes', 'peers', 1, () => Y.quotes(peerSyms)) || {};

  const queries = [['stock market', 30], ['global economy', 20], ['Federal Reserve', 15], ['oil prices', 10], ['geopolitical risk', 15], ['KOSPI', 10]];
  let marketNews = [];
  for (const [q, n] of queries) marketNews = marketNews.concat(await cached('mnews', q, 0.4, () => Y.news(q, n)) || []);
  const spyOptions = await cached('options', 'SPY', 0.4, () => Y.optionsSnapshot('SPY'));

  writeJSON(path.join(RAW, '_macro.json'), {
    fetchedAt: new Date().toISOString(), series, fred: fredData, etfVal, peerQuotes,
    news: dedupeNews(marketNews).slice(0, 80), spyOptions,
  });
}

async function main() {
  log(`수집 시작 (force=${FORCE})`);
  let stocks = universe.stocks, indices = universe.indices;
  if (ONLY.length) {
    stocks = stocks.filter(s => ONLY.includes(s.symbol));
    indices = indices.filter(s => ONLY.includes(s.symbol));
  }
  await pool(indices, 3, e => collectIndex(e).catch(err => { stats.failed.push(e.symbol); stats.errors.push(`${e.symbol}: ${err.message}`); }));
  log(`지수 ${stats.ok.length}/${indices.length}`);
  await pool(stocks, 3, e => collectStock(e).catch(err => { stats.failed.push(e.symbol); stats.errors.push(`${e.symbol}: ${err.message}`); }));
  log(`종목 완료, 누적 성공 ${stats.ok.length}`);
  if (!SKIP_MACRO) {
    const raws = stocks.map(s => readJSON(path.join(RAW, fileKey(s.symbol) + '.json'))).filter(Boolean);
    await collectMacro(raws);
  }
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  writeJSON(path.join(RAW, '_collect_log.json'), { at: new Date().toISOString(), seconds: +sec, ...stats });
  log(`수집 종료 ${sec}s — 성공 ${stats.ok.length}, 실패 ${stats.failed.length}, 요청 ${stats.fetched}, 캐시 ${stats.cacheHits}, 오류 ${stats.errors.length}`);
  for (const e of stats.errors.slice(0, 40)) console.log('  !', e);
  if (!stats.ok.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
