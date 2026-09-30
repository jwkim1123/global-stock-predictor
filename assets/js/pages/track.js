// 예측 성적표: 매일 기록한 예측을 만기 후 실제 가격과 대조 + 워크포워드 백테스트 요약
import { h, getJSON, tile, sortableTable, cls } from '../ui.js';
import { HORIZON_LABELS } from '../engine/config.js';
import { pct, spct, fixed } from '../engine/format.js';
import { isNum } from '../engine/stats.js';

export async function renderTrack(root, S) {
  root.dataset.title = '예측 성적표';
  const T = await getJSON('data/track.json');
  const live = T.live || {}, bt = T.backtest || {};
  root.append(h('h1', null, '예측 성적표'),
    h('p', { class: 'sub' }, '매 평일 모든 자산의 1주·1개월·3개월 예측을 저장소에 기록하고, 만기가 지나면 실제 가격과 비교합니다. 좋은 모델은 90% 예측구간 적중률이 90% 근처여야 하고, 방향 적중률이 "항상 상승" 가정보다 높아야 합니다.'));

  // 실시간 기록
  const hs = [5, 20, 60];
  const liveBox = h('div', { class: 'grid g3 section' });
  for (const H of hs) {
    const x = live.byH?.[H];
    liveBox.appendChild(x ? tile(`${HORIZON_LABELS[H]} 예측 (${x.n}건 만기)`, pct(x.hit, 1), {
      delta: h('span', { class: 'small' }, '방향 적중률 · 기준(항상 상승) ', h('b', null, pct(x.baseUp, 1))),
      note: `90% 구간 적중 ${pct(x.coverage90, 1)} · IC ${fixed(x.ic, 3)} · 중앙값 오차 ${pct(x.mae, 1)}`,
    }) : tile(`${HORIZON_LABELS[H]} 예측`, h('span', { class: 'muted', style: { fontSize: '18px' } }, '데이터 축적 중'), {
      note: live.firstDate ? `${live.firstDate}부터 기록 중 — 첫 결과는 약 ${H}거래일 후 공개` : '첫 기록 대기 중',
    }));
  }
  root.append(h('section', { class: 'section' }, h('h2', null, '실시간 예측 기록'), liveBox,
    h('p', { class: 'small muted' }, `누적 기록 ${live.logged ?? 0}건 · 기록 파일: history/predictions.csv (GitHub 저장소에 매일 커밋)`)));

  // 백테스트
  const btRows = hs.filter(H => bt[H]).map(H => ({ H, ...bt[H] }));
  root.append(h('section', { class: 'section' }, h('h2', null, '과거 데이터 검증 (워크포워드 백테스트)'),
    h('p', { class: 'small muted' }, '각 자산에 대해 머신러닝 모델을 과거 구간으로만 학습하고 이후 구간을 예측해 평가한 결과의 평균입니다. 펀더멘털·뉴스·수급 스냅샷은 과거 시점 데이터가 없어 이 검증에 포함되지 않습니다.'),
    btRows.length ? h('div', { class: 'card flush' }, sortableTable({
      columns: [
        { key: 'H', label: '기간', render: r => HORIZON_LABELS[r.H] },
        { key: 'assets', label: '자산 수', num: true },
        { key: 'nOOS', label: '표본외 예측', num: true, render: r => r.nOOS.toLocaleString() },
        { key: 'icMean', label: '평균 IC', num: true, render: r => fixed(r.icMean, 3) },
        { key: 'icPositive', label: 'IC>0 자산 비율', num: true, render: r => pct(r.icPositive, 0) },
        { key: 'hitMean', label: '평균 방향 적중률', num: true, render: r => h('span', { class: r.hitMean >= r.baseMean ? 'up' : 'down' }, pct(r.hitMean, 1)) },
        { key: 'baseMean', label: '항상 상승 가정', num: true, render: r => pct(r.baseMean, 1) },
      ], rows: btRows,
    })) : h('p', { class: 'muted' }, '백테스트 결과 없음'),
    h('div', { class: 'callout', style: { marginTop: '12px' } }, '해석: IC가 0.02~0.05면 실무적으로 의미 있는 수준이지만, 개별 예측의 정확도는 낮습니다. 주가는 대부분 예측할 수 없는 잡음이며, 이 사이트의 가치는 "방향 맞히기"보다 "가능한 범위와 위험의 크기"를 정량화하는 데 있습니다.')));

  // 최근 대조 결과
  const rec = live.recent || [];
  if (rec.length) {
    root.append(h('section', { class: 'section' }, h('h2', null, '최근 만기 예측'), h('div', { class: 'card flush' }, sortableTable({
      columns: [
        { key: 'date', label: '예측일', sort: r => r.date },
        { key: 'symbol', label: '종목', sort: r => r.symbol, render: r => h('a', { href: `#/a/${encodeURIComponent(r.symbol)}` }, r.symbol) },
        { key: 'h', label: '기간', render: r => HORIZON_LABELS[r.h] },
        { key: 'pUp', label: '상승확률', num: true, sort: r => r.pUp, render: r => pct(r.pUp, 0) },
        { key: 'q50', label: '예측 중앙값', num: true, render: r => spct(r.q50) },
        { key: 'band', label: '90% 구간', num: true, render: r => `${spct(r.q05, 0)} ~ ${spct(r.q95, 0)}` },
        { key: 'real', label: '실제', num: true, sort: r => r.real, render: r => h('b', { class: cls(r.real) }, spct(r.real)) },
        { key: 'hit', label: '결과', render: r => h('span', { class: 'chip' }, `${r.hit ? '방향 적중' : '방향 빗나감'}${r.inBand ? '' : ' · 구간 밖'}`) },
      ], rows: rec.slice(0, 100), sortKey: 'date', sortDir: -1,
    }))));
  }
}
