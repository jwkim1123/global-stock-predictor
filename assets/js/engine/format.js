// 표시용 포맷터 (엔진·UI 공용)
import { isNum } from './stats.js';

const NA = '—';

export function pct(x, d = 1, sign = false) {
  if (!isNum(x)) return NA;
  const s = (x * 100).toFixed(d) + '%';
  return sign && x > 0 ? '+' + s : s;
}
export const spct = (x, d = 1) => pct(x, d, true);
export function pp(x, d = 1) { // 퍼센트포인트
  if (!isNum(x)) return NA;
  return (x > 0 ? '+' : '') + (x * 100).toFixed(d) + '%p';
}
export function times(x, d = 1) { return isNum(x) ? x.toFixed(d) + '배' : NA; }
export function num(x, d = 0) {
  if (!isNum(x)) return NA;
  return x.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fixed(x, d = 2) { return isNum(x) ? x.toFixed(d) : NA; }
export function signed(x, d = 2) { return isNum(x) ? (x > 0 ? '+' : '') + x.toFixed(d) : NA; }

// 큰 금액: 조/억(KRW·JPY 등) 또는 T/B/M
export function big(x, ccy = 'USD') {
  if (!isNum(x)) return NA;
  const a = Math.abs(x), s = x < 0 ? '-' : '';
  if (ccy === 'KRW') {
    if (a >= 1e12) return s + (a / 1e12).toFixed(a >= 1e14 ? 0 : 1) + '조원';
    if (a >= 1e8) return s + (a / 1e8).toFixed(0) + '억원';
    return s + num(a) + '원';
  }
  const sym = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', HKD: 'HK$', TWD: 'NT$', INR: '₹', DKK: 'kr ', CAD: 'C$', AUD: 'A$', BRL: 'R$' }[ccy] || '';
  if (a >= 1e12) return s + sym + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return s + sym + (a / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return s + sym + (a / 1e6).toFixed(1) + 'M';
  return s + sym + num(a);
}

export function price(x, ccy = 'USD') {
  if (!isNum(x)) return NA;
  const d = ['KRW', 'JPY', 'TWD', 'INR'].includes(ccy) || Math.abs(x) >= 10000 ? 0 : Math.abs(x) >= 100 ? 2 : Math.abs(x) >= 1 ? 2 : 4;
  return num(x, d);
}

export function dayToDate(day) { return new Date(day * 86400000); }
export function dayStr(day) { return isNum(day) ? dayToDate(day).toISOString().slice(0, 10) : NA; }
export function dateKo(d) {
  const x = typeof d === 'number' ? dayToDate(d) : new Date(d);
  if (isNaN(x)) return NA;
  return `${x.getUTCFullYear()}.${String(x.getUTCMonth() + 1).padStart(2, '0')}.${String(x.getUTCDate()).padStart(2, '0')}`;
}
