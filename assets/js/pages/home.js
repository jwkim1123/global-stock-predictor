// 대시보드: 글로벌 거시·심리·블랙스완 + 세계 지수 전망 + 주목 종목 + 일정 + 헤드라인
import { h, chg, signalBadge, sparkline, segmented, tile, statusOf, extLink, ago, scoreBar, getJSON, cls } from '../ui.js';
import { HORIZON_LABELS, signalOf } from '../engine/config.js';
import { pct, spct, fixed, price as fmtPrice, signed } from '../engine/format.js';
import { isNum } from '../engine/stats.js';

const HSEL = [5, 20, 60, 120, 250].map(v => ({ value: v, label: HORIZON_LABELS[v] }));

export async function renderHome(root, S) {
  root.dataset.title = '대시보드';
  const cx = S.context;
  const idx = S.assets.filter(a => a.kind === 'index');
  const stocks = S.assets.filter(a => a.kind === 'stock');

  root.append(h('div', { class: 'detail-head' },
    h('div', null,
      h('h1', null, '글로벌 주식시장 전망'),
      h('p', { class: 'sub' }, `${S.asOf} 기준 (시장별 최신 거래일) · 지수 ${idx.length}개 · 종목 ${stocks.length}개 · 9개 요인 + 블랙스완 위험 분석`)),
    h('a', { class: 'btn', href: '#/reports' }, '분석 리포트 보기 →')));

  // KPI
  const fg = cx.fearGreed, bs = cx.blackSwan;
  const fgTile = tile('공포·탐욕 지수', h('span', null, isNum(fg.value) ? fixed(fg.value, 0) : '—', h('span', { class: 'small muted' }, `  ${fg.label || ''}`)), {
    extra: h('div', null, h('div', { class: 'fg-track', role: 'img', 'aria-label': `공포탐욕 ${fixed(fg.value, 0)}` }, h('div', { class: 'marker', style: { left: `${fg.value}%` } })),
      h('div', { class: 'meter-scale' }, h('span', null, '극단적 공포'), h('span', null, '중립'), h('span', null, '극단적 탐욕'))),
    note: `${fg.components.length}개 지표 합성 (모멘텀·시장 폭·정크본드·VIX·안전자산·풋콜·암호자산)`,
  });
  const bsCol = { '낮음': 'var(--good)', '보통': 'var(--warning)', '높음': 'var(--serious)', '매우 높음': 'var(--critical)' }[bs.level];
  const bsTile = tile('블랙스완 위험 지수', h('span', null, fixed(bs.value, 0), h('span', { class: 'small muted' }, ' / 100')), {
    extra: h('div', null, h('div', { class: 'meter' }, h('div', { class: 'fill', style: { width: `${bs.value}%`, background: bsCol } })), statusOf(bs.level)),
    note: `주요 요인: ${bs.components.slice(0, 2).map(c => c.label).join(', ')} · 급락 점프 확률 ×${fixed(bs.lambdaMult, 2)}`,
  });
  const mTile = tile('글로벌 거시 환경', h('span', null, cx.macro.regime), {
    delta: h('span', { class: 'small' }, '점수 ', h('b', { class: 'num' }, signed(cx.macro.score, 2))),
    extra: scoreBar(cx.macro.score),
    note: cx.macro.groups.slice().sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 3).map(g => `${g.group} ${signed(g.score, 2)}`).join(' · '),
  });
  const bTile = tile('시장 폭', h('span', null, pct(cx.breadth200, 0)), {
    note: `주요 ${idx.length}개 지수 중 200일선 위 비율 (50일선 위 ${pct(cx.breadth50, 0)})`,
    extra: h('div', { class: 'meter' }, h('div', { class: 'fill', style: { width: `${cx.breadth200 * 100}%`, background: 'var(--accent)' } })),
  });
  root.append(h('div', { class: 'grid g4 section' }, mTile, fgTile, bsTile, bTile));

  // 세계 지수
  let horizon = 20;
  const idxBox = h('div');
  const drawIdx = () => {
    idxBox.replaceChildren(indexTable(idx, horizon));
  };
  root.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '세계 주요 지수 전망'), segmented(HSEL, horizon, v => { horizon = v; drawIdx(); }, '예측 기간')),
    h('div', { class: 'card flush' }, idxBox),
    h('p', { class: 'small muted' }, '기대수익률은 몬테카를로 시뮬레이션 평균, 범위는 5~95% 분위(90% 예측구간). 신호는 9개 요인 점수와 검증된 머신러닝 신호의 결합.')));
  drawIdx();

  // 거시 지표
  const items = cx.macro.items.filter(i => i.value);
  root.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '거시경제 대시보드'), h('span', { class: 'small muted' }, '막대: 주식시장에 우호(빨강)·비우호(파랑)')),
    h('div', { class: 'grid g3' }, items.map(it => h('div', { class: 'card tile' },
      h('div', { class: 'label' }, `${it.group} · ${it.label}`),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } },
        h('div', { class: 'value', style: { fontSize: '20px' } }, it.value),
        it.spark ? sparkline(it.spark.map(p => p[1]), { w: 110, h: 30 }) : null),
      isNum(it.score) ? scoreBar(it.score) : null,
      h('div', { class: 'note' }, it.note))))));

  // 주목 종목
  const ranked = stocks.filter(a => isNum(a.sig?.[20])).sort((a, b) => b.sig[20] - a.sig[20]);
  const pick = (list, title) => h('div', { class: 'card' }, h('h3', null, title), h('ul', { class: 'list' }, list.map(a => h('li', null,
    h('a', { href: `#/a/${encodeURIComponent(a.symbol)}`, style: { flex: 1, minWidth: 0 } }, h('b', null, a.nameKo || a.name), h('span', { class: 'muted small' }, ` ${a.symbol}`)),
    signalBadge(signalOf(a.sig[20])),
    h('span', { class: `num small ${cls(a.fc[20]?.alpha)}`, title: '시장 대비 초과수익(알파)', style: { minWidth: '60px', textAlign: 'right' } }, spct(a.fc[20]?.alpha, 2)),
    h('span', { class: 'num small muted', title: '기대수익률(시장 수익 포함)', style: { minWidth: '52px', textAlign: 'right' } }, spct(a.fc[20]?.exp))))));
  root.append(h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, '1개월 신호 상위·하위 종목'), h('a', { href: '#/stocks', class: 'small' }, '전체 랭킹 →')),
    h('div', { class: 'grid g2' }, pick(ranked.slice(0, 6), '상위 (매수 우위)'), pick(ranked.slice(-6).reverse(), '하위 (매도 우위)')),
    h('p', { class: 'small muted' }, '오른쪽 숫자: 1개월 초과수익(알파, 시장 대비) · 기대수익률(시장 수익 포함). 신호는 시장 대비 상대 매력도이므로 "매도" 종목도 시장이 오르면 절대 수익은 양수일 수 있습니다.')));

  // 일정 + 헤드라인
  const today = S.asOf;
  const ev = [
    ...cx.scheduled.map(e => ({ ...e, who: '거시·정치' })),
    ...stocks.filter(a => a.nextEvent?.type === 'earnings' && a.nextEvent.date >= today).map(a => ({ date: a.nextEvent.date, title: `${a.nameKo || a.name} 실적 발표`, who: a.symbol, sym: a.symbol })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 14);
  const evCard = h('div', { class: 'card' }, h('h3', null, '다가오는 주요 일정'), h('ul', { class: 'list' }, ev.map(e => h('li', null,
    h('span', { class: 'when' }, e.date.slice(5).replace('-', '.')),
    e.sym ? h('a', { href: `#/a/${encodeURIComponent(e.sym)}`, style: { flex: 1 } }, e.title) : h('span', { style: { flex: 1, fontWeight: 600 } }, e.title),
    h('span', { class: 'chip' }, e.who)))));
  const hl = cx.headlines || [];
  const newsCard = h('div', { class: 'card' }, h('h3', null, '시장 헤드라인', h('span', { class: 'small muted', style: { fontWeight: 400 } }, `톤 ${signed(cx.marketTone.score, 2)} (긍정 ${cx.marketTone.pos} · 부정 ${cx.marketTone.neg})`)),
    h('ul', { class: 'list' }, hl.slice(0, 10).map(n => h('li', null,
      h('span', { class: 'when' }, ago(n.time)),
      h('span', { style: { flex: 1, minWidth: 0 } }, extLink(n.link, n.title)),
      h('span', { class: 'chip', title: '헤드라인 감성 점수' }, n.tone > 0.15 ? '긍정' : n.tone < -0.15 ? '부정' : '중립')))));
  root.append(h('section', { class: 'section grid g2' }, evCard, newsCard));

  // 최신 리포트
  try {
    const rep = await getJSON('reports/index.json');
    const r = rep.reports?.[0];
    if (r) root.append(h('section', { class: 'section' }, h('a', { href: `reports/${encodeURIComponent(r.file)}`, class: 'card', style: { display: 'block', textDecoration: 'none' } },
      h('div', { class: 'small muted' }, `분석 리포트 · ${r.date}`), h('h2', { style: { margin: '4px 0' } }, r.title), h('p', { class: 'sub' }, r.summary))));
  } catch (e) { /* 리포트 없음 */ }
}

function indexTable(idx, H) {
  const regions = ['미주', '아시아', '유럽'];
  const table = h('table', null, h('caption', { class: 'sr-only' }, `세계 주요 지수 ${HORIZON_LABELS[H]} 전망`));
  table.appendChild(h('thead', null, h('tr', null,
    h('th', { scope: 'col' }, '지수'), h('th', { class: 'num', scope: 'col' }, '현재'), h('th', { class: 'num', scope: 'col' }, '1일'),
    h('th', { class: 'num', scope: 'col' }, '1개월'), h('th', { class: 'num', scope: 'col' }, '연초 대비'), h('th', { scope: 'col' }, '신호'),
    h('th', { class: 'num', scope: 'col' }, '기대수익률'), h('th', { class: 'num', scope: 'col' }, '상승확률'), h('th', { class: 'num', scope: 'col' }, '90% 범위'),
    h('th', { scope: 'col' }, '최근 3개월'))));
  const tb = h('tbody');
  for (const rg of regions) {
    const list = idx.filter(a => a.region === rg);
    if (!list.length) continue;
    tb.appendChild(h('tr', { class: 'group-row' }, h('td', { colspan: 10 }, rg)));
    for (const a of list) {
      const f = a.fc[H];
      const tr = h('tr', { class: 'clickable', tabindex: 0 },
        h('td', null, h('div', { class: 'name-cell' }, h('b', null, a.nameKo || a.name), h('span', null, a.symbol))),
        h('td', { class: 'num' }, fmtPrice(a.price, a.currency)),
        h('td', { class: 'num' }, chg(a.changes?.d1, 2)),
        h('td', { class: 'num' }, chg(a.changes?.m1)),
        h('td', { class: 'num' }, chg(a.changes?.ytd)),
        h('td', null, signalBadge(signalOf(a.sig[H]))),
        h('td', { class: 'num' }, h('b', null, spct(f?.exp))),
        h('td', { class: 'num' }, pct(f?.pUp, 0)),
        h('td', { class: 'num small' }, f ? `${spct(f.q05, 0)} ~ ${spct(f.q95, 0)}` : '—'),
        h('td', null, sparkline(a.spark, { change: a.changes?.m3 })));
      const go = () => { location.hash = `#/a/${encodeURIComponent(a.symbol)}`; };
      tr.addEventListener('click', go); tr.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      tb.appendChild(tr);
    }
  }
  table.appendChild(tb);
  return h('div', { class: 'table-wrap' }, table);
}
