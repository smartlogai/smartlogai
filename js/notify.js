// ════════════════════════════════════════════════════════════
//  notify.js  —  앱 내 알림 센터
//  - notifications 테이블 기반 폴링 (30초)
//  - 헤더 🔔 배지 + 드롭다운 목록
//  - 알림 생성 헬퍼 함수 (다른 모듈에서 호출)
// ════════════════════════════════════════════════════════════

'use strict';

// ── 상수 ────────────────────────────────────────────────────
const NOTIFY_POLL_MS  = 30_000;   // 폴링 간격 30초
const NOTIFY_MAX_LIST = 30;       // 드롭다운 최대 표시 건수

// ── 상태 ────────────────────────────────────────────────────
let _notifyTimer    = null;   // setInterval 핸들
let _notifyOpen     = false;  // 드롭다운 열림 여부
let _notifyList     = [];     // 마지막으로 로드된 알림 목록

// ── 알림 유형 설정 ───────────────────────────────────────────
const NOTIFY_META = {
  submitted:    { icon: '📋', label: '승인 요청',   color: '#2563eb', bg: '#eff6ff', target: 'approval'    },
  pre_approved: { icon: '✅', label: '1차 승인',    color: '#16a34a', bg: '#f0fdf4', target: 'my-entries'  },
  approved:     { icon: '🎉', label: '최종 승인',   color: '#15803d', bg: '#f0fdf4', target: 'my-entries'  },
  rejected:     { icon: '❌', label: '반려',        color: '#dc2626', bg: '#fef2f2', target: 'my-entries'  },
};

// ════════════════════════════════════════════════════════════
//  초기화 — 로그인 후 호출
// ════════════════════════════════════════════════════════════
function initNotify() {
  _buildNotifyDropdown();
  _bindNotifyToggle();
  _pollNotify();  // 즉시 1회 실행

  if (_notifyTimer) clearInterval(_notifyTimer);
  _notifyTimer = setInterval(_pollNotify, NOTIFY_POLL_MS);
}

/** 로그아웃 시 폴링 정지 */
function destroyNotify() {
  if (_notifyTimer) { clearInterval(_notifyTimer); _notifyTimer = null; }
  _notifyOpen = false;
  _notifyList = [];
  _setBadge(0);
}

// ════════════════════════════════════════════════════════════
//  폴링 — 미읽음 알림 수 카운트 → 배지 업데이트
// ════════════════════════════════════════════════════════════
async function _pollNotify() {
  const session = (typeof getSession === 'function') ? getSession() : null;
  if (!session || !session.id) return;

  try {
    // Supabase REST API로 알림 목록 조회
    const json = await API.list('notifications', { limit: 200, sort: 'created_at' });
    const all  = (json.data || []).filter(n => n.to_user_id === session.id);

    // 최신순 정렬
    all.sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0));
    _notifyList = all.slice(0, NOTIFY_MAX_LIST);

    const unread = all.filter(n => !n.is_read).length;
    _setBadge(unread);

    // 드롭다운이 열려있으면 목록 갱신
    if (_notifyOpen) _renderNotifyList();
  } catch (e) {
    // 폴링 실패 — 조용히 무시
  }
}

// ════════════════════════════════════════════════════════════
//  배지 업데이트
// ════════════════════════════════════════════════════════════
function _setBadge(count) {
  const badge = document.getElementById('notify-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ════════════════════════════════════════════════════════════
//  드롭다운 DOM 구성 (최초 1회)
// ════════════════════════════════════════════════════════════
function _buildNotifyDropdown() {
  if (document.getElementById('notify-dropdown')) return; // 이미 존재

  const dropdown = document.createElement('div');
  dropdown.id = 'notify-dropdown';
  dropdown.style.cssText = `
    display:none; position:fixed; top:56px; right:16px;
    width:360px; max-height:480px;
    background:#fff; border-radius:12px;
    box-shadow:0 8px 32px rgba(0,0,0,0.14);
    border:1px solid #e5e7eb; z-index:8000;
    overflow:hidden; flex-direction:column;
    font-family:inherit;
  `;
  dropdown.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:14px 16px 10px;border-bottom:1px solid #f3f4f6">
      <span style="font-size:14px;font-weight:700;color:#111827">
        <i class="fas fa-bell" style="color:#6d28d9;margin-right:6px"></i>알림
      </span>
      <button id="notify-read-all" style="font-size:11px;color:#6b7280;background:none;
              border:none;cursor:pointer;padding:2px 6px;border-radius:5px"
        onmouseover="this.style.background='#f3f4f6'"
        onmouseout="this.style.background='none'">
        모두 읽음
      </button>
    </div>
    <div id="notify-list" style="overflow-y:auto;flex:1;max-height:400px"></div>
  `;
  document.body.appendChild(dropdown);

  // 모두 읽음 버튼
  dropdown.querySelector('#notify-read-all').addEventListener('click', (e) => {
    e.stopPropagation();
    _markAllRead();
  });
}

// ════════════════════════════════════════════════════════════
//  토글 바인딩
// ════════════════════════════════════════════════════════════
function _bindNotifyToggle() {
  const btn = document.getElementById('notify-btn');
  if (!btn) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    _notifyOpen = !_notifyOpen;
    const dd = document.getElementById('notify-dropdown');
    if (!dd) return;
    if (_notifyOpen) {
      dd.style.display = 'flex';
      _renderNotifyList();
    } else {
      dd.style.display = 'none';
    }
  });

  // 외부 클릭 시 닫기
  document.addEventListener('click', (e) => {
    const dd  = document.getElementById('notify-dropdown');
    const btn = document.getElementById('notify-btn');
    if (!dd || !btn) return;
    if (!dd.contains(e.target) && !btn.contains(e.target)) {
      _notifyOpen = false;
      dd.style.display = 'none';
    }
  });
}

// ════════════════════════════════════════════════════════════
//  알림 목록 렌더링
// ════════════════════════════════════════════════════════════
function _renderNotifyList() {
  const listEl = document.getElementById('notify-list');
  if (!listEl) return;

  if (_notifyList.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:#9ca3af;font-size:13px">
        <div style="font-size:32px;margin-bottom:8px">🔔</div>
        새로운 알림이 없습니다.
      </div>`;
    return;
  }

  listEl.innerHTML = _notifyList.map(n => {
    const meta    = NOTIFY_META[n.type] || { icon: '📢', label: n.type, color: '#6b7280', bg: '#f9fafb' };
    const isUnread = !n.is_read;
    const timeStr  = _relTime(n.created_at);

    return `
      <div onclick="_onNotifyClick('${n.id}','${n.target_menu || meta.target}','${n.entry_id || ''}')"
        style="display:flex;gap:12px;align-items:flex-start;padding:12px 16px;cursor:pointer;
               border-bottom:1px solid #f9fafb;transition:background 0.15s;
               background:${isUnread ? '#faf5ff' : '#fff'}"
        onmouseover="this.style.background='${isUnread ? '#f3e8ff' : '#f9fafb'}'"
        onmouseout="this.style.background='${isUnread ? '#faf5ff' : '#fff'}'">
        <div style="width:36px;height:36px;border-radius:50%;background:${meta.bg};
                    display:flex;align-items:center;justify-content:center;
                    font-size:16px;flex-shrink:0;margin-top:1px">
          ${meta.icon}
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <span style="font-size:11px;font-weight:600;color:${meta.color};
                         background:${meta.bg};padding:1px 7px;border-radius:10px">
              ${meta.label}
            </span>
            ${isUnread ? '<span style="width:7px;height:7px;border-radius:50%;background:#7c3aed;display:inline-block;flex-shrink:0"></span>' : ''}
          </div>
          <div style="font-size:13px;color:#111827;line-height:1.5;word-break:keep-all">
            ${Utils.escHtml ? Utils.escHtml(n.message || '') : (n.message || '')}
          </div>
          ${n.entry_summary ? `<div style="font-size:11px;color:#6b7280;margin-top:3px;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            📁 ${Utils.escHtml ? Utils.escHtml(n.entry_summary) : n.entry_summary}</div>` : ''}
          <div style="font-size:11px;color:#9ca3af;margin-top:4px">${timeStr}</div>
        </div>
      </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════
//  알림 클릭 처리 — 읽음 처리 + 메뉴 이동
// ════════════════════════════════════════════════════════════
async function _onNotifyClick(notifyId, targetMenu, entryId) {
  // 드롭다운 닫기
  _notifyOpen = false;
  const dd = document.getElementById('notify-dropdown');
  if (dd) dd.style.display = 'none';

  // 읽음 처리
  try {
    // Supabase REST API로 읽음 처리
    await API.patch('notifications', notifyId, { is_read: true });
    const item = _notifyList.find(n => n.id === notifyId);
    if (item) item.is_read = true;
    const unread = _notifyList.filter(n => !n.is_read).length;
    _setBadge(unread);
  } catch (e) { /* 무시 */ }

  // 메뉴 이동
  if (targetMenu && typeof navigateTo === 'function') {
    navigateTo(targetMenu);
  }
}

// ════════════════════════════════════════════════════════════
//  모두 읽음 처리
// ════════════════════════════════════════════════════════════
async function _markAllRead() {
  const unreadItems = _notifyList.filter(n => !n.is_read);
  if (unreadItems.length === 0) return;

  // Supabase REST API로 일괄 읽음 처리
  await Promise.allSettled(
    unreadItems.map(n => API.patch('notifications', n.id, { is_read: true }))
  );
  _notifyList.forEach(n => { n.is_read = true; });
  _setBadge(0);
  _renderNotifyList();
}

// ════════════════════════════════════════════════════════════
//  알림 생성 헬퍼 — 다른 모듈에서 호출
//  createNotification({ toUserId, toUserName, fromUserId, fromUserName,
//                        type, entryId, entrySummary, message, targetMenu })
// ════════════════════════════════════════════════════════════
async function createNotification({
  toUserId, toUserName,
  fromUserId, fromUserName,
  type, entryId, entrySummary,
  message, targetMenu,
}) {
  if (!toUserId || !type) return;
  try {
    // Supabase REST API로 알림 생성
    await API.create('notifications', {
      to_user_id:    toUserId,
      to_user_name:  toUserName   || '',
      from_user_id:  fromUserId   || '',
      from_user_name: fromUserName || '',
      type,
      entry_id:      entryId      || '',
      entry_summary: entrySummary || '',
      message:       message      || '',
      is_read:       false,
      target_menu:   targetMenu   || (NOTIFY_META[type]?.target || 'my-entries'),
    });
  } catch (e) {
    console.warn('알림 생성 실패:', e);
  }
}

// ════════════════════════════════════════════════════════════
//  유틸 — 상대 시간 표시
// ════════════════════════════════════════════════════════════
function _relTime(tsRaw) {
  if (!tsRaw) return '';
  const ts   = Number(tsRaw);
  const diff = Date.now() - (ts > 1e12 ? ts : ts * 1000);
  const sec  = Math.floor(diff / 1000);
  if (sec < 60)          return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60)          return `${min}분 전`;
  const hr  = Math.floor(min / 60);
  if (hr  < 24)          return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7)           return `${day}일 전`;
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  return `${d.getMonth()+1}/${d.getDate()}`;
}
