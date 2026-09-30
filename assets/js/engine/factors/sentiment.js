// 6. 시장 심리: 공포·탐욕 지수, VIX, 뉴스 톤, 관심도(언급량 프록시), 애널리스트 컨센서스·목표주가·추정치 변화
import { makeFactor } from './base.js';
import { isNum, lin, soft, percentileRank, lastOf } from '../stats.js';
import { pct, spct, fixed, signed } from '../format.js';
import { newsTone } from '../text.js';

const REGION_RE = {
  US: /wall street|s&p|nasdaq|dow|u\.s\. stocks|us stocks|american/i, KR: /kospi|kosdaq|korea|seoul|won\b/i, JP: /nikkei|japan|tokyo|yen\b|topix/i,
  CN: /china|chinese|shanghai|shenzhen|yuan/i, HK: /hang seng|hong kong/i, TW: /taiwan|taiex|tsmc/i, IN: /india|nifty|sensex|rupee/i,
  EU: /europe|euro|stoxx|ecb/i, DE: /germany|german|dax/i, FR: /france|french|cac/i, UK: /britain|british|uk\b|ftse|london|pound/i,
  CA: /canada|tsx/i, BR: /brazil|bovespa|real\b/i, AU: /australia|asx/i,
};

export function sentiment(A, ctx) {
  const f = makeFactor('sentiment');
  const s = A.summary, fd = s.financialData || {};

  // 시장 전체 심리
  const M = f.group('시장 심리 (글로벌)', 1);
  const fg = ctx.fearGreed;
  if (isNum(fg.value)) {
    const v = fg.value;
    const sc = v < 20 ? 0.6 : v < 35 ? 0.3 : v < 45 ? 0.1 : v <= 55 ? 0 : v <= 70 ? -0.05 : v <= 80 ? -0.25 : -0.5;
    M.add('공포·탐욕 지수', `${fixed(v, 0)} (${fg.label})`, sc, '극단적 공포는 역발상 매수, 극단적 탐욕은 경계 신호');
  }
  const vix = ctx.series['^VIX'], vl = lastOf(vix)?.value;
  const vixPct = vix ? percentileRank(vix.c.slice(-1260), vl) : null;
  M.add('VIX 변동성지수', `${fixed(vl, 1)} (5년 백분위 ${pct(vixPct, 0)})`, isNum(vixPct) ? lin(vixPct, 0.05, 0.95) * 0.4 : null, '공포 확대 구간은 중기적으로 기대수익률이 높았던 경향', 0.8);
  const v3 = lastOf(ctx.series['^VIX3M'])?.value;
  if (isNum(vl) && isNum(v3)) M.add('VIX 기간구조 (VIX/VIX3M)', fixed(vl / v3, 2), vl / v3 > 1 ? -0.5 : 0.15, vl / v3 > 1 ? '역전(백워데이션) — 단기 스트레스 고조' : '정상(콘탱고)', 0.7);

  // 뉴스 톤
  const N = f.group('뉴스·미디어 보도 톤', 1);
  const now = ctx.nowMs;
  let tone;
  if (A.kind === 'index') {
    const re = REGION_RE[A.market];
    const regional = ctx.marketNews.filter(n => re && re.test(n.title));
    tone = newsTone(regional.length >= 3 ? regional : ctx.marketNews, now, 14);
    N.add(regional.length >= 3 ? '지역 관련 시장 뉴스 톤 (14일)' : '글로벌 시장 뉴스 톤 (14일)', isNum(tone.score) ? `${signed(tone.score, 2)} (긍정 ${tone.pos} · 부정 ${tone.neg})` : null, isNum(tone.score) ? soft(tone.score, 0.25) : null, `기사 ${tone.n}건, 금융 감성사전 기반`);
  } else {
    tone = newsTone(A.raw.news, now, 30);
    N.add('종목 뉴스 톤 (30일, 최신 가중)', isNum(tone.score) ? `${signed(tone.score, 2)} (긍정 ${tone.pos} · 부정 ${tone.neg})` : '뉴스 없음', isNum(tone.score) ? soft(tone.score, 0.25) : null, `기사 ${tone.n}건, 금융 감성사전 기반`);
    const sig = A.raw.insights?.sigDevs || [];
    if (sig.length) {
      const st = newsTone(sig.map(d => ({ title: d.headline, time: d.date })), now, 90);
      if (isNum(st.score)) N.add('주요 공시·이벤트 톤 (90일)', signed(st.score, 2), soft(st.score, 0.3), `${st.n}건 (Yahoo 주요 이벤트)`, 0.6);
    }
  }

  // 관심도
  const At = f.group('관심도 (소셜·커뮤니티 언급량 프록시)', 0.6);
  const n7 = tone?.n7 ?? 0;
  const vz = A.hasVolume ? (A.v.slice(-5).reduce((a, b) => a + b, 0) / 5) / (A.v.slice(-120).reduce((a, b) => a + b, 0) / 120) : null;
  const attention = Math.min(1, n7 / 10) * 0.5 + (isNum(vz) ? Math.min(1, Math.max(0, vz - 1)) * 0.5 : 0);
  const dir = isNum(tone?.score) ? Math.sign(tone.score) : 0;
  At.add('관심도 지수', `뉴스 7일 ${n7}건 · 거래량 ${isNum(vz) ? fixed(vz, 2) + '배' : '—'}`, attention * dir * 0.8, '무료 소셜 API 부재로 뉴스 빈도·거래량 급증으로 대체. 관심 증가 × 뉴스 방향');

  // 애널리스트
  if (A.kind !== 'index') {
    const An = f.group('애널리스트 컨센서스', 1.3);
    const rm = fd.recommendationMean, nA = fd.numberOfAnalystOpinions;
    An.add('투자의견 평균 (1 강력매수 ~ 5 매도)', isNum(rm) ? `${fixed(rm, 2)} (${fd.recommendationKey || ''}, ${nA ?? '—'}명)` : null, lin(rm, 3.5, 1.5), '');
    const up = isNum(fd.targetMeanPrice) && A.price > 0 ? fd.targetMeanPrice / A.price - 1 : null;
    An.add('목표주가 괴리율', isNum(up) ? `${spct(up)} (평균 ${fixed(fd.targetMeanPrice, 2)})` : null, lin(up, -0.05, 0.35), `최저 ${fixed(fd.targetLowPrice, 2)} ~ 최고 ${fixed(fd.targetHighPrice, 2)} · 애널리스트 목표가는 낙관 편향 존재`, 1.2);
    const tr = s.recommendationTrend?.trend || [];
    const share = t => { const tot = t.strongBuy + t.buy + t.hold + t.sell + t.strongSell; return tot ? (t.strongBuy + t.buy) / tot : null; };
    const t0 = tr.find(x => x.period === '0m'), t3 = tr.find(x => x.period === '-3m');
    if (t0 && t3 && isNum(share(t0)) && isNum(share(t3))) An.add('매수의견 비중 변화 (3개월)', `${pct(share(t0), 0)} (${signed((share(t0) - share(t3)) * 100, 0)}%p)`, lin(share(t0) - share(t3), -0.15, 0.15), '');
    const hist = s.upgradeDowngradeHistory?.history || [];
    const recent = hist.filter(h => now - Date.parse(h.epochGradeDate) < 90 * 864e5);
    const ups = recent.filter(h => h.action === 'up').length, downs = recent.filter(h => h.action === 'down').length;
    const raises = recent.filter(h => h.priceTargetAction === 'Raises').length, lowers = recent.filter(h => h.priceTargetAction === 'Lowers').length;
    if (recent.length) {
      An.add('투자의견 상향/하향 (90일)', `상향 ${ups} · 하향 ${downs}`, soft(ups - downs, 2), '', 0.8);
      An.add('목표주가 상향/하향 (90일)', `상향 ${raises} · 하향 ${lowers}`, soft(raises - lowers, 4), '', 0.8);
    }
    const trend = s.earningsTrend?.trend || [];
    const y0 = trend.find(x => x.period === '0y') || trend[0];
    const et = y0?.epsTrend;
    if (et && isNum(et.current) && isNum(et['90daysAgo']) && et['90daysAgo'] !== 0) {
      const rev = et.current / Math.abs(et['90daysAgo']) - Math.sign(et['90daysAgo']);
      An.add('EPS 추정치 변화 (90일, 올해)', spct(rev), lin(rev, -0.10, 0.10), '추정치 상향은 가장 강력한 단기 주가 동인 중 하나', 1.2);
    }
    const er = y0?.epsRevisions;
    if (er && (isNum(er.upLast30days) || isNum(er.downLast30days))) An.add('EPS 추정 상향/하향 건수 (30일)', `상향 ${er.upLast30days ?? 0} · 하향 ${er.downLast30days ?? 0}`, soft((er.upLast30days || 0) - (er.downLast30days || 0), 5), '', 0.7);
    const val = A.raw.insights?.instrumentInfo?.valuation;
    if (val?.description) An.add('외부 밸류에이션 의견 (Trading Central)', `${val.description}${val.discount ? ` (${val.discount})` : ''}`, /under/i.test(val.description) ? 0.4 : /over/i.test(val.description) ? -0.4 : 0, '참고용', 0.4);
    const rec = A.raw.insights?.recommendation;
    if (rec?.rating) An.add(`리서치 의견 (${rec.provider || '외부'})`, `${rec.rating}${rec.targetPrice ? ` · 목표 ${fixed(rec.targetPrice, 2)}` : ''}`, rec.rating === 'BUY' ? 0.4 : rec.rating === 'SELL' ? -0.4 : 0, '참고용', 0.4);
    if (isNum(up) && up > 0.3) f.hi(`애널리스트 평균 목표가가 현재가 대비 ${spct(up, 0)}`, 1);
    if (isNum(up) && up < -0.05) f.hi(`주가가 애널리스트 평균 목표가를 ${spct(-up, 0)} 상회`, -1);
  }
  if (isNum(fg.value) && (fg.value < 25 || fg.value > 75)) f.hi(`공포·탐욕 지수 ${fixed(fg.value, 0)} (${fg.label})`, fg.value < 25 ? 1 : -1);
  return f.done({ newsItems: (tone?.items || []).slice(0, 12).map(n => ({ title: n.title, time: n.time, link: n.link, publisher: n.publisher, tone: n.tone })) });
}
