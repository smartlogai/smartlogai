/* ============================================
   dashboard.js — 역할별 대시보드
   Staff   : 본인 업무 현황
   Manager : 승인자(본인)로 지정된 팀원 현황 + 승인 대기
   Director: 전체 팀 현황 + 고객사별 투입
   Admin   : 전체 현황 + 시스템 현황
   ============================================ */

let _dashCharts = {};

// ─────────────────────────────────────────────
// ★ 성능 최적화: time_entries 캐시 (3분 TTL)
// 대시보드 재진입 시 동일 데이터 재활용
// ─────────────────────────────────────────────
async function _getCachedEntries() {
  return Cache.get('dash_time_entries', async () => {
    // ★ 모든 상태 항목 한 번에 로드 (limit 1000 → 서버 최대 허용치 내)
    const res = await API.list('time_entries', { limit: 1000 });
    const data = (res && res.data) ? res.data : [];
    const total = (res && res.total) || data.length;

    // ★ 서버가 limit보다 많은 데이터를 가지고 있을 경우 2페이지도 로드
    if (total > data.length && data.length >= 1000) {
      try {
        const res2 = await API.list('time_entries', { limit: 1000, page: 2 });
        if (res2 && res2.data && res2.data.length > 0) {
          data.push(...res2.data);
        }
      } catch(e) { console.warn('[Dashboard] 2페이지 로드 실패:', e); }
    }
    return data;
  }, 60000); // 1분 TTL (승인 직후 반영)
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
// 공통: 고객사 바 행 HTML 생성
// cliEntries: [[name, min], ...] 전체 정렬된 배열 (opacity 계산용)
// entries: 실제 렌더링할 슬라이스
// totalCliMin: 전체 합계
// ─────────────────────────────────────────────
function buildCliRows(entries, cliEntries, totalCliMin) {
  if (!entries.length) return `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px">데이터 없음</div>`;
  const maxMin = cliEntries[0][1];
  return entries.map(([name, min], idx) => {
    // 전체 리스트에서의 순위 인덱스로 opacity 계산
    const globalIdx = cliEntries.findIndex(([n]) => n === name);
    const opacity = Math.max(0.35, 1 - globalIdx * (0.55 / Math.max(cliEntries.length - 1, 1)));
    const barClr  = `rgba(45,107,181,${opacity.toFixed(2)})`;
    const txtClr  = `rgba(45,107,181,${Math.min(1, opacity + 0.2).toFixed(2)})`;
    const hours   = (min / 60).toFixed(1);
    const pct     = totalCliMin > 0 ? Math.round(min / totalCliMin * 100) : 0;
    const barW    = maxMin > 0 ? (min / maxMin * 100).toFixed(1) : 0;
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f4f6f9;" title="${name}">
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
// 공통: 고객사+직원 하단 섹션 렌더링
// mode: 'director' | 'manager' | 'staff'
// ─────────────────────────────────────────────
async function renderBottomSection(container, {
  cliMap, allEntries, approvedEntries,
  staffList, maxRefStaff, month, mode
}) {
  // 고객사 데이터 (상위 15 + 기타)
  const cliAll     = Object.entries(cliMap).sort((a,b) => b[1] - a[1]);
  const top15      = cliAll.slice(0, 15);
  const etcMin     = cliAll.slice(15).reduce((s,[,v]) => s + v, 0);
  const cliEntries = etcMin > 0 ? [...top15, ['기타', etcMin]] : top15;
  const totalCliMin = cliEntries.reduce((s,[,v]) => s + v, 0);

  // ★ archive_items(별점) 없이 먼저 렌더링 → 별점만 나중에 업데이트 (지연 로드)
  const staffHTML = buildStaffStatRows(staffList, approvedEntries, allEntries, maxRefStaff, []);

  // 고객사 행 HTML (단일 컬럼 — 카드 내부 스크롤)
  const cliHTML = buildCliRows(cliEntries, cliEntries, totalCliMin);

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:10px;">
      <!-- 고객사별 투입시간 -->
      <div class="card">
        <div class="card-header" style="padding:12px 16px 10px">
          <h2><i class="fas fa-building" style="color:var(--primary)"></i> &nbsp;고객사별 투입시간</h2>
          <span style="font-size:11px;font-weight:400;color:var(--text-muted)">
            상위 15+기타 · 승인 완료 기준
          </span>
        </div>
        <div class="card-body" style="padding:10px 14px;max-height:460px;overflow-y:auto;">
          <div id="cli-rows-inner">${cliHTML}</div>
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
    // ★ 고객사별: 본인 승인 데이터만 (approvedMonth 기준)
    const cliMap = {};
    approvedMonth.filter(e => e.time_category === 'client').forEach(e => {
      const k = e.client_name || '미지정';
      cliMap[k] = (cliMap[k]||0) + (e.duration_minutes||0);
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

    // ── 하단: 본인 고객사별 투입시간(좌) + 본인 최근 업무 기록(우) ────────────────
    // ★ Staff는 본인 데이터만 표시 — 다른 직원 현황 비공개
    const recentSection = document.getElementById('recent-entries-section');
    if (recentSection) {
      recentSection.innerHTML = '';
      _renderStaffBottomSection(recentSection, {
        cliMap,
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
//   좌) 고객사별 투입시간 (본인)
//   우) 본인 최근 업무 기록 목록
// ─────────────────────────────────────────────
async function _renderStaffBottomSection(container, { cliMap, myEntries, approvedMonth, allEntries, month, session }) {
  // 고객사 데이터 (상위 15 + 기타)
  const cliAll      = Object.entries(cliMap).sort((a,b) => b[1]-a[1]);
  const top15       = cliAll.slice(0, 15);
  const etcMin      = cliAll.slice(15).reduce((s,[,v]) => s+v, 0);
  const cliEntries  = etcMin > 0 ? [...top15, ['기타', etcMin]] : top15;
  const totalCliMin = cliEntries.reduce((s,[,v]) => s+v, 0);
  const cliHTML     = buildCliRows(cliEntries, cliEntries, totalCliMin);

  // 본인 최근 업무기록 (이번달, 최신순 상위 10건)
  const recentMine = [...myEntries]
    .sort((a,b) => Number(b.work_start_at||0) - Number(a.work_start_at||0))
    .slice(0, 10);

  const statusBadge = (s) => {
    const map = {
      approved:    ['var(--success)',   '승인완료'],
      submitted:   ['var(--warning)',   '1차승인대기'],
      pre_approved:['#f97316',          '최종승인대기'],
      rejected:    ['var(--danger)',    '반려'],
      draft:       ['var(--text-muted)','임시저장'],
    };
    const [clr, lbl] = map[s] || ['var(--text-muted)', s||'-'];
    return `<span style="display:inline-block;font-size:10px;font-weight:600;color:${clr};
      background:${clr}18;padding:2px 5px;border-radius:4px;white-space:nowrap;line-height:1.5;">${lbl}</span>`;
  };

  const recentRows = recentMine.length === 0
    ? `<tr><td colspan="5" class="table-empty">
        <i class="fas fa-inbox" style="font-size:18px;opacity:0.3;display:block;margin-bottom:6px"></i>
        <p style="margin:0;font-size:12px;color:var(--text-muted)">이번 달 기록이 없습니다.</p>
       </td></tr>`
    : recentMine.map(e => `
        <tr>
          <td style="font-size:11px;white-space:nowrap;padding:7px 8px;">${Utils.formatDate(e.work_start_at)}</td>
          <td style="font-size:11px;padding:7px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.client_name||''}">${e.client_name || '<span style="color:var(--text-muted)">내부</span>'}</td>
          <td style="font-size:11px;padding:7px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.work_subcategory_name||e.work_category_name||''}">${e.work_subcategory_name||e.work_category_name||'-'}</td>
          <td style="font-size:11px;text-align:right;font-weight:700;color:#1a2b45;padding:7px 8px;white-space:nowrap;">${((e.duration_minutes||0)/60).toFixed(1)}<span style="font-size:9px;font-weight:500;color:#9aa4b2;margin-left:1px">h</span></td>
          <td style="text-align:center;padding:7px 6px;">${statusBadge(e.status)}</td>
        </tr>`).join('');

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:10px;">
      <!-- 내 고객사별 투입시간 -->
      <div class="card">
        <div class="card-header" style="padding:12px 16px 10px">
          <h2><i class="fas fa-building" style="color:var(--primary)"></i> &nbsp;고객사별 투입시간</h2>
          <span style="font-size:11px;font-weight:400;color:var(--text-muted)">
            ${month} · 본인 승인 완료 기준
          </span>
        </div>
        <div class="card-body" style="padding:10px 14px;max-height:460px;overflow-y:auto;">
          ${cliHTML}
        </div>
      </div>
      <!-- 내 최근 업무 기록 -->
      <div class="card">
        <div class="card-header" style="padding:12px 16px 10px">
          <h2><i class="fas fa-list-alt" style="color:var(--primary)"></i> &nbsp;내 업무 기록</h2>
          <span style="font-size:11px;font-weight:400;color:var(--text-muted)">
            ${month} · 최근 10건
          </span>
        </div>
        <div class="card-body" style="padding:0;max-height:420px;overflow-y:auto;">
          <table class="data-table" style="table-layout:fixed;width:100%;border-collapse:collapse;">
            <colgroup>
              <col style="width:82px">
              <col style="width:22%">
              <col style="width:auto">
              <col style="width:46px">
              <col style="width:58px">
            </colgroup>
            <thead><tr>
              <th style="padding:8px 8px;font-size:11px;">날짜</th>
              <th style="padding:8px 8px;font-size:11px;">고객사</th>
              <th style="padding:8px 8px;font-size:11px;">업무내용</th>
              <th style="padding:8px 8px;font-size:11px;text-align:right;">시간</th>
              <th style="padding:8px 6px;font-size:11px;text-align:center;">상태</th>
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
    // ★ 성능 개선: Master 캐시 사용
    const [allEntries, allUsers] = await Promise.all([
      _getCachedEntries(),
      Master.users()
    ]);

    // ★ ID 비교 시 타입 불일치 방지 (DB→문자열, session→혼합)
    const sid = String(session.id);

    // 내 팀원: approver_id가 본인인 Staff (타임시트 대상 + 승인자 지정 필수)
    const myStaff = allUsers.filter(u =>
      String(u.approver_id) === sid &&
      u.role === 'staff' &&
      u.is_active !== false &&
      u.is_timesheet_target !== false &&
      u.approver_id && String(u.approver_id).trim() !== ''
    );
    // 내 팀 타임시트: approver_id가 본인인 항목 (String 비교)
    const myEntries = allEntries.filter(e => String(e.approver_id) === sid);
    // ★ 진단: myEntries 샘플 출력


    const month = thisMonthStr();
    const monthEntries    = myEntries.filter(e => entryMonth(e) === month);
    const approvedMonth   = monthEntries.filter(e => e.status === 'approved');

    console.log('[Dashboard-Manager] myEntries:', myEntries.length, '| month:', month, '| monthEntries:', monthEntries.length, '| approvedMonth:', approvedMonth.length);
    // 샘플 로그: 첫 번째 entry의 work_start_at 형식 확인
    if (allEntries.length > 0) console.log('[Dashboard] work_start_at sample:', allEntries[0].work_start_at, typeof allEntries[0].work_start_at);
    const pendingEntries  = myEntries.filter(e => e.status === 'submitted');

    const totalMin   = approvedMonth.reduce((s, e) => s + (e.duration_minutes||0), 0);
    const clientMin  = approvedMonth.filter(e => e.time_category==='client').reduce((s,e)=>s+(e.duration_minutes||0),0);
    const clientRatio = totalMin > 0 ? Math.round(clientMin/totalMin*100) : 0;

    document.getElementById('kpi-grid').innerHTML =
      kpiCard('fa-users',         '', '', '담당 팀원',    myStaff.length,               '명', '승인자 Staff',   '',                                           '#1a2b45') +
      kpiCard('fa-clock',         '', '', '팀 투입시간',  (totalMin/60).toFixed(1),     'h',  `고객 ${clientRatio}%`, '',                                  '#2d6bb5') +
      kpiCard('fa-hourglass-half','', '', '승인 대기',    pendingEntries.length,        '건',
        pendingEntries.length > 0 ? 'Approval 처리' : '대기 없음',
        pendingEntries.length > 0 ? 'approval' : '',
        pendingEntries.length > 0 ? '#d97706' : '#4a7fc4') +
      kpiCard('fa-briefcase',     '', '', '고객 업무',    (clientMin/60).toFixed(1),    'h',  '승인 완료',      '',                                           '#6b95ce');

    // ── 데이터 집계 ──────────────────────────────────────────
    // 대분류별 투입시간
    const majorMap = {};
    approvedMonth.forEach(e => {
      const k = e.work_category_name || '미분류';
      majorMap[k] = (majorMap[k]||0) + (e.duration_minutes||0);
    });

    // 소분류별 투입시간
    const subMap = {};
    approvedMonth.forEach(e => {
      const k = e.work_subcategory_name || e.work_category_name || '미분류';
      subMap[k] = (subMap[k]||0) + (e.duration_minutes||0);
    });

    // 고객사별 투입시간
    const cliMap = {};
    approvedMonth.filter(e=>e.time_category==='client').forEach(e => {
      const k = e.client_name || '미지정';
      cliMap[k] = (cliMap[k]||0) + (e.duration_minutes||0);
    });

    // ── 차트 섹션: 대분류(좌) + 소분류(우) ──────────────────
    const chartSection = document.getElementById('chart-row-1');
    if (chartSection) {
      chartSection.style.gridTemplateColumns = '1fr 1fr';
      chartSection.innerHTML = `
        <div class="card">
          <div class="card-header" style="padding:12px 16px 10px">
            <h2><i class="fas fa-layer-group" style="color:var(--primary)"></i> &nbsp;업무별 투입시간</h2>
            <span style="font-size:11px;font-weight:400;color:var(--text-muted)">대분류 기준</span>
          </div>
          <div class="card-body" style="min-height:200px;position:relative;padding:10px 12px">
            <canvas id="chart-type"></canvas>
          </div>
        </div>
        <div class="card">
          <div class="card-header" style="padding:12px 16px 10px">
            <h2><i class="fas fa-bars" style="color:var(--primary)"></i> &nbsp;상세업무별 투입시간</h2>
            <span style="font-size:11px;font-weight:400;color:var(--text-muted)">소분류 기준 · 상위 5+기타</span>
          </div>
          <div class="card-body" style="min-height:200px;position:relative;padding:10px 12px">
            <canvas id="chart-sub"></canvas>
          </div>
        </div>`;

      renderBarChart('chart-type', collapseToTopN(majorMap, 8));
      renderBarChart('chart-sub',  collapseToTopN(subMap,   5));
    }

    // ── 승인 대기 현황 (조회 전용 — 승인 처리는 Approval 메뉴에서) ──
    const recentSection = document.getElementById('recent-entries-section');
    if (recentSection) {
      const pendingCount = pendingEntries.length;
      recentSection.innerHTML = `
        <div class="card" style="margin-top:10px">
          <div class="card-header" style="padding:10px 16px 8px">
            <h2>
              <i class="fas fa-hourglass-half" style="color:${pendingCount > 0 ? 'var(--danger)' : 'var(--success)'}"></i>
              &nbsp;승인 대기 현황
              ${pendingCount > 0
                ? `<span class="badge badge-red" style="margin-left:8px;font-size:12px;vertical-align:middle">${pendingCount}건 대기</span>`
                : `<span style="margin-left:8px;font-size:11px;color:var(--text-muted);font-weight:400;vertical-align:middle">모두 처리완료</span>`}
            </h2>
            <div class="card-actions"></div>
          </div>
          ${pendingCount > 0
            ? `<div style="background:#fff7ed;border-bottom:1px solid #fed7aa;padding:10px 16px;
                           font-size:12px;color:#9a3412;display:flex;align-items:center;
                           justify-content:space-between;gap:8px;flex-wrap:wrap">
                <span>
                  <i class="fas fa-info-circle"></i>&nbsp;
                  팀원이 제출한 타임시트 <strong>${pendingCount}건</strong>이 승인을 기다리고 있습니다.
                </span>
                <button class="btn btn-sm btn-primary" onclick="navigateTo('approval')"
                  style="white-space:nowrap;font-size:11px">
                  <i class="fas fa-check-double"></i> Approval에서 승인 처리
                </button>
               </div>`
            : ''}
          <div class="card-body" style="padding:0">
            <div class="table-wrapper" style="border:none;border-radius:0">
              <table class="data-table" style="table-layout:fixed;width:100%">
                <colgroup>
                  <col style="width:82px">   <!-- 날짜 고정 -->
                  <col style="width:58px">   <!-- Staff 고정 -->
                  <col style="width:66px">   <!-- 승인자 고정 -->
                  <col style="width:70px">   <!-- 팀명 고정 -->
                  <col>                      <!-- 고객사 (auto) -->
                  <col>                      <!-- 업무내용 (auto) -->
                  <col style="width:52px">   <!-- 경과 고정 -->
                </colgroup>
                <thead><tr>
                  <th>날짜</th><th>Staff</th><th>승인자</th><th>팀명</th><th>고객사</th>
                  <th>업무내용</th>
                  <th style="text-align:center">경과</th>
                </tr></thead>
                <tbody id="manager-pending-tbody"></tbody>
              </table>
            </div>
          </div>
          ${pendingCount > 0 ? `
          <div style="background:#f8fafc;border-top:1px solid var(--border-light);
                      padding:10px 16px;text-align:center">
            <span style="font-size:12px;color:var(--text-muted)">
              <i class="fas fa-info-circle"></i>
              &nbsp;승인·반려 처리 및 자문자료 저장은 좌측 메뉴의
              <strong style="color:var(--primary);cursor:pointer"
                onclick="navigateTo('approval')"> Approval</strong>
              에서 하실 수 있습니다.
            </span>
          </div>` : ''}
        </div>`;

      const ptbody = document.getElementById('manager-pending-tbody');
      // 제출일 오래된 순 정렬 (가장 급한 건 상단)
      const recent5 = [...pendingEntries]
        .sort((a,b) => Number(a.work_start_at||0) - Number(b.work_start_at||0))
        .slice(0, 5);

      if (recent5.length === 0) {
        ptbody.innerHTML = `<tr><td colspan="7" class="table-empty">
          <i class="fas fa-check-circle" style="color:var(--success)"></i>
          <p>승인 대기 항목이 없습니다.<br>
          <span style="font-size:12px;color:var(--text-muted)">모든 팀원의 타임시트가 처리되었습니다.</span></p>
        </td></tr>`;
      } else {
        const now = Date.now();
        ptbody.innerHTML = recent5.map(e => {
          // 제출 경과 시간 (updated_at 기준)
          const submittedAt = Number(e.updated_at || e.created_at || 0);
          const waitDays = submittedAt > 0 ? Math.floor((now - submittedAt) / 86400000) : 0;
          const waitLabel = waitDays === 0 ? '오늘'
            : waitDays === 1 ? '어제'
            : `${waitDays}일 전`;
          const urgentColor = waitDays >= 3 ? 'var(--danger)'
            : waitDays >= 1 ? 'var(--warning)'
            : 'var(--text-muted)';
          return `<tr>
            <td>${Utils.formatDate(e.work_start_at)}</td>
            <td title="${e.user_name||''}"><strong>${e.user_name||'-'}</strong></td>
            <td title="${e.approver_name||''}" style="font-size:11px;color:var(--text-muted)">${e.approver_name||'-'}</td>
            <td title="${e.team_name||''}" style="font-size:11px;color:var(--text-muted)">${e.team_name||'-'}</td>
            <td title="${e.client_name||''}">${e.client_name||'<span style="color:var(--text-muted)">내부</span>'}</td>
            <td class="td-subcategory" title="${e.work_subcategory_name||''}">${e.work_subcategory_name||'-'}</td>
            <td class="td-badge" style="text-align:center">
              <span style="font-size:11px;font-weight:600;color:${urgentColor};white-space:nowrap">
                <i class="fas fa-clock" style="font-size:9px"></i> ${waitLabel}
              </span>
            </td>
          </tr>`;
        }).join('')
        + (pendingEntries.length > 5
            ? `<tr><td colspan="7" style="text-align:center;padding:12px;background:#f8fafc">
                 <span style="font-size:12px;color:var(--text-muted)">
                   외 ${pendingEntries.length - 5}건 더 있습니다.
                 </span>
                 <button class="btn btn-xs btn-outline" style="margin-left:10px"
                   onclick="navigateTo('approval')">
                   <i class="fas fa-list"></i> Approval에서 전체 보기
                 </button>
               </td></tr>`
            : '');
      }

      // ── 하단: 고객사별(좌) + 직원별 통계(우) ──────────────
      // Manager: 소속 팀원 기준 (전체 직원 최다 대비)
      // ★ 이미 로드된 allUsers 재사용 (중복 API 호출 제거)
      const allActiveStaff = allUsers.filter(u =>
        u.role === 'staff' &&
        u.is_active !== false &&
        u.is_timesheet_target !== false &&
        u.approver_id && String(u.approver_id).trim() !== ''
      );
      // ★ 이미 로드된 allEntries 재사용
      const approvedAll2 = allEntries.filter(e => {
        const m = entryMonth(e);
        return m === month && e.status === 'approved';
      });
      const maxRefUser = allActiveStaff.reduce((best, u) => {
        const uMin = approvedAll2.filter(e => e.user_id === u.id)
                       .reduce((s,e) => s + (e.duration_minutes||0), 0);
        const bMin = best ? approvedAll2.filter(e => e.user_id === best.id)
                              .reduce((s,e) => s + (e.duration_minutes||0), 0) : 0;
        return uMin > bMin ? u : best;
      }, null);

      const bottomSection = document.createElement('div');
      recentSection.appendChild(bottomSection);
      renderBottomSection(bottomSection, {
        cliMap,
        allEntries,
        approvedEntries: approvedMonth,
        staffList: myStaff,
        maxRefStaff: maxRefUser,
        month,
        mode: 'manager'
      });
    }

  } catch (err) { console.error('Manager Dashboard error:', err); }
}

// ══════════════════════════════════════════════
// DIRECTOR / ADMIN 대시보드
// 전체 팀 현황
// ══════════════════════════════════════════════
async function renderDirectorDashboard(session) {
  try {
    // ★ 성능 개선: Master 캐시 사용
    const [allEntriesRaw, allUsers, allTeams] = await Promise.all([
      _getCachedEntries(),
      Master.users(),
      Master.teams(),
    ]);

    // ★ Director: 소속 사업부/본부/고객지원팀 범위 직원의 데이터만 표시
    // Admin: 전체 데이터 표시
    let allEntries = allEntriesRaw;
    if (Auth.isDirector(session)) {
      // ★ String 비교로 타입 불일치 방지
      const scopeIds = new Set(allUsers.filter(u => Auth.scopeMatch(session, u)).map(u => String(u.id)));
      allEntries = allEntriesRaw.filter(e => scopeIds.has(String(e.user_id)));
    }

    const month         = thisMonthStr();
    const monthEntries  = allEntries.filter(e => entryMonth(e) === month);
    const approvedMonth = monthEntries.filter(e => e.status === 'approved');
    const pendingAll    = allEntries.filter(e => e.status === 'submitted');

    console.log('[Dashboard-Director] total:', allEntries.length, '| month:', month, '| monthEntries:', monthEntries.length, '| approvedMonth:', approvedMonth.length);
    if (allEntries.length > 0) console.log('[Dashboard-Director] sample work_start_at:', allEntries[0].work_start_at, '| entryMonth result:', entryMonth(allEntries[0]));

    // 표시 대상 staff + manager(타임시트 대상) 목록 (director: 소속 범위, admin: 전체)
    const activeStaffAll = allUsers.filter(u =>
      (u.role === 'staff' || (u.role === 'manager' && u.is_timesheet_target !== false)) &&
      u.is_active !== false &&
      u.is_timesheet_target !== false &&
      (u.role === 'manager' || (u.approver_id && String(u.approver_id).trim() !== ''))
    );
    const scopeStaff = Auth.isDirector(session)
      ? activeStaffAll.filter(u => Auth.scopeMatch(session, u))
      : activeStaffAll;

    const totalMin   = approvedMonth.reduce((s,e)=>s+(e.duration_minutes||0),0);
    const clientMin  = approvedMonth.filter(e=>e.time_category==='client').reduce((s,e)=>s+(e.duration_minutes||0),0);
    const clientRatio = totalMin>0 ? Math.round(clientMin/totalMin*100) : 0;
    const staffCount = scopeStaff.length;

    // Admin: 시스템 현황 추가 KPI
    const extraKpi = Auth.isAdmin(session)
      ? kpiCard('fa-cog',   '', '', '등록 직원',  allUsers.filter(u=>u.is_active!==false).length, '명', `팀 ${allTeams.length}개`, '', '#6b95ce')
      : kpiCard('fa-users', '', '', '전체 Staff', staffCount,                                    '명', '활성 계정 기준',         '', '#6b95ce');

    document.getElementById('kpi-grid').innerHTML =
      kpiCard('fa-clock',         '', '', '전체 투입',  (totalMin/60).toFixed(1),   'h',  '승인 완료 기준', '', '#1a2b45') +
      kpiCard('fa-briefcase',     '', '', '고객 업무',  (clientMin/60).toFixed(1),  'h',  `비율 ${clientRatio}%`,  '', '#2d6bb5') +
      kpiCard('fa-hourglass-half','', '', '승인 대기',  pendingAll.length,          '건', '전체 팀',        pendingAll.length > 0 ? 'approval' : '', pendingAll.length > 0 ? '#d97706' : '#4a7fc4') +
      extraKpi;

    // ── 데이터 집계 ──────────────────────────────────────────
    // 대분류별 투입시간
    const majorMap = {};
    approvedMonth.forEach(e => {
      const k = e.work_category_name || '미분류';
      majorMap[k] = (majorMap[k]||0) + (e.duration_minutes||0);
    });

    // 소분류별 투입시간
    const subMap = {};
    approvedMonth.forEach(e => {
      const k = e.work_subcategory_name || e.work_category_name || '미분류';
      subMap[k] = (subMap[k]||0) + (e.duration_minutes||0);
    });

    // 고객사별 투입시간
    const cliMap = {};
    approvedMonth.filter(e=>e.time_category==='client').forEach(e => {
      const k = e.client_name || '미지정';
      cliMap[k] = (cliMap[k]||0) + (e.duration_minutes||0);
    });

    // ── 차트 섹션: 대분류(좌) + 소분류(우) ──────────────────
    const chartSection = document.getElementById('chart-row-1');
    if (chartSection) {
      chartSection.style.gridTemplateColumns = '1fr 1fr';
      chartSection.innerHTML = `
        <div class="card">
          <div class="card-header" style="padding:12px 16px 10px">
            <h2><i class="fas fa-layer-group" style="color:var(--primary)"></i> &nbsp;업무별 투입시간</h2>
            <span style="font-size:11px;font-weight:400;color:var(--text-muted)">대분류 기준</span>
          </div>
          <div class="card-body" style="min-height:200px;position:relative;padding:10px 12px">
            <canvas id="chart-type"></canvas>
          </div>
        </div>
        <div class="card">
          <div class="card-header" style="padding:12px 16px 10px">
            <h2><i class="fas fa-bars" style="color:var(--primary)"></i> &nbsp;상세업무별 투입시간</h2>
            <span style="font-size:11px;font-weight:400;color:var(--text-muted)">소분류 기준 · 상위 5+기타</span>
          </div>
          <div class="card-body" style="min-height:200px;position:relative;padding:10px 12px">
            <canvas id="chart-sub"></canvas>
          </div>
        </div>`;

      renderBarChart('chart-type', collapseToTopN(majorMap, 8));
      renderBarChart('chart-sub',  collapseToTopN(subMap,   5));
    }

    // ── 하단: 고객사별(좌) + 직원별 통계(우) ────────────────
    const recentSection = document.getElementById('recent-entries-section');
    if (recentSection) {
      // Director: 소속 범위 직원 / Admin: 전체 직원 기준 최다 대비
      const maxRefUser = scopeStaff.reduce((best, u) => {
        const uMin = approvedMonth.filter(e => e.user_id === u.id)
                       .reduce((s,e) => s + (e.duration_minutes||0), 0);
        const bMin = best ? approvedMonth.filter(e => e.user_id === best.id)
                              .reduce((s,e) => s + (e.duration_minutes||0), 0) : 0;
        return uMin > bMin ? u : best;
      }, null);

      recentSection.innerHTML = '';
      renderBottomSection(recentSection, {
        cliMap,
        allEntries,
        approvedEntries: approvedMonth,
        staffList: scopeStaff,
        maxRefStaff: maxRefUser,
        month,
        mode: 'director'
      });
    }

  } catch (err) { console.error('Director Dashboard error:', err); }
}


