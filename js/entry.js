/* ============================================
   entry.js — 타임시트 등록 / 나의 타임시트
   ============================================ */

function _injectDescTableStyle(html) {
  if (!html) return html;
  try {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('o\\:p, w\\:sdt, w\\:sdtContent').forEach(el => {
      el.replaceWith(...Array.from(el.childNodes));
    });
    tmp.querySelectorAll('*').forEach(el => {
      const st = el.getAttribute('style') || '';
      if (st) {
        const cleaned = st.split(';').map(s => s.trim())
          .filter(s => s && !s.startsWith('mso-') && !s.startsWith('-mso')).join('; ');
        if (cleaned) el.setAttribute('style', cleaned);
        else el.removeAttribute('style');
      }
      el.removeAttribute('class');
    });
    tmp.querySelectorAll('table').forEach(t => {
      t.style.borderCollapse = 'collapse'; t.style.maxWidth = '100%';
      t.style.fontSize = '13px'; t.style.tableLayout = 'auto';
      t.removeAttribute('width'); t.style.width = 'auto';
    });
    tmp.querySelectorAll('th').forEach(el => {
      el.style.border = '1px solid #cbd5e1'; el.style.padding = '4px 8px';
      el.style.background = '#f1f5f9'; el.style.fontWeight = '700';
      el.style.textAlign = 'center'; el.style.verticalAlign = 'top';
      el.style.whiteSpace = 'pre-wrap'; el.style.wordBreak = 'break-word';
      el.removeAttribute('width'); el.removeAttribute('height');
    });
    tmp.querySelectorAll('td').forEach(el => {
      el.style.border = '1px solid #cbd5e1'; el.style.padding = '4px 8px';
      el.style.verticalAlign = 'top'; el.style.whiteSpace = 'pre-wrap';
      el.style.wordBreak = 'break-word';
      el.removeAttribute('width'); el.removeAttribute('height');
    });
    return tmp.innerHTML;
  } catch(e) { return html; }
}

let _allCategories    = [];
let _allSubcategories = [];
let _currentCategoryType = '';
let _pendingFiles     = [];
let _editEntryId    = null;
let _editMode       = false;
let _deletedAttIds  = [];
let _entriesPage  = 1;
const ENTRIES_PER_PAGE = 20;

let _quill = null;
let _turndown = null;

function _initQuill() {
  if (_quill) return;
  _quill = new Quill('#quill-editor', {
    theme: 'snow',
    placeholder: '메일 본문 또는 의견서 전문을 그대로 붙여넣기 하세요 (요약 불필요)',
    modules: {
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['clean']
      ],
      clipboard: { matchVisual: false }
    }
  });

  let _quillPasteLock = false;
  _quill.root.addEventListener('paste', function(e) {
    if (_quillPasteLock) return;
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    const htmlData = cd.getData('text/html');
    if (htmlData && htmlData.includes('<table')) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      _quillPasteLock = true;
      const cleanHtml = _injectDescTableStyle(htmlData);
      const editor = _quill.root;
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = cleanHtml;
      const existingText = editor.innerText.trim();
      if (!existingText) editor.innerHTML = '';
      const nodes = Array.from(tempDiv.childNodes).filter(n => {
        if (n.nodeType === Node.TEXT_NODE) return n.textContent.trim() !== '';
        if (n.nodeType === Node.ELEMENT_NODE) {
          if (['P','DIV','SPAN'].includes(n.tagName) && n.innerText?.trim() === '' && !n.querySelector('table')) return false;
        }
        return true;
      });
      const sel = window.getSelection();
      let insertBefore = null;
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        if (editor.contains(r.commonAncestorContainer)) {
          r.deleteContents();
          insertBefore = (r.endContainer === editor) ? null : r.endContainer;
        }
      }
      nodes.forEach(n => {
        if (insertBefore && editor.contains(insertBefore)) editor.insertBefore(n.cloneNode(true), insertBefore);
        else editor.appendChild(n.cloneNode(true));
      });
      _quill.update('user');
      setTimeout(() => {
        _quillPasteLock = false;
        _syncQuillToHidden();
        const len = editor.innerText.trim().length;
        const counter = document.getElementById('desc-char-count');
        if (counter) { counter.textContent = `${len}자`; counter.style.color = len > 15 ? '#f59e0b' : '#6b7280'; }
      }, 150);
    }
  }, true);

  _quill.on('text-change', () => {
    const len = _quill.getText().trim().length;
    const counter = document.getElementById('desc-char-count');
    if (counter) { counter.textContent = `${len}자`; counter.style.color = len > 15 ? '#f59e0b' : '#6b7280'; }
  });

  _turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
  const gfm = turndownPluginGfm.gfm;
  _turndown.use(gfm);
}

function _resetQuill() {
  if (!_quill) return;
  _quill.setText('');
  const counter = document.getElementById('desc-char-count');
  if (counter) { counter.textContent = '0자'; counter.style.color = '#6b7280'; }
}

function _syncQuillToHidden() {
  if (!_quill) return;
  const html = _quill.root.innerHTML;
  const isEmpty = html === '<p><br></p>' || html.trim() === '' || html.trim() === '<p></p>';
  const finalHtml = isEmpty ? '' : html;
  const hidHtml = document.getElementById('entry-description');
  const hidMd   = document.getElementById('entry-description-md');
  if (hidHtml) hidHtml.value = finalHtml;
  if (hidMd && _turndown && finalHtml) {
    try { hidMd.value = _turndown.turndown(finalHtml); }
    catch(err) { console.warn('[Quill] turndown 변환 실패:', err); hidMd.value = _quill.getText().trim(); }
  } else if (hidMd) { hidMd.value = ''; }
}

const FILE_MAX_BYTES  = 10 * 1024 * 1024;
const FILE_WARN_BYTES = 7 * 1024 * 1024;

function updateDescCount(el) {
  const len = (el ? el.value || '' : '').length;
  const counter = document.getElementById('desc-char-count');
  if (counter) { counter.textContent = `${len}자`; counter.style.color = len > 15 ? '#f59e0b' : '#6b7280'; }
}

async function init_entry_new() {
  if (_editMode) { _editMode = false; return; }
  const session = getSession();
  if (!Auth.canWriteEntry(session)) {
    if (Auth.isManager(session) && session.is_timesheet_target === false) {
      navigateTo('dashboard'); Toast.warning('타임시트 대상자로 지정되지 않았습니다.'); return;
    }
    if (!Auth.isStaff(session) && !Auth.isManager(session)) {
      navigateTo('dashboard'); Toast.warning('타임시트 작성 권한이 없습니다.'); return;
    }
    if (Auth.isStaff(session) && !Auth.hasApprover(session)) {
      navigateTo('archive'); Toast.warning('승인자가 지정되지 않아 타임시트를 작성할 수 없습니다.'); return;
    }
  }
  _editEntryId  = null;
  _pendingFiles = [];
  _currentCategoryType = '';
  document.getElementById('fileList').innerHTML = '';

  const _resetFormFields = () => {
    ['entry-category','entry-subcategory','entry-team','entry-client',
     'entry-start','entry-end','entry-duration',
     'kw-query-hidden','law-refs-hidden','kw-reason-hidden'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = el.id === 'law-refs-hidden' ? '[]' : '';
    });
  };
  _resetFormFields();
  document.getElementById('duration-text').textContent = '시작/종료 시간을 입력하면 자동 계산됩니다.';
  document.getElementById('entry-duration').value = '';
  _clearDurationInput();
  document.getElementById('entry-user-name').value = session.name;
  _initQuill(); _resetQuill();
  const mfn = document.getElementById('manual-file-name');
  const mfu = document.getElementById('manual-file-url');
  if (mfn) mfn.value = '';
  if (mfu) mfu.value = '';
  _clearKwTags('kw-query'); _clearKwTags('kw-reason'); _clearLawRefs(); _updateKwExamples();
  const memoEl = document.getElementById('entry-memo');
  if (memoEl) memoEl.value = '';
  _ensureLawMaster();
  _loadClientNamesForMask().catch(() => {});

  try {
    const [teams, clients, categories, subcategories] = await Promise.all([
      Master.teams(), Master.clients(), Master.categories(), Master.subcategories()
    ]);
    _allCategories    = categories;
    _allSubcategories = subcategories;
    const catEl = document.getElementById('entry-category');
    catEl.innerHTML = '<option value="">대분류 선택</option>';
    categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.category_name;
      opt.dataset.type = c.category_type || 'client';
      catEl.appendChild(opt);
    });
    await fillSelect('entry-team', teams, 'id', 'team_name', '팀 선택');
    ClientSearchSelect.init('entry-client-wrap', clients, {
      placeholder: '고객사 검색/선택...',
      onSelect: (id, name) => { document.getElementById('entry-client').value = id; }
    });
    document.getElementById('entry-client').value = '';
    updateClientSection();
    try {
      const userRecord       = await API.get('users', session.id);
      const approverNotice   = document.getElementById('entry-approver-notice');
      const noApproverNotice = document.getElementById('entry-no-approver-notice');
      const approverNameText = document.getElementById('entry-approver-name-text');
      const noApproverSpan   = noApproverNotice ? noApproverNotice.querySelector('span') : null;
      const isManager = session.role === 'manager';
      if (isManager) {
        const directorId   = (userRecord && userRecord.reviewer2_id)   || session.reviewer2_id   || '';
        const directorName = (userRecord && userRecord.reviewer2_name) || session.reviewer2_name || '';
        if (directorId) {
          approverNameText.textContent = 'Director: ' + (directorName || '지정됨');
          approverNotice.style.display = 'flex'; noApproverNotice.style.display = 'none';
        } else {
          if (noApproverSpan) noApproverSpan.textContent = 'Director가 지정되지 않았습니다.';
          approverNotice.style.display = 'none'; noApproverNotice.style.display = 'flex';
        }
      } else {
        const approverId   = (userRecord && userRecord.approver_id)   || session.approver_id   || '';
        const approverName = (userRecord && userRecord.approver_name) || session.approver_name || '';
        if (approverId) {
          approverNameText.textContent = approverName || '승인자 지정됨';
          approverNotice.style.display = 'flex'; noApproverNotice.style.display = 'none';
        } else {
          if (noApproverSpan) noApproverSpan.textContent = '승인자가 지정되지 않았습니다.';
          approverNotice.style.display = 'none'; noApproverNotice.style.display = 'flex';
        }
      }
    } catch { /* 배너 표시 실패 무시 */ }
  } catch (err) { console.error(err); Toast.error('데이터 로드 실패'); }
}

function onCategoryChange() {
  const catEl = document.getElementById('entry-category');
  const selectedOpt = catEl.options[catEl.selectedIndex];
  const catId  = catEl.value;
  const catType = selectedOpt ? selectedOpt.dataset.type : 'client';
  _currentCategoryType = catType || 'client';
  const subs = _allSubcategories.filter(s => s.category_id === catId);
  const subEl = document.getElementById('entry-subcategory');
  subEl.innerHTML = '<option value="">소분류 선택</option>';
  subs.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id; opt.textContent = s.sub_category_name;
    subEl.appendChild(opt);
  });
  updateClientSection();
}

function updateClientSection() {
  const isClient   = _currentCategoryType === 'client';
  const isInternal = _currentCategoryType === 'internal';
  const isNone     = !_currentCategoryType;
  const metaPanel      = document.querySelector('.entry-panel-meta');
  const descPanel      = document.querySelector('.entry-panel-desc');
  const filePanel      = document.getElementById('filePanel');
  const kwSection      = document.getElementById('kwSection');
  const clientSection  = document.getElementById('clientSection');
  const attachRequired = document.getElementById('attachRequired');
  const attachOptional = document.getElementById('attachOptional');
  const memoSection    = document.getElementById('internalMemoSection');

  if (isNone) {
    if (metaPanel)  metaPanel.classList.add('span-full');
    if (descPanel)  descPanel.style.display = 'none';
    if (filePanel)  { filePanel.style.display = 'none'; filePanel.classList.remove('span-full'); }
    if (kwSection)  kwSection.style.display  = 'none';
    if (clientSection) clientSection.style.display = 'none';
    if (attachRequired) attachRequired.style.display = 'none';
    if (attachOptional) attachOptional.style.display = 'none';
    if (memoSection) memoSection.style.display = 'none';
  } else if (isClient) {
    if (metaPanel)  metaPanel.classList.remove('span-full');
    if (descPanel)  descPanel.style.display = '';
    if (filePanel)  { filePanel.style.display = ''; filePanel.classList.remove('span-full'); }
    if (kwSection)  kwSection.style.display  = '';
    if (clientSection) clientSection.style.display = '';
    if (attachRequired) attachRequired.style.display = '';
    if (attachOptional) attachOptional.style.display = 'none';
    if (memoSection) memoSection.style.display = 'none';
  } else {
    if (metaPanel)  metaPanel.classList.add('span-full');
    if (descPanel)  descPanel.style.display = 'none';
    if (filePanel)  { filePanel.style.display = 'none'; filePanel.classList.remove('span-full'); }
    if (kwSection)  kwSection.style.display  = 'none';
    if (clientSection) clientSection.style.display = 'none';
    if (attachRequired) attachRequired.style.display = 'none';
    if (attachOptional) attachOptional.style.display = 'none';
    if (memoSection) memoSection.style.display = '';
  }
}

function onSubcategoryChange() { _updateKwExamples(); }

const _KW_EXAMPLES = {
  '품목분류': { query:'예: 스마트워치+HS 품목분류 쟁점', reason:'예: 기본 통칙 적용, GRI 3(b) 본질적 특성' },
  '과세가격': { query:'예: 수입자+특수관계 Management Fee 가산여부', reason:'예: 거래가격 인정, 특수관계 영향 없음' },
  '원산지판정': { query:'예: 중국산 원자재+완전생산기준 충족여부', reason:'예: 세번변경기준(CTH) 충족, 부가가치기준 60% 초과' },
  '전략물자': { query:'예: 탄소섬유+전략물자 해당여부', reason:'예: 통제번호(ECCN) 미해당, EAR99 해당' },
  '요건대상': { query:'예: 의료기기+수입요건 해당여부', reason:'예: HS코드 기준 요건 미해당, 면제조건 충족' },
  'FTA활용': { query:'예: 한-EU FTA+원산지증명서 발급', reason:'예: 세번변경기준 충족, 원산지신고서 발급' },
  '관세환급': { query:'예: 수출제품+수입원자재 간이정액환급', reason:'예: 소요량 산정 기준 충족, 환급신청기한 내' },
  '기타': { query:'예: 수입통관+세관 심사 대응', reason:'예: 관련 법령 해석, 행정해석 참고' }
};

function _updateKwExamples() {
  const subEl  = document.getElementById('entry-subcategory');
  const subTxt = subEl ? (subEl.options[subEl.selectedIndex]?.text || '') : '';
  let exampleSet = null;
  for (const [key, val] of Object.entries(_KW_EXAMPLES)) {
    if (subTxt.includes(key)) { exampleSet = val; break; }
  }
  const qEl = document.getElementById('kw-query-example');
  const rEl = document.getElementById('kw-reason-example');
  if (qEl) qEl.textContent = exampleSet ? exampleSet.query  : '예: 권리사용료+과세가격 가산';
  if (rEl) rEl.textContent = exampleSet ? exampleSet.reason : '예: 관련성 불충족, 거래조건불충족';
}

function _initKwEvents() {
  const qInput  = document.getElementById('kw-query-input');
  const qAddBtn = document.getElementById('kw-query-add-btn');
  const rInput  = document.getElementById('kw-reason-input');
  const rAddBtn = document.getElementById('kw-reason-add-btn');
  const lawInput  = document.getElementById('law-search-input');
  const artInput  = document.getElementById('law-article-input');
  const lawAddBtn = document.getElementById('law-add-btn');
  if (qInput)   qInput.addEventListener('keydown',  function(e){ if(e.key==='Enter'){e.preventDefault();_kwAdd('kw-query');} });
  if (qAddBtn)  qAddBtn.addEventListener('click',   function(){ _kwAdd('kw-query'); });
  if (rInput)   rInput.addEventListener('keydown',  function(e){ if(e.key==='Enter'){e.preventDefault();_kwAdd('kw-reason');} });
  if (rAddBtn)  rAddBtn.addEventListener('click',   function(){ _kwAdd('kw-reason'); });
  if (lawInput) {
    lawInput.addEventListener('input',   function(){ onLawSearchInput(this.value); });
    lawInput.addEventListener('keydown', function(e){ onLawSearchKeydown(e); });
  }
  if (artInput)  artInput.addEventListener('keydown',  function(e){ if(e.key==='Enter'){e.preventDefault();addLawRef();} });
  if (lawAddBtn) lawAddBtn.addEventListener('click', function(){ addLawRef(); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initKwEvents);
} else {
  _initKwEvents();
}
function _kwAdd(ns) {
  const wrap = document.getElementById(ns + '-wrap');
  const inp  = wrap ? wrap.querySelector('input[type="text"]') : null;
  if (!inp) return;
  const val = inp.value.trim();
  if (!val) return;
  _addKwTag(ns, val); inp.value = ''; inp.focus();
}
function kwTagKeydown(e, ns) { if (e.key !== 'Enter') return; e.preventDefault(); _kwAdd(ns); }
function _kwAddBtnClick(ns) { _kwAdd(ns); }

function _addKwTag(ns, text) {
  const wrap = document.getElementById(ns + '-wrap');
  if (!wrap || !text) return;
  const existing = Array.from(wrap.querySelectorAll('span[data-value]')).map(s => s.dataset.value);
  if (existing.includes(text)) return;
  const inp = wrap.querySelector('input[type="text"]');
  const tag = document.createElement('span');
  tag.dataset.value = text;
  tag.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#e0e7ff;color:#3730a3;border-radius:6px;padding:3px 9px;font-size:12px;font-weight:500;white-space:nowrap';
  const label = document.createTextNode(text);
  const btn   = document.createElement('button');
  btn.type = 'button'; btn.textContent = '×';
  btn.style.cssText = 'background:none;border:none;cursor:pointer;color:#6366f1;padding:0;font-size:14px;line-height:1;margin-left:2px';
  btn.addEventListener('click', function() { tag.remove(); _syncKwHidden(ns); });
  tag.appendChild(label); tag.appendChild(btn);
  if (inp) wrap.insertBefore(tag, inp); else wrap.appendChild(tag);
  _syncKwHidden(ns);
}
function _removeKwTag(btn, ns) { btn.parentElement.remove(); _syncKwHidden(ns); }
function _syncKwHidden(ns) {
  const wrap = document.getElementById(ns + '-wrap');
  if (!wrap) return;
  const tags = Array.from(wrap.querySelectorAll('span[data-value]')).map(s => s.dataset.value);
  const hid = document.getElementById(ns + '-hidden');
  if (hid) hid.value = JSON.stringify(tags);
}
function _clearKwTags(ns) {
  const wrap = document.getElementById(ns + '-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('span[data-value]').forEach(t => t.remove());
  const inp = wrap.querySelector('input[type="text"]');
  if (inp) inp.value = '';
  const hid = document.getElementById(ns + '-hidden');
  if (hid) hid.value = JSON.stringify([]);
}
function _setKwTags(ns, arr) {
  _clearKwTags(ns);
  if (Array.isArray(arr)) arr.forEach(v => v && _addKwTag(ns, v));
}

let _lawMasterCache = [];
let _lawDropdownIdx = -1;

async function _ensureLawMaster() {
  if (_lawMasterCache.length) return _lawMasterCache;
  try {
    const res = await API.list('law_master', { limit: 200 });
    _lawMasterCache = (res && res.data) ? res.data : [];
  } catch { _lawMasterCache = []; }
  return _lawMasterCache;
}
function onLawSearchInput(q) {
  const dd = document.getElementById('law-dropdown');
  if (!dd) return;
  if (!q.trim()) { dd.style.display = 'none'; return; }
  const hits = _lawMasterCache.filter(l => (l.full_name || l.law_name || '').toLowerCase().includes(q.toLowerCase()));
  if (!hits.length) { dd.style.display = 'none'; return; }
  const typeLabel = { law:'법', decree:'시행령', rule:'시행규칙', notice:'고시' };
  dd.innerHTML = hits.slice(0, 12).map((l, i) => {
    const tl = typeLabel[l.law_type] || l.law_type || '';
    return `<div data-idx="${i}" data-name="${Utils.escHtml(l.law_name)}" data-fullname="${Utils.escHtml(l.full_name||l.law_name)}"
      style="padding:7px 12px;font-size:13px;cursor:pointer;border-bottom:1px solid #f1f5f9"
      onmousedown="_pickLawDropdown(this)" onmouseover="_hoverLawDd(this)">
      <span style="font-weight:500">${Utils.escHtml(l.law_name)}</span>
      ${tl ? `<span style="font-size:10px;background:#f1f5f9;color:#64748b;border-radius:3px;padding:0 5px;margin-left:5px">${tl}</span>` : ''}
    </div>`;
  }).join('');
  _lawDropdownIdx = -1; dd.style.display = 'block';
}
function _hoverLawDd(el) {
  const dd = document.getElementById('law-dropdown');
  if (!dd) return;
  dd.querySelectorAll('[data-idx]').forEach(e => e.style.background = '');
  el.style.background = '#e0e7ff';
}
function _pickLawDropdown(el) {
  const inp = document.getElementById('law-search-input');
  if (inp) inp.value = el.dataset.name;
  const dd = document.getElementById('law-dropdown');
  if (dd) dd.style.display = 'none';
}
function onLawSearchKeydown(e) {
  const dd = document.getElementById('law-dropdown');
  if (!dd || dd.style.display === 'none') {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addLawRef(); } return;
  }
  const items = Array.from(dd.querySelectorAll('[data-idx]'));
  if (e.key === 'ArrowDown') { e.preventDefault(); _lawDropdownIdx = Math.min(_lawDropdownIdx + 1, items.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _lawDropdownIdx = Math.max(_lawDropdownIdx - 1, 0); }
  else if (e.key === 'Enter') {
    e.preventDefault(); e.stopPropagation();
    if (_lawDropdownIdx >= 0 && items[_lawDropdownIdx]) _pickLawDropdown(items[_lawDropdownIdx]);
    else addLawRef(); return;
  } else if (e.key === 'Escape') { dd.style.display = 'none'; return; } else { return; }
  items.forEach((it, i) => it.style.background = i === _lawDropdownIdx ? '#e0e7ff' : '');
}
function addLawRef() {
  const lawInp = document.getElementById('law-search-input');
  const artInp = document.getElementById('law-article-input');
  const dd     = document.getElementById('law-dropdown');
  if (!lawInp) return;
  const law = (lawInp.value || '').trim();
  if (!law) { Toast.warning('법령명을 입력하세요.'); lawInp.focus(); return; }
  const article = (artInp ? artInp.value : '').trim();
  _addLawRefTag(law, article);
  lawInp.value = ''; if (artInp) artInp.value = '';
  if (dd) dd.style.display = 'none';
}
function _addLawRefTag(law, article) {
  const container = document.getElementById('law-refs-tags');
  if (!container) return;
  const label = article ? `${law} ${article}` : law;
  const tag = document.createElement('span');
  tag.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#ede9fe;color:#5b21b6;border-radius:6px;padding:3px 9px;font-size:12px;font-weight:500;white-space:nowrap;margin-right:4px;margin-bottom:4px';
  tag.dataset.law = law; tag.dataset.article = article;
  tag.innerHTML = `<i class="fas fa-balance-scale" style="font-size:10px"></i>${Utils.escHtml(label)}<button type="button" onclick="_removeLawRefTag(this)" style="background:none;border:none;cursor:pointer;color:#7c3aed;padding:0;font-size:12px;line-height:1;margin-left:2px">&times;</button>`;
  container.appendChild(tag); _syncLawRefsHidden();
}
function _removeLawRefTag(btn) { btn.parentElement.remove(); _syncLawRefsHidden(); }
function _syncLawRefsHidden() {
  const container = document.getElementById('law-refs-tags');
  const hid = document.getElementById('law-refs-hidden');
  if (!container || !hid) return;
  const arr = Array.from(container.querySelectorAll('[data-law]')).map(t => ({ law: t.dataset.law, article: t.dataset.article || '' }));
  hid.value = JSON.stringify(arr);
}
function _clearLawRefs() {
  const container = document.getElementById('law-refs-tags');
  if (container) container.innerHTML = '';
  const hid = document.getElementById('law-refs-hidden');
  if (hid) hid.value = '[]';
}
function _setLawRefs(arr) {
  _clearLawRefs();
  if (!Array.isArray(arr)) {
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } } else { arr = []; }
  }
  arr.forEach(r => _addLawRefTag(r.law || '', r.article || ''));
}
document.addEventListener('click', e => {
  const dd = document.getElementById('law-dropdown');
  const inp = document.getElementById('law-search-input');
  if (dd && inp && !inp.contains(e.target) && !dd.contains(e.target)) dd.style.display = 'none';
}, true);

async function checkTimeOverlap(newStart, newEnd, excludeId = '') {
  try {
    const session = getSession();
    const res = await API.list('time_entries', { limit: 500 });
    const entries = (res && res.data) ? res.data : [];
    const mine = entries.filter(e => String(e.user_id) === String(session.id) && !e.deleted && e.id !== excludeId && e.work_start_at && e.work_end_at);
    for (const e of mine) {
      const eStart = Number(e.work_start_at); const eEnd = Number(e.work_end_at);
      if (newStart < eEnd && newEnd > eStart) return { overlap: true, conflict: e };
    }
    return { overlap: false, conflict: null };
  } catch { return { overlap: false, conflict: null }; }
}

let _overlapWarnTimer = null;
async function calcDuration() {
  const start   = document.getElementById('entry-start').value;
  const end     = document.getElementById('entry-end').value;
  const minutes = Utils.calcDurationMinutes(start, end);
  const display = document.getElementById('duration-display');
  const text    = document.getElementById('duration-text');
  const hidden  = document.getElementById('entry-duration');
  const prevWarn = document.getElementById('overlap-warn-banner');
  if (prevWarn) prevWarn.remove();
  if (minutes > 0) {
    text.textContent  = '참고: 시작~종료 기준 ' + Utils.formatDurationLong(minutes);
    display.style.borderColor = '#bbf7d0'; display.style.background = '#f0fdf4'; display.style.color = '#15803d';
    _setDurationInputIfEmpty(minutes); syncActualDuration();
    clearTimeout(_overlapWarnTimer);
    _overlapWarnTimer = setTimeout(async () => {
      const newStart = new Date(start).getTime(); const newEnd = new Date(end).getTime();
      const { overlap, conflict } = await checkTimeOverlap(newStart, newEnd, _editEntryId || '');
      if (overlap && conflict) _showOverlapBanner(conflict, newStart, newEnd, false);
    }, 300);
  } else if (start && end) {
    text.textContent = '⚠️ 종료시간이 시작시간보다 빠릅니다.';
    display.style.borderColor = 'var(--danger)'; display.style.background = 'var(--danger-bg)'; display.style.color = '';
    hidden.value = '';
  } else {
    text.textContent = '시작/종료 시간을 입력하면 자동 계산됩니다.';
    display.style.borderColor = '#bbf7d0'; display.style.background = '#f0fdf4'; display.style.color = '#15803d';
    hidden.value = '';
  }
}
function syncActualDuration() {
  const hEl = document.getElementById('entry-duration-h');
  const mEl = document.getElementById('entry-duration-m');
  const hidden = document.getElementById('entry-duration');
  if (!hEl || !mEl || !hidden) return;
  const h = parseInt(hEl.value) || 0; const m = parseInt(mEl.value) || 0;
  const total = h * 60 + m; hidden.value = total > 0 ? total : '';
}
function _setDurationInputIfEmpty(minutes) {
  const hEl = document.getElementById('entry-duration-h');
  const mEl = document.getElementById('entry-duration-m');
  if (!hEl || !mEl) return;
  if (!hEl.value && !mEl.value) { hEl.value = Math.floor(minutes / 60); mEl.value = minutes % 60; }
}
function _setDurationInput(minutes) {
  const hEl = document.getElementById('entry-duration-h');
  const mEl = document.getElementById('entry-duration-m');
  if (!hEl || !mEl) return;
  hEl.value = Math.floor(minutes / 60); mEl.value = minutes % 60; syncActualDuration();
}
function _clearDurationInput() {
  const hEl = document.getElementById('entry-duration-h');
  const mEl = document.getElementById('entry-duration-m');
  if (hEl) hEl.value = ''; if (mEl) mEl.value = '';
  const hidden = document.getElementById('entry-duration');
  if (hidden) hidden.value = '';
}
function _showOverlapBanner(conflict, newStart, newEnd, isBlocking) {
  const prev = document.getElementById('overlap-warn-banner');
  if (prev) prev.remove();
  const fmt = (ts) => { const d = new Date(Number(ts)); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
  const fmtDate = (ts) => { const d = new Date(Number(ts)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const cDate = fmtDate(conflict.work_start_at); const cStart = fmt(conflict.work_start_at); const cEnd = fmt(conflict.work_end_at);
  const nStart = fmt(newStart); const nEnd = fmt(newEnd);
  const clientLabel = conflict.client_name || '내부업무'; const subLabel = conflict.work_subcategory_name || conflict.work_category_name || '-';
  const banner = document.createElement('div');
  banner.id = 'overlap-warn-banner';
  banner.style.cssText = 'margin-top:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:12px;line-height:1.7;color:#1e293b;display:flex;gap:10px;align-items:flex-start';
  banner.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#f59e0b;margin-top:2px;flex-shrink:0"></i>
    <div><div style="font-weight:700;margin-bottom:3px;color:#92400e">⚠️ 시간이 겹치는 업무가 있습니다</div>
    <div style="color:#475569">기존: <b>[${cDate}] ${cStart} ~ ${cEnd}</b>&nbsp;·&nbsp; ${clientLabel} / ${subLabel}</div>
    <div style="color:#64748b;margin-top:2px">입력: ${fmtDate(newStart)} ${nStart} ~ ${nEnd}</div>
    <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #fde68a;color:#92400e;font-size:11px">
      💡 두 업무의 실제 소요시간 합계가 전체 시간을 초과하지 않는지 확인하고,<br>필요 시 각 업무의 <b>실제 소요시간을 직접 수정</b>해 주세요.</div></div>`;
  const display = document.getElementById('duration-display');
  if (display && display.parentNode) display.parentNode.insertBefore(banner, display.nextSibling);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function onDragOver(e)  { e.preventDefault(); document.getElementById('fileDropZone').classList.add('dragover'); }
function onDragLeave(e) { document.getElementById('fileDropZone').classList.remove('dragover'); }
function onFileDrop(e) { e.preventDefault(); document.getElementById('fileDropZone').classList.remove('dragover'); addFiles(Array.from(e.dataTransfer.files)); }
function onFileSelect(e) { addFiles(Array.from(e.target.files)); e.target.value = ''; }

async function addFiles(files) {
  for (const file of files) {
    const type = Utils.getFileType(file.name);
    if (!type) { Toast.warning(`${file.name}: 허용되지 않은 파일 형식`); continue; }
    if (file.size > FILE_MAX_BYTES) { Toast.error(`${file.name}: 10MB 초과`); continue; }
    if (file.size > FILE_WARN_BYTES) Toast.warning(`${file.name}: 파일이 큽니다.`);
    const progressId = `prog_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    _pendingFiles.push({ file, type, docType:'', summary:'', fileUrl:'', fileName:file.name, content:null, sizeKB:Math.round(file.size/1024), uploadMode:'base64', _id:progressId, _loading:true, extractedText:null, extractStatus:'' });
    renderFileList();
    try {
      const base64 = await fileToBase64(file);
      const { text: rawText, status: extStatus } = await _extractTextFromFile(file);
      let maskedText = null;
      if (rawText) maskedText = await _maskSensitiveText(rawText);
      const idx = _pendingFiles.findIndex(p => p._id === progressId);
      if (idx !== -1) { _pendingFiles[idx].content = base64; _pendingFiles[idx]._loading = false; _pendingFiles[idx].extractedText = maskedText; _pendingFiles[idx].extractStatus = extStatus; }
      if (extStatus === 'ok' && maskedText) Toast.success(`✅ ${file.name}: 텍스트 추출 완료`);
      else if (extStatus === 'scan_pdf') Toast.warning(`⚠️ ${file.name}: 스캔 PDF`);
      else if (extStatus === 'ppt') Toast.warning(`⚠️ ${file.name}: PPT → PDF 변환 권장`);
    } catch (err) {
      const idx = _pendingFiles.findIndex(p => p._id === progressId);
      if (idx !== -1) _pendingFiles.splice(idx, 1);
      Toast.error(`${file.name}: 파일 읽기 실패`);
    }
    renderFileList();
  }
}

function addFileByUrl() {
  const nameEl = document.getElementById('manual-file-name');
  const urlEl  = document.getElementById('manual-file-url');
  const typeEl = document.getElementById('manual-file-type');
  const name = nameEl.value.trim(); const url = urlEl.value.trim(); const type = typeEl.value;
  if (!name) { Toast.warning('파일명을 입력하세요.'); return; }
  if (!url)  { Toast.warning('파일 URL을 입력하세요.'); return; }
  if (!url.startsWith('http')) { Toast.warning('올바른 URL을 입력하세요.'); return; }
  _pendingFiles.push({ file:null, type, docType:'', summary:'', fileUrl:url, fileName:name, content:null, sizeKB:0, uploadMode:'url', _id:`url_${Date.now()}`, _loading:false });
  nameEl.value = ''; urlEl.value = ''; renderFileList(); Toast.success('파일 링크가 추가되었습니다.');
}

function renderFileList() {
  const list = document.getElementById('fileList');
  if (_pendingFiles.length === 0) { list.innerHTML = ''; return; }
  const icons  = { excel:'fa-file-excel', word:'fa-file-word', ppt:'fa-file-powerpoint', pdf:'fa-file-pdf', link:'fa-link' };
  const colors = { excel:'#16a34a', word:'#1d4ed8', ppt:'#c2410c', pdf:'#b91c1c', link:'#7c3aed' };
  const docTypes = ['보고서', '회의록', '의견서', '검토의견서', '기타'];
  list.innerHTML = _pendingFiles.map((pf, i) => {
    const name = pf.file ? pf.file.name : (pf.fileName || '이름 없음');
    const isUrl = pf.uploadMode === 'url'; const isLoading = pf._loading;
    let statusBadge = '';
    if (isLoading) statusBadge = `<span style="background:#fef9c3;color:#92400e;border:1px solid #fde68a;border-radius:5px;padding:2px 8px;font-size:11px"><i class="fas fa-spinner fa-spin"></i> 추출 중...</span>`;
    else if (isUrl) statusBadge = `<span style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:5px;padding:2px 8px;font-size:11px"><i class="fas fa-link"></i> 링크</span>`;
    else if (pf.content) statusBadge = `<span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:5px;padding:2px 8px;font-size:11px"><i class="fas fa-check-circle"></i> 저장가능 · ${pf.sizeKB}KB</span>`;
    return `<div class="file-item" style="${isLoading?'opacity:0.65;':''}">
      <i class="fas ${icons[pf.type]||'fa-file'} file-icon" style="color:${colors[pf.type]||'#666'}"></i>
      <div class="file-info" style="flex:1;min-width:0">
        <div class="file-name" style="word-break:break-all;font-weight:500">${name}</div>
        <div class="file-meta" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:3px">${statusBadge}</div>
      </div>
      <select style="font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:5px;margin-right:6px;flex-shrink:0"
        onchange="_pendingFiles[${i}].docType=this.value" ${isLoading?'disabled':''}>
        <option value="">문서유형</option>
        ${docTypes.map(t => `<option value="${t}" ${pf.docType===t?'selected':''}>${t}</option>`).join('')}
      </select>
      <button class="btn-remove" onclick="_pendingFiles.splice(${i},1);renderFileList()" title="제거"><i class="fas fa-times"></i></button>
    </div>`;
  }).join('');
}
function _showPendingExtractedText(idx) {
  const pf = _pendingFiles[idx];
  if (!pf || !pf.extractedText) { Toast.warning('추출된 텍스트가 없습니다.'); return; }
  _openExtractedTextModal({ file_name: pf.file ? pf.file.name : (pf.fileName||'파일'), extracted_text: pf.extractedText });
}

let _clientNamesCache = null;
async function _loadClientNamesForMask() {
  if (_clientNamesCache !== null) return _clientNamesCache;
  try {
    const res = await API.list('clients', { limit: 500 });
    _clientNamesCache = ((res && res.data) ? res.data : []).map(c => (c.company_name || '').trim()).filter(Boolean);
  } catch { _clientNamesCache = []; }
  return _clientNamesCache;
}

const MASK_PATTERNS = [
  { re: /USD\s*[\d,]+|US\$[\d,]+|\$[\d,]+/gi,              label: '[금액(USD)]' },
  { re: /￦[\d,]+|KRW\s*[\d,]+/gi,                          label: '[금액(원화)]' },
  { re: /[\d,]+\s*(달러|원|천원|만원|억원|백만원)/gi,         label: '[금액]' },
  { re: /\d{5}-\d{2}-\d{6}[A-Z]/g,                          label: '[수입신고번호]' },
];

async function _maskSensitiveText(text) {
  if (!text) return text;
  let result = text;
  for (const { re, label } of MASK_PATTERNS) result = result.replace(new RegExp(re.source, re.flags), label);
  const clientNames = await _loadClientNamesForMask();
  for (const name of clientNames) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'gi'), '[고객사명]');
  }
  return result;
}

async function _extractTextFromFile(file) {
  const name = file.name.toLowerCase(); const ext = name.split('.').pop();
  if (ext === 'pptx' || ext === 'ppt') return { text: null, status: 'ppt' };
  if (ext === 'pdf') {
    try {
      await LibLoader.load('pdfjs');
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i); const content = await page.getTextContent();
        fullText += `\n--- 페이지 ${i} ---\n${content.items.map(item => item.str).join(' ')}`;
      }
      const trimmed = fullText.trim();
      if (trimmed.length < 10) return { text: null, status: 'scan_pdf' };
      return { text: trimmed, status: 'ok' };
    } catch (err) { console.warn('[extractText] PDF 추출 오류:', err); return { text: null, status: 'error' }; }
  }
  if (ext === 'docx' || ext === 'doc') {
    try {
      await LibLoader.load('mammoth'); const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return { text: (result.value || '').trim() || null, status: 'ok' };
    } catch (err) { return { text: null, status: 'error' }; }
  }
  if (ext === 'xlsx' || ext === 'xls') {
    try {
      await LibLoader.load('xlsx'); const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      let fullText = '';
      for (const sheetName of workbook.SheetNames) {
        fullText += `\n[시트명: ${sheetName}]\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])}`;
      }
      return { text: fullText.trim() || null, status: 'ok' };
    } catch (err) { return { text: null, status: 'error' }; }
  }
  return { text: null, status: 'unsupported' };
}

const SENSITIVE_PATTERNS = [
  { name: '금액(USD)',    pattern: /USD\s*[\d,]+|US\$[\d,]+|\$[\d,]+/gi },
  { name: '금액(원화)',   pattern: /￦[\d,]+|KRW\s*[\d,]+/gi },
  { name: '금액(한글단위)', pattern: /[\d,]+\s*(달러|원|천원|만원|억원|백만원)/gi },
  { name: '수입신고번호', pattern: /\d{5}-\d{2}-\d{6}[A-Z]/g }
];

async function _detectSensitiveInfo(text) {
  const results = []; const seen = new Set();
  for (const { name, pattern } of SENSITIVE_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags); let m;
    while ((m = re.exec(text)) !== null) {
      const key = `${name}::${m[0]}`;
      if (!seen.has(key)) { seen.add(key); results.push({ type: name, value: m[0] }); }
    }
  }
  try {
    const res = await API.list('clients', { limit: 500 });
    const clients = (res && res.data) ? res.data : [];
    const lowerText = text.toLowerCase();
    for (const c of clients) {
      const name = (c.company_name || '').trim();
      if (!name) continue;
      if (lowerText.includes(name.toLowerCase())) {
        const key = `고객사명::${name}`;
        if (!seen.has(key)) { seen.add(key); results.push({ type: '고객사명', value: name }); }
      }
    }
  } catch {}
  return results;
}

function _showSensitiveWarning(results, onProceed) {
  const modal = document.getElementById('sensitiveWarnModal');
  const list  = document.getElementById('sensitiveWarnList');
  const editBtn = document.getElementById('sensitiveWarnEditBtn');
  const procBtn = document.getElementById('sensitiveWarnProceedBtn');
  if (!modal || !list) return;
  list.innerHTML = results.map(r => `
    <li style="display:flex;align-items:baseline;gap:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;padding:7px 12px;font-size:12px">
      <span style="color:#f59e0b;font-size:13px;flex-shrink:0">•</span>
      <span><span style="font-weight:700;color:#92400e;min-width:90px;display:inline-block">${Utils.escHtml(r.type)}</span>
      <span style="color:#475569">${Utils.escHtml(r.value)}</span></span></li>`).join('');
  editBtn.onclick = () => { modal.classList.remove('show'); if (_quill) _quill.focus(); };
  procBtn.onclick = () => { modal.classList.remove('show'); onProceed(); };
  modal.classList.add('show');
}

async function submitEntry(e) { e.preventDefault(); await saveEntry('submitted'); }
async function saveEntryDraft() { await saveEntry('draft'); }

async function saveEntry(status) {
  const session = getSession();
  if (_pendingFiles.some(pf => pf._loading)) { Toast.warning('파일 변환 중입니다.'); return; }

  let approverInfo = { approver_id: session.approver_id||'', approver_name: session.approver_name||'', reviewer2_id: session.reviewer2_id||'', reviewer2_name: session.reviewer2_name||'' };
  try {
    const userRecord = await API.get('users', session.id);
    if (!userRecord) throw new Error('userRecord null');
    if (session.role === 'manager') {
      if (userRecord.reviewer2_id) {
        approverInfo = { approver_id: userRecord.reviewer2_id, approver_name: userRecord.reviewer2_name||'', reviewer2_id: userRecord.reviewer2_id, reviewer2_name: userRecord.reviewer2_name||'' };
      } else {
        const allUsers = await Master.users();
        const myDirector = allUsers.find(u => u.role==='director' && u.is_active!==false && Auth.scopeMatch(u, userRecord));
        if (myDirector) approverInfo = { approver_id: myDirector.id, approver_name: myDirector.name||'', reviewer2_id: myDirector.id, reviewer2_name: myDirector.name||'' };
      }
    } else {
      if (userRecord.approver_id) approverInfo = { approver_id: userRecord.approver_id, approver_name: userRecord.approver_name||'', reviewer2_id: userRecord.reviewer2_id||'', reviewer2_name: userRecord.reviewer2_name||'' };
      if (!approverInfo.approver_id && status === 'submitted') { Toast.warning('승인자가 지정되지 않았습니다.'); return; }
    }
  } catch (err) {
    console.warn('[saveEntry] approverInfo 조회 실패:', err);
    if (session.role === 'manager' && !approverInfo.reviewer2_id && status === 'submitted') { Toast.warning('2차 승인자(Director)가 지정되지 않았습니다.'); return; }
  }

  const catEl = document.getElementById('entry-category'); const subEl = document.getElementById('entry-subcategory'); const teamEl = document.getElementById('entry-team');
  const catId = catEl.value; const catName = catEl.options[catEl.selectedIndex]?.textContent||''; const catType = catEl.options[catEl.selectedIndex]?.dataset.type||'client';
  const subId = subEl.value; const subName = subEl.options[subEl.selectedIndex]?.textContent||'';
  const teamId = teamEl.value; const teamName = teamEl.options[teamEl.selectedIndex]?.textContent||'';
  const csVal = ClientSearchSelect.getValue('entry-client-wrap');
  const clientId = csVal.id || document.getElementById('entry-client').value||''; const clientName = csVal.name||'';
  const startAt = document.getElementById('entry-start').value; const endAt = document.getElementById('entry-end').value;
  syncActualDuration();
  const duration = parseInt(document.getElementById('entry-duration').value)||0;

  let description = '', descriptionMd = '';
  if (catType === 'client') { _syncQuillToHidden(); description = document.getElementById('entry-description').value.trim(); descriptionMd = document.getElementById('entry-description-md')?.value.trim()||''; }
  else { const memoEl = document.getElementById('entry-memo'); description = memoEl ? memoEl.value.trim() : ''; descriptionMd = description; }

  if (!catId || !subId) { Toast.warning('대분류와 소분류를 선택하세요.'); return; }
  if (!teamId) { Toast.warning('수행 팀을 선택하세요.'); return; }
  if (!startAt || !endAt) { Toast.warning('업무 시작/종료 일시를 입력하세요.'); return; }
  if (duration <= 0) { Toast.warning('실제 소요시간을 입력하세요.'); return; }
  if (catType === 'client' && !description) { Toast.warning('수행 내용을 입력하세요.'); if (_quill) _quill.focus(); return; }
  if (catType === 'client' && !clientId) { Toast.warning('고객사를 선택하세요.'); return; }
  if (catType === 'client' && status === 'submitted') {
    let kwArr = []; try { kwArr = JSON.parse(document.getElementById('kw-query-hidden')?.value||'[]'); } catch {}
    if (!kwArr.length) { Toast.warning('핵심키워드를 1개 이상 입력하세요.'); return; }
  }
  if (catType === 'client' && status === 'submitted' && _pendingFiles.length === 0) { Toast.warning('고객업무는 자문 결과물을 첨부해야 합니다.'); return; }

  const newStart = new Date(startAt).getTime(); const newEnd = new Date(endAt).getTime();
  const { overlap, conflict } = await checkTimeOverlap(newStart, newEnd, _editEntryId||'');
  if (overlap && conflict) _showOverlapBanner(conflict, newStart, newEnd, false);

  if (catType === 'client') {
    const quillText = _quill ? _quill.getText() : description;
    let kwQueryText = ''; try { const kwArr = JSON.parse(document.getElementById('kw-query-hidden')?.value||'[]'); kwQueryText = Array.isArray(kwArr)?kwArr.join(' '):''; } catch {}
    let kwReasonText = ''; try { const krArr = JSON.parse(document.getElementById('kw-reason-hidden')?.value||'[]'); kwReasonText = Array.isArray(krArr)?krArr.join(' '):''; } catch {}
    const combinedText = [quillText, kwQueryText, kwReasonText].filter(Boolean).join(' ');
    if (combinedText.trim()) {
      const sensitiveResults = await _detectSensitiveInfo(combinedText);
      if (sensitiveResults.length > 0) { _showSensitiveWarning(sensitiveResults, () => _doSaveEntry(status, approverInfo)); return; }
    }
  }
  await _doSaveEntry(status, approverInfo);
}

async function _doSaveEntry(status, approverInfo) {
  const session = getSession();
  if (!approverInfo) approverInfo = { approver_id: session.approver_id||'', approver_name: session.approver_name||'', reviewer2_id: session.reviewer2_id||'', reviewer2_name: session.reviewer2_name||'' };
  const catEl = document.getElementById('entry-category'); const subEl = document.getElementById('entry-subcategory'); const teamEl = document.getElementById('entry-team');
  const catId = catEl.value; const catName = catEl.options[catEl.selectedIndex]?.textContent||''; const catType = catEl.options[catEl.selectedIndex]?.dataset.type||'client';
  const subId = subEl.value; const subName = subEl.options[subEl.selectedIndex]?.textContent||'';
  const teamId = teamEl.value; const teamName = teamEl.options[teamEl.selectedIndex]?.textContent||'';
  const csVal = ClientSearchSelect.getValue('entry-client-wrap');
  const clientId = csVal.id || document.getElementById('entry-client').value||''; const clientName = csVal.name||'';
  const startAt = document.getElementById('entry-start').value; const endAt = document.getElementById('entry-end').value;
  syncActualDuration();
  const duration = parseInt(document.getElementById('entry-duration').value)||0;
  let description = '', descriptionMd = '';
  if (catType === 'client') { _syncQuillToHidden(); description = document.getElementById('entry-description').value.trim(); descriptionMd = document.getElementById('entry-description-md')?.value.trim()||''; }
  else { const memoEl = document.getElementById('entry-memo'); description = memoEl ? memoEl.value.trim() : ''; descriptionMd = description; }

  const isSubmit = status === 'submitted';
  const submitBtn = document.getElementById('submitEntryBtn'); const draftBtn = document.getElementById('draftEntryBtn');
  const restoreSubmit = BtnLoading.start(isSubmit ? submitBtn : draftBtn, isSubmit ? '제출 중...' : '저장 중...');
  const restoreOther = BtnLoading.disableAll(isSubmit ? draftBtn : submitBtn);

  try {
    const entryData = {
      user_id: session.id, user_name: session.name, team_id: teamId, team_name: teamName,
      client_id: catType==='client'?clientId:'', client_name: catType==='client'?clientName:'',
      work_category_id: catId, work_category_name: catName,
      work_subcategory_id: subId, work_subcategory_name: subName,
      time_category: catType,
      work_start_at: new Date(startAt).getTime(), work_end_at: new Date(endAt).getTime(),
      duration_minutes: duration,
      work_description: description, work_description_md: descriptionMd,
      approver_id: approverInfo.approver_id, approver_name: approverInfo.approver_name,
      reviewer2_id: approverInfo.reviewer2_id||'', reviewer2_name: approverInfo.reviewer2_name||'',
      status,
      kw_query:  catType==='client'?(()=>{try{return JSON.parse(document.getElementById('kw-query-hidden')?.value||'[]');}catch{return[];}})():[],
      law_refs:  catType==='client'?(document.getElementById('law-refs-hidden')?.value||'[]'):'[]',
      kw_reason: catType==='client'?(()=>{try{return JSON.parse(document.getElementById('kw-reason-hidden')?.value||'[]');}catch{return[];}})():[],
    };
    let entry;
    if (_editEntryId) entry = await API.update('time_entries', _editEntryId, entryData);
    else entry = await API.create('time_entries', entryData);

    if (_deletedAttIds.length > 0) {
      for (const attId of _deletedAttIds) { try { await API.delete('attachments', attId); } catch(e) { console.warn('첨부파일 삭제 실패:', attId, e); } }
      _deletedAttIds = [];
    }
    for (const pf of _pendingFiles) {
      await API.create('attachments', { entry_id:entry.id, file_name:pf.file?pf.file.name:(pf.fileName||''), file_type:pf.type||'link', file_size:pf.sizeKB||0, doc_type:pf.docType||'', summary:pf.summary||'', file_content:pf.content||'', file_url:pf.fileUrl||'', extracted_text:pf.extractedText||null });
    }
    if (status === 'submitted' && typeof createNotification === 'function') {
      const catLabel = catType==='client'?(clientName||'고객사'):catName;
      const summary = `${catLabel} | ${subName||catName}`;
      if (approverInfo.approver_id) createNotification({ toUserId:approverInfo.approver_id, toUserName:approverInfo.approver_name, fromUserId:session.id, fromUserName:session.name, type:'submitted', entryId:entry.id, entrySummary:summary, message:`${session.name}님이 타임시트 승인을 요청했습니다.`, targetMenu:'approval' });
    }
    Toast.success(status==='submitted'?'타임시트가 제출되었습니다.':'임시저장되었습니다.');
    window._dashNeedsRefresh = true;
    _editEntryId = null; _pendingFiles = []; _deletedAttIds = []; _existingAtts = [];
    document.getElementById('fileList').innerHTML = '';
    ['entry-category','entry-subcategory','entry-team','entry-client','entry-start','entry-end','entry-duration','kw-query-hidden','law-refs-hidden','kw-reason-hidden'].forEach(id => {
      const el = document.getElementById(id); if (!el) return;
      if (el.tagName==='SELECT') el.selectedIndex=0; else el.value = el.id==='law-refs-hidden'?'[]':'';
    });
    document.getElementById('duration-text').textContent = '시작/종료 시간을 입력하면 자동 계산됩니다.';
    _clearDurationInput(); document.getElementById('entry-user-name').value = session.name;
    _resetQuill(); ClientSearchSelect.clear('entry-client-wrap'); document.getElementById('entry-client').value='';
    _clearKwTags('kw-query'); _clearKwTags('kw-reason'); _clearLawRefs(); updateClientSection();
    await updateApprovalBadge(session); restoreSubmit(); restoreOther(); navigateTo('my-entries');
  } catch (err) { console.error(err); restoreSubmit(); restoreOther(); Toast.error('저장 실패: ' + err.message); }
}
async function init_my_entries() {
  const session = getSession();
  if (!Auth.canWriteEntry(session)) {
    if (!Auth.isStaff(session) && !Auth.isManager(session)) { navigateTo('dashboard'); Toast.warning('My Time Sheet는 Staff/Manager만 접근 가능합니다.'); return; }
    if (Auth.isStaff(session) && !Auth.hasApprover(session)) { navigateTo('archive'); Toast.warning('승인자가 지정되지 않아 타임시트를 조회할 수 없습니다.'); return; }
  }
  _entriesPage = 1;
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
  const from = new Date(y, m, 1); const to = new Date(y, m+1, 0);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  document.getElementById('filter-entry-date-from').value = fmt(from);
  document.getElementById('filter-entry-date-to').value   = fmt(to);
  const [clients, categories, subcategories] = await Promise.all([Master.clients(), Master.categories(), Master.subcategories()]);
  await fillSelect('filter-entry-client', clients, 'id', 'company_name', '전체 고객사');
  const catEl = document.getElementById('filter-entry-category');
  catEl.innerHTML = '<option value="">전체 대분류</option>';
  categories.forEach(c => { const opt = document.createElement('option'); opt.value=c.id; opt.textContent=c.category_name; catEl.appendChild(opt); });
  const subEl = document.getElementById('filter-entry-subcategory');
  subEl.innerHTML = '<option value="">전체 소분류</option>';
  subcategories.forEach(s => { const opt = document.createElement('option'); opt.value=s.id; opt.textContent=s.sub_category_name; opt.dataset.categoryId=s.category_id; subEl.appendChild(opt); });
  await loadMyEntries();
}

function onEntryFilterCategoryChange() {
  const catId = document.getElementById('filter-entry-category').value;
  const subEl = document.getElementById('filter-entry-subcategory');
  subEl.value = '';
  Array.from(subEl.options).forEach(opt => { if (!opt.value) return; opt.style.display = (!catId || opt.dataset.categoryId===catId)?'':'none'; });
  const selected = subEl.options[subEl.selectedIndex];
  if (selected && selected.style.display==='none') subEl.value='';
}

async function loadMyEntries() {
  const session = getSession();
  const dateFrom = document.getElementById('filter-entry-date-from').value;
  const dateTo   = document.getElementById('filter-entry-date-to').value;
  const clientId     = document.getElementById('filter-entry-client').value;
  const categoryId   = document.getElementById('filter-entry-category').value;
  const subcategoryId= document.getElementById('filter-entry-subcategory').value;
  const status       = document.getElementById('filter-entry-status').value;
  const tsFrom = dateFrom ? new Date(dateFrom+'T00:00:00').getTime() : null;
  const tsTo   = dateTo   ? new Date(dateTo  +'T23:59:59').getTime() : null;
  try {
    const r = await API.list('time_entries', { limit: 500 });
    let entries = (r && r.data) ? r.data : [];
    if (session.role==='staff' || session.role==='manager') entries = entries.filter(e => String(e.user_id)===String(session.id));
    if (tsFrom || tsTo) {
      entries = entries.filter(e => {
        if (!e.work_start_at) return false;
        const raw=e.work_start_at; const num=Number(raw); let ts;
        if (!isNaN(num) && num>1000000000000) ts=num;
        else if (!isNaN(num) && num>1000000000) ts=num*1000;
        else ts=new Date(raw).getTime();
        if (isNaN(ts)) return false;
        if (tsFrom && ts<tsFrom) return false;
        if (tsTo   && ts>tsTo)   return false;
        return true;
      });
    }
    if (clientId)      entries = entries.filter(e => e.client_id===clientId);
    if (categoryId)    entries = entries.filter(e => e.work_category_id===categoryId);
    if (subcategoryId) entries = entries.filter(e => e.work_subcategory_id===subcategoryId);
    if (status)        entries = entries.filter(e => e.status===status);
    entries.sort((a,b) => new Date(b.work_start_at||0) - new Date(a.work_start_at||0));
    const totalH = entries.reduce((s,e) => s+(e.duration_minutes||0), 0);
    document.getElementById('entry-total-badge').textContent  = `전체 ${entries.length}건`;
    document.getElementById('entry-total-hours').textContent  = `총 ${(totalH/60).toFixed(1)}시간`;
    const start = (_entriesPage-1)*ENTRIES_PER_PAGE;
    const paged = entries.slice(start, start+ENTRIES_PER_PAGE);
    const attMap = await loadAttachmentsMap(paged.map(e => e.id));
    const tbody = document.getElementById('my-entries-body');
    if (paged.length===0) {
      tbody.innerHTML = `<tr><td colspan="9" class="table-empty"><i class="fas fa-inbox"></i><p>조회된 데이터가 없습니다.</p></td></tr>`;
    } else {
      const fmtDate = (ms) => { if(!ms) return '<span style="color:var(--text-muted)">—</span>'; const d=new Date(Number(ms)); return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; };
      const fmtDateShort = (ms) => { if(!ms) return '—'; const d=new Date(Number(ms)); return `${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; };
      const fmtTime = (ms) => { if(!ms) return '—'; const d=new Date(Number(ms)); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
      const fmtDatetime = (ms) => { if(!ms) return '<span style="color:var(--text-muted)">—</span>'; return `<span style="font-size:11.5px;white-space:nowrap">${fmtDateShort(ms)}&nbsp;<span style="color:var(--text-secondary)">${fmtTime(ms)}</span></span>`; };
      tbody.innerHTML = paged.map((e, idx) => {
        const rowNo = ((_entriesPage-1)*ENTRIES_PER_PAGE)+idx+1;
        const writtenAt = e.created_at ? fmtDate(e.created_at) : fmtDate(e.work_start_at);
        const canEdit = e.status==='draft' || e.status==='rejected';
        const B = 'width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;background:transparent;border:none;cursor:pointer;';
        const btns = [];
        btns.push(`<button style="${B}" onclick="openApprovalModal('${e.id}')" title="상세보기"><i class="fas fa-eye" style="font-size:13px;color:#94a3b8"></i></button>`);
        if (canEdit) btns.push(`<button style="${B}" onclick="editEntry('${e.id}')" title="수정"><i class="fas fa-edit" style="font-size:13px;color:#94a3b8"></i></button>`);
        if (e.status==='draft') btns.push(`<button style="${B}" onclick="submitSingleEntry('${e.id}')" title="제출"><i class="fas fa-paper-plane" style="font-size:13px;color:var(--primary)"></i></button>`);
        if (canEdit) btns.push(`<button style="${B}" onclick="deleteEntry('${e.id}')" title="삭제"><i class="fas fa-trash" style="font-size:13px;color:#f87171"></i></button>`);
        if (e.status==='rejected' && e.reviewer_comment) btns.push(`<button style="${B}" onclick="showRejectReason('${(e.reviewer_comment||'').replace(/'/g,"\\'")}')" title="반려사유"><i class="fas fa-comment-alt" style="font-size:13px;color:#e07b3a"></i></button>`);
        const clientHtml = e.client_name ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12.5px">${Utils.escHtml(e.client_name)}</span>` : `<span style="color:var(--text-muted);font-size:11px">내부</span>`;
        const teamHtml = e.team_name ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12px;color:var(--text-secondary)">${Utils.escHtml(e.team_name)}</span>` : `<span style="color:var(--text-muted);font-size:11px">—</span>`;
        const subHtml = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12.5px">${Utils.escHtml(e.work_subcategory_name||'—')}</span>`;
        return `<tr>
          <td style="text-align:center;color:var(--text-muted);font-size:12px">${rowNo}</td>
          <td style="font-size:12px;white-space:nowrap;color:var(--text-secondary)">${writtenAt}</td>
          <td style="padding:0 10px">${clientHtml}</td>
          <td style="padding:0 10px">${teamHtml}</td>
          <td style="padding:0 10px">${subHtml}</td>
          <td style="text-align:center;padding:0 6px">${fmtDatetime(e.work_start_at)}</td>
          <td style="text-align:center;padding:0 6px">${fmtDatetime(e.work_end_at)}</td>
          <td style="text-align:center;color:var(--text-secondary);font-size:12.5px;font-weight:600">${Utils.formatDuration(e.duration_minutes)}</td>
          <td style="text-align:center">${Utils.statusBadge(e.status)}</td>
          <td style="text-align:center;padding:0 4px"><div style="display:flex;gap:4px;justify-content:center">${btns.join('')}</div></td>
        </tr>`;
      }).join('');
    }
    document.getElementById('entry-pagination').innerHTML = Utils.paginationHTML(_entriesPage, entries.length, ENTRIES_PER_PAGE);
  } catch (err) { console.error(err); Toast.error('데이터 로드 실패'); }
}

async function loadAttachmentsMap(entryIds) {
  if (!entryIds.length) return {};
  try {
    const r = await API.list('attachments', { limit: 500 });
    const all = (r && r.data) ? r.data : [];
    const map = {};
    all.forEach(a => { if (entryIds.includes(a.entry_id)) { if (!map[a.entry_id]) map[a.entry_id]=[]; map[a.entry_id].push(a); } });
    return map;
  } catch { return {}; }
}

function changePage(page) { _entriesPage = page; loadMyEntries(); }

function resetEntryFilter() {
  const now=new Date(); const y=now.getFullYear(); const m=now.getMonth();
  const from=new Date(y,m,1); const to=new Date(y,m+1,0);
  const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  document.getElementById('filter-entry-date-from').value   = fmt(from);
  document.getElementById('filter-entry-date-to').value     = fmt(to);
  document.getElementById('filter-entry-client').value      = '';
  document.getElementById('filter-entry-category').value    = '';
  document.getElementById('filter-entry-subcategory').value = '';
  document.getElementById('filter-entry-status').value      = '';
  const subEl = document.getElementById('filter-entry-subcategory');
  Array.from(subEl.options).forEach(opt => { opt.style.display=''; });
  loadMyEntries();
}

async function editEntry(id) {
  try {
    const [entry] = await Promise.all([API.get('time_entries', id)]);
    if (!entry) { Toast.error('데이터를 찾을 수 없습니다.'); return; }
    _editEntryId = null; _editMode = false; _deletedAttIds = [];
    await init_entry_new();
    _editEntryId = id; _editMode = true; navigateTo('entry-new');
    const catEl = document.getElementById('entry-category');
    catEl.value = entry.work_category_id||''; onCategoryChange();
    const subEl = document.getElementById('entry-subcategory');
    subEl.value = entry.work_subcategory_id||'';
    const teamEl = document.getElementById('entry-team');
    for (const opt of teamEl.options) { if (opt.value===entry.team_id) { opt.selected=true; break; } }
    ClientSearchSelect.setValue('entry-client-wrap', entry.client_id||'', entry.client_name||'');
    document.getElementById('entry-client').value = entry.client_id||'';
    if (entry.work_start_at) { const startDate=new Date(Number(entry.work_start_at)); document.getElementById('entry-start').value=new Date(startDate.getTime()-startDate.getTimezoneOffset()*60000).toISOString().slice(0,16); }
    if (entry.work_end_at) { const endDate=new Date(Number(entry.work_end_at)); document.getElementById('entry-end').value=new Date(endDate.getTime()-endDate.getTimezoneOffset()*60000).toISOString().slice(0,16); }
    calcDuration();
    if (entry.duration_minutes && Number(entry.duration_minutes)>0) _setDurationInput(Number(entry.duration_minutes));
    const descHtml = entry.work_description||'';
    if (_quill) {
      _quill.root.innerHTML = descHtml||'';
      const len=_quill.getText().trim().length; const counter=document.getElementById('desc-char-count');
      if (counter) { counter.textContent=`${len}자`; counter.style.color=len>15?'#f59e0b':'#6b7280'; }
    }
    const hidHtml = document.getElementById('entry-description'); if (hidHtml) hidHtml.value=descHtml;
    try { _setKwTags('kw-query', entry.kw_query||[]); _setKwTags('kw-reason', entry.kw_reason||[]); _setLawRefs(entry.law_refs||'[]'); _updateKwExamples(); } catch(kwErr) { console.warn('kw 복원 실패:', kwErr); }
    updateClientSection();
    try {
      const attResp = await API.list('attachments', { limit: 50 });
      const existingAtts = (attResp?.data||[]).filter(a => a.entry_id===id);
      if (existingAtts.length>0) _renderExistingAttachments(existingAtts);
    } catch {}
    Toast.info('수정 모드: 내용을 수정 후 저장하세요.');
  } catch (err) { console.error('editEntry error:', err); _editEntryId=null; Toast.error('데이터 로드 실패: '+(err.message||'')); }
}

let _existingAtts = [];
function _renderExistingAttachments(atts) { _existingAtts = atts.map(a => ({...a, _deleted:false})); _redrawExistingAttachments(); }
function _redrawExistingAttachments() {
  const list = document.getElementById('fileList');
  const icons={excel:'fa-file-excel',word:'fa-file-word',ppt:'fa-file-powerpoint',pdf:'fa-file-pdf',link:'fa-link'};
  const colors={excel:'#16a34a',word:'#1d4ed8',ppt:'#c2410c',pdf:'#b91c1c',link:'#7c3aed'};
  const existingHtml = _existingAtts.map((a,idx) => {
    if (a._deleted) return '';
    const type=a.file_type||'link'; const icon=icons[type]||'fa-file'; const color=colors[type]||'#6b7280';
    return `<div id="existing-att-${idx}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px">
      <i class="fas ${icon}" style="color:${color};font-size:18px;flex-shrink:0"></i>
      <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.file_name||'이름 없음'}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px">기존 첨부파일</div></div>
      <span style="font-size:10px;background:#e0f2fe;color:#0369a1;padding:2px 7px;border-radius:10px;white-space:nowrap;margin-right:4px">저장됨</span>
      <button onclick="_deleteExistingAtt(${idx})" title="첨부파일 삭제" style="background:none;border:none;cursor:pointer;padding:4px 6px;border-radius:5px;color:#ef4444;font-size:14px">
        <i class="fas fa-times"></i></button></div>`;
  }).join('');
  const activeCount = _existingAtts.filter(a => !a._deleted).length;
  list.innerHTML = `<div style="font-size:11px;color:#6b7280;margin-bottom:6px;padding:4px 8px;background:#fef9c3;border-radius:6px;border:1px solid #fde68a">
    <i class="fas fa-info-circle" style="color:#d97706"></i> 기존 첨부파일은 유지됩니다. ✕ 버튼으로 삭제하거나 아래에서 새 파일을 추가하세요.
    ${activeCount===0?'<span style="color:#ef4444;margin-left:6px">⚠ 첨부파일이 없습니다.</span>':''}</div>${existingHtml}`;
}
async function _deleteExistingAtt(idx) {
  const att = _existingAtts[idx]; if (!att) return;
  const fileName = att.file_name||'이름 없음';
  const ok = await new Promise(resolve => {
    const old = document.getElementById('_attDelConfirm'); if (old) old.remove();
    const popup = document.createElement('div');
    popup.id = '_attDelConfirm';
    popup.style.cssText = 'position:fixed;z-index:9000;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);padding:24px 28px;min-width:300px;max-width:400px;font-family:inherit;text-align:center;border:1px solid #e5e7eb';
    popup.innerHTML = `<div style="font-size:28px;margin-bottom:8px">🗑️</div>
      <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:8px">첨부파일 삭제</div>
      <div style="font-size:13px;color:#374151;line-height:1.6;margin-bottom:20px"><strong style="color:#dc2626">${fileName}</strong>을(를)<br>삭제하시겠습니까?</div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="_attDelCancel" style="padding:8px 20px;border:1px solid #d1d5db;border-radius:8px;background:#f9fafb;color:#374151;font-size:13px;cursor:pointer">취소</button>
        <button id="_attDelOk" style="padding:8px 20px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:13px;cursor:pointer;font-weight:600">삭제</button></div>`;
    document.body.appendChild(popup);
    popup.querySelector('#_attDelCancel').onclick = () => { popup.remove(); resolve(false); };
    popup.querySelector('#_attDelOk').onclick    = () => { popup.remove(); resolve(true); };
  });
  if (!ok) return;
  _existingAtts[idx]._deleted = true;
  if (att.id && !_deletedAttIds.includes(att.id)) _deletedAttIds.push(att.id);
  _redrawExistingAttachments(); Toast.info('저장 시 삭제됩니다.');
}

async function submitSingleEntry(id) {
  try {
    await API.patch('time_entries', id, { status: 'submitted' });
    Toast.success('제출되었습니다.');
    if (typeof createNotification === 'function') {
      try {
        const session=getSession(); const entry=await API.get('time_entries', id);
        if (entry && entry.approver_id) createNotification({ toUserId:entry.approver_id, toUserName:entry.approver_name, fromUserId:session.id, fromUserName:session.name, type:'submitted', entryId:id, entrySummary:`${entry.client_name||entry.work_category_name}|${entry.work_subcategory_name||''}`, message:`${session.name}님이 타임시트 승인을 요청했습니다.`, targetMenu:'approval' });
      } catch {}
    }
    await updateApprovalBadge(getSession()); loadMyEntries();
  } catch { Toast.error('제출 실패'); }
}
async function deleteEntry(id) {
  const ok = await Confirm.delete('업무 기록'); if (!ok) return;
  try { await API.delete('time_entries', id); Toast.success('삭제되었습니다.'); loadMyEntries(); }
  catch { Toast.error('삭제 실패'); }
}
function showRejectReason(reason) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.innerHTML = `<div class="confirm-dialog"><div class="confirm-icon">💬</div><div class="confirm-title">반려 사유</div>
    <div class="confirm-desc" style="text-align:left;background:#f8fafc;border:1px solid var(--border-light);border-radius:8px;padding:12px;margin-top:8px;font-size:13px;line-height:1.6;white-space:pre-wrap">${reason}</div>
    <div class="confirm-actions"><button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">확인</button></div></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });
}

function _base64ToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/:(.*?);/)||['','application/octet-stream'])[1];
  const binary = atob(b64); const bytes = new Uint8Array(binary.length);
  for (let i=0; i<binary.length; i++) bytes[i]=binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), mime };
}

function _openFilePreview(a) {
  if (!a || !a.file_content || !a.file_content.startsWith('data:')) { Toast.error('저장된 파일 데이터가 없습니다.'); return; }
  const fileType=(a.file_type||'').toLowerCase(); const fileName=a.file_name||'파일';
  const { blob, mime } = _base64ToBlob(a.file_content); const blobUrl = URL.createObjectURL(blob);
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.75);display:flex;flex-direction:column;align-items:center;justify-content:flex-start';
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'width:100%;max-width:960px;display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:rgba(15,23,42,0.95);border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0';
  const iconClass={pdf:'fa-file-pdf',excel:'fa-file-excel',word:'fa-file-word',ppt:'fa-file-powerpoint'}[fileType]||'fa-file';
  const iconColor={pdf:'#f87171',excel:'#4ade80',word:'#60a5fa',ppt:'#fb923c'}[fileType]||'#94a3b8';
  toolbar.innerHTML=`<div style="color:#fff;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px"><i class="fas ${iconClass}" style="color:${iconColor};font-size:16px"></i><span>${fileName}</span></div>`;
  const closeBtn=document.createElement('button');
  closeBtn.style.cssText='background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px';
  closeBtn.innerHTML='<i class="fas fa-times"></i> 닫기';
  closeBtn.addEventListener('click',()=>{overlay.remove();URL.revokeObjectURL(blobUrl);});
  toolbar.appendChild(closeBtn); overlay.appendChild(toolbar);
  const content=document.createElement('div');
  content.style.cssText='flex:1;width:100%;max-width:960px;overflow:auto;background:#1e293b;position:relative';
  if (fileType==='pdf'||mime==='application/pdf') {
    const iframe=document.createElement('iframe'); iframe.src=blobUrl; iframe.style.cssText='width:100%;height:100%;border:none;min-height:calc(100vh - 60px)'; iframe.setAttribute('type','application/pdf'); content.appendChild(iframe);
  } else if (fileType==='word'||mime.includes('word')||mime.includes('officedocument.wordprocessing')) {
    _renderWordPreview(content,blob,blobUrl);
  } else if (fileType==='excel'||mime.includes('spreadsheet')||mime.includes('excel')) {
    _renderExcelPreview(content,blob,blobUrl);
  } else {
    const msg=document.createElement('div'); msg.style.cssText='display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;color:#94a3b8;gap:12px';
    msg.innerHTML=`<i class="fas fa-file-alt" style="font-size:48px;color:#475569"></i><div style="font-size:14px;font-weight:600;color:#cbd5e1">미리보기를 지원하지 않는 형식입니다.</div>`; content.appendChild(msg);
  }
  overlay.appendChild(content); document.body.appendChild(overlay);
  const escHandler=(e)=>{if(e.key==='Escape'){overlay.remove();URL.revokeObjectURL(blobUrl);document.removeEventListener('keydown',escHandler);}};
  document.addEventListener('keydown',escHandler);
}

function _renderWordPreview(container,blob,blobUrl) {
  const loading=_previewLoading(container,'Word 문서 변환 중...');
  if (typeof mammoth==='undefined') { loading.remove(); _previewError(container,'mammoth.js가 로드되지 않았습니다.'); return; }
  const reader=new FileReader();
  reader.onload=async(e)=>{
    try { const result=await mammoth.convertToHtml({arrayBuffer:e.target.result}); loading.remove();
      const wrap=document.createElement('div'); wrap.style.cssText='background:#fff;max-width:800px;margin:24px auto;padding:48px 56px;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.3);font-family:serif;font-size:14px;line-height:1.8;color:#1e293b';
      wrap.innerHTML=result.value||'<p style="color:#94a3b8">내용이 없습니다.</p>'; container.appendChild(wrap);
    } catch(err) { loading.remove(); _previewError(container,'Word 변환 실패: '+err.message); }
  };
  reader.readAsArrayBuffer(blob);
}
function _renderExcelPreview(container,blob,blobUrl) {
  const loading=_previewLoading(container,'Excel 데이터 로드 중...');
  if (typeof XLSX==='undefined') { loading.remove(); _previewError(container,'SheetJS(XLSX)가 로드되지 않았습니다.'); return; }
  const reader=new FileReader();
  reader.onload=(e)=>{
    try { const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'}); loading.remove();
      const wrap=document.createElement('div'); wrap.style.cssText='padding:16px;overflow:auto;min-height:200px';
      if (wb.SheetNames.length>1) {
        const tabs=document.createElement('div'); tabs.style.cssText='display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap';
        wb.SheetNames.forEach((name,i)=>{ const tab=document.createElement('button'); tab.textContent=name; tab.dataset.sheet=i; tab.style.cssText='padding:4px 12px;border-radius:4px;border:1px solid #475569;background:'+(i===0?'#2563eb':'#334155')+';color:#fff;cursor:pointer;font-size:12px'; tab.addEventListener('click',()=>{tabs.querySelectorAll('button').forEach(b=>b.style.background='#334155');tab.style.background='#2563eb';_renderSheetTable(tableWrap,wb,name);}); tabs.appendChild(tab); }); wrap.appendChild(tabs);
      }
      const tableWrap=document.createElement('div'); wrap.appendChild(tableWrap); _renderSheetTable(tableWrap,wb,wb.SheetNames[0]); container.appendChild(wrap);
    } catch(err) { loading.remove(); _previewError(container,'Excel 로드 실패: '+err.message); }
  };
  reader.readAsArrayBuffer(blob);
}
function _renderSheetTable(wrap,wb,sheetName) {
  const ws=wb.Sheets[sheetName]; const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
  if (!rows.length) { wrap.innerHTML='<p style="color:#94a3b8;padding:16px">데이터가 없습니다.</p>'; return; }
  const maxCols=Math.max(...rows.map(r=>r.length));
  let html=`<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:12px;color:#e2e8f0;width:100%">`;
  rows.forEach((row,ri)=>{ const isHeader=ri===0; html+=`<tr style="background:${isHeader?'#1e3a5f':ri%2===0?'#1e293b':'#263245'}">`;
    for (let ci=0;ci<maxCols;ci++) { const cell=row[ci]!==undefined?String(row[ci]):''; const tag=isHeader?'th':'td'; html+=`<${tag} style="border:1px solid #334155;padding:5px 10px;white-space:nowrap${isHeader?';font-weight:700;color:#93c5fd':''}">`+cell+`</${tag}>`; }
    html+='</tr>'; });
  html+='</table></div>'; wrap.innerHTML=html;
}
function _previewLoading(container,msg) {
  const el=document.createElement('div'); el.style.cssText='display:flex;align-items:center;justify-content:center;height:200px;color:#94a3b8;gap:10px;font-size:13px'; el.innerHTML=`<i class="fas fa-spinner fa-spin" style="font-size:20px"></i> ${msg}`; container.appendChild(el); return el;
}
function _previewError(container,msg) {
  const el=document.createElement('div'); el.style.cssText='display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:#f87171;gap:8px;font-size:13px'; el.innerHTML=`<i class="fas fa-exclamation-triangle" style="font-size:24px"></i> ${msg}`; container.appendChild(el);
}
function _doDownload(a) { _openFilePreview(a); }
function downloadBase64File(idx) { _openFilePreview(_viewerAtts[idx]); }
let _viewerAtts = [];

function openAttachmentViewer(atts,entryId,entryStatus) {
  if (!atts || atts.length===0) return; _viewerAtts=atts;
  const iconMap={excel:'fa-file-excel',word:'fa-file-word',ppt:'fa-file-powerpoint',pdf:'fa-file-pdf',link:'fa-link'};
  const colorMap={excel:'#16a34a',word:'#1d4ed8',ppt:'#c2410c',pdf:'#b91c1c',link:'#7c3aed'};
  const overlay=document.createElement('div'); overlay.className='modal-overlay show'; overlay.style.zIndex='9999';
  const modal=document.createElement('div'); modal.className='modal modal-md'; modal.style.maxWidth='560px';
  const header=document.createElement('div'); header.className='modal-header';
  header.innerHTML=`<h3><i class="fas fa-paperclip" style="color:var(--primary)"></i>&nbsp;첨부 결과물 확인 (${atts.length}건)</h3>`;
  const closeBtn=document.createElement('button'); closeBtn.className='btn-close'; closeBtn.textContent='×'; closeBtn.addEventListener('click',()=>overlay.remove()); header.appendChild(closeBtn);
  const body=document.createElement('div'); body.className='modal-body'; body.style.padding='16px';
  modal.appendChild(header); modal.appendChild(body); overlay.appendChild(modal); document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  atts.forEach((a,idx)=>{
    const icon=iconMap[a.file_type]||'fa-file'; const color=colorMap[a.file_type]||'#6b7280';
    const hasContent=a.file_content&&a.file_content.startsWith('data:'); const hasUrl=a.file_url&&a.file_url.startsWith('http');
    const item=document.createElement('div'); item.style.cssText='display:flex;align-items:flex-start;gap:12px;padding:12px 14px;background:#f8fafc;border:1px solid var(--border-light);border-radius:10px;margin-bottom:8px';
    const iconEl=document.createElement('i'); iconEl.className=`fas ${icon}`; iconEl.style.cssText=`color:${color};font-size:26px;margin-top:2px;flex-shrink:0`; item.appendChild(iconEl);
    const info=document.createElement('div'); info.style.cssText='flex:1;min-width:0';
    const nameEl=document.createElement('div'); nameEl.style.cssText='font-weight:600;font-size:13px;word-break:break-all'; nameEl.textContent=a.file_name||'파일명 없음'; info.appendChild(nameEl);
    const actionWrap=document.createElement('div'); actionWrap.style.cssText='margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center';
    if (hasContent) { const btn=document.createElement('button'); btn.className='btn btn-sm btn-primary'; btn.style.whiteSpace='nowrap'; btn.innerHTML='<i class="fas fa-eye"></i> 열어보기'; btn.addEventListener('click',()=>_openFilePreview(a)); actionWrap.appendChild(btn); }
    else if (hasUrl) { const link=document.createElement('a'); link.href=a.file_url; link.target='_blank'; link.className='btn btn-sm btn-outline'; link.style.cssText='white-space:nowrap;display:inline-block'; link.innerHTML='<i class="fas fa-external-link-alt"></i> 링크 열기'; actionWrap.appendChild(link); }
    info.appendChild(actionWrap); item.appendChild(info); body.appendChild(item);
  });
  const footer=document.createElement('div'); footer.style.cssText='padding:12px 16px 16px;border-top:1px solid var(--border-light)';
  const closeOnlyBtn=document.createElement('button'); closeOnlyBtn.className='btn btn-outline'; closeOnlyBtn.style.cssText='float:right'; closeOnlyBtn.innerHTML='<i class="fas fa-times"></i> 닫기'; closeOnlyBtn.addEventListener('click',()=>overlay.remove()); footer.appendChild(closeOnlyBtn);
  modal.appendChild(footer);
}

async function openAttachmentViewerById(entryId,entryStatus) {
  try { const r=await API.list('attachments',{limit:500}); const atts=(r&&r.data)?r.data.filter(a=>a.entry_id===entryId):[];
    if (!atts.length) { Toast.info('첨부 파일이 없습니다.'); return; }
    openAttachmentViewer(atts,entryId,entryStatus);
  } catch(err) { Toast.error('첨부파일 조회 실패: '+err.message); }
}

function _openExtractedTextModal(attachment) {
  const overlay=document.createElement('div'); overlay.className='modal-overlay show'; overlay.style.zIndex='10000';
  const modal=document.createElement('div'); modal.className='modal modal-lg'; modal.style.cssText='max-width:680px;border-radius:14px;overflow:hidden';
  const header=document.createElement('div'); header.className='modal-header'; header.style.cssText='background:#faf5ff;padding:14px 20px;border-bottom:1px solid #e9d5ff;display:flex;align-items:center;justify-content:space-between';
  header.innerHTML=`<div style="display:flex;align-items:center;gap:8px"><i class="fas fa-shield-alt" style="color:#7c3aed;font-size:14px"></i><span style="font-size:14px;font-weight:700;color:#4c1d95">추출 텍스트 확인</span><span style="background:#ede9fe;color:#6d28d9;border-radius:5px;padding:2px 8px;font-size:11px;font-weight:600">민감정보 마스킹 완료</span></div>`;
  const closeBtn=document.createElement('button'); closeBtn.className='btn-close'; closeBtn.textContent='×'; closeBtn.addEventListener('click',()=>overlay.remove()); header.appendChild(closeBtn);
  const body=document.createElement('div'); body.className='modal-body'; body.style.cssText='padding:16px 20px;max-height:60vh;overflow-y:auto';
  const textBox=document.createElement('pre'); textBox.style.cssText='background:#f8fafc;border:1px solid var(--border-light);border-radius:8px;padding:14px 16px;font-size:12px;line-height:1.8;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow-y:auto;font-family:inherit';
  textBox.textContent=attachment.extracted_text; body.appendChild(textBox);
  const footer=document.createElement('div'); footer.className='modal-footer'; footer.style.cssText='padding:12px 20px;background:#faf5ff;border-top:1px solid #e9d5ff;display:flex;justify-content:flex-end';
  const closeFooterBtn=document.createElement('button'); closeFooterBtn.className='btn btn-outline'; closeFooterBtn.innerHTML='<i class="fas fa-times"></i> 닫기'; closeFooterBtn.addEventListener('click',()=>overlay.remove()); footer.appendChild(closeFooterBtn);
  modal.appendChild(header); modal.appendChild(body); modal.appendChild(footer); overlay.appendChild(modal); document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
}

async function exportEntriesToExcel() {
  const btn = document.querySelector('[onclick="exportEntriesToExcel()"]');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> 로딩 중...'; }
  try {
    if (typeof XLSX==='undefined') { if (typeof LibLoader!=='undefined') await LibLoader.load('xlsx'); }
  } catch (loadErr) { Toast.error('엑셀 라이브러리 로드 실패'); if (btn) { btn.disabled=false; btn.innerHTML=origHtml; } return; }
  if (typeof XLSX==='undefined') { Toast.error('엑셀 라이브러리를 불러올 수 없습니다.'); if (btn) { btn.disabled=false; btn.innerHTML=origHtml; } return; }
  if (btn) btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> 생성 중...';
  try {
    const session=getSession();
    const r=await API.list('time_entries',{limit:500});
    let entries=(r&&r.data)?r.data:(Array.isArray(r)?r:[]);
    if (session.role==='staff') entries=entries.filter(e=>String(e.user_id)===String(session.id));
    if (!entries.length) { Toast.info('내보낼 데이터가 없습니다.'); return; }
    const statusLabel={draft:'임시저장',submitted:'검토중',approved:'승인',rejected:'반려'};
    const toDateOnly=(ms)=>{ if(!ms) return ''; try { const d=new Date(Number(ms)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; } catch{return '';} };
    const toTimeOnly=(ms)=>{ if(!ms) return ''; try { const d=new Date(Number(ms)); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; } catch{return '';} };
    const rows=entries.map((e,i)=>({
      'No':i+1, '작성일자':toDateOnly(e.created_at||e.work_start_at), 'Staff':e.user_name||'', '업무팀':e.team_name||'',
      '고객사':e.client_name||'내부업무', '대분류':e.work_category_name||'', '소분류':e.work_subcategory_name||'',
      '시작일자':toDateOnly(e.work_start_at), '시작시간':toTimeOnly(e.work_start_at),
      '종료일자':toDateOnly(e.work_end_at), '종료시간':toTimeOnly(e.work_end_at),
      '업무시간':Utils.formatDuration(e.duration_minutes),
      '수행내용':(e.work_description||'').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim(),
      '상태':statusLabel[e.status]||e.status||''
    }));
    const wb=XLSX.utils.book_new(); const ws=XLSX.utils.json_to_sheet(rows);
    ws['!cols']=[{wch:5},{wch:12},{wch:10},{wch:14},{wch:16},{wch:16},{wch:20},{wch:12},{wch:8},{wch:12},{wch:8},{wch:8},{wch:40},{wch:8}];
    XLSX.utils.book_append_sheet(wb,ws,'타임시트');
    const wbArray=XLSX.write(wb,{bookType:'xlsx',type:'array'});
    const blob=new Blob([wbArray],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob); const today=new Date().toISOString().slice(0,10).replace(/-/g,'');
    const fname=`타임시트_${today}.xlsx`;
    const anchor=document.createElement('a'); anchor.href=url; anchor.download=fname; anchor.style.display='none';
    document.body.appendChild(anchor); anchor.click(); document.body.removeChild(anchor);
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    Toast.success(`엑셀 저장 완료 (${entries.length}건)`);
  } catch(err) { console.error('exportEntriesToExcel error:',err); Toast.error('내보내기 실패: '+(err.message||String(err))); }
  finally { if (btn) { btn.disabled=false; btn.innerHTML=origHtml; } }
}

