// 종목 랭킹·스크리너: 시장/섹터/기간 필터 + 9개 요인 히트맵
import { h, chg, signalBadge, sortableTable, segmented, heat, cls } from '../ui.js';
import { HORIZON_LABELS, FACTORS, signalOf } from '../engine/config.js';
import { pct, spct, price as fmtPrice, big } from '../engine/format.js';

const GROUPS = { all: '전체', US: '미국', KR: '한국', JP: '일본', CNHK: '중화권', EU: '유럽', IN: '인도', IDX: '지수' };
const inGroup = (a, g) => g === 'all' ? a.kind === 'stock' : g === 'IDX' ? a.kind === 'index'
  : a.kind === 'stock' && (g === 'CNHK' ? ['CN', 'HK', 'TW'].includes(a.market) : g === 'EU' ? ['EU', 'DE', 'FR', 'DK', 'UK'].includes(a.market) : a.market === g);

export function renderStocks(root, S) {
  root.dataset.title = '종목 랭킹';
  let group = 'all', horizon = 20, sector = 'all', q = '';
  root.append(h('h1', null, '종목 랭킹'), h('p', { class: 'sub' }, '9개 요인 점수와 예측 분포로 비교합니다. 행을 누르면 상세 분석으로 이동합니다.'));
  const sectors = [...new Set(S.assets.filter(a => a.sectorKo).map(a => a.sectorKo))].sort((a, b) => a.localeCompare(b, 'ko'));
  const sel = h('select', { 'aria-label': '섹터' }, h('option', { value: 'all' }, '모든 섹터'), sectors.map(x => h('option', { value: x }, x)));
  sel.addEventListener('change', () => { sector = sel.value; draw(); });
  const search = h('input', { type: 'search', placeholder: '종목명·티커 검색', 'aria-label': '검색' });
  search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); draw(); });
  root.append(h('div', { class: 'filters section' },
    segmented(Object.entries(GROUPS).map(([value, label]) => ({ value, label })), group, v => { group = v; draw(); }, '시장'),
    segmented([5, 20, 60, 120, 250].map(v => ({ value: v, label: HORIZON_LABELS[v] })), horizon, v => { horizon = v; draw(); }, '예측 기간'),
    sel, search));
  const box = h('div', { class: 'card flush' });
  root.append(box, h('p', { class: 'small muted' }, '요인 점수: −1(매우 부정) ~ +1(매우 긍정). 빨강 = 주가에 긍정, 파랑 = 부정 (국내 증시 색상 관례).'));

  function draw() {
    const rows = S.assets.filter(a => inGroup(a, group) && (sector === 'all' || a.sectorKo === sector)
      && (!q || `${a.nameKo || ''} ${a.name} ${a.symbol}`.toLowerCase().includes(q)));
    const H = horizon;
    const cols = [
      { key: 'name', label: '종목', sort: r => r.nameKo || r.name, render: r => h('div', { class: 'name-cell' }, h('b', null, r.nameKo || r.name), h('span', null, `${r.symbol} · ${r.marketName}${r.sectorKo ? ' · ' + r.sectorKo : ''}`)) },
      { key: 'price', label: '현재가', num: true, render: r => fmtPrice(r.price, r.currency) },
      { key: 'd1', label: '1일', num: true, sort: r => r.changes?.d1, render: r => chg(r.changes?.d1, 2) },
      { key: 'm1', label: '1개월', num: true, sort: r => r.changes?.m1, render: r => chg(r.changes?.m1) },
      { key: 'mcap', label: '시가총액', num: true, sort: r => r.mcapUSD, render: r => big(r.mcapUSD, 'USD') },
      { key: 'sig', label: '신호', sort: r => r.sig[H], render: r => signalBadge(signalOf(r.sig[H])) },
      { key: 'comp', label: '종합', num: true, sort: r => r.comp[H], render: r => heat(r.comp[H]) },
      ...FACTORS.map(f => ({ key: f.key, label: f.short, num: true, sort: r => r.scores[f.key], render: r => heat(r.scores[f.key]) })),
      { key: 'alpha', label: '초과수익(알파)', num: true, sort: r => r.fc[H]?.alpha, render: r => h('span', { class: cls(r.fc[H]?.alpha) }, spct(r.fc[H]?.alpha, 2)) },
      { key: 'exp', label: '기대수익률', num: true, sort: r => r.fc[H]?.exp, render: r => h('b', null, spct(r.fc[H]?.exp)) },
      { key: 'pup', label: '상승확률', num: true, sort: r => r.fc[H]?.pUp, render: r => pct(r.fc[H]?.pUp, 0) },
      { key: 'range', label: '90% 범위', num: true, render: r => (r.fc[H] ? `${spct(r.fc[H].q05, 0)} ~ ${spct(r.fc[H].q95, 0)}` : '—') },
    ];
    box.replaceChildren(sortableTable({ columns: cols, rows, sortKey: 'sig', sortDir: -1, caption: `${HORIZON_LABELS[H]} 기준 랭킹`, onRowClick: r => { location.hash = `#/a/${encodeURIComponent(r.symbol)}`; } }));
    if (!rows.length) box.replaceChildren(h('p', { class: 'skeleton' }, '조건에 맞는 종목이 없습니다.'));
  }
  draw();
}
