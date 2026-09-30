// 2. 산업·업종: 성장 사이클, 경쟁 구도, 규제, 기술 트렌드, 공급망·원자재 민감도
import { makeFactor } from './base.js';
import { isNum, lin, soft, sma, pctChange, alignTo, weeklyReturns, beta as betaOf, clamp } from '../stats.js';
import { SECTORS, THEMES, STRUCTURAL } from '../config.js';
import { pct, spct, pp, fixed } from '../format.js';
import { RULE_KO } from '../text.js';

export function themeOf(industryKey = '') {
  const k = String(industryKey).toLowerCase();
  return THEMES.find(t => t.match.some(m => k.includes(m))) || null;
}

export function industry(A, ctx, ev) {
  const f = makeFactor('industry');
  if (A.kind === 'index') return indexIndustry(A, ctx);
  const ap = A.summary.assetProfile || {}, sec = SECTORS[ap.sector], etf = sec?.etf;
  const es = etf ? ctx.series[etf] : null, theme = themeOf(ap.industryKey), ts = theme ? ctx.series[theme.etf] : null;
  const acwi6 = pctChange(ctx.series.ACWI, 182);
  const uni = ctx.universeSec?.[ap.sector], peer = ctx.peerStats?.(ap);

  // 산업 성장 사이클
  const C = f.group('산업 성장 사이클', 1.2);
  let phase = null;
  if (es) {
    const m200 = sma(es.c, 200), n = es.c.length, d200 = es.c[n - 1] / m200[n - 1] - 1;
    const r6 = pctChange(es, 182), r12 = pctChange(es, 365), r1 = pctChange(es, 30);
    C.add(`업종 추세 (${etf} 200일선 이격)`, spct(d200), lin(d200, -0.10, 0.10), `${sec.ko} 업종 대표 ETF`);
    C.add('업종 상대 성과 (6개월, 전세계 대비)', pp(r6 - acwi6), lin(r6 - acwi6, -0.10, 0.10), '업종 로테이션 방향');
    C.add('업종 12개월 모멘텀', spct(r12), lin(r12, -0.2, 0.3), '', 0.7);
    const g = uni?.revGrowth;
    if (isNum(g)) C.add('업종 매출 성장률 (유니버스 동종 중앙값)', pct(g), lin(g, -0.05, 0.15), `${uni.n}개 기업 기준`);
    phase = isNum(g)
      ? g > 0.10 && r12 > 0 ? '성장기' : g < 0 && r12 < 0 ? '쇠퇴기' : g < 0.02 && r1 > 0 && d200 > -0.02 ? '회복기' : '성숙기'
      : d200 > 0.05 && r12 > 0.15 ? '성장기' : d200 < -0.05 && r12 < -0.1 ? '쇠퇴기' : '성숙기';
    C.info('산업 사이클 판정', phase, '업종 매출 성장률과 가격 추세로 판정 (성장기/성숙기/회복기/쇠퇴기)');
  } else C.add('업종 추세', null, null, '업종 분류 없음');

  // 경쟁 구도
  const K = f.group('경쟁 구도', 1);
  if (es) {
    const r6s = A.c[A.n - 1] / A.c[Math.max(0, A.n - 126)] - 1, r6e = pctChange(es, 182);
    K.add('업종 내 상대 성과 (6개월)', pp(r6s - r6e), lin(r6s - r6e, -0.2, 0.2), `종목 ${spct(r6s)} vs 업종 ${spct(r6e)}`);
  }
  const om = A.summary.financialData?.operatingMargins;
  if (isNum(om) && isNum(peer?.opMargin)) K.add('동종사 대비 영업이익률', pp(om - peer.opMargin), lin(om - peer.opMargin, -0.10, 0.10), `경쟁력의 결과 지표 (${peer.level} ${peer.n}곳 중앙값 ${pct(peer.opMargin)})`);
  const mna = ev.mna?.length || 0, comp = (A.raw.news || []).filter(n => /\b(competition|competitor|rival|price war|market share)\b|경쟁 심화|점유율/i.test(n.title)).length;
  K.add('경쟁 심화 뉴스 (30일)', `${comp}건`, comp ? -soft(comp, 3) : 0.1, '가격 경쟁·점유율 다툼 관련 헤드라인', 0.5);
  K.info('M&A 관련 뉴스 (30일)', `${mna}건`, mna ? '업계 재편 가능성 — 방향은 사안별로 다름' : '');

  // 규제 환경
  const R = f.group('규제 환경', 0.8);
  const sens = sec?.regSens ?? 0.5;
  const regN = (ev.regulation?.length || 0) + (ev.investigation?.length || 0) + (ev.tariff?.length || 0);
  R.add('규제·조사 관련 뉴스 (30일)', `${regN}건`, regN ? -soft(regN, 3) * (0.5 + sens / 2) : 0.15, `업종 규제 민감도 ${fixed(sens, 1)} (정적 분류)`);
  const tradeSens = ['Technology', 'Industrials', 'Consumer Cyclical', 'Basic Materials'].includes(ap.sector) ? 1 : 0.4;
  const mt = (ctx.marketEvents.tariff?.length || 0);
  R.add('관세·무역분쟁 (시장 전체 뉴스 14일)', `${mt}건`, mt ? -soft(mt, 4) * tradeSens : 0.1, tradeSens > 0.5 ? '교역 민감 업종' : '교역 민감도 낮음', 0.6);

  // 기술 트렌드
  const T = f.group('기술 트렌드', 1);
  if (ts) {
    const r6 = pctChange(ts, 182), m200 = sma(ts.c, 200), d = ts.c[ts.c.length - 1] / m200[ts.c.length - 1] - 1;
    T.add(`${theme.ko} 테마 모멘텀 (${theme.etf}, 6개월)`, `${spct(r6)} (전세계 대비 ${pp(r6 - acwi6)})`, lin(r6 - acwi6, -0.15, 0.25), `200일선 이격 ${spct(d)}`);
  } else T.info('관련 기술 테마', '해당 없음', '');
  const key = String(ap.industryKey || '');
  const structural = STRUCTURAL.growth.some(g => key.includes(g)) ? 0.5 : STRUCTURAL.decline.some(g => key.includes(g)) ? -0.5 : 0;
  T.add('구조적 성장·쇠퇴 산업 여부', structural > 0 ? '구조적 성장 산업' : structural < 0 ? '구조적 쇠퇴 위험 산업' : '중립', structural, '파괴적 혁신 노출도 (정적 분류, 낮은 가중치)', 0.4);
  const rnd = peer?.rnd, myRnd = A.raw.fts?.annual?.length ? (() => { const a = A.raw.fts.annual[A.raw.fts.annual.length - 1]; return isNum(a.researchAndDevelopment) && a.totalRevenue > 0 ? a.researchAndDevelopment / a.totalRevenue : null; })() : null;
  if (isNum(myRnd) && isNum(rnd)) T.add('R&D 강도 (동종 대비)', pp(myRnd - rnd), lin(myRnd - rnd, -0.05, 0.05), `동종 중앙값 ${pct(rnd)}`, 0.5);

  // 공급망·원자재
  const S = f.group('공급망·원자재 민감도 (실증)', 0.8);
  const comm = [['CL=F', '유가'], ['HG=F', '구리']];
  let impact = 0, used = 0;
  for (const [sym, ko] of comm) {
    const x = weeklyReturns(alignTo(A.t, ctx.series[sym], 'c', 5), 104);
    const b = betaOf(A.wk, x), chg = pctChange(ctx.series[sym], 91);
    if (isNum(b) && isNum(chg)) {
      const im = b * Math.log(1 + chg) * 0.5; // 추세 절반 지속 가정
      impact += im; used++;
      S.add(`${ko} 민감도 (주간 베타 ${fixed(b, 2)})`, `${ko} 3개월 ${spct(chg)} → 영향 ${spct(im)}`, soft(im, 0.04), '2년 주간수익률 회귀', 0.8);
    }
  }
  const sup = (ev.supply?.length || 0) + (ev.disaster?.length || 0);
  S.add('공급망 차질·재해 뉴스 (30일)', `${sup}건`, sup ? -soft(sup, 2) : 0.1, '', 0.6);
  if (phase) f.hi(`${sec?.ko || ''} 업종 사이클: ${phase}`, phase === '성장기' || phase === '회복기' ? 1 : phase === '쇠퇴기' ? -1 : 0);
  return f.done({ phase, theme: theme?.ko || null, sectorKo: sec?.ko || ap.sector || null });
}

// 지수: 지역 내 업종 구성보다는 글로벌 로테이션(지역 상대 성과)으로 대체
function indexIndustry(A, ctx) {
  const f = makeFactor('industry');
  const g = f.group('글로벌 자금 로테이션', 1);
  const n = A.n, r6 = A.c[n - 1] / A.c[Math.max(0, n - 126)] - 1, acwi6 = pctChange(ctx.series.ACWI, 182);
  g.add('전세계 대비 6개월 상대 성과', pp(r6 - acwi6), lin(r6 - acwi6, -0.15, 0.15), '글로벌 자금의 지역 선호');
  const eem = pctChange(ctx.series.EEM, 91), spy = pctChange(ctx.series.SPY, 91);
  const isEM = ['KR', 'CN', 'HK', 'TW', 'IN', 'BR'].includes(A.market);
  if (isNum(eem) && isNum(spy)) g.add(isEM ? '신흥국 vs 미국 (3개월)' : '미국 vs 신흥국 (3개월)', pp(isEM ? eem - spy : spy - eem), lin(isEM ? eem - spy : spy - eem, -0.1, 0.1), '', 0.6);
  return f.done();
}
