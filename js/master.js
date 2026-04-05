/* ============================================
   master.js — 조직구성 / 기준정보 관리
   ============================================
   DB 구조:
   - departments  : 사업부 (id, department_name, director_id, director_name, description)
   - headquarters : 본부   (id, hq_name, dept_id, dept_name, manager_id, manager_name)
   - teams        : 업무팀 (id, team_name, dept_id, dept_name, hq_id, hq_name)
   - cs_teams     : 고객지원팀 (id, cs_team_name, dept_id, dept_name, hq_id, hq_name, manager_id, manager_name)
   ============================================ */

// ─────────────────────────────────────────────
// 공통 캐시
// ─────────────────────────────────────────────
let _deptCache = null;
let _hqCache   = null;

async function _getDepts(force = false) {
  if (!_deptCache || force) {
    const r = await API.list('departments', { limit: 200 });
    const all = (r && r.data) ? r.data : [];
    _deptCache = all.filter(x => x.deleted !== true);
  }
  return _deptCache;
}

async function _getHqs(force = false) {
  if (!_hqCache || force) {
    const r = await API.list('headquarters', { limit: 200 });
    const all = (r && r.data) ? r.data : [];
    _hqCache = all.filter(x => x.deleted !== true);
  }
  return _hqCache;
}

function _clearOrgCache() {
  _deptCache = null;
  _hqCache   = null;
}

// ─────────────────────────────────────────────
// [1] 사업부·본부 통합 관리 (master-org)
// ─────────────────────────────────────────────
let _selectedDeptId   = '';
let _selectedDeptName = '';

let _legacyCleanDone = false; // ★ 레거시 정리는 세션 내 1회만

async function init_master_org() {
  _clearOrgCache();
  _selectedDeptId   = '';
  _selectedDeptName = '';
  // 기존 오류 데이터 자동 정리 (세션 내 1회만)
  if (!_legacyCleanDone) {
    await _cleanLegacyDeptData();
    _legacyCleanDone = true;
  }
  await loadDepartments();
}

/**
 * 이전 버전에서 departments 테이블에 잘못 저장된 본부 행 자동 정리
 * hq_name 필드가 있는 행은 실제 본부 데이터이므로
 * headquarters 테이블로 마이그레이션 후 삭제
 */
async function _cleanLegacyDeptData() {
  try {
    const r    = await API.list('departments', { limit: 500 });
    const rows = (r && r.data) ? r.data : [];

    // hq_name 컬럼에 값이 있는 행 = 이전 버전 잘못 저장된 본부 행
    const legacyHqRows = rows.filter(d => d.hq_name);
    if (!legacyHqRows.length) return; // 정리할 데이터 없음

    // headquarters 테이블의 기존 데이터 확인
    const hqR  = await API.list('headquarters', { limit: 500 });
    const hqRows = (hqR && hqR.data) ? hqR.data : [];
    const existHqNames = new Set(hqRows.map(h => `${h.dept_id}::${h.hq_name}`));

    let migrated = 0;
    for (const d of legacyHqRows) {
      // 마이그레이션: headquarters 테이블에 없는 경우만 추가
      const key = `${d.id}::${d.hq_name}`;
      // dept_id를 찾기 위해 같은 사업부명의 기본 행 검색
      const baseRow = rows.find(r2 => r2.department_name === d.department_name && !r2.hq_name);
      const deptId  = baseRow ? baseRow.id : d.id;
      const deptKey = `${deptId}::${d.hq_name}`;

      if (!existHqNames.has(deptKey)) {
        await API.create('headquarters', {
          hq_name:      d.hq_name,
          dept_id:      deptId,
          dept_name:    d.department_name || '',
          manager_id:   d.hq_manager_id   || '',
          manager_name: d.hq_manager_name || '',
        });
        existHqNames.add(deptKey);
        migrated++;
      }

      // 잘못된 행 삭제 (hq_name이 있던 department 행)
      await API.delete('departments', d.id);
    }

    if (migrated > 0 || legacyHqRows.length > 0) {
      console.log(`[org-cleanup] 본부 데이터 정리 완료: ${legacyHqRows.length}개 행 삭제, ${migrated}개 headquarters 마이그레이션`);
      _clearOrgCache();
    }
  } catch (err) {
    // 정리 실패해도 계속 진행 (치명적 오류 아님)
    console.warn('[org-cleanup] 데이터 정리 중 오류:', err.message);
  }
}

/* ── 사업부 목록 ── */
async function loadDepartments() {
  const allRows = await _getDepts(true);
  // 안전망: hq_name이 있는 잔여 레거시 행은 사업부 목록에서 제외
  const depts = allRows.filter(d => !d.hq_name);
  const tbody = document.getElementById('departments-body');
  if (!tbody) return;

  if (!depts.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">
      <i class="fas fa-sitemap"></i>
      <p>등록된 사업부가 없습니다.<br>오른쪽 위 '사업부 추가' 버튼으로 등록하세요.</p>
    </td></tr>`;
    resetHqPanel();
    return;
  }

  tbody.innerHTML = depts.map((d, i) => {
    const isSel = d.id === _selectedDeptId;
    return `
    <tr class="dept-row"
        data-dept-id="${d.id}"
        onclick="selectDept('${d.id}','${esc(d.department_name)}')"
        style="cursor:pointer;${isSel ? 'background:#eff6ff;' : ''}">
      <td>${i + 1}</td>
      <td>
        <div style="font-weight:600;font-size:13px">${d.department_name || '-'}</div>
        ${d.description ? `<div style="font-size:11px;color:var(--text-muted)">${d.description}</div>` : ''}
      </td>
      <td>${d.director_name
        ? `<span class="org-badge org-badge-blue">${d.director_name}</span>`
        : `<span style="color:var(--text-muted);font-size:11px">미지정</span>`}
      </td>
      <td style="text-align:center">
        <div style="display:flex;gap:5px;justify-content:center">
          <button class="btn btn-sm btn-outline btn-icon"
            onclick="event.stopPropagation();openDeptModal('${d.id}')"
            title="수정"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger btn-icon"
            onclick="event.stopPropagation();deleteDept('${d.id}','${esc(d.department_name)}')"
            title="삭제"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // 선택 상태 복원
  if (_selectedDeptId) {
    await loadHqList(_selectedDeptId, _selectedDeptName);
  }
}

/* 사업부 클릭 → 본부 패널 갱신 */
async function selectDept(deptId, deptName) {
  _selectedDeptId   = deptId;
  _selectedDeptName = deptName;

  // 하이라이트
  document.querySelectorAll('.dept-row').forEach(r => {
    r.style.background = r.dataset.deptId === deptId ? '#eff6ff' : '';
  });

  await loadHqList(deptId, deptName);
}

/* ── 본부 목록 ── */
async function loadHqList(deptId, deptName) {
  const noMsg  = document.getElementById('hq-no-dept-msg');
  const wrap   = document.getElementById('hq-table-wrap');
  const addBtn = document.getElementById('hq-add-btn-wrap');
  const nmEl   = document.getElementById('hq-selected-dept-name');
  if (!noMsg || !wrap) return;

  noMsg.style.display = 'none';
  wrap.style.display  = '';
  if (addBtn) addBtn.style.display = '';
  if (nmEl)  nmEl.textContent = deptName;

  const allHqs = await _getHqs(true);
  const hqs    = allHqs.filter(h => h.dept_id === deptId);
  const tbody  = document.getElementById('hq-body');

  if (!hqs.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">
      <i class="fas fa-building"></i>
      <p>등록된 본부가 없습니다.</p>
      <button class="btn btn-sm btn-primary" onclick="openHqModal()" style="margin-top:8px">
        <i class="fas fa-plus"></i> 본부 추가
      </button>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = hqs.map((h, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong style="font-size:13px">${h.hq_name || '-'}</strong></td>
      <td>${h.manager_name
        ? `<span class="org-badge org-badge-green">${h.manager_name}</span>`
        : `<span style="color:var(--text-muted);font-size:11px">미지정</span>`}
      </td>
      <td style="text-align:center">
        <div style="display:flex;gap:5px;justify-content:center">
          <button class="btn btn-sm btn-outline btn-icon"
            onclick="openHqModal('${h.id}')"
            title="수정"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger btn-icon"
            onclick="deleteHq('${h.id}','${esc(h.hq_name)}')"
            title="삭제"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');
}

function resetHqPanel() {
  const noMsg  = document.getElementById('hq-no-dept-msg');
  const wrap   = document.getElementById('hq-table-wrap');
  const addBtn = document.getElementById('hq-add-btn-wrap');
  if (noMsg)  noMsg.style.display  = '';
  if (wrap)   wrap.style.display   = 'none';
  if (addBtn) addBtn.style.display = 'none';
}

/* ── 사업부 모달 ── */
async function openDeptModal(id = '') {
  try {
    document.getElementById('dept-edit-id').value        = id;
    document.getElementById('dept-name-input').value     = '';
    document.getElementById('dept-desc-input').value     = '';
    document.getElementById('deptModalTitle').textContent = id ? '사업부 수정' : '사업부 추가';

    // 사업부장 드롭다운 (Director/Admin) ★ Master 캐시 사용
    const dirEl = document.getElementById('dept-director-input');
    dirEl.innerHTML = '<option value="">사업부장 선택 (미지정)</option>';
    const allDirUsers = await Master.users();
    allDirUsers
      .filter(u => (u.role === 'director' || u.role === 'admin') && u.is_active !== false)
      .forEach(u => {
        const o = new Option(u.name, u.id);
        o.dataset.name = u.name;
        dirEl.appendChild(o);
      });

    if (id) {
      const dept = await API.get('departments', id);
      if (dept) {
        document.getElementById('dept-name-input').value = dept.department_name || '';
        document.getElementById('dept-desc-input').value = dept.description    || '';
        if (dept.director_id) dirEl.value = dept.director_id;
      }
    }
    openModal('deptModal');
    setTimeout(() => document.getElementById('dept-name-input').focus(), 120);
  } catch(err) {
    console.error('[openDeptModal] 오류:', err);
    Toast.error('모달 열기 실패: ' + (err.message || '알 수 없는 오류'));
  }
}

async function saveDept() {
  const id      = document.getElementById('dept-edit-id').value;
  const name    = document.getElementById('dept-name-input').value.trim();
  const desc    = document.getElementById('dept-desc-input').value.trim();
  const dirEl   = document.getElementById('dept-director-input');
  const dirId   = dirEl.value;
  const dirName = dirId ? (dirEl.options[dirEl.selectedIndex]?.dataset.name || '') : '';

  if (!name) { Toast.warning('사업부명을 입력하세요.'); return; }

  try {
    const data = { department_name: name, director_id: dirId, director_name: dirName, description: desc };
    if (id) {
      await API.update('departments', id, data);
      Toast.success('사업부가 수정되었습니다.');
    } else {
      await API.create('departments', data);
      Toast.success('사업부가 추가되었습니다.');
    }
    closeModal('deptModal');
    _deptCache = null;
    await loadDepartments();
  } catch (err) { Toast.error('저장 실패: ' + err.message); }
}

async function deleteDept(id, name) {
  // 해당 사업부에 본부가 있는지 확인
  const hqs = await _getHqs(true);
  const linkedHqs = hqs.filter(h => h.dept_id === id);
  if (linkedHqs.length) {
    Toast.warning(`소속 본부 ${linkedHqs.length}개가 있습니다. 본부를 먼저 삭제해주세요.`);
    return;
  }
  if (!await Confirm.delete(name)) return;
  try {
    await API.delete('departments', id);
    Toast.success('삭제되었습니다.');
    _deptCache = null;
    if (_selectedDeptId === id) {
      _selectedDeptId   = '';
      _selectedDeptName = '';
      resetHqPanel();
    }
    await loadDepartments();
  } catch (err) {
    const msg = err && err.message ? err.message : '알 수 없는 오류';
    console.error('[deleteDept] 실패:', msg);
    Toast.error('삭제 실패: ' + msg);
  }
}

/* ── 본부 모달 ── */
async function openHqModal(id = '') {
  if (!id && !_selectedDeptId) {
    Toast.warning('먼저 왼쪽에서 사업부를 선택하세요.');
    return;
  }
  try {
    document.getElementById('hq-edit-id').value        = id;
    document.getElementById('hq-name-input').value     = '';
    document.getElementById('hq-dept-id').value        = _selectedDeptId;
    document.getElementById('hqModalTitle').textContent = id ? '본부 수정' : '본부 추가';

    const deptNmEl = document.getElementById('hq-modal-dept-name');
    if (deptNmEl) deptNmEl.textContent = _selectedDeptName || '-';

    // 본부장 드롭다운 (Manager/Director/Admin)
    await _fillHqManagerSelect('');

    if (id) {
      const hq = await API.get('headquarters', id);
      if (hq) {
        document.getElementById('hq-name-input').value = hq.hq_name || '';
        document.getElementById('hq-dept-id').value    = hq.dept_id || _selectedDeptId;
        // 사업부명 표시
        if (deptNmEl) deptNmEl.textContent = hq.dept_name || _selectedDeptName || '-';
        // 선택 상태 보정
        _selectedDeptId   = hq.dept_id   || _selectedDeptId;
        _selectedDeptName = hq.dept_name  || _selectedDeptName;
        await _fillHqManagerSelect(hq.manager_id || '');
      }
    }

    openModal('hqModal');
    setTimeout(() => document.getElementById('hq-name-input').focus(), 120);
  } catch(err) {
    console.error('[openHqModal] 오류:', err);
    Toast.error('모달 열기 실패: ' + (err.message || '알 수 없는 오류'));
  }
}

async function _fillHqManagerSelect(selectedId = '') {
  const mgrEl = document.getElementById('hq-manager-input');
  mgrEl.innerHTML = '<option value="">본부장 선택 (미지정)</option>';
  // ★ Master 캐시 사용
  const allMgrUsers = await Master.users();
  allMgrUsers
    .filter(u => (u.role === 'manager' || u.role === 'director' || u.role === 'admin') && u.is_active !== false)
    .forEach(u => {
      const o = new Option(`${u.name} (${ROLE_LABEL_FULL[u.role] || u.role})`, u.id);
      o.dataset.name = u.name;
      if (u.id === selectedId) o.selected = true;
      mgrEl.appendChild(o);
    });
}

async function saveHq() {
  const id      = document.getElementById('hq-edit-id').value;
  const deptId  = document.getElementById('hq-dept-id').value || _selectedDeptId;
  const hqName  = document.getElementById('hq-name-input').value.trim();
  const mgrEl   = document.getElementById('hq-manager-input');
  const mgrId   = mgrEl.value;
  const mgrName = mgrId ? (mgrEl.options[mgrEl.selectedIndex]?.dataset.name || '') : '';

  if (!hqName)  { Toast.warning('본부명을 입력하세요.'); return; }
  if (!deptId)  { Toast.warning('사업부 정보가 없습니다. 사업부를 먼저 선택하세요.'); return; }

  // 사업부명 조회
  const depts   = await _getDepts();
  const baseDept = depts.find(d => d.id === deptId);
  const deptName = baseDept ? baseDept.department_name : _selectedDeptName;

  try {
    const data = {
      hq_name:      hqName,
      dept_id:      deptId,
      dept_name:    deptName,
      manager_id:   mgrId,
      manager_name: mgrName,
    };
    if (id) {
      await API.update('headquarters', id, data);
      Toast.success('본부가 수정되었습니다.');
    } else {
      await API.create('headquarters', data);
      Toast.success('본부가 추가되었습니다.');
    }
    closeModal('hqModal');
    _hqCache = null;
    // 현재 선택된 사업부의 본부 목록 갱신
    if (_selectedDeptId) {
      await loadHqList(_selectedDeptId, _selectedDeptName);
    }
  } catch (err) { Toast.error('저장 실패: ' + err.message); }
}

async function deleteHq(id, hqName) {
  if (!await Confirm.delete(hqName + ' 본부')) return;
  try {
    await API.delete('headquarters', id);
    Toast.success('삭제되었습니다.');
    _hqCache = null;
    if (_selectedDeptId) {
      await loadHqList(_selectedDeptId, _selectedDeptName);
    }
  } catch (err) {
    const msg = err && err.message ? err.message : '알 수 없는 오류';
    console.error('[deleteHq] 실패:', msg);
    Toast.error('삭제 실패: ' + msg);
  }
}

// ─────────────────────────────────────────────
// [2] 업무팀 관리 (master-teams)
// ─────────────────────────────────────────────
async function init_master_teams() {
  _clearOrgCache();
  await loadTeams();
}

async function loadTeams() {
  // 캐시 완전 무효화 (Master 캐시 + Cache 스토어 모두)
  Master.invalidate('teams');
  Cache.invalidate('teams');
  const teams = await Master.teams();
  const tbody = document.getElementById('teams-body');
  if (!tbody) return; // DOM 요소 없을 때 조용히 종료
  if (!teams.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">
      <i class="fas fa-users-cog"></i>
      <p>등록된 업무팀이 없습니다.</p>
    </td></tr>`;
    return;
  }
  tbody.innerHTML = teams.map((t, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${t.team_name}</strong></td>
      <td style="font-size:12px;color:var(--text-secondary)">${t.dept_name || t.department_name || '-'}</td>
      <td style="font-size:12px;color:var(--text-secondary)">${t.hq_name || '-'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${Utils.formatDate(t.created_at)}</td>
      <td style="text-align:center">
        <div style="display:flex;gap:6px;justify-content:center">
          <button class="btn btn-sm btn-outline btn-icon"
            onclick="openTeamModal('${t.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger btn-icon"
            onclick="deleteTeam('${t.id}','${esc(t.team_name)}')"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');
}

async function openTeamModal(id = '') {
  document.getElementById('team-edit-id').value        = id;
  document.getElementById('team-name-input').value     = '';
  document.getElementById('teamModalTitle').textContent = id ? '업무팀 수정' : '업무팀 추가';

  // 사업부 드롭다운
  const deptEl = document.getElementById('team-dept-input');
  deptEl.innerHTML = '<option value="">사업부 선택</option>';
  const depts = await _getDepts();
  depts.forEach(d => {
    const o = new Option(d.department_name, d.id);
    o.dataset.name = d.department_name;
    deptEl.appendChild(o);
  });

  // 본부 초기화
  const hqEl = document.getElementById('team-hq-input');
  hqEl.innerHTML = '<option value="">본부 선택 (사업부 먼저 선택)</option>';
  hqEl.disabled = true;

  if (id) {
    // Supabase REST API로 팀 정보 조회
    const team = await API.get('teams', id);
    if (team) {
      document.getElementById('team-name-input').value = team.team_name || '';
      const deptId = team.dept_id || '';
      if (deptId) {
        deptEl.value = deptId;
        await _fillTeamHqSelect(deptId, team.hq_id || '');
      }
    }
  }

  openModal('teamModal');
  setTimeout(() => document.getElementById('team-name-input').focus(), 120);
}

async function onTeamDeptChange() {
  const deptEl = document.getElementById('team-dept-input');
  await _fillTeamHqSelect(deptEl.value, '');
}

async function _fillTeamHqSelect(deptId, selectedHqId) {
  const hqEl = document.getElementById('team-hq-input');
  hqEl.innerHTML = '<option value="">본부 선택 (선택사항)</option>';
  hqEl.disabled  = !deptId;
  if (!deptId) return;

  const hqs = await _getHqs();
  hqs.filter(h => h.dept_id === deptId).forEach(h => {
    const o = new Option(h.hq_name + (h.manager_name ? ` (${h.manager_name})` : ''), h.id);
    o.dataset.hqName = h.hq_name;
    if (h.id === selectedHqId) o.selected = true;
    hqEl.appendChild(o);
  });
}

async function saveTeam() {
  const id      = document.getElementById('team-edit-id').value;
  const name    = document.getElementById('team-name-input').value.trim();
  const deptEl  = document.getElementById('team-dept-input');
  const deptId  = deptEl.value;
  const deptNm  = deptEl.options[deptEl.selectedIndex]?.dataset.name || '';
  const hqEl    = document.getElementById('team-hq-input');
  const hqId    = hqEl.value;
  const hqNm    = hqEl.options[hqEl.selectedIndex]?.dataset.hqName || '';

  if (!name) { Toast.warning('업무팀명을 입력하세요.'); return; }

  try {
    const data = { team_name: name, dept_id: deptId, dept_name: deptNm, hq_id: hqId, hq_name: hqNm };
    if (id) {
      await API.update('teams', id, data);
      Toast.success('업무팀이 수정되었습니다.');
    } else {
      await API.create('teams', data);
      Toast.success('업무팀이 추가되었습니다.');
    }
    closeModal('teamModal');
    Master.invalidate('teams');
    await loadTeams();
  } catch (err) { Toast.error('저장 실패: ' + err.message); }
}

async function deleteTeam(id, name) {
  if (!await Confirm.delete(name)) return;
  try {
    await API.delete('teams', id);
    Toast.success('삭제되었습니다.');
    Master.invalidate('teams');
    Cache.invalidate('teams');
    await loadTeams();
  } catch (err) {
    const msg = err && err.message ? err.message : '알 수 없는 오류';
    console.error('[deleteTeam] 실패:', msg);
    Toast.error('삭제 실패: ' + msg);
  }
}

function openTeamUploadModal() { openModal('teamUploadModal'); }

async function uploadTeams() {
  const file = document.getElementById('team-upload-file').files[0];
  if (!file) { Toast.warning('파일을 선택하세요.'); return; }
  try {
    const data     = await Utils.parseExcel(file);
    const existing = await Master.teams();
    const existNames = new Set(existing.map(t => t.team_name));
    let added = 0, skipped = 0;
    for (const row of data) {
      const name = String(row['팀명'] || Object.values(row)[0] || '').trim();
      if (!name) continue;
      if (existNames.has(name)) { skipped++; continue; }
      await API.create('teams', { team_name: name });
      added++;
    }
    const result = document.getElementById('team-upload-result');
    result.style.display = '';
    result.innerHTML = `<i class="fas fa-check-circle"></i> 추가 ${added}건 완료 / 중복 스킵 ${skipped}건`;
    Master.invalidate('teams');
    await loadTeams();
  } catch (err) { Toast.error('업로드 실패: ' + err.message); }
}

async function downloadTeamTemplate() {
  if (typeof XLSX === 'undefined') await LibLoader.load('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['팀명'], ['예: 세무1팀'], ['예: 법무팀']]);
  XLSX.utils.book_append_sheet(wb, ws, '팀목록');
  await xlsxDownload(wb, '팀_업로드_양식.xlsx');
}

// ─────────────────────────────────────────────
// [3] 고객지원팀 관리 (master-csteams)
// ─────────────────────────────────────────────
async function init_master_csteams() {
  _clearOrgCache();
  await loadCsTeams();
}

async function loadCsTeams() {
  const r     = await API.list('cs_teams', { limit: 200 });
  const teams = (r && r.data) ? r.data.filter(x => x.deleted !== true) : [];
  const tbody = document.getElementById('csteams-body');
  if (!teams.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">
      <i class="fas fa-headset"></i>
      <p>등록된 고객지원팀이 없습니다.</p>
    </td></tr>`;
    return;
  }
  tbody.innerHTML = teams.map((t, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${t.cs_team_name}</strong></td>
      <td style="font-size:12px">${t.dept_name || '-'}</td>
      <td style="font-size:12px;color:var(--text-secondary)">${t.hq_name || '-'}</td>
      <td>${t.manager_name
        ? `<span class="org-badge org-badge-green"><i class="fas fa-user-check" style="font-size:9px"></i> ${t.manager_name}</span>`
        : `<span style="color:var(--text-muted);font-size:11px">미지정</span>`}
      </td>
      <td style="font-size:12px;color:var(--text-muted)">${Utils.formatDate(t.created_at)}</td>
      <td style="text-align:center">
        <div style="display:flex;gap:6px;justify-content:center">
          <button class="btn btn-sm btn-outline btn-icon"
            onclick="openCsTeamModal('${t.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger btn-icon"
            onclick="deleteCsTeam('${t.id}','${esc(t.cs_team_name)}')"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');
}

async function openCsTeamModal(id = '') {
  try {
    document.getElementById('csteam-edit-id').value        = id;
    document.getElementById('csteam-name-input').value     = '';
    document.getElementById('csteam-desc-input').value     = '';
    document.getElementById('csTeamModalTitle').textContent = id ? '고객지원팀 수정' : '고객지원팀 추가';

    // 사업부 드롭다운
    const deptEl = document.getElementById('csteam-dept-input');
    deptEl.innerHTML = '<option value="">사업부 선택</option>';
    const depts = await _getDepts();
    depts.forEach(d => {
      const o = new Option(d.department_name, d.id);
      o.dataset.name = d.department_name;
      deptEl.appendChild(o);
    });

    // 본부 초기화
    const hqEl = document.getElementById('csteam-hq-input');
    hqEl.innerHTML = '<option value="">본부 선택 (사업부 먼저 선택)</option>';
    hqEl.disabled  = true;

    // 매니저 초기화
    const mgrEl = document.getElementById('csteam-manager-input');
    mgrEl.innerHTML = '<option value="">본부 선택 시 자동 연결</option>';
    mgrEl.disabled  = true;

    if (id) {
      const team = await API.get('cs_teams', id);
      if (team) {
        document.getElementById('csteam-name-input').value = team.cs_team_name || '';
        document.getElementById('csteam-desc-input').value = team.description  || '';
        const deptId = team.dept_id || '';
        if (deptId) {
          deptEl.value = deptId;
          await _fillCsTeamHqSelect(deptId, team.hq_id || '');
          if (team.hq_id) {
            await _fillCsTeamManagerByHq(team.hq_id, team.manager_id || '');
          }
        }
      }
    }

    openModal('csTeamModal');
    setTimeout(() => document.getElementById('csteam-name-input').focus(), 120);
  } catch(err) {
    console.error('[openCsTeamModal] 오류:', err);
    Toast.error('모달 열기 실패: ' + (err.message || '알 수 없는 오류'));
  }
}

async function onCsTeamDeptChange() {
  const deptEl = document.getElementById('csteam-dept-input');
  await _fillCsTeamHqSelect(deptEl.value, '');
  // 매니저 초기화
  const mgrEl = document.getElementById('csteam-manager-input');
  mgrEl.innerHTML = '<option value="">본부 선택 시 자동 연결</option>';
  mgrEl.disabled  = true;
}

async function onCsTeamHqChange() {
  const hqEl = document.getElementById('csteam-hq-input');
  await _fillCsTeamManagerByHq(hqEl.value, '');
}

async function _fillCsTeamHqSelect(deptId, selectedHqId) {
  const hqEl    = document.getElementById('csteam-hq-input');
  hqEl.innerHTML = '<option value="">본부 선택 (선택사항)</option>';
  hqEl.disabled  = !deptId;
  if (!deptId) return;

  const hqs = await _getHqs();
  hqs.filter(h => h.dept_id === deptId).forEach(h => {
    const o = new Option(h.hq_name, h.id);
    o.dataset.hqName     = h.hq_name;
    o.dataset.managerId   = h.manager_id   || '';
    o.dataset.managerName = h.manager_name || '';
    if (h.id === selectedHqId) o.selected = true;
    hqEl.appendChild(o);
  });
}

async function _fillCsTeamManagerByHq(hqId, selectedMgrId) {
  const mgrEl = document.getElementById('csteam-manager-input');

  if (!hqId) {
    mgrEl.innerHTML = '<option value="">본부 선택 시 자동 연결</option>';
    mgrEl.disabled  = true;
    return;
  }

  mgrEl.disabled  = false;

  // 해당 본부의 본부장을 먼저 확인
  const hqs    = await _getHqs();
  const hqRow  = hqs.find(h => h.id === hqId);

  // 전체 Manager/Director 목록 로드 ★ Master 캐시 사용
  const allTeamMgrUsers = await Master.users();
  const managers = allTeamMgrUsers.filter(u =>
    (u.role === 'manager' || u.role === 'director') && u.is_active !== false
  );

  mgrEl.innerHTML = '<option value="">팀장 선택 (미지정)</option>';
  managers.forEach(u => {
    const o = new Option(`${u.name} (${ROLE_LABEL_FULL[u.role] || u.role})`, u.id);
    o.dataset.name = u.name;
    mgrEl.appendChild(o);
  });

  // 본부장 자동 선택
  const autoId = (hqRow && hqRow.manager_id) ? hqRow.manager_id : selectedMgrId;
  if (autoId) mgrEl.value = autoId;
}

async function saveCsTeam() {
  const id     = document.getElementById('csteam-edit-id').value;
  const name   = document.getElementById('csteam-name-input').value.trim();
  const desc   = document.getElementById('csteam-desc-input').value.trim();
  const deptEl = document.getElementById('csteam-dept-input');
  const deptId = deptEl.value;
  const deptNm = deptEl.options[deptEl.selectedIndex]?.dataset.name || '';
  const hqEl   = document.getElementById('csteam-hq-input');
  const hqId   = hqEl.value;
  const hqNm   = hqEl.options[hqEl.selectedIndex]?.dataset.hqName || '';
  const mgrEl  = document.getElementById('csteam-manager-input');
  const mgrId  = mgrEl.disabled ? '' : mgrEl.value;
  const mgrNm  = mgrId ? (mgrEl.options[mgrEl.selectedIndex]?.dataset.name || '') : '';

  if (!name)   { Toast.warning('고객지원팀명을 입력하세요.'); return; }
  if (!deptId) { Toast.warning('소속 사업부를 선택하세요.');  return; }

  try {
    const data = {
      cs_team_name: name,
      dept_id:      deptId,
      dept_name:    deptNm,
      hq_id:        hqId,
      hq_name:      hqNm,
      manager_id:   mgrId,
      manager_name: mgrNm,
      description:  desc,
    };
    if (id) {
      await API.update('cs_teams', id, data);
      Toast.success('고객지원팀이 수정되었습니다.');
    } else {
      await API.create('cs_teams', data);
      Toast.success('고객지원팀이 추가되었습니다.');
    }
    closeModal('csTeamModal');
    await loadCsTeams();
  } catch (err) { Toast.error('저장 실패: ' + err.message); }
}

async function deleteCsTeam(id, name) {
  if (!await Confirm.delete(name)) return;
  try {
    await API.delete('cs_teams', id);
    Toast.success('삭제되었습니다.');
    await loadCsTeams();
  } catch (err) {
    const msg = err && err.message ? err.message : '알 수 없는 오류';
    console.error('[deleteCsTeam] 실패:', msg);
    Toast.error('삭제 실패: ' + msg);
  }
}

// ─────────────────────────────────────────────
// [4] 고객사 관리 (master-clients)
// ─────────────────────────────────────────────
async function init_master_clients() {
  const session = getSession();
  if (!Auth.canManageRefData(session)) {
    navigateTo('dashboard');
    Toast.warning('고객사 관리 권한이 없습니다.');
    return;
  }
  await loadClients();
}

async function loadClients() {
  Master.invalidate('clients');
  const clients = await Master.clients();
  const tbody   = document.getElementById('clients-body');
  if (!clients.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty"><i class="fas fa-building"></i><p>등록된 고객사가 없습니다.</p></td></tr>`;
    return;
  }
  tbody.innerHTML = clients.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${c.company_name}</strong></td>
      <td>${Utils.formatDate(c.created_at)}</td>
      <td style="text-align:center">
        <div style="display:flex;gap:6px;justify-content:center">
          <button class="btn btn-sm btn-outline btn-icon"
            onclick="openClientModal('${c.id}','${esc(c.company_name)}')"><i class="fas fa-edit"></i></button>
          <button class="btn btn-sm btn-danger btn-icon"
            onclick="deleteClient('${c.id}','${esc(c.company_name)}')"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');
}

function openClientModal(id, name) {
  id   = id   || '';
  name = name || '';
  document.getElementById('client-edit-id').value        = id;
  document.getElementById('client-name-input').value     = name;
  document.getElementById('clientModalTitle').textContent = id ? '고객사 수정' : '고객사 추가';
  // 힌트 초기화
  var hintEl = document.getElementById('client-name-hint');
  if (hintEl) hintEl.style.display = 'none';
  openModal('clientModal');
  setTimeout(function() {
    var inp = document.getElementById('client-name-input');
    if (inp) inp.focus();
  }, 100);
}

// ─────────────────────────────────────────────
// 고객사명 정규화 (중복 비교용)
// ─────────────────────────────────────────────
function _normalizeClientName(name) {
  return (name || '')
    .replace(/\(\s*주\s*\)/gi, '')   // (주)
    .replace(/\(\s*유\s*\)/gi, '')   // (유)
    .replace(/\(\s*재\s*\)/gi, '')   // (재)
    .replace(/\(\s*사\s*\)/gi, '')   // (사)
    .replace(/㈜/g, '')
    .replace(/㈔/g, '')
    .replace(/주식회사/gi, '')
    .replace(/[\s·\-_]/g, '')        // 공백·중간점·하이픈 제거
    .toLowerCase();
}

// ─────────────────────────────────────────────
// 유사 고객사 검색 (정규화 기반)
// ─────────────────────────────────────────────
function _findSimilarClients(name, existingClients, excludeId) {
  const norm = _normalizeClientName(name);
  if (!norm) return [];
  return existingClients.filter(function(c) {
    if (c.id === excludeId) return false;
    var cNorm = _normalizeClientName(c.company_name);
    return cNorm === norm || cNorm.includes(norm) || norm.includes(cNorm);
  });
}

// ─────────────────────────────────────────────
// 실시간 입력 힌트 (Phase 2)
// ─────────────────────────────────────────────
var _clientHintDebounce = null;
async function _onClientNameInput() {
  var input  = document.getElementById('client-name-input');
  var hintEl = document.getElementById('client-name-hint');
  if (!input || !hintEl) return;

  var val = input.value.trim();
  if (val.length < 2) { hintEl.style.display = 'none'; return; }

  clearTimeout(_clientHintDebounce);
  _clientHintDebounce = setTimeout(async function() {
    try {
      var existing = await Master.clients();
      var editId   = document.getElementById('client-edit-id').value;
      var similar  = _findSimilarClients(val, existing, editId);

      if (!similar.length) { hintEl.style.display = 'none'; return; }

      hintEl.style.display = 'block';
      hintEl.innerHTML =
        '<div style="display:flex;align-items:flex-start;gap:8px">' +
        '<i class="fas fa-exclamation-triangle" style="color:#f59e0b;margin-top:2px;flex-shrink:0"></i>' +
        '<div>' +
        '<div style="font-weight:600;font-size:12px;color:#92400e;margin-bottom:4px">유사한 고객사가 이미 있습니다</div>' +
        similar.map(function(c) {
          return '<div style="font-size:12px;color:#78350f;padding:2px 0">' +
            '<i class="fas fa-building" style="font-size:10px;margin-right:4px"></i>' +
            '<strong>' + Utils.escHtml(c.company_name) + '</strong></div>';
        }).join('') +
        '<div style="font-size:11px;color:#b45309;margin-top:4px">다른 고객사라면 계속 저장하실 수 있습니다.</div>' +
        '</div></div>';
    } catch(e) { hintEl.style.display = 'none'; }
  }, 350);
}

async function saveClient() {
  const session = getSession();
  if (!Auth.canManageRefData(session)) { Toast.warning('권한이 없습니다.'); return; }
  const id   = document.getElementById('client-edit-id').value;
  const name = document.getElementById('client-name-input').value.trim();
  if (!name) { Toast.warning('고객사명을 입력하세요.'); return; }

  // ── Phase 1: 중복 체크 ──────────────────────────────
  try {
    const existing = await Master.clients();
    const similar  = _findSimilarClients(name, existing, id);

    // 정규화 완전일치 → 즉시 차단
    const normInput = _normalizeClientName(name);
    const exact = similar.find(function(c) {
      return _normalizeClientName(c.company_name) === normInput;
    });
    if (exact) {
      Toast.warning('"' + exact.company_name + '"과(와) 동일한 고객사입니다. 중복 등록할 수 없습니다.');
      document.getElementById('client-name-input').focus();
      return;
    }

    // 유사일치 → 사용자 확인 후 저장
    if (similar.length) {
      const names = similar.map(function(c) { return '"' + c.company_name + '"'; }).join(', ');
      const ok = await Confirm.show({
        icon: '⚠️',
        title: '유사한 고객사 존재',
        desc: names + '와(과) 유사합니다.<br>다른 고객사라면 계속 저장하시겠습니까?',
        confirmText: '계속 저장',
        confirmClass: 'btn-warning'
      });
      if (!ok) return;
    }
  } catch(e) {
    console.warn('client duplicate check error:', e);
  }

  // ── 저장 ────────────────────────────────────────────
  try {
    if (id) { await API.update('clients', id, { company_name: name }); Toast.success('수정되었습니다.'); }
    else    { await API.create('clients', { company_name: name });       Toast.success('추가되었습니다.'); }
    closeModal('clientModal');
    Master.invalidate('clients');
    await loadClients();
  } catch(err) { Toast.error('저장 실패: ' + (err && err.message ? err.message : '알 수 없는 오류')); }
}

async function deleteClient(id, name) {
  const session = getSession();
  if (!Auth.canManageRefData(session)) { Toast.warning('권한이 없습니다.'); return; }
  if (!await Confirm.delete(name)) return;
  try {
    await API.delete('clients', id);
    Toast.success('삭제되었습니다.');
    Master.invalidate('clients');
    Cache.invalidate('clients');
    await loadClients();
  } catch (err) {
    const msg = err && err.message ? err.message : '알 수 없는 오류';
    console.error('[deleteClient] 실패:', msg);
    Toast.error('삭제 실패: ' + msg);
  }
}

function openClientUploadModal() { openModal('clientUploadModal'); }

async function uploadClients() {
  const session = getSession();
  if (!Auth.canManageRefData(session)) { Toast.warning('권한이 없습니다.'); return; }
  const file = document.getElementById('client-upload-file').files[0];
  if (!file) { Toast.warning('파일을 선택하세요.'); return; }

  const btn = document.querySelector('#clientUploadModal .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 처리 중...'; }

  try {
    const data     = await Utils.parseExcel(file);
    const existing = await Master.clients();

    // ── Phase 3: 정규화 기반 중복 맵 구성 ──────────────
    // key: 정규화된 이름, value: 원본 company_name
    const normMap = {};
    existing.forEach(function(c) {
      normMap[_normalizeClientName(c.company_name)] = c.company_name;
    });

    let added = 0, skipped = 0, errors = 0;
    const skipDetails = [];   // 중복 스킵된 항목 상세
    const errorDetails = [];  // 오류 항목

    for (const row of data) {
      const name = String(row['고객사명'] || Object.values(row)[0] || '').trim();
      if (!name) continue;

      const normName = _normalizeClientName(name);

      // 정규화 기준 중복 체크
      if (normMap[normName]) {
        skipped++;
        skipDetails.push({ input: name, matched: normMap[normName] });
        continue;
      }

      try {
        await API.create('clients', { company_name: name });
        // 새로 추가된 항목도 즉시 normMap에 반영 (같은 파일 내 중복 방지)
        normMap[normName] = name;
        added++;
      } catch(e) {
        errors++;
        errorDetails.push(name);
      }
    }

    // ── 결과 표시 ──────────────────────────────────────
    const result = document.getElementById('client-upload-result');
    result.style.display = '';

    let html = '<div style="font-size:13px;line-height:1.8">';

    if (added > 0) {
      html += '<div style="color:#059669"><i class="fas fa-check-circle"></i> <strong>' + added + '건</strong> 추가 완료</div>';
    }
    if (skipped > 0) {
      html += '<div style="color:#d97706;margin-top:4px"><i class="fas fa-minus-circle"></i> <strong>' + skipped + '건</strong> 중복 스킵';
      if (skipDetails.length <= 5) {
        skipDetails.forEach(function(d) {
          var note = d.input !== d.matched ? ' (기존: ' + Utils.escHtml(d.matched) + ')' : '';
          html += '<div style="font-size:11px;color:#92400e;padding-left:16px">· ' + Utils.escHtml(d.input) + note + '</div>';
        });
      } else {
        html += '<div style="font-size:11px;color:#92400e;padding-left:16px">· ' + skipDetails.slice(0,3).map(function(d){ return Utils.escHtml(d.input); }).join(', ') + ' 외 ' + (skipDetails.length - 3) + '건</div>';
      }
      html += '</div>';
    }
    if (errors > 0) {
      html += '<div style="color:#dc2626;margin-top:4px"><i class="fas fa-times-circle"></i> <strong>' + errors + '건</strong> 오류: ' + errorDetails.slice(0,3).map(Utils.escHtml).join(', ') + '</div>';
    }
    html += '</div>';
    result.innerHTML = html;

    Master.invalidate('clients');
    await loadClients();
  } catch (err) {
    Toast.error('업로드 실패: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> 업로드'; }
  }
}

async function downloadClientTemplate() {
  if (typeof XLSX === 'undefined') await LibLoader.load('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['고객사명'], ['예: ABC기업'], ['예: DEF법인']]);
  XLSX.utils.book_append_sheet(wb, ws, '고객사목록');
  await xlsxDownload(wb, '고객사_업로드_양식.xlsx');
}

// ─────────────────────────────────────────────
// [5] 업무 카테고리 관리 (master-categories)
// ─────────────────────────────────────────────
async function init_master_categories() {
  const session = getSession();
  if (!Auth.canManageRefData(session)) {
    navigateTo('dashboard');
    Toast.warning('업무분류 관리 권한이 없습니다.');
    return;
  }
  await loadCategories();
}

async function loadCategories() {
  Master.invalidate('categories');
  Master.invalidate('subcategories');
  const [cats, subs] = await Promise.all([Master.categories(), Master.subcategories()]);
  renderCategoryTree(cats, subs);
}

function renderCategoryTree(cats, subs) {
  const tree = document.getElementById('category-tree');
  if (!cats.length) {
    tree.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">
      <i class="fas fa-tags" style="font-size:32px;margin-bottom:12px;display:block"></i>
      <p>등록된 카테고리가 없습니다.</p>
    </div>`;
    return;
  }
  tree.innerHTML = cats.map(cat => {
    const catSubs  = subs.filter(s => s.category_id === cat.id);
    const typeBadge = cat.category_type === 'client'
      ? '<span class="badge badge-blue" style="font-size:10px">고객업무</span>'
      : '<span class="badge badge-gray" style="font-size:10px">내부업무</span>';
    return `
      <div style="margin-bottom:12px;border:1px solid var(--border-light);border-radius:10px;overflow:hidden">
        <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#f7f9fc;border-bottom:1px solid var(--border-light)">
          <i class="fas fa-folder" style="color:var(--primary)"></i>
          <strong style="font-size:14px">${cat.category_name}</strong>
          ${typeBadge}
          <span style="font-size:11px;color:var(--text-muted);margin-left:4px">소분류 ${catSubs.length}개</span>
          <div style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn-sm btn-primary btn-icon"
              onclick="openSubcategoryModal('','','${cat.id}','${esc(cat.category_name)}',${catSubs.length+1})"
              title="소분류 추가"><i class="fas fa-plus"></i></button>
            <button class="btn btn-sm btn-ghost btn-icon"
              onclick="openCategoryModal('${cat.id}','${esc(cat.category_name)}','${cat.category_type||'client'}',${cat.sort_order||0})"
              title="수정"><i class="fas fa-edit" style="color:var(--text-secondary)"></i></button>
            <button class="btn btn-sm btn-ghost btn-icon"
              onclick="deleteCategory('${cat.id}','${esc(cat.category_name)}',${catSubs.length})"
              title="삭제"><i class="fas fa-trash" style="color:var(--danger)"></i></button>
          </div>
        </div>
        ${catSubs.length > 0
          ? `<div style="padding:8px 12px">
              ${catSubs.map(s => `
                <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;"
                     onmouseover="this.style.background='#f0f4f8'" onmouseout="this.style.background=''">
                  <i class="fas fa-tag" style="color:var(--text-muted);font-size:12px;margin-left:16px"></i>
                  <span style="font-size:13px">${s.sub_category_name}</span>
                  <div style="margin-left:auto;display:flex;gap:4px">
                    <button class="btn btn-sm btn-ghost btn-icon"
                      onclick="openSubcategoryModal('${s.id}','${esc(s.sub_category_name)}','${cat.id}','',${s.sort_order||0})"
                      title="수정"><i class="fas fa-edit" style="color:var(--text-secondary)"></i></button>
                    <button class="btn btn-sm btn-ghost btn-icon"
                      onclick="deleteSubcategory('${s.id}','${esc(s.sub_category_name)}')">
                      <i class="fas fa-trash" style="color:var(--danger)"></i></button>
                  </div>
                </div>`).join('')}
            </div>`
          : `<div style="padding:12px 16px 12px 44px;color:var(--text-muted);font-size:12.5px">
               소분류가 없습니다.
               <button class="btn btn-sm btn-outline"
                 onclick="openSubcategoryModal('','','${cat.id}','${esc(cat.category_name)}',1)"
                 style="padding:3px 10px;font-size:12px">+ 추가</button>
             </div>`}
      </div>`;
  }).join('');
}

function openCategoryModal(id='', name='', type='client', order=0) {
  document.getElementById('category-edit-id').value        = id;
  document.getElementById('category-name-input').value     = name;
  document.getElementById('category-type-input').value     = type;
  document.getElementById('category-order-input').value    = order;
  document.getElementById('categoryModalTitle').textContent = id ? '대분류 수정' : '대분류 추가';
  openModal('categoryModal');
  setTimeout(() => document.getElementById('category-name-input').focus(), 100);
}

async function saveCategory() {
  const session = getSession();
  if (!Auth.canManageRefData(session)) { Toast.warning('권한이 없습니다.'); return; }
  const id    = document.getElementById('category-edit-id').value;
  const name  = document.getElementById('category-name-input').value.trim();
  const type  = document.getElementById('category-type-input').value;
  const order = parseInt(document.getElementById('category-order-input').value) || 0;
  if (!name) { Toast.warning('대분류명을 입력하세요.'); return; }
  try {
    const data = { category_name: name, category_type: type, sort_order: order };
    if (id) { await API.update('work_categories', id, data); Toast.success('수정되었습니다.'); }
    else    { await API.create('work_categories', data);      Toast.success('추가되었습니다.'); }
    closeModal('categoryModal');
    await loadCategories();
  } catch(err) { Toast.error('저장 실패: ' + (err && err.message ? err.message : '알 수 없는 오류')); }
}

async function deleteCategory(id, name, subCount) {
  const session = getSession();
  if (!Auth.canManageRefData(session)) { Toast.warning('권한이 없습니다.'); return; }
  if (subCount > 0) { Toast.warning(`소분류 ${subCount}개가 있습니다. 먼저 삭제해주세요.`); return; }
  if (!await Confirm.delete(name)) return;
  try {
    await API.delete('work_categories', id);
    Toast.success('삭제되었습니다.');
    await loadCategories();
  } catch (err) {
    const msg = err && err.message ? err.message : '알 수 없는 오류';
    console.error('[deleteCategory] 실패:', msg);
    Toast.error('삭제 실패: ' + msg);
  }
}

function openSubcategoryModal(id='', name='', parentId='', parentName='', order=0) {
  document.getElementById('subcategory-edit-id').value     = id;
  document.getElementById('subcategory-name-input').value  = name;
  document.getElementById('subcategory-parent-id').value   = parentId;
  document.getElementById('subcategory-order-input').value = order;
  document.getElementById('subcategoryModalTitle').textContent =
    (id ? '소분류 수정' : '소분류 추가') + (parentName ? ` — ${parentName}` : '');
  openModal('subcategoryModal');
  setTimeout(() => document.getElementById('subcategory-name-input').focus(), 100);
}

async function saveSubcategory() {
  const session = getSession();
  if (!Auth.canManageRefData(session)) { Toast.warning('권한이 없습니다.'); return; }
  const id       = document.getElementById('subcategory-edit-id').value;
  const name     = document.getElementById('subcategory-name-input').value.trim();
  const parentId = document.getElementById('subcategory-parent-id').value;
  const order    = parseInt(document.getElementById('subcategory-order-input').value) || 0;
  if (!name)     { Toast.warning('소분류명을 입력하세요.'); return; }
  if (!parentId) { Toast.warning('대분류 정보가 없습니다.'); return; }
  try {
    const data = { category_id: parentId, sub_category_name: name, sort_order: order };
    if (id) { await API.update('work_subcategories', id, data); Toast.success('수정되었습니다.'); }
    else    { await API.create('work_subcategories', data);      Toast.success('추가되었습니다.'); }
    closeModal('subcategoryModal');
    await loadCategories();
  } catch(err) { Toast.error('저장 실패: ' + (err && err.message ? err.message : '알 수 없는 오류')); }
}

async function deleteSubcategory(id, name) {
  const session = getSession();
  if (!Auth.canManageRefData(session)) { Toast.warning('권한이 없습니다.'); return; }
  if (!await Confirm.delete(name)) return;
  try {
    await API.delete('work_subcategories', id);
    Toast.success('삭제되었습니다.');
    await loadCategories();
  } catch (err) {
    const msg = err && err.message ? err.message : '알 수 없는 오류';
    console.error('[deleteSubcategory] 실패:', msg);
    Toast.error('삭제 실패: ' + msg);
  }
}

function openCategoryUploadModal() { openModal('categoryUploadModal'); }

async function uploadCategories() {
  const file = document.getElementById('category-upload-file').files[0];
  if (!file) { Toast.warning('파일을 선택하세요.'); return; }
  try {
    const data     = await Utils.parseExcel(file);
    const existing = await Master.categories();
    const existSubs = await Master.subcategories();
    const catNameMap = {};
    existing.forEach(c => { catNameMap[c.category_name] = c.id; });
    const existSubSet = new Set(existSubs.map(s => `${s.category_id}::${s.sub_category_name}`));
    let added = 0, skipped = 0, order = existing.length;
    for (const row of data) {
      const catName = String(row['대분류'] || Object.values(row)[0] || '').trim();
      const subName = String(row['소분류'] || Object.values(row)[1] || '').trim();
      const typeRaw = String(row['유형']   || Object.values(row)[2] || 'client').trim().toLowerCase();
      const catType = typeRaw === 'internal' ? 'internal' : 'client';
      if (!catName) continue;
      if (!catNameMap[catName]) {
        const r = await API.create('work_categories', { category_name: catName, category_type: catType, sort_order: order++ });
        catNameMap[catName] = r.id;
        added++;
      }
      if (subName) {
        const key = `${catNameMap[catName]}::${subName}`;
        if (existSubSet.has(key)) { skipped++; continue; }
        await API.create('work_subcategories', { category_id: catNameMap[catName], sub_category_name: subName, sort_order: 0 });
        existSubSet.add(key);
        added++;
      }
    }
    const result = document.getElementById('category-upload-result');
    result.style.display = '';
    result.innerHTML = `<i class="fas fa-check-circle"></i> 추가 ${added}건 완료 / 중복 스킵 ${skipped}건`;
    await loadCategories();
  } catch (err) { Toast.error('업로드 실패: ' + err.message); }
}

async function downloadCategoryTemplate() {
  if (typeof XLSX === 'undefined') await LibLoader.load('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['대분류', '소분류', '유형(client/internal)'],
    ['세무자문', '세무조사 대응', 'client'],
    ['세무자문', '세금신고서 검토', 'client'],
    ['법률자문', '계약서 검토', 'client'],
    ['내부업무', '팀 내부회의', 'internal'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, '카테고리');
  xlsxDownload(wb, '업무카테고리_업로드_양식.xlsx');
}

// ─────────────────────────────────────────────
// 유틸: HTML 특수문자 이스케이프 (인라인 이벤트용)
// ─────────────────────────────────────────────
function esc(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
