# 고객청구서 출력양식(빠른 사양)

## 목적
- `project_invoices`와 `request_payload`를 기반으로 고객 안내용 청구서 본문(HTML/텍스트)을 생성한다.
- 1차 범위는 출력 템플릿과 메일 본문 생성에 한정한다.

## 입력 데이터 소스
- 헤더/금액/수신자: `project_invoices` 저장 필드
- 상세 항목: `request_payload.invoice_items`
- 보조 값: `registered_projects`의 `project_name`, `client_name`

## 필수 필드
- 프로젝트코드: `project_code`
- 프로젝트명: `project_name`
- 고객사: `client_name` (없으면 `buyer_company_name`)
- 청구월: `billing_month`
- 공급가액: `invoice_amount`
- 부가세: `vat_amount`
- 합계: `total_amount`
- 발행예정일: `planned_issue_date`
- 입금예정일: `expected_payment_date`
- 수신자: `recipient_name`, `recipient_email`
- 공급받는자 사업자번호: `buyer_business_no`

## 선택 필드
- 요청 메모: `legal_note`
- 상세 항목 라인: `request_payload.invoice_items[*]`
  - 항목명: `name`
  - 일자: `cost_date` 또는 `due_date`
  - 공급가액: `supply_amount`
  - 비고: `note` 또는 `vendor`

## 렌더링 규칙
- 상세 항목이 없으면 요약 1행(`item_name`)을 사용한다.
- 금액 표시는 모두 원화 단위(`xx,xxx원`)로 통일한다.
- 합계는 `공급가액 + 부가세`와 반드시 일치해야 한다.

## 차단 규칙
- 아래 항목이 비어 있으면 본문 생성/전송을 차단한다.
  - `recipient_email`
  - `buyer_business_no`
  - `planned_issue_date`
- 금액 정합성 불일치(`invoice_amount`, `vat_amount`, `total_amount`) 시 차단한다.

## 1차 산출물
- 고객청구서 HTML 템플릿 함수 1개
- 고객청구서 텍스트 본문 함수 1개
- 발행요청 시 메일 payload(`invoice_html`, `invoice_summary_text`) 연계
