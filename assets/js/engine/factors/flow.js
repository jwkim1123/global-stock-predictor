// 5. 수급: 투자자별 매매(한국: 외국인·기관·개인), 기관 동향, 공매도, 과열(신용) 프록시, 대량 매물·락업, 지수 편입, 가격-거래량 수급
import { makeFactor } from './base.js';
import { isNum, lin, soft, linreg } from '../stats.js';
import { pct, spct, pp, fixed, big, num } from '../format.js';

const asNum = v => (typeof v === 'number' ? v : typeof v === 'string' && !isNaN(Date.parse(v)) ? Date.parse(v) / 1000 : null);

export function flow(A, ctx, ev) {
  const f = makeFactor('flow');
  const s = A.summary, ks = s.defaultKeyStatistics || {}, i = A.n - 1;
  const mcap = A.marketCap;

  // 투자자별 매매 동향
  const Inv = f.group('투자자별 매매 동향', 1.3);
  const fl = A.raw.flows;
  if (fl?.length >= 10) {
    const last = fl.slice(-20);
    const val = key => last.reduce((acc, r) => acc + (r[key] || 0) * (r.close || 0), 0);
    const fv = val('foreign'), ov = val('organ'), iv = val('indiv');
    const base = isNum(mcap) && mcap > 0 ? mcap : null;
    Inv.add('외국인 순매수 (20일)', `${big(fv, 'KRW')}${base ? ` (시총 대비 ${pct(fv / base, 2)})` : ''}`, base ? lin(fv / base, -0.004, 0.004) : soft(fv, 1e11), '네이버 증권 일별 순매수 × 종가', 1.2);
    Inv.add('기관 순매수 (20일)', `${big(ov, 'KRW')}${base ? ` (시총 대비 ${pct(ov / base, 2)})` : ''}`, base ? lin(ov / base, -0.004, 0.004) : soft(ov, 1e11), '');
    Inv.add('개인 순매수 (20일)', big(iv, 'KRW'), base ? lin(iv / base, 0.004, -0.004) * 0.5 : null, '개인만 순매수하고 외국인·기관이 매도하면 수급 약화', 0.5);
    const fr0 = last[0].foreignRatio, fr1 = last[last.length - 1].foreignRatio;
    if (isNum(fr0) && isNum(fr1)) Inv.add('외국인 보유율 변화 (20일)', `${pct(fr1, 2)} (${pp(fr1 - fr0, 2)})`, lin(fr1 - fr0, -0.006, 0.006), '');
    let streak = 0;
    for (let k = fl.length - 1; k >= 0; k--) { const sgn = Math.sign(fl[k].foreign || 0); if (!streak) streak = sgn; else if (sgn !== Math.sign(streak)) break; else streak += sgn; }
    Inv.info('외국인 연속 매매', streak > 0 ? `${streak}일 연속 순매수` : streak < 0 ? `${-streak}일 연속 순매도` : '—', '');
    if (base && fv / base < -0.003) f.hi(`외국인 20일 순매도 ${big(-fv, 'KRW')}`, -1);
    if (base && fv / base > 0.003) f.hi(`외국인 20일 순매수 ${big(fv, 'KRW')}`, 1);
  } else if (A.kind !== 'index') {
    const nsp = s.netSharePurchaseActivity;
    if (nsp && isNum(nsp.netInstBuyingPercent)) Inv.add('기관 순매수 (최근 분기)', spct(nsp.netInstBuyingPercent, 1), lin(nsp.netInstBuyingPercent, -0.2, 0.2), '13F 보고 기준 기관 보유 주식 순증감 (보고 시차·집계 방식에 따라 변동 큼)', 0.6);
    const inst = s.institutionOwnership?.ownershipList || [];
    if (inst.length) {
      const up = inst.filter(o => (o.pctChange || 0) > 0).length;
      Inv.add('상위 기관 보유 증가 비율', `${up}/${inst.length}곳 증가`, lin(up / inst.length, 0.2, 0.8), '', 0.7);
    }
    if (isNum(ks.heldPercentInstitutions)) Inv.info('기관 보유 비중', pct(ks.heldPercentInstitutions, 1), '');
    if (A.market === 'KR') Inv.info('외국인·기관 일별 매매', '수집 실패', '');
  } else Inv.info('투자자별 매매', '지수 단위 데이터 없음', '가격-거래량 기반 수급 지표로 대체');

  // 공매도
  const Sh = f.group('공매도', 0.9);
  const spf = ks.shortPercentOfFloat, sr = ks.shortRatio;
  if (isNum(spf)) {
    Sh.add('공매도 비율 (유통주식 대비)', pct(spf, 2), lin(spf, 0.15, 0.01), spf > 0.15 ? '높은 공매도 — 하락 베팅 많음 (숏스퀴즈 가능성도 존재)' : '');
    Sh.add('숏 커버링 소요일 (Days to cover)', isNum(sr) ? `${fixed(sr, 1)}일` : null, lin(sr, 8, 1), '', 0.5);
    const prior = asNum(ks.sharesShortPriorMonth), now = ks.sharesShort;
    if (isNum(prior) && prior > 0 && isNum(now)) Sh.add('공매도 잔고 변화 (전월 대비)', spct(now / prior - 1), lin(now / prior - 1, 0.25, -0.25), '');
  } else Sh.info('공매도 잔고', A.market === 'KR' ? '미제공' : '데이터 없음', A.market === 'KR' ? '국내 공매도 잔고는 무료 공개 API 부재로 미반영' : '');

  // 신용·레버리지 과열 프록시
  const Lv = f.group('신용·과열 (레버리지 프록시)', 0.6);
  const rsi = A.ind.rsi14[i], d200 = A.c[i] / A.ind.ma200[i] - 1;
  const volZ = A.hasVolume ? (A.v.slice(-5).reduce((a, b) => a + b, 0) / 5) / (A.v.slice(-60).reduce((a, b) => a + b, 0) / 60) : 1;
  const heat = (rsi > 70 ? (rsi - 70) / 20 : 0) + (d200 > 0.25 ? (d200 - 0.25) / 0.35 : 0) + (volZ > 2 ? (volZ - 2) / 3 : 0);
  Lv.add('과열도 (RSI·200일 이격·거래량 급증)', heat > 0.8 ? '과열' : heat > 0.3 ? '다소 과열' : '정상', -Math.min(1, heat), '신용융자 잔고는 무료 데이터가 없어 가격·거래량 과열로 대체 — 과열 시 반대매매 위험');

  // 대량 매물·락업
  const O = f.group('대량 매물·희석·락업', 0.8);
  const ftd = A.summary.quoteType?.firstTradeDateEpochUtc || A.raw.meta?.firstTradeDate;
  const ageDays = ftd ? (A.day * 864e5 - Date.parse(ftd)) / 864e5 : null;
  if (isNum(ageDays) && ageDays < 400) {
    const toLock = 180 - ageDays;
    O.add('상장 후 경과일 · 보호예수 해제', `${Math.round(ageDays)}일`, Math.abs(toLock) < 30 ? -0.7 : toLock > 0 ? -0.3 : 0, toLock > 0 ? `약 ${Math.round(toLock)}일 후 180일 보호예수 해제 예상` : '보호예수 해제 직후 물량 부담');
  } else O.info('상장 경과', isNum(ageDays) ? `${Math.round(ageDays / 365)}년` : '—', '신규상장 락업 이슈 없음');
  const qs = (A.raw.fts?.quarterly || []).filter(r => isNum(r.ordinarySharesNumber ?? r.dilutedAverageShares));
  if (qs.length >= 4) {
    const a = qs[qs.length - 1], b = qs[Math.max(0, qs.length - 5)];
    const d = (a.ordinarySharesNumber ?? a.dilutedAverageShares) / (b.ordinarySharesNumber ?? b.dilutedAverageShares) - 1;
    O.add('주식 수 변화 (최근 1년, 분기)', spct(d, 2), lin(d, 0.05, -0.02), '증가 = 증자·전환 등 희석');
  }
  const off = ev.offering?.length || 0;
  O.add('증자·블록딜·전환사채 뉴스 (30일)', `${off}건`, off ? -soft(off, 1.5) : 0.1, '');

  // 지수·ETF 편출입
  const E = f.group('지수·ETF 편입/편출', 0.5);
  const inN = ev.indexIn?.length || 0, outN = ev.indexOut?.length || 0;
  E.add('편입/편출 관련 뉴스 (30일)', `편입 ${inN}건 · 편출 ${outN}건`, inN || outN ? soft(inN - outN, 1) : 0, '지수 편입 시 패시브 자금 유입');

  // 가격-거래량 기반 수급
  const Pv = f.group('가격·거래량 기반 수급 (스마트머니 프록시)', 1);
  if (A.hasVolume) {
    const cmf = A.ind.cmf[i];
    Pv.add('CMF 자금흐름 (20일)', fixed(cmf, 3), lin(cmf, -0.2, 0.2), '양수 = 종가가 고가 쪽에서 형성되며 매집');
    const adl = A.ind.mf.adl, adlSlope = linreg([...Array(40).keys()], adl.slice(-40)).slope, prSlope = linreg([...Array(40).keys()], A.c.slice(-40)).slope;
    const avgV = A.v.slice(-60).reduce((x, y) => x + y, 0) / 60;
    Pv.add('누적분산선 추세 (40일)', adlSlope > 0 ? (prSlope < 0 ? '상승 (가격과 강세 다이버전스)' : '상승') : prSlope > 0 ? '하락 (가격과 약세 다이버전스)' : '하락',
      isNum(adlSlope) && avgV > 0 ? soft(adlSlope / avgV, 0.3) : null, '가격과 반대로 움직이면 추세 전환 신호');
    const m50 = A.v.slice(-110, -60).reduce((x, y) => x + y, 0) / 50 || avgV;
    let up = 0, dn = 0;
    for (let j = A.n - 60; j < A.n; j++) if (A.v[j] > 2 * m50) { if (A.c[j] > A.c[j - 1]) up++; else dn++; }
    Pv.add('대량 거래일 방향 (60일)', `상승 ${up}일 · 하락 ${dn}일`, (up - dn) / (up + dn + 2), '평균의 2배 이상 거래된 날', 0.7);
  } else Pv.add('가격·거래량 수급', null, null, '거래량 데이터 없음');
  return f.done();
}
