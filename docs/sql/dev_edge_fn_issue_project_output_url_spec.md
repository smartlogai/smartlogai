# Edge Function Spec: `issue_project_output_url`

## 목적
- `view`: 미리보기(preview) 파일 signed URL 발급
- `download`: 원본(original) 파일 signed URL 발급
- 접근권한/승인 상태 검증 후 단기 URL 반환

## Request (JSON)
```json
{
  "output_id": "uuid",
  "request_type": "view",
  "actor_user_id": "U123",
  "actor_user_name": "홍길동",
  "actor_role": "staff",
  "project_code": "PJT-2026-001",
  "output_file_path": "project-outputs/2026/04/PJT-2026-001/....pdf",
  "output_file_name": "결과보고서.pdf",
  "preview_file_path": "project-outputs/preview/2026/04/PJT-2026-001/....pdf",
  "preview_ready": true,
  "user_agent": "Mozilla/5.0 ..."
}
```

## 서버 검증 규칙
- `output_id` 존재 여부 검증
- `request_type`가 `view|download` 인지 검증
- 사용자 권한 검증
  - 관리자/권한자 직접 허용 또는
  - `project_output_access_requests`에서 승인(`approved`) + 만료 전(`expires_at > now`) 확인
- `view` 요청 시:
  - `preview_ready=true` + `preview_file_path` 존재해야 함
  - 없으면 `409` 반환 (`preview_not_ready`)
- `download` 요청 시:
  - `output_file_path` 존재해야 함
- signed URL TTL 권장:
  - `view`: 180초
  - `download`: 120초
- 발급 성공 시 `project_output_access_logs`에 발급 이벤트 기록 권장(옵션)

## Response (성공)
```json
{
  "ok": true,
  "request_type": "view",
  "resource_type": "preview",
  "signed_url": "https://...signed...",
  "expires_in_sec": 180
}
```

## Response (실패 예시)
```json
{
  "ok": false,
  "code": "preview_not_ready",
  "message": "미리보기 파일 생성이 아직 완료되지 않았습니다."
}
```

## 참고
- `generate_output_preview`(별도 비동기 함수/잡)에서
  - 원본 -> 저해상도 PDF/이미지 변환
  - 워터마크(사용자/시각/목적) 반영
  - 결과를 `preview_file_path`, `preview_ready`, `preview_version`에 업데이트
