# send_notification_email 배포 가이드

이 문서는 `notify.js`에서 호출하는 `send_notification_email` Edge Function을 실제 배포하는 절차입니다.

## 1) 사전 확인

- 함수 코드 위치:
  - `supabase/functions/send_notification_email/index.ts`
- 앱 호출 위치:
  - `js/notify.js`
  - 선택된 알림 타입(`5,9,10,12,13,14`)에서만 호출

## 2) Supabase 로그인/프로젝트 연결

```bash
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
```

`<YOUR_PROJECT_REF>`는 Supabase 프로젝트 URL의 ref 값입니다.

## 3) 시크릿(환경변수) 설정 (Mailplug SMTP)

아래 값은 Edge Function 런타임에서만 사용됩니다.

```bash
supabase secrets set MAIL_HOST=smtp.mailplug.co.kr --project-ref <YOUR_PROJECT_REF>
supabase secrets set MAIL_PORT=465 --project-ref <YOUR_PROJECT_REF>
supabase secrets set MAIL_SSL_ENABLE=true --project-ref <YOUR_PROJECT_REF>
supabase secrets set MAIL_AUTH=true --project-ref <YOUR_PROJECT_REF>
supabase secrets set MAIL_PROTOCOL=smtp --project-ref <YOUR_PROJECT_REF>
supabase secrets set MAIL_ID=<SMTP_ACCOUNT_ID> --project-ref <YOUR_PROJECT_REF>
supabase secrets set MAIL_PW=<SMTP_PASSWORD> --project-ref <YOUR_PROJECT_REF>
supabase secrets set SEND_NAME="관세법인 한주" --project-ref <YOUR_PROJECT_REF>
supabase secrets set SEND_EMAIL=<FROM_EMAIL> --project-ref <YOUR_PROJECT_REF>
supabase secrets set EMAIL_ENABLED=true --project-ref <YOUR_PROJECT_REF>
```

선택:

```bash
supabase secrets set ALLOWED_ORIGIN=https://smartlogai.netlify.app --project-ref <YOUR_PROJECT_REF>
```

## 4) 함수 배포

```bash
supabase functions deploy send_notification_email --project-ref <YOUR_PROJECT_REF>
```

## 5) 로컬 테스트(선택)

```bash
supabase functions serve send_notification_email
```

테스트 호출 예시:

```bash
curl -i -X POST "http://127.0.0.1:54321/functions/v1/send_notification_email" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -d '{
    "notification_id":"test-001",
    "to_user_id":"<USER_ID>",
    "to_user_name":"테스터",
    "from_user_id":"system",
    "from_user_name":"시스템",
    "type":"helpdesk_new_ticket",
    "entry_id":"HD-1001",
    "entry_summary":"테스트 티켓",
    "message":"테스트 메일 발송",
    "target_menu":"helpdesk",
    "channel":"email"
  }'
```

## 6) 운영 검증 체크리스트

- `users` 테이블에 수신자 `email`이 존재하는지 확인
- 앱에서 선택 타입 알림 생성 시 Edge Function 호출 로그 확인
- SMTP 서버 로그/수신 메일함에서 발송 성공/실패 확인
- 메일 실패 시에도 인앱 알림(`notifications`)이 정상 생성되는지 확인

## 7) 오류 대응

- `mail_env_missing`: SMTP 환경변수(`MAIL_*`, `SEND_EMAIL`) 누락
- `recipient_not_found`: `users.email` 값 없음
- `type_not_allowed`: 허용되지 않은 알림 타입
- `provider_send_failed`: SMTP 인증/보안설정/포트 차단 확인

