/* ============================================
   main.js — 앱 초기화, 공통 함수
   ============================================ */

let _session = null;

// ─────────────────────────────────────────────
// 비밀번호 만료 정책 상수
// ─────────────────────────────────────────────
const PW_EXPIRY_DAYS = 90;
const PW_EXPIRY_MS   = PW_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

window.addEventListener('DOMContentLoaded', async () => {
  // ★ 전역 오류 캡처 설치 (콘솔 없이도 원인 확인)
  try {
    if (typeof GlobalErrorCapture !== 'undefined' && GlobalErrorCapture.install) {
      GlobalErrorCapture.install();
    }
  } catch { /* ignore */ }

  // 세션 확인 — 없으면 로그인 화면으로 강제 이동
  _session = Session.require();
  if (!_session) {
    window.location.replace('index.html');
    return;
  }

  // ── ★ 세션 최신화: DB에서 사용자 정보를 읽어 세션 갱신 ──────
  // (is_timesheet_target, reviewer2_id 등 신규 필드가 구버전 세션에 없을 수 있음)
  let freshUser = null;  // try 블록 밖에서 선언 (checkPwExpiry 재사용)
  try {
    freshUser = await API.get('users', _session.id);
    if (freshUser && freshUser.id) {
      const updatedSession = {
        ..._session,
        // 소속 정보 갱신
        dept_id:      freshUser.dept_id      || _session.dept_id      || '',
        dept_name:    freshUser.dept_name    || _session.dept_name    || '',
        hq_id:        freshUser.hq_id        || _session.hq_id        || '',
        hq_name:      freshUser.hq_name      || _session.hq_name      || '',
        cs_team_id:   freshUser.cs_team_id   || _session.cs_team_id   || '',
        cs_team_name: freshUser.cs_team_name || _session.cs_team_name || '',
        // 승인자 정보 갱신
        approver_id:   freshUser.approver_id   || _session.approver_id   || '',
        approver_name: freshUser.approver_name || _session.approver_name || '',
        // 2차 승인자 갱신 (신규 필드)
        reviewer2_id:   freshUser.reviewer2_id   || _session.reviewer2_id   || '',
        reviewer2_name: freshUser.reviewer2_name || _session.reviewer2_name || '',
        // 타임시트 대상자 여부 갱신 (신규 필드) — null/undefined 는 false로 처리
        is_timesheet_target: freshUser.is_timesheet_target === true,
        // 역할도 최신 값 사용 — DB 값이 반드시 우선 (null·빈값이면 기존 세션 유지)
        role:      (freshUser.role && freshUser.role.trim()) ? freshUser.role : _session.role,
        is_active: freshUser.is_active !== undefined ? freshUser.is_active : _session.is_active,
      };
      // 갱신된 세션 저장
      const stored = localStorage.getItem('wt_session')
        ? 'localStorage' : 'sessionStorage';
      if (stored === 'localStorage') {
        localStorage.setItem('wt_session', JSON.stringify(updatedSession));
      } else {
        sessionStorage.setItem('wt_session', JSON.stringify(updatedSession));
      }
      _session = updatedSession;
    }
  } catch (e) {
    console.warn('[Session] 세션 갱신 실패 (무시):', e.message);
  }

  // ── body 표시 (세션 확인 완료 → visibility 복원) ──────────
  document.body.style.visibility = 'visible';

  if (window.__SMARTLOG_DEV_CONFIG_MISSING__) {
    var _devBar = document.createElement('div');
    _devBar.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#b45309;color:#fff;padding:8px 14px;font-size:12px;text-align:center;z-index:100000';
    _devBar.innerHTML = '<strong>로컬 개발</strong> — <code>js/supabase.dev.js</code>에 개발용 Supabase URL·anon 키를 넣으세요. <a href="docs/PRE_DEV_INDEX.md" style="color:#ffedd5">사전 준비 색인</a>';
    document.body.appendChild(_devBar);
  }

  // ── 3개월 비밀번호 만료 체크: 위에서 이미 가져온 freshUser 재사용 (API 중복 호출 제거) ─────────
  await checkPwExpiry(_session, freshUser ?? null);

  // 사이드바 사용자 정보 표시
  document.getElementById('sidebarAvatar').textContent = getInitial(_session.name);
  document.getElementById('sidebarName').textContent = _session.name;

  // 역할 라벨 표시 (팀명 있으면 함께 표시)
  const roleLabel = ROLE_LABEL_FULL[_session.role] || _session.role;
  document.getElementById('sidebarRole').textContent =
    _session.team_name ? `${_session.team_name} · ${roleLabel}` : roleLabel;

  // 권한별 메뉴 표시
  setupMenuByRole(_session);

  // 승인 뱃지 업데이트
  updateApprovalBadge(_session);

  // 알림 센터 초기화 (30초 폴링 시작)
  if (typeof initNotify === 'function') initNotify();

  // ── 역할별 초기 진입 페이지 결정 ──────────────────────────
  // 승인자 미지정 staff → 자문 자료실로 바로 이동
  if (Auth.isStaff(_session) && !Auth.hasApprover(_session)) {
    navigateTo('archive');
  } else {
    await init_dashboard();
  }
});

// ─────────────────────────────────────────────
// 비밀번호 만료 체크 (DB에서 pw_changed_at 확인)
// ─────────────────────────────────────────────
async function checkPwExpiry(session, cachedUser = null) {
  try {
    // 미리 가져온 사용자 데이터가 있으면 추가 API 호출 생략 (중복 제거)
    let user = cachedUser;
    if (!user) {
      // Supabase REST API로 사용자 정보 조회
      user = await API.get('users', session.id);
      if (!user) return;
    }

    const now         = Date.now();
    const lastChanged = user.pw_changed_at
      ? Number(user.pw_changed_at)
      : (user.created_at ? Number(user.created_at) : 0);

    const elapsed     = now - lastChanged;
    const elapsedDays = Math.floor(elapsed / (24 * 60 * 60 * 1000));

    // lastChanged === 0: pw_changed_at 미설정 계정은 만료 처리하지 않음
    if (lastChanged > 0 && elapsed > PW_EXPIRY_MS) {
      // 만료 → 강제 변경 모달 표시 (로그아웃 버튼만 있고 닫기 없음)
      const dispDays = elapsedDays;
      const dayEl = document.getElementById('mainPwDaysElapsed');
      if (dayEl) dayEl.textContent = dispDays + '일';

      // 전역에 현재 사용자 정보 저장 (변경 처리 시 사용)
      window._pwExpiredUser = user;

      const modal = document.getElementById('mainPwChangeModal');
      if (modal) modal.style.display = 'flex';
    }
  } catch (err) {
    // 네트워크 오류 등 — 차단하지 않고 진행
    console.warn('[PwExpiry] 비밀번호 만료 체크 실패:', err.message);
  }
}

// ─────────────────────────────────────────────
// 비밀번호 강도 표시 (main.html용)
// ─────────────────────────────────────────────
function updatePwStrength(pw, barId, textId) {
  const bar  = document.getElementById(barId);
  const text = document.getElementById(textId);
  if (!bar || !text) return;
  let score = 0;
  if (pw.length >= 8)           score++;
  if (pw.length >= 12)          score++;
  if (/[A-Z]/.test(pw))        score++;
  if (/[0-9]/.test(pw))        score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const levels = [
    { pct: '0%',   color: '#eef1f5', label: '' },
    { pct: '25%',  color: '#fc8181', label: '매우 약함' },
    { pct: '50%',  color: '#f6ad55', label: '약함' },
    { pct: '70%',  color: '#68d391', label: '보통' },
    { pct: '85%',  color: '#48bb78', label: '강함' },
    { pct: '100%', color: '#2f855a', label: '매우 강함' },
  ];
  const lv = levels[Math.min(score, 5)];
  bar.style.width      = lv.pct;
  bar.style.background = lv.color;
  text.textContent     = lv.label;
  text.style.color     = lv.color;
}

function updateMainPwStrength(pw) {
  updatePwStrength(pw, 'mainPwStrengthBar', 'mainPwStrengthText');
}

function updateSelfPwStrength(pw) {
  updatePwStrength(pw, 'selfPwStrengthBar', 'selfPwStrengthText');
}

function resetPwStrength(barId, textId) {
  const bar = document.getElementById(barId);
  const text = document.getElementById(textId);
  if (bar) {
    bar.style.width = '0%';
    bar.style.background = '#eef1f5';
  }
  if (text) {
    text.textContent = '';
    text.style.color = '#8a95a3';
  }
}

function clearPwChangeError(errorWrapId, errorTextId) {
  const errWrap = document.getElementById(errorWrapId);
  const errText = document.getElementById(errorTextId);
  if (!errWrap || !errText) return;
  errText.textContent = '';
  errWrap.style.display = 'none';
}

function setPwChangeError(errorWrapId, errorTextId, message) {
  const errWrap = document.getElementById(errorWrapId);
  const errText = document.getElementById(errorTextId);
  if (!errWrap || !errText) return;
  errText.textContent = message;
  errWrap.style.display = 'flex';
}

async function hashPasswordSafe(pw) {
  if (typeof Utils !== 'undefined' && Utils.hashPassword) {
    return Utils.hashPassword(pw);
  }
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function validateAndBuildPwChangePayload(user, oldPw, newPw, newPwConfirm) {
  if (!oldPw || !newPw || !newPwConfirm) {
    throw new Error('모든 항목을 입력해주세요.');
  }
  if (newPw.length < 8) {
    throw new Error('새 비밀번호는 8자 이상이어야 합니다.');
  }
  if (newPw !== newPwConfirm) {
    throw new Error('새 비밀번호가 일치하지 않습니다.');
  }
  if (!user || !user.password) {
    throw new Error('현재 계정 비밀번호 정보가 없습니다. 관리자에게 문의하세요.');
  }

  const oldHash = await hashPasswordSafe(oldPw);
  if (user.password !== oldHash) {
    throw new Error('현재 비밀번호가 올바르지 않습니다.');
  }

  const newHash = await hashPasswordSafe(newPw);
  if (newHash === user.password) {
    throw new Error('이전 비밀번호와 동일한 비밀번호는 사용할 수 없습니다.');
  }

  return { password: newHash, pw_changed_at: Date.now() };
}

function setPwChangeLoading(buttonId, loading, loadingText) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.disabled = !!loading;
  if (loading) {
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${loadingText}`;
  } else {
    btn.innerHTML = '<i class="fas fa-check"></i> 비밀번호 변경';
  }
}

// ─────────────────────────────────────────────
// 비밀번호 변경 처리 (main.html 모달)
// ─────────────────────────────────────────────
async function handleMainPwChange(e) {
  e.preventDefault();

  clearPwChangeError('mainPwChangeError', 'mainPwChangeErrorText');

  const user = window._pwExpiredUser;
  if (!user) {
    setPwChangeError('mainPwChangeError', 'mainPwChangeErrorText', '세션 오류. 페이지를 새로고침하세요.');
    return;
  }

  const oldPw        = document.getElementById('mainPwOld').value;
  const newPw        = document.getElementById('mainPwNew').value;
  const newPwConfirm = document.getElementById('mainPwNewConfirm').value;

  setPwChangeLoading('mainPwChangeBtn', true, '변경 중...');

  try {
    const payload = await validateAndBuildPwChangePayload(user, oldPw, newPw, newPwConfirm);
    await API.patch('users', user.id, payload);

    // 성공 → 모달 닫기 + 세션 유지
    document.getElementById('mainPwChangeModal').style.display = 'none';
    const form = document.getElementById('mainPwChangeForm');
    if (form) form.reset();
    resetPwStrength('mainPwStrengthBar', 'mainPwStrengthText');
    window._pwExpiredUser = null;
    // 토스트 알림
    if (typeof Toast !== 'undefined') {
      Toast.success('비밀번호가 성공적으로 변경되었습니다.');
    } else {
      alert('비밀번호가 성공적으로 변경되었습니다.');
    }
  } catch (err) {
    const msg = err?.message || '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
    setPwChangeError('mainPwChangeError', 'mainPwChangeErrorText', msg);
  } finally {
    setPwChangeLoading('mainPwChangeBtn', false, '변경 중...');
  }
}

function openSelfPwChangeModal() {
  if (window._pwExpiredUser) {
    if (typeof Toast !== 'undefined') {
      Toast.error('비밀번호 만료 상태입니다. 강제 변경 창에서 먼저 변경해주세요.');
    }
    return;
  }
  const form = document.getElementById('selfPwChangeForm');
  if (form) form.reset();
  clearPwChangeError('selfPwChangeError', 'selfPwChangeErrorText');
  resetPwStrength('selfPwStrengthBar', 'selfPwStrengthText');
  const modal = document.getElementById('selfPwChangeModal');
  if (modal) modal.classList.add('show');
}

function closeSelfPwChangeModal() {
  const modal = document.getElementById('selfPwChangeModal');
  if (modal) modal.classList.remove('show');
}

async function handleSelfPwChange(e) {
  e.preventDefault();
  clearPwChangeError('selfPwChangeError', 'selfPwChangeErrorText');

  const session = getSession();
  if (!session?.id) {
    setPwChangeError('selfPwChangeError', 'selfPwChangeErrorText', '세션 오류. 다시 로그인해주세요.');
    return;
  }

  const oldPw        = document.getElementById('selfPwOld').value;
  const newPw        = document.getElementById('selfPwNew').value;
  const newPwConfirm = document.getElementById('selfPwNewConfirm').value;

  setPwChangeLoading('selfPwChangeBtn', true, '변경 중...');
  try {
    const user = await API.get('users', session.id);
    const payload = await validateAndBuildPwChangePayload(user, oldPw, newPw, newPwConfirm);
    await API.patch('users', user.id, payload);
    closeSelfPwChangeModal();
    if (typeof Toast !== 'undefined') {
      Toast.success('비밀번호가 성공적으로 변경되었습니다.');
    }
  } catch (err) {
    const msg = err?.message || '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
    setPwChangeError('selfPwChangeError', 'selfPwChangeErrorText', msg);
  } finally {
    setPwChangeLoading('selfPwChangeBtn', false, '변경 중...');
  }
}

// ─────────────────────────────────────────────
// 로그아웃 (전역 공통)
// ─────────────────────────────────────────────
function doLogout() {
  Session.logout();
}

// ─────────────────────────────────────────────
// 모달 공통
// ─────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id)?.classList.add('show');
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('show');
  // 승인 모달은 close 시 상태/버튼 핸들러 리셋 필요
  if (id === 'approvalModal') {
    try { window.resetApprovalModalState?.(); } catch {}
  }
}

// ESC 키로 모달 닫기
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.show').forEach(m => {
      // 동적 confirm 다이얼로그는 DOM에서 완전히 제거 (투명 overlay 잔존 방지)
      if (m.dataset.dynamic === 'true') {
        m.remove();
      } else {
        closeModal(m.id);
      }
    });
  }
});

// 오버레이 클릭으로 모달 닫기
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  // 스크롤바 드래그/드래그 종료가 오버레이 click으로 오인되는 케이스 방지:
  // "pointerdown이 오버레이에서 시작"한 진짜 바깥 클릭만 닫기 처리한다.
  let _downOnOverlay = false;
  let _downX = 0;
  let _downY = 0;
  overlay.addEventListener('pointerdown', (e) => {
    _downOnOverlay = (e.target === overlay);
    _downX = e.clientX || 0;
    _downY = e.clientY || 0;
  });
  overlay.addEventListener('pointercancel', () => {
    _downOnOverlay = false;
  });
  overlay.addEventListener('click', (e) => {
    // 드래그(스크롤바 이동 등)로 pointer가 움직였으면 닫지 않음
    const dx = Math.abs((e.clientX || 0) - _downX);
    const dy = Math.abs((e.clientY || 0) - _downY);
    const moved = (dx + dy) > 6;
    if (_downOnOverlay && !moved && e.target === overlay) closeModal(overlay.id);
    _downOnOverlay = false;
  });
});

// ─────────────────────────────────────────────
// 페이지 타이틀 업데이트
// ─────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard: 'Dashboard',
  'entry-new': 'New Entry',
  'my-entries': 'My Time Sheet',
  approval: 'Approval',
  analysis: 'Analysis',
  archive: '자문 자료실',
  'master-teams': 'Teams',
  'master-clients': 'Clients',
  'master-categories': 'Categories',
  'master-org': '사업부·본부 관리',
  'master-departments': '사업부 관리',
  'master-csteams': '고객지원팀 관리',
  users: 'Staff 관리',
};

// page init 함수 매핑
const PAGE_INIT_MAP = {
  'dashboard': 'init_dashboard',
  'entry-new': 'init_entry_new',
  'my-entries': 'init_my_entries',
  'approval': 'init_approval',
  'analysis': 'init_analysis',
  'archive': 'init_archive',
  'master-teams': 'init_master_teams',
  'master-clients': 'init_master_clients',
  'master-categories': 'init_master_categories',
  'master-org': 'init_master_org',
  'master-departments': 'init_master_departments',
  'master-csteams': 'init_master_csteams',
  'users': 'init_users',
};

// ─────────────────────────────────────────────
// ★ Lazy 로드: master.js / users.js
// Settings 메뉴(master-*, users) 진입 시에만 동적 로드 (초기 81KB 절감)
// ─────────────────────────────────────────────
const _LAZY_SCRIPTS = {
  'master-teams'      : 'js/master.js?v=20260405b',
  'master-clients'    : 'js/master.js?v=20260405b',
  'master-categories' : 'js/master.js?v=20260405b',
  'master-org'        : 'js/master.js?v=20260405b',
  'master-departments': 'js/master.js?v=20260405b',
  'master-csteams'    : 'js/master.js?v=20260405b',
  'users'             : 'js/users.js?v=20260405b',
};
const _lazyLoaded = {};  // 이미 로드된 파일 추적

function _lazyLoadScript(src) {
  if (_lazyLoaded[src]) return _lazyLoaded[src];
  _lazyLoaded[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error('LazyLoad 실패: ' + src));
    document.body.appendChild(s);
  });
  return _lazyLoaded[src];
}

// navigateTo 래핑 — 타이틀 + init 함수 호출 + lazy load
// ★ 성능 개선: 같은 페이지 재클릭 시 init 함수 재실행 방지 (1초 내 중복 방지)
const _baseNavigateTo = navigateTo;
let _lastNavigatedPage = '';
let _lastNavigatedAt   = 0;
window.navigateTo = function(page) {
  if (page === 'approval-1st' || page === 'approval-2nd') page = 'my-entries';
  _baseNavigateTo(page);
  // 타이틀 업데이트
  const title = PAGE_TITLES[page] || page;
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('headerActions').innerHTML = '';
  try { if (typeof window.renderEnvBadge === 'function') window.renderEnvBadge(); } catch (_) {}

  // ★ 동일 페이지 1초 내 재진입은 init 재실행 생략 (사이드바 클릭 연타 방지)
  const now = Date.now();
  if (page === _lastNavigatedPage && now - _lastNavigatedAt < 1000) return;
  _lastNavigatedPage = page;
  _lastNavigatedAt   = now;

  // ★ Lazy 로드 필요 페이지: 스크립트 로드 후 init 호출
  const lazySrc = _LAZY_SCRIPTS[page];
  const initFnName = PAGE_INIT_MAP[page];
  if (lazySrc) {
    _lazyLoadScript(lazySrc).then(() => {
      if (initFnName && window[initFnName]) window[initFnName]();
    }).catch(() => {
      Toast.error('페이지 로드 실패. 새로고침 후 다시 시도해주세요.');
    });
    return;
  }

  // 일반 페이지 init 호출
  if (initFnName && window[initFnName]) window[initFnName]();
};

// ─────────────────────────────────────────────
// 전역 세션 접근자
// ─────────────────────────────────────────────
function getSession() { return _session; }
