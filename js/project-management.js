/* project-management.js — 프로젝트관리 통합(All-in MVP) */
'use strict';

const PM_STATE = {
  initialized: false,
  currentTab: 'progress',
  pageMode: 'register',
  projects: [],
  projectByCode: {},
  users: [],
  usersById: {},
  currentBatch: null,
  currentLines: [],
  invoiceDetailProjectCode: '',
  invoiceDetailProjectCodes: [],
  ntsAutoRunAt: 0,
  ntsAutoRunning: false,
};
const PM_LIFECYCLE = {
  contract_completed: { label: '계약완료', color: '#334155', bg: '#e2e8f0' },
  in_progress: { label: '수행중', color: '#1d4ed8', bg: '#dbeafe' },
  work_closed: { label: '업무종료', color: '#92400e', bg: '#fef3c7' },
  settled_done: { label: '정산완료', color: '#047857', bg: '#d1fae5' },
};
const PM_NTS_MODES = Object.freeze({
  QUEUE: 'queue',
  LIVE: 'nts-live',
});
const PM_NTS_DEFAULT_MODE = (() => {
  const raw = String(window.__PM_NTS_MODE__ || PM_NTS_MODES.QUEUE).trim();
  return Object.values(PM_NTS_MODES).includes(raw) ? raw : PM_NTS_MODES.QUEUE;
})();

function _pmNowMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _pmEsc(v) {
  if (typeof Utils !== 'undefined' && Utils.escHtml) return Utils.escHtml(v == null ? '' : String(v));
  return String(v == null ? '' : v);
}

function _pmKrw(n) {
  const v = Number(n || 0);
  return `${Math.round(v).toLocaleString('ko-KR')}원`;
}

function _pmTsToDateText(ts) {
  const n = Number(ts || 0);
  if (!n) return '';
  const d = new Date(n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _pmDateToYm(dateStr) {
  const s = String(dateStr || '').trim();
  if (!s) return '';
  return s.slice(0, 7);
}

function _pmDateInMonth(dateStr, ym) {
  return _pmDateToYm(dateStr) === String(ym || '');
}

function _pmAddMonths(dateStr, months) {
  const s = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [yy, mm, dd] = s.split('-').map(Number);
  const d = new Date(yy, mm - 1, dd);
  if (Number.isNaN(d.getTime())) return '';
  d.setMonth(d.getMonth() + Number(months || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _pmSessionIds(session) {
  const ids = new Set();
  const id1 = String(session && session.id || '').trim();
  const id2 = String(session && session.user_id || '').trim();
  if (id1) ids.add(id1);
  if (id2) ids.add(id2);
  return ids;
}

function _pmCanViewAllProjects(session) {
  return !!(session && (Auth.isAdmin(session) || Auth.isTopMgr(session) || _pmIsFinanceUser(session)));
}

function _pmIsProjectInScope(session, row) {
  if (!row) return false;
  if (_pmCanViewAllProjects(session)) return true;
  const myIds = _pmSessionIds(session);
  if (!myIds.size) return false;
  const refs = [
    row.created_by,
    row.first_approved_by,
    row.second_approved_by,
    row.final_approved_by,
  ].map((v) => String(v || '').trim()).filter(Boolean);
  return refs.some((id) => myIds.has(id));
}

function _pmFilterProjectsByScope(rows, session) {
  const list = Array.isArray(rows) ? rows : [];
  if (_pmCanViewAllProjects(session)) return list;
  return list.filter((r) => _pmIsProjectInScope(session, r));
}

function _pmHasProjectAccess(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code) return false;
  return !!PM_STATE.projectByCode[code];
}

function _pmHasFinanceKeyword(v) {
  return String(v || '').includes('경영지원');
}

function _pmIsFinanceUser(session) {
  if (!session) return false;
  if (Auth.isAdmin(session) || Auth.isTopMgr(session)) return true;
  return (
    _pmHasFinanceKeyword(session.dept_name) ||
    _pmHasFinanceKeyword(session.hq_name) ||
    _pmHasFinanceKeyword(session.cs_team_name) ||
    _pmHasFinanceKeyword(session.team_name)
  );
}

function _pmCanIssueInvoice(session) {
  return _pmIsFinanceUser(session);
}

function _pmCanRequestInvoice(session) {
  return !!(session && (
    Auth.canApprove1st(session) ||
    Auth.isDirector(session) ||
    Auth.isTopMgr(session) ||
    Auth.isAdmin(session) ||
    _pmIsFinanceUser(session)
  ));
}

function _pmCanRequestInvoiceForProject(session, projectCode) {
  if (!session) return false;
  if (_pmCanIssueInvoice(session) || _pmCanRequestInvoice(session)) return true;
  const project = PM_STATE.projectByCode[String(projectCode || '').trim()] || {};
  const myIds = _pmSessionIds(session);
  return myIds.has(String(project.cpm_user_id || '').trim());
}

function _pmFinanceUsers() {
  const list = Array.isArray(PM_STATE.users) ? PM_STATE.users : [];
  return list.filter((u) =>
    _pmHasFinanceKeyword(u.dept_name) ||
    _pmHasFinanceKeyword(u.hq_name) ||
    _pmHasFinanceKeyword(u.cs_team_name) ||
    _pmHasFinanceKeyword(u.team_name)
  );
}

function _pmCollectBillingMilestones(schedule) {
  let src = schedule;
  if (!src) return [];
  if (typeof src === 'string') {
    try { src = JSON.parse(src); } catch (_) { src = null; }
  }
  if (!src || typeof src !== 'object') return [];
  const out = [];
  const pushOne = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    const due = String(obj.due_date || obj.expected_date || '').trim();
    const amount = Number(obj.amount || obj.invoice_amount || 0);
    if (due) out.push({ due_date: due, amount: Number.isFinite(amount) ? amount : 0 });
  };
  Object.keys(src).forEach((k) => {
    const v = src[k];
    if (Array.isArray(v)) v.forEach(pushOne);
    else pushOne(v);
  });
  return out
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x.due_date || '')))
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
}

function _pmReadInvoiceRequestForm(projectCode, billingMonth, batch) {
  const project = PM_STATE.projectByCode[String(projectCode || '').trim()] || {};
  const milestones = _pmCollectBillingMilestones(project.billing_schedule);
  const today = _pmTodayDateText();
  const nextMilestone = milestones.find((m) => String(m.due_date) >= today) || milestones[0] || null;
  const plannedIssue = String(document.getElementById('pm-inv-planned-issue-date')?.value || '').trim() || String(nextMilestone?.due_date || '');
  const expectedPayInput = String(document.getElementById('pm-inv-expected-pay-date')?.value || '').trim();
  const expectedPay = expectedPayInput || _pmAddMonths(plannedIssue, 1) || plannedIssue;
  const recipientEmail = String(document.getElementById('pm-inv-recipient-email')?.value || '').trim().toLowerCase();
  const recipientNameRaw = String(document.getElementById('pm-inv-recipient-name')?.value || '').trim();
  const [recipientName, recipientPhone] = recipientNameRaw.split('/').map((v) => String(v || '').trim());
  const buyerCompany = String(document.getElementById('pm-inv-buyer-company')?.value || '').trim() || String(project.client_name || '');
  const buyerBizNoRaw = String(document.getElementById('pm-inv-buyer-bizno')?.value || '').trim();
  const buyerBizDigits = buyerBizNoRaw.replace(/[^\d]/g, '').slice(0, 10);
  const buyerBizNo = buyerBizDigits.length === 10
    ? `${buyerBizDigits.slice(0, 3)}-${buyerBizDigits.slice(3, 5)}-${buyerBizDigits.slice(5)}`
    : buyerBizNoRaw;
  const recipientPhoneNorm = String(recipientPhone || '').replace(/[^\d-]/g, '');
  const itemName = String(document.getElementById('pm-inv-item-name')?.value || '').trim() || String(project.project_name || '');
  const legalNote = String(document.getElementById('pm-inv-legal-note')?.value || '').trim();
  const invoiceAmount = Number(batch?.total_amount || nextMilestone?.amount || 0);
  return {
    planned_issue_date: plannedIssue || null,
    expected_payment_date: expectedPay || null,
    recipient_email: recipientEmail,
    recipient_name: recipientName || recipientNameRaw,
    recipient_phone: recipientPhoneNorm || '',
    buyer_company_name: buyerCompany,
    buyer_business_no: buyerBizNo,
    item_name: itemName,
    legal_note: legalNote,
    invoice_amount: invoiceAmount > 0 ? invoiceAmount : 0,
    request_payload: {
      project_code: projectCode,
      billing_month: billingMonth,
      buyer_company_name: buyerCompany,
      buyer_business_no: buyerBizNo,
      recipient_email: recipientEmail,
      recipient_name: recipientName || recipientNameRaw,
      recipient_phone: recipientPhoneNorm || '',
      item_name: itemName,
      planned_issue_date: plannedIssue || null,
      expected_payment_date: expectedPay || null,
      legal_note: legalNote,
    },
  };
}

function _pmValidateInvoiceForm(form) {
  const miss = [];
  if (!String(form.buyer_company_name || '').trim()) miss.push('공급받는자 상호');
  if (!String(form.buyer_business_no || '').trim()) miss.push('공급받는자 사업자번호');
  if (!String(form.recipient_email || '').trim()) miss.push('수신자 이메일');
  if (!String(form.item_name || '').trim()) miss.push('품목(용역명)');
  if (!String(form.planned_issue_date || '').trim()) miss.push('예상청구일정');
  if (!String(form.expected_payment_date || '').trim()) miss.push('예상입금일정');
  if (Number(form.invoice_amount || 0) <= 0) miss.push('청구금액');
  if (String(form.recipient_email || '').trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(form.recipient_email || '').trim())) {
    miss.push('수신자 이메일 형식');
  }
  const bizDigits = String(form.buyer_business_no || '').replace(/[^\d]/g, '');
  if (bizDigits && bizDigits.length !== 10) miss.push('공급받는자 사업자번호 형식');
  if (String(form.expected_payment_date || '').trim() && String(form.planned_issue_date || '').trim()) {
    if (String(form.expected_payment_date) < String(form.planned_issue_date)) {
      miss.push('예상입금일정(예상청구일정 이후)');
    }
  }
  return miss;
}

function _pmInvoiceRowFormLike(row) {
  return {
    buyer_company_name: row.buyer_company_name,
    buyer_business_no: row.buyer_business_no,
    recipient_email: row.recipient_email,
    item_name: row.item_name,
    planned_issue_date: row.planned_issue_date,
    expected_payment_date: row.expected_payment_date || row.due_date,
    invoice_amount: row.invoice_amount,
  };
}

function _pmInvoiceQualityIssues(row) {
  const issues = _pmValidateInvoiceForm(_pmInvoiceRowFormLike(row));
  const status = String(row._derived_status || row.payment_status || '').trim();
  const invNo = String(row.invoice_no || '').trim();
  const issueDate = String(row.issue_date || '').trim();
  const paid = Number(row.paid_amount || 0);
  const outstanding = Number(row.outstanding_amount || 0);
  if (['issued', 'partially_paid', 'paid'].includes(status) && !invNo) issues.push('세금계산서번호 누락');
  if (['issued', 'partially_paid', 'paid'].includes(status) && !issueDate) issues.push('발행일 누락');
  if (status === 'paid' && outstanding > 0) issues.push('입금완료 상태인데 미수금 존재');
  if (status === 'paid' && paid <= 0) issues.push('입금완료 상태인데 입금금액 0');
  return [...new Set(issues)];
}

function _pmRenderInvoiceQualitySummary(rows) {
  const qEl = document.getElementById('pm-inv-quality-summary');
  if (!qEl) return;
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    qEl.textContent = '정합성 이슈 0건';
    return;
  }
  const issueRows = list.filter((r) => _pmInvoiceQualityIssues(r).length > 0);
  qEl.textContent = `정합성 이슈 ${issueRows.length}건 / 전체 ${list.length}건`;
}

async function pmRunInvoiceDataQualityCheck() {
  try {
    const rows = await API.listAllPages('project_invoices', { limit: 1000, maxPages: 40, sort: 'updated_at' }).catch(() => []);
    const allowedCodes = new Set((PM_STATE.projects || []).map((p) => String(p.project_code || '').trim()).filter(Boolean));
    const scoped = (rows || []).filter((r) => allowedCodes.has(String(r.project_code || '').trim()));
    const issueRows = scoped.map((r) => ({ row: r, issues: _pmInvoiceQualityIssues(r) })).filter((x) => x.issues.length > 0);
    _pmRenderInvoiceQualitySummary(scoped);
    if (!issueRows.length) {
      Toast.success('정합성 점검 완료: 이슈 0건');
      return;
    }
    const sample = issueRows.slice(0, 5).map((x) => `${x.row.project_code}(${x.row.billing_month}): ${x.issues.join(', ')}`);
    Toast.warning(`정합성 이슈 ${issueRows.length}건\n${sample.join('\n')}`);
  } catch (e) {
    console.error(e);
    Toast.error('정합성 점검 실패: ' + (e.message || ''));
  }
}

async function _pmWriteNtsIssueLog(entry) {
  try {
    await API.create('nts_issue_logs', {
      invoice_id: String(entry.invoice_id || ''),
      project_code: String(entry.project_code || ''),
      issue_mode: String(entry.issue_mode || ''),
      issue_status: String(entry.issue_status || ''),
      attempt_no: Number(entry.attempt_no || 1),
      request_payload: entry.request_payload || {},
      response_payload: entry.response_payload || {},
      error_code: String(entry.error_code || ''),
      error_message: String(entry.error_message || ''),
      requested_by: String(entry.requested_by || ''),
      requested_by_name: String(entry.requested_by_name || ''),
      requested_at: Number(entry.requested_at || Date.now()),
      processed_at: Number(entry.processed_at || Date.now()),
    });
  } catch (e) {
    console.warn('[pm] nts log write failed', e);
  }
}

function _pmPrimeInvoiceRequestForm() {
  const projectCode = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
  if (!projectCode || !_pmHasProjectAccess(projectCode)) return;
  const project = PM_STATE.projectByCode[projectCode] || {};
  const milestones = _pmCollectBillingMilestones(project.billing_schedule);
  const today = _pmTodayDateText();
  const nextMilestone = milestones.find((m) => String(m.due_date) >= today) || milestones[0] || null;
  const plannedEl = document.getElementById('pm-inv-planned-issue-date');
  const payEl = document.getElementById('pm-inv-expected-pay-date');
  const buyerEl = document.getElementById('pm-inv-buyer-company');
  const itemEl = document.getElementById('pm-inv-item-name');
  if (plannedEl && !plannedEl.value && nextMilestone?.due_date) plannedEl.value = nextMilestone.due_date;
  if (payEl && !payEl.value && nextMilestone?.due_date) payEl.value = _pmAddMonths(nextMilestone.due_date, 1) || nextMilestone.due_date;
  if (buyerEl && !buyerEl.value) buyerEl.value = String(project.client_name || '');
  if (itemEl && !itemEl.value) itemEl.value = String(project.project_name || '');
}

function pmCloseInvoiceProjectDetail() {
  PM_STATE.invoiceDetailProjectCode = '';
  const wrap = document.getElementById('pm-inv-detail-wrap');
  const backdrop = document.getElementById('pm-inv-detail-backdrop');
  if (wrap) wrap.style.display = 'none';
  if (wrap) wrap.classList.remove('pm-inv-detail-screen');
  if (backdrop) backdrop.style.display = 'none';
  document.body.style.overflow = '';
}

function _pmInvoiceDetailNavIndex() {
  const codes = Array.isArray(PM_STATE.invoiceDetailProjectCodes) ? PM_STATE.invoiceDetailProjectCodes : [];
  const curr = String(PM_STATE.invoiceDetailProjectCode || '').trim();
  if (!curr) return -1;
  return codes.findIndex((x) => String(x || '').trim() === curr);
}

function _pmSyncInvoiceDetailNavButtons() {
  const prevBtn = document.getElementById('pm-inv-detail-prev-btn');
  const nextBtn = document.getElementById('pm-inv-detail-next-btn');
  const idx = _pmInvoiceDetailNavIndex();
  const len = (PM_STATE.invoiceDetailProjectCodes || []).length;
  if (prevBtn) prevBtn.disabled = !(idx > 0);
  if (nextBtn) nextBtn.disabled = !(idx >= 0 && idx < len - 1);
}

async function pmOpenPrevInvoiceProjectDetail() {
  const idx = _pmInvoiceDetailNavIndex();
  if (idx <= 0) return;
  const prevCode = String(PM_STATE.invoiceDetailProjectCodes[idx - 1] || '').trim();
  if (!prevCode) return;
  await pmOpenInvoiceProjectDetail(prevCode);
}

async function pmOpenNextInvoiceProjectDetail() {
  const idx = _pmInvoiceDetailNavIndex();
  const list = PM_STATE.invoiceDetailProjectCodes || [];
  if (idx < 0 || idx >= list.length - 1) return;
  const nextCode = String(list[idx + 1] || '').trim();
  if (!nextCode) return;
  await pmOpenInvoiceProjectDetail(nextCode);
}

function _pmBillingPlanLabel(key) {
  const k = String(key || '').toLowerCase();
  if (k.includes('down')) return '착수금';
  if (k.includes('interim')) return '중도금';
  if (k.includes('final')) return '잔금';
  if (k.includes('add')) return '추가청구';
  if (k.includes('success')) return '성과보수';
  return key || '청구';
}

function _pmRenderInvoicePlanTable(project) {
  const body = document.getElementById('pm-inv-plan-body');
  if (!body) return;
  let src = project && project.billing_schedule;
  if (typeof src === 'string') {
    try { src = JSON.parse(src); } catch (_) { src = null; }
  }
  const rows = [];
  if (src && typeof src === 'object') {
    Object.keys(src).forEach((k) => {
      const v = src[k];
      const pushOne = (o) => {
        if (!o || typeof o !== 'object') return;
        const due = String(o.due_date || o.expected_date || '').trim();
        const amt = Number(o.amount || o.invoice_amount || 0);
        if (!due && !amt) return;
        rows.push({ kind: _pmBillingPlanLabel(k), due, amount: amt });
      };
      if (Array.isArray(v)) v.forEach(pushOne);
      else pushOne(v);
    });
  }
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4" class="table-empty"><i class="fas fa-calendar-check"></i><p>청구일정 정보가 없습니다.</p></td></tr>';
    return;
  }
  body.innerHTML = rows.map((r, i) => `<tr>
    <td style="text-align:center">${i + 1}</td>
    <td>${_pmEsc(r.kind || '-')}</td>
    <td>${_pmEsc(r.due || '-')}</td>
    <td style="text-align:right">${_pmKrw(r.amount || 0)}</td>
  </tr>`).join('');
}

function _pmInvoiceRowSnapshot(tr) {
  if (!tr) return '';
  const getVal = (key) => String(tr.querySelector(`[data-f="${key}"]`)?.value || '').trim();
  return JSON.stringify({
    issue_date: getVal('issue_date'),
    status: getVal('status'),
    paid_date: getVal('paid_date'),
    paid: getVal('paid'),
    inv_no: getVal('inv_no'),
  });
}

function _pmRefreshInvoiceRowSaveState(tr) {
  if (!tr) return;
  const btn = tr.querySelector('.pm-inv-row-save-btn');
  if (!btn) return;
  const original = String(tr.dataset.origSnapshot || '');
  const current = _pmInvoiceRowSnapshot(tr);
  const changed = !!original && original !== current;
  btn.disabled = !changed;
  btn.classList.toggle('btn-primary', changed);
  btn.classList.toggle('btn-outline', !changed);
}

function _pmBindInvoiceDetailRowState() {
  const body = document.getElementById('pm-inv-detail-body');
  if (!body) return;
  const rows = body.querySelectorAll('tr[data-invoice-id]');
  rows.forEach((tr) => {
    tr.dataset.origSnapshot = _pmInvoiceRowSnapshot(tr);
    _pmRefreshInvoiceRowSaveState(tr);
    tr.querySelectorAll('[data-f]').forEach((el) => {
      const evt = (el.tagName === 'SELECT') ? 'change' : 'input';
      el.addEventListener(evt, () => _pmRefreshInvoiceRowSaveState(tr));
      if (evt !== 'change') el.addEventListener('change', () => _pmRefreshInvoiceRowSaveState(tr));
    });
  });
}

async function _pmLoadInvoiceProjectDetail(projectCode) {
  const code = String(projectCode || '').trim();
  const body = document.getElementById('pm-inv-detail-body');
  const title = document.getElementById('pm-inv-detail-title');
  const summary = document.getElementById('pm-inv-detail-summary');
  if (!code || !body) return;
  const session = getSession ? getSession() : null;
  const canIssue = _pmCanIssueInvoice(session);
  const settledBtn = document.getElementById('pm-inv-mark-settled-btn');
  const qualityBtn = document.getElementById('pm-inv-quality-btn');
  if (settledBtn) {
    settledBtn.style.display = canIssue ? '' : 'none';
    settledBtn.disabled = true;
    settledBtn.dataset.projectCode = code;
    settledBtn.title = canIssue ? '프로젝트 전체 입금완료 처리' : '';
  }
  if (qualityBtn) qualityBtn.style.display = canIssue ? '' : 'none';
  const project = PM_STATE.projectByCode[code] || {};
  if (title) title.textContent = `${_pmProjectLabel(project)} · 세금계산서 상세`;
  _pmRenderInvoicePlanTable(project);
  const milestones = _pmCollectBillingMilestones(project.billing_schedule);
  const totalPlanned = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
  if (summary) summary.textContent = `청구일정 ${milestones.length}건 · 예정합계 ${_pmKrw(totalPlanned)} · 고객사 ${project.client_name || '-'}`;
  _pmPrimeInvoiceRequestForm();
  try {
    let rows = await API.listAllPages('project_invoices', { limit: 500, maxPages: 20, sort: 'updated_at' }).catch(() => []);
    rows = rows.filter((r) => String(r.project_code || '').trim() === code);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-file-invoice"></i><p>상세 발행 내역이 없습니다.</p></td></tr>';
      return;
    }
    const nowDate = _pmTodayDateText();
    rows = rows.map((r) => {
      const due = String(r.expected_payment_date || r.due_date || '').trim();
      const derived = (due && due < nowDate && !['paid', 'cancelled'].includes(String(r.payment_status || '')))
        ? 'overdue'
        : String(r.payment_status || '');
      return { ...r, _derived_status: derived };
    });
    const totalOutstanding = rows.reduce((s, r) => s + Math.max(0, Number(r.outstanding_amount || 0)), 0);
    if (settledBtn && canIssue) {
      settledBtn.disabled = totalOutstanding > 0;
      settledBtn.title = totalOutstanding > 0 ? `미수금 ${_pmKrw(totalOutstanding)}이 남아 있어 처리할 수 없습니다.` : '미수금 0원 확인: 전체 입금완료 처리';
    }
    rows.sort((a, b) => Number(b.updated_at || b.created_at || 0) - Number(a.updated_at || a.created_at || 0));
    body.innerHTML = rows.map((r, i) => {
      const issueDisabled = canIssue ? '' : 'disabled';
      const issueDate = String(r.issue_date || '').trim();
      const paidDate = String(r.paid_date || '').trim() || _pmTsToDateText(r.paid_at);
      const confirmer = String(r.payment_confirmed_by_name || '').trim();
      const out = Math.max(0, Number(r.outstanding_amount || 0));
      const invNo = String(r.invoice_no || '').trim();
      const actionTitle = `세금계산서번호: ${invNo || '-'} | 입금일자: ${paidDate || '-'} | 확인자: ${confirmer || '-'}`;
      return `<tr
        data-invoice-id="${_pmEsc(r.id)}"
        data-project-code="${_pmEsc(r.project_code || code)}"
        data-invoice-amount="${Number(r.invoice_amount || 0)}"
        data-planned-issue-date="${_pmEsc(r.planned_issue_date || '')}"
        data-inv-no="${_pmEsc(r.invoice_no || '')}"
        data-issue-date="${_pmEsc(r.issue_date || '')}"
        data-due-date="${_pmEsc(r.expected_payment_date || r.due_date || '')}"
        data-recipient-email="${_pmEsc(r.recipient_email || '')}"
        data-note="${_pmEsc(r.payment_note || r.legal_note || '')}"
        data-paid-date="${_pmEsc(paidDate || '')}"
        data-payment-confirmed-by-name="${_pmEsc(confirmer || '')}"
      >
        <td style="text-align:center">${i + 1}</td>
        <td class="pm-inv-history-issued"><input type="date" data-f="issue_date" value="${_pmEsc(issueDate || '')}" ${issueDisabled} class="form-control" style="min-height:28px;font-size:12px;text-align:center"></td>
        <td style="text-align:right">${_pmKrw(r.invoice_amount || 0)}</td>
        <td class="pm-inv-history-status">
          <select data-f="status" ${issueDisabled} class="form-control" style="min-height:28px;font-size:12px">
            <option value="requested" ${r._derived_status === 'requested' ? 'selected' : ''}>요청</option>
            <option value="issued" ${r._derived_status === 'issued' ? 'selected' : ''}>발행</option>
            <option value="partially_paid" ${r._derived_status === 'partially_paid' ? 'selected' : ''}>부분입금</option>
            <option value="paid" ${r._derived_status === 'paid' ? 'selected' : ''}>입금완료</option>
            <option value="overdue" ${r._derived_status === 'overdue' ? 'selected' : ''}>입금지연</option>
          </select>
        </td>
        <td class="pm-inv-history-paid"><input type="number" data-f="paid" value="${Math.round(Number(r.paid_amount || 0))}" min="0" step="1000" ${issueDisabled} class="form-control" style="min-height:28px;font-size:12px;text-align:right"></td>
        <td class="pm-inv-history-outstanding">${_pmKrw(out)}</td>
        <td class="pm-inv-detail-actions" title="${_pmEsc(actionTitle)}">
          <div class="pm-inv-detail-actions-row">
            <button type="button" class="btn btn-sm btn-outline pm-inv-row-save-btn pm-inv-icon-btn" onclick="pmSaveInvoiceRow('${_pmEsc(r.id)}')" title="변경 저장" aria-label="변경 저장">
              <i class="fas fa-floppy-disk"></i>
            </button>
            ${canIssue ? `<button type="button" class="btn btn-sm btn-outline pm-inv-icon-btn" onclick="pmSendInvoiceToNts('${_pmEsc(r.id)}')" title="국세청 전송" aria-label="국세청 전송"><i class="fas fa-paper-plane"></i></button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
    _pmBindInvoiceDetailRowState();
  } catch (e) {
    console.error(e);
    body.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>상세 조회 실패</p></td></tr>';
  }
}

async function pmOpenInvoiceProjectDetail(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code || !_pmHasProjectAccess(code)) return;
  PM_STATE.invoiceDetailProjectCode = code;
  const sel = document.getElementById('pm-inv-project');
  if (sel && [...sel.options].some((o) => o.value === code)) sel.value = code;
  const wrap = document.getElementById('pm-inv-detail-wrap');
  const backdrop = document.getElementById('pm-inv-detail-backdrop');
  if (wrap) wrap.style.display = '';
  if (wrap) wrap.classList.add('pm-inv-detail-screen');
  if (backdrop) backdrop.style.display = 'block';
  document.body.style.overflow = 'hidden';
  if (wrap) {
    wrap.scrollTop = 0;
    wrap.scrollLeft = 0;
  }
  await _pmLoadInvoiceProjectDetail(code);
  _pmSyncInvoiceDetailNavButtons();
}

function _pmTodayDateText() {
  return new Date().toISOString().slice(0, 10);
}

function _pmApplyProgressPreset(kind) {
  const fromEl = document.getElementById('pm-progress-date-from');
  const toEl = document.getElementById('pm-progress-date-to');
  if (!fromEl || !toEl) return;
  const today = new Date();
  const toDateText = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let from = '';
  let to = '';
  if (kind === 'today') {
    from = to = toDateText(today);
  } else if (kind === 'yesterday') {
    const y = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    from = to = toDateText(y);
  } else if (kind === 'week') {
    const w = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
    from = toDateText(w);
    to = toDateText(today);
  } else if (kind === 'month') {
    const m = new Date(today.getFullYear(), today.getMonth(), 1);
    from = toDateText(m);
    to = toDateText(today);
  }
  fromEl.value = from;
  toEl.value = to;
  _pmSyncProgressRangeButtons(kind);
}

function _pmSyncProgressRangeButtons(active) {
  document.querySelectorAll('.pm-progress-quick-range-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.pmProgressRange === active);
  });
}

function _pmLifecycleBadge(code) {
  const meta = PM_LIFECYCLE[String(code || '')] || PM_LIFECYCLE.contract_completed;
  return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:64px;padding:2px 8px;border-radius:999px;background:${meta.bg};color:${meta.color};font-size:11px;font-weight:700">${meta.label}</span>`;
}

function _pmStatusBadge(txt, color, bg) {
  return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:64px;padding:2px 8px;border-radius:999px;background:${bg};color:${color};font-size:11px;font-weight:700">${txt}</span>`;
}

function _pmBuildProgressFilters(rows) {
  const uniq = (arr) => [...new Set(arr.filter(Boolean).map((v) => String(v).trim()))].sort((a, b) => a.localeCompare(b, 'ko'));
  const deptEl = document.getElementById('pm-progress-filter-dept');
  const hqEl = document.getElementById('pm-progress-filter-hq');
  const csEl = document.getElementById('pm-progress-filter-csteam');
  const clientEl = document.getElementById('pm-progress-filter-client');
  const pmEl = document.getElementById('pm-progress-filter-pm');
  const prev = {
    dept: deptEl?.value || '',
    hq: hqEl?.value || '',
    cs: csEl?.value || '',
    client: clientEl?.value || '',
    pm: pmEl?.value || '',
  };
  const depts = uniq(rows.map((r) => r._dept_name));
  const hqs = uniq(rows.map((r) => r._hq_name));
  const css = uniq(rows.map((r) => r._cs_team_name));
  const clients = uniq(rows.map((r) => r.client_name));
  const pms = uniq(rows.map((r) => r.cpm_user_name));
  if (deptEl) {
    deptEl.innerHTML = '<option value="">사업부 전체</option>' + depts.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
    if (prev.dept && [...deptEl.options].some((o) => o.value === prev.dept)) deptEl.value = prev.dept;
  }
  if (hqEl) {
    hqEl.innerHTML = '<option value="">본부 전체</option>' + hqs.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
    if (prev.hq && [...hqEl.options].some((o) => o.value === prev.hq)) hqEl.value = prev.hq;
  }
  if (csEl) {
    csEl.innerHTML = '<option value="">고객지원팀 전체</option>' + css.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
    if (prev.cs && [...csEl.options].some((o) => o.value === prev.cs)) csEl.value = prev.cs;
  }
  if (clientEl) {
    clientEl.innerHTML = '<option value="">고객사 전체</option>' + clients.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
    if (prev.client && [...clientEl.options].some((o) => o.value === prev.client)) clientEl.value = prev.client;
  }
  if (pmEl) {
    pmEl.innerHTML = '<option value="">PM 전체</option>' + pms.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
    if (prev.pm && [...pmEl.options].some((o) => o.value === prev.pm)) pmEl.value = prev.pm;
  }
}

function _pmFillInvoiceListFilters() {
  const elC = document.getElementById('pm-inv-filter-client');
  const elP = document.getElementById('pm-inv-filter-pm');
  const elT = document.getElementById('pm-inv-filter-team');
  if (!elC || !elP || !elT) return;
  const uniq = (arr) => [...new Set(arr.filter(Boolean).map((v) => String(v).trim()))].sort((a, b) => a.localeCompare(b, 'ko'));
  const prev = { c: elC.value || '', p: elP.value || '', t: elT.value || '' };
  const projects = PM_STATE.projects || [];
  const clients = uniq(projects.map((r) => r.client_name));
  const pmNames = uniq(projects.map((r) => _pmInvoicePmAndTeam(r).pmName).filter((x) => x && x !== '-'));
  const teams = uniq(projects.map((r) => _pmInvoicePmAndTeam(r).teamLabel).filter((x) => x && x !== '-'));
  elC.innerHTML = '<option value="">고객사 전체</option>' + clients.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
  elP.innerHTML = '<option value="">PM 전체</option>' + pmNames.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
  elT.innerHTML = '<option value="">소속 전체</option>' + teams.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
  if (prev.c && [...elC.options].some((o) => o.value === prev.c)) elC.value = prev.c;
  if (prev.p && [...elP.options].some((o) => o.value === prev.p)) elP.value = prev.p;
  if (prev.t && [...elT.options].some((o) => o.value === prev.t)) elT.value = prev.t;
}

function _pmEntryToWorkDate(entry) {
  const ts = Number(entry && entry.work_start_at || 0);
  if (!ts) return '';
  return _pmTsToDateText(ts);
}

async function _pmLoadProjects() {
  const session = getSession ? getSession() : null;
  let rows = [];
  try {
    rows = await API.listAllPages('registered_projects', { limit: 400, maxPages: 20, sort: 'updated_at' });
  } catch (e) {
    console.warn('[pm] registered_projects load failed', e);
    rows = [];
  }
  PM_STATE.projects = _pmFilterProjectsByScope(rows, session)
    .filter((r) => String(r.project_code || '').trim() !== '');
  PM_STATE.projectByCode = {};
  PM_STATE.projects.forEach((r) => {
    const code = String(r.project_code || '').trim();
    if (code && !PM_STATE.projectByCode[code]) PM_STATE.projectByCode[code] = r;
  });
}

async function _pmLoadUsers() {
  try {
    PM_STATE.users = await Master.users();
  } catch (_) {
    PM_STATE.users = [];
  }
  PM_STATE.usersById = {};
  PM_STATE.users.forEach((u) => {
    PM_STATE.usersById[String(u.id)] = u;
  });
}

function _pmProjectLabel(p) {
  const code = String(p && p.project_code || '').trim();
  const name = String(p && p.project_name || '').trim();
  if (code && name) return `${code} · ${name}`;
  return code || name || '-';
}

/** 발행현황 목록: 프로젝트 CPM + PM 사용자 프로필 기준 소속팀(경영지원팀 등) */
function _pmInvoicePmAndTeam(project) {
  const p = project || {};
  let pmName = String(p.cpm_user_name || '').trim();
  const uid = String(p.cpm_user_id || '').trim();
  const u = (uid && PM_STATE.usersById) ? (PM_STATE.usersById[uid] || {}) : {};
  if (!pmName && uid) pmName = String(u.name || '').trim();
  if (!pmName) pmName = '-';
  const team = String(u.cs_team_name || u.team_name || '').trim();
  const hq = String(u.hq_name || '').trim();
  const dept = String(u.dept_name || '').trim();
  let teamLabel = team;
  if (!teamLabel && (hq || dept)) teamLabel = [hq, dept].filter(Boolean).join(' / ');
  if (!teamLabel) teamLabel = '-';
  return { pmName, teamLabel };
}

function _pmCurrentPageMode() {
  const activePage = document.querySelector('.nav-item.active')?.dataset.page || '';
  return activePage === 'project-management' ? 'manage' : 'register';
}

function applyProjectPageMode(mode) {
  const m = mode === 'manage' ? 'manage' : 'register';
  PM_STATE.pageMode = m;
  const tabs = document.getElementById('pm-tabs');
  const introCard = document.getElementById('pm-progress-intro-card');
  const progressPanel = document.getElementById('pm-panel-progress');
  const listWrap = document.getElementById('proj-reg-list');
  const formWrap = document.getElementById('proj-reg-form');
  if (tabs) tabs.style.display = (m === 'manage' ? '' : 'none');
  if (introCard) introCard.style.display = (m === 'manage' ? '' : 'none');
  ['invoice', 'cost', 'timecharge', 'contract'].forEach((k) => {
    const el = document.getElementById(`pm-panel-${k}`);
    if (el) el.style.display = 'none';
  });
  if (progressPanel) progressPanel.style.display = '';
  if (m === 'manage') {
    if (listWrap) listWrap.style.display = 'none';
    if (formWrap) formWrap.style.display = 'none';
  } else {
    if (formWrap && formWrap.style.display !== 'none') {
      if (listWrap) listWrap.style.display = 'none';
    } else {
      if (listWrap) listWrap.style.display = '';
      if (formWrap) formWrap.style.display = 'none';
    }
  }
}

function _pmFillProjectSelect(id, includeAllLabel) {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = el.value;
  el.innerHTML = includeAllLabel ? `<option value="">${includeAllLabel}</option>` : '<option value="">선택</option>';
  PM_STATE.projects
    .slice()
    .sort((a, b) => String(a.project_code || '').localeCompare(String(b.project_code || '')))
    .forEach((p) => {
      const code = String(p.project_code || '').trim();
      if (!code) return;
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = _pmProjectLabel(p);
      el.appendChild(opt);
    });
  if (prev && [...el.options].some((o) => o.value === prev)) el.value = prev;
}

function switchProjectMgmtTab(tab) {
  const next = String(tab || 'progress');
  PM_STATE.currentTab = next;
  ['progress', 'invoice', 'cost', 'timecharge', 'contract'].forEach((key) => {
    const panel = document.getElementById(`pm-panel-${key}`);
    if (panel) panel.style.display = (key === next ? '' : 'none');
    const btn = document.querySelector(`.pm-tab[data-pm-tab="${key}"]`);
    if (btn) btn.classList.toggle('is-active', key === next);
  });
  if (next === 'progress') loadProjectMgmtProgress();
  if (next === 'invoice') loadProjectMgmtInvoices();
  if (next === 'cost') loadProjectMgmtCosts();
  if (next === 'timecharge') loadProjectMgmtTimeCharge();
  if (next === 'contract') loadProjectMgmtContracts();
}

async function init_project_management() {
  const session = getSession ? getSession() : null;
  const canWrite = !!(session && (Auth.canApprove1st(session) || Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session)));
  const canIssue = _pmCanIssueInvoice(session);
  const canRequestInvoice = !!session;

  await _pmLoadProjects();
  await _pmLoadUsers();
  _pmFillProjectSelect('pm-tc-project', '프로젝트 선택');
  _pmFillProjectSelect('pm-inv-project', '전체 프로젝트');
  _pmFillInvoiceListFilters();
  _pmFillProjectSelect('pm-cost-project', '전체 프로젝트');

  const monthEls = ['pm-tc-month', 'pm-inv-month'];
  monthEls.forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = _pmNowMonth();
  });

  if (!PM_STATE.initialized) {
    document.getElementById('pm-progress-refresh-btn')?.addEventListener('click', loadProjectMgmtProgress);
    document.getElementById('pm-progress-search-btn')?.addEventListener('click', loadProjectMgmtProgress);
    ['pm-progress-filter-dept','pm-progress-filter-hq','pm-progress-filter-csteam','pm-progress-filter-client','pm-progress-filter-pm','pm-progress-filter-status']
      .forEach((id) => document.getElementById(id)?.addEventListener('change', loadProjectMgmtProgress));
    const progressFrom = document.getElementById('pm-progress-date-from');
    const progressTo = document.getElementById('pm-progress-date-to');
    if (progressFrom && !progressFrom.value) progressFrom.value = _pmTodayDateText().slice(0, 8) + '01';
    if (progressTo && !progressTo.value) progressTo.value = _pmTodayDateText();
    document.querySelectorAll('.pm-progress-quick-range-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        _pmApplyProgressPreset(btn.dataset.pmProgressRange || '');
        loadProjectMgmtProgress();
      });
    });
    document.getElementById('pm-tc-import-btn')?.addEventListener('click', importTimeChargeFromEntries);
    document.getElementById('pm-tc-save-btn')?.addEventListener('click', saveTimeChargeLines);
    document.getElementById('pm-tc-request-btn')?.addEventListener('click', requestTimeChargeInvoice);
    document.getElementById('pm-tc-project')?.addEventListener('change', loadProjectMgmtTimeCharge);
    document.getElementById('pm-tc-month')?.addEventListener('change', loadProjectMgmtTimeCharge);
    document.getElementById('pm-inv-load-btn')?.addEventListener('click', loadProjectMgmtInvoices);
    document.getElementById('pm-inv-create-btn')?.addEventListener('click', createInvoiceRequestFromBatch);
    document.getElementById('pm-inv-quality-btn')?.addEventListener('click', pmRunInvoiceDataQualityCheck);
    document.getElementById('pm-inv-filter-client')?.addEventListener('change', () => { pmCloseInvoiceProjectDetail(); loadProjectMgmtInvoices(); });
    document.getElementById('pm-inv-filter-pm')?.addEventListener('change', () => { pmCloseInvoiceProjectDetail(); loadProjectMgmtInvoices(); });
    document.getElementById('pm-inv-filter-team')?.addEventListener('change', () => { pmCloseInvoiceProjectDetail(); loadProjectMgmtInvoices(); });
    document.getElementById('pm-inv-mark-settled-btn')?.addEventListener('click', pmMarkInvoiceProjectSettled);
    document.getElementById('pm-inv-detail-prev-btn')?.addEventListener('click', pmOpenPrevInvoiceProjectDetail);
    document.getElementById('pm-inv-detail-next-btn')?.addEventListener('click', pmOpenNextInvoiceProjectDetail);
    document.getElementById('pm-inv-detail-close-btn')?.addEventListener('click', pmCloseInvoiceProjectDetail);
    document.getElementById('pm-inv-detail-backdrop')?.addEventListener('click', pmCloseInvoiceProjectDetail);
    document.getElementById('pm-cost-save-btn')?.addEventListener('click', saveProjectCostItem);
    document.getElementById('pm-cost-load-btn')?.addEventListener('click', loadProjectMgmtCosts);
    document.getElementById('pm-cost-project')?.addEventListener('change', loadProjectMgmtCosts);
    document.getElementById('pm-contract-refresh-btn')?.addEventListener('click', loadProjectMgmtContracts);
    PM_STATE.initialized = true;
  }

  const disableIfNoWrite = ['pm-tc-import-btn', 'pm-tc-save-btn', 'pm-inv-create-btn', 'pm-cost-save-btn'];
  disableIfNoWrite.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canWrite;
  });
  const requestBtn = document.getElementById('pm-tc-request-btn');
  if (requestBtn) requestBtn.disabled = !canIssue;
  const invoiceReqBtn = document.getElementById('pm-inv-create-btn');
  if (invoiceReqBtn) invoiceReqBtn.disabled = !canRequestInvoice;
  const qualityBtn = document.getElementById('pm-inv-quality-btn');
  if (qualityBtn) qualityBtn.style.display = canIssue ? '' : 'none';
  const qualitySummary = document.getElementById('pm-inv-quality-summary');
  if (qualitySummary) qualitySummary.style.display = canIssue ? '' : 'none';
  const settleBtn = document.getElementById('pm-inv-mark-settled-btn');
  if (settleBtn) {
    settleBtn.style.display = canIssue ? '' : 'none';
    settleBtn.disabled = !canIssue;
  }

  const mode = _pmCurrentPageMode();
  applyProjectPageMode(mode);
  _pmPrimeInvoiceRequestForm();
  if (mode === 'manage') switchProjectMgmtTab(PM_STATE.currentTab || 'progress');
}

async function loadProjectMgmtProgress() {
  const body = document.getElementById('pm-progress-body');
  if (!body) return;
  const session = getSession ? getSession() : null;
  const from = String(document.getElementById('pm-progress-date-from')?.value || '').trim();
  const to = String(document.getElementById('pm-progress-date-to')?.value || '').trim();
  const fDept = String(document.getElementById('pm-progress-filter-dept')?.value || '').trim();
  const fHq = String(document.getElementById('pm-progress-filter-hq')?.value || '').trim();
  const fCs = String(document.getElementById('pm-progress-filter-csteam')?.value || '').trim();
  const fClient = String(document.getElementById('pm-progress-filter-client')?.value || '').trim();
  const fPm = String(document.getElementById('pm-progress-filter-pm')?.value || '').trim();
  const fStatus = String(document.getElementById('pm-progress-filter-status')?.value || '').trim();
  try {
    const [projects, invoices, entries, outputs] = await Promise.all([
      API.listAllPages('registered_projects', { limit: 500, maxPages: 20, sort: 'updated_at' }),
      API.listAllPages('project_invoices', { limit: 1000, maxPages: 30, sort: 'updated_at' }).catch(() => []),
      API.listAllPages('time_entries', { filter: 'status=eq.approved', limit: 1000, maxPages: 30, sort: 'updated_at' }).catch(() => []),
      API.listAllPages('project_outputs', { limit: 1000, maxPages: 20, sort: 'updated_at' }).catch(() => []),
    ]);
    const userMap = PM_STATE.usersById || {};
    const invByCode = {};
    (invoices || []).forEach((iv) => {
      const code = String(iv.project_code || '').trim();
      if (!code) return;
      if (!invByCode[code]) invByCode[code] = { outstanding: 0, hasInvoice: false };
      invByCode[code].hasInvoice = true;
      invByCode[code].outstanding += Number(iv.outstanding_amount || 0);
    });
    const firstApprovedByCode = {};
    (entries || []).forEach((e) => {
      const code = String(e.project_code || '').trim();
      if (!code) return;
      const ts = Number(e.reviewed_at || e.updated_at || e.created_at || 0);
      if (!ts) return;
      if (!firstApprovedByCode[code] || ts < firstApprovedByCode[code]) firstApprovedByCode[code] = ts;
    });
    const outputRowsByCode = {};
    (outputs || []).forEach((o) => {
      const code = String(o.project_code || '').trim();
      if (!code) return;
      if (!outputRowsByCode[code]) outputRowsByCode[code] = [];
      outputRowsByCode[code].push(o);
    });

    const scopedProjects = _pmFilterProjectsByScope(projects, session);
    const rows = (scopedProjects || []).filter((r) =>
      String(r.project_code || '').trim() !== '' &&
      String(r.registration_status || '').trim() === 'approved'
    ).map((r) => {
      const u = userMap[String(r.cpm_user_id || '')] || {};
      return {
        ...r,
        _dept_name: String(u.dept_name || '').trim(),
        _hq_name: String(u.hq_name || '').trim(),
        _cs_team_name: String(u.cs_team_name || '').trim(),
      };
    });
    _pmBuildProgressFilters(rows);
    const today = new Date().toISOString().slice(0, 10);
    const lifecycle = (r) => {
      const code = String(r.project_code || '').trim();
      const inv = invByCode[code] || { outstanding: 0, hasInvoice: false };
      const contractAtAuto = r.contract_file_name ? Number(r.contract_uploaded_at || r.final_approved_at || r.created_at || 0) : 0;
      const executeAtAuto = Number(firstApprovedByCode[code] || 0);
      const pmOutputs = (outputRowsByCode[code] || []).filter((o) => String(o.uploaded_by || '') === String(r.cpm_user_id || ''));
      const closedAtAuto = pmOutputs.reduce((mx, o) => Math.max(mx, Number(o.uploaded_at || o.created_at || o.updated_at || 0)), 0);
      const settledAtAuto = (inv.hasInvoice && Number(inv.outstanding || 0) <= 0) ? Number((invoices || [])
        .filter((x) => String(x.project_code || '').trim() === code)
        .reduce((mx, x) => Math.max(mx, Number(x.paid_at || x.updated_at || 0)), 0)) : 0;
      const history = {
        contract: Number(r.contract_completed_at || contractAtAuto || 0),
        execute: Number(r.execution_started_at || executeAtAuto || 0),
        close: Number(r.work_closed_at || closedAtAuto || 0),
        settle: Number(r.settled_at || settledAtAuto || 0),
      };
      const historyPatch = {};
      if (!Number(r.contract_completed_at || 0) && contractAtAuto > 0) historyPatch.contract_completed_at = contractAtAuto;
      if (!Number(r.execution_started_at || 0) && executeAtAuto > 0) historyPatch.execution_started_at = executeAtAuto;
      if (!Number(r.work_closed_at || 0) && closedAtAuto > 0) historyPatch.work_closed_at = closedAtAuto;
      if (!Number(r.settled_at || 0) && settledAtAuto > 0) historyPatch.settled_at = settledAtAuto;
      let codeSt = 'contract_completed';
      let basisTs = history.contract;
      if (history.execute > 0) { codeSt = 'in_progress'; basisTs = history.execute; }
      if (history.close > 0) { codeSt = 'work_closed'; basisTs = history.close; }
      if (history.settle > 0) { codeSt = 'settled_done'; basisTs = history.settle; }
      const override = String(r.lifecycle_status_override || '').trim();
      if (override && PM_LIFECYCLE[override]) {
        codeSt = override;
        basisTs = Number(r.lifecycle_updated_at || basisTs || 0);
      }
      return { code: codeSt, basisTs, history, override, historyPatch };
    };

    const withMeta = rows.map((r) => {
      const life = lifecycle(r);
      const approvedDate = String(_pmTsToDateText(
        Number(r.final_approved_at || r.approved_at || r.updated_at || r.created_at || 0)
      ) || '').trim();
      return { row: r, life, approvedDate, approvedTs: Number(r.final_approved_at || r.approved_at || r.updated_at || r.created_at || 0) };
    }).filter((x) => {
      const r = x.row;
      if ((from || to) && !x.approvedDate) return false;
      if (from && x.approvedDate && x.approvedDate < from) return false;
      if (to && x.approvedDate && x.approvedDate > to) return false;
      if (fDept && String(r._dept_name || '') !== fDept) return false;
      if (fHq && String(r._hq_name || '') !== fHq) return false;
      if (fCs && String(r._cs_team_name || '') !== fCs) return false;
      if (fClient && String(r.client_name || '') !== fClient) return false;
      if (fPm && String(r.cpm_user_name || '') !== fPm) return false;
      if (fStatus && String(x.life.code || '') !== fStatus) return false;
      return true;
    }).sort((a, b) => Number(b.approvedTs || 0) - Number(a.approvedTs || 0));

    if (!withMeta.length) {
      body.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-inbox"></i><p>조건에 맞는 프로젝트가 없습니다.</p></td></tr>';
      return;
    }

    // 자동판정 결과를 이력 컬럼에 1회 저장(빈 값만 보강)
    const syncTargets = withMeta.filter((x) => Object.keys(x.life.historyPatch || {}).length > 0).slice(0, 30);
    if (syncTargets.length) {
      Promise.allSettled(syncTargets.map((x) => API.patch('registered_projects', x.row.id, x.life.historyPatch)))
        .catch(() => {});
    }

    body.innerHTML = withMeta.map((x, i) => {
      const r = x.row;
      const stepCode = String(x.life.code || 'contract_completed');
      const overrideMark = x.life.override ? '<span class="pm-progress-override-mark">(수동)</span>' : '';
      return `<tr>
        <td class="pm-progress-col-no">${i + 1}</td>
        <td class="pm-progress-col-date">${_pmEsc(x.approvedDate || '-')}</td>
        <td class="pm-progress-col-client" title="${_pmEsc(r.client_name || '')}">${_pmEsc(r.client_name || '-')}</td>
        <td class="pm-progress-col-code">${_pmEsc(r.project_code || '')}</td>
        <td class="pm-progress-col-name" title="${_pmEsc(r.project_name || '')}">${_pmEsc(r.project_name || '-')}</td>
        <td class="pm-progress-col-status"><span class="pm-progress-status-wrap">${_pmLifecycleBadge(stepCode)}${overrideMark}</span></td>
        <td class="pm-progress-col-pm">${_pmEsc(r.cpm_user_name || '-')}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    console.error(e);
    body.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>진행현황 조회 실패</p></td></tr>';
  }
}

async function pmAdjustLifecycleStatus(projectId, currentCode) {
  const session = getSession ? getSession() : null;
  const canOverride = !!(session && (Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session)));
  if (!canOverride) {
    Toast.warning('상태 보정 권한이 없습니다.');
    return;
  }
  const guide = [
    'auto: 자동판정 복귀',
    'contract_completed: 계약완료',
    'in_progress: 수행중',
    'work_closed: 업무종료',
    'settled_done: 정산완료',
  ].join('\n');
  const picked = window.prompt(`보정 상태를 입력하세요.\n${guide}`, currentCode || 'auto');
  if (picked == null) return;
  const val = String(picked || '').trim();
  const reason = window.prompt('보정 사유를 입력하세요.', '') || '';
  const patch = {
    lifecycle_status_override: '',
    lifecycle_override_reason: reason,
    lifecycle_updated_at: Date.now(),
    lifecycle_updated_by: String(session.id || ''),
    lifecycle_updated_by_name: session.name || '',
  };
  const now = Date.now();
  if (val && val !== 'auto') {
    if (!PM_LIFECYCLE[val]) {
      Toast.warning('유효하지 않은 상태 코드입니다.');
      return;
    }
    patch.lifecycle_status_override = val;
    if (val === 'contract_completed') patch.contract_completed_at = now;
    if (val === 'in_progress') patch.execution_started_at = now;
    if (val === 'work_closed') patch.work_closed_at = now;
    if (val === 'settled_done') patch.settled_at = now;
  }
  try {
    await API.patch('registered_projects', projectId, patch);
    Toast.success('진행현황 상태 보정이 저장되었습니다.');
    await loadProjectMgmtProgress();
  } catch (e) {
    console.error(e);
    Toast.error('상태 보정 실패: ' + (e.message || ''));
  }
}

function pmOpenLifecycleAction(projectCode, tab) {
  const code = String(projectCode || '').trim();
  const sel = document.getElementById('pm-inv-project');
  const selCost = document.getElementById('pm-cost-project');
  const selTc = document.getElementById('pm-tc-project');
  if (sel && code && [...sel.options].some((o) => o.value === code)) sel.value = code;
  if (selCost && code && [...selCost.options].some((o) => o.value === code)) selCost.value = code;
  if (selTc && code && [...selTc.options].some((o) => o.value === code)) selTc.value = code;
  switchProjectMgmtTab(tab || 'invoice');
}

async function _pmFindOrCreateBatch(projectCode, billingMonth) {
  const project = PM_STATE.projectByCode[projectCode] || {};
  const rows = await API.listAllPages('project_timecharge_batches', {
    filter: `project_code=eq.${encodeURIComponent(projectCode)}&billing_month=eq.${encodeURIComponent(billingMonth)}`,
    limit: 50,
    maxPages: 1,
    sort: 'updated_at',
  }).catch(() => []);
  if (rows && rows.length > 0) return rows[0];
  const session = getSession();
  return API.create('project_timecharge_batches', {
    project_id: project.id || '',
    project_code: projectCode,
    project_name: project.project_name || '',
    client_id: project.client_id || '',
    client_name: project.client_name || '',
    billing_month: billingMonth,
    status: 'draft',
    created_by: session.id,
    created_by_name: session.name || '',
    subtotal_amount: 0,
    tax_amount: 0,
    total_amount: 0,
    outstanding_amount: 0,
  });
}

async function _pmResolveRate(project, userId, roleKey, workDate) {
  const dateVal = String(workDate || '').trim();
  const projectCode = String(project && project.project_code || '').trim();
  const [projRates, userRates] = await Promise.all([
    API.listAllPages('project_rate_cards', {
      filter: `project_code=eq.${encodeURIComponent(projectCode)}&is_active=eq.true`,
      limit: 200,
      maxPages: 2,
      sort: 'updated_at',
    }).catch(() => []),
    API.listAllPages('user_rate_cards', {
      filter: `user_id=eq.${encodeURIComponent(userId)}&is_active=eq.true`,
      limit: 50,
      maxPages: 2,
      sort: 'updated_at',
    }).catch(() => []),
  ]);

  const isInRange = (r) => {
    const from = String(r.effective_from || '').trim();
    const to = String(r.effective_to || '').trim();
    if (from && dateVal && dateVal < from) return false;
    if (to && dateVal && dateVal > to) return false;
    return true;
  };

  const exactUser = (projRates || []).find((r) => String(r.user_id || '') === String(userId) && isInRange(r));
  if (exactUser) return { unitRate: Number(exactUser.unit_rate || 0), rateSource: 'project_role' };
  const byRole = (projRates || []).find((r) => String(r.role_key || '') === String(roleKey || '') && isInRange(r));
  if (byRole) return { unitRate: Number(byRole.unit_rate || 0), rateSource: 'project_role' };
  const base = (userRates || []).find((r) => isInRange(r));
  if (base) return { unitRate: Number(base.unit_rate || 0), rateSource: 'user_base' };
  return { unitRate: 0, rateSource: 'manual' };
}

async function importTimeChargeFromEntries() {
  const session = getSession();
  if (!(Auth.canApprove1st(session) || Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session))) {
    Toast.warning('Time Charge 불러오기 권한이 없습니다.');
    return;
  }
  const projectCode = String(document.getElementById('pm-tc-project')?.value || '').trim();
  const billingMonth = String(document.getElementById('pm-tc-month')?.value || '').trim();
  if (!projectCode || !billingMonth) {
    Toast.warning('프로젝트와 청구월을 선택하세요.');
    return;
  }
  if (!_pmHasProjectAccess(projectCode)) {
    Toast.warning('해당 프로젝트 접근 권한이 없습니다.');
    return;
  }
  try {
    const batch = await _pmFindOrCreateBatch(projectCode, billingMonth);
    PM_STATE.currentBatch = batch;
    const entries = await API.listAllPages('time_entries', {
      filter: `status=eq.approved&project_code=eq.${encodeURIComponent(projectCode)}`,
      limit: 500,
      maxPages: 50,
      sort: 'updated_at',
    });
    const scoped = (entries || []).filter((e) => _pmDateInMonth(_pmEntryToWorkDate(e), billingMonth));
    const grouped = {};
    scoped.forEach((e) => {
      const workDate = _pmEntryToWorkDate(e);
      const userId = String(e.user_id || '');
      const cat = String(e.work_category_name || '').trim();
      const sourceKey = `${userId}|${workDate}|${cat}`;
      if (!grouped[sourceKey]) {
        grouped[sourceKey] = {
          source_key: sourceKey,
          entry_id: String(e.id || ''),
          project_code: projectCode,
          project_name: e.project_name || (PM_STATE.projectByCode[projectCode]?.project_name || ''),
          client_name: e.client_name || (PM_STATE.projectByCode[projectCode]?.client_name || ''),
          user_id: userId,
          user_name: e.user_name || '',
          role_key: String((PM_STATE.usersById[userId] || {}).role || ''),
          work_date: workDate || null,
          work_category_name: cat,
          work_subcategory_name: e.work_subcategory_name || '',
          description: String(e.work_description || '').replace(/\s+/g, ' ').slice(0, 120),
          base_minutes: 0,
        };
      }
      grouped[sourceKey].base_minutes += Number(e.duration_minutes || 0);
    });

    const existing = await API.listAllPages('project_timecharge_lines', {
      filter: `batch_id=eq.${encodeURIComponent(batch.id)}`,
      limit: 800,
      maxPages: 10,
      sort: 'updated_at',
    }).catch(() => []);
    const existingByKey = {};
    (existing || []).forEach((r) => { existingByKey[String(r.source_key || '')] = r; });

    const project = PM_STATE.projectByCode[projectCode] || {};
    const session = getSession();
    for (const key of Object.keys(grouped)) {
      const row = grouped[key];
      const rateInfo = await _pmResolveRate(project, row.user_id, row.role_key, row.work_date);
      const finalMinutes = Number(row.base_minutes || 0);
      const baseAmount = (finalMinutes / 60) * Number(rateInfo.unitRate || 0);
      const payload = {
        batch_id: batch.id,
        source_key: row.source_key,
        entry_id: row.entry_id,
        project_code: row.project_code,
        project_name: row.project_name,
        client_name: row.client_name,
        user_id: row.user_id,
        user_name: row.user_name,
        role_key: row.role_key,
        work_date: row.work_date,
        work_category_name: row.work_category_name,
        work_subcategory_name: row.work_subcategory_name,
        description: row.description,
        base_minutes: finalMinutes,
        adjusted_minutes: 0,
        final_minutes: finalMinutes,
        rate_source: rateInfo.rateSource,
        unit_rate: rateInfo.unitRate,
        base_amount: baseAmount,
        adjusted_amount: 0,
        final_amount: baseAmount,
        is_billable: true,
        created_by: session.id,
        created_by_name: session.name || '',
      };
      if (existingByKey[row.source_key]) await API.patch('project_timecharge_lines', existingByKey[row.source_key].id, payload);
      else await API.create('project_timecharge_lines', payload);
    }
    await loadProjectMgmtTimeCharge();
    Toast.success(`Time Charge 라인 불러오기 완료 (${Object.keys(grouped).length}건)`);
  } catch (e) {
    console.error(e);
    Toast.error('승인 타임시트 불러오기 실패: ' + (e.message || ''));
  }
}

function _pmReadLineRow(tr) {
  const id = tr.dataset.lineId || '';
  const baseMinutes = Number(tr.dataset.baseMinutes || 0);
  const minutes = Number(tr.querySelector('[data-f="minutes"]')?.value || 0);
  const rate = Number(tr.querySelector('[data-f="rate"]')?.value || 0);
  const amountInput = Number(tr.querySelector('[data-f="amount"]')?.value || 0);
  const calcAmount = (minutes / 60) * rate;
  const isManual = Math.abs(amountInput - calcAmount) >= 1;
  const finalAmount = amountInput;
  return {
    id,
    baseMinutes,
    minutes,
    rate,
    calcAmount,
    finalAmount,
    isBillable: tr.querySelector('[data-f="billable"]')?.value === 'Y',
    reason: tr.querySelector('[data-f="reason"]')?.value || '',
    source: isManual ? 'manual' : (tr.dataset.rateSource || 'user_base'),
  };
}

async function saveTimeChargeLines() {
  const session = getSession();
  if (!(Auth.canApprove1st(session) || Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session))) {
    Toast.warning('Time Charge 저장 권한이 없습니다.');
    return;
  }
  if (!PM_STATE.currentBatch || !PM_STATE.currentBatch.id) {
    Toast.warning('먼저 Time Charge 배치를 불러오세요.');
    return;
  }
  const rows = [...document.querySelectorAll('#pm-tc-body tr[data-line-id]')];
  if (!rows.length) {
    Toast.info('저장할 라인이 없습니다.');
    return;
  }
  try {
    let subtotal = 0;
    for (const tr of rows) {
      const parsed = _pmReadLineRow(tr);
      const patch = {
        final_minutes: parsed.minutes,
        adjusted_minutes: parsed.minutes - parsed.baseMinutes,
        unit_rate: parsed.rate,
        rate_source: parsed.source,
        base_amount: parsed.calcAmount,
        adjusted_amount: parsed.finalAmount - parsed.calcAmount,
        final_amount: parsed.finalAmount,
        adjust_reason: parsed.reason,
        is_billable: parsed.isBillable,
      };
      subtotal += parsed.isBillable ? parsed.finalAmount : 0;
      await API.patch('project_timecharge_lines', parsed.id, patch);
    }
    const tax = Math.round(subtotal * 0.1);
    const total = subtotal + tax;
    await API.patch('project_timecharge_batches', PM_STATE.currentBatch.id, {
      subtotal_amount: subtotal,
      tax_amount: tax,
      total_amount: total,
      outstanding_amount: total,
    });
    await loadProjectMgmtTimeCharge();
    Toast.success('Time Charge 조정 내역을 저장했습니다.');
  } catch (e) {
    console.error(e);
    Toast.error('Time Charge 저장 실패: ' + (e.message || ''));
  }
}

async function requestTimeChargeInvoice() {
  const session = getSession();
  const projCode = String(PM_STATE.currentBatch && PM_STATE.currentBatch.project_code || '').trim();
  if (!_pmCanRequestInvoiceForProject(session, projCode)) {
    Toast.warning('세금계산서 발행 요청 권한이 없습니다.');
    return;
  }
  if (!PM_STATE.currentBatch || !PM_STATE.currentBatch.id) {
    Toast.warning('먼저 Time Charge 배치를 불러오세요.');
    return;
  }
  try {
    await API.patch('project_timecharge_batches', PM_STATE.currentBatch.id, {
      status: 'requested',
      requested_at: Date.now(),
      requested_by: session.id,
      requested_by_name: session.name || '',
    });
    await createInvoiceRequestFromBatch();
    if (typeof createNotification === 'function') {
      const targets = _pmFinanceUsers();
      targets.forEach((u) => {
        createNotification({
          toUserId: u.id,
          toUserName: u.name,
          fromUserId: session.id,
          fromUserName: session.name || '',
          type: 'submitted',
          entryId: PM_STATE.currentBatch.id,
          entrySummary: `${PM_STATE.currentBatch.project_code} · ${PM_STATE.currentBatch.billing_month}`,
          message: `${PM_STATE.currentBatch.project_code} (${PM_STATE.currentBatch.billing_month}) 세금계산서 발행 요청이 등록되었습니다. (경영지원팀 처리 대상)`,
          targetMenu: 'project-management:invoice',
        });
      });
    }
    await loadProjectMgmtTimeCharge();
    Toast.success('세금계산서 발행 요청 상태로 변경했습니다.');
  } catch (e) {
    console.error(e);
    Toast.error('발행 요청 처리 실패: ' + (e.message || ''));
  }
}

async function loadProjectMgmtTimeCharge() {
  const projectCode = String(document.getElementById('pm-tc-project')?.value || '').trim();
  const billingMonth = String(document.getElementById('pm-tc-month')?.value || '').trim();
  const body = document.getElementById('pm-tc-body');
  const statusBadge = document.getElementById('pm-tc-status-badge');
  if (!body) return;
  if (!projectCode || !billingMonth) {
    body.innerHTML = '<tr><td colspan="12" class="table-empty"><i class="fas fa-layer-group"></i><p>프로젝트와 청구월을 선택하세요.</p></td></tr>';
    if (statusBadge) statusBadge.textContent = '배치 없음';
    return;
  }
  if (!_pmHasProjectAccess(projectCode)) {
    body.innerHTML = '<tr><td colspan="12" class="table-empty"><i class="fas fa-ban"></i><p>해당 프로젝트 접근 권한이 없습니다.</p></td></tr>';
    if (statusBadge) statusBadge.textContent = '접근 제한';
    return;
  }
  try {
    const rows = await API.listAllPages('project_timecharge_batches', {
      filter: `project_code=eq.${encodeURIComponent(projectCode)}&billing_month=eq.${encodeURIComponent(billingMonth)}`,
      limit: 50,
      maxPages: 1,
      sort: 'updated_at',
    }).catch(() => []);
    PM_STATE.currentBatch = rows[0] || null;
    const batchId = PM_STATE.currentBatch ? PM_STATE.currentBatch.id : '';
    if (!batchId) {
      body.innerHTML = '<tr><td colspan="12" class="table-empty"><i class="fas fa-file-medical"></i><p>아직 생성된 배치가 없습니다. 불러오기를 눌러주세요.</p></td></tr>';
      if (statusBadge) statusBadge.textContent = '배치 없음';
      document.getElementById('pm-tc-summary').textContent = '라인 0건 · 청구금액 0원';
      return;
    }
    const lines = await API.listAllPages('project_timecharge_lines', {
      filter: `batch_id=eq.${encodeURIComponent(batchId)}`,
      limit: 800,
      maxPages: 10,
      sort: 'work_date',
    }).catch(() => []);
    PM_STATE.currentLines = lines || [];
    if (statusBadge) statusBadge.textContent = `상태: ${PM_STATE.currentBatch.status || 'draft'}`;

    if (!PM_STATE.currentLines.length) {
      body.innerHTML = '<tr><td colspan="12" class="table-empty"><i class="fas fa-inbox"></i><p>저장된 Time Charge 라인이 없습니다.</p></td></tr>';
      document.getElementById('pm-tc-summary').textContent = '라인 0건 · 청구금액 0원';
      return;
    }
    let amountSum = 0;
    body.innerHTML = PM_STATE.currentLines.map((r, i) => {
      const base = Number(r.base_minutes || 0);
      const minutes = Number(r.final_minutes || r.base_minutes || 0);
      const rate = Number(r.unit_rate || 0);
      const amount = Number(r.final_amount || 0);
      if (r.is_billable !== false) amountSum += amount;
      return `<tr data-line-id="${_pmEsc(r.id)}" data-base-minutes="${base}" data-rate-source="${_pmEsc(r.rate_source || 'user_base')}">
        <td style="text-align:center">${i + 1}</td>
        <td>${_pmEsc(r.work_date || '')}</td>
        <td>${_pmEsc(r.user_name || '-')}</td>
        <td>${_pmEsc(r.work_category_name || '-')}</td>
        <td title="${_pmEsc(r.description || '')}">${_pmEsc(r.description || '-')}</td>
        <td style="text-align:right">${base.toLocaleString('ko-KR')}분</td>
        <td><input type="number" data-f="minutes" min="0" step="30" value="${minutes}"></td>
        <td><input type="number" data-f="rate" min="0" step="1000" value="${Math.round(rate)}"></td>
        <td><input type="number" data-f="amount" min="0" step="1000" value="${Math.round(amount)}"></td>
        <td style="text-align:center">${_pmEsc(r.rate_source || '-')}</td>
        <td>
          <select data-f="billable">
            <option value="Y" ${r.is_billable !== false ? 'selected' : ''}>청구</option>
            <option value="N" ${r.is_billable === false ? 'selected' : ''}>제외</option>
          </select>
        </td>
        <td><input type="text" data-f="reason" value="${_pmEsc(r.adjust_reason || '')}" placeholder="조정 사유"></td>
      </tr>`;
    }).join('');
    document.getElementById('pm-tc-summary').textContent = `라인 ${PM_STATE.currentLines.length}건 · 청구금액 ${_pmKrw(amountSum)}`;
  } catch (e) {
    console.error(e);
    body.innerHTML = '<tr><td colspan="12" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>Time Charge 조회 실패</p></td></tr>';
  }
}

async function createInvoiceRequestFromBatch() {
  const session = getSession();
  const projectCode = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-tc-project')?.value || document.getElementById('pm-inv-project')?.value || '').trim();
  const billingMonth = String(document.getElementById('pm-tc-month')?.value || document.getElementById('pm-inv-month')?.value || _pmNowMonth()).trim();
  if (!projectCode || !billingMonth) {
    Toast.warning('프로젝트/청구월을 확인하세요.');
    return;
  }
  if (!_pmHasProjectAccess(projectCode)) {
    Toast.warning('해당 프로젝트 접근 권한이 없습니다.');
    return;
  }
  if (!_pmCanRequestInvoiceForProject(session, projectCode)) {
    Toast.warning('해당 프로젝트의 발행요청 권한이 없습니다.');
    return;
  }
  try {
    const batch = PM_STATE.currentBatch && PM_STATE.currentBatch.project_code === projectCode && PM_STATE.currentBatch.billing_month === billingMonth
      ? PM_STATE.currentBatch
      : await _pmFindOrCreateBatch(projectCode, billingMonth);
    const existing = await API.listAllPages('project_invoices', {
      filter: `batch_id=eq.${encodeURIComponent(batch.id)}`,
      limit: 20,
      maxPages: 1,
      sort: 'updated_at',
    }).catch(() => []);
    if (existing.length) {
      Toast.info('이미 생성된 발행 요청이 있습니다.');
      await loadProjectMgmtInvoices();
      return;
    }
    const reqForm = _pmReadInvoiceRequestForm(projectCode, billingMonth, batch);
    const missing = _pmValidateInvoiceForm(reqForm);
    if (missing.length) {
      Toast.warning(`발행요청 필수값을 확인하세요: ${missing.join(', ')}`);
      return;
    }
    const created = await API.create('project_invoices', {
      batch_id: batch.id,
      project_id: batch.project_id || '',
      project_code: batch.project_code || '',
      project_name: batch.project_name || '',
      client_id: batch.client_id || '',
      client_name: batch.client_name || '',
      billing_month: batch.billing_month || billingMonth,
      issue_requested_at: Date.now(),
      issue_requested_by: session.id,
      issue_requested_by_name: session.name || '',
      payment_status: 'requested',
      planned_issue_date: reqForm.planned_issue_date,
      expected_payment_date: reqForm.expected_payment_date,
      recipient_email: reqForm.recipient_email,
      recipient_name: reqForm.recipient_name,
      recipient_phone: reqForm.recipient_phone,
      buyer_company_name: reqForm.buyer_company_name,
      buyer_business_no: reqForm.buyer_business_no,
      item_name: reqForm.item_name,
      legal_note: reqForm.legal_note,
      nts_issue_status: 'pending',
      nts_issue_requested_at: Date.now(),
      nts_issue_requested_by: session.id,
      nts_issue_requested_by_name: session.name || '',
      request_payload: reqForm.request_payload,
      invoice_amount: Number(reqForm.invoice_amount || batch.total_amount || 0),
      paid_amount: 0,
      outstanding_amount: Number(reqForm.invoice_amount || batch.total_amount || 0),
    });
    if (created && created.id) {
      await issueTaxInvoice(created.id, PM_NTS_DEFAULT_MODE);
    }
    if (typeof createNotification === 'function') {
      _pmFinanceUsers().forEach((u) => {
        createNotification({
          toUserId: u.id,
          toUserName: u.name,
          fromUserId: session.id,
          fromUserName: session.name || '',
          type: 'submitted',
          entryId: batch.id,
          entrySummary: `${batch.project_code} · ${batch.billing_month}`,
          message: `${batch.project_code} (${batch.billing_month}) 세금계산서 발행요청이 등록되었습니다. 수신자: ${reqForm.recipient_email || '-'}`,
          targetMenu: 'project-management:invoice',
        });
      });
    }
    await loadProjectMgmtInvoices();
    await _pmLoadInvoiceProjectDetail(projectCode);
    Toast.success('세금계산서 발행요청을 생성했습니다.');
  } catch (e) {
    console.error(e);
    Toast.error('세금계산서 발행요청 생성 실패: ' + (e.message || ''));
  }
}

async function loadProjectMgmtInvoices() {
  const body = document.getElementById('pm-inv-body');
  if (!body) return;
  const session = getSession ? getSession() : null;
  const canIssue = _pmCanIssueInvoice(session);
  _pmFillInvoiceListFilters();
  const fClient = String(document.getElementById('pm-inv-filter-client')?.value || '').trim();
  const fPm = String(document.getElementById('pm-inv-filter-pm')?.value || '').trim();
  const fTeam = String(document.getElementById('pm-inv-filter-team')?.value || '').trim();
  const allowedCodes = new Set((PM_STATE.projects || []).map((p) => String(p.project_code || '').trim()).filter(Boolean));
  try {
    let rows = await API.listAllPages('project_invoices', { limit: 500, maxPages: 20, sort: 'updated_at' }).catch(() => []);
    rows = rows.filter((r) => allowedCodes.has(String(r.project_code || '').trim()));
    rows = rows.filter((r) => {
      const code = String(r.project_code || '').trim();
      const proj = PM_STATE.projectByCode[code] || {};
      const meta = _pmInvoicePmAndTeam(proj);
      if (fClient && String(proj.client_name || '').trim() !== fClient) return false;
      if (fPm && meta.pmName !== fPm) return false;
      if (fTeam && meta.teamLabel !== fTeam) return false;
      return true;
    });
    const nowDate = _pmTsToDateText(Date.now());
    const overdueTargets = [];
    rows = rows.map((r) => {
      const due = String(r.expected_payment_date || r.due_date || '').trim();
      if (due && due < nowDate && !['paid', 'cancelled'].includes(String(r.payment_status || ''))) {
        overdueTargets.push(r.id);
        return { ...r, _derived_status: 'overdue' };
      }
      return { ...r, _derived_status: String(r.payment_status || '') };
    });
    if (overdueTargets.length) {
      Promise.allSettled(overdueTargets.slice(0, 30).map((id) => API.patch('project_invoices', id, { payment_status: 'overdue' }))).catch(() => {});
    }
    const delayedPlanCount = rows.filter((r) => {
      const st = String(r._derived_status || r.payment_status || '');
      const p = String(r.planned_issue_date || '').trim();
      return p && p < nowDate && ['requested', 'overdue'].includes(st);
    }).length;
    if (delayedPlanCount > 0 && !canIssue) {
      Toast.warning(`예상청구일정이 지난 건이 ${delayedPlanCount}건 있습니다. 발행요청 또는 일정 수정이 필요합니다.`);
    }
    let outstanding = 0;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" class="table-empty"><i class="fas fa-file-invoice"></i><p>발행 내역이 없습니다.</p></td></tr>';
      document.getElementById('pm-inv-summary').textContent = '미수금 0원';
      return;
    }
    const grouped = {};
    rows.forEach((r) => {
      const code = String(r.project_code || '').trim();
      if (!code) return;
      if (!grouped[code]) {
        const proj0 = PM_STATE.projectByCode[code] || {};
        grouped[code] = {
          project_code: code,
          client_name: String(proj0.client_name || r.client_name || ''),
          project_name: String(r.project_name || proj0.project_name || ''),
          latest_status: String(r._derived_status || r.payment_status || ''),
          latest_month: String(r.billing_month || ''),
          latest_planned_issue: String(r.planned_issue_date || ''),
          sum_invoice: 0,
          sum_paid: 0,
          sum_outstanding: 0,
          max_ts: 0,
        };
      }
      const g = grouped[code];
      g.sum_invoice += Number(r.invoice_amount || 0);
      g.sum_paid += Number(r.paid_amount || 0);
      g.sum_outstanding += Number(r.outstanding_amount || 0);
      const ts = Number(r.updated_at || r.created_at || 0);
      if (ts >= g.max_ts) {
        g.max_ts = ts;
        g.latest_status = String(r._derived_status || r.payment_status || '');
        g.latest_month = String(r.billing_month || '');
        g.latest_planned_issue = String(r.planned_issue_date || '');
      }
    });
    const list = Object.values(grouped).sort((a, b) => String(a.project_code).localeCompare(String(b.project_code)));
    PM_STATE.invoiceDetailProjectCodes = list.map((x) => String(x.project_code || '').trim()).filter(Boolean);
    body.innerHTML = list.map((r, i) => {
      outstanding += Number(r.sum_outstanding || 0);
      const proj = PM_STATE.projectByCode[String(r.project_code || '').trim()] || {};
      const meta = _pmInvoicePmAndTeam(proj);
      const clientDisp = String(r.client_name || proj.client_name || '').trim() || '-';
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${_pmEsc(r.project_code || '-')}</td>
        <td class="pm-inv-list-col-client" title="${_pmEsc(clientDisp)}">${_pmEsc(clientDisp)}</td>
        <td class="pm-inv-list-col-team" title="${_pmEsc(meta.teamLabel)}">${_pmEsc(meta.teamLabel)}</td>
        <td class="pm-inv-list-col-pm" title="${_pmEsc(meta.pmName)}">${_pmEsc(meta.pmName)}</td>
        <td>${_pmEsc(r.latest_month || '-')}</td>
        <td style="text-align:right">${_pmKrw(r.sum_invoice || 0)}</td>
        <td style="text-align:right">${_pmKrw(r.sum_outstanding || 0)}</td>
        <td style="text-align:center"><button type="button" class="btn btn-sm btn-ghost pm-inv-open-row" onclick="pmOpenInvoiceProjectDetail('${_pmEsc(r.project_code || '')}')" title="발행·입금 내역 보기" aria-label="발행·입금 내역 보기"><i class="fas fa-receipt" aria-hidden="true"></i></button></td>
      </tr>`;
    }).join('');
    document.getElementById('pm-inv-summary').textContent = `미수금 ${_pmKrw(outstanding)}`;
    _pmRenderInvoiceQualitySummary(rows);
    if (canIssue) _pmRunNtsAutoIssue().catch((e) => console.warn('[pm] nts auto issue', e));
  } catch (e) {
    console.error(e);
    body.innerHTML = '<tr><td colspan="9" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>조회 실패</p></td></tr>';
  }
}

async function pmSaveInvoiceRow(id) {
  const tr = document.querySelector(`tr[data-invoice-id="${id}"]`);
  if (!tr) return;
  const session = getSession ? getSession() : null;
  const canIssue = _pmCanIssueInvoice(session);
  const projectCode = String(tr.dataset.projectCode || PM_STATE.invoiceDetailProjectCode || '').trim();
  const canRequest = _pmCanRequestInvoiceForProject(session, projectCode);
  if (!canIssue && !canRequest) {
    Toast.warning('저장 권한이 없습니다.');
    return;
  }
  try {
    let status = tr.querySelector('[data-f="status"]')?.value || 'requested';
    const invoiceAmount = Number(tr.dataset.invoiceAmount || 0);
    const paid = Number(tr.querySelector('[data-f="paid"]')?.value || 0);
    const outstanding = Math.max(0, invoiceAmount - paid);
    let paidDate = String(tr.querySelector('[data-f="paid_date"]')?.value || tr.dataset.paidDate || '').trim();
    const issueDateInput = String(tr.querySelector('[data-f="issue_date"]')?.value || tr.dataset.issueDate || '').trim();
    if (paid > 0 && !paidDate) paidDate = _pmTodayDateText();
    if (paid <= 0) paidDate = '';
    if (paid >= invoiceAmount && invoiceAmount > 0) status = 'paid';
    else if (paid > 0 && outstanding > 0 && !['issued', 'overdue'].includes(status)) status = 'partially_paid';
    if (status === 'paid' && outstanding > 0) {
      Toast.warning('입금완료는 미수금이 0원이어야 합니다.');
      return;
    }
    if (status === 'paid' && paid <= 0) {
      Toast.warning('입금완료 상태에서는 입금금액이 0보다 커야 합니다.');
      return;
    }
    if (status === 'partially_paid' && (paid <= 0 || outstanding <= 0)) {
      Toast.warning('부분입금 상태는 입금금액/미수금이 모두 0보다 커야 합니다.');
      return;
    }
    if (status === 'issued' && !issueDateInput) {
      Toast.warning('발행 상태에서는 발행일이 필요합니다.');
      return;
    }
    const expectedFromIssue = _pmAddMonths(issueDateInput, 1);
    let dueDate = String(tr.querySelector('[data-f="due_date"]')?.value || tr.dataset.dueDate || '').trim();
    if (status === 'issued' && expectedFromIssue) {
      // 기본값만 자동세팅하고, PM/경영지원의 수동 수정값은 존중
      if (!dueDate) {
        dueDate = expectedFromIssue;
        const dueEl = tr.querySelector('[data-f="due_date"]');
        if (dueEl) dueEl.value = expectedFromIssue;
      }
    }
    dueDate = dueDate || null;
    if (dueDate && String(dueDate) < _pmTodayDateText() && outstanding > 0 && !['paid', 'cancelled'].includes(status)) {
      status = 'overdue';
    }
    if (status === 'issued' && !canIssue) {
      Toast.warning('세금계산서 발행처리는 경영지원팀만 가능합니다.');
      return;
    }
    if (status !== 'requested' && status !== 'cancelled' && !canIssue) {
      Toast.warning('입금확인/상태변경은 경영지원팀만 가능합니다.');
      return;
    }
    let invoiceNoValue = String(tr.querySelector('[data-f="inv_no"]')?.value || tr.dataset.invNo || '').trim();
    if (canIssue && status === 'issued' && !invoiceNoValue) {
      invoiceNoValue = String(window.prompt('세금계산서번호를 입력하세요.', '') || '').trim();
      if (!invoiceNoValue) {
        Toast.warning('발행처리 시 세금계산서번호가 필요합니다.');
        return;
      }
      tr.dataset.invNo = invoiceNoValue;
    }
    const confirmedAt = (canIssue && paid > 0) ? Date.now() : null;
    const confirmedBy = (canIssue && paid > 0) ? String(session?.id || '') : '';
    const confirmedByName = (canIssue && paid > 0) ? String(session?.name || '') : '';
    const patch = {
      invoice_no: invoiceNoValue,
      issue_date: issueDateInput || tr.dataset.issueDate || null,
      planned_issue_date: tr.querySelector('[data-f="planned_issue_date"]')?.value || tr.dataset.plannedIssueDate || null,
      expected_payment_date: dueDate,
      due_date: dueDate,
      payment_status: status,
      paid_amount: paid,
      outstanding_amount: outstanding,
      payment_note: tr.querySelector('[data-f="note"]')?.value || tr.dataset.note || '',
      recipient_email: tr.querySelector('[data-f="recipient_email"]')?.value || tr.dataset.recipientEmail || '',
      paid_at: paid > 0 ? Date.now() : null,
      paid_date: paidDate || null,
      payment_confirmed_at: confirmedAt,
      payment_confirmed_by: confirmedBy,
      payment_confirmed_by_name: confirmedByName,
    };
    if (status === 'issued') {
      patch.nts_issue_status = 'issued';
      patch.nts_issue_processed_at = Date.now();
      patch.nts_issue_processed_by = String(session?.id || '');
      patch.nts_issue_processed_by_name = String(session?.name || '');
    }
    await API.patch('project_invoices', id, patch);
    if (status === 'issued') {
      await issueTaxInvoice(id, PM_NTS_DEFAULT_MODE);
    }
    if (canIssue) {
      await _pmSyncProjectSettlementStatus(projectCode);
    }
    Toast.success('세금계산서 정보를 저장했습니다.');
    await loadProjectMgmtInvoices();
    await _pmLoadInvoiceProjectDetail(PM_STATE.invoiceDetailProjectCode || projectCode);
  } catch (e) {
    console.error(e);
    Toast.error('저장 실패: ' + (e.message || ''));
  }
}

async function _pmSyncProjectSettlementStatus(projectCode, options = {}) {
  const code = String(projectCode || '').trim();
  if (!code) return;
  const opts = options && typeof options === 'object' ? options : {};
  const forceSettle = !!opts.forceSettle;
  const p = PM_STATE.projectByCode[code];
  if (!p || !p.id) return;
  const rows = await API.listAllPages('project_invoices', { limit: 500, maxPages: 20, sort: 'updated_at' }).catch(() => []);
  const scoped = (rows || []).filter((r) => String(r.project_code || '').trim() === code);
  if (!scoped.length) return { totalOutstanding: 0, settled: false, rowCount: 0 };
  const totalOutstanding = scoped.reduce((s, r) => s + Math.max(0, Number(r.outstanding_amount || 0)), 0);
  if (forceSettle && totalOutstanding > 0) {
    throw new Error(`미수금 ${_pmKrw(totalOutstanding)}이 남아 있어 정산완료 처리할 수 없습니다.`);
  }
  let settled = false;
  if (totalOutstanding <= 0 || forceSettle) {
    await API.patch('registered_projects', p.id, { settled_at: Date.now() }).catch(() => {});
    settled = true;
  }
  return { totalOutstanding, settled, rowCount: scoped.length };
}

async function pmMarkInvoiceProjectSettled() {
  const session = getSession ? getSession() : null;
  if (!_pmCanIssueInvoice(session)) {
    Toast.warning('전체 입금완료 처리는 경영지원팀만 가능합니다.');
    return;
  }
  const code = String(PM_STATE.invoiceDetailProjectCode || '').trim();
  if (!code) return;
  try {
    const rows = await API.listAllPages('project_invoices', { limit: 500, maxPages: 20, sort: 'updated_at' }).catch(() => []);
    const scoped = (rows || []).filter((r) => String(r.project_code || '').trim() === code);
    if (!scoped.length) {
      Toast.warning('해당 프로젝트의 세금계산서 이력이 없습니다.');
      return;
    }
    const totalOutstanding = scoped.reduce((s, r) => s + Math.max(0, Number(r.outstanding_amount || 0)), 0);
    if (totalOutstanding > 0) {
      Toast.warning(`미수금 ${_pmKrw(totalOutstanding)}이 남아 있어 전체 입금완료 처리할 수 없습니다.`);
      return;
    }
    const today = _pmTodayDateText();
    const now = Date.now();
    const confirmerId = String(session?.id || '');
    const confirmerName = String(session?.name || '');
    const jobs = scoped
      .filter((r) => String(r.payment_status || '') !== 'paid')
      .map((r) => API.patch('project_invoices', r.id, {
        payment_status: 'paid',
        paid_date: String(r.paid_date || '').trim() || today,
        payment_confirmed_at: now,
        payment_confirmed_by: confirmerId,
        payment_confirmed_by_name: confirmerName,
      }));
    if (jobs.length) await Promise.allSettled(jobs);
    await _pmSyncProjectSettlementStatus(code, { forceSettle: true });
    Toast.success('전체 입금완료 처리를 완료했습니다.');
    await loadProjectMgmtInvoices();
    await _pmLoadInvoiceProjectDetail(code);
  } catch (e) {
    console.error(e);
    Toast.error('전체 입금완료 처리 실패: ' + (e.message || ''));
  }
}

async function issueTaxInvoice(invoiceId, mode) {
  const invId = String(invoiceId || '').trim();
  if (!invId) throw new Error('invoiceId가 필요합니다.');
  const selectedMode = Object.values(PM_NTS_MODES).includes(String(mode || '').trim())
    ? String(mode || '').trim()
    : PM_NTS_DEFAULT_MODE;
  const session = getSession ? getSession() : null;
  const invoice = await API.get('project_invoices', invId);
  if (!invoice) throw new Error('세금계산서 요청 정보를 찾을 수 없습니다.');
  const missing = _pmValidateInvoiceForm(invoice);
  if (missing.length) throw new Error(`전송 필수값 누락: ${missing.join(', ')}`);
  const projectCode = String(invoice.project_code || '').trim();
  if (selectedMode === PM_NTS_MODES.LIVE && !_pmCanIssueInvoice(session)) {
    throw new Error('국세청 실전송은 경영지원팀만 처리할 수 있습니다.');
  }
  if (selectedMode === PM_NTS_MODES.QUEUE && !_pmCanRequestInvoiceForProject(session, projectCode) && !_pmCanIssueInvoice(session)) {
    throw new Error('해당 프로젝트의 세금계산서 전송요청 권한이 없습니다.');
  }
  if (String(invoice.nts_issue_status || '') === 'issued') {
    return { ok: true, mode: selectedMode, skipped: true };
  }
  if (selectedMode === PM_NTS_MODES.LIVE) {
    const reqAt = Date.now();
    const attemptNo = Number(invoice.nts_attempt_count || 0) + 1;
    try {
      const rpcRes = await API.rpc('fn_nts_issue_invoice', {
        p_invoice_id: invId,
        p_payload: invoice.request_payload || {},
      });
      const ok = !!(rpcRes && (rpcRes.ok === true || rpcRes.success === true));
      if (!ok) {
        const msg = String((rpcRes && (rpcRes.error || rpcRes.message)) || 'NTS 전송 실패');
        await API.patch('project_invoices', invId, {
          nts_issue_status: 'failed',
          nts_issue_processed_at: Date.now(),
          nts_issue_processed_by: String(session?.id || ''),
          nts_issue_processed_by_name: String(session?.name || ''),
          nts_attempt_count: attemptNo,
          nts_last_error: msg,
        });
        await _pmWriteNtsIssueLog({
          invoice_id: invId,
          project_code: projectCode,
          issue_mode: selectedMode,
          issue_status: 'failed',
          attempt_no: attemptNo,
          request_payload: invoice.request_payload || {},
          response_payload: rpcRes || {},
          error_message: msg,
          requested_by: String(session?.id || ''),
          requested_by_name: String(session?.name || ''),
          requested_at: reqAt,
          processed_at: Date.now(),
        });
        throw new Error(msg);
      }
      await API.patch('project_invoices', invId, {
        nts_issue_status: 'issued',
        nts_issue_processed_at: Date.now(),
        nts_issue_processed_by: String(session?.id || ''),
        nts_issue_processed_by_name: String(session?.name || ''),
        nts_attempt_count: attemptNo,
        nts_last_error: '',
        nts_tx_id: String(rpcRes.tx_id || rpcRes.issue_id || ''),
        payment_status: String(invoice.payment_status || '') === 'requested' ? 'issued' : invoice.payment_status,
      });
      await _pmWriteNtsIssueLog({
        invoice_id: invId,
        project_code: projectCode,
        issue_mode: selectedMode,
        issue_status: 'issued',
        attempt_no: attemptNo,
        request_payload: invoice.request_payload || {},
        response_payload: rpcRes || {},
        requested_by: String(session?.id || ''),
        requested_by_name: String(session?.name || ''),
        requested_at: reqAt,
        processed_at: Date.now(),
      });
      return { ok: true, mode: selectedMode, issued: true, response: rpcRes };
    } catch (e) {
      throw new Error(e.message || '국세청 실전송 실패');
    }
  }
  const now = Date.now();
  const attemptNo = Number(invoice.nts_attempt_count || 0) + 1;
  await API.patch('project_invoices', invId, {
    nts_issue_status: 'requested',
    nts_issue_requested_at: now,
    nts_issue_requested_by: String(session?.id || ''),
    nts_issue_requested_by_name: String(session?.name || ''),
    nts_attempt_count: attemptNo,
    nts_last_error: '',
  });
  await _pmWriteNtsIssueLog({
    invoice_id: invId,
    project_code: projectCode,
    issue_mode: selectedMode,
    issue_status: 'requested',
    attempt_no: attemptNo,
    request_payload: invoice.request_payload || {},
    requested_by: String(session?.id || ''),
    requested_by_name: String(session?.name || ''),
    requested_at: now,
    processed_at: now,
  });
  return { ok: true, mode: selectedMode, queued: true };
}

async function _pmRunNtsAutoIssue() {
  if (PM_STATE.ntsAutoRunning) return;
  const now = Date.now();
  if (now - Number(PM_STATE.ntsAutoRunAt || 0) < 30000) return;
  const session = getSession ? getSession() : null;
  if (!_pmCanIssueInvoice(session)) return;
  PM_STATE.ntsAutoRunning = true;
  PM_STATE.ntsAutoRunAt = now;
  try {
    const rows = await API.listAllPages('project_invoices', { limit: 300, maxPages: 10, sort: 'updated_at' }).catch(() => []);
    const allowed = new Set((PM_STATE.projects || []).map((p) => String(p.project_code || '').trim()).filter(Boolean));
    const today = _pmTodayDateText();
    const targets = (rows || []).filter((r) => {
      if (!allowed.has(String(r.project_code || '').trim())) return false;
      const st = String(r.nts_issue_status || '').trim();
      if (!['pending', 'requested', 'failed'].includes(st)) return false;
      const planned = String(r.planned_issue_date || '').trim();
      if (!planned) return false;
      return planned <= today;
    }).slice(0, 20);
    for (const r of targets) {
      try {
        await issueTaxInvoice(r.id, PM_NTS_DEFAULT_MODE);
      } catch (e) {
        console.warn('[pm] auto issue skip', r.id, e);
      }
    }
  } finally {
    PM_STATE.ntsAutoRunning = false;
  }
}

async function pmSendInvoiceToNts(id) {
  const session = getSession ? getSession() : null;
  if (!_pmCanIssueInvoice(session)) {
    Toast.warning('국세청 전송은 경영지원팀만 가능합니다.');
    return;
  }
  try {
    const res = await issueTaxInvoice(id, PM_NTS_DEFAULT_MODE);
    if (res && res.issued) Toast.success('국세청 전송 완료');
    else Toast.success('국세청 전송요청 큐에 등록되었습니다.');
    await loadProjectMgmtInvoices();
  } catch (e) {
    Toast.error(e.message || '국세청 전송 실패');
  }
}

async function saveProjectCostItem() {
  const session = getSession();
  if (!(Auth.canApprove1st(session) || Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session))) {
    Toast.warning('비용 등록 권한이 없습니다.');
    return;
  }
  const projectCode = String(document.getElementById('pm-cost-project')?.value || '').trim();
  if (!projectCode) {
    Toast.warning('프로젝트를 선택하세요.');
    return;
  }
  if (!_pmHasProjectAccess(projectCode)) {
    Toast.warning('해당 프로젝트 접근 권한이 없습니다.');
    return;
  }
  const project = PM_STATE.projectByCode[projectCode] || {};
  const amount = Number(document.getElementById('pm-cost-amount')?.value || 0);
  const vat = Number(document.getElementById('pm-cost-vat')?.value || 0);
  const total = amount + vat;
  if (amount <= 0 && vat <= 0) {
    Toast.warning('비용 금액을 입력하세요.');
    return;
  }
  try {
    await API.create('project_cost_items', {
      project_id: project.id || '',
      project_code: projectCode,
      project_name: project.project_name || '',
      client_id: project.client_id || '',
      client_name: project.client_name || '',
      cost_date: document.getElementById('pm-cost-date')?.value || null,
      cost_type: document.getElementById('pm-cost-type')?.value || '',
      vendor: document.getElementById('pm-cost-vendor')?.value || '',
      amount,
      vat,
      total_amount: total,
      created_by: session.id,
      created_by_name: session.name || '',
    });
    document.getElementById('pm-cost-amount').value = '';
    document.getElementById('pm-cost-vat').value = '';
    document.getElementById('pm-cost-type').value = '';
    document.getElementById('pm-cost-vendor').value = '';
    Toast.success('비용 항목을 추가했습니다.');
    await loadProjectMgmtCosts();
  } catch (e) {
    console.error(e);
    Toast.error('비용 저장 실패: ' + (e.message || ''));
  }
}

async function loadProjectMgmtCosts() {
  const body = document.getElementById('pm-cost-body');
  if (!body) return;
  const projectCode = String(document.getElementById('pm-cost-project')?.value || '').trim();
  const allowedCodes = new Set((PM_STATE.projects || []).map((p) => String(p.project_code || '').trim()).filter(Boolean));
  try {
    let rows = await API.listAllPages('project_cost_items', { limit: 600, maxPages: 20, sort: 'updated_at' }).catch(() => []);
    rows = rows.filter((r) => allowedCodes.has(String(r.project_code || '').trim()));
    if (projectCode) rows = rows.filter((r) => String(r.project_code || '') === projectCode);
    let sum = 0;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="10" class="table-empty"><i class="fas fa-receipt"></i><p>등록된 비용이 없습니다.</p></td></tr>';
      document.getElementById('pm-cost-summary').textContent = '총 비용 0원';
      return;
    }
    body.innerHTML = rows.map((r, i) => {
      const total = Number(r.total_amount || r.amount || 0);
      sum += total;
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${_pmEsc(r.project_code || '-')}</td>
        <td>${_pmEsc(r.cost_date || '-')}</td>
        <td>${_pmEsc(r.cost_type || '-')}</td>
        <td>${_pmEsc(r.vendor || '-')}</td>
        <td style="text-align:right">${_pmKrw(r.amount || 0)}</td>
        <td style="text-align:right">${_pmKrw(r.vat || 0)}</td>
        <td style="text-align:right">${_pmKrw(total)}</td>
        <td>${_pmEsc(r.note || '')}</td>
        <td style="text-align:center">
          <button type="button" class="btn btn-sm btn-outline" onclick="pmDeleteCostItem('${_pmEsc(r.id)}')"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
    document.getElementById('pm-cost-summary').textContent = `총 비용 ${_pmKrw(sum)}`;
  } catch (e) {
    console.error(e);
    body.innerHTML = '<tr><td colspan="10" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>비용 조회 실패</p></td></tr>';
  }
}

async function loadProjectMgmtContracts() {
  const body = document.getElementById('pm-contract-body');
  const summary = document.getElementById('pm-contract-summary');
  if (!body) return;
  const session = getSession ? getSession() : null;
  try {
    const rows = await API.listAllPages('registered_projects', { limit: 500, maxPages: 20, sort: 'updated_at' });
    const list = _pmFilterProjectsByScope(rows, session)
      .filter((r) => String(r.project_code || '').trim() !== '');
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-file-contract"></i><p>등록된 프로젝트가 없습니다.</p></td></tr>';
      if (summary) summary.textContent = '계약서 누락 0건';
      return;
    }
    let missingCount = 0;
    body.innerHTML = list.map((r, i) => {
      const contractName = String(r.contract_file_name || '').trim();
      const contractUrl = String(r.contract_file_url || '').trim();
      const evidenceName = String(r.contract_evidence_file_name || '').trim();
      const evidenceUrl = String(r.contract_evidence_file_url || '').trim();
      const routeName = String(r.order_evidence_file_name || '').trim();
      const routeUrl = String(r.order_evidence_file_url || '').trim();
      const isMissing = !contractName;
      if (isMissing) missingCount += 1;
      const statusTxt = isMissing ? '누락' : '정상';
      const statusColor = isMissing ? '#b45309' : '#047857';
      const statusBg = isMissing ? '#fef3c7' : '#d1fae5';
      const fileCell = (name, url) => {
        if (!name) return '<span style="color:var(--text-muted)">-</span>';
        if (!url) return `<span title="${_pmEsc(name)}">${_pmEsc(name)}</span>`;
        return `<a href="${_pmEsc(url)}" target="_blank" rel="noopener noreferrer" title="${_pmEsc(name)}">${_pmEsc(name)}</a>`;
      };
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${_pmEsc(r.project_code || '-')}</td>
        <td title="${_pmEsc(r.project_name || '')}">${_pmEsc(r.project_name || '-')}</td>
        <td title="${_pmEsc(r.client_name || '')}">${_pmEsc(r.client_name || '-')}</td>
        <td style="text-align:center">
          <span style="display:inline-flex;align-items:center;justify-content:center;min-width:56px;padding:2px 8px;border-radius:999px;background:${statusBg};color:${statusColor};font-size:11px;font-weight:700">${statusTxt}</span>
        </td>
        <td>${fileCell(contractName, contractUrl)}</td>
        <td>${fileCell(evidenceName, evidenceUrl)}</td>
        <td>${fileCell(routeName, routeUrl)}</td>
      </tr>`;
    }).join('');
    if (summary) summary.textContent = `계약서 누락 ${missingCount}건 / 전체 ${list.length}건`;
  } catch (e) {
    console.error(e);
    body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>계약서 관리 조회 실패</p></td></tr>';
    if (summary) summary.textContent = '계약서 조회 실패';
  }
}

async function pmDeleteCostItem(id) {
  const ok = await Confirm.open({ title: '비용 삭제', message: '선택한 비용 항목을 삭제하시겠습니까?', confirmText: '삭제', cancelText: '취소' });
  if (!ok) return;
  try {
    await API.delete('project_cost_items', id);
    await loadProjectMgmtCosts();
    Toast.success('비용 항목을 삭제했습니다.');
  } catch (e) {
    console.error(e);
    Toast.error('삭제 실패: ' + (e.message || ''));
  }
}

window.switchProjectMgmtTab = switchProjectMgmtTab;
window.applyProjectPageMode = applyProjectPageMode;
window.init_project_management = init_project_management;
window.loadProjectMgmtProgress = loadProjectMgmtProgress;
window.loadProjectMgmtTimeCharge = loadProjectMgmtTimeCharge;
window.loadProjectMgmtInvoices = loadProjectMgmtInvoices;
window.loadProjectMgmtCosts = loadProjectMgmtCosts;
window.loadProjectMgmtContracts = loadProjectMgmtContracts;
window.importTimeChargeFromEntries = importTimeChargeFromEntries;
window.saveTimeChargeLines = saveTimeChargeLines;
window.requestTimeChargeInvoice = requestTimeChargeInvoice;
window.createInvoiceRequestFromBatch = createInvoiceRequestFromBatch;
window.pmSaveInvoiceRow = pmSaveInvoiceRow;
window.issueTaxInvoice = issueTaxInvoice;
window.pmSendInvoiceToNts = pmSendInvoiceToNts;
window.pmRunInvoiceDataQualityCheck = pmRunInvoiceDataQualityCheck;
window.pmOpenInvoiceProjectDetail = pmOpenInvoiceProjectDetail;
window.pmCloseInvoiceProjectDetail = pmCloseInvoiceProjectDetail;
window.pmOpenPrevInvoiceProjectDetail = pmOpenPrevInvoiceProjectDetail;
window.pmOpenNextInvoiceProjectDetail = pmOpenNextInvoiceProjectDetail;
window.saveProjectCostItem = saveProjectCostItem;
window.pmDeleteCostItem = pmDeleteCostItem;
window.pmOpenLifecycleAction = pmOpenLifecycleAction;
window.pmAdjustLifecycleStatus = pmAdjustLifecycleStatus;
