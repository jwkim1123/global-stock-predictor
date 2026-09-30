// 지지·저항, 캔들 패턴, 차트 패턴(헤드앤숄더·이중천장/바닥·삼각수렴) 탐지
import { isNum, linreg } from './stats.js';

// 좌우 k봉보다 높은(낮은) 봉 = 스윙 고점(저점)
export function pivots(h, l, from = 0, k = 5) {
  const highs = [], lows = [];
  for (let i = Math.max(from, k); i < h.length - k; i++) {
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (h[j] > h[i]) isH = false;
      if (l[j] < l[i]) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) highs.push(i);
    if (isL) lows.push(i);
  }
  return { highs, lows };
}

export function supportResistance(h, l, c, atrLast, lookback = 250) {
  const n = c.length, from = Math.max(0, n - lookback), price = c[n - 1];
  const { highs, lows } = pivots(h, l, from, 5);
  const pts = [...highs.map(i => ({ p: h[i], i })), ...lows.map(i => ({ p: l[i], i }))].sort((a, b) => a.p - b.p);
  const tol = isNum(atrLast) && atrLast > 0 ? 0.7 * atrLast : price * 0.015;
  const clusters = [];
  for (const pt of pts) {
    const last = clusters[clusters.length - 1];
    if (last && pt.p - last.max <= tol) { last.pts.push(pt); last.max = pt.p; }
    else clusters.push({ pts: [pt], max: pt.p });
  }
  const levels = clusters.map(cl => {
    const w = cl.pts.map(p => 1 + (p.i - from) / lookback); // 최근 접촉에 가중
    const lv = cl.pts.reduce((s, p, k) => s + p.p * w[k], 0) / w.reduce((a, b) => a + b, 0);
    return { price: lv, touches: cl.pts.length, lastAgo: n - 1 - Math.max(...cl.pts.map(p => p.i)) };
  });
  const support = levels.filter(x => x.price < price * 0.998).sort((a, b) => b.price - a.price).slice(0, 3);
  const resistance = levels.filter(x => x.price > price * 1.002).sort((a, b) => a.price - b.price).slice(0, 3);
  return { support, resistance, tol };
}

// 캔들 패턴 (최근 3봉)
export function candlePatterns(o, h, l, c) {
  const n = c.length, out = [];
  if (n < 15) return out;
  const trend = c[n - 4] / c[n - 14] - 1; // 패턴 직전 추세
  const down = trend < -0.03, up = trend > 0.03;
  const bar = i => {
    const body = Math.abs(c[i] - o[i]), range = h[i] - l[i] || 1e-9;
    return { body, range, upper: h[i] - Math.max(o[i], c[i]), lower: Math.min(o[i], c[i]) - l[i], bull: c[i] > o[i], bear: c[i] < o[i] };
  };
  const b0 = bar(n - 1), b1 = bar(n - 2), b2 = bar(n - 3);
  const avgBody = (() => { let s = 0; for (let i = n - 14; i < n - 1; i++) s += Math.abs(c[i] - o[i]); return s / 13; })();
  const add = (name, bias, strength, desc) => out.push({ name, bias, strength, desc });

  if (b0.body <= 0.1 * b0.range) add('도지', 0, 0.2, '매수·매도 균형 → 추세 전환 가능성 탐색');
  if (b0.lower >= 2 * b0.body && b0.upper <= Math.max(0.3 * b0.body, 0.1 * b0.range) && b0.body > 0) {
    if (down) add('망치형(해머)', 1, 0.5, '하락 후 긴 아래꼬리 → 저가 매수세 유입');
    else if (up) add('교수형', -1, 0.4, '상승 후 긴 아래꼬리 → 매도 압력 경고');
  }
  if (b0.upper >= 2 * b0.body && b0.lower <= Math.max(0.3 * b0.body, 0.1 * b0.range) && b0.body > 0) {
    if (up) add('유성형(슈팅스타)', -1, 0.5, '상승 후 긴 윗꼬리 → 고점 매물 출회');
    else if (down) add('역망치형', 1, 0.35, '하락 후 윗꼬리 → 반등 시도');
  }
  if (b1.bear && b0.bull && o[n - 1] <= c[n - 2] && c[n - 1] >= o[n - 2] && b0.body > b1.body && down) add('상승 장악형', 1, 0.6, '전일 음봉을 감싸는 양봉 → 강한 반전 신호');
  if (b1.bull && b0.bear && o[n - 1] >= c[n - 2] && c[n - 1] <= o[n - 2] && b0.body > b1.body && up) add('하락 장악형', -1, 0.6, '전일 양봉을 감싸는 음봉 → 강한 하락 반전 신호');
  if (b2.bear && b2.body > avgBody && b1.body < 0.5 * b2.body && b0.bull && c[n - 1] > (o[n - 3] + c[n - 3]) / 2 && down) add('샛별형(모닝스타)', 1, 0.7, '3봉 반전 패턴 → 바닥 형성 신호');
  if (b2.bull && b2.body > avgBody && b1.body < 0.5 * b2.body && b0.bear && c[n - 1] < (o[n - 3] + c[n - 3]) / 2 && up) add('석별형(이브닝스타)', -1, 0.7, '3봉 반전 패턴 → 천장 형성 신호');
  const soldiers = [n - 3, n - 2, n - 1].every((i, k, arr) => c[i] > o[i] && (k === 0 || c[i] > c[arr[k - 1]]) && (h[i] - c[i]) < 0.3 * (h[i] - l[i] || 1));
  const crows = [n - 3, n - 2, n - 1].every((i, k, arr) => c[i] < o[i] && (k === 0 || c[i] < c[arr[k - 1]]) && (c[i] - l[i]) < 0.3 * (h[i] - l[i] || 1));
  if (soldiers && [b0, b1, b2].every(b => b.body > 0.6 * avgBody)) add('적삼병', 1, 0.5, '3일 연속 강한 양봉 → 상승 추세 강화');
  if (crows && [b0, b1, b2].every(b => b.body > 0.6 * avgBody)) add('흑삼병', -1, 0.5, '3일 연속 강한 음봉 → 하락 추세 강화');
  return out;
}

// 차트 패턴 (최근 약 150봉)
export function chartPatterns(h, l, c, lookback = 150) {
  const n = c.length, from = Math.max(0, n - lookback), last = c[n - 1], out = [];
  const { highs, lows } = pivots(h, l, from, 4);
  const add = (name, bias, status, desc, strength) => out.push({ name, bias, status, desc, strength });

  // 이중 천장 / 이중 바닥
  if (highs.length >= 2) {
    const [i1, i2] = highs.slice(-2);
    const H1 = h[i1], H2 = h[i2];
    let T = Infinity; for (let j = i1; j <= i2; j++) T = Math.min(T, l[j]);
    if (i2 - i1 >= 10 && Math.abs(H2 / H1 - 1) <= 0.03 && T <= Math.min(H1, H2) * 0.95 && n - 1 - i2 <= 40) {
      if (last < T) add('이중 천장', -1, '확인됨', `넥라인 ${T.toFixed(2)} 하향 이탈 → 목표 ${(T - (Math.max(H1, H2) - T)).toFixed(2)}`, 0.7);
      else if (last < Math.min(H1, H2)) add('이중 천장', -1, '형성 중', `두 고점 ${H1.toFixed(2)}/${H2.toFixed(2)}, 넥라인 ${T.toFixed(2)}`, 0.3);
    }
  }
  if (lows.length >= 2) {
    const [i1, i2] = lows.slice(-2);
    const L1 = l[i1], L2 = l[i2];
    let P = -Infinity; for (let j = i1; j <= i2; j++) P = Math.max(P, h[j]);
    if (i2 - i1 >= 10 && Math.abs(L2 / L1 - 1) <= 0.03 && P >= Math.max(L1, L2) * 1.05 && n - 1 - i2 <= 40) {
      if (last > P) add('이중 바닥', 1, '확인됨', `넥라인 ${P.toFixed(2)} 상향 돌파 → 목표 ${(P + (P - Math.min(L1, L2))).toFixed(2)}`, 0.7);
      else if (last > Math.max(L1, L2)) add('이중 바닥', 1, '형성 중', `두 저점 ${L1.toFixed(2)}/${L2.toFixed(2)}, 넥라인 ${P.toFixed(2)}`, 0.3);
    }
  }
  // 헤드앤숄더 / 역헤드앤숄더
  const hs = (pk, isTop) => {
    if (pk.length < 3) return;
    const [a, b, d] = pk.slice(-3);
    const v = isTop ? h : l;
    const A = v[a], B = v[b], C = v[d];
    const headOk = isTop ? B > A * 1.03 && B > C * 1.03 : B < A * 0.97 && B < C * 0.97;
    if (!headOk || Math.abs(A / C - 1) > 0.06 || n - 1 - d > 40) return;
    const ext = (s, e) => { let idx = s; for (let j = s; j <= e; j++) if (isTop ? l[j] < l[idx] : h[j] > h[idx]) idx = j; return idx; };
    const t1 = ext(a, b), t2 = ext(b, d);
    const y1 = isTop ? l[t1] : h[t1], y2 = isTop ? l[t2] : h[t2];
    const neck = y1 + ((y2 - y1) / Math.max(1, t2 - t1)) * (n - 1 - t1);
    const name = isTop ? '헤드앤숄더' : '역헤드앤숄더';
    const broke = isTop ? last < neck : last > neck;
    if (broke) add(name, isTop ? -1 : 1, '확인됨', `넥라인 ${neck.toFixed(2)} ${isTop ? '하향 이탈' : '상향 돌파'}`, 0.8);
    else add(name, isTop ? -1 : 1, '형성 중', `넥라인 ${neck.toFixed(2)} ${isTop ? '이탈' : '돌파'} 여부 주시`, 0.35);
  };
  hs(highs, true);
  hs(lows, false);

  // 삼각수렴 (최근 90봉 내 고점·저점 추세선)
  const recentH = highs.filter(i => i >= n - 90), recentL = lows.filter(i => i >= n - 90);
  if (recentH.length >= 2 && recentL.length >= 2) {
    const rh = linreg(recentH, recentH.map(i => h[i] / last)), rl = linreg(recentL, recentL.map(i => l[i] / last));
    const sH = rh.slope, sL = rl.slope; // 봉당 가격 대비 기울기
    const start = Math.min(recentH[0], recentL[0]);
    const width0 = (rh.intercept + sH * start) - (rl.intercept + sL * start);
    const widthN = (rh.intercept + sH * (n - 1)) - (rl.intercept + sL * (n - 1));
    if (isNum(sH) && isNum(sL) && width0 > 0 && widthN > 0 && widthN < width0 * 0.7) {
      const flat = 0.0004, tilt = 0.0006;
      let name = null, bias = 0;
      if (Math.abs(sH) < flat && sL > tilt) { name = '상승 삼각형'; bias = 1; }
      else if (sH < -tilt && Math.abs(sL) < flat) { name = '하락 삼각형'; bias = -1; }
      else if (sH < -flat && sL > flat) { name = '대칭 삼각수렴'; bias = 0; }
      if (name) {
        const upper = (rh.intercept + sH * (n - 1)) * last, lower = (rl.intercept + sL * (n - 1)) * last;
        if (last > upper * 1.005) add(name, 1, '상향 돌파', `상단 추세선 ${upper.toFixed(2)} 돌파`, 0.6);
        else if (last < lower * 0.995) add(name, -1, '하향 이탈', `하단 추세선 ${lower.toFixed(2)} 이탈`, 0.6);
        else add(name, bias, '수렴 중', `상단 ${upper.toFixed(2)} / 하단 ${lower.toFixed(2)} — 변동성 축소 후 방향 결정 대기`, 0.25);
      }
    }
  }
  return out;
}
