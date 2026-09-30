// 분석 실행 + 사이트 데이터 생성 (GitHub Actions에서 collect 다음에 실행)
// 사용법: node scripts/build.mjs [--only=AAPL] [--no-ml] [--site]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext, analyzeAsset, summarize, attachUniverse } from '../assets/js/engine/index.js';
import { HORIZONS, fileKey, FACTORS, WEIGHTS, HORIZON_LABELS } from '../assets/js/engine/config.js';
import { spearman, mean, idxAtOrBefore, isNum } from '../assets/js/engine/stats.js';
import { readJSON, writeJSON, ensureDir, log } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data');
const argv = process.argv.slice(2);
const ONLY = (argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const NO_ML = argv.includes('--no-ml');
const SITE = argv.includes('--site');
const LOG_FILE = path.join(ROOT, 'history', 'predictions.csv');
const LOG_H = [5, 20, 60];

const universe = readJSON(path.join(ROOT, 'universe.json'));
const macro = readJSON(path.join(RAW, '_macro.json'));
if (!macro) { console.error('data/raw/_macro.json 없음 — 먼저 collect 실행'); process.exit(1); }
const loadRaw = s => readJSON(path.join(RAW, fileKey(s) + '.json'));
const indexRaws = universe.indices.map(e => { const r = loadRaw(e.symbol); return r ? { ...e, ...r } : null; }).filter(Boolean);
const stockRaws = universe.stocks.map(e => { const r = loadRaw(e.symbol); return r ? { ...r, ...e, kind: 'stock' } : null; }).filter(Boolean);

const t0 = Date.now();
const ctx = attachUniverse(buildContext(macro, indexRaws), stockRaws);
log(`context 구성 ${Date.now() - t0}ms — 거시 ${ctx.macro.regime} (${ctx.macro.score.toFixed(2)}), 공포탐욕 ${ctx.fearGreed.value?.toFixed(0)}, 블랙스완 ${ctx.blackSwan.value.toFixed(0)}`);

ensureDir(path.join(OUT, 'a'));
const rows = [], mlAgg = Object.fromEntries(LOG_H.map(h => [h, { ic: [], hit: [], base: [], n: 0 }])), failures = [];
for (const raw of [...indexRaws, ...stockRaws]) {
  if (ONLY.length && !ONLY.includes(raw.symbol)) continue;
  const ts = Date.now();
  try {
    const res = analyzeAsset(raw, ctx, { withML: !NO_ML });
    writeJSON(path.join(OUT, 'a', fileKey(raw.symbol) + '.json'), res);
    rows.push(summarize(res));
    for (const h of LOG_H) { const m = res.ml?.[h]; if (m) { mlAgg[h].ic.push(m.ic); mlAgg[h].hit.push(m.hit); mlAgg[h].base.push(m.baseHit); mlAgg[h].n += m.nOOS; } }
    log(`${raw.symbol.padEnd(12)} ${String(Date.now() - ts).padStart(5)}ms  종합 ${res.composite[20].score.toFixed(2)}  ${res.signal.label}  1개월 기대 ${(res.forecast[20].mean * 100).toFixed(1)}%  상승확률 ${(res.forecast[20].pUp * 100).toFixed(0)}%`);
  } catch (e) {
    failures.push({ symbol: raw.symbol, error: String(e.stack || e).slice(0, 400) });
    console.error('분석 실패', raw.symbol, e);
  }
}

// ---------------- 예측 기록 & 성적표 ----------------
const asOfMax = rows.reduce((m, r) => (r.asOf > m ? r.asOf : m), '');
function appendLog() {
  ensureDir(path.dirname(LOG_FILE));
  const header = 'date,symbol,horizon,price,exp,q05,q50,q95,pUp,score';
  const existing = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n') : [header];
  const keys = new Set(existing.slice(1).map(l => l.split(',').slice(0, 3).join(',')));
  const add = [];
  for (const r of rows) for (const h of LOG_H) {
    const k = `${r.asOf},${r.symbol},${h}`, f = r.fc[h];
    if (!f || keys.has(k)) continue;
    add.push([r.asOf, r.symbol, h, r.price, f.exp, f.q05, f.med, f.q95, f.pUp, r.comp[h]].join(','));
  }
  if (add.length) fs.writeFileSync(LOG_FILE, [...existing, ...add].join('\n') + '\n');
  return { added: add.length, total: existing.length - 1 + add.length };
}
function evaluateLog() {
  if (!fs.existsSync(LOG_FILE)) return { byH: {}, recent: [] };
  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(1);
  const series = {};
  const getSeries = sym => (series[sym] ??= (() => { const r = loadRaw(sym); return r ? { t: r.prices.t, c: r.prices.c } : null; })());
  const done = [];
  for (const l of lines) {
    const [date, symbol, hs, price, exp, q05, q50, q95, pUp] = l.split(',');
    const h = +hs, s = getSeries(symbol);
    if (!s) continue;
    const d = Date.parse(date) / 864e5, i0 = idxAtOrBefore(s.t, d);
    if (i0 < 0 || i0 + h >= s.t.length) continue;
    const real = s.c[i0 + h] / +price - 1;
    done.push({ date, symbol, h, exp: +exp, q05: +q05, q50: +q50, q95: +q95, pUp: +pUp, real, hit: (+pUp > 0.5) === (real > 0), inBand: real >= +q05 && real <= +q95 });
  }
  const byH = {};
  for (const h of LOG_H) {
    const d = done.filter(x => x.h === h);
    if (!d.length) continue;
    byH[h] = { n: d.length, hit: mean(d.map(x => (x.hit ? 1 : 0))), coverage90: mean(d.map(x => (x.inBand ? 1 : 0))), ic: d.length >= 10 ? spearman(d.map(x => x.exp), d.map(x => x.real)) : null, mae: mean(d.map(x => Math.abs(x.q50 - x.real))), baseUp: mean(d.map(x => (x.real > 0 ? 1 : 0))) };
  }
  return { byH, recent: done.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200), firstDate: lines[0]?.split(',')[0] || null, logged: lines.length };
}
const logRes = ONLY.length ? { added: 0 } : appendLog();
const track = evaluateLog();
const backtest = {};
for (const h of LOG_H) {
  const a = mlAgg[h];
  if (a.ic.length) backtest[h] = { assets: a.ic.length, nOOS: a.n, icMean: mean(a.ic), icPositive: a.ic.filter(x => x > 0).length / a.ic.length, hitMean: mean(a.hit), baseMean: mean(a.base) };
}
writeJSON(path.join(OUT, 'track.json'), { generatedAt: new Date().toISOString(), live: track, backtest });

// ---------------- 요약 ----------------
const cx = {
  macro: { score: ctx.macro.score, regime: ctx.macro.regime, groups: ctx.macro.groups, items: ctx.macro.items },
  fearGreed: ctx.fearGreed, blackSwan: ctx.blackSwan, rf: ctx.rf, breadth200: ctx.breadth200, breadth50: ctx.breadth50,
  scheduled: ctx.scheduled, marketTone: { score: ctx.marketTone.score, n: ctx.marketTone.n, pos: ctx.marketTone.pos, neg: ctx.marketTone.neg },
  marketEvents: Object.fromEntries(Object.entries(ctx.marketEvents).map(([k, v]) => [k, { n: v.length, top: v.slice(0, 3) }])),
  headlines: ctx.marketTone.items.slice(0, 15).map(n => ({ title: n.title, time: n.time, link: n.link, publisher: n.publisher, tone: n.tone })),
  sectorVal: ctx.sectorVal, indexVal: ctx.indexVal, globalVal: ctx.globalVal,
};
writeJSON(path.join(OUT, 'summary.json'), {
  generatedAt: new Date().toISOString(), dataFetchedAt: macro.fetchedAt, asOf: asOfMax, horizons: HORIZONS, horizonLabels: HORIZON_LABELS,
  factors: FACTORS, weights: WEIGHTS, assets: rows, context: cx, failures, log: logRes,
});
log(`완료: 자산 ${rows.length}개, 실패 ${failures.length}개, 예측 기록 +${logRes.added ?? 0}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// ---------------- 배포 폴더 ----------------
if (SITE) {
  const site = path.join(ROOT, '_site');
  fs.rmSync(site, { recursive: true, force: true });
  const copy = (src, dst) => fs.cpSync(path.join(ROOT, src), path.join(site, dst ?? src), { recursive: true });
  copy('index.html'); copy('assets');
  if (fs.existsSync(path.join(ROOT, 'reports'))) copy('reports');
  copy('data/a'); copy('data/summary.json'); copy('data/track.json');
  if (fs.existsSync(path.join(ROOT, '404.html'))) copy('404.html');
  fs.writeFileSync(path.join(site, '.nojekyll'), '');
  log(`_site 구성 완료`);
}
if (!rows.length) process.exit(1);
