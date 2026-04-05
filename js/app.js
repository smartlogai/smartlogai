/* ============================================
   Smart Log AI — 앱 코어 (세션, API, 유틸, 권한)
   ============================================ */

// ─────────────────────────────────────────────
// 세션 관리
// ─────────────────────────────────────────────
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8시간

const Session = {
  get() {
    try {
      const raw = localStorage.getItem('wt_session') || sessionStorage.getItem('wt_session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      // 세션 만료 체크 (8시간)
      if (s && s.loggedInAt && Date.now() - s.loggedInAt > SESSION_TTL) {
        this.clear();
        return null;
      }
      return s;
    } catch { return null; }
  },
  require() {
    const s = this.get();
    if (!s || !s.id) {
      this.clear();
      window.location.replace('index.html');
      return null;
    }
    return s;
  },
  clear() {
    localStorage.removeItem('wt_session');
    sessionStorage.removeItem('wt_session');
  },
  logout() {
    // 로그아웃 시 보안 로그 기록
    try {
      const s = this.get();
      if (s) {
        const logs = JSON.parse(sessionStorage.getItem('_sec_logs_') || '[]');
        logs.push({ ts: new Date().toISOString(), user: s.name, action: '정상 로그아웃' });
        sessionStorage.setItem('_sec_logs_', JSON.stringify(logs));
      }
    } catch { /* ignore */ }
    if (typeof destroyNotify === 'function') destroyNotify();
    this.clear();
    window.location.replace('index.html');
  },

  // 세션 생성 시 보안 정보 추가 기록
  createSecure(data) {
    const secureData = {
      ...data,
      loggedInAt: Date.now(),
      loggedInUA: navigator.userAgent.slice(0, 120),
      tabId: Math.random().toString(36).slice(2),
    };
    // sessionStorage에 저장 (탭 닫으면 자동 삭제)
    sessionStorage.setItem('wt_session', JSON.stringify(secureData));
    // localStorage에도 저장 (8시간 TTL 적용)
    localStorage.setItem('wt_session', JSON.stringify(secureData));
    return secureData;
  },
};

// ─────────────────────────────────────────────
// 권한 체계
// ─────────────────────────────────────────────
/*
  ─── 역할별 권한 정의 ───────────────────────────────────────

  staff (승인자 지정됨):
    - 타임시트 작성 (New Entry)
    - 나의 타임시트 조회 (My Time Sheet)
    - 자문 자료실 이용

  staff (승인자 미지정):
    - 자문 자료실만 접근 가능
    - 타임시트 작성/조회 불가

  manager:
    - 본인이 승인자로 지정된 타임시트 승인/반려
    - 소속 사업부/본부/고객지원팀 단위 데이터 열람
    - 분석(Analysis) — 소속 단위 범위 내
    - 자문 자료실 이용

  director:
    - 소속 사업부/본부/고객지원팀 단위 데이터 열람 (읽기 전용)
    - 대시보드, Approval 열람, 분석 — 소속 단위 범위 내
    - 자문 자료실 이용

  admin:
    - 시스템 전체 관리 (등록/수정/삭제/승인/설정 모두 가능)
    - 전체 데이터 열람 (필터 없음)
*/
const ROLE_LABEL = {
  admin:    'Admin',       // 테이블 배지용 짧은 표기
  director: 'Director',   // 본부장 — 2차 최종 승인
  manager:  'Manager',    // 고객지원팀장 — 1차 승인
  staff:    'Staff',      // 담당자 — 타임시트 작성
};
// 사이드바·상세화면 등 전체 이름이 필요한 경우 사용
const ROLE_LABEL_FULL = {
  admin:    'Administrator',
  director: '본부장 (Director)',
  manager:  '팀장 (Manager)',
  staff:    'Staff',
};
const ROLE_COLOR = {
  admin:    'badge-purple',
  director: 'badge-orange',
  manager:  'badge-blue',
  staff:    'badge-green',
};

const Auth = {
  isAdmin:    (s) => s && s.role === 'admin',
  isDirector: (s) => s && s.role === 'director',
  isManager:  (s) => s && s.role === 'manager',
  isStaff:    (s) => s && s.role === 'staff',

  // ★ 승인자 지정 여부 (staff에만 의미 있음, manager 이상은 true 반환)
  hasApprover: (s) => {
    if (!s) return false;
    if (s.role === 'staff') return !!(s.approver_id);
    return true; // manager/director/admin은 항상 true
  },

  // 타임시트 작성: 승인자 지정된 staff OR 타임시트 대상자인 manager
  canWriteEntry: (s) => {
    if (!s) return false;
    if (s.role === 'staff') return !!(s.approver_id);
    if (s.role === 'manager') return s.is_timesheet_target !== false;
    return false;
  },

  // ── 승인 권한 분리 ──────────────────────────────────────
  // 1차 승인: manager (수행방식 확인 + 형식 검증)
  canApprove1st: (s) => s && s.role === 'manager',
  // 2차 최종 승인: director (품질평가 + 전문성 + DB저장)
  canApprove2nd: (s) => s && s.role === 'director',
  // 하위 호환: 기존 canApprove = 1차 승인 권한과 동일
  canApprove: (s) => s && s.role === 'manager',

  // 전체 열람 (필터 없음): admin만
  canViewAll: (s) => s && s.role === 'admin',

  // 소속 단위 열람: manager + director + admin
  canViewDeptScope: (s) => s && (s.role === 'manager' || s.role === 'director' || s.role === 'admin'),

  // 마스터 관리 (조직구성·직원): admin만
  canManageMaster: (s) => s && s.role === 'admin',

  // 기준정보 관리 (고객사·업무분류): admin + director + manager
  canManageRefData: (s) => s && (s.role === 'admin' || s.role === 'director' || s.role === 'manager'),

  // 분석 열람: manager + director + admin
  canViewAnalysis: (s) => s && (s.role === 'director' || s.role === 'admin' || s.role === 'manager'),

  // 자문 자료실: 모든 역할
  canViewArchive: (s) => !!s,

  // ★ 소속 범위 필터 — 레코드(entry 또는 user)가 세션 소속 범위에 포함되는지
  // admin: 항상 true / director·manager: 사업부 OR 본부 OR 고객지원팀 일치
  scopeMatch(s, rec) {
    if (!s || !rec) return false;
    if (Auth.canViewAll(s)) return true;
    if (s.dept_id    && rec.dept_id    === s.dept_id)    return true;
    if (s.hq_id      && rec.hq_id      === s.hq_id)      return true;
    if (s.cs_team_id && rec.cs_team_id === s.cs_team_id) return true;
    return false;
  },

  // 타임엔트리 조회 범위 (API 필터용)
  entryFilter(s) {
    if (Auth.canViewAll(s)) return {};    // admin: 전체
    if (s.role === 'manager')  return {}; // manager: 전체 가져와서 JS 필터
    if (s.role === 'director') return {}; // director: 전체 가져와서 JS 필터
    return { user: s.id };               // staff: 본인만
  },
};

// ─────────────────────────────────────────────
// Supabase 설정
// ─────────────────────────────────────────────
const SUPABASE_URL = 'https://dvjagzcqdgolspyngtxj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2amFnemNxZGdvbHNweW5ndHhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNjU5MjYsImV4cCI6MjA5MDg0MTkyNn0.J3G3zHvIlCgpYaST9PCAJtd9n8OoXMZZmP5i920cfUg';

// ─────────────────────────────────────────────
// API 헬퍼 (Supabase 호환 레이어)
// Genspark Table API → Supabase REST API 변환
// 기존 코드 수정 없이 동일하게 동작
// ─────────────────────────────────────────────
const API = {

  // 공통 헤더
  _headers() {
    return {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    };
  },

  // 기본 fetch
  async _fetch(url, opts = {}) {
    const res = await fetch(url, {
      headers: this._headers(),
      ...opts,
    });
    if (res.status === 204 || res.status === 205) return null;
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'API Error' }));
      throw new Error(err.message || err.error || `HTTP ${res.status}`);
    }
    return res.json().catch(() => null);
  },

  // 목록 조회 (GET) — Genspark: { data:[], total:N } 형식으로 변환
  async list(table, params = {}) {
    const limit  = params.limit  || 200;
    const page   = params.page   || 1;
    const offset = (page - 1) * limit;
    const search = params.search || '';

    let url = `${SUPABASE_URL}/rest/v1/${table}?limit=${limit}&offset=${offset}`;

    // 검색어 처리 (간단 텍스트 검색)
    if (search) {
      url += `&or=(name.ilike.*${search}*,email.ilike.*${search}*)`;
    }

    // 정렬 처리
    if (params.sort) {
      url += `&order=${params.sort}.desc`;
    } else {
      url += `&order=created_at.desc`;
    }

    // deleted=true 항목 제외 (soft delete 잔존 데이터 + hard delete 전환기 모두 대응)
    url += `&or=(deleted.is.null,deleted.is.false)`;

    // 전체 개수 포함 요청
    const res = await fetch(url, {
      headers: {
        ...this._headers(),
        'Prefer': 'count=exact',
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'API Error' }));
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const data  = await res.json();
    const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0');

    // Genspark 응답 형식으로 변환
    return {
      data:  Array.isArray(data) ? data : [],
      total: total,
      page:  page,
      limit: limit,
    };
  },

  // 단건 조회 (GET)
  async get(table, id) {
    const url  = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&limit=1`;
    const data = await this._fetch(url);
    if (Array.isArray(data) && data.length > 0) return data[0];
    return null;
  },

  // 생성 (POST)
  async create(table, data) {
    // created_at, updated_at 자동 설정
    const now     = Date.now();
    const payload = {
      ...data,
      created_at: data.created_at || now,
      updated_at: data.updated_at || now,
    };
    const url    = `${SUPABASE_URL}/rest/v1/${table}`;
    const result = await this._fetch(url, {
      method: 'POST',
      body:   JSON.stringify(payload),
    });
    // 배열로 반환되면 첫 번째 항목
    if (Array.isArray(result)) return result[0];
    return result;
  },

  // 전체 수정 (PUT → PATCH로 처리)
  async update(table, id, data) {
    const payload = { ...data, updated_at: Date.now() };
    const url     = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
    const result  = await this._fetch(url, {
      method: 'PATCH',
      body:   JSON.stringify(payload),
    });
    if (Array.isArray(result)) return result[0];
    return result;
  },

  // 부분 수정 (PATCH)
  async patch(table, id, data) {
    const payload = { ...data, updated_at: Date.now() };
    const url     = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
    const result  = await this._fetch(url, {
      method: 'PATCH',
      body:   JSON.stringify(payload),
    });
    if (Array.isArray(result)) return result[0];
    return result;
  },

  // 삭제: Hard Delete 시도 → 실패 시 Soft Delete (deleted=true) 로 폴백
  async delete(table, id) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
    // 1차: Hard Delete 시도
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=minimal',
        },
      });
      if (res.status === 204 || res.status === 200 || res.ok) {
        console.log(`[API.delete] Hard Delete 성공: ${table}/${id}`);
        return null;
      }
      // Hard Delete 실패 시 에러 메시지 읽기
      const errBody = await res.text().catch(() => '');
      let errMsg = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(errBody);
        errMsg = parsed.message || parsed.hint || parsed.error || errMsg;
      } catch (_) {}
      console.warn(`[API.delete] Hard Delete 실패 (${res.status}): ${errMsg} → Soft Delete 시도`);
    } catch (netErr) {
      console.warn(`[API.delete] Hard Delete 네트워크 오류 → Soft Delete 시도: ${netErr.message}`);
    }
    // 2차 폴백: Soft Delete (deleted=true, updated_at 갱신)
    const patchRes = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ deleted: true, updated_at: Date.now() }),
    });
    if (patchRes.ok || patchRes.status === 204) {
      console.log(`[API.delete] Soft Delete 성공: ${table}/${id}`);
      return null;
    }
    const patchBody = await patchRes.text().catch(() => '');
    let patchErr = `HTTP ${patchRes.status}`;
    try {
      const p2 = JSON.parse(patchBody);
      patchErr = p2.message || p2.hint || p2.error || patchErr;
    } catch (_) {}
    console.error(`[API.delete] Soft Delete도 실패 (${patchRes.status}): ${patchErr}`);
    throw new Error(patchErr);
  },
};

// ─────────────────────────────────────────────
// 토스트 알림
// ─────────────────────────────────────────────
const Toast = {
  container: null,
  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  show(msg, type = 'info', duration = 3500) {
    this.init();
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <i class="fas ${icons[type] || icons.info} toast-icon"></i>
      <span class="toast-msg">${msg}</span>
      <button class="toast-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
    `;
    this.container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  },
  success: (m, d) => Toast.show(m, 'success', d),
  error:   (m, d) => Toast.show(m, 'error', d),
  warning: (m, d) => Toast.show(m, 'warning', d),
  info:    (m, d) => Toast.show(m, 'info', d),
};

// ─────────────────────────────────────────────
// 확인 다이얼로그
// ─────────────────────────────────────────────
const Confirm = {
  show({ title, desc, confirmText = '확인', confirmClass = 'btn-primary', icon = '❓' }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay show';
      overlay.dataset.dynamic = 'true'; // 동적 생성 confirm 표시
      overlay.innerHTML = `
        <div class="confirm-dialog">
          <div class="confirm-icon">${icon}</div>
          <div class="confirm-title">${title}</div>
          <div class="confirm-desc">${desc}</div>
          <div class="confirm-actions">
            <button class="btn btn-ghost" id="confirmCancel">취소</button>
            <button class="btn ${confirmClass}" id="confirmOk">${confirmText}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const dismiss = (result) => { overlay.remove(); resolve(result); };
      overlay.querySelector('#confirmCancel').onclick = () => dismiss(false);
      overlay.querySelector('#confirmOk').onclick    = () => dismiss(true);
      // 배경 클릭 시 취소
      overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(false); });
    });
  },
  delete: (name) => Confirm.show({ title: '삭제 확인', desc: `"${name}"을(를) 삭제하시겠습니까?<br>이 작업은 되돌릴 수 없습니다.`, confirmText: '삭제', confirmClass: 'btn-danger', icon: '🗑️' }),
};

// ─────────────────────────────────────────────
// XLSX 다운로드 공통 헬퍼 (writeFile 브라우저 호환 문제 대응)
// ─────────────────────────────────────────────
async function xlsxDownload(wb, fileName) {
  // ★ XLSX 지연 로드: 아직 로드 안 됐으면 먼저 로드
  if (typeof XLSX === 'undefined') {
    try {
      await LibLoader.load('xlsx');
    } catch(e) {
      Toast.error('엑셀 라이브러리 로드 실패. 잠시 후 다시 시도해주세요.');
      return;
    }
  }
  try {
    // type:'array' → Uint8Array 방식 (브라우저 호환성 최고)
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob  = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.style.display = 'none';
    a.href      = url;
    a.download  = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 2000);
  } catch(e) {
    console.error('xlsxDownload error:', e);
    Toast.error('엑셀 다운로드 실패: ' + (e.message || String(e)));
  }
}

// ─────────────────────────────────────────────
// 유틸리티
// ─────────────────────────────────────────────
const Utils = {
  // 날짜 포맷
  formatDate(dt, type = 'date') {
    if (!dt) return '-';
    const d = new Date(isNaN(dt) ? dt : Number(dt));
    if (isNaN(d)) return '-';
    const yy   = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    const hh   = String(d.getHours()).padStart(2, '0');
    const min  = String(d.getMinutes()).padStart(2, '0');
    if (type === 'date')     return `${yy}.${mm}.${dd}`;
    if (type === 'datetime') return `${yy}.${mm}.${dd} ${hh}:${min}`;
    if (type === 'time')     return `${hh}:${min}`;
    return `${yy}.${mm}.${dd}`;
  },

  // 분 → 단축 표시 (테이블용) — 모두 H:MM 형식으로 통일
  // 예: 240분→4:00, 210분→3:30, 45분→0:45, 185분→3:05
  formatDuration(minutes) {
    if (!minutes || minutes <= 0) return '-';
    const mins = Number(minutes);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}:${String(m).padStart(2,'0')}`;
  },

  // 모달·상세 등 긴 포맷이 필요한 곳에 사용
  formatDurationLong(minutes) {
    if (!minutes || minutes <= 0) return '-';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}분`;
    if (m === 0) return `${h}시간`;
    return `${h}시간 ${m}분`;
  },

  // datetime-local 입력값에서 분 계산
  calcDurationMinutes(start, end) {
    if (!start || !end) return 0;
    const s = new Date(start), e = new Date(end);
    if (isNaN(s) || isNaN(e) || e <= s) return 0;
    return Math.round((e - s) / 60000);
  },

  // 상태 배지 HTML
  // 정상(승인)은 조용한 텍스트, 진행중·이상 상태는 색상 강조
  statusBadge(status) {
    if (status === 'approved') {
      return `<span style="font-size:11.5px;color:var(--text-muted);font-weight:500">최종승인</span>`;
    }
    const map = {
      draft:        { label: '임시저장',    cls: 'badge-gray'   },
      submitted:    { label: '1차검토중',   cls: 'badge-yellow' },
      pre_approved: { label: '2차검토중',   cls: 'badge-blue'   },
      rejected:     { label: '반려',        cls: 'badge-red'    },
      active:       { label: '진행중',      cls: 'badge-blue'   },
      hold:         { label: '보류',        cls: 'badge-yellow' },
    };
    const info = map[status] || { label: status, cls: 'badge-gray' };
    return `<span class="badge ${info.cls} status-badge">${info.label}</span>`;
  },

  // 파일 타입 배지
  fileBadge(type, name) {
    const map = {
      excel: { label: 'Excel', cls: 'file-excel', icon: 'fa-file-excel' },
      word:  { label: 'Word',  cls: 'file-word',  icon: 'fa-file-word' },
      ppt:   { label: 'PPT',   cls: 'file-ppt',   icon: 'fa-file-powerpoint' },
      pdf:   { label: 'PDF',   cls: 'file-pdf',   icon: 'fa-file-pdf' },
    };
    const t = map[type] || { label: type, cls: '', icon: 'fa-file' };
    return `<span class="badge ${t.cls} file-badge"><i class="fas ${t.icon}"></i> ${name || t.label}</span>`;
  },

  // 확장자 → 타입
  getFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['xlsx','xls'].includes(ext)) return 'excel';
    if (['docx','doc'].includes(ext)) return 'word';
    if (['pptx','ppt'].includes(ext)) return 'ppt';
    if (ext === 'pdf') return 'pdf';
    return null;
  },

  // 허용 확장자 체크
  isAllowedFile(filename) {
    return !!this.getFileType(filename);
  },

  // 파일 크기 포맷
  formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes/1024).toFixed(1)}KB`;
    return `${(bytes/1024/1024).toFixed(1)}MB`;
  },

  // 역할 배지
  roleBadge(role) {
    return `<span class="badge ${ROLE_COLOR[role] || 'badge-gray'}">${ROLE_LABEL[role] || role}</span>`;
  },

  // 비밀번호 해시
  async hashPassword(pw) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(pw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  },

  // 엑셀 파싱 (SheetJS) — ★ XLSX 지연 로드 지원
  async parseExcel(file) {
    // XLSX가 아직 없으면 로드
    if (typeof XLSX === 'undefined') {
      await LibLoader.load('xlsx');
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          resolve(data);
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  },

  // 페이지네이션 HTML (callbackFn: 페이지 클릭 시 호출할 함수명, 기본 'changePage')
  paginationHTML(current, total, callbackFnOrPerPage, perPageOrUndefined) {
    // 하위 호환: (current, total, perPage) 형식도 지원
    let totalPages, callbackFn;
    if (typeof callbackFnOrPerPage === 'string') {
      callbackFn = callbackFnOrPerPage;
      totalPages = Math.ceil(total / (perPageOrUndefined || 20));
    } else {
      callbackFn = 'changePage';
      totalPages = Math.ceil(total / (callbackFnOrPerPage || 20));
    }
    if (totalPages <= 1) return '';
    let html = '<div class="pagination">';
    html += `<button class="page-btn" onclick="${callbackFn}(${current-1})" ${current===1?'disabled':''}><i class="fas fa-chevron-left"></i></button>`;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= current-2 && i <= current+2)) {
        html += `<button class="page-btn ${i===current?'active':''}" onclick="${callbackFn}(${i})">${i}</button>`;
      } else if (i === current-3 || i === current+3) {
        html += `<span style="color:var(--text-muted);font-size:12px">···</span>`;
      }
    }
    html += `<button class="page-btn" onclick="${callbackFn}(${current+1})" ${current===totalPages?'disabled':''}><i class="fas fa-chevron-right"></i></button>`;
    html += '</div>';
    return html;
  },

  debounce(fn, ms = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },

  // HTML 이스케이프
  escHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  },

  // 오늘 날짜 문자열 (YYYY-MM-DD)
  todayStr() {
    const d = new Date();
    return d.toISOString().substring(0,10);
  },
};

// ─────────────────────────────────────────────
// 전역 캐시 (★ TTL 연장: 30초 → 3분, 마스터 데이터는 5분)
// ─────────────────────────────────────────────
const Cache = {
  _store: {},
  // ★ 진행 중인 fetch 요청 추적 (중복 요청 방지: Request Deduplication)
  _pending: {},
  async get(key, fetcher, ttl = 180000) {  // 기본 TTL: 3분
    const now = Date.now();
    if (this._store[key] && now - this._store[key].at < ttl) {
      return this._store[key].data;
    }
    // ★ 동일 키에 대한 중복 요청이 진행 중이면 같은 Promise 반환 (waterfall 방지)
    if (this._pending[key]) return this._pending[key];
    this._pending[key] = (async () => {
      try {
        const data = await fetcher();
        this._store[key] = { data, at: Date.now() };
        return data;
      } finally {
        delete this._pending[key];
      }
    })();
    return this._pending[key];
  },
  invalidate(key) { delete this._store[key]; delete this._pending[key]; },
  invalidateAll() { this._store = {}; this._pending = {}; },
};

// ─────────────────────────────────────────────
// 마스터 데이터 로더
// ─────────────────────────────────────────────
// ★ 마스터 데이터 TTL 상수 (5분) — 자주 바뀌지 않는 데이터
const MASTER_TTL = 300000;

const Master = {
  async teams() {
    return Cache.get('teams', async () => {
      const r = await API.list('teams', { limit: 500 });
      return (r && r.data) ? r.data : [];
    }, MASTER_TTL);
  },
  async clients() {
    return Cache.get('clients', async () => {
      const r = await API.list('clients', { limit: 500 });
      return (r && r.data) ? r.data : [];
    }, MASTER_TTL);
  },
  async categories() {
    return Cache.get('categories', async () => {
      const r = await API.list('work_categories', { limit: 200 });
      return (r && r.data) ? r.data.sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)) : [];
    }, MASTER_TTL);
  },
  async subcategories() {
    return Cache.get('subcategories', async () => {
      const r = await API.list('work_subcategories', { limit: 500 });
      return (r && r.data) ? r.data.sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)) : [];
    }, MASTER_TTL);
  },
  async cases() {
    return Cache.get('cases', async () => {
      const r = await API.list('cases', { limit: 500 });
      return (r && r.data) ? r.data : [];
    }, MASTER_TTL);
  },
  async users() {
    return Cache.get('users', async () => {
      const r = await API.list('users', { limit: 500 });
      return (r && r.data) ? r.data : [];
    }, MASTER_TTL);
  },
  invalidate(key) { Cache.invalidate(key); },
  invalidateAll() { Cache.invalidateAll(); },
};

// ─────────────────────────────────────────────
// 선택 드롭다운 채우기
// ─────────────────────────────────────────────
async function fillSelect(elId, items, valueKey, labelKey, placeholder = '선택하세요', selectedVal = '') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `<option value="">${placeholder}</option>`;
  (items || []).forEach(item => {
    const opt = document.createElement('option');
    opt.value = item[valueKey];
    opt.textContent = item[labelKey];
    if (selectedVal && String(item[valueKey]) === String(selectedVal)) opt.selected = true;
    el.appendChild(opt);
  });
}

// ─────────────────────────────────────────────
// ★ 고객사 검색형 선택 컴포넌트 (ClientSearchSelect)
// ─────────────────────────────────────────────
/*
  사용법:
    ClientSearchSelect.init('wrapperId', clients, {
      placeholder : '고객사 검색/선택',  // 검색창 placeholder
      onSelect    : (id, name) => { ... } // 선택 시 콜백
    });
    ClientSearchSelect.setValue('wrapperId', id, name); // 프로그래밍 방식으로 값 설정
    ClientSearchSelect.getValue('wrapperId');             // { id, name } 반환
    ClientSearchSelect.clear('wrapperId');               // 초기화
  
  HTML에서 <div id="wrapperId" class="cs-wrap"></div> 로 정의한 위치에 렌더링됨.
*/
const ClientSearchSelect = (() => {
  const _state = {}; // wrapperId → { clients, selected, onSelect }

  function _render(wid) {
    const wrap = document.getElementById(wid);
    if (!wrap) return;
    const s   = _state[wid];
    const val = s.selected;

    wrap.innerHTML = `
      <div class="cs-root" style="position:relative">
        ${val.id
          ? `<div class="cs-selected-box form-control"
                style="display:flex;align-items:center;justify-content:space-between;
                       cursor:pointer;padding:6px 10px;min-height:38px;user-select:none"
                onclick="ClientSearchSelect._openSearch('${wid}')">
              <span style="font-size:13px;font-weight:500">${Utils.escHtml(val.name)}</span>
              <span style="display:flex;gap:6px;align-items:center">
                <i class="fas fa-exchange-alt" style="color:var(--text-muted);font-size:11px" title="변경"></i>
                <i class="fas fa-times" style="color:var(--text-muted);font-size:12px"
                   onclick="event.stopPropagation();ClientSearchSelect.clear('${wid}')" title="초기화"></i>
              </span>
            </div>`
          : `<div class="cs-search-box" style="position:relative">
              <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);
                 color:var(--text-muted);font-size:12px;pointer-events:none"></i>
              <input type="text" class="form-control cs-input-${wid}" id="cs-input-${wid}"
                     style="padding-left:30px;font-size:13px"
                     placeholder="${s.placeholder || '고객사 검색/선택'}"
                     oninput="ClientSearchSelect._onInput('${wid}', this.value)"
                     onkeydown="ClientSearchSelect._onKey(event,'${wid}')"
                     onfocus="ClientSearchSelect._showDropdown('${wid}', this.value)"
                     autocomplete="off" />
              <div id="cs-dropdown-${wid}" class="cs-dropdown"
                   style="display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;
                          background:#fff;border:1px solid var(--border-light);border-radius:8px;
                          box-shadow:0 4px 20px rgba(0,0,0,0.12);z-index:3000;
                          max-height:220px;overflow-y:auto"></div>
            </div>`
        }
      </div>`;
  }

  function _showDropdown(wid, query) {
    const s   = _state[wid];
    if (!s) return;
    const ddEl = document.getElementById(`cs-dropdown-${wid}`);
    if (!ddEl) return;
    const q = (query || '').trim().toLowerCase();
    const filtered = q
      ? s.clients.filter(c => (c.company_name || c.name || '').toLowerCase().includes(q))
      : s.clients;

    if (filtered.length === 0) {
      ddEl.innerHTML = `<div style="padding:10px 14px;color:var(--text-muted);font-size:13px">검색 결과 없음</div>`;
    } else {
      ddEl.innerHTML = filtered.slice(0, 50).map(c => {
        const lbl = c.company_name || c.name || '';
        const hi  = q ? lbl.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'),
                         '<mark style="background:#fef9c3;border-radius:2px;padding:0 1px">$1</mark>') : lbl;
        return `<div class="cs-item" data-id="${c.id}" data-name="${Utils.escHtml(lbl)}"
                     style="padding:9px 14px;cursor:pointer;font-size:13px;
                            border-bottom:1px solid #f1f5f9;transition:background .1s"
                     onmouseover="this.style.background='#f0f7ff'"
                     onmouseout="this.style.background=''"
                     onclick="ClientSearchSelect._pick('${wid}','${c.id}','${lbl.replace(/'/g,"\\'")}')">
                  ${hi}
                </div>`;
      }).join('');
    }
    ddEl.style.display = '';
    // 드롭다운 외부 클릭 시 닫기 (한 번만 등록)
    if (!s._outsideHandler) {
      s._outsideHandler = (e) => {
        const root = document.getElementById(`cs-dropdown-${wid}`);
        const inp  = document.getElementById(`cs-input-${wid}`);
        if (root && !root.contains(e.target) && e.target !== inp) {
          root.style.display = 'none';
        }
      };
      document.addEventListener('click', s._outsideHandler, true);
    }
  }

  function _onInput(wid, val) {
    _showDropdown(wid, val);
  }

  function _onKey(e, wid) {
    const ddEl = document.getElementById(`cs-dropdown-${wid}`);
    if (!ddEl || ddEl.style.display === 'none') return;
    const items = ddEl.querySelectorAll('.cs-item');
    let cur = Array.from(items).findIndex(i => i.classList.contains('cs-focused'));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cur >= 0) items[cur].classList.remove('cs-focused');
      cur = (cur + 1) % items.length;
      items[cur].classList.add('cs-focused');
      items[cur].style.background = '#f0f7ff';
      items[cur].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cur >= 0) items[cur].classList.remove('cs-focused');
      cur = (cur - 1 + items.length) % items.length;
      items[cur].classList.add('cs-focused');
      items[cur].style.background = '#f0f7ff';
      items[cur].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cur >= 0) {
        const item = items[cur];
        _pick(wid, item.dataset.id, item.dataset.name);
      }
    } else if (e.key === 'Escape') {
      ddEl.style.display = 'none';
    }
  }

  function _openSearch(wid) {
    const s = _state[wid];
    if (!s) return;
    s.selected = { id: '', name: '' };
    _render(wid);
    setTimeout(() => {
      const inp = document.getElementById(`cs-input-${wid}`);
      if (inp) { inp.focus(); _showDropdown(wid, ''); }
    }, 50);
  }

  function _pick(wid, id, name) {
    const s = _state[wid];
    if (!s) return;
    s.selected = { id, name };
    // 외부 클릭 핸들러 해제
    if (s._outsideHandler) {
      document.removeEventListener('click', s._outsideHandler, true);
      s._outsideHandler = null;
    }
    _render(wid);
    if (typeof s.onSelect === 'function') s.onSelect(id, name);
  }

  return {
    init(wid, clients, opts = {}) {
      if (_state[wid] && _state[wid]._outsideHandler) {
        document.removeEventListener('click', _state[wid]._outsideHandler, true);
      }
      _state[wid] = {
        clients : clients || [],
        selected: { id: '', name: '' },
        placeholder: opts.placeholder || '고객사 검색/선택',
        onSelect: opts.onSelect || null,
        _outsideHandler: null,
      };
      _render(wid);
    },
    setValue(wid, id, name) {
      if (!_state[wid]) return;
      _state[wid].selected = { id: id || '', name: name || '' };
      _render(wid);
    },
    getValue(wid) {
      return _state[wid] ? { ..._state[wid].selected } : { id: '', name: '' };
    },
    clear(wid) {
      if (!_state[wid]) return;
      if (_state[wid]._outsideHandler) {
        document.removeEventListener('click', _state[wid]._outsideHandler, true);
        _state[wid]._outsideHandler = null;
      }
      _state[wid].selected = { id: '', name: '' };
      _render(wid);
      if (typeof _state[wid].onSelect === 'function') _state[wid].onSelect('', '');
    },
    // 내부용 (onclick에서 호출)
    _openSearch,
    _onInput,
    _onKey,
    _showDropdown,
    _pick,
  };
})();

// ─────────────────────────────────────────────
// 사이드바 내비게이션
// ─────────────────────────────────────────────
function navigateTo(page) {
  // 모든 섹션 숨김
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  // 해당 섹션 표시
  const section = document.getElementById(`page-${page}`);
  if (section) section.classList.add('active');
  // 네비 활성 업데이트
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });
  // 모바일 사이드바 닫기
  document.querySelector('.sidebar')?.classList.remove('open');

  // 페이지별 초기화 (main.js의 PAGE_INIT_MAP에서 처리)
}

function toggleSidebar() {
  document.querySelector('.sidebar')?.classList.toggle('open');
}

// ─────────────────────────────────────────────
// 권한별 메뉴 표시/숨김
// ─────────────────────────────────────────────
/*
  메뉴 노출 기준:
  ┌───────────────┬───────┬─────────┬──────────┬───────┐
  │ 메뉴          │ Staff │ Manager │ Director │ Admin │
  ├───────────────┼───────┼─────────┼──────────┼───────┤
  │ Dashboard     │   ✅   │    ✅   │    ✅    │   ✅   │
  │ New Entry     │   ✅   │    ❌   │    ❌    │   ❌   │
  │ My Time Sheet │   ✅   │    ❌   │    ❌    │   ❌   │
  │ Approval      │   ❌   │    ✅   │    ✅    │   ✅   │
  │ Analysis      │   ❌   │    ✅   │    ✅    │   ✅   │
  │ Settings      │   ❌   │    ❌   │    ❌    │   ✅   │
  └───────────────┴───────┴─────────┴──────────┴───────┘
  
  팀 소속 기준:
  - Manager가 승인자(approver_id)로 지정된 Staff들이 해당 Manager의 팀원
  - Staff 등록 시 승인자로 지정된 Manager의 팀이 곧 해당 Staff의 소속팀
*/
function setupMenuByRole(session) {
  const role        = session ? session.role : '';
  const hasApprover = Auth.hasApprover(session);      // staff에서 승인자 지정 여부
  const isStaffWithApprover  = Auth.isStaff(session) && hasApprover;
  const isStaffNoApprover    = Auth.isStaff(session) && !hasApprover;
  const canApprove           = Auth.canApprove(session);        // manager
  const canViewDeptScope     = Auth.canViewDeptScope(session);  // manager+director+admin
  const canViewAll           = Auth.canViewAll(session);        // admin only
  const canAnalysis          = Auth.canViewAnalysis(session);   // manager+director+admin
  const isMaster             = Auth.canManageMaster(session);   // admin only

  // ── Time Sheet 섹션 ────────────────────────────────────────
  // 승인자 있는 staff OR 타임시트 대상자 manager
  const isManagerTimesheetTarget = Auth.isManager(session) && session.is_timesheet_target !== false;
  const showTS = isStaffWithApprover || isManagerTimesheetTarget;
  const tsSection   = document.getElementById('menu-timesheet-section');
  const entryMenu   = document.getElementById('menu-entry-new');
  const myEntryMenu = document.getElementById('menu-my-entries');
  if (tsSection)    tsSection.style.display   = showTS ? '' : 'none';
  if (entryMenu)    entryMenu.style.display    = showTS ? '' : 'none';
  if (myEntryMenu)  myEntryMenu.style.display  = showTS ? '' : 'none';

  // ── Management 섹션 타이틀 ─────────────────────────────────
  const mgmtSection = document.getElementById('menu-management-section');
  const showMgmt = canApprove || canViewDeptScope;
  if (mgmtSection) mgmtSection.style.display = showMgmt ? '' : 'none';

  // ── Approval: manager(승인/반려) + director/admin(열람) ────
  const approvalMenu = document.getElementById('menu-approval');
  if (approvalMenu) approvalMenu.style.display = (canApprove || canViewDeptScope) ? '' : 'none';

  // ── Analysis: manager + director + admin ──────────────────
  const analysisMenu = document.getElementById('menu-analysis');
  if (analysisMenu) analysisMenu.style.display = canAnalysis ? '' : 'none';

  // ── 자문 자료실: 모든 역할 접근 허용 ─────────────────────
  const archiveMenu = document.getElementById('menu-archive');
  if (archiveMenu) archiveMenu.style.display = '';

  // ── Settings: admin만 (조직구성·직원관리) ────────────────────
  const masterMenus = document.querySelectorAll('.menu-master');
  masterMenus.forEach(m => m.style.display = isMaster ? '' : 'none');

  // ── 기준정보 (고객사·업무분류): admin + director + manager ─────
  const canRefData  = Auth.canManageRefData(session);
  const refDataMenus = document.querySelectorAll('.menu-ref-data');
  refDataMenus.forEach(m => m.style.display = canRefData ? '' : 'none');

  // ── Settings 섹션 타이틀: admin 또는 기준정보 권한 있을 때 ───
  const settingsSection = document.querySelector('.menu-settings-section');
  if (settingsSection) settingsSection.style.display = (isMaster || canRefData) ? '' : 'none';

  // ── 승인자 없는 staff 안내 배너 표시 ──────────────────────
  _showNoApproverBanner(isStaffNoApprover);
}

// 승인자 미지정 staff에게 안내 배너 표시
function _showNoApproverBanner(show) {
  let banner = document.getElementById('no-approver-banner');
  if (!show) {
    if (banner) banner.style.display = 'none';
    return;
  }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'no-approver-banner';
    banner.style.cssText = `
      position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
      background:#1e3a5f; color:#fff; border-radius:10px;
      padding:12px 20px; font-size:13px; z-index:9999;
      display:flex; align-items:center; gap:10px;
      box-shadow:0 4px 20px rgba(0,0,0,0.25); max-width:420px;
    `;
    banner.innerHTML = `
      <i class="fas fa-info-circle" style="font-size:16px;color:#60a5fa;flex-shrink:0"></i>
      <span>승인자가 지정되지 않아 <strong>자문 자료실</strong>만 이용 가능합니다.<br>
      <span style="font-size:11.5px;opacity:0.8">관리자에게 승인자 지정을 요청하세요.</span></span>
    `;
    document.body.appendChild(banner);
  }
  banner.style.display = 'flex';
}

// ─────────────────────────────────────────────
// 사용자 아바타 이니셜
// ─────────────────────────────────────────────
function getInitial(name) {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

// ─────────────────────────────────────────────
// 승인 배지 카운트 업데이트
// manager: submitted 건수 (1차 대기)
// director: pre_approved 건수 + manager 본인 건 submitted 건수 (2차 대기)
// ★ 캐시 활용 + 쓰로틀(30초 이내 재호출 방지)
// ─────────────────────────────────────────────
let _badgeLastUpdated = 0;
async function updateApprovalBadge(session, force = false) {
  // manager 또는 director만 배지 표시
  if (!Auth.canApprove1st(session) && !Auth.canApprove2nd(session)) return;
  // ★ 30초 이내 재호출 방지 (force=true 시 무시)
  const now = Date.now();
  if (!force && now - _badgeLastUpdated < 30000) return;
  _badgeLastUpdated = now;
  try {
    const r = await Cache.get('time_entries_badge_' + session.id, async () => {
      return API.list('time_entries', { limit: 500 });
    }, 120000);
    if (r && r.data) {
      let count = 0;
      if (Auth.canApprove1st(session)) {
        // manager: 본인이 approver_id인 submitted 건 (1차 대기)
        count = r.data.filter(e =>
          e.status === 'submitted' && String(e.approver_id) === String(session.id)
        ).length;
      } else if (Auth.canApprove2nd(session)) {
        // director: pre_approved 건 중 본인 소속 범위 + manager 본인 건 submitted
        const allUsers = await Master.users();
        const scopeIds = new Set(allUsers.filter(u => Auth.scopeMatch(session, u)).map(u => String(u.id)));
        // 2차 대기: pre_approved 상태인 소속 범위 직원 건
        const preApproved = r.data.filter(e =>
          e.status === 'pre_approved' && scopeIds.has(String(e.user_id))
        ).length;
        // manager 본인 건: submitted 상태이고 approver_id가 director 본인인 건
        const managerDirect = r.data.filter(e =>
          e.status === 'submitted' && String(e.approver_id) === String(session.id)
        ).length;
        count = preApproved + managerDirect;
      }
      const badge = document.getElementById('approval-badge');
      if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? '' : 'none';
      }
    }
  } catch {}
}

// ─────────────────────────────────────────────
// ★ BtnLoading — 버튼 로딩 상태 공통 유틸
// ─────────────────────────────────────────────
/*
  사용법:
    const restore = BtnLoading.start(btn, '처리 중...');
    try { await doWork(); } finally { restore(); }

  또는 id로:
    const restore = BtnLoading.startById('submitBtn', '저장 중...');
*/
const BtnLoading = {
  /**
   * 버튼을 로딩 상태로 전환하고 복원 함수를 반환
   * @param {HTMLElement|null} btn
   * @param {string} loadingText  스피너 옆에 표시할 텍스트
   * @returns {Function} restore — 호출하면 원래 상태로 복원
   */
  start(btn, loadingText = '처리 중...') {
    if (!btn) return () => {};
    const originalHTML     = btn.innerHTML;
    const originalDisabled = btn.disabled;
    const originalOpacity  = btn.style.opacity;
    const originalCursor   = btn.style.cursor;

    btn.disabled    = true;
    btn.style.opacity  = '0.75';
    btn.style.cursor   = 'not-allowed';
    btn.innerHTML = `<i class="fas fa-spinner fa-spin" style="margin-right:5px"></i>${loadingText}`;

    return function restore() {
      btn.innerHTML    = originalHTML;
      btn.disabled     = originalDisabled;
      btn.style.opacity   = originalOpacity;
      btn.style.cursor    = originalCursor;
    };
  },

  startById(id, loadingText = '처리 중...') {
    return BtnLoading.start(document.getElementById(id), loadingText);
  },

  /** 여러 버튼을 동시에 비활성화 (로딩 표시 없이 클릭만 차단) */
  disableAll(...btns) {
    btns.forEach(b => { if (b) { b.disabled = true; b.style.opacity = '0.6'; b.style.cursor = 'not-allowed'; } });  
    return () => btns.forEach(b => { if (b) { b.disabled = false; b.style.opacity = ''; b.style.cursor = ''; } });
  },
};

// ─────────────────────────────────────────────
// ★ 1회성 마이그레이션: 하두식/박주경/안만복 role → admin
//   admin 계정으로 로그인 후 브라우저 콘솔에서:
//   migrateDirectorsToAdmin() 실행
// ─────────────────────────────────────────────
async function migrateDirectorsToAdmin() {
  const TARGET_NAMES = ['하두식', '박주경', '안만복'];
  const session = getSession();
  if (!session || session.role !== 'admin') {
    console.warn('[Migration] admin 계정으로 로그인 후 실행하세요.');
    return;
  }
  try {
    const r = await API.list('users', { limit: 500 });
    const users = (r && r.data) ? r.data : [];
    const targets = users.filter(u => TARGET_NAMES.includes(u.name) && u.role === 'director');
    if (targets.length === 0) {
      console.log('[Migration] 변경 대상 없음 (이미 완료됐거나 이름 불일치)');
      return;
    }
    for (const u of targets) {
      await API.patch('users', u.id, { role: 'admin' });
      console.log(`[Migration] ✅ ${u.name} (${u.email}) → role: admin`);
    }
    Master.invalidate('users');
    console.log(`[Migration] 완료: ${targets.length}명 처리`);
    Toast.success(`마이그레이션 완료: ${targets.map(u=>u.name).join(', ')} → admin`);
  } catch (e) {
    console.error('[Migration] 실패:', e);
  }
}
