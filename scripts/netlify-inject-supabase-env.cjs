/**
 * Netlify build-time env injection for static HTML/JS.
 *
 * 목적:
 * - 운영/스테이징 Supabase URL/anon 키를 레포에 커밋하지 않고
 * - Netlify Environment variables로만 주입한다.
 *
 * 사용:
 * - Netlify site settings에서 환경변수 설정:
 *   - SUPABASE_URL
 *   - SUPABASE_ANON_KEY
 *   - (옵션) SMARTLOG_ENV_LABEL  => PROD | STG
 *
 * - netlify.toml build command에서 실행:
 *   node scripts/netlify-inject-supabase-env.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const target = path.join(ROOT, 'js', 'supabase-env.js');

function readEnv(name) {
  const v = process.env[name];
  return (typeof v === 'string' && v.trim()) ? v.trim() : '';
}

const supabaseUrl = readEnv('SUPABASE_URL');
const supabaseKey = readEnv('SUPABASE_ANON_KEY');

// Netlify에서 자동 제공되는 CONTEXT 값: production | deploy-preview | branch-deploy | dev
const netlifyContext = readEnv('CONTEXT');
const label = readEnv('SMARTLOG_ENV_LABEL') || (
  netlifyContext === 'production' ? 'PROD' : 'STG'
);

let src = fs.readFileSync(target, 'utf8');

// 플레이스홀더 치환
src = src.replace(/__SUPABASE_URL__/g, supabaseUrl || '__SUPABASE_URL__');
src = src.replace(/__SUPABASE_ANON_KEY__/g, supabaseKey || '__SUPABASE_ANON_KEY__');
src = src.replace(/__SMARTLOG_ENV_LABEL__/g, label || '__SMARTLOG_ENV_LABEL__');

fs.writeFileSync(target, src, 'utf8');

// 빌드 로그에 남겨서 원인 추적 가능하게(키는 출력 금지)
console.log('[inject] supabase-env.js updated', {
  hasUrl: !!supabaseUrl,
  hasKey: !!supabaseKey,
  label,
  context: netlifyContext || '(none)',
});

