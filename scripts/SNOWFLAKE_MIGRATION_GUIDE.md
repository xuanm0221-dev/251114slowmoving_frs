# Snowflake 마이그레이션 가이드

기존 CSV 기반 판매/재고 집계를 Snowflake 직접 조회로 전환하는 가이드입니다.

## 📋 사전 준비

### 1. Python 패키지 설치

```bash
cd scripts
pip install -r requirements.txt
```

필수 패키지:
- `snowflake-connector-python>=3.0.0`: Snowflake 연결
- `python-dotenv>=1.0.0`: 환경변수 관리

### 2. 환경변수 설정

프로젝트 루트에 `.env.local` 파일을 생성하고 Snowflake 연결 정보를 입력합니다:

```bash
cp env.example .env.local
# .env.local 파일을 편집하여 실제 값 입력
```

`.env.local` 예시:
```env
SNOWFLAKE_ACCOUNT=your_account.ap-northeast-2.aws
SNOWFLAKE_USER=your_username
SNOWFLAKE_PASSWORD=your_password
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
SNOWFLAKE_DATABASE=FNF
SNOWFLAKE_SCHEMA=CHN
SNOWFLAKE_ROLE=ANALYST_ROLE
```

### 3. 연결 테스트

```bash
cd scripts
python snowflake_utils.py
```

성공 시 Snowflake 버전, 데이터베이스, 스키마 정보가 출력됩니다.

**참고**: CREATE VIEW 권한이 없어도 괜찮습니다! Python 스크립트가 CTE로 remark 정규화를 처리합니다.

---

## 🚀 실행 방법

### Step 1: 기존 JSON 백업

**중요**: 기존 결과와 비교하기 위해 반드시 백업합니다!

```bash
cd ../public/data
cp accessory_sales_summary.json accessory_sales_summary.json.backup
cp accessory_inventory_summary.json accessory_inventory_summary.json.backup
```

### Step 2: 판매 데이터 생성

```bash
cd ../../scripts
python preprocess_sales.py
```

출력:
- `public/data/accessory_sales_summary.json`: 판매 집계 결과

예상 소요 시간: 1-3분 (Snowflake 성능에 따라 다름)

### Step 3: 재고 데이터 생성

```bash
python preprocess_inventory.py
```

출력:
- `public/data/accessory_inventory_summary.json`: 재고 집계 결과

예상 소요 시간: 2-5분

### Step 4: 확인

대시보드를 열어서 데이터가 정상적으로 표시되는지 확인합니다.

**검증 케이스:**
- 2024.01 / MLB / 전체
- 2024.06 / MLB KIDS / Shoes
- 2025.11 / DISCOVERY / Headwear
- 2025.06 / MLB / Bag
- 2024.10 / MLB KIDS / 전체

**허용 오차:** ±0.1% (반올림 차이 허용)

---

## ✅ 검증 결과 확인

### 성공 예시

```
[판매] 5/5 케이스 통과
  ✓ PASS: 2024.01 / MLB / 전체
  ✓ PASS: 2024.06 / MLB KIDS / Shoes
  ...

[재고] 5/5 케이스 통과
  ✓ PASS: 2024.01 / MLB / 전체
  ...

✓ 전체 검증 성공: 10/10 케이스 통과
```

### 실패 시 조치

차이가 발생한 경우:

1. **작은 차이 (< 0.1%)**: 반올림 차이로 정상
2. **큰 차이 (> 1%)**: 다음 확인
   - Snowflake 뷰가 올바르게 생성되었는지
   - 데이터 필터 조건 확인 (브랜드, 카테고리 등)
   - SQL 쿼리의 조인 조건 확인

---

## 🔍 디버깅

### 1. 단일 월 테스트

특정 월만 테스트하려면 Python 코드에서 `ANALYSIS_MONTHS`를 수정:

```python
ANALYSIS_MONTHS = ["2025.11"]  # 테스트용
```

### 2. SQL 쿼리 직접 실행

Snowflake Web UI에서 쿼리를 직접 실행하여 데이터 확인:

```sql
-- 판매 데이터 샘플 확인
SELECT * FROM CHN.DW_SALE
WHERE brd_cd = 'M'
  AND TO_CHAR(sale_dt, 'YYYYMM') = '202511'
LIMIT 100;

-- 운영기준 뷰 확인
SELECT * FROM FNF.CHN.V_PRDT_REMARK_NORMALIZED
WHERE prdt_scs_cd = 'some_product_code'
LIMIT 10;
```

### 3. 상세 로그 확인

Python 스크립트 실행 시 상세 로그가 출력됩니다:

```
[판매] Snowflake에서 데이터 조회 중... (202401 ~ 202511)
  배치 로드: 10,000행...
  배치 로드: 20,000행...
[판매] 조회 완료: 45,321행
[판매] 집계 완료: 8,280개 키
```

---

## 📊 데이터 구조

### 판매 JSON 구조 (변경 없음)

```json
{
  "brands": {
    "MLB": {
      "전체": {
        "2024.01": {
          "전체_core": 130721229,
          "전체_outlet": 240756291,
          "FRS_core": 114147407,
          "FRS_outlet": 203489734,
          "OR_core": 16573822,
          "OR_outlet": 37266557
        },
        ...
      },
      "Shoes": { ... },
      ...
    },
    ...
  },
  "months": ["2024.01", ...],
  "unexpectedCategories": []
}
```

### 재고 JSON 구조 (변경 없음)

```json
{
  "brands": {
    "MLB": {
      "전체": {
        "2024.01": {
          "전체_core": 837680246,
          "FRS_core": 481776591,
          "HQ_OR_core": 355903655,
          "OR_sales_core": 16573822,
          "전체_outlet": 2565403298,
          ...
        },
        ...
      },
      ...
    },
    ...
  },
  "months": ["2024.01", ...],
  "daysInMonth": {"2024.01": 31, ...}
}
```

---

## 🎯 핵심 로직

### 주력/아울렛 판정

각 데이터 행의 월에 해당하는 분기의 운영기준(remark)을 기준으로 판정:

```sql
CASE
  -- 1. op_std가 있으면 우선
  WHEN op_std IN ('FOCUS', 'INTRO') THEN 'core'
  WHEN op_std IN ('OUTLET', 'CARE', 'DONE') THEN 'outlet'
  
  -- 2. op_std가 숫자+시즌이면 연도 비교
  WHEN op_std에서 추출한 YY >= 해당행의 YY THEN 'core'
  ELSE 'outlet'
  
  -- 3. op_std가 NULL이면 sesn으로 판단
  WHEN sesn의 YY >= 해당행의 YY THEN 'core'
  ELSE 'outlet'
END
```

### 채널 구분

**판매:**
- FR: 대리상
- OR: 직영
- HQ: **제외** (판매는 매장에서만 발생)
- 전체 = FR + OR

**재고:**
- FR: 대리상
- OR + HQ: 본사재고
- 전체 = FR + OR + HQ

---

## 📝 주의사항

1. **환경변수 필수**: `.env.local` 없으면 연결 실패
2. **백업 필수**: 기존 JSON 백업 없으면 검증 불가
3. **읽기 권한 필요**: Snowflake 테이블 읽기 권한 필요 (CREATE VIEW 권한 불필요)
4. **네트워크**: Snowflake 접근 가능한 네트워크 환경 필요
5. **VIEW 권한 없어도 OK**: Python 스크립트가 CTE로 자동 처리

---

## 🔄 향후 유지보수

### remark 컬럼 추가 시

CTE에 새로운 remark 추가 (각 집계 스크립트의 `remark_normalized` CTE):

```sql
UNION ALL

-- remark9: 2026-01-01 (26.1Q)
SELECT 
  prdt_scs_cd,
  '2026-01-01'::DATE,
  9,
  'remark9',
  remark9
FROM FNF.CHN.MST_PRDT_SCS
WHERE remark9 IS NOT NULL AND TRIM(remark9) != ''
```

### 분석 기간 확장

Python 스크립트의 `ANALYSIS_MONTHS` 리스트에 새로운 월 추가:

```python
ANALYSIS_MONTHS = [
    ...,
    "2025.12",  # 신규 추가
]
```

---

## 🆘 문제 해결

### "Connection refused" 오류

- Snowflake 계정 정보 확인
- 네트워크 방화벽 확인
- VPN 연결 필요 여부 확인

### "Permission denied" 오류

- Snowflake Role 권한 확인
- 테이블 읽기 권한 확인 (CHN.DW_SALE, CHN.DW_STOCK_M, FNF.CHN.MST_PRDT_SCS)

### "CREATE VIEW 권한 없음"

- **문제 없습니다!** Python 스크립트가 CTE로 자동 처리합니다
- VIEW 생성 단계는 건너뛰어도 됩니다

---

## 📞 연락처

문제 발생 시 데이터팀에 문의하세요.

