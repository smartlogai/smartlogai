/* ============================================
   analysis.js — 업무 분석 + 고과 분석 + 인건비 분석
   ============================================ */

let _analysisCharts = {};
let _currentAnalysisTab = 'work'; // 'work' | 'staff' | 'labor'

// ─────────────────────────────────────────────
// 업무분석 통계 공통 유틸
// ─────────────────────────────────────────────
function _topNWithEtc(dataMap, topN = 8, etcLabel = '기타') {
  const sorted = Object.entries(dataMap || {}).sort((a, b) => (b[1] || 0) - (a[1] || 0));
  const collapsed = {};
  sorted.slice(0, topN).forEach(([k, v]) => { collapsed[k] = v; });
  const etcSum = sorted.slice(topN).reduce((s, [, v]) => s + (Number(v) || 0), 0);
  if (etcSum > 0) collapsed[etcLabel] = etcSum;
  return collapsed;
}

function _renderRankList(containerId, rows, opts = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const {
    emptyText = '데이터가 없습니다.',
    unit = '',
    valueFormatter = (v) => String(v ?? ''),
    secondaryFormatter = null,
    maxRows = 10,
  } = opts;

  const list = Array.isArray(rows) ? rows.slice(0, maxRows) : [];
  if (!list.length) {
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9aa4b2;font-size:12px">${emptyText}</div>`;
    return;
  }

  const maxVal = Math.max(...list.map(r => Number(r.value) || 0), 0);
  const totalVal = list.reduce((s, r) => s + (Number(r.value) || 0), 0);

  el.innerHTML = list.map((r, idx) => {
    const v = Number(r.value) || 0;
    const barW = maxVal > 0 ? (v / maxVal * 100) : 0;
    const pct = totalVal > 0 ? Math.round(v / totalVal * 100) : 0;
    const label = Utils.escHtml(r.label || '');
    const valueTxt = Utils.escHtml(valueFormatter(v));
    const secondaryTxt = secondaryFormatter ? secondaryFormatter(r) : '';
    const muted = '#94a3b8';
    const baseColor = '45,107,181';
    const opacity = Math.max(0.45, 1 - idx * (0.55 / Math.max(list.length - 1, 1)));
    const barClr = `rgba(${baseColor},${opacity.toFixed(2)})`;

    return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 2px;border-bottom:1px solid #f4f6f9">
        <div style="min-width:110px;max-width:170px;font-size:11.5px;color:#475569;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${label}">${label}</div>
        <div style="flex:1;height:7px;background:#f0f4f8;border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${barW.toFixed(1)}%;background:${barClr};border-radius:99px"></div>
        </div>
        <div style="min-width:70px;text-align:right">
          <div style="font-size:12px;font-weight:800;color:#1a2b45;white-space:nowrap">${valueTxt}${unit ? `<span style="font-size:10px;color:${muted};margin-left:2px">${unit}</span>` : ''}</div>
          <div style="font-size:10.5px;color:${muted};margin-top:1px;white-space:nowrap">${pct}%${secondaryTxt ? ` · ${secondaryTxt}` : ''}</div>
        </div>
      </div>`;
  }).join('');
}

function _getVisibleUserIdSetForAnalysis(session, allUsers) {
  const s = session || {};
  const users = Array.isArray(allUsers) ? allUsers : [];
  const role = s.role || '';
  const sid = String(s.id || '');

  if (!sid) return new Set();
  if (role === 'admin') return null; // null = no restriction
  if (role === 'staff') return new Set([sid]);
  if (role === 'manager') {
    // 팀장: 승인자 지정(approver_id) 기준 팀원만
    return new Set(
      users
        .filter(u => String(u.approver_id || '') === sid)
        .map(u => String(u.id))
        .filter(Boolean)
    );
  }
  if (role === 'director') {
    const deptId = String(s.dept_id || '');
    const hqId = String(s.hq_id || '');

    // 본부장: 최종승인자(reviewer2_id)로 지정된 직원만
    if (hqId) {
      return new Set(
        users
          .filter(u => String(u.reviewer2_id || '') === sid)
          .map(u => String(u.id))
          .filter(Boolean)
      );
    }
    // 사업부장: 동일 사업부(dept_id) 전체 직원
    if (deptId) {
      return new Set(
        users
          .filter(u => String(u.dept_id || '') === deptId)
          .map(u => String(u.id))
          .filter(Boolean)
      );
    }
    // 예외: 소속값이 없으면 기존 scopeMatch로 fallback (최소한의 안전망)
    return new Set(
      users
        .filter(u => Auth.scopeMatch(s, u))
        .map(u => String(u.id))
        .filter(Boolean)
    );
  }
  return new Set([sid]);
}

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

  // ── 날짜 초기값 ─────────────────────────────────────────
  // 업무분석(work) 탭: From/To 입력은 비워두고, 내부 집계는 loadAnalysis()에서 "이번달 누적(1일~오늘)"로 처리
  // (사용자에게 '한달 전체'로 오해를 주지 않기 위함)
  ['filter-analysis-date-from','filter-analysis-date-to'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const periodBadge = document.getElementById('analysis-period-badge');
  if (periodBadge) periodBadge.style.display = 'none';

  // 고과분석(staff) 탭: From=올해 1/1, To=빈칸 (To 미입력 시 올해 누적은 loadStaffAnalysis에서 처리)
  const now = new Date();
  const y = now.getFullYear();
  const firstDay = `${y}-01-01`;
  ['filter-staff-date-from'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = firstDay;
  });
  ['filter-staff-date-to'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
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

  // 담당자(Staff) 목록 (담당자 검색형 선택용)
  const staffs = allUsers.filter(u => u.role === 'staff');

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
  function _initStaffSearch(wrapId, deptValue, csTeamValue, keepSelection = true) {
    const list = staffs
      .filter(u => (!deptValue  || u.department   === deptValue)
               && (!csTeamValue || u.cs_team_name === csTeamValue))
      .map(u => ({ id: String(u.id), name: u.name || '' }))
      .filter(u => u.id && u.name);

    if (typeof UserSearchSelect === 'undefined') return;
    const prev = keepSelection ? (UserSearchSelect.getValue(wrapId) || { id:'', name:'' }) : { id:'', name:'' };

    UserSearchSelect.init(wrapId, list, { placeholder: '담당자 검색/선택' });

    // 기존 선택이 새 목록에도 있으면 유지, 아니면 자동 해제
    if (prev.id && list.some(u => String(u.id) === String(prev.id))) {
      const name = list.find(u => String(u.id) === String(prev.id))?.name || prev.name || '';
      UserSearchSelect.setValue(wrapId, prev.id, name);
    }
  }

  // ── 업무분석 필터 세팅 ───────────────────────────────────
  _fillDept('filter-analysis-department');
  _fillCsTeam('filter-analysis-csteam');
  _initStaffSearch('filter-analysis-staff-wrap', '', '');
  if (typeof ClientSearchSelect !== 'undefined') {
    ClientSearchSelect.init('filter-analysis-client-wrap', clients, { placeholder: '고객사 검색/선택' });
  }

  // 대분류 드롭다운 — time_entries에서 동적 수집
  await _loadCategoryFilters();

  // ── 고과분석 필터 세팅 ───────────────────────────────────
  _fillDept('filter-staff-department');
  _fillCsTeam('filter-staff-csteam');
  _initStaffSearch('filter-staff-staff-wrap', '', '');

  // ── 인건비 분석 필터 세팅 ─────────────────────────────────
  _fillDept('filter-labor-department');
  _fillLaborHqOptions('filter-labor-hq', '', allUsers);
  _fillLaborCsTeamOptions('filter-labor-csteam', '', '', allUsers, csTeamList);
  _initStaffSearch('filter-labor-staff-wrap', '', '');

  // ── 현재 탭으로 전환 — switchAnalysisTab 내부에서 탭별 데이터 로드 실행됨 ──
  switchAnalysisTab(_currentAnalysisTab);
  // work 탭은 switchAnalysisTab에서 자동 호출하지 않으므로 여기서 직접 호출
  if (_currentAnalysisTab === 'work') await loadAnalysis();

  // ── 전역에 헬퍼 저장 (사업부 변경 시 재사용) ────────────
  window._analysisFillCsTeam  = _fillCsTeam;
  window._analysisInitStaffSearch = _initStaffSearch;
  window._analysisAllUsers    = allUsers;
  window._analysisCsTeamList  = csTeamList;
}

// ─────────────────────────────────────────────
// 대분류 / 소분류 드롭다운 동적 로드
// ─────────────────────────────────────────────
let _categoryMap = {}; // { 대분류명: Set(소분류명) }

async function _loadCategoryFilters() {
  try {
    // ★ 대시보드 캐시 재사용 (Master 캐시와 공유)
    const entries = await Cache.get('dash_time_entries', () => API.fetchAllTimeEntriesForDash(), 180000);
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
  const csTeam = document.getElementById('filter-analysis-csteam')?.value || '';
  if (window._analysisInitStaffSearch) window._analysisInitStaffSearch('filter-analysis-staff-wrap', dept, csTeam);
}

function onAnalysisCsTeamChange() {
  const dept   = document.getElementById('filter-analysis-department')?.value || '';
  const csTeam = document.getElementById('filter-analysis-csteam')?.value || '';
  if (window._analysisInitStaffSearch) window._analysisInitStaffSearch('filter-analysis-staff-wrap', dept, csTeam);
}

// 사업부 변경 시 고객지원팀·승인자 연동 (고과분석)
function onStaffDepartmentChange() {
  const dept = document.getElementById('filter-staff-department').value;
  if (window._analysisFillCsTeam) window._analysisFillCsTeam('filter-staff-csteam', dept);
  const csTeam = document.getElementById('filter-staff-csteam')?.value || '';
  if (window._analysisInitStaffSearch) window._analysisInitStaffSearch('filter-staff-staff-wrap', dept, csTeam);
}

function onStaffCsTeamChange() {
  const dept   = document.getElementById('filter-staff-department')?.value || '';
  const csTeam = document.getElementById('filter-staff-csteam')?.value || '';
  if (window._analysisInitStaffSearch) window._analysisInitStaffSearch('filter-staff-staff-wrap', dept, csTeam);
}

// ── 인건비 탭: 본부·고객지원팀 필터 (users / cs_teams 마스터) ──
function _fillLaborHqOptions(elId, deptValue, allUsers) {
  const el = document.getElementById(elId);
  if (!el) return;
  const cur = el.value;
  el.innerHTML = '<option value="">전체 본부</option>';
  const names = [...new Set(
    (allUsers || []).filter(u => !deptValue || u.department === deptValue).map(u => u.hq_name).filter(Boolean)
  )].sort();
  names.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n;
    el.appendChild(opt);
  });
  if (names.includes(cur)) el.value = cur;
}

function _fillLaborCsTeamOptions(elId, deptValue, hqValue, allUsers, csTeamList) {
  const el = document.getElementById(elId);
  if (!el) return;
  const cur = el.value;
  el.innerHTML = '<option value="">전체 팀</option>';
  let nameSet;
  if (csTeamList && csTeamList.length > 0) {
    nameSet = new Set(
      csTeamList
        .filter(t => {
          const dn = t.department_name || t.dept_name || '';
          const matchDept = !deptValue || dn === deptValue || t.department === deptValue;
          const hn = t.hq_name || '';
          const matchHq = !hqValue || hn === hqValue;
          return matchDept && matchHq;
        })
        .map(t => t.cs_team_name || t.name)
        .filter(Boolean)
    );
  } else {
    nameSet = new Set(
      (allUsers || [])
        .filter(u =>
          (!deptValue || u.department === deptValue) &&
          (!hqValue || u.hq_name === hqValue)
        )
        .map(u => u.cs_team_name)
        .filter(Boolean)
    );
  }
  [...nameSet].sort().forEach(n => {
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n;
    el.appendChild(opt);
  });
  if ([...el.options].some(o => o.value === cur)) el.value = cur;
}

function onLaborDepartmentChange() {
  const dept = document.getElementById('filter-labor-department')?.value || '';
  const users = window._analysisAllUsers || [];
  const csList = window._analysisCsTeamList || [];
  _fillLaborHqOptions('filter-labor-hq', dept, users);
  const hqEl = document.getElementById('filter-labor-hq');
  if (hqEl) hqEl.value = '';
  _fillLaborCsTeamOptions('filter-labor-csteam', dept, '', users, csList);
  const csEl = document.getElementById('filter-labor-csteam');
  if (csEl) csEl.value = '';
  if (window._analysisInitStaffSearch) window._analysisInitStaffSearch('filter-labor-staff-wrap', dept, '');
}

function onLaborHqChange() {
  const dept = document.getElementById('filter-labor-department')?.value || '';
  const hq = document.getElementById('filter-labor-hq')?.value || '';
  const users = window._analysisAllUsers || [];
  const csList = window._analysisCsTeamList || [];
  _fillLaborCsTeamOptions('filter-labor-csteam', dept, hq, users, csList);
  const csEl = document.getElementById('filter-labor-csteam');
  if (csEl) csEl.value = '';
  onLaborCsTeamChange();
}

function onLaborCsTeamChange() {
  const dept = document.getElementById('filter-labor-department')?.value || '';
  const csTeam = document.getElementById('filter-labor-csteam')?.value || '';
  if (window._analysisInitStaffSearch) window._analysisInitStaffSearch('filter-labor-staff-wrap', dept, csTeam);
}

// ══════════════════════════════════════════════
//  서브탭1: 업무 분석 (기존)
// ══════════════════════════════════════════════

async function loadAnalysis() {
  const session = getSession();
  let dateFrom      = document.getElementById('filter-analysis-date-from').value;
  let dateTo        = document.getElementById('filter-analysis-date-to').value;
  const deptFilter    = (document.getElementById('filter-analysis-department') || {}).value || '';
  const csTeamFilter  = (document.getElementById('filter-analysis-csteam')    || {}).value || '';
  const staffFilter   = (typeof UserSearchSelect !== 'undefined')
    ? (UserSearchSelect.getValue('filter-analysis-staff-wrap')?.id || '')
    : ((document.getElementById('filter-analysis-staff') || {}).value || '');
  const clientFilter  = (typeof ClientSearchSelect !== 'undefined')
    ? (ClientSearchSelect.getValue('filter-analysis-client-wrap')?.id || '')
    : ((document.getElementById('filter-analysis-client') || {}).value || '');
  const catFilter     = (document.getElementById('filter-analysis-category')  || {}).value || '';
  const subFilter     = (document.getElementById('filter-analysis-subcategory')|| {}).value || '';

  try {
    const periodBadge = document.getElementById('analysis-period-badge');
    const hasCustomRange = !!(dateFrom || dateTo);

    // 날짜를 지정하지 않으면: 내부적으로만 이번 달 1일 ~ 오늘(누적) 적용 (입력값은 건드리지 않음)
    if (!hasCustomRange) {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const fromStr = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const toStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      dateFrom = fromStr;
      dateTo = toStr;
      if (periodBadge) {
        const mm = String(m + 1).padStart(2, '0');
        periodBadge.textContent = `이번달 누적 (${mm}/01~오늘)`;
        periodBadge.style.display = '';
      }
    } else {
      if (periodBadge) periodBadge.style.display = 'none';
    }

    // ★ 캐시된 time_entries 재사용
    let entries = await Cache.get('dash_time_entries', () => API.fetchAllTimeEntriesForDash(), 180000);

    // 역할별 범위 제한 (승인자/소속 기준으로 통일)
    const allUsers = (window._analysisAllUsers || await Master.users());
    const visibleUserIds = _getVisibleUserIdSetForAnalysis(session, allUsers);
    if (visibleUserIds) {
      entries = entries.filter(e => visibleUserIds.has(String(e.user_id)));
    }
    entries = entries.filter(e => e.status === 'approved');

    // 기간 필터 (기본값 포함)
    const from = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : 0;
    const to   = dateTo
      ? new Date(dateTo + 'T23:59:59').getTime()
      : new Date().setHours(23,59,59,999); // To 미입력: 오늘까지 누적
    entries = entries.filter(e => {
      if (!e.work_start_at) return false;
      const ts = Number(e.work_start_at);
      return ts >= from && ts <= to;
    });

    // 사업부 필터: 담당자(user)의 department 필드로 필터
    if (deptFilter) {
      const userIdsInDept = new Set(allUsers.filter(u => u.department === deptFilter).map(u => u.id));
      entries = entries.filter(e => userIdsInDept.has(e.user_id));
    }
    // 고객지원팀 필터: 담당자의 cs_team_name 필드로 필터
    if (csTeamFilter) {
      const userIdsInCsTeam = new Set(allUsers.filter(u => u.cs_team_name === csTeamFilter).map(u => u.id));
      entries = entries.filter(e => userIdsInCsTeam.has(e.user_id));
    }
    // 담당자(Staff) 필터
    if (staffFilter) entries = entries.filter(e => String(e.user_id) === String(staffFilter));
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

    // 1) 소분류(업무유형)별 투입비율
    const subMap = {};
    entries.forEach(e => {
      const key = e.work_subcategory_name || '미분류';
      subMap[key] = (subMap[key]||0) + (e.duration_minutes||0);
    });
    renderAnalysisDonut('analysis-chart-category', _topNWithEtc(subMap, 8));

    // 2) 고객사별 투입비율 (고객업무만)
    const cliMap = {};
    entries.filter(e => e.time_category === 'client' && e.client_id).forEach(e => {
      const key = e.client_name || '미지정';
      cliMap[key] = (cliMap[key]||0) + (e.duration_minutes||0);
    });
    renderAnalysisBar('analysis-chart-client', _topNWithEtc(cliMap, 8));

    // 3) 소분류별 평균 소요시간(분)
    const subAgg = {}; // key -> {sum,count}
    entries.forEach(e => {
      const key = e.work_subcategory_name || '미분류';
      const min = Number(e.duration_minutes) || 0;
      if (!subAgg[key]) subAgg[key] = { sum: 0, count: 0 };
      subAgg[key].sum += min;
      subAgg[key].count += 1;
    });
    const subAvgRows = Object.entries(subAgg)
      .filter(([, v]) => (v.count || 0) > 0)
      .map(([k, v]) => ({ label: k, value: v.sum / v.count, count: v.count }))
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    _renderRankList('analysis-subcategory-avg', subAvgRows, {
      unit: '분',
      maxRows: 10,
      valueFormatter: (v) => (Number(v) || 0).toFixed(1),
      secondaryFormatter: (r) => `${r.count}건`,
      emptyText: '해당 조건의 소분류 데이터가 없습니다.',
    });

    // 4) 담당자별 자문건수(고객업무) + 투입시간
    const staffAgg = {}; // userId -> {name,totalMin,clientMin,clientCount}
    entries.forEach(e => {
      const uid = String(e.user_id || '');
      if (!uid) return;
      if (!staffAgg[uid]) staffAgg[uid] = { name: e.user_name || uid, totalMin: 0, clientMin: 0, clientCount: 0 };
      const min = Number(e.duration_minutes) || 0;
      staffAgg[uid].totalMin += min;
      if (e.time_category === 'client') {
        staffAgg[uid].clientMin += min;
        staffAgg[uid].clientCount += 1;
      }
    });
    const staffRows = Object.entries(staffAgg)
      .map(([uid, v]) => ({ label: v.name || uid, value: v.totalMin, clientCount: v.clientCount, clientMin: v.clientMin }))
      .sort((a, b) => (b.value || 0) - (a.value || 0));
    _renderRankList('analysis-staff-advisory', staffRows, {
      unit: 'h',
      maxRows: 10,
      valueFormatter: (mins) => ((Number(mins) || 0) / 60).toFixed(1),
      secondaryFormatter: (r) => `자문 ${r.clientCount}건`,
      emptyText: '해당 조건의 담당자 데이터가 없습니다.',
    });

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
  const ids = ['filter-analysis-department','filter-analysis-csteam',
               'filter-analysis-category','filter-analysis-subcategory'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  if (typeof UserSearchSelect !== 'undefined') UserSearchSelect.clear('filter-analysis-staff-wrap');
  if (typeof ClientSearchSelect !== 'undefined') ClientSearchSelect.clear('filter-analysis-client-wrap');
  loadAnalysis();
}

// ══════════════════════════════════════════════
//  서브탭2: 고과 분석
// ══════════════════════════════════════════════

function _getPerfWeightDefaults() {
  return { time: 25, advisory: 20, efficiency: 20, independent: 15, rating: 20 };
}

function _normalizeWeights(w) {
  const keys = ['time','advisory','efficiency','independent','rating'];
  const raw = {};
  keys.forEach(k => raw[k] = Math.max(0, Number(w?.[k]) || 0));
  const sum = keys.reduce((s,k)=>s+raw[k],0);
  if (sum <= 0) return _getPerfWeightDefaults();
  const scaled = {};
  keys.forEach(k => scaled[k] = (raw[k] / sum) * 100);
  // 표시용으로 1자리까지 반올림하되, 계산은 실수 유지
  return scaled;
}

function _loadPerfWeights() {
  try {
    const saved = JSON.parse(localStorage.getItem('perf_weights_v1') || 'null');
    if (!saved) return _getPerfWeightDefaults();
    return _normalizeWeights(saved);
  } catch(e) {
    return _getPerfWeightDefaults();
  }
}

function _savePerfWeights(w) {
  try {
    localStorage.setItem('perf_weights_v1', JSON.stringify(_normalizeWeights(w)));
  } catch(e) {}
}

function _canEditPerfWeights(session) {
  return !!(session && (session.role === 'admin' || session.role === 'director'));
}

function openPerfWeightsModal() {
  const session = getSession();
  const canEdit = _canEditPerfWeights(session);
  const cur = _loadPerfWeights();

  const el = document.getElementById('perf-weights-modal');
  if (!el) {
    Toast.error('가중치 UI를 찾을 수 없습니다. (perf-weights-modal)');
    return;
  }
  const set = (id, v) => { const x = document.getElementById(id); if (x) x.value = String(Math.round(v)); };
  set('pw-time', cur.time);
  set('pw-advisory', cur.advisory);
  set('pw-efficiency', cur.efficiency);
  set('pw-independent', cur.independent);
  set('pw-rating', cur.rating);

  const lockEls = ['pw-time','pw-advisory','pw-efficiency','pw-independent','pw-rating','pw-apply','pw-reset'];
  lockEls.forEach(id => {
    const x = document.getElementById(id);
    if (x) x.disabled = !canEdit;
  });
  const hint = document.getElementById('pw-hint');
  if (hint) {
    hint.textContent = canEdit ? '가중치는 합계 100으로 자동 정규화됩니다.' : '가중치 변경은 관리자/사업부장만 가능합니다.';
  }
  el.style.display = 'flex';
}

function closePerfWeightsModal() {
  const el = document.getElementById('perf-weights-modal');
  if (el) el.style.display = 'none';
}

function applyPerfWeights() {
  const session = getSession();
  if (!_canEditPerfWeights(session)) {
    Toast.warning('가중치 변경 권한이 없습니다.');
    return;
  }
  const get = (id) => Number(document.getElementById(id)?.value) || 0;
  const w = _normalizeWeights({
    time: get('pw-time'),
    advisory: get('pw-advisory'),
    efficiency: get('pw-efficiency'),
    independent: get('pw-independent'),
    rating: get('pw-rating'),
  });
  _savePerfWeights(w);
  Toast.success('가중치를 저장했습니다.');
  closePerfWeightsModal();
  loadStaffAnalysis();
}

function resetPerfWeights() {
  const session = getSession();
  if (!_canEditPerfWeights(session)) return;
  const def = _getPerfWeightDefaults();
  _savePerfWeights(def);
  Toast.success('기본 가중치로 초기화했습니다.');
  closePerfWeightsModal();
  loadStaffAnalysis();
}

function resetStaffFilter() {
  const now = new Date();
  const y = now.getFullYear();
  document.getElementById('filter-staff-date-from').value = `${y}-01-01`;
  document.getElementById('filter-staff-date-to').value = '';
  const ids = ['filter-staff-department','filter-staff-csteam'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  if (typeof UserSearchSelect !== 'undefined') UserSearchSelect.clear('filter-staff-staff-wrap');
  loadStaffAnalysis();
}

let _staffRankSearchTimer = null;
function onStaffRankSearchInput() {
  if (_staffRankSearchTimer) clearTimeout(_staffRankSearchTimer);
  _staffRankSearchTimer = setTimeout(() => {
    loadStaffAnalysis();
  }, 120);
}

function clearStaffRankSearch() {
  const el = document.getElementById('staff-rank-search');
  if (el) el.value = '';
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
  const staffFilter    = (typeof UserSearchSelect !== 'undefined')
    ? (UserSearchSelect.getValue('filter-staff-staff-wrap')?.id || '')
    : ((document.getElementById('filter-staff-staff') || {}).value || '');

  const kpiEl    = document.getElementById('staff-analysis-kpi');

  try {
    const SCORE_WEIGHTS = _loadPerfWeights(); // 합계 100(정규화)
    const MIN_BENCH_SUB_COUNT = 5;   // 소분류 벤치마크 최소 표본
    const MIN_USER_SUB_COUNT  = 2;   // 직원 소분류 평균 최소 표본
    const MIN_RATING_COUNT    = 2;   // 별점(품질+전문성) 최소 표본

    const percentileScore = (values, v, higherIsBetter = true) => {
      const clean = (values || []).filter(x => x !== null && x !== undefined && !isNaN(Number(x))).map(Number);
      const n = clean.length;
      if (!n || v === null || v === undefined || isNaN(Number(v))) return 0;
      const vv = Number(v);
      let less = 0, equal = 0;
      for (const x of clean) {
        if (x < vv) less++;
        else if (x === vv) equal++;
      }
      const p = ((less + (equal * 0.5)) / n) * 100;
      const score = higherIsBetter ? p : (100 - p);
      return Math.max(0, Math.min(100, score));
    };

    // ── 데이터 로드 ★ Master/캐시 활용 ────────────────────
    const [allEntries_raw, allUsers, archiveItems] = await Promise.all([
      Cache.get('dash_time_entries', () => API.fetchAllTimeEntriesForDash(), 180000),
      Master.users(),
      Cache.get('dash_archive_stars', async () => {
        const r = await API.list('archive_items', { limit: 2000 });
        return (r && r.data) ? r.data : [];
      }, 300000),
    ]);
    let allEntries = (Array.isArray(allEntries_raw) ? allEntries_raw : []).slice(); // 원본 불변 유지용 복사
    const safeUsers = Array.isArray(allUsers) ? allUsers : [];
    const safeArchives = Array.isArray(archiveItems) ? archiveItems : [];

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
      const scopeIds = new Set(safeUsers.filter(u => Auth.scopeMatch(session, u)).map(u => String(u.id)));
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
    const to   = dateTo
      ? new Date(dateTo + 'T23:59:59').getTime()
      : new Date().setHours(23,59,59,999); // To 미입력: 오늘까지 누적
    const periodEntries = allEntries.filter(e => {
      if (e.status !== 'approved' || !e.work_start_at) return false;
      const ts = _safe_ts(e.work_start_at);
      return ts >= from && ts <= to;
    });

    // ── 사업부 / 고객지원팀 / 담당자 필터 ───────────────────
    // 벤치마크(유형별 평균)는 "조직 범위" 기준으로 계산하기 위해 staffFilter는 제외하고 계산
    let benchmarkEntries = [...periodEntries];
    let filteredEntries = [...periodEntries];

    if (deptFilter || csTeamFilter) {
      const matchedUserIds = new Set(
        safeUsers.filter(u =>
          (!deptFilter   || u.department   === deptFilter) &&
          (!csTeamFilter || u.cs_team_name === csTeamFilter)
        ).map(u => String(u.id))
      );
      benchmarkEntries = benchmarkEntries.filter(e => matchedUserIds.has(e.user_id));
      filteredEntries = filteredEntries.filter(e => matchedUserIds.has(e.user_id));
    }
    if (staffFilter) filteredEntries = filteredEntries.filter(e => e.user_id === String(staffFilter));

    // ── 순위 통계(기간필터 기준) ───────────────────────────
    const _rankRender = (containerId, rows, opts = {}) => {
      const el = document.getElementById(containerId);
      if (!el) return;
      const q = (document.getElementById('staff-rank-search')?.value || '').trim().toLowerCase();
      const filtered = (q && Array.isArray(rows))
        ? rows.filter(r => String(r.label || '').toLowerCase().includes(q))
        : rows;
      const emptyText = opts.emptyText || '데이터가 없습니다.';
      if (!filtered || !filtered.length) {
        el.innerHTML = `<div style="text-align:center;padding:18px;color:var(--text-muted);font-size:13px">${emptyText}</div>`;
        return;
      }
      el.innerHTML = filtered.slice(0, opts.maxRows || 9999).map((r, idx) => {
        const sub = r.sub || '';
        const secondary = (opts.secondaryFormatter ? opts.secondaryFormatter(r) : (r.secondary || ''));
        const value = (opts.valueFormatter ? opts.valueFormatter(r.value) : (r.value ?? ''));
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;
                      padding:7px 8px;border-bottom:1px solid #f1f5f9">
            <div style="min-width:0">
              <div style="font-size:12px;font-weight:800;color:#1a2b45">${idx+1}. ${r.label || '-'}</div>
              ${sub ? `<div style="font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${sub}">${sub}</div>` : ''}
              ${secondary ? `<div style="font-size:10px;color:#94a3b8">${secondary}</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:13px;font-weight:900;color:#1a2b45">${value}${opts.unit ? `<span style="font-size:10px;color:#94a3b8;margin-left:2px">${opts.unit}</span>` : ''}</div>
            </div>
          </div>
        `;
      }).join('');
    };

    const clientEntries = filteredEntries.filter(e => e.time_category === 'client');

    // ── 대상 직원 목록: 승인자 지정 + 타임시트 대상만 (staff + 타임시트 대상 manager 포함) ────────
    let targetUsers = safeUsers
      .filter(u =>
        (u.role === 'staff' || u.role === 'manager') &&
        u.is_active !== false &&
        u.is_timesheet_target !== false &&
        (u.role === 'manager'
          ? true
          : (u.approver_id && String(u.approver_id).trim() !== ''))
      )
      .map(u => ({ ...u, id: String(u.id || '') }));

    if (deptFilter)    targetUsers = targetUsers.filter(u => u.department   === deptFilter);
    if (csTeamFilter)  targetUsers = targetUsers.filter(u => u.cs_team_name === csTeamFilter);
    if (staffFilter)  targetUsers = targetUsers.filter(u => String(u.id) === String(staffFilter));

    // 자문시간/자문건수(직원)
    const advByUser = {};
    clientEntries.forEach(e => {
      const uid = String(e.user_id || '');
      if (!uid) return;
      if (!advByUser[uid]) advByUser[uid] = { label: e.user_name || uid, advisoryMin: 0, advisoryCount: 0 };
      advByUser[uid].advisoryMin += (Number(e.duration_minutes) || 0);
      advByUser[uid].advisoryCount += 1;
    });
    const advTimeRank = Object.values(advByUser)
      .map(v => ({ label: v.label, value: v.advisoryMin, advisoryCount: v.advisoryCount }))
      .sort((a,b)=>(b.value||0)-(a.value||0));
    const advCountRank = Object.values(advByUser)
      .map(v => ({ label: v.label, value: v.advisoryCount, advisoryMin: v.advisoryMin }))
      .sort((a,b)=>(b.value||0)-(a.value||0));

    _rankRender('staff-rank-advisory-time', advTimeRank, {
      unit: 'h',
      valueFormatter: (mins) => ((Number(mins)||0)/60).toFixed(1),
      secondaryFormatter: (r) => `자문 ${r.advisoryCount||0}건`,
      emptyText: '자문 데이터가 없습니다.',
    });
    _rankRender('staff-rank-advisory-count', advCountRank, {
      unit: '건',
      valueFormatter: (n) => `${Number(n)||0}`,
      secondaryFormatter: (r) => `자문 ${(Number(r.advisoryMin)||0)/60 >= 0 ? ((Number(r.advisoryMin)||0)/60).toFixed(1) : '0.0'}h`,
      emptyText: '자문 데이터가 없습니다.',
    });

    // 자문 업무유형(소분류) 평균소요(유형)
    const subAgg = {};
    clientEntries.forEach(e => {
      const sub = (e.work_subcategory_name || '').trim();
      const m = Number(e.duration_minutes) || 0;
      if (!sub || m <= 0) return;
      if (!subAgg[sub]) subAgg[sub] = { sum: 0, cnt: 0 };
      subAgg[sub].sum += m; subAgg[sub].cnt += 1;
    });
    const MIN_SUB_SAMPLE = 5;
    const worktypeAvgRank = Object.entries(subAgg)
      .filter(([_,v]) => v.cnt >= MIN_SUB_SAMPLE)
      .map(([sub,v]) => ({ label: sub, value: v.sum/v.cnt, cnt: v.cnt }))
      .sort((a,b)=>(b.value||0)-(a.value||0));
    _rankRender('staff-rank-advisory-worktype-avg', worktypeAvgRank, {
      unit: '분',
      valueFormatter: (v) => (Number(v)||0).toFixed(1),
      secondaryFormatter: (r) => `표본 ${r.cnt||0}건`,
      emptyText: `자문 소분류 평균은 표본 ${MIN_SUB_SAMPLE}건 이상부터 표시됩니다.`,
    });

    // 독립수행(직원) — 수행방식 표본 5건 이상
    const indepRank = [];
    const indepRatingRank = [];
    const MIN_PERF_SAMPLE = 5;
    const MIN_INDEP_RATING_SAMPLE = 3;
    targetUsers.forEach(u => {
      const uid = String(u.id||'');
      const uEntries = filteredEntries.filter(e => String(e.user_id) === uid);
      const perf = uEntries.filter(e => e.performance_type);
      if (perf.length >= MIN_PERF_SAMPLE) {
        const indepCnt = perf.filter(e => e.performance_type === 'independent').length;
        const indepRate = perf.length ? (indepCnt / perf.length) : 0;
        indepRank.push({ label: u.name || uid, value: indepRate, indepCnt, perfTotal: perf.length });

        // 독립수행 별점(전문성 competency_stars 기반)
        const indepEntries = perf.filter(e => e.performance_type === 'independent');
        const rated = indepEntries
          .map(e => parseInt(e.competency_stars))
          .filter(x => !isNaN(x) && x > 0);
        if (rated.length >= MIN_INDEP_RATING_SAMPLE) {
          const avg = rated.reduce((s,x)=>s+x,0) / rated.length;
          indepRatingRank.push({ label: u.name || uid, value: avg, cnt: rated.length, indepCnt });
        }
      }
    });
    indepRank.sort((a,b)=>(b.value||0)-(a.value||0));
    indepRatingRank.sort((a,b)=>(b.value||0)-(a.value||0));

    _rankRender('staff-rank-independent', indepRank, {
      unit: '%',
      valueFormatter: (v) => `${Math.round((Number(v)||0)*100)}`,
      secondaryFormatter: (r) => `독립 ${r.indepCnt||0} / 총 ${r.perfTotal||0}`,
      emptyText: `수행방식 표본 ${MIN_PERF_SAMPLE}건 이상부터 표시됩니다.`,
    });
    _rankRender('staff-rank-independent-rating', indepRatingRank, {
      unit: '점',
      valueFormatter: (v) => (Number(v)||0).toFixed(2),
      secondaryFormatter: (r) => `표본 ${r.cnt||0}건 · 독립 ${r.indepCnt||0}건`,
      emptyText: `독립수행 별점은 표본 ${MIN_INDEP_RATING_SAMPLE}건 이상부터 표시됩니다.`,
    });

    // ── 소분류(업무유형) 벤치마크 평균(분) ───────────────────
    const benchAgg = {}; // { sub: { sum, cnt } }
    benchmarkEntries.forEach(e => {
      const sub = (e.work_subcategory_name || '').trim();
      const m = Number(e.duration_minutes) || 0;
      if (!sub || m <= 0) return;
      if (!benchAgg[sub]) benchAgg[sub] = { sum: 0, cnt: 0 };
      benchAgg[sub].sum += m;
      benchAgg[sub].cnt += 1;
    });
    const benchMin = {}; // { sub: avgMin }
    Object.entries(benchAgg).forEach(([sub, v]) => {
      if (v.cnt >= MIN_BENCH_SUB_COUNT) benchMin[sub] = v.sum / v.cnt;
    });

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
      const clientCount = uEntries.filter(e => e.time_category === 'client').length;
      const intMin    = totalMin - clientMin;
      const cliRatio  = totalMin > 0 ? Math.round(clientMin/totalMin*100) : 0;

      // 품질 별점 집계 (archive_items) — 모두 String 비교
      const uArchives = safeArchives.filter(a => String(a.user_id) === u.id && parseInt(a.quality_stars) > 0);
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

      // ── 독립수행율 ──
      const indepRate = perfEntries.length > 0 ? (perfIndep / perfEntries.length) : null;

      // ── 독립수행 별점(전문성) ──
      const indepRated = perfEntries
        .filter(e => e.performance_type === 'independent')
        .map(e => parseInt(e.competency_stars))
        .filter(x => !isNaN(x) && x > 0);
      const indepRatingAvg = indepRated.length ? (indepRated.reduce((s,x)=>s+x,0) / indepRated.length) : null;
      const indepRatingCount = indepRated.length;

      // ── 별점(품질+전문성) 통합 ──
      const qualityCnt = uArchives.length;
      const compCnt = compEntries.length;
      const ratingCount = qualityCnt + compCnt;
      let ratingCombined = null;
      if (ratingCount >= MIN_RATING_COUNT) {
        const parts = [];
        if (avgStars !== null) parts.push(avgStars);
        if (avgCompStars !== null) parts.push(avgCompStars);
        if (parts.length) ratingCombined = parts.reduce((s,x)=>s+x,0) / parts.length;
      }

      // ── 효율(유형별 평균소요시간 대비) ──
      // ratio[sub] = benchAvg / userAvg (클수록 평균보다 빠름)
      const userSubAgg = {}; // { sub: { sum, cnt } }
      uEntries.forEach(e => {
        const sub = (e.work_subcategory_name || '').trim();
        const m = Number(e.duration_minutes) || 0;
        if (!sub || m <= 0) return;
        if (!benchMin[sub]) return; // 벤치마크 없는 소분류 제외
        if (!userSubAgg[sub]) userSubAgg[sub] = { sum: 0, cnt: 0 };
        userSubAgg[sub].sum += m;
        userSubAgg[sub].cnt += 1;
      });
      let effRaw = null;
      let effSupportCount = 0;
      const ratios = [];
      Object.entries(userSubAgg).forEach(([sub, v]) => {
        if (v.cnt < MIN_USER_SUB_COUNT) return;
        const uAvg = v.sum / v.cnt;
        const bAvg = benchMin[sub];
        if (!uAvg || !bAvg) return;
        const r = bAvg / uAvg;
        ratios.push({ r, w: v.cnt });
        effSupportCount += v.cnt;
      });
      if (ratios.length) {
        const wsum = ratios.reduce((s,x)=>s+x.w,0) || 1;
        effRaw = ratios.reduce((s,x)=>s+(x.r * x.w),0) / wsum;
      }

      return { u, totalMin, clientMin, clientCount, intMin, cliRatio, uArchives, star1, star2, star3, avgStars,
               compEntries, cStar1, cStar2, cStar3, avgCompStars, perfEntries, perfIndep, perfGuided, perfSuper,
               indepRate, indepRatingAvg, indepRatingCount, ratingCombined, ratingCount, effRaw, effSupportCount };
    });

    // 최다 투입자 기준
    const maxMin = Math.max(...rows.map(r=>r.totalMin), 0);

    // ── 퍼센타일 점수화 + 종합점수 ─────────────────────────
    const timeVals = rows.map(r => r.totalMin);
    const advVals  = rows.map(r => r.clientCount);
    const effVals  = rows.map(r => r.effRaw).filter(v => v !== null);
    const indepVals = rows.map(r => r.indepRate).filter(v => v !== null);
    const ratingVals = rows.map(r => r.ratingCombined).filter(v => v !== null);

    rows.forEach(r => {
      const sTime = percentileScore(timeVals, r.totalMin, true);
      const sAdv  = percentileScore(advVals,  r.clientCount, true);
      const sEff  = (r.effRaw === null) ? 0 : percentileScore(effVals, r.effRaw, true);
      const sInd  = (r.indepRate === null) ? 0 : percentileScore(indepVals, r.indepRate, true);
      const sRat  = (r.ratingCombined === null) ? 0 : percentileScore(ratingVals, r.ratingCombined, true);

      const totalScore =
        (SCORE_WEIGHTS.time       * sTime +
         SCORE_WEIGHTS.advisory   * sAdv  +
         SCORE_WEIGHTS.efficiency * sEff  +
         SCORE_WEIGHTS.independent* sInd  +
         SCORE_WEIGHTS.rating     * sRat) / 100;

      r.score = {
        total: totalScore,
        time: sTime, advisory: sAdv, efficiency: sEff, independent: sInd, rating: sRat
      };
    });

    // 내림차순 정렬 (기본: 종합점수)
    rows.sort((a,b) => (b.score?.total || 0) - (a.score?.total || 0) || (b.totalMin - a.totalMin));

    // ── KPI 렌더링 ───────────────────────────────────────
    const totalPeople  = rows.length;
    const totalAllMin  = rows.reduce((s,r)=>s+r.totalMin,0);
    const avgMin       = totalPeople > 0 ? totalAllMin/totalPeople : 0;
    const starredCount = rows.filter(r=>r.uArchives.length>0).length;
    const allStarCount = rows.reduce((s,r)=>s+r.uArchives.length,0);

    const isFiltered = !!(deptFilter || csTeamFilter || staffFilter);
    if (kpiEl) kpiEl.innerHTML =
      kpiCard('fa-users',     '', '', '분석 인원',   totalPeople,               '명', isFiltered ? '필터 적용' : '전체 직원', '', '#1a2b45') +
      kpiCard('fa-clock',     '', '', '평균 투입',   (avgMin/60).toFixed(1),    'h',  '1인 평균',         '', '#2d6bb5') +
      kpiCard('fa-star',      '', '', '별점 보유',   starredCount,              '명', `총 ${allStarCount}건`, '', '#f59e0b') +
      kpiCard('fa-trophy',    '', '', '최다 투입',   (maxMin/60).toFixed(1),    'h',  rows[0]?.u.name||'-', '', '#4a7fc4');

    // ── 종합 우수 TOP10 (현재 가중치 반영) ───────────────────
    const topEl = document.getElementById('staff-top10');
    if (topEl) {
      const q = (document.getElementById('staff-rank-search')?.value || '').trim().toLowerCase();
      const topByScoreAll = rows.slice().sort((a,b)=> (b.score?.total||0)-(a.score?.total||0) || (b.totalMin-a.totalMin));
      const topByScore = q ? topByScoreAll.filter(r => String(r.u?.name || '').toLowerCase().includes(q)) : topByScoreAll;
      if (!topByScore.length) {
        topEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">데이터가 없습니다.</div>`;
      } else {
        topEl.innerHTML = topByScore.map((r, idx) => {
          const s = r.score || { total:0,time:0,advisory:0,efficiency:0,independent:0,rating:0 };
          const line = `투입 ${Math.round(s.time)} · 자문 ${Math.round(s.advisory)} · 효율 ${Math.round(s.efficiency)} · 독립 ${Math.round(s.independent)} · 별점 ${Math.round(s.rating)}`;
          return `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;
                        padding:8px 10px;border-bottom:1px solid #f1f5f9">
              <div style="min-width:0">
                <div style="font-size:12px;font-weight:800;color:#1a2b45">${idx+1}. ${r.u.name || '-'}</div>
                <div style="font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${line}">${line}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:14px;font-weight:900;color:#f59e0b">${s.total.toFixed(1)}</div>
                <div style="font-size:10px;color:#94a3b8">종합점수</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // ── 전년대비 성장(연간 고정) TOP10 ───────────────────────
    const growthEl = document.getElementById('staff-growth-top10');
    const growthLabelEl = document.getElementById('staff-growth-period-label');
    if (growthLabelEl) {
      const baseYear = (dateFrom && /^\d{4}-/.test(dateFrom)) ? Number(dateFrom.substring(0,4)) : (new Date()).getFullYear();
      growthLabelEl.textContent = `${baseYear}년 vs ${baseYear-1}년 (연간)`;
    }
    if (growthEl) growthEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px"><i class="fas fa-spinner fa-spin"></i> 성장지표 계산 중...</div>`;

    const _yearRange = (year) => ({
      from: new Date(`${year}-01-01T00:00:00`).getTime(),
      to:   new Date(`${year}-12-31T23:59:59`).getTime(),
    });
    const _safe_ts2 = (raw) => {
      if (!raw) return 0;
      const n = Number(raw);
      if (!isNaN(n) && n > 1000000000000) return n;
      if (!isNaN(n) && n > 1000000000) return n * 1000;
      const t = new Date(raw).getTime();
      return isNaN(t) ? 0 : t;
    };

    const baseYear = (dateFrom && /^\d{4}-/.test(dateFrom)) ? Number(dateFrom.substring(0,4)) : (new Date()).getFullYear();
    const curY = baseYear;
    const prevY = baseYear - 1;
    const curR = _yearRange(curY);
    const prevR = _yearRange(prevY);

    // 조직 범위는 동일(권한/사업부/팀 필터 반영), staffFilter는 성장 TOP10 비교집단을 위해 제외
    let yearScopeEntries = allEntries.filter(e => e.status === 'approved' && e.work_start_at);
    if (deptFilter || csTeamFilter) {
      const matchedUserIds = new Set(
        allUsers.filter(u =>
          (!deptFilter   || u.department   === deptFilter) &&
          (!csTeamFilter || u.cs_team_name === csTeamFilter)
        ).map(u => String(u.id))
      );
      yearScopeEntries = yearScopeEntries.filter(e => matchedUserIds.has(String(e.user_id)));
    }

    const _calcYearBenchMin = (entries, range) => {
      const agg = {};
      entries.forEach(e => {
        const ts = _safe_ts2(e.work_start_at);
        if (ts < range.from || ts > range.to) return;
        const sub = (e.work_subcategory_name || '').trim();
        const m = Number(e.duration_minutes) || 0;
        if (!sub || m <= 0) return;
        if (!agg[sub]) agg[sub] = { sum: 0, cnt: 0 };
        agg[sub].sum += m; agg[sub].cnt += 1;
      });
      const out = {};
      Object.entries(agg).forEach(([sub, v]) => {
        if (v.cnt >= MIN_BENCH_SUB_COUNT) out[sub] = v.sum / v.cnt;
      });
      return out;
    };

    const benchCur = _calcYearBenchMin(yearScopeEntries, curR);
    const benchPrev = _calcYearBenchMin(yearScopeEntries, prevR);

    const _calcUserYear = (uid, range, benchMinYear) => {
      const uEntries = yearScopeEntries.filter(e => String(e.user_id) === String(uid));
      const inRange = uEntries.filter(e => {
        const ts = _safe_ts2(e.work_start_at);
        return ts >= range.from && ts <= range.to;
      });
      const totalMin = inRange.reduce((s,e)=>s+(Number(e.duration_minutes)||0),0);
      const advisoryEntries = inRange.filter(e=>e.time_category==='client');
      const advisoryCount = advisoryEntries.length;
      const advisoryMin = advisoryEntries.reduce((s,e)=>s+(Number(e.duration_minutes)||0),0);

      const perfEntries = inRange.filter(e => e.performance_type);
      const perfIndep = perfEntries.filter(e=>e.performance_type==='independent').length;
      const indepRate = perfEntries.length ? (perfIndep / perfEntries.length) : null;
      const indepCount = perfIndep;

      // 별점(품질+전문성)
      const uArchives = archiveItems.filter(a => String(a.user_id) === String(uid) && parseInt(a.quality_stars) > 0);
      const avgStars = uArchives.length ? (uArchives.reduce((s,a)=>s+(parseInt(a.quality_stars)||0),0) / uArchives.length) : null;
      const compEntries = inRange.filter(e => e.competency_rating && e.competency_stars !== undefined && e.competency_stars !== null);
      const avgCompStars = compEntries.length ? (compEntries.reduce((s,e)=>s+(parseInt(e.competency_stars)||0),0) / compEntries.length) : null;
      const ratingCount = uArchives.length + compEntries.length;
      let ratingCombined = null;
      if (ratingCount >= MIN_RATING_COUNT) {
        const parts = [];
        if (avgStars !== null) parts.push(avgStars);
        if (avgCompStars !== null) parts.push(avgCompStars);
        if (parts.length) ratingCombined = parts.reduce((s,x)=>s+x,0)/parts.length;
      }

      // 효율 effRaw (벤치마크 연도별)
      const userSubAgg = {};
      inRange.forEach(e => {
        const sub = (e.work_subcategory_name || '').trim();
        const m = Number(e.duration_minutes) || 0;
        if (!sub || m <= 0) return;
        if (!benchMinYear[sub]) return;
        if (!userSubAgg[sub]) userSubAgg[sub] = { sum: 0, cnt: 0 };
        userSubAgg[sub].sum += m; userSubAgg[sub].cnt += 1;
      });
      const ratios = [];
      Object.entries(userSubAgg).forEach(([sub, v]) => {
        if (v.cnt < MIN_USER_SUB_COUNT) return;
        const uAvg = v.sum / v.cnt;
        const bAvg = benchMinYear[sub];
        if (!uAvg || !bAvg) return;
        ratios.push({ r: bAvg/uAvg, w: v.cnt });
      });
      let effRaw = null;
      if (ratios.length) {
        const wsum = ratios.reduce((s,x)=>s+x.w,0) || 1;
        effRaw = ratios.reduce((s,x)=>s+(x.r*x.w),0)/wsum;
      }

      return { totalMin, advisoryMin, advisoryCount, effRaw, indepRate, indepCount, ratingCombined };
    };

    const growthRows = targetUsers.map(u => {
      const cur = _calcUserYear(u.id, curR, benchCur);
      const prev = _calcUserYear(u.id, prevR, benchPrev);
      const timeGrowth = (cur.totalMin - prev.totalMin) / Math.max(1, prev.totalMin || 0);
      const advGrowth = (cur.advisoryCount - prev.advisoryCount) / Math.max(1, prev.advisoryCount || 0);
      const effImprove = (cur.effRaw === null || prev.effRaw === null) ? 0 : (cur.effRaw - prev.effRaw);
      const indepImprove = (cur.indepRate === null || prev.indepRate === null) ? 0 : (cur.indepRate - prev.indepRate);
      const ratingImprove = (cur.ratingCombined === null || prev.ratingCombined === null) ? 0 : (cur.ratingCombined - prev.ratingCombined);
      return { u, cur, prev, timeGrowth, advGrowth, effImprove, indepImprove, ratingImprove };
    });

    const gTimeVals = growthRows.map(r => r.timeGrowth);
    const gAdvVals  = growthRows.map(r => r.advGrowth);
    const gEffVals  = growthRows.map(r => r.effImprove);
    const gIndVals  = growthRows.map(r => r.indepImprove);
    const gRatVals  = growthRows.map(r => r.ratingImprove);

    const GROWTH_W = { time:20, advisory:20, efficiency:20, independent:20, rating:20 };
    growthRows.forEach(r => {
      const sTime = percentileScore(gTimeVals, r.timeGrowth, true);
      const sAdv  = percentileScore(gAdvVals,  r.advGrowth,  true);
      const sEff  = percentileScore(gEffVals,  r.effImprove, true);
      const sInd  = percentileScore(gIndVals,  r.indepImprove,true);
      const sRat  = percentileScore(gRatVals,  r.ratingImprove,true);
      r.growthScore = {
        total: (GROWTH_W.time*sTime + GROWTH_W.advisory*sAdv + GROWTH_W.efficiency*sEff + GROWTH_W.independent*sInd + GROWTH_W.rating*sRat)/100,
        time:sTime, advisory:sAdv, efficiency:sEff, independent:sInd, rating:sRat
      };
    });
    growthRows.sort((a,b)=> (b.growthScore?.total||0)-(a.growthScore?.total||0));

    if (growthEl) {
      const q = (document.getElementById('staff-rank-search')?.value || '').trim().toLowerCase();
      const list = q ? growthRows.filter(r => String(r.u?.name || '').toLowerCase().includes(q)) : growthRows;
      if (!list.length) {
        growthEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">데이터가 없습니다.</div>`;
      } else {
        growthEl.innerHTML = list.map((r, idx) => {
          const g = r.growthScore || { total:0,time:0,advisory:0,efficiency:0,independent:0,rating:0 };
          const line = `투입 ${Math.round(g.time)} · 자문 ${Math.round(g.advisory)} · 단축 ${Math.round(g.efficiency)} · 독립 ${Math.round(g.independent)} · 별점 ${Math.round(g.rating)}`;
          return `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;
                        padding:8px 10px;border-bottom:1px solid #f1f5f9">
              <div style="min-width:0">
                <div style="font-size:12px;font-weight:800;color:#1a2b45">${idx+1}. ${r.u.name || '-'}</div>
                <div style="font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${line}">${line}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:14px;font-weight:900;color:#16a34a">${g.total.toFixed(1)}</div>
                <div style="font-size:10px;color:#94a3b8">성장점수</div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // (삭제됨) 직원별 표 렌더링

    // (삭제됨) 별점 집계 카드 렌더링

  } catch(err) {
    console.error('Staff Analysis error:', err);
    Toast.error('고과 분석 데이터 로드 실패: ' + (err?.message || String(err)), 6000);
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

// ─────────────────────────────────────────────
// 고과분석 연간 리포트 엑셀
// ─────────────────────────────────────────────
async function exportPerformanceYearlyExcel() {
  try {
    // XLSX 지연 로드
    if (typeof XLSX === 'undefined') {
      if (typeof LibLoader !== 'undefined') {
        await LibLoader.load('xlsx');
      } else {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'js/xlsx.full.min.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('XLSX 로드 실패'));
          document.head.appendChild(s);
        });
      }
    }
    if (typeof XLSX === 'undefined') {
      Toast.error('엑셀 라이브러리를 불러올 수 없습니다. 새로고침 후 다시 시도하세요.');
      return;
    }

    const session = getSession();
    if (!Auth.canViewAnalysis(session)) {
      Toast.warning('분석 열람 권한이 없습니다.');
      return;
    }

    const dateFrom = document.getElementById('filter-staff-date-from')?.value || '';
    const deptFilter     = (document.getElementById('filter-staff-department') || {}).value || '';
    const csTeamFilter   = (document.getElementById('filter-staff-csteam')    || {}).value || '';
    const staffFilter    = (typeof UserSearchSelect !== 'undefined')
      ? (UserSearchSelect.getValue('filter-staff-staff-wrap')?.id || '')
      : ((document.getElementById('filter-staff-staff') || {}).value || '');

    const baseYear = (dateFrom && /^\d{4}-/.test(dateFrom)) ? Number(dateFrom.substring(0,4)) : (new Date()).getFullYear();
    const curY = baseYear;
    const prevY = baseYear - 1;
    const weights = _loadPerfWeights();
    const growthWeights = { time:20, advisory:20, efficiency:20, independent:20, rating:20 };

    Toast.info('연간 리포트 생성 중...');

    // 데이터 로드 (화면과 동일 캐시/스코프)
    const [allEntries_raw, allUsers, archiveItems] = await Promise.all([
      Cache.get('dash_time_entries', () => API.fetchAllTimeEntriesForDash(), 180000),
      Master.users(),
      Cache.get('dash_archive_stars', async () => {
        const r = await API.list('archive_items', { limit: 2000 });
        return (r && r.data) ? r.data : [];
      }, 300000),
    ]);

    let allEntries = (allEntries_raw || []).slice().map(e => ({ ...e, user_id: String(e.user_id||''), approver_id: String(e.approver_id||'') }));
    // 역할별 범위 제한(고과분석과 동일)
    if (session.role === 'staff') allEntries = allEntries.filter(e => e.user_id === String(session.id));
    else if (session.role === 'manager') allEntries = allEntries.filter(e => e.approver_id === String(session.id));
    else if (Auth.isDirector(session)) {
      const scopeIds = new Set(allUsers.filter(u => Auth.scopeMatch(session, u)).map(u => String(u.id)));
      allEntries = allEntries.filter(e => scopeIds.has(e.user_id));
    }

    const MIN_BENCH_SUB_COUNT = 5;
    const MIN_USER_SUB_COUNT = 2;
    const MIN_RATING_COUNT = 2;
    const percentileScore = (values, v, higherIsBetter = true) => {
      const clean = (values || []).filter(x => x !== null && x !== undefined && !isNaN(Number(x))).map(Number);
      const n = clean.length;
      if (!n || v === null || v === undefined || isNaN(Number(v))) return 0;
      const vv = Number(v);
      let less = 0, equal = 0;
      for (const x of clean) {
        if (x < vv) less++;
        else if (x === vv) equal++;
      }
      const p = ((less + (equal * 0.5)) / n) * 100;
      const score = higherIsBetter ? p : (100 - p);
      return Math.max(0, Math.min(100, score));
    };
    const _safe_ts = (raw) => {
      if (!raw) return 0;
      const n = Number(raw);
      if (!isNaN(n) && n > 1000000000000) return n;
      if (!isNaN(n) && n > 1000000000) return n * 1000;
      const t = new Date(raw).getTime();
      return isNaN(t) ? 0 : t;
    };
    const _yearRange = (year) => ({
      from: new Date(`${year}-01-01T00:00:00`).getTime(),
      to:   new Date(`${year}-12-31T23:59:59`).getTime(),
    });
    const curR = _yearRange(curY);
    const prevR = _yearRange(prevY);

    // 조직 필터(사업부/팀) 반영
    let scopeEntries = allEntries.filter(e => e.status === 'approved' && e.work_start_at);
    if (deptFilter || csTeamFilter) {
      const matchedUserIds = new Set(
        allUsers.filter(u =>
          (!deptFilter   || u.department   === deptFilter) &&
          (!csTeamFilter || u.cs_team_name === csTeamFilter)
        ).map(u => String(u.id))
      );
      scopeEntries = scopeEntries.filter(e => matchedUserIds.has(String(e.user_id)));
    }

    // 대상 직원 목록(필터 포함)
    let targetUsers = allUsers
      .filter(u =>
        (u.role === 'staff' || u.role === 'manager') &&
        u.is_active !== false &&
        u.is_timesheet_target !== false &&
        (u.role === 'manager' ? true : (u.approver_id && String(u.approver_id).trim() !== ''))
      )
      .map(u => ({ ...u, id: String(u.id||'') }));
    if (deptFilter) targetUsers = targetUsers.filter(u => u.department === deptFilter);
    if (csTeamFilter) targetUsers = targetUsers.filter(u => u.cs_team_name === csTeamFilter);
    if (staffFilter) targetUsers = targetUsers.filter(u => String(u.id) === String(staffFilter));

    const _calcBench = (entries, range) => {
      const agg = {};
      entries.forEach(e => {
        const ts = _safe_ts(e.work_start_at);
        if (ts < range.from || ts > range.to) return;
        const sub = (e.work_subcategory_name || '').trim();
        const m = Number(e.duration_minutes) || 0;
        if (!sub || m <= 0) return;
        if (!agg[sub]) agg[sub] = { sum: 0, cnt: 0 };
        agg[sub].sum += m; agg[sub].cnt += 1;
      });
      const out = {};
      Object.entries(agg).forEach(([sub, v]) => {
        if (v.cnt >= MIN_BENCH_SUB_COUNT) out[sub] = { avg: v.sum / v.cnt, cnt: v.cnt };
      });
      return out;
    };
    const benchCur = _calcBench(scopeEntries, curR);
    const benchPrev = _calcBench(scopeEntries, prevR);

    const _calcUserYear = (uid, range, bench) => {
      const inRange = scopeEntries.filter(e => String(e.user_id) === String(uid)).filter(e => {
        const ts = _safe_ts(e.work_start_at);
        return ts >= range.from && ts <= range.to;
      });
      const totalMin = inRange.reduce((s,e)=>s+(Number(e.duration_minutes)||0),0);
      const advisoryEntries = inRange.filter(e=>e.time_category==='client');
      const advisoryCount = advisoryEntries.length;
      const advisoryMin = advisoryEntries.reduce((s,e)=>s+(Number(e.duration_minutes)||0),0);
      const perfEntries = inRange.filter(e=>e.performance_type);
      const perfIndep = perfEntries.filter(e=>e.performance_type==='independent').length;
      const indepRate = perfEntries.length ? (perfIndep / perfEntries.length) : null;
      const indepCount = perfIndep;

      const uArchives = archiveItems.filter(a => String(a.user_id) === String(uid) && parseInt(a.quality_stars) > 0);
      const avgStars = uArchives.length ? (uArchives.reduce((s,a)=>s+(parseInt(a.quality_stars)||0),0) / uArchives.length) : null;
      const compEntries = inRange.filter(e => e.competency_rating && e.competency_stars !== undefined && e.competency_stars !== null);
      const avgCompStars = compEntries.length ? (compEntries.reduce((s,e)=>s+(parseInt(e.competency_stars)||0),0) / compEntries.length) : null;
      const ratingCount = uArchives.length + compEntries.length;
      let ratingCombined = null;
      if (ratingCount >= MIN_RATING_COUNT) {
        const parts = [];
        if (avgStars !== null) parts.push(avgStars);
        if (avgCompStars !== null) parts.push(avgCompStars);
        if (parts.length) ratingCombined = parts.reduce((s,x)=>s+x,0)/parts.length;
      }

      const userSubAgg = {};
      inRange.forEach(e => {
        const sub = (e.work_subcategory_name || '').trim();
        const m = Number(e.duration_minutes) || 0;
        if (!sub || m <= 0) return;
        if (!bench[sub]) return;
        if (!userSubAgg[sub]) userSubAgg[sub] = { sum: 0, cnt: 0 };
        userSubAgg[sub].sum += m; userSubAgg[sub].cnt += 1;
      });
      const ratios = [];
      Object.entries(userSubAgg).forEach(([sub, v]) => {
        if (v.cnt < MIN_USER_SUB_COUNT) return;
        const uAvg = v.sum / v.cnt;
        const bAvg = bench[sub].avg;
        if (!uAvg || !bAvg) return;
        ratios.push({ r: bAvg/uAvg, w: v.cnt });
      });
      let effRaw = null;
      if (ratios.length) {
        const wsum = ratios.reduce((s,x)=>s+x.w,0) || 1;
        effRaw = ratios.reduce((s,x)=>s+(x.r*x.w),0)/wsum;
      }
      return { totalMin, advisoryMin, advisoryCount, effRaw, indepRate, indepCount, ratingCombined };
    };

    const summaryRows = targetUsers.map(u => {
      const cur = _calcUserYear(u.id, curR, benchCur);
      const prev = _calcUserYear(u.id, prevR, benchPrev);

      // 종합점수(올해 연간 기준)
      return { u, cur, prev };
    });

    // 종합(올해) 퍼센타일 점수화
    const timeVals = summaryRows.map(r => r.cur.totalMin);
    const advVals  = summaryRows.map(r => r.cur.advisoryCount);
    const effVals  = summaryRows.map(r => r.cur.effRaw).filter(v => v !== null);
    const indepVals = summaryRows.map(r => r.cur.indepRate).filter(v => v !== null);
    const ratingVals = summaryRows.map(r => r.cur.ratingCombined).filter(v => v !== null);
    summaryRows.forEach(r => {
      const sTime = percentileScore(timeVals, r.cur.totalMin, true);
      const sAdv  = percentileScore(advVals,  r.cur.advisoryCount, true);
      const sEff  = (r.cur.effRaw === null) ? 0 : percentileScore(effVals, r.cur.effRaw, true);
      const sInd  = (r.cur.indepRate === null) ? 0 : percentileScore(indepVals, r.cur.indepRate, true);
      const sRat  = (r.cur.ratingCombined === null) ? 0 : percentileScore(ratingVals, r.cur.ratingCombined, true);
      const total = (weights.time*sTime + weights.advisory*sAdv + weights.efficiency*sEff + weights.independent*sInd + weights.rating*sRat)/100;
      r.score = { total, time:sTime, advisory:sAdv, efficiency:sEff, independent:sInd, rating:sRat };
    });

    // 성장점수(전년대비)
    summaryRows.forEach(r => {
      const timeGrowth = (r.cur.totalMin - r.prev.totalMin) / Math.max(1, r.prev.totalMin || 0);
      const advGrowth = (r.cur.advisoryCount - r.prev.advisoryCount) / Math.max(1, r.prev.advisoryCount || 0);
      const effImprove = (r.cur.effRaw === null || r.prev.effRaw === null) ? 0 : (r.cur.effRaw - r.prev.effRaw);
      const indepImprove = (r.cur.indepRate === null || r.prev.indepRate === null) ? 0 : (r.cur.indepRate - r.prev.indepRate);
      const ratingImprove = (r.cur.ratingCombined === null || r.prev.ratingCombined === null) ? 0 : (r.cur.ratingCombined - r.prev.ratingCombined);
      r.growthRaw = { timeGrowth, advGrowth, effImprove, indepImprove, ratingImprove };
    });
    const gTimeVals = summaryRows.map(r => r.growthRaw.timeGrowth);
    const gAdvVals  = summaryRows.map(r => r.growthRaw.advGrowth);
    const gEffVals  = summaryRows.map(r => r.growthRaw.effImprove);
    const gIndVals  = summaryRows.map(r => r.growthRaw.indepImprove);
    const gRatVals  = summaryRows.map(r => r.growthRaw.ratingImprove);
    summaryRows.forEach(r => {
      const sTime = percentileScore(gTimeVals, r.growthRaw.timeGrowth, true);
      const sAdv  = percentileScore(gAdvVals,  r.growthRaw.advGrowth, true);
      const sEff  = percentileScore(gEffVals,  r.growthRaw.effImprove, true);
      const sInd  = percentileScore(gIndVals,  r.growthRaw.indepImprove, true);
      const sRat  = percentileScore(gRatVals,  r.growthRaw.ratingImprove, true);
      const total = (growthWeights.time*sTime + growthWeights.advisory*sAdv + growthWeights.efficiency*sEff + growthWeights.independent*sInd + growthWeights.rating*sRat)/100;
      r.growthScore = { total, time:sTime, advisory:sAdv, efficiency:sEff, independent:sInd, rating:sRat };
    });

    // 워크북 생성
    const wb = XLSX.utils.book_new();

    // 요약 시트
    const scopeLabel = staffFilter ? '개인' : (csTeamFilter ? `팀:${csTeamFilter}` : (deptFilter ? `사업부:${deptFilter}` : '전체'));
    const summarySheet = XLSX.utils.json_to_sheet([{
      '연도(올해)': curY,
      '연도(전년)': prevY,
      '스코프/필터': scopeLabel,
      '종합가중치(투입)': weights.time.toFixed(2),
      '종합가중치(자문)': weights.advisory.toFixed(2),
      '종합가중치(효율)': weights.efficiency.toFixed(2),
      '종합가중치(독립)': weights.independent.toFixed(2),
      '종합가중치(별점)': weights.rating.toFixed(2),
      '성장가중치': '20/20/20/20/20(고정)',
    }]);
    XLSX.utils.book_append_sheet(wb, summarySheet, '요약');

    // 우수직원(종합)
    const sheetTotal = XLSX.utils.json_to_sheet(
      summaryRows
        .slice()
        .sort((a,b)=>(b.score?.total||0)-(a.score?.total||0))
        .map(r => ({
          '직원': r.u.name || r.u.id,
          '종합점수': +(r.score.total.toFixed(2)),
          '투입점수': +(r.score.time.toFixed(1)),
          '자문점수': +(r.score.advisory.toFixed(1)),
          '효율점수': +(r.score.efficiency.toFixed(1)),
          '독립점수': +(r.score.independent.toFixed(1)),
          '별점점수': +(r.score.rating.toFixed(1)),
          '투입시간(h)': +((r.cur.totalMin||0)/60).toFixed(2),
          '자문시간(h)': +((r.cur.advisoryMin||0)/60).toFixed(2),
          '자문건수': r.cur.advisoryCount || 0,
          'effRaw': r.cur.effRaw === null ? '' : +r.cur.effRaw.toFixed(4),
          '독립수행율': r.cur.indepRate === null ? '' : +r.cur.indepRate.toFixed(4),
          '독립수행건수': r.cur.indepCount || 0,
          '별점통합': r.cur.ratingCombined === null ? '' : +r.cur.ratingCombined.toFixed(3),
        }))
    );
    XLSX.utils.book_append_sheet(wb, sheetTotal, '우수직원(종합)');

    // 성장(전년대비)
    const sheetGrowth = XLSX.utils.json_to_sheet(
      summaryRows
        .slice()
        .sort((a,b)=>(b.growthScore?.total||0)-(a.growthScore?.total||0))
        .map(r => ({
          '직원': r.u.name || r.u.id,
          '성장점수': +(r.growthScore.total.toFixed(2)),
          '투입성장점수': +(r.growthScore.time.toFixed(1)),
          '자문성장점수': +(r.growthScore.advisory.toFixed(1)),
          '단축점수': +(r.growthScore.efficiency.toFixed(1)),
          '독립증가점수': +(r.growthScore.independent.toFixed(1)),
          '별점상승점수': +(r.growthScore.rating.toFixed(1)),
          '투입(h)올해': +((r.cur.totalMin||0)/60).toFixed(2),
          '투입(h)전년': +((r.prev.totalMin||0)/60).toFixed(2),
          '투입성장율': +(r.growthRaw.timeGrowth.toFixed(4)),
          '자문시간(h)올해': +((r.cur.advisoryMin||0)/60).toFixed(2),
          '자문시간(h)전년': +((r.prev.advisoryMin||0)/60).toFixed(2),
          '자문시간증감(h)': +(((r.cur.advisoryMin||0)-(r.prev.advisoryMin||0))/60).toFixed(2),
          '자문올해': r.cur.advisoryCount || 0,
          '자문전년': r.prev.advisoryCount || 0,
          '자문성장율': +(r.growthRaw.advGrowth.toFixed(4)),
          'effRaw올해': r.cur.effRaw === null ? '' : +r.cur.effRaw.toFixed(4),
          'effRaw전년': r.prev.effRaw === null ? '' : +r.prev.effRaw.toFixed(4),
          'eff개선': +(r.growthRaw.effImprove.toFixed(6)),
          '독립올해': r.cur.indepRate === null ? '' : +r.cur.indepRate.toFixed(4),
          '독립전년': r.prev.indepRate === null ? '' : +r.prev.indepRate.toFixed(4),
          '독립증가': +(r.growthRaw.indepImprove.toFixed(6)),
          '독립건수올해': r.cur.indepCount || 0,
          '독립건수전년': r.prev.indepCount || 0,
          '별점올해': r.cur.ratingCombined === null ? '' : +r.cur.ratingCombined.toFixed(3),
          '별점전년': r.prev.ratingCombined === null ? '' : +r.prev.ratingCombined.toFixed(3),
          '별점상승': +(r.growthRaw.ratingImprove.toFixed(6)),
        }))
    );
    XLSX.utils.book_append_sheet(wb, sheetGrowth, '성장(전년대비)');

    // 벤치마크
    const benchRows = [];
    const allSubs = new Set([...Object.keys(benchCur), ...Object.keys(benchPrev)]);
    [...allSubs].sort().forEach(sub => {
      benchRows.push({
        '소분류': sub,
        '올해평균(분)': benchCur[sub]?.avg ? +benchCur[sub].avg.toFixed(2) : '',
        '올해표본': benchCur[sub]?.cnt || 0,
        '전년평균(분)': benchPrev[sub]?.avg ? +benchPrev[sub].avg.toFixed(2) : '',
        '전년표본': benchPrev[sub]?.cnt || 0,
      });
    });
    const benchSheet = XLSX.utils.json_to_sheet(benchRows);
    XLSX.utils.book_append_sheet(wb, benchSheet, '벤치마크');

    const fileName = `고과리포트_${curY}_${scopeLabel}.xlsx`;
    xlsxDownload(wb, fileName.replace(/[\\/:*?\"<>|]/g, '_'));
    Toast.success('연간 리포트 다운로드 완료');
  } catch (err) {
    console.error('exportPerformanceYearlyExcel 오류:', err);
    Toast.error('연간 리포트 생성 실패: ' + (err?.message || String(err)), 6000);
  }
}

// ══════════════════════════════════════════════
//  서브탭3: 인건비 분석
// ══════════════════════════════════════════════

// ─────────────────────────────────────────────
// 인건비 탭 초기화
// ─────────────────────────────────────────────
async function _initLaborTab() {
  const session = getSession();

  // Admin만 인건비 설정·매출 업로드 표시
  const btnSetting = document.getElementById('btn-labor-cost-setting');
  if (btnSetting) btnSetting.style.display = (session.role === 'admin') ? '' : 'none';
  const btnSales = document.getElementById('btn-labor-sales-upload');
  if (btnSales) btnSales.style.display = (session.role === 'admin') ? '' : 'none';

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

  // 배부 기간 기본: 선택 연도 1/1~12/31 (비어 있을 때만)
  const y = Number(yearEl?.value) || new Date().getFullYear();
  const fromEl = document.getElementById('filter-labor-date-from');
  const toEl = document.getElementById('filter-labor-date-to');
  if (fromEl && !fromEl.value) fromEl.value = `${y}-01-01`;
  if (toEl && !toEl.value) toEl.value = `${y}-12-31`;

  await loadLaborAnalysis();
}

/** Supabase 등에서 labor_costs 테이블 미생성 시 나오는 메시지용 안내 */
function _laborCostsTableHint(err) {
  const m = String(err?.message || err || '');
  if (!/labor_costs|schema cache/i.test(m)) return '';
  return '데이터베이스에 labor_costs 테이블이 없습니다. Supabase SQL Editor에서 '
    + 'docs/sql/dev_schema_app_extensions.sql 파일의 labor_costs CREATE 구문을 실행한 뒤, '
    + '개발용 RLS를 쓰는 경우 docs/sql/dev_rls_anon_allow_all.sql을 다시 실행하세요.';
}

/**
 * time_entries를 페이지로 전부 가져옴.
 * offset 미적용·Content-Range 누락 등으로 while(true)가 끝나지 않는 경우를 막기 위해 최대 페이지 상한을 둠.
 */
async function _fetchAllTimeEntriesPaged() {
  const limit = 500;
  const maxPages = 400;
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await API.list('time_entries', { limit, page });
    const chunk = (r && r.data) ? r.data : [];
    const total = Number(r && r.total) || 0;
    out.push(...chunk);
    if (chunk.length === 0) break;
    if (chunk.length < limit) break;
    if (total > 0 && out.length >= total) break;
  }
  if (out.length >= maxPages * limit) {
    console.warn(
      '[analysis] time_entries 로드가 상한(' + (maxPages * limit) + '건)에 도달했습니다. '
      + '누락이 있으면 API Content-Range·페이지네이션을 확인하세요.'
    );
  }
  return out;
}

function _laborEntryTs(e) {
  const raw = e.work_start_at;
  const num = Number(raw);
  if (!isNaN(num) && num > 1000000000000) return num;
  if (!isNaN(num) && num > 1000000000) return num * 1000;
  const t = new Date(raw).getTime();
  return isNaN(t) ? 0 : t;
}

function _laborYearBounds(y) {
  return {
    from: new Date(y, 0, 1, 0, 0, 0, 0).getTime(),
    to: new Date(y, 11, 31, 23, 59, 59, 999).getTime(),
  };
}

/** 배부 기간: 연도 내로 클램프 */
function _laborPeriodBounds(year, fromStr, toStr) {
  const yb = _laborYearBounds(year);
  let from = yb.from;
  let to = yb.to;
  if (fromStr) from = new Date(fromStr + 'T00:00:00').getTime();
  if (toStr) to = new Date(toStr + 'T23:59:59.999').getTime();
  from = Math.max(from, yb.from);
  to = Math.min(to, yb.to);
  if (from > to) return { from: yb.from, to: yb.to };
  return { from, to };
}

function _orgFinancialsTableHint(err) {
  const m = String(err?.message || err || '');
  if (!/org_financials|schema cache/i.test(m)) return '';
  return 'org_financials 테이블이 없습니다. docs/sql/dev_schema_app_extensions.sql 을 실행하세요.';
}

async function _fetchOrgFinancialsForYear(fiscalYear) {
  try {
    const r = await API.list('org_financials', { limit: 2000 });
    const rows = (r && r.data) ? r.data : [];
    return rows.filter(x => Number(x.fiscal_year) === fiscalYear && Number(x.month) === 0);
  } catch (e) {
    console.warn('[labor] org_financials', e.message);
    return null;
  }
}

function _laborAllocatedPeriodCost(annual, yearMin, periodMin) {
  if (!annual || yearMin <= 0) return 0;
  return Math.round(Number(annual) * (periodMin / yearMin));
}

function _renderLaborStatusTable(year, targetUsers, costByUser, noteByUser) {
  const statusEl = document.getElementById('labor-cost-status');
  if (!statusEl) return;
  const rows = targetUsers.map(u => {
    const uid = String(u.id);
    const amt = costByUser[uid] || 0;
    const note = noteByUser[uid] || '';
    const ok = amt > 0;
    return `<tr style="border-bottom:1px solid var(--border-light)">
      <td style="padding:8px 10px;font-size:12px;font-weight:600">${Utils.escHtml(u.name || '')}</td>
      <td style="padding:8px 10px;font-size:11px;color:var(--text-secondary)">${Utils.escHtml(u.department || '—')}</td>
      <td style="padding:8px 10px;font-size:11px;color:var(--text-secondary)">${Utils.escHtml(u.hq_name || '—')}</td>
      <td style="padding:8px 10px;font-size:11px;color:var(--text-secondary)">${Utils.escHtml(u.cs_team_name || '—')}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px">${ok ? _fmtWon(amt) : '—'}</td>
      <td style="padding:8px 10px;font-size:11px">${ok ? '<span style="color:#15803d;font-weight:600">입력</span>' : '<span style="color:#b45309">미입력</span>'}</td>
      <td style="padding:8px 10px;font-size:11px;color:var(--text-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis" title="${Utils.escHtml(note)}">${note ? Utils.escHtml(note) : '—'}</td>
    </tr>`;
  }).join('');
  statusEl.innerHTML = `
    <div class="card" style="margin:0;border:1px solid var(--border-light);border-radius:8px;overflow:hidden">
      <div style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid var(--border-light);font-size:13px;font-weight:700">
        <i class="fas fa-clipboard-list" style="color:var(--primary)"></i> ${year}년 인건비 조회 현황 (필터 범위 직원)
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#fff;text-align:left;color:#64748b">
              <th style="padding:8px 10px">이름</th><th style="padding:8px 10px">사업부</th><th style="padding:8px 10px">본부</th><th style="padding:8px 10px">고객지원팀</th>
              <th style="padding:8px 10px;text-align:right">연인건비</th><th style="padding:8px 10px">상태</th><th style="padding:8px 10px">비고</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="7" style="padding:16px;text-align:center;color:var(--text-muted)">대상 직원 없음</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function _renderLaborOrgRollup(treeRows) {
  const wrap = document.getElementById('labor-org-wrap');
  if (!wrap) return;
  if (!treeRows.length) {
    wrap.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-muted);font-size:13px">집계 데이터 없음</div>`;
    return;
  }
  const th = `padding:8px 10px;font-size:11px;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:left`;
  const thr = th.replace('left', 'right');
  const body = treeRows.map(r => {
    const pad = (r.level || 0) * 14;
    const w = r.level === 3 ? 'font-weight:600' : (r.level === 0 ? 'font-weight:800;color:#1e293b' : 'font-weight:700');
    return `<tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:8px 10px;padding-left:${10 + pad}px;font-size:12px;${w}">${Utils.escHtml(r.label)}</td>
      <td style="${thr};font-size:12px">${_fmtWon(r.labor)}</td>
      <td style="${thr};font-size:12px">${(r.hours || 0).toFixed(1)}</td>
      <td style="${thr};font-size:11px;color:var(--text-muted)">${r.meta || ''}</td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `<table style="width:100%;border-collapse:collapse"><thead><tr>
    <th style="${th}">구분</th><th style="${thr}">기간 배부액</th><th style="${thr}">기간 고객h</th><th style="${th}">비고</th>
  </tr></thead><tbody>${body}</tbody></table>`;
}

function _renderLaborMatrix(matrix, rowKeys, colKeys) {
  const wrap = document.getElementById('labor-matrix-wrap');
  if (!wrap) return;
  if (!rowKeys.length || !colKeys.length) {
    wrap.innerHTML = `<div style="padding:28px;text-align:center;color:var(--text-muted);font-size:13px">매트릭스에 표시할 업무팀·팀 조합이 없습니다.</div>`;
    return;
  }
  const th = `padding:8px 10px;font-size:11px;border:1px solid #e2e8f0;background:#f8fafc`;
  let head = `<tr><th style="${th};text-align:left">업무팀 \\ 고객지원팀</th>`;
  colKeys.forEach(c => { head += `<th style="${th};text-align:right;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis" title="${Utils.escHtml(c)}">${Utils.escHtml(c)}</th>`; });
  head += `<th style="${th};text-align:right">행 합계</th></tr>`;
  let tbody = '';
  rowKeys.forEach(rk => {
    let rowSum = 0;
    tbody += `<tr><td style="padding:8px 10px;font-size:12px;font-weight:600;border:1px solid #f1f5f9;white-space:nowrap">${Utils.escHtml(rk)}</td>`;
    colKeys.forEach(ck => {
      const v = (matrix[rk] && matrix[rk][ck]) || 0;
      rowSum += v;
      tbody += `<td style="padding:8px 10px;text-align:right;font-size:11px;border:1px solid #f1f5f9">${v > 0 ? _fmtWon(v) : '—'}</td>`;
    });
    tbody += `<td style="padding:8px 10px;text-align:right;font-weight:700;border:1px solid #e2e8f0;background:#f8fafc">${rowSum > 0 ? _fmtWon(rowSum) : '—'}</td></tr>`;
  });
  wrap.innerHTML = `<div style="overflow-x:auto"><table style="border-collapse:collapse;min-width:480px;width:100%">${head}${tbody}</table></div>`;
}

function _renderLaborRatioSection(year, rollupLaborByScope, financialRows) {
  const wrap = document.getElementById('labor-ratio-wrap');
  if (!wrap) return;
  if (financialRows === null) {
    wrap.innerHTML = `<div style="padding:20px;color:var(--danger);font-size:13px">매출(org_financials) 데이터를 불러오지 못했습니다. 테이블 생성 여부를 확인하세요.</div>`;
    return;
  }
  if (!financialRows.length) {
    wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px;line-height:1.5">
      ${year}년 연간 매출(org_financials, month=0)이 없습니다. 관리자는 <b>매출 엑셀</b> 업로드 또는 Supabase에 직접 입력하세요.</div>`;
    return;
  }
  const findSales = (type, name) => {
    const row = financialRows.find(f => f.scope_type === type && String(f.scope_name) === String(name));
    if (!row) return { clearance: 0, project: 0 };
    return { clearance: Number(row.clearance_sales) || 0, project: Number(row.project_sales) || 0 };
  };
  const scopes = [
    { type: 'dept', key: 'dept', title: '사업부' },
    { type: 'hq', key: 'hq', title: '본부' },
    { type: 'cs_team', key: 'cs', title: '고객지원팀' },
  ];
  let html = '';
  scopes.forEach(({ type, key, title }) => {
    const laborMap = rollupLaborByScope[key] || {};
    const names = Object.keys(laborMap).sort();
    if (!names.length) return;
    html += `<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:8px">${title}별</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f8fafc">
        <th style="padding:8px;text-align:left">명칭</th><th style="padding:8px;text-align:right">기간 인건비</th><th style="padding:8px;text-align:right">통관매출</th><th style="padding:8px;text-align:right">프로젝트매출</th><th style="padding:8px;text-align:right">인건비율</th>
      </tr></thead><tbody>`;
    names.forEach(n => {
      const lab = laborMap[n] || 0;
      const s = findSales(type, n);
      const rev = s.clearance + s.project;
      const ratio = rev > 0 ? ((lab / rev) * 100).toFixed(2) + '%' : 'N/A';
      html += `<tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:8px">${Utils.escHtml(n)}</td>
        <td style="padding:8px;text-align:right">${lab > 0 ? _fmtWon(lab) : '—'}</td>
        <td style="padding:8px;text-align:right">${_fmtWon(s.clearance)}</td>
        <td style="padding:8px;text-align:right">${_fmtWon(s.project)}</td>
        <td style="padding:8px;text-align:right;font-weight:700">${ratio}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  });
  wrap.innerHTML = html || '<div style="padding:20px;color:var(--text-muted);font-size:13px">비교할 조직 단위가 없습니다.</div>';
}

function _renderLaborPersonSummary(personRows) {
  const wrap = document.getElementById('labor-person-wrap');
  if (!wrap) return;
  if (!personRows.length) {
    wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">개인 요약 없음</div>`;
    return;
  }
  const rows = personRows.sort((a, b) => b.periodAllocated - a.periodAllocated).map(p => `
    <tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:8px 10px;font-size:12px;font-weight:600">${Utils.escHtml(p.name)}</td>
      <td style="padding:8px 10px;font-size:11px">${Utils.escHtml(p.department || '—')}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px">${_fmtWon(p.annual)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px">${(p.yearMin / 60).toFixed(1)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px">${(p.periodMin / 60).toFixed(1)}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;color:var(--primary)">${_fmtWon(p.periodAllocated)}</td>
    </tr>`).join('');
  wrap.innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
    <thead><tr style="font-size:11px;color:#64748b;background:#f8fafc">
      <th style="padding:8px;text-align:left">이름</th><th style="padding:8px;text-align:left">사업부</th>
      <th style="padding:8px;text-align:right">연인건비</th><th style="padding:8px;text-align:right">연 고객h</th><th style="padding:8px;text-align:right">기간 고객h</th><th style="padding:8px;text-align:right">기간 배부</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** 인건비 탭 집계 (화면·엑셀 공통) */
async function _computeLaborAggregation() {
  const session = getSession();
  const yearEl = document.getElementById('filter-labor-year');
  if (!yearEl) return null;
  const year = Number(yearEl.value);
  const deptFilter = (document.getElementById('filter-labor-department') || {}).value || '';
  const hqFilter = (document.getElementById('filter-labor-hq') || {}).value || '';
  const csTeamFilter = (document.getElementById('filter-labor-csteam') || {}).value || '';
  const staffFilter = (typeof UserSearchSelect !== 'undefined')
    ? (UserSearchSelect.getValue('filter-labor-staff-wrap')?.id || '')
    : '';
  const dateFromStr = (document.getElementById('filter-labor-date-from') || {}).value || '';
  const dateToStr = (document.getElementById('filter-labor-date-to') || {}).value || '';

  const allUsers = window._analysisAllUsers || await Master.users();
  const visibleUserIds = _getVisibleUserIdSetForAnalysis(session, allUsers);

  const lcRes = await API.list('labor_costs', { limit: 500 });
    const allCosts = (lcRes && lcRes.data) ? lcRes.data : [];
    const yearCosts = allCosts.filter(c => Number(c.fiscal_year) === year);
    const costByUser = {};
    const noteByUser = {};
    yearCosts.forEach(c => {
      costByUser[String(c.user_id)] = Number(c.annual_cost) || 0;
      noteByUser[String(c.user_id)] = c.note || '';
    });

    let entriesYear = await _fetchAllTimeEntriesPaged();
    // 배부 대상: 승인 완료 + 고객사 지정 + (일반자문업무 + 일반통관업무)
    entriesYear = entriesYear.filter(e => {
      if (e.status !== 'approved' || !e.client_id || !e.work_start_at) return false;
      const cat = String(e.work_category_name || '').trim();
      if (!(cat === '일반자문업무' || cat === '일반통관업무')) return false;
      return new Date(_laborEntryTs(e)).getFullYear() === year;
    });
    if (visibleUserIds) {
      entriesYear = entriesYear.filter(e => visibleUserIds.has(String(e.user_id)));
    }

    const userById = {};
    allUsers.forEach(u => { userById[String(u.id)] = u; });

    const matchesOrg = (uid) => {
      const u = userById[String(uid)];
      if (!u) return false;
      if (deptFilter && (u.department || '') !== deptFilter) return false;
      if (hqFilter && (u.hq_name || '') !== hqFilter) return false;
      if (csTeamFilter && (u.cs_team_name || '') !== csTeamFilter) return false;
      if (staffFilter && String(u.id) !== String(staffFilter)) return false;
      return true;
    };

    entriesYear = entriesYear.filter(e => matchesOrg(e.user_id));

    const { from: pFrom, to: pTo } = _laborPeriodBounds(year, dateFromStr, dateToStr);
    const entriesPeriod = entriesYear.filter(e => {
      const ts = _laborEntryTs(e);
      return ts >= pFrom && ts <= pTo;
    });

    let targetUsers = allUsers.filter(u => u.role === 'staff' && u.is_active !== false);
    if (visibleUserIds) targetUsers = targetUsers.filter(u => visibleUserIds.has(String(u.id)));
    if (deptFilter) targetUsers = targetUsers.filter(u => (u.department || '') === deptFilter);
    if (hqFilter) targetUsers = targetUsers.filter(u => (u.hq_name || '') === hqFilter);
    if (csTeamFilter) targetUsers = targetUsers.filter(u => (u.cs_team_name || '') === csTeamFilter);
    if (staffFilter) targetUsers = targetUsers.filter(u => String(u.id) === String(staffFilter));

    const hasNoData = entriesYear.length === 0 && yearCosts.length === 0;

    const yearMinByUser = {};
    const periodMinByUser = {};
    entriesYear.forEach(e => {
      const uid = String(e.user_id);
      const m = Number(e.duration_minutes) || 0;
      yearMinByUser[uid] = (yearMinByUser[uid] || 0) + m;
    });
    entriesPeriod.forEach(e => {
      const uid = String(e.user_id);
      const m = Number(e.duration_minutes) || 0;
      periodMinByUser[uid] = (periodMinByUser[uid] || 0) + m;
    });

    const personRows = [];
    const matrix = {};
    const rollupLaborByScope = { dept: {}, hq: {}, cs: {} };

    targetUsers.forEach(u => {
      const uid = String(u.id);
      const annual = costByUser[uid] || 0;
      const yMin = yearMinByUser[uid] || 0;
      const pMin = periodMinByUser[uid] || 0;
      const allocated = _laborAllocatedPeriodCost(annual, yMin, pMin);
      const dept = u.department || '미지정';
      const hq = u.hq_name || '미지정';
      const cs = u.cs_team_name || '미지정';
      personRows.push({
        id: uid,
        name: u.name || uid,
        department: dept,
        annual,
        yearMin: yMin,
        periodMin: pMin,
        periodAllocated: allocated,
      });
      if (allocated > 0) {
        rollupLaborByScope.dept[dept] = (rollupLaborByScope.dept[dept] || 0) + allocated;
        rollupLaborByScope.hq[hq] = (rollupLaborByScope.hq[hq] || 0) + allocated;
        rollupLaborByScope.cs[cs] = (rollupLaborByScope.cs[cs] || 0) + allocated;
      }
    });

    entriesPeriod.forEach(e => {
      const uid = String(e.user_id);
      const u = userById[uid];
      if (!u) return;
      const annual = costByUser[uid] || 0;
      const yMin = yearMinByUser[uid] || 0;
      const pMin = periodMinByUser[uid] || 0;
      const userAlloc = _laborAllocatedPeriodCost(annual, yMin, pMin);
      const em = Number(e.duration_minutes) || 0;
      const share = pMin > 0 && userAlloc > 0 ? (em / pMin) * userAlloc : 0;
      const wTeam = (e.team_name && String(e.team_name).trim()) ? e.team_name : '미지정';
      const cs = u.cs_team_name || '미지정';
      if (!matrix[wTeam]) matrix[wTeam] = {};
      matrix[wTeam][cs] = (matrix[wTeam][cs] || 0) + Math.round(share);
    });

    const treeRows = [];
    const depts = [...new Set(targetUsers.map(u => u.department || '미지정'))].sort();
    depts.forEach(d => {
      const usersD = targetUsers.filter(u => (u.department || '미지정') === d);
      let dLab = 0; let dH = 0;
      usersD.forEach(u => {
        const uid = String(u.id);
        dLab += _laborAllocatedPeriodCost(costByUser[uid] || 0, yearMinByUser[uid] || 0, periodMinByUser[uid] || 0);
        dH += (periodMinByUser[uid] || 0) / 60;
      });
      treeRows.push({ level: 0, label: d, labor: dLab, hours: dH, meta: '사업부' });
      const hqs = [...new Set(usersD.map(u => u.hq_name || '미지정'))].sort();
      hqs.forEach(h => {
        const usersH = usersD.filter(u => (u.hq_name || '미지정') === h);
        let hLab = 0; let hH = 0;
        usersH.forEach(u => {
          const uid = String(u.id);
          hLab += _laborAllocatedPeriodCost(costByUser[uid] || 0, yearMinByUser[uid] || 0, periodMinByUser[uid] || 0);
          hH += (periodMinByUser[uid] || 0) / 60;
        });
        treeRows.push({ level: 1, label: h, labor: hLab, hours: hH, meta: '본부' });
        const css = [...new Set(usersH.map(u => u.cs_team_name || '미지정'))].sort();
        css.forEach(c => {
          const usersC = usersH.filter(u => (u.cs_team_name || '미지정') === c);
          let cLab = 0; let cH = 0;
          usersC.forEach(u => {
            const uid = String(u.id);
            cLab += _laborAllocatedPeriodCost(costByUser[uid] || 0, yearMinByUser[uid] || 0, periodMinByUser[uid] || 0);
            cH += (periodMinByUser[uid] || 0) / 60;
          });
          treeRows.push({ level: 2, label: c, labor: cLab, hours: cH, meta: '고객지원팀' });
          usersC.forEach(u => {
            const uid = String(u.id);
            const pr = personRows.find(p => p.id === uid);
            if (!pr) return;
            treeRows.push({
              level: 3,
              label: u.name || uid,
              labor: pr.periodAllocated,
              hours: (periodMinByUser[uid] || 0) / 60,
              meta: '개인',
            });
          });
        });
      });
    });

    const rowKeys = Object.keys(matrix).sort();
    const colSet = new Set();
    rowKeys.forEach(rk => Object.keys(matrix[rk] || {}).forEach(ck => colSet.add(ck)));
    const colKeys = [...colSet].sort();

    const fin = await _fetchOrgFinancialsForYear(year);

    const totalAllocated = personRows.reduce((s, p) => s + p.periodAllocated, 0);
    const periodH = entriesPeriod.reduce((s, e) => s + (Number(e.duration_minutes) || 0), 0) / 60;
    const enteredN = targetUsers.filter(u => (costByUser[String(u.id)] || 0) > 0).length;
    const totalAnnual = yearCosts.reduce((s, c) => s + Number(c.annual_cost || 0), 0);

    return {
      year,
      yearCosts,
      costByUser,
      noteByUser,
      targetUsers,
      entriesYear,
      entriesPeriod,
      yearMinByUser,
      periodMinByUser,
      userById,
      personRows,
      matrix,
      treeRows,
      rowKeys,
      colKeys,
      rollupLaborByScope,
      fin,
      hasNoData,
      totalAllocated,
      periodH,
      enteredN,
      totalAnnual,
    };
}

async function loadLaborAnalysis() {
  const orgWrap = document.getElementById('labor-org-wrap');
  const matrixWrap = document.getElementById('labor-matrix-wrap');
  const ratioWrap = document.getElementById('labor-ratio-wrap');
  const personWrap = document.getElementById('labor-person-wrap');
  const kpiEl = document.getElementById('labor-kpi');
  const statusEl = document.getElementById('labor-cost-status');

  const loading = `<div style="display:flex;align-items:center;justify-content:center;padding:40px;color:var(--text-muted);font-size:13px"><i class="fas fa-spinner fa-spin" style="margin-right:8px"></i>계산 중...</div>`;
  if (orgWrap) orgWrap.innerHTML = loading;
  if (matrixWrap) matrixWrap.innerHTML = loading;
  if (ratioWrap) ratioWrap.innerHTML = loading;
  if (personWrap) personWrap.innerHTML = loading;
  if (statusEl) statusEl.innerHTML = loading;
  if (kpiEl) kpiEl.innerHTML = '';

  try {
    const d = await _computeLaborAggregation();
    if (!d) return;

    _renderLaborStatusTable(d.year, d.targetUsers, d.costByUser, d.noteByUser);

    if (d.hasNoData) {
      if (orgWrap) orgWrap.innerHTML = `<div style="padding:36px;text-align:center;color:var(--text-muted)">${d.year}년 타임시트·인건비 데이터가 없습니다.</div>`;
      if (matrixWrap) matrixWrap.innerHTML = '';
      if (ratioWrap) ratioWrap.innerHTML = '';
      if (personWrap) personWrap.innerHTML = '';
      return;
    }

    _renderLaborOrgRollup(d.treeRows);
    _renderLaborMatrix(d.matrix, d.rowKeys, d.colKeys);

    if (d.fin === null) {
      if (ratioWrap) ratioWrap.innerHTML = `<div style="padding:20px;color:var(--danger);font-size:13px">org_financials 조회 실패 (테이블 생성 여부 확인)</div>`;
    } else {
      _renderLaborRatioSection(d.year, d.rollupLaborByScope, d.fin);
    }

    _renderLaborPersonSummary(d.personRows);

    if (kpiEl) {
      kpiEl.innerHTML =
        kpiCard('fa-coins', '', '', '기간 배부 합계', _fmtWon(d.totalAllocated), '원', `${d.year}년 · 기간내`, '', '#1a2b45') +
        kpiCard('fa-clock', '', '', '기간 고객업무h', d.periodH.toFixed(1), 'h', '승인·고객사 지정', '', '#4a7fc4') +
        kpiCard('fa-user-tie', '', '', '인건비 입력', d.enteredN + '명', '', d.totalAnnual > 0 ? `연 ${_fmtWon(d.totalAnnual)}` : '', '', '#6b95ce') +
        kpiCard('fa-layer-group', '', '', '필터 대상', d.targetUsers.length + '명', '명', 'staff', '', '#2d6bb5');
    }
  } catch (err) {
    console.error('loadLaborAnalysis 오류:', err);
    const hint = _laborCostsTableHint(err);
    const msg = hint || err.message;
    if (orgWrap) orgWrap.innerHTML = `<div style="padding:24px;color:var(--danger);font-size:13px">${msg}</div>`;
    Toast.error(hint ? '인건비: labor_costs 테이블 필요' : '인건비 분석 실패');
  }
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
    const hint = _laborCostsTableHint(err);
    tbody.innerHTML = hint
      ? `<tr><td colspan="4" style="padding:16px;text-align:center;color:var(--danger);font-size:12px;line-height:1.45">${hint}<div style="margin-top:8px;font-size:11px;opacity:.85">(${err.message})</div></td></tr>`
      : `<tr><td colspan="4" style="padding:16px;text-align:center;color:var(--danger);font-size:12px">로드 실패: ${err.message}</td></tr>`;
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
    const hint = _laborCostsTableHint(err);
    Toast.error(hint || ('저장 실패: ' + (err?.message || String(err))));
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
//  인건비 배부 엑셀 다운로드 (조직·매트릭스·개인)
// ══════════════════════════════════════════════
async function exportLaborExcel() {
  if (typeof XLSX === 'undefined') {
    Toast.error('엑셀 라이브러리가 로드되지 않았습니다.');
    return;
  }
  Toast.info('데이터 준비 중...');
  try {
    const d = await _computeLaborAggregation();
    if (!d || d.hasNoData) {
      Toast.warning('내보낼 데이터가 없습니다.');
      return;
    }
    const wb = XLSX.utils.book_new();
    const levelLabel = ['사업부', '본부', '고객지원팀', '개인'];
    const rollupSheet = d.treeRows.map(r => ({
      '구분': levelLabel[r.level] || '',
      '명칭': r.label,
      '기간배부액': r.labor,
      '기간고객h': r.hours,
      '비고': r.meta || '',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rollupSheet), '조직별현황');

    const longRows = [];
    d.rowKeys.forEach(rk => {
      d.colKeys.forEach(ck => {
        const v = (d.matrix[rk] && d.matrix[rk][ck]) || 0;
        if (v) longRows.push({ 업무팀: rk, 고객지원팀: ck, 배부액원: v });
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(longRows), '업무팀x지원팀');

    const personSheet = d.personRows.map(p => ({
      이름: p.name,
      사업부: p.department,
      연인건비원: p.annual,
      연고객업무h: +(p.yearMin / 60).toFixed(2),
      기간고객업무h: +(p.periodMin / 60).toFixed(2),
      기간배부원: p.periodAllocated,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(personSheet), '개인별');

    if (d.fin && d.fin.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.fin.map(x => ({
        회계연도: x.fiscal_year,
        월: x.month,
        구분: x.scope_type,
        명칭: x.scope_name,
        통관매출: x.clearance_sales,
        프로젝트매출: x.project_sales,
      }))), '매출연동');
    }

    xlsxDownload(wb, `인건비현황_${d.year}년.xlsx`);
    Toast.success('엑셀 다운로드 완료');
  } catch (err) {
    console.error(err);
    const hint = _laborCostsTableHint(err);
    Toast.error(hint || ('엑셀 다운로드 실패: ' + (err?.message || String(err))));
  }
}

// ══════════════════════════════════════════════
//  고객사별 총 배부 인건비 (기간) 엑셀
// ══════════════════════════════════════════════
async function exportLaborClientCostExcel() {
  if (typeof XLSX === 'undefined') {
    Toast.error('엑셀 라이브러리가 로드되지 않았습니다.');
    return;
  }
  Toast.info('고객사 집계 준비 중...');
  try {
    const d = await _computeLaborAggregation();
    if (!d || d.hasNoData) {
      Toast.warning('내보낼 데이터가 없습니다.');
      return;
    }
    const clientAgg = {};
    d.entriesPeriod.forEach(e => {
      const uid = String(e.user_id);
      const yMin = d.yearMinByUser[uid] || 0;
      const pMin = d.periodMinByUser[uid] || 0;
      const annual = d.costByUser[uid] || 0;
      const uAlloc = _laborAllocatedPeriodCost(annual, yMin, pMin);
      const em = Number(e.duration_minutes) || 0;
      const share = pMin > 0 ? (em / pMin) * uAlloc : 0;
      const cid = e.client_id;
      const cname = e.client_name || cid;
      if (!clientAgg[cid]) clientAgg[cid] = { 고객사: cname, 총배부액원: 0, 고객업무h: 0 };
      clientAgg[cid].총배부액원 += Math.round(share);
      clientAgg[cid].고객업무h += em / 60;
    });
    const rows = Object.values(clientAgg).sort((a, b) => b.총배부액원 - a.총배부액원);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '고객사별총비용');
    xlsxDownload(wb, `고객사별인건비집계_${d.year}년.xlsx`);
    Toast.success('고객사 집계 엑셀을 저장했습니다.');
  } catch (err) {
    console.error(err);
    Toast.error('엑셀 실패: ' + (err?.message || String(err)));
  }
}

// ══════════════════════════════════════════════
//  org_financials 엑셀 업로드 (관리자)
// ══════════════════════════════════════════════
async function uploadOrgFinancialExcel(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const session = getSession();
  if (session.role !== 'admin') {
    Toast.warning('관리자만 업로드할 수 있습니다.');
    return;
  }
  if (typeof XLSX === 'undefined') {
    Toast.error('엑셀 라이브러리가 로드되지 않았습니다.');
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const existingRes = await API.list('org_financials', { limit: 5000 });
    const existing = (existingRes && existingRes.data) ? existingRes.data : [];
    const idByKey = {};
    existing.forEach(r => {
      idByKey[`${r.fiscal_year}|${r.month}|${r.scope_type}|${r.scope_name}`] = r.id;
    });
    let n = 0;
    for (const row of rows) {
      const fiscal_year = Number(row.fiscal_year ?? row['회계연도'] ?? row['연도'] ?? '');
      const month = Number(row.month ?? row['월'] ?? 0);
      let scope_type = String(row.scope_type ?? row['구분'] ?? '').trim().toLowerCase();
      if (scope_type === '사업부') scope_type = 'dept';
      if (scope_type === '본부') scope_type = 'hq';
      if (scope_type === '고객지원팀' || scope_type === '팀') scope_type = 'cs_team';
      const scope_name = String(row.scope_name ?? row['명칭'] ?? row['이름'] ?? '').trim();
      if (!fiscal_year || !scope_type || !scope_name) continue;
      if (!['dept', 'hq', 'cs_team'].includes(scope_type)) continue;
      const clearance_sales = Number(String(row.clearance_sales ?? row['통관매출'] ?? 0).replace(/,/g, '')) || 0;
      const project_sales = Number(String(row.project_sales ?? row['프로젝트매출'] ?? 0).replace(/,/g, '')) || 0;
      const payload = {
        fiscal_year,
        month: isNaN(month) ? 0 : month,
        scope_type,
        scope_name,
        clearance_sales,
        project_sales,
      };
      const k = `${payload.fiscal_year}|${payload.month}|${payload.scope_type}|${payload.scope_name}`;
      if (idByKey[k]) {
        await API.update('org_financials', idByKey[k], payload);
      } else {
        const cr = await API.create('org_financials', payload);
        if (cr && cr.id) idByKey[k] = cr.id;
      }
      n++;
    }
    Toast.success(`매출 데이터 반영: ${n}행`);
    await loadLaborAnalysis();
  } catch (err) {
    console.error(err);
    const hint = _orgFinancialsTableHint(err);
    Toast.error(hint || err.message || String(err));
  }
}

// ══════════════════════════════════════════════
//  업무분석 엑셀 다운로드 (기존)
// ══════════════════════════════════════════════
async function exportAnalysisExcel() {
  try {
    // ★ XLSX 지연 로드 (첫 실행에서도 내보내기 가능)
    if (typeof XLSX === 'undefined') {
      if (typeof LibLoader !== 'undefined') {
        await LibLoader.load('xlsx');
      } else {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'js/xlsx.full.min.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('XLSX 로드 실패'));
          document.head.appendChild(s);
        });
      }
    }
    if (typeof XLSX === 'undefined') {
      Toast.error('엑셀 라이브러리를 불러올 수 없습니다. 페이지를 새로고침 후 다시 시도하세요.');
      return;
    }

    const session      = getSession();
    let dateFrom     = document.getElementById('filter-analysis-date-from').value;
    let dateTo       = document.getElementById('filter-analysis-date-to').value;
    const deptFilter   = (document.getElementById('filter-analysis-department') || {}).value || '';
    const csTeamFilter = (document.getElementById('filter-analysis-csteam')    || {}).value || '';
    const staffFilter  = (typeof UserSearchSelect !== 'undefined')
      ? (UserSearchSelect.getValue('filter-analysis-staff-wrap')?.id || '')
      : ((document.getElementById('filter-analysis-staff') || {}).value || '');
    const clientFilter = (typeof ClientSearchSelect !== 'undefined')
      ? (ClientSearchSelect.getValue('filter-analysis-client-wrap')?.id || '')
      : ((document.getElementById('filter-analysis-client') || {}).value || '');
    const catFilter    = (document.getElementById('filter-analysis-category')  || {}).value || '';
    const subFilter    = (document.getElementById('filter-analysis-subcategory')|| {}).value || '';

    Toast.info('데이터 준비 중...');

    // 날짜를 지정하지 않으면: 내부적으로만 이번 달 1일 ~ 오늘(누적) 적용 (입력값은 건드리지 않음)
    const hasCustomRange = !!(dateFrom || dateTo);
    if (!hasCustomRange) {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      dateFrom = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      dateTo   = `${y}-${String(m + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    // ★ 화면 분석과 동일한 데이터 기준으로 필터링 (approved만)
    let entries = await Cache.get('dash_time_entries', () => API.fetchAllTimeEntriesForDash(), 180000);

    // 역할별 범위 제한 (승인자/소속 기준으로 통일)
    const allUsers = (window._analysisAllUsers || await Master.users());
    const visibleUserIds = _getVisibleUserIdSetForAnalysis(session, allUsers);
    if (visibleUserIds) {
      entries = entries.filter(e => visibleUserIds.has(String(e.user_id)));
    }
    entries = entries.filter(e => e.status === 'approved');

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

    // 사업부/팀(고객지원팀)/담당자/고객사/대분류/소분류 필터
    if (deptFilter) {
      const userIdsInDept = new Set(allUsers.filter(u => u.department === deptFilter).map(u => String(u.id)));
      entries = entries.filter(e => userIdsInDept.has(String(e.user_id)));
    }
    if (csTeamFilter) {
      const userIdsInCsTeam = new Set(allUsers.filter(u => u.cs_team_name === csTeamFilter).map(u => String(u.id)));
      entries = entries.filter(e => userIdsInCsTeam.has(String(e.user_id)));
    }
    if (staffFilter)  entries = entries.filter(e => String(e.user_id) === String(staffFilter));
    if (clientFilter) entries = entries.filter(e => String(e.client_id || '') === String(clientFilter));
    if (catFilter)    entries = entries.filter(e => (e.work_category_name || '미분류') === catFilter);
    if (subFilter)    entries = entries.filter(e => (e.work_subcategory_name || '') === subFilter);

    if (!entries.length) { Toast.warning('내보낼 데이터가 없습니다.'); return; }

    const fmtDate = ts => { if (!ts) return ''; const d=new Date(Number(ts)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
    const fmtTime = ts => { if (!ts) return ''; const d=new Date(Number(ts)); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
    const safeStr = v => { if (v===null||v===undefined) return ''; if (typeof v==='string') return v; if (typeof v==='object') return JSON.stringify(v); return String(v); };
    const htmlToText = (html) => {
      if (!html) return '';
      const s = String(html);
      // 태그가 없으면 그대로
      if (!/[<>]/.test(s)) return s;
      const div = document.createElement('div');
      div.innerHTML = s
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<\/p\s*>/gi, '\n');
      return (div.innerText || div.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+\n/g, '\n')
        .replace(/\n\s+/g, '\n')
        .trim();
    };

    const wb = XLSX.utils.book_new();
    const rows = entries.map((e,i)=>({
      'No':i+1,'Staff':safeStr(e.user_name),'수행팀':safeStr(e.team_name),
      '고객사':safeStr(e.client_name)||'내부업무','대분류':safeStr(e.work_category_name),
      '소분류':safeStr(e.work_subcategory_name),'시작일자':fmtDate(e.work_start_at),
      '시작시간':fmtTime(e.work_start_at),'종료일자':fmtDate(e.work_end_at),
      '종료시간':fmtTime(e.work_end_at),'소요시간':Utils.formatDuration(e.duration_minutes),
      '소요(분)':Number(e.duration_minutes)||0,'수행내용':htmlToText(e.work_description),
      '승인자':safeStr(e.reviewer_name||e.approver_name),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '상세기록');

    const totalMin = entries.reduce((s,e)=>s+(e.duration_minutes||0),0);

    // ── 요약 시트 1) 소분류(업무유형) 집계 ──
    const subMap = {};
    entries.forEach(e => {
      const k = e.work_subcategory_name || '미분류';
      subMap[k] = (subMap[k] || 0) + (e.duration_minutes || 0);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      Object.entries(subMap).sort((a,b)=>b[1]-a[1]).map(([sub,min]) => ({
        '소분류(업무유형)': sub,
        '투입시간(분)': min,
        '투입시간(h)': +(min/60).toFixed(2),
        '비율(%)': totalMin>0 ? Math.round(min/totalMin*100) : 0,
      }))
    ), '소분류집계');

    // ── 요약 시트 2) 고객사 집계 (고객업무만) ──
    const cliMap = {};
    const clientEntries = entries.filter(e => e.time_category === 'client' && e.client_id);
    clientEntries.forEach(e => {
      const k = e.client_name || '미지정';
      cliMap[k] = (cliMap[k] || 0) + (e.duration_minutes || 0);
    });
    if (Object.keys(cliMap).length) {
      const clientTotalMin = clientEntries.reduce((s,e)=>s+(e.duration_minutes||0),0);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        Object.entries(cliMap).sort((a,b)=>b[1]-a[1]).map(([cli,min]) => ({
          '고객사': cli,
          '투입시간(분)': min,
          '투입시간(h)': +(min/60).toFixed(2),
          '비율(%)': clientTotalMin>0 ? Math.round(min/clientTotalMin*100) : 0,
        }))
      ), '고객사집계');
    }

    // ── 요약 시트 3) 소분류 평균 소요시간 ──
    const subAgg = {};
    entries.forEach(e => {
      const k = e.work_subcategory_name || '미분류';
      const m = Number(e.duration_minutes) || 0;
      if (!subAgg[k]) subAgg[k] = { sum: 0, count: 0 };
      subAgg[k].sum += m;
      subAgg[k].count += 1;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      Object.entries(subAgg)
        .filter(([,v]) => (v.count || 0) > 0)
        .map(([k,v]) => ({
          '소분류(업무유형)': k,
          '평균 소요시간(분)': +(v.sum / v.count).toFixed(1),
          '건수': v.count,
        }))
        .sort((a,b) => (b['평균 소요시간(분)'] || 0) - (a['평균 소요시간(분)'] || 0))
    ), '소분류평균');

    // ── 요약 시트 4) 담당자(자문건수=고객업무 건수) ──
    const staffAgg = {};
    entries.forEach(e => {
      const uid = String(e.user_id || '');
      if (!uid) return;
      if (!staffAgg[uid]) staffAgg[uid] = { name: e.user_name || uid, totalMin: 0, clientMin: 0, clientCount: 0 };
      const m = Number(e.duration_minutes) || 0;
      staffAgg[uid].totalMin += m;
      if (e.time_category === 'client') {
        staffAgg[uid].clientMin += m;
        staffAgg[uid].clientCount += 1;
      }
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      Object.values(staffAgg)
        .map(v => ({
          '담당자': v.name,
          '자문건수(고객업무)': v.clientCount,
          '총 투입시간(h)': +(v.totalMin/60).toFixed(2),
          '고객업무 투입시간(h)': +(v.clientMin/60).toFixed(2),
        }))
        .sort((a,b) => (b['총 투입시간(h)'] || 0) - (a['총 투입시간(h)'] || 0))
    ), '담당자집계');

    let fileLabel;
    if (!hasCustomRange) {
      fileLabel = `${dateFrom.substring(0, 7)}_누적`;
    } else if (dateFrom && dateTo) {
      fileLabel = `${dateFrom}~${dateTo}`;
    } else {
      fileLabel = dateFrom || dateTo || '기간미지정';
    }
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
