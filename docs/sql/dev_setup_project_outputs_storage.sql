-- Supabase Storage 버킷/정책 설정 (Project Outputs)
-- 목적: Project Outputs 화면의 파일 업로드/열람 지원
-- 비고:
-- 1) 앱에서 API.storageUpload('project-outputs', ...) 사용
-- 2) 버킷은 public=false (private) 로 유지
-- 3) 열람/다운로드는 Edge Function(service_role)에서 signed URL 발급
-- 4) 세부 역할권한(업로드 가능 사용자)은 JS(Auth)에서 제어

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'project-outputs',
    'project-outputs',
    false,
    52428800,
    ARRAY[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/zip'
    ]
  )
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "public read project outputs docs" ON storage.objects;

DROP POLICY IF EXISTS "public insert project outputs docs" ON storage.objects;
CREATE POLICY "public insert project outputs docs"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'project-outputs');

DROP POLICY IF EXISTS "public update project outputs docs" ON storage.objects;
CREATE POLICY "public update project outputs docs"
ON storage.objects FOR UPDATE
USING (bucket_id = 'project-outputs')
WITH CHECK (bucket_id = 'project-outputs');

DROP POLICY IF EXISTS "public delete project outputs docs" ON storage.objects;
CREATE POLICY "public delete project outputs docs"
ON storage.objects FOR DELETE
USING (bucket_id = 'project-outputs');
