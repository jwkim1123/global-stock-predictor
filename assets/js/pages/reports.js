// 분석 리포트 목록 (reports/index.json)
import { h, getJSON } from '../ui.js';

export async function renderReports(root) {
  root.dataset.title = '분석 리포트';
  root.append(h('h1', null, '분석 리포트'), h('p', { class: 'sub' }, '대시보드 데이터와 최신 시장 뉴스를 바탕으로 작성한 심층 분석입니다. 자동 생성 대시보드와 달리 사람이 읽는 해석과 판단을 담았습니다.'));
  let list = [];
  try { list = (await getJSON('reports/index.json')).reports || []; } catch (e) { /* 없음 */ }
  if (!list.length) { root.append(h('p', { class: 'section muted' }, '아직 발행된 리포트가 없습니다.')); return; }
  root.append(h('div', { class: 'grid g2 section' }, list.map(r => h('a', { class: 'card', href: `reports/${encodeURIComponent(r.file)}`, style: { display: 'block', textDecoration: 'none' } },
    h('div', { class: 'small muted' }, `${r.date} · ${r.author || ''}`),
    h('h2', { style: { margin: '6px 0' } }, r.title),
    h('p', { class: 'sub small' }, r.summary),
    r.tags?.length ? h('div', { class: 'pill-list', style: { marginTop: '8px' } }, r.tags.map(t => h('span', { class: 'chip' }, t))) : null))));
}
