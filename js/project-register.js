/* project-register.js — 프로젝트 등록 (staff+ manager+ director+ top_mgr+ admin) */
/* DB: registered_projects, fn_allocate_project_code — dev_schema_registered_projects.sql */

let _projRegRows = [];
let _projRegTypes = [];
let _projRegClients = [];
/** Master.users() 캐시 — 목록 필터(CPM)용 */
let _projRegUsers = [];
let _projRegListFiltersBound = false;

const _PROJ_REG_AMT_IDS = [
  'proj-reg-bill-down-amt',
  'proj-reg-bill-interim-amt',
  'proj-reg-bill-final-amt',
  'proj-reg-bill-add-amt',
  'proj-reg-bill-success-amt',
];

let _projRegClientSearchBound = false;
let _projRegAmtBound = false;

const _PROJ_ROUTE_TYPES = ['신규 발굴', '기존 확장', '단순 수주', '외부 소개', '경쟁 입찰', '기타 수주'];
const _PROJ_ROUTE_GUIDES = {
  '신규 발굴': '가이드: 최초 접촉 경로, 영업 전개 내용, 직접 발굴 증빙(메일/미팅노트/제안서)을 작성·첨부하세요.',
  '기존 확장': '가이드: 고객 Pain-point, 선제 제안 핵심, 제안 증빙(메일/제안서/회의록)을 작성·첨부하세요.',
  '단순 수주': '가이드: 고객 요청 내용, 접수·대응 경로(시점/채널/담당), 요청 증빙(메일/공문/회의록)을 작성·첨부하세요.',
  '외부 소개': '가이드: 소개자 정보, 실제 제안/영업 수행자, 소개·후속 커뮤니케이션 증빙을 작성·첨부하세요.',
  '경쟁 입찰': '가이드: 팀원별 역할, 수주 핵심 요인(Winning Point), RFP/평가 관련 증빙을 작성·첨부하세요.',
  '기타 수주': '가이드: 수주 배경, 진행 흐름·의사결정 포인트, 관련 근거자료를 작성·첨부하세요.',
};

let _projRegContributors = [];
let _projRegContractDocs = [];
let _projRegContractDocFiltersBound = false;
let _projRegOpenedFromApprovalDetail = false;

const _PROJ_REG_STORAGE_BUCKETS = {
  contract: 'registered-project-contracts',
  agreement: 'registered-project-agreements',
  route: 'registered-project-route-evidence',
};

function _projRegMonthToYymm(monthVal) {
  if (!monthVal || !/^\d{4}-\d{2}$/.test(monthVal)) return '';
  const [y, m] = monthVal.split('-');
  return String(parseInt(y, 10) % 100).padStart(2, '0') + m;
}

function _projRegSetDefaultMonth() {
  const el = document.getElementById('proj-reg-yymm');
  if (!el) return;
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  el.value = `${y}-${mo}`;
}

function _projRegIsCpmEligible(u) {
  const r = u && u.role;
  return r === 'manager' || r === 'director' || r === 'top_mgr' || r === 'admin';
}

function _projRegParseDigits(v) {
  return String(v || '').replace(/[^\d]/g, '');
}

function _projRegAmtValue(id) {
  const raw = _projRegParseDigits(document.getElementById(id)?.value || '');
  if (raw === '') return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function _projRegNoteVal(id) {
  const t = document.getElementById(id)?.value?.trim() || '';
  return t ? t : null;
}

function _projRegNormStatus(r) {
  const s = String((r && r.registration_status) || '').trim().toLowerCase();
  if (s === 'draft' || s === 'pending' || s === 'rejected') return s;
  return 'approved';
}

function _projRegStatusLabel(st, row) {
  if (st === 'approved' && row && row.conditional_approval === true) return '조건부승인';
  const m = { draft: '임시저장', pending: '승인대기', approved: '승인완료', rejected: '반려' };
  return m[st] || st || '-';
}

function _projRegStatusBadgeClass(st, row) {
  if (st === 'draft') return 'badge badge-gray';
  if (st === 'pending') return 'badge badge-yellow';
  if (st === 'rejected') return 'badge badge-red';
  if (st === 'approved' && row && row.conditional_approval === true) return 'badge badge-amber';
  return 'badge badge-green';
}

function _projRegYymmFromCode(code) {
  const parts = String(code || '').split('_');
  if (parts.length < 4) return '';
  const y = parts[2];
  return /^\d{4}$/.test(y) ? y : '';
}

function _projRegYymmToMonthValue(yymm) {
  if (!yymm || yymm.length !== 4) return '';
  const yy = parseInt(yymm.slice(0, 2), 10);
  const mm = yymm.slice(2, 4);
  if (!Number.isFinite(yy) || !/^\d{2}$/.test(mm)) return '';
  const fullY = 2000 + yy;
  return `${fullY}-${mm}`;
}

function _projRegIsOwner(session, r) {
  if (!r || !session) return false;
  const creatorId = String(r.created_by || '').trim();
  if (!creatorId) return false;
  const myIds = new Set([
    String(session.id || '').trim(),
    String(session.user_id || '').trim(),
  ].filter(Boolean));
  return myIds.has(creatorId);
}

async function _projRegRegistrantSnapshot(session) {
  let u = null;
  let users = [];
  try {
    users = await Master.users();
    u = users.find((x) => String(x.id) === String(session.id)) || null;
  } catch (_) {}
  const myRole = String((u && u.role) || session.role || '').trim().toLowerCase();
  const pa1Id = String((u && u.approver_id) || session.approver_id || '').trim();
  const pa1Name = String((u && u.approver_name) || session.approver_name || '').trim();
  const pa2Id = String((u && u.reviewer2_id) || session.reviewer2_id || '').trim();
  const pa2Name = String((u && u.reviewer2_name) || session.reviewer2_name || '').trim();
  // 프로젝트 승인(인센티브): staff 등록 건은 3차(사업부장/top_mgr) 최종 승인
  let pa3Id = '';
  let pa3Name = '';
  if (myRole === 'staff' && Array.isArray(users) && users.length) {
    const pickScore = (cand) => {
      if (!cand || String(cand.role || '').toLowerCase() !== 'top_mgr') return -1;
      let s = 0;
      if (u && u.dept_id && cand.dept_id && String(u.dept_id) === String(cand.dept_id)) s += 100;
      if (u && u.hq_id && cand.hq_id && String(u.hq_id) === String(cand.hq_id)) s += 40;
      if (u && u.cs_team_id && cand.cs_team_id && String(u.cs_team_id) === String(cand.cs_team_id)) s += 20;
      return s;
    };
    const sorted = users
      .filter((x) => String(x && x.role || '').toLowerCase() === 'top_mgr')
      .map((x) => ({ x, score: pickScore(x) }))
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return String(a.x.name || '').localeCompare(String(b.x.name || ''));
      });
    const picked = sorted.length ? sorted[0].x : null;
    if (picked) {
      pa3Id = String(picked.id || '').trim();
      pa3Name = String(picked.name || '').trim();
    }
  }
  return { pa1Id, pa1Name, pa2Id, pa2Name, pa3Id, pa3Name };
}

function _projRegEffectiveApprovers(row) {
  const a1 = String((row && row.reg_pa1_id) || '').trim();
  const a2 = String((row && row.reg_pa2_id) || '').trim();
  const a3 = String((row && row.reg_pa3_id) || '').trim();
  const ordered = [a1, a2, a3].filter(Boolean);
  const uniq = [];
  ordered.forEach((id) => {
    if (!uniq.includes(id)) uniq.push(id);
  });
  return {
    pa1: uniq[0] || '',
    pa2: uniq[1] || '',
    pa3: uniq[2] || '',
    count: uniq.length,
    chain: uniq,
  };
}

function _projRegPendingStep(row) {
  if (_projRegNormStatus(row) !== 'pending') return null;
  const eff = _projRegEffectiveApprovers(row);
  const cnt = Number(eff.count || 0);
  if (!cnt) return null;
  if (!row.first_approved_at) return 1;
  if (cnt >= 3) {
    if (!row.second_approved_at) return 2;
    if (!row.final_approved_at) return 3;
    return null;
  }
  if (cnt >= 2 && !row.final_approved_at) return 2;
  return null;
}

function _projRegCanApproveRow(session, row) {
  if (session && session.role === 'admin') return _projRegNormStatus(row) === 'pending';
  const step = _projRegPendingStep(row);
  if (!step) return false;
  const myIds = new Set([
    String(session && session.id || '').trim(),
    String(session && session.user_id || '').trim(),
  ].filter(Boolean));
  if (!myIds.size) return false;
  const eff = _projRegEffectiveApprovers(row);
  const targetId = String((eff.chain && eff.chain[step - 1]) || '');
  if (targetId) return myIds.has(targetId);
  return false;
}

function _projRegCodeMatchesForm(row, typeId, yymm) {
  if (!row || !row.project_code || !typeId || !yymm) return false;
  if (String(row.project_code_type_id || '') !== String(typeId)) return false;
  return _projRegYymmFromCode(row.project_code) === yymm;
}

function _projRegNotifyProjectSubmit({ rowId, projectCode, projectName, clientName, pa1Id, pa1Name, pa2Id, pa2Name, pa3Id, pa3Name, fromSession }) {
  if (typeof createNotification !== 'function') return;
  const codeTxt = String(projectCode || '').trim();
  const nameTxt = String(projectName || '').trim();
  const clientTxt = String(clientName || '').trim();
  const summary = _projRegNotificationSummary({
    clientName: clientTxt,
    projectName: nameTxt,
    projectCode: codeTxt,
  });
  const msgBase = `${fromSession?.name || '등록자'}님이 프로젝트 승인을 요청했습니다.`;
  // 제출 직후 대기 단계의 승인자에게만 알림 전송
  if (pa1Id) {
    createNotification({
      toUserId: pa1Id,
      toUserName: pa1Name || '',
      fromUserId: fromSession?.id || '',
      fromUserName: fromSession?.name || '',
      type: 'submitted',
      entryId: rowId || '',
      entrySummary: summary,
      message: `${msgBase}${clientTxt ? ` 고객사: ${clientTxt}.` : ''}`,
      targetMenu: 'approval:project',
    });
    return;
  }
  if (pa2Id) {
    createNotification({
      toUserId: pa2Id,
      toUserName: pa2Name || '',
      fromUserId: fromSession?.id || '',
      fromUserName: fromSession?.name || '',
      type: 'submitted',
      entryId: rowId || '',
      entrySummary: summary,
      message: `${msgBase}${clientTxt ? ` 고객사: ${clientTxt}.` : ''}`,
      targetMenu: 'approval:project',
    });
    return;
  }
  if (pa3Id) {
    createNotification({
      toUserId: pa3Id,
      toUserName: pa3Name || '',
      fromUserId: fromSession?.id || '',
      fromUserName: fromSession?.name || '',
      type: 'submitted',
      entryId: rowId || '',
      entrySummary: summary,
      message: `${msgBase}${clientTxt ? ` 고객사: ${clientTxt}.` : ''}`,
      targetMenu: 'approval:project',
    });
  }
}

function _projRegNotificationSummary({ clientName, projectName, projectCode }) {
  const c = String(clientName || '').trim();
  const n = String(projectName || '').trim();
  const code = String(projectCode || '').trim();
  const left = c || '프로젝트';
  const right = n || code || '';
  return `${left} | ${right}`;
}

function _projRegNotifyProjectFinalResult({ row, decision, fromSession, reason }) {
  if (typeof createNotification !== 'function' || !row) return;
  const toUserId = String(row.created_by || '').trim();
  if (!toUserId) return;
  if (String(fromSession?.id || '') === toUserId) return; // 자기 자신에게 중복 알림 방지
  const codeTxt = String(row.project_code || '').trim();
  const nameTxt = String(row.project_name || '').trim();
  const clientTxt = String(row.client_name || '').trim();
  const summary = _projRegNotificationSummary({
    clientName: clientTxt,
    projectName: nameTxt,
    projectCode: codeTxt,
  });
  const isRejected = String(decision || '') === 'rejected';
  const msg = isRejected
    ? `${fromSession?.name || '승인자'}님이 프로젝트를 반려했습니다. 사유를 확인하고 수정 후 재제출해주세요.${reason ? ` (반려 사유: ${String(reason).trim()})` : ''}`
    : `${fromSession?.name || '승인자'}님이 프로젝트를 최종 승인했습니다. 🎉${clientTxt ? ` 고객사: ${clientTxt}.` : ''}`;
  createNotification({
    toUserId,
    toUserName: row.created_by_name || '',
    fromUserId: fromSession?.id || '',
    fromUserName: fromSession?.name || '',
    type: isRejected ? 'rejected' : 'approved',
    entryId: row.id || '',
    entrySummary: summary,
    message: msg,
    targetMenu: 'project-register',
  });
}

function _projRegNotifyProjectNextPending({ row, fromSession, step }) {
  if (typeof createNotification !== 'function' || !row) return;
  const n = Number(step || 0);
  const sid = String(fromSession?.id || '');
  const targetId = n === 2
    ? String(row.reg_pa2_id || '').trim()
    : (n === 3 ? String(row.reg_pa3_id || '').trim() : '');
  const targetName = n === 2
    ? String(row.reg_pa2_name || '').trim()
    : (n === 3 ? String(row.reg_pa3_name || '').trim() : '');
  if (!targetId || sid === targetId) return;
  const codeTxt = String(row.project_code || '').trim();
  const nameTxt = String(row.project_name || '').trim();
  const summary = _projRegNotificationSummary({
    clientName: row.client_name,
    projectName: nameTxt,
    projectCode: codeTxt,
  });
  createNotification({
    toUserId: targetId,
    toUserName: targetName,
    fromUserId: fromSession?.id || '',
    fromUserName: fromSession?.name || '',
    type: 'submitted',
    entryId: row.id || '',
    entrySummary: summary,
    message: n === 2
      ? `${fromSession?.name || '승인자'}님이 프로젝트를 1차 승인했습니다. 2차 승인 검토를 진행해주세요.`
      : `${fromSession?.name || '승인자'}님이 프로젝트를 2차 승인했습니다. 3차 최종 승인 검토를 진행해주세요.`,
    targetMenu: 'approval:project',
  });
}

function projRegSetFormFieldsDisabled(disabled) {
  const root = document.querySelector('.proj-reg-main-col');
  if (!root) return;
  root.querySelectorAll('input,select,textarea').forEach((el) => {
    if (el.type === 'hidden') return;
    el.disabled = !!disabled;
  });
}

function projRegUpdateFormFooter(session, editId, row) {
  const st = editId && row ? _projRegNormStatus(row) : 'draft';
  const owner = !editId || _projRegIsOwner(session, row);
  const canAp = row && st === 'pending' && _projRegCanApproveRow(session, row);
  const footDraft = document.getElementById('proj-reg-footer-draft');
  const footRedirect = document.getElementById('proj-reg-footer-approval-redirect');
  const btnAppr = document.getElementById('proj-reg-btn-save-approved');
  const banner = document.getElementById('proj-reg-status-banner');
  if (banner) {
    banner.hidden = !editId || !row;
    if (!banner.hidden) {
      banner.textContent = '';
      const badge = document.createElement('span');
      badge.className = _projRegStatusBadgeClass(st, row);
      badge.textContent = _projRegStatusLabel(st, row);
      banner.appendChild(badge);
      const step = st === 'pending' ? _projRegPendingStep(row) : null;
      if (st === 'pending' && step === 1) banner.appendChild(document.createTextNode(' (1차 승인 대기)'));
      else if (st === 'pending' && step === 2) banner.appendChild(document.createTextNode(' (2차 승인 대기)'));
      else if (st === 'pending' && step === 3) banner.appendChild(document.createTextNode(' (3차 승인 대기)'));
      if (row && row.contract_exception_required === true) {
        banner.appendChild(document.createTextNode(' · 조건부 승인 심사'));
      }
      const rr = String(row.rejection_reason || '').trim();
      if (st === 'rejected' && rr) {
        banner.appendChild(document.createTextNode(' · 사유: ' + rr));
      }
    }
  }
  if (footDraft) footDraft.style.display = 'none';
  if (footRedirect) footRedirect.style.display = 'none';
  if (btnAppr) btnAppr.style.display = 'none';

  if (!editId) {
    if (footDraft) footDraft.style.display = 'inline-flex';
    projRegSetFormFieldsDisabled(false);
    return;
  }
  if (st === 'draft' && owner) {
    if (footDraft) footDraft.style.display = 'inline-flex';
    projRegSetFormFieldsDisabled(false);
    return;
  }
  if (st === 'rejected' && owner) {
    if (footDraft) footDraft.style.display = 'inline-flex';
    projRegSetFormFieldsDisabled(false);
    return;
  }
  if (st === 'approved') {
    if (btnAppr) btnAppr.style.display = 'inline-flex';
    projRegSetFormFieldsDisabled(false);
    const typeSel = document.getElementById('proj-reg-code-type');
    const yymmEl = document.getElementById('proj-reg-yymm');
    if (typeSel) typeSel.disabled = true;
    if (yymmEl) yymmEl.disabled = true;
    return;
  }
  if (st === 'pending' && canAp) {
    if (_projRegOpenedFromApprovalDetail) {
      if (footDraft) footDraft.style.display = 'inline-flex';
      projRegSetFormFieldsDisabled(false);
    } else {
      if (footRedirect) footRedirect.style.display = 'inline-flex';
      projRegSetFormFieldsDisabled(true);
    }
    return;
  }
  if (st === 'pending' && _projRegOpenedFromApprovalDetail) {
    projRegSetFormFieldsDisabled(true);
    return;
  }
  projRegSetFormFieldsDisabled(true);
}

function projRegBindAmountInputs() {
  if (_projRegAmtBound) return;
  _PROJ_REG_AMT_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('focus', () => {
      const raw = _projRegParseDigits(el.value);
      el.value = raw === '' ? '' : raw;
    });
    el.addEventListener('blur', () => {
      const raw = _projRegParseDigits(el.value);
      if (raw === '') el.value = '';
      else {
        const n = parseInt(raw, 10);
        el.value = Number.isFinite(n) ? n.toLocaleString('ko-KR') : '';
      }
    });
  });
  _projRegAmtBound = true;
}

function projRegHideClientSuggest() {
  const ul = document.getElementById('proj-reg-client-suggest');
  if (ul) {
    ul.innerHTML = '';
    ul.hidden = true;
  }
}

function projRegRenderClientSuggest(matches) {
  const ul = document.getElementById('proj-reg-client-suggest');
  if (!ul) return;
  ul.innerHTML = '';
  const lim = Math.min(matches.length, 40);
  for (let i = 0; i < lim; i++) {
    const c = matches[i];
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.clientId = c.id;
    li.dataset.clientName = c.company_name || '';
    li.textContent = c.company_name || c.id;
    ul.appendChild(li);
  }
  ul.hidden = lim === 0;
}

function projRegPickClient(id, name) {
  const hid = document.getElementById('proj-reg-client');
  const input = document.getElementById('proj-reg-client-search');
  if (hid) hid.value = id || '';
  if (input) input.value = name || '';
  projRegHideClientSuggest();
  projRegRefreshProgress();
}

function projRegOnClientSearchInput() {
  const input = document.getElementById('proj-reg-client-search');
  const hid = document.getElementById('proj-reg-client');
  if (!input || !hid) return;
  const selId = hid.value;
  if (selId) {
    const hit = _projRegClients.find((c) => String(c.id) === String(selId));
    const prevName = hit ? String(hit.company_name || '') : '';
    if (String(input.value).trim() !== prevName.trim()) {
      hid.value = '';
    }
  }
  const q = input.value.trim().toLowerCase();
  if (!q) {
    projRegHideClientSuggest();
    return;
  }
  const matches = _projRegClients.filter((c) => String(c.company_name || '').toLowerCase().includes(q));
  projRegRenderClientSuggest(matches);
}

function projRegBindClientSearch() {
  if (_projRegClientSearchBound) return;
  const input = document.getElementById('proj-reg-client-search');
  const wrap = document.querySelector('.proj-reg-client-wrap');
  if (!input || !wrap) return;
  input.addEventListener('input', projRegOnClientSearchInput);
  input.addEventListener('focus', () => {
    if (input.value.trim()) projRegOnClientSearchInput();
  });
  document.addEventListener('mousedown', (e) => {
    if (!wrap.contains(e.target)) projRegHideClientSuggest();
  });
  const ul = document.getElementById('proj-reg-client-suggest');
  if (ul) {
    ul.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-client-id]');
      if (!li) return;
      projRegPickClient(li.getAttribute('data-client-id'), li.getAttribute('data-client-name') || '');
    });
  }
  _projRegClientSearchBound = true;
}

function projRegOnRouteChange() {
  const sel = document.getElementById('proj-reg-route');
  const guide = document.getElementById('proj-reg-route-guide');
  if (!sel) return;
  if (guide) {
    const g = _PROJ_ROUTE_GUIDES[sel.value] || '가이드: 수주경로 유형을 선택하면 작성 포인트를 안내합니다.';
    guide.textContent = g;
  }
  projRegRefreshProgress();
}

function _projRegNormalizeStoredRoute(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (_PROJ_ROUTE_TYPES.includes(s)) return s;
  if (s === '소개' || s === '외부소개') return '외부 소개';
  if (s === 'RFP') return '경쟁 입찰';
  if (s === '고객의뢰') return '단순 수주';
  if (s === '프로젝트제안' || s === '재수주') return '기존 확장';
  if (s === '기타') return '기타 수주';
  return '기타 수주';
}

function projRegApplyRouteFromStored(routeVal, detailVal) {
  const v = String(routeVal || '').trim();
  const sel = document.getElementById('proj-reg-route');
  const detail = document.getElementById('proj-reg-route-detail');
  if (!sel) return;
  const normalized = _projRegNormalizeStoredRoute(v);
  sel.value = normalized;
  if (detail) {
    const baseDetail = String(detailVal || '').trim();
    if (baseDetail) detail.value = baseDetail;
    else if (normalized === '기타 수주' && v && v !== normalized) detail.value = v;
    else detail.value = '';
  }
  projRegOnRouteChange();
}

function _projRegContribNormalize(rows) {
  return (rows || []).map((r) => ({
    name: String((r && r.name) || '').trim(),
    role: String((r && r.role) || '').trim(),
    contribution: String((r && r.contribution) || '').replace(/[^\d.]/g, ''),
  }));
}

function _projRegContribParse(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return [];
  try {
    const j = JSON.parse(txt);
    if (Array.isArray(j)) return _projRegContribNormalize(j);
  } catch (_) {}
  // 하위호환: "이름(역할,40%)" 콤마 나열 텍스트
  return txt.split(',').map((part) => {
    const s = String(part || '').trim();
    const m = s.match(/^(.+?)\((.+?),\s*([\d.]+)%\)$/);
    if (!m) return { name: s, role: '', contribution: '' };
    return { name: m[1].trim(), role: m[2].trim(), contribution: m[3].trim() };
  }).filter((r) => r.name || r.role || r.contribution);
}

function _projRegContribSyncHidden() {
  const el = document.getElementById('proj-reg-order-contributors');
  if (!el) return;
  const rows = _projRegContributors.filter((r) => r.name || r.role || r.contribution);
  el.value = rows.length ? JSON.stringify(rows) : '';
}

function _projRegContribSum() {
  return _projRegContributors.reduce((acc, r) => {
    const n = parseFloat(String(r.contribution || ''));
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function _projRegRefreshContribSummary() {
  const sumEl = document.getElementById('proj-reg-contributors-sum');
  if (sumEl) {
    const sum = _projRegContribSum();
    sumEl.textContent = `기여도 합계: ${sum}%`;
    sumEl.style.color = Math.abs(sum - 100) < 0.001 ? 'var(--success, #15803d)' : 'var(--text-muted)';
  }
  _projRegContribSyncHidden();
}

function projRegRenderContributorRows() {
  const box = document.getElementById('proj-reg-contributors-rows');
  if (!box) return;
  if (!_projRegContributors.length) _projRegContributors = [{ name: '', role: '', contribution: '' }];
  box.innerHTML = _projRegContributors.map((r, i) => `
    <div class="proj-reg-contrib-row" style="display:grid;grid-template-columns:1.1fr 1fr 110px 34px;gap:8px;align-items:center">
      <input type="text" class="form-control" placeholder="이름" value="${Utils.escHtml(r.name || '')}" oninput="projRegContribUpdate(${i},'name',this)" />
      <input type="text" class="form-control" placeholder="역할" value="${Utils.escHtml(r.role || '')}" oninput="projRegContribUpdate(${i},'role',this)" />
      <input type="text" class="form-control" inputmode="decimal" placeholder="기여도(%)" value="${Utils.escHtml(r.contribution || '')}" oninput="projRegContribUpdate(${i},'contribution',this)" />
      <button type="button" class="btn btn-sm btn-icon proj-reg-contrib-remove-btn" title="삭제" aria-label="참여자 삭제" onclick="projRegRemoveContributorRow(${i})"><i class="fas fa-times"></i></button>
    </div>
  `).join('');
  _projRegRefreshContribSummary();
}

function projRegSetContributorsFromStored(raw) {
  _projRegContributors = _projRegContribParse(raw);
  projRegRenderContributorRows();
}

function projRegAddContributorRow() {
  _projRegContributors.push({ name: '', role: '', contribution: '' });
  projRegRenderContributorRows();
}

function projRegRemoveContributorRow(idx) {
  _projRegContributors.splice(idx, 1);
  projRegRenderContributorRows();
}

function projRegContribUpdate(idx, key, valueOrEl) {
  if (!_projRegContributors[idx]) return;
  const inputEl = valueOrEl && typeof valueOrEl === 'object' && 'value' in valueOrEl ? valueOrEl : null;
  let value = inputEl ? inputEl.value : valueOrEl;
  if (key === 'contribution') {
    value = String(value || '').replace(/[^\d.]/g, '');
    if (inputEl && inputEl.value !== value) inputEl.value = value;
  } else {
    value = String(value || '');
  }
  _projRegContributors[idx][key] = value;
  _projRegRefreshContribSummary();
}

function _projRegValidateContributorsForApproval() {
  const rows = _projRegContributors
    .map((r) => ({ ...r, name: String(r.name || '').trim(), role: String(r.role || '').trim(), contribution: String(r.contribution || '').trim() }))
    .filter((r) => r.name || r.role || r.contribution);
  // 수주참여자는 인센티브 산정용 선택 정보이므로 미입력 제출 허용
  if (!rows.length) return { ok: true };
  for (const r of rows) {
    if (!r.name || !r.role || !r.contribution) {
      return { ok: false, message: '수주 참여자별 이름·역할·기여도를 모두 입력하세요.' };
    }
  }
  const sum = rows.reduce((acc, r) => acc + (parseFloat(r.contribution) || 0), 0);
  if (Math.abs(sum - 100) > 0.001) return { ok: false, message: '수주 참여자 기여도 합계는 100%여야 합니다.' };
  return { ok: true };
}

function _projRegContribToRows(raw) {
  return _projRegContribParse(raw).filter((r) => r.name || r.role || r.contribution);
}

function _projRegContribRowCount(raw) {
  return _projRegContribToRows(raw).length;
}

function _projRegEscJs(v) {
  return String(v || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
}

function _projRegEncClickArg(v) {
  return encodeURIComponent(String(v || ''));
}

function projRegOpenContribModalEncoded(rawEnc, labelEnc) {
  let raw = '';
  let label = '';
  try { raw = decodeURIComponent(String(rawEnc || '')); } catch (_) { raw = String(rawEnc || ''); }
  try { label = decodeURIComponent(String(labelEnc || '')); } catch (_) { label = String(labelEnc || ''); }
  projRegOpenContribModal(raw, label);
}

function projRegOpenContribModal(raw, label) {
  const title = document.getElementById('proj-reg-contrib-modal-title');
  const empty = document.getElementById('proj-reg-contrib-modal-empty');
  const list = document.getElementById('proj-reg-contrib-modal-list');
  if (!empty || !list) return;
  if (title) title.textContent = `수주 참여자 · ${label || '프로젝트'}`;
  const rows = _projRegContribToRows(raw);
  if (!rows.length) {
    empty.style.display = '';
    list.style.display = 'none';
    list.innerHTML = '';
    openModal('projRegContribModal');
    return;
  }
  empty.style.display = 'none';
  list.style.display = 'flex';
  list.innerHTML = rows.map((r, i) => `
    <div style="border:1px solid var(--border-light);border-radius:8px;padding:10px 12px;background:#fff">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">참여자 ${i + 1}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 100px;gap:10px;font-size:13px">
        <div><strong>이름</strong><br>${Utils.escHtml(r.name || '-')}</div>
        <div><strong>역할</strong><br>${Utils.escHtml(r.role || '-')}</div>
        <div><strong>기여도</strong><br>${Utils.escHtml(r.contribution || '0')}%</div>
      </div>
    </div>
  `).join('');
  openModal('projRegContribModal');
}

async function init_project_register() {
  const session = getSession();
  if (!Auth.canManageProjectRegister(session)) {
    navigateTo('dashboard');
    Toast.warning('프로젝트 등록 권한이 없습니다.');
    return;
  }
  projRegBindClientSearch();
  projRegBindAmountInputs();
  projRegShowList(false);
  projRegBindProgress();
  await projRegLoadTypes();
  _projRegPopulateListMainSelect();
  _projRegPopulateListSubSelect();
  await projRegFillDropdowns();
  _projRegBindListFiltersOnce();
  projRegBindContractDocFiltersOnce();
  await projRegLoadList();
  if (typeof init_project_management === 'function') {
    await init_project_management();
  }
  const activePage = document.querySelector('.nav-item.active')?.dataset.page || '';
  if (typeof applyProjectPageMode === 'function') {
    applyProjectPageMode(activePage === 'project-management' ? 'manage' : 'register');
  }
}

function projRegBindContractDocFiltersOnce() {
  if (_projRegContractDocFiltersBound) return;
  const q = document.getElementById('proj-reg-contract-doc-filter-q');
  const kind = document.getElementById('proj-reg-contract-doc-filter-kind');
  if (q) q.addEventListener('input', () => projRegRenderContractDocModal());
  if (kind) kind.addEventListener('change', () => projRegRenderContractDocModal());
  _projRegContractDocFiltersBound = true;
}

function projRegShowList(reload) {
  _projRegOpenedFromApprovalDetail = false;
  const list = document.getElementById('proj-reg-list');
  const form = document.getElementById('proj-reg-form');
  if (list) list.style.display = '';
  if (form) form.style.display = 'none';
  if (reload !== false) projRegLoadList();
}

async function projRegLoadTypes() {
  try {
    _projRegTypes = await API.listAllPages('project_code_types', { limit: 500, maxPages: 5, sort: 'main_code' });
  } catch (e) {
    console.warn(e);
    _projRegTypes = [];
  }
  const sel = document.getElementById('proj-reg-code-type');
  if (!sel) return;
  sel.innerHTML = '<option value="">유형을 선택하세요</option>';
  _projRegTypes.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.main_category} · ${t.main_code} — ${t.sub_category} (${t.sub_code})`;
    opt.dataset.mainCode = t.main_code || '';
    opt.dataset.subCode = t.sub_code || '';
    opt.dataset.nameEn = t.project_name_en || '';
    sel.appendChild(opt);
  });
}

async function projRegFillDropdowns() {
  try {
    _projRegClients = await Master.clients();
  } catch (_) {
    _projRegClients = [];
  }

  let users = [];
  try {
    users = await Master.users();
  } catch (_) {
    users = [];
  }
  _projRegUsers = users;
  const cpmSel = document.getElementById('proj-reg-cpm');
  if (cpmSel) {
    const cur = cpmSel.value;
    cpmSel.innerHTML = '<option value="">선택 안 함</option>';
    users
      .filter((u) => u.deleted !== true && u.is_active !== false && _projRegIsCpmEligible(u))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .forEach((u) => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = `${u.name || '-'} (${u.email || ''})`;
        opt.dataset.name = u.name || '';
        cpmSel.appendChild(opt);
      });
    if (cur && [...cpmSel.options].some((o) => o.value === cur)) cpmSel.value = cur;
  }
  _projRegPopulateListFilterDropdowns();
}

function projRegScrollToSection(n) {
  const el = document.getElementById('proj-reg-sec-' + n);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let _projRegProgressBound = false;

function projRegBindProgress() {
  if (_projRegProgressBound) return;
  const form = document.getElementById('proj-reg-form');
  if (!form) return;
  const handler = () => projRegRefreshProgress();
  form.addEventListener('input', handler);
  form.addEventListener('change', handler);
  _projRegProgressBound = true;
}

function _projRegFieldVal(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}

function projRegRefreshProgress() {
  const form = document.getElementById('proj-reg-form');
  if (!form || form.style.display === 'none') return;

  const editId = _projRegFieldVal('proj-reg-edit-id');
  const isEdit = !!editId;
  const rowSt = _projRegFieldVal('proj-reg-row-status');
  const needsTypeYymm = !isEdit || rowSt === 'draft' || rowSt === 'rejected';
  const nameOk = _projRegFieldVal('proj-reg-name') !== '';
  let step1ok = false;
  if (needsTypeYymm) {
    step1ok = !!_projRegFieldVal('proj-reg-code-type') && !!_projRegFieldVal('proj-reg-yymm') && nameOk;
  } else {
    step1ok = nameOk;
  }
  const step2ok = !!_projRegFieldVal('proj-reg-client');

  const billIds = [
    'proj-reg-bill-down-amt', 'proj-reg-bill-down-due',
    'proj-reg-bill-interim-amt', 'proj-reg-bill-interim-due',
    'proj-reg-bill-final-amt', 'proj-reg-bill-final-due',
    'proj-reg-bill-add-amt', 'proj-reg-bill-add-due', 'proj-reg-bill-add-note',
    'proj-reg-bill-success-amt', 'proj-reg-bill-success-due', 'proj-reg-bill-success-note',
  ];
  const step3opt = billIds.some((id) => _projRegFieldVal(id) !== '');
  const fileEl = document.getElementById('proj-reg-contract');
  const exEl = document.getElementById('proj-reg-contract-existing');
  const hasSavedContract =
    exEl && !exEl.hidden && document.getElementById('proj-reg-contract-remove')?.value !== '1';
  const step4opt =
    !!_projRegFieldVal('proj-reg-period-start') ||
    !!_projRegFieldVal('proj-reg-period-end') ||
    !!(fileEl && fileEl.files && fileEl.files.length > 0) ||
    !!hasSavedContract;

  document.querySelectorAll('.proj-reg-step[data-proj-step]').forEach((btn) => {
    const n = btn.getAttribute('data-proj-step');
    const numEl = btn.querySelector('.proj-reg-step-num');
    btn.classList.remove('proj-reg-step--ok', 'proj-reg-step--need', 'proj-reg-step--opt-on');
    if (n === '1') {
      if (step1ok) {
        btn.classList.add('proj-reg-step--ok');
        if (numEl) numEl.textContent = '✓';
      } else {
        btn.classList.add('proj-reg-step--need');
        if (numEl) numEl.textContent = '1';
      }
    } else if (n === '2') {
      if (step2ok) {
        btn.classList.add('proj-reg-step--ok');
        if (numEl) numEl.textContent = '✓';
      } else {
        btn.classList.add('proj-reg-step--need');
        if (numEl) numEl.textContent = '2';
      }
    } else if (n === '3') {
      if (step3opt) btn.classList.add('proj-reg-step--opt-on');
      if (numEl) numEl.textContent = '3';
    } else if (n === '4') {
      if (step4opt) btn.classList.add('proj-reg-step--opt-on');
      if (numEl) numEl.textContent = '4';
    }
  });

  const reqDone = (step1ok ? 1 : 0) + (step2ok ? 1 : 0);
  const pct = Math.min(100, Math.round((reqDone / 2) * 100));
  const bar = document.getElementById('proj-reg-progress-bar');
  const lab = document.getElementById('proj-reg-progress-label');
  if (bar) bar.style.width = pct + '%';
  if (lab) {
    const miss = [];
    if (!step1ok) miss.push('① 코드·명칭');
    if (!step2ok) miss.push('② 고객사');
    const optParts = [];
    if (step3opt) optParts.push('금액·청구');
    if (step4opt) optParts.push('기간·첨부');
    const optStr = optParts.length ? ` · 선택 입력: ${optParts.join(', ')}` : '';
    const tail =
      rowSt === 'pending'
        ? ' (승인 대기 중에는 수정할 수 없습니다.)'
        : rowSt === 'draft' || rowSt === 'rejected' || !isEdit
          ? ' 임시저장 또는 승인 요청을 선택하세요.'
          : '';
    lab.textContent =
      reqDone >= 2
        ? '필수 입력을 모두 채웠습니다.' + tail + optStr
        : `필수 ${reqDone}/2 — ${miss.join(', ')}을(를) 완료하세요` + optStr;
  }
}

function projRegToggleAside() {
  if (typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 961px)').matches) return;
  const aside = document.getElementById('proj-reg-aside-panel');
  const tgl = document.getElementById('proj-reg-aside-toggle');
  const txt = document.getElementById('proj-reg-aside-toggle-text');
  if (!aside) return;
  const open = aside.classList.toggle('proj-reg-aside--open');
  if (tgl) tgl.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (txt) txt.textContent = open ? '도움말·필수 요약 접기' : '도움말·필수 요약 보기';
}

function _projRegResetAsidePanel() {
  const aside = document.getElementById('proj-reg-aside-panel');
  const tgl = document.getElementById('proj-reg-aside-toggle');
  const txt = document.getElementById('proj-reg-aside-toggle-text');
  if (aside) {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 960px)').matches) {
      aside.classList.remove('proj-reg-aside--open');
    } else {
      aside.classList.add('proj-reg-aside--open');
    }
  }
  if (tgl) tgl.setAttribute('aria-expanded', 'false');
  if (txt) txt.textContent = '도움말·필수 요약 보기';
}

function projRegResetContractUi() {
  const ex = document.getElementById('proj-reg-contract-existing');
  const rem = document.getElementById('proj-reg-contract-remove');
  const hint = document.getElementById('proj-reg-contract-remove-hint');
  const link = document.getElementById('proj-reg-contract-existing-link');
  if (ex) ex.hidden = true;
  if (rem) rem.value = '';
  if (hint) hint.hidden = true;
  if (link) {
    link.style.display = 'none';
    link.href = '#';
  }
  const n = document.getElementById('proj-reg-contract-existing-name');
  const m = document.getElementById('proj-reg-contract-existing-meta');
  if (n) n.textContent = '';
  if (m) m.textContent = '';
}

function projRegSyncContractExisting(r) {
  projRegResetContractUi();
  if (!r) return;
  const name = String(r.contract_file_name || '').trim();
  if (!name) return;
  const ex = document.getElementById('proj-reg-contract-existing');
  const nEl = document.getElementById('proj-reg-contract-existing-name');
  const mEl = document.getElementById('proj-reg-contract-existing-meta');
  const link = document.getElementById('proj-reg-contract-existing-link');
  if (nEl) nEl.textContent = name;
  let meta = '';
  if (r.contract_uploaded_at) {
    try {
      meta = Utils.formatDate ? Utils.formatDate(r.contract_uploaded_at) : String(r.contract_uploaded_at);
      meta = '등록 시각: ' + meta;
    } catch (_) {
      meta = '';
    }
  }
  if (mEl) mEl.textContent = meta;
  const url = String(r.contract_file_url || '').trim();
  if (link && url && /^https?:\/\//i.test(url)) {
    link.href = url;
    link.style.display = 'inline-flex';
  }
  if (ex) ex.hidden = false;
}

function projRegOnContractFileChange() {
  const rem = document.getElementById('proj-reg-contract-remove');
  const hint = document.getElementById('proj-reg-contract-remove-hint');
  const fileEl = document.getElementById('proj-reg-contract');
  if (rem) rem.value = '';
  if (hint) hint.hidden = true;
  const ex = document.getElementById('proj-reg-contract-existing');
  if (fileEl && fileEl.files && fileEl.files.length > 0 && ex) {
    ex.hidden = true;
  } else if (fileEl && (!fileEl.files || !fileEl.files.length)) {
    const editId = document.getElementById('proj-reg-edit-id')?.value;
    if (editId) {
      const r = _projRegRows.find((x) => x.id === editId);
      if (r && String(r.contract_file_name || '').trim()) projRegSyncContractExisting(r);
    }
  }
  projRegRefreshProgress();
}

function projRegMarkContractRemove() {
  document.getElementById('proj-reg-contract-remove').value = '1';
  const ex = document.getElementById('proj-reg-contract-existing');
  const hint = document.getElementById('proj-reg-contract-remove-hint');
  if (ex) ex.hidden = true;
  if (hint) hint.hidden = false;
  const fin = document.getElementById('proj-reg-contract');
  if (fin) fin.value = '';
  Toast.warning('저장하면 계약서 파일 연결이 해제되고 기존 업로드 파일 삭제를 시도합니다.');
  projRegRefreshProgress();
}

function projRegResetEvidenceUi() {
  const ex = document.getElementById('proj-reg-evidence-existing');
  const rem = document.getElementById('proj-reg-evidence-remove');
  const hint = document.getElementById('proj-reg-evidence-remove-hint');
  const link = document.getElementById('proj-reg-evidence-existing-link');
  if (ex) ex.hidden = true;
  if (rem) rem.value = '';
  if (hint) hint.hidden = true;
  if (link) {
    link.style.display = 'none';
    link.href = '#';
  }
  const n = document.getElementById('proj-reg-evidence-existing-name');
  const m = document.getElementById('proj-reg-evidence-existing-meta');
  if (n) n.textContent = '';
  if (m) m.textContent = '';
}

function projRegSyncEvidenceExisting(r) {
  projRegResetEvidenceUi();
  if (!r) return;
  const name = String(r.contract_evidence_file_name || '').trim();
  if (!name) return;
  const ex = document.getElementById('proj-reg-evidence-existing');
  const nEl = document.getElementById('proj-reg-evidence-existing-name');
  const mEl = document.getElementById('proj-reg-evidence-existing-meta');
  const link = document.getElementById('proj-reg-evidence-existing-link');
  if (nEl) nEl.textContent = name;
  let meta = '';
  if (r.contract_evidence_uploaded_at) {
    try {
      meta = Utils.formatDate ? Utils.formatDate(r.contract_evidence_uploaded_at) : String(r.contract_evidence_uploaded_at);
      meta = '등록 시각: ' + meta;
    } catch (_) {
      meta = '';
    }
  }
  if (mEl) mEl.textContent = meta;
  const url = String(r.contract_evidence_file_url || '').trim();
  if (link && url && /^https?:\/\//i.test(url)) {
    link.href = url;
    link.style.display = 'inline-flex';
  }
  if (ex) ex.hidden = false;
}

function projRegOnEvidenceFileChange() {
  const rem = document.getElementById('proj-reg-evidence-remove');
  const hint = document.getElementById('proj-reg-evidence-remove-hint');
  const fileEl = document.getElementById('proj-reg-evidence');
  if (rem) rem.value = '';
  if (hint) hint.hidden = true;
  const ex = document.getElementById('proj-reg-evidence-existing');
  if (fileEl && fileEl.files && fileEl.files.length > 0 && ex) {
    ex.hidden = true;
  } else if (fileEl && (!fileEl.files || !fileEl.files.length)) {
    const editId = document.getElementById('proj-reg-edit-id')?.value;
    if (editId) {
      const r = _projRegRows.find((x) => x.id === editId);
      if (r && String(r.contract_evidence_file_name || '').trim()) projRegSyncEvidenceExisting(r);
    }
  }
  projRegRefreshProgress();
}

function projRegMarkEvidenceRemove() {
  document.getElementById('proj-reg-evidence-remove').value = '1';
  const ex = document.getElementById('proj-reg-evidence-existing');
  const hint = document.getElementById('proj-reg-evidence-remove-hint');
  if (ex) ex.hidden = true;
  if (hint) hint.hidden = false;
  const fin = document.getElementById('proj-reg-evidence');
  if (fin) fin.value = '';
  Toast.warning('저장하면 근거 파일 연결이 해제되고 기존 업로드 파일 삭제를 시도합니다.');
  projRegRefreshProgress();
}

function projRegResetRouteEvidenceUi() {
  const ex = document.getElementById('proj-reg-route-evidence-existing');
  const rem = document.getElementById('proj-reg-route-evidence-remove');
  const hint = document.getElementById('proj-reg-route-evidence-remove-hint');
  const link = document.getElementById('proj-reg-route-evidence-existing-link');
  if (ex) ex.hidden = true;
  if (rem) rem.value = '';
  if (hint) hint.hidden = true;
  if (link) {
    link.style.display = 'none';
    link.href = '#';
  }
  const n = document.getElementById('proj-reg-route-evidence-existing-name');
  const m = document.getElementById('proj-reg-route-evidence-existing-meta');
  if (n) n.textContent = '';
  if (m) m.textContent = '';
}

function projRegSyncRouteEvidenceExisting(r) {
  projRegResetRouteEvidenceUi();
  if (!r) return;
  const name = String(r.order_evidence_file_name || '').trim();
  if (!name) return;
  const ex = document.getElementById('proj-reg-route-evidence-existing');
  const nEl = document.getElementById('proj-reg-route-evidence-existing-name');
  const mEl = document.getElementById('proj-reg-route-evidence-existing-meta');
  const link = document.getElementById('proj-reg-route-evidence-existing-link');
  if (nEl) nEl.textContent = name;
  let meta = '';
  if (r.order_evidence_uploaded_at) {
    try {
      meta = Utils.formatDate ? Utils.formatDate(r.order_evidence_uploaded_at) : String(r.order_evidence_uploaded_at);
      meta = '등록 시각: ' + meta;
    } catch (_) {
      meta = '';
    }
  }
  if (mEl) mEl.textContent = meta;
  const url = String(r.order_evidence_file_url || '').trim();
  if (link && url && /^https?:\/\//i.test(url)) {
    link.href = url;
    link.style.display = 'inline-flex';
  }
  if (ex) ex.hidden = false;
}

function projRegOnRouteEvidenceFileChange() {
  const rem = document.getElementById('proj-reg-route-evidence-remove');
  const hint = document.getElementById('proj-reg-route-evidence-remove-hint');
  const fileEl = document.getElementById('proj-reg-route-evidence');
  if (rem) rem.value = '';
  if (hint) hint.hidden = true;
  const ex = document.getElementById('proj-reg-route-evidence-existing');
  if (fileEl && fileEl.files && fileEl.files.length > 0 && ex) {
    ex.hidden = true;
  } else if (fileEl && (!fileEl.files || !fileEl.files.length)) {
    const editId = document.getElementById('proj-reg-edit-id')?.value;
    if (editId) {
      const r = _projRegRows.find((x) => x.id === editId);
      if (r && String(r.order_evidence_file_name || '').trim()) projRegSyncRouteEvidenceExisting(r);
    }
  }
  projRegRefreshProgress();
}

function projRegMarkRouteEvidenceRemove() {
  document.getElementById('proj-reg-route-evidence-remove').value = '1';
  const ex = document.getElementById('proj-reg-route-evidence-existing');
  const hint = document.getElementById('proj-reg-route-evidence-remove-hint');
  if (ex) ex.hidden = true;
  if (hint) hint.hidden = false;
  const fin = document.getElementById('proj-reg-route-evidence');
  if (fin) fin.value = '';
  Toast.warning('저장하면 수주경로 증빙 파일 연결이 해제되고 기존 업로드 파일 삭제를 시도합니다.');
  projRegRefreshProgress();
}

function projRegOnCodeTypeChange() {
  const sel = document.getElementById('proj-reg-code-type');
  const nameEl = document.getElementById('proj-reg-name');
  if (!sel || !nameEl || !sel.value) {
    projRegRefreshProgress();
    return;
  }
  const opt = sel.selectedOptions[0];
  if (opt && opt.dataset.nameEn && !nameEl.value.trim()) {
    nameEl.value = opt.dataset.nameEn;
  }
  projRegRefreshProgress();
}

function _projRegTypeById(typeId) {
  if (!typeId) return null;
  return _projRegTypes.find((x) => String(x.id) === String(typeId)) || null;
}

function _projRegRowMainCode(r) {
  const t = _projRegTypeById(r && r.project_code_type_id);
  return t ? String(t.main_code || '').trim() : '';
}

function _projRegDateStr(v) {
  if (v == null || v === '') return '';
  return String(v).slice(0, 10);
}

/** 등록일(행 created_at)이 필터 [fromF, toF] 구간에 포함되면 true */
function _projRegCreatedAtInRange(r, fromF, toF) {
  if (!fromF && !toF) return true;
  const cd = _projRegDateStr(r && r.created_at);
  if (!cd) return false;
  if (fromF && cd < fromF) return false;
  if (toF && cd > toF) return false;
  return true;
}

function _projRegPopulateListMainSelect() {
  const sel = document.getElementById('proj-reg-filter-main');
  if (!sel) return;
  const prev = sel.value;
  const mains = new Map();
  (_projRegTypes || []).forEach((t) => {
    const mc = String(t.main_code || '').trim();
    if (!mc) return;
    const cat = String(t.main_category || '').trim();
    const lab = `${cat || mc} (${mc})`;
    if (!mains.has(mc)) mains.set(mc, lab);
  });
  sel.innerHTML = '<option value="">대분류 전체</option>';
  [...mains.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([code, lab]) => {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = lab;
    sel.appendChild(o);
  });
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function _projRegPopulateListSubSelect() {
  const mainSel = document.getElementById('proj-reg-filter-main');
  const subSel = document.getElementById('proj-reg-filter-sub');
  if (!subSel) return;
  const prev = subSel.value;
  const mc = (mainSel && mainSel.value) ? String(mainSel.value).trim() : '';
  subSel.innerHTML = '<option value="">소분류 전체</option>';
  const list = mc
    ? _projRegTypes.filter((t) => String(t.main_code || '').trim() === mc)
    : _projRegTypes.slice();
  list.forEach((t) => {
    const sc = String(t.sub_code || '').trim();
    const o = document.createElement('option');
    o.value = t.id;
    const subLab = String(t.sub_category || '').trim() || sc;
    o.textContent = `${subLab} (${sc})`;
    subSel.appendChild(o);
  });
  if (prev && [...subSel.options].some((o) => o.value === prev)) subSel.value = prev;
}

function _projRegPopulateListFilterDropdowns() {
  const fCpm = document.getElementById('proj-reg-filter-cpm');
  if (fCpm) {
    const p2 = fCpm.value;
    fCpm.innerHTML = '<option value="">PM 전체</option>';
    (_projRegUsers || [])
      .filter((u) => u.deleted !== true && u.is_active !== false && _projRegIsCpmEligible(u))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .forEach((u) => {
        const o = document.createElement('option');
        o.value = u.id;
        o.textContent = u.name || String(u.id || '');
        fCpm.appendChild(o);
      });
    if (p2 && [...fCpm.options].some((o) => o.value === p2)) fCpm.value = p2;
  }
}

function _projRegBindListFiltersOnce() {
  if (_projRegListFiltersBound) return;
  const main = document.getElementById('proj-reg-filter-main');
  if (main) {
    main.addEventListener('change', () => {
      _projRegPopulateListSubSelect();
      projRegRenderList();
    });
  }
  ['proj-reg-filter-sub', 'proj-reg-filter-status', 'proj-reg-filter-cpm'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => projRegRenderList());
  });
  ['proj-reg-filter-period-from', 'proj-reg-filter-period-to'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => projRegRenderList());
  });
  ['proj-reg-filter-client', 'proj-reg-filter-registrant'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => projRegRenderList());
  });
  _projRegListFiltersBound = true;
}

function projRegResetListFilters() {
  [
    'proj-reg-filter-main',
    'proj-reg-filter-sub',
    'proj-reg-filter-client',
    'proj-reg-filter-status',
    'proj-reg-filter-period-from',
    'proj-reg-filter-period-to',
    'proj-reg-filter-registrant',
    'proj-reg-filter-cpm',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  _projRegPopulateListSubSelect();
  projRegRenderList();
}

function _projRegApplyListFilters(rowsIn) {
  const mainMc = (document.getElementById('proj-reg-filter-main')?.value || '').trim();
  const subId = (document.getElementById('proj-reg-filter-sub')?.value || '').trim();
  const clientKw = (document.getElementById('proj-reg-filter-client')?.value || '').trim().toLowerCase();
  const stF = (document.getElementById('proj-reg-filter-status')?.value || '').trim().toLowerCase();
  const pFrom = (document.getElementById('proj-reg-filter-period-from')?.value || '').trim();
  const pTo = (document.getElementById('proj-reg-filter-period-to')?.value || '').trim();
  const regKw = (document.getElementById('proj-reg-filter-registrant')?.value || '').trim().toLowerCase();
  const cpmId = (document.getElementById('proj-reg-filter-cpm')?.value || '').trim();

  return rowsIn.filter((r) => {
    const st = _projRegNormStatus(r);
    if (subId) {
      if (String(r.project_code_type_id || '') !== String(subId)) return false;
    } else if (mainMc) {
      if (_projRegRowMainCode(r) !== mainMc) return false;
    }
    if (clientKw) {
      const cb = [r.client_name, r.client_id].map((x) => String(x || '').toLowerCase()).join(' ');
      if (!cb.includes(clientKw)) return false;
    }
    if (stF && st !== stF) return false;
    if (!_projRegCreatedAtInRange(r, pFrom, pTo)) return false;
    if (regKw) {
      const nb = [r.created_by_name, r.created_by].map((x) => String(x || '').toLowerCase()).join(' ');
      if (!nb.includes(regKw)) return false;
    }
    if (cpmId && String(r.cpm_user_id || '') !== String(cpmId)) return false;
    return true;
  });
}

async function projRegLoadList() {
  const tbody = document.getElementById('proj-reg-list-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="table-empty"><i class="fas fa-spinner fa-spin"></i><p>불러오는 중…</p></td></tr>';
  const session = getSession();
  try {
    const allRows = await API.listAllPages('registered_projects', { limit: 500, maxPages: 10, sort: 'created_at' });
    _projRegRows = await _projRegScopeRowsForSession(allRows, session);
  } catch (e) {
    _projRegRows = [];
    Toast.error('목록 조회 실패: ' + (e.message || '') + ' — SQL 스키마를 적용했는지 확인하세요.');
  }
  projRegRenderList();
}

async function _projRegScopeRowsForSession(rows, session) {
  const src = Array.isArray(rows) ? rows : [];
  if (!session || !session.id) return [];
  if (Auth.isAdmin(session)) return src;

  const myId = String(session.id || '');
  // 승인자(팀장/본부장/경영층): 본인 + 소속 범위(팀/본부/사업부) 사용자 건 열람
  const canScopeView = Auth.canApprove(session) || Auth.isDirector(session) || Auth.isTopMgr(session);
  if (!canScopeView) {
    return src.filter((r) => String(r && r.created_by || '') === myId);
  }

  let users = _projRegUsers;
  if (!Array.isArray(users) || !users.length) {
    try {
      users = await Master.users();
      _projRegUsers = users;
    } catch (_) {
      users = [];
    }
  }
  const byId = new Map((users || []).map((u) => [String(u.id || ''), u]));
  return src.filter((r) => {
    const creatorId = String((r && r.created_by) || '');
    if (!creatorId) return false;
    if (creatorId === myId) return true;
    const creator = byId.get(creatorId);
    if (!creator) return false;
    return Auth.scopeMatch(session, creator);
  });
}

function projRegRenderList() {
  const tbody = document.getElementById('proj-reg-list-body');
  if (!tbody) return;
  const session = getSession();
  let rows = _projRegApplyListFilters(_projRegRows.slice());
  // 기본 정렬: 최신 등록일(created_at) 우선
  rows.sort((a, b) => {
    const ta = new Date(a && a.created_at || 0).getTime();
    const tb = new Date(b && b.created_at || 0).getTime();
    return tb - ta;
  });
  if (!rows.length) {
    const emptyMsg = !_projRegRows.length
      ? '등록된 프로젝트가 없습니다.'
      : '조건에 맞는 프로젝트가 없습니다.';
    tbody.innerHTML = `<tr><td colspan="9" class="table-empty"><i class="fas fa-clipboard-list"></i><p>${Utils.escHtml(emptyMsg)}</p></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r, i) => {
    const cd = r.created_at ? Utils.formatDate(r.created_at) : '-';
    const st = _projRegNormStatus(r);
    const codeDisp = (r.project_code && String(r.project_code).trim()) ? String(r.project_code) : '';
    const owner = _projRegIsOwner(session, r);
    const canDel = (st === 'draft' || st === 'rejected') && (owner || session.role === 'admin');
    const editBtn = `<button type="button" class="btn btn-sm btn-outline btn-icon" onclick="projRegShowForm('${r.id}')" title="상세"><i class="fas fa-edit"></i></button>`;
    const delBtn = `<button type="button" class="btn btn-sm btn-danger btn-icon" onclick="projRegDelete('${r.id}')" title="삭제"><i class="fas fa-trash"></i></button>`;
    const row1 = `<div class="proj-reg-list-act-row">${editBtn}${canDel ? delBtn : ''}</div>`;
    const actionHtml = `<div class="proj-reg-list-actions">${row1}</div>`;
    const contribCount = _projRegContribRowCount(r.order_contributors_text || '');
    const contribLabel = r.project_code || r.project_name || `프로젝트 ${i + 1}`;
    const contribBtn = contribCount
      ? `<button type="button" class="btn btn-sm btn-outline proj-reg-contrib-btn" onclick="projRegOpenContribModalEncoded('${_projRegEncClickArg(r.order_contributors_text || '')}','${_projRegEncClickArg(contribLabel)}')" title="수주 참여자 보기"><i class="fas fa-users"></i><span>참여 ${contribCount}</span></button>`
      : '<span style="color:var(--text-muted)">-</span>';
    return `<tr>
      <td class="text-center">${i + 1}</td>
      <td class="text-center"><span class="${_projRegStatusBadgeClass(st, r)}">${Utils.escHtml(_projRegStatusLabel(st, r))}</span></td>
      <td class="proj-reg-code-cell">${codeDisp ? `<strong>${Utils.escHtml(codeDisp)}</strong>` : '<span class="proj-reg-code-empty">코드생성전</span>'}</td>
      <td class="proj-reg-name-cell" title="${Utils.escHtml(r.project_name || '')}">${Utils.escHtml(r.project_name || '')}</td>
      <td class="proj-reg-client-cell" title="${Utils.escHtml(r.client_name || '')}">${Utils.escHtml(r.client_name || '')}</td>
      <td class="text-center">${contribBtn}</td>
      <td class="text-center">${Utils.escHtml(r.cpm_user_name || '-')}</td>
      <td class="text-center" style="font-size:12px">${Utils.escHtml(cd)}</td>
      <td class="text-center">${actionHtml}</td>
    </tr>`;
  }).join('');
}

function _projRegCollectContractDocs(rows) {
  const out = [];
  (rows || []).forEach((r) => {
    if (!r) return;
    const common = {
      projectId: String(r.id || ''),
      projectCode: String(r.project_code || '').trim(),
      projectName: String(r.project_name || '').trim(),
      clientName: String(r.client_name || '').trim(),
      regStatus: _projRegNormStatus(r),
      createdByName: String(r.created_by_name || '').trim(),
    };
    if (String(r.contract_file_name || '').trim()) {
      out.push({
        ...common,
        kind: 'contract',
        kindLabel: '용역계약서',
        fileName: String(r.contract_file_name || '').trim(),
        fileUrl: String(r.contract_file_url || '').trim(),
        uploadedAt: r.contract_uploaded_at || null,
      });
    }
    if (String(r.contract_evidence_file_name || '').trim()) {
      out.push({
        ...common,
        kind: 'agreement',
        kindLabel: '계약예외근거',
        fileName: String(r.contract_evidence_file_name || '').trim(),
        fileUrl: String(r.contract_evidence_file_url || '').trim(),
        uploadedAt: r.contract_evidence_uploaded_at || null,
      });
    }
    if (String(r.order_evidence_file_name || '').trim()) {
      out.push({
        ...common,
        kind: 'route',
        kindLabel: '수주경로증빙',
        fileName: String(r.order_evidence_file_name || '').trim(),
        fileUrl: String(r.order_evidence_file_url || '').trim(),
        uploadedAt: r.order_evidence_uploaded_at || null,
      });
    }
  });
  out.sort((a, b) => (Number(b.uploadedAt || 0) - Number(a.uploadedAt || 0)));
  return out;
}

function _projRegApplyContractDocFilters(list) {
  const kw = String(document.getElementById('proj-reg-contract-doc-filter-q')?.value || '').trim().toLowerCase();
  const kind = String(document.getElementById('proj-reg-contract-doc-filter-kind')?.value || '').trim();
  return (list || []).filter((d) => {
    if (kind && d.kind !== kind) return false;
    if (!kw) return true;
    const hay = [
      d.projectCode,
      d.projectName,
      d.clientName,
      d.fileName,
      d.createdByName,
      d.kindLabel,
    ].map((x) => String(x || '').toLowerCase()).join(' ');
    return hay.includes(kw);
  });
}

function projRegRenderContractDocModal() {
  const tbody = document.getElementById('proj-reg-contract-doc-body');
  if (!tbody) return;
  const rows = _projRegApplyContractDocFilters(_projRegContractDocs);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty"><i class="fas fa-file-alt"></i><p>표시할 계약 문서가 없습니다.</p></td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((d, i) => {
    const code = d.projectCode || '—';
    const pn = d.projectName || '-';
    const cl = d.clientName || '-';
    const upAt = d.uploadedAt ? (Utils.formatDate ? Utils.formatDate(d.uploadedAt) : String(d.uploadedAt)) : '-';
    const openBtn = d.fileUrl
      ? `<a class="btn btn-sm btn-outline" href="${Utils.escHtml(d.fileUrl)}" target="_blank" rel="noopener noreferrer">열기</a>`
      : '<span style="font-size:12px;color:var(--text-muted)">URL 없음</span>';
    const unlinkBtn = `<button type="button" class="btn btn-sm btn-danger" onclick="projRegUnlinkContractDoc('${Utils.escHtml(d.projectId)}','${d.kind}')" title="문서 연결 해제">연결해제</button>`;
    const escCode = Utils.escHtml(code);
    const escPn = Utils.escHtml(pn);
    const escCl = Utils.escHtml(cl);
    const escFn = Utils.escHtml(d.fileName || '-');
    const titleCode = Utils.escHtml(String(code));
    const titlePn = Utils.escHtml(String(pn));
    const titleCl = Utils.escHtml(String(cl));
    const titleFn = Utils.escHtml(String(d.fileName || ''));
    return `<tr>
      <td>${i + 1}</td>
      <td><span class="badge badge-gray">${Utils.escHtml(d.kindLabel)}</span></td>
      <td class="pm-contract-ellipsis" title="${titleCode}"><strong>${escCode}</strong></td>
      <td class="pm-contract-ellipsis" title="${titlePn}">${escPn}</td>
      <td class="pm-contract-ellipsis" title="${titleCl}">${escCl}</td>
      <td class="pm-contract-ellipsis" title="${titleFn}">${escFn}</td>
      <td style="font-size:12px">${Utils.escHtml(String(upAt))}</td>
      <td style="font-size:12px">${Utils.escHtml(d.createdByName || '-')}</td>
      <td class="pm-contract-doc-td-actions" style="text-align:center;white-space:nowrap">${openBtn} ${unlinkBtn}</td>
    </tr>`;
  }).join('');
}

async function projRegOpenContractDocModal() {
  if (!_projRegRows.length) await projRegLoadList();
  _projRegContractDocs = _projRegCollectContractDocs(_projRegRows);
  const q = document.getElementById('proj-reg-contract-doc-filter-q');
  const kind = document.getElementById('proj-reg-contract-doc-filter-kind');
  if (q) q.value = '';
  if (kind) kind.value = '';
  projRegRenderContractDocModal();
  openModal('projRegContractDocModal');
}

async function projRegUnlinkContractDoc(projectId, kind) {
  if (!projectId || !kind) return;
  if (!confirm('선택한 문서 연결을 해제할까요? (스토리지 파일도 함께 삭제 시도)')) return;
  const session = getSession();
  const row = await _projRegResolveRow(projectId);
  if (!row) return;
  const isAdmin = !!(session && session.role === 'admin');
  const isOwner = String(row.created_by || '') === String(session?.id || '');
  const isFinalApprover = String(row.final_approved_by || '') === String(session?.id || '');
  if (!isAdmin && !isOwner && !isFinalApprover) {
    Toast.warning('문서 연결해제 권한이 없습니다. (등록자/최종승인자/관리자)');
    return;
  }
  const patch = {
    updated_by: String(session?.id || ''),
    updated_by_name: String(session?.name || ''),
  };
  let oldUrl = '';
  if (kind === 'contract') {
    patch.contract_file_name = '';
    patch.contract_file_url = '';
    patch.contract_uploaded_at = null;
    oldUrl = String(row.contract_file_url || '');
  } else if (kind === 'agreement') {
    patch.contract_evidence_file_name = '';
    patch.contract_evidence_file_url = '';
    patch.contract_evidence_uploaded_at = null;
    oldUrl = String(row.contract_evidence_file_url || '');
  } else if (kind === 'route') {
    patch.order_evidence_file_name = '';
    patch.order_evidence_file_url = '';
    patch.order_evidence_uploaded_at = null;
    oldUrl = String(row.order_evidence_file_url || '');
  } else {
    return;
  }
  try {
    await API.patch('registered_projects', projectId, patch);
    if (oldUrl) await _projRegTryDeleteStorageByUrl(oldUrl);
    await projRegLoadList();
    _projRegContractDocs = _projRegCollectContractDocs(_projRegRows);
    projRegRenderContractDocModal();
    Toast.success('문서 연결을 해제했습니다.');
  } catch (e) {
    Toast.error('문서 연결 해제 실패: ' + (e.message || e));
  }
}

function _projRegClearBilling() {
  const ids = [
    ['proj-reg-bill-down-amt', 'proj-reg-bill-down-due'],
    ['proj-reg-bill-interim-amt', 'proj-reg-bill-interim-due'],
    ['proj-reg-bill-final-amt', 'proj-reg-bill-final-due'],
    ['proj-reg-bill-add-amt', 'proj-reg-bill-add-due', 'proj-reg-bill-add-note'],
    ['proj-reg-bill-success-amt', 'proj-reg-bill-success-due', 'proj-reg-bill-success-note'],
  ];
  ids.forEach((row) => {
    row.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  });
}

function _projRegFillBilling(bs) {
  _projRegClearBilling();
  if (!bs || typeof bs !== 'object') return;
  const setAmt = (id, amt) => {
    const ael = document.getElementById(id);
    if (!ael || amt == null || amt === '') return;
    const n = typeof amt === 'number' ? amt : parseInt(amt, 10);
    if (Number.isFinite(n)) ael.value = n.toLocaleString('ko-KR');
  };
  const map = [
    ['down', 'proj-reg-bill-down-amt', 'proj-reg-bill-down-due'],
    ['interim', 'proj-reg-bill-interim-amt', 'proj-reg-bill-interim-due'],
    ['final', 'proj-reg-bill-final-amt', 'proj-reg-bill-final-due'],
    ['additional', 'proj-reg-bill-add-amt', 'proj-reg-bill-add-due', 'proj-reg-bill-add-note'],
    ['success', 'proj-reg-bill-success-amt', 'proj-reg-bill-success-due', 'proj-reg-bill-success-note'],
  ];
  map.forEach((row) => {
    const key = row[0];
    const aid = row[1];
    const did = row[2];
    const nid = row[3];
    const b = bs[key];
    if (!b) return;
    setAmt(aid, b.amount);
    const del = document.getElementById(did);
    if (del && b.due_date) del.value = String(b.due_date).slice(0, 10);
    if (nid && b.terms_note) {
      const nel = document.getElementById(nid);
      if (nel) nel.value = b.terms_note;
    }
  });
}

function _projRegCollectBilling() {
  const dte = (id) => {
    const v = document.getElementById(id)?.value;
    return v ? v : null;
  };
  return {
    down: { amount: _projRegAmtValue('proj-reg-bill-down-amt'), due_date: dte('proj-reg-bill-down-due') },
    interim: { amount: _projRegAmtValue('proj-reg-bill-interim-amt'), due_date: dte('proj-reg-bill-interim-due') },
    final: { amount: _projRegAmtValue('proj-reg-bill-final-amt'), due_date: dte('proj-reg-bill-final-due') },
    additional: {
      amount: _projRegAmtValue('proj-reg-bill-add-amt'),
      due_date: dte('proj-reg-bill-add-due'),
      terms_note: _projRegNoteVal('proj-reg-bill-add-note'),
    },
    success: {
      amount: _projRegAmtValue('proj-reg-bill-success-amt'),
      due_date: dte('proj-reg-bill-success-due'),
      terms_note: _projRegNoteVal('proj-reg-bill-success-note'),
    },
  };
}

async function projRegShowForm(editId, opts) {
  _projRegOpenedFromApprovalDetail = !!(opts && opts.fromApproval);
  const session = getSession();
  const list = document.getElementById('proj-reg-list');
  const form = document.getElementById('proj-reg-form');
  if (list) list.style.display = 'none';
  if (form) form.style.display = '';

  document.getElementById('proj-reg-edit-id').value = editId || '';
  const rowStatusEl = document.getElementById('proj-reg-row-status');
  if (rowStatusEl) rowStatusEl.value = editId ? '' : 'draft';

  const titleEl = document.getElementById('proj-reg-form-title');
  if (titleEl) titleEl.textContent = editId ? '프로젝트 수정' : 'Create Project';

  try {
    const wrap = document.querySelector('.proj-reg-create-wrap');
    if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (_) {
    window.scrollTo(0, 0);
  }

  const typeSel = document.getElementById('proj-reg-code-type');
  const yymmEl = document.getElementById('proj-reg-yymm');
  const codeWrap = document.getElementById('proj-reg-existing-code-wrap');
  const codeRo = document.getElementById('proj-reg-existing-code');

  document.getElementById('proj-reg-name').value = '';
  document.getElementById('proj-reg-client').value = '';
  const cSearch = document.getElementById('proj-reg-client-search');
  if (cSearch) cSearch.value = '';
  projRegHideClientSuggest();
  document.getElementById('proj-reg-order-owner').value = '';
  document.getElementById('proj-reg-route').value = '';
  const routeDetailEl = document.getElementById('proj-reg-route-detail');
  if (routeDetailEl) routeDetailEl.value = '';
  projRegSetContributorsFromStored('');
  projRegOnRouteChange();
  document.getElementById('proj-reg-cpm').value = '';
  document.getElementById('proj-reg-period-start').value = '';
  document.getElementById('proj-reg-period-end').value = '';
  document.getElementById('proj-reg-contract').value = '';
  document.getElementById('proj-reg-evidence').value = '';
  document.getElementById('proj-reg-route-evidence').value = '';
  const exReasonEl = document.getElementById('proj-reg-contract-exception-reason');
  if (exReasonEl) exReasonEl.value = '';
  const remInp = document.getElementById('proj-reg-contract-remove');
  if (remInp) remInp.value = '';
  const remEviInp = document.getElementById('proj-reg-evidence-remove');
  if (remEviInp) remEviInp.value = '';
  const remRouteInp = document.getElementById('proj-reg-route-evidence-remove');
  if (remRouteInp) remRouteInp.value = '';
  const rmHint = document.getElementById('proj-reg-contract-remove-hint');
  if (rmHint) rmHint.hidden = true;
  const rmEviHint = document.getElementById('proj-reg-evidence-remove-hint');
  if (rmEviHint) rmEviHint.hidden = true;
  const rmRouteHint = document.getElementById('proj-reg-route-evidence-remove-hint');
  if (rmRouteHint) rmRouteHint.hidden = true;
  projRegResetContractUi();
  projRegResetEvidenceUi();
  projRegResetRouteEvidenceUi();
  _projRegClearBilling();

  await projRegLoadTypes();
  await projRegFillDropdowns();

  let row = null;
  if (editId) {
    row = _projRegRows.find((x) => x.id === editId);
    if (!row) {
      Toast.warning('항목을 찾을 수 없습니다.');
      projRegShowList();
      return;
    }
    const st = _projRegNormStatus(row);
    if (rowStatusEl) rowStatusEl.value = st;

    if (typeSel) typeSel.value = row.project_code_type_id || '';
    if (yymmEl) {
      const yymm = _projRegYymmFromCode(row.project_code || '');
      yymmEl.value = yymm ? _projRegYymmToMonthValue(yymm) : '';
    }

    const lockType = st === 'approved' || st === 'pending';
    if (typeSel) typeSel.disabled = lockType;
    if (yymmEl) yymmEl.disabled = lockType;

    const showCode = !!(row.project_code && String(row.project_code).trim());
    if (codeWrap) codeWrap.style.display = showCode ? '' : 'none';
    if (codeRo) codeRo.value = showCode ? row.project_code : '';

    document.getElementById('proj-reg-name').value = row.project_name || '';
    document.getElementById('proj-reg-client').value = row.client_id || '';
    if (cSearch) cSearch.value = row.client_name || '';
    document.getElementById('proj-reg-order-owner').value = row.order_owner_text || '';
    projRegSetContributorsFromStored(row.order_contributors_text || '');
    projRegApplyRouteFromStored(row.acquisition_route || '', row.acquisition_route_detail || '');
    document.getElementById('proj-reg-cpm').value = row.cpm_user_id || '';
    if (row.period_start) document.getElementById('proj-reg-period-start').value = String(row.period_start).slice(0, 10);
    if (row.period_end) document.getElementById('proj-reg-period-end').value = String(row.period_end).slice(0, 10);
    _projRegFillBilling(row.billing_schedule);
    projRegSyncContractExisting(row);
    projRegSyncEvidenceExisting(row);
    projRegSyncRouteEvidenceExisting(row);
    if (exReasonEl) exReasonEl.value = row.contract_exception_reason || '';

    if (st === 'draft' && yymmEl && !yymmEl.value) _projRegSetDefaultMonth();
  } else {
    if (typeSel) typeSel.disabled = false;
    if (yymmEl) {
      yymmEl.disabled = false;
      _projRegSetDefaultMonth();
    }
    if (codeWrap) codeWrap.style.display = 'none';
    if (codeRo) codeRo.value = '';
    projRegSetContributorsFromStored('');
  }

  projRegBindProgress();
  _projRegResetAsidePanel();
  projRegRefreshProgress();
  projRegUpdateFormFooter(session, editId || '', row);
}

function _projRegReadFormCore(session) {
  const name = document.getElementById('proj-reg-name').value.trim();
  const clientId = document.getElementById('proj-reg-client').value.trim();
  const typeId = document.getElementById('proj-reg-code-type').value;
  const monthVal = document.getElementById('proj-reg-yymm').value;
  const yymm = _projRegMonthToYymm(monthVal);
  const hit = _projRegClients.find((c) => String(c.id) === String(clientId));
  let clientName = hit ? String(hit.company_name || '') : '';
  if (!clientName) clientName = document.getElementById('proj-reg-client-search').value.trim();
  const cpmSel = document.getElementById('proj-reg-cpm');
  const cpmOpt = cpmSel?.selectedOptions?.[0];
  const cpmId = cpmSel?.value || '';
  const cpmName = cpmOpt?.dataset?.name || '';
  const orderOwner = document.getElementById('proj-reg-order-owner').value.trim();
  const route = document.getElementById('proj-reg-route').value;
  const routeDetail = document.getElementById('proj-reg-route-detail').value.trim();
  const contributors = document.getElementById('proj-reg-order-contributors').value.trim();
  const ps = document.getElementById('proj-reg-period-start').value || null;
  const pe = document.getElementById('proj-reg-period-end').value || null;
  const billing = _projRegCollectBilling();
  const fileInput = document.getElementById('proj-reg-contract');
  const file = fileInput?.files?.[0];
  const removeContractMeta = document.getElementById('proj-reg-contract-remove')?.value === '1';
  const evidenceInput = document.getElementById('proj-reg-evidence');
  const evidenceFile = evidenceInput?.files?.[0];
  const removeEvidenceMeta = document.getElementById('proj-reg-evidence-remove')?.value === '1';
  const routeEvidenceInput = document.getElementById('proj-reg-route-evidence');
  const routeEvidenceFile = routeEvidenceInput?.files?.[0];
  const removeRouteEvidenceMeta = document.getElementById('proj-reg-route-evidence-remove')?.value === '1';
  const contractExceptionReason = document.getElementById('proj-reg-contract-exception-reason')?.value?.trim() || '';
  return {
    name,
    clientId,
    clientName,
    typeId,
    monthVal,
    yymm,
    cpmId,
    cpmName,
    orderOwner,
    route,
    routeDetail,
    contributors,
    ps,
    pe,
    billing,
    file,
    removeContractMeta,
    evidenceFile,
    removeEvidenceMeta,
    routeEvidenceFile,
    removeRouteEvidenceMeta,
    contractExceptionReason,
    session,
  };
}

function _projRegHasContractMeta(row) {
  return !!(row && String(row.contract_file_name || '').trim());
}

function _projRegHasEvidenceMeta(row) {
  return !!(row && String(row.contract_evidence_file_name || '').trim());
}

function _projRegHasRouteEvidenceMeta(row) {
  return !!(row && String(row.order_evidence_file_name || '').trim());
}

/** 승인 요청 직전: 새 파일 선택 또는 기존 저장 메타(삭제 표시 없음) */
function _projRegFormWillHaveContract(f, prev) {
  if (f.file) return true;
  if (f.removeContractMeta) return false;
  return _projRegHasContractMeta(prev);
}

function _projRegFormWillHaveEvidence(f, prev) {
  if (f.evidenceFile) return true;
  if (f.removeEvidenceMeta) return false;
  return _projRegHasEvidenceMeta(prev);
}

function _projRegFormWillHaveRouteEvidence(f, prev) {
  if (f.routeEvidenceFile) return true;
  if (f.removeRouteEvidenceMeta) return false;
  return _projRegHasRouteEvidenceMeta(prev);
}

function _projRegSafePathSegment(v) {
  return String(v || '')
    .replace(/[^\w.\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'file';
}

function _projRegStorageRefFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const pubKey = '/storage/v1/object/public/';
  const prvKey = '/storage/v1/object/';
  let p = '';
  const iPub = raw.indexOf(pubKey);
  if (iPub >= 0) p = raw.slice(iPub + pubKey.length);
  else {
    const iPrv = raw.indexOf(prvKey);
    if (iPrv < 0) return null;
    p = raw.slice(iPrv + prvKey.length);
  }
  const q = p.indexOf('?');
  if (q >= 0) p = p.slice(0, q);
  const slash = p.indexOf('/');
  if (slash <= 0) return null;
  return {
    bucket: decodeURIComponent(p.slice(0, slash)),
    path: decodeURIComponent(p.slice(slash + 1)),
  };
}

async function _projRegTryDeleteStorageByUrl(url) {
  const ref = _projRegStorageRefFromUrl(url);
  if (!ref || !ref.bucket || !ref.path) return;
  try {
    await API.storageDelete(ref.bucket, ref.path);
  } catch (e) {
    console.warn('[proj-reg] storage delete failed', e);
  }
}

async function _projRegUploadFile(kind, file, keyHint) {
  if (!file) return null;
  const bucket = _PROJ_REG_STORAGE_BUCKETS[kind];
  if (!bucket) throw new Error('알 수 없는 파일 유형입니다.');
  const now = Date.now();
  const d = new Date(now);
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const key = _projRegSafePathSegment(keyHint || 'unclassified');
  const ext = String(file.name || '').split('.').pop() || 'bin';
  const fileStem = _projRegSafePathSegment(String(file.name || '').replace(/\.[^.]*$/, ''));
  const uniq = Math.random().toString(36).slice(2, 8);
  const path = `project-register/${kind}/${yyyy}/${mm}/${key}/${now}_${uniq}_${fileStem}.${ext}`;
  const up = await API.storageUpload(bucket, path, file, { upsert: false });
  return {
    fileName: file.name,
    fileUrl: up.publicUrl,
    uploadedAt: now,
  };
}

async function _projRegApplyContractToPayload(basePayload, file, removeContractMeta, prev) {
  if (file) {
    const keyHint = basePayload.project_code || (prev && prev.project_code) || (prev && prev.id) || 'draft';
    const up = await _projRegUploadFile('contract', file, keyHint);
    basePayload.contract_file_name = up.fileName;
    basePayload.contract_uploaded_at = up.uploadedAt;
    basePayload.contract_file_url = up.fileUrl;
    if (prev && String(prev.contract_file_url || '').trim()) {
      await _projRegTryDeleteStorageByUrl(prev.contract_file_url);
    }
    return;
  }
  if (removeContractMeta && !file) {
    if (prev && String(prev.contract_file_url || '').trim()) {
      await _projRegTryDeleteStorageByUrl(prev.contract_file_url);
    }
    basePayload.contract_file_name = '';
    basePayload.contract_file_url = '';
    basePayload.contract_uploaded_at = null;
    return;
  }
  if (prev) {
    basePayload.contract_file_name = prev.contract_file_name || '';
    basePayload.contract_file_url = prev.contract_file_url || '';
    basePayload.contract_uploaded_at = prev.contract_uploaded_at || null;
  }
}

async function _projRegApplyEvidenceToPayload(basePayload, evidenceFile, removeEvidenceMeta, prev) {
  if (evidenceFile) {
    const keyHint = basePayload.project_code || (prev && prev.project_code) || (prev && prev.id) || 'draft';
    const up = await _projRegUploadFile('agreement', evidenceFile, keyHint);
    basePayload.contract_evidence_file_name = up.fileName;
    basePayload.contract_evidence_uploaded_at = up.uploadedAt;
    basePayload.contract_evidence_file_url = up.fileUrl;
    if (prev && String(prev.contract_evidence_file_url || '').trim()) {
      await _projRegTryDeleteStorageByUrl(prev.contract_evidence_file_url);
    }
    return;
  }
  if (removeEvidenceMeta && !evidenceFile) {
    if (prev && String(prev.contract_evidence_file_url || '').trim()) {
      await _projRegTryDeleteStorageByUrl(prev.contract_evidence_file_url);
    }
    basePayload.contract_evidence_file_name = '';
    basePayload.contract_evidence_file_url = '';
    basePayload.contract_evidence_uploaded_at = null;
    return;
  }
  if (prev) {
    basePayload.contract_evidence_file_name = prev.contract_evidence_file_name || '';
    basePayload.contract_evidence_file_url = prev.contract_evidence_file_url || '';
    basePayload.contract_evidence_uploaded_at = prev.contract_evidence_uploaded_at || null;
  }
}

async function _projRegApplyRouteEvidenceToPayload(basePayload, routeEvidenceFile, removeRouteEvidenceMeta, prev) {
  if (routeEvidenceFile) {
    const keyHint = basePayload.project_code || (prev && prev.project_code) || (prev && prev.id) || 'draft';
    const up = await _projRegUploadFile('route', routeEvidenceFile, keyHint);
    basePayload.order_evidence_file_name = up.fileName;
    basePayload.order_evidence_uploaded_at = up.uploadedAt;
    basePayload.order_evidence_file_url = up.fileUrl;
    if (prev && String(prev.order_evidence_file_url || '').trim()) {
      await _projRegTryDeleteStorageByUrl(prev.order_evidence_file_url);
    }
    return;
  }
  if (removeRouteEvidenceMeta && !routeEvidenceFile) {
    if (prev && String(prev.order_evidence_file_url || '').trim()) {
      await _projRegTryDeleteStorageByUrl(prev.order_evidence_file_url);
    }
    basePayload.order_evidence_file_name = '';
    basePayload.order_evidence_file_url = '';
    basePayload.order_evidence_uploaded_at = null;
    return;
  }
  if (prev) {
    basePayload.order_evidence_file_name = prev.order_evidence_file_name || '';
    basePayload.order_evidence_file_url = prev.order_evidence_file_url || '';
    basePayload.order_evidence_uploaded_at = prev.order_evidence_uploaded_at || null;
  }
}

async function projRegSaveDraft() {
  const session = getSession();
  if (!Auth.canManageProjectRegister(session)) {
    Toast.warning('권한이 없습니다.');
    return;
  }
  const editId = document.getElementById('proj-reg-edit-id').value;
  const f = _projRegReadFormCore(session);
  const basePayload = {
    project_name: f.name,
    client_id: f.clientId || null,
    client_name: f.clientName,
    order_owner_text: f.orderOwner,
    acquisition_route: f.route,
    acquisition_route_detail: f.routeDetail,
    order_contributors_text: f.contributors,
    cpm_user_id: f.cpmId,
    cpm_user_name: f.cpmName,
    period_start: f.ps,
    period_end: f.pe,
    billing_schedule: f.billing,
    updated_by: String(session.id || ''),
    updated_by_name: session.name || '',
  };
  if (f.typeId) basePayload.project_code_type_id = f.typeId;
  try {
    if (editId) {
      const prev = _projRegRows.find((x) => x.id === editId);
      const canEditFromApproval = !!(_projRegOpenedFromApprovalDetail && prev && _projRegCanApproveRow(session, prev));
      if (!prev || (!_projRegIsOwner(session, prev) && !canEditFromApproval)) {
        Toast.warning('임시저장할 권한이 없습니다.');
        return;
      }
      const st = _projRegNormStatus(prev);
      if (st === 'pending' && !canEditFromApproval) {
        Toast.warning('승인 대기 중에는 수정할 수 없습니다.');
        return;
      }
      if (st === 'approved') {
        Toast.warning('승인 완료 건은 하단 「저장」으로 수정하세요.');
        return;
      }
      await _projRegApplyContractToPayload(basePayload, f.file, f.removeContractMeta, prev);
      await _projRegApplyEvidenceToPayload(basePayload, f.evidenceFile, f.removeEvidenceMeta, prev);
      await _projRegApplyRouteEvidenceToPayload(basePayload, f.routeEvidenceFile, f.removeRouteEvidenceMeta, prev);
      basePayload.contract_exception_reason = f.contractExceptionReason || '';
      await API.patch('registered_projects', editId, basePayload);
      Toast.success('임시저장되었습니다.');
    } else {
      await _projRegApplyContractToPayload(basePayload, f.file, f.removeContractMeta, null);
      await _projRegApplyEvidenceToPayload(basePayload, f.evidenceFile, f.removeEvidenceMeta, null);
      await _projRegApplyRouteEvidenceToPayload(basePayload, f.routeEvidenceFile, f.removeRouteEvidenceMeta, null);
      basePayload.contract_exception_reason = f.contractExceptionReason || '';
      if (!f.file) {
        basePayload.contract_file_name = '';
        basePayload.contract_file_url = '';
      }
      if (!f.evidenceFile) {
        basePayload.contract_evidence_file_name = '';
        basePayload.contract_evidence_file_url = '';
      }
      const row = await API.create('registered_projects', {
        ...basePayload,
        registration_status: 'draft',
        project_code: null,
        created_by: String(session.id || ''),
        created_by_name: session.name || '',
      });
      if (row && row.id) {
        document.getElementById('proj-reg-edit-id').value = row.id;
        const rs = document.getElementById('proj-reg-row-status');
        if (rs) rs.value = 'draft';
      }
      Toast.success('임시저장되었습니다.');
    }
    await projRegLoadList();
    const eid = document.getElementById('proj-reg-edit-id').value;
    if (eid) projRegUpdateFormFooter(session, eid, _projRegRows.find((x) => x.id === eid));
    projRegRefreshProgress();
  } catch (e) {
    Toast.error('임시저장 실패: ' + (e.message || e));
  }
}

async function projRegSubmitForApproval() {
  const session = getSession();
  if (!Auth.canManageProjectRegister(session)) {
    Toast.warning('권한이 없습니다.');
    return;
  }
  const editId = document.getElementById('proj-reg-edit-id').value;
  const f = _projRegReadFormCore(session);
  if (!f.name) {
    Toast.warning('프로젝트명을 입력하세요.');
    return;
  }
  if (!f.clientId) {
    Toast.warning('고객사를 검색한 뒤 목록에서 선택하세요.');
    return;
  }
  if (!f.typeId) {
    Toast.warning('유형(대·소분류)을 선택하세요.');
    return;
  }
  if (!f.route) {
    Toast.warning('수주경로를 선택하세요.');
    return;
  }
  const contribValid = _projRegValidateContributorsForApproval();
  if (!contribValid.ok) {
    Toast.warning(contribValid.message);
    return;
  }
  if (!f.yymm || f.yymm.length !== 4) {
    Toast.warning('연월을 선택하세요.');
    return;
  }
  const opt = document.getElementById('proj-reg-code-type').selectedOptions[0];
  const mainCode = (opt?.dataset?.mainCode || '').trim();
  const subCode = (opt?.dataset?.subCode || '').trim();
  if (!mainCode || !subCode) {
    Toast.warning('유형 코드를 확인할 수 없습니다.');
    return;
  }

  let prev = editId ? _projRegRows.find((x) => x.id === editId) : null;
  const willHaveContract = _projRegFormWillHaveContract(f, prev);
  const willHaveEvidence = _projRegFormWillHaveEvidence(f, prev);
  const isConditional = !willHaveContract;
  const snap = await _projRegRegistrantSnapshot(session);
  const has1 = !!snap.pa1Id;
  const has2 = !!snap.pa2Id;
  const has3 = !!snap.pa3Id;
  const myRole = String(session.role || '').trim().toLowerCase();
  const isStaffRegistrant = myRole === 'staff';
  const isCcbAutoApprove =
    (myRole === 'director' || myRole === 'top_mgr') &&
    typeof Auth !== 'undefined' &&
    typeof Auth.preferredSheetType === 'function' &&
    Auth.preferredSheetType(session) === 'daily';
  const autoApprove = isCcbAutoApprove || (!isStaffRegistrant && !has1 && !has2 && !has3);

  // staff는 최소 1차 승인자 지정이 있어야 승인 요청 가능 (무승인 자동승인 차단)
  if (isStaffRegistrant && !has1) {
    Toast.warning('승인 요청할 수 없습니다. 1차 승인자(팀장) 지정 후 다시 시도하세요.');
    return;
  }

  if (isConditional && !willHaveEvidence) {
    Toast.warning('계약서 미첨부 시 고객 합의 근거(메일/공문 등) 파일을 첨부해야 승인 요청할 수 있습니다.');
    return;
  }
  if (isConditional && !f.contractExceptionReason) {
    Toast.warning('계약서 미첨부 사유를 입력하세요.');
    return;
  }

  if (prev && !_projRegIsOwner(session, prev)) {
    Toast.warning('승인 요청할 권한이 없습니다.');
    return;
  }
  if (prev) {
    const st = _projRegNormStatus(prev);
    if (st === 'pending') {
      Toast.warning('이미 승인 대기 중입니다.');
      return;
    }
    if (st === 'approved') {
      Toast.warning('이미 승인된 프로젝트입니다.');
      return;
    }
  }

  let projectCode = '';
  const reuse =
    prev &&
    ( _projRegNormStatus(prev) === 'rejected' || _projRegNormStatus(prev) === 'draft') &&
    prev.project_code &&
    _projRegCodeMatchesForm(prev, f.typeId, f.yymm);
  if (reuse) {
    projectCode = String(prev.project_code);
  } else {
    projectCode = await API.rpc('fn_allocate_project_code', {
      p_main_code: mainCode,
      p_sub_code: subCode,
      p_yymm: f.yymm,
    });
    if (!projectCode || typeof projectCode !== 'string') {
      Toast.error('프로젝트 코드 채번에 실패했습니다.');
      return;
    }
  }

  const now = Date.now();
  const basePayload = {
    project_name: f.name,
    client_id: f.clientId,
    client_name: f.clientName,
    order_owner_text: f.orderOwner,
    acquisition_route: f.route,
    acquisition_route_detail: f.routeDetail,
    order_contributors_text: f.contributors,
    cpm_user_id: f.cpmId,
    cpm_user_name: f.cpmName,
    period_start: f.ps,
    period_end: f.pe,
    billing_schedule: f.billing,
    project_code: projectCode,
    project_code_type_id: f.typeId,
    updated_by: String(session.id || ''),
    updated_by_name: session.name || '',
    reg_pa1_id: snap.pa1Id,
    reg_pa1_name: snap.pa1Name,
    reg_pa2_id: snap.pa2Id,
    reg_pa2_name: snap.pa2Name,
    reg_pa3_id: snap.pa3Id,
    reg_pa3_name: snap.pa3Name,
    submitted_at: now,
    first_approved_at: null,
    first_approved_by: '',
    first_approved_by_name: '',
    second_approved_at: null,
    second_approved_by: '',
    second_approved_by_name: '',
    final_approved_at: null,
    final_approved_by: '',
    final_approved_by_name: '',
    rejection_reason: '',
    contract_exception_required: isConditional,
    contract_exception_reason: isConditional ? f.contractExceptionReason : '',
    conditional_approval: isConditional,
    conditional_approved_at: autoApprove && isConditional ? now : null,
  };

  if (autoApprove) {
    basePayload.registration_status = 'approved';
    basePayload.first_approved_at = now;
    basePayload.first_approved_by = String(session.id || '');
    basePayload.first_approved_by_name = session.name || '';
    basePayload.second_approved_at = has3 ? now : null;
    basePayload.second_approved_by = has3 ? String(session.id || '') : '';
    basePayload.second_approved_by_name = has3 ? (session.name || '') : '';
    basePayload.final_approved_at = now;
    basePayload.final_approved_by = String(session.id || '');
    basePayload.final_approved_by_name = session.name || '';
  } else {
    basePayload.registration_status = 'pending';
  }

  if (prev) await _projRegApplyContractToPayload(basePayload, f.file, f.removeContractMeta, prev);
  else await _projRegApplyContractToPayload(basePayload, f.file, f.removeContractMeta, null);
  if (prev) await _projRegApplyEvidenceToPayload(basePayload, f.evidenceFile, f.removeEvidenceMeta, prev);
  else await _projRegApplyEvidenceToPayload(basePayload, f.evidenceFile, f.removeEvidenceMeta, null);
  if (prev) await _projRegApplyRouteEvidenceToPayload(basePayload, f.routeEvidenceFile, f.removeRouteEvidenceMeta, prev);
  else await _projRegApplyRouteEvidenceToPayload(basePayload, f.routeEvidenceFile, f.removeRouteEvidenceMeta, null);
  if (!isConditional) {
    basePayload.contract_exception_required = false;
    basePayload.contract_exception_reason = '';
    basePayload.conditional_approval = false;
    basePayload.conditional_approved_at = null;
    basePayload.contract_evidence_file_name = '';
    basePayload.contract_evidence_file_url = '';
    basePayload.contract_evidence_uploaded_at = null;
  }
  if (!prev && !f.file) {
    basePayload.contract_file_name = '';
    basePayload.contract_file_url = '';
  }

  try {
    let savedId = editId || '';
    if (editId) {
      await API.patch('registered_projects', editId, basePayload);
    } else {
      const created = await API.create('registered_projects', {
        ...basePayload,
        created_by: String(session.id || ''),
        created_by_name: session.name || '',
      });
      savedId = String((created && created.id) || '');
    }
    if (!autoApprove && basePayload.registration_status === 'pending') {
      _projRegNotifyProjectSubmit({
        rowId: savedId || editId || '',
        projectCode,
        projectName: f.name,
        clientName: f.clientName,
        pa1Id: basePayload.reg_pa1_id,
        pa1Name: basePayload.reg_pa1_name,
        pa2Id: basePayload.reg_pa2_id,
        pa2Name: basePayload.reg_pa2_name,
        pa3Id: basePayload.reg_pa3_id,
        pa3Name: basePayload.reg_pa3_name,
        fromSession: session,
      });
    }
    if (autoApprove) Toast.success((isConditional ? '조건부 승인되었습니다. 코드: ' : '승인되었습니다. 코드: ') + projectCode);
    else Toast.success((isConditional ? '조건부 승인 요청되었습니다. 코드: ' : '승인 요청되었습니다. 코드: ') + projectCode);
    projRegShowList();
  } catch (e) {
    Toast.error('승인 요청 실패: ' + (e.message || e));
  }
}

async function projRegOpenDetailFromApproval(id) {
  if (!id) return;
  try {
    navigateTo('project-register');
    if (typeof init_project_register === 'function') {
      await init_project_register();
    } else {
      await projRegLoadList();
    }
    await projRegShowForm(id, { fromApproval: true });
  } catch (e) {
    Toast.error('상세 화면을 여는 중 오류가 발생했습니다: ' + (e.message || e));
  }
}

async function projRegSaveApproved() {
  const session = getSession();
  if (!Auth.canManageProjectRegister(session)) {
    Toast.warning('권한이 없습니다.');
    return;
  }
  const editId = document.getElementById('proj-reg-edit-id').value;
  if (!editId) return;
  const prev = _projRegRows.find((x) => x.id === editId);
  if (!prev || _projRegNormStatus(prev) !== 'approved') {
    Toast.warning('승인 완료된 건만 이 방식으로 저장할 수 있습니다.');
    return;
  }
  const f = _projRegReadFormCore(session);
  if (!f.name) {
    Toast.warning('프로젝트명을 입력하세요.');
    return;
  }
  if (!f.clientId) {
    Toast.warning('고객사를 검색한 뒤 목록에서 선택하세요.');
    return;
  }
  const willHaveContract = _projRegFormWillHaveContract(f, prev);
  const willHaveEvidence = _projRegFormWillHaveEvidence(f, prev);
  const isConditional = !willHaveContract;
  if (isConditional && !willHaveEvidence) {
    Toast.warning('계약서 미첨부 시 고객 합의 근거 파일을 첨부해야 저장할 수 있습니다.');
    return;
  }
  if (isConditional && !f.contractExceptionReason) {
    Toast.warning('계약서 미첨부 사유를 입력하세요.');
    return;
  }
  const basePayload = {
    project_name: f.name,
    client_id: f.clientId,
    client_name: f.clientName,
    order_owner_text: f.orderOwner,
    acquisition_route: f.route,
    acquisition_route_detail: f.routeDetail,
    order_contributors_text: f.contributors,
    cpm_user_id: f.cpmId,
    cpm_user_name: f.cpmName,
    period_start: f.ps,
    period_end: f.pe,
    billing_schedule: f.billing,
    updated_by: String(session.id || ''),
    updated_by_name: session.name || '',
    contract_exception_required: isConditional,
    contract_exception_reason: isConditional ? f.contractExceptionReason : '',
    // 계약서가 첨부되면 조건부 승인 상태를 자동 해소
    conditional_approval: isConditional,
    conditional_approved_at: isConditional ? (prev.conditional_approved_at || Date.now()) : null,
  };
  await _projRegApplyContractToPayload(basePayload, f.file, f.removeContractMeta, prev);
  await _projRegApplyEvidenceToPayload(basePayload, f.evidenceFile, f.removeEvidenceMeta, prev);
  await _projRegApplyRouteEvidenceToPayload(basePayload, f.routeEvidenceFile, f.removeRouteEvidenceMeta, prev);
  if (!isConditional) {
    basePayload.contract_evidence_file_name = '';
    basePayload.contract_evidence_file_url = '';
    basePayload.contract_evidence_uploaded_at = null;
  }
  try {
    await API.patch('registered_projects', editId, basePayload);
    Toast.success('수정되었습니다.');
    projRegShowList();
  } catch (e) {
    Toast.error('저장 실패: ' + (e.message || e));
  }
}

async function _projRegResolveRow(id) {
  let row = _projRegRows.find((x) => String(x.id) === String(id));
  if (row) return row;
  try {
    row = await API.get('registered_projects', id);
  } catch (_) {
    row = null;
  }
  if (!row) {
    Toast.error('건을 찾을 수 없습니다.');
    return null;
  }
  const ix = _projRegRows.findIndex((x) => String(x.id) === String(id));
  if (ix >= 0) _projRegRows[ix] = row;
  else _projRegRows.push(row);
  return row;
}

async function projRegApprove(id) {
  const session = getSession();
  const row = await _projRegResolveRow(id);
  if (!row || _projRegNormStatus(row) !== 'pending') return;
  if (!_projRegCanApproveRow(session, row)) {
    Toast.warning('현재 단계의 승인 권한이 없습니다.');
    return;
  }
  const step = _projRegPendingStep(row);
  const now = Date.now();
  const eff = _projRegEffectiveApprovers(row);
  const willFinalApprove = (Number(step || 0) >= Number(eff.count || 0));
  const hasContract = _projRegHasContractMeta(row);
  const hasEvidence = _projRegHasEvidenceMeta(row);
  const isConditional = !hasContract;
  if (willFinalApprove && isConditional && !hasEvidence) {
    Toast.warning('계약서 미첨부 건은 고객 합의 근거 파일이 있어야 최종 승인할 수 있습니다.');
    return;
  }
  if (willFinalApprove && isConditional && !String(row.contract_exception_reason || '').trim()) {
    Toast.warning('계약서 미첨부 사유가 있어야 최종 승인할 수 있습니다.');
    return;
  }
  try {
    if (step === 1 && eff.count >= 2) {
      await API.patch('registered_projects', id, {
        first_approved_at: now,
        first_approved_by: String(session.id || ''),
        first_approved_by_name: session.name || '',
        updated_by: String(session.id || ''),
        updated_by_name: session.name || '',
      });
      _projRegNotifyProjectNextPending({ row, fromSession: session, step: 2 });
      Toast.success('1차 승인되었습니다.');
    } else if (step === 2 && eff.count >= 3) {
      await API.patch('registered_projects', id, {
        second_approved_at: now,
        second_approved_by: String(session.id || ''),
        second_approved_by_name: session.name || '',
        updated_by: String(session.id || ''),
        updated_by_name: session.name || '',
      });
      _projRegNotifyProjectNextPending({ row, fromSession: session, step: 3 });
      Toast.success('2차 승인되었습니다.');
    } else if (step === 2 || step === 3) {
      await API.patch('registered_projects', id, {
        final_approved_at: now,
        final_approved_by: String(session.id || ''),
        final_approved_by_name: session.name || '',
        registration_status: 'approved',
        conditional_approval: isConditional,
        conditional_approved_at: isConditional ? now : null,
        contract_exception_required: isConditional,
        updated_by: String(session.id || ''),
        updated_by_name: session.name || '',
      });
      _projRegNotifyProjectFinalResult({ row, decision: 'approved', fromSession: session });
      Toast.success(isConditional ? '조건부 승인 완료되었습니다.' : '승인 완료되었습니다.');
    } else {
      await API.patch('registered_projects', id, {
        first_approved_at: now,
        first_approved_by: String(session.id || ''),
        first_approved_by_name: session.name || '',
        final_approved_at: now,
        final_approved_by: String(session.id || ''),
        final_approved_by_name: session.name || '',
        registration_status: 'approved',
        conditional_approval: isConditional,
        conditional_approved_at: isConditional ? now : null,
        contract_exception_required: isConditional,
        updated_by: String(session.id || ''),
        updated_by_name: session.name || '',
      });
      _projRegNotifyProjectFinalResult({ row, decision: 'approved', fromSession: session });
      Toast.success(isConditional ? '조건부 승인 완료되었습니다.' : '승인 완료되었습니다.');
    }
    await projRegLoadList();
    if (typeof window.loadApprovalProjectList === 'function') {
      try {
        await window.loadApprovalProjectList();
      } catch (_) {}
    }
    const curFormId = document.getElementById('proj-reg-edit-id')?.value;
    if (curFormId === id) {
      const r2 = _projRegRows.find((x) => x.id === id);
      const rs = document.getElementById('proj-reg-row-status');
      if (rs && r2) rs.value = _projRegNormStatus(r2);
      await projRegShowForm(id);
    }
  } catch (e) {
    Toast.error('승인 실패: ' + (e.message || e));
  }
}

async function projRegReject(id) {
  const session = getSession();
  const row = await _projRegResolveRow(id);
  if (!row || _projRegNormStatus(row) !== 'pending') return;
  if (!_projRegCanApproveRow(session, row)) {
    Toast.warning('현재 단계의 반려 권한이 없습니다.');
    return;
  }
  const reason = window.prompt('반려 사유를 입력하세요.') ?? '';
  if (!String(reason).trim()) {
    Toast.warning('반려 사유를 입력하세요.');
    return;
  }
  try {
    await API.patch('registered_projects', id, {
      registration_status: 'rejected',
      rejection_reason: String(reason).trim(),
      first_approved_at: null,
      first_approved_by: '',
      first_approved_by_name: '',
      second_approved_at: null,
      second_approved_by: '',
      second_approved_by_name: '',
      final_approved_at: null,
      final_approved_by: '',
      final_approved_by_name: '',
      updated_by: String(session.id || ''),
      updated_by_name: session.name || '',
    });
    _projRegNotifyProjectFinalResult({ row, decision: 'rejected', fromSession: session, reason });
    Toast.success('반려 처리되었습니다.');
    await projRegLoadList();
    if (typeof window.loadApprovalProjectList === 'function') {
      try {
        await window.loadApprovalProjectList();
      } catch (_) {}
    }
    const curFormId = document.getElementById('proj-reg-edit-id')?.value;
    if (curFormId === id) await projRegShowForm(id);
  } catch (e) {
    Toast.error('반려 실패: ' + (e.message || e));
  }
}

function projRegApproveCurrent() {
  const id = document.getElementById('proj-reg-edit-id')?.value;
  if (id) projRegApprove(id);
}

function projRegRejectCurrent() {
  const id = document.getElementById('proj-reg-edit-id')?.value;
  if (id) projRegReject(id);
}

async function projRegDelete(id) {
  if (!Auth.canManageProjectRegister(getSession())) {
    Toast.warning('권한이 없습니다.');
    return;
  }
  const session = getSession();
  const row = _projRegRows.find((x) => x.id === id);
  if (!row) return;
  const st = _projRegNormStatus(row);
  const owner = _projRegIsOwner(session, row);
  if (st !== 'draft' && st !== 'rejected') {
    Toast.warning('임시저장·반려 상태만 삭제할 수 있습니다.');
    return;
  }
  if (!owner && session.role !== 'admin') {
    Toast.warning('삭제 권한이 없습니다.');
    return;
  }
  const codeLabel = row.project_code || row.project_name || '프로젝트';
  if (!await Confirm.delete(codeLabel)) return;
  try {
    await API.delete('registered_projects', id);
    Toast.success('삭제되었습니다.');
    await projRegLoadList();
  } catch (e) {
    Toast.error('삭제 실패: ' + (e.message || e));
  }
}

window.init_project_register = init_project_register;
window.projRegShowList = projRegShowList;
window.projRegShowForm = projRegShowForm;
window.projRegLoadList = projRegLoadList;
window.projRegRenderList = projRegRenderList;
window.projRegSaveDraft = projRegSaveDraft;
window.projRegSubmitForApproval = projRegSubmitForApproval;
window.projRegSaveApproved = projRegSaveApproved;
window.projRegSave = projRegSaveApproved;
window.projRegApprove = projRegApprove;
window.projRegReject = projRegReject;
window.projRegApproveCurrent = projRegApproveCurrent;
window.projRegRejectCurrent = projRegRejectCurrent;
window.projRegDelete = projRegDelete;
window.projRegOnCodeTypeChange = projRegOnCodeTypeChange;
window.projRegScrollToSection = projRegScrollToSection;
window.projRegRefreshProgress = projRegRefreshProgress;
window.projRegToggleAside = projRegToggleAside;
window.projRegOnRouteChange = projRegOnRouteChange;
window.projRegAddContributorRow = projRegAddContributorRow;
window.projRegRemoveContributorRow = projRegRemoveContributorRow;
window.projRegContribUpdate = projRegContribUpdate;
window.projRegOpenContribModal = projRegOpenContribModal;
window.projRegOpenContribModalEncoded = projRegOpenContribModalEncoded;
window.projRegOpenDetailFromApproval = projRegOpenDetailFromApproval;
window.projRegOpenContractDocModal = projRegOpenContractDocModal;
window.projRegUnlinkContractDoc = projRegUnlinkContractDoc;
window.projRegRenderContractDocModal = projRegRenderContractDocModal;
window.projRegOnContractFileChange = projRegOnContractFileChange;
window.projRegMarkContractRemove = projRegMarkContractRemove;
window.projRegOnEvidenceFileChange = projRegOnEvidenceFileChange;
window.projRegMarkEvidenceRemove = projRegMarkEvidenceRemove;
window.projRegOnRouteEvidenceFileChange = projRegOnRouteEvidenceFileChange;
window.projRegMarkRouteEvidenceRemove = projRegMarkRouteEvidenceRemove;
window.projRegResetListFilters = projRegResetListFilters;

window.SmartlogProjReg = {
  normStatus: _projRegNormStatus,
  statusLabel: _projRegStatusLabel,
  statusBadgeClass: _projRegStatusBadgeClass,
  pendingStep: _projRegPendingStep,
  canApproveRow: _projRegCanApproveRow,
  contribCount: _projRegContribRowCount,
  openContribModal: projRegOpenContribModal,
  openDetailFromApproval: projRegOpenDetailFromApproval,
  openContractDocModal: projRegOpenContractDocModal,
  approve: projRegApprove,
  reject: projRegReject,
};
