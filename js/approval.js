/* ============================================
   approval.js — 승인 관리
   권한별 접근:
   - manager : 본인이 approver_id로 지정된 항목만 → 승인/반려 가능
   - director: 전체 열람 (읽기 전용, 승인 버튼 숨김)
   - admin   : 전체 열람 + 팀 필터 (읽기 전용, 운영 모니터링)
   ============================================ */

let _approvalTarget = null;
let _approvalPage = 1;
const APPROVAL_PER_PAGE = 20;
let _approvalModalAtts = []; // 승인 모달 첨부파일 임시 저장 (index 기반 다운로드용)

async function init_approval() {
  const session = getSession();
  // manager, director, admin만 접근 가능
  if (!Auth.canApprove(session) && !Auth.canViewDeptScope(session)) {
    navigateTo('dashboard');
    Toast.warning('접근 권한이 없습니다.');
    return;
  }

  // 기간 초기값: 최근 3개월 (승인 대기 항목 누락 방지)
  // → 이번 달만 보면 지난 달 제출 항목이 안 보이는 문제 해결
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  // from: 3개월 전 1일
  const fromDate = new Date(y, mo - 2, 1);
  const firstDay = `${fromDate.getFullYear()}-${String(fromDate.getMonth()+1).padStart(2,'0')}-01`;
  // to: 이번 달 말일
  const lastDay  = `${y}-${String(mo+1).padStart(2,'0')}-${String(new Date(y,mo+1,0).getDate()).padStart(2,'0')}`;
  document.getElementById('filter-approval-date-from').value = firstDay;
  document.getElementById('filter-approval-date-to').value   = lastDay;

  // ★ 상태 필터 기본값: 전체(빈값) — draft만 제외하고 모두 표시
  // (manager는 submitted+pre_approved 둘 다 검토 대상이므로)
  const statusEl = document.getElementById('filter-approval-status');
  if (statusEl) statusEl.value = '';

  // admin: 팀 필터 표시 (전체 열람 권한)
  // director: 소속 사업부/본부/고객지원팀 범위 안내 표시
  if (Auth.canViewAll(session)) {
    const teams = await Master.teams();
    const teamEl = document.getElementById('filter-approval-team');
    teamEl.innerHTML = '<option value="">전체 팀</option>';
    teams.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.team_name;
      opt.textContent = t.team_name;
      teamEl.appendChild(opt);
    });
    document.getElementById('filter-approval-team-group').style.display = '';
  } else {
    document.getElementById('filter-approval-team-group').style.display = 'none';
  }

  // 고객사 드롭다운 로드
  try {
    const clients = await Master.clients();
    const clientEl = document.getElementById('filter-approval-client');
    if (clientEl) {
      clientEl.innerHTML = '<option value="">전체 고객사</option>';
      clients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.company_name;
        clientEl.appendChild(opt);
      });
    }
  } catch(e) { console.warn('approval client filter load error', e); }

  // 업무 소분류 드롭다운 — time_entries에서 수집
  try {
    const er = await API.list('time_entries', { limit: 1000 });
    const entries = (er && er.data) ? er.data : [];
    const subSet = [...new Set(entries.map(e => e.work_subcategory_name).filter(Boolean))].sort();
    const subEl = document.getElementById('filter-approval-subcategory');
    if (subEl) {
      subEl.innerHTML = '<option value="">전체 소분류</option>';
      subSet.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        subEl.appendChild(opt);
      });
    }
  } catch(e) { console.warn('approval subcategory filter load error', e); }

  // director/admin 모드 안내 배너 (읽기 전용)
  const readonlyBanner = document.getElementById('approval-readonly-banner');
  if (readonlyBanner) {
    // manager는 승인/반려 가능, director/admin은 읽기 전용
    readonlyBanner.style.display = Auth.canViewDeptScope(session) && !Auth.canApprove(session) ? '' : 'none';
  }

  await loadApprovalList();
}

async function loadApprovalList() {
  const session      = getSession();
  const dateFrom     = document.getElementById('filter-approval-date-from').value;
  const dateTo       = document.getElementById('filter-approval-date-to').value;
  const staffKw      = (document.getElementById('filter-approval-staff').value || '').trim().toLowerCase();
  const teamFilter   = Auth.canViewAll(session)
    ? document.getElementById('filter-approval-team').value
    : '';
  const clientFilter = (document.getElementById('filter-approval-client')      || {}).value || '';
  const subFilter    = (document.getElementById('filter-approval-subcategory') || {}).value || '';
  const status       = document.getElementById('filter-approval-status').value;

  try {
    // ★ limit 1000으로 증가 (500 초과 시 누락 방지)
    const r = await API.list('time_entries', { limit: 1000 });
    let entries = (r && r.data) ? r.data : [];

    // 역할별 데이터 범위
    if (Auth.canViewAll(session)) {
      // admin: 전체 열람, 팀 필터 UI 적용
      if (teamFilter) entries = entries.filter(e => e.team_name === teamFilter);
    } else if (Auth.isDirector(session)) {
      // director: 소속 범위 OR reviewer2_id로 지정된 항목 열람
      const allUsers = await Master.users();
      const scopeUserIds = new Set(
        allUsers.filter(u => Auth.scopeMatch(session, u)).map(u => String(u.id))
      );
      entries = entries.filter(e =>
        scopeUserIds.has(String(e.user_id)) ||
        String(e.reviewer2_id) === String(session.id) ||
        String(e.approver_id)  === String(session.id)
      );
    } else if (Auth.canApprove(session)) {
      // manager: approver_id OR pre_approver_id가 본인인 항목
      // ★ String 비교로 UUID 타입 불일치 방지
      const myId = String(session.id);
      entries = entries.filter(e =>
        String(e.approver_id)     === myId ||
        String(e.pre_approver_id) === myId
      );
      if (entries.length === 0 && (r.data||[]).length > 0) {
        // approver_id 매칭 없음: 정상 예외 조건 (승인자 미지정 등)
      }
    } else {
      entries = entries.filter(e => String(e.approver_id) === String(session.id));
    }

    // 기간 필터 (From~To) — work_start_at이 ms숫자/숫자문자열/ISO문자열 모두 안전 처리
    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : 0;
      const to   = dateTo   ? new Date(dateTo   + 'T23:59:59').getTime() : Infinity;
      entries = entries.filter(e => {
        if (!e.work_start_at) return false;
        const raw = e.work_start_at;
        const num = Number(raw);
        let ts;
        if (!isNaN(num) && num > 1000000000000) {
          ts = num;               // ms 타임스탬프 (13자리)
        } else if (!isNaN(num) && num > 1000000000) {
          ts = num * 1000;        // sec 타임스탬프 (10자리)
        } else {
          ts = new Date(raw).getTime();  // ISO 문자열
        }
        if (isNaN(ts)) return false;
        return ts >= from && ts <= to;
      });
    }

    // Staff 이름 필터
    if (staffKw) {
      entries = entries.filter(e => (e.user_name || '').toLowerCase().includes(staffKw));
    }

    // 고객사 필터
    if (clientFilter) entries = entries.filter(e => e.client_id === clientFilter);

    // 업무 소분류 필터
    if (subFilter) entries = entries.filter(e => (e.work_subcategory_name || '') === subFilter);

    // 상태 필터 (전체='' 이면 draft 제외한 전체, 그 외 선택값으로 필터)
    if (status) {
      entries = entries.filter(e => e.status === status);
    } else {
      entries = entries.filter(e => e.status !== 'draft');
    }

    entries.sort((a, b) => new Date(a.work_start_at || 0) - new Date(b.work_start_at || 0));

    // ★ waitCount: 기간 필터와 무관하게 역할 범위 전체 기준으로 계산
    //   (사이드바 배지와 동일한 기준 → 불일치 방지)
    const session2 = getSession();
    const myId2 = String(session2.id);
    let waitCount = 0;

    // 전체 entries에서 역할별 범위로 재필터링 (기간 무관)
    let allRoleEntries = (r && r.data) ? r.data : [];
    if (Auth.canApprove1st(session2)) {
      // manager: 본인 approver_id인 submitted 건
      waitCount = allRoleEntries.filter(e =>
        (e.status === 'submitted' || e.status === 'pre_approved') &&
        (String(e.approver_id) === myId2 || String(e.pre_approver_id) === myId2)
      ).length;
    } else if (Auth.canApprove2nd(session2)) {
      // director: pre_approved 또는 submitted 중 본인 범위
      waitCount = allRoleEntries.filter(e =>
        (e.status === 'pre_approved' || e.status === 'submitted') &&
        (String(e.reviewer2_id) === myId2 || String(e.approver_id) === myId2)
      ).length;
    } else {
      waitCount = allRoleEntries.filter(e =>
        (e.status === 'submitted' || e.status === 'pre_approved') &&
        String(e.approver_id) === myId2
      ).length;
    }
    const badge = document.getElementById('approval-count-badge');
    if (waitCount > 0) {
      badge.className = 'badge badge-red';
      badge.style = '';
      badge.textContent = `${waitCount}건 검토 대기`;
    } else {
      badge.className = '';
      badge.style.cssText = 'font-size:12px;color:var(--text-muted);font-weight:400';
      badge.textContent = `0건 검토 대기`;
    }

    // 첨부파일 맵
    const attMap = await loadAttachmentsMap(entries.map(e => e.id));

    const start = (_approvalPage - 1) * APPROVAL_PER_PAGE;
    const paged = entries.slice(start, start + APPROVAL_PER_PAGE);

    const tbody = document.getElementById('approval-list-body');
    if (paged.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" class="table-empty"><i class="fas fa-check-circle" style="color:var(--success)"></i><p>검토 대기 중인 항목이 없습니다.</p></td></tr>`;
    } else {
      const canDoApprove = Auth.canApprove(session); // manager만 true

      // ── 날짜·시간 포맷 헬퍼 (My Time Sheet와 동일) ──────────
      const fmtDate = (ms) => {
        if (!ms) return '<span style="color:var(--text-muted)">—</span>';
        const d = new Date(Number(ms));
        return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
      };
      const fmtDatetime = (ms) => {
        if (!ms) return '<span style="color:var(--text-muted)">—</span>';
        const d = new Date(Number(ms));
        const mo = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        const hh = String(d.getHours()).padStart(2,'0');
        const mi = String(d.getMinutes()).padStart(2,'0');
        return `<span style="font-size:11.5px;white-space:nowrap">${mo}.${dd}&nbsp;<span style="color:var(--text-secondary)">${hh}:${mi}</span></span>`;
      };

      // ── 버튼 스타일 (My Time Sheet와 동일 30×30px) ──────────
      const B = 'width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;background:transparent;border:none;cursor:pointer;transition:background 0.15s;';

      tbody.innerHTML = paged.map((e, idx) => {
        const rowNo     = ((_approvalPage - 1) * APPROVAL_PER_PAGE) + idx + 1;
        const writtenAt = e.created_at ? fmtDate(e.created_at) : fmtDate(e.work_start_at);

        // 고객사
        const clientHtml = e.client_name
          ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12.5px" title="${Utils.escHtml(e.client_name)}">${Utils.escHtml(e.client_name)}</span>`
          : `<span style="color:var(--text-muted);font-size:11px">내부</span>`;

        // 소분류
        const subHtml = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12.5px"
              title="${Utils.escHtml(e.work_subcategory_name||'')}">
          ${Utils.escHtml(e.work_subcategory_name||'—')}
        </span>`;

        // 관리 버튼 — 상세보기만 (승인/반려는 상세 모달에서 품질 평가 후 처리)
        const btns = [];
        btns.push(`<button style="${B}" onclick="openApprovalModal('${e.id}')" title="상세보기"><i class="fas fa-eye" style="font-size:13px;color:#94a3b8"></i></button>`);

        return `<tr>
          <td style="text-align:center;color:var(--text-muted);font-size:12px;font-variant-numeric:tabular-nums">${rowNo}</td>
          <td style="font-size:12px;white-space:nowrap;color:var(--text-secondary)">${writtenAt}</td>
          <td style="padding:0 8px">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12.5px;font-weight:600" title="${Utils.escHtml(e.user_name||'')}">${Utils.escHtml(e.user_name||'—')}</span>
          </td>
          <td style="padding:0 8px">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12px;color:var(--text-secondary)" title="${Utils.escHtml(e.approver_name||'')}">${Utils.escHtml(e.approver_name||'—')}</span>
          </td>
          <td style="padding:0 8px">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;font-size:12px;color:var(--text-secondary)" title="${Utils.escHtml(e.team_name||'')}">${Utils.escHtml(e.team_name||'—')}</span>
          </td>
          <td style="padding:0 10px">${clientHtml}</td>
          <td style="padding:0 10px">${subHtml}</td>
          <td style="text-align:center;padding:0 6px">${fmtDatetime(e.work_start_at)}</td>
          <td style="text-align:center;padding:0 6px">${fmtDatetime(e.work_end_at)}</td>
          <td style="text-align:center;font-size:12.5px;font-weight:600;color:var(--text-secondary)">${Utils.formatDuration(e.duration_minutes)}</td>
          <td style="text-align:center">${Utils.statusBadge(e.status)}</td>
          <td style="text-align:center;padding:0 4px">
            <div style="display:flex;gap:4px;justify-content:center;align-items:center">${btns.join('')}</div>
          </td>
        </tr>`;
      }).join('');
    }

    document.getElementById('approval-pagination').innerHTML =
      Utils.paginationHTML(_approvalPage, entries.length, APPROVAL_PER_PAGE);

  } catch (err) {
    console.error(err);
    Toast.error('데이터 로드 실패');
  }
}

function resetApprovalFilter() {
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  document.getElementById('filter-approval-date-from').value =
    `${y}-${String(mo+1).padStart(2,'0')}-01`;
  document.getElementById('filter-approval-date-to').value =
    `${y}-${String(mo+1).padStart(2,'0')}-${String(new Date(y,mo+1,0).getDate()).padStart(2,'0')}`;
  document.getElementById('filter-approval-status').value = 'submitted';
  document.getElementById('filter-approval-staff').value = '';
  const teamEl = document.getElementById('filter-approval-team');
  if (teamEl) teamEl.value = '';
  const clientEl = document.getElementById('filter-approval-client');
  if (clientEl) clientEl.value = '';
  const subEl = document.getElementById('filter-approval-subcategory');
  if (subEl) subEl.value = '';
  _approvalPage = 1;
  loadApprovalList();
}
// ══════════════════════════════════════════════
// 공통 상수 — 평가 매핑
// ══════════════════════════════════════════════
const RATING_STARS  = { very_unsatisfied: 0, unsatisfied: 0, normal: 1, satisfied: 2, very_satisfied: 3 };
const RATING_LABEL  = { very_unsatisfied: '매우미흡', unsatisfied: '미흡', normal: '참고', satisfied: '우수', very_satisfied: '매우우수' };
const RATING_ORDER  = ['very_unsatisfied', 'unsatisfied', 'normal', 'satisfied', 'very_satisfied'];
const PERF_LABEL    = { independent: '독립수행', guided: '지도수행', supervised: '감독수행' };
const PERF_DEDUCT   = { independent: 0, guided: 1, supervised: 2 };
const ARCHIVE_RATINGS = ['normal', 'satisfied', 'very_satisfied'];

/** 품질평가 + 수행방식 → 전문성 별점/등급 자동 계산
 *  RATING_ORDER 인덱스 기준으로 단계 차감:
 *  very_unsatisfied=0, unsatisfied=1, normal=2, satisfied=3, very_satisfied=4
 *  감독수행 -2단계: satisfied(3) → unsatisfied(1)
 *  지도수행 -1단계: satisfied(3) → normal(2)
 */
function calcCompetency(qualityRating, performanceType) {
  const qIdx    = RATING_ORDER.indexOf(qualityRating);
  if (qIdx < 0) return { competency_stars: 0, competency_rating: 'very_unsatisfied' };
  const deduct  = PERF_DEDUCT[performanceType] ?? 0;
  const cIdx    = Math.max(0, qIdx - deduct);
  const cRating = RATING_ORDER[cIdx];
  const cStars  = RATING_STARS[cRating] ?? 0;
  return { competency_stars: cStars, competency_rating: cRating };
}

// ══════════════════════════════════════════════
// 추출 텍스트 확인 / 수동 추출 (승인·담당자 모달 공통)
// ══════════════════════════════════════════════

/** 현재 열린 모달의 atts 캐시 (id → attachment 객체) */
const _apvAttsCache = {};

/** atts 배열을 캐시에 등록 */
function _apvCacheAtts(atts) {
  (atts || []).forEach(a => { if (a.id) _apvAttsCache[a.id] = a; });
}

/** 추출 텍스트 확인 모달 */
function _apvShowExtractedText(attId) {
  const a = _apvAttsCache[attId];
  if (!a || !a.extracted_text) { Toast.warning('추출된 텍스트가 없습니다.'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.style.zIndex = '10001';

  const modal = document.createElement('div');
  modal.className = 'modal modal-lg';
  modal.style.cssText = 'max-width:680px;border-radius:14px;overflow:hidden';

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
  closeBtn.className = 'btn-close'; closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);

  const subHeader = document.createElement('div');
  subHeader.style.cssText = 'background:#f5f3ff;padding:8px 20px;border-bottom:1px solid #e9d5ff;font-size:12px;color:#5b21b6;display:flex;align-items:center;gap:6px';
  subHeader.innerHTML = `<i class="fas fa-file" style="font-size:11px"></i> <strong>${Utils.escHtml(a.file_name || '파일명 없음')}</strong>`;

  const body = document.createElement('div');
  body.className = 'modal-body';
  body.style.cssText = 'padding:16px 20px;max-height:60vh;overflow-y:auto';

  const notice = document.createElement('div');
  notice.style.cssText = 'background:#fdf4ff;border:1px solid #e9d5ff;border-radius:8px;padding:10px 14px;font-size:12px;color:#6b21a8;display:flex;gap:8px;align-items:flex-start;margin-bottom:14px';
  notice.innerHTML = `<i class="fas fa-info-circle" style="margin-top:1px;flex-shrink:0"></i>
    <span>원본 파일에서 추출 후 민감정보(금액·수입신고번호·고객사명 등)가 자동 마스킹된 내용입니다.<br>원본 파일은 변경되지 않습니다.</span>`;
  body.appendChild(notice);

  const textBox = document.createElement('pre');
  textBox.style.cssText = 'background:#f8fafc;border:1px solid var(--border-light);border-radius:8px;padding:14px 16px;font-size:12px;line-height:1.8;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;max-height:40vh;overflow-y:auto;font-family:inherit';
  textBox.textContent = a.extracted_text;
  body.appendChild(textBox);

  const charCount = document.createElement('div');
  charCount.style.cssText = 'text-align:right;font-size:11px;color:var(--text-muted);margin-top:6px';
  charCount.textContent = `총 ${a.extracted_text.length.toLocaleString()}자`;
  body.appendChild(charCount);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  footer.style.cssText = 'padding:12px 20px;background:#faf5ff;border-top:1px solid #e9d5ff;display:flex;justify-content:flex-end';
  const closeFooterBtn = document.createElement('button');
  closeFooterBtn.className = 'btn btn-outline';
  closeFooterBtn.innerHTML = '<i class="fas fa-times"></i> 닫기';
  closeFooterBtn.addEventListener('click', () => overlay.remove());
  footer.appendChild(closeFooterBtn);

  modal.appendChild(header); modal.appendChild(subHeader);
  modal.appendChild(body);   modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.addEventListener('keydown', function escH(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escH); }
  });
}

/** 수동 텍스트 추출 + 마스킹 + DB 저장 */
async function _apvExtractAndMask(attId, idx) {
  const a = _apvAttsCache[attId];
  if (!a || !a.file_content) { Toast.warning('파일 데이터가 없습니다.'); return; }

  const btn = document.getElementById(`apv-extract-btn-${attId}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 추출 중...'; }

  try {
    const { blob } = _base64ToBlob(a.file_content);
    const file = new File([blob], a.file_name || 'file', { type: blob.type });
    const { text: rawText, status: extStatus } = await _extractTextFromFile(file);

    if (extStatus === 'ppt')      { Toast.warning('⚠️ PPT 파일은 PDF로 변환 후 업로드해주세요.'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기'; } return; }
    if (extStatus === 'scan_pdf') { Toast.warning('⚠️ 스캔된 PDF로 감지됨. 텍스트 추출이 불가합니다.'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기'; } return; }
    if (!rawText)                 { Toast.warning('텍스트를 추출할 수 없습니다.'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기'; } return; }

    const maskedText = await _maskSensitiveText(rawText);
    await API.patch('attachments', a.id, { extracted_text: maskedText });
    a.extracted_text = maskedText;

    if (btn) {
      btn.id = '';
      btn.style.cssText = 'white-space:nowrap;margin-top:6px;color:#6d28d9;border-color:#c4b5fd';
      btn.className = 'btn btn-sm btn-outline';
      btn.innerHTML = '<i class="fas fa-shield-alt"></i> 추출 텍스트 확인';
      btn.onclick = () => _apvShowExtractedText(attId);
      btn.disabled = false;
    }
    Toast.success(`✅ 텍스트 추출 및 마스킹 완료 (${maskedText.length.toLocaleString()}자)`);
  } catch (err) {
    Toast.error('추출 실패: ' + (err.message || ''));
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-magic"></i> 텍스트 추출하기'; }
  }
}

// ══════════════════════════════════════════════
// 공통: 업무 내용 HTML 생성
// ══════════════════════════════════════════════
function _buildEntryDetailHtml(entry, atts) {
  const fmtDt = (ms) => {
    if (!ms) return '<span style="color:var(--text-muted)">—</span>';
    const d = new Date(Number(ms));
    return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  const attHtml = atts.length > 0
    ? atts.map((a, idx) => {
        const iconMap  = { excel:'fa-file-excel', word:'fa-file-word', ppt:'fa-file-powerpoint', pdf:'fa-file-pdf', link:'fa-link' };
        const colorMap = { excel:'#16a34a', word:'#1d4ed8', ppt:'#c2410c', pdf:'#b91c1c', link:'#7c3aed' };
        const hasContent = a.file_content && a.file_content.startsWith('data:');
        const hasUrl     = a.file_url && a.file_url.startsWith('http');
        const safeId     = (a.id || '').replace(/'/g, "\\'");

        let actionBtn = hasContent
          ? `<button class="btn btn-sm btn-primary" onclick="downloadApprovalFile(${idx})" style="white-space:nowrap;margin-top:6px"><i class="fas fa-eye"></i> 미리보기</button>`
          : hasUrl
          ? `<a href="${a.file_url}" target="_blank" class="btn btn-sm btn-outline" style="white-space:nowrap;margin-top:6px;display:inline-block"><i class="fas fa-external-link-alt"></i> 링크 열기</a>`
          : `<div style="margin-top:6px;font-size:11px;color:#94a3b8"><i class="fas fa-info-circle"></i> 이메일/공유폴더 확인</div>`;

        let extractBtn = '';
        if (a.extracted_text) {
          extractBtn = `<button class="btn btn-sm btn-outline" onclick="_apvShowExtractedText('${safeId}')"
            style="white-space:nowrap;margin-top:6px;color:#6d28d9;border-color:#c4b5fd">
            <i class="fas fa-shield-alt"></i> 추출 텍스트 확인</button>`;
        } else if (hasContent) {
          extractBtn = `<button class="btn btn-sm btn-outline" id="apv-extract-btn-${safeId}"
            onclick="_apvExtractAndMask('${safeId}', ${idx})"
            style="white-space:nowrap;margin-top:6px;color:#b45309;border-color:#fcd34d">
            <i class="fas fa-magic"></i> 텍스트 추출하기</button>`;
        }
        actionBtn = `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${actionBtn}${extractBtn}</div>`;
        return `<div style="display:flex;align-items:flex-start;gap:12px;padding:10px 12px;background:#f8fafc;border:1px solid var(--border-light);border-radius:8px;margin-bottom:6px">
          <i class="fas ${iconMap[a.file_type]||'fa-file'}" style="color:${colorMap[a.file_type]||'#6b7280'};font-size:22px;margin-top:2px;flex-shrink:0"></i>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;word-break:break-all">${a.file_name||'파일명 없음'}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:3px">
              ${a.doc_type  ? `<span style="background:#e0f2fe;color:#0369a1;border-radius:4px;padding:1px 6px;font-size:11px">${a.doc_type}</span>` : ''}
              ${a.file_size ? `<span style="color:var(--text-muted);font-size:11px">${a.file_size}KB</span>` : ''}
              ${hasContent  ? `<span style="background:#dcfce7;color:#15803d;border-radius:4px;padding:1px 6px;font-size:11px"><i class="fas fa-check-circle" style="font-size:9px"></i> 저장됨</span>` : ''}
            </div>
            ${actionBtn}
          </div>
        </div>`;
      }).join('')
    : '<div style="color:var(--text-muted);font-size:13px;padding:8px 0"><i class="fas fa-folder-open"></i> 첨부된 결과물이 없습니다.</div>';

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div><span style="font-size:11px;color:var(--text-muted)">Staff</span><div style="font-weight:600;margin-top:2px">${entry.user_name||'-'}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">수행팀</span><div style="font-weight:600;margin-top:2px">${entry.team_name||'-'}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">고객사</span><div style="font-weight:600;margin-top:2px">${entry.client_name||'내부업무'}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">대분류</span><div style="margin-top:2px">${entry.work_category_name||'-'}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">소분류</span>
        <div style="margin-top:2px">
          <input id="approval-edit-subcat" type="text" value="${entry.work_subcategory_name||''}" disabled
            style="width:100%;font-size:13px;padding:3px 6px;border-radius:6px;border:1px solid transparent;background:#f8fafc;color:var(--text-primary);box-sizing:border-box"/>
        </div>
      </div>
      <div><span style="font-size:11px;color:var(--text-muted)">시작일시</span><div style="margin-top:2px">${fmtDt(entry.work_start_at)}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">종료일시</span><div style="margin-top:2px">${fmtDt(entry.work_end_at)}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">소요시간</span><div style="font-weight:700;color:var(--primary);margin-top:2px">${Utils.formatDurationLong(entry.duration_minutes)}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">현재 상태</span><div style="margin-top:2px">${Utils.statusBadge(entry.status)}</div></div>
      <div><span style="font-size:11px;color:var(--text-muted)">승인자</span>
        <div style="margin-top:2px">${entry.approver_name
          ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;border-radius:5px;padding:2px 7px;font-size:12px"><i class="fas fa-user-check" style="font-size:10px"></i>${entry.approver_name}</span>`
          : '<span style="color:var(--text-muted);font-size:12px">미지정</span>'}</div>
      </div>
    </div>
    <div style="margin-bottom:12px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">수행 내용</div>
      <div id="approval-desc-view" class="approval-desc-view-box arch-desc-view"
        style="width:100%;font-size:13px;line-height:1.75;padding:10px 12px;border-radius:8px;border:1px solid var(--border-light);background:#f8fafc;color:var(--text-primary);box-sizing:border-box;font-family:inherit;min-height:80px;max-height:320px;overflow-y:auto;word-break:break-word;overflow-x:auto">
        ${(entry.work_description||'').trim()
          ? (entry.work_description.startsWith('<') ? entry.work_description : '<p>' + Utils.escHtml(entry.work_description) + '</p>')
          : '<span style="color:var(--text-muted);font-size:12px">(내용 없음)</span>'}
      </div>
      <div id="approval-edit-quill-wrap" style="display:none;border-radius:8px;overflow:hidden;border:1.5px solid var(--primary)">
        <div id="approval-edit-quill" style="min-height:160px;font-size:13px;background:#fff"></div>
      </div>
    </div>
    ${entry.time_category === 'client' ? (() => {
      let kwQ = [], kwR = [], lawR = [];
      try { kwQ = Array.isArray(entry.kw_query) ? entry.kw_query : (entry.kw_query ? JSON.parse(entry.kw_query) : []); } catch {}
      try { kwR = Array.isArray(entry.kw_reason) ? entry.kw_reason : (entry.kw_reason ? JSON.parse(entry.kw_reason) : []); } catch {}
      try { lawR = typeof entry.law_refs === 'string' ? JSON.parse(entry.law_refs || '[]') : (entry.law_refs || []); } catch {}
      const tagBadge = (arr, bg, clr) => arr.map(t => `<span style="display:inline-flex;align-items:center;background:${bg};color:${clr};border-radius:5px;padding:2px 8px;font-size:11px;margin:2px">${Utils.escHtml(String(t))}</span>`).join('');
      const lawBadge = (arr) => arr.map(r => `<span style="display:inline-flex;align-items:center;gap:3px;background:#ede9fe;color:#5b21b6;border-radius:5px;padding:2px 8px;font-size:11px;margin:2px"><i class="fas fa-balance-scale" style="font-size:9px"></i>${Utils.escHtml((r.law||'') + (r.article?' '+r.article:''))}</span>`).join('');
      const viewContent = (!kwQ.length && !kwR.length && !lawR.length)
        ? ''
        : `<div style="background:#f8f9ff;border:1px solid #c7d2fe;border-radius:10px;padding:12px 14px">
          <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:8px;display:flex;align-items:center;gap:5px"><i class="fas fa-tags"></i> 자문 분류 정보</div>
          ${kwQ.length ? `<div style="margin-bottom:6px"><span style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">핵심키워드</span>${tagBadge(kwQ,'#e0e7ff','#3730a3')}</div>` : ''}
          ${lawR.length ? `<div style="margin-bottom:6px"><span style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">관련법령</span>${lawBadge(lawR)}</div>` : ''}
          ${kwR.length ? `<div><span style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">판단사유</span>${tagBadge(kwR,'#f0fdf4','#166534')}</div>` : ''}
        </div>`;
      return `<div style="margin-bottom:12px">
        <div id="approval-kw-view" style="${!viewContent ? 'display:none' : ''}">${viewContent}</div>
        <div id="approval-kw-edit"></div>
      </div>`;
    })() : ''}
    <div style="margin-bottom:14px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-weight:600;display:flex;align-items:center;gap:6px">
        <i class="fas fa-paperclip"></i> 첨부 결과물 (${atts.length}건)
      </div>
      ${attHtml}
    </div>`;
}

/** 평가 버튼 5개 HTML */
function _buildRatingBtns(name) {
  const items = [
    { value:'very_unsatisfied', icon:'fa-times-circle',  color:'#ef4444', label:'매우미흡' },
    { value:'unsatisfied',      icon:'fa-minus-circle',  color:'#f97316', label:'미흡'     },
    { value:'normal',           icon:'fa-check-circle',  color:'#6b7280', label:'참고 ★'   },
    { value:'satisfied',        icon:'fa-check-circle',  color:'#2563eb', label:'우수 ★★'  },
    { value:'very_satisfied',   icon:'fa-award',         color:'#f59e0b', label:'매우우수 ★★★' },
  ];
  return `<div style="display:flex;gap:6px;flex-wrap:wrap" data-rating-group="${name}">
    ${items.map(it => `
      <label class="quality-btn" data-value="${it.value}" data-group="${name}"
        style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;
               padding:8px 10px;border-radius:8px;border:2px solid #e5e7eb;background:#fff;
               transition:all 0.15s;flex:1;min-width:66px">
        <input type="radio" name="${name}" value="${it.value}" style="display:none">
        <i class="fas ${it.icon}" style="font-size:16px;color:${it.color}"></i>
        <span style="font-size:10px;color:#6b7280;font-weight:600;letter-spacing:-0.2px;text-align:center">${it.label}</span>
      </label>`).join('')}
  </div>`;
}
// ══════════════════════════════════════════════
// 승인 모달 열기 — 1차(manager) / 2차(director) 자동 분기
// ══════════════════════════════════════════════
async function openApprovalModal(entryId, focusReject = false) {
  try {
    const _rb = document.getElementById('rejectBtn');
    const _ab = document.getElementById('approveBtn');
    const _eb = document.getElementById('editEntryBtn');
    if (_rb) { _rb.disabled = false; _rb.innerHTML = '<i class="fas fa-times"></i> 반려'; }
    if (_ab) { _ab.disabled = false; _ab.innerHTML = '<i class="fas fa-check"></i> 승인'; }
    if (_eb) { _eb.disabled = false; _eb.innerHTML = '<i class="fas fa-edit"></i> 수정'; }

    _approvalQuill = null;
    _approvalEditMode = false;

    const entry = await API.get('time_entries', entryId);
    if (!entry) return;
    _approvalTarget = entry;

    const attR = await API.list('attachments', { limit: 500 });
    const atts = (attR && attR.data) ? attR.data.filter(a => a.entry_id === entryId) : [];
    _approvalModalAtts = atts;
    _apvCacheAtts(atts);

    const session = getSession ? getSession() : null;

    const is1st = Auth.canApprove1st(session) && entry.status === 'submitted';
    const is2nd = Auth.canApprove2nd(session) && (
      entry.status === 'pre_approved' ||
      (entry.status === 'submitted' && String(entry.reviewer2_id) === String(session.id))
    );

    if (is1st) {
      _openApprovalModal1st(entry, atts, session);
    } else if (is2nd) {
      _openApprovalModal2nd(entry, atts, session);
    } else {
      _openApprovalModalReadonly(entry, atts, session);
    }

    openModal('approvalModal');
    if (focusReject) setTimeout(() => document.getElementById('approval-comment')?.focus(), 100);
  } catch (err) {
    Toast.error('데이터 로드 실패');
    console.error(err);
  }
}

// ── 1차 승인 모달 (manager용) ────────────────────────────────
function _openApprovalModal1st(entry, atts, session) {
  document.getElementById('approvalModalTitle').textContent = '업무기록 1차 검토';
  document.getElementById('approvalModalBody').innerHTML = `
    ${_buildEntryDetailHtml(entry, atts)}

    <!-- 수행방식 선택 (필수) -->
    <div style="margin-bottom:14px;padding:14px 16px;background:#f8fafc;border-radius:10px;border:1px solid var(--border-light)">
      <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:10px">
        <i class="fas fa-user-check" style="color:#2563eb"></i> 수행방식 확인 <span style="color:var(--danger)">*</span>
        <span style="font-size:11px;font-weight:400;color:var(--text-muted);margin-left:4px">(전문성 평가 기준)</span>
      </div>
      <div style="display:flex;gap:8px">
        ${[
          { value:'independent', icon:'fa-user',       color:'#16a34a', label:'독립수행', desc:'혼자 완성' },
          { value:'guided',      icon:'fa-hands-helping', color:'#2563eb', label:'지도수행', desc:'지도 후 완성' },
          { value:'supervised',  icon:'fa-eye',        color:'#f97316', label:'감독수행', desc:'전면 감독 완성' },
        ].map(p => `
          <label class="perf-btn" data-value="${p.value}"
            style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;
                   padding:10px 12px;border-radius:8px;border:2px solid #e5e7eb;background:#fff;
                   flex:1;transition:all 0.15s">
            <input type="radio" name="performance_type" value="${p.value}" style="display:none">
            <i class="fas ${p.icon}" style="font-size:18px;color:${p.color}"></i>
            <span style="font-size:11px;font-weight:700;color:#1a2b45">${p.label}</span>
            <span style="font-size:10px;color:#9aa4b2">${p.desc}</span>
          </label>`).join('')}
      </div>
      <div id="perf-warn" style="display:none;margin-top:8px;font-size:11px;color:#ef4444">
        <i class="fas fa-exclamation-circle"></i> 수행방식을 선택해주세요.
      </div>
    </div>

    <!-- 검토 의견 -->
    <div>
      <label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:6px">
        검토 의견 <span style="color:var(--danger)">* (반려 시 필수)</span>
      </label>
      <textarea class="form-control" id="approval-comment" rows="3" placeholder="검토 의견을 입력하세요."></textarea>
    </div>`;

  document.getElementById('editEntryBtn').style.display  = '';
  document.getElementById('rejectBtn').style.display     = '';
  const approveBtn = document.getElementById('approveBtn');
  approveBtn.style.display  = '';
  approveBtn.innerHTML      = '<i class="fas fa-arrow-right"></i> 1차 승인';
  approveBtn.onclick        = () => processApproval1st('pre_approved');

  const rejectBtn = document.getElementById('rejectBtn');
  rejectBtn.onclick = () => processApproval1st('rejected');

  setTimeout(() => {
    document.querySelectorAll('.perf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.perf-btn').forEach(b => { b.style.border = '2px solid #e5e7eb'; b.style.background = '#fff'; });
        btn.style.border = '2px solid var(--primary)';
        btn.style.background = '#eff6ff';
        document.getElementById('perf-warn').style.display = 'none';
      });
    });
  }, 50);
}

// ── 2차 승인 모달 (director용) ────────────────────────────────
function _openApprovalModal2nd(entry, atts, session) {
  const isManagerDirect = entry.status === 'submitted';
  const perfType = entry.performance_type || '';
  const preApproverBanner = entry.pre_approver_name
    ? `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                   background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-bottom:14px">
         <i class="fas fa-check-circle" style="color:#16a34a;font-size:16px;flex-shrink:0"></i>
         <div>
           <span style="font-size:12px;font-weight:600;color:#15803d">1차 승인 완료</span>
           <span style="font-size:11px;color:#166534;margin-left:8px">${entry.pre_approver_name}</span>
           ${perfType ? `<span style="margin-left:8px;background:#dcfce7;color:#15803d;border-radius:4px;padding:1px 7px;font-size:11px">${PERF_LABEL[perfType]||perfType}</span>` : ''}
         </div>
       </div>`
    : '';

  document.getElementById('approvalModalTitle').textContent = '업무기록 최종 승인 (2차)';
  document.getElementById('approvalModalBody').innerHTML = `
    ${_buildEntryDetailHtml(entry, atts)}
    ${preApproverBanner}

    ${isManagerDirect ? `
    <div style="margin-bottom:14px;padding:14px 16px;background:#fff7ed;border-radius:10px;border:1px solid #fed7aa">
      <div style="font-size:12px;font-weight:600;color:#9a3412;margin-bottom:10px">
        <i class="fas fa-user-check" style="color:#f97316"></i> 수행방식 확인 <span style="color:var(--danger)">*</span>
        <span style="font-size:11px;font-weight:400;color:#c2410c;margin-left:4px">(팀장 본인 건 — 직접 선택)</span>
      </div>
      <div style="display:flex;gap:8px">
        ${[
          { value:'independent', icon:'fa-user',          color:'#16a34a', label:'독립수행', desc:'혼자 완성' },
          { value:'guided',      icon:'fa-hands-helping', color:'#2563eb', label:'지도수행', desc:'지도 후 완성' },
          { value:'supervised',  icon:'fa-eye',           color:'#f97316', label:'감독수행', desc:'전면 감독 완성' },
        ].map(p => `
          <label class="perf-btn" data-value="${p.value}"
            style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;
                   padding:10px 12px;border-radius:8px;border:2px solid #e5e7eb;background:#fff;
                   flex:1;transition:all 0.15s">
            <input type="radio" name="performance_type" value="${p.value}" style="display:none">
            <i class="fas ${p.icon}" style="font-size:18px;color:${p.color}"></i>
            <span style="font-size:11px;font-weight:700;color:#1a2b45">${p.label}</span>
            <span style="font-size:10px;color:#9aa4b2">${p.desc}</span>
          </label>`).join('')}
      </div>
    </div>` : ''}

    <!-- ① 내용 품질 평가 -->
    <div style="margin-bottom:14px;padding:14px 16px;background:#f8fafc;border-radius:10px;border:1px solid var(--border-light)">
      <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:10px">
        <i class="fas fa-star" style="color:#f59e0b"></i> ① 내용 품질 평가 <span style="color:var(--danger)">*</span>
      </div>
      ${_buildRatingBtns('quality_rating')}
      <div id="quality-archive-notice" style="display:none;margin-top:8px;font-size:11px;color:#15803d;background:#dcfce7;border-radius:6px;padding:5px 10px">
        <i class="fas fa-archive"></i> 충족 이상 평가 — DB 저장 자동 체크됩니다.
      </div>
    </div>

    <!-- ② 전문성 별점 자동 계산 미리보기 -->
    <div style="margin-bottom:14px;padding:12px 16px;background:#f0f9ff;border-radius:10px;border:1px solid #bae6fd">
      <div style="font-size:12px;font-weight:600;color:#0369a1;margin-bottom:8px">
        <i class="fas fa-calculator" style="color:#0284c7"></i> ② 전문성 별점 자동 계산
        <span style="font-size:11px;font-weight:400;color:#0369a1;margin-left:4px">(품질평가 × 수행방식)</span>
      </div>
      <div id="competency-preview" style="font-size:13px;color:#64748b">
        품질 평가를 선택하면 자동으로 계산됩니다.
      </div>
      <div style="margin-top:8px;font-size:11px;color:#64748b">
        <span style="background:#e0f2fe;border-radius:4px;padding:1px 6px">독립수행: 그대로</span>
        <span style="background:#e0f2fe;border-radius:4px;padding:1px 6px;margin-left:4px">지도수행: -1단계</span>
        <span style="background:#e0f2fe;border-radius:4px;padding:1px 6px;margin-left:4px">감독수행: -2단계</span>
      </div>
    </div>

    <!-- ③ 자료실 DB 저장 -->
    <div style="margin-bottom:14px;padding:12px 16px;background:#f8fafc;border-radius:10px;border:1px solid var(--border-light)">
      <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">
        <i class="fas fa-database" style="color:#6b7280"></i> ③ 자료실 DB 저장
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="archive-save-check"
          style="width:15px;height:15px;accent-color:var(--primary);cursor:pointer">
        <span style="font-size:13px;font-weight:500;color:var(--text-primary)">자료실에 저장</span>
      </label>
      <div style="margin-top:6px;font-size:11px;color:#f97316">
        <i class="fas fa-shield-alt"></i> 보안 민감 자료는 체크를 해제하세요.
      </div>
    </div>

    <!-- 검토 의견 -->
    <div>
      <label style="font-size:12px;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:6px">
        검토 의견 <span style="color:var(--danger)">* (반려 시 필수)</span>
      </label>
      <textarea class="form-control" id="approval-comment" rows="3" placeholder="검토 의견을 입력하세요."></textarea>
    </div>`;

  document.getElementById('editEntryBtn').style.display  = '';
  document.getElementById('rejectBtn').style.display     = '';
  const approveBtn = document.getElementById('approveBtn');
  approveBtn.style.display  = '';
  approveBtn.innerHTML      = '<i class="fas fa-check-double"></i> 최종 승인';
  approveBtn.onclick        = () => processApproval2nd('approved');

  const rejectBtn = document.getElementById('rejectBtn');
  rejectBtn.onclick = () => processApproval2nd('rejected');

  setTimeout(() => {
    const updatePreview = () => {
      const qRating  = document.querySelector('input[name="quality_rating"]:checked')?.value || null;
      const pType    = isManagerDirect
        ? (document.querySelector('input[name="performance_type"]:checked')?.value || 'independent')
        : (entry.performance_type || 'independent');
      const preview  = document.getElementById('competency-preview');
      const archiveCheck = document.getElementById('archive-save-check');
      const archiveNotice = document.getElementById('quality-archive-notice');

      if (qRating && preview) {
        const { competency_stars, competency_rating } = calcCompetency(qRating, pType);
        const starStr = '★'.repeat(competency_stars) + '☆'.repeat(3 - competency_stars);
        preview.innerHTML = `
          <span style="font-weight:600;color:#1a2b45">수행방식: ${PERF_LABEL[pType]||pType}</span>
          <span style="margin:0 8px;color:#94a3b8">×</span>
          <span style="font-weight:600;color:#1a2b45">품질: ${RATING_LABEL[qRating]||qRating}</span>
          <span style="margin:0 8px;color:#94a3b8">→</span>
          <span style="font-weight:700;color:#f59e0b;font-size:15px">${starStr}</span>
          <span style="margin-left:6px;font-size:12px;color:#475569">${RATING_LABEL[competency_rating]||''}</span>`;
        if (archiveCheck) archiveCheck.checked = ARCHIVE_RATINGS.includes(qRating);
        if (archiveNotice) archiveNotice.style.display = ARCHIVE_RATINGS.includes(qRating) ? '' : 'none';
      }
    };

    document.querySelectorAll('.quality-btn[data-group="quality_rating"]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.quality-btn[data-group="quality_rating"]').forEach(b => { b.style.border = '2px solid #e5e7eb'; b.style.background = '#fff'; });
        btn.style.border = '2px solid var(--primary)'; btn.style.background = '#eff6ff';
        updatePreview();
      });
    });
    if (isManagerDirect) {
      document.querySelectorAll('.perf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.perf-btn').forEach(b => { b.style.border = '2px solid #e5e7eb'; b.style.background = '#fff'; });
          btn.style.border = '2px solid var(--primary)'; btn.style.background = '#eff6ff';
          updatePreview();
        });
      });
    }
  }, 50);
}

// ── 읽기 전용 모달 (director 열람 / admin) ───────────────────
function _openApprovalModalReadonly(entry, atts, session) {
  document.getElementById('approvalModalTitle').textContent = '업무기록 상세보기';
  const prevEvalHtml = entry.quality_rating ? `
    <div style="margin-bottom:12px;padding:10px 14px;background:#f8fafc;border-radius:8px;border:1px solid var(--border-light)">
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">
        <div>
          <span style="font-size:11px;color:var(--text-muted)">내용 품질</span>
          <div style="font-weight:600;color:#1a2b45;margin-top:2px">${RATING_LABEL[entry.quality_rating]||''} ${'★'.repeat(RATING_STARS[entry.quality_rating]||0)}</div>
        </div>
        ${entry.performance_type ? `<div>
          <span style="font-size:11px;color:var(--text-muted)">수행방식</span>
          <div style="font-weight:600;color:#1a2b45;margin-top:2px">${PERF_LABEL[entry.performance_type]||''}</div>
        </div>` : ''}
        ${entry.competency_rating ? `<div>
          <span style="font-size:11px;color:var(--text-muted)">전문성</span>
          <div style="font-weight:600;color:#f59e0b;margin-top:2px">${'★'.repeat(entry.competency_stars||0)}${'☆'.repeat(3-(entry.competency_stars||0))} ${RATING_LABEL[entry.competency_rating]||''}</div>
        </div>` : ''}
      </div>
    </div>` : '';
  const prevCommentHtml = entry.reviewer_comment
    ? `<div class="alert alert-info"><i class="fas fa-comment"></i> <span>${entry.reviewer_comment}</span></div>`
    : '';

  document.getElementById('approvalModalBody').innerHTML =
    _buildEntryDetailHtml(entry, atts) + prevEvalHtml + prevCommentHtml;

  document.getElementById('editEntryBtn').style.display  = 'none';
  document.getElementById('rejectBtn').style.display     = 'none';
  document.getElementById('approveBtn').style.display    = 'none';
}
// ══════════════════════════════════════════════
// 1차 승인 처리 (manager)
// ══════════════════════════════════════════════
async function processApproval1st(decision) {
  if (!_approvalTarget) return;
  const session = getSession();
  const comment = document.getElementById('approval-comment')?.value.trim() || '';

  if (decision === 'rejected' && !comment) {
    Toast.warning('반려 사유를 입력해주세요.');
    document.getElementById('approval-comment')?.focus();
    return;
  }

  const perfType = document.querySelector('input[name="performance_type"]:checked')?.value || null;
  if (decision === 'pre_approved' && !perfType) {
    document.getElementById('perf-warn').style.display = '';
    document.querySelectorAll('.perf-btn').forEach(b => { b.style.border = '2px solid #ef4444'; });
    setTimeout(() => document.querySelectorAll('.perf-btn').forEach(b => { b.style.border = '2px solid #e5e7eb'; }), 1800);
    Toast.warning('수행방식을 선택해야 1차 승인할 수 있습니다.');
    return;
  }

  const approveBtn = document.getElementById('approveBtn');
  const rejectBtn  = document.getElementById('rejectBtn');
  const isApprove  = decision === 'pre_approved';
  const restoreBtn    = BtnLoading.start(isApprove ? approveBtn : rejectBtn, isApprove ? '1차 승인 중...' : '반려 처리 중...');
  const restoreOthers = BtnLoading.disableAll(isApprove ? rejectBtn : approveBtn);

  try {
    const patchData = {
      status:           decision,
      reviewer_comment: comment,
      reviewed_at:      Date.now(),
    };
    if (isApprove) {
      Object.assign(patchData, {
        pre_approver_id:   session.id,
        pre_approver_name: session.name || '',
        pre_approved_at:   Date.now(),
        performance_type:  perfType,
      });
    } else {
      Object.assign(patchData, {
        reviewer_id:   session.id,
        reviewer_name: session.name || '',
      });
    }
    const entry1st = _approvalTarget;
    await API.patch('time_entries', entry1st.id, patchData);

    if (typeof createNotification === 'function') {
      const summary1st = `${entry1st.client_name || entry1st.work_category_name} | ${entry1st.work_subcategory_name || ''}`;
      if (isApprove) {
        createNotification({
          toUserId: entry1st.user_id, toUserName: entry1st.user_name,
          fromUserId: session.id, fromUserName: session.name,
          type: 'pre_approved', entryId: entry1st.id, entrySummary: summary1st,
          message: `${session.name}님이 타임시트를 1차 승인했습니다. 본부장 최종 승인 대기 중입니다.`,
          targetMenu: 'my-entries',
        });
        if (entry1st.reviewer2_id) {
          createNotification({
            toUserId: entry1st.reviewer2_id, toUserName: entry1st.reviewer2_name,
            fromUserId: session.id, fromUserName: session.name,
            type: 'submitted', entryId: entry1st.id, entrySummary: summary1st,
            message: `${entry1st.user_name}님의 타임시트가 1차 승인되어 최종 승인을 기다리고 있습니다.`,
            targetMenu: 'approval',
          });
        }
      } else {
        createNotification({
          toUserId: entry1st.user_id, toUserName: entry1st.user_name,
          fromUserId: session.id, fromUserName: session.name,
          type: 'rejected', entryId: entry1st.id, entrySummary: summary1st,
          message: `${session.name}님이 타임시트를 반려했습니다. 사유를 확인하고 수정 후 재제출해주세요.`,
          targetMenu: 'my-entries',
        });
      }
    }

    restoreBtn(); restoreOthers();
    closeModal('approvalModal');
    _approvalTarget = null;
    Cache.invalidate('time_entries_list');
    Cache.invalidate('time_entries_badge_' + session.id);
    Cache.invalidate('dash_time_entries');
    window._dashNeedsRefresh = true;
    await updateApprovalBadge(session, true);
    loadApprovalList();
    Toast.success(isApprove ? '1차 승인 완료 — 본부장 최종 승인 대기' : '반려되었습니다.');
  } catch (err) {
    restoreBtn(); restoreOthers();
    Toast.error('처리 실패: ' + err.message);
  }
}

// ══════════════════════════════════════════════
// 2차 최종 승인 처리 (director)
// ══════════════════════════════════════════════
async function processApproval2nd(decision) {
  if (!_approvalTarget) return;
  const session = getSession();
  const comment = document.getElementById('approval-comment')?.value.trim() || '';

  if (decision === 'rejected' && !comment) {
    Toast.warning('반려 사유를 입력해주세요.');
    document.getElementById('approval-comment')?.focus();
    return;
  }

  const isManagerDirect = _approvalTarget.status === 'submitted';
  const qRating  = document.querySelector('input[name="quality_rating"]:checked')?.value || null;
  const perfType = isManagerDirect
    ? (document.querySelector('input[name="performance_type"]:checked')?.value || null)
    : (_approvalTarget.performance_type || 'independent');
  const shouldArchive = document.getElementById('archive-save-check')?.checked || false;

  if (decision === 'approved') {
    if (!qRating) {
      Toast.warning('내용 품질 평가를 선택해야 최종 승인할 수 있습니다.');
      document.querySelectorAll('.quality-btn[data-group="quality_rating"]').forEach(b => { b.style.border = '2px solid #ef4444'; });
      setTimeout(() => document.querySelectorAll('.quality-btn[data-group="quality_rating"]').forEach(b => { b.style.border = '2px solid #e5e7eb'; }), 1800);
      return;
    }
    if (isManagerDirect && !perfType) {
      Toast.warning('수행방식을 선택해주세요.');
      return;
    }
  }

  const approveBtn = document.getElementById('approveBtn');
  const rejectBtn  = document.getElementById('rejectBtn');
  const isApprove  = decision === 'approved';
  const restoreBtn    = BtnLoading.start(isApprove ? approveBtn : rejectBtn, isApprove ? '최종 승인 중...' : '반려 처리 중...');
  const restoreOthers = BtnLoading.disableAll(isApprove ? rejectBtn : approveBtn);

  const qualityStars = qRating ? (RATING_STARS[qRating] || 0) : 0;
  let competencyStars = 0, competencyRating = null;
  if (qRating && perfType) {
    const comp = calcCompetency(qRating, perfType);
    competencyStars  = comp.competency_stars;
    competencyRating = comp.competency_rating;
  }

  try {
    const patchData = {
      status:           decision,
      reviewer_id:      session.id,
      reviewer_name:    session.name || '',
      reviewer_comment: comment,
      reviewed_at:      Date.now(),
    };
    if (isApprove) {
      Object.assign(patchData, {
        is_archived:       shouldArchive,
        quality_rating:    qRating,
        quality_stars:     qualityStars,
        competency_rating: competencyRating,
        competency_stars:  competencyStars,
        performance_type:  perfType,
      });
      if (isManagerDirect) {
        Object.assign(patchData, {
          pre_approver_id:   session.id,
          pre_approver_name: session.name || '',
          pre_approved_at:   Date.now(),
        });
      }
    }
    await API.patch('time_entries', _approvalTarget.id, patchData);

    // ── 자료실 저장 ──────────────────────────────────
    if (isApprove && shouldArchive) {
      try {
        const entry = _approvalTarget;
        const starStr   = '★'.repeat(qualityStars) + '☆'.repeat(3 - qualityStars);
        const subject   = entry.work_subcategory_name
          ? `${entry.work_subcategory_name}${entry.client_name ? ' (' + entry.client_name + ')' : ''}`
          : (entry.client_name || entry.work_category_name || '업무기록');
        const tags      = [entry.work_category_name, entry.work_subcategory_name, entry.client_name].filter(Boolean).join(', ');
        const summary   = (entry.work_description || '').trim().substring(0, 200);
        const archivedAt = Date.now();

        const mailRef = await API.create('mail_references', {
          entry_id: entry.id, subject, body_text: entry.work_description||'',
          sender_name: entry.user_name||'', sender_email: '',
          client_id: entry.client_id||'', client_name: entry.client_name||'',
          work_category: entry.work_category_name||'', work_subcategory: entry.work_subcategory_name||'',
          tags, summary, sent_at: archivedAt, source_type: 'approval',
          registered_by_id: session.id, registered_by_name: session.name||'',
          archived_by_id: session.id, archived_by_name: session.name||'',
          archived_at: archivedAt, quality_rating: qRating,
          quality_stars: qualityStars, star_display: starStr, status: 'active',
        });

        if (mailRef && mailRef.id && _approvalModalAtts.length > 0) {
          await Promise.all(_approvalModalAtts.map((att, idx) =>
            API.create('doc_texts', {
              ref_id: mailRef.id, entry_id: entry.id,
              file_name: att.file_name||'첨부파일', file_type: att.file_type||'other',
              file_size: att.file_size||0, file_content: att.file_content||'',
              doc_type: att.doc_type === 'mail_pdf' ? 'mail_pdf' : 'normal',
              sort_order: idx, extract_status: 'pending',
            }).catch(e => console.warn('[저장] doc_texts 실패:', e))
          ));
        }

        await API.create('archive_items', {
          entry_id: entry.id, user_id: entry.user_id, user_name: entry.user_name,
          team_name: entry.team_name||'', client_name: entry.client_name||'',
          work_category_name: entry.work_category_name||'',
          work_subcategory_name: entry.work_subcategory_name||'',
          subject, summary, tags,
          quality_rating: qRating, quality_stars: qualityStars,
          quality_label: RATING_LABEL[qRating]||'', star_display: starStr,
          performance_type: perfType,
          competency_rating: competencyRating, competency_stars: competencyStars,
          archived_at: archivedAt, work_start_at: entry.work_start_at,
          duration_minutes: entry.duration_minutes||0,
        });

        Toast.success(`최종 승인 완료 · ${starStr} 자료실 저장`);
      } catch (archErr) {
        console.error('[자료실 저장 실패]', archErr);
        Toast.success('최종 승인 완료 (자료실 저장 실패)');
      }
    } else {
      Toast.success(isApprove ? '최종 승인 완료' : '반려되었습니다.');
    }

    if (typeof createNotification === 'function') {
      const entry2nd   = _approvalTarget;
      const summary2nd = `${entry2nd.client_name || entry2nd.work_category_name} | ${entry2nd.work_subcategory_name || ''}`;
      if (isApprove) {
        createNotification({
          toUserId: entry2nd.user_id, toUserName: entry2nd.user_name,
          fromUserId: session.id, fromUserName: session.name,
          type: 'approved', entryId: entry2nd.id, entrySummary: summary2nd,
          message: `${session.name}님이 타임시트를 최종 승인했습니다. 🎉`,
          targetMenu: 'my-entries',
        });
      } else {
        createNotification({
          toUserId: entry2nd.user_id, toUserName: entry2nd.user_name,
          fromUserId: session.id, fromUserName: session.name,
          type: 'rejected', entryId: entry2nd.id, entrySummary: summary2nd,
          message: `${session.name}님이 타임시트를 반려했습니다. 사유를 확인하고 수정 후 재제출해주세요.`,
          targetMenu: 'my-entries',
        });
      }
    }

    restoreBtn(); restoreOthers();
    closeModal('approvalModal');
    _approvalTarget = null;
    Cache.invalidate('time_entries_list');
    Cache.invalidate('time_entries_badge_' + session.id);
    Cache.invalidate('dash_time_entries');
    Cache.invalidate('dash_archive_stars');
    window._dashNeedsRefresh = true;
    await updateApprovalBadge(session, true);
    loadApprovalList();
  } catch (err) {
    restoreBtn(); restoreOthers();
    Toast.error('처리 실패: ' + err.message);
  }
}

/* ──────────────────────────────────────────
   인라인 수정 토글 (승인 모달 내)
────────────────────────────────────────── */
let _approvalEditMode = false;
let _approvalQuill = null;
let _editKwQuery  = [];
let _editKwReason = [];
let _editLawRefs  = [];

function _initApprovalKwEdit() {
  const t = _approvalTarget;
  try { _editKwQuery  = Array.isArray(t.kw_query)  ? [...t.kw_query]  : (t.kw_query  ? JSON.parse(t.kw_query)  : []); } catch { _editKwQuery  = []; }
  try { _editKwReason = Array.isArray(t.kw_reason) ? [...t.kw_reason] : (t.kw_reason ? JSON.parse(t.kw_reason) : []); } catch { _editKwReason = []; }
  try { _editLawRefs  = typeof t.law_refs === 'string' ? JSON.parse(t.law_refs || '[]') : (t.law_refs || []); } catch { _editLawRefs = []; }
  _editLawRefs = _editLawRefs.map(r => typeof r === 'string' ? { law: r, article: '' } : r);
}

function _kwTagHTML(arr, type, bg, clr) {
  return arr.map((t, i) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:${bg};color:${clr};border-radius:5px;padding:2px 8px;font-size:12px;margin:2px">
      ${Utils.escHtml(String(t))}
      <button type="button" data-kw-remove="${type}" data-kw-idx="${i}"
        style="background:none;border:none;cursor:pointer;color:inherit;padding:0;font-size:11px;line-height:1">✕</button>
    </span>`).join('');
}
function _kwLawHTML(arr) {
  return arr.map((r, i) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:#ede9fe;color:#5b21b6;border-radius:5px;padding:2px 8px;font-size:12px;margin:2px">
      <i class="fas fa-balance-scale" style="font-size:9px"></i>${Utils.escHtml((r.law||'')+(r.article?' '+r.article:''))}
      <button type="button" data-kw-remove="law" data-kw-idx="${i}"
        style="background:none;border:none;cursor:pointer;color:inherit;padding:0;font-size:11px;line-height:1">✕</button>
    </span>`).join('');
}

function _refreshKwTags() {
  const kwSection = document.getElementById('approval-kw-edit');
  const root = kwSection || document;
  const qt = root.querySelector('#apv-kw-query-tags');
  const lt = root.querySelector('#apv-kw-law-tags');
  const rt = root.querySelector('#apv-kw-reason-tags');
  if (qt) qt.innerHTML = _kwTagHTML(_editKwQuery,  'kw_query',  '#e0e7ff', '#3730a3');
  if (lt) lt.innerHTML = _kwLawHTML(_editLawRefs);
  if (rt) rt.innerHTML = _kwTagHTML(_editKwReason, 'kw_reason', '#f0fdf4', '#166534');
}

function _renderKwEdit() {
  const kwSection = document.getElementById('approval-kw-edit');
  if (!kwSection) return;

  kwSection.innerHTML = `
    <div id="apv-kw-edit-panel" style="background:#f0f0ff;border:1.5px solid #a5b4fc;border-radius:10px;padding:12px 14px;margin-top:10px">
      <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:10px;display:flex;align-items:center;gap:5px"><i class="fas fa-tags"></i> 자문 분류 정보 수정</div>

      <div style="margin-bottom:8px">
        <div style="font-size:10px;color:#6b7280;font-weight:600;margin-bottom:4px">핵심키워드</div>
        <div id="apv-kw-query-tags" style="min-height:28px;margin-bottom:6px">${_kwTagHTML(_editKwQuery,'kw_query','#e0e7ff','#3730a3')}</div>
        <div style="display:flex;gap:6px">
          <input id="apv-kw-query-input" type="text" placeholder="키워드 입력 후 Enter"
            style="flex:1;font-size:12px;padding:4px 8px;border:1px solid #c7d2fe;border-radius:6px;outline:none">
          <button type="button" id="apv-kw-query-add-btn" style="background:#4f46e5;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer">추가</button>
        </div>
      </div>

      <div style="margin-bottom:8px">
        <div style="font-size:10px;color:#6b7280;font-weight:600;margin-bottom:4px">관련법령 <span style="font-size:10px;font-weight:400">(법령명 + 조문)</span></div>
        <div id="apv-kw-law-tags" style="min-height:28px;margin-bottom:6px">${_kwLawHTML(_editLawRefs)}</div>
        <div style="display:flex;gap:6px">
          <input id="apv-kw-law-input" type="text" placeholder="법령명 (예: 관세법)"
            style="flex:2;font-size:12px;padding:4px 8px;border:1px solid #c7d2fe;border-radius:6px;outline:none">
          <input id="apv-kw-law-art" type="text" placeholder="조문 (예: 제84조)"
            style="flex:1;font-size:12px;padding:4px 8px;border:1px solid #c7d2fe;border-radius:6px;outline:none">
          <button type="button" id="apv-kw-law-add-btn" style="background:#5b21b6;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer">추가</button>
        </div>
      </div>

      <div>
        <div style="font-size:10px;color:#6b7280;font-weight:600;margin-bottom:4px">판단사유</div>
        <div id="apv-kw-reason-tags" style="min-height:28px;margin-bottom:6px">${_kwTagHTML(_editKwReason,'kw_reason','#f0fdf4','#166534')}</div>
        <div style="display:flex;gap:6px">
          <input id="apv-kw-reason-input" type="text" placeholder="판단사유 입력 후 Enter"
            style="flex:1;font-size:12px;padding:4px 8px;border:1px solid #c7d2fe;border-radius:6px;outline:none">
          <button type="button" id="apv-kw-reason-add-btn" style="background:#15803d;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer">추가</button>
        </div>
      </div>
    </div>`;

  const qInput = kwSection.querySelector('#apv-kw-query-input');
  const qBtn   = kwSection.querySelector('#apv-kw-query-add-btn');
  const lInput = kwSection.querySelector('#apv-kw-law-input');
  const lArt   = kwSection.querySelector('#apv-kw-law-art');
  const lBtn   = kwSection.querySelector('#apv-kw-law-add-btn');
  const rInput = kwSection.querySelector('#apv-kw-reason-input');
  const rBtn   = kwSection.querySelector('#apv-kw-reason-add-btn');
  const panel  = kwSection.querySelector('#apv-kw-edit-panel');

  if (qInput) qInput.addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();e.stopPropagation();_apvAddKwTag('kw_query');} });
  if (qBtn)   qBtn.addEventListener('click',    e => { e.preventDefault();e.stopPropagation();_apvAddKwTag('kw_query'); });
  if (lInput) lInput.addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();e.stopPropagation();_apvAddKwTag('law');} });
  if (lArt)   lArt.addEventListener('keydown',   e => { if (e.key==='Enter'){e.preventDefault();e.stopPropagation();_apvAddKwTag('law');} });
  if (lBtn)   lBtn.addEventListener('click',    e => { e.preventDefault();e.stopPropagation();_apvAddKwTag('law'); });
  if (rInput) rInput.addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();e.stopPropagation();_apvAddKwTag('kw_reason');} });
  if (rBtn)   rBtn.addEventListener('click',    e => { e.preventDefault();e.stopPropagation();_apvAddKwTag('kw_reason'); });

  if (panel) {
    panel.addEventListener('click', e => {
      const btn = e.target.closest('[data-kw-remove]');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      _apvRemoveKwTag(btn.dataset.kwRemove, parseInt(btn.dataset.kwIdx, 10));
    });
  }
}

function _apvAddKwTag(type) {
  const kwSection = document.getElementById('approval-kw-edit');
  if (type === 'law') {
    const lawInput = (kwSection || document).querySelector('#apv-kw-law-input');
    const artInput = (kwSection || document).querySelector('#apv-kw-law-art');
    const law = (lawInput?.value || '').trim();
    if (!law) { lawInput?.focus(); return; }
    _editLawRefs.push({ law, article: (artInput?.value || '').trim() });
    if (lawInput) lawInput.value = '';
    if (artInput) artInput.value = '';
  } else if (type === 'kw_query') {
    const inp = (kwSection || document).querySelector('#apv-kw-query-input');
    const v = (inp?.value || '').trim();
    if (!v) { inp?.focus(); return; }
    _editKwQuery.push(v);
    if (inp) inp.value = '';
  } else if (type === 'kw_reason') {
    const inp = (kwSection || document).querySelector('#apv-kw-reason-input');
    const v = (inp?.value || '').trim();
    if (!v) { inp?.focus(); return; }
    _editKwReason.push(v);
    if (inp) inp.value = '';
  }
  _refreshKwTags();
}

function _apvRemoveKwTag(type, idx) {
  if (type === 'kw_query')       _editKwQuery.splice(idx, 1);
  else if (type === 'kw_reason') _editKwReason.splice(idx, 1);
  else if (type === 'law')       _editLawRefs.splice(idx, 1);
  _refreshKwTags();
}

function toggleApprovalEdit() {
  if (!_approvalTarget) return;
  _approvalEditMode = !_approvalEditMode;

  const editBtn    = document.getElementById('editEntryBtn');
  const rejectBtn  = document.getElementById('rejectBtn');
  const approveBtn = document.getElementById('approveBtn');
  const archiveBtn = document.getElementById('approveAndArchiveBtn');

  if (_approvalEditMode) {
    editBtn.innerHTML = '<i class="fas fa-save"></i> 저장';
    editBtn.className = 'btn btn-primary';
    editBtn.onclick = saveApprovalEdit;
    if (rejectBtn)  rejectBtn.style.display  = 'none';
    if (approveBtn) approveBtn.style.display = 'none';
    if (archiveBtn) archiveBtn.style.display = 'none';

    const descView  = document.getElementById('approval-desc-view');
    const quillWrap = document.getElementById('approval-edit-quill-wrap');
    if (descView)  descView.style.display  = 'none';
    if (quillWrap) quillWrap.style.display = '';

    const quillEl = document.getElementById('approval-edit-quill');
    if (quillEl) {
      if (!_approvalQuill) {
        _approvalQuill = new Quill('#approval-edit-quill', {
          theme: 'snow',
          modules: {
            toolbar: [
              [{ header: [1,2,3,false] }],
              ['bold','italic','underline'],
              [{ list:'ordered'},{list:'bullet'}],
              ['clean']
            ],
            clipboard: { matchVisual: false }
          }
        });
      }
      const curHtml = _approvalTarget.work_description || '';
      _approvalQuill.clipboard.dangerouslyPasteHTML(curHtml);
    }

    const subcatBox = document.getElementById('approval-edit-subcat');
    if (subcatBox) {
      subcatBox.removeAttribute('disabled');
      subcatBox.style.background = '#fff';
      subcatBox.style.border = '1.5px solid var(--primary)';
    }

    if (_approvalTarget.time_category === 'client') {
      const kwViewEl = document.getElementById('approval-kw-view');
      if (kwViewEl) kwViewEl.style.display = 'none';
      _initApprovalKwEdit();
      _renderKwEdit();
    }

    Toast.info('수정할 내용을 입력 후 저장 버튼을 눌러주세요.');
  } else {
    editBtn.innerHTML = '<i class="fas fa-edit"></i> 수정';
    editBtn.className = 'btn btn-outline';
    editBtn.onclick = toggleApprovalEdit;
    if (rejectBtn)  rejectBtn.style.display  = '';
    if (approveBtn) approveBtn.style.display = '';
    if (archiveBtn) archiveBtn.style.display = '';

    const descView2  = document.getElementById('approval-desc-view');
    const quillWrap  = document.getElementById('approval-edit-quill-wrap');
    if (quillWrap) quillWrap.style.display = 'none';
    if (descView2) {
      const html = _approvalTarget.work_description || '';
      descView2.innerHTML = html.trim()
        ? (html.startsWith('<') ? html : '<p>' + Utils.escHtml(html) + '</p>')
        : '<span style="color:var(--text-muted);font-size:12px">(내용 없음)</span>';
      descView2.style.display = '';
    }

    const subcatBox = document.getElementById('approval-edit-subcat');
    if (subcatBox) {
      subcatBox.value = _approvalTarget.work_subcategory_name || '';
      subcatBox.setAttribute('disabled','');
      subcatBox.style.background = '#f8fafc';
      subcatBox.style.border = '';
    }

    if (_approvalTarget.time_category === 'client') {
      const kwEditEl = document.getElementById('approval-kw-edit');
      if (kwEditEl) kwEditEl.innerHTML = '';
      const kwViewEl = document.getElementById('approval-kw-view');
      if (kwViewEl) kwViewEl.style.display = '';
    }
  }
}

async function saveApprovalEdit() {
  if (!_approvalTarget) return;

  let newDesc = '';
  if (_approvalQuill) {
    newDesc = _approvalQuill.root.innerHTML.trim();
    if (newDesc === '<p><br></p>' || newDesc === '') newDesc = '';
  } else {
    const descBox = document.getElementById('approval-edit-desc');
    newDesc = descBox ? descBox.value.trim() : '';
  }
  if (!newDesc) { Toast.warning('수행 내용을 입력해주세요.'); return; }

  const subcatBox = document.getElementById('approval-edit-subcat');
  const newSubcat = subcatBox ? subcatBox.value.trim() : '';

  const editBtn = document.getElementById('editEntryBtn');
  const restore = BtnLoading.start(editBtn, '저장 중...');
  try {
    const patchData = {
      work_description:      newDesc,
      work_subcategory_name: newSubcat || _approvalTarget.work_subcategory_name,
    };

    if (_approvalTarget.time_category === 'client') {
      patchData.kw_query  = JSON.stringify(_editKwQuery);
      patchData.kw_reason = JSON.stringify(_editKwReason);
      patchData.law_refs  = JSON.stringify(_editLawRefs);
    }

    await API.patch('time_entries', _approvalTarget.id, patchData);

    _approvalTarget.work_description      = newDesc;
    _approvalTarget.work_subcategory_name = newSubcat || _approvalTarget.work_subcategory_name;
    if (_approvalTarget.time_category === 'client') {
      _approvalTarget.kw_query  = _editKwQuery;
      _approvalTarget.kw_reason = _editKwReason;
      _approvalTarget.law_refs  = _editLawRefs;
    }

    const descView3 = document.getElementById('approval-desc-view');
    const quillWrap = document.getElementById('approval-edit-quill-wrap');
    if (descView3) {
      descView3.innerHTML = newDesc.startsWith('<') ? newDesc : '<p>' + Utils.escHtml(newDesc) + '</p>';
      descView3.style.display = '';
    }
    if (quillWrap) quillWrap.style.display = 'none';

    if (_approvalTarget.time_category === 'client') {
      const kwEditEl = document.getElementById('approval-kw-edit');
      if (kwEditEl) kwEditEl.innerHTML = '';
      const kwViewEl = document.getElementById('approval-kw-view');
      if (kwViewEl) {
        const tagBadge = (arr, bg, clr) => arr.map(t =>
          `<span style="display:inline-flex;align-items:center;background:${bg};color:${clr};border-radius:5px;padding:2px 8px;font-size:11px;margin:2px">${Utils.escHtml(String(t))}</span>`).join('');
        const lawBadge = (arr) => arr.map(r =>
          `<span style="display:inline-flex;align-items:center;gap:3px;background:#ede9fe;color:#5b21b6;border-radius:5px;padding:2px 8px;font-size:11px;margin:2px"><i class="fas fa-balance-scale" style="font-size:9px"></i>${Utils.escHtml((r.law||'')+(r.article?' '+r.article:''))}</span>`).join('');
        const kwQ = _editKwQuery, kwR = _editKwReason, lawR = _editLawRefs;
        if (!kwQ.length && !kwR.length && !lawR.length) {
          kwViewEl.style.display = 'none';
        } else {
          kwViewEl.innerHTML = `
            <div style="background:#f8f9ff;border:1px solid #c7d2fe;border-radius:10px;padding:12px 14px;margin-bottom:12px">
              <div style="font-size:11px;font-weight:700;color:#4338ca;margin-bottom:8px;display:flex;align-items:center;gap:5px"><i class="fas fa-tags"></i> 자문 분류 정보</div>
              ${kwQ.length ? `<div style="margin-bottom:6px"><span style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">핵심키워드</span>${tagBadge(kwQ,'#e0e7ff','#3730a3')}</div>` : ''}
              ${lawR.length ? `<div style="margin-bottom:6px"><span style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">관련법령</span>${lawBadge(lawR)}</div>` : ''}
              ${kwR.length ? `<div><span style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">판단사유</span>${tagBadge(kwR,'#f0fdf4','#166534')}</div>` : ''}
            </div>`;
          kwViewEl.style.display = '';
        }
      }
    }

    restore();
    _approvalEditMode = false;
    editBtn.innerHTML = '<i class="fas fa-edit"></i> 수정';
    editBtn.className = 'btn btn-outline';
    editBtn.onclick = toggleApprovalEdit;

    if (subcatBox) { subcatBox.setAttribute('disabled',''); subcatBox.style.background = '#f8fafc'; subcatBox.style.border = ''; }

    const rejectBtn  = document.getElementById('rejectBtn');
    const approveBtn = document.getElementById('approveBtn');
    const archiveBtn = document.getElementById('approveAndArchiveBtn');
    if (rejectBtn)  rejectBtn.style.display  = '';
    if (approveBtn) approveBtn.style.display = '';
    if (archiveBtn) archiveBtn.style.display = '';

    Toast.success('수정 내용이 저장되었습니다.');
  } catch(err) {
    restore();
    Toast.error('저장 실패: ' + err.message);
  }
}

// 첨부파일 일괄 로드 (entry id 배열 → map)
async function loadAttachmentsMap(entryIds) {
  if (!entryIds.length) return {};
  try {
    const r = await API.list('attachments', { limit: 500 });
    const all = (r && r.data) ? r.data : [];
    const map = {};
    const idSet = new Set(entryIds);
    all.forEach(a => { if (idSet.has(a.entry_id)) { (map[a.entry_id] = map[a.entry_id] || []).push(a); } });
    return map;
  } catch { return {}; }
}

function changePage(p) {
  _approvalPage = p;
  loadApprovalList();
}

// ─────────────────────────────────────────────
// ★ 승인 모달 — Base64 파일 다운로드
// ─────────────────────────────────────────────
function downloadApprovalFile(idx) {
  const a = _approvalModalAtts[idx];
  if (!a) { Toast.error('첨부파일 정보를 찾을 수 없습니다.'); return; }

  if (typeof _openFilePreview === 'function') {
    _openFilePreview(a);
    return;
  }

  if (!a.file_content || !a.file_content.startsWith('data:')) {
    if (a.file_url && a.file_url.startsWith('http')) {
      window.open(a.file_url, '_blank');
    } else {
      Toast.error('저장된 파일 데이터가 없습니다.');
    }
    return;
  }
  try {
    const [meta, b64] = a.file_content.split(',');
    const mime = (meta.match(/:(.*?);/) || [])[1] || 'application/octet-stream';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) Toast.info('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    Toast.error('파일 미리보기 실패: ' + e.message);
  }
}

// ── entry_id 기반으로 첨부파일 조회 후 뷰어 열기 (배지 클릭용) ──
async function openAttachmentViewerById(entryId) {
  try {
    const r = await API.list('attachments', { limit: 500 });
    const atts = (r && r.data) ? r.data.filter(a => a.entry_id === entryId) : [];
    if (!atts.length) { Toast.info('첨부 파일이 없습니다.'); return; }
    _approvalModalAtts = atts;
    openAttachmentViewer(atts);
  } catch(err) {
    Toast.error('첨부파일 조회 실패: ' + err.message);
  }
}
