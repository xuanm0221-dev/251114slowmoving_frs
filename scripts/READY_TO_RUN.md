# ✅ 실행 준비 완료!

VIEW 권한 없이도 동작하도록 모든 코드가 수정되었습니다.

## 🎯 수정 완료된 항목

1. ✅ **sales_aggregation.py** - VIEW → CTE로 변경
2. ✅ **inventory_aggregation.py** - VIEW → CTE로 변경
3. ✅ **remark 정규화** - CTE 방식으로 구현됨 (VIEW 권한 불필요)
4. ✅ **가이드 문서** - VIEW 생성 단계 제거
5. ✅ **.env.local** - Snowflake 연결 정보 설정됨

## 🚀 바로 실행하기

### 1단계: 패키지 설치 (최초 1회)

```bash
cd scripts
pip install -r requirements.txt
```

### 2단계: 연결 테스트

```bash
python snowflake_utils.py
```

**예상 출력:**
```
============================================================
Snowflake 연결 테스트
============================================================
[SUCCESS] Snowflake 연결 성공:
  Version: 8.x.x
  Database: FNF
  Schema: CHN
```

### 3단계: 기존 JSON 백업

```bash
cd ../public/data
copy accessory_sales_summary.json accessory_sales_summary.json.backup
copy accessory_inventory_summary.json accessory_inventory_summary.json.backup
```

### 4단계: 판매 데이터 생성

```bash
cd ..\..\scripts
python preprocess_sales.py
```

**예상 소요 시간:** 1-3분

**예상 출력:**
```
============================================================
판매 데이터 Snowflake 조회 시작
============================================================
[판매] Snowflake에서 데이터 조회 중... (202401 ~ 202511)
  배치 로드: 10,000행...
  배치 로드: 20,000행...
[판매] 조회 완료: 45,321행
[판매] 집계 완료: 8,280개 키
[DONE] 판매 JSON 저장: ...accessory_sales_summary.json
```

### 5단계: 재고 데이터 생성

```bash
python preprocess_inventory.py
```

**예상 소요 시간:** 2-5분

**예상 출력:**
```
============================================================
재고자산 데이터 전처리 시작 (Snowflake 버전)
============================================================
[재고] OR 판매 데이터 조회 중...
[재고] Snowflake에서 데이터 조회 중... (202401 ~ 202511)
[재고] 조회 완료: 52,145행
[재고] 집계 완료: 9,840개 키
[DONE] 저장 완료: ...accessory_inventory_summary.json
```

### 6단계: 확인

대시보드를 열어서 데이터가 정상적으로 표시되는지 확인합니다.

---

## 🔍 문제 발생 시

### 연결 오류

```
ConnectionError: Snowflake 연결 실패
```

**해결:**
- `.env.local` 파일 확인
- Snowflake 계정 정보 확인
- 네트워크/VPN 확인

### 권한 오류

```
SQL access control error: Insufficient privileges
```

**해결:**
- 테이블 읽기 권한 확인:
  - `CHN.DW_SALE`
  - `CHN.DW_STOCK_M`
  - `FNF.CHN.MST_PRDT_SCS`
  - `CHN.DW_SHOP_WH_DETAIL`

### 데이터 없음

```
[WARNING] 파일이 존재하지 않습니다
```

**해결:**
- Snowflake에 해당 월의 데이터가 있는지 확인
- 월 범위 확인 (202401~202511)

---

## 📊 성공 확인

프론트엔드에서 대시보드를 열어 다음을 확인:

1. **판매매출표**: 숫자가 업데이트되어야 함
2. **재고자산표**: 숫자가 업데이트되어야 함
3. **차트**: 데이터가 정상 표시되어야 함

---

## 💡 핵심 포인트

1. **VIEW 생성 불필요**: Python 스크립트가 CTE로 자동 처리
2. **프론트엔드 무변경**: JSON 구조가 동일하므로 UI 변경 없음
3. **한 번만 실행**: 데이터가 변경될 때만 다시 실행
4. **자동화 가능**: 스케줄러로 자동 실행 가능

---

## 🎉 완료!

이제 Snowflake에서 직접 데이터를 조회하여 JSON을 생성합니다.

문제가 있으면 `SNOWFLAKE_MIGRATION_GUIDE.md`를 참고하세요.

