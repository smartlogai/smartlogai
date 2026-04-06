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

// PDF.js worker 경로 설정은 LibLoader.load('pdfjs') 에서 자동 처리됨

// ─────────────────────────────────────────────
//  업무분류별 예시 태그
// ─────────────────────────────────────────────
const _ARCH_EXAMPLE_KW = {
  '': ['거래가격', '품목분류', '수출허가', 'FTA', '환급신청', '요건확인'],  // 전체
  '품목분류 자문': ['HS코드 분류', '품목번호', '유권해석', '재질성분', '기능용도', '결합물품', '세트물품', 'GRI원칙'],
  '과세가격 자문': ['권리사용료 가산여부', '특수관계 거래가격 인정여부', '경영지원비 가산여부', '로열티 가산여부', '수수료 공제여부'],
  'FTA 자문': ['원산지기준', '실질변형', '부가가치기준', '세번변경', '불인정공정', '직접운송', '원산지확인서'],
  '전략물자 자문': ['전략물자 해당여부', '상황허가 대상여부', '이중용도품목 수출통제', '캐치올 규정 적용여부'],
  'FTA 자문': ['원산지증명서 유효여부', '사후검증 대응방안', '누적조항 적용여부', '직접운송원칙 충족여부', '원산지소급적용 가능여부', 'CTH기준 충족여부'],
  '관세환급 자문': ['개별환급 적용가능 여부', '소요량 산정기준', '환급기한 기산점', '분할증명 가능여부', '간이정액환급 적용여부'],
  '요건대상 자문': ['의료기기 요건대상 여부', '식품 검역대상 여부', '화학물질 등록대상 여부', '안전인증 면제여부', '전파인증 대상여부'],
};
const _ARCH_EXAMPLE_REASON = {
  '': ['거래조건성불충족', '세번변경기준충족', '원산지기준충족', '수출허가대상해당'],  // 전체
  '품목분류 자문': ['용도기준적용', '재질기준적용', '결합기준적용', '완성품분류원칙', 'GRI적용', '관세율표해석통칙'],
  '과세가격 자문': ['거래조건성불충족', '처분제한조건', '권리사용료포함', '특수관계영향', '공제방법선택', '역산가격적용'],
  'FTA 자문': ['세번변경기준충족', '부가가치기준미충족', '불인정공정해당', '직접운송불충족', '원산지기준충족'],
  '전략물자 자문': ['수출허가대상해당', '허가예외적용', '이중용도해당', 'EAR적용', '전략물자해당없음'],
  'FTA 자문': ['원산지기준충족', '원산지증명서유효', '검증결과불인정', '누적기준적용', '환급제한적용', '사후검증대상'],
  '관세환급 자문': ['소요량기준충족', '환급대상해당', '직접환급가능', '간이환급적용', '분할환급적용'],
  '요건대상 자문': ['요건확인필요', '허가취득필요', '검역증명필요', '안전인증미취득', '면제해당'],
};

// ─────────────────────────────────────────────
//  페이지 초기화
// ─────────────────────────────────────────────
async function init_archive() {
  const session = Session.get();
  if (!session) { navigateTo('dashboard'); return; }

  // 태그 상태 초기화
  _archKwTags = []; _archReasonTags = []; _archLawTags = [];
  _archRenderTagUi();

  // 업무분류 드롭다운 DB 동적 로드
  await _fillArchiveBusinessFilter();

  _archUpdateExampleTags();


  await loadArchiveList();

  // ★ [문제3] 비활성 탭에서 승인+저장 후 진입 시 자동 갱신
  if (window._archiveNeedsRefresh) {
    window._archiveNeedsRefresh = false;
    await loadArchiveList();
  }
}

// ─────────────────────────────────────────────
//  태그 UI 유틸리티
// ─────────────────────────────────────────────
async function _fillArchiveBusinessFilter() {
  const sel = document.getElementById('archive-filter-business');
  if (!sel) return;
  try {
    const cats = await Master.categories();
    const target = cats.find(c => c.category_name === '일반자문업무');
    if (!target) return;
    const subs = await Master.subcategories();
    const filtered = subs
      .filter(s => s.category_id === target.id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    if (!filtered.length) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">전체</option>';
    filtered.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.sub_category_name;
      opt.textContent = s.sub_category_name;
      sel.appendChild(opt);
    });
    if (currentVal) sel.value = currentVal;
  } catch (e) { console.error('[archive] 드롭다운 실패:', e.message); }
}

/** 태그 추가 (type: 'kw' | 'reason') */
function _archAddTag(type, val) {
  const v = (val || '').trim();
  if (!v) return;
  if (type === 'kw')     { if (!_archKwTags.includes(v))     _archKwTags.push(v); }
  if (type === 'reason') { if (!_archReasonTags.includes(v)) _archReasonTags.push(v); }
  _archRenderTagUi();
}

/** 법령 태그 추가 */
function _archAddLaw() {
  const name    = (document.getElementById('arch-law-name')?.value || '').trim();
  const article = (document.getElementById('arch-law-article')?.value || '').trim();
  if (!name) { return; }
  const key = name + (article ? ' ' + article : '');
  if (!_archLawTags.find(t => t.name === name && t.article === article)) {
    _archLawTags.push({ name, article });
  }
  if (document.getElementById('arch-law-article')) document.getElementById('arch-law-article').value = '';
  _archRenderTagUi();
}

/** 태그 제거 */
function _archRemoveTag(type, idx) {
  if (type === 'kw')     _archKwTags.splice(idx, 1);
  if (type === 'reason') _archReasonTags.splice(idx, 1);
  if (type === 'law')    _archLawTags.splice(idx, 1);
  _archRenderTagUi();
}

/** 태그 UI 렌더링 (v20260401h) */
function _archRenderTagUi() {
  const kwCont     = document.getElementById('arch-kw-tags');
  const reasonCont = document.getElementById('arch-reason-tags');
  const lawCont    = document.getElementById('arch-law-tags');

  // 핵심키워드 태그: 파란색 배경, X 버튼
  if (kwCont) kwCont.innerHTML = _archKwTags.map((t, i) =>
    `<span class="arch-sel-tag" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:12px;padding:4px 8px 4px 10px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;white-space:nowrap">${Utils.escHtml(t)}<button onclick="_archRemoveTag('kw',${i})" class="arch-sel-tag-rm" title="제거" style="background:none;border:none;cursor:pointer;color:#1d4ed8;opacity:.7;font-size:13px;line-height:1;padding:0 2px;display:inline-flex;align-items:center" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.7">×</button></span>`
  ).join('');

  // 판단사유 태그: 초록색 배경, X 버튼
  if (reasonCont) reasonCont.innerHTML = _archReasonTags.map((t, i) =>
    `<span class="arch-sel-tag arch-sel-tag--green" style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;border-radius:12px;padding:4px 8px 4px 10px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;white-space:nowrap">${Utils.escHtml(t)}<button onclick="_archRemoveTag('reason',${i})" class="arch-sel-tag-rm" title="제거" style="background:none;border:none;cursor:pointer;color:#15803d;opacity:.7;font-size:13px;line-height:1;padding:0 2px;display:inline-flex;align-items:center" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.7">×</button></span>`
  ).join('');

  // 관련법령 태그: 황색 배경, X 버튼
  if (lawCont) lawCont.innerHTML = _archLawTags.map((t, i) => {
    const label = t.name + (t.article ? ' ' + t.article : '');
    return `<span class="arch-sel-tag arch-sel-tag--amber" style="background:#fffbeb;color:#92400e;border:1px solid #fde68a;border-radius:12px;padding:4px 8px 4px 10px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;white-space:nowrap"><i class="fas fa-gavel" style="font-size:9px;margin-right:2px;opacity:.8"></i>${Utils.escHtml(label)}<button onclick="_archRemoveTag('law',${i})" class="arch-sel-tag-rm" title="제거" style="background:none;border:none;cursor:pointer;color:#92400e;opacity:.7;font-size:13px;line-height:1;padding:0 2px;display:inline-flex;align-items:center" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=.7">×</button></span>`;
  }).join('');
}

/** 예시 태그 업데이트 (업무분류 변경 시) */
function _archUpdateExampleTags() {
  const biz = document.getElementById('archive-filter-business')?.value || '';

  // 키에 해당하는 예시 배열 (없으면 전체 배열 사용)
  const kwEx     = _ARCH_EXAMPLE_KW[biz]     ?? _ARCH_EXAMPLE_KW['']     ?? [];
  const reasonEx = _ARCH_EXAMPLE_REASON[biz] ?? _ARCH_EXAMPLE_REASON[''] ?? [];

  const kwCont     = document.getElementById('arch-kw-examples');
  const reasonCont = document.getElementById('arch-reason-examples');
  const kwArea     = document.getElementById('arch-kw-example-area');

  // 예시 태그 렌더링 (이미 선택된 태그는 --used 처리)
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

  // ── 판단사유 · 핵심키워드 input placeholder 동적 변경 ──
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

  // 예시 영역 표시/숨김
  if (kwArea) kwArea.style.display = kwEx.length ? 'flex' : 'none';
}

/** 예시 태그 클릭 핸들러 */
function _archClickExTag(type, val, btn) {
  _archAddTag(type, val);
  if (btn) {
    btn.classList.add('arch-ex-tag--used');
    if (type === 'reason') btn.classList.add('arch-ex-tag--green');
  }
}

// ─────────────────────────────────────────────
//  호환성 유지용 필터 select 채우기 (숨겨진 select 지원)
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
/** archSearch: UI의 모든 필터를 읽어 검색 수행 (버튼/Enter 공통 엔트리포인트) */
async function archSearch() {
  await loadArchiveList();
}

// ─────────────────────────────────────────────
//  자료 목록 로드 (전면 재구성 v20260401f)
// ─────────────────────────────────────────────
async function loadArchiveList() {
  // ── 검색 조건 수집 ──
  const keyword      = (document.getElementById('archive-search-input')?.value || '').trim().toLowerCase();
  const bizFilter    = document.getElementById('archive-filter-business')?.value || '';
  const starsFilter  = document.getElementById('archive-filter-stars')?.value    || '';
  const dateFrom     = document.getElementById('archive-filter-date-from')?.value || '';
  const dateTo       = document.getElementById('archive-filter-date-to')?.value   || '';
  const sortMode     = document.getElementById('archive-sort-select')?.value || 'newest';

  // 태그 필터
  const kwTags     = [..._archKwTags];
  const reasonTags = [..._archReasonTags];
  const lawTags    = [..._archLawTags];

  // 날짜 범위 → ms 변환
  const tsFrom = dateFrom ? new Date(dateFrom).getTime()              : null;
  const tsTo   = dateTo   ? new Date(dateTo + 'T23:59:59').getTime()  : null;

  try {
    // ── mail_references + time_entries 병렬 로드 ──
    const [refResp, entryResp] = await Promise.all([
      API.list('mail_references', { limit: 10000 }),
      API.list('time_entries',    { limit: 10000 })
    ]);

    // entry_id → entry 맵
    const entryMap = {};
    (entryResp.data || []).forEach(e => { entryMap[e.id] = e; });

    // hidden 제외, 미승인(is_archived=false인 entry 연결) 제외
    let rows = (refResp.data || []).filter(r => {
      if (r.status === 'hidden') return false;
      // source_type='approval'이면 entry_id가 있어야 함
      if (r.source_type === 'approval' && r.entry_id) {
        const ent = entryMap[r.entry_id];
        // entry가 없거나 is_archived=false면 제외
        if (!ent || !ent.is_archived) return false;
      }
      return true;
    });

    // entry 정보 병합 (kw_query, kw_reason, law_refs, work_subcategory_name, quality_stars)
    rows = rows.map(r => {
      const ent = r.entry_id ? entryMap[r.entry_id] : null;
      return { ...r, _entry: ent };
    });

    // ── 업무분류 필터 (즉시 적용) ──
    if (bizFilter) {
      rows = rows.filter(r => {
        const wsc = r._entry?.work_subcategory_name || r.work_subcategory || '';
        return wsc === bizFilter || (r._entry?.work_subcategory_name || '').includes(bizFilter);
      });
    }

    // ── 평가등급 필터 ──
    if (starsFilter) {
      rows = rows.filter(r => {
        const stars = r._entry?.quality_stars ?? r.quality_stars;
        return String(stars) === starsFilter;
      });
    }

    // ── 날짜 범위 ──
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

    // ── 핵심키워드 태그 필터 (AND) ──
    // r._entry가 있으면(승인저장) entry에서, 없으면(직접등록) r에서 직접 읽음
    if (kwTags.length) {
      rows = rows.filter(r => {
        const entKw = _parseArr(r._entry?.kw_query ?? r.kw_query);
        const refKw = _parseArr(r.keywords);
        const all = [...entKw, ...refKw].map(k => k.toLowerCase());
        return kwTags.every(tag => all.some(k => k.includes(tag.toLowerCase())));
      });
    }

    // ── 판단사유 태그 필터 (AND) ──
    if (reasonTags.length) {
      rows = rows.filter(r => {
        const entReason = _parseArr(r._entry?.kw_reason ?? r.kw_reason);
        const all = entReason.map(k => k.toLowerCase());
        return reasonTags.every(tag => all.some(k => k.includes(tag.toLowerCase())));
      });
    }

    // ── 관련법령 필터 (AND, JSONB 배열 또는 쉼표 문자열) ──
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

    // ── 통합 키워드 검색 ──
    // r._entry가 있으면(승인저장) entry에서, 없으면(직접등록) r에서 직접 읽음
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

    // 활성 필터 배지 업데이트
    _updateActiveFilterBadge(keyword, bizFilter, starsFilter, dateFrom, dateTo, kwTags, reasonTags, lawTags);

    // ── 정렬 ──
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

    // KPI
    _renderArchiveKpi(rows);

    // 카운트
    const badge = document.getElementById('archive-count-badge');
    if (badge) badge.textContent = `총 ${rows.length}건`;

    // 목록 렌더링 (카드형)
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

    // 페이지네이션
    const pg = document.getElementById('archive-pagination');
    if (pg) pg.innerHTML = Utils.paginationHTML(_archivePage, Math.ceil(_archiveTotal/_archiveLimit), 'changeArchivePage');

  } catch(e) {
    console.error('loadArchiveList error', e);
    Toast.error('자료 목록을 불러오는 중 오류가 발생했습니다.');
  }
}

/** JSON 배열 또는 쉼표 문자열 → 배열 파싱 헬퍼 */
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
//  카드 HTML 빌더 (신규 디자인)
// ─────────────────────────────────────────────
function _buildArchCard(r, keyword, kwTags) {
  const ent = r._entry;

  // ── 업무분류 (제목용) ──
  const bizName = ent?.work_subcategory_name || r.work_subcategory || '';

  // ── 평가등급 배지 (우측 상단) ──
  const stars = parseInt(ent?.quality_stars ?? r.quality_stars) || 0;
  const starLabels = { 1: 'C 참고', 2: 'B 우수', 3: 'A 매우우수' };
  const starColors = { 1: '#6b7280', 2: '#2563eb', 3: '#d97706' };
  const starBadge = stars > 0
    ? `<span class="arch-star-badge" style="color:${starColors[stars]};border-color:${starColors[stars]}40;background:${starColors[stars]}12;margin-left:auto;flex-shrink:0;">
         ${'★'.repeat(stars)}${'☆'.repeat(3-stars)} ${starLabels[stars]||''}
       </span>` : '';

  // ── 제목: 업무분류만 표시 (고객사명 제외) ──
  // r.subject에 "(고객사명)" 형태가 포함된 경우 제거
  // bizName에 '자문'이 이미 포함된 경우 중복 방지
  const titleRaw = (bizName
    ? (bizName.includes('자문') ? bizName : bizName + ' 자문')
    : (r.subject ? r.subject.replace(/\s*\([^)]*\)\s*$/, '').trim() : '(제목 없음)'));
  const titleDisp = Utils.escHtml(titleRaw.length > 60 ? titleRaw.substring(0,60)+'…' : titleRaw);

  // ── 핵심키워드 태그 (승인저장: entry에서, 직접등록: r에서 직접 읽음) ──
  const kwArr = _parseArr(ent?.kw_query ?? r.kw_query);
  const searchKws = kwTags || [];
  const kwDisplay = searchKws.length > 0
    ? kwArr.filter(k => searchKws.some(s => k.toLowerCase().includes(s.toLowerCase()))).slice(0,5)
    : kwArr.slice(0,5);
  const kwHtml = kwDisplay.length
    ? kwDisplay.map(k => `<span class="arch-card-kw-tag">${Utils.escHtml(k)}</span>`).join('')
      + (kwArr.length > kwDisplay.length ? `<span class="arch-card-kw-more">+${kwArr.length - kwDisplay.length}</span>` : '')
    : '';

  // ── 판단사유 태그 (승인저장: entry에서, 직접등록: r에서 직접 읽음) ──
  const reasonArr = _parseArr(ent?.kw_reason ?? r.kw_reason);
  const searchReasons = _archReasonTags || [];
  const reasonDisplay = searchReasons.length > 0
    ? reasonArr.filter(k => searchReasons.some(s => k.toLowerCase().includes(s.toLowerCase()))).slice(0,3)
    : [];
  const reasonHtml = reasonDisplay.length
    ? reasonDisplay.map(k => `<span class="arch-card-reason-tag">${Utils.escHtml(k)}</span>`).join('')
    : '';

  // ── 관련법령 태그 (승인저장: entry에서, 직접등록: r에서 직접 읽음) ──
  const lawRawArr = _parseArr(ent?.law_refs ?? r.law_refs);
  const lawDisplay = lawRawArr.slice(0, 3).map(l => {
    if (typeof l === 'object') {
      // entry.js는 { law, article } 형태로 저장, archive.js는 { name, article } 형태 병존 대응
      const name    = l.name || l.law || '';
      const article = l.article || '';
      return article ? `${name} ${article}`.trim() : name;
    }
    return String(l);
  }).filter(Boolean);
  // 법령 태그: 키워드 태그와 같은 줄에 배치 → 연보라 계열로 구분
  const lawHtml = lawDisplay.length
    ? lawDisplay.map(l => `<span class="arch-card-kw-tag" style="background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe">
        <i class="fas fa-gavel" style="font-size:9px;margin-right:2px;opacity:.75"></i>${Utils.escHtml(l)}</span>`).join('')
    : '';

  // ── 본문 미리보기 ──
  // 검색 키워드가 있으면 해당 키워드 주변 문장 발췌, 없으면 앞 50자
  const _rawBody = (ent?.work_description || r.work_description || r.summary || r.body_text || '');
  const bodyRaw = _rawBody
    .replace(/<!--[\s\S]*?-->/g, '')          // HTML 주석 제거 (Word 조건부 주석 포함)
    .replace(/<xml[\s\S]*?<\/xml>/gi, '')     // <xml> 블록 제거
    .replace(/<[^>]+>/g, '')                   // 나머지 HTML 태그 제거
    .replace(/Normal\s+\d+\s+\d+\s+\d+\s+(false|true)\s+(false|true)\s+(false|true)[^\n]*/gi, '') // Word 메타 텍스트 제거
    .replace(/\s+/g, ' ')
    .trim();
  let previewHtml = '';
  if (bodyRaw) {
    let snippet = '';
    const kw = (keyword || '').trim().toLowerCase();
    if (kw) {
      // 키워드 위치 찾아서 앞뒤 60자 발췌
      const idx = bodyRaw.toLowerCase().indexOf(kw);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end   = Math.min(bodyRaw.length, idx + kw.length + 60);
        const raw   = (start > 0 ? '…' : '') + bodyRaw.slice(start, end) + (end < bodyRaw.length ? '…' : '');
        // 키워드 하이라이트
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

  // ── 날짜 / 작성자 / 출처 구분 ──
  const dateStr     = Utils.formatDate(r.sent_at || r.created_at || Date.now());
  const isManual    = r.source_type === 'manual';   // 직접등록(과거 참고사례) 여부
  const authorName  = ent?.user_name || r.sender_name || r.registered_by_name || '-';

  // 푸터 우측: 직접등록이면 [📁 과거 참고사례] 배지, 아니면 작성자명
  const footerRight = isManual
    ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;
                    color:#7c3aed;background:#f5f3ff;border:1px solid #ddd6fe;
                    border-radius:10px;padding:2px 9px">
         <i class="fas fa-folder-open" style="font-size:10px"></i> 과거 참고사례
       </span>`
    : `<span class="arch-meta-chip"><i class="fas fa-user"></i> ${Utils.escHtml(authorName)}</span>`;

  return `
  <div class="arch-card" id="arch-card-${r.id}">
    <!-- 헤더: 제목 + 평가등급(우측) -->
    <div class="arch-card-header">
      <a href="javascript:void(0)" onclick="openArchiveDetail('${r.id}')" class="arch-card-title">${titleDisp}</a>
      ${starBadge}
    </div>
    <!-- 태그 통합 한 줄: 핵심키워드 + 관련법령 (같은 행) -->
    ${(kwHtml || lawHtml) ? `<div class="arch-card-kw-row">
      <span class="arch-card-section-label"><i class="fas fa-tags"></i></span>
      <div class="arch-card-kw-tags" style="flex-wrap:wrap;gap:4px">
        ${kwHtml}${lawHtml}
      </div>
    </div>` : ''}
    <!-- 판단사유 (검색 조건 태그만, 별도 줄) -->
    ${reasonHtml ? `<div class="arch-card-reason-row">
      <span class="arch-card-section-label"><i class="fas fa-balance-scale"></i></span>
      <div class="arch-card-reason-tags">${reasonHtml}</div>
    </div>` : ''}
    <!-- 본문 미리보기 -->
    ${previewHtml}
    <!-- 푸터 -->
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
//  자문내용 전체보기 팝업
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// ★ 핵심내용 클릭 → 전체 내용 보기 모달
// ─────────────────────────────────────────────
async function showArchiveContentModal(refId) {
  // ── 카드 내 인라인 확장 패널 방식 ──
  // 이미 열려있는 다른 확장 패널은 모두 닫기
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
    // 카드를 못 찾으면 기존 방식으로 openArchiveDetail 호출
    openArchiveDetail(refId);
    return;
  }

  // 이미 열려있으면 토글 닫기
  const existing = document.getElementById(`arch-inline-${refId}`);
  if (existing) {
    existing.remove();
    card.classList.remove('arch-card-expanded');
    const arrow = card.querySelector('.arch-kw-arrow');
    if (arrow) { arrow.style.transform = ''; arrow.style.color = ''; }
    return;
  }


  // 화살표 아이콘 회전
  const arrow = card.querySelector('.arch-kw-arrow');
  if (arrow) { arrow.style.transform = 'rotate(90deg)'; arrow.style.color = '#6366f1'; }

  // 로딩 패널 생성
  const panel = document.createElement('div');
  panel.id = `arch-inline-${refId}`;
  panel.className = 'arch-inline-panel';
  panel.dataset.refId = String(refId);
  panel.innerHTML = `<div class="arch-inline-loading"><i class="fas fa-spinner fa-spin"></i> 불러오는 중...</div>`;
  card.classList.add('arch-card-expanded');
  card.appendChild(panel);
  // 패널이 보이도록 스크롤 (데이터 로드 후)
  setTimeout(() => {
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 200);

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

    // ── 텍스트 복사 버튼 ──
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

// ── 인라인 패널 본문 복사 ──
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

// 하위 호환 유지 (기존 onclick 참조 대비)
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
    // fallback for older browsers
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
  // 입력 필드 초기화
  ['archive-search-input','archive-filter-business','archive-filter-stars',
   'archive-filter-date-from','archive-filter-date-to','arch-law-name','arch-law-article',
   'arch-kw-input','arch-reason-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  // 태그 상태 초기화
  _archKwTags = []; _archReasonTags = []; _archLawTags = [];
  _archRenderTagUi();
  _archUpdateExampleTags();
  // 활성 필터 배지 제거
  const fb = document.getElementById('archive-active-filter-bar');
  if (fb) { fb.style.display = 'none'; fb.innerHTML = ''; }
  _archivePage = 1;
  loadArchiveList();
}

// 활성 필터 배지 표시 (신규 v20260401f)
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
    // ref + docs + entries 병렬 조회
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

    // 조회수 +1 (비동기, 결과 무시)
    API.patch('mail_references', refId, { view_count: (ref.view_count||0)+1 }).catch(()=>{});

    // entry 정보 추출
    let entry = null;
    if (ref.entry_id) {
      entry = (entryResp.data || []).find(e => String(e.id) === String(ref.entry_id)) || null;
    }

    const isManual     = ref.source_type === 'manual';  // 직접등록(과거 참고사례) 여부
    const authorName   = entry?.user_name  || ref.sender_name || ref.registered_by_name || '-';
    const approver1    = entry?.pre_approver_name || entry?.approver_name || '-';
    const approver2    = entry?.reviewer_name     || entry?.reviewer2_name || '-';
    const entryWorkDesc = entry?.work_description || '';

    // 날짜
    const _toDateStr = (val) => {
      if (!val) return null;
      const n = Number(val);
      if (!isNaN(n) && n > 1e12)  return Utils.formatDate(n);
      if (!isNaN(n) && n > 1e9)   return Utils.formatDate(n * 1000);
      const d = new Date(val);
      return isNaN(d.getTime()) ? String(val).slice(0,10) : Utils.formatDate(d);
    };
    const dateStr = _toDateStr(ref.sent_at) || _toDateStr(ref.archived_at) || _toDateStr(ref.created_at) || '-';

    // 업무분류 배지
    const bizName = entry?.work_subcategory_name || ref.work_subcategory || '';
    const bizBadgeHtml = bizName ? _archBizBadge(bizName) : '';

    // 평가등급 배지
    const stars = parseInt(entry?.quality_stars ?? ref.quality_stars) || 0;
    const starLabel = {1:'C 참고',2:'B 우수',3:'A 매우우수'}[stars] || '';
    const starColor = {1:'#6b7280',2:'#2563eb',3:'#d97706'}[stars];
    const starBadgeHtml = stars > 0
      ? `<span class="arch-star-badge" style="color:${starColor};border-color:${starColor}40;background:${starColor}12">
           ${'★'.repeat(stars)}${'☆'.repeat(3-stars)} ${starLabel}
         </span>` : '';

    // 핵심키워드 태그 (승인저장: entry에서, 직접등록: ref에서)
    const kwArr = _parseArr(entry?.kw_query ?? ref.kw_query);
    const kwHtml = kwArr.length
      ? kwArr.map(k => `<span class="arch-card-kw-tag">${Utils.escHtml(k)}</span>`).join('')
      : '<span style="font-size:12px;color:#94a3b8">없음</span>';

    // 관련법령
    const lawArr = _parseArr(entry?.law_refs ?? ref.law_refs);
    const lawHtml = lawArr.length
      ? lawArr.map(l => {
          const label = typeof l === 'object'
            ? ((l.name||'') + (l.article ? ' ' + l.article : ''))
            : String(l);
          return `<span class="arch-modal-law-tag"><i class="fas fa-gavel" style="font-size:10px"></i>${Utils.escHtml(label)}</span>`;
        }).join('')
      : '<span style="font-size:12px;color:#94a3b8">없음</span>';

    // 판단사유 태그
    const reasonArr = _parseArr(entry?.kw_reason ?? ref.kw_reason);
    const reasonHtml = reasonArr.length
      ? reasonArr.map(k => `<span class="arch-card-reason-tag">${Utils.escHtml(k)}</span>`).join('')
      : '<span style="font-size:12px;color:#94a3b8">없음</span>';

    // 활용포인트
    const utilNote = (ref.archive_note || '').trim();

    // 자문내용 (entry.work_description → ref.work_description → ref.body_text 순서로 fallback)
    // ★ 저장된 데이터에 Word 메타데이터가 섞여있을 수 있으므로 _cleanPasteHtml로 정리
    const _rawDescHtml = (entryWorkDesc || ref.work_description || '').trim();
    const descHtml = _rawDescHtml
      ? _rawDescHtml
          .replace(/<!--[\s\S]*?-->/g, '')       // HTML 주석(Word 조건부 주석 포함) 제거
          .replace(/<xml[\s\S]*?<\/xml>/gi, '')   // <xml> 블록 제거
          .trim()
      : '';
    const summaryText = (ref.summary || '').trim();
    let contentHtml = descHtml
      ? (descHtml.startsWith('<') ? descHtml : '<p>' + Utils.escHtml(descHtml) + '</p>')
      : (summaryText ? '<p>' + Utils.escHtml(summaryText) + '</p>' : '');
    // 표 포함 시 인라인 스타일 보강
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

    // 첨부파일 HTML (기존 로직 유지)
    const docsHtml = _buildDocsHtml(docs);

    // 모달 제목 (고객사명 제외, "자문" 중복 방지)
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

        <!-- ② 담당자 정보 (직접등록이면 과거참고사례 배지만, 아니면 작성자/승인자 표시) -->
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

        <!-- ⑦ 자문내용 (수행내용 HTML) -->
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
    // ── 하단 버튼: 관리자/사업부장만 강제삭제 버튼 표시 ──
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

/** 첨부파일 카드 HTML 빌더 (기존 로직 분리) */
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

// ── 파일 뷰어 열기/닫기 토글 ──
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

// ── 파일 다운로드 (base64 data URI → Blob → <a> 클릭) ──
async function archDownloadFile(docId, fileName) {
  try {
    const d = await API.get('doc_texts', docId);
    if (!d || !d.file_content) { Toast.warning('저장된 파일 데이터가 없습니다.'); return; }

    // data URI 파싱
    const [meta, b64] = d.file_content.split(',');
    if (!b64) { Toast.warning('파일 형식을 인식할 수 없습니다.'); return; }
    const mime = (meta.match(/:(.*?);/) || [])[1] || 'application/octet-stream';

    // Blob 생성
    const bytes = atob(b64);
    const arr   = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });

    // 다운로드 트리거
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url;
    a.download = fileName || 'download';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
    Toast.success(`"${fileName}" 다운로드를 시작합니다.`);
  } catch(e) {
    console.error('archDownloadFile error', e);
    Toast.error('다운로드 중 오류가 발생했습니다.');
  }
}

// ── 메일 본문 추출 헬퍼 ──
// PDF 저장 메일, EML 등에서 헤더 블록을 제거하고 본문만 반환한다.
//
// 핵심 문제: PDF 텍스트 추출 시 줄바꿈이 사라지고 헤더+본문이 한 줄로 이어진다.
// 예: "1 한휘선  보낸 사람: 한휘선 <...>  보낸 날짜: 2026년...  받는 사람: ...  참조: ...  제목: XXX  [본문본문본문]"
//
// 해결 전략:
//   ① 줄바꿈 있는 정상 형태 → 헤더 줄 연속 후 비헤더 줄을 본문으로
//   ② 한 줄 연속 형태 → 헤더 키워드들을 앵커로 삼아 각 구간을 추출, 제목값 뒤 내용을 본문으로
//   ③ fallback → 전체 반환
function _extractMailBody(text) {
  if (!text) return '';

  // ── 헤더 키워드: 순서 중요 (긴 것 먼저 → 짧은 것 오매칭 방지) ──
  const KO_HEADERS = ['보낸 사람', '받는 사람', '보낸 날짜', '보낸날짜', '받는날짜', '숨은참조', '참조', '제목', '날짜'];
  const EN_HEADERS = ['Reply-To', 'Message-ID', 'MIME-Version', 'Content-Type', 'Subject', 'From', 'Date', 'Bcc', 'Cc', 'To'];
  const ALL_HEADERS = [...KO_HEADERS, ...EN_HEADERS];

  // 헤더 키워드 → 정규식 이스케이프 (공백 유연 처리)
  const escKey = k => k.replace(/[-]/g, '\\-').replace(/\s+/g, '\\s*');

  // ── 전략 A: 줄 단위 (줄바꿈이 살아있는 경우) ──
  const lines = text.split('\n');
  if (lines.length >= 3) {
    // 헤더 줄 판별: 한글/영문 헤더 키워드로 시작하거나, 번호 접두사 후 키워드
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
      // 영문 RFC 헤더 (대소문자 구분)
      if (/^[A-Za-z][\w\-]*\s*:/.test(t)) return true;
      return false;
    };

    let hCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (isHeaderLine(lines[i])) {
        hCount++;
      } else if (hCount >= 2) {
        // 헤더 2개+ 이후 비헤더 줄 → 본문
        let start = i;
        while (start < lines.length && !lines[start].trim()) start++;
        if (start < lines.length) return lines.slice(start).join('\n').trim();
      } else if (lines[i].trim() === '' && hCount > 0) {
        // 헤더 후 빈 줄 → 다음 실질 내용이 본문
        let start = i + 1;
        while (start < lines.length && !lines[start].trim()) start++;
        if (start < lines.length) return lines.slice(start).join('\n').trim();
      } else if (hCount === 0 && lines[i].trim()) {
        // 첫 줄부터 헤더가 아니면 전체가 본문
        break;
      }
    }
  }

  // ── 전략 B: 인라인(한 줄) 형태 파싱 ──
  // 헤더 키워드들을 구분자로 삼아 텍스트를 분절하고,
  // "제목:" 구간을 찾은 뒤 그 값에서 다음 헤더 키워드 이전까지를 제목 값으로,
  // 제목 구간이 끝난 이후 텍스트를 본문으로 간주한다.

  // 모든 헤더 키워드의 출현 위치(index)와 끝(end) 수집
  const segments = []; // { key, start, valueStart }
  for (const k of ALL_HEADERS) {
    // 번호 접두사 포함 버전도 탐색: "(\d+\s+)?키워드\s*:"
    const pat = new RegExp('(?:^|\\s)(?:\\d+\\s+)?(' + escKey(k) + ')\\s*:', 'gi');
    let m;
    while ((m = pat.exec(text)) !== null) {
      const keyStart = m.index + m[0].indexOf(m[1]);
      const valueStart = m.index + m[0].length;
      segments.push({ key: k, start: keyStart, valueStart });
    }
  }

  if (segments.length >= 2) {
    // 시작 위치 순으로 정렬
    segments.sort((a, b) => a.start - b.start);

    // 제목(Subject) 구간 찾기 — 가장 마지막 제목 키워드 사용
    const subjectSeg = [...segments].reverse().find(s => s.key === '제목' || s.key.toLowerCase() === 'subject');

    if (subjectSeg) {
      // 제목 값의 끝 = 제목 다음으로 나오는 헤더 키워드의 시작
      const nextSeg = segments.find(s => s.start > subjectSeg.start);
      if (nextSeg) {
        // 제목 다음에 헤더가 또 있으면 → 그 헤더들이 끝나는 지점 이후가 본문
        // 가장 마지막 헤더 segment의 valueStart 이후를 본문으로
        const lastSeg = segments[segments.length - 1];
        // lastSeg 이후 텍스트
        const afterLast = text.slice(lastSeg.valueStart).trim();
        // afterLast에 다른 헤더가 없으면 본문으로 확정
        let hasMore = false;
        for (const k of ALL_HEADERS) {
          if (new RegExp('(?:^|\\s)' + escKey(k) + '\\s*:', 'i').test(afterLast.slice(0, 300))) {
            hasMore = true; break;
          }
        }
        if (!hasMore) return afterLast;

        // 그래도 헤더가 있으면 재귀적으로 반복 제거 (최대 5회)
        let cur = afterLast;
        for (let attempt = 0; attempt < 5; attempt++) {
          let found = false;
          for (const k of ALL_HEADERS) {
            const r = new RegExp('(?:^|\\s)(?:\\d+\\s+)?' + escKey(k) + '\\s*:', 'i');
            const mm = r.exec(cur);
            if (mm) {
              cur = cur.slice(mm.index + mm[0].length).trim();
              found = true;
              break;
            }
          }
          if (!found) break;
        }
        return cur.trim();
      } else {
        // 제목 다음에 헤더가 없으면 제목 값 이후가 바로 본문
        return text.slice(subjectSeg.valueStart).trim();
      }
    }

    // 제목 없이 다른 헤더들만 있는 경우 → 마지막 헤더 이후를 본문으로
    const lastSeg = segments[segments.length - 1];
    const afterLast = text.slice(lastSeg.valueStart).trim();
    if (afterLast) return afterLast;
  }

  // ── 전략 C: fallback ──
  return text.trim();
}

// ── [DEBUG] raw 텍스트 구조 확인 모달 ──
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

// ── 메일 본문만 복사 (EML 및 메일PDF 공통) ──
async function archCopyMailBody(docId, btnEl) {
  try {
    // DOM 텍스트 박스가 있어도 항상 API에서 raw 텍스트를 가져와 파싱
    // (DOM은 이미 잘못 파싱된 내용이 렌더링되어 있을 수 있으므로 신뢰하지 않음)
    const d = await API.get('doc_texts', docId);
    if (!d || !d.extracted_text) { Toast.warning('복사할 본문이 없습니다.'); return; }

    // [DEBUG] 실제 raw 텍스트를 화면에 표시하여 구조 파악
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

// ── 추출 텍스트 전체 복사 ──
// doc_type=mail_pdf인 경우 _extractMailBody로 본문만 복사
async function archCopyText(docId, btnEl) {
  try {
    // 이미 DOM에 렌더링된 텍스트 박스 우선 사용 (이미 본문만 표시되어 있을 수 있음)
    const textBox = document.getElementById(`file-text-${docId}`);
    let text = textBox ? textBox.innerText.trim() : null;

    if (!text) {
      // fallback: API 재조회
      const d = await API.get('doc_texts', docId);
      if (!d || !d.extracted_text) { Toast.warning('복사할 텍스트가 없습니다.'); return; }
      // 메일PDF이면 본문만 추출
      const isMailPdf = d.file_type === 'pdf' && d.doc_type === 'mail_pdf';
      text = isMailPdf ? _extractMailBody(d.extracted_text) : d.extracted_text;
      if (!text) { Toast.warning('복사할 텍스트가 없습니다.'); return; }
    }

    await navigator.clipboard.writeText(text);

    // 버튼 피드백
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

// ── 직접등록 본문(body_text) 복사 ──
async function archCopyBodyText(refId, btnEl) {
  try {
    // DOM 텍스트 박스 우선 (이미 렌더링된 내용)
    const textBox = document.getElementById(`arch-body-text-${refId}`);
    let text = textBox ? textBox.innerText.trim() : null;

    if (!text) {
      // fallback: API 재조회
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

// ── 자문 요약 복사 ──
/* Outlook용 HTML 변환: table/td/th에 인라인 border 스타일 주입 */
function _injectOutlookTableStyle(html) {
  if (!html) return html;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  // table
  tmp.querySelectorAll('table').forEach(t => {
    t.setAttribute('border', '1');
    t.style.borderCollapse = 'collapse';
    t.style.border = '1px solid #94a3b8';
    t.style.fontFamily = 'inherit';
    t.style.fontSize   = '13px';
  });
  // th
  tmp.querySelectorAll('th').forEach(el => {
    el.style.border      = '1px solid #94a3b8';
    el.style.padding     = '4px 8px';
    el.style.background  = '#e2e8f0';
    el.style.fontWeight  = '700';
    el.style.textAlign   = 'center';
    el.style.whiteSpace  = 'pre-wrap';
    el.style.verticalAlign = 'top';
  });
  // td
  tmp.querySelectorAll('td').forEach(el => {
    el.style.border      = '1px solid #94a3b8';
    el.style.padding     = '4px 8px';
    el.style.whiteSpace  = 'pre-wrap';
    el.style.verticalAlign = 'top';
  });
  return tmp.innerHTML;
}

/* 자문내용 원문 복사 — HTML+텍스트 동시 복사 (Outlook 표 유지) */
function _archCopyDesc(refId, btnEl) {
  try {
    const cache = window._archDescMap && window._archDescMap[refId];
    const rawHtml    = (cache && cache.html) || '';
    const textContent = (cache && cache.text) || '';
    if (!rawHtml && !textContent) { Toast.warning('복사할 자문내용이 없습니다.'); return; }

    // Outlook 호환: 테이블에 인라인 border 스타일 주입
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

    // ClipboardItem API 지원 시: HTML + 텍스트 동시 복사 → Outlook에서 표 유지
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
      const textBlob = new Blob([textContent], { type: 'text/plain' });
      navigator.clipboard.write([
        new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })
      ]).then(_done).catch(() => {
        // 실패 시 텍스트 폴백
        navigator.clipboard.writeText(textContent).then(_done).catch(() => Toast.error('복사 실패'));
      });
    } else {
      // 구형 브라우저 폴백: 텍스트만 복사
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

// ─────────────────────────────────────────────
//  파일 목록 모달
// ─────────────────────────────────────────────
async function openArchiveFiles(refId) {
  try {
    const [ref, docsResp] = await Promise.all([
      API.get('mail_references', refId),
      API.list('doc_texts', { limit: 50 })
    ]);
    const docs = (docsResp.data||[]).filter(d => d.ref_id === refId);
    // openArchiveDetail 로 리다이렉트
    openArchiveDetail(refId);
  } catch(e) { Toast.error('오류가 발생했습니다.'); }
}

// ─────────────────────────────────────────────
//  직접 등록 모달
// ─────────────────────────────────────────────
async function openArchiveNewModal() {
  _archiveNewPendingFiles = [];

  // 숨김 호환 필드 초기화
  document.getElementById('archive-edit-id').value = '';
  document.getElementById('archive-subject-input').value = '';
  document.getElementById('archive-sender-name-input').value = '';
  document.getElementById('archive-sender-email-input').value = '';
  document.getElementById('archive-recipients-input').value = '';
  document.getElementById('archive-sent-at-input').value = Utils.todayStr ? Utils.todayStr() : new Date().toISOString().slice(0,10);
  document.getElementById('archive-summary-input').value = '';
  document.getElementById('archive-tags-input').value = '';
  document.getElementById('archive-is-template').checked = false;

  // 핵심키워드 초기화
  document.getElementById('arch-new-kw-tags').innerHTML = '';
  document.getElementById('arch-new-kw-input').value = '';
  document.getElementById('arch-new-kw-hidden').value = '[]';

  // 판단사유 초기화
  document.getElementById('arch-new-reason-tags').innerHTML = '';
  document.getElementById('arch-new-reason-input').value = '';
  document.getElementById('arch-new-reason-hidden').value = '[]';

  // 관련법령 초기화
  document.getElementById('arch-new-law-tags').innerHTML = '';
  document.getElementById('arch-new-law-name-input').value = '';
  document.getElementById('arch-new-law-article-input').value = '';
  document.getElementById('arch-new-law-hidden').value = '[]';

  // 평가등급 초기화
  document.getElementById('archive-stars-value').value = '';
  document.querySelectorAll('.arch-star-btn').forEach(btn => {
    btn.style.background = '#fff';
    btn.style.borderColor = '#d1d5db';
    btn.style.color = '#6b7280';
  });

  // 에디터 초기화 (Hybrid: 항상 Quill 모드로 리셋)
  _archResetEditor();
  document.getElementById('archive-quill-hidden').value = '';

  await _fillArchiveModalSelects();
  openModal('archiveNewModal');
}

// ── 본문 입력 시 실시간 태그 미리보기 ──
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

// ── 태그 자동 생성 (본문 + 소분류 기반) ──
function _generateAutoTags(bodyText, subcatName) {
  const tags = new Set();

  // 소분류명 자체를 첫 태그로
  if (subcatName) tags.add(subcatName);

  // 본문에서 키워드 추출 (최대 9개)
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

    // 태그 미리보기: 기존 태그 표시
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

    // ★ 소분류를 고객업무(category_type==='client') 대분류 기준으로 필터링하여 전체 나열
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

    // ★ 숨겨진 대분류 select도 전체 옵션 채워두기
    const asel = document.getElementById('archive-category-select');
    if (asel) {
      asel.innerHTML = '';
      cats.forEach(c => {
        const o = new Option(c.category_name||c.name, c.id+'|'+(c.category_name||c.name));
        asel.appendChild(o);
      });
    }

    // ★ 소분류 변경 시 숨겨진 대분류 select도 자동 동기화
    ssel.onchange = () => _syncCategoryFromSubcat(ssel, asel);

    if (ref && ref.work_subcategory) {
      ssel.value = ref.work_subcategory;
      _syncCategoryFromSubcat(ssel, asel);
    }
  } catch(e) { console.error('_fillArchiveModalSelects error', e); }
}

// 소분류 선택 시 숨겨진 대분류 select를 자동 동기화
function _syncCategoryFromSubcat(ssel, asel) {
  if (!ssel || !asel) return;
  const selected = ssel.options[ssel.selectedIndex];
  if (selected && selected.dataset.catId) {
    const catId   = selected.dataset.catId;
    const catName = selected.dataset.catName;
    // catSel의 값 형식: "id|category_name"
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
    // 텍스트 추출
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

  // ★ 대분류 / 소분류
  const catSel    = document.getElementById('archive-category-select');
  const subcatSel = document.getElementById('archive-subcategory-select');
  const catRaw    = catSel?.value || '';
  const catName   = catRaw.includes('|') ? catRaw.split('|')[1] : catRaw;
  const subcatVal = subcatSel?.value || '';

  // ★ 핵심키워드
  let kwQuery = [];
  try { kwQuery = JSON.parse(document.getElementById('arch-new-kw-hidden')?.value || '[]'); } catch(e) { kwQuery = []; }

  // ★ 판단사유
  let kwReason = [];
  try { kwReason = JSON.parse(document.getElementById('arch-new-reason-hidden')?.value || '[]'); } catch(e) { kwReason = []; }

  // ★ 관련법령
  let lawRefs = [];
  try { lawRefs = JSON.parse(document.getElementById('arch-new-law-hidden')?.value || '[]'); } catch(e) { lawRefs = []; }

  // ★ 평가등급
  const starsVal = parseInt(document.getElementById('archive-stars-value')?.value || '0');

  // ★ 자문 내용 — Hybrid 에디터 + Word 메타데이터 완전 제거 후 저장
  const _rawDescHtml = _archGetEditorHtml();
  // 항상 _cleanPasteHtml 통과 (Word 조건부 주석, <xml>, mso-* 스타일 등 제거)
  const workDescHtml = _cleanPasteHtml(_rawDescHtml);
  const workDescText = _archGetEditorText()
    .replace(/Normal\s+\d+\s+\d+\s+\d+\s+(false|true)\s+(false|true)\s+(false|true)[^\n]*/gi, '')
    .replace(/\s+/g, ' ').trim();

  // ★ 필수값 검증
  if (!subcatVal)       { Toast.warning('업무분류를 선택하세요.'); return; }
  if (!starsVal)        { Toast.warning('평가등급을 선택하세요.'); return; }
  if (!kwQuery.length)  { Toast.warning('핵심키워드를 1개 이상 입력하세요.'); return; }
  if (!workDescText || workDescText.replace(/\s/g,'') === '')  {
    Toast.warning('자문 내용을 입력하세요.'); return;
  }

  // ★ 제목 자동생성: "소분류명 YYYY-MM-DD"
  const todayStr   = Utils.todayStr ? Utils.todayStr() : new Date().toISOString().slice(0,10);
  const autoSubject = `${subcatVal} ${todayStr}`;

  // ★ 요약 자동생성: 본문 앞 150자
  const autoSummary = workDescText.replace(/\s+/g,' ').slice(0, 150);

  // ★ 평가등급 별표 문자열
  const starDisplay = '★'.repeat(starsVal) + '☆'.repeat(3 - starsVal);
  const starRatingMap = { 3: 'very_satisfied', 2: 'satisfied', 1: 'normal' };

  const payload = {
    subject:              autoSubject,
    body_text:            workDescHtml,         // 호환용 (rich_text)
    work_description:     workDescHtml,          // 신규 필드
    sender_name:          session.name,
    sender_email:         session.email || '',
    recipients:           '',
    sent_at:              todayStr,
    client_id:            '',
    client_name:          '',
    work_category:        catName,
    work_subcategory:     subcatVal,
    kw_query:             JSON.stringify(kwQuery),
    kw_reason:            JSON.stringify(kwReason),
    law_refs:             JSON.stringify(lawRefs),
    quality_stars:        starsVal,
    quality_rating:       starRatingMap[starsVal] || 'normal',
    star_display:         starDisplay,
    tags:                 kwQuery.join(', '),
    keywords:             kwQuery.join(', '),
    summary:              autoSummary,
    archive_note:         '',
    is_template:          document.getElementById('archive-is-template')?.checked || false,
    source_type:          'manual',
    registered_by_id:     String(session.id ?? ''),

    registered_by_name:   session.name,
    status:               'active',
    view_count:           0,
    helpful_count:        0
  };

  // ★ 버튼 로딩 상태
  const saveBtn    = document.getElementById('archiveNewSaveBtn');
  const closeBtn2  = document.querySelector('#archiveNewModal .modal-footer .btn-ghost');
  const restoreBtn   = BtnLoading.start(saveBtn, '저장 중...');
  const restoreClose = BtnLoading.disableAll(closeBtn2);

  try {
    const created = await API.create('mail_references', payload);
    if (!created || !created.id) {
      throw new Error('저장 응답에 id가 없습니다. RLS 또는 스키마 오류일 수 있습니다.');
    }
    const refId = created.id;


    // 검색 인덱스 업데이트
    await _updateSearchIndex(refId).catch(e => console.warn('검색인덱스 업데이트 실패(무시):', e));

    // ★ 관련 캐시 무효화
    Cache.invalidate('doc_texts_list');
    Cache.invalidate('ref_search_index_list');

    restoreBtn(); restoreClose();
    Toast.success('✅ 자문 자료가 등록되었습니다.');
    closeModal('archiveNewModal');
    loadArchiveList();
      } catch(e) {
    restoreBtn(); restoreClose();
    console.error('saveArchiveRecord error', e);
    const msg = e?.message || '알 수 없는 오류';
    Toast.error('저장 실패: ' + msg);
  }
}


}

// ─────────────────────────────────────────────
//  직접 등록 모달 — Hybrid 에디터
//  ┌ 표 없음: Quill 에디터 (bold/italic 등 서식 지원)
//  └ 표 있음: contenteditable div (Quill은 table을 sanitize하므로 완전 우회)
// ─────────────────────────────────────────────
let _archiveQuill = null;     // 직접등록 모달 전용 Quill 인스턴스
let _archiveUseRich = false;  // true = contenteditable 모드 (표 포함)

/**
 * 붙여넣기 HTML 정리:
 * - Word/HWP의 mso-* 스타일, 전용 태그 제거
 * - colspan/rowspan 등 표 구조 속성은 반드시 보존
 * - 표 셀에 인라인 스타일 보강 (테두리, 패딩 등)
 */
function _cleanPasteHtml(html) {
  try {
    // ① Word 조건부 주석 및 XML 메타데이터 제거
    //   ex) <!--[if gte mso 9]><xml><w:WordDocument>...</xml><![endif]-->
    //   ex) Normal 0 0 2 false false false ... 같은 텍스트의 원본
    let cleaned = html
      .replace(/<!--\[if[^\]]*\]>.*?<!\[endif\]-->/gis, '')  // 조건부 주석 전체 제거
      .replace(/<xml[^>]*>.*?<\/xml>/gis, '')                // <xml>...</xml> 블록 제거
      .replace(/<o:[^>]*>.*?<\/o:[^>]*>/gis, '')             // <o:...>...</o:...> 태그 제거
      .replace(/<w:[^>]*>.*?<\/w:[^>]*>/gis, '')             // <w:...>...</w:...> 태그 제거
      .replace(/<o:[^>]*\/>/gi, '')                           // 자기닫힘 <o:.../> 제거
      .replace(/<w:[^>]*\/>/gi, '');                          // 자기닫힘 <w:.../> 제거

    const tmp = document.createElement('div');
    tmp.innerHTML = cleaned;

    // ② 남아있는 Word/HWP 전용 태그 처리 (내용물만 남김)
    tmp.querySelectorAll('o\\:p, w\\:sdt, w\\:sdtContent, o\\:wrapblock').forEach(el => {
      el.replaceWith(...Array.from(el.childNodes));
    });
    // 내용이 없는 Word 잔여 요소 완전 삭제
    tmp.querySelectorAll('[class^="Mso"], [class*=" Mso"]').forEach(el => {
      // MsoNormal 등 Word 단락 클래스는 클래스만 제거 (내용은 유지)
      el.removeAttribute('class');
    });

    // ③ mso-* 스타일만 제거, colspan/rowspan 등 구조 속성은 절대 건드리지 않음
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

    // ③ 표 인라인 스타일 보강
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

/** 표 모드(contenteditable)로 전환 */
function _archSwitchToRich(html) {
  _archiveUseRich = true;
  const quillWrap = document.getElementById('archive-quill-editor');
  const richEl    = document.getElementById('archive-rich-editor');
  const badge     = document.getElementById('archive-editor-mode-badge');
  if (!richEl) return;

  // Quill 에디터 숨기고 contenteditable 표시
  if (quillWrap) quillWrap.style.display = 'none';
  richEl.style.display = 'block';
  if (badge)  { badge.style.display = 'flex'; }

  // 내용 주입
  if (html !== undefined) richEl.innerHTML = html;
}

/** 일반 Quill 모드로 복귀 (표 제거) */
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

/** 현재 에디터에서 HTML 가져오기 */
function _archGetEditorHtml() {
  if (_archiveUseRich) {
    const el = document.getElementById('archive-rich-editor');
    return el ? el.innerHTML.trim() : '';
  }
  return _archiveQuill ? _archiveQuill.root.innerHTML.trim() : '';
}

/** 현재 에디터에서 텍스트 가져오기 */
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

/** 에디터 초기화 (모달 열 때마다 호출) */
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

/** Quill 초기화 (최초 1회) + contenteditable 이벤트 설정 */
function _initArchiveQuill() {
  // ── contenteditable 에디터 paste 이벤트 (표 전용) ──
  const richEl = document.getElementById('archive-rich-editor');
  if (richEl && !richEl._pasteReady) {
    richEl._pasteReady = true;
    richEl.addEventListener('paste', function(e) {
      e.preventDefault();
      const cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      const htmlData = cd.getData('text/html');
      const textData = cd.getData('text/plain');
      // HTML이 있으면 정리 후 삽입, 없으면 plain text
      const toInsert = htmlData ? _cleanPasteHtml(htmlData) : (textData || '');
      document.execCommand('insertHTML', false, toInsert);
    });
  }

  if (_archiveQuill) return; // 이미 초기화됨
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

  // ── Quill 에디터 paste: 표가 포함되면 contenteditable로 자동 전환 ──
  _archiveQuill.root.addEventListener('paste', function(e) {
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    const htmlData = cd.getData('text/html');

    if (htmlData && htmlData.includes('<table')) {
      // 표 감지 → Quill 처리 완전 차단 후 contenteditable 모드로 전환
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const cleanHtml = _cleanPasteHtml(htmlData);
      _archSwitchToRich(cleanHtml);

      // contenteditable로 포커스 이동
      setTimeout(() => {
        const richEl = document.getElementById('archive-rich-editor');
        if (richEl) richEl.focus();
      }, 50);
    }
    // 표 없는 경우: Quill이 정상 처리
  }, true);
}

/** 평가등급 버튼 선택 */
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

/** 태그 입력 keydown 핸들러 (type: 'kw' | 'reason') */
function _archNewTagKeydown(e, type) {
  if (e.key !== 'Enter' && e.key !== ',') return;
  e.preventDefault();
  const input = e.target;
  const val = (input.value || '').replace(/,/g,'').trim();
  if (val) _archNewAddTag(type, val);
  input.value = '';
}

/** 태그 추가 */
function _archNewAddTag(type, val) {
  const v = (val || '').trim();
  if (!v) return;
  const hiddenId = type === 'kw' ? 'arch-new-kw-hidden' : 'arch-new-reason-hidden';
  const contId   = type === 'kw' ? 'arch-new-kw-tags'   : 'arch-new-reason-tags';
  const hiddenEl = document.getElementById(hiddenId);
  let arr = [];
  try { arr = JSON.parse(hiddenEl.value || '[]'); } catch(e) { arr = []; }
  if (arr.includes(v)) return;  // 중복 무시
  arr.push(v);
  hiddenEl.value = JSON.stringify(arr);
  _archNewRenderTags(type, arr);
}

/** 태그 제거 */
function _archNewRemoveTag(type, idx) {
  const hiddenId = type === 'kw' ? 'arch-new-kw-hidden' : 'arch-new-reason-hidden';
  const hiddenEl = document.getElementById(hiddenId);
  let arr = [];
  try { arr = JSON.parse(hiddenEl.value || '[]'); } catch(e) { arr = []; }
  arr.splice(idx, 1);
  hiddenEl.value = JSON.stringify(arr);
  _archNewRenderTags(type, arr);
}

/** 태그 렌더링 */
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

/** 관련법령 추가 */
function _archNewAddLaw() {
  const nameEl    = document.getElementById('arch-new-law-name-input');
  const articleEl = document.getElementById('arch-new-law-article-input');
  const hiddenEl  = document.getElementById('arch-new-law-hidden');
  const name    = (nameEl?.value || '').trim();
  const article = (articleEl?.value || '').trim();
  if (!name) { Toast.warning('법령명을 입력하세요.'); return; }
  let arr = [];
  try { arr = JSON.parse(hiddenEl.value || '[]'); } catch(e) { arr = []; }
  if (arr.find(l => l.law === name && l.article === article)) return; // 중복 무시
  arr.push({ law: name, article });
  hiddenEl.value = JSON.stringify(arr);
  if (articleEl) articleEl.value = '';
  _archNewRenderLaws(arr);
}

/** 관련법령 제거 */
function _archNewRemoveLaw(idx) {
  const hiddenEl = document.getElementById('arch-new-law-hidden');
  let arr = [];
  try { arr = JSON.parse(hiddenEl.value || '[]'); } catch(e) { arr = []; }
  arr.splice(idx, 1);
  hiddenEl.value = JSON.stringify(arr);
  _archNewRenderLaws(arr);
}

/** 관련법령 렌더링 */
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
  // ── 권한 체크 ──────────────────────────────────────
  const _session = Session.get();
  if (!_session || (_session.role !== 'admin' && _session.role !== 'director')) {
    Toast.warning('삭제 권한이 없습니다. 관리자 또는 사업부장만 삭제할 수 있습니다.');
    return;
  }

  // ── 1차 컨펌 ───────────────────────────────────────
  const ok1 = await Confirm.show({
    icon: '🗑️',
    title: '자문 자료 삭제',
    desc: '이 자문 자료를 삭제하시겠습니까?<br><span style="color:#ef4444;font-weight:600">삭제 후 복구할 수 없습니다.</span>',
    confirmText: '삭제',
    confirmClass: 'btn-danger'
  });
  if (!ok1) return;

  // ── 2차 컨펌 (최종 확인) ───────────────────────────
  const ok2 = await Confirm.show({
    icon: '⚠️',
    title: '최종 확인',
    desc: '정말로 삭제하시겠습니까?<br>이 작업은 <strong>되돌릴 수 없습니다.</strong>',
    confirmText: '최종 삭제',
    confirmClass: 'btn-danger'
  });
  if (!ok2) return;

  // ── 삭제 실행 ──────────────────────────────────────
  try {
    await API.patch('mail_references', refId, {
      status: 'hidden',
      deleted_by: _session.name,
      deleted_at: Date.now()
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
      // ★ mammoth 지연 로드
      if (typeof mammoth === 'undefined') await LibLoader.load('mammoth');
      const result = await mammoth.extractRawText({arrayBuffer: ab});
      obj.extractedText = result.value || '';
      obj.extractStatus = obj.extractedText ? 'success' : 'partial';
    } else if (type === 'pdf') {
      obj.extractStatus = 'pending';
      const ab = await file.arrayBuffer();
      // ★ PDF.js 지연 로드
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
      // ★ XLSX 지연 로드
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
    // Base64 변환
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

// ─────────────────────────────────────────────
//  PDF Base64 → 텍스트 추출 (PDF.js)
// ─────────────────────────────────────────────
async function _extractPdfTextFromBase64(base64DataUrl) {
  try {
    // data:application/pdf;base64,XXX → ArrayBuffer
    const base64 = base64DataUrl.includes(',') ? base64DataUrl.split(',')[1] : base64DataUrl;
    const binary  = atob(base64);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // ★ PDF.js 지연 로드
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
    ref_id: refId,
    entry_id: entryId || '',
    file_name: fileObj.fileName,
    file_type: fileObj.fileType,
    file_size: fileObj.fileSize,
    file_content: fileObj.content || '',
    extracted_text: fileObj.extractedText || '',
    page_count: fileObj.pageCount || 0,
    extract_method: _detectExtractMethod(fileObj.fileType),
    extract_status: fileObj.extractStatus || 'pending',
    sort_order: order,
    doc_type: fileObj.docType || 'normal'   // ★ 메일PDF 여부
  };
  return await API.create('doc_texts', payload);
}

// ─────────────────────────────────────────────
//  검색 인덱스 업데이트 (★ 중복 생성 버그 수정)
//  - search 파라미터로 ref_id 필터링 → 불필요한 전체 조회 제거
//  - 기존 인덱스가 여러 개(중복)인 경우 첫 번째만 남기고 나머지 삭제
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

    // ★ ref_id 기반으로 기존 인덱스 검색 (search 파라미터 활용)
    const idxResp = await API.list('ref_search_index', { search: refId, limit: 50 });
    const existingList = (idxResp.data || []).filter(r => r.ref_id === refId);

    if (existingList.length > 0) {
      // ★ 첫 번째 인덱스만 PATCH로 업데이트
      await API.patch('ref_search_index', existingList[0].id, indexPayload);
      // ★ 중복 인덱스가 있으면 삭제 (1개 초과분 제거)
      if (existingList.length > 1) {
        const deletePromises = existingList.slice(1).map(r =>
          API.delete('ref_search_index', r.id).catch(() => {})
        );
        await Promise.all(deletePromises);
        console.info(`[SearchIndex] 중복 인덱스 ${existingList.length - 1}개 제거 (ref_id: ${refId})`);
      }
    } else {
      // 신규 생성
      await API.create('ref_search_index', indexPayload);
    }

    // mail_references의 keywords도 업데이트
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

  // ★ 버튼 로딩 시작 (ID로 정확히 찾기)
  const saveBtn   = document.getElementById('archiveSaveProceedBtn')
                 || document.querySelector('#archiveSaveModal .btn-warning');
  const cancelBtn = document.querySelector('#archiveSaveModal .btn-ghost');
  const restoreBtn    = BtnLoading.start(saveBtn, '승인 + 저장 중...');
  const restoreCancel = BtnLoading.disableAll(cancelBtn);

  try {
    // ★ [문제2 수정] 중복 저장 방지: 이미 동일 entry_id로 저장된 자료 확인
    if (entryId) {
      const dupCheck = await API.list('mail_references', { limit: 500 });
      const alreadySaved = (dupCheck.data || []).find(
        r => r.entry_id === entryId && r.status !== 'hidden'
      );
      if (alreadySaved) {
        restoreBtn(); restoreCancel();
        closeModal('archiveSaveModal');
        Toast.warning('이미 자료실에 저장된 업무기록입니다. (중복 저장 방지)');
        // 승인은 별도 처리 (저장 없이 승인만)
        await API.patch('time_entries', entryId, {
          status: 'approved',
          reviewer_id: session.id,
          reviewer_name: session.name,
          reviewed_at: new Date().toISOString(),
          is_archived: true
        });
        closeModal('approvalModal');
        if (typeof loadApprovalList === 'function') loadApprovalList();
        const _s = Session.get();
        if (typeof updateApprovalBadge === 'function' && _s) updateApprovalBadge(_s);
        return;
      }
    }

    // 1. 타임시트 승인 처리
    if (entryId) {
      await API.patch('time_entries', entryId, {
        status: 'approved',
        reviewer_id: session.id,
        reviewer_name: session.name,
        reviewed_at: new Date().toISOString(),
        is_archived: true  // ★ [문제1 수정] 스키마 등록 완료
      });
    }

    // 2. 엔트리 + 첨부파일 가져오기
    let entryData = null, attachmentDocs = [];
    if (entryId) {
      try { entryData = await API.get('time_entries', entryId); } catch(e) {}
      try {
        const attResp = await API.list('attachments', {limit:200});
        attachmentDocs = (attResp.data||[]).filter(a => a.entry_id === entryId);
      } catch(e) {}
    }

    // 3. mail_references 저장
    // ★ time_entries 실제 필드명으로 수정:
    //   description → work_description
    //   start_time  → work_start_at  (ms timestamp)
    //   category    → work_category_name
    //   subcategory → work_subcategory_name
    const tags = document.getElementById('archiveSave-tags')?.value.trim() || '';
    const isTemplate = document.getElementById('archiveSave-is-template')?.checked || false;
    // work_description은 summary에만 저장 (body_text 중복 저장 안 함)
    const sentAtMs  = entryData?.work_start_at ? new Date(Number(entryData.work_start_at)).toISOString().substring(0,10) : '';
    const keywords = _extractKeywords([summary, tags].join(' '), 15).join(', ');
    const refPayload = {
      entry_id: entryId || '',
      subject,
      body_text: '',
      sender_name: entryData?.user_name || session.name,
      sender_email: entryData?.sender_email || '',
      sent_at: sentAtMs,
      client_id: entryData?.client_id || '',
      client_name: entryData?.client_name || '',
      work_category: entryData?.work_category_name || '',
      work_subcategory: entryData?.work_subcategory_name || '',
      tags,
      keywords,
      summary,
      archive_note: '',
      is_template: isTemplate,
      source_type: 'approval',
      registered_by_id: entryData?.user_id || '',
      registered_by_name: entryData?.user_name || '',
      archived_by_id: session.id,
      archived_by_name: session.name,
      archived_at: new Date().toISOString(),
      view_count: 0,
      helpful_count: 0,
      status: 'active'
    };
    const ref = await API.create('mail_references', refPayload);

    // 4. 기존 attachments → doc_texts 복사 (PDF는 텍스트 자동 추출 시도)
    for (const [i, att] of attachmentDocs.entries()) {
      const fileType = att.file_type || 'other';
      const content  = att.file_content || '';
      let extractedText = '';
      let extractStatus = 'pending';
      let pageCount = 0;

      // PDF Base64 → PDF.js로 텍스트 추출 시도
      if (fileType === 'pdf' && content) {
        try {
          const result = await _extractPdfTextFromBase64(content);
          extractedText = result.text;
          pageCount     = result.pageCount;
          extractStatus = extractedText ? 'success' : 'failed';
        } catch(e) {
          extractStatus = 'failed';
        }
      }

      const fileObj = {
        fileName:      att.file_name || att.file_url || '첨부파일',
        fileType:      fileType,
        fileSize:      att.file_size || 0,
        content:       content,
        extractedText: extractedText,
        extractStatus: extractStatus,
        pageCount:     pageCount
      };
      await _saveDocText(ref.id, entryId, fileObj, i);
    }

    // 5. 검색 인덱스
    await _updateSearchIndex(ref.id);

    // ★ 관련 캐시 전체 무효화 (승인+저장 후 데이터 신선도 유지)
    Cache.invalidate('time_entries_list');
    Cache.invalidate('doc_texts_list');
    Cache.invalidate('ref_search_index_list');
    const _sessBadge = Session.get();
    if (_sessBadge) Cache.invalidate('time_entries_badge_' + _sessBadge.id);

    closeModal('archiveSaveModal');
    closeModal('approvalModal');
    Toast.success('승인 완료 + 자료실에 저장되었습니다. 🎉');

    // 승인 목록 새로고침
    if (typeof loadApprovalList === 'function') loadApprovalList();
    const _sess = Session.get();
    if (typeof updateApprovalBadge === 'function' && _sess) updateApprovalBadge(_sess, true);

    // ★ [문제3 수정] 자료실 탭 활성 여부와 관계없이 항상 갱신 플래그 세팅
    // 자료실이 열려있으면 즉시 갱신, 닫혀있으면 다음 진입 시 자동 갱신됨
    const archivePage = document.getElementById('page-archive');
    if (archivePage && archivePage.classList.contains('active')) {
      await loadArchiveList();
    } else {
      // 비활성 탭: 플래그를 세팅해 두면 init_archive 진입 시 자동 갱신
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

// TF-IDF 기반 단순 키워드 추출 (stopwords 제거)
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

// 다운로드 헬퍼 (entry.js/approval.js와 공유)
function downloadBase64File(dataUrl, fileName) {
  if (!dataUrl) { Toast.warning('파일 데이터가 없습니다.'); return; }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName || 'file';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
