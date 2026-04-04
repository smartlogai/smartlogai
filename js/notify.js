/* ============================================================
   notify.js  –  알림 / 공지 시스템
   ============================================================ */
'use strict';

/* ── 상태 ── */
let _ntSession  = null;
let _ntList     = [];
let _ntPage     = 1;
let _ntTotal    = 0;
let _ntFilter   = { type: '', is_read: '', date_from: '', date_to: '' };
let _ntPollTimer = null;
const NT_PAGE_SIZE   = 20;
const NT_POLL_MS     = 60000; /* 1분마다 폴링 */

/* ══════════════════════════════════════════════
   진입점 (알림 페이지)
══════════════════════════════════════════════ */
async function init_notify() {
  _ntSession = Session.require();
  if (!_ntSession) return;

  _bindNtEvents();
  await _loadNotifications();
}

/* ══════════════════════════════════════════════
   폴링 시작/중지 (main.js에서 호출)
══════════════════════════════════════════════ */
function startNotifyPolling(session) {
  _ntSession = session;
  _pollBadge();
  if (_ntPollTimer) clearInterval(_ntPollTimer);
  _ntPollTimer = setInterval(_pollBadge, NT_POLL_MS);
}
window.startNotifyPolling = startNotifyPolling;

function destroyNotify() {
  if (_ntPollTimer) { clearInterval(_ntPollTimer); _ntPollTimer = null; }
}
window.destroyNotify = destroyNotify;

/* ── 배지 폴링 ── */
async function _pollBadge() {
  try {
    const session = _ntSession || Session.get();
    if (!session) return;

    const r = await API.list('notifications', {
      limit: 1,
      'filter[user_id]':  session.userId,
      'filter[is_read]':  false,
    });
    const unread = r?.total ?? 0;

    const badge = document.getElementById('notify-badge');
    if (badge) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.style.display = unread > 0 ? '' : 'none';
    }
  } catch (err) {
    /* 폴링 오류는 조용히 무시 */
  }
}

/* ══════════════════════════════════════════════
   이벤트 바인딩
══════════════════════════════════════════════ */
function _bindNtEvents() {
  const bindF = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      _ntFilter[key] = el.value;
      _ntPage = 1;
      _loadNotifications();
    });
  };
  bindF('nt-filter-type',      'type');
  bindF('nt-filter-read',      'is_read');
  bindF('nt-filter-date-from', 'date_from');
  bindF('nt-filter-date-to',   'date_to');
}

/* ══════════════════════════════════════════════
   알림 로드
══════════════════════════════════════════════ */
async function _loadNotifications() {
  const wrap = document.getElementById('nt-list-wrap');
  if (wrap) wrap.innerHTML = _ntSkeleton(5);

  try {
    const session = _ntSession || Session.get();
    if (!session) return;

    const params = {
      page:  _ntPage,
      limit: NT_PAGE_SIZE,
      sort:  '-created_at',
      'filter[user_id]': session.userId,
    };
    if (_ntFilter.type)      params['filter[type]']    = _ntFilter.type;
    if (_ntFilter.is_read !== '') params['filter[is_read]'] = _ntFilter.is_read;
    if (_ntFilter.date_from) params['filter[created_at][gte]'] = _ntFilter.date_from;
    if (_ntFilter.date_to)   params['filter[created_at][lte]'] = _ntFilter.date_to;

    const r = await API.list('notifications', params);
    _ntList  = r?.data  ?? [];
    _ntTotal = r?.total ?? 0;

    _renderNtList();
    _renderNtPagination();
  } catch (err) {
    console.error('[notify] 로드 오류:', err);
    if (wrap) wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#dc2626;">로드 실패</div>';
  }
}

/* ══════════════════════════════════════════════
   알림 목록 렌더
══════════════════════════════════════════════ */
function _renderNtList() {
  const wrap = document.getElementById('nt-list-wrap');
  if (!wrap) return;

  const unreadCount = _ntList.filter(n => !n.is_read).length;
  const countEl = document.getElementById('nt-count-info');
  if (countEl) countEl.textContent = `총 ${_ntTotal}건 (미읽음 ${unreadCount}건)`;

  if (!_ntList.length) {
    wrap.innerHTML = `
      <div style="padding:48px;text-align:center;color:#94a3b8;">
        <i class="fa-solid fa-bell-slash" style="font-size:32px;display:block;margin-bottom:12px;opacity:0.4;"></i>
        알림이 없습니다.
      </div>`;
    return;
  }

  const NT_TYPE = {
    approval_request:  { label: '결재 요청',    color: '#d97706', icon: 'fa-file-pen',         bg: '#fffbeb' },
    approval_done:     { label: '결재 완료',    color: '#16a34a', icon: 'fa-circle-check',      bg: '#f0fdf4' },
    approval_reject:   { label: '결재 반려',    color: '#dc2626', icon: 'fa-circle-xmark',      bg: '#fef2f2' },
    approval_request2: { label: '2차 결재 요청',color: '#d97706', icon: 'fa-file-circle-check', bg: '#fffbeb' },
    pw_expiry:         { label: '비밀번호 만료', color: '#7c3aed', icon: 'fa-key',               bg: '#f5f3ff' },
    system:            { label: '시스템',        color: '#64748b', icon: 'fa-gear',               bg: '#f8fafc' },
    notice:            { label: '공지',          color: '#2d6bb5', icon: 'fa-bullhorn',           bg: '#eff6ff' },
  };

  wrap.innerHTML = _ntList.map(n => {
    const t = NT_TYPE[n.type] || { label: n.type||'알림', color:'#64748b', icon:'fa-bell', bg:'#f8fafc' };
    const isUnread = !n.is_read;

    return `
      <div class="arch-card ${isUnread ? '' : ''}"
        style="padding:14px 18px;border-bottom:1px solid #f1f5f9;
          ${isUnread ? 'background:#fafbff;border-left:3px solid #2d6bb5;' : 'border-left:3px solid transparent;'}
          cursor:pointer;"
        onclick="markNtRead('${n.id}')">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="width:36px;height:36px;border-radius:50%;background:${t.bg};
            display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;">
            <i class="fa-solid ${t.icon}" style="color:${t.color};font-size:14px;"></i>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span style="font-size:11.5px;font-weight:600;color:${t.color};
                background:${t.bg};padding:1px 7px;border-radius:8px;">${t.label}</span>
              ${isUnread ? '<span style="width:7px;height:7px;border-radius:50%;background:#2d6bb5;flex-shrink:0;"></span>' : ''}
              <span style="font-size:11px;color:#94a3b8;margin-left:auto;white-space:nowrap;">
                ${Utils.formatDatetime(n.created_at)}
              </span>
            </div>
            <div style="font-size:13px;font-weight:${isUnread ? '600' : '400'};color:#1e293b;
              margin-bottom:4px;line-height:1.45;">
              ${Utils.escHtml(n.title || '알림')}
            </div>
            ${n.body ? `<div style="font-size:12px;color:#64748b;line-height:1.55;word-break:keep-all;">
              ${Utils.escHtml(n.body.slice(0,120))}${n.body.length>120?'…':''}
            </div>` : ''}
            ${n.link ? `<a href="javascript:void(0)" onclick="handleNtLink('${n.link}')"
              style="font-size:12px;color:#2d6bb5;text-decoration:none;margin-top:4px;display:inline-block;">
              <i class="fa-solid fa-arrow-right" style="font-size:10px;"></i> 바로가기
            </a>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ── 페이지네이션 ── */
function _renderNtPagination() {
  const wrap = document.getElementById('nt-pagination');
  if (!wrap) return;
  wrap.innerHTML = Utils.paginationHTML(_ntPage, Math.ceil(_ntTotal / NT_PAGE_SIZE), 'ntGoPage');
}
window.ntGoPage = (p) => { _ntPage = p; _loadNotifications(); };

/* ── 스켈레톤 ── */
function _ntSkeleton(n) {
  return Array(n).fill(0).map(() => `
    <div style="padding:14px 18px;border-bottom:1px solid #f1f5f9;display:flex;gap:12px;">
      <div style="width:36px;height:36px;border-radius:50%;
        background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);
        background-size:200% 100%;animation:arch-shimmer 1.4s infinite;flex-shrink:0;"></div>
      <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
        <div style="height:13px;width:40%;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);
          background-size:200% 100%;animation:arch-shimmer 1.4s infinite;border-radius:4px;"></div>
        <div style="height:11px;width:75%;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);
          background-size:200% 100%;animation:arch-shimmer 1.4s infinite;border-radius:4px;"></div>
      </div>
    </div>`).join('');
}
/* ══════════════════════════════════════════════
   읽음 처리
══════════════════════════════════════════════ */
async function markNtRead(id) {
  try {
    const nt = _ntList.find(n => n.id === id);
    if (!nt || nt.is_read) return;

    await API.patch('notifications', id, { is_read: true, read_at: new Date().toISOString() });
    nt.is_read = true;
    _renderNtList();
    _pollBadge();
  } catch (err) {
    console.warn('[notify] 읽음 처리 오류:', err);
  }
}
window.markNtRead = markNtRead;

/* ── 전체 읽음 처리 ── */
async function markAllNtRead() {
  const unread = _ntList.filter(n => !n.is_read);
  if (!unread.length) { Toast.info('읽지 않은 알림이 없습니다.'); return; }

  const btn = document.getElementById('nt-read-all-btn');
  const restore = BtnLoading.start(btn, '처리 중…');

  try {
    const now = new Date().toISOString();
    for (const n of unread) {
      await API.patch('notifications', n.id, { is_read: true, read_at: now });
    }
    Toast.success(`${unread.length}건 읽음 처리 완료`);
    await _loadNotifications();
    _pollBadge();
  } catch (err) {
    Toast.error('처리 중 오류 발생');
  } finally {
    restore();
  }
}
window.markAllNtRead = markAllNtRead;

/* ── 알림 링크 처리 ── */
function handleNtLink(link) {
  if (!link) return;
  if (link.startsWith('page:')) {
    const page = link.replace('page:', '');
    navigateTo(page);
  } else if (link.startsWith('http')) {
    window.open(link, '_blank');
  }
}
window.handleNtLink = handleNtLink;

/* ══════════════════════════════════════════════
   알림 생성 (서버 → 클라이언트 방향)
══════════════════════════════════════════════ */
async function createNotification(userId, type, title, body = '', link = '') {
  try {
    await API.create('notifications', {
      user_id:    userId,
      type,
      title,
      body,
      link,
      is_read:    false,
      created_by: _ntSession?.userId || null,
    });
  } catch (err) {
    console.warn('[notify] 알림 생성 오류:', err);
  }
}
window.createNotification = createNotification;

/* ── 결재 요청 알림 발송 ── */
async function sendApprovalNotification(entry, approverId, step = 1) {
  try {
    const title = step === 1
      ? `[결재 요청] ${entry.title}`
      : `[2차 결재 요청] ${entry.title}`;
    const body = `${entry.work_date} · ${Utils.minToHM(entry.duration_min || 0)} · 결재를 요청했습니다.`;
    await createNotification(approverId, step === 1 ? 'approval_request' : 'approval_request2', title, body, 'page:approval');
  } catch (err) {
    console.warn('[notify] 결재 알림 발송 오류:', err);
  }
}
window.sendApprovalNotification = sendApprovalNotification;

/* ── 결재 완료/반려 알림 발송 ── */
async function sendApprovalResultNotification(entry, result, reason = '') {
  try {
    const isApproved = result === 'approved';
    const type  = isApproved ? 'approval_done' : 'approval_reject';
    const title = isApproved
      ? `[승인 완료] ${entry.title}`
      : `[반려] ${entry.title}`;
    const body  = isApproved
      ? '업무 내역이 최종 승인되었습니다.'
      : `반려 사유: ${reason}`;
    await createNotification(entry.user_id, type, title, body, 'page:entry');
  } catch (err) {
    console.warn('[notify] 결재 결과 알림 오류:', err);
  }
}
window.sendApprovalResultNotification = sendApprovalResultNotification;

/* ══════════════════════════════════════════════
   공지 발송 (Admin)
══════════════════════════════════════════════ */
async function openNoticeModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:26px;width:500px;max-width:92vw;
      box-shadow:0 24px 70px rgba(0,0,0,0.22);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 style="font-size:16px;font-weight:700;color:#1e293b;margin:0;">
          <i class="fa-solid fa-bullhorn" style="color:#2d6bb5;margin-right:8px;"></i> 공지 발송
        </h3>
        <button id="_ntc-close" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer;">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="form-group">
          <label class="form-label">제목 <span style="color:#dc2626;">*</span></label>
          <input type="text" id="_ntc-title" class="form-control" placeholder="공지 제목">
        </div>
        <div class="form-group">
          <label class="form-label">내용</label>
          <textarea id="_ntc-body" class="form-control" rows="4" placeholder="공지 내용"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">대상</label>
          <select id="_ntc-target" class="form-control">
            <option value="all">전체 사용자</option>
            <option value="staff">직원만</option>
            <option value="manager">매니저 이상</option>
          </select>
        </div>
      </div>
      <div id="_ntc-err" style="color:#dc2626;font-size:12px;margin-top:8px;display:none;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;
        padding-top:16px;border-top:1px solid #f1f5f9;">
        <button id="_ntc-cancel" class="btn btn-outline">취소</button>
        <button id="_ntc-send" class="btn btn-primary">
          <i class="fa-solid fa-paper-plane"></i> 발송
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
  overlay.querySelector('#_ntc-close').onclick  = close;
  overlay.querySelector('#_ntc-cancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#_ntc-send').onclick = async () => {
    const errEl  = overlay.querySelector('#_ntc-err');
    const saveBtn = overlay.querySelector('#_ntc-send');
    errEl.style.display = 'none';

    const title  = overlay.querySelector('#_ntc-title').value.trim();
    const body   = overlay.querySelector('#_ntc-body').value.trim();
    const target = overlay.querySelector('#_ntc-target').value;

    if (!title) { errEl.textContent = '제목을 입력하세요.'; errEl.style.display=''; return; }

    const restore = BtnLoading.start(saveBtn, '발송 중…');
    try {
      const usersR = await API.list('users', { limit: 500 });
      const users  = (usersR?.data ?? []).filter(u => {
        if (target === 'all')     return true;
        if (target === 'staff')   return u.role === 'staff';
        if (target === 'manager') return ['manager','director','admin'].includes(u.role);
        return true;
      });

      for (const u of users) {
        await createNotification(u.id, 'notice', title, body, '');
      }

      Toast.success(`${users.length}명에게 공지 발송 완료`);
      close();
    } catch (err) {
      errEl.textContent = '발송 중 오류가 발생했습니다.';
      errEl.style.display = '';
    } finally {
      restore();
    }
  };

  setTimeout(() => overlay.querySelector('#_ntc-title')?.focus(), 80);
}
window.openNoticeModal = openNoticeModal;

/* ══════════════════════════════════════════════
   알림 삭제
══════════════════════════════════════════════ */
async function deleteNotification(id) {
  try {
    await API.delete('notifications', id);
    _ntList = _ntList.filter(n => n.id !== id);
    _ntTotal = Math.max(0, _ntTotal - 1);
    _renderNtList();
    _renderNtPagination();
    _pollBadge();
  } catch (err) {
    Toast.error('삭제 중 오류 발생');
  }
}
window.deleteNotification = deleteNotification;

/* ── 오래된 알림 정리 ── */
async function cleanupOldNotifications(daysToKeep = 30) {
  const ok = await Confirm.show({
    title: '오래된 알림 정리',
    message: `${daysToKeep}일 이전 알림을 삭제하시겠습니까?`,
    confirmText: '정리',
    confirmClass: 'btn-danger'
  });
  if (!ok) return;

  try {
    const session = _ntSession || Session.get();
    const cutoff  = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);

    const r = await API.list('notifications', {
      limit: 500,
      'filter[user_id]':         session.userId,
      'filter[created_at][lte]': cutoff.toISOString(),
    });
    const old = r?.data ?? [];
    for (const n of old) await API.delete('notifications', n.id);

    Toast.success(`${old.length}건 정리 완료`);
    await _loadNotifications();
  } catch (err) {
    Toast.error('정리 중 오류 발생');
  }
}
window.cleanupOldNotifications = cleanupOldNotifications;

/* ══════════════════════════════════════════════
   외부 노출
══════════════════════════════════════════════ */
window.init_notify                    = init_notify;
window.startNotifyPolling             = startNotifyPolling;
window.destroyNotify                  = destroyNotify;
window.markNtRead                     = markNtRead;
window.markAllNtRead                  = markAllNtRead;
window.handleNtLink                   = handleNtLink;
window.createNotification             = createNotification;
window.sendApprovalNotification       = sendApprovalNotification;
window.sendApprovalResultNotification = sendApprovalResultNotification;
window.openNoticeModal                = openNoticeModal;
window.deleteNotification             = deleteNotification;
window.cleanupOldNotifications        = cleanupOldNotifications;
window.ntGoPage                       = ntGoPage;
