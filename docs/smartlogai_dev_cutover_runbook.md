# smartlogai-dev -> supersmartlogai 컷오버 런북

목표: 2026-05-01부터 `supersmartlogai`를 운영앱으로 사용한다.

핵심 원칙:
- 구앱(`smartlogai-dev`)은 컷오버 이후 조회용으로만 유지
- 이관은 `staging -> 검증 -> 본반영` 순서만 사용
- 데이터 손실/왜곡 방지를 위해 `legacy_id`를 반드시 보관

---

## 1) 사전 준비 (D-2 ~ D-1)

- [ ] 코드 기준점 고정 (운영 반영 커밋 해시 공유)
- [ ] DB 스키마 반영 확인
  - [ ] `docs/sql/dev_add_project_output_rag_seed_tables.sql`
  - [ ] `docs/sql/dev_add_project_output_rag_chunk_tables.sql`
- [ ] Edge Function 배포 확인
  - [ ] `process_project_output_rag_queue`
  - [ ] `send_notification_email` (사용 시)
- [ ] Secrets 확인 (`OPENAI_API_KEY`, 메일 관련 변수, `ALLOWED_ORIGIN`)
- [ ] 테스트 계정 세트 준비 (admin/director/top_mgr/manager/staff/CCB)

---

## 2) 추출/정제 준비

- [ ] 구앱 데이터 추출 (CSV)
  - [ ] users
  - [ ] registered_projects
  - [ ] project_invoices
  - [ ] time_entries (필요 범위)
  - [ ] project_outputs (필요 범위)
- [ ] 원본 CSV 백업 보관 (`/migration/raw/YYYYMMDD`)
- [ ] 정제 규칙 적용본 생성 (`/migration/clean/YYYYMMDD`)
- [ ] 정제본 샘플 검토 (중복/누락/코드표준화)

---

## 3) 이관 실행 (컷오버 당일)

1. 입력 동결
- [ ] 구앱 입력 중단 공지
- [ ] 기준시각 기록 (예: 2026-05-01 00:00 KST)

2. staging 준비
- [ ] `docs/sql/dev_migration_smartlogai_dev_to_supersmartlogai_template.sql` 실행
- [ ] `migration_stg.*_raw` 테이블 생성 확인

3. CSV 업로드
- [ ] `migration_stg.users_raw` 적재
- [ ] `migration_stg.registered_projects_raw` 적재
- [ ] `migration_stg.project_invoices_raw` 적재
- [ ] `migration_stg.time_entries_raw` 적재
- [ ] `migration_stg.project_outputs_raw` 적재

4. 검증
- [ ] 건수 검증 (원본 대비 ± 허용 범위)
- [ ] 이메일/프로젝트코드 중복 검증
- [ ] 참조무결성 검증 (사용자/프로젝트 미매핑)
- [ ] 금액 검증 (supply + vat = total)

5. 본반영
- [ ] 사용자 upsert
- [ ] 프로젝트 upsert
- [ ] 세금계산서 upsert
- [ ] 결과물 반영
- [ ] RAG seed/queue 생성

6. 기능 검증
- [ ] 로그인/권한
- [ ] 대시보드 접근 제어 (CCB 포함)
- [ ] 프로젝트 목록/진행상태
- [ ] 세금계산서 지표
- [ ] 참고자료 직접등록
- [ ] RAG queue dry_run 및 pending 생성 확인

---

## 4) 컷오버 후 1주 운영

- [ ] 오류 접수 채널 단일화
- [ ] 정정 데이터는 핫픽스 SQL 파일로 누적 관리
- [ ] 일별 검증 리포트
  - [ ] 신규 프로젝트 수
  - [ ] 세금계산서 건수/금액
  - [ ] RAG queue pending/failed 건수
- [ ] 구앱 read-only 유지 (최소 2주)

---

## 5) 롤백 기준

아래 중 1개라도 충족 시 롤백 검토:
- 로그인/권한 오류로 핵심 사용자(관리자/팀장) 업무 중단
- 프로젝트/세금계산서 핵심 화면에서 데이터 누락 다수 발생
- 업로드/승인/발행 플로우가 30분 이상 연속 실패

롤백 방식:
- 코드: 직전 안정 커밋으로 복귀
- 데이터: 컷오버 백업/핫픽스 로그 기준으로 복원

---

## 6) 권장 운영 방식 (요약)

- 이번 전환은 임시 엑셀 업로드 UI 개발보다,
  `DB staging + 검증 SQL` 방식이 더 안정적이고 빠르다.
- 이관 범위는 최소화하고, 구앱 이력은 조회용으로 남긴다.
