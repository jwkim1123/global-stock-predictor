// 요인 결과 빌더: 그룹 → 세부 지표(값·점수·해석) → 그룹 점수 → 요인 점수·신뢰도
import { isNum, clamp } from '../stats.js';

export function makeFactor(key) {
  const groups = [], highlights = [];
  return {
    group(name, weight = 1) {
      const g = { name, weight, items: [] };
      groups.push(g);
      const api = {
        // score: -1(매우 부정) ~ +1(매우 긍정), null = 데이터 없음
        add(label, value, score, note = '', w = 1) {
          g.items.push({ label, value: value ?? null, score: isNum(score) ? clamp(score, -1, 1) : null, note, w });
          return api;
        },
        info(label, value, note = '') {
          g.items.push({ label, value: value ?? null, score: null, note, w: 0, info: true });
          return api;
        },
      };
      return api;
    },
    hi(text, tone = 0) { highlights.push({ text, tone }); },
    done(extra = {}) {
      for (const g of groups) {
        const scored = g.items.filter(i => !i.info);
        const avail = scored.filter(i => isNum(i.score));
        const tw = scored.reduce((s, i) => s + i.w, 0), aw = avail.reduce((s, i) => s + i.w, 0);
        g.score = aw > 0 ? avail.reduce((s, i) => s + i.score * i.w, 0) / aw : null;
        g.coverage = tw > 0 ? aw / tw : 0;
      }
      const gs = groups.filter(g => isNum(g.score));
      const W = gs.reduce((s, g) => s + g.weight, 0);
      const score = W > 0 ? gs.reduce((s, g) => s + g.score * g.weight, 0) / W : 0;
      const TW = groups.filter(g => g.items.some(i => !i.info)).reduce((s, g) => s + g.weight, 0);
      const confidence = TW > 0 ? groups.reduce((s, g) => s + g.weight * (g.coverage || 0), 0) / TW : 0;
      return { key, score: clamp(score, -1, 1), confidence, groups, highlights, ...extra };
    },
  };
}

// 연간/분기 재무제표: 같은 날짜 행 병합 후 날짜순 정렬
export function mergeByDate(rows) {
  const m = new Map();
  for (const r of rows || []) m.set(r.date, { ...(m.get(r.date) || {}), ...r });
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const growth = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? (b > 0 ? a / b - 1 : (a - b) / Math.abs(b)) : null);
export const ratio = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);
export const quarterLabel = d => { const x = new Date(d); return `${x.getUTCFullYear()}년 ${Math.floor(x.getUTCMonth() / 3) + 1}분기`; };
