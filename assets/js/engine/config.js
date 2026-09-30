// 분석 엔진 공통 설정 — 브라우저와 Node(GitHub Actions) 양쪽에서 import 합니다.

export const HORIZONS = [5, 20, 60, 120, 250];
export const HORIZON_LABELS = { 5: '1주', 20: '1개월', 60: '3개월', 120: '6개월', 250: '1년' };
export const DEFAULT_HORIZON = 20;
export const ML_HORIZONS = [5, 20, 60];

export const FACTORS = [
  { key: 'fundamental', label: '기업 펀더멘털', short: '펀더멘털' },
  { key: 'industry', label: '산업·업종', short: '산업' },
  { key: 'macro', label: '거시경제', short: '거시' },
  { key: 'technical', label: '기술적 분석', short: '기술적' },
  { key: 'flow', label: '수급', short: '수급' },
  { key: 'sentiment', label: '시장 심리', short: '심리' },
  { key: 'catalyst', label: '이벤트·촉매', short: '이벤트' },
  { key: 'quant', label: '계량·통계', short: '계량' },
  { key: 'risk', label: '리스크', short: '리스크' },
];

// 투자 기간별 요인 가중치: 단기일수록 기술적·수급·심리, 장기일수록 펀더멘털·산업·리스크 비중이 커집니다.
export const WEIGHTS = {
  5:   { fundamental: 0.05, industry: 0.05, macro: 0.08, technical: 0.30, flow: 0.18, sentiment: 0.14, catalyst: 0.10, quant: 0.05, risk: 0.05 },
  20:  { fundamental: 0.10, industry: 0.08, macro: 0.10, technical: 0.24, flow: 0.14, sentiment: 0.13, catalyst: 0.10, quant: 0.06, risk: 0.05 },
  60:  { fundamental: 0.18, industry: 0.10, macro: 0.12, technical: 0.16, flow: 0.10, sentiment: 0.12, catalyst: 0.08, quant: 0.07, risk: 0.07 },
  120: { fundamental: 0.24, industry: 0.12, macro: 0.12, technical: 0.10, flow: 0.07, sentiment: 0.10, catalyst: 0.07, quant: 0.08, risk: 0.10 },
  250: { fundamental: 0.28, industry: 0.14, macro: 0.12, technical: 0.06, flow: 0.05, sentiment: 0.08, catalyst: 0.06, quant: 0.08, risk: 0.13 },
};

// 정보계수(IC): 종합점수가 실제 수익률을 얼마나 설명한다고 가정할지 (Grinold 공식 α = IC × σ × z).
// 실증 연구에서 우수한 다요인 모델의 IC는 0.03~0.08 수준이므로 보수적으로 설정합니다.
export const IC_PRIOR = { 5: 0.03, 20: 0.05, 60: 0.06, 120: 0.06, 250: 0.05 };
export const EQUITY_RISK_PREMIUM = 0.05;   // 연 5% 주식 위험 프리미엄
export const CRASH_BASE_INTENSITY = 0.08;  // 연간 시장 붕괴(블랙스완) 기본 발생 강도 ≈ 12년에 1회
export const CRASH_MEAN = -0.15;           // 시장 붕괴 시 평균 하락률(로그)
export const CRASH_SD = 0.06;
export const MC_PATHS = 4000;

export const MARKETS = {
  US: { name: '미국', bench: '^GSPC', ccy: 'USD', fx: null, rf: 'US', rfFallback: 0.04 },
  KR: { name: '한국', bench: '^KS11', ccy: 'KRW', fx: 'KRW=X', rf: 'IR3TIB01KRM156N', rfFallback: 0.025 },
  JP: { name: '일본', bench: '^N225', ccy: 'JPY', fx: 'JPY=X', rf: 'IR3TIB01JPM156N', rfFallback: 0.005 },
  CN: { name: '중국', bench: '000001.SS', ccy: 'CNY', fx: 'CNY=X', rf: 'IR3TIB01CNM156N', rfFallback: 0.015 },
  HK: { name: '홍콩', bench: '^HSI', ccy: 'HKD', fx: 'HKD=X', rf: 'US', rfFallback: 0.04 },
  TW: { name: '대만', bench: '^TWII', ccy: 'TWD', fx: 'TWD=X', rf: null, rfFallback: 0.015 },
  IN: { name: '인도', bench: '^NSEI', ccy: 'INR', fx: 'INR=X', rf: 'IR3TIB01INM156N', rfFallback: 0.06 },
  AU: { name: '호주', bench: '^AXJO', ccy: 'AUD', fx: 'AUD=X', rf: 'IR3TIB01AUM156N', rfFallback: 0.036 },
  EU: { name: '유로존', bench: '^STOXX50E', ccy: 'EUR', fx: 'EUR=X', rf: 'IR3TIB01EZM156N', rfFallback: 0.02 },
  DE: { name: '독일', bench: '^GDAXI', ccy: 'EUR', fx: 'EUR=X', rf: 'IR3TIB01EZM156N', rfFallback: 0.02 },
  FR: { name: '프랑스', bench: '^FCHI', ccy: 'EUR', fx: 'EUR=X', rf: 'IR3TIB01EZM156N', rfFallback: 0.02 },
  DK: { name: '덴마크', bench: '^STOXX50E', ccy: 'DKK', fx: 'DKK=X', rf: 'IR3TIB01DKM156N', rfFallback: 0.02 },
  UK: { name: '영국', bench: '^FTSE', ccy: 'GBP', fx: 'GBP=X', rf: 'IR3TIB01GBM156N', rfFallback: 0.04 },
  CA: { name: '캐나다', bench: '^GSPTSE', ccy: 'CAD', fx: 'CAD=X', rf: 'IR3TIB01CAM156N', rfFallback: 0.028 },
  BR: { name: '브라질', bench: '^BVSP', ccy: 'BRL', fx: 'BRL=X', rf: 'IR3TIB01BRM156N', rfFallback: 0.12 },
};

// Yahoo 섹터 → 미국 섹터 ETF(업종 밸류에이션·추세 벤치마크)
export const SECTORS = {
  'Technology': { etf: 'XLK', ko: '기술', regSens: 0.4 },
  'Financial Services': { etf: 'XLF', ko: '금융', regSens: 0.8 },
  'Healthcare': { etf: 'XLV', ko: '헬스케어', regSens: 0.9 },
  'Consumer Cyclical': { etf: 'XLY', ko: '경기소비재', regSens: 0.4 },
  'Consumer Defensive': { etf: 'XLP', ko: '필수소비재', regSens: 0.3 },
  'Energy': { etf: 'XLE', ko: '에너지', regSens: 0.7 },
  'Industrials': { etf: 'XLI', ko: '산업재', regSens: 0.5 },
  'Basic Materials': { etf: 'XLB', ko: '소재', regSens: 0.5 },
  'Utilities': { etf: 'XLU', ko: '유틸리티', regSens: 0.9 },
  'Real Estate': { etf: 'XLRE', ko: '부동산', regSens: 0.6 },
  'Communication Services': { etf: 'XLC', ko: '커뮤니케이션', regSens: 0.7 },
};

// 산업 키워드 → 기술 트렌드 테마 ETF
export const THEMES = [
  { etf: 'SMH', ko: '반도체', match: ['semiconductor'] },
  { etf: 'IGV', ko: '소프트웨어·클라우드', match: ['software', 'information-technology-services'] },
  { etf: 'AIQ', ko: 'AI·인터넷 플랫폼', match: ['internet-content', 'internet-retail', 'electronic-gaming'] },
  { etf: 'DRIV', ko: '전기차·자율주행', match: ['auto-manufacturers', 'auto-parts'] },
  { etf: 'LIT', ko: '2차전지·리튬', match: ['electrical-equipment', 'specialty-chemicals', 'chemicals', 'lithium'] },
  { etf: 'IBB', ko: '바이오·제약', match: ['biotechnology', 'drug-manufacturers', 'medical'] },
  { etf: 'ITA', ko: '방산·우주항공', match: ['aerospace-defense'] },
];

// 구조적 성장/쇠퇴 산업(정적 분류, 약한 가중치로만 사용)
export const STRUCTURAL = {
  growth: ['semiconductor', 'software', 'internet-content', 'biotechnology', 'aerospace-defense', 'electrical-equipment', 'solar', 'information-technology-services'],
  decline: ['tobacco', 'department-stores', 'broadcasting', 'publishing', 'coal', 'oil-gas-refining'],
};

// 거시·시장 데이터 심볼 (Yahoo)
export const MACRO_SYMBOLS = {
  rates: ['^IRX', '^FVX', '^TNX', '^TYX'],
  vol: ['^VIX', '^VIX3M'],
  fx: ['DX-Y.NYB', 'KRW=X', 'JPY=X', 'CNY=X', 'HKD=X', 'TWD=X', 'INR=X', 'EUR=X', 'GBP=X', 'DKK=X', 'CAD=X', 'BRL=X', 'AUD=X'],
  commodities: ['CL=F', 'BZ=F', 'GC=F', 'HG=F', 'NG=F'],
  credit: ['HYG', 'LQD', 'IEF', 'TLT', 'TIP', 'SHY'],
  breadth: ['SPY', 'RSP', 'ACWI', 'EEM', 'BTC-USD'],
};

export const SYMBOL_LABELS = {
  '^IRX': '미국 3개월 국채금리', '^FVX': '미국 5년 국채금리', '^TNX': '미국 10년 국채금리', '^TYX': '미국 30년 국채금리',
  '^VIX': 'VIX 변동성지수', '^VIX3M': 'VIX 3개월', 'DX-Y.NYB': '달러 인덱스', 'KRW=X': '원/달러 환율', 'JPY=X': '엔/달러 환율',
  'CNY=X': '위안/달러 환율', 'EUR=X': '유로/달러(달러당 유로)', 'CL=F': 'WTI 원유', 'BZ=F': '브렌트유', 'GC=F': '금', 'HG=F': '구리',
  'NG=F': '천연가스', 'HYG': '하이일드 채권 ETF', 'LQD': '투자등급 회사채 ETF', 'IEF': '미 국채 7-10년 ETF', 'TLT': '미 국채 20년+ ETF',
  'TIP': '물가연동채 ETF', 'SHY': '미 국채 1-3년 ETF', 'SPY': 'S&P 500 ETF', 'RSP': 'S&P 500 동일가중 ETF', 'ACWI': '전세계 주식 ETF',
  'EEM': '신흥국 주식 ETF', 'BTC-USD': '비트코인',
};

// FRED 경제지표 (API 키 불필요 CSV)
export const FRED_SERIES = {
  FEDFUNDS: '미국 기준금리(실효)',
  CPIAUCSL: '미국 CPI',
  CPILFESL: '미국 근원 CPI',
  UNRATE: '미국 실업률',
  CES0500000003: '미국 시간당 임금',
  ICSA: '미국 신규 실업수당 청구',
  M2SL: '미국 M2 통화량',
  WALCL: '연준 총자산',
  A191RL1Q225SBEA: '미국 실질 GDP 성장률',
  T10Y2Y: '미국 장단기 금리차(10Y-2Y)',
  T10Y3M: '미국 장단기 금리차(10Y-3M)',
  BAMLH0A0HYM2: '미국 하이일드 스프레드',
  T10YIE: '10년 기대인플레이션',
  UMCSENT: '미시간대 소비자심리',
  IR3TIB01KRM156N: '한국 3개월 금리', IR3TIB01JPM156N: '일본 3개월 금리', IR3TIB01EZM156N: '유로존 3개월 금리',
  IR3TIB01GBM156N: '영국 3개월 금리', IR3TIB01CNM156N: '중국 3개월 금리', IR3TIB01INM156N: '인도 3개월 금리',
  IR3TIB01AUM156N: '호주 3개월 금리', IR3TIB01CAM156N: '캐나다 3개월 금리', IR3TIB01DKM156N: '덴마크 3개월 금리',
  IR3TIB01BRM156N: '브라질 3개월 금리',
};

// 예정된 거시·정치 이벤트 (필요 시 직접 수정)
// (출처: 각 중앙은행 공시 일정, 2026-09-30 확인)
export const SCHEDULED_EVENTS = [
  { date: '2026-10-22', title: '한국은행 기준금리 결정', type: 'macro', impact: 'high' },
  { date: '2026-10-28', title: '미국 FOMC 금리 결정', type: 'macro', impact: 'high' },
  { date: '2026-10-29', title: 'ECB 통화정책 결정', type: 'macro', impact: 'medium' },
  { date: '2026-10-30', title: '일본은행 금융정책 결정', type: 'macro', impact: 'medium' },
  { date: '2026-11-03', title: '미국 중간선거', type: 'political', impact: 'high' },
  { date: '2026-11-18', title: 'APEC 정상회의(선전)·미중 정상회담', type: 'political', impact: 'medium' },
  { date: '2026-12-09', title: '미국 FOMC 금리 결정', type: 'macro', impact: 'high' },
  { date: '2027-01-27', title: '미국 FOMC 금리 결정', type: 'macro', impact: 'high' },
];

export const SIGNALS = [
  { min: 0.35, label: '강력 매수', key: 'strong-buy' },
  { min: 0.12, label: '매수', key: 'buy' },
  { min: -0.12, label: '중립', key: 'neutral' },
  { min: -0.35, label: '매도', key: 'sell' },
  { min: -Infinity, label: '강력 매도', key: 'strong-sell' },
];

export function signalOf(score) {
  return SIGNALS.find(s => score >= s.min);
}

export function fileKey(symbol) {
  return symbol.replace(/[^A-Za-z0-9.-]/g, '_');
}
