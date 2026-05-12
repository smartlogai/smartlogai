/* helpdesk.js — Help Desk v1 (internal-first, vendor-ready) */
'use strict';

const HD_STATE = {
  initialized: false,
  rows: [],
  selectedId: '',
  comments: [],
  session: null,
  canManage: false,
  phase: 'internal',
  notifyTarget: null,
  refreshTimer: null,
};

const HD_NOTIFY_TARGET_EMAIL = 'hshan@hjcustoms.co.kr';

const HD_LABEL = {
  category: {
    bug: '오류',
    improvement: '개선',
    question: '문의',
  },
  severity: {
    low: '낮음',
    medium: '보통',
    high: '높음',
    critical: '긴급',
  },
  status: {
    open: '접수',
    triaged: '분석중',
    in_progress: '처리중',
    waiting_user: '사용자확인대기',
    resolved: '해결',
    closed: '종결',
    rejected: '반려',
  },
};

function _hdEsc(v) {
  return (typeof Utils !== 'undefined' && Utils.escHtml) ? Utils.escHtml(String(v == null ? '' : v)) : String(v == null ? '' : v);
}

function _hdTsText(ts) {
  const n = Number(ts || 0);
  if (!n) return '-';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _hdFullTsText(ts) {
  const n = Number(ts || 0);
  if (!n) return '-';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function _hdStatusBadge(status) {
  const s = String(status || 'open').trim();
  const map = {
    open: ['접수', '#92400e', '#fef3c7'],
    triaged: ['분석중', '#1e3a8a', '#dbeafe'],
    in_progress: ['처리중', '#075985', '#cffafe'],
    waiting_user: ['사용자확인대기', '#78350f', '#fef9c3'],
    resolved: ['해결', '#166534', '#dcfce7'],
    closed: ['종결', '#0f766e', '#ccfbf1'],
    rejected: ['반려', '#991b1b', '#fee2e2'],
  };
  const hit = map[s] || [s || '-', '#475569', '#e2e8f0'];
  return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:66px;padding:2px 8px;border-radius:999px;background:${hit[2]};color:${hit[1]};font-size:11px;font-weight:700">${hit[0]}</span>`;
}

function _hdCanManage(session) {
  const isMaintainer = _hdIsDesignatedMaintainer(session);
  return !!(session && (
    isMaintainer
    || 
    (Auth && Auth.canApprove1st && Auth.canApprove1st(session))
    || (Auth && Auth.isDirector && Auth.isDirector(session))
    || (Auth && Auth.isTopMgr && Auth.isTopMgr(session))
    || (Auth && Auth.isAdmin && Auth.isAdmin(session))
  ));
}

function _hdSessionEmail(session) {
  return String(session && session.email || '').trim().toLowerCase();
}

function _hdIsDesignatedMaintainer(session) {
  return _hdSessionEmail(session) === String(HD_NOTIFY_TARGET_EMAIL || '').trim().toLowerCase();
}

function _hdSessionIdCandidates(session) {
  const ids = [
    String(session && session.id || '').trim(),
    String(session && session.user_id || '').trim(),
  ].filter(Boolean);
  return Array.from(new Set(ids));
}

function _hdPrimarySessionId(session) {
  const ids = _hdSessionIdCandidates(session || {});
  return ids[0] || '';
}

function _hdIncludesSessionId(targetId, session) {
  const t = String(targetId || '').trim();
  if (!t) return false;
  return _hdSessionIdCandidates(session || {}).includes(t);
}

async function _hdResolveUserByAnyId(rawId) {
  const key = String(rawId || '').trim();
  if (!key) return null;
  try {
    const byId = await API.listAllPages('users', {
      filter: `id=eq.${encodeURIComponent(key)}`,
      limit: 1,
      maxPages: 1,
      sort: 'updated_at',
    });
    if (Array.isArray(byId) && byId.length) return byId[0];
  } catch (_) { /* noop */ }
  try {
    const byUserId = await API.listAllPages('users', {
      filter: `user_id=eq.${encodeURIComponent(key)}`,
      limit: 1,
      maxPages: 1,
      sort: 'updated_at',
    });
    if (Array.isArray(byUserId) && byUserId.length) return byUserId[0];
  } catch (_) { /* noop */ }
  return null;
}

async function _hdResolveNotifyTarget() {
  if (HD_STATE.notifyTarget && HD_STATE.notifyTarget.id) return HD_STATE.notifyTarget;
  const email = String(HD_NOTIFY_TARGET_EMAIL || '').trim().toLowerCase();
  if (!email) return null;
  let user = null;
  try {
    const rows = await API.listAllPages('users', {
      filter: `email=eq.${encodeURIComponent(email)}`,
      limit: 1,
      maxPages: 1,
      sort: 'updated_at',
    });
    user = Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch (_) {
    user = null;
  }
  if (!user) return null;
  HD_STATE.notifyTarget = {
    id: String(user.id || '').trim(),
    name: String(user.name || '').trim(),
    email,
  };
  return HD_STATE.notifyTarget;
}

async function _hdNotifyOnCreate(ticket, payload) {
  if (typeof createNotification !== 'function') return;
  const target = await _hdResolveNotifyTarget();
  if (!target || !target.id) return;
  const s = HD_STATE.session || {};
  const no = String((ticket && ticket.ticket_no) || '').trim() || String((ticket && ticket.id) || '').slice(0, 8);
  const title = String((payload && payload.title) || '').trim();
  const category = HD_LABEL.category[String((payload && payload.category) || '').trim()] || '이슈';
  await createNotification({
    toUserId: target.id,
    toUserName: target.name || '',
    fromUserId: _hdPrimarySessionId(s),
    fromUserName: String(s.name || ''),
    type: 'helpdesk_new_ticket',
    entryId: String((ticket && ticket.id) || ''),
    entrySummary: `${no} · ${title}`,
    message: `[Help Desk] ${category} 접수: ${title || no}`,
    targetMenu: 'helpdesk',
  });
}

async function _hdNotifyReporter(row, type, message) {
  if (typeof createNotification !== 'function') return;
  const s = HD_STATE.session || {};
  const rawReporterId = String((row && row.reporter_user_id) || '').trim();
  let targetUserId = rawReporterId;
  if (!targetUserId) return;
  // 레거시/혼재 데이터(user_id 저장) 대응: 사용자 PK(id)로 정규화
  const reporterUser = await _hdResolveUserByAnyId(rawReporterId);
  if (reporterUser && reporterUser.id) targetUserId = String(reporterUser.id || '').trim();
  if (!targetUserId) return;
  // 본인이 본인 티켓을 수정하는 경우는 알림 생략
  if (_hdIncludesSessionId(targetUserId, s) || _hdIncludesSessionId(rawReporterId, s)) return;
  const no = String((row && row.ticket_no) || '').trim() || String((row && row.id) || '').slice(0, 8);
  const title = String((row && row.title) || '').trim();
  await createNotification({
    toUserId: targetUserId,
    toUserName: String((row && row.reporter_user_name) || ''),
    fromUserId: _hdPrimarySessionId(s),
    fromUserName: String(s.name || ''),
    type,
    entryId: String((row && row.id) || ''),
    entrySummary: `${no} · ${title}`,
    message: message || `[Help Desk] ${no} 업데이트`,
    targetMenu: 'helpdesk',
  });
}

function _hdApplyPhaseUI() {
  const badgeWrap = document.getElementById('helpdesk-phase-badge-wrap');
  const banner = document.getElementById('helpdesk-phase-banner');
  if (badgeWrap) badgeWrap.innerHTML = '';
  if (banner) banner.innerHTML = '';
}

function _hdResetCreateForm() {
  const ids = ['hd-form-page-code', 'hd-form-title', 'hd-form-description', 'hd-form-repro'];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const c = document.getElementById('hd-form-category');
  const s = document.getElementById('hd-form-severity');
  if (c) c.value = 'bug';
  if (s) s.value = 'medium';
}

function _hdFilteredRows() {
  const fStatus = String(document.getElementById('hd-filter-status')?.value || '').trim();
  const fCategory = String(document.getElementById('hd-filter-category')?.value || '').trim();
  const fScope = String(document.getElementById('hd-filter-scope')?.value || 'mine').trim();
  const fQ = String(document.getElementById('hd-filter-q')?.value || '').trim().toLowerCase();
  const sidList = _hdSessionIdCandidates(HD_STATE.session || {});
  return (HD_STATE.rows || []).filter((r) => {
    if (fStatus && String(r.status || '') !== fStatus) return false;
    if (fCategory && String(r.category || '') !== fCategory) return false;
    if (!HD_STATE.canManage || fScope === 'mine') {
      if (!sidList.includes(String(r.reporter_user_id || '').trim())) return false;
    } else if (fScope === 'assigned') {
      if (!sidList.includes(String(r.assignee_user_id || '').trim())) return false;
    }
    if (fQ) {
      const hay = [
        r.ticket_no,
        r.title,
        r.reporter_user_name,
        r.description,
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      if (!hay.includes(fQ)) return false;
    }
    return true;
  }).sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
}

function _hdRenderList() {
  const body = document.getElementById('hd-list-body');
  const summary = document.getElementById('hd-list-summary');
  if (!body || !summary) return;
  const rows = _hdFilteredRows();
  summary.textContent = `총 ${rows.length}건`;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-inbox"></i><p>조건에 맞는 티켓이 없습니다.</p></td></tr>';
    return;
  }
  body.innerHTML = rows.map((r) => {
    const no = _hdEsc(r.ticket_no || (`HD-${String(r.id || '').slice(0, 8)}`));
    return `<tr data-hd-id="${_hdEsc(r.id)}" style="cursor:pointer">
      <td>${no}</td>
      <td style="text-align:center">${_hdStatusBadge(r.status)}</td>
      <td style="text-align:center">${_hdEsc(HD_LABEL.category[r.category] || r.category || '-')}</td>
      <td style="text-align:center">${_hdEsc(HD_LABEL.severity[r.severity] || r.severity || '-')}</td>
      <td title="${_hdEsc(r.title || '')}">${_hdEsc(r.title || '-')}</td>
      <td style="text-align:center">${_hdEsc(r.reporter_user_name || '-')}</td>
      <td style="text-align:center">${_hdEsc(_hdTsText(r.created_at))}</td>
    </tr>`;
  }).join('');
  body.querySelectorAll('tr[data-hd-id]').forEach((tr) => {
    tr.addEventListener('click', () => {
      HD_STATE.selectedId = String(tr.getAttribute('data-hd-id') || '');
      _hdRenderDetail();
      _hdLoadComments();
    });
  });
}

function _hdRenderDetail() {
  const empty = document.getElementById('hd-detail-empty');
  const card = document.getElementById('hd-detail-card');
  const row = (HD_STATE.rows || []).find((x) => String(x.id || '') === String(HD_STATE.selectedId || ''));
  if (!empty || !card) return;
  if (!row) {
    empty.style.display = '';
    card.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  card.style.display = '';
  document.getElementById('hd-detail-title').textContent = row.ticket_no || String(row.title || '상세');
  document.getElementById('hd-detail-status-badge').innerHTML = _hdStatusBadge(row.status);
  document.getElementById('hd-detail-meta').textContent =
    `${HD_LABEL.category[row.category] || row.category} · ${HD_LABEL.severity[row.severity] || row.severity} · 등록 ${_hdFullTsText(row.created_at)} · 등록자 ${row.reporter_user_name || '-'}`;
  document.getElementById('hd-detail-description').textContent = String(row.description || '-');
  const statusEl = document.getElementById('hd-detail-status');
  const assigneeIdEl = document.getElementById('hd-detail-assignee-id');
  const assigneeNameEl = document.getElementById('hd-detail-assignee-name');
  if (statusEl) statusEl.value = String(row.status || 'open');
  if (assigneeIdEl) assigneeIdEl.value = String(row.assignee_user_id || '');
  if (assigneeNameEl) assigneeNameEl.value = String(row.assignee_user_name || '');
  [statusEl, assigneeIdEl, assigneeNameEl, document.getElementById('hd-detail-save-btn')].forEach((el) => {
    if (el) el.disabled = !HD_STATE.canManage;
  });
}

function _hdRenderComments() {
  const box = document.getElementById('hd-comment-list');
  if (!box) return;
  const list = HD_STATE.comments || [];
  if (!list.length) {
    box.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">처리 이력이 없습니다.</div>';
    return;
  }
  box.innerHTML = list.map((c) => {
    const typeTxt = c.comment_type === 'status_change' ? '상태변경' : (c.comment_type === 'assignment' ? '담당변경' : '코멘트');
    const body = String(c.body || '').trim();
    return `<div style="border:1px solid var(--border-light);border-radius:8px;padding:8px 10px;background:#fff">
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--text-muted);margin-bottom:4px">
        <span>${_hdEsc(typeTxt)} · ${_hdEsc(c.created_by_name || '-')}</span>
        <span>${_hdEsc(_hdFullTsText(c.created_at))}</span>
      </div>
      <div style="font-size:12px;white-space:pre-wrap;line-height:1.5">${_hdEsc(body || '-')}</div>
    </div>`;
  }).join('');
}

function _hdApplyPendingOpenTicket() {
  const pendingId = String(window.__HD_OPEN_TICKET_ID__ || '').trim();
  if (!pendingId) return;
  window.__HD_OPEN_TICKET_ID__ = '';
  const exists = (HD_STATE.rows || []).some((r) => String(r.id || '') === pendingId);
  if (!exists) return;
  HD_STATE.selectedId = pendingId;
  _hdRenderDetail();
  _hdLoadComments();
}

async function _hdLoadComments() {
  const id = String(HD_STATE.selectedId || '').trim();
  if (!id) {
    HD_STATE.comments = [];
    _hdRenderComments();
    return;
  }
  try {
    HD_STATE.comments = await API.listAllPages('helpdesk_ticket_comments', {
      filter: `ticket_id=eq.${encodeURIComponent(id)}`,
      limit: 200,
      maxPages: 10,
      sort: 'created_at',
    });
  } catch (_) {
    HD_STATE.comments = [];
  }
  HD_STATE.comments.sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
  _hdRenderComments();
}

async function _hdLoadTickets() {
  const body = document.getElementById('hd-list-body');
  if (body) body.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-spinner fa-spin"></i><p>티켓을 불러오는 중입니다.</p></td></tr>';
  try {
    HD_STATE.rows = await API.listAllPages('helpdesk_tickets', { limit: 400, maxPages: 20, sort: 'updated_at' });
  } catch (e) {
    HD_STATE.rows = [];
    const msg = String(e && e.message || '');
    if (body) {
      body.innerHTML = `<tr><td colspan="7" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>Help Desk 테이블이 준비되지 않았습니다. docs/sql/helpdesk_v1_internal_to_vendor_ready.sql 을 먼저 적용해주세요.</p></td></tr>`;
    }
    if (typeof Toast !== 'undefined') Toast.warning('Help Desk 테이블 미준비: ' + msg);
    _hdRenderDetail();
    _hdRenderComments();
    return;
  }
  if (HD_STATE.selectedId && !(HD_STATE.rows || []).some((r) => String(r.id) === String(HD_STATE.selectedId))) {
    HD_STATE.selectedId = '';
  }
  _hdRenderList();
  _hdRenderDetail();
  await _hdLoadComments();
  _hdApplyPendingOpenTicket();
}

async function _hdCreateTicket() {
  const s = HD_STATE.session || {};
  const target = await _hdResolveNotifyTarget();
  const category = String(document.getElementById('hd-form-category')?.value || 'bug').trim();
  const severity = String(document.getElementById('hd-form-severity')?.value || 'medium').trim();
  const pageCode = String(document.getElementById('hd-form-page-code')?.value || '').trim();
  const title = String(document.getElementById('hd-form-title')?.value || '').trim();
  const description = String(document.getElementById('hd-form-description')?.value || '').trim();
  const repro = String(document.getElementById('hd-form-repro')?.value || '').trim();
  if (!title) {
    if (typeof Toast !== 'undefined') Toast.warning('제목을 입력하세요.');
    return;
  }
  if (!description) {
    if (typeof Toast !== 'undefined') Toast.warning('상세 내용을 입력하세요.');
    return;
  }
  const org = [s.dept_name, s.hq_name, s.cs_team_name].filter(Boolean).join(' / ');
  const payload = {
    category,
    severity,
    status: 'open',
    title,
    description,
    page_code: pageCode,
    repro_steps: repro,
    reporter_user_id: _hdPrimarySessionId(s),
    reporter_user_name: String(s.name || ''),
    reporter_org: org,
    owner_team: 'internal',
    assignee_user_id: String(target && target.id || ''),
    assignee_user_name: String(target && target.name || ''),
    outsource_ready: false,
    vendor_visible: HD_STATE.phase !== 'internal',
    created_by: _hdPrimarySessionId(s),
    created_by_name: String(s.name || ''),
    updated_by: _hdPrimarySessionId(s),
    updated_by_name: String(s.name || ''),
  };
  try {
    const created = await API.create('helpdesk_tickets', payload);
    await _hdNotifyOnCreate(created, payload);
    if (typeof Toast !== 'undefined') Toast.success('티켓이 등록되었습니다.');
    _hdResetCreateForm();
    await _hdLoadTickets();
    if (created && created.id) {
      HD_STATE.selectedId = String(created.id);
      _hdRenderDetail();
      await _hdLoadComments();
    }
  } catch (e) {
    const msg = String(e && e.message || e || '');
    if (typeof Toast !== 'undefined') {
      if (msg.includes('fn_helpdesk_assign_ticket_no') || msg.includes('_seq') || msg.includes('daily_counters')) {
        Toast.error('티켓 등록 실패: Help Desk 채번 트리거가 최신이 아닙니다. 최신 SQL(카운터 테이블 포함)을 다시 적용해주세요.');
      } else if (/row-level security|rls|policy/i.test(msg)) {
        Toast.error('티켓 등록 실패: Help Desk 테이블 RLS 정책으로 INSERT가 차단되었습니다. 운영 DB에서 helpdesk SQL(rls disable 구문)을 다시 적용해주세요.');
      } else {
        Toast.error('티켓 등록 실패: ' + msg);
      }
    }
  }
}

async function _hdSaveDetail() {
  if (!HD_STATE.canManage) return;
  const id = String(HD_STATE.selectedId || '').trim();
  if (!id) return;
  const row = (HD_STATE.rows || []).find((x) => String(x.id || '') === id);
  if (!row) return;
  const status = String(document.getElementById('hd-detail-status')?.value || row.status || 'open').trim();
  const assigneeId = String(document.getElementById('hd-detail-assignee-id')?.value || '').trim();
  const assigneeName = String(document.getElementById('hd-detail-assignee-name')?.value || '').trim();
  const s = HD_STATE.session || {};
  try {
    await API.patch('helpdesk_tickets', id, {
      status,
      assignee_user_id: assigneeId,
      assignee_user_name: assigneeName,
      updated_by: _hdPrimarySessionId(s),
      updated_by_name: String(s.name || ''),
      resolved_at: status === 'resolved' ? Date.now() : (row.resolved_at || null),
      closed_at: status === 'closed' ? Date.now() : (row.closed_at || null),
    });
    const assigneeChanged =
      assigneeId !== String(row.assignee_user_id || '')
      || assigneeName !== String(row.assignee_user_name || '');

    if (status !== row.status) {
      await API.create('helpdesk_ticket_comments', {
        ticket_id: id,
        comment_type: 'status_change',
        body: `상태 변경: ${HD_LABEL.status[row.status] || row.status} -> ${HD_LABEL.status[status] || status}`,
        old_status: row.status || '',
        new_status: status,
        vendor_visible: HD_STATE.phase !== 'internal',
        created_by: _hdPrimarySessionId(s),
        created_by_name: String(s.name || ''),
      });
      await _hdNotifyReporter(
        row,
        'helpdesk_status_updated',
        `[Help Desk] 상태 변경: ${HD_LABEL.status[row.status] || row.status} -> ${HD_LABEL.status[status] || status}`
      );
    }
    if (assigneeChanged) {
      await API.create('helpdesk_ticket_comments', {
        ticket_id: id,
        comment_type: 'assignment',
        body: `담당자 변경: ${row.assignee_user_name || '-'} -> ${assigneeName || '-'}`,
        vendor_visible: HD_STATE.phase !== 'internal',
        created_by: _hdPrimarySessionId(s),
        created_by_name: String(s.name || ''),
      });
      await _hdNotifyReporter(
        row,
        'helpdesk_status_updated',
        `[Help Desk] 담당자 변경: ${assigneeName || '-'}`
      );
    }
    if (typeof Toast !== 'undefined') Toast.success('티켓이 저장되었습니다.');
    await _hdLoadTickets();
  } catch (e) {
    if (typeof Toast !== 'undefined') Toast.error('저장 실패: ' + (e.message || e));
  }
}

async function _hdSubmitComment() {
  const id = String(HD_STATE.selectedId || '').trim();
  if (!id) {
    if (typeof Toast !== 'undefined') Toast.warning('티켓을 먼저 선택하세요.');
    return;
  }
  const input = document.getElementById('hd-comment-input');
  const body = String(input?.value || '').trim();
  if (!body) {
    if (typeof Toast !== 'undefined') Toast.warning('코멘트를 입력하세요.');
    return;
  }
  const s = HD_STATE.session || {};
  const row = (HD_STATE.rows || []).find((x) => String(x.id || '') === id) || null;
  try {
    await API.create('helpdesk_ticket_comments', {
      ticket_id: id,
      comment_type: 'comment',
      body,
      vendor_visible: HD_STATE.phase !== 'internal',
      created_by: _hdPrimarySessionId(s),
      created_by_name: String(s.name || ''),
    });
    if (row) {
      await _hdNotifyReporter(
        row,
        'helpdesk_comment',
        `[Help Desk] 새 코멘트가 등록되었습니다: ${row.ticket_no || String(row.id || '').slice(0, 8)}`
      );
    }
    if (input) input.value = '';
    await _hdLoadComments();
  } catch (e) {
    if (typeof Toast !== 'undefined') Toast.error('코멘트 등록 실패: ' + (e.message || e));
  }
}

function _hdBindOnce() {
  if (HD_STATE.initialized) return;
  document.getElementById('hd-form-submit-btn')?.addEventListener('click', _hdCreateTicket);
  document.getElementById('hd-form-reset-btn')?.addEventListener('click', _hdResetCreateForm);
  document.getElementById('hd-refresh-btn')?.addEventListener('click', _hdLoadTickets);
  ['hd-filter-status', 'hd-filter-category', 'hd-filter-scope'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', _hdRenderList);
  });
  document.getElementById('hd-filter-q')?.addEventListener('input', _hdRenderList);
  document.getElementById('hd-detail-save-btn')?.addEventListener('click', _hdSaveDetail);
  document.getElementById('hd-comment-submit-btn')?.addEventListener('click', _hdSubmitComment);
  HD_STATE.initialized = true;
}

function _hdStartAutoRefresh() {
  if (HD_STATE.refreshTimer) {
    clearInterval(HD_STATE.refreshTimer);
    HD_STATE.refreshTimer = null;
  }
  HD_STATE.refreshTimer = setInterval(() => {
    const page = document.getElementById('page-helpdesk');
    if (!page || !page.classList.contains('active')) return;
    _hdLoadTickets();
  }, 30000);
}

async function init_helpdesk() {
  const session = getSession ? getSession() : null;
  HD_STATE.session = session || {};
  HD_STATE.canManage = _hdCanManage(session || {});
  HD_STATE.phase = String((window.SmartLogHelpDesk && window.SmartLogHelpDesk.phase) || 'internal').trim();
  _hdBindOnce();
  _hdApplyPhaseUI();
  const scopeEl = document.getElementById('hd-filter-scope');
  if (scopeEl) {
    if (HD_STATE.canManage) {
      scopeEl.disabled = false;
      // 지정 관리자(hshan)는 항상 기본을 '내 담당'으로 고정해 신규 접수를 즉시 보게 한다.
      // 그 외 관리권한 사용자는 기본을 '전체'로 열어 누락 오인(메일은 왔는데 목록 미노출) 가능성을 줄인다.
      if (_hdIsDesignatedMaintainer(session || {})) scopeEl.value = 'assigned';
      else scopeEl.value = 'all';
    } else {
      scopeEl.value = 'mine';
      scopeEl.disabled = true;
    }
  }
  _hdResetCreateForm();
  _hdStartAutoRefresh();
  await _hdLoadTickets();
}

window.init_helpdesk = init_helpdesk;
