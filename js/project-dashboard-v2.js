/* project-dashboard.js — 프로젝트 대시보드 (매출/진행상태/세금계산서) */
'use strict';

const PROJ_DASH_LIFECYCLE_META = {
  contract_completed: { label: '계약완료', color: '#334155', bg: '#e2e8f0' },
  in_progress: { label: '수행중', color: '#1d4ed8', bg: '#dbeafe' },
  work_closed: { label: '업무종료', color: '#92400e', bg: '#fef3c7' },
  settled_done: { label: '정산완료', color: '#047857', bg: '#d1fae5' },
};

function _projDashMonthNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _projDashYearByMonth(ym) {
  const m = String(ym || '').trim();
  return m.slice(0, 4) || String(new Date().getFullYear());
}

function _projDashKrw(v) {
  return `${Math.round(Number(v || 0)).toLocaleString('ko-KR')}원`;
}

function _projDashEsc(v) {
  if (typeof Utils !== 'undefined' && Utils.escHtml) return Utils.escHtml(v == null ? '' : String(v));
  return String(v == null ? '' : v);
}

function _projDashTsDate(ms) {
  const n = Number(ms || 0);
  if (!n) return '-';
  try {
    return new Date(n).toISOString().slice(0, 10);
  } catch (_) {
    return '-';
  }
}

function _projDashIsYearMonth(ym, year) {
  return String(ym || '').slice(0, 4) === String(year || '');
}

function _projDashCanViewAll(session) {
  return !!(session && Auth && typeof Auth.canViewDashboardAll === 'function' && Auth.canViewDashboardAll(session));
}

function _projDashIsActiveUser(u) {
  if (!u) return false;
  if (u.deleted === true) return false;
  if (u.is_active === false) return false;
  return true;
}

function _projDashVisibleUserIds(session, allUsers) {
  const users = Array.isArray(allUsers) ? allUsers : [];
  const activeUsers = users.filter(_projDashIsActiveUser);
  const activeIdSet = new Set(
    activeUsers
      .map((u) => String(u.id || '').trim())
      .filter(Boolean)
  );
  if (_projDashCanViewAll(session)) return activeIdSet;
  if (!session || !Auth || typeof Auth.canViewDashboardMenu !== 'function') return new Set();
  if (!Auth.canViewDashboardMenu(session)) return new Set();
  return new Set(
    activeUsers
      .filter((u) => Auth.scopeMatch(session, u))
      .map((u) => String(u.id || '').trim())
      .filter(Boolean)
  );
}

function _projDashStatusBadge(st) {
  const s = String(st || '').trim();
  const map = {
    draft: ['임시', '#64748b', '#e2e8f0'],
    requested: ['발행요청', '#1d4ed8', '#dbeafe'],
    issued: ['발행완료', '#0f766e', '#ccfbf1'],
    partially_paid: ['부분입금', '#b45309', '#fef3c7'],
    paid: ['입금완료', '#047857', '#d1fae5'],
    overdue: ['기간경과', '#b91c1c', '#fee2e2'],
  };
  const hit = map[s] || [s || '-', '#475569', '#e2e8f0'];
  return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:56px;padding:2px 8px;border-radius:999px;background:${hit[2]};color:${hit[1]};font-size:11px;font-weight:700">${hit[0]}</span>`;
}

function _projDashLifecycleStatus(project) {
  const p = project || {};
  const raw = String(p.lifecycle_status_override || p.lifecycle_status || '').trim().toLowerCase();
  if (raw && PROJ_DASH_LIFECYCLE_META[raw]) return raw;
  if (Number(p.settled_at || 0) > 0) return 'settled_done';
  if (Number(p.work_closed_at || 0) > 0) return 'work_closed';
  if (Number(p.execution_started_at || 0) > 0) return 'in_progress';
  return 'contract_completed';
}

function _projDashLifecycleDate(project, statusCode) {
  const p = project || {};
  const byStatus = {
    contract_completed: Number(p.contract_completed_at || p.created_at || 0),
    in_progress: Number(p.execution_started_at || 0),
    work_closed: Number(p.work_closed_at || 0),
    settled_done: Number(p.settled_at || 0),
  };
  return byStatus[String(statusCode || '')] || Number(p.updated_at || p.created_at || 0);
}

function _projDashLifecycleBadge(code) {
  const meta = PROJ_DASH_LIFECYCLE_META[String(code || '')] || PROJ_DASH_LIFECYCLE_META.contract_completed;
  return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:58px;padding:2px 8px;border-radius:999px;background:${meta.bg};color:${meta.color};font-size:11px;font-weight:700">${meta.label}</span>`;
}

function _projDashProjectOrderYear(project) {
  const p = project || {};
  const ts = Number(p.contract_completed_at || p.created_at || 0);
  if (!ts) return '';
  try { return new Date(ts).getFullYear(); } catch (_) { return ''; }
}

function _projDashRenderTypeSummary(wrapEl, rows, typeById, userById, revenueByCode) {
  if (!wrapEl) return;
  if (!rows.length) {
    wrapEl.innerHTML = '<div class="table-empty"><i class="fas fa-inbox"></i><p>해당 연도 수주 프로젝트가 없습니다.</p></div>';
    return;
  }

  const addGroup = (bucket, key, code) => {
    if (!bucket[key]) bucket[key] = { count: 0, codes: new Set(), revenue: 0 };
    if (bucket[key].codes.has(code)) return;
    bucket[key].codes.add(code);
    bucket[key].count += 1;
    bucket[key].revenue += Number((revenueByCode && revenueByCode[code]) || 0);
  };
  const byOrg = {};
  const byMainCategory = {};
  rows.forEach((r) => {
    const code = String(r.project_code || '').trim();
    if (!code) return;
    const orgKey = _projDashDivisionBucket(r, userById || {});
    if (orgKey && orgKey !== '미분류 사업부') addGroup(byOrg, orgKey, code);
    const type = typeById[String(r.project_code_type_id || '').trim()] || {};
    const main = String(type.main_category || '미분류').trim() || '미분류';
    addGroup(byMainCategory, main, code);
  });

  const orgRows = Object.entries(byOrg).map(([label, info]) => ({ label, ...info })).sort((a, b) => b.revenue - a.revenue || b.count - a.count);
  const mainRows = Object.entries(byMainCategory).map(([label, info]) => ({ label, ...info })).sort((a, b) => b.revenue - a.revenue || b.count - a.count);
  const totalAll = rows.length || 1;
  const totalRevenue = Object.values(revenueByCode || {}).reduce((s, v) => s + Number(v || 0), 0) || 1;

  const renderPerfTable = (title, icon, list) => {
    if (!list.length) {
      return `
        <div class="card" style="margin:0;border:1px solid var(--border-light)">
          <div class="card-header"><h2><i class="fas ${icon}" style="color:var(--primary)"></i> ${title}</h2></div>
          <div class="card-body"><div class="table-empty"><i class="fas fa-inbox"></i><p>집계 데이터가 없습니다.</p></div></div>
        </div>
      `;
    }
    const sorted = list.slice().sort((a, b) => b.revenue - a.revenue || b.count - a.count);
    const topRows = sorted.slice(0, 5);
    const restRows = sorted.slice(5);
    const maxRevenue = Math.max(...topRows.map((r) => Number(r.revenue || 0)), 1);
    const makeRow = (r, i) => {
      const revenuePct = (Number(r.revenue || 0) / totalRevenue) * 100;
      const w = Math.max(4, Math.round((Number(r.revenue || 0) / maxRevenue) * 100));
      return `
        <tr>
          <td style="text-align:center;width:32px">${i + 1}</td>
          <td style="white-space:nowrap;word-break:keep-all;line-height:1.35" title="${_projDashEsc(r.label)}">${_projDashEsc(r.label)}</td>
          <td style="text-align:right;width:78px">${r.count}</td>
          <td style="width:170px">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden">
                <div style="height:100%;width:${w}%;background:linear-gradient(90deg,#2563eb,#3b82f6);border-radius:999px"></div>
              </div>
              <span style="font-size:11px;color:#64748b;min-width:42px;text-align:right">${revenuePct.toFixed(1)}%</span>
            </div>
          </td>
          <td style="text-align:right;width:130px;font-weight:700;color:#1e3a8a;white-space:nowrap">${_projDashKrw(r.revenue || 0)}</td>
        </tr>
      `;
    };
    const rowsHtml = topRows.map((r, i) => makeRow(r, i)).join('');
    const restSummary = restRows.length
      ? `<div style="padding:8px 12px;border-top:1px dashed #e5e7eb;font-size:12px;color:#64748b">나머지 ${restRows.length}개 그룹은 상세에서 확인</div>`
      : '';
    const restDetail = restRows.length
      ? `
        <details style="border-top:1px solid #eef2f7">
          <summary style="cursor:pointer;list-style:none;padding:8px 12px;font-size:12px;color:#334155;font-weight:600">전체 보기</summary>
          <div class="table-wrapper" style="border:none;border-radius:0;overflow:auto">
            <table class="data-table" style="width:100%;table-layout:fixed">
              <tbody>${restRows.map((r, i) => makeRow(r, i + 5)).join('')}</tbody>
            </table>
          </div>
        </details>
      `
      : '';
    return `
      <div class="card" style="margin:0;border:1px solid var(--border-light);box-shadow:0 2px 10px rgba(15,23,42,0.04)">
        <div class="card-header">
          <h2><i class="fas ${icon}" style="color:var(--primary)"></i> ${title}</h2>
          <div style="font-size:12px;color:#64748b">총 ${list.length}개 그룹</div>
        </div>
        <div class="card-body" style="padding:0">
          <div class="table-wrapper" style="border:none;border-radius:0;overflow:hidden">
            <table class="data-table" style="width:100%;table-layout:fixed">
              <thead>
                <tr>
                  <th style="width:32px;text-align:center">No</th>
                  <th>구분</th>
                  <th style="width:78px;text-align:right">건수</th>
                  <th style="width:170px">매출비중</th>
                  <th style="width:130px;text-align:right">누적매출</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
          ${restSummary}
          ${restDetail}
        </div>
      </div>
    `;
  };

  wrapEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 2px 8px 2px">
      <div style="font-size:12px;color:#334155">총 <b style="color:#1e3a8a">${totalAll}</b>개 프로젝트 / 누적매출 <b style="color:#1e3a8a">${_projDashKrw(totalRevenue)}</b></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px">
      ${renderPerfTable('조직별 누적 실적', 'fa-building', orgRows)}
      ${renderPerfTable('프로젝트 대분류별 누적 실적', 'fa-layer-group', mainRows)}
    </div>
  `;
}

function _projDashResolveProjectDeptName(project, userById) {
  const p = project || {};
  const direct = String(p.dept_name || p.department_name || '').trim();
  if (direct) return direct;
  const refIds = [
    String(p.cpm_user_id || '').trim(),
    String(p.created_by || '').trim(),
    String(p.updated_by || '').trim(),
    String(p.first_approved_by || '').trim(),
    String(p.second_approved_by || '').trim(),
    String(p.final_approved_by || '').trim(),
  ].filter(Boolean);
  for (let i = 0; i < refIds.length; i += 1) {
    const u = userById[refIds[i]];
    const dept = String(u?.dept_name || u?.department_name || '').trim();
    if (dept) return dept;
  }
  return '미분류 사업부';
}

function _projDashResolveProjectHqName(project, userById) {
  const p = project || {};
  const direct = String(p.hq_name || '').trim();
  if (direct) return direct;
  const refIds = [
    String(p.cpm_user_id || '').trim(),
    String(p.created_by || '').trim(),
    String(p.updated_by || '').trim(),
    String(p.first_approved_by || '').trim(),
    String(p.second_approved_by || '').trim(),
    String(p.final_approved_by || '').trim(),
  ].filter(Boolean);
  for (let i = 0; i < refIds.length; i += 1) {
    const u = userById[refIds[i]];
    const hq = String(u?.hq_name || '').trim();
    if (hq) return hq;
  }
  return '';
}

function _projDashHasToken(v, token) {
  return String(v || '').toUpperCase().includes(String(token || '').toUpperCase());
}

function _projDashDivisionBucket(project, userById) {
  const dept = _projDashResolveProjectDeptName(project, userById);
  const hq = _projDashResolveProjectHqName(project, userById);
  if (_projDashHasToken(dept, 'CCB')) {
    return hq ? `CCB / ${hq}` : 'CCB / 본부 미지정';
  }
  if (_projDashHasToken(dept, 'CRB')) return 'CRB';
  if (_projDashHasToken(dept, 'COB')) return 'COB';
  return dept || '미분류 사업부';
}

async function loadProjectDashboard() {
  const session = typeof getSession === 'function' ? getSession() : null;
  const month = String(document.getElementById('project-dash-month')?.value || _projDashMonthNow());
  const year = _projDashYearByMonth(month);
  const salesKpisEl = document.getElementById('project-dash-sales-kpis');
  const salesCaptionEl = document.getElementById('project-dash-sales-caption');
  const typeCaptionEl = document.getElementById('project-dash-type-caption');
  const taxCaptionEl = document.getElementById('project-dash-tax-caption');
  const typeSummaryEl = document.getElementById('project-dash-type-summary');
  const progressBodyEl = document.getElementById('project-dash-progress-body');
  const progressCaptionEl = document.getElementById('project-dash-progress-caption');
  const taxKpisEl = document.getElementById('project-dash-tax-kpis');
  const targetBodyEl = document.getElementById('project-dash-target-body');
  const overdueBodyEl = document.getElementById('project-dash-overdue-body');
  const receivableBodyEl = document.getElementById('project-dash-receivable-body');
  if (!salesKpisEl || !typeSummaryEl || !progressBodyEl || !taxKpisEl || !targetBodyEl || !overdueBodyEl || !receivableBodyEl) return;

  if (salesCaptionEl) salesCaptionEl.textContent = `${year}년 기준 집계 (매출=세금계산서 발행금액)`;
  if (typeCaptionEl) typeCaptionEl.textContent = `${year}년 수주 프로젝트 누적`;
  if (progressCaptionEl) progressCaptionEl.textContent = '상태별 그룹 정렬';
  if (taxCaptionEl) taxCaptionEl.textContent = `${month} 기준`;

  salesKpisEl.innerHTML = '<div class="table-empty" style="grid-column:1/-1"><i class="fas fa-spinner fa-spin"></i><p>매출 지표를 불러오는 중입니다.</p></div>';
  typeSummaryEl.innerHTML = '<div class="table-empty"><i class="fas fa-spinner fa-spin"></i><p>조직/유형별 누적 실적을 계산하는 중입니다.</p></div>';
  progressBodyEl.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-spinner fa-spin"></i><p>프로젝트 진행현황을 불러오는 중입니다.</p></td></tr>';
  taxKpisEl.innerHTML = '<div class="table-empty" style="grid-column:1/-1"><i class="fas fa-spinner fa-spin"></i><p>세금계산서 지표를 불러오는 중입니다.</p></div>';

  try {
    const [projectsAll, invoicesAll, batchesAll, typeRows, allUsers] = await Promise.all([
      API.listAllPages('registered_projects', { limit: 800, maxPages: 30, sort: 'updated_at' }).catch(() => []),
      API.listAllPages('project_invoices', { limit: 1000, maxPages: 30, sort: 'updated_at' }).catch(() => []),
      API.listAllPages('project_timecharge_batches', { limit: 1000, maxPages: 30, sort: 'updated_at' }).catch(() => []),
      API.listAllPages('project_code_types', { limit: 500, maxPages: 10, sort: 'main_code' }).catch(() => []),
      Master.users().catch(() => []),
    ]);

    const canViewAll = _projDashCanViewAll(session);
    const visibleUserIds = _projDashVisibleUserIds(session, allUsers);
    const projBase = (projectsAll || []).filter((r) => String(r.project_code || '').trim() !== '');
    const projects = canViewAll
      ? projBase
      : projBase.filter((r) => {
        if (Auth && typeof Auth.scopeMatch === 'function' && Auth.scopeMatch(session, r)) return true;
        const refs = [
          String(r.created_by || '').trim(),
          String(r.first_approved_by || '').trim(),
          String(r.second_approved_by || '').trim(),
          String(r.final_approved_by || '').trim(),
          String(r.cpm_user_id || '').trim(),
        ].filter(Boolean);
        return refs.some((id) => visibleUserIds && visibleUserIds.has(id));
      });

    const approvedProjects = projects.filter((r) => String(r.registration_status || '').trim().toLowerCase() === 'approved');
    const allowedProjectCodes = new Set(approvedProjects.map((r) => String(r.project_code || '').trim()).filter(Boolean));
    const projectByCode = new Map(approvedProjects.map((r) => [String(r.project_code || '').trim(), r]));
    const typeById = {};
    (typeRows || []).forEach((r) => {
      const id = String(r.id || '').trim();
      if (id) typeById[id] = r;
    });
    const userById = {};
    (allUsers || []).forEach((u) => {
      const id = String(u?.id || '').trim();
      if (id) userById[id] = u;
    });

    const codeAllowed = (row) => {
      const code = String(row && row.project_code ? row.project_code : '').trim();
      return !!code && allowedProjectCodes.has(code);
    };
    const invoicesScoped = (invoicesAll || []).filter(codeAllowed);
    const batchesScoped = (batchesAll || []).filter(codeAllowed);

    const orderedYtdProjects = approvedProjects.filter((r) => String(_projDashProjectOrderYear(r)) === String(year));
    const orderedYtdCodes = new Set(orderedYtdProjects.map((r) => String(r.project_code || '').trim()).filter(Boolean));
    const ytdRevenue = invoicesScoped
      .filter((r) => _projDashIsYearMonth(r.billing_month, year))
      .reduce((sum, r) => sum + Number(r.invoice_amount || 0), 0);
    salesKpisEl.innerHTML = `
      <div class="pm-kpi-card"><div class="pm-kpi-label">${year} 수주 프로젝트</div><div class="pm-kpi-value">${orderedYtdCodes.size}</div><div class="pm-kpi-sub">프로젝트 수 기준</div></div>
      <div class="pm-kpi-card"><div class="pm-kpi-label">${year} 누적매출</div><div class="pm-kpi-value">${_projDashKrw(ytdRevenue)}</div><div class="pm-kpi-sub">세금계산서 발행기준</div></div>
    `;

    const ytdRevenueByCode = {};
    invoicesScoped
      .filter((r) => _projDashIsYearMonth(r.billing_month, year))
      .forEach((r) => {
        const code = String(r.project_code || '').trim();
        if (!code) return;
        ytdRevenueByCode[code] = Number(ytdRevenueByCode[code] || 0) + Number(r.invoice_amount || 0);
      });

    _projDashRenderTypeSummary(typeSummaryEl, orderedYtdProjects, typeById, userById, ytdRevenueByCode);

    const statusOrder = {
      in_progress: 0,
      contract_completed: 1,
      work_closed: 2,
      settled_done: 3,
    };
    const statusFlow = ['in_progress', 'contract_completed', 'work_closed', 'settled_done'];
    const progressRows = approvedProjects
      .map((p) => {
        const code = _projDashLifecycleStatus(p);
        const stDate = _projDashLifecycleDate(p, code);
        const type = typeById[String(p.project_code_type_id || '').trim()] || {};
        return {
          project_code: String(p.project_code || '').trim(),
          project_name: String(p.project_name || '').trim(),
          client_name: String(p.client_name || '').trim(),
          main_category: String(type.main_category || '미분류').trim() || '미분류',
          sub_category: String(type.sub_category || '미분류').trim() || '미분류',
          lifecycle_code: code,
          lifecycle_at: stDate,
          updated_at: Number(p.updated_at || p.created_at || 0),
        };
      })
      .sort((a, b) => {
        const ao = Number(statusOrder[a.lifecycle_code] ?? 99);
        const bo = Number(statusOrder[b.lifecycle_code] ?? 99);
        if (ao !== bo) return ao - bo;
        return (b.lifecycle_at || 0) - (a.lifecycle_at || 0);
      });

    if (progressCaptionEl) {
      const byStatus = {};
      progressRows.forEach((r) => {
        byStatus[r.lifecycle_code] = Number(byStatus[r.lifecycle_code] || 0) + 1;
      });
      const chips = statusFlow
        .filter((k) => Number(byStatus[k] || 0) > 0)
        .map((k) => {
          const meta = PROJ_DASH_LIFECYCLE_META[k] || PROJ_DASH_LIFECYCLE_META.contract_completed;
          return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:${meta.bg};color:${meta.color};font-weight:700">${meta.label} ${byStatus[k]}건</span>`;
        }).join(' ');
      progressCaptionEl.innerHTML = chips || '상태별 그룹 정렬';
    }

    if (!progressRows.length) {
      progressBodyEl.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-inbox"></i><p>표시할 프로젝트가 없습니다.</p></td></tr>';
    } else {
      let seq = 0;
      const groupedHtml = statusFlow.map((statusCode) => {
        const rows = progressRows.filter((r) => r.lifecycle_code === statusCode).slice(0, 40);
        if (!rows.length) return '';
        const meta = PROJ_DASH_LIFECYCLE_META[statusCode] || PROJ_DASH_LIFECYCLE_META.contract_completed;
        const header = `
          <tr>
            <td colspan="7" style="background:#f8fafc;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;padding:8px 10px">
              <span style="display:inline-flex;align-items:center;gap:8px;font-size:12px;color:#334155">
                <span style="display:inline-flex;align-items:center;justify-content:center;min-width:58px;padding:2px 8px;border-radius:999px;background:${meta.bg};color:${meta.color};font-size:11px;font-weight:700">${meta.label}</span>
                <b>${rows.length}건</b>
              </span>
            </td>
          </tr>
        `;
        const body = rows.map((r) => {
          seq += 1;
          return `
            <tr>
              <td style="text-align:center">${seq}</td>
              <td>${_projDashEsc(r.project_code || '-')}</td>
              <td>${_projDashEsc(r.project_name || '-')}</td>
              <td>${_projDashEsc(r.client_name || '-')}</td>
              <td>${_projDashEsc(r.main_category)} / ${_projDashEsc(r.sub_category)}</td>
              <td style="text-align:center">${_projDashLifecycleBadge(r.lifecycle_code)}</td>
              <td>${_projDashEsc(_projDashTsDate(r.lifecycle_at))}</td>
            </tr>
          `;
        }).join('');
        return header + body;
      }).join('');
      progressBodyEl.innerHTML = groupedHtml;
    }

    const monthInvoices = invoicesScoped.filter((r) => String(r.billing_month || '') === month);
    const monthBatches = batchesScoped.filter((r) => String(r.billing_month || '') === month);
    const nowDate = new Date().toISOString().slice(0, 10);
    const overdueRows = monthInvoices.filter((r) => {
      const st = String(r.payment_status || '').trim();
      if (st === 'paid' || st === 'cancelled') return false;
      const due = String(r.due_date || '').trim();
      return !!due && due < nowDate;
    });
    const receivableRows = monthInvoices.filter((r) => Number(r.outstanding_amount || 0) > 0);
    const monthRevenue = monthInvoices.reduce((sum, r) => sum + Number(r.invoice_amount || 0), 0);
    const monthOutstanding = monthInvoices.reduce((sum, r) => sum + Number(r.outstanding_amount || 0), 0);
    const monthTargetCodes = new Set([
      ...monthBatches.map((r) => String(r.project_code || '').trim()).filter(Boolean),
      ...monthInvoices.map((r) => String(r.project_code || '').trim()).filter(Boolean),
    ]);

    taxKpisEl.innerHTML = `
      <div class="pm-kpi-card"><div class="pm-kpi-label">${month} 발행대상</div><div class="pm-kpi-value">${monthTargetCodes.size}</div><div class="pm-kpi-sub">프로젝트 수</div></div>
      <div class="pm-kpi-card"><div class="pm-kpi-label">기간경과</div><div class="pm-kpi-value">${overdueRows.length}</div><div class="pm-kpi-sub">입금예정일 경과 건</div></div>
      <div class="pm-kpi-card"><div class="pm-kpi-label">미수금 프로젝트</div><div class="pm-kpi-value">${new Set(receivableRows.map((r) => String(r.project_code || '').trim())).size}</div><div class="pm-kpi-sub">프로젝트 수</div></div>
      <div class="pm-kpi-card"><div class="pm-kpi-label">${month} 발행매출</div><div class="pm-kpi-value">${_projDashKrw(monthRevenue)}</div><div class="pm-kpi-sub">세금계산서 발행기준</div></div>
      <div class="pm-kpi-card"><div class="pm-kpi-label">${month} 미수금</div><div class="pm-kpi-value">${_projDashKrw(monthOutstanding)}</div><div class="pm-kpi-sub">현재 잔액 기준</div></div>
    `;

    const targetRows = monthInvoices
      .slice()
      .sort((a, b) => String(a.project_code || '').localeCompare(String(b.project_code || '')));
    if (!targetRows.length) {
      targetBodyEl.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-inbox"></i><p>해당 월 발행 대상 데이터가 없습니다.</p></td></tr>';
    } else {
      targetBodyEl.innerHTML = targetRows.slice(0, 40).map((r, i) => `
        <tr>
          <td style="text-align:center">${i + 1}</td>
          <td>${_projDashEsc(r.project_code || '-')}</td>
          <td>${_projDashEsc(r.project_name || (projectByCode.get(String(r.project_code || '').trim())?.project_name || '-'))}</td>
          <td style="text-align:center">${_projDashStatusBadge(String(r.payment_status || '').trim())}</td>
          <td style="text-align:right">${_projDashKrw(r.invoice_amount || 0)}</td>
          <td style="text-align:right">${_projDashKrw(r.outstanding_amount || 0)}</td>
          <td>${_projDashEsc(r.due_date || '-')}</td>
          <td>${_projDashEsc(r.client_name || '-')}</td>
        </tr>
      `).join('');
    }

    if (!overdueRows.length) {
      overdueBodyEl.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-check-circle"></i><p>발행기간 경과 건이 없습니다.</p></td></tr>';
    } else {
      overdueBodyEl.innerHTML = overdueRows
        .slice()
        .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))
        .slice(0, 40)
        .map((r, i) => `
          <tr>
            <td style="text-align:center">${i + 1}</td>
            <td>${_projDashEsc(r.project_code || '-')}</td>
            <td>${_projDashEsc(r.billing_month || '-')}</td>
            <td>${_projDashEsc(r.due_date || '-')}</td>
            <td style="text-align:center">${_projDashStatusBadge('overdue')}</td>
            <td style="text-align:right">${_projDashKrw(r.outstanding_amount || 0)}</td>
            <td>${_projDashEsc(r.client_name || '-')}</td>
          </tr>
        `).join('');
    }

    if (!receivableRows.length) {
      receivableBodyEl.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-check-circle"></i><p>미수금 프로젝트가 없습니다.</p></td></tr>';
    } else {
      receivableBodyEl.innerHTML = receivableRows
        .slice()
        .sort((a, b) => Number(b.outstanding_amount || 0) - Number(a.outstanding_amount || 0))
        .slice(0, 50)
        .map((r, i) => `
          <tr>
            <td style="text-align:center">${i + 1}</td>
            <td>${_projDashEsc(r.billing_month || '-')}</td>
            <td>${_projDashEsc(r.project_code || '-')}</td>
            <td>${_projDashEsc(r.project_name || (projectByCode.get(String(r.project_code || '').trim())?.project_name || '-'))}</td>
            <td style="text-align:center">${_projDashStatusBadge(String(r.payment_status || '').trim())}</td>
            <td style="text-align:right">${_projDashKrw(r.invoice_amount || 0)}</td>
            <td style="text-align:right">${_projDashKrw(r.outstanding_amount || 0)}</td>
            <td>${_projDashEsc(r.client_name || '-')}</td>
          </tr>
        `).join('');
    }
  } catch (e) {
    console.error('[project-dashboard]', e);
    salesKpisEl.innerHTML = '<div class="table-empty" style="grid-column:1/-1"><i class="fas fa-exclamation-triangle"></i><p>매출 지표 조회 실패</p></div>';
    typeSummaryEl.innerHTML = '<div class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>유형 누적건수 조회 실패</p></div>';
    progressBodyEl.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>진행상태 조회 실패</p></td></tr>';
    taxKpisEl.innerHTML = '<div class="table-empty" style="grid-column:1/-1"><i class="fas fa-exclamation-triangle"></i><p>세금계산서 지표 조회 실패</p></div>';
    targetBodyEl.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>데이터 조회 실패</p></td></tr>';
    overdueBodyEl.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>데이터 조회 실패</p></tr>';
    receivableBodyEl.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>데이터 조회 실패</p></tr>';
  }
}

async function init_project_dashboard() {
  const monthEl = document.getElementById('project-dash-month');
  const refreshBtn = document.getElementById('project-dash-refresh-btn');
  if (monthEl && !monthEl.value) monthEl.value = _projDashMonthNow();
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = '1';
    refreshBtn.addEventListener('click', loadProjectDashboard);
  }
  if (monthEl && !monthEl.dataset.bound) {
    monthEl.dataset.bound = '1';
    monthEl.addEventListener('change', loadProjectDashboard);
  }
  await loadProjectDashboard();
}

window.init_project_dashboard = init_project_dashboard;
window.loadProjectDashboard = loadProjectDashboard;
