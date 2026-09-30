// 라우터 & 앱 셸
import { h, clear, getJSON, fmtDate } from './ui.js';
import { renderHome } from './pages/home.js';
import { renderStocks } from './pages/stocks.js';
import { renderDetail } from './pages/detail.js';
import { renderTrack } from './pages/track.js';
import { renderMethod } from './pages/method.js';
import { renderReports } from './pages/reports.js';

const main = document.getElementById('app');

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch (e) { /* 저장 불가 환경 */ }
}
document.getElementById('theme-toggle').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  setTheme(cur === 'dark' ? 'light' : 'dark');
  route();
});

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, ...rest] = hash.split('/');
  const arg = decodeURIComponent(rest.join('/'));
  const key = page || 'home';
  for (const a of document.querySelectorAll('.nav a')) {
    const r = a.dataset.route;
    if (r === key || (key === 'a' && r === 'stocks')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  clear(main).appendChild(h('div', { class: 'skeleton' }, '데이터를 불러오는 중…'));
  try {
    const S = await getJSON('data/summary.json');
    const up = document.getElementById('updated');
    if (up) up.textContent = `최근 분석: ${fmtDate(S.generatedAt)} (데이터 기준일 ${S.asOf})`;
    const view = h('div');
    clear(main).appendChild(view); // 차트가 너비를 잴 수 있도록 먼저 부착
    if (key === 'home') await renderHome(view, S);
    else if (key === 'stocks') await renderStocks(view, S, arg);
    else if (key === 'a') await renderDetail(view, S, arg);
    else if (key === 'track') await renderTrack(view, S);
    else if (key === 'method') renderMethod(view, S);
    else if (key === 'reports') await renderReports(view, S);
    else view.appendChild(h('p', null, '페이지를 찾을 수 없습니다. ', h('a', { href: '#/' }, '대시보드로 이동')));
    document.title = view.dataset.title ? `${view.dataset.title} · 글로벌 주식 예측` : '글로벌 주식 예측';
  } catch (e) {
    console.error(e);
    clear(main).appendChild(h('div', { class: 'card' }, h('h2', null, '데이터를 불러오지 못했습니다'),
      h('p', { class: 'err' }, String(e.message || e)),
      h('p', { class: 'muted' }, '데이터는 매 평일 GitHub Actions가 생성합니다. 첫 배포 직후라면 잠시 후 새로고침해 주세요.')));
  }
}

let lastHash = null;
window.addEventListener('hashchange', () => {
  const samePage = lastHash && lastHash.split('/')[1] === location.hash.split('/')[1] && lastHash.split('/')[1] === 'a' && lastHash === location.hash;
  lastHash = location.hash;
  if (!samePage) { window.scrollTo(0, 0); route(); }
});
let resizeT;
let lastW = window.innerWidth;
window.addEventListener('resize', () => {
  if (Math.abs(window.innerWidth - lastW) < 40) return;
  lastW = window.innerWidth;
  clearTimeout(resizeT);
  resizeT = setTimeout(() => window.dispatchEvent(new CustomEvent('chart-resize')), 200);
});
lastHash = location.hash;
route();
