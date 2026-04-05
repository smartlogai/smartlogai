/* ============================================
   users.js — 직원 관리
   ============================================
   DB 필드 기준:
   - users: department_id, dept_name, hq_id, hq_name,
            cs_team_id, cs_team_name, team_name,
            approver_id, approver_name,       ← 1차 승인자 (Manager/팀장) — staff 전용
            reviewer2_id, reviewer2_name,     ← 2차 승인자 (Director/본부장) — staff·manager 공통
            role, is_active, is_timesheet_target
   - departments: id, department_name
   - headquarters: id, hq_name, dept_id, dept_name
   - cs_teams: id, cs_team_name, dept_id, dept_name, hq_id, hq_name
   - teams: id, team_name
   ============================================ */

// ─────────────────────────────────────────────
// 역할 변경 시 관련 필드 표시/숨김
// ─────────────────────────────────────────────
function _onUserRoleChange(role) {
  const isStaff       = role === 'staff';
  const isManager     = role === 'manager';
  const isStaffLike   = isStaff || isManager; // 타임시트 작성 가능 역할

  // 1차 승인자 드롭다운: staff만 (팀장에게 1차 승인받음)
  const approverWrap = document.getElementById('approver-select-wrap');
  if (approverWrap) approverWrap.style.display = isStaff ? '' : 'none';

  // 2차 승인자 드롭다운: staff + manager 모두 (본부장에게 최종 승인받음)
  const reviewer2Wrap = document.getElementById('reviewer2-select-wrap');
  if (reviewer2Wrap) reviewer2Wrap.style.display = isStaffLike ? '' : 'none';

  // 고객지원팀: staff/manager만
  const csTeamWrap = document.getElementById('csteam-select-wrap');
  if (csTeamWrap) csTeamWrap.style.display = isStaffLike ? '' : 'none';

  // 타임시트 대상자 체크박스: staff + manager 모두 표시
  const tsTargetWrap  = document.getElementById('timesheet-target-wrap');
  const tsTargetInput = document.getElementById('user-timesheet-target-input');
  if (tsTargetWrap) tsTargetWrap.style.display = isStaffLike ? '' : 'none';
  if (tsTargetInput && !isStaffLike) tsTargetInput.checked = false;

  // 사업부/본부는 항상 표시
}

// ─────────────────────────────────────────────
// 입력 UI 전체 초기화 (모달 열 때)
// ─────────────────────────────────────────────
function _resetAffiliationUI() {
  ['user-dept-input', 'user-hq-input', 'user-csteam-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = ''; el.disabled = false; }
  });
}

// ─────────────────────────────────────────────
// 사업부 드롭다운 채우기
// ─────────────────────────────────────────────
async function _fillUserDeptSelect(selectedId = '') {
  const el = document.getElementById('user-dept-input');
  if (!el) return;
  el.innerHTML = '<option value="">사업부 선택</option>';
  try {
    const r = await API.list('departments', { limit: 200 });
    const depts = (r && r.data) ? r.data.filter(d => !d.hq_name) : [];
    depts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.department_name;
      opt.dataset.name = d.department_name;
      if (d.id === selectedId) opt.selected = true;
      el.appendChild(opt);
    });
  } catch(e) { console.warn('사업부 드롭다운 로드 실패', e); }
}

// ─────────────────────────────────────────────
// 본부 드롭다운 채우기 (headquarters 테이블 사용)
// ─────────────────────────────────────────────
async function _fillUserHqSelect(selectedId = '', deptId = '') {
  const el = document.getElementById('user-hq-input');
  if (!el) return;
  el.innerHTML = '<option value="">본부 선택</option>';
  el.disabled = !deptId;
  if (!deptId) return;
  try {
    const r = await API.list('headquarters', { limit: 200 });
    const hqs = (r && r.data) ? r.data.filter(h => h.dept_id === deptId) : [];
    hqs.forEach(h => {
      const opt = document.createElement('option');
      opt.value = h.id;
      opt.textContent = h.hq_name;
      opt.dataset.name = h.hq_name;
      if (h.id === selectedId) opt.selected = true;
      el.appendChild(opt);
    });
  } catch(e) { console.warn('본부 드롭다운 로드 실패', e); }
}

// ─────────────────────────────────────────────
// 고객지원팀 드롭다운 채우기
// ─────────────────────────────────────────────
async function _fillUserCsTeamSelect(selectedId = '', deptId = '', hqId = '') {
  const el = document.getElementById('user-csteam-input');
  if (!el) return;
  el.innerHTML = '<option value="">고객지원팀 선택</option>';
  try {
    const r = await API.list('cs_teams', { limit: 200 });
    const teams = (r && r.data) ? r.data : [];
    teams
      .filter(t =>
        (!deptId || t.dept_id === deptId) &&
        (!hqId   || t.hq_id  === hqId)
      )
      .forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.cs_team_name;
        opt.dataset.name   = t.cs_team_name;
        opt.dataset.deptId = t.dept_id   || '';
        opt.dataset.hqId   = t.hq_id     || '';
        if (t.id === selectedId) opt.selected = true;
        el.appendChild(opt);
      });
  } catch(e) { console.warn('고객지원팀 드롭다운 로드 실패', e); }
}

// 업무팀 드롭다운은 직원 등록에서 제거됨
// (타임시트 작성 시 직접 선택 → entry.js entry-team 드롭다운 사용)

// ─────────────────────────────────────────────
// 사업부 선택 시 → 본부 + 고객지원팀 연동
// ─────────────────────────────────────────────
async function onUserDeptChange() {
  const deptEl = document.getElementById('user-dept-input');
  const deptId = deptEl ? deptEl.value : '';
  await _fillUserHqSelect('', deptId);
  await _fillUserCsTeamSelect('', deptId, '');
}

// 본부 선택 시 → 고객지원팀 필터 연동
async function onUserHqChange() {
  const deptEl = document.getElementById('user-dept-input');
  const hqEl   = document.getElementById('user-hq-input');
  const deptId = deptEl ? deptEl.value : '';
  const hqId   = hqEl   ? hqEl.value  : '';
  await _fillUserCsTeamSelect('', deptId, hqId);
}

// ─────────────────────────────────────────────
// init: 직원 관리 페이지 초기화
// ─────────────────────────────────────────────
async function init_users() {
  const session = getSession();
  if (!Auth.canManageMaster(session)) {
    navigateTo('dashboard');
    Toast.warning('직원 관리 권한이 없습니다.');
    return;
  }
  await loadUsers();
}

// ─────────────────────────────────────────────
// 직원 목록 렌더링
// ─────────────────────────────────────────────
async function loadUsers() {
  Master.invalidate('users');
  const users = await Master.users();
  const tbody = document.getElementById('users-body');
  if (!tbody) return;

  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty"><i class="fas fa-user-slash"></i><p>등록된 직원이 없습니다.</p></td></tr>`;
    return;
  }

  tbody.innerHTML = users.map((u, i) => {
    // ── 역할 배지 ──────────────────────────────────────────
    const roleBadge = Utils.roleBadge(u.role);

    // ── 각 필드 이스케이프 ─────────────────────────────────
    const nameEsc   = Utils.escHtml(u.name  || '');
    const emailEsc  = Utils.escHtml(u.email || '');
    const deptEsc   = Utils.escHtml(u.dept_name    || '');
    const hqEsc     = Utils.escHtml(u.hq_name      || '');
    const csEsc     = Utils.escHtml(u.cs_team_name || '');

    const noPwWarn = '';

    // ── 본부 셀: 본부명 + (고객지원팀 있을 때 작게 아래) ──
    const hqCell = hqEsc
      ? `<div style="font-size:12.5px;font-weight:500;color:var(--text-primary);
                     white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
              title="${hqEsc}${csEsc ? ' › ' + csEsc : ''}">${hqEsc}${
          csEsc
            ? `<span style="display:block;font-size:10.5px;color:var(--text-muted);
                            font-weight:400;margin-top:1px;
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${csEsc}</span>`
            : ''
        }</div>`
      : `<span style="color:var(--text-muted);font-size:12px">—</span>`;

    // ── 1차 승인자 배지 (staff 전용 — manager/팀장) ──────────────────
    const approverHtml = u.approver_name
      ? `<span style="display:inline-flex;align-items:center;gap:3px;
                      background:#eff6ff;color:#2563eb;
                      border:1px solid #bfdbfe;border-radius:20px;
                      padding:3px 8px;font-size:11px;font-weight:500;
                      white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis"
              title="${Utils.escHtml(u.approver_name)}">
           <i class="fas fa-user-check" style="font-size:9px;flex-shrink:0"></i>
           ${Utils.escHtml(u.approver_name)}
         </span>`
      : `<span style="color:var(--text-muted);font-size:13px">—</span>`;

    // ── 2차 승인자 배지 (staff·manager 공통 — director/본부장) ─────
    const reviewer2Html = u.reviewer2_name
      ? `<span style="display:inline-flex;align-items:center;gap:3px;
                      background:#faf5ff;color:#7c3aed;
                      border:1px solid #ddd6fe;border-radius:20px;
                      padding:3px 8px;font-size:11px;font-weight:500;
                      white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis"
              title="${Utils.escHtml(u.reviewer2_name)}">
           <i class="fas fa-user-shield" style="font-size:9px;flex-shrink:0"></i>
           ${Utils.escHtml(u.reviewer2_name)}
         </span>`
      : `<span style="color:var(--text-muted);font-size:13px">—</span>`;

    // ── 타임시트 대상 배지 ────────────────────────────────
    // is_timesheet_target: true/'true' → 대상, false/'false' → 비대상, undefined/null → 대상(기본)
    const isStaffLike = u.role === 'staff' || u.role === 'manager';
    const rawTs       = u.is_timesheet_target;
    const isTs        = rawTs !== false && rawTs !== 'false';
    const tsBadge = isStaffLike
      ? (isTs
          ? `<span style="display:inline-flex;align-items:center;gap:3px;
                          background:#f0fdf4;color:#16a34a;
                          border:1px solid #bbf7d0;border-radius:20px;
                          padding:2px 6px;font-size:10px;font-weight:600;
                          white-space:nowrap"
                title="타임시트 기록 대상">
               <i class="fas fa-clock" style="font-size:8px"></i>&nbsp;대상
             </span>`
          : '')
      : '';

    // ── 비활성 직원 스타일 ─────────────────────────────────
    const inactive   = u.is_active === false;
    const rowOpacity = inactive ? 'opacity:0.55;' : '';
    const nameColor  = inactive ? 'color:var(--text-muted);' : 'color:var(--text-primary);';

    return `
    <tr style="height:${tsBadge ? '60px' : '52px'};${rowOpacity}">

      <!-- 1. No -->
      <td style="text-align:center;color:var(--text-muted);font-size:12px;
                 padding:0 6px;font-variant-numeric:tabular-nums">${i + 1}</td>

      <!-- 2. 이름 (아바타 + 이름) -->
      <td style="padding:0 10px;overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <div class="user-avatar"
               style="width:30px;height:30px;font-size:12px;flex-shrink:0;
                      ${inactive ? 'opacity:0.45' : ''}">
            ${getInitial(u.name)}
          </div>
          <div style="min-width:0">
            <div style="font-weight:600;font-size:13px;${nameColor}
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${nameEsc}
              ${inactive ? '<span style="font-size:10px;color:var(--text-muted);font-weight:400;margin-left:3px">(퇴직)</span>' : ''}
              ${noPwWarn}
            </div>
            ${tsBadge ? `<div style="margin-top:3px;overflow:visible">${tsBadge}</div>` : ''}
          </div>
        </div>
      </td>

      <!-- 3. 이메일 (flex:1 — 남은 공간) -->
      <td style="padding:0 10px;overflow:hidden">
        <span style="font-size:11.5px;color:var(--text-muted);
                     white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                     display:block" title="${emailEsc}">${emailEsc}</span>
      </td>

      <!-- 4. 역할 -->
      <td style="text-align:center;padding:0 4px">${roleBadge}</td>

      <!-- 5. 사업부 -->
      <td style="padding:0 10px;overflow:hidden">
        ${deptEsc
          ? `<span style="font-size:12px;font-weight:500;color:var(--text-secondary);
                          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                          display:block" title="${deptEsc}">${deptEsc}</span>`
          : `<span style="color:var(--text-muted);font-size:12px">—</span>`}
      </td>

      <!-- 6. 본부 (+고객지원팀 서브) -->
      <td style="padding:0 10px;overflow:hidden">${hqCell}</td>

      <!-- 7. 1차 승인자 -->
      <td style="text-align:center;padding:0 6px">${approverHtml}</td>

      <!-- 8. 2차 승인자 -->
      <td style="text-align:center;padding:0 6px">${reviewer2Html}</td>

      <!-- 9. 관리 -->
      <td style="text-align:center;padding:0 6px">
        <div style="display:inline-flex;gap:2px;align-items:center">
          <button class="btn btn-sm btn-ghost btn-icon"
                  onclick="openUserModal('${u.id}')"
                  title="수정"
                  style="width:28px;height:28px;padding:0;display:inline-flex;
                         align-items:center;justify-content:center;border-radius:6px">
            <i class="fas fa-pen" style="color:var(--text-secondary);font-size:11px"></i>
          </button>
          <button class="btn btn-sm btn-ghost btn-icon"
                  onclick="deleteUser('${u.id}','${(u.name||'').replace(/'/g,"\\'").replace(/"/g,'&quot;')}','${u.email||''}')"
                  title="삭제"
                  style="width:28px;height:28px;padding:0;display:inline-flex;
                         align-items:center;justify-content:center;border-radius:6px">
            <i class="fas fa-trash" style="color:var(--danger);font-size:11px"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ─────────────────────────────────────────────
// 1차 승인자(Manager) 드롭다운 채우기 — staff 전용
// ─────────────────────────────────────────────
async function fillApproverSelect(excludeUserId = '', selectedApproverId = '') {
  const el = document.getElementById('user-approver-input');
  if (!el) return;

  const users = await Master.users();
  const approvers = users.filter(u =>
    u.role === 'manager' &&
    u.is_active !== false &&
    u.id !== excludeUserId
  );

  el.innerHTML = '<option value="">1차 승인자 선택 (미지정)</option>';
  approvers.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `${u.name} (팀장)`;
    opt.dataset.name = u.name;
    if (u.id === selectedApproverId) opt.selected = true;
    el.appendChild(opt);
  });
}

// ─────────────────────────────────────────────
// 2차 승인자(Director) 드롭다운 채우기 — staff·manager 공통
// ─────────────────────────────────────────────
async function fillReviewer2Select(excludeUserId = '', selectedReviewer2Id = '') {
  const el = document.getElementById('user-reviewer2-input');
  if (!el) return;

  const users = await Master.users();
  const directors = users.filter(u =>
    u.role === 'director' &&
    u.is_active !== false &&
    u.id !== excludeUserId
  );

  el.innerHTML = '<option value="">2차 승인자 선택 (미지정)</option>';
  directors.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `${u.name} (본부장)`;
    opt.dataset.name = u.name;
    if (u.id === selectedReviewer2Id) opt.selected = true;
    el.appendChild(opt);
  });
}

// ─────────────────────────────────────────────
// 직원 추가/수정 모달 열기
// ─────────────────────────────────────────────
async function openUserModal(userId = '') {
  document.getElementById('user-edit-id').value          = userId;
  document.getElementById('user-name-input').value       = '';
  document.getElementById('user-email-input').value      = '';
  document.getElementById('user-pw-input').value         = '';
  document.getElementById('user-pw-confirm-input').value = '';
  document.getElementById('user-role-input').value       = 'staff';
  document.getElementById('user-active-input').value     = 'true';
  const tsTargetEl = document.getElementById('user-timesheet-target-input');
  if (tsTargetEl) tsTargetEl.checked = true; // 신규 직원 기본값: 타임시트 대상
  document.getElementById('userModalError').style.display = 'none';
  _onUserRoleChange('staff');
  _resetAffiliationUI();

  // 드롭다운 초기화
  await _fillUserDeptSelect('');
  const hqEl = document.getElementById('user-hq-input');
  if (hqEl) { hqEl.innerHTML = '<option value="">사업부 선택 후 본부 선택 가능</option>'; hqEl.disabled = true; }
  const csEl = document.getElementById('user-csteam-input');
  if (csEl) csEl.innerHTML = '<option value="">고객지원팀 선택</option>';
  await fillApproverSelect('', '');
  await fillReviewer2Select('', '');

  if (userId) {
    document.getElementById('userModalTitle').textContent = '직원 정보 수정';
    const pwReq = document.getElementById('pwRequired');
    const pwOpt = document.getElementById('pwOptional');
    if (pwReq) pwReq.style.display = 'none';
    if (pwOpt) pwOpt.style.display = '';
    try {
      const user = await API.get('users', userId);
      if (user) {
        document.getElementById('user-name-input').value  = user.name  || '';
        document.getElementById('user-email-input').value = user.email || '';
        const role = user.role || 'staff';
        document.getElementById('user-role-input').value   = role;
        document.getElementById('user-active-input').value = String(user.is_active !== false);
        _onUserRoleChange(role);

        // 사업부 → 본부 → 고객지원팀 순서로 연동
        const deptId = user.dept_id || user.department_id || '';
        const hqId   = user.hq_id  || '';

        await _fillUserDeptSelect(deptId);
        await _fillUserHqSelect(hqId, deptId);
        await _fillUserCsTeamSelect(user.cs_team_id || '', deptId, hqId);

        // 1차 승인자 (staff만 표시이지만 데이터는 항상 로드)
        await fillApproverSelect(userId, user.approver_id || '');
        // 2차 승인자 (staff·manager 공통)
        await fillReviewer2Select(userId, user.reviewer2_id || '');

        // 타임시트 기록 대상 여부 (staff·manager 공통, null/undefined → true 기본값)
        const tsEl = document.getElementById('user-timesheet-target-input');
        if (tsEl) tsEl.checked = (user.is_timesheet_target !== false);
      }
    } catch(e) { console.error(e); }
  } else {
    document.getElementById('userModalTitle').textContent = '직원 추가';
    const pwReq = document.getElementById('pwRequired');
    const pwOpt = document.getElementById('pwOptional');
    if (pwReq) pwReq.style.display = '';
    if (pwOpt) pwOpt.style.display = 'none';
  }

  openModal('userModal');
}

// ─────────────────────────────────────────────
// 직원 저장 (추가 / 수정)
// ─────────────────────────────────────────────
async function saveUser() {
  const id      = document.getElementById('user-edit-id').value;
  const name    = document.getElementById('user-name-input').value.trim();
  const email   = document.getElementById('user-email-input').value.trim().toLowerCase();
  const pw      = document.getElementById('user-pw-input').value;
  const pwConfirm = document.getElementById('user-pw-confirm-input').value;
  const role    = document.getElementById('user-role-input').value;
  const isActive = document.getElementById('user-active-input').value === 'true';

  const approverEl   = document.getElementById('user-approver-input');
  const approverId   = approverEl ? approverEl.value : '';
  const approverName = approverId
    ? (approverEl.options[approverEl.selectedIndex]?.dataset.name || '')
    : '';

  const reviewer2El   = document.getElementById('user-reviewer2-input');
  const reviewer2Id   = reviewer2El ? reviewer2El.value : '';
  const reviewer2Name = reviewer2Id
    ? (reviewer2El.options[reviewer2El.selectedIndex]?.dataset.name || '')
    : '';

  // 타임시트 기록 대상 여부
  const tsTargetInputEl = document.getElementById('user-timesheet-target-input');
  const isTimesheetTarget = tsTargetInputEl ? tsTargetInputEl.checked : true;

  const showErr = (msg) => {
    document.getElementById('userModalErrorText').textContent = msg;
    document.getElementById('userModalError').style.display = 'flex';
  };
  document.getElementById('userModalError').style.display = 'none';

  if (!name)  { showErr('이름을 입력하세요.'); return; }
  if (!email) { showErr('이메일을 입력하세요.'); return; }
  if (!id && !pw) { showErr('비밀번호를 입력하세요.'); return; }
  if (pw && pw.length < 8) { showErr('비밀번호는 8자 이상이어야 합니다.'); return; }
  if (pw && !pwConfirm) { showErr('비밀번호 확인란을 입력하세요.'); return; }
  if (pw && pw !== pwConfirm) { showErr('비밀번호가 일치하지 않습니다.'); return; }

  // 이메일 중복 체크 (신규만)
  if (!id) {
    try {
      const r = await API.list('users', { limit: 500 });
      const users = (r && r.data) ? r.data : [];
      if (users.some(u => u.email && u.email.toLowerCase() === email)) {
        showErr('이미 등록된 이메일입니다.'); return;
      }
    } catch { }
  }

  // ── 소속 정보 수집 ────────────────────────────────────────
  // 1) 사업부
  const deptEl   = document.getElementById('user-dept-input');
  const deptId   = deptEl ? deptEl.value : '';
  const deptName = deptId && deptEl
    ? (deptEl.options[deptEl.selectedIndex]?.dataset.name || '')
    : '';

  // 2) 본부
  const hqEl   = document.getElementById('user-hq-input');
  const hqId   = hqEl ? hqEl.value : '';
  const hqName = hqId && hqEl
    ? (hqEl.options[hqEl.selectedIndex]?.dataset.name || '')
    : '';

  // 3) 고객지원팀
  const csEl   = document.getElementById('user-csteam-input');
  const csId   = csEl ? csEl.value : '';
  const csName = csId && csEl
    ? (csEl.options[csEl.selectedIndex]?.dataset.name || '')
    : '';

  try {
    const data = {
      name,
      email,
      role,
      is_active:            isActive,
      is_timesheet_target:  isTimesheetTarget,
      approver_id:          approverId,
      approver_name:        approverName,
      reviewer2_id:         reviewer2Id,
      reviewer2_name:       reviewer2Name,
      dept_id:       deptId,
      dept_name:     deptName,
      hq_id:         hqId,
      hq_name:       hqName,
      cs_team_id:    csId,
      cs_team_name:  csName,
      // team_name은 타임시트 작성 시 직접 선택 (직원 프로필에 고정 불필요)
    };
    if (pw) {
      data.password      = await Utils.hashPassword(pw);
      data.pw_changed_at = Date.now();
    }

    if (id) {
      // PUT 대신 PATCH 사용 — password 등 미포함 필드가 덮어씌워지는 문제 방지
      await API.patch('users', id, data);
      Toast.success('직원 정보가 수정되었습니다.');
    } else {
      data.pw_changed_at = Date.now();
      await API.create('users', data);
      Toast.success('직원이 추가되었습니다.');
    }
    closeModal('userModal');
    Master.invalidate('users');
    await loadUsers();
  } catch (err) {
    showErr('저장 실패: ' + err.message);
  }
}

// ─────────────────────────────────────────────
// 비밀번호 일괄 초기화
// ─────────────────────────────────────────────
async function openBulkPwModal() {
  // 비밀번호 미설정 계정 조회
  const listEl = document.getElementById('noPwUserList');
  listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:12px"><i class="fas fa-spinner fa-spin"></i> 조회 중...</div>';
  openModal('bulkPwModal');

  try {
    const res   = await API.list('users', { limit: 500 });
    const users = (res && res.data) ? res.data : [];
    const noPwUsers = users.filter(u => !u.password || u.password.trim() === '');

    if (noPwUsers.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;color:#059669;font-size:13px;padding:12px"><i class="fas fa-check-circle"></i> 비밀번호 미설정 계정이 없습니다!</div>';
    } else {
      listEl.innerHTML = noPwUsers.map(u => `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-bottom:1px solid var(--border);font-size:13px">
          <i class="fas fa-exclamation-circle" style="color:#f59e0b;flex-shrink:0"></i>
          <span style="font-weight:600;color:var(--text-primary)">${Utils.escHtml(u.name)}</span>
          <span style="color:var(--text-muted);font-size:12px">${Utils.escHtml(u.email)}</span>
          <span style="margin-left:auto">${Utils.roleBadge(u.role)}</span>
        </div>`).join('');
    }
    // 계정 수 표시
    document.querySelector('#bulkPwModal .modal-title').innerHTML =
      `<i class="fas fa-key" style="color:#f59e0b;margin-right:8px"></i>비밀번호 일괄 초기화 <span style="font-size:13px;color:#f59e0b;font-weight:400">(${noPwUsers.length}명)</span>`;
  } catch(e) {
    listEl.innerHTML = '<div style="color:#ef4444;font-size:13px;padding:8px">조회 실패: ' + e.message + '</div>';
  }
}

async function applyBulkPw() {
  const pw        = document.getElementById('bulkPwInput').value;
  const pwConfirm = document.getElementById('bulkPwConfirm').value;
  const errEl     = document.getElementById('bulkPwError');
  const btn       = document.getElementById('bulkPwBtn');

  errEl.style.display = 'none';

  if (!pw)              { errEl.textContent = '비밀번호를 입력하세요.'; errEl.style.display='block'; return; }
  if (pw.length < 8)   { errEl.textContent = '비밀번호는 8자 이상이어야 합니다.'; errEl.style.display='block'; return; }
  if (pw !== pwConfirm) { errEl.textContent = '비밀번호가 일치하지 않습니다.'; errEl.style.display='block'; return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리 중...';

  try {
    const res   = await API.list('users', { limit: 500 });
    const users = (res && res.data) ? res.data : [];
    const noPwUsers = users.filter(u => !u.password || u.password.trim() === '');

    if (noPwUsers.length === 0) {
      Toast.info('비밀번호 미설정 계정이 없습니다.');
      closeModal('bulkPwModal');
      return;
    }

    const hash = await Utils.hashPassword(pw);
    let success = 0, fail = 0;

    for (const u of noPwUsers) {
      try {
        await API.patch('users', u.id, {
          password: hash,
          pw_changed_at: Date.now()
        });
        success++;
      } catch(e) {
        fail++;
      }
    }

    closeModal('bulkPwModal');
    if (fail === 0) {
      Toast.success(`✅ ${success}명의 비밀번호가 초기화되었습니다. (초기 비밀번호: ${pw})`);
    } else {
      Toast.warning(`${success}명 성공, ${fail}명 실패`);
    }
    await loadUsers();
  } catch(e) {
    errEl.textContent = '오류: ' + e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-key"></i> 일괄 초기화 적용';
  }
}

// ─────────────────────────────────────────────
// 직원 삭제
// ─────────────────────────────────────────────
async function deleteUser(id, name, email) {
  const session = getSession();
  if (session.email === email) {
    Toast.warning('본인 계정은 삭제할 수 없습니다.');
    return;
  }
  const ok = await Confirm.delete(name);
  if (!ok) return;
  try {
    await API.delete('users', id);
    Toast.success('삭제되었습니다.');
    Master.invalidate('users');
    await loadUsers();
  } catch (err) {
    const msg = err && err.message ? err.message : '알 수 없는 오류';
    console.error('[deleteUser] 실패:', msg);
    Toast.error('삭제 실패: ' + msg);
  }
}

// ─────────────────────────────────────────────
// 직원 엑셀 업로드
// 처리 방식:
//  - 신규 직원: 생성 + 승인자 즉시 적용
//  - 기존 직원(이미 DB에 있는 이메일): 권한/승인자 업데이트
// ─────────────────────────────────────────────
function openUserUploadModal() {
  const fileEl = document.getElementById('user-upload-file');
  const resultEl = document.getElementById('user-upload-result');
  if (fileEl) fileEl.value = '';
  if (resultEl) resultEl.style.display = 'none';
  openModal('userUploadModal');
}

async function uploadUsers() {
  const file = document.getElementById('user-upload-file').files[0];
  if (!file) { Toast.warning('파일을 선택하세요.'); return; }

  const btn = document.querySelector('#userUploadModal .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리 중...'; }

  try {
    const rows = await Utils.parseExcel(file);

    const allUsersRes = await API.list('users', { limit: 500 });
    const dbUsers     = (allUsersRes && allUsersRes.data) ? allUsersRes.data : [];

    const emailToUser = {};
    dbUsers.forEach(u => {
      if (u.email) emailToUser[u.email.toLowerCase()] = u;
    });

    const roleMap = {
      '담당자': 'staff', '팀장': 'manager', '책임자': 'director', '관리자': 'admin',
      'staff': 'staff', 'manager': 'manager', 'director': 'director',
      'admin': 'admin', 'administrator': 'admin',
    };

    const parsed = [];
    for (const row of rows) {
      const vals          = Object.values(row);
      const name          = String(row['이름']    || vals[0] || '').trim();
      const email         = String(row['이메일']  || vals[1] || '').trim().toLowerCase();
      const pw            = String(row['비밀번호'] || vals[2] || '').trim();
      const roleRaw       = String(row['권한']    || vals[3] || '').trim();
      const approverEmail = String(row['승인자']  || vals[4] || '').trim().toLowerCase();
      const role = roleMap[roleRaw] || roleMap[roleRaw.toLowerCase()] || 'staff';
      if (!name || !email) continue;
      parsed.push({ name, email, pw, role, approverEmail });
    }

    let added = 0, roleUpdated = 0, skipped = 0, errors = 0, approverMissed = 0;
    const missedEmails = [];

    for (const r of parsed) {
      const existing = emailToUser[r.email];
      if (existing) {
        if (existing.role !== r.role) {
          try {
            await API.patch('users', existing.id, { role: r.role });
            emailToUser[r.email] = { ...existing, role: r.role };
            roleUpdated++;
          } catch { }
        } else {
          skipped++;
        }
        continue;
      }

      if (!r.pw || r.pw.length < 8) { errors++; continue; }
      try {
        const pwHash  = await Utils.hashPassword(r.pw);
        const created = await API.create('users', {
          name: r.name, email: r.email,
          password: pwHash, role: r.role,
          is_active: true,
          approver_id: '', approver_name: '',
          pw_changed_at: Date.now(),
        });
        if (created && created.id) emailToUser[r.email] = created;
        added++;
      } catch { errors++; }
    }

    let approverSet = 0;
    for (const r of parsed) {
      if (!r.approverEmail) continue;
      const targetUser   = emailToUser[r.email];
      const approverUser = emailToUser[r.approverEmail];
      if (!targetUser || !targetUser.id) continue;
      if (!approverUser || !approverUser.id) {
        approverMissed++;
        missedEmails.push(r.approverEmail);
        continue;
      }
      if (targetUser.approver_id === approverUser.id) continue;
      try {
        await API.patch('users', targetUser.id, {
          approver_id:   approverUser.id,
          approver_name: approverUser.name,
        });
        emailToUser[r.email] = { ...targetUser, approver_id: approverUser.id, approver_name: approverUser.name };
        approverSet++;
      } catch { }
    }

    const result = document.getElementById('user-upload-result');
    result.style.display = '';
    const hasIssue = errors > 0 || approverMissed > 0;
    result.className = hasIssue ? 'alert alert-warning' : 'alert alert-success';
    const uniqueMissed = [...new Set(missedEmails)];
    const lines = [`<i class="fas fa-check-circle"></i><div style="margin-left:6px">`];
    if (added       > 0) lines.push(`<strong>신규 추가 ${added}건</strong>`);
    if (roleUpdated > 0) lines.push(`권한 업데이트 ${roleUpdated}건`);
    if (approverSet > 0) lines.push(`승인자 지정 ${approverSet}건`);
    if (skipped     > 0) lines.push(`변경사항 없음 ${skipped}건`);
    if (errors      > 0) lines.push(`<span style="color:#b45309">오류 ${errors}건 (비밀번호 8자 미만 등)</span>`);
    if (approverMissed > 0) {
      lines.push(`<br><small style="color:#b45309">⚠ 승인자 이메일 미존재 ${approverMissed}건:</small>`);
      uniqueMissed.forEach(em => {
        lines.push(`<br><small style="color:#b45309;padding-left:12px">• ${em} → 직원 등록 후 재업로드하거나 ✏ 버튼으로 직접 지정하세요.</small>`);
      });
    }
    lines.push(`</div>`);
    result.innerHTML = lines.join(' ');

    Master.invalidate('users');
    await loadUsers();
  } catch (err) {
    Toast.error('업로드 실패: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> 업로드'; }
  }
}

// ─────────────────────────────────────────────
// 직원 엑셀 양식 다운로드
// ─────────────────────────────────────────────
async function downloadUserTemplate() {
  if (typeof XLSX === 'undefined') await LibLoader.load('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['이름', '이메일', '비밀번호', '권한', '승인자'],
    ['홍길동', 'hong@example.com',  'hanjoo1234', 'staff',    'kim@example.com'],
    ['안만복', 'ahn@example.com',   'hanjoo1234', 'staff',    'kim@example.com'],
    ['김팀장', 'kim@example.com',   'hanjoo1234', 'manager',  'lee@example.com'],
    ['이책임', 'lee@example.com',   'hanjoo1234', 'director', ''],
    ['박관리', 'park@example.com',  'hanjoo1234', 'admin',    ''],
  ]);
  ws['!cols'] = [{ wch: 10 }, { wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 28 }];

  const wsGuide = XLSX.utils.aoa_to_sheet([
    ['컬럼', '설명', '예시'],
    ['A: 이름',    '직원 실명',                                                          '홍길동'],
    ['B: 이메일',  '로그인 이메일 (이미 등록된 경우 권한·승인자만 업데이트)',              'hong@company.com'],
    ['C: 비밀번호','8자 이상 (기존 직원 업데이트 시 비워도 됨)',                           'hanjoo1234'],
    ['D: 권한',    'staff(담당자) / manager(팀장) / director(관리자) / admin(시스템 관리자)', 'staff'],
    ['E: 승인자',  '승인자의 이메일 주소 (빈칸이면 승인자 변경 안 함)',                   'kim@company.com'],
    ['', '※ 같은 파일 내 다른 직원을 승인자로 지정 가능', ''],
    ['', '※ E열 승인자는 시스템에 이미 등록된 계정이어야 합니다', ''],
    ['', '※ 이미 등록된 직원 포함 가능 → 권한/승인자 일괄 갱신', ''],
  ]);
  wsGuide['!cols'] = [{ wch: 14 }, { wch: 46 }, { wch: 22 }];

  XLSX.utils.book_append_sheet(wb, ws,      '직원목록');
  XLSX.utils.book_append_sheet(wb, wsGuide, '작성안내');
  xlsxDownload(wb, '직원_업로드_양식.xlsx');
  Toast.info('양식을 다운로드했습니다. D열 권한: staff/manager/director/admin, E열 승인자 이메일을 입력하세요.');
}
