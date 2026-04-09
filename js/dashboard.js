/* ============================================
   dashboard.js — 역할별 대시보드
   Staff   : 본인 업무 현황
   Manager : 승인자(본인)로 지정된 팀원 현황 + 승인 대기
   Director: 전체 팀 현황 + 자문유형별 평균 소요
   Admin   : 전체 현황 + 시스템 현황 · 사이드바에서 Staff 업무기록·1차/2차 승인 현황
   ============================================ */

let _dashCharts = {};

// ─────────────────────────────────────────────
// ★ 대시보드 범위(권한) — Analysis와 동일 규칙
// - Admin: 전체
// - Manager(1차 승인자): approver_id == session.id 인 직원만
// - Director:
//    - 본부장: (hq_id가 있으면) reviewer2_id == session.id 인 직원만
//    - 사업부장: (hq_id 없고 dept_id 있으면) dept_id == session.dept_id 직원 전체
// - Staff: 본인만
// ─────────────────────────────────────────────
function _getVisibleUserIdSetForDashboard(session, allUsers) {
  const s = session || {};
  const users = Array.isArray(allUsers) ? allUsers : [];
  const role = s.role || '';
  const sid = String(s.id || '');
  if (!sid) return new Set();

  if (role === 'admin') return null; // null = 제한 없음
  if (role === 'staff') return new Set([sid]);

  if (role === 'manager') {
    return new Set(
      users
        .filter(u => String(u.approver_id || '') === sid)
        .map(u => String(u.id))
        .filter(Boolean)
    );
  }

  if (role === 'director') {
    const deptId = String(s.dept_id || '');
    const hqId = String(s.hq_id || '');

    // 본부장: 최종승인자 지정(reviewer2_id) 직원만
    if (hqId) {
      return new Set(
        users
          .filter(u => String(u.reviewer2_id || '') === sid)
          .map(u => String(u.id))
          .filter(Boolean)
      );
    }
    // 사업부장: 동일 사업부(dept_id) 전체 직원
    if (deptId) {
      return new Set(
        users
          .filter(u => String(u.dept_id || '') === deptId)
          .map(u => String(u.id))
          .filter(Boolean)
      );
    }
    // 예외 fallback: 기존 scopeMatch
    return new Set(
      users
        .filter(u => Auth.scopeMatch(s, u))
        .map(u => String(u.id))
        .filter(Boolean)
    );
  }

  return new Set([sid]);
}

/** 과부하/저부하 카드 제목 — admin(전사)만 「전체」, 그 외 「팀원」 */
function _overloadWorkloadCardTitle(session) {
  return session && session.role === 'admin' ? '전체 과부하/저부하' : '팀원 과부하/저부하';
}

// ─────────────────────────────────────────────
// ★ 성능 최적화: time_entries 캐시 (3분 TTL)
// 대시보드 재진입 시 동일 데이터 재활용
// ─────────────────────────────────────────────
async function _getCachedEntries() {
  return Cache.get('dash_time_entries', () => API.fetchAllTimeEntriesForDash(), 60000); // 1분 TTL (승인 직후 반영)
}

async function init_dashboard() {
  const session = getSession();
  if (!session) return;

  // ★ 대시보드 캐시: 데이터 변경(승인·저장) 후에만 invalidate, 단순 메뉴 클릭은 캐시 재사용
  // window._dashNeedsRefresh = true 로 설정된 경우(승인/저장 완료 후)에만 갱신
  if (window._dashNeedsRefresh !== false) {
    // 최초 진입 또는 데이터 변경 후 → 캐시 초기화
    Cache.invalidate('dash_time_entries');
    Cache.invalidate('dash_archive_stars');
  }
  window._dashNeedsRefresh = false; // 다음 진입은 캐시 재사용

  // ★ 승인자 미지정 staff → 자문 자료실로 리디렉션
  if (Auth.isStaff(session) && !Auth.hasApprover(session)) {
    navigateTo('archive');
    return;
  }

  // 역할별 대시보드 분기
  if (session.role === 'staff') {
    await renderStaffDashboard(session);
  } else if (session.role === 'manager') {
    await renderManagerDashboard(session);
  } else {
    // director / admin
    await renderDirectorDashboard(session);
  }
}

// ─────────────────────────────────────────────
// 공통: 도넛 차트
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 상위 N개 + 기타 집계 헬퍼
// dataMap: { key: minutes } 형태
// topN: 상위 N개 (기본 5)
// ─────────────────────────────────────────────
function collapseToTopN(dataMap, topN = 5) {
  const sorted = Object.entries(dataMap).sort((a, b) => b[1] - a[1]);
  if (sorted.length <= topN) return dataMap;
  const result = {};
  sorted.slice(0, topN).forEach(([k, v]) => { result[k] = v; });
  const etcSum = sorted.slice(topN).reduce((s, [, v]) => s + v, 0);
  if (etcSum > 0) result['기타'] = etcSum;
  return result;
}

// ─────────────────────────────────────────────
// 전문형 수평 막대 차트 (깔끔한 단색 네이비 계열)
// ─────────────────────────────────────────────
function renderBarChart(canvasId, dataMap, maxLabelLen = 99) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (_dashCharts[canvasId]) { _dashCharts[canvasId].destroy(); delete _dashCharts[canvasId]; }

  const wrapper = canvas.parentElement;
  if (!wrapper) return;
  canvas.style.display = 'none';

  // 기존 커스텀 차트 제거
  const existing = wrapper.querySelector('.custom-bar-chart');
  if (existing) existing.remove();

  // 내림차순 정렬
  const sorted = Object.entries(dataMap).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#9aa4b2;font-size:12px;';
    empty.textContent = '데이터가 없습니다.';
    wrapper.appendChild(empty);
    return;
  }

  const totalMin = sorted.reduce((s, [, v]) => s + v, 0);
  const maxMin   = sorted[0][1];

  // 단일 베이스 컬러에서 투명도로 순위 구분 (가장 진한 → 점점 옅게)
  // 기타는 항상 회색
  const baseColor = '45,107,181'; // #2d6bb5 RGB

  const rows = sorted.map(([key, min], i) => {
    const pct    = totalMin > 0 ? Math.round(min / totalMin * 100) : 0;
    const barW   = maxMin   > 0 ? (min / maxMin * 100).toFixed(1) : 0;
    const hours  = (min / 60).toFixed(1);
    const isEtc  = key === '기타';
    // 1위: 100% → 마지막: 45% 투명도로 자연스럽게 구분
    const opacity = isEtc ? 0.3 : Math.max(0.45, 1 - i * (0.55 / Math.max(sorted.length - 1, 1)));
    const barClr  = isEtc ? 'rgba(148,163,184,0.5)' : `rgba(${baseColor},${opacity.toFixed(2)})`;
    const txtClr  = isEtc ? '#94a3b8' : `rgba(${baseColor},${Math.min(1, opacity + 0.2).toFixed(2)})`;

    return `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f4f6f9;" title="${key}">
        <!-- 레이블: 줄바꿈 허용, 최소 너비 확보 -->
        <div style="min-width:80px;max-width:120px;width:auto;font-size:11px;color:#5a6878;font-weight:500;
                    white-space:normal;word-break:keep-all;overflow:visible;flex-shrink:0;
                    line-height:1.35;letter-spacing:-0.1px;"
             title="${key}">${key}</div>
        <!-- 막대 트랙 -->
        <div style="flex:1;height:6px;background:#f0f4f8;border-radius:99px;overflow:hidden;min-width:0;position:relative;">
          <div class="bar-fill" style="width:0%;height:100%;background:${barClr};border-radius:99px;
                      transition:width 0.8s cubic-bezier(.4,0,.2,1);"
               data-target="${barW}"></div>
        </div>
        <!-- 시간 -->
        <div style="flex-shrink:0;min-width:30px;text-align:right;
                    font-size:12px;font-weight:700;color:#1a2b45;letter-spacing:-0.3px;">${hours}<span style="font-size:9px;font-weight:500;color:#9aa4b2;margin-left:1px">h</span></div>
        <!-- % -->
        <div style="flex-shrink:0;width:28px;text-align:right;
                    font-size:10.5px;font-weight:600;color:${txtClr};">${pct}%</div>
      </div>`;
  }).join('');

  const div = document.createElement('div');
  div.className = 'custom-bar-chart';
  div.style.cssText = 'height:100%;display:flex;flex-direction:column;justify-content:space-evenly;padding:4px 2px 2px;';
  div.innerHTML = rows;
  wrapper.appendChild(div);

  // 막대 애니메이션: requestAnimationFrame으로 한 프레임 후 너비 적용
  requestAnimationFrame(() => {
    div.querySelectorAll('.bar-fill').forEach(el => {
      el.style.width = el.dataset.target + '%';
    });
  });
}

// renderDonutChart 별칭 유지
function renderDonutChart(canvasId, dataMap) {
  renderBarChart(canvasId, dataMap);
}

// ─────────────────────────────────────────────
// 승인 완료 entries → 업무 소분류별 건당 평균 분 집계, 상위 topN + 기타(가중 평균)
// ─────────────────────────────────────────────
function buildSubcategoryAvgSlices(approvedEntries, topN = 15) {
  const agg = {};
  approvedEntries.forEach(e => {
    const k = e.work_subcategory_name || e.work_category_name || '미분류';
    if (!agg[k]) agg[k] = { sumMin: 0, count: 0 };
    agg[k].sumMin += (e.duration_minutes || 0);
    agg[k].count += 1;
  });
  const rows = Object.entries(agg).map(([name, v]) => ({
    name,
    avgMin: v.count > 0 ? v.sumMin / v.count : 0,
    count: v.count,
    isEtc: false
  }));
  rows.sort((a, b) => b.avgMin - a.avgMin);
  if (!rows.length) return { display: [] };
  const top = rows.slice(0, topN);
  const rest = rows.slice(topN);
  const display = top.map(r => ({ ...r }));
  if (rest.length) {
    const cnt = rest.reduce((s, r) => s + r.count, 0);
    const sumMinRest = rest.reduce((s, r) => s + r.avgMin * r.count, 0);
    display.push({
      name: '기타',
      avgMin: cnt > 0 ? sumMinRest / cnt : 0,
      count: cnt,
      isEtc: true
    });
  }
  return { display };
}

// ─────────────────────────────────────────────
// 자문유형(소분류) 평균 소요 막대 행 HTML
// display: { name, avgMin, count, isEtc }[] — 평균 분 큰 순, 기타는 맨 아래
// 막대·%: 표시 행 중 최대 평균분 = 100%
// ─────────────────────────────────────────────
function buildSubcatAvgRows(display) {
  if (!display.length) {
    return `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px">데이터 없음</div>`;
  }
  const maxAvg = Math.max(...display.map(r => r.avgMin), 0);
  return display.map((r, idx) => {
    const { name, avgMin, count, isEtc } = r;
    const opacity = isEtc
      ? 0.35
      : Math.max(0.35, 1 - idx * (0.55 / Math.max(display.length - 1, 1)));
    const barClr  = isEtc ? 'rgba(148,163,184,0.55)' : `rgba(45,107,181,${opacity.toFixed(2)})`;
    const txtClr  = isEtc ? '#94a3b8' : `rgba(45,107,181,${Math.min(1, opacity + 0.2).toFixed(2)})`;
    const hours   = (avgMin / 60).toFixed(1);
    const pct     = maxAvg > 0 ? Math.round(avgMin / maxAvg * 100) : 0;
    const barW    = maxAvg > 0 ? (avgMin / maxAvg * 100).toFixed(1) : 0;
    const tip     = `${name} · ${count}건 · 평균 ${hours}h`;
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f4f6f9;" title="${tip.replace(/"/g, '&quot;')}">
        <div style="min-width:90px;max-width:150px;font-size:11px;color:#5a6878;font-weight:500;
                    white-space:normal;word-break:keep-all;flex-shrink:0;line-height:1.35;">${name}</div>
        <div style="flex:1;height:6px;background:#f0f4f8;border-radius:99px;overflow:hidden;min-width:0;">
          <div class="bar-fill" style="width:0%;height:100%;background:${barClr};border-radius:99px;
               transition:width 0.8s cubic-bezier(.4,0,.2,1);" data-target="${barW}"></div>
        </div>
        <div style="flex-shrink:0;min-width:32px;text-align:right;font-size:12px;font-weight:700;color:#1a2b45;">
          ${hours}<span style="font-size:9px;font-weight:500;color:#9aa4b2;margin-left:1px">h</span>
        </div>
        <div style="flex-shrink:0;width:28px;text-align:right;font-size:10.5px;font-weight:600;color:${txtClr};">${pct}%</div>
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// 공통: 직원별 투입시간 통계 HTML 생성
// staffList  : 대상 직원 배열 (users)
// approvedEntries : 이번달 승인 완료 entries
// allEntries      : 전체 entries (전월 비교용)
// maxRef     : 최다 기준 직원 (전체 또는 팀 내)
// ─────────────────────────────────────────────
function buildStaffStatRows(staffList, approvedEntries, allEntries, maxRefStaff, archiveItems = []) {
  const now    = new Date();
  const today  = now.getDate();
  const curY   = now.getFullYear();
  const curM   = now.getMonth(); // 0-indexed

  // 전월 동일 일자까지 누적
  const prevY = curM === 0 ? curY - 1 : curY;
  const prevM = curM === 0 ? 11 : curM - 1;
  const prevMonthStr = `${prevY}-${String(prevM + 1).padStart(2,'0')}`;

  // 각 직원 데이터 계산
  const rows = staffList.map(u => {
    const uid = String(u.id);
    // 이번달 승인 시간 (String 비교로 타입 불일치 방지)
    const curMin = approvedEntries
      .filter(e => String(e.user_id) === uid)
      .reduce((s, e) => s + (e.duration_minutes || 0), 0);

    // 전월 동일 일자까지 누적 (승인된 것만)
    const prevMin = allEntries
      .filter(e => {
        if (String(e.user_id) !== uid || e.status !== 'approved') return false;
        if (!e.work_start_at) return false;
        const d = new Date(isNaN(e.work_start_at) ? e.work_start_at : Number(e.work_start_at));
        if (isNaN(d.getTime())) return false;
        const eY = d.getFullYear(), eM = d.getMonth(), eD = d.getDate();
        return eY === prevY && eM === prevM && eD <= today;
      })
      .reduce((s, e) => s + (e.duration_minutes || 0), 0);

    // 이번달 평균 별점 (archive_items 기준)
    const userArchives = archiveItems.filter(a => String(a.user_id) === uid && parseInt(a.quality_stars) > 0);
    const avgStars = userArchives.length > 0
      ? userArchives.reduce((s,a) => s + (parseInt(a.quality_stars)||0), 0) / userArchives.length
      : null;

    return { u, curMin, prevMin, avgStars, archiveCount: userArchives.length };
  });

  // 최다 시간 기준 (maxRefStaff가 주어지면 그 직원, 아니면 현재 staffList 내 최다)
  let maxMin;
  if (maxRefStaff) {
    maxMin = approvedEntries
      .filter(e => e.user_id === maxRefStaff.id)
      .reduce((s, e) => s + (e.duration_minutes || 0), 0);
  } else {
    maxMin = Math.max(...rows.map(r => r.curMin), 0);
  }

  // 최다대비 비율 내림차순 정렬 (높은 % → 낮은 % 순)
  rows.sort((a, b) => {
    const ra = maxMin > 0 ? a.curMin / maxMin : 0;
    const rb = maxMin > 0 ? b.curMin / maxMin : 0;
    return rb - ra;
  });

  if (!rows.length) {
    return `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px;">
              <i class="fas fa-users" style="font-size:20px;opacity:0.3;display:block;margin-bottom:6px"></i>
              직원 데이터가 없습니다.
            </div>`;
  }

  return rows.map(({ u, curMin, prevMin, avgStars, archiveCount }) => {
    const hours  = (curMin / 60).toFixed(1);
    const ratio  = maxMin > 0 ? Math.round(curMin / maxMin * 100) : 0;
    const barW   = ratio;
    // 순위 인덱스 (내림차순 정렬 — 앞쪽(0번)이 가장 높은 비율 → 가장 진하게)
    const rankIdx = rows.findIndex(r => r.u.id === u.id);
    const opacity = Math.max(0.35, 1 - rankIdx * (0.55 / Math.max(rows.length - 1, 1)));
    const barClr  = ratio === 100
      ? 'rgba(45,107,181,1.0)'
      : `rgba(45,107,181,${opacity.toFixed(2)})`;

    // 전월 대비 증감률
    let changeHtml = `<span style="font-size:11px;color:#9aa4b2;">—</span>`;
    if (prevMin > 0) {
      const chg = Math.round((curMin - prevMin) / prevMin * 100);
      const sign = chg > 0 ? '▲' : chg < 0 ? '▼' : '—';
      const val  = chg !== 0 ? `${sign} ${Math.abs(chg)}%` : '—';
      changeHtml = `<span style="font-size:11px;color:#9aa4b2;font-weight:500;">${val}</span>`;
    } else if (curMin > 0) {
      changeHtml = `<span style="font-size:11px;color:#9aa4b2;font-weight:500;">신규</span>`;
    }

    // 별점 HTML
    let starHtml = `<span style="font-size:10px;color:#d1d5db;">—</span>`;
    if (avgStars !== null) {
      const fullStars  = Math.round(avgStars);
      const starColors = { 1: '#9ca3af', 2: '#3b82f6', 3: '#f59e0b' };
      const clr = starColors[fullStars] || '#9ca3af';
      starHtml = `<span style="font-size:11px;color:${clr};letter-spacing:0.5px;" title="평균 ${avgStars.toFixed(1)}점 (${archiveCount}건)">
        ${'★'.repeat(fullStars)}${'☆'.repeat(3-fullStars)}
      </span>`;
    }

    return `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f4f6f9;">
        <!-- 이름 -->
        <div style="display:flex;align-items:center;gap:6px;min-width:76px;max-width:100px;flex-shrink:0;">
          <div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#2d6bb5,#4a90d9);
                      color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;
                      justify-content:center;flex-shrink:0;">${getInitial(u.name)}</div>
          <span style="font-size:11px;color:#5a6878;font-weight:500;white-space:nowrap;
                       overflow:hidden;text-overflow:ellipsis;">${u.name}</span>
        </div>
        <!-- 해당월 시간 -->
        <div style="flex-shrink:0;width:36px;text-align:right;font-size:12px;font-weight:700;color:#1a2b45;">
          ${hours}<span style="font-size:9px;font-weight:500;color:#9aa4b2;margin-left:1px">h</span>
        </div>
        <!-- 전월 대비 -->
        <div style="flex-shrink:0;width:48px;text-align:center;">${changeHtml}</div>
        <!-- 최다 대비 막대 + % -->
        <div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0;">
          <div style="flex:1;height:6px;background:#f0f4f8;border-radius:99px;overflow:hidden;min-width:0;">
            <div class="bar-fill" style="width:0%;height:100%;background:${barClr};border-radius:99px;
                 transition:width 0.8s cubic-bezier(.4,0,.2,1);" data-target="${barW}"></div>
          </div>
          <div style="flex-shrink:0;width:30px;text-align:right;font-size:10.5px;font-weight:600;
                      color:rgba(45,107,181,${Math.min(1, opacity + 0.2).toFixed(2)});">${ratio}%</div>
        </div>
        <!-- 별점 -->
        <div style="flex-shrink:0;width:44px;text-align:center;">${starHtml}</div>
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
// 공통: 자문유형(소분류) 평균 + 직원 하단 섹션 렌더링
// mode: 'director' | 'manager' | 'staff'
// ─────────────────────────────────────────────
async function renderBottomSection(container, {
  allEntries, approvedEntries,
  staffList, maxRefStaff, month, mode
}) {
  const { display: subcatDisplay } = buildSubcategoryAvgSlices(approvedEntries, 15);
  const subcatHTML = buildSubcatAvgRows(subcatDisplay);

  // ★ archive_items(별점) 없이 먼저 렌더링 → 별점만 나중에 업데이트 (지연 로드)
  const staffHTML = buildStaffStatRows(staffList, approvedEntries, allEntries, maxRefStaff, []);

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:10px;">
      <!-- 자문유형별(업무 소분류) 평균 소요시간 -->
      <div class="card">
        <div class="card-header" style="padding:12px 16px 10px">
          <h2><i class="fas fa-bars" style="color:var(--primary)"></i> &nbsp;자문유형별 평균 소요시간</h2>
          <span style="font-size:11px;font-weight:400;color:var(--text-muted)">
            업무 소분류 · 상위 15+기타 · 승인 완료 · 건당 평균 · 막대는 최장 평균 대비
          </span>
        </div>
        <div class="card-body" style="padding:10px 14px;max-height:460px;overflow-y:auto;">
          <div id="subcat-rows-inner">${subcatHTML}</div>
        </div>
      </div>
      <!-- 직원별 투입시간 통계 -->
      <div class="card">
        <div class="card-header" style="padding:12px 16px 10px">
          <h2><i class="fas fa-user-clock" style="color:var(--primary)"></i> &nbsp;직원별 투입시간</h2>
          <span style="font-size:11px;font-weight:400;color:var(--text-muted)">
            ${month} · 승인 완료 · 최다대비 내림차순
          </span>
        </div>
        <div style="display:flex;align-items:center;padding:4px 14px 2px;border-bottom:1px solid #f4f6f9;background:#fafbfc;">
          <div style="min-width:76px;max-width:100px;font-size:10px;color:#9aa4b2;font-weight:600;flex-shrink:0;">이름</div>
          <div style="flex-shrink:0;width:36px;text-align:right;font-size:10px;color:#9aa4b2;font-weight:600;">시간</div>
          <div style="flex-shrink:0;width:48px;text-align:center;font-size:10px;color:#9aa4b2;font-weight:600;">전월대비</div>
          <div style="flex:1;text-align:right;font-size:10px;color:#9aa4b2;font-weight:600;padding-right:30px;">최다대비</div>
          <div style="flex-shrink:0;width:44px;text-align:center;font-size:10px;color:#9aa4b2;font-weight:600;">별점</div>
        </div>
        <div class="card-body" style="padding:6px 14px;max-height:426px;overflow-y:auto;" id="staff-stat-body">
          ${staffHTML}
        </div>
      </div>
    </div>`;

  // 막대 애니메이션
  requestAnimationFrame(() => {
    container.querySelectorAll('.bar-fill').forEach(el => {
      el.style.width = el.dataset.target + '%';
    });
  });

  // ★ archive_items(별점) 지연 로드 — 초기 렌더 후 백그라운드에서 업데이트
  Cache.get('dash_archive_stars', async () => {
    const archRes = await API.list('archive_items', { limit: 1000 });
    return (archRes && archRes.data) ? archRes.data : [];
  }, 300000).then(archiveItems => {   // 5분 TTL
    const statsBody = container.querySelector('#staff-stat-body');
    if (!statsBody || !archiveItems.length) return;
    // 별점 데이터 있을 때만 직원 통계 재렌더
    const updatedHTML = buildStaffStatRows(staffList, approvedEntries, allEntries, maxRefStaff, archiveItems);
    statsBody.innerHTML = updatedHTML;
    // 막대 재애니메이션
    requestAnimationFrame(() => {
      statsBody.querySelectorAll('.bar-fill').forEach(el => {
        el.style.width = el.dataset.target + '%';
      });
    });
  }).catch(() => {/* 별점 로드 실패 무시 */});
}

// ─────────────────────────────────────────────
// 공통: 이번 달 문자열
// ─────────────────────────────────────────────
function thisMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function prevMonthStr() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function entryMonth(e) {
  if (!e.work_start_at) return '';
  // 숫자형 타임스탬프(ms), 문자열 숫자, ISO 문자열 모두 처리
  const raw = e.work_start_at;
  let d;
  const num = Number(raw);
  if (!isNaN(num) && num > 1000000000000) {
    // ms 타임스탬프 (13자리)
    d = new Date(num);
  } else if (!isNaN(num) && num > 1000000000) {
    // sec 타임스탬프 (10자리) → ms 변환
    d = new Date(num * 1000);
  } else {
    // ISO 문자열 등
    d = new Date(raw);
  }
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _fmtPctDelta(cur, prev) {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (p <= 0 && c <= 0) return { pct: 0, label: '0%', cls: 'muted' };
  if (p <= 0 && c > 0) return { pct: 999, label: '+∞', cls: 'up' };
  const pct = Math.round(((c - p) / p) * 100);
  const cls = pct >= 0 ? 'up' : 'down';
  const sign = pct >= 0 ? '+' : '';
  return { pct, label: `${sign}${pct}%`, cls };
}

function _buildLeaderMonthlyStats(approvedCur, approvedPrev) {
  const map = {};
  function add(arr, key) {
    (arr || []).forEach(e => {
      const uid = String(e.user_id || '');
      if (!uid) return;
      if (!map[uid]) map[uid] = {
        user_id: uid,
        user_name: e.user_name || uid,
        curMin: 0,
        prevMin: 0,
        curConsultCnt: 0,
        prevConsultCnt: 0,
        curConsultMin: 0,
        prevConsultMin: 0,
      };
      const m = Number(e.duration_minutes) || 0;
      map[uid][key + 'Min'] += m;
      if (e.time_category === 'client') {
        map[uid][key + 'ConsultCnt'] += 1;
        map[uid][key + 'ConsultMin'] += m;
      }
    });
  }
  add(approvedCur, 'cur');
  add(approvedPrev, 'prev');
  return Object.values(map);
}

function _buildClientRadar(approvedCur, approvedPrev) {
  const map = {};
  function add(arr, key) {
    (arr || []).forEach(e => {
      if (e.time_category !== 'client') return;
      const cid = String(e.client_id || '');
      if (!cid) return;
      const name = e.client_name || cid;
      if (!map[cid]) map[cid] = { client_id: cid, client_name: name, curMin: 0, prevMin: 0, curCnt: 0, prevCnt: 0 };
      const m = Number(e.duration_minutes) || 0;
      map[cid][key + 'Min'] += m;
      map[cid][key + 'Cnt'] += 1;
    });
  }
  add(approvedCur, 'cur');
  add(approvedPrev, 'prev');
  return Object.values(map);
}

// ─────────────────────────────────────────────
// KPI 카드 HTML 생성
// accentColor: 좌측 보더 컬러 (기본값 var(--primary))
// ─────────────────────────────────────────────
function kpiCard(icon, bg, iconColor, label, value, unit, sub, linkPage = '', accentColor = '') {
  const clickAttr = linkPage
    ? `onclick="navigateTo('${linkPage}')" title="${linkPage} 바로가기"`
    : '';
  const borderStyle = accentColor ? `border-left-color:${accentColor}` : '';
  const iconStyle   = `background:${accentColor ? accentColor + '18' : '#eef2f7'};color:${accentColor || 'var(--primary)'};`;
  const subHtml     = sub ? `<div class="kpi-sub">${sub}</div>` : '';
  return `
  <div class="kpi-card${linkPage ? ' kpi-card-link' : ''}" ${clickAttr} style="${borderStyle}">
    <div class="kpi-icon" style="${iconStyle}"><i class="fas ${icon}"></i></div>
    <div class="kpi-card-text">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}<span style="font-size:12px;font-weight:500;margin-left:2px;color:var(--text-muted)">${unit}</span></div>
      ${subHtml}
    </div>
    ${linkPage ? '<i class="fas fa-chevron-right" style="font-size:10px;color:var(--text-muted);flex-shrink:0"></i>' : ''}
  </div>`;
}

// ══════════════════════════════════════════════
// STAFF 대시보드
// ══════════════════════════════════════════════
async function renderStaffDashboard(session) {
  try {
    // ★ 성능 개선: Staff는 time_entries만 로드 (users 불필요)
    const allEntries = await _getCachedEntries();

    const sid_s = String(session.id);
    const entries = allEntries.filter(e => String(e.user_id) === sid_s);
    const month = thisMonthStr();
    const monthNum = parseInt(month.split('-')[1], 10);
    const monthEntries   = entries.filter(e => entryMonth(e) === month);
    const approvedMonth  = monthEntries.filter(e => e.status === 'approved');
    const submittedCount = entries.filter(e => e.status === 'submitted').length;

    const totalMin  = approvedMonth.reduce((s, e) => s + (e.duration_minutes || 0), 0);
    const clientMin = approvedMonth.filter(e => e.time_category === 'client').reduce((s, e) => s + (e.duration_minutes || 0), 0);
    const internalMin = totalMin - clientMin;
    const clientRatio = totalMin > 0 ? Math.round(clientMin / totalMin * 100) : 0;

    document.getElementById('kpi-grid').innerHTML =
      kpiCard('fa-clock',       '', '', `${monthNum}월 투입시간`,  (totalMin/60).toFixed(1),     'h',  '승인 완료 기준',  '',          '#1a2b45') +
      kpiCard('fa-briefcase',   '', '', '고객사 업무',             (clientMin/60).toFixed(1),    'h',  `비율 ${clientRatio}%`,        '',          '#2d6bb5') +
      kpiCard('fa-building',    '', '', '내부 업무',               (internalMin/60).toFixed(1),  'h',  `비율 ${100-clientRatio}%`,    '',          '#4a7fc4') +
      kpiCard('fa-paper-plane', '', '', '승인 대기',               submittedCount,               '건', '',               '',          '#6b95ce');

    // ── 데이터 집계 (본인 데이터만) ─────────────────────────────────────────
    const majorMap = {};
    approvedMonth.forEach(e => {
      const k = e.work_category_name || '미분류';
      majorMap[k] = (majorMap[k]||0) + (e.duration_minutes||0);
    });
    const subMap = {};
    approvedMonth.forEach(e => {
      const k = e.work_subcategory_name || e.work_category_name || '미분류';
      subMap[k] = (subMap[k]||0) + (e.duration_minutes||0);
    });
    // chart-row-1: 대분류(좌) + 소분류(우)
    renderBarChart('chart-type', collapseToTopN(majorMap, 8));
    renderBarChart('chart-sub',  collapseToTopN(subMap,   5));

    // ── 이번 달 데이터 없을 때 안내 배너 ──────────────────
    const noDataBanner = document.getElementById('dashboard-no-data-banner');
    if (noDataBanner) {
      if (entries.length === 0) {
        // 내 데이터 없음
        noDataBanner.style.display = '';
        noDataBanner.innerHTML = `
          <i class="fas fa-info-circle" style="color:#3b82f6;font-size:15px;flex-shrink:0"></i>
          <span>아직 작성한 타임시트가 없습니다.
            <strong style="color:var(--primary);cursor:pointer" onclick="navigateTo('entry-new')">
              New Entry</strong>에서 업무 시간을 기록하세요.</span>`;
      } else if (approvedMonth.length === 0 && entries.length > 0) {
        // 데이터는 있지만 이번 달 승인 완료 없음
        noDataBanner.style.display = '';
        noDataBanner.innerHTML = `
          <i class="fas fa-hourglass-half" style="color:#f59e0b;font-size:15px;flex-shrink:0"></i>
          <span>이번 달 <strong>승인 완료</strong>된 타임시트가 없습니다.
            제출한 항목이 승인되면 여기에 표시됩니다.</span>`;
      } else {
        noDataBanner.style.display = 'none';
      }
    }

    // ── 하단: 자문유형별 평균(좌) + 본인 최근 업무 기록(우) ────────────────
    // ★ Staff는 본인 데이터만 표시 — 다른 직원 현황 비공개
    const recentSection = document.getElementById('recent-entries-section');
    if (recentSection) {
      recentSection.innerHTML = '';
      _renderStaffBottomSection(recentSection, {
        myEntries: entries,
        approvedMonth,
        allEntries,
        month,
        session
      });
    }

  } catch (err) { console.error('Staff Dashboard error:', err); }
}

// ─────────────────────────────────────────────
// Staff 전용 하단 섹션:
//   좌) 자문유형별 평균 소요시간 (본인)
//   우) 본인 최근 업무 기록 목록
// ─────────────────────────────────────────────
async function _renderStaffBottomSection(container, { myEntries, approvedMonth, allEntries, month, session }) {
  const { display: subcatDisplay } = buildSubcategoryAvgSlices(approvedMonth, 15);
  const subcatHTML = buildSubcatAvgRows(subcatDisplay);

  // 본인 최근 업무기록: 이번 달만 · 승인완료 제외 · (1)반려 (2)1차 (3)2차 (4)임시 (5)기타 → 각 그룹 내 업무일 과거→최신, 상위 10건
  const _dashRecentSortTs = (e) => {
    const raw = e?.work_start_at ?? e?.created_at;
    if (raw == null) return 0;
    const num = Number(raw);
    let ts;
    if (!isNaN(num) && num > 1000000000000) ts = num;
    else if (!isNaN(num) && num > 1000000000) ts = num * 1000;
    else ts = new Date(raw).getTime();
    return isNaN(ts) ? 0 : ts;
  };
  const _dashRecentStatusRank = (st) => {
    if (st === 'rejected') return 0;
    if (st === 'submitted') return 1;
    if (st === 'pre_approved') return 2;
    if (st === 'draft') return 3;
    return 4;
  };
  const recentMine = [...myEntries]
    .filter(e => entryMonth(e) === month && e.status !== 'approved')
    .sort((a, b) => {
      const ra = _dashRecentStatusRank(a.status);
      const rb = _dashRecentStatusRank(b.status);
      if (ra !== rb) return ra - rb;
      const ta = _dashRecentSortTs(a);
      const tb = _dashRecentSortTs(b);
      if (ta !== tb) return ta - tb;
      return String(a.id || '').localeCompare(String(b.id || ''));
    })
    .slice(0, 10);

  const statusBadge = (s) => {
    const map = {
      submitted:    { fg: '#b45309', bg: '#fffbeb', bd: '#fcd34d', lbl: '1차승인대기' },
      pre_approved: { fg: '#9a3412', bg: '#fff7ed', bd: '#fdba74', lbl: '2차승인대기' },
      rejected:     { fg: '#b91c1c', bg: '#fef2f2', bd: '#fecaca', lbl: '반려' },
      draft:        { fg: '#475569', bg: '#f1f5f9', bd: '#e2e8f0', lbl: '임시저장' },
    };
    const row = map[s];
    if (!row) {
      const lbl = s || '-';
      return `<span class="dash-status-pill" style="color:#64748b;background:#f8fafc;border-color:#e2e8f0">${lbl}</span>`;
    }
    return `<span class="dash-status-pill" style="color:${row.fg};background:${row.bg};border-color:${row.bd}">${row.lbl}</span>`;
  };

  const recentRows = recentMine.length === 0
    ? `<tr><td colspan="5" class="table-empty">
        <i class="fas fa-inbox" style="font-size:18px;opacity:0.3;display:block;margin-bottom:6px"></i>
        <p style="margin:0;font-size:12px;color:var(--text-muted)">이번 달 표시할 항목이 없습니다.<br/>
        <span style="font-size:11px;opacity:0.9">승인 완료 건은 이 목록에서 제외됩니다.</span></p>
       </td></tr>`
    : recentMine.map(e => `
        <tr>
          <td style="font-size:11px;white-space:nowrap;padding:7px 8px;">${Utils.formatDate(e.work_start_at)}</td>
          <td style="font-size:11px;padding:7px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.client_name||''}">${e.client_name || '<span style="color:var(--text-muted)">내부</span>'}</td>
          <td style="font-size:11px;padding:7px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.work_subcategory_name||e.work_category_name||''}">${e.work_subcategory_name||e.work_category_name||'-'}</td>
          <td style="font-size:11px;text-align:right;font-weight:700;color:#1a2b45;padding:7px 8px;white-space:nowrap;">${((e.duration_minutes||0)/60).toFixed(1)}<span style="font-size:9px;font-weight:500;color:#9aa4b2;margin-left:1px">h</span></td>
          <td class="dash-recent-status-cell" style="text-align:center;padding:7px 8px;white-space:nowrap;vertical-align:middle;">${statusBadge(e.status)}</td>
        </tr>`).join('');

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:10px;">
      <!-- 자문유형별 평균 소요시간 (본인) -->
      <div class="card">
        <div class="card-header" style="padding:12px 16px 10px">
          <h2><i class="fas fa-bars" style="color:var(--primary)"></i> &nbsp;자문유형별 평균 소요시간</h2>
          <span style="font-size:11px;font-weight:400;color:var(--text-muted)">
            ${month} · 본인 · 업무 소분류 · 승인 완료 · 막대는 최장 평균 대비
          </span>
        </div>
        <div class="card-body" style="padding:10px 14px;max-height:460px;overflow-y:auto;">
          ${subcatHTML}
        </div>
      </div>
      <!-- 내 최근 업무 기록 -->
      <div class="card">
        <div class="card-header" style="padding:12px 16px 10px">
          <h2><i class="fas fa-list-alt" style="color:var(--primary)"></i> &nbsp;내 업무 기록</h2>
          <span style="font-size:11px;font-weight:400;color:var(--text-muted)">
            ${month} · 승인완료 제외 · 최근 10건
          </span>
        </div>
        <div class="card-body dash-recent-entries-scroll" style="max-height:420px;overflow-y:auto;overflow-x:hidden;">
          <table class="data-table dash-recent-entries-table">
            <colgroup>
              <col class="dash-recent-col-date">
              <col class="dash-recent-col-client">
              <col class="dash-recent-col-work">
              <col class="dash-recent-col-time">
              <col class="dash-recent-col-status">
            </colgroup>
            <thead><tr>
              <th style="padding:8px 8px;font-size:11px;">날짜</th>
              <th style="padding:8px 8px;font-size:11px;">고객사</th>
              <th style="padding:8px 8px;font-size:11px;">업무내용</th>
              <th style="padding:8px 8px;font-size:11px;text-align:right;">시간</th>
              <th style="padding:8px 8px;font-size:11px;text-align:center;">상태</th>
            </tr></thead>
            <tbody>${recentRows}</tbody>
          </table>
        </div>
        <div style="background:#f8fafc;border-top:1px solid var(--border-light);padding:8px 14px;text-align:center">
          <button class="btn btn-xs btn-outline" onclick="navigateTo('my-entries')"
            style="font-size:11px;padding:5px 14px;">
            <i class="fas fa-list"></i>&nbsp; My Time Sheet 전체 보기
          </button>
        </div>
      </div>
    </div>`;

  // 막대 애니메이션
  requestAnimationFrame(() => {
    container.querySelectorAll('.bar-fill').forEach(el => {
      el.style.width = el.dataset.target + '%';
    });
  });
}

// ══════════════════════════════════════════════
// MANAGER 대시보드
// 팀원 = approver_id가 본인인 Staff
// ══════════════════════════════════════════════
async function renderManagerDashboard(session) {
  try {
    const [allEntriesRaw, allUsers] = await Promise.all([_getCachedEntries(), Master.users()]);

    const month = thisMonthStr();
    const prevMonth = prevMonthStr();

    const visibleUserIds = _getVisibleUserIdSetForDashboard(session, allUsers);
    let scopedEntries = allEntriesRaw;
    if (visibleUserIds) {
      scopedEntries = allEntriesRaw.filter(e => visibleUserIds.has(String(e.user_id)));
    }

    const curEntriesAll  = scopedEntries.filter(e => entryMonth(e) === month);
    const prevEntriesAll = scopedEntries.filter(e => entryMonth(e) === prevMonth);
    const approvedCur  = curEntriesAll.filter(e => e.status === 'approved');
    const approvedPrev = prevEntriesAll.filter(e => e.status === 'approved');
    const pendingCur   = curEntriesAll.filter(e => e.status === 'submitted');

    const stats = _buildLeaderMonthlyStats(approvedCur, approvedPrev);
    const clientRadar = _buildClientRadar(approvedCur, approvedPrev);

    const totalMinCur = approvedCur.reduce((s,e)=>s+(e.duration_minutes||0),0);
    const consultMinCur = approvedCur.filter(e=>e.time_category==='client').reduce((s,e)=>s+(e.duration_minutes||0),0);
    const consultCntCur = approvedCur.filter(e=>e.time_category==='client').length;
    const totalMinPrev = approvedPrev.reduce((s,e)=>s+(e.duration_minutes||0),0);
    const consultCntPrev = approvedPrev.filter(e=>e.time_category==='client').length;

    const dTotal = _fmtPctDelta(totalMinCur, totalMinPrev);
    const dCnt = _fmtPctDelta(consultCntCur, consultCntPrev);

    document.getElementById('kpi-grid').innerHTML =
      kpiCard('fa-clock', '', '', '당월 총 투입', (totalMinCur/60).toFixed(1), 'h', `전월 ${dTotal.label}`, '', '#1a2b45') +
      kpiCard('fa-briefcase','', '', '당월 자문(고객)', (consultMinCur/60).toFixed(1), 'h', `건수 ${consultCntCur}건 · 전월 ${dCnt.label}`, '', '#2d6bb5') +
      kpiCard('fa-hourglass-half','', '', '승인 대기', pendingCur.length, '건', pendingCur.length>0?'Approval로 처리':'대기 없음', pendingCur.length>0?'approval':'', pendingCur.length>0?'#d97706':'#4a7fc4') +
      kpiCard('fa-users','', '', '대상 직원', visibleUserIds ? visibleUserIds.size : 0, '명', '승인자 기준', '', '#6b95ce');

    const sortedByMin = stats.slice().sort((a,b)=> (b.curMin||0)-(a.curMin||0));
    const top5 = sortedByMin.slice(0,5);
    const bottom5 = sortedByMin.slice(-5).reverse();

    const topHtml = top5.map(r=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f4f6f9">
      <div style="font-weight:700;font-size:12px;color:#1a2b45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Utils.escHtml(r.user_name)}</div>
      <div style="text-align:right;white-space:nowrap"><span style="font-weight:800">${(r.curMin/60).toFixed(1)}h</span><span style="color:#94a3b8;font-size:11px"> · ${r.curConsultCnt}건</span></div>
    </div>`).join('') || `<div style="padding:18px;text-align:center;color:#94a3b8;font-size:12px">데이터 없음</div>`;
    const bottomHtml = bottom5.map(r=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f4f6f9">
      <div style="font-weight:700;font-size:12px;color:#1a2b45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Utils.escHtml(r.user_name)}</div>
      <div style="text-align:right;white-space:nowrap"><span style="font-weight:800">${(r.curMin/60).toFixed(1)}h</span><span style="color:#94a3b8;font-size:11px"> · ${r.curConsultCnt}건</span></div>
    </div>`).join('') || `<div style="padding:18px;text-align:center;color:#94a3b8;font-size:12px">데이터 없음</div>`;

    const spikeRows = stats
      .map(r => ({ ...r, dH:_fmtPctDelta(r.curMin,r.prevMin), dC:_fmtPctDelta(r.curConsultCnt,r.prevConsultCnt) }))
      .filter(r => (Math.abs(r.dH.pct) >= 30 || Math.abs(r.dC.pct) >= 30) && (r.prevMin >= 60 || r.prevConsultCnt >= 2))
      .sort((a,b)=> (Math.max(Math.abs(b.dH.pct),Math.abs(b.dC.pct)) - Math.max(Math.abs(a.dH.pct),Math.abs(a.dC.pct))))
      .slice(0,10);
    const spikeHtml = spikeRows.map(r=> {
      const hClr = r.dH.cls==='up' ? '#dc2626' : '#2563eb';
      const cClr = r.dC.cls==='up' ? '#dc2626' : '#2563eb';
      return `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f4f6f9">
        <div style="min-width:90px;max-width:140px;font-weight:700;font-size:12px;color:#1a2b45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Utils.escHtml(r.user_name)}</div>
        <div style="text-align:right;white-space:nowrap">
          <span style="font-size:11px;color:${hClr};font-weight:800">시간 ${r.dH.label}</span>
          <span style="color:#cbd5e1;margin:0 4px">|</span>
          <span style="font-size:11px;color:${cClr};font-weight:800">건수 ${r.dC.label}</span>
        </div>
      </div>`;
    }).join('') || `<div style="padding:18px;text-align:center;color:#94a3b8;font-size:12px">급변(±30%) 데이터 없음</div>`;

    const clientRows = clientRadar
      .map(c => ({ ...c, dH:_fmtPctDelta(c.curMin,c.prevMin), dC:_fmtPctDelta(c.curCnt,c.prevCnt) }))
      .filter(c => (c.dH.pct >= 30 || c.dC.pct >= 30) && (c.prevMin >= 60 || c.prevCnt >= 2))
      .sort((a,b)=> (Math.max(b.dH.pct,b.dC.pct) - Math.max(a.dH.pct,a.dC.pct)))
      .slice(0,10);
    const clientHtml = clientRows.map(c => {
      return `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f4f6f9">
        <div style="min-width:100px;max-width:160px;font-weight:700;font-size:12px;color:#1a2b45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${Utils.escHtml(c.client_name)}">${Utils.escHtml(c.client_name)}</div>
        <div style="text-align:right;white-space:nowrap">
          <span style="font-size:11px;color:#dc2626;font-weight:800">시간 ${c.dH.label}</span>
          <span style="color:#cbd5e1;margin:0 4px">|</span>
          <span style="font-size:11px;color:#dc2626;font-weight:800">건수 ${c.dC.label}</span>
        </div>
      </div>`;
    }).join('') || `<div style="padding:18px;text-align:center;color:#94a3b8;font-size:12px">급증 고객 없음</div>`;

    const chartSection = document.getElementById('chart-row-1');
    if (chartSection) {
      chartSection.style.gridTemplateColumns = 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)';
      chartSection.innerHTML = `
        <div class="card">
          <div class="card-header" style="padding:12px 16px 10px">
            <h2><i class="fas fa-balance-scale" style="color:var(--primary)"></i> &nbsp;${_overloadWorkloadCardTitle(session)}</h2>
            <span style="font-size:11px;font-weight:400;color:var(--text-muted)">${month} 누적 · 시간(h) + 자문건수</span>
          </div>
          <div class="card-body" style="padding:10px 14px;max-height:260px;overflow:auto">
            <div style="font-size:11px;color:#64748b;font-weight:700;margin-bottom:6px">Top 5</div>
            ${topHtml}
            <div style="height:10px"></div>
            <div style="font-size:11px;color:#64748b;font-weight:700;margin-bottom:6px">Bottom 5</div>
            ${bottomHtml}
          </div>
        </div>
        <div class="card">
          <div class="card-header" style="padding:12px 16px 10px">
            <h2><i class="fas fa-bolt" style="color:#dc2626"></i> &nbsp;전월 대비 급변(±30%)</h2>
            <span style="font-size:11px;font-weight:400;color:var(--text-muted)">${prevMonth} → ${month} · 시간/건수</span>
          </div>
          <div class="card-body" style="padding:10px 14px;max-height:260px;overflow:auto">
            ${spikeHtml}
          </div>
        </div>
        <div class="card">
          <div class="card-header" style="padding:12px 16px 10px">
            <h2><i class="fas fa-building" style="color:var(--primary)"></i> &nbsp;고객 이슈 레이더</h2>
            <span style="font-size:11px;font-weight:400;color:var(--text-muted)">${prevMonth} → ${month} · 자문 급증 고객</span>
          </div>
          <div class="card-body" style="padding:10px 14px;max-height:260px;overflow:auto">
            ${clientHtml}
          </div>
        </div>`;
    }

    const bottom = document.getElementById('recent-entries-section');
    if (bottom) {
      bottom.innerHTML = `
        <div class="card" style="margin-top:10px">
          <div class="card-header" style="padding:10px 16px 8px">
            <h2><i class="fas fa-arrow-right" style="color:var(--primary)"></i> &nbsp;바로가기</h2>
            <span style="font-size:11px;font-weight:400;color:var(--text-muted)">분석 화면에서 필터로 상세 확인</span>
          </div>
          <div class="card-body" style="padding:10px 16px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-primary" onclick="navigateTo('analysis')"><i class="fas fa-chart-bar"></i> Analysis 열기</button>
            <button class="btn btn-sm btn-ghost" onclick="navigateTo('approval')"><i class="fas fa-check-double"></i> Approval</button>
          </div>
        </div>`;
    }

  } catch (err) { console.error('Manager Dashboard error:', err); }
}

// ══════════════════════════════════════════════
// DIRECTOR / ADMIN 대시보드
// 전체 팀 현황
// ══════════════════════════════════════════════
async function renderDirectorDashboard(session) {
  try {
    const [allEntriesRaw, allUsers, allTeams] = await Promise.all([
      _getCachedEntries(),
      Master.users(),
      Master.teams(),
    ]);

    const month = thisMonthStr();
    const prevMonth = prevMonthStr();

    const visibleUserIds = _getVisibleUserIdSetForDashboard(session, allUsers);
    let scopedEntries = allEntriesRaw;
    if (visibleUserIds) {
      scopedEntries = allEntriesRaw.filter(e => visibleUserIds.has(String(e.user_id)));
    }

    const curEntriesAll  = scopedEntries.filter(e => entryMonth(e) === month);
    const prevEntriesAll = scopedEntries.filter(e => entryMonth(e) === prevMonth);
    const approvedCur  = curEntriesAll.filter(e => e.status === 'approved');
    const approvedPrev = prevEntriesAll.filter(e => e.status === 'approved');
    const pendingCur   = curEntriesAll.filter(e => e.status === 'submitted');

    const stats = _buildLeaderMonthlyStats(approvedCur, approvedPrev);
    const clientRadar = _buildClientRadar(approvedCur, approvedPrev);

    const totalMinCur = approvedCur.reduce((s,e)=>s+(e.duration_minutes||0),0);
    const consultMinCur = approvedCur.filter(e=>e.time_category==='client').reduce((s,e)=>s+(e.duration_minutes||0),0);
    const consultCntCur = approvedCur.filter(e=>e.time_category==='client').length;
    const totalMinPrev = approvedPrev.reduce((s,e)=>s+(e.duration_minutes||0),0);
    const consultCntPrev = approvedPrev.filter(e=>e.time_category==='client').length;

    const dTotal = _fmtPctDelta(totalMinCur, totalMinPrev);
    const dCnt = _fmtPctDelta(consultCntCur, consultCntPrev);

    // 대상 직원 수
    const staffCount = (visibleUserIds ? visibleUserIds.size : allUsers.filter(u => u.role === 'staff').length);
    const extraKpi = Auth.isAdmin(session)
      ? kpiCard('fa-cog', '', '', '등록 직원', allUsers.filter(u=>u.is_active!==false).length, '명', `팀 ${allTeams.length}개`, '', '#6b95ce')
      : kpiCard('fa-users','', '', '대상 직원', staffCount, '명', '범위 기준', '', '#6b95ce');

    document.getElementById('kpi-grid').innerHTML =
      kpiCard('fa-clock', '', '', '당월 총 투입', (totalMinCur/60).toFixed(1), 'h', `전월 ${dTotal.label}`, '', '#1a2b45') +
      kpiCard('fa-briefcase','', '', '당월 자문(고객)', (consultMinCur/60).toFixed(1), 'h', `건수 ${consultCntCur}건 · 전월 ${dCnt.label}`, '', '#2d6bb5') +
      kpiCard('fa-hourglass-half','', '', '승인 대기', pendingCur.length, '건', '당월 제출', pendingCur.length>0?'approval':'', pendingCur.length>0?'#d97706':'#4a7fc4') +
      extraKpi;

    const sortedByMin = stats.slice().sort((a,b)=> (b.curMin||0)-(a.curMin||0));
    const top5 = sortedByMin.slice(0,5);
    const bottom5 = sortedByMin.slice(-5).reverse();

    const topHtml = top5.map(r=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f4f6f9">
      <div style="font-weight:700;font-size:12px;color:#1a2b45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Utils.escHtml(r.user_name)}</div>
      <div style="text-align:right;white-space:nowrap"><span style="font-weight:800">${(r.curMin/60).toFixed(1)}h</span><span style="color:#94a3b8;font-size:11px"> · ${r.curConsultCnt}건</span></div>
    </div>`).join('') || `<div style="padding:18px;text-align:center;color:#94a3b8;font-size:12px">데이터 없음</div>`;
    const bottomHtml = bottom5.map(r=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f4f6f9">
      <div style="font-weight:700;font-size:12px;color:#1a2b45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Utils.escHtml(r.user_name)}</div>
      <div style="text-align:right;white-space:nowrap"><span style="font-weight:800">${(r.curMin/60).toFixed(1)}h</span><span style="color:#94a3b8;font-size:11px"> · ${r.curConsultCnt}건</span></div>
    </div>`).join('') || `<div style="padding:18px;text-align:center;color:#94a3b8;font-size:12px">데이터 없음</div>`;

    const spikeRows = stats
      .map(r => ({ ...r, dH:_fmtPctDelta(r.curMin,r.prevMin), dC:_fmtPctDelta(r.curConsultCnt,r.prevConsultCnt) }))
      .filter(r => (Math.abs(r.dH.pct) >= 30 || Math.abs(r.dC.pct) >= 30) && (r.prevMin >= 60 || r.prevConsultCnt >= 2))
      .sort((a,b)=> (Math.max(Math.abs(b.dH.pct),Math.abs(b.dC.pct)) - Math.max(Math.abs(a.dH.pct),Math.abs(a.dC.pct))))
      .slice(0,10);
    const spikeHtml = spikeRows.map(r=> {
      const hClr = r.dH.cls==='up' ? '#dc2626' : '#2563eb';
      const cClr = r.dC.cls==='up' ? '#dc2626' : '#2563eb';
      return `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f4f6f9">
        <div style="min-width:90px;max-width:140px;font-weight:700;font-size:12px;color:#1a2b45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Utils.escHtml(r.user_name)}</div>
        <div style="text-align:right;white-space:nowrap">
          <span style="font-size:11px;color:${hClr};font-weight:800">시간 ${r.dH.label}</span>
          <span style="color:#cbd5e1;margin:0 4px">|</span>
          <span style="font-size:11px;color:${cClr};font-weight:800">건수 ${r.dC.label}</span>
        </div>
      </div>`;
    }).join('') || `<div style="padding:18px;text-align:center;color:#94a3b8;font-size:12px">급변(±30%) 데이터 없음</div>`;

    const clientRows = clientRadar
      .map(c => ({ ...c, dH:_fmtPctDelta(c.curMin,c.prevMin), dC:_fmtPctDelta(c.curCnt,c.prevCnt) }))
      .filter(c => (c.dH.pct >= 30 || c.dC.pct >= 30) && (c.prevMin >= 60 || c.prevCnt >= 2))
      .sort((a,b)=> (Math.max(b.dH.pct,b.dC.pct) - Math.max(a.dH.pct,a.dC.pct)))
      .slice(0,10);
    const clientHtml = clientRows.map(c => {
      return `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #f4f6f9">
        <div style="min-width:100px;max-width:160px;font-weight:700;font-size:12px;color:#1a2b45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${Utils.escHtml(c.client_name)}">${Utils.escHtml(c.client_name)}</div>
        <div style="text-align:right;white-space:nowrap">
          <span style="font-size:11px;color:#dc2626;font-weight:800">시간 ${c.dH.label}</span>
          <span style="color:#cbd5e1;margin:0 4px">|</span>
          <span style="font-size:11px;color:#dc2626;font-weight:800">건수 ${c.dC.label}</span>
        </div>
      </div>`;
    }).join('') || `<div style="padding:18px;text-align:center;color:#94a3b8;font-size:12px">급증 고객 없음</div>`;

    const chartSection = document.getElementById('chart-row-1');
    if (chartSection) {
      chartSection.style.gridTemplateColumns = 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)';
      chartSection.innerHTML = `
        <div class="card">
          <div class="card-header" style="padding:12px 16px 10px">
            <h2><i class="fas fa-balance-scale" style="color:var(--primary)"></i> &nbsp;${_overloadWorkloadCardTitle(session)}</h2>
            <span style="font-size:11px;font-weight:400;color:var(--text-muted)">${month} 누적 · 시간(h) + 자문건수</span>
          </div>
          <div class="card-body" style="padding:10px 14px;max-height:260px;overflow:auto">
            <div style="font-size:11px;color:#64748b;font-weight:700;margin-bottom:6px">Top 5</div>
            ${topHtml}
            <div style="height:10px"></div>
            <div style="font-size:11px;color:#64748b;font-weight:700;margin-bottom:6px">Bottom 5</div>
            ${bottomHtml}
          </div>
        </div>
        <div class="card">
          <div class="card-header" style="padding:12px 16px 10px">
            <h2><i class="fas fa-bolt" style="color:#dc2626"></i> &nbsp;전월 대비 급변(±30%)</h2>
            <span style="font-size:11px;font-weight:400;color:var(--text-muted)">${prevMonth} → ${month} · 시간/건수</span>
          </div>
          <div class="card-body" style="padding:10px 14px;max-height:260px;overflow:auto">
            ${spikeHtml}
          </div>
        </div>
        <div class="card">
          <div class="card-header" style="padding:12px 16px 10px">
            <h2><i class="fas fa-building" style="color:var(--primary)"></i> &nbsp;고객 이슈 레이더</h2>
            <span style="font-size:11px;font-weight:400;color:var(--text-muted)">${prevMonth} → ${month} · 자문 급증 고객</span>
          </div>
          <div class="card-body" style="padding:10px 14px;max-height:260px;overflow:auto">
            ${clientHtml}
          </div>
        </div>`;
    }

    const bottom = document.getElementById('recent-entries-section');
    if (bottom) {
      bottom.innerHTML = `
        <div class="card" style="margin-top:10px">
          <div class="card-header" style="padding:10px 16px 8px">
            <h2><i class="fas fa-arrow-right" style="color:var(--primary)"></i> &nbsp;바로가기</h2>
            <span style="font-size:11px;font-weight:400;color:var(--text-muted)">분석 화면에서 필터로 상세 확인</span>
          </div>
          <div class="card-body" style="padding:10px 16px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-primary" onclick="navigateTo('analysis')"><i class="fas fa-chart-bar"></i> Analysis 열기</button>
            <button class="btn btn-sm btn-ghost" onclick="navigateTo('approval')"><i class="fas fa-check-double"></i> Approval</button>
          </div>
        </div>`;
    }

  } catch (err) { console.error('Director Dashboard error:', err); }
}


