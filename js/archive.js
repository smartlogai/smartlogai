/* ============================================================
   archive.js  –  자문 자료실
   ============================================================ */
'use strict';

/* ── 상수 ── */
const ARCH_PAGE_SIZE = 20;

/* ── 상태 ── */
let _arSession  = null;
let _arMasters  = {};
let _arList     = [];
let _arPage     = 1;
let _arTotal    = 0;
let _arFilter   = {
  search: '', client_id: '', category_id: '',
  date_from: '', date_to: '',
  keywords: [], law_refs: [],
  source: '',   /* all | approval | upload | manual */
};
let _arExpandedId = null;
let _arQuill      = null;

/* ══════════════════════════════════════════════
   진입점
══════════════════════════════════════════════ */
async function init_archive() {
  _arSession = Session.require();
  if (!_arSession) return;

  _arMasters = await Master.load();
  _setupArFilterUI();
  _bindArEvents();
  await _loadArchive();
}

/* ══════════════════════════════════════════════
   필터 UI 셋업
══════════════════════════════════════════════ */
function _setupArFilterUI() {
  /* 고객사 */
  const cliSel = document.getElementById('arch-filter-client');
  if (cliSel) {
    cliSel.innerHTML = '<option value="">전체 고객사</option>';
    (_arMasters.clients || []).forEach(c => {
      cliSel.innerHTML += `<option value="${c.id}">${Utils.escHtml(c.name)}</option>`;
    });
  }

  /* 카테고리 */
  const catSel = document.getElementById('arch-filter-category');
  if (catSel) {
    catSel.innerHTML = '<option value="">전체 카테고리</option>';
    (_arMasters.categories || []).forEach(c => {
      catSel.innerHTML += `<option value="${c.id}">${Utils.escHtml(c.name)}</option>`;
    });
  }
}

/* ══════════════════════════════════════════════
   이벤트 바인딩
══════════════════════════════════════════════ */
function _bindArEvents() {
  /* 검색 인풋 */
  const searchEl = document.getElementById('arch-search-input');
  if (searchEl) {
    searchEl.addEventListener('input', Utils.debounce(() => {
      _arFilter.search = searchEl.value.trim();
      _arPage = 1;
      _loadArchive();
    }, 400));
  }

  /* 필터 셀렉트 */
  const bindF = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      _arFilter[key] = el.value;
      _arPage = 1;
      _loadArchive();
    });
  };
  bindF('arch-filter-client',   'client_id');
  bindF('arch-filter-category', 'category_id');
  bindF('arch-filter-date-from','date_from');
  bindF('arch-filter-date-to',  'date_to');
  bindF('arch-filter-source',   'source');

  /* 키워드 태그 입력 */
  const kwInput = document.getElementById('arch-kw-input');
  if (kwInput) {
    kwInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = kwInput.value.trim().replace(/,$/, '');
        if (val && !_arFilter.keywords.includes(val)) {
          _arFilter.keywords.push(val);
          _renderArKwTags();
          _arPage = 1;
          _loadArchive();
        }
        kwInput.value = '';
      }
    });
  }

  /* 법령 태그 입력 */
  const lawInput = document.getElementById('arch-law-input');
  if (lawInput) {
    lawInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = lawInput.value.trim().replace(/,$/, '');
        if (val && !_arFilter.law_refs.includes(val)) {
          _arFilter.law_refs.push(val);
          _renderArLawTags();
          _arPage = 1;
          _loadArchive();
        }
        lawInput.value = '';
      }
    });
  }
}

/* ── 키워드 태그 렌더 ── */
function _renderArKwTags() {
  const wrap = document.getElementById('arch-kw-tags');
  if (!wrap) return;
  wrap.innerHTML = _arFilter.keywords.map(kw => `
    <span class="arch-sel-tag arch-sel-tag--green">
      ${Utils.escHtml(kw)}
      <button onclick="removeArKw('${Utils.escHtml(kw)}')" style="background:none;border:none;cursor:pointer;margin-left:3px;color:inherit;">✕</button>
    </span>`).join('');
}

function removeArKw(kw) {
  _arFilter.keywords = _arFilter.keywords.filter(k => k !== kw);
  _renderArKwTags();
  _arPage = 1;
  _loadArchive();
}
window.removeArKw = removeArKw;

/* ── 법령 태그 렌더 ── */
function _renderArLawTags() {
  const wrap = document.getElementById('arch-law-tags');
  if (!wrap) return;
  wrap.innerHTML = _arFilter.law_refs.map(law => `
    <span class="arch-sel-tag arch-sel-tag--amber">
      ${Utils.escHtml(law)}
      <button onclick="removeArLaw('${Utils.escHtml(law)}')" style="background:none;border:none;cursor:pointer;margin-left:3px;color:inherit;">✕</button>
    </span>`).join('');
}

function removeArLaw(law) {
  _arFilter.law_refs = _arFilter.law_refs.filter(l => l !== law);
  _renderArLawTags();
  _arPage = 1;
  _loadArchive();
}
window.removeArLaw = removeArLaw;

/* ── 필터 초기화 ── */
function resetArchiveFilter() {
  _arFilter = {
    search: '', client_id: '', category_id: '',
    date_from: '', date_to: '',
    keywords: [], law_refs: [], source: ''
  };
  ['arch-search-input','arch-filter-client','arch-filter-category',
   'arch-filter-date-from','arch-filter-date-to','arch-filter-source'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  _renderArKwTags();
  _renderArLawTags();
  _arPage = 1;
  _loadArchive();
}
window.resetArchiveFilter = resetArchiveFilter;

/* ══════════════════════════════════════════════
   데이터 로드
══════════════════════════════════════════════ */
async function _loadArchive() {
  const wrap = document.getElementById('arch-card-list');
  if (wrap) wrap.innerHTML = _arSkeleton(5);

  try {
    const params = {
      page:  _arPage,
      limit: ARCH_PAGE_SIZE,
      sort:  '-created_at',
    };

    if (_arFilter.search)      params.search                    = _arFilter.search;
    if (_arFilter.client_id)   params['filter[client_id]']      = _arFilter.client_id;
    if (_arFilter.category_id) params['filter[category_id]']    = _arFilter.category_id;
    if (_arFilter.date_from)   params['filter[created_at][gte]']= _arFilter.date_from;
    if (_arFilter.date_to)     params['filter[created_at][lte]']= _arFilter.date_to;
    if (_arFilter.source)      params['filter[source]']         = _arFilter.source;
    if (_arFilter.keywords.length) {
      params['filter[keywords][contains]'] = _arFilter.keywords.join(',');
    }
    if (_arFilter.law_refs.length) {
      params['filter[law_refs][contains]'] = _arFilter.law_refs.join(',');
    }

    const r = await API.list('archive_items', params);
    _arList  = r?.data  ?? [];
    _arTotal = r?.total ?? 0;

    _renderArchiveList();
    _renderArPagination();
  } catch (err) {
    console.error('[archive] 로드 오류:', err);
    if (wrap) wrap.innerHTML = '<div style="padding:32px;text-align:center;color:#dc2626;">데이터 로드 실패</div>';
  }
}

/* ══════════════════════════════════════════════
   카드 목록 렌더
══════════════════════════════════════════════ */
function _renderArchiveList() {
  const wrap = document.getElementById('arch-card-list');
  if (!wrap) return;

  const countEl = document.getElementById('arch-count-info');
  if (countEl) countEl.textContent = `총 ${_arTotal}건`;

  if (!_arList.length) {
    wrap.innerHTML = `
      <div class="arch-empty-state">
        <i class="fa-solid fa-folder-open"></i>
        검색 결과가 없습니다.
      </div>`;
    return;
  }

  const cliMap  = Object.fromEntries((_arMasters.clients    || []).map(c => [c.id, c.name]));
  const catMap  = Object.fromEntries((_arMasters.categories || []).map(c => [c.id, c.name]));
  const userMap = Object.fromEntries((_arMasters.users      || []).map(u => [u.id, u.name]));

  wrap.innerHTML = _arList.map(item => _buildArCard(item, cliMap, catMap, userMap)).join('');
}

/* ── 카드 HTML 빌더 ── */
function _buildArCard(item, cliMap, catMap, userMap) {
  const cliName  = item.client_id ? (cliMap[item.client_id] || item.client_id) : '-';
  const catName  = item.category_id ? (catMap[item.category_id] || '-') : '-';
  const userName = userMap[item.created_by] || '-';
  const isExpanded = _arExpandedId === item.id;

  const keywords = Array.isArray(item.keywords) ? item.keywords : [];
  const kwHtml   = keywords.slice(0, 6).map(kw =>
    `<span class="arch-kw-tag" onclick="addArKwFilter('${Utils.escHtml(kw)}')" style="cursor:pointer;">${Utils.escHtml(kw)}</span>`
  ).join('');

  const sourceBadge = {
    approval: '<span class="arch-meta-badge arch-badge-approval"><i class="fa-solid fa-file-circle-check"></i> 결재완료</span>',
    upload:   '<span class="arch-meta-badge arch-badge-upload"><i class="fa-solid fa-upload"></i> 업로드</span>',
    manual:   '<span class="arch-meta-badge arch-badge-manual"><i class="fa-solid fa-pen"></i> 직접입력</span>',
    template: '<span class="arch-meta-badge arch-badge-tpl"><i class="fa-solid fa-file-lines"></i> 템플릿</span>',
  }[item.source] || '';

  const preview = (item.content_text || item.description || '').slice(0, 120);

  return `
    <div class="arch-card ${isExpanded ? 'arch-card-expanded' : ''}" id="arch-card-${item.id}">
      <div class="arch-card-header">
        <a class="arch-card-title" href="javascript:void(0)" onclick="toggleArCard('${item.id}')">
          ${Utils.escHtml(item.title || '(제목 없음)')}
        </a>
        <div class="arch-card-badges">
          ${sourceBadge}
          ${item.file_count > 0 ? `<span class="arch-meta-badge arch-badge-file"><i class="fa-solid fa-paperclip"></i> ${item.file_count}</span>` : ''}
        </div>
      </div>
      ${kwHtml ? `<div class="arch-kw-area">${kwHtml}</div>` : ''}
      ${preview ? `<div class="arch-kw-preview">${Utils.escHtml(preview)}${(item.content_text||'').length > 120 ? '…' : ''}</div>` : ''}
      <div class="arch-card-footer">
        <span class="arch-meta-chip"><i class="fa-solid fa-building"></i> ${Utils.escHtml(cliName)}</span>
        <span class="arch-meta-chip"><i class="fa-solid fa-tag"></i> ${Utils.escHtml(catName)}</span>
        <span class="arch-meta-chip"><i class="fa-regular fa-calendar"></i> ${(item.created_at||'').slice(0,10)}</span>
        <span class="arch-meta-person"><i class="fa-solid fa-user"></i> ${Utils.escHtml(userName)}</span>
        <button class="arch-detail-btn" onclick="openArchiveDetail('${item.id}')">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> 상세보기
        </button>
      </div>
      <div class="arch-inline-panel ${isExpanded ? '' : 'arch-panel-hidden'}" id="arch-panel-${item.id}">
        <div class="arch-inline-loading"><i class="fa-solid fa-spinner fa-spin"></i> 로딩 중…</div>
      </div>
    </div>`;
}

/* ── 키워드 클릭 → 필터 추가 ── */
function addArKwFilter(kw) {
  if (!_arFilter.keywords.includes(kw)) {
    _arFilter.keywords.push(kw);
    _renderArKwTags();
    _arPage = 1;
    _loadArchive();
  }
}
window.addArKwFilter = addArKwFilter;
/* ══════════════════════════════════════════════
   카드 인라인 확장
══════════════════════════════════════════════ */
async function toggleArCard(id) {
  const panel = document.getElementById(`arch-panel-${id}`);
  const card  = document.getElementById(`arch-card-${id}`);
  if (!panel || !card) return;

  /* 이미 열려있으면 닫기 */
  if (_arExpandedId === id) {
    _arExpandedId = null;
    card.classList.remove('arch-card-expanded');
    panel.classList.add('arch-panel-hidden');
    return;
  }

  /* 기존 패널 닫기 */
  if (_arExpandedId) {
    const prevCard  = document.getElementById(`arch-card-${_arExpandedId}`);
    const prevPanel = document.getElementById(`arch-panel-${_arExpandedId}`);
    if (prevCard)  prevCard.classList.remove('arch-card-expanded');
    if (prevPanel) prevPanel.classList.add('arch-panel-hidden');
  }

  _arExpandedId = id;
  card.classList.add('arch-card-expanded');
  panel.classList.remove('arch-panel-hidden');
  panel.innerHTML = '<div class="arch-inline-loading"><i class="fa-solid fa-spinner fa-spin"></i> 로딩 중…</div>';

  try {
    const r = await API.get('archive_items', id);
    const item = r?.data ?? r;
    if (!item) throw new Error('데이터 없음');

    const cliMap  = Object.fromEntries((_arMasters.clients    || []).map(c => [c.id, c.name]));
    const catMap  = Object.fromEntries((_arMasters.categories || []).map(c => [c.id, c.name]));
    const userMap = Object.fromEntries((_arMasters.users      || []).map(u => [u.id, u.name]));

    const cliName  = item.client_id ? (cliMap[item.client_id] || '-') : '-';
    const catName  = item.category_id ? (catMap[item.category_id] || '-') : '-';
    const userName = userMap[item.created_by] || '-';
    const keywords = Array.isArray(item.keywords) ? item.keywords : [];
    const lawRefs  = Array.isArray(item.law_refs)  ? item.law_refs  : [];

    const kwHtml  = keywords.map(k =>
      `<span class="arch-cm-kw-tag">${Utils.escHtml(k)}</span>`).join('');
    const lawHtml = lawRefs.map(l =>
      `<span class="arch-cm-kw-tag" style="background:#fff7ed;color:#c2410c;">${Utils.escHtml(l)}</span>`).join('');

    const content = item.content || item.description || '';
    const contentHtml = content
      ? `<div class="arch-text-box">${content}</div>`
      : '<div class="arch-inline-empty">내용 없음</div>';

    panel.innerHTML = `
      <div class="arch-inline-meta">
        <span class="arch-meta-chip"><i class="fa-solid fa-building"></i> ${Utils.escHtml(cliName)}</span>
        <span class="arch-meta-chip"><i class="fa-solid fa-tag"></i> ${Utils.escHtml(catName)}</span>
        <span class="arch-meta-chip"><i class="fa-solid fa-user"></i> ${Utils.escHtml(userName)}</span>
        <span class="arch-meta-chip"><i class="fa-regular fa-calendar"></i> ${(item.created_at||'').slice(0,10)}</span>
        <div class="arch-inline-actions">
          <button class="arch-inline-copy-btn" onclick="copyArchiveContent('${id}')">
            <i class="fa-solid fa-copy"></i> 복사
          </button>
          <button class="arch-inline-detail-btn" onclick="openArchiveDetail('${id}')">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> 상세
          </button>
        </div>
      </div>
      ${kwHtml  ? `<div style="padding:8px 16px 4px;display:flex;flex-wrap:wrap;gap:4px;">${kwHtml}</div>`  : ''}
      ${lawHtml ? `<div style="padding:4px 16px 8px;display:flex;flex-wrap:wrap;gap:4px;">${lawHtml}</div>` : ''}
      <div style="padding:14px 16px 16px;">${contentHtml}</div>`;
  } catch (err) {
    console.error('[archive] 카드 로드 오류:', err);
    panel.innerHTML = '<div class="arch-inline-empty" style="color:#dc2626;">로드 실패</div>';
  }
}
window.toggleArCard = toggleArCard;

/* ── 내용 복사 ── */
async function copyArchiveContent(id) {
  try {
    const r = await API.get('archive_items', id);
    const item = r?.data ?? r;
    const text = item?.content_text || item?.description || '';
    await navigator.clipboard.writeText(text);
    Toast.success('내용이 복사되었습니다.');
  } catch (err) {
    Toast.error('복사에 실패했습니다.');
  }
}
window.copyArchiveContent = copyArchiveContent;

/* ══════════════════════════════════════════════
   상세보기 모달
══════════════════════════════════════════════ */
async function openArchiveDetail(id) {
  const modal = document.getElementById('arch-detail-modal');
  if (!modal) return;
  modal.style.display = 'flex';

  const body = document.getElementById('arch-detail-body');
  if (body) body.innerHTML = '<div class="arch-cm-loading"><i class="fa-solid fa-spinner fa-spin"></i> 로딩 중…</div>';

  try {
    const r = await API.get('archive_items', id);
    const item = r?.data ?? r;
    if (!item) throw new Error('없음');

    const cliMap  = Object.fromEntries((_arMasters.clients    || []).map(c => [c.id, c.name]));
    const catMap  = Object.fromEntries((_arMasters.categories || []).map(c => [c.id, c.name]));
    const userMap = Object.fromEntries((_arMasters.users      || []).map(u => [u.id, u.name]));

    const cliName  = item.client_id   ? (cliMap[item.client_id]     || '-') : '-';
    const catName  = item.category_id ? (catMap[item.category_id]   || '-') : '-';
    const userName = userMap[item.created_by] || '-';
    const keywords = Array.isArray(item.keywords) ? item.keywords : [];
    const lawRefs  = Array.isArray(item.law_refs)  ? item.law_refs  : [];
    const files    = Array.isArray(item.files)      ? item.files     : [];

    /* 제목 */
    const titleEl = document.getElementById('arch-detail-title');
    if (titleEl) titleEl.textContent = item.title || '(제목 없음)';

    /* 메타 */
    const metaEl = document.getElementById('arch-detail-meta');
    if (metaEl) {
      metaEl.innerHTML = `
        <span class="arch-cm-meta-chip"><i class="fa-solid fa-building"></i> ${Utils.escHtml(cliName)}</span>
        <span class="arch-cm-meta-chip"><i class="fa-solid fa-tag"></i> ${Utils.escHtml(catName)}</span>
        <span class="arch-cm-meta-chip"><i class="fa-solid fa-user"></i> ${Utils.escHtml(userName)}</span>
        <span class="arch-cm-meta-chip"><i class="fa-regular fa-calendar"></i> ${(item.created_at||'').slice(0,10)}</span>`;
    }

    const content = item.content || item.description || '';
    const contentHtml = content
      ? `<div class="arch-desc-view">${content}</div>`
      : '<div class="arch-cm-empty"><i class="fa-solid fa-file-circle-xmark"></i>내용 없음</div>';

    const kwHtml = keywords.map(k =>
      `<span class="arch-cm-kw-tag">${Utils.escHtml(k)}</span>`).join('');
    const lawHtml = lawRefs.map(l =>
      `<span class="arch-cm-kw-tag" style="background:#fff7ed;color:#c2410c;">${Utils.escHtml(l)}</span>`).join('');

    const fileHtml = files.length
      ? files.map(f => `
          <div class="arch-cm-file-item">
            <span style="font-size:16px;">${_arFileIcon(f.name)}</span>
            <span class="arch-cm-file-name">${Utils.escHtml(f.name)}</span>
            <span class="arch-cm-file-meta">${_arFileSize(f.size)}</span>
            ${f.url ? `<a href="${f.url}" target="_blank" class="arch-action-btn arch-action-btn--dl" style="font-size:11px;padding:2px 8px;">
              <i class="fa-solid fa-download"></i>
            </a>` : ''}
          </div>`).join('')
      : '';

    body.innerHTML = `
      ${kwHtml  ? `<div class="arch-cm-kw-row">${kwHtml}</div>`  : ''}
      ${lawHtml ? `<div class="arch-cm-kw-row">${lawHtml}</div>` : ''}
      <div class="arch-cm-body">
        <div>
          <div class="arch-cm-section-label"><i class="fa-solid fa-align-left"></i> 내용</div>
          <div style="margin-top:8px;">${contentHtml}</div>
        </div>
        ${fileHtml ? `
        <div>
          <div class="arch-cm-section-label"><i class="fa-solid fa-paperclip"></i> 첨부파일</div>
          <div class="arch-cm-file-list" style="margin-top:8px;">${fileHtml}</div>
        </div>` : ''}
      </div>
      <div class="arch-cm-footer">
        <button class="btn btn-outline" onclick="copyArchiveContent('${id}')">
          <i class="fa-solid fa-copy"></i> 복사
        </button>
        ${Auth.isAdmin(_arSession) || item.created_by === _arSession.userId ? `
        <button class="btn btn-ghost" onclick="closeArchiveDetail();openArchiveEdit('${id}')">
          <i class="fa-solid fa-pen"></i> 수정
        </button>
        <button class="btn btn-danger" onclick="closeArchiveDetail();deleteArchiveItem('${id}')">
          <i class="fa-solid fa-trash"></i> 삭제
        </button>` : ''}
        <button class="btn btn-outline" onclick="closeArchiveDetail()">닫기</button>
      </div>`;
  } catch (err) {
    if (body) body.innerHTML = '<div class="arch-cm-loading" style="color:#dc2626;">로드 실패</div>';
  }
}
window.openArchiveDetail = openArchiveDetail;

function closeArchiveDetail() {
  const modal = document.getElementById('arch-detail-modal');
  if (modal) modal.style.display = 'none';
}
window.closeArchiveDetail = closeArchiveDetail;

/* ── 파일 아이콘 ── */
function _arFileIcon(name) {
  const ext = (name||'').split('.').pop().toLowerCase();
  const map = {
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗',
    ppt: '📙', pptx: '📙', zip: '📦', rar: '📦', jpg: '🖼',
    jpeg: '🖼', png: '🖼', gif: '🖼', txt: '📄', hwp: '📄'
  };
  return map[ext] || '📎';
}

/* ── 파일 크기 ── */
function _arFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024)       return `${bytes}B`;
  if (bytes < 1024*1024)  return `${(bytes/1024).toFixed(1)}KB`;
  return `${(bytes/(1024*1024)).toFixed(1)}MB`;
}

/* ── 페이지네이션 ── */
function _renderArPagination() {
  const wrap = document.getElementById('arch-pagination');
  if (!wrap) return;
  wrap.innerHTML = Utils.paginationHTML(_arPage, Math.ceil(_arTotal / ARCH_PAGE_SIZE), 'archGoPage');
}
window.archGoPage = (p) => { _arPage = p; _loadArchive(); };

/* ── 스켈레톤 ── */
function _arSkeleton(n) {
  return Array(n).fill(0).map(() => `
    <div class="arch-skeleton-card">
      <div class="arch-skel arch-skel-title"></div>
      <div class="arch-skel arch-skel-body"></div>
      <div class="arch-skel arch-skel-footer"></div>
    </div>`).join('');
}
/* ══════════════════════════════════════════════
   자료 추가/수정 모달
══════════════════════════════════════════════ */
async function openArchiveEdit(id = null) {
  let data = {};
  if (id) {
    const r = await API.get('archive_items', id);
    data = r?.data ?? r ?? {};
  }

  const overlay = document.createElement('div');
  overlay.id = '_arch-edit-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

  const cliOpts = [
    '<option value="">고객사 선택</option>',
    ...(_arMasters.clients || []).map(c =>
      `<option value="${c.id}" ${data.client_id===c.id?'selected':''}>${Utils.escHtml(c.name)}</option>`)
  ].join('');

  const catOpts = [
    '<option value="">카테고리 선택</option>',
    ...(_arMasters.categories || []).map(c =>
      `<option value="${c.id}" ${data.category_id===c.id?'selected':''}>${Utils.escHtml(c.name)}</option>`)
  ].join('');

  const existingKws  = Array.isArray(data.keywords) ? data.keywords : [];
  const existingLaws = Array.isArray(data.law_refs)  ? data.law_refs  : [];

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:26px;width:620px;max-width:94vw;
      max-height:90vh;overflow-y:auto;box-shadow:0 24px 70px rgba(0,0,0,0.22);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 style="font-size:16px;font-weight:700;color:#1e293b;margin:0;">
          <i class="fa-solid fa-folder-${id?'pen':'plus'}" style="color:#2d6bb5;margin-right:8px;"></i>
          ${id ? '자료 수정' : '자료 추가'}
        </h3>
        <button id="_ae-close" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer;">✕</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="form-group">
          <label class="form-label">제목 <span style="color:#dc2626;">*</span></label>
          <input type="text" id="_ae-title" class="form-control"
            value="${Utils.escHtml(data.title||'')}" placeholder="자료 제목을 입력하세요">
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label class="form-label">고객사</label>
            <select id="_ae-client" class="form-control">${cliOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">카테고리</label>
            <select id="_ae-category" class="form-control">${catOpts}</select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">키워드</label>
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px;" id="_ae-kw-tags">
            ${existingKws.map(k => `
              <span style="display:inline-flex;align-items:center;gap:4px;background:#eff6ff;color:#2563eb;
                border-radius:6px;padding:3px 10px;font-size:12px;">
                ${Utils.escHtml(k)}
                <button data-kw="${Utils.escHtml(k)}" class="_ae-rm-kw"
                  style="background:none;border:none;cursor:pointer;color:#93c5fd;font-size:11px;">✕</button>
              </span>`).join('')}
          </div>
          <div style="display:flex;gap:6px;">
            <input type="text" id="_ae-kw-input" class="form-control" placeholder="키워드 입력 후 Enter">
            <button onclick="_aeAddKw()" class="btn btn-outline" style="white-space:nowrap;flex-shrink:0;">추가</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">관련 법령</label>
          <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px;" id="_ae-law-tags">
            ${existingLaws.map(l => `
              <span style="display:inline-flex;align-items:center;gap:4px;background:#fff7ed;color:#c2410c;
                border-radius:6px;padding:3px 10px;font-size:12px;">
                ${Utils.escHtml(l)}
                <button data-law="${Utils.escHtml(l)}" class="_ae-rm-law"
                  style="background:none;border:none;cursor:pointer;color:#fdba74;font-size:11px;">✕</button>
              </span>`).join('')}
          </div>
          <div style="display:flex;gap:6px;">
            <input type="text" id="_ae-law-input" class="form-control" placeholder="법령명 입력 후 Enter">
            <button onclick="_aeAddLaw()" class="btn btn-outline" style="white-space:nowrap;flex-shrink:0;">추가</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">내용</label>
          <div id="_ae-editor" style="min-height:200px;border:1px solid #e2e8f0;border-radius:8px;"></div>
        </div>
      </div>

      <div id="_ae-err" style="color:#dc2626;font-size:12px;margin-top:10px;display:none;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9;">
        <button id="_ae-cancel" class="btn btn-outline">취소</button>
        <button id="_ae-save" class="btn btn-primary">
          <i class="fa-solid fa-floppy-disk"></i> 저장
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  /* Quill 초기화 */
  let aeQuill = null;
  if (typeof Quill !== 'undefined') {
    aeQuill = new Quill('#_ae-editor', {
      theme: 'snow',
      placeholder: '자료 내용을 입력하세요…',
      modules: {
        toolbar: [
          [{ header: [1,2,3,false] }],
          ['bold','italic','underline'],
          [{ list:'ordered' },{ list:'bullet' }],
          ['link'], ['clean']
        ]
      }
    });
    if (data.content) aeQuill.root.innerHTML = data.content;
  }

  /* 키워드 태그 관리 */
  let aeKws  = [...existingKws];
  let aeLaws = [...existingLaws];

  const refreshKwTags = () => {
    const wrap = overlay.querySelector('#_ae-kw-tags');
    if (!wrap) return;
    wrap.innerHTML = aeKws.map(k => `
      <span style="display:inline-flex;align-items:center;gap:4px;background:#eff6ff;color:#2563eb;
        border-radius:6px;padding:3px 10px;font-size:12px;">
        ${Utils.escHtml(k)}
        <button data-kw="${Utils.escHtml(k)}" class="_ae-rm-kw"
          style="background:none;border:none;cursor:pointer;color:#93c5fd;font-size:11px;">✕</button>
      </span>`).join('');
    wrap.querySelectorAll('._ae-rm-kw').forEach(btn => {
      btn.onclick = () => { aeKws = aeKws.filter(x => x !== btn.dataset.kw); refreshKwTags(); };
    });
  };
  refreshKwTags();

  const refreshLawTags = () => {
    const wrap = overlay.querySelector('#_ae-law-tags');
    if (!wrap) return;
    wrap.innerHTML = aeLaws.map(l => `
      <span style="display:inline-flex;align-items:center;gap:4px;background:#fff7ed;color:#c2410c;
        border-radius:6px;padding:3px 10px;font-size:12px;">
        ${Utils.escHtml(l)}
        <button data-law="${Utils.escHtml(l)}" class="_ae-rm-law"
          style="background:none;border:none;cursor:pointer;color:#fdba74;font-size:11px;">✕</button>
      </span>`).join('');
    wrap.querySelectorAll('._ae-rm-law').forEach(btn => {
      btn.onclick = () => { aeLaws = aeLaws.filter(x => x !== btn.dataset.law); refreshLawTags(); };
    });
  };
  refreshLawTags();

  window._aeAddKw = () => {
    const inp = overlay.querySelector('#_ae-kw-input');
    const val = inp?.value.trim();
    if (val && !aeKws.includes(val)) { aeKws.push(val); refreshKwTags(); }
    if (inp) inp.value = '';
  };
  window._aeAddLaw = () => {
    const inp = overlay.querySelector('#_ae-law-input');
    const val = inp?.value.trim();
    if (val && !aeLaws.includes(val)) { aeLaws.push(val); refreshLawTags(); }
    if (inp) inp.value = '';
  };

  ['#_ae-kw-input','#_ae-law-input'].forEach((sel, i) => {
    overlay.querySelector(sel)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); i === 0 ? window._aeAddKw() : window._aeAddLaw(); }
    });
  });

  const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
  overlay.querySelector('#_ae-close').onclick  = close;
  overlay.querySelector('#_ae-cancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#_ae-save').onclick = async () => {
    const errEl  = overlay.querySelector('#_ae-err');
    const saveBtn = overlay.querySelector('#_ae-save');
    errEl.style.display = 'none';

    const title = overlay.querySelector('#_ae-title').value.trim();
    if (!title) { errEl.textContent = '제목을 입력하세요.'; errEl.style.display=''; return; }

    const content     = aeQuill ? aeQuill.root.innerHTML : '';
    const contentText = aeQuill ? aeQuill.getText().trim() : '';

    const payload = {
      title,
      client_id:   overlay.querySelector('#_ae-client').value   || null,
      category_id: overlay.querySelector('#_ae-category').value || null,
      keywords:    aeKws,
      law_refs:    aeLaws,
      content,
      content_text: contentText,
      source:      id ? (data.source || 'manual') : 'manual',
      created_by:  _arSession.userId,
    };

    const restore = BtnLoading.start(saveBtn, '저장 중…');
    try {
      if (id) {
        await API.update('archive_items', id, payload);
        Toast.success('수정되었습니다.');
      } else {
        await API.create('archive_items', payload);
        Toast.success('자료가 추가되었습니다.');
      }
      close();
      _arExpandedId = null;
      await _loadArchive();
    } catch (err) {
      errEl.textContent = '저장 중 오류가 발생했습니다.';
      errEl.style.display = '';
    } finally {
      restore();
    }
  };

  setTimeout(() => overlay.querySelector('#_ae-title')?.focus(), 80);
}
window.openArchiveEdit = openArchiveEdit;

/* ══════════════════════════════════════════════
   삭제
══════════════════════════════════════════════ */
async function deleteArchiveItem(id) {
  const ok = await Confirm.show({
    title: '자료 삭제',
    message: '이 자료를 삭제하시겠습니까? 첨부파일도 함께 삭제됩니다.',
    confirmText: '삭제',
    confirmClass: 'btn-danger'
  });
  if (!ok) return;

  try {
    await API.delete('archive_items', id);
    Toast.success('삭제되었습니다.');
    _arExpandedId = null;
    await _loadArchive();
  } catch (err) {
    Toast.error('삭제 중 오류가 발생했습니다.');
  }
}
window.deleteArchiveItem = deleteArchiveItem;
/* ══════════════════════════════════════════════
   파일 업로드
══════════════════════════════════════════════ */
async function openArchiveUpload() {
  const overlay = document.createElement('div');
  overlay.id = '_arch-upload-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

  const cliOpts = [
    '<option value="">고객사 선택</option>',
    ...(_arMasters.clients || []).map(c =>
      `<option value="${c.id}">${Utils.escHtml(c.name)}</option>`)
  ].join('');

  const catOpts = [
    '<option value="">카테고리 선택</option>',
    ...(_arMasters.categories || []).map(c =>
      `<option value="${c.id}">${Utils.escHtml(c.name)}</option>`)
  ].join('');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;padding:26px;width:520px;max-width:92vw;
      max-height:88vh;overflow-y:auto;box-shadow:0 24px 70px rgba(0,0,0,0.22);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 style="font-size:16px;font-weight:700;color:#1e293b;margin:0;">
          <i class="fa-solid fa-upload" style="color:#2d6bb5;margin-right:8px;"></i> 파일 업로드
        </h3>
        <button id="_au-close" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer;">✕</button>
      </div>

      <!-- 드롭존 -->
      <div id="_au-dropzone" style="border:2px dashed #cbd5e1;border-radius:10px;padding:32px;
        text-align:center;cursor:pointer;transition:all 0.2s;margin-bottom:16px;">
        <i class="fa-solid fa-cloud-arrow-up" style="font-size:32px;color:#cbd5e1;display:block;margin-bottom:10px;"></i>
        <div style="font-size:13px;color:#64748b;">파일을 드래그하거나 클릭하여 선택</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:4px;">PDF, Word, Excel, HWP, 이미지 (최대 20MB)</div>
        <input type="file" id="_au-file-input" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.jpg,.jpeg,.png,.gif,.txt,.zip"
          style="display:none;">
      </div>
      <div id="_au-file-list" style="margin-bottom:16px;"></div>

      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="form-group">
          <label class="form-label">제목 <span style="color:#dc2626;">*</span></label>
          <input type="text" id="_au-title" class="form-control" placeholder="자료 제목">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="form-group">
            <label class="form-label">고객사</label>
            <select id="_au-client" class="form-control">${cliOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">카테고리</label>
            <select id="_au-category" class="form-control">${catOpts}</select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">설명</label>
          <textarea id="_au-desc" class="form-control" rows="3" placeholder="파일 설명 (선택)"></textarea>
        </div>
      </div>

      <div id="_au-err" style="color:#dc2626;font-size:12px;margin-top:8px;display:none;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;padding-top:14px;border-top:1px solid #f1f5f9;">
        <button id="_au-cancel" class="btn btn-outline">취소</button>
        <button id="_au-save" class="btn btn-primary">
          <i class="fa-solid fa-upload"></i> 업로드
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  let selectedFiles = [];

  const updateFileList = () => {
    const listEl = overlay.querySelector('#_au-file-list');
    if (!listEl) return;
    if (!selectedFiles.length) { listEl.innerHTML = ''; return; }
    listEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${selectedFiles.map((f, i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
            <span style="font-size:18px;">${_arFileIcon(f.name)}</span>
            <span style="flex:1;font-size:12px;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Utils.escHtml(f.name)}</span>
            <span style="font-size:11px;color:#94a3b8;">${_arFileSize(f.size)}</span>
            <button data-idx="${i}" class="_au-rm-file" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:12px;">✕</button>
          </div>`).join('')}
      </div>`;
    listEl.querySelectorAll('._au-rm-file').forEach(btn => {
      btn.onclick = () => {
        selectedFiles.splice(parseInt(btn.dataset.idx), 1);
        updateFileList();
      };
    });
  };

  /* 드롭존 이벤트 */
  const dz = overlay.querySelector('#_au-dropzone');
  const fi = overlay.querySelector('#_au-file-input');

  dz.onclick = () => fi.click();
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.borderColor='#2d6bb5'; dz.style.background='#eff6ff'; });
  dz.addEventListener('dragleave', () => { dz.style.borderColor='#cbd5e1'; dz.style.background=''; });
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.style.borderColor='#cbd5e1'; dz.style.background='';
    selectedFiles = [...selectedFiles, ...Array.from(e.dataTransfer.files)];
    updateFileList();
  });
  fi.onchange = () => {
    selectedFiles = [...selectedFiles, ...Array.from(fi.files)];
    updateFileList();
    fi.value = '';
  };

  const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); };
  overlay.querySelector('#_au-close').onclick  = close;
  overlay.querySelector('#_au-cancel').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#_au-save').onclick = async () => {
    const errEl  = overlay.querySelector('#_au-err');
    const saveBtn = overlay.querySelector('#_au-save');
    errEl.style.display = 'none';

    const title = overlay.querySelector('#_au-title').value.trim();
    if (!title) { errEl.textContent = '제목을 입력하세요.'; errEl.style.display=''; return; }

    const filesMeta = selectedFiles.map(f => ({
      name: f.name,
      size: f.size,
      type: f.type,
      url:  '',   /* 실제 업로드 URL은 서버 연동 시 추가 */
    }));

    const payload = {
      title,
      client_id:    overlay.querySelector('#_au-client').value   || null,
      category_id:  overlay.querySelector('#_au-category').value || null,
      description:  overlay.querySelector('#_au-desc').value.trim(),
      content:      overlay.querySelector('#_au-desc').value.trim(),
      content_text: overlay.querySelector('#_au-desc').value.trim(),
      source:       'upload',
      files:        filesMeta,
      file_count:   filesMeta.length,
      keywords:     [],
      law_refs:     [],
      created_by:   _arSession.userId,
    };

    const restore = BtnLoading.start(saveBtn, '업로드 중…');
    try {
      await API.create('archive_items', payload);
      Toast.success('업로드 완료');
      close();
      await _loadArchive();
    } catch (err) {
      errEl.textContent = '업로드 중 오류가 발생했습니다.';
      errEl.style.display = '';
    } finally {
      restore();
    }
  };

  setTimeout(() => overlay.querySelector('#_au-title')?.focus(), 80);
}
window.openArchiveUpload = openArchiveUpload;

/* ══════════════════════════════════════════════
   결재완료 항목 자동 아카이브
══════════════════════════════════════════════ */
async function archiveFromApproval(entryId) {
  try {
    const r = await API.get('time_entries', entryId);
    const entry = r?.data ?? r;
    if (!entry) { Toast.error('항목을 찾을 수 없습니다.'); return; }

    const payload = {
      title:        entry.title || '(제목 없음)',
      client_id:    entry.client_id || null,
      category_id:  entry.category_id || null,
      content:      entry.content || '',
      content_text: entry.content_text || '',
      source:       'approval',
      entry_id:     entryId,
      keywords:     [],
      law_refs:     [],
      file_count:   0,
      files:        [],
      created_by:   entry.user_id,
    };

    await API.create('archive_items', payload);
    Toast.success('자료실에 등록되었습니다.');
    await _loadArchive();
  } catch (err) {
    Toast.error('자료실 등록 중 오류가 발생했습니다.');
  }
}
window.archiveFromApproval = archiveFromApproval;

/* ══════════════════════════════════════════════
   Excel 내보내기
══════════════════════════════════════════════ */
async function exportArchiveExcel() {
  const btn = document.getElementById('arch-export-btn');
  const restore = BtnLoading.start(btn, '내보내는 중…');

  try {
    const params = { limit: 1000, sort: '-created_at' };
    if (_arFilter.search)      params.search                    = _arFilter.search;
    if (_arFilter.client_id)   params['filter[client_id]']      = _arFilter.client_id;
    if (_arFilter.category_id) params['filter[category_id]']    = _arFilter.category_id;

    const r = await API.list('archive_items', params);
    const items = r?.data ?? [];

    const cliMap  = Object.fromEntries((_arMasters.clients    || []).map(c => [c.id, c.name]));
    const catMap  = Object.fromEntries((_arMasters.categories || []).map(c => [c.id, c.name]));
    const userMap = Object.fromEntries((_arMasters.users      || []).map(u => [u.id, u.name]));

    const SOURCE_LABEL = {
      approval: '결재완료', upload: '업로드', manual: '직접입력', template: '템플릿'
    };

    const data = [
      ['제목','고객사','카테고리','출처','키워드','법령','작성자','등록일','내용']
    ];
    items.forEach(item => {
      data.push([
        item.title || '',
        item.client_id   ? (cliMap[item.client_id]   || '') : '',
        item.category_id ? (catMap[item.category_id] || '') : '',
        SOURCE_LABEL[item.source] || item.source || '',
        Array.isArray(item.keywords) ? item.keywords.join(', ') : '',
        Array.isArray(item.law_refs)  ? item.law_refs.join(', ')  : '',
        userMap[item.created_by] || '',
        (item.created_at||'').slice(0,10),
        item.content_text || item.description || '',
      ]);
    });

    await Utils.xlsxDownload(data, `자문자료실_${Utils.todayStr()}.xlsx`, '자료목록');
    Toast.success(`${items.length}건 내보내기 완료`);
  } catch (err) {
    Toast.error('내보내기 실패');
  } finally {
    restore();
  }
}
window.exportArchiveExcel = exportArchiveExcel;
/* ══════════════════════════════════════════════
   검색 결과 하이라이트
══════════════════════════════════════════════ */
function _highlightText(text, query) {
  if (!query || !text) return Utils.escHtml(text || '');
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex   = new RegExp(`(${escaped})`, 'gi');
  return Utils.escHtml(text).replace(regex, '<mark style="background:#fef08a;border-radius:2px;padding:0 2px;">$1</mark>');
}

/* ══════════════════════════════════════════════
   자료 탭 전환
══════════════════════════════════════════════ */
function switchArchiveTab(tab) {
  document.querySelectorAll('.arch-tab-content').forEach(el => {
    el.style.display = el.dataset.archTab === tab ? '' : 'none';
  });
  document.querySelectorAll('[data-arch-tab-btn]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.archTabBtn === tab);
  });
}
window.switchArchiveTab = switchArchiveTab;

/* ══════════════════════════════════════════════
   예시 키워드 클릭
══════════════════════════════════════════════ */
function clickExampleTag(kw) {
  const searchEl = document.getElementById('arch-search-input');
  if (searchEl) {
    searchEl.value = kw;
    _arFilter.search = kw;
    _arPage = 1;
    _loadArchive();
    searchEl.focus();
  }
}
window.clickExampleTag = clickExampleTag;

/* ══════════════════════════════════════════════
   통계 뷰
══════════════════════════════════════════════ */
async function renderArchiveStats() {
  const wrap = document.getElementById('arch-stats-wrap');
  if (!wrap) return;

  wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i></div>';

  try {
    const r = await API.list('archive_items', { limit: 2000 });
    const items = r?.data ?? [];

    const cliMap  = Object.fromEntries((_arMasters.clients    || []).map(c => [c.id, c.name]));
    const catMap  = Object.fromEntries((_arMasters.categories || []).map(c => [c.id, c.name]));

    const total = items.length;
    const bySource = {};
    const byCli    = {};
    const byCat    = {};
    const byMonth  = {};

    items.forEach(item => {
      /* 출처별 */
      const src = item.source || 'manual';
      bySource[src] = (bySource[src] || 0) + 1;

      /* 고객사별 */
      if (item.client_id) byCli[item.client_id] = (byCli[item.client_id] || 0) + 1;

      /* 카테고리별 */
      if (item.category_id) byCat[item.category_id] = (byCat[item.category_id] || 0) + 1;

      /* 월별 */
      const m = (item.created_at || '').slice(0, 7);
      if (m) byMonth[m] = (byMonth[m] || 0) + 1;
    });

    const topCli  = Object.entries(byCli).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const topCat  = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const months  = Object.keys(byMonth).sort().slice(-6);

    const SOURCE_LABEL = {
      approval: '결재완료', upload: '업로드', manual: '직접입력', template: '템플릿'
    };
    const SOURCE_COLOR = {
      approval: '#2d6bb5', upload: '#16a34a', manual: '#64748b', template: '#d97706'
    };

    const sourceCards = Object.entries(bySource).map(([src, cnt]) => `
      <div class="kpi-card" style="border-top:3px solid ${SOURCE_COLOR[src]||'#94a3b8'};">
        <div class="kpi-body">
          <div class="kpi-label">${SOURCE_LABEL[src]||src}</div>
          <div class="kpi-value" style="color:${SOURCE_COLOR[src]||'#94a3b8'};">${cnt}건</div>
          <div class="kpi-sub">${total ? Math.round((cnt/total)*100) : 0}%</div>
        </div>
      </div>`).join('');

    const barRow = (label, cnt, max, color) => {
      const w = Math.round((cnt / max) * 100);
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">
        <span style="font-size:12px;color:#334155;width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;">${Utils.escHtml(label)}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:4px;height:10px;overflow:hidden;">
          <div style="width:${w}%;height:100%;background:${color};border-radius:4px;transition:width 0.4s;"></div>
        </div>
        <span style="font-size:12px;font-weight:600;color:#1e293b;width:32px;text-align:right;">${cnt}</span>
      </div>`;
    };

    const cliMax = topCli[0]?.[1] || 1;
    const catMax = topCat[0]?.[1] || 1;
    const mMax   = Math.max(...months.map(m=>byMonth[m]), 1);

    const monthBars = months.map(m => `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;">
        <span style="font-size:12px;color:#64748b;width:50px;flex-shrink:0;">${m.slice(5)}월</span>
        <div style="flex:1;background:#f1f5f9;border-radius:4px;height:10px;overflow:hidden;">
          <div style="width:${Math.round((byMonth[m]/mMax)*100)}%;height:100%;background:#2d6bb5;border-radius:4px;"></div>
        </div>
        <span style="font-size:12px;font-weight:600;color:#1e293b;width:32px;text-align:right;">${byMonth[m]}</span>
      </div>`).join('');

    wrap.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:12px;color:#64748b;font-weight:600;margin-bottom:8px;">출처별 현황</div>
        <div class="kpi-grid">
          <div class="kpi-card" style="border-top:3px solid #2d6bb5;">
            <div class="kpi-body">
              <div class="kpi-label">전체 자료</div>
              <div class="kpi-value">${total}건</div>
            </div>
          </div>
          ${sourceCards}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div class="card">
          <div class="card-header"><span class="card-title">고객사별 자료</span></div>
          <div style="padding:12px 16px;">
            ${topCli.map(([id,cnt])=>barRow(cliMap[id]||id, cnt, cliMax, '#2d6bb5')).join('')||'<div style="color:#94a3b8;font-size:13px;">없음</div>'}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">카테고리별 자료</span></div>
          <div style="padding:12px 16px;">
            ${topCat.map(([id,cnt])=>barRow(catMap[id]||id, cnt, catMax, '#7c3aed')).join('')||'<div style="color:#94a3b8;font-size:13px;">없음</div>'}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">월별 등록 추이</span></div>
          <div style="padding:12px 16px;">
            ${monthBars||'<div style="color:#94a3b8;font-size:13px;">없음</div>'}
          </div>
        </div>
      </div>`;
  } catch (err) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#dc2626;">통계 로드 실패</div>';
  }
}
window.renderArchiveStats = renderArchiveStats;

/* ══════════════════════════════════════════════
   모달 닫기 (오버레이/ESC)
══════════════════════════════════════════════ */
(function _initArchModalClose() {
  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('arch-detail-modal');
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) closeArchiveDetail();
      });
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeArchiveDetail();
  });
})();

/* ══════════════════════════════════════════════
   외부 노출
══════════════════════════════════════════════ */
window.init_archive        = init_archive;
window.resetArchiveFilter  = resetArchiveFilter;
window.removeArKw          = removeArKw;
window.removeArLaw         = removeArLaw;
window.addArKwFilter       = addArKwFilter;
window.toggleArCard        = toggleArCard;
window.copyArchiveContent  = copyArchiveContent;
window.openArchiveDetail   = openArchiveDetail;
window.closeArchiveDetail  = closeArchiveDetail;
window.openArchiveEdit     = openArchiveEdit;
window.deleteArchiveItem   = deleteArchiveItem;
window.openArchiveUpload   = openArchiveUpload;
window.archiveFromApproval = archiveFromApproval;
window.exportArchiveExcel  = exportArchiveExcel;
window.renderArchiveStats  = renderArchiveStats;
window.switchArchiveTab    = switchArchiveTab;
window.clickExampleTag     = clickExampleTag;
window.archGoPage          = archGoPage;
