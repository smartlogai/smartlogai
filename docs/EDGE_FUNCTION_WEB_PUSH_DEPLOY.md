# Web Push 배포 가이드 (앱 미실행 상태 모바일 알림)

목표: 휴대폰에서 앱을 열어두지 않아도 푸시 알림을 받고, 알림 탭으로 앱 진입 가능하게 구성한다.

## 1) DB 준비

아래 SQL 실행:

- `docs/sql/dev_add_push_subscriptions.sql`

## 2) VAPID 키 생성

로컬에서 1회 생성:

```bash
npx web-push generate-vapid-keys
```

출력된 `Public Key`, `Private Key`를 저장한다.

## 3) Supabase Edge Function 배포

```bash
supabase functions deploy send_push_notification
```

## 4) Edge Function 시크릿 설정

```bash
supabase secrets set WEBPUSH_VAPID_PUBLIC_KEY=<PUBLIC_KEY> --project-ref <YOUR_PROJECT_REF>
supabase secrets set WEBPUSH_VAPID_PRIVATE_KEY=<PRIVATE_KEY> --project-ref <YOUR_PROJECT_REF>
supabase secrets set WEBPUSH_SUBJECT=mailto:admin@hjcustoms.co.kr --project-ref <YOUR_PROJECT_REF>
```

기존 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGIN`도 설정되어 있어야 한다.

## 5) 브라우저/휴대폰 확인

1. HTTPS 도메인에서 앱 접속 (PWA 설치 권장)
2. 알림 권한 허용
3. 승인요청 이벤트 생성
4. 앱을 닫은 상태에서 푸시 도착 확인
5. 알림 탭 시 앱이 열리는지 확인

## 참고

- 아이콘 배지 노출 방식은 OS/브라우저 정책에 따라 다를 수 있다.
- Android Chrome PWA는 보통 알림 배너/잠금화면 알림은 지원하며, 앱아이콘 배지는 기기 정책에 영향받는다.
