/* ============================================
   entry.js — 타임시트 등록 / 나의 타임시트
   ============================================ */

/**
 * 업무기록 상세보기 모달용 — work_description 내 table 스타일 주입
 * (Quill/HTML 표가 모달에서 테두리 없이 보이는 문제 해결)
 */
/**
 * 업무기록 에디터 붙여넣기 HTML 정리:
 * - Word/HWP mso-* 스타일 제거
 * - colspan/rowspan 등 표 구조 속성 보존
 * - 인라인 테이블 스타일 보강
 */
function _injectDescTableStyle(html) {
  if (!html) return html;
  try {
    // 조건부 주석은 “껍데기”만 제거하고 내부 HTML은 보존 (엑셀 표가 안에 들어있는 경우가 있음)
    if (typeof html === 'string') {
      html = html.replace(/<!--\[if[^\]]*\]>([\s\S]*?)<!\[endif\]-->/gi, (_, inner) => inner || '');
    }

    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    // Word/HWP 전용 태그 제거 (내용물 보존)
    tmp.querySelectorAll('o\\:p, w\\:sdt, w\\:sdtContent').forEach(el => {
      el.replaceWith(...Array.from(el.childNodes));
    });

    // mso-* 스타일만 제거, colspan/rowspan/width 등 구조 속성은 보존
    tmp.querySelectorAll('*').forEach(el => {
      const st = el.getAttribute('style') || '';
      if (st) {
        const cleaned = st.split(';')
          .map(s => s.trim())
          .filter(s => s && !s.startsWith('mso-') && !s.startsWith('-mso'))
          .join('; ');
        if (cleaned) el.setAttribute('style', cleaned);
        else el.removeAttribute('style');
      }
      el.removeAttribute('class');
    });

    // 표 인라인 스타일 보강
    tmp.querySelectorAll('table').forEach(t => {
      t.style.borderCollapse = 'collapse';
      t.style.maxWidth       = '100%';
      // 엑셀 표는 width/height/colgroup 정보에 의존하는 경우가 많아 강제 제거하면 깨질 수 있음 → 보존
    });
    tmp.querySelectorAll('th').forEach(el => {
      el.style.border        = '1px solid #cbd5e1';
      el.style.padding       = '4px 8px';
      el.style.background    = '#f1f5f9';
      el.style.fontWeight    = '700';
      el.style.textAlign     = 'center';
      el.style.verticalAlign = 'top';
      el.style.whiteSpace    = 'normal';
      el.style.lineHeight    = '1.5';
      el.style.wordBreak     = 'break-word';
    });
    tmp.querySelectorAll('td').forEach(el => {
      el.style.border        = '1px solid #cbd5e1';
      el.style.padding       = '4px 8px';
      el.style.verticalAlign = 'top';
      el.style.whiteSpace    = 'normal';
      el.style.lineHeight    = '1.5';
      el.style.wordBreak     = 'break-word';
    });
    if (typeof window._archTightenTableCellMarkup === 'function') {
      window._archTightenTableCellMarkup(tmp);
    }
    return tmp.innerHTML;
  } catch(e) {
    return html; // 파싱 실패 시 원본 반환
  }
}

function _entryTsvToTableHtml(tsv) {
  const text = String(tsv || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = text.split('\n').filter(r => r.length > 0);
  if (rows.length < 2) return '';
  const cells = rows.map(r => r.split('\t'));
  const colCount = Math.max(...cells.map(r => r.length));
  if (colCount < 2) return '';

  const htmlRows = cells.map(r => {
    const tds = [];
    for (let i = 0; i < colCount; i++) {
      const v = (r[i] == null ? '' : String(r[i]));
      tds.push(`<td>${Utils.escHtml(v)}</td>`);
    }
    return `<tr>${tds.join('')}</tr>`;
  }).join('');

  return `<table><tbody>${htmlRows}</tbody></table>`;
}

async function _entryTryClipboardTsvFallback() {
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) return '';
    const t = await navigator.clipboard.readText();
    return (t && t.includes('\t') && t.includes('\n')) ? t : '';
  } catch {
    return '';
  }
}

function openEntryTablePasteHelper() {
  const ta = document.getElementById('entryTablePasteText');
  if (ta) ta.value = '';
  openModal('entryTablePasteModal');
  setTimeout(() => { if (ta) ta.focus(); }, 50);
}

function applyEntryTablePasteHelper() {
  const ta = document.getElementById('entryTablePasteText');
  const raw = (ta?.value || '').trim();
  if (!raw) { Toast.warning('붙여넣은 내용이 없습니다.'); return; }

  let html = '';
  if (/<table[\s>]/i.test(raw)) {
    html = raw;
  } else if (raw.includes('\t') && raw.includes('\n')) {
    html = _entryTsvToTableHtml(raw);
  }
  if (!html) { Toast.warning('표로 변환할 수 없습니다. (TSV 또는 <table> HTML만 지원)'); return; }

  const cleanHtml = _injectDescTableStyle(html);
  const editor = _quill?.root;
  if (!editor) { Toast.error('에디터가 초기화되지 않았습니다.'); return; }

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = cleanHtml;
  const nodes = Array.from(tempDiv.childNodes).filter(n => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent.trim() !== '';
    if (n.nodeType === Node.ELEMENT_NODE) {
      if (['P','DIV','SPAN'].includes(n.tagName) && n.innerText?.trim() === '' && !n.querySelector('table')) return false;
    }
    return true;
  });

  const existingText = editor.innerText.trim();
  if (!existingText) editor.innerHTML = '';
  nodes.forEach(n => editor.appendChild(n.cloneNode(true)));

  closeModal('entryTablePasteModal');
  setTimeout(() => { editor.focus(); }, 50);
}

let _allCategories    = [];
let _allSubcategories = [];
let _currentCategoryType = ''; // 초기: 미선택 상태
let _pendingFiles     = [];
/*
  _pendingFiles 항목 구조:
  {
    file      : File | null,       // 드래그&드롭 원본 파일 객체 (URL 등록 시 null)
    type      : string,            // excel | word | ppt | pdf | link
    docType   : string,            // 보고서 | 회의록 | 의견서 | 검토의견서 | 기타
    summary   : string,
    fileUrl   : string,            // 외부 URL (URL 등록 방식)
    fileName  : string,            // URL 등록 시 사용자가 입력한 이름
    content      : string | null,     // Base64 data-URL (드래그&드롭 파일 → 변환 후)
    sizeKB       : number,
    uploadMode   : 'base64' | 'url',  // 저장 방식 구분
    extractedText: string | null,     // 추출+마스킹된 텍스트 (extracted_text 컬럼에 저장)
    extractStatus: string,            // 'ok' | 'scan_pdf' | 'ppt' | 'error' | 'unsupported' | ''
  }
*/

let _editEntryId    = null;
let _editMode       = false;   // ★ 수정 모드 플래그 (navigateTo 자동 init 차단용)
let _deletedAttIds  = [];      // ★ 수정 모드에서 삭제 예정인 기존 첨부파일 ID 목록
let _entriesPage  = 1;
const ENTRIES_PER_PAGE = 20;
let _entryRecordViewMode = 'all'; // all | consultant
let _entrySheetMode = 'normal'; // normal | batch
let _entryLastFilteredEntries = [];
let _entryStaffFilterUsers = [];
let _entryStaffUserById = {};
let _entryStaffFilterSelectedId = '';
let _entryStaffSuggestBound = false;
let _entryOrgFilterRows = [];
let _entryOrgFilterLock = 'none'; // none | dept | hq | team
let _entryOrgFilterFixed = { dept: '', hq: '', team: '' };
let _entryStaffInputTimer = null;
let _entryLoadRequestSeq = 0;

// ─────────────────────────────────────────────
// 문서번호(IDYYMMDD####) 생성
// - 하루 단위, 전체 사용자 공통
// - 동시 저장 충돌은 DB UNIQUE(doc_no) + 재시도로 해결
// ─────────────────────────────────────────────
function _entryDocNoPrefixFromMs(ms) {
  const baseMs = Number(ms) || Date.now();
  // 날짜 경계(자정)에서 타임존 차이로 일자가 하루 밀리는 이슈 방지:
  // 문서번호는 항상 KST(Asia/Seoul) 기준으로 발번한다.
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(new Date(baseMs));
    const get = (t) => (parts.find(p => p.type === t)?.value || '');
    const yy = get('year');
    const mm = get('month');
    const dd = get('day');
    if (yy && mm && dd) return `ID${yy}${mm}${dd}`;
  } catch {}
  // fallback: 로컬 타임존
  const d = new Date(baseMs);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `ID${yy}${mm}${dd}`;
}

async function _entryFetchMaxDocNo(prefix) {
  const pfx = String(prefix || '').trim();
  if (!pfx) return '';
  try {
    // PostgREST like: %는 URL 인코딩 필요
    const like = encodeURIComponent(pfx + '%');
    const url = `${window.SmartLogSupabase?.url || ''}/rest/v1/time_entries?select=doc_no&doc_no=like.${like}&order=doc_no.desc&limit=1`;
    const res = await fetch(url, { headers: API._headers() });
    if (!res.ok) return '';
    const rows = await res.json().catch(() => []);
    const v = rows && rows[0] && rows[0].doc_no ? String(rows[0].doc_no) : '';
    return v;
  } catch {
    return '';
  }
}

function _entryNextDocNo(prefix, maxDocNo) {
  const pfx = String(prefix || '');
  const cur = String(maxDocNo || '');
  let next = 1;
  if (cur.startsWith(pfx)) {
    const tail = cur.slice(pfx.length);
    const n = parseInt(tail, 10);
    if (!isNaN(n) && n >= 0) next = n + 1;
  }
  return pfx + String(next).padStart(4, '0');
}

async function _entryEnsureDocNoForSave(workStartMs, doSaveOnce, maxRetry = 8) {
  const prefix = _entryDocNoPrefixFromMs(workStartMs);
  let lastErr = null;
  for (let i = 0; i < maxRetry; i++) {
    const maxNo = await _entryFetchMaxDocNo(prefix);
    const docNo = _entryNextDocNo(prefix, maxNo);
    try {
      return await doSaveOnce(docNo);
    } catch (e) {
      const msg = String(e?.message || e || '');
      lastErr = e;
      // UNIQUE 충돌(동시 저장)만 재시도
      if (/duplicate|unique/i.test(msg)) continue;
      throw e;
    }
  }
  throw lastErr || new Error('문서번호 생성 재시도 초과');
}

// ─── Quill 2.x 리치텍스트 에디터 ────────────────────────
let _quill = null;  // Quill 인스턴스
let _turndown = null; // TurndownService 인스턴스
let _entryUseRich = false; // true면 entry-rich-editor 사용(표 포함)

// Word/Outlook 메일 붙여넣기 시 눌러붙는 MSO 헤더/메타(영문 덩어리) 제거 — 표 유무와 관계없이 항상 통과
// DB에 HTML로 들어간 예전 데이터도 메모(textarea)에 넣을 수 있게 평문화
function _entryWorkDescToMemoPlain(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (!/<[a-z][\s\S]*>/i.test(s)) return s;
  try {
    const doc = new DOMParser().parseFromString(`<div>${s}</div>`, 'text/html');
    return (doc.body.textContent || '').replace(/\u00a0/g, ' ').trim();
  } catch {
    return s;
  }
}

function _entryCleanDescHtmlForEdit(html) {
  let s = String(html || '').trim();
  if (!s) return '';
  // 1) 원문 문자열에서 연속된 Word/IE 메타 블록 제거(노드 분할돼도 잡히도록)
  try {
    s = s.replace(/\bNormal\s+0\s+0\s+\d+[\s\S]{0,400}?MicrosoftInternetExplorer4\b/gi, '');
    s = s.replace(/MicrosoftInternetExplorer4/gi, '');
    s = s.replace(/\bX-NONE\b/gi, '');
  } catch {}
  try {
    if (typeof window._cleanPasteHtml === 'function') s = window._cleanPasteHtml(s);
  } catch {}
  try {
    const doc = new DOMParser().parseFromString(`<div id="__entry_root__">${s}</div>`, 'text/html');
    const root = doc.getElementById('__entry_root__');
    if (!root) return s;
    root.querySelectorAll('style,script,xml,meta,link').forEach(el => { try { el.remove(); } catch {} });
    // Word 전용 태그(o:p, w:*) 제거
    root.querySelectorAll('o\\:p, w\\:sdt, w\\:sdtContent').forEach(el => { try { el.remove(); } catch {} });
    const killLine = (t) => {
      const x = String(t || '').trim();
      if (!x) return false;
      if (/MicrosoftInternetExplorer4/i.test(x)) return true;
      if (/^Normal\s+0\s+0\s+\d+/i.test(x) && /false\s+false\s+false/i.test(x)) return true;
      if (/^Normal\s+0\s+0\s+\d+/i.test(x) && /\bEN-US\b/i.test(x)) return true;
      return false;
    };
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const toRemove = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const t = String(n?.nodeValue || '');
      if (killLine(t)) toRemove.push(n);
    }
    toRemove.forEach(n => { try { n.remove(); } catch {} });
    // 빈 p/div 정리
    root.querySelectorAll('p,div').forEach(el => {
      if (!el.querySelector('table,img,br') && !(el.textContent || '').trim()) try { el.remove(); } catch {}
    });
    return root.innerHTML;
  } catch {
    return s;
  }
}

/** DB/저장 HTML에 표가 포함되어 있는지 (수정 로드 시 Quill 대신 contenteditable 사용) */
function _entryDescHtmlHasTable(html) {
  return /<table[\s>]/i.test(String(html || ''));
}

function _entryCleanPastePlainText(text) {
  let t = String(text || '');
  t = t.replace(/\bNormal\s+0\s+0\s+\d+[\s\S]{0,400}?MicrosoftInternetExplorer4\b/gi, '');
  t = t.replace(/MicrosoftInternetExplorer4/gi, '');
  t = t.replace(/\bX-NONE\b/gi, '');
  return t.replace(/^\s*\n+/, '').trim();
}

/** Quill 2.x + Turndown 초기화 (최초 1회) */
function _initQuill() {
  if (_quill) return; // 이미 초기화됨

  // ── contenteditable(표 모드) paste 이벤트 ─────────────────
  const richEl = document.getElementById('entry-rich-editor');
  if (richEl && !richEl._pasteReady) {
    richEl._pasteReady = true;
    richEl.addEventListener('paste', function(e) {
      e.preventDefault();
      const cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      const htmlData = cd.getData('text/html');
      const textData = cd.getData('text/plain');
      let toInsert = '';
      if (htmlData) {
        toInsert = _entryCleanDescHtmlForEdit(htmlData);
        toInsert = _injectDescTableStyle(toInsert);
      } else {
        toInsert = textData || '';
      }
      document.execCommand('insertHTML', false, toInsert);
      setTimeout(() => { _syncQuillToHidden(); }, 0);
    });
    richEl.addEventListener('input', function() {
      if (!_entryUseRich) return;
      const len = (richEl.innerText || '').trim().length;
      const counter = document.getElementById('desc-char-count');
      if (counter) {
        counter.textContent = `${len}자`;
        counter.style.color = len > 15 ? '#f59e0b' : '#6b7280';
      }
    });
  }

  // ── Quill 2.x: 엑셀 HTML 테이블 붙여넣기 보존 ──────────
  // clipboard 모듈에서 HTML을 그대로 삽입하는 커스텀 핸들러
  const clipboardOptions = {
    // Quill 2.x: matchers로 table 노드를 raw HTML로 보존
    matchers: [
      ['table', function(node, delta) {
        // table 전체를 raw HTML 블록으로 변환
        const html = node.outerHTML;
        // Delta에 raw HTML insert로 추가 (Quill 2.x 지원)
        const Delta = Quill.import('delta');
        return new Delta().insert(html);
      }]
    ]
  };

  // Quill 2.x 에디터 생성
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
      clipboard: {
        // Quill 2.x: HTML 붙여넣기 시 table 태그 포함 whitelist
        matchVisual: false
      }
    }
  });

  // ── 엑셀/Word 표 붙여넣기 처리 (capture phase) ──────
  // ★ Quill dangerouslyPasteHTML은 colspan/rowspan 등 복잡한 표 구조를 Delta 변환 시 파괴함.
  //   표가 포함된 경우 .ql-editor DOM에 직접 주입하여 표 구조 100% 보존.
  let _quillPasteLock = false; // 중복 삽입 방지 플래그
  _quill.root.addEventListener('paste', function(e) {
    if (_quillPasteLock) return; // 재진입 방지

    const cd = e.clipboardData || window.clipboardData;
    const htmlData = cd ? cd.getData('text/html') : '';
    const textData = cd ? cd.getData('text/plain') : '';

    // HTML 없이 plain만 오는 Outlook 등: Word 헤더가 텍스트 한 줄로 붙는 경우
    if (!htmlData && textData && /MicrosoftInternetExplorer4|Normal\s+0\s+0\s+\d+/i.test(textData)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      _quillPasteLock = true;
      const cleaned = _entryCleanPastePlainText(textData);
      try {
        const sel = _quill.getSelection(true) || { index: _quill.getLength(), length: 0 };
        if (cleaned) _quill.insertText(sel.index, cleaned, 'user');
      } catch {}
      setTimeout(() => {
        _quillPasteLock = false;
        _syncQuillToHidden();
      }, 0);
      return;
    }

    // HTML 붙여넣기: 표 유무와 관계없이 항상 MSO/Word 잔여물 제거 후 삽입 (Quill 기본 paste는 Word 헤더를 그대로 삼음)
    if (htmlData && !/<table[\s>]/i.test(htmlData)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      _quillPasteLock = true;
      const cleaned = _entryCleanDescHtmlForEdit(htmlData);
      try {
        const sel = _quill.getSelection(true) || { index: _quill.getLength(), length: 0 };
        _quill.clipboard.dangerouslyPasteHTML(sel.index, cleaned, 'user');
      } catch {
        try { document.execCommand('insertHTML', false, cleaned); } catch {}
      }
      setTimeout(() => {
        _quillPasteLock = false;
        _syncQuillToHidden();
      }, 0);
      return;
    }

    if (htmlData && /<table[\s>]/i.test(htmlData)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation(); // Quill 내부 리스너도 차단

      _quillPasteLock = true;
      const sel = _quill.getSelection(true) || { index: _quill.getLength(), length: 0 };

      // 표 + 본문 앞단 Word 헤더 동시 제거 후 표 모드
      const cleanedMail = _entryCleanDescHtmlForEdit(htmlData);
      const cleanHtml = _injectDescTableStyle(cleanedMail);
      _entrySwitchToRichInsertAtCursor(cleanHtml, sel.index);

      // hidden input 동기화 + 글자수 업데이트
      setTimeout(() => {
        _quillPasteLock = false;
        _syncQuillToHidden();
        const len = _entryGetEditorText().length;
        const counter = document.getElementById('desc-char-count');
        if (counter) {
          counter.textContent = `${len}자`;
          counter.style.color = len > 15 ? '#f59e0b' : '#6b7280';
        }
      }, 150);
      return;
    }

    // HTML 테이블이 안 들어오는 환경(엑셀/브라우저 조합) 대비: TSV(탭/줄바꿈)면 표로 변환해 삽입
    if (textData && textData.includes('\t') && textData.includes('\n')) {
      const tableHtml = _entryTsvToTableHtml(textData);
      if (tableHtml) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        _quillPasteLock = true;
        const sel = _quill.getSelection(true) || { index: _quill.getLength(), length: 0 };

        const cleanHtml = _injectDescTableStyle(tableHtml);
        _entrySwitchToRichInsertAtCursor(cleanHtml, sel.index);

        setTimeout(() => {
          _quillPasteLock = false;
          _syncQuillToHidden();
          const len = _entryGetEditorText().length;
          const counter = document.getElementById('desc-char-count');
          if (counter) {
            counter.textContent = `${len}자`;
            counter.style.color = len > 15 ? '#f59e0b' : '#6b7280';
          }
        }, 150);
        return;
      }
    }

    // 마지막 우회: clipboardData가 비어있거나 TSV가 누락되는 환경에서는 navigator.clipboard로 다시 시도
    setTimeout(async () => {
      if (_quillPasteLock) return;
      const tsv = await _entryTryClipboardTsvFallback();
      const tableHtml = tsv ? _entryTsvToTableHtml(tsv) : '';
      if (!tableHtml) return;

      _quillPasteLock = true;
      const sel = _quill.getSelection(true) || { index: _quill.getLength(), length: 0 };
      const cleanHtml = _injectDescTableStyle(tableHtml);
      _entrySwitchToRichInsertAtCursor(cleanHtml, sel.index);

      setTimeout(() => {
        _quillPasteLock = false;
        _syncQuillToHidden();
        const len = _entryGetEditorText().length;
        const counter = document.getElementById('desc-char-count');
        if (counter) {
          counter.textContent = `${len}자`;
          counter.style.color = len > 15 ? '#f59e0b' : '#6b7280';
        }
      }, 150);
    }, 0);
  }, true); // capture phase — Quill 내부 리스너보다 먼저 실행

  // 글자수 카운트 업데이트
  _quill.on('text-change', () => {
    const len = _quill.getText().trim().length;
    const counter = document.getElementById('desc-char-count');
    if (counter) {
      counter.textContent = `${len}자`;
      counter.style.color = len > 15 ? '#f59e0b' : '#6b7280';
    }
  });

  // ── Turndown 초기화 (GFM 플러그인 포함) ────────────────
  _turndown = new TurndownService({
    headingStyle:     'atx',
    bulletListMarker: '-'
  });
  // GFM 플러그인 적용 (테이블 변환 핵심)
  const gfm = turndownPluginGfm.gfm;
  _turndown.use(gfm);
}

/** Quill 내용 초기화 */
function _resetQuill() {
  if (!_quill) return;
  _quill.setText('');
  const counter = document.getElementById('desc-char-count');
  if (counter) { counter.textContent = '0자'; counter.style.color = '#6b7280'; }
}

function _entryGetEditorHtml() {
  if (_entryUseRich) {
    const el = document.getElementById('entry-rich-editor');
    return el ? el.innerHTML.trim() : '';
  }
  return _quill ? _quill.root.innerHTML : '';
}

function _entryGetEditorText() {
  if (_entryUseRich) {
    const el = document.getElementById('entry-rich-editor');
    return el ? el.innerText.trim() : '';
  }
  return _quill ? _quill.getText().trim() : '';
}

function _setEntryPasteGuideText(isEditMode) {
  const guide = document.getElementById('entry-paste-guide-text');
  if (!guide) return;
  if (isEditMode) {
    guide.innerHTML = '대용량 표 문서는 마우스 커서가 지연될 수 있습니다.<br>키보드 방향키/검색으로 위치 이동 후 수정하세요.';
    return;
  }
  guide.innerHTML = '고객 질의내용과 답변내용이 포함된 메일 본문 또는 의견서를 <strong>그대로 붙여넣기(Ctrl+C, Ctrl+V)</strong> 하세요';
}

function _entrySwitchToRich(html) {
  _entryUseRich = true;
  const quillWrap = document.getElementById('quill-editor');
  const richEl = document.getElementById('entry-rich-editor');
  const badge = document.getElementById('entry-editor-mode-badge');
  if (quillWrap) quillWrap.style.display = 'none';
  if (richEl) {
    richEl.style.display = 'block';
    if (html !== undefined) richEl.innerHTML = html;
  }
  if (badge) badge.style.display = 'flex';
}

function _entrySetCaretByTextOffset(root, offset) {
  if (!root) return false;
  const safeOffset = Math.max(0, Number(offset || 0));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  let acc = 0;
  while (node) {
    const len = (node.nodeValue || '').length;
    if (safeOffset <= acc + len) {
      const pos = Math.max(0, Math.min(len, safeOffset - acc));
      const range = document.createRange();
      range.setStart(node, pos);
      range.collapse(true);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return true;
    }
    acc += len;
    node = walker.nextNode();
  }
  return false;
}

function _entrySwitchToRichInsertAtCursor(insertHtml, quillIndex) {
  const quillWrap = document.getElementById('quill-editor');
  const richEl = document.getElementById('entry-rich-editor');
  const badge = document.getElementById('entry-editor-mode-badge');
  const baseHtml = _entryCleanDescHtmlForEdit((_quill && _quill.root && _quill.root.innerHTML) || '');

  _entryUseRich = true;
  if (quillWrap) quillWrap.style.display = 'none';
  if (badge) badge.style.display = 'flex';
  if (!richEl) return;

  richEl.style.display = 'block';
  richEl.innerHTML = baseHtml || '<p><br></p>';
  richEl.focus();

  const placed = _entrySetCaretByTextOffset(richEl, quillIndex);
  if (!placed) {
    try {
      const range = document.createRange();
      range.selectNodeContents(richEl);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {}
  }

  try {
    document.execCommand('insertHTML', false, insertHtml || '');
  } catch {
    richEl.innerHTML = (richEl.innerHTML || '') + (insertHtml || '');
  }
}

function entrySwitchToQuill() {
  _entryUseRich = false;
  const quillWrap = document.getElementById('quill-editor');
  const richEl = document.getElementById('entry-rich-editor');
  const badge = document.getElementById('entry-editor-mode-badge');
  if (quillWrap) quillWrap.style.display = 'flex';
  if (richEl) { richEl.style.display = 'none'; richEl.innerHTML = ''; }
  if (badge) badge.style.display = 'none';
  _resetQuill();
  _syncQuillToHidden();
}

/** Quill → hidden inputs 동기화 (저장 직전 호출) */
function _syncQuillToHidden() {
  if (!_quill) return;
  const html = _entryGetEditorHtml();
  // 빈 에디터 체크
  const isEmpty = html === '<p><br></p>' || html.trim() === '' || html.trim() === '<p></p>';
  // 수정 로드/붙여넣기 과정에서 Word 헤더 텍스트가 섞여 들어오는 경우가 있어 저장 전 1회 정리
  const finalHtml = isEmpty ? '' : _entryCleanDescHtmlForEdit(html);

  const hidHtml = document.getElementById('entry-description');
  const hidMd   = document.getElementById('entry-description-md');
  if (hidHtml) hidHtml.value = finalHtml;
  if (hidMd && _turndown && finalHtml) {
    try { hidMd.value = _turndown.turndown(finalHtml); }
    catch(err) {
      console.warn('[Quill] turndown 변환 실패:', err);
      hidMd.value = _entryGetEditorText();
    }
  } else if (hidMd) { hidMd.value = ''; }
}

// ─── 파일 크기 제한 ────────────────────────────────────
const FILE_MAX_BYTES       = 10 * 1024 * 1024; // 10 MB
const FILE_WARN_BYTES      = 7 * 1024 * 1024;  // 7 MB 초과 시 경고

// ─── 수행내용 글자수 카운터 (Quill 기반으로 대체 — fallback 용도 유지) ────────────────
function updateDescCount(el) {
  // Quill 사용 시 이 함수는 호출되지 않음
  const len = (el ? el.value || '' : '').length;
  const counter = document.getElementById('desc-char-count');
  if (counter) {
    counter.textContent = `${len}자`;
    counter.style.color = len > 15 ? '#f59e0b' : '#6b7280';
  }
}

// ─────────────────────────────────────────────
// 시트 유형 (시간제 / 일일) — sessionStorage + DB sheet_type
// ─────────────────────────────────────────────
function entryFormSheetType() {
  try {
    return sessionStorage.getItem('entry_sheet_type') === 'daily' ? 'daily' : 'hourly';
  } catch (_) {}
  return 'hourly';
}

function myEntriesSheetFilter(session) {
  if (session && (Auth.canViewAll(session) || Auth.isTopMgr(session))) return null;
  try {
    const v = sessionStorage.getItem('my_entries_sheet_type');
    if (v === 'daily' || v === 'hourly') return v;
  } catch (_) {}
  return 'hourly';
}

function _rowSheetType(e) {
  return e && e.sheet_type === 'daily' ? 'daily' : 'hourly';
}

/** 일일 시트 대분류 (통관 제외) */
const ENTRY_DAILY_CATEGORY_ALLOW = ['프로젝트업무', '일반자문업무', '회사내부업무'];
let _dailyOpenProjectRows = [];
let _dailyOpenProjectListFiltered = [];
let _entryProjectPickerFiltered = [];
const _ENTRY_DAILY_PROJECT_MIN_QUERY = 2;
let _entryBatchRows = [];
let _entryBatchAutosaveTimer = null;
let _entryBatchHydrating = false;
let _entryBatchClientRows = [];
let _entryBatchSelectedRowIdx = -1;
let _entryBatchTimelineDate = '';
let _entryBatchTimelineDrag = null;
let _entryBatchTimelinePreview = null; // { rowId, fromAt, toAt } — 입력 중 미리보기
let _entryBatchExpandedRowIds = new Set(); // 명시적으로 펼친 행 rowId 목록
let _entryBatchProjectRowsLoading = false;
const ENTRY_BATCH_LOCAL_KEY = 'entry_batch_rows_v1';
const ENTRY_BATCH_SERVER_DRAFT_KEY_PREFIX = 'entry_batch_server_draft_id';

function _entrySyncDailyProjectShowAllBtn() {
  const btn = document.getElementById('entry-daily-proj-toggle-all-btn');
  if (!btn) return;
  btn.classList.remove('is-on');
  btn.innerHTML = '<i class="fas fa-list-ul"></i><span>프로젝트 목록 전체 보기</span>';
  btn.title = '전체 프로젝트 목록을 새 창에서 확인합니다.';
}

function _entryApplyDailyProjectPick(r) {
  if (!r) return;
  const cEl = document.getElementById('entry-daily-project-code');
  const nEl = document.getElementById('entry-daily-project-name');
  const ciEl = document.getElementById('entry-daily-project-client-id');
  const cnEl = document.getElementById('entry-daily-project-client-name');
  if (cEl) cEl.value = String(r.project_code || '').trim();
  if (nEl) nEl.value = String(r.project_name || '').trim();
  if (ciEl) ciEl.value = String(r.client_id || '').trim();
  if (cnEl) cnEl.value = String(r.client_name || '').trim();
  const selBox = document.getElementById('entry-daily-project-selected');
  const selTxt = document.getElementById('entry-daily-project-selected-text');
  if (selBox) selBox.style.display = '';
  if (selTxt) selTxt.textContent = `${r.project_code || ''} — ${r.project_name || ''}`;
}

function entryDailyCategoryName() {
  const catEl = document.getElementById('entry-category');
  if (!catEl || catEl.selectedIndex < 0) return '';
  return (catEl.options[catEl.selectedIndex]?.textContent || '').trim();
}

/** 회사내부·일일 프로젝트: 수행팀 드롭다운 없이 저장(프로필 소속팀·본부로 처리, 비용배분 미사용) */
function _entryOmitTeamFromFormPick(catNameTrim) {
  const nm = String(catNameTrim || '').trim();
  if (nm === '회사내부업무') return true;
  /** 프로젝트업무: 유상 프로젝트 — 업무팀 비용배부 없음, 팀 선택 생략 */
  if (nm === '프로젝트업무') return true;
  return false;
}

/**
 * 프로젝트·회사내부: 폼에서 수행팀을 고르지 않지만, 목록/승인에서 식별용으로
 * 작성자 소속(고객지원팀 우선 → 일반 team_name)을 team_name에 저장.
 */
function _entryStampOrgTeamForDisplaySave(catNameTrim, session, teamId, teamName) {
  const nm = String(catNameTrim || '').trim();
  if (nm !== '프로젝트업무' && nm !== '회사내부업무') {
    return { team_id: teamId || '', team_name: teamName || '' };
  }
  // CCB(Daily) 계열은 팀명 대신 본부명을 기록한다.
  const isCcbDaily = typeof Auth !== 'undefined'
    && typeof Auth.preferredSheetType === 'function'
    && Auth.preferredSheetType(session) === 'daily';
  if (isCcbDaily) {
    const hqName = String(session.hq_name || '').trim();
    if (hqName) {
      return { team_id: String(session.hq_id || '').trim(), team_name: hqName };
    }
  }
  const csN = String(session.cs_team_name || '').trim();
  const tN = String(session.team_name || '').trim();
  if (csN) {
    return { team_id: String(session.cs_team_id || '').trim(), team_name: csN };
  }
  if (tN) {
    return { team_id: String(session.team_id || '').trim(), team_name: tN };
  }
  return { team_id: teamId || '', team_name: (teamName || '').trim() || '내부' };
}

/** 저장·검증용 time_category (대분류 이름 우선 — DB category_type이 client로 잘못된 경우 보정) */
function _entryEffectiveTimeCategory(catType, catName) {
  const nm = String(catName || '').trim();
  /** 시간제·일일 공통: 프로젝트/내부는 메인 고객사·Quill·키워드 검증 제외, 고객은 프로젝트 선택값으로 저장 */
  if (nm === '프로젝트업무' || nm === '회사내부업무') return 'internal';
  if (entryFormSheetType() !== 'daily') return catType || 'client';
  if (nm === '일반자문업무') return 'client';
  return catType || 'client';
}

function _entryRegisteredProjectOngoing(r) {
  if (!r || String(r.registration_status || '').trim().toLowerCase() !== 'approved') return false;
  const pe = r.period_end;
  if (pe == null || String(pe).trim() === '') return true;
  const endDay = String(pe).slice(0, 10);
  const endMs = new Date(`${endDay}T23:59:59`).getTime();
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  return endMs >= startToday.getTime();
}

/** 일 단위: 시작일~종료일(포함) 캘린더 일수 */
function _entryInclusiveCalendarDays(ymdFrom, ymdTo) {
  const a = new Date(`${String(ymdFrom || '').trim()}T12:00:00`);
  const b = new Date(`${String(ymdTo || '').trim()}T12:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
  if (String(ymdFrom).trim() > String(ymdTo).trim()) return 0;
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  return diff + 1;
}

/** 수정 진입 시: 종일(00:00~23:59대) 구간이면 일 단위, 그 외는 시간 단위 (프로젝트업무만 일 단위 UI) */
function _inferDailyPeriodModeFromEntry(entry) {
  const cat = (entry.work_category_name || '').trim();
  if (cat && cat !== '프로젝트업무') return 'by_hour';
  if (!entry || entry.work_start_at == null || entry.work_end_at == null) return 'by_day_span';
  const sd = new Date(Number(entry.work_start_at));
  const ed = new Date(Number(entry.work_end_at));
  const sMin = sd.getHours() * 60 + sd.getMinutes() + sd.getSeconds() / 60;
  const eMin = ed.getHours() * 60 + ed.getMinutes() + ed.getSeconds() / 60;
  const endLooksEndOfDay = eMin >= 23 * 60 + 59;
  const startMidnight = sMin === 0;
  if (startMidnight && endLooksEndOfDay) return 'by_day_span';
  return 'by_hour';
}

function _entryDailyPeriodModeValue() {
  const sel = document.getElementById('entry-daily-period-mode-select');
  let v = sel && sel.value;
  if (v === 'by_day' || v === 'by_week') v = 'by_day_span';
  if (v === 'by_hour' || v === 'by_day_span' || v === 'by_batch') return v;
  return 'by_day_span';
}

function _entryHourlyModeValue() {
  try {
    const v = String(sessionStorage.getItem('entry_hourly_mode') || 'by_hour').trim();
    return v === 'by_batch' ? 'by_batch' : 'by_hour';
  } catch (_) {
    return 'by_hour';
  }
}

function _entryEffectiveInputMode() {
  if (entryFormSheetType() === 'daily') return _entryDailyPeriodModeValue();
  return _entryHourlyModeValue();
}

function _syncDailyPeriodModeToggleUI() {
  const wrap = document.getElementById('entry-daily-mode-toggle');
  const isDaily = entryFormSheetType() === 'daily';
  if (wrap) wrap.style.display = 'flex';
  const btnGroup = (document.getElementById('entry-daily-mode-hour-btn') || {}).parentElement || null;
  const hourBtn = document.getElementById('entry-daily-mode-hour-btn');
  const dayBtn = document.getElementById('entry-daily-mode-day-btn');
  const batchBtn = document.getElementById('entry-daily-mode-batch-btn');
  const helpEl = document.getElementById('entry-daily-mode-help');
  if (btnGroup && hourBtn && dayBtn && batchBtn) {
    // CCB(Daily) 사용자에게는 사용 빈도가 높은 일단위를 앞에 배치
    if (isDaily) {
      btnGroup.appendChild(dayBtn);
      btnGroup.appendChild(hourBtn);
      btnGroup.appendChild(batchBtn);
    } else {
      btnGroup.appendChild(hourBtn);
      btnGroup.appendChild(batchBtn);
      btnGroup.appendChild(dayBtn);
    }
  }
  if (dayBtn) dayBtn.style.display = isDaily ? '' : 'none';
  if (helpEl) {
    helpEl.textContent = isDaily
      ? '일단위는 기간 일수 × 8시간으로 자동 계산됩니다.'
      : '개별기록 또는 일괄기록 중 선택할 수 있습니다.';
  }
  const mode = _entryEffectiveInputMode();
  const active = 'btn btn-sm btn-primary';
  const normal = 'btn btn-sm btn-outline';
  if (hourBtn) hourBtn.className = mode === 'by_hour' ? active : normal;
  if (dayBtn) dayBtn.className = mode === 'by_day_span' ? active : normal;
  if (batchBtn) batchBtn.className = mode === 'by_batch' ? active : normal;
}

function setDailyPeriodMode(mode) {
  const isDaily = entryFormSheetType() === 'daily';
  const next = (mode === 'by_hour' || mode === 'by_day_span' || mode === 'by_batch') ? mode : 'by_hour';
  const sel = document.getElementById('entry-daily-period-mode-select');
  if (isDaily) {
    if (sel) sel.value = (next === 'by_day_span' || next === 'by_batch' || next === 'by_hour') ? next : 'by_hour';
  } else {
    try { sessionStorage.setItem('entry_hourly_mode', next === 'by_batch' ? 'by_batch' : 'by_hour'); } catch (_) {}
  }
  onDailyPeriodModeChange();
}

/** 일일 시트: 시간단위(by_hour) 또는 일단위(by_day_span)를 사용 */
function _entryDailyEffectivePeriodMode() {
  if (entryFormSheetType() !== 'daily') return '';
  return _entryDailyPeriodModeValue();
}

function onDailyPeriodModeChange() {
  _syncDailyPeriodModeToggleUI();
  syncEntrySheetTimeRowUI();
  updateClientSection();
  const mode = _entryEffectiveInputMode();
  if (entryFormSheetType() === 'daily' && mode === 'by_day_span') applyDailyPeriodFromInput();
  else if (mode === 'by_batch') {
    const wrap = document.getElementById('entry-batch-timeline-wrap');
    if (wrap) {
      // 일괄기록 화면 진입 시 항상 09:00 기준으로 초기 표시되도록 앵커를 초기화한다.
      wrap.dataset.anchorDate = '';
    }
    _entryBatchTimelineClearOverlay();
    _entryBatchRenderRows();
  }
  else calcDuration();
}

function _entryBatchToggleMetaByMode(mode) {
  const catWrap = document.getElementById('entry-cat-sub-grid');
  if (!catWrap) return;
  const isBatch = mode === 'by_batch';
  catWrap.style.display = isBatch ? 'none' : '';
}

function _entryBatchNowRound() {
  const d = new Date();
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  d.setMinutes(Math.floor(m / 10) * 10);
  return d;
}

function _entryBatchToInputValue(ts) {
  const d = new Date(Number(ts || Date.now()));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function _entryBatchMinutes(startAt, endAt) {
  const s = new Date(startAt).getTime();
  const e = new Date(endAt).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return Math.max(1, Math.round((e - s) / 60000));
}

function _entryBatchUuidOrNull(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return null;
  return s;
}

function _entryBatchYmdFromTs(ts) {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _entryBatchToTs(v) {
  if (v == null) return NaN;
  const n = Number(v);
  if (Number.isFinite(n) && n > 1000000000000) return n;
  if (Number.isFinite(n) && n > 1000000000) return n * 1000;
  return new Date(v).getTime();
}

function _entryBatchWorkDateKeyFromRows(rows) {
  const ymds = (rows || []).map((r) => _entryBatchDateYmdFromInput(r && r.from_at)).filter(Boolean);
  if (ymds.length > 0) return ymds.sort()[0];
  return _entryBatchYmdFromTs(_entryBatchToTs(rows && rows[0] ? rows[0].from_at : null));
}

function _entryBatchWorkDateKeyFromEntry(entry) {
  if (!entry) return '';
  const tsYmd = _entryBatchYmdFromTs(_entryBatchToTs(entry.work_start_at));
  if (tsYmd) return tsYmd;
  return _entryBatchDateYmdFromInput(entry.work_start_at);
}

async function _entryBatchListDraftCandidates(session, workDateKey) {
  const sid = encodeURIComponent(String(session && session.id || '').trim());
  if (!sid || !workDateKey) return [];
  const sheet = entryFormSheetType() === 'daily' ? 'daily' : 'hourly';
  const rows = await API.listAllPages('time_entries', {
    filter: `user_id=eq.${sid}&status=eq.draft&entry_mode=eq.batch`,
    sort: 'created_at',
    limit: 300,
    maxPages: 20,
  }).catch(() => []);
  return (rows || [])
    .filter((e) => {
      if (!e || !e.id) return false;
      const ymd = _entryBatchWorkDateKeyFromEntry(e);
      if (ymd !== workDateKey) return false;
      const rowSheet = String(e.sheet_type || '').trim();
      return !rowSheet || rowSheet === sheet;
    })
    .sort((a, b) => _entryBatchToTs(a && a.created_at) - _entryBatchToTs(b && b.created_at));
}

async function _entryBatchFindServerDraftEntry(session, workDateKey) {
  const rows = await _entryBatchListDraftCandidates(session, workDateKey);
  return rows.length ? rows[0] : null;
}

async function _entryBatchCleanupDuplicateDraftEntries(session, keepEntryId, workDateKey) {
  const keepId = String(keepEntryId || '').trim();
  if (!keepId || !workDateKey) return;
  const rows = await _entryBatchListDraftCandidates(session, workDateKey);
  const duplicates = rows.filter((e) => String(e && e.id || '').trim() !== keepId);
  for (const d of duplicates) {
    if (!d || !d.id) continue;
    await _entryDeleteBatchDetails(d.id).catch(() => {});
    await API.delete('time_entries', d.id).catch(() => {});
  }
}

function _entryBatchDateYmdFromInput(v) {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function _entryBatchResolveTimelineDate() {
  if (_entryBatchDateYmdFromInput(_entryBatchTimelineDate)) return _entryBatchTimelineDate;
  const fromRow = (_entryBatchRows || []).find((r) => _entryBatchDateYmdFromInput(r?.from_at));
  if (fromRow) return _entryBatchDateYmdFromInput(fromRow.from_at);
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function _entryBatchMinuteOfDay(v) {
  const s = new Date(v).getTime();
  if (!Number.isFinite(s)) return -1;
  const d = new Date(s);
  return d.getHours() * 60 + d.getMinutes();
}

function _entryBatchTimelineDateTime(minuteOfDay) {
  const ymd = _entryBatchResolveTimelineDate();
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const mm = String(minuteOfDay % 60).padStart(2, '0');
  return `${ymd}T${hh}:${mm}`;
}

function _entryBatchApplyResponsiveLayout() {
  const layout = document.getElementById('entry-batch-layout');
  const timelineWrap = document.getElementById('entry-batch-timeline-wrap');
  const gridWrap = document.getElementById('entry-batch-grid-wrap');
  if (!layout) return;
  // 데스크톱은 좌(시간표)-우(행입력) 2열을 기본으로 유지하고,
  // 실제 좁은 화면에서만 1열로 전환한다.
  const narrow = window.innerWidth <= 1180;
  layout.style.gridTemplateColumns = narrow ? '1fr' : 'minmax(240px,300px) minmax(0,1fr)';
  if (timelineWrap) timelineWrap.style.height = narrow ? '260px' : '440px';
  if (gridWrap) gridWrap.style.maxHeight = narrow ? 'unset' : 'none';
}

// 대분류별 파스텔 컬러 팔레트
const _BATCH_CAT_COLORS = {
  // 청록(Teal) — 일반통관업무
  '일반통관업무': { bg: 'rgba(20,184,166,0.18)',  bgActive: 'rgba(20,184,166,0.36)',  border: '#2dd4bf', borderActive: '#0f766e', text: '#0f766e',  label: '통관' },
  // 코발트 블루 — 프로젝트업무 (기존 인디고에서 명확한 파랑으로 변경)
  '프로젝트업무': { bg: 'rgba(37,99,235,0.16)',   bgActive: 'rgba(37,99,235,0.32)',   border: '#3b82f6', borderActive: '#1d4ed8', text: '#1e40af',  label: '프로젝트' },
  // 핑크라벤더 — 기타 고객업무 (기존 바이올렛에서 분홍보라로 변경)
  '기타 고객업무':{ bg: 'rgba(236,72,153,0.13)', bgActive: 'rgba(236,72,153,0.28)', border: '#f472b6', borderActive: '#be185d', text: '#9d174d',  label: '고객' },
  // 슬레이트 그레이 — 회사내부업무
  '회사내부업무': { bg: 'rgba(100,116,139,0.16)', bgActive: 'rgba(100,116,139,0.30)', border: '#94a3b8', borderActive: '#475569', text: '#334155',  label: '내부' },
  // 에메랄드 — 일반자문업무
  '일반자문업무': { bg: 'rgba(16,185,129,0.16)',  bgActive: 'rgba(16,185,129,0.30)',  border: '#34d399', borderActive: '#059669', text: '#065f46',  label: '자문' },
};
const _BATCH_CAT_DEFAULT_COLOR = { bg: 'rgba(99,102,241,0.15)', bgActive: 'rgba(99,102,241,0.28)', border: '#818cf8', borderActive: '#4338ca', text: '#3730a3', label: '' };

function _entryBatchCatColor(catName, active) {
  const c = _BATCH_CAT_COLORS[String(catName || '').trim()] || _BATCH_CAT_DEFAULT_COLOR;
  return {
    bg: active ? c.bgActive : c.bg,
    border: active ? c.borderActive : c.border,
    text: c.text,
    label: c.label,
  };
}

function _entryBatchRenderTimeline() {
  const wrap = document.getElementById('entry-batch-timeline-wrap');
  const grid = document.getElementById('entry-batch-timeline-grid');
  const hitbox = document.getElementById('entry-batch-timeline-hitbox');
  const blocks = document.getElementById('entry-batch-timeline-blocks');
  const sel = document.getElementById('entry-batch-timeline-select');
  const dateEl = document.getElementById('entry-batch-timeline-date');
  if (!wrap || !grid || !hitbox || !blocks || !sel) return;

  _entryBatchTimelineDate = _entryBatchResolveTimelineDate();
  if (dateEl && dateEl.value !== _entryBatchTimelineDate) dateEl.value = _entryBatchTimelineDate;

  const pxPerMin = 1;
  const hourHeight = 60 * pxPerMin;
  const totalHeight = 24 * hourHeight;
  const selectedIdx = (_entryBatchSelectedRowIdx >= 0 && _entryBatchSelectedRowIdx < _entryBatchRows.length) ? _entryBatchSelectedRowIdx : -1;

  const hourHtml = Array.from({ length: 24 }).map((_, h) => {
    const hh = String(h).padStart(2, '0');
    return `<div style="height:${hourHeight}px;display:grid;grid-template-columns:44px 1fr;align-items:start">
      <div style="padding-top:2px;font-size:10px;color:#64748b;text-align:right;padding-right:6px">${hh}:00</div>
      <div style="position:relative;border-top:1px solid #e5e7eb;background:
        linear-gradient(to bottom, transparent 0, transparent 50%, #f1f5f9 50%, #f1f5f9 51%, transparent 51%)"></div>
    </div>`;
  }).join('');
  grid.innerHTML = `<div style="position:relative;height:${totalHeight}px">${hourHtml}</div>`;

  hitbox.style.height = `${totalHeight}px`;
  blocks.style.height = `${totalHeight}px`;
  // 확정된 행 블록 렌더 (대분류별 색상)
  const confirmedBlocks = (_entryBatchRows || []).map((r, idx) => {
    const rowYmd = _entryBatchDateYmdFromInput(r.from_at);
    if (rowYmd !== _entryBatchTimelineDate) return '';
    const sMin = _entryBatchMinuteOfDay(r.from_at);
    const eMin = _entryBatchMinuteOfDay(r.to_at);
    if (sMin < 0 || eMin <= sMin) return '';
    const top = Math.max(0, Math.min(1439, sMin)) * pxPerMin;
    const height = Math.max(8, (Math.min(1440, eMin) - Math.max(0, sMin)) * pxPerMin);
    const active = idx === selectedIdx;
    const col = _entryBatchCatColor(r.category_name, active);
    const labelText = col.label ? `${col.label} #${idx + 1}` : `업무 #${idx + 1}`;
    const catName = Utils.escHtml(String(r.category_name || '업무'));
    const borderW = active ? '2px' : '1px';
    return `<div title="${catName} #${idx + 1}" style="position:absolute;left:0;right:0;top:${top}px;height:${height}px;border-radius:6px;
      background:${col.bg};border:${borderW} solid ${col.border};padding:2px 6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;
      font-size:10px;color:${col.text};line-height:1.4;font-weight:${active ? '700' : '500'}">${Utils.escHtml(labelText)}</div>`;
  }).join('');

  // 입력 중 미리보기 블록 (확정 전 ghost — 카테고리 색 + 점선)
  let previewBlock = '';
  if (_entryBatchTimelinePreview) {
    const pvYmd = _entryBatchDateYmdFromInput(_entryBatchTimelinePreview.fromAt);
    const pvSMin = _entryBatchMinuteOfDay(_entryBatchTimelinePreview.fromAt);
    const pvEMin = _entryBatchMinuteOfDay(_entryBatchTimelinePreview.toAt);
    if (pvYmd === _entryBatchTimelineDate && pvSMin >= 0 && pvEMin > pvSMin) {
      const pvTop = Math.max(0, Math.min(1439, pvSMin)) * pxPerMin;
      const pvHeight = Math.max(8, (Math.min(1440, pvEMin) - Math.max(0, pvSMin)) * pxPerMin);
      const pvRow = _entryBatchRows.find((r) => r.rowId === _entryBatchTimelinePreview.rowId);
      const pvCatName = pvRow?.category_name || '';
      const pvCol = _entryBatchCatColor(pvCatName, false);
      const pvCat = Utils.escHtml(String(pvCatName || '입력 중'));
      const pvIdx = _entryBatchRows.indexOf(pvRow);
      const pvLabel = pvCol.label ? `${pvCol.label} #${pvIdx >= 0 ? pvIdx + 1 : '?'} (입력 중)` : `${pvCat} #${pvIdx >= 0 ? pvIdx + 1 : '?'} (입력 중)`;
      previewBlock = `<div style="position:absolute;left:0;right:0;top:${pvTop}px;height:${pvHeight}px;border-radius:6px;
        background:${pvCol.bg};border:2px dashed ${pvCol.border};padding:2px 6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;
        font-size:10px;color:${pvCol.text};line-height:1.4;opacity:0.75">${Utils.escHtml(pvLabel)}</div>`;
    }
  }

  blocks.innerHTML = confirmedBlocks + previewBlock;

  // 날짜별 첫 진입 시에는 09:00 위치부터 보이게 맞춘다.
  if (String(wrap.dataset.anchorDate || '') !== _entryBatchTimelineDate) {
    wrap.scrollTop = 9 * 60;
    wrap.dataset.anchorDate = _entryBatchTimelineDate;
  }

  if (!_entryBatchTimelineDrag) _entryBatchTimelineClearOverlay();
}

function entryBatchTimelineOnDateChange(nextDate) {
  const ymd = _entryBatchDateYmdFromInput(nextDate);
  if (!ymd) return;
  _entryBatchTimelineDrag = null;
  _entryBatchTimelineDate = ymd;
  _entryBatchTimelineClearOverlay();
  _entryBatchRenderTimeline();
}

function entryBatchSelectRow(idx) {
  const i = Number(idx);
  if (!Number.isFinite(i) || i < 0 || i >= _entryBatchRows.length) return;
  _entryBatchTimelineDrag = null;
  _entryBatchSelectedRowIdx = i;
  _entryBatchTimelineClearOverlay();
  _entryBatchRenderRows();
}

function _entryBatchTimelineApplyRange(startMin, endMin) {
  const idx = Number(_entryBatchSelectedRowIdx);
  if (!Number.isFinite(idx) || idx < 0 || idx >= _entryBatchRows.length) {
    Toast.info('먼저 우측 표에서 적용할 행을 선택하세요.');
    return;
  }
  const { fromMin, toMin } = _entryBatchTimelineSnapRange(startMin, endMin);
  const row = _entryBatchRows[idx];
  row.from_at = _entryBatchTimelineDateTime(fromMin);
  row.to_at = _entryBatchTimelineDateTime(toMin);
  row.duration_minutes = _entryBatchMinutes(row.from_at, row.to_at);
  _entryBatchRenderRows();
  _entryBatchQueueAutosave();
}

function _entryBatchTimelineMinuteFromPointer(e) {
  const wrap = document.getElementById('entry-batch-timeline-wrap');
  if (!wrap || !e) return -1;
  const rect = wrap.getBoundingClientRect();
  const y = (Number(e.clientY) - rect.top) + wrap.scrollTop;
  if (!Number.isFinite(y)) return -1;
  return Math.max(0, Math.min(1439, Math.round(y)));
}

function _entryBatchTimelineSetGhost(start, end) {
  const s = Math.min(start, end);
  const e2 = Math.max(start, end);
  const sel = document.getElementById('entry-batch-timeline-select');
  if (!sel) return;
  const { fromMin, toMin } = _entryBatchTimelineSnapRange(start, end);
  const fromText = _entryBatchTimelineFmtMinute(fromMin);
  const toText = _entryBatchTimelineFmtMinute(toMin);
  const h = Math.max(5, e2 - s);
  sel.style.display = '';
  sel.style.top = `${s}px`;
  sel.style.height = `${h}px`;
  if (h < 34) {
    sel.innerHTML = `<div style="position:absolute;right:4px;top:2px;background:#1d4ed8;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700;line-height:1.4">${fromText} ~ ${toText}</div>`;
  } else {
    sel.innerHTML = `
      <div style="position:absolute;right:4px;top:2px;background:#1d4ed8;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700;line-height:1.4">${fromText}</div>
      <div style="position:absolute;right:4px;bottom:2px;background:#0f766e;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700;line-height:1.4">${toText}</div>
    `;
  }
}

function _entryBatchTimelineClearOverlay() {
  const sel = document.getElementById('entry-batch-timeline-select');
  if (!sel) return;
  sel.style.display = 'none';
  sel.innerHTML = '';
}

function _entryBatchTimelineFmtMinute(minute) {
  const m = Math.max(0, Math.min(1439, Number(minute) || 0));
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function _entryBatchTimelineSnapMinute(minute, dir = 'down') {
  const m = Math.max(0, Math.min(1439, Number(minute) || 0));
  if (dir === 'up') return Math.max(0, Math.min(1439, Math.ceil(m / 10) * 10));
  return Math.max(0, Math.min(1439, Math.floor(m / 10) * 10));
}

function _entryBatchTimelineSnapRange(startMin, endMin) {
  const fromMin = _entryBatchTimelineSnapMinute(Math.min(startMin, endMin), 'down');
  const toMinRaw = _entryBatchTimelineSnapMinute(Math.max(startMin, endMin), 'up');
  const toMin = Math.max(fromMin + 10, Math.min(1439, toMinRaw));
  return { fromMin, toMin };
}

function _entryBatchTimelineDetachGlobalPointer() {
  _entryBatchTimelineDrag = null;
  _entryBatchTimelineClearOverlay();
}

// ── 시간표 클릭 2회 선택 방식 (드래그 없음, 안정형) ─────────────────────────
// 1차 클릭: 시작점 저장 + 미리보기 표시
// 2차 클릭: 종료점 확정 → From/To 적용
function entryBatchTimelinePickPoint(e) {
  // 타임라인 클릭 입력은 비활성화 - 시간 입력은 행의 시작시간+소요시간 UI 사용
  return;
}

function entryBatchTimelineCancelPick() {
  _entryBatchTimelineDrag = null;
  _entryBatchTimelineClearOverlay();
}

// 하위 호환 stub
function entryBatchTimelineStartDrag(e) {}
function entryBatchTimelineMoveDrag() {}
function entryBatchTimelineEndDrag() {}

if (!window.__entryBatchResizeBound__) {
  window.addEventListener('resize', () => {
    if (typeof _entryEffectiveInputMode === 'function' && _entryEffectiveInputMode() === 'by_batch') {
      _entryBatchApplyResponsiveLayout();
    }
  });
  window.__entryBatchResizeBound__ = true;
}

function _entryBatchClientsOptionsHtml(selectedId) {
  const cur = String(selectedId || '');
  const opts = ['<option value="">고객사</option>'];
  (_entryBatchClientRows || []).forEach((c) => {
    const id = String(c.id || '').trim();
    const name = Utils.escHtml(String(c.client_name || c.name || '').trim());
    if (!id || !name) return;
    opts.push(`<option value="${Utils.escHtml(id)}"${id === cur ? ' selected' : ''}>${name}</option>`);
  });
  return opts.join('');
}

function _entryBatchSubOptionsHtml(catId, selectedSubId) {
  const curCatId = String(catId || '');
  const curSubId = String(selectedSubId || '');
  const opts = ['<option value="">소분류</option>'];
  (_allSubcategories || [])
    .filter((s) => String(s.category_id || '') === curCatId)
    .forEach((s) => {
      const id = String(s.id || '').trim();
      const name = Utils.escHtml(String(s.sub_category_name || '').trim());
      if (!id || !name) return;
      opts.push(`<option value="${Utils.escHtml(id)}"${id === curSubId ? ' selected' : ''}>${name}</option>`);
    });
  return opts.join('');
}

function _entryBatchCategoryOptionsHtml(selectedCatId) {
  const cur = String(selectedCatId || '');
  const opts = ['<option value="">대분류</option>'];
  const catsRaw = (entryFormSheetType() === 'daily')
    ? (_allCategories || []).filter((c) => ENTRY_DAILY_CATEGORY_ALLOW.includes(String(c.category_name || '').trim()))
    : (_allCategories || []);
  const cats = catsRaw.filter((c) => String(c.category_name || '').trim() !== '일반자문업무');
  cats.forEach((c) => {
    const id = String(c.id || '').trim();
    const name = Utils.escHtml(String(c.category_name || '').trim());
    if (!id || !name) return;
    opts.push(`<option value="${Utils.escHtml(id)}"${id === cur ? ' selected' : ''}>${name}</option>`);
  });
  return opts.join('');
}
function _entryBatchProjectCodeOptionsHtml(clientId, selectedCode) {
  const curClientId = String(clientId || '').trim();
  const curCode = String(selectedCode || '').trim();
  if (_entryBatchProjectRowsLoading && !_dailyOpenProjectRows.length) {
    return '<option value="">프로젝트코드 로딩중...</option>';
  }
  if (!curClientId) {
    return '<option value="">고객사를 먼저 선택하세요</option>';
  }
  const rows = (_dailyOpenProjectRows || []).filter((r) => String(r.client_id || '').trim() === curClientId);
  if (!rows.length) {
    return '<option value="">선택 가능한 프로젝트 없음</option>';
  }
  const opts = ['<option value="">프로젝트코드</option>'];
  rows.forEach((r) => {
    const code = String(r.project_code || '').trim();
    const name = String(r.project_name || '').trim();
    if (!code) return;
    const label = Utils.escHtml(name ? `${code} - ${name}` : code);
    opts.push(`<option value="${Utils.escHtml(code)}"${code === curCode ? ' selected' : ''}>${label}</option>`);
  });
  return opts.join('');
}
function _entryBatchRowDefault() {
  const ymd = _entryBatchResolveTimelineDate();
  const s = new Date(`${ymd}T09:00`);
  const e = new Date(`${ymd}T10:00`);
  return {
    rowId: `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    category_id: '',
    category_name: '',
    subcategory_id: '',
    subcategory_name: '',
    client_id: '',
    client_name: '',
    team_id: '',
    team_name: '',
    project_code: '',
    project_name: '',
    work_note: '',
    from_at: _entryBatchToInputValue(s.getTime()),
    to_at: _entryBatchToInputValue(e.getTime()),
    duration_minutes: 60,
    confirmed: false, // 사용자가 "확정" 버튼을 눌러야 true — 접기 대상 여부 판단용
  };
}

function entryBatchAddRow(prefill = null) {
  const row = { ..._entryBatchRowDefault(), ...(prefill || {}) };

  // 이전 마지막 행의 종료시간이 있으면 새 행의 시작시간으로 자동 설정
  if (!prefill || (!prefill.from_at && !prefill.to_at)) {
    const lastConfirmedRow = [..._entryBatchRows].reverse().find((r) => r.to_at);
    if (lastConfirmedRow && lastConfirmedRow.to_at) {
      const lastToAt = lastConfirmedRow.to_at; // YYYY-MM-DDTHH:mm
      const datePrefix = lastToAt.slice(0, 10);
      const endHHmm = lastToAt.slice(11, 16);
      const dur = Number(row.duration_minutes || 30);
      // 종료시간 = 새 시작 + 소요시간 (기본 유지)
      const startParts = endHHmm.split(':').map(Number);
      const startMin = startParts[0] * 60 + startParts[1];
      const endMin = startMin + dur;
      if (endMin <= 1440) {
        const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
        const endM = String(endMin % 60).padStart(2, '0');
        row.from_at = `${datePrefix}T${endHHmm}`;
        row.to_at = `${datePrefix}T${endH}:${endM}`;
      } else {
        // 자정 초과면 시작시간만 설정, to_at은 비움
        row.from_at = `${datePrefix}T${endHHmm}`;
        row.to_at = '';
      }
      row.duration_minutes = _entryBatchMinutes(row.from_at, row.to_at);
    }
  }

  _entryBatchRows.push(row);
  _entryBatchSelectedRowIdx = _entryBatchRows.length - 1;
  _entryBatchTimelineDate = _entryBatchDateYmdFromInput(row.from_at) || _entryBatchResolveTimelineDate();

  // 4행째가 추가되는 순간, 기존 확정된 행들의 명시적 펼침 상태를 모두 해제 (접힘으로)
  if (_entryBatchRows.length === 3) {
    _entryBatchExpandedRowIds.clear();
  }

  _entryBatchRenderRows();
  _entryBatchQueueAutosave();

  // 새 행의 시작시간 입력창에 포커스 및 미리보기 표시
  setTimeout(() => {
    const newStartEl = document.getElementById(`ts-start-${row.rowId}`);
    if (newStartEl) {
      newStartEl.focus();
      if (row.from_at) _entryBatchPreviewRowTime(row.rowId);
    }
  }, 50);
}

function entryBatchRemoveRow(idx) {
  const i = Number(idx);
  if (!Number.isFinite(i) || i < 0 || i >= _entryBatchRows.length) return;
  const removedRowId = _entryBatchRows[i].rowId;
  _entryBatchExpandedRowIds.delete(removedRowId);
  _entryBatchRows.splice(i, 1);
  if (!_entryBatchRows.length) _entryBatchSelectedRowIdx = -1;
  else if (_entryBatchSelectedRowIdx >= _entryBatchRows.length) _entryBatchSelectedRowIdx = _entryBatchRows.length - 1;
  else if (_entryBatchSelectedRowIdx === i) _entryBatchSelectedRowIdx = Math.max(0, i - 1);
  _entryBatchRenderRows();
  _entryBatchQueueAutosave();
}

// 접힌 행 클릭 시 펼치기/접기 토글
function entryBatchToggleRowExpand(rowId) {
  if (_entryBatchExpandedRowIds.has(rowId)) {
    _entryBatchExpandedRowIds.delete(rowId);
  } else {
    _entryBatchExpandedRowIds.add(rowId);
  }
  _entryBatchRenderRows();
}

// 확정된 행이 접혀야 하는지 판단 (3행 이상이고 사용자가 확정 완료 && 명시적 펼침 아님)
function _entryBatchShouldCollapse(r, idx) {
  if (_entryBatchRows.length < 3) return false;
  if (!r.confirmed) return false; // "확정" 버튼을 누른 행만 접기 대상
  if (_entryBatchExpandedRowIds.has(r.rowId)) return false; // 명시적 펼침
  return true;
}

// ── 배치 행 시간 입력 UI 핸들러 ─────────────────────────────────────────────

function _entryBatchFindRowByRowId(rowId) {
  const idx = _entryBatchRows.findIndex((r) => r.rowId === rowId);
  return { idx, row: idx >= 0 ? _entryBatchRows[idx] : null };
}

// 소요시간 칩 클릭: 해당 rowId의 duration_minutes 갱신 + UI 부분 갱신
function entryBatchDurChipClick(rowId, minutes) {
  const { row } = _entryBatchFindRowByRowId(rowId);
  if (!row) return;
  const dur = Math.max(10, Math.min(480, Number(minutes) || 30));
  row.duration_minutes = dur;
  _entryBatchUpdateRowTimeUi(rowId);
}

// 소요시간 스텝퍼 ±10: duration_minutes 증감 + UI 부분 갱신
function entryBatchDurStepperChange(rowId, delta) {
  const { row } = _entryBatchFindRowByRowId(rowId);
  if (!row) return;
  const cur = Number(row.duration_minutes || 30);
  row.duration_minutes = Math.max(10, Math.min(480, cur + Number(delta)));
  _entryBatchUpdateRowTimeUi(rowId);
}

// 시작시간 입력 중 결과 미리보기
function _entryBatchPreviewRowTime(rowId) {
  const { row } = _entryBatchFindRowByRowId(rowId);
  if (!row) return;
  const startEl = document.getElementById(`ts-start-${rowId}`);
  if (!startEl) return;
  _entryBatchUpdateRowTimeUi(rowId, startEl.value);
}

// 행 시간 UI를 DOM에서 직접 갱신 (전체 re-render 없이) + 타임라인 미리보기 갱신
function _entryBatchUpdateRowTimeUi(rowId, startRaw) {
  const { row } = _entryBatchFindRowByRowId(rowId);
  if (!row) return;

  const startEl = document.getElementById(`ts-start-${rowId}`);
  const durEl = document.getElementById(`ts-dur-${rowId}`);
  const resultEl = document.getElementById(`ts-result-${rowId}`);
  const errEl = document.getElementById(`ts-err-${rowId}`);

  const dur = Number(row.duration_minutes || 30);
  if (durEl) durEl.textContent = `${dur}분`;

  // 칩 active 상태 갱신 (10분 단위 칩 라벨과 일치)
  const chipMap = { 10: '10분', 30: '30분', 60: '1h', 120: '2h' };
  const chipContainer = durEl ? durEl.parentElement : null;
  if (chipContainer) {
    Object.entries(chipMap).forEach(([min, label]) => {
      const active = Number(min) === dur;
      chipContainer.querySelectorAll(`button[aria-label="${label}"]`).forEach((btn) => {
        btn.className = active
          ? btn.className.replace(/\bbtn-outline\b/g, 'btn-primary')
          : btn.className.replace(/\bbtn-primary\b/g, 'btn-outline');
        btn.setAttribute('aria-pressed', String(active));
      });
    });
  }

  const raw = startRaw !== undefined ? startRaw : (startEl ? startEl.value : '');
  const datePrefix = _entryBatchResolveTimelineDate();
  const calc = raw.trim() ? _entryBatchCalcEnd(raw, dur, datePrefix) : null;

  if (errEl) errEl.style.display = 'none';

  if (!raw.trim()) {
    if (resultEl) {
      resultEl.style.color = '#94a3b8';
      resultEl.style.fontWeight = '';
      resultEl.textContent = '시작시간을 입력 후 확정을 누르세요';
    }
    // 미리보기 클리어
    if (_entryBatchTimelinePreview && _entryBatchTimelinePreview.rowId === rowId) {
      _entryBatchTimelinePreview = null;
      _entryBatchRenderTimeline();
    }
    return;
  }

  if (!calc) {
    if (errEl) {
      errEl.textContent = '시작시간 형식 오류 (예: 09:00 또는 900)';
      errEl.style.display = '';
    }
    if (resultEl) resultEl.textContent = '';
    if (_entryBatchTimelinePreview && _entryBatchTimelinePreview.rowId === rowId) {
      _entryBatchTimelinePreview = null;
      _entryBatchRenderTimeline();
    }
    return;
  }

  if (resultEl) {
    resultEl.style.fontWeight = '600';
    if (calc.overDay) {
      resultEl.style.color = '#d97706';
      resultEl.textContent = `${calc.startHHmm} → ${calc.endHHmm} (${dur}분) ⚠ 자정 초과`;
    } else {
      resultEl.style.color = '#16a34a';
      resultEl.textContent = `${calc.startHHmm} → ${calc.endHHmm}  (${dur}분)`;
    }
  }

  // 타임라인 미리보기 갱신 (자정 초과 아닐 때만)
  if (!calc.overDay) {
    _entryBatchTimelinePreview = { rowId, fromAt: calc.fromAt, toAt: calc.toAt };
  } else {
    _entryBatchTimelinePreview = null;
  }
  _entryBatchRenderTimeline();
}

// 행 시간 확정: from_at/to_at/duration_minutes 저장 + 다음 행 시작시간 자동 입력
function entryBatchConfirmRow(rowId) {
  const { idx, row } = _entryBatchFindRowByRowId(rowId);
  if (!row) return;

  const startEl = document.getElementById(`ts-start-${rowId}`);
  const errEl = document.getElementById(`ts-err-${rowId}`);
  const startRaw = startEl ? startEl.value.trim() : '';

  const showErr = (msg) => {
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = '';
    }
    if (startEl) startEl.focus();
  };

  if (!startRaw) { showErr('시작시간을 입력하세요'); return; }

  const dur = Number(row.duration_minutes || 30);
  if (dur < 10) { showErr('소요시간이 너무 짧습니다 (최소 10분)'); return; }

  const datePrefix = _entryBatchResolveTimelineDate();
  const calc = _entryBatchCalcEnd(startRaw, dur, datePrefix);
  if (!calc) { showErr('시작시간 형식 오류 (예: 09:00 또는 900)'); return; }

  // row 갱신
  row.from_at = calc.fromAt;
  row.to_at = calc.toAt;
  row.duration_minutes = calc.durationMin;
  row.confirmed = true; // 사용자가 확정한 행 — 접기 대상으로 표시

  // 확정 시 미리보기 클리어
  if (_entryBatchTimelinePreview && _entryBatchTimelinePreview.rowId === rowId) {
    _entryBatchTimelinePreview = null;
  }

  // 4행 이상이면 확정된 행을 자동으로 접힘 상태로 (명시적 펼침 목록에서 제거)
  if (_entryBatchRows.length >= 3) {
    _entryBatchExpandedRowIds.delete(rowId);
  }

  // 다음 행 시작시간 자동 입력 (full re-render 전에 저장)
  const nextEndHHmm = calc.overDay ? '' : calc.endHHmm;

  // 전체 re-render
  _entryBatchRenderRows();
  _entryBatchQueueAutosave();

  // re-render 후 다음 빈 행에 시작시간 자동 입력
  if (nextEndHHmm && idx + 1 < _entryBatchRows.length) {
    const nextRow = _entryBatchRows[idx + 1];
    if (nextRow && !nextRow.from_at) {
      const nextStartEl = document.getElementById(`ts-start-${nextRow.rowId}`);
      if (nextStartEl) {
        nextStartEl.value = nextEndHHmm;
        _entryBatchPreviewRowTime(nextRow.rowId);
        nextStartEl.focus();
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────

function entryBatchOnFieldChange(idx, field, value) {
  const i = Number(idx);
  if (!Number.isFinite(i) || i < 0 || i >= _entryBatchRows.length) return;
  const row = _entryBatchRows[i];
  const prevClientId = String(row.client_id || '');
  row[field] = value;
  if (field === 'category_id') {
    const cat = (_allCategories || []).find((c) => String(c.id) === String(value));
    row.category_name = String(cat?.category_name || '');
    row.subcategory_id = '';
    row.subcategory_name = '';
    if (row.category_name === '일반자문업무') {
      row.category_id = '';
      row.category_name = '';
      Toast.warning('일반자문업무는 일괄기록에서 선택할 수 없습니다.');
    }
    if (row.category_name === '회사내부업무') {
      row.team_id = '';
      row.team_name = '';
      row.client_id = '';
      row.client_name = '';
    }
    if (row.category_name === '프로젝트업무') {
      row.team_id = '';
      row.team_name = '';
      row.subcategory_id = '';
      row.subcategory_name = '';
      row.project_code = '';
      row.project_name = '';
    }
    // 회사내부업무로 변경 시에만 고객사 클리어 (그 외 업무 카테고리는 고객사 유지 가능)
    if (row.category_name === '회사내부업무') {
      row.client_id = '';
      row.client_name = '';
    }
    if (row.category_name !== '프로젝트업무') {
      row.project_code = '';
      row.project_name = '';
    }
  } else if (field === 'subcategory_id') {
    const sub = (_allSubcategories || []).find((s) => String(s.id) === String(value));
    row.subcategory_name = String(sub?.sub_category_name || '');
  } else if (field === 'client_id') {
    const clientVal = String(value || '');
    const c = (_entryBatchClientRows || []).find((x) => String(x.id) === clientVal);
    row.client_name = String(c?.client_name || c?.name || '');
    if (String(row.category_name || '').trim() === '프로젝트업무' && prevClientId != clientVal) {
      row.project_code = '';
      row.project_name = '';
    }
  } else if (field === 'project_code') {
    const picked = (_dailyOpenProjectRows || []).find((r) =>
      String(r.project_code || '').trim() === String(value || '').trim()
      &&
      (!String(row.client_id || '').trim() || String(r.client_id || '').trim() === String(row.client_id || '').trim())
    );
    row.project_name = String(picked?.project_name || '');
  } else if (field === 'team_id') {
    const el = document.getElementById(`entry-batch-team-${i}`);
    row.team_name = (el && el.options && el.selectedIndex >= 0) ? String(el.options[el.selectedIndex].textContent || '') : '';
  } else if (field === 'from_at' || field === 'to_at') {
    row.duration_minutes = _entryBatchMinutes(row.from_at, row.to_at);
  }
  _entryBatchRenderRows();
  _entryBatchQueueAutosave();
}

// ── 고객사 직접입력 모드 토글 ─────────────────────────────────
function entryBatchToggleClientMode(idx) {
  const i = Number(idx);
  if (!Number.isFinite(i) || i < 0 || i >= _entryBatchRows.length) return;
  const row = _entryBatchRows[i];
  row._clientDirect = !row._clientDirect;
  // 모드 전환 시 이전 입력값 초기화
  row.client_id = '';
  row.client_name = '';
  _entryBatchRenderRows();
  // 직접입력 모드로 전환됐으면 포커스
  if (row._clientDirect) {
    const el = document.getElementById(`entry-batch-client-direct-${i}`);
    if (el) el.focus();
  }
  _entryBatchQueueAutosave();
}

function entryBatchOnClientDirectInput(idx, value) {
  const i = Number(idx);
  if (!Number.isFinite(i) || i < 0 || i >= _entryBatchRows.length) return;
  const row = _entryBatchRows[i];
  row.client_name = String(value || '');
  row.client_id = '';
  _entryBatchQueueAutosave();
}

function entryBatchOnClientSearchSelect(idx, clientId, clientName) {
  const i = Number(idx);
  if (!Number.isFinite(i) || i < 0 || i >= _entryBatchRows.length) return;
  const row = _entryBatchRows[i];
  const prevClientId = String(row.client_id || '');
  const nextClientId = String(clientId || '');
  const nextClientName = String(clientName || '');
  if (prevClientId === nextClientId && String(row.client_name || '') === nextClientName) return;
  row.client_id = nextClientId;
  row.client_name = nextClientName;
  if (String(row.category_name || '').trim() === '프로젝트업무' && prevClientId !== row.client_id) {
    row.project_code = '';
    row.project_name = '';
  }
  _entryBatchRenderRows();
  _entryBatchQueueAutosave();
}

function _entryBatchAdjustClientSearchUi(wrapperId) {
  const wrap = document.getElementById(wrapperId);
  if (!wrap) return;
  const selected = wrap.querySelector('.cs-selected-box');
  if (selected) {
    selected.style.minHeight = '30px';
    selected.style.height = '30px';
    selected.style.padding = '4px 8px';
    selected.style.fontSize = '12px';
    selected.style.display = 'flex';
    selected.style.alignItems = 'center';
    selected.style.gap = '6px';
    selected.style.overflow = 'hidden';

    const label = selected.querySelector('span');
    if (label) {
      label.style.display = 'block';
      label.style.flex = '1 1 auto';
      label.style.minWidth = '0';
      label.style.whiteSpace = 'nowrap';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      label.style.lineHeight = '1.2';
    }
  }
  const input = document.getElementById(`cs-input-${wrapperId}`);
  if (input) {
    input.style.height = '30px';
    input.style.minHeight = '30px';
    input.style.fontSize = '12px';
    input.style.paddingLeft = '28px';
  }
}

function _entryBatchTotalMinutes() {
  return (_entryBatchRows || []).reduce((s, r) => s + (Number(r.duration_minutes) || 0), 0);
}

function _entryBatchRenderRows() {
  const body = document.getElementById('entry-batch-rows-body');
  if (!body) return;
  _entryBatchApplyResponsiveLayout();
  if (_entryBatchSelectedRowIdx < 0 && _entryBatchRows.length) _entryBatchSelectedRowIdx = 0;
  if (_entryBatchSelectedRowIdx >= _entryBatchRows.length) _entryBatchSelectedRowIdx = _entryBatchRows.length - 1;
  if (!_entryBatchRows.length) {
    body.innerHTML = '<div style="padding:12px;text-align:center;color:#64748b;font-size:12px">행 추가 버튼으로 업무를 입력하세요.</div>';
    const totalEl = document.getElementById('entry-batch-total-min');
    if (totalEl) totalEl.textContent = '합계 0분';
    _entryBatchRenderTimeline();
    return;
  }
  const needsProjectCodes = (_entryBatchRows || []).some((r) => String(r.category_name || '').trim() === '프로젝트업무');
  if (needsProjectCodes && !_dailyOpenProjectRows.length && !_entryBatchProjectRowsLoading) {
    _entryBatchProjectRowsLoading = true;
    _entryLoadDailyOpenProjects().catch((e) => console.warn('[entry batch] project rows load failed', e)).finally(() => {
      _entryBatchProjectRowsLoading = false;
      _entryBatchRenderRows();
    });
  }

  const teamEl = document.getElementById('entry-team');
  const teamOptions = (() => {
    if (!teamEl) return '<option value="">업무팀</option>';
    return Array.from(teamEl.options || []).map((o) => {
      const v = Utils.escHtml(String(o.value || ''));
      const t = Utils.escHtml(String(o.textContent || ''));
      return `<option value="${v}">${t}</option>`;
    }).join('');
  })();
  body.innerHTML = _entryBatchRows.map((r, idx) => {
    const cat = String(r.category_name || '');
    // 회사내부업무 외 모든 업무 카테고리에서 고객사 입력 활성화
    const showClient = cat !== '' && cat !== '회사내부업무';
    const showTeam = cat === '일반통관업무';
    const showProject = cat === '프로젝트업무';
    const active = idx === _entryBatchSelectedRowIdx;

    // 4행 이상이고 확정 완료된 행은 접힌 카드로 표시
    if (_entryBatchShouldCollapse(r, idx)) {
      const catLabel = Utils.escHtml(r.category_name || '(미지정)');
      const timeLabel = r.from_at && r.to_at
        ? `${r.from_at.slice(11, 16)} → ${r.to_at.slice(11, 16)}&nbsp;(${Number(r.duration_minutes || 0)}분)`
        : '';
      const notePreview = Utils.escHtml(String(r.work_note || '').slice(0, 30));
      return `<div onclick="entryBatchToggleRowExpand('${r.rowId}')"
        style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:6px 10px;cursor:pointer;
               display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;
               transition:background 0.15s"
        onmouseenter="this.style.background='#f0f9ff'"
        onmouseleave="this.style.background='#f8fafc'"
        title="클릭하여 펼치기">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
          <strong style="font-size:12px;color:#0f172a;flex-shrink:0">#${idx + 1}</strong>
          <span style="font-size:11px;color:#1e40af;font-weight:600;flex-shrink:0">${catLabel}</span>
          <span style="font-size:12px;color:#16a34a;font-weight:700;flex-shrink:0">${timeLabel}</span>
          ${notePreview ? `<span style="font-size:11px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${notePreview}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          <span style="font-size:10px;color:#94a3b8">펼치기 ▾</span>
          <button type="button" class="btn btn-sm btn-outline" style="height:24px;padding:0 6px"
            onclick="event.stopPropagation(); entryBatchRemoveRow(${idx})"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
    }

    return `<div onclick="entryBatchSelectRow(${idx})" style="border:1px solid ${active ? '#93c5fd' : '#e2e8f0'};background:${active ? '#eff6ff' : '#fff'};border-radius:8px;padding:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px">
          <strong style="font-size:12px;color:#0f172a">#${idx + 1}</strong>
          <button type="button" class="btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}" style="height:24px;min-width:44px" onclick="event.stopPropagation(); entryBatchSelectRow(${idx})">선택</button>
          <span style="font-size:11px;color:#475569">소요 ${Number(r.duration_minutes || 0)}분</span>
          ${r.from_at && _entryBatchRows.length >= 3 ? `<button type="button" class="btn btn-sm btn-outline" style="height:22px;padding:0 6px;font-size:10px" onclick="event.stopPropagation();entryBatchToggleRowExpand('${r.rowId}')">접기 ▴</button>` : ''}
        </div>
        <button type="button" class="btn btn-sm btn-outline" style="height:26px" onclick="event.stopPropagation(); entryBatchRemoveRow(${idx})"><i class="fas fa-trash"></i></button>
      </div>
      <div onclick="event.stopPropagation()" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:6px;margin-top:8px">
        <div><div style="font-size:10px;color:#64748b;margin-bottom:3px">대분류</div><select class="ep-ctrl" style="width:100%;height:30px;font-size:12px" onchange="entryBatchOnFieldChange(${idx},'category_id',this.value)">${_entryBatchCategoryOptionsHtml(r.category_id)}</select></div>
        <div><div style="font-size:10px;color:#64748b;margin-bottom:3px">소분류</div><select class="ep-ctrl" style="width:100%;height:30px;font-size:12px" ${showProject ? 'disabled' : ''} onchange="entryBatchOnFieldChange(${idx},'subcategory_id',this.value)">${showProject ? '<option value="">(프로젝트업무는 소분류 없음)</option>' : _entryBatchSubOptionsHtml(r.category_id, r.subcategory_id)}</select></div>
        <div>
          <div style="font-size:10px;color:#64748b;margin-bottom:3px;display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span>고객사</span>
            ${showClient ? `<button type="button" onclick="event.stopPropagation();entryBatchToggleClientMode(${idx})"
              style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid #cbd5e1;background:#f1f5f9;color:#475569;cursor:pointer;white-space:nowrap;line-height:1.6">
              ${r._clientDirect ? '<i class="fas fa-search"></i> 검색' : '<i class="fas fa-keyboard"></i> 직접입력'}
            </button>` : ''}
          </div>
          ${showClient
            ? (r._clientDirect
                ? `<input id="entry-batch-client-direct-${idx}" class="ep-ctrl" style="width:100%;height:30px;font-size:12px"
                    placeholder="신규 업체명 입력" value="${Utils.escHtml(String(r.client_name || ''))}"
                    oninput="entryBatchOnClientDirectInput(${idx},this.value)" onclick="event.stopPropagation()" />`
                : `<div id="entry-batch-client-wrap-${idx}" onclick="event.stopPropagation()"></div>`)
            : `<input class="ep-ctrl" style="width:100%;height:30px;font-size:12px" value="" placeholder="해당없음" disabled />`}
        </div>
        <div><div style="font-size:10px;color:#64748b;margin-bottom:3px">업무팀</div><select id="entry-batch-team-${idx}" class="ep-ctrl" style="width:100%;height:30px;font-size:12px" ${showTeam ? '' : 'disabled'} onchange="entryBatchOnFieldChange(${idx},'team_id',this.value)">${teamOptions}</select></div>
        <div><div style="font-size:10px;color:#64748b;margin-bottom:3px">프로젝트코드</div>${showProject ? `<select class="ep-ctrl" style="width:100%;height:30px;font-size:12px" onchange="entryBatchOnFieldChange(${idx},'project_code',this.value)">${_entryBatchProjectCodeOptionsHtml(r.client_id, r.project_code)}</select>` : `<input class="ep-ctrl" style="width:100%;height:30px;font-size:12px" disabled value="" placeholder="프로젝트코드" />`}</div>
      </div>
      <div onclick="event.stopPropagation()" style="margin-top:6px;display:flex;align-items:flex-end;gap:6px">
        <div style="flex:1">
          <div style="font-size:10px;color:#64748b;margin-bottom:3px">업무기록</div>
          <input class="ep-ctrl" style="width:100%;height:30px;font-size:12px"
            value="${Utils.escHtml(String(r.work_note || ''))}"
            onchange="entryBatchOnFieldChange(${idx},'work_note',this.value)"
            placeholder="업무기록을 입력하세요"
            aria-label="업무기록" />
        </div>
      </div>
      <div onclick="event.stopPropagation()" style="margin-top:8px">
        <div style="font-size:10px;color:#64748b;margin-bottom:4px">시작시간 / 소요시간</div>
        <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
          <input id="ts-start-${r.rowId}" type="text" class="ep-ctrl"
            style="width:68px;height:30px;font-size:13px;text-align:center;font-weight:600;letter-spacing:0.03em"
            placeholder="09:00"
            value="${Utils.escHtml(String(r.from_at ? r.from_at.slice(11, 16) : ''))}"
            onfocus="this.select()"
            oninput="_entryBatchPreviewRowTime('${r.rowId}')"
            onblur="_entryBatchPreviewRowTime('${r.rowId}')"
            aria-label="시작시간 (예: 09:00 또는 900)" />
          <div style="display:flex;gap:2px" role="group" aria-label="소요시간 빠른선택">
            ${[10, 30, 60, 120].map((min) => {
              const label = min < 60 ? `${min}분` : `${min / 60}h`;
              const active = Number(r.duration_minutes || 30) === min;
              return `<button type="button" class="btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}"
                style="height:26px;padding:0 7px;font-size:11px"
                onclick="event.stopPropagation();entryBatchDurChipClick('${r.rowId}',${min})"
                aria-label="${label}" aria-pressed="${active}">${label}</button>`;
            }).join('')}
          </div>
          <div style="display:flex;align-items:center;gap:2px">
            <button type="button" class="btn btn-sm btn-outline"
              style="height:26px;min-width:26px;padding:0 5px;font-size:14px;line-height:1"
              onclick="event.stopPropagation();entryBatchDurStepperChange('${r.rowId}',-10)"
              aria-label="10분 감소">−</button>
            <span id="ts-dur-${r.rowId}"
              style="min-width:42px;text-align:center;font-size:12px;font-weight:700;color:#1e40af">
              ${Number(r.duration_minutes || 30)}분</span>
            <button type="button" class="btn btn-sm btn-outline"
              style="height:26px;min-width:26px;padding:0 5px;font-size:14px;line-height:1"
              onclick="event.stopPropagation();entryBatchDurStepperChange('${r.rowId}',10)"
              aria-label="10분 증가">+</button>
          </div>
          <button type="button" class="btn btn-sm btn-primary"
            id="ts-add-${r.rowId}"
            style="height:30px;padding:0 12px;font-size:12px;white-space:nowrap;flex-shrink:0"
            onclick="event.stopPropagation();entryBatchConfirmRow('${r.rowId}')"
            aria-label="시간 확정">확정</button>
        </div>
        <div id="ts-result-${r.rowId}"
          style="font-size:11px;margin-top:4px;min-height:16px;${r.from_at ? 'color:#16a34a;font-weight:600' : 'color:#94a3b8'}"
          role="status" aria-live="polite">
          ${r.from_at && r.to_at
            ? `${r.from_at.slice(11, 16)} → ${r.to_at.slice(11, 16)}&nbsp;&nbsp;(${Number(r.duration_minutes || 0)}분)`
            : '시작시간을 입력 후 확정을 누르세요'}
        </div>
        <div id="ts-err-${r.rowId}" style="font-size:11px;color:#dc2626;margin-top:2px;display:none" role="alert" aria-live="assertive"></div>
      </div>
    </div>`;
  }).join('');
  _entryBatchRows.forEach((r, idx) => {
    const teamPick = document.getElementById(`entry-batch-team-${idx}`);
    if (teamPick) teamPick.value = String(r.team_id || '');
    const clientWrapId = `entry-batch-client-wrap-${idx}`;
    const catName = String(r.category_name || '');
    const isClientEnabled = catName !== '' && catName !== '회사내부업무';
    // 직접입력 모드에서는 ClientSearchSelect 초기화 불필요 (text input이 렌더됨)
    if (!r._clientDirect) {
      const clientWrap = document.getElementById(clientWrapId);
      if (clientWrap && typeof ClientSearchSelect !== 'undefined') {
        const clients = (_entryBatchClientRows || []).map((x) => ({
          id: String(x.id || ''),
          name: String(x.client_name || x.company_name || x.name || ''),
          company_name: String(x.client_name || x.company_name || x.name || ''),
        })).filter((x) => x.id && x.name);
        // init/setValue 중 onSelect가 즉시 발화되어 row 데이터를 덮어쓰는 것을 방지
        let _csInitDone = false;
        ClientSearchSelect.init(clientWrapId, clients, {
          placeholder: '고객사 검색/선택',
          onSelect: (id, name) => {
            if (!_csInitDone) return;
            entryBatchOnClientSearchSelect(idx, id, name);
          },
        });
        if (isClientEnabled) ClientSearchSelect.setValue(clientWrapId, r.client_id || '', r.client_name || '');
        else ClientSearchSelect.clear(clientWrapId);
        _csInitDone = true; // 이후 사용자 선택부터만 onSelect 허용
        _entryBatchAdjustClientSearchUi(clientWrapId);
      }
    }
  });
  const totalEl = document.getElementById('entry-batch-total-min');
  if (totalEl) totalEl.textContent = `합계 ${_entryBatchTotalMinutes()}분`;
  _entryBatchRenderTimeline();
}

function _entryBatchLocalPayload() {
  return {
    ts: Date.now(),
    sheet_type: entryFormSheetType(),
    mode: _entryEffectiveInputMode(),
    rows: _entryBatchRows || [],
  };
}

function _entryBatchAutosaveState(text) {
  const el = document.getElementById('entry-batch-autosave-state');
  if (!el) return;
  el.textContent = text;
}

function _entryBatchDraftServerKey(session) {
  const sid = String(session && session.id || '').trim();
  const sheet = entryFormSheetType() === 'daily' ? 'daily' : 'hourly';
  return `${ENTRY_BATCH_SERVER_DRAFT_KEY_PREFIX}_${sid}_${sheet}`;
}

function _entryBatchGetDraftServerId(session) {
  try {
    return String(localStorage.getItem(_entryBatchDraftServerKey(session)) || '').trim();
  } catch (_) {
    return '';
  }
}

function _entryBatchSetDraftServerId(session, entryId) {
  try {
    const key = _entryBatchDraftServerKey(session);
    const id = String(entryId || '').trim();
    if (!id) localStorage.removeItem(key);
    else localStorage.setItem(key, id);
  } catch (_) {}
}

function _entryBatchClearDraftServerId(session) {
  try { localStorage.removeItem(_entryBatchDraftServerKey(session)); } catch (_) {}
}

function _entryBatchQueueAutosave() {
  if (_entryBatchHydrating) return;
  if (_entryEffectiveInputMode() !== 'by_batch') return;
  _entryBatchAutosaveState('저장 대기...');
  if (_entryBatchAutosaveTimer) clearTimeout(_entryBatchAutosaveTimer);
  _entryBatchAutosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(ENTRY_BATCH_LOCAL_KEY, JSON.stringify(_entryBatchLocalPayload()));
      _entryBatchAutosaveState('로컬 임시저장됨');
    } catch (_) {
      _entryBatchAutosaveState('로컬 저장 실패');
    }
  }, 600);
}

async function _entryBatchRestoreServerDraft() {
  const session = getSession();
  if (!session || !session.id) return false;

  let entry = null;
  let entryId = _entryBatchGetDraftServerId(session);
  if (entryId) {
    try {
      const cached = await API.get('time_entries', entryId);
      const sameUser = String(cached && cached.user_id || '') === String(session && session.id || '');
      const isDraft = String(cached && cached.status || '') === 'draft';
      const isBatch = String(cached && cached.entry_mode || '') === 'batch';
      if (sameUser && isDraft && isBatch) entry = cached;
      else {
        _entryBatchClearDraftServerId(session);
        entryId = '';
      }
    } catch (_) {
      _entryBatchClearDraftServerId(session);
      entryId = '';
    }
  }

  if (!entry) {
    const sid = encodeURIComponent(String(session.id || '').trim());
    const drafts = await API.listAllPages('time_entries', {
      filter: `user_id=eq.${sid}&status=eq.draft&entry_mode=eq.batch`,
      sort: 'updated_at',
      limit: 100,
      maxPages: 10,
    }).catch(() => []);
    entry = (drafts || [])[0] || null;
    if (!entry || !entry.id) return false;
    entryId = String(entry.id || '');
    _entryBatchSetDraftServerId(session, entryId);
  }

  const details = await API.listAllPages('time_entry_details', {
    filter: `entry_id=eq.${encodeURIComponent(entryId)}`,
    sort: 'row_order',
    limit: 200,
    maxPages: 20,
  }).catch(() => []);
  if (!Array.isArray(details) || !details.length) return false;

  _entryBatchHydrating = true;
  _entryBatchRows = details.map((d) => {
    const fromTs = _entryBatchToTs(d && d.from_at);
    const toTs = _entryBatchToTs(d && d.to_at);
    const fromAt = Number.isFinite(fromTs) ? _entryBatchToInputValue(fromTs) : '';
    const toAt = Number.isFinite(toTs) ? _entryBatchToInputValue(toTs) : '';
    return {
      ..._entryBatchRowDefault(),
      category_id: String(d && d.work_category_id || ''),
      category_name: String(d && d.work_category_name || ''),
      subcategory_id: String(d && d.work_subcategory_id || ''),
      subcategory_name: String(d && d.work_subcategory_name || ''),
      client_id: String(d && d.client_id || ''),
      client_name: String(d && d.client_name || ''),
      team_id: String(d && d.team_id || ''),
      team_name: String(d && d.team_name || ''),
      project_code: String(d && d.project_code || ''),
      project_name: String(d && d.project_name || ''),
      work_note: String(d && d.work_note || ''),
      from_at: fromAt,
      to_at: toAt,
      duration_minutes: Number(d && d.duration_minutes) || _entryBatchMinutes(fromAt, toAt),
    };
  });
  _entryBatchSelectedRowIdx = _entryBatchRows.length ? 0 : -1;
  _entryBatchTimelineDate = _entryBatchResolveTimelineDate();
  _entryBatchHydrating = false;
  _entryBatchRenderRows();
  _entryBatchAutosaveState('서버 임시저장 복구됨');
  _editEntryId = entryId;
  return true;
}

async function entryBatchRestoreLocalDraft() {
  try {
    const raw = localStorage.getItem(ENTRY_BATCH_LOCAL_KEY)
      || localStorage.getItem('entry_batch_rows')
      || localStorage.getItem('entry_batch_rows_v0');
    if (raw) {
      const data = JSON.parse(raw);
      const rows = Array.isArray(data) ? data : (Array.isArray(data && data.rows) ? data.rows : null);
      if (rows && rows.length) {
        _entryBatchHydrating = true;
        _entryBatchRows = rows.map((r) => ({
          ..._entryBatchRowDefault(),
          ...r,
          duration_minutes: _entryBatchMinutes(r.from_at, r.to_at),
        }));
        _entryBatchSelectedRowIdx = _entryBatchRows.length ? 0 : -1;
        _entryBatchTimelineDate = _entryBatchResolveTimelineDate();
        _entryBatchHydrating = false;
        _entryBatchRenderRows();
        _entryBatchAutosaveState('임시저장 복구됨');
        Toast.success('일괄기록 임시저장을 복구했습니다.');
        return;
      }
    }

    const restored = await _entryBatchRestoreServerDraft();
    if (restored) {
      Toast.success('서버 임시저장 데이터를 복구했습니다.');
      return;
    }
    Toast.info('복구할 임시저장 데이터가 없습니다.');
  } catch (e) {
    _entryBatchHydrating = false;
    console.warn('[entry batch] restore local', e);
    Toast.error('임시저장 복구에 실패했습니다.');
  }
}

function _entryPickDailyProjectByIdx(idx) {
  const r = _dailyOpenProjectListFiltered[idx];
  if (!r) return;
  _entryApplyDailyProjectPick(r);
}

function _entryProjectPickerRowsByFilters() {
  const q = String((document.getElementById('entry-proj-picker-q') || {}).value || '').trim().toLowerCase();
  const cq = String((document.getElementById('entry-proj-picker-client-q') || {}).value || '').trim().toLowerCase();
  const mainF = String((document.getElementById('entry-proj-picker-main') || {}).value || '').trim();
  return (_dailyOpenProjectRows || []).filter((r) => {
    if (mainF && String(r._main_code || '') !== mainF) return false;
    if (cq && !String(r.client_name || '').toLowerCase().includes(cq)) return false;
    if (!q) return true;
    const code = String(r.project_code || '').toLowerCase();
    const nm = String(r.project_name || '').toLowerCase();
    return code.includes(q) || nm.includes(q);
  });
}

function _entryRenderProjectPickerModalList() {
  const host = document.getElementById('entry-proj-picker-list');
  if (!host) return;
  const rows = _entryProjectPickerRowsByFilters();
  _entryProjectPickerFiltered = rows;
  if (!rows.length) {
    host.innerHTML = '<div style="padding:16px;color:#64748b">조건에 맞는 프로젝트가 없습니다.</div>';
    return;
  }
  host.innerHTML = rows.map((r, idx) => {
    const code = Utils.escHtml(String(r.project_code || ''));
    const name = Utils.escHtml(String(r.project_name || ''));
    const client = Utils.escHtml(String(r.client_name || '-'));
    return `<div class="entry-daily-proj-row" style="padding:9px 10px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:grid;grid-template-columns:180px 1fr 180px;gap:10px;align-items:center"
      onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''"
      onclick="_entryPickDailyProjectFromModal(${idx})">
      <div style="font-weight:700">${code}</div>
      <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
      <div style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${client}</div>
    </div>`;
  }).join('');
}

function _entryPickDailyProjectFromModal(idx) {
  const r = _entryProjectPickerFiltered[idx];
  if (!r) return;
  _entryApplyDailyProjectPick(r);
  closeEntryProjectPickerModal();
}

function _entryFillProjectPickerMainFilter() {
  const sel = document.getElementById('entry-proj-picker-main');
  if (!sel) return;
  const cur = sel.value;
  const seen = new Set();
  const opts = [];
  (_dailyOpenProjectRows || []).forEach((r) => {
    const code = String(r._main_code || '');
    const text = String(r._main_label || '(분류 없음)').trim() || '(분류 없음)';
    const key = `${code}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    opts.push({ value: code, text });
  });
  opts.sort((a, b) => String(a.text || '').localeCompare(String(b.text || '')));
  sel.innerHTML = '<option value="">전체</option>';
  opts.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.text;
    sel.appendChild(opt);
  });
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

async function openEntryProjectPickerModal() {
  if (!_dailyOpenProjectRows.length) await _entryLoadDailyOpenProjects();
  _entryFillProjectPickerMainFilter();
  const qEl = document.getElementById('entry-proj-picker-q');
  const cEl = document.getElementById('entry-proj-picker-client-q');
  if (qEl) qEl.value = '';
  if (cEl) cEl.value = '';
  _entryRenderProjectPickerModalList();
  openModal('entryProjectPickerModal');
}

function closeEntryProjectPickerModal() {
  closeModal('entryProjectPickerModal');
}

function _entryClearDailyProjectPick() {
  ['entry-daily-project-code', 'entry-daily-project-name', 'entry-daily-project-client-id', 'entry-daily-project-client-name'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const selBox = document.getElementById('entry-daily-project-selected');
  if (selBox) selBox.style.display = 'none';
}

function _entryGetDailyProjFilterClientId() {
  if (typeof ClientSearchSelect === 'undefined') return '';
  const v = ClientSearchSelect.getValue('entry-daily-proj-client-wrap');
  return (v && v.id) ? String(v.id) : '';
}

function _entryProjectClientOptionsFromRows() {
  const seen = new Set();
  const out = [];
  (_dailyOpenProjectRows || []).forEach((r) => {
    const id = String((r && r.client_id) || '').trim();
    const name = String((r && r.client_name) || '').trim();
    if (!id || !name) return;
    const key = `${id}|${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id, company_name: name });
  });
  out.sort((a, b) => String(a.company_name || '').localeCompare(String(b.company_name || '')));
  return out;
}

function _entryInitProjectClientFilterFromRows() {
  if (typeof ClientSearchSelect === 'undefined') return;
  let prev = { id: '', name: '' };
  try { prev = ClientSearchSelect.getValue('entry-daily-proj-client-wrap') || prev; } catch (_) {}
  const options = _entryProjectClientOptionsFromRows();
  ClientSearchSelect.init('entry-daily-proj-client-wrap', options, {
    placeholder: '고객명으로 필터…',
    onSelect: () => { _entryRefreshDailyProjectList(); },
  });
  const hasPrev = !!(prev && prev.id && options.some((c) => String(c.id) === String(prev.id)));
  if (hasPrev) {
    try { ClientSearchSelect.setValue('entry-daily-proj-client-wrap', prev.id || '', prev.name || ''); } catch (_) {}
  } else {
    try { ClientSearchSelect.clear('entry-daily-proj-client-wrap'); } catch (_) {}
  }
}

function _entryRefreshDailyProjectList() {
  const host = document.getElementById('entry-daily-project-list');
  if (!host) return;
  const qRaw = (document.getElementById('entry-daily-proj-filter-text')?.value || '').trim();
  const q = qRaw.toLowerCase();
  const canSearch = qRaw.length >= _ENTRY_DAILY_PROJECT_MIN_QUERY;
  const mainF = (document.getElementById('entry-daily-proj-filter-main')?.value || '').trim();
  const clientF = _entryGetDailyProjFilterClientId();
  const hasStructuredFilter = !!(mainF || clientF);
  _entrySyncDailyProjectShowAllBtn();
  if (!canSearch && !hasStructuredFilter) {
    _dailyOpenProjectListFiltered = [];
    host.innerHTML = `<div style="padding:12px;color:#64748b;line-height:1.5">
      검색어를 ${_ENTRY_DAILY_PROJECT_MIN_QUERY}자 이상 입력하면 결과가 표시됩니다.
    </div>`;
    return;
  }
  const rows = _dailyOpenProjectRows.filter((r) => {
    if (mainF && String(r._main_code || '') !== mainF) return false;
    if (clientF && String(r.client_id || '') !== clientF) return false;
    if (!q) return true;
    const code = String(r.project_code || '').toLowerCase();
    const nm = String(r.project_name || '').toLowerCase();
    const cn = String(r.client_name || '').toLowerCase();
    return code.includes(q) || nm.includes(q) || cn.includes(q);
  });
  _dailyOpenProjectListFiltered = rows;
  if (!rows.length) {
    host.innerHTML = `<div style="padding:12px;color:#64748b">검색 결과가 없습니다. 검색어를 바꾸거나 <strong>프로젝트 목록 전체 보기</strong>를 사용하세요.</div>`;
    return;
  }
  host.innerHTML = rows.map((r, idx) => {
    const code = Utils.escHtml(String(r.project_code || ''));
    const name = Utils.escHtml(String(r.project_name || ''));
    const cl = Utils.escHtml(String(r.client_name || '-'));
    return `<div class="entry-daily-proj-row" style="padding:8px 10px;border-bottom:1px solid #f1f5f9;cursor:pointer;display:flex;justify-content:space-between;gap:8px;align-items:flex-start"
      onmouseover="this.style.background='#f0fdf4'" onmouseout="this.style.background=''"
      onclick="_entryPickDailyProjectByIdx(${idx})">
      <div style="min-width:0"><strong>${code}</strong> ${name}<br/><span style="font-size:11px;color:#64748b">${cl}</span></div>
    </div>`;
  }).join('');
}

async function _entryFillDailyProjMainFilter() {
  const sel = document.getElementById('entry-daily-proj-filter-main');
  if (!sel) return;
  const cur = sel.value;
  const seen = new Set();
  const opts = [];
  _dailyOpenProjectRows.forEach((r) => {
    const lb = (r._main_label || '').trim() || '(분류 없음)';
    const code = String(r._main_code || '');
    const key = `${code}|${lb}`;
    if (seen.has(key)) return;
    seen.add(key);
    opts.push({ value: code, text: lb });
  });
  opts.sort((a, b) => a.text.localeCompare(b.text));
  sel.innerHTML = '<option value="">전체</option>';
  opts.forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.text;
    sel.appendChild(opt);
  });
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

async function _entryLoadDailyOpenProjects() {
  _dailyOpenProjectRows = [];
  try {
    const [rows, types] = await Promise.all([
      API.listAllPages('registered_projects', { limit: 500, maxPages: 10, sort: 'created_at', filter: 'registration_status=eq.approved' }),
      API.listAllPages('project_code_types', { limit: 500, maxPages: 5, sort: 'main_code' }),
    ]);
    const typeById = {};
    (types || []).forEach((t) => { if (t && t.id) typeById[t.id] = t; });
    (rows || []).forEach((r) => {
      if (!_entryRegisteredProjectOngoing(r)) return;
      const typ = r.project_code_type_id && typeById[r.project_code_type_id];
      const mc = typ ? (typ.main_code || '') : '';
      const mcat = typ ? (typ.main_category || '') : '';
      const mlabel = typ ? `${mcat || ''} (${mc || ''})`.trim() : '';
      _dailyOpenProjectRows.push({
        ...r,
        _main_label: mlabel || '(분류 없음)',
        _main_code: mc,
        _main_cat: mcat,
      });
    });
    _dailyOpenProjectRows.sort((a, b) => String(a.project_code || '').localeCompare(String(b.project_code || '')));
  } catch (e) {
    console.warn('[entry] open projects', e);
  }
  _entryInitProjectClientFilterFromRows();
  await _entryFillDailyProjMainFilter();
  _entryRefreshDailyProjectList();
}

function _syncEntrySheetTypeBadge() {
  const el = document.getElementById('entry-sheet-type-badge');
  if (!el) return;
  el.textContent = entryFormSheetType() === 'daily' ? '일일 시트' : '시간제 시트';
  el.style.display = 'inline-flex';
}

/** 시간제: 시작·종료 datetime / 일일: 시간 단위면 동일 UI(투입 단위 바로 아래로 DOM 이동), 일 단위면 날짜 구간 */
function syncEntrySheetTimeRowUI() {
  const daily = entryFormSheetType() === 'daily';
  const mode = _entryEffectiveInputMode();
  const hourlyRow = document.getElementById('entry-row-hourly-datetime');
  const mountH = document.getElementById('entry-hourly-mount-hourly');
  const mountD = document.getElementById('entry-hourly-mount-daily');
  const modeWrap = document.getElementById('entry-daily-period-mode-wrap');
  const hintEl = document.getElementById('entry-daily-period-hint');
  const batchWrap = document.getElementById('entry-batch-mode-wrap');
  const durationWrap = (document.getElementById('entry-duration') || {}).parentElement || null;
  if (modeWrap) modeWrap.style.display = daily ? '' : 'none';
  if (hintEl) hintEl.style.display = (daily && mode !== 'by_batch') ? '' : 'none';
  if (hourlyRow && mountH && mountD) {
    if (daily && mode === 'by_hour') mountD.appendChild(hourlyRow);
    else mountH.appendChild(hourlyRow);
  }
  const dailyRow = document.getElementById('entry-row-daily-fields');
  const startEl = document.getElementById('entry-start');
  const endEl = document.getElementById('entry-end');
  const fromEl = document.getElementById('entry-daily-from');
  const toEl = document.getElementById('entry-daily-to');
  const wDay = document.getElementById('entry-daily-period-day-wrap');
  const workDateEl = document.getElementById('entry-work-date');
  const workDateWrap = document.getElementById('entry-work-date-wrap');
  if (hourlyRow) hourlyRow.style.display = (mode === 'by_hour') ? 'grid' : 'none';
  if (dailyRow) dailyRow.style.display = daily ? 'block' : 'none';
  if (wDay) wDay.style.display = (daily && mode === 'by_day_span') ? '' : 'none';
  if (batchWrap) batchWrap.style.display = mode === 'by_batch' ? 'flex' : 'none';
  if (durationWrap) durationWrap.style.display = mode === 'by_batch' ? 'none' : '';
  if (mode === 'by_batch') _entryBatchApplyResponsiveLayout();
  if (workDateWrap) workDateWrap.style.display = (!daily || mode === 'by_hour') ? '' : 'none';
  if (startEl) {
    if (mode === 'by_hour') startEl.setAttribute('required', 'required');
    else startEl.removeAttribute('required');
  }
  if (endEl) {
    if (mode === 'by_hour') endEl.setAttribute('required', 'required');
    else endEl.removeAttribute('required');
  }
  if (fromEl) {
    if (daily && mode === 'by_day_span') fromEl.setAttribute('required', 'required');
    else fromEl.removeAttribute('required');
  }
  if (toEl) {
    if (daily && mode === 'by_day_span') toEl.setAttribute('required', 'required');
    else toEl.removeAttribute('required');
  }
  if (workDateEl) {
    if (!daily || mode === 'by_hour') workDateEl.setAttribute('required', 'required');
    else workDateEl.removeAttribute('required');
  }
  _syncDailyPeriodModeToggleUI();
  _entryBatchToggleMetaByMode(mode);
}

/** 일일 시트·일 단위: 투입 시작~종료일 → 저장용 datetime-local + 일수×8h 소요시간 */
function applyDailyPeriodFromInput() {
  if (entryFormSheetType() !== 'daily' || _entryDailyEffectivePeriodMode() !== 'by_day_span') return;
  const fromEl = document.getElementById('entry-daily-from');
  const toEl = document.getElementById('entry-daily-to');
  const hidDate = document.getElementById('entry-work-date');
  const startEl = document.getElementById('entry-start');
  const endEl = document.getElementById('entry-end');
  const text = document.getElementById('duration-text');
  const display = document.getElementById('duration-display');
  if (!startEl || !endEl) return;
  const d0 = fromEl && fromEl.value;
  const d1 = toEl && toEl.value;
  if (hidDate && d0) hidDate.value = d0;
  if (!d0 || !d1) {
    startEl.value = '';
    endEl.value = '';
    if (text) {
      text.textContent = '투입 시작일·종료일을 선택하세요.';
    }
    _clearDurationInput();
    syncActualDuration();
    return;
  }
  if (d0 > d1) {
    if (text) text.textContent = '투입 종료일이 시작일보다 빠를 수 없습니다.';
    startEl.value = '';
    endEl.value = '';
    _clearDurationInput();
    syncActualDuration();
    return;
  }
  startEl.value = `${d0} 00:00`;
  endEl.value = `${d1} 23:59`;
  const days = _entryInclusiveCalendarDays(d0, d1);
  const mins = days > 0 ? days * 480 : 0;
  if (text) {
    text.textContent = days > 0
      ? `일 단위: ${days}일 × 8시간 = ${typeof Utils !== 'undefined' && Utils.formatDurationLong ? Utils.formatDurationLong(mins) : `${mins}분`} (소요시간에 반영)`
      : '투입 시작일·종료일을 선택하세요.';
  }
  if (display) {
    display.style.borderColor = '#bbf7d0';
    display.style.background  = '#f0fdf4';
    display.style.color       = '#15803d';
  }
  if (mins > 0) _setDurationInput(mins);
  else _clearDurationInput();
  syncActualDuration();
  clearTimeout(_overlapWarnTimer);
  const prevWarn = document.getElementById('overlap-warn-banner');
  if (prevWarn) prevWarn.remove();
}

function onDailyPeriodChange() {
  if (entryFormSheetType() !== 'daily') return;
  applyDailyPeriodFromInput();
}

/** @deprecated 호환용 — 일일 기간 동기화로 위임 */
function applyDailyWorkDateFromInput() {
  applyDailyPeriodFromInput();
}

function onDailyWorkDateChange() {
  onDailyPeriodChange();
}

function _entryUsesTimeOnlyInputs() {
  return !(entryFormSheetType() === 'daily' && _entryDailyEffectivePeriodMode() !== 'by_hour');
}

function _entryNormTimeText(raw) {
  const v = String(raw || '').trim().replace(/\s+/g, '');
  if (!v) return '';
  let h = null;
  let m = null;
  if (/^\d{1,2}$/.test(v)) {
    h = parseInt(v, 10);
    m = 0;
  } else if (/^\d{3,4}$/.test(v)) {
    const hh = v.length === 3 ? v.substring(0, 1) : v.substring(0, 2);
    const mm = v.slice(-2);
    h = parseInt(hh, 10);
    m = parseInt(mm, 10);
  } else if (/^\d{1,2}:\d{1,2}$/.test(v)) {
    const [hh, mm] = v.split(':');
    h = parseInt(hh, 10);
    m = parseInt(mm, 10);
  } else {
    return '';
  }
  if (!Number.isInteger(h) || !Number.isInteger(m)) return '';
  if (h < 0 || h > 23 || m < 0 || m > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 배치 행 시간 입력 파싱: "9", "930", "09:30", "1400" → { h, m } or null
function _entryBatchParseHHmm(raw) {
  const hhmm = _entryNormTimeText(raw);
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return { h, m, hhmm };
}

// 시작시간 + 소요시간(분) + 날짜 prefix → { fromAt, toAt, overDay, endHHmm } or null
function _entryBatchCalcEnd(startRaw, durationMin, datePrefix) {
  const parsed = _entryBatchParseHHmm(startRaw);
  if (!parsed) return null;
  const dur = Math.max(10, Math.min(480, Number(durationMin) || 30));
  const startMin = parsed.h * 60 + parsed.m;
  const endMin = startMin + dur;
  const overDay = endMin > 1440;
  const fromAt = `${datePrefix}T${parsed.hhmm}`;
  let toAt;
  let endHHmm;
  if (overDay) {
    const d = new Date(`${datePrefix}T00:00`);
    d.setDate(d.getDate() + 1);
    const nd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const eh = Math.floor((endMin - 1440) / 60);
    const em = (endMin - 1440) % 60;
    endHHmm = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    toAt = `${nd}T${endHHmm}`;
  } else {
    const eh = Math.floor(endMin / 60);
    const em = endMin % 60;
    endHHmm = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
    toAt = `${datePrefix}T${endHHmm}`;
  }
  return { fromAt, toAt, overDay, endHHmm, startHHmm: parsed.hhmm, durationMin: dur };
}

function _entryResolveWorkDate() {
  const el = document.getElementById('entry-work-date');
  const v = String(el && el.value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (el) el.value = ymd;
  return ymd;
}

function _entryParseDateTimeInput(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d) || !Number.isInteger(h) || !Number.isInteger(mi)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  const yy = String(y).padStart(4, '0');
  const mm = String(mo).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  const hh = String(h).padStart(2, '0');
  const mmi = String(mi).padStart(2, '0');
  return {
    display: `${yy}-${mm}-${dd} ${hh}:${mmi}`,
    iso: `${yy}-${mm}-${dd}T${hh}:${mmi}`,
  };
}

function _entryNormalizeDateTimeField(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  const raw = String(el.value || '').trim();
  const parsed = _entryParseDateTimeInput(raw);
  if (parsed) {
    if (_entryUsesTimeOnlyInputs()) {
      const datePart = parsed.iso.slice(0, 10);
      const timePart = parsed.iso.slice(11, 16);
      const wd = document.getElementById('entry-work-date');
      if (wd) wd.value = datePart;
      el.value = timePart;
    } else {
      el.value = parsed.display;
    }
    return parsed.iso;
  }
  const hm = _entryNormTimeText(raw);
  if (!hm) return '';
  el.value = hm;
  const ymd = _entryResolveWorkDate();
  return `${ymd}T${hm}`;
}

// ─────────────────────────────────────────────
// 타임시트 등록 초기화
// ─────────────────────────────────────────────
async function init_entry_new() {
  // ★ 수정 모드에서 navigateTo가 자동 재호출하는 경우 차단
  if (_editMode) { _editMode = false; return; }

  const session = getSession();
  const isCeoSession = !!(
    (Auth.isCeo && Auth.isCeo(session)) ||
    String(session?.email || '').trim().toLowerCase() === 'hshan@hjcustoms.co.kr' ||
    String(session?.name || '').trim() === '한휘선' ||
    String(session?.job_title || '').trim().toLowerCase() === 'ceo'
  );
  if (!Auth.canWriteEntry(session) && !isCeoSession) {
    if (Auth.isManager(session) && session.is_timesheet_target === false) {
      navigateTo('dashboard');
      Toast.warning('타임시트 대상자로 지정되지 않았습니다. 관리자에게 요청하세요.');
      return;
    }
    if (!Auth.isStaff(session) && !Auth.isManager(session)) {
      navigateTo('dashboard');
      Toast.warning('타임시트 작성 권한이 없습니다.');
      return;
    }
    // 승인자 미지정 staff 조기 차단
    if (Auth.isStaff(session) && !Auth.hasApprover(session)) {
      navigateTo('archive');
      Toast.warning('승인자가 지정되지 않아 타임시트를 작성할 수 없습니다. 관리자에게 승인자 지정을 요청하세요.');
      return;
    }
  }

  if (entryFormSheetType() === 'daily') {
    if (!Auth.timesheetDailyEnabled(session) && !isCeoSession) {
      navigateTo('dashboard');
      Toast.warning('현재 소속은 Daily 대상이 아니거나 타임시트 작성 대상이 아닙니다. 사업부/대상자 설정을 확인하세요.');
      return;
    }
  } else if (!Auth.timesheetHourlyEnabled(session) && !isCeoSession) {
    navigateTo('dashboard');
    Toast.warning('현재 소속은 Hourly 대상이 아니거나 타임시트 작성 대상이 아닙니다. 사업부/대상자 설정을 확인하세요.');
    return;
  }

  _syncEntrySheetTypeBadge();

  // 신규 등록: 초기화
  _editEntryId  = null;
  _pendingFiles = [];
  _currentCategoryType = ''; // 대분류 미선택 상태로 초기화
  _entryBatchRows = [];
  _entryBatchSelectedRowIdx = -1;
  _entryBatchTimelineDate = '';
  _entryBatchTimelineDrag = null;
  document.getElementById('fileList').innerHTML = '';

  // form 태그 제거로 .reset() 대신 필드를 직접 초기화
  const _resetFormFields = () => {
    const subReset = document.getElementById('entry-subcategory');
    if (subReset) {
      subReset.innerHTML = '<option value="">소분류 선택</option>';
      subReset.selectedIndex = 0;
    }
    ['entry-category','entry-subcategory','entry-team','entry-client',
     'entry-start','entry-end','entry-work-date','entry-daily-from','entry-daily-to',
     'entry-work-location','entry-duration',
     'kw-query-hidden','law-refs-hidden','kw-reason-hidden'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (id === 'entry-subcategory') return; // 위에서 옵션 전체 초기화함
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = el.id === 'law-refs-hidden' ? '[]' : '';
    });
    _entryClearDailyProjectPick();
    const ft = document.getElementById('entry-daily-proj-filter-text');
    if (ft) ft.value = '';
    const mf = document.getElementById('entry-daily-proj-filter-main');
    if (mf) mf.innerHTML = '<option value="">전체</option>';
    const modeSel = document.getElementById('entry-daily-period-mode-select');
    if (modeSel) modeSel.value = entryFormSheetType() === 'daily' ? 'by_day_span' : 'by_hour';
    if (typeof ClientSearchSelect !== 'undefined') {
      try { ClientSearchSelect.clear('entry-daily-proj-client-wrap'); } catch (_) {}
    }
    _dailyOpenProjectListFiltered = [];
    const plist = document.getElementById('entry-daily-project-list');
    if (plist) plist.innerHTML = '';
    const batchBody = document.getElementById('entry-batch-rows-body');
    if (batchBody) batchBody.innerHTML = '<div style="padding:12px;text-align:center;color:#64748b;font-size:12px">행 추가 버튼으로 업무를 입력하세요.</div>';
  };
  _resetFormFields();
  _entrySyncDailyProjectShowAllBtn();
  document.getElementById('entry-duration').value = '';
  _clearDurationInput(); // 실제 소요시간 시간·분 입력란 초기화
  syncEntrySheetTimeRowUI();
  if (entryFormSheetType() === 'daily') {
    const t = new Date();
    const ymd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    const df = document.getElementById('entry-daily-from');
    const dto = document.getElementById('entry-daily-to');
    if (df) df.value = ymd;
    if (dto) dto.value = ymd;
    onDailyPeriodModeChange();
  } else {
    const wd = document.getElementById('entry-work-date');
    if (wd && !wd.value) {
      const t = new Date();
      wd.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    }
    onDailyPeriodModeChange();
    if (_entryEffectiveInputMode() !== 'by_batch') {
      document.getElementById('duration-text').textContent = '시작/종료 시간을 입력하면 자동 계산됩니다.';
      calcDuration();
    }
  }
  document.getElementById('entry-user-name').value = session.name;

  // Quill 에디터 초기화 (최초 1회 생성, 이후 리셋만)
  // 표 전용 contenteditable 잔여 표시/플래그 제거 — 신규·수정 폼 모두 Quill 기준으로 시작
  _initQuill();
  entrySwitchToQuill();
  _setEntryPasteGuideText(false);

  // URL 입력란 초기화
  const mfn = document.getElementById('manual-file-name');
  const mfu = document.getElementById('manual-file-url');
  if (mfn) mfn.value = '';
  if (mfu) mfu.value = '';

  // 자문 분류 초기화
  _clearKwTags('kw-query');
  _clearKwTags('kw-reason');
  _clearLawRefs();
  _entryUpdateExampleTags();

  // 메모란 초기화
  const memoEl = document.getElementById('entry-memo');
  if (memoEl) memoEl.value = '';

  // law_master 캐시 (미리 로드)
  _ensureLawMaster();
  // 고객사명 캐시 워밍업 (파일 업로드 시 마스킹에 사용, 오류 무시)
  _loadClientNamesForMask().catch(() => {});

  try {
    const [teams, clients, categories, subcategories] = await Promise.all([
      Master.teams(), Master.clients(), Master.categories(), Master.subcategories()
    ]);
    _entryBatchClientRows = Array.isArray(clients) ? clients : [];

    _allCategories    = categories;
    _allSubcategories = subcategories;

    // 대분류 드롭다운
    const catEl = document.getElementById('entry-category');
    const subEl = document.getElementById('entry-subcategory');
    // 마스터 로딩(await) 도중 사용자가 이전 화면에 남아 있던 옵션으로 선택한 경우,
    // innerHTML 재구성 시 선택값이 통째로 사라져 저장 시 catId/subId가 비는 문제가 생김 → 유효하면 복원
    const preserveCatId = (catEl.value || '').trim();
    const preserveSubId = (subEl && subEl.value || '').trim();

    const catsForForm = entryFormSheetType() === 'daily'
      ? categories.filter((c) => ENTRY_DAILY_CATEGORY_ALLOW.includes(String(c.category_name || '').trim()))
      : categories;

    catEl.innerHTML = '<option value="">대분류 선택</option>';
    catsForForm.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.category_name;
      opt.dataset.type = c.category_type || 'client';
      catEl.appendChild(opt);
    });

    const catOk = preserveCatId && catsForForm.some((c) => String(c.id) === String(preserveCatId));
    if (catOk) {
      catEl.value = preserveCatId;
      await onCategoryChange();
      if (preserveSubId && subEl) {
        const subOk = _allSubcategories.some(s =>
          String(s.id) === String(preserveSubId) && String(s.category_id) === String(preserveCatId));
        if (subOk) subEl.value = preserveSubId;
      }
    } else if (subEl) {
      subEl.innerHTML = '<option value="">소분류 선택</option>';
      _currentCategoryType = '';
    }

    // 팀 드롭다운 (타임시트 작성 시 직접 선택 — 직원 프로필에서 자동선택 제거)
    await fillSelect('entry-team', teams, 'id', 'team_name', '팀 선택');

    // ★ 고객사 검색형 선택 초기화
    ClientSearchSelect.init('entry-client-wrap', clients, {
      placeholder: '고객사 검색/선택...',
      onSelect: (id, name) => {
        document.getElementById('entry-client').value = id;
      }
    });
    document.getElementById('entry-client').value = '';

    ClientSearchSelect.init('entry-daily-proj-client-wrap', [], {
      placeholder: '고객명으로 필터…',
      onSelect: () => { _entryRefreshDailyProjectList(); },
    });
    ClientSearchSelect.clear('entry-daily-proj-client-wrap');

    if (entryFormSheetType() === 'daily') {
      const modeSel = document.getElementById('entry-daily-period-mode-select');
      if (modeSel) modeSel.value = 'by_day_span';
      onDailyPeriodModeChange();
      await _entryLoadDailyOpenProjects();
    }

    // 고객 섹션 초기 상태
    updateClientSection();
    if (_entryEffectiveInputMode() === 'by_batch') {
      // 첫 진입은 기본행 1건만 렌더링하고, 자동 임시저장은 실행하지 않는다.
      // (기존 임시저장 데이터가 기본행으로 덮어써지는 문제 방지)
      _entryBatchRows = [_entryBatchRowDefault()];
      _entryBatchSelectedRowIdx = 0;
      _entryBatchTimelineDate = '';
      _entryBatchRenderRows();
      try {
        if (localStorage.getItem(ENTRY_BATCH_LOCAL_KEY)
          || localStorage.getItem('entry_batch_rows')
          || localStorage.getItem('entry_batch_rows_v0')) {
          _entryBatchAutosaveState('임시저장 있음 (복구 버튼)');
        }
      } catch (_) {}
    } else {
      _entryBatchRenderRows();
    }

    // ── 승인자 배너 ──────────────────────────────
    try {
      const userRecord       = await API.get('users', session.id);
      const approverNotice   = document.getElementById('entry-approver-notice');
      const noApproverNotice = document.getElementById('entry-no-approver-notice');
      const approverNameText = document.getElementById('entry-approver-name-text');
      const noApproverSpan   = noApproverNotice ? noApproverNotice.querySelector('span') : null;

      const isManager = session.role === 'manager';

      if (isManager) {
        // Manager → reviewer2_id(본부장/사업부장) 유무로 판단
        const reviewer2Id   = (userRecord && userRecord.reviewer2_id)   || session.reviewer2_id   || '';
        const reviewer2Name = (userRecord && userRecord.reviewer2_name) || session.reviewer2_name || '';
        if (reviewer2Id) {
          approverNameText.textContent   = '2차 승인자: ' + (reviewer2Name || '지정됨');
          approverNotice.style.display   = 'flex';
          noApproverNotice.style.display = 'none';
        } else {
          if (noApproverSpan) noApproverSpan.textContent = '2차 승인자(본부장/사업부장)가 지정되지 않았습니다.';
          approverNotice.style.display   = 'none';
          noApproverNotice.style.display = 'flex';
        }
      } else {
        // Staff → approver_id(Manager) 유무로 판단
        const approverId   = (userRecord && userRecord.approver_id)   || session.approver_id   || '';
        const approverName = (userRecord && userRecord.approver_name) || session.approver_name || '';
        if (approverId) {
          approverNameText.textContent   = approverName || '승인자 지정됨';
          approverNotice.style.display   = 'flex';
          noApproverNotice.style.display = 'none';
        } else {
          if (noApproverSpan) noApproverSpan.textContent = '승인자가 지정되지 않았습니다.';
          approverNotice.style.display   = 'none';
          noApproverNotice.style.display = 'flex';
        }
      }
    } catch { /* 배너 표시 실패 무시 */ }

  } catch (err) {
    console.error(err);
    Toast.error('데이터 로드 실패');
  }
}

// ─────────────────────────────────────────────
// 대분류 변경 → 소분류 필터, 고객 섹션 토글
// ─────────────────────────────────────────────

/**
 * 시간제·프로젝트업무: 소분류 = project_code_types의 **대분류만** (값: pcmake:대분류코드, 표시: 대분류명).
 * work_subcategories 일반 소분류는 드롭다운에 넣지 않습니다.
 */
async function _entryFillHourlyProjectSubcategoryFromProjectTypes() {
  const subEl = document.getElementById('entry-subcategory');
  if (!subEl) return;
  await _entryEnsureProjectCodeTypes();
  const uniq = new Map();
  (_entryProjectCodeTypeRows || []).forEach((r) => {
    const mc = String(r.main_code || '').trim();
    const mcat = String(r.main_category || '').trim();
    if (!mc || !mcat || uniq.has(mc)) return;
    uniq.set(mc, mcat);
  });
  const rows = [...uniq.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'ko'));
  rows.forEach(([mainCode, mainCat]) => {
    const opt = document.createElement('option');
    opt.value = `pcmain:${mainCode}`;
    opt.textContent = mainCat;
    opt.dataset.mainCode = mainCode;
    opt.dataset.mainCategory = mainCat;
    subEl.appendChild(opt);
  });
  if (!rows.length) {
    try {
      Toast.warning('등록된 프로젝트 Code 대분류가 없습니다. Settings → 프로젝트 Code 관리에서 대분류를 등록하세요.');
    } catch (_) {}
  }
}

/** 시간제·프로젝트업무: 소분류(프로젝트 대분류) 선택 → 프로젝트 목록의 대분류 필터 동기화 */
function _entrySyncHourlyProjectSubcategoryToProjectMainFilter() {
  const subEl = document.getElementById('entry-subcategory');
  const sel = document.getElementById('entry-daily-proj-filter-main');
  if (!subEl || !sel) return;
  const opt = subEl.options[subEl.selectedIndex];
  let mc = (opt && opt.dataset && opt.dataset.mainCode) ? String(opt.dataset.mainCode).trim() : '';
  if (!mc && opt && opt.value && _entryFilterIsProjectMainValue(opt.value)) {
    mc = _entryFilterProjectMainCode(opt.value);
  }
  if (mc && [...sel.options].some((o) => String(o.value) === mc)) sel.value = mc;
  else sel.value = '';
  try { _entryRefreshDailyProjectList(); } catch (_) {}
}

async function onCategoryChange() {
  const catEl = document.getElementById('entry-category');
  const selectedOpt = catEl.options[catEl.selectedIndex];
  const catId  = catEl.value;
  const catType = selectedOpt ? selectedOpt.dataset.type : 'client';
  _currentCategoryType = catType || 'client';
  const catNm = (selectedOpt && selectedOpt.textContent) ? selectedOpt.textContent.trim() : '';
  if (entryFormSheetType() === 'daily') {
    if (catNm === '일반자문업무') _currentCategoryType = 'client';
    else if (catNm === '프로젝트업무' || catNm === '회사내부업무') _currentCategoryType = 'internal';
  }

  const subs = _allSubcategories.filter(s => String(s.category_id) === String(catId));
  const subEl = document.getElementById('entry-subcategory');
  subEl.innerHTML = '<option value="">소분류 선택</option>';
  if (catNm === '프로젝트업무' && entryFormSheetType() !== 'daily') {
    await _entryFillHourlyProjectSubcategoryFromProjectTypes();
  } else {
    subs.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.sub_category_name;
      subEl.appendChild(opt);
    });
  }

  if (entryFormSheetType() === 'daily' && catNm === '프로젝트업무' && subEl.options.length > 1) {
    let picked = false;
    for (let i = 0; i < subEl.options.length; i++) {
      if ((subEl.options[i].textContent || '').trim() === '기타') {
        subEl.selectedIndex = i;
        picked = true;
        break;
      }
    }
    if (!picked) subEl.selectedIndex = 1;
  }

  if (catNm === '프로젝트업무' && entryFormSheetType() !== 'daily') {
    _entrySyncHourlyProjectSubcategoryToProjectMainFilter();
  }

  updateClientSection();
  _entryUpdateExampleTags();
  if (entryFormSheetType() === 'daily') {
    const eff = _entryDailyEffectivePeriodMode();
    if (eff === 'by_day_span') applyDailyPeriodFromInput();
    else calcDuration();
  }
}

function updateClientSection() {
  if (_entryEffectiveInputMode && _entryEffectiveInputMode() === 'by_batch') {
    const metaPanel = document.querySelector('.entry-panel-meta');
    const descPanel = document.querySelector('.entry-panel-desc');
    const filePanel = document.getElementById('filePanel');
    const kwSection = document.getElementById('kwSection');
    const clientSection = document.getElementById('clientSection');
    const memoSection = document.getElementById('internalMemoSection');
    const teamRow = document.getElementById('entry-team-row');
    if (metaPanel) metaPanel.classList.add('span-full');
    if (descPanel) descPanel.style.display = 'none';
    if (filePanel) filePanel.style.display = 'none';
    if (kwSection) kwSection.style.display = 'none';
    if (clientSection) clientSection.style.display = 'none';
    if (memoSection) memoSection.style.display = 'none';
    if (teamRow) teamRow.style.display = 'none';
    return;
  }
  const isClient   = _currentCategoryType === 'client';
  const isInternal = _currentCategoryType === 'internal';
  const isNone     = !_currentCategoryType; // 대분류 미선택
  const catEl = document.getElementById('entry-category');
  const catName = catEl?.options?.[catEl.selectedIndex]?.textContent || '';
  const catNameTrim = catName.trim();
  const isClearance = catNameTrim === '일반통관업무';
  const isCompanyInternal = catNameTrim === '회사내부업무';
  const isDaily = entryFormSheetType() === 'daily';
  const isProject = catNameTrim === '프로젝트업무';
  const isDailyProject = isDaily && isProject;
  const isDailyInternalCo = isDaily && isCompanyInternal;
  /** hourly/daily 공통: ②③④는 「일반자문업무」일 때만 */
  const showFourConsultPanels = catNameTrim === '일반자문업무';

  const metaPanel      = document.querySelector('.entry-panel-meta');
  const descPanel      = document.querySelector('.entry-panel-desc');
  const filePanel      = document.getElementById('filePanel');
  const kwSection      = document.getElementById('kwSection');
  const clientSection  = document.getElementById('clientSection');
  const attachRequired = document.getElementById('attachRequired');
  const attachOptional = document.getElementById('attachOptional');
  const memoSection    = document.getElementById('internalMemoSection');
  const teamRow        = document.getElementById('entry-team-row');
  const teamEl         = document.getElementById('entry-team');
  const dpWrap         = document.getElementById('entry-daily-project-work-wrap');
  const memoTitle      = document.getElementById('entry-memo-title');
  const memoOpt        = document.getElementById('entry-memo-optional');
  const memoReq        = document.getElementById('entry-memo-required');
  const memoTa         = document.getElementById('entry-memo');

  const hideDailyProjWrap = () => {
    if (dpWrap) dpWrap.style.display = 'none';
    const locWrap = document.getElementById('entry-daily-work-location-wrap');
    if (locWrap) locWrap.style.display = 'none';
  };

  // 회사내부: 팀 숨김 / 프로젝트업무(시간제·일일): 팀·Staff 숨김(작성자·프로젝트로 식별)
  const hideTeamRow = (isCompanyInternal && !isDailyProject) || isDailyProject || isProject;
  if (teamRow) teamRow.style.display = hideTeamRow ? 'none' : '';
  if (hideTeamRow && teamEl) {
    if (isCompanyInternal && !isDailyProject) teamEl.value = '';
    if (isProject) teamEl.value = '';
    try { teamEl.removeAttribute('required'); } catch (_) {}
  } else if (teamEl) {
    try { teamEl.setAttribute('required', ''); } catch (_) {}
  }

  const resetMemoChrome = () => {
    if (memoTitle) memoTitle.textContent = '수행 내용 메모';
    if (memoOpt) memoOpt.style.display = '';
    if (memoReq) memoReq.style.display = 'none';
    if (memoTa) {
      memoTa.removeAttribute('required');
      memoTa.placeholder = '수행한 업무 내용을 간략히 메모하세요.';
    }
  };

  if (isNone) {
    if (metaPanel)  { metaPanel.classList.add('span-full'); }
    if (descPanel)  descPanel.style.display = 'none';
    if (filePanel)  { filePanel.style.display = 'none'; filePanel.classList.remove('span-full'); }
    if (kwSection)  kwSection.style.display  = 'none';
    if (clientSection) clientSection.style.display = 'none';
    if (attachRequired) attachRequired.style.display = 'none';
    if (attachOptional) attachOptional.style.display = 'none';
    if (memoSection) memoSection.style.display = 'none';
    hideDailyProjWrap();
    resetMemoChrome();

  } else if (showFourConsultPanels) {
    if (metaPanel)  metaPanel.classList.remove('span-full');
    if (descPanel)  descPanel.style.display = '';
    if (filePanel)  { filePanel.style.display = ''; filePanel.classList.remove('span-full'); }
    if (kwSection)  kwSection.style.display  = '';
    if (clientSection) clientSection.style.display = '';
    if (attachRequired) attachRequired.style.display = '';
    if (attachOptional) attachOptional.style.display = 'none';
    if (memoSection) memoSection.style.display = 'none';
    hideDailyProjWrap();
    resetMemoChrome();

  } else if (isProject && isDaily) {
    if (metaPanel) metaPanel.classList.add('span-full');
    if (descPanel) descPanel.style.display = 'none';
    if (filePanel) { filePanel.style.display = 'none'; filePanel.classList.remove('span-full'); }
    if (kwSection) kwSection.style.display = 'none';
    if (clientSection) clientSection.style.display = 'none';
    if (attachRequired) attachRequired.style.display = 'none';
    if (attachOptional) attachOptional.style.display = 'none';
    if (memoSection) memoSection.style.display = '';
    if (memoTitle) memoTitle.textContent = '수행 내역';
    if (memoOpt) memoOpt.style.display = 'none';
    if (memoReq) memoReq.style.display = '';
    if (memoTa) {
      memoTa.setAttribute('required', 'required');
      memoTa.placeholder = '프로젝트 수행 내역을 간단히 입력하세요.';
    }
    if (dpWrap) {
      dpWrap.style.display = 'block';
      if (!_dailyOpenProjectRows.length) _entryLoadDailyOpenProjects().catch(() => {});
    }
    const locWrapProj = document.getElementById('entry-daily-work-location-wrap');
    if (locWrapProj) locWrapProj.style.display = '';

  } else if (isProject && !isDaily) {
    if (metaPanel) metaPanel.classList.add('span-full');
    if (descPanel) descPanel.style.display = 'none';
    if (filePanel) { filePanel.style.display = 'none'; filePanel.classList.remove('span-full'); }
    if (kwSection) kwSection.style.display = 'none';
    if (clientSection) clientSection.style.display = 'none';
    if (attachRequired) attachRequired.style.display = 'none';
    if (attachOptional) attachOptional.style.display = 'none';
    if (memoSection) memoSection.style.display = '';
    if (memoTitle) memoTitle.textContent = '수행 내역';
    if (memoOpt) memoOpt.style.display = 'none';
    if (memoReq) memoReq.style.display = '';
    if (memoTa) {
      memoTa.setAttribute('required', 'required');
      memoTa.placeholder = '프로젝트 수행 내역을 간단히 입력하세요.';
    }
    if (dpWrap) {
      dpWrap.style.display = 'block';
      const afterProjList = () => {
        try { _entrySyncHourlyProjectSubcategoryToProjectMainFilter(); } catch (_) {}
      };
      if (!_dailyOpenProjectRows.length) {
        _entryLoadDailyOpenProjects().then(afterProjList).catch(() => {});
      } else {
        _entryFillDailyProjMainFilter().then(afterProjList).catch(afterProjList);
      }
    }
    const locWrapProjH = document.getElementById('entry-daily-work-location-wrap');
    if (locWrapProjH) locWrapProjH.style.display = '';

  } else {
    if (metaPanel)  metaPanel.classList.add('span-full');
    if (descPanel)  descPanel.style.display = 'none';
    if (filePanel)  { filePanel.style.display = 'none'; filePanel.classList.remove('span-full'); }
    if (kwSection)  kwSection.style.display  = 'none';
    if (clientSection) clientSection.style.display = isClearance ? '' : 'none';
    if (attachRequired) attachRequired.style.display = 'none';
    if (attachOptional) attachOptional.style.display = 'none';
    if (memoSection) memoSection.style.display = '';
    hideDailyProjWrap();
    if (isDailyInternalCo) {
      if (memoTitle) memoTitle.textContent = '수행 내역';
      if (memoOpt) memoOpt.style.display = 'none';
      if (memoReq) memoReq.style.display = '';
      if (memoTa) {
        memoTa.setAttribute('required', 'required');
        memoTa.placeholder = '수행 내역을 입력하세요.';
      }
    } else {
      resetMemoChrome();
    }
  }

  _entrySyncDailyProjectSubGrid(catNameTrim, isDailyProject, isCompanyInternal);
  if (isDaily) syncEntrySheetTimeRowUI();
}

/** 일일·프로젝트업무: 소분류 열 숨김 + 팀 자동선택 */
function _entryAutofillTeamFromSession() {
  const teamEl = document.getElementById('entry-team');
  if (!teamEl || teamEl.options.length < 2) return;
  let session = null;
  try { session = typeof getSession === 'function' ? getSession() : null; } catch (_) {}
  if (!session) return;
  const cand = [session.team_name, session.cs_team_name].map((s) => String(s || '').trim()).filter(Boolean);
  for (const name of cand) {
    for (let i = 0; i < teamEl.options.length; i++) {
      const o = teamEl.options[i];
      const tn = (o.textContent || '').trim();
      if (tn && name && (tn === name || tn.includes(name) || name.includes(tn))) {
        teamEl.value = o.value;
        return;
      }
    }
  }
}

function _entrySyncDailyProjectSubGrid(catNameTrim, isDailyProject, isCompanyInternal) {
  const grid = document.getElementById('entry-cat-sub-grid');
  const subWrap = document.getElementById('entry-subcategory-col-wrap');
  const subEl = document.getElementById('entry-subcategory');
  if (!grid || !subWrap) return;
  if (entryFormSheetType() === 'daily' && isDailyProject) {
    subWrap.style.display = 'none';
    grid.style.gridTemplateColumns = '1fr';
    if (subEl) subEl.removeAttribute('required');
    _entryAutofillTeamFromSession();
    return;
  }
  subWrap.style.display = '';
  grid.style.gridTemplateColumns = '1fr 1fr';
  const catEl = document.getElementById('entry-category');
  if (subEl && catEl && catEl.value) subEl.setAttribute('required', 'required');
}

// ─── 소분류 변경 → 자문자료실과 동일 예시 태그 칩 ──────────────
function onSubcategoryChange() {
  const catEl = document.getElementById('entry-category');
  const catNm = (catEl && catEl.selectedIndex >= 0)
    ? String(catEl.options[catEl.selectedIndex]?.textContent || '').trim()
    : '';
  if (entryFormSheetType() !== 'daily' && catNm === '프로젝트업무') {
    _entrySyncHourlyProjectSubcategoryToProjectMainFilter();
  }
  _entryUpdateExampleTags();
}

/** Entry wrap에 올라간 kw/reason 태그 텍스트 목록 */
function _entryGetKwTagValues(ns) {
  const wrap = document.getElementById(ns + '-wrap');
  if (!wrap) return [];
  return Array.from(wrap.querySelectorAll('span[data-value]')).map(s => s.dataset.value);
}

/** 소분류 기준 예시 칩·placeholder 갱신 (KwExampleMaps 공통) */
function _entryUpdateExampleTags() {
  const kwAreaEarly     = document.getElementById('entry-kw-example-area');
  const reasonAreaEarly = document.getElementById('entry-reason-example-area');
  if (_currentCategoryType !== 'client') {
    if (kwAreaEarly) kwAreaEarly.style.display = 'none';
    if (reasonAreaEarly) reasonAreaEarly.style.display = 'none';
    return;
  }
  if (typeof KwExampleMaps === 'undefined' || !KwExampleMaps.resolveExamples) return;

  const subEl = document.getElementById('entry-subcategory');
  const subTxt = subEl && subEl.value
    ? (subEl.options[subEl.selectedIndex]?.text || '').trim()
    : '';
  const { kw: kwEx, reason: reasonEx } = KwExampleMaps.resolveExamples(subTxt);
  const selectedKw = _entryGetKwTagValues('kw-query');
  const selectedRe = _entryGetKwTagValues('kw-reason');

  const kwCont     = document.getElementById('entry-kw-examples');
  const reasonCont = document.getElementById('entry-reason-examples');
  const kwArea     = kwAreaEarly;
  const reasonArea = reasonAreaEarly;

  if (kwCont) {
    kwCont.innerHTML = kwEx.map(t => {
      const escaped  = Utils.escHtml(t);
      const safeCall = t.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const isUsed   = selectedKw.includes(t) ? ' arch-ex-tag--used' : '';
      return `<button type="button" class="arch-ex-tag${isUsed}" onclick="_entryClickExTag('kw','${safeCall}',this)">${escaped}</button>`;
    }).join('');
  }
  if (reasonCont) {
    reasonCont.innerHTML = reasonEx.map(t => {
      const escaped  = Utils.escHtml(t);
      const safeCall = t.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const isUsed   = selectedRe.includes(t) ? ' arch-ex-tag--green arch-ex-tag--used' : ' arch-ex-tag--green';
      return `<button type="button" class="arch-ex-tag${isUsed}" onclick="_entryClickExTag('reason','${safeCall}',this)">${escaped}</button>`;
    }).join('');
  }

  const kwInput = document.getElementById('kw-query-input');
  const reasonInput = document.getElementById('kw-reason-input');
  if (kwInput) {
    const kwFirst = kwEx[0] || '키워드';
    kwInput.placeholder = `예) ${kwFirst} · Enter로 태그 추가`;
  }
  if (reasonInput) {
    const rFirst = reasonEx[0] || '판단사유';
    reasonInput.placeholder = `예) ${rFirst} · Enter로 태그 추가`;
  }

  if (kwArea) kwArea.style.display = kwEx.length ? 'flex' : 'none';
  if (reasonArea) reasonArea.style.display = reasonEx.length ? 'flex' : 'none';
}

function _entryClickExTag(type, val, btn) {
  if (type === 'kw') _addKwTag('kw-query', val);
  else _addKwTag('kw-reason', val);
  if (btn) {
    btn.classList.add('arch-ex-tag--used');
    if (type === 'reason') btn.classList.add('arch-ex-tag--green');
  }
  _entryUpdateExampleTags();
}

// ════════════════════════════════════════════════════
//  자문 분류 정보 — 태그 입력 (kw_query / kw_reason)
//  ※ kwSection은 <form> 밖에 배치되어 있으므로
//    Enter 키가 form submit을 트리거하지 않음.
//    이벤트는 모두 JS addEventListener로만 등록.
// ════════════════════════════════════════════════════

/** kwSection 이벤트 초기화 — 단 1회 실행 */
function _initKwEvents() {
  // 핵심키워드
  const qInput  = document.getElementById('kw-query-input');
  const qAddBtn = document.getElementById('kw-query-add-btn');
  // 판단사유
  const rInput  = document.getElementById('kw-reason-input');
  const rAddBtn = document.getElementById('kw-reason-add-btn');
  // 관련법령
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

// DOM 준비 완료 후 이벤트 등록 (단 1회)
// ※ JS 파일이 </body> 직전에 로드되므로 DOMContentLoaded는 이미 발생한 뒤.
//   document.readyState 체크 후 즉시 실행 또는 로드 완료 후 실행.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initKwEvents);
} else {
  _initKwEvents(); // 이미 DOM 준비됨 → 즉시 실행
}

/** 태그 추가 핵심 함수 */
function _kwAdd(ns) {
  const wrap = document.getElementById(ns + '-wrap');
  const inp  = wrap ? wrap.querySelector('input[type="text"]') : null;
  if (!inp) return;
  const val = inp.value.trim();
  if (!val) return;
  _addKwTag(ns, val);
  inp.value = '';
  inp.focus();
}

/** 하위 호환 — HTML onkeydown에서 직접 호출 시 (이번 버전부터 미사용) */
function kwTagKeydown(e, ns) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  _kwAdd(ns);
}
function _kwAddBtnClick(ns) { _kwAdd(ns); }

/** 태그 span 생성 & wrap에 삽입 */
function _addKwTag(ns, text) {
  const wrap = document.getElementById(ns + '-wrap');
  if (!wrap || !text) return;

  // 중복 체크
  const existing = Array.from(wrap.querySelectorAll('span[data-value]'))
                        .map(s => s.dataset.value);
  if (existing.includes(text)) return;

  const inp = wrap.querySelector('input[type="text"]');
  const tag = document.createElement('span');
  tag.dataset.value = text;
  tag.style.cssText = 'display:inline-flex;align-items:center;gap:4px;'
    + 'background:#e0e7ff;color:#3730a3;border-radius:6px;'
    + 'padding:3px 9px;font-size:12px;font-weight:500;white-space:nowrap';

  const label = document.createTextNode(text);
  const btn   = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '×';
  btn.style.cssText = 'background:none;border:none;cursor:pointer;'
    + 'color:#6366f1;padding:0;font-size:14px;line-height:1;margin-left:2px';
  btn.addEventListener('click', function() {
    tag.remove();
    _syncKwHidden(ns);
    if ((ns === 'kw-query' || ns === 'kw-reason') && _currentCategoryType === 'client') {
      _entryUpdateExampleTags();
    }
  });

  tag.appendChild(label);
  tag.appendChild(btn);

  // input 앞에 삽입 (없으면 append)
  if (inp) { wrap.insertBefore(tag, inp); }
  else     { wrap.appendChild(tag); }

  _syncKwHidden(ns);
  if ((ns === 'kw-query' || ns === 'kw-reason') && _currentCategoryType === 'client') {
    _entryUpdateExampleTags();
  }
}

function _removeKwTag(btn, ns) {
  btn.parentElement.remove();
  _syncKwHidden(ns);
}

function _syncKwHidden(ns) {
  const wrap = document.getElementById(ns + '-wrap');
  if (!wrap) return;
  const tags = Array.from(wrap.querySelectorAll('span[data-value]'))
                    .map(s => s.dataset.value);
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

// ════════════════════════════════════════════════════
//  관련법령 (law_refs) — 검색 드롭다운 + 태그
// ════════════════════════════════════════════════════

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

  const hits = _lawMasterCache.filter(l =>
    (l.full_name || l.law_name || '').toLowerCase().includes(q.toLowerCase())
  );

  if (!hits.length) { dd.style.display = 'none'; return; }

  const typeLabel = { law: '법', decree: '시행령', rule: '시행규칙', notice: '고시' };
  dd.innerHTML = hits.slice(0, 12).map((l, i) => {
    const tl = typeLabel[l.law_type] || l.law_type || '';
    return `<div data-idx="${i}" data-name="${Utils.escHtml(l.law_name)}" data-fullname="${Utils.escHtml(l.full_name||l.law_name)}"
      style="padding:7px 12px;font-size:13px;cursor:pointer;border-bottom:1px solid #f1f5f9"
      onmousedown="_pickLawDropdown(this)" onmouseover="_hoverLawDd(this)">
      <span style="font-weight:500">${Utils.escHtml(l.law_name)}</span>
      ${tl ? `<span style="font-size:10px;background:#f1f5f9;color:#64748b;border-radius:3px;padding:0 5px;margin-left:5px">${tl}</span>` : ''}
    </div>`;
  }).join('');
  _lawDropdownIdx = -1;
  dd.style.display = 'block';
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
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addLawRef(); }
    return;
  }
  const items = Array.from(dd.querySelectorAll('[data-idx]'));
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _lawDropdownIdx = Math.min(_lawDropdownIdx + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _lawDropdownIdx = Math.max(_lawDropdownIdx - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault(); e.stopPropagation();
    if (_lawDropdownIdx >= 0 && items[_lawDropdownIdx]) {
      _pickLawDropdown(items[_lawDropdownIdx]);
    } else {
      addLawRef();
    }
    return;
  } else if (e.key === 'Escape') {
    dd.style.display = 'none'; return;
  } else { return; }
  items.forEach((it, i) => it.style.background = i === _lawDropdownIdx ? '#e0e7ff' : '');
}

function addLawRef() {
  const lawInp = document.getElementById('law-search-input');
  const artInp = document.getElementById('law-article-input');
  const dd     = document.getElementById('law-dropdown');
  if (!lawInp) return;

  const law  = (lawInp.value || '').trim();
  if (!law) { Toast.warning('법령명을 입력하세요.'); lawInp.focus(); return; }
  const article = (artInp ? artInp.value : '').trim();

  _addLawRefTag(law, article);
  lawInp.value = '';
  if (artInp) artInp.value = '';
  if (dd) dd.style.display = 'none';
}

function _addLawRefTag(law, article) {
  const container = document.getElementById('law-refs-tags');
  if (!container) return;
  const label = article ? `${law} ${article}` : law;
  const idx   = container.querySelectorAll('[data-law]').length;

  const tag = document.createElement('span');
  tag.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#ede9fe;color:#5b21b6;border-radius:6px;padding:3px 9px;font-size:12px;font-weight:500;white-space:nowrap;margin-right:4px;margin-bottom:4px';
  tag.dataset.law     = law;
  tag.dataset.article = article;
  tag.innerHTML = `<i class="fas fa-balance-scale" style="font-size:10px"></i>${Utils.escHtml(label)}<button type="button" onclick="_removeLawRefTag(this)" style="background:none;border:none;cursor:pointer;color:#7c3aed;padding:0;font-size:12px;line-height:1;margin-left:2px">&times;</button>`;
  container.appendChild(tag);
  _syncLawRefsHidden();
}

function _removeLawRefTag(btn) {
  btn.parentElement.remove();
  _syncLawRefsHidden();
}

function _syncLawRefsHidden() {
  const container = document.getElementById('law-refs-tags');
  const hid = document.getElementById('law-refs-hidden');
  if (!container || !hid) return;
  const arr = Array.from(container.querySelectorAll('[data-law]')).map(t => ({
    law:     t.dataset.law,
    article: t.dataset.article || ''
  }));
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
    if (typeof arr === 'string') {
      try { arr = JSON.parse(arr); } catch { arr = []; }
    } else { arr = []; }
  }
  arr.forEach(r => _addLawRefTag(r.law || '', r.article || ''));
}

/** document 클릭 시 드롭다운 닫기 */
document.addEventListener('click', e => {
  const dd = document.getElementById('law-dropdown');
  const inp = document.getElementById('law-search-input');
  if (dd && inp && !inp.contains(e.target) && !dd.contains(e.target)) {
    dd.style.display = 'none';
  }
}, true);

// ─────────────────────────────────────────────
// ★ 시간 겹침 체크
// ─────────────────────────────────────────────
/**
 * 본인의 기존 타임시트와 시간이 겹치는지 확인
 * @param {number} newStart  - 새 업무 시작 timestamp(ms)
 * @param {number} newEnd    - 새 업무 종료 timestamp(ms)
 * @param {string} excludeId - 수정 모드 시 자기 자신 entry id (제외)
 * @returns {{ overlap: boolean, conflict: object|null }}
 */
async function checkTimeOverlap(newStart, newEnd, excludeId = '') {
  try {
    const session = getSession();
    const uid = encodeURIComponent(String(session.id));
    const entries = await API.listAllPages('time_entries', {
      filter: `user_id=eq.${uid}`,
      sort: 'updated_at',
      limit: 400,
      maxPages: 80,
    });

    // 본인 것만(서버 필터), 삭제 안 된 것만, 수정 시 자신 제외
    const mine = entries.filter(e =>
      !e.deleted &&
      String(e.id) !== String(excludeId || '') &&
      e.work_start_at && e.work_end_at
    );

    for (const e of mine) {
      const eStart = Number(e.work_start_at);
      const eEnd   = Number(e.work_end_at);
      // 겹침 조건: newStart < eEnd AND newEnd > eStart
      if (newStart < eEnd && newEnd > eStart) {
        return { overlap: true, conflict: e };
      }
    }
    return { overlap: false, conflict: null };
  } catch {
    return { overlap: false, conflict: null }; // 오류 시 통과
  }
}

/**
 * 겹침 오류 메시지 포맷
 */
function _overlapMessage(conflict, newStart, newEnd) {
  const fmt = (ts) => {
    const d = new Date(Number(ts));
    const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const hm  = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    return { ymd, hm };
  };
  const cs = fmt(conflict.work_start_at);
  const ce = fmt(conflict.work_end_at);
  const ns = fmt(newStart);
  const ne = fmt(newEnd);
  const clientLabel = conflict.client_name || '내부업무';
  const subLabel    = conflict.work_subcategory_name || conflict.work_category_name || '-';
  return [
    `[${cs.ymd}] ${cs.hm} ~ ${ce.hm}`,
    `${clientLabel} / ${subLabel}`,
    `와(과) 시간이 겹칩니다.`,
    `(입력: ${ns.ymd} ${ns.hm} ~ ${ne.hm})`
  ].join('\n');
}

// ─────────────────────────────────────────────
// 소요시간 자동 계산 + 실시간 겹침 경고
// ─────────────────────────────────────────────
let _overlapWarnTimer = null; // 디바운스용

async function calcDuration() {
  if (entryFormSheetType() === 'daily' && _entryDailyEffectivePeriodMode() !== 'by_hour') {
    applyDailyWorkDateFromInput();
    return;
  }
  const start   = _entryNormalizeDateTimeField('entry-start');
  const end     = _entryNormalizeDateTimeField('entry-end');
  const minutes = Utils.calcDurationMinutes(start, end);
  const display = document.getElementById('duration-display');
  const text    = document.getElementById('duration-text');
  const hidden  = document.getElementById('entry-duration');

  // 기존 겹침 경고 배너 제거
  const prevWarn = document.getElementById('overlap-warn-banner');
  if (prevWarn) prevWarn.remove();

  if (minutes > 0) {
    // ① 참고값 표시 (시작~종료 자동 계산)
    text.textContent  = '참고: 시작~종료 기준 ' + Utils.formatDurationLong(minutes);
    display.style.borderColor = '#bbf7d0';
    display.style.background  = '#f0fdf4';
    display.style.color       = '#15803d';

    // ② 실제 소요시간 입력란에 자동 계산값을 기본값으로 세팅
    //    (사용자가 이미 수동 입력한 경우엔 덮어쓰지 않음)
    _setDurationInputIfEmpty(minutes);

    // ③ hidden 동기화
    syncActualDuration();

    // ④ 실시간 겹침 체크 (디바운스 300ms) — 경고만, 차단 없음
    clearTimeout(_overlapWarnTimer);
    _overlapWarnTimer = setTimeout(async () => {
      const newStart = new Date(start).getTime();
      const newEnd   = new Date(end).getTime();
      const { overlap, conflict } = await checkTimeOverlap(newStart, newEnd, _editEntryId || '');
      if (overlap && conflict) {
        _showOverlapBanner(conflict, newStart, newEnd, false); // 항상 경고만(노란색)
      }
    }, 300);

  } else if (start && end) {
    text.textContent  = '⚠️ 종료시간이 시작시간보다 빠릅니다.';
    display.style.borderColor = 'var(--danger)';
    display.style.background  = 'var(--danger-bg)';
    display.style.color       = '';
    hidden.value = '';
  } else {
    text.textContent  = '시작/종료 시간을 입력하면 자동 계산됩니다.';
    display.style.borderColor = '#bbf7d0';
    display.style.background  = '#f0fdf4';
    display.style.color       = '#15803d';
    hidden.value = '';
  }
}

/**
 * 실제 소요시간 입력란(시간·분) → hidden entry-duration(분) 동기화
 * HTML oninput="syncActualDuration()" 에서 호출
 */
function syncActualDuration() {
  const hEl = document.getElementById('entry-duration-h');
  const mEl = document.getElementById('entry-duration-m');
  const hidden = document.getElementById('entry-duration');
  if (!hEl || !mEl || !hidden) return;

  const h = parseInt(hEl.value) || 0;
  const m = parseInt(mEl.value) || 0;
  const total = h * 60 + m;
  hidden.value = total > 0 ? total : '';
}

/**
 * 실제 소요시간 입력란이 비어있을 때만 자동 계산값으로 채움
 * (사용자가 이미 수동 수정한 경우 덮어쓰지 않음)
 */
function _setDurationInputIfEmpty(minutes) {
  const hEl = document.getElementById('entry-duration-h');
  const mEl = document.getElementById('entry-duration-m');
  if (!hEl || !mEl) return;
  // 비어있을 때만 채움
  if (!hEl.value && !mEl.value) {
    hEl.value = Math.floor(minutes / 60);
    mEl.value = minutes % 60;
  }
}

/**
 * 실제 소요시간 입력란을 특정 분(minutes) 값으로 강제 세팅
 * (편집 모드 복원, 초기화 등에서 사용)
 */
function _setDurationInput(minutes) {
  const hEl = document.getElementById('entry-duration-h');
  const mEl = document.getElementById('entry-duration-m');
  if (!hEl || !mEl) return;
  hEl.value = Math.floor(minutes / 60);
  mEl.value = minutes % 60;
  syncActualDuration();
}

/**
 * 실제 소요시간 입력란 초기화 (신규 등록 시)
 */
function _clearDurationInput() {
  const hEl = document.getElementById('entry-duration-h');
  const mEl = document.getElementById('entry-duration-m');
  if (hEl) hEl.value = '';
  if (mEl) mEl.value = '';
  const hidden = document.getElementById('entry-duration');
  if (hidden) hidden.value = '';
}

/**
 * 겹침 경고 배너를 소요시간 표시 아래에 삽입
 * @param {boolean} isBlocking - true: 저장 차단 오류 / false: 실시간 경고
 */
function _showOverlapBanner(conflict, newStart, newEnd, isBlocking) {
  // 기존 배너 제거
  const prev = document.getElementById('overlap-warn-banner');
  if (prev) prev.remove();

  const fmt = (ts) => {
    const d = new Date(Number(ts));
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  const fmtDate = (ts) => {
    const d = new Date(Number(ts));
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  const cDate  = fmtDate(conflict.work_start_at);
  const cStart = fmt(conflict.work_start_at);
  const cEnd   = fmt(conflict.work_end_at);
  const nStart = fmt(newStart);
  const nEnd   = fmt(newEnd);
  const clientLabel = conflict.client_name || '내부업무';
  const subLabel    = conflict.work_subcategory_name || conflict.work_category_name || '-';

  const banner = document.createElement('div');
  banner.id = 'overlap-warn-banner';
  banner.style.cssText = [
    'margin-top:8px',
    'background:#fffbeb',
    'border:1px solid #fde68a',
    'border-radius:8px',
    'padding:10px 14px',
    'font-size:12px',
    'line-height:1.7',
    'color:#1e293b',
    'display:flex',
    'gap:10px',
    'align-items:flex-start',
  ].join(';');

  banner.innerHTML = `
    <i class="fas fa-exclamation-triangle"
       style="color:#f59e0b;margin-top:2px;flex-shrink:0"></i>
    <div>
      <div style="font-weight:700;margin-bottom:3px;color:#92400e">
        ⚠️ 시간이 겹치는 업무가 있습니다
      </div>
      <div style="color:#475569">
        기존: <b>[${cDate}] ${cStart} ~ ${cEnd}</b>
        &nbsp;·&nbsp; ${clientLabel} / ${subLabel}
      </div>
      <div style="color:#64748b;margin-top:2px">
        입력: ${fmtDate(newStart)} ${nStart} ~ ${nEnd}
      </div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px dashed #fde68a;color:#92400e;font-size:11px">
        💡 두 업무의 실제 소요시간 합계가 전체 시간을 초과하지 않는지 확인하고,<br>
        필요 시 각 업무의 <b>실제 소요시간을 직접 수정</b>해 주세요.
      </div>
    </div>`;

  // 소요시간 display 바로 아래에 삽입
  const display = document.getElementById('duration-display');
  if (display && display.parentNode) {
    display.parentNode.insertBefore(banner, display.nextSibling);
  }
}

// ─────────────────────────────────────────────
// ★ 파일 → Base64 변환 (FileReader)
// ─────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result); // "data:mime;base64,AAAA..."
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────
// 파일 드래그&드롭 / 선택 처리
// ─────────────────────────────────────────────
function onDragOver(e)  { e.preventDefault(); document.getElementById('fileDropZone').classList.add('dragover'); }
function onDragLeave(e) { document.getElementById('fileDropZone').classList.remove('dragover'); }
function onFileDrop(e) {
  e.preventDefault();
  document.getElementById('fileDropZone').classList.remove('dragover');
  addFiles(Array.from(e.dataTransfer.files));
}
function onFileSelect(e) {
  addFiles(Array.from(e.target.files));
  e.target.value = '';
}

// ─────────────────────────────────────────────
// ★ 파일 추가 — Base64 변환 + 텍스트 추출·마스킹
// ─────────────────────────────────────────────
async function addFiles(files) {
  for (const file of files) {
    const type = Utils.getFileType(file.name);
    if (!type) {
      Toast.warning(`${file.name}: 허용되지 않은 파일 형식 (Excel/Word/PPT/PDF만 가능)`);
      continue;
    }

    // 10 MB 초과 → 거부
    if (file.size > FILE_MAX_BYTES) {
      Toast.error(`${file.name}: 파일 크기(${Utils.formatFileSize(file.size)})가 10MB를 초과합니다.\nGoogle Drive 링크 등록을 이용해 주세요.`);
      continue;
    }

    // 7 MB 초과 경고 (저장은 허용)
    if (file.size > FILE_WARN_BYTES) {
      Toast.warning(`${file.name}: 파일이 큽니다(${Utils.formatFileSize(file.size)}). 저장 속도가 느릴 수 있습니다.`);
    }

    // ── 진행 표시 (변환·추출 중) ─────────────────
    const progressId = `prog_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    _pendingFiles.push({
      file, type, docType: '', summary: '',
      fileUrl: '', fileName: file.name,
      content: null, sizeKB: Math.round(file.size / 1024),
      uploadMode: 'base64', _id: progressId, _loading: true,
      extractedText: null, extractStatus: '',
    });
    renderFileList();

    try {
      // ① Base64 변환
      const base64 = await fileToBase64(file);

      // ② 텍스트 추출
      const { text: rawText, status: extStatus } = await _extractTextFromFile(file);

      // ③ 마스킹
      let maskedText = null;
      if (rawText) {
        maskedText = await _maskSensitiveText(rawText);
      }

      // ④ _pendingFiles 업데이트
      const idx = _pendingFiles.findIndex(p => p._id === progressId);
      if (idx !== -1) {
        _pendingFiles[idx].content       = base64;
        _pendingFiles[idx]._loading      = false;
        _pendingFiles[idx].extractedText = maskedText;
        _pendingFiles[idx].extractStatus = extStatus;
      }

      // ⑤ 추출 결과 토스트
      if (extStatus === 'ok' && maskedText) {
        Toast.success(`✅ ${file.name}: 텍스트 자동 추출 및 마스킹 완료 (${maskedText.length.toLocaleString()}자)`);
      } else if (extStatus === 'scan_pdf') {
        Toast.warning(`⚠️ ${file.name}: 스캔된 PDF로 감지됨. 수동 요약 입력을 권장합니다.`);
      } else if (extStatus === 'ppt') {
        Toast.warning(`⚠️ ${file.name}: PPT 파일은 PDF로 변환 후 업로드해주세요.`);
      } else if (extStatus === 'error') {
        Toast.warning(`⚠️ ${file.name}: 텍스트 추출 중 오류가 발생했습니다.`);
      }

    } catch (err) {
      const idx = _pendingFiles.findIndex(p => p._id === progressId);
      if (idx !== -1) _pendingFiles.splice(idx, 1);
      Toast.error(`${file.name}: 파일 읽기 실패`);
    }

    renderFileList();
  }
}

// ─────────────────────────────────────────────
// URL 직접 등록 (Google Drive / OneDrive 등)
// ─────────────────────────────────────────────
function addFileByUrl() {
  const nameEl = document.getElementById('manual-file-name');
  const urlEl  = document.getElementById('manual-file-url');
  const typeEl = document.getElementById('manual-file-type');
  const name   = nameEl.value.trim();
  const url    = urlEl.value.trim();
  const type   = typeEl.value;

  if (!name) { Toast.warning('파일명을 입력하세요.'); return; }
  if (!url)  { Toast.warning('파일 URL을 입력하세요.'); return; }
  if (!url.startsWith('http')) { Toast.warning('올바른 URL을 입력하세요. (http:// 또는 https://)'); return; }

  _pendingFiles.push({
    file: null, type, docType: '', summary: '',
    fileUrl: url, fileName: name,
    content: null, sizeKB: 0,
    uploadMode: 'url', _id: `url_${Date.now()}`, _loading: false,
  });
  nameEl.value = '';
  urlEl.value  = '';
  renderFileList();
  Toast.success('파일 링크가 추가되었습니다.');
}

// ─────────────────────────────────────────────
// ★ 파일 목록 렌더링 — 상태/모드별 UI
// ─────────────────────────────────────────────
function renderFileList() {
  const list = document.getElementById('fileList');
  if (_pendingFiles.length === 0) { list.innerHTML = ''; return; }

  const icons  = { excel:'fa-file-excel', word:'fa-file-word', ppt:'fa-file-powerpoint', pdf:'fa-file-pdf', link:'fa-link' };
  const colors = { excel:'#16a34a', word:'#1d4ed8', ppt:'#c2410c', pdf:'#b91c1c', link:'#7c3aed' };
  const docTypes = ['보고서', '회의록', '의견서', '검토의견서', '기타'];

  list.innerHTML = _pendingFiles.map((pf, i) => {
    const name     = pf.file ? pf.file.name : (pf.fileName || '이름 없음');
    const isUrl    = pf.uploadMode === 'url';
    const isLoading = pf._loading;

    // 상태 표시
    let statusBadge = '';
    if (isLoading) {
      statusBadge = `<span style="background:#fef9c3;color:#92400e;border:1px solid #fde68a;border-radius:5px;padding:2px 8px;font-size:11px;display:inline-flex;align-items:center;gap:4px">
        <i class="fas fa-spinner fa-spin" style="font-size:10px"></i> 추출 중...
      </span>`;
    } else if (isUrl) {
      statusBadge = `<span style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:5px;padding:2px 8px;font-size:11px;display:inline-flex;align-items:center;gap:4px">
        <i class="fas fa-link" style="font-size:10px"></i> 링크
      </span>`;
    } else if (pf.content) {
      statusBadge = `<span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:5px;padding:2px 8px;font-size:11px;display:inline-flex;align-items:center;gap:4px">
        <i class="fas fa-check-circle" style="font-size:10px"></i> 저장가능 · ${pf.sizeKB}KB
      </span>`;
    }

    // 추출 상태 배지
    let extractBadge = '';
    if (!isLoading && !isUrl) {
      if (pf.extractStatus === 'ok' && pf.extractedText) {
        extractBadge = `<span style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:5px;padding:2px 8px;font-size:11px;display:inline-flex;align-items:center;gap:4px">
          <i class="fas fa-shield-alt" style="font-size:10px"></i> 텍스트 추출·마스킹 완료 (${pf.extractedText.length.toLocaleString()}자)
        </span>`;
      } else if (pf.extractStatus === 'scan_pdf') {
        extractBadge = `<span style="background:#fffbeb;color:#b45309;border:1px solid #fde68a;border-radius:5px;padding:2px 8px;font-size:11px;display:inline-flex;align-items:center;gap:4px">
          <i class="fas fa-exclamation-triangle" style="font-size:10px"></i> 스캔 PDF — 수동 요약 권장
        </span>`;
      } else if (pf.extractStatus === 'ppt') {
        extractBadge = `<span style="background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;border-radius:5px;padding:2px 8px;font-size:11px;display:inline-flex;align-items:center;gap:4px">
          <i class="fas fa-exclamation-triangle" style="font-size:10px"></i> PPT → PDF 변환 후 업로드 권장
        </span>`;
      } else if (pf.extractStatus === 'error') {
        extractBadge = `<span style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:5px;padding:2px 8px;font-size:11px;display:inline-flex;align-items:center;gap:4px">
          <i class="fas fa-times-circle" style="font-size:10px"></i> 텍스트 추출 실패
        </span>`;
      }
    }

    // 파일 크기/링크 메타
    let meta = '';
    if (!isLoading) {
      if (isUrl) {
        meta = `<a href="${pf.fileUrl}" target="_blank" style="color:#2563eb;font-size:11px;word-break:break-all">
          <i class="fas fa-external-link-alt"></i> 링크 열기
        </a>`;
      } else if (pf.sizeKB > 0) {
        meta = `<span style="font-size:11px;color:var(--text-muted)">${Utils.formatFileSize(pf.sizeKB * 1024)}</span>`;
      }
    }

    // 추출 텍스트 확인/추출하기 버튼 (업무기록 화면 파일 목록용)
    let extractActionBtn = '';
    if (!isLoading && !isUrl) {
      if (pf.extractStatus === 'ok' && pf.extractedText) {
        extractActionBtn = `<button class="btn btn-sm btn-outline" onclick="_showPendingExtractedText(${i})"
          style="white-space:nowrap;color:#6d28d9;border-color:#c4b5fd;font-size:11px;padding:2px 8px;height:auto">
          <i class="fas fa-shield-alt"></i> 추출 텍스트 확인</button>`;
      }
    }

    return `
    <div class="file-item" style="${isLoading ? 'opacity:0.65;' : ''}">
      <i class="fas ${icons[pf.type]||'fa-file'} file-icon" style="color:${colors[pf.type]||'#666'}"></i>
      <div class="file-info" style="flex:1;min-width:0">
        <div class="file-name" style="word-break:break-all;font-weight:500">${name}</div>
        <div class="file-meta" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:3px">
          ${statusBadge}
          ${extractBadge}
          ${extractActionBtn}
          ${meta}
        </div>
      </div>
      <select style="font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:5px;margin-right:6px;flex-shrink:0"
        onchange="_pendingFiles[${i}].docType=this.value" ${isLoading ? 'disabled' : ''}>
        <option value="">문서유형</option>
        ${docTypes.map(t => `<option value="${t}" ${pf.docType === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <button class="btn-remove" onclick="_pendingFiles.splice(${i},1);renderFileList()" title="제거">
        <i class="fas fa-times"></i>
      </button>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════
//  파일 텍스트 추출 + 민감정보 마스킹
// ════════════════════════════════════════════════════

/**
 * 업무기록 화면 파일 목록에서 추출 텍스트 확인 (pendingFiles[i].extractedText)
 * renderFileList()의 onclick에서 호출
 */
function _showPendingExtractedText(idx) {
  const pf = _pendingFiles[idx];
  if (!pf || !pf.extractedText) { Toast.warning('추출된 텍스트가 없습니다.'); return; }

  const fakeAtt = {
    file_name:      pf.file ? pf.file.name : (pf.fileName || '파일'),
    extracted_text: pf.extractedText,
  };
  _openExtractedTextModal(fakeAtt);
}

/** 고객사명 캐시 (앱 초기화 시 로딩, 이후 재사용) */
let _clientNamesCache = null;

/**
 * 고객사명 목록 로딩 (캐시 우선)
 * @returns {Promise<string[]>}
 */
async function _loadClientNamesForMask() {
  if (_clientNamesCache !== null) return _clientNamesCache;
  try {
    const res = await API.list('clients', { limit: 500 });
    _clientNamesCache = ((res && res.data) ? res.data : [])
      .map(c => (c.company_name || '').trim())
      .filter(Boolean);
  } catch {
    _clientNamesCache = []; // 실패 시 빈 배열 (정규식만 사용)
  }
  return _clientNamesCache;
}

/** 마스킹 패턴 (순서 중요: 구체적인 것 먼저) */
const MASK_PATTERNS = [
  { re: /USD\s*[\d,]+|US\$[\d,]+|\$[\d,]+/gi,              label: '[금액(USD)]' },
  { re: /￦[\d,]+|KRW\s*[\d,]+/gi,                          label: '[금액(원화)]' },
  { re: /[\d,]+\s*(달러|원|천원|만원|억원|백만원)/gi,         label: '[금액]' },
  { re: /\d{5}-\d{2}-\d{6}[A-Z]/g,                          label: '[수입신고번호]' },
];

/**
 * 텍스트에서 민감정보를 마스킹 처리
 * @param {string} text
 * @returns {Promise<string>}
 */
async function _maskSensitiveText(text) {
  if (!text) return text;
  let result = text;

  // 1. 정규식 마스킹
  for (const { re, label } of MASK_PATTERNS) {
    result = result.replace(new RegExp(re.source, re.flags), label);
  }

  // 2. 고객사명 마스킹
  const clientNames = await _loadClientNamesForMask();
  for (const name of clientNames) {
    if (!name) continue;
    // 대소문자 무시, 전역 치환
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'gi'), '[고객사명]');
  }

  return result;
}

/**
 * 파일에서 텍스트 추출 (PDF.js / mammoth / SheetJS)
 * @param {File} file
 * @returns {Promise<{text: string|null, status: 'ok'|'scan_pdf'|'ppt'|'error'|'unsupported'}>}
 */
async function _extractTextFromFile(file) {
  const name = file.name.toLowerCase();
  const ext  = name.split('.').pop();

  // PPT — 직접 추출 불가
  if (ext === 'pptx' || ext === 'ppt') {
    return { text: null, status: 'ppt' };
  }

  // PDF
  if (ext === 'pdf') {
    try {
      await LibLoader.load('pdfjs');
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page    = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += `\n--- 페이지 ${i} ---\n${pageText}`;
      }
      const trimmed = fullText.trim();
      // 스캔 PDF 판별: 전체 텍스트 10자 미만
      if (trimmed.length < 10) {
        return { text: null, status: 'scan_pdf' };
      }
      return { text: trimmed, status: 'ok' };
    } catch (err) {
      console.warn('[extractText] PDF 추출 오류:', err);
      return { text: null, status: 'error' };
    }
  }

  // Word (.docx / .doc)
  if (ext === 'docx' || ext === 'doc') {
    try {
      await LibLoader.load('mammoth');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const trimmed = (result.value || '').trim();
      return { text: trimmed || null, status: 'ok' };
    } catch (err) {
      console.warn('[extractText] Word 추출 오류:', err);
      return { text: null, status: 'error' };
    }
  }

  // Excel (.xlsx / .xls)
  if (ext === 'xlsx' || ext === 'xls') {
    try {
      await LibLoader.load('xlsx');
      const arrayBuffer = await file.arrayBuffer();
      const workbook    = XLSX.read(arrayBuffer, { type: 'array' });
      let fullText = '';
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv   = XLSX.utils.sheet_to_csv(sheet);
        fullText += `\n[시트명: ${sheetName}]\n${csv}`;
      }
      const trimmed = fullText.trim();
      return { text: trimmed || null, status: 'ok' };
    } catch (err) {
      console.warn('[extractText] Excel 추출 오류:', err);
      return { text: null, status: 'error' };
    }
  }

  // 지원하지 않는 형식
  return { text: null, status: 'unsupported' };
}

// ════════════════════════════════════════════════════
//  민감정보 자동 감지 (수행내용·자문분류 팝업용)
// ════════════════════════════════════════════════════

/** 감지 패턴 정의 */
const SENSITIVE_PATTERNS = [
  { name: '금액(USD)',    pattern: /USD\s*[\d,]+|US\$[\d,]+|\$[\d,]+/gi },
  { name: '금액(원화)',   pattern: /￦[\d,]+|KRW\s*[\d,]+/gi },
  { name: '금액(한글단위)', pattern: /[\d,]+\s*(달러|원|천원|만원|억원|백만원)/gi },
  { name: '수입신고번호', pattern: /\d{5}-\d{2}-\d{6}[A-Z]/g }
];

/**
 * 본문 텍스트에서 민감정보를 감지해 결과 배열 반환
 * @param {string} text - 검사할 평문 텍스트
 * @returns {Promise<Array<{type:string, value:string}>>}
 */
async function _detectSensitiveInfo(text) {
  const results = [];
  const seen    = new Set(); // 중복 제거용

  // ── 방식 1: 정규식 감지 ──────────────────────────────
  for (const { name, pattern } of SENSITIVE_PATTERNS) {
    // flags 포함 새 RegExp로 복사 (lastIndex 초기화)
    const re = new RegExp(pattern.source, pattern.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const key = `${name}::${m[0]}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ type: name, value: m[0] });
      }
    }
  }

  // ── 방식 2: 고객 DB 감지 ──────────────────────────────
  try {
    const res     = await API.list('clients', { limit: 500 });
    const clients = (res && res.data) ? res.data : [];
    const lowerText = text.toLowerCase();

    for (const c of clients) {
      const name = (c.company_name || '').trim();
      if (!name) continue;
      if (lowerText.includes(name.toLowerCase())) {
        const key = `고객사명::${name}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ type: '고객사명', value: name });
        }
      }
    }
  } catch {
    // 고객 DB 로드 실패 시 정규식 결과만 사용 (오류 무시)
  }

  return results;
}

/**
 * 민감정보 경고 팝업 표시
 * @param {Array<{type:string, value:string}>} results - 감지 결과
 * @param {Function} onProceed - [저장 진행] 클릭 시 콜백
 */
function _showSensitiveWarning(results, onProceed) {
  const modal   = document.getElementById('sensitiveWarnModal');
  const list    = document.getElementById('sensitiveWarnList');
  const editBtn = document.getElementById('sensitiveWarnEditBtn');
  const procBtn = document.getElementById('sensitiveWarnProceedBtn');
  if (!modal || !list) return;

  // 감지 항목 목록 렌더링
  list.innerHTML = results.map(r => `
    <li style="display:flex;align-items:baseline;gap:8px;
               background:#fffbeb;border:1px solid #fde68a;
               border-radius:7px;padding:7px 12px;font-size:12px">
      <span style="color:#f59e0b;font-size:13px;flex-shrink:0">•</span>
      <span>
        <span style="font-weight:700;color:#92400e;min-width:90px;
                     display:inline-block">${Utils.escHtml(r.type)}</span>
        <span style="color:#475569">${Utils.escHtml(r.value)}</span>
      </span>
    </li>`).join('');

  // [수정하기] — 팝업 닫고 에디터 포커스
  editBtn.onclick = () => {
    modal.classList.remove('show');
    if (_quill) _quill.focus();
  };

  // [저장 진행] — 팝업 닫고 저장 콜백 실행
  procBtn.onclick = () => {
    modal.classList.remove('show');
    onProceed();
  };

  modal.classList.add('show');
}

// ─────────────────────────────────────────────
// 제출 / 임시저장
// ─────────────────────────────────────────────
async function submitEntry(e) {
  e.preventDefault();
  await saveEntry('submitted');
}
async function saveEntryDraft() {
  await saveEntry('draft');
}

function _entryBatchNormalizeRows(rows) {
  const out = (rows || [])
    .map((r) => ({ ...r }))
    .filter((r) => r && r.from_at && r.to_at)
    .sort((a, b) => new Date(a.from_at).getTime() - new Date(b.from_at).getTime());
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    const ps = new Date(prev.from_at).getTime();
    const pe = new Date(prev.to_at).getTime();
    const cs = new Date(cur.from_at).getTime();
    const ce = new Date(cur.to_at).getTime();
    if (!Number.isFinite(ps) || !Number.isFinite(pe) || !Number.isFinite(cs) || !Number.isFinite(ce)) continue;
    if (pe <= cs) continue;
    if (pe > ce) {
      const tail = { ...prev, from_at: _entryBatchToInputValue(ce), to_at: prev.to_at };
      tail.duration_minutes = _entryBatchMinutes(tail.from_at, tail.to_at);
      out.splice(i + 1, 0, tail);
    }
    prev.to_at = _entryBatchToInputValue(cs);
    prev.duration_minutes = _entryBatchMinutes(prev.from_at, prev.to_at);
  }
  return out.filter((r) => _entryBatchMinutes(r.from_at, r.to_at) > 0).map((r) => ({
    ...r,
    duration_minutes: _entryBatchMinutes(r.from_at, r.to_at),
  }));
}

function _entryBatchValidateRows(rows) {
  if (!rows.length) return '일괄기록 행을 1건 이상 입력하세요.';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const no = i + 1;
    if (!r.category_id) return `${no}행: 대분류를 선택하세요.`;
    const cat = String(r.category_name || '').trim();
    if (cat !== '프로젝트업무' && !r.subcategory_id) return `${no}행: 소분류를 선택하세요.`;
    if (!r.from_at || !r.to_at || _entryBatchMinutes(r.from_at, r.to_at) <= 0) return `${no}행: 시작/종료 시간을 확인하세요.`;
    if (!String(r.work_note || '').trim()) return `${no}행: 업무기록을 입력하세요.`;
    if (cat === '일반자문업무') return `${no}행: 일반자문업무는 일괄기록에서 입력할 수 없습니다.`;
    if (cat === '일반통관업무') {
      if (!String(r.client_id || '').trim()) return `${no}행: 일반통관업무는 고객사가 필수입니다.`;
      if (!String(r.team_id || '').trim()) return `${no}행: 일반통관업무는 업무팀이 필수입니다.`;
    }
    if (cat === '프로젝트업무') {
      if (!String(r.client_id || '').trim()) return `${no}행: 프로젝트업무는 고객사가 필수입니다.`;
      if (!String(r.project_code || '').trim()) return `${no}행: 프로젝트업무는 프로젝트코드가 필수입니다.`;
    }
  }
  return '';
}

async function _entryDeleteBatchDetails(entryId) {
  const rows = await API.listAllPages('time_entry_details', {
    filter: `entry_id=eq.${encodeURIComponent(entryId)}`,
    limit: 200,
    maxPages: 20,
    sort: 'updated_at',
  }).catch(() => []);
  for (const r of (rows || [])) {
    if (!r || !r.id) continue;
    await API.delete('time_entry_details', r.id).catch(() => {});
  }
}

async function _saveBatchEntry(status, approverInfo, autoApprove = false) {
  const session = getSession();
  const rowsNorm = _entryBatchNormalizeRows(_entryBatchRows || []);
  const workDateKey = _entryBatchWorkDateKeyFromRows(rowsNorm);
  const validationMsg = _entryBatchValidateRows(rowsNorm);
  if (validationMsg) { Toast.warning(validationMsg); return; }
  _entryBatchRows = rowsNorm;
  _entryBatchRenderRows();

  const isSubmit = status === 'submitted';
  const submitBtn = document.getElementById('submitEntryBtn');
  const draftBtn = document.getElementById('draftEntryBtn');
  const restoreSubmit = BtnLoading.start(isSubmit ? submitBtn : draftBtn, isSubmit ? '제출 중...' : '저장 중...');
  const restoreOther = BtnLoading.disableAll(isSubmit ? draftBtn : submitBtn);

  try {
    const totalMin = rowsNorm.reduce((s, r) => s + (Number(r.duration_minutes) || 0), 0);
    const starts = rowsNorm.map((r) => new Date(r.from_at).getTime()).filter(Number.isFinite);
    const ends = rowsNorm.map((r) => new Date(r.to_at).getTime()).filter(Number.isFinite);
    const startAt = Math.min(...starts);
    const endAt = Math.max(...ends);
    const hasProject = rowsNorm.some((r) => String(r.category_name || '').trim() === '프로젝트업무');
    const hasClearance = rowsNorm.some((r) => String(r.category_name || '').trim() === '일반통관업무');
    const headerCatName = hasProject ? '프로젝트업무' : (hasClearance ? '일반통관업무' : '회사내부업무');
    const headerCat = (_allCategories || []).find((c) => String(c.category_name || '').trim() === headerCatName) || null;
    const firstSub = (_allSubcategories || []).find((s) => String(s.id || '') === String(rowsNorm[0].subcategory_id || '')) || null;
    const firstClearance = rowsNorm.find((r) => String(r.category_name || '').trim() === '일반통관업무') || null;
    const projCodes = [...new Set(rowsNorm.map((r) => String(r.project_code || '').trim()).filter(Boolean))];
    const projectCode = projCodes.length === 1 ? projCodes[0] : '';
    const projectName = projCodes.length === 1
      ? String((_dailyOpenProjectRows || []).find((p) => String(p.project_code || '').trim() === projCodes[0])?.project_name || '')
      : '';

    const summaryLines = rowsNorm.slice(0, 5).map((r) =>
      `- ${r.from_at.slice(11, 16)}~${r.to_at.slice(11, 16)} ${r.category_name}/${r.subcategory_name} ${r.work_note || ''}`.trim()
    );
    if (rowsNorm.length > 5) summaryLines.push(`- 외 ${rowsNorm.length - 5}건`);

    // 배치 헤더의 소속(team_name)은 작성자(컨설턴트) 본인의 소속팀으로 저장
    // 업무행별 수행팀은 time_entry_details에 별도 저장됨
    const userTeamName = String(session.cs_team_name || session.team_name || '').trim();
    const userTeamId = String(session.cs_team_id || session.team_id || '').trim();

    const entryData = {
      user_id: session.id,
      user_name: session.name,
      team_id: _entryBatchUuidOrNull(userTeamId || null),
      team_name: userTeamName,
      client_id: _entryBatchUuidOrNull(firstClearance ? firstClearance.client_id : null),
      client_name: firstClearance ? (firstClearance.client_name || '') : '',
      work_category_id: _entryBatchUuidOrNull(headerCat ? headerCat.id : null),
      work_category_name: headerCatName,
      work_subcategory_id: _entryBatchUuidOrNull(firstSub ? firstSub.id : null),
      work_subcategory_name: firstSub ? firstSub.sub_category_name : '일괄기록',
      time_category: 'internal',
      work_start_at: startAt,
      work_end_at: endAt,
      duration_minutes: totalMin,
      work_description: `[일괄기록] ${rowsNorm.length}건`,
      work_description_md: `[일괄기록] ${rowsNorm.length}건\n${summaryLines.join('\n')}`,
      approver_id: approverInfo.approver_id,
      approver_name: approverInfo.approver_name,
      reviewer2_id: approverInfo.reviewer2_id || '',
      reviewer2_name: approverInfo.reviewer2_name || '',
      status,
      kw_query: [],
      law_refs: '[]',
      kw_reason: [],
      sheet_type: entryFormSheetType(),
      project_code: hasProject ? projectCode : '',
      project_name: hasProject ? projectName : '',
      work_location: '',
      entry_mode: 'batch',
    };
    if (isSubmit && autoApprove) {
      entryData.status = 'approved';
      entryData.approver_id = '';
      entryData.approver_name = '';
      entryData.reviewer2_id = '';
      entryData.reviewer2_name = '';
      entryData.reviewed_at = Date.now();
      entryData.reviewer_id = session.id;
      entryData.reviewer_name = session.name || '';
    }

    let entry = null;
    let effectiveEditId = _editEntryId;
    if (!effectiveEditId) {
      const cachedDraftId = _entryBatchGetDraftServerId(session);
      if (cachedDraftId) {
        try {
          const cached = await API.get('time_entries', cachedDraftId);
          const sameUser = String(cached && cached.user_id || '') === String(session && session.id || '');
          const isDraft = String(cached && cached.status || '') === 'draft';
          const isBatch = String(cached && cached.entry_mode || '') === 'batch';
          if (sameUser && isDraft && isBatch) effectiveEditId = cachedDraftId;
          else _entryBatchClearDraftServerId(session);
        } catch (_) {
          _entryBatchClearDraftServerId(session);
        }
      }
    }
    if (!effectiveEditId && workDateKey) {
      const existingDraft = await _entryBatchFindServerDraftEntry(session, workDateKey);
      if (existingDraft && existingDraft.id) effectiveEditId = existingDraft.id;
    }
    const isEdit = !!effectiveEditId;
    if (isEdit) {
      const existing = await API.get('time_entries', effectiveEditId);
      if (existing && existing.doc_no) {
        entryData.doc_no = existing.doc_no;
        entry = await API.update('time_entries', effectiveEditId, entryData);
      } else {
        entry = await _entryEnsureDocNoForSave(Date.now(), async (docNo) => {
          entryData.doc_no = docNo;
          return await API.update('time_entries', effectiveEditId, entryData);
        });
      }
      await _entryDeleteBatchDetails(effectiveEditId);
    } else {
      entry = await _entryEnsureDocNoForSave(Date.now(), async (docNo) => {
        entryData.doc_no = docNo;
        return await API.create('time_entries', entryData);
      });
    }
    if (!entry || !entry.id) throw new Error('일괄기록 헤더 저장에 실패했습니다.');

    try {
      for (let i = 0; i < rowsNorm.length; i++) {
        const r = rowsNorm[i];
        await API.create('time_entry_details', {
          entry_id: entry.id,
          row_order: i + 1,
          work_date: String(r.from_at || '').slice(0, 10),
          from_at: new Date(r.from_at).getTime(),
          to_at: new Date(r.to_at).getTime(),
          duration_minutes: Number(r.duration_minutes) || 0,
          work_category_id: _entryBatchUuidOrNull(r.category_id),
          work_category_name: r.category_name || '',
          work_subcategory_id: _entryBatchUuidOrNull(r.subcategory_id),
          work_subcategory_name: r.subcategory_name || '',
          client_id: _entryBatchUuidOrNull(r.client_id),
          client_name: r.client_name || '',
          team_id: _entryBatchUuidOrNull(r.team_id),
          team_name: r.team_name || '',
          project_code: r.project_code || '',
          project_name: r.project_name || '',
          work_note: r.work_note || '',
          user_id: session.id,
          user_name: session.name || '',
          sheet_type: entryFormSheetType(),
          status,
          entry_mode: 'batch',
        });
      }
    } catch (detailErr) {
      if (!isEdit && entry && entry.id) {
        await API.delete('time_entries', entry.id).catch(() => {});
      }
      const detailMsg = String(detailErr?.message || detailErr || 'unknown_error');
      console.error('[batch save] detail insert failed:', detailErr);
      throw new Error('일괄기록 상세 저장에 실패했습니다: ' + detailMsg);
    }

    if (status === 'submitted' && !autoApprove && typeof createNotification === 'function' && approverInfo.approver_id) {
      createNotification({
        toUserId: approverInfo.approver_id,
        toUserName: approverInfo.approver_name,
        fromUserId: session.id,
        fromUserName: session.name,
        type: 'submitted',
        entryId: entry.id,
        entrySummary: `[일괄기록] ${rowsNorm.length}건`,
        message: `${session.name}님이 일괄기록 타임시트 승인을 요청했습니다.`,
        targetMenu: 'approval',
      });
    }

    if (status === 'submitted') {
      try { localStorage.removeItem(ENTRY_BATCH_LOCAL_KEY); } catch (_) {}
      _entryBatchClearDraftServerId(session);
      _entryBatchRows = [];
      _entryBatchSelectedRowIdx = -1;
      _entryBatchTimelineDate = '';
      _entryBatchRenderRows();
      _entryBatchAutosaveState('초기화됨');
      _editEntryId = null;
    } else {
      try { localStorage.setItem(ENTRY_BATCH_LOCAL_KEY, JSON.stringify(_entryBatchLocalPayload())); } catch (_) {}
      _entryBatchSetDraftServerId(session, entry && entry.id);
      _entryBatchAutosaveState('임시저장됨 (복구 가능)');
      _editEntryId = entry && entry.id ? entry.id : _editEntryId;
    }
    await _entryBatchCleanupDuplicateDraftEntries(session, entry && entry.id, workDateKey);
    Toast.success(status === 'submitted' ? (autoApprove ? '승인 완료되었습니다.' : '일괄기록이 제출되었습니다.') : '일괄기록이 임시저장되었습니다.');
    window._dashNeedsRefresh = true;
    await updateApprovalBadge(session);
    restoreSubmit();
    restoreOther();
    // 저장 후 My Time Sheet의 일괄기록 탭으로 자동 전환
    _entrySheetMode = 'batch';
    try { sessionStorage.setItem('my_entries_sheet_mode', 'batch'); } catch (_) {}
    navigateTo(entryFormSheetType() === 'daily' ? 'my-entries-daily' : 'my-entries-hourly');
    // navigateTo 후 loadMyEntries가 호출될 때 batch 탭이 활성화되도록 UI 갱신
    setTimeout(() => {
      const sess = getSession ? getSession() : null;
      const cvsr = !!(sess && (Auth.canViewAll(sess) || Auth.canViewDeptScope(sess) || _entryCanReadMyEntriesMenu(sess)));
      _entryApplySheetModeUi(cvsr);
      loadMyEntries();
    }, 100);
  } catch (err) {
    console.error(err);
    restoreSubmit();
    restoreOther();
    Toast.error('일괄기록 저장 실패: ' + (err.message || '오류'));
  }
}

async function saveEntry(status) {
  const session = getSession();
  const isManagerRole = !!(typeof Auth !== 'undefined' && Auth.isManager && Auth.isManager(session));
  const isCcbAutoApprove =
    status === 'submitted' &&
    ((typeof Auth !== 'undefined' && Auth.isDirector && Auth.isDirector(session)) ||
     (typeof Auth !== 'undefined' && Auth.isTopMgr && Auth.isTopMgr(session))) &&
    typeof Auth !== 'undefined' &&
    typeof Auth.preferredSheetType === 'function' &&
    Auth.preferredSheetType(session) === 'daily';

  // 변환 중인 파일 있으면 대기
  if (_pendingFiles.some(pf => pf._loading)) {
    Toast.warning('파일 변환 중입니다. 잠시 후 다시 시도하세요.');
    return;
  }

  // 승인자 정보 결정
  // - staff:   users.approver_id (manager)      → approval 화면에서 manager가 조회
  // - manager: users.reviewer2_id (director)    → approval 화면에서 director가 조회
  // ★ API 실패 시 session 캐시값 fallback 사용
  let approverInfo = {
    approver_id:    session.approver_id    || '',
    approver_name:  session.approver_name  || '',
    reviewer2_id:   session.reviewer2_id   || '',
    reviewer2_name: session.reviewer2_name || ''
  };
  if (isCcbAutoApprove) {
    approverInfo = { approver_id: '', approver_name: '', reviewer2_id: '', reviewer2_name: '' };
  } else {
    try {
      const userRecord = await API.get('users', session.id);
      if (!userRecord) throw new Error('userRecord null');

      if (isManagerRole) {
        // manager 본인 건: reviewer2_id(본부장/사업부장)를 approver_id로 저장
        // → approval.js에서 2차 승인자(본부장/사업부장)가 조회
        const allUsers = await Master.users().catch(() => []);
        const userById = new Map((allUsers || []).map((u) => [String(u && u.id || ''), u]));
        const normName = (v) => String(v || '').toLowerCase().replace(/\s+/g, '').trim();
        const isSecondRole = (u) => {
          const role = normalizeRoleName(u && u.role);
          return role === 'director' || role === 'top_mgr';
        };
        const reviewer2Id = String(userRecord.reviewer2_id || '').trim();
        const reviewer2Name = String(userRecord.reviewer2_name || '').trim();
        if (userRecord.reviewer2_id) {
          let targetDirector = userById.get(reviewer2Id);
          // reviewer2_id가 비활성/불일치(사용자 재생성)일 수 있으므로 이름+조직으로 재해석
          if (!targetDirector || targetDirector.is_active === false || !isSecondRole(targetDirector)) {
            const byName = (allUsers || []).find((u) =>
              isSecondRole(u) &&
              u.is_active !== false &&
              normName(u.name) === normName(reviewer2Name) &&
              Auth.scopeMatch(u, userRecord)
            );
            if (byName) targetDirector = byName;
          }
          approverInfo = {
            approver_id:    targetDirector ? String(targetDirector.id || '') : reviewer2Id,
            approver_name:  targetDirector ? String(targetDirector.name || '') : (reviewer2Name || ''),
            reviewer2_id:   targetDirector ? String(targetDirector.id || '') : reviewer2Id,
            reviewer2_name: targetDirector ? String(targetDirector.name || '') : (reviewer2Name || '')
          };
        } else {
          // fallback: 소속 범위의 본부장/사업부장 자동 탐색
          const myDirector = allUsers.find(u =>
            isSecondRole(u) &&
            u.is_active !== false &&
            Auth.scopeMatch(u, userRecord)
          ) || allUsers.find(u =>
            isSecondRole(u) && u.is_active !== false &&
            u.dept_id && userRecord.dept_id && String(u.dept_id) === String(userRecord.dept_id)
          );
          if (myDirector) {
            approverInfo = {
              approver_id:    myDirector.id,
              approver_name:  myDirector.name || '',
              reviewer2_id:   myDirector.id,
              reviewer2_name: myDirector.name || ''
            };
          }
        }
        // manager 제출은 본부장(approver_id) 미지정 시 반드시 차단
        if (status === 'submitted' && !String(approverInfo.approver_id || '').trim()) {
          Toast.warning('본부장(승인자)이 지정되지 않아 승인요청을 보낼 수 없습니다. 사용자 등록에서 Reviewer2(본부장)를 확인하세요.');
          return;
        }
      } else {
        // staff: 등록된 승인자(manager) 사용
        // ★ userRecord에 approver_id가 있으면 우선 사용, 없으면 session 캐시값 유지
        if (userRecord.approver_id) {
          approverInfo = {
            approver_id:    userRecord.approver_id,
            approver_name:  userRecord.approver_name  || '',
            reviewer2_id:   userRecord.reviewer2_id   || '',
            reviewer2_name: userRecord.reviewer2_name || ''
          };
        }
        // approver_id가 여전히 없으면 제출 차단
        if (!approverInfo.approver_id && status === 'submitted') {
          Toast.warning('승인자가 지정되지 않았습니다. 관리자에게 승인자 지정을 요청하세요.');
          return;
        }
      }
    } catch (err) {
      console.warn('[saveEntry] approverInfo 조회 실패, session 캐시 사용:', err);
      // session 캐시 fallback 이미 적용됨 — approverInfo 유지
      // manager인데 reviewer2_id가 없으면 경고
      if (isManagerRole && !approverInfo.reviewer2_id && status === 'submitted') {
        Toast.warning('2차 승인자(본부장/사업부장)가 지정되지 않았습니다. 관리자에게 요청하세요.');
        return;
      }
    }
  }

  if (_entryEffectiveInputMode() === 'by_batch') {
    await _saveBatchEntry(status, approverInfo, isCcbAutoApprove);
    return;
  }

  const catEl    = document.getElementById('entry-category');
  const subEl    = document.getElementById('entry-subcategory');
  const teamEl   = document.getElementById('entry-team');
  const catId    = (catEl && catEl.value || '').trim();
  const catName  = catEl && catEl.selectedIndex >= 0 ? (catEl.options[catEl.selectedIndex]?.textContent || '') : '';
  const catType  = catEl && catEl.selectedIndex >= 0 ? (catEl.options[catEl.selectedIndex]?.dataset.type || 'client') : 'client';
  const catTypeEff = _entryEffectiveTimeCategory(catType, catName);
  const subId    = (subEl && subEl.value || '').trim();
  const subName  = subEl.options[subEl.selectedIndex]?.textContent || '';
  const catNameTrimSaveEntry = catName.trim();
  const omitTeamPick = _entryOmitTeamFromFormPick(catNameTrimSaveEntry);
  const teamId   = omitTeamPick ? '' : teamEl.value;
  const teamName = omitTeamPick ? '' : (teamEl.options[teamEl.selectedIndex]?.textContent || '');
  // ★ ClientSearchSelect에서 고객사 값 읽기
  const csVal      = ClientSearchSelect.getValue('entry-client-wrap');
  const clientId   = csVal.id || document.getElementById('entry-client').value || '';
  const clientName = csVal.name || '';
  if (entryFormSheetType() === 'daily') {
    const mode = _entryDailyEffectivePeriodMode();
    if (mode === 'by_day_span') {
      applyDailyPeriodFromInput();
      const df = (document.getElementById('entry-daily-from') || {}).value;
      const dto = (document.getElementById('entry-daily-to') || {}).value;
      if (!df || !dto) {
        Toast.warning('투입 시작일과 종료일을 선택하세요.');
        return;
      }
      if (df > dto) {
        Toast.warning('투입 종료일이 시작일보다 빠를 수 없습니다.');
        return;
      }
    }
    const dCat = entryDailyCategoryName();
    if (dCat === '일반자문업무' && !clientId) {
      Toast.warning('고객사를 선택하세요.');
      return;
    }
  }
  // 프로젝트업무(시간제/일일 공통): 프로젝트 코드 기반으로 신청
  const catNameTrimGlobal = catName.trim();
  if (catNameTrimGlobal === '프로젝트업무') {
    const pcode = (document.getElementById('entry-daily-project-code')?.value || '').trim();
    if (!pcode) {
      Toast.warning('프로젝트 목록에서 프로젝트를 선택하세요.');
      return;
    }
    const loc = (document.getElementById('entry-work-location')?.value || '').trim();
    if (!loc) {
      Toast.warning('수행장소를 입력하세요.');
      return;
    }
  }
  const startAt    = _entryNormalizeDateTimeField('entry-start');
  const endAt      = _entryNormalizeDateTimeField('entry-end');
  const isSubmitSave = status === 'submitted';
  // ★ 실제 소요시간: 사용자 직접 입력(시간·분) 우선, 없으면 hidden(자동계산) 사용
  syncActualDuration(); // 저장 직전 한 번 더 동기화
  const duration   = parseInt(document.getElementById('entry-duration').value) || 0;

  // ★ Quill 내용 → hidden inputs 동기화 (저장 직전)
  // internal 대분류는 메모란 텍스트를 description으로 사용
  let description   = '';
  let descriptionMd = '';
  if (catTypeEff === 'client') {
    _syncQuillToHidden();
    description   = document.getElementById('entry-description').value.trim();
    descriptionMd = document.getElementById('entry-description-md')?.value.trim() || '';
  } else {
    const memoEl = document.getElementById('entry-memo');
    description   = memoEl ? memoEl.value.trim() : '';
    descriptionMd = description;
  }
  // 프로젝트업무는 "업무수행내용"을 텍스트(메모) 그대로 저장/출력
  if (catNameTrimSaveEntry === '프로젝트업무') {
    const memoEl = document.getElementById('entry-memo');
    const memoTxt = memoEl ? memoEl.value.trim() : '';
    description = memoTxt;
    descriptionMd = memoTxt;
  }

  // 유효성 검사
  if (!catId || !subId)   { Toast.warning('대분류와 소분류를 선택하세요.'); return; }
  if (!omitTeamPick && !teamId) { Toast.warning('수행 팀을 선택하세요.'); return; }
  if (!startAt || (isSubmitSave && !endAt)) {
    const dailyNoRange = entryFormSheetType() === 'daily' && _entryDailyEffectivePeriodMode() === 'by_day_span';
    if (dailyNoRange) {
      Toast.warning('투입 시작일과 종료일을 선택하세요.');
    } else {
      Toast.warning(isSubmitSave ? '제출 시 업무 시작/종료 일시를 입력하세요.' : '업무 시작 일시를 입력하세요.');
    }
    return;
  }
  if (isSubmitSave && duration <= 0)      { Toast.warning('제출 시 실제 소요시간을 입력하세요. (시간 또는 분에 숫자를 입력)'); return; }
  if (catTypeEff === 'client' && !description) {
    Toast.warning('수행 내용을 입력하세요.');
    if (_quill) _quill.focus();
    return;
  }
  const isClearance = catName.trim() === '일반통관업무';
  if ((catTypeEff === 'client' || isClearance) && !clientId) { Toast.warning('고객사를 선택하세요.'); return; }
  if (catName.trim() === '프로젝트업무') {
    const memoEl = document.getElementById('entry-memo');
    const memoTxt = memoEl ? memoEl.value.trim() : '';
    if (!memoTxt) {
      Toast.warning('수행 내역을 입력하세요.');
      memoEl?.focus();
      return;
    }
  }
  if (entryFormSheetType() === 'daily' && entryDailyCategoryName() === '회사내부업무') {
    const memoEl = document.getElementById('entry-memo');
    const memoTxt = memoEl ? memoEl.value.trim() : '';
    if (!memoTxt) {
      Toast.warning('수행 내역을 입력하세요.');
      memoEl?.focus();
      return;
    }
  }
  // 핵심키워드·첨부 필수 (고객업무 제출 시 — 일일·시간제 동일)
  if (catTypeEff === 'client' && status === 'submitted') {
    let kwArr = [];
    try { kwArr = JSON.parse(document.getElementById('kw-query-hidden')?.value || '[]'); } catch {}
    if (!kwArr.length) { Toast.warning('핵심키워드를 1개 이상 입력하세요. (자문 분류 정보)'); document.getElementById('kw-query-input')?.focus(); return; }
  }
  if (catTypeEff === 'client' && status === 'submitted' && _pendingFiles.length === 0) {
    Toast.warning('고객업무는 자문 결과물을 첨부해야 합니다.'); return;
  }

  // ★ 시간 겹침 — 경고만 표시, 저장은 허용 (일일·일 단위만 생략, 일일·시간 단위는 시간제와 동일 검사)
  const skipOverlapDaily = entryFormSheetType() === 'daily' && _entryDailyEffectivePeriodMode() === 'by_day_span';
  if (!skipOverlapDaily && startAt && endAt) {
    const newStart = new Date(startAt).getTime();
    const newEnd   = new Date(endAt).getTime();
    const { overlap, conflict } = await checkTimeOverlap(newStart, newEnd, _editEntryId || '');
    if (overlap && conflict) {
      _showOverlapBanner(conflict, newStart, newEnd, false); // 노란 경고 배너
      // 차단 없이 저장 계속 진행
    }
  }

  // ★ 민감정보 감지 — 일반자문업무(client)만 적용
  //    검사 대상: ② 수행내용(Quill) + ③ 자문분류(핵심키워드·판단사유)
  if (catTypeEff === 'client') {
    // ② 수행내용: Quill 평문 추출
    const quillText = _quill ? _quill.getText() : description;

    // ③ 자문분류 — 핵심키워드 태그
    let kwQueryText = '';
    try {
      const kwArr = JSON.parse(document.getElementById('kw-query-hidden')?.value || '[]');
      kwQueryText = Array.isArray(kwArr) ? kwArr.join(' ') : '';
    } catch { kwQueryText = ''; }

    // ③ 자문분류 — 판단사유 태그
    let kwReasonText = '';
    try {
      const krArr = JSON.parse(document.getElementById('kw-reason-hidden')?.value || '[]');
      kwReasonText = Array.isArray(krArr) ? krArr.join(' ') : '';
    } catch { kwReasonText = ''; }

    // 합쳐서 한 번에 검사
    const combinedText = [quillText, kwQueryText, kwReasonText].filter(Boolean).join(' ');

    if (combinedText.trim()) {
      const sensitiveResults = await _detectSensitiveInfo(combinedText);
      if (sensitiveResults.length > 0) {
        // 팝업 표시 — [저장 진행] 클릭 시 저장 계속
        _showSensitiveWarning(sensitiveResults, () => _doSaveEntry(status, approverInfo, isCcbAutoApprove));
        return; // 사용자 선택 대기
      }
    }
  }

  // 민감정보 없거나 internal → 바로 저장 실행
  await _doSaveEntry(status, approverInfo, isCcbAutoApprove);
}

/**
 * 실제 저장 로직 (민감정보 팝업 통과 후 호출)
 * saveEntry()의 하위 함수로 분리하여 팝업 콜백에서도 재사용
 */
async function _doSaveEntry(status, approverInfo, autoApprove = false) {
  // 저장에 필요한 값 재수집 (saveEntry에서 이미 검증 완료)
  const session    = getSession();
  // approverInfo fallback (민감정보 팝업 콜백 등에서 누락될 경우 대비)
  if (!approverInfo) {
    approverInfo = {
      approver_id:    session.approver_id    || '',
      approver_name:  session.approver_name  || '',
      reviewer2_id:   session.reviewer2_id   || '',
      reviewer2_name: session.reviewer2_name || ''
    };
  }
  const catEl      = document.getElementById('entry-category');
  const subEl      = document.getElementById('entry-subcategory');
  const teamEl     = document.getElementById('entry-team');
  const catId      = catEl.value;
  const catName    = catEl.options[catEl.selectedIndex]?.textContent || '';
  const catType    = catEl.options[catEl.selectedIndex]?.dataset.type || 'client';
  const catTypeEff = _entryEffectiveTimeCategory(catType, catName);
  const subId      = subEl.value;
  const subName    = subEl.options[subEl.selectedIndex]?.textContent || '';
  let persistSubId = subId;
  let persistSubName = subName;
  if (entryFormSheetType() !== 'daily' && String(catName || '').trim() === '프로젝트업무' && subId && _entryFilterIsProjectMainValue(subId)) {
    const mc = _entryFilterProjectMainCode(subId);
    await _entryEnsureProjectCodeTypes();
    const row = (_entryProjectCodeTypeRows || []).find((r) => String(r.main_code || '').trim() === mc);
    persistSubName = row ? String(row.main_category || '').trim() : String(subName || '').trim();
    const subs = (_allSubcategories || []).filter((s) => String(s.category_id) === String(catId));
    const exact = subs.find((s) => String(s.sub_category_name || '').trim() === persistSubName);
    persistSubId = exact ? String(exact.id) : '';
  }
  const omitTeamPickSave = _entryOmitTeamFromFormPick(catName.trim());
  let teamId     = omitTeamPickSave ? '' : teamEl.value;
  let teamName   = omitTeamPickSave ? '' : (teamEl.options[teamEl.selectedIndex]?.textContent || '');
  const stampedTeam = _entryStampOrgTeamForDisplaySave(catName.trim(), session, teamId, teamName);
  teamId = stampedTeam.team_id;
  teamName = stampedTeam.team_name;
  const csVal      = ClientSearchSelect.getValue('entry-client-wrap');
  const clientId   = csVal.id || document.getElementById('entry-client').value || '';
  const clientName = csVal.name || '';
  const startAt    = _entryNormalizeDateTimeField('entry-start');
  const endAt      = _entryNormalizeDateTimeField('entry-end');
  syncActualDuration();
  const duration   = parseInt(document.getElementById('entry-duration').value) || 0;

  let description = '', descriptionMd = '';
  if (catTypeEff === 'client') {
    _syncQuillToHidden();
    description   = document.getElementById('entry-description').value.trim();
    descriptionMd = document.getElementById('entry-description-md')?.value.trim() || '';
  } else {
    const memoEl = document.getElementById('entry-memo');
    description   = memoEl ? memoEl.value.trim() : '';
    descriptionMd = description;
  }
  // 프로젝트업무는 "업무수행내용"을 텍스트(메모) 그대로 저장/출력
  if (catName.trim() === '프로젝트업무') {
    const memoEl = document.getElementById('entry-memo');
    const memoTxt = memoEl ? memoEl.value.trim() : '';
    description = memoTxt;
    descriptionMd = memoTxt;
  }

  // ★ 제출 / 임시저장 버튼 로딩
  const isSubmit = status === 'submitted';
  const submitBtn = document.getElementById('submitEntryBtn');
  const draftBtn  = document.getElementById('draftEntryBtn');
  const restoreSubmit = BtnLoading.start(
    isSubmit ? submitBtn : draftBtn,
    isSubmit ? '제출 중...' : '저장 중...'
  );
  const restoreOther = BtnLoading.disableAll(isSubmit ? draftBtn : submitBtn);

  try {
    const isClearance = catName.trim() === '일반통관업무';
    const isDailySheet = entryFormSheetType() === 'daily';
    const isProjSave = catName.trim() === '프로젝트업무';
    let project_code = '';
    let project_name = '';
    let work_location = '';
    if (isProjSave) {
      project_code = (document.getElementById('entry-daily-project-code')?.value || '').trim();
      project_name = (document.getElementById('entry-daily-project-name')?.value || '').trim();
      work_location = (document.getElementById('entry-work-location')?.value || '').trim();
      const projectSubName = await _entryResolveProjectSubcategoryByCode(project_code);
      if (projectSubName) {
        persistSubName = projectSubName;
        const subs = (_allSubcategories || []).filter((s) => String(s.category_id) === String(catId));
        const exact = subs.find((s) => String(s.sub_category_name || '').trim() === projectSubName);
        persistSubId = exact ? String(exact.id || '') : '';
      }
    }
    let effClientId = (catTypeEff === 'client' || isClearance) ? clientId : '';
    let effClientName = (catTypeEff === 'client' || isClearance) ? clientName : '';
    if (isProjSave) {
      effClientId = (document.getElementById('entry-daily-project-client-id')?.value || '').trim();
      effClientName = (document.getElementById('entry-daily-project-client-name')?.value || '').trim();
    }
    const startAtTs = startAt ? new Date(startAt).getTime() : null;
    const endAtTs = endAt ? new Date(endAt).getTime() : null;
    const entryData = {
      user_id:   session.id,
      user_name: session.name,
      team_id:   teamId,
      team_name: teamName,
      client_id:   effClientId,
      client_name: effClientName,
      work_category_id:   catId,
      work_category_name: catName,
      work_subcategory_id:   persistSubId || null,
      work_subcategory_name: persistSubName,
      time_category:  catTypeEff,
      work_start_at:  startAtTs,
      work_end_at:    endAtTs,
      duration_minutes: duration,
      work_description:    description,
      work_description_md: descriptionMd,
      approver_id:   approverInfo.approver_id,
      approver_name: approverInfo.approver_name,
      reviewer2_id:  approverInfo.reviewer2_id  || '',
      reviewer2_name: approverInfo.reviewer2_name || '',
      status,
      // 자문 분류 정보 (고객업무 시만 의미있음)
      kw_query:  catTypeEff === 'client' ? (() => { try { return JSON.parse(document.getElementById('kw-query-hidden')?.value || '[]'); } catch { return []; } })() : [],
      law_refs:  catTypeEff === 'client' ? (document.getElementById('law-refs-hidden')?.value || '[]') : '[]',
      kw_reason: catTypeEff === 'client' ? (() => { try { return JSON.parse(document.getElementById('kw-reason-hidden')?.value || '[]'); } catch { return []; } })() : [],
      sheet_type: entryFormSheetType(),
      project_code:   isProjSave ? project_code : '',
      project_name:   isProjSave ? project_name : '',
      work_location:  isProjSave ? work_location : '',
    };

    // CCB 본부장/사업부장(Director/Top Mgr) 제출 → 승인자 없이 즉시 승인 완료 처리
    if (isSubmit && autoApprove) {
      entryData.status = 'approved';
      entryData.approver_id = '';
      entryData.approver_name = '';
      entryData.reviewer2_id = '';
      entryData.reviewer2_name = '';
      entryData.reviewed_at = Date.now();
      entryData.reviewer_id = session.id;
      entryData.reviewer_name = session.name || '';
    }

    let entry;
    if (_editEntryId) {
      // 수정: doc_no는 기존 값을 유지 (비어있을 때만 생성)
      const existing = await API.get('time_entries', _editEntryId);
      if (existing && existing.doc_no) {
        entryData.doc_no = existing.doc_no;
        entry = await API.update('time_entries', effectiveEditId, entryData);
      } else {
        // 문서번호는 "저장 시점" 기준으로 발번 (작성일자와 일치)
        entry = await _entryEnsureDocNoForSave(Date.now(), async (docNo) => {
          entryData.doc_no = docNo;
          return await API.update('time_entries', effectiveEditId, entryData);
        });
      }
    } else {
      // 문서번호는 "저장 시점" 기준으로 발번 (작성일자와 일치)
      entry = await _entryEnsureDocNoForSave(Date.now(), async (docNo) => {
        entryData.doc_no = docNo;
        return await API.create('time_entries', entryData);
      });
    }

    // ── ★ 첨부 파일 저장 (Base64 content OR 외부 URL) ──────
    // ── ★ 수정 모드: 삭제 예정 첨부파일 DB에서 삭제 ──────────────
    if (_deletedAttIds.length > 0) {
      for (const attId of _deletedAttIds) {
        try { await API.delete('attachments', attId); } catch (e) {
          console.warn('첨부파일 삭제 실패:', attId, e);
        }
      }
      _deletedAttIds = [];
    }

    for (const pf of _pendingFiles) {
      // file_size: DB·자료실 UI는 바이트 기준 (기존 sizeKB 저장은 0KB 표시 오류 원인)
      const sizeBytes = pf.file && typeof pf.file.size === 'number'
        ? pf.file.size
        : (pf.sizeKB ? Math.round(pf.sizeKB * 1024) : 0);
      const attData = {
        entry_id:       entry.id,
        file_name:      pf.file ? pf.file.name : (pf.fileName || ''),
        file_type:      pf.type  || 'link',
        file_size:      sizeBytes,
        doc_type:       pf.docType || '',
        summary:        pf.summary || '',
        file_content:   pf.content  || '',         // Base64 data-URL
        file_url:       pf.fileUrl  || '',         // 외부 링크
        extracted_text: pf.extractedText || null,  // 추출+마스킹된 텍스트
      };
      await API.create('attachments', attData);
    }

    // ── ★ 알림 생성 (제출 시만) ─────────────────────────────
    if (status === 'submitted' && !autoApprove && typeof createNotification === 'function') {
      const catLabel   = catType === 'client' ? (clientName || '고객사') : catName;
      const summary    = `${catLabel} | ${subName || catName}`;
      const dateStr    = startAt ? new Date(startAt).toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit' }) : '';

      // 1차 승인자에게 알림
      if (approverInfo.approver_id) {
        const sheetHint = entryFormSheetType() === 'daily' ? '일일 타임시트' : '타임시트';
        createNotification({
          toUserId:     approverInfo.approver_id,
          toUserName:   approverInfo.approver_name,
          fromUserId:   session.id,
          fromUserName: session.name,
          type:         'submitted',
          entryId:      entry.id,
          entrySummary: summary,
          message:      `${session.name}님이 ${sheetHint} 승인을 요청했습니다.`,
          targetMenu:   'approval',
        });
      }
    }

    Toast.success(
      status === 'submitted'
        ? (autoApprove ? '승인 완료되었습니다.' : '타임시트가 제출되었습니다.')
        : '임시저장되었습니다.'
    );
    window._dashNeedsRefresh = true; // 대시보드 재진입 시 캐시 갱신
    _editEntryId  = null;
    _pendingFiles = [];
    _deletedAttIds = [];
    _existingAtts  = [];

    document.getElementById('fileList').innerHTML = '';
    // form 태그 제거로 .reset() 대신 필드를 직접 초기화
    ['entry-category','entry-subcategory','entry-team','entry-client',
     'entry-start','entry-end','entry-work-date','entry-daily-from','entry-daily-to',
     'entry-work-location','entry-duration',
     'kw-query-hidden','law-refs-hidden','kw-reason-hidden'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = el.id === 'law-refs-hidden' ? '[]' : '';
    });
    _entryClearDailyProjectPick();
    const plistAfter = document.getElementById('entry-daily-project-list');
    if (plistAfter) plistAfter.innerHTML = '';
    if (typeof ClientSearchSelect !== 'undefined') {
      try { ClientSearchSelect.clear('entry-daily-proj-client-wrap'); } catch (_) {}
    }
    document.getElementById('duration-text').textContent = '시작/종료 시간을 입력하면 자동 계산됩니다.';
    _clearDurationInput(); // 실제 소요시간 입력란 초기화
    document.getElementById('entry-user-name').value = session.name;
    // Quill 에디터 초기화
    _resetQuill();
    // ★ 고객사 검색 선택 초기화
    ClientSearchSelect.clear('entry-client-wrap');
    document.getElementById('entry-client').value = '';
    // 자문 분류 초기화
    _clearKwTags('kw-query');
    _clearKwTags('kw-reason');
    _clearLawRefs();
    updateClientSection();
    await updateApprovalBadge(session);
    restoreSubmit();
    restoreOther();
    navigateTo(entryFormSheetType() === 'daily' ? 'my-entries-daily' : 'my-entries-hourly');

  } catch (err) {
    console.error(err);
    restoreSubmit();
    restoreOther();
    Toast.error('저장 실패: ' + err.message);
  }
}

// ─────────────────────────────────────────────
// 나의 타임시트 초기화
// ─────────────────────────────────────────────
function _entryFmtDateOnly(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _entryQuickRangeDates(key) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  if (key === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (key === 'week') {
    start.setDate(start.getDate() - 6);
  } else if (key === 'month') {
    start.setDate(start.getDate() - 29);
  }
  return { from: _entryFmtDateOnly(start), to: _entryFmtDateOnly(end) };
}
function _entrySyncRangeButtonState() {
  const fromVal = (document.getElementById('filter-entry-date-from') || {}).value || '';
  const toVal = (document.getElementById('filter-entry-date-to') || {}).value || '';
  document.querySelectorAll('#page-my-entries [data-entry-range]').forEach((btn) => {
    const rng = _entryQuickRangeDates(btn.dataset.entryRange);
    btn.classList.toggle('is-active', rng.from === fromVal && rng.to === toVal);
  });
}
function _entryBindQuickRangeButtons() {
  const fromEl = document.getElementById('filter-entry-date-from');
  const toEl = document.getElementById('filter-entry-date-to');
  if (fromEl && !fromEl.dataset.rangeBind) {
    fromEl.dataset.rangeBind = '1';
    fromEl.addEventListener('change', _entrySyncRangeButtonState);
  }
  if (toEl && !toEl.dataset.rangeBind) {
    toEl.dataset.rangeBind = '1';
    toEl.addEventListener('change', _entrySyncRangeButtonState);
  }
  document.querySelectorAll('#page-my-entries [data-entry-range]').forEach((btn) => {
    if (btn.dataset.rangeBind) return;
    btn.dataset.rangeBind = '1';
    btn.addEventListener('click', () => {
      const { from, to } = _entryQuickRangeDates(btn.dataset.entryRange);
      if (fromEl) fromEl.value = from;
      if (toEl) toEl.value = to;
      _entriesPage = 1;
      _entrySyncRangeButtonState();
      loadMyEntries();
    });
  });
  _entrySyncRangeButtonState();
}

let _entryProjectCodeTypeRows = null;
let _entryProjectMainByCode = null;
let _entryProjectTypeByMainSub = null;

function _entrySelectedFilterCategoryName() {
  const catEl = document.getElementById('filter-entry-category');
  if (!catEl) return '';
  const opt = catEl.options[catEl.selectedIndex];
  return String(opt ? opt.textContent : '').trim();
}

function _entryIsProjectFilterCategorySelected() {
  return _entrySelectedFilterCategoryName() === '프로젝트업무';
}

async function _entryEnsureProjectCodeTypes() {
  if (_entryProjectCodeTypeRows) return _entryProjectCodeTypeRows;
  try {
    _entryProjectCodeTypeRows = await API.listAllPages('project_code_types', { limit: 500, maxPages: 10, sort: 'main_code' });
  } catch (e) {
    console.warn('[entry] project_code_types load failed', e);
    _entryProjectCodeTypeRows = [];
  }
  _entryProjectMainByCode = {};
  _entryProjectTypeByMainSub = {};
  (_entryProjectCodeTypeRows || []).forEach((r) => {
    const mc = String(r.main_code || '').trim();
    const sc = String(r.sub_code || '').trim();
    if (!mc) return;
    if (!_entryProjectMainByCode[mc]) {
      _entryProjectMainByCode[mc] = String(r.main_category || '').trim();
    }
    if (mc && sc) _entryProjectTypeByMainSub[`${mc}|${sc}`] = r;
  });
  return _entryProjectCodeTypeRows;
}

async function _entryResolveProjectSubcategoryByCode(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code) return '';
  await _entryEnsureProjectCodeTypes();
  const parts = code.split('_').map((s) => String(s || '').trim()).filter(Boolean);
  const mainCode = parts[0] || '';
  const subCode = parts[1] || '';
  let typeRow = (mainCode && subCode) ? (_entryProjectTypeByMainSub || {})[`${mainCode}|${subCode}`] : null;
  if (!typeRow) {
    const picked = (_dailyOpenProjectRows || []).find((r) => String(r.project_code || '').trim() === code);
    const typeId = String((picked && picked.project_code_type_id) || '').trim();
    if (typeId) {
      typeRow = (_entryProjectCodeTypeRows || []).find((r) => String(r.id || '').trim() === typeId) || null;
    }
  }
  return typeRow ? String(typeRow.sub_category || '').trim() : '';
}

function _entryFilterIsProjectMainValue(v) {
  return String(v || '').startsWith('pcmain:');
}

function _entryFilterProjectMainCode(v) {
  return String(v || '').replace(/^pcmain:/, '').trim();
}

function _entryFilterIsSubcategoryNameValue(v) {
  return String(v || '').startsWith('scname:');
}

function _entryFilterSubcategoryName(v) {
  const raw = String(v || '').replace(/^scname:/, '');
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    return raw;
  }
}

function _entryRestoreNormalSubcategoryFilterOptions(catId) {
  const subEl = document.getElementById('filter-entry-subcategory');
  if (!subEl) return;
  let rows = [];
  try {
    rows = JSON.parse(subEl.dataset.baseRows || '[]');
  } catch (_) {
    rows = [];
  }
  subEl.innerHTML = '<option value="">전체 소분류</option>';
  const seen = new Set();
  rows.forEach((s) => {
    if (catId && String(s.category_id || '') !== String(catId)) return;
    const subName = String(s.sub_category_name || '').trim();
    if (!subName) return;
    const dedupeKey = subName.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const opt = document.createElement('option');
    opt.value = `scname:${encodeURIComponent(subName)}`;
    opt.textContent = subName;
    opt.dataset.categoryId = String(s.category_id || '');
    opt.dataset.subcategoryName = subName;
    subEl.appendChild(opt);
  });
  subEl.dataset.filterMode = 'subcategory';
}

async function _entryUseProjectMainFilterOptions() {
  const subEl = document.getElementById('filter-entry-subcategory');
  if (!subEl) return;
  await _entryEnsureProjectCodeTypes();
  const uniq = new Map();
  (_entryProjectCodeTypeRows || []).forEach((r) => {
    const mc = String(r.main_code || '').trim();
    const mcat = String(r.main_category || '').trim();
    if (!mc || !mcat || uniq.has(mc)) return;
    uniq.set(mc, mcat);
  });
  const rows = [...uniq.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  subEl.innerHTML = '<option value="">전체 프로젝트 대분류</option>';
  rows.forEach(([mc, mcat]) => {
    const opt = document.createElement('option');
    opt.value = `pcmain:${mc}`;
    opt.textContent = mcat;
    subEl.appendChild(opt);
  });
  subEl.dataset.filterMode = 'project-main';
}

function _entryAttachProjectMainFields(entries) {
  const mainMap = _entryProjectMainByCode || {};
  const typeMap = _entryProjectTypeByMainSub || {};
  (entries || []).forEach((e) => {
    const pcode = String(e.project_code || '').trim();
    const parts = pcode ? pcode.split('_').map((s) => String(s || '').trim()).filter(Boolean) : [];
    const mainCode = parts[0] || '';
    const subCode = parts[1] || '';
    const typeRow = (mainCode && subCode) ? typeMap[`${mainCode}|${subCode}`] : null;
    e._project_main_code = mainCode;
    e._project_sub_code = subCode;
    e._project_main_category = mainCode ? String(mainMap[mainCode] || '') : '';
    e._project_subcategory_label = typeRow ? String(typeRow.sub_category || '').trim() : '';
  });
}

function _entryProjectSubcategoryLabel(entry) {
  const legacySub = String(entry && entry.work_subcategory_name || '').trim();
  const isProjEntry = String(entry && entry.work_category_name || '').trim() === '프로젝트업무';
  const hasPcode = String(entry && entry.project_code || '').trim() !== '';
  if (!isProjEntry || !hasPcode) return legacySub;
  const projSub = String(entry && entry._project_subcategory_label || '').trim();
  return projSub || legacySub;
}

function _entryParseWorkStartTs(entry) {
  if (!entry || entry.work_start_at == null) return 0;
  const raw = entry.work_start_at;
  const num = Number(raw);
  let ts;
  if (!isNaN(num) && num > 1000000000000) ts = num;
  else if (!isNaN(num) && num > 1000000000) ts = num * 1000;
  else ts = new Date(raw).getTime();
  return isNaN(ts) ? 0 : ts;
}

function _entryPerformanceTypeLabel(v) {
  const key = String(v || '').trim();
  if (key === 'independent') return '독립수행';
  if (key === 'guided') return '지도수행';
  if (key === 'supervised') return '감독수행';
  return key || '미평가';
}

function _entryQualityLabel(v) {
  const key = String(v || '').trim();
  if (key === 'very_satisfied') return '매우우수';
  if (key === 'satisfied') return '우수';
  if (key === 'normal') return '참고';
  if (key === 'unsatisfied') return '미흡';
  if (key === 'very_unsatisfied') return '매우미흡';
  return key || '미평가';
}

function _entryQualityStars(entry) {
  const n = Number(entry && entry.quality_stars);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function _entryOrgLabelByUser(userMeta, fallbackTeamName = '') {
  const dept = String(userMeta?.deptName || '').trim();
  const hq = String(userMeta?.hqName || '').trim();
  const org = dept || hq;
  const rawTeam = String(userMeta?.teamName || '').trim() || String(fallbackTeamName || '').trim();
  let team = rawTeam;
  if (team && org && team.startsWith(org) && team.length > org.length) {
    team = team.slice(org.length).replace(/^[\s/_-]+/, '').trim();
  }
  if (team && dept && team.startsWith(dept) && team.length > dept.length) {
    team = team.slice(dept.length).replace(/^[\s/_-]+/, '').trim();
  }
  if (!team && rawTeam) team = rawTeam;
  if (org && team) return `${org}/${team}`;
  return org || team || '—';
}

function _entryOrgNorm(v) {
  return String(v || '').trim();
}

function _entryResolveSessionOrgScope(session, users) {
  const sid = String(session?.id || session?.user_id || '').trim();
  const me = (users || []).find((u) => String(u.id || '').trim() === sid) || {};
  const dept = _entryOrgNorm(session?.dept_name || session?.department_name || me?.dept_name || me?.department_name);
  const hq = _entryOrgNorm(session?.hq_name || me?.hq_name);
  const team = _entryOrgNorm(session?.cs_team_name || session?.team_name || me?.cs_team_name || me?.team_name);
  return { dept, hq, team };
}

function _entryResolveOrgFilterLock(session, scope) {
  if (!session || Auth.canViewAll(session)) return 'none';
  if (Auth.isManager(session) && scope.dept && scope.hq && scope.team) return 'team';
  if (Auth.isDirector(session) && scope.dept && scope.hq) return 'hq';
  if (Auth.isTopMgr(session) && scope.dept) return 'dept';
  return 'none';
}

function _entryCurrentOrgSelection() {
  return {
    dept: _entryOrgNorm(document.getElementById('filter-entry-dept')?.value),
    hq: _entryOrgNorm(document.getElementById('filter-entry-hq')?.value),
    team: _entryOrgNorm(document.getElementById('filter-entry-team')?.value),
  };
}

function _entryMatchOrgFilter(userLike, orgSel) {
  const dept = _entryOrgNorm(userLike?.deptName || userLike?.dept_name || userLike?.department_name);
  const hq = _entryOrgNorm(userLike?.hqName || userLike?.hq_name);
  const team = _entryOrgNorm(userLike?.teamName || userLike?.cs_team_name || userLike?.team_name);
  if (_entryOrgNorm(orgSel?.dept) && _entryOrgNorm(orgSel.dept) !== dept) return false;
  if (_entryOrgNorm(orgSel?.hq) && _entryOrgNorm(orgSel.hq) !== hq) return false;
  if (_entryOrgNorm(orgSel?.team) && _entryOrgNorm(orgSel.team) !== team) return false;
  return true;
}

function _entryRenderOrgFilterOptions() {
  const deptEl = document.getElementById('filter-entry-dept');
  const hqEl = document.getElementById('filter-entry-hq');
  const teamEl = document.getElementById('filter-entry-team');
  if (!deptEl || !hqEl || !teamEl) return;

  const prev = _entryCurrentOrgSelection();
  const fixed = _entryOrgFilterFixed || {};
  const lock = _entryOrgFilterLock || 'none';
  const rows = Array.isArray(_entryOrgFilterRows) ? _entryOrgFilterRows : [];

  const deptBase = lock !== 'none' ? _entryOrgNorm(fixed.dept) : prev.dept;
  const hqBase = lock === 'team' ? _entryOrgNorm(fixed.hq) : (lock === 'hq' ? _entryOrgNorm(fixed.hq) : prev.hq);
  const teamBase = lock === 'team' ? _entryOrgNorm(fixed.team) : prev.team;

  const deptVals = [...new Set(rows.map((r) => _entryOrgNorm(r.deptName)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  if (lock !== 'none' && fixed.dept && !deptVals.includes(fixed.dept)) deptVals.push(fixed.dept);
  deptVals.sort((a, b) => a.localeCompare(b, 'ko'));
  deptEl.innerHTML = '<option value="">전체</option>' + deptVals.map((v) => `<option value="${Utils.escHtml(v)}">${Utils.escHtml(v)}</option>`).join('');

  const deptVal = (deptBase && deptVals.includes(deptBase)) ? deptBase : '';
  deptEl.value = deptVal;
  const byDept = deptVal ? rows.filter((r) => _entryOrgNorm(r.deptName) === deptVal) : rows;

  const hqVals = [...new Set(byDept.map((r) => _entryOrgNorm(r.hqName)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  if ((lock === 'hq' || lock === 'team') && fixed.hq && !hqVals.includes(fixed.hq)) hqVals.push(fixed.hq);
  hqVals.sort((a, b) => a.localeCompare(b, 'ko'));
  hqEl.innerHTML = '<option value="">전체</option>' + hqVals.map((v) => `<option value="${Utils.escHtml(v)}">${Utils.escHtml(v)}</option>`).join('');
  const hqVal = (hqBase && hqVals.includes(hqBase)) ? hqBase : '';
  hqEl.value = hqVal;
  const byHq = hqVal ? byDept.filter((r) => _entryOrgNorm(r.hqName) === hqVal) : byDept;

  const teamVals = [...new Set(byHq.map((r) => _entryOrgNorm(r.teamName)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  if (lock === 'team' && fixed.team && !teamVals.includes(fixed.team)) teamVals.push(fixed.team);
  teamVals.sort((a, b) => a.localeCompare(b, 'ko'));
  teamEl.innerHTML = '<option value="">전체</option>' + teamVals.map((v) => `<option value="${Utils.escHtml(v)}">${Utils.escHtml(v)}</option>`).join('');
  const teamVal = (teamBase && teamVals.includes(teamBase)) ? teamBase : '';
  teamEl.value = teamVal;

  deptEl.disabled = lock !== 'none';
  hqEl.disabled = lock === 'team' || lock === 'hq';
  teamEl.disabled = lock === 'team';
}

function _entryResetOrgFilterToDefault() {
  const deptEl = document.getElementById('filter-entry-dept');
  const hqEl = document.getElementById('filter-entry-hq');
  const teamEl = document.getElementById('filter-entry-team');
  if (!deptEl || !hqEl || !teamEl) return;
  if (_entryOrgFilterLock === 'none') {
    deptEl.value = '';
    hqEl.value = '';
    teamEl.value = '';
  } else {
    _entryRenderOrgFilterOptions();
  }
}

function _entryApplyConsultantViewGate(entries, canViewStaffRecords) {
  if (!canViewStaffRecords || _entryRecordViewMode !== 'consultant') return Array.isArray(entries) ? entries : [];
  return (entries || []).filter((e) => (
    String(e.status || '').trim() === 'approved'
    && String(e.work_category_name || '').trim() === '일반자문업무'
  ));
}

function _entryNormalizedName(v) {
  return String(v || '').trim().toLowerCase();
}

function _entryResolveStaffFilterId(rawName) {
  const q = _entryNormalizedName(rawName);
  const orgSel = _entryCurrentOrgSelection();
  if (!q) return '';
  if (_entryStaffFilterSelectedId) {
    const hit = (_entryStaffFilterUsers || []).find((u) => String(u.id || '').trim() === String(_entryStaffFilterSelectedId).trim());
    if (hit && _entryNormalizedName(hit.name) === q) {
      const meta = _entryStaffUserById[String(hit.id || '').trim()] || {};
      if (_entryMatchOrgFilter(meta, orgSel)) return String(hit.id || '').trim();
    }
  }
  const hits = (_entryStaffFilterUsers || []).filter((u) => {
    if (_entryNormalizedName(u.name) !== q) return false;
    const meta = _entryStaffUserById[String(u.id || '').trim()] || {};
    return _entryMatchOrgFilter(meta, orgSel);
  });
  if (hits.length === 1) return String(hits[0].id || '').trim();
  return '';
}

function _entryHideStaffSuggest() {
  const list = document.getElementById('filter-entry-staff-suggest');
  if (list) {
    list.hidden = true;
    list.innerHTML = '';
  }
}

function _entryPositionStaffSuggest() {
  const input = document.getElementById('filter-entry-staff');
  const list = document.getElementById('filter-entry-staff-suggest');
  if (!input || !list) return;
  const rect = input.getBoundingClientRect();
  const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
  const maxW = Math.min(240, Math.max(160, viewportW - 24));
  const wantW = Math.min(maxW, Math.max(Math.round(rect.width), 180));
  // 기본은 입력창 우측에 맞춰 붙이고(화면 밖 방지), 공간이 충분하면 좌측 정렬
  const wouldOverflowRight = rect.left + wantW > (viewportW - 8);
  if (wouldOverflowRight) {
    list.style.left = 'auto';
    list.style.right = '0';
  } else {
    list.style.left = '0';
    list.style.right = 'auto';
  }
  list.style.width = `${wantW}px`;
  list.style.maxWidth = `${maxW}px`;
}

function _entryRenderStaffSuggest(rawKeyword) {
  const list = document.getElementById('filter-entry-staff-suggest');
  if (!list) return;
  const q = _entryNormalizedName(rawKeyword);
  const orgSel = _entryCurrentOrgSelection();
  if (!q) {
    _entryHideStaffSuggest();
    return;
  }
  const matches = (_entryStaffFilterUsers || [])
    .filter((u) => {
      const meta = _entryStaffUserById[String(u.id || '').trim()] || {};
      return _entryMatchOrgFilter(meta, orgSel);
    })
    .filter((u) => _entryNormalizedName(u.name).includes(q))
    .slice(0, 20);
  if (!matches.length) {
    _entryHideStaffSuggest();
    return;
  }
  list.innerHTML = matches.map((u) => {
    const rawName = String(u.name || '');
    const escName = Utils.escHtml(rawName);
    const jsSafeId = String(u.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const jsSafeName = rawName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `<li role="option" style="padding:8px 10px;cursor:pointer;font-size:12.5px" onmousedown="entrySelectStaffFilter('${jsSafeId}','${jsSafeName}')">${escName}</li>`;
  }).join('');
  _entryPositionStaffSuggest();
  list.hidden = false;
}

function onEntryOrgFilterChange(level) {
  const lv = String(level || '');
  if (lv === 'dept') {
    const hqEl = document.getElementById('filter-entry-hq');
    const teamEl = document.getElementById('filter-entry-team');
    if (hqEl && _entryOrgFilterLock === 'none') hqEl.value = '';
    if (teamEl && _entryOrgFilterLock === 'none') teamEl.value = '';
  } else if (lv === 'hq') {
    const teamEl = document.getElementById('filter-entry-team');
    if (teamEl && _entryOrgFilterLock !== 'team') teamEl.value = '';
  }
  _entryRenderOrgFilterOptions();
  const staffEl = document.getElementById('filter-entry-staff');
  if (staffEl) staffEl.value = '';
  _entryStaffFilterSelectedId = '';
  _entryHideStaffSuggest();
  _entriesPage = 1;
  loadMyEntries();
}

function _entryBindStaffSuggestOnce() {
  if (_entryStaffSuggestBound) return;
  const input = document.getElementById('filter-entry-staff');
  if (!input) return;
  input.addEventListener('blur', () => {
    setTimeout(() => _entryHideStaffSuggest(), 120);
  });
  document.addEventListener('click', (e) => {
    const target = e.target;
    const wrap = document.getElementById('filter-entry-staff-group');
    if (!wrap || !target) return;
    if (!wrap.contains(target)) _entryHideStaffSuggest();
  });
  _entryStaffSuggestBound = true;
}

function onEntryStaffFilterInput() {
  const input = document.getElementById('filter-entry-staff');
  const raw = String(input?.value || '').trim();
  const selected = (_entryStaffFilterUsers || []).find((u) => String(u.id || '').trim() === String(_entryStaffFilterSelectedId || '').trim());
  if (!selected || _entryNormalizedName(selected.name) !== _entryNormalizedName(raw)) {
    _entryStaffFilterSelectedId = '';
  }
  _entryRenderStaffSuggest(raw);
  _entriesPage = 1;
  if (_entryStaffInputTimer) clearTimeout(_entryStaffInputTimer);
  _entryStaffInputTimer = setTimeout(() => {
    _entryStaffInputTimer = null;
    loadMyEntries();
  }, 180);
}

function entrySelectStaffFilter(id, name) {
  const input = document.getElementById('filter-entry-staff');
  if (input) input.value = String(name || '').trim();
  _entryStaffFilterSelectedId = String(id || '').trim();
  if (_entryStaffInputTimer) {
    clearTimeout(_entryStaffInputTimer);
    _entryStaffInputTimer = null;
  }
  _entryHideStaffSuggest();
  _entriesPage = 1;
  loadMyEntries();
}

async function _entryPopulateStaffFilterOptions(session, canViewStaffRecords) {
  const input = document.getElementById('filter-entry-staff');
  _entryStaffFilterUsers = [];
  _entryStaffUserById = {};
  _entryOrgFilterRows = [];
  _entryOrgFilterLock = 'none';
  _entryOrgFilterFixed = { dept: '', hq: '', team: '' };
  _entryStaffFilterSelectedId = '';
  if (!input || !canViewStaffRecords) {
    _entryHideStaffSuggest();
    return;
  }
  let users = [];
  try {
    users = await Master.users();
  } catch (_) {
    users = [];
  }
  const myId = String((session && (session.id || session.user_id)) || '').trim();
  const scoped = (users || []).filter((u) => {
    if (u.deleted === true || u.is_active === false) return false;
    if (Auth.canViewAll(session)) return true;
    const uid = String(u.id || '').trim();
    if (myId && uid === myId) return true;
    return Auth.scopeMatch(session, u);
  }).map((u) => ({
    id: String(u.id || '').trim(),
    name: String(u.name || '').trim(),
  })).filter((u) => u.id && u.name);
  const dedupe = new Map();
  scoped.forEach((u) => {
    const key = `${u.id}|${u.name}`;
    if (!dedupe.has(key)) dedupe.set(key, u);
  });
  _entryStaffFilterUsers = [...dedupe.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  _entryStaffFilterUsers.forEach((u) => {
    const id = String(u.id || '').trim();
    if (!id) return;
    const src = (users || []).find((x) => String(x.id || '').trim() === id) || {};
    const meta = {
      hqName: String(src.hq_name || '').trim(),
      teamName: String(src.cs_team_name || src.team_name || '').trim(),
      deptName: String(src.dept_name || src.department_name || '').trim(),
    };
    _entryStaffUserById[id] = meta;
    _entryOrgFilterRows.push({ ...meta, userId: id, userName: String(u.name || '').trim() });
  });
  const scope = _entryResolveSessionOrgScope(session, users || []);
  const lock = _entryResolveOrgFilterLock(session, scope);
  _entryOrgFilterLock = lock;
  _entryOrgFilterFixed = {
    dept: lock !== 'none' ? scope.dept : '',
    hq: (lock === 'hq' || lock === 'team') ? scope.hq : '',
    team: lock === 'team' ? scope.team : '',
  };
  _entryRenderOrgFilterOptions();
  _entryBindStaffSuggestOnce();
  _entryHideStaffSuggest();
}

function _entrySyncConsultantColumns(canViewStaffRecords) {
  const show = !!(canViewStaffRecords && _entryRecordViewMode === 'consultant');
  const isBatchMode = !show && _entrySheetMode === 'batch';
  const showAuthor = canViewStaffRecords || isBatchMode;
  const table = document.getElementById('my-entries-table');
  const thDuration = document.querySelector('.th-duration');
  const thAction = document.querySelector('.th-action');
  if (thDuration) thDuration.textContent = show ? '소요시간' : '업무시간';
  if (thAction) thAction.textContent = (show || isBatchMode) ? '상세보기' : '관리';
  const thTeam = document.querySelector('.th-team');
  if (thTeam) thTeam.textContent = isBatchMode ? '소속' : '소속(본부)';
  document.querySelectorAll('.my-entries-col-perf,.my-entries-col-quality').forEach((el) => {
    el.style.display = show ? '' : 'none';
  });
  document.querySelectorAll('.my-entries-col-author,.th-author').forEach((el) => {
    el.style.display = showAuthor ? '' : 'none';
  });
  document.querySelectorAll('.my-entries-col-client,.my-entries-col-category,.my-entries-col-subcat,.th-client,.td-client,.th-category,.td-category,.th-subcat,.td-subcat').forEach((el) => {
    el.style.display = isBatchMode ? 'none' : '';
  });
  document.querySelectorAll('.my-entries-col-start,.th-start,.td-start,.my-entries-col-end,.th-end,.td-end,.my-entries-col-status,.th-status,.td-status').forEach((el) => {
    if (el.classList.contains('my-entries-col-status') || el.classList.contains('th-status') || el.classList.contains('td-status')) {
      el.style.display = show ? 'none' : '';
      return;
    }
    el.style.display = (show || isBatchMode) ? 'none' : '';
  });
  document.querySelectorAll('.my-entries-col-action,.th-action,.td-action').forEach((el) => {
    el.style.display = '';
  });
  document.querySelectorAll('.my-entries-col-duration,.th-duration,.td-duration').forEach((el) => {
    el.style.display = '';
  });
  if (table) {
    table.style.tableLayout = (show || isBatchMode) ? 'auto' : 'fixed';
    table.style.width = '100%';
  }
}

function _entryIsBatchHeaderEntry(entry) {
  const mode = String(entry && entry.entry_mode || '').trim();
  if (mode === 'batch') return true;
  return String(entry && entry.work_description || '').trim().startsWith('[일괄기록]');
}

function _entryApplySheetModeFilter(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (_entrySheetMode === 'batch') return list.filter((e) => _entryIsBatchHeaderEntry(e));
  return list.filter((e) => !_entryIsBatchHeaderEntry(e));
}

function _entryApplySheetModeUi(canViewStaffRecords) {
  const note = document.getElementById('entry-sheet-mode-note');
  const useConsultant = canViewStaffRecords && _entryRecordViewMode === 'consultant';
  if (useConsultant) _entrySheetMode = 'normal';
  if (note) note.style.display = (!useConsultant && _entrySheetMode === 'batch') ? '' : 'none';
  _entrySyncMainTabsUi(canViewStaffRecords);
}

function _entryApplyRecordViewUi(canViewStaffRecords) {
  const tabs = document.getElementById('entry-record-view-tabs');
  const panel = document.getElementById('entry-consultant-panel');
  const staffGroup = document.getElementById('filter-entry-staff-group');
  const deptGroup = document.getElementById('filter-entry-dept-group');
  const hqGroup = document.getElementById('filter-entry-hq-group');
  const teamGroup = document.getElementById('filter-entry-team-group');
  const clientGroup = document.getElementById('filter-entry-client-group');
  const categoryGroup = document.getElementById('filter-entry-category-group');
  const subcategoryGroup = document.getElementById('filter-entry-subcategory-group');
  const statusGroup = document.getElementById('filter-entry-status-group');
  const note = document.getElementById('entry-view-mode-note');
  if (tabs) tabs.style.display = '';
  const useConsultant = canViewStaffRecords && _entryRecordViewMode === 'consultant';
  if (staffGroup) staffGroup.style.display = canViewStaffRecords ? '' : 'none';
  if (deptGroup) deptGroup.style.display = useConsultant ? '' : 'none';
  if (hqGroup) hqGroup.style.display = useConsultant ? '' : 'none';
  if (teamGroup) teamGroup.style.display = useConsultant ? '' : 'none';
  if (clientGroup) clientGroup.style.display = useConsultant ? 'none' : '';
  if (categoryGroup) categoryGroup.style.display = useConsultant ? 'none' : '';
  if (subcategoryGroup) subcategoryGroup.style.display = useConsultant ? 'none' : '';
  if (statusGroup) statusGroup.style.display = useConsultant ? 'none' : '';
  if (panel) panel.style.display = useConsultant ? '' : 'none';
  if (note) note.style.display = useConsultant ? '' : 'none';
  _entrySyncMainTabsUi(canViewStaffRecords);
  _entryApplySheetModeUi(canViewStaffRecords);
  if (useConsultant) _entryRenderOrgFilterOptions();
  _entrySyncConsultantColumns(canViewStaffRecords);
}

function _entryRenderConsultantSummary(entries, canViewStaffRecords) {
  const panel = document.getElementById('entry-consultant-panel');
  const body = document.getElementById('entry-consultant-summary-body');
  const badge = document.getElementById('entry-consultant-summary-badge');
  const kpiConsultant = document.getElementById('entry-kpi-consultant-count');
  const kpiRecord = document.getElementById('entry-kpi-record-count');
  const kpiQuality = document.getElementById('entry-kpi-quality-avg');
  const kpiIndependent = document.getElementById('entry-kpi-independent-rate');
  if (!panel || !body || !badge) return;
  const useConsultant = canViewStaffRecords && _entryRecordViewMode === 'consultant';
  panel.style.display = useConsultant ? '' : 'none';
  if (!useConsultant) return;
  const list = Array.isArray(entries) ? entries : [];
  const groups = new Map();
  list.forEach((e) => {
    const name = String(e.user_name || '').trim() || '(이름없음)';
    const uid = String(e.user_id || '').trim();
    const key = uid ? `id:${uid}` : `name:${name}`;
    if (!groups.has(key)) {
      const userMeta = (uid && _entryStaffUserById[String(uid)]) || null;
      groups.set(key, {
        name,
        orgLabel: _entryOrgLabelByUser(userMeta, String(e.team_name || '').trim()),
        total: 0,
        independent: 0,
        qualityStarsTotal: 0,
        qualityEvalCount: 0,
        latestTs: 0,
      });
    }
    const g = groups.get(key);
    g.total += 1;
    const perf = String(e.performance_type || '').trim() || '미평가';
    if (perf === 'independent') g.independent += 1;
    const qStars = _entryQualityStars(e);
    if (qStars > 0) {
      g.qualityStarsTotal += qStars;
      g.qualityEvalCount += 1;
    }
    const ts = _entryParseWorkStartTs(e);
    if (ts > g.latestTs) g.latestTs = ts;
  });
  const rows = [...groups.values()].sort((a, b) => {
    const aQuality = Number(a.qualityEvalCount || 0) > 0
      ? ((Number(a.qualityStarsTotal || 0) / Number(a.qualityEvalCount || 1)) / 3) * 100
      : -1;
    const bQuality = Number(b.qualityEvalCount || 0) > 0
      ? ((Number(b.qualityStarsTotal || 0) / Number(b.qualityEvalCount || 1)) / 3) * 100
      : -1;
    if (bQuality !== aQuality) return bQuality - aQuality;
    if (b.total !== a.total) return b.total - a.total;
    return Number(b.latestTs || 0) - Number(a.latestTs || 0);
  });
  const totalRecords = rows.reduce((sum, r) => sum + Number(r.total || 0), 0);
  const totalIndependent = rows.reduce((sum, r) => sum + Number(r.independent || 0), 0);
  const totalQualityStars = rows.reduce((sum, r) => sum + Number(r.qualityStarsTotal || 0), 0);
  const totalQualityEval = rows.reduce((sum, r) => sum + Number(r.qualityEvalCount || 0), 0);
  const avgQualityPct = totalQualityEval > 0 ? (((totalQualityStars / totalQualityEval) / 3) * 100).toFixed(1) : '-';
  const indepRate = totalRecords > 0 ? ((totalIndependent / totalRecords) * 100).toFixed(1) : '0.0';
  badge.textContent = `${rows.length}명`;
  if (kpiConsultant) kpiConsultant.textContent = `${rows.length}명`;
  if (kpiRecord) kpiRecord.textContent = `${totalRecords}건`;
  if (kpiQuality) kpiQuality.textContent = avgQualityPct === '-' ? '-' : `${avgQualityPct}%`;
  if (kpiIndependent) kpiIndependent.textContent = `${indepRate}%`;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-inbox"></i><p>직원별 요약 데이터가 없습니다.</p></td></tr>';
    return;
  }
  body.innerHTML = rows.map((r, idx) => {
    const latest = r.latestTs ? Utils.formatDate(r.latestTs) : '-';
    const orgLabel = r.orgLabel || '—';
    const indepRateRow = r.total > 0 ? ((Number(r.independent || 0) / Number(r.total || 1)) * 100).toFixed(1) : '0.0';
    const avgQualityPct = r.qualityEvalCount > 0 ? (((r.qualityStarsTotal / r.qualityEvalCount) / 3) * 100).toFixed(1) : '-';
    const rawName = String(r.name || '');
    const escName = Utils.escHtml(rawName);
    const escOrg = Utils.escHtml(orgLabel);
    const jsSafeName = rawName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `<tr>
      <td style="text-align:center">${idx + 1}</td>
      <td title="${escName}">${escName}</td>
      <td title="${escOrg}">${escOrg}</td>
      <td style="text-align:center;font-weight:700">${r.total}</td>
      <td style="text-align:center">${indepRateRow}%</td>
      <td style="text-align:center">${avgQualityPct === '-' ? '-' : `${avgQualityPct}%`}</td>
      <td style="text-align:center">${latest}</td>
      <td style="text-align:center">
        <button type="button" class="btn btn-sm btn-outline" onclick="entryApplyConsultantFilter('${jsSafeName}')">기록보기</button>
      </td>
    </tr>`;
  }).join('');
}

function _entryCanReadMyEntriesMenu(session) {
  if (!session) return false;
  try {
    if (typeof Auth?.canReadMenu === 'function') {
      return !!Auth.canReadMenu(session, 'my-entries', false);
    }
  } catch (_) {}
  try {
    return !!(
      Auth.canViewAll(session)
      || Auth.canViewDeptScope(session)
      || Auth.canWriteEntry(session)
      || Auth.isStaff(session)
      || Auth.isManager(session)
    );
  } catch (_) {
    return false;
  }
}

function _entrySyncMainTabsUi(canViewStaffRecords) {
  document.querySelectorAll('[data-entry-main-tab]').forEach((btn) => {
    const mode = String(btn.getAttribute('data-entry-main-tab') || '').trim();
    if (mode === 'consultant') {
      btn.style.display = canViewStaffRecords ? '' : 'none';
    }
  });
  const activeMode = (canViewStaffRecords && _entryRecordViewMode === 'consultant')
    ? 'consultant'
    : (_entrySheetMode === 'batch' ? 'batch' : 'individual');
  document.querySelectorAll('[data-entry-main-tab]').forEach((btn) => {
    const mode = String(btn.getAttribute('data-entry-main-tab') || '').trim();
    btn.classList.toggle('is-active', mode === activeMode);
  });
}

function switchMyEntriesMainTab(mode) {
  const session = getSession ? getSession() : null;
  const canViewStaffRecords = !!(session && (Auth.canViewAll(session) || Auth.canViewDeptScope(session) || _entryCanReadMyEntriesMenu(session)));
  const next = String(mode || '').trim();

  if (next === 'consultant' && canViewStaffRecords) {
    _entryRecordViewMode = 'consultant';
    _entrySheetMode = 'normal';
  } else if (next === 'batch') {
    _entryRecordViewMode = 'all';
    _entrySheetMode = 'batch';
  } else {
    _entryRecordViewMode = 'all';
    _entrySheetMode = 'normal';
  }

  try { sessionStorage.setItem('my_entries_sheet_mode', _entrySheetMode); } catch (_) {}
  _entriesPage = 1;
  _entryApplyRecordViewUi(canViewStaffRecords);
  _entryApplySheetModeUi(canViewStaffRecords);
  _entrySyncMainTabsUi(canViewStaffRecords);
  _entryRenderConsultantSummary(_entryLastFilteredEntries, canViewStaffRecords);
  loadMyEntries();
}

function switchEntryRecordView(mode) {
  const next = String(mode || '').trim() === 'consultant' ? 'consultant' : 'all';
  if (next === 'consultant') return switchMyEntriesMainTab('consultant');
  return switchMyEntriesMainTab(_entrySheetMode === 'batch' ? 'batch' : 'individual');
}

function switchMyEntriesSheetMode(mode) {
  return switchMyEntriesMainTab(String(mode || '').trim() === 'batch' ? 'batch' : 'individual');
}

function entryApplyConsultantFilter(name) {
  const input = document.getElementById('filter-entry-staff');
  const raw = String(name || '').trim();
  if (input) input.value = raw;
  _entryStaffFilterSelectedId = _entryResolveStaffFilterId(raw);
  _entriesPage = 1;
  loadMyEntries();
}

function entryClearConsultantDrilldown() {
  const input = document.getElementById('filter-entry-staff');
  if (input) input.value = '';
  if (_entryStaffInputTimer) {
    clearTimeout(_entryStaffInputTimer);
    _entryStaffInputTimer = null;
  }
  _entryStaffFilterSelectedId = '';
  _entryHideStaffSuggest();
  _entriesPage = 1;
  loadMyEntries();
}

async function init_my_entries() {
  const session = getSession();
  const isAdminAll = Auth.canViewAll(session);
  const canViewStaffRecords = isAdminAll || Auth.canViewDeptScope(session) || _entryCanReadMyEntriesMenu(session);
  const pageSection = document.getElementById('page-my-entries');
  if (pageSection) pageSection.classList.toggle('admin-all-entries', canViewStaffRecords);
  if (!canViewStaffRecords) _entryRecordViewMode = 'all';
  try {
    const savedMode = String(sessionStorage.getItem('my_entries_sheet_mode') || 'normal').trim();
    _entrySheetMode = savedMode === 'batch' ? 'batch' : 'normal';
  } catch (_) {
    _entrySheetMode = 'normal';
  }
  _entryApplyRecordViewUi(canViewStaffRecords);
  await _entryPopulateStaffFilterOptions(session, canViewStaffRecords);
  if (canViewStaffRecords && document.getElementById('pageTitle')) {
    document.getElementById('pageTitle').textContent = '컨설턴트 업무 기록';
  }

  if (!Auth.canWriteEntry(session) && !canViewStaffRecords) {
    if (!Auth.isStaff(session) && !Auth.isManager(session)) {
      navigateTo('dashboard');
      Toast.warning('My Time Sheet는 Staff/Manager 또는 권한이 부여된 관리자만 접근 가능합니다.');
      return;
    }
    // 승인자 미지정 staff 조기 차단
    if (Auth.isStaff(session) && !Auth.hasApprover(session)) {
      navigateTo('archive');
      Toast.warning('승인자가 지정되지 않아 타임시트를 조회할 수 없습니다.');
      return;
    }
  }
  _entriesPage = 1;

  // 기간 From/To 초기값: 이번 달 1일 ~ 말일
  const now   = new Date();
  const y     = now.getFullYear();
  const m     = now.getMonth(); // 0-based
  const from  = new Date(y, m, 1);
  const to    = new Date(y, m + 1, 0);
  const fmt   = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  document.getElementById('filter-entry-date-from').value = fmt(from);
  document.getElementById('filter-entry-date-to').value   = fmt(to);
  _entryBindQuickRangeButtons();

  const [clients, categories, subcategories] = await Promise.all([
    Master.clients(), Master.categories(), Master.subcategories()
  ]);

  // 고객사 (텍스트 검색형)
  if (typeof ClientSearchSelect !== 'undefined') {
    ClientSearchSelect.init('filter-entry-client-wrap', clients, { placeholder: '고객사 검색/선택 (전체)' });
  }

  // 대분류
  const catEl = document.getElementById('filter-entry-category');
  catEl.innerHTML = '<option value="">전체 대분류</option>';
  categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.category_name;
    catEl.appendChild(opt);
  });

  // 소분류 전체 목록을 data 속성에 보관 (대분류 변경 시 동적 필터링용)
  const subEl = document.getElementById('filter-entry-subcategory');
  subEl.dataset.baseRows = JSON.stringify((subcategories || []).map((s) => ({
    id: s.id,
    category_id: s.category_id,
    sub_category_name: s.sub_category_name,
  })));
  subEl.dataset.filterMode = 'subcategory';
  _entryRestoreNormalSubcategoryFilterOptions('');

  await loadMyEntries();
}

// 대분류 변경 시 소분류 동적 필터
async function onEntryFilterCategoryChange() {
  const catId = document.getElementById('filter-entry-category').value;
  const subEl = document.getElementById('filter-entry-subcategory');
  if (!subEl) return;
  subEl.value = '';
  if (_entryIsProjectFilterCategorySelected()) {
    await _entryUseProjectMainFilterOptions();
    return;
  }
  _entryRestoreNormalSubcategoryFilterOptions(catId);
}

/** Staff 업무 기록/엑셀: 최신 500건만 보면 상태·기간 필터가 어긋남 → 페이지 순회·필요 시 user_id/status 서버 필터 */
async function _loadTimeEntriesForMyList(session, isAdminAll, statusVal) {
  if (!isAdminAll && (Auth.isStaff(session) || Auth.isManager(session))) {
    const uid = encodeURIComponent(String(session.id));
    return API.listAllPages('time_entries', { filter: `user_id=eq.${uid}`, sort: 'updated_at', limit: 400, maxPages: 100 });
  }
  if (statusVal) {
    return API.listAllPages('time_entries', {
      filter: `status=eq.${encodeURIComponent(statusVal)}`,
      sort: 'updated_at',
      limit: 400,
      maxPages: 100,
    });
  }
  try {
    return await API.listAllPages('time_entries', { filter: 'status=neq.draft', sort: 'updated_at', limit: 400, maxPages: 100 });
  } catch (err) {
    console.warn('[entry] status=neq.draft 실패, 전체 순회 후 draft 제외', err);
    const all = await API.listAllPages('time_entries', { sort: 'updated_at', limit: 400, maxPages: 100 });
    return all.filter(e => e.status !== 'draft');
  }
}

async function _scopeEntriesForStaffRecords(entries, session) {
  if (!Array.isArray(entries) || !session) return [];
  if (Auth.canViewAll(session)) return entries;
  if (!Auth.canViewDeptScope(session) && !_entryCanReadMyEntriesMenu(session)) return entries;
  let users = [];
  try {
    users = await Master.users();
  } catch (_) {
    users = [];
  }
  const myId = String(session.id || '').trim();
  const scopeUserIds = new Set(
    (users || [])
      .filter((u) => Auth.scopeMatch(session, u))
      .map((u) => String(u.id || '').trim())
      .filter(Boolean)
  );
  if (myId) scopeUserIds.add(myId);
  return (entries || []).filter((e) => {
    const uid = String((e && e.user_id) || '').trim();
    if (uid) return scopeUserIds.has(uid);
    return Auth.scopeMatch(session, e);
  });
}

async function loadMyEntries() {
  const requestSeq = ++_entryLoadRequestSeq;
  _entrySyncRangeButtonState();
  const session      = getSession();
  const isAdminAll   = Auth.canViewAll(session);
  const canViewStaffRecords = isAdminAll || Auth.canViewDeptScope(session) || _entryCanReadMyEntriesMenu(session);
  const useConsultantMode = canViewStaffRecords && _entryRecordViewMode === 'consultant';
  const dateFrom     = document.getElementById('filter-entry-date-from').value;  // 'YYYY-MM-DD'
  const dateTo       = document.getElementById('filter-entry-date-to').value;
  const clientId     = (typeof ClientSearchSelect !== 'undefined')
    ? (ClientSearchSelect.getValue('filter-entry-client-wrap')?.id || '')
    : '';
  const categoryId   = document.getElementById('filter-entry-category').value;
  const subcategoryId= document.getElementById('filter-entry-subcategory').value;
  const status       = document.getElementById('filter-entry-status').value;
  const orgSel       = _entryCurrentOrgSelection();
  const staffRaw     = String(document.getElementById('filter-entry-staff')?.value || '').trim();
  const staffKw      = staffRaw.toLowerCase();
  const staffId      = _entryResolveStaffFilterId(staffRaw);

  // From/To → 밀리초 범위
  const tsFrom = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
  const tsTo   = dateTo   ? new Date(dateTo   + 'T23:59:59').getTime() : null;

  try {
    const queryStatus = useConsultantMode ? '' : status;
    let entries = await _loadTimeEntriesForMyList(session, isAdminAll, queryStatus);
    entries = await _scopeEntriesForStaffRecords(entries, session);

    // 기간 From~To 필터 — ms숫자/숫자문자열/ISO문자열 모두 안전 처리
    if (tsFrom || tsTo) {
      entries = entries.filter(e => {
        if (!e.work_start_at) return false;
        const raw = e.work_start_at;
        const num = Number(raw);
        let ts;
        if (!isNaN(num) && num > 1000000000000) ts = num;
        else if (!isNaN(num) && num > 1000000000) ts = num * 1000;
        else ts = new Date(raw).getTime();
        if (isNaN(ts)) return false;
        if (tsFrom && ts < tsFrom) return false;
        if (tsTo   && ts > tsTo)   return false;
        return true;
      });
    }

    if (!useConsultantMode && clientId) entries = entries.filter(e => e.client_id === clientId);
    if (!useConsultantMode && categoryId) entries = entries.filter(e => e.work_category_id === categoryId);
    if (!useConsultantMode && subcategoryId) {
      if (_entryFilterIsProjectMainValue(subcategoryId)) {
        await _entryEnsureProjectCodeTypes();
        _entryAttachProjectMainFields(entries);
        const mainCode = _entryFilterProjectMainCode(subcategoryId);
        entries = entries.filter((e) => String(e._project_main_code || '') === mainCode);
      } else if (_entryFilterIsSubcategoryNameValue(subcategoryId)) {
        const subName = _entryFilterSubcategoryName(subcategoryId).trim();
        entries = entries.filter((e) => String(e.work_subcategory_name || '').trim() === subName);
      } else {
        entries = entries.filter(e => e.work_subcategory_id === subcategoryId);
      }
    }
    if (!useConsultantMode && status) entries = entries.filter(e => String(e.status) === String(status));
    if (useConsultantMode && (orgSel.dept || orgSel.hq || orgSel.team)) {
      entries = entries.filter((e) => {
        const uid = String(e.user_id || '').trim();
        const meta = (uid && _entryStaffUserById[uid]) || {
          deptName: String(e.dept_name || e.department_name || '').trim(),
          hqName: String(e.hq_name || '').trim(),
          teamName: String(e.cs_team_name || e.team_name || '').trim(),
        };
        return _entryMatchOrgFilter(meta, orgSel);
      });
    }
    if (canViewStaffRecords && (staffKw || staffId)) {
      entries = entries.filter((e) => {
        if (staffId) return String(e.user_id || '').trim() === staffId;
        return String(e.user_name || '').toLowerCase().includes(staffKw);
      });
    }

    const hasProjectRows = entries.some((e) =>
      String(e.work_category_name || '').trim() === '프로젝트업무' && String(e.project_code || '').trim()
    );
    if (hasProjectRows) {
      await _entryEnsureProjectCodeTypes();
      _entryAttachProjectMainFields(entries);
    }

    if (requestSeq !== _entryLoadRequestSeq) return;

    const sheetF = myEntriesSheetFilter(session);
    if (sheetF) entries = entries.filter(e => _rowSheetType(e) === sheetF);
    entries = _entryApplyConsultantViewGate(entries, canViewStaffRecords);
    if (_entryRecordViewMode !== 'consultant') entries = _entryApplySheetModeFilter(entries);
    _entryLastFilteredEntries = entries.slice();
    _entryRenderConsultantSummary(_entryLastFilteredEntries, canViewStaffRecords);

    const detailPanel = document.getElementById('entry-detail-panel');
    const detailTitle = document.getElementById('entry-detail-title');
    const detailBackBtn = document.getElementById('entry-detail-back-btn');
    const drilldownActive = !useConsultantMode || !!(staffId || staffKw);
    if (detailPanel) detailPanel.style.display = drilldownActive ? '' : 'none';
    if (detailBackBtn) detailBackBtn.style.display = (useConsultantMode && drilldownActive) ? '' : 'none';
    if (detailTitle) {
      if (useConsultantMode && drilldownActive) {
        const picked = String(staffRaw || '').trim();
        detailTitle.textContent = picked ? `${picked} 상세 기록` : '상세 기록';
      } else {
        detailTitle.textContent = 'Time Log';
      }
    }
    if (useConsultantMode && !drilldownActive) return;

    // My Time Sheet 정렬: (1)반려 (2)임시저장 (3)1차검토 (4)2차검토 (5)최종승인 (6)기타
    // 동일 그룹 내: 반려·임시·1차·2차는 과거→최근, 최종승인(approved)만 최신→과거
    const _mtsStatusRank = (st) => {
      if (st === 'rejected') return 0;
      if (st === 'draft') return 1;
      if (st === 'submitted') return 2;
      if (st === 'pre_approved') return 3;
      if (st === 'approved') return 4;
      return 5;
    };
    const _mtsSortTs = (e) => {
      const raw = e?.work_start_at ?? e?.created_at;
      if (raw == null) return 0;
      const num = Number(raw);
      let ts;
      if (!isNaN(num) && num > 1000000000000) ts = num;
      else if (!isNaN(num) && num > 1000000000) ts = num * 1000;
      else ts = new Date(raw).getTime();
      return isNaN(ts) ? 0 : ts;
    };
    entries.sort((a, b) => {
      const ra = _mtsStatusRank(a.status);
      const rb = _mtsStatusRank(b.status);
      if (ra !== rb) return ra - rb;
      const ta = _mtsSortTs(a);
      const tb = _mtsSortTs(b);
      const isApprovedGroup = a.status === 'approved' && b.status === 'approved';
      if (isApprovedGroup) {
        if (ta !== tb) return tb - ta;
        return String(b.id || '').localeCompare(String(a.id || ''));
      }
      if (ta !== tb) return ta - tb;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    const totalH = entries.reduce((s,e) => s + (e.duration_minutes||0), 0);
    document.getElementById('entry-total-badge').textContent  = `전체 ${entries.length}건`;
    document.getElementById('entry-total-hours').textContent  = `총 ${(totalH/60).toFixed(1)}시간`;

    const start = (_entriesPage - 1) * ENTRIES_PER_PAGE;
    const paged = entries.slice(start, start + ENTRIES_PER_PAGE);

    // 첨부파일 맵 (content 포함)
    const attMap = await loadAttachmentsMap(paged.map(e => e.id));

    const tbody = document.getElementById('my-entries-body');
    const allHeadCols = Array.from(document.querySelectorAll('#my-entries-table thead th'));
    const emptyCols = Math.max(1, allHeadCols.filter((th) => th.style.display !== 'none').length);
    if (paged.length === 0) {
      const emptyMsg = (canViewStaffRecords && _entryRecordViewMode === 'consultant')
        ? '자문업무 상세보기 조건(최종승인 · 일반자문업무)에 맞는 데이터가 없습니다.'
        : '조회된 데이터가 없습니다.';
      tbody.innerHTML = `<tr><td colspan="${emptyCols}" class="table-empty"><i class="fas fa-inbox"></i><p>${emptyMsg}</p></td></tr>`;
    } else {
      // ── 날짜·시간 포맷 헬퍼 ─────────────────────────────
      const fmtDate = (ms) => {
        if (!ms) return '<span style="color:var(--text-muted)">—</span>';
        const d = new Date(Number(ms));
        const mo = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        return `${d.getFullYear()}.${mo}.${dd}`;
      };
      const fmtDateShort = (ms) => {
        if (!ms) return '—';
        const d = new Date(Number(ms));
        const mo = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        return `${mo}.${dd}`;
      };
      const fmtTime = (ms) => {
        if (!ms) return '—';
        const d = new Date(Number(ms));
        const hh = String(d.getHours()).padStart(2,'0');
        const mm = String(d.getMinutes()).padStart(2,'0');
        return `${hh}:${mm}`;
      };
      // 시작·종료를 한 셀에 "MM.DD HH:MM" 형태로 표시
      const fmtDatetime = (ms) => {
        if (!ms) return '<span style="color:var(--text-muted)">—</span>';
        return `<span style="font-size:11.5px;white-space:nowrap">${fmtDateShort(ms)}&nbsp;<span style="color:var(--text-secondary)">${fmtTime(ms)}</span></span>`;
      };

      tbody.innerHTML = paged.map((e, idx) => {
        const rowNo     = ((_entriesPage - 1) * ENTRIES_PER_PAGE) + idx + 1;
        // 작성일자 = created_at (기록 생성 시각)
        const writtenAt = e.created_at ? fmtDate(e.created_at) : fmtDate(e.work_start_at);
        const docNoShort = e.doc_no ? (Utils.formatDocNoShort ? Utils.formatDocNoShort(e.doc_no) : e.doc_no) : '';
        const docNoHtml = e.doc_no
          ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${Utils.escHtml(e.doc_no)}">${Utils.escHtml(docNoShort)}</div>`
          : '';

        const canEdit = e.status === 'draft' || e.status === 'rejected';
        const isOwnEntry = String(e.user_id) === String(session.id);
        const allowMutate = !canViewStaffRecords || isOwnEntry;
        const B = 'width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;background:transparent;border:none;cursor:pointer;transition:background 0.15s;';
        const btns = [];
        if (canViewStaffRecords) {
          btns.push(`<button style="${B}" onclick="openEntryDetailModal('${e.id}')" title="상세보기"><i class="fas fa-eye" style="font-size:13px;color:#94a3b8"></i></button>`);
        } else {
          btns.push(`<button style="${B}" onclick="openApprovalModal('${e.id}')" title="상세보기"><i class="fas fa-eye" style="font-size:13px;color:#94a3b8"></i></button>`);
          if (canEdit && allowMutate)            btns.push(`<button style="${B}" onclick="editEntry('${e.id}')" title="수정"><i class="fas fa-edit" style="font-size:13px;color:#94a3b8"></i></button>`);
          if (e.status==='draft' && allowMutate) btns.push(`<button style="${B}" onclick="submitSingleEntry('${e.id}')" title="제출"><i class="fas fa-paper-plane" style="font-size:13px;color:var(--primary)"></i></button>`);
          if (canEdit && allowMutate)            btns.push(`<button style="${B}" onclick="deleteEntry('${e.id}')" title="삭제"><i class="fas fa-trash" style="font-size:13px;color:#f87171"></i></button>`);
          if (e.status==='rejected' && e.reviewer_comment)
            btns.push(`<button style="${B}" onclick="showRejectReason('${(e.reviewer_comment||'').replace(/'/g,"\\'")}') " title="반려사유"><i class="fas fa-comment-alt" style="font-size:13px;color:#e07b3a"></i></button>`);
        }
        // 고객사 (내부업무는 회색 '내부' 표시)
        const clientHtml = e.client_name
          ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12.5px" title="${Utils.escHtml(e.client_name)}">${Utils.escHtml(e.client_name)}</span>`
          : `<span style="color:var(--text-muted);font-size:11px">내부</span>`;

        // 업무팀
        // 내부업무(고객사 없음)는 업무팀명이 비어있거나 '팀 선택'으로 저장된 케이스가 있어도 사용자에게는 '내부'로 통일 표기
        const isInternalRow = !e.client_name;
        const rawTeamName = String(e.team_name || '').trim();
        const teamLabel = isInternalRow ? '내부' : (rawTeamName && rawTeamName !== '팀 선택' ? rawTeamName : '');
        const teamHtml = teamLabel
          ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12px;color:${isInternalRow ? 'var(--text-muted)' : 'var(--text-secondary)'}" title="${Utils.escHtml(teamLabel)}">${Utils.escHtml(teamLabel)}</span>`
          : `<span style="color:var(--text-muted);font-size:11px">—</span>`;

        // 소분류: 프로젝트업무+프로젝트코드면 project_code_types 소분류명을 우선 표시
        const isProjRow = String(e.work_category_name || '').trim() === '프로젝트업무';
        const projSub = String(e._project_subcategory_label || '').trim();
        const hasPcode = String(e.project_code || '').trim() !== '';
        const legacySub = String(e.work_subcategory_name || '').trim();
        const primarySub = (isProjRow && hasPcode) ? (projSub || legacySub || '—') : (legacySub || '—');
        const subMainLabel = Utils.escHtml(primarySub);
        const subHtml = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12.5px"
              title="${subMainLabel}">
          ${subMainLabel}
        </span>`;

        // 대분류
        const catHtml = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12.5px"
              title="${Utils.escHtml(e.work_category_name||'')}">
          ${Utils.escHtml(e.work_category_name||'—')}
        </span>`;

        const showAuthor = canViewStaffRecords || _entrySheetMode === 'batch';
        const authorCell = showAuthor
          ? `<td class="my-entries-col-author" style="font-size:11.5px;padding:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary)" title="${Utils.escHtml(e.user_name || '')}">${Utils.escHtml(e.user_name || '—')}</td>`
          : `<td class="my-entries-col-author" style="display:none"></td>`;
        const perfLabel = _entryPerformanceTypeLabel(e.performance_type);
        const qualityLabel = _entryQualityLabel(e.quality_rating);
        const perfCell = `<td class="my-entries-col-perf" style="text-align:center;padding:0 6px;display:none">${Utils.escHtml(perfLabel)}</td>`;
        const qualityCell = `<td class="my-entries-col-quality" style="text-align:center;padding:0 6px;display:none" title="${Utils.escHtml(qualityLabel)}">${Utils.escHtml(qualityLabel || '미평가')}</td>`;

        return `<tr>
          <td class="td-no" style="text-align:center;color:var(--text-muted);font-size:12px;font-variant-numeric:tabular-nums">${rowNo}</td>
          ${authorCell}
          <td class="td-written" style="font-size:12px;white-space:nowrap;color:var(--text-secondary)">${writtenAt}${docNoHtml}</td>
          <td class="td-client" style="padding:0 10px">${clientHtml}</td>
          <td class="td-team" style="padding:0 10px">${teamHtml}</td>
          <td class="td-category" style="padding:0 10px">${catHtml}</td>
          <td class="td-subcat" style="padding:0 10px">${subHtml}</td>
          <td class="td-start" style="text-align:center;padding:0 6px">${fmtDatetime(e.work_start_at)}</td>
          <td class="td-end" style="text-align:center;padding:0 6px">${fmtDatetime(e.work_end_at)}</td>
          ${perfCell}
          ${qualityCell}
          <td class="td-duration" style="text-align:center;color:var(--text-secondary);font-size:12.5px;font-weight:600">${Utils.formatDuration(e.duration_minutes)}</td>
          <td class="td-status" style="text-align:center">${Utils.statusBadge(e.status)}</td>
          <td class="td-action" style="text-align:center;padding:0 4px">
            <div style="display:flex;gap:4px;justify-content:center;align-items:center">${btns.join('')}</div>
          </td>
        </tr>`;
      }).join('');
    }

    // tbody 재렌더 직후 신규 셀에 표시 규칙을 다시 적용해야
    // 직원별 보기에서 컬럼 헤더/데이터 매핑이 어긋나지 않는다.
    _entrySyncConsultantColumns(canViewStaffRecords);

    document.getElementById('entry-pagination').innerHTML =
      Utils.paginationHTML(_entriesPage, entries.length, 'changeEntryPage', ENTRIES_PER_PAGE);

  } catch (err) {
    console.error(err);
    Toast.error('데이터 로드 실패');
  }
}

// ─────────────────────────────────────────────
// ★ 나의 타임시트 — 업무기록 상세보기 모달
// ─────────────────────────────────────────────
async function openEntryDetailModal(entryId) {
  try {
    const entry = await API.get('time_entries', entryId);
    if (!entry) { Toast.error('데이터를 불러올 수 없습니다.'); return; }

    const isBatchEntry = String(entry.entry_mode || '').trim() === 'batch';

    const attR = isBatchEntry ? null : await API.list('attachments', { limit: 500 });
    const atts = (!isBatchEntry && attR && attR.data) ? attR.data.filter(a => a.entry_id === entryId) : [];

    // 배치 엔트리: time_entry_details 행 목록 조회
    let batchDetails = [];
    if (isBatchEntry) {
      const detailR = await API.listAllPages('time_entry_details', {
        filter: `entry_id=eq.${encodeURIComponent(entryId)}`,
        sort: 'row_order',
        limit: 200,
        maxPages: 20,
      }).catch(() => []);
      batchDetails = Array.isArray(detailR) ? detailR : (detailR?.data || []);
      // from_at 오름차순 → row_order 오름차순 순서로 정렬 (시간순 표시)
      batchDetails.sort((a, b) => (Number(a.from_at) || 0) - (Number(b.from_at) || 0) || (Number(a.row_order) || 0) - (Number(b.row_order) || 0));
    }

    const iconMap  = { excel:'fa-file-excel', word:'fa-file-word', ppt:'fa-file-powerpoint', pdf:'fa-file-pdf', link:'fa-link' };
    const colorMap = { excel:'#16a34a', word:'#1d4ed8', ppt:'#c2410c', pdf:'#b91c1c', link:'#7c3aed' };

    // ─ 오버레이 생성 ─────────────────────────────
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.style.zIndex = '9999';

    const modal = document.createElement('div');
    modal.className = 'modal modal-md';
    modal.style.cssText = `max-width:${isBatchEntry ? '700px' : '560px'};border-radius:14px;overflow:hidden`;

    // ─ 헤더 ──────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.style.cssText = 'background:#fafbfc;padding:16px 20px;border-bottom:1px solid var(--border-light)';
    header.innerHTML = `
      <h3 style="font-size:14px;font-weight:700;color:var(--text-primary);display:flex;align-items:center;gap:8px;margin:0">
        <i class="fas fa-${isBatchEntry ? 'list-alt' : 'file-alt'}" style="color:var(--primary);font-size:13px"></i>
        ${isBatchEntry ? '일괄기록 상세보기' : '업무기록 상세보기'}
      </h3>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(closeBtn);

    // ─ 바디 ──────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.cssText = 'padding:20px;max-height:70vh;overflow-y:auto';

    // 상태 배지
    const statusHtml = Utils.statusBadge(entry.status);

    if (isBatchEntry) {
      // ── 배치 전용 레이아웃 ───────────────────────
      // 요약 정보 (날짜 / 상태 / 총 소요시간만)
      const summaryGrid = document.createElement('div');
      summaryGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px 16px;margin-bottom:16px';
      summaryGrid.innerHTML = `
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">날짜</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${Utils.formatDate(entry.work_start_at)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">상태</div>
          <div>${statusHtml}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">총 소요시간</div>
          <div style="font-size:13px;font-weight:700;color:var(--primary)">${Utils.formatDurationLong(entry.duration_minutes)}</div>
        </div>`;
      body.appendChild(summaryGrid);

      // 반려 사유 (있을 때만)
      if (entry.status === 'rejected' && entry.reviewer_comment) {
        const rejectBox = document.createElement('div');
        rejectBox.style.cssText = 'background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;margin-bottom:16px;display:flex;gap:10px;align-items:flex-start';
        rejectBox.innerHTML = `
          <i class="fas fa-exclamation-circle" style="color:#ef4444;margin-top:2px;flex-shrink:0"></i>
          <div>
            <div style="font-size:11px;color:#b91c1c;font-weight:600;margin-bottom:4px">반려 사유</div>
            <div style="font-size:13px;color:#7f1d1d;line-height:1.6">${Utils.escHtml(entry.reviewer_comment)}</div>
          </div>`;
        body.appendChild(rejectBox);
      }

      // 구분선
      const hr = document.createElement('hr');
      hr.style.cssText = 'border:none;border-top:1px solid var(--border-light);margin:0 0 14px';
      body.appendChild(hr);

      // 행단위 업무 목록 테이블
      const tableLabel = document.createElement('div');
      tableLabel.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:8px;font-weight:600;display:flex;align-items:center;gap:6px';
      tableLabel.innerHTML = `<i class="fas fa-list"></i> 업무 상세 내역 <span style="background:#e0f2fe;color:#0369a1;border-radius:10px;padding:0 7px;font-size:10px;font-weight:600">${batchDetails.length}건</span>`;
      body.appendChild(tableLabel);

      const fmtHHmm = (ms) => {
        if (!ms) return '—';
        const d = new Date(Number(ms));
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      };

      const tableWrap = document.createElement('div');
      tableWrap.style.cssText = 'overflow-x:auto;border:1px solid var(--border-light);border-radius:8px';
      if (batchDetails.length === 0) {
        tableWrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">저장된 상세 내역이 없습니다.</div>';
      } else {
        const colStyle = 'padding:8px 10px;font-size:12px;border-bottom:1px solid var(--border-light);white-space:nowrap';
        const thStyle = `${colStyle};background:#f8fafc;font-weight:600;color:var(--text-secondary);text-align:center`;
        let rows = batchDetails.map((d, i) => {
          const timeRange = (d.from_at && d.to_at)
            ? `${fmtHHmm(d.from_at)}&nbsp;~&nbsp;${fmtHHmm(d.to_at)}`
            : '—';
          const dur = d.duration_minutes ? `${d.duration_minutes}분` : '—';
          const cat = Utils.escHtml(d.work_category_name || '—');
          // 프로젝트업무는 소분류 대신 project_code 표시
          const isProj = String(d.work_category_name || '').trim() === '프로젝트업무';
          const sub = isProj
            ? Utils.escHtml(d.project_code || d.work_subcategory_name || '—')
            : Utils.escHtml(d.work_subcategory_name || '—');
          const note = Utils.escHtml(d.work_note || '');
          const rowBg = i % 2 === 1 ? 'background:#f8fafc;' : '';
          return `<tr style="${rowBg}">
            <td style="${colStyle};text-align:center;color:var(--text-muted);width:36px">${i + 1}</td>
            <td style="${colStyle};color:var(--text-primary);font-weight:500">${cat}</td>
            <td style="${colStyle};color:var(--text-secondary)">${sub}</td>
            <td style="${colStyle};color:var(--text-primary);max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${note}">${note || '<span style="color:var(--text-muted)">—</span>'}</td>
            <td style="${colStyle};text-align:center;color:var(--text-secondary)">${timeRange}</td>
            <td style="${colStyle};text-align:center;font-weight:600;color:var(--primary)">${dur}</td>
          </tr>`;
        }).join('');
        tableWrap.innerHTML = `<table style="width:100%;border-collapse:collapse;min-width:460px">
          <thead>
            <tr>
              <th style="${thStyle};width:36px">No</th>
              <th style="${thStyle}">대분류</th>
              <th style="${thStyle}">소분류</th>
              <th style="${thStyle}">업무내용</th>
              <th style="${thStyle}">시작~종료</th>
              <th style="${thStyle}">소요시간</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
      }
      body.appendChild(tableWrap);

    } else {
      // ── 일반 엔트리 기존 레이아웃 ────────────────
      const detailSubLabel = _entryProjectSubcategoryLabel(entry) || '-';
      const infoGrid = document.createElement('div');
      infoGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;margin-bottom:16px';
      infoGrid.innerHTML = `
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">날짜</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${Utils.formatDate(entry.work_start_at)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">상태</div>
          <div>${statusHtml}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">고객사</div>
          <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${entry.client_name || '<span style="color:var(--text-muted)">내부</span>'}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">소요시간</div>
          <div style="font-size:13px;font-weight:700;color:var(--primary)">${Utils.formatDurationLong(entry.duration_minutes)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">대분류</div>
          <div style="font-size:13px;color:var(--text-primary)">${entry.work_category_name || '-'}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">소분류</div>
          <div style="font-size:13px;color:var(--text-primary)">${Utils.escHtml(detailSubLabel)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">시작</div>
          <div style="font-size:13px;color:var(--text-primary)">${Utils.formatDate(entry.work_start_at,'datetime')}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">종료</div>
          <div style="font-size:13px;color:var(--text-primary)">${Utils.formatDate(entry.work_end_at,'datetime')}</div>
        </div>
      `;
      body.appendChild(infoGrid);

      // 구분선
      const divider1 = document.createElement('hr');
      divider1.style.cssText = 'border:none;border-top:1px solid var(--border-light);margin:0 0 14px';
      body.appendChild(divider1);

      // 반려 사유 (있을 때만)
      if (entry.status === 'rejected' && entry.reviewer_comment) {
        const rejectBox = document.createElement('div');
        rejectBox.style.cssText = 'background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;margin-bottom:16px;display:flex;gap:10px;align-items:flex-start';
        rejectBox.innerHTML = `
          <i class="fas fa-exclamation-circle" style="color:#ef4444;margin-top:2px;flex-shrink:0"></i>
          <div>
            <div style="font-size:11px;color:#b91c1c;font-weight:600;margin-bottom:4px">반려 사유</div>
            <div style="font-size:13px;color:#7f1d1d;line-height:1.6">${entry.reviewer_comment}</div>
          </div>`;
        body.appendChild(rejectBox);
      }

      // 업무수행내용 (HTML/표 — 자료실·승인모달과 동일 파이프라인)
      const rawWorkDesc = String(entry.work_description || '').trim();
      const descSection = document.createElement('div');
      descSection.style.cssText = 'margin-bottom:16px';
      const descLabel = document.createElement('div');
      descLabel.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:8px;font-weight:600;display:flex;align-items:center;gap:6px';
      descLabel.innerHTML = '<i class="fas fa-align-left"></i> 업무수행내용';
      const descBox = document.createElement('div');
      descBox.className = 'arch-desc-view';
      descBox.style.cssText = 'max-height:320px;overflow:auto;border:1px solid var(--border-light);border-radius:8px;background:#f8fafc;padding:12px 14px;font-size:13px;line-height:1.6;word-break:break-word';
      let descInner = '';
      if (!rawWorkDesc) {
        descInner = '<span style="color:var(--text-muted);font-size:12px">(내용 없음)</span>';
      } else if (rawWorkDesc.startsWith('<')) {
        descInner = typeof window._cleanPasteHtml === 'function' ? window._cleanPasteHtml(rawWorkDesc) : rawWorkDesc;
        if (typeof window._sanitizeWorkDescHtmlForView === 'function') {
          descInner = window._sanitizeWorkDescHtmlForView(descInner);
        }
      } else {
        descInner = `<p>${Utils.escHtml(rawWorkDesc).replace(/\n/g, '<br>')}</p>`;
      }
      descBox.innerHTML = descInner;
      descSection.appendChild(descLabel);
      descSection.appendChild(descBox);
      body.appendChild(descSection);
    }

    // 첨부 결과물 (배치 엔트리에서는 표시 안 함)
    if (isBatchEntry) {
      // 배치는 위에서 이미 행 테이블로 처리 완료
    } else {
    const attLabel = document.createElement('div');
    attLabel.style.cssText = 'font-size:11px;color:var(--text-muted);margin-bottom:8px;font-weight:600;display:flex;align-items:center;gap:5px';
    attLabel.innerHTML = `<i class="fas fa-paperclip"></i> 첨부 결과물 <span style="background:#e0f2fe;color:#0369a1;border-radius:10px;padding:0 7px;font-size:10px;font-weight:600">${atts.length}건</span>`;
    body.appendChild(attLabel);

    if (atts.length === 0) {
      const noAtt = document.createElement('div');
      noAtt.style.cssText = 'color:var(--text-muted);font-size:12px;padding:10px 0;display:flex;align-items:center;gap:6px';
      noAtt.innerHTML = '<i class="fas fa-folder-open"></i> 첨부된 결과물이 없습니다.';
      body.appendChild(noAtt);
    } else {
      atts.forEach((a, idx) => {
        const icon  = iconMap[a.file_type]  || 'fa-file';
        const color = colorMap[a.file_type] || '#6b7280';
        const hasContent = a.file_content && a.file_content.startsWith('data:');
        const hasUrl     = a.file_url && a.file_url.startsWith('http');

        const item = document.createElement('div');
        item.style.cssText = 'display:flex;align-items:flex-start;gap:12px;padding:12px 14px;' +
          'background:#f8fafc;border:1px solid var(--border-light);border-radius:10px;margin-bottom:8px';

        const iconEl = document.createElement('i');
        iconEl.className = `fas ${icon}`;
        iconEl.style.cssText = `color:${color};font-size:24px;margin-top:2px;flex-shrink:0`;
        item.appendChild(iconEl);

        const info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0';
        info.innerHTML = `
          <div style="font-weight:600;font-size:13px;word-break:break-all">${a.file_name || '파일명 없음'}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;align-items:center">
            ${a.doc_type  ? `<span style="background:#e0f2fe;color:#0369a1;border-radius:4px;padding:1px 7px;font-size:11px">${a.doc_type}</span>` : ''}
            ${a.file_size ? `<span style="color:var(--text-muted);font-size:11px">${a.file_size}KB</span>` : ''}
            ${a.summary   ? `<span style="color:var(--text-secondary);font-size:12px">${a.summary}</span>` : ''}
            ${hasContent  ? `<span style="background:#dcfce7;color:#15803d;border-radius:4px;padding:1px 7px;font-size:11px"><i class="fas fa-check-circle" style="font-size:10px"></i> 저장됨</span>` : ''}
          </div>`;

        const actionWrap = document.createElement('div');
        actionWrap.style.cssText = 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center';
        if (hasContent) {
          const btn = document.createElement('button');
          btn.className = 'btn btn-sm btn-primary';
          btn.style.whiteSpace = 'nowrap';
          btn.innerHTML = '<i class="fas fa-eye"></i> 열어보기';
          btn.addEventListener('click', () => _openFilePreview(a));
          actionWrap.appendChild(btn);
        } else if (hasUrl) {
          const link = document.createElement('a');
          link.href = a.file_url;
          link.target = '_blank';
          link.className = 'btn btn-sm btn-outline';
          link.style.cssText = 'white-space:nowrap;display:inline-block';
          link.innerHTML = '<i class="fas fa-external-link-alt"></i> 링크 열기';
          actionWrap.appendChild(link);
        } else {
          const note = document.createElement('span');
          note.style.cssText = 'font-size:12px;color:var(--text-muted)';
          note.innerHTML = '<i class="fas fa-info-circle"></i> 이메일/공유폴더 확인';
          actionWrap.appendChild(note);
        }

        // ★ 추출 텍스트 버튼 영역
        if (a.extracted_text) {
          // 이미 추출됨 → 확인 버튼
          const txtBtn = document.createElement('button');
          txtBtn.className = 'btn btn-sm btn-outline';
          txtBtn.style.cssText = 'white-space:nowrap;color:#6d28d9;border-color:#c4b5fd';
          txtBtn.innerHTML = '<i class="fas fa-shield-alt"></i> 추출 텍스트 확인';
          txtBtn.addEventListener('click', () => _openExtractedTextModal(a));
          actionWrap.appendChild(txtBtn);
        } else if (hasContent) {
          // 아직 추출 안 됨 + 파일 본문 있음 → 수동 추출 버튼
          const extractBtn = document.createElement('button');
          extractBtn.className = 'btn btn-sm btn-outline';
          extractBtn.style.cssText = 'white-space:nowrap;color:#b45309;border-color:#fcd34d';
          extractBtn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기';
          extractBtn.addEventListener('click', async () => {
            extractBtn.disabled = true;
            extractBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 추출 중...';
            try {
              // Base64 → File 객체 변환
              const { blob } = _base64ToBlob(a.file_content);
              const file = new File([blob], a.file_name || 'file', { type: blob.type });
              const { text: rawText, status: extStatus } = await _extractTextFromFile(file);

              if (extStatus === 'ppt') {
                Toast.warning('⚠️ PPT 파일은 PDF로 변환 후 업로드해주세요.');
                extractBtn.disabled = false;
                extractBtn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기';
                return;
              }
              if (extStatus === 'scan_pdf') {
                Toast.warning('⚠️ 스캔된 PDF로 감지됨. 텍스트 추출이 불가합니다.');
                extractBtn.disabled = false;
                extractBtn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기';
                return;
              }
              if (!rawText) {
                Toast.warning('텍스트를 추출할 수 없습니다.');
                extractBtn.disabled = false;
                extractBtn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기';
                return;
              }

              // 마스킹
              const maskedText = await _maskSensitiveText(rawText);

              // DB 저장
              await API.patch('attachments', a.id, { extracted_text: maskedText });
              a.extracted_text = maskedText; // 로컬 객체도 갱신

              // 버튼 전환 → "추출 텍스트 확인"
              extractBtn.remove();
              const txtBtn = document.createElement('button');
              txtBtn.className = 'btn btn-sm btn-outline';
              txtBtn.style.cssText = 'white-space:nowrap;color:#6d28d9;border-color:#c4b5fd';
              txtBtn.innerHTML = '<i class="fas fa-shield-alt"></i> 추출 텍스트 확인';
              txtBtn.addEventListener('click', () => _openExtractedTextModal(a));
              actionWrap.appendChild(txtBtn);
              Toast.success(`✅ 텍스트 추출 및 마스킹 완료 (${maskedText.length.toLocaleString()}자)`);
            } catch (err) {
              Toast.error('추출 실패: ' + (err.message || ''));
              extractBtn.disabled = false;
              extractBtn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기';
            }
          });
          actionWrap.appendChild(extractBtn);
        }

        info.appendChild(actionWrap);
        item.appendChild(info);
        body.appendChild(item);
      });
    }
    } // end if (!isBatchEntry) 첨부 결과물 섹션

    // ─ 푸터 ──────────────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.style.cssText = 'padding:12px 20px;background:#fafbfc;border-top:1px solid var(--border-light);display:flex;justify-content:flex-end;gap:8px';

    const canEdit = entry.status === 'draft' || entry.status === 'rejected';

    if (canEdit) {
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-outline';
      editBtn.innerHTML = '<i class="fas fa-edit"></i> 수정';
      editBtn.addEventListener('click', () => { overlay.remove(); editEntry(entry.id); });
      footer.appendChild(editBtn);
    }

    if (entry.status === 'draft') {
      const submitBtn = document.createElement('button');
      submitBtn.className = 'btn btn-primary';
      submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 제출하기';
      submitBtn.addEventListener('click', async () => {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 제출 중...';
        try {
          await API.patch('time_entries', entry.id, { status: 'submitted' });
          overlay.remove();
          Toast.success('타임시트가 제출되었습니다.');
          await updateApprovalBadge(getSession());
          loadMyEntries();
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 제출하기';
          Toast.error('제출 실패: ' + (err.message || ''));
        }
      });
      footer.appendChild(submitBtn);
    }

    const closeOnlyBtn = document.createElement('button');
    closeOnlyBtn.className = 'btn btn-outline';
    closeOnlyBtn.innerHTML = '<i class="fas fa-times"></i> 닫기';
    closeOnlyBtn.addEventListener('click', () => overlay.remove());
    footer.appendChild(closeOnlyBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function escH(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escH); }
    });

  } catch (err) {
    console.error(err);
    Toast.error('상세보기 로드 실패: ' + (err.message || ''));
  }
}

// ─────────────────────────────────────────────
// ★ 추출 텍스트 확인 모달
// ─────────────────────────────────────────────
function _openExtractedTextModal(attachment) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.style.zIndex = '10000';

  const modal = document.createElement('div');
  modal.className = 'modal modal-lg';
  modal.style.cssText = 'max-width:680px;border-radius:14px;overflow:hidden';

  // 헤더
  const header = document.createElement('div');
  header.className = 'modal-header';
  header.style.cssText = 'background:#faf5ff;padding:14px 20px;border-bottom:1px solid #e9d5ff;display:flex;align-items:center;justify-content:space-between';
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <i class="fas fa-shield-alt" style="color:#7c3aed;font-size:14px"></i>
      <span style="font-size:14px;font-weight:700;color:#4c1d95">추출 텍스트 확인</span>
      <span style="background:#ede9fe;color:#6d28d9;border-radius:5px;padding:2px 8px;font-size:11px;font-weight:600">민감정보 마스킹 완료</span>
    </div>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);

  // 파일명 서브헤더
  const subHeader = document.createElement('div');
  subHeader.style.cssText = 'background:#f5f3ff;padding:8px 20px;border-bottom:1px solid #e9d5ff;font-size:12px;color:#5b21b6;display:flex;align-items:center;gap:6px';
  subHeader.innerHTML = `<i class="fas fa-file" style="font-size:11px"></i> <strong>${Utils.escHtml(attachment.file_name || '파일명 없음')}</strong>`;

  // 바디
  const body = document.createElement('div');
  body.className = 'modal-body';
  body.style.cssText = 'padding:16px 20px;max-height:60vh;overflow-y:auto';

  // 안내 문구
  const notice = document.createElement('div');
  notice.style.cssText = 'background:#fdf4ff;border:1px solid #e9d5ff;border-radius:8px;padding:10px 14px;font-size:12px;color:#6b21a8;display:flex;gap:8px;align-items:flex-start;margin-bottom:14px';
  notice.innerHTML = `
    <i class="fas fa-info-circle" style="margin-top:1px;flex-shrink:0"></i>
    <span>아래 텍스트는 원본 파일에서 추출 후 민감정보(금액·수입신고번호·고객사명 등)가 자동 마스킹된 내용입니다.<br>원본 파일은 변경되지 않습니다.</span>`;
  body.appendChild(notice);

  // 텍스트 본문
  const textBox = document.createElement('pre');
  textBox.style.cssText = 'background:#f8fafc;border:1px solid var(--border-light);border-radius:8px;padding:14px 16px;font-size:12px;line-height:1.8;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow-y:auto;font-family:inherit';
  textBox.textContent = attachment.extracted_text;
  body.appendChild(textBox);

  // 글자수 표시
  const charCount = document.createElement('div');
  charCount.style.cssText = 'text-align:right;font-size:11px;color:var(--text-muted);margin-top:6px';
  charCount.textContent = `총 ${attachment.extracted_text.length.toLocaleString()}자`;
  body.appendChild(charCount);

  // 푸터
  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  footer.style.cssText = 'padding:12px 20px;background:#faf5ff;border-top:1px solid #e9d5ff;display:flex;justify-content:flex-end';
  const closeFooterBtn = document.createElement('button');
  closeFooterBtn.className = 'btn btn-outline';
  closeFooterBtn.innerHTML = '<i class="fas fa-times"></i> 닫기';
  closeFooterBtn.addEventListener('click', () => overlay.remove());
  footer.appendChild(closeFooterBtn);

  modal.appendChild(header);
  modal.appendChild(subHeader);
  modal.appendChild(body);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.addEventListener('keydown', function escH(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escH); }
  });
}

// ─────────────────────────────────────────────
// ★ 첨부파일 뷰어 (My Time Sheet / Approval 공통)
// • innerHTML 대신 DOM 직접 생성 + addEventListener 사용
//   (onclick 문자열 파싱 실패 / 전역 함수 참조 실패 문제 완전 해소)
// ─────────────────────────────────────────────
let _viewerAtts = []; // 하위 호환성을 위해 유지

function openAttachmentViewer(atts, entryId, entryStatus) {
  if (!atts || atts.length === 0) return;
  _viewerAtts = atts;

  const iconMap  = { excel:'fa-file-excel', word:'fa-file-word', ppt:'fa-file-powerpoint', pdf:'fa-file-pdf', link:'fa-link' };
  const colorMap = { excel:'#16a34a', word:'#1d4ed8', ppt:'#c2410c', pdf:'#b91c1c', link:'#7c3aed' };
  const isDraft   = entryStatus === 'draft';   // draft 상태일 때만 제출 버튼 표시

  // ─ 오버레이 DOM 직접 생성 ────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.style.zIndex = '9999';

  const modal = document.createElement('div');
  modal.className = 'modal modal-md';
  modal.style.maxWidth = '560px';

  const header = document.createElement('div');
  header.className = 'modal-header';
  header.innerHTML = `<h3><i class="fas fa-paperclip" style="color:var(--primary)"></i>&nbsp;첨부 결과물 확인 (${atts.length}건)</h3>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';
  body.style.padding = '16px';

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // ─ 파일 목록 렌더링 ─────────────────────────
  atts.forEach((a, idx) => {
    const icon  = iconMap[a.file_type]  || 'fa-file';
    const color = colorMap[a.file_type] || '#6b7280';
    const hasContent = a.file_content && a.file_content.startsWith('data:');
    const hasUrl     = a.file_url && a.file_url.startsWith('http');

    // 아이템 컨테이너
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:flex-start;gap:12px;padding:12px 14px;' +
      'background:#f8fafc;border:1px solid var(--border-light);border-radius:10px;margin-bottom:8px';

    // 아이콘
    const iconEl = document.createElement('i');
    iconEl.className = `fas ${icon}`;
    iconEl.style.cssText = `color:${color};font-size:26px;margin-top:2px;flex-shrink:0`;
    item.appendChild(iconEl);

    // 정보 영역
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-weight:600;font-size:13px;word-break:break-all';
    nameEl.textContent = a.file_name || '파일명 없음';
    info.appendChild(nameEl);

    const metaEl = document.createElement('div');
    metaEl.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;align-items:center';
    if (a.doc_type)  metaEl.insertAdjacentHTML('beforeend',
      `<span style="background:#e0f2fe;color:#0369a1;border-radius:4px;padding:1px 7px;font-size:11px">${a.doc_type}</span>`);
    if (a.file_size) metaEl.insertAdjacentHTML('beforeend',
      `<span style="color:var(--text-muted);font-size:11px">${a.file_size}KB</span>`);
    if (a.summary)   metaEl.insertAdjacentHTML('beforeend',
      `<span style="color:var(--text-secondary);font-size:12px">${a.summary}</span>`);
    if (hasContent)  metaEl.insertAdjacentHTML('beforeend',
      `<span style="background:#dcfce7;color:#15803d;border-radius:4px;padding:1px 7px;font-size:11px"><i class="fas fa-check-circle" style="font-size:10px"></i> 저장된 파일</span>`);
    info.appendChild(metaEl);

    // 버튼 영역
    const actionWrap = document.createElement('div');
    actionWrap.style.marginTop = '8px';

    actionWrap.style.cssText = 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center';

    if (hasContent) {
      // ★ 파일 미리보기 버튼 (다운로드 없이 브라우저 내 바로 보기)
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-primary';
      btn.style.whiteSpace = 'nowrap';
      btn.innerHTML = '<i class="fas fa-eye"></i> 열어보기';
      btn.addEventListener('click', () => _openFilePreview(a));
      actionWrap.appendChild(btn);
    } else if (hasUrl) {
      const link = document.createElement('a');
      link.href = a.file_url;
      link.target = '_blank';
      link.className = 'btn btn-sm btn-outline';
      link.style.cssText = 'white-space:nowrap;display:inline-block';
      link.innerHTML = '<i class="fas fa-external-link-alt"></i> 링크 열기';
      actionWrap.appendChild(link);
    } else {
      const note = document.createElement('span');
      note.style.cssText = 'font-size:12px;color:var(--text-muted)';
      note.innerHTML = '<i class="fas fa-info-circle"></i> 이메일/공유폴더 확인';
      actionWrap.appendChild(note);
    }

    // ★ 추출 텍스트 버튼 (openAttachmentViewer용)
    if (a.extracted_text) {
      const txtBtn = document.createElement('button');
      txtBtn.className = 'btn btn-sm btn-outline';
      txtBtn.style.cssText = 'white-space:nowrap;color:#6d28d9;border-color:#c4b5fd';
      txtBtn.innerHTML = '<i class="fas fa-shield-alt"></i> 추출 텍스트 확인';
      txtBtn.addEventListener('click', () => _openExtractedTextModal(a));
      actionWrap.appendChild(txtBtn);
    } else if (hasContent) {
      // 아직 추출 안 됨 → 수동 추출 버튼
      const extractBtn = document.createElement('button');
      extractBtn.className = 'btn btn-sm btn-outline';
      extractBtn.style.cssText = 'white-space:nowrap;color:#b45309;border-color:#fcd34d';
      extractBtn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기';
      extractBtn.addEventListener('click', async () => {
        extractBtn.disabled = true;
        extractBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 추출 중...';
        try {
          const { blob } = _base64ToBlob(a.file_content);
          const file = new File([blob], a.file_name || 'file', { type: blob.type });
          const { text: rawText, status: extStatus } = await _extractTextFromFile(file);
          if (extStatus === 'ppt')      { Toast.warning('⚠️ PPT 파일은 PDF로 변환 후 업로드해주세요.'); extractBtn.disabled = false; extractBtn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기'; return; }
          if (extStatus === 'scan_pdf') { Toast.warning('⚠️ 스캔된 PDF로 감지됨. 텍스트 추출이 불가합니다.'); extractBtn.disabled = false; extractBtn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기'; return; }
          if (!rawText)                 { Toast.warning('텍스트를 추출할 수 없습니다.'); extractBtn.disabled = false; extractBtn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기'; return; }
          const maskedText = await _maskSensitiveText(rawText);
          await API.patch('attachments', a.id, { extracted_text: maskedText });
          a.extracted_text = maskedText;
          extractBtn.remove();
          const txtBtn = document.createElement('button');
          txtBtn.className = 'btn btn-sm btn-outline';
          txtBtn.style.cssText = 'white-space:nowrap;color:#6d28d9;border-color:#c4b5fd';
          txtBtn.innerHTML = '<i class="fas fa-shield-alt"></i> 추출 텍스트 확인';
          txtBtn.addEventListener('click', () => _openExtractedTextModal(a));
          actionWrap.appendChild(txtBtn);
          Toast.success(`✅ 텍스트 추출 및 마스킹 완료 (${maskedText.length.toLocaleString()}자)`);
        } catch (err) {
          Toast.error('추출 실패: ' + (err.message || ''));
          extractBtn.disabled = false;
          extractBtn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기';
        }
      });
      actionWrap.appendChild(extractBtn);
    }

    info.appendChild(actionWrap);
    item.appendChild(info);
    body.appendChild(item);
  });

  // ─ 하단 영역: 안내 + 제출 버튼 ─────────────────
  const footer = document.createElement('div');
  footer.style.cssText = 'padding:12px 16px 16px;border-top:1px solid var(--border-light)';

  if (isDraft && entryId) {
    // draft 상태 → 파일 확인 후 제출 유도
    const guide = document.createElement('div');
    guide.style.cssText = 'font-size:12px;color:#6b7280;margin-bottom:10px;display:flex;align-items:center;gap:6px';
    guide.innerHTML = '<i class="fas fa-info-circle" style="color:#3b82f6"></i> 파일 내용을 확인한 후 이상이 없으면 제출하세요.';
    footer.appendChild(guide);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-outline';
    cancelBtn.innerHTML = '<i class="fas fa-times"></i> 닫기';
    cancelBtn.addEventListener('click', () => overlay.remove());

    const submitBtn = document.createElement('button');
    submitBtn.className = 'btn btn-primary';
    submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 제출하기';
    submitBtn.addEventListener('click', async () => {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 제출 중...';
      try {
        await API.patch('time_entries', entryId, { status: 'submitted' });
        overlay.remove();
        Toast.success('타임시트가 제출되었습니다.');
        await updateApprovalBadge(getSession());
        loadMyEntries();
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> 제출하기';
        Toast.error('제출 실패: ' + (err.message || ''));
      }
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    footer.appendChild(btnRow);

  } else {
    // draft 외 상태 → 닫기만
    const closeOnlyBtn = document.createElement('button');
    closeOnlyBtn.className = 'btn btn-outline';
    closeOnlyBtn.style.cssText = 'float:right';
    closeOnlyBtn.innerHTML = '<i class="fas fa-times"></i> 닫기';
    closeOnlyBtn.addEventListener('click', () => overlay.remove());
    footer.appendChild(closeOnlyBtn);
  }

  modal.appendChild(footer);
}

// ─────────────────────────────────────────────
// ★ 파일 미리보기 — 타입별 브라우저 내 인라인 뷰
// ─────────────────────────────────────────────
function _base64ToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/:(.*?);/) || ['','application/octet-stream'])[1];
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), mime };
}

function _openFilePreview(a) {
  if (!a || !a.file_content || !a.file_content.startsWith('data:')) {
    Toast.error('저장된 파일 데이터가 없습니다.');
    return;
  }

  const fileType = (a.file_type || '').toLowerCase();
  const fileName = a.file_name || '파일';
  const { blob, mime } = _base64ToBlob(a.file_content);
  const blobUrl = URL.createObjectURL(blob);

  // ── 미리보기 오버레이 생성 ──────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:10000',
    'background:rgba(0,0,0,0.75)',
    'display:flex;flex-direction:column',
    'align-items:center;justify-content:flex-start',
  ].join(';');

  // 헤더 툴바
  const toolbar = document.createElement('div');
  toolbar.style.cssText = [
    'width:100%;max-width:960px',
    'display:flex;align-items:center;justify-content:space-between',
    'padding:10px 16px',
    'background:rgba(15,23,42,0.95)',
    'border-bottom:1px solid rgba(255,255,255,0.1)',
    'flex-shrink:0',
  ].join(';');

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'color:#fff;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;overflow:hidden';
  const iconClass = { pdf:'fa-file-pdf', excel:'fa-file-excel', word:'fa-file-word', ppt:'fa-file-powerpoint' }[fileType] || 'fa-file';
  const iconColor = { pdf:'#f87171', excel:'#4ade80', word:'#60a5fa', ppt:'#fb923c' }[fileType] || '#94a3b8';
  titleEl.innerHTML = `<i class="fas ${iconClass}" style="color:${iconColor};font-size:16px;flex-shrink:0"></i>
    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fileName}</span>`;

  const btnGroup = document.createElement('div');
  btnGroup.style.cssText = 'display:flex;gap:8px;flex-shrink:0';

  // 닫기 버튼
  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px';
  closeBtn.innerHTML = '<i class="fas fa-times"></i> 닫기';
  closeBtn.addEventListener('click', () => { overlay.remove(); URL.revokeObjectURL(blobUrl); });

  btnGroup.appendChild(closeBtn);
  toolbar.appendChild(titleEl);
  toolbar.appendChild(btnGroup);
  overlay.appendChild(toolbar);

  // ── 콘텐츠 영역 ──────────────────────────────────
  const content = document.createElement('div');
  content.style.cssText = 'flex:1;width:100%;max-width:960px;overflow:auto;background:#1e293b;position:relative';

  if (fileType === 'pdf' || mime === 'application/pdf') {
    // PDF → iframe 인라인 뷰
    const iframe = document.createElement('iframe');
    iframe.src = blobUrl;
    iframe.style.cssText = 'width:100%;height:100%;border:none;min-height:calc(100vh - 60px)';
    iframe.setAttribute('type', 'application/pdf');
    content.appendChild(iframe);

  } else if (fileType === 'word' || mime.includes('word') || mime.includes('officedocument.wordprocessing')) {
    // Word → mammoth.js로 HTML 변환 후 렌더 (비동기 지연 로드)
    void _renderWordPreview(content, blob, blobUrl);

  } else if (fileType === 'excel' || mime.includes('spreadsheet') || mime.includes('excel')) {
    // Excel → SheetJS로 표 렌더 (비동기 지연 로드)
    void _renderExcelPreview(content, blob, blobUrl);

  } else if (mime.startsWith('image/')) {
    // 이미지 인라인
    const img = document.createElement('img');
    img.src = blobUrl;
    img.style.cssText = 'max-width:100%;height:auto;display:block;margin:24px auto;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.4)';
    content.appendChild(img);

  } else if (mime.startsWith('text/') || fileType === 'txt') {
    // 텍스트
    _renderTextPreview(content, blob, blobUrl);

  } else {
    // 미지원 형식 안내
    const msg = document.createElement('div');
    msg.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;color:#94a3b8;gap:12px';
    msg.innerHTML = `
      <i class="fas fa-file-alt" style="font-size:48px;color:#475569"></i>
      <div style="font-size:14px;font-weight:600;color:#cbd5e1">미리보기를 지원하지 않는 형식입니다.</div>
      <div style="font-size:12px">${fileName}</div>`;
    content.appendChild(msg);
  }

  overlay.appendChild(content);
  document.body.appendChild(overlay);
  // ESC 키로 닫기
  const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); URL.revokeObjectURL(blobUrl); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
}

// ── Word 미리보기 (mammoth.js) ─────────────────────────
async function _renderWordPreview(container, blob, blobUrl) {
  const loading = _previewLoading(container, 'Word 문서 변환 중...');
  try {
    if (typeof mammoth === 'undefined') {
      if (typeof LibLoader !== 'undefined') {
        await LibLoader.load('mammoth');
      }
    }
  } catch (loadErr) {
    loading.remove();
    _previewError(container, 'mammoth.js 로드 실패: ' + (loadErr.message || ''));
    return;
  }
  if (typeof mammoth === 'undefined') {
    loading.remove();
    _previewError(container, 'mammoth.js가 로드되지 않았습니다. 페이지를 새로고침 해주세요.');
    return;
  }
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const result = await mammoth.convertToHtml({ arrayBuffer: e.target.result });
      loading.remove();
      const wrap = document.createElement('div');
      wrap.style.cssText = 'background:#fff;max-width:800px;margin:24px auto;padding:48px 56px;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.3);font-family:serif;font-size:14px;line-height:1.8;color:#1e293b';
      wrap.innerHTML = result.value || '<p style="color:#94a3b8">내용이 없습니다.</p>';
      container.appendChild(wrap);
    } catch(err) {
      loading.remove();
      _previewError(container, 'Word 변환 실패: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(blob);
}

// ── Excel 미리보기 (SheetJS) ───────────────────────────
// ★ XLSX는 지연 로드 — 승인 모달 등에서 첫 미리보기 시에도 LibLoader로 선로드
async function _renderExcelPreview(container, blob, blobUrl) {
  const loading = _previewLoading(container, 'Excel 데이터 로드 중...');
  try {
    if (typeof XLSX === 'undefined') {
      if (typeof LibLoader !== 'undefined') {
        await LibLoader.load('xlsx');
      } else {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'js/xlsx.full.min.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('XLSX 로드 실패'));
          document.head.appendChild(s);
        });
      }
    }
  } catch (loadErr) {
    loading.remove();
    _previewError(container, 'SheetJS(XLSX) 로드 실패: ' + (loadErr.message || ''));
    return;
  }
  if (typeof XLSX === 'undefined') {
    loading.remove();
    _previewError(container, 'SheetJS(XLSX)가 로드되지 않았습니다.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      loading.remove();
      // 시트 탭 + 테이블 렌더
      const wrap = document.createElement('div');
      wrap.style.cssText = 'padding:16px;overflow:auto;min-height:200px';

      // 시트 탭
      if (wb.SheetNames.length > 1) {
        const tabs = document.createElement('div');
        tabs.style.cssText = 'display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap';
        wb.SheetNames.forEach((name, i) => {
          const tab = document.createElement('button');
          tab.textContent = name;
          tab.dataset.sheet = i;
          tab.style.cssText = 'padding:4px 12px;border-radius:4px;border:1px solid #475569;background:' + (i===0?'#2563eb':'#334155') + ';color:#fff;cursor:pointer;font-size:12px';
          tab.addEventListener('click', () => {
            tabs.querySelectorAll('button').forEach(b => b.style.background='#334155');
            tab.style.background = '#2563eb';
            _renderSheetTable(tableWrap, wb, name);
          });
          tabs.appendChild(tab);
        });
        wrap.appendChild(tabs);
      }
      const tableWrap = document.createElement('div');
      wrap.appendChild(tableWrap);
      _renderSheetTable(tableWrap, wb, wb.SheetNames[0]);
      container.appendChild(wrap);
    } catch(err) {
      loading.remove();
      _previewError(container, 'Excel 로드 실패: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(blob);
}

function _renderSheetTable(wrap, wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) { wrap.innerHTML = '<p style="color:#94a3b8;padding:16px">데이터가 없습니다.</p>'; return; }
  const maxCols = Math.max(...rows.map(r => r.length));
  let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:12px;color:#e2e8f0;width:100%;min-width:400px">`;
  rows.forEach((row, ri) => {
    const isHeader = ri === 0;
    html += `<tr style="background:${isHeader ? '#1e3a5f' : ri%2===0 ? '#1e293b' : '#263245'}">`;
    for (let ci = 0; ci < maxCols; ci++) {
      const cell = row[ci] !== undefined ? String(row[ci]) : '';
      const tag = isHeader ? 'th' : 'td';
      html += `<${tag} style="border:1px solid #334155;padding:5px 10px;white-space:nowrap;${isHeader?'font-weight:700;color:#93c5fd':''}">` + cell + `</${tag}>`;
    }
    html += '</tr>';
  });
  html += '</table></div>';
  wrap.innerHTML = html;
}

// ── 텍스트 미리보기 ──────────────────────────────────
function _renderTextPreview(container, blob, blobUrl) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:#0f172a;color:#e2e8f0;padding:24px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-all;max-width:900px;margin:24px auto;border-radius:8px';
    pre.textContent = e.target.result;
    container.appendChild(pre);
  };
  reader.readAsText(blob);
}

// ── 공통 로딩/에러 ─────────────────────────────────
function _previewLoading(container, msg) {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;align-items:center;justify-content:center;height:200px;color:#94a3b8;gap:10px;font-size:13px';
  el.innerHTML = `<i class="fas fa-spinner fa-spin" style="font-size:20px"></i> ${msg}`;
  container.appendChild(el);
  return el;
}
function _previewError(container, msg) {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:#f87171;gap:8px;font-size:13px';
  el.innerHTML = `<i class="fas fa-exclamation-triangle" style="font-size:24px"></i> ${msg}`;
  container.appendChild(el);
}

// 하위 호환성 래퍼
function _doDownload(a) { _openFilePreview(a); }
function downloadBase64File(idx) { _openFilePreview(_viewerAtts[idx]); }

// ─────────────────────────────────────────────
// ★ entry_id 기반 첨부파일 뷰어 열기 (배지 클릭용)
// ─────────────────────────────────────────────
async function openAttachmentViewerById(entryId, entryStatus) {
  try {
    const r = await API.list('attachments', { limit: 500 });
    const atts = (r && r.data) ? r.data.filter(a => a.entry_id === entryId) : [];
    if (!atts.length) { Toast.info('첨부 파일이 없습니다.'); return; }
    openAttachmentViewer(atts, entryId, entryStatus);
  } catch (err) {
    Toast.error('첨부파일 조회 실패: ' + err.message);
  }
}

// ─────────────────────────────────────────────
// 첨부파일 맵 로드 (entry id 배열 → map)
// ─────────────────────────────────────────────
async function loadAttachmentsMap(entryIds) {
  if (!entryIds.length) return {};
  try {
    const r = await API.list('attachments', { limit: 500 });
    const all = (r && r.data) ? r.data : [];
    const map = {};
    all.forEach(a => {
      if (entryIds.includes(a.entry_id)) {
        if (!map[a.entry_id]) map[a.entry_id] = [];
        map[a.entry_id].push(a);
      }
    });
    return map;
  } catch { return {}; }
}

// ─────────────────────────────────────────────
// 페이지 변경
// ─────────────────────────────────────────────
function changeEntryPage(page) {
  _entriesPage = page;
  loadMyEntries();
}

function resetEntryFilter() {
  const now  = new Date();
  const y    = now.getFullYear();
  const m    = now.getMonth();
  const from = new Date(y, m, 1);
  const to   = new Date(y, m + 1, 0);
  const fmt  = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  document.getElementById('filter-entry-date-from').value    = fmt(from);
  document.getElementById('filter-entry-date-to').value      = fmt(to);
  if (typeof ClientSearchSelect !== 'undefined') ClientSearchSelect.clear('filter-entry-client-wrap');
  document.getElementById('filter-entry-category').value     = '';
  document.getElementById('filter-entry-subcategory').value  = '';
  document.getElementById('filter-entry-status').value       = '';
  _entryResetOrgFilterToDefault();
  const staffEl = document.getElementById('filter-entry-staff');
  if (staffEl) staffEl.value = '';
  _entryStaffFilterSelectedId = '';
  _entryHideStaffSuggest();
  _entrySyncRangeButtonState();

  _entryRestoreNormalSubcategoryFilterOptions('');

  loadMyEntries();
}

// ─────────────────────────────────────────────
// 수정 / 제출 / 삭제
// ─────────────────────────────────────────────
async function editEntry(id) {
  try {
    // ① 수정 대상 데이터 + 마스터 데이터 병렬 로드
    const [entry] = await Promise.all([
      API.get('time_entries', id)
    ]);
    if (!entry) { Toast.error('데이터를 찾을 수 없습니다.'); return; }

    const sheetNorm = _rowSheetType(entry);
    try { sessionStorage.setItem('entry_sheet_type', sheetNorm); } catch (_) {}

    // ② 마스터 데이터 + 폼 초기화 (신규 등록과 동일하게 드롭다운 먼저 로드)
    _editEntryId   = null;   // 잠시 null로 놓고 init_entry_new() 정상 실행
    _editMode      = false;
    _deletedAttIds = [];     // 삭제 예정 첨부 ID 초기화
    await init_entry_new();   // 드롭다운 완전 로드 완료까지 await

    // ③ 수정 모드 플래그 세팅 후 페이지 전환
    //    navigateTo가 init_entry_new()를 재호출하지 않도록 _editMode=true 선행 세팅
    _editEntryId = id;
    _editMode    = true;
    navigateTo(sheetNorm === 'daily' ? 'entry-new-daily' : 'entry-new-hourly');

    const isBatchEntry = String(entry.entry_mode || '').trim() === 'batch'
      || String(entry.work_description || '').startsWith('[일괄기록]');
    if (isBatchEntry) {
      if (sheetNorm === 'daily') {
        const modeSel = document.getElementById('entry-daily-period-mode-select');
        if (modeSel) modeSel.value = 'by_batch';
      } else {
        try { sessionStorage.setItem('entry_hourly_mode', 'by_batch'); } catch (_) {}
      }
      onDailyPeriodModeChange();
      const dRowsRaw = await API.listAllPages('time_entry_details', {
        filter: `entry_id=eq.${encodeURIComponent(id)}`,
        limit: 200,
        maxPages: 20,
        sort: 'row_order',
      }).catch(() => []);
      const dRows = Array.isArray(dRowsRaw) ? dRowsRaw : (Array.isArray(dRowsRaw?.data) ? dRowsRaw.data : []);
      // from_at 오름차순 + row_order 오름차순 정렬 → 시간 순서대로 표시
      const dRowsSorted = dRows.slice().sort(
        (a, b) => (Number(a.from_at || 0) - Number(b.from_at || 0))
          || (Number(a.row_order || 0) - Number(b.row_order || 0))
      );
      _entryBatchRows = dRowsSorted.map((r) => ({
        rowId: `b_${r.id || Math.random().toString(36).slice(2, 8)}`,
        category_id: String(r.work_category_id || '').trim(),
        category_name: String(r.work_category_name || '').trim(),
        subcategory_id: String(r.work_subcategory_id || '').trim(),
        subcategory_name: String(r.work_subcategory_name || '').trim(),
        client_id: String(r.client_id || '').trim(),
        client_name: String(r.client_name || '').trim(),
        team_id: String(r.team_id || '').trim(),
        team_name: String(r.team_name || '').trim(),
        project_code: String(r.project_code || '').trim(),
        project_name: String(r.project_name || '').trim(),
        work_note: String(r.work_note || '').trim(),
        from_at: _entryBatchToInputValue(Number(r.from_at || entry.work_start_at || Date.now())),
        to_at: _entryBatchToInputValue(Number(r.to_at || entry.work_end_at || Date.now())),
        duration_minutes: Number(r.duration_minutes || 0),
        // 수정 진입 시에는 기존 행이 자동 접히지 않도록 미확정 상태로 로드
        // (3건 이상일 때 일부 행이 누락된 것처럼 보이는 UX 문제 방지)
        confirmed: false,
      }));
      if (!_entryBatchRows.length) {
        _entryBatchRows = [_entryBatchRowDefault()];
      }
      _entryBatchExpandedRowIds.clear();
      _entryBatchSelectedRowIdx = 0;
      _entryBatchTimelineDate = _entryBatchResolveTimelineDate();
      _entryBatchRenderRows();
      _entryBatchAutosaveState('수정 모드 로드됨');
      Toast.info('일괄기록 수정 모드입니다.');
      return;
    }

    // ④ 대분류 세팅 → 소분류 목록 갱신 (onCategoryChange 동기 실행)
    const catEl = document.getElementById('entry-category');
    catEl.value = entry.work_category_id || '';
    await onCategoryChange();   // 소분류 드롭다운을 entry의 category 기준으로 재구성

    // ⑤ 소분류 세팅 (onCategoryChange 직후 바로 가능 — setTimeout 불필요)
    const subEl = document.getElementById('entry-subcategory');
    if (sheetNorm !== 'daily' && String(entry.work_category_name || '').trim() === '프로젝트업무') {
      await _entryEnsureProjectCodeTypes();
      const pcode = String(entry.project_code || '').trim();
      const mcFromCode = pcode ? String(pcode.split('_')[0] || '').trim() : '';
      const wantVal = mcFromCode ? `pcmain:${mcFromCode}` : '';
      if (wantVal && [...subEl.options].some((o) => String(o.value) === wantVal)) {
        subEl.value = wantVal;
      } else {
        const nm = String(entry.work_subcategory_name || '').trim();
        const byText = [...subEl.options].find((o) => (o.textContent || '').trim() === nm);
        subEl.value = byText ? byText.value : '';
      }
      _entrySyncHourlyProjectSubcategoryToProjectMainFilter();
    } else {
      const wantSubId = entry.work_subcategory_id || '';
      if (wantSubId && [...subEl.options].some((o) => String(o.value) === String(wantSubId))) {
        subEl.value = wantSubId;
      } else if (subEl.options.length > 1) {
        subEl.selectedIndex = 1;
      } else {
        subEl.value = '';
      }
    }

    // ⑥ 팀 세팅
    const teamEl = document.getElementById('entry-team');
    for (const opt of teamEl.options) {
      if (opt.value === entry.team_id) { opt.selected = true; break; }
    }

    // ⑦ 고객사 세팅 (ClientSearchSelect)
    ClientSearchSelect.setValue('entry-client-wrap', entry.client_id || '', entry.client_name || '');
    document.getElementById('entry-client').value = entry.client_id || '';

    // ⑧ 업무 일자 / 시작·종료 세팅
    syncEntrySheetTimeRowUI();
    if (sheetNorm === 'daily') {
      const modeSel = document.getElementById('entry-daily-period-mode-select');
      const inferred = _inferDailyPeriodModeFromEntry(entry);
      if (modeSel) modeSel.value = inferred;

      if (inferred === 'by_day_span') {
        const df = document.getElementById('entry-daily-from');
        const dto = document.getElementById('entry-daily-to');
        if (entry.work_start_at && df) {
          const startDate = new Date(Number(entry.work_start_at));
          const y = startDate.getFullYear();
          const mo = String(startDate.getMonth() + 1).padStart(2, '0');
          const da = String(startDate.getDate()).padStart(2, '0');
          df.value = `${y}-${mo}-${da}`;
        }
        if (entry.work_end_at && dto) {
          const endDate = new Date(Number(entry.work_end_at));
          const y = endDate.getFullYear();
          const mo = String(endDate.getMonth() + 1).padStart(2, '0');
          const da = String(endDate.getDate()).padStart(2, '0');
          dto.value = `${y}-${mo}-${da}`;
        }
        applyDailyPeriodFromInput();
      } else {
        if (entry.work_start_at) {
          const startDate = new Date(Number(entry.work_start_at));
          const wd = document.getElementById('entry-work-date');
          if (wd) wd.value = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
          document.getElementById('entry-start').value = `${String(startDate.getHours()).padStart(2,'0')}:${String(startDate.getMinutes()).padStart(2,'0')}`;
        }
        if (entry.work_end_at) {
          const endDate = new Date(Number(entry.work_end_at));
          document.getElementById('entry-end').value = `${String(endDate.getHours()).padStart(2,'0')}:${String(endDate.getMinutes()).padStart(2,'0')}`;
        }
        await calcDuration();
      }
      syncEntrySheetTimeRowUI();
      if ((entry.work_category_name || '').trim() === '프로젝트업무') {
        await _entryLoadDailyOpenProjects();
        const cEl = document.getElementById('entry-daily-project-code');
        const nEl = document.getElementById('entry-daily-project-name');
        const ciEl = document.getElementById('entry-daily-project-client-id');
        const cnEl = document.getElementById('entry-daily-project-client-name');
        if (cEl) cEl.value = entry.project_code || '';
        if (nEl) nEl.value = entry.project_name || '';
        if (ciEl) ciEl.value = entry.client_id || '';
        if (cnEl) cnEl.value = entry.client_name || '';
        const selBox = document.getElementById('entry-daily-project-selected');
        const selTxt = document.getElementById('entry-daily-project-selected-text');
        if (entry.project_code && selBox && selTxt) {
          selBox.style.display = '';
          selTxt.textContent = `${entry.project_code} — ${entry.project_name || ''}`;
        }
      } else {
        _entryClearDailyProjectPick();
      }
      const wl = document.getElementById('entry-work-location');
      if (wl) wl.value = entry.work_location || '';
    } else {
      if (entry.work_start_at) {
        const startDate = new Date(Number(entry.work_start_at));
        const wd = document.getElementById('entry-work-date');
        if (wd) wd.value = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
        document.getElementById('entry-start').value = `${String(startDate.getHours()).padStart(2,'0')}:${String(startDate.getMinutes()).padStart(2,'0')}`;
      }
      if (entry.work_end_at) {
        const endDate = new Date(Number(entry.work_end_at));
        document.getElementById('entry-end').value = `${String(endDate.getHours()).padStart(2,'0')}:${String(endDate.getMinutes()).padStart(2,'0')}`;
      }
      await calcDuration();
      if (String(entry.work_category_name || '').trim() === '프로젝트업무') {
        await _entryLoadDailyOpenProjects();
        const cEl = document.getElementById('entry-daily-project-code');
        const nEl = document.getElementById('entry-daily-project-name');
        const ciEl = document.getElementById('entry-daily-project-client-id');
        const cnEl = document.getElementById('entry-daily-project-client-name');
        if (cEl) cEl.value = entry.project_code || '';
        if (nEl) nEl.value = entry.project_name || '';
        if (ciEl) ciEl.value = entry.client_id || '';
        if (cnEl) cnEl.value = entry.client_name || '';
        const selBox = document.getElementById('entry-daily-project-selected');
        const selTxt = document.getElementById('entry-daily-project-selected-text');
        if (entry.project_code && selBox && selTxt) {
          selBox.style.display = '';
          selTxt.textContent = `${entry.project_code} — ${entry.project_name || ''}`;
        }
        try { ClientSearchSelect.setValue('entry-daily-proj-client-wrap', entry.client_id || '', entry.client_name || ''); } catch (_) {}
        _entrySyncHourlyProjectSubcategoryToProjectMainFilter();
      } else {
        _entryClearDailyProjectPick();
      }
      const wlH = document.getElementById('entry-work-location');
      if (wlH) wlH.value = entry.work_location || '';
    }

    updateClientSection();

    // ⑨ 소요시간: 기존 저장값 복원 (일일·일 단위는 날짜 기준 자동분이 우선)
    if (entry.duration_minutes && Number(entry.duration_minutes) > 0) {
      if (!(sheetNorm === 'daily' && _entryDailyEffectivePeriodMode() === 'by_day_span')) {
        _setDurationInput(Number(entry.duration_minutes));
      }
    }

    // ⑩ 수행내용 세팅 — 고객(자문)은 Quill, 내부/통관/프로젝트 등은 메모란(entry-memo)
    const catNameForDesc = catEl.options[catEl.selectedIndex]?.textContent || '';
    const catTypeRawDesc = catEl.options[catEl.selectedIndex]?.dataset?.type || 'client';
    const catTypeForDesc = _entryEffectiveTimeCategory(catTypeRawDesc, catNameForDesc);
    const rawDesc = entry.work_description || '';
    const memoEl = document.getElementById('entry-memo');
    const hidHtml = document.getElementById('entry-description');
    const hidMd = document.getElementById('entry-description-md');

    if (catTypeForDesc === 'client') {
      // 수정 진입 시에는 원문을 우선 로드해 첫 클릭/커서 반응 지연을 줄인다.
      // 저장 직전에 _syncQuillToHidden()에서 정리/변환을 수행하므로 데이터 정합성은 유지된다.
      const descHtml = String(rawDesc || '').trim();
      // Quill은 dangerouslyPasteHTML/innerHTML 로드 시 table 구조를 Delta 변환 과정에서 깨뜨림 → 표가 있으면 contenteditable 경로와 동일하게 로드
      if (_entryDescHtmlHasTable(descHtml)) {
        _entrySwitchToRich(_injectDescTableStyle(descHtml || ''));
        const len = _entryGetEditorText().trim().length;
        const counter = document.getElementById('desc-char-count');
        if (counter) { counter.textContent = `${len}자`; counter.style.color = len > 15 ? '#f59e0b' : '#6b7280'; }
      } else {
        entrySwitchToQuill();
        if (_quill) {
          _quill.root.innerHTML = descHtml || '';
          const len = _quill.getText().trim().length;
          const counter = document.getElementById('desc-char-count');
          if (counter) { counter.textContent = `${len}자`; counter.style.color = len > 15 ? '#f59e0b' : '#6b7280'; }
        }
      }
      if (hidHtml) hidHtml.value = descHtml;
      if (hidMd) hidMd.value = '';
      if (memoEl) memoEl.value = '';
      // 수정 진입 시 즉시 동기화(정리+Markdown 변환)는 무거워 커서 반응을 늦춘다.
      // 저장 버튼 클릭 시점에만 동기화한다.
    } else {
      entrySwitchToQuill();
      if (_quill) {
        _quill.root.innerHTML = '';
        const counter = document.getElementById('desc-char-count');
        if (counter) { counter.textContent = '0자'; counter.style.color = '#6b7280'; }
      }
      if (hidHtml) hidHtml.value = '';
      if (hidMd) hidMd.value = '';
      if (memoEl) memoEl.value = _entryWorkDescToMemoPlain(rawDesc);
    }

    // ⑩-b 자문 분류 정보 복원
    try {
      _setKwTags('kw-query', entry.kw_query || []);
      _setKwTags('kw-reason', entry.kw_reason || []);
      _setLawRefs(entry.law_refs || '[]');
      _entryUpdateExampleTags();
    } catch (kwErr) { console.warn('kw 복원 실패:', kwErr); }

    // ⑫ 기존 첨부파일 목록 표시 (읽기 전용 — 수정 시 새 파일 추가만 가능)
    try {
      const attResp = await API.list('attachments', { limit: 50 });
      const existingAtts = (attResp?.data || []).filter(a => a.entry_id === id);
      if (existingAtts.length > 0) {
        _renderExistingAttachments(existingAtts);
      }
    } catch { /* 첨부파일 로드 실패 무시 */ }

    _setEntryPasteGuideText(true);
    Toast.info('수정 모드: 내용을 수정 후 저장하세요.');

  } catch (err) {
    console.error('editEntry error:', err);
    _editEntryId = null;
    Toast.error('데이터 로드 실패: ' + (err.message || ''));
  }
}

// ─────────────────────────────────────────────
// 수정 모드 — 기존 첨부파일 표시 (삭제 버튼 포함)
// ─────────────────────────────────────────────

/** 수정 모드 기존 첨부파일 목록 (삭제 상태 포함) */
let _existingAtts = [];

function _renderExistingAttachments(atts) {
  _existingAtts = atts.map(a => ({ ...a, _deleted: false }));
  _redrawExistingAttachments();
}

function _redrawExistingAttachments() {
  const list = document.getElementById('fileList');
  const icons  = { excel:'fa-file-excel', word:'fa-file-word', ppt:'fa-file-powerpoint', pdf:'fa-file-pdf', link:'fa-link' };
  const colors = { excel:'#16a34a', word:'#1d4ed8', ppt:'#c2410c', pdf:'#b91c1c', link:'#7c3aed' };

  const existingHtml = _existingAtts.map((a, idx) => {
    if (a._deleted) return ''; // 삭제 처리된 항목은 렌더링 제외
    const type  = a.file_type || 'link';
    const icon  = icons[type]  || 'fa-file';
    const color = colors[type] || '#6b7280';
    const sizeStr = a.file_size ? ` · ${Utils.formatFileSize ? Utils.formatFileSize(a.file_size) : Math.round(a.file_size/1024)+'KB'}` : '';
    return `
      <div id="existing-att-${idx}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;
                  background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px">
        <i class="fas ${icon}" style="color:${color};font-size:18px;flex-shrink:0"></i>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500;color:#374151;
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${a.file_name || '이름 없음'}
          </div>
          <div style="font-size:11px;color:#9ca3af;margin-top:2px">
            기존 첨부파일${sizeStr}
          </div>
        </div>
        <span style="font-size:10px;background:#e0f2fe;color:#0369a1;
                     padding:2px 7px;border-radius:10px;white-space:nowrap;margin-right:4px">저장됨</span>
        <button onclick="_deleteExistingAtt(${idx})" title="첨부파일 삭제"
          style="background:none;border:none;cursor:pointer;padding:4px 6px;border-radius:5px;
                 color:#ef4444;font-size:14px;line-height:1;flex-shrink:0;
                 transition:background 0.15s"
          onmouseover="this.style.background='#fee2e2'"
          onmouseout="this.style.background='none'">
          <i class="fas fa-times"></i>
        </button>
      </div>`;
  }).join('');

  const activeCount = _existingAtts.filter(a => !a._deleted).length;

  // 기존 파일 안내 헤더 + 목록
  list.innerHTML = `
    <div style="font-size:11px;color:#6b7280;margin-bottom:6px;
                padding:4px 8px;background:#fef9c3;border-radius:6px;
                border:1px solid #fde68a">
      <i class="fas fa-info-circle" style="color:#d97706"></i>
      기존 첨부파일은 유지됩니다. ✕ 버튼으로 삭제하거나 아래에서 새 파일을 추가하세요.
      ${activeCount === 0 ? '<span style="color:#ef4444;margin-left:6px">⚠ 첨부파일이 없습니다.</span>' : ''}
    </div>
    ${existingHtml}
  `;
}

/**
 * 수정 모드 기존 첨부파일 삭제 처리
 * - DOM에서 즉시 제거 (시각 피드백)
 * - _deletedAttIds에 ID 추가 (저장 시 DB 삭제 실행)
 */
async function _deleteExistingAtt(idx) {
  const att = _existingAtts[idx];
  if (!att) return;
  const fileName = att.file_name || '이름 없음';

  // 블러/어두운 오버레이 없이 가벼운 인라인 confirm 팝업
  const ok = await new Promise(resolve => {
    // 기존 팝업 제거 (중복 방지)
    const old = document.getElementById('_attDelConfirm');
    if (old) old.remove();

    const popup = document.createElement('div');
    popup.id = '_attDelConfirm';
    popup.style.cssText = `
      position:fixed; z-index:9000;
      top:50%; left:50%; transform:translate(-50%,-50%);
      background:#fff; border-radius:12px;
      box-shadow:0 8px 32px rgba(0,0,0,0.18);
      padding:24px 28px; min-width:300px; max-width:400px;
      font-family:inherit; text-align:center;
      border:1px solid #e5e7eb;
    `;
    popup.innerHTML = `
      <div style="font-size:28px;margin-bottom:8px">🗑️</div>
      <div style="font-size:15px;font-weight:600;color:#111827;margin-bottom:8px">첨부파일 삭제</div>
      <div style="font-size:13px;color:#374151;line-height:1.6;margin-bottom:20px">
        <strong style="color:#dc2626">${fileName}</strong>을(를)<br>삭제하시겠습니까?<br>
        <span style="font-size:11px;color:#9ca3af">저장 시 최종 삭제됩니다.</span>
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="_attDelCancel" style="padding:8px 20px;border:1px solid #d1d5db;border-radius:8px;
          background:#f9fafb;color:#374151;font-size:13px;cursor:pointer;font-weight:500">취소</button>
        <button id="_attDelOk" style="padding:8px 20px;border:none;border-radius:8px;
          background:#dc2626;color:#fff;font-size:13px;cursor:pointer;font-weight:600">삭제</button>
      </div>
    `;
    document.body.appendChild(popup);
    popup.querySelector('#_attDelCancel').onclick = () => { popup.remove(); resolve(false); };
    popup.querySelector('#_attDelOk').onclick    = () => { popup.remove(); resolve(true); };
  });
  if (!ok) return;

  _existingAtts[idx]._deleted = true;
  if (att.id && !_deletedAttIds.includes(att.id)) {
    _deletedAttIds.push(att.id);
  }
  _redrawExistingAttachments();
  Toast.info('저장 시 삭제됩니다.');
}

async function submitSingleEntry(id) {
  try {
    const entry = await API.get('time_entries', id);
    if (!entry || !entry.work_start_at || !entry.work_end_at) {
      Toast.warning('제출하려면 업무 시작/종료 일시를 모두 입력하세요.');
      return;
    }
    if ((Number(entry.duration_minutes) || 0) <= 0) {
      Toast.warning('제출하려면 실제 소요시간을 입력하세요.');
      return;
    }

    await API.patch('time_entries', id, { status: 'submitted' });
    Toast.success('제출되었습니다.');

    // ── 알림 생성 ─────────────────────────────
    if (typeof createNotification === 'function') {
      try {
        const session = getSession();
        if (entry && entry.approver_id) {
          const summary = `${entry.client_name || entry.work_category_name} | ${entry.work_subcategory_name || ''}`;
          createNotification({
            toUserId:     entry.approver_id,
            toUserName:   entry.approver_name,
            fromUserId:   session.id,
            fromUserName: session.name,
            type:         'submitted',
            entryId:      id,
            entrySummary: summary,
            message:      `${session.name}님이 타임시트 승인을 요청했습니다.`,
            targetMenu:   'approval',
          });
        }
      } catch { /* 알림 실패는 무시 */ }
    }

    await updateApprovalBadge(getSession());
    loadMyEntries();
  } catch {
    Toast.error('제출 실패');
  }
}

async function deleteEntry(id) {
  const ok = await Confirm.delete('업무 기록');
  if (!ok) return;
  try {
    await API.delete('time_entries', id);
    Toast.success('삭제되었습니다.');
    loadMyEntries();
  } catch {
    Toast.error('삭제 실패');
  }
}

function showRejectReason(reason) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <div class="confirm-icon">💬</div>
      <div class="confirm-title">반려 사유</div>
      <div class="confirm-desc" style="text-align:left;background:#f8fafc;border:1px solid var(--border-light);
           border-radius:8px;padding:12px;margin-top:8px;font-size:13px;line-height:1.6;white-space:pre-wrap">${reason}</div>
      <div class="confirm-actions">
        <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">확인</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ─────────────────────────────────────────────
// 엑셀 내보내기
// ─────────────────────────────────────────────
async function exportEntriesToExcel() {
  // ── 버튼 로딩 표시 ─────────────────────────
  const btn = document.querySelector('[onclick="exportEntriesToExcel()"]');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 로딩 중...'; }

  // ── XLSX 라이브러리 지연 로드 (LibLoader 사용) ───────────
  try {
    if (typeof XLSX === 'undefined') {
      if (typeof LibLoader !== 'undefined') {
        await LibLoader.load('xlsx');
      } else {
        // LibLoader 없으면 직접 script 태그로 로드
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'js/xlsx.full.min.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('XLSX 로드 실패'));
          document.head.appendChild(s);
        });
      }
    }
  } catch (loadErr) {
    Toast.error('엑셀 라이브러리 로드 실패: ' + loadErr.message);
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    return;
  }

  // 로드 후에도 XLSX 없으면 중단
  if (typeof XLSX === 'undefined') {
    Toast.error('엑셀 라이브러리를 불러올 수 없습니다. 페이지를 새로고침 해주세요.');
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    return;
  }

  if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 생성 중...'; }

  try {
    const session = getSession();
    console.log('[Excel] session:', session?.role, session?.id);

    // ① 타임시트 데이터 로드 (화면 필터와 동일: 상태·권한 반영)
    console.log('[Excel] step1: fetching time_entries...');
    const isAdminAll = Auth.canViewAll(session);
    const canViewStaffRecords = isAdminAll || Auth.canViewDeptScope(session) || _entryCanReadMyEntriesMenu(session);
    const useConsultantMode = canViewStaffRecords && _entryRecordViewMode === 'consultant';
    const statusVal = (document.getElementById('filter-entry-status') || {}).value || '';
    const queryStatus = useConsultantMode ? '' : statusVal;
    let entries = await _loadTimeEntriesForMyList(session, isAdminAll, queryStatus);
    entries = await _scopeEntriesForStaffRecords(entries, session);
    console.log('[Excel] step1 result count:', entries.length);

    // staff·manager는 로더에서 이미 user_id 범위. 그 외 비-admin은 방어적 필터
    if (!canViewStaffRecords && !Auth.isStaff(session) && !Auth.isManager(session)) {
      entries = entries.filter(e => String(e.user_id) === String(session.id));
    }
    // 화면 필터(기간·고객사·분류)와 동일하게 맞춤
    const dateFrom = (document.getElementById('filter-entry-date-from') || {}).value;
    const dateTo   = (document.getElementById('filter-entry-date-to') || {}).value;
    const tsFrom = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
    const tsTo   = dateTo   ? new Date(dateTo   + 'T23:59:59').getTime() : null;
    if (tsFrom || tsTo) {
      entries = entries.filter(e => {
        if (!e.work_start_at) return false;
        const raw = e.work_start_at;
        const num = Number(raw);
        let ts;
        if (!isNaN(num) && num > 1000000000000) ts = num;
        else if (!isNaN(num) && num > 1000000000) ts = num * 1000;
        else ts = new Date(raw).getTime();
        if (isNaN(ts)) return false;
        if (tsFrom && ts < tsFrom) return false;
        if (tsTo   && ts > tsTo)   return false;
        return true;
      });
    }
    const clientId = (typeof ClientSearchSelect !== 'undefined')
      ? (ClientSearchSelect.getValue('filter-entry-client-wrap')?.id || '')
      : '';
    const categoryId = (document.getElementById('filter-entry-category') || {}).value || '';
    const subcategoryId = (document.getElementById('filter-entry-subcategory') || {}).value || '';
    const orgSel = _entryCurrentOrgSelection();
    const staffRaw = String((document.getElementById('filter-entry-staff') || {}).value || '').trim();
    const staffKw = staffRaw.toLowerCase();
    const staffId = _entryResolveStaffFilterId(staffRaw);
    if (!useConsultantMode && clientId) entries = entries.filter(e => e.client_id === clientId);
    if (!useConsultantMode && categoryId) entries = entries.filter(e => e.work_category_id === categoryId);
    if (!useConsultantMode && subcategoryId) {
      if (_entryFilterIsProjectMainValue(subcategoryId)) {
        await _entryEnsureProjectCodeTypes();
        _entryAttachProjectMainFields(entries);
        const mainCode = _entryFilterProjectMainCode(subcategoryId);
        entries = entries.filter((e) => String(e._project_main_code || '') === mainCode);
      } else if (_entryFilterIsSubcategoryNameValue(subcategoryId)) {
        const subName = _entryFilterSubcategoryName(subcategoryId).trim();
        entries = entries.filter((e) => String(e.work_subcategory_name || '').trim() === subName);
      } else {
        entries = entries.filter(e => e.work_subcategory_id === subcategoryId);
      }
    }
    if (!useConsultantMode && statusVal) entries = entries.filter(e => String(e.status) === String(statusVal));
    if (useConsultantMode && (orgSel.dept || orgSel.hq || orgSel.team)) {
      entries = entries.filter((e) => {
        const uid = String(e.user_id || '').trim();
        const meta = (uid && _entryStaffUserById[uid]) || {
          deptName: String(e.dept_name || e.department_name || '').trim(),
          hqName: String(e.hq_name || '').trim(),
          teamName: String(e.cs_team_name || e.team_name || '').trim(),
        };
        return _entryMatchOrgFilter(meta, orgSel);
      });
    }
    if (canViewStaffRecords && (staffKw || staffId)) {
      entries = entries.filter((e) => {
        if (staffId) return String(e.user_id || '').trim() === staffId;
        return String(e.user_name || '').toLowerCase().includes(staffKw);
      });
    }

    const sheetF = myEntriesSheetFilter(session);
    if (sheetF) entries = entries.filter(e => _rowSheetType(e) === sheetF);
    entries = _entryApplyConsultantViewGate(entries, canViewStaffRecords);
    if (_entryRecordViewMode !== 'consultant') entries = _entryApplySheetModeFilter(entries);

    const hasProjExcel = entries.some((e) =>
      String(e.work_category_name || '').trim() === '프로젝트업무' && String(e.project_code || '').trim()
    );
    if (hasProjExcel) {
      await _entryEnsureProjectCodeTypes();
      _entryAttachProjectMainFields(entries);
    }

    const descToPlain = (raw) => {
      const s = String(raw || '').trim();
      if (!s) return '';
      if (s.indexOf('<') === -1) return s.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
      try {
        const el = document.createElement('div');
        el.innerHTML = s;
        return (el.textContent || el.innerText || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
      } catch {
        return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    };

    console.log('[Excel] entries count:', entries.length);
    if (!entries.length) {
      Toast.info('내보낼 데이터가 없습니다.');
      return;
    }

    // ② 첨부파일 메타 로드
    console.log('[Excel] step2: fetching attachments...');
    const attMap = {};
    try {
      const attR = await API.list('attachments', { limit: 500 });
      const atts = (attR && attR.data) ? attR.data : (Array.isArray(attR) ? attR : []);
      atts.forEach(a => {
        if (!a.entry_id) return;
        if (!attMap[a.entry_id]) attMap[a.entry_id] = [];
        if (a.file_name) attMap[a.entry_id].push(a.file_name);
      });
      console.log('[Excel] attachments loaded:', atts.length);
    } catch(attErr) {
      console.warn('[Excel] attachments load failed (ignored):', attErr.message);
    }

    // ③ 행 데이터 구성
    const statusLabel = { draft:'임시저장', submitted:'검토중', approved:'승인', rejected:'반려' };
    const rows = entries.map((e, i) => {
      // ms → 날짜(YYYY-MM-DD) / 시간(HH:MM) 분리 함수
      const toDateOnly = (ms) => {
        if (!ms) return '';
        try {
          const d = new Date(Number(ms));
          const yy = d.getFullYear();
          const mm = String(d.getMonth()+1).padStart(2,'0');
          const dd = String(d.getDate()).padStart(2,'0');
          return `${yy}-${mm}-${dd}`;
        } catch { return ''; }
      };
      const toTimeOnly = (ms) => {
        if (!ms) return '';
        try {
          const d = new Date(Number(ms));
          const hh = String(d.getHours()).padStart(2,'0');
          const mi = String(d.getMinutes()).padStart(2,'0');
          return `${hh}:${mi}`;
        } catch { return ''; }
      };
      const isProjR = String(e.work_category_name || '').trim() === '프로젝트업무';
      const pSub = String(e._project_subcategory_label || '').trim();
      const hasPc = String(e.project_code || '').trim() !== '';
      const subCol = (isProjR && hasPc) ? (pSub || e.work_subcategory_name || '') : (e.work_subcategory_name || '');
      return {
        'No':        i + 1,
        '작성일자':  toDateOnly(e.created_at || e.work_start_at),
        'Staff':     e.user_name  || '',
        '업무팀':    e.team_name  || '',
        '고객사':    e.client_name || '내부업무',
        '대분류':    e.work_category_name    || '',
        '소분류':    subCol,
        '수행내용':  descToPlain(e.work_description),
        '시작일자':  toDateOnly(e.work_start_at),
        '시작시간':  toTimeOnly(e.work_start_at),
        '종료일자':  toDateOnly(e.work_end_at),
        '종료시간':  toTimeOnly(e.work_end_at),
        '업무시간':  Utils.formatDuration(e.duration_minutes),
        '상태':      statusLabel[e.status] || e.status || '',
      };
    });

    // ④ 워크북 생성
    console.log('[Excel] step4: building workbook, rows:', rows.length);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      {wch:5},   // No
      {wch:12},  // 작성일자
      {wch:10},  // Staff
      {wch:14},  // 업무팀
      {wch:16},  // 고객사
      {wch:16},  // 대분류
      {wch:20},  // 소분류
      {wch:48},  // 수행내용
      {wch:12},  // 시작일자
      {wch:8},   // 시작시간
      {wch:12},  // 종료일자
      {wch:8},   // 종료시간
      {wch:8},   // 업무시간
      {wch:8},   // 상태
    ];
    XLSX.utils.book_append_sheet(wb, ws, '타임시트');

    // ⑤ Blob URL 방식으로 다운로드
    console.log('[Excel] step5: writing blob...');
    const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob    = new Blob([wbArray], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url   = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fname = `타임시트_${today}.xlsx`;

    const anchor = document.createElement('a');
    anchor.href     = url;
    anchor.download = fname;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    Toast.success(`엑셀 저장 완료 (${entries.length}건) — ${fname}`);

  } catch (err) {
    console.error('exportEntriesToExcel error:', err);
    // 디버그: 오류 전문을 alert으로 표시
    const msg = [
      '오류 유형: ' + (err.name || 'Error'),
      '메시지: '   + (err.message || String(err)),
      '스택: '     + (err.stack   || '없음'),
    ].join('\n');
    alert('엑셀 내보내기 오류 상세:\n\n' + msg);
    Toast.error('내보내기 실패: ' + (err.message || String(err)));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}

// ─────────────────────────────────────────────
// 프로젝트 산출물 (Project Outputs)
// ─────────────────────────────────────────────
const _PROJECT_OUTPUTS_STATE = {
  initialized: false,
  projects: [],
  projectsByCode: {},
  users: [],
  usersById: {},
  codeTypeById: {},
  accessRequests: [],
  outputRows: [],
};
const _PROJECT_OUTPUTS_BUCKET = 'project-outputs';
const _PROJECT_OUTPUT_TYPE_RESULT = '결과보고서';
const _PROJECT_OUTPUT_TYPE_CLEARANCE = '통관팀유의사항';
const _PROJECT_OUTPUT_TYPE_REFERENCE = '참고자료';
const _PROJECT_OUTPUT_LIBRARY_MODE = true;
const _PROJECT_OUTPUT_ACCESS_VALID_MS = 24 * 60 * 60 * 1000; // 1일
const _PROJECT_OUTPUT_BULK_DAILY_THRESHOLD = 5; // 1일 5건 이상
const _PROJECT_OUTPUT_URL_ISSUE_FN = 'issue_project_output_url';
let _PROJECT_OUTPUT_RAG_TABLE_WARNED = false;

function escapeHtml(v) {
  if (typeof Utils !== 'undefined' && Utils && typeof Utils.escHtml === 'function') {
    return Utils.escHtml(v);
  }
  return String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _projectOutputsSafeSegment(v) {
  return String(v || '')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'na';
}

function _projectOutputsFmtDate(ms) {
  const n = Number(ms || 0);
  if (!n) return '-';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().slice(0, 10);
}

function _projectOutputsRows(res) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.data)) return res.data;
  return [];
}

function _projectOutputsIsMissingTableError(err) {
  const msg = String(err && err.message || '').toLowerCase();
  return (
    msg.includes('relation') ||
    msg.includes('does not exist') ||
    msg.includes('not found') ||
    msg.includes('404')
  );
}

function _projectOutputsRagSourceKind(outputType) {
  const t = String(outputType || '').trim();
  if (t === _PROJECT_OUTPUT_TYPE_REFERENCE) return 'reference';
  if (t === _PROJECT_OUTPUT_TYPE_RESULT) return 'result_report';
  return 'other';
}

async function _projectOutputsPersistRagSeed(outputRow, session) {
  const row = outputRow || {};
  const outputId = String(row.id || '').trim();
  if (!outputId) return;
  const now = Date.now();
  const payload = {
    output_id: outputId,
    source_kind: _projectOutputsRagSourceKind(row.output_type),
    output_type: String(row.output_type || ''),
    title: String(row.output_title || ''),
    summary: String(row.note || ''),
    project_code: String(row.project_code || ''),
    project_name: String(row.project_name || ''),
    main_category: String(row.output_main_category || ''),
    sub_category: String(row.output_sub_category || ''),
    file_name: String(row.output_file_name || ''),
    file_url: String(row.output_file_url || ''),
    file_path: String(row.output_file_path || ''),
    uploaded_by: String(row.uploaded_by || _projectOutputsCurrentUserId(session)),
    uploaded_by_name: String(row.uploaded_by_name || session?.name || session?.user_name || ''),
    uploaded_at: Number(row.uploaded_at || now),
    rag_status: 'queued',
    updated_at: now,
  };
  try {
    const exists = await API.list('project_output_rag_seeds', {
      select: 'id',
      output_id: `eq.${outputId}`,
      limit: 1,
    }).catch(() => []);
    const hit = Array.isArray(exists) ? exists[0] : null;
    let seedId = '';
    if (hit && hit.id) {
      seedId = String(hit.id || '');
      await API.patch('project_output_rag_seeds', seedId, payload);
    } else {
      const created = await API.create('project_output_rag_seeds', {
        ...payload,
        created_at: now,
      });
      seedId = String(created && created.id || '');
    }
    if (!seedId) return;
    const queued = await API.list('project_output_rag_index_queue', {
      select: 'id,status',
      output_id: `eq.${outputId}`,
      limit: 20,
    }).catch(() => []);
    const hasActiveJob = (queued || []).some((r) => {
      const st = String(r.status || '').trim();
      return st === 'pending' || st === 'processing';
    });
    if (!hasActiveJob) {
      await API.create('project_output_rag_index_queue', {
        seed_id: seedId,
        output_id: outputId,
        job_type: 'index',
        status: 'pending',
        requested_by: _projectOutputsCurrentUserId(session),
        requested_by_name: String(session?.name || session?.user_name || ''),
        created_at: now,
        updated_at: now,
      });
    }
  } catch (e) {
    if (_projectOutputsIsMissingTableError(e)) {
      if (!_PROJECT_OUTPUT_RAG_TABLE_WARNED) {
        _PROJECT_OUTPUT_RAG_TABLE_WARNED = true;
        console.warn('[project-outputs] rag seed tables are missing. Apply SQL migration for RAG indexing.');
      }
      return;
    }
    console.warn('[project-outputs] rag seed sync failed', e);
  }
}

function _projectOutputsCurrentUserId(session) {
  return String(session?.user_id || session?.id || '').trim();
}

function _projectOutputsProjectByCode(code) {
  return _PROJECT_OUTPUTS_STATE.projectsByCode[String(code || '').trim()] || null;
}

function _projectOutputsCategoryForProject(project) {
  if (!project) return { main: '', sub: '' };
  const typeId = String(project.project_code_type_id || '').trim();
  const type = _PROJECT_OUTPUTS_STATE.codeTypeById[typeId] || {};
  return {
    main: String(type.main_category || '').trim(),
    sub: String(type.sub_category || '').trim(),
  };
}

function _projectOutputsCategoryForOutput(row) {
  const directMain = String((row && row.output_main_category) || '').trim();
  const directSub = String((row && row.output_sub_category) || '').trim();
  if (directMain || directSub) {
    return { main: directMain, sub: directSub };
  }
  const note = String((row && row.note) || '').trim();
  const m = note.match(/\[분류\]\s*대분류:(.*?)\s*\/\s*소분류:(.*?)(?:\n|$)/);
  if (m) {
    return {
      main: String(m[1] || '').trim(),
      sub: String(m[2] || '').trim(),
    };
  }
  const project = _projectOutputsProjectByCode(row?.project_code || '');
  return _projectOutputsCategoryForProject(project);
}

function _projectOutputsResolveStoragePath(row) {
  const direct = String(row && row.output_file_path || '').trim();
  if (direct) return direct;
  const url = String(row && row.output_file_url || '').trim();
  if (!url) return '';
  const m = url.match(/\/storage\/v1\/object\/public\/project-outputs\/(.+)$/i);
  if (!m || !m[1]) return '';
  try {
    return decodeURIComponent(String(m[1] || '').replace(/\?.*$/, ''));
  } catch (_) {
    return String(m[1] || '').replace(/\?.*$/, '');
  }
}

function _projectOutputsDayRangeMs(ts = Date.now()) {
  const d = new Date(ts);
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const to = from + 24 * 60 * 60 * 1000;
  return { from, to };
}

function _projectOutputsCanUpload(session, project) {
  if (!session) return false;
  if (Auth.isAdmin(session) || Auth.isDirector(session) || Auth.isTopMgr(session)) return true;
  const me = String(session.user_id || session.id || '');
  const pm = String((project && project.cpm_user_id) || '');
  return !!me && !!pm && me === pm;
}

function _projectOutputsCanAction(session, project) {
  if (!session || !project) return false;
  if (Auth.isAdmin(session)) return true;
  const pm = _PROJECT_OUTPUTS_STATE.usersById[String(project.cpm_user_id || '').trim()] || null;
  if (!pm) return false;
  if (Auth.isDirector(session)) {
    return String(session.hq_id || '').trim() && String(session.hq_id || '').trim() === String(pm.hq_id || '').trim();
  }
  if (Auth.isTopMgr(session)) {
    return String(session.dept_id || '').trim() && String(session.dept_id || '').trim() === String(pm.dept_id || '').trim();
  }
  return false;
}

async function _projectOutputsLoadUsersAndCodeTypes() {
  const [users, codeTypes] = await Promise.all([
    Master.users().catch(() => []),
    API.listAllPages('project_code_types', { limit: 1000, maxPages: 10, sort: 'main_code' }).catch(() => []),
  ]);
  _PROJECT_OUTPUTS_STATE.users = Array.isArray(users) ? users : [];
  _PROJECT_OUTPUTS_STATE.usersById = {};
  (_PROJECT_OUTPUTS_STATE.users || []).forEach((u) => {
    _PROJECT_OUTPUTS_STATE.usersById[String(u.id || '').trim()] = u;
  });
  _PROJECT_OUTPUTS_STATE.codeTypeById = {};
  (codeTypes || []).forEach((c) => {
    _PROJECT_OUTPUTS_STATE.codeTypeById[String(c.id || '').trim()] = c;
  });
}

function _projectOutputsActionStatusLabel(status) {
  const s = String(status || '').trim();
  if (s === 'completed') return '완료';
  if (s === 'in_progress') return '진행중';
  return '확인';
}

function _projectOutputsRequiresClearance(project) {
  if (!project) return false;
  const typeId = String(project.project_code_type_id || '').trim();
  const type = _PROJECT_OUTPUTS_STATE.codeTypeById[typeId] || {};
  return !!type.requires_clearance_note;
}

async function _projectOutputsCheckClosureGate(project) {
  if (!project) return { ok: false, reason: '프로젝트 정보가 없습니다.' };
  if (!_projectOutputsRequiresClearance(project)) return { ok: true, reason: '' };
  const projectCode = String(project.project_code || '').trim();
  const outputs = await API.list('project_outputs', {
    select: 'id,project_code,output_type,output_title,uploaded_at',
    project_code: `eq.${projectCode}`,
    limit: 1000,
    order: 'uploaded_at.desc,created_at.desc',
  }).catch(() => []);
  const clearOutputs = (Array.isArray(outputs) ? outputs : []).filter((o) => String(o.output_type || '').trim() === _PROJECT_OUTPUT_TYPE_CLEARANCE);
  if (!clearOutputs.length) {
    return { ok: false, reason: '통관유의사항 업로드가 필요합니다.' };
  }
  const outputIds = clearOutputs.map((o) => String(o.id || '').trim()).filter(Boolean);
  const actions = await API.listAllPages('project_output_actions', {
    limit: 1000,
    maxPages: 10,
    sort: 'updated_at',
  }).catch((e) => {
    const msg = String(e && e.message || '');
    if (/project_output_actions|schema cache|relation/i.test(msg)) {
      throw new Error('project_output_actions 테이블이 필요합니다. SQL 스크립트를 먼저 적용하세요.');
    }
    throw e;
  });
  const doneCnt = (actions || []).filter((a) =>
    outputIds.includes(String(a.output_id || '').trim()) &&
    String(a.action_status || '').trim() === 'completed'
  ).length;
  if (doneCnt < 1) {
    return { ok: false, reason: '통관유의사항 조치완료(본부장/사업부장 중 1명 이상)가 필요합니다.' };
  }
  return { ok: true, reason: '' };
}

async function _projectOutputsNotifyClearance(project, payload, session) {
  if (typeof createNotification !== 'function' || !project || !payload) return;
  const pm = _PROJECT_OUTPUTS_STATE.usersById[String(project.cpm_user_id || '').trim()] || {};
  const toUsers = (_PROJECT_OUTPUTS_STATE.users || []).filter((u) => {
    const role = String(u.role || '').trim();
    if (role === 'director') return String(u.hq_id || '').trim() && String(u.hq_id || '').trim() === String(pm.hq_id || '').trim();
    if (role === 'top_mgr') return String(u.dept_id || '').trim() && String(u.dept_id || '').trim() === String(pm.dept_id || '').trim();
    return false;
  });
  const senderId = String(session.user_id || session.id || '').trim();
  const uniq = new Set();
  toUsers.forEach((u) => {
    const uid = String(u.id || '').trim();
    if (!uid || uid === senderId || uniq.has(uid)) return;
    uniq.add(uid);
    createNotification({
      toUserId: uid,
      toUserName: String(u.name || ''),
      fromUserId: senderId,
      fromUserName: String(session.name || session.user_name || ''),
      type: 'project_clearance_notice',
      entryId: String(payload.id || ''),
      entrySummary: `${String(project.project_code || '')} | ${String(project.project_name || '')}`,
      message: `${String(session.name || '작성자')}님이 통관팀유의사항을 등록했습니다. 조치사항을 입력해주세요.`,
      targetMenu: 'project-deliverables',
    });
  });
}

async function _projectOutputsLoadProjects() {
  const rows = await API.list('registered_projects', {
    select: 'id,project_code,project_name,client_name,cpm_user_id,cpm_name,registration_status,project_code_type_id,work_closed_at',
    registration_status: 'eq.approved',
    order: 'project_code.asc',
    limit: 5000,
  });
  _PROJECT_OUTPUTS_STATE.projects = _projectOutputsRows(rows);
  _PROJECT_OUTPUTS_STATE.projectsByCode = {};
  (_PROJECT_OUTPUTS_STATE.projects || []).forEach((p) => {
    const code = String(p.project_code || '').trim();
    if (code) _PROJECT_OUTPUTS_STATE.projectsByCode[code] = p;
  });
  const sel = document.getElementById('proj-out-project');
  if (!sel) return;
  const opts = ['<option value="">전체 프로젝트</option>'].concat(
    _PROJECT_OUTPUTS_STATE.projects.map((p) => {
      const code = escapeHtml(p.project_code || '');
      const name = escapeHtml(p.project_name || '');
      const client = escapeHtml(p.client_name || '');
      return `<option value="${code}">${code} · ${name}${client ? ` (${client})` : ''}</option>`;
    })
  );
  if (sel) sel.innerHTML = opts.join('');
  _projectOutputsSyncCategoryFilters();
}

function _projectOutputsSyncCategoryFilters() {
  const mainEl = document.getElementById('proj-out-main-category');
  const subEl = document.getElementById('proj-out-sub-category');
  if (!mainEl || !subEl) return;
  const mains = [...new Set((_PROJECT_OUTPUTS_STATE.projects || [])
    .map((p) => _projectOutputsCategoryForProject(p).main)
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const curMain = String(mainEl.value || '').trim();
  const curSub = String(subEl.value || '').trim();
  mainEl.innerHTML = ['<option value="">전체</option>']
    .concat(mains.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`))
    .join('');
  if (curMain && mains.includes(curMain)) mainEl.value = curMain;
  const scopedProjects = (_PROJECT_OUTPUTS_STATE.projects || []).filter((p) => {
    if (!curMain) return true;
    return _projectOutputsCategoryForProject(p).main === curMain;
  });
  const subs = [...new Set(scopedProjects.map((p) => _projectOutputsCategoryForProject(p).sub).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  subEl.innerHTML = ['<option value="">전체</option>']
    .concat(subs.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`))
    .join('');
  if (curSub && subs.includes(curSub)) subEl.value = curSub;
}

function _projectOutputsSyncNewCategoryOptions() {
  const mainEl = document.getElementById('proj-out-new-main-category');
  const subEl = document.getElementById('proj-out-new-sub-category');
  if (!mainEl || !subEl) return;
  const rows = Object.values(_PROJECT_OUTPUTS_STATE.codeTypeById || {});
  const map = {};
  rows.forEach((r) => {
    const main = String(r.main_category || '').trim();
    const sub = String(r.sub_category || '').trim();
    if (!main || !sub) return;
    if (!map[main]) map[main] = new Set();
    map[main].add(sub);
  });
  const mains = Object.keys(map).sort((a, b) => a.localeCompare(b));
  const curMain = String(mainEl.value || '').trim();
  const curSub = String(subEl.value || '').trim();
  mainEl.innerHTML = ['<option value="">대분류 선택</option>']
    .concat(mains.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`))
    .join('');
  if (curMain && mains.includes(curMain)) mainEl.value = curMain;
  const selectedMain = String(mainEl.value || '').trim();
  const subs = selectedMain ? Array.from(map[selectedMain] || []).sort((a, b) => a.localeCompare(b)) : [];
  subEl.innerHTML = ['<option value="">소분류 선택</option>']
    .concat(subs.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`))
    .join('');
  if (curSub && subs.includes(curSub)) subEl.value = curSub;
}

function _projectOutputsMatchGrant(session, row, requestType) {
  const type = String(requestType || 'view').trim();
  if (type === 'download' && Auth.canDownloadProjectDeliverables(session)) return true;
  if (type !== 'download' && Auth.canViewProjectDeliverables(session)) return true;
  const uid = _projectOutputsCurrentUserId(session);
  const now = Date.now();
  const cat = _projectOutputsCategoryForOutput(row);
  const rows = Array.isArray(_PROJECT_OUTPUTS_STATE.accessRequests) ? _PROJECT_OUTPUTS_STATE.accessRequests : [];
  return rows.some((r) => {
    if (String(r.requester_user_id || '').trim() !== uid) return false;
    if (String(r.request_type || '').trim() !== String(requestType || '').trim()) return false;
    if (String(r.status || '').trim() !== 'approved') return false;
    const exp = Number(r.expires_at || 0);
    if (!exp || exp < now) return false;
    const m = String(r.scope_main_category || '').trim();
    const s = String(r.scope_sub_category || '').trim();
    return m === String(cat.main || '') && s === String(cat.sub || '');
  });
}

function _projectOutputsCanPortalAction(session, actionKey) {
  const k = String(actionKey || '').trim();
  if (!session || !k) return false;
  const legacyRead = Auth.canViewProjectDeliverables(session);
  return Auth.canDoAction(session, 'project-deliverables', k, legacyRead);
}

async function _projectOutputsLoadMyAccessRequests() {
  const session = getSession();
  const uid = _projectOutputsCurrentUserId(session);
  if (!uid) {
    _PROJECT_OUTPUTS_STATE.accessRequests = [];
    return;
  }
  const rows = await API.listAllPages('project_output_access_requests', {
    filter: `requester_user_id=eq.${uid}`,
    limit: 500,
    maxPages: 10,
    sort: 'updated_at',
  }).catch((e) => {
    const msg = String(e && e.message || '');
    if (/project_output_access_requests|relation|schema cache/i.test(msg)) {
      Toast.warning('접근신청 테이블이 없어 권한신청 기능이 제한됩니다. SQL 반영 후 사용하세요.');
      return [];
    }
    throw e;
  });
  _PROJECT_OUTPUTS_STATE.accessRequests = Array.isArray(rows) ? rows : [];
}

function _projectOutputsSelectedRows() {
  const checks = Array.from(document.querySelectorAll('#proj-out-body .proj-out-select-row:checked'));
  const byId = {};
  (_PROJECT_OUTPUTS_STATE.outputRows || []).forEach((r) => {
    const id = String(r.id || '').trim();
    if (id) byId[id] = r;
  });
  return checks.map((el) => byId[String(el.value || '').trim()]).filter(Boolean);
}

function _projectOutputsSyncSelectionUi() {
  const checks = Array.from(document.querySelectorAll('#proj-out-body .proj-out-select-row'));
  const checked = checks.filter((el) => el.checked);
  const allEl = document.getElementById('proj-out-select-all');
  if (allEl) {
    allEl.checked = checks.length > 0 && checked.length === checks.length;
    allEl.indeterminate = checked.length > 0 && checked.length < checks.length;
  }
  const session = getSession();
  const canExportAction = _projectOutputsCanPortalAction(session, 'export');
  const canDownloadAction = _projectOutputsCanPortalAction(session, 'download');
  const viewBtn = document.getElementById('proj-out-bulk-view-btn');
  const downloadBtn = document.getElementById('proj-out-bulk-download-btn');
  if (viewBtn) viewBtn.disabled = checked.length < 1 || !canExportAction;
  if (downloadBtn) downloadBtn.disabled = checked.length < 1 || !canDownloadAction;
}

function _projectOutputsValidateBulkRequest(requestType, rows) {
  const type = String(requestType || '').trim();
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '선택된 결과물이 없습니다.';
  if (type === 'download' && list.length > 2) return '다운로드 신청은 최대 2건까지 가능합니다.';
  if (type === 'view' && list.length > 20) return '열람 신청은 최대 20건까지 가능합니다.';
  if (type === 'view') {
    const subSet = new Set(list.map((r) => String(_projectOutputsCategoryForOutput(r).sub || '').trim() || '-'));
    if (subSet.size > 1) return '열람 복수 신청은 동일 소분류 내에서만 가능합니다.';
  }
  return '';
}

async function openProjectOutputBulkAccessRequest(requestType) {
  const type = String(requestType || '').trim();
  if (type !== 'view' && type !== 'download') return;
  const session = getSession();
  const canAction = type === 'download'
    ? _projectOutputsCanPortalAction(session, 'download')
    : _projectOutputsCanPortalAction(session, 'export');
  if (!canAction) {
    Toast.warning(type === 'download' ? '다운로드 신청 권한이 없습니다.' : '열람(출력) 신청 권한이 없습니다.');
    return;
  }
  const selected = _projectOutputsSelectedRows();
  const invalidMsg = _projectOutputsValidateBulkRequest(type, selected);
  if (invalidMsg) return Toast.warning(invalidMsg);
  const ids = selected.map((r) => String(r.id || '').trim()).filter(Boolean);
  if (!ids.length) return Toast.warning('선택된 결과물이 없습니다.');
  await openProjectOutputAccessRequestModal(ids[0], type, ids);
}

async function _projectOutputsLoadList() {
  const body = document.getElementById('proj-out-body');
  const summary = document.getElementById('proj-out-summary');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-spinner fa-spin"></i><p>결과물 목록을 불러오는 중입니다...</p></td></tr>';
  try {
    const session = getSession();
    const fromEl = document.getElementById('proj-out-date-from');
    const toEl = document.getElementById('proj-out-date-to');
    const projectEl = document.getElementById('proj-out-project');
    const mainEl = document.getElementById('proj-out-main-category');
    const subEl = document.getElementById('proj-out-sub-category');
    const uploaderEl = document.getElementById('proj-out-uploader');
    const kindEl = document.getElementById('proj-out-kind-filter');
    const fromVal = String((fromEl && fromEl.value) || '').trim();
    const toVal = String((toEl && toEl.value) || '').trim();
    const projectCode = String((projectEl && projectEl.value) || '').trim();
    const mainCategory = String((mainEl && mainEl.value) || '').trim();
    const subCategory = String((subEl && subEl.value) || '').trim();
    const uploader = String((uploaderEl && uploaderEl.value) || '').trim().toLowerCase();
    const kindFilter = String((kindEl && kindEl.value) || 'all').trim();
    let fromMs = 0;
    let toMs = 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromVal)) fromMs = new Date(fromVal).getTime();
    if (/^\d{4}-\d{2}-\d{2}$/.test(toVal)) toMs = new Date(toVal).getTime() + (24 * 60 * 60 * 1000);
    const q = {
      select: 'id,project_code,project_name,output_type,output_title,output_main_category,output_sub_category,output_file_name,output_file_url,output_file_path,preview_file_path,preview_ready,preview_version,uploaded_by,uploaded_by_name,uploaded_at,note,created_at,publish_status,publish_approved_at,publish_approved_by_name',
      order: 'uploaded_at.desc,created_at.desc',
      limit: 1000,
    };
    if (kindFilter === 'result') q.output_type = `eq.${_PROJECT_OUTPUT_TYPE_RESULT}`;
    if (kindFilter === 'reference') q.output_type = `eq.${_PROJECT_OUTPUT_TYPE_REFERENCE}`;
    q.publish_status = 'eq.published';
    if (projectCode) q.project_code = `eq.${projectCode}`;
    if (fromMs > 0) q.uploaded_at = `gte.${fromMs}`;
    if (toMs > 0) q.uploaded_at = `lt.${toMs}`;
    let rows = [];
    try {
      rows = await API.list('project_outputs', q);
    } catch (qe) {
      const msg = String(qe && qe.message || '');
      const fallbackQ = { ...q };
      let usedFallback = false;
      if (/publish_status|publish_approved/i.test(msg)) {
        delete fallbackQ.publish_status;
        usedFallback = true;
      }
      if (/output_main_category|output_sub_category/i.test(msg)) {
        usedFallback = true;
      }
      if (!usedFallback) throw qe;
      fallbackQ.select = 'id,project_code,project_name,output_type,output_title,output_file_name,output_file_url,output_file_path,preview_file_path,preview_ready,preview_version,uploaded_by,uploaded_by_name,uploaded_at,note,created_at';
      rows = await API.list('project_outputs', fallbackQ);
      if (/publish_status|publish_approved/i.test(msg)) {
        Toast.warning('게시승인 컬럼이 없어 결과보고서 전체를 표시합니다. SQL 반영 후 승인기반 필터가 적용됩니다.');
      }
    }
    let list = _projectOutputsRows(rows);
    if (projectCode) list = list.filter((r) => String(r.project_code || '').trim() === projectCode);
    list = list.filter((r) => {
      const cat = _projectOutputsCategoryForOutput(r);
      if (mainCategory && cat.main !== mainCategory) return false;
      if (subCategory && cat.sub !== subCategory) return false;
      if (uploader && !String(r.uploaded_by_name || '').toLowerCase().includes(uploader)) return false;
      if (fromMs > 0 && Number(r.uploaded_at || r.created_at || 0) < fromMs) return false;
      if (toMs > 0 && Number(r.uploaded_at || r.created_at || 0) >= toMs) return false;
      return true;
    });
    _PROJECT_OUTPUTS_STATE.outputRows = list;
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-folder-open"></i><p>등록된 결과물이 없습니다.</p></td></tr>';
      if (summary) summary.textContent = '총 0건';
      _projectOutputsSyncSelectionUi();
      return;
    }
    const canExportAction = _projectOutputsCanPortalAction(session, 'export');
    const canDownloadAction = _projectOutputsCanPortalAction(session, 'download');
    body.innerHTML = list.map((r, i) => {
      const cat = _projectOutputsCategoryForOutput(r);
      const canView = _projectOutputsMatchGrant(session, r, 'view');
      const canDownload = _projectOutputsMatchGrant(session, r, 'download');
      const filePath = _projectOutputsResolveStoragePath(r);
      const viewBtn = filePath
        ? (!canExportAction
          ? '-'
          : (canView
          ? `<button type="button" class="btn btn-xs btn-ghost po-action-btn" onclick="_projectOutputsAccessFile('${escapeHtml(r.id || '')}','view')">열람</button>`
          : `<button type="button" class="btn btn-xs btn-ghost po-action-btn po-action-btn-request" onclick="openProjectOutputAccessRequestModal('${escapeHtml(r.id || '')}','view')">열람신청</button>`))
        : '-';
      const downloadBtn = filePath
        ? (!canDownloadAction
          ? '-'
          : (canDownload
          ? `<button type="button" class="btn btn-xs btn-outline po-action-btn po-action-btn-download" onclick="_projectOutputsAccessFile('${escapeHtml(r.id || '')}','download')">다운로드</button>`
          : `<button type="button" class="btn btn-xs btn-ghost po-action-btn po-action-btn-request" onclick="openProjectOutputAccessRequestModal('${escapeHtml(r.id || '')}','download')">다운로드신청</button>`))
        : '-';
      const rowId = escapeHtml(String(r.id || '').trim());
      return [
        '<tr>',
        `<td style="text-align:center"><input type="checkbox" class="proj-out-select-row" value="${rowId}" aria-label="선택" /></td>`,
        `<td style="text-align:center">${i + 1}</td>`,
        `<td>${escapeHtml(r.uploaded_by_name || '')}</td>`,
        `<td>${_projectOutputsFmtDate(r.uploaded_at || r.created_at)}</td>`,
        `<td>${escapeHtml(cat.main || '-')}</td>`,
        `<td>${escapeHtml(cat.sub || '-')}</td>`,
        `<td style="text-align:center;white-space:nowrap" class="po-action-cell">${viewBtn} ${downloadBtn}</td>`,
        `<td>${escapeHtml(r.note || '')}</td>`,
        '</tr>',
      ].join('');
    }).join('');
    Array.from(document.querySelectorAll('#proj-out-body .proj-out-select-row')).forEach((el) => {
      el.addEventListener('change', _projectOutputsSyncSelectionUi);
    });
    const allEl = document.getElementById('proj-out-select-all');
    if (allEl) {
      allEl.checked = false;
      allEl.indeterminate = false;
    }
    _projectOutputsSyncSelectionUi();
    if (summary) summary.textContent = `총 ${list.length.toLocaleString()}건`;
  } catch (e) {
    console.error('[project-outputs] load failed', e);
    body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-triangle-exclamation"></i><p>결과물 목록을 불러오지 못했습니다.</p></td></tr>';
    _PROJECT_OUTPUTS_STATE.outputRows = [];
    _projectOutputsSyncSelectionUi();
    if (summary) summary.textContent = '조회 실패';
    Toast.error(e.message || '결과물 목록 조회 실패');
  }
}

async function _projectOutputsAccessFile(outputId, actionType) {
  const id = String(outputId || '').trim();
  const type = String(actionType || '').trim();
  if (!id || (type !== 'view' && type !== 'download')) return;
  const session = getSession();
  const canAction = type === 'download'
    ? _projectOutputsCanPortalAction(session, 'download')
    : _projectOutputsCanPortalAction(session, 'export');
  if (!canAction) {
    Toast.warning(type === 'download' ? '직접 다운로드 권한이 없습니다.' : '열람(출력) 권한이 없습니다.');
    return;
  }
  const rows = await API.listAllPages('project_outputs', {
    filter: `id=eq.${id}`,
    limit: 1,
    maxPages: 1,
  }).catch(() => []);
  const row = (rows || [])[0] || null;
  if (!row) return Toast.warning('대상 결과물을 찾을 수 없습니다.');
  const hasGrant = _projectOutputsMatchGrant(session, row, type);
  if (!hasGrant) {
    openProjectOutputAccessRequestModal(id, type);
    return;
  }
  try {
    await API.create('project_output_access_logs', {
      output_id: id,
      project_code: String(row.project_code || ''),
      event_type: type,
      actor_user_id: _projectOutputsCurrentUserId(session),
      actor_user_name: String(session?.name || session?.user_name || ''),
      occurred_at: Date.now(),
      user_agent: String(navigator.userAgent || '').slice(0, 500),
    });
  } catch (e) {
    console.warn('[project-output-access-log] create failed', e);
  }
  await _projectOutputsCheckBulkAccessAlert(session).catch(() => {});
  const storagePath = _projectOutputsResolveStoragePath(row);
  if (!storagePath) return Toast.warning('파일 경로 정보가 없습니다. 관리자에게 문의하세요.');
  try {
    const issued = await API.invokeFunction(_PROJECT_OUTPUT_URL_ISSUE_FN, {
      output_id: id,
      request_type: type,
      actor_user_id: _projectOutputsCurrentUserId(session),
      actor_user_name: String(session?.name || session?.user_name || ''),
      actor_role: String(session?.role || ''),
      project_code: String(row.project_code || ''),
      output_file_path: storagePath,
      output_file_name: String(row.output_file_name || ''),
      preview_file_path: String(row.preview_file_path || ''),
      preview_ready: !!row.preview_ready,
      user_agent: String(navigator.userAgent || '').slice(0, 500),
    });
    const signedUrl = String(issued && (issued.signed_url || issued.url) || '').trim();
    if (!signedUrl) throw new Error('서명 URL 발급 결과가 비어 있습니다.');
    if (type === 'download') {
      const a = document.createElement('a');
      a.href = signedUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.download = String(row.output_file_name || 'project-output');
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    window.open(signedUrl, '_blank', 'noopener');
  } catch (e) {
    console.error('[project-output-url-issue] failed', e);
    Toast.error(
      `보안 URL 발급 실패: ${e.message || e}. ` +
      `Edge Function(${_PROJECT_OUTPUT_URL_ISSUE_FN}) 배포 및 스토리지 private 설정을 확인하세요.`
    );
  }
}

async function _projectOutputsCheckBulkAccessAlert(session) {
  if (!session) return;
  const uid = _projectOutputsCurrentUserId(session);
  if (!uid) return;
  const { from, to } = _projectOutputsDayRangeMs();
  const logs = await API.listAllPages('project_output_access_logs', {
    filter: `actor_user_id=eq.${uid}&occurred_at=gte.${from}&occurred_at=lt.${to}`,
    limit: 1000,
    maxPages: 5,
    sort: 'occurred_at',
  }).catch(() => []);
  const cnt = (logs || []).filter((l) => {
    const t = String(l.event_type || '').trim();
    return t === 'view' || t === 'download';
  }).length;
  if (cnt < _PROJECT_OUTPUT_BULK_DAILY_THRESHOLD) return;
  if (typeof createNotification !== 'function') return;
  const stamp = new Date(from).toISOString().slice(0, 10).replace(/-/g, '');
  const entryId = `bulk:${uid}:${stamp}`;
  const exists = await API.listAllPages('notifications', {
    filter: `type=eq.project_output_bulk_access_alert&entry_id=eq.${entryId}`,
    limit: 10,
    maxPages: 1,
    sort: 'created_at',
  }).catch(() => []);
  if ((exists || []).length > 0) return;
  const deptId = String(session.dept_id || '').trim();
  const topMgrs = (_PROJECT_OUTPUTS_STATE.users || []).filter((u) =>
    String(u.role || '').trim() === 'top_mgr' &&
    deptId &&
    String(u.dept_id || '').trim() === deptId
  );
  await Promise.allSettled(topMgrs.map((u) => createNotification({
    toUserId: String(u.id || ''),
    toUserName: String(u.name || ''),
    fromUserId: uid,
    fromUserName: String(session.name || session.user_name || ''),
    type: 'project_output_bulk_access_alert',
    entryId,
    entrySummary: `${String(session.name || session.user_name || '-')}/${cnt}건`,
    message: `${String(session.name || '사용자')}님의 당일 결과물 접근이 ${cnt}건입니다. (기준 ${_PROJECT_OUTPUT_BULK_DAILY_THRESHOLD}건)`,
    targetMenu: 'project-deliverables',
  })));
}

async function openProjectOutputAccessRequestModal(outputId, requestType, outputIds) {
  const id = String(outputId || '').trim();
  const type = String(requestType || '').trim();
  if (!type) return;
  const session = getSession();
  const canAction = type === 'download'
    ? _projectOutputsCanPortalAction(session, 'download')
    : _projectOutputsCanPortalAction(session, 'export');
  if (!canAction) {
    Toast.warning(type === 'download' ? '다운로드 신청 권한이 없습니다.' : '열람(출력) 신청 권한이 없습니다.');
    return;
  }
  const ids = (Array.isArray(outputIds) ? outputIds : [id])
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (!ids.length) return Toast.warning('신청 대상을 찾을 수 없습니다.');
  let rows = (_PROJECT_OUTPUTS_STATE.outputRows || []).filter((r) => ids.includes(String(r.id || '').trim()));
  if (!rows.length && ids.length === 1) {
    rows = await API.listAllPages('project_outputs', {
      filter: `id=eq.${ids[0]}`,
      limit: 1,
      maxPages: 1,
      sort: 'uploaded_at',
    }).catch(() => []);
  }
  const targets = Array.isArray(rows) ? rows : [];
  if (!targets.length) return Toast.warning('신청 대상을 찾을 수 없습니다.');
  const invalidMsg = _projectOutputsValidateBulkRequest(type, targets);
  if (invalidMsg) return Toast.warning(invalidMsg);
  const firstRow = targets[0];
  const cat = _projectOutputsCategoryForOutput(firstRow);
  const hidId = document.getElementById('proj-out-access-output-id');
  const hidIds = document.getElementById('proj-out-access-output-ids');
  const hidType = document.getElementById('proj-out-access-request-type');
  const summary = document.getElementById('proj-out-access-summary');
  const typeLabel = document.getElementById('proj-out-access-type-label');
  const main = document.getElementById('proj-out-access-main');
  const sub = document.getElementById('proj-out-access-sub');
  const reason = document.getElementById('proj-out-access-reason');
  if (hidId) hidId.value = String(firstRow.id || '');
  if (hidIds) hidIds.value = ids.join(',');
  if (hidType) hidType.value = type;
  if (summary) {
    if (targets.length === 1) summary.textContent = `${firstRow.project_code || ''} · ${firstRow.output_title || ''}`;
    else summary.textContent = `${targets.length}건 선택됨 (${cat.main || '-'} / ${cat.sub || '-'})`;
  }
  if (typeLabel) typeLabel.value = type === 'download'
    ? (targets.length > 1 ? `다운로드 복수 신청 (${targets.length}건)` : '다운로드 신청')
    : (targets.length > 1 ? `열람 복수 신청 (${targets.length}건)` : '열람 신청');
  if (main) main.value = String(cat.main || '-');
  if (sub) sub.value = String(cat.sub || '-');
  if (reason) reason.value = '';
  openModal('projOutAccessReqModal');
}

async function submitProjectOutputAccessRequest() {
  const session = getSession();
  const outputId = String(document.getElementById('proj-out-access-output-id')?.value || '').trim();
  const outputIdsRaw = String(document.getElementById('proj-out-access-output-ids')?.value || '').trim();
  const requestType = String(document.getElementById('proj-out-access-request-type')?.value || '').trim();
  const reason = String(document.getElementById('proj-out-access-reason')?.value || '').trim();
  const outputIds = (outputIdsRaw || outputId).split(',').map((v) => String(v || '').trim()).filter(Boolean);
  const canAction = requestType === 'download'
    ? _projectOutputsCanPortalAction(session, 'download')
    : _projectOutputsCanPortalAction(session, 'export');
  if (!canAction) {
    return Toast.warning(requestType === 'download' ? '다운로드 신청 권한이 없습니다.' : '열람(출력) 신청 권한이 없습니다.');
  }
  if (!outputIds.length) return Toast.warning('신청 대상이 없습니다.');
  if (!reason) return Toast.warning('신청사유를 입력하세요.');
  const me = _projectOutputsCurrentUserId(session);
  if (!me) return Toast.warning('세션 정보를 찾지 못했습니다.');
  let rows = (_PROJECT_OUTPUTS_STATE.outputRows || []).filter((r) => outputIds.includes(String(r.id || '').trim()));
  if (!rows.length) {
    const loaded = await Promise.all(outputIds.map((id) => API.listAllPages('project_outputs', {
      filter: `id=eq.${id}`,
      limit: 1,
      maxPages: 1,
      sort: 'uploaded_at',
    }).catch(() => [])));
    rows = loaded.map((arr) => (arr || [])[0]).filter(Boolean);
  }
  const targets = Array.isArray(rows) ? rows : [];
  if (!targets.length) return Toast.warning('대상 결과물을 찾을 수 없습니다.');
  const invalidMsg = _projectOutputsValidateBulkRequest(requestType, targets);
  if (invalidMsg) return Toast.warning(invalidMsg);
  const firstRow = targets[0];
  const project = _projectOutputsProjectByCode(firstRow.project_code);
  const cat = _projectOutputsCategoryForOutput(firstRow);
  const approver = (_PROJECT_OUTPUTS_STATE.users || []).find((u) =>
    String(u.role || '').trim() === 'director' &&
    String(u.hq_id || '').trim() &&
    String(u.hq_id || '').trim() === String(session?.hq_id || '').trim()
  ) || null;
  if (!approver) return Toast.warning('소속 본부장을 찾지 못했습니다. 관리자에게 문의하세요.');
  const now = Date.now();
  const accessRows = Array.isArray(_PROJECT_OUTPUTS_STATE.accessRequests) ? _PROJECT_OUTPUTS_STATE.accessRequests : [];
  const targetsToCreate = [];
  let pendingDupCnt = 0;
  targets.forEach((row) => {
    const targetId = String(row.id || '').trim();
    const dup = accessRows.find((r) =>
      String(r.output_id || '').trim() === targetId &&
      String(r.request_type || '').trim() === requestType &&
      String(r.requester_user_id || '').trim() === me &&
      ['pending', 'approved'].includes(String(r.status || '').trim())
    );
    if (dup && String(dup.status || '').trim() === 'pending') pendingDupCnt += 1;
    if (!dup) targetsToCreate.push(row);
  });
  if (!targetsToCreate.length) {
    return Toast.warning(pendingDupCnt > 0 ? '선택 건에 이미 승인 대기 중인 신청이 있습니다.' : '이미 유효한 접근 권한이 있는 건입니다.');
  }
  try {
    await Promise.all(targetsToCreate.map((row) => {
      const rowCat = _projectOutputsCategoryForOutput(row);
      return API.create('project_output_access_requests', {
        output_id: String(row.id || ''),
        project_code: String(row.project_code || ''),
        output_title: String(row.output_title || ''),
        request_type: requestType,
        requester_user_id: me,
        requester_user_name: String(session?.name || session?.user_name || ''),
        requester_hq_id: String(session?.hq_id || ''),
        requester_dept_id: String(session?.dept_id || ''),
        approver_user_id: String(approver.id || ''),
        approver_user_name: String(approver.name || ''),
        scope_main_category: String(rowCat.main || ''),
        scope_sub_category: String(rowCat.sub || ''),
        request_reason: reason,
        status: 'pending',
        requested_at: now,
        expires_at: now + _PROJECT_OUTPUT_ACCESS_VALID_MS,
      });
    }));
    if (typeof createNotification === 'function') {
      createNotification({
        toUserId: String(approver.id || ''),
        toUserName: String(approver.name || ''),
        fromUserId: me,
        fromUserName: String(session?.name || session?.user_name || ''),
        type: 'project_output_access_request',
        entryId: `bulk:${requestType}:${me}:${now}`,
        entrySummary: `${String(project?.project_code || firstRow.project_code || '')} / ${String(cat.main || '-')}/${String(cat.sub || '-')} / ${targetsToCreate.length}건`,
        message: `${String(session?.name || '사용자')}님이 ${requestType === 'download' ? '다운로드' : '열람'} 권한을 ${targetsToCreate.length}건 신청했습니다.`,
        targetMenu: 'project-deliverables',
      });
    }
    closeModal('projOutAccessReqModal');
    Toast.success(`접근 신청이 ${targetsToCreate.length}건 등록되었습니다. (승인 유효기간 1일)`);
    await _projectOutputsLoadMyAccessRequests();
    await _projectOutputsLoadApprovalQueue();
    await _projectOutputsLoadList();
  } catch (e) {
    console.error(e);
    Toast.error('접근 신청 실패: ' + (e.message || e));
  }
}

async function _projectOutputsLoadApprovalQueue() {
  const session = getSession();
  const wrap = document.getElementById('proj-out-approval-wrap');
  const body = document.getElementById('proj-out-approval-body');
  if (!wrap || !body) return;
  const canApprove = !!(session && (Auth.isDirector(session) || Auth.isAdmin(session) || Auth.isTopMgr(session)));
  wrap.style.display = canApprove ? '' : 'none';
  if (!canApprove) return;
  let filter = 'status=eq.pending';
  if (Auth.isDirector(session)) {
    const me = _projectOutputsCurrentUserId(session);
    filter = `status=eq.pending&approver_user_id=eq.${me}`;
  }
  const rows = await API.listAllPages('project_output_access_requests', {
    filter,
    limit: 300,
    maxPages: 5,
    sort: 'requested_at',
  }).catch((e) => {
    const msg = String(e && e.message || '');
    if (/project_output_access_requests|relation|schema cache/i.test(msg)) {
      body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-database"></i><p>접근신청 테이블이 필요합니다.</p></td></tr>';
      return [];
    }
    throw e;
  });
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-inbox"></i><p>대기중인 신청이 없습니다.</p></td></tr>';
    return;
  }
  body.innerHTML = list.map((r) => `
    <tr>
      <td style="text-align:center">${escapeHtml(String(r.request_type || '') === 'download' ? '다운로드' : '열람')}</td>
      <td>${escapeHtml(r.requester_user_name || '')}</td>
      <td>${escapeHtml(r.project_code || '')}</td>
      <td>${escapeHtml(r.scope_main_category || '')}</td>
      <td>${escapeHtml(r.scope_sub_category || '')}</td>
      <td>${escapeHtml(r.request_reason || '-')}</td>
      <td style="text-align:center">${_projectOutputsFmtDate(r.requested_at)}</td>
      <td style="text-align:center;white-space:nowrap">
        <button type="button" class="btn btn-xs btn-ghost po-action-btn" onclick="approveProjectOutputAccessRequest('${escapeHtml(r.id || '')}')">승인</button>
        <button type="button" class="btn btn-xs btn-ghost po-action-btn po-action-btn-danger" onclick="rejectProjectOutputAccessRequest('${escapeHtml(r.id || '')}')">반려</button>
      </td>
    </tr>
  `).join('');
}

async function approveProjectOutputAccessRequest(requestId) {
  const id = String(requestId || '').trim();
  if (!id) return;
  const session = getSession();
  const now = Date.now();
  try {
    await API.patch('project_output_access_requests', id, {
      status: 'approved',
      approved_at: now,
      approved_by: _projectOutputsCurrentUserId(session),
      approved_by_name: String(session?.name || session?.user_name || ''),
      expires_at: now + _PROJECT_OUTPUT_ACCESS_VALID_MS,
    });
    await _projectOutputsNotifyAccessDecision(id, true);
    Toast.success('승인되었습니다. (유효기간 1일)');
    await _projectOutputsLoadMyAccessRequests();
    await _projectOutputsLoadApprovalQueue();
    await _projectOutputsLoadList();
  } catch (e) {
    Toast.error('승인 처리 실패: ' + (e.message || e));
  }
}

async function rejectProjectOutputAccessRequest(requestId) {
  const id = String(requestId || '').trim();
  if (!id) return;
  const session = getSession();
  const reason = String(window.prompt('반려 사유를 입력하세요.', '') || '').trim();
  try {
    await API.patch('project_output_access_requests', id, {
      status: 'rejected',
      approved_at: Date.now(),
      approved_by: _projectOutputsCurrentUserId(session),
      approved_by_name: String(session?.name || session?.user_name || ''),
      decision_note: reason,
    });
    await _projectOutputsNotifyAccessDecision(id, false, reason);
    Toast.success('반려 처리되었습니다.');
    await _projectOutputsLoadApprovalQueue();
  } catch (e) {
    Toast.error('반려 처리 실패: ' + (e.message || e));
  }
}

async function _projectOutputsNotifyAccessDecision(requestId, approved, reason = '') {
  if (typeof createNotification !== 'function') return;
  const rows = await API.listAllPages('project_output_access_requests', {
    filter: `id=eq.${requestId}`,
    limit: 1,
    maxPages: 1,
    sort: 'updated_at',
  }).catch(() => []);
  const row = (rows || [])[0] || null;
  if (!row) return;
  createNotification({
    toUserId: String(row.requester_user_id || ''),
    toUserName: String(row.requester_user_name || ''),
    fromUserId: String(row.approved_by || ''),
    fromUserName: String(row.approved_by_name || ''),
    type: 'project_output_access_decision',
    entryId: String(requestId || ''),
    entrySummary: `${String(row.project_code || '')} / ${String(row.scope_main_category || '-')}/${String(row.scope_sub_category || '-')}`,
    message: approved
      ? `${String(row.request_type || '') === 'download' ? '다운로드' : '열람'} 신청이 승인되었습니다. (유효기간 1일)`
      : `${String(row.request_type || '') === 'download' ? '다운로드' : '열람'} 신청이 반려되었습니다.${reason ? ` 사유: ${reason}` : ''}`,
    targetMenu: 'project-deliverables',
  });
}

async function openProjectOutputMyRequests() {
  await _projectOutputsLoadMyAccessRequests();
  const mine = (_PROJECT_OUTPUTS_STATE.accessRequests || [])
    .sort((a, b) => Number(b.requested_at || b.created_at || 0) - Number(a.requested_at || a.created_at || 0))
    .slice(0, 20);
  if (!mine.length) {
    Toast.info('최근 신청 내역이 없습니다.');
    return;
  }
  const lines = mine.map((r) => {
    const type = String(r.request_type || '') === 'download' ? '다운로드' : '열람';
    const st = String(r.status || '');
    const statusLabel = st === 'approved' ? '승인' : (st === 'rejected' ? '반려' : (st === 'expired' ? '만료' : '대기'));
    return `${type} | ${String(r.project_code || '')} | ${String(r.scope_main_category || '-')}/${String(r.scope_sub_category || '-')} | ${statusLabel} | ${_projectOutputsFmtDate(r.requested_at)}`;
  });
  window.alert(['[최근 결과물 접근 신청]', ...lines].join('\n'));
}

async function _projectOutputsUpload() {
  const session = getSession();
  const mainEl = document.getElementById('proj-out-new-main-category');
  const subEl = document.getElementById('proj-out-new-sub-category');
  const titleEl = document.getElementById('proj-out-new-title');
  const noteEl = document.getElementById('proj-out-new-note');
  const fileEl = document.getElementById('proj-out-new-file');
  const btn = document.getElementById('proj-out-new-upload-btn');
  if (!mainEl || !subEl || !titleEl || !fileEl) return;

  const mainCategory = String(mainEl.value || '').trim();
  const subCategory = String(subEl.value || '').trim();
  const outputType = _PROJECT_OUTPUT_TYPE_REFERENCE;
  const outputTitle = String(titleEl.value || '').trim();
  const note = String((noteEl && noteEl.value) || '').trim();
  const file = fileEl.files && fileEl.files[0];
  if (!mainCategory) return Toast.warning('프로젝트 대분류를 선택해주세요.');
  if (!subCategory) return Toast.warning('프로젝트 소분류를 선택해주세요.');
  if (!outputTitle) return Toast.warning('결과물 제목을 입력해주세요.');
  if (!file) return Toast.warning('업로드할 파일을 선택해주세요.');

  const prevText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 업로드 중...';
  }
  try {
    const now = Date.now();
    const d = new Date(now);
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const ext = String(file.name || '').split('.').pop() || 'bin';
    const stem = _projectOutputsSafeSegment(String(file.name || '').replace(/\.[^.]*$/, ''));
    const uniq = Math.random().toString(36).slice(2, 8);
    const pathCode = `${mainCategory}-${subCategory}` || 'manual-reference';
    const path = `project-outputs/${yyyy}/${mm}/${_projectOutputsSafeSegment(pathCode)}/${now}_${uniq}_${stem}.${ext}`;
    const up = await API.storageUpload(_PROJECT_OUTPUTS_BUCKET, path, file, { upsert: false });

    const payload = {
      project_id: '',
      project_code: '',
      project_name: '',
      output_type: outputType || _PROJECT_OUTPUT_TYPE_REFERENCE,
      output_main_category: mainCategory,
      output_sub_category: subCategory,
      output_title: outputTitle,
      output_file_name: String(file.name || ''),
      output_file_url: String((up && up.publicUrl) || ''),
      output_file_path: String((up && up.path) || ''),
      preview_file_path: '',
      preview_ready: false,
      preview_version: 1,
      uploaded_by: String(session.user_id || session.id || ''),
      uploaded_by_name: String(session.name || session.user_name || ''),
      uploaded_at: now,
      note,
      publish_status: 'published',
      publish_approved_at: now,
      publish_approved_by_name: String(session.name || session.user_name || ''),
    };
    let created = null;
    try {
      created = await API.create('project_outputs', payload);
    } catch (createErr) {
      const msg = String(createErr && createErr.message || '');
      const fallbackPayload = { ...payload };
      if (/publish_status|publish_approved/i.test(msg)) {
        delete fallbackPayload.publish_status;
        delete fallbackPayload.publish_approved_at;
        delete fallbackPayload.publish_approved_by_name;
      }
      if (/output_main_category|output_sub_category|column/i.test(msg)) {
        delete fallbackPayload.output_main_category;
        delete fallbackPayload.output_sub_category;
        const catLine = `[분류] 대분류:${mainCategory} / 소분류:${subCategory}`;
        fallbackPayload.note = note ? `${catLine}\n${note}` : catLine;
      }
      created = await API.create('project_outputs', fallbackPayload);
    }

    await _projectOutputsPersistRagSeed(created || payload, session);

    if (mainEl) mainEl.value = '';
    if (subEl) subEl.value = '';
    if (titleEl) titleEl.value = '';
    if (noteEl) noteEl.value = '';
    if (fileEl) fileEl.value = '';
    _projectOutputsSyncNewCategoryOptions();
    closeModal('projOutNewModal');
    Toast.success('참고자료가 저장되었습니다.');
    await _projectOutputsLoadList();
  } catch (e) {
    console.error('[project-outputs] upload failed', e);
    Toast.error(e.message || '참고자료 업로드 실패');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = prevText || '<i class="fas fa-upload"></i> 결과물 업로드';
    }
  }
}

function openProjectOutputNewModal() {
  const session = getSession();
  if (!Auth.canViewProjectDeliverables(session)) {
    Toast.warning('직접등록 권한이 없습니다.');
    return;
  }
  const mainEl = document.getElementById('proj-out-new-main-category');
  const subEl = document.getElementById('proj-out-new-sub-category');
  const titleEl = document.getElementById('proj-out-new-title');
  const noteEl = document.getElementById('proj-out-new-note');
  const fileEl = document.getElementById('proj-out-new-file');
  if (mainEl) mainEl.value = '';
  if (subEl) subEl.value = '';
  _projectOutputsSyncNewCategoryOptions();
  if (titleEl) titleEl.value = '';
  if (noteEl) noteEl.value = '';
  if (fileEl) fileEl.value = '';
  openModal('projOutNewModal');
}

async function openProjectOutputActionModal(outputId) {
  const id = String(outputId || '').trim();
  if (!id) return;
  const session = getSession();
  const rowRes = await API.list('project_outputs', {
    select: 'id,project_code,project_name,output_type,output_title',
    id: `eq.${id}`,
    limit: 1,
  }).catch(() => []);
  const output = Array.isArray(rowRes) ? rowRes[0] : null;
  if (!output) {
    Toast.warning('유의사항 정보를 찾을 수 없습니다.');
    return;
  }
  const project = (_PROJECT_OUTPUTS_STATE.projects || []).find((p) => String(p.project_code || '') === String(output.project_code || '')) || null;
  if (!_projectOutputsCanAction(session, project)) {
    Toast.warning('조치 등록 권한이 없습니다.');
    return;
  }
  const hid = document.getElementById('proj-out-action-output-id');
  const summary = document.getElementById('proj-out-action-output-summary');
  const statusEl = document.getElementById('proj-out-action-status');
  const noteEl = document.getElementById('proj-out-action-note');
  if (hid) hid.value = id;
  if (summary) summary.textContent = `${output.project_code || ''} · ${output.output_title || ''}`;
  if (statusEl) statusEl.value = 'confirmed';
  if (noteEl) noteEl.value = '';
  await _projectOutputsRenderActionHistory(id);
  openModal('projOutActionModal');
}

async function _projectOutputsRenderActionHistory(outputId) {
  const wrap = document.getElementById('proj-out-action-history');
  if (!wrap) return;
  wrap.innerHTML = '<div style="color:var(--text-muted)">조치 이력을 불러오는 중...</div>';
  try {
    const rows = await API.listAllPages('project_output_actions', { limit: 500, maxPages: 5, sort: 'updated_at' });
    const scoped = (rows || [])
      .filter((r) => String(r.output_id || '').trim() === String(outputId || '').trim())
      .sort((a, b) => Number(b.updated_at || b.created_at || 0) - Number(a.updated_at || a.created_at || 0));
    if (!scoped.length) {
      wrap.innerHTML = '<div style="color:var(--text-muted)">등록된 조치 이력이 없습니다.</div>';
      return;
    }
    wrap.innerHTML = scoped.map((r) => `
      <div style="border:1px solid var(--border-light);border-radius:8px;padding:8px 10px;margin-top:6px">
        <div style="font-size:11px;color:var(--text-muted);display:flex;justify-content:space-between">
          <span>${escapeHtml(r.action_user_name || '-')} · ${escapeHtml(_projectOutputsActionStatusLabel(r.action_status))}</span>
          <span>${_projectOutputsFmtDate(r.action_at || r.updated_at || r.created_at)}</span>
        </div>
        <div style="font-size:12px;line-height:1.45;margin-top:4px;color:var(--text-secondary)">${escapeHtml(r.action_note || '-')}</div>
      </div>
    `).join('');
  } catch (e) {
    wrap.innerHTML = '<div style="color:var(--danger)">조치 이력을 불러올 수 없습니다. (DB 스키마 확인 필요)</div>';
  }
}

async function saveProjectOutputAction() {
  const session = getSession();
  const outputId = String(document.getElementById('proj-out-action-output-id')?.value || '').trim();
  const status = String(document.getElementById('proj-out-action-status')?.value || 'confirmed').trim();
  const note = String(document.getElementById('proj-out-action-note')?.value || '').trim();
  if (!outputId) {
    Toast.warning('대상 유의사항이 없습니다.');
    return;
  }
  if (!note) {
    Toast.warning('조치내용을 입력하세요.');
    return;
  }
  const outputRows = await API.list('project_outputs', { select: 'id,project_code', id: `eq.${outputId}`, limit: 1 }).catch(() => []);
  const output = Array.isArray(outputRows) ? outputRows[0] : null;
  const project = (_PROJECT_OUTPUTS_STATE.projects || []).find((p) => String(p.project_code || '') === String((output && output.project_code) || '')) || null;
  if (!_projectOutputsCanAction(session, project)) {
    Toast.warning('조치 등록 권한이 없습니다.');
    return;
  }
  try {
    const me = String(session.user_id || session.id || '');
    const all = await API.listAllPages('project_output_actions', { limit: 500, maxPages: 5, sort: 'updated_at' }).catch(() => []);
    const hit = (all || []).find((r) => String(r.output_id || '') === outputId && String(r.action_user_id || '') === me);
    const payload = {
      output_id: outputId,
      project_code: String((output && output.project_code) || ''),
      action_user_id: me,
      action_user_name: String(session.name || session.user_name || ''),
      action_role: String(session.role || ''),
      action_status: status,
      action_note: note,
      action_at: Date.now(),
      updated_at: Date.now(),
    };
    if (hit && hit.id) await API.patch('project_output_actions', hit.id, payload);
    else await API.create('project_output_actions', payload);
    Toast.success('조치사항이 저장되었습니다.');
    await _projectOutputsRenderActionHistory(outputId);
    await _projectOutputsLoadList();
  } catch (e) {
    console.error(e);
    Toast.error('조치 저장 실패: project_output_actions 테이블/권한을 확인하세요.');
  }
}

function init_project_deliverables() {
  const session = getSession();
  const canExportAction = _projectOutputsCanPortalAction(session, 'export');
  const canDownloadAction = _projectOutputsCanPortalAction(session, 'download');
  const fromEl = document.getElementById('proj-out-date-from');
  const toEl = document.getElementById('proj-out-date-to');
  if (fromEl && !fromEl.value) {
    const d = new Date();
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    fromEl.value = first.toISOString().slice(0, 10);
  }
  if (toEl && !toEl.value) {
    const d = new Date();
    toEl.value = d.toISOString().slice(0, 10);
  }
  if (!_PROJECT_OUTPUTS_STATE.initialized) {
    document.getElementById('proj-out-refresh-btn')?.addEventListener('click', _projectOutputsLoadList);
    document.getElementById('proj-out-date-from')?.addEventListener('change', _projectOutputsLoadList);
    document.getElementById('proj-out-date-to')?.addEventListener('change', _projectOutputsLoadList);
    document.getElementById('proj-out-kind-filter')?.addEventListener('change', _projectOutputsLoadList);
    document.getElementById('proj-out-project')?.addEventListener('change', _projectOutputsLoadList);
    document.getElementById('proj-out-main-category')?.addEventListener('change', () => {
      _projectOutputsSyncCategoryFilters();
      _projectOutputsLoadList();
    });
    document.getElementById('proj-out-sub-category')?.addEventListener('change', _projectOutputsLoadList);
    document.getElementById('proj-out-uploader')?.addEventListener('input', _projectOutputsLoadList);
    document.getElementById('proj-out-new-main-category')?.addEventListener('change', _projectOutputsSyncNewCategoryOptions);
    document.getElementById('proj-out-my-requests-btn')?.addEventListener('click', openProjectOutputMyRequests);
    document.getElementById('proj-out-new-btn')?.addEventListener('click', openProjectOutputNewModal);
    document.getElementById('proj-out-new-upload-btn')?.addEventListener('click', _projectOutputsUpload);
    document.getElementById('proj-out-bulk-view-btn')?.addEventListener('click', () => openProjectOutputBulkAccessRequest('view'));
    document.getElementById('proj-out-bulk-download-btn')?.addEventListener('click', () => openProjectOutputBulkAccessRequest('download'));
    document.getElementById('proj-out-select-all')?.addEventListener('change', (e) => {
      const checked = !!(e && e.target && e.target.checked);
      Array.from(document.querySelectorAll('#proj-out-body .proj-out-select-row')).forEach((el) => {
        el.checked = checked;
      });
      _projectOutputsSyncSelectionUi();
    });
    document.getElementById('proj-out-approval-refresh-btn')?.addEventListener('click', _projectOutputsLoadApprovalQueue);
    _PROJECT_OUTPUTS_STATE.initialized = true;
  }
  const msg = document.getElementById('proj-out-summary');
  if (msg) {
    if (!canExportAction && !canDownloadAction) {
      msg.textContent = '열람(출력)/다운로드 권한이 없습니다. 권한관리에서 액션 권한을 설정하세요.';
    } else if (Auth.canViewProjectDeliverables(session)) {
      msg.textContent = '게시 승인된 결과보고서를 열람/다운로드할 수 있습니다.';
    } else {
      msg.textContent = '권한이 없으면 대/소분류 범위로 열람/다운로드 신청 후 이용 가능합니다.';
    }
  }
  const bulkViewBtn = document.getElementById('proj-out-bulk-view-btn');
  const bulkDownloadBtn = document.getElementById('proj-out-bulk-download-btn');
  if (bulkViewBtn) bulkViewBtn.style.display = canExportAction ? '' : 'none';
  if (bulkDownloadBtn) bulkDownloadBtn.style.display = canDownloadAction ? '' : 'none';
  _projectOutputsLoadUsersAndCodeTypes()
    .then(_projectOutputsLoadProjects)
    .then(_projectOutputsLoadMyAccessRequests)
    .then(_projectOutputsLoadApprovalQueue)
    .then(_projectOutputsLoadList)
    .catch((e) => {
      console.error('[project-outputs] init failed', e);
      Toast.error(e.message || '프로젝트 산출물 초기화 실패');
    });
}
