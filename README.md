# Smart Log AI

업무시간 기록·결재·자문 자료실을 하나의 SPA에서 다루는 내부 업무용 웹 앱입니다.

- **배포**: [Netlify](https://smartlogai.netlify.app)
- **DB / API**: [Supabase](https://supabase.com/) (PostgreSQL, REST)
- **스택**: 순수 HTML / CSS / JavaScript (프레임워크·빌드 없음)
- **운영 규칙**: [`docs/OPERATING_RULES.md`](docs/OPERATING_RULES.md)

## 주요 파일

| 파일 | 설명 |
|------|------|
| `index.html` | 로그인, 최초 관리자 설정, 비밀번호 만료 처리 |
| `main.html` | 로그인 후 SPA 셸(사이드바 + 각 페이지 섹션) |
| `js/app.js` | 세션, 권한, Supabase API 래퍼, 공통 UI·캐시 |
| `js/main.js` | 라우팅(`navigateTo` 확장), 초기화, lazy 스크립트 |
| `js/dashboard.js` | 대시보드 |
| `js/entry.js` | 타임시트 입력·조회 |
| `js/approval.js` | 결재 |
| `js/analysis.js` | 분석 |
| `js/archive.js` | 자문 자료실 |
| `js/master.js` | 조직·기준정보(설정 메뉴 진입 시 지연 로드) |
| `js/users.js` | 직원 관리(지연 로드) |
| `js/notify.js` | 알림 센터 |
| `js/security.js` | 클라이언트 보안·무활동 로그아웃 등 |
| `js/llm-proxy.js` | Supabase Edge `llm-proxy` 호출(LLM, API 키는 서버 전용) |
| `supabase/functions/llm-proxy/` | OpenAI 프록시 Edge Function |
| `css/style.css` | 전역 스타일 |

## 로컬 실행

정적 파일이므로 아무 HTTP 서버로 **저장소 루트**를 열면 됩니다. (파일을 `file://`로 직접 열면 일부 브라우저에서 스크립트/세션이 막힐 수 있으니 HTTP로 여세요.)

**한 줄로 실행 (Node/npm 있을 때)**

```bash
npm start
```

→ `http://127.0.0.1:8080/index.html` 로 접속합니다.

**PowerShell (Python 우선, 없으면 npx serve)**

```powershell
.\tools\serve-local.ps1
```

**수동 예**

```bash
# 예: Python
python -m http.server 8080

# 예: npx
npx --yes serve . -l 8080
```

브라우저에서 `http://127.0.0.1:8080/index.html` (또는 표시된 포트)로 접속합니다.  
**승인 목록·대분류 컬럼 확인**: 로그인 후 왼쪽 메뉴 **Approval** → 필터 조회.

**데이터 연동**: 로컬(`localhost`)에서는 [`js/supabase.dev.js`](js/supabase.dev.js)에 개발용 Supabase URL·anon 키가 있어야 API가 동작합니다. 없으면 [`js/supabase.dev.example.js`](js/supabase.dev.example.js)를 복사해 만듭니다. (자세한 내용은 아래 “로컬 개발” 절 참고)

## 개발용 체크(권장)

### JS 문법 체크 (화면 깨짐/탭 클릭 불가 사전 방지)

아래 스크립트는 `js/` 폴더의 모든 `.js` 파일을 Node로 파싱하여 **문법 오류가 있으면 파일/라인을 출력**합니다.

- PowerShell:

```powershell
.\tools\check-js-syntax.ps1
```

- Node 직접 실행:

```bash
node tools/check-js-syntax.js
```

## 환경 변수·비밀 정보

### 로컬 개발 (운영 DB와 분리 — A안)

- `127.0.0.1` / `localhost`에서는 **`js/supabase.dev.js`**에만 개발용 Supabase **URL·anon 키**를 둡니다.  
- 예시: `js/supabase.dev.example.js` → 복사 → `js/supabase.dev.js` 후 값 수정. (`supabase.dev.js`는 `.gitignore`됨)  
- **통합 전 사전 준비 색인:** [`docs/PRE_DEV_INDEX.md`](docs/PRE_DEV_INDEX.md)  
- 상세: [`docs/SUPABASE_DEV_SETUP.md`](docs/SUPABASE_DEV_SETUP.md) · 주의: [`docs/LOCAL_DEV_CAUTIONS.md`](docs/LOCAL_DEV_CAUTIONS.md)

### 배포(Netlify 등)

- 비로컬 호스트에서는 `js/supabase-env.js`에 정의된 **운영** 프로젝트 URL/anon 키가 사용됩니다.

**저장소에 공개하기 전** anon 키 노출을 줄이려면 빌드·주입 방식을 검토하세요. 점검 항목은 `CODE_REVIEW_CHECKLIST.md`를 참고하세요.

## LLM 연동 (Supabase Edge Function)

OpenAI 등 API 키는 브라우저에 두지 않고, **`supabase/functions/llm-proxy`** Edge Function에서만 사용합니다.

### 구성 요약

| 구분 | 설명 |
|------|------|
| 함수 이름 | `llm-proxy` |
| 인증 | `verify_jwt = false` — 함수 안에서 **Service Role**로 `users` 테이블을 조회해 `userId` + `email`이 일치·활성 계정인지 검증 (앱의 `wt_session`과 동일한 식별자) |
| 클라이언트 | `js/llm-proxy.js`의 `llmChat({ messages, ... })` — `app.js` 로드 후 `SmartLogSupabase` 사용 |

### 배포 (Supabase CLI)

1. [Supabase CLI](https://supabase.com/docs/guides/cli) 설치 후 프로젝트 연결  
2. **시크릿 등록** (대시보드 **Project Settings → Edge Functions → Secrets** 또는 CLI):

   ```bash
   supabase secrets set OPENAI_API_KEY=sk-...
   ```

   운영에서 특정 출처만 허용하려면:

   ```bash
   supabase secrets set ALLOWED_ORIGIN=https://smartlogai.netlify.app
   ```

3. 함수 배포:

   ```bash
   supabase functions deploy llm-proxy
   ```

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 Edge 런타임에 자동 주입합니다.

### 로컬에서 함수만 테스트

```bash
supabase secrets set OPENAI_API_KEY=sk-... --project-ref <ref>
supabase functions serve llm-proxy
```

### 프론트에서 호출 예시

```javascript
const out = await llmChat({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: '안녕하세요.' },
  ],
  model: 'gpt-4o-mini', // 생략 시 서버 기본값
});
console.log(out.content);
```

**보안 참고**: `userId`/`email` 위조에 대비해 DB에서 매번 검증하지만, **세션을 탈취당한 경우**와 동일한 위험은 남습니다. 가능하면 장기적으로 Supabase Auth JWT + `verify_jwt` 사용을 검토하세요.

## 라이선스·저작권

프로젝트 소유 정책에 따릅니다.
