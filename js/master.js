/* ============================================================
   master.js  –  마스터 데이터 관리
   (팀, 고객사, 카테고리, 하위카테고리, 사건/사업)
   ============================================================ */
'use strict';

/* ── 상태 ── */
let _msSession = null;
let _msTab     = 'client';   /* client | category | case | team */

/* ══════════════════════════════════════════════
   진입점
══════════════════════════════════════════════ */
async function init_master() {
  _msSession = Session.require();
  if (!_msSession) return;

  /* 권한 체크 – admin만 접근 */
  if (!Auth.isAdmin(_msSession)) {
    document.getElementById('master-no-permission')?.style &&
      (document.getElementById('master-no-permission').style.display = '');
    document.getElementById('master-main')?.style &&
      (document.getElementById('master-main').style.display = 'none');
    return;
  }

  _bindMsTabEvents();
  await _loadMsTab(_msTab);
}

/* ══════════════════════════════════════════════
   탭 이벤트
══════════════════════════════════════════════ */
function _bindMsTabEvents() {
  document.querySelectorAll('[data-ms-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _msTab = btn.dataset.msTab;
      document.querySelectorAll('[data-ms-tab]').forEach(b =>
        b.classList.toggle('active', b.dataset.msTab === _msTab));
      _loadMsTab(_msTab);
    });
  });
}

async function _loadMsTab(tab) {
  if (tab === 'client')   await loadClients();
  else if (tab === 'category') await loadCategories();
  else if (tab === 'case')     await loadCases();
  else if (tab === 'team')     await loadTeams();
}

/* ══════════════════════════════════════════════
   고객사 관리
══════════════════════════════════════════════ */
async function loadClients() {
  const wrap = document.getElementById('ms-client-list');
  if (!wrap) return;
  wrap.innerHTML = _msSkeleton(4);

  try {
    const r = await API.list('clients', { limit: 200, sort: 'name' });
    const clients = r?.data ?? [];
    Master.invalidate('clients');

    if (!clients.length) {
      wrap.innerHTML = _msEmpty('등록된 고객사가 없습니다.');
      return;
    }

    wrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
            <th style="padding:10px 12px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">고객사명</th>
            <th style="padding:10px 12px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">코드</th>
            <th style="padding:10px 12px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">담당자</th>
            <th style="padding:10px 12px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">연락처</th>
            <th style="padding:10px 12px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">상태</th>
            <th style="padding:10px 12px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">관리</th>
          </tr>
        </thead>
        <tbody>
          ${clients.map(c => `
            <tr style="border-bottom:1px solid #f1f5f9;" data-client-id="${c.id}">
              <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1e293b;">${Utils.escHtml(c.name)}</td>
              <td style="padding:10px 12px;font-size:12px;color:#64748b;">${Utils.escHtml(c.code || '-')}</td>
              <td style="padding:10px 12px;font-size:12px;color:#64748b;">${Utils.escHtml(c.contact_name || '-')}</td>
              <td style="padding:10px 12px;font-size:12px;color:#64748b;">${Utils.escHtml(c.contact_phone || '-')}</td>
              <td style="padding:10px 12px;text-align:center;">
                <span class="badge ${c.is_active !== false ? 'badge-success' : 'badge-secondary'}">
                  ${c.is_active !== false ? '활성' : '비활성'}
                </span>
              </td>
              <td style="padding:10px 12px;text-align:center;white-space:nowrap;">
                <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;"
                  onclick="openClientModal('${c.id}')">
                  <i class="fa-solid fa-pen"></i> 수정
                </button>
                <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:#dc2626;"
                  onclick="deleteClient('${c.id}','${Utils.escHtml(c.name)}')">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    wrap.innerHTML = _msError('고객사 로드 실패');
  }
}
window.loadClients = loadClients;

/* ── 고객사 모달 ── */
async function openClientModal(id = null) {
  let data = {};
  if (id) {
    const r = await API.get('clients', id);
    data = r?.data ?? r ?? {};
  }

  _openMsModal({
    title: id ? '고객사 수정' : '고객사 추가',
    fields: [
      { key: 'name',          label: '고객사명',  type: 'text',     required: true,  value: data.name || '' },
      { key: 'code',          label: '코드',      type: 'text',     required: false, value: data.code || '' },
      { key: 'contact_name',  label: '담당자',    type: 'text',     required: false, value: data.contact_name || '' },
      { key: 'contact_phone', label: '연락처',    type: 'text',     required: false, value: data.contact_phone || '' },
      { key: 'contact_email', label: '이메일',    type: 'email',    required: false, value: data.contact_email || '' },
      { key: 'memo',          label: '메모',      type: 'textarea', required: false, value: data.memo || '' },
      { key: 'is_active',     label: '활성 여부', type: 'checkbox', required: false, value: data.is_active !== false },
    ],
    onSave: async (formData) => {
      if (id) {
        await API.update('clients', id, formData);
        Toast.success('고객사가 수정되었습니다.');
      } else {
        await API.create('clients', formData);
        Toast.success('고객사가 추가되었습니다.');
      }
      Master.invalidate('clients');
      await loadClients();
    }
  });
}
window.openClientModal = openClientModal;

async function deleteClient(id, name) {
  const ok = await Confirm.show({
    title: '고객사 삭제',
    message: `"${name}" 고객사를 삭제하시겠습니까?\n관련 업무 내역은 유지됩니다.`,
    confirmText: '삭제',
    confirmClass: 'btn-danger'
  });
  if (!ok) return;
  try {
    await API.delete('clients', id);
    Master.invalidate('clients');
    Toast.success('삭제되었습니다.');
    await loadClients();
  } catch (err) {
    Toast.error('삭제 중 오류가 발생했습니다.');
  }
}
window.deleteClient = deleteClient;

/* ══════════════════════════════════════════════
   카테고리 관리
══════════════════════════════════════════════ */
async function loadCategories() {
  const wrap = document.getElementById('ms-category-list');
  if (!wrap) return;
  wrap.innerHTML = _msSkeleton(4);

  try {
    const [catR, subR] = await Promise.all([
      API.list('categories',    { limit: 200, sort: 'sort_order' }),
      API.list('subcategories', { limit: 500, sort: 'sort_order' }),
    ]);
    const cats = catR?.data ?? [];
    const subs = subR?.data ?? [];
    Master.invalidate('categories');

    if (!cats.length) {
      wrap.innerHTML = _msEmpty('등록된 카테고리가 없습니다.');
      return;
    }

    wrap.innerHTML = cats.map(cat => {
      const mySubs = subs.filter(s => s.category_id === cat.id);
      return `
        <div class="card" style="margin-bottom:10px;">
          <div class="card-header" style="background:#f8fafc;">
            <span class="card-title" style="font-size:13.5px;">
              <i class="fa-solid fa-folder" style="color:#d97706;"></i>
              ${Utils.escHtml(cat.name)}
              <span style="font-size:11px;color:#94a3b8;margin-left:6px;">하위 ${mySubs.length}개</span>
            </span>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;"
                onclick="openCategoryModal('${cat.id}')">
                <i class="fa-solid fa-pen"></i> 수정
              </button>
              <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:#2d6bb5;"
                onclick="openSubcategoryModal(null,'${cat.id}')">
                <i class="fa-solid fa-plus"></i> 하위 추가
              </button>
              <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:#dc2626;"
                onclick="deleteCategory('${cat.id}','${Utils.escHtml(cat.name)}')">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
          ${mySubs.length ? `
            <div style="padding:8px 12px;">
              <div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${mySubs.map(s => `
                  <div style="display:inline-flex;align-items:center;gap:5px;background:#f1f5f9;border-radius:6px;padding:4px 10px;">
                    <span style="font-size:12px;color:#334155;">${Utils.escHtml(s.name)}</span>
                    <button style="background:none;border:none;cursor:pointer;color:#94a3b8;padding:0 2px;font-size:11px;"
                      onclick="openSubcategoryModal('${s.id}','${cat.id}')">✎</button>
                    <button style="background:none;border:none;cursor:pointer;color:#dc2626;padding:0 2px;font-size:11px;"
                      onclick="deleteSubcategory('${s.id}','${Utils.escHtml(s.name)}')">✕</button>
                  </div>`).join('')}
              </div>
            </div>` : ''}
        </div>`;
    }).join('');
  } catch (err) {
    wrap.innerHTML = _msError('카테고리 로드 실패');
  }
}
window.loadCategories = loadCategories;

async function openCategoryModal(id = null) {
  let data = {};
  if (id) {
    const r = await API.get('categories', id);
    data = r?.data ?? r ?? {};
  }
  _openMsModal({
    title: id ? '카테고리 수정' : '카테고리 추가',
    fields: [
      { key: 'name',       label: '카테고리명', type: 'text',   required: true,  value: data.name || '' },
      { key: 'sort_order', label: '정렬순서',   type: 'number', required: false, value: data.sort_order ?? 0 },
      { key: 'memo',       label: '메모',       type: 'textarea',required: false,value: data.memo || '' },
    ],
    onSave: async (formData) => {
      if (id) { await API.update('categories', id, formData); Toast.success('수정되었습니다.'); }
      else     { await API.create('categories', formData);    Toast.success('추가되었습니다.'); }
      Master.invalidate('categories');
      await loadCategories();
    }
  });
}
window.openCategoryModal = openCategoryModal;

async function deleteCategory(id, name) {
  const ok = await Confirm.show({
    title: '카테고리 삭제',
    message: `"${name}" 카테고리를 삭제하시겠습니까?\n하위 카테고리도 함께 삭제됩니다.`,
    confirmText: '삭제', confirmClass: 'btn-danger'
  });
  if (!ok) return;
  try {
    await API.delete('categories', id);
    Master.invalidate('categories');
    Toast.success('삭제되었습니다.');
    await loadCategories();
  } catch (err) { Toast.error('삭제 실패'); }
}
window.deleteCategory = deleteCategory;

async function openSubcategoryModal(id = null, categoryId) {
  let data = {};
  if (id) {
    const r = await API.get('subcategories', id);
    data = r?.data ?? r ?? {};
  }
  _openMsModal({
    title: id ? '하위카테고리 수정' : '하위카테고리 추가',
    fields: [
      { key: 'name',       label: '하위카테고리명', type: 'text',   required: true,  value: data.name || '' },
      { key: 'sort_order', label: '정렬순서',       type: 'number', required: false, value: data.sort_order ?? 0 },
    ],
    onSave: async (formData) => {
      formData.category_id = categoryId;
      if (id) { await API.update('subcategories', id, formData); Toast.success('수정되었습니다.'); }
      else     { await API.create('subcategories', formData);    Toast.success('추가되었습니다.'); }
      Master.invalidate('categories');
      await loadCategories();
    }
  });
}
window.openSubcategoryModal = openSubcategoryModal;

async function deleteSubcategory(id, name) {
  const ok = await Confirm.show({
    title: '하위카테고리 삭제',
    message: `"${name}"을 삭제하시겠습니까?`,
    confirmText: '삭제', confirmClass: 'btn-danger'
  });
  if (!ok) return;
  try {
    await API.delete('subcategories', id);
    Master.invalidate('categories');
    Toast.success('삭제되었습니다.');
    await loadCategories();
  } catch (err) { Toast.error('삭제 실패'); }
}
window.deleteSubcategory = deleteSubcategory;
/* ══════════════════════════════════════════════
   사건/사업 관리
══════════════════════════════════════════════ */
async function loadCases() {
  const wrap = document.getElementById('ms-case-list');
  if (!wrap) return;
  wrap.innerHTML = _msSkeleton(4);

  try {
    const [caseR, cliR] = await Promise.all([
      API.list('cases',   { limit: 500, sort: '-created_at' }),
      API.list('clients', { limit: 200, sort: 'name' }),
    ]);
    const cases   = caseR?.data ?? [];
    const clients = cliR?.data  ?? [];
    const cliMap  = Object.fromEntries(clients.map(c => [c.id, c.name]));
    Master.invalidate('cases');

    if (!cases.length) {
      wrap.innerHTML = _msEmpty('등록된 사건/사업이 없습니다.');
      return;
    }

    /* 고객사별 그룹 */
    const grouped = {};
    cases.forEach(c => {
      const cid = c.client_id || 'none';
      if (!grouped[cid]) grouped[cid] = [];
      grouped[cid].push(c);
    });

    wrap.innerHTML = Object.entries(grouped).map(([cid, items]) => {
      const cliName = cid === 'none' ? '(고객사 없음)' : (cliMap[cid] || cid);
      return `
        <div class="card" style="margin-bottom:10px;">
          <div class="card-header" style="background:#f8fafc;">
            <span class="card-title" style="font-size:13px;">
              <i class="fa-solid fa-building" style="color:#2d6bb5;"></i>
              ${Utils.escHtml(cliName)}
              <span style="font-size:11px;color:#94a3b8;margin-left:6px;">${items.length}건</span>
            </span>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="background:#fafbfc;">
                  <th style="padding:8px 12px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">사건/사업명</th>
                  <th style="padding:8px 12px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">코드</th>
                  <th style="padding:8px 12px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">시작일</th>
                  <th style="padding:8px 12px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">종료일</th>
                  <th style="padding:8px 12px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">상태</th>
                  <th style="padding:8px 12px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">관리</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(item => `
                  <tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:8px 12px;font-size:12.5px;color:#1e293b;font-weight:500;">${Utils.escHtml(item.name)}</td>
                    <td style="padding:8px 12px;font-size:12px;color:#64748b;">${Utils.escHtml(item.code || '-')}</td>
                    <td style="padding:8px 12px;font-size:12px;color:#64748b;">${item.start_date || '-'}</td>
                    <td style="padding:8px 12px;font-size:12px;color:#64748b;">${item.end_date || '-'}</td>
                    <td style="padding:8px 12px;text-align:center;">
                      <span class="badge ${item.is_active !== false ? 'badge-success' : 'badge-secondary'}">
                        ${item.is_active !== false ? '진행중' : '종료'}
                      </span>
                    </td>
                    <td style="padding:8px 12px;text-align:center;white-space:nowrap;">
                      <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;"
                        onclick="openCaseModal('${item.id}')">
                        <i class="fa-solid fa-pen"></i> 수정
                      </button>
                      <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:#dc2626;"
                        onclick="deleteCase('${item.id}','${Utils.escHtml(item.name)}')">
                        <i class="fa-solid fa-trash"></i>
                      </button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    wrap.innerHTML = _msError('사건/사업 로드 실패');
  }
}
window.loadCases = loadCases;

async function openCaseModal(id = null) {
  const cliR = await API.list('clients', { limit: 200, sort: 'name' });
  const clients = cliR?.data ?? [];

  let data = {};
  if (id) {
    const r = await API.get('cases', id);
    data = r?.data ?? r ?? {};
  }

  _openMsModal({
    title: id ? '사건/사업 수정' : '사건/사업 추가',
    fields: [
      {
        key: 'client_id', label: '고객사', type: 'select', required: true,
        value: data.client_id || '',
        options: [
          { value: '', label: '고객사 선택' },
          ...clients.map(c => ({ value: c.id, label: c.name }))
        ]
      },
      { key: 'name',       label: '사건/사업명', type: 'text',   required: true,  value: data.name || '' },
      { key: 'code',       label: '코드',        type: 'text',   required: false, value: data.code || '' },
      { key: 'start_date', label: '시작일',      type: 'date',   required: false, value: data.start_date || '' },
      { key: 'end_date',   label: '종료일',      type: 'date',   required: false, value: data.end_date || '' },
      { key: 'memo',       label: '메모',        type: 'textarea',required: false,value: data.memo || '' },
      { key: 'is_active',  label: '진행중',      type: 'checkbox',required: false,value: data.is_active !== false },
    ],
    onSave: async (formData) => {
      if (id) { await API.update('cases', id, formData); Toast.success('수정되었습니다.'); }
      else     { await API.create('cases', formData);    Toast.success('추가되었습니다.'); }
      Master.invalidate('cases');
      await loadCases();
    }
  });
}
window.openCaseModal = openCaseModal;

async function deleteCase(id, name) {
  const ok = await Confirm.show({
    title: '사건/사업 삭제',
    message: `"${name}"을 삭제하시겠습니까?`,
    confirmText: '삭제', confirmClass: 'btn-danger'
  });
  if (!ok) return;
  try {
    await API.delete('cases', id);
    Master.invalidate('cases');
    Toast.success('삭제되었습니다.');
    await loadCases();
  } catch (err) { Toast.error('삭제 실패'); }
}
window.deleteCase = deleteCase;

/* ══════════════════════════════════════════════
   팀 관리
══════════════════════════════════════════════ */
async function loadTeams() {
  const wrap = document.getElementById('ms-team-list');
  if (!wrap) return;
  wrap.innerHTML = _msSkeleton(3);

  try {
    const [teamR, userR] = await Promise.all([
      API.list('teams', { limit: 100, sort: 'name' }),
      API.list('users', { limit: 200 }),
    ]);
    const teams = teamR?.data ?? [];
    const users = userR?.data ?? [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));

    if (!teams.length) {
      wrap.innerHTML = _msEmpty('등록된 팀이 없습니다.');
      return;
    }

    wrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
            <th style="padding:10px 12px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">팀명</th>
            <th style="padding:10px 12px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">팀장</th>
            <th style="padding:10px 12px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">설명</th>
            <th style="padding:10px 12px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">관리</th>
          </tr>
        </thead>
        <tbody>
          ${teams.map(t => `
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#1e293b;">
                <i class="fa-solid fa-people-group" style="color:#7c3aed;margin-right:6px;"></i>
                ${Utils.escHtml(t.name)}
              </td>
              <td style="padding:10px 12px;font-size:12px;color:#64748b;">
                ${Utils.escHtml(userMap[t.leader_id] || '-')}
              </td>
              <td style="padding:10px 12px;font-size:12px;color:#64748b;">
                ${Utils.escHtml((t.description || '').slice(0, 40))}
              </td>
              <td style="padding:10px 12px;text-align:center;white-space:nowrap;">
                <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;"
                  onclick="openTeamModal('${t.id}')">
                  <i class="fa-solid fa-pen"></i> 수정
                </button>
                <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:#dc2626;"
                  onclick="deleteTeam('${t.id}','${Utils.escHtml(t.name)}')">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    wrap.innerHTML = _msError('팀 로드 실패');
  }
}
window.loadTeams = loadTeams;

async function openTeamModal(id = null) {
  const userR = await API.list('users', { limit: 200 });
  const users = (userR?.data ?? []).filter(u => u.role === 'manager' || u.role === 'admin');

  let data = {};
  if (id) {
    const r = await API.get('teams', id);
    data = r?.data ?? r ?? {};
  }

  _openMsModal({
    title: id ? '팀 수정' : '팀 추가',
    fields: [
      { key: 'name',        label: '팀명', type: 'text', required: true,  value: data.name || '' },
      {
        key: 'leader_id', label: '팀장', type: 'select', required: false,
        value: data.leader_id || '',
        options: [
          { value: '', label: '팀장 선택' },
          ...users.map(u => ({ value: u.id, label: u.name }))
        ]
      },
      { key: 'description', label: '설명', type: 'textarea', required: false, value: data.description || '' },
    ],
    onSave: async (formData) => {
      if (id) { await API.update('teams', id, formData); Toast.success('수정되었습니다.'); }
      else     { await API.create('teams', formData);    Toast.success('추가되었습니다.'); }
      await loadTeams();
    }
  });
}
window.openTeamModal = openTeamModal;

async function deleteTeam(id, name) {
  const ok = await Confirm.show({
    title: '팀 삭제',
    message: `"${name}" 팀을 삭제하시겠습니까?`,
    confirmText: '삭제', confirmClass: 'btn-danger'
  });
  if (!ok) return;
  try {
    await API.delete('teams', id);
    Toast.success('삭제되었습니다.');
    await loadTeams();
  } catch (err) { Toast.error('삭제 실패'); }
}
window.deleteTeam = deleteTeam;
/* ══════════════════════════════════════════════
   공통 모달 빌더
══════════════════════════════════════════════ */
function _openMsModal({ title, fields, onSave }) {
  /* 기존 모달 제거 */
  const existing = document.getElementById('_ms-modal');
  if (existing) document.body.removeChild(existing);

  const overlay = document.createElement('div');
  overlay.id = '_ms-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

  const fieldsHtml = fields.map(f => {
    let input = '';
    if (f.type === 'text' || f.type === 'email' || f.type === 'date') {
      input = `<input type="${f.type}" id="_ms-f-${f.key}"
        class="form-control" value="${Utils.escHtml(String(f.value ?? ''))}"
        ${f.required ? 'required' : ''} style="width:100%;box-sizing:border-box;">`;
    } else if (f.type === 'number') {
      input = `<input type="number" id="_ms-f-${f.key}"
        class="form-control" value="${f.value ?? 0}"
        style="width:100%;box-sizing:border-box;">`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="_ms-f-${f.key}" class="form-control" rows="3"
        style="width:100%;box-sizing:border-box;resize:vertical;">${Utils.escHtml(String(f.value ?? ''))}</textarea>`;
    } else if (f.type === 'checkbox') {
      input = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
        <input type="checkbox" id="_ms-f-${f.key}" ${f.value ? 'checked' : ''}
          style="width:16px;height:16px;">
        <span style="font-size:13px;color:#334155;">활성화</span>
      </label>`;
    } else if (f.type === 'select') {
      const opts = (f.options || []).map(o =>
        `<option value="${Utils.escHtml(String(o.value))}" ${String(f.value) === String(o.value) ? 'selected' : ''}>
          ${Utils.escHtml(o.label)}
        </option>`).join('');
      input = `<select id="_ms-f-${f.key}" class="form-control"
        style="width:100%;box-sizing:border-box;">${opts}</select>`;
    }

    return `<div class="form-group" style="margin-bottom:14px;">
      <label class="form-label" style="font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;display:block;">
        ${Utils.escHtml(f.label)}${f.required ? ' <span style="color:#dc2626;">*</span>' : ''}
      </label>
      ${input}
    </div>`;
  }).join('');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:24px;width:480px;max-width:92vw;
      max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
        <h3 style="font-size:16px;font-weight:700;color:#1e293b;margin:0;">${Utils.escHtml(title)}</h3>
        <button id="_ms-close" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer;padding:2px 6px;border-radius:4px;">✕</button>
      </div>
      <div id="_ms-form-body">${fieldsHtml}</div>
      <div id="_ms-form-err" style="color:#dc2626;font-size:12px;margin-bottom:8px;display:none;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;padding-top:14px;border-top:1px solid #f1f5f9;">
        <button id="_ms-cancel" class="btn btn-outline">취소</button>
        <button id="_ms-save"   class="btn btn-primary">
          <i class="fa-solid fa-floppy-disk"></i> 저장
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  /* 닫기 */
  const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
  overlay.querySelector('#_ms-close').onclick  = close;
  overlay.querySelector('#_ms-cancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  /* 저장 */
  overlay.querySelector('#_ms-save').onclick = async () => {
    const errEl  = overlay.querySelector('#_ms-form-err');
    const saveBtn = overlay.querySelector('#_ms-save');
    errEl.style.display = 'none';

    /* 유효성 */
    for (const f of fields) {
      if (f.required && f.type !== 'checkbox') {
        const el = overlay.querySelector(`#_ms-f-${f.key}`);
        if (!el || !el.value.trim()) {
          errEl.textContent = `"${f.label}" 항목을 입력하세요.`;
          errEl.style.display = '';
          el?.focus();
          return;
        }
      }
    }

    /* 데이터 수집 */
    const formData = {};
    fields.forEach(f => {
      const el = overlay.querySelector(`#_ms-f-${f.key}`);
      if (!el) return;
      if (f.type === 'checkbox') formData[f.key] = el.checked;
      else if (f.type === 'number') formData[f.key] = Number(el.value) || 0;
      else formData[f.key] = el.value.trim();
    });

    const restore = BtnLoading.start(saveBtn, '저장 중…');
    try {
      await onSave(formData);
      close();
    } catch (err) {
      console.error('[master] 저장 오류:', err);
      errEl.textContent = '저장 중 오류가 발생했습니다.';
      errEl.style.display = '';
    } finally {
      restore();
    }
  };

  /* Enter 키 저장 */
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      overlay.querySelector('#_ms-save').click();
    }
    if (e.key === 'Escape') close();
  });

  /* 첫 번째 인풋 포커스 */
  setTimeout(() => {
    const first = overlay.querySelector('input,select,textarea');
    if (first) first.focus();
  }, 80);
}

/* ══════════════════════════════════════════════
   공통 헬퍼
══════════════════════════════════════════════ */
function _msSkeleton(n) {
  return `<div style="display:flex;flex-direction:column;gap:10px;padding:12px;">
    ${Array(n).fill(0).map(() => `
      <div style="height:44px;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);
        background-size:200% 100%;animation:arch-shimmer 1.4s infinite;border-radius:8px;"></div>
    `).join('')}
  </div>`;
}

function _msEmpty(msg) {
  return `<div style="padding:48px;text-align:center;color:#94a3b8;font-size:13px;">
    <i class="fa-solid fa-inbox" style="font-size:28px;display:block;margin-bottom:10px;opacity:0.4;"></i>
    ${msg}
  </div>`;
}

function _msError(msg) {
  return `<div style="padding:24px;text-align:center;color:#dc2626;font-size:13px;">
    <i class="fa-solid fa-triangle-exclamation"></i> ${msg}
  </div>`;
}

/* ══════════════════════════════════════════════
   Excel 가져오기 (고객사/사건)
══════════════════════════════════════════════ */
async function importMasterExcel(type) {
  const input = document.createElement('input');
  input.type  = 'file';
  input.accept = '.xlsx,.xls';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const rows = await Utils.parseExcel(file);
      if (!rows || rows.length < 2) { Toast.error('데이터가 없습니다.'); return; }

      let success = 0;
      for (const row of rows.slice(1)) {
        if (!row[0]) continue;
        if (type === 'client') {
          await API.create('clients', {
            name: String(row[0]).trim(),
            code: String(row[1] || '').trim(),
            contact_name:  String(row[2] || '').trim(),
            contact_phone: String(row[3] || '').trim(),
            contact_email: String(row[4] || '').trim(),
            is_active: true,
          });
        } else if (type === 'case') {
          await API.create('cases', {
            name:       String(row[0]).trim(),
            code:       String(row[1] || '').trim(),
            start_date: String(row[2] || '').trim(),
            end_date:   String(row[3] || '').trim(),
            is_active:  true,
          });
        }
        success++;
      }
      Master.invalidate(type === 'client' ? 'clients' : 'cases');
      Toast.success(`${success}건 가져오기 완료`);
      if (type === 'client') await loadClients();
      else await loadCases();
    } catch (err) {
      Toast.error('가져오기 중 오류 발생');
    }
  };
  input.click();
}
window.importMasterExcel = importMasterExcel;

/* ══════════════════════════════════════════════
   외부 노출
══════════════════════════════════════════════ */
window.init_master          = init_master;
window.loadClients          = loadClients;
window.loadCategories       = loadCategories;
window.loadCases            = loadCases;
window.loadTeams            = loadTeams;
window.openClientModal      = openClientModal;
window.deleteClient         = deleteClient;
window.openCategoryModal    = openCategoryModal;
window.deleteCategory       = deleteCategory;
window.openSubcategoryModal = openSubcategoryModal;
window.deleteSubcategory    = deleteSubcategory;
window.openCaseModal        = openCaseModal;
window.deleteCase           = deleteCase;
window.openTeamModal        = openTeamModal;
window.deleteTeam           = deleteTeam;
window.importMasterExcel    = importMasterExcel;
