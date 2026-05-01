/* permission-management.js — 권한정책 관리 */
'use strict';

(() => {
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
      { value: 'ceo', label: '대표이사' },
      { value: 'mgmt_support', label: '경영지원팀장' },
    ],
    role: [
      { value: 'staff', label: '담당(staff)' },
      { value: 'manager', label: '팀장(manager)' },
      { value: 'director', label: '본부장(director)' },
      { value: 'top_mgr', label: '사업부장(top_mgr)' },
      { value: 'admin', label: '관리자(admin)' },
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
    const deptName = deptId ? String(deptEl?.selectedOptions?.[0]?.dataset?.name || '') : '';
    const target = String(_permTargetEl()?.value || '').trim();
    if (scopeType === 'role') {
      return { scopeType, roleKey: target, jobTitle: '', deptId: '', deptName: '' };
    }
    return { scopeType, roleKey: '', jobTitle: target, deptId, deptName };
  }

  function _permPolicyKey(menuKey, actionKey) {
    return `${menuKey}__${actionKey}`;
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
    _loadedRowsByKey = {};
    (rows || []).forEach((r) => {
      const k = _permPolicyKey(String(r.menu_key || ''), String(r.action_key || ''));
      _loadedRowsByKey[k] = r;
    });
    document.querySelectorAll('#perm-policy-body input[type="checkbox"][data-policy-key]').forEach((ck) => {
      const key = String(ck.dataset.policyKey || '');
      const hit = _loadedRowsByKey[key];
      ck.checked = !!(hit && hit.allow === true);
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
    if (meta.scopeType === 'role') {
      const rows = await API.listAllPages('permission_policies', {
        filter: `scope_type=eq.role&role_key=eq.${encodeURIComponent(meta.roleKey)}`,
        limit: 1000,
        maxPages: 10,
        sort: 'updated_at',
      }).catch(() => []);
      _permApplyLoadedRows(Array.isArray(rows) ? rows : []);
      return;
    }
    const rows = await API.listAllPages('permission_policies', {
      filter: `scope_type=eq.dept_job&job_title=eq.${encodeURIComponent(meta.jobTitle)}`,
      limit: 1000,
      maxPages: 10,
      sort: 'updated_at',
    }).catch(() => []);
    const matched = (Array.isArray(rows) ? rows : []).filter((r) => {
      const rowDeptId = String(r?.dept_id || '').trim();
      const rowDeptName = String(r?.dept_name || '').trim();
      if (rowDeptId) return rowDeptId === meta.deptId;
      return !!rowDeptName && rowDeptName === String(meta.deptName || '').trim();
    });
    _permApplyLoadedRows(matched);
  }

  async function _permSavePolicies() {
    const session = getSession ? getSession() : null;
    if (!Auth.canManageMaster(session)) {
      Toast.warning('권한정책 저장 권한이 없습니다.');
      return;
    }
    const meta = _permCurrentMeta();
    if (meta.scopeType === 'dept_job' && (!meta.deptId || !meta.jobTitle)) {
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
      for (const ck of checks) {
        const menuKey = String(ck.dataset.menuKey || '').trim();
        const actionKey = String(ck.dataset.actionKey || '').trim();
        const want = !!ck.checked;
        if (!menuKey || !actionKey) continue;
        const rowKey = _permPolicyKey(menuKey, actionKey);
        const hit = _loadedRowsByKey[rowKey] || null;
        if (hit && !!hit.allow === want) continue;
        const payload = {
          scope_type: meta.scopeType,
          role_key: meta.roleKey || '',
          dept_id: meta.deptId || '',
          dept_name: meta.deptName || '',
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
      await _permLoadPolicies();
      Toast.success(changed > 0 ? `권한정책 ${changed}건을 저장했습니다.` : '변경된 권한이 없습니다.');
    } catch (e) {
      console.error(e);
      Toast.error('권한정책 저장 실패: ' + (e?.message || ''));
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
