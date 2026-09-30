// 종목·지수 상세: 예측 분포, 9개 요인 상세, 시나리오, ML 검증, 가중치 조정(브라우저에서 재시뮬레이션)
import { h, clear, getJSON, chg, signalBadge, segmented, scoreBar, tile, extLink, ago, fmtDate, onChartResize, cls } from '../ui.js';
import { priceChart, priceLegend, factorBars, histogram, seasonChart } from '../charts.js';
import { HORIZONS, HORIZON_LABELS, FACTORS, WEIGHTS, IC_PRIOR, ML_HORIZONS, fileKey, signalOf } from '../engine/config.js';
import { composite } from '../engine/composite.js';
import { simulate } from '../engine/simulate.js';
import { FEATURE_KO } from '../engine/ml.js';
import { isNum, clamp } from '../engine/stats.js';
import { pct, spct, pp, fixed, signed, price as fmtPrice, big, num, dateKo } from '../engine/format.js';

const HSEL = HORIZONS.map(v => ({ value: v, label: HORIZON_LABELS[v] }));

export async function renderDetail(root, S, symbol) {
  root.append(h('div', { class: 'skeleton' }, `${symbol} 분석 데이터를 불러오는 중…`));
  const res = await getJSON(`data/a/${fileKey(symbol)}.json`);
  clear(root);
  root.dataset.title = res.nameKo || res.name;
  const st = { horizon: 20, range: 250, mult: Object.fromEntries(FACTORS.map(f => [f.key, 1])), custom: null };
  const ccy = res.currency;

  // ---------------- 헤더
  const meta = [res.symbol, res.exchange, res.marketName, res.sectorKo || res.sector, res.industry, res.theme ? `테마: ${res.theme}` : null].filter(Boolean).join(' · ');
  const sigBox = h('span');
  root.append(
    h('p', { class: 'small' }, h('a', { href: res.kind === 'index' ? '#/' : '#/stocks' }, res.kind === 'index' ? '← 대시보드' : '← 종목 랭킹')),
    h('div', { class: 'detail-head' },
      h('div', { style: { minWidth: 0 } },
        h('h1', null, res.nameKo || res.name, res.nameKo ? h('span', { class: 'muted', style: { fontSize: '16px', fontWeight: 400 } }, `  ${res.name}`) : null),
        h('p', { class: 'sub small' }, meta)),
      h('div', { style: { textAlign: 'right' } },
        h('div', { class: 'price-big num' }, fmtPrice(res.price, ccy), h('span', { class: 'small muted' }, ` ${ccy}`)),
        h('div', null, chg(res.changes.d1, 2), h('span', { class: 'small muted' }, `  ${res.asOf} 종가`)))));

  const tabs = segmented(HSEL, st.horizon, v => { st.horizon = v; drawAll(); }, '예측 기간');
  root.append(h('div', { class: 'filters section' }, h('b', null, '예측 기간'), tabs, sigBox));

  // ---------------- KPI
  const kpis = h('div', { class: 'grid g4' });
  root.append(kpis);

  // ---------------- 가격 차트
  const chartBox = h('div', { class: 'chart-box' });
  const rangeSeg = segmented([{ value: 125, label: '6개월' }, { value: 250, label: '1년' }, { value: 500, label: '2년' }], st.range, v => { st.range = v; drawChart(); }, '과거 기간');
  const fcTable = h('div', { hidden: true });
  const tblBtn = h('button', { class: 'btn table-toggle', type: 'button', 'aria-expanded': 'false' }, '표로 보기');
  tblBtn.addEventListener('click', () => { fcTable.hidden = !fcTable.hidden; tblBtn.setAttribute('aria-expanded', String(!fcTable.hidden)); tblBtn.textContent = fcTable.hidden ? '표로 보기' : '표 숨기기'; });
  root.append(h('section', { class: 'section card' },
    h('figure', { class: 'chart' },
      h('figcaption', null, h('h2', { style: { margin: 0 } }, '가격 추이와 예측 범위'), h('div', { class: 'filters', style: { margin: 0 } }, rangeSeg, tblBtn)),
      chartBox, priceLegend(), fcTable),
    h('p', { class: 'small muted' }, '예측 범위는 GARCH 변동성·두꺼운 꼬리(t-분포)·블랙스완 급락 점프·실적 발표 점프를 반영한 4,000개 경로 몬테카를로 시뮬레이션 결과입니다. 차트 위에서 마우스를 움직이거나 방향키로 값을 확인할 수 있습니다.')));

  // ---------------- 요약
  const sumBox = h('div', { class: 'grid g2' });
  root.append(h('section', { class: 'section' }, h('h2', null, '핵심 요약'), sumBox));

  // ---------------- 요인 개요
  const barsBox = h('div', { class: 'chart-box' });
  const weightTable = h('div');
  root.append(h('section', { class: 'section grid g2' },
    h('div', { class: 'card' }, h('h2', null, '9개 요인 점수'), barsBox, h('p', { class: 'small muted' }, '막대 진하기 = 데이터 확보율. 막대를 누르면 해당 요인 상세로 이동합니다.')),
    h('div', { class: 'card' }, h('h2', null, '기간별 가중치와 기여도'), weightTable)));

  // ---------------- 요인 상세
  const detailBox = h('div');
  root.append(h('section', { class: 'section' }, h('h2', null, '요인별 상세 분석'), detailBox));
  for (const f of FACTORS) detailBox.appendChild(factorDetail(f, res.factors[f.key]));

  // ---------------- 분포
  const histBox = h('div', { class: 'chart-box' }), probBox = h('div');
  root.append(h('section', { class: 'section grid g2' },
    h('div', { class: 'card' }, h('h2', null, '수익률 확률 분포'), histBox, h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'sw', style: { background: 'var(--up)' } }), '상승 구간'), h('span', null, h('i', { class: 'sw', style: { background: 'var(--down)' } }), '하락 구간'))),
    h('div', { class: 'card' }, h('h2', null, '확률표'), probBox)));

  // ---------------- 시나리오 + ML
  root.append(h('section', { class: 'section grid g2' },
    h('div', { class: 'card' }, h('h2', null, '스트레스 테스트·시나리오'), scenarioTable(res)),
    h('div', { class: 'card' }, h('h2', null, '머신러닝 검증 (워크포워드)'), mlTable(res))));

  // ---------------- 계절성 + 수급/이벤트
  const seasBox = h('div', { class: 'chart-box' });
  const curMonth = new Date(res.asOf).getUTCMonth();
  root.append(h('section', { class: 'section grid g2' },
    h('div', { class: 'card' }, h('h2', null, '계절성 (월별 평균 수익률)'), seasBox, h('p', { class: 'small muted' }, `최근 ${res.kind === 'index' ? '약 19' : '10'}년 월간 수익률 기준. 진한 막대 = 이번 달과 다음 달.`)),
    res.flows?.length ? flowCard(res) : eventsCard(res)));
  if (res.flows?.length) root.append(h('section', { class: 'section' }, eventsCard(res)));
  root.append(h('section', { class: 'section' }, newsCard(res)));

  // ---------------- 가중치 조정
  root.append(h('section', { class: 'section' }, weightPanel()));
  if (res.profile?.summary) root.append(h('section', { class: 'section card' }, h('h2', null, '기업 개요'), h('p', { class: 'small', lang: 'en' }, res.profile.summary),
    h('p', { class: 'small muted' }, [res.profile.country, res.profile.employees ? `임직원 ${num(res.profile.employees)}명` : null].filter(Boolean).join(' · '), ' ', res.profile.website ? extLink(res.profile.website, res.profile.website) : null)));

  // ================= 그리기 =================
  function cur() { return st.custom || { comps: res.composite, fc: res.forecast, fan: res.fan, sig: res.signalScores }; }

  function drawKpis() {
    const H = st.horizon, f = cur().fc[H], c = cur();
    const sig = signalOf(c.sig[H]);
    sigBox.replaceChildren(...[h('span', { class: 'small muted' }, '신호 '), signalBadge(sig), st.custom ? h('span', { class: 'chip', style: { marginLeft: '6px' } }, '사용자 가중치') : null].filter(Boolean),
      h('span', { class: 'small muted', style: { marginLeft: '8px' } }, `시장 대비 초과수익(알파) ${spct(st.custom ? st.custom.alpha[H] : res.mcInputs.alphaByH[H], 2)}`));
    const S0 = res.price;
    kpis.replaceChildren(
      tile(`${HORIZON_LABELS[H]} 기대수익률 (평균)`, h('span', { class: cls(f.mean) }, spct(f.mean)), { note: `중앙값 ${spct(f.q50)} · 예상가 ${fmtPrice(S0 * (1 + f.q50), ccy)}` }),
      tile('상승 확률', pct(f.pUp, 0), { note: `+10% 이상 ${pct(f.pUp10, 0)} · −10% 이하 ${pct(f.pDown10, 0)}` }),
      tile('90% 예측 구간', h('span', { style: { fontSize: '20px' } }, `${fmtPrice(S0 * (1 + f.q05), ccy)} ~ ${fmtPrice(S0 * (1 + f.q95), ccy)}`), { note: `${spct(f.q05, 0)} ~ ${spct(f.q95, 0)}` }),
      tile('하방 위험', h('span', null, `${pct(f.var95, 1)}`), { note: `VaR 95% · CVaR ${pct(f.cvar95, 1)} · −20% 급락 확률 ${pct(f.pDown20, 1)} · 평균 최대낙폭 ${pct(f.mdd, 0)}` }),
    );
  }

  function drawChart() {
    priceChart(chartBox, res, { horizon: st.horizon, range: st.range, fan: cur().fan });
    const c = cur();
    fcTable.replaceChildren(h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['기간', '5%', '25%', '중앙값', '75%', '95%', '평균', '상승확률'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
      h('tbody', null, HORIZONS.map(Hh => { const f = c.fc[Hh]; return h('tr', null, h('td', null, HORIZON_LABELS[Hh]),
        ...[f.q05, f.q25, f.q50, f.q75, f.q95].map(v => h('td', { class: 'num' }, `${fmtPrice(res.price * (1 + v), ccy)} (${spct(v, 1)})`)),
        h('td', { class: 'num' }, spct(f.mean)), h('td', { class: 'num' }, pct(f.pUp, 0))); })))));
  }

  function drawSummary() {
    const H = st.horizon, comp = cur().comps[H], ap = res.mcInputs.alphaParts[H];
    const nar = res.narrative;
    const hl = nar.highlights || [];
    sumBox.replaceChildren(
      h('div', { class: 'card' },
        h('h3', null, '신호 산출 근거'),
        h('dl', { class: 'kv' },
          h('dt', null, '9개 요인 종합점수'), h('dd', null, signed(comp.score, 3)),
          h('dt', null, '머신러닝 반영 비중'), h('dd', null, ap.wML > 0 ? `${pct(ap.wML, 0)} (ML z ${signed(ap.zML, 2)})` : '0% (검증 기준 미달)'),
          h('dt', null, '최종 신호 점수'), h('dd', null, signed(cur().sig[H], 3)),
          h('dt', null, '기준 기대수익(CAPM)'), h('dd', null, `연 ${pct(res.mcInputs.baseAnnual, 1)} (무위험 ${pct(res.mcInputs.rf, 1)} + 베타 ${fixed(res.mcInputs.beta, 2)} × 5%)`),
          h('dt', null, `초과수익(알파, ${HORIZON_LABELS[H]})`), h('dd', null, spct(st.custom ? st.custom.alpha[H] : res.mcInputs.alphaByH[H], 2)),
          h('dt', null, '일간 변동성(초기→장기)'), h('dd', null, `${pct(res.mcInputs.sigmas[0], 2)} → ${pct(res.mcInputs.sigmas[249], 2)}`),
          h('dt', null, '꼬리 두께 (t-분포 자유도)'), h('dd', null, fixed(res.mcInputs.nu, 1)),
          h('dt', null, '블랙스완 급락 발생률 (연)'), h('dd', null, pct(res.mcInputs.crash.lambdaBase * res.mcInputs.crash.mult, 1))),
        h('p', { class: 'small muted' }, '알파 = 정보계수(IC) × 기간 변동성 × 신호 z-점수 (Grinold 공식). 신호가 강해도 실제 예상 초과수익은 변동성 대비 작게 설정됩니다.')),
      h('div', { class: 'card' },
        h('h3', null, '강점'), nar.strengths.length ? h('ul', null, nar.strengths.map(x => h('li', null, x))) : h('p', { class: 'muted small' }, '뚜렷한 강점 없음'),
        h('h3', null, '약점'), nar.weaknesses.length ? h('ul', null, nar.weaknesses.map(x => h('li', null, x))) : h('p', { class: 'muted small' }, '뚜렷한 약점 없음'),
        hl.length ? h('div', { class: 'pill-list' }, hl.slice(0, 10).map(x => h('span', { class: 'chip', style: { borderLeft: `3px solid ${x.tone > 0 ? 'var(--up)' : x.tone < 0 ? 'var(--down)' : 'var(--axis)'}` } }, x.text))) : null));
  }

  function drawFactors() {
    const H = st.horizon, comp = cur().comps[H];
    factorBars(barsBox, FACTORS.map(f => {
      const x = res.factors[f.key];
      return { label: f.label, score: x.score, conf: x.confidence,
        tip: [{ k: '점수', v: signed(x.score, 2) }, { k: '데이터 확보율', v: pct(x.confidence, 0) }, { k: `${HORIZON_LABELS[H]} 가중치`, v: pct(comp.weights[f.key], 1) }, { k: '종합 기여', v: signed(comp.contrib[f.key], 3) }],
        onClick: () => { const d = document.getElementById(`f-${f.key}`); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } };
    }));
    weightTable.replaceChildren(h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, '요인'), HORIZONS.map(Hh => h('th', { class: 'num' }, HORIZON_LABELS[Hh])), h('th', { class: 'num' }, `기여(${HORIZON_LABELS[H]})`))),
      h('tbody', null, FACTORS.map(f => h('tr', null, h('td', null, f.short),
        HORIZONS.map(Hh => h('td', { class: 'num', style: Hh === H ? { fontWeight: 650 } : null }, pct(cur().comps[Hh].weights[f.key], 0))),
        h('td', { class: `num ${cls(comp.contrib[f.key])}` }, signed(comp.contrib[f.key], 3))))),
      h('tfoot', null, h('tr', null, h('td', null, h('b', null, '종합')), HORIZONS.map(Hh => h('td', { class: 'num' }, h('b', null, signed(cur().comps[Hh].score, 2)))), h('td', null, ''))))),
      h('p', { class: 'small muted' }, '실효 가중치 = 기본 가중치 × 데이터 확보율 (정규화). 단기일수록 기술적·수급, 장기일수록 펀더멘털·리스크 비중이 큽니다.'));
  }

  function drawDist() {
    const H = st.horizon, f = cur().fc[H];
    histogram(histBox, f, { horizon: H });
    const rows = [
      ['상승 확률', pct(f.pUp, 1)], ['+10% 이상 상승', pct(f.pUp10, 1)], ['−10% 이상 하락', pct(f.pDown10, 1)], ['−20% 이상 하락 (급락)', pct(f.pDown20, 1)],
      ['기대수익률 (평균)', spct(f.mean, 2)], ['중앙값', spct(f.q50, 2)], ['VaR 95% (최대 손실 추정)', pct(f.var95, 1)], ['CVaR 95% (최악 5% 평균 손실)', pct(f.cvar95, 1)],
      ['기간 중 평균 최대낙폭', pct(f.mdd, 1)], ['기간 중 20% 이상 낙폭 경험 확률', pct(f.pMdd20, 1)],
    ];
    probBox.replaceChildren(h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      h('p', { class: 'small muted' }, '평균이 양수여도 변동성이 크면 중앙값·상승확률은 낮아질 수 있습니다 (변동성 손실).'));
  }

  function drawAll() {
    drawKpis(); drawChart(); drawSummary(); drawFactors(); drawDist();
    seasonChart(seasBox, res.seasonality, curMonth);
  }

  function weightPanel() {
    const out = h('div', { class: 'card' });
    const status = h('span', { class: 'small muted' });
    const labels = {};
    const sliders = FACTORS.map(f => {
      const val = h('b', { class: 'num' }, '×1.0');
      labels[f.key] = val;
      const input = h('input', { type: 'range', class: 'range', min: 0, max: 3, step: 0.25, value: 1, 'aria-label': `${f.label} 가중치 배수` });
      input.addEventListener('input', () => { st.mult[f.key] = +input.value; val.textContent = `×${(+input.value).toFixed(2)}`; });
      return h('label', null, h('span', null, f.label), val, input);
    });
    const apply = h('button', { class: 'btn primary', type: 'button' }, '다시 시뮬레이션');
    const reset = h('button', { class: 'btn', type: 'button' }, '기본값');
    apply.addEventListener('click', () => {
      status.textContent = '계산 중…';
      setTimeout(() => {
        const t0 = performance.now();
        st.custom = rerun(res, st.mult);
        drawAll();
        status.textContent = `완료 (${Math.round(performance.now() - t0)}ms, 브라우저에서 4,000개 경로 재계산)`;
      }, 20);
    });
    reset.addEventListener('click', () => {
      st.custom = null;
      for (const f of FACTORS) st.mult[f.key] = 1;
      out.querySelectorAll('input[type=range]').forEach(i => { i.value = 1; });
      for (const k of Object.keys(labels)) labels[k].textContent = '×1.0';
      drawAll(); status.textContent = '기본 가중치로 복원';
    });
    out.append(h('h2', null, '나만의 가중치로 다시 예측하기'),
      h('p', { class: 'small muted' }, '각 요인의 기본 가중치에 배수를 곱합니다. 요인 점수는 그대로 두고 종합점수·알파·몬테카를로 시뮬레이션만 브라우저에서 다시 계산합니다.'),
      h('div', { class: 'weights' }, sliders), h('div', { class: 'filters', style: { marginTop: '12px' } }, apply, reset, status));
    return out;
  }

  drawAll();
  onChartResize(root, () => { drawChart(); drawFactors(); drawDist(); seasonChart(seasBox, res.seasonality, curMonth); });
}

// 브라우저 재계산: 가중치 배수 → 종합점수 → 알파 → 몬테카를로
function rerun(res, mult) {
  const comps = {}, alpha = {}, sig = {};
  const inp = { ...res.mcInputs, alphaByH: {} };
  for (const H of HORIZONS) {
    const w = Object.fromEntries(FACTORS.map(f => [f.key, WEIGHTS[H][f.key] * mult[f.key]]));
    comps[H] = composite(res.factors, H, w);
    const p = res.mcInputs.alphaParts[H];
    const zF = clamp(comps[H].score * 2.5, -2.5, 2.5);
    const z = (1 - p.wML) * zF + p.wML * (p.zML ?? 0);
    inp.alphaByH[H] = alpha[H] = IC_PRIOR[H] * p.sigmaH * z;
    sig[H] = z / 2.5;
  }
  const sim = simulate(inp, { nPaths: 4000 });
  return { comps, fc: sim.horizons, fan: sim.fan, sig, alpha };
}

function factorDetail(meta, f) {
  const d = h('details', { class: 'factor', id: `f-${meta.key}` });
  d.appendChild(h('summary', null,
    h('div', null, h('div', { class: 'fname' }, meta.label), h('div', { class: 'fmeta' }, `점수 ${signed(f.score, 2)} · 데이터 확보율 ${pct(f.confidence, 0)}${f.phase ? ` · 산업 사이클: ${f.phase}` : ''}`)),
    h('div', { style: { width: '120px' } }, scoreBar(f.score))));
  const body = h('div', { class: 'factor-body' });
  for (const g of f.groups) {
    body.appendChild(h('div', { class: 'group-title' }, h('span', null, g.name), h('span', { class: `num small ${cls(g.score)}` }, isNum(g.score) ? signed(g.score, 2) : '—')));
    for (const it of g.items) {
      body.appendChild(h('div', { class: 'item-row' },
        h('div', { class: 'ilabel' }, it.label),
        h('div', { class: 'ival' }, it.value ?? h('span', { class: 'muted' }, '데이터 없음')),
        it.info ? h('span', { class: 'chip', style: { justifySelf: 'center' } }, '참고') : scoreBar(it.score),
        it.note ? h('div', { class: 'inote' }, it.note) : null));
    }
  }
  if (f.highlights?.length) body.appendChild(h('div', { class: 'callout', style: { marginTop: '12px' } }, f.highlights.map(x => h('div', null, `• ${x.text}`))));
  d.appendChild(body);
  return d;
}

function scenarioTable(res) {
  return h('div', null, h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, '시나리오'), h('th', { class: 'num' }, '시장'), h('th', { class: 'num' }, '이 자산'), h('th', null, '근거'))),
    h('tbody', null, res.scenarios.map(sc => h('tr', null,
      h('td', null, h('div', { class: 'name-cell' }, h('b', null, sc.name), h('span', null, sc.period))),
      h('td', { class: 'num' }, isNum(sc.market) ? h('span', { class: cls(sc.market) }, spct(sc.market, 1)) : '—'),
      h('td', { class: 'num' }, isNum(sc.asset) ? h('b', { class: cls(sc.asset) }, spct(sc.asset, 1)) : '—'),
      h('td', { class: 'small muted' }, sc.basis)))))),
    h('p', { class: 'small muted' }, '과거 위기 구간은 실제 가격이 있으면 실제 수익률, 없으면 베타로 추정합니다. 블랙스완은 정의상 과거에 없던 형태로 올 수 있어 이 표가 최악을 보장하지 않습니다.'));
}

function mlTable(res) {
  const rows = ML_HORIZONS.map(H => [H, res.ml?.[H]]).filter(([, m]) => m);
  if (!rows.length) return h('p', { class: 'muted' }, '학습 데이터가 부족해 머신러닝 예측을 생략했습니다.');
  return h('div', null, h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, '기간'), h('th', { class: 'num' }, 'IC(순위상관)'), h('th', { class: 'num' }, '방향 적중률'), h('th', { class: 'num' }, '항상 상승 가정'), h('th', { class: 'num' }, '반영 비중'), h('th', null, '주요 피처'))),
    h('tbody', null, rows.map(([H, m]) => h('tr', null,
      h('td', null, HORIZON_LABELS[H]),
      h('td', { class: 'num' }, fixed(m.ic, 3)),
      h('td', { class: `num ${m.hit >= m.baseHit ? 'up' : 'down'}` }, pct(m.hit, 1)),
      h('td', { class: 'num' }, pct(m.baseHit, 1)),
      h('td', { class: 'num' }, pct(m.weight ?? 0, 0)),
      h('td', { class: 'small' }, m.importance.slice(0, 3).map(x => FEATURE_KO[x.f] || x.f).join(', '))))))),
    h('p', { class: 'small muted' }, `릿지 회귀 + 그래디언트 부스팅 앙상블을 과거에만 학습해 미래 구간에서 평가(퍼지드 워크포워드). 표본외 예측 ${rows[0][1].nOOS}건 기준. 겹치는 표본으로 IC가 부풀려지지 않도록 유효 표본 수로 축소한 뒤, '항상 상승' 가정보다 방향 적중률이 낮으면 비중을 절반으로 줄입니다.`));
}

function flowCard(res) {
  const rows = res.flows.slice(-12).reverse();
  return h('div', { class: 'card' }, h('h2', null, '투자자별 순매수 (주)'), h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, h('th', null, '날짜'), h('th', { class: 'num' }, '외국인'), h('th', { class: 'num' }, '기관'), h('th', { class: 'num' }, '개인'), h('th', { class: 'num' }, '외국인 보유율'))),
    h('tbody', null, rows.map(r => h('tr', null, h('td', { class: 'num' }, r.d.slice(5)),
      ...[r.foreign, r.organ, r.indiv].map(v => h('td', { class: `num ${cls(v)}` }, isNum(v) ? (v > 0 ? '+' : '') + num(v) : '—')),
      h('td', { class: 'num' }, pct(r.foreignRatio, 2))))))), h('p', { class: 'small muted' }, '출처: 네이버 증권'));
}

function eventsCard(res) {
  const up = res.events.upcoming || [], rc = res.events.recent || [];
  return h('div', { class: 'card' }, h('h2', null, '이벤트·촉매'),
    h('h3', null, '예정'), up.length ? h('ul', { class: 'list' }, up.map(e => h('li', null, h('span', { class: 'when' }, e.date), h('span', { style: { flex: 1 } }, e.title, e.estimate ? ' (추정)' : ''), h('span', { class: 'chip' }, e.type === 'earnings' ? '실적' : e.type === 'dividend' ? '배당' : e.type === 'political' ? '정치' : '거시')))) : h('p', { class: 'muted small' }, '예정된 이벤트 없음'),
    h('h3', { style: { marginTop: '12px' } }, '최근 감지된 이벤트 (뉴스)'), rc.length ? h('ul', { class: 'list' }, rc.slice(0, 8).map(e => h('li', null, h('span', { class: 'when' }, ago(e.time)), h('span', { style: { flex: 1, minWidth: 0 } }, extLink(e.link, e.title)), h('span', { class: 'chip' }, e.cat)))) : h('p', { class: 'muted small' }, '최근 30일 이벤트 뉴스 없음'));
}

function newsCard(res) {
  const n = res.news || [];
  return h('div', { class: 'card' }, h('h2', null, '최근 뉴스와 감성 점수'), n.length ? h('ul', { class: 'list' }, n.map(x => h('li', null,
    h('span', { class: 'when' }, ago(x.time)), h('span', { style: { flex: 1, minWidth: 0 } }, extLink(x.link, x.title), x.publisher ? h('span', { class: 'muted small' }, ` · ${x.publisher}`) : null),
    h('span', { class: `chip num ${cls(x.tone)}` }, signed(x.tone, 2))))) : h('p', { class: 'muted' }, '최근 뉴스가 없습니다.'),
    h('p', { class: 'small muted' }, '감성 점수: 금융 감성 사전 기반 −1 ~ +1 (헤드라인만 분석).'));
}
