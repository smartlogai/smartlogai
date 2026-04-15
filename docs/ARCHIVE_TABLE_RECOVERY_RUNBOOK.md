# Archive Table Recovery Runbook

자문자료실 표 깨짐 이슈로 이미 저장된 데이터를 복구할 때 사용합니다.

## 1) 사전 조건

- 코드 기준: `js/archive.js` 저장 로직이 "표 HTML 원문 저장"으로 반영된 상태
- DB: `mail_references.work_description`, `time_entries.work_description` 컬럼 존재
- 권한: 두 테이블 UPDATE 가능 권한

## 2) 실행 파일

- SQL 파일: `docs/sql/recover_archive_table_html.sql`
- 대상 건 전용 SQL: `docs/sql/recover_archive_table_html_targeted.sql`

## 3) 실행 절차

1. Supabase SQL Editor에서 `recover_archive_table_html.sql`을 연다.
2. **[PREVIEW]** 구간만 먼저 실행해서 `chosen_preview` 샘플을 점검한다.
3. 이상 없으면 **[BACKUP + UPDATE]** 구간을 실행한다.
4. **[VERIFY]** 구간으로 `desc_synced=true` 여부를 확인한다.

## 4) 복구 로직 요약

- `mail_references.entry_id = time_entries.id`로 연결된 쌍만 대상
- `<table>` 포함 HTML을 우선 선택
- 둘 다 `<table>` 포함이면 길이가 더 긴 본문 선택
- 둘 다 `<table>` 미포함이면 길이가 더 긴 본문 선택
- 선택된 본문(`chosen_desc`)으로 양쪽 `work_description` 동기화

## 5) 백업/롤백

업데이트 전에 아래 백업 테이블에 원본이 저장됩니다.

- `public.backup_archive_table_html_20260415`

롤백이 필요하면, 백업값으로 되돌립니다.

```sql
BEGIN;

UPDATE public.mail_references mr
SET
  work_description = b.old_mr_desc,
  updated_at = (EXTRACT(epoch FROM now()) * 1000)::bigint
FROM public.backup_archive_table_html_20260415 b
WHERE mr.id = b.ref_id;

UPDATE public.time_entries te
SET
  work_description = b.old_te_desc,
  updated_at = (EXTRACT(epoch FROM now()) * 1000)::bigint
FROM public.backup_archive_table_html_20260415 b
WHERE te.id = b.entry_id;

COMMIT;
```

## 6) 한계와 추가 안내

- 양쪽 모두 이미 깨진 상태라면 자동 복구로 원문 100% 재생성은 불가합니다.
- 이 경우 백업 원본(이메일 원문, 이전 스냅샷, 수동 보관본) 기반 수동 복원이 필요합니다.
- 운영 반영은 PREVIEW에서 대상 3~5건 샘플 확인 후 진행하세요.

## 8) 제보 건만 제한 복구할 때

전체가 아니라 특정 건만 복구하려면 `docs/sql/recover_archive_table_html_targeted.sql`을 사용하세요.

1. 파일 내 `target_ids`의 `VALUES`에 실제 `ref_id`를 입력
2. PREVIEW 실행으로 선택 결과 확인
3. BACKUP + UPDATE 실행
4. VERIFY 실행

예시:

```sql
WITH target_ids(ref_id) AS (
  VALUES
    ('실제-ref-id-1'::uuid),
    ('실제-ref-id-2'::uuid)
)
SELECT ref_id FROM target_ids;
```

## 7) 운영 PREVIEW 판정 체크리스트 (OK/NG)

PREVIEW 결과에서 아래를 순서대로 확인합니다.

- **OK-1** `chosen_preview`에 표 헤더/셀 텍스트가 정상적으로 보인다.
- **OK-2** `mr_has_table`, `te_has_table` 중 최소 하나가 `true`이고, `chosen_len`이 더 큰 쪽을 선택했다.
- **OK-3** 최근 이슈 건(사용자 제보 건)이 PREVIEW 목록에 포함되고, `chosen_preview`가 사람이 읽어도 자연스럽다.
- **OK-4** 샘플 5건 이상에서 선택 결과가 일관적이다(표가 있는 쪽 우선, 아니면 긴 본문 우선).

- **NG-1** `chosen_preview`가 빈 값이거나 `<p><br></p>` 수준의 무의미한 값이다.
- **NG-2** 표가 있는 행인데 `chosen_desc`가 표 없는 짧은 텍스트로 선택된다.
- **NG-3** 같은 문서군에서 선택 규칙이 들쭉날쭉해 사람이 보기에 잘못된 본문이 선택된다.
- **NG-4** 최근 제보 건 1건이라도 잘못 고르면 즉시 UPDATE 실행 중단 후 수동 대상 분리.

NG가 1개라도 있으면 전체 UPDATE를 바로 실행하지 말고, 아래처럼 제한 실행을 권장합니다.

```sql
-- 예시: 특정 ref_id만 수동 복구
UPDATE public.mail_references
SET work_description = '<정상 HTML>'
WHERE id = '<ref_id>';

UPDATE public.time_entries
SET work_description = '<정상 HTML>'
WHERE id = '<entry_id>';
```

