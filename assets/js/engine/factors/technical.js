// 4. 기술적 분석: 추세·이동평균, 모멘텀(RSI·MACD·스토캐스틱), 거래량, 지지/저항, 캔들·차트 패턴, 상대강도
import { makeFactor } from './base.js';
import { isNum, lin, soft, linreg, rollingMax, rollingMin, percentileRank } from '../stats.js';
import { crossRecency } from '../indicators.js';
import { supportResistance, candlePatterns, chartPatterns } from '../patterns.js';
import { pct, spct, pp, fixed, price as fmtPrice } from '../format.js';

export function technical(A, ctx) {
  const f = makeFactor('technical');
  const { c, h, l, o, v, n, ind } = A, i = n - 1, px = c[i], ccy = A.currency;

  // 추세
  const T = f.group('추세·이동평균', 1.3);
  const above = [['20일', ind.ma20], ['60일', ind.ma60], ['120일', ind.ma120], ['200일', ind.ma200]].map(([k, m]) => [k, px / m[i] - 1]);
  for (const [k, d] of above) T.add(`${k} 이동평균 이격도`, spct(d), lin(d, -0.08, 0.08), '', k === '200일' ? 1.2 : 0.7);
  const aligned = ind.ma20[i] > ind.ma60[i] && ind.ma60[i] > ind.ma120[i] ? 1 : ind.ma20[i] < ind.ma60[i] && ind.ma60[i] < ind.ma120[i] ? -1 : 0;
  T.add('이동평균 배열', aligned > 0 ? '정배열 (20>60>120)' : aligned < 0 ? '역배열 (20<60<120)' : '혼조', aligned * 0.8, '정배열은 상승 추세 지속 신호');
  const gc = crossRecency(ind.ma50, ind.ma200, 30), gc2 = crossRecency(ind.ma20, ind.ma60, 15);
  T.add('50/200일선 교차 (최근 30일)', gc ? `${gc.type === 'golden' ? '골든크로스' : '데드크로스'} (${gc.ago}일 전)` : '교차 없음', gc ? (gc.type === 'golden' ? 0.7 : -0.7) : ind.ma50[i] > ind.ma200[i] ? 0.25 : -0.25,
    gc ? '' : ind.ma50[i] > ind.ma200[i] ? '50일선이 200일선 위 (장기 상승 구조)' : '50일선이 200일선 아래 (장기 하락 구조)');
  if (gc2) T.add('20/60일선 교차 (최근 15일)', `${gc2.type === 'golden' ? '골든크로스' : '데드크로스'} (${gc2.ago}일 전)`, gc2.type === 'golden' ? 0.5 : -0.5, '단기 추세 전환', 0.6);
  const lr = linreg([...Array(60).keys()], c.slice(-60).map(Math.log));
  const annSlope = Math.exp(lr.slope * 252) - 1;
  T.add('60일 추세 기울기 (연율) · 결정계수', `${spct(annSlope, 0)} · R² ${fixed(lr.r2, 2)}`, soft(annSlope, 0.4) * (0.4 + 0.6 * lr.r2), '결정계수가 높을수록 추세가 뚜렷');
  const adx = ind.adx.adx[i], pdi = ind.adx.pdi[i], mdi = ind.adx.mdi[i];
  T.add('ADX 추세 강도 (+DI/−DI)', `${fixed(adx, 0)} (${fixed(pdi, 0)}/${fixed(mdi, 0)})`, isNum(adx) ? Math.sign(pdi - mdi) * lin(adx, 15, 35) * 0.5 + Math.sign(pdi - mdi) * 0.5 : null, 'ADX 25 이상이면 추세장, 방향은 DI로 판단', 0.8);

  // 모멘텀
  const Mo = f.group('모멘텀 지표', 1);
  const rsi = ind.rsi14[i];
  const rsiScore = !isNum(rsi) ? null : rsi > 80 ? -0.6 : rsi > 70 ? -0.2 : rsi > 55 ? 0.4 : rsi > 45 ? 0 : rsi > 30 ? -0.3 : rsi > 20 ? 0.2 : 0.5;
  Mo.add('RSI(14)', fixed(rsi, 1), rsiScore, rsi > 70 ? '과매수 구간 — 단기 조정 가능성' : rsi < 30 ? '과매도 구간 — 기술적 반등 가능성' : rsi > 55 ? '상승 모멘텀 우위' : rsi < 45 ? '하락 모멘텀 우위' : '중립');
  const mh = ind.macd.hist, macdLine = ind.macd.line[i], sig = ind.macd.signal[i];
  const mcross = crossRecency(ind.macd.line, ind.macd.signal, 10);
  Mo.add('MACD (12,26,9)', `${mh[i] > 0 ? '시그널 위' : '시그널 아래'}${mcross ? ` · ${mcross.ago}일 전 ${mcross.type === 'golden' ? '상향' : '하향'} 교차` : ''}`,
    0.5 * Math.sign(mh[i]) + 0.3 * Math.sign(mh[i] - mh[i - 3]) + (mcross ? (mcross.type === 'golden' ? 0.2 : -0.2) : 0), `MACD ${fixed(macdLine, 2)} / 시그널 ${fixed(sig, 2)}`);
  const k = ind.stoch.k[i], d = ind.stoch.d[i];
  const stScore = !isNum(k) ? null : k > 80 && k < d ? -0.5 : k < 20 && k > d ? 0.5 : k > 80 ? -0.1 : k < 20 ? 0.1 : (k - d) / 40;
  Mo.add('스토캐스틱 (14,3,3)', `%K ${fixed(k, 0)} / %D ${fixed(d, 0)}`, stScore, k > 80 ? '과열권' : k < 20 ? '침체권' : '', 0.7);
  const mom = A.n > 252 ? A.ac[i - 21] / A.ac[i - 252] - 1 : null;
  Mo.add('12-1개월 모멘텀', spct(mom), lin(mom, -0.3, 0.4), '학계에서 가장 많이 검증된 모멘텀 팩터 (최근 1개월 제외)', 1.2);
  const roc20 = c[i] / c[i - 20] - 1;
  Mo.add('20일 변화율', spct(roc20), lin(roc20, -0.12, 0.12), '', 0.6);

  // 거래량
  const Vg = f.group('거래량', 0.8);
  if (A.hasVolume) {
    const avg = (a, b) => { let s = 0; for (let j = n - a; j < n - b; j++) s += v[j]; return s / (a - b); };
    const vr = avg(20, 0) / avg(60, 0);
    const trendUp = c[i] > c[i - 20];
    Vg.add('거래량 증감 (20일/60일)', pct(vr - 1, 0), (vr > 1.15 ? 1 : vr < 0.85 ? -0.5 : 0) * (trendUp ? 0.6 : -0.6), trendUp ? '상승과 함께 거래량 증가 = 추세 확인' : '하락과 함께 거래량 증가 = 매도 압력');
    let upV = 0, dnV = 0;
    for (let j = n - 20; j < n; j++) { if (c[j] > c[j - 1]) upV += v[j]; else if (c[j] < c[j - 1]) dnV += v[j]; }
    const udr = dnV > 0 ? upV / dnV : null;
    Vg.add('상승일/하락일 거래량 비율 (20일)', fixed(udr, 2), isNum(udr) ? lin(Math.log(udr), -0.4, 0.4) : null, '1 초과면 매집 우위');
    const obvSlope = linreg([...Array(20).keys()], ind.obv.slice(-20)).slope;
    const avgV = avg(60, 0);
    Vg.add('OBV 추세 (20일)', obvSlope > 0 ? '상승' : '하락', isNum(obvSlope) && avgV > 0 ? soft(obvSlope / avgV, 0.3) : null, '거래량 누적 흐름', 0.7);
  } else Vg.add('거래량', null, null, '거래량 데이터 없음');

  // 지지/저항
  const SR = f.group('지지선·저항선', 0.8);
  const atr = ind.atr14[i];
  const sr = supportResistance(h, l, c, atr, 250);
  const s1 = sr.support[0], r1 = sr.resistance[0];
  const dS = s1 ? (px - s1.price) / atr : null, dR = r1 ? (r1.price - px) / atr : null;
  SR.add('가장 가까운 지지선', s1 ? `${fmtPrice(s1.price, ccy)} (${spct(s1.price / px - 1)}, 접촉 ${s1.touches}회)` : '뚜렷한 지지선 없음', isNum(dS) ? (dS < 1.5 ? 0.3 + 0.1 * Math.min(s1.touches, 4) : 0) : -0.2, `ATR ${fixed(dS, 1)}배 거리`);
  SR.add('가장 가까운 저항선', r1 ? `${fmtPrice(r1.price, ccy)} (${spct(r1.price / px - 1)}, 접촉 ${r1.touches}회)` : '저항선 없음 (신고가 영역)', isNum(dR) ? (dR < 1.5 ? -0.3 - 0.1 * Math.min(r1.touches, 4) : 0.1) : 0.4, `ATR ${fixed(dR, 1)}배 거리`);
  const hi52 = Math.max(...h.slice(-252)), lo52 = Math.min(...l.slice(-252)), pos52 = (px - lo52) / (hi52 - lo52);
  SR.add('52주 가격 범위 내 위치', pct(pos52, 0), lin(pos52, 0.1, 0.9) * 0.6, `52주 최고 ${fmtPrice(hi52, ccy)} · 최저 ${fmtPrice(lo52, ccy)}`);
  const bbp = ind.bb.pctB[i], bw = ind.bb.width, bwPct = percentileRank(bw.slice(-250), bw[i]);
  SR.add('볼린저밴드 %B · 밴드폭', `${fixed(bbp, 2)} · 폭 하위 ${pct(bwPct, 0)}`, isNum(bbp) ? (bbp > 1 ? -0.3 : bbp < 0 ? 0.3 : 0) : null, bwPct < 0.15 ? '밴드 수축(스퀴즈) — 큰 변동 임박 가능성' : '', 0.5);

  // 패턴
  const P = f.group('캔들·차트 패턴', 0.7);
  const cp = candlePatterns(o, h, l, c), chp = chartPatterns(h, l, c, 150);
  if (!cp.length && !chp.length) P.info('탐지된 패턴', '없음', '최근 3봉 캔들 및 150봉 차트 패턴 검사');
  for (const p of cp) P.add(`캔들: ${p.name}`, p.bias > 0 ? '상승 신호' : p.bias < 0 ? '하락 신호' : '중립', p.bias * p.strength, p.desc, 0.6);
  for (const p of chp) P.add(`차트: ${p.name}`, p.status, p.bias * p.strength, p.desc, p.status === '확인됨' || p.status.includes('돌파') || p.status.includes('이탈') ? 1.2 : 0.6);

  // 상대강도
  const RS = f.group('상대강도 (시장 대비)', 1);
  const b = A.bench;
  const ex = k => (i - k >= 0 && isNum(b[i]) && isNum(b[i - k]) ? (A.ac[i] / A.ac[i - k]) / (b[i] / b[i - k]) - 1 : null);
  const ex1 = ex(21), ex3 = ex(63), ex6 = ex(126), ex12 = ex(252);
  const bname = A.kind === 'index' ? '전세계(ACWI)' : A.benchSym;
  RS.add(`1개월 초과수익 (vs ${bname})`, pp(ex1), lin(ex1, -0.08, 0.08), '', 0.6);
  RS.add('3개월 초과수익', pp(ex3), lin(ex3, -0.12, 0.12), '');
  RS.add('6개월 초과수익', pp(ex6), lin(ex6, -0.2, 0.2), '');
  RS.add('12개월 초과수익', pp(ex12), lin(ex12, -0.3, 0.3), '', 0.8);
  const rsLine = A.ac.map((x, j) => (isNum(b[j]) ? x / b[j] : NaN)), rsNow = rsLine[i];
  const rsMa = rsLine.slice(-252).filter(isNum).reduce((s, x, _, arr) => s + x / arr.length, 0);
  RS.add('맨스필드 RS (52주 평균 대비)', spct(rsNow / rsMa - 1), lin(rsNow / rsMa - 1, -0.15, 0.15), '0 이상이면 시장 주도주');
  const te = A.raw.insights?.instrumentInfo?.technicalEvents;
  if (te) {
    const dir = o => (o?.direction === 'Bullish' ? 1 : o?.direction === 'Bearish' ? -1 : 0) * Math.min(1, (o?.score || 0) / 3);
    RS.add('외부 기술적 전망 (Trading Central)', `단기 ${te.shortTermOutlook?.direction || '—'} · 중기 ${te.intermediateTermOutlook?.direction || '—'} · 장기 ${te.longTermOutlook?.direction || '—'}`,
      (dir(te.shortTermOutlook) + dir(te.intermediateTermOutlook) + dir(te.longTermOutlook)) / 3, '외부 기술적 이벤트 기반 의견 (참고용)', 0.4);
  }

  if (aligned > 0 && above[3][1] > 0) f.hi('이동평균 정배열 + 200일선 위 — 상승 추세', 1);
  if (aligned < 0 && above[3][1] < 0) f.hi('이동평균 역배열 + 200일선 아래 — 하락 추세', -1);
  if (gc) f.hi(`50/200일선 ${gc.type === 'golden' ? '골든크로스' : '데드크로스'} (${gc.ago}일 전)`, gc.type === 'golden' ? 1 : -1);
  for (const p of chp.filter(p => p.status !== '형성 중' && p.status !== '수렴 중')) f.hi(`차트 패턴: ${p.name} ${p.status}`, p.bias);
  if (isNum(rsi) && rsi > 75) f.hi(`RSI ${fixed(rsi, 0)} 과매수`, -1);
  if (isNum(rsi) && rsi < 25) f.hi(`RSI ${fixed(rsi, 0)} 과매도`, 1);
  return f.done({ levels: { support: sr.support, resistance: sr.resistance }, patterns: { candles: cp, charts: chp } });
}
