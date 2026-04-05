/* ============================================
   dashboard.js — 역할별 대시보드
   ============================================ */

let _dashCharts = {};

async function _getCachedEntries() {
  return Cache.get('dash_time_entries', async () => {
    const res = await API.list('time_entries', { limit: 1000 });
    const data = (res && res.data) ? res.data : [];
    const total = (res && res.total) || data.length;
    if (total > data.length && data.length >= 1000) {
      try {
        const res2 = await API.list('time_entries', { limit: 1000, page: 2 });
        if (res2 && res2.data && res2.data.length > 0) data.push(...res2.data);
      } catch(e) { console.warn('[Dashboard] 2페이지 로드 실패:', e); }
    }
    return data;
  }, 60000);
}

async function init_dashboard() {
  const session = getSession();
  if (!session) return;
  if (window._dashNeedsRefresh !== false) {
    Cache.invalidate('dash_time_entries');
    Cache.invalidate('dash_archive_stars');
  }
  window._dashNeedsRefresh = false;
  if (Auth.isStaff(session) && !Auth.hasApprover(session)) { navigateTo('archive'); return; }
  if (session.role === 'staff') await renderStaffDashboard(session);
  else if (session.role === 'manager') await renderManagerDashboard(session);
  else await renderDirectorDashboard(session);
}

function collapseToTopN(dataMap, topN = 5) {
  const sorted = Object.entries(dataMap).sort((a, b) => b[1] - a[1]);
  if (sorted.length <= topN) return dataMap;
  const result = {};
  sorted.slice(0, topN).forEach(([k, v]) => { result[k] = v; });
  const etcSum = sorted.slice(topN).reduce((s, [, v]) => s + v, 0);
  if (etcSum > 0) result['기타'] = etcSum;
  return result;
}

function renderBarChart(canvasId, dataMap) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (_dashCharts[canvasId]) { _dashCharts[canvasId].destroy(); delete _dashCharts[canvasId]; }
  const wrapper = canvas.parentElement;
  if (!wrapper) return;
  canvas.style.display = 'none';
  const existing = wrapper.querySelector('.custom-bar-chart');
  if (existing) existing.remove();
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
  const baseColor = '45,107,181';
  const rows = sorted.map(([key, min], i) => {
    const pct    = totalMin > 0 ? Math.round(min / totalMin * 100) : 0;
    const barW   = maxMin   > 0 ? (min / maxMin * 100).toFixed(1) : 0;
    const hours  = (min / 60).toFixed(1);
    const isEtc  = key === '기타';
    const opacity = isEtc ? 0.3 : Math.max(0.45, 1 - i * (0.55 / Math.max(sorted.length - 1, 1)));
    const barClr  = isEtc ? 'rgba(148,163,184,0.5)' : `rgba(${baseColor},${opacity.toFixed(2)})`;
    const txtClr  = isEtc ? '#94a3b8' : `rgba(${baseColor},${Math.min(1, opacity + 0.2).toFixed(2)})`;
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f4f6f9;" title="${key}">
        <div style="min-width:80px;max-width:120px;font-size:11px;color:#5a6878;font-weight:500;white-space:normal;word-break:keep-all;flex-shrink:0;line-height:1.35;">${key}</div>
        <div style="flex:1;height:6px;background:#f0f4f8;border-radius:99px;overflow:hidden;min-width:0;">
          <div class="bar-fill" style="width:0%;height:100%;background:${barClr};border-radius:99px;transition:width 0.8s cubic-bezier(.4,0,.2,1);" data-target="${barW}"></div>
        </div>
        <div style="flex-shrink:0;min-width:30px;text-align:right;font-size:12px;font-weight:700;color:#1a2b45;">${hours}<span style="font-size:9px;font-weight:500;color:#9aa4b2;margin-left:1px">h</span></div>
        <div style="flex-shrink:0;width:28px;text-align:right;font-size:10.5px;font-weight:600;color:${txtClr};">${pct}%</div>
      </div>`;
  }).join('');
  const div = document.createElement('div');
  div.className = 'custom-bar-chart';
  div.style.cssText = 'height:100%;display:flex;flex-direction:column;justify-content:space-evenly;padding:4px 2px 2px;';
  div.innerHTML = rows;
  wrapper.appendChild(div);
  requestAnimationFrame(() => { div.querySelectorAll('.bar-fill').forEach(el => { el.style.width = el.dataset.target + '%'; }); });
}

function renderDonutChart(canvasId, dataMap) { renderBarChart(canvasId, dataMap); }

function buildCliRows(entries, cliEntries, totalCliMin) {
  if (!entries.length) return `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px">데이터 없음</div>`;
  const maxMin = cliEntries[0][1];
  return entries.map(([name, min]) => {
    const globalIdx = cliEntries.findIndex(([n]) => n === name);
    const opacity = Math.max(0.35, 1 - globalIdx * (0.55 / Math.max(cliEntries.length - 1, 1)));
    const barClr  = `rgba(45,107,181,${opacity.toFixed(2)})`;
    const txtClr  = `rgba(45,107,181,${Math.min(1, opacity + 0.2).toFixed(2)})`;
    const hours   = (min / 60).toFixed(1);
    const pct     = totalCliMin > 0 ? Math.round(min / totalCliMin * 100) : 0;
    const barW    = maxMin > 0 ? (min / maxMin * 100).toFixed(1) : 0;
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f4f6f9;" title="${name}">
        <div style="min-width:90px;max-width:150px;font-size:11px;color:#5a6878;font-weight:500;white-space:normal;word-break:keep-all;flex-shrink:0;line-height:1.35;">${name}</div>
        <div style="flex:1;height:6px;background:#f0f4f8;border-radius:99px;overflow:hidden;min-width:0;">
          <div class="bar-fill" style="width:0%;height:100%;background:${barClr};border-radius:99px;transition:width 0.8s cubic-bezier(.4,0,.2,1);" data-target="${barW}"></div>
        </div>
        <div style="flex-shrink:0;min-width:32px;text-align:right;font-size:12px;font-weight:700;color:#1a2b45;">${hours}<span style="font-size:9px;font-weight:500;color:#9aa4b2;margin-left:1px">h</span></div>
        <div style="flex-shrink:0;width:28px;text-align:right;font-size:10.5px;font-weight:600;color:${txtClr};">${pct}%</div>
      </div>`;
  }).join('');
}

function buildStaffStatRows(staffList, approvedEntries, allEntries, maxRefStaff, archiveItems = []) {
  const now = new Date(), today = now.getDate(), curY = now.getFullYear(), curM = now.getMonth();
  const prevY = curM === 0 ? curY - 1 : curY, prevM = curM === 0 ? 11 : curM - 1;
  const rows = staffList.map(u => {
    const uid = String(u.id);
    const curMin = approvedEntries.filter(e => String(e.user_id) === uid).reduce((s,e)=>s+(e.duration_minutes||0),0);
    const prevMin = allEntries.filter(e => {
      if (String(e.user_id) !== uid || e.status !== 'approved' || !e.work_start_at) return false;
      const d = new Date(isNaN(e.work_start_at) ? e.work_start_at : Number(e.work_start_at));
      if (isNaN(d.getTime())) return false;
      return d.getFullYear() === prevY && d.getMonth() === prevM && d.getDate() <= today;
    }).reduce((s,e)=>s+(e.duration_minutes||0),0);
    const userArchives = archiveItems.filter(a=>String(a.user_id)===uid&&parseInt(a.quality_stars)>0);
    const avgStars = userArchives.length > 0 ? userArchives.reduce((s,a)=>s+(parseInt(a.quality_stars)||0),0)/userArchives.length : null;
    return { u, curMin, prevMin, avgStars, archiveCount: userArchives.length };
  });
  let maxMin;
  if (maxRefStaff) {
    maxMin = approvedEntries.filter(e=>e.user_id===maxRefStaff.id).reduce((s,e)=>s+(e.duration_minutes||0),0);
  } else {
    maxMin = Math.max(...rows.map(r=>r.curMin), 0);
  }
  rows.sort((a,b) => { const ra=maxMin>0?a.curMin/maxMin:0,rb=maxMin>0?b.curMin/maxMin:0; return rb-ra; });
  if (!rows.length) return `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px;"><i class="fas fa-users" style="font-size:20px;opacity:0.3;display:block;margin-bottom:6px"></i>직원 데이터가 없습니다.</div>`;
  return rows.map(({ u, curMin, prevMin, avgStars, archiveCount }) => {
    const hours = (curMin/60).toFixed(1), ratio = maxMin>0?Math.round(curMin/maxMin*100):0;
    const rankIdx = rows.findIndex(r=>r.u.id===u.id);
    const opacity = Math.max(0.35, 1-rankIdx*(0.55/Math.max(rows.length-1,1)));
    const barClr = ratio===100 ? 'rgba(45,107,181,1.0)' : `rgba(45,107,181,${opacity.toFixed(2)})`;
    let changeHtml = `<span style="font-size:11px;color:#9aa4b2;">—</span>`;
    if (prevMin > 0) {
      const chg=Math.round((curMin-prevMin)/prevMin*100), sign=chg>0?'▲':chg<0?'▼':'—';
      changeHtml = `<span style="font-size:11px;color:#9aa4b2;font-weight:500;">${chg!==0?`${sign} ${Math.abs(chg)}%`:'—'}</span>`;
    } else if (curMin > 0) {
      changeHtml = `<span style="font-size:11px;color:#9aa4b2;font-weight:500;">신규</span>`;
    }
    let starHtml = `<span style="font-size:10px;color:#d1d5db;">—</span>`;
    if (avgStars !== null) {
      const fullStars=Math.round(avgStars), starColors={1:'#9ca3af',2:'#3b82f6',3:'#f59e0b'}, clr=starColors[fullStars]||'#9ca3af';
      starHtml = `<span style="font-size:11px;color:${clr};letter-spacing:0.5px;" title="평균 ${avgStars.toFixed(1)}점 (${archiveCount}건)">${'★'.repeat(fullStars)}${'☆'.repeat(3-fullStars)}</span>`;
    }
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f4f6f9;">
        <div style="display:flex;align-items:center;gap:6px;min-width:76px;max-width:100px;flex-shrink:0;">
          <div style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#2d6bb5,#4a90d9);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${getInitial(u.name)}</div>
          <span style="font-size:11px;color:#5a6878;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${u.name}</span>
        </div>
        <div style="flex-shrink:0;width:36px;text-align:right;font-size:12px;font-weight:700;color:#1a2b45;">${hours}<span style="font-size:9px;font-weight:500;color:#9aa4b2;margin-left:1px">h</span></div>
        <div style="flex-shrink:0;width:48px;text-align:center;">${changeHtml}</div>
        <div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0;">
          <div style="flex:1;height:6px;background:#f0f4f8;border-radius:99px;overflow:hidden;min-width:0;">
            <div class="bar-fill" style="width:0%;height:100%;background:${barClr};border-radius:99px;transition:width 0.8s cubic-bezier(.4,0,.2,1);" data-target="${ratio}"></div>
          </div>
          <div style="flex-shrink:0;width:30px;text-align:right;font-size:10.5px;font-weight:600;color:rgba(45,107,181,${Math.min(1,opacity+0.2).toFixed(2)});">${ratio}%</div>
        </div>
        <div style="flex-shrink:0;width:44px;text-align:center;">${starHtml}</div>
      </div>`;
  }).join('');
}

async function renderBottomSection(container, { cliMap, allEntries, approvedEntries, staffList, maxRefStaff, month, mode }) {
  const cliAll = Object.entries(cliMap).sort((a,b)=>b[1]-a[1]);
  const top15 = cliAll.slice(0,15), etcMin = cliAll.slice(15).reduce((s,[,v])=>s+v,0);
  const cliEntries = etcMin > 0 ? [...top15,['기타',etcMin]] : top15;
  const totalCliMin = cliEntries.reduce((s,[,v])=>s+v,0);
  const staffHTML = buildStaffStatRows(staffList, approvedEntries, allEntries, maxRefStaff, []);
  const cliHTML = buildCliRows(cliEntries, cliEntries, totalCliMin);
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:10px;">
      <div class="card">
        <div class="card-header" style="padding:12px 16px 10px">
          <h2><i class="fas fa-building" style="color:var(--primary)"></i> &nbsp;고객사별 투입시간</h2>
          <span style="font-size:11px;font-weight:400;color:var(--text-muted)">상위 15+기타 · 승인 완료 기준</span>
        </div>
        <div class="card-body" style="padding:10px 14px;max-height:460px;overflow-y:auto;"><div id="cli-rows-inner">${cliHTML}</div></div>
      </div>
      <div class="card">
        <div class="card-header" style="padding:12px 16px 10px">
          <h2><i class="fas fa-user-clock" style="color:var(--primary)"></i> &nbsp;직원별 투입시간</h2>
          <span style="font-size:11px;font-weight:400;color:var(--text-muted)">${month} · 승인 완료 · 최다대비 내림차순</span>
        </div>
        <div style="display:flex;align-items:center;padding:4px 14px 2px;border-bottom:1px solid #f4f6f9;background:#fafbfc;">
          <div style="min-width:76px;max-width:100px;font-size:10px;color:#9aa4b2;font-weight:600;flex-shrink:0;">이름</div>
          <div style="flex-shrink:0;width:36px;text-align:right;font-size:10px;color:#9aa4b2;font-weight:600;">시간</div>
          <div style="flex-shrink:0;width:48px;text-align:center;font-size:10px;color:#9aa4b2;font-weight:600;">전월대비</div>
          <div style="flex:1;text-align:right;font-size:10px;color:#9aa4b2;font-weight:600;padding-right:30px;">최다대비</div>
          <div style="flex-shrink:0;width:44px;text-align:center;font-size:10px;color:#9aa4b2;font-weight:600;">별점</div>
        </div>
        <div class="card-body" style="padding:6px 14px;max-height:426px;overflow-y:auto;" id="staff-stat-body">${staffHTML}</div>
      </div>
    </div>`;
  requestAnimationFrame(() => { container.querySelectorAll('.bar-fill').forEach(el => { el.style.width = el.dataset.target + '%'; }); });
  Cache.get('dash_archive_stars', async () => {
    const archRes = await API.list('archive_items', { limit: 1000 });
    return (archRes && archRes.data) ? archRes.data : [];
  }, 300000).then(archiveItems => {
    const statsBody = container.querySelector('#staff-stat-body');
    if (!statsBody || !archiveItems.length) return;
    statsBody.innerHTML = buildStaffStatRows(staffList, approvedEntries, allEntries, maxRefStaff, archiveItems);
    requestAnimationFrame(() => { statsBody.querySelectorAll('.bar-fill').forEach(el => { el.style.width = el.dataset.target + '%'; }); });
  }).catch(() => {});
}

function thisMonthStr() { const now=new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`; }

function entryMonth(e) {
  if (!e.work_start_at) return '';
  const raw = e.work_start_at, num = Number(raw);
  let d;
  if (!isNaN(num) && num > 1000000000000) d = new Date(num);
  else if (!isNaN(num) && num > 1000000000) d = new Date(num * 1000);
  else d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function kpiCard(icon, bg, iconColor, label, value, unit, sub, linkPage='', accentColor='') {
  const clickAttr = linkPage ? `onclick="navigateTo('${linkPage}')" title="${linkPage} 바로가기"` : '';
  const borderStyle = accentColor ? `border-left-color:${accentColor}` : '';
  const iconStyle   = `background:${accentColor?accentColor+'18':'#eef2f7'};color:${accentColor||'var(--primary)'};`;
  const subHtml     = sub ? `<div class="kpi-sub">${sub}</div>` : '';
  return `
  <div class="kpi-card${linkPage?' kpi-card-link':''}" ${clickAttr} style="${borderStyle}">
    <div class="kpi-icon" style="${iconStyle}"><i class="fas ${icon}"></i></div>
    <div class="kpi-card-text">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}<span style="font-size:12px;font-weight:500;margin-left:2px;color:var(--text-muted)">${unit}</span></div>
      ${subHtml}
    </div>
    ${linkPage?'<i class="fas fa-chevron-right" style="font-size:10px;color:var(--text-muted);flex-shrink:0"></i>':''}
  </div>`;
}

// ══════════════════════════════════════════════
// STAFF 대시보드
// ══════════════════════════════════════════════
async function renderStaffDashboard(session) {
  try {
    const allEntries = await _getCachedEntries();
    const sid_s = String(session.id);
    const entries = allEntries.filter(e=>String(e.user_id)===sid_s);
    const month = thisMonthStr(), monthNum = parseInt(month.split('-')[1],10);
    const monthEntries = entries.filter(e=>entryMonth(e)===month);
    const approvedMonth = monthEntries.filter(e=>e.status==='approved');
    const submittedCount = entries.filter(e=>e.status==='submitted').length;
    const totalMin = approvedMonth.reduce((s,e)=>s+(e.duration_minutes||0),0);
    const clientMin = approvedMonth.filter(e=>e.time_category==='client').reduce((s,e)=>s+(e.duration_minutes||0),0);
    const internalMin = totalMin-clientMin;
    const clientRatio = totalMin>0?Math.round(clientMin/totalMin*100):0;
    document.getElementById('kpi-grid').innerHTML =
      kpiCard('fa-clock','','',`${monthNum}월 투입시간`,(totalMin/60).toFixed(1),'h','승인 완료 기준','','#1a2b45') +
      kpiCard('fa-briefcase','','','고객사 업무',(clientMin/60).toFixed(1),'h',`비율 ${clientRatio}%`,'','#2d6bb5') +
      kpiCard('fa-building','','','내부 업무',(internalMin/60).toFixed(1),'h',`비율 ${100-clientRatio}%`,'','#4a7fc4') +
      kpiCard('fa-paper-plane','','','승인 대기',submittedCount,'건','','','#6b95ce');
    const majorMap={}, subMap={}, cliMap={};
    approvedMonth.forEach(e=>{
      const k1=e.work_category_name||'미분류'; majorMap[k1]=(majorMap[k1]||0)+(e.duration_minutes||0);
      const k2=e.work_subcategory_name||e.work_category_name||'미분류'; subMap[k2]=(subMap[k2]||0)+(e.duration_minutes||0);
      if(e.time_category==='client'){const k3=e.client_name||'미지정'; cliMap[k3]=(cliMap[k3]||0)+(e.duration_minutes||0);}
    });
    renderBarChart('chart-type', collapseToTopN(majorMap,8));
    renderBarChart('chart-sub',  collapseToTopN(subMap,5));
    const noDataBanner=document.getElementById('dashboard-no-data-banner');
    if(noDataBanner){
      if(entries.length===0){
        noDataBanner.style.display='';
        noDataBanner.innerHTML=`<i class="fas fa-info-circle" style="color:#3b82f6;font-size:15px;flex-shrink:0"></i><span>아직 작성한 타임시트가 없습니다. <strong style="color:var(--primary);cursor:pointer" onclick="navigateTo('entry-new')">New Entry</strong>에서 업무 시간을 기록하세요.</span>`;
      } else if(approvedMonth.length===0){
        noDataBanner.style.display='';
        noDataBanner.innerHTML=`<i class="fas fa-hourglass-half" style="color:#f59e0b;font-size:15px;flex-shrink:0"></i><span>이번 달 <strong>승인 완료</strong>된 타임시트가 없습니다.</span>`;
      } else { noDataBanner.style.display='none'; }
    }
    const recentSection=document.getElementById('recent-entries-section');
    if(recentSection){ recentSection.innerHTML=''; _renderStaffBottomSection(recentSection,{cliMap,myEntries:entries,approvedMonth,allEntries,month,session}); }
  } catch(err){ console.error('Staff Dashboard error:',err); }
}

async function _renderStaffBottomSection(container, { cliMap, myEntries, approvedMonth, allEntries, month, session }) {
  const cliAll=Object.entries(cliMap).sort((a,b)=>b[1]-a[1]), top15=cliAll.slice(0,15), etcMin=cliAll.slice(15).reduce((s,[,v])=>s+v,0);
  const cliEntries=etcMin>0?[...top15,['기타',etcMin]]:top15;
  const totalCliMin=cliEntries.reduce((s,[,v])=>s+v,0);
  const cliHTML=buildCliRows(cliEntries,cliEntries,totalCliMin);
  const recentMine=[...myEntries].sort((a,b)=>Number(b.work_start_at||0)-Number(a.work_start_at||0)).slice(0,10);
  const statusBadge=(s)=>{const map={approved:['var(--success)','승인완료'],submitted:['var(--warning)','1차승인대기'],pre_approved:['#f97316','최종승인대기'],rejected:['var(--danger)','반려'],draft:['var(--text-muted)','임시저장']};const[clr,lbl]=map[s]||['var(--text-muted)',s||'-'];return `<span style="display:inline-block;font-size:10px;font-weight:600;color:${clr};background:${clr}18;padding:2px 5px;border-radius:4px;white-space:nowrap;line-height:1.5;">${lbl}</span>`;};
  const recentRows=recentMine.length===0
    ?`<tr><td colspan="5" class="table-empty"><i class="fas fa-inbox" style="font-size:18px;opacity:0.3;display:block;margin-bottom:6px"></i><p style="margin:0;font-size:12px;color:var(--text-muted)">이번 달 기록이 없습니다.</p></td></tr>`
    :recentMine.map(e=>`<tr>
        <td style="font-size:11px;white-space:nowrap;padding:7px 8px;">${Utils.formatDate(e.work_start_at)}</td>
        <td style="font-size:11px;padding:7px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.client_name||'<span style="color:var(--text-muted)">내부</span>'}</td>
        <td style="font-size:11px;padding:7px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.work_subcategory_name||e.work_category_name||'-'}</td>
        <td style="font-size:11px;text-align:right;font-weight:700;color:#1a2b45;padding:7px 8px;white-space:nowrap;">${((e.duration_minutes||0)/60).toFixed(1)}<span style="font-size:9px;font-weight:500;color:#9aa4b2;margin-left:1px">h</span></td>
        <td style="text-align:center;padding:7px 6px;">${statusBadge(e.status)}</td>
      </tr>`).join('');
  container.innerHTML=`
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-top:10px;">
      <div class="card">
        <div class="card-header" style="padding:12px 16px 10px">
          <h2><i class="fas fa-building" style="color:var(--primary)"></i> &nbsp;고객사별 투입시간</h2>
          <span style="font-size:11px;font-weight:400;color:var(--text-muted)">${month} · 본인 승인 완료 기준</span>
        </div>
        <div class="card-body" style="padding:10px 14px;max-height:460px;overflow-y:auto;">${cliHTML}</div>
      </div>
      <div class="card">
        <div class="card-header" style="padding:12px 16px 10px">
          <h2><i class="fas fa-list-alt" style="color:var(--primary)"></i> &nbsp;내 업무 기록</h2>
          <span style="font-size:11px;font-weight:400;color:var(--text-muted)">${month} · 최근 10건</span>
        </div>
        <div class="card-body" style="padding:0;max-height:420px;overflow-y:auto;">
          <table class="data-table" style="table-layout:fixed;width:100%;border-collapse:collapse;">
            <colgroup><col style="width:82px"><col style="width:22%"><col style="width:auto"><col style="width:46px"><col style="width:58px"></colgroup>
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
          <button class="btn btn-xs btn-outline" onclick="navigateTo('my-entries')" style="font-size:11px;padding:5px 14px;"><i class="fas fa-list"></i>&nbsp; My Time Sheet 전체 보기</button>
        </div>
      </div>
    </div>`;
  requestAnimationFrame(()=>{ container.querySelectorAll('.bar-fill').forEach(el=>{el.style.width=el.dataset.target+'%';}); });
}

// ══════════════════════════════════════════════
// MANAGER 대시보드
// ══════════════════════════════════════════════
async function renderManagerDashboard(session) {
  try {
    const [allEntries, allUsers] = await Promise.all([_getCachedEntries(), Master.users()]);
    const sid = String(session.id);
    const myStaff = allUsers.filter(u=>String(u.approver_id)===sid&&u.role==='staff'&&u.is_active!==false&&u.is_timesheet_target!==false&&u.approver_id&&String(u.approver_id).trim()!=='');
    const myEntries = allEntries.filter(e=>String(e.approver_id)===sid);
    const month = thisMonthStr();
    const monthEntries = myEntries.filter(e=>entryMonth(e)===month);
    const approvedMonth = monthEntries.filter(e=>e.status==='approved');
    const pendingEntries = myEntries.filter(e=>e.status==='submitted');
    const totalMin = approvedMonth.reduce((s,e)=>s+(e.duration_minutes||0),0);
    const clientMin = approvedMonth.filter(e=>e.time_category==='client').reduce((s,e)=>s+(e.duration_minutes||0),0);
    const clientRatio = totalMin>0?Math.round(clientMin/totalMin*100):0;
    document.getElementById('kpi-grid').innerHTML =
      kpiCard('fa-users','','','담당 팀원',myStaff.length,'명','승인자 Staff','','#1a2b45') +
      kpiCard('fa-clock','','','팀 투입시간',(totalMin/60).toFixed(1),'h',`고객 ${clientRatio}%`,'','#2d6bb5') +
      kpiCard('fa-hourglass-half','','','승인 대기',pendingEntries.length,'건',pendingEntries.length>0?'Approval 처리':'대기 없음',pendingEntries.length>0?'approval':'',pendingEntries.length>0?'#d97706':'#4a7fc4') +
      kpiCard('fa-briefcase','','','고객 업무',(clientMin/60).toFixed(1),'h','승인 완료','','#6b95ce');
    const majorMap={},subMap={},cliMap={};
    approvedMonth.forEach(e=>{
      const k1=e.work_category_name||'미분류'; majorMap[k1]=(majorMap[k1]||0)+(e.duration_minutes||0);
      const k2=e.work_subcategory_name||e.work_category_name||'미분류'; subMap[k2]=(subMap[k2]||0)+(e.duration_minutes||0);
      if(e.time_category==='client'){const k3=e.client_name||'미지정'; cliMap[k3]=(cliMap[k3]||0)+(e.duration_minutes||0);}
    });
    const chartSection=document.getElementById('chart-row-1');
    if(chartSection){
      chartSection.style.gridTemplateColumns='1fr 1fr';
      chartSection.innerHTML=`
        <div class="card"><div class="card-header" style="padding:12px 16px 10px"><h2><i class="fas fa-layer-group" style="color:var(--primary)"></i> &nbsp;업무별 투입시간</h2><span style="font-size:11px;font-weight:400;color:var(--text-muted)">대분류 기준</span></div><div class="card-body" style="min-height:200px;position:relative;padding:10px 12px"><canvas id="chart-type"></canvas></div></div>
        <div class="card"><div class="card-header" style="padding:12px 16px 10px"><h2><i class="fas fa-bars" style="color:var(--primary)"></i> &nbsp;상세업무별 투입시간</h2><span style="font-size:11px;font-weight:400;color:var(--text-muted)">소분류 기준 · 상위 5+기타</span></div><div class="card-body" style="min-height:200px;position:relative;padding:10px 12px"><canvas id="chart-sub"></canvas></div></div>`;
      renderBarChart('chart-type',collapseToTopN(majorMap,8));
      renderBarChart('chart-sub',collapseToTopN(subMap,5));
    }
    const recentSection=document.getElementById('recent-entries-section');
    if(recentSection){
      const pendingCount=pendingEntries.length;
      recentSection.innerHTML=`
        <div class="card" style="margin-top:10px">
          <div class="card-header" style="padding:10px 16px 8px">
            <h2><i class="fas fa-hourglass-half" style="color:${pendingCount>0?'var(--danger)':'var(--success)'}"></i>&nbsp;승인 대기 현황
              ${pendingCount>0?`<span class="badge badge-red" style="margin-left:8px;font-size:12px;vertical-align:middle">${pendingCount}건 대기</span>`:`<span style="margin-left:8px;font-size:11px;color:var(--text-muted);font-weight:400;vertical-align:middle">모두 처리완료</span>`}
            </h2>
          </div>
          ${pendingCount>0?`<div style="background:#fff7ed;border-bottom:1px solid #fed7aa;padding:10px 16px;font-size:12px;color:#9a3412;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><span><i class="fas fa-info-circle"></i>&nbsp;팀원이 제출한 타임시트 <strong>${pendingCount}건</strong>이 승인을 기다리고 있습니다.</span><button class="btn btn-sm btn-primary" onclick="navigateTo('approval')" style="white-space:nowrap;font-size:11px"><i class="fas fa-check-double"></i> Approval에서 승인 처리</button></div>`:''}
          <div class="card-body" style="padding:0">
            <div class="table-wrapper" style="border:none;border-radius:0">
              <table class="data-table" style="table-layout:fixed;width:100%">
                <colgroup><col style="width:82px"><col style="width:58px"><col style="width:66px"><col style="width:70px"><col><col><col style="width:52px"></colgroup>
                <thead><tr><th>날짜</th><th>Staff</th><th>승인자</th><th>팀명</th><th>고객사</th><th>업무내용</th><th style="text-align:center">경과</th></tr></thead>
                <tbody id="manager-pending-tbody"></tbody>
              </table>
            </div>
          </div>
        </div>`;
      const ptbody=document.getElementById('manager-pending-tbody');
      const recent5=[...pendingEntries].sort((a,b)=>Number(a.work_start_at||0)-Number(b.work_start_at||0)).slice(0,5);
      if(!recent5.length){
        ptbody.innerHTML=`<tr><td colspan="7" class="table-empty"><i class="fas fa-check-circle" style="color:var(--success)"></i><p>승인 대기 항목이 없습니다.</p></td></tr>`;
      } else {
        const now=Date.now();
        ptbody.innerHTML=recent5.map(e=>{
          const submittedAt=Number(e.updated_at||e.created_at||0), waitDays=submittedAt>0?Math.floor((now-submittedAt)/86400000):0;
          const waitLabel=waitDays===0?'오늘':waitDays===1?'어제':`${waitDays}일 전`;
          const urgentColor=waitDays>=3?'var(--danger)':waitDays>=1?'var(--warning)':'var(--text-muted)';
          return `<tr><td>${Utils.formatDate(e.work_start_at)}</td><td><strong>${e.user_name||'-'}</strong></td><td style="font-size:11px;color:var(--text-muted)">${e.approver_name||'-'}</td><td style="font-size:11px;color:var(--text-muted)">${e.team_name||'-'}</td><td>${e.client_name||'<span style="color:var(--text-muted)">내부</span>'}</td><td>${e.work_subcategory_name||'-'}</td><td style="text-align:center"><span style="font-size:11px;font-weight:600;color:${urgentColor};white-space:nowrap"><i class="fas fa-clock" style="font-size:9px"></i> ${waitLabel}</span></td></tr>`;
        }).join('')+(pendingEntries.length>5?`<tr><td colspan="7" style="text-align:center;padding:12px;background:#f8fafc"><span style="font-size:12px;color:var(--text-muted)">외 ${pendingEntries.length-5}건 더 있습니다.</span><button class="btn btn-xs btn-outline" style="margin-left:10px" onclick="navigateTo('approval')"><i class="fas fa-list"></i> 전체 보기</button></td></tr>`:'');
      }
      const allActiveStaff=allUsers.filter(u=>u.role==='staff'&&u.is_active!==false&&u.is_timesheet_target!==false&&u.approver_id&&String(u.approver_id).trim()!=='');
      const approvedAll2=allEntries.filter(e=>entryMonth(e)===month&&e.status==='approved');
      const maxRefUser=allActiveStaff.reduce((best,u)=>{
        const uMin=approvedAll2.filter(e=>e.user_id===u.id).reduce((s,e)=>s+(e.duration_minutes||0),0);
        const bMin=best?approvedAll2.filter(e=>e.user_id===best.id).reduce((s,e)=>s+(e.duration_minutes||0),0):0;
        return uMin>bMin?u:best;
      },null);
      const bottomSection=document.createElement('div');
      recentSection.appendChild(bottomSection);
      renderBottomSection(bottomSection,{cliMap,allEntries,approvedEntries:approvedMonth,staffList:myStaff,maxRefStaff:maxRefUser,month,mode:'manager'});
    }
  } catch(err){ console.error('Manager Dashboard error:',err); }
}

// ══════════════════════════════════════════════
// DIRECTOR / ADMIN 대시보드
// ══════════════════════════════════════════════
async function renderDirectorDashboard(session) {
  try {
    const [allEntriesRaw, allUsers, allTeams] = await Promise.all([_getCachedEntries(), Master.users(), Master.teams()]);
    let allEntries = allEntriesRaw;
    if (Auth.isDirector(session)) {
      const scopeIds=new Set(allUsers.filter(u=>Auth.scopeMatch(session,u)).map(u=>String(u.id)));
      allEntries=allEntriesRaw.filter(e=>scopeIds.has(String(e.user_id)));
    }
    const month=thisMonthStr();
    const monthEntries=allEntries.filter(e=>entryMonth(e)===month);
    const approvedMonth=monthEntries.filter(e=>e.status==='approved');
    const pendingAll=allEntries.filter(e=>e.status==='submitted');
    const activeStaffAll=allUsers.filter(u=>(u.role==='staff'||(u.role==='manager'&&u.is_timesheet_target!==false))&&u.is_active!==false&&u.is_timesheet_target!==false&&(u.role==='manager'||(u.approver_id&&String(u.approver_id).trim()!=='')));
    const scopeStaff=Auth.isDirector(session)?activeStaffAll.filter(u=>Auth.scopeMatch(session,u)):activeStaffAll;
    const totalMin=approvedMonth.reduce((s,e)=>s+(e.duration_minutes||0),0);
    const clientMin=approvedMonth.filter(e=>e.time_category==='client').reduce((s,e)=>s+(e.duration_minutes||0),0);
    const clientRatio=totalMin>0?Math.round(clientMin/totalMin*100):0;
    const extraKpi=Auth.isAdmin(session)
      ?kpiCard('fa-cog','','','등록 직원',allUsers.filter(u=>u.is_active!==false).length,'명',`팀 ${allTeams.length}개`,'','#6b95ce')
      :kpiCard('fa-users','','','전체 Staff',scopeStaff.length,'명','활성 계정 기준','','#6b95ce');
    document.getElementById('kpi-grid').innerHTML =
      kpiCard('fa-clock','','','전체 투입',(totalMin/60).toFixed(1),'h','승인 완료 기준','','#1a2b45') +
      kpiCard('fa-briefcase','','','고객 업무',(clientMin/60).toFixed(1),'h',`비율 ${clientRatio}%`,'','#2d6bb5') +
      kpiCard('fa-hourglass-half','','','승인 대기',pendingAll.length,'건','전체 팀',pendingAll.length>0?'approval':'',pendingAll.length>0?'#d97706':'#4a7fc4') +
      extraKpi;
    const majorMap={},subMap={},cliMap={};
    approvedMonth.forEach(e=>{
      const k1=e.work_category_name||'미분류'; majorMap[k1]=(majorMap[k1]||0)+(e.duration_minutes||0);
      const k2=e.work_subcategory_name||e.work_category_name||'미분류'; subMap[k2]=(subMap[k2]||0)+(e.duration_minutes||0);
      if(e.time_category==='client'){const k3=e.client_name||'미지정'; cliMap[k3]=(cliMap[k3]||0)+(e.duration_minutes||0);}
    });
    const chartSection=document.getElementById('chart-row-1');
    if(chartSection){
      chartSection.style.gridTemplateColumns='1fr 1fr';
      chartSection.innerHTML=`
        <div class="card"><div class="card-header" style="padding:12px 16px 10px"><h2><i class="fas fa-layer-group" style="color:var(--primary)"></i> &nbsp;업무별 투입시간</h2><span style="font-size:11px;font-weight:400;color:var(--text-muted)">대분류 기준</span></div><div class="card-body" style="min-height:200px;position:relative;padding:10px 12px"><canvas id="chart-type"></canvas></div></div>
        <div class="card"><div class="card-header" style="padding:12px 16px 10px"><h2><i class="fas fa-bars" style="color:var(--primary)"></i> &nbsp;상세업무별 투입시간</h2><span style="font-size:11px;font-weight:400;color:var(--text-muted)">소분류 기준 · 상위 5+기타</span></div><div class="card-body" style="min-height:200px;position:relative;padding:10px 12px"><canvas id="chart-sub"></canvas></div></div>`;
      renderBarChart('chart-type',collapseToTopN(majorMap,8));
      renderBarChart('chart-sub',collapseToTopN(subMap,5));
    }
    const recentSection=document.getElementById('recent-entries-section');
    if(recentSection){
      const maxRefUser=scopeStaff.reduce((best,u)=>{
        const uMin=approvedMonth.filter(e=>e.user_id===u.id).reduce((s,e)=>s+(e.duration_minutes||0),0);
        const bMin=best?approvedMonth.filter(e=>e.user_id===best.id).reduce((s,e)=>s+(e.duration_minutes||0),0):0;
        return uMin>bMin?u:best;
      },null);
      recentSection.innerHTML='';
      renderBottomSection(recentSection,{cliMap,allEntries,approvedEntries:approvedMonth,staffList:scopeStaff,maxRefStaff:maxRefUser,month,mode:'director'});
    }
  } catch(err){ console.error('Director Dashboard error:',err); }
}
