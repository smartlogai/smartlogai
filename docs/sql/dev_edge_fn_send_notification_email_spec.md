# Edge Function Spec: `send_notification_email`

## 목적
- 인앱 알림 저장 후, 선택된 중요 타입에 대해서만 이메일을 추가 발송한다.
- 프론트는 `createNotification()` 성공 이후 비동기로 호출한다.

## 호출 위치
- `js/notify.js`
- 함수명 상수: `NOTIFY_EMAIL_FUNCTION = 'send_notification_email'`
- 메일 대상 타입:
  - `project_registered_final_approved`
  - `project_output_publish_request`
  - `project_output_access_request`
  - `project_output_bulk_access_alert`
  - `project_clearance_notice`
  - `helpdesk_new_ticket`

## Request (JSON)
```json
{
  "notification_id": "uuid-or-empty",
  "to_user_id": "U123",
  "to_user_name": "수신자명",
  "from_user_id": "U999",
  "from_user_name": "발신자명",
  "type": "project_output_access_request",
  "entry_id": "ENTRY-KEY",
  "entry_summary": "요약",
  "message": "본문 메시지",
  "target_menu": "project-deliverables",
  "channel": "email"
}
```

## 서버 처리 규칙 (권장)
- `type` 화이트리스트 검증
- `to_user_id` 기반으로 DB `users`에서 실제 이메일 조회 (클라이언트 값 신뢰 금지)
- 수신자 이메일 누락 시 `ok=false` + 사유 반환
- 메일 provider(SMTP/SendGrid/Resend 등) 호출
- 중복 발송 방지를 위해 `notification_id` 기준 idempotency 권장

## Response (성공 예시)
```json
{
  "ok": true,
  "provider": "resend",
  "message_id": "xxx",
  "type": "project_output_access_request"
}
```

## Response (실패 예시)
```json
{
  "ok": false,
  "code": "recipient_not_found",
  "message": "수신자 이메일을 찾을 수 없습니다."
}
```

## 주의
- 메일 발송 실패는 인앱 알림 실패로 전파하지 않는다(현재 프론트 로직 유지).
