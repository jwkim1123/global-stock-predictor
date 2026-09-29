import fs from 'node:fs';
import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJSON(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj));
}

// 유효숫자 기준 반올림 (JSON 용량 절감)
export function sig(x, digits = 6) {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  if (x === 0) return 0;
  const p = digits - Math.ceil(Math.log10(Math.abs(x)));
  const f = 10 ** Math.max(0, Math.min(p, 10));
  return Math.round(x * f) / f;
}

export function yearsAgo(n) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d;
}

export function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// 동시 실행 개수를 제한한 map
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

// 네트워크·속도제한 오류에 대한 지수 백오프 재시도
export async function retry(fn, label, tries = 3) {
  let last;
  for (let a = 0; a < tries; a++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String(e?.message || e);
      if (/not found|no data|delisted|invalid|Quote not found|No fundamentals/i.test(msg)) break;
      const wait = (/429|Too Many|rate/i.test(msg) ? 8000 : 1500) * (a + 1) + Math.random() * 500;
      await sleep(wait);
    }
  }
  throw new Error(`${label}: ${String(last?.message || last).slice(0, 200)}`);
}

// Date/ISO 문자열/에포크 초 → 'YYYY-MM-DD'
export function toDay(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(v > 1e11 ? v : v * 1000).toISOString().slice(0, 10);
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof v === 'object' && 'raw' in v) return toDay(v.raw);
  return null;
}

// Yahoo의 {raw, fmt} 잔여 객체·Date 등을 JSON 친화적으로 정리
export function clean(obj, depth = 0) {
  if (obj === null || obj === undefined) return null;
  if (obj instanceof Date) return isNaN(obj) ? null : obj.toISOString();
  if (Array.isArray(obj)) return obj.map(x => clean(x, depth + 1));
  if (typeof obj === 'object') {
    if ('raw' in obj && Object.keys(obj).length <= 3) return clean(obj.raw, depth + 1);
    const o = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'maxAge') continue;
      const c = clean(v, depth + 1);
      if (c !== null && c !== undefined && !(typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0)) o[k] = c;
    }
    return o;
  }
  if (typeof obj === 'number') return Number.isFinite(obj) ? obj : null;
  return obj;
}

export function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}
