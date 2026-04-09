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
      el.style.whiteSpace    = 'pre-wrap';
      el.style.wordBreak     = 'break-word';
    });
    tmp.querySelectorAll('td').forEach(el => {
      el.style.border        = '1px solid #cbd5e1';
      el.style.padding       = '4px 8px';
      el.style.verticalAlign = 'top';
      el.style.whiteSpace    = 'pre-wrap';
      el.style.wordBreak     = 'break-word';
    });
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

      // 표 + 본문 앞단 Word 헤더 동시 제거 후 표 모드
      const cleanedMail = _entryCleanDescHtmlForEdit(htmlData);
      const cleanHtml = _injectDescTableStyle(cleanedMail);
      _entrySwitchToRich(cleanHtml);

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

        const cleanHtml = _injectDescTableStyle(tableHtml);
        _entrySwitchToRich(cleanHtml);

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
      const cleanHtml = _injectDescTableStyle(tableHtml);
      _entrySwitchToRich(cleanHtml);

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
// 타임시트 등록 초기화
// ─────────────────────────────────────────────
async function init_entry_new() {
  // ★ 수정 모드에서 navigateTo가 자동 재호출하는 경우 차단
  if (_editMode) { _editMode = false; return; }

  const session = getSession();
  if (!Auth.canWriteEntry(session)) {
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

  // 신규 등록: 초기화
  _editEntryId  = null;
  _pendingFiles = [];
  _currentCategoryType = ''; // 대분류 미선택 상태로 초기화
  document.getElementById('fileList').innerHTML = '';

  // form 태그 제거로 .reset() 대신 필드를 직접 초기화
  const _resetFormFields = () => {
    const subReset = document.getElementById('entry-subcategory');
    if (subReset) {
      subReset.innerHTML = '<option value="">소분류 선택</option>';
      subReset.selectedIndex = 0;
    }
    ['entry-category','entry-subcategory','entry-team','entry-client',
     'entry-start','entry-end','entry-duration',
     'kw-query-hidden','law-refs-hidden','kw-reason-hidden'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (id === 'entry-subcategory') return; // 위에서 옵션 전체 초기화함
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = el.id === 'law-refs-hidden' ? '[]' : '';
    });
  };
  _resetFormFields();
  document.getElementById('duration-text').textContent = '시작/종료 시간을 입력하면 자동 계산됩니다.';
  document.getElementById('entry-duration').value = '';
  _clearDurationInput(); // 실제 소요시간 시간·분 입력란 초기화
  document.getElementById('entry-user-name').value = session.name;

  // Quill 에디터 초기화 (최초 1회 생성, 이후 리셋만)
  // 표 전용 contenteditable 잔여 표시/플래그 제거 — 신규·수정 폼 모두 Quill 기준으로 시작
  _initQuill();
  entrySwitchToQuill();

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

    _allCategories    = categories;
    _allSubcategories = subcategories;

    // 대분류 드롭다운
    const catEl = document.getElementById('entry-category');
    const subEl = document.getElementById('entry-subcategory');
    // 마스터 로딩(await) 도중 사용자가 이전 화면에 남아 있던 옵션으로 선택한 경우,
    // innerHTML 재구성 시 선택값이 통째로 사라져 저장 시 catId/subId가 비는 문제가 생김 → 유효하면 복원
    const preserveCatId = (catEl.value || '').trim();
    const preserveSubId = (subEl && subEl.value || '').trim();

    catEl.innerHTML = '<option value="">대분류 선택</option>';
    categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.category_name;
      opt.dataset.type = c.category_type || 'client';
      catEl.appendChild(opt);
    });

    const catOk = preserveCatId && categories.some(c => String(c.id) === String(preserveCatId));
    if (catOk) {
      catEl.value = preserveCatId;
      onCategoryChange();
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

    // 고객 섹션 초기 상태
    updateClientSection();

    // ── 승인자 배너 ──────────────────────────────
    try {
      const userRecord       = await API.get('users', session.id);
      const approverNotice   = document.getElementById('entry-approver-notice');
      const noApproverNotice = document.getElementById('entry-no-approver-notice');
      const approverNameText = document.getElementById('entry-approver-name-text');
      const noApproverSpan   = noApproverNotice ? noApproverNotice.querySelector('span') : null;

      const isManager = session.role === 'manager';

      if (isManager) {
        // Manager → reviewer2_id(Director) 유무로 판단
        const directorId   = (userRecord && userRecord.reviewer2_id)   || session.reviewer2_id   || '';
        const directorName = (userRecord && userRecord.reviewer2_name) || session.reviewer2_name || '';
        if (directorId) {
          approverNameText.textContent   = 'Director: ' + (directorName || '지정됨');
          approverNotice.style.display   = 'flex';
          noApproverNotice.style.display = 'none';
        } else {
          if (noApproverSpan) noApproverSpan.textContent = 'Director가 지정되지 않았습니다.';
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
function onCategoryChange() {
  const catEl = document.getElementById('entry-category');
  const selectedOpt = catEl.options[catEl.selectedIndex];
  const catId  = catEl.value;
  const catType = selectedOpt ? selectedOpt.dataset.type : 'client';
  _currentCategoryType = catType || 'client';

  const subs = _allSubcategories.filter(s => String(s.category_id) === String(catId));
  const subEl = document.getElementById('entry-subcategory');
  subEl.innerHTML = '<option value="">소분류 선택</option>';
  subs.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.sub_category_name;
    subEl.appendChild(opt);
  });

  updateClientSection();
  _entryUpdateExampleTags();
}

function updateClientSection() {
  const isClient   = _currentCategoryType === 'client';
  const isInternal = _currentCategoryType === 'internal';
  const isNone     = !_currentCategoryType; // 대분류 미선택
  const catEl = document.getElementById('entry-category');
  const catName = catEl?.options?.[catEl.selectedIndex]?.textContent || '';
  const isClearance = catName.trim() === '일반통관업무';
  const isCompanyInternal = catName.trim() === '회사내부업무';

  // ── 패널 요소 ──────────────────────────────────────
  const metaPanel      = document.querySelector('.entry-panel-meta');   // ① 기본정보
  const descPanel      = document.querySelector('.entry-panel-desc');   // ② 수행내용
  const filePanel      = document.getElementById('filePanel');          // ④ 결과물
  const kwSection      = document.getElementById('kwSection');          // ③ 자문분류
  const clientSection  = document.getElementById('clientSection');      // 고객사 행
  const attachRequired = document.getElementById('attachRequired');
  const attachOptional = document.getElementById('attachOptional');
  const memoSection    = document.getElementById('internalMemoSection'); // 메모란
  const teamRow        = document.getElementById('entry-team-row');     // 수행팀 행(2열)
  const teamEl         = document.getElementById('entry-team');

  // 회사내부업무: 수행팀 선택 자체를 숨김(요청사항)
  if (teamRow) teamRow.style.display = isCompanyInternal ? 'none' : '';
  if (isCompanyInternal && teamEl) {
    teamEl.value = '';
    try { teamEl.removeAttribute('required'); } catch {}
  } else if (teamEl) {
    try { teamEl.setAttribute('required', ''); } catch {}
  }

  if (isNone) {
    // ── 대분류 미선택: ① 기본정보만 전체폭, 나머지 숨김 ──
    if (metaPanel)  { metaPanel.classList.add('span-full'); }
    if (descPanel)  descPanel.style.display = 'none';
    if (filePanel)  { filePanel.style.display = 'none'; filePanel.classList.remove('span-full'); }
    if (kwSection)  kwSection.style.display  = 'none';
    if (clientSection) clientSection.style.display = 'none';
    if (attachRequired) attachRequired.style.display = 'none';
    if (attachOptional) attachOptional.style.display = 'none';
    if (memoSection) memoSection.style.display = 'none';

  } else if (isClient) {
    // ── 일반자문업무: ①②③④ 4패널 전체 표시 ──────────
    if (metaPanel)  metaPanel.classList.remove('span-full');
    if (descPanel)  descPanel.style.display = '';
    if (filePanel)  { filePanel.style.display = ''; filePanel.classList.remove('span-full'); }
    if (kwSection)  kwSection.style.display  = '';
    if (clientSection) clientSection.style.display = '';
    if (attachRequired) attachRequired.style.display = '';
    if (attachOptional) attachOptional.style.display = 'none';
    if (memoSection) memoSection.style.display = 'none';

  } else {
    // ── 내부업무(프로젝트·통관·기타): ① 기본정보만 전체폭 + 메모 ──
    if (metaPanel)  metaPanel.classList.add('span-full');
    if (descPanel)  descPanel.style.display = 'none';
    if (filePanel)  { filePanel.style.display = 'none'; filePanel.classList.remove('span-full'); }
    if (kwSection)  kwSection.style.display  = 'none';
    // 일반통관업무는 내부업무 UI를 유지하되, 고객사 지정은 필요하므로 고객사 행만 노출
    if (clientSection) clientSection.style.display = isClearance ? '' : 'none';
    if (attachRequired) attachRequired.style.display = 'none';
    if (attachOptional) attachOptional.style.display = 'none';
    if (memoSection) memoSection.style.display = '';
  }
}

// ─── 소분류 변경 → 자문자료실과 동일 예시 태그 칩 ──────────────
function onSubcategoryChange() {
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
  const start   = document.getElementById('entry-start').value;
  const end     = document.getElementById('entry-end').value;
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

async function saveEntry(status) {
  const session = getSession();

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
  try {
    const userRecord = await API.get('users', session.id);
    if (!userRecord) throw new Error('userRecord null');

    if (session.role === 'manager') {
      // manager 본인 건: reviewer2_id(director)를 approver_id로 저장
      // → approval.js에서 director가 String(e.approver_id)===String(session.id) 로 조회
      if (userRecord.reviewer2_id) {
        approverInfo = {
          approver_id:    userRecord.reviewer2_id,
          approver_name:  userRecord.reviewer2_name || '',
          reviewer2_id:   userRecord.reviewer2_id,
          reviewer2_name: userRecord.reviewer2_name || ''
        };
      } else {
        // fallback: 소속 범위의 director 자동 탐색
        const allUsers = await Master.users();
        const myDirector = allUsers.find(u =>
          u.role === 'director' &&
          u.is_active !== false &&
          Auth.scopeMatch(u, userRecord)
        ) || allUsers.find(u =>
          u.role === 'director' && u.is_active !== false &&
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
    if (session.role === 'manager' && !approverInfo.reviewer2_id && status === 'submitted') {
      Toast.warning('2차 승인자(Director)가 지정되지 않았습니다. 관리자에게 요청하세요.');
      return;
    }
  }

  const catEl    = document.getElementById('entry-category');
  const subEl    = document.getElementById('entry-subcategory');
  const teamEl   = document.getElementById('entry-team');
  const catId    = (catEl && catEl.value || '').trim();
  const catName  = catEl && catEl.selectedIndex >= 0 ? (catEl.options[catEl.selectedIndex]?.textContent || '') : '';
  const catType  = catEl && catEl.selectedIndex >= 0 ? (catEl.options[catEl.selectedIndex]?.dataset.type || 'client') : 'client';
  const subId    = (subEl && subEl.value || '').trim();
  const subName  = subEl.options[subEl.selectedIndex]?.textContent || '';
  const isCompanyInternal = catName.trim() === '회사내부업무';
  const teamId   = isCompanyInternal ? '' : teamEl.value;
  const teamName = isCompanyInternal ? '' : (teamEl.options[teamEl.selectedIndex]?.textContent || '');
  // ★ ClientSearchSelect에서 고객사 값 읽기
  const csVal      = ClientSearchSelect.getValue('entry-client-wrap');
  const clientId   = csVal.id || document.getElementById('entry-client').value || '';
  const clientName = csVal.name || '';
  const startAt    = document.getElementById('entry-start').value;
  const endAt      = document.getElementById('entry-end').value;
  // ★ 실제 소요시간: 사용자 직접 입력(시간·분) 우선, 없으면 hidden(자동계산) 사용
  syncActualDuration(); // 저장 직전 한 번 더 동기화
  const duration   = parseInt(document.getElementById('entry-duration').value) || 0;

  // ★ Quill 내용 → hidden inputs 동기화 (저장 직전)
  // internal 대분류는 메모란 텍스트를 description으로 사용
  let description   = '';
  let descriptionMd = '';
  if (catType === 'client') {
    _syncQuillToHidden();
    description   = document.getElementById('entry-description').value.trim();
    descriptionMd = document.getElementById('entry-description-md')?.value.trim() || '';
  } else {
    const memoEl = document.getElementById('entry-memo');
    description   = memoEl ? memoEl.value.trim() : '';
    descriptionMd = description;
  }

  // 유효성 검사
  if (!catId || !subId)   { Toast.warning('대분류와 소분류를 선택하세요.'); return; }
  if (!isCompanyInternal && !teamId) { Toast.warning('수행 팀을 선택하세요.'); return; }
  if (!startAt || !endAt) { Toast.warning('업무 시작/종료 일시를 입력하세요.'); return; }
  if (duration <= 0)      { Toast.warning('실제 소요시간을 입력하세요. (시간 또는 분에 숫자를 입력)'); return; }
  if (catType === 'client' && !description) {
    Toast.warning('수행 내용을 입력하세요.');
    if (_quill) _quill.focus();
    return;
  }
  const isClearance = catName.trim() === '일반통관업무';
  if ((catType === 'client' || isClearance) && !clientId) { Toast.warning('고객사를 선택하세요.'); return; }
  // 핵심키워드 필수 (고객업무 제출 시)
  if (catType === 'client' && status === 'submitted') {
    let kwArr = [];
    try { kwArr = JSON.parse(document.getElementById('kw-query-hidden')?.value || '[]'); } catch {}
    if (!kwArr.length) { Toast.warning('핵심키워드를 1개 이상 입력하세요. (자문 분류 정보)'); document.getElementById('kw-query-input')?.focus(); return; }
  }
  if (catType === 'client' && status === 'submitted' && _pendingFiles.length === 0) {
    Toast.warning('고객업무는 자문 결과물을 첨부해야 합니다.'); return;
  }

  // ★ 시간 겹침 — 경고만 표시, 저장은 허용
  {
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
  if (catType === 'client') {
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
        _showSensitiveWarning(sensitiveResults, () => _doSaveEntry(status, approverInfo));
        return; // 사용자 선택 대기
      }
    }
  }

  // 민감정보 없거나 internal → 바로 저장 실행
  await _doSaveEntry(status, approverInfo);
}

/**
 * 실제 저장 로직 (민감정보 팝업 통과 후 호출)
 * saveEntry()의 하위 함수로 분리하여 팝업 콜백에서도 재사용
 */
async function _doSaveEntry(status, approverInfo) {
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
  const subId      = subEl.value;
  const subName    = subEl.options[subEl.selectedIndex]?.textContent || '';
  const teamId     = teamEl.value;
  const teamName   = teamEl.options[teamEl.selectedIndex]?.textContent || '';
  const csVal      = ClientSearchSelect.getValue('entry-client-wrap');
  const clientId   = csVal.id || document.getElementById('entry-client').value || '';
  const clientName = csVal.name || '';
  const startAt    = document.getElementById('entry-start').value;
  const endAt      = document.getElementById('entry-end').value;
  syncActualDuration();
  const duration   = parseInt(document.getElementById('entry-duration').value) || 0;

  let description = '', descriptionMd = '';
  if (catType === 'client') {
    _syncQuillToHidden();
    description   = document.getElementById('entry-description').value.trim();
    descriptionMd = document.getElementById('entry-description-md')?.value.trim() || '';
  } else {
    const memoEl = document.getElementById('entry-memo');
    description   = memoEl ? memoEl.value.trim() : '';
    descriptionMd = description;
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
    const entryData = {
      user_id:   session.id,
      user_name: session.name,
      team_id:   teamId,
      team_name: teamName,
      // 일반통관업무도 고객사 지정 허용/필수화 예정 (아래에서 isClearance로 제어)
      client_id:   (catType === 'client' || isClearance) ? clientId : '',
      client_name: (catType === 'client' || isClearance) ? clientName : '',
      work_category_id:   catId,
      work_category_name: catName,
      work_subcategory_id:   subId,
      work_subcategory_name: subName,
      time_category:  catType,
      work_start_at:  new Date(startAt).getTime(),
      work_end_at:    new Date(endAt).getTime(),
      duration_minutes: duration,
      work_description:    description,
      work_description_md: descriptionMd,
      approver_id:   approverInfo.approver_id,
      approver_name: approverInfo.approver_name,
      reviewer2_id:  approverInfo.reviewer2_id  || '',
      reviewer2_name: approverInfo.reviewer2_name || '',
      status,
      // 자문 분류 정보 (고객업무 시만 의미있음)
      kw_query:  catType === 'client' ? (() => { try { return JSON.parse(document.getElementById('kw-query-hidden')?.value || '[]'); } catch { return []; } })() : [],
      law_refs:  catType === 'client' ? (document.getElementById('law-refs-hidden')?.value || '[]') : '[]',
      kw_reason: catType === 'client' ? (() => { try { return JSON.parse(document.getElementById('kw-reason-hidden')?.value || '[]'); } catch { return []; } })() : [],
    };

    let entry;
    if (_editEntryId) {
      // 수정: doc_no는 기존 값을 유지 (비어있을 때만 생성)
      const existing = await API.get('time_entries', _editEntryId);
      if (existing && existing.doc_no) {
        entryData.doc_no = existing.doc_no;
        entry = await API.update('time_entries', _editEntryId, entryData);
      } else {
        // 문서번호는 "저장 시점" 기준으로 발번 (작성일자와 일치)
        entry = await _entryEnsureDocNoForSave(Date.now(), async (docNo) => {
          entryData.doc_no = docNo;
          return await API.update('time_entries', _editEntryId, entryData);
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
    if (status === 'submitted' && typeof createNotification === 'function') {
      const catLabel   = catType === 'client' ? (clientName || '고객사') : catName;
      const summary    = `${catLabel} | ${subName || catName}`;
      const dateStr    = startAt ? new Date(startAt).toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit' }) : '';

      // 1차 승인자에게 알림
      if (approverInfo.approver_id) {
        createNotification({
          toUserId:     approverInfo.approver_id,
          toUserName:   approverInfo.approver_name,
          fromUserId:   session.id,
          fromUserName: session.name,
          type:         'submitted',
          entryId:      entry.id,
          entrySummary: summary,
          message:      `${session.name}님이 타임시트 승인을 요청했습니다.`,
          targetMenu:   'approval',
        });
      }
    }

    Toast.success(status === 'submitted' ? '타임시트가 제출되었습니다.' : '임시저장되었습니다.');
    window._dashNeedsRefresh = true; // 대시보드 재진입 시 캐시 갱신
    _editEntryId  = null;
    _pendingFiles = [];
    _deletedAttIds = [];
    _existingAtts  = [];

    document.getElementById('fileList').innerHTML = '';
    // form 태그 제거로 .reset() 대신 필드를 직접 초기화
    ['entry-category','entry-subcategory','entry-team','entry-client',
     'entry-start','entry-end','entry-duration',
     'kw-query-hidden','law-refs-hidden','kw-reason-hidden'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = el.id === 'law-refs-hidden' ? '[]' : '';
    });
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
    navigateTo('my-entries');

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
async function init_my_entries() {
  const session = getSession();
  const isAdminAll = Auth.canViewAll(session);
  const pageSection = document.getElementById('page-my-entries');
  if (pageSection) pageSection.classList.toggle('admin-all-entries', isAdminAll);
  if (isAdminAll && document.getElementById('pageTitle')) {
    document.getElementById('pageTitle').textContent = 'Staff 업무 기록';
  }

  if (!Auth.canWriteEntry(session) && !isAdminAll) {
    if (!Auth.isStaff(session) && !Auth.isManager(session)) {
      navigateTo('dashboard');
      Toast.warning('My Time Sheet는 Staff/Manager만 접근 가능합니다.');
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
  subEl.innerHTML = '<option value="">전체 소분류</option>';
  subcategories.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.sub_category_name;
    opt.dataset.categoryId = s.category_id;
    subEl.appendChild(opt);
  });

  await loadMyEntries();
}

// 대분류 변경 시 소분류 동적 필터
function onEntryFilterCategoryChange() {
  const catId = document.getElementById('filter-entry-category').value;
  const subEl = document.getElementById('filter-entry-subcategory');
  subEl.value = '';
  Array.from(subEl.options).forEach(opt => {
    if (!opt.value) return; // "전체 소분류" 유지
    opt.style.display = (!catId || opt.dataset.categoryId === catId) ? '' : 'none';
  });
  // 숨겨진 옵션이 선택돼 있으면 초기화
  const selected = subEl.options[subEl.selectedIndex];
  if (selected && selected.style.display === 'none') subEl.value = '';
}

/** Staff 업무 기록/엑셀: 최신 500건만 보면 상태·기간 필터가 어긋남 → 페이지 순회·필요 시 user_id/status 서버 필터 */
async function _loadTimeEntriesForMyList(session, isAdminAll, statusVal) {
  if (!isAdminAll && (session.role === 'staff' || session.role === 'manager')) {
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

async function loadMyEntries() {
  const session      = getSession();
  const isAdminAll   = Auth.canViewAll(session);
  const dateFrom     = document.getElementById('filter-entry-date-from').value;  // 'YYYY-MM-DD'
  const dateTo       = document.getElementById('filter-entry-date-to').value;
  const clientId     = (typeof ClientSearchSelect !== 'undefined')
    ? (ClientSearchSelect.getValue('filter-entry-client-wrap')?.id || '')
    : '';
  const categoryId   = document.getElementById('filter-entry-category').value;
  const subcategoryId= document.getElementById('filter-entry-subcategory').value;
  const status       = document.getElementById('filter-entry-status').value;

  // From/To → 밀리초 범위
  const tsFrom = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
  const tsTo   = dateTo   ? new Date(dateTo   + 'T23:59:59').getTime() : null;

  try {
    let entries = await _loadTimeEntriesForMyList(session, isAdminAll, status);

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

    if (clientId)      entries = entries.filter(e => e.client_id === clientId);
    if (categoryId)    entries = entries.filter(e => e.work_category_id === categoryId);
    if (subcategoryId) entries = entries.filter(e => e.work_subcategory_id === subcategoryId);
    if (status)        entries = entries.filter(e => String(e.status) === String(status));

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
    // 회사내부업무 전용 화면에서는 "업무팀" 컬럼을 숨김 처리
    const isCompanyInternalOnly = paged.length > 0 && paged.every(e => String(e.work_category_name || '').trim() === '회사내부업무');
    // col/th 제어 (thead + colgroup)
    try {
      document.querySelectorAll('#my-entries-table .my-entries-col-team').forEach(el => {
        el.style.display = isCompanyInternalOnly ? 'none' : '';
      });
    } catch {}

    const emptyCols = (isAdminAll ? 11 : 10) - (isCompanyInternalOnly ? 1 : 0);
    if (paged.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${emptyCols}" class="table-empty"><i class="fas fa-inbox"></i><p>조회된 데이터가 없습니다.</p></td></tr>`;
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
        const allowMutate = !isAdminAll || isOwnEntry;
        const B = 'width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;background:transparent;border:none;cursor:pointer;transition:background 0.15s;';
        const btns = [];
        btns.push(`<button style="${B}" onclick="openApprovalModal('${e.id}')" title="상세보기"><i class="fas fa-eye" style="font-size:13px;color:#94a3b8"></i></button>`);
        if (canEdit && allowMutate)            btns.push(`<button style="${B}" onclick="editEntry('${e.id}')" title="수정"><i class="fas fa-edit" style="font-size:13px;color:#94a3b8"></i></button>`);
        if (e.status==='draft' && allowMutate) btns.push(`<button style="${B}" onclick="submitSingleEntry('${e.id}')" title="제출"><i class="fas fa-paper-plane" style="font-size:13px;color:var(--primary)"></i></button>`);
        if (canEdit && allowMutate)            btns.push(`<button style="${B}" onclick="deleteEntry('${e.id}')" title="삭제"><i class="fas fa-trash" style="font-size:13px;color:#f87171"></i></button>`);
        if (e.status==='rejected' && e.reviewer_comment)
          btns.push(`<button style="${B}" onclick="showRejectReason('${(e.reviewer_comment||'').replace(/'/g,"\\'")}') " title="반려사유"><i class="fas fa-comment-alt" style="font-size:13px;color:#e07b3a"></i></button>`);

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

        // 소분류 (첨부배지 제거 — 상세보기에서 확인 가능)
        const subHtml = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12.5px"
              title="${Utils.escHtml(e.work_subcategory_name||'')}">
          ${Utils.escHtml(e.work_subcategory_name||'—')}
        </span>`;

        const authorCell = isAdminAll
          ? `<td class="my-entries-col-author" style="font-size:11.5px;padding:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary)" title="${Utils.escHtml(e.user_name || '')}">${Utils.escHtml(e.user_name || '—')}</td>`
          : `<td class="my-entries-col-author" style="display:none"></td>`;

        return `<tr>
          <td class="td-no" style="text-align:center;color:var(--text-muted);font-size:12px;font-variant-numeric:tabular-nums">${rowNo}</td>
          ${authorCell}
          <td class="td-written" style="font-size:12px;white-space:nowrap;color:var(--text-secondary)">${writtenAt}${docNoHtml}</td>
          <td class="td-client" style="padding:0 10px">${clientHtml}</td>
          ${isCompanyInternalOnly ? '' : `<td class="td-team" style="padding:0 10px">${teamHtml}</td>`}
          <td class="td-subcat" style="padding:0 10px">${subHtml}</td>
          <td class="td-start" style="text-align:center;padding:0 6px">${fmtDatetime(e.work_start_at)}</td>
          <td class="td-end" style="text-align:center;padding:0 6px">${fmtDatetime(e.work_end_at)}</td>
          <td class="td-duration" style="text-align:center;color:var(--text-secondary);font-size:12.5px;font-weight:600">${Utils.formatDuration(e.duration_minutes)}</td>
          <td class="td-status" style="text-align:center">${Utils.statusBadge(e.status)}</td>
          <td class="td-action" style="text-align:center;padding:0 4px">
            <div style="display:flex;gap:4px;justify-content:center;align-items:center">${btns.join('')}</div>
          </td>
        </tr>`;
      }).join('');
    }

    document.getElementById('entry-pagination').innerHTML =
      Utils.paginationHTML(_entriesPage, entries.length, ENTRIES_PER_PAGE);

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

    const attR = await API.list('attachments', { limit: 500 });
    const atts = (attR && attR.data) ? attR.data.filter(a => a.entry_id === entryId) : [];

    const iconMap  = { excel:'fa-file-excel', word:'fa-file-word', ppt:'fa-file-powerpoint', pdf:'fa-file-pdf', link:'fa-link' };
    const colorMap = { excel:'#16a34a', word:'#1d4ed8', ppt:'#c2410c', pdf:'#b91c1c', link:'#7c3aed' };

    // ─ 오버레이 생성 ─────────────────────────────
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.style.zIndex = '9999';

    const modal = document.createElement('div');
    modal.className = 'modal modal-md';
    modal.style.cssText = 'max-width:560px;border-radius:14px;overflow:hidden';

    // ─ 헤더 ──────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.style.cssText = 'background:#fafbfc;padding:16px 20px;border-bottom:1px solid var(--border-light)';
    header.innerHTML = `
      <h3 style="font-size:14px;font-weight:700;color:var(--text-primary);display:flex;align-items:center;gap:8px;margin:0">
        <i class="fas fa-file-alt" style="color:var(--primary);font-size:13px"></i>업무기록 상세보기
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

    // 기본 정보 그리드
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
        <div style="font-size:13px;color:var(--text-primary)">${entry.work_subcategory_name || '-'}</div>
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

    // 첨부 결과물
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
function changePage(page) {
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

  // 소분류 전체 옵션 다시 표시
  const subEl = document.getElementById('filter-entry-subcategory');
  Array.from(subEl.options).forEach(opt => { opt.style.display = ''; });

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

    // ② 마스터 데이터 + 폼 초기화 (신규 등록과 동일하게 드롭다운 먼저 로드)
    _editEntryId   = null;   // 잠시 null로 놓고 init_entry_new() 정상 실행
    _editMode      = false;
    _deletedAttIds = [];     // 삭제 예정 첨부 ID 초기화
    await init_entry_new();   // 드롭다운 완전 로드 완료까지 await

    // ③ 수정 모드 플래그 세팅 후 페이지 전환
    //    navigateTo가 init_entry_new()를 재호출하지 않도록 _editMode=true 선행 세팅
    _editEntryId = id;
    _editMode    = true;
    navigateTo('entry-new');   // 이 시점에 init_entry_new()가 재호출되지만 즉시 return

    // ④ 대분류 세팅 → 소분류 목록 갱신 (onCategoryChange 동기 실행)
    const catEl = document.getElementById('entry-category');
    catEl.value = entry.work_category_id || '';
    onCategoryChange();   // 소분류 드롭다운을 entry의 category 기준으로 재구성

    // ⑤ 소분류 세팅 (onCategoryChange 직후 바로 가능 — setTimeout 불필요)
    const subEl = document.getElementById('entry-subcategory');
    subEl.value = entry.work_subcategory_id || '';

    // ⑥ 팀 세팅
    const teamEl = document.getElementById('entry-team');
    for (const opt of teamEl.options) {
      if (opt.value === entry.team_id) { opt.selected = true; break; }
    }

    // ⑦ 고객사 세팅 (ClientSearchSelect)
    ClientSearchSelect.setValue('entry-client-wrap', entry.client_id || '', entry.client_name || '');
    document.getElementById('entry-client').value = entry.client_id || '';

    // ⑧ 업무 시작/종료 일시 세팅
    if (entry.work_start_at) {
      const startDate = new Date(Number(entry.work_start_at));
      // toISOString은 UTC 기준이므로 로컬 시간으로 변환
      const localStart = new Date(startDate.getTime() - startDate.getTimezoneOffset() * 60000)
        .toISOString().slice(0, 16);
      document.getElementById('entry-start').value = localStart;
    }
    if (entry.work_end_at) {
      const endDate = new Date(Number(entry.work_end_at));
      const localEnd = new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60000)
        .toISOString().slice(0, 16);
      document.getElementById('entry-end').value = localEnd;
    }

    // ⑨ 소요시간: 자동 계산 후 → 기존 저장된 실제 소요시간으로 강제 복원
    calcDuration();
    if (entry.duration_minutes && Number(entry.duration_minutes) > 0) {
      // 저장된 실제 소요시간이 있으면 그 값으로 입력란을 덮어씀
      _setDurationInput(Number(entry.duration_minutes));
    }

    // ⑩ 수행내용 세팅 — 고객(자문)은 Quill, 내부/통관/프로젝트 등은 메모란(entry-memo)
    const catTypeForDesc = catEl.options[catEl.selectedIndex]?.dataset?.type || 'client';
    const rawDesc = entry.work_description || '';
    const memoEl = document.getElementById('entry-memo');
    const hidHtml = document.getElementById('entry-description');
    const hidMd = document.getElementById('entry-description-md');

    if (catTypeForDesc === 'client') {
      const descHtml = _entryCleanDescHtmlForEdit(rawDesc);
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
      _syncQuillToHidden();
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

    // ⑪ 고객 섹션 표시 상태 갱신
    updateClientSection();

    // ⑫ 기존 첨부파일 목록 표시 (읽기 전용 — 수정 시 새 파일 추가만 가능)
    try {
      const attResp = await API.list('attachments', { limit: 50 });
      const existingAtts = (attResp?.data || []).filter(a => a.entry_id === id);
      if (existingAtts.length > 0) {
        _renderExistingAttachments(existingAtts);
      }
    } catch { /* 첨부파일 로드 실패 무시 */ }

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
    await API.patch('time_entries', id, { status: 'submitted' });
    Toast.success('제출되었습니다.');

    // ── 알림 생성 ─────────────────────────────
    if (typeof createNotification === 'function') {
      try {
        const session = getSession();
        const entry   = await API.get('time_entries', id);
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
    const statusVal = (document.getElementById('filter-entry-status') || {}).value || '';
    let entries = await _loadTimeEntriesForMyList(session, isAdminAll, statusVal);
    console.log('[Excel] step1 result count:', entries.length);

    // staff·manager는 로더에서 이미 user_id 범위. 그 외 비-admin은 방어적 필터
    if (!isAdminAll && session.role !== 'staff' && session.role !== 'manager') {
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
    if (clientId)      entries = entries.filter(e => e.client_id === clientId);
    if (categoryId)    entries = entries.filter(e => e.work_category_id === categoryId);
    if (subcategoryId) entries = entries.filter(e => e.work_subcategory_id === subcategoryId);
    if (statusVal)     entries = entries.filter(e => String(e.status) === String(statusVal));

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
      return {
        'No':        i + 1,
        '작성일자':  toDateOnly(e.created_at || e.work_start_at),
        'Staff':     e.user_name  || '',
        '업무팀':    e.team_name  || '',
        '고객사':    e.client_name || '내부업무',
        '대분류':    e.work_category_name    || '',
        '소분류':    e.work_subcategory_name || '',
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
