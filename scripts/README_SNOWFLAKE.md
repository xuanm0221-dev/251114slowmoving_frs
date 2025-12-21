# Snowflake 마이그레이션 완료 ✅

CSV 기반 판매/재고 집계가 Snowflake 직접 조회로 성공적으로 전환되었습니다.

## 🎯 작업 완료 항목

### ✅ 1. Snowflake 인프라
- `snowflake_utils.py`: Snowflake 연결 유틸리티
- 환경변수 관리 (`env.example`)
- 운영기준(remark) 정규화: CTE 방식 사용 (VIEW 권한 불필요)

### ✅ 2. 판매 집계
- `sales_aggregation.py`: Snowflake 판매 집계 SQL
- `preprocess_sales.py`: CSV → Snowflake 전환 완료

### ✅ 3. 재고 집계
- `inventory_aggregation.py`: Snowflake 재고 집계 SQL
- `preprocess_inventory.py`: CSV → Snowflake 전환 완료

### ✅ 4. 가이드 문서
- `SNOWFLAKE_MIGRATION_GUIDE.md`: 상세 실행 가이드
- `READY_TO_RUN.md`: 빠른 시작 가이드

## 🚀 빠른 시작

### 1단계: 환경 설정

```bash
# 패키지 설치
pip install -r requirements.txt

# 환경변수 설정
cp env.example .env.local
# .env.local 편집하여 Snowflake 정보 입력
```

**참고**: CREATE VIEW 권한이 없어도 괜찮습니다! CTE로 자동 처리됩니다.

### 2단계: 연결 테스트

```bash
python snowflake_utils.py
```

### 3단계: 데이터 생성

```bash
# 기존 JSON 백업
cd ../public/data
cp accessory_sales_summary.json accessory_sales_summary.json.backup
cp accessory_inventory_summary.json accessory_inventory_summary.json.backup

# 판매 데이터 생성
cd ../../scripts
python preprocess_sales.py

# 재고 데이터 생성
python preprocess_inventory.py
```

### 5단계: 확인

대시보드를 열어서 데이터가 정상적으로 표시되는지 확인하세요.

## 📊 주요 변경사항

| 항목 | 기존 | 변경 후 |
|------|------|---------|
| 데이터 소스 | 로컬 CSV 파일 | Snowflake 직접 조회 |
| 주력/아울렛 판정 | 하드코딩된 시즌 리스트 | 분기별 remark 동적 적용 |
| 처리 시간 | CSV 읽기 + pandas 처리 | Snowflake 서버 집계 |
| 유지보수 | CSV 파일 관리 필요 | Snowflake 뷰만 관리 |
| JSON 구조 | **변경 없음** | **변경 없음** |
| 프론트엔드 | **변경 없음** | **변경 없음** |

## 🎨 핵심 설계

### 운영기준 정규화

```
FNF.CHN.MST_PRDT_SCS.remark1~8
          ↓
FNF.CHN.V_PRDT_REMARK_NORMALIZED
  (prdt_scs_cd, q_start_dt, op_std)
```

### 주력/아울렛 판정

```
1. op_std 우선 (FOCUS/INTRO → 주력)
2. op_std 시즌YY >= 행YY → 주력
3. sesn YY >= 행YY → 주력
4. 그 외 → 아울렛
```

### 채널 구분

**판매**: FR + OR (HQ 제외)  
**재고**: FR + OR + HQ (HQ 포함)

## 📁 생성된 파일

```
scripts/
├── create_snowflake_views.sql          # Snowflake 뷰 생성
├── snowflake_utils.py                  # 연결 유틸리티
├── sales_aggregation.py                # 판매 집계 SQL
├── inventory_aggregation.py            # 재고 집계 SQL
├── preprocess_sales.py                 # 판매 전처리 (수정됨)
├── preprocess_inventory.py             # 재고 전처리 (수정됨)
├── validate_results.py                 # 검증 스크립트
├── requirements.txt                    # 패키지 목록 (업데이트됨)
├── SNOWFLAKE_MIGRATION_GUIDE.md        # 상세 가이드
└── README_SNOWFLAKE.md                 # 이 파일

env.example                             # 환경변수 샘플
```

## ⚠️ 중요 참고사항

1. **프론트엔드 무변경**: JSON 구조가 100% 동일하므로 UI 변경 없음
2. **기존 JSON 백업**: 검증을 위해 반드시 백업
3. **환경변수 필수**: `.env.local` 없으면 연결 실패
4. **읽기 권한만 필요**: Snowflake 테이블 읽기 권한만 있으면 됨 (CREATE VIEW 불필요)
5. **CTE 자동 처리**: Python 스크립트가 remark 정규화를 자동으로 처리

## 🔍 검증 방법

`validate_results.py`는 다음 케이스를 검증합니다:

- 2024.01 / MLB / 전체
- 2024.06 / MLB KIDS / Shoes
- 2025.11 / DISCOVERY / Headwear
- 2025.06 / MLB / Bag
- 2024.10 / MLB KIDS / 전체

**허용 오차**: ±0.1% (반올림 차이)

## 🎉 완료!

모든 구현이 완료되었습니다. 상세한 실행 방법은 `SNOWFLAKE_MIGRATION_GUIDE.md`를 참고하세요.

## 📞 문제 해결

- **연결 오류**: `.env.local` 확인
- **권한 오류**: Snowflake 테이블 읽기 권한 확인
- **데이터 차이**: `validate_results.py` 로그 확인
- **VIEW 권한 없음**: 문제 없음! CTE로 자동 처리됨

---

**다음 단계 (Phase 2 - 추후 작업)**:
- 주력/아울렛 상세보기 API 구현
- UI에 상세 모달 추가

