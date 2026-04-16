/* project-register.js — 프로젝트 등록 (manager+ director+ top_mgr+ admin) */
/* DB: registered_projects, fn_allocate_project_code — dev_schema_registered_projects.sql */

let _projRegRows = [];
let _projRegTypes = [];
let _projRegClients = [];

const _PROJ_REG_AMT_IDS = [
  'proj-reg-bill-down-amt',
  'proj-reg-bill-interim-amt',
  'proj-reg-bill-final-amt',
  'proj-reg-bill-add-amt',
  'proj-reg-bill-success-amt',
];

let _projRegClientSearchBound = false;
let _projRegAmtBound = false;

function _projRegMonthToYymm(monthVal) {
  if (!monthVal || !/^\d{4}-\d{2}$/.test(monthVal)) return '';
  const [y, m] = monthVal.split('-');
  return String(parseInt(y, 10) % 100).padStart(2, '0') + m;
}

function _projRegSetDefaultMonth() {
  const el = document.getElementById('proj-reg-yymm');
  if (!el) return;
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  el.value = `${y}-${mo}`;
}

function _projRegIsCpmEligible(u) {
  const r = u && u.role;
  return r === 'manager' || r === 'director' || r === 'top_mgr' || r === 'admin';
}

function _projRegParseDigits(v) {
  return String(v || '').replace(/[^\d]/g, '');
}

function _projRegAmtValue(id) {
  const raw = _projRegParseDigits(document.getElementById(id)?.value || '');
  if (raw === '') return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function _projRegNoteVal(id) {
  const t = document.getElementById(id)?.value?.trim() || '';
  return t ? t : null;
}

function _projRegNormStatus(r) {
  const s = String((r && r.registration_status) || '').trim().toLowerCase();
  if (s === 'draft' || s === 'pending' || s === 'rejected') return s;
  return 'approved';
}

function _projRegStatusLabel(st) {
  const m = { draft: '임시저장', pending: '승인대기', approved: '승인완료', rejected: '반려' };
  return m[st] || st || '-';
}

function _projRegStatusBadgeClass(st) {
  if (st === 'draft') return 'badge badge-gray';
  if (st === 'pending') return 'badge badge-yellow';
  if (st === 'rejected') return 'badge badge-red';
  return 'badge badge-green';
}

function _projRegYymmFromCode(code) {
  const parts = String(code || '').split('_');
  if (parts.length < 4) return '';
  const y = parts[2];
  return /^\d{4}$/.test(y) ? y : '';
}

function _projRegYymmToMonthValue(yymm) {
  if (!yymm || yymm.length !== 4) return '';
  const yy = parseInt(yymm.slice(0, 2), 10);
  const mm = yymm.slice(2, 4);
  if (!Number.isFinite(yy) || !/^\d{2}$/.test(mm)) return '';
  const fullY = 2000 + yy;
  return `${fullY}-${mm}`;
}

function _projRegIsOwner(session, r) {
  return r && String(r.created_by || '') === String(session.id || '');
}

async function _projRegRegistrantSnapshot(session) {
  let u = null;
  try {
    const users = await Master.users();
    u = users.find((x) => String(x.id) === String(session.id)) || null;
  } catch (_) {}
  const pa1Id = String((u && u.approver_id) || session.approver_id || '').trim();
  const pa1Name = String((u && u.approver_name) || session.approver_name || '').trim();
  const pa2Id = String((u && u.reviewer2_id) || session.reviewer2_id || '').trim();
  const pa2Name = String((u && u.reviewer2_name) || session.reviewer2_name || '').trim();
  return { pa1Id, pa1Name, pa2Id, pa2Name };
}

function _projRegEffectiveApprovers(row) {
  const a1 = String((row && row.reg_pa1_id) || '').trim();
  const a2 = String((row && row.reg_pa2_id) || '').trim();
  if (a1 && a2 && a1 === a2) return { pa1: a1, pa2: '', same: true };
  return { pa1: a1, pa2: a2, same: false };
}

function _projRegPendingStep(row) {
  if (_projRegNormStatus(row) !== 'pending') return null;
  const eff = _projRegEffectiveApprovers(row);
  const has1 = !!eff.pa1;
  const has2 = !!eff.pa2 && !eff.same;

  if (!row.first_approved_at) {
    if (eff.same && has1) return 1;
    if (has1) return 1;
    if (has2) return 2;
    return null;
  }
  if (has2 && !row.final_approved_at) return 2;
  return null;
}

function _projRegCanApproveRow(session, row) {
  const step = _projRegPendingStep(row);
  if (!step) return false;
  const sid = String(session.id || '');
  const eff = _projRegEffectiveApprovers(row);
  if (step === 1) {
    if (eff.same) return sid === eff.pa1;
    if (eff.pa1) return sid === eff.pa1;
    return sid === eff.pa2;
  }
  if (step === 2) return sid === eff.pa2;
  return false;
}

function _projRegCodeMatchesForm(row, typeId, yymm) {
  if (!row || !row.project_code || !typeId || !yymm) return false;
  if (String(row.project_code_type_id || '') !== String(typeId)) return false;
  return _projRegYymmFromCode(row.project_code) === yymm;
}

function projRegSetFormFieldsDisabled(disabled) {
  const root = document.querySelector('.proj-reg-main-col');
  if (!root) return;
  root.querySelectorAll('input,select,textarea').forEach((el) => {
    if (el.type === 'hidden') return;
    el.disabled = !!disabled;
  });
}

function projRegUpdateFormFooter(session, editId, row) {
  const st = editId && row ? _projRegNormStatus(row) : 'draft';
  const owner = !editId || _projRegIsOwner(session, row);
  const canAp = row && st === 'pending' && _projRegCanApproveRow(session, row);
  const footDraft = document.getElementById('proj-reg-footer-draft');
  const footAppr = document.getElementById('proj-reg-footer-approver');
  const btnAppr = document.getElementById('proj-reg-btn-save-approved');
  const banner = document.getElementById('proj-reg-status-banner');
  if (banner) {
    banner.hidden = !editId || !row;
    if (!banner.hidden) {
      banner.textContent = '';
      const badge = document.createElement('span');
      badge.className = _projRegStatusBadgeClass(st);
      badge.textContent = _projRegStatusLabel(st);
      banner.appendChild(badge);
      const step = st === 'pending' ? _projRegPendingStep(row) : null;
      if (st === 'pending' && step === 1) banner.appendChild(document.createTextNode(' (1차 승인 대기)'));
      else if (st === 'pending' && step === 2) banner.appendChild(document.createTextNode(' (2차 승인 대기)'));
      const rr = String(row.rejection_reason || '').trim();
      if (st === 'rejected' && rr) {
        banner.appendChild(document.createTextNode(' · 사유: ' + rr));
      }
    }
  }
  if (footDraft) footDraft.style.display = 'none';
  if (footAppr) footAppr.style.display = 'none';
  if (btnAppr) btnAppr.style.display = 'none';

  if (!editId) {
    if (footDraft) footDraft.style.display = 'inline-flex';
    projRegSetFormFieldsDisabled(false);
    return;
  }
  if (st === 'draft' && owner) {
    if (footDraft) footDraft.style.display = 'inline-flex';
    projRegSetFormFieldsDisabled(false);
    return;
  }
  if (st === 'rejected' && owner) {
    if (footDraft) footDraft.style.display = 'inline-flex';
    projRegSetFormFieldsDisabled(false);
    return;
  }
  if (st === 'approved') {
    if (btnAppr) btnAppr.style.display = 'inline-flex';
    projRegSetFormFieldsDisabled(false);
    const typeSel = document.getElementById('proj-reg-code-type');
    const yymmEl = document.getElementById('proj-reg-yymm');
    if (typeSel) typeSel.disabled = true;
    if (yymmEl) yymmEl.disabled = true;
    return;
  }
  if (st === 'pending' && canAp) {
    if (footAppr) footAppr.style.display = 'inline-flex';
    projRegSetFormFieldsDisabled(true);
    return;
  }
  projRegSetFormFieldsDisabled(true);
}

function projRegBindAmountInputs() {
  if (_projRegAmtBound) return;
  _PROJ_REG_AMT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('focus', () => {
      const raw = _projRegParseDigits(el.value);
      el.value = raw === '' ? '' : raw;
    });
    el.addEventListener('blur', () => {
      const raw = _projRegParseDigits(el.value);
      if (raw === '') el.value = '';
      else {
        const n = parseInt(raw, 10);
        el.value = Number.isFinite(n) ? n.toLocaleString('ko-KR') : '';
      }
    });
  });
  _projRegAmtBound = true;
}

function projRegHideClientSuggest() {
  const ul = document.getElementById('proj-reg-client-suggest');
  if (ul) {
    ul.innerHTML = '';
    ul.hidden = true;
  }
}

function projRegRenderClientSuggest(matches) {
  const ul = document.getElementById('proj-reg-client-suggest');
  if (!ul) return;
  ul.innerHTML = '';
  const lim = Math.min(matches.length, 40);
  for (let i = 0; i < lim; i++) {
    const c = matches[i];
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.clientId = c.id;
    li.dataset.clientName = c.company_name || '';
    li.textContent = c.company_name || c.id;
    ul.appendChild(li);
  }
  ul.hidden = lim === 0;
}

function projRegPickClient(id, name) {
  const hid = document.getElementById('proj-reg-client');
  const input = document.getElementById('proj-reg-client-search');
  if (hid) hid.value = id || '';
  if (input) input.value = name || '';
  projRegHideClientSuggest();
  projRegRefreshProgress();
}

function projRegOnClientSearchInput() {
  const input = document.getElementById('proj-reg-client-search');
  const hid = document.getElementById('proj-reg-client');
  if (!input || !hid) return;
  const selId = hid.value;
  if (selId) {
    const hit = _projRegClients.find((c) => String(c.id) === String(selId));
    const prevName = hit ? String(hit.company_name || '') : '';
    if (String(input.value).trim() !== prevName.trim()) {
      hid.value = '';
    }
  }
  const q = input.value.trim().toLowerCase();
  if (!q) {
    projRegHideClientSuggest();
    return;
  }
  const matches = _projRegClients.filter((c) => String(c.company_name || '').toLowerCase().includes(q));
  projRegRenderClientSuggest(matches);
}

function projRegBindClientSearch() {
  if (_projRegClientSearchBound) return;
  const input = document.getElementById('proj-reg-client-search');
  const wrap = document.querySelector('.proj-reg-client-wrap');
  if (!input || !wrap) return;
  input.addEventListener('input', projRegOnClientSearchInput);
  input.addEventListener('focus', () => {
    if (input.value.trim()) projRegOnClientSearchInput();
  });
  document.addEventListener('mousedown', (e) => {
    if (!wrap.contains(e.target)) projRegHideClientSuggest();
  });
  const ul = document.getElementById('proj-reg-client-suggest');
  if (ul) {
    ul.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-client-id]');
      if (!li) return;
      projRegPickClient(li.getAttribute('data-client-id'), li.getAttribute('data-client-name') || '');
    });
  }
  _projRegClientSearchBound = true;
}

function projRegOnRouteChange() {
  const sel = document.getElementById('proj-reg-route');
  const wrap = document.getElementById('proj-reg-route-other-wrap');
  if (!sel || !wrap) return;
  const isOther = sel.value === '기타';
  wrap.style.display = isOther ? '' : 'none';
  if (!isOther) {
    const o = document.getElementById('proj-reg-route-other');
    if (o) o.value = '';
  }
  projRegRefreshProgress();
}

function projRegApplyRouteFromStored(routeVal) {
  const v = String(routeVal || '').trim();
  const sel = document.getElementById('proj-reg-route');
  const other = document.getElementById('proj-reg-route-other');
  if (!sel) return;
  if (!v) {
    sel.value = '';
    if (other) other.value = '';
    projRegOnRouteChange();
    return;
  }
  const fixed = ['소개', 'RFP', '재수주', '기타'];
  if (fixed.includes(v)) {
    sel.value = v;
    if (other) other.value = '';
  } else {
    sel.value = '기타';
    if (other) other.value = v;
  }
  projRegOnRouteChange();
}

async function init_project_register() {
  const session = getSession();
  if (!Auth.canManageProjectRegister(session)) {
    navigateTo('dashboard');
    Toast.warning('프로젝트 등록 권한이 없습니다. (CCB 소속 또는 팀장 이상 권한 필요)');
    return;
  }
  projRegBindClientSearch();
  projRegBindAmountInputs();
  projRegShowList(false);
  projRegBindProgress();
  await projRegLoadTypes();
  await projRegFillDropdowns();
  await projRegLoadList();
}

function projRegShowList(reload) {
  const list = document.getElementById('proj-reg-list');
  const form = document.getElementById('proj-reg-form');
  if (list) list.style.display = '';
  if (form) form.style.display = 'none';
  if (reload !== false) projRegLoadList();
}

async function projRegLoadTypes() {
  try {
    _projRegTypes = await API.listAllPages('project_code_types', { limit: 500, maxPages: 5, sort: 'main_code' });
  } catch (e) {
    console.warn(e);
    _projRegTypes = [];
  }
  const sel = document.getElementById('proj-reg-code-type');
  if (!sel) return;
  sel.innerHTML = '<option value="">유형을 선택하세요</option>';
  _projRegTypes.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.main_category} · ${t.main_code} — ${t.sub_category} (${t.sub_code})`;
    opt.dataset.mainCode = t.main_code || '';
    opt.dataset.subCode = t.sub_code || '';
    opt.dataset.nameEn = t.project_name_en || '';
    sel.appendChild(opt);
  });
}

async function projRegFillDropdowns() {
  try {
    _projRegClients = await Master.clients();
  } catch (_) {
    _projRegClients = [];
  }

  let users = [];
  try {
    users = await Master.users();
  } catch (_) {
    users = [];
  }
  const cpmSel = document.getElementById('proj-reg-cpm');
  if (cpmSel) {
    const cur = cpmSel.value;
    cpmSel.innerHTML = '<option value="">선택 안 함</option>';
    users
      .filter((u) => u.deleted !== true && u.is_active !== false && _projRegIsCpmEligible(u))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .forEach((u) => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = `${u.name || '-'} (${u.email || ''})`;
        opt.dataset.name = u.name || '';
        cpmSel.appendChild(opt);
      });
    if (cur && [...cpmSel.options].some((o) => o.value === cur)) cpmSel.value = cur;
  }
}

function projRegScrollToSection(n) {
  const el = document.getElementById('proj-reg-sec-' + n);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let _projRegProgressBound = false;

function projRegBindProgress() {
  if (_projRegProgressBound) return;
  const form = document.getElementById('proj-reg-form');
  if (!form) return;
  const handler = () => projRegRefreshProgress();
  form.addEventListener('input', handler);
  form.addEventListener('change', handler);
  _projRegProgressBound = true;
}

function _projRegFieldVal(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}

function projRegRefreshProgress() {
  const form = document.getElementById('proj-reg-form');
  if (!form || form.style.display === 'none') return;

  const editId = _projRegFieldVal('proj-reg-edit-id');
  const isEdit = !!editId;
  const rowSt = _projRegFieldVal('proj-reg-row-status');
  const needsTypeYymm = !isEdit || rowSt === 'draft' || rowSt === 'rejected';
  const nameOk = _projRegFieldVal('proj-reg-name') !== '';
  let step1ok = false;
  if (needsTypeYymm) {
    step1ok = !!_projRegFieldVal('proj-reg-code-type') && !!_projRegFieldVal('proj-reg-yymm') && nameOk;
  } else {
    step1ok = nameOk;
  }
  const step2ok = !!_projRegFieldVal('proj-reg-client');

  const billIds = [
    'proj-reg-bill-down-amt', 'proj-reg-bill-down-due',
    'proj-reg-bill-interim-amt', 'proj-reg-bill-interim-due',
    'proj-reg-bill-final-amt', 'proj-reg-bill-final-due',
    'proj-reg-bill-add-amt', 'proj-reg-bill-add-due', 'proj-reg-bill-add-note',
    'proj-reg-bill-success-amt', 'proj-reg-bill-success-due', 'proj-reg-bill-success-note',
  ];
  const step3opt = billIds.some((id) => _projRegFieldVal(id) !== '');
  const fileEl = document.getElementById('proj-reg-contract');
  const exEl = document.getElementById('proj-reg-contract-existing');
  const hasSavedContract =
    exEl && !exEl.hidden && document.getElementById('proj-reg-contract-remove')?.value !== '1';
  const step4opt =
    !!_projRegFieldVal('proj-reg-period-start') ||
    !!_projRegFieldVal('proj-reg-period-end') ||
    !!(fileEl && fileEl.files && fileEl.files.length > 0) ||
    !!hasSavedContract;

  document.querySelectorAll('.proj-reg-step[data-proj-step]').forEach((btn) => {
    const n = btn.getAttribute('data-proj-step');
    const numEl = btn.querySelector('.proj-reg-step-num');
    btn.classList.remove('proj-reg-step--ok', 'proj-reg-step--need', 'proj-reg-step--opt-on');
    if (n === '1') {
      if (step1ok) {
        btn.classList.add('proj-reg-step--ok');
        if (numEl) numEl.textContent = '✓';
      } else {
        btn.classList.add('proj-reg-step--need');
        if (numEl) numEl.textContent = '1';
      }
    } else if (n === '2') {
      if (step2ok) {
        btn.classList.add('proj-reg-step--ok');
        if (numEl) numEl.textContent = '✓';
      } else {
        btn.classList.add('proj-reg-step--need');
        if (numEl) numEl.textContent = '2';
      }
    } else if (n === '3') {
      if (step3opt) btn.classList.add('proj-reg-step--opt-on');
      if (numEl) numEl.textContent = '3';
    } else if (n === '4') {
      if (step4opt) btn.classList.add('proj-reg-step--opt-on');
      if (numEl) numEl.textContent = '4';
    }
  });

  const reqDone = (step1ok ? 1 : 0) + (step2ok ? 1 : 0);
  const pct = Math.min(100, Math.round((reqDone / 2) * 100));
  const bar = document.getElementById('proj-reg-progress-bar');
  const lab = document.getElementById('proj-reg-progress-label');
  if (bar) bar.style.width = pct + '%';
  if (lab) {
    const miss = [];
    if (!step1ok) miss.push('① 코드·명칭');
    if (!step2ok) miss.push('② 발주처');
    const optParts = [];
    if (step3opt) optParts.push('금액·청구');
    if (step4opt) optParts.push('기간·첨부');
    const optStr = optParts.length ? ` · 선택 입력: ${optParts.join(', ')}` : '';
    const tail =
      rowSt === 'pending'
        ? ' (승인 대기 중에는 수정할 수 없습니다.)'
        : rowSt === 'draft' || rowSt === 'rejected' || !isEdit
          ? ' 임시저장 또는 승인 요청을 선택하세요.'
          : '';
    lab.textContent =
      reqDone >= 2
        ? '필수 입력을 모두 채웠습니다.' + tail + optStr
        : `필수 ${reqDone}/2 — ${miss.join(', ')}을(를) 완료하세요` + optStr;
  }
}

function projRegToggleAside() {
  if (typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 961px)').matches) return;
  const aside = document.getElementById('proj-reg-aside-panel');
  const tgl = document.getElementById('proj-reg-aside-toggle');
  const txt = document.getElementById('proj-reg-aside-toggle-text');
  if (!aside) return;
  const open = aside.classList.toggle('proj-reg-aside--open');
  if (tgl) tgl.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (txt) txt.textContent = open ? '도움말·필수 요약 접기' : '도움말·필수 요약 보기';
}

function _projRegResetAsidePanel() {
  const aside = document.getElementById('proj-reg-aside-panel');
  const tgl = document.getElementById('proj-reg-aside-toggle');
  const txt = document.getElementById('proj-reg-aside-toggle-text');
  if (aside) {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 960px)').matches) {
      aside.classList.remove('proj-reg-aside--open');
    } else {
      aside.classList.add('proj-reg-aside--open');
    }
  }
  if (tgl) tgl.setAttribute('aria-expanded', 'false');
  if (txt) txt.textContent = '도움말·필수 요약 보기';
}

function projRegResetContractUi() {
  const ex = document.getElementById('proj-reg-contract-existing');
  const rem = document.getElementById('proj-reg-contract-remove');
  const hint = document.getElementById('proj-reg-contract-remove-hint');
  const link = document.getElementById('proj-reg-contract-existing-link');
  if (ex) ex.hidden = true;
  if (rem) rem.value = '';
  if (hint) hint.hidden = true;
  if (link) {
    link.style.display = 'none';
    link.href = '#';
  }
  const n = document.getElementById('proj-reg-contract-existing-name');
  const m = document.getElementById('proj-reg-contract-existing-meta');
  if (n) n.textContent = '';
  if (m) m.textContent = '';
}

function projRegSyncContractExisting(r) {
  projRegResetContractUi();
  if (!r) return;
  const name = String(r.contract_file_name || '').trim();
  if (!name) return;
  const ex = document.getElementById('proj-reg-contract-existing');
  const nEl = document.getElementById('proj-reg-contract-existing-name');
  const mEl = document.getElementById('proj-reg-contract-existing-meta');
  const link = document.getElementById('proj-reg-contract-existing-link');
  if (nEl) nEl.textContent = name;
  let meta = '';
  if (r.contract_uploaded_at) {
    try {
      meta = Utils.formatDate ? Utils.formatDate(r.contract_uploaded_at) : String(r.contract_uploaded_at);
      meta = '등록 시각: ' + meta;
    } catch (_) {
      meta = '';
    }
  }
  if (mEl) mEl.textContent = meta;
  const url = String(r.contract_file_url || '').trim();
  if (link && url && /^https?:\/\//i.test(url)) {
    link.href = url;
    link.style.display = 'inline-flex';
  }
  if (ex) ex.hidden = false;
}

function projRegOnContractFileChange() {
  const rem = document.getElementById('proj-reg-contract-remove');
  const hint = document.getElementById('proj-reg-contract-remove-hint');
  const fileEl = document.getElementById('proj-reg-contract');
  if (rem) rem.value = '';
  if (hint) hint.hidden = true;
  const ex = document.getElementById('proj-reg-contract-existing');
  if (fileEl && fileEl.files && fileEl.files.length > 0 && ex) {
    ex.hidden = true;
  } else if (fileEl && (!fileEl.files || !fileEl.files.length)) {
    const editId = document.getElementById('proj-reg-edit-id')?.value;
    if (editId) {
      const r = _projRegRows.find((x) => x.id === editId);
      if (r && String(r.contract_file_name || '').trim()) projRegSyncContractExisting(r);
    }
  }
  projRegRefreshProgress();
}

function projRegMarkContractRemove() {
  document.getElementById('proj-reg-contract-remove').value = '1';
  const ex = document.getElementById('proj-reg-contract-existing');
  const hint = document.getElementById('proj-reg-contract-remove-hint');
  if (ex) ex.hidden = true;
  if (hint) hint.hidden = false;
  const fin = document.getElementById('proj-reg-contract');
  if (fin) fin.value = '';
  Toast.warning('저장하면 계약서 파일 메타(이름·시각·링크)가 삭제됩니다.');
  projRegRefreshProgress();
}

function projRegOnCodeTypeChange() {
  const sel = document.getElementById('proj-reg-code-type');
  const nameEl = document.getElementById('proj-reg-name');
  if (!sel || !nameEl || !sel.value) {
    projRegRefreshProgress();
    return;
  }
  const opt = sel.selectedOptions[0];
  if (opt && opt.dataset.nameEn && !nameEl.value.trim()) {
    nameEl.value = opt.dataset.nameEn;
  }
  projRegRefreshProgress();
}

async function projRegLoadList() {
  const tbody = document.getElementById('proj-reg-list-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="table-empty"><i class="fas fa-spinner fa-spin"></i><p>불러오는 중…</p></td></tr>';
  try {
    _projRegRows = await API.listAllPages('registered_projects', { limit: 500, maxPages: 10, sort: 'created_at' });
  } catch (e) {
    _projRegRows = [];
    Toast.error('목록 조회 실패: ' + (e.message || '') + ' — SQL 스키마를 적용했는지 확인하세요.');
  }
  projRegRenderList();
}

function projRegRenderList() {
  const tbody = document.getElementById('proj-reg-list-body');
  if (!tbody) return;
  const session = getSession();
  const q = (document.getElementById('proj-reg-filter-q')?.value || '').trim().toLowerCase();
  let rows = _projRegRows.slice();
  if (q) {
    rows = rows.filter((r) => {
      const st = _projRegNormStatus(r);
      const blob = [r.project_code, r.project_name, r.client_name, r.cpm_user_name, _projRegStatusLabel(st)].join(' ').toLowerCase();
      return blob.includes(q);
    });
  }
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty"><i class="fas fa-clipboard-list"></i><p>등록된 프로젝트가 없습니다.</p></td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r, i) => {
    const p0 = r.period_start ? String(r.period_start).slice(0, 10) : '-';
    const p1 = r.period_end ? String(r.period_end).slice(0, 10) : '-';
    const period = p0 !== '-' || p1 !== '-' ? `${p0} ~ ${p1}` : '-';
    const cd = r.created_at ? Utils.formatDate(r.created_at) : '-';
    const st = _projRegNormStatus(r);
    const codeDisp = (r.project_code && String(r.project_code).trim()) ? String(r.project_code) : '—';
    const owner = _projRegIsOwner(session, r);
    const canAp = st === 'pending' && _projRegCanApproveRow(session, r);
    const canDel = (st === 'draft' || st === 'rejected') && (owner || session.role === 'admin');
    let actionHtml = `<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">
      <button type="button" class="btn btn-sm btn-outline btn-icon" onclick="projRegShowForm('${r.id}')" title="상세"><i class="fas fa-edit"></i></button>`;
    if (canDel) {
      actionHtml += `<button type="button" class="btn btn-sm btn-danger btn-icon" onclick="projRegDelete('${r.id}')" title="삭제"><i class="fas fa-trash"></i></button>`;
    }
    if (canAp) {
      actionHtml += `<button type="button" class="btn btn-sm btn-success btn-icon" onclick="projRegApprove('${r.id}')" title="승인"><i class="fas fa-check"></i></button>
      <button type="button" class="btn btn-sm btn-danger btn-icon" onclick="projRegReject('${r.id}')" title="반려"><i class="fas fa-times"></i></button>`;
    }
    actionHtml += '</div>';
    return `<tr>
      <td>${i + 1}</td>
      <td><span class="${_projRegStatusBadgeClass(st)}">${Utils.escHtml(_projRegStatusLabel(st))}</span></td>
      <td><strong>${Utils.escHtml(codeDisp)}</strong></td>
      <td>${Utils.escHtml(r.project_name || '')}</td>
      <td>${Utils.escHtml(r.client_name || '')}</td>
      <td style="font-size:12px">${Utils.escHtml(period)}</td>
      <td>${Utils.escHtml(r.cpm_user_name || '-')}</td>
      <td style="font-size:12px">${Utils.escHtml(cd)}</td>
      <td style="text-align:center">${actionHtml}</td>
    </tr>`;
  }).join('');
}

function _projRegClearBilling() {
  const ids = [
    ['proj-reg-bill-down-amt', 'proj-reg-bill-down-due'],
    ['proj-reg-bill-interim-amt', 'proj-reg-bill-interim-due'],
    ['proj-reg-bill-final-amt', 'proj-reg-bill-final-due'],
    ['proj-reg-bill-add-amt', 'proj-reg-bill-add-due', 'proj-reg-bill-add-note'],
    ['proj-reg-bill-success-amt', 'proj-reg-bill-success-due', 'proj-reg-bill-success-note'],
  ];
  ids.forEach((row) => {
    row.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  });
}

function _projRegFillBilling(bs) {
  _projRegClearBilling();
  if (!bs || typeof bs !== 'object') return;
  const setAmt = (id, amt) => {
    const ael = document.getElementById(id);
    if (!ael || amt == null || amt === '') return;
    const n = typeof amt === 'number' ? amt : parseInt(amt, 10);
    if (Number.isFinite(n)) ael.value = n.toLocaleString('ko-KR');
  };
  const map = [
    ['down', 'proj-reg-bill-down-amt', 'proj-reg-bill-down-due'],
    ['interim', 'proj-reg-bill-interim-amt', 'proj-reg-bill-interim-due'],
    ['final', 'proj-reg-bill-final-amt', 'proj-reg-bill-final-due'],
    ['additional', 'proj-reg-bill-add-amt', 'proj-reg-bill-add-due', 'proj-reg-bill-add-note'],
    ['success', 'proj-reg-bill-success-amt', 'proj-reg-bill-success-due', 'proj-reg-bill-success-note'],
  ];
  map.forEach((row) => {
    const key = row[0];
    const aid = row[1];
    const did = row[2];
    const nid = row[3];
    const b = bs[key];
    if (!b) return;
    setAmt(aid, b.amount);
    const del = document.getElementById(did);
    if (del && b.due_date) del.value = String(b.due_date).slice(0, 10);
    if (nid && b.terms_note) {
      const nel = document.getElementById(nid);
      if (nel) nel.value = b.terms_note;
    }
  });
}

function _projRegCollectBilling() {
  const dte = (id) => {
    const v = document.getElementById(id)?.value;
    return v ? v : null;
  };
  return {
    down: { amount: _projRegAmtValue('proj-reg-bill-down-amt'), due_date: dte('proj-reg-bill-down-due') },
    interim: { amount: _projRegAmtValue('proj-reg-bill-interim-amt'), due_date: dte('proj-reg-bill-interim-due') },
    final: { amount: _projRegAmtValue('proj-reg-bill-final-amt'), due_date: dte('proj-reg-bill-final-due') },
    additional: {
      amount: _projRegAmtValue('proj-reg-bill-add-amt'),
      due_date: dte('proj-reg-bill-add-due'),
      terms_note: _projRegNoteVal('proj-reg-bill-add-note'),
    },
    success: {
      amount: _projRegAmtValue('proj-reg-bill-success-amt'),
      due_date: dte('proj-reg-bill-success-due'),
      terms_note: _projRegNoteVal('proj-reg-bill-success-note'),
    },
  };
}

async function projRegShowForm(editId) {
  const session = getSession();
  const list = document.getElementById('proj-reg-list');
  const form = document.getElementById('proj-reg-form');
  if (list) list.style.display = 'none';
  if (form) form.style.display = '';

  document.getElementById('proj-reg-edit-id').value = editId || '';
  const rowStatusEl = document.getElementById('proj-reg-row-status');
  if (rowStatusEl) rowStatusEl.value = editId ? '' : 'draft';

  const titleEl = document.getElementById('proj-reg-form-title');
  const subEl = document.getElementById('proj-reg-form-subtitle');
  const crumbEl = document.getElementById('proj-reg-form-crumb');
  if (titleEl) titleEl.textContent = editId ? '프로젝트 수정' : '새 프로젝트 등록';
  if (subEl) {
    subEl.textContent = editId
      ? '상태에 따라 유형·연월·승인 절차가 달라집니다. (임시저장 → 승인 요청 → 승인완료)'
      : '임시저장(draft) 후 승인 요청 시 코드가 채번되며, 직원등록에 지정된 1·2차 승인자가 승인합니다. 승인자가 없으면 즉시 승인됩니다.';
  }
  if (crumbEl) crumbEl.textContent = editId ? 'Edit Project' : 'Create Project';

  try {
    const wrap = document.querySelector('.proj-reg-create-wrap');
    if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (_) {
    window.scrollTo(0, 0);
  }

  const typeSel = document.getElementById('proj-reg-code-type');
  const yymmEl = document.getElementById('proj-reg-yymm');
  const codeWrap = document.getElementById('proj-reg-existing-code-wrap');
  const codeRo = document.getElementById('proj-reg-existing-code');

  document.getElementById('proj-reg-name').value = '';
  document.getElementById('proj-reg-client').value = '';
  const cSearch = document.getElementById('proj-reg-client-search');
  if (cSearch) cSearch.value = '';
  projRegHideClientSuggest();
  document.getElementById('proj-reg-order-owner').value = '';
  document.getElementById('proj-reg-route').value = '';
  document.getElementById('proj-reg-route-other').value = '';
  projRegOnRouteChange();
  document.getElementById('proj-reg-cpm').value = '';
  document.getElementById('proj-reg-period-start').value = '';
  document.getElementById('proj-reg-period-end').value = '';
  document.getElementById('proj-reg-contract').value = '';
  const remInp = document.getElementById('proj-reg-contract-remove');
  if (remInp) remInp.value = '';
  const rmHint = document.getElementById('proj-reg-contract-remove-hint');
  if (rmHint) rmHint.hidden = true;
  projRegResetContractUi();
  _projRegClearBilling();

  await projRegLoadTypes();
  await projRegFillDropdowns();

  let row = null;
  if (editId) {
    row = _projRegRows.find((x) => x.id === editId);
    if (!row) {
      Toast.warning('항목을 찾을 수 없습니다.');
      projRegShowList();
      return;
    }
    const st = _projRegNormStatus(row);
    if (rowStatusEl) rowStatusEl.value = st;

    if (typeSel) typeSel.value = row.project_code_type_id || '';
    if (yymmEl) {
      const yymm = _projRegYymmFromCode(row.project_code || '');
      yymmEl.value = yymm ? _projRegYymmToMonthValue(yymm) : '';
    }

    const lockType = st === 'approved' || st === 'pending';
    if (typeSel) typeSel.disabled = lockType;
    if (yymmEl) yymmEl.disabled = lockType;

    const showCode = !!(row.project_code && String(row.project_code).trim());
    if (codeWrap) codeWrap.style.display = showCode ? '' : 'none';
    if (codeRo) codeRo.value = showCode ? row.project_code : '';

    document.getElementById('proj-reg-name').value = row.project_name || '';
    document.getElementById('proj-reg-client').value = row.client_id || '';
    if (cSearch) cSearch.value = row.client_name || '';
    document.getElementById('proj-reg-order-owner').value = row.order_owner_text || '';
    projRegApplyRouteFromStored(row.acquisition_route || '');
    document.getElementById('proj-reg-cpm').value = row.cpm_user_id || '';
    if (row.period_start) document.getElementById('proj-reg-period-start').value = String(row.period_start).slice(0, 10);
    if (row.period_end) document.getElementById('proj-reg-period-end').value = String(row.period_end).slice(0, 10);
    _projRegFillBilling(row.billing_schedule);
    projRegSyncContractExisting(row);

    if (st === 'draft' && yymmEl && !yymmEl.value) _projRegSetDefaultMonth();
  } else {
    if (typeSel) typeSel.disabled = false;
    if (yymmEl) {
      yymmEl.disabled = false;
      _projRegSetDefaultMonth();
    }
    if (codeWrap) codeWrap.style.display = 'none';
    if (codeRo) codeRo.value = '';
  }

  projRegBindProgress();
  _projRegResetAsidePanel();
  projRegRefreshProgress();
  projRegUpdateFormFooter(session, editId || '', row);
}

function _projRegReadFormCore(session) {
  const name = document.getElementById('proj-reg-name').value.trim();
  const clientId = document.getElementById('proj-reg-client').value.trim();
  const typeId = document.getElementById('proj-reg-code-type').value;
  const monthVal = document.getElementById('proj-reg-yymm').value;
  const yymm = _projRegMonthToYymm(monthVal);
  const hit = _projRegClients.find((c) => String(c.id) === String(clientId));
  let clientName = hit ? String(hit.company_name || '') : '';
  if (!clientName) clientName = document.getElementById('proj-reg-client-search').value.trim();
  const cpmSel = document.getElementById('proj-reg-cpm');
  const cpmOpt = cpmSel?.selectedOptions?.[0];
  const cpmId = cpmSel?.value || '';
  const cpmName = cpmOpt?.dataset?.name || '';
  const orderOwner = document.getElementById('proj-reg-order-owner').value.trim();
  const routeSel = document.getElementById('proj-reg-route').value;
  let route = routeSel;
  if (routeSel === '기타') {
    route = document.getElementById('proj-reg-route-other').value.trim() || '기타';
  }
  const ps = document.getElementById('proj-reg-period-start').value || null;
  const pe = document.getElementById('proj-reg-period-end').value || null;
  const billing = _projRegCollectBilling();
  const fileInput = document.getElementById('proj-reg-contract');
  const file = fileInput?.files?.[0];
  const removeContractMeta = document.getElementById('proj-reg-contract-remove')?.value === '1';
  return {
    name,
    clientId,
    clientName,
    typeId,
    monthVal,
    yymm,
    cpmId,
    cpmName,
    orderOwner,
    route,
    ps,
    pe,
    billing,
    file,
    removeContractMeta,
    session,
  };
}

function _projRegHasContractMeta(row) {
  return !!(row && String(row.contract_file_name || '').trim());
}

/** 승인 요청 직전: 새 파일 선택 또는 기존 저장 메타(삭제 표시 없음) */
function _projRegFormWillHaveContract(f, prev) {
  if (f.file) return true;
  if (f.removeContractMeta) return false;
  return _projRegHasContractMeta(prev);
}

function _projRegApplyContractToPayload(basePayload, file, removeContractMeta, prev) {
  if (file) {
    basePayload.contract_file_name = file.name;
    basePayload.contract_uploaded_at = Date.now();
    basePayload.contract_file_url = '';
    return;
  }
  if (removeContractMeta && !file) {
    basePayload.contract_file_name = '';
    basePayload.contract_file_url = '';
    basePayload.contract_uploaded_at = null;
    return;
  }
  if (prev) {
    basePayload.contract_file_name = prev.contract_file_name || '';
    basePayload.contract_file_url = prev.contract_file_url || '';
    basePayload.contract_uploaded_at = prev.contract_uploaded_at || null;
  }
}

async function projRegSaveDraft() {
  const session = getSession();
  if (!Auth.canManageProjectRegister(session)) {
    Toast.warning('권한이 없습니다.');
    return;
  }
  const editId = document.getElementById('proj-reg-edit-id').value;
  const f = _projRegReadFormCore(session);
  const basePayload = {
    project_name: f.name,
    client_id: f.clientId || null,
    client_name: f.clientName,
    order_owner_text: f.orderOwner,
    acquisition_route: f.route,
    cpm_user_id: f.cpmId,
    cpm_user_name: f.cpmName,
    period_start: f.ps,
    period_end: f.pe,
    billing_schedule: f.billing,
    updated_by: String(session.id || ''),
    updated_by_name: session.name || '',
  };
  if (f.typeId) basePayload.project_code_type_id = f.typeId;
  try {
    if (editId) {
      const prev = _projRegRows.find((x) => x.id === editId);
      if (!prev || !_projRegIsOwner(session, prev)) {
        Toast.warning('임시저장할 권한이 없습니다.');
        return;
      }
      const st = _projRegNormStatus(prev);
      if (st === 'pending') {
        Toast.warning('승인 대기 중에는 수정할 수 없습니다.');
        return;
      }
      if (st === 'approved') {
        Toast.warning('승인 완료 건은 하단 「저장」으로 수정하세요.');
        return;
      }
      _projRegApplyContractToPayload(basePayload, f.file, f.removeContractMeta, prev);
      await API.patch('registered_projects', editId, basePayload);
      Toast.success('임시저장되었습니다.');
    } else {
      _projRegApplyContractToPayload(basePayload, f.file, f.removeContractMeta, null);
      if (!f.file) {
        basePayload.contract_file_name = '';
        basePayload.contract_file_url = '';
      }
      const row = await API.create('registered_projects', {
        ...basePayload,
        registration_status: 'draft',
        project_code: null,
        created_by: String(session.id || ''),
        created_by_name: session.name || '',
      });
      if (row && row.id) {
        document.getElementById('proj-reg-edit-id').value = row.id;
        const rs = document.getElementById('proj-reg-row-status');
        if (rs) rs.value = 'draft';
      }
      Toast.success('임시저장되었습니다.');
    }
    await projRegLoadList();
    const eid = document.getElementById('proj-reg-edit-id').value;
    if (eid) projRegUpdateFormFooter(session, eid, _projRegRows.find((x) => x.id === eid));
    projRegRefreshProgress();
  } catch (e) {
    Toast.error('임시저장 실패: ' + (e.message || e));
  }
}

async function projRegSubmitForApproval() {
  const session = getSession();
  if (!Auth.canManageProjectRegister(session)) {
    Toast.warning('권한이 없습니다.');
    return;
  }
  const editId = document.getElementById('proj-reg-edit-id').value;
  const f = _projRegReadFormCore(session);
  if (!f.name) {
    Toast.warning('프로젝트명을 입력하세요.');
    return;
  }
  if (!f.clientId) {
    Toast.warning('발주처를 검색한 뒤 목록에서 선택하세요.');
    return;
  }
  if (!f.typeId) {
    Toast.warning('유형(대·소분류)을 선택하세요.');
    return;
  }
  if (!f.yymm || f.yymm.length !== 4) {
    Toast.warning('연월을 선택하세요.');
    return;
  }
  const opt = document.getElementById('proj-reg-code-type').selectedOptions[0];
  const mainCode = (opt?.dataset?.mainCode || '').trim();
  const subCode = (opt?.dataset?.subCode || '').trim();
  if (!mainCode || !subCode) {
    Toast.warning('유형 코드를 확인할 수 없습니다.');
    return;
  }

  let prev = editId ? _projRegRows.find((x) => x.id === editId) : null;
  const snap = await _projRegRegistrantSnapshot(session);
  const has1 = !!snap.pa1Id;
  const has2 = !!snap.pa2Id;
  const isCcbAutoApprove =
    (session.role === 'director' || session.role === 'top_mgr') &&
    typeof Auth !== 'undefined' &&
    typeof Auth.preferredSheetType === 'function' &&
    Auth.preferredSheetType(session) === 'daily';
  const autoApprove = isCcbAutoApprove || (!has1 && !has2);

  if (autoApprove && !_projRegFormWillHaveContract(f, prev)) {
    Toast.warning(
      isCcbAutoApprove
        ? 'CCB 본부장/사업부장 등록은 제출 즉시 최종 승인됩니다. 이 경우 계약서(파일명)를 먼저 첨부한 뒤 다시 시도하세요.'
        : '승인자가 지정되어 있지 않아 제출 즉시 최종 승인됩니다. 이 경우 계약서(파일명)를 먼저 첨부한 뒤 다시 시도하세요.'
    );
    return;
  }
  if (!_projRegFormWillHaveContract(f, prev)) {
    Toast.info(
      '계약서 첨부없이 승인요청은 가능하나, 최종 승인 때 계약서가 업로드되어 있지 않으면 최종 승인이 되지 않습니다.',
      7500
    );
  }

  if (prev && !_projRegIsOwner(session, prev)) {
    Toast.warning('승인 요청할 권한이 없습니다.');
    return;
  }
  if (prev) {
    const st = _projRegNormStatus(prev);
    if (st === 'pending') {
      Toast.warning('이미 승인 대기 중입니다.');
      return;
    }
    if (st === 'approved') {
      Toast.warning('이미 승인된 프로젝트입니다.');
      return;
    }
  }

  let projectCode = '';
  const reuse =
    prev &&
    ( _projRegNormStatus(prev) === 'rejected' || _projRegNormStatus(prev) === 'draft') &&
    prev.project_code &&
    _projRegCodeMatchesForm(prev, f.typeId, f.yymm);
  if (reuse) {
    projectCode = String(prev.project_code);
  } else {
    projectCode = await API.rpc('fn_allocate_project_code', {
      p_main_code: mainCode,
      p_sub_code: subCode,
      p_yymm: f.yymm,
    });
    if (!projectCode || typeof projectCode !== 'string') {
      Toast.error('프로젝트 코드 채번에 실패했습니다.');
      return;
    }
  }

  const now = Date.now();
  const basePayload = {
    project_name: f.name,
    client_id: f.clientId,
    client_name: f.clientName,
    order_owner_text: f.orderOwner,
    acquisition_route: f.route,
    cpm_user_id: f.cpmId,
    cpm_user_name: f.cpmName,
    period_start: f.ps,
    period_end: f.pe,
    billing_schedule: f.billing,
    project_code: projectCode,
    project_code_type_id: f.typeId,
    updated_by: String(session.id || ''),
    updated_by_name: session.name || '',
    reg_pa1_id: snap.pa1Id,
    reg_pa1_name: snap.pa1Name,
    reg_pa2_id: snap.pa2Id,
    reg_pa2_name: snap.pa2Name,
    submitted_at: now,
    first_approved_at: null,
    first_approved_by: '',
    first_approved_by_name: '',
    final_approved_at: null,
    final_approved_by: '',
    final_approved_by_name: '',
    rejection_reason: '',
  };

  if (autoApprove) {
    basePayload.registration_status = 'approved';
    basePayload.first_approved_at = now;
    basePayload.first_approved_by = String(session.id || '');
    basePayload.first_approved_by_name = session.name || '';
    basePayload.final_approved_at = now;
    basePayload.final_approved_by = String(session.id || '');
    basePayload.final_approved_by_name = session.name || '';
  } else {
    basePayload.registration_status = 'pending';
  }

  if (prev) _projRegApplyContractToPayload(basePayload, f.file, f.removeContractMeta, prev);
  else _projRegApplyContractToPayload(basePayload, f.file, f.removeContractMeta, null);
  if (!prev && !f.file) {
    basePayload.contract_file_name = '';
    basePayload.contract_file_url = '';
  }

  try {
    if (editId) {
      await API.patch('registered_projects', editId, basePayload);
    } else {
      await API.create('registered_projects', {
        ...basePayload,
        created_by: String(session.id || ''),
        created_by_name: session.name || '',
      });
    }
    if (autoApprove) Toast.success('승인되었습니다. 코드: ' + projectCode);
    else Toast.success('승인 요청되었습니다. 코드: ' + projectCode);
    projRegShowList();
  } catch (e) {
    Toast.error('승인 요청 실패: ' + (e.message || e));
  }
}

async function projRegSaveApproved() {
  const session = getSession();
  if (!Auth.canManageProjectRegister(session)) {
    Toast.warning('권한이 없습니다.');
    return;
  }
  const editId = document.getElementById('proj-reg-edit-id').value;
  if (!editId) return;
  const prev = _projRegRows.find((x) => x.id === editId);
  if (!prev || _projRegNormStatus(prev) !== 'approved') {
    Toast.warning('승인 완료된 건만 이 방식으로 저장할 수 있습니다.');
    return;
  }
  const f = _projRegReadFormCore(session);
  if (!f.name) {
    Toast.warning('프로젝트명을 입력하세요.');
    return;
  }
  if (!f.clientId) {
    Toast.warning('발주처를 검색한 뒤 목록에서 선택하세요.');
    return;
  }
  const basePayload = {
    project_name: f.name,
    client_id: f.clientId,
    client_name: f.clientName,
    order_owner_text: f.orderOwner,
    acquisition_route: f.route,
    cpm_user_id: f.cpmId,
    cpm_user_name: f.cpmName,
    period_start: f.ps,
    period_end: f.pe,
    billing_schedule: f.billing,
    updated_by: String(session.id || ''),
    updated_by_name: session.name || '',
  };
  _projRegApplyContractToPayload(basePayload, f.file, f.removeContractMeta, prev);
  try {
    await API.patch('registered_projects', editId, basePayload);
    Toast.success('수정되었습니다.');
    projRegShowList();
  } catch (e) {
    Toast.error('저장 실패: ' + (e.message || e));
  }
}

async function projRegApprove(id) {
  const session = getSession();
  const row = _projRegRows.find((x) => x.id === id);
  if (!row || _projRegNormStatus(row) !== 'pending') return;
  if (!_projRegCanApproveRow(session, row)) {
    Toast.warning('현재 단계의 승인 권한이 없습니다.');
    return;
  }
  const step = _projRegPendingStep(row);
  const now = Date.now();
  const eff = _projRegEffectiveApprovers(row);
  const hasSecond = !!eff.pa2 && !eff.same;
  const willFinalApprove = !(step === 1 && hasSecond);
  if (willFinalApprove && !_projRegHasContractMeta(row)) {
    Toast.warning('계약서가 첨부된 건만 최종 승인할 수 있습니다.');
    return;
  }
  try {
    if (step === 1 && hasSecond) {
      await API.patch('registered_projects', id, {
        first_approved_at: now,
        first_approved_by: String(session.id || ''),
        first_approved_by_name: session.name || '',
        updated_by: String(session.id || ''),
        updated_by_name: session.name || '',
      });
      Toast.success('1차 승인되었습니다.');
    } else if (step === 2) {
      await API.patch('registered_projects', id, {
        final_approved_at: now,
        final_approved_by: String(session.id || ''),
        final_approved_by_name: session.name || '',
        registration_status: 'approved',
        updated_by: String(session.id || ''),
        updated_by_name: session.name || '',
      });
      Toast.success('승인 완료되었습니다.');
    } else {
      await API.patch('registered_projects', id, {
        first_approved_at: now,
        first_approved_by: String(session.id || ''),
        first_approved_by_name: session.name || '',
        final_approved_at: now,
        final_approved_by: String(session.id || ''),
        final_approved_by_name: session.name || '',
        registration_status: 'approved',
        updated_by: String(session.id || ''),
        updated_by_name: session.name || '',
      });
      Toast.success('승인 완료되었습니다.');
    }
    await projRegLoadList();
    const curFormId = document.getElementById('proj-reg-edit-id')?.value;
    if (curFormId === id) {
      const r2 = _projRegRows.find((x) => x.id === id);
      const rs = document.getElementById('proj-reg-row-status');
      if (rs && r2) rs.value = _projRegNormStatus(r2);
      await projRegShowForm(id);
    }
  } catch (e) {
    Toast.error('승인 실패: ' + (e.message || e));
  }
}

async function projRegReject(id) {
  const session = getSession();
  const row = _projRegRows.find((x) => x.id === id);
  if (!row || _projRegNormStatus(row) !== 'pending') return;
  if (!_projRegCanApproveRow(session, row)) {
    Toast.warning('현재 단계의 반려 권한이 없습니다.');
    return;
  }
  const reason = window.prompt('반려 사유를 입력하세요.') ?? '';
  if (!String(reason).trim()) {
    Toast.warning('반려 사유를 입력하세요.');
    return;
  }
  try {
    await API.patch('registered_projects', id, {
      registration_status: 'rejected',
      rejection_reason: String(reason).trim(),
      first_approved_at: null,
      first_approved_by: '',
      first_approved_by_name: '',
      final_approved_at: null,
      final_approved_by: '',
      final_approved_by_name: '',
      updated_by: String(session.id || ''),
      updated_by_name: session.name || '',
    });
    Toast.success('반려 처리되었습니다.');
    await projRegLoadList();
    const curFormId = document.getElementById('proj-reg-edit-id')?.value;
    if (curFormId === id) await projRegShowForm(id);
  } catch (e) {
    Toast.error('반려 실패: ' + (e.message || e));
  }
}

function projRegApproveCurrent() {
  const id = document.getElementById('proj-reg-edit-id')?.value;
  if (id) projRegApprove(id);
}

function projRegRejectCurrent() {
  const id = document.getElementById('proj-reg-edit-id')?.value;
  if (id) projRegReject(id);
}

async function projRegDelete(id) {
  if (!Auth.canManageProjectRegister(getSession())) {
    Toast.warning('권한이 없습니다.');
    return;
  }
  const session = getSession();
  const row = _projRegRows.find((x) => x.id === id);
  if (!row) return;
  const st = _projRegNormStatus(row);
  const owner = _projRegIsOwner(session, row);
  if (st !== 'draft' && st !== 'rejected') {
    Toast.warning('임시저장·반려 상태만 삭제할 수 있습니다.');
    return;
  }
  if (!owner && session.role !== 'admin') {
    Toast.warning('삭제 권한이 없습니다.');
    return;
  }
  const codeLabel = row.project_code || row.project_name || '프로젝트';
  if (!await Confirm.delete(codeLabel)) return;
  try {
    await API.delete('registered_projects', id);
    Toast.success('삭제되었습니다.');
    await projRegLoadList();
  } catch (e) {
    Toast.error('삭제 실패: ' + (e.message || e));
  }
}

window.init_project_register = init_project_register;
window.projRegShowList = projRegShowList;
window.projRegShowForm = projRegShowForm;
window.projRegLoadList = projRegLoadList;
window.projRegRenderList = projRegRenderList;
window.projRegSaveDraft = projRegSaveDraft;
window.projRegSubmitForApproval = projRegSubmitForApproval;
window.projRegSaveApproved = projRegSaveApproved;
window.projRegSave = projRegSaveApproved;
window.projRegApprove = projRegApprove;
window.projRegReject = projRegReject;
window.projRegApproveCurrent = projRegApproveCurrent;
window.projRegRejectCurrent = projRegRejectCurrent;
window.projRegDelete = projRegDelete;
window.projRegOnCodeTypeChange = projRegOnCodeTypeChange;
window.projRegScrollToSection = projRegScrollToSection;
window.projRegRefreshProgress = projRegRefreshProgress;
window.projRegToggleAside = projRegToggleAside;
window.projRegOnRouteChange = projRegOnRouteChange;
window.projRegOnContractFileChange = projRegOnContractFileChange;
window.projRegMarkContractRemove = projRegMarkContractRemove;
