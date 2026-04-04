/* ============================================================
   dashboard.js  –  역할별 대시보드
   Staff / Manager / Director / Admin
   ============================================================ */

'use strict';

/* ── 캐시 ── */
let _entryCache = null, _entryCacheTime = 0;
const ENTRY_CACHE_TTL = 60000;

async function _getCachedEntries() {
  const now = Date.now();
  if (_entryCache && now - _entryCacheTime < ENTRY_CACHE_TTL) return _entryCache;
  const r = await API.list('time_entries', { limit: 1000, sort: 'work_date' });
  let rows = r?.data ?? [];
  if (r?.total > 1000) {
    const r2 = await API.list('time_entries', { limit: 1000, page: 2, sort: 'work_date' });
    rows = rows.concat(r2?.data ?? []);
  }
  _entryCache = rows;
  _entryCacheTime = now;
  return rows;
}

/* ── 진입점 ── */
async function init_dashboard() {
  const session = Session.require();
  if (!session) return;

  const invalidate = sessionStorage.getItem('dash_invalidate');
  if (invalidate) { sessionStorage.removeItem('dash_invalidate'); _entryCache = null; }

  const role = session.role;
  if (role === 'staff') {
    const u = await API.get('users', session.userId);
    const user = u?.data ?? u;
    if (!user?.approver_id) { navigateTo('archive'); return; }
    await renderStaffDashboard(session);
  } else if (role === 'manager') {
    await renderManagerDashboard(session);
  } else {
    await renderDirectorDashboard(session);
  }
}

/* ── 공통 유틸 ── */
function collapseToTopN(map, n = 5) {
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n).reduce((s, [, v]) => s + v, 0);
  if (rest > 0) top.push(['기타', rest]);
  return top;
}

function renderBarChart(canvasId, labels, values, color = '#2d6bb5') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const max = Math.max(...values, 1);
  const W = canvas.width = canvas.offsetWidth || 320;
  const H = canvas.height = Math.max(labels.length * 36 + 20, 60);
  ctx.clearRect(0, 0, W, H);
  const barH = 22, padL = 90, padR = 50, padT = 10;
  labels.forEach((lbl, i) => {
    const y = padT + i * 36;
    const bw = Math.round((values[i] / max) * (W - padL - padR));
    const alpha = 1 - (i / labels.length) * 0.45;
    ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, '0');
    ctx.beginPath();
    ctx.roundRect(padL, y, Math.max(bw, 4), barH, 5);
    ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.font = '12px Pretendard, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(lbl.length > 8 ? lbl.slice(0, 8) + '…' : lbl, padL - 6, y + 15);
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText(Utils.minToHM(values[i]), padL + bw + 6, y + 15);
  });
}

function renderDonutChart(canvasId, labels, values, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth || 160;
  const H = canvas.height = W;
  const cx = W / 2, cy = H / 2, r = W * 0.38, ir = W * 0.24;
  ctx.clearRect(0, 0, W, H);
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) return;
  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    const slice = (v / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = colors[i] || '#ccc';
    ctx.fill();
    angle += slice;
  });
  ctx.beginPath();
  ctx.arc(cx, cy, ir, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

/* ── 클라이언트 행 생성 ── */
function buildCliRows(cliMap, cliNameMap, prevMap = {}, showChange = false) {
  const sorted = Object.entries(cliMap).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:12px;">데이터 없음</td></tr>';
  return sorted.map(([cid, mins], idx) => {
    const name = cliNameMap[cid] || cid;
    const prev = prevMap[cid] || 0;
    const diff = mins - prev;
    let changeHtml = '';
    if (showChange && prev > 0) {
      const pct = Math.round((diff / prev) * 100);
      const col = diff >= 0 ? '#16a34a' : '#dc2626';
      const arrow = diff >= 0 ? '▲' : '▼';
      changeHtml = `<span style="color:${col};font-size:10.5px;margin-left:4px;">${arrow}${Math.abs(pct)}%</span>`;
    }
    const bar = Math.min(Math.round((mins / (sorted[0][1] || 1)) * 80), 80);
    return `<tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:7px 8px;font-size:12px;color:#334155;">${idx + 1}. ${Utils.escHtml(name)}</td>
      <td style="padding:7px 8px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="width:${bar}px;height:8px;background:#2d6bb5;border-radius:4px;opacity:${1 - idx * 0.12};flex-shrink:0;"></div>
          <span style="font-size:12px;color:#1e293b;font-weight:600;">${Utils.minToHM(mins)}</span>
          ${changeHtml}
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ── 직원 통계 행 ── */
function buildStaffStatRows(staffMap, userNameMap, prevMap = {}) {
  const sorted = Object.entries(staffMap).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return '<tr><td colspan="2" style="text-align:center;color:#94a3b8;padding:12px;">데이터 없음</td></tr>';
  const max = sorted[0][1] || 1;
  return sorted.map(([uid, mins], idx) => {
    const name = userNameMap[uid] || uid;
    const prev = prevMap[uid] || 0;
    const diff = mins - prev;
    const bar = Math.min(Math.round((mins / max) * 80), 80);
    let star = '';
    if (idx === 0) star = '<span style="color:#f59e0b;margin-left:3px;">★</span>';
    return `<tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:7px 8px;font-size:12px;color:#334155;">${Utils.escHtml(name)}${star}</td>
      <td style="padding:7px 8px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="width:${bar}px;height:8px;background:#7c3aed;border-radius:4px;flex-shrink:0;"></div>
          <span style="font-size:12px;color:#1e293b;font-weight:600;">${Utils.minToHM(mins)}</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* ── 하단 섹션 렌더 ── */
async function renderBottomSection(wrap, cliMap, cliNameMap, staffMap, userNameMap, prevCliMap = {}, showChange = false) {
  const cliRows = buildCliRows(cliMap, cliNameMap, prevCliMap, showChange);
  const staffRows = buildStaffStatRows(staffMap, userNameMap);
  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">
      <div class="card">
        <div class="card-header"><span class="card-title"><i class="fa-solid fa-building" style="color:#2d6bb5;"></i> 고객사별 시간</span></div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">${cliRows}</table>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title"><i class="fa-solid fa-users" style="color:#7c3aed;"></i> 직원별 시간</span></div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">${staffRows}</table>
        </div>
      </div>
    </div>`;
}

/* ── 날짜 헬퍼 ── */
function thisMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function entryMonth(e) { return (e.work_date || '').slice(0, 7); }

/* ── KPI 카드 HTML ── */
function kpiCard(icon, label, value, sub = '', color = '#2d6bb5', bgColor = '#eff6ff') {
  return `<div class="kpi-card" style="border-top:3px solid ${color};background:${bgColor};">
    <div class="kpi-icon" style="color:${color};"><i class="${icon}"></i></div>
    <div class="kpi-body">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════
   STAFF 대시보드
══════════════════════════════════════════════ */
async function renderStaffDashboard(session) {
  const wrap = document.getElementById('dash-content');
  if (!wrap) return;
  wrap.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;">로딩 중…</div>';

  const all = await _getCachedEntries();
  const mine = all.filter(e => e.user_id === session.userId);
  const thisMonth = thisMonthStr();
  const mineThis = mine.filter(e => entryMonth(e) === thisMonth);
  const totalMins = mineThis.reduce((s, e) => s + (e.duration_min || 0), 0);
  const cliMins = mineThis.filter(e => e.client_id && e.client_id !== 'internal').reduce((s, e) => s + (e.duration_min || 0), 0);
  const intMins = totalMins - cliMins;
  const cliPct = totalMins ? Math.round((cliMins / totalMins) * 100) : 0;
  const pendingCnt = mine.filter(e => (e.status || 'draft') === 'draft' || e.status === 'pending').length;
  const approvedCnt = mine.filter(e => e.status === 'approved').length;

  const masters = await Master.load();
  const cliNameMap = Object.fromEntries((masters.clients || []).map(c => [c.id, c.name]));

  const cliMap = {};
  mineThis.filter(e => e.client_id && e.client_id !== 'internal').forEach(e => {
    cliMap[e.client_id] = (cliMap[e.client_id] || 0) + (e.duration_min || 0);
  });

  wrap.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-size:13px;color:#64748b;margin-bottom:8px;"><i class="fa-regular fa-calendar"></i> ${thisMonth} 내 업무 현황</div>
      <div class="kpi-grid">
        ${kpiCard('fa-solid fa-clock', '이번 달 총 시간', Utils.minToHM(totalMins), `업무일 기준`, '#2d6bb5', '#eff6ff')}
        ${kpiCard('fa-solid fa-building', '고객사 업무', Utils.minToHM(cliMins), `전체의 ${cliPct}%`, '#0891b2', '#f0f9ff')}
        ${kpiCard('fa-solid fa-house', '내부 업무', Utils.minToHM(intMins), `전체의 ${100 - cliPct}%`, '#7c3aed', '#f5f3ff')}
        ${kpiCard('fa-solid fa-hourglass-half', '미결 항목', pendingCnt + '건', '결재 대기', '#d97706', '#fffbeb')}
        ${kpiCard('fa-solid fa-circle-check', '승인 완료', approvedCnt + '건', '전체 누계', '#16a34a', '#f0fdf4')}
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title"><i class="fa-solid fa-building" style="color:#2d6bb5;"></i> 이번 달 고객사별 시간</span></div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">${buildCliRows(cliMap, cliNameMap)}</table>
      </div>
    </div>`;
}
/* ══════════════════════════════════════════════
   MANAGER 대시보드
══════════════════════════════════════════════ */
async function renderManagerDashboard(session) {
  const wrap = document.getElementById('dash-content');
  if (!wrap) return;
  wrap.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;">로딩 중…</div>';

  const all = await _getCachedEntries();
  const thisMonth = thisMonthStr();

  /* 내 팀원 목록 */
  const usersR = await API.list('users', { limit: 200 });
  const allUsers = usersR?.data ?? [];
  const myTeamIds = allUsers.filter(u => u.approver_id === session.userId).map(u => u.id);
  const teamEntries = all.filter(e => myTeamIds.includes(e.user_id));
  const thisMonthEntries = teamEntries.filter(e => entryMonth(e) === thisMonth);

  const totalMins = thisMonthEntries.reduce((s, e) => s + (e.duration_min || 0), 0);
  const cliMins = thisMonthEntries.filter(e => e.client_id && e.client_id !== 'internal')
    .reduce((s, e) => s + (e.duration_min || 0), 0);
  const pendingCnt = teamEntries.filter(e => e.status === 'pending').length;
  const approvedCnt = teamEntries.filter(e => e.status === 'approved').length;

  const masters = await Master.load();
  const cliNameMap = Object.fromEntries((masters.clients || []).map(c => [c.id, c.name]));
  const userNameMap = Object.fromEntries(allUsers.map(u => [u.id, u.name]));

  /* 이번 달 고객사별 */
  const cliMap = {};
  thisMonthEntries.filter(e => e.client_id && e.client_id !== 'internal').forEach(e => {
    cliMap[e.client_id] = (cliMap[e.client_id] || 0) + (e.duration_min || 0);
  });

  /* 이번 달 팀원별 */
  const staffMap = {};
  thisMonthEntries.forEach(e => {
    staffMap[e.user_id] = (staffMap[e.user_id] || 0) + (e.duration_min || 0);
  });

  /* 지난 달 */
  const prevDate = new Date(); prevDate.setMonth(prevDate.getMonth() - 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const prevEntries = teamEntries.filter(e => entryMonth(e) === prevMonth);
  const prevCliMap = {};
  prevEntries.filter(e => e.client_id && e.client_id !== 'internal').forEach(e => {
    prevCliMap[e.client_id] = (prevCliMap[e.client_id] || 0) + (e.duration_min || 0);
  });

  const cliPct = totalMins ? Math.round((cliMins / totalMins) * 100) : 0;

  wrap.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-size:13px;color:#64748b;margin-bottom:8px;">
        <i class="fa-regular fa-calendar"></i> ${thisMonth} 팀 업무 현황 (팀원 ${myTeamIds.length}명)
      </div>
      <div class="kpi-grid">
        ${kpiCard('fa-solid fa-users', '팀원 수', myTeamIds.length + '명', '내 결재 대상', '#2d6bb5', '#eff6ff')}
        ${kpiCard('fa-solid fa-clock', '팀 총 시간', Utils.minToHM(totalMins), thisMonth, '#0891b2', '#f0f9ff')}
        ${kpiCard('fa-solid fa-building', '고객사 업무', Utils.minToHM(cliMins), `전체의 ${cliPct}%`, '#7c3aed', '#f5f3ff')}
        ${kpiCard('fa-solid fa-file-circle-check', '결재 대기', pendingCnt + '건', '승인 필요', '#d97706', '#fffbeb')}
        ${kpiCard('fa-solid fa-circle-check', '승인 완료', approvedCnt + '건', '전체 누계', '#16a34a', '#f0fdf4')}
      </div>
    </div>
    <div id="dash-bottom"></div>`;

  await renderBottomSection(
    document.getElementById('dash-bottom'),
    cliMap, cliNameMap, staffMap, userNameMap, prevCliMap, true
  );
}

/* ══════════════════════════════════════════════
   DIRECTOR / ADMIN 대시보드
══════════════════════════════════════════════ */
async function renderDirectorDashboard(session) {
  const wrap = document.getElementById('dash-content');
  if (!wrap) return;
  wrap.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;">로딩 중…</div>';

  const all = await _getCachedEntries();
  const thisMonth = thisMonthStr();
  const thisMonthEntries = all.filter(e => entryMonth(e) === thisMonth);

  const usersR = await API.list('users', { limit: 200 });
  const allUsers = usersR?.data ?? [];
  const activeStaff = allUsers.filter(u => u.role === 'staff' || u.role === 'manager');

  const totalMins = thisMonthEntries.reduce((s, e) => s + (e.duration_min || 0), 0);
  const cliMins = thisMonthEntries.filter(e => e.client_id && e.client_id !== 'internal')
    .reduce((s, e) => s + (e.duration_min || 0), 0);
  const pendingCnt = all.filter(e => e.status === 'pending').length;
  const pending2Cnt = all.filter(e => e.status === 'pending2').length;

  const masters = await Master.load();
  const cliNameMap = Object.fromEntries((masters.clients || []).map(c => [c.id, c.name]));
  const userNameMap = Object.fromEntries(allUsers.map(u => [u.id, u.name]));

  const cliMap = {};
  thisMonthEntries.filter(e => e.client_id && e.client_id !== 'internal').forEach(e => {
    cliMap[e.client_id] = (cliMap[e.client_id] || 0) + (e.duration_min || 0);
  });

  const staffMap = {};
  thisMonthEntries.forEach(e => {
    staffMap[e.user_id] = (staffMap[e.user_id] || 0) + (e.duration_min || 0);
  });

  /* 지난 달 비교 */
  const prevDate = new Date(); prevDate.setMonth(prevDate.getMonth() - 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const prevEntries = all.filter(e => entryMonth(e) === prevMonth);
  const prevMins = prevEntries.reduce((s, e) => s + (e.duration_min || 0), 0);
  const prevCliMap = {};
  prevEntries.filter(e => e.client_id && e.client_id !== 'internal').forEach(e => {
    prevCliMap[e.client_id] = (prevCliMap[e.client_id] || 0) + (e.duration_min || 0);
  });

  const cliPct = totalMins ? Math.round((cliMins / totalMins) * 100) : 0;
  const diffMins = totalMins - prevMins;
  const diffStr = diffMins >= 0
    ? `<span style="color:#16a34a;">▲ ${Utils.minToHM(diffMins)}</span>`
    : `<span style="color:#dc2626;">▼ ${Utils.minToHM(Math.abs(diffMins))}</span>`;

  wrap.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-size:13px;color:#64748b;margin-bottom:8px;">
        <i class="fa-regular fa-calendar"></i> ${thisMonth} 전사 현황
      </div>
      <div class="kpi-grid">
        ${kpiCard('fa-solid fa-building-user', '전체 직원', activeStaff.length + '명', '활성 계정', '#2d6bb5', '#eff6ff')}
        ${kpiCard('fa-solid fa-clock', '전사 총 시간', Utils.minToHM(totalMins), `전월 대비 ${diffStr}`, '#0891b2', '#f0f9ff')}
        ${kpiCard('fa-solid fa-building', '고객사 업무', Utils.minToHM(cliMins), `전체의 ${cliPct}%`, '#7c3aed', '#f5f3ff')}
        ${kpiCard('fa-solid fa-file-pen', '1차 결재 대기', pendingCnt + '건', '매니저 승인 필요', '#d97706', '#fffbeb')}
        ${kpiCard('fa-solid fa-file-circle-check', '2차 결재 대기', pending2Cnt + '건', '임원 승인 필요', '#dc2626', '#fef2f2')}
      </div>
    </div>
    <div id="dash-bottom"></div>`;

  await renderBottomSection(
    document.getElementById('dash-bottom'),
    cliMap, cliNameMap, staffMap, userNameMap, prevCliMap, true
  );
}

/* ── BtnLoading ── */
const BtnLoading = {
  start(btn, loadingText = '처리 중...') {
    if (!btn) return () => {};
    const orig = btn.innerHTML;
    const dis = btn.disabled;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${loadingText}`;
    return () => { btn.innerHTML = orig; btn.disabled = dis; };
  },
  startById(id, loadingText = '처리 중...') {
    return BtnLoading.start(document.getElementById(id), loadingText);
  },
  disableAll(...btns) {
    const originals = btns.map(b => b ? b.disabled : true);
    btns.forEach(b => { if (b) b.disabled = true; });
    return () => btns.forEach((b, i) => { if (b) b.disabled = originals[i]; });
  }
};
/* ══════════════════════════════════════════════
   월별 트렌드 차트 (6개월)
══════════════════════════════════════════════ */
async function renderMonthlyTrend(canvasId, entries, filterFn = null) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const data = months.map(m => {
    const filtered = entries.filter(e => entryMonth(e) === m && (!filterFn || filterFn(e)));
    return filtered.reduce((s, e) => s + (e.duration_min || 0), 0);
  });

  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth || 400;
  const H = canvas.height = 160;
  ctx.clearRect(0, 0, W, H);

  const padL = 50, padR = 20, padT = 16, padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const max = Math.max(...data, 1);
  const step = chartW / (months.length - 1);

  /* 격자 */
  ctx.strokeStyle = '#f1f5f9';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    const label = Utils.minToHM(Math.round(max * (1 - i / 4)));
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px Pretendard,sans-serif';
    ctx.textAlign = 'right'; ctx.fillText(label, padL - 4, y + 4);
  }

  /* 영역 채우기 */
  const points = data.map((v, i) => ({
    x: padL + i * step,
    y: padT + chartH - (v / max) * chartH
  }));

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, padT + chartH);
  ctx.lineTo(points[0].x, padT + chartH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
  grad.addColorStop(0, 'rgba(45,107,181,0.18)');
  grad.addColorStop(1, 'rgba(45,107,181,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  /* 라인 */
  ctx.beginPath();
  ctx.strokeStyle = '#2d6bb5';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();

  /* 점 */
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#2d6bb5';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
  });

  /* x축 레이블 */
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px Pretendard,sans-serif';
  ctx.textAlign = 'center';
  months.forEach((m, i) => {
    ctx.fillText(m.slice(5) + '월', padL + i * step, H - 6);
  });
}

/* ══════════════════════════════════════════════
   주간 요약 위젯
══════════════════════════════════════════════ */
function renderWeeklySummary(entries, userId = null) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const mondayStr = monday.toISOString().slice(0, 10);
  const sundayStr = sunday.toISOString().slice(0, 10);

  const weekEntries = entries.filter(e => {
    const d = e.work_date || '';
    return d >= mondayStr && d <= sundayStr && (!userId || e.user_id === userId);
  });

  const days = ['월', '화', '수', '목', '금', '토', '일'];
  const dayMins = Array(7).fill(0);
  weekEntries.forEach(e => {
    const d = new Date(e.work_date);
    const dow = d.getDay();
    const idx = dow === 0 ? 6 : dow - 1;
    dayMins[idx] += (e.duration_min || 0);
  });

  const total = dayMins.reduce((a, b) => a + b, 0);
  const max = Math.max(...dayMins, 1);
  const today = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const bars = days.map((d, i) => {
    const h = Math.round((dayMins[i] / max) * 48);
    const isToday = i === today;
    const color = isToday ? '#2d6bb5' : '#cbd5e1';
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;">
      <span style="font-size:10px;color:#94a3b8;">${dayMins[i] ? Utils.minToHM(dayMins[i]) : ''}</span>
      <div style="width:100%;max-width:28px;height:${h || 4}px;background:${color};border-radius:3px 3px 0 0;transition:height 0.3s;"></div>
      <span style="font-size:11px;color:${isToday ? '#2d6bb5' : '#94a3b8'};font-weight:${isToday ? 700 : 400};">${d}</span>
    </div>`;
  }).join('');

  return `<div class="card" style="margin-bottom:16px;">
    <div class="card-header">
      <span class="card-title"><i class="fa-solid fa-calendar-week" style="color:#2d6bb5;"></i> 이번 주 현황</span>
      <span style="font-size:12px;color:#64748b;">총 ${Utils.minToHM(total)}</span>
    </div>
    <div style="padding:12px 16px;">
      <div style="display:flex;align-items:flex-end;gap:4px;height:80px;">
        ${bars}
      </div>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════
   최근 항목 테이블
══════════════════════════════════════════════ */
function renderRecentEntries(entries, limit = 5) {
  const recent = [...entries]
    .sort((a, b) => (b.work_date || '').localeCompare(a.work_date || ''))
    .slice(0, limit);

  if (!recent.length) {
    return `<div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px;">최근 업무 내역이 없습니다.</div>`;
  }

  const rows = recent.map(e => `
    <tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:8px;font-size:12px;color:#64748b;">${e.work_date || '-'}</td>
      <td style="padding:8px;font-size:12px;color:#1e293b;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Utils.escHtml(e.title || '-')}</td>
      <td style="padding:8px;font-size:12px;color:#1e293b;text-align:center;">${Utils.minToHM(e.duration_min || 0)}</td>
      <td style="padding:8px;text-align:center;">${Utils.statusBadge(e.status || 'draft')}</td>
    </tr>`).join('');

  return `<div class="card" style="margin-top:16px;">
    <div class="card-header">
      <span class="card-title"><i class="fa-solid fa-list-check" style="color:#2d6bb5;"></i> 최근 업무 내역</span>
      <button class="btn btn-ghost" style="font-size:12px;" onclick="navigateTo('entry')">전체 보기 →</button>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">날짜</th>
            <th style="padding:8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">업무</th>
            <th style="padding:8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">시간</th>
            <th style="padding:8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">상태</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════
   외부 노출 (window)
══════════════════════════════════════════════ */
window.init_dashboard         = init_dashboard;
window.renderStaffDashboard   = renderStaffDashboard;
window.renderManagerDashboard = renderManagerDashboard;
window.renderDirectorDashboard= renderDirectorDashboard;
window.renderMonthlyTrend     = renderMonthlyTrend;
window.renderWeeklySummary    = renderWeeklySummary;
window.renderRecentEntries    = renderRecentEntries;
window.BtnLoading             = BtnLoading;
