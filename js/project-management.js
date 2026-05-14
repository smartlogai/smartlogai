/* project-management.js — 프로젝트관리 통합(All-in MVP) */
'use strict';

const PM_STATE = {
  initialized: false,
  currentTab: 'progress',
  pageMode: 'register',
  projects: [],
  projectByCode: {},
  projectCodeTypes: [],
  users: [],
  usersById: {},
  progressRowById: {},
  progressDetailProject: null,
  progressDetailTab: 'ops',
  progressAssistantRows: [],
  currentBatch: null,
  currentLines: [],
  invoiceDetailProjectCode: '',
  invoiceDetailProjectCodes: [],
  invoiceRowsByProject: {},
  invoicePlanSelection: {},
  billableCostRowsByProject: {},
  timeChargeClientCatalog: [],
  timechargeViewTab: 'overall',
  timechargeDocTab: 'status',
  timechargeDetailConsultantKey: '',
  timechargeInvoiceGeneratedByBatch: {},
  invoiceBillableExpanded: false,
  invoicePreviewConfirmed: false,
  invoicePreviewProjectCode: '',
  invoicePreviewMonth: '',
  expenseRows: [],
  expenseSummarySelectedCode: '',
  pendingExpenseUploadRows: [],
  pendingExpenseUploadMeta: null,
  pendingTimeChargeUploadRows: [],
  pendingTimeChargeUploadMeta: null,
  lastExpenseUploadBatchId: '',
  lastExpenseUploadBatchCreated: 0,
  customerInvoiceDraft: null,
  invoiceListTab: 'planned',
  invoiceDelayNotifySent: {},
  ntsAutoRunAt: 0,
  ntsAutoRunning: false,
  standardRateMasterRows: [],
  standardRateMasterLoadedAt: 0,
  projectsLoadedAt: 0,
  usersLoadedAt: 0,
  progressExportRows: [],
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
const PM_INVOICE_EMAIL_FUNCTION = 'send_notification_email';
const PM_ASSISTANT_PROJECT_ROLE_OPTIONS = Object.freeze([
  { value: '실무 책임자', labelKo: '실무 책임자', labelBi: '실무 책임자 (Project Manager)' },
  { value: '핵심 실무자', labelKo: '핵심 실무자', labelBi: '핵심 실무자 (In-charge / Senior Consultant)' },
  { value: '지원 실무자', labelKo: '지원 실무자', labelBi: '지원 실무자 (전임/선임/책임)' },
  { value: '전문 자문역', labelKo: '전문 자문역', labelBi: '전문 자문역 (Advisor)' },
  { value: '기타', labelKo: '기타', labelBi: '기타' },
]);

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

function _pmParseAmountInput(v) {
  const digits = String(v || '').replace(/[^\d]/g, '');
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function _pmFormatAmountInput(v) {
  const n = _pmParseAmountInput(v);
  return n > 0 ? n.toLocaleString('ko-KR') : '';
}

function _pmFormatPaidAmountInput(v) {
  const n = _pmParseAmountInput(v);
  return n.toLocaleString('ko-KR');
}

function _pmBillingScheduleObject(raw) {
  let src = raw;
  if (typeof src === 'string') {
    try { src = JSON.parse(src); } catch (_) { src = null; }
  }
  return (src && typeof src === 'object') ? src : null;
}

function _pmProjectHasContractOrEvidence(row) {
  if (!row || typeof row !== 'object') return false;
  const contractName = String(row.contract_file_name || '').trim();
  const contractUrl = String(row.contract_file_url || '').trim();
  const evidenceName = String(row.contract_evidence_file_name || '').trim();
  const evidenceUrl = String(row.contract_evidence_file_url || '').trim();
  return !!(contractName || contractUrl || evidenceName || evidenceUrl);
}

function _pmMissingBillingDueDateLabels(rawBilling) {
  const billing = _pmBillingScheduleObject(rawBilling);
  if (!billing) return [];
  const plan = [
    { key: 'down', label: '착수금' },
    { key: 'interim', label: '중도금' },
    { key: 'final', label: '잔금' },
    { key: 'additional', label: '추가청구' },
    { key: 'success', label: '성과보수' },
  ];
  const missing = [];
  plan.forEach(({ key, label }) => {
    const value = billing[key];
    const entries = Array.isArray(value) ? value : [value];
    let needDue = false;
    let hasDue = false;
    entries.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const amount = Number(entry.amount || entry.invoice_amount || 0);
      const due = String(entry.due_date || entry.expected_date || '').trim();
      if (Number.isFinite(amount) && amount > 0) needDue = true;
      if (due) hasDue = true;
    });
    if (needDue && !hasDue) missing.push(label);
  });
  return missing;
}

function _pmInvoiceTaxAmounts(supplyAmount, vatRate = 0.1) {
  const supply = Math.max(0, Math.round(Number(supplyAmount || 0)));
  const rate = Number.isFinite(Number(vatRate)) ? Math.max(0, Number(vatRate)) : 0.1;
  const vat = Math.round(supply * rate);
  const total = supply + vat;
  return { supply, vatRate: rate, vat, total };
}

function _pmInvoiceTaxProfile(taxTypeRaw) {
  const type = String(taxTypeRaw || 'taxable').trim();
  if (type === 'zero_rated') return { taxType: 'zero_rated', vatRate: 0 };
  if (type === 'exempt') return { taxType: 'exempt', vatRate: 0 };
  return { taxType: 'taxable', vatRate: 0.1 };
}

function _pmInvoicePayload(row) {
  const src = row?.request_payload;
  if (!src) return {};
  if (typeof src === 'object') return src || {};
  if (typeof src !== 'string') return {};
  try {
    return JSON.parse(src);
  } catch (_) {
    return {};
  }
}

function _pmInvoiceGrossAmount(row) {
  const total = Number(row?.total_amount || 0);
  if (total > 0) return Math.round(total);
  const supply = Math.max(0, Number(row?.invoice_amount || 0));
  const vat = Math.max(0, Number(row?.vat_amount || 0));
  if (supply > 0 || vat > 0) return Math.round(supply + vat);
  return Math.round(supply);
}

function _pmInvoiceEffectivePaidAmount(row) {
  const gross = _pmInvoiceGrossAmount(row);
  const paid = Math.max(0, Number(row?.paid_amount || 0));
  const status = String(row?.payment_status || row?._derived_status || '').trim();
  // 레거시 데이터 호환:
  // VAT 별도 정책 이전에 paid 상태가 공급가액만 저장된 케이스는 총액 기준으로 보정
  if (status === 'paid' && paid < gross) return gross;
  return paid;
}

function _pmInvoiceOutstandingAmount(row) {
  return Math.max(0, _pmInvoiceGrossAmount(row) - _pmInvoiceEffectivePaidAmount(row));
}

async function _pmLoadInvoicePaymentRows(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code) return [];
  let rows = [];
  try {
    rows = await API.listAllPages('project_invoice_payments', { limit: 1000, maxPages: 20, sort: 'created_at' }).catch(() => []);
  } catch (_) {
    rows = [];
  }
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((r) => String(r.project_code || '').trim() === code);
}

function _pmInvoicePaymentMap(paymentRows) {
  const out = {};
  (Array.isArray(paymentRows) ? paymentRows : []).forEach((r) => {
    const invoiceId = String(r?.invoice_id || '').trim();
    if (!invoiceId) return;
    if (!out[invoiceId]) out[invoiceId] = { sum: 0, latestDate: '', count: 0 };
    const amt = Math.max(0, Number(r?.paid_amount || 0));
    out[invoiceId].sum += amt;
    out[invoiceId].count += 1;
    const d = String(r?.paid_date || '').trim();
    if (d && (!out[invoiceId].latestDate || d > out[invoiceId].latestDate)) out[invoiceId].latestDate = d;
  });
  return out;
}

function _pmInvoicePaidAmountWithHistory(invoiceRow, paymentMap) {
  const invoiceId = String(invoiceRow?.id || '').trim();
  const mapped = paymentMap && paymentMap[invoiceId];
  if (mapped && mapped.sum > 0) return Math.round(mapped.sum);
  return Math.round(_pmInvoiceEffectivePaidAmount(invoiceRow));
}

function _pmRenderInvoicePaymentHistoryTable(invoiceRows, paymentRows) {
  const body = document.getElementById('pm-inv-payment-body');
  if (!body) return;
  const invoices = Array.isArray(invoiceRows) ? invoiceRows : [];
  const payments = Array.isArray(paymentRows) ? paymentRows : [];
  if (!payments.length) {
    body.innerHTML = '<tr><td colspan="6" class="table-empty"><i class="fas fa-coins"></i><p>입금 이력이 없습니다.</p></td></tr>';
    return;
  }
  const invById = {};
  invoices.forEach((r) => { invById[String(r.id || '').trim()] = r; });
  const sorted = [...payments].sort((a, b) => {
    const da = String(a.paid_date || '').trim();
    const db = String(b.paid_date || '').trim();
    if (da !== db) return db.localeCompare(da);
    return Number(b.created_at || 0) - Number(a.created_at || 0);
  });
  body.innerHTML = sorted.map((r, i) => {
    const inv = invById[String(r.invoice_id || '').trim()] || {};
    const issueDate = String(inv.issue_date || '').trim() || '-';
    const invNo = String(inv.invoice_no || '').trim() || '-';
    const memo = String(r.note || '').trim();
    return `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td style="text-align:center">${_pmEsc(issueDate)}</td>
      <td style="text-align:center" title="${_pmEsc(invNo)}">${_pmEsc(invNo)}</td>
      <td style="text-align:center">${_pmEsc(String(r.paid_date || '').trim() || '-')}</td>
      <td style="text-align:right">${_pmKrw(r.paid_amount || 0)}</td>
      <td title="${_pmEsc(memo)}">${_pmEsc(memo || '-')}</td>
    </tr>`;
  }).join('');
}

function _pmInvoiceBizCertMetaFromRow(row) {
  const payload = _pmInvoicePayload(row);
  const url = String(payload.biz_cert_file_url || '').trim();
  const name = String(payload.biz_cert_file_name || '').trim();
  const uploadedAt = Number(payload.biz_cert_uploaded_at || 0);
  const uploadedBy = String(payload.biz_cert_uploaded_by_name || '').trim();
  const ocrStatus = String(payload.biz_cert_ocr_status || '').trim();
  const ocrUpdatedAt = Number(payload.biz_cert_ocr_updated_at || 0);
  return { url, name, uploadedAt, uploadedBy, ocrStatus, ocrUpdatedAt };
}

function _pmRenderInvoiceBizCertMeta(meta) {
  const el = document.getElementById('pm-inv-biz-cert-meta');
  if (!el) return;
  const m = meta && typeof meta === 'object' ? meta : {};
  const name = String(m.name || '').trim();
  const url = String(m.url || '').trim();
  const uploadedAt = Number(m.uploadedAt || 0);
  const by = String(m.uploadedBy || '').trim();
  const ocrStatus = String(m.ocrStatus || '').trim();
  const ocrUpdatedAt = Number(m.ocrUpdatedAt || 0);
  if (!name && !url) {
    el.textContent = '첨부 파일 없음';
    return;
  }
  const label = name || '사업자등록증';
  const dateText = uploadedAt ? _pmTsToDateText(uploadedAt) : '';
  const byText = by ? ` · 업로더 ${by}` : '';
  const metaText = dateText ? ` (${dateText}${byText})` : (by ? ` (${by})` : '');
  let ocrText = '';
  if (ocrStatus) {
    const statusMap = {
      pending: 'OCR 대기',
      processing: 'OCR 처리중',
      done: 'OCR 완료',
      failed: 'OCR 실패',
    };
    const stLabel = statusMap[ocrStatus] || `OCR ${ocrStatus}`;
    const stDate = ocrUpdatedAt ? ` · ${_pmTsToDateText(ocrUpdatedAt)}` : '';
    ocrText = ` · ${stLabel}${stDate}`;
  }
  el.innerHTML = url
    ? `<a href="${_pmEsc(url)}" target="_blank" rel="noopener noreferrer">${_pmEsc(label)}</a>${_pmEsc(metaText + ocrText)}`
    : `${_pmEsc(label)}${_pmEsc(metaText + ocrText)}`;
}

function _pmPickInvoiceBizCertFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const sorted = [...list].sort((a, b) => Number(b.updated_at || b.created_at || 0) - Number(a.updated_at || a.created_at || 0));
  for (const row of sorted) {
    const meta = _pmInvoiceBizCertMetaFromRow(row);
    if (meta.url || meta.name) return meta;
  }
  return { url: '', name: '', uploadedAt: 0, uploadedBy: '', ocrStatus: '', ocrUpdatedAt: 0 };
}

function _pmClearInvoiceBizCertInput() {
  const fileEl = document.getElementById('pm-inv-biz-cert-file');
  if (fileEl) fileEl.value = '';
}

async function _pmUploadInvoiceBizCert(projectCode, file, session) {
  if (!file) return { name: '', url: '', uploadedAt: 0, uploadedBy: '' };
  const rawName = String(file.name || 'biz-cert').trim() || 'biz-cert';
  const safeName = rawName.replace(/[^\w.\-가-힣]/g, '_');
  const code = String(projectCode || 'UNKNOWN').replace(/[^\w\-]/g, '_');
  const ts = Date.now();
  const path = `${code}/${ts}_${safeName}`;
  const buckets = ['project-invoice-docs', 'project-outputs'];
  let uploaded = null;
  let lastErr = null;
  for (const bucket of buckets) {
    try {
      uploaded = await API.storageUpload(bucket, path, file, { upsert: false });
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!uploaded) throw (lastErr || new Error('사업자등록증 업로드 실패'));
  return {
    name: rawName,
    url: String(uploaded.publicUrl || '').trim(),
    uploadedAt: ts,
    uploadedBy: String(session?.name || session?.user_name || '').trim(),
  };
}

function _pmHasUnknownColumnError(e, cols) {
  const msg = String(e?.message || e || '').toLowerCase();
  if (!msg) return false;
  return (cols || []).some((c) => msg.includes(String(c || '').toLowerCase()));
}

function _pmStripObjectKeys(src, keys) {
  const out = { ...(src || {}) };
  (keys || []).forEach((k) => { delete out[k]; });
  return out;
}

async function _pmListAllPagesSortFallback(table, params = {}, sortCandidates = ['updated_at', 'created_at']) {
  const base = { ...(params || {}) };
  const explicitSort = String(base.sort || '').trim();
  if (explicitSort) {
    try {
      return await API.listAllPages(table, base);
    } catch (e) {
      if (!_pmHasUnknownColumnError(e, [explicitSort])) throw e;
    }
  }
  for (const sort of (sortCandidates || [])) {
    const key = String(sort || '').trim();
    if (!key) continue;
    try {
      return await API.listAllPages(table, { ...base, sort: key });
    } catch (e) {
      if (!_pmHasUnknownColumnError(e, [key])) throw e;
    }
  }
  const noSort = { ...base };
  delete noSort.sort;
  return API.listAllPages(table, noSort);
}

async function _pmCreateInvoiceCompat(payload) {
  const vatCols = ['tax_type', 'vat_rate', 'vat_amount', 'total_amount'];
  try {
    return await API.create('project_invoices', payload);
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    if (msg.includes('project_invoices_tax_type_chk') || msg.includes('violates check constraint')) {
      const taxSafe = {
        ...(payload || {}),
        tax_type: String(payload?.tax_type || '') === 'zero_rated' ? 'exempt' : payload?.tax_type,
        vat_rate: 0,
        vat_amount: 0,
        total_amount: Number(payload?.total_amount || payload?.invoice_amount || 0),
      };
      return API.create('project_invoices', taxSafe);
    }
    if (!_pmHasUnknownColumnError(e, vatCols)) throw e;
    const fallback = _pmStripObjectKeys(payload, vatCols);
    return API.create('project_invoices', fallback);
  }
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

function _pmAddDays(dateStr, days) {
  const s = String(dateStr || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [yy, mm, dd] = s.split('-').map(Number);
  const d = new Date(yy, mm - 1, dd);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function _pmEnsureXlsx() {
  if (typeof XLSX !== 'undefined') return true;
  try {
    if (typeof LibLoader !== 'undefined' && LibLoader.load) {
      await LibLoader.load('xlsx');
    } else {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/xlsx.full.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('XLSX 로드 실패'));
        document.head.appendChild(s);
      });
    }
  } catch (e) {
    console.error(e);
    return false;
  }
  return typeof XLSX !== 'undefined';
}

function _pmCostUploadMonth() {
  const ids = ['pm-exp-upload-month', 'analysis-project-profit-labor-month', 'pm-cost-upload-month'];
  for (const id of ids) {
    const ym = String(document.getElementById(id)?.value || '').trim();
    if (/^\d{4}-\d{2}$/.test(ym)) return ym;
  }
  return '';
}

function _pmCostDateInRange(costDate, from, to) {
  const d = String(costDate || '').slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function _pmCostUploadMessage(type, message) {
  const candidates = [
    document.getElementById('pm-exp-upload-result'),
    document.getElementById('pm-labor-upload-result'),
    document.getElementById('pm-cost-upload-result'),
  ];
  const visible = candidates.find((node) => node && node.offsetParent !== null);
  const el = visible || candidates.find((node) => node) || null;
  if (!el) return;
  const color = {
    success: { bg: '#dcfce7', bd: '#86efac', fg: '#166534', icon: 'fa-check-circle' },
    warning: { bg: '#fef9c3', bd: '#fde047', fg: '#854d0e', icon: 'fa-exclamation-triangle' },
    error: { bg: '#fee2e2', bd: '#fca5a5', fg: '#991b1b', icon: 'fa-times-circle' },
  }[type] || { bg: '#e2e8f0', bd: '#cbd5e1', fg: '#334155', icon: 'fa-info-circle' };
  el.style.display = '';
  el.innerHTML = `<div style="padding:9px 12px;background:${color.bg};border:1px solid ${color.bd};border-radius:6px;font-size:12.5px;color:${color.fg};line-height:1.6"><i class="fas ${color.icon}" style="margin-right:5px"></i>${message}</div>`;
}

function _pmParseXlsxRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function _pmParseMoney(val) {
  const n = Number(String(val == null ? '' : val).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function _pmNormalizeExpenseDateInput(val) {
  if (val == null) return '';
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    const serial = Math.floor(val);
    if (typeof XLSX !== 'undefined' && XLSX.SSF && typeof XLSX.SSF.parse_date_code === 'function') {
      const parsed = XLSX.SSF.parse_date_code(serial);
      if (parsed && parsed.y && parsed.m && parsed.d) {
        return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
      }
    }
    // Excel serial date fallback (1900 date system)
    const base = new Date(Date.UTC(1899, 11, 30));
    base.setUTCDate(base.getUTCDate() + serial);
    return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(base.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(val).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}[./]\d{1,2}[./]\d{1,2}$/.test(s)) {
    const t = s.replace(/\./g, '/').split('/');
    const yy = Number(t[0] || 0);
    const mm = Number(t[1] || 0);
    const dd = Number(t[2] || 0);
    if (yy > 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
  }
  if (/^\d{8}$/.test(s)) {
    const yy = Number(s.slice(0, 4));
    const mm = Number(s.slice(4, 6));
    const dd = Number(s.slice(6, 8));
    if (yy > 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
  }
  return '';
}

function _pmExpenseRowDedupKey(row) {
  const code = String(row?.project_code || '').trim();
  const date = String(row?.expense_date || '').slice(0, 10);
  const type = String(row?.expense_type || '').trim();
  const amount = Math.max(0, Number(row?.amount || 0)).toFixed(2);
  const detail = String(row?.vendor || '').trim();
  const note = String(row?.note || '').trim();
  return [code, date, type, amount, detail, note].join('|');
}

function _pmExpenseRowSortCompare(a, b) {
  const ad = String(a?.expense_date || '').slice(0, 10);
  const bd = String(b?.expense_date || '').slice(0, 10);
  if (ad && bd && ad !== bd) return ad < bd ? -1 : 1; // 과거순
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;

  const ac = String(a?.project_code || '').trim();
  const bc = String(b?.project_code || '').trim();
  if (ac !== bc) return ac.localeCompare(bc);

  const ar = Number(a?.source_row_no || 0);
  const br = Number(b?.source_row_no || 0);
  if (ar !== br) return ar - br;

  const au = Number(a?.updated_at || a?.created_at || 0);
  const bu = Number(b?.updated_at || b?.created_at || 0);
  return au - bu;
}

function _pmRenderPendingExpenseActions() {
  const wrap = document.getElementById('pm-exp-pending-actions');
  const saveBtn = document.getElementById('pm-exp-upload-save-btn');
  const cancelBtn = document.getElementById('pm-exp-upload-cancel-btn');
  const deleteBtn = document.getElementById('pm-exp-upload-delete-last-btn');
  const summaryEl = document.getElementById('pm-exp-pending-summary');
  if (!wrap) return;
  const pendingCount = Array.isArray(PM_STATE.pendingExpenseUploadRows) ? PM_STATE.pendingExpenseUploadRows.length : 0;
  const hasPending = pendingCount > 0;
  const hasLastBatch = !!String(PM_STATE.lastExpenseUploadBatchId || '').trim();
  wrap.style.display = (hasPending || hasLastBatch) ? '' : 'none';
  if (saveBtn) saveBtn.style.display = hasPending ? '' : 'none';
  if (cancelBtn) cancelBtn.style.display = hasPending ? '' : 'none';
  if (deleteBtn) deleteBtn.style.display = hasLastBatch ? '' : 'none';
  if (summaryEl) {
    if (hasPending) {
      const meta = PM_STATE.pendingExpenseUploadMeta || {};
      const ym = String(meta.ym || '');
      const fileName = String(meta.fileName || '');
      const totalRows = Number(meta.totalRows || 0);
      const skippedRows = Number(meta.skippedRows || 0);
      const pendingAmount = Math.max(0, Number(meta.pendingAmount || 0));
      const sourceAmount = Math.max(0, Number(meta.sourceAmount || 0));
      const verifyRowsOk = !!meta.verifyRowsOk;
      const verifyAmountOk = !!meta.verifyAmountOk;
      if (saveBtn) {
        saveBtn.disabled = !(verifyRowsOk && verifyAmountOk && pendingCount > 0);
      }
      summaryEl.innerHTML = `
        <div class="pm-exp-verify-top">${ym ? `<b>${_pmEsc(ym)}</b> · ` : ''}${fileName ? `<b>${_pmEsc(fileName)}</b>` : ''}</div>
        <div class="pm-exp-verify-grid">
          <div class="pm-exp-verify-item"><span class="k">파일 행수</span><span class="v">${totalRows.toLocaleString('ko-KR')}</span></div>
          <div class="pm-exp-verify-item"><span class="k">저장대기 행수</span><span class="v">${pendingCount.toLocaleString('ko-KR')}</span></div>
          <div class="pm-exp-verify-item"><span class="k">스킵 행수</span><span class="v">${skippedRows.toLocaleString('ko-KR')}</span></div>
        </div>
        <div class="pm-exp-verify-grid">
          <div class="pm-exp-verify-item"><span class="k">파일 금액(원)</span><span class="v">${sourceAmount.toLocaleString('ko-KR')}</span></div>
          <div class="pm-exp-verify-item"><span class="k">저장대기 금액(원)</span><span class="v">${pendingAmount.toLocaleString('ko-KR')}</span></div>
          <div class="pm-exp-verify-item"><span class="k">검증 상태</span><span class="v ${verifyRowsOk && verifyAmountOk ? 'ok' : 'warn'}">${verifyRowsOk && verifyAmountOk ? '정상' : '확인 필요'}</span></div>
        </div>
      `;
    } else if (hasLastBatch) {
      if (saveBtn) saveBtn.disabled = true;
      summaryEl.textContent = '방금 저장한 배치를 삭제할 수 있습니다.';
    } else {
      if (saveBtn) saveBtn.disabled = true;
      summaryEl.textContent = '';
    }
  }
}

function _pmSetPendingExpenseRows(rows, meta = null) {
  PM_STATE.pendingExpenseUploadRows = Array.isArray(rows) ? rows : [];
  PM_STATE.pendingExpenseUploadMeta = meta || null;
  _pmRenderPendingExpenseActions();
  _pmUpdateExpenseRequestButtonState();
}

function _pmCostTypeNorm(type) {
  const t = String(type || '').trim().toLowerCase();
  if (!t) return '직접비용';
  if (t.includes('간접')) return '간접비';
  if (t.includes('직접인건') || t.includes('인건비') || t.includes('labor')) return '직접비용';
  return '직접비용';
}

function _pmIsLaborCostType(type) {
  const t = String(type || '').trim().toLowerCase();
  return t.includes('직접인건') || t.includes('인건비') || t.includes('labor');
}

function _pmExpenseBillingStatusNorm(v) {
  return _pmBillingStatusNorm(v);
}

function _pmCostPurposeNorm(v) {
  const t = String(v || '').trim().toLowerCase();
  if (t === 'billable') return 'billable';
  if (t === 'both') return 'both';
  return 'internal';
}

function _pmBillingStatusNorm(v) {
  const t = String(v || '').trim().toLowerCase();
  if (t === 'requested') return 'requested';
  if (t === 'billed') return 'billed';
  if (t === 'paid') return 'paid';
  if (t === 'excluded') return 'excluded';
  return 'unbilled';
}

function _pmCostPurposeLabel(v) {
  const t = _pmCostPurposeNorm(v);
  if (t === 'billable') return '고객청구';
  if (t === 'both') return '공통';
  return '내부원가';
}

function _pmBillingStatusLabel(v) {
  const t = _pmBillingStatusNorm(v);
  if (t === 'requested') return '청구요청';
  if (t === 'billed') return '청구완료';
  if (t === 'paid') return '입금완료';
  if (t === 'excluded') return '청구제외';
  return '미청구';
}

async function _pmDeleteAutoRowsByTag(ym, tag) {
  const mark = `[AUTO_COST_ALLOC:${tag}:${ym}]`;
  const allowedCodes = new Set((PM_STATE.projects || []).map((p) => String(p.project_code || '').trim()).filter(Boolean));
  let rows = await API.listAllPages('project_cost_items', { limit: 3000, maxPages: 50, sort: 'updated_at' }).catch(() => []);
  rows = rows.filter((r) =>
    allowedCodes.has(String(r.project_code || '').trim()) &&
    String(r.note || '').includes(mark)
  );
  for (const r of rows) {
    await API.delete('project_cost_items', r.id);
  }
  return rows.length;
}

async function _pmCreateAllocatedProjectCostRows({ ym, tag, costType, amountByCode, noteTail }) {
  const session = getSession();
  const costDate = `${ym}-01`;
  const mark = `[AUTO_COST_ALLOC:${tag}:${ym}]`;
  let created = 0;
  for (const [code, amountRaw] of Object.entries(amountByCode || {})) {
    const amount = Math.round(Number(amountRaw || 0));
    if (!(amount > 0)) continue;
    if (!_pmHasProjectAccess(code)) continue;
    const p = PM_STATE.projectByCode[code] || {};
    await API.create('project_cost_items', {
      project_id: p.id || '',
      project_code: code,
      project_name: p.project_name || '',
      client_id: p.client_id || '',
      client_name: p.client_name || '',
      cost_date: costDate,
      cost_type: costType,
      vendor: '월배부',
      amount,
      vat: 0,
      total_amount: amount,
      cost_purpose: 'internal',
      billable_amount: 0,
      billable_currency: 'KRW',
      billable_fx_amount: 0,
      billing_status: 'excluded',
      note: `${mark} ${noteTail || ''}`.trim(),
      created_by: session && session.id ? session.id : '',
      created_by_name: session && session.name ? session.name : '',
    });
    created += 1;
  }
  return created;
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

function _pmIsProjectInProgress(project) {
  const raw = String(project?.lifecycle_status_override || project?.lifecycle_status || '').trim().toLowerCase();
  const byStatus = (raw === 'in_progress' || raw === '수행중' || raw === '진행중');
  if (byStatus) return true;
  // 정책 변경: CPM + 수행시작일 + 투입인력현황 작성 시 수행중으로 간주
  const cpmId = String(project?.cpm_user_id || '').trim();
  const startedAt = Number(project?.execution_started_at || 0);
  const assistants = _pmProgressParseAssistants(String(project?.order_contributors_text || ''));
  const practicalPm = _pmPracticalPmFromAssistants(assistants || []);
  return !!(cpmId && startedAt > 0 && practicalPm);
}

function _pmIsProjectClosedOrSettled(project) {
  const st = String(project?.lifecycle_status_override || project?.lifecycle_status || '').trim().toLowerCase();
  if (st === 'work_closed' || st === 'settled_done' || st === '업무종료' || st === '정산완료') return true;
  if (Number(project?.work_closed_at || 0) > 0) return true;
  if (Number(project?.settled_at || 0) > 0) return true;
  return false;
}

function _pmCanUploadExpenseForProject(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code) return { ok: false, reason: 'missing_code' };
  const project = PM_STATE.projectByCode[code];
  if (!project) return { ok: false, reason: 'not_found' };
  const reg = String(project.registration_status || '').trim().toLowerCase();
  if (reg !== 'approved') return { ok: false, reason: 'not_approved' };
  if (_pmIsProjectClosedOrSettled(project)) return { ok: false, reason: 'closed_or_settled' };
  if (!_pmIsProjectInProgress(project)) return { ok: false, reason: 'not_in_progress' };
  return { ok: true, reason: '' };
}

function _pmHasFinanceKeyword(v) {
  const t = String(v || '').trim().toLowerCase();
  if (!t) return false;
  return (
    t.includes('경영지원') ||
    t.includes('재경') ||
    t.includes('재무') ||
    t.includes('finance')
  );
}

function _pmSessionUserRow(session) {
  const list = Array.isArray(PM_STATE.users) ? PM_STATE.users : [];
  if (!session || !list.length) return null;
  const sid = String(session.id || '').trim();
  const suid = String(session.user_id || '').trim();
  if (!sid && !suid) return null;
  return list.find((u) => {
    const uid = String(u?.id || '').trim();
    return (sid && uid === sid) || (suid && uid === suid);
  }) || null;
}

function _pmIsFinanceUser(session) {
  if (!session) return false;
  if (Auth.isAdmin(session) || Auth.isTopMgr(session)) return true;
  const userRow = _pmSessionUserRow(session);
  const role = String(session.role || userRow?.role || '').trim().toLowerCase();
  if (role === 'finance') return true;
  return (
    _pmHasFinanceKeyword(session.dept_name) ||
    _pmHasFinanceKeyword(session.hq_name) ||
    _pmHasFinanceKeyword(session.cs_team_name) ||
    _pmHasFinanceKeyword(session.team_name) ||
    _pmHasFinanceKeyword(userRow?.dept_name) ||
    _pmHasFinanceKeyword(userRow?.hq_name) ||
    _pmHasFinanceKeyword(userRow?.cs_team_name) ||
    _pmHasFinanceKeyword(userRow?.team_name)
  );
}

function _pmCanExpenseUpload(session) {
  if (!session) return false;
  const userRow = _pmSessionUserRow(session);
  const role = String(session.role || userRow?.role || '').trim().toLowerCase();
  if (role === 'finance') return true;
  return (
    _pmHasFinanceKeyword(session.dept_name) ||
    _pmHasFinanceKeyword(session.hq_name) ||
    _pmHasFinanceKeyword(session.cs_team_name) ||
    _pmHasFinanceKeyword(session.team_name) ||
    _pmHasFinanceKeyword(userRow?.dept_name) ||
    _pmHasFinanceKeyword(userRow?.hq_name) ||
    _pmHasFinanceKeyword(userRow?.cs_team_name) ||
    _pmHasFinanceKeyword(userRow?.team_name)
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

function _pmProjectInvoiceRows(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code) return [];
  const rows = PM_STATE.invoiceRowsByProject && PM_STATE.invoiceRowsByProject[code];
  return Array.isArray(rows) ? rows : [];
}

function _pmIsInvoiceFailedRow(row) {
  const nts = String(row?.nts_issue_status || '').trim().toLowerCase();
  return nts === 'failed' || nts === 'error';
}

function _pmIsIssuedLikeRow(row) {
  const pay = String(row?.payment_status || '').trim();
  const issueDate = String(row?.issue_date || '').trim();
  return !!issueDate || ['issued', 'partially_paid', 'paid', 'overdue'].includes(pay);
}

function _pmInvoiceServiceAmount(row) {
  const payload = _pmInvoicePayload(row);
  const service = Math.max(0, Number(payload?.service_amount || 0));
  if (service > 0) return service;
  return Math.max(0, Number(row?.invoice_amount || 0));
}

async function _pmSyncLinkedCostBillingStatus(invoiceId, invoiceStatus) {
  const invId = String(invoiceId || '').trim();
  if (!invId) return;
  const st = String(invoiceStatus || '').trim();
  let target = 'requested';
  if (st === 'paid') target = 'paid';
  else if (['issued', 'overdue', 'partially_paid', 'billed'].includes(st)) target = 'billed';
  else if (st === 'cancelled') target = 'unbilled';
  let rows = await API.listAllPages('project_expense_uploads', { limit: 3000, maxPages: 40, sort: 'updated_at' }).catch(() => []);
  rows = (rows || []).filter((r) => String(r.linked_invoice_id || '').trim() === invId);
  for (const row of rows) {
    const payload = { billing_status: target };
    if (target === 'unbilled') payload.linked_invoice_id = '';
    await API.patch('project_expense_uploads', row.id, payload).catch(() => null);
  }
}

function _pmInvoiceRequestedAmountByDue(projectCode, dueDate, rows) {
  const due = String(dueDate || '').trim();
  if (!due) return 0;
  const list = Array.isArray(rows) ? rows : _pmProjectInvoiceRows(projectCode);
  return list.reduce((sum, r) => {
    const rowDue = String(r?.planned_issue_date || '').trim();
    if (rowDue !== due) return sum;
    const st = String(r?.payment_status || '').trim();
    if (st === 'cancelled') return sum;
    if (_pmIsInvoiceFailedRow(r) && !_pmIsIssuedLikeRow(r)) return sum;
    return sum + _pmInvoiceServiceAmount(r);
  }, 0);
}

function _pmInvoicePlannedAmountByDue(project, dueDate) {
  const due = String(dueDate || '').trim();
  if (!due) return 0;
  const milestones = _pmCollectBillingMilestones(project?.billing_schedule);
  return milestones.reduce((sum, m) => (
    String(m?.due_date || '').trim() === due
      ? sum + Math.max(0, Number(m?.amount || 0))
      : sum
  ), 0);
}

function _pmInvoiceAmountBounds(project, projectCode, dueDate, rows) {
  const planned = _pmInvoicePlannedAmountByDue(project, dueDate);
  const requested = _pmInvoiceRequestedAmountByDue(projectCode, dueDate, rows);
  return {
    planned,
    requested,
    remaining: Math.max(0, planned - requested),
  };
}

function _pmInvoiceIssueProgress(project, projectCode, rows) {
  const milestones = _pmCollectBillingMilestones(project?.billing_schedule);
  const plannedTotal = milestones.reduce((sum, m) => sum + Math.max(0, Number(m?.amount || 0)), 0);
  const list = Array.isArray(rows) ? rows : _pmProjectInvoiceRows(projectCode);
  const requestedTotal = list.reduce((sum, r) => {
    const st = String(r?.payment_status || '').trim();
    if (st === 'cancelled') return sum;
    if (_pmIsInvoiceFailedRow(r) && !_pmIsIssuedLikeRow(r)) return sum;
    return sum + _pmInvoiceServiceAmount(r);
  }, 0);
  const issuedTotal = list.reduce((sum, r) => {
    if (!_pmIsIssuedLikeRow(r)) return sum;
    return sum + _pmInvoiceServiceAmount(r);
  }, 0);
  const hasFailed = list.some((r) => _pmIsInvoiceFailedRow(r));
  return {
    plannedTotal,
    requestedTotal,
    issuedTotal,
    remainingTotal: Math.max(0, plannedTotal - issuedTotal),
    remainingRequestTotal: Math.max(0, plannedTotal - requestedTotal),
    hasFailed,
  };
}

function _pmApplyInvoiceRequestFormAvailability(projectCode, project, rows) {
  const progress = _pmInvoiceIssueProgress(project, projectCode, rows);
  const mode = _pmInvoiceRequestMode();
  const lockByPlan = progress.plannedTotal > 0 && progress.remainingRequestTotal <= 0;
  const lock = lockByPlan && mode !== 'cost_only';
  const ids = [
    'pm-inv-planned-issue-date',
    'pm-inv-invoice-amount',
    'pm-inv-request-mode',
    'pm-inv-include-billable-costs',
    'pm-inv-billable-toggle-btn',
    'pm-inv-vat-amount',
    'pm-inv-total-amount',
    'pm-inv-recipient-email',
    'pm-inv-recipient-name',
    'pm-inv-buyer-company',
    'pm-inv-buyer-bizno',
    'pm-inv-biz-cert-file',
    'pm-inv-service-item-name',
    'pm-inv-cost-item-name',
    'pm-inv-service-item-change-reason-select',
    'pm-inv-service-item-change-reason-text',
    'pm-inv-cost-item-change-reason-select',
    'pm-inv-cost-item-change-reason-text',
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!lock;
  });
  _pmSyncInvoiceCreateButtonState(projectCode, { lock });
  const lockGuide = document.getElementById('pm-inv-lock-guide');
  if (!lockGuide) return;
  if (!lock) {
    lockGuide.style.display = 'none';
    lockGuide.textContent = '';
    return;
  }
  const failText = progress.hasFailed
    ? ' 실패건은 하단 이력에서 재전송하세요.'
    : '';
  lockGuide.textContent = `전액 발행요청 완료: 예정 ${_pmKrw(progress.plannedTotal)} / 요청 ${_pmKrw(progress.requestedTotal)}. 추가 발행요청은 불가합니다.${failText}`;
  lockGuide.style.display = '';
}

async function _pmEnsureInvoiceRowsForProject(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code) return [];
  let rows = await API.listAllPages('project_invoices', { limit: 500, maxPages: 20, sort: 'updated_at' }).catch(() => []);
  rows = (rows || []).filter((r) => String(r.project_code || '').trim() === code);
  PM_STATE.invoiceRowsByProject[code] = rows;
  return rows;
}

function _pmInvoicePlanSelectionForProject(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code) return null;
  return PM_STATE.invoicePlanSelection[code] || null;
}

function _pmSetInvoicePlanSelection(projectCode, dueDate, bounds) {
  const code = String(projectCode || '').trim();
  const due = String(dueDate || '').trim();
  if (!code || !due) return;
  PM_STATE.invoicePlanSelection[code] = {
    dueDate: due,
    planned: Math.max(0, Number(bounds?.planned || 0)),
    requested: Math.max(0, Number(bounds?.requested || 0)),
    remaining: Math.max(0, Number(bounds?.remaining || 0)),
  };
}

function _pmInvoiceBillableCostRows(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code) return [];
  return Array.isArray(PM_STATE.billableCostRowsByProject[code]) ? PM_STATE.billableCostRowsByProject[code] : [];
}

function _pmInvoiceBillableCostTotal(projectCode) {
  return _pmInvoiceBillableCostRows(projectCode).reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);
}

function _pmInvoiceIncludeBillableCosts() {
  return !!document.getElementById('pm-inv-include-billable-costs')?.checked;
}

function _pmInvoiceRequestMode() {
  const mode = String(document.getElementById('pm-inv-request-mode')?.value || 'merged').trim();
  if (mode === 'service_only' || mode === 'cost_only') return mode;
  return 'merged';
}

async function _pmLoadBillableCostRows(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code) return [];
  let rows = await API.listAllPages('project_expense_uploads', { limit: 3000, maxPages: 40, sort: 'updated_at' }).catch(() => []);
  rows = (rows || []).filter((r) => {
    if (String(r.project_code || '').trim() !== code) return false;
    const status = _pmExpenseBillingStatusNorm(r.billing_status);
    const amount = Math.max(0, Number(r.amount || 0));
    return !!r.is_billable && amount > 0 && status === 'unbilled';
  });
  rows.sort(_pmExpenseRowSortCompare);
  PM_STATE.billableCostRowsByProject[code] = rows;
  return rows;
}

function _pmRenderBillableCostRows(projectCode) {
  const code = String(projectCode || '').trim();
  const body = document.getElementById('pm-inv-billable-cost-body');
  const sumEl = document.getElementById('pm-inv-billable-cost-summary');
  const amountEl = document.getElementById('pm-inv-billable-cost-amount');
  const rows = _pmInvoiceBillableCostRows(code);
  const includeCosts = _pmInvoiceIncludeBillableCosts();
  const billableTotal = includeCosts ? _pmInvoiceBillableCostTotal(code) : 0;
  if (sumEl) sumEl.textContent = `청구비용 항목 ${rows.length}건 · 공급가액 ${_pmKrw(billableTotal)}${includeCosts ? '' : ' · 제외됨'}`;
  if (amountEl) amountEl.value = billableTotal > 0 ? billableTotal.toLocaleString('ko-KR') : '0';
  _pmRenderBillableCostVisibility();
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="table-empty"><i class="fas fa-receipt"></i><p>청구 가능한 비용 항목이 없습니다.</p></td></tr>';
    return;
  }
  body.innerHTML = rows.map((r, i) => {
    const costDate = String(r.expense_date || '').trim();
    const costType = _pmEsc(r.expense_type || '-');
    const costDetail = _pmEsc(r.vendor || '-');
    const amount = Math.max(0, Number(r.amount || 0));
    const note = _pmEsc(r.note || '');
    return `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${costDate || '-'}</td>
      <td>${costType || '-'}</td>
      <td>${costDetail}</td>
      <td style="text-align:right">${amount > 0 ? amount.toLocaleString('ko-KR') : '-'}</td>
      <td>${note || '-'}</td>
    </tr>`;
  }).join('');
}

function _pmRenderBillableCostVisibility() {
  const wrap = document.getElementById('pm-inv-billable-wrap');
  const btn = document.getElementById('pm-inv-billable-toggle-btn');
  const code = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
  const rows = _pmInvoiceBillableCostRows(code);
  const expanded = !!PM_STATE.invoiceBillableExpanded;
  if (wrap) wrap.style.display = expanded ? '' : 'none';
  if (btn) {
    btn.disabled = !rows.length;
    btn.innerHTML = expanded
      ? '<i class="fas fa-chevron-up"></i> 상세접기'
      : '<i class="fas fa-chevron-down"></i> 상세보기';
  }
}

function pmToggleInvoiceBillableCostRows(forceExpanded) {
  if (typeof forceExpanded === 'boolean') {
    PM_STATE.invoiceBillableExpanded = !!forceExpanded;
  } else {
    PM_STATE.invoiceBillableExpanded = !PM_STATE.invoiceBillableExpanded;
  }
  _pmRenderBillableCostVisibility();
}

function _pmInvoiceDefaultPlannedIssueDate(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code) return '';
  const picked = _pmInvoicePlanSelectionForProject(code);
  const pickedDue = String(picked?.dueDate || '').trim();
  if (pickedDue) return pickedDue;
  const project = PM_STATE.projectByCode[code] || {};
  const milestones = _pmCollectBillingMilestones(project.billing_schedule);
  const today = _pmTodayDateText();
  const nextMilestone = milestones.find((m) => String(m.due_date) >= today) || milestones[0] || null;
  return String(nextMilestone?.due_date || '').trim() || today;
}

function _pmSyncInvoicePlannedIssueGuide(projectCode) {
  const code = String(projectCode || '').trim();
  const plannedEl = document.getElementById('pm-inv-planned-issue-date');
  const guideEl = document.getElementById('pm-inv-planned-issue-guide');
  if (!plannedEl) return;
  const defaultDate = String(plannedEl.dataset.defaultIssueDate || '').trim() || _pmInvoiceDefaultPlannedIssueDate(code);
  if (defaultDate) plannedEl.dataset.defaultIssueDate = defaultDate;
  if (guideEl) {
    guideEl.style.color = 'var(--text-secondary)';
    guideEl.textContent = '연기 시 메모 사유 필수';
  }
}

function _pmSyncSingleItemReasonVisibility(itemInputId, wrapId, reasonSelectId, reasonTextId, isVisible) {
  const itemEl = document.getElementById(itemInputId);
  const wrapEl = document.getElementById(wrapId);
  const reasonSel = document.getElementById(reasonSelectId);
  const reasonText = document.getElementById(reasonTextId);
  if (!itemEl) return;
  if (!isVisible) {
    if (wrapEl) wrapEl.style.display = 'none';
    if (reasonSel) {
      reasonSel.required = false;
      reasonSel.value = '';
    }
    if (reasonText) {
      reasonText.required = false;
      reasonText.style.display = 'none';
      reasonText.value = '';
    }
    return;
  }
  const defaultName = String(itemEl.dataset.defaultItemName || '').trim();
  const currentName = String(itemEl.value || '').trim();
  const changed = !!(defaultName && currentName && currentName !== defaultName);
  if (wrapEl) wrapEl.style.display = changed ? '' : 'none';
  if (reasonSel) {
    reasonSel.required = changed;
    if (!changed) reasonSel.value = '';
  }
  if (reasonText) {
    const isOther = changed && String(reasonSel?.value || '').trim() === 'other';
    reasonText.style.display = isOther ? '' : 'none';
    reasonText.required = isOther;
    if (!isOther) reasonText.value = '';
  }
}

function _pmSyncInvoiceItemChangeReason(projectCode) {
  const code = String(projectCode || '').trim();
  const mode = _pmInvoiceRequestMode();
  const project = PM_STATE.projectByCode[code] || {};
  const serviceItemEl = document.getElementById('pm-inv-service-item-name');
  const costItemEl = document.getElementById('pm-inv-cost-item-name');
  if (serviceItemEl) {
    const serviceDefault = String(project.project_name || '용역대금').trim();
    serviceItemEl.dataset.defaultItemName = serviceDefault;
  }
  if (costItemEl) {
    const costDefault = '프로젝트비용';
    costItemEl.dataset.defaultItemName = costDefault;
  }
  const showService = mode !== 'cost_only';
  const showCost = mode !== 'service_only';
  const serviceWrap = document.getElementById('pm-inv-service-item-wrap');
  const costWrap = document.getElementById('pm-inv-cost-item-wrap');
  if (serviceWrap) serviceWrap.style.display = showService ? '' : 'none';
  if (costWrap) costWrap.style.display = showCost ? '' : 'none';
  _pmSyncSingleItemReasonVisibility(
    'pm-inv-service-item-name',
    'pm-inv-service-item-change-wrap',
    'pm-inv-service-item-change-reason-select',
    'pm-inv-service-item-change-reason-text',
    showService,
  );
  _pmSyncSingleItemReasonVisibility(
    'pm-inv-cost-item-name',
    'pm-inv-cost-item-change-wrap',
    'pm-inv-cost-item-change-reason-select',
    'pm-inv-cost-item-change-reason-text',
    showCost,
  );
}

function _pmCurrentInvoiceMonth() {
  return String(document.getElementById('pm-inv-month')?.value || _pmNowMonth()).trim();
}

function _pmIsInvoicePreviewConfirmed(projectCode, billingMonth) {
  const code = String(projectCode || '').trim();
  const month = String(billingMonth || '').trim();
  if (!code || !month) return false;
  return !!PM_STATE.invoicePreviewConfirmed
    && String(PM_STATE.invoicePreviewProjectCode || '').trim() === code
    && String(PM_STATE.invoicePreviewMonth || '').trim() === month;
}

function _pmSyncInvoiceCreateButtonState(projectCode, options = {}) {
  const code = String(projectCode || PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
  const month = _pmCurrentInvoiceMonth();
  const lock = !!options.lock;
  const session = getSession ? getSession() : null;
  const canRequest = !!(session && _pmCanRequestInvoiceForProject(session, code));
  const previewReady = _pmIsInvoicePreviewConfirmed(code, month);
  const createBtn = document.getElementById('pm-inv-create-btn');
  if (createBtn) {
    createBtn.disabled = !!(lock || !canRequest || !previewReady);
    createBtn.title = !canRequest
      ? '발행요청 권한이 없습니다.'
      : (!previewReady ? '먼저 세금계산서 미리보기를 실행해 확인하세요.' : '');
  }
  const previewBtn = document.getElementById('pm-inv-generate-mail-btn');
  if (previewBtn) {
    previewBtn.disabled = !!(lock || !canRequest);
    previewBtn.title = !canRequest ? '발행요청 권한이 없습니다.' : '';
  }
}

function _pmResetInvoicePreviewConfirmation(projectCode) {
  const code = String(projectCode || PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
  PM_STATE.invoicePreviewConfirmed = false;
  PM_STATE.invoicePreviewProjectCode = code;
  PM_STATE.invoicePreviewMonth = _pmCurrentInvoiceMonth();
  _pmSyncInvoiceCreateButtonState(code);
}

function _pmRenderInvoicePreviewHtml(output) {
  const invoice = output || {};
  const requestMode = String(invoice.request_mode || invoice?.request_payload?.request_mode || '').trim();
  const session = getSession ? getSession() : null;
  const projectCode = String(invoice.project_code || '').trim();
  const projectName = String(invoice.project_name || '').trim();
  const clientName = String(invoice.client_name || invoice.buyer_company_name || '').trim();
  const plannedIssueDate = String(invoice.planned_issue_date || '').trim() || '-';
  const supplierName = String(session?.company_name || session?.org_name || session?.team_name || 'SupersmartlogAI').trim();
  const supplierBizNo = String(session?.business_no || session?.company_business_no || '').trim();
  const supplierCeo = String(session?.ceo_name || '').trim();
  const supplierAddress = String(session?.address || '').trim();
  const supplierEmail = String(session?.email || '').trim();
  const supplierBizType = String(session?.business_type || '').trim();
  const supplierBizItem = String(session?.business_item || '').trim();
  const buyerName = String(invoice.buyer_company_name || clientName || '').trim();
  const buyerBizNo = String(invoice.buyer_business_no || '').trim();
  const recipientName = String(invoice.recipient_name || '').trim();
  const recipientEmail = String(invoice.recipient_email || '').trim();
  const memo = String(invoice.legal_note || '').trim();
  const issueToken = `${projectCode || 'PJT'}-${String(plannedIssueDate || '').replaceAll('-', '') || 'DRAFT'}`;
  const totalSupply = Math.max(0, Number(invoice.supply_amount || 0));
  const totalVat = Math.max(0, Number(invoice.vat_amount || 0));
  const totalAmount = Math.max(0, Number(invoice.total_amount || 0));
  const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(plannedIssueDate) ? plannedIssueDate : '';
  const issueMonth = issueDate ? issueDate.slice(5, 7) : '--';
  const issueDay = issueDate ? issueDate.slice(8, 10) : '--';
  const fmt = (n) => Math.max(0, Math.round(Number(n || 0))).toLocaleString('ko-KR');
  const supplierNameSafe = supplierName || '-';
  const buyerNameSafe = buyerName || '-';
  const buyerAddress = String(invoice.buyer_address || '').trim() || '-';
  const buyerBizType = String(invoice.buyer_business_type || '').trim() || '-';
  const buyerBizItem = String(invoice.buyer_business_item || '').trim() || '-';
  const itemDesc = `${projectCode || '-'}${projectName ? ` / ${projectName}` : ''}`;
  const serviceItemLabel = String(invoice.service_item_name || '').trim() || '용역대금';
  const costItemLabel = String(invoice.cost_item_name || '').trim() || '프로젝트비용';
  const serviceSupply = Math.max(0, Number(invoice.service_amount || 0));
  const costSupply = Math.max(0, Number(invoice.billable_cost_amount || 0));
  const previewItems = [];
  if (requestMode === 'cost_only') {
    previewItems.push({ label: costItemLabel, supply: Math.max(0, costSupply || totalSupply) });
  } else {
    if (serviceSupply > 0) previewItems.push({ label: serviceItemLabel, supply: serviceSupply });
    if (costSupply > 0) {
      previewItems.push({
        label: costItemLabel,
        supply: costSupply,
      });
    }
  }
  if (!previewItems.length) previewItems.push({ label: serviceItemLabel, supply: totalSupply });
  let vatRemain = totalVat;
  const itemRows = previewItems.map((it, idx) => {
    const isLast = idx === previewItems.length - 1;
    const rowVat = isLast ? vatRemain : Math.round(it.supply * 0.1);
    vatRemain = Math.max(0, vatRemain - rowVat);
    return `<tr>
          <td class="value center">${_pmEsc(issueMonth)}</td>
          <td class="value center">${_pmEsc(issueDay)}</td>
          <td class="value" colspan="3">${_pmEsc(it.label)} (${_pmEsc(itemDesc)})</td>
          <td class="value center"></td>
          <td class="value right"></td>
          <td class="value right"></td>
          <td class="value right">${fmt(it.supply)}</td>
          <td class="value right">${fmt(rowVat)}</td>
          <td class="value" colspan="2">${isLast ? _pmEsc(memo || '') : ''}</td>
        </tr>`;
  }).join('');
  return `
    <div class="pm-tax-preview-paper">
      <table class="pm-tax-nts-table" aria-label="세금계산서 미리보기">
        <tr>
          <th class="title" colspan="8">전자세금계산서</th>
          <th class="label" colspan="2">승인번호</th>
          <td class="value" colspan="2">${_pmEsc(issueToken)}</td>
        </tr>
        <tr>
          <th class="side supplier-side" rowspan="4">공급자</th>
          <th class="label">등록번호</th>
          <td class="value" colspan="2">${_pmEsc(supplierBizNo || '-')}</td>
          <th class="label">종사업장번호</th>
          <td class="value">${_pmEsc('-')}</td>
          <th class="side buyer-side" rowspan="4">공급받는자</th>
          <th class="label">등록번호</th>
          <td class="value" colspan="2">${_pmEsc(buyerBizNo || '-')}</td>
          <th class="label">종사업장번호</th>
          <td class="value">${_pmEsc('-')}</td>
        </tr>
        <tr>
          <th class="label">상호(법인명)</th>
          <td class="value" colspan="2">${_pmEsc(supplierNameSafe)}</td>
          <th class="label">성명</th>
          <td class="value">${_pmEsc(supplierCeo || '-')}</td>
          <th class="label">상호(법인명)</th>
          <td class="value" colspan="2">${_pmEsc(buyerNameSafe)}</td>
          <th class="label">성명</th>
          <td class="value">${_pmEsc(recipientName || '-')}</td>
        </tr>
        <tr>
          <th class="label">사업장</th>
          <td class="value" colspan="4">${_pmEsc(supplierAddress || '-')}</td>
          <th class="label">사업장</th>
          <td class="value" colspan="4">${_pmEsc(buyerAddress)}</td>
        </tr>
        <tr>
          <th class="label">업태</th>
          <td class="value">${_pmEsc(supplierBizType || '-')}</td>
          <th class="label">종목</th>
          <td class="value" colspan="2">${_pmEsc(supplierBizItem || '-')}</td>
          <th class="label">업태</th>
          <td class="value">${_pmEsc(buyerBizType)}</td>
          <th class="label">종목</th>
          <td class="value" colspan="2">${_pmEsc(buyerBizItem)}</td>
        </tr>
        <tr>
          <th class="side supplier-side">이메일</th>
          <td class="value" colspan="5">${_pmEsc(supplierEmail || '-')}</td>
          <th class="side buyer-side">이메일</th>
          <td class="value" colspan="5">${_pmEsc(recipientEmail || '-')}</td>
        </tr>
        <tr>
          <th class="label" colspan="2">작성일자</th>
          <th class="label" colspan="3">공급가액</th>
          <th class="label" colspan="2">세액</th>
          <th class="label" colspan="5">수정사유</th>
        </tr>
        <tr>
          <td class="value center" colspan="2">${_pmEsc(plannedIssueDate)}</td>
          <td class="value right" colspan="3">${fmt(totalSupply)}</td>
          <td class="value right" colspan="2">${fmt(totalVat)}</td>
          <td class="value" colspan="5"></td>
        </tr>
        <tr>
          <th class="label" colspan="2">비고</th>
          <td class="value" colspan="10">${_pmEsc(memo || '-')}</td>
        </tr>
        <tr>
          <th class="label" style="width:48px">월</th>
          <th class="label" style="width:48px">일</th>
          <th class="label" colspan="3">품목</th>
          <th class="label">규격</th>
          <th class="label">수량</th>
          <th class="label">단가</th>
          <th class="label">공급가액</th>
          <th class="label">세액</th>
          <th class="label" colspan="2">비고</th>
        </tr>
        ${itemRows}
        <tr><td class="value blank" colspan="12"></td></tr>
        <tr><td class="value blank" colspan="12"></td></tr>
        <tr>
          <th class="label" colspan="2">합계금액</th>
          <th class="label" colspan="2">현금</th>
          <th class="label" colspan="2">수표</th>
          <th class="label" colspan="2">어음</th>
          <th class="label" colspan="2">외상미수금</th>
          <td class="claim-cell" colspan="2" rowspan="2">이 금액을 ( 청구 ) 함</td>
        </tr>
        <tr>
          <td class="value right" colspan="2">${fmt(totalAmount)}</td>
          <td class="value center" colspan="2"></td>
          <td class="value center" colspan="2"></td>
          <td class="value center" colspan="2"></td>
          <td class="value center" colspan="2">${fmt(totalAmount)}</td>
        </tr>
      </table>
    </div>
  `;
}

function _pmRenderInvoicePreviewPanel(output, summaryText) {
  const previewDoc = document.getElementById('pm-inv-doc-preview');
  const previewText = document.getElementById('pm-inv-mail-preview');
  if (previewText) previewText.value = String(summaryText || '').trim();
  if (previewDoc) {
    if (output) {
      previewDoc.innerHTML = _pmRenderInvoicePreviewHtml(output);
    } else {
      previewDoc.innerHTML = '<div class="pm-inv-doc-preview-empty">세금계산서 미리보기를 실행하면 실제 전송 전 검토용 양식이 표시됩니다.</div>';
    }
  }
}

function _pmRefreshInvoicePlanSelectionUi(projectCode) {
  const code = String(projectCode || '').trim();
  const hintEl = document.getElementById('pm-inv-plan-selection-hint');
  const modeGuideEl = document.getElementById('pm-inv-request-mode-guide');
  const amountEl = document.getElementById('pm-inv-invoice-amount');
  const remainEl = document.getElementById('pm-inv-plan-remaining');
  const billableAmountEl = document.getElementById('pm-inv-billable-cost-amount');
  const vatEl = document.getElementById('pm-inv-vat-amount');
  const totalEl = document.getElementById('pm-inv-total-amount');
  const includeCostsEl = document.getElementById('pm-inv-include-billable-costs');
  const mode = _pmInvoiceRequestMode();
  const isServiceOnly = mode === 'service_only';
  const isCostOnly = mode === 'cost_only';
  if (modeGuideEl) {
    if (isCostOnly) {
      modeGuideEl.textContent = '청구비용 단독: 용역대금은 0원으로 고정되며, 청구비용만 발행요청됩니다.';
    } else if (isServiceOnly) {
      modeGuideEl.textContent = '용역대금 단독: 청구비용 항목은 제외되고 용역대금만 발행요청됩니다.';
    } else {
      modeGuideEl.textContent = '합산: 용역대금과 청구비용을 함께 발행요청합니다.';
    }
  }
  if (includeCostsEl) {
    if (isServiceOnly) {
      includeCostsEl.checked = false;
      includeCostsEl.disabled = true;
      includeCostsEl.title = '용역대금 단독 청구유형에서는 청구비용 항목이 제외됩니다.';
    } else if (isCostOnly) {
      includeCostsEl.checked = true;
      includeCostsEl.disabled = true;
      includeCostsEl.title = '청구비용 단독 청구유형에서는 청구비용 항목이 필수입니다.';
    } else {
      includeCostsEl.disabled = false;
      includeCostsEl.title = '';
    }
  }
  if (amountEl) {
    amountEl.disabled = isCostOnly;
    amountEl.placeholder = isCostOnly ? '청구비용 단독은 용역대금 0원으로 고정됩니다.' : '용역대금 입력';
    if (isCostOnly) amountEl.value = '';
  }
  const picked = _pmInvoicePlanSelectionForProject(code);
  if (!picked) {
    if (hintEl) {
      hintEl.textContent = isCostOnly
        ? '청구비용 단독: 청구일정 선택 없이 비용만으로 발행요청 가능합니다.'
        : '발행 대상을 선택하면 요청금액과 잔액 검증이 자동 적용됩니다.';
    }
    if (remainEl) remainEl.value = isCostOnly ? '-' : '';
    if (!isCostOnly) {
      if (billableAmountEl) billableAmountEl.value = '0';
      if (vatEl) vatEl.value = '';
      if (totalEl) totalEl.value = '';
      return;
    }
  }
  if (hintEl && picked) {
    hintEl.textContent = `선택 일정 ${picked.dueDate} · 예정 ${_pmKrw(picked.planned)} · 요청합계 ${_pmKrw(picked.requested)} · 잔액 ${_pmKrw(picked.remaining)}`;
  }
  if (remainEl && picked) remainEl.value = Number(picked.remaining || 0).toLocaleString('ko-KR');
  if (amountEl && picked && !String(amountEl.value || '').trim() && picked.remaining > 0 && !isCostOnly) {
    amountEl.value = Number(picked.remaining || 0).toLocaleString('ko-KR');
  }
  const billableTotal = _pmInvoiceIncludeBillableCosts() ? _pmInvoiceBillableCostTotal(code) : 0;
  if (billableAmountEl) billableAmountEl.value = billableTotal > 0 ? billableTotal.toLocaleString('ko-KR') : '0';
  const taxProfile = _pmInvoiceTaxProfile('taxable');
  const serviceAmount = isCostOnly ? 0 : _pmParseAmountInput(amountEl?.value || 0);
  const tax = _pmInvoiceTaxAmounts(serviceAmount + billableTotal, taxProfile.vatRate);
  if (vatEl) vatEl.value = tax.vat > 0 ? tax.vat.toLocaleString('ko-KR') : '0';
  if (totalEl) totalEl.value = tax.total > 0 ? tax.total.toLocaleString('ko-KR') : '0';
  _pmSyncInvoiceItemChangeReason(code);
  _pmSyncInvoicePlannedIssueGuide(code);
}

function pmSelectInvoicePlanRow(dueDate) {
  const code = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
  if (!code) return;
  const due = String(dueDate || '').trim();
  if (!due) return;
  const project = PM_STATE.projectByCode[code] || {};
  const bounds = _pmInvoiceAmountBounds(project, code, due);
  _pmSetInvoicePlanSelection(code, due, bounds);
  const mode = _pmInvoiceRequestMode();
  const amountEl = document.getElementById('pm-inv-invoice-amount');
  if (amountEl) {
    if (mode === 'cost_only') {
      amountEl.value = '';
    } else {
      amountEl.value = Number(Math.max(0, Number(bounds?.remaining || 0))).toLocaleString('ko-KR');
    }
  }
  const plannedEl = document.getElementById('pm-inv-planned-issue-date');
  if (plannedEl) plannedEl.value = due;
  if (plannedEl) plannedEl.dataset.defaultIssueDate = due;
  document.querySelectorAll('#pm-inv-plan-body tr.pm-inv-plan-row').forEach((tr) => {
    tr.classList.toggle('is-selected', String(tr.dataset.dueDate || '').trim() === due);
  });
  _pmResetInvoicePreviewConfirmation(code);
  _pmRefreshInvoicePlanSelectionUi(code);
}

function _pmReadInvoiceRequestForm(projectCode, billingMonth, batch) {
  const project = PM_STATE.projectByCode[String(projectCode || '').trim()] || {};
  const requestMode = _pmInvoiceRequestMode();
  const isServiceOnly = requestMode === 'service_only';
  const isCostOnly = requestMode === 'cost_only';
  const milestones = _pmCollectBillingMilestones(project.billing_schedule);
  const today = _pmTodayDateText();
  const nextMilestone = milestones.find((m) => String(m.due_date) >= today) || milestones[0] || null;
  let plannedIssue = String(document.getElementById('pm-inv-planned-issue-date')?.value || '').trim() || String(nextMilestone?.due_date || '');
  if (!plannedIssue && isCostOnly) plannedIssue = today;
  const plannedIssueDefault = String(document.getElementById('pm-inv-planned-issue-date')?.dataset?.defaultIssueDate || '').trim() || String(nextMilestone?.due_date || '').trim();
  const expectedPay = plannedIssue || _pmAddDays(today, 60) || today;
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
  const serviceItemEl = document.getElementById('pm-inv-service-item-name');
  const costItemEl = document.getElementById('pm-inv-cost-item-name');
  const serviceItemDefault = String(serviceItemEl?.dataset?.defaultItemName || project.project_name || '용역대금').trim();
  const costItemDefault = String(costItemEl?.dataset?.defaultItemName || '프로젝트비용').trim();
  const serviceItemName = String(serviceItemEl?.value || '').trim() || serviceItemDefault;
  const costItemName = String(costItemEl?.value || '').trim() || costItemDefault;
  const serviceItemChanged = !!(serviceItemDefault && serviceItemName && serviceItemName !== serviceItemDefault);
  const costItemChanged = !!(costItemDefault && costItemName && costItemName !== costItemDefault);
  const serviceReasonType = String(document.getElementById('pm-inv-service-item-change-reason-select')?.value || '').trim();
  const serviceReasonText = String(document.getElementById('pm-inv-service-item-change-reason-text')?.value || '').trim();
  const serviceReason = serviceReasonType === 'other' ? serviceReasonText : serviceReasonType;
  const costReasonType = String(document.getElementById('pm-inv-cost-item-change-reason-select')?.value || '').trim();
  const costReasonText = String(document.getElementById('pm-inv-cost-item-change-reason-text')?.value || '').trim();
  const costReason = costReasonType === 'other' ? costReasonText : costReasonType;
  const itemName = isCostOnly
    ? costItemName
    : (isServiceOnly ? serviceItemName : `${serviceItemName} + ${costItemName}`);
  const legalNote = '';
  const taxProfile = _pmInvoiceTaxProfile('taxable');
  const rawAmount = _pmParseAmountInput(document.getElementById('pm-inv-invoice-amount')?.value || '');
  const defaultServiceAmount = Number(rawAmount || batch?.total_amount || nextMilestone?.amount || 0);
  const serviceAmount = isCostOnly ? 0 : defaultServiceAmount;
  const includeBillableCosts = isServiceOnly ? false : (isCostOnly ? true : _pmInvoiceIncludeBillableCosts());
  const billableCostRows = includeBillableCosts ? _pmInvoiceBillableCostRows(projectCode) : [];
  const billableCostAmount = billableCostRows.reduce((sum, row) => sum + Math.max(0, Number(row.amount || 0)), 0);
  const invoiceAmount = serviceAmount + billableCostAmount;
  const invoiceItems = [];
  if (serviceAmount > 0) {
    invoiceItems.push({
      item_type: 'service',
      name: serviceItemName || '용역대금',
      supply_amount: Math.round(serviceAmount),
      source: 'billing_schedule',
      due_date: plannedIssue || null,
    });
  }
  billableCostRows.forEach((row) => {
    invoiceItems.push({
      item_type: 'cost',
      expense_id: String(row.id || ''),
      name: costItemName || row.expense_type || '청구비용',
      cost_date: row.expense_date || null,
      vendor: row.vendor || '',
      supply_amount: Math.max(0, Math.round(Number(row.amount || 0))),
      vat_amount: Math.max(0, Math.round(Number(row.vat_amount || 0))),
      total_amount: Math.max(0, Math.round(Number(row.total_amount || (Number(row.amount || 0) + Number(row.vat_amount || 0))))),
      note: row.note || '',
    });
  });
  const tax = _pmInvoiceTaxAmounts(invoiceAmount, taxProfile.vatRate);
  return {
    planned_issue_date: plannedIssue || null,
    expected_payment_date: expectedPay || null,
    planned_issue_base_date: plannedIssueDefault || null,
    is_issue_delayed: false,
    recipient_email: recipientEmail,
    recipient_name: recipientName || recipientNameRaw,
    recipient_phone: recipientPhoneNorm || '',
    buyer_company_name: buyerCompany,
    buyer_business_no: buyerBizNo,
    item_name: itemName,
    service_item_name: serviceItemName,
    service_item_name_original: serviceItemDefault,
    service_item_name_changed: serviceItemChanged,
    service_item_name_change_reason_type: serviceReasonType,
    service_item_name_change_reason_text: serviceReasonText,
    service_item_name_change_reason: serviceReason,
    cost_item_name: costItemName,
    cost_item_name_original: costItemDefault,
    cost_item_name_changed: costItemChanged,
    cost_item_name_change_reason_type: costReasonType,
    cost_item_name_change_reason_text: costReasonText,
    cost_item_name_change_reason: costReason,
    legal_note: legalNote,
    invoice_amount: tax.supply > 0 ? tax.supply : 0,
    service_amount: serviceAmount > 0 ? Math.round(serviceAmount) : 0,
    billable_cost_amount: billableCostAmount > 0 ? Math.round(billableCostAmount) : 0,
    include_billable_costs: includeBillableCosts,
    request_mode: requestMode,
    billable_cost_ids: billableCostRows.map((row) => String(row.id || '')).filter(Boolean),
    invoice_items: invoiceItems,
    tax_type: taxProfile.taxType,
    vat_rate: tax.vatRate,
    vat_amount: tax.vat,
    total_amount: tax.total,
    request_payload: {
      project_code: projectCode,
      billing_month: billingMonth,
      buyer_company_name: buyerCompany,
      buyer_business_no: buyerBizNo,
      recipient_email: recipientEmail,
      recipient_name: recipientName || recipientNameRaw,
      recipient_phone: recipientPhoneNorm || '',
      item_name: itemName,
      service_item_name: serviceItemName,
      service_item_name_original: serviceItemDefault,
      service_item_name_changed: serviceItemChanged,
      service_item_name_change_reason_type: serviceReasonType,
      service_item_name_change_reason_text: serviceReasonText,
      service_item_name_change_reason: serviceReason,
      cost_item_name: costItemName,
      cost_item_name_original: costItemDefault,
      cost_item_name_changed: costItemChanged,
      cost_item_name_change_reason_type: costReasonType,
      cost_item_name_change_reason_text: costReasonText,
      cost_item_name_change_reason: costReason,
      planned_issue_date: plannedIssue || null,
      expected_payment_date: expectedPay || null,
      planned_issue_base_date: plannedIssueDefault || null,
      is_issue_delayed: false,
      legal_note: legalNote,
      tax_type: taxProfile.taxType,
      vat_rate: tax.vatRate,
      service_amount: serviceAmount > 0 ? Math.round(serviceAmount) : 0,
      billable_cost_amount: billableCostAmount > 0 ? Math.round(billableCostAmount) : 0,
      include_billable_costs: includeBillableCosts,
      request_mode: requestMode,
      billable_cost_ids: billableCostRows.map((row) => String(row.id || '')).filter(Boolean),
      invoice_items: invoiceItems,
      supply_amount: tax.supply,
      vat_amount: tax.vat,
      total_amount: tax.total,
      requested_invoice_amount: tax.supply > 0 ? Math.round(tax.supply) : 0,
    },
  };
}

function _pmValidateInvoiceForm(form) {
  const miss = [];
  if (!String(form.buyer_company_name || '').trim()) miss.push('공급받는자 상호');
  if (!String(form.buyer_business_no || '').trim()) miss.push('공급받는자 사업자번호');
  if (!String(form.recipient_email || '').trim()) miss.push('수신자 이메일');
  const mode = String(form.request_mode || 'merged').trim();
  const needService = mode !== 'cost_only';
  const needCost = mode !== 'service_only';
  const serviceItemName = String(form.service_item_name || form.item_name || '').trim();
  const costItemName = String(form.cost_item_name || form.item_name || '').trim();
  if (needService && !serviceItemName) miss.push('용역대금 품목');
  if (needCost && !costItemName) miss.push('청구비용 품목');
  if (needService && form.service_item_name_changed && !String(form.service_item_name_change_reason || '').trim()) miss.push('용역 품목 변경사유');
  if (needService && form.service_item_name_changed && String(form.service_item_name_change_reason_type || '').trim() === 'other' && !String(form.service_item_name_change_reason_text || '').trim()) {
    miss.push('용역 품목 변경사유(기타 상세)');
  }
  if (needCost && form.cost_item_name_changed && !String(form.cost_item_name_change_reason || '').trim()) miss.push('청구비용 품목 변경사유');
  if (needCost && form.cost_item_name_changed && String(form.cost_item_name_change_reason_type || '').trim() === 'other' && !String(form.cost_item_name_change_reason_text || '').trim()) {
    miss.push('청구비용 품목 변경사유(기타 상세)');
  }
  if (!String(form.planned_issue_date || '').trim()) miss.push('세금계산서 발행예정일');
  if (Number(form.invoice_amount || 0) <= 0) miss.push('청구금액');
  if (String(form.recipient_email || '').trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(form.recipient_email || '').trim())) {
    miss.push('수신자 이메일 형식');
  }
  const bizDigits = String(form.buyer_business_no || '').replace(/[^\d]/g, '');
  if (bizDigits && bizDigits.length !== 10) miss.push('공급받는자 사업자번호 형식');
  const taxType = 'taxable';
  const vatAmount = Number(form.vat_amount || 0);
  if ((taxType === 'zero_rated' || taxType === 'exempt') && vatAmount > 0) {
    miss.push('영세율/면세는 부가세 0원이어야 합니다.');
  }
  if (taxType === 'taxable' && Number(form.invoice_amount || 0) > 0 && vatAmount <= 0) {
    miss.push('과세는 부가세가 필요합니다.');
  }
  return miss;
}

function _pmInvoiceOutputFromForm(projectCode, billingMonth, form, batch = null) {
  const code = String(projectCode || '').trim();
  const project = PM_STATE.projectByCode[code] || {};
  const payload = {
    ...(form?.request_payload || {}),
    invoice_items: Array.isArray(form?.invoice_items) ? form.invoice_items : [],
  };
  const items = Array.isArray(payload.invoice_items) ? payload.invoice_items : [];
  return {
    invoice_id: String(batch?.id || ''),
    project_code: code,
    project_name: String(project.project_name || ''),
    client_name: String(project.client_name || ''),
    billing_month: String(billingMonth || ''),
    planned_issue_date: String(form?.planned_issue_date || ''),
    expected_payment_date: String(form?.expected_payment_date || ''),
    recipient_email: String(form?.recipient_email || ''),
    recipient_name: String(form?.recipient_name || ''),
    buyer_company_name: String(form?.buyer_company_name || ''),
    buyer_business_no: String(form?.buyer_business_no || ''),
    item_name: String(form?.item_name || ''),
    service_item_name: String(form?.service_item_name || ''),
    cost_item_name: String(form?.cost_item_name || ''),
    request_mode: String(form?.request_mode || ''),
    legal_note: String(form?.legal_note || ''),
    tax_type: String(form?.tax_type || 'taxable'),
    vat_rate: Number(form?.vat_rate || 0),
    supply_amount: Math.max(0, Math.round(Number(form?.invoice_amount || 0))),
    vat_amount: Math.max(0, Math.round(Number(form?.vat_amount || 0))),
    total_amount: Math.max(0, Math.round(Number(form?.total_amount || 0))),
    service_amount: Math.max(0, Math.round(Number(form?.service_amount || 0))),
    billable_cost_amount: Math.max(0, Math.round(Number(form?.billable_cost_amount || 0))),
    request_mode: String(form?.request_mode || ''),
    invoice_items: items,
    request_payload: payload,
  };
}

function _pmRenderCustomerInvoiceHtml(invoice) {
  const tableTotal = Math.max(0, Math.round(Number(invoice.supply_amount || 0)));
  const items = Array.isArray(invoice.invoice_items) ? invoice.invoice_items : [];
  const showNoteCol = items.some((item) => String(item?.note || '').trim());
  const itemRows = items.map((item, i) => {
    const name = String(item?.name || item?.item_name || '청구항목').trim();
    const date = String(item?.cost_date || item?.due_date || '').trim();
    const detail = String(item?.detail || item?.vendor || '').trim();
    const note = String(item?.note || '').trim();
    const amount = Math.max(0, Number(item?.supply_amount || item?.amount || 0));
    return `<tr>
      <td style="border:1px solid #d1d5db;padding:8px;text-align:center">${i + 1}</td>
      <td style="border:1px solid #d1d5db;padding:8px">${_pmEsc(name || '-')}</td>
      <td style="border:1px solid #d1d5db;padding:8px;text-align:center">${_pmEsc(date || '-')}</td>
      <td style="border:1px solid #d1d5db;padding:8px;text-align:right">${_pmEsc(_pmKrw(amount))}</td>
      <td style="border:1px solid #d1d5db;padding:8px">${_pmEsc(detail || '-')}</td>
      ${showNoteCol ? `<td style="border:1px solid #d1d5db;padding:8px">${_pmEsc(note || '-')}</td>` : ''}
    </tr>`;
  }).join('');
  const detailRows = itemRows || `<tr>
    <td style="border:1px solid #d1d5db;padding:8px;text-align:center">1</td>
    <td style="border:1px solid #d1d5db;padding:8px">${_pmEsc(invoice.item_name || '용역대금')}</td>
    <td style="border:1px solid #d1d5db;padding:8px;text-align:center">${_pmEsc(invoice.planned_issue_date || '-')}</td>
    <td style="border:1px solid #d1d5db;padding:8px;text-align:right">${_pmEsc(_pmKrw(invoice.supply_amount || 0))}</td>
    <td style="border:1px solid #d1d5db;padding:8px">-</td>
    ${showNoteCol ? '<td style="border:1px solid #d1d5db;padding:8px">-</td>' : ''}
  </tr>`;
  const totalRow = `<tr>
    <td colspan="3" style="border:1px solid #d1d5db;padding:8px;text-align:center;font-weight:700;background:#f8fafc">비용합계</td>
    <td style="border:1px solid #d1d5db;padding:8px;text-align:right;font-weight:700;background:#f8fafc">${_pmEsc(_pmKrw(tableTotal))}</td>
    <td style="border:1px solid #d1d5db;padding:8px;background:#f8fafc"></td>
    ${showNoteCol ? '<td style="border:1px solid #d1d5db;padding:8px;background:#f8fafc"></td>' : ''}
  </tr>`;
  const recipientText = String(invoice.recipient_email || '').trim()
    ? `${_pmEsc(invoice.recipient_name || '-')} (${_pmEsc(invoice.recipient_email || '-')})`
    : `${_pmEsc(invoice.recipient_name || '-')}`;
  return [
    '<div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5">',
    '<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:10px;padding-bottom:10px;border-bottom:2px solid #0f172a">',
    '<h2 style="margin:0;font-size:30px;letter-spacing:-0.2px">프로젝트비용 청구서</h2>',
    `<div style="font-size:12px;color:#475569"><b>청구월</b> ${_pmEsc(invoice.billing_month || '-')}</div>`,
    '</div>',
    '<div style="display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:6px 18px;margin:0 0 12px 0;padding:10px 12px;border:1px solid #dbe3ef;border-radius:8px;background:#f8fafc;font-size:13px">',
    `<div style="grid-column:1 / -1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><b>프로젝트</b> ${_pmEsc(invoice.project_code)} / ${_pmEsc(invoice.project_name || '-')}</div>`,
    `<div><b>고객사</b> ${_pmEsc(invoice.client_name || invoice.buyer_company_name || '-')}</div>`,
    `<div><b>수신자</b> ${recipientText}</div>`,
    `<div><b>작성일</b> ${_pmEsc(invoice.planned_issue_date || '-')}</div>`,
    `<div><b>청구금액</b> ${_pmEsc(_pmKrw(invoice.supply_amount || 0))}</div>`,
    '</div>',
    '<table style="width:100%;border-collapse:collapse;margin:8px 0 12px 0;font-size:13px">',
    '<thead><tr>',
    '<th style="border:1px solid #d1d5db;padding:8px;width:48px">No</th>',
    '<th style="border:1px solid #d1d5db;padding:8px">항목</th>',
    '<th style="border:1px solid #d1d5db;padding:8px;width:120px">일자</th>',
    '<th style="border:1px solid #d1d5db;padding:8px;width:140px">공급가액</th>',
    '<th style="border:1px solid #d1d5db;padding:8px">비용내역</th>',
    showNoteCol ? '<th style="border:1px solid #d1d5db;padding:8px">비고</th>' : '',
    '</tr></thead>',
    `<tbody>${detailRows}${totalRow}</tbody>`,
    '</table>',
    invoice.legal_note ? `<p style="margin:12px 0 0 0"><strong>요청 메모:</strong> ${_pmEsc(invoice.legal_note)}</p>` : '',
    '</div>',
  ].join('');
}

function _pmRenderCustomerInvoiceSummaryText(invoice) {
  const lines = [
    '[프로젝트비용 청구서]',
    `프로젝트: ${invoice.project_code} / ${invoice.project_name || '-'}`,
    `고객사: ${invoice.client_name || invoice.buyer_company_name || '-'}`,
    `청구월: ${invoice.billing_month || '-'}`,
    `수신자: ${invoice.recipient_name || '-'} (${invoice.recipient_email || '-'})`,
    `공급가액: ${_pmKrw(invoice.supply_amount || 0)}`,
    `부가세: ${_pmKrw(invoice.vat_amount || 0)}`,
    `합계: ${_pmKrw(invoice.total_amount || 0)}`,
  ];
  if (invoice.legal_note) lines.push(`메모: ${invoice.legal_note}`);
  return lines.join('\n');
}

function _pmValidateInvoiceOutputConsistency(form) {
  const issues = [];
  const tax = _pmInvoiceTaxAmounts(Number(form?.invoice_amount || 0), Number(form?.vat_rate || 0));
  const vat = Math.max(0, Math.round(Number(form?.vat_amount || 0)));
  const total = Math.max(0, Math.round(Number(form?.total_amount || 0)));
  if (tax.vat !== vat || tax.total !== total) {
    issues.push('청구서 금액 계산(공급가액/부가세/합계) 불일치');
  }
  return issues;
}

function _pmPickInvoiceNoFromNtsResponse(res) {
  const directKeys = ['invoice_no', 'invoiceNo', 'nts_invoice_no', 'ntsInvoiceNo', 'tax_invoice_no', 'taxInvoiceNo', 'issue_no', 'issueNo', 'approval_no', 'approvalNo'];
  const nestedRoots = [res, res?.data, res?.result, res?.payload, res?.response];
  for (const root of nestedRoots) {
    if (!root || typeof root !== 'object') continue;
    for (const key of directKeys) {
      const value = String(root[key] || '').trim();
      if (value) return value;
    }
  }
  return '';
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
    tax_type: row.tax_type,
    vat_amount: row.vat_amount,
  };
}

function _pmInvoiceQualityIssues(row) {
  const issues = _pmValidateInvoiceForm(_pmInvoiceRowFormLike(row));
  const status = String(row._derived_status || row.payment_status || '').trim();
  const invNo = String(row.invoice_no || '').trim();
  const issueDate = String(row.issue_date || '').trim();
  const paid = _pmInvoiceEffectivePaidAmount(row);
  const outstanding = _pmInvoiceOutstandingAmount(row);
  if (['issued', 'partially_paid', 'paid'].includes(status) && !invNo) issues.push('세금계산서번호 누락');
  if (['issued', 'partially_paid', 'paid'].includes(status) && !issueDate) issues.push('발행일 누락');
  if (status === 'paid' && outstanding > 0) issues.push('입금완료 상태인데 미수금 존재');
  if (status === 'paid' && paid <= 0) issues.push('입금완료 상태인데 입금금액 0');
  const certMeta = _pmInvoiceBizCertMetaFromRow(row);
  if (['requested', 'issued', 'partially_paid', 'paid', 'overdue'].includes(status) && !certMeta.url) {
    issues.push('사업자등록증 미첨부');
  }
  const payload = _pmInvoicePayload(row);
  const ocr = payload?.biz_cert_ocr_result && typeof payload.biz_cert_ocr_result === 'object'
    ? payload.biz_cert_ocr_result
    : null;
  if (ocr) {
    const bizDigitsForm = String(row?.buyer_business_no || '').replace(/[^\d]/g, '');
    const bizDigitsOcr = String(ocr.business_no || '').replace(/[^\d]/g, '');
    const companyForm = String(row?.buyer_company_name || '').trim();
    const companyOcr = String(ocr.company_name || '').trim();
    if (bizDigitsForm && bizDigitsOcr && bizDigitsForm !== bizDigitsOcr) {
      issues.push('OCR 사업자번호 불일치');
    }
    if (companyForm && companyOcr && companyForm !== companyOcr) {
      issues.push('OCR 상호 불일치');
    }
  }
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
  const buyerEl = document.getElementById('pm-inv-buyer-company');
  const serviceItemEl = document.getElementById('pm-inv-service-item-name');
  const costItemEl = document.getElementById('pm-inv-cost-item-name');
  const picked = _pmInvoicePlanSelectionForProject(projectCode);
  const pickedDue = String(picked?.dueDate || '').trim();
  if (plannedEl && !plannedEl.value && pickedDue) plannedEl.value = pickedDue;
  if (plannedEl && !plannedEl.value && nextMilestone?.due_date) plannedEl.value = nextMilestone.due_date;
  if (plannedEl) {
    const defaultDue = pickedDue || String(nextMilestone?.due_date || '').trim() || today;
    plannedEl.dataset.defaultIssueDate = defaultDue;
  }
  if (buyerEl && !buyerEl.value) buyerEl.value = String(project.client_name || '');
  if (serviceItemEl) {
    const defaultServiceItem = String(project.project_name || '용역대금').trim();
    serviceItemEl.dataset.defaultItemName = defaultServiceItem;
    if (!serviceItemEl.value) serviceItemEl.value = defaultServiceItem;
  }
  if (costItemEl) {
    costItemEl.dataset.defaultItemName = '프로젝트비용';
    if (!costItemEl.value) costItemEl.value = '프로젝트비용';
  }
  const modeEl = document.getElementById('pm-inv-request-mode');
  if (modeEl && !modeEl.value) modeEl.value = 'merged';
  const includeCostsEl = document.getElementById('pm-inv-include-billable-costs');
  if (includeCostsEl) includeCostsEl.checked = true;
  PM_STATE.invoiceBillableExpanded = false;
  _pmResetInvoicePreviewConfirmation(projectCode);
  _pmRenderInvoicePreviewPanel(null, '');
  const due = String(plannedEl?.value || '').trim();
  if (due) {
    const bounds = _pmInvoiceAmountBounds(project, projectCode, due);
    _pmSetInvoicePlanSelection(projectCode, due, bounds);
  }
  _pmRenderBillableCostRows(projectCode);
  _pmRefreshInvoicePlanSelectionUi(projectCode);
  _pmSyncInvoiceItemChangeReason(projectCode);
  _pmSyncInvoicePlannedIssueGuide(projectCode);
  _pmRenderInvoiceBizCertMeta(_pmPickInvoiceBizCertFromRows(PM_STATE.invoiceRowsByProject[projectCode]));
}

function pmCloseInvoiceProjectDetail() {
  PM_STATE.invoiceDetailProjectCode = '';
  PM_STATE.invoiceBillableExpanded = false;
  PM_STATE.invoicePreviewConfirmed = false;
  PM_STATE.invoicePreviewProjectCode = '';
  PM_STATE.invoicePreviewMonth = '';
  const billableBody = document.getElementById('pm-inv-billable-cost-body');
  if (billableBody) billableBody.innerHTML = '<tr><td colspan="6" class="table-empty"><i class="fas fa-receipt"></i><p>청구 가능한 비용 항목이 없습니다.</p></td></tr>';
  const billableSum = document.getElementById('pm-inv-billable-cost-summary');
  if (billableSum) billableSum.textContent = '청구비용 항목 0건 · 공급가액 0원';
  _pmRenderBillableCostVisibility();
  const billableAmount = document.getElementById('pm-inv-billable-cost-amount');
  if (billableAmount) billableAmount.value = '0';
  _pmRenderInvoicePreviewPanel(null, '');
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

function _pmBillingPlanSortRank(kind) {
  const k = String(kind || '').trim();
  if (k === '착수금') return 0;
  if (k === '중도금') return 1;
  if (k === '잔금') return 2;
  return 9;
}

function _pmRenderInvoicePlanTable(project) {
  const body = document.getElementById('pm-inv-plan-body');
  if (!body) return;
  const projectCode = String(project?.project_code || PM_STATE.invoiceDetailProjectCode || '').trim();
  const existingRows = _pmProjectInvoiceRows(projectCode);
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
    body.innerHTML = '<tr><td colspan="6" class="table-empty"><i class="fas fa-calendar-check"></i><p>청구일정 정보가 없습니다.</p></td></tr>';
    _pmRefreshInvoicePlanSelectionUi(projectCode);
    return;
  }
  rows.sort((a, b) => {
    const rankDiff = _pmBillingPlanSortRank(a.kind) - _pmBillingPlanSortRank(b.kind);
    if (rankDiff !== 0) return rankDiff;
    const dueA = /^\d{4}-\d{2}-\d{2}$/.test(String(a?.due || '').trim()) ? String(a.due).trim() : '9999-12-31';
    const dueB = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.due || '').trim()) ? String(b.due).trim() : '9999-12-31';
    const dueDiff = dueA.localeCompare(dueB);
    if (dueDiff !== 0) return dueDiff;
    return String(a?.kind || '').localeCompare(String(b?.kind || ''));
  });
  const selectedDue = String(_pmInvoicePlanSelectionForProject(projectCode)?.dueDate || '').trim();
  body.innerHTML = rows.map((r, i) => {
    const bounds = _pmInvoiceAmountBounds(project, projectCode, r.due, existingRows);
    const isSelected = !!selectedDue && selectedDue === String(r.due || '').trim();
    const isComplete = bounds.remaining <= 0;
    return `<tr class="pm-inv-plan-row ${isSelected ? 'is-selected' : ''} ${isComplete ? 'is-complete' : ''}" data-due-date="${_pmEsc(r.due || '')}" onclick="pmSelectInvoicePlanRow('${_pmEsc(r.due || '')}')">
      <td style="text-align:center">${i + 1}</td>
      <td>${_pmEsc(r.kind || '-')}</td>
      <td>${_pmEsc(r.due || '-')}</td>
      <td style="text-align:right">${_pmKrw(r.amount || 0)}</td>
      <td style="text-align:right">${_pmKrw(bounds.requested)}</td>
      <td style="text-align:right">${_pmKrw(bounds.remaining)}</td>
    </tr>`;
  }).join('');
  if (!selectedDue && rows[0]?.due) {
    pmSelectInvoicePlanRow(rows[0].due);
    return;
  }
  _pmRefreshInvoicePlanSelectionUi(projectCode);
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

function _pmRefreshInvoiceRowComputedAmounts(tr) {
  if (!tr) return;
  const paidEl = tr.querySelector('[data-f="paid"]');
  const outstandingEl = tr.querySelector('.pm-inv-history-outstanding');
  const invoiceAmount = Math.max(0, Number(tr.dataset.invoiceAmount || 0));
  const paid = _pmParseAmountInput(paidEl?.value || 0);
  const outstanding = Math.max(0, invoiceAmount - paid);
  if (outstandingEl) outstandingEl.textContent = _pmKrw(outstanding);
}

function _pmBindInvoiceDetailRowState() {
  const body = document.getElementById('pm-inv-detail-body');
  if (!body) return;
  const rows = body.querySelectorAll('tr[data-invoice-id]');
  rows.forEach((tr) => {
    tr.dataset.origSnapshot = _pmInvoiceRowSnapshot(tr);
    _pmRefreshInvoiceRowComputedAmounts(tr);
    _pmRefreshInvoiceRowSaveState(tr);
    tr.querySelectorAll('[data-f]').forEach((el) => {
      if (el.dataset.f === 'paid') {
        el.value = _pmFormatPaidAmountInput(el.value);
      }
      const evt = (el.tagName === 'SELECT') ? 'change' : 'input';
      el.addEventListener(evt, () => {
        if (el.dataset.f === 'paid') {
          el.value = _pmFormatPaidAmountInput(el.value);
          _pmRefreshInvoiceRowComputedAmounts(tr);
        }
        _pmRefreshInvoiceRowSaveState(tr);
      });
      if (evt !== 'change') {
        el.addEventListener('change', () => {
          if (el.dataset.f === 'paid') {
            el.value = _pmFormatPaidAmountInput(el.value);
            _pmRefreshInvoiceRowComputedAmounts(tr);
          }
          _pmRefreshInvoiceRowSaveState(tr);
        });
      }
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
  PM_STATE.invoiceRowsByProject[code] = [];
  PM_STATE.billableCostRowsByProject[code] = [];
  _pmRenderInvoicePlanTable(project);
  _pmRenderBillableCostRows(code);
  _pmApplyInvoiceRequestFormAvailability(code, project, []);
  const milestones = _pmCollectBillingMilestones(project.billing_schedule);
  const totalPlanned = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);
  if (summary) summary.textContent = `청구일정 ${milestones.length}건 · 예정합계 ${_pmKrw(totalPlanned)} · 고객사 ${project.client_name || '-'}`;
  _pmPrimeInvoiceRequestForm();
  try {
    await _pmLoadBillableCostRows(code);
    _pmRenderBillableCostRows(code);
    let rows = await API.listAllPages('project_invoices', { limit: 500, maxPages: 20, sort: 'updated_at' }).catch(() => []);
    rows = rows.filter((r) => String(r.project_code || '').trim() === code);
    const paymentRows = await _pmLoadInvoicePaymentRows(code);
    const paymentMap = _pmInvoicePaymentMap(paymentRows);
    rows = rows.map((r) => {
      const paidByHistory = _pmInvoicePaidAmountWithHistory(r, paymentMap);
      const out = Math.max(0, _pmInvoiceGrossAmount(r) - paidByHistory);
      const latestPayDate = String(paymentMap[String(r.id || '').trim()]?.latestDate || '').trim();
      return {
        ...r,
        paid_amount: paidByHistory,
        outstanding_amount: out,
        paid_date: latestPayDate || r.paid_date || '',
      };
    });
    PM_STATE.invoiceRowsByProject[code] = rows;
    _pmRenderInvoicePlanTable(project);
    _pmApplyInvoiceRequestFormAvailability(code, project, rows);
    _pmPrimeInvoiceRequestForm();
    _pmRenderInvoiceBizCertMeta(_pmPickInvoiceBizCertFromRows(rows));
    _pmRenderInvoicePaymentHistoryTable(rows, paymentRows);
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
    const totalOutstanding = rows.reduce((s, r) => s + _pmInvoiceOutstandingAmount(r), 0);
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
      const out = _pmInvoiceOutstandingAmount(r);
      const invNo = String(r.invoice_no || '').trim();
      const actionTitle = `${_pmInvoiceAuditInfoText(r)} | 세금계산서번호: ${invNo || '-'} | 입금일자: ${paidDate || '-'} | 확인자: ${confirmer || '-'}`;
      return `<tr
        data-invoice-id="${_pmEsc(r.id)}"
        data-project-code="${_pmEsc(r.project_code || code)}"
        data-invoice-amount="${_pmInvoiceGrossAmount(r)}"
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
        <td class="pm-inv-history-amt">${_pmKrw(_pmInvoiceGrossAmount(r))}</td>
        <td class="pm-inv-history-status">
          <select data-f="status" ${issueDisabled} class="form-control" style="min-height:28px;font-size:12px">
            <option value="requested" ${r._derived_status === 'requested' ? 'selected' : ''}>요청</option>
            <option value="issued" ${r._derived_status === 'issued' ? 'selected' : ''}>발행</option>
            <option value="partially_paid" ${r._derived_status === 'partially_paid' ? 'selected' : ''}>부분입금</option>
            <option value="paid" ${r._derived_status === 'paid' ? 'selected' : ''}>입금완료</option>
            <option value="overdue" ${r._derived_status === 'overdue' ? 'selected' : ''}>입금지연</option>
          </select>
        </td>
        <td class="pm-inv-history-paid"><input type="text" inputmode="numeric" data-f="paid" value="${Math.round(_pmInvoiceEffectivePaidAmount(r)).toLocaleString('ko-KR')}" readonly class="form-control" style="min-height:28px;font-size:12px;text-align:right;background:#f8fafc" title="입금이력의 누적 합계가 자동 반영됩니다."></td>
        <td class="pm-inv-history-outstanding">${_pmKrw(out)}</td>
        <td class="pm-inv-detail-actions" title="${_pmEsc(actionTitle)}">
          <div class="pm-inv-detail-actions-row">
            <button type="button" class="btn btn-sm btn-outline pm-inv-row-save-btn pm-inv-icon-btn" onclick="pmSaveInvoiceRow('${_pmEsc(r.id)}')" title="변경 저장" aria-label="변경 저장">
              <i class="fas fa-floppy-disk"></i>
            </button>
            ${canIssue ? `<button type="button" class="btn btn-sm btn-outline pm-inv-icon-btn" onclick="pmAddInvoicePayment('${_pmEsc(r.id)}')" title="입금등록" aria-label="입금등록"><i class="fas fa-coins"></i></button>` : ''}
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
  if (PM_STATE.currentTab !== 'invoice') {
    switchProjectMgmtTab('invoice');
  }
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
  const addMonths = (base, delta) => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d.setMonth(d.getMonth() + delta);
    return d;
  };
  let from = '';
  let to = '';
  if (kind === 'this_month') {
    const m = new Date(today.getFullYear(), today.getMonth(), 1);
    from = toDateText(m);
    to = toDateText(today);
  } else if (kind === 'last_3m') {
    const m = addMonths(today, -3);
    from = toDateText(m);
    to = toDateText(today);
  } else if (kind === 'last_6m') {
    const m = addMonths(today, -6);
    from = toDateText(m);
    to = toDateText(today);
  } else if (kind === 'last_1y') {
    const y = addMonths(today, -12);
    from = toDateText(y);
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

  // 연쇄 드롭다운:
  // 사업부 선택 -> 본부 옵션 축소
  // 본부 선택    -> 고객지원팀 옵션 축소
  const depts = uniq(rows.map((r) => r._dept_name));
  const deptScopedRows = prev.dept ? rows.filter((r) => String(r._dept_name || '') === prev.dept) : rows;
  const hqs = uniq(deptScopedRows.map((r) => r._hq_name));

  const hqStillValid = !prev.hq || hqs.includes(prev.hq);
  const safeHq = hqStillValid ? prev.hq : '';
  const hqScopedRows = safeHq ? deptScopedRows.filter((r) => String(r._hq_name || '') === safeHq) : deptScopedRows;
  const css = uniq(hqScopedRows.map((r) => r._cs_team_name));

  const csStillValid = !prev.cs || css.includes(prev.cs);
  const safeCs = csStillValid ? prev.cs : '';

  const pms = uniq(rows.map((r) => _pmResolveCpmName(r)));
  if (deptEl) {
    deptEl.innerHTML = '<option value="">사업부 전체</option>' + depts.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
    if (prev.dept && [...deptEl.options].some((o) => o.value === prev.dept)) deptEl.value = prev.dept;
  }
  if (hqEl) {
    hqEl.innerHTML = '<option value="">본부 전체</option>' + hqs.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
    if (safeHq && [...hqEl.options].some((o) => o.value === safeHq)) hqEl.value = safeHq;
  }
  if (csEl) {
    csEl.innerHTML = '<option value="">고객지원팀 전체</option>' + css.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
    if (safeCs && [...csEl.options].some((o) => o.value === safeCs)) csEl.value = safeCs;
  }
  // 고객사는 텍스트 검색(input) 방식이므로 값만 유지
  if (clientEl) clientEl.value = prev.client;
  if (pmEl) {
    pmEl.innerHTML = '<option value="">CPM 전체</option>' + pms.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
    if (prev.pm && [...pmEl.options].some((o) => o.value === prev.pm)) pmEl.value = prev.pm;
  }
}

function _pmFillInvoiceListFilters() {
  const elC = document.getElementById('pm-inv-filter-client');
  const elP = document.getElementById('pm-inv-filter-pm');
  const elDept = document.getElementById('pm-inv-filter-dept');
  const elHq = document.getElementById('pm-inv-filter-hq');
  if (!elC || !elP || !elDept || !elHq) return;
  const uniq = (arr) => [...new Set(arr.filter(Boolean).map((v) => String(v).trim()))].sort((a, b) => a.localeCompare(b, 'ko'));
  const prev = {
    c: String(elC.value || '').trim(),
    p: String(elP.value || '').trim(),
    dept: String(elDept.value || '').trim(),
    hq: String(elHq.value || '').trim(),
  };
  const projects = PM_STATE.projects || [];
  const orgRows = projects.map((r) => _pmInvoicePmAndTeam(r));
  const depts = uniq(orgRows.map((m) => m.deptName).filter((x) => x && x !== '-'));
  const hqCandidates = orgRows.filter((m) => !prev.dept || m.deptName === prev.dept);
  const hqs = uniq(hqCandidates.map((m) => m.hqName).filter((x) => x && x !== '-'));
  elDept.innerHTML = '<option value="">사업부 전체</option>' + depts.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
  elHq.innerHTML = '<option value="">본부 전체</option>' + hqs.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
  if (prev.dept && [...elDept.options].some((o) => o.value === prev.dept)) elDept.value = prev.dept;
  if (prev.hq && [...elHq.options].some((o) => o.value === prev.hq)) elHq.value = prev.hq;
  // 텍스트 검색 입력값은 유지
  elC.value = prev.c;
  elP.value = prev.p;
}

function _pmMonthKey(dateLike) {
  const s = String(dateLike || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s.slice(0, 7);
}

function _pmNormText(v) {
  return String(v || '').toLowerCase().replace(/\s+/g, '').trim();
}

function _pmInvoiceAlertContext() {
  const raw = window.__PM_INVOICE_ALERT__;
  if (!raw || typeof raw !== 'object') return null;
  const projectCode = String(raw.projectCode || '').trim();
  const dueDate = String(raw.dueDate || '').trim();
  const mode = String(raw.mode || 'edit_due').trim();
  if (!projectCode || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  return { projectCode, dueDate, mode };
}

function _pmApplyInvoiceAlertContext() {
  const ctx = _pmInvoiceAlertContext();
  if (!ctx) return;
  // 알림 진입 시 기존 상세 오버레이가 남아있으면 먼저 정리
  pmCloseInvoiceProjectDetail();
  const month = _pmMonthKey(ctx.dueDate);
  const monthEl = document.getElementById('pm-inv-month');
  if (monthEl && month && monthEl.value !== month) monthEl.value = month;
  pmInvoiceSwitchListTab(ctx.mode === 'open_issued_list' ? 'issued' : 'planned');
  _pmShowInvoiceAlertGuide(ctx);
  if (!_pmHasProjectAccess(ctx.projectCode)) {
    window.__PM_INVOICE_ALERT__ = null;
    return;
  }
  window.__PM_INVOICE_ALERT__ = null;
  _pmHighlightInvoiceRows(ctx.projectCode);
  setTimeout(async () => {
    try {
      if (ctx.mode === 'open_issued_list') {
        return;
      }
      await pmOpenInvoiceProjectDetail(ctx.projectCode);
      const plannedEl = document.getElementById('pm-inv-planned-issue-date');
      if (plannedEl) {
        if (!plannedEl.value) plannedEl.value = ctx.dueDate;
        plannedEl.focus();
        plannedEl.select?.();
      }
    } catch (_) {}
  }, 0);
}

function _pmHighlightInvoiceRows(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code) return;
  let firstMatched = null;
  document.querySelectorAll('#pm-inv-planned-body tr[data-project-code], #pm-inv-issued-body tr[data-project-code]').forEach((tr) => {
    tr.classList.remove('pm-inv-row-highlight');
    tr.classList.remove('pm-inv-row-highlight-on');
    if (String(tr.dataset.projectCode || '').trim() !== code) return;
    if (!firstMatched) firstMatched = tr;
    tr.classList.add('pm-inv-row-highlight');
    requestAnimationFrame(() => tr.classList.add('pm-inv-row-highlight-on'));
    setTimeout(() => {
      tr.classList.remove('pm-inv-row-highlight-on');
      tr.classList.remove('pm-inv-row-highlight');
    }, 2200);
  });
  if (firstMatched && typeof firstMatched.scrollIntoView === 'function') {
    firstMatched.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function _pmShowInvoiceAlertGuide(ctx) {
  const el = document.getElementById('pm-inv-alert-guide');
  if (!el) return;
  const mode = String(ctx?.mode || '').trim();
  const projectCode = String(ctx?.projectCode || '').trim();
  const dueDate = String(ctx?.dueDate || '').trim();
  if (!projectCode) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  if (mode === 'open_issued_list') {
    el.textContent = `[입금지연 안내] ${projectCode} (기준일 ${dueDate || '-'}) 건으로 이동했습니다. 발행목록에서 상태를 확인해 주세요.`;
  } else {
    el.textContent = `[예상청구일 지연 안내] ${projectCode} (기준일 ${dueDate || '-'}) 건으로 이동했습니다. 예상청구일정을 수정해 주세요.`;
  }
  el.style.display = '';
  setTimeout(() => {
    if (!el.textContent) return;
    el.style.display = 'none';
    el.textContent = '';
  }, 5000);
}

function _pmProjectResponsibleUsers(project) {
  const p = project || {};
  const users = [];
  const pushUser = (id, name) => {
    const uid = String(id || '').trim();
    if (!uid) return;
    if (users.some((u) => u.id === uid)) return;
    users.push({ id: uid, name: String(name || '').trim() });
  };
  pushUser(p.cpm_user_id, p.cpm_user_name);
  const assistants = _pmProgressParseAssistants(String(p.order_contributors_text || ''));
  assistants.forEach((a) => {
    if (String(a.project_role || '').trim() === '실무 책임자') {
      pushUser(a.user_id, a.name);
    }
  });
  return users;
}

function _pmPracticalPmFromAssistants(rows) {
  const list = Array.isArray(rows) ? rows : [];
  // 정책 변경: 수행중 판정은 "투입인력현황에 실무 책임자 등록 여부"를 기준으로 본다.
  // user_id 매핑이 비어 있어도 이름이 있으면 실무 책임자로 인정한다.
  return list.find((r) =>
    String(r.project_role || '').trim() === '실무 책임자' &&
    (String(r.user_id || '').trim() || String(r.name || '').trim())
  ) || null;
}

async function _pmNotifyInvoiceDueDelays(delayedRows, monthKey) {
  if (typeof createNotification !== 'function') return;
  const session = getSession ? getSession() : null;
  const actorId = String((session && (session.id || session.user_id)) || '');
  const actorName = String((session && (session.name || session.user_name)) || '');
  const todayKey = _pmTodayDateText();
  const rows = Array.isArray(delayedRows) ? delayedRows : [];
  for (const row of rows) {
    const projectCode = String(row.project_code || '').trim();
    const dueDate = String(row.planned_issue_date || '').trim();
    if (!projectCode || !_pmMonthKey(dueDate)) continue;
    const project = PM_STATE.projectByCode[projectCode] || {};
    const clientName = String(project.client_name || row.client_name || '').trim() || '-';
    const receivers = _pmProjectResponsibleUsers(project);
    for (const to of receivers) {
      const notifyKey = `${todayKey}|${to.id}|${projectCode}|${dueDate}|invoice_due_remind`;
      if (PM_STATE.invoiceDelayNotifySent[notifyKey]) continue;
      PM_STATE.invoiceDelayNotifySent[notifyKey] = true;
      createNotification({
        toUserId: to.id,
        toUserName: to.name || '',
        fromUserId: actorId,
        fromUserName: actorName,
        type: 'invoice_due_remind',
        entryId: `INV_DUE|${projectCode}|${dueDate}|edit_due`,
        entrySummary: `${clientName} · ${projectCode} · ${monthKey}`,
        message: `[지연-필수조치] ${clientName} / ${projectCode}의 예상청구일(${dueDate})이 경과했습니다. 예상청구일을 수정하거나 세금계산서를 발행해 주세요.`,
        targetMenu: 'project-management:invoice',
      });
    }
  }
}

async function _pmNotifyInvoiceOverduePayments(rows, monthKey) {
  if (typeof createNotification !== 'function') return;
  const session = getSession ? getSession() : null;
  const actorId = String((session && (session.id || session.user_id)) || '');
  const actorName = String((session && (session.name || session.user_name)) || '');
  const todayKey = _pmTodayDateText();
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    const projectCode = String(row.project_code || '').trim();
    const dueDate = String(row.expected_payment_date || row.due_date || '').trim();
    if (!projectCode || !_pmMonthKey(dueDate)) continue;
    const project = PM_STATE.projectByCode[projectCode] || {};
    const receivers = _pmProjectResponsibleUsers(project);
    for (const to of receivers) {
      const notifyKey = `${todayKey}|${to.id}|${projectCode}|${dueDate}|invoice_overdue_remind`;
      if (PM_STATE.invoiceDelayNotifySent[notifyKey]) continue;
      PM_STATE.invoiceDelayNotifySent[notifyKey] = true;
      createNotification({
        toUserId: to.id,
        toUserName: to.name || '',
        fromUserId: actorId,
        fromUserName: actorName,
        type: 'invoice_overdue_remind',
        entryId: `INV_DUE|${projectCode}|${dueDate}|open_issued_list`,
        entrySummary: `${projectCode} · ${monthKey}`,
        message: `[입금지연-필수확인] ${projectCode}의 입금예정일(${dueDate})이 경과했습니다. 클릭하여 발행목록에서 상태를 확인해 주세요.`,
        targetMenu: 'project-management:invoice',
      });
    }
  }
}

async function _pmNotifyInvoiceShortPayment(row, paidAmount, outstandingAmount, invoiceAmount) {
  if (typeof createNotification !== 'function') return;
  const r = row || {};
  const projectCode = String(r.project_code || '').trim();
  if (!projectCode) return;
  const invoiceId = String(r.id || '').trim();
  const project = PM_STATE.projectByCode[projectCode] || {};
  const clientName = String(project.client_name || r.client_name || '').trim() || '-';
  const dueDate = String(r.expected_payment_date || r.due_date || _pmTodayDateText()).trim();
  const monthKey = _pmMonthKey(dueDate) || _pmNowMonth();
  const paid = Math.max(0, Number(paidAmount || 0));
  const outstanding = Math.max(0, Number(outstandingAmount || 0));
  const total = Math.max(0, Number(invoiceAmount || 0));
  if (!(total > 0) || !(outstanding > 0)) return;
  const receivers = _pmProjectResponsibleUsers(project);
  if (!receivers.length) return;
  const session = getSession ? getSession() : null;
  const actorId = String((session && (session.id || session.user_id)) || '');
  const actorName = String((session && (session.name || session.user_name)) || '');
  const todayKey = _pmTodayDateText();
  for (const to of receivers) {
    const notifyKey = `${todayKey}|${to.id}|${invoiceId || projectCode}|invoice_short_paid_alert`;
    if (PM_STATE.invoiceDelayNotifySent[notifyKey]) continue;
    PM_STATE.invoiceDelayNotifySent[notifyKey] = true;
    createNotification({
      toUserId: to.id,
      toUserName: to.name || '',
      fromUserId: actorId,
      fromUserName: actorName,
      type: 'invoice_short_paid_alert',
      entryId: `INV_DUE|${projectCode}|${dueDate}|open_issued_list`,
      entrySummary: `${clientName} · ${projectCode} · ${monthKey}`,
      message: `[부분입금-사유확인] ${clientName} / ${projectCode} 건 발행 ${_pmKrw(total)} 대비 입금 ${_pmKrw(paid)} (미수금 ${_pmKrw(outstanding)})입니다. 사유를 확인해 주세요.`,
      targetMenu: 'project-management:invoice',
    });
  }
}

function _pmInvoicePaymentStatusBadge(status) {
  const s = String(status || '').trim();
  if (s === 'paid') return _pmStatusBadge('입금완료', '#047857', '#d1fae5');
  if (s === 'partially_paid') return _pmStatusBadge('부분입금', '#92400e', '#fef3c7');
  if (s === 'issued') return _pmStatusBadge('발행완료', '#1d4ed8', '#dbeafe');
  if (s === 'overdue') return _pmStatusBadge('입금지연', '#b91c1c', '#fee2e2');
  if (s === 'cancelled') return _pmStatusBadge('취소', '#64748b', '#e2e8f0');
  return _pmStatusBadge('발행요청', '#475569', '#e2e8f0');
}

function _pmInvoiceIssueStatusBadge(row) {
  const pay = String(row?.payment_status || '').trim();
  const issueDate = String(row?.issue_date || '').trim();
  const nts = String(row?.nts_issue_status || '').trim().toLowerCase();
  // 보수적 판정: 실제 발행일이 있거나, 입금/발행 진행 상태가 명확할 때만 발행완료
  if (issueDate || ['issued', 'partially_paid', 'paid', 'overdue'].includes(pay)) {
    return _pmStatusBadge('발행완료', '#1d4ed8', '#dbeafe');
  }
  if (nts === 'failed' || nts === 'error') {
    return _pmStatusBadge('발행실패', '#b91c1c', '#fee2e2');
  }
  if (['pending', 'requested'].includes(nts) || pay === 'requested') {
    return _pmStatusBadge('발행요청', '#475569', '#e2e8f0');
  }
  return _pmStatusBadge('발행요청', '#475569', '#e2e8f0');
}

function _pmInvoiceAuditInfoText(row) {
  const requestedBy = String(row?.issue_requested_by_name || '').trim() || '-';
  const reqTsRaw = Number(row?.issue_requested_at || 0);
  const reqTs = reqTsRaw > 0 ? (reqTsRaw < 1e12 ? reqTsRaw * 1000 : reqTsRaw) : 0;
  const requestedAt = reqTs ? _pmTsToDateText(reqTs) : '-';
  const issueDate = String(row?.issue_date || '').trim() || '-';
  const payStatus = String(row?.payment_status || '').trim() || '-';
  const ntsStatus = String(row?.nts_issue_status || '').trim() || '-';
  return `요청자: ${requestedBy} | 요청일: ${requestedAt} | 발행일: ${issueDate} | payment_status: ${payStatus} | nts_issue_status: ${ntsStatus}`;
}

function _pmInvoiceDisplayCell(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t || t === '-') return '<span class="pm-inv-empty">-</span>';
  return _pmEsc(t);
}

function _pmInvoicePlannedStatus(row, todayText) {
  const payStatus = String(row?.payment_status || '').trim();
  const ntsStatus = String(row?.nts_issue_status || '').trim();
  const issued = String(row?.issue_date || '').trim();
  if (issued) return { key: 'done', badge: _pmStatusBadge('완료', '#047857', '#d1fae5') };
  if (payStatus === 'cancelled') return { key: 'cancelled', badge: _pmStatusBadge('취소', '#64748b', '#e2e8f0') };
  if (['partially_paid', 'paid', 'overdue'].includes(payStatus)) {
    return { key: 'issued', badge: _pmStatusBadge('발행완료', '#1d4ed8', '#dbeafe') };
  }
  if (payStatus === 'requested' || ['pending', 'requested'].includes(ntsStatus)) {
    return { key: 'requested', badge: _pmStatusBadge('발행요청', '#475569', '#e2e8f0') };
  }
  const planned = String(row?.planned_issue_date || '').trim();
  if (planned && planned < todayText) return { key: 'delayed', badge: _pmStatusBadge('지연', '#b91c1c', '#fee2e2') };
  return { key: 'planned', badge: _pmStatusBadge('예정', '#1d4ed8', '#dbeafe') };
}

function pmInvoiceSwitchListTab(tab) {
  PM_STATE.invoiceListTab = tab === 'issued' ? 'issued' : 'planned';
  const plannedWrap = document.getElementById('pm-inv-tab-planned-wrap');
  const issuedWrap = document.getElementById('pm-inv-tab-issued-wrap');
  if (plannedWrap) plannedWrap.style.display = PM_STATE.invoiceListTab === 'planned' ? 'block' : 'none';
  if (issuedWrap) issuedWrap.style.display = PM_STATE.invoiceListTab === 'issued' ? 'block' : 'none';
  document.querySelectorAll('[data-pm-inv-tab]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-pm-inv-tab') === PM_STATE.invoiceListTab);
  });
}

function _pmEntryToWorkDate(entry) {
  const ts = Number(entry && entry.work_start_at || 0);
  if (!ts) return '';
  return _pmTsToDateText(ts);
}

async function _pmLoadProjects(opts = {}) {
  const force = !!opts.force;
  const now = Date.now();
  if (!force && PM_STATE.projectsLoadedAt && (now - PM_STATE.projectsLoadedAt) < 120000 && PM_STATE.projects.length) {
    return;
  }
  const session = getSession ? getSession() : null;
  let rows = [];
  let codeTypes = [];
  try {
    rows = await API.listAllPages('registered_projects', { limit: 400, maxPages: 20, sort: 'updated_at' });
  } catch (e) {
    console.warn('[pm] registered_projects load failed', e);
    rows = [];
  }
  try {
    codeTypes = await API.listAllPages('project_code_types', { limit: 500, maxPages: 10, sort: 'main_code' });
  } catch (e) {
    console.warn('[pm] project_code_types load failed', e);
    codeTypes = [];
  }
  PM_STATE.projectCodeTypes = Array.isArray(codeTypes) ? codeTypes : [];
  PM_STATE.projects = _pmFilterProjectsByScope(rows, session)
    .filter((r) => String(r.project_code || '').trim() !== '');
  PM_STATE.projectByCode = {};
  PM_STATE.projects.forEach((r) => {
    const code = String(r.project_code || '').trim();
    if (code && !PM_STATE.projectByCode[code]) PM_STATE.projectByCode[code] = r;
  });
  PM_STATE.projectsLoadedAt = Date.now();
}

async function _pmLoadUsers(opts = {}) {
  const force = !!opts.force;
  const now = Date.now();
  if (!force && PM_STATE.usersLoadedAt && (now - PM_STATE.usersLoadedAt) < 300000 && PM_STATE.users.length) {
    return;
  }
  try {
    PM_STATE.users = await Master.users();
  } catch (_) {
    PM_STATE.users = [];
  }
  PM_STATE.usersById = {};
  PM_STATE.users.forEach((u) => {
    PM_STATE.usersById[String(u.id)] = u;
  });
  PM_STATE.usersLoadedAt = Date.now();
}

function _pmProjectLabel(p) {
  const code = String(p && p.project_code || '').trim();
  const name = String(p && p.project_name || '').trim();
  if (code && name) return `${code} · ${name}`;
  return code || name || '-';
}

function _pmRoleLabel(role) {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'staff') return '담당(전임/선임/책임)';
  if (r === 'manager') return '팀장';
  if (r === 'director') return '본부장';
  if (r === 'top_mgr') return '사업부장';
  if (r === 'admin') return 'Admin';
  return r || '-';
}

function _pmResolveCpmName(project, userMap = null) {
  const p = project || {};
  const byName = String(p.cpm_user_name || '').trim();
  if (byName) return byName;
  const uid = String(p.cpm_user_id || '').trim();
  if (!uid) return '';
  const map = userMap || PM_STATE.usersById || {};
  return String((map[uid] && map[uid].name) || '').trim();
}

function _pmLifecycleStatusForCpmPolicy(row) {
  const r = row || {};
  const override = String(r.lifecycle_status_override || '').trim();
  if (override && PM_LIFECYCLE[override]) return override;
  if (Number(r.settled_at || 0) > 0) return 'settled_done';
  if (Number(r.work_closed_at || 0) > 0) return 'work_closed';
  if (Number(r.execution_started_at || 0) > 0) return 'in_progress';
  return 'contract_completed';
}

function _pmIsCpmEligible(u) {
  const r = String((u && u.role) || '').trim().toLowerCase();
  return r === 'manager' || r === 'director' || r === 'top_mgr' || r === 'admin';
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
  return {
    pmName,
    teamLabel,
    deptName: dept || '-',
    hqName: hq || '-',
  };
}

function _pmNormDeptCode(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return '';
  if (s.includes('COB')) return 'COB';
  if (s.includes('CRB')) return 'CRB';
  if (s.includes('CCB')) return 'CCB';
  return String(v || '').trim();
}

function _pmResolveProjectOrg(project, userMap) {
  const p = project || {};
  const map = userMap || {};
  const cpm = map[String(p.cpm_user_id || '').trim()] || null;
  const creator = map[String(p.created_by || '').trim()] || null;
  const deptRaw = String(
    (cpm && cpm.dept_name)
    || (creator && creator.dept_name)
    || p.dept_name
    || ''
  ).trim();
  const hqRaw = String(
    (cpm && cpm.hq_name)
    || (creator && creator.hq_name)
    || p.hq_name
    || ''
  ).trim();
  const csRaw = String(
    (cpm && (cpm.cs_team_name || cpm.team_name))
    || (creator && (creator.cs_team_name || creator.team_name))
    || p.cs_team_name
    || p.team_name
    || ''
  ).trim();
  return {
    dept: _pmNormDeptCode(deptRaw),
    hq: hqRaw,
    cs: csRaw,
  };
}

function _pmCurrentPageMode() {
  if (String(window.__PM_PENDING_TAB__ || '').trim()) return 'manage';
  if (window.__PM_INVOICE_ALERT__) return 'manage';
  const activePage = document.querySelector('.nav-item.active')?.dataset.page || '';
  return activePage === 'project-management' ? 'manage' : 'register';
}

function _pmEnsureProgressDetailModalPortal() {
  const modal = document.getElementById('pmProgressDetailModal');
  if (!modal) return;
  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
  const actionModal = document.getElementById('pmOutputActionModal');
  if (actionModal && actionModal.parentElement !== document.body) {
    document.body.appendChild(actionModal);
  }
  const publishModal = document.getElementById('pmOutputPublishModal');
  if (publishModal && publishModal.parentElement !== document.body) {
    document.body.appendChild(publishModal);
  }
}

function _pmEnsureCustomerInvoiceModalPortal() {
  const backdrop = document.getElementById('pm-cinv-backdrop');
  const modal = document.getElementById('pm-cinv-modal');
  if (backdrop && backdrop.parentElement !== document.body) {
    document.body.appendChild(backdrop);
  }
  if (modal && modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }
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

function _pmApprovedProjectsForExpenseFilter() {
  return (PM_STATE.projects || []).filter((p) => {
    const reg = String(p?.registration_status || '').trim().toLowerCase();
    return reg === 'approved' && _pmIsProjectInProgress(p);
  });
}

function _pmFillExpenseFilterDatalists() {
  const projectList = document.getElementById('pm-exp-filter-project-options');
  const clientList = document.getElementById('pm-exp-filter-client-options');
  if (!projectList && !clientList) return;

  const approved = _pmApprovedProjectsForExpenseFilter();
  const codeSet = new Set();
  const clientSet = new Set();
  approved.forEach((p) => {
    const code = String(p?.project_code || '').trim();
    const client = String(p?.client_name || '').trim();
    if (code) codeSet.add(code);
    if (client) clientSet.add(client);
  });

  const codes = [...codeSet].sort((a, b) => a.localeCompare(b));
  const clients = [...clientSet].sort((a, b) => a.localeCompare(b, 'ko'));

  if (projectList) {
    projectList.innerHTML = codes.map((v) => `<option value="${_pmEsc(v)}"></option>`).join('');
  }
  if (clientList) {
    clientList.innerHTML = clients.map((v) => `<option value="${_pmEsc(v)}"></option>`).join('');
  }
}

function _pmTimeChargeMainCodeFromProject(project) {
  const typeId = String(project?.project_code_type_id || '').trim();
  if (!typeId) return '';
  const type = (PM_STATE.projectCodeTypes || []).find((t) => String(t.id || '').trim() === typeId);
  return String(type?.main_code || '').trim();
}

function _pmFillTimeChargeBaseFilters() {
  const clientList = document.getElementById('pm-tc-client-options');
  const mainSel = document.getElementById('pm-tc-main-code');
  if (!clientList && !mainSel) return;
  const rows = (PM_STATE.projects || []).slice();
  const clients = [...new Set(rows.map((p) => String(p?.client_name || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  PM_STATE.timeChargeClientCatalog = clients.slice();
  if (clientList) {
    clientList.innerHTML = clients.map((v) => `<option value="${_pmEsc(v)}"></option>`).join('');
  }
  const selectedClient = _pmSelectedTimeChargeClient();
  if (mainSel) {
    const prev = String(mainSel.value || '').trim();
    const byMain = {};
    rows.forEach((p) => {
      if (selectedClient && String(p?.client_name || '').trim() !== selectedClient) return;
      const mc = _pmTimeChargeMainCodeFromProject(p);
      if (!mc) return;
      if (!byMain[mc]) {
        const typeId = String(p?.project_code_type_id || '').trim();
        const type = (PM_STATE.projectCodeTypes || []).find((t) => String(t.id || '').trim() === typeId);
        const label = `${mc}${type?.main_category ? ` · ${type.main_category}` : ''}`;
        byMain[mc] = label;
      }
    });
    const mainPlaceholder = selectedClient ? '해당 고객사 대분류' : '전체 대분류';
    mainSel.innerHTML = `<option value="">${mainPlaceholder}</option>`
      + Object.keys(byMain).sort((a, b) => a.localeCompare(b)).map((mc) => `<option value="${_pmEsc(mc)}">${_pmEsc(byMain[mc])}</option>`).join('');
    if (prev && [...mainSel.options].some((o) => o.value === prev)) mainSel.value = prev;
  }
}

function _pmSelectedTimeChargeClient() {
  const raw = String(document.getElementById('pm-tc-client-search')?.value || '').trim();
  if (!raw) return '';
  const catalog = (PM_STATE.timeChargeClientCatalog || []).slice();
  const exact = catalog.find((c) => String(c).toLowerCase() === raw.toLowerCase());
  return exact || '';
}

function _pmNormalizeTimeChargeClientInput() {
  const input = document.getElementById('pm-tc-client-search');
  if (!input) return;
  const raw = String(input.value || '').trim();
  if (!raw) return;
  const catalog = (PM_STATE.timeChargeClientCatalog || []).slice();
  const exact = catalog.find((c) => String(c).toLowerCase() === raw.toLowerCase());
  if (exact) {
    input.value = exact;
  }
  // 부분 검색(contains)은 그대로 허용한다.
  // 기존처럼 강제로 비우면 "검색이 안 되는" UX가 되어 입력 흐름이 끊긴다.
}

function _pmApplyTimeChargeProjectFilter() {
  const projectSel = document.getElementById('pm-tc-project');
  if (!projectSel) return;
  const prev = String(projectSel.value || '').trim();
  const selectedClient = _pmSelectedTimeChargeClient();
  const mainCode = String(document.getElementById('pm-tc-main-code')?.value || '').trim();
  const rows = (PM_STATE.projects || []).filter((p) => {
    const code = String(p?.project_code || '').trim();
    if (!code) return false;
    if (selectedClient && String(p?.client_name || '').trim() !== selectedClient) return false;
    if (mainCode && _pmTimeChargeMainCodeFromProject(p) !== mainCode) return false;
    return true;
  }).sort((a, b) => String(a.project_code || '').localeCompare(String(b.project_code || '')));
  projectSel.innerHTML = `<option value="">프로젝트 선택${rows.length ? ` (${rows.length}건)` : ''}</option>`;
  rows.forEach((p) => {
    const code = String(p.project_code || '').trim();
    if (!code) return;
    const opt = document.createElement('option');
    opt.value = code;
    const client = String(p.client_name || '').trim();
    opt.textContent = client ? `${_pmProjectLabel(p)} (${client})` : _pmProjectLabel(p);
    projectSel.appendChild(opt);
  });
  if (prev && [...projectSel.options].some((o) => o.value === prev)) {
    projectSel.value = prev;
  } else {
    projectSel.value = '';
  }
}

function _pmTimeChargeBatchMonth(projectCode) {
  const code = String(projectCode || document.getElementById('pm-tc-project')?.value || '').trim();
  if (code && PM_STATE.currentBatch && String(PM_STATE.currentBatch.project_code || '').trim() === code) {
    const m = String(PM_STATE.currentBatch.billing_month || '').trim();
    if (m) return m;
  }
  return _pmNowMonth();
}

function _pmSyncTimeChargeActionAvailability() {
  const session = getSession ? getSession() : null;
  const canWrite = !!(session && (Auth.canApprove1st(session) || Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session)));
  const projectCode = String(document.getElementById('pm-tc-project')?.value || '').trim();
  const canRequest = _pmCanRequestInvoiceForProject(session, projectCode);
  const hasProject = !!projectCode;
  const batchId = String(PM_STATE.currentBatch?.id || '').trim();
  const invoiceReady = !!(batchId && PM_STATE.timechargeInvoiceGeneratedByBatch && PM_STATE.timechargeInvoiceGeneratedByBatch[batchId]);
  const mode = _pmTimeChargeDataSource();
  const hasPending = (PM_STATE.pendingTimeChargeUploadRows || []).length > 0;
  const apply = (id, disabled) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!disabled;
  };
  apply('pm-tc-download-template-btn', !canWrite);
  apply('pm-tc-import-btn', !canWrite || !hasProject || mode === 'excel');
  apply('pm-tc-upload-open-btn', !canWrite || !hasProject || mode === 'timesheet');
  apply('pm-tc-upload-save-btn', !canWrite || !hasProject || !hasPending || mode === 'timesheet');
  apply('pm-tc-upload-cancel-btn', !canWrite || !hasPending);
  apply('pm-tc-save-btn', !canWrite || !hasProject);
  apply('pm-tc-generate-print-btn', !canWrite || !hasProject);
  apply('pm-tc-invoice-pdf-btn', !canWrite || !hasProject);
  apply('pm-tc-request-btn', !canRequest || !hasProject || !invoiceReady);
  const uploadFile = document.getElementById('pm-tc-upload-file');
  if (uploadFile) uploadFile.disabled = !canWrite || !hasProject || mode === 'timesheet';
  _pmSyncTimeChargeDocTabUi();
}

function _pmHoursText(minutes) {
  const h = Number(minutes || 0) / 60;
  return `${h.toFixed(1)}h`;
}

function pmTimeChargeSwitchDocTab(tab) {
  const key = ['status', 'invoice', 'tax'].includes(tab) ? tab : 'status';
  PM_STATE.timechargeDocTab = key;
  _pmSyncTimeChargeDocTabUi();
}

function _pmSyncTimeChargeDocTabUi() {
  const tab = PM_STATE.timechargeDocTab || 'status';
  const setActive = (btnId, active) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.toggle('is-active', !!active);
  };
  setActive('pm-tc-doc-tab-status-btn', tab === 'status');
  setActive('pm-tc-doc-tab-invoice-btn', tab === 'invoice');
  setActive('pm-tc-doc-tab-tax-btn', tab === 'tax');
  const statusWrap = document.getElementById('pm-tc-doc-status-wrap');
  const invWrap = document.getElementById('pm-tc-doc-invoice-wrap');
  const taxWrap = document.getElementById('pm-tc-doc-tax-wrap');
  if (statusWrap) statusWrap.style.display = tab === 'status' ? '' : 'none';
  if (invWrap) invWrap.style.display = tab === 'invoice' ? '' : 'none';
  if (taxWrap) taxWrap.style.display = tab === 'tax' ? '' : 'none';
  const reqBtn = document.getElementById('pm-tc-request-btn');
  const closeBtn = document.getElementById('pm-tc-invoice-close-btn');
  if (reqBtn) reqBtn.style.display = '';
  if (closeBtn) closeBtn.style.display = tab === 'invoice' ? '' : 'none';
}

function _pmRenderTimeChargeInvoicePreviewHtml() {
  const lines = PM_STATE.currentLines || [];
  if (!lines.length) return '<div class="pm-inv-doc-preview-empty">표시할 타임차지 데이터가 없습니다.</div>';
  const projectCode = String(document.getElementById('pm-tc-project')?.value || PM_STATE.currentBatch?.project_code || '').trim();
  const project = PM_STATE.projectByCode[projectCode] || {};
  const summaryRich = _pmTimechargeSummaryRich(lines);
  const summaryRows = summaryRich
    .slice()
    .sort((a, b) => String(a.Consultant).localeCompare(String(b.Consultant), 'ko'));
  const subtotal = summaryRows.reduce((sum, r) => sum + Number(r._amount || 0), 0);
  const cap = _pmTimechargeContractCap(projectCode);
  const claim = cap > 0 ? Math.min(subtotal, cap) : subtotal;
  const rowsHtml = summaryRows.map((r, i) => `<tr>
    <td style="text-align:center">${i + 1}</td>
    <td style="text-align:center">${_pmEsc(r.Consultant || '-')}</td>
    <td style="text-align:center">${_pmEsc(r.Position || '-')}</td>
    <td style="text-align:right">${_pmKrw(Number(r['Time Rate'] || 0))}</td>
    <td style="text-align:center">${_pmEsc(Number(r.Time || 0).toFixed(1))}h</td>
    <td style="text-align:right">${_pmKrw(Number(r['Time Charge'] || 0))}</td>
  </tr>`).join('');
  const detailSections = summaryRich
    .slice()
    .sort((a, b) => {
      const rank = Number(b._roleRank || 0) - Number(a._roleRank || 0);
      if (rank !== 0) return rank;
      return String(a.Consultant || '').localeCompare(String(b.Consultant || ''), 'ko');
    })
    .map((person, idx) => {
      const detailRows = (person._rows || [])
        .slice()
        .sort((a, b) => {
          const d = String(a.work_date || '').localeCompare(String(b.work_date || ''));
          if (d !== 0) return d;
          return String(_pmTimechargeDisplayParts(a).timeRange || '').localeCompare(String(_pmTimechargeDisplayParts(b).timeRange || ''));
        });
      const detailHtml = detailRows.map((r, i) => {
        const parts = _pmTimechargeDisplayParts(r);
        const minutes = Number(r.final_minutes || r.base_minutes || 0);
        const amount = Number(r.is_billable !== false ? (r.final_amount || 0) : 0);
        return `<tr>
          <td style="text-align:center">${i + 1}</td>
          <td style="text-align:center">${_pmEsc(r.work_date || '')}</td>
          <td style="text-align:center">${_pmEsc(parts.timeRange || '-')}</td>
          <td style="text-align:center">${_pmEsc(_pmHoursText(minutes))}</td>
          <td style="text-align:center">${_pmEsc(parts.site || '-')}</td>
          <td title="${_pmEsc(parts.content || '-')}" style="text-align:center;white-space:normal;word-break:keep-all;line-height:1.4">${_pmEsc(parts.content || '-')}</td>
          <td style="text-align:right">${_pmKrw(amount)}</td>
        </tr>`;
      }).join('');
      return `<div class="tc-detail-section" style="${idx === 0 ? 'margin-top:12px' : 'margin-top:18px'}">
        <div style="font-size:13px;font-weight:700;color:#0f172a;margin:0 0 6px">${idx + 1}. ${_pmEsc(person.Consultant)} (${_pmEsc(person.Position)})</div>
        <table class="data-table pm-tc-invoice-detail-table" style="table-layout:fixed;width:100%;margin-top:6px">
          <colgroup>
            <col style="width:44px" />
            <col style="width:96px" />
            <col style="width:96px" />
            <col style="width:84px" />
            <col style="width:84px" />
            <col />
            <col style="width:112px" />
          </colgroup>
          <thead>
            <tr>
              <th style="width:42px;text-align:center">No</th>
              <th style="width:120px;text-align:center">용역일자</th>
              <th style="width:120px;text-align:center">수행시간</th>
              <th style="width:90px;text-align:center">투입시간</th>
              <th style="width:120px;text-align:center">수행장소</th>
              <th style="text-align:center">수행업무</th>
              <th style="width:120px;text-align:center">용역금액</th>
            </tr>
          </thead>
          <tbody>
            ${detailHtml}
            <tr class="pm-tc-subtotal-row">
              <td colspan="3" style="text-align:center;font-weight:700">개인별 소계</td>
              <td style="text-align:center;font-weight:700">${_pmEsc(Number(person.Time || 0).toFixed(1))}h</td>
              <td colspan="2" style="text-align:center;font-weight:700">적용단가 ${_pmKrw(Number(person['Time Rate'] || 0))}</td>
              <td style="text-align:right;font-weight:700">${_pmKrw(Number(person['Time Charge'] || 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
    }).join('');
  return `<div class="pm-tax-preview-paper">
    <div class="pm-tax-preview-head">
      <h4 style="margin:0">컨설팅 용역 보수액 산정 요약(Summary)</h4>
      <div style="font-size:12px;color:#64748b;margin-top:4px">${_pmEsc(projectCode)} · ${_pmEsc(project.client_name || '-')}</div>
    </div>
    <table class="data-table pm-tc-invoice-total-table" style="margin-top:8px;table-layout:fixed;width:100%">
      <colgroup>
        <col />
        <col style="width:180px" />
      </colgroup>
      <tbody>
        <tr>
          <th style="text-align:center">용역 보수액</th>
          <td style="text-align:right">${_pmKrw(subtotal)}</td>
        </tr>
        <tr>
          <th style="text-align:center">청구 한도액</th>
          <td style="text-align:right">${_pmKrw(cap)}</td>
        </tr>
        <tr class="pm-tc-invoice-total-claim-row">
          <th style="text-align:center">최종 청구 보수액</th>
          <td style="text-align:right">${_pmKrw(claim)}</td>
        </tr>
      </tbody>
    </table>
    <div style="margin-top:12px;font-size:12px;color:#334155"><b>투입인력 전체 요약</b></div>
    <table class="data-table pm-tc-invoice-summary-table" style="margin-top:6px;table-layout:fixed;width:100%">
      <colgroup>
        <col style="width:44px" />
        <col style="width:150px" />
        <col style="width:100px" />
        <col style="width:140px" />
        <col style="width:84px" />
        <col />
      </colgroup>
      <thead><tr><th style="width:42px;text-align:center">No</th><th style="text-align:center">Consultant</th><th style="text-align:center">Position</th><th style="text-align:center">Time Rate</th><th style="text-align:center">Time</th><th style="text-align:center">Time Charge</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="margin-top:12px;font-size:12px;color:#334155"><b>개인별 상세내역</b></div>
    ${detailSections}
  </div>`;
}

function _pmRenderTimeChargeTaxPreviewHtml() {
  const batch = PM_STATE.currentBatch || {};
  const projectCode = String(batch.project_code || document.getElementById('pm-tc-project')?.value || '').trim();
  if (!projectCode) return '<div class="pm-inv-doc-preview-empty">프로젝트코드를 먼저 선택하세요.</div>';
  const subtotal = Number(batch.subtotal_amount || 0);
  const tax = Number(batch.tax_amount || Math.round(subtotal * 0.1));
  const total = Number(batch.total_amount || subtotal + tax);
  const project = PM_STATE.projectByCode[projectCode] || {};
  return `<div class="pm-tax-preview-paper">
    <div class="pm-tax-preview-head">
      <h4 style="margin:0">세금계산서 미리보기(타임차지)</h4>
      <div style="font-size:12px;color:#64748b;margin-top:4px">${_pmEsc(projectCode)} · ${_pmEsc(project.client_name || '-')}</div>
    </div>
    <table class="data-table" style="margin-top:8px">
      <tbody>
        <tr><th style="width:180px">공급가액</th><td style="text-align:right">${_pmKrw(subtotal)}</td></tr>
        <tr><th>부가세</th><td style="text-align:right">${_pmKrw(tax)}</td></tr>
        <tr><th>합계</th><td style="text-align:right">${_pmKrw(total)}</td></tr>
      </tbody>
    </table>
    <div style="margin-top:8px;font-size:12px;color:#64748b">요청 전 미리보기입니다. 세금계산서 요청 버튼으로 최종 발행요청이 등록됩니다.</div>
  </div>`;
}

function pmPreviewTimeChargeDocument() {
  const tab = PM_STATE.timechargeDocTab || 'status';
  if (tab === 'invoice') {
    const wrap = document.getElementById('pm-tc-invoice-preview');
    if (wrap) wrap.innerHTML = _pmRenderTimeChargeInvoicePreviewHtml();
    return;
  }
  if (tab === 'tax') {
    const wrap = document.getElementById('pm-tc-tax-preview');
    if (wrap) wrap.innerHTML = _pmRenderTimeChargeTaxPreviewHtml();
    return;
  }
  Toast.info('타임쉬트 현황표는 현재 화면에서 바로 확인할 수 있습니다.');
}

function _pmBuildTimeChargePrintHtml(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Time Charge Print</title><style>body{font-family:Arial,sans-serif;padding:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:8px;font-size:12px;vertical-align:middle;text-align:center}th{background:#f1f5f9}.pm-tc-subtotal-row td{background:#f8fbff;font-weight:700}.pm-tc-invoice-detail-table td:nth-child(6){text-align:center;white-space:normal;word-break:keep-all;line-height:1.4}.pm-tc-invoice-summary-table td:nth-child(4),.pm-tc-invoice-summary-table td:nth-child(6),.pm-tc-invoice-detail-table td:nth-child(7){text-align:right}.tc-detail-section{break-inside:avoid;page-break-inside:avoid}</style></head><body>${html}</body></html>`;
}

async function _pmEnsureTimeChargeInvoiceGenerated() {
  const lines = PM_STATE.currentLines || [];
  if (!lines.length) {
    Toast.warning('먼저 Time Charge 라인을 불러오세요.');
    return null;
  }
  const batch = PM_STATE.currentBatch || {};
  const projectCode = String(batch.project_code || document.getElementById('pm-tc-project')?.value || '').trim();
  const project = PM_STATE.projectByCode[projectCode] || {};
  const summaryRows = _pmTimechargeSummaryRows(lines);
  const subtotal = summaryRows.reduce((sum, r) => sum + Number(r['Time Charge'] || 0), 0);
  const cap = _pmTimechargeContractCap(projectCode);
  const claim = cap > 0 ? Math.min(subtotal, cap) : subtotal;
  await _pmSaveTimeChargeInvoiceSnapshot({ batch, project, summaryRows, subtotal, cap, claim });
  if (batch?.id) PM_STATE.timechargeInvoiceGeneratedByBatch[batch.id] = Date.now();
  const byEl = document.getElementById('pm-tc-doc-created-by');
  const atEl = document.getElementById('pm-tc-doc-created-at');
  const createdBy = getSession()?.name || '';
  if (byEl) byEl.textContent = String(createdBy || '-');
  if (atEl) atEl.textContent = new Date().toLocaleString('ko-KR');
  _pmSyncTimeChargeActionAvailability();
  return { batch, projectCode };
}

async function pmGenerateAndPrintTimeChargeDocument() {
  const generated = await _pmEnsureTimeChargeInvoiceGenerated();
  if (!generated) return;
  pmTimeChargeSwitchDocTab('invoice');
  pmPrintTimeChargeDocument();
}

async function _pmEnsureJsPdfForTimeCharge() {
  if (window.jspdf && window.html2canvas) return true;
  const loadScript = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
    document.head.appendChild(s);
  });
  try {
    if (!window.html2canvas) await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
    if (!window.jspdf) await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
    return !!(window.jspdf && window.html2canvas);
  } catch (e) {
    console.warn(e);
    return false;
  }
}

async function pmDownloadTimeChargePdf() {
  const generated = await _pmEnsureTimeChargeInvoiceGenerated();
  if (!generated) return;
  const html = _pmRenderTimeChargeInvoicePreviewHtml();
  const wrap = document.getElementById('pm-tc-invoice-preview');
  if (wrap) wrap.innerHTML = html;
  pmTimeChargeSwitchDocTab('invoice');
  const ok = await _pmEnsureJsPdfForTimeCharge();
  if (!ok) {
    Toast.warning('PDF 라이브러리를 불러오지 못해 인쇄 대화상자로 전환합니다.');
    pmPrintTimeChargeDocument();
    return;
  }
  let container = null;
  try {
    const { jsPDF } = window.jspdf;
    container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-100000px';
    container.style.top = '0';
    container.style.width = '1024px';
    container.style.background = '#ffffff';
    container.innerHTML = html;
    document.body.appendChild(container);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const canvas = await window.html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });
    const imgData = canvas.toDataURL('image/jpeg', 0.98);
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const margin = 24;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const usableW = pageW - margin * 2;
    const usableH = pageH - margin * 2;
    const imgW = usableW;
    const imgH = (canvas.height * imgW) / canvas.width;
    let remainingH = imgH;
    let y = margin;
    doc.addImage(imgData, 'JPEG', margin, y, imgW, imgH, undefined, 'FAST');
    remainingH -= usableH;
    while (remainingH > 0) {
      doc.addPage();
      y = margin - (imgH - remainingH);
      doc.addImage(imgData, 'JPEG', margin, y, imgW, imgH, undefined, 'FAST');
      remainingH -= usableH;
    }
    const code = generated.projectCode || 'timecharge';
    const month = String(generated.batch?.billing_month || _pmNowMonth()).replace('-', '');
    doc.save(`타임차지청구서_${code}_${month}.pdf`);
  } catch (e) {
    console.error(e);
    Toast.error('PDF 다운로드 실패: ' + (e.message || ''));
  } finally {
    if (container && container.parentNode) container.parentNode.removeChild(container);
  }
}

function pmPrintTimeChargeDocument() {
  const tab = PM_STATE.timechargeDocTab || 'status';
  let html = '';
  if (tab === 'status') {
    const source = document.getElementById('pm-tc-doc-status-wrap');
    html = String(source?.innerHTML || '').trim();
  } else if (tab === 'invoice') {
    html = _pmRenderTimeChargeInvoicePreviewHtml();
    const wrap = document.getElementById('pm-tc-invoice-preview');
    if (wrap) wrap.innerHTML = html;
  } else {
    html = _pmRenderTimeChargeTaxPreviewHtml();
    const wrap = document.getElementById('pm-tc-tax-preview');
    if (wrap) wrap.innerHTML = html;
  }
  if (!String(html || '').trim()) {
    Toast.warning('출력할 내용이 없습니다.');
    return;
  }
  const printDocHtml = _pmBuildTimeChargePrintHtml(html);
  const frameId = 'pm-print-frame';
  let frame = document.getElementById(frameId);
  if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
  frame = document.createElement('iframe');
  frame.id = frameId;
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.setAttribute('aria-hidden', 'true');
  document.body.appendChild(frame);
  const printWin = frame.contentWindow;
  const printDoc = frame.contentDocument || printWin?.document;
  if (!printWin || !printDoc) {
    Toast.warning('출력 프레임을 생성할 수 없습니다.');
    if (frame.parentNode) frame.parentNode.removeChild(frame);
    return;
  }
  printDoc.open();
  printDoc.write(printDocHtml);
  printDoc.close();
  setTimeout(() => {
    try {
      printWin.focus();
      printWin.print();
    } catch (e) {
      console.error(e);
      Toast.warning('브라우저 출력 실행에 실패했습니다.');
    } finally {
      setTimeout(() => {
        const old = document.getElementById(frameId);
        if (old && old.parentNode) old.parentNode.removeChild(old);
      }, 800);
    }
  }, 80);
}

function pmTimeChargeSwitchViewTab(tab) {
  const key = tab === 'person' ? 'person' : 'overall';
  PM_STATE.timechargeViewTab = key;
  if (key === 'overall') PM_STATE.timechargeDetailConsultantKey = '';
  const overallTable = document.getElementById('pm-tc-table-overall');
  const personTable = document.getElementById('pm-tc-table-person');
  const overallBtn = document.getElementById('pm-tc-tab-overall-btn');
  const personBtn = document.getElementById('pm-tc-tab-person-btn');
  if (overallTable) overallTable.style.display = key === 'overall' ? '' : 'none';
  if (personTable) personTable.style.display = key === 'person' ? '' : 'none';
  if (overallBtn) overallBtn.classList.toggle('is-active', key === 'overall');
  if (personBtn) personBtn.classList.toggle('is-active', key === 'person');
}

function pmTimeChargeOpenConsultantDetail(consultantKey) {
  const key = String(consultantKey || '').trim();
  if (!key) return;
  PM_STATE.timechargeDetailConsultantKey = key;
  pmTimeChargeSwitchViewTab('person');
  loadProjectMgmtTimeCharge();
}

function switchProjectMgmtTab(tab) {
  const next = String(tab || 'progress');
  PM_STATE.currentTab = next;
  // 인보이스 이외 탭으로 이동 시 상세 오버레이를 항상 닫음
  if (next !== 'invoice') pmCloseInvoiceProjectDetail();
  if (next !== 'cost') pmCloseCustomerInvoiceEditor();
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

function _pmRemoveLegacyLaborUploadCardFromCostPanel() {
  const panel = document.getElementById('pm-panel-cost');
  if (!panel) return;
  const legacyInput = panel.querySelector('input[onchange*="pmUploadMonthlyLaborCostExcel"]');
  if (!legacyInput) return;
  const legacyCard = legacyInput.closest('div[style*="border:1px solid var(--border-light)"]')
    || legacyInput.closest('label')?.parentElement?.parentElement
    || null;
  if (legacyCard && legacyCard.parentNode) {
    legacyCard.parentNode.removeChild(legacyCard);
  }
}

async function init_project_management() {
  const session = getSession ? getSession() : null;
  const canWrite = !!(session && (Auth.canApprove1st(session) || Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session)));
  const canIssue = _pmCanIssueInvoice(session);
  const canRequestInvoice = !!session;

  await _pmLoadProjects();
  await _pmLoadUsers();
  const canExpenseUpload = _pmCanExpenseUpload(session);
  _pmEnsureProgressDetailModalPortal();
  _pmEnsureCustomerInvoiceModalPortal();
  _pmFillProjectSelect('pm-tc-project', '프로젝트 선택');
  _pmFillTimeChargeBaseFilters();
  _pmApplyTimeChargeProjectFilter();
  _pmFillProjectSelect('pm-inv-project', '전체 프로젝트');
  _pmFillInvoiceListFilters();
  _pmFillProjectSelect('pm-cost-project', '전체 프로젝트');
  _pmFillExpenseFilterDatalists();

  const monthEls = ['pm-inv-month'];
  monthEls.forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = _pmNowMonth();
  });
  pmInvoiceSwitchListTab(PM_STATE.invoiceListTab || 'planned');
  ['pm-exp-upload-month', 'pm-cost-upload-month', 'analysis-project-profit-labor-month'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = _pmNowMonth();
  });
  _pmRemoveLegacyLaborUploadCardFromCostPanel();

  if (!PM_STATE.initialized) {
    document.getElementById('pm-progress-refresh-btn')?.addEventListener('click', loadProjectMgmtProgress);
    document.getElementById('pm-progress-search-btn')?.addEventListener('click', loadProjectMgmtProgress);
    document.getElementById('pm-progress-download-btn')?.addEventListener('click', pmDownloadProgressList);
    ['pm-progress-filter-dept','pm-progress-filter-hq','pm-progress-filter-csteam','pm-progress-filter-pm','pm-progress-filter-status']
      .forEach((id) => document.getElementById(id)?.addEventListener('change', loadProjectMgmtProgress));
    const progressClient = document.getElementById('pm-progress-filter-client');
    if (progressClient && !progressClient.dataset.boundInput) {
      progressClient.dataset.boundInput = '1';
      progressClient.addEventListener('input', loadProjectMgmtProgress);
    }
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
    document.getElementById('pm-tc-download-template-btn')?.addEventListener('click', pmDownloadTimeChargeTemplate);
    document.getElementById('pm-tc-upload-open-btn')?.addEventListener('click', () => document.getElementById('pm-tc-upload-file')?.click());
    document.getElementById('pm-tc-upload-file')?.addEventListener('change', (e) => pmUploadTimeChargeExcel(e?.target || null));
    document.getElementById('pm-tc-upload-save-btn')?.addEventListener('click', pmCommitPendingTimeChargeUpload);
    document.getElementById('pm-tc-upload-cancel-btn')?.addEventListener('click', pmCancelPendingTimeChargeUpload);
    document.getElementById('pm-tc-generate-print-btn')?.addEventListener('click', pmGenerateAndPrintTimeChargeDocument);
    document.getElementById('pm-tc-invoice-pdf-btn')?.addEventListener('click', pmDownloadTimeChargePdf);
    document.getElementById('pm-tc-request-btn')?.addEventListener('click', requestTimeChargeInvoice);
    document.getElementById('pm-tc-invoice-close-btn')?.addEventListener('click', () => {
      pmTimeChargeSwitchDocTab('status');
      pmTimeChargeSwitchViewTab('overall');
      const wrap = document.getElementById('pm-tc-doc-status-wrap');
      if (wrap) {
        try { wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
      }
    });
    document.getElementById('pm-tc-project')?.addEventListener('change', () => {
      _pmSyncTimeChargeActionAvailability();
      loadProjectMgmtTimeCharge();
    });
    document.getElementById('pm-tc-client-search')?.addEventListener('input', () => {
      // 입력 중에는 고객사 "지정" 전 단계이므로 드롭다운 자동변경을 하지 않는다.
      _pmSyncTimeChargeActionAvailability();
    });
    document.getElementById('pm-tc-client-search')?.addEventListener('change', () => {
      _pmNormalizeTimeChargeClientInput();
      _pmFillTimeChargeBaseFilters();
      _pmApplyTimeChargeProjectFilter();
      _pmSyncTimeChargeActionAvailability();
      loadProjectMgmtTimeCharge();
    });
    document.getElementById('pm-tc-main-code')?.addEventListener('change', () => {
      _pmApplyTimeChargeProjectFilter();
      _pmSyncTimeChargeActionAvailability();
      loadProjectMgmtTimeCharge();
    });
    document.getElementById('pm-tc-data-source')?.addEventListener('change', () => {
      _pmSyncTimeChargeSourceGuide();
      _pmSyncTimeChargeActionAvailability();
    });
    document.getElementById('pm-inv-load-btn')?.addEventListener('click', loadProjectMgmtInvoices);
    document.getElementById('pm-inv-month')?.addEventListener('change', () => { pmCloseInvoiceProjectDetail(); loadProjectMgmtInvoices(); });
    document.getElementById('pm-inv-create-btn')?.addEventListener('click', createInvoiceRequestFromBatch);
    document.getElementById('pm-inv-generate-mail-btn')?.addEventListener('click', pmGenerateInvoiceMailPreview);
    document.getElementById('pm-inv-quality-btn')?.addEventListener('click', pmRunInvoiceDataQualityCheck);
    document.getElementById('pm-inv-filter-client')?.addEventListener('input', () => { pmCloseInvoiceProjectDetail(); loadProjectMgmtInvoices(); });
    document.getElementById('pm-inv-filter-pm')?.addEventListener('input', () => { pmCloseInvoiceProjectDetail(); loadProjectMgmtInvoices(); });
    document.getElementById('pm-inv-filter-dept')?.addEventListener('change', () => { pmCloseInvoiceProjectDetail(); loadProjectMgmtInvoices(); });
    document.getElementById('pm-inv-filter-hq')?.addEventListener('change', () => { pmCloseInvoiceProjectDetail(); loadProjectMgmtInvoices(); });
    document.getElementById('pm-inv-planned-issue-date')?.addEventListener('change', () => {
      const code = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
      const due = String(document.getElementById('pm-inv-planned-issue-date')?.value || '').trim();
      if (!code) return;
      if (!due) {
        _pmSyncInvoicePlannedIssueGuide(code);
        _pmResetInvoicePreviewConfirmation(code);
        return;
      }
      const project = PM_STATE.projectByCode[code] || {};
      const bounds = _pmInvoiceAmountBounds(project, code, due);
      _pmSetInvoicePlanSelection(code, due, bounds);
      _pmRefreshInvoicePlanSelectionUi(code);
      _pmSyncInvoicePlannedIssueGuide(code);
      _pmResetInvoicePreviewConfirmation(code);
    });
    document.getElementById('pm-inv-invoice-amount')?.addEventListener('input', (e) => {
      if (e && e.target) {
        e.target.value = _pmFormatAmountInput(e.target.value);
        const code = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
        _pmRefreshInvoicePlanSelectionUi(code);
        _pmResetInvoicePreviewConfirmation(code);
      }
    });
    document.getElementById('pm-inv-invoice-amount')?.addEventListener('change', (e) => {
      if (e && e.target) {
        e.target.value = _pmFormatAmountInput(e.target.value);
        const code = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
        _pmRefreshInvoicePlanSelectionUi(code);
        _pmResetInvoicePreviewConfirmation(code);
      }
    });
    document.getElementById('pm-inv-request-mode')?.addEventListener('change', () => {
      const code = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
      const project = PM_STATE.projectByCode[code] || {};
      const mode = _pmInvoiceRequestMode();
      const serviceItemEl = document.getElementById('pm-inv-service-item-name');
      const costItemEl = document.getElementById('pm-inv-cost-item-name');
      if (serviceItemEl && !String(serviceItemEl.dataset.defaultItemName || '').trim()) {
        serviceItemEl.dataset.defaultItemName = String(project.project_name || '용역대금').trim();
      }
      if (costItemEl) {
        costItemEl.dataset.defaultItemName = '프로젝트비용';
        if (mode === 'cost_only' && !String(costItemEl.value || '').trim()) costItemEl.value = '프로젝트비용';
      }
      _pmApplyInvoiceRequestFormAvailability(code, project, _pmProjectInvoiceRows(code));
      _pmRenderBillableCostRows(code);
      _pmRefreshInvoicePlanSelectionUi(code);
      _pmResetInvoicePreviewConfirmation(code);
    });
    document.getElementById('pm-inv-include-billable-costs')?.addEventListener('change', () => {
      const code = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
      _pmRenderBillableCostRows(code);
      _pmRefreshInvoicePlanSelectionUi(code);
      _pmResetInvoicePreviewConfirmation(code);
    });
    document.getElementById('pm-inv-billable-toggle-btn')?.addEventListener('click', () => {
      pmToggleInvoiceBillableCostRows();
    });
    ['pm-inv-recipient-email', 'pm-inv-recipient-name', 'pm-inv-buyer-company', 'pm-inv-buyer-bizno', 'pm-inv-service-item-name', 'pm-inv-cost-item-name', 'pm-inv-service-item-change-reason-select', 'pm-inv-service-item-change-reason-text', 'pm-inv-cost-item-change-reason-select', 'pm-inv-cost-item-change-reason-text']
      .forEach((id) => {
        const el = document.getElementById(id);
        if (!el || el.dataset.invoicePreviewDirtyBound === '1') return;
        el.dataset.invoicePreviewDirtyBound = '1';
        el.addEventListener('input', () => {
          const code = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
          if (id === 'pm-inv-service-item-name'
            || id === 'pm-inv-cost-item-name'
            || id === 'pm-inv-service-item-change-reason-select'
            || id === 'pm-inv-cost-item-change-reason-select') _pmSyncInvoiceItemChangeReason(code);
          _pmResetInvoicePreviewConfirmation(code);
        });
      });
    ['pm-inv-service-item-change-reason-select', 'pm-inv-cost-item-change-reason-select'].forEach((id) => document.getElementById(id)?.addEventListener('change', () => {
      const code = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
      _pmSyncInvoiceItemChangeReason(code);
      _pmResetInvoicePreviewConfirmation(code);
    }));
    document.getElementById('pm-inv-biz-cert-file')?.addEventListener('change', (e) => {
      const file = e?.target?.files?.[0] || null;
      if (file) {
        _pmRenderInvoiceBizCertMeta({ name: file.name, url: '', uploadedAt: 0, uploadedBy: '' });
      } else {
        const code = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
        _pmRenderInvoiceBizCertMeta(_pmPickInvoiceBizCertFromRows(PM_STATE.invoiceRowsByProject[code]));
      }
    });
    document.getElementById('pm-inv-mark-settled-btn')?.addEventListener('click', pmMarkInvoiceProjectSettled);
    document.getElementById('pm-inv-detail-prev-btn')?.addEventListener('click', pmOpenPrevInvoiceProjectDetail);
    document.getElementById('pm-inv-detail-next-btn')?.addEventListener('click', pmOpenNextInvoiceProjectDetail);
    document.getElementById('pm-inv-detail-close-btn')?.addEventListener('click', pmCloseInvoiceProjectDetail);
    document.getElementById('pm-inv-detail-backdrop')?.addEventListener('click', pmCloseInvoiceProjectDetail);
    document.getElementById('pm-exp-upload-file')?.addEventListener('change', (e) => pmUploadProjectExpenseExcel(e?.target || null));
    document.getElementById('pm-exp-download-template-btn')?.addEventListener('click', pmDownloadProjectExpenseTemplate);
    document.getElementById('pm-exp-upload-save-btn')?.addEventListener('click', pmCommitPendingExpenseUpload);
    document.getElementById('pm-exp-upload-cancel-btn')?.addEventListener('click', pmCancelPendingExpenseUpload);
    document.getElementById('pm-exp-upload-delete-last-btn')?.addEventListener('click', pmDeleteLastExpenseUploadBatch);
    document.getElementById('pm-exp-refresh-btn')?.addEventListener('click', loadProjectMgmtCosts);
    document.getElementById('pm-exp-filter-project')?.addEventListener('input', _pmRenderExpenseSummaryTable);
    document.getElementById('pm-exp-filter-client')?.addEventListener('input', _pmRenderExpenseSummaryTable);
    document.getElementById('pm-exp-filter-status')?.addEventListener('change', _pmRenderExpenseSummaryTable);
    document.getElementById('pm-exp-detail-check-all')?.addEventListener('change', (e) => {
      const checked = !!e?.target?.checked;
      document.querySelectorAll('#pm-exp-detail-body input[data-exp-row-id]:not(:disabled)').forEach((el) => { el.checked = checked; });
      _pmExpenseUpdateDetailSummary();
    });
    document.getElementById('pm-exp-mark-billable-btn')?.addEventListener('click', () => pmUpdateSelectedExpenseBillable(true));
    document.getElementById('pm-exp-mark-excluded-btn')?.addEventListener('click', () => pmUpdateSelectedExpenseBillable(false));
    document.getElementById('pm-exp-request-invoice-btn')?.addEventListener('click', pmOpenSelectedExpenseInvoiceRequest);
    document.getElementById('pm-cinv-close-btn')?.addEventListener('click', pmCloseCustomerInvoiceEditor);
    document.getElementById('pm-cinv-backdrop')?.addEventListener('click', pmCloseCustomerInvoiceEditor);
    document.getElementById('pm-cinv-save-btn')?.addEventListener('click', pmSaveCustomerInvoiceDocument);
    document.getElementById('pm-cinv-print-btn')?.addEventListener('click', pmPrintCustomerInvoiceDocument);
    document.getElementById('pm-cinv-download-xlsx-btn')?.addEventListener('click', pmDownloadCustomerInvoiceXlsx);
    document.getElementById('pm-cinv-note')?.addEventListener('input', () => {
      _pmCustomerInvoiceSyncDraftFromForm();
      _pmRenderCustomerInvoicePreview();
    });
    document.getElementById('pm-cinv-recipient-name')?.addEventListener('input', () => {
      _pmCustomerInvoiceSyncDraftFromForm();
      _pmRenderCustomerInvoicePreview();
    });
    document.getElementById('pm-cinv-recipient-email')?.addEventListener('input', () => {
      _pmCustomerInvoiceSyncDraftFromForm();
      _pmRenderCustomerInvoicePreview();
    });
    document.getElementById('pm-cinv-doc-no')?.addEventListener('input', () => {
      const draft = _pmCustomerInvoiceSyncDraftFromForm();
      if (!draft) return;
      draft.doc_no_auto = false;
    });
    document.getElementById('pm-cinv-doc-date')?.addEventListener('change', () => {
      _pmCustomerInvoiceSyncDraftFromForm();
      _pmRenderCustomerInvoicePreview();
    });
    document.getElementById('pm-cinv-billing-month')?.addEventListener('change', async () => {
      const draft = _pmCustomerInvoiceSyncDraftFromForm();
      if (!draft) return;
      if (!String(draft.doc_no || '').trim()) draft.doc_no_auto = true;
      await pmRefreshCustomerInvoiceAutoDocNo();
      _pmRenderCustomerInvoicePreview();
    });
    document.getElementById('pm-cinv-body')?.addEventListener('input', (e) => {
      const idxRaw = e?.target?.dataset?.cinvNoteIdx;
      if (idxRaw == null) return;
      const idx = Number(idxRaw);
      if (!Number.isInteger(idx)) return;
      const draft = PM_STATE.customerInvoiceDraft;
      if (!draft || !Array.isArray(draft.rows) || !draft.rows[idx]) return;
      draft.rows[idx].note_append = String(e?.target?.value || '');
      _pmRenderCustomerInvoicePreview();
    });
    document.getElementById('pm-contract-refresh-btn')?.addEventListener('click', loadProjectMgmtContracts);
    document.getElementById('pm-detail-save-btn')?.addEventListener('click', pmProgressDetailSaveOps);
    document.getElementById('pm-detail-output-refresh-btn')?.addEventListener('click', pmProgressDetailLoadOutputList);
    document.getElementById('pm-detail-output-upload-btn')?.addEventListener('click', pmProgressDetailUploadOutput);
    document.getElementById('pm-detail-output-type')?.addEventListener('change', _pmProgressDetailToggleOutputTarget);
    document.getElementById('pm-detail-output-target-dept')?.addEventListener('change', _pmProgressDetailBuildTargetOrgOptions);
    _pmRenderPendingExpenseActions();
    _pmRenderTimechargeUploadPendingState();
    _pmSyncTimeChargeSourceGuide();
    _pmSyncTimeChargeActionAvailability();
    pmTimeChargeSwitchViewTab(PM_STATE.timechargeViewTab || 'overall');
    pmTimeChargeSwitchDocTab(PM_STATE.timechargeDocTab || 'status');
    _pmUpdateExpenseRequestButtonState();
    PM_STATE.initialized = true;
  }

  const disableIfNoWrite = ['pm-inv-create-btn'];
  disableIfNoWrite.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canWrite;
  });
  _pmSyncTimeChargeSourceGuide();
  _pmSyncTimeChargeActionAvailability();
  pmTimeChargeSwitchDocTab(PM_STATE.timechargeDocTab || 'status');
  ['pm-exp-upload-file', 'pm-exp-upload-save-btn', 'pm-exp-upload-cancel-btn', 'pm-exp-upload-delete-last-btn'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canExpenseUpload;
  });
  const requestBtn = document.getElementById('pm-tc-request-btn');
  if (requestBtn) requestBtn.disabled = !canIssue;
  _pmSyncInvoiceCreateButtonState();
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
  if (mode === 'manage') {
    const pendingTab = String(window.__PM_PENDING_TAB__ || '').trim();
    const nextTab = ['progress', 'invoice', 'cost', 'timecharge', 'contract'].includes(pendingTab)
      ? pendingTab
      : (PM_STATE.currentTab || 'progress');
    switchProjectMgmtTab(nextTab);
    window.__PM_PENDING_TAB__ = '';
    setTimeout(() => { _pmApplyOutputAlertContext(); }, 0);
  }
}

async function loadProjectMgmtProgress() {
  const body = document.getElementById('pm-progress-body');
  if (!body) return;
  PM_STATE.progressExportRows = [];
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
    const [projects, invoices, outputs] = await Promise.all([
      API.listAllPages('registered_projects', { limit: 500, maxPages: 20, sort: 'updated_at' }),
      API.listAllPages('project_invoices', { limit: 1000, maxPages: 30, sort: 'updated_at' }).catch(() => []),
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
      const org = _pmResolveProjectOrg(r, userMap);
      return {
        ...r,
        _dept_name: String(org.dept || '').trim(),
        _hq_name: String(org.hq || '').trim(),
        _cs_team_name: String(org.cs || '').trim(),
      };
    });
    _pmBuildProgressFilters(rows);
    const today = new Date().toISOString().slice(0, 10);
    const lifecycle = (r) => {
      const code = String(r.project_code || '').trim();
      const inv = invByCode[code] || { outstanding: 0, hasInvoice: false };
      const hasContractProof = _pmProjectHasContractOrEvidence(r);
      const contractAtAuto = hasContractProof
        ? Number(r.contract_uploaded_at || r.contract_evidence_uploaded_at || r.final_approved_at || r.created_at || 0)
        : 0;
      const pmOutputs = (outputRowsByCode[code] || []).filter((o) => String(o.uploaded_by || '') === String(r.cpm_user_id || ''));
      const closedAtAuto = pmOutputs.reduce((mx, o) => Math.max(mx, Number(o.uploaded_at || o.created_at || o.updated_at || 0)), 0);
      const settledAtAuto = (inv.hasInvoice && Number(inv.outstanding || 0) <= 0) ? Number((invoices || [])
        .filter((x) => String(x.project_code || '').trim() === code)
        .reduce((mx, x) => Math.max(mx, Number(x.paid_at || x.updated_at || 0)), 0)) : 0;
      const history = {
        contract: Number(r.contract_completed_at || contractAtAuto || 0),
        execute: Number(r.execution_started_at || 0),
        close: Number(r.work_closed_at || closedAtAuto || 0),
        settle: Number(r.settled_at || settledAtAuto || 0),
      };
      const historyPatch = {};
      if (!Number(r.contract_completed_at || 0) && contractAtAuto > 0) historyPatch.contract_completed_at = contractAtAuto;
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
      if (fClient) {
        const clientName = String(r.client_name || '').toLowerCase();
        if (!clientName.includes(fClient.toLowerCase())) return false;
      }
      if (fPm && _pmResolveCpmName(r, userMap) !== fPm) return false;
      if (fStatus && String(x.life.code || '') !== fStatus) return false;
      return true;
    }).sort((a, b) => {
      const order = {
        contract_completed: 0,
        in_progress: 1,
        work_closed: 2,
        settled_done: 3,
      };
      const ao = Object.prototype.hasOwnProperty.call(order, a.life.code) ? order[a.life.code] : 99;
      const bo = Object.prototype.hasOwnProperty.call(order, b.life.code) ? order[b.life.code] : 99;
      if (ao !== bo) return ao - bo;
      // 동일 상태 그룹 내 최신순
      return Number(b.approvedTs || 0) - Number(a.approvedTs || 0);
    });
    PM_STATE.progressRowById = {};
    withMeta.forEach((x) => {
      PM_STATE.progressRowById[String(x.row.id || '')] = x.row;
    });
    PM_STATE.progressExportRows = withMeta.slice();

    if (!withMeta.length) {
      body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-inbox"></i><p>조건에 맞는 프로젝트가 없습니다.</p></td></tr>';
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
        <td class="pm-progress-col-pm">${_pmEsc(_pmResolveCpmName(r, userMap) || '-')}</td>
        <td style="text-align:center">
          <button type="button" class="btn btn-sm pm-progress-detail-btn" onclick="pmOpenProgressDetail('${_pmEsc(r.id)}')" title="수행상세 열기">
            <i class="fas fa-arrow-up-right-from-square"></i> 열기
          </button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    console.error(e);
    PM_STATE.progressExportRows = [];
    body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>진행현황 조회 실패</p></td></tr>';
  }
}

function _pmProgressStatusLabel(code) {
  const key = String(code || '').trim();
  return (PM_LIFECYCLE[key] && PM_LIFECYCLE[key].label) || key || '-';
}

async function pmDownloadProgressList() {
  const rows = Array.isArray(PM_STATE.progressExportRows) ? PM_STATE.progressExportRows : [];
  if (!rows.length) {
    Toast.warning('다운로드할 진행현황 데이터가 없습니다. 먼저 조회하세요.');
    return;
  }
  const ok = await _pmEnsureXlsx();
  if (!ok || typeof XLSX === 'undefined') {
    Toast.error('XLSX 라이브러리를 로드할 수 없습니다.');
    return;
  }
  const from = String(document.getElementById('pm-progress-date-from')?.value || '').trim();
  const to = String(document.getElementById('pm-progress-date-to')?.value || '').trim();
  const range = `${from || '-'}_${to || '-'}`.replace(/[^\dA-Za-z가-힣_-]/g, '');
  const exportRows = rows.map((x, idx) => {
    const r = x.row || {};
    const life = x.life || {};
    return {
      No: idx + 1,
      등록승인일: String(x.approvedDate || '-'),
      고객사: String(r.client_name || '-'),
      프로젝트코드: String(r.project_code || ''),
      프로젝트명: String(r.project_name || '-'),
      상태: _pmProgressStatusLabel(life.code),
      CPM: String(_pmResolveCpmName(r, PM_STATE.usersById || {}) || '-'),
      사업부: String(r._dept_name || ''),
      본부: String(r._hq_name || ''),
      고객지원팀: String(r._cs_team_name || ''),
      상태기준일: String(x.approvedDate || '-'),
    };
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(exportRows);
  XLSX.utils.book_append_sheet(wb, ws, '프로젝트진행현황');
  await xlsxDownload(wb, `프로젝트진행현황_${range}.xlsx`);
}

function pmProgressDetailSwitchTab(tab) {
  PM_STATE.progressDetailTab = tab === 'output' ? 'output' : 'ops';
  const ops = document.getElementById('pm-detail-panel-ops');
  const out = document.getElementById('pm-detail-panel-output');
  if (ops) ops.style.display = PM_STATE.progressDetailTab === 'ops' ? '' : 'none';
  if (out) out.style.display = PM_STATE.progressDetailTab === 'output' ? '' : 'none';
  document.querySelectorAll('[data-pm-detail-tab]').forEach((btn) => {
    const on = btn.getAttribute('data-pm-detail-tab') === PM_STATE.progressDetailTab;
    btn.classList.toggle('is-active', on);
  });
  if (PM_STATE.progressDetailTab === 'output') {
    _pmProgressDetailToggleOutputTarget();
    pmProgressDetailLoadOutputList();
  }
}

function _pmProgressDetailFmtDate(ms) {
  const n = Number(ms || 0);
  if (!n) return '-';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().slice(0, 10);
}

function _pmProgressDetailSafeSegment(v) {
  return String(v || '')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'na';
}

function _pmProgressDetailCurrent() {
  return PM_STATE.progressDetailProject || null;
}

function _pmProgressAssistantTemplateRow() {
  return {
    user_id: '',
    name: '',
    title: '',
    project_role: '',
    allocation_type: 'full',
    allocation_pct: 100,
    note: '',
  };
}

function _pmNormalizeProjectRoleValue(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const direct = PM_ASSISTANT_PROJECT_ROLE_OPTIONS.find((o) => o.value === raw);
  if (direct) return direct.value;
  const loose = PM_ASSISTANT_PROJECT_ROLE_OPTIONS.find((o) =>
    raw === o.labelKo || raw === o.labelBi || raw.startsWith(o.value) || raw.startsWith(o.labelKo)
  );
  return loose ? loose.value : raw;
}

function _pmProjectRoleMeta(roleValue) {
  const normalized = _pmNormalizeProjectRoleValue(roleValue);
  return PM_ASSISTANT_PROJECT_ROLE_OPTIONS.find((o) => o.value === normalized) || null;
}

function _pmApplyProjectRoleSelectLabels(selectEl, openList = false) {
  if (!selectEl) return;
  const selectedVal = _pmNormalizeProjectRoleValue(String(selectEl.value || '').trim());
  Array.from(selectEl.options || []).forEach((opt) => {
    const rawVal = String(opt.value || '').trim();
    if (!rawVal) {
      opt.textContent = '역할 선택';
      return;
    }
    const meta = _pmProjectRoleMeta(rawVal);
    if (!meta) return;
    const isSelected = rawVal === selectedVal;
    opt.textContent = (openList || !isSelected) ? meta.labelBi : meta.labelKo;
  });
}

function _pmAssistantTitleLabel(title) {
  const raw = String(title || '').trim();
  if (!raw) return '';
  if (typeof Utils !== 'undefined' && Utils && typeof Utils.jobTitleLabel === 'function') {
    return Utils.jobTitleLabel(raw);
  }
  return raw;
}

function _pmNormalizeAssistantFromObject(obj) {
  const titleRoles = new Set(['Staff', 'Manager', 'Director', '선임', '전임', '책임', '팀장', '본부장', '사업부장', 'Admin']);
  const userId = String(obj?.user_id || obj?.userId || '').trim();
  const name = String(obj?.name || '').trim();
  const legacyRole = String(obj?.role || '').trim();
  let title = String(obj?.title || obj?.job_title || '').trim();
  let projectRole = _pmNormalizeProjectRoleValue(String(obj?.project_role || obj?.assignment_role || '').trim());
  const noteRaw = String(obj?.note || '').trim();
  const contributionRaw = String(obj?.contribution || obj?.allocation_pct || '').trim();
  let allocationType = String(obj?.allocation_type || obj?.frequency_type || '').trim().toLowerCase();
  let allocationPct = Number(obj?.allocation_pct);
  if (!Number.isFinite(allocationPct)) {
    allocationPct = Number(String(contributionRaw || '').replace(/[^\d.]/g, ''));
  }
  if (!title && legacyRole && titleRoles.has(legacyRole)) title = legacyRole;
  if (!projectRole && legacyRole && !titleRoles.has(legacyRole)) projectRole = legacyRole;
  projectRole = _pmNormalizeProjectRoleValue(projectRole);
  title = _pmAssistantTitleLabel(title);
  if (allocationType !== 'partial' && allocationType !== 'full') {
    allocationType = (Number.isFinite(allocationPct) && allocationPct > 0 && allocationPct < 100) ? 'partial' : 'full';
  }
  if (allocationType === 'full') {
    allocationPct = 100;
  } else {
    const pct = Math.round(Number(allocationPct || 0));
    allocationPct = (pct >= 1 && pct <= 99) ? pct : 50;
  }
  const noteParts = [];
  if (noteRaw) noteParts.push(noteRaw);
  return {
    user_id: userId,
    name,
    title,
    project_role: projectRole,
    allocation_type: allocationType,
    allocation_pct: allocationPct,
    note: noteParts.join(' / ').trim(),
  };
}

function _pmProgressParseAssistants(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return [];
  // 수행상세 전용 포맷(JSON::) 우선 파싱
  if (txt.startsWith('JSON::')) {
    try {
      const parsed = JSON.parse(txt.slice(6));
      if (Array.isArray(parsed)) {
        return parsed
          .map((r) => _pmNormalizeAssistantFromObject(r))
          .filter((r) => r.name || r.title || r.project_role || r.note);
      }
    } catch (_) {}
    return [];
  }
  // 과거 호환: 접두 없는 JSON이라도 수행상세 형식(note 필드 포함)일 때만 제한적으로 파싱
  try {
    const parsed = JSON.parse(txt);
    const isAssistantLike = Array.isArray(parsed) && parsed.every((r) =>
      r && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, 'note')
    );
    if (isAssistantLike) {
      return parsed
        .map((r) => _pmNormalizeAssistantFromObject(r))
        .filter((r) => r.name || r.title || r.project_role || r.note);
    }
  } catch (_) {}
  // 수주참여자/기타 텍스트는 수행상세 투입인력으로 자동 변환하지 않음
  return [];
}

function _pmProgressSerializeAssistants(rows) {
  const clean = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      user_id: String(r?.user_id || '').trim(),
      name: String(r?.name || '').trim(),
      title: String(r?.title || '').trim(),
      project_role: _pmNormalizeProjectRoleValue(String(r?.project_role || '').trim()),
      allocation_type: String(r?.allocation_type || 'full').trim().toLowerCase() === 'partial' ? 'partial' : 'full',
      allocation_pct: String(r?.allocation_type || 'full').trim().toLowerCase() === 'partial'
        ? Math.min(99, Math.max(1, Math.round(Number(r?.allocation_pct || 0) || 0)))
        : 100,
      note: String(r?.note || '').trim(),
    }))
    .filter((r) => r.name || r.project_role || r.note);
  if (!clean.length) return '';
  return `JSON::${JSON.stringify(clean)}`;
}

function _pmProgressDetailActiveAssistantUsers() {
  return (Array.isArray(PM_STATE.users) ? PM_STATE.users : [])
    .filter((u) => u && u.deleted !== true && u.is_active !== false && String(u.name || '').trim())
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
}

function _pmProgressAssistantNameKey(v) {
  return String(v || '').toLowerCase().replace(/\s+/g, '').trim();
}

function _pmProgressDetailAssistantTitleForUser(user) {
  const jobTitle = String(user?.job_title || '').trim();
  if (jobTitle) return _pmAssistantTitleLabel(jobTitle);
  const fallback = _pmRoleLabel(user?.role || '');
  return fallback === '-' ? '' : fallback;
}

function _pmProgressDetailResolveAssistantUserByName(name) {
  const key = _pmProgressAssistantNameKey(name);
  if (!key) return null;
  const matched = _pmProgressDetailActiveAssistantUsers().filter((u) => _pmProgressAssistantNameKey(u.name) === key);
  return matched.length === 1 ? matched[0] : null;
}

function _pmProgressDetailRenderAssistantUserList() {
  const listEl = document.getElementById('pm-detail-assistant-user-list');
  if (!listEl) return;
  const options = _pmProgressDetailActiveAssistantUsers().map((u) => {
    const name = String(u.name || '').trim();
    const title = _pmProgressDetailAssistantTitleForUser(u);
    const dept = String(u.dept_name || '').trim();
    const labelParts = [title, dept].filter(Boolean);
    const label = labelParts.length ? `${name} (${labelParts.join(' / ')})` : name;
    return `<option value="${_pmEsc(name)}" label="${_pmEsc(label)}"></option>`;
  });
  listEl.innerHTML = options.join('');
}

function _pmProgressDetailApplyAssistantUserToRow(tr) {
  const nameEl = tr?.querySelector('[data-asst-field="name"]');
  const titleEl = tr?.querySelector('[data-asst-field="title"]');
  if (!nameEl || !titleEl) return;
  const typedName = String(nameEl.value || '').trim();
  const typedKey = _pmProgressAssistantNameKey(typedName);
  const existingUserId = String(nameEl.dataset.asstUserId || '').trim();
  let resolved = null;
  if (existingUserId && PM_STATE.usersById[existingUserId]) {
    const byId = PM_STATE.usersById[existingUserId];
    if (_pmProgressAssistantNameKey(byId.name) === typedKey) resolved = byId;
  }
  if (!resolved) resolved = _pmProgressDetailResolveAssistantUserByName(typedName);
  if (resolved) {
    const canonicalName = String(resolved.name || '').trim();
    nameEl.value = canonicalName;
    nameEl.dataset.asstUserId = String(resolved.id || '');
    titleEl.value = _pmProgressDetailAssistantTitleForUser(resolved);
    return;
  }
  nameEl.dataset.asstUserId = '';
  titleEl.value = '';
}

function _pmProgressDetailApplyAllocationUiToRow(tr) {
  const typeEl = tr?.querySelector('[data-asst-field="allocation_type"]');
  const pctEl = tr?.querySelector('[data-asst-field="allocation_pct"]');
  if (!typeEl || !pctEl) return;
  const type = String(typeEl.value || 'full').trim().toLowerCase() === 'partial' ? 'partial' : 'full';
  if (type === 'full') {
    pctEl.value = '100';
    pctEl.readOnly = true;
    return;
  }
  pctEl.readOnly = false;
  const pct = Math.round(Number(pctEl.value || 0) || 0);
  pctEl.value = String((pct >= 1 && pct <= 99) ? pct : 50);
}

function _pmProgressDetailBindAssistantRowEvents() {
  const tbody = document.getElementById('pm-detail-assistant-body');
  if (!tbody) return;
  Array.from(tbody.querySelectorAll('tr')).forEach((tr) => {
    const nameEl = tr.querySelector('[data-asst-field="name"]');
    if (!nameEl || nameEl.dataset.asstBound === '1') return;
    const apply = () => _pmProgressDetailApplyAssistantUserToRow(tr);
    nameEl.addEventListener('change', apply);
    nameEl.addEventListener('blur', apply);
    nameEl.dataset.asstBound = '1';
    apply();
  });
  Array.from(tbody.querySelectorAll('tr')).forEach((tr) => {
    const typeEl = tr.querySelector('[data-asst-field="allocation_type"]');
    const pctEl = tr.querySelector('[data-asst-field="allocation_pct"]');
    if (!typeEl || typeEl.dataset.asstBound === '1') return;
    const apply = () => _pmProgressDetailApplyAllocationUiToRow(tr);
    typeEl.addEventListener('change', apply);
    if (pctEl) {
      pctEl.addEventListener('blur', apply);
      pctEl.addEventListener('change', apply);
    }
    typeEl.dataset.asstBound = '1';
    apply();
  });
  Array.from(tbody.querySelectorAll('tr')).forEach((tr) => {
    const roleEl = tr.querySelector('[data-asst-field="project_role"]');
    if (!roleEl || roleEl.dataset.asstBound === '1') return;
    _pmApplyProjectRoleSelectLabels(roleEl, false);
    roleEl.addEventListener('focus', () => _pmApplyProjectRoleSelectLabels(roleEl, true));
    roleEl.addEventListener('mousedown', () => _pmApplyProjectRoleSelectLabels(roleEl, true));
    roleEl.addEventListener('change', () => _pmApplyProjectRoleSelectLabels(roleEl, false));
    roleEl.addEventListener('blur', () => _pmApplyProjectRoleSelectLabels(roleEl, false));
    roleEl.dataset.asstBound = '1';
  });
}

function _pmProgressDetailRenderAssistantRows() {
  const tbody = document.getElementById('pm-detail-assistant-body');
  if (!tbody) return;
  const rows = PM_STATE.progressAssistantRows || [];
  _pmProgressDetailRenderAssistantUserList();
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-users"></i><p>등록된 투입인력이 없습니다.</p></td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r, idx) => `
    <tr>
      <td style="text-align:center">${idx + 1}</td>
      <td><input type="text" class="form-control" data-asst-field="name" data-asst-idx="${idx}" data-asst-user-id="${_pmEsc(r.user_id || '')}" value="${_pmEsc(r.name || '')}" list="pm-detail-assistant-user-list" autocomplete="off" /></td>
      <td><input type="text" class="form-control" data-asst-field="title" data-asst-idx="${idx}" value="${_pmEsc(r.title || '')}" readonly /></td>
      <td>
        <select class="form-control" data-asst-field="project_role" data-asst-idx="${idx}" title="${_pmEsc(_pmNormalizeProjectRoleValue(r.project_role || ''))}">
          <option value="">역할 선택</option>
          ${PM_ASSISTANT_PROJECT_ROLE_OPTIONS.map((opt) => {
            const selected = _pmNormalizeProjectRoleValue(r.project_role || '') === opt.value;
            const text = selected ? opt.labelKo : opt.labelBi;
            return `<option value="${_pmEsc(opt.value)}" ${selected ? 'selected' : ''}>${_pmEsc(text)}</option>`;
          }).join('')}
        </select>
      </td>
      <td>
        <div style="display:flex;gap:8px;align-items:center">
          <select class="form-control" data-asst-field="allocation_type" data-asst-idx="${idx}" style="width:100px;min-width:100px">
            <option value="full" ${String(r.allocation_type || 'full') !== 'partial' ? 'selected' : ''}>전체참여</option>
            <option value="partial" ${String(r.allocation_type || '') === 'partial' ? 'selected' : ''}>부분참여</option>
          </select>
          <input type="number" class="form-control pm-allocation-pct" data-asst-field="allocation_pct" data-asst-idx="${idx}" min="1" max="100" step="1" value="${_pmEsc(String(r.allocation_pct || (String(r.allocation_type || '') === 'partial' ? '50' : '100')))}" />
          <span style="font-size:12px;color:#64748b">%</span>
        </div>
      </td>
      <td><input type="text" class="form-control" data-asst-field="note" data-asst-idx="${idx}" value="${_pmEsc(r.note || '')}" /></td>
      <td style="text-align:center">
        <button type="button" class="btn btn-sm btn-outline" onclick="pmProgressDetailRemoveAssistantRow(${idx})"><i class="fas fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
  _pmProgressDetailBindAssistantRowEvents();
}

function _pmProgressDetailSyncAssistantRowsFromDom() {
  const tbody = document.getElementById('pm-detail-assistant-body');
  if (!tbody) return;
  const next = [];
  const rowEls = Array.from(tbody.querySelectorAll('tr')).filter((tr) => tr.querySelector('[data-asst-field]'));
  rowEls.forEach((tr) => {
    _pmProgressDetailApplyAssistantUserToRow(tr);
    _pmProgressDetailApplyAllocationUiToRow(tr);
    const nameEl = tr.querySelector('[data-asst-field="name"]');
    const name = String(tr.querySelector('[data-asst-field="name"]')?.value || '').trim();
    const title = String(tr.querySelector('[data-asst-field="title"]')?.value || '').trim();
    const projectRole = _pmNormalizeProjectRoleValue(String(tr.querySelector('[data-asst-field="project_role"]')?.value || '').trim());
    const allocationType = String(tr.querySelector('[data-asst-field="allocation_type"]')?.value || '').trim().toLowerCase() === 'partial' ? 'partial' : 'full';
    const allocationPctRaw = Math.round(Number(tr.querySelector('[data-asst-field="allocation_pct"]')?.value || 0) || 0);
    const allocationPct = allocationType === 'partial'
      ? Math.min(99, Math.max(1, allocationPctRaw || 50))
      : 100;
    const note = String(tr.querySelector('[data-asst-field="note"]')?.value || '').trim();
    const userId = String(nameEl?.dataset?.asstUserId || '').trim();
    next.push({
      user_id: userId,
      name,
      title,
      project_role: projectRole,
      allocation_type: allocationType,
      allocation_pct: allocationPct,
      note,
    });
  });
  PM_STATE.progressAssistantRows = next;
}

function _pmProgressValidateAssistantRows(rows) {
  const meaningful = (Array.isArray(rows) ? rows : []).filter((r) => r.name || r.project_role || r.note);
  for (let i = 0; i < meaningful.length; i += 1) {
    const rowNo = i + 1;
    const r = meaningful[i] || {};
    const name = String(r.name || '').trim();
    const projectRole = String(r.project_role || '').trim();
    const note = String(r.note || '').trim();
    const allocType = String(r.allocation_type || 'full').trim().toLowerCase() === 'partial' ? 'partial' : 'full';
    const pct = Math.round(Number(r.allocation_pct || 0) || 0);
    if (!name) return `투입인력 ${rowNo}행: 이름을 선택해 주세요.`;
    if (!projectRole) return `투입인력 ${rowNo}행: 역할을 선택해 주세요.`;
    if (projectRole === '기타' && !note) return `투입인력 ${rowNo}행: 역할이 '기타'일 때 비고는 필수입니다.`;
    if (allocType === 'partial' && !(pct >= 1 && pct <= 99)) {
      return `투입인력 ${rowNo}행: 부분참여 선택 시 투입률은 1~99%로 입력해 주세요.`;
    }
  }
  return '';
}

function pmProgressDetailAddAssistantRow() {
  _pmProgressDetailSyncAssistantRowsFromDom();
  PM_STATE.progressAssistantRows.push(_pmProgressAssistantTemplateRow());
  _pmProgressDetailRenderAssistantRows();
}

function pmProgressDetailRemoveAssistantRow(idx) {
  _pmProgressDetailSyncAssistantRowsFromDom();
  const i = Number(idx);
  if (!Number.isFinite(i) || i < 0 || i >= PM_STATE.progressAssistantRows.length) return;
  PM_STATE.progressAssistantRows.splice(i, 1);
  _pmProgressDetailRenderAssistantRows();
}

function _pmProgressDetailSetSummary(row) {
  const summaryEl = document.getElementById('pm-detail-project-summary');
  const codeEl = document.getElementById('pm-detail-output-code');
  const clientEl = document.getElementById('pm-detail-output-client');
  if (!row) {
    if (summaryEl) summaryEl.textContent = '프로젝트를 불러오지 못했습니다.';
    if (codeEl) codeEl.value = '';
    if (clientEl) clientEl.value = '';
    return;
  }
  if (summaryEl) {
    summaryEl.innerHTML = `<i class="fas fa-info-circle"></i> <strong>${_pmEsc(row.project_code || '')}</strong> · ${_pmEsc(row.project_name || '')} / 고객사 ${_pmEsc(row.client_name || '-')}`;
  }
  if (codeEl) codeEl.value = String(row.project_code || '');
  if (clientEl) clientEl.value = String(row.client_name || '');
}

function _pmProgressDetailBuildTargetOrgOptions() {
  const deptEl = document.getElementById('pm-detail-output-target-dept');
  const hqEl = document.getElementById('pm-detail-output-target-hq');
  if (!deptEl || !hqEl) return;
  const users = Array.isArray(PM_STATE.users) ? PM_STATE.users : [];
  const uniq = (arr) => [...new Set(arr.filter(Boolean).map((v) => String(v).trim()))].sort((a, b) => a.localeCompare(b, 'ko'));
  const prevDept = String(deptEl.value || '');
  const prevHq = String(hqEl.value || '');
  const depts = uniq(users.map((u) => u.dept_name));
  deptEl.innerHTML = '<option value="">선택</option>' + depts.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
  if (prevDept && [...deptEl.options].some((o) => o.value === prevDept)) deptEl.value = prevDept;
  const filteredUsers = prevDept ? users.filter((u) => String(u.dept_name || '').trim() === prevDept) : users;
  const hqs = uniq(filteredUsers.map((u) => u.hq_name));
  hqEl.innerHTML = '<option value="">선택</option>' + hqs.map((v) => `<option value="${_pmEsc(v)}">${_pmEsc(v)}</option>`).join('');
  if (prevHq && [...hqEl.options].some((o) => o.value === prevHq)) hqEl.value = prevHq;
}

function _pmProgressDetailToggleOutputTarget() {
  const typeVal = String(document.getElementById('pm-detail-output-type')?.value || '').trim();
  const wrap = document.getElementById('pm-detail-output-target-wrap');
  const show = typeVal === '통관팀유의사항';
  if (wrap) wrap.style.display = show ? '' : 'none';
}

function _pmProgressDetailExtractTargetFromNote(note) {
  const txt = String(note || '');
  const m = txt.match(/\[대상조직\]\s*사업부:(.*?)\s*\/\s*본부:(.*?)(?:\n|$)/);
  if (!m) return { dept: '', hq: '', noteOnly: txt.trim() };
  const dept = String(m[1] || '').trim();
  const hq = String(m[2] || '').trim();
  const noteOnly = txt.replace(m[0], '').trim();
  return { dept, hq, noteOnly };
}

function _pmProgressDetailComposeNote(note, dept, hq) {
  const base = String(note || '').replace(/\[대상조직\]\s*사업부:.*?(?:\n|$)/g, '').trim();
  if (!dept && !hq) return base;
  const targetLine = `[대상조직] 사업부:${String(dept || '-').trim()} / 본부:${String(hq || '-').trim()}`;
  return base ? `${base}\n${targetLine}` : targetLine;
}

function _pmProgressDetailFillOpsForm(row) {
  const cpmSel = document.getElementById('pm-detail-cpm');
  if (cpmSel) {
    const cur = String((row && row.cpm_user_id) || '').trim();
    cpmSel.innerHTML = '<option value="">선택 안 함</option>';
    (PM_STATE.users || [])
      .filter((u) => u.deleted !== true && u.is_active !== false && _pmIsCpmEligible(u))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .forEach((u) => {
        const opt = document.createElement('option');
        opt.value = String(u.id || '');
        opt.textContent = `${u.name || ''} (${_pmRoleLabel(u.role)})`;
        opt.dataset.name = u.name || '';
        cpmSel.appendChild(opt);
      });
    if (cur && [...cpmSel.options].some((o) => o.value === cur)) cpmSel.value = cur;
  }
  PM_STATE.progressAssistantRows = _pmProgressParseAssistants(String((row && row.order_contributors_text) || ''));
  if (!PM_STATE.progressAssistantRows.length) {
    PM_STATE.progressAssistantRows = [_pmProgressAssistantTemplateRow()];
  }
  _pmProgressDetailRenderAssistantRows();
  const startEl = document.getElementById('pm-detail-start-date');
  if (startEl) {
    const ts = Number((row && row.execution_started_at) || 0);
    startEl.value = ts ? new Date(ts).toISOString().slice(0, 10) : '';
  }
}

async function pmOpenProgressDetail(projectId) {
  _pmEnsureProgressDetailModalPortal();
  const id = String(projectId || '').trim();
  if (!id) {
    Toast.warning('프로젝트 식별자를 찾을 수 없습니다.');
    return;
  }
  let row = PM_STATE.progressRowById[id] || null;
  if (!row) {
    row = await API.get('registered_projects', id).catch(() => null);
  }
  if (!row) {
    Toast.warning('프로젝트 정보를 찾지 못했습니다.');
    return;
  }
  PM_STATE.progressDetailProject = row;
  _pmProgressDetailSetSummary(row);
  _pmProgressDetailFillOpsForm(row);
  _pmProgressDetailBuildTargetOrgOptions();
  _pmProgressDetailToggleOutputTarget();
  pmProgressDetailSwitchTab('ops');
  openModal('pmProgressDetailModal');
}

async function pmOpenProgressDetailByCode(projectCode) {
  const code = String(projectCode || '').trim();
  if (!code) return;
  const row = PM_STATE.projectByCode[code] || null;
  if (!row || !row.id) return;
  await pmOpenProgressDetail(String(row.id));
}

async function pmProgressDetailSaveOps() {
  const row = _pmProgressDetailCurrent();
  const session = getSession ? getSession() : null;
  if (!row || !row.id) return Toast.warning('프로젝트 정보가 없습니다.');
  try {
    const cpmSel = document.getElementById('pm-detail-cpm');
    const cpmId = String(cpmSel?.value || '').trim();
    const currentCpmId = String(row?.cpm_user_id || '').trim();
    const cpmNameFromOption = String(cpmSel?.selectedOptions?.[0]?.dataset?.name || '').trim();
    const cpmNameFromMap = String(((PM_STATE.usersById || {})[cpmId] || {}).name || '').trim();
    const cpmNameFromText = String(cpmSel?.selectedOptions?.[0]?.textContent || '').split('(')[0].trim();
    const cpmName = cpmNameFromOption || cpmNameFromMap || cpmNameFromText;
    if (!cpmId) return Toast.warning('총괄 프로젝트 매니저(CPM)는 필수입니다.');
    const lifecycleCode = _pmLifecycleStatusForCpmPolicy(row);
    const isAdmin = !!(Auth && typeof Auth.isAdmin === 'function' && Auth.isAdmin(session));
    if (lifecycleCode === 'settled_done' && !isAdmin && cpmId !== currentCpmId) {
      return Toast.warning('정산완료 상태에서는 관리자만 CPM을 변경할 수 있습니다.');
    }
    _pmProgressDetailSyncAssistantRowsFromDom();
    const validationMsg = _pmProgressValidateAssistantRows(PM_STATE.progressAssistantRows || []);
    if (validationMsg) return Toast.warning(validationMsg);
    const practicalPm = _pmPracticalPmFromAssistants(PM_STATE.progressAssistantRows || []);
    if (!practicalPm) {
      return Toast.warning('투입인력현황에 역할이 "실무 책임자"인 사용자를 반드시 1명 이상 등록해 주세요.');
    }
    const assistants = _pmProgressSerializeAssistants(PM_STATE.progressAssistantRows || []);
    const prevRaw = String((row && row.order_contributors_text) || '').trim();
    // 수주참여자(등록 단계 데이터)가 이미 있으면 수행상세 저장으로 덮어쓰지 않는다.
    // 과거에 수행상세를 same field(JSON::)로 저장한 데이터만 해당 포맷으로 갱신한다.
    let nextContributors = prevRaw;
    if (prevRaw.startsWith('JSON::')) {
      nextContributors = assistants || '';
    } else if (!prevRaw && assistants) {
      nextContributors = assistants;
    }
    const startDate = String(document.getElementById('pm-detail-start-date')?.value || '').trim();
    const hadStarted = Number(row.execution_started_at || 0) > 0;
    if (startDate && !hadStarted) {
      if (!_pmProjectHasContractOrEvidence(row)) {
        return Toast.warning('수행중 전환 전 계약서 또는 고객 합의 근거(증빙) 파일을 먼저 등록하세요.');
      }
      const missingDue = _pmMissingBillingDueDateLabels(row.billing_schedule);
      if (missingDue.length) {
        return Toast.warning(`용역시작일 저장 전 청구예정일을 입력하세요: ${missingDue.join(', ')}`);
      }
    }
    const patch = {
      cpm_user_id: cpmId || '',
      cpm_user_name: cpmName || '',
      order_contributors_text: nextContributors,
      lifecycle_updated_at: Date.now(),
      lifecycle_updated_by: String((session && (session.id || session.user_id)) || ''),
      lifecycle_updated_by_name: String((session && (session.name || session.user_name)) || ''),
    };
    if (startDate) patch.execution_started_at = new Date(`${startDate}T00:00:00`).getTime();
    await API.patch('registered_projects', row.id, patch);
    const latest = await API.get('registered_projects', row.id).catch(() => null);
    if (latest && typeof latest === 'object') {
      const hasCpmCols = Object.prototype.hasOwnProperty.call(latest, 'cpm_user_id')
        || Object.prototype.hasOwnProperty.call(latest, 'cpm_user_name');
      if (hasCpmCols && String(latest.cpm_user_id || '').trim() !== cpmId) {
        Toast.warning('CPM 저장값이 즉시 반영되지 않았습니다. 권한/DB 컬럼 상태를 확인하세요.');
      } else if (!hasCpmCols) {
        Toast.warning('운영 DB에 CPM 컬럼이 없어 저장 반영이 제한됩니다. SQL 스키마 적용이 필요합니다.');
      }
    }
    PM_STATE.progressDetailProject = { ...row, ...patch, ...(latest || {}) };
    PM_STATE.progressRowById[String(row.id)] = PM_STATE.progressDetailProject;
    Toast.success('업무수행 상세를 저장했습니다.');
    await loadProjectMgmtProgress();
  } catch (e) {
    console.error(e);
    Toast.error('업무수행 상세 저장 실패: ' + (e.message || e));
  }
}

function _pmProgressDetailRequiresClearance(row) {
  const typeId = String((row && row.project_code_type_id) || '').trim();
  const type = (PM_STATE.projectCodeTypes || []).find((t) => String(t.id || '').trim() === typeId) || null;
  return !!(type && type.requires_clearance_note);
}

function _pmIsCcbTopMgr(session) {
  if (!session) return false;
  if (!Auth.isTopMgr(session)) return false;
  const deptName = String(session.dept_name || session.department_name || '').trim();
  return /ccb/i.test(deptName);
}

function _pmCanPublishApprove(session) {
  return _pmIsCcbTopMgr(session);
}

function _pmClearanceTargetOrgFromOutput(outputRow, projectRow) {
  const parsed = _pmProgressDetailExtractTargetFromNote(String(outputRow?.note || ''));
  let dept = String(parsed?.dept || '').trim();
  let hq = String(parsed?.hq || '').trim();
  if (!dept || !hq) {
    const pmUser = PM_STATE.usersById[String(projectRow?.cpm_user_id || '')] || {};
    if (!dept) dept = String(pmUser.dept_name || '').trim();
    if (!hq) hq = String(pmUser.hq_name || '').trim();
  }
  return { dept, hq };
}

function _pmCanClearanceAction(session, outputRow, projectRow) {
  if (!session) return false;
  const role = String(session.role || '').trim().toLowerCase();
  if (role !== 'top_mgr' && role !== 'director') return false;
  const target = _pmClearanceTargetOrgFromOutput(outputRow, projectRow);
  const sessionDept = String(session.dept_name || session.department_name || '').trim();
  const sessionHq = String(session.hq_name || '').trim();
  if (role === 'top_mgr') return !!target.dept && sessionDept === target.dept;
  if (role === 'director') return !!target.hq && sessionHq === target.hq;
  return false;
}

async function _pmNotifyOutputPublishRequest(row, created, session) {
  if (typeof createNotification !== 'function' || !row || !created) return;
  const outputId = String(created.id || created.data?.id || '').trim();
  if (!outputId) return;
  const senderId = String((session && (session.user_id || session.id)) || '');
  const senderName = String((session && (session.name || session.user_name)) || '');
  const toUsers = (PM_STATE.users || []).filter((u) => {
    if (String(u.role || '').trim().toLowerCase() !== 'top_mgr') return false;
    const dept = String(u.dept_name || '').trim();
    return /ccb/i.test(dept);
  });
  const sent = new Set();
  toUsers.forEach((u) => {
    const uid = String(u.id || '').trim();
    if (!uid || uid === senderId || sent.has(uid)) return;
    sent.add(uid);
    createNotification({
      toUserId: uid,
      toUserName: String(u.name || ''),
      fromUserId: senderId,
      fromUserName: senderName,
      type: 'project_output_publish_request',
      entryId: `PM_OUT_PUBLISH|${String(row.project_code || '').trim()}|${outputId}`,
      entrySummary: `${String(row.project_code || '')} | ${String(created.output_title || created.data?.output_title || '')}`,
      message: `${senderName || '작성자'}님이 결과보고서를 업로드했습니다. 게시/보류/금지 처리를 진행해 주세요.`,
      targetMenu: 'project-management:progress',
    });
  });
}

function _pmOutputAlertContext() {
  const raw = window.__PM_OUTPUT_ALERT__;
  if (!raw || typeof raw !== 'object') return null;
  const projectCode = String(raw.projectCode || '').trim();
  const outputId = String(raw.outputId || '').trim();
  if (!projectCode || !outputId) return null;
  return { projectCode, outputId };
}

async function _pmApplyOutputAlertContext() {
  const ctx = _pmOutputAlertContext();
  if (!ctx) return;
  window.__PM_OUTPUT_ALERT__ = null;
  if (!_pmHasProjectAccess(ctx.projectCode)) return;
  try {
    await pmOpenProgressDetailByCode(ctx.projectCode);
    pmProgressDetailSwitchTab('output');
    const session = getSession ? getSession() : null;
    if (_pmCanPublishApprove(session)) {
      await pmOpenOutputPublishModal(ctx.outputId);
    }
  } catch (_) {}
}

function _pmPublishStatusLabel(status) {
  const s = String(status || '').trim();
  if (s === 'published') return '<span class="badge badge-green">게시</span>';
  if (s === 'blocked' || s === 'private') return '<span class="badge badge-red">금지</span>';
  if (s === 'hold' || s === 'pending_publish') return '<span class="badge badge-yellow">보류</span>';
  return '<span class="badge badge-gray">보류</span>';
}

function _pmActionStatusLabel(status) {
  const s = String(status || '').trim();
  if (s === 'completed') return '완료';
  if (s === 'in_progress') return '진행중';
  return '확인';
}

function _pmOutputFollowupStateLabel(outputType, publishStatus, actions) {
  const t = String(outputType || '').trim();
  if (t === '결과보고서') return _pmPublishStatusLabel(publishStatus || '');
  const rows = Array.isArray(actions) ? actions : [];
  const done = rows.filter((a) => String(a.action_status || '').trim() === 'completed').length;
  if (done > 0) return '<span class="badge badge-green">조치완료</span>';
  if (rows.length > 0) return '<span class="badge badge-yellow">조치진행</span>';
  return '<span class="badge badge-gray">미조치</span>';
}

function _pmRows(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.data)) return result.data;
  return [];
}

async function _pmListRows(table, params = {}) {
  const q = new URLSearchParams();
  q.set('select', String(params.select || '*'));
  Object.keys(params || {}).forEach((k) => {
    if (k === 'select') return;
    const v = params[k];
    if (v === undefined || v === null || v === '') return;
    q.set(k, String(v));
  });
  const url = `${SUPABASE_URL}/rest/v1/${table}?${q.toString()}`;
  const result = await API._fetch(url);
  return _pmRows(result);
}

async function _pmProgressDetailCheckClosureGate(row) {
  if (!row) return { ok: false, reason: '프로젝트 정보가 없습니다.' };
  if (!_pmProgressDetailRequiresClearance(row)) return { ok: true, reason: '' };
  const projectCode = String(row.project_code || '').trim();
  const outputs = await _pmListRows('project_outputs', {
    select: 'id,project_code,output_type',
    project_code: `eq.${projectCode}`,
    limit: 1000,
    order: 'uploaded_at.desc,created_at.desc',
  }).catch(() => []);
  const clearRows = _pmRows(outputs).filter((o) => String(o.output_type || '').trim() === '통관팀유의사항');
  if (!clearRows.length) return { ok: false, reason: '통관유의사항 업로드가 필요합니다.' };
  const outputIds = clearRows.map((o) => String(o.id || '')).filter(Boolean);
  const actions = await API.listAllPages('project_output_actions', { limit: 1000, maxPages: 10, sort: 'updated_at' }).catch(() => []);
  const doneCnt = (actions || []).filter((a) =>
    outputIds.includes(String(a.output_id || '')) &&
    String(a.action_status || '') === 'completed'
  ).length;
  if (doneCnt < 1) return { ok: false, reason: '통관유의사항 조치완료(본부장/사업부장 중 1명 이상)가 필요합니다.' };
  return { ok: true, reason: '' };
}

async function _pmProgressDetailNotifyClearance(row, payload, session, targetDeptName, targetHqName) {
  if (typeof createNotification !== 'function' || !row) return;
  const pm = PM_STATE.usersById[String(row.cpm_user_id || '')] || {};
  const deptTarget = String(targetDeptName || '').trim();
  const hqTarget = String(targetHqName || '').trim();
  const effDept = deptTarget || String(pm.dept_name || '').trim();
  const effHq = hqTarget || String(pm.hq_name || '').trim();
  const toUsers = (PM_STATE.users || []).filter((u) => {
    const role = String(u.role || '').trim();
    if (role === 'director') {
      const sameHq = String(u.hq_name || '').trim() === effHq;
      const sameDept = !effDept || String(u.dept_name || '').trim() === effDept;
      return !!effHq && sameHq && sameDept;
    }
    if (role === 'top_mgr') {
      const sameDept = String(u.dept_name || '').trim() === effDept;
      return !!effDept && sameDept;
    }
    return false;
  });
  const senderId = String((session && (session.user_id || session.id)) || '');
  const sent = new Set();
  toUsers.forEach((u) => {
    const uid = String(u.id || '').trim();
    if (!uid || uid === senderId || sent.has(uid)) return;
    sent.add(uid);
    createNotification({
      toUserId: uid,
      toUserName: String(u.name || ''),
      fromUserId: senderId,
      fromUserName: String((session && (session.name || session.user_name)) || ''),
      type: 'project_clearance_notice',
      entryId: String((payload && payload.id) || ''),
      entrySummary: `${String(row.project_code || '')} | ${String(row.project_name || '')}`,
      message: `${String((session && (session.name || session.user_name)) || '작성자')}님이 통관팀유의사항을 등록했습니다. 조치사항을 입력해주세요.`,
      targetMenu: 'project-management',
    });
  });
}

async function pmProgressDetailUploadOutput() {
  const row = _pmProgressDetailCurrent();
  const session = getSession ? getSession() : null;
  if (!row || !row.project_code) return Toast.warning('프로젝트 정보가 없습니다.');
  const typeEl = document.getElementById('pm-detail-output-type');
  const titleEl = document.getElementById('pm-detail-output-title');
  const noteEl = document.getElementById('pm-detail-output-note');
  const fileEl = document.getElementById('pm-detail-output-file');
  const targetDeptEl = document.getElementById('pm-detail-output-target-dept');
  const targetHqEl = document.getElementById('pm-detail-output-target-hq');
  const btn = document.getElementById('pm-detail-output-upload-btn');
  const outputType = String(typeEl?.value || '').trim() || '결과보고서';
  const outputTitle = String(titleEl?.value || '').trim();
  const note = String(noteEl?.value || '').trim();
  const targetDept = String(targetDeptEl?.value || '').trim();
  const targetHq = String(targetHqEl?.value || '').trim();
  const file = fileEl?.files?.[0];
  if (!outputTitle) return Toast.warning('결과물 제목을 입력해주세요.');
  if (!file) return Toast.warning('업로드할 파일을 선택해주세요.');
  if (outputType === '통관팀유의사항' && (!targetDept || !targetHq || targetDept === '-' || targetHq === '-')) {
    return Toast.warning('통관유의사항은 대상 사업부/본부를 지정해야 합니다.');
  }
  const prevText = btn?.innerHTML || '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 업로드 중...';
  }
  try {
    const now = Date.now();
    const d = new Date(now);
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const ext = String(file.name || '').split('.').pop() || 'bin';
    const stem = _pmProgressDetailSafeSegment(String(file.name || '').replace(/\.[^.]*$/, ''));
    const uniq = Math.random().toString(36).slice(2, 8);
    const path = `project-outputs/${yyyy}/${mm}/${_pmProgressDetailSafeSegment(row.project_code)}/${now}_${uniq}_${stem}.${ext}`;
    const up = await API.storageUpload('project-outputs', path, file, { upsert: false });
    const payload = {
      project_id: String(row.id || ''),
      project_code: String(row.project_code || ''),
      project_name: String(row.project_name || ''),
      output_type: outputType,
      output_title: outputTitle,
      output_file_name: String(file.name || ''),
      output_file_url: String((up && up.publicUrl) || ''),
      uploaded_by: String((session && (session.user_id || session.id)) || ''),
      uploaded_by_name: String((session && (session.name || session.user_name)) || ''),
      uploaded_at: now,
      note: _pmProgressDetailComposeNote(note, targetDept, targetHq),
    };
    if (outputType === '결과보고서') {
      payload.publish_status = 'hold';
      payload.publish_requested_at = now;
      payload.publish_requested_by = String((session && (session.user_id || session.id)) || '');
      payload.publish_requested_by_name = String((session && (session.name || session.user_name)) || '');
    }
    let created = null;
    try {
      created = await API.create('project_outputs', payload);
    } catch (insertErr) {
      const msg = String(insertErr?.message || '');
      if (outputType === '결과보고서' && /publish_status|publish_requested/i.test(msg)) {
        const fallback = { ...payload };
        delete fallback.publish_status;
        delete fallback.publish_requested_at;
        delete fallback.publish_requested_by;
        delete fallback.publish_requested_by_name;
        created = await API.create('project_outputs', fallback);
        Toast.warning('게시승인 컬럼이 아직 없어 승인대기 상태 저장은 생략되었습니다. SQL 반영 후 다시 사용하세요.');
      } else {
        throw insertErr;
      }
    }
    if (outputType === '통관팀유의사항') {
      try {
        await _pmProgressDetailNotifyClearance(row, created, session, targetDept, targetHq);
      } catch (notifyErr) {
        console.warn('[pm-output] clearance notify failed', notifyErr);
        Toast.warning('결과물은 저장되었지만 알림 발송 중 오류가 발생했습니다.');
      }
    }
    if (outputType === '결과보고서') {
      try {
        await _pmNotifyOutputPublishRequest(row, created, session);
      } catch (notifyErr) {
        console.warn('[pm-output] publish notify failed', notifyErr);
        Toast.warning('결과물은 저장되었지만 게시요청 알림 발송 중 오류가 발생했습니다.');
      }
    }
    if (outputType === '결과보고서') {
      try {
        const gate = await _pmProgressDetailCheckClosureGate(row);
        if (gate.ok) {
          const patch = {
            work_closed_at: Number(row.work_closed_at || 0) || now,
            lifecycle_updated_at: now,
            lifecycle_updated_by: String((session && (session.user_id || session.id)) || ''),
            lifecycle_updated_by_name: String((session && (session.name || session.user_name)) || ''),
          };
          await API.patch('registered_projects', row.id, patch);
          PM_STATE.progressDetailProject = { ...row, ...patch };
        } else {
          Toast.warning(`결과보고서는 저장되었지만 업무종료 전환은 보류되었습니다. (${gate.reason})`);
        }
      } catch (gateErr) {
        console.warn('[pm-output] closure gate update failed', gateErr);
        Toast.warning('결과물은 저장되었지만 업무종료 상태 반영 중 오류가 발생했습니다.');
      }
    }
    if (titleEl) titleEl.value = '';
    if (noteEl) noteEl.value = '';
    if (targetDeptEl) targetDeptEl.value = '';
    if (targetHqEl) targetHqEl.value = '';
    if (fileEl) fileEl.value = '';
    Toast.success('결과물이 저장되었습니다.');
    await pmProgressDetailLoadOutputList();
    const createdId = String(
      (created && (created.id || (Array.isArray(created) && created[0] && created[0].id) || (created.data && created.data.id)))
      || ''
    );
    if (createdId && outputType === '통관팀유의사항') {
      try {
        await pmOpenOutputFollowupModal(createdId, String(outputType || ''));
      } catch (followErr) {
        console.warn('[pm-output] followup modal open failed', followErr);
      }
    }
    await loadProjectMgmtProgress();
  } catch (e) {
    console.error(e);
    let msg = String(e && e.message || '').trim();
    if (!msg) {
      try { msg = JSON.stringify(e); } catch (_) { msg = String(e || ''); }
    }
    Toast.error('결과물 업로드 실패: ' + (msg || '원인을 확인할 수 없습니다.'));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = prevText || '<i class="fas fa-upload"></i> 업로드';
    }
  }
}

async function pmProgressDetailLoadOutputList() {
  const row = _pmProgressDetailCurrent();
  const session = getSession ? getSession() : null;
  const body = document.getElementById('pm-detail-output-body');
  const summary = document.getElementById('pm-detail-output-summary');
  if (!body) return;
  if (!row || !row.project_code) {
    body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-folder-open"></i><p>프로젝트 정보가 없습니다.</p></td></tr>';
    if (summary) summary.textContent = '총 0건';
    return;
  }
  body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-spinner fa-spin"></i><p>결과물 목록을 불러오는 중입니다...</p></td></tr>';
  try {
    let rows = [];
    try {
      rows = await _pmListRows('project_outputs', {
        select: 'id,output_type,output_title,output_file_url,uploaded_by_name,uploaded_at,note,created_at,publish_status,publish_approved_by_name,publish_approved_at',
        project_code: `eq.${row.project_code}`,
        order: 'uploaded_at.desc,created_at.desc',
        limit: 1000,
      });
    } catch (qe) {
      const msg = String(qe && qe.message || '');
      if (/publish_status|publish_approved/i.test(msg)) {
        rows = await _pmListRows('project_outputs', {
          select: 'id,output_type,output_title,output_file_url,uploaded_by_name,uploaded_at,note,created_at',
          project_code: `eq.${row.project_code}`,
          order: 'uploaded_at.desc,created_at.desc',
          limit: 1000,
        });
        Toast.warning('게시승인 컬럼이 아직 없어 게시상태/승인 기능이 제한됩니다. SQL 반영 후 정상 동작합니다.');
      } else {
        throw qe;
      }
    }
    const list = _pmRows(rows);
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-folder-open"></i><p>등록된 결과물이 없습니다.</p></td></tr>';
      if (summary) summary.textContent = '총 0건';
      return;
    }
    let actionRows = [];
    try {
      actionRows = await API.listAllPages('project_output_actions', { limit: 1500, maxPages: 10, sort: 'updated_at' });
    } catch (_) {
      actionRows = [];
    }
    const actionByOutput = {};
    (actionRows || []).forEach((a) => {
      const oid = String(a.output_id || '').trim();
      if (!oid) return;
      if (!actionByOutput[oid]) actionByOutput[oid] = [];
      actionByOutput[oid].push(a);
    });
    body.innerHTML = list.map((r, i) => {
      const fileBtn = String(r.output_file_url || '').trim()
        ? `<a class="btn btn-xs btn-outline" href="${_pmEsc(r.output_file_url)}" target="_blank" rel="noopener">열기</a>`
        : '-';
      const actionRowsForOutput = actionByOutput[String(r.id || '').trim()] || [];
      const followState = _pmOutputFollowupStateLabel(r.output_type || '', r.publish_status || '', actionRowsForOutput);
      const type = String(r.output_type || '').trim();
      const canFollow = (type === '결과보고서')
        ? _pmCanPublishApprove(session)
        : (type === '통관팀유의사항' ? _pmCanClearanceAction(session, r, row) : false);
      const followBtn = canFollow
        ? `<button type="button" class="btn btn-xs btn-outline" onclick="pmOpenOutputFollowupModal('${_pmEsc(r.id)}','${_pmEsc(r.output_type || '')}')" title="후속처리"><i class="fas fa-pen-to-square"></i></button>`
        : '-';
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${_pmEsc(row.client_name || '-')}</td>
        <td>${_pmEsc(r.output_type || '')}</td>
        <td>${_pmEsc(r.output_title || '')}</td>
        <td>${_pmProgressDetailFmtDate(r.uploaded_at || r.created_at)}</td>
        <td style="text-align:center">${followState}</td>
        <td style="text-align:center">${fileBtn}</td>
        <td style="text-align:center">${followBtn}</td>
      </tr>`;
    }).join('');
    if (summary) summary.textContent = `총 ${list.length.toLocaleString()}건`;
  } catch (e) {
    console.error(e);
    body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>결과물 조회 실패</p></td></tr>';
    if (summary) summary.textContent = '조회 실패';
  }
}

async function pmOpenOutputFollowupModal(outputId, outputType) {
  const t = String(outputType || '').trim();
  if (t === '통관팀유의사항') {
    await pmOpenOutputActionModal(outputId);
    return;
  }
  await pmOpenOutputPublishModal(outputId);
}

async function pmOpenOutputPublishModal(outputId) {
  const session = getSession ? getSession() : null;
  if (!_pmCanPublishApprove(session)) {
    return Toast.warning('CCB 사업부장만 게시 승인할 수 있습니다.');
  }
  const id = String(outputId || '').trim();
  if (!id) return;
  const row = await API.get('project_outputs', id).catch(() => null);
  if (!row) return Toast.warning('대상 결과물을 찾을 수 없습니다.');
  if (String(row.output_type || '').trim() !== '결과보고서') {
    return Toast.warning('결과보고서만 게시처리를 할 수 있습니다.');
  }
  const hid = document.getElementById('pm-output-publish-output-id');
  const summary = document.getElementById('pm-output-publish-summary');
  const statusEl = document.getElementById('pm-output-publish-status');
  const noteEl = document.getElementById('pm-output-publish-note');
  if (hid) hid.value = id;
  if (summary) summary.textContent = `${row.project_code || ''} · ${row.output_title || ''}`;
  if (statusEl) {
    const s = String(row.publish_status || '').trim();
    statusEl.value = s === 'published' || s === 'hold' || s === 'blocked' ? s : 'hold';
  }
  if (noteEl) noteEl.value = String(row.publish_decision_note || '');
  openModal('pmOutputPublishModal');
}

async function pmSaveOutputPublishDecision() {
  const session = getSession ? getSession() : null;
  if (!_pmCanPublishApprove(session)) {
    Toast.warning('CCB 사업부장만 게시 승인할 수 있습니다.');
    return;
  }
  const id = String(document.getElementById('pm-output-publish-output-id')?.value || '').trim();
  const statusEl = document.getElementById('pm-output-publish-status');
  const noteEl = document.getElementById('pm-output-publish-note');
  const next = String(statusEl?.value || 'hold').trim();
  const note = String(noteEl?.value || '').trim();
  if (!id) return;
  try {
    const outputRow = await API.get('project_outputs', id).catch(() => null);
    await API.patch('project_outputs', id, {
      publish_status: next,
      publish_approved_at: Date.now(),
      publish_approved_by: String(session.user_id || session.id || ''),
      publish_approved_by_name: String(session.name || session.user_name || ''),
      publish_decision_note: String(note || '').trim(),
    });
    if (next === 'published') {
      try {
        await API.create('project_output_ai_queue', {
          output_id: id,
          project_code: String(outputRow?.project_code || ''),
          output_title: String(outputRow?.output_title || ''),
          publish_status: 'published',
          queue_status: 'queued',
          queued_at: Date.now(),
          requested_by: String(session.user_id || session.id || ''),
          requested_by_name: String(session.name || session.user_name || ''),
        });
      } catch (queueErr) {
        const qmsg = String(queueErr && queueErr.message || '');
        if (!/duplicate key|unique/i.test(qmsg)) {
          console.warn('[pm-publish] ai queue create failed', queueErr);
          Toast.warning('게시는 완료되었으나 AI 학습 큐 등록 중 오류가 발생했습니다.');
        }
      }
    }
    closeModal('pmOutputPublishModal');
    Toast.success(next === 'published' ? '게시 처리되었습니다.' : (next === 'hold' ? '보류 처리되었습니다.' : '금지 처리되었습니다.'));
    await pmProgressDetailLoadOutputList();
  } catch (e) {
    console.error(e);
    const msg = String(e && e.message || '');
    if (/publish_status|publish_approved/i.test(msg)) {
      Toast.error('게시승인 컬럼이 없습니다. SQL 스크립트(dev_add_project_output_publish_workflow.sql)를 먼저 적용하세요.');
    } else {
      Toast.error('게시 승인 처리 실패: ' + (e.message || e));
    }
  }
}

async function pmOpenOutputActionModal(outputId) {
  const session = getSession ? getSession() : null;
  const id = String(outputId || '').trim();
  if (!id) return;
  const row = await API.get('project_outputs', id).catch(() => null);
  if (!row) {
    Toast.warning('대상 결과물을 찾을 수 없습니다.');
    return;
  }
  if (String(row.output_type || '').trim() !== '통관팀유의사항') {
    Toast.warning('통관유의사항만 조치 등록이 가능합니다.');
    return;
  }
  const project = PM_STATE.progressDetailProject || PM_STATE.projectByCode[String(row.project_code || '').trim()] || null;
  if (!_pmCanClearanceAction(session, row, project)) {
    Toast.warning('해당 사업부장/본부장만 후속처리할 수 있습니다.');
    return;
  }
  const hid = document.getElementById('pm-output-action-output-id');
  const summary = document.getElementById('pm-output-action-summary');
  const status = document.getElementById('pm-output-action-status');
  const note = document.getElementById('pm-output-action-note');
  const history = document.getElementById('pm-output-action-history');
  if (hid) hid.value = id;
  if (summary) summary.textContent = `${row.project_code || ''} · ${row.output_title || ''}`;
  if (status) status.value = 'confirmed';
  if (note) note.value = '';
  if (history) history.innerHTML = '<div style="color:var(--text-muted)">조치 이력을 불러오는 중...</div>';
  await pmRenderOutputActionHistory(id);
  openModal('pmOutputActionModal');
}

async function pmRenderOutputActionHistory(outputId) {
  const history = document.getElementById('pm-output-action-history');
  if (!history) return;
  try {
    const rows = await API.listAllPages('project_output_actions', { limit: 500, maxPages: 5, sort: 'updated_at' });
    const scoped = (rows || [])
      .filter((r) => String(r.output_id || '').trim() === String(outputId || '').trim())
      .sort((a, b) => Number(b.updated_at || b.created_at || 0) - Number(a.updated_at || a.created_at || 0));
    if (!scoped.length) {
      history.innerHTML = '등록된 조치 이력이 없습니다.';
      return;
    }
    history.innerHTML = scoped.map((r) => `
      <div style="border:1px solid var(--border-light);border-radius:8px;padding:8px 10px;margin-top:6px">
        <div style="font-size:11px;color:var(--text-muted);display:flex;justify-content:space-between">
          <span>${_pmEsc(r.action_user_name || '-')} · ${_pmEsc(_pmActionStatusLabel(r.action_status || 'confirmed'))}</span>
          <span>${_pmProgressDetailFmtDate(r.action_at || r.updated_at || r.created_at)}</span>
        </div>
        <div style="font-size:12px;line-height:1.45;margin-top:4px;color:var(--text-secondary)">${_pmEsc(r.action_note || '-')}</div>
      </div>
    `).join('');
  } catch (e) {
    history.innerHTML = '<span style="color:var(--danger)">조치 이력을 불러오지 못했습니다.</span>';
  }
}

async function pmSaveOutputAction() {
  const session = getSession ? getSession() : null;
  const outputId = String(document.getElementById('pm-output-action-output-id')?.value || '').trim();
  const actionStatus = String(document.getElementById('pm-output-action-status')?.value || 'confirmed').trim();
  const actionNote = String(document.getElementById('pm-output-action-note')?.value || '').trim();
  if (!outputId) return Toast.warning('대상 유의사항이 없습니다.');
  if (!actionNote) return Toast.warning('조치내용을 입력하세요.');
  try {
    const output = await API.get('project_outputs', outputId).catch(() => null);
    if (!output) return Toast.warning('대상 결과물을 찾을 수 없습니다.');
    const project = PM_STATE.progressDetailProject || PM_STATE.projectByCode[String(output.project_code || '').trim()] || null;
    if (!_pmCanClearanceAction(session, output, project)) {
      return Toast.warning('해당 사업부장/본부장만 후속처리할 수 있습니다.');
    }
    const me = String(session?.user_id || session?.id || '');
    const all = await API.listAllPages('project_output_actions', { limit: 500, maxPages: 5, sort: 'updated_at' }).catch(() => []);
    const hit = (all || []).find((r) => String(r.output_id || '') === outputId && String(r.action_user_id || '') === me);
    const payload = {
      output_id: outputId,
      project_code: String(output.project_code || ''),
      action_user_id: me,
      action_user_name: String(session?.name || session?.user_name || ''),
      action_role: String(session?.role || ''),
      action_status: actionStatus,
      action_note: actionNote,
      action_at: Date.now(),
      updated_at: Date.now(),
    };
    if (hit && hit.id) await API.patch('project_output_actions', hit.id, payload);
    else await API.create('project_output_actions', payload);
    Toast.success('조치사항이 저장되었습니다.');
    await pmRenderOutputActionHistory(outputId);
    await pmProgressDetailLoadOutputList();
  } catch (e) {
    console.error(e);
    Toast.error('조치 저장 실패: ' + (e.message || e));
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
    const targetRow = PM_STATE.progressRowById[String(projectId || '')]
      || await API.get('registered_projects', projectId).catch(() => null);
    if (val === 'contract_completed' && !_pmProjectHasContractOrEvidence(targetRow)) {
      Toast.warning('계약완료로 보정하려면 계약서 또는 고객 합의 근거(증빙) 파일이 필요합니다.');
      return;
    }
    if (val === 'in_progress') {
      if (!_pmProjectHasContractOrEvidence(targetRow)) {
        Toast.warning('수행중으로 보정하려면 계약서 또는 고객 합의 근거(증빙) 파일이 필요합니다.');
        return;
      }
      const missingDue = _pmMissingBillingDueDateLabels(targetRow && targetRow.billing_schedule);
      if (missingDue.length) {
        Toast.warning(`수행중으로 보정하려면 청구예정일을 먼저 입력하세요: ${missingDue.join(', ')}`);
        return;
      }
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
  const rows = await _pmListAllPagesSortFallback('project_timecharge_batches', {
    filter: `project_code=eq.${encodeURIComponent(projectCode)}&billing_month=eq.${encodeURIComponent(billingMonth)}`,
    limit: 50,
    maxPages: 1,
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

async function _pmLoadStandardRateMasterRates(force) {
  const now = Date.now();
  if (!force && PM_STATE.standardRateMasterRows.length && (now - Number(PM_STATE.standardRateMasterLoadedAt || 0) < 60000)) {
    return PM_STATE.standardRateMasterRows;
  }
  const rows = await API.listAllPages('standard_rate_master', {
    filter: 'is_active=eq.true',
    limit: 200,
    maxPages: 5,
    sort: 'updated_at',
  }).catch(() => []);
  PM_STATE.standardRateMasterRows = Array.isArray(rows) ? rows : [];
  PM_STATE.standardRateMasterLoadedAt = now;
  return PM_STATE.standardRateMasterRows;
}

const _PM_TC_TITLE_LABEL_MAP = {
  senior: '선임',
  associate: '전임',
  principal: '책임',
  team_lead: '팀장',
  division_head: '본부장',
  bu_head: '사업부장',
  ceo: '대표',
};

function _pmNormalizeTimeChargeTitleKey(raw, userName = '') {
  const txt = String(raw || '').trim().toLowerCase();
  if (!txt && String(userName || '').trim() === '한휘선') return 'ceo';
  if (!txt) return '';
  if (txt.includes('선임') || txt.includes('senior') || txt === 'staff') return 'senior';
  if (txt.includes('전임') || txt.includes('associate')) return 'associate';
  if (txt.includes('책임') || txt.includes('principal')) return 'principal';
  if (txt === 'manager') return 'team_lead';
  if (txt === 'director') return 'division_head';
  if (txt.includes('팀장') || txt.includes('team_lead') || txt.includes('teamlead')) return 'team_lead';
  if (txt.includes('본부장') || txt.includes('division_head') || txt.includes('divisionhead')) return 'division_head';
  if (txt.includes('사업부장') || txt.includes('bu_head') || txt.includes('buhead') || txt.includes('top_mgr') || txt.includes('topmgr')) return 'bu_head';
  if (txt.includes('대표') || txt === 'ceo') return 'ceo';
  if (['senior', '선임', 'staff'].includes(txt)) return 'senior';
  if (['associate', '전임'].includes(txt)) return 'associate';
  if (['principal', '책임'].includes(txt)) return 'principal';
  if (txt === 'manager') return 'team_lead';
  if (txt === 'director') return 'division_head';
  if (['team_lead', 'teamlead', '팀장'].includes(txt)) return 'team_lead';
  if (['division_head', 'divisionhead', '본부장'].includes(txt)) return 'division_head';
  if (['bu_head', 'buhead', '사업부장', 'top_mgr', 'topmgr'].includes(txt)) return 'bu_head';
  if (['ceo', '대표'].includes(txt)) return 'ceo';
  return txt;
}

function _pmPickBestUserForTimeCharge(users, userName = '') {
  const list = Array.isArray(users) ? users.filter(Boolean) : [];
  if (!list.length) return null;
  const titleRank = { associate: 1, senior: 2, principal: 3, team_lead: 4, division_head: 5, bu_head: 6, ceo: 7 };
  return list.slice().sort((a, b) => {
    const aActive = (a?.deleted !== true && a?.is_active !== false) ? 1 : 0;
    const bActive = (b?.deleted !== true && b?.is_active !== false) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aRole = _pmNormalizeTimeChargeTitleKey(String(a?.job_title || a?.title || a?.role || '').trim(), userName);
    const bRole = _pmNormalizeTimeChargeTitleKey(String(b?.job_title || b?.title || b?.role || '').trim(), userName);
    const ar = Number(titleRank[aRole] || 0);
    const br = Number(titleRank[bRole] || 0);
    if (ar !== br) return br - ar;
    return Number(b?.updated_at || b?.created_at || 0) - Number(a?.updated_at || a?.created_at || 0);
  })[0] || null;
}

function _pmResolveTimeChargeTitleKey(user, fallbackRoleKey = '', userName = '') {
  const titleFromUser = _pmNormalizeTimeChargeTitleKey(String(user?.job_title || '').trim(), userName);
  if (titleFromUser) return titleFromUser;
  const titleFromLegacyTitle = _pmNormalizeTimeChargeTitleKey(String(user?.title || '').trim(), userName);
  if (titleFromLegacyTitle) return titleFromLegacyTitle;
  const legacyRole = _pmNormalizeTimeChargeTitleKey(String(user?.role || '').trim(), userName);
  if (legacyRole) return legacyRole;
  return _pmNormalizeTimeChargeTitleKey(fallbackRoleKey, userName);
}

function _pmTimeChargeTitleLabel(rawKey) {
  const key = _pmNormalizeTimeChargeTitleKey(rawKey);
  return _PM_TC_TITLE_LABEL_MAP[key] || (String(rawKey || '').trim() || '-');
}

async function _pmResolveRate(project, userId, roleKey, workDate, userName) {
  const defaultRoleRate = {
    senior: 200000,
    associate: 300000,
    principal: 500000,
    team_lead: 700000,
    division_head: 800000,
    bu_head: 900000,
    ceo: 1000000,
  };
  const dateVal = String(workDate || '').trim();
  const projectCode = String(project && project.project_code || '').trim();
  const userNameText = String(userName || '').trim();
  const normalizedRoleKey = _pmNormalizeTimeChargeTitleKey(roleKey, userNameText);
  const [projRates, userRates] = await Promise.all([
    API.listAllPages('project_rate_cards', {
      filter: `project_code=eq.${encodeURIComponent(projectCode)}&is_active=eq.true`,
      limit: 200,
      maxPages: 2,
      sort: 'updated_at',
    }).catch(() => []),
    _pmLoadStandardRateMasterRates(false),
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
  const byRole = (projRates || []).find((r) =>
    _pmNormalizeTimeChargeTitleKey(String(r.role_key || '').trim(), userNameText) === normalizedRoleKey && isInRange(r)
  );
  if (byRole) return { unitRate: Number(byRole.unit_rate || 0), rateSource: 'project_role' };
  const named = (userRates || []).find((r) => String(r.user_name || '').trim() === userNameText && isInRange(r));
  if (named) return { unitRate: Number(named.unit_rate || 0), rateSource: 'user_base' };
  const roleStd = (userRates || []).find((r) =>
    !String(r.user_name || '').trim()
    && _pmNormalizeTimeChargeTitleKey(String(r.role_key || '').trim(), userNameText) === normalizedRoleKey
    && isInRange(r)
  );
  if (roleStd) return { unitRate: Number(roleStd.unit_rate || 0), rateSource: 'user_base' };
  if (userNameText === '한휘선') return { unitRate: 1000000, rateSource: 'user_base' };
  const fallback = Number(defaultRoleRate[normalizedRoleKey] || 0);
  if (fallback > 0) return { unitRate: fallback, rateSource: 'user_base' };
  return { unitRate: 0, rateSource: 'manual' };
}

function _pmNormTimeText(val) {
  if (typeof val === 'number' && Number.isFinite(val)) {
    // Excel time serial support:
    // - 0~1: time fraction of a day (e.g. 0.5 => 12:00)
    // - >=1: datetime serial, use fractional part as time
    const frac = val >= 1 ? (val % 1) : val;
    if (frac >= 0 && frac < 1) {
      const total = Math.round(frac * 24 * 60);
      const hh = Math.floor(total / 60) % 24;
      const mm = total % 60;
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return `${String(val.getHours()).padStart(2, '0')}:${String(val.getMinutes()).padStart(2, '0')}`;
  }
  const s = String(val == null ? '' : val).trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})[:시](\d{1,2})/);
  if (m) return `${String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, '0')}:${String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2, '0')}`;
  if (/^\d{3,4}$/.test(s)) {
    const hh = Number(s.length === 3 ? s.slice(0, 1) : s.slice(0, 2));
    const mm = Number(s.slice(-2));
    if (hh >= 0 && hh < 24 && mm >= 0 && mm < 60) return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return '';
}

function _pmMinutesBetween(startText, endText) {
  const start = _pmNormTimeText(startText);
  const end = _pmNormTimeText(endText);
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return Math.max(0, diff);
}

function _pmParseDurationMinutes(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const num = Number(s);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return num <= 24 ? Math.round(num * 60) : Math.round(num);
  }
  const hourMatch = s.match(/(\d+(\.\d+)?)\s*(h|hr|hour|시간)/i);
  if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);
  const minMatch = s.match(/(\d+)\s*(m|min|minute|분)/i);
  if (minMatch) return Math.round(Number(minMatch[1]));
  return 0;
}

function _pmTimechargeUploadKey(row) {
  return [
    String(row.project_code || '').trim(),
    String(row.work_date || '').trim(),
    String(row.user_name || '').trim(),
    String(row.start_time || '').trim(),
    String(row.end_time || '').trim(),
    String(row.description || '').trim(),
  ].join('|');
}

function _pmTimechargeDisplayParts(row) {
  const raw = String(row?.description || '').trim();
  const siteMatch = raw.match(/(?:^|\/)\s*장소:([^/]+)/);
  const noteMatch = raw.match(/(?:^|\/)\s*비고:([^/]+)/);
  const rangeMatch = raw.match(/(?:^|\/)\s*시간대:([^/]+)/);
  const site = siteMatch ? String(siteMatch[1] || '').trim() : '';
  const timeRange = rangeMatch ? String(rangeMatch[1] || '').trim() : '';
  const content = raw
    .replace(/(?:^|\/)\s*장소:[^/]+/g, '')
    .replace(/(?:^|\/)\s*비고:[^/]+/g, '')
    .replace(/(?:^|\/)\s*시간대:[^/]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return {
    site: site || '-',
    timeRange: timeRange || '-',
    note: noteMatch ? String(noteMatch[1] || '').trim() : '',
    content: content || '-',
  };
}

function _pmRenderTimechargeUploadPendingState() {
  const saveBtn = document.getElementById('pm-tc-upload-save-btn');
  const cancelBtn = document.getElementById('pm-tc-upload-cancel-btn');
  const info = document.getElementById('pm-tc-upload-preview');
  const pendingWrap = document.getElementById('pm-tc-pending-wrap');
  const pendingBody = document.getElementById('pm-tc-pending-body');
  const rows = PM_STATE.pendingTimeChargeUploadRows || [];
  const meta = PM_STATE.pendingTimeChargeUploadMeta || null;
  const hasPending = rows.length > 0;
  if (saveBtn) saveBtn.style.display = hasPending ? '' : 'none';
  if (cancelBtn) cancelBtn.style.display = hasPending ? '' : 'none';
  if (!info) return;
  if (!hasPending || !meta) {
    info.style.display = 'none';
    info.textContent = '';
    const countEl = document.getElementById('pm-tc-stage2-count');
    const minEl = document.getElementById('pm-tc-stage2-minutes');
    const issueEl = document.getElementById('pm-tc-stage2-issues');
    if (countEl) countEl.textContent = '0건';
    if (minEl) minEl.textContent = '0분';
    if (issueEl) issueEl.textContent = '0 / 0';
    if (pendingWrap) pendingWrap.style.display = 'none';
    if (pendingBody) pendingBody.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-inbox"></i><p>검토 중인 데이터가 없습니다.</p></td></tr>';
    _pmSyncTimeChargeActionAvailability();
    return;
  }
  info.style.display = '';
  info.textContent = `업로드 검토 대기: ${meta.validRows.toLocaleString('ko-KR')}건 · ${meta.totalMinutes.toLocaleString('ko-KR')}분 · 중복제외 ${meta.duplicateRows.toLocaleString('ko-KR')}건 · 오류 ${meta.errorRows.toLocaleString('ko-KR')}건`;
  const countEl = document.getElementById('pm-tc-stage2-count');
  const minEl = document.getElementById('pm-tc-stage2-minutes');
  const issueEl = document.getElementById('pm-tc-stage2-issues');
  if (countEl) countEl.textContent = `${Number(meta.validRows || 0).toLocaleString('ko-KR')}건`;
  if (minEl) minEl.textContent = `${Number(meta.totalMinutes || 0).toLocaleString('ko-KR')}분`;
  if (issueEl) issueEl.textContent = `${Number(meta.errorRows || 0).toLocaleString('ko-KR')} / ${Number(meta.duplicateRows || 0).toLocaleString('ko-KR')}`;
  if (pendingWrap) pendingWrap.style.display = '';
  if (pendingBody) {
    pendingBody.innerHTML = rows.map((r, idx) => {
      const parts = _pmTimechargeDisplayParts(r);
      return `<tr>
        <td style="text-align:center">${idx + 1}</td>
        <td>${_pmEsc(r.work_date || '')}</td>
        <td>${_pmEsc(r.user_name || '-')}</td>
        <td>${_pmEsc(parts.timeRange)}</td>
        <td>${_pmEsc(_pmHoursText(Number(r.final_minutes || r.base_minutes || 0)))}</td>
        <td>${_pmEsc(parts.site)}</td>
        <td title="${_pmEsc(parts.content)}">${_pmEsc(parts.content)}</td>
        <td style="text-align:center"><span class="badge badge-blue">검토대기</span></td>
      </tr>`;
    }).join('');
  }
  _pmSyncTimeChargeActionAvailability();
}

function _pmTimeChargeDataSource() {
  const v = String(document.getElementById('pm-tc-data-source')?.value || 'mixed').trim();
  return ['mixed', 'timesheet', 'excel'].includes(v) ? v : 'mixed';
}

function _pmSyncTimeChargeSourceGuide() {
  const mode = _pmTimeChargeDataSource();
  const guideEl = document.getElementById('pm-tc-source-guide');
  if (guideEl) {
    guideEl.textContent = mode === 'timesheet'
      ? '타임시트 모드: 승인 타임시트 불러오기로만 데이터를 반영합니다.'
      : (mode === 'excel'
        ? '엑셀 모드: 업로드 검토/확정 저장으로만 데이터를 반영합니다.'
        : '혼합 모드에서는 승인 타임시트 불러오기와 엑셀 업로드를 함께 사용할 수 있습니다.');
  }
  _pmSyncTimeChargeActionAvailability();
}

function _pmSyncTimeChargeDocMeta(projectCode, billingMonth) {
  const code = String(projectCode || '').trim();
  const month = String(billingMonth || '').trim();
  const docNoEl = document.getElementById('pm-tc-doc-no');
  const versionEl = document.getElementById('pm-tc-doc-version');
  const byEl = document.getElementById('pm-tc-doc-created-by');
  const atEl = document.getElementById('pm-tc-doc-created-at');
  const capEl = document.getElementById('pm-tc-cap-amount');
  const claimEl = document.getElementById('pm-tc-claim-amount');
  const session = getSession();
  const subtotal = Number(PM_STATE.currentBatch?.subtotal_amount || 0);
  const cap = _pmTimechargeContractCap(code);
  const claim = cap > 0 ? Math.min(subtotal, cap) : subtotal;
  if (docNoEl) docNoEl.textContent = code && month ? `TCINV-${code}-${month.replace('-', '')}` : '-';
  if (versionEl) versionEl.textContent = 'v1';
  if (byEl) byEl.textContent = String(session?.name || '-');
  if (atEl) atEl.textContent = PM_STATE.currentBatch ? new Date(Number(PM_STATE.currentBatch.updated_at || Date.now())).toLocaleString('ko-KR') : '-';
  if (capEl) capEl.textContent = _pmKrw(cap);
  if (claimEl) claimEl.textContent = _pmKrw(claim);
}

function _pmSyncTimeChargePeriodRange(lines) {
  const el = document.getElementById('pm-tc-period-range');
  if (!el) return;
  const dates = (lines || [])
    .map((r) => String(r?.work_date || '').trim())
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort((a, b) => a.localeCompare(b));
  if (!dates.length) {
    el.textContent = '프로젝트 기간(타임쉬트 기준): -';
    return;
  }
  el.textContent = `프로젝트 기간(타임쉬트 기준): ${dates[0]} ~ ${dates[dates.length - 1]}`;
}

function _pmRenderTimeChargeStatusSummary(projectCode, batch, lines) {
  const body = document.getElementById('pm-tc-status-summary-body');
  if (!body) return;
  const code = String(projectCode || '').trim();
  const list = Array.isArray(lines) ? lines : [];
  if (!code) {
    body.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-layer-group"></i><p>프로젝트코드를 선택하세요.</p></td></tr>';
    return;
  }
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-inbox"></i><p>집계할 라인이 없습니다.</p></td></tr>';
    return;
  }
  const project = PM_STATE.projectByCode[code] || {};
  const rowCount = list.length;
  const totalMinutes = list.reduce((sum, r) => sum + Number(r?.final_minutes || r?.base_minutes || 0), 0);
  const subtotal = list.reduce((sum, r) => sum + Number(r?.is_billable !== false ? (r?.final_amount || 0) : 0), 0);
  body.innerHTML = `<tr>
    <td style="text-align:center">1</td>
    <td>${_pmEsc(code)}</td>
    <td>${_pmEsc(String(project.client_name || batch?.client_name || '-'))}</td>
    <td style="text-align:center">${rowCount.toLocaleString('ko-KR')}</td>
    <td style="text-align:right">${_pmEsc(_pmHoursText(totalMinutes))}</td>
    <td style="text-align:right">${_pmEsc(_pmKrw(subtotal))}</td>
    <td style="text-align:center">
      <button type="button" class="btn btn-xs btn-outline" onclick="pmTimeChargeOpenInvoiceFromSummary()" title="청구서 상세보기">
        <i class="fas fa-file-lines"></i>
      </button>
    </td>
  </tr>`;
}

function pmTimeChargeOpenInvoiceFromSummary() {
  const lines = PM_STATE.currentLines || [];
  if (!lines.length) {
    Toast.warning('먼저 Time Charge 라인을 불러오세요.');
    return;
  }
  pmTimeChargeSwitchDocTab('invoice');
  pmPreviewTimeChargeDocument();
  const wrap = document.getElementById('pm-tc-doc-invoice-wrap');
  if (wrap) {
    try { wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
  }
}

function _pmTimechargeContractCap(projectCode) {
  const milestones = _pmCollectBillingMilestones(PM_STATE.projectByCode[projectCode] || {});
  const cap = milestones.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  return Number.isFinite(cap) ? cap : 0;
}

async function pmDownloadTimeChargeTemplate() {
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('XLSX 라이브러리를 로드할 수 없습니다.');
    return;
  }
  const ym = _pmTimeChargeBatchMonth();
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    {
      프로젝트코드: 'PJT-2026-001',
      일자: `${ym}-01`,
      컨설턴트: '홍길동',
      '직급/역할': '실무 책임자',
      시작시간: '09:00',
      종료시간: '12:00',
      시간: '',
      내용: '주간 보고서 작성 및 고객 미팅',
      장소: '고객사 본사',
      비고: '',
    },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, `TimeCharge_${ym}`);
  const guide = XLSX.utils.json_to_sheet([
    { 항목: '필수 컬럼', 안내: '프로젝트코드, 일자, 컨설턴트, 직급/역할, 시작시간+종료시간 또는 시간, 내용' },
    { 항목: '중복판정', 안내: '프로젝트코드 + 일자 + 컨설턴트 + 시작시간 + 종료시간 + 내용' },
    { 항목: '처리방식', 안내: '업로드 후 즉시 저장되지 않으며 검토 후 저장 버튼으로 확정됩니다.' },
  ]);
  XLSX.utils.book_append_sheet(wb, guide, '입력안내');
  await xlsxDownload(wb, `타임차지_업로드양식_${ym}.xlsx`);
}

async function pmUploadTimeChargeExcel(fileInput) {
  const mode = _pmTimeChargeDataSource();
  if (mode === 'timesheet') {
    Toast.warning('현재 데이터 소스가 타임시트 전용입니다. 엑셀 업로드 모드로 변경하세요.');
    if (fileInput) fileInput.value = '';
    return;
  }
  const session = getSession();
  if (!(Auth.canApprove1st(session) || Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session))) {
    Toast.warning('Time Charge 업로드 권한이 없습니다.');
    return;
  }
  const file = fileInput?.files?.[0] || null;
  if (!file) return;
  const projectCode = String(document.getElementById('pm-tc-project')?.value || '').trim();
  const billingMonth = _pmTimeChargeBatchMonth(projectCode);
  if (!projectCode) {
    Toast.warning('프로젝트코드를 먼저 선택하세요.');
    fileInput.value = '';
    return;
  }
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('XLSX 라이브러리를 로드할 수 없습니다.');
    fileInput.value = '';
    return;
  }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rawRows = _pmParseXlsxRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
    const project = PM_STATE.projectByCode[projectCode] || {};
    const usersByName = {};
    (PM_STATE.users || []).forEach((u) => {
      const name = String(u.name || '').trim();
      if (!name) return;
      if (!usersByName[name]) usersByName[name] = [];
      usersByName[name].push(u);
    });
    const dedupMap = {};
    const monthSet = new Set();
    let duplicateRows = 0;
    let errorRows = 0;
    for (const src of rawRows) {
      const rowProjectCode = String(src['프로젝트코드'] || src.project_code || projectCode).trim();
      const workDate = _pmNormalizeExpenseDateInput(src['일자'] || src.work_date || '');
      const userName = String(src['컨설턴트'] || src.user_name || '').trim();
      const roleKey = String(src['직급/역할'] || src.role_key || '').trim();
      const startTime = _pmNormTimeText(src['시작시간'] || src.start_time || '');
      const endTime = _pmNormTimeText(src['종료시간'] || src.end_time || '');
      const desc = String(src['내용'] || src.description || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      const place = String(src['장소'] || src.place || '').trim();
      const note = String(src['비고'] || src.note || '').trim();
      const durationRaw = src['시간'] ?? src.duration ?? src.minutes ?? '';
      const durationFromRange = _pmMinutesBetween(startTime, endTime);
      const durationFromCell = _pmParseDurationMinutes(durationRaw);
      const baseMinutes = durationFromRange > 0 ? durationFromRange : durationFromCell;
      if (rowProjectCode !== projectCode || !userName || !workDate || !desc || baseMinutes <= 0) {
        errorRows += 1;
        continue;
      }
      const ym = String(workDate || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(ym)) monthSet.add(ym);
      const key = _pmTimechargeUploadKey({
        project_code: rowProjectCode,
        work_date: workDate,
        user_name: userName,
        start_time: startTime,
        end_time: endTime,
        description: desc,
      });
      if (dedupMap[key]) {
        dedupMap[key].base_minutes += baseMinutes;
        duplicateRows += 1;
        continue;
      }
      const user = _pmPickBestUserForTimeCharge(usersByName[userName] || [], userName);
      dedupMap[key] = {
        source_key: `excel|${key}`,
        entry_id: '',
        project_code: rowProjectCode,
        project_name: project.project_name || '',
        client_name: project.client_name || '',
        user_id: String(user?.id || ''),
        user_name: userName,
        role_key: _pmResolveTimeChargeTitleKey(user, roleKey, userName),
        work_date: workDate,
        work_category_name: '엑셀업로드',
        work_subcategory_name: '',
        description: `${desc}${startTime && endTime ? ` / 시간대:${startTime}~${endTime}` : ''}${place ? ` / 장소:${place}` : ''}${note ? ` / 비고:${note}` : ''}`.slice(0, 240),
        start_time: startTime,
        end_time: endTime,
        base_minutes: baseMinutes,
      };
    }
    const pendingRows = Object.values(dedupMap);
    let totalAmount = 0;
    let totalMinutes = 0;
    await _pmLoadStandardRateMasterRates(true);
    for (const row of pendingRows) {
      const rateInfo = await _pmResolveRate(project, row.user_id, row.role_key, row.work_date, row.user_name);
      const finalMinutes = Number(row.base_minutes || 0);
      const finalAmount = (finalMinutes / 60) * Number(rateInfo.unitRate || 0);
      row.adjusted_minutes = 0;
      row.final_minutes = finalMinutes;
      row.rate_source = rateInfo.rateSource;
      row.unit_rate = Number(rateInfo.unitRate || 0);
      row.base_amount = finalAmount;
      row.adjusted_amount = 0;
      row.final_amount = finalAmount;
      row.is_billable = true;
      totalMinutes += finalMinutes;
      totalAmount += finalAmount;
    }
    if (!pendingRows.length) {
      PM_STATE.pendingTimeChargeUploadRows = [];
      PM_STATE.pendingTimeChargeUploadMeta = null;
      _pmRenderTimechargeUploadPendingState();
      Toast.warning(`업로드 검토 결과 유효 데이터가 없습니다. (오류 ${errorRows}건)`);
      return;
    }
    const monthList = Array.from(monthSet).sort((a, b) => a.localeCompare(b));
    const resolvedBillingMonth = monthList.length ? monthList[monthList.length - 1] : billingMonth;
    PM_STATE.pendingTimeChargeUploadRows = pendingRows;
    PM_STATE.pendingTimeChargeUploadMeta = {
      fileName: file.name || '',
      sourceRows: rawRows.length,
      validRows: pendingRows.length,
      duplicateRows,
      errorRows,
      totalMinutes,
      totalAmount,
      projectCode,
      billingMonth: resolvedBillingMonth,
    };
    _pmRenderTimechargeUploadPendingState();
    Toast.success(`타임차지 업로드 검토 완료 (${pendingRows.length}건)`);
  } catch (e) {
    console.error(e);
    Toast.error('타임시트 업로드 실패: ' + (e.message || ''));
  } finally {
    if (fileInput) fileInput.value = '';
  }
}

async function pmCommitPendingTimeChargeUpload() {
  const session = getSession();
  if (!(Auth.canApprove1st(session) || Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session))) {
    Toast.warning('Time Charge 저장 권한이 없습니다.');
    return;
  }
  const rows = PM_STATE.pendingTimeChargeUploadRows || [];
  const meta = PM_STATE.pendingTimeChargeUploadMeta || null;
  if (!rows.length || !meta) {
    Toast.info('검토 후 저장할 업로드 데이터가 없습니다.');
    return;
  }
  try {
    const batch = await _pmFindOrCreateBatch(meta.projectCode, meta.billingMonth);
    PM_STATE.currentBatch = batch;
    const existing = await _pmListAllPagesSortFallback('project_timecharge_lines', {
      filter: `batch_id=eq.${encodeURIComponent(batch.id)}`,
      limit: 1000,
      maxPages: 10,
    }).catch(() => []);
    const existingByKey = {};
    (existing || []).forEach((r) => { existingByKey[String(r.source_key || '')] = r; });
    for (const row of rows) {
      const payload = {
        batch_id: batch.id,
        source_key: row.source_key,
        entry_id: row.entry_id || '',
        project_code: row.project_code,
        project_name: row.project_name || '',
        client_name: row.client_name || '',
        user_id: row.user_id || '',
        user_name: row.user_name || '',
        role_key: row.role_key || '',
        work_date: row.work_date || null,
        work_category_name: row.work_category_name || '엑셀업로드',
        work_subcategory_name: row.work_subcategory_name || '',
        description: row.description || '',
        base_minutes: Number(row.base_minutes || 0),
        adjusted_minutes: Number(row.adjusted_minutes || 0),
        final_minutes: Number(row.final_minutes || row.base_minutes || 0),
        rate_source: row.rate_source || 'manual',
        unit_rate: Number(row.unit_rate || 0),
        base_amount: Number(row.base_amount || 0),
        adjusted_amount: Number(row.adjusted_amount || 0),
        final_amount: Number(row.final_amount || 0),
        is_billable: row.is_billable !== false,
        adjust_reason: '엑셀 업로드',
        created_by: session.id,
        created_by_name: session.name || '',
      };
      if (existingByKey[row.source_key]) await API.patch('project_timecharge_lines', existingByKey[row.source_key].id, payload);
      else await API.create('project_timecharge_lines', payload);
    }
    PM_STATE.pendingTimeChargeUploadRows = [];
    PM_STATE.pendingTimeChargeUploadMeta = null;
    _pmRenderTimechargeUploadPendingState();
    await loadProjectMgmtTimeCharge();
    await saveTimeChargeLines();
    pmTimeChargeSwitchDocTab('status');
    pmTimeChargeSwitchViewTab('overall');
    Toast.success('업로드 검토 데이터를 Time Charge 배치에 반영했습니다.');
  } catch (e) {
    console.error(e);
    Toast.error('업로드 저장 실패: ' + (e.message || ''));
  }
}

function pmCancelPendingTimeChargeUpload() {
  PM_STATE.pendingTimeChargeUploadRows = [];
  PM_STATE.pendingTimeChargeUploadMeta = null;
  _pmRenderTimechargeUploadPendingState();
  Toast.info('타임차지 업로드 검토 데이터를 취소했습니다.');
}

function _pmTimechargeRoleRank(roleKey) {
  const key = _pmNormalizeTimeChargeTitleKey(roleKey);
  const rank = {
    ceo: 7,
    bu_head: 6,
    division_head: 5,
    team_lead: 4,
    principal: 3,
    associate: 2,
    senior: 1,
  };
  return Number(rank[key] || 0);
}

function _pmTimechargeSummaryRich(lines) {
  const usersById = PM_STATE.usersById || {};
  const userList = Array.isArray(PM_STATE.users) ? PM_STATE.users : [];
  const userByNameKey = {};
  userList.forEach((u) => {
    const key = _pmProgressAssistantNameKey(String(u?.name || '').trim());
    if (!key) return;
    if (!userByNameKey[key]) userByNameKey[key] = [];
    userByNameKey[key].push(u);
  });
  const resolvePosition = (row, name) => {
    const fallbackKey = String(row?.role_key || '').trim();
    const uid = String(row?.user_id || '').trim();
    if (uid && usersById[uid]) {
      const roleKey = _pmResolveTimeChargeTitleKey(usersById[uid], fallbackKey, name);
      return { label: _pmTimeChargeTitleLabel(roleKey), roleKey, fromProfile: true };
    }
    const nameKey = _pmProgressAssistantNameKey(name);
    const picked = _pmPickBestUserForTimeCharge(nameKey ? (userByNameKey[nameKey] || []) : [], name);
    if (picked) {
      const roleKey = _pmResolveTimeChargeTitleKey(picked, fallbackKey, name);
      return { label: _pmTimeChargeTitleLabel(roleKey), roleKey, fromProfile: true };
    }
    const roleKey = _pmNormalizeTimeChargeTitleKey(fallbackKey, name);
    return { label: _pmTimeChargeTitleLabel(roleKey), roleKey, fromProfile: false };
  };
  const map = {};
  (lines || []).forEach((r) => {
    const name = String(r.user_name || '미지정').trim() || '미지정';
    const uid = String(r.user_id || '').trim();
    const key = uid ? `uid:${uid}` : `name:${_pmProgressAssistantNameKey(name)}`;
    const pos = resolvePosition(r, name);
    if (!map[key]) {
      map[key] = {
        _key: key,
        Consultant: name,
        Position: pos.label,
        _roleKey: pos.roleKey || '',
        _userId: uid,
        _positionFromProfile: pos.fromProfile,
        _rateSum: 0,
        _rateCount: 0,
        _minutes: 0,
        _amount: 0,
        _rows: [],
      };
    }
    const item = map[key];
    if (pos.fromProfile && !item._positionFromProfile) {
      item.Position = pos.label;
      item._positionFromProfile = true;
      item._roleKey = pos.roleKey || item._roleKey || '';
    }
    const rate = Number(r.unit_rate || 0);
    item._rateSum += rate;
    item._rateCount += 1;
    item._minutes += Number(r.final_minutes || r.base_minutes || 0);
    item._amount += Number(r.is_billable !== false ? (r.final_amount || 0) : 0);
    item._rows.push(r);
  });
  return Object.values(map)
    .map((row) => ({
      _key: row._key,
      _userId: row._userId || '',
      _roleKey: row._roleKey || _pmNormalizeTimeChargeTitleKey(row.Position),
      _roleRank: _pmTimechargeRoleRank(row._roleKey || row.Position),
      _minutes: Number(row._minutes || 0),
      _amount: Math.round(Number(row._amount || 0)),
      _rows: Array.isArray(row._rows) ? row._rows : [],
      Consultant: row.Consultant,
      Position: row.Position,
      'Time Rate': row._rateCount > 0 ? Math.round(row._rateSum / row._rateCount) : 0,
      Time: Number((row._minutes / 60).toFixed(2)),
      'Time Charge': Math.round(row._amount),
    }));
}

function _pmTimechargeSummaryRows(lines) {
  return _pmTimechargeSummaryRich(lines)
    .map((r) => ({
      Consultant: r.Consultant,
      Position: r.Position,
      'Time Rate': r['Time Rate'],
      Time: r.Time,
      'Time Charge': r['Time Charge'],
    }))
    .sort((a, b) => String(a.Consultant).localeCompare(String(b.Consultant), 'ko'));
}

async function _pmRefreshCurrentTimeChargeRates(project) {
  const rows = Array.isArray(PM_STATE.currentLines) ? PM_STATE.currentLines : [];
  if (!rows.length) return;
  await _pmLoadStandardRateMasterRates(true);
  const usersByName = {};
  (PM_STATE.users || []).forEach((u) => {
    const n = String(u?.name || '').trim();
    if (!n) return;
    if (!usersByName[n]) usersByName[n] = [];
    usersByName[n].push(u);
  });
  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const changedRows = [];
  for (const row of rows) {
    const userName = String(row?.user_name || '').trim();
    const userId = String(row?.user_id || '').trim();
    const byId = userId ? (PM_STATE.usersById[userId] || null) : null;
    const byName = _pmPickBestUserForTimeCharge(usersByName[userName] || [], userName);
    const user = byId || byName || null;
    const resolvedRoleKey = _pmResolveTimeChargeTitleKey(user, String(row?.role_key || '').trim(), userName);
    const next = {
      user_id: String(user?.id || userId || '').trim(),
      role_key: resolvedRoleKey,
      rate_source: String(row?.rate_source || 'manual'),
      unit_rate: Number(row?.unit_rate || 0),
      base_amount: Number(row?.base_amount || 0),
      final_amount: Number(row?.final_amount || 0),
    };
    if (next.rate_source !== 'manual') {
      const rateInfo = await _pmResolveRate(
        project || {},
        next.user_id,
        resolvedRoleKey,
        row?.work_date,
        userName,
      );
      const baseMinutes = Number(row?.base_minutes || 0);
      const finalMinutes = Number(row?.final_minutes || baseMinutes || 0);
      const adjustedAmount = Number(row?.adjusted_amount || 0);
      next.rate_source = String(rateInfo?.rateSource || 'user_base');
      next.unit_rate = Number(rateInfo?.unitRate || 0);
      next.base_amount = round2((baseMinutes / 60) * next.unit_rate);
      next.final_amount = row?.is_billable === false
        ? 0
        : round2((finalMinutes / 60) * next.unit_rate + adjustedAmount);
    }
    const changed = String(row?.user_id || '') !== next.user_id
      || String(row?.role_key || '') !== next.role_key
      || String(row?.rate_source || '') !== next.rate_source
      || Math.abs(Number(row?.unit_rate || 0) - next.unit_rate) > 0.01
      || Math.abs(Number(row?.base_amount || 0) - next.base_amount) > 0.01
      || Math.abs(Number(row?.final_amount || 0) - next.final_amount) > 0.01;
    if (!changed) continue;
    row.user_id = next.user_id;
    row.role_key = next.role_key;
    row.rate_source = next.rate_source;
    row.unit_rate = next.unit_rate;
    row.base_amount = next.base_amount;
    row.final_amount = next.final_amount;
    if (row?.id) changedRows.push({
      id: row.id,
      payload: {
        user_id: next.user_id,
        role_key: next.role_key,
        rate_source: next.rate_source,
        unit_rate: next.unit_rate,
        base_amount: next.base_amount,
        final_amount: next.final_amount,
      },
    });
  }
  for (const item of changedRows) {
    await API.patch('project_timecharge_lines', item.id, item.payload);
  }
  if (PM_STATE.currentBatch?.id) {
    const subtotal = rows.reduce((sum, r) => sum + Number(r?.is_billable !== false ? (r?.final_amount || 0) : 0), 0);
    const tax = Math.round(subtotal * 0.1);
    const total = subtotal + tax;
    PM_STATE.currentBatch.subtotal_amount = subtotal;
    PM_STATE.currentBatch.tax_amount = tax;
    PM_STATE.currentBatch.total_amount = total;
    PM_STATE.currentBatch.outstanding_amount = total;
    await API.patch('project_timecharge_batches', PM_STATE.currentBatch.id, {
      subtotal_amount: subtotal,
      tax_amount: tax,
      total_amount: total,
      outstanding_amount: total,
    });
  }
}

async function _pmSaveTimeChargeInvoiceSnapshot({ batch, project, summaryRows, subtotal, cap, claim }) {
  if (!batch || !batch.id) return;
  const session = getSession();
  const payload = {
    batch_id: batch.id,
    project_code: String(batch.project_code || ''),
    project_name: String(batch.project_name || project?.project_name || ''),
    client_name: String(batch.client_name || project?.client_name || ''),
    billing_month: String(batch.billing_month || ''),
    doc_no: `TCINV-${String(batch.project_code || '').trim()}-${String(batch.billing_month || '').replace('-', '')}`,
    version_no: 1,
    created_by: String(session?.id || ''),
    created_by_name: String(session?.name || ''),
    subtotal_amount: Math.round(Number(subtotal || 0)),
    cap_amount: Math.round(Number(cap || 0)),
    claim_amount: Math.round(Number(claim || 0)),
    payload: {
      generated_at: Date.now(),
      summary_rows: summaryRows,
      totals: {
        subtotal: Math.round(Number(subtotal || 0)),
        cap: Math.round(Number(cap || 0)),
        claim: Math.round(Number(claim || 0)),
      },
    },
  };
  try {
    await API.create('project_timecharge_documents', payload);
  } catch (e) {
    console.warn('[timecharge-doc] snapshot save skipped:', e?.message || e);
  }
}

async function pmExportTimeChargeStatusWorkbook() {
  const lines = PM_STATE.currentLines || [];
  if (!lines.length) {
    Toast.warning('먼저 Time Charge 라인을 불러오세요.');
    return;
  }
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('XLSX 라이브러리를 로드할 수 없습니다.');
    return;
  }
  const projectCode = String(document.getElementById('pm-tc-project')?.value || PM_STATE.currentBatch?.project_code || '').trim();
  const billingMonth = String(PM_STATE.currentBatch?.billing_month || _pmTimeChargeBatchMonth(projectCode)).trim();
  const wb = XLSX.utils.book_new();
  const detailRows = [...lines]
    .sort((a, b) => String(a.work_date || '').localeCompare(String(b.work_date || '')))
    .map((r, idx) => {
      const parts = _pmTimechargeDisplayParts(r);
      return {
        No: idx + 1,
        용역일자: String(r.work_date || ''),
        컨설턴트: String(r.user_name || ''),
        수행시간: parts.timeRange,
        투입시간: _pmHoursText(Number(r.final_minutes || r.base_minutes || 0)),
        수행장소: parts.site,
        수행업무: parts.content,
      };
    });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), '투입인력전체현황');
  const personRows = [...lines]
    .slice()
    .sort((a, b) => {
      const n = String(a.user_name || '').localeCompare(String(b.user_name || ''), 'ko');
      if (n !== 0) return n;
      const d = String(a.work_date || '').localeCompare(String(b.work_date || ''));
      if (d !== 0) return d;
      return String(_pmTimechargeDisplayParts(a).timeRange || '').localeCompare(String(_pmTimechargeDisplayParts(b).timeRange || ''));
    })
    .map((r, idx) => {
      const parts = _pmTimechargeDisplayParts(r);
      return {
        No: idx + 1,
        컨설턴트: String(r.user_name || ''),
        용역일자: String(r.work_date || ''),
        용역시간: parts.timeRange,
        투입시간: _pmHoursText(Number(r.final_minutes || r.base_minutes || 0)),
        수행장소: parts.site,
        수행업무: parts.content,
      };
    });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(personRows), '투입인력별현황');
  await xlsxDownload(wb, `타임쉬트현황표_${projectCode}_${billingMonth}.xlsx`);
}

async function pmExportTimeChargeInvoiceWorkbook() {
  const lines = PM_STATE.currentLines || [];
  if (!lines.length) {
    Toast.warning('먼저 Time Charge 라인을 불러오세요.');
    return;
  }
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('XLSX 라이브러리를 로드할 수 없습니다.');
    return;
  }
  const batch = PM_STATE.currentBatch || {};
  const projectCode = String(batch.project_code || document.getElementById('pm-tc-project')?.value || '').trim();
  const billingMonth = String(batch.billing_month || _pmTimeChargeBatchMonth(projectCode)).trim();
  const project = PM_STATE.projectByCode[projectCode] || {};
  const createdBy = getSession()?.name || '';
  const summaryRows = _pmTimechargeSummaryRows(lines);
  const subtotal = summaryRows.reduce((sum, r) => sum + Number(r['Time Charge'] || 0), 0);
  const cap = _pmTimechargeContractCap(projectCode);
  const claim = cap > 0 ? Math.min(subtotal, cap) : subtotal;
  const wb = XLSX.utils.book_new();
  const invoiceMeta = XLSX.utils.json_to_sheet([
    { 항목: '프로젝트코드', 값: projectCode },
    { 항목: '고객사', 값: String(project.client_name || batch.client_name || '') },
    { 항목: '기준월', 값: billingMonth },
    { 항목: '문서번호', 값: `TCINV-${projectCode}-${String(billingMonth || '').replace('-', '')}` },
    { 항목: '생성일시', 값: new Date().toLocaleString('ko-KR') },
    { 항목: '작성자', 값: createdBy },
  ]);
  XLSX.utils.book_append_sheet(wb, invoiceMeta, '문서메타');
  const invoiceSummary = XLSX.utils.json_to_sheet(summaryRows.concat([
    {},
    { Consultant: '용역 보수액', Position: '', 'Time Rate': '', Time: '', 'Time Charge': Math.round(subtotal) },
    { Consultant: '청구 한도액', Position: '', 'Time Rate': '', Time: '', 'Time Charge': Math.round(cap) },
    { Consultant: '청구 보수액', Position: '', 'Time Rate': '', Time: '', 'Time Charge': Math.round(claim) },
  ]));
  XLSX.utils.book_append_sheet(wb, invoiceSummary, '청구서');
  await _pmSaveTimeChargeInvoiceSnapshot({ batch, project, summaryRows, subtotal, cap, claim });
  if (batch?.id) PM_STATE.timechargeInvoiceGeneratedByBatch[batch.id] = Date.now();
  const byEl = document.getElementById('pm-tc-doc-created-by');
  const atEl = document.getElementById('pm-tc-doc-created-at');
  if (byEl) byEl.textContent = String(createdBy || '-');
  if (atEl) atEl.textContent = new Date().toLocaleString('ko-KR');
  _pmSyncTimeChargeActionAvailability();
  pmPreviewTimeChargeDocument();
  await xlsxDownload(wb, `타임차지청구서_${projectCode}_${billingMonth}.xlsx`);
  Toast.success('타임차지 청구서 산출물을 생성했습니다.');
}

async function importTimeChargeFromEntries() {
  const mode = _pmTimeChargeDataSource();
  if (mode === 'excel') {
    Toast.warning('현재 데이터 소스가 엑셀 전용입니다. 타임시트 또는 혼합 모드로 변경하세요.');
    return;
  }
  const session = getSession();
  if (!(Auth.canApprove1st(session) || Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session))) {
    Toast.warning('Time Charge 불러오기 권한이 없습니다.');
    return;
  }
  const projectCode = String(document.getElementById('pm-tc-project')?.value || '').trim();
  const billingMonth = _pmTimeChargeBatchMonth(projectCode);
  if (!projectCode) {
    Toast.warning('프로젝트코드를 선택하세요.');
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
    const scoped = (entries || []);
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
          role_key: _pmResolveTimeChargeTitleKey(PM_STATE.usersById[userId] || null, '', e.user_name || ''),
          work_date: workDate || null,
          work_category_name: cat,
          work_subcategory_name: e.work_subcategory_name || '',
          description: String(e.work_description || '').replace(/\s+/g, ' ').slice(0, 120),
          base_minutes: 0,
        };
      }
      grouped[sourceKey].base_minutes += Number(e.duration_minutes || 0);
    });

    const existing = await _pmListAllPagesSortFallback('project_timecharge_lines', {
      filter: `batch_id=eq.${encodeURIComponent(batch.id)}`,
      limit: 800,
      maxPages: 10,
    }).catch(() => []);
    const existingByKey = {};
    (existing || []).forEach((r) => { existingByKey[String(r.source_key || '')] = r; });

    const project = PM_STATE.projectByCode[projectCode] || {};
    const session = getSession();
    await _pmLoadStandardRateMasterRates(true);
    for (const key of Object.keys(grouped)) {
      const row = grouped[key];
      const rateInfo = await _pmResolveRate(project, row.user_id, row.role_key, row.work_date, row.user_name);
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
    pmTimeChargeSwitchDocTab('status');
    pmTimeChargeSwitchViewTab('overall');
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
  try {
    let subtotal = 0;
    const rows = PM_STATE.currentLines || [];
    if (!rows.length) {
      Toast.info('저장할 라인이 없습니다.');
      return;
    }
    for (const row of rows) {
      const amount = Number(row.final_amount || 0);
      const isBillable = row.is_billable !== false;
      subtotal += isBillable ? amount : 0;
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
  const generated = !!PM_STATE.timechargeInvoiceGeneratedByBatch[String(PM_STATE.currentBatch.id || '').trim()];
  if (!generated) {
    Toast.warning('먼저 청구서 생성·출력 또는 PDF 다운로드를 실행해 문서를 생성하세요.');
    return;
  }
  try {
    const projectCode = String(PM_STATE.currentBatch.project_code || '').trim();
    const subtotal = Number(PM_STATE.currentBatch.subtotal_amount || 0);
    const cap = _pmTimechargeContractCap(projectCode);
    const requestSupply = cap > 0 ? Math.min(subtotal, cap) : subtotal;
    const billingMonth = String(PM_STATE.currentBatch.billing_month || _pmNowMonth()).trim();
    await pmOpenInvoiceProjectDetail(projectCode);
    PM_STATE.invoiceDetailProjectCode = projectCode;
    const invMonthEl = document.getElementById('pm-inv-month');
    if (invMonthEl) invMonthEl.value = billingMonth;
    const billableTotal = _pmInvoiceBillableCostTotal(projectCode);
    const hasBillableCosts = billableTotal > 0;
    const defaultMode = hasBillableCosts ? 'merged' : 'service_only';
    const reqModeEl = document.getElementById('pm-inv-request-mode');
    if (reqModeEl) reqModeEl.value = defaultMode;
    const includeCostEl = document.getElementById('pm-inv-include-billable-costs');
    if (includeCostEl) includeCostEl.checked = hasBillableCosts;
    const amountEl = document.getElementById('pm-inv-invoice-amount');
    if (amountEl) amountEl.value = _pmFormatAmountInput(String(Math.round(requestSupply)));
    const serviceItemEl = document.getElementById('pm-inv-service-item-name');
    if (serviceItemEl && !String(serviceItemEl.value || '').trim()) serviceItemEl.value = 'Time Charge 용역대금';
    _pmResetInvoicePreviewConfirmation(projectCode);
    _pmRefreshInvoicePlanSelectionUi(projectCode);
    if (amountEl) amountEl.value = _pmFormatAmountInput(String(Math.round(requestSupply)));
    _pmSyncInvoiceCreateButtonState(projectCode);
    if (cap > 0 && subtotal > cap) {
      Toast.info(`세금계산서 발행 상세로 이동했습니다. Time Charge 한도 ${_pmKrw(cap)}가 적용된 금액으로 세팅되었습니다.`);
    } else if (hasBillableCosts) {
      Toast.info('세금계산서 발행 상세로 이동했습니다. 기본 청구유형은 합산(용역+청구비용)이며, 필요 시 용역대금 단독으로 변경할 수 있습니다.');
    } else {
      Toast.info('세금계산서 발행 상세로 이동했습니다. 미리보기 확인 후 발행/전송을 진행하세요.');
    }
  } catch (e) {
    console.error(e);
    Toast.error('발행 요청 처리 실패: ' + (e.message || ''));
  }
}

async function loadProjectMgmtTimeCharge() {
  const projectCode = String(document.getElementById('pm-tc-project')?.value || '').trim();
  const billingMonth = _pmTimeChargeBatchMonth(projectCode);
  const body = document.getElementById('pm-tc-body');
  const summaryTextEl = document.getElementById('pm-tc-summary');
  const statusBadge = document.getElementById('pm-tc-status-badge');
  if (!body) return;
  if (!projectCode) {
    body.innerHTML = '<tr><td colspan="6" class="table-empty"><i class="fas fa-layer-group"></i><p>프로젝트코드를 선택하세요.</p></td></tr>';
    if (statusBadge) statusBadge.textContent = '배치 없음';
    PM_STATE.currentBatch = null;
    PM_STATE.currentLines = [];
    _pmRenderTimeChargeStatusSummary('', null, []);
    if (summaryTextEl) summaryTextEl.textContent = '현재 배치 0건 · 공급가액 0원';
    _pmSyncTimeChargeDocMeta('', '');
    _pmSyncTimeChargePeriodRange([]);
    return;
  }
  if (!_pmHasProjectAccess(projectCode)) {
    body.innerHTML = '<tr><td colspan="6" class="table-empty"><i class="fas fa-ban"></i><p>해당 프로젝트 접근 권한이 없습니다.</p></td></tr>';
    if (statusBadge) statusBadge.textContent = '접근 제한';
    _pmRenderTimeChargeStatusSummary(projectCode, null, []);
    if (summaryTextEl) summaryTextEl.textContent = '현재 배치 0건 · 공급가액 0원';
    _pmSyncTimeChargeDocMeta(projectCode, billingMonth);
    return;
  }
  try {
    const rows = await _pmListAllPagesSortFallback('project_timecharge_batches', {
      filter: `project_code=eq.${encodeURIComponent(projectCode)}`,
      limit: 50,
      maxPages: 1,
    }).catch(() => []);
    const toTs = (v) => {
      const n = Number(v || 0);
      if (Number.isFinite(n) && n > 0) return n;
      const t = Date.parse(String(v || ''));
      return Number.isFinite(t) ? t : 0;
    };
    const sortedRows = (rows || []).slice().sort((a, b) =>
      toTs(b?.updated_at || b?.created_at || 0) - toTs(a?.updated_at || a?.created_at || 0)
    );
    const prevBatchId = String(
      PM_STATE.currentBatch && String(PM_STATE.currentBatch.project_code || '').trim() === projectCode
        ? (PM_STATE.currentBatch.id || '')
        : ''
    ).trim();
    if (prevBatchId) {
      const matched = (rows || []).find((r) => String(r?.id || '') === prevBatchId);
      PM_STATE.currentBatch = matched || sortedRows[0] || null;
    } else {
      PM_STATE.currentBatch = sortedRows[0] || null;
    }
    const batchId = PM_STATE.currentBatch ? PM_STATE.currentBatch.id : '';
    if (!batchId) {
      body.innerHTML = '<tr><td colspan="6" class="table-empty"><i class="fas fa-file-medical"></i><p>아직 생성된 배치가 없습니다. 불러오기를 눌러주세요.</p></td></tr>';
      if (statusBadge) statusBadge.textContent = '배치 없음';
      _pmRenderTimeChargeStatusSummary(projectCode, PM_STATE.currentBatch, []);
      if (summaryTextEl) summaryTextEl.textContent = '현재 배치 0건 · 공급가액 0원';
      _pmSyncTimeChargeDocMeta(projectCode, billingMonth);
      _pmSyncTimeChargePeriodRange([]);
      return;
    }
    const lines = await _pmListAllPagesSortFallback('project_timecharge_lines', {
      filter: `batch_id=eq.${encodeURIComponent(batchId)}`,
      limit: 800,
      maxPages: 10,
    }).catch(() => []);
    PM_STATE.currentLines = lines || [];
    const project = PM_STATE.projectByCode[projectCode] || {};
    await _pmRefreshCurrentTimeChargeRates(project);
    const docs = await _pmListAllPagesSortFallback('project_timecharge_documents', {
      filter: `batch_id=eq.${encodeURIComponent(batchId)}`,
      limit: 1,
      maxPages: 1,
    }).catch(() => []);
    PM_STATE.timechargeInvoiceGeneratedByBatch[batchId] = Array.isArray(docs) && docs.length > 0;
    if (statusBadge) statusBadge.textContent = `상태: ${PM_STATE.currentBatch.status || 'draft'}`;

    if (!PM_STATE.currentLines.length) {
      body.innerHTML = '<tr><td colspan="6" class="table-empty"><i class="fas fa-inbox"></i><p>저장된 Time Charge 라인이 없습니다.</p></td></tr>';
      _pmRenderTimeChargeStatusSummary(projectCode, PM_STATE.currentBatch, []);
      if (summaryTextEl) summaryTextEl.textContent = '현재 배치 0건 · 공급가액 0원';
      _pmSyncTimeChargeDocMeta(projectCode, billingMonth);
      _pmSyncTimeChargePeriodRange([]);
      return;
    }
    const summaryRich = _pmTimechargeSummaryRich(PM_STATE.currentLines);
    const overallRows = summaryRich
      .slice()
      .sort((a, b) => String(a.Consultant || '').localeCompare(String(b.Consultant || ''), 'ko'));
    body.innerHTML = overallRows.map((r, i) => `<tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${_pmEsc(r.Consultant || '-')}</td>
      <td>${_pmEsc(r.Position || '-')}</td>
      <td style="text-align:right">${_pmKrw(Number(r['Time Rate'] || 0))}</td>
      <td style="text-align:right">${_pmEsc(Number(r.Time || 0).toFixed(1))}h</td>
      <td style="text-align:right">${_pmKrw(Number(r['Time Charge'] || 0))}</td>
    </tr>`).join('');

    const subtotal = PM_STATE.currentLines.reduce((sum, r) => sum + Number(r?.is_billable !== false ? (r?.final_amount || 0) : 0), 0);
    _pmRenderTimeChargeStatusSummary(projectCode, PM_STATE.currentBatch, PM_STATE.currentLines);
    if (summaryTextEl) {
      summaryTextEl.textContent = `현재 배치 ${PM_STATE.currentLines.length.toLocaleString('ko-KR')}건 · 공급가액 ${_pmKrw(subtotal)}`;
    }
    _pmSyncTimeChargeDocMeta(projectCode, billingMonth);
    _pmSyncTimeChargePeriodRange(PM_STATE.currentLines);
    _pmSyncTimeChargeActionAvailability();
    if ((PM_STATE.timechargeDocTab || 'status') !== 'status') pmPreviewTimeChargeDocument();
  } catch (e) {
    console.error(e);
    body.innerHTML = '<tr><td colspan="6" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>Time Charge 조회 실패</p></td></tr>';
    _pmRenderTimeChargeStatusSummary(projectCode, PM_STATE.currentBatch, []);
    if (summaryTextEl) summaryTextEl.textContent = '현재 배치 0건 · 공급가액 0원';
    _pmSyncTimeChargePeriodRange([]);
  }
}

async function pmGenerateInvoiceMailPreview() {
  const projectCode = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-inv-project')?.value || '').trim();
  const billingMonth = _pmCurrentInvoiceMonth();
  if (!projectCode || !billingMonth) {
    Toast.warning('프로젝트/청구월을 확인하세요.');
    return;
  }
  const form = _pmReadInvoiceRequestForm(projectCode, billingMonth, PM_STATE.currentBatch || null);
  const missing = _pmValidateInvoiceForm(form);
  const consistencyIssues = _pmValidateInvoiceOutputConsistency(form);
  const issues = [...missing, ...consistencyIssues];
  if (issues.length) {
    _pmResetInvoicePreviewConfirmation(projectCode);
    Toast.warning(`세금계산서 미리보기 전 확인: ${issues.join(', ')}`);
    return;
  }
  const output = _pmInvoiceOutputFromForm(projectCode, billingMonth, form, PM_STATE.currentBatch || null);
  const summaryText = _pmRenderCustomerInvoiceSummaryText(output);
  _pmRenderInvoicePreviewPanel(output, summaryText);
  PM_STATE.invoicePreviewConfirmed = true;
  PM_STATE.invoicePreviewProjectCode = projectCode;
  PM_STATE.invoicePreviewMonth = billingMonth;
  _pmSyncInvoiceCreateButtonState(projectCode);
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(summaryText).then(() => {
      Toast.success('세금계산서 미리보기를 생성하고 클립보드에 복사했습니다.');
    }).catch(() => {
      Toast.success('세금계산서 미리보기를 생성했습니다.');
    });
  } else {
    Toast.success('세금계산서 미리보기를 생성했습니다.');
  }
}

async function _pmSendInvoiceRequestEmails({ created, reqForm, projectCode, billingMonth, batch, session }) {
  if (!created || !created.id || !reqForm) return;
  if (!API || typeof API.invokeFunction !== 'function') return;
  const output = _pmInvoiceOutputFromForm(projectCode, billingMonth, reqForm, created || batch || null);
  const invoiceSummaryText = _pmRenderCustomerInvoiceSummaryText(output);
  const invoiceHtml = _pmRenderCustomerInvoiceHtml(output);
  const recipients = _pmFinanceUsers();
  if (!recipients.length) return;
  await Promise.allSettled(recipients.map((u) => API.invokeFunction(PM_INVOICE_EMAIL_FUNCTION, {
    to_user_id: String(u.id || ''),
    to_user_name: String(u.name || ''),
    from_user_id: String(session?.id || ''),
    from_user_name: String(session?.name || ''),
    type: 'project_invoice_request',
    entry_id: String(created.id || ''),
    entry_summary: `${projectCode} · ${billingMonth}`,
    message: `${projectCode} (${billingMonth}) 고객청구서 발행요청이 등록되었습니다.`,
    target_menu: 'project-management:invoice',
    invoice_summary_text: invoiceSummaryText,
    invoice_html: invoiceHtml,
    channel: 'email',
  }).catch((err) => {
    console.warn('[invoice-email] 발송 실패:', err?.message || err);
    return null;
  })));
}

async function createInvoiceRequestFromBatch() {
  const session = getSession();
  const projectCode = String(PM_STATE.invoiceDetailProjectCode || document.getElementById('pm-tc-project')?.value || document.getElementById('pm-inv-project')?.value || '').trim();
  const billingMonth = String(document.getElementById('pm-inv-month')?.value || _pmTimeChargeBatchMonth(projectCode)).trim();
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
  if (!_pmIsInvoicePreviewConfirmed(projectCode, billingMonth)) {
    Toast.warning('먼저 세금계산서 미리보기를 실행해 전송 내용을 확인하세요.');
    _pmSyncInvoiceCreateButtonState(projectCode);
    return;
  }
  try {
    const batch = PM_STATE.currentBatch && PM_STATE.currentBatch.project_code === projectCode && PM_STATE.currentBatch.billing_month === billingMonth
      ? PM_STATE.currentBatch
      : await _pmFindOrCreateBatch(projectCode, billingMonth);
    await _pmEnsureInvoiceRowsForProject(projectCode);
    const reqForm = _pmReadInvoiceRequestForm(projectCode, billingMonth, batch);
    const requestMode = String(reqForm.request_mode || 'merged').trim();
    const isCostOnly = requestMode === 'cost_only';
    const missing = _pmValidateInvoiceForm(reqForm);
    if (missing.length) {
      Toast.warning(`발행요청 필수값을 확인하세요: ${missing.join(', ')}`);
      return;
    }
    const consistencyIssues = _pmValidateInvoiceOutputConsistency(reqForm);
    if (consistencyIssues.length) {
      Toast.warning(`발행요청 금액 검증을 확인하세요: ${consistencyIssues.join(', ')}`);
      return;
    }
    const project = PM_STATE.projectByCode[projectCode] || {};
    if (isCostOnly) {
      if (Number(reqForm.billable_cost_amount || 0) <= 0) {
        Toast.warning('청구비용 단독 발행은 청구 가능한 비용 항목이 있어야 합니다.');
        return;
      }
    } else {
      const progress = _pmInvoiceIssueProgress(project, projectCode, _pmProjectInvoiceRows(projectCode));
      if (progress.plannedTotal > 0 && progress.remainingRequestTotal <= 0) {
        Toast.warning('전액 발행요청 완료된 프로젝트입니다. 추가 발행요청은 불가합니다.');
        return;
      }
      const bounds = _pmInvoiceAmountBounds(project, projectCode, reqForm.planned_issue_date, _pmProjectInvoiceRows(projectCode));
      if (!(bounds.planned > 0)) {
        Toast.warning('선택한 예상청구일정의 발행대상 금액이 없습니다. 발행 대상금액 표에서 일정을 선택해 주세요.');
        return;
      }
      if (Number(reqForm.service_amount || 0) > bounds.remaining) {
        Toast.warning(`용역대금이 선택 일정 잔액을 초과했습니다. 잔액: ${_pmKrw(bounds.remaining)}`);
        return;
      }
    }
    const bizCertFile = document.getElementById('pm-inv-biz-cert-file')?.files?.[0] || null;
    if (bizCertFile) {
      const uploadedMeta = await _pmUploadInvoiceBizCert(projectCode, bizCertFile, session);
      reqForm.request_payload = {
        ...(reqForm.request_payload || {}),
        biz_cert_file_name: uploadedMeta.name,
        biz_cert_file_url: uploadedMeta.url,
        biz_cert_uploaded_at: uploadedMeta.uploadedAt,
        biz_cert_uploaded_by_name: uploadedMeta.uploadedBy,
        biz_cert_ocr_status: 'pending',
        biz_cert_ocr_requested_at: Date.now(),
        biz_cert_ocr_updated_at: Date.now(),
        biz_cert_ocr_result: {},
      };
    } else if (!reqForm.request_payload?.biz_cert_ocr_status) {
      reqForm.request_payload = {
        ...(reqForm.request_payload || {}),
        biz_cert_ocr_status: 'none',
      };
    }
    const grossAmount = Number(reqForm.total_amount || reqForm.invoice_amount || 0);
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
      invoice_amount: Number(reqForm.invoice_amount || 0),
      tax_type: String(reqForm.tax_type || 'taxable'),
      vat_rate: Number(reqForm.vat_rate || 0.1),
      vat_amount: Number(reqForm.vat_amount || 0),
      total_amount: grossAmount,
      paid_amount: 0,
      outstanding_amount: grossAmount,
    }).catch(async (e) => {
      const msg = String(e?.message || '').toLowerCase();
      const canCompatTaxType = msg.includes('project_invoices_tax_type_chk') || msg.includes('violates check constraint');
      if (!_pmHasUnknownColumnError(e, ['tax_type', 'vat_rate', 'vat_amount', 'total_amount']) && !canCompatTaxType) throw e;
      return _pmCreateInvoiceCompat({
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
        invoice_amount: Number(reqForm.invoice_amount || 0),
        tax_type: String(reqForm.tax_type || 'taxable'),
        vat_rate: Number(reqForm.vat_rate || 0),
        vat_amount: Number(reqForm.vat_amount || 0),
        total_amount: grossAmount,
        paid_amount: 0,
        outstanding_amount: grossAmount,
      });
    });
    if (created && created.id) {
      await API.patch('project_timecharge_batches', batch.id, {
        status: 'requested',
        requested_at: Date.now(),
        requested_by: session.id,
        requested_by_name: session.name || '',
      }).catch(() => null);
      if (Array.isArray(reqForm.billable_cost_ids) && reqForm.billable_cost_ids.length) {
        for (const costId of reqForm.billable_cost_ids) {
          await API.patch('project_expense_uploads', costId, {
            billing_status: 'requested',
            linked_invoice_id: created.id,
            is_billable: true,
          }).catch(() => null);
        }
      }
      const issueMode = _pmCanIssueInvoice(session) ? PM_NTS_MODES.LIVE : PM_NTS_MODES.QUEUE;
      await issueTaxInvoice(created.id, issueMode);
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
    const previewOutput = _pmInvoiceOutputFromForm(projectCode, billingMonth, reqForm, created || batch || null);
    _pmRenderInvoicePreviewPanel(previewOutput, _pmRenderCustomerInvoiceSummaryText(previewOutput));
    await _pmSendInvoiceRequestEmails({ created, reqForm, projectCode, billingMonth, batch, session });
    await loadProjectMgmtInvoices();
    await _pmLoadInvoiceProjectDetail(projectCode);
    _pmClearInvoiceBizCertInput();
    Toast.success('세금계산서 발행요청을 생성했습니다.');
  } catch (e) {
    console.error(e);
    Toast.error('세금계산서 발행요청 생성 실패: ' + (e.message || ''));
  }
}

async function loadProjectMgmtInvoices() {
  const plannedBody = document.getElementById('pm-inv-planned-body');
  const issuedBody = document.getElementById('pm-inv-issued-body');
  if (!plannedBody || !issuedBody) return;
  const session = getSession ? getSession() : null;
  const canIssue = _pmCanIssueInvoice(session);
  const monthKey = String(document.getElementById('pm-inv-month')?.value || _pmNowMonth()).trim();
  _pmFillInvoiceListFilters();
  const fClient = String(document.getElementById('pm-inv-filter-client')?.value || '').trim();
  const fPm = String(document.getElementById('pm-inv-filter-pm')?.value || '').trim();
  const fDept = String(document.getElementById('pm-inv-filter-dept')?.value || '').trim();
  const fHq = String(document.getElementById('pm-inv-filter-hq')?.value || '').trim();
  const filterClientNorm = _pmNormText(fClient);
  const filterPmNorm = _pmNormText(fPm);
  const filteredProjects = (PM_STATE.projects || []).filter((proj) => {
    const meta = _pmInvoicePmAndTeam(proj);
    const clientNorm = _pmNormText(proj.client_name || '');
    const pmNorm = _pmNormText(meta.pmName || proj.cpm_user_name || '');
    if (filterClientNorm && !clientNorm.includes(filterClientNorm)) return false;
    if (filterPmNorm && !pmNorm.includes(filterPmNorm)) return false;
    if (fDept && String(meta.deptName || '').trim() !== fDept) return false;
    if (fHq && String(meta.hqName || '').trim() !== fHq) return false;
    return true;
  });
  const allowedCodes = new Set(filteredProjects.map((p) => String(p.project_code || '').trim()).filter(Boolean));
  try {
    let rows = await API.listAllPages('project_invoices', { limit: 500, maxPages: 20, sort: 'updated_at' }).catch(() => []);
    rows = rows.filter((r) => allowedCodes.has(String(r.project_code || '').trim()));
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
    const plannedRowsFromInvoice = rows
      .filter((r) => _pmMonthKey(r.planned_issue_date) === monthKey)
      .sort((a, b) => String(a.planned_issue_date || '').localeCompare(String(b.planned_issue_date || '')) || String(a.project_code || '').localeCompare(String(b.project_code || '')));
    const plannedInvoiceKeys = new Set(
      plannedRowsFromInvoice.map((r) => `${String(r.project_code || '').trim()}|${String(r.planned_issue_date || '').trim()}`)
    );
    const plannedRowsFromSchedule = [];
    filteredProjects.forEach((proj) => {
      const code = String(proj.project_code || '').trim();
      if (!code) return;
      const milestones = _pmCollectBillingMilestones(proj.billing_schedule);
      milestones.forEach((m) => {
        const due = String(m.due_date || '').trim();
        if (_pmMonthKey(due) !== monthKey) return;
        const key = `${code}|${due}`;
        if (plannedInvoiceKeys.has(key)) return;
        plannedRowsFromSchedule.push({
          id: '',
          project_code: code,
          client_name: String(proj.client_name || ''),
          project_name: String(proj.project_name || ''),
          planned_issue_date: due,
          invoice_amount: Number(m.amount || 0),
          issue_date: '',
          payment_status: '',
          _derived_status: 'planned',
          _source: 'billing_schedule',
        });
      });
    });
    const plannedRows = [...plannedRowsFromInvoice, ...plannedRowsFromSchedule]
      .sort((a, b) => String(a.planned_issue_date || '').localeCompare(String(b.planned_issue_date || '')) || String(a.project_code || '').localeCompare(String(b.project_code || '')));
    const issuedRows = rows
      .filter((r) => _pmMonthKey(r.issue_date) === monthKey)
      .sort((a, b) => String(b.issue_date || '').localeCompare(String(a.issue_date || '')) || String(a.project_code || '').localeCompare(String(b.project_code || '')));

    const detailCodes = [...new Set([...plannedRows, ...issuedRows].map((r) => String(r.project_code || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    PM_STATE.invoiceDetailProjectCodes = detailCodes;

    const plannedAmount = plannedRows.reduce((sum, r) => sum + Number(r.invoice_amount || 0), 0);
    const issuedAmount = issuedRows.reduce((sum, r) => sum + _pmInvoiceGrossAmount(r), 0);
    const delayedCount = plannedRows.filter((r) => _pmInvoicePlannedStatus(r, nowDate).key === 'delayed').length;
    const delayedRows = plannedRows.filter((r) => _pmInvoicePlannedStatus(r, nowDate).key === 'delayed');
    if (delayedRows.length) {
      _pmNotifyInvoiceDueDelays(delayedRows, monthKey).catch(() => {});
    }
    const overdueIssuedRows = rows.filter((r) => {
      const st = String(r._derived_status || r.payment_status || '').trim();
      return st === 'overdue' && String(r.issue_date || '').trim() && _pmMonthKey(r.issue_date) === monthKey;
    });
    if (overdueIssuedRows.length) {
      _pmNotifyInvoiceOverduePayments(overdueIssuedRows, monthKey).catch(() => {});
    }
    const completedPlannedCount = plannedRows.filter((r) => String(r.issue_date || '').trim()).length;
    const completionRate = plannedRows.length ? Math.round((completedPlannedCount / plannedRows.length) * 1000) / 10 : 0;

    const kpiPlannedCount = document.getElementById('pm-inv-kpi-planned-count');
    const kpiPlannedAmt = document.getElementById('pm-inv-kpi-planned-amt');
    const kpiIssuedCount = document.getElementById('pm-inv-kpi-issued-count');
    const kpiIssuedAmt = document.getElementById('pm-inv-kpi-issued-amt');
    const kpiRate = document.getElementById('pm-inv-kpi-rate');
    const kpiDelayed = document.getElementById('pm-inv-kpi-delayed-count');
    if (kpiPlannedCount) kpiPlannedCount.textContent = `${plannedRows.length}건`;
    if (kpiPlannedAmt) kpiPlannedAmt.textContent = _pmKrw(plannedAmount);
    if (kpiIssuedCount) kpiIssuedCount.textContent = `${issuedRows.length}건`;
    if (kpiIssuedAmt) kpiIssuedAmt.textContent = _pmKrw(issuedAmount);
    if (kpiRate) kpiRate.textContent = `${completionRate.toLocaleString('ko-KR')}%`;
    if (kpiDelayed) kpiDelayed.textContent = `${delayedCount}건`;

    if (!plannedRows.length) {
      plannedBody.innerHTML = '<tr><td colspan="10" class="table-empty"><i class="fas fa-calendar-check"></i><p>발행예정 내역이 없습니다.</p></td></tr>';
    } else {
      plannedBody.innerHTML = plannedRows.map((r, i) => {
        const code = String(r.project_code || '').trim();
        const proj = PM_STATE.projectByCode[code] || {};
        const meta = _pmInvoicePmAndTeam(proj);
        const plannedStatus = _pmInvoicePlannedStatus(r, nowDate);
        const requestedBy = String(r.issue_requested_by_name || '').trim() || '-';
        const reqRaw = Number(r.issue_requested_at || 0);
        const requestedAt = reqRaw ? _pmTsToDateText(reqRaw < 1e12 ? reqRaw * 1000 : reqRaw) : '-';
        const auditTitle = _pmEsc(_pmInvoiceAuditInfoText(r));
        return `<tr data-project-code="${_pmEsc(code)}">
          <td style="text-align:center">${i + 1}</td>
          <td>${_pmEsc(code || '-')}</td>
          <td class="pm-inv-list-col-client" title="${_pmEsc(r.client_name || proj.client_name || '')}">${_pmEsc(r.client_name || proj.client_name || '-')}</td>
          <td class="pm-inv-list-col-pm" title="${_pmEsc(meta.pmName)}">${_pmEsc(meta.pmName)}</td>
          <td style="text-align:center">${_pmEsc(r.planned_issue_date || '-')}</td>
          <td style="text-align:right">${_pmKrw(_pmInvoiceGrossAmount(r))}</td>
          <td title="${_pmEsc(requestedBy)}" style="text-align:center">${_pmInvoiceDisplayCell(requestedBy)}</td>
          <td style="text-align:center">${_pmInvoiceDisplayCell(requestedAt)}</td>
          <td style="text-align:center" title="${auditTitle}">${plannedStatus.badge}</td>
          <td style="text-align:center"><button type="button" class="btn btn-sm btn-ghost pm-inv-open-row" onclick="pmOpenInvoiceProjectDetail('${_pmEsc(code)}')" title="발행·입금 내역 보기" aria-label="발행·입금 내역 보기"><i class="fas fa-receipt" aria-hidden="true"></i></button></td>
        </tr>`;
      }).join('');
    }

    if (!issuedRows.length) {
      issuedBody.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-file-invoice"></i><p>당월 발행 내역이 없습니다.</p></td></tr>';
    } else {
      issuedBody.innerHTML = issuedRows.map((r, i) => {
        const code = String(r.project_code || '').trim();
        const proj = PM_STATE.projectByCode[code] || {};
        const payStatus = _pmInvoicePaymentStatusBadge(r._derived_status || r.payment_status || '');
        const auditTitle = _pmEsc(_pmInvoiceAuditInfoText(r));
        return `<tr data-project-code="${_pmEsc(code)}">
          <td style="text-align:center">${i + 1}</td>
          <td style="text-align:center">${_pmEsc(code || '-')}</td>
          <td class="pm-inv-list-col-client" title="${_pmEsc(r.client_name || proj.client_name || '')}">${_pmEsc(r.client_name || proj.client_name || '-')}</td>
          <td style="text-align:center">${_pmEsc(r.issue_date || '-')}</td>
          <td style="text-align:center" title="${_pmEsc(r.invoice_no || '')}">${_pmEsc(r.invoice_no || '-')}</td>
          <td style="text-align:right">${_pmKrw(_pmInvoiceGrossAmount(r))}</td>
          <td style="text-align:center" title="${auditTitle}">${payStatus}</td>
          <td style="text-align:center"><button type="button" class="btn btn-sm btn-ghost pm-inv-open-row" onclick="pmOpenInvoiceProjectDetail('${_pmEsc(code)}')" title="발행·입금 내역 보기" aria-label="발행·입금 내역 보기"><i class="fas fa-receipt" aria-hidden="true"></i></button></td>
        </tr>`;
      }).join('');
    }

    const summaryEl = document.getElementById('pm-inv-summary');
    if (summaryEl) summaryEl.textContent = `${monthKey} · 예정 ${plannedRows.length}건 / 발행 ${issuedRows.length}건`;
    _pmRenderInvoiceQualitySummary(rows);
    _pmApplyInvoiceAlertContext();
    if (canIssue) _pmRunNtsAutoIssue().catch((e) => console.warn('[pm] nts auto issue', e));
  } catch (e) {
    console.error(e);
    plannedBody.innerHTML = '<tr><td colspan="10" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>조회 실패</p></td></tr>';
    issuedBody.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>조회 실패</p></td></tr>';
  }
}

async function pmAddInvoicePayment(id) {
  const invId = String(id || '').trim();
  const tr = document.querySelector(`tr[data-invoice-id="${invId}"]`);
  if (!invId || !tr) return;
  const session = getSession ? getSession() : null;
  if (!_pmCanIssueInvoice(session)) {
    Toast.warning('입금등록은 경영지원팀만 가능합니다.');
    return;
  }
  const projectCode = String(tr.dataset.projectCode || PM_STATE.invoiceDetailProjectCode || '').trim();
  const invoiceAmount = Math.max(0, Number(tr.dataset.invoiceAmount || 0));
  const paidEl = tr.querySelector('[data-f="paid"]');
  const currentPaid = _pmParseAmountInput(paidEl?.value || 0);
  const outstanding = Math.max(0, invoiceAmount - currentPaid);
  if (!(invoiceAmount > 0)) {
    Toast.warning('발행금액 정보가 없어 입금등록할 수 없습니다.');
    return;
  }
  if (outstanding <= 0) {
    Toast.success('이미 전액 입금된 건입니다.');
    return;
  }
  const amountInput = window.prompt(`입금금액을 입력하세요. (현재 미수금 ${_pmKrw(outstanding)})`, outstanding.toLocaleString('ko-KR'));
  if (amountInput == null) return;
  const addAmount = _pmParseAmountInput(amountInput);
  if (!(addAmount > 0)) {
    Toast.warning('입금금액은 0보다 커야 합니다.');
    return;
  }
  if (addAmount > outstanding) {
    Toast.warning(`입금금액은 미수금 이내여야 합니다. (미수금 ${_pmKrw(outstanding)})`);
    return;
  }
  const paidDateInput = String(window.prompt('입금일자를 입력하세요. (YYYY-MM-DD)', _pmTodayDateText()) || '').trim();
  const paidDate = /^\d{4}-\d{2}-\d{2}$/.test(paidDateInput) ? paidDateInput : '';
  if (!paidDate) {
    Toast.warning('입금일자 형식이 올바르지 않습니다. (YYYY-MM-DD)');
    return;
  }
  const memo = String(window.prompt('입금 메모를 입력하세요. (선택)', '') || '').trim();
  try {
    await API.create('project_invoice_payments', {
      invoice_id: invId,
      project_code: projectCode,
      paid_date: paidDate,
      paid_amount: addAmount,
      note: memo,
      created_by: String(session?.id || session?.user_id || ''),
      created_by_name: String(session?.name || session?.user_name || ''),
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    const nextPaid = currentPaid + addAmount;
    const nextOutstanding = Math.max(0, invoiceAmount - nextPaid);
    const dueDateRaw = String(tr.dataset.dueDate || '').trim();
    const overdue = dueDateRaw && dueDateRaw < _pmTodayDateText() && nextOutstanding > 0;
    const nextStatus = nextOutstanding <= 0 ? 'paid' : (overdue ? 'overdue' : 'partially_paid');
    const confirmedAt = Date.now();
    await API.patch('project_invoices', invId, {
      paid_amount: nextPaid,
      outstanding_amount: nextOutstanding,
      paid_date: paidDate,
      paid_at: confirmedAt,
      payment_status: nextStatus,
      payment_note: memo || String(tr.dataset.note || ''),
      payment_confirmed_at: confirmedAt,
      payment_confirmed_by: String(session?.id || session?.user_id || ''),
      payment_confirmed_by_name: String(session?.name || session?.user_name || ''),
    });
    await _pmSyncLinkedCostBillingStatus(invId, nextStatus);
    if (nextOutstanding > 0) {
      await _pmNotifyInvoiceShortPayment({
        id: invId,
        project_code: projectCode,
        client_name: String(PM_STATE.projectByCode[projectCode]?.client_name || '').trim(),
        expected_payment_date: dueDateRaw,
        due_date: dueDateRaw,
      }, nextPaid, nextOutstanding, invoiceAmount);
    }
    await _pmSyncProjectSettlementStatus(projectCode);
    Toast.success('입금 이력을 등록했습니다.');
    await loadProjectMgmtInvoices();
    await _pmLoadInvoiceProjectDetail(projectCode);
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (msg.toLowerCase().includes('project_invoice_payments')) {
      Toast.error('입금 이력 테이블이 없습니다. SQL 스크립트를 먼저 적용해 주세요.');
      return;
    }
    console.error(e);
    Toast.error('입금 이력 등록 실패: ' + msg);
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
    const paid = _pmParseAmountInput(tr.querySelector('[data-f="paid"]')?.value || 0);
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
    const expectedFromIssue = _pmAddDays(issueDateInput, 60);
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
    await _pmSyncLinkedCostBillingStatus(id, status);
    if (status === 'issued') {
      await issueTaxInvoice(id, PM_NTS_DEFAULT_MODE);
    }
    if (canIssue) {
      await _pmSyncProjectSettlementStatus(projectCode);
    }
    if (outstanding > 0 && paid < invoiceAmount) {
      await _pmNotifyInvoiceShortPayment({
        id,
        project_code: projectCode,
        client_name: String(PM_STATE.projectByCode[projectCode]?.client_name || '').trim(),
        expected_payment_date: dueDate || String(tr.dataset.dueDate || '').trim(),
        due_date: dueDate || String(tr.dataset.dueDate || '').trim(),
      }, paid, outstanding, invoiceAmount);
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
  const totalOutstanding = scoped.reduce((s, r) => s + _pmInvoiceOutstandingAmount(r), 0);
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
    const totalOutstanding = scoped.reduce((s, r) => s + _pmInvoiceOutstandingAmount(r), 0);
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
        paid_amount: _pmInvoiceGrossAmount(r),
        outstanding_amount: 0,
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
      const resolvedInvoiceNo = String(invoice.invoice_no || '').trim() || _pmPickInvoiceNoFromNtsResponse(rpcRes);
      await API.patch('project_invoices', invId, {
        nts_issue_status: 'issued',
        nts_issue_processed_at: Date.now(),
        nts_issue_processed_by: String(session?.id || ''),
        nts_issue_processed_by_name: String(session?.name || ''),
        nts_attempt_count: attemptNo,
        nts_last_error: '',
        nts_tx_id: String(rpcRes.tx_id || rpcRes.issue_id || ''),
        invoice_no: resolvedInvoiceNo,
        issue_date: String(invoice.issue_date || '').trim() || _pmTodayDateText(),
        expected_payment_date: String(invoice.expected_payment_date || invoice.due_date || '').trim() || (_pmAddDays(_pmTodayDateText(), 60) || _pmTodayDateText()),
        due_date: String(invoice.expected_payment_date || invoice.due_date || '').trim() || (_pmAddDays(_pmTodayDateText(), 60) || _pmTodayDateText()),
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
        await issueTaxInvoice(r.id, PM_NTS_MODES.LIVE);
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
    const res = await issueTaxInvoice(id, PM_NTS_MODES.LIVE);
    if (res && res.issued) Toast.success('국세청 전송 완료');
    else Toast.success('국세청 전송요청 큐에 등록되었습니다.');
    await loadProjectMgmtInvoices();
  } catch (e) {
    Toast.error(e.message || '국세청 전송 실패');
  }
}

async function pmDownloadMonthlyLaborTemplate() {
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('엑셀 라이브러리를 불러오지 못했습니다.');
    return;
  }
  const ym = _pmCostUploadMonth() || _pmNowMonth();
  const wb = XLSX.utils.book_new();
  const rows = (PM_STATE.users || [])
    .filter((u) => String(u.role || '').trim() === 'staff')
    .slice(0, 20)
    .map((u) => ({ 이름: u.name || '', '월 인건비(원)': '', 비고: '' }));
  if (!rows.length) rows.push({ 이름: '홍길동', '월 인건비(원)': 5000000, 비고: '예시' });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, `직접인건비_${ym}`);
  const guide = XLSX.utils.json_to_sheet([
    { 항목: 'A열', 설명: '직원 이름 (시스템 등록명과 일치)' },
    { 항목: 'B열', 설명: '월 인건비(원, 숫자)' },
    { 항목: 'C열', 설명: '비고(선택)' },
  ]);
  guide['!cols'] = [{ wch: 10 }, { wch: 56 }];
  XLSX.utils.book_append_sheet(wb, guide, '입력안내');
  await xlsxDownload(wb, `월직접인건비_업로드양식_${ym}.xlsx`);
}

async function pmDownloadMonthlyIndirectTemplate() {
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('엑셀 라이브러리를 불러오지 못했습니다.');
    return;
  }
  const ym = _pmCostUploadMonth() || _pmNowMonth();
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { 항목: '전사공통비', '월 간접비(원)': 12000000, 비고: '예시' },
  ]);
  ws['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, `간접비_${ym}`);
  const guide = XLSX.utils.json_to_sheet([
    { 항목: 'A열', 설명: '항목명(자유기입)' },
    { 항목: 'B열', 설명: '월 간접비(원, 숫자)' },
    { 항목: 'C열', 설명: '비고(선택)' },
  ]);
  guide['!cols'] = [{ wch: 10 }, { wch: 56 }];
  XLSX.utils.book_append_sheet(wb, guide, '입력안내');
  await xlsxDownload(wb, `월간접비_업로드양식_${ym}.xlsx`);
}

async function pmDownloadProjectDirectCostTemplate() {
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('엑셀 라이브러리를 불러오지 못했습니다.');
    return;
  }
  const ym = _pmCostUploadMonth() || _pmNowMonth();
  const wb = XLSX.utils.book_new();
  const sampleCode = String((PM_STATE.projects[0] && PM_STATE.projects[0].project_code) || 'PJT-001');
  const ws = XLSX.utils.json_to_sheet([
    { 프로젝트코드: sampleCode, 비용유형: '직접비용', 거래처: '외주업체', 공급가액: 3000000, 부가세: 300000, 비고: '청구 지급 반영' },
  ]);
  ws['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, ws, `직접비용_${ym}`);
  const guide = XLSX.utils.json_to_sheet([
    { 항목: '프로젝트코드', 설명: '필수. 등록된 프로젝트 코드' },
    { 항목: '비용유형', 설명: '직접비용(기본값). 예: 외주, 출장, 구매' },
    { 항목: '거래처', 설명: '선택' },
    { 항목: '공급가액', 설명: '숫자 필수' },
    { 항목: '부가세', 설명: '숫자 선택 (없으면 0)' },
    { 항목: '비고', 설명: '선택' },
  ]);
  guide['!cols'] = [{ wch: 12 }, { wch: 56 }];
  XLSX.utils.book_append_sheet(wb, guide, '입력안내');
  await xlsxDownload(wb, `프로젝트직접비용_업로드양식_${ym}.xlsx`);
}

async function pmUploadMonthlyLaborCostExcel(input) {
  const file = input && input.files ? input.files[0] : null;
  if (input) input.value = '';
  if (!file) return;
  const session = getSession();
  if (!(Auth.canApprove1st(session) || Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session))) {
    Toast.warning('업로드 권한이 없습니다.');
    return;
  }
  const ym = _pmCostUploadMonth();
  if (!ym) {
    Toast.warning('배부기준월을 먼저 선택하세요.');
    return;
  }
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('엑셀 라이브러리를 불러오지 못했습니다.');
    return;
  }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = _pmParseXlsxRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
    if (!rows.length) {
      _pmCostUploadMessage('error', '엑셀 데이터가 없습니다.');
      return;
    }
    const userByName = {};
    (PM_STATE.users || []).forEach((u) => { userByName[String(u.name || '').trim()] = u; });
    const monthlyCostByUser = {};
    const unknownUsers = [];
    rows.forEach((r) => {
      const vals = Object.values(r);
      const name = String(r['이름'] || r['담당자'] || r['직원'] || vals[0] || '').trim();
      const amount = _pmParseMoney(r['월 인건비(원)'] ?? r['월인건비'] ?? r['금액'] ?? vals[1]);
      if (!name || !(amount > 0)) return;
      const u = userByName[name];
      if (!u) {
        unknownUsers.push(name);
        return;
      }
      monthlyCostByUser[String(u.id)] = (monthlyCostByUser[String(u.id)] || 0) + amount;
    });
    const userIds = Object.keys(monthlyCostByUser);
    if (!userIds.length) {
      _pmCostUploadMessage('warning', '매칭된 직원 인건비가 없습니다. 이름 컬럼을 확인하세요.');
      return;
    }
    let tcRows = await API.listAllPages('project_timecharge_lines', { limit: 4000, maxPages: 50, sort: 'work_date' }).catch(() => []);
    const allowedCodes = new Set((PM_STATE.projects || []).map((p) => String(p.project_code || '').trim()).filter(Boolean));
    tcRows = tcRows.filter((r) => {
      const code = String(r.project_code || '').trim();
      const workDate = String(r.work_date || '').slice(0, 10);
      return allowedCodes.has(code) && _pmDateToYm(workDate) === ym;
    });
    const userTotalMin = {};
    const userProjectMin = {};
    tcRows.forEach((r) => {
      const uid = String(r.user_id || '').trim();
      if (!uid || !monthlyCostByUser[uid]) return;
      const code = String(r.project_code || '').trim();
      const mins = Number(r.final_minutes || r.base_minutes || 0);
      if (!(mins > 0) || !code) return;
      userTotalMin[uid] = (userTotalMin[uid] || 0) + mins;
      if (!userProjectMin[uid]) userProjectMin[uid] = {};
      userProjectMin[uid][code] = (userProjectMin[uid][code] || 0) + mins;
    });
    const allocByCode = {};
    let unallocated = 0;
    userIds.forEach((uid) => {
      const cost = Number(monthlyCostByUser[uid] || 0);
      const totalMin = Number(userTotalMin[uid] || 0);
      if (!(cost > 0)) return;
      if (!(totalMin > 0)) {
        unallocated += cost;
        return;
      }
      const byProject = userProjectMin[uid] || {};
      Object.entries(byProject).forEach(([code, mins]) => {
        allocByCode[code] = (allocByCode[code] || 0) + (cost * Number(mins || 0) / totalMin);
      });
    });
    const deleted = await _pmDeleteAutoRowsByTag(ym, 'DLAB');
    const created = await _pmCreateAllocatedProjectCostRows({
      ym,
      tag: 'DLAB',
      costType: '직접인건비',
      amountByCode: allocByCode,
      noteTail: '월 직접인건비 배부',
    });
    await loadProjectMgmtCosts();
    const msg = `월 직접인건비 배부 반영 완료 · 생성 ${created}건${deleted ? ` · 기존자동삭제 ${deleted}건` : ''}${unallocated > 0 ? ` · 미배부 ${_pmKrw(unallocated)}` : ''}${unknownUsers.length ? `<br>미일치 이름: ${_pmEsc([...new Set(unknownUsers)].join(', '))}` : ''}`;
    _pmCostUploadMessage(unknownUsers.length || unallocated > 0 ? 'warning' : 'success', msg);
    Toast.success(`월 직접인건비 배부 ${created}건 반영`);
  } catch (e) {
    console.error(e);
    _pmCostUploadMessage('error', `업로드 실패: ${_pmEsc(e.message || '')}`);
    Toast.error('월 직접인건비 업로드 실패');
  }
}

async function pmUploadMonthlyIndirectCostExcel(input) {
  const file = input && input.files ? input.files[0] : null;
  if (input) input.value = '';
  if (!file) return;
  const session = getSession();
  if (!(Auth.canApprove1st(session) || Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session))) {
    Toast.warning('업로드 권한이 없습니다.');
    return;
  }
  const ym = _pmCostUploadMonth();
  if (!ym) {
    Toast.warning('배부기준월을 먼저 선택하세요.');
    return;
  }
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('엑셀 라이브러리를 불러오지 못했습니다.');
    return;
  }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = _pmParseXlsxRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
    const totalIndirect = rows.reduce((sum, r) => {
      const vals = Object.values(r);
      const amount = _pmParseMoney(r['월 간접비(원)'] ?? r['월간접비'] ?? r['금액'] ?? vals[1]);
      return sum + (amount > 0 ? amount : 0);
    }, 0);
    if (!(totalIndirect > 0)) {
      _pmCostUploadMessage('warning', '배부할 월 간접비 금액이 없습니다.');
      return;
    }
    let tcRows = await API.listAllPages('project_timecharge_lines', { limit: 4000, maxPages: 50, sort: 'work_date' }).catch(() => []);
    const allowedCodes = new Set((PM_STATE.projects || []).map((p) => String(p.project_code || '').trim()).filter(Boolean));
    tcRows = tcRows.filter((r) => {
      const code = String(r.project_code || '').trim();
      const workDate = String(r.work_date || '').slice(0, 10);
      return allowedCodes.has(code) && _pmDateToYm(workDate) === ym;
    });
    const totalMin = tcRows.reduce((sum, r) => sum + Number(r.final_minutes || r.base_minutes || 0), 0);
    if (!(totalMin > 0)) {
      _pmCostUploadMessage('warning', '해당 월 타임차지 시간이 없어 간접비 배부를 수행할 수 없습니다.');
      return;
    }
    const minsByCode = {};
    tcRows.forEach((r) => {
      const code = String(r.project_code || '').trim();
      if (!code) return;
      minsByCode[code] = (minsByCode[code] || 0) + Number(r.final_minutes || r.base_minutes || 0);
    });
    const allocByCode = {};
    Object.entries(minsByCode).forEach(([code, mins]) => {
      allocByCode[code] = totalIndirect * Number(mins || 0) / totalMin;
    });
    const deleted = await _pmDeleteAutoRowsByTag(ym, 'INDR');
    const created = await _pmCreateAllocatedProjectCostRows({
      ym,
      tag: 'INDR',
      costType: '간접비',
      amountByCode: allocByCode,
      noteTail: '월 간접비 배부',
    });
    await loadProjectMgmtCosts();
    _pmCostUploadMessage('success', `월 간접비 배부 반영 완료 · 생성 ${created}건${deleted ? ` · 기존자동삭제 ${deleted}건` : ''}`);
    Toast.success(`월 간접비 배부 ${created}건 반영`);
  } catch (e) {
    console.error(e);
    _pmCostUploadMessage('error', `업로드 실패: ${_pmEsc(e.message || '')}`);
    Toast.error('월 간접비 업로드 실패');
  }
}

async function pmUploadProjectDirectCostExcel(input) {
  const file = input && input.files ? input.files[0] : null;
  if (input) input.value = '';
  if (!file) return;
  const session = getSession();
  if (!(Auth.canApprove1st(session) || Auth.isDirector(session) || Auth.isTopMgr(session) || Auth.isAdmin(session))) {
    Toast.warning('업로드 권한이 없습니다.');
    return;
  }
  const ym = _pmCostUploadMonth();
  if (!ym) {
    Toast.warning('배부기준월을 먼저 선택하세요.');
    return;
  }
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('엑셀 라이브러리를 불러오지 못했습니다.');
    return;
  }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = _pmParseXlsxRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
    if (!rows.length) {
      _pmCostUploadMessage('warning', '엑셀 데이터가 없습니다.');
      return;
    }
    const deleted = await _pmDeleteAutoRowsByTag(ym, 'DEXP');
    let created = 0;
    let skipped = 0;
    let laborSkipped = 0;
    const unknownCodes = [];
    for (const r of rows) {
      const vals = Object.values(r);
      const code = String(r['프로젝트코드'] || r['project_code'] || vals[0] || '').trim();
      const typeInput = String(r['비용유형'] || r['cost_type'] || vals[1] || '직접비용').trim();
      const vendor = String(r['거래처'] || r['vendor'] || vals[2] || '').trim();
      const amount = _pmParseMoney(r['공급가액'] ?? r['amount'] ?? vals[3]);
      const vat = _pmParseMoney(r['부가세'] ?? r['vat'] ?? vals[4]);
      const note = String(r['비고'] || r['note'] || vals[5] || '').trim();
      if (!code || (amount <= 0 && vat <= 0)) {
        skipped += 1;
        continue;
      }
      if (_pmIsLaborCostType(typeInput)) {
        laborSkipped += 1;
        skipped += 1;
        continue;
      }
      if (!_pmHasProjectAccess(code)) {
        unknownCodes.push(code);
        skipped += 1;
        continue;
      }
      const p = PM_STATE.projectByCode[code] || {};
      const total = amount + vat;
      await API.create('project_cost_items', {
        project_id: p.id || '',
        project_code: code,
        project_name: p.project_name || '',
        client_id: p.client_id || '',
        client_name: p.client_name || '',
        cost_date: `${ym}-01`,
        cost_type: _pmCostTypeNorm(typeInput),
        vendor: vendor || '직접비용업로드',
        amount,
        vat,
        total_amount: total,
        cost_purpose: 'internal',
        billable_amount: 0,
        billable_currency: 'KRW',
        billable_fx_amount: 0,
        billing_status: 'excluded',
        note: `[AUTO_COST_ALLOC:DEXP:${ym}] ${note}`.trim(),
        created_by: session && session.id ? session.id : '',
        created_by_name: session && session.name ? session.name : '',
      });
      created += 1;
    }
    await loadProjectMgmtCosts();
    const uniqUnknown = [...new Set(unknownCodes)];
    const msg = `프로젝트 직접비용 반영 완료 · 생성 ${created}건${deleted ? ` · 기존자동삭제 ${deleted}건` : ''}${skipped ? ` · 스킵 ${skipped}행` : ''}${laborSkipped ? ` · 인건비행 이관 ${laborSkipped}행` : ''}${uniqUnknown.length ? `<br>미존재/권한없음 코드: ${_pmEsc(uniqUnknown.join(', '))}` : ''}`;
    _pmCostUploadMessage(uniqUnknown.length || laborSkipped > 0 ? 'warning' : 'success', msg);
    Toast.success(`프로젝트 직접비용 ${created}건 반영`);
  } catch (e) {
    console.error(e);
    _pmCostUploadMessage('error', `업로드 실패: ${_pmEsc(e.message || '')}`);
    Toast.error('프로젝트 직접비용 업로드 실패');
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
  const costTypeInput = String(document.getElementById('pm-cost-type')?.value || '').trim();
  const costPurpose = _pmCostPurposeNorm(document.getElementById('pm-cost-purpose')?.value || 'internal');
  const billableAmountInput = Number(document.getElementById('pm-cost-billable-amount')?.value || 0);
  const billableCurrency = String(document.getElementById('pm-cost-billable-currency')?.value || 'KRW').trim() || 'KRW';
  const billableFxAmount = Number(document.getElementById('pm-cost-billable-fx')?.value || 0);
  const billingStatusInput = _pmBillingStatusNorm(document.getElementById('pm-cost-billing-status')?.value || 'unbilled');
  const noteInput = String(document.getElementById('pm-cost-note')?.value || '').trim();
  const billableAmount = Math.max(0, billableAmountInput);
  const fxAmount = Math.max(0, billableFxAmount);
  const billingStatus = (costPurpose === 'internal') ? 'excluded' : billingStatusInput;
  if (amount <= 0 && vat <= 0) {
    Toast.warning('비용 금액을 입력하세요.');
    return;
  }
  if (costPurpose !== 'internal' && billableAmount <= 0 && fxAmount <= 0) {
    Toast.warning('고객청구/공통 목적은 청구대상금액(원화 또는 외화)을 입력하세요.');
    return;
  }
  if (_pmIsLaborCostType(costTypeInput)) {
    Toast.warning('인건비는 Analysis 탭에서만 관리합니다.');
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
      cost_type: costTypeInput || '',
      vendor: document.getElementById('pm-cost-vendor')?.value || '',
      amount,
      vat,
      total_amount: total,
      cost_purpose: costPurpose,
      billable_amount: billableAmount,
      billable_currency: billableCurrency,
      billable_fx_amount: fxAmount,
      billing_status: billingStatus,
      billing_note: noteInput,
      linked_invoice_id: '',
      note: noteInput,
      created_by: session.id,
      created_by_name: session.name || '',
    });
    document.getElementById('pm-cost-amount').value = '';
    document.getElementById('pm-cost-vat').value = '';
    document.getElementById('pm-cost-type').value = '';
    document.getElementById('pm-cost-vendor').value = '';
    document.getElementById('pm-cost-purpose').value = 'internal';
    document.getElementById('pm-cost-billable-amount').value = '';
    document.getElementById('pm-cost-billable-currency').value = 'KRW';
    document.getElementById('pm-cost-billable-fx').value = '';
    document.getElementById('pm-cost-billing-status').value = 'unbilled';
    document.getElementById('pm-cost-note').value = '';
    Toast.success('비용 항목을 추가했습니다.');
    await loadProjectMgmtCosts();
  } catch (e) {
    console.error(e);
    Toast.error('비용 저장 실패: ' + (e.message || ''));
  }
}

function _pmExpenseRowsByProject(projectCode) {
  const code = String(projectCode || '').trim();
  return (PM_STATE.expenseRows || []).filter((r) => String(r.project_code || '').trim() === code);
}

function _pmCustomerInvoiceMonthToken(billingMonth) {
  const m = String(billingMonth || '').trim();
  if (/^\d{4}-\d{2}$/.test(m)) return m.replace('-', '');
  return _pmNowMonth().replace('-', '');
}

function _pmCustomerInvoiceDocNo(projectCode, billingMonth, seq = 1) {
  const code = String(projectCode || '').trim() || 'PJT';
  const token = _pmCustomerInvoiceMonthToken(billingMonth);
  const no = Math.max(1, Number(seq || 1));
  return `CINV-${code}-${token}-${String(no).padStart(3, '0')}`;
}

async function _pmCustomerInvoiceNextSeq(projectCode, billingMonth) {
  const code = String(projectCode || '').trim();
  const month = String(billingMonth || '').trim();
  if (!code || !month) return 1;
  try {
    const rows = await API.listAllPages('project_customer_invoice_documents', {
      filter: `project_code=eq.${encodeURIComponent(code)}&billing_month=eq.${encodeURIComponent(month)}`,
      limit: 1000,
      maxPages: 10,
      sort: 'updated_at',
    }).catch(() => []);
    const token = _pmCustomerInvoiceMonthToken(month);
    const codeEsc = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`^CINV-${codeEsc}-${token}-(\\d{3,})$`);
    let maxSeq = 0;
    (rows || []).forEach((r) => {
      const docNo = String(r?.document_no || '').trim();
      const m = docNo.match(rx);
      if (!m) return;
      const n = Number(m[1] || 0);
      if (n > maxSeq) maxSeq = n;
    });
    return maxSeq + 1;
  } catch (_) {
    return 1;
  }
}

function _pmCustomerInvoiceRowsFromProject(projectCode) {
  const code = String(projectCode || '').trim();
  const rows = _pmExpenseRowsByProject(code);
  return rows
    .filter((r) => !!r.is_billable && _pmExpenseBillingStatusNorm(r.billing_status) !== 'excluded')
    .sort(_pmExpenseRowSortCompare)
    .map((r, i) => ({
      seq: i + 1,
      expense_id: String(r.id || '').trim(),
      expense_date: String(r.expense_date || '').trim(),
      expense_type: String(r.expense_type || '').trim(),
      amount: Math.max(0, Number(r.amount || 0)),
      detail: String(r.vendor || '').trim(),
      note: String(r.note || '').trim(),
      note_append: '',
    }));
}

function _pmCustomerInvoiceMergedRows(draft) {
  return (draft?.rows || []).map((r, i) => {
    const append = String(r.note_append || '').trim();
    const mergedNote = [String(r.note || '').trim(), append].filter(Boolean).join(' / ');
    return {
      seq: i + 1,
      expense_id: r.expense_id || '',
      expense_date: r.expense_date || '',
      expense_type: r.expense_type || '',
      amount: Math.max(0, Number(r.amount || 0)),
      detail: r.detail || '',
      note: mergedNote,
      note_append: append,
    };
  });
}

function _pmRenderCustomerInvoicePreview() {
  const draft = PM_STATE.customerInvoiceDraft;
  const previewEl = document.getElementById('pm-cinv-preview');
  const summaryEl = document.getElementById('pm-cinv-summary');
  if (!draft || !previewEl) return;
  const mergedRows = _pmCustomerInvoiceMergedRows(draft);
  const supplyAmount = mergedRows.reduce((sum, r) => sum + Math.max(0, Number(r.amount || 0)), 0);
  if (summaryEl) summaryEl.textContent = '';
  const invoice = {
    project_code: draft.project_code,
    project_name: draft.project_name,
    client_name: draft.client_name,
    billing_month: draft.billing_month,
    planned_issue_date: draft.doc_date,
    expected_payment_date: '',
    recipient_name: draft.recipient_name || '',
    recipient_email: draft.recipient_email || '',
    supply_amount: supplyAmount,
    vat_amount: 0,
    total_amount: supplyAmount,
    item_name: draft.project_name || '고객청구서',
    legal_note: draft.note || '',
    invoice_items: mergedRows.map((r) => ({
      name: r.expense_type || '비용',
      cost_date: r.expense_date || '',
      supply_amount: Math.max(0, Number(r.amount || 0)),
      detail: r.detail || '',
      note: r.note || '',
    })),
  };
  previewEl.innerHTML = _pmRenderCustomerInvoiceHtml(invoice);
}

function _pmRenderCustomerInvoiceRows() {
  const body = document.getElementById('pm-cinv-body');
  const draft = PM_STATE.customerInvoiceDraft;
  if (!body || !draft) return;
  if (!draft.rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="table-empty"><i class="fas fa-file-invoice"></i><p>청구 대상 항목이 없습니다.</p></td></tr>';
    _pmRenderCustomerInvoicePreview();
    return;
  }
  body.innerHTML = draft.rows.map((r, i) => `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${_pmEsc(r.expense_date || '')}</td>
      <td>${_pmEsc(r.expense_type || '')}</td>
      <td style="text-align:right">${_pmKrw(r.amount || 0)}</td>
      <td title="${_pmEsc(r.detail || '')}">${_pmEsc(r.detail || '')}</td>
      <td><input type="text" class="form-control" data-cinv-note-idx="${i}" value="${_pmEsc(r.note_append || '')}" placeholder="추가 비고" /></td>
    </tr>
  `).join('');
  _pmRenderCustomerInvoicePreview();
}

function pmCloseCustomerInvoiceEditor() {
  const modal = document.getElementById('pm-cinv-modal');
  const backdrop = document.getElementById('pm-cinv-backdrop');
  if (modal) modal.style.display = 'none';
  if (backdrop) backdrop.style.display = 'none';
  PM_STATE.customerInvoiceDraft = null;
  document.body.style.overflow = '';
}

async function pmOpenCustomerInvoiceEditor(projectCode) {
  _pmEnsureCustomerInvoiceModalPortal();
  const code = String(projectCode || PM_STATE.expenseSummarySelectedCode || '').trim();
  if (!code) {
    Toast.warning('프로젝트를 먼저 선택하세요.');
    return;
  }
  PM_STATE.expenseSummarySelectedCode = code;
  _pmRenderExpenseSummaryTable();
  _pmRenderExpenseDetailTable();
  const rows = _pmCustomerInvoiceRowsFromProject(code);
  if (!rows.length) {
    Toast.warning('청구대상 항목이 없어 고객청구서를 만들 수 없습니다.');
    return;
  }
  const project = PM_STATE.projectByCode[code] || {};
  const firstDate = String((rows[0] || {}).expense_date || '').trim();
  const billingMonth = /^\d{4}-\d{2}/.test(firstDate) ? firstDate.slice(0, 7) : _pmNowMonth();
  const nextSeq = await _pmCustomerInvoiceNextSeq(code, billingMonth);
  PM_STATE.customerInvoiceDraft = {
    project_code: code,
    project_name: String(project.project_name || ''),
    client_name: String(project.client_name || ''),
    billing_month: billingMonth,
    doc_no: _pmCustomerInvoiceDocNo(code, billingMonth, nextSeq),
    doc_no_auto: true,
    doc_date: _pmTodayDateText(),
    recipient_name: '',
    recipient_email: '',
    note: '',
    status: 'draft',
    rows,
    saved_id: '',
  };
  const subtitle = document.getElementById('pm-cinv-subtitle');
  const docNoEl = document.getElementById('pm-cinv-doc-no');
  const docDateEl = document.getElementById('pm-cinv-doc-date');
  const monthEl = document.getElementById('pm-cinv-billing-month');
  const recipientNameEl = document.getElementById('pm-cinv-recipient-name');
  const recipientEmailEl = document.getElementById('pm-cinv-recipient-email');
  const noteEl = document.getElementById('pm-cinv-note');
  const statusEl = document.getElementById('pm-cinv-status');
  if (subtitle) subtitle.textContent = `${code} · ${project.client_name || '-'} · 청구목록 문서화`;
  if (docNoEl) docNoEl.value = PM_STATE.customerInvoiceDraft.doc_no;
  if (docDateEl) docDateEl.value = PM_STATE.customerInvoiceDraft.doc_date;
  if (monthEl) monthEl.value = PM_STATE.customerInvoiceDraft.billing_month;
  if (recipientNameEl) recipientNameEl.value = PM_STATE.customerInvoiceDraft.recipient_name || '';
  if (recipientEmailEl) recipientEmailEl.value = PM_STATE.customerInvoiceDraft.recipient_email || '';
  if (noteEl) noteEl.value = PM_STATE.customerInvoiceDraft.note;
  if (statusEl) statusEl.value = '임시작성';
  _pmRenderCustomerInvoiceRows();
  const modal = document.getElementById('pm-cinv-modal');
  const backdrop = document.getElementById('pm-cinv-backdrop');
  const modalBody = modal ? modal.querySelector('.pm-cinv-body') : null;
  if (modal) {
    // 캐시/스타일 충돌이 있어도 항상 상단 고정형으로 표시
    modal.style.left = '50%';
    modal.style.top = (window.innerWidth <= 920 ? '10px' : '20px');
    modal.style.transform = 'translateX(-50%)';
    modal.style.width = window.innerWidth <= 920 ? 'calc(100vw - 16px)' : 'min(1180px, calc(100vw - 32px))';
    modal.style.height = window.innerWidth <= 920 ? 'calc(100vh - 20px)' : 'calc(100vh - 40px)';
    modal.style.maxHeight = modal.style.height;
    modal.style.display = 'flex';
    modal.scrollTop = 0;
  }
  if (backdrop) backdrop.style.display = 'block';
  if (modalBody) modalBody.scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function _pmCustomerInvoiceSyncDraftFromForm() {
  const draft = PM_STATE.customerInvoiceDraft;
  if (!draft) return null;
  const docNoInput = String(document.getElementById('pm-cinv-doc-no')?.value || '').trim();
  if (docNoInput) {
    draft.doc_no = docNoInput;
  } else if (!draft.doc_no) {
    draft.doc_no = _pmCustomerInvoiceDocNo(draft.project_code, draft.billing_month, 1);
    draft.doc_no_auto = true;
  }
  draft.doc_date = String(document.getElementById('pm-cinv-doc-date')?.value || '').trim() || _pmTodayDateText();
  draft.billing_month = String(document.getElementById('pm-cinv-billing-month')?.value || '').trim() || _pmNowMonth();
  draft.recipient_name = String(document.getElementById('pm-cinv-recipient-name')?.value || '').trim();
  draft.recipient_email = String(document.getElementById('pm-cinv-recipient-email')?.value || '').trim().toLowerCase();
  draft.note = String(document.getElementById('pm-cinv-note')?.value || '').trim();
  return draft;
}

async function pmRefreshCustomerInvoiceAutoDocNo() {
  const draft = _pmCustomerInvoiceSyncDraftFromForm();
  if (!draft) return;
  if (draft.saved_id) return;
  if (draft.doc_no_auto === false && String(draft.doc_no || '').trim()) return;
  const seq = await _pmCustomerInvoiceNextSeq(draft.project_code, draft.billing_month);
  draft.doc_no = _pmCustomerInvoiceDocNo(draft.project_code, draft.billing_month, seq);
  draft.doc_no_auto = true;
  const docNoEl = document.getElementById('pm-cinv-doc-no');
  if (docNoEl) docNoEl.value = draft.doc_no;
}

async function pmSaveCustomerInvoiceDocument() {
  const draft = _pmCustomerInvoiceSyncDraftFromForm();
  if (!draft) return;
  if (!draft.rows.length) {
    Toast.warning('저장할 청구 항목이 없습니다.');
    return;
  }
  if (!draft.doc_no) {
    Toast.warning('문서번호를 확인하세요.');
    return;
  }
  if (!draft.doc_date) {
    Toast.warning('작성일을 확인하세요.');
    return;
  }
  const mergedRows = _pmCustomerInvoiceMergedRows(draft);
  const supplyAmount = mergedRows.reduce((sum, r) => sum + Math.max(0, Number(r.amount || 0)), 0);
  const invoice = {
    project_code: draft.project_code,
    project_name: draft.project_name,
    client_name: draft.client_name,
    billing_month: draft.billing_month,
    planned_issue_date: draft.doc_date,
    recipient_name: draft.recipient_name || '',
    recipient_email: draft.recipient_email || '',
    supply_amount: supplyAmount,
    vat_amount: 0,
    total_amount: supplyAmount,
    item_name: draft.project_name || '고객청구서',
    legal_note: draft.note || '',
    invoice_items: mergedRows.map((r) => ({
      name: r.expense_type,
      cost_date: r.expense_date,
      supply_amount: r.amount,
      detail: r.detail || '',
      note: r.note || '',
    })),
  };
  const htmlSnapshot = _pmRenderCustomerInvoiceHtml(invoice);
  const session = getSession ? getSession() : null;
  try {
    const saved = await API.create('project_customer_invoice_documents', {
      project_code: draft.project_code,
      project_name: draft.project_name,
      client_name: draft.client_name,
      billing_month: draft.billing_month,
      document_no: draft.doc_no,
      document_date: draft.doc_date,
      status: 'saved',
      note: draft.note || '',
      total_amount: Math.round(supplyAmount),
      payload: {
        recipient_name: draft.recipient_name || '',
        recipient_email: draft.recipient_email || '',
        rows: mergedRows,
        html: htmlSnapshot,
      },
      created_by: session?.id || '',
      created_by_name: session?.name || '',
      updated_at: Date.now(),
    });
    draft.saved_id = String(saved?.id || '').trim();
    draft.saved_html = htmlSnapshot;
    draft.status = 'saved';
    const statusEl = document.getElementById('pm-cinv-status');
    if (statusEl) statusEl.value = '정식저장';
    _pmRenderCustomerInvoicePreview();
    Toast.success('고객청구서를 정식 문서로 저장했습니다.');
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg.includes('project_customer_invoice_documents')) {
      Toast.error('고객청구서 저장 테이블이 없습니다. docs/sql에 추가한 스크립트를 먼저 적용해 주세요.');
      return;
    }
    console.error(e);
    Toast.error('고객청구서 저장 실패: ' + msg);
  }
}

function pmPrintCustomerInvoiceDocument() {
  const draft = PM_STATE.customerInvoiceDraft;
  if (!draft) {
    Toast.warning('먼저 고객청구서를 작성해 주세요.');
    return;
  }
  if (!String(draft.saved_id || '').trim()) {
    Toast.warning('정식 저장 후 문서 출력을 진행해 주세요.');
    return;
  }
  const html = String(draft.saved_html || document.getElementById('pm-cinv-preview')?.innerHTML || '').trim();
  if (!html) {
    Toast.warning('출력할 문서 내용이 없습니다.');
    return;
  }
  const popup = window.open('', '_blank', 'width=1024,height=900');
  if (!popup) {
    Toast.warning('팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도해 주세요.');
    return;
  }
  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>프로젝트비용 청구서 출력</title>
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: Arial, "Noto Sans KR", sans-serif; color: #111827; }
    .doc-meta { margin: 0 0 10px 0; font-size: 12px; color: #374151; }
    .doc-meta b { color: #111827; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 12px; }
  </style>
</head>
<body>
  <p class="doc-meta"><b>문서번호</b> ${_pmEsc(draft.doc_no || '-')} · <b>작성일</b> ${_pmEsc(draft.doc_date || '-')}</p>
  ${html}
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`);
  popup.document.close();
}

async function pmDownloadCustomerInvoiceXlsx() {
  const draft = _pmCustomerInvoiceSyncDraftFromForm();
  if (!draft) return;
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('엑셀 라이브러리를 불러오지 못했습니다.');
    return;
  }
  const mergedRows = _pmCustomerInvoiceMergedRows(draft);
  const wb = XLSX.utils.book_new();
  const detailRows = mergedRows.map((r, i) => ({
    No: i + 1,
    비용일자: r.expense_date || '',
    비용유형: r.expense_type || '',
    금액: Math.round(Number(r.amount || 0)),
    비용내역: r.detail || '',
    비고: r.note || '',
  }));
  const sheetDetail = XLSX.utils.json_to_sheet(detailRows.length ? detailRows : [{ No: '', 비용일자: '', 비용유형: '', 금액: 0, 비용내역: '', 비고: '' }]);
  sheetDetail['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 44 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, sheetDetail, '청구목록');
  await xlsxDownload(wb, `${draft.doc_no || `고객청구서_${draft.project_code}`}.xlsx`);
}

function _pmExpenseSelectedRowIds() {
  return [...document.querySelectorAll('#pm-exp-detail-body input[data-exp-row-id]:checked')]
    .map((el) => String(el.dataset.expRowId || '').trim())
    .filter(Boolean);
}

function _pmExpenseCanRequestInvoice() {
  const selected = _pmExpenseSelectedRowIds();
  if (!selected.length) return false;
  const meta = PM_STATE.pendingExpenseUploadMeta || null;
  if (meta && (meta.verifyRowsOk === false || meta.verifyAmountOk === false)) return false;
  return true;
}

function _pmUpdateExpenseRequestButtonState() {
  const btn = document.getElementById('pm-exp-request-invoice-btn');
  if (!btn) return;
  const canRequest = _pmExpenseCanRequestInvoice();
  btn.disabled = !canRequest;
  btn.title = canRequest
    ? '선택한 항목으로 세금계산서 발행요청을 진행합니다.'
    : '선택 항목이 없거나 업로드 검증이 완료되지 않았습니다.';
}

function _pmExpenseUpdateDetailSummary() {
  const summaryEl = document.getElementById('pm-exp-detail-summary');
  if (!summaryEl) {
    _pmUpdateExpenseRequestButtonState();
    return;
  }
  const ids = _pmExpenseSelectedRowIds();
  const selectedMap = new Set(ids);
  const rows = (PM_STATE.expenseRows || []).filter((r) => selectedMap.has(String(r.id || '').trim()));
  const total = rows.reduce((sum, r) => sum + Math.max(0, Number(r.amount || 0)), 0);
  summaryEl.textContent = `선택 항목 ${rows.length}건 · 공급가액 ${_pmKrw(total)}`;
  _pmUpdateExpenseRequestButtonState();
}

function _pmExpenseStatusLabel(statusRaw) {
  return _pmBillingStatusLabel(_pmExpenseBillingStatusNorm(statusRaw));
}

function _pmExpenseStatusBadge(statusRaw) {
  const st = _pmExpenseBillingStatusNorm(statusRaw);
  if (st === 'requested') return _pmStatusBadge('청구요청', '#1d4ed8', '#dbeafe');
  if (st === 'billed') return _pmStatusBadge('청구완료', '#7c3aed', '#ede9fe');
  if (st === 'paid') return _pmStatusBadge('입금완료', '#047857', '#d1fae5');
  if (st === 'excluded') return _pmStatusBadge('청구제외', '#475569', '#e2e8f0');
  return _pmStatusBadge('미청구', '#334155', '#e2e8f0');
}

function _pmExpenseSummaryRows(rows) {
  const map = {};
  (rows || []).forEach((r) => {
    const code = String(r.project_code || '').trim();
    if (!code) return;
    if (!map[code]) {
      map[code] = {
        project_code: code,
        client_name: String(r.client_name || '').trim(),
        row_count: 0,
        total_amount: 0,
        billable_amount: 0,
        status_set: new Set(),
      };
    }
    const item = map[code];
    const amount = Math.max(0, Number(r.amount || 0));
    item.row_count += 1;
    item.total_amount += amount;
    if (r.is_billable) item.billable_amount += amount;
    item.status_set.add(_pmExpenseBillingStatusNorm(r.billing_status));
    if (!item.client_name && String(r.client_name || '').trim()) item.client_name = String(r.client_name || '').trim();
  });
  return Object.values(map).map((r) => {
    let status = 'unbilled';
    if (r.status_set.has('requested')) status = 'requested';
    else if (r.status_set.has('billed')) status = 'billed';
    else if (r.status_set.has('paid')) status = 'paid';
    else if (r.status_set.size === 1 && r.status_set.has('excluded')) status = 'excluded';
    return { ...r, status };
  }).sort((a, b) => String(a.project_code).localeCompare(String(b.project_code)));
}

function _pmRenderExpenseSummaryTable() {
  const body = document.getElementById('pm-exp-summary-body');
  if (!body) return;
  const projectKeyword = String(document.getElementById('pm-exp-filter-project')?.value || '').trim().toLowerCase();
  const clientKeyword = String(document.getElementById('pm-exp-filter-client')?.value || '').trim().toLowerCase();
  const statusFilter = String(document.getElementById('pm-exp-filter-status')?.value || '').trim();
  let rows = _pmExpenseSummaryRows(PM_STATE.expenseRows || []);
  rows = rows.filter((r) => {
    if (projectKeyword && !String(r.project_code || '').toLowerCase().includes(projectKeyword)) return false;
    if (clientKeyword && !String(r.client_name || '').toLowerCase().includes(clientKeyword)) return false;
    if (statusFilter && String(r.status || '') !== statusFilter) return false;
    return true;
  });
  const summaryTextEl = document.getElementById('pm-exp-summary-text');
  const totalRows = (PM_STATE.expenseRows || []).length;
  if (summaryTextEl) summaryTextEl.textContent = `업로드 ${totalRows}건 · 집계 ${rows.length}건`;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-file-import"></i><p>조건에 맞는 집계가 없습니다.</p></td></tr>';
    return;
  }
  body.innerHTML = rows.map((r, i) => `
    <tr class="${PM_STATE.expenseSummarySelectedCode === r.project_code ? 'is-selected' : ''}" data-exp-summary-code="${_pmEsc(r.project_code)}" onclick="pmSelectExpenseSummary('${_pmEsc(r.project_code)}')">
      <td style="text-align:center">${i + 1}</td>
      <td style="text-align:center">${_pmEsc(r.project_code)}</td>
      <td style="text-align:center">${_pmEsc(r.client_name || '')}</td>
      <td style="text-align:right">${Number(r.row_count || 0).toLocaleString('ko-KR')}</td>
      <td style="text-align:right">${_pmKrw(r.total_amount || 0)}</td>
      <td style="text-align:right">${_pmKrw(r.billable_amount || 0)}</td>
      <td style="text-align:center">${_pmExpenseStatusBadge(r.status)}</td>
      <td style="text-align:center">
        <button type="button" class="btn btn-sm btn-primary" onclick="event.stopPropagation();pmOpenCustomerInvoiceEditor('${_pmEsc(r.project_code)}')"><i class="fas fa-file-invoice"></i> 고객청구서 작성</button>
      </td>
    </tr>
  `).join('');
}

function _pmRenderExpenseDetailTable() {
  const body = document.getElementById('pm-exp-detail-body');
  if (!body) return;
  const code = String(PM_STATE.expenseSummarySelectedCode || '').trim();
  const rows = _pmExpenseRowsByProject(code);
  if (!code) {
    body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-list"></i><p>집계 목록에서 프로젝트를 선택하세요.</p></td></tr>';
    _pmExpenseUpdateDetailSummary();
    return;
  }
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-receipt"></i><p>선택된 프로젝트의 비용 내역이 없습니다.</p></td></tr>';
    _pmExpenseUpdateDetailSummary();
    return;
  }
  body.innerHTML = rows.map((r, i) => {
    const id = String(r.id || '').trim();
    const checked = !!r.is_billable && _pmExpenseBillingStatusNorm(r.billing_status) === 'unbilled';
    const disabled = ['requested', 'billed', 'paid'].includes(_pmExpenseBillingStatusNorm(r.billing_status));
    return `<tr>
      <td style="text-align:center"><input type="checkbox" data-exp-row-id="${_pmEsc(id)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}></td>
      <td style="text-align:center">${i + 1}</td>
      <td>${_pmEsc(r.expense_date || '-')}</td>
      <td>${_pmEsc(r.expense_type || '-')}</td>
      <td style="text-align:right">${_pmKrw(r.amount || 0)}</td>
      <td class="pm-exp-col-detail" style="text-align:center" title="${_pmEsc(r.vendor || '')}">${_pmEsc(r.vendor || '')}</td>
      <td style="text-align:center">${_pmEsc(_pmExpenseStatusLabel(r.billing_status))}</td>
      <td class="pm-exp-col-note" style="text-align:center" title="${_pmEsc(r.note || '')}">${_pmEsc(r.note || '')}</td>
    </tr>`;
  }).join('');
  document.querySelectorAll('#pm-exp-detail-body input[data-exp-row-id]').forEach((el) => {
    el.addEventListener('change', _pmExpenseUpdateDetailSummary);
  });
  _pmExpenseUpdateDetailSummary();
}

async function pmUploadProjectExpenseExcel(input) {
  const file = input && input.files ? input.files[0] : null;
  if (input) input.value = '';
  if (!file) return;
  const session = getSession();
  if (!_pmCanExpenseUpload(session)) {
    Toast.warning('업로드 권한이 없습니다. 경영지원팀만 가능합니다.');
    return;
  }
  const ym = _pmCostUploadMonth();
  if (!ym) {
    Toast.warning('업로드기준월을 먼저 선택하세요.');
    return;
  }
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('엑셀 라이브러리를 불러오지 못했습니다.');
    return;
  }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = _pmParseXlsxRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
    if (!rows.length) {
      _pmSetPendingExpenseRows([], null);
      _pmCostUploadMessage('warning', '엑셀 데이터가 없습니다.');
      return;
    }
    // 같은 월에 이미 들어간 동일 데이터는 재업로드 시 자동 스킵
    const existingRows = await API.listAllPages(
      'project_expense_uploads',
      { filter: `upload_month=eq.${ym}`, limit: 3000, maxPages: 30, sort: 'updated_at' }
    ).catch(() => []);
    const existingKeys = new Set((existingRows || []).map((r) => _pmExpenseRowDedupKey(r)));
    const batchKeys = new Set();
    const pendingRows = [];
    const totalRows = rows.length;
    let skipped = 0;
    let duplicateSkipped = 0;
    let requiredSkipped = 0;
    let unknownSkipped = 0;
    let notReadySkipped = 0;
    let sourceAmount = 0;
    let pendingAmount = 0;
    let skippedAmount = 0;
    let unknownCodes = [];
    let notReadyCodes = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      const vals = Object.values(row);
      const code = String(row['프로젝트코드'] || row['project_code'] || vals[0] || '').trim();
      const expenseDate = _pmNormalizeExpenseDateInput(row['비용일자'] ?? row['expense_date'] ?? vals[1]);
      const expenseType = String(row['비용유형'] || row['expense_type'] || vals[2] || '').trim();
      const amount = _pmParseMoney(row['금액'] ?? row['expense_amount'] ?? row['공급가액'] ?? vals[3]);
      if (amount > 0) sourceAmount += amount;
      // 최종양식: 프로젝트코드, 비용일자, 비용유형, 금액, 비용내역, 비고
      // 구양식(거래처/부가세)도 키 기반으로만 호환 처리한다.
      const vatAmount = _pmParseMoney(row['부가세'] ?? row['vat'] ?? 0);
      const costDetail = String(
        row['비용내역'] ||
        row['cost_detail'] ||
        row['거래처'] ||
        row['vendor'] ||
        vals[4] ||
        ''
      ).trim();
      const note = String(row['비고'] || row['note'] || vals[5] || vals[6] || '').trim();
      if (!code || !expenseDate || !expenseType || !(amount > 0)) {
        requiredSkipped += 1;
        skipped += 1;
        if (amount > 0) skippedAmount += amount;
        continue;
      }
      const access = _pmCanUploadExpenseForProject(code);
      if (!access.ok) {
        if (access.reason === 'not_found') {
          unknownSkipped += 1;
          unknownCodes.push(code);
        } else {
          notReadySkipped += 1;
          notReadyCodes.push(code);
        }
        skipped += 1;
        if (amount > 0) skippedAmount += amount;
        continue;
      }
      const dedupKey = _pmExpenseRowDedupKey({
        project_code: code,
        expense_date: expenseDate,
        expense_type: expenseType,
        amount,
        vendor: costDetail,
        note,
      });
      if (existingKeys.has(dedupKey) || batchKeys.has(dedupKey)) {
        duplicateSkipped += 1;
        skipped += 1;
        if (amount > 0) skippedAmount += amount;
        continue;
      }
      const p = PM_STATE.projectByCode[code] || {};
      const total = amount + vatAmount;
      pendingAmount += amount;
      pendingRows.push({
        upload_month: ym,
        source_file_name: file.name || '',
        source_row_no: i + 2,
        project_id: p.id || '',
        project_code: code,
        project_name: p.project_name || '',
        client_id: p.client_id || '',
        client_name: p.client_name || '',
        expense_date: /^\d{4}-\d{2}-\d{2}$/.test(expenseDate) ? expenseDate : null,
        expense_type: expenseType,
        vendor: costDetail,
        amount,
        vat_amount: vatAmount,
        total_amount: total,
        note,
        is_billable: false,
        billing_status: 'unbilled',
        linked_invoice_id: '',
        uploaded_by: String(session?.id || ''),
        uploaded_by_name: String(session?.name || ''),
      });
      existingKeys.add(dedupKey);
      batchKeys.add(dedupKey);
    }
    const uniqUnknown = [...new Set(unknownCodes)];
    const uniqNotReady = [...new Set(notReadyCodes)];
    pendingRows.sort(_pmExpenseRowSortCompare);
    const verifyRowsOk = totalRows === (pendingRows.length + skipped);
    const verifyAmountOk = Math.abs(sourceAmount - (pendingAmount + skippedAmount)) < 0.0001;
    _pmSetPendingExpenseRows(pendingRows, {
      ym,
      fileName: file.name || '',
      loadedAt: Date.now(),
      totalRows,
      pendingRows: pendingRows.length,
      skippedRows: skipped,
      skippedRequiredRows: requiredSkipped,
      skippedUnknownRows: unknownSkipped,
      skippedNotReadyRows: notReadySkipped,
      skippedDuplicateRows: duplicateSkipped,
      sourceAmount,
      pendingAmount,
      skippedAmount,
      verifyRowsOk,
      verifyAmountOk,
    });
    const previewRows = pendingRows.slice(0, 10).map((r, idx) => (
      `<tr><td style="text-align:center">${idx + 1}</td><td>${_pmEsc(r.project_code)}</td><td>${_pmEsc(r.expense_date || '-')}</td><td>${_pmEsc(r.expense_type || '-')}</td><td style="text-align:right">${_pmKrw(r.amount || 0)}</td><td>${_pmEsc(r.vendor || '-')}</td><td title="${_pmEsc(r.note || '')}">${_pmEsc(r.note || '-')}</td></tr>`
    )).join('');
    const preview = pendingRows.length
      ? `<div style="margin-top:8px;max-height:220px;overflow:auto;border:1px solid #e2e8f0;border-radius:6px;background:#fff">
          <table class="data-table" style="min-width:720px">
            <thead><tr><th style="width:42px;text-align:center">No</th><th>프로젝트코드</th><th style="width:110px">비용일자</th><th style="width:110px">비용유형</th><th style="width:110px;text-align:right">금액</th><th style="width:160px">비용내역</th><th>비고</th></tr></thead>
            <tbody>${previewRows}</tbody>
          </table>
        </div>
        ${pendingRows.length > 10 ? `<div style="margin-top:6px;color:#64748b">외 ${pendingRows.length - 10}건은 저장 시 함께 반영됩니다.</div>` : ''}`
      : '';
    const skipParts = [];
    if (duplicateSkipped) skipParts.push(`중복 ${duplicateSkipped}행`);
    if (requiredSkipped) skipParts.push(`필수값누락 ${requiredSkipped}행`);
    if (unknownSkipped) skipParts.push(`권한/미존재코드 ${unknownSkipped}행`);
    if (notReadySkipped) skipParts.push(`승인완료·수행중 아님 ${notReadySkipped}행`);
    const msg = `업로드 파일 검토 완료 · 저장은 하단 <b>확인 후 저장</b>을 눌러 진행됩니다.${skipParts.length ? `<br>스킵 상세: ${skipParts.join(' · ')}` : ''}${uniqUnknown.length ? `<br>미존재 코드: ${_pmEsc(uniqUnknown.join(', '))}` : ''}${uniqNotReady.length ? `<br>업로드 불가(승인완료·수행중 아님): ${_pmEsc(uniqNotReady.join(', '))}` : ''}${preview}`;
    _pmCostUploadMessage(uniqUnknown.length ? 'warning' : 'success', msg);
    if (!pendingRows.length) {
      Toast.warning('저장 가능한 업로드 행이 없습니다.');
    } else {
      Toast.success(`저장대기 ${pendingRows.length}건 준비 완료`);
    }
  } catch (e) {
    console.error(e);
    _pmSetPendingExpenseRows([], null);
    _pmCostUploadMessage('error', `업로드 실패: ${_pmEsc(e.message || '')}`);
    Toast.error('ERP 비용 업로드 실패');
  }
}

async function pmCommitPendingExpenseUpload() {
  const rows = Array.isArray(PM_STATE.pendingExpenseUploadRows) ? PM_STATE.pendingExpenseUploadRows : [];
  const meta = PM_STATE.pendingExpenseUploadMeta || {};
  if (!rows.length) {
    Toast.warning('저장할 업로드 대기 데이터가 없습니다.');
    _pmRenderPendingExpenseActions();
    return;
  }
  const session = getSession();
  if (!_pmCanExpenseUpload(session)) {
    Toast.warning('저장 권한이 없습니다. 경영지원팀만 가능합니다.');
    return;
  }
  if (meta.verifyRowsOk === false || meta.verifyAmountOk === false) {
    Toast.error('행수/금액 검증이 일치하지 않아 저장할 수 없습니다. 파일을 다시 확인해주세요.');
    _pmRenderPendingExpenseActions();
    return;
  }
  const ym = String(meta.ym || _pmCostUploadMonth() || '').trim();
  if (!ym) {
    Toast.warning('업로드기준월을 먼저 선택하세요.');
    return;
  }
  const batchId = `ERP-${ym}-${Date.now()}`;
  let created = 0;
  try {
    for (const row of rows) {
      await API.create('project_expense_uploads', {
        upload_batch_id: batchId,
        upload_month: ym,
        source_file_name: String(row.source_file_name || meta.fileName || ''),
        source_row_no: Number(row.source_row_no || 0),
        project_id: String(row.project_id || ''),
        project_code: String(row.project_code || ''),
        project_name: String(row.project_name || ''),
        client_id: String(row.client_id || ''),
        client_name: String(row.client_name || ''),
        expense_date: String(row.expense_date || '').trim() || null,
        expense_type: String(row.expense_type || ''),
        vendor: String(row.vendor || ''),
        amount: Math.max(0, Number(row.amount || 0)),
        vat_amount: Math.max(0, Number(row.vat_amount || 0)),
        total_amount: Math.max(0, Number(row.total_amount || (Number(row.amount || 0) + Number(row.vat_amount || 0)))),
        note: String(row.note || ''),
        is_billable: false,
        billing_status: 'unbilled',
        linked_invoice_id: '',
        uploaded_by: String(session?.id || ''),
        uploaded_by_name: String(session?.name || ''),
        created_at: Date.now(),
        updated_at: Date.now(),
      });
      created += 1;
    }
    PM_STATE.lastExpenseUploadBatchId = batchId;
    PM_STATE.lastExpenseUploadBatchCreated = Date.now();
    _pmSetPendingExpenseRows([], null);
    _pmRenderPendingExpenseActions();
    _pmCostUploadMessage('success', `ERP 비용 저장 완료 · 생성 ${created}건${String(meta.fileName || '').trim() ? ` · 파일 ${_pmEsc(meta.fileName)}` : ''}`);
    await loadProjectMgmtCosts();
    Toast.success(`ERP 비용 ${created}건 저장 완료`);
  } catch (e) {
    console.error(e);
    _pmCostUploadMessage('error', `저장 실패: ${_pmEsc(e.message || '')}`);
    Toast.error('ERP 비용 저장 실패');
  }
}

function pmCancelPendingExpenseUpload() {
  const rows = Array.isArray(PM_STATE.pendingExpenseUploadRows) ? PM_STATE.pendingExpenseUploadRows : [];
  if (!rows.length) {
    _pmRenderPendingExpenseActions();
    return;
  }
  _pmSetPendingExpenseRows([], null);
  _pmCostUploadMessage('warning', '업로드 대기 데이터를 취소했습니다. 아직 DB에는 저장되지 않았습니다.');
  Toast.success('업로드 대기 취소 완료');
}

async function pmDeleteLastExpenseUploadBatch() {
  const session = getSession();
  if (!_pmCanExpenseUpload(session)) {
    Toast.warning('삭제 권한이 없습니다. 경영지원팀만 가능합니다.');
    return;
  }
  const batchId = String(PM_STATE.lastExpenseUploadBatchId || '').trim();
  if (!batchId) {
    Toast.warning('삭제할 최근 업로드 배치가 없습니다.');
    _pmRenderPendingExpenseActions();
    return;
  }
  const ok = await Confirm.open({
    title: '방금 업로드 삭제',
    message: `최근 업로드 배치(${batchId})를 삭제할까요?\n청구 요청과 연결된 항목은 삭제되지 않습니다.`,
    confirmText: '삭제',
    cancelText: '취소',
  });
  if (!ok) return;
  try {
    const rows = await API.listAllPages(
      'project_expense_uploads',
      { filter: `upload_batch_id=eq.${batchId}`, limit: 2000, maxPages: 20, sort: 'updated_at' }
    );
    let deleted = 0;
    for (const row of (rows || [])) {
      const linked = String(row?.linked_invoice_id || '').trim();
      const st = _pmExpenseBillingStatusNorm(row?.billing_status);
      if (linked || ['requested', 'billed', 'paid'].includes(st)) continue;
      await API.delete('project_expense_uploads', row.id).catch(() => null);
      deleted += 1;
    }
    PM_STATE.lastExpenseUploadBatchId = '';
    PM_STATE.lastExpenseUploadBatchCreated = 0;
    _pmRenderPendingExpenseActions();
    _pmCostUploadMessage('success', `최근 업로드 배치 삭제 완료 · 삭제 ${deleted}건`);
    await loadProjectMgmtCosts();
    Toast.success(`최근 업로드 삭제 ${deleted}건`);
  } catch (e) {
    console.error(e);
    _pmCostUploadMessage('error', `최근 업로드 삭제 실패: ${_pmEsc(e.message || '')}`);
    Toast.error('최근 업로드 삭제 실패');
  }
}

async function pmDownloadProjectExpenseTemplate() {
  const ok = await _pmEnsureXlsx();
  if (!ok) {
    Toast.error('엑셀 라이브러리를 불러오지 못했습니다.');
    return;
  }
  const ym = _pmCostUploadMonth() || _pmNowMonth();
  const sampleCode = String((PM_STATE.projects[0] && PM_STATE.projects[0].project_code) || 'PJT-001');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { 프로젝트코드: sampleCode, 비용일자: `${ym}-01`, 비용유형: '교통비', 금액: 120000, 비용내역: '현장 이동 택시비', 비고: '현장 방문' },
    { 프로젝트코드: sampleCode, 비용일자: `${ym}-02`, 비용유형: '식대', 금액: 80000, 비용내역: '고객 미팅 식사', 비고: '고객 미팅' },
  ]);
  ws['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, `ERP비용_${ym}`);
  const guide = XLSX.utils.json_to_sheet([
    { 항목: '프로젝트코드', 설명: '필수. 등록된 프로젝트 코드' },
    { 항목: '비용일자', 설명: '필수. YYYY-MM-DD' },
    { 항목: '비용유형', 설명: '필수. 교통비/식대/기타 등' },
    { 항목: '금액', 설명: '필수. 숫자' },
    { 항목: '비용내역', 설명: '선택. 증빙/사용처/지출내용 등' },
    { 항목: '비고', 설명: '선택' },
  ]);
  guide['!cols'] = [{ wch: 14 }, { wch: 56 }];
  XLSX.utils.book_append_sheet(wb, guide, '입력안내');
  await xlsxDownload(wb, `ERP비용_업로드양식_${ym}.xlsx`);
}

function pmSelectExpenseSummary(projectCode) {
  PM_STATE.expenseSummarySelectedCode = String(projectCode || '').trim();
  _pmRenderExpenseSummaryTable();
  _pmRenderExpenseDetailTable();
  _pmUpdateExpenseRequestButtonState();
}

async function pmUpdateSelectedExpenseBillable(flag) {
  const ids = _pmExpenseSelectedRowIds();
  if (!ids.length) {
    Toast.warning('먼저 상세 목록에서 항목을 선택하세요.');
    return;
  }
  const nextBillable = !!flag;
  const nextStatus = nextBillable ? 'unbilled' : 'excluded';
  for (const id of ids) {
    await API.patch('project_expense_uploads', id, {
      is_billable: nextBillable,
      billing_status: nextStatus,
      linked_invoice_id: '',
      updated_at: Date.now(),
    }).catch(() => null);
  }
  Toast.success(nextBillable ? '선택 항목을 청구대상으로 반영했습니다.' : '선택 항목을 청구제외로 반영했습니다.');
  await loadProjectMgmtCosts();
  if (PM_STATE.expenseSummarySelectedCode) {
    pmSelectExpenseSummary(PM_STATE.expenseSummarySelectedCode);
  }
}

function pmOpenSelectedExpenseInvoiceRequest() {
  const code = String(PM_STATE.expenseSummarySelectedCode || '').trim();
  if (!code) {
    Toast.warning('프로젝트를 먼저 선택하세요.');
    return;
  }
  if (!_pmExpenseCanRequestInvoice()) {
    Toast.warning('선택 항목이 없거나 검증 상태를 확인해야 합니다.');
    _pmUpdateExpenseRequestButtonState();
    return;
  }
  pmOpenExpenseTaxInvoiceRequest(code);
}

async function pmOpenExpenseTaxInvoiceRequest(projectCode) {
  const code = String(projectCode || PM_STATE.expenseSummarySelectedCode || '').trim();
  if (!code) {
    Toast.warning('프로젝트를 먼저 선택하세요.');
    return;
  }
  const selectedIds = _pmExpenseSelectedRowIds();
  if (selectedIds.length && String(PM_STATE.expenseSummarySelectedCode || '').trim() === code) {
    for (const id of selectedIds) {
      await API.patch('project_expense_uploads', id, {
        is_billable: true,
        billing_status: 'unbilled',
        linked_invoice_id: '',
        updated_at: Date.now(),
      }).catch(() => null);
    }
  }
  await loadProjectMgmtCosts();
  await pmOpenInvoiceProjectDetail(code);
}

function pmOpenExpenseInvoiceRequest(projectCode) {
  pmOpenCustomerInvoiceEditor(projectCode);
}

async function loadProjectMgmtCosts() {
  const allowedCodes = new Set((PM_STATE.projects || []).map((p) => String(p.project_code || '').trim()).filter(Boolean));
  try {
    let rows = await API.listAllPages('project_expense_uploads', { limit: 5000, maxPages: 60, sort: 'updated_at' }).catch(() => []);
    rows = rows.filter((r) => allowedCodes.has(String(r.project_code || '').trim()));
    // 이미 저장된 완전중복 행은 최신 1건만 목록에 노출
    const seen = new Set();
    const deduped = [];
    for (const row of rows) {
      const key = _pmExpenseRowDedupKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }
    rows = deduped.sort(_pmExpenseRowSortCompare);
    PM_STATE.expenseRows = rows;
    _pmRenderExpenseSummaryTable();
    if (PM_STATE.expenseSummarySelectedCode) {
      _pmRenderExpenseDetailTable();
    } else {
      const firstCode = String((_pmExpenseSummaryRows(rows)[0] || {}).project_code || '').trim();
      if (firstCode) {
        PM_STATE.expenseSummarySelectedCode = firstCode;
      }
      _pmRenderExpenseDetailTable();
    }
  } catch (e) {
    console.error(e);
    const summaryBody = document.getElementById('pm-exp-summary-body');
    const detailBody = document.getElementById('pm-exp-detail-body');
    if (summaryBody) summaryBody.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>집계 조회 실패</p></td></tr>';
    if (detailBody) detailBody.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-exclamation-triangle"></i><p>상세 조회 실패</p></td></tr>';
  }
}

async function loadProjectMgmtContracts() {
  const body = document.getElementById('pm-contract-body');
  const summary = document.getElementById('pm-contract-summary');
  const table = document.getElementById('pm-contract-table');
  if (!body) return;
  if (table) {
    // 강제 레이아웃 적용: 화면별 스타일 충돌 방지
    table.style.setProperty('table-layout', 'fixed', 'important');
    table.style.setProperty('width', '100%', 'important');
    table.style.setProperty('min-width', '1116px', 'important');
  }
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
    const fileCellTd = (name, url) => {
      if (!name) return '<td class="pm-contract-td-file" style="text-align:center"><span style="color:var(--text-muted)">-</span></td>';
      const n = String(name);
      const t = _pmEsc(n);
      const hasUrl = !!String(url || '').trim();
      const inner = hasUrl
        ? `<a href="${_pmEsc(url)}" target="_blank" rel="noopener noreferrer" class="pm-contract-file-pill">첨부</a>`
        : `<span class="pm-contract-file-pill" style="cursor:default;background:#f1f5f9;color:#64748b;border-color:#cbd5e1">첨부</span>`;
      return `<td class="pm-contract-td-file" style="text-align:center" title="${t}">${inner}</td>`;
    };
    body.innerHTML = list.map((r, i) => {
      const contractName = String(r.contract_file_name || '').trim();
      const contractUrl = String(r.contract_file_url || '').trim();
      const evidenceName = String(r.contract_evidence_file_name || '').trim();
      const evidenceUrl = String(r.contract_evidence_file_url || '').trim();
      const routeName = String(r.order_evidence_file_name || '').trim();
      const routeUrl = String(r.order_evidence_file_url || '').trim();
      const isMissing = !contractName && !contractUrl && !evidenceName && !evidenceUrl;
      if (isMissing) missingCount += 1;
      const statusTxt = isMissing ? '누락' : '정상';
      const statusColor = isMissing ? '#b45309' : '#047857';
      const statusBg = isMissing ? '#fef3c7' : '#d1fae5';
      const codeT = _pmEsc(String(r.project_code || ''));
      const nameT = _pmEsc(String(r.project_name || ''));
      const clientT = _pmEsc(String(r.client_name || ''));
      return `<tr>
        <td class="pm-contract-td-no" style="text-align:center;width:44px;min-width:44px;max-width:52px">${i + 1}</td>
        <td class="pm-contract-code-cell" style="width:220px;min-width:220px;max-width:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;letter-spacing:0.01em" title="${codeT}">${_pmEsc(r.project_code || '-')}</td>
        <td class="pm-contract-ellipsis" style="width:260px;min-width:260px;max-width:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${nameT}">${_pmEsc(r.project_name || '-')}</td>
        <td class="pm-contract-ellipsis" style="width:200px;min-width:200px;max-width:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${clientT}">${_pmEsc(r.client_name || '-')}</td>
        <td class="pm-contract-td-status" style="text-align:center;width:72px;min-width:72px;max-width:88px">
          <span style="display:inline-flex;align-items:center;justify-content:center;min-width:56px;padding:2px 8px;border-radius:999px;background:${statusBg};color:${statusColor};font-size:11px;font-weight:700">${statusTxt}</span>
        </td>
        ${fileCellTd(contractName, contractUrl)}
        ${fileCellTd(evidenceName, evidenceUrl)}
        ${fileCellTd(routeName, routeUrl)}
      </tr>`;
    }).join('');
    // 최후 보정: 컬럼 폭/스타일을 JS에서 직접 강제 (반응형/캐시 충돌 우회)
    const colWidths = ['44px', '220px', '260px', '200px', '72px', '100px', '100px', '120px'];
    const headerRow = table ? table.querySelector('thead tr') : null;
    if (headerRow) {
      colWidths.forEach((w, idx) => {
        const th = headerRow.children[idx];
        if (!th) return;
        th.style.setProperty('width', w, 'important');
        th.style.setProperty('min-width', w, 'important');
      });
    }
    Array.from(body.querySelectorAll('tr')).forEach((tr) => {
      colWidths.forEach((w, idx) => {
        const td = tr.children && tr.children[idx];
        if (!td) return;
        td.style.setProperty('width', w, 'important');
        td.style.setProperty('min-width', w, 'important');
      });
      const codeTd = tr.children && tr.children[1];
      if (!codeTd) return;
      codeTd.classList.add('pm-contract-code-cell');
      codeTd.style.setProperty('overflow', 'hidden', 'important');
      codeTd.style.setProperty('text-overflow', 'ellipsis', 'important');
      codeTd.style.setProperty('white-space', 'nowrap', 'important');
      codeTd.style.setProperty('word-break', 'normal', 'important');
      codeTd.style.setProperty('max-width', 'none', 'important');
      codeTd.style.setProperty('width', '220px', 'important');
      codeTd.style.setProperty('min-width', '220px', 'important');
      codeTd.style.setProperty('line-height', '1.3', 'important');
    });
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
window.pmTimeChargeSwitchViewTab = pmTimeChargeSwitchViewTab;
window.pmTimeChargeSwitchDocTab = pmTimeChargeSwitchDocTab;
window.pmPreviewTimeChargeDocument = pmPreviewTimeChargeDocument;
window.pmPrintTimeChargeDocument = pmPrintTimeChargeDocument;
window.pmGenerateAndPrintTimeChargeDocument = pmGenerateAndPrintTimeChargeDocument;
window.pmDownloadTimeChargePdf = pmDownloadTimeChargePdf;
window.pmTimeChargeOpenInvoiceFromSummary = pmTimeChargeOpenInvoiceFromSummary;
window.pmTimeChargeOpenConsultantDetail = pmTimeChargeOpenConsultantDetail;
window.loadProjectMgmtInvoices = loadProjectMgmtInvoices;
window.loadProjectMgmtCosts = loadProjectMgmtCosts;
window.loadProjectMgmtContracts = loadProjectMgmtContracts;
window.importTimeChargeFromEntries = importTimeChargeFromEntries;
window.saveTimeChargeLines = saveTimeChargeLines;
window.pmDownloadTimeChargeTemplate = pmDownloadTimeChargeTemplate;
window.pmUploadTimeChargeExcel = pmUploadTimeChargeExcel;
window.pmCommitPendingTimeChargeUpload = pmCommitPendingTimeChargeUpload;
window.pmCancelPendingTimeChargeUpload = pmCancelPendingTimeChargeUpload;
window.pmExportTimeChargeStatusWorkbook = pmExportTimeChargeStatusWorkbook;
window.pmExportTimeChargeInvoiceWorkbook = pmExportTimeChargeInvoiceWorkbook;
window.requestTimeChargeInvoice = requestTimeChargeInvoice;
window.createInvoiceRequestFromBatch = createInvoiceRequestFromBatch;
window.pmAddInvoicePayment = pmAddInvoicePayment;
window.pmSaveInvoiceRow = pmSaveInvoiceRow;
window.issueTaxInvoice = issueTaxInvoice;
window.pmSendInvoiceToNts = pmSendInvoiceToNts;
window.pmRunInvoiceDataQualityCheck = pmRunInvoiceDataQualityCheck;
window.pmOpenInvoiceProjectDetail = pmOpenInvoiceProjectDetail;
window.pmCloseInvoiceProjectDetail = pmCloseInvoiceProjectDetail;
window.pmOpenPrevInvoiceProjectDetail = pmOpenPrevInvoiceProjectDetail;
window.pmOpenNextInvoiceProjectDetail = pmOpenNextInvoiceProjectDetail;
window.pmInvoiceSwitchListTab = pmInvoiceSwitchListTab;
window.pmSelectInvoicePlanRow = pmSelectInvoicePlanRow;
window.pmSelectExpenseSummary = pmSelectExpenseSummary;
window.pmOpenExpenseInvoiceRequest = pmOpenExpenseInvoiceRequest;
window.pmOpenExpenseTaxInvoiceRequest = pmOpenExpenseTaxInvoiceRequest;
window.pmOpenCustomerInvoiceEditor = pmOpenCustomerInvoiceEditor;
window.saveProjectCostItem = saveProjectCostItem;
window.pmDeleteCostItem = pmDeleteCostItem;
window.pmDownloadMonthlyLaborTemplate = pmDownloadMonthlyLaborTemplate;
window.pmUploadMonthlyLaborCostExcel = pmUploadMonthlyLaborCostExcel;
window.pmDownloadProjectExpenseTemplate = pmDownloadProjectExpenseTemplate;
window.pmUploadProjectExpenseExcel = pmUploadProjectExpenseExcel;
window.pmCommitPendingExpenseUpload = pmCommitPendingExpenseUpload;
window.pmCancelPendingExpenseUpload = pmCancelPendingExpenseUpload;
window.pmDeleteLastExpenseUploadBatch = pmDeleteLastExpenseUploadBatch;
window.pmDownloadMonthlyIndirectTemplate = pmDownloadMonthlyIndirectTemplate;
window.pmUploadMonthlyIndirectCostExcel = pmUploadMonthlyIndirectCostExcel;
window.pmDownloadProjectDirectCostTemplate = pmDownloadProjectDirectCostTemplate;
window.pmUploadProjectDirectCostExcel = pmUploadProjectDirectCostExcel;
window.pmOpenLifecycleAction = pmOpenLifecycleAction;
window.pmAdjustLifecycleStatus = pmAdjustLifecycleStatus;
window.pmOpenProgressDetail = pmOpenProgressDetail;
window.pmProgressDetailSwitchTab = pmProgressDetailSwitchTab;
window.pmProgressDetailAddAssistantRow = pmProgressDetailAddAssistantRow;
window.pmProgressDetailRemoveAssistantRow = pmProgressDetailRemoveAssistantRow;
window.pmOpenOutputFollowupModal = pmOpenOutputFollowupModal;
window.pmOpenOutputActionModal = pmOpenOutputActionModal;
window.pmSaveOutputAction = pmSaveOutputAction;
window.pmOpenOutputPublishModal = pmOpenOutputPublishModal;
window.pmSaveOutputPublishDecision = pmSaveOutputPublishDecision;
