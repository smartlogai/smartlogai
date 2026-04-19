/* project-dashboard.js — 프로젝트 KPI 대시보드 */
'use strict';

function _projDashMonthNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _projDashKrw(v) {
  return `${Math.round(Number(v || 0)).toLocaleString('ko-KR')}원`;
}

function _projDashEsc(v) {
  if (typeof Utils !== 'undefined' && Utils.escHtml) return Utils.escHtml(v == null ? '' : String(v));
  return String(v == null ? '' : v);
}

function _projDashStatusBadge(st) {
  const s = String(st || '').trim();
  const map = {
    draft: ['임시', '#64748b', '#e2e8f0'],
    requested: ['발행요청', '#1d4ed8', '#dbeafe'],
    issued: ['발행완료', '#0f766e', '#ccfbf1'],
    partially_paid: ['부분입금', '#b45309', '#fef3c7'],
    paid: ['입금완료', '#047857', '#d1fae5'],
    overdue: ['입금지연', '#b91c1c', '#fee2e2'],
  };
  const hit = map[s] || [s || '-', '#475569', '#e2e8f0'];
  return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:56px;padding:2px 8px;border-radius:999px;background:${hit[2]};color:${hit[1]};font-size:11px;font-weight:700">${hit[0]}</span>`;
}

function _projDashInMonth(ym, dateStr) {
  const d = String(dateStr || '').trim();
  return !!d && d.slice(0, 7) === String(ym || '');
}

async function loadProjectDashboard() {
  const month = String(document.getElementById('project-dash-month')?.value || _projDashMonthNow());
  const kpiWrap = document.getElementById('project-dash-kpis');
  const overdueBody = document.getElementById('project-dash-overdue-body');
  const batchBody = document.getElementById('project-dash-batch-body');
  if (!kpiWrap || !overdueBody || !batchBody) return;

  kpiWrap.innerHTML = '<div class="table-empty" style="grid-column:1/-1"><i class="fas fa-spinner fa-spin"></i><p>프로젝트 KPI를 불러오는 중입니다.</p></div>';
  try {
    const [projects, batchesAll, invoicesAll, costsAll, tcLinesAll] = await Promise.all([
      API.listAllPages('registered_projects', { limit: 500, maxPages: 20, sort: 'updated_at' }),
      API.listAllPages('project_timecharge_batches', { limit: 700, maxPages: 20, sort: 'updated_at' }).catch(() => []),
      API.listAllPages('project_invoices', { limit: 700, maxPages: 20, sort: 'updated_at' }).catch(() => []),
      API.listAllPages('project_cost_items', { limit: 700, maxPages: 20, sort: 'updated_at' }).catch(() => []),
      API.listAllPages('project_timecharge_lines', { limit: 2000, maxPages: 40, sort: 'updated_at' }).catch(() => []),
    ]);

    const projRows = (projects || []).filter((r) => String(r.project_code || '').trim() !== '');
    const approvedProjects = projRows.filter((r) => String(r.registration_status || '').trim() === 'approved').length;

    const batches = (batchesAll || []).filter((r) => String(r.billing_month || '') === month);
    const invoices = (invoicesAll || []).filter((r) => String(r.billing_month || '') === month);
    const costs = (costsAll || []).filter((r) => _projDashInMonth(month, r.cost_date));
    const tcLines = (tcLinesAll || []).filter((r) => _projDashInMonth(month, r.work_date));

    const tcMinutes = tcLines.reduce((sum, r) => sum + Number(r.final_minutes || r.base_minutes || 0), 0);
    const tcHours = (tcMinutes / 60).toFixed(1);
    const billed = invoices.reduce((sum, r) => sum + Number(r.invoice_amount || 0), 0);
    const paid = invoices.reduce((sum, r) => sum + Number(r.paid_amount || 0), 0);
    const outstanding = invoices.reduce((sum, r) => sum + Number(r.outstanding_amount || 0), 0);
    const totalCost = costs.reduce((sum, r) => sum + Number(r.total_amount || r.amount || 0), 0);
    const margin = billed - totalCost;

    const nowDate = new Date().toISOString().slice(0, 10);
    const overdueRows = invoices.filter((r) => {
      const st = String(r.payment_status || '').trim();
      if (st === 'paid' || st === 'cancelled') return false;
      const due = String(r.due_date || '').trim();
      return due && due < nowDate;
    });

    kpiWrap.innerHTML = `
      <div class="pm-kpi-card"><div class="pm-kpi-label">승인 프로젝트</div><div class="pm-kpi-value">${approvedProjects}</div><div class="pm-kpi-sub">전체 ${projRows.length}건</div></div>
      <div class="pm-kpi-card"><div class="pm-kpi-label">${month} 배치</div><div class="pm-kpi-value">${batches.length}</div><div class="pm-kpi-sub">발행요청 ${batches.filter((b) => String(b.status) === 'requested').length}건</div></div>
      <div class="pm-kpi-card"><div class="pm-kpi-label">청구금액</div><div class="pm-kpi-value">${_projDashKrw(billed)}</div><div class="pm-kpi-sub">입금 ${_projDashKrw(paid)}</div></div>
      <div class="pm-kpi-card"><div class="pm-kpi-label">미수금</div><div class="pm-kpi-value">${_projDashKrw(outstanding)}</div><div class="pm-kpi-sub">입금지연 ${overdueRows.length}건</div></div>
      <div class="pm-kpi-card"><div class="pm-kpi-label">프로젝트 비용</div><div class="pm-kpi-value">${_projDashKrw(totalCost)}</div><div class="pm-kpi-sub">${month} 기준</div></div>
      <div class="pm-kpi-card"><div class="pm-kpi-label">마진/투입</div><div class="pm-kpi-value">${_projDashKrw(margin)}</div><div class="pm-kpi-sub">투입 ${tcHours}시간</div></div>
    `;

    if (!overdueRows.length) {
      overdueBody.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-check-circle"></i><p>입금예정일 초과 건이 없습니다.</p></td></tr>';
    } else {
      overdueBody.innerHTML = overdueRows.slice(0, 12).map((r, i) => `
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

    if (!batches.length) {
      batchBody.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-inbox"></i><p>해당 월 청구 배치가 없습니다.</p></td></tr>';
    } else {
      batchBody.innerHTML = batches.slice(0, 12).map((r, i) => `
        <tr>
          <td style="text-align:center">${i + 1}</td>
          <td>${_projDashEsc(r.project_code || '-')}</td>
          <td>${_projDashEsc(r.billing_month || '-')}</td>
          <td style="text-align:center">${_projDashStatusBadge(r.status)}</td>
          <td style="text-align:right">${_projDashKrw(r.total_amount || 0)}</td>
          <td style="text-align:right">${_projDashKrw(r.outstanding_amount || 0)}</td>
          <td>${_projDashEsc(r.client_name || '-')}</td>
        </tr>
      `).join('');
    }
  } catch (e) {
    console.error(e);
    kpiWrap.innerHTML = '<div class="table-empty" style="grid-column:1/-1"><i class="fas fa-exclamation-triangle"></i><p>프로젝트 KPI 조회 실패</p></div>';
    overdueBody.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>데이터 조회 실패</p></td></tr>';
    batchBody.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>데이터 조회 실패</p></td></tr>';
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
