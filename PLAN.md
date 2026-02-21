# 마감 해제 기능 구현 계획 (옵션 1: 3개 동시 해제)

## 목표
마감 해제 버튼 클릭 시 다음 항목들을 모두 동시에 해제:
1. 일반 마감 (`closed_months.json`에서 해당 월 제거)
2. 대리상 마감 (`dealer_closed_months.json`에서 해당 월 제거)
3. 스냅샷 파일 삭제 (3개 파일):
   - 판매 스냅샷: `accessory_sales_summary_YYYYMM.json`
   - 재고 스냅샷: `accessory_inventory_summary_YYYYMM.json`
   - 입고예정 스냅샷: `accessory_forecast_inventory_summary_YYYYMM.json`

## 작업 항목

### 1. `src/lib/batchDataLoader.ts` 수정
- [ ] `removeClosedMonth(month: string)` 함수 추가
  - `closed_months.json`에서 해당 월 제거
  - 파일이 없거나 월이 없으면 에러 없이 처리
- [ ] `removeDealerClosedMonth(month: string)` 함수 추가
  - `dealer_closed_months.json`에서 해당 월 제거
  - 파일이 없거나 월이 없으면 에러 없이 처리

### 2. `pages/api/reopen-month.ts` 생성
- [ ] POST 요청 처리
- [ ] 요청 본문에서 `month` 파라미터 받기 (예: "2025.12")
- [ ] `removeClosedMonth(month)` 호출
- [ ] `removeDealerClosedMonth(month)` 호출
- [ ] 스냅샷 파일 삭제:
  - `accessory_sales_summary_YYYYMM.json`
  - `accessory_inventory_summary_YYYYMM.json`
  - `accessory_forecast_inventory_summary_YYYYMM.json`
- [ ] 성공 응답 반환
- [ ] 에러 처리

### 3. `src/components/Navigation.tsx` 수정
- [ ] `isReopening` state 추가 (로딩 상태 관리)
- [ ] `handleReopenMonth` 핸들러 함수 추가
  - `/api/reopen-month` POST 요청
  - 성공 시 알림 표시
  - 마감 목록 새로고침 (`closedMonthsList`, `dealerClosedMonthsList`)
  - 스냅샷 목록 새로고침 (`snapshotMonths`, `forecastSnapshotMonths`)
- [ ] UI 수정:
  - 마감 완료 상태일 때 "마감 완료" 표시 옆에 "마감 해제" 버튼 추가
  - 버튼 클릭 시 `handleReopenMonth` 호출
  - 로딩 중일 때 "해제 중..." 표시 및 버튼 비활성화

## 구현 세부사항

### `removeClosedMonth` 함수 구조
```typescript
export function removeClosedMonth(month: string): void {
  const closedMonths = getClosedMonths();
  const filtered = closedMonths.filter(m => m !== month);
  
  if (filtered.length === closedMonths.length) {
    // 월이 없었으면 아무것도 하지 않음
    return;
  }
  
  fs.writeFileSync(
    CLOSED_MONTHS_FILE,
    JSON.stringify(filtered, null, 2),
    "utf-8"
  );
}
```

### `removeDealerClosedMonth` 함수 구조
```typescript
export function removeDealerClosedMonth(month: string): void {
  const closedMonths = getDealerClosedMonths();
  const filtered = closedMonths.filter(m => m !== month);
  
  if (filtered.length === closedMonths.length) {
    // 월이 없었으면 아무것도 하지 않음
    return;
  }
  
  fs.writeFileSync(
    DEALER_CLOSED_MONTHS_FILE,
    JSON.stringify(filtered, null, 2),
    "utf-8"
  );
}
```

### `reopen-month.ts` API 구조
```typescript
// 1. month 파라미터 검증
// 2. removeClosedMonth(month) 호출
// 3. removeDealerClosedMonth(month) 호출
// 4. 스냅샷 파일 삭제 (존재하는 경우만)
// 5. 성공 응답
```

### Navigation UI 구조
```tsx
{isMonthClosed ? (
  <div className="flex items-center gap-2">
    <div className="px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
      <span>마감 완료</span>
    </div>
    <button
      onClick={handleReopenMonth}
      disabled={isReopening}
      className="px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
    >
      {isReopening ? "해제 중..." : "마감 해제"}
    </button>
  </div>
) : canCloseMonth ? (
  <button onClick={handleCloseMonth}>마감 처리</button>
) : null}
```

## 주의사항
- 스냅샷 파일 삭제는 되돌릴 수 없으므로 주의 필요
- 마감 해제 후 해당 월은 다시 실시간 Snowflake 조회로 전환됨
- 대리상 데이터와 정체재고 데이터는 JSON에서 삭제되지 않음 (별도 관리 필요 시 추가 고려)
