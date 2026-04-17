-- Supabase Storage 버킷/정책 설정
-- 목적: 프로젝트 등록의 실제 파일 업로드(계약서/계약예외근거/수주경로증빙)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'registered-project-contracts',
    'registered-project-contracts',
    true,
    52428800,
    ARRAY['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/png','image/jpeg']
  ),
  (
    'registered-project-agreements',
    'registered-project-agreements',
    true,
    52428800,
    ARRAY['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/png','image/jpeg','message/rfc822','application/vnd.ms-outlook']
  ),
  (
    'registered-project-route-evidence',
    'registered-project-route-evidence',
    true,
    52428800,
    ARRAY['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/png','image/jpeg','message/rfc822','application/vnd.ms-outlook']
  )
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "public read project register docs" ON storage.objects;
CREATE POLICY "public read project register docs"
ON storage.objects FOR SELECT
USING (bucket_id IN ('registered-project-contracts', 'registered-project-agreements', 'registered-project-route-evidence'));

DROP POLICY IF EXISTS "public insert project register docs" ON storage.objects;
CREATE POLICY "public insert project register docs"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id IN ('registered-project-contracts', 'registered-project-agreements', 'registered-project-route-evidence'));

DROP POLICY IF EXISTS "public update project register docs" ON storage.objects;
CREATE POLICY "public update project register docs"
ON storage.objects FOR UPDATE
USING (bucket_id IN ('registered-project-contracts', 'registered-project-agreements', 'registered-project-route-evidence'))
WITH CHECK (bucket_id IN ('registered-project-contracts', 'registered-project-agreements', 'registered-project-route-evidence'));

DROP POLICY IF EXISTS "public delete project register docs" ON storage.objects;
CREATE POLICY "public delete project register docs"
ON storage.objects FOR DELETE
USING (bucket_id IN ('registered-project-contracts', 'registered-project-agreements', 'registered-project-route-evidence'));
