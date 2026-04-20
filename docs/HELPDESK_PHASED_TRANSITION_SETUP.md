# Help Desk 단계적 전환 세팅 가이드

목적: 당분간 내부 유지보수로 운영하고, 시스템 안정화 이후 외주 유지보수로 안전하게 전환하기 위한 기준입니다.

## 1) 운영 단계 정의

- `internal` (기본): 내부 인력만 접수/처리
- `hybrid`: 내부 + 외주 병행 처리 (이관 준비 단계)
- `vendor`: 외주 주도 처리, 내부는 승인/감사

현재 권장 기본값은 `internal`입니다.

## 2) 앱 설정 키

`js/app.js`에서 아래 전역 설정을 읽습니다.

- `smartlog_helpdesk_phase`
  - 값: `internal` | `hybrid` | `vendor`
  - 기본값: `internal`
- `smartlog_helpdesk_external_portal`
  - 값: `1`/`true`(활성), 그 외 비활성
  - 기본값: 비활성
- `smartlog_helpdesk_external_portal_url`
  - 외주 포털 URL
  - 기본값: 빈 문자열

로컬 테스트 예시:

```javascript
localStorage.setItem('smartlog_helpdesk_phase', 'hybrid');
localStorage.setItem('smartlog_helpdesk_external_portal', '1');
localStorage.setItem('smartlog_helpdesk_external_portal_url', 'https://vendor-helpdesk.example.com');
location.reload();
```

## 3) 역할 운영 기준

- 일반 사용자: 티켓 등록, 본인 티켓 조회
- 내부 관리자(운영/품질): 전체 조회, 우선순위/상태 조정, 외주 배정 승인
- 외주 담당자(향후): 배정 티켓 처리, 처리내역 코멘트, 상태 업데이트

## 4) 단계별 전환 권장 절차

### Phase A. 내부 운영 (`internal`)

1. 티켓 분류 체계 확정(오류/개선/문의)
2. 상태 표준 확정(접수/분석중/개발중/검수요청/완료/종결)
3. 주간 리포트(처리시간, 재오픈율) 운영

### Phase B. 병행 운영 (`hybrid`)

1. 외주 계정에 제한 권한 부여(배정 건만 조회/처리)
2. SLA 파일럿 적용
3. 외주 포털 연동(읽기 → 쓰기 순 단계 적용)

### Phase C. 외주 주도 (`vendor`)

1. 운영 배정 규칙 자동화(유형/심각도 기반)
2. 내부 승인 게이트 유지(릴리즈 전 승인)
3. 월간 KPI 기반 계약 정산

## 5) 보안/감사 체크리스트

- 외주 계정 최소권한 적용
- PII(개인정보) 마스킹
- 상태 변경 이력(누가/언제/무엇) 보존
- 첨부파일 접근제어(서명 URL/만료시간)
- 외부 API 토큰 주기적 교체

## 6) 계약서(SOW) 필수 조항 권장

- SLA(응답/조치/복구) 수치
- 장애 등급 정의(P1~P4)
- 긴급 대응 창구/시간
- 소스/데이터 소유권(고객사 귀속)
- 종료 시 인수인계 산출물 명시

