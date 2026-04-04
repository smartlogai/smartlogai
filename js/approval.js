/* ============================================================
   approval.js  –  결재 관리 (1차/2차 승인, 반려, 이력)
   ============================================================ */
'use strict';

/* ── 상태 ── */
let _apSession = null;
let _apMasters = {};
let _apList = [];
let _apPage = 1;
let _apTotal = 0;
let _apFilter = { status: 'pending', user_id: '', client_id: '', date_from: '', date_to: '' };
const AP_PAGE_SIZE = 20;

/* ══════════════════════════════════════════════
   진입점
══════════════════════════════════════════════ */
async function init_approval() {
  _apSession = Session.require();
  if (!_apSession) return;

  /* 권한 체크 */
  if (!Auth.hasApprover(_apSession)) {
    document.getElementById('approval-no-permission')?.style && (
      document.getElementById('approval-no-permission').style.display = ''
    );
    document.getElementById('approval-main')?.style && (
      document.getElementById('approval-main').style.display = 'none'
    );
    return;
  }

  _apMasters = await Master.load();
  _setupApFilterUI();
  _bindApEvents();
  await _loadApList();
}

/* ══════════════════════════════════════════════
   필터 UI
══════════════════════════════════════════════ */
function _setupApFilterUI() {
  /* 상태 탭 기본값 */
  const role = _apSession.role;
  if (role === 'manager') {
    _apFilter.status = 'pending';
  } else if (role === 'director' || role === 'admin') {
    _apFilter.status = 'pending2';
  }

  /* 직원 셀렉트 (관리자/임원용) */
  const userSel = document.getElementById('ap-filter-user');
  if (userSel && (Auth.isAdmin(_apSession) || Auth.isDirector(_apSession))) {
    userSel.innerHTML = '<option value="">전체 직원</option>';
    (_apMasters.users || [])
      .filter(u => u.role === 'staff' || u.role === 'manager')
      .forEach(u => {
        userSel.innerHTML += `<option value="${u.id}">${Utils.escHtml(u.name)}</option>`;
      });
    userSel.closest('.ap-filter-item')?.style && (userSel.closest('.ap-filter-item').style.display = '');
  }

  /* 고객사 셀렉트 */
  const cliSel = document.getElementById('ap-filter-client');
  if (cliSel) {
    cliSel.innerHTML = '<option value="">전체 고객사</option>';
    (_apMasters.clients || []).forEach(c => {
      cliSel.innerHTML += `<option value="${c.id}">${Utils.escHtml(c.name)}</option>`;
    });
  }

  /* 탭 활성화 */
  _updateApTabs();
}

function _updateApTabs() {
  document.querySelectorAll('[data-ap-status]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.apStatus === _apFilter.status);
  });
}

/* ══════════════════════════════════════════════
   이벤트 바인딩
══════════════════════════════════════════════ */
function _bindApEvents() {
  /* 상태 탭 */
  document.querySelectorAll('[data-ap-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      _apFilter.status = btn.dataset.apStatus;
      _apPage = 1;
      _updateApTabs();
      _loadApList();
    });
  });

  /* 필터 */
  const bindF = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      _apFilter[key] = el.value;
      _apPage = 1;
      _loadApList();
    });
  };
  bindF('ap-filter-user',    'user_id');
  bindF('ap-filter-client',  'client_id');
  bindF('ap-filter-date-from','date_from');
  bindF('ap-filter-date-to',  'date_to');

  /* 검색 */
  const searchEl = document.getElementById('ap-filter-search');
  if (searchEl) {
    searchEl.addEventListener('input', Utils.debounce(() => {
      _apFilter.search = searchEl.value;
      _apPage = 1;
      _loadApList();
    }, 400));
  }
}

/* ══════════════════════════════════════════════
   목록 로드
══════════════════════════════════════════════ */
async function _loadApList() {
  const wrap = document.getElementById('approval-list-wrap');
  if (wrap) wrap.innerHTML = _apSkeleton(5);

  try {
    const params = {
      page: _apPage,
      limit: AP_PAGE_SIZE,
      sort: '-work_date',
    };

    /* 역할별 필터 */
    const role = _apSession.role;
    if (role === 'manager') {
      params['filter[approver_id]'] = _apSession.userId;
    }

    if (_apFilter.status) params['filter[status]'] = _apFilter.status;
    if (_apFilter.user_id) params['filter[user_id]'] = _apFilter.user_id;
    if (_apFilter.client_id) params['filter[client_id]'] = _apFilter.client_id;
    if (_apFilter.date_from) params['filter[work_date][gte]'] = _apFilter.date_from;
    if (_apFilter.date_to)   params['filter[work_date][lte]'] = _apFilter.date_to;
    if (_apFilter.search)    params.search = _apFilter.search;

    const r = await API.list('time_entries', params);
    _apList  = r?.data ?? [];
    _apTotal = r?.total ?? 0;

    _renderApList();
    _renderApPagination();
    _updateApSummary();
  } catch (err) {
    console.error('[approval] 로드 오류:', err);
    if (wrap) wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#dc2626;">데이터 로드 실패</div>';
  }
}

/* ══════════════════════════════════════════════
   목록 렌더
══════════════════════════════════════════════ */
function _renderApList() {
  const wrap = document.getElementById('approval-list-wrap');
  if (!wrap) return;

  if (!_apList.length) {
    wrap.innerHTML = `
      <div style="padding:48px;text-align:center;color:#94a3b8;">
        <i class="fa-solid fa-inbox" style="font-size:32px;display:block;margin-bottom:12px;opacity:0.4;"></i>
        결재 대기 항목이 없습니다.
      </div>`;
    return;
  }

  const cliMap  = Object.fromEntries((_apMasters.clients || []).map(c => [c.id, c.name]));
  const catMap  = Object.fromEntries((_apMasters.categories || []).map(c => [c.id, c.name]));
  const userMap = Object.fromEntries((_apMasters.users || []).map(u => [u.id, u.name]));

  wrap.innerHTML = _apList.map(e => {
    const cliName  = e.client_id === 'internal' ? '내부' : (cliMap[e.client_id] || '-');
    const catName  = catMap[e.category_id] || '-';
    const userName = userMap[e.user_id] || '-';
    const canAp1   = Auth.canApprove1st(_apSession) && e.status === 'pending'  && e.approver_id === _apSession.userId;
    const canAp2   = Auth.canApprove2nd(_apSession) && e.status === 'pending2';
    const canReject = canAp1 || canAp2;

    return `
      <tr class="ap-row" data-id="${e.id}">
        <td>
          <input type="checkbox" class="ap-check" value="${e.id}">
        </td>
        <td>${e.work_date || '-'}</td>
        <td>
          <div style="font-weight:600;font-size:13px;color:#1e293b;margin-bottom:2px;">
            ${Utils.escHtml((e.title || '-').slice(0, 35))}${(e.title||'').length > 35 ? '…' : ''}
          </div>
          <div style="font-size:11px;color:#94a3b8;">${Utils.escHtml(catName)}</div>
        </td>
        <td>${Utils.escHtml(userName)}</td>
        <td>${Utils.escHtml(cliName)}</td>
        <td style="text-align:center;font-weight:600;">${Utils.minToHM(e.duration_min || 0)}</td>
        <td style="text-align:center;">${Utils.statusBadge(e.status || 'draft')}</td>
        <td style="text-align:center;white-space:nowrap;">
          <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;" onclick="openApDetail('${e.id}')">
            <i class="fa-solid fa-eye"></i> 보기
          </button>
          ${canAp1 ? `
            <button class="btn btn-success" style="font-size:11px;padding:3px 10px;" onclick="approveEntry('${e.id}', 1)">
              <i class="fa-solid fa-check"></i> 승인
            </button>
            <button class="btn btn-danger" style="font-size:11px;padding:3px 10px;" onclick="rejectEntry('${e.id}', 1)">
              <i class="fa-solid fa-xmark"></i> 반려
            </button>` : ''}
          ${canAp2 ? `
            <button class="btn btn-success" style="font-size:11px;padding:3px 10px;" onclick="approveEntry('${e.id}', 2)">
              <i class="fa-solid fa-check-double"></i> 최종승인
            </button>
            <button class="btn btn-danger" style="font-size:11px;padding:3px 10px;" onclick="rejectEntry('${e.id}', 2)">
              <i class="fa-solid fa-xmark"></i> 반려
            </button>` : ''}
        </td>
      </tr>`;
  }).join('');
}

/* ── 페이지네이션 ── */
function _renderApPagination() {
  const wrap = document.getElementById('ap-pagination');
  if (!wrap) return;
  wrap.innerHTML = Utils.paginationHTML(_apPage, Math.ceil(_apTotal / AP_PAGE_SIZE), 'apGoPage');
  const info = document.getElementById('ap-count-info');
  if (info) info.textContent = `총 ${_apTotal}건`;
}
window.apGoPage = (p) => { _apPage = p; _loadApList(); };

/* ── 요약 ── */
function _updateApSummary() {
  const el = document.getElementById('ap-summary');
  if (!el) return;
  const totalMins = _apList.reduce((s, e) => s + (e.duration_min || 0), 0);
  el.textContent = `${_apList.length}건 / ${Utils.minToHM(totalMins)}`;
}

/* ── 스켈레톤 ── */
function _apSkeleton(n) {
  return `<div style="display:flex;flex-direction:column;gap:0;">${
    Array(n).fill(0).map(() => `
      <div style="padding:14px 16px;border-bottom:1px solid #f1f5f9;display:flex;flex-direction:column;gap:8px;">
        <div style="height:14px;width:55%;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:arch-shimmer 1.4s infinite;border-radius:4px;"></div>
        <div style="height:11px;width:80%;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:arch-shimmer 1.4s infinite;border-radius:4px;"></div>
      </div>`).join('')
  }</div>`;
}
/* ══════════════════════════════════════════════
   승인 처리
══════════════════════════════════════════════ */
async function approveEntry(id, step) {
  const entry = _apList.find(e => e.id === id);
  if (!entry) return;

  const stepLabel = step === 1 ? '1차 승인' : '최종 승인';
  const ok = await Confirm.show({
    title: stepLabel,
    message: `"${entry.title}" 항목을 ${stepLabel}하시겠습니까?`,
    confirmText: '승인',
    confirmClass: 'btn-success'
  });
  if (!ok) return;

  try {
    const now = new Date().toISOString();
    let patch = {};

    if (step === 1) {
      /* 1차 승인 → 2차 결재 필요 여부 확인 */
      const needsSecond = Auth.isManager(_apSession);
      patch = {
        status: needsSecond ? 'pending2' : 'approved',
        approved1_at: now,
        approved1_by: _apSession.userId,
      };
      if (!needsSecond) {
        patch.approved2_at = now;
        patch.approved2_by = _apSession.userId;
        patch.approved_at  = now;
      }
    } else {
      patch = {
        status: 'approved',
        approved2_at: now,
        approved2_by: _apSession.userId,
        approved_at:  now,
      };
    }

    await API.patch('time_entries', id, patch);
    Toast.success(`${stepLabel} 완료`);
    sessionStorage.setItem('dash_invalidate', '1');

    /* 배지 즉시 갱신 */
    await updateApprovalBadge(_apSession, true);
    await _loadApList();
  } catch (err) {
    console.error('[approval] 승인 오류:', err);
    Toast.error('승인 처리 중 오류가 발생했습니다.');
  }
}
window.approveEntry = approveEntry;

/* ══════════════════════════════════════════════
   반려 처리
══════════════════════════════════════════════ */
async function rejectEntry(id, step) {
  const entry = _apList.find(e => e.id === id);
  if (!entry) return;

  /* 반려 사유 입력 모달 */
  const reason = await _showRejectModal(entry.title, step);
  if (reason === null) return; /* 취소 */

  try {
    const now = new Date().toISOString();
    let patch = {};

    if (step === 1) {
      patch = {
        status: 'rejected',
        rejected1_at: now,
        rejected1_by: _apSession.userId,
        reject_reason: reason,
      };
    } else {
      patch = {
        status: 'rejected',
        rejected2_at: now,
        rejected2_by: _apSession.userId,
        reject_reason2: reason,
      };
    }

    await API.patch('time_entries', id, patch);
    Toast.success('반려 처리 완료');
    sessionStorage.setItem('dash_invalidate', '1');
    await updateApprovalBadge(_apSession, true);
    await _loadApList();
  } catch (err) {
    console.error('[approval] 반려 오류:', err);
    Toast.error('반려 처리 중 오류가 발생했습니다.');
  }
}
window.rejectEntry = rejectEntry;

/* ── 반려 사유 입력 모달 ── */
function _showRejectModal(title, step) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:24px;width:440px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:6px;">
          <i class="fa-solid fa-circle-xmark" style="color:#dc2626;"></i>
          반려 — ${step === 1 ? '1차' : '2차'}
        </h3>
        <p style="font-size:13px;color:#64748b;margin-bottom:14px;">
          "${Utils.escHtml((title||'').slice(0,40))}" 항목을 반려합니다.
        </p>
        <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">
          반려 사유 <span style="color:#dc2626;">*</span>
        </label>
        <textarea id="_reject-reason-input" rows="3"
          style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:13px;resize:vertical;box-sizing:border-box;outline:none;"
          placeholder="반려 사유를 입력하세요…"></textarea>
        <div id="_reject-reason-err" style="color:#dc2626;font-size:12px;margin-top:4px;display:none;">사유를 입력하세요.</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
          <button id="_reject-cancel" class="btn btn-outline">취소</button>
          <button id="_reject-confirm" class="btn btn-danger">
            <i class="fa-solid fa-xmark"></i> 반려 확정
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    const ta  = overlay.querySelector('#_reject-reason-input');
    const err = overlay.querySelector('#_reject-reason-err');
    ta.focus();

    overlay.querySelector('#_reject-cancel').onclick = () => {
      document.body.removeChild(overlay);
      resolve(null);
    };
    overlay.querySelector('#_reject-confirm').onclick = () => {
      const val = ta.value.trim();
      if (!val) { err.style.display = ''; return; }
      document.body.removeChild(overlay);
      resolve(val);
    };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) { document.body.removeChild(overlay); resolve(null); }
    });
  });
}

/* ══════════════════════════════════════════════
   일괄 승인
══════════════════════════════════════════════ */
async function bulkApprove(step) {
  const checked = Array.from(document.querySelectorAll('.ap-check:checked')).map(el => el.value);
  if (!checked.length) { Toast.warning('항목을 선택하세요.'); return; }

  const stepLabel = step === 1 ? '1차 승인' : '최종 승인';
  const ok = await Confirm.show({
    title: `일괄 ${stepLabel}`,
    message: `선택한 ${checked.length}건을 일괄 ${stepLabel}하시겠습니까?`,
    confirmText: '일괄 승인',
    confirmClass: 'btn-success'
  });
  if (!ok) return;

  const btn = document.getElementById(`ap-bulk-approve-${step}`);
  const restore = BtnLoading.start(btn, '처리 중…');

  try {
    const now = new Date().toISOString();
    let success = 0;

    for (const id of checked) {
      let patch = {};
      if (step === 1) {
        const needsSecond = Auth.isManager(_apSession);
        patch = {
          status: needsSecond ? 'pending2' : 'approved',
          approved1_at: now,
          approved1_by: _apSession.userId,
        };
        if (!needsSecond) {
          patch.approved2_at = now;
          patch.approved2_by = _apSession.userId;
          patch.approved_at  = now;
        }
      } else {
        patch = {
          status: 'approved',
          approved2_at: now,
          approved2_by: _apSession.userId,
          approved_at:  now,
        };
      }
      await API.patch('time_entries', id, patch);
      success++;
    }

    Toast.success(`${success}건 ${stepLabel} 완료`);
    sessionStorage.setItem('dash_invalidate', '1');
    await updateApprovalBadge(_apSession, true);
    await _loadApList();
  } catch (err) {
    Toast.error('일괄 승인 중 오류 발생');
  } finally {
    restore();
  }
}
window.bulkApprove = bulkApprove;

/* ══════════════════════════════════════════════
   전체 선택
══════════════════════════════════════════════ */
function toggleAllApCheck(masterCb) {
  document.querySelectorAll('.ap-check').forEach(cb => { cb.checked = masterCb.checked; });
}
window.toggleAllApCheck = toggleAllApCheck;
/* ══════════════════════════════════════════════
   상세보기 모달
══════════════════════════════════════════════ */
async function openApDetail(id) {
  const modal = document.getElementById('ap-detail-modal');
  if (!modal) return;
  modal.style.display = 'flex';

  const body = document.getElementById('ap-detail-body');
  if (body) body.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> 로딩 중…</div>';

  try {
    const r = await API.get('time_entries', id);
    const e = r?.data ?? r;
    if (!e) throw new Error('데이터 없음');

    const cliMap  = Object.fromEntries((_apMasters.clients   || []).map(c => [c.id, c.name]));
    const catMap  = Object.fromEntries((_apMasters.categories|| []).map(c => [c.id, c.name]));
    const caseMap = Object.fromEntries((_apMasters.cases     || []).map(c => [c.id, c.name]));
    const userMap = Object.fromEntries((_apMasters.users     || []).map(u => [u.id, u.name]));

    const cliName  = e.client_id === 'internal' ? '내부 업무' : (cliMap[e.client_id] || '-');
    const catName  = catMap[e.category_id] || '-';
    const caseName = e.case_id ? (caseMap[e.case_id] || '-') : '-';
    const userName = userMap[e.user_id] || '-';
    const timeStr  = (e.start_time && e.end_time)
      ? `${e.start_time} ~ ${e.end_time} (${Utils.minToHM(e.duration_min || 0)})`
      : Utils.minToHM(e.duration_min || 0);

    const contentHtml = e.content
      ? `<div class="arch-desc-view">${e.content}</div>`
      : '<span style="color:#94a3b8;font-size:13px;">내용 없음</span>';

    /* 결재 이력 */
    const historyItems = [];
    if (e.submitted_at)  historyItems.push({ label: '결재 요청',  date: e.submitted_at,  color: '#d97706', icon: 'fa-paper-plane',   by: userMap[e.user_id] });
    if (e.approved1_at)  historyItems.push({ label: '1차 승인',   date: e.approved1_at,  color: '#16a34a', icon: 'fa-circle-check',  by: userMap[e.approved1_by] });
    if (e.rejected1_at)  historyItems.push({ label: '1차 반려',   date: e.rejected1_at,  color: '#dc2626', icon: 'fa-circle-xmark',  by: userMap[e.rejected1_by], note: e.reject_reason });
    if (e.approved2_at)  historyItems.push({ label: '최종 승인',  date: e.approved2_at,  color: '#16a34a', icon: 'fa-check-double',  by: userMap[e.approved2_by] });
    if (e.rejected2_at)  historyItems.push({ label: '2차 반려',   date: e.rejected2_at,  color: '#dc2626', icon: 'fa-circle-xmark',  by: userMap[e.rejected2_by], note: e.reject_reason2 });

    const historyHtml = historyItems.length
      ? historyItems.map(h => `
          <div style="display:flex;align-items:flex-start;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9;">
            <div style="width:28px;height:28px;border-radius:50%;background:${h.color}20;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i class="fa-solid ${h.icon}" style="color:${h.color};font-size:12px;"></i>
            </div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:${h.color};">${h.label}</div>
              <div style="font-size:11.5px;color:#64748b;margin-top:2px;">
                ${h.by ? Utils.escHtml(h.by) + ' · ' : ''}${Utils.formatDatetime(h.date)}
              </div>
              ${h.note ? `<div style="margin-top:4px;padding:6px 10px;background:#fef2f2;border-radius:6px;font-size:12px;color:#dc2626;">${Utils.escHtml(h.note)}</div>` : ''}
            </div>
          </div>`).join('')
      : '<div style="color:#94a3b8;font-size:13px;padding:8px 0;">이력 없음</div>';

    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <!-- 기본 정보 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="ep-panel" style="border-top:3px solid #2d6bb5;">
            <div class="ep-panel-header" style="background:#eff6ff;color:#2d6bb5;">기본 정보</div>
            <div class="ep-panel-body">
              <div class="ep-label">날짜</div><div class="ep-ctrl">${e.work_date || '-'}</div>
              <div class="ep-label">작성자</div><div class="ep-ctrl">${Utils.escHtml(userName)}</div>
              <div class="ep-label">상태</div><div class="ep-ctrl">${Utils.statusBadge(e.status || 'draft')}</div>
              <div class="ep-label">청구 여부</div>
              <div class="ep-ctrl">${e.is_billable !== false
                ? '<span style="color:#16a34a;font-weight:600;">청구</span>'
                : '<span style="color:#94a3b8;">비청구</span>'}</div>
            </div>
          </div>
          <div class="ep-panel" style="border-top:3px solid #7c3aed;">
            <div class="ep-panel-header" style="background:#f5f3ff;color:#7c3aed;">업무 분류</div>
            <div class="ep-panel-body">
              <div class="ep-label">고객사</div><div class="ep-ctrl">${Utils.escHtml(cliName)}</div>
              <div class="ep-label">카테고리</div><div class="ep-ctrl">${Utils.escHtml(catName)}</div>
              <div class="ep-label">사건/사업</div><div class="ep-ctrl">${Utils.escHtml(caseName)}</div>
              <div class="ep-label">소요 시간</div><div class="ep-ctrl"><strong>${timeStr}</strong></div>
            </div>
          </div>
        </div>

        <!-- 제목 -->
        <div class="ep-panel" style="border-top:3px solid #0891b2;">
          <div class="ep-panel-header" style="background:#f0f9ff;color:#0891b2;">업무 제목</div>
          <div class="ep-panel-body">
            <div style="font-size:14px;font-weight:600;color:#1e293b;padding:4px 0;">${Utils.escHtml(e.title || '-')}</div>
          </div>
        </div>

        <!-- 내용 -->
        <div class="ep-panel" style="border-top:3px solid #16a34a;">
          <div class="ep-panel-header" style="background:#f0fdf4;color:#16a34a;">업무 내용</div>
          <div class="ep-panel-body">${contentHtml}</div>
        </div>

        <!-- 결재 이력 -->
        <div class="ep-panel" style="border-top:3px solid #94a3b8;">
          <div class="ep-panel-header" style="background:#f8fafc;color:#64748b;">결재 이력</div>
          <div class="ep-panel-body">${historyHtml}</div>
        </div>
      </div>`;

    /* 액션 버튼 */
    const actWrap = document.getElementById('ap-detail-actions');
    if (actWrap) {
      const canAp1 = Auth.canApprove1st(_apSession) && e.status === 'pending'  && e.approver_id === _apSession.userId;
      const canAp2 = Auth.canApprove2nd(_apSession) && e.status === 'pending2';
      actWrap.innerHTML = `
        ${canAp1 ? `
          <button class="btn btn-success" onclick="closeApDetail();approveEntry('${e.id}',1)">
            <i class="fa-solid fa-check"></i> 승인
          </button>
          <button class="btn btn-danger" onclick="closeApDetail();rejectEntry('${e.id}',1)">
            <i class="fa-solid fa-xmark"></i> 반려
          </button>` : ''}
        ${canAp2 ? `
          <button class="btn btn-success" onclick="closeApDetail();approveEntry('${e.id}',2)">
            <i class="fa-solid fa-check-double"></i> 최종승인
          </button>
          <button class="btn btn-danger" onclick="closeApDetail();rejectEntry('${e.id}',2)">
            <i class="fa-solid fa-xmark"></i> 반려
          </button>` : ''}
        <button class="btn btn-outline" onclick="closeApDetail()">닫기</button>`;
    }
  } catch (err) {
    console.error('[approval] 상세 오류:', err);
    if (body) body.innerHTML = '<div style="padding:40px;text-align:center;color:#dc2626;">데이터를 불러올 수 없습니다.</div>';
  }
}
window.openApDetail = openApDetail;

function closeApDetail() {
  const modal = document.getElementById('ap-detail-modal');
  if (modal) modal.style.display = 'none';
}
window.closeApDetail = closeApDetail;
/* ══════════════════════════════════════════════
   결재 통계 (임원/관리자용)
══════════════════════════════════════════════ */
async function renderApStats() {
  const wrap = document.getElementById('ap-stats-wrap');
  if (!wrap) return;

  wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i></div>';

  try {
    const r = await API.list('time_entries', { limit: 2000, sort: '-work_date' });
    const all = r?.data ?? [];

    const userMap = Object.fromEntries((_apMasters.users || []).map(u => [u.id, u.name]));
    const cliMap  = Object.fromEntries((_apMasters.clients || []).map(c => [c.id, c.name]));

    const statusCount = { draft: 0, pending: 0, pending2: 0, approved: 0, rejected: 0 };
    all.forEach(e => { if (statusCount[e.status] !== undefined) statusCount[e.status]++; });

    /* 직원별 제출 현황 */
    const byUser = {};
    all.forEach(e => {
      if (!byUser[e.user_id]) byUser[e.user_id] = { total: 0, approved: 0, pending: 0, rejected: 0 };
      byUser[e.user_id].total++;
      if (e.status === 'approved') byUser[e.user_id].approved++;
      else if (e.status === 'pending' || e.status === 'pending2') byUser[e.user_id].pending++;
      else if (e.status === 'rejected') byUser[e.user_id].rejected++;
    });

    /* 월별 승인 추이 */
    const byMonth = {};
    all.filter(e => e.status === 'approved').forEach(e => {
      const m = (e.work_date || '').slice(0, 7);
      if (!m) return;
      byMonth[m] = (byMonth[m] || 0) + 1;
    });
    const months = Object.keys(byMonth).sort().slice(-6);

    const STATUS_LABEL = {
      draft: '임시저장', pending: '1차 대기', pending2: '2차 대기',
      approved: '승인완료', rejected: '반려'
    };
    const STATUS_COLOR = {
      draft: '#94a3b8', pending: '#d97706', pending2: '#f59e0b',
      approved: '#16a34a', rejected: '#dc2626'
    };

    const statusCards = Object.entries(statusCount).map(([s, cnt]) => `
      <div class="kpi-card" style="border-top:3px solid ${STATUS_COLOR[s]};">
        <div class="kpi-body">
          <div class="kpi-label">${STATUS_LABEL[s]}</div>
          <div class="kpi-value" style="color:${STATUS_COLOR[s]};">${cnt}건</div>
        </div>
      </div>`).join('');

    const userRows = Object.entries(byUser)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 15)
      .map(([uid, d]) => `
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:7px 8px;font-size:12px;color:#334155;">${Utils.escHtml(userMap[uid] || uid)}</td>
          <td style="padding:7px 8px;font-size:12px;text-align:center;">${d.total}</td>
          <td style="padding:7px 8px;font-size:12px;text-align:center;color:#16a34a;font-weight:600;">${d.approved}</td>
          <td style="padding:7px 8px;font-size:12px;text-align:center;color:#d97706;">${d.pending}</td>
          <td style="padding:7px 8px;font-size:12px;text-align:center;color:#dc2626;">${d.rejected}</td>
          <td style="padding:7px 8px;">
            <div style="background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden;">
              <div style="width:${d.total ? Math.round((d.approved/d.total)*100) : 0}%;height:100%;background:#16a34a;"></div>
            </div>
          </td>
        </tr>`).join('');

    const monthRows = months.map(m => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
        <span style="font-size:12px;color:#64748b;width:50px;">${m.slice(5)}월</span>
        <div style="flex:1;background:#e2e8f0;border-radius:4px;height:10px;overflow:hidden;">
          <div style="width:${Math.round((byMonth[m]/(Math.max(...months.map(mm=>byMonth[mm]),1)))*100)}%;height:100%;background:#2d6bb5;border-radius:4px;"></div>
        </div>
        <span style="font-size:12px;font-weight:600;color:#1e293b;width:30px;text-align:right;">${byMonth[m]}</span>
      </div>`).join('');

    wrap.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:12px;color:#64748b;font-weight:600;margin-bottom:8px;">전체 상태 현황</div>
        <div class="kpi-grid">${statusCards}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="card">
          <div class="card-header"><span class="card-title">직원별 결재 현황</span></div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">직원</th>
                  <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">전체</th>
                  <th style="padding:7px 8px;font-size:11px;color:#16a34a;text-align:center;font-weight:600;">승인</th>
                  <th style="padding:7px 8px;font-size:11px;color:#d97706;text-align:center;font-weight:600;">대기</th>
                  <th style="padding:7px 8px;font-size:11px;color:#dc2626;text-align:center;font-weight:600;">반려</th>
                  <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">승인률</th>
                </tr>
              </thead>
              <tbody>${userRows}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">월별 승인 추이 (최근 6개월)</span></div>
          <div style="padding:12px 16px;">${monthRows || '<div style="color:#94a3b8;font-size:13px;">데이터 없음</div>'}</div>
        </div>
      </div>`;
  } catch (err) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#dc2626;">통계 로드 실패</div>';
  }
}
window.renderApStats = renderApStats;

/* ══════════════════════════════════════════════
   Excel 내보내기
══════════════════════════════════════════════ */
async function exportApprovalExcel() {
  const btn = document.getElementById('ap-export-btn');
  const restore = BtnLoading.start(btn, '내보내는 중…');

  try {
    const params = { limit: 2000, sort: '-work_date' };
    if (_apFilter.status)    params['filter[status]'] = _apFilter.status;
    if (_apFilter.user_id)   params['filter[user_id]'] = _apFilter.user_id;
    if (_apFilter.client_id) params['filter[client_id]'] = _apFilter.client_id;
    if (_apFilter.date_from) params['filter[work_date][gte]'] = _apFilter.date_from;
    if (_apFilter.date_to)   params['filter[work_date][lte]'] = _apFilter.date_to;

    const r = await API.list('time_entries', params);
    const entries = r?.data ?? [];

    const cliMap  = Object.fromEntries((_apMasters.clients   || []).map(c => [c.id, c.name]));
    const catMap  = Object.fromEntries((_apMasters.categories|| []).map(c => [c.id, c.name]));
    const userMap = Object.fromEntries((_apMasters.users     || []).map(u => [u.id, u.name]));

    const STATUS_LABEL = {
      draft: '임시저장', pending: '1차 대기', pending2: '2차 대기',
      approved: '승인완료', rejected: '반려'
    };

    const data = [
      ['날짜','작성자','제목','고객사','카테고리','소요(분)','소요(H:MM)','상태','결재요청일','1차승인일','최종승인일','반려사유']
    ];
    entries.forEach(e => {
      data.push([
        e.work_date || '',
        userMap[e.user_id] || '',
        e.title || '',
        e.client_id === 'internal' ? '내부 업무' : (cliMap[e.client_id] || ''),
        catMap[e.category_id] || '',
        e.duration_min || 0,
        Utils.minToHM(e.duration_min || 0),
        STATUS_LABEL[e.status] || e.status || '',
        e.submitted_at  ? Utils.formatDatetime(e.submitted_at)  : '',
        e.approved1_at  ? Utils.formatDatetime(e.approved1_at)  : '',
        e.approved2_at  ? Utils.formatDatetime(e.approved2_at)  : '',
        e.reject_reason || e.reject_reason2 || '',
      ]);
    });

    await Utils.xlsxDownload(data, `결재현황_${Utils.todayStr()}.xlsx`, '결재현황');
    Toast.success(`${entries.length}건 내보내기 완료`);
  } catch (err) {
    Toast.error('내보내기 중 오류가 발생했습니다.');
  } finally {
    restore();
  }
}
window.exportApprovalExcel = exportApprovalExcel;

/* ══════════════════════════════════════════════
   모달 닫기 (오버레이 클릭)
══════════════════════════════════════════════ */
(function _initApModalClose() {
  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('ap-detail-modal');
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) closeApDetail();
      });
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeApDetail();
  });
})();

/* ══════════════════════════════════════════════
   외부 노출
══════════════════════════════════════════════ */
window.init_approval       = init_approval;
window.approveEntry        = approveEntry;
window.rejectEntry         = rejectEntry;
window.bulkApprove         = bulkApprove;
window.toggleAllApCheck    = toggleAllApCheck;
window.openApDetail        = openApDetail;
window.closeApDetail       = closeApDetail;
window.renderApStats       = renderApStats;
window.exportApprovalExcel = exportApprovalExcel;
window.apGoPage            = apGoPage;
