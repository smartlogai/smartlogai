/**
 * archive.js – 자문 자료실 모듈 (v20260401f 전면재구성)
 * 기능: 자료 목록/검색, 파일 업로드 + 텍스트 자동 추출, 직접 등록, 일괄 업로드, 자료 상세 조회
 */

// ─────────────────────────────────────────────
//  내부 상태
// ─────────────────────────────────────────────
let _archivePage = 1;
const _archiveLimit = 20;
let _archiveTotal = 0;
let _archiveNewPendingFiles = [];   // 직접등록 모달 파일 목록
let _bulkPendingFiles = [];         // 일괄업로드 파일 목록
let _bulkExcelRows = [];            // 엑셀 업로드 미리보기 행

// ─── 신규 태그 검색 상태 ───
let _archKwTags    = [];   // 핵심키워드 검색 태그
let _archReasonTags = [];  // 판단사유 검색 태그
let _archLawTags   = [];   // 관련법령 검색 태그 [{name, article}]

// ─────────────────────────────────────────────
//  업무분류별 예시 태그
// ─────────────────────────────────────────────
const _ARCH_EXAMPLE_KW = {
  '': ['거래가격', '품목분류', '수출허가', 'FTA', '환급신청', '요건확인'],
  '품목분류': ['HS코드 분류', '품목번호', '유권해석', '재질성분', '기능용도', '결합물품', '세트물품', 'GRI원칙'],
  '과세가격': ['권리사용료 가산여부', '특수관계 거래가격 인정여부', '경영지원비 가산여부', '로열티 가산여부', '수수료 공제여부'],
  '원산지판정': ['원산지기준', '실질변형', '부가가치기준', '세번변경', '불인정공정', '직접운송', '원산지확인서'],
  '전략물자': ['전략물자 해당여부', '상황허가 대상여부', '이중용도품목 수출통제', '캐치올 규정 적용여부'],
  'FTA': ['원산지증명서 유효여부', '사후검증 대응방안', '누적조항 적용여부', '직접운송원칙 충족여부', '원산지소급적용 가능여부', 'CTH기준 충족여부'],
  '관세환급': ['개별환급 적용가능 여부', '소요량 산정기준', '환급기한 기산점', '분할증명 가능여부', '간이정액환급 적용여부'],
  '요건대상': ['의료기기 요건대상 여부', '식품 검역대상 여부', '화학물질 등록대상 여부', '안전인증 면제여부', '전파인증 대상여부'],
};
const _ARCH_EXAMPLE_REASON = {
  '': ['거래조건성불충족', '세번변경기준충족', '원산지기준충족', '수출허가대상해당'],
  '품목분류': ['용도기준적용', '재질기준적용', '결합기준적용', '완성품분류원칙', 'GRI적용', '관세율표해석통칙'],
  '과세가격': ['거래조건성불충족', '처분제한조건', '권리사용료포함', '특수관계영향', '공제방법선택', '역산가격적용'],
  '원산지판정': ['세번변경기준충족', '부가가치기준미충족', '불인정공정해당', '직접운송불충족', '원산지기준충족'],
  '전략물자': ['수출허가대상해당', '허가예외적용', '이중용도해당', 'EAR적용', '전략물자해당없음'],
  'FTA': ['원산지기준충족', '원산지증명서유효', '검증결과불인정', '누적기준적용', '환급제한적용', '사후검증대상'],
  '관세환급': ['소요량기준충족', '환급대상해당', '직접환급가능', '간이환급적용', '분할환급적용'],
  '요건대상': ['요건확인필요', '허가취득필요', '검역증명필요', '안전인증미취득', '면제해당'],
};

// ─────────────────────────────────────────────
//  페이지 초기화
// ─────────────────────────────────────────────
async function init_archive() {
  const session = Session.get();
  if (!session) { navigateTo('dashboard'); return; }

  _archKwTags = []; _archReasonTags = []; _archLawTags = [];
  _archRenderTagUi();
  _archUpdateExampleTags();

  await loadArchiveList();

  if (window._archiveNeedsRefresh) {
    window._archiveNeedsRefresh = false;
    await loadArchiveList();
  }
}

// ─────────────────────────────────────────────
//  태그 UI 유틸리티
// ─────────────────────────────────────────────
function _archAddTag(type, val) {
  const v = (val || '').trim();
  if (!v) return;
  if (type === 'kw')     { if (!_archKwTags.includes(v))     _archKwTags.push(v); }
  if (type === 'reason') { if (!_archReasonTags.includes(v)) _archReasonTags.push(v); }
  _archRenderTagUi();
}

function _archAddLaw() {
  const name    = (document.getElementById('arch-law-name')?.value || '').trim();
  const article = (document.getElementById('arch-law-article')?.value || '').trim();
  if (!name) { return; }
  if (!_archLawTags.find(t => t.name === name && t.article === article)) {
    _archLawTags.push({ name, article });
  }
  if (document.getElementById('arch-law-article')) document.getElementById('arch-law-article').value = '';
  _archRenderTagUi();
}

function _archRemoveTag(type, idx) {
  if (type === 'kw')     _archKwTags.splice(idx, 1);
  if (type === 'reason') _archReasonTags.splice(idx, 1);
  if (type === 'law')    _archLawTags.splice(idx, 1);
  _archRenderTagUi();
}

function _archRenderTagUi() {
  const kwCont     = document.getElementById('arch-kw-tags');
  const reasonCont = document.getElementById('arch-reason-tags');
  const lawCont    = document.getElementById('arch-law-tags');

  if (kwCont) kwCont.innerHTML = _archKwTags.map((t, i) =>
    `<span class="arch-sel-tag" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:12px;padding:4px 8px 4px 10px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;white-space:nowrap">${Utils.escHtml(t)}<button onclick="_archRemoveTag('kw',${i})" class="arch-sel-tag-rm" title="제거" style="background:none;border:none;cursor:pointer;color:#1d4ed8;opacity:.7;font-size:13px;line-height:1;padding:0 2px;display:inline-flex;align-items:center" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.7">×</button></span>`
  ).join('');

  if (reasonCont) reasonCont.innerHTML = _archReasonTags.map((t, i) =>
    `<span class="arch-sel-tag arch-sel-tag--green" style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:12px;padding:4px 8px 4px 10px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;white-space:nowrap">${Utils.escHtml(t)}<button onclick="_archRemoveTag('reason',${i})" class="arch-sel-tag-rm" title="제거" style="background:none;border:none;cursor:pointer;color:#15803d;opacity:.7;font-size:13px;line-height:1;padding:0 2px;display:inline-flex;align-items:center" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.7">×</button></span>`
  ).join('');

  if (lawCont) lawCont.innerHTML = _archLawTags.map((t, i) => {
    const label = t.name + (t.article ? ' ' + t.article : '');
    return `<span class="arch-sel-tag arch-sel-tag--amber" style="background:#fffbeb;color:#92400e;border:1px solid #fde68a;border-radius:12px;padding:4px 8px 4px 10px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;white-space:nowrap"><i class="fas fa-gavel" style="font-size:9px;margin-right:2px;opacity:.8"></i>${Utils.escHtml(label)}<button onclick="_archRemoveTag('law',${i})" class="arch-sel-tag-rm" title="제거" style="background:none;border:none;cursor:pointer;color:#92400e;opacity:.7;font-size:13px;line-height:1;padding:0 2px;display:inline-flex;align-items:center" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.7">×</button></span>`;
  }).join('');
}

function _archUpdateExampleTags() {
  const biz = document.getElementById('archive-filter-business')?.value || '';
  const kwEx     = _ARCH_EXAMPLE_KW[biz]     ?? _ARCH_EXAMPLE_KW['']     ?? [];
  const reasonEx = _ARCH_EXAMPLE_REASON[biz] ?? _ARCH_EXAMPLE_REASON[''] ?? [];
  const kwCont     = document.getElementById('arch-kw-examples');
  const reasonCont = document.getElementById('arch-reason-examples');
  const kwArea     = document.getElementById('arch-kw-example-area');

  if (kwCont) {
    kwCont.innerHTML = kwEx.map(t => {
      const escaped  = Utils.escHtml(t);
      const safeCall = t.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const isUsed   = _archKwTags.includes(t) ? ' arch-ex-tag--used' : '';
      return `<button class="arch-ex-tag${isUsed}" onclick="_archClickExTag('kw','${safeCall}',this)">${escaped}</button>`;
    }).join('');
  }

  if (reasonCont) {
    reasonCont.innerHTML = reasonEx.map(t => {
      const escaped  = Utils.escHtml(t);
      const safeCall = t.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const isUsed   = _archReasonTags.includes(t) ? ' arch-ex-tag--green arch-ex-tag--used' : ' arch-ex-tag--green';
      return `<button class="arch-ex-tag${isUsed}" onclick="_archClickExTag('reason','${safeCall}',this)">${escaped}</button>`;
    }).join('');
  }

  const kwInput     = document.getElementById('arch-kw-input');
  const reasonInput = document.getElementById('arch-reason-input');
  if (kwInput) {
    const kwFirst = kwEx[0] || '키워드';
    kwInput.placeholder = `예) ${kwFirst} · Enter 또는 쉼표로 태그 추가`;
  }
  if (reasonInput) {
    const reasonFirst = reasonEx[0] || '판단사유';
    reasonInput.placeholder = `예) ${reasonFirst} · Enter 또는 쉼표로 태그 추가`;
  }

  if (kwArea) kwArea.style.display = kwEx.length ? 'flex' : 'none';
}

function _archClickExTag(type, val, btn) {
  _archAddTag(type, val);
  if (btn) {
    btn.classList.add('arch-ex-tag--used');
    if (type === 'reason') btn.classList.add('arch-ex-tag--green');
  }
}

// ─────────────────────────────────────────────
//  호환성 유지용 필터 select 채우기
// ─────────────────────────────────────────────
async function _fillArchiveClientFilter() { /* 신규 UI에서 미사용 (호환 유지) */ }
async function _fillArchiveCategoryFilter() { /* 신규 UI에서 미사용 (호환 유지) */ }

// ─────────────────────────────────────────────
//  업무분류 색상 설정
// ─────────────────────────────────────────────
const _BIZ_BADGE = {
  '품목분류': { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  '과세가격': { bg: '#fdf4ff', color: '#7e22ce', border: '#e9d5ff' },
  '원산지판정': { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  '전략물자': { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  '요건대상': { bg: '#fefce8', color: '#a16207', border: '#fef08a' },
  'FTA':      { bg: '#f0f9ff', color: '#0369a1', border: '#bae6fd' },
  '관세환급': { bg: '#fdf2f8', color: '#be185d', border: '#fbcfe8' },
};
function _archBizBadge(bizName) {
  const c = _BIZ_BADGE[bizName];
  if (!c) return `<span class="arch-biz-badge" style="background:#f3f4f6;color:#4b5563;border:1px solid #d1d5db">${Utils.escHtml(bizName||'기타')}</span>`;
  return `<span class="arch-biz-badge" style="background:${c.bg};color:${c.color};border:1px solid ${c.border}">${Utils.escHtml(bizName)}</span>`;
}

// ─────────────────────────────────────────────
//  메인 검색 함수
// ─────────────────────────────────────────────
async function archSearch() {
  await loadArchiveList();
}

// ─────────────────────────────────────────────
//  자료 목록 로드
// ─────────────────────────────────────────────
async function loadArchiveList() {
  const keyword      = (document.getElementById('archive-search-input')?.value || '').trim().toLowerCase();
  const bizFilter    = document.getElementById('archive-filter-business')?.value || '';
  const starsFilter  = document.getElementById('archive-filter-stars')?.value    || '';
  const dateFrom     = document.getElementById('archive-filter-date-from')?.value || '';
  const dateTo       = document.getElementById('archive-filter-date-to')?.value   || '';
  const sortMode     = document.getElementById('archive-sort-select')?.value || 'newest';

  const kwTags     = [..._archKwTags];
  const reasonTags = [..._archReasonTags];
  const lawTags    = [..._archLawTags];

  const tsFrom = dateFrom ? new Date(dateFrom).getTime()              : null;
  const tsTo   = dateTo   ? new Date(dateTo + 'T23:59:59').getTime()  : null;

  try {
    const [refResp, entryResp] = await Promise.all([
      API.list('mail_references', { limit: 500 }),
      API.list('time_entries',    { limit: 500 })
    ]);

    const entryMap = {};
    (entryResp.data || []).forEach(e => { entryMap[e.id] = e; });

    let rows = (refResp.data || []).filter(r => {
      if (r.status === 'hidden') return false;
      if (r.source_type === 'approval' && r.entry_id) {
        const ent = entryMap[r.entry_id];
        if (!ent || !ent.is_archived) return false;
      }
      return true;
    });

    rows = rows.map(r => {
      const ent = r.entry_id ? entryMap[r.entry_id] : null;
      return { ...r, _entry: ent };
    });

    if (bizFilter) {
      rows = rows.filter(r => {
        const wsc = r._entry?.work_subcategory_name || r.work_subcategory || '';
        return wsc === bizFilter || (r._entry?.work_subcategory_name || '').includes(bizFilter);
      });
    }

    if (starsFilter) {
      rows = rows.filter(r => {
        const stars = r._entry?.quality_stars ?? r.quality_stars;
        return String(stars) === starsFilter;
      });
    }

    if (tsFrom || tsTo) {
      rows = rows.filter(r => {
        const raw = r.sent_at || r.created_at;
        if (!raw) return false;
        const num = Number(raw);
        const ts = !isNaN(num) && num > 1000000000 ? num : new Date(raw).getTime();
        if (isNaN(ts)) return false;
        if (tsFrom && ts < tsFrom) return false;
        if (tsTo   && ts > tsTo)   return false;
        return true;
      });
    }

    if (kwTags.length) {
      rows = rows.filter(r => {
        const entKw = _parseArr(r._entry?.kw_query ?? r.kw_query);
        const refKw = _parseArr(r.keywords);
        const all = [...entKw, ...refKw].map(k => k.toLowerCase());
        return kwTags.every(tag => all.some(k => k.includes(tag.toLowerCase())));
      });
    }

    if (reasonTags.length) {
      rows = rows.filter(r => {
        const entReason = _parseArr(r._entry?.kw_reason ?? r.kw_reason);
        const all = entReason.map(k => k.toLowerCase());
        return reasonTags.every(tag => all.some(k => k.includes(tag.toLowerCase())));
      });
    }

    if (lawTags.length) {
      rows = rows.filter(r => {
        const entLaw = _parseArr(r._entry?.law_refs ?? r.law_refs);
        const lawStr = entLaw.map(l => {
          if (typeof l === 'object') return ((l.name||'') + ' ' + (l.article||'')).toLowerCase();
          return String(l).toLowerCase();
        });
        return lawTags.every(lt => {
          const target = (lt.name + (lt.article ? ' ' + lt.article : '')).toLowerCase();
          return lawStr.some(ls => ls.includes(lt.name.toLowerCase()) &&
            (!lt.article || ls.includes(lt.article.toLowerCase())));
        });
      });
    }

    if (keyword) {
      const kwds = keyword.split(/\s+/).filter(Boolean);
      rows = rows.filter(r => {
        const ent = r._entry;
        const haystack = [
          ent?.work_description || r.work_description || '',
          _parseArr(ent?.kw_query  ?? r.kw_query).join(' '),
          _parseArr(ent?.kw_reason ?? r.kw_reason).join(' '),
          _parseArr(ent?.law_refs  ?? r.law_refs).map(l => typeof l==='object' ? (l.name||'')+(l.article||'') : String(l)).join(' '),
          r.summary || '',
          r.tags || '',
          r.keywords || '',
          r.subject || '',
          r.work_subcategory || '',
          ent?.work_subcategory_name || ''
        ].join(' ').toLowerCase();
        return kwds.every(kw => haystack.includes(kw));
      });
    }

    _updateActiveFilterBadge(keyword, bizFilter, starsFilter, dateFrom, dateTo, kwTags, reasonTags, lawTags);

    const _toTs = (val) => {
      if (!val) return 0;
      const n = Number(val);
      return (!isNaN(n) && n > 1000000000) ? n : (new Date(val).getTime() || 0);
    };
    if (sortMode === 'oldest') {
      rows.sort((a,b) => _toTs(a.sent_at||a.created_at) - _toTs(b.sent_at||b.created_at));
    } else if (sortMode === 'stars') {
      rows.sort((a,b) => {
        const sa = b._entry?.quality_stars ?? b.quality_stars ?? 0;
        const sb = a._entry?.quality_stars ?? a.quality_stars ?? 0;
        return sa - sb;
      });
    } else {
      rows.sort((a,b) => _toTs(b.sent_at||b.created_at) - _toTs(a.sent_at||a.created_at));
    }

    _archiveTotal = rows.length;
    _archivePage = Math.min(_archivePage, Math.ceil(rows.length / _archiveLimit) || 1);
    const paged = rows.slice((_archivePage-1)*_archiveLimit, _archivePage*_archiveLimit);

    _renderArchiveKpi(rows);

    const badge = document.getElementById('archive-count-badge');
    if (badge) badge.textContent = `총 ${rows.length}건`;

    const listBody = document.getElementById('archive-list-body');
    if (!listBody) return;
    if (!paged.length) {
      listBody.innerHTML = `
        <div class="arch-empty-state">
          <i class="fas fa-archive"></i>
          <p>조건에 맞는 자료가 없습니다.</p>
        </div>`;
    } else {
      listBody.innerHTML = paged.map(r => _buildArchCard(r, keyword, _archKwTags)).join('');
    }

    const pg = document.getElementById('archive-pagination');
    if (pg) pg.innerHTML = Utils.paginationHTML(_archivePage, Math.ceil(_archiveTotal/_archiveLimit), 'changeArchivePage');

  } catch(e) {
    console.error('loadArchiveList error', e);
    Toast.error('자료 목록을 불러오는 중 오류가 발생했습니다.');
  }
}

function _parseArr(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    const v = val.trim();
    if (v.startsWith('[')) {
      try { return JSON.parse(v); } catch(e) {}
    }
    return v.split(',').map(s=>s.trim()).filter(Boolean);
  }
  return [];
}

// ─────────────────────────────────────────────
//  카드 HTML 빌더
// ─────────────────────────────────────────────
function _buildArchCard(r, keyword, kwTags) {
  const ent = r._entry;
  const bizName = ent?.work_subcategory_name || r.work_subcategory || '';

  const stars = parseInt(ent?.quality_stars ?? r.quality_stars) || 0;
  const starLabels = { 1: 'C 참고', 2: 'B 우수', 3: 'A 매우우수' };
  const starColors = { 1: '#6b7280', 2: '#2563eb', 3: '#d97706' };
  const starBadge = stars > 0
    ? `<span class="arch-star-badge" style="color:${starColors[stars]};border-color:${starColors[stars]}40;background:${starColors[stars]}12;margin-left:auto;flex-shrink:0;">
         ${'★'.repeat(stars)}${'☆'.repeat(3-stars)} ${starLabels[stars]||''}
       </span>` : '';

  const titleRaw = (bizName
    ? (bizName.includes('자문') ? bizName : bizName + ' 자문')
    : (r.subject ? r.subject.replace(/\s*\([^)]*\)\s*$/, '').trim() : '(제목 없음)'));
  const titleDisp = Utils.escHtml(titleRaw.length > 60 ? titleRaw.substring(0,60)+'…' : titleRaw);

  const kwArr = _parseArr(ent?.kw_query ?? r.kw_query);
  const searchKws = kwTags || [];
  const kwDisplay = searchKws.length > 0
    ? kwArr.filter(k => searchKws.some(s => k.toLowerCase().includes(s.toLowerCase()))).slice(0,5)
    : kwArr.slice(0,5);
  const kwHtml = kwDisplay.length
    ? kwDisplay.map(k => `<span class="arch-card-kw-tag">${Utils.escHtml(k)}</span>`).join('')
      + (kwArr.length > kwDisplay.length ? `<span class="arch-card-kw-more">+${kwArr.length - kwDisplay.length}</span>` : '')
    : '';

  const reasonArr = _parseArr(ent?.kw_reason ?? r.kw_reason);
  const searchReasons = _archReasonTags || [];
  const reasonDisplay = searchReasons.length > 0
    ? reasonArr.filter(k => searchReasons.some(s => k.toLowerCase().includes(s.toLowerCase()))).slice(0,3)
    : [];
  const reasonHtml = reasonDisplay.length
    ? reasonDisplay.map(k => `<span class="arch-card-reason-tag">${Utils.escHtml(k)}</span>`).join('')
    : '';

  const lawRawArr = _parseArr(ent?.law_refs ?? r.law_refs);
  const lawDisplay = lawRawArr.slice(0, 3).map(l => {
    if (typeof l === 'object') {
      const name    = l.name || l.law || '';
      const article = l.article || '';
      return article ? `${name} ${article}`.trim() : name;
    }
    return String(l);
  }).filter(Boolean);
  const lawHtml = lawDisplay.length
    ? lawDisplay.map(l => `<span class="arch-card-kw-tag" style="background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe">
        <i class="fas fa-gavel" style="font-size:9px;margin-right:2px;opacity:.75"></i>${Utils.escHtml(l)}</span>`).join('')
    : '';

  const _rawBody = (ent?.work_description || r.work_description || r.summary || r.body_text || '');
  const bodyRaw = _rawBody
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<xml[\s\S]*?<\/xml>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/Normal\s+\d+\s+\d+\s+\d+\s+(false|true)\s+(false|true)\s+(false|true)[^\n]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  let previewHtml = '';
  if (bodyRaw) {
    let snippet = '';
    const kw = (keyword || '').trim().toLowerCase();
    if (kw) {
      const idx = bodyRaw.toLowerCase().indexOf(kw);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end   = Math.min(bodyRaw.length, idx + kw.length + 60);
        const raw   = (start > 0 ? '…' : '') + bodyRaw.slice(start, end) + (end < bodyRaw.length ? '…' : '');
        snippet = Utils.escHtml(raw).replace(
          new RegExp(Utils.escHtml(kw).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi'),
          m => `<mark style="background:#fef08a;border-radius:2px;padding:0 2px;">${m}</mark>`
        );
      } else {
        snippet = Utils.escHtml(bodyRaw.slice(0, 80)) + (bodyRaw.length > 80 ? '…' : '');
      }
    } else {
      snippet = Utils.escHtml(bodyRaw.slice(0, 50)) + (bodyRaw.length > 50 ? '…' : '');
    }
    previewHtml = `<div class="arch-card-preview">${snippet}</div>`;
  }

  const dateStr     = Utils.formatDate(r.sent_at || r.created_at || Date.now());
  const isManual    = r.source_type === 'manual';
  const authorName  = ent?.user_name || r.sender_name || r.registered_by_name || '-';
  const footerRight = isManual
    ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;
                    color:#7c3aed;background:#f5f3ff;border:1px solid #ddd6fe;
                    border-radius:10px;padding:2px 9px">
         <i class="fas fa-folder-open" style="font-size:10px"></i> 과거 참고사례
       </span>`
    : `<span class="arch-meta-chip"><i class="fas fa-user"></i> ${Utils.escHtml(authorName)}</span>`;

  return `
  <div class="arch-card" id="arch-card-${r.id}">
    <div class="arch-card-header">
      <a href="javascript:void(0)" onclick="openArchiveDetail('${r.id}')" class="arch-card-title">${titleDisp}</a>
      ${starBadge}
    </div>
    ${(kwHtml || lawHtml) ? `<div class="arch-card-kw-row">
      <span class="arch-card-section-label"><i class="fas fa-tags"></i></span>
      <div class="arch-card-kw-tags" style="flex-wrap:wrap;gap:4px">
        ${kwHtml}${lawHtml}
      </div>
    </div>` : ''}
    ${reasonHtml ? `<div class="arch-card-reason-row">
      <span class="arch-card-section-label"><i class="fas fa-balance-scale"></i></span>
      <div class="arch-card-reason-tags">${reasonHtml}</div>
    </div>` : ''}
    ${previewHtml}
    <div class="arch-card-footer">
      <span class="arch-meta-chip"><i class="fas fa-calendar-alt"></i> ${dateStr}</span>
      ${footerRight}
      <div class="arch-card-actions">
        <button class="arch-card-btn arch-card-btn--view" onclick="openArchiveDetail('${r.id}')">
          <i class="fas fa-eye"></i> 내용보기
        </button>
      </div>
    </div>
  </div>`;
}
// ─────────────────────────────────────────────
//  자문내용 전체보기 팝업 (인라인 카드 확장)
// ─────────────────────────────────────────────
async function showArchiveContentModal(refId) {
  document.querySelectorAll('.arch-inline-panel').forEach(p => {
    if (p.dataset.refId !== String(refId)) {
      p.remove();
      const prevCard = document.getElementById(`arch-card-${p.dataset.refId}`);
      if (prevCard) {
        prevCard.classList.remove('arch-card-expanded');
        const prevArrow = prevCard.querySelector('.arch-kw-arrow');
        if (prevArrow) { prevArrow.style.transform = ''; prevArrow.style.color = ''; }
      }
    }
  });

  const card = document.getElementById(`arch-card-${refId}`);
  if (!card) {
    openArchiveDetail(refId);
    return;
  }

  const existing = document.getElementById(`arch-inline-${refId}`);
  if (existing) {
    existing.remove();
    card.classList.remove('arch-card-expanded');
    const arrow = card.querySelector('.arch-kw-arrow');
    if (arrow) { arrow.style.transform = ''; arrow.style.color = ''; }
    return;
  }

  const arrow = card.querySelector('.arch-kw-arrow');
  if (arrow) { arrow.style.transform = 'rotate(90deg)'; arrow.style.color = '#6366f1'; }

  const panel = document.createElement('div');
  panel.id = `arch-inline-${refId}`;
  panel.className = 'arch-inline-panel';
  panel.dataset.refId = String(refId);
  panel.innerHTML = `<div class="arch-inline-loading"><i class="fas fa-spinner fa-spin"></i> 불러오는 중...</div>`;
  card.classList.add('arch-card-expanded');
  card.appendChild(panel);
  setTimeout(() => { panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 200);

  try {
    const ref = await API.get('mail_references', refId);
    if (!ref) {
      panel.innerHTML = `<div class="arch-inline-empty"><i class="fas fa-exclamation-circle"></i> 자료를 불러올 수 없습니다.</div>`;
      return;
    }

    const fullText   = (ref.summary || ref.body_text || '').trim();
    const clientName = ref.client_name || '-';
    const category   = [ref.work_category, ref.work_subcategory].filter(Boolean).join(' › ') || '-';
    const _dateSrc   = ref.sent_at || ref.created_at || Date.now();
    const dateStr    = Utils.formatDate(_dateSrc);
    const personName = ref.sender_name || ref.registered_by_name || '-';
    const approver   = ref.archived_by_name || '';

    const copyBtn = fullText
      ? `<button class="arch-inline-copy-btn" onclick="archCopyInlineText('arch-inline-text-${refId}', this)" title="본문 복사">
           <i class="fas fa-copy"></i> 복사
         </button>`
      : '';

    panel.innerHTML = `
      <div class="arch-inline-meta">
        <span class="arch-cm-meta-chip"><i class="fas fa-building"></i> ${Utils.escHtml(clientName)}</span>
        <span class="arch-cm-meta-chip"><i class="fas fa-layer-group"></i> ${Utils.escHtml(category)}</span>
        <span class="arch-cm-meta-chip"><i class="fas fa-calendar-alt"></i> ${dateStr}</span>
        <span class="arch-cm-meta-chip"><i class="fas fa-user"></i> ${Utils.escHtml(personName)}</span>
        ${approver && approver !== personName
          ? `<span class="arch-cm-meta-chip" style="color:#10b981"><i class="fas fa-check-circle"></i> ${Utils.escHtml(approver)}</span>`
          : ''}
        <div class="arch-inline-actions">
          ${copyBtn}
          <button class="arch-inline-detail-btn" onclick="showArchiveContentModal('${refId}')">
            <i class="fas fa-times"></i> 닫기
          </button>
        </div>
      </div>
      ${fullText
        ? `<div id="arch-inline-text-${refId}" class="arch-inline-text" style="user-select:text;-webkit-user-select:text">${Utils.escHtml(fullText)}</div>`
        : `<div class="arch-inline-empty"><i class="fas fa-comment-slash"></i> 등록된 내용이 없습니다.</div>`
      }
    `;
  } catch(e) {
    console.error('showArchiveContentModal error', e);
    panel.innerHTML = `<div class="arch-inline-empty"><i class="fas fa-exclamation-circle"></i> 내용을 불러오는 중 오류가 발생했습니다.</div>`;
  }
}

function archCopyInlineText(elemId, btnEl) {
  const el = document.getElementById(elemId);
  if (!el) { Toast.warning('복사할 내용이 없습니다.'); return; }
  const text = el.innerText || el.textContent || '';
  if (!text.trim()) { Toast.warning('복사할 내용이 없습니다.'); return; }
  navigator.clipboard.writeText(text.trim()).then(() => {
    const orig = btnEl ? btnEl.innerHTML : '';
    if (btnEl) {
      btnEl.innerHTML = '<i class="fas fa-check" style="color:#16a34a"></i> 복사됨';
      setTimeout(() => { btnEl.innerHTML = orig; }, 1500);
    }
    Toast.success('클립보드에 복사되었습니다.');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text.trim();
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    Toast.success('클립보드에 복사되었습니다.');
  });
}

function showConsultPopup(el) {
  const refId = el.getAttribute('data-ref') || '';
  if (refId) showArchiveContentModal(refId);
}

// ─────────────────────────────────────────────
//  클립보드 복사 유틸
// ─────────────────────────────────────────────
function copyToClipboard(text, btnEl) {
  if (!text) { Toast.warning('복사할 내용이 없습니다.'); return; }
  navigator.clipboard.writeText(text).then(() => {
    const orig = btnEl ? btnEl.innerHTML : '';
    if (btnEl) {
      btnEl.innerHTML = '<i class="fas fa-check" style="color:#16a34a"></i> 복사됨';
      setTimeout(() => { btnEl.innerHTML = orig; }, 1500);
    }
    Toast.success('클립보드에 복사되었습니다.');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    Toast.success('클립보드에 복사되었습니다.');
  });
}

// ─────────────────────────────────────────────
//  필터 초기화
// ─────────────────────────────────────────────
function resetArchiveFilter() {
  ['archive-search-input','archive-filter-business','archive-filter-stars',
   'archive-filter-date-from','archive-filter-date-to','arch-law-name','arch-law-article',
   'arch-kw-input','arch-reason-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  _archKwTags = []; _archReasonTags = []; _archLawTags = [];
  _archRenderTagUi();
  _archUpdateExampleTags();
  const fb = document.getElementById('archive-active-filter-bar');
  if (fb) { fb.style.display = 'none'; fb.innerHTML = ''; }
  _archivePage = 1;
  loadArchiveList();
}

function _updateActiveFilterBadge(keyword, biz, stars, dateFrom, dateTo, kwTags, reasonTags, lawTags) {
  const bar = document.getElementById('archive-active-filter-bar');
  if (!bar) return;
  const chips = [];
  if (keyword)   chips.push(`🔍 "${keyword}"`);
  if (biz)       chips.push(`📂 ${biz}`);
  if (stars)     chips.push(`⭐ ${'★'.repeat(parseInt(stars))}${'☆'.repeat(3-parseInt(stars))}`);
  if (dateFrom)  chips.push(`📅 ${dateFrom}~`);
  if (dateTo)    chips.push(`~${dateTo}`);
  kwTags.forEach(t     => chips.push(`🏷 ${t}`));
  reasonTags.forEach(t => chips.push(`⚖️ ${t}`));
  lawTags.forEach(t    => chips.push(`📜 ${t.name}${t.article?' '+t.article:''}`));

  if (chips.length) {
    bar.style.display = 'flex';
    bar.innerHTML = chips.map(c =>
      `<span style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:2px 10px;font-size:12px;color:#1e40af">${Utils.escHtml(c)}</span>`
    ).join('')
    + `<button onclick="resetArchiveFilter()" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--danger);margin-left:4px">✕ 초기화</button>`;
  } else {
    bar.style.display = 'none';
    bar.innerHTML = '';
  }
}

function changeArchivePage(p) {
  _archivePage = p;
  loadArchiveList();
}

// ─────────────────────────────────────────────
//  KPI 렌더링
// ─────────────────────────────────────────────
function _renderArchiveKpi(rows) {
  const grid = document.getElementById('archive-kpi-grid');
  if (!grid) return;
  const total = rows.length;
  const templates = rows.filter(r => r.is_template).length;
  const approvalSrc = rows.filter(r => r.source_type === 'approval').length;
  const views = rows.reduce((s,r) => s + (r.view_count||0), 0);

  grid.innerHTML =
    kpiCard('fa-archive',      '', '', '총 자료 수',    total,       '건', '전체 등록 자료',  '', '#1a2b45') +
    kpiCard('fa-star',         '', '', '템플릿 추천',   templates,   '건', '재활용 가능',     '', '#2d6bb5') +
    kpiCard('fa-check-double', '', '', '승인 아카이브', approvalSrc, '건', '승인 완료 연동',  '', '#4a7fc4') +
    kpiCard('fa-eye',          '', '', '누적 조회수',   views,       '회', '전체 뷰 합산',    '', '#6b95ce');
}

// ─────────────────────────────────────────────
//  자료 상세 보기
// ─────────────────────────────────────────────
async function openArchiveDetail(refId) {
  try {
    const [ref, docsResp, entryResp] = await Promise.all([
      API.get('mail_references', refId),
      API.list('doc_texts',    { limit: 200 }),
      API.list('time_entries', { limit: 500 })
    ]);

    if (!ref || !ref.id) {
      Toast.error('자료를 찾을 수 없습니다. (삭제되었거나 권한 없음)');
      return;
    }

    const refIdStr = String(refId);
    const docs = (docsResp.data || []).filter(d => String(d.ref_id) === refIdStr);

    API.patch('mail_references', refId, { view_count: (ref.view_count||0)+1 }).catch(()=>{});

    let entry = null;
    if (ref.entry_id) {
      entry = (entryResp.data || []).find(e => String(e.id) === String(ref.entry_id)) || null;
    }

    const isManual     = ref.source_type === 'manual';
    const authorName   = entry?.user_name  || ref.sender_name || ref.registered_by_name || '-';
    const approver1    = entry?.pre_approver_name || entry?.approver_name || '-';
    const approver2    = entry?.reviewer_name     || entry?.reviewer2_name || '-';
    const entryWorkDesc = entry?.work_description || '';

    const _toDateStr = (val) => {
      if (!val) return null;
      const n = Number(val);
      if (!isNaN(n) && n > 1e12)  return Utils.formatDate(n);
      if (!isNaN(n) && n > 1e9)   return Utils.formatDate(n * 1000);
      const d = new Date(val);
      return isNaN(d.getTime()) ? String(val).slice(0,10) : Utils.formatDate(d);
    };
    const dateStr = _toDateStr(ref.sent_at) || _toDateStr(ref.archived_at) || _toDateStr(ref.created_at) || '-';

    const bizName = entry?.work_subcategory_name || ref.work_subcategory || '';
    const bizBadgeHtml = bizName ? _archBizBadge(bizName) : '';

    const stars = parseInt(entry?.quality_stars ?? ref.quality_stars) || 0;
    const starLabel = {1:'C 참고',2:'B 우수',3:'A 매우우수'}[stars] || '';
    const starColor = {1:'#6b7280',2:'#2563eb',3:'#d97706'}[stars];
    const starBadgeHtml = stars > 0
      ? `<span class="arch-star-badge" style="color:${starColor};border-color:${starColor}40;background:${starColor}12">
           ${'★'.repeat(stars)}${'☆'.repeat(3-stars)} ${starLabel}
         </span>` : '';

    const kwArr = _parseArr(entry?.kw_query ?? ref.kw_query);
    const kwHtml = kwArr.length
      ? kwArr.map(k => `<span class="arch-card-kw-tag">${Utils.escHtml(k)}</span>`).join('')
      : '<span style="font-size:12px;color:#94a3b8">없음</span>';

    const lawArr = _parseArr(entry?.law_refs ?? ref.law_refs);
    const lawHtml = lawArr.length
      ? lawArr.map(l => {
          const label = typeof l === 'object'
            ? ((l.name||'') + (l.article ? ' ' + l.article : ''))
            : String(l);
          return `<span class="arch-modal-law-tag"><i class="fas fa-gavel" style="font-size:10px"></i>${Utils.escHtml(label)}</span>`;
        }).join('')
      : '<span style="font-size:12px;color:#94a3b8">없음</span>';

    const reasonArr = _parseArr(entry?.kw_reason ?? ref.kw_reason);
    const reasonHtml = reasonArr.length
      ? reasonArr.map(k => `<span class="arch-card-reason-tag">${Utils.escHtml(k)}</span>`).join('')
      : '<span style="font-size:12px;color:#94a3b8">없음</span>';

    const utilNote = (ref.archive_note || '').trim();

    const _rawDescHtml = (entryWorkDesc || ref.work_description || '').trim();
    const descHtml = _rawDescHtml
      ? _rawDescHtml
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/<xml[\s\S]*?<\/xml>/gi, '')
          .trim()
      : '';
    const summaryText = (ref.summary || '').trim();
    let contentHtml = descHtml
      ? (descHtml.startsWith('<') ? descHtml : '<p>' + Utils.escHtml(descHtml) + '</p>')
      : (summaryText ? '<p>' + Utils.escHtml(summaryText) + '</p>' : '');
    if (contentHtml && contentHtml.includes('<table')) {
      contentHtml = _cleanPasteHtml(contentHtml);
    }
    const contentText = descHtml
      ? descHtml.replace(/<[^>]+>/g,' ')
                .replace(/Normal\s+\d+\s+\d+\s+\d+\s+(false|true)\s+(false|true)\s+(false|true)[^\n]*/gi, '')
                .replace(/\s+/g,' ').trim()
      : summaryText;
    window._archDescMap = window._archDescMap || {};
    window._archDescMap[ref.id] = { html: contentHtml, text: contentText };

    const docsHtml = _buildDocsHtml(docs);

    const modalTitle = bizName
      ? (bizName.includes('자문') ? bizName : bizName)
      : ((ref.subject || '자문 자료 상세').replace(/\s*\([^)]*\)\s*$/, '').trim());

    document.getElementById('archiveDetailTitle').textContent = modalTitle;
    document.getElementById('archiveDetailBody').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px">

        <!-- ① 배지 + 메타 -->
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 16px;
                    background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
          ${bizBadgeHtml}
          ${starBadgeHtml}
          <div style="flex:1"></div>
          <span style="font-size:11px;color:#64748b"><i class="fas fa-calendar" style="margin-right:4px"></i>${dateStr}</span>
        </div>

        <!-- ② 담당자 정보 -->
        <div style="display:flex;flex-wrap:wrap;gap:16px 24px;font-size:13px;
                    padding:10px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
          ${isManual ? `
          <div style="display:flex;align-items:center;gap:8px">
            <span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;
                          color:#7c3aed;background:#f5f3ff;border:1px solid #ddd6fe;
                          border-radius:10px;padding:4px 12px">
              <i class="fas fa-folder-open" style="font-size:11px"></i> 과거 참고사례
            </span>
            <span style="font-size:11px;color:#94a3b8">시스템 구축 전 등록된 자료입니다</span>
          </div>
          ` : `
          <div style="display:flex;align-items:center;gap:6px">
            <i class="fas fa-user" style="color:#2d6bb5;font-size:11px"></i>
            <span style="color:#64748b;font-size:11px">작성자</span>
            <strong>${Utils.escHtml(authorName)}</strong>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <i class="fas fa-user-check" style="color:#2563eb;font-size:11px"></i>
            <span style="color:#64748b;font-size:11px">1차 승인자</span>
            <strong style="color:#2563eb">${Utils.escHtml(approver1)}</strong>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <i class="fas fa-user-shield" style="color:#7c3aed;font-size:11px"></i>
            <span style="color:#64748b;font-size:11px">최종 승인자</span>
            <strong style="color:#7c3aed">${Utils.escHtml(approver2)}</strong>
          </div>
          `}
        </div>

        <!-- ③ 핵심키워드 -->
        <div>
          <div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.05em;margin-bottom:6px">
            <i class="fas fa-tags" style="color:#6366f1;margin-right:5px"></i>핵심키워드
          </div>
          <div class="arch-modal-tags-section">${kwHtml}</div>
        </div>

        <!-- ④ 관련법령 -->
        <div>
          <div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.05em;margin-bottom:6px">
            <i class="fas fa-gavel" style="color:#d97706;margin-right:5px"></i>관련법령
          </div>
          <div class="arch-modal-tags-section">${lawHtml}</div>
        </div>

        <!-- ⑤ 판단사유 -->
        <div>
          <div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.05em;margin-bottom:6px">
            <i class="fas fa-balance-scale" style="color:#059669;margin-right:5px"></i>판단사유
          </div>
          <div class="arch-modal-tags-section">${reasonHtml}</div>
        </div>

        ${utilNote ? `
        <!-- ⑥ 활용포인트 -->
        <div style="padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;
                    font-size:13px;color:#78350f;line-height:1.6">
          <div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:4px">
            <i class="fas fa-lightbulb" style="margin-right:5px"></i>활용포인트
          </div>
          ${Utils.escHtml(utilNote)}
        </div>` : ''}

        <!-- ⑦ 자문내용 -->
        <div>
          <div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.05em;margin-bottom:6px">
            <i class="fas fa-file-alt" style="margin-right:5px"></i>자문내용
          </div>
          ${contentHtml
            ? `<div class="arch-summary-box" style="position:relative">
                 <div id="arch-desc-${ref.id}" class="arch-desc-view"
                   style="font-size:13px;line-height:1.75;padding:12px 14px;border-radius:8px;
                          border:1px solid #e2e8f0;background:#fffef7;color:#1e293b;
                          max-height:380px;overflow-y:auto;overflow-x:auto;
                          word-break:break-word;user-select:text;-webkit-user-select:text">
                   ${contentHtml}
                 </div>
                 <div style="display:flex;justify-content:flex-end;margin-top:6px">
                   <button class="arch-util-btn" onclick="_archCopyDesc('${ref.id}',this)" title="Outlook 호환 복사">
                     <i class="fas fa-copy"></i> 원문 복사
                   </button>
                 </div>
               </div>`
            : `<div style="font-size:13px;color:#94a3b8;padding:10px 0">자문내용 없음</div>`
          }
        </div>

        <!-- ⑧ 첨부 파일 -->
        ${docs.length ? `
        <div>
          <div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.05em;margin-bottom:8px">
            <i class="fas fa-paperclip" style="margin-right:5px"></i>첨부 파일 (${docs.length}개)
          </div>
          ${docsHtml}
        </div>` : ''}

      </div>
    `;

    const _session = Session.get();
    const canForceDelete = _session && (_session.role === 'admin' || _session.role === 'director');

    document.getElementById('archiveDetailFooter').innerHTML = `
      <button class="btn btn-ghost" onclick="closeModal('archiveDetailModal')">
        <i class="fas fa-times" style="margin-right:4px"></i>닫기
      </button>
      ${canForceDelete ? `
      <button class="btn btn-danger" onclick="deleteArchive('${refId}')"
              style="margin-left:auto;display:inline-flex;align-items:center;gap:6px">
        <i class="fas fa-trash-alt"></i> 자료 삭제
      </button>` : ''}
    `;
    openModal('archiveDetailModal');
  } catch(e) {
    console.error('openArchiveDetail error', e);
    Toast.error('자료를 불러오는 중 오류가 발생했습니다.');
  }
}

function _buildDocsHtml(docs) {
  if (!docs.length) return '';
  return docs.map(d => {
    const viewerId = `file-viewer-${d.id}`;
    const textId   = `file-text-${d.id}`;
    const isPdf    = d.file_type === 'pdf';
    const hasValidContent = !!(d.file_content && d.file_content.startsWith('data:') && d.file_content.length > 50);
    const hasPdfEmbed = isPdf && hasValidContent;
    const hasContent  = hasValidContent;
    const hasUrl      = !!(d.file_url);
    const hasText     = !!(d.extracted_text && d.extracted_text.trim());
    const isEmlFile   = d.file_type === 'eml';
    const isMailPdf   = isPdf && d.doc_type === 'mail_pdf';
    const isEml       = isEmlFile || isMailPdf;
    const bodyText    = isEml && hasText ? _extractMailBody(d.extracted_text) : '';
    const dispText    = isEml ? (bodyText || d.extracted_text || '') : (d.extracted_text || '');
    const fileSizeStr = d.file_size ? `${(d.file_size/1024).toFixed(0)}KB` : '';
    const fileTypeStr = (d.file_type||'').toUpperCase();
    const metaParts   = [fileTypeStr, fileSizeStr].filter(Boolean).join(' · ');
    const extractBadge = hasText
      ? `<span class="arch-file-badge arch-file-badge--ok"><i class="fas fa-check-circle"></i> 본문 복사 가능</span>`
      : hasPdfEmbed
        ? `<span class="arch-file-badge" style="background:#fffbeb;color:#92400e;border:1px solid #fde68a"><i class="fas fa-eye"></i> 뷰어 복사</span>`
        : `<span class="arch-file-badge arch-file-badge--no"><i class="fas fa-minus-circle"></i> 텍스트 없음</span>`;
    const mailPdfBadge = isMailPdf
      ? `<span class="arch-file-badge" style="background:#ede9fe;color:#5b21b6;border:1px solid #c4b5fd"><i class="fas fa-envelope"></i> 메일 PDF</span>` : '';
    const copyFn = `archCopyText('${d.id}',this)`;
    let viewerHtml = '';
    if (hasPdfEmbed) {
      viewerHtml = `<div id="${viewerId}" style="display:none;border-top:1px solid #e2e8f0">
        <div style="padding:10px 14px 0;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:11px;font-weight:700;color:#64748b"><i class="fas fa-file-pdf" style="color:#ef4444;margin-right:4px"></i>${isMailPdf?'메일 PDF 미리보기':'PDF 미리보기'}</span>
          <button class="arch-util-btn" onclick="archDownloadFile('${d.id}','${Utils.escHtml(d.file_name||'파일')}')"><i class="fas fa-download"></i> 다운로드</button>
        </div>
        <div style="padding:10px 14px 14px"><iframe src="${d.file_content}" style="width:100%;height:480px;border:1px solid #e2e8f0;border-radius:6px;display:block"></iframe></div>
        ${hasText?`<div style="padding:0 14px 14px"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:11px;font-weight:700;color:#64748b"><i class="fas fa-align-left" style="margin-right:4px"></i>PDF 본문</span><button class="arch-util-btn" onclick="${copyFn}"><i class="fas fa-copy"></i> 복사</button></div><div id="${textId}" class="arch-text-box" style="user-select:text;-webkit-user-select:text">${Utils.escHtml(d.extracted_text||'')}</div></div>`:''}
      </div>`;
    } else if (hasText) {
      viewerHtml = `<div id="${viewerId}" style="display:none;border-top:1px solid #e2e8f0;padding:12px 14px 14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:11px;font-weight:700;color:#64748b"><i class="fas ${isEml?'fa-envelope-open-text':'fa-align-left'}" style="margin-right:4px"></i>${isEml?'메일 본문':'추출 텍스트'}</span>
          <div style="display:flex;gap:6px">
            ${hasContent?`<button class="arch-util-btn" onclick="archDownloadFile('${d.id}','${Utils.escHtml(d.file_name||'파일')}')"><i class="fas fa-download"></i> 다운로드</button>`:''}
            <button class="arch-util-btn" onclick="${copyFn}"><i class="fas fa-copy"></i> 복사</button>
          </div>
        </div>
        <div id="${textId}" class="arch-text-box" style="user-select:text;-webkit-user-select:text">${Utils.escHtml(dispText)}</div>
      </div>`;
    }
    const actionBtns = [];
    if (viewerHtml) actionBtns.push(`<button class="arch-action-btn arch-action-btn--view" onclick="toggleFileViewer('${viewerId}',this)" data-open="false"><i class="fas fa-eye"></i> 내용 보기</button>`);
    if (hasContent) actionBtns.push(`<button class="arch-action-btn arch-action-btn--dl" onclick="archDownloadFile('${d.id}','${Utils.escHtml(d.file_name||'파일')}')"><i class="fas fa-download"></i> 다운로드</button>`);
    if (hasUrl)     actionBtns.push(`<a href="${Utils.escHtml(d.file_url)}" target="_blank" class="arch-action-btn arch-action-btn--link"><i class="fas fa-external-link-alt"></i> 링크 열기</a>`);
    if (hasText)    actionBtns.push(`<button class="arch-action-btn arch-action-btn--copy" onclick="${copyFn}"><i class="fas fa-copy"></i> 복사</button>`);
    if (!actionBtns.length) actionBtns.push(`<span style="font-size:11px;color:#94a3b8">활용 불가</span>`);
    return `
    <div class="arch-file-card" id="arch-file-${d.id}">
      <div class="arch-file-card-header">
        <div class="arch-file-icon">${_fileTypeIcon(d.file_type)}</div>
        <div class="arch-file-info">
          <div class="arch-file-name">${Utils.escHtml(d.file_name||'파일')}</div>
          <div class="arch-file-meta">${metaParts?`<span>${metaParts}</span>`:''} ${mailPdfBadge} ${extractBadge}</div>
        </div>
        <div class="arch-file-actions">${actionBtns.join('')}</div>
      </div>
      ${viewerHtml}
    </div>`;
  }).join('');
}

function toggleExtractedText(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function toggleFileViewer(viewerId, btnEl) {
  const viewer = document.getElementById(viewerId);
  if (!viewer) return;
  const isOpen = viewer.style.display !== 'none';
  viewer.style.display = isOpen ? 'none' : 'block';
  if (btnEl) {
    const open = !isOpen;
    btnEl.innerHTML = open
      ? '<i class="fas fa-eye-slash"></i> 닫기'
      : '<i class="fas fa-eye"></i> 내용 보기';
    btnEl.classList.toggle('arch-action-btn--active', open);
  }
}

async function archDownloadFile(docId, fileName) {
  try {
    const d = await API.get('doc_texts', docId);
    if (!d || !d.file_content) { Toast.warning('저장된 파일 데이터가 없습니다.'); return; }
    const [meta, b64] = d.file_content.split(',');
    if (!b64) { Toast.warning('파일 형식을 인식할 수 없습니다.'); return; }
    const mime = (meta.match(/:(.*?);/) || [])[1] || 'application/octet-stream';
    const bytes = atob(b64);
    const arr   = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = fileName || 'download'; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
    Toast.success(`"${fileName}" 다운로드를 시작합니다.`);
  } catch(e) {
    console.error('archDownloadFile error', e);
    Toast.error('다운로드 중 오류가 발생했습니다.');
  }
}
// ─────────────────────────────────────────────
//  메일 본문 추출 헬퍼
// ─────────────────────────────────────────────
function _extractMailBody(text) {
  if (!text) return '';

  const KO_HEADERS = ['보낸 사람', '받는 사람', '보낸 날짜', '보낸날짜', '받는날짜', '숨은참조', '참조', '제목', '날짜'];
  const EN_HEADERS = ['Reply-To', 'Message-ID', 'MIME-Version', 'Content-Type', 'Subject', 'From', 'Date', 'Bcc', 'Cc', 'To'];
  const ALL_HEADERS = [...KO_HEADERS, ...EN_HEADERS];

  const escKey = k => k.replace(/[-]/g, '\\-').replace(/\s+/g, '\\s*');

  const lines = text.split('\n');
  if (lines.length >= 3) {
    const isHeaderLine = (line) => {
      const t = line.trim();
      if (!t) return false;
      for (const k of KO_HEADERS) {
        if (t.startsWith(k + ':') || t.startsWith(k + ' :')) return true;
        if (/^\d+\s+/.test(t)) {
          const stripped = t.replace(/^\d+\s+/, '');
          if (stripped.startsWith(k + ':') || stripped.startsWith(k + ' :')) return true;
        }
      }
      if (/^[A-Za-z][\w\-]*\s*:/.test(t)) return true;
      return false;
    };

    let hCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (isHeaderLine(lines[i])) {
        hCount++;
      } else if (hCount >= 2) {
        let start = i;
        while (start < lines.length && !lines[start].trim()) start++;
        if (start < lines.length) return lines.slice(start).join('\n').trim();
      } else if (lines[i].trim() === '' && hCount > 0) {
        let start = i + 1;
        while (start < lines.length && !lines[start].trim()) start++;
        if (start < lines.length) return lines.slice(start).join('\n').trim();
      } else if (hCount === 0 && lines[i].trim()) {
        break;
      }
    }
  }

  const segments = [];
  for (const k of ALL_HEADERS) {
    const pat = new RegExp('(?:^|\\s)(?:\\d+\\s+)?(' + escKey(k) + ')\\s*:', 'gi');
    let m;
    while ((m = pat.exec(text)) !== null) {
      const keyStart = m.index + m[0].indexOf(m[1]);
      const valueStart = m.index + m[0].length;
      segments.push({ key: k, start: keyStart, valueStart });
    }
  }

  if (segments.length >= 2) {
    segments.sort((a, b) => a.start - b.start);
    const subjectSeg = [...segments].reverse().find(s => s.key === '제목' || s.key.toLowerCase() === 'subject');

    if (subjectSeg) {
      const nextSeg = segments.find(s => s.start > subjectSeg.start);
      if (nextSeg) {
        const lastSeg = segments[segments.length - 1];
        const afterLast = text.slice(lastSeg.valueStart).trim();
        let hasMore = false;
        for (const k of ALL_HEADERS) {
          if (new RegExp('(?:^|\\s)' + escKey(k) + '\\s*:', 'i').test(afterLast.slice(0, 300))) {
            hasMore = true; break;
          }
        }
        if (!hasMore) return afterLast;

        let cur = afterLast;
        for (let attempt = 0; attempt < 5; attempt++) {
          let found = false;
          for (const k of ALL_HEADERS) {
            const r = new RegExp('(?:^|\\s)(?:\\d+\\s+)?' + escKey(k) + '\\s*:', 'i');
            const mm = r.exec(cur);
            if (mm) { cur = cur.slice(mm.index + mm[0].length).trim(); found = true; break; }
          }
          if (!found) break;
        }
        return cur.trim();
      } else {
        return text.slice(subjectSeg.valueStart).trim();
      }
    }

    const lastSeg = segments[segments.length - 1];
    const afterLast = text.slice(lastSeg.valueStart).trim();
    if (afterLast) return afterLast;
  }

  return text.trim();
}

function _debugShowMailText(rawText, docId) {
  document.getElementById('_dbg_mail_overlay_')?.remove();
  const lines = rawText.split('\n');
  const lineInfo = lines.slice(0, 20).map((l, i) =>
    `<div style="border-bottom:1px solid #e5e7eb;padding:4px 8px;font-size:11px">
      <span style="color:#6b7280;min-width:24px;display:inline-block">[${i}]</span>
      <span style="color:#1f2937;word-break:break-all">${Utils.escHtml(JSON.stringify(l).slice(1,-1).slice(0, 200))}</span>
    </div>`
  ).join('');

  const ov = document.createElement('div');
  ov.id = '_dbg_mail_overlay_';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML = `
    <div style="background:#fff;border-radius:10px;width:min(800px,96vw);max-height:80vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4)">
      <div style="padding:14px 18px;background:#1a2b45;color:#fff;font-weight:700;font-size:14px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <span>🔍 [DEBUG] Raw 텍스트 구조 (doc: ${docId.slice(-8)})</span>
        <button onclick="document.getElementById('_dbg_mail_overlay_').remove()" style="background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:4px;padding:4px 10px;cursor:pointer">✕ 닫기</button>
      </div>
      <div style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:12px;color:#374151;flex-shrink:0">
        총 길이: <strong>${rawText.length}자</strong> | 줄 수: <strong>${lines.length}줄</strong>
      </div>
      <div style="padding:10px 14px;background:#fffbeb;border-bottom:1px solid #fde68a;font-size:12px;flex-shrink:0">
        <strong>첫 400자 (JSON):</strong><br>
        <code style="font-size:11px;word-break:break-all;color:#92400e">${Utils.escHtml(JSON.stringify(rawText.slice(0,400)))}</code>
      </div>
      <div style="overflow-y:auto;flex:1">
        <div style="padding:8px 0;font-size:11px;font-weight:700;color:#6b7280;padding-left:10px">줄별 분석 (앞 20줄):</div>
        ${lineInfo}
      </div>
    </div>`;
  document.body.appendChild(ov);
}

async function archCopyMailBody(docId, btnEl) {
  try {
    const d = await API.get('doc_texts', docId);
    if (!d || !d.extracted_text) { Toast.warning('복사할 본문이 없습니다.'); return; }
    _debugShowMailText(d.extracted_text, docId);
    const body = _extractMailBody(d.extracted_text);
    if (!body) { Toast.warning('본문 내용을 찾을 수 없습니다.'); return; }
    await navigator.clipboard.writeText(body);
    if (btnEl) {
      const orig = btnEl.innerHTML;
      btnEl.innerHTML = '<i class="fas fa-check" style="color:#16a34a"></i> 복사됨';
      btnEl.disabled = true;
      setTimeout(() => { btnEl.innerHTML = orig; btnEl.disabled = false; }, 2000);
    }
    Toast.success('메일 본문이 클립보드에 복사되었습니다.');
  } catch(e) {
    console.error('archCopyMailBody error', e);
    Toast.error('복사 중 오류가 발생했습니다.');
  }
}

async function archCopyText(docId, btnEl) {
  try {
    const textBox = document.getElementById(`file-text-${docId}`);
    let text = textBox ? textBox.innerText.trim() : null;
    if (!text) {
      const d = await API.get('doc_texts', docId);
      if (!d || !d.extracted_text) { Toast.warning('복사할 텍스트가 없습니다.'); return; }
      const isMailPdf = d.file_type === 'pdf' && d.doc_type === 'mail_pdf';
      text = isMailPdf ? _extractMailBody(d.extracted_text) : d.extracted_text;
      if (!text) { Toast.warning('복사할 텍스트가 없습니다.'); return; }
    }
    await navigator.clipboard.writeText(text);
    if (btnEl) {
      const orig = btnEl.innerHTML;
      btnEl.innerHTML = '<i class="fas fa-check" style="color:#16a34a"></i> 복사됨';
      btnEl.disabled = true;
      setTimeout(() => { btnEl.innerHTML = orig; btnEl.disabled = false; }, 2000);
    }
    Toast.success('텍스트가 클립보드에 복사되었습니다.');
  } catch(e) {
    console.error('archCopyText error', e);
    Toast.error('복사 중 오류가 발생했습니다.');
  }
}

async function archCopyBodyText(refId, btnEl) {
  try {
    const textBox = document.getElementById(`arch-body-text-${refId}`);
    let text = textBox ? textBox.innerText.trim() : null;
    if (!text) {
      const ref = await API.get('mail_references', refId);
      text = (ref.body_text || '').trim();
      if (!text) { Toast.warning('복사할 본문 내용이 없습니다.'); return; }
    }
    await navigator.clipboard.writeText(text);
    if (btnEl) {
      const orig = btnEl.innerHTML;
      btnEl.innerHTML = '<i class="fas fa-check" style="color:#16a34a"></i> 복사됨';
      btnEl.disabled = true;
      setTimeout(() => { btnEl.innerHTML = orig; btnEl.disabled = false; }, 2000);
    }
    Toast.success('본문이 클립보드에 복사되었습니다.');
  } catch(e) {
    console.error('archCopyBodyText error', e);
    Toast.error('복사 중 오류가 발생했습니다.');
  }
}

function _injectOutlookTableStyle(html) {
  if (!html) return html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('table').forEach(t => {
    t.setAttribute('border', '1');
    t.style.borderCollapse = 'collapse';
    t.style.border = '1px solid #94a3b8';
    t.style.fontFamily = 'inherit';
    t.style.fontSize   = '13px';
  });
  tmp.querySelectorAll('th').forEach(el => {
    el.style.border      = '1px solid #94a3b8';
    el.style.padding     = '4px 8px';
    el.style.background  = '#e2e8f0';
    el.style.fontWeight  = '700';
    el.style.textAlign   = 'center';
    el.style.whiteSpace  = 'pre-wrap';
    el.style.verticalAlign = 'top';
  });
  tmp.querySelectorAll('td').forEach(el => {
    el.style.border      = '1px solid #94a3b8';
    el.style.padding     = '4px 8px';
    el.style.whiteSpace  = 'pre-wrap';
    el.style.verticalAlign = 'top';
  });
  return tmp.innerHTML;
}

function _archCopyDesc(refId, btnEl) {
  try {
    const cache = window._archDescMap && window._archDescMap[refId];
    const rawHtml    = (cache && cache.html) || '';
    const textContent = (cache && cache.text) || '';
    if (!rawHtml && !textContent) { Toast.warning('복사할 자문내용이 없습니다.'); return; }
    const htmlContent = _injectOutlookTableStyle(rawHtml);
    const _done = () => {
      if (btnEl) {
        const orig = btnEl.innerHTML;
        btnEl.innerHTML = '<i class="fas fa-check" style="color:#16a34a"></i> 복사됨';
        btnEl.disabled = true;
        setTimeout(() => { btnEl.innerHTML = orig; btnEl.disabled = false; }, 2000);
      }
      Toast.success('자문내용이 클립보드에 복사되었습니다. (Outlook에 붙여넣기 시 표선 포함)');
    };
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
      const textBlob = new Blob([textContent], { type: 'text/plain' });
      navigator.clipboard.write([
        new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })
      ]).then(_done).catch(() => {
        navigator.clipboard.writeText(textContent).then(_done).catch(() => Toast.error('복사 실패'));
      });
    } else {
      navigator.clipboard.writeText(textContent).then(_done).catch(() => Toast.error('복사 실패'));
    }
  } catch(e) {
    console.error('_archCopyDesc error', e);
    Toast.error('복사 중 오류가 발생했습니다.');
  }
}

async function archCopySummary(refId, btnEl) {
  try {
    const ref = await API.get('mail_references', refId);
    const text = (ref.summary || ref.body_text || '').trim();
    if (!text) { Toast.warning('복사할 요약 내용이 없습니다.'); return; }
    await navigator.clipboard.writeText(text);
    if (btnEl) {
      const orig = btnEl.innerHTML;
      btnEl.innerHTML = '<i class="fas fa-check" style="color:#16a34a"></i> 복사됨';
      btnEl.disabled = true;
      setTimeout(() => { btnEl.innerHTML = orig; btnEl.disabled = false; }, 2000);
    }
    Toast.success('자문 요약이 클립보드에 복사되었습니다.');
  } catch(e) {
    console.error('archCopySummary error', e);
    Toast.error('복사 중 오류가 발생했습니다.');
  }
}

async function markHelpful(refId) {
  try {
    const ref = await API.get('mail_references', refId);
    await API.patch('mail_references', refId, { helpful_count: (ref.helpful_count||0)+1 });
    Toast.success('도움됨으로 표시했습니다.');
    openArchiveDetail(refId);
  } catch(e) { Toast.error('오류가 발생했습니다.'); }
}

async function openArchiveFiles(refId) {
  try {
    const [ref, docsResp] = await Promise.all([
      API.get('mail_references', refId),
      API.list('doc_texts', { limit: 50 })
    ]);
    openArchiveDetail(refId);
  } catch(e) { Toast.error('오류가 발생했습니다.'); }
}

// ─────────────────────────────────────────────
//  직접 등록 모달
// ─────────────────────────────────────────────
async function openArchiveNewModal() {
  _archiveNewPendingFiles = [];
  document.getElementById('archive-edit-id').value = '';
  document.getElementById('archive-subject-input').value = '';
  document.getElementById('archive-sender-name-input').value = '';
  document.getElementById('archive-sender-email-input').value = '';
  document.getElementById('archive-recipients-input').value = '';
  document.getElementById('archive-sent-at-input').value = Utils.todayStr ? Utils.todayStr() : new Date().toISOString().slice(0,10);
  document.getElementById('archive-summary-input').value = '';
  document.getElementById('archive-tags-input').value = '';
  document.getElementById('archive-is-template').checked = false;

  document.getElementById('arch-new-kw-tags').innerHTML = '';
  document.getElementById('arch-new-kw-input').value = '';
  document.getElementById('arch-new-kw-hidden').value = '[]';

  document.getElementById('arch-new-reason-tags').innerHTML = '';
  document.getElementById('arch-new-reason-input').value = '';
  document.getElementById('arch-new-reason-hidden').value = '[]';

  document.getElementById('arch-new-law-tags').innerHTML = '';
  document.getElementById('arch-new-law-name-input').value = '';
  document.getElementById('arch-new-law-article-input').value = '';
  document.getElementById('arch-new-law-hidden').value = '[]';

  document.getElementById('archive-stars-value').value = '';
  document.querySelectorAll('.arch-star-btn').forEach(btn => {
    btn.style.background = '#fff';
    btn.style.borderColor = '#d1d5db';
    btn.style.color = '#6b7280';
  });

  _archResetEditor();
  document.getElementById('archive-quill-hidden').value = '';

  await _fillArchiveModalSelects();
  openModal('archiveNewModal');
}

let _bodyInputTimer = null;
function _archiveBodyInputHandler(textarea) {
  clearTimeout(_bodyInputTimer);
  _bodyInputTimer = setTimeout(() => {
    const bodyText = textarea.value.trim();
    const subcatVal = document.getElementById('archive-subcategory-select')?.value || '';
    const preview = document.getElementById('archive-auto-tags-preview');
    const list = document.getElementById('archive-auto-tags-list');
    if (!preview || !list) return;
    if (!bodyText && !subcatVal) { preview.style.display = 'none'; return; }
    const tags = _generateAutoTags(bodyText, subcatVal);
    if (!tags.length) { preview.style.display = 'none'; return; }
    list.innerHTML = tags.map(t =>
      `<span style="background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe;border-radius:10px;padding:2px 9px;font-size:11px">${Utils.escHtml(t)}</span>`
    ).join('');
    preview.style.display = 'block';
  }, 600);
}

function _generateAutoTags(bodyText, subcatName) {
  const tags = new Set();
  if (subcatName) tags.add(subcatName);
  const kws = _extractKeywords(bodyText, 9);
  kws.forEach(k => { if (k.length >= 2) tags.add(k); });
  return [...tags].slice(0, 10);
}

async function openArchiveEdit(refId) {
  try {
    const ref = await API.get('mail_references', refId);
    _archiveNewPendingFiles = [];
    document.getElementById('archive-edit-id').value = refId;
    document.getElementById('archiveNewModalTitle').textContent = '자문 자료 수정';
    document.getElementById('archive-subject-input').value = ref.subject||'';
    document.getElementById('archive-sender-name-input').value = ref.sender_name||'';
    document.getElementById('archive-sender-email-input').value = ref.sender_email||'';
    document.getElementById('archive-recipients-input').value = ref.recipients||'';
    document.getElementById('archive-sent-at-input').value = ref.sent_at||'';
    document.getElementById('archive-body-input').value = ref.body_text||'';
    document.getElementById('archive-summary-input').value = ref.summary||'';
    document.getElementById('archive-tags-input').value = ref.tags||'';
    document.getElementById('archive-is-template').checked = !!ref.is_template;

    const preview = document.getElementById('archive-auto-tags-preview');
    const list = document.getElementById('archive-auto-tags-list');
    if (preview && list && ref.tags) {
      const existingTags = ref.tags.split(',').map(t => t.trim()).filter(Boolean);
      list.innerHTML = existingTags.map(t =>
        `<span style="background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe;border-radius:10px;padding:2px 9px;font-size:11px">${Utils.escHtml(t)}</span>`
      ).join('');
      preview.style.display = existingTags.length ? 'block' : 'none';
      if (preview.style.display === 'block') {
        preview.querySelector('span').innerHTML = '<i class="fas fa-tag" style="margin-right:4px"></i>저장된 태그';
      }
    }

    await _fillArchiveModalSelects(ref);
    document.getElementById('archive-pending-files').innerHTML = '';
    openModal('archiveNewModal');
  } catch(e) { Toast.error('자료를 불러오는 중 오류가 발생했습니다.'); }
}

async function _fillArchiveModalSelects(ref) {
  try {
    const [cats, subcats] = await Promise.all([
      Master.categories(), Master.subcategories()
    ]);
    const ssel = document.getElementById('archive-subcategory-select');
    if (!ssel) return;

    const clientCats = cats.filter(c => (c.category_type || '') === 'client')
                           .sort((a,b) => (a.sort_order||0)-(b.sort_order||0));
    ssel.innerHTML = '<option value="">업무분류 선택</option>';
    clientCats.forEach(cat => {
      const catSubs = subcats
        .filter(s => s.category_id === cat.id)
        .sort((a,b) => (a.sort_order||0)-(b.sort_order||0));
      if (!catSubs.length) return;
      const grp = document.createElement('optgroup');
      grp.label = cat.category_name || cat.name || '';
      catSubs.forEach(s => {
        const name = s.sub_category_name || s.name || '';
        const o = new Option(name, name);
        o.dataset.catId   = cat.id;
        o.dataset.catName = cat.category_name || cat.name || '';
        grp.appendChild(o);
      });
      ssel.appendChild(grp);
    });

    const asel = document.getElementById('archive-category-select');
    if (asel) {
      asel.innerHTML = '';
      cats.forEach(c => {
        const o = new Option(c.category_name||c.name, c.id+'|'+(c.category_name||c.name));
        asel.appendChild(o);
      });
    }

    ssel.onchange = () => _syncCategoryFromSubcat(ssel, asel);

    if (ref && ref.work_subcategory) {
      ssel.value = ref.work_subcategory;
      _syncCategoryFromSubcat(ssel, asel);
    }
  } catch(e) { console.error('_fillArchiveModalSelects error', e); }
}

function _syncCategoryFromSubcat(ssel, asel) {
  if (!ssel || !asel) return;
  const selected = ssel.options[ssel.selectedIndex];
  if (selected && selected.dataset.catId) {
    const catId   = selected.dataset.catId;
    const matchOpt = Array.from(asel.options).find(o => o.value.startsWith(catId + '|'));
    if (matchOpt) asel.value = matchOpt.value;
  }
}

async function onArchiveCategoryChange() {
  const asel = document.getElementById('archive-category-select');
  const ssel = document.getElementById('archive-subcategory-select');
  if (!ssel || !asel) return;
  try {
    const catId = (asel.value || '').split('|')[0];
    const subcats = await Master.subcategories();
    const filtered = subcats.filter(s => s.category_id === catId);
    ssel.innerHTML = '<option value="">소분류 선택</option>';
    filtered.forEach(s => { const o = new Option(s.sub_category_name||s.name, s.sub_category_name||s.name); ssel.appendChild(o); });
  } catch(e) { console.error('onArchiveCategoryChange error', e); }
}

// ─────────────────────────────────────────────
//  직접 등록 파일 처리
// ─────────────────────────────────────────────
function onArchiveFileDrop(event) {
  event.preventDefault();
  const zone = document.getElementById('archive-drop-zone');
  if (zone) { zone.style.borderColor='#d1d5db'; zone.style.background='#fafafa'; }
  const files = Array.from(event.dataTransfer.files);
  _addArchiveNewFiles(files);
}

function onArchiveFileSelect(files) {
  _addArchiveNewFiles(Array.from(files));
  document.getElementById('archive-file-input').value = '';
}

async function _addArchiveNewFiles(files) {
  for (const f of files) {
    if (f.size > 5*1024*1024) {
      Toast.warning(`${f.name}: 파일이 5MB를 초과합니다. 건너뜁니다.`);
      continue;
    }
    const obj = { file: f, fileName: f.name, fileType: _detectFileType(f), fileSize: Math.round(f.size/1024), content: null, extractedText: '', extractStatus: 'pending', docType: 'normal' };
    _archiveNewPendingFiles.push(obj);
    _renderArchiveNewFiles();
    _extractFileText(f, obj).then(() => _renderArchiveNewFiles());
  }
}

function _renderArchiveNewFiles() {
  const container = document.getElementById('archive-pending-files');
  if (!container) return;
  if (!_archiveNewPendingFiles.length) { container.innerHTML = ''; return; }
  container.innerHTML = _archiveNewPendingFiles.map((f,i) => {
    const isPdf = f.fileType === 'pdf';
    const isMailPdf = f.docType === 'mail_pdf';
    const mailToggle = isPdf ? `
      <label class="arch-mail-pdf-toggle" title="메일을 PDF로 저장한 파일이면 켜주세요">
        <input type="checkbox" onchange="_toggleMailPdf(${i}, this.checked)" ${isMailPdf ? 'checked' : ''}>
        <span class="arch-mail-pdf-label"><i class="fas fa-envelope" style="margin-right:3px"></i>메일 PDF</span>
      </label>` : '';
    return `
    <div class="arch-upload-file-item">
      <div style="font-size:20px;flex-shrink:0">${_fileTypeIcon(f.fileType)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Utils.escHtml(f.fileName)}</div>
        <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px">
          <span>${f.fileSize}KB</span>
          <span>${_extractStatusLabel(f.extractStatus)}</span>
          ${isMailPdf ? '<span style="color:#7c3aed;font-weight:600"><i class="fas fa-envelope"></i> 메일 PDF</span>' : ''}
        </div>
      </div>
      ${mailToggle}
      <button class="btn btn-xs btn-ghost" style="color:#ef4444;flex-shrink:0" onclick="_removeArchiveNewFile(${i})">
        <i class="fas fa-times"></i>
      </button>
    </div>`;
  }).join('');
}

function _toggleMailPdf(idx, checked) {
  if (_archiveNewPendingFiles[idx]) {
    _archiveNewPendingFiles[idx].docType = checked ? 'mail_pdf' : 'normal';
    _renderArchiveNewFiles();
  }
}

function _removeArchiveNewFile(i) {
  _archiveNewPendingFiles.splice(i,1);
  _renderArchiveNewFiles();
}

// ─────────────────────────────────────────────
//  자료 저장
// ─────────────────────────────────────────────
async function saveArchiveRecord() {
  const session = Session.get();
  if (!session) return;

  const catSel    = document.getElementById('archive-category-select');
  const subcatSel = document.getElementById('archive-subcategory-select');
  const catRaw    = catSel?.value || '';
  const catName   = catRaw.includes('|') ? catRaw.split('|')[1] : catRaw;
  const subcatVal = subcatSel?.value || '';

  let kwQuery = [];
  try { kwQuery = JSON.parse(document.getElementById('arch-new-kw-hidden')?.value || '[]'); } catch(e) { kwQuery = []; }

  let kwReason = [];
  try { kwReason = JSON.parse(document.getElementById('arch-new-reason-hidden')?.value || '[]'); } catch(e) { kwReason = []; }

  let lawRefs = [];
  try { lawRefs = JSON.parse(document.getElementById('arch-new-law-hidden')?.value || '[]'); } catch(e) { lawRefs = []; }

  const starsVal = parseInt(document.getElementById('archive-stars-value')?.value || '0');

  const _rawDescHtml = _archGetEditorHtml();
  const workDescHtml = _cleanPasteHtml(_rawDescHtml);
  const workDescText = _archGetEditorText()
    .replace(/Normal\s+\d+\s+\d+\s+\d+\s+(false|true)\s+(false|true)\s+(false|true)[^\n]*/gi, '')
    .replace(/\s+/g, ' ').trim();

  if (!subcatVal)       { Toast.warning('업무분류를 선택하세요.'); return; }
  if (!starsVal)        { Toast.warning('평가등급을 선택하세요.'); return; }
  if (!kwQuery.length)  { Toast.warning('핵심키워드를 1개 이상 입력하세요.'); return; }
  if (!workDescText || workDescText.replace(/\s/g,'') === '')  {
    Toast.warning('자문 내용을 입력하세요.'); return;
  }

  const todayStr   = Utils.todayStr ? Utils.todayStr() : new Date().toISOString().slice(0,10);
  const autoSubject = `${subcatVal} ${todayStr}`;
  const autoSummary = workDescText.replace(/\s+/g,' ').slice(0, 150);
  const starDisplay = '★'.repeat(starsVal) + '☆'.repeat(3 - starsVal);
  const starRatingMap = { 3: 'very_satisfied', 2: 'satisfied', 1: 'normal' };

  const payload = {
    subject: autoSubject, body_text: workDescHtml, work_description: workDescHtml,
    sender_name: session.name, sender_email: session.email || '',
    recipients: '', sent_at: todayStr, client_id: '', client_name: '',
    work_category: catName, work_subcategory: subcatVal,
    kw_query: JSON.stringify(kwQuery), kw_reason: JSON.stringify(kwReason),
    law_refs: JSON.stringify(lawRefs),
    quality_stars: starsVal, quality_rating: starRatingMap[starsVal] || 'normal',
    star_display: starDisplay, tags: kwQuery.join(', '), keywords: kwQuery.join(', '),
    summary: autoSummary, archive_note: '',
    is_template: document.getElementById('archive-is-template')?.checked || false,
    source_type: 'manual', registered_by_id: session.id, registered_by_name: session.name,
    status: 'active', view_count: 0, helpful_count: 0
  };

  const saveBtn    = document.getElementById('archiveNewSaveBtn');
  const closeBtn2  = document.querySelector('#archiveNewModal .modal-footer .btn-ghost');
  const restoreBtn   = BtnLoading.start(saveBtn, '저장 중...');
  const restoreClose = BtnLoading.disableAll(closeBtn2);

  try {
    const created = await API.create('mail_references', payload);
    const refId = created.id;
    await _updateSearchIndex(refId).catch(e => console.warn('검색인덱스 업데이트 실패(무시):', e));
    Cache.invalidate('doc_texts_list');
    Cache.invalidate('ref_search_index_list');
    restoreBtn(); restoreClose();
    Toast.success('✅ 자문 자료가 등록되었습니다.');
    closeModal('archiveNewModal');
    loadArchiveList();
  } catch(e) {
    restoreBtn(); restoreClose();
    console.error('saveArchiveRecord error', e);
    Toast.error('저장 중 오류가 발생했습니다.');
  }
}

// ─────────────────────────────────────────────
//  Hybrid 에디터 (Quill + contenteditable)
// ─────────────────────────────────────────────
let _archiveQuill = null;
let _archiveUseRich = false;

function _cleanPasteHtml(html) {
  try {
    let cleaned = html
      .replace(/<!--\[if[^\]]*\]>.*?<!\[endif\]-->/gis, '')
      .replace(/<xml[^>]*>.*?<\/xml>/gis, '')
      .replace(/<o:[^>]*>.*?<\/o:[^>]*>/gis, '')
      .replace(/<w:[^>]*>.*?<\/w:[^>]*>/gis, '')
      .replace(/<o:[^>]*\/>/gi, '')
      .replace(/<w:[^>]*\/>/gi, '');

    const tmp = document.createElement('div');
    tmp.innerHTML = cleaned;

    tmp.querySelectorAll('o\\:p, w\\:sdt, w\\:sdtContent, o\\:wrapblock').forEach(el => {
      el.replaceWith(...Array.from(el.childNodes));
    });
    tmp.querySelectorAll('[class^="Mso"], [class*=" Mso"]').forEach(el => {
      el.removeAttribute('class');
    });

    tmp.querySelectorAll('*').forEach(el => {
      const st = el.getAttribute('style') || '';
      if (st) {
        const cleanedStyle = st.split(';')
          .map(s => s.trim())
          .filter(s => s && !s.startsWith('mso-') && !s.startsWith('-mso'))
          .join('; ');
        if (cleanedStyle) el.setAttribute('style', cleanedStyle);
        else el.removeAttribute('style');
      }
      el.removeAttribute('class');
    });

    tmp.querySelectorAll('table').forEach(t => {
      t.style.borderCollapse = 'collapse';
      t.style.maxWidth = '100%';
      t.style.fontSize = '12px';
      t.style.tableLayout = 'auto';
      t.removeAttribute('width');
      t.style.width = 'auto';
    });
    tmp.querySelectorAll('td, th').forEach(el => {
      el.style.border = '1px solid #94a3b8';
      el.style.padding = '4px 8px';
      el.style.verticalAlign = 'top';
      el.style.wordBreak = 'break-word';
      el.style.whiteSpace = 'pre-wrap';
      el.removeAttribute('width');
      el.removeAttribute('height');
    });
    tmp.querySelectorAll('th').forEach(el => {
      el.style.background = '#e2e8f0';
      el.style.fontWeight = '700';
      el.style.textAlign = 'center';
    });

    return tmp.innerHTML;
  } catch(e) {
    return html;
  }
}

function _archSwitchToRich(html) {
  _archiveUseRich = true;
  const quillWrap = document.getElementById('archive-quill-editor');
  const richEl    = document.getElementById('archive-rich-editor');
  const badge     = document.getElementById('archive-editor-mode-badge');
  if (!richEl) return;
  if (quillWrap) quillWrap.style.display = 'none';
  richEl.style.display = 'block';
  if (badge) { badge.style.display = 'flex'; }
  if (html !== undefined) richEl.innerHTML = html;
}

function _archSwitchToQuill() {
  _archiveUseRich = false;
  const quillWrap = document.getElementById('archive-quill-editor');
  const richEl    = document.getElementById('archive-rich-editor');
  const badge     = document.getElementById('archive-editor-mode-badge');
  if (quillWrap) quillWrap.style.display = 'block';
  if (richEl)  { richEl.style.display = 'none'; richEl.innerHTML = ''; }
  if (badge)   { badge.style.display = 'none'; }
  if (_archiveQuill) _archiveQuill.setContents([]);
}

function _archGetEditorHtml() {
  if (_archiveUseRich) {
    const el = document.getElementById('archive-rich-editor');
    return el ? el.innerHTML.trim() : '';
  }
  return _archiveQuill ? _archiveQuill.root.innerHTML.trim() : '';
}

function _archGetEditorText() {
  if (_archiveUseRich) {
    const el = document.getElementById('archive-rich-editor');
    return el ? el.innerText.trim() : '';
  }
  if (_archiveQuill) {
    return (_archiveQuill.getText().trim() || _archiveQuill.root.innerText.trim());
  }
  return '';
}

function _archResetEditor() {
  _archiveUseRich = false;
  const quillWrap = document.getElementById('archive-quill-editor');
  const richEl    = document.getElementById('archive-rich-editor');
  const badge     = document.getElementById('archive-editor-mode-badge');
  if (quillWrap) quillWrap.style.display = 'block';
  if (richEl)  { richEl.style.display = 'none'; richEl.innerHTML = ''; }
  if (badge)   { badge.style.display = 'none'; }
  _initArchiveQuill();
  if (_archiveQuill) _archiveQuill.setContents([]);
}

function _initArchiveQuill() {
  const richEl = document.getElementById('archive-rich-editor');
  if (richEl && !richEl._pasteReady) {
    richEl._pasteReady = true;
    richEl.addEventListener('paste', function(e) {
      e.preventDefault();
      const cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      const htmlData = cd.getData('text/html');
      const textData = cd.getData('text/plain');
      const toInsert = htmlData ? _cleanPasteHtml(htmlData) : (textData || '');
      document.execCommand('insertHTML', false, toInsert);
    });
  }

  if (_archiveQuill) return;
  if (typeof Quill === 'undefined') { console.warn('Quill 라이브러리 미로드'); return; }

  _archiveQuill = new Quill('#archive-quill-editor', {
    theme: 'snow',
    placeholder: '메일 본문을 그대로 붙여넣기 하세요 (엑셀 표 포함 가능)',
    modules: {
      toolbar: [
        [{ header: [2, 3, false] }],
        ['bold', 'italic', 'underline'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['clean']
      ],
      clipboard: { matchVisual: false }
    }
  });

  _archiveQuill.root.addEventListener('paste', function(e) {
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    const htmlData = cd.getData('text/html');
    if (htmlData && htmlData.includes('<table')) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const cleanHtml = _cleanPasteHtml(htmlData);
      _archSwitchToRich(cleanHtml);
      setTimeout(() => {
        const richEl = document.getElementById('archive-rich-editor');
        if (richEl) richEl.focus();
      }, 50);
    }
  }, true);
}

function _archSelectStars(stars) {
  document.getElementById('archive-stars-value').value = stars;
  const colors = { 3: { bg:'#ecfdf5', border:'#10b981', text:'#065f46' },
                   2: { bg:'#eff6ff', border:'#3b82f6', text:'#1d4ed8' },
                   1: { bg:'#f9fafb', border:'#6b7280', text:'#374151' } };
  document.querySelectorAll('.arch-star-btn').forEach(btn => {
    const s = parseInt(btn.dataset.stars);
    const c = s === stars ? colors[s] : null;
    btn.style.background   = c ? c.bg     : '#fff';
    btn.style.borderColor  = c ? c.border : '#d1d5db';
    btn.style.color        = c ? c.text   : '#6b7280';
    btn.style.fontWeight   = s === stars ? '700' : '600';
  });
}

function _archNewTagKeydown(e, type) {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault();
  const input = e.target;
  const val = (input.value || '').replace(/,/g,'').trim();
  if (val) _archNewAddTag(type, val);
  input.value = '';
}

function _archNewAddTag(type, val) {
  const v = (val || '').trim();
  if (!v) return;
  const hiddenId = type === 'kw' ? 'arch-new-kw-hidden' : 'arch-new-reason-hidden';
  const hiddenEl = document.getElementById(hiddenId);
  let arr = [];
  try { arr = JSON.parse(hiddenEl.value || '[]'); } catch(e) { arr = []; }
  if (arr.includes(v)) return;
  arr.push(v);
  hiddenEl.value = JSON.stringify(arr);
  _archNewRenderTags(type, arr);
}

function _archNewRemoveTag(type, idx) {
  const hiddenId = type === 'kw' ? 'arch-new-kw-hidden' : 'arch-new-reason-hidden';
  const hiddenEl = document.getElementById(hiddenId);
  let arr = [];
  try { arr = JSON.parse(hiddenEl.value || '[]'); } catch(e) { arr = []; }
  arr.splice(idx, 1);
  hiddenEl.value = JSON.stringify(arr);
  _archNewRenderTags(type, arr);
}

function _archNewRenderTags(type, arr) {
  const contId = type === 'kw' ? 'arch-new-kw-tags' : 'arch-new-reason-tags';
  const cont = document.getElementById(contId);
  if (!cont) return;
  const isKw = type === 'kw';
  const style = isKw
    ? 'background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe'
    : 'background:#fff7ed;color:#ea580c;border:1px solid #fed7aa';
  cont.innerHTML = arr.map((t, i) =>
    `<span style="${style};border-radius:12px;padding:4px 8px 4px 10px;font-size:11px;font-weight:600;
            display:inline-flex;align-items:center;gap:4px">
       ${Utils.escHtml(t)}
       <button onclick="_archNewRemoveTag('${type}',${i})"
         style="background:none;border:none;cursor:pointer;font-size:13px;line-height:1;padding:0 2px;
                color:inherit;opacity:.7" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.7">×</button>
     </span>`
  ).join('');
}

function _archNewAddLaw() {
  const nameEl    = document.getElementById('arch-new-law-name-input');
  const articleEl = document.getElementById('arch-new-law-article-input');
  const hiddenEl  = document.getElementById('arch-new-law-hidden');
  const name    = (nameEl?.value || '').trim();
  const article = (articleEl?.value || '').trim();
  if (!name) { Toast.warning('법령명을 입력하세요.'); return; }
  let arr = [];
  try { arr = JSON.parse(hiddenEl.value || '[]'); } catch(e) { arr = []; }
  if (arr.find(l => l.law === name && l.article === article)) return;
  arr.push({ law: name, article });
  hiddenEl.value = JSON.stringify(arr);
  if (articleEl) articleEl.value = '';
  _archNewRenderLaws(arr);
}

function _archNewRemoveLaw(idx) {
  const hiddenEl = document.getElementById('arch-new-law-hidden');
  let arr = [];
  try { arr = JSON.parse(hiddenEl.value || '[]'); } catch(e) { arr = []; }
  arr.splice(idx, 1);
  hiddenEl.value = JSON.stringify(arr);
  _archNewRenderLaws(arr);
}

function _archNewRenderLaws(arr) {
  const cont = document.getElementById('arch-new-law-tags');
  if (!cont) return;
  cont.innerHTML = arr.map((l, i) => {
    const label = l.law + (l.article ? ' ' + l.article : '');
    return `<span style="background:#f5f3ff;color:#6d28d9;border:1px solid #ddd6fe;border-radius:12px;
                  padding:4px 8px 4px 10px;font-size:11px;font-weight:600;
                  display:inline-flex;align-items:center;gap:4px">
              <i class="fas fa-gavel" style="font-size:9px;opacity:.8"></i>
              ${Utils.escHtml(label)}
              <button onclick="_archNewRemoveLaw(${i})"
                style="background:none;border:none;cursor:pointer;font-size:13px;line-height:1;
                       padding:0 2px;color:inherit;opacity:.7"
                onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.7">×</button>
            </span>`;
  }).join('');
}
// ─────────────────────────────────────────────
//  자료 삭제
// ─────────────────────────────────────────────
async function deleteArchive(refId) {
  const _session = Session.get();
  if (!_session || (_session.role !== 'admin' && _session.role !== 'director')) {
    Toast.warning('삭제 권한이 없습니다. 관리자 또는 사업부장만 삭제할 수 있습니다.');
    return;
  }

  const ok1 = await Confirm.show({
    icon: '🗑️', title: '자문 자료 삭제',
    desc: '이 자문 자료를 삭제하시겠습니까?<br><span style="color:#ef4444;font-weight:600">삭제 후 복구할 수 없습니다.</span>',
    confirmText: '삭제', confirmClass: 'btn-danger'
  });
  if (!ok1) return;

  const ok2 = await Confirm.show({
    icon: '⚠️', title: '최종 확인',
    desc: '정말로 삭제하시겠습니까?<br>이 작업은 <strong>되돌릴 수 없습니다.</strong>',
    confirmText: '최종 삭제', confirmClass: 'btn-danger'
  });
  if (!ok2) return;

  try {
    await API.patch('mail_references', refId, {
      status: 'hidden', deleted_by: _session.name, deleted_at: Date.now()
    });
    Cache.invalidate('ref_search_index_list');
    closeModal('archiveDetailModal');
    Toast.success('자료가 삭제되었습니다.');
    loadArchiveList();
  } catch(e) {
    Toast.error('삭제 중 오류가 발생했습니다.');
  }
}

// ─────────────────────────────────────────────
//  파일 텍스트 추출
// ─────────────────────────────────────────────
async function _extractFileText(file, obj) {
  const type = obj.fileType;
  try {
    if (type === 'word') {
      obj.extractStatus = 'pending';
      const ab = await file.arrayBuffer();
      if (typeof mammoth === 'undefined') await LibLoader.load('mammoth');
      const result = await mammoth.extractRawText({arrayBuffer: ab});
      obj.extractedText = result.value || '';
      obj.extractStatus = obj.extractedText ? 'success' : 'partial';
    } else if (type === 'pdf') {
      obj.extractStatus = 'pending';
      const ab = await file.arrayBuffer();
      if (typeof pdfjsLib === 'undefined') await LibLoader.load('pdfjs');
      const pdf = await pdfjsLib.getDocument({data: new Uint8Array(ab)}).promise;
      obj.pageCount = pdf.numPages;
      let text = '';
      for (let p = 1; p <= Math.min(pdf.numPages, 30); p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        text += content.items.map(i => i.str).join(' ') + '\n';
      }
      obj.extractedText = text.trim();
      obj.extractStatus = obj.extractedText ? 'success' : 'partial';
    } else if (type === 'excel') {
      const ab = await file.arrayBuffer();
      if (typeof XLSX === 'undefined') await LibLoader.load('xlsx');
      const wb = XLSX.read(ab, {type:'array'});
      let text = '';
      wb.SheetNames.forEach(sn => {
        const ws = wb.Sheets[sn];
        const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
        text += `[${sn}]\n` + rows.map(r => r.join('\t')).join('\n') + '\n\n';
      });
      obj.extractedText = text.trim();
      obj.extractStatus = obj.extractedText ? 'success' : 'partial';
    } else if (type === 'eml') {
      const text = await file.text();
      obj.extractedText = _parseEml(text);
      obj.extractStatus = obj.extractedText ? 'success' : 'partial';
    } else if (type === 'txt') {
      obj.extractedText = await file.text();
      obj.extractStatus = obj.extractedText ? 'success' : 'partial';
    } else {
      obj.extractStatus = 'failed';
    }
    obj.content = await _fileToBase64(file);
  } catch(e) {
    console.warn('_extractFileText error', e);
    obj.extractStatus = 'failed';
    try { obj.content = await _fileToBase64(file); } catch(e2) {}
  }
}

function _parseEml(text) {
  const lines = text.split(/\r?\n/);
  let inBody = false, body = [];
  const headers = {};
  for (const line of lines) {
    if (!inBody && line === '') { inBody = true; continue; }
    if (!inBody) {
      const m = line.match(/^([\w-]+):\s*(.*)/i);
      if (m) headers[m[1].toLowerCase()] = m[2];
    } else {
      body.push(line);
    }
  }
  const headerStr = ['Subject','From','To','Date'].map(k => headers[k.toLowerCase()] ? `${k}: ${headers[k.toLowerCase()]}` : '').filter(Boolean).join('\n');
  return headerStr + '\n\n' + body.join('\n');
}

async function _extractPdfTextFromBase64(base64DataUrl) {
  try {
    const base64 = base64DataUrl.includes(',') ? base64DataUrl.split(',')[1] : base64DataUrl;
    const binary  = atob(base64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (typeof pdfjsLib === 'undefined') await LibLoader.load('pdfjs');
    const pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF.js not loaded');
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    let fullText = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }
    return { text: fullText.trim(), pageCount: pdf.numPages };
  } catch(e) {
    return { text: '', pageCount: 0 };
  }
}

async function _saveDocText(refId, entryId, fileObj, order) {
  const payload = {
    ref_id: refId, entry_id: entryId || '',
    file_name: fileObj.fileName, file_type: fileObj.fileType,
    file_size: fileObj.fileSize, file_content: fileObj.content || '',
    extracted_text: fileObj.extractedText || '', page_count: fileObj.pageCount || 0,
    extract_method: _detectExtractMethod(fileObj.fileType),
    extract_status: fileObj.extractStatus || 'pending',
    sort_order: order, doc_type: fileObj.docType || 'normal'
  };
  return await API.create('doc_texts', payload);
}

// ─────────────────────────────────────────────
//  검색 인덱스 업데이트
// ─────────────────────────────────────────────
async function _updateSearchIndex(refId) {
  try {
    const [ref, docsResp] = await Promise.all([
      API.get('mail_references', refId),
      API.list('doc_texts', { limit: 50 })
    ]);
    const docs = (docsResp.data || []).filter(d => d.ref_id === refId);
    const allText = [
      ref.subject, ref.body_text, ref.tags, ref.summary,
      ...docs.map(d => d.extracted_text)
    ].filter(Boolean).join(' ');
    const keywords = _extractKeywords(allText, 20);

    const indexPayload = {
      ref_id: refId,
      full_text: allText.substring(0, 5000),
      tfidf_keywords: JSON.stringify(keywords),
      word_count: allText.split(/\s+/).filter(Boolean).length,
      indexed_at: new Date().toISOString()
    };

    const idxResp = await API.list('ref_search_index', { search: refId, limit: 50 });
    const existingList = (idxResp.data || []).filter(r => r.ref_id === refId);

    if (existingList.length > 0) {
      await API.patch('ref_search_index', existingList[0].id, indexPayload);
      if (existingList.length > 1) {
        const deletePromises = existingList.slice(1).map(r =>
          API.delete('ref_search_index', r.id).catch(() => {})
        );
        await Promise.all(deletePromises);
      }
    } else {
      await API.create('ref_search_index', indexPayload);
    }

    await API.patch('mail_references', refId, { keywords: keywords.join(', ') });
  } catch(e) { console.warn('_updateSearchIndex error', e); }
}

// ─────────────────────────────────────────────
//  승인 + 자료 저장 (approval.js와 연동)
// ─────────────────────────────────────────────
function openArchiveSaveModal(entryId, prefillData) {
  document.getElementById('archiveSave-entry-id').value = entryId || '';
  document.getElementById('archiveSave-subject').value = prefillData?.subject || '';
  document.getElementById('archiveSave-summary').value = prefillData?.summary || '';
  document.getElementById('archiveSave-tags').value = prefillData?.tags || '';
  document.getElementById('archiveSave-is-template').checked = false;
  openModal('archiveSaveModal');
}

async function processApprovalWithArchive() {
  const session = Session.get();
  if (!session) return;
  const entryId = document.getElementById('archiveSave-entry-id')?.value;
  const subject = document.getElementById('archiveSave-subject')?.value.trim();
  const summary = document.getElementById('archiveSave-summary')?.value.trim();
  if (!subject) { Toast.warning('제목을 입력하세요.'); return; }
  if (!summary) { Toast.warning('요약을 입력하세요.'); return; }

  const saveBtn   = document.getElementById('archiveSaveProceedBtn')
                 || document.querySelector('#archiveSaveModal .btn-warning');
  const cancelBtn = document.querySelector('#archiveSaveModal .btn-ghost');
  const restoreBtn    = BtnLoading.start(saveBtn, '승인 + 저장 중...');
  const restoreCancel = BtnLoading.disableAll(cancelBtn);

  try {
    if (entryId) {
      const dupCheck = await API.list('mail_references', { limit: 500 });
      const alreadySaved = (dupCheck.data || []).find(
        r => r.entry_id === entryId && r.status !== 'hidden'
      );
      if (alreadySaved) {
        restoreBtn(); restoreCancel();
        closeModal('archiveSaveModal');
        Toast.warning('이미 자료실에 저장된 업무기록입니다. (중복 저장 방지)');
        await API.patch('time_entries', entryId, {
          status: 'approved', reviewer_id: session.id, reviewer_name: session.name,
          reviewed_at: new Date().toISOString(), is_archived: true
        });
        closeModal('approvalModal');
        if (typeof loadApprovalList === 'function') loadApprovalList();
        const _s = Session.get();
        if (typeof updateApprovalBadge === 'function' && _s) updateApprovalBadge(_s);
        return;
      }
    }

    if (entryId) {
      await API.patch('time_entries', entryId, {
        status: 'approved', reviewer_id: session.id, reviewer_name: session.name,
        reviewed_at: new Date().toISOString(), is_archived: true
      });
    }

    let entryData = null, attachmentDocs = [];
    if (entryId) {
      try { entryData = await API.get('time_entries', entryId); } catch(e) {}
      try {
        const attResp = await API.list('attachments', {limit:200});
        attachmentDocs = (attResp.data||[]).filter(a => a.entry_id === entryId);
      } catch(e) {}
    }

    const tags = document.getElementById('archiveSave-tags')?.value.trim() || '';
    const isTemplate = document.getElementById('archiveSave-is-template')?.checked || false;
    const sentAtMs  = entryData?.work_start_at ? new Date(Number(entryData.work_start_at)).toISOString().substring(0,10) : '';
    const keywords = _extractKeywords([summary, tags].join(' '), 15).join(', ');
    const refPayload = {
      entry_id: entryId || '', subject, body_text: '',
      sender_name: entryData?.user_name || session.name, sender_email: entryData?.sender_email || '',
      sent_at: sentAtMs, client_id: entryData?.client_id || '', client_name: entryData?.client_name || '',
      work_category: entryData?.work_category_name || '', work_subcategory: entryData?.work_subcategory_name || '',
      tags, keywords, summary, archive_note: '', is_template: isTemplate,
      source_type: 'approval', registered_by_id: entryData?.user_id || '',
      registered_by_name: entryData?.user_name || '', archived_by_id: session.id,
      archived_by_name: session.name, archived_at: new Date().toISOString(),
      view_count: 0, helpful_count: 0, status: 'active'
    };
    const ref = await API.create('mail_references', refPayload);

    for (const [i, att] of attachmentDocs.entries()) {
      const fileType = att.file_type || 'other';
      const content  = att.file_content || '';
      let extractedText = '', extractStatus = 'pending', pageCount = 0;

      if (fileType === 'pdf' && content) {
        try {
          const result = await _extractPdfTextFromBase64(content);
          extractedText = result.text;
          pageCount     = result.pageCount;
          extractStatus = extractedText ? 'success' : 'failed';
        } catch(e) { extractStatus = 'failed'; }
      }

      const fileObj = {
        fileName: att.file_name || att.file_url || '첨부파일', fileType,
        fileSize: att.file_size || 0, content, extractedText, extractStatus, pageCount
      };
      await _saveDocText(ref.id, entryId, fileObj, i);
    }

    await _updateSearchIndex(ref.id);

    Cache.invalidate('time_entries_list');
    Cache.invalidate('doc_texts_list');
    Cache.invalidate('ref_search_index_list');
    const _sessBadge = Session.get();
    if (_sessBadge) Cache.invalidate('time_entries_badge_' + _sessBadge.id);

    closeModal('archiveSaveModal');
    closeModal('approvalModal');
    Toast.success('승인 완료 + 자료실에 저장되었습니다. 🎉');

    if (typeof loadApprovalList === 'function') loadApprovalList();
    const _sess = Session.get();
    if (typeof updateApprovalBadge === 'function' && _sess) updateApprovalBadge(_sess, true);

    const archivePage = document.getElementById('page-archive');
    if (archivePage && archivePage.classList.contains('active')) {
      await loadArchiveList();
    } else {
      window._archiveNeedsRefresh = true;
    }
    restoreBtn(); restoreCancel();
  } catch(e) {
    restoreBtn(); restoreCancel();
    console.error('processApprovalWithArchive error', e);
    Toast.error('처리 중 오류가 발생했습니다.');
  }
}

// ─────────────────────────────────────────────
//  유틸리티
// ─────────────────────────────────────────────
function _detectFileType(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')||name.endsWith('.doc')) return 'word';
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.xlsx')||name.endsWith('.xls')) return 'excel';
  if (name.endsWith('.pptx')||name.endsWith('.ppt')) return 'ppt';
  if (name.endsWith('.eml')) return 'eml';
  if (name.endsWith('.txt')) return 'txt';
  return 'other';
}

function _detectExtractMethod(fileType) {
  const map = { word:'mammoth', pdf:'pdfjs', excel:'sheetjs', eml:'eml_parse', txt:'manual' };
  return map[fileType] || 'none';
}

function _fileTypeIcon(fileType) {
  const icons = {
    word: '<i class="fas fa-file-word" style="color:#2563eb"></i>',
    pdf:  '<i class="fas fa-file-pdf" style="color:#dc2626"></i>',
    excel:'<i class="fas fa-file-excel" style="color:#16a34a"></i>',
    ppt:  '<i class="fas fa-file-powerpoint" style="color:#ea580c"></i>',
    eml:  '<i class="fas fa-envelope" style="color:#7c3aed"></i>',
    txt:  '<i class="fas fa-file-alt" style="color:#6b7280"></i>',
    link: '<i class="fas fa-link" style="color:#0ea5e9"></i>',
    other:'<i class="fas fa-file" style="color:#9ca3af"></i>'
  };
  return icons[fileType] || icons.other;
}

function _extractStatusLabel(status) {
  const map = {
    success: '<span style="color:#15803d"><i class="fas fa-check-circle"></i> 추출 완료</span>',
    partial: '<span style="color:#d97706"><i class="fas fa-exclamation-circle"></i> 부분 추출</span>',
    failed:  '<span style="color:#dc2626"><i class="fas fa-times-circle"></i> 추출 불가</span>',
    pending: '<span style="color:#6b7280"><i class="fas fa-spinner fa-spin"></i> 추출 중...</span>'
  };
  return map[status] || map.pending;
}

async function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _extractKeywords(text, topN = 15) {
  if (!text) return [];
  const stopwords = new Set(['이','가','을','를','의','에','은','는','과','와','도','로','으로','에서','하다','하고','있다','이다','그','그리고','또','또한','및','등','이후','이전','부터','까지','위해','대해','관해','있는','없는','위한','대한','관련','경우','방법','통해','해당','대상','이상','이하','대비','동안','기준','따라','의한','만약','그러나','따라서','때문에','그래서','그런데','하지만','바로','더','못','안','왜','어떤','어떻게','무엇','언제','어디','어느','우리','여기','저기','이것','그것','저것','아','오','오늘','내일','어제','항상','자주','가끔','이번','다음','지난','올','새']);
  const words = text.replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
  const freq = {};
  words.forEach(w => {
    const lw = w.toLowerCase();
    if (!stopwords.has(lw)) freq[lw] = (freq[lw]||0) + 1;
  });
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,topN).map(e=>e[0]);
}

function downloadBase64File(dataUrl, fileName) {
  if (!dataUrl) { Toast.warning('파일 데이터가 없습니다.'); return; }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName || 'file';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
