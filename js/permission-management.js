/* permission-management.js — 권한정책 관리 */
'use strict';

(() => {
  const DEPT_GROUP_CRB_COB = '__dept_group_crb_cob__';
  const DEPT_GROUP_CRB_COB_NAMES = ['CRB', 'COB'];

  const POLICY_ACTIONS = [
    { key: 'read', label: '읽기' },
    { key: 'write', label: '쓰기' },
    { key: 'export', label: '출력' },
    { key: 'download', label: '다운로드' },
  ];

  const POLICY_TARGET_OPTIONS = {
    dept_job: [
      { value: 'staff_consultant', label: '담당(선임/전임/책임 통합)' },
      { value: 'team_lead', label: '팀장' },
      { value: 'division_head', label: '본부장' },
      { value: 'bu_head', label: '사업부장' },
      { value: 'system_admin', label: '시스템관리자(admin)' },
      { value: 'ceo', label: '대표이사' },
      { value: 'mgmt_support', label: '경영지원팀장' },
    ],
    role: [
      { value: 'staff', label: '담당(staff)' },
      { value: 'manager', label: '팀장(manager)' },
      { value: 'director', label: '본부장(director)' },
      { value: 'top_mgr', label: '사업부장(top_mgr)' },
      { value: 'admin', label: '시스템관리자(admin)' },
    ],
  };

  const POLICY_MENU_ROWS = [
    { level: 1, key: 'dashboard', label: 'Timelog dashboard' },
    { level: 1, key: 'project-dashboard', label: 'Project dashboard' },
    { level: 1, key: 'project-management', label: 'Project Management' },
    { level: 1, key: 'analysis', label: 'Analysis' },
    { level: 2, key: 'analysis-work', label: '분석 > 업무분석' },
    { level: 2, key: 'analysis-staff', label: '분석 > 고과분석' },
    { level: 2, key: 'analysis-labor', label: '분석 > 인건비 분석' },
    { level: 2, key: 'analysis-project-profit', label: '분석 > 프로젝트 매출·이익 분석' },
    { level: 1, key: 'approval', label: 'Approval' },
    { level: 1, key: 'archive', label: '자문 자료실' },
    { level: 1, key: 'project-deliverables', label: 'Project Outputs' },

    { level: 1, key: 'timesheet-root', label: 'Time Sheet' },
    { level: 2, key: 'entry-new-hourly', label: '업무 등록(시간제)' },
    { level: 2, key: 'entry-new-daily', label: '업무 등록(Daily)' },
    { level: 2, key: 'my-entries-hourly', label: 'My Time Sheet(시간제)' },
    { level: 2, key: 'my-entries-daily', label: 'My Time Sheet(Daily)' },
    { level: 2, key: 'my-entries', label: '컨설턴트 업무 기록' },

    { level: 1, key: 'refdata-root', label: '등록정보' },
    { level: 2, key: 'master-clients', label: '고객사 등록' },
    { level: 2, key: 'master-categories', label: '업무분류 등록' },
    { level: 2, key: 'project-register', label: '프로젝트 등록' },

    { level: 1, key: 'settings-root', label: 'Settings' },
    { level: 2, key: 'master-org', label: '사업부·본부 관리' },
    { level: 2, key: 'master-teams', label: '업무팀 관리' },
    { level: 2, key: 'master-csteams', label: '고객지원팀 관리' },
    { level: 2, key: 'master-project-codes', label: '프로젝트 Code 관리' },
    { level: 2, key: 'users', label: 'User 등록' },
    { level: 2, key: 'permission-management', label: '권한관리' },
  ];

  let _bound = false;
  let _loadedRowsByKey = {};
  let _loadedRows = [];
  let _deptNameToId = {};

  function _permEsc(v) {
    return (typeof Utils !== 'undefined' && Utils.escHtml)
      ? Utils.escHtml(v == null ? '' : String(v))
      : String(v == null ? '' : v);
  }

  function _permScopeEl() { return document.getElementById('perm-policy-scope'); }
  function _permDeptEl() { return document.getElementById('perm-policy-dept'); }
  function _permTargetEl() { return document.getElementById('perm-policy-target'); }
  function _permBodyEl() { return document.getElementById('perm-policy-body'); }

  function _permCurrentScope() {
    return String(_permScopeEl()?.value || 'dept_job').trim();
  }

  function _permCurrentMeta() {
    const scopeType = _permCurrentScope();
    const deptEl = _permDeptEl();
    const deptId = String(deptEl?.value || '').trim();
    const selectedOpt = deptId ? deptEl?.selectedOptions?.[0] : null;
    const deptName = deptId ? String(selectedOpt?.dataset?.name || '') : '';
    const isDeptGroup = deptId === DEPT_GROUP_CRB_COB;
    const deptNames = isDeptGroup
      ? String(selectedOpt?.dataset?.groupNames || '')
        .split('|')
        .map((v) => String(v || '').trim())
        .filter(Boolean)
      : (deptName ? [deptName] : []);
    const deptIds = isDeptGroup
      ? String(selectedOpt?.dataset?.groupIds || '')
        .split('|')
        .map((v) => String(v || '').trim())
        .filter(Boolean)
      : (deptId ? [deptId] : []);
    const target = String(_permTargetEl()?.value || '').trim();
    if (scopeType === 'role') {
      return {
        scopeType, roleKey: target, jobTitle: '',
        deptId: '', deptName: '', deptIds: [], deptNames: [], isDeptGroup: false,
      };
    }
    return {
      scopeType,
      roleKey: '',
      jobTitle: target,
      deptId,
      deptName,
      deptIds,
      deptNames,
      isDeptGroup,
    };
  }

  function _permPolicyKey(menuKey, actionKey) {
    return `${menuKey}__${actionKey}`;
  }

  function _permRowIdentityKey(row) {
    const r = row || {};
    return [
      String(r.scope_type || '').trim(),
      String(r.role_key || '').trim(),
      String(r.dept_id || '').trim(),
      String(r.dept_name || '').trim(),
      String(r.job_title || '').trim(),
      String(r.menu_key || '').trim(),
      String(r.action_key || '').trim(),
    ].join('::');
  }

  function _permEffectiveMergeKey(row) {
    const r = row || {};
    const scope = String(r.scope_type || '').trim();
    const roleKey = String(r.role_key || '').trim();
    const deptId = String(r.dept_id || '').trim();
    const deptName = String(r.dept_name || '').trim();
    const menuKey = String(r.menu_key || '').trim();
    const actionKey = String(r.action_key || '').trim();
    // effective 병합 키는 "대상(역할/사업부) + 메뉴 + 액션" 기준
    // (job_title은 제외하여 상속 체인에서 최신 타깃이 부모를 덮어쓰게 함)
    if (scope === 'role') return [scope, roleKey, menuKey, actionKey].join('::');
    // dept_id만 있거나 dept_name만 있는 과거 데이터가 혼재할 수 있어
    // 사업부 식별은 dept_name 우선, 없으면 dept_id로 정규화한다.
    const deptScope = deptName || deptId;
    return [scope, deptScope, menuKey, actionKey].join('::');
  }

  function _permDeptTargets(meta) {
    if (!meta || meta.scopeType !== 'dept_job') return [{ deptId: '', deptName: '' }];
    const names = Array.isArray(meta.deptNames) ? meta.deptNames : [];
    const ids = Array.isArray(meta.deptIds) ? meta.deptIds : [];
    if (meta.isDeptGroup) {
      const targets = names.map((name, idx) => ({
        deptName: String(name || '').trim(),
        deptId: String(ids[idx] || _deptNameToId[String(name || '').trim()] || '').trim(),
      })).filter((t) => t.deptName);
      return targets.length ? targets : [{ deptId: '', deptName: '' }];
    }
    return [{ deptId: String(meta.deptId || '').trim(), deptName: String(meta.deptName || '').trim() }];
  }

  function _permRowMatchesMetaTarget(row, meta, target) {
    if (!row || !meta) return false;
    if (meta.scopeType === 'role') {
      return String(row.scope_type || '').trim() === 'role' &&
        String(row.role_key || '').trim() === String(meta.roleKey || '').trim();
    }
    if (String(row.scope_type || '').trim() !== 'dept_job') return false;
    if (String(row.job_title || '').trim() !== String(meta.jobTitle || '').trim()) return false;
    const tDeptId = String(target?.deptId || '').trim();
    const tDeptName = String(target?.deptName || '').trim();
    const rowDeptId = String(row.dept_id || '').trim();
    const rowDeptName = String(row.dept_name || '').trim();
    if (tDeptId && rowDeptId) return rowDeptId === tDeptId;
    return !!tDeptName && rowDeptName === tDeptName;
  }

  function _permParentTarget(scopeType, targetKey) {
    const scope = String(scopeType || '').trim();
    const key = String(targetKey || '').trim();
    if (!scope || !key) return '';
    if (scope === 'dept_job') {
      const chain = {
        team_lead: 'staff_consultant',
        division_head: 'team_lead',
        bu_head: 'division_head',
        system_admin: 'bu_head',
      };
      return chain[key] || '';
    }
    if (scope === 'role') {
      const chain = {
        manager: 'staff',
        director: 'manager',
        top_mgr: 'director',
        admin: 'top_mgr',
      };
      return chain[key] || '';
    }
    return '';
  }

  async function _permFetchRows(meta) {
    if (!meta) return [];
    if (meta.scopeType === 'role') {
      if (!meta.roleKey) return [];
      const rows = await API.listAllPages('permission_policies', {
        filter: `scope_type=eq.role&role_key=eq.${encodeURIComponent(meta.roleKey)}`,
        limit: 1000,
        maxPages: 10,
        sort: 'updated_at',
      }).catch(() => []);
      return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => Number(a?.updated_at || 0) - Number(b?.updated_at || 0));
    }
    if (!meta.jobTitle) return [];
    const rows = await API.listAllPages('permission_policies', {
      filter: `scope_type=eq.dept_job&job_title=eq.${encodeURIComponent(meta.jobTitle)}`,
      limit: 1000,
      maxPages: 10,
      sort: 'updated_at',
    }).catch(() => []);
    const allowDeptIds = new Set((meta.deptIds || []).map((v) => String(v || '').trim()).filter(Boolean));
    const allowDeptNames = new Set((meta.deptNames || []).map((v) => String(v || '').trim()).filter(Boolean));
    return (Array.isArray(rows) ? rows : []).filter((r) => {
      const rowDeptId = String(r?.dept_id || '').trim();
      const rowDeptName = String(r?.dept_name || '').trim();
      if (allowDeptIds.size || allowDeptNames.size) {
        if (rowDeptId && allowDeptIds.has(rowDeptId)) return true;
        if (rowDeptName && allowDeptNames.has(rowDeptName)) return true;
        return false;
      }
      if (rowDeptId) return rowDeptId === String(meta.deptId || '').trim();
      return !!rowDeptName && rowDeptName === String(meta.deptName || '').trim();
    }).slice().sort((a, b) => Number(a?.updated_at || 0) - Number(b?.updated_at || 0));
  }

  function _permMergeRowsWithParent(parentRows, ownRows) {
    const out = {};
    (Array.isArray(parentRows) ? parentRows : []).forEach((r) => {
      const k = _permEffectiveMergeKey(r);
      if (!k) return;
      out[k] = { ...r, _inherited: true, id: '' };
    });
    (Array.isArray(ownRows) ? ownRows : []).forEach((r) => {
      const k = _permEffectiveMergeKey(r);
      if (!k) return;
      out[k] = { ...r, _inherited: false };
    });
    return Object.values(out);
  }

  function _permBuildSystemAdminRows(meta) {
    const m = meta || {};
    const scopeType = String(m.scopeType || 'dept_job').trim();
    const roleKey = String(m.roleKey || '').trim();
    const jobTitle = String(m.jobTitle || '').trim() || 'system_admin';
    const deptTargets = _permDeptTargets(m);
    const rows = [];
    POLICY_MENU_ROWS.forEach((menu) => {
      POLICY_ACTIONS.forEach((act) => {
        if (scopeType === 'role') {
          rows.push({
            id: '',
            scope_type: 'role',
            role_key: roleKey || 'admin',
            dept_id: '',
            dept_name: '',
            job_title: '',
            menu_key: menu.key,
            action_key: act.key,
            allow: true,
            _inherited: true,
          });
        } else {
          (deptTargets || [{ deptId: '', deptName: '' }]).forEach((t) => {
            rows.push({
              id: '',
              scope_type: 'dept_job',
              role_key: '',
              dept_id: String(t?.deptId || '').trim(),
              dept_name: String(t?.deptName || '').trim(),
              job_title: jobTitle,
              menu_key: menu.key,
              action_key: act.key,
              allow: true,
              _inherited: true,
            });
          });
        }
      });
    });
    return rows;
  }

  async function _permFetchEffectiveRows(meta, depth = 0) {
    const guard = Number(depth || 0);
    if (!meta || guard > 8) return [];
    if (meta.scopeType === 'dept_job' && String(meta.jobTitle || '').trim() === 'system_admin') {
      const baseRows = _permBuildSystemAdminRows(meta);
      const ownRows = await _permFetchRows(meta);
      // 시스템관리자 기본값(전체허용) 위에 개별 저장값(허용/해제)을 덮어쓴다.
      return _permMergeRowsWithParent(baseRows, ownRows);
    }
    if (meta.scopeType === 'role' && String(meta.roleKey || '').trim() === 'admin') {
      const baseRows = _permBuildSystemAdminRows(meta);
      const ownRows = await _permFetchRows(meta);
      // role admin도 동일: 기본 전체허용 + 저장된 override 반영
      return _permMergeRowsWithParent(baseRows, ownRows);
    }
    const ownRows = await _permFetchRows(meta);
    const targetKey = meta.scopeType === 'role' ? meta.roleKey : meta.jobTitle;
    const parentTarget = _permParentTarget(meta.scopeType, targetKey);
    if (!parentTarget) return ownRows;
    const parentMeta = meta.scopeType === 'role'
      ? { ...meta, roleKey: parentTarget }
      : { ...meta, jobTitle: parentTarget };
    const parentEffectiveRows = await _permFetchEffectiveRows(parentMeta, guard + 1);
    return _permMergeRowsWithParent(parentEffectiveRows, ownRows);
  }

  function _permRenderTargetOptions() {
    const scope = _permCurrentScope();
    const targetEl = _permTargetEl();
    const deptEl = _permDeptEl();
    if (!targetEl || !deptEl) return;
    const rows = POLICY_TARGET_OPTIONS[scope] || [];
    const old = String(targetEl.value || '').trim();
    targetEl.innerHTML = '<option value="">대상 선택</option>' + rows.map((r) =>
      `<option value="${_permEsc(r.value)}">${_permEsc(r.label)}</option>`
    ).join('');
    if (old && rows.some((r) => r.value === old)) targetEl.value = old;
    const deptJob = scope === 'dept_job';
    deptEl.disabled = !deptJob;
  }

  function _permRenderMatrix() {
    const body = _permBodyEl();
    if (!body) return;
    body.innerHTML = POLICY_MENU_ROWS.map((row) => {
      const badge = row.level === 1 ? '상위' : (row.level === 2 ? '하위' : '최하위');
      const pad = row.level === 1 ? 6 : (row.level === 2 ? 18 : 32);
      const cells = POLICY_ACTIONS.map((a) => {
        const k = _permPolicyKey(row.key, a.key);
        return `<td style="text-align:center"><input type="checkbox" data-policy-key="${_permEsc(k)}" data-menu-key="${_permEsc(row.key)}" data-action-key="${_permEsc(a.key)}" /></td>`;
      }).join('');
      return `
        <tr>
          <td style="text-align:center"><span class="badge badge-gray">${_permEsc(badge)}</span></td>
          <td><div style="padding-left:${pad}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_permEsc(row.label)}</div></td>
          ${cells}
        </tr>
      `;
    }).join('');
  }

  async function _permFillDeptSelect() {
    const el = _permDeptEl();
    if (!el) return;
    const old = String(el.value || '').trim();
    el.innerHTML = '<option value="">사업부 선택</option>';
    try {
      const r = await API.list('departments', { limit: 300 });
      const depts = (r && r.data) ? r.data.filter((d) => !d.hq_name) : [];
      _deptNameToId = {};
      depts.forEach((d) => {
        const n = String(d.department_name || '').trim();
        if (n) _deptNameToId[n] = String(d.id || '').trim();
      });

      const hasCRB = DEPT_GROUP_CRB_COB_NAMES.some((n) => (_deptNameToId[n] || ''));
      const hasCOB = DEPT_GROUP_CRB_COB_NAMES.every((n) => (_deptNameToId[n] || ''));
      if (hasCRB && hasCOB) {
        const groupOpt = document.createElement('option');
        groupOpt.value = DEPT_GROUP_CRB_COB;
        groupOpt.textContent = 'CRB/COB (통합)';
        groupOpt.dataset.name = 'CRB/COB';
        groupOpt.dataset.groupNames = DEPT_GROUP_CRB_COB_NAMES.join('|');
        groupOpt.dataset.groupIds = DEPT_GROUP_CRB_COB_NAMES.map((n) => _deptNameToId[n] || '').join('|');
        el.appendChild(groupOpt);
      }
      depts.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.department_name || '-';
        opt.dataset.name = d.department_name || '';
        el.appendChild(opt);
      });
      if (old && Array.from(el.options).some((o) => String(o.value) === old)) el.value = old;
    } catch (e) {
      console.warn('[permission] departments load failed', e?.message || e);
    }
  }

  function _permApplyLoadedRows(rows) {
    _loadedRows = Array.isArray(rows) ? rows : [];
    _loadedRowsByKey = {};
    (_loadedRows || []).forEach((r) => {
      const k = _permPolicyKey(String(r.menu_key || ''), String(r.action_key || ''));
      if (!k || _loadedRowsByKey[k]) return;
      _loadedRowsByKey[k] = r;
    });
    document.querySelectorAll('#perm-policy-body input[type="checkbox"][data-policy-key]').forEach((ck) => {
      const key = String(ck.dataset.policyKey || '');
      const hits = (_loadedRows || []).filter((r) => _permPolicyKey(String(r.menu_key || ''), String(r.action_key || '')) === key);
      ck.checked = !!(hits.length && hits.every((r) => r && r.allow === true));
    });
  }

  async function _permLoadPolicies() {
    const body = _permBodyEl();
    if (!body) return;
    const meta = _permCurrentMeta();
    if (meta.scopeType === 'dept_job' && (!meta.deptId || !meta.jobTitle)) {
      _permApplyLoadedRows([]);
      return;
    }
    if (meta.scopeType === 'role' && !meta.roleKey) {
      _permApplyLoadedRows([]);
      return;
    }
    const effectiveRows = await _permFetchEffectiveRows(meta);
    _permApplyLoadedRows(effectiveRows);
  }

  async function _permSavePolicies() {
    const session = getSession ? getSession() : null;
    if (!Auth.canManageMaster(session)) {
      Toast.warning('권한정책 저장 권한이 없습니다.');
      return;
    }
    const meta = _permCurrentMeta();
    if (meta.scopeType === 'dept_job' && (!meta.jobTitle || !(meta.deptIds || []).length)) {
      Toast.warning('사업부와 직책을 먼저 선택하세요.');
      return;
    }
    if (meta.scopeType === 'role' && !meta.roleKey) {
      Toast.warning('역할을 먼저 선택하세요.');
      return;
    }
    try {
      const checks = Array.from(document.querySelectorAll('#perm-policy-body input[type="checkbox"][data-policy-key]'));
      let changed = 0;
      const targets = _permDeptTargets(meta);
      for (const ck of checks) {
        const menuKey = String(ck.dataset.menuKey || '').trim();
        const actionKey = String(ck.dataset.actionKey || '').trim();
        const want = !!ck.checked;
        if (!menuKey || !actionKey) continue;
        for (const target of targets) {
          const hit = (_loadedRows || []).find((r) => {
            if (!r || !r.id) return false;
            if (_permPolicyKey(String(r.menu_key || ''), String(r.action_key || '')) !== _permPolicyKey(menuKey, actionKey)) return false;
            return _permRowMatchesMetaTarget(r, meta, target);
          }) || null;
          if (hit && !!hit.allow === want) continue;
          const payload = {
            scope_type: meta.scopeType,
            role_key: meta.roleKey || '',
            dept_id: target.deptId || '',
            dept_name: target.deptName || '',
            job_title: meta.jobTitle || '',
            menu_key: menuKey,
            action_key: actionKey,
            allow: want,
            note: '권한관리 화면 저장',
            updated_at: Date.now(),
          };
          if (hit && hit.id) {
            await API.patch('permission_policies', hit.id, payload);
          } else {
            await API.create('permission_policies', {
              ...payload,
              created_by: String(session?.id || ''),
              created_by_name: String(session?.name || ''),
              created_at: Date.now(),
            });
          }
          changed += 1;
        }
      }
      await _permLoadPolicies();
      Toast.success(changed > 0 ? `권한정책 ${changed}건을 저장했습니다.` : '변경된 권한이 없습니다.');
    } catch (e) {
      console.error(e);
      Toast.error('권한정책 저장 실패: ' + (e?.message || ''));
    }
  }

  async function _permResetToInherited() {
    const session = getSession ? getSession() : null;
    if (!Auth.canManageMaster(session)) {
      Toast.warning('권한정책 초기화 권한이 없습니다.');
      return;
    }
    const meta = _permCurrentMeta();
    if (meta.scopeType === 'dept_job' && (!meta.jobTitle || !(meta.deptIds || []).length)) {
      Toast.warning('사업부와 직책을 먼저 선택하세요.');
      return;
    }
    if (meta.scopeType === 'role' && !meta.roleKey) {
      Toast.warning('역할을 먼저 선택하세요.');
      return;
    }
    const targetLabel = meta.scopeType === 'role'
      ? `역할(${meta.roleKey})`
      : `사업부(${meta.deptName || '-'}) / 직책(${meta.jobTitle})`;
    const ok = window.confirm(
      `[${targetLabel}]의 개별 권한(override)을 삭제하고 상속값으로 되돌립니다.\n계속하시겠습니까?`
    );
    if (!ok) return;
    try {
      const ownRows = await _permFetchRows(meta);
      const ownIds = (ownRows || []).map((r) => String(r.id || '').trim()).filter(Boolean);
      for (const id of ownIds) {
        await API.delete('permission_policies', id);
      }
      await _permLoadPolicies();
      Toast.success(ownIds.length
        ? `개별 권한 ${ownIds.length}건을 초기화하고 상속값으로 복원했습니다.`
        : '삭제할 개별 권한이 없어 상속값만 다시 반영했습니다.');
    } catch (e) {
      console.error(e);
      Toast.error('상속값 재초기화 실패: ' + (e?.message || ''));
    }
  }

  function _permBindOnce() {
    if (_bound) return;
    _bound = true;
    _permScopeEl()?.addEventListener('change', async () => {
      _permRenderTargetOptions();
      await _permLoadPolicies();
    });
    _permDeptEl()?.addEventListener('change', async () => {
      await _permLoadPolicies();
    });
    _permTargetEl()?.addEventListener('change', async () => {
      await _permLoadPolicies();
    });
    document.getElementById('perm-policy-reload-btn')?.addEventListener('click', async () => {
      await _permFillDeptSelect();
      _permRenderTargetOptions();
      await _permLoadPolicies();
      Toast.info('권한정책을 새로고침했습니다.');
    });
    document.getElementById('perm-policy-reset-inherit-btn')?.addEventListener('click', _permResetToInherited);
    document.getElementById('perm-policy-save-btn')?.addEventListener('click', _permSavePolicies);
  }

  async function init_permission_management() {
    const session = getSession ? getSession() : null;
    if (!Auth.canManageMaster(session)) {
      navigateTo('dashboard');
      Toast.warning('권한관리 접근 권한이 없습니다.');
      return;
    }
    _permBindOnce();
    _permRenderMatrix();
    await _permFillDeptSelect();
    _permRenderTargetOptions();
    await _permLoadPolicies();
  }

  window.init_permission_management = init_permission_management;
})();
