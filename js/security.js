/* ============================================================
   security.js  –  보안 로그 / 접속 이력 관리
   ============================================================ */
'use strict';

/* ── 상태 ── */
let _secSession = null;
let _secList    = [];
let _secPage    = 1;
let _secTotal   = 0;
let _secFilter  = { user_id: '', action: '', date_from: '', date_to: '' };
const SEC_PAGE_SIZE = 30;

/* ══════════════════════════════════════════════
   진입점
══════════════════════════════════════════════ */
async function init_security() {
  _secSession = Session.require();
  if (!_secSession) return;

  if (!Auth.isAdmin(_secSession)) {
    document.getElementById('security-no-permission')?.style &&
      (document.getElementById('security-no-permission').style.display = '');
    document.getElementById('security-main')?.style &&
      (document.getElementById('security-main').style.display = 'none');
    return;
  }

  await _setupSecFilterUI();
  _bindSecEvents();
  await _loadSecLogs();
  _renderSecStats();
}

/* ══════════════════════════════════════════════
   필터 UI
══════════════════════════════════════════════ */
async function _setupSecFilterUI() {
  const userSel = document.getElementById('sec-filter-user');
  if (userSel) {
    const r = await API.list('users', { limit: 200, sort: 'name' });
    const users = r?.data ?? [];
    userSel.innerHTML = '<option value="">전체 사용자</option>';
    users.forEach(u => {
      userSel.innerHTML += `<option value="${u.id}">${Utils.escHtml(u.name)}</option>`;
    });
  }

  const actionSel = document.getElementById('sec-filter-action');
  if (actionSel) {
    const actions = [
      { value: '',           label: '전체 액션' },
      { value: 'login',      label: '로그인' },
      { value: 'logout',     label: '로그아웃' },
      { value: 'login_fail', label: '로그인 실패' },
      { value: 'pw_change',  label: '비밀번호 변경' },
      { value: 'pw_reset',   label: '비밀번호 초기화' },
      { value: 'create',     label: '데이터 생성' },
      { value: 'update',     label: '데이터 수정' },
      { value: 'delete',     label: '데이터 삭제' },
      { value: 'export',     label: '내보내기' },
    ];
    actionSel.innerHTML = actions.map(a =>
      `<option value="${a.value}">${a.label}</option>`).join('');
  }

  const toDate   = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 7);
  const fmt = d => d.toISOString().slice(0, 10);

  _secFilter.date_from = fmt(fromDate);
  _secFilter.date_to   = fmt(toDate);

  const fromEl = document.getElementById('sec-filter-date-from');
  const toEl   = document.getElementById('sec-filter-date-to');
  if (fromEl) fromEl.value = _secFilter.date_from;
  if (toEl)   toEl.value   = _secFilter.date_to;
}

/* ══════════════════════════════════════════════
   이벤트 바인딩
══════════════════════════════════════════════ */
function _bindSecEvents() {
  const bindF = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      _secFilter[key] = el.value;
      _secPage = 1;
      _loadSecLogs();
    });
  };
  bindF('sec-filter-user',      'user_id');
  bindF('sec-filter-action',    'action');
  bindF('sec-filter-date-from', 'date_from');
  bindF('sec-filter-date-to',   'date_to');

  const searchEl = document.getElementById('sec-filter-search');
  if (searchEl) {
    searchEl.addEventListener('input', Utils.debounce(() => {
      _secFilter.search = searchEl.value;
      _secPage = 1;
      _loadSecLogs();
    }, 400));
  }
}

/* ══════════════════════════════════════════════
   로그 로드
══════════════════════════════════════════════ */
async function _loadSecLogs() {
  const wrap = document.getElementById('sec-log-list');
  if (wrap) wrap.innerHTML = _secSkeleton(8);

  try {
    const params = {
      page:  _secPage,
      limit: SEC_PAGE_SIZE,
      sort:  '-created_at',
    };
    if (_secFilter.user_id)   params['filter[user_id]']         = _secFilter.user_id;
    if (_secFilter.action)    params['filter[action]']          = _secFilter.action;
    if (_secFilter.date_from) params['filter[created_at][gte]'] = _secFilter.date_from;
    if (_secFilter.date_to)   params['filter[created_at][lte]'] = _secFilter.date_to + 'T23:59:59';
    if (_secFilter.search)    params.search                     = _secFilter.search;

    const r = await API.list('security_logs', params);
    _secList  = r?.data  ?? [];
    _secTotal = r?.total ?? 0;

    _renderSecList();
    _renderSecPagination();
  } catch (err) {
    console.error('[security] 로드 오류:', err);
    if (wrap) wrap.innerHTML = '<tr><td colspan="7" style="padding:24px;text-align:center;color:#dc2626;">로드 실패</td></tr>';
  }
}

/* ══════════════════════════════════════════════
   로그 목록 렌더
══════════════════════════════════════════════ */
function _renderSecList() {
  const tbody = document.getElementById('sec-log-list');
  if (!tbody) return;

  if (!_secList.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:32px;text-align:center;color:#94a3b8;">
      <i class="fa-solid fa-shield" style="font-size:24px;display:block;margin-bottom:8px;opacity:0.4;"></i>
      로그가 없습니다.
    </td></tr>`;
    return;
  }

  const ACTION_LABEL = {
    login:      { label: '로그인',          color: '#16a34a', icon: 'fa-right-to-bracket' },
    logout:     { label: '로그아웃',        color: '#64748b', icon: 'fa-right-from-bracket' },
    login_fail: { label: '로그인 실패',     color: '#dc2626', icon: 'fa-circle-xmark' },
    pw_change:  { label: '비밀번호 변경',   color: '#d97706', icon: 'fa-key' },
    pw_reset:   { label: '비밀번호 초기화', color: '#7c3aed', icon: 'fa-rotate-left' },
    create:     { label: '생성',            color: '#0891b2', icon: 'fa-plus-circle' },
    update:     { label: '수정',            color: '#2d6bb5', icon: 'fa-pen-circle' },
    delete:     { label: '삭제',            color: '#dc2626', icon: 'fa-trash-circle' },
    export:     { label: '내보내기',        color: '#d97706', icon: 'fa-file-export' },
  };

  tbody.innerHTML = _secList.map(log => {
    const act = ACTION_LABEL[log.action] || { label: log.action || '-', color: '#64748b', icon: 'fa-circle-dot' };
    const meta = log.meta
      ? (typeof log.meta === 'string' ? log.meta : JSON.stringify(log.meta))
      : '';
    const isAlert = log.action === 'login_fail' || log.action === 'delete';

    return `<tr style="border-bottom:1px solid #f1f5f9;${isAlert ? 'background:#fef2f2;' : ''}">
      <td style="padding:9px 10px;font-size:11.5px;color:#64748b;white-space:nowrap;">
        ${Utils.formatDatetime(log.created_at)}
      </td>
      <td style="padding:9px 10px;">
        <span style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;
          border-radius:10px;font-size:11.5px;font-weight:600;
          background:${act.color}18;color:${act.color};">
          <i class="fa-solid ${act.icon}" style="font-size:10px;"></i>
          ${act.label}
        </span>
      </td>
      <td style="padding:9px 10px;font-size:12px;color:#334155;font-weight:500;">
        ${Utils.escHtml(log.user_name || log.user_id || '-')}
      </td>
      <td style="padding:9px 10px;font-size:11.5px;color:#64748b;">
        ${Utils.escHtml(log.ip_address || '-')}
      </td>
      <td style="padding:9px 10px;font-size:11px;color:#94a3b8;
        max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        title="${Utils.escHtml(log.user_agent || '')}">
        ${Utils.escHtml((log.user_agent || '-').slice(0, 60))}
      </td>
      <td style="padding:9px 10px;font-size:11.5px;color:#64748b;
        max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        title="${Utils.escHtml(meta)}">
        ${Utils.escHtml(meta.slice(0, 60))}${meta.length > 60 ? '…' : ''}
      </td>
      <td style="padding:9px 10px;text-align:center;">
        ${isAlert
          ? '<i class="fa-solid fa-triangle-exclamation" style="color:#dc2626;font-size:13px;"></i>'
          : ''}
      </td>
    </tr>`;
  }).join('');
}

/* ── 페이지네이션 ── */
function _renderSecPagination() {
  const wrap = document.getElementById('sec-pagination');
  if (!wrap) return;
  wrap.innerHTML = Utils.paginationHTML(
    _secPage,
    Math.ceil(_secTotal / SEC_PAGE_SIZE),
    'secGoPage'
  );
  const info = document.getElementById('sec-count-info');
  if (info) info.textContent = `총 ${_secTotal}건`;
}
window.secGoPage = (p) => { _secPage = p; _loadSecLogs(); };

/* ── 스켈레톤 ── */
function _secSkeleton(n) {
  return Array(n).fill(0).map(() =>
    `<tr>${Array(7).fill(0).map(() =>
      `<td style="padding:10px 8px;">
        <div style="height:13px;
          background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);
          background-size:200% 100%;
          animation:arch-shimmer 1.4s infinite;
          border-radius:4px;"></div>
      </td>`).join('')}</tr>`
  ).join('');
}
/* ══════════════════════════════════════════════
   보안 통계
══════════════════════════════════════════════ */
async function _renderSecStats() {
  const wrap = document.getElementById('sec-stats-wrap');
  if (!wrap) return;

  try {
    const r = await API.list('security_logs', { limit: 1000, sort: '-created_at' });
    const logs = r?.data ?? [];

    const today = Utils.todayStr();
    const todayLogs    = logs.filter(l => (l.created_at||'').slice(0,10) === today);
    const loginFails   = logs.filter(l => l.action === 'login_fail');
    const todayLogins  = todayLogs.filter(l => l.action === 'login');
    const uniqueUsers  = new Set(logs.filter(l => l.action === 'login').map(l => l.user_id)).size;

    wrap.innerHTML = `
      <div class="kpi-grid" style="margin-bottom:16px;">
        <div class="kpi-card" style="border-top:3px solid #2d6bb5;">
          <div class="kpi-icon" style="color:#2d6bb5;"><i class="fa-solid fa-shield-halved"></i></div>
          <div class="kpi-body">
            <div class="kpi-label">전체 로그</div>
            <div class="kpi-value">${logs.length}건</div>
            <div class="kpi-sub">조회 기간 내</div>
          </div>
        </div>
        <div class="kpi-card" style="border-top:3px solid #16a34a;">
          <div class="kpi-icon" style="color:#16a34a;"><i class="fa-solid fa-right-to-bracket"></i></div>
          <div class="kpi-body">
            <div class="kpi-label">오늘 로그인</div>
            <div class="kpi-value">${todayLogins.length}건</div>
            <div class="kpi-sub">${today}</div>
          </div>
        </div>
        <div class="kpi-card" style="border-top:3px solid #dc2626;">
          <div class="kpi-icon" style="color:#dc2626;"><i class="fa-solid fa-circle-xmark"></i></div>
          <div class="kpi-body">
            <div class="kpi-label">로그인 실패</div>
            <div class="kpi-value" style="color:#dc2626;">${loginFails.length}건</div>
            <div class="kpi-sub">전체 기간</div>
          </div>
        </div>
        <div class="kpi-card" style="border-top:3px solid #7c3aed;">
          <div class="kpi-icon" style="color:#7c3aed;"><i class="fa-solid fa-users"></i></div>
          <div class="kpi-body">
            <div class="kpi-label">접속 사용자</div>
            <div class="kpi-value">${uniqueUsers}명</div>
            <div class="kpi-sub">고유 사용자</div>
          </div>
        </div>
      </div>`;
  } catch (err) {
    console.error('[security] 통계 오류:', err);
  }
}

/* ══════════════════════════════════════════════
   보안 로그 기록 (앱 전체에서 호출)
══════════════════════════════════════════════ */
async function writeSecLog(action, meta = {}) {
  try {
    const session = Session.get();
    const payload = {
      action,
      user_id:    session?.userId  || null,
      user_name:  session?.name    || null,
      ip_address: '',
      user_agent: navigator.userAgent.slice(0, 200),
      meta:       typeof meta === 'string' ? meta : JSON.stringify(meta),
      tab_id:     session?.tabId   || null,
    };
    await API.create('security_logs', payload);
  } catch (err) {
    console.warn('[security] 로그 기록 실패:', err);
  }
}
window.writeSecLog = writeSecLog;

/* ══════════════════════════════════════════════
   의심 활동 감지
══════════════════════════════════════════════ */
async function detectSuspiciousActivity() {
  const wrap = document.getElementById('sec-alert-wrap');
  if (!wrap) return;

  try {
    const r = await API.list('security_logs', {
      limit: 500,
      sort: '-created_at',
      'filter[action]': 'login_fail'
    });
    const fails = r?.data ?? [];

    /* 최근 1시간 내 동일 사용자 3회 이상 실패 */
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const recentFails = fails.filter(l => (l.created_at || '') > oneHourAgo);

    const failCount = {};
    recentFails.forEach(l => {
      const key = l.user_id || l.ip_address || 'unknown';
      failCount[key] = (failCount[key] || 0) + 1;
    });

    const alerts = Object.entries(failCount).filter(([, cnt]) => cnt >= 3);

    if (!alerts.length) {
      wrap.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;
          background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
          <i class="fa-solid fa-shield-check" style="color:#16a34a;"></i>
          <span style="font-size:13px;color:#16a34a;font-weight:500;">의심 활동 없음 — 정상</span>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <i class="fa-solid fa-triangle-exclamation" style="color:#dc2626;"></i>
          <span style="font-size:13px;font-weight:700;color:#dc2626;">의심 활동 감지 (최근 1시간)</span>
        </div>
        ${alerts.map(([key, cnt]) => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;
            border-bottom:1px solid #fecaca;font-size:12px;color:#7f1d1d;">
            <i class="fa-solid fa-user-slash" style="color:#dc2626;"></i>
            <span><strong>${Utils.escHtml(key)}</strong> — ${cnt}회 로그인 실패</span>
          </div>`).join('')}
      </div>`;
  } catch (err) {
    console.error('[security] 의심 활동 감지 오류:', err);
  }
}
window.detectSuspiciousActivity = detectSuspiciousActivity;

/* ══════════════════════════════════════════════
   Excel 내보내기
══════════════════════════════════════════════ */
async function exportSecurityExcel() {
  const btn = document.getElementById('sec-export-btn');
  const restore = BtnLoading.start(btn, '내보내는 중…');

  try {
    const params = { limit: 5000, sort: '-created_at' };
    if (_secFilter.user_id)   params['filter[user_id]']         = _secFilter.user_id;
    if (_secFilter.action)    params['filter[action]']          = _secFilter.action;
    if (_secFilter.date_from) params['filter[created_at][gte]'] = _secFilter.date_from;
    if (_secFilter.date_to)   params['filter[created_at][lte]'] = _secFilter.date_to + 'T23:59:59';

    const r = await API.list('security_logs', params);
    const logs = r?.data ?? [];

    const ACTION_KO = {
      login: '로그인', logout: '로그아웃', login_fail: '로그인 실패',
      pw_change: '비밀번호 변경', pw_reset: '비밀번호 초기화',
      create: '생성', update: '수정', delete: '삭제', export: '내보내기'
    };

    const data = [
      ['일시', '액션', '사용자', 'IP 주소', '브라우저', '상세정보']
    ];
    logs.forEach(l => {
      data.push([
        Utils.formatDatetime(l.created_at),
        ACTION_KO[l.action] || l.action || '',
        l.user_name || l.user_id || '',
        l.ip_address || '',
        (l.user_agent || '').slice(0, 100),
        l.meta ? (typeof l.meta === 'string' ? l.meta : JSON.stringify(l.meta)) : '',
      ]);
    });

    await Utils.xlsxDownload(data, `보안로그_${Utils.todayStr()}.xlsx`, '보안로그');
    Toast.success(`${logs.length}건 내보내기 완료`);
  } catch (err) {
    Toast.error('내보내기 실패');
  } finally {
    restore();
  }
}
window.exportSecurityExcel = exportSecurityExcel;

/* ══════════════════════════════════════════════
   로그 정리 (오래된 로그 삭제 - Admin)
══════════════════════════════════════════════ */
async function cleanupOldLogs(daysToKeep = 90) {
  const ok = await Confirm.show({
    title: '오래된 로그 정리',
    message: `${daysToKeep}일 이전 로그를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
    confirmText: '정리',
    confirmClass: 'btn-danger'
  });
  if (!ok) return;

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffStr = cutoff.toISOString();

    const r = await API.list('security_logs', {
      limit: 1000,
      'filter[created_at][lte]': cutoffStr
    });
    const old = r?.data ?? [];

    let deleted = 0;
    for (const log of old) {
      await API.delete('security_logs', log.id);
      deleted++;
    }

    Toast.success(`${deleted}건 정리 완료`);
    await _loadSecLogs();
  } catch (err) {
    Toast.error('정리 중 오류 발생');
  }
}
window.cleanupOldLogs = cleanupOldLogs;

/* ══════════════════════════════════════════════
   외부 노출
══════════════════════════════════════════════ */
window.init_security            = init_security;
window.writeSecLog              = writeSecLog;
window.detectSuspiciousActivity = detectSuspiciousActivity;
window.exportSecurityExcel      = exportSecurityExcel;
window.cleanupOldLogs           = cleanupOldLogs;
window.secGoPage                = secGoPage;
