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

function _mobileApprovalIsBatchEntry(entry) {
  return !_mobileApprovalIsProjectEntry(entry) && String(entry && entry.entry_mode || '') === 'batch';
}

function _mobileApprovalIsPending(entry) {
  if (_mobileApprovalIsProjectEntry(entry)) return String(entry && entry.status || '') === 'pending';
  if (_mobileApprovalIsBatchEntry(entry)) {
    const session = getSession();
    if (!session) return false;
    return String(entry.status || '') === 'submitted' &&
           String(entry.approver_id || '') === String(session.id);
  }
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
  if (_mobileApprovalIsBatchEntry(entry)) return false; // 배치: 품질 평가 없음
  const session = getSession();
  if (!entry || !session) return false;
  const canSecond = Auth.canApprove2nd(session) && _approvalFilterSecondApproverPending([entry], session).length > 0;
  return canSecond && needsSecondApprovalQuality(entry);
}

function _mobileApprovalCanAct(entry) {
  if (_mobileApprovalIsProjectEntry(entry)) return !!entry._canAct;
  const session = getSession();
  if (!entry || !session) return false;
  if (_mobileApprovalIsBatchEntry(entry)) {
    // 배치: 1차 승인으로 종결 — approver_id로 지정된 사람이면 승인 가능
    return String(entry.status || '') === 'submitted' &&
           String(entry.approver_id || '') === String(session.id);
  }
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
  } else if (_mobileApprovalIsBatchEntry(entry)) {
    // ── 일괄기록 상세 ──────────────────────────────
    if (writerEl) writerEl.textContent = entry.user_name || '—';
    if (catEl) catEl.textContent = '일괄기록';
    if (subEl) subEl.textContent = `${entry.doc_no || '—'}`;
    if (periodEl) periodEl.textContent = Utils.formatDate ? Utils.formatDate(entry.work_start_at) : _mobileApprovalFmtDateTime(entry.work_start_at).slice(0, 10);
    if (durationEl) durationEl.textContent = Utils.formatDuration(entry.duration_minutes || 0);
    if (projEl) projEl.textContent = Utils.statusBadge ? '' : entry.status;
    if (projectMetaEl) { projectMetaEl.style.display = 'none'; projectMetaEl.innerHTML = ''; }
    if (commentEl) commentEl.placeholder = '코멘트(반려 시 필수)';
    // 배치 상세행 비동기 로드
    if (descEl) {
      descEl.innerHTML = '<span style="color:var(--text-muted);font-size:12px"><i class="fas fa-spinner fa-spin"></i> 상세 내역 로드 중...</span>';
      _mobileApprovalLoadBatchDetails(entry.id).then((details) => {
        descEl.innerHTML = _mobileApprovalBatchDetailTable(details);
      }).catch(() => {
        descEl.textContent = '상세 내역을 불러올 수 없습니다.';
      });
    }
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

async function _mobileApprovalLoadBatchDetails(entryId) {
  const rows = await API.listAllPages('time_entry_details', {
    filter: `entry_id=eq.${encodeURIComponent(String(entryId || ''))}`,
    sort: 'row_order',
    limit: 200,
    maxPages: 20,
  }).catch(() => []);
  const CAT_ORDER = ['일반통관업무', '프로젝트업무', '기타 고객업무', '회사내부업무'];
  const CLIENT_CATS = new Set(['일반통관업무', '프로젝트업무', '기타 고객업무']);
  rows.sort((a, b) => {
    const pA = CAT_ORDER.indexOf(String(a.work_category_name || ''));
    const pB = CAT_ORDER.indexOf(String(b.work_category_name || ''));
    const pa = pA === -1 ? CAT_ORDER.length : pA;
    const pb = pB === -1 ? CAT_ORDER.length : pB;
    if (pa !== pb) return pa - pb;
    return (Number(a.row_order) || 0) - (Number(b.row_order) || 0);
  });
  return { rows, clientCats: CLIENT_CATS };
}

function _mobileApprovalBatchDetailTable({ rows, clientCats }) {
  if (!rows || !rows.length) return '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">상세 내역이 없습니다.</div>';
  const th = 'padding:6px 8px;font-size:11px;font-weight:600;color:var(--text-secondary);background:#f8fafc;border-bottom:1px solid var(--border-light);white-space:nowrap;text-align:center';
  const td = 'padding:6px 8px;font-size:11px;border-bottom:1px solid var(--border-light);white-space:nowrap';
  const rowsHtml = rows.map((r, i) => {
    const isProject = String(r.work_category_name || '') === '프로젝트업무';
    const sub = isProject ? (r.project_code || r.work_subcategory_name || '—') : (r.work_subcategory_name || '—');
    const client = clientCats.has(String(r.work_category_name || ''))
      ? Utils.escHtml(r.client_name || '—')
      : '<span style="color:var(--text-muted)">—</span>';
    const dur = r.duration_minutes ? `${r.duration_minutes}분` : '—';
    const rowBg = i % 2 === 1 ? 'background:#f8fafc' : '';
    return `<tr style="${rowBg}">
      <td style="${td};text-align:center;color:var(--text-muted)">${i + 1}</td>
      <td style="${td}">${Utils.escHtml(r.work_category_name || '—')}</td>
      <td style="${td}">${Utils.escHtml(sub)}</td>
      <td style="${td}">${client}</td>
      <td style="${td};max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:normal;line-height:1.4">${Utils.escHtml(r.work_note || '')}</td>
      <td style="${td};text-align:center;font-weight:600;color:var(--primary)">${dur}</td>
    </tr>`;
  }).join('');
  return `<div style="overflow-x:auto;margin-top:8px;border:1px solid var(--border-light);border-radius:8px">
    <table style="width:100%;border-collapse:collapse;min-width:400px">
      <thead><tr>
        <th style="${th}">No</th>
        <th style="${th}">대분류</th>
        <th style="${th}">소분류</th>
        <th style="${th}">고객사</th>
        <th style="${th}">업무내용</th>
        <th style="${th}">소요시간</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}

// 모바일용 일반자문 승인 처리 (기존 modal DOM 불필요 버전)
async function approvalProcessMobile(entryId, decision, opts = {}) {
  const session = getSession();
  const { comment = '', qualityRating = '', performanceType = '' } = opts;
  const entry = _mobileApprovalEntries.find((e) => String(e.id || '') === String(entryId));
  if (!entry) throw new Error('승인 대상을 찾을 수 없습니다.');
  const isApprove = decision !== 'rejected';
  if (!isApprove && !comment) throw new Error('반려 사유를 입력해주세요.');
  const is2nd = Auth.canApprove2nd(session) && needsSecondApproval(entry) &&
    entry.status === 'pre_approved' && String(entry.reviewer2_id || '') === String(session.id);
  const needs2nd = needsSecondApproval(entry);
  const nextStatus = isApprove ? (needs2nd && !is2nd ? 'pre_approved' : 'approved') : 'rejected';
  const patchData = {
    status: nextStatus,
    reviewer_comment: comment,
    reviewed_at: Date.now(),
    reviewer_id: session.id,
    reviewer_name: session.name || '',
  };
  if (qualityRating) patchData.quality_rating = qualityRating;
  if (performanceType) patchData.performance_type = performanceType;
  await API.patch('time_entries', entryId, patchData);
  if (typeof createNotification === 'function') {
    createNotification({
      toUserId: entry.user_id, toUserName: entry.user_name,
      fromUserId: session.id, fromUserName: session.name,
      type: isApprove ? (nextStatus === 'pre_approved' ? 'pre_approved' : 'approved') : 'rejected',
      entryId, message: comment,
    }).catch(() => {});
    if (nextStatus === 'pre_approved' && entry.reviewer2_id) {
      createNotification({
        toUserId: entry.reviewer2_id, toUserName: entry.reviewer2_name || '',
        fromUserId: session.id, fromUserName: session.name,
        type: 'review_requested', entryId,
      }).catch(() => {});
    }
  }
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

    let allFetched = await _scopeTimeEntriesForApproval(
      fetched,
      session,
      { hq: '', team: '', hqScope: 'hq' },
      usersById
    );

    // 배치와 일반자문 분리
    let batchEntries = allFetched.filter((e) => _mobileApprovalIsBatchEntry(e));
    let entries = allFetched.filter((e) => !_mobileApprovalIsBatchEntry(e));

    // 배치: 1차 승인 전용 — approver_id가 본인인 submitted 건만 노출
    batchEntries = batchEntries.filter((e) => {
      if (String(e.status || '') !== 'submitted') return statusMode === 'all';
      return String(e.approver_id || '') === String(session.id);
    });

    if (statusMode === 'pending') {
      entries = _approvalFilterSecondApproverPending(entries, session);
    } else if (statusMode === 'submitted' || statusMode === 'pre_approved') {
      entries = _approvalFilterSecondApproverPending(entries, session).filter((e) => String(e.status || '') === statusMode);
      batchEntries = batchEntries.filter((e) => String(e.status || '') === statusMode);
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
      batchEntries = batchEntries.filter((e) => {
        const blob = [e.user_name, e.team_name, e.work_description, e.doc_no]
          .map((v) => String(v || '').toLowerCase()).join(' ');
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

    let combined = entries.concat(batchEntries).concat(projectEntries);
    if (kindMode === 'timesheet') combined = entries;
    else if (kindMode === 'batch') combined = batchEntries;
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
    } else if (_mobileApprovalIsBatchEntry(entry)) {
      // 배치: 1차 승인으로 종결 (pre_approved 없음)
      const session = getSession();
      const isApprove = decision === 'approved';
      const comment = commentEl ? commentEl.value.trim() : '';
      if (!isApprove && !comment) throw new Error('반려 사유를 입력해주세요.');
      const nextStatus = isApprove ? 'approved' : 'rejected';
      await API.patch('time_entries', entry.id, {
        status: nextStatus,
        reviewer_comment: comment,
        reviewed_at: Date.now(),
        reviewer_id: session.id,
        reviewer_name: session.name || '',
      });
      if (typeof createNotification === 'function') {
        createNotification({
          toUserId: entry.user_id, toUserName: entry.user_name,
          fromUserId: session.id, fromUserName: session.name,
          type: nextStatus, entryId: entry.id, message: comment,
        }).catch(() => {});
      }
      Toast.success(isApprove ? '일괄기록이 승인되었습니다.' : '반려 처리되었습니다.');
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
