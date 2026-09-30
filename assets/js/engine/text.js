// 뉴스 헤드라인 감성 분석(금융 사전 기반) + 이벤트 키워드 탐지

const POS = [
  [/\bbeats?\b|\bbeating\b|\btops? (estimates|expectations|forecasts)\b/, 1.2], [/\bsurg(e|es|ed|ing)\b|\bsoar(s|ed|ing)?\b|\bskyrocket/, 1.2],
  [/\bjump(s|ed)?\b|\bclimb(s|ed)?\b|\brall(y|ies|ied)\b|\brebound(s|ed)?\b|\brecover(s|y|ed)\b/, 0.8],
  [/\brecord (high|revenue|profit|sales|quarter)\b|\ball-time high\b/, 1.2], [/\bupgrade[sd]?\b|\boutperform\b|\boverweight\b|\btop pick\b/, 1],
  [/\b(raises?|boosts?|lifts?) (its )?(guidance|outlook|forecast|target)\b/, 1.3], [/\bstrong(er)?\b|\brobust\b|\bupbeat\b|\boptimis/, 0.7],
  [/\bgrowth\b|\bgrows?\b|\bexpands?\b|\bexpansion\b/, 0.5], [/\bgains?\b|\brises?\b|\brising\b|\bhigher\b|\badvances?\b/, 0.6],
  [/\bbullish\b|\bbuy rating\b|\bstrong buy\b/, 1], [/\bbuyback\b|\brepurchase\b/, 0.8], [/\bapprov(al|ed|es)\b|\bclear(s|ed) by\b/, 0.9],
  [/\bwins?\b|\bwon\b|\bsecures?\b|\bcontract\b|\bpartnership\b|\bdeal with\b/, 0.6], [/\blaunch(es|ed)?\b|\bunveil/, 0.4],
  [/\bbreakthrough\b|\binnovati/, 0.7], [/\bdividend (hike|increase|raise)\b|\braises? dividend\b/, 0.9], [/\bprofit(s)? (rise|jump|surge)/, 1],
  [/\baccelerat/, 0.6], [/\bdemand (boom|surge|soars)\b/, 0.8],
  [/상승|급등|호재|신고가|최대 실적|흑자|수주|승인|상향|매수|반등|호실적/, 1],
];
const NEG = [
  [/\bmiss(es|ed)?\b(?! out)/, 1.2], [/\bplung(e|es|ed)\b|\bplummet|\btumbl(e|es|ed)\b|\bsink(s)?\b|\bsank\b|\bcrash(es|ed)?\b/, 1.3],
  [/\bslump(s|ed)?\b|\bslid(e|es)?\b|\bdrop(s|ped)?\b|\bfall(s|ing)?\b|\bfell\b|\bdeclin(e|es|ed|ing)\b|\blower\b/, 0.7],
  [/\bsell-?off\b|\brout\b/, 1], [/\bdowngrade[sd]?\b|\bunderperform\b|\bunderweight\b|\bsell rating\b/, 1],
  [/\b(cuts?|lowers?|slashes?|trims?) (its )?(guidance|outlook|forecast|target)\b|\bprofit warning\b/, 1.3],
  [/\bwarn(s|ing|ed)?\b|\bconcern(s|ed)?\b|\bfear(s)?\b|\bworr(y|ies|ied)\b|\bjitters\b/, 0.7], [/\bweak(er|ness)?\b|\bsoft(er|ness)\b/, 0.7],
  [/\bloss(es)?\b|\blosing\b/, 0.7], [/\blawsuit\b|\bsue[sd]?\b|\bprobe\b|\binvestigat/, 1], [/\brecall(s|ed)?\b|\bfraud\b|\bscandal\b/, 1.2],
  [/\blayoffs?\b|\bjob cuts\b/, 0.6], [/\bdelay(s|ed)?\b|\bhalt(s|ed)?\b|\bsuspend/, 0.7], [/\bban(s|ned)?\b|\bfine[sd]?\b|\bpenalt/, 0.8],
  [/\btariffs?\b|\bsanctions?\b|\btrade war\b/, 0.7], [/\bbearish\b/, 1], [/\bslowdown\b|\bdownturn\b|\brecession\b|\bstagflation\b/, 0.9],
  [/\bbankrupt|\bdefault(s|ed)?\b|\binsolven/, 1.5], [/\bdisappoint/, 1], [/\bpressure\b|\bheadwinds?\b|\bstruggl/, 0.5],
  [/\bwar\b|\bconflict\b|\battack(s|ed)?\b/, 0.6], [/\bvolatil/, 0.3], [/\bbubble\b|\bovervalued\b/, 0.6],
  [/하락|급락|악재|적자|소송|제재|하향|매도|우려|리콜|압수수색|관세|쇼크|부진/, 1],
];
const NEGATION = /\b(not|no|never|fails? to|without|despite|barely)\b/;
// 주식에 불리한 대상(유가·금리·물가·관세·달러·변동성)의 상승/하락은 방향을 뒤집어 해석
const BAD_SUBJ = '(oil|crude|energy|gas|brent|wti|yields?|treasury yields|bond yields|rates|interest rates|inflation|cpi|prices|costs|tariffs?|dollar|vix|volatility|unemployment|jobless claims|layoffs)';
const UP_VERB = '(rise|rises|rising|rose|jump|jumps|jumped|surge|surges|surged|climb|climbs|climbed|higher|spike|spikes|spiked|soar|soars|soared|gain|gains|keep rising|up)';
const DOWN_VERB = '(fall|falls|falling|fell|drop|drops|dropped|slide|slides|slid|decline|declines|declined|lower|ease|eases|eased|cool|cools|cooled|retreat|retreats)';
const BAD_UP = new RegExp(`\\b${BAD_SUBJ}\\b[^.;:]{0,30}\\b${UP_VERB}\\b|\\b(higher|rising|soaring|surging)\\s+${BAD_SUBJ}\\b`);
const BAD_DOWN = new RegExp(`\\b${BAD_SUBJ}\\b[^.;:]{0,30}\\b${DOWN_VERB}\\b|\\b(lower|falling|easing|cooling)\\s+${BAD_SUBJ}\\b`);
const WEIGH = /\bweigh(s|ed|ing)?\b|\bdamper\b|\bdrag(s|ged)?\b|\bhit(s)? (stocks|shares|markets)\b/;

export function headlineTone(title) {
  const t = String(title || '').toLowerCase();
  let pos = 0, neg = 0;
  for (const [re, w] of POS) if (re.test(t)) pos += w;
  for (const [re, w] of NEG) if (re.test(t)) neg += w;
  if (BAD_UP.test(t)) { pos = Math.max(0, pos - 1.2); neg += 1.2; }
  else if (BAD_DOWN.test(t)) { neg = Math.max(0, neg - 1.0); pos += 0.9; }
  if (WEIGH.test(t)) neg += 0.8;
  if (NEGATION.test(t) && pos > neg) [pos, neg] = [neg * 0.5, pos * 0.5];
  const score = (pos - neg) / (pos + neg + 1);
  return { score, pos, neg };
}

// 최근 뉴스 톤: 최신 기사일수록 가중 (반감기 약 7일)
export function newsTone(news, nowMs, days = 30) {
  const items = (news || []).filter(n => n.time && nowMs - Date.parse(n.time) <= days * 864e5);
  let s = 0, w = 0, pos = 0, neg = 0, n7 = 0;
  const scored = items.map(n => {
    const age = (nowMs - Date.parse(n.time)) / 864e5;
    const tone = headlineTone(n.title).score;
    const wt = Math.exp(-age / 10);
    s += tone * wt; w += wt;
    if (tone > 0.15) pos++; else if (tone < -0.15) neg++;
    if (age <= 7) n7++;
    return { ...n, tone };
  });
  return { score: w > 0 ? s / w : null, n: items.length, n7, pos, neg, items: scored };
}

export const EVENT_RULES = [
  { key: 'guidanceUp', ko: '실적 서프라이즈·가이던스 상향', bias: 1, re: /(raises?|boosts?|lifts?|hikes?) (its |full-year |annual )?(guidance|outlook|forecast)|\bbeats?\b.*(estimates|expectations)|\btops? (estimates|expectations)|record (revenue|profit|sales)|어닝 서프라이즈|가이던스 상향/ },
  { key: 'guidanceDown', ko: '실적 부진·가이던스 하향', bias: -1, re: /(cuts?|lowers?|slashes?|trims?) (its |full-year |annual )?(guidance|outlook|forecast)|miss(es|ed)? (estimates|expectations)|profit warning|어닝 쇼크|가이던스 하향/ },
  { key: 'product', ko: '신제품·출시', bias: 0.4, re: /\b(launch(es|ed)?|unveil(s|ed)?|introduc(es|ed)|rolls? out|debut(s|ed)?)\b|출시|공개/ },
  { key: 'approval', ko: '규제 승인', bias: 0.7, re: /\b(fda|ema)\b.*\b(approv|clear)|\bapproval\b|\bapproved\b|품목허가|승인/ },
  { key: 'mna', ko: 'M&A·지분 변동', bias: 0, re: /\b(acquir(e|es|ed|ing)|acquisition|merger|takeover|buyout|stake in|to buy .* for)\b|인수|합병|지분 (취득|매각)/ },
  { key: 'buyback', ko: '자사주 매입', bias: 0.6, re: /\b(buyback|share repurchase|repurchase program)\b|자사주/ },
  { key: 'dividend', ko: '배당 확대', bias: 0.5, re: /\b(dividend (hike|increase|raise)|raises? (its )?(quarterly )?dividend|special dividend)\b|배당 (확대|증액)|특별배당/ },
  { key: 'split', ko: '주식 분할', bias: 0.3, re: /\bstock split\b|\b\d+-for-\d+ split\b|액면분할|주식분할/ },
  { key: 'offering', ko: '증자·대량 매물', bias: -0.6, re: /\b(secondary offering|share offering|stock offering|equity raise|convertible (notes|bonds)|block (trade|sale|deal)|lock-?up (expir|ends))\b|유상증자|블록딜|오버행|전환사채/ },
  { key: 'indexIn', ko: '지수·ETF 편입', bias: 0.5, re: /\b(added to|join(s|ing)?|inclusion in|to be included in) (the )?(s&p 500|nasdaq-100|nasdaq 100|msci|ftse|dow|kospi ?200|index)\b|지수 편입/ },
  { key: 'indexOut', ko: '지수·ETF 편출', bias: -0.5, re: /\b(removed from|dropped from|exclusion from|deleted from) (the )?(s&p 500|nasdaq-100|msci|ftse|dow|index)\b|지수 편출/ },
  { key: 'lawsuit', ko: '소송', bias: -0.6, re: /\b(lawsuit|sues|sued|class action|litigation)\b|소송/ },
  { key: 'investigation', ko: '당국 조사·수사', bias: -0.7, re: /\b(probe|investigation|investigat(es|ing)|subpoena|indict(ed|ment)|antitrust|doj|ftc)\b|수사|압수수색|조사 착수|기소/ },
  { key: 'accounting', ko: '회계 이슈', bias: -1, re: /\b(restat(e|ement)|accounting (irregularit|error|issue)|auditor (resign|quit)|going concern|short-seller report|fraud)\b|분식|감사의견|회계 위반/ },
  { key: 'recall', ko: '리콜·품질 문제', bias: -0.5, re: /\b(recall(s|ed)?|defects?|safety (issue|probe))\b|리콜|결함/ },
  { key: 'regulation', ko: '규제 강화', bias: -0.5, re: /\b(regulat(ion|ory|ors?)|crackdown|fine[sd]?|penalt(y|ies)|export (controls?|curbs?|restrictions?)|ban(s|ned)? on)\b|규제|과징금/ },
  { key: 'tariff', ko: '관세·무역분쟁', bias: -0.5, re: /\b(tariffs?|trade war|trade dispute|import duties)\b|관세|무역분쟁/ },
  { key: 'geopolitics', ko: '지정학 리스크', bias: -0.6, re: /\b(war|invasion|missiles?|military|conflict|sanctions?|middle east|iran|israel|ukraine|russia|taiwan strait|north korea|strikes? on|fog of war)\b|전쟁|미사일|분쟁|북한/ },
  { key: 'election', ko: '선거·정치 이벤트', bias: -0.2, re: /\b(election|midterms?|shutdown|impeach|ballot)\b|선거|탄핵/ },
  { key: 'disaster', ko: '자연재해', bias: -0.6, re: /\b(hurricane|earthquake|typhoon|flood(s|ing)?|wildfires?|tsunami|drought)\b|지진|태풍|홍수|산불/ },
  { key: 'supply', ko: '공급망 차질', bias: -0.5, re: /\b(shortages?|supply (chain|disruption|crunch)|disruptions?|walkout|outage|plant shutdown)\b|공급 차질|파업|품귀/ },
  { key: 'mgmt', ko: '경영진 변화', bias: -0.2, re: /\b(ceo|cfo|chief executive)\b.*\b(resign|steps? down|depart|ousted|fired|appoint|names?)\b|대표 사임|경영진 교체/ },
  { key: 'layoffs', ko: '구조조정', bias: -0.2, re: /\b(layoffs?|job cuts|cutting jobs|restructuring)\b|구조조정|감원/ },
  { key: 'analystUp', ko: '투자의견·목표가 상향', bias: 0.5, re: /\b(upgrade[sd]?|raises? (its )?(price )?target|price target (raised|hike))\b|목표가 상향/ },
  { key: 'analystDown', ko: '투자의견·목표가 하향', bias: -0.5, re: /\b(downgrade[sd]?|cuts? (its )?(price )?target|lowers? (its )?(price )?target)\b|목표가 하향/ },
];

// 뉴스 → 이벤트 범주별 기사 목록
export function detectEvents(news, nowMs, days = 30) {
  const out = {};
  for (const n of news || []) {
    if (!n.time || nowMs - Date.parse(n.time) > days * 864e5) continue;
    const t = String(n.title).toLowerCase();
    for (const r of EVENT_RULES) {
      if (r.re.test(t)) (out[r.key] ||= []).push({ title: n.title, time: n.time, link: n.link });
    }
  }
  return out;
}

export function eventScore(events, keys, nowMs) {
  // 범주 bias × 최신성 가중 합 → tanh 정규화
  let s = 0;
  for (const r of EVENT_RULES) {
    if (keys && !keys.includes(r.key)) continue;
    for (const it of events[r.key] || []) {
      const age = (nowMs - Date.parse(it.time)) / 864e5;
      s += r.bias * Math.exp(-age / 14);
    }
  }
  return Math.tanh(s / 2);
}

export const RULE_KO = Object.fromEntries(EVENT_RULES.map(r => [r.key, r.ko]));
