// FRED(미국 연준 경제데이터)·네이버 증권(한국 투자자별 수급) 수집
import { retry, sig } from './util.mjs';

const DAY_MS = 86400000;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; global-stock-predictor)' };

async function getText(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// FRED CSV (API 키 불필요). 반환: { t: [epochDay], v: [value] }
export async function fred(id, start = '2015-01-01') {
  const txt = await retry(() => getText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`), `fred ${id}`);
  const t = [], v = [];
  for (const line of txt.trim().split(/\r?\n/).slice(1)) {
    const [d, x] = line.split(',');
    const val = parseFloat(x);
    if (!d || !Number.isFinite(val)) continue;
    t.push(Math.floor(Date.parse(d + 'T00:00:00Z') / DAY_MS));
    v.push(sig(val, 7));
  }
  if (!t.length) throw new Error(`fred ${id}: empty`);
  return { t, v };
}

const num = s => {
  if (s === null || s === undefined) return null;
  const x = parseFloat(String(s).replace(/[,%+]/g, ''));
  return Number.isFinite(x) ? x : null;
};

// 네이버 증권 모바일 API: 일별 외국인·기관·개인 순매수(주식 수), 외국인 보유율
export async function naverFlows(code, pageSize = 60) {
  const txt = await retry(() => getText(`https://m.stock.naver.com/api/stock/${code}/trend?pageSize=${pageSize}`,
    { Referer: 'https://m.stock.naver.com/' }), `naver ${code}`);
  const arr = JSON.parse(txt);
  if (!Array.isArray(arr) || !arr.length) throw new Error(`naver ${code}: empty`);
  return arr.map(r => ({
    d: r.bizdate ? `${r.bizdate.slice(0, 4)}-${r.bizdate.slice(4, 6)}-${r.bizdate.slice(6, 8)}` : null,
    foreign: num(r.foreignerPureBuyQuant),
    organ: num(r.organPureBuyQuant),
    indiv: num(r.individualPureBuyQuant),
    foreignRatio: num(r.foreignerHoldRatio) !== null ? num(r.foreignerHoldRatio) / 100 : null,
    close: num(r.closePrice),
    volume: num(r.accumulatedTradingVolume),
  })).filter(r => r.d).sort((a, b) => a.d.localeCompare(b.d));
}
