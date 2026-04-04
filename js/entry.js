/* ============================================================
   entry.js  –  업무일지 입력 / 목록 / 수정
   ============================================================ */
'use strict';

/* ── 상수 ── */
const ENTRY_PAGE_SIZE = 20;
const DRAFT_KEY = 'entry_draft_v2';

/* ── 상태 ── */
let _session = null;
let _entries = [];
let _filteredEntries = [];
let _currentPage = 1;
let _totalCount = 0;
let _masters = {};
let _editingId = null;
let _quill = null;
let _filterState = {
  search: '', status: '', client_id: '', category_id: '',
  date_from: '', date_to: '', my_only: false
};

/* ══════════════════════════════════════════════
   진입점
══════════════════════════════════════════════ */
async function init_entry() {
  _session = Session.require();
  if (!_session) return;

  _masters = await Master.load();
  _setupFilterUI();
  _setupFormUI();
  _bindEvents();
  await _loadEntries();
  _restoreDraft();
}

/* ══════════════════════════════════════════════
   필터 UI 셋업
══════════════════════════════════════════════ */
function _setupFilterUI() {
  /* 고객사 셀렉트 */
  const cliSel = document.getElementById('filter-client');
  if (cliSel) {
    cliSel.innerHTML = '<option value="">전체 고객사</option>';
    (_masters.clients || []).forEach(c => {
      cliSel.innerHTML += `<option value="${c.id}">${Utils.escHtml(c.name)}</option>`;
    });
  }

  /* 카테고리 셀렉트 */
  const catSel = document.getElementById('filter-category');
  if (catSel) {
    catSel.innerHTML = '<option value="">전체 카테고리</option>';
    (_masters.categories || []).forEach(c => {
      catSel.innerHTML += `<option value="${c.id}">${Utils.escHtml(c.name)}</option>`;
    });
  }

  /* 내 항목만 체크박스 – staff는 기본 체크 */
  const myOnly = document.getElementById('filter-my-only');
  if (myOnly && Auth.isStaff(_session)) {
    myOnly.checked = true;
    _filterState.my_only = true;
  }
}

/* ══════════════════════════════════════════════
   폼 UI 셋업
══════════════════════════════════════════════ */
function _setupFormUI() {
  /* 날짜 기본값 오늘 */
  const dateEl = document.getElementById('entry-date');
  if (dateEl && !dateEl.value) dateEl.value = Utils.todayStr();

  /* 고객사 검색 셀렉트 */
  const clients = [
    { id: 'internal', name: '내부 업무' },
    ...(_masters.clients || [])
  ];
  ClientSearchSelect.init('entry-client', clients, {
    placeholder: '고객사 검색…',
    onChange: (id, name) => _onClientChange(id, name)
  });

  /* 카테고리 */
  const catSel = document.getElementById('entry-category');
  if (catSel) {
    catSel.innerHTML = '<option value="">카테고리 선택</option>';
    (_masters.categories || []).forEach(c => {
      catSel.innerHTML += `<option value="${c.id}">${Utils.escHtml(c.name)}</option>`;
    });
  }

  /* Quill 에디터 초기화 */
  _initQuill();

  /* 시간 입력 자동 계산 */
  const startEl = document.getElementById('entry-start');
  const endEl   = document.getElementById('entry-end');
  if (startEl && endEl) {
    startEl.addEventListener('change', _calcDuration);
    endEl.addEventListener('change', _calcDuration);
  }
}

/* ── Quill 초기화 ── */
function _initQuill() {
  const container = document.getElementById('entry-content-editor');
  if (!container || _quill) return;
  if (typeof Quill === 'undefined') return;

  _quill = new Quill('#entry-content-editor', {
    theme: 'snow',
    placeholder: '업무 내용을 상세히 입력하세요…',
    modules: {
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['link'],
        ['clean']
      ]
    }
  });

  _quill.on('text-change', () => _saveDraft());
}

/* ── 고객사 변경 시 사건/사업 목록 갱신 ── */
async function _onClientChange(clientId, clientName) {
  const caseWrap = document.getElementById('entry-case-wrap');
  const caseSel  = document.getElementById('entry-case');
  if (!caseSel) return;

  if (!clientId || clientId === 'internal') {
    caseSel.innerHTML = '<option value="">-</option>';
    if (caseWrap) caseWrap.style.display = 'none';
    return;
  }

  if (caseWrap) caseWrap.style.display = '';
  caseSel.innerHTML = '<option value="">사건/사업 선택 (선택)</option>';

  const cases = (_masters.cases || []).filter(c => c.client_id === clientId);
  cases.forEach(c => {
    caseSel.innerHTML += `<option value="${c.id}">${Utils.escHtml(c.name)}</option>`;
  });
}

/* ── 시작/종료 → 소요시간 자동 계산 ── */
function _calcDuration() {
  const startEl = document.getElementById('entry-start');
  const endEl   = document.getElementById('entry-end');
  const durEl   = document.getElementById('entry-duration');
  const dispEl  = document.getElementById('entry-duration-display');
  if (!startEl || !endEl || !durEl) return;

  const [sh, sm] = (startEl.value || '').split(':').map(Number);
  const [eh, em] = (endEl.value || '').split(':').map(Number);
  if (isNaN(sh) || isNaN(eh)) return;

  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 1440;
  durEl.value = mins;
  if (dispEl) dispEl.textContent = Utils.minToHM(mins);
}

/* ══════════════════════════════════════════════
   이벤트 바인딩
══════════════════════════════════════════════ */
function _bindEvents() {
  /* 필터 변경 */
  const bindFilter = (id, key, isCheck = false) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(isCheck ? 'change' : 'input', () => {
      _filterState[key] = isCheck ? el.checked : el.value;
      _currentPage = 1;
      _applyFilter();
    });
  };
  bindFilter('filter-search',   'search');
  bindFilter('filter-status',   'status');
  bindFilter('filter-client',   'client_id');
  bindFilter('filter-category', 'category_id');
  bindFilter('filter-date-from','date_from');
  bindFilter('filter-date-to',  'date_to');
  bindFilter('filter-my-only',  'my_only', true);

  /* 저장 버튼 */
  const saveBtn = document.getElementById('entry-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', _handleSave);

  /* 임시저장 버튼 */
  const draftBtn = document.getElementById('entry-draft-btn');
  if (draftBtn) draftBtn.addEventListener('click', _handleDraftSave);

  /* 폼 초기화 버튼 */
  const resetBtn = document.getElementById('entry-reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', _resetForm);

  /* 폼 자동 임시저장 */
  ['entry-date','entry-category','entry-start','entry-end','entry-title'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', Utils.debounce(_saveDraft, 800));
  });
}

/* ══════════════════════════════════════════════
   데이터 로드
══════════════════════════════════════════════ */
async function _loadEntries(page = 1) {
  _currentPage = page;
  const listWrap = document.getElementById('entry-list-wrap');
  if (listWrap) listWrap.innerHTML = _skeletonRows(5);

  try {
    const params = {
      page: _currentPage,
      limit: ENTRY_PAGE_SIZE,
      sort: '-work_date'
    };

    if (_filterState.search)      params.search = _filterState.search;
    if (_filterState.status)      params['filter[status]'] = _filterState.status;
    if (_filterState.client_id)   params['filter[client_id]'] = _filterState.client_id;
    if (_filterState.category_id) params['filter[category_id]'] = _filterState.category_id;
    if (_filterState.date_from)   params['filter[work_date][gte]'] = _filterState.date_from;
    if (_filterState.date_to)     params['filter[work_date][lte]'] = _filterState.date_to;
    if (_filterState.my_only)     params['filter[user_id]'] = _session.userId;

    const r = await API.list('time_entries', params);
    _entries = r?.data ?? [];
    _totalCount = r?.total ?? 0;
    _filteredEntries = _entries;

    _renderList();
    _renderPagination();
  } catch (e) {
    console.error('[entry] 로드 오류:', e);
    if (listWrap) listWrap.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#dc2626;padding:20px;">데이터 로드 실패</td></tr>';
  }
}

/* ── 필터 적용 (debounce) ── */
const _applyFilter = Utils.debounce(() => _loadEntries(1), 400);

/* ══════════════════════════════════════════════
   목록 렌더
══════════════════════════════════════════════ */
function _renderList() {
  const tbody = document.getElementById('entry-list-wrap');
  if (!tbody) return;

  if (!_filteredEntries.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:32px;">
      <i class="fa-solid fa-inbox" style="font-size:24px;display:block;margin-bottom:8px;opacity:0.4;"></i>
      업무 내역이 없습니다.
    </td></tr>`;
    return;
  }

  const cliMap  = Object.fromEntries((_masters.clients || []).map(c => [c.id, c.name]));
  const catMap  = Object.fromEntries((_masters.categories || []).map(c => [c.id, c.name]));
  const userMap = Object.fromEntries((_masters.users || []).map(u => [u.id, u.name]));

  tbody.innerHTML = _filteredEntries.map(e => {
    const canEdit   = Auth.canWriteEntry(_session) && (e.user_id === _session.userId || Auth.isAdmin(_session));
    const canDelete = canEdit && (e.status === 'draft' || Auth.isAdmin(_session));
    const cliName   = e.client_id === 'internal' ? '내부' : (cliMap[e.client_id] || '-');
    const catName   = catMap[e.category_id] || '-';
    const userName  = userMap[e.user_id] || '-';

    return `<tr data-id="${e.id}" class="entry-row">
      <td>${e.work_date || '-'}</td>
      <td title="${Utils.escHtml(e.title || '')}">${Utils.escHtml((e.title || '-').slice(0, 30))}${(e.title || '').length > 30 ? '…' : ''}</td>
      <td>${Utils.escHtml(cliName)}</td>
      <td>${Utils.escHtml(catName)}</td>
      <td style="text-align:center;">${Utils.minToHM(e.duration_min || 0)}</td>
      <td style="text-align:center;">${Utils.statusBadge(e.status || 'draft')}</td>
      <td>${Auth.isAdmin(_session) || Auth.isDirector(_session) || Auth.isManager(_session) ? Utils.escHtml(userName) : ''}</td>
      <td style="text-align:center;white-space:nowrap;">
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;" onclick="openEntryDetail('${e.id}')">
          <i class="fa-solid fa-eye"></i>
        </button>
        ${canEdit ? `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;" onclick="openEntryEdit('${e.id}')">
          <i class="fa-solid fa-pen"></i>
        </button>` : ''}
        ${canDelete ? `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:#dc2626;" onclick="deleteEntry('${e.id}')">
          <i class="fa-solid fa-trash"></i>
        </button>` : ''}
        ${e.status === 'draft' && e.user_id === _session.userId ? `<button class="btn btn-primary" style="font-size:11px;padding:3px 10px;" onclick="submitEntry('${e.id}')">
          결재요청
        </button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

/* ── 페이지네이션 ── */
function _renderPagination() {
  const wrap = document.getElementById('entry-pagination');
  if (!wrap) return;
  wrap.innerHTML = Utils.paginationHTML(_currentPage, Math.ceil(_totalCount / ENTRY_PAGE_SIZE), 'entryGoPage');
  const info = document.getElementById('entry-count-info');
  if (info) info.textContent = `총 ${_totalCount}건`;
}
window.entryGoPage = (p) => _loadEntries(p);

/* ── 스켈레톤 ── */
function _skeletonRows(n) {
  return Array(n).fill(0).map(() => `<tr>${Array(8).fill(0).map(() =>
    `<td><div style="height:14px;background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);background-size:200% 100%;animation:arch-shimmer 1.4s infinite;border-radius:4px;"></div></td>`
  ).join('')}</tr>`).join('');
}
/* ══════════════════════════════════════════════
   임시저장 (Draft)
══════════════════════════════════════════════ */
function _saveDraft() {
  try {
    const draft = _collectFormData();
    if (draft.title || draft.content) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
    }
  } catch (e) {}
}

function _restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft || Date.now() - draft.savedAt > 86400000) return; // 24시간 초과 무시

    const age = Math.round((Date.now() - draft.savedAt) / 60000);
    Toast.info(`임시저장된 내용이 있습니다. (${age}분 전) 복원하려면 아래 버튼을 클릭하세요.`, 5000);

    const restoreBtn = document.getElementById('entry-restore-btn');
    if (restoreBtn) {
      restoreBtn.style.display = '';
      restoreBtn.onclick = () => {
        _fillForm(draft);
        restoreBtn.style.display = 'none';
        Toast.success('임시저장 내용을 복원했습니다.');
      };
    }
  } catch (e) {}
}

function _clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  const restoreBtn = document.getElementById('entry-restore-btn');
  if (restoreBtn) restoreBtn.style.display = 'none';
}

/* ══════════════════════════════════════════════
   폼 데이터 수집 / 채우기
══════════════════════════════════════════════ */
function _collectFormData() {
  const clientVal = ClientSearchSelect.getValue('entry-client');
  const content   = _quill ? _quill.root.innerHTML : (document.getElementById('entry-content')?.value || '');
  const contentText = _quill ? _quill.getText().trim() : '';

  return {
    work_date:    document.getElementById('entry-date')?.value || '',
    title:        document.getElementById('entry-title')?.value?.trim() || '',
    client_id:    clientVal.id || '',
    client_name:  clientVal.name || '',
    category_id:  document.getElementById('entry-category')?.value || '',
    case_id:      document.getElementById('entry-case')?.value || '',
    start_time:   document.getElementById('entry-start')?.value || '',
    end_time:     document.getElementById('entry-end')?.value || '',
    duration_min: parseInt(document.getElementById('entry-duration')?.value || '0', 10),
    content:      content,
    content_text: contentText,
    is_billable:  document.getElementById('entry-billable')?.checked ?? true,
  };
}

function _fillForm(data) {
  if (!data) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('entry-date', data.work_date);
  set('entry-title', data.title);
  set('entry-category', data.category_id);
  set('entry-case', data.case_id);
  set('entry-start', data.start_time);
  set('entry-end', data.end_time);
  set('entry-duration', data.duration_min);

  const dispEl = document.getElementById('entry-duration-display');
  if (dispEl) dispEl.textContent = Utils.minToHM(data.duration_min || 0);

  if (data.client_id) {
    ClientSearchSelect.setValue('entry-client', data.client_id, data.client_name || '');
    _onClientChange(data.client_id, data.client_name || '');
  }

  if (_quill && data.content) {
    _quill.root.innerHTML = data.content;
  }

  const billable = document.getElementById('entry-billable');
  if (billable) billable.checked = data.is_billable !== false;
}

function _resetForm() {
  _editingId = null;
  const formTitle = document.getElementById('entry-form-title');
  if (formTitle) formTitle.textContent = '업무 입력';

  ['entry-title','entry-category','entry-case','entry-start','entry-end'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const dateEl = document.getElementById('entry-date');
  if (dateEl) dateEl.value = Utils.todayStr();
  const durEl = document.getElementById('entry-duration');
  if (durEl) durEl.value = '0';
  const dispEl = document.getElementById('entry-duration-display');
  if (dispEl) dispEl.textContent = '0h 00m';

  ClientSearchSelect.clear('entry-client');
  if (_quill) _quill.setText('');

  const billable = document.getElementById('entry-billable');
  if (billable) billable.checked = true;

  const saveBtn = document.getElementById('entry-save-btn');
  if (saveBtn) saveBtn.textContent = '저장';

  _clearDraft();
}

/* ══════════════════════════════════════════════
   저장 처리
══════════════════════════════════════════════ */
async function _handleSave() {
  const data = _collectFormData();

  /* 유효성 검사 */
  if (!data.work_date)   { Toast.error('날짜를 선택하세요.'); return; }
  if (!data.title)       { Toast.error('업무 제목을 입력하세요.'); return; }
  if (!data.client_id)   { Toast.error('고객사를 선택하세요.'); return; }
  if (!data.category_id) { Toast.error('카테고리를 선택하세요.'); return; }
  if (!data.duration_min || data.duration_min <= 0) {
    Toast.error('소요 시간을 입력하세요.'); return;
  }

  const saveBtn = document.getElementById('entry-save-btn');
  const restore = BtnLoading.start(saveBtn, '저장 중…');

  try {
    const payload = {
      work_date:    data.work_date,
      title:        data.title,
      client_id:    data.client_id,
      category_id:  data.category_id,
      case_id:      data.case_id || null,
      start_time:   data.start_time || null,
      end_time:     data.end_time || null,
      duration_min: data.duration_min,
      content:      data.content || '',
      content_text: data.content_text || '',
      is_billable:  data.is_billable,
      user_id:      _session.userId,
      status:       'draft',
    };

    let result;
    if (_editingId) {
      result = await API.update('time_entries', _editingId, payload);
      Toast.success('업무 내역이 수정되었습니다.');
    } else {
      result = await API.create('time_entries', payload);
      Toast.success('업무 내역이 저장되었습니다.');
    }

    _clearDraft();
    _resetForm();
    sessionStorage.setItem('dash_invalidate', '1');
    await _loadEntries(_currentPage);
  } catch (err) {
    console.error('[entry] 저장 오류:', err);
    Toast.error('저장 중 오류가 발생했습니다.');
  } finally {
    restore();
  }
}

/* ── 임시저장 버튼 ── */
async function _handleDraftSave() {
  const data = _collectFormData();
  if (!data.title && !data.content_text) {
    Toast.warning('제목 또는 내용을 입력하세요.');
    return;
  }

  const btn = document.getElementById('entry-draft-btn');
  const restore = BtnLoading.start(btn, '저장 중…');

  try {
    const payload = {
      work_date:    data.work_date || Utils.todayStr(),
      title:        data.title || '(임시저장)',
      client_id:    data.client_id || 'internal',
      category_id:  data.category_id || null,
      case_id:      data.case_id || null,
      start_time:   data.start_time || null,
      end_time:     data.end_time || null,
      duration_min: data.duration_min || 0,
      content:      data.content || '',
      content_text: data.content_text || '',
      is_billable:  data.is_billable,
      user_id:      _session.userId,
      status:       'draft',
    };

    if (_editingId) {
      await API.update('time_entries', _editingId, payload);
    } else {
      await API.create('time_entries', payload);
    }

    _clearDraft();
    Toast.success('임시저장되었습니다.');
    await _loadEntries(_currentPage);
  } catch (err) {
    Toast.error('임시저장 실패');
  } finally {
    restore();
  }
}

/* ══════════════════════════════════════════════
   결재 요청
══════════════════════════════════════════════ */
async function submitEntry(id) {
  const entry = _entries.find(e => e.id === id);
  if (!entry) return;

  /* 승인자 확인 */
  const userR = await API.get('users', _session.userId);
  const user  = userR?.data ?? userR;
  if (!user?.approver_id) {
    Toast.error('결재자가 지정되어 있지 않습니다. 관리자에게 문의하세요.');
    return;
  }

  const ok = await Confirm.show({
    title: '결재 요청',
    message: `"${entry.title}" 항목을 결재 요청하시겠습니까?`,
    confirmText: '요청',
    confirmClass: 'btn-primary'
  });
  if (!ok) return;

  try {
    await API.patch('time_entries', id, {
      status: 'pending',
      submitted_at: new Date().toISOString(),
      approver_id: user.approver_id
    });
    Toast.success('결재 요청이 완료되었습니다.');
    sessionStorage.setItem('dash_invalidate', '1');
    await _loadEntries(_currentPage);
  } catch (err) {
    Toast.error('결재 요청 중 오류가 발생했습니다.');
  }
}
window.submitEntry = submitEntry;

/* ══════════════════════════════════════════════
   삭제
══════════════════════════════════════════════ */
async function deleteEntry(id) {
  const entry = _entries.find(e => e.id === id);
  if (!entry) return;

  const ok = await Confirm.show({
    title: '업무 내역 삭제',
    message: `"${entry.title}" 항목을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
    confirmText: '삭제',
    confirmClass: 'btn-danger'
  });
  if (!ok) return;

  try {
    await API.delete('time_entries', id);
    Toast.success('삭제되었습니다.');
    sessionStorage.setItem('dash_invalidate', '1');
    await _loadEntries(_currentPage);
  } catch (err) {
    Toast.error('삭제 중 오류가 발생했습니다.');
  }
}
window.deleteEntry = deleteEntry;
/* ══════════════════════════════════════════════
   상세보기 모달
══════════════════════════════════════════════ */
async function openEntryDetail(id) {
  const modal = document.getElementById('entry-detail-modal');
  if (!modal) return;

  modal.style.display = 'flex';
  const body = document.getElementById('entry-detail-body');
  if (body) body.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> 로딩 중…</div>';

  try {
    const r = await API.get('time_entries', id);
    const e = r?.data ?? r;
    if (!e) throw new Error('데이터 없음');

    const cliMap  = Object.fromEntries((_masters.clients || []).map(c => [c.id, c.name]));
    const catMap  = Object.fromEntries((_masters.categories || []).map(c => [c.id, c.name]));
    const caseMap = Object.fromEntries((_masters.cases || []).map(c => [c.id, c.name]));
    const userMap = Object.fromEntries((_masters.users || []).map(u => [u.id, u.name]));

    const cliName  = e.client_id === 'internal' ? '내부 업무' : (cliMap[e.client_id] || '-');
    const catName  = catMap[e.category_id] || '-';
    const caseName = e.case_id ? (caseMap[e.case_id] || '-') : '-';
    const userName = userMap[e.user_id] || '-';

    const timeStr = (e.start_time && e.end_time)
      ? `${e.start_time} ~ ${e.end_time} (${Utils.minToHM(e.duration_min || 0)})`
      : Utils.minToHM(e.duration_min || 0);

    const contentHtml = e.content
      ? `<div class="arch-desc-view">${e.content}</div>`
      : '<span style="color:#94a3b8;font-size:13px;">내용 없음</span>';

    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="ep-panel" style="border-top:3px solid #2d6bb5;">
            <div class="ep-panel-header" style="background:#eff6ff;color:#2d6bb5;">기본 정보</div>
            <div class="ep-panel-body">
              <div class="ep-label">날짜</div>
              <div class="ep-ctrl">${e.work_date || '-'}</div>
              <div class="ep-label">작성자</div>
              <div class="ep-ctrl">${Utils.escHtml(userName)}</div>
              <div class="ep-label">상태</div>
              <div class="ep-ctrl">${Utils.statusBadge(e.status || 'draft')}</div>
              <div class="ep-label">청구 여부</div>
              <div class="ep-ctrl">${e.is_billable !== false
                ? '<span style="color:#16a34a;font-weight:600;">청구</span>'
                : '<span style="color:#94a3b8;">비청구</span>'}</div>
            </div>
          </div>
          <div class="ep-panel" style="border-top:3px solid #7c3aed;">
            <div class="ep-panel-header" style="background:#f5f3ff;color:#7c3aed;">업무 분류</div>
            <div class="ep-panel-body">
              <div class="ep-label">고객사</div>
              <div class="ep-ctrl">${Utils.escHtml(cliName)}</div>
              <div class="ep-label">카테고리</div>
              <div class="ep-ctrl">${Utils.escHtml(catName)}</div>
              <div class="ep-label">사건/사업</div>
              <div class="ep-ctrl">${Utils.escHtml(caseName)}</div>
              <div class="ep-label">소요 시간</div>
              <div class="ep-ctrl"><strong>${timeStr}</strong></div>
            </div>
          </div>
        </div>
        <div class="ep-panel" style="border-top:3px solid #0891b2;">
          <div class="ep-panel-header" style="background:#f0f9ff;color:#0891b2;">업무 제목</div>
          <div class="ep-panel-body">
            <div style="font-size:14px;font-weight:600;color:#1e293b;padding:4px 0;">${Utils.escHtml(e.title || '-')}</div>
          </div>
        </div>
        <div class="ep-panel" style="border-top:3px solid #16a34a;">
          <div class="ep-panel-header" style="background:#f0fdf4;color:#16a34a;">업무 내용</div>
          <div class="ep-panel-body">${contentHtml}</div>
        </div>
        ${_buildApprovalHistoryHtml(e)}
      </div>`;

    /* 수정/삭제 버튼 */
    const actWrap = document.getElementById('entry-detail-actions');
    if (actWrap) {
      const canEdit   = Auth.canWriteEntry(_session) && (e.user_id === _session.userId || Auth.isAdmin(_session));
      const canDelete = canEdit && (e.status === 'draft' || Auth.isAdmin(_session));
      actWrap.innerHTML = `
        ${canEdit ? `<button class="btn btn-outline" onclick="closeEntryDetail();openEntryEdit('${e.id}')">
          <i class="fa-solid fa-pen"></i> 수정
        </button>` : ''}
        ${canDelete ? `<button class="btn btn-danger" onclick="closeEntryDetail();deleteEntry('${e.id}')">
          <i class="fa-solid fa-trash"></i> 삭제
        </button>` : ''}
        ${e.status === 'draft' && e.user_id === _session.userId ? `<button class="btn btn-primary" onclick="closeEntryDetail();submitEntry('${e.id}')">
          <i class="fa-solid fa-paper-plane"></i> 결재 요청
        </button>` : ''}`;
    }
  } catch (err) {
    console.error('[entry] 상세 오류:', err);
    if (body) body.innerHTML = '<div style="padding:40px;text-align:center;color:#dc2626;">데이터를 불러올 수 없습니다.</div>';
  }
}
window.openEntryDetail = openEntryDetail;

/* ── 결재 이력 HTML ── */
function _buildApprovalHistoryHtml(e) {
  const steps = [];

  if (e.submitted_at) {
    steps.push({ label: '결재 요청', date: e.submitted_at, color: '#d97706', icon: 'fa-paper-plane' });
  }
  if (e.approved1_at) {
    steps.push({ label: '1차 승인', date: e.approved1_at, color: '#16a34a', icon: 'fa-circle-check' });
  }
  if (e.rejected1_at) {
    steps.push({ label: '1차 반려', date: e.rejected1_at, color: '#dc2626', icon: 'fa-circle-xmark', note: e.reject_reason });
  }
  if (e.approved2_at) {
    steps.push({ label: '2차 승인', date: e.approved2_at, color: '#16a34a', icon: 'fa-circle-check' });
  }
  if (e.rejected2_at) {
    steps.push({ label: '2차 반려', date: e.rejected2_at, color: '#dc2626', icon: 'fa-circle-xmark', note: e.reject_reason2 });
  }

  if (!steps.length) return '';

  const stepsHtml = steps.map(s => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:6px 0;">
      <i class="fa-solid ${s.icon}" style="color:${s.color};margin-top:2px;flex-shrink:0;"></i>
      <div>
        <div style="font-size:12.5px;font-weight:600;color:${s.color};">${s.label}</div>
        <div style="font-size:11px;color:#94a3b8;">${Utils.formatDatetime(s.date)}</div>
        ${s.note ? `<div style="font-size:12px;color:#64748b;margin-top:2px;">${Utils.escHtml(s.note)}</div>` : ''}
      </div>
    </div>`).join('');

  return `<div class="ep-panel" style="border-top:3px solid #94a3b8;">
    <div class="ep-panel-header" style="background:#f8fafc;color:#64748b;">결재 이력</div>
    <div class="ep-panel-body">${stepsHtml}</div>
  </div>`;
}

/* ── 상세 모달 닫기 ── */
function closeEntryDetail() {
  const modal = document.getElementById('entry-detail-modal');
  if (modal) modal.style.display = 'none';
}
window.closeEntryDetail = closeEntryDetail;

/* ══════════════════════════════════════════════
   수정 모드
══════════════════════════════════════════════ */
async function openEntryEdit(id) {
  try {
    const r = await API.get('time_entries', id);
    const e = r?.data ?? r;
    if (!e) { Toast.error('데이터를 불러올 수 없습니다.'); return; }

    /* 권한 체크 */
    if (e.user_id !== _session.userId && !Auth.isAdmin(_session)) {
      Toast.error('수정 권한이 없습니다.'); return;
    }
    if (!['draft', 'rejected'].includes(e.status) && !Auth.isAdmin(_session)) {
      Toast.error('결재 진행 중인 항목은 수정할 수 없습니다.'); return;
    }

    _editingId = id;

    /* 폼 상단으로 스크롤 */
    const formSection = document.getElementById('entry-form-section');
    if (formSection) formSection.scrollIntoView({ behavior: 'smooth' });

    /* 폼 타이틀 변경 */
    const formTitle = document.getElementById('entry-form-title');
    if (formTitle) formTitle.textContent = '업무 수정';

    const saveBtn = document.getElementById('entry-save-btn');
    if (saveBtn) saveBtn.textContent = '수정 저장';

    /* 폼 채우기 */
    _fillForm({
      work_date:    e.work_date,
      title:        e.title,
      client_id:    e.client_id,
      client_name:  (_masters.clients || []).find(c => c.id === e.client_id)?.name || '',
      category_id:  e.category_id,
      case_id:      e.case_id,
      start_time:   e.start_time,
      end_time:     e.end_time,
      duration_min: e.duration_min,
      content:      e.content,
      is_billable:  e.is_billable !== false,
    });

    await _onClientChange(e.client_id, '');
    const caseSel = document.getElementById('entry-case');
    if (caseSel && e.case_id) caseSel.value = e.case_id;

  } catch (err) {
    console.error('[entry] 수정 로드 오류:', err);
    Toast.error('수정 데이터 로드 실패');
  }
}
window.openEntryEdit = openEntryEdit;

/* ══════════════════════════════════════════════
   일괄 결재 요청
══════════════════════════════════════════════ */
async function submitAllDrafts() {
  const drafts = _entries.filter(e => e.status === 'draft' && e.user_id === _session.userId);
  if (!drafts.length) { Toast.warning('결재 요청할 임시저장 항목이 없습니다.'); return; }

  const userR = await API.get('users', _session.userId);
  const user  = userR?.data ?? userR;
  if (!user?.approver_id) {
    Toast.error('결재자가 지정되어 있지 않습니다.'); return;
  }

  const ok = await Confirm.show({
    title: '일괄 결재 요청',
    message: `임시저장 항목 ${drafts.length}건을 모두 결재 요청하시겠습니까?`,
    confirmText: '일괄 요청',
    confirmClass: 'btn-primary'
  });
  if (!ok) return;

  const btn = document.getElementById('entry-submit-all-btn');
  const restore = BtnLoading.start(btn, '처리 중…');

  try {
    let success = 0;
    for (const e of drafts) {
      await API.patch('time_entries', e.id, {
        status: 'pending',
        submitted_at: new Date().toISOString(),
        approver_id: user.approver_id
      });
      success++;
    }
    Toast.success(`${success}건 결재 요청 완료`);
    sessionStorage.setItem('dash_invalidate', '1');
    await _loadEntries(1);
  } catch (err) {
    Toast.error('일괄 요청 중 오류 발생');
  } finally {
    restore();
  }
}
window.submitAllDrafts = submitAllDrafts;
/* ══════════════════════════════════════════════
   Excel 가져오기
══════════════════════════════════════════════ */
async function openExcelImport() {
  const modal = document.getElementById('excel-import-modal');
  if (modal) modal.style.display = 'flex';
}
window.openExcelImport = openExcelImport;

function closeExcelImport() {
  const modal = document.getElementById('excel-import-modal');
  if (modal) modal.style.display = 'none';
  const preview = document.getElementById('excel-preview');
  if (preview) preview.innerHTML = '';
  const fileInput = document.getElementById('excel-file-input');
  if (fileInput) fileInput.value = '';
}
window.closeExcelImport = closeExcelImport;

async function handleExcelFile(input) {
  const file = input.files[0];
  if (!file) return;

  const preview = document.getElementById('excel-preview');
  if (preview) preview.innerHTML = '<div style="padding:16px;color:#94a3b8;text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> 파일 분석 중…</div>';

  try {
    const rows = await Utils.parseExcel(file);
    if (!rows || !rows.length) {
      if (preview) preview.innerHTML = '<div style="padding:16px;color:#dc2626;">데이터를 읽을 수 없습니다.</div>';
      return;
    }

    const cliMap  = Object.fromEntries((_masters.clients || []).map(c => [c.name.trim(), c.id]));
    const catMap  = Object.fromEntries((_masters.categories || []).map(c => [c.name.trim(), c.id]));

    const parsed = rows.slice(1).map((row, idx) => {
      const workDate    = String(row[0] || '').trim();
      const title       = String(row[1] || '').trim();
      const clientName  = String(row[2] || '').trim();
      const catName     = String(row[3] || '').trim();
      const durationStr = String(row[4] || '').trim();
      const content     = String(row[5] || '').trim();

      const clientId  = cliMap[clientName] || 'internal';
      const categoryId = catMap[catName] || null;
      const durationMin = _parseDurationStr(durationStr);

      const errors = [];
      if (!workDate) errors.push('날짜 없음');
      if (!title)    errors.push('제목 없음');
      if (!categoryId) errors.push('카테고리 불일치');

      return { idx: idx + 2, workDate, title, clientName, clientId, catName, categoryId, durationMin, content, errors };
    }).filter(r => r.title || r.workDate);

    if (!parsed.length) {
      if (preview) preview.innerHTML = '<div style="padding:16px;color:#dc2626;">유효한 데이터 행이 없습니다.</div>';
      return;
    }

    window._excelParsedRows = parsed;

    const rows_html = parsed.map(r => `
      <tr style="border-bottom:1px solid #f1f5f9;${r.errors.length ? 'background:#fff7f7;' : ''}">
        <td style="padding:6px 8px;font-size:12px;">${r.idx}</td>
        <td style="padding:6px 8px;font-size:12px;">${r.workDate || '-'}</td>
        <td style="padding:6px 8px;font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Utils.escHtml(r.title || '-')}</td>
        <td style="padding:6px 8px;font-size:12px;">${Utils.escHtml(r.clientName || '내부')}</td>
        <td style="padding:6px 8px;font-size:12px;">${Utils.escHtml(r.catName || '-')}</td>
        <td style="padding:6px 8px;font-size:12px;text-align:center;">${Utils.minToHM(r.durationMin)}</td>
        <td style="padding:6px 8px;font-size:11px;color:${r.errors.length ? '#dc2626' : '#16a34a'};">
          ${r.errors.length ? r.errors.join(', ') : '✓'}
        </td>
      </tr>`).join('');

    const validCount   = parsed.filter(r => !r.errors.length).length;
    const invalidCount = parsed.length - validCount;

    if (preview) preview.innerHTML = `
      <div style="margin-bottom:10px;font-size:13px;color:#334155;">
        총 <strong>${parsed.length}행</strong> 인식 — 
        <span style="color:#16a34a;">정상 ${validCount}건</span>
        ${invalidCount ? ` / <span style="color:#dc2626;">오류 ${invalidCount}건</span>` : ''}
      </div>
      <div style="overflow-x:auto;max-height:280px;overflow-y:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead style="background:#f8fafc;position:sticky;top:0;">
            <tr>
              <th style="padding:6px 8px;text-align:left;font-size:11px;color:#64748b;">#</th>
              <th style="padding:6px 8px;text-align:left;font-size:11px;color:#64748b;">날짜</th>
              <th style="padding:6px 8px;text-align:left;font-size:11px;color:#64748b;">제목</th>
              <th style="padding:6px 8px;text-align:left;font-size:11px;color:#64748b;">고객사</th>
              <th style="padding:6px 8px;text-align:left;font-size:11px;color:#64748b;">카테고리</th>
              <th style="padding:6px 8px;text-align:center;font-size:11px;color:#64748b;">시간</th>
              <th style="padding:6px 8px;text-align:left;font-size:11px;color:#64748b;">상태</th>
            </tr>
          </thead>
          <tbody>${rows_html}</tbody>
        </table>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-outline" onclick="closeExcelImport()">취소</button>
        <button class="btn btn-primary" onclick="confirmExcelImport()" ${validCount === 0 ? 'disabled' : ''}>
          <i class="fa-solid fa-file-import"></i> ${validCount}건 가져오기
        </button>
      </div>`;
  } catch (err) {
    console.error('[entry] Excel 파싱 오류:', err);
    if (preview) preview.innerHTML = '<div style="padding:16px;color:#dc2626;">파일을 읽는 중 오류가 발생했습니다.</div>';
  }
}
window.handleExcelFile = handleExcelFile;

function _parseDurationStr(str) {
  if (!str) return 0;
  str = str.toString().trim();
  const hmMatch = str.match(/(\d+)[h시]\s*(\d*)[m분]?/i);
  if (hmMatch) return parseInt(hmMatch[1]) * 60 + parseInt(hmMatch[2] || '0');
  const mMatch = str.match(/^(\d+)$/);
  if (mMatch) return parseInt(mMatch[1]);
  const dotMatch = str.match(/^(\d+)\.(\d+)$/);
  if (dotMatch) return Math.round(parseFloat(str) * 60);
  return 0;
}

async function confirmExcelImport() {
  const rows = (window._excelParsedRows || []).filter(r => !r.errors.length);
  if (!rows.length) return;

  const btn = document.querySelector('#excel-import-modal .btn-primary');
  const restore = btn ? BtnLoading.start(btn, '가져오는 중…') : () => {};

  try {
    let success = 0;
    for (const r of rows) {
      await API.create('time_entries', {
        work_date:    r.workDate,
        title:        r.title,
        client_id:    r.clientId,
        category_id:  r.categoryId,
        duration_min: r.durationMin,
        content:      r.content || '',
        content_text: r.content || '',
        is_billable:  true,
        user_id:      _session.userId,
        status:       'draft',
      });
      success++;
    }
    Toast.success(`${success}건 가져오기 완료`);
    closeExcelImport();
    sessionStorage.setItem('dash_invalidate', '1');
    await _loadEntries(1);
  } catch (err) {
    Toast.error('가져오기 중 오류 발생');
  } finally {
    restore();
    window._excelParsedRows = null;
  }
}
window.confirmExcelImport = confirmExcelImport;

/* ══════════════════════════════════════════════
   월별 집계 뷰
══════════════════════════════════════════════ */
async function renderEntryMonthlyView() {
  const wrap = document.getElementById('entry-monthly-wrap');
  if (!wrap) return;

  wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i></div>';

  try {
    const r = await API.list('time_entries', {
      limit: 1000,
      'filter[user_id]': _session.userId
    });
    const entries = r?.data ?? [];

    const monthMap = {};
    entries.forEach(e => {
      const m = (e.work_date || '').slice(0, 7);
      if (!m) return;
      if (!monthMap[m]) monthMap[m] = { total: 0, cli: 0, int: 0, count: 0 };
      monthMap[m].total += (e.duration_min || 0);
      monthMap[m].count++;
      if (e.client_id && e.client_id !== 'internal') {
        monthMap[m].cli += (e.duration_min || 0);
      } else {
        monthMap[m].int += (e.duration_min || 0);
      }
    });

    const months = Object.keys(monthMap).sort().reverse();
    if (!months.length) {
      wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;">데이터가 없습니다.</div>';
      return;
    }

    const rows = months.map(m => {
      const d = monthMap[m];
      const cliPct = d.total ? Math.round((d.cli / d.total) * 100) : 0;
      return `<tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:8px;font-size:13px;font-weight:600;color:#1e293b;">${m}</td>
        <td style="padding:8px;font-size:13px;text-align:center;">${d.count}건</td>
        <td style="padding:8px;font-size:13px;font-weight:600;text-align:center;color:#2d6bb5;">${Utils.minToHM(d.total)}</td>
        <td style="padding:8px;font-size:12px;text-align:center;color:#0891b2;">${Utils.minToHM(d.cli)}</td>
        <td style="padding:8px;font-size:12px;text-align:center;color:#7c3aed;">${Utils.minToHM(d.int)}</td>
        <td style="padding:8px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="flex:1;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;">
              <div style="width:${cliPct}%;height:100%;background:#2d6bb5;border-radius:4px;"></div>
            </div>
            <span style="font-size:11px;color:#64748b;width:32px;text-align:right;">${cliPct}%</span>
          </div>
        </td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">월</th>
            <th style="padding:8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">건수</th>
            <th style="padding:8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">총 시간</th>
            <th style="padding:8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">고객사</th>
            <th style="padding:8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">내부</th>
            <th style="padding:8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">고객사 비율</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#dc2626;">로드 실패</div>';
  }
}
window.renderEntryMonthlyView = renderEntryMonthlyView;

/* ══════════════════════════════════════════════
   탭 전환
══════════════════════════════════════════════ */
function switchEntryTab(tab) {
  const tabs = ['list', 'form', 'monthly'];
  tabs.forEach(t => {
    const el = document.getElementById(`entry-tab-${t}`);
    const btn = document.querySelector(`[data-entry-tab="${t}"]`);
    if (el) el.style.display = t === tab ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });

  if (tab === 'monthly') renderEntryMonthlyView();
  if (tab === 'form' && !_editingId) _resetForm();
}
window.switchEntryTab = switchEntryTab;
/* ══════════════════════════════════════════════
   Excel 내보내기
══════════════════════════════════════════════ */
async function exportEntriesToExcel() {
  const btn = document.getElementById('entry-export-btn');
  const restore = BtnLoading.start(btn, '내보내는 중…');

  try {
    const r = await API.list('time_entries', {
      limit: 2000,
      sort: '-work_date',
      ..._filterState.my_only ? { 'filter[user_id]': _session.userId } : {}
    });
    const entries = r?.data ?? [];

    const cliMap  = Object.fromEntries((_masters.clients || []).map(c => [c.id, c.name]));
    const catMap  = Object.fromEntries((_masters.categories || []).map(c => [c.id, c.name]));
    const caseMap = Object.fromEntries((_masters.cases || []).map(c => [c.id, c.name]));
    const userMap = Object.fromEntries((_masters.users || []).map(u => [u.id, u.name]));

    const STATUS_LABEL = {
      draft: '임시저장', pending: '1차 대기', pending2: '2차 대기',
      approved: '승인완료', rejected: '반려'
    };

    const data = [
      ['날짜', '작성자', '제목', '고객사', '카테고리', '사건/사업', '시작', '종료', '소요(분)', '소요(H:MM)', '청구여부', '상태', '내용']
    ];

    entries.forEach(e => {
      data.push([
        e.work_date || '',
        userMap[e.user_id] || '',
        e.title || '',
        e.client_id === 'internal' ? '내부 업무' : (cliMap[e.client_id] || ''),
        catMap[e.category_id] || '',
        e.case_id ? (caseMap[e.case_id] || '') : '',
        e.start_time || '',
        e.end_time || '',
        e.duration_min || 0,
        Utils.minToHM(e.duration_min || 0),
        e.is_billable !== false ? '청구' : '비청구',
        STATUS_LABEL[e.status] || e.status || '',
        e.content_text || ''
      ]);
    });

    await Utils.xlsxDownload(data, `업무내역_${Utils.todayStr()}.xlsx`, '업무내역');
    Toast.success(`${entries.length}건 내보내기 완료`);
  } catch (err) {
    console.error('[entry] 내보내기 오류:', err);
    Toast.error('내보내기 중 오류가 발생했습니다.');
  } finally {
    restore();
  }
}
window.exportEntriesToExcel = exportEntriesToExcel;

/* ══════════════════════════════════════════════
   관리자 전용 – 일괄 상태 변경
══════════════════════════════════════════════ */
async function adminBulkStatusChange(status) {
  if (!Auth.isAdmin(_session)) { Toast.error('권한 없음'); return; }

  const checked = Array.from(document.querySelectorAll('.entry-row-check:checked')).map(el => el.value);
  if (!checked.length) { Toast.warning('항목을 선택하세요.'); return; }

  const STATUS_LABEL = {
    draft: '임시저장', pending: '결재대기', approved: '승인완료', rejected: '반려'
  };

  const ok = await Confirm.show({
    title: '일괄 상태 변경',
    message: `선택한 ${checked.length}건을 "${STATUS_LABEL[status] || status}"으로 변경하시겠습니까?`,
    confirmText: '변경',
    confirmClass: 'btn-primary'
  });
  if (!ok) return;

  try {
    for (const id of checked) {
      await API.patch('time_entries', id, { status });
    }
    Toast.success(`${checked.length}건 상태 변경 완료`);
    await _loadEntries(_currentPage);
  } catch (err) {
    Toast.error('상태 변경 중 오류 발생');
  }
}
window.adminBulkStatusChange = adminBulkStatusChange;

/* ══════════════════════════════════════════════
   전체 선택 체크박스
══════════════════════════════════════════════ */
function toggleAllEntryCheck(masterCb) {
  const checks = document.querySelectorAll('.entry-row-check');
  checks.forEach(cb => { cb.checked = masterCb.checked; });
}
window.toggleAllEntryCheck = toggleAllEntryCheck;

/* ══════════════════════════════════════════════
   기간별 통계 (관리자/임원용)
══════════════════════════════════════════════ */
async function renderEntryStats() {
  const wrap = document.getElementById('entry-stats-wrap');
  if (!wrap) return;

  wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i></div>';

  try {
    const fromEl = document.getElementById('stats-date-from');
    const toEl   = document.getElementById('stats-date-to');
    const from   = fromEl?.value || '';
    const to     = toEl?.value   || '';

    const params = { limit: 2000, sort: 'work_date' };
    if (from) params['filter[work_date][gte]'] = from;
    if (to)   params['filter[work_date][lte]'] = to;

    const r = await API.list('time_entries', params);
    const entries = r?.data ?? [];

    const cliMap  = Object.fromEntries((_masters.clients || []).map(c => [c.id, c.name]));
    const catMap  = Object.fromEntries((_masters.categories || []).map(c => [c.id, c.name]));
    const userMap = Object.fromEntries((_masters.users || []).map(u => [u.id, u.name]));

    /* 고객사별 */
    const byClient = {};
    entries.filter(e => e.client_id && e.client_id !== 'internal').forEach(e => {
      byClient[e.client_id] = (byClient[e.client_id] || 0) + (e.duration_min || 0);
    });

    /* 카테고리별 */
    const byCat = {};
    entries.forEach(e => {
      if (e.category_id) byCat[e.category_id] = (byCat[e.category_id] || 0) + (e.duration_min || 0);
    });

    /* 직원별 */
    const byUser = {};
    entries.forEach(e => {
      byUser[e.user_id] = (byUser[e.user_id] || 0) + (e.duration_min || 0);
    });

    const totalMins = entries.reduce((s, e) => s + (e.duration_min || 0), 0);
    const cliMins   = Object.values(byClient).reduce((a, b) => a + b, 0);

    const topCli  = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const topCat  = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const topUser = Object.entries(byUser).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const barRow = (label, mins, max, color) => {
      const w = Math.round((mins / max) * 120);
      return `<tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:6px 8px;font-size:12px;color:#334155;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Utils.escHtml(label)}</td>
        <td style="padding:6px 8px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="width:${w}px;height:8px;background:${color};border-radius:4px;flex-shrink:0;"></div>
            <span style="font-size:12px;color:#1e293b;font-weight:600;">${Utils.minToHM(mins)}</span>
          </div>
        </td>
      </tr>`;
    };

    const cliMax  = topCli[0]?.[1]  || 1;
    const catMax  = topCat[0]?.[1]  || 1;
    const userMax = topUser[0]?.[1] || 1;

    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">
        <div class="kpi-card" style="border-top:3px solid #2d6bb5;">
          <div class="kpi-icon" style="color:#2d6bb5;"><i class="fa-solid fa-clock"></i></div>
          <div class="kpi-body">
            <div class="kpi-label">기간 총 시간</div>
            <div class="kpi-value">${Utils.minToHM(totalMins)}</div>
            <div class="kpi-sub">${entries.length}건</div>
          </div>
        </div>
        <div class="kpi-card" style="border-top:3px solid #0891b2;">
          <div class="kpi-icon" style="color:#0891b2;"><i class="fa-solid fa-building"></i></div>
          <div class="kpi-body">
            <div class="kpi-label">고객사 업무</div>
            <div class="kpi-value">${Utils.minToHM(cliMins)}</div>
            <div class="kpi-sub">${totalMins ? Math.round((cliMins/totalMins)*100) : 0}%</div>
          </div>
        </div>
        <div class="kpi-card" style="border-top:3px solid #7c3aed;">
          <div class="kpi-icon" style="color:#7c3aed;"><i class="fa-solid fa-users"></i></div>
          <div class="kpi-body">
            <div class="kpi-label">참여 직원</div>
            <div class="kpi-value">${Object.keys(byUser).length}명</div>
            <div class="kpi-sub">활동 인원</div>
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div class="card">
          <div class="card-header"><span class="card-title">고객사별</span></div>
          <table style="width:100%;border-collapse:collapse;">
            ${topCli.map(([id, m]) => barRow(cliMap[id] || id, m, cliMax, '#2d6bb5')).join('')}
          </table>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">카테고리별</span></div>
          <table style="width:100%;border-collapse:collapse;">
            ${topCat.map(([id, m]) => barRow(catMap[id] || id, m, catMax, '#0891b2')).join('')}
          </table>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">직원별</span></div>
          <table style="width:100%;border-collapse:collapse;">
            ${topUser.map(([id, m]) => barRow(userMap[id] || id, m, userMax, '#7c3aed')).join('')}
          </table>
        </div>
      </div>`;
  } catch (err) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#dc2626;">통계 로드 실패</div>';
  }
}
window.renderEntryStats = renderEntryStats;

/* ══════════════════════════════════════════════
   드래그 앤 드롭 파일 업로드
══════════════════════════════════════════════ */
function initDropZone() {
  const zone = document.getElementById('entry-drop-zone');
  if (!zone) return;

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      Toast.error('Excel 파일(.xlsx, .xls)만 지원합니다.');
      return;
    }
    const input = document.getElementById('excel-file-input');
    if (input) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      handleExcelFile(input);
    }
  });
}
window.initDropZone = initDropZone;
/* ══════════════════════════════════════════════
   복사하여 새로 만들기
══════════════════════════════════════════════ */
async function copyEntry(id) {
  try {
    const r = await API.get('time_entries', id);
    const e = r?.data ?? r;
    if (!e) { Toast.error('데이터를 불러올 수 없습니다.'); return; }

    _editingId = null;
    switchEntryTab('form');

    const formTitle = document.getElementById('entry-form-title');
    if (formTitle) formTitle.textContent = '업무 입력 (복사)';

    _fillForm({
      work_date:    Utils.todayStr(),
      title:        e.title ? `[복사] ${e.title}` : '',
      client_id:    e.client_id,
      client_name:  (_masters.clients || []).find(c => c.id === e.client_id)?.name || '',
      category_id:  e.category_id,
      case_id:      e.case_id,
      start_time:   e.start_time,
      end_time:     e.end_time,
      duration_min: e.duration_min,
      content:      e.content,
      is_billable:  e.is_billable !== false,
    });

    await _onClientChange(e.client_id, '');
    const caseSel = document.getElementById('entry-case');
    if (caseSel && e.case_id) caseSel.value = e.case_id;

    Toast.info('복사된 내용을 수정 후 저장하세요.');
  } catch (err) {
    Toast.error('복사 중 오류가 발생했습니다.');
  }
}
window.copyEntry = copyEntry;

/* ══════════════════════════════════════════════
   키보드 단축키
══════════════════════════════════════════════ */
function _initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    /* Ctrl+S → 저장 */
    if (e.ctrlKey && e.key === 's') {
      const activeTab = document.querySelector('[data-entry-tab].active')?.dataset?.entryTab;
      if (activeTab === 'form') {
        e.preventDefault();
        _handleSave();
      }
    }
    /* ESC → 모달 닫기 */
    if (e.key === 'Escape') {
      closeEntryDetail();
      closeExcelImport();
    }
  });
}

/* ══════════════════════════════════════════════
   모달 오버레이 클릭 닫기
══════════════════════════════════════════════ */
function _initModalClose() {
  ['entry-detail-modal', 'excel-import-modal'].forEach(id => {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  });
}

/* ══════════════════════════════════════════════
   승인 반려된 항목 재제출
══════════════════════════════════════════════ */
async function resubmitEntry(id) {
  const entry = _entries.find(e => e.id === id);
  if (!entry) return;
  if (entry.status !== 'rejected') {
    Toast.warning('반려된 항목만 재제출할 수 있습니다.');
    return;
  }

  const userR = await API.get('users', _session.userId);
  const user  = userR?.data ?? userR;
  if (!user?.approver_id) {
    Toast.error('결재자가 지정되어 있지 않습니다.');
    return;
  }

  const ok = await Confirm.show({
    title: '재제출',
    message: `"${entry.title}" 항목을 재제출하시겠습니까?`,
    confirmText: '재제출',
    confirmClass: 'btn-primary'
  });
  if (!ok) return;

  try {
    await API.patch('time_entries', id, {
      status: 'pending',
      submitted_at: new Date().toISOString(),
      approver_id: user.approver_id,
      reject_reason: null,
    });
    Toast.success('재제출 완료');
    await _loadEntries(_currentPage);
  } catch (err) {
    Toast.error('재제출 중 오류가 발생했습니다.');
  }
}
window.resubmitEntry = resubmitEntry;

/* ══════════════════════════════════════════════
   빠른 시간 입력 버튼
══════════════════════════════════════════════ */
function quickSetDuration(mins) {
  const durEl  = document.getElementById('entry-duration');
  const dispEl = document.getElementById('entry-duration-display');
  if (durEl)  durEl.value = mins;
  if (dispEl) dispEl.textContent = Utils.minToHM(mins);
  _saveDraft();
}
window.quickSetDuration = quickSetDuration;

/* ══════════════════════════════════════════════
   날짜 네비게이션 (이전/다음 날)
══════════════════════════════════════════════ */
function shiftEntryDate(days) {
  const dateEl = document.getElementById('entry-date');
  if (!dateEl || !dateEl.value) return;
  const d = new Date(dateEl.value);
  d.setDate(d.getDate() + days);
  dateEl.value = d.toISOString().slice(0, 10);
  _saveDraft();
}
window.shiftEntryDate = shiftEntryDate;

/* ══════════════════════════════════════════════
   필터 초기화
══════════════════════════════════════════════ */
function resetEntryFilter() {
  _filterState = {
    search: '', status: '', client_id: '', category_id: '',
    date_from: '', date_to: '',
    my_only: Auth.isStaff(_session)
  };

  ['filter-search','filter-status','filter-client',
   'filter-category','filter-date-from','filter-date-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const myOnly = document.getElementById('filter-my-only');
  if (myOnly) myOnly.checked = _filterState.my_only;

  _loadEntries(1);
}
window.resetEntryFilter = resetEntryFilter;

/* ══════════════════════════════════════════════
   초기화 완료 후 추가 셋업
══════════════════════════════════════════════ */
(function _extraSetup() {
  document.addEventListener('DOMContentLoaded', () => {
    _initKeyboardShortcuts();
    _initModalClose();
    initDropZone();
  });
})();

/* ══════════════════════════════════════════════
   외부 노출
══════════════════════════════════════════════ */
window.init_entry             = init_entry;
window.openEntryDetail        = openEntryDetail;
window.closeEntryDetail       = closeEntryDetail;
window.openEntryEdit          = openEntryEdit;
window.deleteEntry            = deleteEntry;
window.submitEntry            = submitEntry;
window.submitAllDrafts        = submitAllDrafts;
window.copyEntry              = copyEntry;
window.resubmitEntry          = resubmitEntry;
window.exportEntriesToExcel   = exportEntriesToExcel;
window.openExcelImport        = openExcelImport;
window.closeExcelImport       = closeExcelImport;
window.handleExcelFile        = handleExcelFile;
window.confirmExcelImport     = confirmExcelImport;
window.renderEntryMonthlyView = renderEntryMonthlyView;
window.renderEntryStats       = renderEntryStats;
window.switchEntryTab         = switchEntryTab;
window.resetEntryFilter       = resetEntryFilter;
window.quickSetDuration       = quickSetDuration;
window.shiftEntryDate         = shiftEntryDate;
window.toggleAllEntryCheck    = toggleAllEntryCheck;
window.adminBulkStatusChange  = adminBulkStatusChange;
window.initDropZone           = initDropZone;
window.entryGoPage            = entryGoPage;
