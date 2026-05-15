/* mobile-approval.js — 모바일 승인 전용 MVP */

let _mobileApprovalEntries = [];
let _mobileApprovalSelectedId = '';
let _mobileApprovalLoading = false;
let _mobileApprovalBound = false;
let _mobileApprovalActionInFlight = false;

function _mobileApprovalCanAccess(session) {
  if (!session) return false;
  return Auth.canApprove(session) || Auth.canViewDeptScope(session);
}

function _mobileApprovalParseTs(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  if (!isNaN(n) && n > 1000000000000) return n;
  if (!isNaN(n) && n > 1000000000) return n * 1000;
  const t = new Date(raw).getTime();
  return isNaN(t) ? 0 : t;
}

function _mobileApprovalFmtDateTime(raw) {
  const ts = _mobileApprovalParseTs(raw);
  if (!ts) return '—';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${day} ${hh}:${mm}`;
}

function _mobileApprovalToPlainText(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  const decodeEl = document.createElement('textarea');
  decodeEl.innerHTML = text;
  text = decodeEl.value;
  if (/<[^>]+>/.test(text)) {
    text = text
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*p\s*>/gi, '\n')
      .replace(/<\/\s*div\s*>/gi, '\n')
      .replace(/<\/\s*li\s*>/gi, '\n')
      .replace(/<\s*li[^>]*>/gi, '- ');
    const htmlEl = document.createElement('div');
    htmlEl.innerHTML = text;
    text = htmlEl.textContent || htmlEl.innerText || '';
  }
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function _mobileApprovalSelectedStatus() {
  const el = document.getElementById('mobile-approval-status');
  return String(el && el.value || 'pending').trim();
}

function _mobileApprovalSelectedKind() {
  const el = document.getElementById('mobile-approval-kind');
  return String(el && el.value || 'all').trim();
}

function _mobileApprovalIsProjectEntry(entry) {
  return String(entry && entry._mobile_kind || '') === 'project';
}

function _mobileApprovalIsPending(entry) {
  if (_mobileApprovalIsProjectEntry(entry)) return String(entry && entry.status || '') === 'pending';
  return _approvalIsPendingStatus(entry && entry.status);
}

function _mobileApprovalStatusBadge(entry) {
  if (_mobileApprovalIsProjectEntry(entry)) {
    return '<span class="status-badge status-submitted">프로젝트 승인대기</span>';
  }
  return Utils.statusBadge(entry.status);
}

function _mobileApprovalEsc(v) {
  return Utils.escHtml(v == null ? '' : String(v));
}

function _mobileApprovalProjectFileLink(name, url) {
  const fileName = String(name || '').trim();
  const fileUrl = String(url || '').trim();
  if (!fileUrl) return '<span style="color:var(--text-muted)">없음</span>';
  const label = _mobileApprovalEsc(fileName || '파일 열기');
  return `<a class="mobile-approval-project-file-link" href="${_mobileApprovalEsc(fileUrl)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-paperclip"></i>${label}</a>`;
}

function _mobileApprovalRenderProjectMeta(entry) {
  const step = _mobileApprovalEsc(entry._mobile_project_step_label || '승인대기');
  const route = _mobileApprovalEsc(entry.work_subcategory_name || '-');
  const routeDetail = _mobileApprovalEsc(entry._mobile_project_route_detail || '-');
  const contractReason = _mobileApprovalEsc(entry._mobile_project_contract_reason || '-');
  const contract = _mobileApprovalProjectFileLink(entry._mobile_project_contract_file_name, entry._mobile_project_contract_file_url);
  const evidence = _mobileApprovalProjectFileLink(entry._mobile_project_evidence_file_name, entry._mobile_project_evidence_file_url);
  const routeFile = _mobileApprovalProjectFileLink(entry._mobile_project_route_file_name, entry._mobile_project_route_file_url);
  return `
    <div class="mobile-approval-project-meta-row"><span class="mobile-approval-project-meta-k">승인 단계</span><span class="mobile-approval-project-meta-v">${step}</span></div>
    <div class="mobile-approval-project-meta-row"><span class="mobile-approval-project-meta-k">수주경로</span><span class="mobile-approval-project-meta-v">${route}</span></div>
    <div class="mobile-approval-project-meta-row"><span class="mobile-approval-project-meta-k">세부내역</span><span class="mobile-approval-project-meta-v">${routeDetail}</span></div>
    <div class="mobile-approval-project-meta-row"><span class="mobile-approval-project-meta-k">미첨부 사유</span><span class="mobile-approval-project-meta-v">${contractReason}</span></div>
    <div class="mobile-approval-project-meta-row"><span class="mobile-approval-project-meta-k">계약서</span><span class="mobile-approval-project-meta-v">${contract}</span></div>
    <div class="mobile-approval-project-meta-row"><span class="mobile-approval-project-meta-k">합의 근거</span><span class="mobile-approval-project-meta-v">${evidence}</span></div>
    <div class="mobile-approval-project-meta-row"><span class="mobile-approval-project-meta-k">수주경로 증빙</span><span class="mobile-approval-project-meta-v">${routeFile}</span></div>
  `;
}

function _mobileApprovalRenderSummary() {
  const summaryEl = document.getElementById('mobile-approval-summary');
  if (!summaryEl) return;
  const pending = _mobileApprovalEntries.filter((e) => _mobileApprovalIsPending(e)).length;
  summaryEl.textContent = `총 ${_mobileApprovalEntries.length}건 · 승인대기 ${pending}건`;
}

function _mobileApprovalRenderList() {
  const listEl = document.getElementById('mobile-approval-list');
  if (!listEl) return;
  if (_mobileApprovalLoading) {
    listEl.innerHTML = `<div class="mobile-approval-empty"><i class="fas fa-spinner fa-spin"></i> 불러오는 중...</div>`;
    return;
  }
  if (!_mobileApprovalEntries.length) {
    listEl.innerHTML = `<div class="mobile-approval-empty"><i class="fas fa-check-circle"></i> 처리할 승인 건이 없습니다.</div>`;
    _mobileApprovalRenderDetail();
    return;
  }
  listEl.innerHTML = _mobileApprovalEntries.map((e) => {
    const id = String(e.id || '');
    const active = id === _mobileApprovalSelectedId ? 'is-active' : '';
    const sub = String(e._project_subcategory_label || e.work_subcategory_name || '—').trim();
    const projCode = String(e.project_code || '').trim();
    const subtitle = projCode ? `${sub} · ${projCode}` : sub;
    const badge = _mobileApprovalStatusBadge(e);
    return `<button type="button" class="mobile-approval-item ${active}" onclick="openMobileApprovalDetail('${id}')">
      <div class="mobile-approval-item-top">
        <strong>${Utils.escHtml(e.user_name || '—')}</strong>
        <span>${badge}</span>
      </div>
      <div class="mobile-approval-item-main">${Utils.escHtml(e.client_name || e.work_category_name || '내부업무')}</div>
      <div class="mobile-approval-item-sub">${Utils.escHtml(subtitle || '—')}</div>
      <div class="mobile-approval-item-time">${_mobileApprovalFmtDateTime(e.work_start_at || e.created_at)}</div>
    </button>`;
  }).join('');
  _mobileApprovalRenderDetail();
}

function _mobileApprovalDetailRequiresQuality(entry) {
  if (_mobileApprovalIsProjectEntry(entry)) return false;
  const session = getSession();
  if (!entry || !session) return false;
  const canSecond = Auth.canApprove2nd(session) && _approvalFilterSecondApproverPending([entry], session).length > 0;
  return canSecond && needsSecondApprovalQuality(entry);
}

function _mobileApprovalCanAct(entry) {
  if (_mobileApprovalIsProjectEntry(entry)) return !!entry._canAct;
  const session = getSession();
  if (!entry || !session) return false;
  if (_approvalCanDoFirst(session, entry)) return true;
  if (Auth.canApprove2nd(session) && _approvalFilterSecondApproverPending([entry], session).length > 0) return true;
  return false;
}

function _mobileApprovalRenderDetail() {
  const wrap = document.getElementById('mobile-approval-detail-wrap');
  const empty = document.getElementById('mobile-approval-detail-empty');
  const card = document.getElementById('mobile-approval-detail-card');
  if (!wrap || !empty || !card) return;
  const entry = _mobileApprovalEntries.find((e) => String(e.id || '') === String(_mobileApprovalSelectedId || ''));
  if (!entry) {
    empty.style.display = '';
    card.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  card.style.display = '';
  const canAct = _mobileApprovalCanAct(entry);
  const requiresQuality = _mobileApprovalDetailRequiresQuality(entry);

  const writerEl = document.getElementById('mobile-approval-detail-writer');
  const catEl = document.getElementById('mobile-approval-detail-category');
  const subEl = document.getElementById('mobile-approval-detail-sub');
  const periodEl = document.getElementById('mobile-approval-detail-period');
  const durationEl = document.getElementById('mobile-approval-detail-duration');
  const projEl = document.getElementById('mobile-approval-detail-project');
  const descEl = document.getElementById('mobile-approval-detail-desc');
  const projectMetaEl = document.getElementById('mobile-approval-project-meta');
  const qualityWrap = document.getElementById('mobile-approval-quality-wrap');
  const approveBtn = document.getElementById('mobile-approval-btn-approve');
  const rejectBtn = document.getElementById('mobile-approval-btn-reject');
  const commentEl = document.getElementById('mobile-approval-comment');

  if (_mobileApprovalIsProjectEntry(entry)) {
    if (writerEl) writerEl.textContent = entry.user_name || '—';
    if (catEl) catEl.textContent = '프로젝트 등록';
    if (subEl) subEl.textContent = entry.work_subcategory_name || '—';
    if (periodEl) periodEl.textContent = `${_mobileApprovalFmtDateTime(entry.period_start)} ~ ${_mobileApprovalFmtDateTime(entry.period_end)}`;
    if (durationEl) durationEl.textContent = '—';
    if (projEl) projEl.textContent = entry.project_code ? `${entry.project_code} / ${entry.project_name || '-'}` : (entry.project_name || '—');
    if (descEl) {
      const projectDesc = entry._mobile_project_route_detail || entry._mobile_project_contract_reason || entry.work_description;
      descEl.textContent = _mobileApprovalToPlainText(projectDesc) || '—';
    }
    if (projectMetaEl) {
      projectMetaEl.innerHTML = _mobileApprovalRenderProjectMeta(entry);
      projectMetaEl.style.display = '';
    }
    if (commentEl) commentEl.placeholder = '반려 시 사유 입력(필수)';
  } else {
    if (writerEl) writerEl.textContent = entry.user_name || '—';
    if (catEl) catEl.textContent = entry.work_category_name || '—';
    if (subEl) subEl.textContent = (entry._project_subcategory_label || entry.work_subcategory_name || '—');
    if (periodEl) periodEl.textContent = `${_mobileApprovalFmtDateTime(entry.work_start_at)} ~ ${_mobileApprovalFmtDateTime(entry.work_end_at)}`;
    if (durationEl) durationEl.textContent = Utils.formatDuration(entry.duration_minutes || 0);
    if (projEl) projEl.textContent = entry.project_code ? `${entry.project_code} / ${entry.project_name || '-'}` : '—';
    if (descEl) descEl.textContent = _mobileApprovalToPlainText(entry.work_description) || '—';
    if (projectMetaEl) {
      projectMetaEl.style.display = 'none';
      projectMetaEl.innerHTML = '';
    }
    if (commentEl) commentEl.placeholder = '코멘트(반려 시 필수)';
  }
  if (qualityWrap) qualityWrap.style.display = requiresQuality ? '' : 'none';
  if (approveBtn) approveBtn.disabled = !canAct;
  if (rejectBtn) rejectBtn.disabled = !canAct;
  if (commentEl && !canAct) commentEl.value = '';
}

async function openMobileApprovalDetail(entryId) {
  _mobileApprovalSelectedId = String(entryId || '');
  _mobileApprovalRenderList();
}

async function _mobileApprovalLoadProjectEntries(session, statusMode) {
  if (statusMode === 'submitted' || statusMode === 'pre_approved') return [];
  try {
    await _approvalEnsureProjRegScript();
  } catch (e) {
    console.warn('[mobile-approval] project module load failed', e);
    return [];
  }
  const P = window.SmartlogProjReg;
  if (!P || !P.normStatus) return [];
  let rows = [];
  try {
    rows = await API.listAllPages('registered_projects', {
      limit: 500,
      maxPages: 10,
      sort: 'created_at',
      filter: 'registration_status=in.(pending,approved,rejected)',
    });
  } catch (e) {
    console.warn('[mobile-approval] project rows load failed', e);
    return [];
  }
  rows = (rows || []).filter((r) => P.normStatus(r) !== 'draft');
  rows = await _scopeProjectRowsForApproval(rows, session);
  rows = rows.filter((r) => P.normStatus(r) === 'pending');
  if (!Auth.canViewAll(session) && !Auth.isCeo(session)) {
    rows = rows.filter((r) => _approvalProjCanApproveStrict(session, r, P));
  }
  return rows.map((r) => {
    const rowId = String(r.id || '').trim();
    return {
      id: `project:${rowId}`,
      _mobile_raw_id: rowId,
      _mobile_kind: 'project',
      _canAct: _approvalProjCanApproveStrict(session, r, P),
      status: 'pending',
      user_name: r.created_by_name || r.registered_by_name || r.order_owner_text || '—',
      client_name: r.client_name || '',
      work_category_name: '프로젝트 등록',
      work_subcategory_name: r.acquisition_route || '프로젝트 승인',
      project_code: r.project_code || '',
      project_name: r.project_name || '',
      work_description: r.acquisition_route_detail || r.contract_exception_reason || '',
      _mobile_project_step_label: (typeof _approvalProjStepLabel === 'function') ? _approvalProjStepLabel(r, P) : '승인대기',
      _mobile_project_route_detail: r.acquisition_route_detail || '',
      _mobile_project_contract_reason: r.contract_exception_reason || '',
      _mobile_project_contract_file_name: r.contract_file_name || '',
      _mobile_project_contract_file_url: r.contract_file_url || '',
      _mobile_project_evidence_file_name: r.contract_evidence_file_name || '',
      _mobile_project_evidence_file_url: r.contract_evidence_file_url || '',
      _mobile_project_route_file_name: r.order_evidence_file_name || '',
      _mobile_project_route_file_url: r.order_evidence_file_url || '',
      created_at: r.created_at || 0,
      updated_at: r.updated_at || 0,
      period_start: r.period_start || '',
      period_end: r.period_end || '',
    };
  });
}

async function loadMobileApprovalList() {
  const session = getSession();
  const listEl = document.getElementById('mobile-approval-list');
  if (!session || !_mobileApprovalCanAccess(session)) {
    if (listEl) listEl.innerHTML = `<div class="mobile-approval-empty"><i class="fas fa-lock"></i> 접근 권한이 없습니다.</div>`;
    return;
  }
  _mobileApprovalLoading = true;
  _mobileApprovalRenderList();
  try {
    const searchKw = String((document.getElementById('mobile-approval-search') || {}).value || '').trim().toLowerCase();
    const dateFrom = String((document.getElementById('mobile-approval-date-from') || {}).value || '').trim();
    const dateTo = String((document.getElementById('mobile-approval-date-to') || {}).value || '').trim();
    const statusMode = _mobileApprovalSelectedStatus();
    const kindMode = _mobileApprovalSelectedKind();
    const allUsers = await Master.users().catch(() => []);
    const usersById = _approvalBuildUserMap(allUsers);

    let fetched = [];
    if (statusMode === 'submitted') {
      fetched = await _approvalPaginateTimeEntries('status=eq.submitted');
    } else if (statusMode === 'pre_approved') {
      fetched = await _approvalPaginateTimeEntries('status=eq.pre_approved');
    } else if (statusMode === 'all') {
      try {
        fetched = await _approvalPaginateTimeEntries('status=neq.draft');
      } catch (_) {
        fetched = await _approvalPaginateTimeEntries('');
        fetched = fetched.filter((e) => String(e.status || '') !== 'draft');
      }
    } else {
      const [submitted, pre] = await Promise.all([
        _approvalPaginateTimeEntries('status=eq.submitted'),
        _approvalPaginateTimeEntries('status=eq.pre_approved'),
      ]);
      fetched = _mergeTimeEntriesById([submitted, pre]);
    }

    let entries = await _scopeTimeEntriesForApproval(
      fetched,
      session,
      { hq: '', team: '', hqScope: 'hq' },
      usersById
    );

    if (statusMode === 'pending') {
      entries = _approvalFilterSecondApproverPending(entries, session);
    } else if (statusMode === 'submitted' || statusMode === 'pre_approved') {
      entries = _approvalFilterSecondApproverPending(entries, session).filter((e) => String(e.status || '') === statusMode);
    }

    let projectEntries = await _mobileApprovalLoadProjectEntries(session, statusMode);

    if (dateFrom || dateTo) {
      entries = entries.filter((e) => {
        if (_approvalIsPendingStatus(e && e.status)) return true;
        return _approvalEntryInDateRange(e, dateFrom, dateTo);
      });
      projectEntries = projectEntries.filter((e) => {
        const ts = _mobileApprovalParseTs(e.created_at || e.updated_at);
        if (!ts) return true;
        const d = new Date(ts);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${day}`;
        if (dateFrom && key < dateFrom) return false;
        if (dateTo && key > dateTo) return false;
        return true;
      });
    }

    if (searchKw) {
      entries = entries.filter((e) => {
        const blob = [
          e.user_name, e.client_name, e.work_category_name, e.work_subcategory_name,
          e.project_code, e.project_name, e.work_description,
        ].map((v) => String(v || '').toLowerCase()).join(' ');
        return blob.includes(searchKw);
      });
      projectEntries = projectEntries.filter((e) => {
        const blob = [
          e.user_name, e.client_name, e.work_category_name, e.work_subcategory_name,
          e.project_code, e.project_name, e.work_description, e._mobile_project_contract_reason,
        ].map((v) => String(v || '').toLowerCase()).join(' ');
        return blob.includes(searchKw);
      });
    }

    const hasProjectRows = entries.some((e) =>
      String(e.work_category_name || '').trim() === '프로젝트업무' && String(e.project_code || '').trim()
    );
    if (hasProjectRows) {
      await _apvEnsureProjCodeTypes();
      for (const e of entries) await _apvAttachProjectSubcategory(e);
    }

    let combined = entries.concat(projectEntries);
    if (kindMode === 'timesheet') combined = entries;
    else if (kindMode === 'project') combined = projectEntries;

    combined.sort((a, b) => {
      const pa = _mobileApprovalIsPending(a) ? 0 : 1;
      const pb = _mobileApprovalIsPending(b) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return _mobileApprovalParseTs(b && (b.work_start_at || b.updated_at || b.created_at))
        - _mobileApprovalParseTs(a && (a.work_start_at || a.updated_at || a.created_at));
    });

    _mobileApprovalEntries = combined;
    if (!_mobileApprovalEntries.some((e) => String(e.id || '') === _mobileApprovalSelectedId)) {
      _mobileApprovalSelectedId = _mobileApprovalEntries.length ? String(_mobileApprovalEntries[0].id || '') : '';
    }
    _mobileApprovalLoading = false;
    _mobileApprovalRenderSummary();
    _mobileApprovalRenderList();
  } catch (err) {
    console.error('[mobile-approval] load failed', err);
    if (listEl) {
      listEl.innerHTML = `<div class="mobile-approval-empty"><i class="fas fa-exclamation-circle"></i> 데이터 로드 실패</div>`;
    }
  } finally {
    _mobileApprovalLoading = false;
  }
}

async function mobileApprovalProcess(decision) {
  if (_mobileApprovalActionInFlight) return;
  const entry = _mobileApprovalEntries.find((e) => String(e.id || '') === String(_mobileApprovalSelectedId || ''));
  if (!entry) return;
  if (!_mobileApprovalCanAct(entry)) {
    Toast.warning('처리 권한이 없습니다.');
    return;
  }
  _mobileApprovalActionInFlight = true;
  const approveBtn = document.getElementById('mobile-approval-btn-approve');
  const rejectBtn = document.getElementById('mobile-approval-btn-reject');
  const commentEl = document.getElementById('mobile-approval-comment');
  const qualityEl = document.getElementById('mobile-approval-quality');
  const perfEl = document.getElementById('mobile-approval-performance');
  const isApprove = decision === 'approved';
  const restoreBtn = BtnLoading.start(isApprove ? approveBtn : rejectBtn, isApprove ? '승인 중...' : '반려 중...');
  const restoreOther = BtnLoading.disableAll(isApprove ? rejectBtn : approveBtn);
  try {
    if (_mobileApprovalIsProjectEntry(entry)) {
      await _approvalEnsureProjRegScript();
      const P = window.SmartlogProjReg;
      if (!P || typeof P.approve !== 'function' || typeof P.reject !== 'function') {
        throw new Error('프로젝트 승인 모듈이 준비되지 않았습니다.');
      }
      const projectId = String(entry._mobile_raw_id || '').trim();
      if (!projectId) throw new Error('프로젝트 승인 대상이 없습니다.');
      if (decision === 'approved') {
        await P.approve(projectId);
      } else {
        const reason = String(commentEl ? commentEl.value : '').trim();
        if (!reason) throw new Error('반려 사유를 입력해주세요.');
        const originalPrompt = window.prompt;
        window.prompt = () => reason;
        try {
          await P.reject(projectId);
        } finally {
          window.prompt = originalPrompt;
        }
      }
    } else {
      await approvalProcessMobile(entry.id, decision, {
        comment: commentEl ? commentEl.value : '',
        qualityRating: qualityEl ? qualityEl.value : '',
        performanceType: perfEl ? perfEl.value : '',
      });
      Toast.success(decision === 'approved' ? '승인 처리되었습니다.' : '반려 처리되었습니다.');
    }
    if (commentEl) commentEl.value = '';
    await loadMobileApprovalList();
  } catch (err) {
    Toast.error(err && err.message ? err.message : '처리 실패');
  } finally {
    restoreBtn();
    restoreOther();
    _mobileApprovalActionInFlight = false;
  }
}

function _mobileApprovalBindEvents() {
  if (_mobileApprovalBound) return;
  const refreshBtn = document.getElementById('mobile-approval-refresh-btn');
  const kindEl = document.getElementById('mobile-approval-kind');
  const statusEl = document.getElementById('mobile-approval-status');
  const searchEl = document.getElementById('mobile-approval-search');
  const fromEl = document.getElementById('mobile-approval-date-from');
  const toEl = document.getElementById('mobile-approval-date-to');
  if (refreshBtn) refreshBtn.addEventListener('click', () => loadMobileApprovalList());
  if (kindEl) kindEl.addEventListener('change', () => loadMobileApprovalList());
  if (statusEl) statusEl.addEventListener('change', () => loadMobileApprovalList());
  if (searchEl) searchEl.addEventListener('input', () => loadMobileApprovalList());
  if (fromEl) fromEl.addEventListener('change', () => loadMobileApprovalList());
  if (toEl) toEl.addEventListener('change', () => loadMobileApprovalList());
  _mobileApprovalBound = true;
}

async function init_mobile_approval() {
  const session = getSession();
  if (!_mobileApprovalCanAccess(session)) {
    Toast.warning('모바일 승인 화면 접근 권한이 없습니다.');
    navigateTo('dashboard');
    return;
  }
  _mobileApprovalBindEvents();
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const toEl = document.getElementById('mobile-approval-date-to');
  if (toEl && !toEl.value) toEl.value = `${y}-${m}-${d}`;
  _mobileApprovalSelectedId = '';
  await updateApprovalBadge(session, true);
  await loadMobileApprovalList();
}
