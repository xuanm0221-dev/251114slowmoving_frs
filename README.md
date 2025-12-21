# 📊 브랜드별 재고주수 대시보드

브랜드별 악세사리 재고주수 및 정체재고 분석 대시보드입니다.

## 🎯 주요 기능

### 1. 재고주수 분석
- 월별 재고주수 추이 차트
- 아이템별 재고주수 현황 (신발, 모자, 가방, 기타)
- 상품 타입별 분석 (전체/주력/아울렛)

### 2. 재고금액 추이
- 정상/정체 재고금액 월별 추이 막대차트
- 전년대비 / 매출액대비 비교
- Y축 동적 범위 (브랜드별 데이터 스케일에 맞게 자동 조정)

### 3. 정체재고 분석
- 스타일 / 컬러&사이즈 기준 분석
- 정체재고 상세 조회 모달
- 정체재고 기준: 과시즌 중 (당월판매 ÷ 중분류 기말재고) < 1%

### 4. 재고/판매/입고 추이
- 월별 재고자산, 판매매출, 입고예정 추이 표
- 실제 입고 데이터 연동

### 5. 재고 시뮬레이션
- **기준재고주수 입력**: 목표 재고주수 설정 (기본값 40주)
- **신규발주가능 금액**: 26년 3월 기준 목표 달성을 위한 증감액 자동 계산
- 아이템 탭, 성장률, 재고주수 기준(1/2/3개월)과 실시간 연동

## 🏢 대상 브랜드

| 브랜드 | 설명 |
|--------|------|
| **MLB** | MLB 브랜드 악세사리 |
| **MLB KIDS** | MLB KIDS 브랜드 악세사리 |
| **DISCOVERY** | DISCOVERY 브랜드 악세사리 |

## 📦 아이템 카테고리

- **Shoes** (신발)
- **Headwear** (모자)
- **Bag** (가방)
- **Acc_etc** (기타)

## 🛠️ 기술 스택

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Charts**: Recharts
- **Database**: Snowflake
- **Data Processing**: Python

## 🚀 실행 방법

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

`.env.local` 파일 생성:

```env
SNOWFLAKE_ACCOUNT=your_account
SNOWFLAKE_USER=your_username
SNOWFLAKE_PASSWORD=your_password
SNOWFLAKE_DATABASE=your_database
SNOWFLAKE_SCHEMA=your_schema
SNOWFLAKE_WAREHOUSE=your_warehouse
```

### 3. 데이터 전처리

```bash
# 판매매출 데이터 전처리
python scripts/preprocess_sales.py

# 재고자산 데이터 전처리
python scripts/preprocess_inventory.py

# 입고예정 재고자산 데이터 전처리
python scripts/preprocess_forecast_inventory.py

# 실제 입고 데이터는 Snowflake API에서 자동 조회됩니다.
```

### 4. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000` 접속

## 📁 프로젝트 구조

```
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── page.tsx              # 홈 페이지
│   │   ├── mlb-sales/            # MLB 페이지
│   │   ├── mlb-kids-sales/       # MLB KIDS 페이지
│   │   └── discovery-sales/      # DISCOVERY 페이지
│   ├── components/               # React 컴포넌트
│   │   ├── BrandSalesPage.tsx    # 브랜드 페이지 메인
│   │   ├── Navigation.tsx        # 상단 네비게이션 (고정)
│   │   ├── InventoryChart.tsx    # 재고자산 추이 차트
│   │   ├── InventorySeasonChart.tsx  # 정상/정체 재고금액 차트
│   │   ├── StockWeeksChart.tsx   # 재고주수 추이 차트
│   │   ├── StagnantStockAnalysis.tsx # 정체재고 분석
│   │   └── ...
│   ├── types/                    # TypeScript 타입 정의
│   └── lib/                      # 유틸리티 함수
├── pages/api/                    # API Routes
│   ├── inventory-season-chart.ts # 정상/정체 재고 API
│   ├── stagnant-stock.ts         # 정체재고 목록 API
│   └── stagnant-stock-detail.ts  # 정체재고 상세 API
├── scripts/                      # Python 전처리 스크립트
│   ├── preprocess_sales.py
│   ├── preprocess_inventory.py
│   └── preprocess_forecast_inventory.py
└── public/data/                  # 전처리된 JSON 데이터
```

## 📊 데이터 기준

- **분석 기간**: 2024.01 ~ 2025.11 (23개월)
- **전체판매**: FRS(대리상) + OR(직영) 합계
- **주력상품**: INTRO/FOCUS 또는 해당 연도 시즌 이상
- **아울렛상품**: OUTLET/CARE/DONE 또는 해당 연도 이전 시즌
- **분류 기준 관리**: `src/constants/businessRules.ts`에서 통합 관리
- **금액 단위**: M (백만 위안, 吊牌金额 기준)

## 📝 주요 계산식

### 재고주수
```
재고주수 = 기말재고금액 ÷ (월판매금액 ÷ 해당월일수 × 7)
```

### 정체재고 기준
```
정체재고 = 과시즌 상품 중 (당월판매 ÷ 중분류 기말재고) < 1%
```

### 목표 재고자산 역산 (시뮬레이션)
```
목표재고자산 = (기간매출 ÷ 기간일수 × 7) × 목표재고주수
신규발주가능금액 = 목표재고자산 - 타겟월(26.03) 예상기말재고
```
- **양수(+)**: 추가 발주 가능
- **음수(△)**: 발주 줄여야 함

## 🔧 채널 구분

| 채널 | 설명 |
|------|------|
| **ALL** | 전체 (FRS + 창고) |
| **FRS** | 대리상 |
| **창고** | 창고 재고 |

---

© 2024-2025 브랜드별 재고주수 대시보드

