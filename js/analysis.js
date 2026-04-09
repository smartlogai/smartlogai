/* ============================================
   analysis.js — 업무 분석 + 고과 분석 + 인건비 분석
   ============================================ */

let _analysisCharts = {};
let _currentAnalysisTab = 'work'; // 'work' | 'staff' | 'labor'

// ─────────────────────────────────────────────
// 서브탭 전환 (3탭)
// ─────────────────────────────────────────────
function switchAnalysisTab(tab) {
  const session = getSession();

  // 인건비 탭 권한 체크: director/admin만 허용
  if (tab === 'labor') {
    const canLaborTab = session && (session.role === 'director' || session.role === 'admin');
    if (!canLaborTab) {
      Toast.warning('인건비 분석 탭은 원장·관리자만 접근 가능합니다.');
      return;
    }
  }

  _currentAnalysisTab = tab;

  // 탭 버튼 요소
  const tabs = {
    work:  document.getElementById('analysis-tab-work'),
    staff: document.getElementById('analysis-tab-staff'),
    labor: document.getElementById('analysis-tab-labor'),
  };
  // 패널 요소
  const panels = {
    work:  document.getElementById('analysis-panel-work'),
    staff: document.getElementById('analysis-panel-staff'),
    labor: document.getElementById('analysis-panel-labor'),
  };

  // 모든 탭 비활성화
  Object.entries(tabs).forEach(([key, el]) => {
    if (!el) return;
    el.style.color        = key === tab ? 'var(--primary)'       : 'var(--text-secondary)';
    el.style.borderBottom = key === tab ? '2px solid var(--primary)' : '2px solid transparent';
  });
  // 모든 패널 숨김
  Object.entries(panels).forEach(([key, el]) => {
    if (!el) return;
    el.style.display = key === tab ? '' : 'none';
  });

  // 탭별 데이터 로드 (버튼 클릭 전환 시)
  if (tab === 'labor') _initLaborTab();
  if (tab === 'staff') loadStaffAnalysis();
}

// ─────────────────────────────────────────────
// 분석 페이지 초기화
// ─────────────────────────────────────────────
async function init_analysis() {
  const session = getSession();
  if (!Auth.canViewAnalysis(session)) {
    navigateTo('dashboard');
    Toast.warning('분석 열람 권한이 없습니다.');
    return;
  }

  // ── 인건비 탭: director/admin만 표시 ──────────────────────
  const canLaborTab = session && (session.role === 'director' || session.role === 'admin');
  const tabLaborBtn = document.getElementById('analysis-tab-labor');
  if (tabLaborBtn) tabLaborBtn.style.display = canLaborTab ? '' : 'none';

  // manager인데 labor 탭으로 설정돼 있으면 work로 초기화
  if (!canLaborTab && _currentAnalysisTab === 'labor') {
    _currentAnalysisTab = 'work';
  }

  // ── 공통 날짜 초기값 (이번 달 1일~말일) ──────────────────
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const firstDay = `${y}-${String(mo+1).padStart(2,'0')}-01`;
  const lastDay  = `${y}-${String(mo+1).padStart(2,'0')}-${String(new Date(y,mo+1,0).getDate()).padStart(2,'0')}`;

  ['filter-analysis-date-from','filter-staff-date-from'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = firstDay;
  });
  ['filter-analysis-date-to','filter-staff-date-to'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = lastDay;
  });

  // ── 마스터 데이터 로드 ★ Master 캐시 활용 (중복 API 호출 제거) ──────────
  const [teams, clients, allUsers, deptRes, csTeamRes] = await Promise.all([
    Master.teams(),
    Master.clients(),
    Master.users(),   // ★ API.list 직접 호출 → Master.users() 캐시로 교체
    Cache.get('departments', async () => {
      const r = await API.list('departments', { limit: 200 }).catch(() => ({ data: [] }));
      return (r && r.data) ? r.data : [];
    }, 300000),
    Cache.get('cs_teams_list', async () => {
      const r = await API.list('cs_teams', { limit: 200 }).catch(() => ({ data: [] }));
      return (r && r.data) ? r.data : [];
    }, 300000),
  ]);
  const deptList   = Array.isArray(deptRes)   ? deptRes   : [];
  const csTeamList = Array.isArray(csTeamRes) ? csTeamRes : [];

  // 매니저 목록 (승인자 드롭다운용)
  const managers = allUsers.filter(u => u.role === 'manager' || u.role === 'director' || u.role === 'admin');

  // ── 사업부/고객지원팀 드롭다운 공통 빌더 ──────────────────
  function _fillDept(elId, includeAll) {
    const el = document.getElementById(elId); if (!el) return;
    el.innerHTML = `<option value="">전체 사업부</option>`;
    // departments 테이블에 데이터 없으면 users의 department 필드로 수집
    const names = deptList.length > 0
      ? deptList.map(d => d.department_name || d.name).filter(Boolean)
      : [...new Set(allUsers.map(u => u.department).filter(Boolean))].sort();
    names.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n; opt.textContent = n;
      el.appendChild(opt);
    });
  }
  function _fillCsTeam(elId, deptValue) {
    const el = document.getElementById(elId); if (!el) return;
    el.innerHTML = `<option value="">전체 팀</option>`;
    let names;
    if (csTeamList.length > 0) {
      names = csTeamList
        .filter(t => !deptValue || t.department_name === deptValue || t.department === deptValue)
        .map(t => t.cs_team_name || t.name).filter(Boolean);
    } else {
      names = [...new Set(
        allUsers.filter(u => !deptValue || u.department === deptValue)
          .map(u => u.cs_team_name).filter(Boolean)
      )].sort();
    }
    names.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n; opt.textContent = n;
      el.appendChild(opt);
    });
  }
  function _fillApprovers(elId, deptValue, csTeamValue) {
    const el = document.getElementById(elId); if (!el) return;
    el.innerHTML = `<option value="">전체 승인자</option>`;
    managers
      .filter(u => (!deptValue  || u.department   === deptValue)
               && (!csTeamValue || u.cs_team_name === csTeamValue))
      .forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id; opt.textContent = u.name;
        el.appendChild(opt);
      });
  }

  // ── 업무분석 필터 세팅 ───────────────────────────────────
  _fillDept('filter-analysis-department');
  _fillCsTeam('filter-analysis-csteam');
  _fillApprovers('filter-analysis-approver');

  const clientEl = document.getElementById('filter-analysis-client');
  if (clientEl) {
    clientEl.innerHTML = '<option value="">전체 고객사</option>';
    clients.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.company_name;
      clientEl.appendChild(opt);
    });
  }

  // 대분류 드롭다운 — time_entries에서 동적 수집
  await _loadCategoryFilters();

  // ── 고과분석 필터 세팅 ───────────────────────────────────
  _fillDept('filter-staff-department');
  _fillCsTeam('filter-staff-csteam');
  _fillApprovers('filter-staff-approver');

  // ── 현재 탭으로 전환 — switchAnalysisTab 내부에서 탭별 데이터 로드 실행됨 ──
  switchAnalysisTab(_currentAnalysisTab);
  // work 탭은 switchAnalysisTab에서 자동 호출하지 않으므로 여기서 직접 호출
  if (_currentAnalysisTab === 'work') await loadAnalysis();

  // ── 전역에 헬퍼 저장 (사업부 변경 시 재사용) ────────────
  window._analysisFillCsTeam  = _fillCsTeam;
  window._analysisFillApprovers = _fillApprovers;
  window._analysisAllUsers    = allUsers;
}

// ─────────────────────────────────────────────
// 대분류 / 소분류 드롭다운 동적 로드
// ─────────────────────────────────────────────
let _categoryMap = {}; // { 대분류명: Set(소분류명) }

async function _loadCategoryFilters() {
  try {
    // ★ 대시보드 캐시 재사용 (Master 캐시와 공유)
    const entries = await Cache.get('dash_time_entries', async () => {
      const r = await API.list('time_entries', { limit: 2000 });
      return (r && r.data) ? r.data : [];
    }, 180000);
    _categoryMap = {};
    entries.forEach(e => {
      const cat = e.work_category_name || '미분류';
      const sub = e.work_subcategory_name || '';
      if (!_categoryMap[cat]) _categoryMap[cat] = new Set();
      if (sub) _categoryMap[cat].add(sub);
    });

    const catEl = document.getElementById('filter-analysis-category');
    if (!catEl) return;
    catEl.innerHTML = '<option value="">전체 대분류</option>';
    Object.keys(_categoryMap).sort().forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat; opt.textContent = cat;
      catEl.appendChild(opt);
    });
  } catch(e) { console.error('category filter load error', e); }
}

// 대분류 변경 시 소분류 연동
function onAnalysisCategoryChange() {
  const cat    = document.getElementById('filter-analysis-category').value;
  const subEl  = document.getElementById('filter-analysis-subcategory');
  subEl.innerHTML = '<option value="">전체 소분류</option>';
  if (cat && _categoryMap[cat]) {
    [..._categoryMap[cat]].sort().forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub; opt.textContent = sub;
      subEl.appendChild(opt);
    });
  }
}

// 사업부 변경 시 고객지원팀·승인자 연동 (업무분석)
function onAnalysisDepartmentChange() {
  const dept = document.getElementById('filter-analysis-department').value;
  if (window._analysisFillCsTeam) window._analysisFillCsTeam('filter-analysis-csteam', dept);
  if (window._analysisFillApprovers) window._analysisFillApprovers('filter-analysis-approver', dept, '');
}

// 사업부 변경 시 고객지원팀·승인자 연동 (고과분석)
function onStaffDepartmentChange() {
  const dept = document.getElementById('filter-staff-department').value;
  if (window._analysisFillCsTeam) window._analysisFillCsTeam('filter-staff-csteam', dept);
  if (window._analysisFillApprovers) window._analysisFillApprovers('filter-staff-approver', dept, '');
}

// ══════════════════════════════════════════════
//  서브탭1: 업무 분석 (기존)
// ══════════════════════════════════════════════

async function loadAnalysis() {
  const session = getSession();
  const dateFrom      = document.getElementById('filter-analysis-date-from').value;
  const dateTo        = document.getElementById('filter-analysis-date-to').value;
  const deptFilter    = (document.getElementById('filter-analysis-department') || {}).value || '';
  const csTeamFilter  = (document.getElementById('filter-analysis-csteam')    || {}).value || '';
  const approverFilter= (document.getElementById('filter-analysis-approver')  || {}).value || '';
  const clientFilter  = (document.getElementById('filter-analysis-client')    || {}).value || '';
  const catFilter     = (document.getElementById('filter-analysis-category')  || {}).value || '';
  const subFilter     = (document.getElementById('filter-analysis-subcategory')|| {}).value || '';

  try {
    // ★ 캐시된 time_entries 재사용
    let entries = await Cache.get('dash_time_entries', async () => {
      const r = await API.list('time_entries', { limit: 2000 });
      return (r && r.data) ? r.data : [];
    }, 180000);

    // 역할별 범위 제한
    if (session.role === 'staff') {
      entries = entries.filter(e => e.user_id === session.id);
    } else if (session.role === 'manager') {
      entries = entries.filter(e => e.approver_id === session.id);
    } else if (Auth.isDirector(session)) {
      // director: 소속 사업부/본부/고객지원팀 범위만 열람
      const scopeUsers = (window._analysisAllUsers || await Master.users());
      const scopeIds = new Set(scopeUsers.filter(u => Auth.scopeMatch(session, u)).map(u => u.id));
      entries = entries.filter(e => scopeIds.has(e.user_id));
    }
    // admin: 열람 제한 없음
    entries = entries.filter(e => e.status === 'approved');

    // 기간 필터
    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : 0;
      const to   = dateTo   ? new Date(dateTo   + 'T23:59:59').getTime() : Infinity;
      entries = entries.filter(e => {
        if (!e.work_start_at) return false;
        const ts = Number(e.work_start_at);
        return ts >= from && ts <= to;
      });
    }

    // 사업부 필터: 담당자(user)의 department 필드로 필터
    if (deptFilter) {
      const allUsers = window._analysisAllUsers || [];
      const userIdsInDept = new Set(allUsers.filter(u => u.department === deptFilter).map(u => u.id));
      entries = entries.filter(e => userIdsInDept.has(e.user_id));
    }
    // 고객지원팀 필터: 담당자의 cs_team_name 필드로 필터
    if (csTeamFilter) {
      const allUsers = window._analysisAllUsers || [];
      const userIdsInCsTeam = new Set(allUsers.filter(u => u.cs_team_name === csTeamFilter).map(u => u.id));
      entries = entries.filter(e => userIdsInCsTeam.has(e.user_id));
    }
    // 승인자 필터
    if (approverFilter) entries = entries.filter(e => e.approver_id  === approverFilter);
    // 고객사 필터
    if (clientFilter)   entries = entries.filter(e => e.client_id    === clientFilter);
    // 대분류 필터
    if (catFilter)      entries = entries.filter(e => (e.work_category_name||'미분류') === catFilter);
    // 소분류 필터
    if (subFilter)      entries = entries.filter(e => (e.work_subcategory_name||'') === subFilter);

    const totalMin    = entries.reduce((s,e)=>s+(e.duration_minutes||0),0);
    const clientMin   = entries.filter(e=>e.time_category==='client').reduce((s,e)=>s+(e.duration_minutes||0),0);
    const internalMin = totalMin - clientMin;
    const clientRatio = totalMin>0 ? Math.round(clientMin/totalMin*100) : 0;
    const uniqueUsers = new Set(entries.map(e=>e.user_id)).size;

    document.getElementById('analysis-kpi').innerHTML =
      kpiCard('fa-clock',     '', '', '총 투입시간',   (totalMin/60).toFixed(1),    'h',  '승인 완료 기준',           '', '#1a2b45') +
      kpiCard('fa-briefcase', '', '', '고객업무 투입', (clientMin/60).toFixed(1),   'h',  `비율 ${clientRatio}%`,     '', '#2d6bb5') +
      kpiCard('fa-building',  '', '', '내부업무 투입', (internalMin/60).toFixed(1), 'h',  `비율 ${100-clientRatio}%`, '', '#4a7fc4') +
      kpiCard('fa-users',     '', '', '집계 인원',     uniqueUsers,                 '명', `${entries.length}건 기록`, '', '#6b95ce');

    const catMap = {};
    entries.forEach(e => {
      const key = e.work_category_name || '미분류';
      catMap[key] = (catMap[key]||0) + (e.duration_minutes||0);
    });
    renderAnalysisDonut('analysis-chart-category', catMap);

    const cliMap = {};
    entries.filter(e=>e.client_id).forEach(e => {
      const key = e.client_name || '미지정';
      cliMap[key] = (cliMap[key]||0) + (e.duration_minutes||0);
    });
    renderAnalysisBar('analysis-chart-client', cliMap);

  } catch (err) {
    console.error(err);
    Toast.error('분석 데이터 로드 실패');
  }
}

function resetAnalysisFilter() {
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  document.getElementById('filter-analysis-date-from').value =
    `${y}-${String(mo+1).padStart(2,'0')}-01`;
  document.getElementById('filter-analysis-date-to').value =
    `${y}-${String(mo+1).padStart(2,'0')}-${String(new Date(y,mo+1,0).getDate()).padStart(2,'0')}`;
  const ids = ['filter-analysis-department','filter-analysis-csteam','filter-analysis-approver',
               'filter-analysis-client','filter-analysis-category','filter-analysis-subcategory'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  loadAnalysis();
}

// ══════════════════════════════════════════════
//  서브탭2: 고과 분석
// ══════════════════════════════════════════════

function resetStaffFilter() {
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  document.getElementById('filter-staff-date-from').value =
    `${y}-${String(mo+1).padStart(2,'0')}-01`;
  document.getElementById('filter-staff-date-to').value =
    `${y}-${String(mo+1).padStart(2,'0')}-${String(new Date(y,mo+1,0).getDate()).padStart(2,'0')}`;
  const ids = ['filter-staff-department','filter-staff-csteam','filter-staff-approver'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  loadStaffAnalysis();
}

async function loadStaffAnalysis() {
  const session        = getSession();
  // DOM 요소가 없으면 조용히 종료 (init 전 호출 방어)
  const dateFromEl = document.getElementById('filter-staff-date-from');
  const dateToEl   = document.getElementById('filter-staff-date-to');
  if (!dateFromEl || !dateToEl) return;

  const dateFrom       = dateFromEl.value;
  const dateTo         = dateToEl.value;
  const deptFilter     = (document.getElementById('filter-staff-department') || {}).value || '';
  const csTeamFilter   = (document.getElementById('filter-staff-csteam')    || {}).value || '';
  const approverFilter = (document.getElementById('filter-staff-approver')  || {}).value || '';

  const bodyEl   = document.getElementById('staff-analysis-body');
  const starEl   = document.getElementById('staff-star-summary');
  const kpiEl    = document.getElementById('staff-analysis-kpi');
  const labelEl  = document.getElementById('staff-analysis-period-label');

  if (bodyEl) bodyEl.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> 분석 중...</div>`;

  try {
    // ── 데이터 로드 ★ Master/캐시 활용 ────────────────────
    const [allEntries_raw, allUsers, archiveItems] = await Promise.all([
      Cache.get('dash_time_entries', async () => {
        const r = await API.list('time_entries', { limit: 2000 });
        return (r && r.data) ? r.data : [];
      }, 180000),
      Master.users(),
      Cache.get('dash_archive_stars', async () => {
        const r = await API.list('archive_items', { limit: 2000 });
        return (r && r.data) ? r.data : [];
      }, 300000),
    ]);
    let allEntries = allEntries_raw.slice(); // 원본 불변 유지용 복사

    // ── 전체 ID를 String으로 정규화 ─────────────────────────────────
    allEntries = allEntries.map(e => ({
      ...e,
      user_id:     String(e.user_id     || ''),
      approver_id: String(e.approver_id || ''),
    }));
    // ── 역할별 범위 제한 ──────────────────────────────────────────────
    if (session.role === 'staff') {
      allEntries = allEntries.filter(e => e.user_id === String(session.id));
    } else if (session.role === 'manager') {
      allEntries = allEntries.filter(e => e.approver_id === String(session.id));
    } else if (Auth.isDirector(session)) {
      // dashboard.js와 동일한 단순 패턴 사용
      const scopeIds = new Set(allUsers.filter(u => Auth.scopeMatch(session, u)).map(u => String(u.id)));
      allEntries = allEntries.filter(e => scopeIds.has(e.user_id));
    }
    // admin: 열람 제한 없음

    // ── 기간 필터 — ms숫자/숫자문자열/ISO문자열 모두 안전 처리 ────────────────────────────────────────────
    const _safe_ts = (raw) => {
      if (!raw) return 0;
      const n = Number(raw);
      if (!isNaN(n) && n > 1000000000000) return n;
      if (!isNaN(n) && n > 1000000000) return n * 1000;
      return new Date(raw).getTime() || 0;
    };
    const from = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : 0;
    const to   = dateTo   ? new Date(dateTo   + 'T23:59:59').getTime() : Infinity;
    const periodEntries = allEntries.filter(e => {
      if (e.status !== 'approved' || !e.work_start_at) return false;
      const ts = _safe_ts(e.work_start_at);
      return ts >= from && ts <= to;
    });

    // ── 사업부 / 고객지원팀 / 승인자 필터 ───────────────────
    let filteredEntries = [...periodEntries];

    if (deptFilter || csTeamFilter) {
      const matchedUserIds = new Set(
        allUsers.filter(u =>
          (!deptFilter   || u.department   === deptFilter) &&
          (!csTeamFilter || u.cs_team_name === csTeamFilter)
        ).map(u => String(u.id))
      );
      filteredEntries = filteredEntries.filter(e => matchedUserIds.has(e.user_id));
    }
    if (approverFilter) filteredEntries = filteredEntries.filter(e => e.approver_id === String(approverFilter));

    // ── 대상 직원 목록: 승인자 지정 + 타임시트 대상만 (staff + 타임시트 대상 manager 포함) ────────
    let targetUsers = allUsers
      .filter(u =>
        (u.role === 'staff' || u.role === 'manager') &&
        u.is_active !== false &&
        u.is_timesheet_target !== false &&   // 타임시트 대상 여부
        // staff는 approver_id 필수, manager는 reviewer2_id 또는 approver_id 있으면 허용
        (u.role === 'manager'
          ? true
          : (u.approver_id && String(u.approver_id).trim() !== ''))  // 승인자 지정 필수
      )
      .map(u => ({ ...u, id: String(u.id || '') }));

    if (deptFilter)    targetUsers = targetUsers.filter(u => u.department   === deptFilter);
    if (csTeamFilter)  targetUsers = targetUsers.filter(u => u.cs_team_name === csTeamFilter);
    if (approverFilter)targetUsers = targetUsers.filter(u => String(u.approver_id) === String(approverFilter));

    // ── 기간 내 영업일 계산 (토·일 제외) ─────────────────
    let bizDays = 0;
    if (dateFrom && dateTo) {
      let cur = new Date(dateFrom + 'T00:00:00');
      const end = new Date(dateTo + 'T00:00:00');
      while (cur <= end) {
        const dow = cur.getDay();
        if (dow !== 0 && dow !== 6) bizDays++;
        cur.setDate(cur.getDate() + 1);
      }
    }
    const maxPossibleMin = bizDays * 8 * 60; // 기간 내 최대 가능 시간(분)

    // ── 직원별 집계 ──────────────────────────────────────
    const rows = targetUsers.map(u => {
      const uEntries  = filteredEntries.filter(e => String(e.user_id) === String(u.id));
      const totalMin  = uEntries.reduce((s,e)=>s+(e.duration_minutes||0),0);
      const clientMin = uEntries.filter(e=>e.time_category==='client').reduce((s,e)=>s+(e.duration_minutes||0),0);
      const intMin    = totalMin - clientMin;
      const cliRatio  = totalMin > 0 ? Math.round(clientMin/totalMin*100) : 0;

      // 품질 별점 집계 (archive_items) — 모두 String 비교
      const uArchives = archiveItems.filter(a => String(a.user_id) === u.id && parseInt(a.quality_stars) > 0);
      const star1 = uArchives.filter(a=>parseInt(a.quality_stars)===1).length;
      const star2 = uArchives.filter(a=>parseInt(a.quality_stars)===2).length;
      const star3 = uArchives.filter(a=>parseInt(a.quality_stars)===3).length;
      const avgStars = uArchives.length > 0
        ? (uArchives.reduce((s,a)=>s+(parseInt(a.quality_stars)||0),0) / uArchives.length)
        : null;

      // ── 전문성(competency) 집계 — competency_rating 있는 건만 (과거 데이터 제외) ──
      const compEntries = uEntries.filter(e => e.competency_rating && e.competency_stars !== undefined && e.competency_stars !== null);
      const cStar1 = compEntries.filter(e=>parseInt(e.competency_stars)===1).length;
      const cStar2 = compEntries.filter(e=>parseInt(e.competency_stars)===2).length;
      const cStar3 = compEntries.filter(e=>parseInt(e.competency_stars)===3).length;
      const avgCompStars = compEntries.length > 0
        ? (compEntries.reduce((s,e)=>s+(parseInt(e.competency_stars)||0),0) / compEntries.length)
        : null;

      // ── 수행방식 집계 ──
      const perfEntries = uEntries.filter(e => e.performance_type);
      const perfIndep   = perfEntries.filter(e=>e.performance_type==='independent').length;
      const perfGuided  = perfEntries.filter(e=>e.performance_type==='guided').length;
      const perfSuper   = perfEntries.filter(e=>e.performance_type==='supervised').length;

      return { u, totalMin, clientMin, intMin, cliRatio, uArchives, star1, star2, star3, avgStars,
               compEntries, cStar1, cStar2, cStar3, avgCompStars, perfEntries, perfIndep, perfGuided, perfSuper };
    });

    // 최다 투입자 기준
    const maxMin = Math.max(...rows.map(r=>r.totalMin), 0);

    // 내림차순 정렬 (투입시간 많은 순)
    rows.sort((a,b) => b.totalMin - a.totalMin);

    // ── KPI 렌더링 ───────────────────────────────────────
    const totalPeople  = rows.length;
    const totalAllMin  = rows.reduce((s,r)=>s+r.totalMin,0);
    const avgMin       = totalPeople > 0 ? totalAllMin/totalPeople : 0;
    const starredCount = rows.filter(r=>r.uArchives.length>0).length;
    const allStarCount = rows.reduce((s,r)=>s+r.uArchives.length,0);

    if (kpiEl) kpiEl.innerHTML =
      kpiCard('fa-users',     '', '', '분석 인원',   totalPeople,               '명', teamFilter||approverFilter ? '필터 적용' : '전체 직원', '', '#1a2b45') +
      kpiCard('fa-clock',     '', '', '평균 투입',   (avgMin/60).toFixed(1),    'h',  '1인 평균',         '', '#2d6bb5') +
      kpiCard('fa-star',      '', '', '별점 보유',   starredCount,              '명', `총 ${allStarCount}건`, '', '#f59e0b') +
      kpiCard('fa-trophy',    '', '', '최다 투입',   (maxMin/60).toFixed(1),    'h',  rows[0]?.u.name||'-', '', '#4a7fc4');

    if (labelEl) labelEl.textContent = `${dateFrom||'전체'} ~ ${dateTo||'전체'} · 영업일 ${bizDays}일`;

    // ── 직원 행 렌더링 ───────────────────────────────────
    if (!rows.length) {
      if (bodyEl) bodyEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">
        <i class="fas fa-users" style="font-size:24px;opacity:0.3;display:block;margin-bottom:8px"></i>
        해당 조건의 직원 데이터가 없습니다.
      </div>`;
    } else {
      const htmlRows = rows.map((r, i) => {
        const { u, totalMin, clientMin, intMin, cliRatio, avgStars, star1, star2, star3, uArchives,
                avgCompStars, cStar1, cStar2, cStar3, compEntries, perfEntries, perfIndep, perfGuided, perfSuper } = r;
        const hours      = (totalMin/60).toFixed(1);
        const maxRatio   = maxMin > 0 ? Math.round(totalMin/maxMin*100) : 0;
        const periodRatio= maxPossibleMin > 0 ? Math.round(totalMin/maxPossibleMin*100) : 0;

        // 막대 색상 (1위: 가장 진한 네이비 → 점점 옅게)
        const opacity  = Math.max(0.35, 1 - i*(0.55/Math.max(rows.length-1,1)));
        const barClr   = `rgba(45,107,181,${opacity.toFixed(2)})`;
        const txtClr   = `rgba(45,107,181,${Math.min(1,opacity+0.2).toFixed(2)})`;

        // 품질 별점 HTML
        let starHtml = `<span style="font-size:11px;color:#d1d5db">—</span>`;
        if (avgStars !== null) {
          const full = Math.round(avgStars);
          const clr  = full===3?'#f59e0b':full===2?'#3b82f6':'#9ca3af';
          const starStr = '★'.repeat(full)+'☆'.repeat(3-full);
          starHtml = `<div style="text-align:center">
            <span style="font-size:13px;color:${clr};letter-spacing:1px" title="평균${avgStars.toFixed(1)}점(${uArchives.length}건)">${starStr}</span>
            <div style="font-size:10px;color:#9aa4b2;margin-top:1px">
              <span style="color:#9ca3af">★${star1}</span>
              <span style="color:#3b82f6;margin:0 3px">★★${star2}</span>
              <span style="color:#f59e0b">★★★${star3}</span>
            </div>
          </div>`;
        }

        // 전문성 별점 HTML (competency_rating 있는 건만)
        let compHtml = `<span style="font-size:11px;color:#d1d5db">—</span>`;
        if (avgCompStars !== null) {
          const cfull = Math.round(avgCompStars);
          const cclr  = cfull===3?'#f59e0b':cfull===2?'#3b82f6':'#9ca3af';
          const cStr  = '★'.repeat(cfull)+'☆'.repeat(3-cfull);
          compHtml = `<div style="text-align:center">
            <span style="font-size:13px;color:${cclr};letter-spacing:1px" title="전문성 평균${avgCompStars.toFixed(1)}점(${compEntries.length}건)">${cStr}</span>
            <div style="font-size:10px;color:#9aa4b2;margin-top:1px">
              <span style="color:#9ca3af">★${cStar1}</span>
              <span style="color:#3b82f6;margin:0 3px">★★${cStar2}</span>
              <span style="color:#f59e0b">★★★${cStar3}</span>
            </div>
          </div>`;
        }

        // 수행방식 분포 HTML
        let perfHtml = `<span style="font-size:11px;color:#d1d5db">—</span>`;
        if (perfEntries.length > 0) {
          const tot = perfEntries.length;
          const iP = Math.round(perfIndep/tot*100);
          const gP = Math.round(perfGuided/tot*100);
          const sP = 100 - iP - gP;
          perfHtml = `<div style="text-align:center">
            <div style="display:flex;gap:2px;height:6px;border-radius:4px;overflow:hidden;margin-bottom:3px">
              <div style="width:${iP}%;background:#16a34a" title="독립수행 ${perfIndep}건"></div>
              <div style="width:${gP}%;background:#2563eb" title="지도수행 ${perfGuided}건"></div>
              <div style="width:${sP}%;background:#f97316" title="감독수행 ${perfSuper}건"></div>
            </div>
            <div style="font-size:9px;color:#9aa4b2;white-space:nowrap">
              <span style="color:#16a34a">독${perfIndep}</span>
              <span style="color:#2563eb;margin:0 2px">지${perfGuided}</span>
              <span style="color:#f97316">감${perfSuper}</span>
            </div>
          </div>`;
        }

        // 고객/내부 미니 바
        const cliBarW = cliRatio;
        const intBarW = 100-cliRatio;

        return `
        <div style="display:grid;grid-template-columns:140px 70px 90px 90px 1fr 90px 90px 80px;
                    align-items:center;gap:0;padding:8px 16px;
                    border-bottom:1px solid #f4f6f9;transition:background 0.15s"
             onmouseenter="this.style.background='#fafbfc'" onmouseleave="this.style.background=''">
          <!-- 이름 -->
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:28px;height:28px;border-radius:50%;
                        background:linear-gradient(135deg,#2d6bb5,#4a90d9);
                        color:#fff;font-size:11px;font-weight:700;
                        display:flex;align-items:center;justify-content:center;flex-shrink:0">
              ${getInitial(u.name)}
            </div>
            <div>
              <div style="font-size:12px;font-weight:600;color:#1a2b45">${u.name}</div>
              <div style="font-size:10px;color:#9aa4b2">${u.team_name||''}</div>
            </div>
          </div>
          <!-- 투입시간 -->
          <div style="text-align:right">
            <span style="font-size:13px;font-weight:700;color:#1a2b45">${hours}</span>
            <span style="font-size:10px;color:#9aa4b2">h</span>
            <div style="font-size:10px;color:#9aa4b2;margin-top:1px">
              고객<span style="color:#2d6bb5;font-weight:600">${cliRatio}%</span>
            </div>
          </div>
          <!-- 기간대비 -->
          <div style="text-align:center">
            ${maxPossibleMin > 0 ? `
            <span style="font-size:13px;font-weight:700;color:${periodRatio>=80?'#2d6bb5':periodRatio>=50?'#6b95ce':'#9aa4b2'}">${periodRatio}%</span>
            <div style="font-size:10px;color:#9aa4b2;margin-top:1px">기간 대비</div>
            ` : `<span style="color:#d1d5db;font-size:12px">—</span>`}
          </div>
          <!-- 최다대비 % -->
          <div style="text-align:center">
            <span style="font-size:13px;font-weight:700;color:${txtClr}">${maxRatio}%</span>
            <div style="font-size:10px;color:#9aa4b2;margin-top:1px">최다 대비</div>
          </div>
          <!-- 최다대비 바 -->
          <div style="padding:0 12px">
            <div style="height:7px;background:#f0f4f8;border-radius:99px;overflow:hidden">
              <div class="bar-fill" style="width:0%;height:100%;background:${barClr};
                   border-radius:99px;transition:width 0.8s cubic-bezier(.4,0,.2,1)"
                   data-target="${maxRatio}"></div>
            </div>
            ${bizDays>0?`
            <div style="height:4px;background:#f0f4f8;border-radius:99px;overflow:hidden;margin-top:3px">
              <div style="width:${cliBarW}%;height:100%;background:rgba(45,107,181,0.5);
                   border-radius:99px;display:inline-block"></div>
              <div style="width:${intBarW}%;height:100%;background:rgba(148,163,184,0.4);
                   border-radius:99px;display:inline-block"></div>
            </div>`:''}
          </div>
          <!-- 품질 별점 -->
          <div>${starHtml}</div>
          <!-- 전문성 별점 -->
          <div>${compHtml}</div>
          <!-- 수행방식 -->
          <div>${perfHtml}</div>
        </div>`;
      }).join('');

      if (bodyEl) {
        bodyEl.innerHTML = htmlRows;
        // 막대 애니메이션
        requestAnimationFrame(() => {
          bodyEl.querySelectorAll('.bar-fill').forEach(el => {
            el.style.width = el.dataset.target + '%';
          });
        });
      }
    }

    // ── 별점 집계 카드 ───────────────────────────────────
    _renderStarSummary(rows, archiveItems, starEl);

  } catch(err) {
    console.error('Staff Analysis error:', err);
    Toast.error('고과 분석 데이터 로드 실패');
  }
}

// 별점 집계 렌더링
function _renderStarSummary(rows, archiveItems, container) {
  if (!container) return;
  // rows의 u.id는 이미 String으로 정규화됨
  const rowIdSet = new Set(rows.map(r => r.u.id));
  const allArchives = archiveItems.filter(a =>
    rowIdSet.has(String(a.user_id)) && parseInt(a.quality_stars) > 0
  );
  if (!allArchives.length) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">별점 데이터가 없습니다.</div>`;
    return;
  }

  // 직원별 별점 집계
  // user_id를 String으로 통일하여 집계
  const starByUser = {};
  allArchives.forEach(a => {
    const uid = String(a.user_id); const stars = parseInt(a.quality_stars)||0;
    if (!starByUser[uid]) starByUser[uid] = { name:'', s1:0,s2:0,s3:0,total:0,sum:0 };
    starByUser[uid].total++;
    starByUser[uid].sum += stars;
    if (stars===1) starByUser[uid].s1++;
    else if (stars===2) starByUser[uid].s2++;
    else if (stars===3) starByUser[uid].s3++;
  });
  // rows의 u.id는 이미 String
  rows.forEach(r => {
    if (starByUser[r.u.id]) starByUser[r.u.id].name = r.u.name;
  });

  // 평균 내림차순 정렬
  const sorted = Object.entries(starByUser)
    .map(([uid,v])=>({uid,...v,avg:v.total>0?v.sum/v.total:0}))
    .filter(v=>v.total>0)
    .sort((a,b)=>b.avg-a.avg);

  // 전체 합계
  const totalCount = sorted.reduce((s,v)=>s+v.total,0);
  const total1=sorted.reduce((s,v)=>s+v.s1,0);
  const total2=sorted.reduce((s,v)=>s+v.s2,0);
  const total3=sorted.reduce((s,v)=>s+v.s3,0);
  const totalAvg = totalCount>0 ? sorted.reduce((s,v)=>s+v.sum,0)/totalCount : 0;

  // 상단 요약
  const summaryHtml = `
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:14px;padding:12px 16px;
                background:#f8fafc;border-radius:8px;border:1px solid #f0f4f8">
      <div style="text-align:center;min-width:70px">
        <div style="font-size:20px;font-weight:700;color:#1a2b45">${totalCount}</div>
        <div style="font-size:11px;color:#9aa4b2">총 평가 건</div>
      </div>
      <div style="width:1px;background:#e5e7eb"></div>
      <div style="text-align:center;min-width:70px">
        <div style="font-size:20px;font-weight:700;color:#f59e0b">${totalAvg.toFixed(2)}</div>
        <div style="font-size:11px;color:#9aa4b2">평균 별점</div>
      </div>
      <div style="width:1px;background:#e5e7eb"></div>
      <div style="display:flex;gap:12px;align-items:center">
        <div style="text-align:center">
          <div style="font-size:16px;font-weight:700;color:#9ca3af">★${total1}</div>
          <div style="font-size:10px;color:#9aa4b2">보통</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:16px;font-weight:700;color:#3b82f6">★★${total2}</div>
          <div style="font-size:10px;color:#9aa4b2">만족</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:16px;font-weight:700;color:#f59e0b">★★★${total3}</div>
          <div style="font-size:10px;color:#9aa4b2">매우만족</div>
        </div>
      </div>
    </div>`;

  // 직원별 상세
  const detailHtml = sorted.map((v,i) => {
    const avgFull = Math.round(v.avg);
    const clr = avgFull===3?'#f59e0b':avgFull===2?'#3b82f6':'#9ca3af';
    const barW = v.total > 0 ? Math.round(v.s3/v.total*100) : 0; // ★★★ 비율 바
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f4f6f9">
        <div style="min-width:80px;font-size:12px;font-weight:600;color:#1a2b45">${v.name||v.uid}</div>
        <div style="flex-shrink:0;font-size:13px;color:${clr};letter-spacing:1px;width:54px">
          ${'★'.repeat(avgFull)}${'☆'.repeat(3-avgFull)}
        </div>
        <div style="flex-shrink:0;font-size:11px;color:#9ca3af;width:16px" title="★1">${v.s1}</div>
        <div style="flex-shrink:0;font-size:11px;color:#3b82f6;width:16px" title="★★2">${v.s2}</div>
        <div style="flex-shrink:0;font-size:11px;color:#f59e0b;width:16px" title="★★★3">${v.s3}</div>
        <div style="flex:1;height:6px;background:#f0f4f8;border-radius:99px;overflow:hidden">
          <div style="width:${Math.round(v.s3/v.total*100)}%;height:100%;background:#f59e0b;border-radius:99px"></div>
        </div>
        <div style="flex-shrink:0;font-size:11px;color:#9aa4b2;width:40px;text-align:right">총${v.total}건</div>
        <div style="flex-shrink:0;font-size:11px;font-weight:600;color:${clr};width:32px;text-align:right">${v.avg.toFixed(1)}점</div>
      </div>`;
  }).join('');

  container.innerHTML = summaryHtml + `
    <div style="padding:0 2px">
      <div style="display:flex;gap:10px;padding:4px 0 6px;font-size:10px;font-weight:600;color:#9aa4b2;border-bottom:1px solid #e5e7eb;margin-bottom:2px">
        <div style="min-width:80px">이름</div>
        <div style="width:54px">평균 별점</div>
        <div style="width:16px;color:#9ca3af" title="★1건">★1</div>
        <div style="width:16px;color:#3b82f6" title="★★2건">★2</div>
        <div style="width:16px;color:#f59e0b" title="★★★3건">★3</div>
        <div style="flex:1">★★★ 비율</div>
        <div style="width:40px;text-align:right">건수</div>
        <div style="width:32px;text-align:right">점수</div>
      </div>
      ${detailHtml}
    </div>`;
}

// ══════════════════════════════════════════════
//  서브탭3: 인건비 분석
// ══════════════════════════════════════════════

// ─────────────────────────────────────────────
// 인건비 탭 초기화
// ─────────────────────────────────────────────
async function _initLaborTab() {
  const session = getSession();

  // Admin만 인건비 설정 버튼 표시
  const btnSetting = document.getElementById('btn-labor-cost-setting');
  if (btnSetting) btnSetting.style.display = (session.role === 'admin') ? '' : 'none';

  // 연도 드롭다운 생성 (현재연도 기준 ±3년)
  const yearEl = document.getElementById('filter-labor-year');
  if (yearEl && yearEl.options.length === 0) {
    const now = new Date().getFullYear();
    for (let y = now; y >= now - 4; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y + '년';
      yearEl.appendChild(opt);
    }
  }

  await loadLaborAnalysis();
}

// ─────────────────────────────────────────────
// 인건비 배부 계산 메인
// ─────────────────────────────────────────────
async function loadLaborAnalysis() {
  const yearEl = document.getElementById('filter-labor-year');
  const viewEl = document.getElementById('filter-labor-view');
  if (!yearEl || !viewEl) return;

  const year    = Number(yearEl.value);
  const viewMode = viewEl.value; // 'client' | 'team'

  const tableTitle = document.getElementById('labor-table-title');
  if (tableTitle) {
    tableTitle.innerHTML = viewMode === 'client'
      ? `<i class="fas fa-building" style="color:var(--primary)"></i>&nbsp; 고객사별 인건비 배부`
      : `<i class="fas fa-users" style="color:var(--primary)"></i>&nbsp; 팀별 인건비 배부`;
  }

  const wrap       = document.getElementById('labor-table-wrap');
  const personWrap = document.getElementById('labor-person-wrap');
  const kpiEl      = document.getElementById('labor-kpi');
  const statusEl   = document.getElementById('labor-cost-status');

  wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:48px;color:var(--text-muted);font-size:13px"><i class="fas fa-spinner fa-spin" style="margin-right:6px"></i>계산 중...</div>`;

  try {
    // ① 인건비 데이터 로드
    const lcRes = await API.list('labor_costs', { limit: 200 });
    const allCosts = (lcRes && lcRes.data) ? lcRes.data : [];
    const yearCosts = allCosts.filter(c => Number(c.fiscal_year) === year);

    // ② 해당 연도 승인된 타임시트 전체 로드
    // ★ 기존 while(true) 페이지네이션은 데이터가 많거나 API 페이지가 정상 동작하지 않을 때
    //   무한 루프/장시간 대기로 브라우저가 "멈춤"처럼 보일 수 있음.
    //   공통 헬퍼(listAllPages)는 maxPages로 상한을 두므로 안전하다.
    let entries = await API.listAllPages('time_entries', { limit: 500, maxPages: 120, sort: 'updated_at' });

    // 해당 연도 + 승인된 것만 + 고객사 지정된 것만
    entries = entries.filter(e => {
      if (e.status !== 'approved') return false;
      if (!e.client_id) return false; // 고객사 지정 없으면 제외
      if (!e.work_start_at) return false;
      const entryYear = new Date(Number(e.work_start_at)).getFullYear();
      return entryYear === year;
    });

    if (entries.length === 0 && yearCosts.length === 0) {
      wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:48px;color:var(--text-muted);font-size:13px"><i class="fas fa-info-circle" style="margin-right:6px"></i>${year}년 데이터가 없습니다.</div>`;
      personWrap.innerHTML = '';
      kpiEl.innerHTML = '';
      statusEl.innerHTML = '';
      return;
    }

    // ③ 직원 목록 수집 (타임시트 기준)
    const userMap = {}; // userId → { name, totalClientMin, clientBreakdown:{clientId→min}, teamBreakdown:{team→min} }
    entries.forEach(e => {
      const uid = e.user_id;
      if (!uid) return;
      if (!userMap[uid]) {
        userMap[uid] = {
          id: uid,
          name: e.user_name || uid,
          totalClientMin: 0,
          clientBreakdown: {},  // clientId → { name, min }
          teamBreakdown: {},    // teamName → min
        };
      }
      const u = userMap[uid];
      const min = Number(e.duration_minutes) || 0;
      u.totalClientMin += min;

      // 고객사별
      const cid = e.client_id;
      const cname = e.client_name || cid;
      if (!u.clientBreakdown[cid]) u.clientBreakdown[cid] = { name: cname, min: 0 };
      u.clientBreakdown[cid].min += min;

      // 팀별
      const tname = e.team_name || '미지정';
      if (!u.teamBreakdown[tname]) u.teamBreakdown[tname] = 0;
      u.teamBreakdown[tname] += min;
    });

    // ④ 인건비 매핑 (userId → annual_cost)
    const costByUser = {};
    yearCosts.forEach(c => { costByUser[c.user_id] = Number(c.annual_cost) || 0; });

    // ⑤ 인건비 입력 현황 안내
    const usersWithCost    = Object.keys(userMap).filter(uid => costByUser[uid] > 0).length;
    const usersWithoutCost = Object.keys(userMap).filter(uid => !costByUser[uid]).length;
    statusEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:#f8faff;border:1px solid var(--border-light);border-radius:8px;font-size:12px;color:var(--text-secondary)">
        <i class="fas fa-info-circle" style="color:var(--primary)"></i>
        <span><b style="color:var(--text-primary)">${year}년</b> 인건비 입력 현황:
          <b style="color:#15803d">${usersWithCost}명</b> 입력 완료
          ${usersWithoutCost > 0 ? `· <b style="color:#b45309">${usersWithoutCost}명</b> 미입력 (금액 미표시)` : ''}
        </span>
      </div>`;

    // ⑥ 배부 계산
    // groupMap: groupKey → { name, totalCost, persons:[{name, min, pct, cost}] }
    const groupMap = {};

    Object.values(userMap).forEach(u => {
      const annualCost = costByUser[u.id] || 0;
      const totalMin   = u.totalClientMin;
      if (totalMin === 0) return;

      const breakdown = viewMode === 'client' ? u.clientBreakdown
        : Object.fromEntries(Object.entries(u.teamBreakdown).map(([k,v])=>([k,{name:k,min:v}])));

      Object.entries(breakdown).forEach(([gkey, gval]) => {
        const gname = gval.name || gkey;
        const gmin  = gval.min;
        const pct   = totalMin > 0 ? gmin / totalMin : 0;
        const cost  = annualCost > 0 ? Math.round(annualCost * pct) : null;

        if (!groupMap[gkey]) groupMap[gkey] = { name: gname, totalCost: 0, totalMin: 0, persons: [] };
        groupMap[gkey].totalMin  += gmin;
        if (cost !== null) groupMap[gkey].totalCost += cost;
        groupMap[gkey].persons.push({
          userId:   u.id,
          userName: u.name,
          min:      gmin,
          pct:      Math.round(pct * 100),
          cost:     cost,
          hasCost:  annualCost > 0,
        });
      });
    });

    // ⑦ KPI
    const totalCost  = Object.values(groupMap).reduce((s,g)=>s+g.totalCost, 0);
    const totalHours = entries.reduce((s,e)=>s+(e.duration_minutes||0),0) / 60;
    const groupCount = Object.keys(groupMap).length;
    const totalAnnualCost = yearCosts.reduce((s,c)=>s+Number(c.annual_cost||0),0);

    kpiEl.innerHTML =
      kpiCard('fa-coins',       '', '', '배부 인건비 합계',  _fmtWon(totalCost),  '원', `${year}년 기준`,                       '', '#1a2b45') +
      kpiCard('fa-building',    '', '', viewMode==='client'?'고객사 수':'팀 수', groupCount, '개', `고객사 지정 업무 기준`,            '', '#2d6bb5') +
      kpiCard('fa-clock',       '', '', '고객사 업무시간',   totalHours.toFixed(1),'h', `고객사 지정 항목만`,                     '', '#4a7fc4') +
      kpiCard('fa-user-tie',    '', '', '인건비 입력 인원',  usersWithCost,        '명', totalAnnualCost>0?`총 ${_fmtWon(totalAnnualCost)}원`:'', '', '#6b95ce');

    // ⑧ 배부 테이블 렌더링
    _renderLaborTable(groupMap, viewMode);

    // ⑨ 직원별 상세 렌더링
    _renderPersonDetail(userMap, costByUser, viewMode);

  } catch (err) {
    console.error('loadLaborAnalysis 오류:', err);
    wrap.innerHTML = `<div style="padding:32px;text-align:center;color:var(--danger);font-size:13px">오류: ${err.message}</div>`;
    Toast.error('인건비 배부 계산 실패');
  }
}

// ─────────────────────────────────────────────
// 배부 테이블 렌더링
// ─────────────────────────────────────────────
function _renderLaborTable(groupMap, viewMode) {
  const wrap = document.getElementById('labor-table-wrap');
  const sorted = Object.values(groupMap).sort((a,b) => b.totalCost - a.totalCost || b.totalMin - a.totalMin);

  if (!sorted.length) {
    wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:13px">집계된 데이터가 없습니다.</div>`;
    return;
  }

  const grandTotalCost = sorted.reduce((s,g) => s + g.totalCost, 0);

  // 직원 목록 (투입시간 많은 순 정렬)
  const personMap = {};
  sorted.forEach(g => g.persons.forEach(p => {
    if (!personMap[p.userId]) personMap[p.userId] = { id: p.userId, name: p.userName, totalMin: 0 };
    personMap[p.userId].totalMin += p.min;
  }));
  const allPersons = Object.values(personMap).sort((a,b) => b.totalMin - a.totalMin);

  // ── 스타일 변수 ──────────────────────────────────
  const thBase  = `padding:10px 14px;font-size:12px;font-weight:600;white-space:nowrap;border-bottom:2px solid #e2e8f0;vertical-align:middle`;
  const thLeft  = `${thBase};text-align:left;color:#64748b;background:#f8fafc`;
  const thRight = `${thBase};text-align:right;color:#64748b;background:#f8fafc`;
  const thTotal = `${thBase};text-align:right;color:var(--primary);background:#eff6ff;border-left:2px solid #dbeafe`;

  let html = `
  <div style="overflow-x:auto">
  <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:400px">
    <thead>
      <tr>
        <th style="${thLeft}">${viewMode === 'client' ? '고객사' : '팀'}</th>`;

  allPersons.forEach(p => {
    html += `<th style="${thRight}">${p.name}</th>`;
  });

  html += `<th style="${thTotal}">합계 인건비</th>
      </tr>
    </thead>
    <tbody>`;

  // ── 데이터 행 ─────────────────────────────
  sorted.forEach((g, gi) => {
    const rowBg = gi % 2 === 0 ? '#ffffff' : '#f8fafc';

    html += `<tr style="background:${rowBg};border-bottom:1px solid #f1f5f9;transition:background 0.15s"
               onmouseover="this.style.background='#f0f7ff'"
               onmouseout="this.style.background='${rowBg}'">
      <td style="padding:11px 14px;font-weight:600;color:#1e293b;white-space:nowrap">${g.name}</td>`;

    allPersons.forEach(p => {
      const found = g.persons.find(px => px.userId === p.id);
      if (found) {
        const costTxt = (found.hasCost && found.cost !== null) ? _fmtWon(found.cost) : '—';
        const minTxt  = `${(found.min/60).toFixed(1)}h`;
        html += `<td style="padding:11px 14px;text-align:right;vertical-align:middle">
          <div style="font-weight:600;color:#1e293b;white-space:nowrap">${costTxt}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">${minTxt}</div>
        </td>`;
      } else {
        html += `<td style="padding:11px 14px;text-align:right;color:#cbd5e1">—</td>`;
      }
    });

    html += `<td style="padding:11px 14px;text-align:right;font-weight:700;color:var(--primary);background:#f0f7ff;border-left:2px solid #dbeafe;white-space:nowrap">
      ${g.totalCost > 0 ? _fmtWon(g.totalCost) : '—'}
    </td>
    </tr>`;
  });

  // ── 합계 행 ──────────────────────────────
  html += `<tr style="background:#1e293b;border-top:2px solid #334155">
    <td style="padding:11px 14px;font-weight:700;color:#f1f5f9;font-size:13px">합계</td>`;

  allPersons.forEach(p => {
    const pTotal = sorted.reduce((s,g) => {
      const f = g.persons.find(px => px.userId === p.id);
      return s + (f && f.cost ? f.cost : 0);
    }, 0);
    html += `<td style="padding:11px 14px;text-align:right;color:#f1f5f9;font-weight:700;white-space:nowrap">
      ${pTotal > 0 ? _fmtWon(pTotal) : '—'}
    </td>`;
  });

  html += `<td style="padding:11px 14px;text-align:right;font-weight:700;color:#93c5fd;font-size:13.5px;border-left:2px solid rgba(99,179,237,0.4);white-space:nowrap">
    ${grandTotalCost > 0 ? _fmtWon(grandTotalCost) : '—'}
  </td>
  </tr>`;

  html += `</tbody></table>
  </div>`;
  wrap.innerHTML = html;
}

// ─────────────────────────────────────────────
// 직원별 상세 렌더링
// ─────────────────────────────────────────────
function _renderPersonDetail(userMap, costByUser, viewMode) {
  const wrap = document.getElementById('labor-person-wrap');
  const users = Object.values(userMap).sort((a,b)=>b.totalClientMin-a.totalClientMin);

  if (!users.length) { wrap.innerHTML = ''; return; }

  let html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">`;

  users.forEach(u => {
    const annualCost = costByUser[u.id] || 0;
    const totalMin   = u.totalClientMin;

    const breakdown = viewMode === 'client'
      ? Object.entries(u.clientBreakdown).map(([k,v])=>({ name:v.name||k, min:v.min }))
      : Object.entries(u.teamBreakdown).map(([k,v])=>({ name:k, min:v }));
    const sorted = breakdown.sort((a,b)=>b.min-a.min);

    html += `<div style="border:1px solid var(--border-light);border-radius:var(--radius);padding:14px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="font-weight:700;font-size:13px;color:var(--text-primary)">${u.name}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">고객사 업무 ${(totalMin/60).toFixed(1)}h</div>
        </div>
        <div style="text-align:right">
          ${annualCost > 0
            ? `<div style="font-size:12px;font-weight:700;color:var(--primary)">${_fmtWon(annualCost)}</div>
               <div style="font-size:10px;color:var(--text-muted)">연간 인건비</div>`
            : `<div style="font-size:11px;color:#b45309;background:#fff7ed;padding:3px 7px;border-radius:4px">인건비 미입력</div>`
          }
        </div>
      </div>`;

    sorted.slice(0, 6).forEach(item => {
      const pct  = totalMin > 0 ? (item.min / totalMin * 100) : 0;
      const cost = annualCost > 0 ? Math.round(annualCost * pct / 100) : null;
      html += `<div style="margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
          <span style="font-size:11.5px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px" title="${item.name}">${item.name}</span>
          <span style="font-size:11.5px;font-weight:600;color:var(--text-primary);white-space:nowrap">${cost!==null ? _fmtWon(cost) : (item.min/60).toFixed(1)+'h'}</span>
        </div>
        <div style="height:5px;background:#f0f4f8;border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${pct.toFixed(1)}%;background:var(--primary);border-radius:99px;opacity:0.7"></div>
        </div>
        <div style="font-size:10px;color:var(--text-muted);text-align:right;margin-top:1px">${(item.min/60).toFixed(1)}h · ${pct.toFixed(1)}%</div>
      </div>`;
    });
    if (sorted.length > 6) {
      html += `<div style="font-size:10.5px;color:var(--text-muted);text-align:center;padding-top:4px">+ ${sorted.length-6}개 더...</div>`;
    }
    html += `</div>`;
  });

  html += `</div>`;
  wrap.innerHTML = html;
}

// ══════════════════════════════════════════════
//  인건비 설정 모달 (Admin 전용)
// ══════════════════════════════════════════════

async function openLaborCostModal() {
  const session = getSession();
  if (session.role !== 'admin') { Toast.warning('관리자만 접근 가능합니다.'); return; }

  // 모달 연도 드롭다운 세팅
  const yearEl = document.getElementById('labor-modal-year');
  if (yearEl) {
    yearEl.innerHTML = '';
    const now = new Date().getFullYear();
    for (let y = now; y >= now - 4; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y + '년';
      yearEl.appendChild(opt);
    }
    // 현재 필터 연도와 동기화
    const filterYear = document.getElementById('filter-labor-year').value;
    if (filterYear) yearEl.value = filterYear;
  }

  openModal('laborCostModal');
  await loadLaborCostList();
}

async function loadLaborCostList() {
  const yearEl = document.getElementById('labor-modal-year');
  const tbody  = document.getElementById('labor-cost-tbody');
  if (!yearEl || !tbody) return;

  const year = Number(yearEl.value);
  tbody.innerHTML = `<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px"><i class="fas fa-spinner fa-spin"></i> 로딩 중...</td></tr>`;

  try {
    // 직원 목록 (staff 역할만)
    const usersRes = await API.list('users', { limit: 200 });
    const allUsers = (usersRes && usersRes.data) ? usersRes.data : [];
    // staff만 (자문 인력)
    const staffUsers = allUsers.filter(u => u.role === 'staff' && u.is_active !== false);

    // 기존 인건비 데이터
    const lcRes  = await API.list('labor_costs', { limit: 200 });
    const allCosts = (lcRes && lcRes.data) ? lcRes.data : [];
    const yearCosts = allCosts.filter(c => Number(c.fiscal_year) === year);
    const costByUser = {};
    yearCosts.forEach(c => { costByUser[c.user_id] = { id: c.id, amount: Number(c.annual_cost)||0, note: c.note||'' }; });

    if (!staffUsers.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px">등록된 자문 직원이 없습니다.</td></tr>`;
      return;
    }

    tbody.innerHTML = staffUsers.map(u => {
      const existing = costByUser[u.id] || {};
      const amount   = existing.amount || '';
      const note     = existing.note   || '';
      const rowId    = `labor-row-${u.id}`;
      return `<tr id="${rowId}" style="border-bottom:1px solid var(--border-light)" data-user-id="${u.id}" data-user-name="${u.name}" data-record-id="${existing.id||''}">
        <td style="padding:9px 12px;font-size:12.5px;font-weight:600;color:var(--text-primary)">${u.name}</td>
        <td style="padding:9px 12px;font-size:12px;color:var(--text-secondary)">${Utils.roleBadge(u.role)}</td>
        <td style="padding:9px 12px">
          <input type="text" class="labor-cost-input"
            style="width:100%;padding:5px 8px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:12.5px;text-align:right;font-family:'Noto Sans KR',sans-serif"
            placeholder="0"
            value="${amount ? amount.toLocaleString() : ''}"
            oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/\\B(?=(\\d{3})+(?!\\d))/g,',')"
            data-user-id="${u.id}" />
        </td>
        <td style="padding:9px 12px">
          <input type="text" class="labor-note-input"
            style="width:100%;padding:5px 8px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:12px;font-family:'Noto Sans KR',sans-serif"
            placeholder="비고"
            value="${note}"
            data-user-id="${u.id}" />
        </td>
      </tr>`;
    }).join('');

  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="4" style="padding:16px;text-align:center;color:var(--danger);font-size:12px">로드 실패</td></tr>`;
  }
}

async function saveLaborCosts() {
  const session = getSession();
  const year    = Number(document.getElementById('labor-modal-year').value);
  const rows    = document.querySelectorAll('#labor-cost-tbody tr[data-user-id]');

  if (!rows.length) { Toast.warning('저장할 데이터가 없습니다.'); return; }

  const btn = document.querySelector('#laborCostModal .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 저장 중...'; }

  try {
    // 기존 해당 연도 레코드 조회
    const lcRes   = await API.list('labor_costs', { limit: 200 });
    const allCosts = (lcRes && lcRes.data) ? lcRes.data : [];
    const yearCosts = allCosts.filter(c => Number(c.fiscal_year) === year);
    const existingByUser = {};
    yearCosts.forEach(c => { existingByUser[c.user_id] = c.id; });

    let saved = 0, skipped = 0;
    for (const row of rows) {
      const userId   = row.dataset.userId;
      const userName = row.dataset.userName;
      const costInput = row.querySelector('.labor-cost-input');
      const noteInput = row.querySelector('.labor-note-input');
      const rawVal   = costInput ? costInput.value.replace(/,/g, '') : '';
      const amount   = rawVal ? Number(rawVal) : 0;
      const note     = noteInput ? noteInput.value.trim() : '';

      const payload = {
        user_id:           userId,
        user_name:         userName,
        fiscal_year:       year,
        annual_cost:       amount,
        note:              note,
        registered_by_id:  session.id,
        registered_by_name:session.name,
      };

      if (existingByUser[userId]) {
        await API.update('labor_costs', existingByUser[userId], payload);
      } else {
        if (amount > 0) {
          await API.create('labor_costs', payload);
        } else {
          skipped++;
          continue;
        }
      }
      saved++;
    }

    Toast.success(`저장 완료 (${saved}명)${skipped > 0 ? ` · ${skipped}명 미입력 스킵` : ''}`);
    closeModal('laborCostModal');
    await loadLaborAnalysis();

  } catch (err) {
    console.error(err);
    Toast.error('저장 실패: ' + (err?.message || String(err)));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> 저장'; }
  }
}

// ══════════════════════════════════════════════
//  인건비 설정 엑셀 양식 다운로드
// ══════════════════════════════════════════════
async function downloadLaborCostTemplate() {
  if (typeof XLSX === 'undefined') {
    Toast.error('엑셀 라이브러리가 로드되지 않았습니다.');
    return;
  }

  const year = Number(document.getElementById('labor-modal-year').value);

  // 현재 직원 목록 가져오기
  const usersRes  = await API.list('users', { limit: 200 });
  const allUsers  = (usersRes && usersRes.data) ? usersRes.data : [];
  const staffList = allUsers.filter(u => u.role === 'staff' && u.is_active !== false);

  // 기존 입력된 인건비 가져오기
  const lcRes    = await API.list('labor_costs', { limit: 200 });
  const allCosts = (lcRes && lcRes.data) ? lcRes.data : [];
  const yearCosts = allCosts.filter(c => Number(c.fiscal_year) === year);
  const costByUser = {};
  yearCosts.forEach(c => { costByUser[c.user_id] = { amount: Number(c.annual_cost)||0, note: c.note||'' }; });

  const wb = XLSX.utils.book_new();

  // ── 데이터 시트 ──
  const dataRows = staffList.map(u => ({
    '이름':           u.name,
    '연간 인건비(원)': costByUser[u.id]?.amount || 0,
    '비고':           costByUser[u.id]?.note    || '',
  }));

  // 직원이 없으면 샘플 행 추가
  if (!dataRows.length) {
    dataRows.push({ '이름': '홍길동', '연간 인건비(원)': 60000000, '비고': '예시' });
  }

  const ws = XLSX.utils.json_to_sheet(dataRows);

  // 열 너비 설정
  ws['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 20 }];

  XLSX.utils.book_append_sheet(wb, ws, `인건비_${year}`);

  // ── 안내 시트 ──
  const guideRows = [
    { '항목': 'A열 - 이름',           '설명': '시스템에 등록된 직원 실명 (정확히 일치해야 반영)' },
    { '항목': 'B열 - 연간 인건비(원)', '설명': '숫자만 입력 (예: 60000000 → 6,000만원), 쉼표 제거' },
    { '항목': 'C열 - 비고',           '설명': '선택 입력 (메모 용도)' },
    { '항목': '주의사항',              '설명': '이름이 시스템 등록 직원과 정확히 일치해야 반영됩니다.' },
    { '항목': '대상 직원',             '설명': 'Staff/Advisor 역할만 해당 (Manager, Director, Admin 제외)' },
  ];
  const wsGuide = XLSX.utils.json_to_sheet(guideRows);
  wsGuide['!cols'] = [{ wch: 22 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, '입력안내');

  xlsxDownload(wb, `인건비설정양식_${year}년.xlsx`);
  Toast.success(`${year}년 인건비 입력 양식 다운로드 완료`);
}

// ══════════════════════════════════════════════
//  인건비 설정 엑셀 업로드
// ══════════════════════════════════════════════
async function uploadLaborCostExcel(input) {
  const file = input.files[0];
  if (!file) return;

  // 파일 input 초기화 (같은 파일 재업로드 허용)
  input.value = '';

  if (typeof XLSX === 'undefined') {
    Toast.error('엑셀 라이브러리가 로드되지 않았습니다.');
    return;
  }

  const resultEl = document.getElementById('labor-upload-result');

  const showResult = (type, msg) => {
    // type: 'success' | 'warning' | 'error'
    const colorMap = {
      success: { bg:'#dcfce7', border:'#86efac', color:'#15803d', icon:'fa-check-circle' },
      warning: { bg:'#fef9c3', border:'#fde047', color:'#a16207', icon:'fa-exclamation-triangle' },
      error:   { bg:'#fee2e2', border:'#fca5a5', color:'#b91c1c', icon:'fa-times-circle' },
    };
    const s = colorMap[type] || colorMap.error;
    resultEl.style.display = '';
    resultEl.innerHTML = `<div style="padding:9px 12px;background:${s.bg};border:1px solid ${s.border};border-radius:6px;font-size:12.5px;color:${s.color};line-height:1.6">
      <i class="fas ${s.icon}" style="margin-right:5px"></i>${msg}
    </div>`;
  };

  try {
    // 엑셀 읽기
    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });
    const wsName = wb.SheetNames[0];
    const ws   = wb.Sheets[wsName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!rows.length) {
      showResult('error', '엑셀 파일에 데이터가 없습니다.');
      return;
    }

    // 직원 목록 조회 (이름 → userId 매핑)
    const usersRes = await API.list('users', { limit: 200 });
    const allUsers = (usersRes && usersRes.data) ? usersRes.data : [];
    const nameToUser = {};
    allUsers.forEach(u => { nameToUser[u.name.trim()] = u; });

    let matched = 0, skipped = 0;
    const notFound = [];

    rows.forEach(row => {
      // 컬럼명 유연하게 처리 (A열=이름, B열=연간 인건비, C열=비고)
      const name   = String(row['이름'] || row['A'] || Object.values(row)[0] || '').trim();
      const rawAmt = row['연간 인건비(원)'] ?? row['연간 인건비'] ?? row['B'] ?? Object.values(row)[1] ?? '';
      const note   = String(row['비고'] || row['C'] || Object.values(row)[2] || '').trim();
      const amount = Number(String(rawAmt).replace(/,/g, '')) || 0;

      if (!name) { skipped++; return; }

      const user = nameToUser[name];
      if (!user) { notFound.push(name); skipped++; return; }

      // 해당 직원 행의 input에 값 반영
      const costInput = document.querySelector(`#labor-cost-tbody tr[data-user-id="${user.id}"] .labor-cost-input`);
      const noteInput = document.querySelector(`#labor-cost-tbody tr[data-user-id="${user.id}"] .labor-note-input`);

      if (costInput) {
        costInput.value = amount > 0 ? amount.toLocaleString() : '';
        // 포커스/블러 트리거로 시각적 강조
        costInput.style.borderColor = '#22c55e';
        setTimeout(() => { costInput.style.borderColor = ''; }, 2000);
        matched++;
      } else {
        skipped++;
      }
      if (noteInput && note) noteInput.value = note;
    });

    // 결과 메시지
    let msg = `<b>${matched}명</b> 반영 완료`;
    if (skipped > 0) msg += ` · ${skipped}행 스킵`;
    if (notFound.length > 0) msg += `<br>⚠ 미일치 이름: <b>${notFound.join(', ')}</b> (시스템 등록명과 정확히 일치해야 합니다)`;

    showResult(notFound.length > 0 ? 'warning' : 'success', msg);
    Toast.success(`엑셀 업로드 완료 — ${matched}명 반영`);

  } catch (err) {
    console.error('uploadLaborCostExcel 오류:', err);
    showResult('error', '파일 읽기 실패: ' + (err?.message || String(err)));
    Toast.error('엑셀 업로드 실패');
  }
}

// ══════════════════════════════════════════════
//  인건비 배부 엑셀 다운로드
// ══════════════════════════════════════════════
async function exportLaborExcel() {
  if (typeof XLSX === 'undefined') {
    Toast.error('엑셀 라이브러리가 로드되지 않았습니다.');
    return;
  }
  const yearEl = document.getElementById('filter-labor-year');
  const viewEl = document.getElementById('filter-labor-view');
  const year   = Number(yearEl.value);
  const viewMode = viewEl.value;

  Toast.info('데이터 준비 중...');

  try {
    const lcRes  = await API.list('labor_costs', { limit: 200 });
    const allCosts = (lcRes && lcRes.data) ? lcRes.data : [];
    const yearCosts = allCosts.filter(c => Number(c.fiscal_year) === year);
    const costByUser = {};
    yearCosts.forEach(c => { costByUser[c.user_id] = Number(c.annual_cost)||0; });

    let entries = await API.listAllPages('time_entries', { limit: 500, maxPages: 120, sort: 'updated_at' });
    entries = entries.filter(e => {
      if (e.status !== 'approved' || !e.client_id || !e.work_start_at) return false;
      return new Date(Number(e.work_start_at)).getFullYear() === year;
    });

    // 집계 재계산
    const userMap = {};
    entries.forEach(e => {
      const uid = e.user_id; if (!uid) return;
      if (!userMap[uid]) userMap[uid] = { id:uid, name:e.user_name||uid, totalClientMin:0, clientBreakdown:{}, teamBreakdown:{} };
      const u = userMap[uid];
      const min = Number(e.duration_minutes)||0;
      u.totalClientMin += min;
      const cid = e.client_id; const cname = e.client_name||cid;
      if (!u.clientBreakdown[cid]) u.clientBreakdown[cid]={name:cname,min:0};
      u.clientBreakdown[cid].min += min;
      const tname = e.team_name||'미지정';
      if (!u.teamBreakdown[tname]) u.teamBreakdown[tname]=0;
      u.teamBreakdown[tname] += min;
    });

    const wb = XLSX.utils.book_new();

    // 시트1: 배부 요약
    const summaryRows = [];
    const allPersons = Object.values(userMap).sort((a,b)=>b.totalClientMin-a.totalClientMin);
    const groupMap = {};
    allPersons.forEach(u => {
      const annualCost = costByUser[u.id]||0;
      const totalMin   = u.totalClientMin;
      if (!totalMin) return;
      const breakdown = viewMode==='client'
        ? Object.entries(u.clientBreakdown).map(([k,v])=>({key:k,name:v.name||k,min:v.min}))
        : Object.entries(u.teamBreakdown).map(([k,v])=>({key:k,name:k,min:v}));
      breakdown.forEach(({key,name,min}) => {
        const pct  = min/totalMin;
        const cost = annualCost>0 ? Math.round(annualCost*pct) : 0;
        if (!groupMap[key]) groupMap[key]={name,totalCost:0,totalMin:0};
        groupMap[key].totalCost += cost;
        groupMap[key].totalMin  += min;
      });
    });
    Object.values(groupMap).sort((a,b)=>b.totalCost-a.totalCost).forEach(g => {
      summaryRows.push({
        [viewMode==='client'?'고객사':'팀']: g.name,
        '투입시간(h)':   +(g.totalMin/60).toFixed(2),
        '배부 인건비(원)': g.totalCost,
        '비율(%)':        groupMap && Object.values(groupMap).reduce((s,x)=>s+x.totalMin,0)>0
          ? +(g.totalMin/Object.values(groupMap).reduce((s,x)=>s+x.totalMin,0)*100).toFixed(1) : 0,
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows),
      viewMode==='client'?'고객사별배부':'팀별배부');

    // 시트2: 직원별 상세
    const detailRows = [];
    allPersons.forEach(u => {
      const annualCost = costByUser[u.id]||0;
      const totalMin   = u.totalClientMin;
      const breakdown = viewMode==='client'
        ? Object.entries(u.clientBreakdown).map(([k,v])=>({name:v.name||k,min:v.min}))
        : Object.entries(u.teamBreakdown).map(([k,v])=>({name:k,min:v}));
      breakdown.sort((a,b)=>b.min-a.min).forEach(item => {
        const pct  = totalMin>0 ? item.min/totalMin : 0;
        const cost = annualCost>0 ? Math.round(annualCost*pct) : null;
        detailRows.push({
          '직원':              u.name,
          '연간인건비(원)':    annualCost||'미입력',
          [viewMode==='client'?'고객사':'팀']: item.name,
          '투입시간(h)':       +(item.min/60).toFixed(2),
          '비율(%)':           +(pct*100).toFixed(1),
          '배부인건비(원)':    cost!==null ? cost : '미입력',
        });
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), '직원별상세');

    xlsxDownload(wb, `인건비배부_${year}년_${viewMode==='client'?'고객사':'팀'}.xlsx`);
    Toast.success('엑셀 다운로드 완료');

  } catch (err) {
    console.error(err);
    Toast.error('엑셀 다운로드 실패');
  }
}

// ══════════════════════════════════════════════
//  업무분석 엑셀 다운로드 (기존)
// ══════════════════════════════════════════════
async function exportAnalysisExcel() {
  if (typeof XLSX === 'undefined') {
    Toast.error('엑셀 라이브러리가 로드되지 않았습니다. 페이지를 새로고침 후 다시 시도하세요.');
    return;
  }
  try {
    const session      = getSession();
    const dateFrom     = document.getElementById('filter-analysis-date-from').value;
    const dateTo       = document.getElementById('filter-analysis-date-to').value;
    const teamFilter   = document.getElementById('filter-analysis-team')?.value   || '';
    const clientFilter = document.getElementById('filter-analysis-client')?.value || '';

    Toast.info('데이터 준비 중...');

    let entries = await API.listAllPages('time_entries', { limit: 500, maxPages: 120, sort: 'updated_at' });

    if (session.role === 'staff') {
      entries = entries.filter(e => String(e.user_id) === String(session.id));
    } else if (session.role === 'manager') {
      entries = entries.filter(e => String(e.approver_id) === String(session.id));
    }
    entries = entries.filter(e => e.status === 'approved');

    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : 0;
      const to   = dateTo   ? new Date(dateTo   + 'T23:59:59').getTime() : Infinity;
      entries = entries.filter(e => {
        if (!e.work_start_at) return false;
        const raw = e.work_start_at;
        const num = Number(raw);
        let ts;
        if (!isNaN(num) && num > 1000000000000) ts = num;
        else if (!isNaN(num) && num > 1000000000) ts = num * 1000;
        else ts = new Date(raw).getTime();
        if (isNaN(ts)) return false;
        return ts >= from && ts <= to;
      });
    }
    if (teamFilter)   entries = entries.filter(e => e.team_name   === teamFilter);
    if (clientFilter) entries = entries.filter(e => e.client_id   === clientFilter);

    if (!entries.length) { Toast.warning('내보낼 데이터가 없습니다.'); return; }

    const fmtDate = ts => { if (!ts) return ''; const d=new Date(Number(ts)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
    const fmtTime = ts => { if (!ts) return ''; const d=new Date(Number(ts)); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
    const safeStr = v => { if (v===null||v===undefined) return ''; if (typeof v==='string') return v; if (typeof v==='object') return JSON.stringify(v); return String(v); };

    const wb = XLSX.utils.book_new();
    const rows = entries.map((e,i)=>({
      'No':i+1,'Staff':safeStr(e.user_name),'수행팀':safeStr(e.team_name),
      '고객사':safeStr(e.client_name)||'내부업무','대분류':safeStr(e.work_category_name),
      '소분류':safeStr(e.work_subcategory_name),'시작일자':fmtDate(e.work_start_at),
      '시작시간':fmtTime(e.work_start_at),'종료일자':fmtDate(e.work_end_at),
      '종료시간':fmtTime(e.work_end_at),'소요시간':Utils.formatDuration(e.duration_minutes),
      '소요(분)':Number(e.duration_minutes)||0,'수행내용':safeStr(e.work_description),
      '승인자':safeStr(e.reviewer_name||e.approver_name),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '상세기록');

    const totalMin = entries.reduce((s,e)=>s+(e.duration_minutes||0),0);
    const catMap={};
    entries.forEach(e=>{ const k=e.work_category_name||'미분류'; catMap[k]=(catMap[k]||0)+(e.duration_minutes||0); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      Object.entries(catMap).sort((a,b)=>b[1]-a[1]).map(([cat,min])=>({'대분류':cat,'투입시간(분)':min,'투입시간(h)':+(min/60).toFixed(2),'비율(%)':totalMin>0?Math.round(min/totalMin*100):0}))
    ), '대분류집계');

    const cliMap={};
    entries.filter(e=>e.client_id).forEach(e=>{ const k=e.client_name||'미지정'; cliMap[k]=(cliMap[k]||0)+(e.duration_minutes||0); });
    if (Object.keys(cliMap).length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        Object.entries(cliMap).sort((a,b)=>b[1]-a[1]).map(([cli,min])=>({'고객사':cli,'투입시간(분)':min,'투입시간(h)':+(min/60).toFixed(2),'비율(%)':totalMin>0?Math.round(min/totalMin*100):0}))
      ), '고객사집계');
    }

    const now = new Date();
    const fileLabel = dateFrom ? dateFrom.substring(0,7) : `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    xlsxDownload(wb, `투입분석_${fileLabel}.xlsx`);
    Toast.success(`엑셀 다운로드 완료 (${entries.length}건)`);

  } catch (err) {
    console.error('exportAnalysisExcel 오류:', err);
    Toast.error('내보내기 실패: ' + (err?.message || String(err)), 6000);
  }
}

// ══════════════════════════════════════════════
//  공통 차트 함수
// ══════════════════════════════════════════════
function _renderAnalysisBarChart(canvasId, dataMap, maxLabelLen = 99) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (_analysisCharts[canvasId]) { _analysisCharts[canvasId].destroy(); delete _analysisCharts[canvasId]; }
  const wrapper = canvas.parentElement;
  if (!wrapper) return;
  canvas.style.display = 'none';
  const existing = wrapper.querySelector('.custom-bar-chart');
  if (existing) existing.remove();
  const sorted = Object.entries(dataMap).sort((a,b)=>b[1]-a[1]);
  if (!sorted.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#9aa4b2;font-size:12px;';
    empty.textContent = '데이터가 없습니다.';
    wrapper.appendChild(empty);
    return;
  }
  const totalMin = sorted.reduce((s,[,v])=>s+v,0);
  const maxMin   = sorted[0][1];
  const baseColor = '45,107,181';
  const rows = sorted.map(([key,min],i)=>{
    const pct=totalMin>0?Math.round(min/totalMin*100):0;
    const barW=maxMin>0?(min/maxMin*100).toFixed(1):0;
    const hours=(min/60).toFixed(1);
    const isEtc=key==='기타';
    const opacity=isEtc?0.3:Math.max(0.45,1-i*(0.55/Math.max(sorted.length-1,1)));
    const barClr=isEtc?'rgba(148,163,184,0.5)':`rgba(${baseColor},${opacity.toFixed(2)})`;
    const txtClr=isEtc?'#94a3b8':`rgba(${baseColor},${Math.min(1,opacity+0.2).toFixed(2)})`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f4f6f9;" title="${key}">
      <div style="min-width:80px;max-width:130px;width:auto;font-size:11px;color:#5a6878;font-weight:500;white-space:normal;word-break:keep-all;overflow:visible;flex-shrink:0;line-height:1.35;letter-spacing:-0.1px;" title="${key}">${key}</div>
      <div style="flex:1;height:6px;background:#f0f4f8;border-radius:99px;overflow:hidden;min-width:0;">
        <div class="bar-fill" style="width:0%;height:100%;background:${barClr};border-radius:99px;transition:width 0.8s cubic-bezier(.4,0,.2,1);" data-target="${barW}"></div>
      </div>
      <div style="flex-shrink:0;min-width:30px;text-align:right;font-size:12px;font-weight:700;color:#1a2b45;letter-spacing:-0.3px;">${hours}<span style="font-size:9px;font-weight:500;color:#9aa4b2;margin-left:1px">h</span></div>
      <div style="flex-shrink:0;width:28px;text-align:right;font-size:10.5px;font-weight:600;color:${txtClr};">${pct}%</div>
    </div>`;
  }).join('');
  const div = document.createElement('div');
  div.className = 'custom-bar-chart';
  div.style.cssText = 'height:100%;display:flex;flex-direction:column;justify-content:space-evenly;padding:4px 2px 2px;';
  div.innerHTML = rows;
  wrapper.appendChild(div);
  requestAnimationFrame(()=>{ div.querySelectorAll('.bar-fill').forEach(el=>{ el.style.width=el.dataset.target+'%'; }); });
}

function renderAnalysisDonut(canvasId, dataMap) {
  const sorted=Object.entries(dataMap).sort((a,b)=>b[1]-a[1]);
  const topN=8; const collapsed={};
  sorted.slice(0,topN).forEach(([k,v])=>{ collapsed[k]=v; });
  const etcSum=sorted.slice(topN).reduce((s,[,v])=>s+v,0);
  if (etcSum>0) collapsed['기타']=etcSum;
  _renderAnalysisBarChart(canvasId, collapsed);
}

function renderAnalysisBar(canvasId, dataMap) {
  const sorted=Object.entries(dataMap).sort((a,b)=>b[1]-a[1]);
  const topN=8; const collapsed={};
  sorted.slice(0,topN).forEach(([k,v])=>{ collapsed[k]=v; });
  const etcSum=sorted.slice(topN).reduce((s,[,v])=>s+v,0);
  if (etcSum>0) collapsed['기타']=etcSum;
  _renderAnalysisBarChart(canvasId, collapsed);
}

// ══════════════════════════════════════════════
//  유틸
// ══════════════════════════════════════════════
function _fmtWon(n) {
  if (!n && n !== 0) return '—';
  return Math.round(n).toLocaleString('ko-KR');
}
