/* ============================================
   main.js — 앱 초기화, 공통 함수
   ============================================ */

let _session = null;

// 비밀번호 만료 정책 상수
const PW_EXPIRY_DAYS = 90;
const PW_EXPIRY_MS   = PW_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

window.addEventListener('DOMContentLoaded', async () => {
  // 세션 확인 — 없으면 로그인 화면으로 강제 이동
  _session = Session.require();
  if (!_session) {
    window.location.replace('index.html');
    return;
  }

  // ── 세션 최신화: DB에서 사용자 정보를 읽어 세션 갱신 ──
  let freshUser = null;
  try {
    freshUser = await API.get('users', _session.id);
    if (freshUser && freshUser.id) {
      const updatedSession = {
        ..._session,
        dept_id:      freshUser.dept_id      || _session.dept_id      || '',
        dept_name:    freshUser.dept_name    || _session.dept_name    || '',
        hq_id:        freshUser.hq_id        || _session.hq_id        || '',
        hq_name:      freshUser.hq_name      || _session.hq_name      || '',
        cs_team_id:   freshUser.cs_team_id   || _session.cs_team_id   || '',
        cs_team_name: freshUser.cs_team_name || _session.cs_team_name || '',
        approver_id:   freshUser.approver_id   || _session.approver_id   || '',
        approver_name: freshUser.approver_name || _session.approver_name || '',
        reviewer2_id:   freshUser.reviewer2_id   || _session.reviewer2_id   || '',
        reviewer2_name: freshUser.reviewer2_name || _session.reviewer2_name || '',
        is_timesheet_target: freshUser.is_timesheet_target === true,
        role:      (freshUser.role && freshUser.role.trim()) ? freshUser.role : _session.role,
        is_active: freshUser.is_active !== undefined ? freshUser.is_active : _session.is_active,
      };
      // 갱신된 세션 저장
      const stored = localStorage.getItem('wt_session') ? 'localStorage' : 'sessionStorage';
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

  // body 표시
  document.body.style.visibility = 'visible';

  // 비밀번호 만료 체크
  await checkPwExpiry(_session, freshUser ?? null);

  // 사이드바 사용자 정보 표시
  document.getElementById('sidebarAvatar').textContent = getInitial(_session.name);
  document.getElementById('sidebarName').textContent = _session.name;

  // 역할 라벨 표시
  const roleLabel = ROLE_LABEL_FULL[_session.role] || _session.role;
  document.getElementById('sidebarRole').textContent =
    _session.team_name ? `${_session.team_name} · ${roleLabel}` : roleLabel;

  // 권한별 메뉴 표시
  setupMenuByRole(_session);

  // 승인 뱃지 업데이트
  updateApprovalBadge(_session);

  // 알림 센터 초기화 (30초 폴링)
  if (typeof initNotify === 'function') initNotify();

  // 역할별 초기 진입 페이지 결정
  if (Auth.isStaff(_session) && !Auth.hasApprover(_session)) {
    navigateTo('archive');
  } else {
    await init_dashboard();
  }
});

// ─────────────────────────────────────────────
// 비밀번호 만료 체크
// ─────────────────────────────────────────────
async function checkPwExpiry(session, cachedUser = null) {
  try {
    let user = cachedUser;
    if (!user) {
      const res = await fetch(`tables/users/${session.id}`);
      if (!res.ok) return;
      user = await res.json();
    }

    const now         = Date.now();
    const lastChanged = user.pw_changed_at
      ? Number(user.pw_changed_at)
      : (user.created_at ? Number(user.created_at) : 0);

    const elapsed     = now - lastChanged;
    const elapsedDays = Math.floor(elapsed / (24 * 60 * 60 * 1000));

    if (lastChanged > 0 && elapsed > PW_EXPIRY_MS) {
      const dayEl = document.getElementById('mainPwDaysElapsed');
      if (dayEl) dayEl.textContent = elapsedDays + '일';

      window._pwExpiredUser = user;

      const modal = document.getElementById('mainPwChangeModal');
      if (modal) modal.style.display = 'flex';
    }
  } catch (err) {
    console.warn('[PwExpiry] 비밀번호 만료 체크 실패:', err.message);
  }
}

// ─────────────────────────────────────────────
// 비밀번호 강도 표시
// ─────────────────────────────────────────────
function updateMainPwStrength(pw) {
  const bar  = document.getElementById('mainPwStrengthBar');
  const text = document.getElementById('mainPwStrengthText');
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

// ─────────────────────────────────────────────
// 비밀번호 변경 처리
// ─────────────────────────────────────────────
async function handleMainPwChange(e) {
  e.preventDefault();

  const errEl   = document.getElementById('mainPwChangeError');
  const errText = document.getElementById('mainPwChangeErrorText');
  const showErr = (msg) => {
    errText.textContent = msg;
    errEl.style.display = 'flex';
  };
  errEl.style.display = 'none';

  const user = window._pwExpiredUser;
  if (!user) { showErr('세션 오류. 페이지를 새로고침하세요.'); return; }

  const oldPw        = document.getElementById('mainPwOld').value;
  const newPw        = document.getElementById('mainPwNew').value;
  const newPwConfirm = document.getElementById('mainPwNewConfirm').value;

  if (!oldPw || !newPw || !newPwConfirm) {
    showErr('모든 항목을 입력해주세요.'); return;
  }
  if (newPw.length < 8) {
    showErr('새 비밀번호는 8자 이상이어야 합니다.'); return;
  }
  if (newPw !== newPwConfirm) {
    showErr('새 비밀번호가 일치하지 않습니다.'); return;
  }

  const hashPw = async (pw) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  };

  const oldHash = await hashPw(oldPw);
  if (user.password !== oldHash) {
    showErr('현재 비밀번호가 올바르지 않습니다.'); return;
  }

  const newHash = await hashPw(newPw);
  if (newHash === user.password) {
    showErr('이전 비밀번호와 동일한 비밀번호는 사용할 수 없습니다.'); return;
  }

  const btn = document.getElementById('mainPwChangeBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 변경 중...';

  try {
    const res = await fetch(`tables/users/${user.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password: newHash, pw_changed_at: Date.now() }),
    });

    if (res.ok) {
      document.getElementById('mainPwChangeModal').style.display = 'none';
      window._pwExpiredUser = null;
      if (window.showToast) {
        showToast('비밀번호가 성공적으로 변경되었습니다.', 'success');
      } else {
        alert('비밀번호가 성공적으로 변경되었습니다.');
      }
    } else {
      showErr('비밀번호 변경에 실패했습니다. 다시 시도해주세요.');
    }
  } catch (err) {
    console.error(err);
    showErr('서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check"></i> 비밀번호 변경';
  }
}

// ─────────────────────────────────────────────
// 로그아웃
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
}

// ESC 키로 모달 닫기
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.show').forEach(m => {
      if (m.dataset.dynamic === 'true') {
        m.remove();
      } else {
        m.classList.remove('show');
      }
    });
  }
});

// 오버레이 클릭으로 모달 닫기
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('show');
  });
});

// ─────────────────────────────────────────────
// 페이지 타이틀 매핑
// ─────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard:           'Dashboard',
  'entry-new':         'New Entry',
  'my-entries':        'My Time Sheet',
  approval:            'Approval',
  analysis:            'Analysis',
  archive:             '자문 자료실',
  'master-teams':      'Teams',
  'master-clients':    'Clients',
  'master-categories': 'Categories',
  'master-org':        '사업부·본부 관리',
  'master-departments':'사업부 관리',
  'master-csteams':    '고객지원팀 관리',
  users:               'Staff 관리',
};

// page init 함수 매핑
const PAGE_INIT_MAP = {
  'dashboard':          'init_dashboard',
  'entry-new':          'init_entry_new',
  'my-entries':         'init_my_entries',
  'approval':           'init_approval',
  'analysis':           'init_analysis',
  'archive':            'init_archive',
  'master-teams':       'init_master_teams',
  'master-clients':     'init_master_clients',
  'master-categories':  'init_master_categories',
  'master-org':         'init_master_org',
  'master-departments': 'init_master_departments',
  'master-csteams':     'init_master_csteams',
  'users':              'init_users',
};

// ─────────────────────────────────────────────
// Lazy 로드: master.js / users.js
// ─────────────────────────────────────────────
const _LAZY_SCRIPTS = {
  'master-teams'      : 'js/master.js?v=20260331l',
  'master-clients'    : 'js/master.js?v=20260331l',
  'master-categories' : 'js/master.js?v=20260331l',
  'master-org'        : 'js/master.js?v=20260331l',
  'master-departments': 'js/master.js?v=20260331l',
  'master-csteams'    : 'js/master.js?v=20260331l',
  'users'             : 'js/users.js?v=20260331l',
};
const _lazyLoaded = {};

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
const _baseNavigateTo = navigateTo;
let _lastNavigatedPage = '';
let _lastNavigatedAt   = 0;
window.navigateTo = function(page) {
  _baseNavigateTo(page);
  const title = PAGE_TITLES[page] || page;
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('headerActions').innerHTML = '';

  // 동일 페이지 1초 내 재진입은 init 재실행 생략
  const now = Date.now();
  if (page === _lastNavigatedPage && now - _lastNavigatedAt < 1000) return;
  _lastNavigatedPage = page;
  _lastNavigatedAt   = now;

  // Lazy 로드 필요 페이지
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
