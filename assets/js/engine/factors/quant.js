// 8. 계량·통계: 베타, 변동성(역사적·GARCH·내재), 상관관계, 계절성, 수익률 분포 특성
import { makeFactor } from './base.js';
import { isNum, lin, soft, std, mean, skewness, exKurtosis, corr, alignTo, weeklyReturns, maxDrawdown, clamp } from '../stats.js';
import { garchFit, ewmaSigma, tDof, hurst } from '../volatility.js';
import { pct, spct, fixed } from '../format.js';

const SQ = Math.sqrt(252);

export function seasonality(A) {
  // 월말 수정주가로 완결된 월간 수익률 → 달력 월별 평균·승률
  const byMonth = Array.from({ length: 12 }, () => []);
  const month = i => new Date(A.t[i] * 864e5).getUTCMonth();
  const ends = [];
  for (let i = 0; i < A.n - 1; i++) if (month(i) !== month(i + 1)) ends.push(i);
  for (let k = 1; k < ends.length; k++) byMonth[month(ends[k])].push(A.ac[ends[k]] / A.ac[ends[k - 1]] - 1);
  return byMonth.map((arr, m) => ({ m: m + 1, avg: arr.length ? mean(arr) : null, win: arr.length ? arr.filter(x => x > 0).length / arr.length : null, n: arr.length, sd: arr.length > 2 ? std(arr) : null }));
}

export function quant(A, ctx) {
  const f = makeFactor('quant');
  const r = A.r, i = A.n - 1;

  // 베타
  const B = f.group('베타 (시장 민감도)', 0.8);
  const bl = A.beta.local, bg = A.beta.global;
  const down = A.wk.map((x, k) => (A.wkB[k] < 0 ? [x, A.wkB[k]] : null)).filter(Boolean);
  const bDown = down.length > 10 ? (() => { const x = down.map(p => p[1]), y = down.map(p => p[0]); const mx = mean(x), my = mean(y); let c = 0, v = 0; for (let k = 0; k < x.length; k++) { c += (x[k] - mx) * (y[k] - my); v += (x[k] - mx) ** 2; } return c / v; })() : null;
  if (A.kind !== 'index') B.info(`베타 (vs ${A.benchSym}, 2년 주간)`, fixed(bl, 2), '1보다 크면 시장보다 크게 움직임');
  B.info('글로벌 베타 (vs ACWI)', fixed(bg, 2), '');
  B.info('하락장 베타', fixed(bDown, 2), '시장 하락 주간만의 민감도 — 높을수록 하락 시 취약');
  B.add('베타 × 시장 레짐', `레짐 점수 ${fixed(ctx.macro.score, 2)}`, isNum(bg) ? soft((bg - 1) * ctx.macro.score * 2, 1) : null, '우호적 국면에선 고베타, 비우호적 국면에선 저베타가 유리');

  // 변동성
  const V = f.group('변동성 (역사적·GARCH·내재)', 1);
  const hv = k => std(r.slice(-k)) * SQ;
  const hv20 = hv(20), hv60 = hv(60), hv252 = hv(252);
  const g = garchFit(r), ew = ewmaSigma(r.slice(-500));
  const garchAnn = g ? Math.sqrt(g.hNext) * SQ : null, garchLR = g ? Math.sqrt(g.longRunVar) * SQ : null;
  V.info('역사적 변동성 (20일 / 60일 / 1년)', `${pct(hv20, 0)} / ${pct(hv60, 0)} / ${pct(hv252, 0)}`, '연율화');
  V.info('GARCH(1,1) 예측 변동성 (다음 날 → 장기)', g ? `${pct(garchAnn, 0)} → ${pct(garchLR, 0)} (지속성 ${fixed(g.persistence, 3)})` : '추정 불가', '변동성 군집을 반영한 조건부 변동성');
  const iv = A.raw.options?.atmIV;
  if (isNum(iv)) {
    V.add('내재변동성 / 역사적 변동성', `${pct(iv, 0)} / ${pct(hv60, 0)} = ${fixed(iv / hv60, 2)}`, lin(iv / hv60, 1.5, 0.9) * 0.6, `옵션시장이 예상하는 ${A.raw.options.days}일 변동성 (ATM). 1.3배 이상이면 이벤트 경계`, 0.8);
    if (isNum(A.raw.options.pcVolume)) V.info('옵션 풋/콜 거래량 비율', fixed(A.raw.options.pcVolume, 2), '1 이상이면 하방 헤지 수요 우위');
  }
  V.add('저변동성 프리미엄', pct(hv252, 0), lin(hv252, 0.6, 0.2) * 0.6, '장기적으로 저변동성 주식의 위험조정 수익률이 높았던 이상현상', 0.6);
  const vr = hv20 / hv252;
  V.add('변동성 국면 (20일/1년)', fixed(vr, 2), lin(vr, 1.6, 0.8) * 0.5, vr > 1.3 ? '변동성 확대 국면' : vr < 0.8 ? '변동성 축소 국면' : '평상 수준', 0.6);

  // 상관관계
  const Cg = f.group('상관관계 (2년 주간)', 0.3);
  const assets = [['ACWI', '전세계 주식'], ['TLT', '미 장기국채'], ['GC=F', '금'], ['DX-Y.NYB', '달러'], ['CL=F', '원유'], ['BTC-USD', '비트코인']];
  const corrs = {};
  if (A.kind !== 'index') { corrs[A.benchSym] = corr(A.wk, A.wkB); Cg.info(`자국 지수 (${A.benchSym})`, fixed(corrs[A.benchSym], 2), ''); }
  const sec = ctx.sectorEtfOf?.(A);
  if (sec) { const x = weeklyReturns(alignTo(A.t, ctx.series[sec], 'c', 5), 104); corrs[sec] = corr(A.wk, x); Cg.info(`업종 ETF (${sec})`, fixed(corrs[sec], 2), ''); }
  for (const [sym, ko] of assets) {
    const x = weeklyReturns(alignTo(A.t, ctx.series[sym], 'c', 5), 104);
    corrs[sym] = corr(A.wk, x);
    Cg.info(ko, fixed(corrs[sym], 2), '');
  }
  Cg.add('분산투자 효과', `전세계 주식과 상관 ${fixed(corrs.ACWI, 2)}`, isNum(corrs.ACWI) ? lin(corrs.ACWI, 0.9, 0.3) * 0.3 : null, '상관이 낮을수록 포트폴리오 분산 효과 큼', 0.3);

  // 계절성
  const Sn = f.group('계절성', 0.6);
  const seas = seasonality(A);
  const nowM = new Date(A.day * 864e5).getUTCMonth();
  const next = seas[(nowM + 1) % 12], cur = seas[nowM];
  const rel = s => (isNum(s?.avg) && isNum(s?.sd) && s.n >= 5 ? Math.min(1, Math.abs(s.avg) / (s.sd / Math.sqrt(s.n)) / 2) : 0.3);
  Sn.add(`이번 달(${nowM + 1}월) 과거 평균`, cur?.avg !== null ? `${spct(cur.avg)} · 승률 ${pct(cur.win, 0)} (${cur.n}년)` : null, isNum(cur?.avg) ? lin(cur.avg, -0.03, 0.03) * rel(cur) : null, '', 0.5);
  Sn.add(`다음 달(${((nowM + 1) % 12) + 1}월) 과거 평균`, next?.avg !== null ? `${spct(next.avg)} · 승률 ${pct(next.win, 0)} (${next.n}년)` : null, isNum(next?.avg) ? lin(next.avg, -0.03, 0.03) * rel(next) : null, '표본이 적어 통계적 신뢰도는 제한적');

  // 분포 특성
  const D = f.group('수익률 분포·위험조정 성과', 1);
  const r1 = r.slice(-252).filter(isNum), r3 = r.slice(-756).filter(isNum);
  const sharpe = x => (x.length > 50 ? (mean(x) * 252 - (ctx.rf[A.market]?.rate || 0.03)) / (std(x) * SQ) : null);
  const sortino = x => { const dn = x.filter(v => v < 0); return dn.length > 10 ? (mean(x) * 252) / (Math.sqrt(dn.reduce((s, v) => s + v * v, 0) / x.length) * SQ) : null; };
  const sh1 = sharpe(r1), sh3 = sharpe(r3);
  D.add('샤프 지수 (1년 / 3년)', `${fixed(sh1, 2)} / ${fixed(sh3, 2)}`, isNum(sh1) ? 0.6 * lin(sh1, -0.5, 1.5) + 0.4 * (lin(sh3, -0.3, 1.2) ?? 0) : null, '위험 한 단위당 초과수익 (위험조정 모멘텀)');
  D.info('소르티노 지수 (1년)', fixed(sortino(r1), 2), '하방 변동성만 위험으로 계산');
  const H = hurst(r.slice(-756));
  D.info('허스트 지수', fixed(H, 2), isNum(H) ? (H > 0.55 ? '추세 지속 성향 — 모멘텀 신호 신뢰도↑' : H < 0.45 ? '평균회귀 성향 — 역추세 신호 신뢰도↑' : '무작위 보행에 가까움') : '');
  D.info('왜도 / 초과첨도 (3년 일간)', `${fixed(skewness(r3), 2)} / ${fixed(exKurtosis(r3), 1)}`, '첨도가 클수록 극단적 움직임(꼬리위험) 빈번');
  const mdd1 = maxDrawdown(A.ac.slice(-252)), mdd3 = maxDrawdown(A.ac.slice(-756));
  D.add('최대 낙폭 (1년 / 3년)', `${pct(mdd1, 0)} / ${pct(mdd3, 0)}`, lin(mdd1, -0.5, -0.1) * 0.5, '', 0.5);
  const ac1 = corr(A.wk.slice(1), A.wk.slice(0, -1));
  D.info('주간 수익률 자기상관', fixed(ac1, 2), '양수면 단기 추세 지속, 음수면 반전 경향');

  const nu = g ? tDof(g.z) : 6;
  return f.done({
    vol: { garch: g ? { alpha: g.alpha, beta: g.beta, persistence: g.persistence, hNext: g.hNext, longRunVar: g.longRunVar } : null, garchObj: g, ewma: ew, hv20, hv60, hv252, iv, nu, hurst: H },
    seasonality: seas, corrs, betaDown: bDown, sharpe1: sh1,
  });
}

export { clamp };
