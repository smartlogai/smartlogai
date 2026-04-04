/* ============================================
   Smart Log AI — 앱 코어 (세션, API, 유틸, 권한)
   ============================================ */

const SESSION_TTL = 8 * 60 * 60 * 1000;

const Session = {
  get() {
    try {
      const raw = localStorage.getItem('wt_session') || sessionStorage.getItem('wt_session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s && s.loggedInAt && Date.now() - s.loggedInAt > SESSION_TTL) { this.clear(); return null; }
      return s;
    } catch { return null; }
  },
  require() {
    const s = this.get();
    if (!s || !s.id) { this.clear(); window.location.replace('index.html'); return null; }
    return s;
  },
  clear() { localStorage.removeItem('wt_session'); sessionStorage.removeItem('wt_session'); },
  logout() {
    try {
      const s = this.get();
      if (s) { const logs = JSON.parse(sessionStorage.getItem('_sec_logs_') || '[]'); logs.push({ ts: new Date().toISOString(), user: s.name, action: '정상 로그아웃' }); sessionStorage.setItem('_sec_logs_', JSON.stringify(logs)); }
    } catch { }
    if (typeof destroyNotify === 'function') destroyNotify();
    this.clear();
    window.location.replace('index.html');
  },
  createSecure(data) {
    const secureData = { ...data, loggedInAt: Date.now(), loggedInUA: navigator.userAgent.slice(0, 120), tabId: Math.random().toString(36).slice(2) };
    sessionStorage.setItem('wt_session', JSON.stringify(secureData));
    localStorage.setItem('wt_session', JSON.stringify(secureData));
    return secureData;
  },
};

const ROLE_LABEL = { admin: 'Admin', director: 'Director', manager: 'Manager', staff: 'Staff' };
const ROLE_LABEL_FULL = { admin: 'Administrator', director: '본부장 (Director)', manager: '팀장 (Manager)', staff: 'Staff' };
const ROLE_COLOR = { admin: 'badge-purple', director: 'badge-orange', manager: 'badge-blue', staff: 'badge-green' };

const Auth = {
  isAdmin:    (s) => s && s.role === 'admin',
  isDirector: (s) => s && s.role === 'director',
  isManager:  (s) => s && s.role === 'manager',
  isStaff:    (s) => s && s.role === 'staff',
  hasApprover: (s) => { if (!s) return false; if (s.role === 'staff') return !!(s.approver_id); return true; },
  canWriteEntry: (s) => { if (!s) return false; if (s.role === 'staff') return !!(s.approver_id); if (s.role === 'manager') return s.is_timesheet_target !== false; return false; },
  canApprove1st: (s) => s && s.role === 'manager',
  canApprove2nd: (s) => s && s.role === 'director',
  canApprove: (s) => s && s.role === 'manager',
  canViewAll: (s) => s && s.role === 'admin',
  canViewDeptScope: (s) => s && (s.role === 'manager' || s.role === 'director' || s.role === 'admin'),
  canManageMaster: (s) => s && s.role === 'admin',
  canManageRefData: (s) => s && (s.role === 'admin' || s.role === 'director' || s.role === 'manager'),
  canViewAnalysis: (s) => s && (s.role === 'director' || s.role === 'admin' || s.role === 'manager'),
  canViewArchive: (s) => !!s,
  scopeMatch(s, rec) {
    if (!s || !rec) return false;
    if (Auth.canViewAll(s)) return true;
    if (s.dept_id    && rec.dept_id    === s.dept_id)    return true;
    if (s.hq_id      && rec.hq_id      === s.hq_id)      return true;
    if (s.cs_team_id && rec.cs_team_id === s.cs_team_id) return true;
    return false;
  },
  entryFilter(s) {
    if (Auth.canViewAll(s)) return {};
    if (s.role === 'manager')  return {};
    if (s.role === 'director') return {};
    return { user: s.id };
  },
};

const SUPABASE_URL = 'https://dvjagzcqdgolspyngtxj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2amFnemNxZGdvbHNweW5ndHhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNjU5MjYsImV4cCI6MjA5MDg0MTkyNn0.J3G3zHvIlCgpYaST9PCAJtd9n8OoXMZZmP5i920cfUg';

const API = {
  _headers() {
    return { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=representation' };
  },
  async _fetch(url, opts = {}) {
    const res = await fetch(url, { headers: this._headers(), ...opts });
    if (res.status === 204 || res.status === 205) return null;
    if (!res.ok) { const err = await res.json().catch(() => ({ message: 'API Error' })); throw new Error(err.message || err.error || `HTTP ${res.status}`); }
    return res.json().catch(() => null);
  },
  async list(table, params = {}) {
    const limit  = params.limit  || 200;
    const page   = params.page   || 1;
    const offset = (page - 1) * limit;
    const search = params.search || '';
    let url = `${SUPABASE_URL}/rest/v1/${table}?limit=${limit}&offset=${offset}`;
    if (search) url += `&or=(name.ilike.*${search}*,email.ilike.*${search}*)`;
    if (params.sort) url += `&order=${params.sort}.desc`; else url += `&order=created_at.desc`;
    url += `&deleted.is.null`;
    const res = await fetch(url, { headers: { ...this._headers(), 'Prefer': 'count=exact' } });
    if (!res.ok) { const err = await res.json().catch(() => ({ message: 'API Error' })); throw new Error(err.message || `HTTP ${res.status}`); }
    const data  = await res.json();
    const total = parseInt(res.headers.get('content-range')?.split('/')[1] || '0');
    return { data: Array.isArray(data) ? data : [], total, page, limit };
  },
  async get(table, id) {
    const url  = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&limit=1`;
    const data = await this._fetch(url);
    if (Array.isArray(data) && data.length > 0) return data[0];
    return null;
  },
  async create(table, data) {
    const now = Date.now();
    const payload = { ...data, created_at: data.created_at || now, updated_at: data.updated_at || now };
    const url = `${SUPABASE_URL}/rest/v1/${table}`;
    const result = await this._fetch(url, { method: 'POST', body: JSON.stringify(payload) });
    if (Array.isArray(result)) return result[0];
    return result;
  },
  async update(table, id, data) {
    const payload = { ...data, updated_at: Date.now() };
    const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
    const result = await this._fetch(url, { method: 'PATCH', body: JSON.stringify(payload) });
    if (Array.isArray(result)) return result[0];
    return result;
  },
  async patch(table, id, data) {
    const payload = { ...data, updated_at: Date.now() };
    const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
    const result = await this._fetch(url, { method: 'PATCH', body: JSON.stringify(payload) });
    if (Array.isArray(result)) return result[0];
    return result;
  },
  async delete(table, id) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
    await this._fetch(url, { method: 'PATCH', body: JSON.stringify({ deleted: true, updated_at: Date.now() }) });
    return null;
  },
};

const Toast = {
  container: null,
  init() { if (!this.container) { this.container = document.createElement('div'); this.container.className = 'toast-container'; document.body.appendChild(this.container); } },
  show(msg, type = 'info', duration = 3500) {
    this.init();
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info} toast-icon"></i><span class="toast-msg">${msg}</span><button class="toast-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>`;
    this.container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  },
  success: (m, d) => Toast.show(m, 'success', d),
  error:   (m, d) => Toast.show(m, 'error', d),
  warning: (m, d) => Toast.show(m, 'warning', d),
  info:    (m, d) => Toast.show(m, 'info', d),
};

const Confirm = {
  show({ title, desc, confirmText = '확인', confirmClass = 'btn-primary', icon = '❓' }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay show';
      overlay.dataset.dynamic = 'true';
      overlay.innerHTML = `<div class="confirm-dialog"><div class="confirm-icon">${icon}</div><div class="confirm-title">${title}</div><div class="confirm-desc">${desc}</div><div class="confirm-actions"><button class="btn btn-ghost" id="confirmCancel">취소</button><button class="btn ${confirmClass}" id="confirmOk">${confirmText}</button></div></div>`;
      document.body.appendChild(overlay);
      const dismiss = (result) => { overlay.remove(); resolve(result); };
      overlay.querySelector('#confirmCancel').onclick = () => dismiss(false);
      overlay.querySelector('#confirmOk').onclick    = () => dismiss(true);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(false); });
    });
  },
  delete: (name) => Confirm.show({ title: '삭제 확인', desc: `"${name}"을(를) 삭제하시겠습니까?<br>이 작업은 되돌릴 수 없습니다.`, confirmText: '삭제', confirmClass: 'btn-danger', icon: '🗑️' }),
};

async function xlsxDownload(wb, fileName) {
  if (typeof XLSX === 'undefined') { try { await LibLoader.load('xlsx'); } catch(e) { Toast.error('엑셀 라이브러리 로드 실패.'); return; } }
  try {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob  = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.style.display = 'none'; a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click();
    setTimeout(() => { if (document.body.contains(a)) document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
  } catch(e) { Toast.error('엑셀 다운로드 실패: ' + (e.message || String(e))); }
}

const Utils = {
  formatDate(dt, type = 'date') {
    if (!dt) return '-';
    const d = new Date(isNaN(dt) ? dt : Number(dt));
    if (isNaN(d)) return '-';
    const yy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0'), min = String(d.getMinutes()).padStart(2,'0');
    if (type === 'date')     return `${yy}.${mm}.${dd}`;
    if (type === 'datetime') return `${yy}.${mm}.${dd} ${hh}:${min}`;
    if (type === 'time')     return `${hh}:${min}`;
    return `${yy}.${mm}.${dd}`;
  },
  formatDuration(minutes) {
    if (!minutes || minutes <= 0) return '-';
    const mins = Number(minutes), h = Math.floor(mins/60), m = mins%60;
    return `${h}:${String(m).padStart(2,'0')}`;
  },
  formatDurationLong(minutes) {
    if (!minutes || minutes <= 0) return '-';
    const h = Math.floor(minutes/60), m = minutes%60;
    if (h === 0) return `${m}분`; if (m === 0) return `${h}시간`; return `${h}시간 ${m}분`;
  },
  calcDurationMinutes(start, end) {
    if (!start || !end) return 0;
    const s = new Date(start), e = new Date(end);
    if (isNaN(s) || isNaN(e) || e <= s) return 0;
    return Math.round((e - s) / 60000);
  },
  statusBadge(status) {
    if (status === 'approved') return `<span style="font-size:11.5px;color:var(--text-muted);font-weight:500">최종승인</span>`;
    const map = { draft: { label: '임시저장', cls: 'badge-gray' }, submitted: { label: '1차검토중', cls: 'badge-yellow' }, pre_approved: { label: '2차검토중', cls: 'badge-blue' }, rejected: { label: '반려', cls: 'badge-red' }, active: { label: '진행중', cls: 'badge-blue' }, hold: { label: '보류', cls: 'badge-yellow' } };
    const info = map[status] || { label: status, cls: 'badge-gray' };
    return `<span class="badge ${info.cls} status-badge">${info.label}</span>`;
  },
  fileBadge(type, name) {
    const map = { excel: { label: 'Excel', cls: 'file-excel', icon: 'fa-file-excel' }, word: { label: 'Word', cls: 'file-word', icon: 'fa-file-word' }, ppt: { label: 'PPT', cls: 'file-ppt', icon: 'fa-file-powerpoint' }, pdf: { label: 'PDF', cls: 'file-pdf', icon: 'fa-file-pdf' } };
    const t = map[type] || { label: type, cls: '', icon: 'fa-file' };
    return `<span class="badge ${t.cls} file-badge"><i class="fas ${t.icon}"></i> ${name || t.label}</span>`;
  },
  getFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['xlsx','xls'].includes(ext)) return 'excel';
    if (['docx','doc'].includes(ext)) return 'word';
    if (['pptx','ppt'].includes(ext)) return 'ppt';
    if (ext === 'pdf') return 'pdf';
    return null;
  },
  isAllowedFile(filename) { return !!this.getFileType(filename); },
  formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)}KB`;
    return `${(bytes/1024/1024).toFixed(1)}MB`;
  },
  roleBadge(role) { return `<span class="badge ${ROLE_COLOR[role] || 'badge-gray'}">${ROLE_LABEL[role] || role}</span>`; },
  async hashPassword(pw) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(pw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  },
  async parseExcel(file) {
    if (typeof XLSX === 'undefined') await LibLoader.load('xlsx');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => { try { const wb = XLSX.read(e.target.result, { type: 'array' }); const sheet = wb.Sheets[wb.SheetNames[0]]; resolve(XLSX.utils.sheet_to_json(sheet, { defval: '' })); } catch (err) { reject(err); } };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  },
  paginationHTML(current, total, callbackFnOrPerPage, perPageOrUndefined) {
    let totalPages, callbackFn;
    if (typeof callbackFnOrPerPage === 'string') { callbackFn = callbackFnOrPerPage; totalPages = Math.ceil(total / (perPageOrUndefined || 20)); }
    else { callbackFn = 'changePage'; totalPages = Math.ceil(total / (callbackFnOrPerPage || 20)); }
    if (totalPages <= 1) return '';
    let html = '<div class="pagination">';
    html += `<button class="page-btn" onclick="${callbackFn}(${current-1})" ${current===1?'disabled':''}><i class="fas fa-chevron-left"></i></button>`;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= current-2 && i <= current+2)) html += `<button class="page-btn ${i===current?'active':''}" onclick="${callbackFn}(${i})">${i}</button>`;
      else if (i === current-3 || i === current+3) html += `<span style="color:var(--text-muted);font-size:12px">···</span>`;
    }
    html += `<button class="page-btn" onclick="${callbackFn}(${current+1})" ${current===totalPages?'disabled':''}><i class="fas fa-chevron-right"></i></button></div>`;
    return html;
  },
  debounce(fn, ms = 300) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; },
  escHtml(str) { if (str == null) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); },
  todayStr() { return new Date().toISOString().substring(0,10); },
};

const Cache = {
  _store: {}, _pending: {},
  async get(key, fetcher, ttl = 180000) {
    const now = Date.now();
    if (this._store[key] && now - this._store[key].at < ttl) return this._store[key].data;
    if (this._pending[key]) return this._pending[key];
    this._pending[key] = (async () => { try { const data = await fetcher(); this._store[key] = { data, at: Date.now() }; return data; } finally { delete this._pending[key]; } })();
    return this._pending[key];
  },
  invalidate(key) { delete this._store[key]; delete this._pending[key]; },
  invalidateAll() { this._store = {}; this._pending = {}; },
};

const MASTER_TTL = 300000;
const Master = {
  async teams()         { return Cache.get('teams',          async () => { const r = await API.list('teams',              { limit: 500 }); return (r && r.data) ? r.data : []; }, MASTER_TTL); },
  async clients()       { return Cache.get('clients',        async () => { const r = await API.list('clients',            { limit: 500 }); return (r && r.data) ? r.data : []; }, MASTER_TTL); },
  async categories()    { return Cache.get('categories',     async () => { const r = await API.list('work_categories',    { limit: 200 }); return (r && r.data) ? r.data.sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)) : []; }, MASTER_TTL); },
  async subcategories() { return Cache.get('subcategories',  async () => { const r = await API.list('work_subcategories', { limit: 500 }); return (r && r.data) ? r.data.sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)) : []; }, MASTER_TTL); },
  async cases()         { return Cache.get('cases',          async () => { const r = await API.list('cases',              { limit: 500 }); return (r && r.data) ? r.data : []; }, MASTER_TTL); },
  async users()         { return Cache.get('users',          async () => { const r = await API.list('users',              { limit: 500 }); return (r && r.data) ? r.data : []; }, MASTER_TTL); },
  invalidate(key) { Cache.invalidate(key); },
  invalidateAll() { Cache.invalidateAll(); },
};

async function fillSelect(elId, items, valueKey, labelKey, placeholder = '선택하세요', selectedVal = '') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `<option value="">${placeholder}</option>`;
  (items || []).forEach(item => {
    const opt = document.createElement('option');
    opt.value = item[valueKey]; opt.textContent = item[labelKey];
    if (selectedVal && String(item[valueKey]) === String(selectedVal)) opt.selected = true;
    el.appendChild(opt);
  });
}

const ClientSearchSelect = (() => {
  const _state = {};

  function _render(wid) {
    const wrap = document.getElementById(wid);
    if (!wrap) return;
    const s = _state[wid], val = s.selected;
    wrap.innerHTML = `
      <div class="cs-root" style="position:relative">
        ${val.id
          ? `<div class="cs-selected-box form-control"
                style="display:flex;align-items:center;justify-content:space-between;
                       cursor:pointer;padding:6px 10px;min-height:38px;user-select:none"
                onclick="ClientSearchSelect._openSearch('${wid}')">
              <span style="font-size:13px;font-weight:500">${Utils.escHtml(val.name)}</span>
              <span style="display:flex;gap:6px;align-items:center">
                <i class="fas fa-exchange-alt" style="color:var(--text-muted);font-size:11px" title="변경"></i>
                <i class="fas fa-times" style="color:var(--text-muted);font-size:12px"
                   onclick="event.stopPropagation();ClientSearchSelect.clear('${wid}')" title="초기화"></i>
              </span>
            </div>`
          : `<div class="cs-search-box" style="position:relative">
              <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);
                 color:var(--text-muted);font-size:12px;pointer-events:none"></i>
              <input type="text" class="form-control cs-input-${wid}" id="cs-input-${wid}"
                     style="padding-left:30px;font-size:13px"
                     placeholder="${s.placeholder || '고객사 검색/선택'}"
                     oninput="ClientSearchSelect._onInput('${wid}', this.value)"
                     onkeydown="ClientSearchSelect._onKey(event,'${wid}')"
                     onfocus="ClientSearchSelect._showDropdown('${wid}', this.value)"
                     autocomplete="off" />
              <div id="cs-dropdown-${wid}" class="cs-dropdown"
                   style="display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;
                          background:#fff;border:1px solid var(--border-light);border-radius:8px;
                          box-shadow:0 4px 20px rgba(0,0,0,0.12);z-index:3000;
                          max-height:220px;overflow-y:auto"></div>
            </div>`
        }
      </div>`;
  }

  function _showDropdown(wid, query) {
    const s = _state[wid];
    if (!s) return;
    const ddEl = document.getElementById(`cs-dropdown-${wid}`);
    if (!ddEl) return;
    const q = (query || '').trim().toLowerCase();
    const filtered = q ? s.clients.filter(c => (c.company_name || c.name || '').toLowerCase().includes(q)) : s.clients;
    if (filtered.length === 0) {
      ddEl.innerHTML = `<div style="padding:10px 14px;color:var(--text-muted);font-size:13px">검색 결과 없음</div>`;
    } else {
      ddEl.innerHTML = filtered.slice(0, 50).map(c => {
        const lbl = c.company_name || c.name || '';
        const hi  = q ? lbl.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'), '<mark style="background:#fef9c3;border-radius:2px;padding:0 1px">$1</mark>') : lbl;
        return `<div class="cs-item" data-id="${c.id}" data-name="${Utils.escHtml(lbl)}"
                     style="padding:9px 14px;cursor:pointer;font-size:13px;
                            border-bottom:1px solid #f1f5f9;transition:background .1s"
                     onmouseover="this.style.background='#f0f7ff'"
                     onmouseout="this.style.background=''"
                     onclick="ClientSearchSelect._pick('${wid}','${c.id}','${lbl.replace(/'/g,"\\'")}')">
                  ${hi}
                </div>`;
      }).join('');
    }
    ddEl.style.display = '';
    if (!s._outsideHandler) {
      s._outsideHandler = (e) => {
        const root = document.getElementById(`cs-dropdown-${wid}`);
        const inp  = document.getElementById(`cs-input-${wid}`);
        if (root && !root.contains(e.target) && e.target !== inp) root.style.display = 'none';
      };
      document.addEventListener('click', s._outsideHandler, true);
    }
  }

  function _onInput(wid, val) { _showDropdown(wid, val); }

  function _onKey(e, wid) {
    const ddEl = document.getElementById(`cs-dropdown-${wid}`);
    if (!ddEl || ddEl.style.display === 'none') return;
    const items = ddEl.querySelectorAll('.cs-item');
    let cur = Array.from(items).findIndex(i => i.classList.contains('cs-focused'));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cur >= 0) items[cur].classList.remove('cs-focused');
      cur = (cur + 1) % items.length;
      items[cur].classList.add('cs-focused'); items[cur].style.background = '#f0f7ff';
      items[cur].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cur >= 0) items[cur].classList.remove('cs-focused');
      cur = (cur - 1 + items.length) % items.length;
      items[cur].classList.add('cs-focused'); items[cur].style.background = '#f0f7ff';
      items[cur].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cur >= 0) { const item = items[cur]; _pick(wid, item.dataset.id, item.dataset.name); }
    } else if (e.key === 'Escape') { ddEl.style.display = 'none'; }
  }

  function _openSearch(wid) {
    const s = _state[wid];
    if (!s) return;
    s.selected = { id: '', name: '' };
    _render(wid);
    setTimeout(() => { const inp = document.getElementById(`cs-input-${wid}`); if (inp) { inp.focus(); _showDropdown(wid, ''); } }, 50);
  }

  function _pick(wid, id, name) {
    const s = _state[wid];
    if (!s) return;
    s.selected = { id, name };
    if (s._outsideHandler) { document.removeEventListener('click', s._outsideHandler, true); s._outsideHandler = null; }
    _render(wid);
    if (typeof s.onSelect === 'function') s.onSelect(id, name);
  }

  return {
    init(wid, clients, opts = {}) {
      if (_state[wid] && _state[wid]._outsideHandler) document.removeEventListener('click', _state[wid]._outsideHandler, true);
      _state[wid] = { clients: clients || [], selected: { id: '', name: '' }, placeholder: opts.placeholder || '고객사 검색/선택', onSelect: opts.onSelect || null, _outsideHandler: null };
      _render(wid);
    },
    setValue(wid, id, name) { if (!_state[wid]) return; _state[wid].selected = { id: id || '', name: name || '' }; _render(wid); },
    getValue(wid) { return _state[wid] ? { ..._state[wid].selected } : { id: '', name: '' }; },
    clear(wid) {
      if (!_state[wid]) return;
      if (_state[wid]._outsideHandler) { document.removeEventListener('click', _state[wid]._outsideHandler, true); _state[wid]._outsideHandler = null; }
      _state[wid].selected = { id: '', name: '' };
      _render(wid);
      if (typeof _state[wid].onSelect === 'function') _state[wid].onSelect('', '');
    },
    _openSearch, _onInput, _onKey, _showDropdown, _pick,
  };
})();

function navigateTo(page) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const section = document.getElementById(`page-${page}`);
  if (section) section.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(item => { item.classList.toggle('active', item.dataset.page === page); });
  document.querySelector('.sidebar')?.classList.remove('open');
}

function toggleSidebar() { document.querySelector('.sidebar')?.classList.toggle('open'); }

function setupMenuByRole(session) {
  const role = session ? session.role : '';
  const hasApprover = Auth.hasApprover(session);
  const isStaffWithApprover  = Auth.isStaff(session) && hasApprover;
  const isStaffNoApprover    = Auth.isStaff(session) && !hasApprover;
  const canApprove           = Auth.canApprove(session);
  const canViewDeptScope     = Auth.canViewDeptScope(session);
  const canAnalysis          = Auth.canViewAnalysis(session);
  const isMaster             = Auth.canManageMaster(session);
  const isManagerTimesheetTarget = Auth.isManager(session) && session.is_timesheet_target !== false;
  const showTS = isStaffWithApprover || isManagerTimesheetTarget;

  const tsSection   = document.getElementById('menu-timesheet-section');
  const entryMenu   = document.getElementById('menu-entry-new');
  const myEntryMenu = document.getElementById('menu-my-entries');
  if (tsSection)    tsSection.style.display   = showTS ? '' : 'none';
  if (entryMenu)    entryMenu.style.display    = showTS ? '' : 'none';
  if (myEntryMenu)  myEntryMenu.style.display  = showTS ? '' : 'none';

  const mgmtSection = document.getElementById('menu-management-section');
  const showMgmt = canApprove || canViewDeptScope;
  if (mgmtSection) mgmtSection.style.display = showMgmt ? '' : 'none';

  const approvalMenu = document.getElementById('menu-approval');
  if (approvalMenu) approvalMenu.style.display = (canApprove || canViewDeptScope) ? '' : 'none';

  const analysisMenu = document.getElementById('menu-analysis');
  if (analysisMenu) analysisMenu.style.display = canAnalysis ? '' : 'none';

  const archiveMenu = document.getElementById('menu-archive');
  if (archiveMenu) archiveMenu.style.display = '';

  const masterMenus = document.querySelectorAll('.menu-master');
  masterMenus.forEach(m => m.style.display = isMaster ? '' : 'none');

  const canRefData  = Auth.canManageRefData(session);
  const refDataMenus = document.querySelectorAll('.menu-ref-data');
  refDataMenus.forEach(m => m.style.display = canRefData ? '' : 'none');

  const settingsSection = document.querySelector('.menu-settings-section');
  if (settingsSection) settingsSection.style.display = (isMaster || canRefData) ? '' : 'none';

  _showNoApproverBanner(isStaffNoApprover);
}

function _showNoApproverBanner(show) {
  let banner = document.getElementById('no-approver-banner');
  if (!show) { if (banner) banner.style.display = 'none'; return; }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'no-approver-banner';
    banner.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1e3a5f;color:#fff;border-radius:10px;padding:12px 20px;font-size:13px;z-index:9999;display:flex;align-items:center;gap:10px;box-shadow:0 4px 20px rgba(0,0,0,0.25);max-width:420px;`;
    banner.innerHTML = `<i class="fas fa-info-circle" style="font-size:16px;color:#60a5fa;flex-shrink:0"></i><span>승인자가 지정되지 않아 <strong>자문 자료실</strong>만 이용 가능합니다.<br><span style="font-size:11.5px;opacity:0.8">관리자에게 승인자 지정을 요청하세요.</span></span>`;
    document.body.appendChild(banner);
  }
  banner.style.display = 'flex';
}

function getInitial(name) { if (!name) return '?'; return name.charAt(0).toUpperCase(); }

let _badgeLastUpdated = 0;
async function updateApprovalBadge(session, force = false) {
  if (!Auth.canApprove1st(session) && !Auth.canApprove2nd(session)) return;
  const now = Date.now();
  if (!force && now - _badgeLastUpdated < 30000) return;
  _badgeLastUpdated = now;
  try {
    const r = await Cache.get('time_entries_badge_' + session.id, async () => { return API.list('time_entries', { limit: 500 }); }, 120000);
    if (r && r.data) {
      let count = 0;
      if (Auth.canApprove1st(session)) {
        count = r.data.filter(e => e.status === 'submitted' && String(e.approver_id) === String(session.id)).length;
      } else if (Auth.canApprove2nd(session)) {
        const allUsers = await Master.users();
        const scopeIds = new Set(allUsers.filter(u => Auth.scopeMatch(session, u)).map(u => String(u.id)));
        const preApproved  = r.data.filter(e => e.status === 'pre_approved' && scopeIds.has(String(e.user_id))).length;
        const managerDirect = r.data.filter(e => e.status === 'submitted' && String(e.approver_id) === String(session.id)).length;
        count = preApproved + managerDirect;
      }
      const badge = document.getElementById('approval-badge');
      if (badge) { badge.textContent = count; badge.style.display = count > 0 ? '' : 'none'; }
    }
  } catch {}
}

const BtnLoading = {
  start(btn, loadingText = '처리 중...') {
    if (!btn) return () => {};
    const originalHTML = btn.innerHTML, originalDisabled = btn.disabled, originalOpacity = btn.style.opacity, originalCursor = btn.style.cursor;
    btn.disabled = true; btn.style.opacity = '0.75'; btn.style.cursor = 'not-allowed';
    btn.innerHTML = `<i class="fas fa-spinner fa-spin" style="margin-right:5px"></i>${loadingText}`;
    return function restore() { btn.innerHTML = originalHTML; btn.disabled = originalDisabled; btn.style.opacity = originalOpacity; btn.style.cursor = originalCursor; };
  },
  startById(id, loadingText = '처리 중...') { return BtnLoading.start(document.getElementById(id), loadingText); },
  disableAll(...btns) {
    btns.forEach(b => { if (b) { b.disabled = true; b.style.opacity = '0.6'; b.style.cursor = 'not-allowed'; } });
    return () => btns.forEach(b => { if (b) { b.disabled = false; b.style.opacity = ''; b.style.cursor = ''; } });
  },
};

async function migrateDirectorsToAdmin() {
  const TARGET_NAMES = ['하두식', '박주경', '안만복'];
  const session = Session.get();
  if (!session || session.role !== 'admin') { console.warn('[Migration] admin 계정으로 로그인 후 실행하세요.'); return; }
  try {
    const r = await API.list('users', { limit: 500 });
    const users = (r && r.data) ? r.data : [];
    const targets = users.filter(u => TARGET_NAMES.includes(u.name) && u.role === 'director');
    if (targets.length === 0) { console.log('[Migration] 변경 대상 없음'); return; }
    for (const u of targets) { await API.patch('users', u.id, { role: 'admin' }); console.log(`[Migration] ✅ ${u.name} → admin`); }
    Master.invalidate('users');
    Toast.success(`마이그레이션 완료: ${targets.map(u=>u.name).join(', ')} → admin`);
  } catch (e) { console.error('[Migration] 실패:', e); }
}
