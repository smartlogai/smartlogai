/* ============================================================
   users.js  –  사용자 관리 (Admin 전용)
   ============================================================ */
'use strict';

/* ── 상태 ── */
let _usSession  = null;
let _usList     = [];
let _usPage     = 1;
let _usTotal    = 0;
let _usFilter   = { search: '', role: '', team_id: '' };
const US_PAGE_SIZE = 20;

/* ══════════════════════════════════════════════
   진입점
══════════════════════════════════════════════ */
async function init_users() {
  _usSession = Session.require();
  if (!_usSession) return;

  if (!Auth.isAdmin(_usSession)) {
    document.getElementById('users-no-permission')?.style &&
      (document.getElementById('users-no-permission').style.display = '');
    document.getElementById('users-main')?.style &&
      (document.getElementById('users-main').style.display = 'none');
    return;
  }

  await _setupUsFilterUI();
  _bindUsEvents();
  await _loadUsers();
}

/* ══════════════════════════════════════════════
   필터 UI
══════════════════════════════════════════════ */
async function _setupUsFilterUI() {
  /* 팀 셀렉트 */
  const teamSel = document.getElementById('us-filter-team');
  if (teamSel) {
    const r = await API.list('teams', { limit: 100, sort: 'name' });
    const teams = r?.data ?? [];
    teamSel.innerHTML = '<option value="">전체 팀</option>';
    teams.forEach(t => {
      teamSel.innerHTML += `<option value="${t.id}">${Utils.escHtml(t.name)}</option>`;
    });
  }
}

/* ══════════════════════════════════════════════
   이벤트 바인딩
══════════════════════════════════════════════ */
function _bindUsEvents() {
  const bindF = (id, key, isCheck = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(isCheck ? 'change' : 'input', Utils.debounce(() => {
      _usFilter[key] = isCheck ? el.checked : el.value;
      _usPage = 1;
      _loadUsers();
    }, 300));
  };
  bindF('us-filter-search', 'search');
  bindF('us-filter-role',   'role');
  bindF('us-filter-team',   'team_id');
}

/* ══════════════════════════════════════════════
   사용자 목록 로드
══════════════════════════════════════════════ */
async function _loadUsers() {
  const wrap = document.getElementById('users-list-wrap');
  if (wrap) wrap.innerHTML = _usSkeleton(5);

  try {
    const params = {
      page:  _usPage,
      limit: US_PAGE_SIZE,
      sort:  'name',
    };
    if (_usFilter.search)  params.search              = _usFilter.search;
    if (_usFilter.role)    params['filter[role]']     = _usFilter.role;
    if (_usFilter.team_id) params['filter[team_id]']  = _usFilter.team_id;

    const r = await API.list('users', params);
    _usList  = r?.data  ?? [];
    _usTotal = r?.total ?? 0;

    _renderUserList();
    _renderUsPagination();
  } catch (err) {
    console.error('[users] 로드 오류:', err);
    if (wrap) wrap.innerHTML = '<tr><td colspan="8" style="padding:24px;text-align:center;color:#dc2626;">로드 실패</td></tr>';
  }
}

/* ══════════════════════════════════════════════
   목록 렌더
══════════════════════════════════════════════ */
function _renderUserList() {
  const tbody = document.getElementById('users-list-wrap');
  if (!tbody) return;

  if (!_usList.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:32px;text-align:center;color:#94a3b8;">
      <i class="fa-solid fa-users" style="font-size:24px;display:block;margin-bottom:8px;opacity:0.4;"></i>
      사용자가 없습니다.
    </td></tr>`;
    return;
  }

  const userMap = Object.fromEntries(_usList.map(u => [u.id, u.name]));

  tbody.innerHTML = _usList.map(u => {
    const approverName = userMap[u.approver_id] || '-';
    const pwAge = u.pw_changed_at
      ? Math.floor((Date.now() - new Date(u.pw_changed_at).getTime()) / 86400000)
      : null;
    const pwBadge = pwAge === null
      ? '<span class="badge badge-secondary">미변경</span>'
      : pwAge > 90
        ? `<span class="badge badge-danger">${pwAge}일</span>`
        : `<span class="badge badge-success">${pwAge}일</span>`;

    return `<tr data-user-id="${u.id}">
      <td>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:32px;height:32px;border-radius:50%;background:${_usAvatarColor(u.name)};
            display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;flex-shrink:0;">
            ${(u.name || '?').charAt(0)}
          </div>
          <div>
            <div style="font-size:13px;font-weight:600;color:#1e293b;">${Utils.escHtml(u.name || '-')}</div>
            <div style="font-size:11px;color:#94a3b8;">${Utils.escHtml(u.email || '')}</div>
          </div>
        </div>
      </td>
      <td style="text-align:center;">${Utils.roleBadge(u.role)}</td>
      <td style="text-align:center;font-size:12px;color:#64748b;">${Utils.escHtml(u.department || '-')}</td>
      <td style="text-align:center;font-size:12px;color:#64748b;">${Utils.escHtml(approverName)}</td>
      <td style="text-align:center;">${pwBadge}</td>
      <td style="text-align:center;">
        <span class="badge ${u.is_active !== false ? 'badge-success' : 'badge-secondary'}">
          ${u.is_active !== false ? '활성' : '비활성'}
        </span>
      </td>
      <td style="text-align:center;font-size:11px;color:#94a3b8;">
        ${u.last_login_at ? Utils.formatDatetime(u.last_login_at) : '-'}
      </td>
      <td style="text-align:center;white-space:nowrap;">
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;"
          onclick="openUserModal('${u.id}')">
          <i class="fa-solid fa-pen"></i> 수정
        </button>
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:#d97706;"
          onclick="resetUserPw('${u.id}','${Utils.escHtml(u.name)}')">
          <i class="fa-solid fa-key"></i>
        </button>
        ${u.id !== _usSession.userId ? `
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:#dc2626;"
          onclick="toggleUserActive('${u.id}','${Utils.escHtml(u.name)}',${u.is_active !== false})">
          <i class="fa-solid fa-${u.is_active !== false ? 'ban' : 'circle-check'}"></i>
        </button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

/* ── 아바타 색상 ── */
function _usAvatarColor(name) {
  const colors = ['#2d6bb5','#7c3aed','#0891b2','#16a34a','#d97706','#db2777','#dc2626','#64748b'];
  const idx = (name || '').charCodeAt(0) % colors.length;
  return colors[idx];
}

/* ── 페이지네이션 ── */
function _renderUsPagination() {
  const wrap = document.getElementById('us-pagination');
  if (!wrap) return;
  wrap.innerHTML = Utils.paginationHTML(_usPage, Math.ceil(_usTotal / US_PAGE_SIZE), 'usGoPage');
  const info = document.getElementById('us-count-info');
  if (info) info.textContent = `총 ${_usTotal}명`;
}
window.usGoPage = (p) => { _usPage = p; _loadUsers(); };

/* ── 스켈레톤 ── */
function _usSkeleton(n) {
  return Array(n).fill(0).map(() =>
    `<tr>${Array(8).fill(0).map(() =>
      `<td style="padding:12px 8px;">
        <div style="height:14px;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);
          background-size:200% 100%;animation:arch-shimmer 1.4s infinite;border-radius:4px;"></div>
      </td>`).join('')}</tr>`).join('');
}
/* ══════════════════════════════════════════════
   사용자 모달 (추가/수정)
══════════════════════════════════════════════ */
async function openUserModal(id = null) {
  let data = {};
  if (id) {
    const r = await API.get('users', id);
    data = r?.data ?? r ?? {};
  }

  /* 결재자 목록 (manager, director, admin) */
  const approverR = await API.list('users', { limit: 200 });
  const approvers = (approverR?.data ?? []).filter(u =>
    ['manager','director','admin'].includes(u.role) && u.id !== id
  );

  /* 팀 목록 */
  const teamR = await API.list('teams', { limit: 100, sort: 'name' });
  const teams = teamR?.data ?? [];

  const overlay = document.createElement('div');
  overlay.id = '_us-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

  const approverOpts = [
    '<option value="">결재자 선택</option>',
    ...approvers.map(u => `<option value="${u.id}" ${data.approver_id === u.id ? 'selected' : ''}>${Utils.escHtml(u.name)} (${ROLE_LABEL[u.role]||u.role})</option>`)
  ].join('');

  const teamOpts = [
    '<option value="">팀 선택</option>',
    ...teams.map(t => `<option value="${t.id}" ${data.team_id === t.id ? 'selected' : ''}>${Utils.escHtml(t.name)}</option>`)
  ].join('');

  const roleOpts = ['staff','manager','director','admin'].map(r =>
    `<option value="${r}" ${data.role === r ? 'selected' : ''}>${ROLE_LABEL[r]||r}</option>`
  ).join('');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:26px;width:520px;max-width:93vw;
      max-height:88vh;overflow-y:auto;box-shadow:0 24px 70px rgba(0,0,0,0.22);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 style="font-size:16px;font-weight:700;color:#1e293b;margin:0;">
          <i class="fa-solid fa-user-${id ? 'pen' : 'plus'}" style="color:#2d6bb5;margin-right:8px;"></i>
          ${id ? '사용자 수정' : '사용자 추가'}
        </h3>
        <button id="_us-close" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer;">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="form-group">
          <label class="form-label">이름 <span style="color:#dc2626;">*</span></label>
          <input type="text" id="_us-name" class="form-control" value="${Utils.escHtml(data.name||'')}" placeholder="홍길동">
        </div>
        <div class="form-group">
          <label class="form-label">이메일 <span style="color:#dc2626;">*</span></label>
          <input type="email" id="_us-email" class="form-control" value="${Utils.escHtml(data.email||'')}" placeholder="user@example.com">
        </div>
        <div class="form-group">
          <label class="form-label">역할 <span style="color:#dc2626;">*</span></label>
          <select id="_us-role" class="form-control">${roleOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">부서</label>
          <input type="text" id="_us-dept" class="form-control" value="${Utils.escHtml(data.department||'')}" placeholder="법무팀">
        </div>
        <div class="form-group">
          <label class="form-label">직책</label>
          <input type="text" id="_us-position" class="form-control" value="${Utils.escHtml(data.position||'')}" placeholder="팀장">
        </div>
        <div class="form-group">
          <label class="form-label">연락처</label>
          <input type="text" id="_us-phone" class="form-control" value="${Utils.escHtml(data.phone||'')}" placeholder="010-0000-0000">
        </div>
        <div class="form-group">
          <label class="form-label">팀</label>
          <select id="_us-team" class="form-control">${teamOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">결재자 (1차)</label>
          <select id="_us-approver" class="form-control">${approverOpts}</select>
        </div>
        ${!id ? `
        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">초기 비밀번호 <span style="color:#dc2626;">*</span></label>
          <input type="password" id="_us-pw" class="form-control" placeholder="8자 이상 입력">
          <div style="font-size:11px;color:#94a3b8;margin-top:4px;">영문+숫자+특수문자 조합 권장</div>
        </div>` : ''}
        <div class="form-group" style="grid-column:1/-1;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="_us-active" ${data.is_active !== false ? 'checked' : ''}
              style="width:16px;height:16px;">
            <span style="font-size:13px;color:#334155;font-weight:500;">계정 활성화</span>
          </label>
        </div>
      </div>

      <div id="_us-err" style="color:#dc2626;font-size:12px;margin-top:8px;display:none;"></div>

      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9;">
        <button id="_us-cancel" class="btn btn-outline">취소</button>
        <button id="_us-save" class="btn btn-primary">
          <i class="fa-solid fa-floppy-disk"></i> 저장
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
  overlay.querySelector('#_us-close').onclick  = close;
  overlay.querySelector('#_us-cancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function _esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', _esc); }
  });

  overlay.querySelector('#_us-save').onclick = async () => {
    const errEl   = overlay.querySelector('#_us-err');
    const saveBtn = overlay.querySelector('#_us-save');
    errEl.style.display = 'none';

    const name  = overlay.querySelector('#_us-name').value.trim();
    const email = overlay.querySelector('#_us-email').value.trim();
    const role  = overlay.querySelector('#_us-role').value;
    const pw    = overlay.querySelector('#_us-pw')?.value || '';

    if (!name)  { errEl.textContent = '이름을 입력하세요.';   errEl.style.display=''; return; }
    if (!email) { errEl.textContent = '이메일을 입력하세요.'; errEl.style.display=''; return; }
    if (!id && !pw) { errEl.textContent = '비밀번호를 입력하세요.'; errEl.style.display=''; return; }
    if (!id && pw.length < 8) { errEl.textContent = '비밀번호는 8자 이상이어야 합니다.'; errEl.style.display=''; return; }

    const payload = {
      name,
      email,
      role,
      department: overlay.querySelector('#_us-dept').value.trim(),
      position:   overlay.querySelector('#_us-position').value.trim(),
      phone:      overlay.querySelector('#_us-phone').value.trim(),
      team_id:    overlay.querySelector('#_us-team').value || null,
      approver_id:overlay.querySelector('#_us-approver').value || null,
      is_active:  overlay.querySelector('#_us-active').checked,
    };

    if (!id && pw) {
      payload.password_hash = await Utils.hashPassword(pw);
      payload.pw_changed_at = new Date().toISOString();
    }

    const restore = BtnLoading.start(saveBtn, '저장 중…');
    try {
      if (id) {
        await API.update('users', id, payload);
        Toast.success('사용자 정보가 수정되었습니다.');
      } else {
        await API.create('users', payload);
        Toast.success('사용자가 추가되었습니다.');
      }
      Master.invalidate('users');
      close();
      await _loadUsers();
    } catch (err) {
      console.error('[users] 저장 오류:', err);
      errEl.textContent = '저장 중 오류가 발생했습니다.';
      errEl.style.display = '';
    } finally {
      restore();
    }
  };

  setTimeout(() => overlay.querySelector('#_us-name')?.focus(), 80);
}
window.openUserModal = openUserModal;

/* ══════════════════════════════════════════════
   비밀번호 초기화
══════════════════════════════════════════════ */
async function resetUserPw(id, name) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:400px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
      <h3 style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:14px;">
        <i class="fa-solid fa-key" style="color:#d97706;"></i> 비밀번호 초기화
      </h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:14px;">"${Utils.escHtml(name)}" 사용자의 비밀번호를 초기화합니다.</p>
      <div class="form-group">
        <label class="form-label">새 비밀번호 <span style="color:#dc2626;">*</span></label>
        <input type="password" id="_pw-new" class="form-control" placeholder="8자 이상">
      </div>
      <div class="form-group">
        <label class="form-label">비밀번호 확인 <span style="color:#dc2626;">*</span></label>
        <input type="password" id="_pw-confirm" class="form-control" placeholder="동일하게 입력">
      </div>
      <div id="_pw-err" style="color:#dc2626;font-size:12px;margin-bottom:8px;display:none;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
        <button id="_pw-cancel" class="btn btn-outline">취소</button>
        <button id="_pw-save" class="btn btn-warning">
          <i class="fa-solid fa-key"></i> 초기화
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
  overlay.querySelector('#_pw-cancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#_pw-save').onclick = async () => {
    const errEl  = overlay.querySelector('#_pw-err');
    const newPw  = overlay.querySelector('#_pw-new').value;
    const confPw = overlay.querySelector('#_pw-confirm').value;
    errEl.style.display = 'none';

    if (!newPw || newPw.length < 8) { errEl.textContent = '8자 이상 입력하세요.'; errEl.style.display=''; return; }
    if (newPw !== confPw)           { errEl.textContent = '비밀번호가 일치하지 않습니다.'; errEl.style.display=''; return; }

    const btn = overlay.querySelector('#_pw-save');
    const restore = BtnLoading.start(btn, '처리 중…');
    try {
      const hash = await Utils.hashPassword(newPw);
      await API.patch('users', id, {
        password_hash: hash,
        pw_changed_at: new Date().toISOString(),
      });
      Toast.success(`${name} 님의 비밀번호가 초기화되었습니다.`);
      close();
    } catch (err) {
      errEl.textContent = '오류가 발생했습니다.';
      errEl.style.display = '';
    } finally {
      restore();
    }
  };

  setTimeout(() => overlay.querySelector('#_pw-new')?.focus(), 80);
}
window.resetUserPw = resetUserPw;
/* ══════════════════════════════════════════════
   계정 활성/비활성 토글
══════════════════════════════════════════════ */
async function toggleUserActive(id, name, currentActive) {
  const action = currentActive ? '비활성화' : '활성화';
  const ok = await Confirm.show({
    title: `계정 ${action}`,
    message: `"${name}" 계정을 ${action}하시겠습니까?`,
    confirmText: action,
    confirmClass: currentActive ? 'btn-danger' : 'btn-success'
  });
  if (!ok) return;

  try {
    await API.patch('users', id, { is_active: !currentActive });
    Toast.success(`${name} 계정이 ${action}되었습니다.`);
    Master.invalidate('users');
    await _loadUsers();
  } catch (err) {
    Toast.error(`${action} 중 오류가 발생했습니다.`);
  }
}
window.toggleUserActive = toggleUserActive;

/* ══════════════════════════════════════════════
   Excel 내보내기
══════════════════════════════════════════════ */
async function exportUsersExcel() {
  const btn = document.getElementById('us-export-btn');
  const restore = BtnLoading.start(btn, '내보내는 중…');

  try {
    const r = await API.list('users', { limit: 500, sort: 'name' });
    const users = r?.data ?? [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

    const STATUS_LABEL = { staff: '직원', manager: '매니저', director: '임원', admin: '관리자' };

    const data = [
      ['이름', '이메일', '역할', '부서', '직책', '연락처', '결재자', '계정상태', '마지막로그인', '비밀번호변경일']
    ];

    users.forEach(u => {
      data.push([
        u.name || '',
        u.email || '',
        STATUS_LABEL[u.role] || u.role || '',
        u.department || '',
        u.position || '',
        u.phone || '',
        userMap[u.approver_id] || '',
        u.is_active !== false ? '활성' : '비활성',
        u.last_login_at ? Utils.formatDatetime(u.last_login_at) : '',
        u.pw_changed_at ? Utils.formatDatetime(u.pw_changed_at) : '',
      ]);
    });

    await Utils.xlsxDownload(data, `사용자목록_${Utils.todayStr()}.xlsx`, '사용자');
    Toast.success(`${users.length}명 내보내기 완료`);
  } catch (err) {
    Toast.error('내보내기 중 오류가 발생했습니다.');
  } finally {
    restore();
  }
}
window.exportUsersExcel = exportUsersExcel;

/* ══════════════════════════════════════════════
   Excel 가져오기 (일괄 등록)
══════════════════════════════════════════════ */
async function importUsersExcel() {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.xlsx,.xls';

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    try {
      const rows = await Utils.parseExcel(file);
      if (!rows || rows.length < 2) { Toast.error('데이터가 없습니다.'); return; }

      const ok = await Confirm.show({
        title: '일괄 등록',
        message: `${rows.length - 1}명을 등록하시겠습니까?\n초기 비밀번호: smartlog2024!`,
        confirmText: '등록',
        confirmClass: 'btn-primary'
      });
      if (!ok) return;

      const defaultPwHash = await Utils.hashPassword('smartlog2024!');
      let success = 0;
      const errors = [];

      for (const row of rows.slice(1)) {
        const name  = String(row[0] || '').trim();
        const email = String(row[1] || '').trim();
        const role  = String(row[2] || 'staff').trim().toLowerCase();

        if (!name || !email) continue;

        try {
          await API.create('users', {
            name,
            email,
            role:          ['staff','manager','director','admin'].includes(role) ? role : 'staff',
            department:    String(row[3] || '').trim(),
            position:      String(row[4] || '').trim(),
            phone:         String(row[5] || '').trim(),
            password_hash: defaultPwHash,
            pw_changed_at: new Date().toISOString(),
            is_active:     true,
          });
          success++;
        } catch (e) {
          errors.push(name);
        }
      }

      Master.invalidate('users');
      Toast.success(`${success}명 등록 완료${errors.length ? ` (실패: ${errors.join(', ')})` : ''}`);
      await _loadUsers();
    } catch (err) {
      Toast.error('가져오기 중 오류 발생');
    }
  };
  input.click();
}
window.importUsersExcel = importUsersExcel;

/* ══════════════════════════════════════════════
   사용자 통계
══════════════════════════════════════════════ */
async function renderUserStats() {
  const wrap = document.getElementById('us-stats-wrap');
  if (!wrap) return;

  wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i></div>';

  try {
    const r = await API.list('users', { limit: 500 });
    const users = r?.data ?? [];

    const byRole = {};
    users.forEach(u => {
      byRole[u.role] = (byRole[u.role] || 0) + 1;
    });

    const active   = users.filter(u => u.is_active !== false).length;
    const inactive = users.length - active;
    const pwExpired = users.filter(u => {
      if (!u.pw_changed_at) return true;
      const days = Math.floor((Date.now() - new Date(u.pw_changed_at).getTime()) / 86400000);
      return days > 90;
    }).length;

    const ROLE_COLOR = {
      staff: '#2d6bb5', manager: '#7c3aed',
      director: '#0891b2', admin: '#dc2626'
    };

    const roleCards = Object.entries(byRole).map(([role, cnt]) => `
      <div class="kpi-card" style="border-top:3px solid ${ROLE_COLOR[role]||'#94a3b8'};">
        <div class="kpi-body">
          <div class="kpi-label">${ROLE_LABEL[role]||role}</div>
          <div class="kpi-value" style="color:${ROLE_COLOR[role]||'#94a3b8'};">${cnt}명</div>
        </div>
      </div>`).join('');

    /* 최근 로그인 없는 사용자 */
    const neverLogin = users.filter(u => !u.last_login_at).length;
    const oldLogin   = users.filter(u => {
      if (!u.last_login_at) return false;
      const days = Math.floor((Date.now() - new Date(u.last_login_at).getTime()) / 86400000);
      return days > 30;
    }).length;

    wrap.innerHTML = `
      <div style="margin-bottom:16px;">
        <div class="kpi-grid">
          <div class="kpi-card" style="border-top:3px solid #16a34a;">
            <div class="kpi-body">
              <div class="kpi-label">전체 사용자</div>
              <div class="kpi-value">${users.length}명</div>
              <div class="kpi-sub">활성 ${active} / 비활성 ${inactive}</div>
            </div>
          </div>
          <div class="kpi-card" style="border-top:3px solid #dc2626;">
            <div class="kpi-body">
              <div class="kpi-label">비밀번호 만료</div>
              <div class="kpi-value" style="color:#dc2626;">${pwExpired}명</div>
              <div class="kpi-sub">90일 초과</div>
            </div>
          </div>
          <div class="kpi-card" style="border-top:3px solid #d97706;">
            <div class="kpi-body">
              <div class="kpi-label">미로그인</div>
              <div class="kpi-value" style="color:#d97706;">${neverLogin}명</div>
              <div class="kpi-sub">로그인 이력 없음</div>
            </div>
          </div>
          <div class="kpi-card" style="border-top:3px solid #94a3b8;">
            <div class="kpi-body">
              <div class="kpi-label">30일 미접속</div>
              <div class="kpi-value" style="color:#94a3b8;">${oldLogin}명</div>
              <div class="kpi-sub">장기 미접속</div>
            </div>
          </div>
        </div>
      </div>
      <div style="margin-bottom:8px;font-size:12px;color:#64748b;font-weight:600;">역할별 현황</div>
      <div class="kpi-grid">${roleCards}</div>`;
  } catch (err) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#dc2626;">통계 로드 실패</div>';
  }
}
window.renderUserStats = renderUserStats;

/* ══════════════════════════════════════════════
   외부 노출
══════════════════════════════════════════════ */
window.init_users        = init_users;
window.openUserModal     = openUserModal;
window.toggleUserActive  = toggleUserActive;
window.resetUserPw       = resetUserPw;
window.exportUsersExcel  = exportUsersExcel;
window.importUsersExcel  = importUsersExcel;
window.renderUserStats   = renderUserStats;
window.usGoPage          = usGoPage;
