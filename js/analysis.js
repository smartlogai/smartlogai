/* ============================================================
   analysis.js  –  업무 분석 / 리포트
   ============================================================ */
'use strict';

/* ── 상태 ── */
let _anSession = null;
let _anMasters = {};
let _anEntries = [];
let _anFilter  = {
  date_from: '', date_to: '',
  user_id: '', client_id: '', category_id: '',
  scope: 'all'   /* all | my | team */
};

/* ══════════════════════════════════════════════
   진입점
══════════════════════════════════════════════ */
async function init_analysis() {
  _anSession = Session.require();
  if (!_anSession) return;

  _anMasters = await Master.load();
  _setupAnFilterUI();
  _bindAnEvents();
  _setDefaultDateRange();
  await _loadAnData();
}

/* ══════════════════════════════════════════════
   기본 날짜 범위 (이번 달)
══════════════════════════════════════════════ */
function _setDefaultDateRange() {
  const now  = new Date();
  const y    = now.getFullYear();
  const m    = String(now.getMonth() + 1).padStart(2, '0');
  const from = `${y}-${m}-01`;
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  const to   = `${y}-${m}-${String(last).padStart(2, '0')}`;

  _anFilter.date_from = from;
  _anFilter.date_to   = to;

  const fromEl = document.getElementById('an-date-from');
  const toEl   = document.getElementById('an-date-to');
  if (fromEl) fromEl.value = from;
  if (toEl)   toEl.value   = to;
}

/* ══════════════════════════════════════════════
   필터 UI 셋업
══════════════════════════════════════════════ */
function _setupAnFilterUI() {
  /* 범위 탭 (역할별) */
  const role = _anSession.role;
  const scopeWrap = document.getElementById('an-scope-wrap');
  if (scopeWrap) {
    if (role === 'staff') {
      scopeWrap.style.display = 'none';
      _anFilter.scope = 'my';
    }
  }

  /* 직원 셀렉트 */
  const userSel = document.getElementById('an-filter-user');
  if (userSel && (Auth.isAdmin(_anSession) || Auth.isDirector(_anSession) || Auth.isManager(_anSession))) {
    userSel.innerHTML = '<option value="">전체 직원</option>';
    (_anMasters.users || [])
      .filter(u => u.role === 'staff' || u.role === 'manager')
      .forEach(u => {
        userSel.innerHTML += `<option value="${u.id}">${Utils.escHtml(u.name)}</option>`;
      });
    userSel.closest('.an-filter-item')?.style && (userSel.closest('.an-filter-item').style.display = '');
  }

  /* 고객사 셀렉트 */
  const cliSel = document.getElementById('an-filter-client');
  if (cliSel) {
    cliSel.innerHTML = '<option value="">전체 고객사</option>';
    (_anMasters.clients || []).forEach(c => {
      cliSel.innerHTML += `<option value="${c.id}">${Utils.escHtml(c.name)}</option>`;
    });
  }

  /* 카테고리 셀렉트 */
  const catSel = document.getElementById('an-filter-category');
  if (catSel) {
    catSel.innerHTML = '<option value="">전체 카테고리</option>';
    (_anMasters.categories || []).forEach(c => {
      catSel.innerHTML += `<option value="${c.id}">${Utils.escHtml(c.name)}</option>`;
    });
  }
}

/* ══════════════════════════════════════════════
   이벤트 바인딩
══════════════════════════════════════════════ */
function _bindAnEvents() {
  const bind = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      _anFilter[key] = el.value;
      _loadAnData();
    });
  };
  bind('an-date-from',     'date_from');
  bind('an-date-to',       'date_to');
  bind('an-filter-user',   'user_id');
  bind('an-filter-client', 'client_id');
  bind('an-filter-category','category_id');

  /* 범위 탭 */
  document.querySelectorAll('[data-an-scope]').forEach(btn => {
    btn.addEventListener('click', () => {
      _anFilter.scope = btn.dataset.anScope;
      document.querySelectorAll('[data-an-scope]').forEach(b =>
        b.classList.toggle('active', b.dataset.anScope === _anFilter.scope));
      _loadAnData();
    });
  });

  /* 빠른 기간 선택 */
  document.querySelectorAll('[data-an-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      _setQuickPeriod(btn.dataset.anPeriod);
      _loadAnData();
    });
  });
}

/* ── 빠른 기간 설정 ── */
function _setQuickPeriod(period) {
  const now = new Date();
  let from, to;

  if (period === 'this-month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (period === 'last-month') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to   = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (period === 'this-quarter') {
    const q = Math.floor(now.getMonth() / 3);
    from = new Date(now.getFullYear(), q * 3, 1);
    to   = new Date(now.getFullYear(), q * 3 + 3, 0);
  } else if (period === 'this-year') {
    from = new Date(now.getFullYear(), 0, 1);
    to   = new Date(now.getFullYear(), 11, 31);
  } else if (period === 'last-3-months') {
    from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }

  if (!from || !to) return;
  const fmt = d => d.toISOString().slice(0, 10);
  _anFilter.date_from = fmt(from);
  _anFilter.date_to   = fmt(to);

  const fromEl = document.getElementById('an-date-from');
  const toEl   = document.getElementById('an-date-to');
  if (fromEl) fromEl.value = _anFilter.date_from;
  if (toEl)   toEl.value   = _anFilter.date_to;
}

/* ══════════════════════════════════════════════
   데이터 로드
══════════════════════════════════════════════ */
async function _loadAnData() {
  _showAnLoading(true);

  try {
    const params = { limit: 2000, sort: 'work_date' };

    if (_anFilter.date_from)   params['filter[work_date][gte]'] = _anFilter.date_from;
    if (_anFilter.date_to)     params['filter[work_date][lte]'] = _anFilter.date_to;
    if (_anFilter.client_id)   params['filter[client_id]']      = _anFilter.client_id;
    if (_anFilter.category_id) params['filter[category_id]']    = _anFilter.category_id;

    /* 범위별 필터 */
    if (_anFilter.scope === 'my' || _anSession.role === 'staff') {
      params['filter[user_id]'] = _anSession.userId;
    } else if (_anFilter.user_id) {
      params['filter[user_id]'] = _anFilter.user_id;
    } else if (_anFilter.scope === 'team' && _anSession.role === 'manager') {
      /* 팀원 ID 목록 */
      const ur = await API.list('users', { limit: 200 });
      const teamIds = (ur?.data ?? [])
        .filter(u => u.approver_id === _anSession.userId)
        .map(u => u.id);
      if (teamIds.length) params['filter[user_id][in]'] = teamIds.join(',');
    }

    const r = await API.list('time_entries', params);
    _anEntries = r?.data ?? [];

    _renderAnSummary();
    _renderAnCharts();
    _renderAnTables();
  } catch (err) {
    console.error('[analysis] 로드 오류:', err);
    Toast.error('데이터 로드 실패');
  } finally {
    _showAnLoading(false);
  }
}

function _showAnLoading(show) {
  const el = document.getElementById('an-loading');
  if (el) el.style.display = show ? '' : 'none';
  const content = document.getElementById('an-content');
  if (content) content.style.opacity = show ? '0.5' : '1';
}

/* ══════════════════════════════════════════════
   요약 KPI
══════════════════════════════════════════════ */
function _renderAnSummary() {
  const entries  = _anEntries;
  const total    = entries.reduce((s, e) => s + (e.duration_min || 0), 0);
  const cliMins  = entries.filter(e => e.client_id && e.client_id !== 'internal')
                          .reduce((s, e) => s + (e.duration_min || 0), 0);
  const intMins  = total - cliMins;
  const cliPct   = total ? Math.round((cliMins / total) * 100) : 0;
  const approved = entries.filter(e => e.status === 'approved').length;
  const pending  = entries.filter(e => e.status === 'pending' || e.status === 'pending2').length;

  /* 고유 직원 수 */
  const uniqueUsers = new Set(entries.map(e => e.user_id)).size;
  /* 고유 고객사 수 */
  const uniqueClients = new Set(entries.filter(e => e.client_id && e.client_id !== 'internal').map(e => e.client_id)).size;
  /* 평균 소요 시간 */
  const avgMins = entries.length ? Math.round(total / entries.length) : 0;

  const kpiData = [
    { icon: 'fa-clock',        label: '총 업무 시간',    value: Utils.minToHM(total),       sub: `${entries.length}건`,         color: '#2d6bb5', bg: '#eff6ff' },
    { icon: 'fa-building',     label: '고객사 업무',     value: Utils.minToHM(cliMins),     sub: `전체의 ${cliPct}%`,           color: '#0891b2', bg: '#f0f9ff' },
    { icon: 'fa-house',        label: '내부 업무',       value: Utils.minToHM(intMins),     sub: `전체의 ${100 - cliPct}%`,     color: '#7c3aed', bg: '#f5f3ff' },
    { icon: 'fa-stopwatch',    label: '평균 소요 시간',  value: Utils.minToHM(avgMins),     sub: '건당 평균',                   color: '#d97706', bg: '#fffbeb' },
    { icon: 'fa-circle-check', label: '승인 완료',       value: `${approved}건`,            sub: `대기 ${pending}건`,           color: '#16a34a', bg: '#f0fdf4' },
    { icon: 'fa-users',        label: '참여 직원',       value: `${uniqueUsers}명`,         sub: `고객사 ${uniqueClients}곳`,   color: '#db2777', bg: '#fdf2f8' },
  ];

  const wrap = document.getElementById('an-kpi-wrap');
  if (wrap) {
    wrap.innerHTML = kpiData.map(k => `
      <div class="kpi-card" style="border-top:3px solid ${k.color};background:${k.bg};">
        <div class="kpi-icon" style="color:${k.color};"><i class="fa-solid ${k.icon}"></i></div>
        <div class="kpi-body">
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value">${k.value}</div>
          <div class="kpi-sub">${k.sub}</div>
        </div>
      </div>`).join('');
  }
}
/* ══════════════════════════════════════════════
   차트 렌더
══════════════════════════════════════════════ */
function _renderAnCharts() {
  const entries  = _anEntries;
  const cliMap   = Object.fromEntries((_anMasters.clients    || []).map(c => [c.id, c.name]));
  const catMap   = Object.fromEntries((_anMasters.categories || []).map(c => [c.id, c.name]));
  const userMap  = Object.fromEntries((_anMasters.users      || []).map(u => [u.id, u.name]));

  /* ── 고객사별 파이 차트 ── */
  _drawPieChart('an-chart-client', entries, e => {
    if (!e.client_id || e.client_id === 'internal') return '내부 업무';
    return cliMap[e.client_id] || e.client_id;
  }, [
    '#2d6bb5','#0891b2','#7c3aed','#16a34a','#d97706','#db2777',
    '#64748b','#0f172a','#059669','#dc2626'
  ]);

  /* ── 카테고리별 파이 차트 ── */
  _drawPieChart('an-chart-category', entries, e => {
    return catMap[e.category_id] || '미분류';
  }, [
    '#7c3aed','#2d6bb5','#0891b2','#16a34a','#d97706','#db2777',
    '#64748b','#dc2626','#059669','#0f172a'
  ]);

  /* ── 월별 트렌드 ── */
  _drawMonthlyTrend('an-chart-monthly', entries);

  /* ── 요일별 분포 ── */
  _drawWeekdayChart('an-chart-weekday', entries);

  /* ── 직원별 바 차트 (관리자/임원) ── */
  if (!Auth.isStaff(_anSession)) {
    _drawBarChart('an-chart-user', entries, e => userMap[e.user_id] || '-', '#7c3aed');
  }

  /* ── 시간대별 분포 ── */
  _drawHourChart('an-chart-hour', entries);
}

/* ── 파이/도넛 차트 ── */
function _drawPieChart(canvasId, entries, labelFn, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const map = {};
  entries.forEach(e => {
    const lbl = labelFn(e);
    map[lbl] = (map[lbl] || 0) + (e.duration_min || 0);
  });

  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const top5   = sorted.slice(0, 5);
  const rest   = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
  if (rest > 0) top5.push(['기타', rest]);

  const labels = top5.map(([l]) => l);
  const values = top5.map(([, v]) => v);
  const total  = values.reduce((a, b) => a + b, 0);

  const ctx = canvas.getContext('2d');
  const W   = canvas.width  = canvas.offsetWidth  || 200;
  const H   = canvas.height = canvas.offsetHeight || 200;
  ctx.clearRect(0, 0, W, H);

  if (!total) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px Pretendard,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('데이터 없음', W / 2, H / 2);
    return;
  }

  const cx = W / 2, cy = H / 2;
  const r  = Math.min(W, H) * 0.38;
  const ir = r * 0.58;
  let angle = -Math.PI / 2;

  values.forEach((v, i) => {
    const slice = (v / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    angle += slice;
  });

  /* 도넛 홀 */
  ctx.beginPath();
  ctx.arc(cx, cy, ir, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  /* 중앙 텍스트 */
  ctx.fillStyle = '#1e293b';
  ctx.font = `bold ${Math.round(W * 0.07)}px Pretendard,sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(Utils.minToHM(total), cx, cy);

  /* 범례 */
  const legendEl = document.getElementById(canvasId + '-legend');
  if (legendEl) {
    legendEl.innerHTML = labels.map((lbl, i) => {
      const pct = Math.round((values[i] / total) * 100);
      return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <div style="width:10px;height:10px;border-radius:2px;background:${colors[i % colors.length]};flex-shrink:0;"></div>
        <span style="font-size:11.5px;color:#334155;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Utils.escHtml(lbl)}</span>
        <span style="font-size:11px;color:#64748b;flex-shrink:0;">${pct}%</span>
      </div>`;
    }).join('');
  }
}

/* ── 월별 트렌드 라인 차트 ── */
function _drawMonthlyTrend(canvasId, entries) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  /* 최근 12개월 */
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const cliData = months.map(m =>
    entries.filter(e => (e.work_date||'').slice(0,7) === m && e.client_id && e.client_id !== 'internal')
           .reduce((s, e) => s + (e.duration_min || 0), 0)
  );
  const intData = months.map(m =>
    entries.filter(e => (e.work_date||'').slice(0,7) === m && (!e.client_id || e.client_id === 'internal'))
           .reduce((s, e) => s + (e.duration_min || 0), 0)
  );

  const ctx = canvas.getContext('2d');
  const W   = canvas.width  = canvas.offsetWidth || 500;
  const H   = canvas.height = 200;
  ctx.clearRect(0, 0, W, H);

  const padL = 55, padR = 20, padT = 20, padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxVal = Math.max(...cliData.map((v, i) => v + intData[i]), 1);
  const step   = chartW / (months.length - 1);

  /* 격자 */
  ctx.strokeStyle = '#f1f5f9';
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillStyle  = '#94a3b8';
    ctx.font       = '10px Pretendard,sans-serif';
    ctx.textAlign  = 'right';
    ctx.fillText(Utils.minToHM(Math.round(maxVal * (1 - i / 4))), padL - 4, y + 4);
  }

  /* X축 레이블 (격월) */
  ctx.fillStyle  = '#94a3b8';
  ctx.font       = '10px Pretendard,sans-serif';
  ctx.textAlign  = 'center';
  months.forEach((m, i) => {
    if (i % 2 === 0 || i === months.length - 1) {
      ctx.fillText(m.slice(5) + '월', padL + i * step, H - 6);
    }
  });

  /* 고객사 영역 */
  const drawArea = (data, color, alpha) => {
    const pts = data.map((v, i) => ({
      x: padL + i * step,
      y: padT + chartH - (v / maxVal) * chartH
    }));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length-1].x, padT + chartH);
    ctx.lineTo(pts[0].x, padT + chartH);
    ctx.closePath();
    ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2,'0');
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
  };

  drawArea(cliData, '#2d6bb5', 0.15);
  drawArea(intData.map((v,i) => v + cliData[i]), '#7c3aed', 0.08);
}

/* ── 요일별 차트 ── */
function _drawWeekdayChart(canvasId, entries) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const days    = ['월','화','수','목','금','토','일'];
  const dayMins = Array(7).fill(0);
  const dayCnt  = Array(7).fill(0);

  entries.forEach(e => {
    if (!e.work_date) return;
    const d   = new Date(e.work_date);
    const dow = d.getDay();
    const idx = dow === 0 ? 6 : dow - 1;
    dayMins[idx] += (e.duration_min || 0);
    dayCnt[idx]++;
  });

  const ctx  = canvas.getContext('2d');
  const W    = canvas.width  = canvas.offsetWidth || 300;
  const H    = canvas.height = 160;
  ctx.clearRect(0, 0, W, H);

  const padL = 10, padR = 10, padT = 16, padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barW   = Math.floor(chartW / 7) - 4;
  const maxVal = Math.max(...dayMins, 1);

  days.forEach((d, i) => {
    const x  = padL + i * (chartW / 7) + 2;
    const bh = Math.round((dayMins[i] / maxVal) * chartH);
    const y  = padT + chartH - bh;

    ctx.fillStyle = i < 5 ? '#2d6bb5' : '#dc2626';
    ctx.beginPath();
    ctx.roundRect(x, y, barW, bh || 2, [3, 3, 0, 0]);
    ctx.fill();

    if (dayMins[i]) {
      ctx.fillStyle  = '#334155';
      ctx.font       = '9px Pretendard,sans-serif';
      ctx.textAlign  = 'center';
      ctx.fillText(Utils.minToHM(dayMins[i]), x + barW/2, y - 3);
    }

    ctx.fillStyle  = i < 5 ? '#64748b' : '#dc2626';
    ctx.font       = '11px Pretendard,sans-serif';
    ctx.textAlign  = 'center';
    ctx.fillText(d, x + barW/2, H - 6);
  });
}

/* ── 직원별 수평 바 차트 ── */
function _drawBarChart(canvasId, entries, labelFn, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const map = {};
  entries.forEach(e => {
    const lbl = labelFn(e);
    map[lbl] = (map[lbl] || 0) + (e.duration_min || 0);
  });

  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!sorted.length) return;

  const labels = sorted.map(([l]) => l);
  const values = sorted.map(([, v]) => v);
  const max    = values[0] || 1;

  const barH = 22, padL = 90, padR = 60, padT = 10, rowH = 34;
  const W    = canvas.width  = canvas.offsetWidth || 350;
  const H    = canvas.height = padT + sorted.length * rowH + 10;
  const ctx  = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  labels.forEach((lbl, i) => {
    const y  = padT + i * rowH;
    const bw = Math.round((values[i] / max) * (W - padL - padR));

    ctx.fillStyle = color + Math.round((1 - i * 0.1) * 255).toString(16).padStart(2,'0');
    ctx.beginPath();
    ctx.roundRect(padL, y, Math.max(bw, 4), barH, 4);
    ctx.fill();

    ctx.fillStyle  = '#334155';
    ctx.font       = '11.5px Pretendard,sans-serif';
    ctx.textAlign  = 'right';
    ctx.fillText(lbl.length > 8 ? lbl.slice(0, 8) + '…' : lbl, padL - 6, y + 15);

    ctx.fillStyle  = '#64748b';
    ctx.font       = '11px Pretendard,sans-serif';
    ctx.textAlign  = 'left';
    ctx.fillText(Utils.minToHM(values[i]), padL + bw + 6, y + 15);
  });
}

/* ── 시간대별 차트 ── */
function _drawHourChart(canvasId, entries) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const hourCnt = Array(24).fill(0);
  entries.forEach(e => {
    if (!e.start_time) return;
    const h = parseInt((e.start_time || '00').split(':')[0], 10);
    if (h >= 0 && h < 24) hourCnt[h]++;
  });

  const workHours = hourCnt.slice(7, 21); /* 07~20시 */
  const labels    = Array.from({length: 14}, (_, i) => `${i + 7}시`);
  const max       = Math.max(...workHours, 1);

  const ctx  = canvas.getContext('2d');
  const W    = canvas.width  = canvas.offsetWidth || 400;
  const H    = canvas.height = 120;
  ctx.clearRect(0, 0, W, H);

  const padL = 10, padR = 10, padT = 10, padB = 24;
  const chartW = W - padL - padR;
  const barW   = Math.floor(chartW / 14) - 2;

  workHours.forEach((cnt, i) => {
    const x  = padL + i * (chartW / 14) + 1;
    const bh = Math.round((cnt / max) * (H - padT - padB));
    const y  = padT + (H - padT - padB) - bh;

    const alpha = 0.4 + (cnt / max) * 0.6;
    ctx.fillStyle = `rgba(45,107,181,${alpha})`;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, bh || 2, [2, 2, 0, 0]);
    ctx.fill();

    ctx.fillStyle  = '#94a3b8';
    ctx.font       = '9px Pretendard,sans-serif';
    ctx.textAlign  = 'center';
    if (i % 2 === 0) ctx.fillText(labels[i], x + barW/2, H - 4);
  });
}
/* ══════════════════════════════════════════════
   테이블 렌더
══════════════════════════════════════════════ */
function _renderAnTables() {
  const entries  = _anEntries;
  const cliMap   = Object.fromEntries((_anMasters.clients    || []).map(c => [c.id, c.name]));
  const catMap   = Object.fromEntries((_anMasters.categories || []).map(c => [c.id, c.name]));
  const caseMap  = Object.fromEntries((_anMasters.cases      || []).map(c => [c.id, c.name]));
  const userMap  = Object.fromEntries((_anMasters.users      || []).map(u => [u.id, u.name]));

  /* ── 고객사별 집계 ── */
  _renderAggTable('an-table-client', entries, e => {
    if (!e.client_id || e.client_id === 'internal') return { id: 'internal', name: '내부 업무' };
    return { id: e.client_id, name: cliMap[e.client_id] || e.client_id };
  }, '#2d6bb5');

  /* ── 카테고리별 집계 ── */
  _renderAggTable('an-table-category', entries, e => ({
    id: e.category_id || 'none',
    name: catMap[e.category_id] || '미분류'
  }), '#0891b2');

  /* ── 직원별 집계 (관리자+) ── */
  if (!Auth.isStaff(_anSession)) {
    _renderAggTable('an-table-user', entries, e => ({
      id: e.user_id,
      name: userMap[e.user_id] || '-'
    }), '#7c3aed');
  }

  /* ── 사건/사업별 집계 ── */
  _renderAggTable('an-table-case', entries.filter(e => e.case_id), e => ({
    id: e.case_id,
    name: caseMap[e.case_id] || e.case_id
  }), '#16a34a');

  /* ── 상세 내역 테이블 ── */
  _renderDetailTable(entries, cliMap, catMap, userMap);
}

/* ── 집계 테이블 공통 렌더 ── */
function _renderAggTable(tableId, entries, keyFn, color) {
  const wrap = document.getElementById(tableId);
  if (!wrap) return;

  const total = entries.reduce((s, e) => s + (e.duration_min || 0), 0);
  const map   = {};
  const cntMap = {};

  entries.forEach(e => {
    const { id, name } = keyFn(e);
    if (!map[id]) { map[id] = 0; cntMap[id] = { name, count: 0 }; }
    map[id] += (e.duration_min || 0);
    cntMap[id].count++;
  });

  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) {
    wrap.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px;">데이터 없음</div>';
    return;
  }

  const rows = sorted.map(([id, mins], idx) => {
    const { name, count } = cntMap[id];
    const pct = total ? Math.round((mins / total) * 100) : 0;
    const bar = Math.min(pct, 100);
    return `<tr style="border-bottom:1px solid #f8fafc;">
      <td style="padding:8px;font-size:12px;color:#64748b;text-align:center;">${idx + 1}</td>
      <td style="padding:8px;font-size:12.5px;color:#1e293b;font-weight:500;">${Utils.escHtml(name)}</td>
      <td style="padding:8px;font-size:12px;text-align:center;color:#64748b;">${count}건</td>
      <td style="padding:8px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="flex:1;background:#f1f5f9;border-radius:4px;height:8px;overflow:hidden;">
            <div style="width:${bar}%;height:100%;background:${color};border-radius:4px;transition:width 0.4s;"></div>
          </div>
          <span style="font-size:11px;color:#64748b;width:28px;text-align:right;">${pct}%</span>
        </div>
      </td>
      <td style="padding:8px;font-size:12.5px;font-weight:700;color:#1e293b;text-align:right;">${Utils.minToHM(mins)}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
          <th style="padding:8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;width:36px;">#</th>
          <th style="padding:8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">항목</th>
          <th style="padding:8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">건수</th>
          <th style="padding:8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">비율</th>
          <th style="padding:8px;font-size:11px;color:#64748b;text-align:right;font-weight:600;">시간</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="background:#f8fafc;border-top:2px solid #e2e8f0;">
          <td colspan="2" style="padding:8px;font-size:12px;font-weight:700;color:#334155;">합계</td>
          <td style="padding:8px;font-size:12px;text-align:center;font-weight:700;color:#334155;">${entries.length}건</td>
          <td></td>
          <td style="padding:8px;font-size:12.5px;font-weight:700;color:#2d6bb5;text-align:right;">${Utils.minToHM(total)}</td>
        </tr>
      </tfoot>
    </table>`;
}

/* ── 상세 내역 테이블 ── */
function _renderDetailTable(entries, cliMap, catMap, userMap) {
  const wrap = document.getElementById('an-table-detail');
  if (!wrap) return;

  const sorted = [...entries].sort((a, b) => (b.work_date||'').localeCompare(a.work_date||''));

  if (!sorted.length) {
    wrap.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px;">데이터 없음</div>';
    return;
  }

  const rows = sorted.map(e => {
    const cliName  = e.client_id === 'internal' ? '내부' : (cliMap[e.client_id] || '-');
    const catName  = catMap[e.category_id] || '-';
    const userName = userMap[e.user_id] || '-';
    return `<tr style="border-bottom:1px solid #f8fafc;">
      <td style="padding:7px 8px;font-size:12px;color:#64748b;white-space:nowrap;">${e.work_date || '-'}</td>
      <td style="padding:7px 8px;font-size:12px;color:#334155;">${Utils.escHtml(userName)}</td>
      <td style="padding:7px 8px;font-size:12.5px;color:#1e293b;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
          title="${Utils.escHtml(e.title||'')}">
        ${Utils.escHtml((e.title||'-').slice(0,35))}${(e.title||'').length>35?'…':''}
      </td>
      <td style="padding:7px 8px;font-size:12px;color:#64748b;">${Utils.escHtml(cliName)}</td>
      <td style="padding:7px 8px;font-size:12px;color:#64748b;">${Utils.escHtml(catName)}</td>
      <td style="padding:7px 8px;font-size:12px;text-align:center;font-weight:600;">${Utils.minToHM(e.duration_min||0)}</td>
      <td style="padding:7px 8px;text-align:center;">${Utils.statusBadge(e.status||'draft')}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;position:sticky;top:0;">
          <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">날짜</th>
          <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">작성자</th>
          <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">업무 제목</th>
          <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">고객사</th>
          <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">카테고리</th>
          <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">시간</th>
          <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">상태</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ══════════════════════════════════════════════
   탭 전환
══════════════════════════════════════════════ */
function switchAnTab(tab) {
  document.querySelectorAll('.an-tab-content').forEach(el => {
    el.style.display = el.dataset.anTab === tab ? '' : 'none';
  });
  document.querySelectorAll('[data-an-tab-btn]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.anTabBtn === tab);
  });

  /* 캔버스 재렌더 (탭 전환 후 너비가 변할 수 있음) */
  setTimeout(() => _renderAnCharts(), 50);
}
window.switchAnTab = switchAnTab;

/* ══════════════════════════════════════════════
   Excel 내보내기
══════════════════════════════════════════════ */
async function exportAnalysisExcel() {
  const btn = document.getElementById('an-export-btn');
  const restore = BtnLoading.start(btn, '내보내는 중…');

  try {
    const entries  = _anEntries;
    const cliMap   = Object.fromEntries((_anMasters.clients    || []).map(c => [c.id, c.name]));
    const catMap   = Object.fromEntries((_anMasters.categories || []).map(c => [c.id, c.name]));
    const caseMap  = Object.fromEntries((_anMasters.cases      || []).map(c => [c.id, c.name]));
    const userMap  = Object.fromEntries((_anMasters.users      || []).map(u => [u.id, u.name]));

    const STATUS_LABEL = {
      draft: '임시저장', pending: '1차 대기', pending2: '2차 대기',
      approved: '승인완료', rejected: '반려'
    };

    const data = [
      ['날짜','작성자','제목','고객사','카테고리','사건/사업','소요(분)','소요(H:MM)','청구여부','상태']
    ];

    [...entries]
      .sort((a, b) => (a.work_date||'').localeCompare(b.work_date||''))
      .forEach(e => {
        data.push([
          e.work_date || '',
          userMap[e.user_id] || '',
          e.title || '',
          e.client_id === 'internal' ? '내부 업무' : (cliMap[e.client_id] || ''),
          catMap[e.category_id] || '',
          e.case_id ? (caseMap[e.case_id] || '') : '',
          e.duration_min || 0,
          Utils.minToHM(e.duration_min || 0),
          e.is_billable !== false ? '청구' : '비청구',
          STATUS_LABEL[e.status] || e.status || '',
        ]);
      });

    /* 고객사별 시트 */
    const total = entries.reduce((s, e) => s + (e.duration_min || 0), 0);
    const cliAgg = {};
    entries.forEach(e => {
      const name = e.client_id === 'internal' ? '내부 업무' : (cliMap[e.client_id] || e.client_id);
      cliAgg[name] = (cliAgg[name] || 0) + (e.duration_min || 0);
    });
    const cliData = [['고객사', '소요(분)', '소요(H:MM)', '비율(%)']];
    Object.entries(cliAgg).sort((a,b)=>b[1]-a[1]).forEach(([name, mins]) => {
      cliData.push([name, mins, Utils.minToHM(mins), total ? Math.round((mins/total)*100) : 0]);
    });

    const fname = `업무분석_${_anFilter.date_from || 'all'}_${_anFilter.date_to || 'all'}.xlsx`;
    await Utils.xlsxDownload(data, fname, '상세내역');
    Toast.success(`${entries.length}건 내보내기 완료`);
  } catch (err) {
    console.error('[analysis] 내보내기 오류:', err);
    Toast.error('내보내기 실패');
  } finally {
    restore();
  }
}
window.exportAnalysisExcel = exportAnalysisExcel;
/* ══════════════════════════════════════════════
   비교 분석 (전월 대비)
══════════════════════════════════════════════ */
async function renderAnComparison() {
  const wrap = document.getElementById('an-comparison-wrap');
  if (!wrap) return;

  wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i></div>';

  try {
    const now   = new Date();
    const thisM = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const prevD = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const prevM = `${prevD.getFullYear()}-${String(prevD.getMonth()+1).padStart(2,'0')}`;

    const params = { limit: 2000 };
    if (_anSession.role === 'staff') params['filter[user_id]'] = _anSession.userId;

    const r = await API.list('time_entries', params);
    const all = r?.data ?? [];

    const thisEntries = all.filter(e => (e.work_date||'').slice(0,7) === thisM);
    const prevEntries = all.filter(e => (e.work_date||'').slice(0,7) === prevM);

    const thisMins = thisEntries.reduce((s,e)=>s+(e.duration_min||0),0);
    const prevMins = prevEntries.reduce((s,e)=>s+(e.duration_min||0),0);
    const diffMins = thisMins - prevMins;
    const diffPct  = prevMins ? Math.round((diffMins/prevMins)*100) : 0;

    const thisCliMins = thisEntries.filter(e=>e.client_id&&e.client_id!=='internal').reduce((s,e)=>s+(e.duration_min||0),0);
    const prevCliMins = prevEntries.filter(e=>e.client_id&&e.client_id!=='internal').reduce((s,e)=>s+(e.duration_min||0),0);

    const cliMap  = Object.fromEntries((_anMasters.clients||[]).map(c=>[c.id,c.name]));

    /* 고객사별 비교 */
    const thisCli = {}, prevCli = {};
    thisEntries.filter(e=>e.client_id&&e.client_id!=='internal').forEach(e=>{
      thisCli[e.client_id] = (thisCli[e.client_id]||0)+(e.duration_min||0);
    });
    prevEntries.filter(e=>e.client_id&&e.client_id!=='internal').forEach(e=>{
      prevCli[e.client_id] = (prevCli[e.client_id]||0)+(e.duration_min||0);
    });

    const allCliIds = [...new Set([...Object.keys(thisCli),...Object.keys(prevCli)])];
    const cliRows = allCliIds
      .sort((a,b)=>(thisCli[b]||0)-(thisCli[a]||0))
      .slice(0,8)
      .map(id => {
        const name = cliMap[id] || id;
        const t = thisCli[id] || 0;
        const p = prevCli[id] || 0;
        const d = t - p;
        const col = d >= 0 ? '#16a34a' : '#dc2626';
        const arrow = d >= 0 ? '▲' : '▼';
        return `<tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:7px 8px;font-size:12px;color:#334155;">${Utils.escHtml(name)}</td>
          <td style="padding:7px 8px;font-size:12px;text-align:center;">${Utils.minToHM(p)}</td>
          <td style="padding:7px 8px;font-size:12px;text-align:center;font-weight:600;">${Utils.minToHM(t)}</td>
          <td style="padding:7px 8px;font-size:12px;text-align:center;color:${col};font-weight:600;">
            ${d !== 0 ? `${arrow} ${Utils.minToHM(Math.abs(d))}` : '-'}
          </td>
        </tr>`;
      }).join('');

    const diffColor = diffMins >= 0 ? '#16a34a' : '#dc2626';
    const diffArrow = diffMins >= 0 ? '▲' : '▼';

    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">
        <div class="kpi-card" style="border-top:3px solid #64748b;">
          <div class="kpi-body">
            <div class="kpi-label">전월 (${prevM})</div>
            <div class="kpi-value">${Utils.minToHM(prevMins)}</div>
            <div class="kpi-sub">고객사 ${Utils.minToHM(prevCliMins)}</div>
          </div>
        </div>
        <div class="kpi-card" style="border-top:3px solid #2d6bb5;">
          <div class="kpi-body">
            <div class="kpi-label">이번 달 (${thisM})</div>
            <div class="kpi-value">${Utils.minToHM(thisMins)}</div>
            <div class="kpi-sub">고객사 ${Utils.minToHM(thisCliMins)}</div>
          </div>
        </div>
        <div class="kpi-card" style="border-top:3px solid ${diffColor};">
          <div class="kpi-body">
            <div class="kpi-label">전월 대비</div>
            <div class="kpi-value" style="color:${diffColor};">
              ${diffMins !== 0 ? `${diffArrow} ${Utils.minToHM(Math.abs(diffMins))}` : '변동 없음'}
            </div>
            <div class="kpi-sub">${diffPct > 0 ? '+' : ''}${diffPct}%</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">고객사별 전월 비교</span></div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;">고객사</th>
                <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">전월</th>
                <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">이번 달</th>
                <th style="padding:7px 8px;font-size:11px;color:#64748b;text-align:center;font-weight:600;">변동</th>
              </tr>
            </thead>
            <tbody>${cliRows || '<tr><td colspan="4" style="padding:16px;text-align:center;color:#94a3b8;">데이터 없음</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  } catch (err) {
    wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#dc2626;">비교 데이터 로드 실패</div>';
  }
}
window.renderAnComparison = renderAnComparison;

/* ══════════════════════════════════════════════
   리포트 인쇄
══════════════════════════════════════════════ */
function printAnalysisReport() {
  window.print();
}
window.printAnalysisReport = printAnalysisReport;

/* ══════════════════════════════════════════════
   창 리사이즈 시 차트 재렌더
══════════════════════════════════════════════ */
window.addEventListener('resize', Utils.debounce(() => {
  if (_anEntries.length) _renderAnCharts();
}, 300));

/* ══════════════════════════════════════════════
   외부 노출
══════════════════════════════════════════════ */
window.init_analysis        = init_analysis;
window.switchAnTab          = switchAnTab;
window.exportAnalysisExcel  = exportAnalysisExcel;
window.renderAnComparison   = renderAnComparison;
window.printAnalysisReport  = printAnalysisReport;
