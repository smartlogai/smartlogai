/* ============================================
   approval.js — 승인 관리
   권한별 접근:
   - manager : 본인이 approver_id로 지정된 항목만 → 승인/반려 가능
   - director: 전체 열람 (읽기 전용, 승인 버튼 숨김)
   - admin   : 전체 열람 + 팀 필터 (읽기 전용, 운영 모니터링)
   ============================================ */

let _approvalTarget = null;
let _approvalPage = 1;
const APPROVAL_PER_PAGE = 20;
let _approvalModalAtts = []; // 승인 모달 첨부파일 임시 저장 (index 기반 다운로드용)

function _approvalParseTs(raw) {
  if (raw == null || raw === '') return NaN;
  const num = Number(raw);
  if (!isNaN(num) && num > 1000000000000) return num;
  if (!isNaN(num) && num > 1000000000) return num * 1000;
  const t = new Date(raw).getTime();
  return isNaN(t) ? NaN : t;
}

/** 기간 필터 — Admin: 업무일·수정일·등록일 중 하나라도 범위 안이면 통과 (대기 건 누락 완화) */
function _approvalEntryInDateRange(e, dateFrom, dateTo, session) {
  if (!dateFrom && !dateTo) return true;
  const fromMs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : 0;
  const toMs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : Infinity;
  if (Auth.canViewAll(session)) {
    for (const raw of [e.work_start_at, e.updated_at, e.created_at]) {
      const ts = _approvalParseTs(raw);
      if (!isNaN(ts) && ts >= fromMs && ts <= toMs) return true;
    }
    return false;
  }
  const raw = e.work_start_at ?? null;
  const ts = _approvalParseTs(raw);
  if (isNaN(ts)) return false;
  return ts >= fromMs && ts <= toMs;
}

function _mergeTimeEntriesById(arrays) {
  const m = new Map();
  for (const arr of arrays) {
    for (const e of arr) {
      if (e && e.id != null) m.set(String(e.id), e);
    }
  }
  return [...m.values()];
}

/**
 * 승인 화면: created_at 최신 N건만 가져오면 오래된 submitted/pre_approved가 잘림 →
 * PostgREST filter + 페이지 순회로 필요한 행까지 로드.
 * @param {string} [filterFragment] — 예: status=eq.submitted (빈 문자열이면 필터 없음)
 */
async function _approvalPaginateTimeEntries(filterFragment) {
  const limit = 500;
  const maxPages = 120;
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = { limit, page, sort: 'updated_at' };
    if (filterFragment) params.filter = filterFragment;
    const r = await API.list('time_entries', params);
    const chunk = (r && r.data) ? r.data : [];
    out.push(...chunk);
    if (chunk.length === 0) break;
    if (chunk.length < limit) break;
  }
  return out;
}

async function _scopeTimeEntriesForApproval(entries, session, teamFilterForAdmin) {
  if (Auth.canViewAll(session)) {
    if (!teamFilterForAdmin) return entries;
    return entries.filter(e => e.team_name === teamFilterForAdmin);
  }
  if (Auth.isDirector(session)) {
    const allUsers = await Master.users();
    const scopeUserIds = new Set(
      allUsers.filter(u => Auth.scopeMatch(session, u)).map(u => String(u.id))
    );
    return entries.filter(e =>
      scopeUserIds.has(String(e.user_id)) ||
      String(e.reviewer2_id) === String(session.id) ||
      String(e.approver_id) === String(session.id)
    );
  }
  if (Auth.canApprove(session)) {
    const myId = String(session.id);
    return entries.filter(e =>
      String(e.approver_id) === myId ||
      String(e.pre_approver_id) === myId
    );
  }
  const myId = String(session.id);
  return entries.filter(e => String(e.approver_id) === myId);
}

/** Director(2차 승인자): 상태 필터에서 「1차 검토 대기」 제외 — Manager·Admin은 유지 */
function _syncApprovalStatusDropdown(session) {
  const sel = document.getElementById('filter-approval-status');
  if (!sel) return;
  const hide1st = Auth.canApprove2nd(session) && !Auth.isAdmin(session);
  const prev = sel.value;
  const rows = [
    ['', '전체'],
    ...(!hide1st ? [['submitted', '1차 검토 대기']] : []),
    ['pre_approved', '최종 승인 대기'],
    ['approved', '최종 승인'],
    ['rejected', '반려'],
  ];
  sel.innerHTML = rows.map(([v, lab]) => `<option value="${v}">${lab}</option>`).join('');
  const allowed = new Set(rows.map(([v]) => v));
  sel.value = allowed.has(prev) ? prev : '';
}

async function init_approval() {
  const session = getSession();
  // manager, director, admin만 접근 가능
  if (!Auth.canApprove(session) && !Auth.canViewDeptScope(session)) {
    navigateTo('dashboard');
    Toast.warning('접근 권한이 없습니다.');
    return;
  }

  // 기간 초기값: 당월 1일 ~ 말일 (To가 속한 달의 초일과 말일 — resetApprovalFilter와 동일)
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const firstDay = `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  const lastDay  = `${y}-${String(mo + 1).padStart(2, '0')}-${String(new Date(y, mo + 1, 0).getDate()).padStart(2, '0')}`;
  document.getElementById('filter-approval-date-from').value = firstDay;
  document.getElementById('filter-approval-date-to').value   = lastDay;

  _syncApprovalStatusDropdown(session);

  // Admin 메뉴(1차/2차)에서 진입 시 상태 프리셋
  let presetUsed = '';
  try {
    const pr = sessionStorage.getItem('approvalMenuPreset');
    if (pr === '1st' || pr === '2nd') {
      presetUsed = pr;
      sessionStorage.removeItem('approvalMenuPreset');
    }
  } catch (_) {}

  const statusEl = document.getElementById('filter-approval-status');
  if (statusEl) {
    if (presetUsed === '1st') statusEl.value = 'submitted';
    else if (presetUsed === '2nd') statusEl.value = 'pre_approved';
    else statusEl.value = '';
  }

  const titleEl = document.getElementById('pageTitle');
  if (titleEl) {
    if (Auth.isAdmin(session) && presetUsed === '1st') titleEl.textContent = '1차 승인 현황';
    else if (Auth.isAdmin(session) && presetUsed === '2nd') titleEl.textContent = '2차 최종승인 현황';
    else titleEl.textContent = 'Approval';
  }

  const presetBanner = document.getElementById('approval-admin-preset-banner');
  const presetBannerTxt = document.getElementById('approval-admin-preset-banner-text');
  if (presetBanner && presetBannerTxt) {
    if (Auth.isAdmin(session) && presetUsed === '1st') {
      presetBanner.style.display = 'flex';
      presetBannerTxt.textContent = '상태가 「1차 검토 대기(submitted)」인 건만 표시합니다. 필터에서 변경할 수 있습니다.';
    } else if (Auth.isAdmin(session) && presetUsed === '2nd') {
      presetBanner.style.display = 'flex';
      presetBannerTxt.textContent = '상태가 「최종 승인 대기(pre_approved)」인 건만 표시합니다. 필터에서 변경할 수 있습니다.';
    } else {
      presetBanner.style.display = 'none';
    }
  }

  // admin: 팀 필터 표시 (전체 열람 권한)
  // director: 소속 사업부/본부/고객지원팀 범위 안내 표시
  if (Auth.canViewAll(session)) {
    const teams = await Master.teams();
    const teamEl = document.getElementById('filter-approval-team');
    teamEl.innerHTML = '<option value="">전체 팀</option>';
    teams.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.team_name;
      opt.textContent = t.team_name;
      teamEl.appendChild(opt);
    });
    document.getElementById('filter-approval-team-group').style.display = '';
  } else {
    document.getElementById('filter-approval-team-group').style.display = 'none';
  }

  // 고객사 드롭다운 로드
  try {
    const clients = await Master.clients();
    if (typeof ClientSearchSelect !== 'undefined') {
      ClientSearchSelect.init('filter-approval-client-wrap', clients, { placeholder: '고객사 검색/선택 (전체)' });
    }
  } catch(e) { console.warn('approval client filter load error', e); }

  // 업무 대/소분류 드롭다운 — time_entries에서 수집
  try {
    const er = { data: await API.listAllPages('time_entries', { filter: 'status=neq.draft', limit: 400, maxPages: 30 }) };
    const entries = (er && er.data) ? er.data : [];
    const catSet = [...new Set(entries.map(e => e.work_category_name).filter(Boolean))].sort();
    const subSet = [...new Set(entries.map(e => e.work_subcategory_name).filter(Boolean))].sort();
    const catEl = document.getElementById('filter-approval-category');
    if (catEl) {
      catEl.innerHTML = '<option value="">전체 대분류</option>';
      catSet.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        catEl.appendChild(opt);
      });
    }
    const subEl = document.getElementById('filter-approval-subcategory');
    if (subEl) {
      subEl.innerHTML = '<option value="">전체 소분류</option>';
      subSet.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        subEl.appendChild(opt);
      });
    }
  } catch(e) { console.warn('approval subcategory filter load error', e); }

  // director/admin 모드 안내 배너 (읽기 전용)
  const readonlyBanner = document.getElementById('approval-readonly-banner');
  if (readonlyBanner) {
    // manager는 승인/반려 가능, director/admin은 읽기 전용
    readonlyBanner.style.display = Auth.canViewDeptScope(session) && !Auth.canApprove(session) ? '' : 'none';
  }

  await loadApprovalList();
}

async function loadApprovalList() {
  const session      = getSession();
  const dateFrom     = document.getElementById('filter-approval-date-from').value;
  const dateTo       = document.getElementById('filter-approval-date-to').value;
  const staffKw      = (document.getElementById('filter-approval-staff').value || '').trim().toLowerCase();
  const teamFilter   = Auth.canViewAll(session)
    ? document.getElementById('filter-approval-team').value
    : '';
  const clientFilter = (typeof ClientSearchSelect !== 'undefined')
    ? (ClientSearchSelect.getValue('filter-approval-client-wrap')?.id || '')
    : '';
  const catFilter    = (document.getElementById('filter-approval-category') || {}).value || '';
  const subFilter    = (document.getElementById('filter-approval-subcategory') || {}).value || '';
  const status       = document.getElementById('filter-approval-status').value;

  try {
    const statusFrag = status
      ? `status=eq.${encodeURIComponent(status)}`
      : 'status=neq.draft';
    const [pendingSubmitted, pendingPre] = await Promise.all([
      _approvalPaginateTimeEntries('status=eq.submitted'),
      _approvalPaginateTimeEntries('status=eq.pre_approved'),
    ]);
    const pendingAll = _mergeTimeEntriesById([pendingSubmitted, pendingPre]);

    let allFetched;
    if (status === 'submitted') {
      allFetched = pendingSubmitted;
    } else if (status === 'pre_approved') {
      allFetched = pendingPre;
    } else {
      try {
        allFetched = await _approvalPaginateTimeEntries(statusFrag);
      } catch (err) {
        if (!status) {
          console.warn('[Approval] status=neq.draft 조회 실패, 필터 없이 순회합니다.', err);
          allFetched = await _approvalPaginateTimeEntries('');
          allFetched = allFetched.filter(e => e.status !== 'draft');
        } else {
          throw err;
        }
      }
    }
    let entries = await _scopeTimeEntriesForApproval(
      allFetched,
      session,
      Auth.canViewAll(session) ? teamFilter : ''
    );

    if (entries.length === 0 && allFetched.length > 0 && Auth.canApprove(session)) {
      // approver_id 매칭 없음: 정상 예외 조건 (승인자 미지정 등)
    }

    if (dateFrom || dateTo) {
      entries = entries.filter(e => _approvalEntryInDateRange(e, dateFrom, dateTo, session));
    }

    // Staff 이름 필터
    if (staffKw) {
      entries = entries.filter(e => (e.user_name || '').toLowerCase().includes(staffKw));
    }

    // 고객사 필터
    if (clientFilter) entries = entries.filter(e => e.client_id === clientFilter);

    // 업무 대분류 필터
    if (catFilter) entries = entries.filter(e => (e.work_category_name || '') === catFilter);

    // 업무 소분류 필터
    if (subFilter) entries = entries.filter(e => (e.work_subcategory_name || '') === subFilter);

    // 상태 필터 (전체='' 이면 draft 제외한 전체, 그 외 선택값으로 필터)
    if (status) {
      entries = entries.filter(e => e.status === status);
    } else {
      entries = entries.filter(e => e.status !== 'draft');
    }

    // 2차 승인자(director) 화면: 본인이 처리/처리해야 하는 건만 노출
    // - 2차 대기: submitted | pre_approved 이면서 reviewer2_id 또는 approver_id가 본인
    //   (openApprovalModal·사이드바 배지 waitCount와 동일 — 팀장 본인 건 submitted 포함)
    // - 본인 반려: rejected 이면서 reviewer_id가 본인(2차 반려)
    // - 본인 승인: approved 이면서 reviewer_id가 본인(2차 최종승인)
    // ※ 1차에서 최종승인된 내부업무(approved, reviewer_id=manager)는 자연스럽게 제외됨
    if (Auth.canApprove2nd(session)) {
      const myId = String(session.id);
      entries = entries.filter(e => {
        if (!isClientConsultEntry(e)) return false;
        const st = e.status;
        if (st === 'submitted' || st === 'pre_approved') {
          return String(e.reviewer2_id || '') === myId || String(e.approver_id || '') === myId;
        }
        if (st === 'rejected') return String(e.reviewer_id || '') === myId;
        if (st === 'approved') return String(e.reviewer_id || '') === myId;
        return false;
      });
    }

    // 정렬
    const _apvSortTs = (e) => {
      const raw = e?.work_start_at ?? e?.created_at;
      if (raw == null) return 0;
      const num = Number(raw);
      let ts;
      if (!isNaN(num) && num > 1000000000000) ts = num;
      else if (!isNaN(num) && num > 1000000000) ts = num * 1000;
      else ts = new Date(raw).getTime();
      return isNaN(ts) ? 0 : ts;
    };
    // 1차 승인자(manager)·Admin 목록: (1)반려 (2)1차검토중 (3)2차검토중 (4)최종승인 (5)기타 → 1~3·5는 그룹 내 과거→최신, approved만 최신→과거
    const _apv1stStatusRank = (st) => {
      if (st === 'rejected') return 0;
      if (st === 'submitted') return 1;
      if (st === 'pre_approved') return 2;
      if (st === 'approved') return 3;
      return 4;
    };
    const use1stApproverSort = Auth.canApprove1st(session) || Auth.isAdmin(session);
    if (use1stApproverSort) {
      entries.sort((a, b) => {
        const ra = _apv1stStatusRank(a.status);
        const rb = _apv1stStatusRank(b.status);
        if (ra !== rb) return ra - rb;
        const ta = _apvSortTs(a);
        const tb = _apvSortTs(b);
        if (a.status === 'approved' && b.status === 'approved') {
          if (ta !== tb) return tb - ta;
          return String(b.id || '').localeCompare(String(a.id || ''));
        }
        if (ta !== tb) return ta - tb;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });
    } else if (Auth.canApprove2nd(session)) {
      // 2차 승인자(director): (1)반려 (2)2차 대기(submitted·pre_approved) (3)최종승인(approved) (4)기타
      // 그룹 내: 반려/2차대기는 과거→최신, approved만 최신→과거
      const _apv2ndStatusRank = (st) => {
        if (st === 'rejected') return 0;
        if (st === 'submitted' || st === 'pre_approved') return 1;
        if (st === 'approved') return 2;
        return 3;
      };
      entries.sort((a, b) => {
        const ra = _apv2ndStatusRank(a.status);
        const rb = _apv2ndStatusRank(b.status);
        if (ra !== rb) return ra - rb;
        const ta = _apvSortTs(a);
        const tb = _apvSortTs(b);
        if (a.status === 'approved' && b.status === 'approved') {
          if (ta !== tb) return tb - ta;
          return String(b.id || '').localeCompare(String(a.id || ''));
        }
        if (ta !== tb) return ta - tb;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });
    } else {
      // Director 등: (1) 승인 대기(submitted / pre_approved) 우선 (2) 그 외 (3) 각 그룹 내 최신순
      const _apvPending = (e) => e && (e.status === 'submitted' || e.status === 'pre_approved');
      entries.sort((a, b) => {
        const pa = _apvPending(a) ? 0 : 1;
        const pb = _apvPending(b) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return _apvSortTs(b) - _apvSortTs(a);
      });
    }

    // ★ waitCount: 기간 필터와 무관하게 역할 범위 전체 기준으로 계산
    //   (사이드바 배지와 동일한 기준 → 불일치 방지)
    const session2 = getSession();
    const myId2 = String(session2.id);
    let waitCount = 0;

    const pendingScoped = await _scopeTimeEntriesForApproval(pendingAll, session2, '');
    if (Auth.isAdmin(session2)) {
      waitCount = pendingScoped.length;
    } else if (Auth.canApprove1st(session2)) {
      waitCount = pendingScoped.filter(e =>
        (e.status === 'submitted' || e.status === 'pre_approved') &&
        (String(e.approver_id) === myId2 || String(e.pre_approver_id) === myId2)
      ).length;
    } else if (Auth.canApprove2nd(session2)) {
      waitCount = pendingScoped.filter(e =>
        isClientConsultEntry(e) &&
        (e.status === 'pre_approved' || e.status === 'submitted') &&
        (String(e.reviewer2_id) === myId2 || String(e.approver_id) === myId2)
      ).length;
    } else {
      waitCount = pendingScoped.filter(e =>
        (e.status === 'submitted' || e.status === 'pre_approved') &&
        String(e.approver_id) === myId2
      ).length;
    }
    const badge = document.getElementById('approval-count-badge');
    if (waitCount > 0) {
      badge.className = 'badge badge-red';
      badge.style = '';
      badge.textContent = `${waitCount}건 검토 대기`;
    } else {
      badge.className = '';
      badge.style.cssText = 'font-size:12px;color:var(--text-muted);font-weight:400';
      badge.textContent = `0건 검토 대기`;
    }

    // 첨부파일 맵
    const attMap = await loadAttachmentsMap(entries.map(e => e.id));

    const start = (_approvalPage - 1) * APPROVAL_PER_PAGE;
    const paged = entries.slice(start, start + APPROVAL_PER_PAGE);

    const tbody = document.getElementById('approval-list-body');
    if (paged.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" class="table-empty"><i class="fas fa-check-circle" style="color:var(--success)"></i><p>검토 대기 중인 항목이 없습니다.</p></td></tr>`;
    } else {
      const canDoApprove = Auth.canApprove(session); // manager만 true

      // ── 날짜·시간 포맷 헬퍼 (My Time Sheet와 동일) ──────────
      const fmtDate = (ms) => {
        if (!ms) return '<span style="color:var(--text-muted)">—</span>';
        const d = new Date(Number(ms));
        return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
      };
      const fmtDatetime = (ms) => {
        if (!ms) return '<span style="color:var(--text-muted)">—</span>';
        const d = new Date(Number(ms));
        const mo = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        const hh = String(d.getHours()).padStart(2,'0');
        const mi = String(d.getMinutes()).padStart(2,'0');
        return `<span style="font-size:11.5px;white-space:nowrap">${mo}.${dd}&nbsp;<span style="color:var(--text-secondary)">${hh}:${mi}</span></span>`;
      };

      // ── 버튼 스타일 (My Time Sheet와 동일 30×30px) ──────────
      const B = 'width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;background:transparent;border:none;cursor:pointer;transition:background 0.15s;';

      tbody.innerHTML = paged.map((e, idx) => {
        const rowNo     = ((_approvalPage - 1) * APPROVAL_PER_PAGE) + idx + 1;
        const writtenAt = e.created_at ? fmtDate(e.created_at) : fmtDate(e.work_start_at);
        const docNoShort = e.doc_no ? (Utils.formatDocNoShort ? Utils.formatDocNoShort(e.doc_no) : e.doc_no) : '';
        const docNoHtml = e.doc_no
          ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${Utils.escHtml(e.doc_no)}">${Utils.escHtml(docNoShort)}</div>`
          : '';

        // 고객사
        const clientHtml = e.client_name
          ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12.5px" title="${Utils.escHtml(e.client_name)}">${Utils.escHtml(e.client_name)}</span>`
          : `<span style="color:var(--text-muted);font-size:11px">내부</span>`;

        // 소분류
        const subHtml = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12.5px"
              title="${Utils.escHtml(e.work_subcategory_name||'')}">
          ${Utils.escHtml(e.work_subcategory_name||'—')}
        </span>`;

        // 관리 버튼 — 상세보기만 (승인/반려는 상세 모달에서 품질 평가 후 처리)
        const btns = [];
        btns.push(`<button style="${B}" onclick="openApprovalModal('${e.id}')" title="상세보기"><i class="fas fa-eye" style="font-size:13px;color:#94a3b8"></i></button>`);

        return `<tr>
          <td style="text-align:center;color:var(--text-muted);font-size:12px;font-variant-numeric:tabular-nums">${rowNo}</td>
          <td style="font-size:12px;white-space:nowrap;color:var(--text-secondary)">${writtenAt}${docNoHtml}</td>
          <td style="padding:0 8px">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12.5px;font-weight:600" title="${Utils.escHtml(e.user_name||'')}">${Utils.escHtml(e.user_name||'—')}</span>
          </td>
          <td style="padding:0 8px">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12px;color:var(--text-secondary)" title="${Utils.escHtml(e.approver_name||'')}">${Utils.escHtml(e.approver_name||'—')}</span>
          </td>
          <td style="padding:0 8px">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12px;color:var(--text-secondary)" title="${Utils.escHtml(e.team_name||'')}">${Utils.escHtml(e.team_name||'—')}</span>
          </td>
          <td style="padding:0 10px">${clientHtml}</td>
          <td style="padding:0 10px">${subHtml}</td>
          <td style="text-align:center;padding:0 6px">${fmtDatetime(e.work_start_at)}</td>
          <td style="text-align:center;padding:0 6px">${fmtDatetime(e.work_end_at)}</td>
          <td style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-secondary)">${Utils.formatDuration(e.duration_minutes)}</td>
          <td style="text-align:center">${Utils.statusBadge(e.status)}</td>
          <td style="text-align:center;padding:0 4px">
            <div style="display:flex;gap:4px;justify-content:center;align-items:center">${btns.join('')}</div>
          </td>
        </tr>`;
      }).join('');
    }

    document.getElementById('approval-pagination').innerHTML =
      Utils.paginationHTML(_approvalPage, entries.length, APPROVAL_PER_PAGE);

  } catch (err) {
    console.error(err);
    Toast.error('데이터 로드 실패');
  }
}

function resetApprovalFilter() {
  const session = getSession();
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  document.getElementById('filter-approval-date-from').value =
    `${y}-${String(mo+1).padStart(2,'0')}-01`;
  document.getElementById('filter-approval-date-to').value =
    `${y}-${String(mo+1).padStart(2,'0')}-${String(new Date(y,mo+1,0).getDate()).padStart(2,'0')}`;
  _syncApprovalStatusDropdown(session);
  const stEl = document.getElementById('filter-approval-status');
  if (stEl) {
    stEl.value = Auth.canApprove2nd(session) && !Auth.isAdmin(session) ? '' : 'submitted';
  }
  document.getElementById('filter-approval-staff').value = '';
  const teamEl = document.getElementById('filter-approval-team');
  if (teamEl) teamEl.value = '';
  if (typeof ClientSearchSelect !== 'undefined') ClientSearchSelect.clear('filter-approval-client-wrap');
  const catEl = document.getElementById('filter-approval-category');
  if (catEl) catEl.value = '';
  const subEl = document.getElementById('filter-approval-subcategory');
  if (subEl) subEl.value = '';
  _approvalPage = 1;
  loadApprovalList();
}

// ══════════════════════════════════════════════
// 공통 상수 — 평가 매핑
// ══════════════════════════════════════════════
const RATING_STARS  = { very_unsatisfied: 0, unsatisfied: 0, normal: 1, satisfied: 2, very_satisfied: 3 };
const RATING_LABEL  = { very_unsatisfied: '매우미흡', unsatisfied: '미흡', normal: '참고', satisfied: '우수', very_satisfied: '매우우수' };
const RATING_ORDER  = ['very_unsatisfied', 'unsatisfied', 'normal', 'satisfied', 'very_satisfied'];
const PERF_LABEL    = { independent: '독립수행', guided: '지도수행', supervised: '감독수행' };
const PERF_DEDUCT   = { independent: 0, guided: 1, supervised: 2 };
const ARCHIVE_RATINGS = ['normal', 'satisfied', 'very_satisfied'];

/** 일반자문(고객) 업무 — 수행방식·2차 승인 대상 */
function isClientConsultEntry(e) {
  return !!(e && e.time_category === 'client');
}

/** 품질평가 + 수행방식 → 전문성 별점/등급 자동 계산
 *  RATING_ORDER 인덱스 기준으로 단계 차감:
 *  very_unsatisfied=0, unsatisfied=1, normal=2, satisfied=3, very_satisfied=4
 *  감독수행 -2단계: satisfied(3) → unsatisfied(1)
 *  지도수행 -1단계: satisfied(3) → normal(2)
 */
function calcCompetency(qualityRating, performanceType) {
  const qIdx    = RATING_ORDER.indexOf(qualityRating);          // 0~4, 없으면 -1
  if (qIdx < 0) return { competency_stars: 0, competency_rating: 'very_unsatisfied' };
  const deduct  = PERF_DEDUCT[performanceType] ?? 0;
  const cIdx    = Math.max(0, qIdx - deduct);                   // 단계 차감
  const cRating = RATING_ORDER[cIdx];                           // 결과 등급
  const cStars  = RATING_STARS[cRating] ?? 0;                   // 결과 별점
  return { competency_stars: cStars, competency_rating: cRating };
}

// ══════════════════════════════════════════════
// 추출 텍스트 확인 / 수동 추출 (승인·담당자 모달 공통)
// ══════════════════════════════════════════════

/** 현재 열린 모달의 atts 캐시 (id → attachment 객체) */
const _apvAttsCache = {};

/** atts 배열을 캐시에 등록 */
function _apvCacheAtts(atts) {
  (atts || []).forEach(a => { if (a.id) _apvAttsCache[a.id] = a; });
}

/** 추출 텍스트 확인 모달 */
function _apvShowExtractedText(attId) {
  const a = _apvAttsCache[attId];
  if (!a || !a.extracted_text) { Toast.warning('추출된 텍스트가 없습니다.'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.style.zIndex = '10001';

  const modal = document.createElement('div');
  modal.className = 'modal modal-lg';
  modal.style.cssText = 'max-width:680px;border-radius:14px;overflow:hidden';

  const header = document.createElement('div');
  header.className = 'modal-header';
  header.style.cssText = 'background:#faf5ff;padding:14px 20px;border-bottom:1px solid #e9d5ff;display:flex;align-items:center;justify-content:space-between';
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <i class="fas fa-shield-alt" style="color:#7c3aed;font-size:14px"></i>
      <span style="font-size:14px;font-weight:700;color:#4c1d95">추출 텍스트 확인</span>
      <span style="background:#ede9fe;color:#6d28d9;border-radius:5px;padding:2px 8px;font-size:11px;font-weight:600">민감정보 마스킹 완료</span>
    </div>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-close'; closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);

  const subHeader = document.createElement('div');
  subHeader.style.cssText = 'background:#f5f3ff;padding:8px 20px;border-bottom:1px solid #e9d5ff;font-size:12px;color:#5b21b6;display:flex;align-items:center;gap:6px';
  subHeader.innerHTML = `<i class="fas fa-file" style="font-size:11px"></i> <strong>${Utils.escHtml(a.file_name || '파일명 없음')}</strong>`;

  const body = document.createElement('div');
  body.className = 'modal-body';
  body.style.cssText = 'padding:16px 20px;max-height:60vh;overflow-y:auto';

  const notice = document.createElement('div');
  notice.style.cssText = 'background:#fdf4ff;border:1px solid #e9d5ff;border-radius:8px;padding:10px 14px;font-size:12px;color:#6b21a8;display:flex;gap:8px;align-items:flex-start;margin-bottom:14px';
  notice.innerHTML = `<i class="fas fa-info-circle" style="margin-top:1px;flex-shrink:0"></i>
    <span>원본 파일에서 추출 후 민감정보(금액·수입신고번호·고객사명 등)가 자동 마스킹된 내용입니다.<br>원본 파일은 변경되지 않습니다.</span>`;
  body.appendChild(notice);

  const textBox = document.createElement('pre');
  textBox.style.cssText = 'background:#f8fafc;border:1px solid var(--border-light);border-radius:8px;padding:14px 16px;font-size:12px;line-height:1.8;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow-y:auto;font-family:inherit';
  textBox.textContent = a.extracted_text;
  body.appendChild(textBox);

  const charCount = document.createElement('div');
  charCount.style.cssText = 'text-align:right;font-size:11px;color:var(--text-muted);margin-top:6px';
  charCount.textContent = `총 ${a.extracted_text.length.toLocaleString()}자`;
  body.appendChild(charCount);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  footer.style.cssText = 'padding:12px 20px;background:#faf5ff;border-top:1px solid #e9d5ff;display:flex;justify-content:flex-end';
  const closeFooterBtn = document.createElement('button');
  closeFooterBtn.className = 'btn btn-outline';
  closeFooterBtn.innerHTML = '<i class="fas fa-times"></i> 닫기';
  closeFooterBtn.addEventListener('click', () => overlay.remove());
  footer.appendChild(closeFooterBtn);

  modal.appendChild(header); modal.appendChild(subHeader);
  modal.appendChild(body);   modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.addEventListener('keydown', function escH(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escH); }
  });
}

/** 수동 텍스트 추출 + 마스킹 + DB 저장 */
async function _apvExtractAndMask(attId, idx) {
  const a = _apvAttsCache[attId];
  if (!a || !a.file_content) { Toast.warning('파일 데이터가 없습니다.'); return; }

  const btn = document.getElementById(`apv-extract-btn-${attId}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 추출 중...'; }

  try {
    const { blob } = _base64ToBlob(a.file_content);
    const file = new File([blob], a.file_name || 'file', { type: blob.type });
    const { text: rawText, status: extStatus } = await _extractTextFromFile(file);

    if (extStatus === 'ppt')      { Toast.warning('⚠️ PPT 파일은 PDF로 변환 후 업로드해주세요.'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기'; } return; }
    if (extStatus === 'scan_pdf') { Toast.warning('⚠️ 스캔된 PDF로 감지됨. 텍스트 추출이 불가합니다.'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기'; } return; }
    if (!rawText)                 { Toast.warning('텍스트를 추출할 수 없습니다.'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기'; } return; }

    const maskedText = await _maskSensitiveText(rawText);
    await API.patch('attachments', a.id, { extracted_text: maskedText });
    a.extracted_text = maskedText;

    // 버튼 전환
    if (btn) {
      btn.id = '';
      btn.style.cssText = 'white-space:nowrap;margin-top:6px;color:#6d28d9;border-color:#c4b5fd';
      btn.className = 'btn btn-sm btn-outline';
      btn.innerHTML = '<i class="fas fa-shield-alt"></i> 추출 텍스트 확인';
      btn.onclick = () => _apvShowExtractedText(attId);
      btn.disabled = false;
    }
    Toast.success(`✅ 텍스트 추출 및 마스킹 완료 (${maskedText.length.toLocaleString()}자)`);
  } catch (err) {
    Toast.error('추출 실패: ' + (err.message || ''));
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기'; }
  }
}

// ══════════════════════════════════════════════
// 공통: 업무 내용 HTML 생성
// ══════════════════════════════════════════════
function _buildEntryDetailHtml(entry, atts) {
  const fmtDt = (ms) => {
    if (!ms) return '<span style="color:var(--text-muted)">—</span>';
    const d = new Date(Number(ms));
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  const attHtml = atts.length > 0
    ? atts.map((a, idx) => {
        const iconMap  = { excel:'fa-file-excel', word:'fa-file-word', ppt:'fa-file-powerpoint', pdf:'fa-file-pdf', link:'fa-link' };
        const colorMap = { excel:'#16a34a', word:'#1d4ed8', ppt:'#c2410c', pdf:'#b91c1c', link:'#7c3aed' };
        const hasContent = a.file_content && a.file_content.startsWith('data:');
        const hasUrl     = a.file_url && a.file_url.startsWith('http');
        const safeId     = (a.id || '').replace(/'/g, "\\'");

        // 파일 열기 버튼
        let actionBtn = hasContent
          ? `<button class="btn btn-sm btn-primary" onclick="downloadApprovalFile(${idx})" style="white-space:nowrap;margin-top:6px"><i class="fas fa-eye"></i> 미리보기</button>`
          : hasUrl
          ? `<a href="${a.file_url}" target="_blank" class="btn btn-sm btn-outline" style="white-space:nowrap;margin-top:6px;display:inline-block"><i class="fas fa-external-link-alt"></i> 링크 열기</a>`
          : `<div style="margin-top:6px;font-size:11px;color:#94a3b8"><i class="fas fa-info-circle"></i> 이메일/공유폴더 확인</div>`;

        // 추출 텍스트 버튼
        let extractBtn = '';
        if (a.extracted_text) {
          extractBtn = `<button class="btn btn-sm btn-outline" onclick="_apvShowExtractedText('${safeId}')"
            style="white-space:nowrap;margin-top:6px;color:#6d28d9;border-color:#c4b5fd">
            <i class="fas fa-shield-alt"></i> 추출 텍스트 확인</button>`;
        } else if (hasContent) {
          extractBtn = `<button class="btn btn-sm btn-outline" id="apv-extract-btn-${safeId}"
            onclick="_apvExtractAndMask('${safeId}', ${idx})"
            style="white-space:nowrap;margin-top:6px;color:#b45309;border-color:#fcd34d">
            <i class="fas fa-magic"></i> 텍스트 추출하기</button>`;
        }
        // 삭제 버튼 (수정 모드에서만 표시; 토글 시 JS로 show/hide)
        const canDelete = !!a.id;
        const delBtn = `<button type="button" class="btn btn-sm btn-outline apv-att-del-btn"
          data-att-del-id="${Utils.escHtml(String(a.id||''))}"
          style="white-space:nowrap;margin-top:6px;color:#ef4444;border-color:#fecaca;display:none">
          <i class="fas fa-trash-alt"></i> 삭제</button>`;

        actionBtn = `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${actionBtn}${extractBtn}${canDelete ? delBtn : ''}</div>`;
        return `<div id="apv-att-${Utils.escHtml(String(a.id||('idx-'+idx)))}"
          style="display:flex;align-items:flex-start;gap:12px;padding:10px 12px;background:#f8fafc;border:1px solid var(--border-light);border-radius:8px;margin-bottom:6px">
          <i class="fas ${iconMap[a.file_type]||'fa-file'}" style="color:${colorMap[a.file_type]||'#6b7280'};font-size:22px;margin-top:2px;flex-shrink:0"></i>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;word-break:break-all">${a.file_name||'파일명 없음'}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:3px">
              ${a.doc_type  ? `<span style="background:#e0f2fe;color:#0369a1;border-radius:4px;padding:1px 6px;font-size:11px">${a.doc_type}</span>` : ''}
              ${a.file_size ? `<span style="color:var(--text-muted);font-size:11px">${a.file_size}KB</span>` : ''}
              ${hasContent  ? `<span style="background:#dcfce7;color:#15803d;border-radius:4px;padding:1px 6px;font-size:11px"><i class="fas fa-check-circle" style="font-size:9px"></i> 저장됨</span>` : ''}
            </div>
            ${actionBtn}
          </div>
        </div>`;
      }).join('')
    : '<div style="color:var(--text-muted);font-size:13px;padding:8px 0"><i class="fas fa-folder-open"></i> 첨부된 결과물이 없습니다.</div>';

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div><span style="font-size:11px;color:var(--text-muted)">문서번호</span>
        <div style="font-weight:700;margin-top:2px;color:#334155" title="${Utils.escHtml(entry.doc_no || '—')}">${Utils.escHtml(entry.doc_no ? (Utils.formatDocNoShort ? Utils.formatDocNoShort(entry.doc_no) : entry.doc_no) : '—')}</div>
      </div>
      <div><span style="font-size:11px;color:var(--text-muted)">Staff</span><div style="font-weight:600;margin-top:2px">${entry.user_name||'-'}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">수행팀</span><div style="font-weight:600;margin-top:2px">${entry.team_name||'-'}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">고객사</span><div style="font-weight:600;margin-top:2px">${entry.client_name||'내부'}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">대분류</span><div style="margin-top:2px">${entry.work_category_name||'-'}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">소분류</span>
        <div style="margin-top:2px">
          <input id="approval-edit-subcat" type="text" value="${entry.work_subcategory_name||''}" disabled
            style="width:100%;font-size:13px;padding:3px 6px;border-radius:6px;border:1px solid transparent;background:#f8fafc;color:var(--text-primary);box-sizing:border-box"/>
        </div>
      </div>
      <div><span style="font-size:11px;color:var(--text-muted)">시작일시</span><div style="margin-top:2px">${fmtDt(entry.work_start_at)}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">종료일시</span><div style="margin-top:2px">${fmtDt(entry.work_end_at)}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">소요시간</span><div style="font-weight:700;color:var(--primary);margin-top:2px">${Utils.formatDurationLong(entry.duration_minutes)}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">현재 상태</span><div style="margin-top:2px">${Utils.statusBadge(entry.status)}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">승인자</span>
        <div style="margin-top:2px">${entry.approver_name
          ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:5px;padding:2px 7px;font-size:12px"><i class="fas fa-user-check" style="font-size:10px"></i>${entry.approver_name}</span>`
          : '<span style="color:var(--text-muted);font-size:12px">미지정</span>'}</div>
      </div>
    </div>
    <!-- 수행내역(업무수행내용) -->
    <div style="margin-bottom:12px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;display:flex;align-items:center;gap:6px">
        <i class="fas fa-align-left"></i> 업무수행내용
      </div>
      <div id="approval-desc-view"
        style="max-height:320px;overflow:auto;border:1px solid var(--border-light);border-radius:8px;background:#f8fafc;padding:12px 14px;line-height:1.7;font-size:13px"></div>
      <div id="approval-rich-heavy-notice" style="display:none;margin-top:8px;font-size:11px;color:#92400e;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 10px">
        <i class="fas fa-info-circle"></i> 대용량 표가 포함되어 있어 기본 조회 모드로 표시됩니다.
      </div>
      <div id="approval-edit-quill-wrap" style="display:none;margin-top:8px"><div id="approval-edit-quill"></div></div>
      <div id="approval-edit-rich-wrap" style="display:none;margin-top:8px"><div id="approval-edit-rich"></div></div>
    </div>
    ${entry.time_category === 'client' ? (() => {
      // 자문 분류 정보 표시 (고객업무만)
      let kwQ = [], kwR = [], lawR = [];
      try { kwQ = Array.isArray(entry.kw_query) ? entry.kw_query : (entry.kw_query ? JSON.parse(entry.kw_query) : []); } catch {}
      try { kwR = Array.isArray(entry.kw_reason) ? entry.kw_reason : (entry.kw_reason ? JSON.parse(entry.kw_reason) : []); } catch {}
      try { lawR = typeof entry.law_refs === 'string' ? JSON.parse(entry.law_refs || '[]') : (entry.law_refs || []); } catch {}
      const tagBadge = (arr, bg, clr) => arr.map(t => `<span style="display:inline-flex;align-items:center;background:${bg};color:${clr};border-radius:5px;padding:2px 8px;font-size:11px;margin:2px">${Utils.escHtml(String(t))}</span>`).join('');
      const lawBadge = (arr) => arr.map(r => `<span style="display:inline-flex;align-items:center;gap:3px;background:#ede9fe;color:#5b21b6;border-radius:5px;padding:2px 8px;font-size:11px;margin:2px"><i class="fas fa-balance-scale" style="font-size:9px"></i>${Utils.escHtml((r.law||'') + (r.article?' '+r.article:''))}</span>`).join('');
      const viewContent = (!kwQ.length && !kwR.length && !lawR.length)
        ? ''
        : `<div style="background:#f8f9ff;border:1px solid #c7d2fe;border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:8px;display:flex;align-items:center;gap:5px"><i class="fas fa-tags"></i> 자문 분류 정보</div>
          ${kwQ.length ? `<div style="margin-bottom:6px"><span style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">핵심키워드</span>${tagBadge(kwQ,'#e0e7ff','#3730a3')}</div>` : ''}
          ${lawR.length ? `<div style="margin-bottom:6px"><span style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">관련법령</span>${lawBadge(lawR)}</div>` : ''}
          ${kwR.length ? `<div><span style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">판단사유</span>${tagBadge(kwR,'#f0fdf4','#166534')}</div>` : ''}
        </div>`;
      // id=approval-kw-view: 읽기 모드, id=approval-kw-edit: 수정 모드
      return `<div style="margin-bottom:12px">
        <div id="approval-kw-view" style="${!viewContent ? 'display:none' : ''}">${viewContent}</div>
        <div id="approval-kw-edit"></div>
      </div>`;
    })() : ''}
    <div style="margin-bottom:14px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;display:flex;align-items:center;gap:6px">
        <i class="fas fa-paperclip"></i> 첨부 결과물 (${atts.length}건)
      </div>
      ${attHtml}
    </div>`;
}

function _renderApprovalDescView(entry) {
  const view = document.getElementById('approval-desc-view');
  if (!view) return;
  const html = String(entry?.work_description || '').trim();
  view.innerHTML = html
    ? (html.startsWith('<') ? html : `<p>${Utils.escHtml(html)}</p>`)
    : '<span style="color:var(--text-muted);font-size:12px">(내용 없음)</span>';
  view.style.display = '';
}

function _apvSetAttachmentDeleteUiVisible(visible) {
  document.querySelectorAll('.apv-att-del-btn').forEach(btn => {
    btn.style.display = visible ? 'inline-flex' : 'none';
  });
}

async function _apvDeleteAttachmentNow(attId) {
  const id = String(attId || '').trim();
  if (!id) return;

  const ok = await Confirm.show({
    icon: '🗑️',
    title: '첨부파일 삭제',
    desc: '첨부파일을 즉시 삭제하시겠습니까?<br><span style="color:#ef4444;font-weight:600">삭제 후 복구할 수 없습니다.</span>',
    confirmText: '삭제',
    confirmClass: 'btn-danger'
  });
  if (!ok) return;

  // 즉시 삭제
  const done = GlobalBusy?.show ? GlobalBusy.show('첨부파일 삭제 중...') : (() => {});
  try {
    await API.delete('attachments', id);

    // 로컬 목록 갱신
    _approvalModalAtts = (_approvalModalAtts || []).filter(a => String(a.id) !== id);

    // DOM 제거
    const el = document.getElementById(`apv-att-${id}`);
    if (el) el.remove();

    Toast.success('첨부파일이 삭제되었습니다.');
  } catch (e) {
    console.error('[approval] attachment delete failed', e);
    Toast.error('첨부파일 삭제 실패' + (e?.message ? ': ' + e.message : ''));
  } finally {
    done();
  }
}

/** 평가 버튼 5개 HTML (name 구분자로 여러 세트 지원) */
function _buildRatingBtns(name) {
  const items = [
    { value:'very_unsatisfied', icon:'fa-times-circle',  color:'#ef4444', label:'매우미흡' },
    { value:'unsatisfied',      icon:'fa-minus-circle',  color:'#f97316', label:'미흡'     },
    { value:'normal',           icon:'fa-check-circle',  color:'#6b7280', label:'참고 ★'   },
    { value:'satisfied',        icon:'fa-check-circle',  color:'#2563eb', label:'우수 ★★'  },
    { value:'very_satisfied',   icon:'fa-award',         color:'#f59e0b', label:'매우우수 ★★★' },
  ];
  return `<div style="display:flex;gap:6px;flex-wrap:wrap" data-rating-group="${name}">
    ${items.map(it => `
      <label class="quality-btn" data-value="${it.value}" data-group="${name}"
        style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;
               padding:8px 10px;border-radius:8px;border:2px solid #e5e7eb;background:#fff;
               transition:all 0.15s;flex:1;min-width:66px">
        <input type="radio" name="${name}" value="${it.value}" style="display:none">
        <i class="fas ${it.icon}" style="font-size:16px;color:${it.color}"></i>
        <span style="font-size:10px;color:#6b7280;font-weight:600;letter-spacing:-0.2px;text-align:center">${it.label}</span>
      </label>`).join('')}
  </div>`;
}

// ══════════════════════════════════════════════
// 승인 모달 열기 — 1차(manager) / 2차(director) 자동 분기
// ══════════════════════════════════════════════
async function openApprovalModal(entryId, focusReject = false) {
  try {
    resetApprovalModalState();
    const _rb = document.getElementById('rejectBtn');
    const _ab = document.getElementById('approveBtn');
    const _eb = document.getElementById('editEntryBtn');
    if (_rb) { _rb.disabled = false; _rb.innerHTML = '<i class="fas fa-times"></i> 반려'; }
    if (_ab) { _ab.disabled = false; _ab.innerHTML = '<i class="fas fa-check"></i> 승인'; }
    if (_eb) { _eb.disabled = false; _eb.innerHTML = '<i class="fas fa-edit"></i> 수정'; }

    // 모달 재오픈 시 이전 Quill 인스턴스 초기화는 resetApprovalModalState에서 처리됨

    const entry = await API.get('time_entries', entryId);
    if (!entry) return;
    _approvalTarget = entry;

    const attR = await API.list('attachments', { limit: 500 });
    const atts = (attR && attR.data) ? attR.data.filter(a => a.entry_id === entryId) : [];
    _approvalModalAtts = atts;
    _apvCacheAtts(atts); // 추출 텍스트 버튼용 캐시 등록

    const session = getSession ? getSession() : null;

    // ── 분기: 1차(manager) vs 2차(director/admin 열람) vs 상세보기
    const is1st = Auth.canApprove1st(session) && entry.status === 'submitted';
    // director: pre_approved 건 OR reviewer2_id로 지정된 submitted 건
    const is2nd = Auth.canApprove2nd(session) && isClientConsultEntry(entry) && (
      entry.status === 'pre_approved' ||
      (entry.status === 'submitted' && String(entry.reviewer2_id) === String(session.id))
    );

    if (is1st) {
      _openApprovalModal1st(entry, atts, session);
    } else if (is2nd) {
      _openApprovalModal2nd(entry, atts, session);
    } else {
      _openApprovalModalReadonly(entry, atts, session);
    }

    openModal('approvalModal');
    // 첨부파일 삭제 버튼 이벤트 위임 (1회만)
    const body = document.getElementById('approvalModalBody');
    if (body && !body._attDelReady) {
      body._attDelReady = true;
      body.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-att-del-id]');
        if (!btn) return;
        e.preventDefault(); e.stopPropagation();
        if (!_approvalEditMode) return;
        _apvDeleteAttachmentNow(btn.dataset.attDelId);
      });
    }
    if (focusReject) setTimeout(() => document.getElementById('approval-comment')?.focus(), 100);
  } catch (err) {
    Toast.error('데이터 로드 실패');
    console.error(err);
  }
}

// ── 1차 승인 모달 (manager용) ────────────────────────────────
function _openApprovalModal1st(entry, atts, session) {
  const showPerf = isClientConsultEntry(entry);
  const perfBlockHtml = showPerf ? `
    <!-- 수행방식 선택 (필수) — 일반자문(client)만 -->
    <div style="margin-bottom:14px;padding:14px 16px;background:#f8fafc;border-radius:10px;border:1px solid var(--border-light)">
      <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:10px">
        <i class="fas fa-user-check" style="color:#2563eb"></i> 수행방식 확인 <span style="color:var(--danger)">*</span>
        <span style="font-size:11px;font-weight:400;color:var(--text-muted);margin-left:4px">(전문성 평가 기준)</span>
      </div>
      <div style="display:flex;gap:8px">
        ${[
          { value:'independent', icon:'fa-user',       color:'#16a34a', label:'독립수행', desc:'혼자 완성' },
          { value:'guided',      icon:'fa-hands-helping', color:'#2563eb', label:'지도수행', desc:'지도 후 완성' },
          { value:'supervised',  icon:'fa-eye',        color:'#f97316', label:'감독수행', desc:'전면 감독 완성' },
        ].map(p => `
          <label class="perf-btn" data-value="${p.value}"
            style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;
                   padding:10px 12px;border-radius:8px;border:2px solid #e5e7eb;background:#fff;
                   flex:1;transition:all 0.15s">
            <input type="radio" name="performance_type" value="${p.value}" style="display:none">
            <i class="fas ${p.icon}" style="font-size:18px;color:${p.color}"></i>
            <span style="font-size:11px;font-weight:700;color:#1a2b45">${p.label}</span>
            <span style="font-size:10px;color:#9aa4b2">${p.desc}</span>
          </label>`).join('')}
      </div>
      <div id="perf-warn" style="display:none;margin-top:8px;font-size:11px;color:#ef4444">
        <i class="fas fa-exclamation-circle"></i> 수행방식을 선택해주세요.
      </div>
    </div>` : '';

  document.getElementById('approvalModalTitle').textContent = '업무기록 1차 검토';
  document.getElementById('approvalModalBody').innerHTML = `
    ${_buildEntryDetailHtml(entry, atts)}
    ${perfBlockHtml}

    <!-- 검토 의견 -->
    <div>
      <label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:6px">
        검토 의견 <span style="color:var(--danger)">* (반려 시 필수)</span>
      </label>
      <textarea class="form-control" id="approval-comment" rows="3" placeholder="검토 의견을 입력하세요."></textarea>
    </div>`;
  _renderApprovalDescView(entry);

  // 수정/승인/반려 버튼 표시
  document.getElementById('editEntryBtn').style.display  = '';
  document.getElementById('rejectBtn').style.display     = '';
  const approveBtn = document.getElementById('approveBtn');
  approveBtn.style.display  = '';
  approveBtn.innerHTML      = showPerf
    ? '<i class="fas fa-arrow-right"></i> 1차 승인'
    : '<i class="fas fa-check"></i> 승인';
  approveBtn.onclick        = () => processApproval1st('pre_approved');

  const rejectBtn = document.getElementById('rejectBtn');
  rejectBtn.onclick = () => processApproval1st('rejected');

  // 수행방식 버튼 인터랙션 (일반자문만 DOM 존재)
  if (showPerf) {
    setTimeout(() => {
      document.querySelectorAll('.perf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.perf-btn').forEach(b => { b.style.border = '2px solid #e5e7eb'; b.style.background = '#fff'; });
          btn.style.border = '2px solid var(--primary)';
          btn.style.background = '#eff6ff';
          const pw = document.getElementById('perf-warn');
          if (pw) pw.style.display = 'none';
        });
      });
    }, 50);
  }
}

// ── 2차 승인 모달 (director용) ────────────────────────────────
function _openApprovalModal2nd(entry, atts, session) {
  const isManagerDirect = entry.status === 'submitted'; // manager 본인 건
  const showMgrPerf = isManagerDirect && isClientConsultEntry(entry); // 2차는 client만 — 방어적 분기
  const perfType = entry.performance_type || '';
  const preApproverBanner = entry.pre_approver_name
    ? `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                   background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:14px">
         <i class="fas fa-check-circle" style="color:#16a34a;font-size:16px;flex-shrink:0"></i>
         <div>
           <span style="font-size:12px;font-weight:600;color:#15803d">1차 승인 완료</span>
           <span style="font-size:11px;color:#166534;margin-left:8px">${entry.pre_approver_name}</span>
           ${perfType ? `<span style="margin-left:8px;background:#dcfce7;color:#15803d;border-radius:4px;padding:1px 7px;font-size:11px">${PERF_LABEL[perfType]||perfType}</span>` : ''}
         </div>
       </div>`
    : '';

  document.getElementById('approvalModalTitle').textContent = '업무기록 최종 승인 (2차)';
  document.getElementById('approvalModalBody').innerHTML = `
    ${_buildEntryDetailHtml(entry, atts)}
    ${preApproverBanner}

    ${showMgrPerf ? `
    <!-- manager 본인 건: 수행방식 직접 선택 -->
    <div style="margin-bottom:14px;padding:14px 16px;background:#fff7ed;border-radius:10px;border:1px solid #fed7aa">
      <div style="font-size:12px;font-weight:600;color:#9a3412;margin-bottom:10px">
        <i class="fas fa-user-check" style="color:#f97316"></i> 수행방식 확인 <span style="color:var(--danger)">*</span>
        <span style="font-size:11px;font-weight:400;color:#c2410c;margin-left:4px">(팀장 본인 건 — 직접 선택)</span>
      </div>
      <div style="display:flex;gap:8px">
        ${[
          { value:'independent', icon:'fa-user',          color:'#16a34a', label:'독립수행', desc:'혼자 완성' },
          { value:'guided',      icon:'fa-hands-helping', color:'#2563eb', label:'지도수행', desc:'지도 후 완성' },
          { value:'supervised',  icon:'fa-eye',           color:'#f97316', label:'감독수행', desc:'전면 감독 완성' },
        ].map(p => `
          <label class="perf-btn" data-value="${p.value}"
            style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;
                   padding:10px 12px;border-radius:8px;border:2px solid #e5e7eb;background:#fff;
                   flex:1;transition:all 0.15s">
            <input type="radio" name="performance_type" value="${p.value}" style="display:none">
            <i class="fas ${p.icon}" style="font-size:18px;color:${p.color}"></i>
            <span style="font-size:11px;font-weight:700;color:#1a2b45">${p.label}</span>
            <span style="font-size:10px;color:#9aa4b2">${p.desc}</span>
          </label>`).join('')}
      </div>
    </div>` : ''}

    <!-- ① 내용 품질 평가 -->
    <div style="margin-bottom:14px;padding:14px 16px;background:#f8fafc;border-radius:10px;border:1px solid var(--border-light)">
      <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:10px">
        <i class="fas fa-star" style="color:#f59e0b"></i> ① 내용 품질 평가 <span style="color:var(--danger)">*</span>
      </div>
      ${_buildRatingBtns('quality_rating')}
      <div id="quality-archive-notice" style="display:none;margin-top:8px;font-size:11px;color:#15803d;background:#dcfce7;border-radius:6px;padding:5px 10px">
        <i class="fas fa-archive"></i> 충족 이상 평가 — DB 저장 자동 체크됩니다.
      </div>
    </div>

    <!-- ② 전문성 별점 자동 계산 미리보기 -->
    <div style="margin-bottom:14px;padding:12px 16px;background:#f0f9ff;border-radius:10px;border:1px solid #bae6fd">
      <div style="font-size:12px;font-weight:600;color:#0369a1;margin-bottom:8px">
        <i class="fas fa-calculator" style="color:#0284c7"></i> ② 전문성 별점 자동 계산
        <span style="font-size:11px;font-weight:400;color:#0369a1;margin-left:4px">(품질평가 × 수행방식)</span>
      </div>
      <div id="competency-preview" style="font-size:13px;color:#64748b">
        품질 평가를 선택하면 자동으로 계산됩니다.
      </div>
      <div style="margin-top:8px;font-size:11px;color:#64748b">
        <span style="background:#e0f2fe;border-radius:4px;padding:1px 6px">독립수행: 그대로</span>
        <span style="background:#e0f2fe;border-radius:4px;padding:1px 6px;margin-left:4px">지도수행: -1단계</span>
        <span style="background:#e0f2fe;border-radius:4px;padding:1px 6px;margin-left:4px">감독수행: -2단계</span>
      </div>
    </div>

    <!-- ③ 자료실 DB 저장 -->
    <div style="margin-bottom:14px;padding:12px 16px;background:#f8fafc;border-radius:10px;border:1px solid var(--border-light)">
      <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">
        <i class="fas fa-database" style="color:#6b7280"></i> ③ 자료실 DB 저장
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="archive-save-check"
          style="width:15px;height:15px;accent-color:var(--primary);cursor:pointer">
        <span style="font-size:13px;font-weight:500;color:var(--text-primary)">자료실에 저장</span>
      </label>
      <div style="margin-top:6px;font-size:11px;color:#f97316">
        <i class="fas fa-shield-alt"></i> 보안 민감 자료는 체크를 해제하세요.
      </div>
    </div>

    <!-- 검토 의견 -->
    <div>
      <label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:6px">
        검토 의견 <span style="color:var(--danger)">* (반려 시 필수)</span>
      </label>
      <textarea class="form-control" id="approval-comment" rows="3" placeholder="검토 의견을 입력하세요."></textarea>
    </div>`;
  _renderApprovalDescView(entry);

  document.getElementById('editEntryBtn').style.display  = '';
  document.getElementById('rejectBtn').style.display     = '';
  const approveBtn = document.getElementById('approveBtn');
  approveBtn.style.display  = '';
  approveBtn.innerHTML      = '<i class="fas fa-check-double"></i> 최종 승인';
  approveBtn.onclick        = () => processApproval2nd('approved');

  const rejectBtn = document.getElementById('rejectBtn');
  rejectBtn.onclick = () => processApproval2nd('rejected');

  // 인터랙션: 품질평가 선택 시 전문성 미리보기 + 저장 체크 자동
  setTimeout(() => {
    const updatePreview = () => {
      const qRating  = document.querySelector('input[name="quality_rating"]:checked')?.value || null;
      const pType    = showMgrPerf
        ? (document.querySelector('input[name="performance_type"]:checked')?.value || 'independent')
        : (entry.performance_type || 'independent');
      const preview  = document.getElementById('competency-preview');
      const archiveCheck = document.getElementById('archive-save-check');
      const archiveNotice = document.getElementById('quality-archive-notice');

      if (qRating && preview) {
        const { competency_stars, competency_rating } = calcCompetency(qRating, pType);
        const starStr = '★'.repeat(competency_stars) + '☆'.repeat(3 - competency_stars);
        preview.innerHTML = `
          <span style="font-weight:600;color:#1a2b45">수행방식: ${PERF_LABEL[pType]||pType}</span>
          <span style="margin:0 8px;color:#94a3b8">×</span>
          <span style="font-weight:600;color:#1a2b45">품질: ${RATING_LABEL[qRating]||qRating}</span>
          <span style="margin:0 8px;color:#94a3b8">→</span>
          <span style="font-weight:700;color:#f59e0b;font-size:15px">${starStr}</span>
          <span style="margin-left:6px;font-size:12px;color:#475569">${RATING_LABEL[competency_rating]||''}</span>`;
        // 저장 자동 체크
        if (archiveCheck) archiveCheck.checked = ARCHIVE_RATINGS.includes(qRating);
        if (archiveNotice) archiveNotice.style.display = ARCHIVE_RATINGS.includes(qRating) ? '' : 'none';
      }
    };

    document.querySelectorAll('.quality-btn[data-group="quality_rating"]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.quality-btn[data-group="quality_rating"]').forEach(b => { b.style.border = '2px solid #e5e7eb'; b.style.background = '#fff'; });
        btn.style.border = '2px solid var(--primary)'; btn.style.background = '#eff6ff';
        updatePreview();
      });
    });
    if (showMgrPerf) {
      document.querySelectorAll('.perf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.perf-btn').forEach(b => { b.style.border = '2px solid #e5e7eb'; b.style.background = '#fff'; });
          btn.style.border = '2px solid var(--primary)'; btn.style.background = '#eff6ff';
          updatePreview();
        });
      });
    }
  }, 50);
}

// ── 읽기 전용 모달 (director 열람 / admin) ───────────────────
function _openApprovalModalReadonly(entry, atts, session) {
  document.getElementById('approvalModalTitle').textContent = '업무기록 상세보기';
  const prevEvalHtml = entry.quality_rating ? `
    <div style="margin-bottom:12px;padding:10px 14px;background:#f8fafc;border-radius:8px;border:1px solid var(--border-light)">
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">
        <div>
          <span style="font-size:11px;color:var(--text-muted)">내용 품질</span>
          <div style="font-weight:600;color:#1a2b45;margin-top:2px">${RATING_LABEL[entry.quality_rating]||''} ${'★'.repeat(RATING_STARS[entry.quality_rating]||0)}</div>
        </div>
        ${entry.performance_type && isClientConsultEntry(entry) ? `<div>
          <span style="font-size:11px;color:var(--text-muted)">수행방식</span>
          <div style="font-weight:600;color:#1a2b45;margin-top:2px">${PERF_LABEL[entry.performance_type]||''}</div>
        </div>` : ''}
        ${entry.competency_rating ? `<div>
          <span style="font-size:11px;color:var(--text-muted)">전문성</span>
          <div style="font-weight:600;color:#f59e0b;margin-top:2px">${'★'.repeat(entry.competency_stars||0)}${'☆'.repeat(3-(entry.competency_stars||0))} ${RATING_LABEL[entry.competency_rating]||''}</div>
        </div>` : ''}
      </div>
    </div>` : '';
  const prevCommentHtml = entry.reviewer_comment
    ? `<div class="alert alert-info"><i class="fas fa-comment"></i> <span>${entry.reviewer_comment}</span></div>`
    : '';

  document.getElementById('approvalModalBody').innerHTML =
    _buildEntryDetailHtml(entry, atts) + prevEvalHtml + prevCommentHtml;
  _renderApprovalDescView(entry);

  document.getElementById('editEntryBtn').style.display  = 'none';
  document.getElementById('rejectBtn').style.display     = 'none';
  document.getElementById('approveBtn').style.display    = 'none';
}

// ══════════════════════════════════════════════
// 1차 승인 처리 (manager)
// ══════════════════════════════════════════════
async function processApproval1st(decision) {
  if (!_approvalTarget) return;
  const session = getSession();
  const comment = document.getElementById('approval-comment')?.value.trim() || '';
  const entry0 = _approvalTarget;
  const isClient = isClientConsultEntry(entry0);
  const isInternalByCategoryName = String(entry0?.work_category_name || '').includes('내부');
  const needsSecondApproval = isClient && !isInternalByCategoryName;

  if (decision === 'rejected' && !comment) {
    Toast.warning('반려 사유를 입력해주세요.');
    document.getElementById('approval-comment')?.focus();
    return;
  }

  const perfType = document.querySelector('input[name="performance_type"]:checked')?.value || null;
  if (decision === 'pre_approved' && needsSecondApproval && !perfType) {
    const pw = document.getElementById('perf-warn');
    if (pw) pw.style.display = '';
    document.querySelectorAll('.perf-btn').forEach(b => { b.style.border = '2px solid #ef4444'; });
    setTimeout(() => document.querySelectorAll('.perf-btn').forEach(b => { b.style.border = '2px solid #e5e7eb'; }), 1800);
    Toast.warning('수행방식을 선택해야 1차 승인할 수 있습니다.');
    return;
  }

  const approveBtn = document.getElementById('approveBtn');
  const rejectBtn  = document.getElementById('rejectBtn');
  const isApprove  = decision === 'pre_approved';
  const approveLoading = isApprove ? (needsSecondApproval ? '1차 승인 중...' : '승인 중...') : '반려 처리 중...';
  const restoreBtn    = BtnLoading.start(isApprove ? approveBtn : rejectBtn, approveLoading);
  const restoreOthers = BtnLoading.disableAll(isApprove ? rejectBtn : approveBtn);

  try {
    let patchData;
    if (decision === 'rejected') {
      patchData = {
        status:           'rejected',
        reviewer_comment: comment,
        reviewed_at:      Date.now(),
        reviewer_id:      session.id,
        reviewer_name:    session.name || '',
      };
    } else if (needsSecondApproval) {
      patchData = {
        status:           'pre_approved',
        reviewer_comment: comment,
        reviewed_at:      Date.now(),
        pre_approver_id:   session.id,
        pre_approver_name: session.name || '',
        pre_approved_at:   Date.now(),
        performance_type:  perfType,
      };
    } else {
      // 내부업무 등: 1차에서 곧바로 최종 승인 (수행방식·pre_approved 미사용)
      patchData = {
        status:           'approved',
        reviewer_comment: comment,
        reviewed_at:      Date.now(),
        reviewer_id:      session.id,
        reviewer_name:    session.name || '',
      };
    }
    const entry1st = _approvalTarget;
    const nextStatus = patchData.status;
    await API.patch('time_entries', entry1st.id, patchData);

    // ── 알림 생성 ─────────────────────────────────────────
    if (typeof createNotification === 'function') {
      const summary1st = `${entry1st.client_name || entry1st.work_category_name} | ${entry1st.work_subcategory_name || ''}`;
      if (nextStatus === 'rejected') {
        createNotification({
          toUserId:     entry1st.user_id,
          toUserName:   entry1st.user_name,
          fromUserId:   session.id,
          fromUserName: session.name,
          type:         'rejected',
          entryId:      entry1st.id,
          entrySummary: summary1st,
          message:      `${session.name}님이 타임시트를 반려했습니다. 사유를 확인하고 수정 후 재제출해주세요.`,
          targetMenu:   'my-entries',
        });
      } else if (nextStatus === 'pre_approved') {
        createNotification({
          toUserId:     entry1st.user_id,
          toUserName:   entry1st.user_name,
          fromUserId:   session.id,
          fromUserName: session.name,
          type:         'pre_approved',
          entryId:      entry1st.id,
          entrySummary: summary1st,
          message:      `${session.name}님이 타임시트를 1차 승인했습니다. 본부장 최종 승인 대기 중입니다.`,
          targetMenu:   'my-entries',
        });
        if (nextStatus === 'pre_approved' && entry1st.reviewer2_id) {
          createNotification({
            toUserId:     entry1st.reviewer2_id,
            toUserName:   entry1st.reviewer2_name,
            fromUserId:   session.id,
            fromUserName: session.name,
            type:         'submitted',
            entryId:      entry1st.id,
            entrySummary: summary1st,
            message:      `${entry1st.user_name}님의 타임시트가 1차 승인되어 최종 승인을 기다리고 있습니다.`,
            targetMenu:   'approval',
          });
        }
      } else if (nextStatus === 'approved') {
        createNotification({
          toUserId:     entry1st.user_id,
          toUserName:   entry1st.user_name,
          fromUserId:   session.id,
          fromUserName: session.name,
          type:         'approved',
          entryId:      entry1st.id,
          entrySummary: summary1st,
          message:      `${session.name}님이 타임시트를 승인했습니다. 🎉`,
          targetMenu:   'my-entries',
        });
      }
    }

    restoreBtn(); restoreOthers();
    closeModal('approvalModal');
    _approvalTarget = null;
    Cache.invalidate('time_entries_list');
    Cache.invalidate('time_entries_badge_' + session.id);
    Cache.invalidate('time_entries_badge_admin_sub');
    Cache.invalidate('time_entries_badge_admin_pre');
    Cache.invalidate('dash_time_entries');
    window._dashNeedsRefresh = true; // 대시보드 재진입 시 콘텐츠 갱신
    await updateApprovalBadge(session, true);
    loadApprovalList();
    if (nextStatus === 'rejected') {
      Toast.success('반려되었습니다.');
    } else if (nextStatus === 'pre_approved') {
      Toast.success('1차 승인 완료 — 본부장 최종 승인 대기');
    } else {
      Toast.success('승인 완료');
    }
  } catch (err) {
    restoreBtn(); restoreOthers();
    Toast.error('처리 실패: ' + err.message);
  }
}

// ══════════════════════════════════════════════
// 2차 최종 승인 처리 (director)
// ══════════════════════════════════════════════
async function processApproval2nd(decision) {
  if (!_approvalTarget) return;
  const session = getSession();
  const comment = document.getElementById('approval-comment')?.value.trim() || '';

  if (decision === 'rejected' && !comment) {
    Toast.warning('반려 사유를 입력해주세요.');
    document.getElementById('approval-comment')?.focus();
    return;
  }

  const isManagerDirect = _approvalTarget.status === 'submitted';
  const mgrClient2nd = isManagerDirect && isClientConsultEntry(_approvalTarget);
  const qRating  = document.querySelector('input[name="quality_rating"]:checked')?.value || null;
  const perfType = mgrClient2nd
    ? (document.querySelector('input[name="performance_type"]:checked')?.value || null)
    : (_approvalTarget.performance_type || 'independent');
  const shouldArchive = document.getElementById('archive-save-check')?.checked || false;

  if (decision === 'approved') {
    if (!qRating) {
      Toast.warning('내용 품질 평가를 선택해야 최종 승인할 수 있습니다.');
      document.querySelectorAll('.quality-btn[data-group="quality_rating"]').forEach(b => { b.style.border = '2px solid #ef4444'; });
      setTimeout(() => document.querySelectorAll('.quality-btn[data-group="quality_rating"]').forEach(b => { b.style.border = '2px solid #e5e7eb'; }), 1800);
      return;
    }
    if (mgrClient2nd && !perfType) {
      Toast.warning('수행방식을 선택해주세요.');
      return;
    }
  }

  const approveBtn = document.getElementById('approveBtn');
  const rejectBtn  = document.getElementById('rejectBtn');
  const isApprove  = decision === 'approved';
  const restoreBtn    = BtnLoading.start(isApprove ? approveBtn : rejectBtn, isApprove ? '최종 승인 중...' : '반려 처리 중...');
  const restoreOthers = BtnLoading.disableAll(isApprove ? rejectBtn : approveBtn);

  const qualityStars = qRating ? (RATING_STARS[qRating] || 0) : 0;
  let competencyStars = 0, competencyRating = null;
  if (qRating && perfType) {
    const comp = calcCompetency(qRating, perfType);
    competencyStars  = comp.competency_stars;
    competencyRating = comp.competency_rating;
  }

  try {
    const patchData = {
      status:           decision,
      reviewer_id:      session.id,
      reviewer_name:    session.name || '',
      reviewer_comment: comment,
      reviewed_at:      Date.now(),
    };
    if (isApprove) {
      Object.assign(patchData, {
        is_archived:       shouldArchive,
        quality_rating:    qRating,
        quality_stars:     qualityStars,
        competency_rating: competencyRating,
        competency_stars:  competencyStars,
        performance_type:  perfType,
      });
      // manager 본인 건인 경우 1차 승인자 정보도 기록
      if (isManagerDirect) {
        Object.assign(patchData, {
          pre_approver_id:   session.id,
          pre_approver_name: session.name || '',
          pre_approved_at:   Date.now(),
        });
      }
    }
    await API.patch('time_entries', _approvalTarget.id, patchData);

    // ── 자료실 저장 ──────────────────────────────────
    if (isApprove && shouldArchive) {
      try {
        const entry = _approvalTarget;
        const starStr   = '★'.repeat(qualityStars) + '☆'.repeat(3 - qualityStars);
        const subject   = entry.work_subcategory_name
          ? `${entry.work_subcategory_name}${entry.client_name ? ' (' + entry.client_name + ')' : ''}`
          : (entry.client_name || entry.work_category_name || '업무기록');
        const tags      = [entry.work_category_name, entry.work_subcategory_name, entry.client_name].filter(Boolean).join(', ');
        const summary   = (entry.work_description || '').trim().substring(0, 200);
        const archivedAt = Date.now();
        // DB mail_references.sent_at 는 text — JSON 숫자만내면 PostgREST/Postgres 타입 불일치 가능
        const sentAtStr = String(archivedAt);
        const wsRaw = entry.work_start_at;
        let workStartMs = null;
        if (wsRaw != null && wsRaw !== '') {
          const n = Number(wsRaw);
          if (Number.isFinite(n)) workStartMs = Math.round(n);
          else {
            const t = new Date(wsRaw).getTime();
            if (Number.isFinite(t)) workStartMs = t;
          }
        }

        const mailRef = await API.create('mail_references', {
          entry_id: entry.id, subject, body_text: entry.work_description||'',
          sender_name: entry.user_name||'', sender_email: '',
          client_id: entry.client_id||'', client_name: entry.client_name||'',
          work_category: entry.work_category_name||'', work_subcategory: entry.work_subcategory_name||'',
          tags, summary, sent_at: sentAtStr, source_type: 'approval',
          registered_by_id: session.id, registered_by_name: session.name||'',
          archived_by_id: session.id, archived_by_name: session.name||'',
          archived_at: archivedAt, quality_rating: qRating,
          quality_stars: qualityStars, star_display: starStr, status: 'active',
        });

        if (mailRef && mailRef.id && _approvalModalAtts.length > 0) {
          let urlOnlyNoBinary = 0;
          for (let idx = 0; idx < _approvalModalAtts.length; idx++) {
            let att = _approvalModalAtts[idx];
            if (att.id) {
              try {
                const g = await API.get('attachments', att.id);
                if (g) att = g;
              } catch (e) {
                console.warn('[저장] 첨부 단건 조회 실패:', att.id, e);
              }
            }
            const fc = att.file_content || '';
            const fu = (att.file_url || '').trim();
            if (!fc && fu.startsWith('http')) urlOnlyNoBinary++;
            await API.create('doc_texts', {
              ref_id: mailRef.id, entry_id: String(entry.id),
              file_name: att.file_name||'첨부파일', file_type: att.file_type||'other',
              file_size: Number(att.file_size) || 0,
              file_content: fc,
              file_url: fu,
              doc_type: att.doc_type === 'mail_pdf' ? 'mail_pdf' : 'normal',
              sort_order: idx, extract_status: 'pending',
            }).catch(e => console.warn('[저장] doc_texts 실패:', e));
          }
          if (urlOnlyNoBinary > 0) {
            Toast.warning(`링크만 등록된 첨부 ${urlOnlyNoBinary}건은 다운로드 대신 「링크 열기」로 확인하세요.`);
          }
        }

        await API.create('archive_items', {
          entry_id: entry.id, user_id: entry.user_id, user_name: entry.user_name,
          team_name: entry.team_name||'', client_name: entry.client_name||'',
          work_category_name: entry.work_category_name||'',
          work_subcategory_name: entry.work_subcategory_name||'',
          subject, summary, tags,
          quality_rating: qRating, quality_stars: qualityStars,
          quality_label: RATING_LABEL[qRating]||'', star_display: starStr,
          performance_type: perfType,
          competency_rating: competencyRating, competency_stars: competencyStars,
          archived_at: archivedAt, work_start_at: workStartMs,
          duration_minutes: Number(entry.duration_minutes) || 0,
        });

        Toast.success(`최종 승인 완료 · ${starStr} 자료실 저장`);
      } catch (archErr) {
        console.error('[자료실 저장 실패]', archErr);
        const hint = (archErr && archErr.message) ? archErr.message : '알 수 없는 오류';
        Toast.warning('최종 승인은 완료되었습니다. 자료실 저장만 실패했습니다: ' + hint);
      }
    } else {
      Toast.success(isApprove ? '최종 승인 완료' : '반려되었습니다.');
    }

    // ── 알림 생성 ─────────────────────────────────────────
    if (typeof createNotification === 'function') {
      const entry2nd   = _approvalTarget;
      const summary2nd = `${entry2nd.client_name || entry2nd.work_category_name} | ${entry2nd.work_subcategory_name || ''}`;
      if (isApprove) {
        // 담당자에게 최종 승인 알림
        createNotification({
          toUserId:     entry2nd.user_id,
          toUserName:   entry2nd.user_name,
          fromUserId:   session.id,
          fromUserName: session.name,
          type:         'approved',
          entryId:      entry2nd.id,
          entrySummary: summary2nd,
          message:      `${session.name}님이 타임시트를 최종 승인했습니다. 🎉`,
          targetMenu:   'my-entries',
        });
      } else {
        // 담당자에게 반려 알림
        createNotification({
          toUserId:     entry2nd.user_id,
          toUserName:   entry2nd.user_name,
          fromUserId:   session.id,
          fromUserName: session.name,
          type:         'rejected',
          entryId:      entry2nd.id,
          entrySummary: summary2nd,
          message:      `${session.name}님이 타임시트를 반려했습니다. 사유를 확인하고 수정 후 재제출해주세요.`,
          targetMenu:   'my-entries',
        });
      }
    }

    restoreBtn(); restoreOthers();
    closeModal('approvalModal');
    _approvalTarget = null;
    Cache.invalidate('time_entries_list');
    Cache.invalidate('time_entries_badge_' + session.id);
    Cache.invalidate('time_entries_badge_admin_sub');
    Cache.invalidate('time_entries_badge_admin_pre');
    Cache.invalidate('dash_time_entries');
    Cache.invalidate('dash_archive_stars');
    window._dashNeedsRefresh = true; // 대시보드 재진입 시 콘텐츠 갱신
    await updateApprovalBadge(session, true);
    loadApprovalList();
  } catch (err) {
    restoreBtn(); restoreOthers();
    Toast.error('처리 실패: ' + err.message);
  }
}

/* ──────────────────────────────────────────
   (레거시 openApprovalModal / processApproval 블록 제거됨)
   현재 사용 함수: openApprovalModal (line ~394), processApproval1st, processApproval2nd
────────────────────────────────────────── */

/* 레거시 openApprovalModal/processApproval 블록 완전 제거됨 */

/* ──────────────────────────────────────────
   인라인 수정 토글 (승인 모달 내)
────────────────────────────────────────── */
let _approvalEditMode = false;
let _approvalQuill = null;  // 승인모달 전용 Quill 인스턴스
let _approvalUseRich = false; // 표 포함 시 contenteditable 사용
let _apvPendingDescHtml = ''; // 대용량 모드에서 "적용"된 임시 HTML (저장 전)

function _apvIsHeavyHtml(html) {
  const s = String(html || '');
  const td = (s.match(/<td[\s>]/gi) || []).length;
  // 기준을 낮춰 "느린 케이스"를 대용량 모드로 확실히 흡수
  return s.length > 60000 || td > 300;
}

// 대용량(엑셀/워드) HTML을 편집 친화적으로 경량화
function _apvOptimizeRichHtml(html) {
  const raw = String(html || '');
  if (!raw) return '';

  // 먼저 기존 클리너(자료실/업무기록에서 검증된) 있으면 재사용
  let cleaned = raw;
  try {
    if (typeof window._cleanPasteHtml === 'function') cleaned = window._cleanPasteHtml(cleaned);
  } catch {}

  // 작은 내용은 여기서 종료
  const tdCount = (cleaned.match(/<td[\s>]/gi) || []).length;
  const heavy = cleaned.length > 120000 || tdCount > 800;
  if (!heavy) return cleaned;

  // 무거운 경우: style/class 등 과도한 속성 제거 + span/div 래핑 최소화(표 구조 보존)
  try {
    const doc = new DOMParser().parseFromString(`<div id="__root__">${cleaned}</div>`, 'text/html');
    const root = doc.getElementById('__root__');
    if (!root) return cleaned;

    const keepAttr = (el, name) => {
      const n = String(name || '').toLowerCase();
      return (
        n === 'colspan' || n === 'rowspan' ||
        n === 'width'   || n === 'height'  ||
        n === 'href'    || n === 'src'     ||
        n === 'alt'
      );
    };

    const all = root.querySelectorAll('*');
    all.forEach(el => {
      // 표/셀에 과도한 style이 붙는 게 가장 느려짐 → 대부분 제거
      // (width/height는 attribute로 보존)
      const attrs = Array.from(el.attributes || []);
      attrs.forEach(a => {
        const nm = a.name;
        if (!keepAttr(el, nm)) el.removeAttribute(nm);
      });
      // inline style 제거
      try { el.removeAttribute('style'); } catch {}
    });

    // span만 잔뜩 중첩된 케이스: 의미 없는 span unwrap (텍스트/BR만 유지)
    root.querySelectorAll('span').forEach(sp => {
      const hasMeaningful = sp.querySelector('br,table,tr,td,th,div,p,ul,ol,li,img,a');
      if (hasMeaningful) return;
      const parent = sp.parentNode;
      if (!parent) return;
      while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
      parent.removeChild(sp);
    });

    return root.innerHTML;
  } catch {
    return cleaned;
  }
}

// 보기(상세/대용량)용: 표 구조는 최대한 보존하고 Word/Excel 잔여물만 제거
function _apvCleanDescHtmlForView(html) {
  let s = String(html || '').trim();
  if (!s) return '';
  try {
    if (typeof window._cleanPasteHtml === 'function') s = window._cleanPasteHtml(s);
  } catch {}

  try {
    const doc = new DOMParser().parseFromString(`<div id="__apv_view__">${s}</div>`, 'text/html');
    const root = doc.getElementById('__apv_view__');
    if (!root) return s;

    // Word/Excel 잔여 태그 제거
    root.querySelectorAll('style,script,xml,meta,link,o\\:p,w\\:sdt,w\\:sdtContent').forEach(el => {
      try { el.remove(); } catch {}
    });

    // 의미 없는 텍스트 덩어리(Word 헤더) 제거: "Normal 0 0 ..." / "MicrosoftInternetExplorer4"
    const killRe = /(MicrosoftInternetExplorer4|^Normal\s+0\s+0\s+\d+)/i;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const toRemove = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const t = String(n?.nodeValue || '').trim();
      if (!t) continue;
      if (killRe.test(t)) toRemove.push(n);
    }
    toRemove.forEach(n => { try { n.remove(); } catch {} });

    return root.innerHTML;
  } catch {
    return s;
  }
}

function _apvBindRichPasteOnce() {
  const richEl = document.getElementById('approval-edit-rich');
  if (!richEl || richEl._apvPasteBound) return;
  richEl._apvPasteBound = true;

  richEl.addEventListener('paste', (e) => {
    try {
      // 가능하면 HTML로 받고, 없으면 plain text로 삽입
      const cd = e.clipboardData;
      const htmlData = cd ? cd.getData('text/html') : '';
      const textData = cd ? cd.getData('text/plain') : '';
      if (!htmlData && !textData) return;
      e.preventDefault();

      const toInsert = htmlData
        ? _apvCleanDescHtmlForView(htmlData)
        : Utils.escHtml(textData).replace(/\n/g, '<br>');
      document.execCommand('insertHTML', false, toInsert);
    } catch {
      // 브라우저가 paste를 막으면 기본 동작으로 fallback
    }
  });
}

function _apvFocusRichEditor() {
  try {
    const richEl = document.getElementById('approval-edit-rich');
    if (!richEl) return;
    richEl.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(richEl);
    range.collapse(false); // 커서를 맨 끝으로
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {}
}

function resetApprovalModalState() {
  try {
    if (window._apvDebug) console.log('[approval] resetApprovalModalState');
  } catch {}

  _approvalTarget = null;
  _approvalEditMode = false;
  _approvalUseRich = false;
  _approvalQuill = null;
  _apvPendingDescHtml = '';

  // 버튼 상태 복구
  const editBtn = document.getElementById('editEntryBtn');
  if (editBtn) {
    editBtn.disabled = false;
    editBtn.innerHTML = '<i class="fas fa-edit"></i> 수정';
    editBtn.className = 'btn btn-outline';
    editBtn.onclick = toggleApprovalEdit;
  }
  const rejectBtn = document.getElementById('rejectBtn');
  if (rejectBtn) { rejectBtn.disabled = false; rejectBtn.innerHTML = '<i class="fas fa-times"></i> 반려'; }
  const approveBtn = document.getElementById('approveBtn');
  if (approveBtn) { approveBtn.disabled = false; approveBtn.innerHTML = '<i class="fas fa-check"></i> 승인'; }

  // 수행내용 영역 복구
  const descView = document.getElementById('approval-desc-view');
  const quillWrap = document.getElementById('approval-edit-quill-wrap');
  const richWrap = document.getElementById('approval-edit-rich-wrap');
  if (quillWrap) quillWrap.style.display = 'none';
  if (richWrap) richWrap.style.display = 'none';
  if (descView) descView.style.display = '';
  if (descView) {
    // 기본 높이 복원 (대용량 모드에서 확장될 수 있음)
    descView.style.maxHeight = '320px';
    descView.style.border = '1px solid var(--border-light)';
    descView.style.background = '#f8fafc';
  }
  const heavyNotice = document.getElementById('approval-rich-heavy-notice');
  if (heavyNotice) heavyNotice.style.display = 'none';

  // 소분류 원복
  const subcatBox = document.getElementById('approval-edit-subcat');
  if (subcatBox) {
    subcatBox.setAttribute('disabled', '');
    subcatBox.style.background = '#f8fafc';
    subcatBox.style.border = '';
  }

  // 자문분류 편집 UI 정리
  const kwEditEl = document.getElementById('approval-kw-edit');
  if (kwEditEl) kwEditEl.innerHTML = '';
  const kwViewEl = document.getElementById('approval-kw-view');
  if (kwViewEl) kwViewEl.style.display = '';

  // 첨부 삭제 버튼 숨김
  if (typeof _apvSetAttachmentDeleteUiVisible === 'function') {
    _apvSetAttachmentDeleteUiVisible(false);
  }
}

function closeApprovalModal() {
  resetApprovalModalState();
  closeModal('approvalModal');
}

/* 자문분류 태그 상태 (편집 중) */
let _editKwQuery  = [];
let _editKwReason = [];
let _editLawRefs  = [];

/* 자문분류 편집 UI를 현재 _approvalTarget 값으로 초기화 */
function _initApprovalKwEdit() {
  const t = _approvalTarget;
  try { _editKwQuery  = Array.isArray(t.kw_query)  ? [...t.kw_query]  : (t.kw_query  ? JSON.parse(t.kw_query)  : []); } catch { _editKwQuery  = []; }
  try { _editKwReason = Array.isArray(t.kw_reason) ? [...t.kw_reason] : (t.kw_reason ? JSON.parse(t.kw_reason) : []); } catch { _editKwReason = []; }
  try { _editLawRefs  = typeof t.law_refs === 'string' ? JSON.parse(t.law_refs || '[]') : (t.law_refs || []); } catch { _editLawRefs = []; }
  _editLawRefs = _editLawRefs.map(r => typeof r === 'string' ? { law: r, article: '' } : r);
}

/* 태그 HTML만 생성 (버튼은 data-* 속성 + 이벤트 위임 방식) */
function _kwTagHTML(arr, type, bg, clr) {
  return arr.map((t, i) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:${bg};color:${clr};border-radius:5px;padding:2px 8px;font-size:12px;margin:2px">
      ${Utils.escHtml(String(t))}
      <button type="button" data-kw-remove="${type}" data-kw-idx="${i}"
        style="background:none;border:none;cursor:pointer;color:inherit;padding:0;font-size:11px;line-height:1">✕</button>
    </span>`).join('');
}
function _kwLawHTML(arr) {
  return arr.map((r, i) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:#ede9fe;color:#5b21b6;border-radius:5px;padding:2px 8px;font-size:12px;margin:2px">
      <i class="fas fa-balance-scale" style="font-size:9px"></i>${Utils.escHtml((r.law||'')+(r.article?' '+r.article:''))}
      <button type="button" data-kw-remove="law" data-kw-idx="${i}"
        style="background:none;border:none;cursor:pointer;color:inherit;padding:0;font-size:11px;line-height:1">✕</button>
    </span>`).join('');
}

/* 태그 영역만 부분 업데이트 */
function _refreshKwTags() {
  const kwSection = document.getElementById('approval-kw-edit');
  const root = kwSection || document;
  const qt = root.querySelector('#apv-kw-query-tags');
  const lt = root.querySelector('#apv-kw-law-tags');
  const rt = root.querySelector('#apv-kw-reason-tags');
  if (qt) qt.innerHTML = _kwTagHTML(_editKwQuery,  'kw_query',  '#e0e7ff', '#3730a3');
  if (lt) lt.innerHTML = _kwLawHTML(_editLawRefs);
  if (rt) rt.innerHTML = _kwTagHTML(_editKwReason, 'kw_reason', '#f0fdf4', '#166534');
}

/* 편집 UI 렌더링 — 항상 완전 재렌더 + 동기 이벤트 등록 */
function _renderKwEdit() {
  const kwSection = document.getElementById('approval-kw-edit');
  if (!kwSection) return;

  // 항상 완전 재렌더 (이전 상태 완전 초기화)
  kwSection.innerHTML = `
    <div id="apv-kw-edit-panel" style="background:#f0f0ff;border:1.5px solid #a5b4fc;border-radius:10px;padding:12px 14px;margin-top:10px">
      <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:10px;display:flex;align-items:center;gap:5px"><i class="fas fa-tags"></i> 자문 분류 정보 수정</div>

      <div style="margin-bottom:8px">
        <div style="font-size:10px;color:#6b7280;font-weight:600;margin-bottom:4px">핵심키워드</div>
        <div id="apv-kw-query-tags" style="min-height:28px;margin-bottom:6px">${_kwTagHTML(_editKwQuery,'kw_query','#e0e7ff','#3730a3')}</div>
        <div style="display:flex;gap:6px">
          <input id="apv-kw-query-input" type="text" placeholder="키워드 입력 후 Enter"
            style="flex:1;font-size:12px;padding:4px 8px;border:1px solid #c7d2fe;border-radius:6px;outline:none">
          <button type="button" id="apv-kw-query-add-btn" style="background:#4f46e5;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer">추가</button>
        </div>
      </div>

      <div style="margin-bottom:8px">
        <div style="font-size:10px;color:#6b7280;font-weight:600;margin-bottom:4px">관련법령 <span style="font-size:10px;font-weight:400">(법령명 + 조문)</span></div>
        <div id="apv-kw-law-tags" style="min-height:28px;margin-bottom:6px">${_kwLawHTML(_editLawRefs)}</div>
        <div style="display:flex;gap:6px">
          <input id="apv-kw-law-input" type="text" placeholder="법령명 (예: 관세법)"
            style="flex:2;font-size:12px;padding:4px 8px;border:1px solid #c7d2fe;border-radius:6px;outline:none">
          <input id="apv-kw-law-art" type="text" placeholder="조문 (예: 제84조)"
            style="flex:1;font-size:12px;padding:4px 8px;border:1px solid #c7d2fe;border-radius:6px;outline:none">
          <button type="button" id="apv-kw-law-add-btn" style="background:#5b21b6;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer">추가</button>
        </div>
      </div>

      <div>
        <div style="font-size:10px;color:#6b7280;font-weight:600;margin-bottom:4px">판단사유</div>
        <div id="apv-kw-reason-tags" style="min-height:28px;margin-bottom:6px">${_kwTagHTML(_editKwReason,'kw_reason','#f0fdf4','#166534')}</div>
        <div style="display:flex;gap:6px">
          <input id="apv-kw-reason-input" type="text" placeholder="판단사유 입력 후 Enter"
            style="flex:1;font-size:12px;padding:4px 8px;border:1px solid #c7d2fe;border-radius:6px;outline:none">
          <button type="button" id="apv-kw-reason-add-btn" style="background:#15803d;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer">추가</button>
        </div>
      </div>
    </div>`;

  // ── 동기적으로 즉시 이벤트 등록 (setTimeout 없음) ──
  const qInput = kwSection.querySelector('#apv-kw-query-input');
  const qBtn   = kwSection.querySelector('#apv-kw-query-add-btn');
  const lInput = kwSection.querySelector('#apv-kw-law-input');
  const lArt   = kwSection.querySelector('#apv-kw-law-art');
  const lBtn   = kwSection.querySelector('#apv-kw-law-add-btn');
  const rInput = kwSection.querySelector('#apv-kw-reason-input');
  const rBtn   = kwSection.querySelector('#apv-kw-reason-add-btn');
  const panel  = kwSection.querySelector('#apv-kw-edit-panel');

  // document.getElementById 대신 kwSection.querySelector 사용 (DOM 범위 한정)
  if (qInput) qInput.addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();e.stopPropagation();_apvAddKwTag('kw_query');} });
  if (qBtn)   qBtn.addEventListener('click',    e => { e.preventDefault();e.stopPropagation();_apvAddKwTag('kw_query'); });
  if (lInput) lInput.addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();e.stopPropagation();_apvAddKwTag('law');} });
  if (lArt)   lArt.addEventListener('keydown',   e => { if (e.key==='Enter'){e.preventDefault();e.stopPropagation();_apvAddKwTag('law');} });
  if (lBtn)   lBtn.addEventListener('click',    e => { e.preventDefault();e.stopPropagation();_apvAddKwTag('law'); });
  if (rInput) rInput.addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();e.stopPropagation();_apvAddKwTag('kw_reason');} });
  if (rBtn)   rBtn.addEventListener('click',    e => { e.preventDefault();e.stopPropagation();_apvAddKwTag('kw_reason'); });

  // 삭제 버튼: panel 에 이벤트 위임
  if (panel) {
    panel.addEventListener('click', e => {
      const btn = e.target.closest('[data-kw-remove]');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      _apvRemoveKwTag(btn.dataset.kwRemove, parseInt(btn.dataset.kwIdx, 10));
    });
  }
}

function _apvAddKwTag(type) {
  // kwSection 내부에서 querySelector로 탐색 (apv- 접두사로 중복 ID 방지)
  const kwSection = document.getElementById('approval-kw-edit');
  if (type === 'law') {
    const lawInput = (kwSection || document).querySelector('#apv-kw-law-input');
    const artInput = (kwSection || document).querySelector('#apv-kw-law-art');
    const law = (lawInput?.value || '').trim();
    if (!law) { lawInput?.focus(); return; }
    _editLawRefs.push({ law, article: (artInput?.value || '').trim() });
    if (lawInput) lawInput.value = '';
    if (artInput) artInput.value = '';
  } else if (type === 'kw_query') {
    const inp = (kwSection || document).querySelector('#apv-kw-query-input');
    const v = (inp?.value || '').trim();
    if (!v) { inp?.focus(); return; }
    _editKwQuery.push(v);
    if (inp) inp.value = '';
  } else if (type === 'kw_reason') {
    const inp = (kwSection || document).querySelector('#apv-kw-reason-input');
    const v = (inp?.value || '').trim();
    if (!v) { inp?.focus(); return; }
    _editKwReason.push(v);
    if (inp) inp.value = '';
  }
  _refreshKwTags();
}

function _apvRemoveKwTag(type, idx) {
  if (type === 'kw_query')       _editKwQuery.splice(idx, 1);
  else if (type === 'kw_reason') _editKwReason.splice(idx, 1);
  else if (type === 'law')       _editLawRefs.splice(idx, 1);
  _refreshKwTags(); // 태그 영역만 갱신
}

function _apvHtmlToPlainText(html) {
  try {
    const doc = new DOMParser().parseFromString(`<div>${String(html || '')}</div>`, 'text/html');
    const root = doc.body;
    if (!root) return String(html || '');

    // Word/Excel 메타 제거 (텍스트 변환 시 mso-* 스타일이 위로 튀는 현상 방지)
    root.querySelectorAll('style,script,xml,meta,link').forEach(el => el.remove());
    // 조건부 주석/일반 주석 제거
    root.querySelectorAll('*').forEach(el => {
      Array.from(el.childNodes || []).forEach(n => {
        if (n.nodeType === Node.COMMENT_NODE) try { n.remove(); } catch {}
      });
    });

    // 표는 TSV 비슷하게 변환
    root.querySelectorAll('table').forEach(tbl => {
      const rows = Array.from(tbl.querySelectorAll('tr')).map(tr =>
        Array.from(tr.querySelectorAll('th,td')).map(td =>
          (td.textContent || '')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \f\v]+/g, ' ')
            .trim()
        ).join('\t')
      );
      const pre = doc.createElement('pre');
      pre.textContent = rows.join('\n');
      tbl.replaceWith(pre);
    });
    // 텍스트 후처리: mso- 라인/스타일 덩어리 제거
    const t0 = (root.textContent || '').replace(/\u00a0/g, ' ');
    // 탭 기반 표 정렬이 무너지지 않도록 "전체 trim"은 하지 않고 trailing만 정리
    const lines = t0.split(/\r?\n/).map(s => String(s || '').replace(/[ \t]+$/g, ''));
    const filtered = lines.filter(ln => {
      const t = String(ln || '').trim();
      if (!t) return false;
      if (/^mso-[a-z-]+\s*:/i.test(t)) return false;
      if (/^font-(family|size)\s*:/i.test(t)) return false;
      if (/^page-break/i.test(t)) return false;
      if (/MicrosoftInternetExplorer4/i.test(t)) return false;
      if (/^Normal\s+0\s+0\s+\d+/i.test(t)) return false;
      return true;
    });
    return filtered.join('\n').trim();
  } catch {
    return String(html || '');
  }
}

async function _apvCopyText(s) {
  const txt = String(s || '');
  if (!txt) { Toast.warning('복사할 내용이 없습니다.'); return; }
  try {
    await navigator.clipboard.writeText(txt);
    Toast.success('복사되었습니다.');
  } catch {
    // fallback: selection 기반
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); Toast.success('복사되었습니다.'); } catch { Toast.error('복사에 실패했습니다.'); }
    ta.remove();
  }
}

function _apvCopyDescAsText() {
  const html = _apvPendingDescHtml || _approvalTarget?.work_description || document.getElementById('approval-edit-rich')?.innerHTML || document.getElementById('approval-desc-view')?.innerHTML || '';
  return _apvCopyText(_apvHtmlToPlainText(html));
}
function _apvCopyDescAsHtml() {
  const html = _apvPendingDescHtml || _approvalTarget?.work_description || document.getElementById('approval-edit-rich')?.innerHTML || document.getElementById('approval-desc-view')?.innerHTML || '';
  return _apvCopyText(String(html || '').trim());
}

function _apvOpenLargeEditHelper() {
  const curHtml = (_approvalTarget?.work_description || document.getElementById('approval-edit-rich')?.innerHTML || '').trim();
  const initial = _apvHtmlToPlainText(curHtml);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.style.zIndex = '10002';

  const modal = document.createElement('div');
  modal.className = 'modal modal-lg';
  modal.style.cssText = 'max-width:760px;border-radius:14px;overflow:hidden';

  modal.innerHTML = `
    <div class="modal-header" style="background:#fffbeb;border-bottom:1px solid #fde68a">
      <h3 style="display:flex;align-items:center;gap:8px"><i class="fas fa-bolt" style="color:#b45309"></i> 대용량 수행내용 텍스트 편집</h3>
      <button class="btn-close" type="button">×</button>
    </div>
    <div class="modal-body" style="padding:14px 16px">
      <div style="font-size:12px;color:#92400e;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:10px 12px;margin-bottom:10px;line-height:1.5">
        표가 아주 큰 경우 브라우저 편집 성능이 떨어질 수 있어, 여기서는 <strong>텍스트로 빠르게 수정</strong>할 수 있게 제공합니다.<br>
        저장하면 수행내용이 이 텍스트로 교체됩니다. (표 형태 유지가 필요하면 HTML 복사를 이용해 외부에서 편집 후 다시 붙여넣어 주세요.)
      </div>
      <textarea id="apv-large-edit-ta" class="form-control" rows="14" style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace;font-size:12.5px;line-height:1.6;white-space:pre;tab-size:4"></textarea>
    </div>
    <div class="modal-footer" style="background:#fafbfc">
      <button type="button" class="btn btn-ghost" data-act="cancel">취소</button>
      <button type="button" class="btn btn-outline" data-act="copy">내용 복사</button>
      <button type="button" class="btn btn-primary" data-act="apply">적용</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const ta = modal.querySelector('#apv-large-edit-ta');
  if (ta) ta.value = initial;

  const close = () => { overlay.remove(); };
  modal.querySelector('.btn-close')?.addEventListener('click', close);
  modal.querySelector('[data-act="cancel"]')?.addEventListener('click', close);
  modal.querySelector('[data-act="copy"]')?.addEventListener('click', () => _apvCopyText(ta?.value || ''));
  modal.querySelector('[data-act="apply"]')?.addEventListener('click', () => {
    const v = (ta?.value || '').trim();
    // 수행내용 UI 제거 상태에서는 빈 값도 허용 (기존 데이터 유지/빈 반영 여부는 저장 로직이 결정)
    // text → html (줄바꿈 유지)
    const html = v ? `<p>${Utils.escHtml(v).replace(/\n/g, '<br>')}</p>` : '';
    _apvPendingDescHtml = html;
    const richEl = document.getElementById('approval-edit-rich');
    if (richEl) richEl.innerHTML = html;
    const viewEl = document.getElementById('approval-desc-view');
    if (viewEl) viewEl.innerHTML = html;
    close();
    Toast.info('적용되었습니다. 저장 버튼을 누르면 반영됩니다.');
  });

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  setTimeout(() => { try { ta?.focus(); } catch {} }, 0);
}

function toggleApprovalEdit() {
  if (!_approvalTarget) return;
  try {
    if (window._apvDebug) console.log('[approval] toggleApprovalEdit', { editMode: _approvalEditMode, hasTarget: !!_approvalTarget });
  } catch {}
  _approvalEditMode = !_approvalEditMode;

  const editBtn   = document.getElementById('editEntryBtn');
  const rejectBtn = document.getElementById('rejectBtn');
  const approveBtn = document.getElementById('approveBtn');
  const archiveBtn = document.getElementById('approveAndArchiveBtn');

  if (_approvalEditMode) {
    // ── 수정 모드 진입 ──
    editBtn.innerHTML = '<i class="fas fa-save"></i> 저장';
    editBtn.className = 'btn btn-primary';
    editBtn.onclick = saveApprovalEdit;
    if (rejectBtn)  rejectBtn.style.display  = 'none';
    if (approveBtn) approveBtn.style.display = 'none';
    if (archiveBtn) archiveBtn.style.display = 'none';

    // ── 수행 내용: 대용량이면 조회 박스 유지 + 별도 편집창 사용 ──
    const descView  = document.getElementById('approval-desc-view');
    const quillWrap = document.getElementById('approval-edit-quill-wrap');
    const richWrap  = document.getElementById('approval-edit-rich-wrap');
    if (descView)  descView.style.display  = 'none';
    if (quillWrap) quillWrap.style.display = 'none';
    if (richWrap)  richWrap.style.display  = 'none';

    // 현재 저장된 HTML 로드
    const curHtml = (_approvalTarget.work_description || '').trim();
    const hasTable = /<table[\s>]/i.test(curHtml);
    const heavyRaw = _apvIsHeavyHtml(curHtml);
    _approvalUseRich = hasTable && !heavyRaw;

    if (hasTable && heavyRaw) {
      Toast.info('대용량 표는 수정 저장이 제한됩니다. 필요하면 반려 후 재신청하거나 “텍스트 편집”을 사용하세요.');
      // 대용량: contenteditable로 전환하지 않고, 조회 박스(스크롤/복사 최적)를 그대로 사용
      if (descView) {
        const done = GlobalBusy?.show ? GlobalBusy.show('대용량 내용 준비 중...') : (() => {});
        try {
          descView.innerHTML = _apvCleanDescHtmlForView(curHtml);
        } finally { done(); }
        descView.style.display = '';
        descView.style.border = '1.5px solid var(--primary)';
        descView.style.background = '#fff';
      }
      const notice = document.getElementById('approval-rich-heavy-notice');
      if (notice) notice.style.display = '';
      // 조회 박스가 스크롤을 더 잘 받도록 높이 확장
      if (descView) {
        descView.style.maxHeight = '60vh';
      }
      _approvalUseRich = false;
    } else if (_approvalUseRich) {
      if (richWrap) richWrap.style.display = '';
      const richEl = document.getElementById('approval-edit-rich');
      if (richEl) {
        richEl.setAttribute('spellcheck', 'false');
        const done = GlobalBusy?.show ? GlobalBusy.show('편집 준비 중...') : (() => {});
        try {
          // 저장 시 표/레이아웃이 깨지는 문제 방지: "표용 편집"에서는 과도한 최적화 금지
          // (Word/Excel 잔여물만 제거하고 표 구조/속성은 보존)
          richEl.innerHTML = _apvCleanDescHtmlForView(curHtml);

          const notice = document.getElementById('approval-rich-heavy-notice');
          if (notice) notice.style.display = 'none';
          richEl.setAttribute('contenteditable', 'true');
        } finally {
          done();
        }
        _apvBindRichPasteOnce();
      }
      setTimeout(_apvFocusRichEditor, 0);
    } else {
      if (quillWrap) quillWrap.style.display = '';
      // Quill 초기화 (없으면 생성, 있으면 내용만 교체)
      const quillEl = document.getElementById('approval-edit-quill');
      if (quillEl) {
        if (!_approvalQuill) {
          _approvalQuill = new Quill('#approval-edit-quill', {
            theme: 'snow',
            modules: {
              toolbar: [
                [{ header: [1,2,3,false] }],
                ['bold','italic','underline'],
                [{ list:'ordered'},{list:'bullet'}],
                ['clean']
              ],
              clipboard: { matchVisual: false }
            }
          });
        }
        _approvalQuill.setContents([]);
        _approvalQuill.clipboard.dangerouslyPasteHTML(curHtml);
        setTimeout(() => _approvalQuill?.focus?.(), 0);
      }
    }

    // 소분류 입력 활성화
    const subcatBox = document.getElementById('approval-edit-subcat');
    if (subcatBox) {
      subcatBox.removeAttribute('disabled');
      subcatBox.style.background = '#fff';
      subcatBox.style.border = '1.5px solid var(--primary)';
    }

    // ── 자문분류 편집 UI 표시 (고객업무만) ──
    if (_approvalTarget.time_category === 'client') {
      const kwViewEl = document.getElementById('approval-kw-view');
      if (kwViewEl) kwViewEl.style.display = 'none';
      _initApprovalKwEdit();
      _renderKwEdit();
    }

    // 첨부파일 삭제 버튼 노출 (수정 모드에서만)
    _apvSetAttachmentDeleteUiVisible(true);

    Toast.info('수정할 내용을 입력 후 저장 버튼을 눌러주세요.');
  } else {
    // ── 수정 취소 ──
    editBtn.innerHTML = '<i class="fas fa-edit"></i> 수정';
    editBtn.className = 'btn btn-outline';
    editBtn.onclick = toggleApprovalEdit;
    if (rejectBtn)  rejectBtn.style.display  = '';
    if (approveBtn) approveBtn.style.display = '';
    if (archiveBtn) archiveBtn.style.display = '';

    // view div 복원
    const descView2  = document.getElementById('approval-desc-view');
    const quillWrap  = document.getElementById('approval-edit-quill-wrap');
    const richWrap   = document.getElementById('approval-edit-rich-wrap');
    if (quillWrap) quillWrap.style.display = 'none';
    if (richWrap)  richWrap.style.display  = 'none';
    if (descView2) {
      const html = _approvalTarget.work_description || '';
      descView2.innerHTML = html.trim()
        ? (html.startsWith('<') ? html : '<p>' + Utils.escHtml(html) + '</p>')
        : '<span style="color:var(--text-muted);font-size:12px">(내용 없음)</span>';
      descView2.style.display = '';
    }

    // 소분류 비활성화
    const subcatBox = document.getElementById('approval-edit-subcat');
    if (subcatBox) {
      subcatBox.value = _approvalTarget.work_subcategory_name || '';
      subcatBox.setAttribute('disabled','');
      subcatBox.style.background = '#f8fafc';
      subcatBox.style.border = '';
    }

    // 자문분류 view 복원
    if (_approvalTarget.time_category === 'client') {
      const kwEditEl = document.getElementById('approval-kw-edit');
      if (kwEditEl) kwEditEl.innerHTML = '';
      const kwViewEl = document.getElementById('approval-kw-view');
      if (kwViewEl) kwViewEl.style.display = '';
    }

    // 첨부파일 삭제 버튼 숨김
    _apvSetAttachmentDeleteUiVisible(false);
    _approvalUseRich = false;
  }
}

async function saveApprovalEdit() {
  if (!_approvalTarget) return;
  try {
    if (window._apvDebug) console.log('[approval] saveApprovalEdit', { useRich: _approvalUseRich });
  } catch {}

  // 대용량(heavy) 표는 웹 편집 경로에서 표 구조가 손실될 수 있어, 기본적으로 수행내용 수정 저장을 막는다.
  // 단, 사용자가 "텍스트 편집"을 통해 명시적으로 교체(_apvPendingDescHtml)한 경우에만 저장 허용.
  const _origHtml = String(_approvalTarget.work_description || '').trim();
  const _origHasTable = /<table[\s>]/i.test(_origHtml);
  const _origIsHeavy = _origHasTable && _apvIsHeavyHtml(_origHtml);
  let allowDescSave = !_origIsHeavy || !!_apvPendingDescHtml;
  // 수행내용 UI를 제거(숨김)한 경우: 내용 저장/검증을 건너뛰고 원본 유지
  try {
    const dv = document.getElementById('approval-desc-view');
    const hidden = !dv || (() => {
      let p = dv;
      while (p) {
        if (p.style && p.style.display === 'none') return true;
        p = p.parentElement;
      }
      return false;
    })();
    if (hidden) allowDescSave = false;
  } catch (_) { /* ignore */ }

  // Quill에서 HTML 읽기
  let newDesc = '';
  if (_apvPendingDescHtml) {
    newDesc = String(_apvPendingDescHtml || '').trim();
  } else if (_approvalUseRich) {
    newDesc = document.getElementById('approval-edit-rich')?.innerHTML?.trim() || '';
  } else if (_approvalQuill) {
    newDesc = _approvalQuill.root.innerHTML.trim();
    // Quill 빈 상태 체크
    if (newDesc === '<p><br></p>' || newDesc === '') newDesc = '';
  } else {
    const descBox = document.getElementById('approval-edit-desc');
    newDesc = descBox ? descBox.value.trim() : '';
  }
  if (allowDescSave) {
    // 기존 UX 유지 (수행내용 UI가 있을 때만 필수 검증)
    if (!newDesc) { Toast.warning('수행 내용을 입력해주세요.'); return; }
  } else {
    // heavy 표: 수행내용은 저장하지 않음(원본 유지)
    newDesc = _origHtml;
  }

  const subcatBox = document.getElementById('approval-edit-subcat');
  const newSubcat = subcatBox ? subcatBox.value.trim() : '';

  const editBtn = document.getElementById('editEntryBtn');
  const restore = BtnLoading.start(editBtn, '저장 중...');
  try {
    const patchData = {
      work_subcategory_name: newSubcat || _approvalTarget.work_subcategory_name,
    };
    if (allowDescSave) {
      patchData.work_description = newDesc;
    }

    // 자문분류 필드도 저장 (고객업무만)
    if (_approvalTarget.time_category === 'client') {
      patchData.kw_query  = JSON.stringify(_editKwQuery);
      patchData.kw_reason = JSON.stringify(_editKwReason);
      patchData.law_refs  = JSON.stringify(_editLawRefs);
    }

    await API.patch('time_entries', _approvalTarget.id, patchData);

    // 전역 타겟 업데이트
    if (allowDescSave) _approvalTarget.work_description = newDesc;
    _approvalTarget.work_subcategory_name = newSubcat || _approvalTarget.work_subcategory_name;
    if (_approvalTarget.time_category === 'client') {
      _approvalTarget.kw_query  = _editKwQuery;
      _approvalTarget.kw_reason = _editKwReason;
      _approvalTarget.law_refs  = _editLawRefs;
    }

    // view div 업데이트
    const descView3 = document.getElementById('approval-desc-view');
    const quillWrap = document.getElementById('approval-edit-quill-wrap');
    const richWrap  = document.getElementById('approval-edit-rich-wrap');
    if (descView3) {
      const vHtml = allowDescSave ? newDesc : _origHtml;
      descView3.innerHTML = vHtml.trim()
        ? (vHtml.startsWith('<') ? vHtml : '<p>' + Utils.escHtml(vHtml) + '</p>')
        : '<span style="color:var(--text-muted);font-size:12px">(내용 없음)</span>';
      descView3.style.display = '';
    }
    if (quillWrap) quillWrap.style.display = 'none';
    if (richWrap)  richWrap.style.display  = 'none';

    // 자문분류 view 갱신
    if (_approvalTarget.time_category === 'client') {
      const kwEditEl = document.getElementById('approval-kw-edit');
      if (kwEditEl) kwEditEl.innerHTML = '';
      const kwViewEl = document.getElementById('approval-kw-view');
      if (kwViewEl) {
        const tagBadge = (arr, bg, clr) => arr.map(t =>
          `<span style="display:inline-flex;align-items:center;background:${bg};color:${clr};border-radius:5px;padding:2px 8px;font-size:11px;margin:2px">${Utils.escHtml(String(t))}</span>`).join('');
        const lawBadge = (arr) => arr.map(r =>
          `<span style="display:inline-flex;align-items:center;gap:3px;background:#ede9fe;color:#5b21b6;border-radius:5px;padding:2px 8px;font-size:11px;margin:2px"><i class="fas fa-balance-scale" style="font-size:9px"></i>${Utils.escHtml((r.law||'')+(r.article?' '+r.article:''))}</span>`).join('');
        const kwQ = _editKwQuery, kwR = _editKwReason, lawR = _editLawRefs;
        if (!kwQ.length && !kwR.length && !lawR.length) {
          kwViewEl.style.display = 'none';
        } else {
          kwViewEl.innerHTML = `
            <div style="background:#f8f9ff;border:1px solid #c7d2fe;border-radius:10px;padding:12px 14px;margin-bottom:12px">
              <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:8px;display:flex;align-items:center;gap:5px"><i class="fas fa-tags"></i> 자문 분류 정보</div>
              ${kwQ.length ? `<div style="margin-bottom:6px"><span style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">핵심키워드</span>${tagBadge(kwQ,'#e0e7ff','#3730a3')}</div>` : ''}
              ${lawR.length ? `<div style="margin-bottom:6px"><span style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">관련법령</span>${lawBadge(lawR)}</div>` : ''}
              ${kwR.length ? `<div><span style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">판단사유</span>${tagBadge(kwR,'#f0fdf4','#166534')}</div>` : ''}
            </div>`;
          kwViewEl.style.display = '';
        }
      }
    }

    restore();
    _approvalEditMode = false;
    _approvalUseRich = false;
    _apvPendingDescHtml = '';
    editBtn.innerHTML = '<i class="fas fa-edit"></i> 수정';
    editBtn.className = 'btn btn-outline';
    editBtn.onclick = toggleApprovalEdit;

    if (subcatBox) { subcatBox.setAttribute('disabled',''); subcatBox.style.background = '#f8fafc'; subcatBox.style.border = ''; }

    const rejectBtn  = document.getElementById('rejectBtn');
    const approveBtn = document.getElementById('approveBtn');
    const archiveBtn = document.getElementById('approveAndArchiveBtn');
    if (rejectBtn)  rejectBtn.style.display  = '';
    if (approveBtn) approveBtn.style.display = '';
    if (archiveBtn) archiveBtn.style.display = '';

    if (!allowDescSave) {
      Toast.info('대용량 표는 수행내용 수정 저장이 제한되어, 수행내용은 원본이 유지되었습니다. (필요 시 반려 후 재신청)');
    } else {
      Toast.success('수정 내용이 저장되었습니다.');
    }
  } catch(err) {
    restore();
    Toast.error('저장 실패: ' + err.message);
  }
}

// quickApprove: 제거됨 — 상세 모달에서 품질 평가 후 승인 처리
// (제거됨 — 상세보기 버튼만 사용, 품질 평가는 상세 모달에서 처리)

// 첨부파일 일괄 로드 (entry id 배열 → map)
async function loadAttachmentsMap(entryIds) {
  if (!entryIds.length) return {};
  try {
    const r = await API.list('attachments', { limit: 500 });
    const all = (r && r.data) ? r.data : [];
    const map = {};
    const idSet = new Set(entryIds);
    all.forEach(a => { if (idSet.has(a.entry_id)) { (map[a.entry_id] = map[a.entry_id] || []).push(a); } });
    return map;
  } catch { return {}; }
}

function changePage(p) {
  _approvalPage = p;
  loadApprovalList();
}

// ─────────────────────────────────────────────
// ★ 승인 모달 — Base64 파일 다운로드
// _approvalModalAtts 전역에서 idx로 직접 참조 (DB 재조회 없음)
// ─────────────────────────────────────────────
function downloadApprovalFile(idx) {
  const a = _approvalModalAtts[idx];
  if (!a) { Toast.error('첨부파일 정보를 찾을 수 없습니다.'); return; }

  // entry.js의 _openFilePreview 재사용 (전역 함수)
  if (typeof _openFilePreview === 'function') {
    _openFilePreview(a);
    return;
  }

  // fallback: _openFilePreview를 직접 실행
  if (!a.file_content || !a.file_content.startsWith('data:')) {
    if (a.file_url && a.file_url.startsWith('http')) {
      window.open(a.file_url, '_blank');
    } else {
      Toast.error('저장된 파일 데이터가 없습니다.');
    }
    return;
  }
  // base64 → blob → 새 탭 미리보기
  try {
    const [meta, b64] = a.file_content.split(',');
    const mime = (meta.match(/:(.*?);/) || [])[1] || 'application/octet-stream';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) Toast.info('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    Toast.error('파일 미리보기 실패: ' + e.message);
  }
}

// ── entry_id 기반으로 첨부파일 조회 후 뷰어 열기 (배지 클릭용) ──
async function openAttachmentViewerById(entryId) {
  try {
    const r = await API.list('attachments', { limit: 500 });
    const atts = (r && r.data) ? r.data.filter(a => a.entry_id === entryId) : [];
    if (!atts.length) { Toast.info('첨부 파일이 없습니다.'); return; }
    // ★ _approvalModalAtts도 갱신 (배지 클릭 후 모달 내 다운로드 버튼 대응)
    _approvalModalAtts = atts;
    openAttachmentViewer(atts);  // entry.js의 openAttachmentViewer 재사용 (_viewerAtts 설정됨)
  } catch(err) {
    Toast.error('첨부파일 조회 실패: ' + err.message);
  }
}
