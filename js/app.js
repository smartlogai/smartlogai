/* ============================================
   Smart Log AI — 앱 코어 (세션, API, 유틸, 권한)
   ============================================ */

// ─────────────────────────────────────────────
// 세션 관리
// ─────────────────────────────────────────────
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8시간

function normalizeRoleName(role) {
  const raw = String(role || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'admin' || raw === 'administrator') return 'admin';
  if (raw === 'director') return 'director';
  if (raw === 'top_mgr' || raw === 'topmgr' || raw === 'top-manager' || raw === 'top manager' || raw === '경영') return 'top_mgr';
  if (raw === 'manager') return 'manager';
  if (raw === 'staff') return 'staff';
  return raw;
}

const Session = {
  get() {
    try {
      const raw = localStorage.getItem('wt_session') || sessionStorage.getItem('wt_session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s && s.role) s.role = normalizeRoleName(s.role);
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
      role: normalizeRoleName(data && data.role),
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

  top_mgr:
    - 사업부장·대표·경영지원 등 시스템 상위 권한 묶음 (2차 승인 라인은 director 유지)
    - director에 준하는 소속 범위 열람·분석·기준정보(조직 마스터 제외)

  admin:
    - 시스템 전체 관리 (등록/수정/삭제/설정)
    - Staff 업무 기록(전체 타임시트·상태 필터)로 열람 (승인 처리는 Manager/Director 역할)
    - Analysis 등 전체 데이터 열람
*/
const ROLE_LABEL = {
  admin:    'Admin',       // 테이블 배지용 짧은 표기
  director: '본부장',      // 본부장 — 2차 최종 승인
  top_mgr:  'Top Mgr',    // 사업부장·대표·경영지원 등 상위 권한
  manager:  '팀장',        // 고객지원팀장 — 1차 승인
  staff:    '담당(직책)',   // 담당자 — 타임시트 작성
};
// 사이드바·상세화면 등 전체 이름이 필요한 경우 사용
const ROLE_LABEL_FULL = {
  admin:    'Administrator',
  director: '본부장',
  top_mgr:  'Top Mgr',
  manager:  '팀장',
  staff:    '담당(전임/선임/책임)',
};
const JOB_TITLE_LABEL = {
  senior: '선임',
  associate: '전임',
  principal: '책임',
  team_lead: '팀장',
  division_head: '본부장',
  bu_head: '사업부장',
  ceo: '대표',
};
const ROLE_COLOR = {
  admin:    'badge-purple',
  director: 'badge-orange',
  top_mgr:  'badge-amber',
  manager:  'badge-blue',
  staff:    'badge-green',
};

const PERM_POLICY_CACHE = {
  sessionKey: '',
  rowsRole: [],
  rowsDeptJob: [],
  loadedAt: 0,
};

function _permSessionKey(session) {
  if (!session) return '';
  const uid = String(session.id || session.user_id || '').trim();
  const role = String(session.role || '').trim();
  const dept = String(session.dept_id || '').trim();
  const deptName = String(session.dept_name || '').trim();
  const title = String(session.job_title || '').trim();
  return [uid, role, dept, deptName, title].join('|');
}

function _permPolicyCellKey(menuKey, actionKey) {
  return `${String(menuKey || '').trim()}::${String(actionKey || '').trim()}`;
}

function _permDeptJobKeys(jobTitle, role) {
  const jt = String(jobTitle || '').trim();
  const roleKey = String(role || '').trim().toLowerCase();
  const keys = [];
  if (jt) keys.push(jt);

  // 정책 타깃 키 정규화:
  // - role 기반 표준키 우선 매핑
  // - job_title의 한/영 표기 변형도 보조 매핑
  const byRole = {
    staff: 'staff_consultant',
    manager: 'team_lead',
    director: 'division_head',
    top_mgr: 'bu_head',
  };
  if (byRole[roleKey]) keys.push(byRole[roleKey]);

  // 담당(선임/전임/책임) 통합키
  // - 기존 영문 직책값
  // - 한글 직책표기(담당/선임/전임/책임 포함)
  const titleLower = jt.toLowerCase();
  const isStaffTitle = (
    titleLower === 'senior' ||
    titleLower === 'associate' ||
    titleLower === 'principal' ||
    jt.includes('담당') ||
    jt.includes('선임') ||
    jt.includes('전임') ||
    jt.includes('책임')
  );
  if (isStaffTitle) keys.push('staff_consultant');

  // 팀장/본부장/사업부장 표기 변형 대응
  if (
    titleLower === 'team_lead' || titleLower === 'manager' ||
    jt.includes('팀장')
  ) keys.push('team_lead');
  if (
    titleLower === 'division_head' || titleLower === 'director' ||
    jt.includes('본부장')
  ) keys.push('division_head');
  if (
    titleLower === 'bu_head' || titleLower === 'top_mgr' ||
    jt.includes('사업부장')
  ) keys.push('bu_head');

  return Array.from(new Set(keys.filter(Boolean)));
}

function _permRowActionMatch(rowAction, actionKey) {
  const a = String(rowAction || '').trim();
  const t = String(actionKey || '').trim();
  return a === t || a === '*';
}

function _permResolveAllowFromRows(rows, menuKey, actionKey) {
  const menu = String(menuKey || '').trim();
  const action = String(actionKey || '').trim();
  if (!menu || !action) return null;
  const direct = (rows || []).find((r) =>
    String(r.menu_key || '').trim() === menu && _permRowActionMatch(r.action_key, action)
  );
  if (direct) return direct.allow === true;
  const wildcard = (rows || []).find((r) =>
    String(r.menu_key || '').trim() === '*' && _permRowActionMatch(r.action_key, action)
  );
  if (wildcard) return wildcard.allow === true;
  return null;
}

function _permResolveAllow(session, menuKey, actionKey) {
  if (!session) return null;
  const deptHit = _permResolveAllowFromRows(PERM_POLICY_CACHE.rowsDeptJob, menuKey, actionKey);
  if (deptHit != null) return deptHit;
  const roleHit = _permResolveAllowFromRows(PERM_POLICY_CACHE.rowsRole, menuKey, actionKey);
  if (roleHit != null) return roleHit;
  return null;
}

function _menuPolicyKeyByPage(page) {
  const p = String(page || '').trim();
  const alias = {
    'entry-new': 'entry-new-hourly',
  };
  return alias[p] || p;
}

function _isCeoSession(session) {
  if (!session) return false;
  const email = String(session.email || '').trim().toLowerCase();
  const name = String(session.name || '').trim();
  const roleRaw = String(session.role || '').trim().toLowerCase();
  const roleNorm = normalizeRoleName(session.role);
  const jobTitle = String(session.job_title || '').trim().toLowerCase();
  if (email === 'hshan@hjcustoms.co.kr') return true;
  if (name === '한휘선') return true;
  return roleRaw === 'ceo' || roleNorm === 'ceo' || jobTitle === 'ceo';
}

function _isSecurityMenuDeniedForSystemAdmin(session, menuKey) {
  if (!session) return false;
  if (normalizeRoleName(session.role) !== 'admin') return false;
  if (_isCeoSession(session)) return false;
  const key = String(menuKey || '').trim();
  return key === 'project-deliverables' || key === 'analysis-staff' || key === 'analysis-labor';
}

function _authCanReadMenuSync(session, menuKey, fallbackAllow) {
  if (_isCeoSession(session)) return true;
  if (_isSecurityMenuDeniedForSystemAdmin(session, menuKey)) return false;
  const hit = _permResolveAllow(session, menuKey, 'read');
  if (hit == null) return !!fallbackAllow;
  return !!hit;
}

function _authCanActionSync(session, menuKey, actionKey, fallbackAllow) {
  if (_isCeoSession(session)) return true;
  if (_isSecurityMenuDeniedForSystemAdmin(session, menuKey)) return false;
  const hit = _permResolveAllow(session, menuKey, actionKey);
  if (hit == null) return !!fallbackAllow;
  return !!hit;
}

function _canReadAnalysisEntry(session, fallbackAllow = false) {
  if (!session) return false;
  const subKeys = ['analysis-work', 'analysis-staff', 'analysis-labor', 'analysis-project-profit'];
  const root = _permResolveAllow(session, 'analysis', 'read');
  const subHits = subKeys.map((k) => _permResolveAllow(session, k, 'read'));

  // analysis는 컨테이너 메뉴:
  // - root 또는 하위 탭에 "명시 정책"이 하나라도 있으면 fallback을 사용하지 않고 정책값만 따른다.
  // - 명시 정책이 전혀 없을 때만 역할 fallback을 사용한다.
  const hasExplicitPolicy = (root != null) || subHits.some((v) => v != null);
  if (hasExplicitPolicy) {
    if (root === true) return true;
    if (subHits.some((v) => v === true)) return true;
    return false;
  }

  return !!fallbackAllow;
}

function _legacyCanReadMenuByPage(session, page) {
  if (!session) return false;
  const p = String(page || '').trim();
  const role = String(session.role || '');
  const isMaster = Auth.canManageMaster(session);
  const isTopMgr = Auth.isTopMgr(session);

  switch (p) {
    case 'dashboard':
      // CCB는 Timelog dashboard를 항상 숨기고 Project dashboard만 노출
      return !!(Auth.canViewDashboardMenu(session) && !Auth.isCcbDivision(session));
    case 'project-dashboard':
      return !!Auth.canViewDashboardMenu(session);
    case 'project-management':
      // 프로젝트관리는 운영 민감 메뉴라 staff 기본허용을 두지 않는다.
      return !!(Auth.isAdmin(session) || Auth.isTopMgr(session) || Auth.isDirector(session) || Auth.isManager(session));
    case 'analysis':
      return _canReadAnalysisEntry(session, Auth.canViewAnalysis(session));
    case 'approval':
      return !!((Auth.canApprove(session) || Auth.canViewDeptScope(session)) && !Auth.canViewAll(session));
    case 'archive':
      return true;
    case 'project-deliverables':
      return !!Auth.canViewProjectDeliverables(session);
    case 'entry-new-hourly':
      return !!Auth.timesheetHourlyEnabled(session);
    case 'entry-new-daily':
      return !!Auth.timesheetDailyEnabled(session);
    case 'entry-new':
      return !!Auth.canWriteEntry(session);
    case 'my-entries-hourly':
      return !!Auth.timesheetHourlyEnabled(session);
    case 'my-entries-daily':
      return !!Auth.timesheetDailyEnabled(session);
    case 'my-entries':
      return !!(Auth.canViewAll(session) || role === 'top_mgr' || Auth.canWriteEntry(session));
    case 'master-clients':
      return !!(Auth.canManageRefData(session) || Auth.canRequestClient(session));
    case 'master-categories':
      return !!Auth.isAdmin(session);
    case 'project-register':
      return !!Auth.canManageProjectRegister(session);
    case 'master-org':
    case 'master-teams':
    case 'master-csteams':
    case 'master-project-codes':
      // Settings 메뉴는 정책 설정 전에는 기본 비노출(Top Mgr도 동일)
      return !!isMaster;
    case 'users':
    case 'permission-management':
      return !!isMaster;
    default:
      return true;
  }
}

async function _loadPermissionPoliciesForSession(session, force = false) {
  if (!session) {
    PERM_POLICY_CACHE.sessionKey = '';
    PERM_POLICY_CACHE.rowsRole = [];
    PERM_POLICY_CACHE.rowsDeptJob = [];
    PERM_POLICY_CACHE.loadedAt = Date.now();
    return;
  }
  const now = Date.now();
  const key = _permSessionKey(session);
  if (!force && key === PERM_POLICY_CACHE.sessionKey && (now - Number(PERM_POLICY_CACHE.loadedAt || 0) < 60000)) {
    return;
  }
  const role = String(session.role || '').trim();
  const deptId = String(session.dept_id || '').trim();
  const jobTitle = String(session.job_title || '').trim();
  const deptName = String(session.dept_name || '').trim();
  const hqName = String(session.hq_name || '').trim();
  const csName = String(session.cs_team_name || '').trim();
  const roleRows = role
    ? await API.listAllPages('permission_policies', {
      filter: `scope_type=eq.role&role_key=eq.${encodeURIComponent(role)}`,
      limit: 1000,
      maxPages: 10,
      sort: 'updated_at',
    }).catch(() => [])
    : [];
  const titleKeys = _permDeptJobKeys(jobTitle, role);
  const deptJobRawList = await Promise.all(titleKeys.map((titleKey) => (
    API.listAllPages('permission_policies', {
      filter: `scope_type=eq.dept_job&job_title=eq.${encodeURIComponent(titleKey)}`,
      limit: 1000,
      maxPages: 10,
      sort: 'updated_at',
    }).catch(() => [])
  )));
  const deptJobRaw = deptJobRawList.flat();
  const deptJobRows = (deptJobRaw || []).filter((r) => {
    const rowDeptId = String(r?.dept_id || '').trim();
    const rowDeptName = String(r?.dept_name || '').trim();
    if (rowDeptId && deptId) return rowDeptId === deptId;
    if (!rowDeptName) return !rowDeptId;
    return [deptName, hqName, csName].some((v) => String(v || '').includes(rowDeptName));
  });
  PERM_POLICY_CACHE.sessionKey = key;
  PERM_POLICY_CACHE.rowsRole = Array.isArray(roleRows) ? roleRows : [];
  PERM_POLICY_CACHE.rowsDeptJob = Array.isArray(deptJobRows) ? deptJobRows : [];
  PERM_POLICY_CACHE.loadedAt = now;
}

function _isFinanceSupportUser(session) {
  if (!session) return false;
  return [
    session.hq_name,
    session.cs_team_name,
    session.team_name,
    session.dept_name,
  ].some((v) => String(v || '').includes('경영지원'));
}

function _isCcbDivisionUser(session) {
  if (!session) return false;
  return [
    session.dept_name,
    session.hq_name,
    session.team_name,
  ].some((v) => String(v || '').toUpperCase().includes('CCB'));
}

const Auth = {
  roleOf:     (s) => normalizeRoleName(s && s.role),
  isAdmin:    (s) => s && Auth.roleOf(s) === 'admin',
  isDirector: (s) => s && Auth.roleOf(s) === 'director',
  isTopMgr:   (s) => s && Auth.roleOf(s) === 'top_mgr',
  isManager:  (s) => s && Auth.roleOf(s) === 'manager',
  isStaff:    (s) => s && Auth.roleOf(s) === 'staff',
  isCeo:      (s) => _isCeoSession(s),
  isFinanceSupport: (s) => _isFinanceSupportUser(s),
  isCcbDivision: (s) => _isCcbDivisionUser(s),

  /** 프로젝트 산출물 열람: 권한정책 우선, 레거시 사용자 플래그 fallback */
  canViewProjectDeliverables: (s) => {
    if (!s) return false;
    if (Auth.isCeo(s)) return true;
    if (Auth.isAdmin(s) && !Auth.isCeo(s)) return false;
    const byPolicy = _permResolveAllow(s, 'project-deliverables', 'read');
    if (byPolicy != null) return byPolicy;
    return !!s.can_view_project_deliverables;
  },
  canDownloadProjectDeliverables: (s) => {
    if (!s) return false;
    if (Auth.isCeo(s)) return true;
    if (Auth.isAdmin(s) && !Auth.isCeo(s)) return false;
    const byPolicy = _permResolveAllow(s, 'project-deliverables', 'download');
    if (byPolicy != null) return byPolicy;
    return !!s.can_view_project_deliverables;
  },

  /** 비용·인건비·배부 성격 UI — admin 제외, director·top_mgr 허용 */
  canViewCostFinancials: (s) => {
    if (!s) return false;
    if (Auth.isAdmin(s)) return Auth.isCeo(s);
    return !!(Auth.isDirector(s) || Auth.isTopMgr(s));
  },

  /** 인건비 설정·매출 업로드 등 (기존 admin 전용 버튼 → 경영층으로 이전) */
  canManageLaborCostSettings: (s) => !!(s && (Auth.isDirector(s) || Auth.isTopMgr(s))),

  // ★ 승인자 지정 여부 (staff에만 의미 있음, manager 이상은 true 반환)
  hasApprover: (s) => {
    if (!s) return false;
    if (Auth.isStaff(s)) return !!(s.approver_id);
    return true; // manager/director/top_mgr/admin 등
  },

  // 타임시트 작성: 승인자 지정 + 타임시트 대상 staff OR 타임시트 대상 manager
  canWriteEntry: (s) => {
    if (!s) return false;
    if (Auth.isCeo(s)) return s.is_timesheet_target !== false;
    const isDailyDept = Auth.preferredSheetType(s) === 'daily';
    if (s.role === 'staff') return !!(s.approver_id) && (isDailyDept || s.is_timesheet_target !== false);
    if (s.role === 'manager') return isDailyDept || s.is_timesheet_target !== false;
    if (s.role === 'director') {
      return isDailyDept;
    }
    return false;
  },

  /** Hourly 시트 메뉴·진입 (소속 기반 sheet_type + 타임시트 대상) */
  timesheetHourlyEnabled: (s) => {
    if (!s) return false;
    if (s.is_timesheet_target === false) return false;
    if (Auth.isCeo(s)) return s.timesheet_hourly !== false;
    return Auth.preferredSheetType(s) === 'hourly';
  },
  /** Daily 시트 메뉴·진입 (소속 기반 sheet_type + 타임시트 대상) */
  timesheetDailyEnabled: (s) => {
    if (!s) return false;
    if (Auth.isCeo(s)) return s.is_timesheet_target !== false && s.timesheet_daily === true;
    if (Auth.preferredSheetType(s) !== 'daily') return false;
    if (s.role === 'staff') return !!s.approver_id;
    return s.role === 'manager' || s.role === 'director';
  },
  sheetTypeByDeptName: (deptName) => {
    const token = String(deptName || '').trim().toUpperCase();
    if (token.includes('CCB')) return 'daily';
    if (token.includes('CRB') || token.includes('COB')) return 'hourly';
    return '';
  },
  /** 사용자 기본 시트 타입 (소속 우선, 없으면 users.sheet_type 사용) */
  preferredSheetType: (s) => {
    if (!s) return 'hourly';
    if (Auth.isCeo(s)) {
      const allowDaily = s.timesheet_daily === true;
      const allowHourly = s.timesheet_hourly !== false;
      if (allowDaily && !allowHourly) return 'daily';
      if (!allowDaily && allowHourly) return 'hourly';
      if (allowDaily) return 'daily';
    }
    const deptBased = Auth.sheetTypeByDeptName(s.dept_name || '');
    if (deptBased) return deptBased;
    const st = String(s.sheet_type || '').toLowerCase();
    if (st === 'daily' || st === 'hourly') return st;
    return 'hourly';
  },

  // ── 승인 권한 분리 ──────────────────────────────────────
  // 1차 승인: manager (수행방식 확인 + 형식 검증)
  canApprove1st: (s) => s && Auth.isManager(s),
  // 2차 최종 승인: director (품질평가 + 전문성 + DB저장)
  canApprove2nd: (s) => s && (Auth.isDirector(s) || Auth.isTopMgr(s)),
  // 하위 호환: 기존 canApprove = 1차 승인 권한과 동일
  canApprove: (s) => s && Auth.isManager(s),

  // 전체 열람 (필터 없음): admin만
  canViewAll: (s) => s && Auth.isAdmin(s),

  // 대시보드 전체 열람: admin + 경영지원
  canViewDashboardAll: (s) => !!(s && (s.role === 'admin' || _isFinanceSupportUser(s))),

  // 대시보드 메뉴 접근: 팀장/본부장/사업부장 + admin + 경영지원
  canViewDashboardMenu: (s) => !!(s && (
    s.role === 'manager' ||
    s.role === 'director' ||
    s.role === 'top_mgr' ||
    s.role === 'admin' ||
    _isFinanceSupportUser(s)
  )),

  // 소속 단위 열람: manager + director + top_mgr + admin
  canViewDeptScope: (s) => s && (Auth.isManager(s) || Auth.isDirector(s) || Auth.isTopMgr(s) || Auth.isAdmin(s)),

  // 마스터 관리 (조직구성·직원): admin만
  canManageMaster: (s) => s && Auth.isAdmin(s),

  // 기준정보 관리 (고객사·업무분류): admin + director + top_mgr + manager
  canManageRefData: (s) => s && (Auth.isAdmin(s) || Auth.isDirector(s) || Auth.isTopMgr(s) || Auth.isManager(s)),
  // 업무분류 설정: admin only
  canManageCategories: (s) => s && Auth.isAdmin(s),

  // 고객사 등록 요청: staff 포함 전 역할 접근 허용 (수정/삭제/업로드는 별도 권한)
  canRequestClient: (s) => !!(s && (
    s.role === 'admin' ||
    s.role === 'director' ||
    s.role === 'top_mgr' ||
    s.role === 'manager' ||
    s.role === 'staff'
  )),

  // 프로젝트 등록: staff 포함 전 역할 허용 (승인 검증은 제출 단계에서 별도 처리)
  canManageProjectRegister: (s) => s && (
    s.role === 'admin' ||
    s.role === 'director' ||
    s.role === 'top_mgr' ||
    s.role === 'manager' ||
    s.role === 'staff' ||
    Auth.preferredSheetType(s) === 'daily'
  ),

  // 분석 열람: director + top_mgr + admin
  canViewAnalysis: (s) => s && (Auth.isDirector(s) || Auth.isTopMgr(s) || Auth.isAdmin(s)),
  // 고과분석 열람: director + top_mgr + (대표이사 admin)
  canViewStaffAnalysis: (s) => {
    if (!s) return false;
    if (Auth.isAdmin(s)) return Auth.isCeo(s);
    return s.role === 'director' || s.role === 'top_mgr';
  },
  // 프로젝트 매출·이익분석 열람: director + top_mgr + admin
  canViewProjectProfitAnalysis: (s) => s && (s.role === 'director' || s.role === 'top_mgr' || s.role === 'admin'),

  // 자문 자료실: 모든 역할
  canViewArchive: (s) => !!s,

  // 정책 기반 메뉴/액션 체크 (권한관리 화면 연동)
  canReadMenu: (s, menuKey, fallbackAllow = false) => _authCanReadMenuSync(s, menuKey, fallbackAllow),
  canDoAction: (s, menuKey, actionKey, fallbackAllow = false) => _authCanActionSync(s, menuKey, actionKey, fallbackAllow),
  refreshPolicyCache: async (s, force = false) => {
    await _loadPermissionPoliciesForSession(s, !!force);
    // 정책 캐시 갱신 직후 메뉴 표시를 즉시 재계산하여
    // "권한은 true인데 사이드바가 이전 상태로 남는" 문제를 방지한다.
    _applyPolicyToMenuVisibility(s);
    refreshSidebarSectionCollapse();
  },

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
    if (Auth.isManager(s))  return {}; // manager: 전체 가져와서 JS 필터
    if (Auth.isDirector(s)) return {}; // director: 전체 가져와서 JS 필터
    if (Auth.isTopMgr(s))  return {}; // top_mgr: director와 동일 패턴
    return { user: s.id };               // staff: 본인만
  },
};

// ─────────────────────────────────────────────
// Supabase 설정 (supabase-env.js — 로컬은 supabase.dev.js)
// ─────────────────────────────────────────────
const SUPABASE_URL = typeof window.__SMARTLOG_SB_URL__ === 'string' ? window.__SMARTLOG_SB_URL__ : '';
const SUPABASE_KEY = typeof window.__SMARTLOG_SB_KEY__ === 'string' ? window.__SMARTLOG_SB_KEY__ : '';

/** Edge Functions·외부 모듈에서 동일 프로젝트 URL/anon 키 참조용 */
window.SmartLogSupabase = { url: SUPABASE_URL, anonKey: SUPABASE_KEY };

// ─────────────────────────────────────────────
// 운영 안정화: 배포 환경 표시 + 설정 누락 방지
// ─────────────────────────────────────────────
const SMARTLOG_ENV_LABEL =
  (typeof window.__SMARTLOG_ENV_LABEL__ === 'string' && window.__SMARTLOG_ENV_LABEL__)
    ? window.__SMARTLOG_ENV_LABEL__
    : 'PROD';
window.__SMARTLOG_ENV_LABEL__ = SMARTLOG_ENV_LABEL;

// 기능 플래그(추후 점진 도입용)
// - 기본값: 비활성 (운영/스테이징 모두)
// - 임시 활성화: localStorage 'smartlog_flag_llm'= '1'
window.SmartLogFlags = window.SmartLogFlags || {};
try {
  const llmLocal = localStorage.getItem('smartlog_flag_llm') === '1';
  window.SmartLogFlags.llmProxyEnabled = !!llmLocal;
} catch (_) {
  window.SmartLogFlags.llmProxyEnabled = false;
}

// Help Desk 운영 단계 플래그
// - internal : 내부 유지보수 운영(기본)
// - hybrid   : 내부+외주 병행(이관 준비)
// - vendor   : 외주 주도 운영
window.SmartLogHelpDesk = window.SmartLogHelpDesk || {};
try {
  const phaseRaw = String(localStorage.getItem('smartlog_helpdesk_phase') || 'internal').trim().toLowerCase();
  const phase = ['internal', 'hybrid', 'vendor'].includes(phaseRaw) ? phaseRaw : 'internal';
  const portalRaw = String(localStorage.getItem('smartlog_helpdesk_external_portal') || '').trim().toLowerCase();
  window.SmartLogHelpDesk.phase = phase;
  window.SmartLogHelpDesk.externalPortalEnabled = portalRaw === '1' || portalRaw === 'true';
  // 외주 포털 URL은 이관 시점에 localStorage 또는 배포 스크립트로 주입
  window.SmartLogHelpDesk.externalPortalUrl = String(localStorage.getItem('smartlog_helpdesk_external_portal_url') || '').trim();
} catch (_) {
  window.SmartLogHelpDesk.phase = 'internal';
  window.SmartLogHelpDesk.externalPortalEnabled = false;
  window.SmartLogHelpDesk.externalPortalUrl = '';
}

function renderEnvBadge() {
  // 정책 변경: ENV 배지는 헤더에서 노출하지 않음.
}
window.renderEnvBadge = renderEnvBadge;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  // 설정 미주입/누락이면 운영에서 잘못된 DB 연결을 방지하기 위해 즉시 중단
  try {
    const hint = (window.__SMARTLOG_REMOTE_CONFIG_MISSING__ || window.__SMARTLOG_DEV_CONFIG_MISSING__)
      ? 'Supabase 설정이 주입되지 않았습니다.'
      : 'Supabase 설정이 비어 있습니다.';
    alert(
      `Smartlog 설정 오류: ${hint}\n\n` +
      `- Netlify 환경변수(SUPABASE_URL, SUPABASE_ANON_KEY)를 확인하세요.\n` +
      `- 로컬 개발이면 js/supabase.dev.js 설정을 확인하세요.`
    );
  } catch (_) {}
  throw new Error('Smartlog Supabase config missing');
}

// ─────────────────────────────────────────────
// API 헬퍼 (Supabase 호환 레이어)
// Genspark Table API → Supabase REST API 변환
// 기존 코드 수정 없이 동일하게 동작
// ─────────────────────────────────────────────
const API = {

  _sessionHeaders() {
    const s = Session.get() || {};
    const uid = String(s.id || s.user_id || '').trim();
    const role = String(s.role || '').trim().toLowerCase();
    const email = String(s.email || '').trim().toLowerCase();
    const headers = {};
    if (uid) headers['x-app-user-id'] = uid;
    if (role) headers['x-app-user-role'] = role;
    if (email) headers['x-app-user-email'] = email;
    return headers;
  },

  // 공통 헤더
  _headers() {
    return {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
      ...this._sessionHeaders(),
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

  /** PostgREST INSERT/PATCH/UPDATE 응답: 배열이면 첫 행. 빈 배열([])은 RLS 등으로 반환 행 없음 → null */
  _singleRowResult(result) {
    if (Array.isArray(result) && result.length > 0) return result[0];
    if (Array.isArray(result) && result.length === 0) return null;
    return result;
  },

  /** 스키마 캐시에 없는 컬럼 에러를 파싱해 컬럼명 반환 */
  _extractMissingColumnName(err) {
    const msg = String(err?.message || '');
    const m = msg.match(/Could not find the '([^']+)' column/i);
    return m ? String(m[1] || '').trim() : '';
  },

  /**
   * 운영/개발 스키마 드리프트 방어:
   * PostgREST가 "없는 컬럼" 에러를 반환하면 해당 키를 payload에서 제거 후 재시도.
   */
  async _writeWithSchemaFallback(method, table, id, data) {
    const payload = { ...(data || {}) };
    if (method !== 'POST') payload.updated_at = Date.now();
    const tried = new Set();

    while (true) {
      const qs = (method === 'POST') ? '' : `?id=eq.${id}`;
      const url = `${SUPABASE_URL}/rest/v1/${table}${qs}`;
      try {
        const result = await this._fetch(url, {
          method,
          body: JSON.stringify(payload),
        });
        return this._singleRowResult(result);
      } catch (err) {
        const missingCol = this._extractMissingColumnName(err);
        if (!missingCol || !(missingCol in payload) || tried.has(missingCol)) throw err;
        tried.add(missingCol);
        delete payload[missingCol];
        console.warn(`[API] ${table} write fallback: removed missing column "${missingCol}" and retried.`);
      }
    }
  },

  // 목록 조회 (GET) — Genspark: { data:[], total:N } 형식으로 변환
  async list(table, params = {}) {
    const limit  = params.limit  || 200;
    const page   = params.page   || 1;
    const offset = (page - 1) * limit;
    const search = params.search || '';

    let url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=${limit}&offset=${offset}`;

    // PostgREST 추가 조건 (내부 전용) — 예: status=eq.submitted, or=(status.eq.a,status.eq.b)
    if (params.filter && typeof params.filter === 'string') {
      url += `&${params.filter}`;
    }

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

  /**
   * 목록을 페이지 순회해 병합 (created_at 최신 N건만 보면 오래된 행·특정 status 누락 방지)
   * @param {string} table
   * @param {{ filter?: string, sort?: string, limit?: number, maxPages?: number }} [params]
   */
  async listAllPages(table, params = {}) {
    const limit = params.limit != null ? params.limit : 500;
    const maxPages = params.maxPages != null ? params.maxPages : 120;
    const sort = params.sort != null ? params.sort : 'updated_at';
    const filter = params.filter || '';
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const listParams = { limit, page, sort };
      if (filter) listParams.filter = filter;
      const r = await this.list(table, listParams);
      const chunk = (r && r.data) ? r.data : [];
      out.push(...chunk);
      if (chunk.length === 0 || chunk.length < limit) break;
    }
    return out;
  },

  /** 대시보드·분석 공통: time_entries 전량(페이지 순회). 최신 N건만 보면 상태·기간 필터가 틀어짐. */
  async fetchAllTimeEntriesForDash() {
    try {
      return await this.listAllPages('time_entries', { limit: 500, maxPages: 120, sort: 'updated_at' });
    } catch (e) {
      console.warn('[API] fetchAllTimeEntriesForDash listAllPages 실패, 폴백', e);
      const r = await this.list('time_entries', { limit: 2000, sort: 'updated_at' });
      return (r && r.data) ? r.data : [];
    }
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
    return this._writeWithSchemaFallback('POST', table, null, payload);
  },


  // 전체 수정 (PUT → PATCH로 처리)
  async update(table, id, data) {
    return this._writeWithSchemaFallback('PATCH', table, id, data);
  },

  // 부분 수정 (PATCH)
  async patch(table, id, data) {
    return this._writeWithSchemaFallback('PATCH', table, id, data);
  },

  // 삭제 (Hard Delete)
  async delete(table, id) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
    let res;
    try {
      res = await fetch(url, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=minimal',
        },
      });
    } catch (networkErr) {
      console.error(`[API.delete] 네트워크 오류 (${table}/${id}):`, networkErr);
      throw new Error('네트워크 오류: ' + networkErr.message);
    }
    console.log(`[API.delete] ${table}/${id} → HTTP ${res.status}`);
    if (res.ok || res.status === 204) return null;
    const errBody = await res.text().catch(() => '');
    let errMsg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(errBody);
      errMsg = j.message || j.hint || j.error || errMsg;
    } catch (_) {}
    console.error(`[API.delete] 실패 (${table}/${id}):`, errMsg, errBody);
    throw new Error(errMsg);
  },

  /** Supabase PostgREST RPC (예: fn_allocate_project_code) */
  async rpc(fn, body = {}) {
    const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`;
    return this._fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** Supabase Edge Function 호출 */
  async invokeFunction(fn, body = {}, opts = {}) {
    const name = String(fn || '').trim();
    if (!name) throw new Error('호출할 Edge Function 이름이 없습니다.');
    const url = `${SUPABASE_URL}/functions/v1/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      method: String(opts.method || 'POST').toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(data?.message || data?.error || `HTTP ${res.status}`);
      throw new Error(msg);
    }
    return data;
  },

  _encodeStoragePath(path) {
    return String(path || '')
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
  },

  storagePublicUrl(bucket, path) {
    const b = encodeURIComponent(String(bucket || '').trim());
    const p = this._encodeStoragePath(path);
    return `${SUPABASE_URL}/storage/v1/object/public/${b}/${p}`;
  },

  _guessMimeByName(name) {
    const fileName = String(name || '').trim().toLowerCase();
    const ext = fileName.includes('.') ? fileName.split('.').pop() : '';
    const map = {
      pdf: 'application/pdf',
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      hwp: 'application/x-hwp',
      hwpx: 'application/x-hwp+zip',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      zip: 'application/zip',
      '7z': 'application/x-7z-compressed',
    };
    return map[ext] || '';
  },

  async storageUpload(bucket, path, file, opts = {}) {
    if (!file) throw new Error('업로드할 파일이 없습니다.');
    const b = encodeURIComponent(String(bucket || '').trim());
    const p = this._encodeStoragePath(path);
    const upsert = opts.upsert === true ? 'true' : 'false';
    const url = `${SUPABASE_URL}/storage/v1/object/${b}/${p}?upsert=${upsert}`;
    const guessedMime = this._guessMimeByName(file && file.name);
    const contentType = String((file && file.type) || '').trim() || guessedMime || 'application/octet-stream';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'x-upsert': upsert,
        'content-type': contentType,
      },
      body: file,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      const msg = String(err.message || err.error || `HTTP ${res.status}`);
      if (/bucket not found/i.test(msg)) {
        throw new Error(`스토리지 버킷(${String(bucket || '').trim()})이 없습니다. docs/sql/dev_setup_project_outputs_storage.sql 을 먼저 실행해주세요.`);
      }
      throw new Error(msg);
    }
    return {
      bucket: String(bucket || '').trim(),
      path: String(path || ''),
      publicUrl: this.storagePublicUrl(bucket, path),
    };
  },

  async storageDelete(bucket, path) {
    const b = encodeURIComponent(String(bucket || '').trim());
    const p = this._encodeStoragePath(path);
    const url = `${SUPABASE_URL}/storage/v1/object/${b}/${p}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      throw new Error(err.message || err.error || `HTTP ${res.status}`);
    }
    return true;
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
// ★ 전역 오류 캡처 (콘솔을 몰라도 원인 확인 가능)
// - 런타임 에러(window.onerror), Promise reject(unhandledrejection) 수집
// - 최근 오류 30개를 sessionStorage에 저장
// - 화면 우하단 "오류 로그" 버튼으로 확인
// ─────────────────────────────────────────────
const GlobalErrorCapture = (() => {
  const KEY = '__smartlog_errors__';
  const MAX = 30;
  let installed = false;

  function _load() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); }
    catch { return []; }
  }
  function _save(list) {
    try { sessionStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); }
    catch { /* ignore */ }
  }
  function _push(item) {
    const list = _load();
    list.push(item);
    _save(list);
    _ensureButton();
  }
  function _fmtTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  }
  function _ensureButton() {
    if (document.getElementById('btn-error-log')) return;
    const btn = document.createElement('button');
    btn.id = 'btn-error-log';
    btn.className = 'btn btn-ghost';
    btn.type = 'button';
    btn.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:99999;background:#fff;border:1px solid #e2e8f0;box-shadow:0 6px 20px rgba(0,0,0,0.12);padding:8px 10px;border-radius:10px;font-size:12px;color:#1a2b45';
    btn.innerHTML = '<i class="fas fa-bug" style="margin-right:6px"></i>오류 로그';
    btn.onclick = () => show();
    document.body.appendChild(btn);
  }
  function show() {
    const list = _load().slice().reverse();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.dataset.dynamic = 'true';
    const items = list.length
      ? list.map(e => `
          <div style="padding:10px 12px;border:1px solid #eef2f7;border-radius:10px;margin-bottom:10px;background:#fff">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
              <div style="font-size:12px;font-weight:700;color:#1a2b45;word-break:break-word">${Utils.escHtml(e.message || 'Unknown error')}</div>
              <div style="font-size:11px;color:#94a3b8;white-space:nowrap">${_fmtTime(e.ts)}</div>
            </div>
            <div style="margin-top:6px;font-size:11.5px;color:#475569;word-break:break-word">
              <div><b>종류</b>: ${Utils.escHtml(e.type || '-')}</div>
              ${e.source ? `<div><b>위치</b>: ${Utils.escHtml(e.source)}${e.lineno ? `:${e.lineno}` : ''}${e.colno ? `:${e.colno}` : ''}</div>` : ''}
              ${e.stack  ? `<div style="margin-top:6px;white-space:pre-wrap;background:#0b1220;color:#e2e8f0;border-radius:8px;padding:10px;font-size:10.5px;line-height:1.35">${Utils.escHtml(e.stack)}</div>` : ''}
            </div>
          </div>
        `).join('')
      : `<div style="padding:18px;text-align:center;color:#64748b;font-size:13px">수집된 오류가 없습니다.</div>`;

    overlay.innerHTML = `
      <div style="width:min(860px,92vw);max-height:min(80vh,720px);overflow:auto;background:#f8fafc;border-radius:14px;border:1px solid #e2e8f0;padding:14px 14px 10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:14px;font-weight:800;color:#1a2b45"><i class="fas fa-bug" style="margin-right:8px;color:#ef4444"></i>오류 로그</div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost" id="errCopy">복사</button>
            <button class="btn btn-ghost" id="errClear">초기화</button>
            <button class="btn btn-primary" id="errClose">닫기</button>
          </div>
        </div>
        <div>${items}</div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#errClose').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#errClear').onclick = () => {
      sessionStorage.removeItem(KEY);
      overlay.remove();
      Toast.success('오류 로그를 초기화했습니다.');
    };
    overlay.querySelector('#errCopy').onclick = async () => {
      try {
        const raw = JSON.stringify(_load(), null, 2);
        await navigator.clipboard.writeText(raw);
        Toast.success('오류 로그를 복사했습니다. (붙여넣기 가능)');
      } catch {
        Toast.warning('복사에 실패했습니다. (브라우저 권한 제한)');
      }
    };
  }

  function install() {
    if (installed) return;
    installed = true;

    window.addEventListener('error', (ev) => {
      try {
        _push({
          ts: Date.now(),
          type: 'error',
          message: ev?.message || String(ev?.error?.message || 'Unknown error'),
          source: ev?.filename || '',
          lineno: ev?.lineno || 0,
          colno: ev?.colno || 0,
          stack: ev?.error?.stack ? String(ev.error.stack).slice(0, 5000) : '',
        });
        Toast.error('화면 오류가 발생했습니다. 우하단 "오류 로그"를 확인하세요.', 6000);
      } catch { /* ignore */ }
    });

    window.addEventListener('unhandledrejection', (ev) => {
      try {
        const reason = ev?.reason;
        const msg = (reason && reason.message) ? reason.message : String(reason || 'Unhandled rejection');
        _push({
          ts: Date.now(),
          type: 'unhandledrejection',
          message: msg,
          source: '',
          lineno: 0,
          colno: 0,
          stack: reason?.stack ? String(reason.stack).slice(0, 5000) : '',
        });
        Toast.error('처리되지 않은 오류가 발생했습니다. 우하단 "오류 로그"를 확인하세요.', 6000);
      } catch { /* ignore */ }
    });
  }

  return { install, show };
})();

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
      pre_approved: { label: '승인대기중',  cls: 'badge-blue'   },
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

  // 직책 라벨
  jobTitleLabel(jobTitle) {
    const key = String(jobTitle || '').trim().toLowerCase();
    if (!key) return '';
    return JOB_TITLE_LABEL[key] || String(jobTitle || '').trim();
  },

  // 역할/직책 배지
  roleBadge(role, jobTitle = '') {
    const titleLabel = this.jobTitleLabel(jobTitle);
    const label = titleLabel || ROLE_LABEL[role] || role;
    return `<span class="badge ${ROLE_COLOR[role] || 'badge-gray'}">${label}</span>`;
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

  // 문서번호 표시용 단축 포맷
  // 저장값: IDYYMMDD####  → 표시값: IDMMDD## (예: ID2604080001 → ID040801)
  formatDocNoShort(docNo) {
    const s = String(docNo || '').trim();
    if (!s) return '';
    const m = s.match(/^ID(\d{2})(\d{2})(\d{2})(\d{4})$/);
    if (!m) return s;
    const mm = m[2];
    const dd = m[3];
    const seq = String(parseInt(m[4], 10) || 0).padStart(2, '0'); // 0001 → 01
    return `ID${mm}${dd}${seq}`;
  },

  // 오늘 날짜 문자열 (YYYY-MM-DD)
  todayStr() {
    const d = new Date();
    return d.toISOString().substring(0,10);
  },

  /** HTML date 입력 허용 범위 (연도 4자리·달력 UI 안정화용 min/max와 동일) */
  DATE_INPUT_MIN: '1900-01-01',
  DATE_INPUT_MAX: '2100-12-31',
  MONTH_INPUT_MIN: '1900-01',
  MONTH_INPUT_MAX: '2100-12',

  /** YYYY-MM-DD 검증·정규화 (불가면 빈 문자열) */
  normalizeISODateString(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y < 1900 || y > 2100) return '';
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  },

  /** YYYY-MM (month input) */
  normalizeISOMonthString(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    const m = s.match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (y < 1900 || y > 2100 || mo < 1 || mo > 12) return '';
    return `${y}-${String(mo).padStart(2, '0')}`;
  },

  /** datetime-local (YYYY-MM-DDTHH:mm) */
  normalizeDatetimeLocalString(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!m) return '';
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    if (y < 1900 || y > 2100) return '';
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return '';
    const dt = new Date(y, mo - 1, d, hh, mm, 0, 0);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
    if (dt.getHours() !== hh || dt.getMinutes() !== mm) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  },

  applyDateInputConstraints(el) {
    if (!el || el.tagName !== 'INPUT') return;
    const t = el.type;
    if (t === 'date') {
      if (!el.getAttribute('min')) el.setAttribute('min', Utils.DATE_INPUT_MIN);
      if (!el.getAttribute('max')) el.setAttribute('max', Utils.DATE_INPUT_MAX);
    } else if (t === 'month') {
      if (!el.getAttribute('min')) el.setAttribute('min', Utils.MONTH_INPUT_MIN);
      if (!el.getAttribute('max')) el.setAttribute('max', Utils.MONTH_INPUT_MAX);
    } else if (t === 'datetime-local') {
      if (!el.getAttribute('min')) el.setAttribute('min', '1900-01-01T00:00');
      if (!el.getAttribute('max')) el.setAttribute('max', '2100-12-31T23:59');
    }
  },

  normalizeDateInputElement(el) {
    if (!el || el.tagName !== 'INPUT') return;
    const t = el.type;
    if (t === 'date') {
      const v = el.value;
      if (!v) return;
      const n = Utils.normalizeISODateString(v);
      if (n !== v) el.value = n;
      if (!n) el.value = '';
      return;
    }
    if (t === 'month') {
      const v = el.value;
      if (!v) return;
      const n = Utils.normalizeISOMonthString(v);
      if (n !== v) el.value = n;
      if (!n) el.value = '';
      return;
    }
    if (t === 'datetime-local') {
      const v = el.value;
      if (!v) return;
      const n = Utils.normalizeDatetimeLocalString(v);
      if (n !== v) el.value = n;
      if (!n) el.value = '';
    }
  },

  /** 전역: 기존·동적 삽입 날짜 필드에 min/max·검증(연도 4자리·유효일) */
  initDateInputControls() {
    const applyAll = (root) => {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('input[type="date"],input[type="month"],input[type="datetime-local"]').forEach((el) => {
        Utils.applyDateInputConstraints(el);
      });
    };
    applyAll(document);

    const mo = new MutationObserver((muts) => {
      for (const rec of muts) {
        rec.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          const tag = node.tagName;
          if (tag === 'INPUT') {
            const t = node.type;
            if (t === 'date' || t === 'month' || t === 'datetime-local') Utils.applyDateInputConstraints(node);
          }
          applyAll(node);
        });
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    const onCommit = (e) => {
      const el = e.target;
      if (!el || el.tagName !== 'INPUT') return;
      if (!['date', 'month', 'datetime-local'].includes(el.type)) return;
      Utils.normalizeDateInputElement(el);
    };
    document.addEventListener('change', onCommit, true);
    document.addEventListener('blur', onCommit, true);
  },
};

// ─────────────────────────────────────────────
// 전역 캐시 (★ TTL 연장: 30초 → 3분, 마스터 데이터는 5분)
// ─────────────────────────────────────────────
/** 동일 id 행이 중복될 때(캐시·API 이중 등) 목록용으로 한 건만 유지 */
function _uniqMasterRowsById(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    if (!row || row.id == null) continue;
    const k = String(row.id);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

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

// deleted 컬럼이 있는 테이블: teams, departments, headquarters, cs_teams
// → JS에서 deleted=true 항목 필터링
const TABLES_WITH_DELETED = new Set(['teams','departments','headquarters','cs_teams']);

const Master = {
  async teams() {
    return Cache.get('teams', async () => {
      try {
        const r = await API.list('teams', { limit: 500 });
        const d = (r && r.data) ? r.data : [];
        return d.filter(x => x.deleted !== true);
      } catch(e) { console.warn('[Master.teams]', e.message); return []; }
    }, MASTER_TTL);
  },
  async clients() {
    return Cache.get('clients', async () => {
      try {
        const r = await API.list('clients', { limit: 500 });
        return (r && r.data) ? r.data : [];
      } catch(e) { console.warn('[Master.clients]', e.message); return []; }
    }, MASTER_TTL);
  },
  async categories() {
    return Cache.get('categories', async () => {
      try {
        const r = await API.list('work_categories', { limit: 200 });
        let rows = _uniqMasterRowsById((r && r.data) ? r.data : []);
        rows.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        const seenName = new Set();
        rows = rows.filter((c) => {
          const nm = String(c.category_name || '').trim();
          if (!nm) return true;
          if (seenName.has(nm)) return false;
          seenName.add(nm);
          return true;
        });
        return rows;
      } catch(e) { console.warn('[Master.categories]', e.message); return []; }
    }, MASTER_TTL);
  },
  async subcategories() {
    return Cache.get('subcategories', async () => {
      try {
        const r = await API.list('work_subcategories', { limit: 500 });
        const rows = _uniqMasterRowsById((r && r.data) ? r.data : []);
        return rows.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      } catch(e) { console.warn('[Master.subcategories]', e.message); return []; }
    }, MASTER_TTL);
  },
  async cases() {
    return Cache.get('cases', async () => {
      try {
        const r = await API.list('cases', { limit: 500 });
        return (r && r.data) ? r.data : [];
      } catch(e) { console.warn('[Master.cases]', e.message); return []; }
    }, MASTER_TTL);
  },
  async users() {
    return Cache.get('users', async () => {
      try {
        const r = await API.list('users', { limit: 500 });
        return (r && r.data) ? r.data : [];
      } catch(e) { console.warn('[Master.users]', e.message); return []; }
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
// ★ 담당자(Staff) 검색형 선택 컴포넌트 (UserSearchSelect)
// - ClientSearchSelect와 동일한 UX
// - 표시/검색: 이름만
// ─────────────────────────────────────────────
const UserSearchSelect = (() => {
  const _state = {}; // wrapperId → { users, selected, onSelect }

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
                onclick="UserSearchSelect._openSearch('${wid}')">
              <span style="font-size:13px;font-weight:500">${Utils.escHtml(val.name)}</span>
              <span style="display:flex;gap:6px;align-items:center">
                <i class="fas fa-exchange-alt" style="color:var(--text-muted);font-size:11px" title="변경"></i>
                <i class="fas fa-times" style="color:var(--text-muted);font-size:12px"
                   onclick="event.stopPropagation();UserSearchSelect.clear('${wid}')" title="초기화"></i>
              </span>
            </div>`
          : `<div class="cs-search-box" style="position:relative">
              <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);
                 color:var(--text-muted);font-size:12px;pointer-events:none"></i>
              <input type="text" class="form-control cs-input-${wid}" id="us-input-${wid}"
                     style="padding-left:30px;font-size:13px"
                     placeholder="${s.placeholder || '담당자 검색/선택'}"
                     oninput="UserSearchSelect._onInput('${wid}', this.value)"
                     onkeydown="UserSearchSelect._onKey(event,'${wid}')"
                     onfocus="UserSearchSelect._showDropdown('${wid}', this.value)"
                     autocomplete="off" />
              <div id="us-dropdown-${wid}" class="cs-dropdown"
                   style="display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;
                          background:#fff;border:1px solid var(--border-light);border-radius:8px;
                          box-shadow:0 4px 20px rgba(0,0,0,0.12);z-index:3000;
                          max-height:220px;overflow-y:auto"></div>
            </div>`
        }
      </div>`;
  }

  function _showDropdown(wid, query) {
    const s = _state[wid];
    if (!s) return;
    const ddEl = document.getElementById(`us-dropdown-${wid}`);
    if (!ddEl) return;
    const q = (query || '').trim().toLowerCase();
    const filtered = q
      ? s.users.filter(u => (u.name || '').toLowerCase().includes(q))
      : s.users;

    if (filtered.length === 0) {
      ddEl.innerHTML = `<div style="padding:10px 14px;color:var(--text-muted);font-size:13px">검색 결과 없음</div>`;
    } else {
      ddEl.innerHTML = filtered.slice(0, 50).map(u => {
        const lbl = u.name || '';
        const hi  = q ? lbl.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'),
                         '<mark style="background:#fef9c3;border-radius:2px;padding:0 1px">$1</mark>') : lbl;
        return `<div class="cs-item" data-id="${u.id}" data-name="${Utils.escHtml(lbl)}"
                     style="padding:9px 14px;cursor:pointer;font-size:13px;
                            border-bottom:1px solid #f1f5f9;transition:background .1s"
                     onmouseover="this.style.background='#f0f7ff'"
                     onmouseout="this.style.background=''"
                     onclick="UserSearchSelect._pick('${wid}','${u.id}','${lbl.replace(/'/g,"\\'")}')">
                  ${hi}
                </div>`;
      }).join('');
    }
    ddEl.style.display = '';
    if (!s._outsideHandler) {
      s._outsideHandler = (e) => {
        const root = document.getElementById(`us-dropdown-${wid}`);
        const inp  = document.getElementById(`us-input-${wid}`);
        if (root && !root.contains(e.target) && e.target !== inp) {
          root.style.display = 'none';
        }
      };
      document.addEventListener('click', s._outsideHandler, true);
    }
  }

  function _onInput(wid, val) { _showDropdown(wid, val); }

  function _onKey(e, wid) {
    const ddEl = document.getElementById(`us-dropdown-${wid}`);
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
      const inp = document.getElementById(`us-input-${wid}`);
      if (inp) { inp.focus(); _showDropdown(wid, ''); }
    }, 50);
  }

  function _pick(wid, id, name) {
    const s = _state[wid];
    if (!s) return;
    s.selected = { id, name };
    if (s._outsideHandler) {
      document.removeEventListener('click', s._outsideHandler, true);
      s._outsideHandler = null;
    }
    _render(wid);
    if (typeof s.onSelect === 'function') s.onSelect(id, name);
  }

  return {
    init(wid, users, opts = {}) {
      if (_state[wid] && _state[wid]._outsideHandler) {
        document.removeEventListener('click', _state[wid]._outsideHandler, true);
      }
      _state[wid] = {
        users: users || [],
        selected: { id: '', name: '' },
        placeholder: opts.placeholder || '담당자 검색/선택',
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
  const session = Session.get();
  if (page === 'dashboard' && session && Auth.isCcbDivision(session)) {
    const projDashAllow = _authCanReadMenuSync(session, 'project-dashboard', _legacyCanReadMenuByPage(session, 'project-dashboard'));
    if (projDashAllow) page = 'project-dashboard';
  }
  if (page === 'entry-new' || page === 'my-entries') {
    const allowStaffRecordsPage = page === 'my-entries' && session && (
      Auth.isTopMgr(session) ||
      Auth.canViewAll(session) ||
      // 정책 캐시 로딩 타이밍 이슈가 있어도 본부장/팀장 기본 권한은 유지
      Auth.canViewDeptScope(session) ||
      _authCanReadMenuSync(session, 'my-entries', false)
    );
    if (session && !Auth.canViewAll(session) && !allowStaffRecordsPage) {
      const prefer = Auth.preferredSheetType(session);
      const hourlyOk = Auth.timesheetHourlyEnabled(session);
      const dailyOk = Auth.timesheetDailyEnabled(session);
      if (page === 'entry-new') {
        if (prefer === 'daily' && dailyOk) page = 'entry-new-daily';
        else if (hourlyOk) page = 'entry-new-hourly';
        else if (dailyOk) page = 'entry-new-daily';
      } else {
        if (prefer === 'daily' && dailyOk) page = 'my-entries-daily';
        else if (hourlyOk) page = 'my-entries-hourly';
        else if (dailyOk) page = 'my-entries-daily';
      }
    }
  }
  if (session) {
    const menuKey = _menuPolicyKeyByPage(page);
    const legacyAllow = _legacyCanReadMenuByPage(session, page);
    const canRead = (menuKey === 'analysis')
      ? _canReadAnalysisEntry(session, legacyAllow)
      : _authCanReadMenuSync(session, menuKey, legacyAllow);
    if (!canRead) {
      Toast.warning('접근 권한이 없습니다.');
      return null;
    }
  }
  const SECTION_ALIAS = {
    'entry-new-hourly': 'entry-new',
    'entry-new-daily': 'entry-new',
    'my-entries-hourly': 'my-entries',
    'my-entries-daily': 'my-entries',
    'project-management': 'project-register',
  };
  const sectionPage = SECTION_ALIAS[page] || page;

  if (page === 'entry-new-hourly' || page === 'entry-new-daily') {
    try {
      sessionStorage.setItem('entry_sheet_type', page === 'entry-new-daily' ? 'daily' : 'hourly');
    } catch (_) {}
  } else if (page === 'my-entries-hourly' || page === 'my-entries-daily') {
    try {
      sessionStorage.setItem('my_entries_sheet_type', page === 'my-entries-daily' ? 'daily' : 'hourly');
    } catch (_) {}
  } else if (page === 'my-entries') {
    try {
      const sess = typeof getSession === 'function' ? getSession() : null;
      if (sess && Auth.canViewAll(sess)) sessionStorage.removeItem('my_entries_sheet_type');
      else sessionStorage.setItem('my_entries_sheet_type', 'hourly');
    } catch (_) {}
  } else if (page === 'entry-new') {
    try { sessionStorage.setItem('entry_sheet_type', 'hourly'); } catch (_) {}
  }

  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const section = document.getElementById(`page-${sectionPage}`);
  if (section) section.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });
  if (!_sidebarSections.length) refreshSidebarSectionCollapse();
  const activeItem = document.querySelector(`.nav-item[data-page="${page}"].active`);
  if (activeItem) {
    const sectionOfItem = _sidebarSections.find((s) => s.items.includes(activeItem));
    if (sectionOfItem) toggleSidebarSection(sectionOfItem.id, true);
    try { activeItem.scrollIntoView({ block: 'nearest' }); } catch (_) {}
  }
  document.querySelector('.sidebar')?.classList.remove('open');
  return page;
}

function toggleSidebar() {
  document.querySelector('.sidebar')?.classList.toggle('open');
}

const SIDEBAR_SECTION_STORAGE_KEY = 'smartlog_sidebar_section_state_v1';
let _sidebarSections = [];

function _getSidebarSectionState() {
  try {
    const raw = localStorage.getItem(SIDEBAR_SECTION_STORAGE_KEY) || '{}';
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function _saveSidebarSectionState(state) {
  try { localStorage.setItem(SIDEBAR_SECTION_STORAGE_KEY, JSON.stringify(state || {})); } catch (_) {}
}

function _sidebarSectionId(titleEl, idx) {
  const base = String(titleEl.id || titleEl.textContent || `section-${idx}`).trim().toLowerCase();
  return base.replace(/[^a-z0-9_-]+/g, '-');
}

function _collectSidebarSections() {
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return [];
  const children = Array.from(nav.children || []);
  const sections = [];
  let current = null;
  children.forEach((el, idx) => {
    if (el.classList && el.classList.contains('nav-section-title')) {
      current = { id: _sidebarSectionId(el, idx), title: el, items: [] };
      sections.push(current);
      return;
    }
    if (current) current.items.push(el);
  });
  return sections;
}

function _applySidebarSectionCollapsed(section, collapsed) {
  if (!section || !section.title) return;
  section.title.classList.add('nav-section-title--collapsible');
  section.title.dataset.collapsed = collapsed ? '1' : '0';
  section.title.setAttribute('role', 'button');
  section.title.tabIndex = 0;
  section.items.forEach((el) => {
    if (!el || !el.classList) return;
    el.classList.toggle('nav-collapsed-item', !!collapsed);
  });
}

function _bindSidebarSectionTitle(section) {
  if (!section || !section.title || section.title.dataset.sectionBound === '1') return;
  const onToggle = () => toggleSidebarSection(section.id);
  section.title.addEventListener('click', onToggle);
  section.title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  });
  section.title.dataset.sectionBound = '1';
}

function refreshSidebarSectionCollapse() {
  _sidebarSections = _collectSidebarSections();
  const state = _getSidebarSectionState();
  _sidebarSections.forEach((section) => {
    _bindSidebarSectionTitle(section);
    _applySidebarSectionCollapsed(section, !!state[section.id]);
  });
}

function toggleSidebarSection(sectionId, forceExpand) {
  if (!_sidebarSections.length) refreshSidebarSectionCollapse();
  const section = _sidebarSections.find((s) => s.id === sectionId);
  if (!section) return;
  const state = _getSidebarSectionState();
  const currentCollapsed = !!state[sectionId];
  const nextCollapsed = forceExpand === true ? false : !currentCollapsed;
  state[sectionId] = nextCollapsed;
  _saveSidebarSectionState(state);
  _applySidebarSectionCollapsed(section, nextCollapsed);
}

// ─────────────────────────────────────────────
// 권한별 메뉴 표시/숨김
// ─────────────────────────────────────────────
/*
  메뉴 노출 기준:
  ┌─────────────────────┬───────┬─────────┬──────────┬───────┐
  │ 메뉴                │ Staff │ Manager │ Director │ Admin │
  ├─────────────────────┼───────┼─────────┼──────────┼───────┤
  │ Dashboard           │   ✅   │    ✅   │    ✅    │   ✅   │
  │ New Entry           │   ✅   │    ❌   │    ❌    │   ❌   │
  │ My Time Sheet       │   ✅   │    ✅*  │    ❌    │   ❌   │
  │ Staff 업무 기록     │   ❌   │    ❌   │    ❌    │   ✅   │
  │ Approval(통합)      │   ❌   │    ✅   │    ✅    │   ❌   │
  │ Analysis            │   ❌   │    ❌   │    ✅    │   ✅   │
  │ Settings            │   ❌   │    ❌   │    ❌    │   ✅   │
  └─────────────────────┴───────┴─────────┴──────────┴───────┘
  * Manager 중 타임시트 대상자만 My Time Sheet · New Entry 노출
  팀 소속 기준:
  - Manager가 승인자(approver_id)로 지정된 Staff들이 해당 Manager의 팀원
  - Staff 등록 시 승인자로 지정된 Manager의 팀이 곧 해당 Staff의 소속팀
*/
function _applyPolicyToMenuVisibility(session) {
  if (!session) return;
  const items = Array.from(document.querySelectorAll('.nav-item[data-page]'));
  const revealedItems = [];
  items.forEach((item) => {
    if (!item) return;
    const wasVisible = item.style.display !== 'none';
    const page = String(item.dataset.page || '').trim();
    if (!page) return;
    const menuKey = _menuPolicyKeyByPage(page);
    if (menuKey === 'analysis') {
      const okAnalysis = _canReadAnalysisEntry(session, _legacyCanReadMenuByPage(session, page));
      item.style.display = okAnalysis ? '' : 'none';
      if (!wasVisible && okAnalysis) revealedItems.push(item);
      return;
    }
    const hit = _permResolveAllow(session, menuKey, 'read');
    if (hit === true) {
      item.style.display = '';
      if (!wasVisible) revealedItems.push(item);
      return;
    }
    if (hit === false) {
      item.style.display = 'none';
      return;
    }
    const fallback = _legacyCanReadMenuByPage(session, page);
    item.style.display = fallback ? '' : 'none';
    if (!wasVisible && fallback) revealedItems.push(item);
  });

  const isVisible = (el) => !!el && el.style.display !== 'none';
  const firstVisible = (selector) => Array.from(document.querySelectorAll(selector)).some((el) => isVisible(el));

  const smartlogLabel = document.getElementById('menu-smartlog-group');
  if (smartlogLabel) {
    const archiveMenu = document.getElementById('menu-archive');
    const deliverablesMenu = document.getElementById('menu-deliverables');
    smartlogLabel.style.display = (isVisible(archiveMenu) || isVisible(deliverablesMenu)) ? '' : 'none';
  }

  const tsSection = document.getElementById('menu-timesheet-section');
  if (tsSection) {
    const hasTsMenus = (
      isVisible(document.getElementById('menu-entry-new-hourly')) ||
      isVisible(document.getElementById('menu-entry-new-daily')) ||
      isVisible(document.getElementById('menu-my-entries-hourly')) ||
      isVisible(document.getElementById('menu-my-entries-daily'))
    );
    tsSection.style.display = hasTsMenus ? '' : 'none';
  }

  const refLabel = document.getElementById('nav-ref-data-ts-label');
  if (refLabel) {
    refLabel.style.display = firstVisible('.nav-item.menu-ref-data') ? '' : 'none';
  }

  const mgmtSection = document.getElementById('menu-management-section');
  if (mgmtSection) {
    const hasMgmtMenus = (
      isVisible(document.getElementById('menu-approval')) ||
      isVisible(document.getElementById('menu-project-management')) ||
      isVisible(document.getElementById('menu-analysis')) ||
      isVisible(document.getElementById('menu-admin-all-entries'))
    );
    mgmtSection.style.display = hasMgmtMenus ? '' : 'none';
  }

  const settingsSection = document.querySelector('.menu-settings-section');
  if (settingsSection) {
    const anySettingsMenuVisible = Array.from(document.querySelectorAll('.nav-item.menu-master')).some((el) => el.style.display !== 'none');
    settingsSection.style.display = anySettingsMenuVisible ? '' : 'none';
  }

  // 대표이사 계정은 타임시트 메뉴를 일일제만 노출(정책 재적용 후에도 유지)
  if (session && Auth.isCeo(session)) {
    const hourlyNew = document.getElementById('menu-entry-new-hourly');
    const hourlyMy = document.getElementById('menu-my-entries-hourly');
    const dailyNew = document.getElementById('menu-entry-new-daily');
    const dailyMy = document.getElementById('menu-my-entries-daily');
    if (hourlyNew) hourlyNew.style.display = 'none';
    if (hourlyMy) hourlyMy.style.display = 'none';
    if (dailyNew) dailyNew.style.display = '';
    if (dailyMy) dailyMy.style.display = '';
  }

  // 권한 변경으로 "새롭게 표시된" 메뉴가 있으면 해당 섹션만 자동 펼침
  // (기존에 사용자가 접어둔 다른 섹션은 유지)
  if (revealedItems.length) {
    if (!_sidebarSections.length) refreshSidebarSectionCollapse();
    const expanded = new Set();
    revealedItems.forEach((item) => {
      const section = _sidebarSections.find((s) => s.items.includes(item));
      if (!section || expanded.has(section.id)) return;
      toggleSidebarSection(section.id, true);
      expanded.add(section.id);
    });
  }
}

function setupMenuByRole(session) {
  const role        = session ? session.role : '';
  if (session && Auth.isAdmin(session)) {
    // 시스템관리자: 기본 메뉴 노출 + 보안 메뉴는 대표이사만 허용
    Array.from(document.querySelectorAll('.nav-item[data-page]')).forEach((el) => {
      el.style.display = '';
    });
    const securedPages = ['project-deliverables'];
    securedPages.forEach((p) => {
      if (_isSecurityMenuDeniedForSystemAdmin(session, p)) {
        const el = document.querySelector(`.nav-item[data-page="${p}"]`);
        if (el) el.style.display = 'none';
      }
    });
    const tsSection = document.getElementById('menu-timesheet-section');
    const refLabel = document.getElementById('nav-ref-data-ts-label');
    const smartlogLabel = document.getElementById('menu-smartlog-group');
    const mgmtSection = document.getElementById('menu-management-section');
    const settingsSection = document.querySelector('.menu-settings-section');
    if (tsSection) tsSection.style.display = '';
    if (refLabel) refLabel.style.display = '';
    if (smartlogLabel) smartlogLabel.style.display = '';
    if (mgmtSection) mgmtSection.style.display = '';
    if (settingsSection) settingsSection.style.display = '';
    _applyPolicyToMenuVisibility(session);
    _loadPermissionPoliciesForSession(session).then(() => {
      _applyPolicyToMenuVisibility(session);
      refreshSidebarSectionCollapse();
    }).catch(() => {});
    _showNoApproverBanner(false);
    refreshSidebarSectionCollapse();
    return;
  }
  const hasApprover = Auth.hasApprover(session);      // staff에서 승인자 지정 여부
  const isStaffWithApprover  = Auth.isStaff(session) && hasApprover;
  const isStaffTimesheetTarget = Auth.isStaff(session) && (
    Auth.preferredSheetType(session) === 'daily' || session.is_timesheet_target !== false
  );
  const isStaffNoApprover    = Auth.isStaff(session) && !hasApprover;
  const canApprove           = Auth.canApprove(session);        // manager
  const canViewDeptScope     = Auth.canViewDeptScope(session);  // manager+director+admin
  const canViewAll           = Auth.canViewAll(session);        // admin only
  const canViewStaffRecords  = canViewAll || Auth.isTopMgr(session);
  const canViewDashboardMenu = Auth.canViewDashboardMenu(session);
  const isCcbDivision        = Auth.isCcbDivision(session);
  const canAnalysis          = Auth.canViewAnalysis(session);   // director+top_mgr+admin
  const isMaster             = Auth.canManageMaster(session);   // admin only
  const canProjectReg        = Auth.canManageProjectRegister(session);
  const canRefData           = Auth.canManageRefData(session);
  const canRequestClient     = Auth.canRequestClient(session);
  const isTopMgr             = Auth.isTopMgr(session);

  // ── Time Sheet 섹션 ────────────────────────────────────────
  const isManagerTimesheetTarget = Auth.isManager(session) && (
    Auth.preferredSheetType(session) === 'daily' || session.is_timesheet_target !== false
  );
  const isDirectorTimesheetTarget = Auth.isDirector(session)
    && session.is_timesheet_target !== false
    && Auth.preferredSheetType(session) === 'daily';
  const baseTs = (isStaffWithApprover && isStaffTimesheetTarget) || isManagerTimesheetTarget || isDirectorTimesheetTarget;
  const hourlyOk = Auth.timesheetHourlyEnabled(session);
  const dailyOk = Auth.timesheetDailyEnabled(session);
  const preferredSheet = Auth.preferredSheetType(session);
  const showTS = baseTs && (hourlyOk || dailyOk);
  const tsSection = document.getElementById('menu-timesheet-section');
  /* Time Sheet 블록: 본인 시트 메뉴 또는 기준정보(고객사·분류·프로젝트 등록) 권한이 있으면 표시 */
  if (tsSection) tsSection.style.display = (showTS || canRefData || canProjectReg) ? '' : 'none';
  const mHourlyNew = document.getElementById('menu-entry-new-hourly');
  const mDailyNew = document.getElementById('menu-entry-new-daily');
  const mHourlyMy = document.getElementById('menu-my-entries-hourly');
  const mDailyMy = document.getElementById('menu-my-entries-daily');
  let showHourlyMenu = showTS && hourlyOk;
  let showDailyMenu = showTS && dailyOk;
  if (showTS) {
    if (preferredSheet === 'daily' && dailyOk) showHourlyMenu = false;
    if (preferredSheet === 'hourly' && hourlyOk) showDailyMenu = false;
  }
  if (mHourlyNew) mHourlyNew.style.display = showHourlyMenu ? '' : 'none';
  if (mDailyNew) mDailyNew.style.display = showDailyMenu ? '' : 'none';
  if (mHourlyMy) mHourlyMy.style.display = showHourlyMenu ? '' : 'none';
  if (mDailyMy) mDailyMy.style.display = showDailyMenu ? '' : 'none';

  const delivMenu = document.getElementById('menu-deliverables');
  if (delivMenu) delivMenu.style.display = session ? '' : 'none';
  const timelogDashMenu = document.querySelector('.nav-item[data-page="dashboard"]');
  if (timelogDashMenu) timelogDashMenu.style.display = (canViewDashboardMenu && !isCcbDivision) ? '' : 'none';
  const projectDashMenu = document.getElementById('menu-project-dashboard');
  if (projectDashMenu) projectDashMenu.style.display = canViewDashboardMenu ? '' : 'none';

  // ── Management 섹션 타이틀 ─────────────────────────────────
  const mgmtSection = document.getElementById('menu-management-section');
  const showMgmt = canApprove || canViewDeptScope || canProjectReg;
  if (mgmtSection) mgmtSection.style.display = showMgmt ? '' : 'none';

  // ── Approval: manager + director / Admin은 Staff 업무 기록으로 조회 ────
  const approvalMenu = document.getElementById('menu-approval');
  if (approvalMenu) {
    approvalMenu.style.display = (canApprove || canViewDeptScope) && !canViewAll ? '' : 'none';
  }
  const adminAllEntries = document.getElementById('menu-admin-all-entries');
  // top_mgr는 Settings를 제외한 운영 메뉴를 모두 보이도록 Staff 업무 기록 메뉴를 허용
  if (adminAllEntries) adminAllEntries.style.display = canViewStaffRecords ? '' : 'none';

  // ── Analysis: director + admin ────────────────────────────
  const analysisMenu = document.getElementById('menu-analysis');
  if (analysisMenu) analysisMenu.style.display = canAnalysis ? '' : 'none';
  const projectMgmtMenu = document.getElementById('menu-project-management');
  if (projectMgmtMenu) projectMgmtMenu.style.display = canProjectReg ? '' : 'none';
  _refreshProjectMgmtMenuVisibility(session, canProjectReg);

  // ── 자문 자료실: 모든 역할 접근 허용 ─────────────────────
  const archiveMenu = document.getElementById('menu-archive');
  if (archiveMenu) archiveMenu.style.display = '';

  // ── Settings: admin 전체 / top_mgr는 조직구성(사업부·본부/업무팀/고객지원팀) + 프로젝트 Code만 노출 ──
  const masterMenus = document.querySelectorAll('.menu-master');
  masterMenus.forEach((m) => {
    if (isMaster) {
      m.style.display = '';
      return;
    }
    if (!isTopMgr) {
      m.style.display = 'none';
      return;
    }
    const page = String((m.dataset && m.dataset.page) || '');
    // top_mgr는 정책에서 허용된 Settings 메뉴만 노출
    // 그룹 라벨(무페이지)은 하위 노출 상태에 따라 재계산되므로 여기서 기본 숨김
    if (!page) {
      m.style.display = 'none';
      return;
    }
    if (page === 'users' || page === 'permission-management') {
      m.style.display = 'none';
      return;
    }
    const allowByPolicy = _authCanReadMenuSync(session, _menuPolicyKeyByPage(page), false);
    m.style.display = allowByPolicy ? '' : 'none';
  });

  // ── 등록정보 (Time Sheet 아래): 고객등록 / 업무분류등록 / 프로젝트 등록 ─────
  // 업무분류등록: admin 전용
  const canCategoryReg = Auth.isAdmin(session);
  const refLabel = document.getElementById('nav-ref-data-ts-label');
  const clientsMenu = document.querySelector('.nav-item[data-page="master-clients"]');
  const categoriesMenu = document.querySelector('.nav-item[data-page="master-categories"]');
  const projectRegMenu = document.getElementById('menu-project-register-ref');
  if (clientsMenu) clientsMenu.style.display = (canRefData || canRequestClient) ? '' : 'none';
  if (categoriesMenu) categoriesMenu.style.display = canCategoryReg ? '' : 'none';
  if (projectRegMenu) projectRegMenu.style.display = canProjectReg ? '' : 'none';
  if (refLabel) refLabel.style.display = (canRefData || canRequestClient || canCategoryReg || canProjectReg) ? '' : 'none';

  // ── Settings 섹션 타이틀: 조직·직원·프로젝트 코드 마스터(admin) ───
  const settingsSection = document.querySelector('.menu-settings-section');
  if (settingsSection) {
    const anySettingsVisible = Array.from(document.querySelectorAll('.nav-item.menu-master[data-page]')).some((el) => el.style.display !== 'none');
    settingsSection.style.display = anySettingsVisible ? '' : 'none';
  }

  // 정책 캐시 기반 즉시 반영 + 비동기 최신화
  _applyPolicyToMenuVisibility(session);
  _loadPermissionPoliciesForSession(session).then(() => {
    _applyPolicyToMenuVisibility(session);
    refreshSidebarSectionCollapse();
  }).catch(() => {});

  // ── 승인자 없는 staff 안내 배너 표시 ──────────────────────
  _showNoApproverBanner(isStaffNoApprover);
  refreshSidebarSectionCollapse();
}

async function _refreshProjectMgmtMenuVisibility(session, canProjectReg) {
  const projectMgmtMenu = document.getElementById('menu-project-management');
  if (!projectMgmtMenu) return;
  const menuKey = _menuPolicyKeyByPage('project-management');
  const legacyAllow = _legacyCanReadMenuByPage(session, 'project-management');
  if (!_authCanReadMenuSync(session, menuKey, legacyAllow)) {
    projectMgmtMenu.style.display = 'none';
    return;
  }
  if (!canProjectReg || !session) {
    projectMgmtMenu.style.display = 'none';
    return;
  }
  if (Auth.isAdmin(session) || Auth.isTopMgr(session)) {
    projectMgmtMenu.style.display = '';
    return;
  }
  // 경영지원 본부/팀 소속자는 프로젝트 생성/승인 이력과 무관하게
  // 세금계산서/정산 운영 기능 접근을 위해 프로젝트관리 메뉴 노출
  const isFinanceHqOrTeam = Auth.isFinanceSupport(session);
  if (isFinanceHqOrTeam) {
    projectMgmtMenu.style.display = '';
    return;
  }
  try {
    const myIds = new Set([
      String(session.id || '').trim(),
      String(session.user_id || '').trim(),
    ].filter(Boolean));
    if (!myIds.size) {
      projectMgmtMenu.style.display = 'none';
      return;
    }
    const rows = await API.listAllPages('registered_projects', { limit: 300, maxPages: 20, sort: 'updated_at' });
    const hasScopedProject = (rows || []).some((r) => {
      if (!String(r.project_code || '').trim()) return false;
      const refs = [
        String(r.created_by || '').trim(),
        String(r.first_approved_by || '').trim(),
        String(r.second_approved_by || '').trim(),
        String(r.final_approved_by || '').trim(),
      ].filter(Boolean);
      return refs.some((id) => myIds.has(id));
    });
    projectMgmtMenu.style.display = hasScopedProject ? '' : 'none';
  } catch (e) {
    console.warn('[menu] project management scope check failed', e);
    projectMgmtMenu.style.display = canProjectReg ? '' : 'none';
  }
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
let _approvalBadgeReqSeq = 0;

function _isApprovalPageActive() {
  const page = document.getElementById('page-approval');
  if (!page) return false;
  return page.style.display !== 'none';
}

function _applyApprovalBadgeFromSplit(split) {
  const s = split || {};
  const ts = Number(s.timesheet) || 0;
  const pj = Number(s.project) || 0;
  const total = ts + pj;
  window.__approvalBadgeSplit = { timesheet: ts, project: pj, total };
  const badge = document.getElementById('approval-badge');
  if (badge) {
    badge.textContent = String(total);
    badge.style.display = total > 0 ? '' : 'none';
  }
}
function _badgeNormLooseName(v) {
  let s = String(v || '').toLowerCase();
  s = s.replace(/\([^)]*\)/g, '');
  s = s.replace(/[^0-9a-z가-힣]/g, '');
  s = s.replace(/(staff|manager|director|topmgr|top_mgr|cpm)$/g, '');
  s = s.replace(/(사원|대리|과장|차장|부장|팀장|실장|본부장|사업부장|이사|상무|전무|부사장|사장)$/g, '');
  return s.trim();
}
function _badgeLooseNameMatch(a, b) {
  const x = _badgeNormLooseName(a);
  const y = _badgeNormLooseName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 3 && y.includes(x)) return true;
  if (y.length >= 3 && x.includes(y)) return true;
  return false;
}
function _projRegPendingStepForBadge(row) {
  const st = String((row && row.registration_status) || '').trim().toLowerCase();
  if (st !== 'pending') return null;
  const raw = [
    String((row && row.reg_pa1_id) || '').trim(),
    String((row && row.reg_pa2_id) || '').trim(),
    String((row && row.reg_pa3_id) || '').trim(),
  ].filter(Boolean);
  const chain = [];
  raw.forEach((id) => {
    if (!chain.includes(id)) chain.push(id);
  });
  const cnt = chain.length;
  if (!cnt) return null;
  if (!row.first_approved_at) return 1;
  if (cnt >= 3) {
    if (!row.second_approved_at) return 2;
    if (!row.final_approved_at) return 3;
    return null;
  }
  if (cnt >= 2 && !row.final_approved_at) return 2;
  return null;
}

function _projRegCanApproveForBadge(session, row) {
  if (!session || !row) return false;
  if (Auth.isAdmin(session)) return String((row.registration_status || '')).toLowerCase() === 'pending';
  const step = _projRegPendingStepForBadge(row);
  if (!step) return false;
  const sid = String(session.id || '');
  const raw = [
    String((row && row.reg_pa1_id) || '').trim(),
    String((row && row.reg_pa2_id) || '').trim(),
    String((row && row.reg_pa3_id) || '').trim(),
  ].filter(Boolean);
  const chain = [];
  raw.forEach((id) => {
    if (!chain.includes(id)) chain.push(id);
  });
  const target = String(chain[step - 1] || '');
  if (target && sid === target) return true;
  const cnt = chain.length;
  const targetName = step === 1
    ? String((row && row.reg_pa1_name) || '').trim()
    : (step === 2
      ? String((cnt >= 3 ? row?.reg_pa2_name : row?.reg_pa3_name) || '').trim()
      : String((row && row.reg_pa3_name) || '').trim());
  const myName = String((session && session.name) || '').trim();
  if (targetName && myName && _badgeLooseNameMatch(targetName, myName)) return true;
  return false;
}

async function _countProjectApprovalBadge(session, force = false) {
  if (!session || !session.id) return 0;
  let rows = [];
  const cacheKey = 'registered_projects_badge_pending_' + session.id;
  try {
    if (force) Cache.invalidate(cacheKey);
    rows = await Cache.get(cacheKey, async () => (
      API.listAllPages('registered_projects', {
        filter: 'registration_status=eq.pending',
        limit: 300,
        maxPages: 20,
        sort: 'created_at',
      })
    ), 120000);
  } catch (_) {
    rows = [];
  }
  if (!Array.isArray(rows) || !rows.length) return 0;

  if (Auth.canViewAll(session)) {
    return rows.filter((r) => _projRegCanApproveForBadge(session, r)).length;
  }

  let users = [];
  try {
    users = await Master.users();
  } catch (_) {
    users = [];
  }
  const byId = new Map((users || []).map((u) => [String(u.id || ''), u]));
  const myId = String(session.id || '');
  const myName = String(session.name || '');
  const scopeUserIds = new Set(
    (users || [])
      .filter((u) => Auth.scopeMatch(session, u))
      .map((u) => String(u.id || ''))
      .filter(Boolean)
  );
  const scoped = rows.filter((r) => {
    const creatorId = String((r && r.created_by) || '');
    const inScopeByCreator = !!creatorId && (creatorId === myId || scopeUserIds.has(creatorId));
    if (Auth.isTopMgr(session)) {
      // Approval 화면 정책과 동일: 사업부장은 "내 스코프 등록자" 건만 카운트
      return inScopeByCreator;
    }
    if (!creatorId) {
      const pa1 = String((r && r.reg_pa1_id) || '');
      const pa2 = String((r && r.reg_pa2_id) || '');
      const pa3 = String((r && r.reg_pa3_id) || '');
      return pa1 === myId || pa2 === myId || pa3 === myId;
    }
    if (_badgeLooseNameMatch((r && r.reg_pa1_name) || '', myName)) return true;
    if (_badgeLooseNameMatch((r && r.reg_pa2_name) || '', myName)) return true;
    if (_badgeLooseNameMatch((r && r.reg_pa3_name) || '', myName)) return true;
    if (inScopeByCreator) return true;
    const creator = byId.get(creatorId);
    if (!creator) return false;
    return Auth.scopeMatch(session, creator);
  });
  return scoped.filter((r) => _projRegCanApproveForBadge(session, r)).length;
}

async function updateApprovalBadge(session, force = false) {
  const _isPendingApproval = (e) => {
    const st = String((e && e.status) || '').trim().toLowerCase();
    return st === 'submitted' || st === 'pre_approved';
  };
  const _normName = (v) => String(v || '').toLowerCase().replace(/\s+/g, '').trim();

  // admin: 전사 1차(submitted)·2차(pre_approved) 건수 — 별도 배지
  if (Auth.isAdmin(session)) {
    const now = Date.now();
    if (!force && now - _badgeLastUpdated < 30000) return;
    _badgeLastUpdated = now;
    try {
      if (force) {
        Cache.invalidate('time_entries_badge_admin_sub');
        Cache.invalidate('time_entries_badge_admin_pre');
      }
      const [submittedRows, preRows] = await Promise.all([
        Cache.get('time_entries_badge_admin_sub', async () => API.listAllPages('time_entries', { filter: 'status=eq.submitted', limit: 300, maxPages: 40 }), 120000),
        Cache.get('time_entries_badge_admin_pre', async () => API.listAllPages('time_entries', { filter: 'status=eq.pre_approved', limit: 300, maxPages: 40 }), 120000),
      ]);
      const c1 = (submittedRows || []).length;
      const c2 = (preRows || []).length;
      const tsCount = c1 + c2;
      const pjCount = await _countProjectApprovalBadge(session, force);
      _applyApprovalBadgeFromSplit({ timesheet: tsCount, project: pjCount });
      const b1 = document.getElementById('approval-badge-1st');
      const b2 = document.getElementById('approval-badge-2nd');
      if (b1) {
        b1.textContent = c1;
        b1.style.display = c1 > 0 ? '' : 'none';
      }
      if (b2) {
        b2.textContent = c2;
        b2.style.display = c2 > 0 ? '' : 'none';
      }
    } catch {}
    return;
  }

  // manager/director/top_mgr 대상 통합 Approval 배지
  if (!(Auth.canApprove1st(session) || Auth.canApprove2nd(session) || Auth.isTopMgr(session))) return;
  // Approval 화면에서는 목록 로직이 계산한 split 값을 단일 기준으로 사용
  // (비동기 재계산 레이스로 탭/메뉴 숫자가 흔들리는 문제 방지)
  if (_isApprovalPageActive() && window.__approvalBadgeSplit) {
    _applyApprovalBadgeFromSplit(window.__approvalBadgeSplit);
    return;
  }
  const now = Date.now();
  if (!force && now - _badgeLastUpdated < 30000) return;
  _badgeLastUpdated = now;
  const reqSeq = ++_approvalBadgeReqSeq;
  try {
    const sid = encodeURIComponent(String(session.id));
    const tsCacheKey = 'time_entries_badge_' + session.id;
    if (force) Cache.invalidate(tsCacheKey);
    const r = await Cache.get(tsCacheKey, async () => {
      if (Auth.canApprove1st(session)) {
        try {
          const rows = await API.listAllPages('time_entries', {
            filter: `or=(approver_id.eq.${sid},pre_approver_id.eq.${sid})`,
            limit: 400,
            maxPages: 50,
          });
          return { data: rows };
        } catch (e) {
          console.warn('[badge] approver or 필터 실패, 폴백', e);
          return API.list('time_entries', { limit: 2000, sort: 'updated_at' });
        }
      }
      return { data: await API.listAllPages('time_entries', { limit: 400, maxPages: 60, sort: 'updated_at' }) };
    }, 120000);
    if (r && r.data) {
      let tsCount = 0;
      if (Auth.canApprove1st(session)) {
        tsCount = r.data.filter(e =>
          e.status === 'submitted' && String(e.approver_id) === String(session.id)
        ).length;
      } else if (Auth.canApprove2nd(session)) {
        const myId = String((session && session.id) || '');
        const myNameNorm = _normName((session && session.name) || '');
        tsCount = r.data.filter((e) => {
          if (!_isPendingApproval(e)) return false;
          if (String((e && e.reviewer2_id) || '') === myId) return true;
          if (String((e && e.approver_id) || '') === myId) return true;
          if (_normName(e && e.reviewer2_name) === myNameNorm) return true;
          if (_normName(e && e.approver_name) === myNameNorm) return true;
          return false;
        }).length;
      } else {
        tsCount = 0;
      }
      const pjCount = await _countProjectApprovalBadge(session, force);
      const count = tsCount + pjCount;
      if (reqSeq !== _approvalBadgeReqSeq) return;
      window.__approvalBadgeSplit = { timesheet: tsCount, project: pjCount, total: count };
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
// ★ GlobalBusy — 전 화면 “작업 중” 오버레이 유틸
// ─────────────────────────────────────────────
/*
  사용법:
    const done = GlobalBusy.show('저장 중...');
    try { await doWork(); } finally { done(); }

  또는:
    await GlobalBusy.run(() => doWork(), '삭제 중...');
*/
const GlobalBusy = (() => {
  let depth = 0;
  let overlayEl = null;
  let textEl = null;

  function _getEls() {
    if (!overlayEl) overlayEl = document.getElementById('globalBusyOverlay');
    if (!textEl) textEl = document.getElementById('globalBusyText');
    return { overlayEl, textEl };
  }

  function show(message = '처리 중...') {
    const els = _getEls();
    depth += 1;
    if (!els.overlayEl) return () => hide();

    if (els.textEl) els.textEl.textContent = String(message || '처리 중...');
    els.overlayEl.classList.add('show');
    els.overlayEl.setAttribute('aria-hidden', 'false');
    document.body.setAttribute('aria-busy', 'true');

    return function done() { hide(); };
  }

  function hide() {
    const els = _getEls();
    depth = Math.max(0, depth - 1);
    if (depth > 0) return;
    if (!els.overlayEl) return;

    els.overlayEl.classList.remove('show');
    els.overlayEl.setAttribute('aria-hidden', 'true');
    document.body.removeAttribute('aria-busy');
  }

  async function run(fn, message = '처리 중...') {
    const done = show(message);
    try { return await fn(); } finally { done(); }
  }

  return { show, hide, run };
})();

// ─────────────────────────────────────────────
// ★ 1회성 마이그레이션: 하두식/박주경/안만복 role → admin
//   admin 계정으로 로그인 후 브라우저 콘솔에서:
//   migrateDirectorsToAdmin() 실행
// ─────────────────────────────────────────────
(function _bootDateInputControls() {
  function run() {
    try {
      if (typeof Utils !== 'undefined' && Utils.initDateInputControls) Utils.initDateInputControls();
    } catch (e) {
      console.warn('[date-inputs] init failed', e);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

(function _bootSidebarSectionCollapse() {
  function run() {
    try { refreshSidebarSectionCollapse(); } catch (e) { console.warn('[sidebar] section collapse init failed', e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

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
