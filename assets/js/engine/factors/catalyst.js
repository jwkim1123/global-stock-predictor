// 7. 이벤트·촉매: 실적 발표, 신제품·승인, M&A·지분, 배당·분할·자사주, 정치·지정학, 원자재·재해
import { makeFactor } from './base.js';
import { isNum, lin, soft, idxAtOrBefore, std } from '../stats.js';
import { pct, spct, fixed, dateKo, big } from '../format.js';
import { eventScore, RULE_KO } from '../text.js';

const DAY = 864e5;

// 과거 실적 발표일 전후 2일 수익률로 이벤트 변동성 추정
export function earningsReaction(A) {
  const q = A.summary.earnings?.earningsChart?.quarterly || [];
  const off = (A.raw.meta?.gmtoffset || 0) * 1000;
  const moves = [];
  for (const x of q) {
    if (!x.reportedDate) continue;
    const d = Math.floor((Date.parse(x.reportedDate) + off) / DAY);
    const i0 = idxAtOrBefore(A.t, d - 1), i1 = Math.min(A.n - 1, idxAtOrBefore(A.t, d) + 1);
    if (i0 < 0 || i1 <= i0 || A.t[i1] - d > 6) continue;
    moves.push({ date: x.reportedDate.slice(0, 10), ret: Math.log(A.ac[i1] / A.ac[i0]), surprise: isNum(x.actual) && isNum(x.estimate) && x.estimate !== 0 ? x.actual / Math.abs(x.estimate) - Math.sign(x.estimate) : null });
  }
  const sd = std(A.r.slice(-250));
  const rms = moves.length ? Math.sqrt(moves.reduce((s, m) => s + m.ret ** 2, 0) / moves.length) : null;
  const excess = isNum(rms) ? Math.sqrt(Math.max(rms ** 2 - 2 * sd ** 2, 0)) : null;
  return { moves, rms, excessSd: isNum(excess) ? Math.max(excess, sd) : 2 * sd };
}

export function catalyst(A, ctx, ev) {
  const f = makeFactor('catalyst');
  const s = A.summary, now = ctx.nowMs, today = A.day;
  const upcoming = [];

  // 실적 발표
  const Er = f.group('실적 발표', 1.2);
  let earnDay = null, reaction = null;
  if (A.kind !== 'index') {
    const ed = s.calendarEvents?.earnings?.earningsDate?.[0];
    if (ed) {
      const days = Math.round((Date.parse(ed) - today * DAY) / DAY);
      if (days >= 0) {
        earnDay = Math.max(1, Math.round((days * 252) / 365));
        upcoming.push({ date: ed.slice(0, 10), title: '실적 발표', type: 'earnings', impact: 'high', estimate: s.calendarEvents.earnings.isEarningsDateEstimate });
      }
      Er.info('다음 실적 발표일', `${dateKo(ed)} (${days >= 0 ? `D-${days}` : '지남'})${s.calendarEvents.earnings.isEarningsDateEstimate ? ' · 추정' : ''}`,
        isNum(s.calendarEvents.earnings.earningsAverage) ? `EPS 컨센서스 ${fixed(s.calendarEvents.earnings.earningsAverage, 2)} · 매출 ${big(s.calendarEvents.earnings.revenueAverage, A.finCcy)}` : '');
    }
    reaction = earningsReaction(A);
    if (reaction.moves.length) Er.info('과거 실적 발표 주가 반응 (2일)', reaction.moves.map(m => spct(Math.exp(m.ret) - 1, 1)).join(' / '), `평균 변동폭 ±${pct(Math.exp(reaction.rms) - 1, 1)} → 시뮬레이션에 이벤트 점프로 반영`);
    const hist = (s.earningsHistory?.history || []).filter(h => isNum(h.surprisePercent));
    if (hist.length) {
      const avg = hist.reduce((a, h) => a + Math.max(-0.5, Math.min(0.5, h.surprisePercent)), 0) / hist.length;
      Er.add('실적 서프라이즈 모멘텀 (PEAD)', `평균 ${spct(avg)}`, lin(avg, -0.05, 0.08), '실적 발표 후 주가 표류 효과: 서프라이즈 방향으로 추가 움직임 경향');
    }
    const t0 = (s.earningsTrend?.trend || []).find(x => x.period === '0q');
    if (t0?.epsTrend && isNum(t0.epsTrend.current) && isNum(t0.epsTrend['30daysAgo']) && t0.epsTrend['30daysAgo'] !== 0) {
      const r = t0.epsTrend.current / Math.abs(t0.epsTrend['30daysAgo']) - Math.sign(t0.epsTrend['30daysAgo']);
      Er.add('이번 분기 EPS 추정치 변화 (30일)', spct(r, 2), lin(r, -0.05, 0.05), '발표 직전 추정치 상향은 긍정적');
    }
    const gu = ev.guidanceUp?.length || 0, gd = ev.guidanceDown?.length || 0;
    Er.add('실적·가이던스 뉴스 (30일)', `호조 ${gu}건 · 부진 ${gd}건`, gu || gd ? soft(gu - gd, 1.5) : 0, '');
  } else Er.info('실적 발표', '지수 — 구성 종목 실적 시즌 영향', '');

  // 신제품·규제 승인
  const Pd = f.group('신제품·규제 승인', 0.8);
  const pN = ev.product?.length || 0, aN = ev.approval?.length || 0;
  Pd.add('신제품·출시 뉴스 (30일)', `${pN}건`, pN ? eventScore(ev, ['product'], now) : 0, '');
  Pd.add('규제 승인 뉴스 (30일)', `${aN}건`, aN ? eventScore(ev, ['approval'], now) : 0, '');

  // M&A·지분 변동
  const Mn = f.group('M&A·지분 변동', 0.8);
  Mn.info('M&A 관련 뉴스 (30일)', `${ev.mna?.length || 0}건`, (ev.mna || []).slice(0, 2).map(x => x.title).join(' / '));
  const tx = (s.insiderTransactions?.transactions || []).filter(t => now - Date.parse(t.startDate) < 90 * DAY);
  if (tx.length) {
    const buys = tx.filter(t => /purchase|buy/i.test(t.transactionText || '')), sells = tx.filter(t => /sale|sell/i.test(t.transactionText || ''));
    const bv = buys.reduce((a, t) => a + (t.value || 0), 0), sv = sells.reduce((a, t) => a + (t.value || 0), 0);
    Mn.add('내부자 장내 매매 (90일)', `매수 ${buys.length}건 ${big(bv, A.currency)} · 매도 ${sells.length}건 ${big(sv, A.currency)}`, bv + sv > 0 ? lin((bv - sv) / (bv + sv), -1, 1) * 0.6 + (buys.length ? 0.3 : 0) : 0, '임원 매도는 보상성 매도가 많아 매수 신호가 더 의미 있음');
  } else Mn.info('내부자 장내 매매 (90일)', A.kind === 'index' ? '해당 없음' : '공시 없음', '');

  // 배당·분할·자사주
  const Dv = f.group('배당·분할·자사주', 0.7);
  const exd = s.calendarEvents?.exDividendDate || s.summaryDetail?.exDividendDate;
  if (exd) {
    const days = Math.round((Date.parse(exd) - today * DAY) / DAY);
    if (days >= 0) upcoming.push({ date: exd.slice(0, 10), title: '배당락일', type: 'dividend', impact: 'low' });
    Dv.info('배당락일', `${dateKo(exd)}${days >= 0 ? ` (D-${days})` : ''}`, days >= 0 ? '배당락일에 배당금만큼 주가 조정' : '');
  }
  const bb = ev.buyback?.length || 0, dv = ev.dividend?.length || 0, sp = ev.split?.length || 0;
  Dv.add('자사주·배당 확대 뉴스 (30일)', `자사주 ${bb}건 · 배당 ${dv}건`, bb || dv ? eventScore(ev, ['buyback', 'dividend'], now) : 0, '');
  const lsd = s.defaultKeyStatistics?.lastSplitDate;
  const splitAgo = isNum(lsd) ? (now / 1000 - lsd) / 86400 : null;
  Dv.add('주식 분할', sp ? `분할 관련 뉴스 ${sp}건` : isNum(splitAgo) && splitAgo < 365 ? `최근 분할 (${s.defaultKeyStatistics.lastSplitFactor})` : '최근 없음', sp || (isNum(splitAgo) && splitAgo < 365) ? 0.3 : 0, '분할은 유동성 개선·개인 수요 증가 경향', 0.5);

  // 정치·지정학 (시장 전체)
  const Gp = f.group('정치·지정학 이벤트', 1);
  const soon = ctx.scheduled.filter(e => (Date.parse(e.date) - now) / DAY <= 60);
  for (const e of soon) upcoming.push(e);
  Gp.add('예정된 거시·정치 이벤트 (60일)', soon.length ? soon.map(e => `${e.date.slice(5)} ${e.title}`).join(' · ') : '없음', -0.1 * soon.length, '이벤트 전후 변동성 확대 (방향 중립)', 0.5);
  const geo = ctx.marketEvents.geopolitics?.length || 0, tar = ctx.marketEvents.tariff?.length || 0, ele = ctx.marketEvents.election?.length || 0;
  Gp.add('지정학·전쟁 뉴스 (시장 14일)', `${geo}건 (시장 뉴스 중 ${pct(ctx.geoShare, 0)})`, -soft(ctx.geoShare, 0.15), (ctx.marketEvents.geopolitics || []).slice(0, 2).map(x => x.title).join(' / '));
  Gp.add('무역분쟁·관세 뉴스 (시장 14일)', `${tar}건`, -soft(tar, 5), '', 0.7);
  Gp.info('선거·정치 뉴스 (시장 14일)', `${ele}건`, '');
  const ownGeo = (ev.geopolitics?.length || 0) + (ev.tariff?.length || 0);
  if (A.kind !== 'index') Gp.add('종목 관련 지정학·관세 뉴스 (30일)', `${ownGeo}건`, ownGeo ? -soft(ownGeo, 2) : 0.1, '');

  // 원자재 공급·자연재해
  const Nd = f.group('원자재 공급·자연재해', 0.6);
  const dis = (ev.disaster?.length || 0) + (ctx.marketEvents.disaster?.length || 0), sup = (ev.supply?.length || 0) + (ctx.marketEvents.supply?.length || 0);
  Nd.add('자연재해 뉴스', `${dis}건`, dis ? -soft(dis, 2) : 0.05, '');
  Nd.add('공급 차질·파업 뉴스', `${sup}건`, sup ? -soft(sup, 3) : 0.05, '');

  // 최근 이벤트 목록 (UI용)
  const recent = [];
  for (const [k, list] of Object.entries(ev)) for (const it of list.slice(0, 3)) recent.push({ ...it, cat: RULE_KO[k] || k });
  recent.sort((a, b) => b.time.localeCompare(a.time));
  const seen = new Set();
  const recentUniq = recent.filter(r => (seen.has(r.title) ? false : seen.add(r.title))).slice(0, 12);
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  return f.done({ earnDay, reaction: reaction ? { rms: reaction.rms, excessSd: reaction.excessSd, moves: reaction.moves } : null, upcoming, recent: recentUniq });
}
