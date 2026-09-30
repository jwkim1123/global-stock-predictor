# 글로벌 주식시장 예측 대시보드

**사이트:** https://jwkim1123.github.io/global-stock-predictor/

전세계 주요 지수 18개와 대표 종목 38개를 **9개 요인**(기업 펀더멘털·산업·거시경제·기술적 분석·수급·시장 심리·이벤트·계량·리스크)과 **블랙스완 위험**으로 분석하고, 1주~1년 뒤 주가의 **확률 분포**를 예측하는 정적 웹사이트입니다. 전부 JavaScript로 작성했고 GitHub Pages로 호스팅합니다.

> 모든 예측은 통계 모델의 확률적 추정이며 투자 권유가 아닙니다.

## 구성

| 화면 | 내용 |
|---|---|
| 대시보드 | 거시 환경 점수, 공포·탐욕 지수, 블랙스완 위험 지수, 세계 지수 전망, 거시 지표 24종, 상·하위 종목, 일정, 헤드라인 |
| 종목 랭킹 | 시장·섹터·기간 필터, 9개 요인 히트맵, 알파·기대수익률·상승확률 정렬 |
| 종목 상세 | 가격+예측 팬차트, 요인별 세부 지표 100여 개, 수익률 분포, 스트레스 테스트, ML 검증, 계절성, 투자자별 매매, 뉴스 감성, **가중치를 바꿔 브라우저에서 즉시 재시뮬레이션** |
| 분석 리포트 | 데이터와 최신 뉴스를 바탕으로 작성한 심층 리포트 (`reports/`) |
| 예측 성적표 | 매일 기록한 예측을 만기 후 실제 가격과 대조 + 워크포워드 백테스트 |
| 방법론 | 지표·가중치·모델·한계 설명 |

## 작동 방식

```
GitHub Actions (평일 1회, 약 2~3분)
  scripts/collect.mjs  → Yahoo Finance · FRED · 네이버 증권 수집 (캐시 재사용)
  scripts/build.mjs    → 분석 엔진 실행 → data/*.json 생성, 예측 기록 커밋
  → GitHub Pages 배포

브라우저
  index.html + assets/js/*  → JSON을 읽어 화면 구성
  assets/js/engine/*        → 같은 분석 엔진 (가중치 변경 시 몬테카를로를 브라우저에서 재계산)
```

브라우저는 CORS 정책 때문에 금융 데이터 API를 직접 호출할 수 없어서, 데이터 수집만 Actions(Node.js)에서 하고 분석 엔진은 서버와 브라우저가 공유합니다.

### 예측 모델 요약

- **기준 기대수익:** 무위험금리 + 베타 × 주식위험프리미엄(5%)
- **알파:** Grinold 공식 `α = IC × σ × z` (요인 종합점수 + 워크포워드 검증을 통과한 ML 신호)
- **변동성:** GARCH(1,1) + 옵션 내재변동성 혼합, 블랙스완 지수로 확대
- **꼬리:** 스튜던트 t-분포 + 시장 붕괴 점프(연 8% × 스트레스 배수) + 실적 발표일 점프
- **머신러닝:** 릿지 + 그래디언트 부스팅, 퍼지드 워크포워드로 검증된 만큼만 반영

## 폴더 구조

```
index.html                 앱 셸
assets/style.css           라이트/다크 테마 스타일
assets/js/app.js           라우터
assets/js/pages/*.js       화면별 렌더러
assets/js/charts.js        SVG 차트
assets/js/engine/          분석 엔진 (config, stats, indicators, patterns, text, volatility, simulate, ml, context, factors/*)
scripts/collect.mjs        데이터 수집 (yahoo-finance2, FRED, 네이버)
scripts/build.mjs          분석 실행 + 사이트 데이터 생성 + 예측 기록
universe.json              분석 대상 목록
history/predictions.csv    일별 예측 기록 (Actions가 커밋)
reports/                   분석 리포트
.github/workflows/update.yml
```

## 종목 추가·삭제

`universe.json`의 `stocks` 배열을 수정해 커밋하면 다음 실행부터 반영됩니다. 한국 종목은 `005930.KS`(코스피), `247540.KQ`(코스닥) 형식입니다.

## 로컬 실행

```bash
npm ci
node scripts/collect.mjs     # 데이터 수집 (인터넷 필요)
node scripts/build.mjs       # 분석
node scripts/serve.mjs       # http://localhost:8080
```

## 데이터 출처와 한계

- Yahoo Finance(비공식 API, `yahoo-finance2`), FRED, 네이버 증권 모바일 API
- 국내 공매도·신용잔고, 소셜미디어 언급량 등은 무료 공개 API가 없어 대리지표로 대체
- 재무·뉴스 데이터는 현재 스냅샷뿐이라 백테스트는 가격·거시 기반 ML만 포함
- 무료 티어 부담을 줄이기 위해 평일 하루 1회, 요청은 실행당 약 400건 이하
