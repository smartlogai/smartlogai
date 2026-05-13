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
  'proj-proposal-revenue',
  'proj-proposal-direct-expense',
  'proj-proposal-rate-staff',
  'proj-proposal-rate-manager',
  'proj-proposal-rate-director',
  'proj-proposal-rate-top_mgr',
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
let _projRegWorkflowTab = 'proposal';
let _projRegContractView = 'list';
let _projRegProposalSnapshot = null;
let _projRegDetailTab = 'ops';
let _projRegOutputBound = false;
let _projRegRatePanelBound = false;
let _projRegContractRateInputBound = false;
let _projRegContractRateRowsByRole = {};

const _PROJ_REG_ROLE_KEYS = ['staff', 'manager', 'director', 'top_mgr'];
const _PROJ_REG_TC_TITLE_KEYS = ['associate', 'senior', 'principal', 'team_lead', 'division_head', 'bu_head', 'ceo'];
const _PROJ_REG_TC_DEFAULT_RATE = {
  senior: 200000,
  associate: 300000,
  principal: 500000,
  team_lead: 700000,
  division_head: 800000,
  bu_head: 900000,
  ceo: 1000000,
};

const _PROJ_REG_STORAGE_BUCKETS = {
  contract: 'registered-project-contracts',
  agreement: 'registered-project-agreements',
  route: 'registered-project-route-evidence',
};
const _PROJ_REG_OUTPUT_BUCKET = 'project-outputs';

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
  const r = _projRegNormRole(u && u.role);
  return r === 'manager' || r === 'director' || r === 'top_mgr' || r === 'admin';
}

function _projRegNormRole(role) {
  const raw = String(role || '').trim().toLowerCase();
  if (!raw) return '';
  if (typeof normalizeRoleName === 'function') return normalizeRoleName(raw);
  if (raw === 'top_mgr' || raw === 'topmgr' || raw === 'top-manager' || raw === 'top manager' || raw === '경영') return 'top_mgr';
  if (raw === 'administrator') return 'admin';
  return raw;
}

function _projRegParseDigits(v) {
  return String(v || '').replace(/[^\d]/g, '');
}

function _projRegFloorThousand(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v / 1000) * 1000;
}

function _projRegAmtValue(id) {
  const raw = _projRegParseDigits(document.getElementById(id)?.value || '');
  if (raw === '') return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function _projRegBindContractRateInputs() {
  if (_projRegContractRateInputBound) return;
  _PROJ_REG_TC_TITLE_KEYS.forEach((roleKey) => {
    const el = document.getElementById(`proj-reg-contract-rate-${roleKey}`);
    if (!el) return;
    el.addEventListener('focus', () => {
      const raw = _projRegParseDigits(el.value);
      el.value = raw === '' ? '' : raw;
    });
    el.addEventListener('blur', () => {
      const raw = _projRegParseDigits(el.value);
      if (raw === '') {
        el.value = '';
        return;
      }
      const n = _projRegFloorThousand(parseInt(raw, 10));
      el.value = n > 0 ? n.toLocaleString('ko-KR') : '';
    });
  });
  _projRegContractRateInputBound = true;
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

function _projRegIsCcbRegistrant(userRow, session) {
  const deptName = String((userRow && userRow.dept_name) || session?.dept_name || session?.department_name || '').trim();
  const hqName = String((userRow && userRow.hq_name) || session?.hq_name || '').trim();
  const csTeamName = String((userRow && userRow.cs_team_name) || session?.cs_team_name || '').trim();
  const src = `${deptName} ${hqName} ${csTeamName}`.toLowerCase();
  return src.includes('ccb');
}

async function _projRegRegistrantSnapshot(session) {
  let u = null;
  let users = [];
  try {
    users = await Master.users();
    u = users.find((x) => String(x.id) === String(session.id)) || null;
  } catch (_) {}
  const myRole = _projRegNormRole((u && u.role) || session.role || '');
  const activeUsers = (Array.isArray(users) ? users : []).filter((x) => x && x.deleted !== true && x.is_active !== false);
  const normName = (v) => String(v || '').toLowerCase().replace(/\s+/g, '').trim();
  const resolveApprover = (rawId, rawName) => {
    const id = String(rawId || '').trim();
    const name = String(rawName || '').trim();
    let hit = null;
    if (id) hit = activeUsers.find((x) => String(x.id || '').trim() === id) || null;
    if (!hit && name) {
      const key = normName(name);
      const matched = activeUsers.filter((x) => normName(x.name) === key);
      if (matched.length === 1) hit = matched[0];
    }
    return {
      id: String((hit && hit.id) || '').trim(),
      name: String((hit && hit.name) || name || '').trim(),
    };
  };
  const pa1Resolved = resolveApprover((u && u.approver_id) || session.approver_id, (u && u.approver_name) || session.approver_name);
  const pa2Resolved = resolveApprover((u && u.reviewer2_id) || session.reviewer2_id, (u && u.reviewer2_name) || session.reviewer2_name);
  const pa1Id = pa1Resolved.id;
  const pa1Name = pa1Resolved.name;
  const pa2Id = pa2Resolved.id;
  const pa2Name = pa2Resolved.name;

  const pickTopMgr = () => {
    if (!activeUsers.length) return { id: '', name: '' };
    const pickScore = (cand) => {
      if (!cand || _projRegNormRole(cand.role) !== 'top_mgr') return -1;
      let s = 0;
      if (u && u.dept_id && cand.dept_id && String(u.dept_id) === String(cand.dept_id)) s += 100;
      if (u && u.hq_id && cand.hq_id && String(u.hq_id) === String(cand.hq_id)) s += 40;
      if (u && u.cs_team_id && cand.cs_team_id && String(u.cs_team_id) === String(cand.cs_team_id)) s += 20;
      return s;
    };
    const sorted = activeUsers
      .filter((x) => _projRegNormRole((x && x.role) || '') === 'top_mgr')
      .map((x) => ({ x, score: pickScore(x) }))
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return String(a.x.name || '').localeCompare(String(b.x.name || ''));
      });
    const picked = sorted.length ? sorted[0].x : null;
    return {
      id: String((picked && picked.id) || '').trim(),
      name: String((picked && picked.name) || '').trim(),
    };
  };
  const pickDirector = () => {
    if (!activeUsers.length) return { id: '', name: '' };
    const pickScore = (cand) => {
      if (!cand || _projRegNormRole(cand.role) !== 'director') return -1;
      let s = 0;
      if (u && u.hq_id && cand.hq_id && String(u.hq_id) === String(cand.hq_id)) s += 100;
      if (u && u.dept_id && cand.dept_id && String(u.dept_id) === String(cand.dept_id)) s += 40;
      if (u && u.cs_team_id && cand.cs_team_id && String(u.cs_team_id) === String(cand.cs_team_id)) s += 20;
      return s;
    };
    const sorted = activeUsers
      .filter((x) => _projRegNormRole((x && x.role) || '') === 'director')
      .map((x) => ({ x, score: pickScore(x) }))
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return String(a.x.name || '').localeCompare(String(b.x.name || ''));
      });
    const picked = sorted.length ? sorted[0].x : null;
    return {
      id: String((picked && picked.id) || '').trim(),
      name: String((picked && picked.name) || '').trim(),
    };
  };

  const topMgr = pickTopMgr();
  const director = pickDirector();
  const isCcbRegistrant = _projRegIsCcbRegistrant(u, session);

  // 승인체계
  // - staff   : 1차(pa1) -> 2차(pa2) -> 최종(top_mgr)
  // - manager : 1차(pa1=본부장) -> 최종(top_mgr) 2단계
  // - director(CCB): 사용자등록 지정 승인자(pa1/pa2) -> 최종(top_mgr)
  // - director(기타): 기존과 동일(최종 top_mgr 1단계)
  if (myRole === 'staff') {
    return {
      pa1Id,
      pa1Name,
      pa2Id,
      pa2Name,
      pa3Id: topMgr.id,
      pa3Name: topMgr.name,
    };
  }
  if (myRole === 'manager') {
    return {
      pa1Id: director.id,
      pa1Name: director.name,
      pa2Id: '',
      pa2Name: '',
      pa3Id: topMgr.id,
      pa3Name: topMgr.name,
    };
  }
  if (myRole === 'director') {
    if (isCcbRegistrant) {
      return {
        pa1Id,
        pa1Name,
        pa2Id,
        pa2Name,
        pa3Id: topMgr.id,
        pa3Name: topMgr.name,
      };
    }
    return {
      pa1Id: topMgr.id,
      pa1Name: topMgr.name,
      pa2Id: '',
      pa2Name: '',
      pa3Id: '',
      pa3Name: '',
    };
  }
  return { pa1Id, pa1Name, pa2Id, pa2Name, pa3Id: '', pa3Name: '' };
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

function _projRegSortBucket(row) {
  const st = _projRegNormStatus(row);
  // 최우선: 반려/임시저장
  if (st === 'rejected') return 0;
  if (st === 'draft') return 1;
  if (st === 'pending') {
    const step = _projRegPendingStep(row);
    // 승인대기 -> 1차승인 -> 2차승인
    if (step === 1) return 2;
    if (step === 2) return 3;
    if (step === 3) return 4;
    return 2;
  }
  // 최종승인(승인완료/조건부승인)
  if (st === 'approved') return 5;
  return 9;
}

function _projRegSortTimeAsc(row) {
  const t = new Date((row && row.created_at) || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function _projRegSortTimeDescForApproved(row) {
  const t = new Date(
    (row && row.final_approved_at)
    || (row && row.second_approved_at)
    || (row && row.first_approved_at)
    || (row && row.created_at)
    || 0
  ).getTime();
  return Number.isFinite(t) ? t : 0;
}

function _projRegListComparator(a, b) {
  const ba = _projRegSortBucket(a);
  const bb = _projRegSortBucket(b);
  if (ba !== bb) return ba - bb;

  // 반려/임시저장은 과거건 우선(오름차순)
  if (ba <= 1) {
    const ta = _projRegSortTimeAsc(a);
    const tb = _projRegSortTimeAsc(b);
    if (ta !== tb) return ta - tb;
    return String((a && a.project_code) || '').localeCompare(String((b && b.project_code) || ''));
  }

  // 승인대기/1차승인/2차승인은 과거건 우선(오름차순)
  if (ba >= 2 && ba <= 4) {
    const ta = _projRegSortTimeAsc(a);
    const tb = _projRegSortTimeAsc(b);
    if (ta !== tb) return ta - tb;
    return String((a && a.project_code) || '').localeCompare(String((b && b.project_code) || ''));
  }

  // 최종승인은 최신순(내림차순)
  if (ba === 5) {
    const ta = _projRegSortTimeDescForApproved(a);
    const tb = _projRegSortTimeDescForApproved(b);
    if (ta !== tb) return tb - ta;
    return String((a && a.project_code) || '').localeCompare(String((b && b.project_code) || ''));
  }

  // 기타 상태는 최신순 유지
  const ta = _projRegSortTimeAsc(a);
  const tb = _projRegSortTimeAsc(b);
  if (ta !== tb) return tb - ta;
  return String((a && a.project_code) || '').localeCompare(String((b && b.project_code) || ''));
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
  if (targetId && myIds.has(targetId)) return true;
  // 사업부장(top_mgr)은 지정된 승인자 ID와 일치할 때만 승인 가능(참고건 오인 방지)
  if (_projRegNormRole(session && session.role) === 'top_mgr') return false;
  // 운영 중 사용자 재생성 등으로 승인자 ID가 바뀐 경우(과거 pending 데이터),
  // 단계별 승인자 "이름"이 현재 세션명과 일치하면 승인 가능하도록 폴백한다.
  const normLoose = (v) => {
    let s = String(v || '').toLowerCase();
    s = s.replace(/\([^)]*\)/g, '');
    s = s.replace(/[^0-9a-z가-힣]/g, '');
    s = s.replace(/(staff|manager|director|topmgr|top_mgr|cpm)$/g, '');
    s = s.replace(/(사원|대리|과장|차장|부장|팀장|실장|본부장|사업부장|이사|상무|전무|부사장|사장)$/g, '');
    return s.trim();
  };
  const isLooseNameMatch = (a, b) => {
    const x = normLoose(a);
    const y = normLoose(b);
    if (!x || !y) return false;
    if (x === y) return true;
    if (x.length >= 3 && y.includes(x)) return true;
    if (y.length >= 3 && x.includes(y)) return true;
    return false;
  };
  const targetNameRaw =
    step === 1 ? String((row && row.reg_pa1_name) || '').trim()
    : (step === 2
      ? String((eff.count >= 3 ? row?.reg_pa2_name : row?.reg_pa3_name) || '').trim()
      : String((row && row.reg_pa3_name) || '').trim());
  const myName = String((session && session.name) || '').trim();
  if (targetNameRaw && myName && isLooseNameMatch(targetNameRaw, myName)) return true;
  // 중요: 사업부장(top_mgr)이라도 "지정된 승인자"가 아니면 승인 불가
  // (과거 완화 로직으로 타 사업부 pending 건이 승인대상으로 보이는 현상 방지)
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
  const eff = _projRegEffectiveApprovers(row);
  const targetId = String((eff.chain && eff.chain[n - 1]) || '').trim();
  const targetName = (
    targetId && String(row.reg_pa1_id || '').trim() === targetId ? String(row.reg_pa1_name || '').trim()
    : targetId && String(row.reg_pa2_id || '').trim() === targetId ? String(row.reg_pa2_name || '').trim()
    : targetId && String(row.reg_pa3_id || '').trim() === targetId ? String(row.reg_pa3_name || '').trim()
    : ''
  );
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

function _projRegHasFinanceKeyword(v) {
  const t = String(v || '').trim().toLowerCase();
  if (!t) return false;
  return (
    t.includes('경영지원') ||
    t.includes('재경') ||
    t.includes('재무') ||
    t.includes('finance')
  );
}

function _projRegIsFinanceTeamUser(u) {
  if (!u || u.deleted === true || u.is_active === false) return false;
  const role = String(u.role || '').trim().toLowerCase();
  if (role === 'finance') return true;
  return (
    _projRegHasFinanceKeyword(u.dept_name) ||
    _projRegHasFinanceKeyword(u.hq_name) ||
    _projRegHasFinanceKeyword(u.cs_team_name) ||
    _projRegHasFinanceKeyword(u.team_name)
  );
}

async function _projRegNotifyFinanceTeamOnFinalApproved({ row, fromSession }) {
  if (typeof createNotification !== 'function' || !row) return;
  if (!Array.isArray(_projRegUsers) || !_projRegUsers.length) {
    try {
      _projRegUsers = await Master.users();
    } catch (_) {
      _projRegUsers = [];
    }
  }
  const financeUsers = (_projRegUsers || []).filter(_projRegIsFinanceTeamUser);
  if (!financeUsers.length) return;
  const senderId = String(fromSession?.id || fromSession?.user_id || '').trim();
  const senderName = String(fromSession?.name || fromSession?.user_name || '').trim();
  const projectCode = String(row.project_code || '').trim();
  const clientName = String(row.client_name || '').trim();
  const projectName = String(row.project_name || '').trim();
  const summary = `${projectCode || '-'} | ${clientName || '-'}`;
  const message = `${senderName || '승인자'}님이 프로젝트를 최종 승인했습니다. 프로젝트코드: ${projectCode || '-'}, 고객사명: ${clientName || '-'}${projectName ? `, 프로젝트명: ${projectName}` : ''}`;
  const sent = new Set();
  await Promise.allSettled(financeUsers.map((u) => {
    const uid = String(u.id || '').trim();
    if (!uid || uid === senderId || sent.has(uid)) return Promise.resolve();
    sent.add(uid);
    return createNotification({
      toUserId: uid,
      toUserName: String(u.name || ''),
      fromUserId: senderId,
      fromUserName: senderName,
      type: 'project_registered_final_approved',
      entryId: String(row.id || ''),
      entrySummary: summary,
      message,
      targetMenu: 'project-register',
    });
  }));
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
  return (rows || []).map((r) => {
    const userObj = (r && typeof r.user === 'object' && r.user) ? r.user : null;
    const rawName = (r && (r.name || r.user_name || r.member_name))
      || (userObj && (userObj.name || userObj.user_name))
      || '';
    const rawRole = (r && (r.role || r.project_role || r.title || r.job_title))
      || (userObj && (userObj.role || userObj.title))
      || '';
    const rawContribution = (r && (r.contribution || r.allocation_pct || r.allocation_percent || r.allocation_p || r.share))
      || '';
    return {
      name: String(rawName || '').trim(),
      role: String(rawRole || '').trim(),
      contribution: String(rawContribution || '').replace(/[^\d.]/g, ''),
    };
  });
}

function _projRegTryParseContribJson(text) {
  const src = String(text || '').trim();
  if (!src) return null;
  const candidates = [];
  candidates.push(src);
  if (/^json\s*:+/i.test(src)) candidates.push(src.replace(/^json\s*:+/i, '').trim());
  if (/^json\s*[-=]*\s*:+/i.test(src)) candidates.push(src.replace(/^json\s*[-=]*\s*:+/i, '').trim());
  if (
    (src.startsWith('"') && src.endsWith('"'))
    || (src.startsWith("'") && src.endsWith("'"))
  ) {
    candidates.push(src.slice(1, -1));
  }
  for (const cand of candidates) {
    try {
      const parsed = JSON.parse(cand);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.contributors)) return parsed.contributors;
    } catch (_) {}
    try {
      const unescaped = cand
        .replace(/\\"/g, '"')
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ');
      const parsed2 = JSON.parse(unescaped);
      if (Array.isArray(parsed2)) return parsed2;
      if (parsed2 && Array.isArray(parsed2.contributors)) return parsed2.contributors;
    } catch (_) {}
  }
  return null;
}

function _projRegContribParse(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return [];
  // 수행상세 투입인력(JSON::) 포맷은 수주참여자 카운트/표시에 포함하지 않는다.
  if (txt.startsWith('JSON::')) return [];
  const parsedRows = _projRegTryParseContribJson(txt);
  if (Array.isArray(parsedRows)) return _projRegContribNormalize(parsedRows);
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
  const activePage = document.querySelector('.nav-item.active')?.dataset.page || '';
  if (activePage === 'project-management') {
    if (typeof init_project_management === 'function') {
      await init_project_management();
    }
    return;
  }
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
  await projRegFillDropdowns();
  _projRegBindListFiltersOnce();
  projRegBindContractDocFiltersOnce();
  if (!_projRegOutputBound) {
    document.getElementById('proj-reg-out-refresh-btn')?.addEventListener('click', projRegOutLoadList);
    document.getElementById('proj-reg-out-upload-btn')?.addEventListener('click', projRegOutUpload);
    _projRegOutputBound = true;
  }
  if (!_projRegRatePanelBound) {
    document.getElementById('proj-reg-contract-rate-save-btn')?.addEventListener('click', projRegSaveContractRates);
    document.getElementById('proj-reg-contract-rate-reload-btn')?.addEventListener('click', () => _projRegLoadContractRatePanel(_projRegOutCurrentRow()));
    document.getElementById('proj-reg-timecharge-enabled-input')?.addEventListener('change', () => {
      projRegToggleTimeChargeRatePanel();
      _projRegLoadContractRatePanel(_projRegOutCurrentRow()).catch(() => {});
    });
    _projRegBindContractRateInputs();
    _projRegRatePanelBound = true;
  }
  await projRegLoadList();
  projRegInitProposalForm();
  projRegSwitchWorkflowTab('contract');
  if (typeof init_project_management === 'function') {
    await init_project_management();
  } else {
    const activePage = document.querySelector('.nav-item.active')?.dataset.page || '';
    if (typeof applyProjectPageMode === 'function') {
      applyProjectPageMode(activePage === 'project-management' ? 'manage' : 'register');
    }
  }
}

function _projRegProposalRoleLabel(roleKey) {
  const map = {
    staff: '담당(전임/선임/책임)',
    manager: '팀장',
    director: '본부장',
    top_mgr: '사업부장',
  };
  return map[String(roleKey || '').toLowerCase()] || String(roleKey || '-');
}

function _projRegProposalNum(id) {
  return _projRegParseDigits(document.getElementById(id)?.value || '') || '0';
}

function _projRegProposalNumValue(id) {
  const n = parseInt(_projRegProposalNum(id), 10);
  return Number.isFinite(n) ? n : 0;
}

function _projRegProposalHourValue(id) {
  const n = Number(document.getElementById(id)?.value || 0);
  return Number.isFinite(n) ? n : 0;
}

function _projRegProposalPctValue(id) {
  const n = Number(document.getElementById(id)?.value || 0);
  return Number.isFinite(n) ? n : 0;
}

function _projRegProposalKrw(v) {
  return `${Math.round(Number(v || 0)).toLocaleString('ko-KR')}원`;
}

function _projRegIsTimeChargeEnabled() {
  return !!document.getElementById('proj-reg-timecharge-enabled-input')?.checked;
}

function projRegToggleTimeChargeRatePanel() {
  const wrap = document.getElementById('proj-reg-contract-rate-wrap');
  if (!wrap) return;
  const on = _projRegIsTimeChargeEnabled();
  wrap.style.display = on ? '' : 'none';
}

async function projRegOpenContractRateInput() {
  const tcEl = document.getElementById('proj-reg-timecharge-enabled-input');
  if (tcEl && !tcEl.checked) tcEl.checked = true;
  projRegToggleTimeChargeRatePanel();
  try {
    await _projRegLoadContractRatePanel(_projRegOutCurrentRow());
  } catch (_) {}
  const wrap = document.getElementById('proj-reg-contract-rate-wrap');
  if (wrap) {
    try { wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
  }
  const firstInput = document.getElementById('proj-reg-contract-rate-associate');
  if (firstInput) firstInput.focus();
}

function _projRegRateProjectCode(row) {
  const rowCode = String((row && row.project_code) || '').trim();
  if (rowCode) return rowCode;
  return String(document.getElementById('proj-reg-existing-code')?.value || '').trim();
}

function _projRegRateProjectId(row) {
  const rowId = String((row && row.id) || '').trim();
  if (rowId) return rowId;
  return String(document.getElementById('proj-reg-edit-id')?.value || '').trim();
}

function _projRegSetContractBaseRate(roleKey, rate) {
  const el = document.getElementById(`proj-reg-contract-base-${roleKey}`);
  if (el) el.textContent = `${Math.round(Number(rate || 0)).toLocaleString('ko-KR')}원`;
}

function _projRegSetContractRateInputs(roleKey, row) {
  const rateEl = document.getElementById(`proj-reg-contract-rate-${roleKey}`);
  const noteEl = document.getElementById(`proj-reg-contract-note-${roleKey}`);
  if (rateEl) {
    const n = row ? _projRegFloorThousand(Number(row.unit_rate || 0)) : 0;
    rateEl.value = n > 0 ? n.toLocaleString('ko-KR') : '';
  }
  if (noteEl) noteEl.value = String((row && row.note) || '');
}

async function _projRegLoadContractRatePanel(row) {
  projRegToggleTimeChargeRatePanel();
  const projectCode = _projRegRateProjectCode(row);
  const projectId = _projRegRateProjectId(row);
  const defaultBaseMap = { ..._PROJ_REG_TC_DEFAULT_RATE };
  _PROJ_REG_TC_TITLE_KEYS.forEach((role) => {
    _projRegSetContractBaseRate(role, Number(defaultBaseMap[role] || 0));
    _projRegSetContractRateInputs(role, null);
  });
  _projRegContractRateRowsByRole = {};
  try {
    const stdRows = await API.listAllPages('standard_rate_master', {
      filter: 'is_active=eq.true',
      limit: 100,
      maxPages: 3,
      sort: 'updated_at',
    }).catch(() => []);
    const stdMap = {};
    (stdRows || []).forEach((r) => {
      const key = String(r.role_key || '').toLowerCase();
      if (!_PROJ_REG_TC_TITLE_KEYS.includes(key) || stdMap[key]) return;
      stdMap[key] = Number(r.unit_rate || 0);
    });
    _PROJ_REG_TC_TITLE_KEYS.forEach((role) => {
      const n = Number(stdMap[role] || defaultBaseMap[role] || 0);
      _projRegSetContractBaseRate(role, n);
    });
    if (!projectCode && !projectId) return;
    let contractRowsByCode = [];
    let contractRowsByProject = [];
    if (projectCode) {
      contractRowsByCode = await API.listAllPages('project_rate_cards', {
        filter: `project_code=eq.${encodeURIComponent(projectCode)}&is_active=eq.true`,
        limit: 200,
        maxPages: 5,
        sort: 'updated_at',
      }).catch(() => []);
    }
    if (projectId) {
      contractRowsByProject = await API.listAllPages('project_rate_cards', {
        filter: `project_id=eq.${encodeURIComponent(projectId)}&is_active=eq.true`,
        limit: 200,
        maxPages: 5,
        sort: 'updated_at',
      }).catch(() => []);
    }
    const mergedRows = [...(contractRowsByCode || []), ...(contractRowsByProject || [])];
    const uniqById = {};
    mergedRows.forEach((r) => {
      const rid = String(r && r.id || '').trim();
      if (!rid || uniqById[rid]) return;
      uniqById[rid] = r;
    });
    const sorted = Object.values(uniqById)
      .slice()
      .sort((a, b) => Number(b.updated_at || b.created_at || 0) - Number(a.updated_at || a.created_at || 0));
    const byRole = {};
    sorted.forEach((r) => {
      const role = String(r.role_key || '').toLowerCase();
      const userId = String(r.user_id || '').trim();
      if (!_PROJ_REG_TC_TITLE_KEYS.includes(role)) return;
      if (userId) return;
      if (!byRole[role]) byRole[role] = r;
    });
    _projRegContractRateRowsByRole = byRole;
    _PROJ_REG_TC_TITLE_KEYS.forEach((role) => _projRegSetContractRateInputs(role, byRole[role] || null));
  } catch (e) {
    console.warn('[proj-reg] contract rate load failed', e?.message || e);
  }
}

async function _projRegPersistProjectContractRates(projectCode, projectId, session) {
  const code = String(projectCode || '').trim();
  const pid = String(projectId || '').trim();
  if (!code && !pid) return;
  const enabled = _projRegIsTimeChargeEnabled();
  if (!enabled) {
    let existsByCode = [];
    let existsByProject = [];
    if (code) {
      existsByCode = await API.listAllPages('project_rate_cards', {
        filter: `project_code=eq.${encodeURIComponent(code)}&is_active=eq.true`,
        limit: 300,
        maxPages: 5,
        sort: 'updated_at',
      }).catch(() => []);
    }
    if (pid) {
      existsByProject = await API.listAllPages('project_rate_cards', {
        filter: `project_id=eq.${encodeURIComponent(pid)}&is_active=eq.true`,
        limit: 300,
        maxPages: 5,
        sort: 'updated_at',
      }).catch(() => []);
    }
    const uniqRows = {};
    [...(existsByCode || []), ...(existsByProject || [])].forEach((r) => {
      const rid = String(r && r.id || '').trim();
      if (!rid || uniqRows[rid]) return;
      uniqRows[rid] = r;
    });
    const exists = Object.values(uniqRows);
    for (const row of (exists || [])) {
      if (!row || !row.id) continue;
      await API.patch('project_rate_cards', row.id, {
        is_active: false,
        updated_at: Date.now(),
      });
    }
    return;
  }
  for (const role of _PROJ_REG_TC_TITLE_KEYS) {
    const rateRaw = _projRegParseDigits(document.getElementById(`proj-reg-contract-rate-${role}`)?.value || '');
    const unitRate = _projRegFloorThousand(Number(rateRaw || 0));
    const note = String(document.getElementById(`proj-reg-contract-note-${role}`)?.value || '').trim();
    const hit = _projRegContractRateRowsByRole[role] || null;
    if (unitRate > 0) {
      const payload = {
        project_id: pid,
        project_code: code,
        user_id: '',
        role_key: role,
        unit_rate: unitRate,
        effective_from: null,
        effective_to: null,
        is_active: true,
        note,
        updated_at: Date.now(),
      };
      if (hit && hit.id) await API.patch('project_rate_cards', hit.id, payload);
      else {
        await API.create('project_rate_cards', {
          ...payload,
          created_by: String(session.id || ''),
          created_by_name: session.name || '',
          created_at: Date.now(),
        });
      }
    } else if (hit && hit.id) {
      await API.patch('project_rate_cards', hit.id, {
        is_active: false,
        updated_at: Date.now(),
      });
    }
  }
}

async function projRegSaveContractRates() {
  const session = getSession();
  if (!Auth.canManageProjectRegister(session)) {
    Toast.warning('권한이 없습니다.');
    return;
  }
  let row = _projRegOutCurrentRow();
  let projectCode = _projRegRateProjectCode(row);
  let projectId = _projRegRateProjectId(row);
  if (!projectId) {
    const saved = await projRegSaveDraft({ silentSuccess: true, skipRatePersist: true });
    if (!saved) return;
    row = _projRegOutCurrentRow();
    projectCode = _projRegRateProjectCode(row);
    projectId = _projRegRateProjectId(row);
    if (!projectId) {
      Toast.warning('임시저장 후에도 프로젝트 식별자를 확인할 수 없어 계약단가를 저장하지 못했습니다.');
      return;
    }
  }
  try {
    await _projRegPersistProjectContractRates(projectCode, projectId, session);
    await _projRegLoadContractRatePanel(row);
    Toast.success('프로젝트 계약단가를 저장했습니다.');
  } catch (e) {
    Toast.error('계약단가 저장 실패: ' + (e.message || e));
  }
}

function _projRegPopulateProposalCodeTypeSelect() {
  const sel = document.getElementById('proj-proposal-code-type');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">코드유형 선택</option>';
  (_projRegTypes || []).forEach((t) => {
    const opt = document.createElement('option');
    opt.value = String(t.id || '');
    opt.textContent = `${t.main_category} · ${t.main_code} — ${t.sub_category} (${t.sub_code})`;
    sel.appendChild(opt);
  });
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function projRegInitProposalForm() {
  _projRegPopulateProposalCodeTypeSelect();
  if (!document.getElementById('proj-proposal-temp-code')?.value) {
    projRegGenerateProposalTempCode();
  }
}

function _projRegRenderWorkflowTab() {
  const proposalPanel = document.getElementById('proj-proposal-panel');
  const list = document.getElementById('proj-reg-list');
  const form = document.getElementById('proj-reg-form');
  if (!proposalPanel && _projRegWorkflowTab === 'proposal') {
    _projRegWorkflowTab = 'contract';
  }
  document.querySelectorAll('[data-proj-wf-tab]').forEach((btn) => {
    const on = btn.getAttribute('data-proj-wf-tab') === _projRegWorkflowTab;
    btn.classList.toggle('is-active', on);
  });
  if (proposalPanel) proposalPanel.style.display = _projRegWorkflowTab === 'proposal' ? '' : 'none';
  if (_projRegWorkflowTab === 'proposal') {
    if (list) list.style.display = 'none';
    if (form) form.style.display = 'none';
    return;
  }
  if (_projRegContractView === 'form') {
    if (list) list.style.display = 'none';
    if (form) form.style.display = '';
  } else {
    if (list) list.style.display = '';
    if (form) form.style.display = 'none';
  }
}

function projRegSwitchWorkflowTab(tab) {
  const next = tab === 'contract' ? 'contract' : 'proposal';
  _projRegWorkflowTab = next;
  _projRegRenderWorkflowTab();
}

function projRegGenerateProposalTempCode() {
  const el = document.getElementById('proj-proposal-temp-code');
  if (!el) return;
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0');
  el.value = `TMP-${yy}${mm}-${seq}`;
}

function projRegResetProposalForm() {
  const ids = [
    'proj-proposal-name',
    'proj-proposal-client',
    'proj-proposal-code-type',
    'proj-proposal-revenue',
    'proj-proposal-direct-expense',
    'proj-proposal-rate-staff',
    'proj-proposal-rate-manager',
    'proj-proposal-rate-director',
    'proj-proposal-rate-top_mgr',
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['proj-proposal-target-margin', 'proj-proposal-indirect-rate'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = id === 'proj-proposal-target-margin' ? '20' : '0';
  });
  ['staff', 'manager', 'director', 'top_mgr'].forEach((k) => {
    const h = document.getElementById(`proj-proposal-hours-${k}`);
    if (h) h.value = '0';
    const c = document.getElementById(`proj-proposal-cost-${k}`);
    if (c) c.textContent = '0원';
  });
  projRegGenerateProposalTempCode();
  _projRegProposalSnapshot = null;
  projRegRunProposalSimulation();
}

function _projRegCollectProposalSnapshot() {
  const rateMap = {
    staff: _projRegProposalNumValue('proj-proposal-rate-staff'),
    manager: _projRegProposalNumValue('proj-proposal-rate-manager'),
    director: _projRegProposalNumValue('proj-proposal-rate-director'),
    top_mgr: _projRegProposalNumValue('proj-proposal-rate-top_mgr'),
  };
  const hourMap = {
    staff: _projRegProposalHourValue('proj-proposal-hours-staff'),
    manager: _projRegProposalHourValue('proj-proposal-hours-manager'),
    director: _projRegProposalHourValue('proj-proposal-hours-director'),
    top_mgr: _projRegProposalHourValue('proj-proposal-hours-top_mgr'),
  };
  let laborCost = 0;
  _PROJ_REG_ROLE_KEYS.forEach((k) => {
    laborCost += Number(rateMap[k] || 0) * Number(hourMap[k] || 0);
  });
  const revenue = _projRegProposalNumValue('proj-proposal-revenue');
  const directExpense = _projRegProposalNumValue('proj-proposal-direct-expense');
  const indirectRate = _projRegProposalPctValue('proj-proposal-indirect-rate');
  const targetMarginPct = _projRegProposalPctValue('proj-proposal-target-margin');
  const indirectCost = (laborCost + directExpense) * (indirectRate / 100);
  const totalCost = laborCost + directExpense + indirectCost;
  const recommended = targetMarginPct >= 100 ? 0 : (totalCost / Math.max(0.0001, 1 - (targetMarginPct / 100)));
  const expectedMarginPct = revenue > 0 ? ((revenue - totalCost) / revenue) * 100 : 0;
  return {
    tempCode: String(document.getElementById('proj-proposal-temp-code')?.value || '').trim(),
    proposalName: String(document.getElementById('proj-proposal-name')?.value || '').trim(),
    clientName: String(document.getElementById('proj-proposal-client')?.value || '').trim(),
    projectCodeTypeId: String(document.getElementById('proj-proposal-code-type')?.value || '').trim(),
    revenue,
    directExpense,
    indirectRate,
    targetMarginPct,
    laborCost,
    indirectCost,
    totalCost,
    recommended,
    expectedMarginPct,
    roleRates: rateMap,
    roleHours: hourMap,
  };
}

function projRegRunProposalSimulation() {
  const s = _projRegCollectProposalSnapshot();
  _PROJ_REG_ROLE_KEYS.forEach((k) => {
    const cost = Number(s.roleRates[k] || 0) * Number(s.roleHours[k] || 0);
    const cell = document.getElementById(`proj-proposal-cost-${k}`);
    if (cell) cell.textContent = _projRegProposalKrw(cost);
  });
  const setTxt = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  setTxt('proj-proposal-kpi-labor', _projRegProposalKrw(s.laborCost));
  setTxt('proj-proposal-kpi-total-cost', _projRegProposalKrw(s.totalCost));
  setTxt('proj-proposal-kpi-recommended', _projRegProposalKrw(s.recommended));
  setTxt('proj-proposal-kpi-margin', `${(Number(s.expectedMarginPct) || 0).toFixed(1)}%`);
  _projRegProposalSnapshot = s;
  return s;
}

async function _projRegPersistProposalFinalRates(projectCode) {
  if (!projectCode || !_projRegProposalSnapshot) return;
  const rates = _projRegProposalSnapshot.roleRates || {};
  const rows = _PROJ_REG_ROLE_KEYS
    .filter((k) => Number(rates[k] || 0) > 0)
    .map((k) => ({ role_key: k, unit_rate: Number(rates[k] || 0) }));
  if (!rows.length) return;
  try {
    const existing = await API.listAllPages('project_proposal_rates', {
      limit: 200,
      maxPages: 3,
      filter: { project_code: projectCode },
      sort: 'updated_at',
    }).catch(() => []);
    const byRole = new Map((existing || []).map((r) => [String(r.role_key || ''), r]));
    const session = getSession();
    for (const row of rows) {
      const hit = byRole.get(row.role_key);
      const payload = {
        project_code: projectCode,
        role_key: row.role_key,
        unit_rate: row.unit_rate,
        is_final: true,
        is_active: true,
        source_type: 'proposal_final',
        updated_at: Date.now(),
        updated_by: String(session.id || ''),
        updated_by_name: session.name || '',
      };
      if (hit && hit.id) await API.patch('project_proposal_rates', hit.id, payload);
      else await API.create('project_proposal_rates', payload);
    }
  } catch (e) {
    console.warn('[proj-reg] project_proposal_rates 저장 실패', e.message || e);
  }
}

async function projRegLoadCodeSettingRates() {
  const typeId = String(document.getElementById('proj-proposal-code-type')?.value || '').trim();
  if (!typeId) {
    Toast.warning('코드유형을 먼저 선택하세요.');
    return;
  }
  try {
    const rows = await API.listAllPages('project_code_rate_settings', {
      limit: 50,
      maxPages: 3,
      filter: { project_code_type_id: typeId, is_active: 'eq.true' },
      sort: 'updated_at',
    });
    const byRole = new Map((rows || []).map((r) => [String(r.role_key || '').toLowerCase(), r]));
    _PROJ_REG_ROLE_KEYS.forEach((k) => {
      const hit = byRole.get(k);
      if (!hit) return;
      const input = document.getElementById(`proj-proposal-rate-${k}`);
      if (!input) return;
      const n = Number(hit.unit_rate || 0);
      input.value = Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : '';
    });
    projRegRunProposalSimulation();
    Toast.success('코드설정 단가를 불러왔습니다.');
  } catch (_) {
    Toast.warning('코드설정 단가를 불러오지 못했습니다. 설정 테이블을 확인하세요.');
  }
}

async function projRegApplyProposalToContract() {
  const s = projRegRunProposalSimulation();
  await projRegShowForm();
  const nameEl = document.getElementById('proj-reg-name');
  const clientSearchEl = document.getElementById('proj-reg-client-search');
  const downAmtEl = document.getElementById('proj-reg-bill-down-amt');
  const typeSel = document.getElementById('proj-reg-code-type');
  if (nameEl && !nameEl.value.trim() && s.proposalName) nameEl.value = s.proposalName;
  if (clientSearchEl && !clientSearchEl.value.trim() && s.clientName) clientSearchEl.value = s.clientName;
  if (downAmtEl && !downAmtEl.value && Number(s.revenue || 0) > 0) {
    downAmtEl.value = Math.round(Number(s.revenue || 0)).toLocaleString('ko-KR');
  }
  if (typeSel && s.projectCodeTypeId && [...typeSel.options].some((o) => String(o.value) === String(s.projectCodeTypeId))) {
    typeSel.value = s.projectCodeTypeId;
    _projRegApplyTypeLockedName(s.projectCodeTypeId);
  }
  projRegRefreshProgress();
  Toast.success('제안 시뮬레이션 값을 계약등록 폼에 반영했습니다.');
}

function projRegExportProposalData() {
  const s = projRegRunProposalSimulation();
  const lines = [
    '항목,값',
    `임시코드,${s.tempCode || ''}`,
    `프로젝트명,${s.proposalName || ''}`,
    `고객사,${s.clientName || ''}`,
    `프로젝트매출액,${Math.round(Number(s.revenue || 0))}`,
    `직접비용,${Math.round(Number(s.directExpense || 0))}`,
    `간접비율(%),${Number(s.indirectRate || 0).toFixed(2)}`,
    `목표이익율(%),${Number(s.targetMarginPct || 0).toFixed(2)}`,
    `투입원가,${Math.round(Number(s.laborCost || 0))}`,
    `총원가,${Math.round(Number(s.totalCost || 0))}`,
    `권장제안금액,${Math.round(Number(s.recommended || 0))}`,
    `예상이익율(%),${Number(s.expectedMarginPct || 0).toFixed(2)}`,
  ];
  _PROJ_REG_ROLE_KEYS.forEach((k) => {
    lines.push(`${_projRegProposalRoleLabel(k)} 단가,${Math.round(Number(s.roleRates[k] || 0))}`);
    lines.push(`${_projRegProposalRoleLabel(k)} 투입시간(h),${Number(s.roleHours[k] || 0).toFixed(1)}`);
  });
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `proposal_${s.tempCode || 'data'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
  _projRegContractView = 'list';
  _projRegWorkflowTab = 'contract';
  _projRegDetailTab = 'ops';
  _projRegRenderWorkflowTab();
  if (reload !== false) projRegLoadList();
}

function _projRegOutCurrentRow() {
  const editId = String(document.getElementById('proj-reg-edit-id')?.value || '').trim();
  if (!editId) return null;
  return _projRegRows.find((x) => String(x.id || '') === editId) || null;
}

function _projRegOutFmtDate(ms) {
  const n = Number(ms || 0);
  if (!n) return '-';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().slice(0, 10);
}

function _projRegOutCanUpload(session, row) {
  if (!session || !row) return false;
  if (Auth.isAdmin(session) || Auth.isDirector(session) || Auth.isTopMgr(session)) return true;
  const me = String(session.user_id || session.id || '');
  const pm = String(row.cpm_user_id || '');
  return !!me && !!pm && me === pm;
}

function _projRegOutRequiresClearance(row) {
  if (!row) return false;
  const hit = (_projRegTypes || []).find((t) => String(t.id || '') === String(row.project_code_type_id || ''));
  return !!(hit && hit.requires_clearance_note);
}

async function _projRegOutNotifyClearance(row, created, session) {
  if (!row || typeof createNotification !== 'function') return;
  const pm = (_projRegUsers || []).find((u) => String(u.id || '') === String(row.cpm_user_id || '')) || {};
  const toUsers = (_projRegUsers || []).filter((u) => {
    const role = String(u.role || '').trim();
    if (role === 'director') return String(u.hq_id || '') && String(u.hq_id || '') === String(pm.hq_id || '');
    if (role === 'top_mgr') return String(u.dept_id || '') && String(u.dept_id || '') === String(pm.dept_id || '');
    return false;
  });
  const senderId = String(session.user_id || session.id || '');
  const uniq = new Set();
  toUsers.forEach((u) => {
    const uid = String(u.id || '').trim();
    if (!uid || uid === senderId || uniq.has(uid)) return;
    uniq.add(uid);
    createNotification({
      toUserId: uid,
      toUserName: String(u.name || ''),
      fromUserId: senderId,
      fromUserName: String(session.name || session.user_name || ''),
      type: 'project_clearance_notice',
      entryId: String(created?.id || ''),
      entrySummary: `${String(row.project_code || '')} | ${String(row.project_name || '')}`,
      message: `${String(session.name || '작성자')}님이 통관팀유의사항을 등록했습니다. 조치사항을 입력해주세요.`,
      targetMenu: 'project-register',
    });
  });
}

async function _projRegOutCheckClosureGate(row) {
  if (!row) return { ok: false, reason: '프로젝트 정보가 없습니다.' };
  if (!_projRegOutRequiresClearance(row)) return { ok: true, reason: '' };
  const projectCode = String(row.project_code || '').trim();
  const outputs = await API.list('project_outputs', {
    select: 'id,project_code,output_type',
    project_code: `eq.${projectCode}`,
    limit: 1000,
    order: 'uploaded_at.desc,created_at.desc',
  }).catch(() => []);
  const clearanceRows = (outputs || []).filter((o) => String(o.output_type || '').trim() === '통관팀유의사항');
  if (!clearanceRows.length) {
    return { ok: false, reason: '통관유의사항 업로드가 필요합니다.' };
  }
  const outputIds = clearanceRows.map((o) => String(o.id || '')).filter(Boolean);
  const actions = await API.listAllPages('project_output_actions', {
    limit: 1000,
    maxPages: 10,
    sort: 'updated_at',
  }).catch((e) => {
    const msg = String(e && e.message || '');
    if (/project_output_actions|schema cache|relation/i.test(msg)) {
      throw new Error('project_output_actions 테이블이 필요합니다. SQL 스크립트를 먼저 적용하세요.');
    }
    throw e;
  });
  const completedCnt = (actions || []).filter((a) =>
    outputIds.includes(String(a.output_id || '')) &&
    String(a.action_status || '') === 'completed'
  ).length;
  if (completedCnt < 1) {
    return { ok: false, reason: '통관유의사항 조치완료(본부장/사업부장 중 1명 이상)가 필요합니다.' };
  }
  return { ok: true, reason: '' };
}

function _projRegOutRefreshContext(row) {
  const infoEl = document.getElementById('proj-reg-out-project-info');
  const codeEl = document.getElementById('proj-reg-out-project-code');
  const uploadBtn = document.getElementById('proj-reg-out-upload-btn');
  const canUse = !!(row && row.project_code);
  if (codeEl) codeEl.value = canUse ? String(row.project_code || '') : '';
  if (infoEl) {
    if (!canUse) {
      infoEl.className = 'alert alert-info';
      infoEl.innerHTML = '<i class="fas fa-info-circle"></i> 먼저 프로젝트 상세를 저장(승인완료)한 후 산출물을 업로드하세요.';
    } else {
      const requiredText = _projRegOutRequiresClearance(row) ? '필수' : '선택';
      infoEl.className = 'alert alert-info';
      infoEl.innerHTML = `<i class="fas fa-info-circle"></i> <strong>${Utils.escHtml(row.project_code || '')}</strong> · ${Utils.escHtml(row.project_name || '')} / 통관유의사항 ${requiredText}`;
    }
  }
  if (uploadBtn) uploadBtn.disabled = !canUse;
}

async function projRegOutLoadList() {
  const body = document.getElementById('proj-reg-out-body');
  const summary = document.getElementById('proj-reg-out-summary');
  if (!body) return;
  const row = _projRegOutCurrentRow();
  if (!row || !row.project_code) {
    body.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-folder-open"></i><p>저장된 프로젝트를 먼저 선택하세요.</p></td></tr>';
    if (summary) summary.textContent = '총 0건';
    return;
  }
  body.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-spinner fa-spin"></i><p>산출물 목록을 불러오는 중입니다...</p></td></tr>';
  try {
    const rows = await API.list('project_outputs', {
      select: 'id,output_type,output_title,output_file_url,uploaded_by_name,uploaded_at,note,created_at',
      project_code: `eq.${row.project_code}`,
      order: 'uploaded_at.desc,created_at.desc',
      limit: 1000,
    });
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-folder-open"></i><p>등록된 산출물이 없습니다.</p></td></tr>';
      if (summary) summary.textContent = '총 0건';
      return;
    }
    body.innerHTML = list.map((r, i) => {
      const fileBtn = String(r.output_file_url || '').trim()
        ? `<a class="btn btn-xs btn-outline" href="${Utils.escHtml(r.output_file_url)}" target="_blank" rel="noopener">열기</a>`
        : '-';
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${Utils.escHtml(r.output_type || '')}</td>
        <td>${Utils.escHtml(r.output_title || '')}</td>
        <td>${Utils.escHtml(r.uploaded_by_name || '')}</td>
        <td>${_projRegOutFmtDate(r.uploaded_at || r.created_at)}</td>
        <td style="text-align:center">${fileBtn}</td>
        <td>${Utils.escHtml(r.note || '')}</td>
      </tr>`;
    }).join('');
    if (summary) summary.textContent = `총 ${list.length.toLocaleString()}건`;
  } catch (e) {
    console.error(e);
    body.innerHTML = '<tr><td colspan="7" class="table-empty"><i class="fas fa-triangle-exclamation"></i><p>산출물 목록 조회 실패</p></td></tr>';
    if (summary) summary.textContent = '조회 실패';
  }
}

async function projRegOutUpload() {
  const session = getSession();
  const row = _projRegOutCurrentRow();
  const typeEl = document.getElementById('proj-reg-out-type');
  const titleEl = document.getElementById('proj-reg-out-title');
  const noteEl = document.getElementById('proj-reg-out-note');
  const fileEl = document.getElementById('proj-reg-out-file');
  const btn = document.getElementById('proj-reg-out-upload-btn');
  if (!row || !row.project_code) return Toast.warning('저장된 프로젝트를 먼저 선택하세요.');
  if (!_projRegOutCanUpload(session, row)) return Toast.warning('산출물 업로드 권한이 없습니다.');
  const outputType = String(typeEl?.value || '').trim() || '결과보고서';
  const outputTitle = String(titleEl?.value || '').trim();
  const note = String(noteEl?.value || '').trim();
  const file = fileEl?.files?.[0];
  if (!outputTitle) return Toast.warning('결과물 제목을 입력해주세요.');
  if (!file) return Toast.warning('업로드할 파일을 선택해주세요.');
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
    const stem = _projRegSafePathSegment(String(file.name || '').replace(/\.[^.]*$/, ''));
    const uniq = Math.random().toString(36).slice(2, 8);
    const path = `project-outputs/${yyyy}/${mm}/${_projRegSafePathSegment(row.project_code)}/${now}_${uniq}_${stem}.${ext}`;
    const up = await API.storageUpload(_PROJ_REG_OUTPUT_BUCKET, path, file, { upsert: false });
    const payload = {
      project_id: String(row.id || ''),
      project_code: String(row.project_code || ''),
      project_name: String(row.project_name || ''),
      output_type: outputType,
      output_title: outputTitle,
      output_file_name: String(file.name || ''),
      output_file_url: String((up && up.publicUrl) || ''),
      uploaded_by: String(session.user_id || session.id || ''),
      uploaded_by_name: String(session.name || session.user_name || ''),
      uploaded_at: now,
      note,
    };
    const created = await API.create('project_outputs', payload);
    if (outputType === '통관팀유의사항') {
      await _projRegOutNotifyClearance(row, created, session);
    }
    if (outputType === '결과보고서') {
      try {
        const gate = await _projRegOutCheckClosureGate(row);
        if (gate.ok) {
          await API.patch('registered_projects', row.id, {
            work_closed_at: Number(row.work_closed_at || 0) || now,
            lifecycle_updated_at: now,
            lifecycle_updated_by: String(session.user_id || session.id || ''),
            lifecycle_updated_by_name: String(session.name || session.user_name || ''),
          });
        } else {
          Toast.warning(`결과보고서는 저장되었지만 업무종료 전환은 보류되었습니다. (${gate.reason})`);
        }
      } catch (gateErr) {
        Toast.warning(`결과보고서는 저장되었지만 업무종료 전환은 보류되었습니다. (${gateErr.message || '게이트 조건 확인 실패'})`);
      }
    }
    if (titleEl) titleEl.value = '';
    if (noteEl) noteEl.value = '';
    if (fileEl) fileEl.value = '';
    Toast.success('산출물이 저장되었습니다.');
    await projRegLoadList();
    _projRegOutRefreshContext(_projRegOutCurrentRow());
    await projRegOutLoadList();
  } catch (e) {
    console.error(e);
    Toast.error('산출물 업로드 실패: ' + (e.message || e));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = prevText || '<i class="fas fa-upload"></i> 업로드';
    }
  }
}

function _projRegRenderDetailTab() {
  const row = _projRegOutCurrentRow();
  const canOutputTab = false;
  _projRegDetailTab = 'ops';
  const ops = document.getElementById('proj-reg-detail-panel-ops');
  const out = document.getElementById('proj-reg-detail-panel-output');
  if (ops) ops.style.display = '';
  if (out) out.style.display = 'none';
  document.querySelectorAll('[data-proj-detail-tab]').forEach((btn) => {
    const tab = btn.getAttribute('data-proj-detail-tab');
    const on = tab === _projRegDetailTab;
    btn.classList.toggle('is-active', on);
    if (tab === 'output') btn.disabled = !canOutputTab;
  });
  _projRegOutRefreshContext(row);
}

function projRegSwitchDetailTab(tab) {
  _projRegDetailTab = 'ops';
  _projRegRenderDetailTab();
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
  _projRegPopulateProposalCodeTypeSelect();
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
    'proj-reg-bill-add-amt', 'proj-reg-bill-add-due',
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
  if (!sel || !nameEl) {
    projRegRefreshProgress();
    return;
  }
  if (!sel.value) {
    nameEl.readOnly = false;
    Promise.resolve(_projRegLoadContractRatePanel(_projRegOutCurrentRow())).catch(() => {});
    projRegRefreshProgress();
    return;
  }
  const opt = sel.selectedOptions[0];
  if (opt && opt.dataset.nameEn) {
    nameEl.value = String(opt.dataset.nameEn || '').trim();
  }
  nameEl.readOnly = true;
  Promise.resolve(_projRegLoadContractRatePanel(_projRegOutCurrentRow())).catch(() => {});
  projRegRefreshProgress();
}

function _projRegApplyTypeLockedName(typeId) {
  const sel = document.getElementById('proj-reg-code-type');
  const nameEl = document.getElementById('proj-reg-name');
  if (!sel || !nameEl) return '';
  const id = String(typeId || sel.value || '').trim();
  if (!id) {
    nameEl.readOnly = false;
    return '';
  }
  let opt = [...sel.options].find((o) => String(o.value || '') === id) || null;
  if (!opt && sel.value && String(sel.value) === id) opt = sel.selectedOptions?.[0] || null;
  const resolved = String(opt?.dataset?.nameEn || '').trim();
  if (resolved) {
    nameEl.value = resolved;
  }
  nameEl.readOnly = true;
  return resolved;
}

function _projRegTypeById(typeId) {
  if (!typeId) return null;
  return _projRegTypes.find((x) => String(x.id) === String(typeId)) || null;
}

function _projRegRowMainCode(r) {
  const t = _projRegTypeById(r && r.project_code_type_id);
  return t ? String(t.main_code || '').trim() : '';
}

function _projRegCreatorUser(row) {
  const creatorId = String((row && row.created_by) || '').trim();
  if (!creatorId) return null;
  return (_projRegUsers || []).find((u) => String(u.id || '').trim() === creatorId) || null;
}

function _projRegOrgLabel(row) {
  const u = _projRegCreatorUser(row);
  const dept = String((u && u.dept_name) || (row && row.dept_name) || '').trim();
  const hq = String((u && u.hq_name) || (row && row.hq_name) || '').trim();
  if (dept && hq) return `${dept} / ${hq}`;
  return dept || hq || '-';
}

function _projRegOrgParts(row) {
  const u = _projRegCreatorUser(row);
  const dept = String((u && u.dept_name) || (row && row.dept_name) || '').trim();
  const hq = String((u && u.hq_name) || (row && row.hq_name) || '').trim();
  return { dept, hq };
}

function _projRegNormalizeOrgFilter(v) {
  return String(v || '').replace(/\s*\/\s*/g, '/').trim();
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

function _projRegPopulateListFilterDropdowns() {
  const orgSel = document.getElementById('proj-reg-filter-org');
  if (orgSel) {
    const prev = orgSel.value;
    const orgSet = new Set();

    // 우선: 현재 화면에 실제 표시 가능한 행 기준으로 조직 옵션 구성
    // - 사업부 단독(예: CRB)
    // - 사업부/본부 조합(예: CRB / 수입통관업무본부)
    (_projRegRows || []).forEach((r) => {
      const parts = _projRegOrgParts(r);
      const dept = String(parts.dept || '').trim();
      const hq = String(parts.hq || '').trim();
      if (dept) orgSet.add(dept);
      if (dept && hq) orgSet.add(`${dept} / ${hq}`);
      else if (!dept && hq) orgSet.add(hq);
    });

    // 목록 데이터가 아직 없을 때만 사용자 기준으로 보조 구성
    if (!orgSet.size) {
      (_projRegUsers || [])
        .filter((u) => u.deleted !== true && u.is_active !== false)
        .forEach((u) => {
          const dept = String(u.dept_name || '').trim();
          const hq = String(u.hq_name || '').trim();
          if (dept) orgSet.add(dept);
          if (dept && hq) orgSet.add(`${dept} / ${hq}`);
          else if (!dept && hq) orgSet.add(hq);
        });
    }

    orgSel.innerHTML = '<option value="">사업부+본부 전체</option>';
    [...orgSet].sort((a, b) => a.localeCompare(b, 'ko')).forEach((label) => {
      const o = document.createElement('option');
      o.value = label;
      o.textContent = label;
      orgSel.appendChild(o);
    });
    if (prev && [...orgSel.options].some((o) => o.value === prev)) orgSel.value = prev;
  }
}

function _projRegBindListFiltersOnce() {
  if (_projRegListFiltersBound) return;
  const main = document.getElementById('proj-reg-filter-main');
  if (main) main.addEventListener('change', () => projRegRenderList());
  ['proj-reg-filter-org', 'proj-reg-filter-status'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => projRegRenderList());
  });
  ['proj-reg-filter-client'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => projRegRenderList());
  });
  _projRegListFiltersBound = true;
}

function projRegResetListFilters() {
  [
    'proj-reg-filter-main',
    'proj-reg-filter-org',
    'proj-reg-filter-client',
    'proj-reg-filter-status',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  projRegRenderList();
}

function _projRegApplyListFilters(rowsIn) {
  const mainMc = (document.getElementById('proj-reg-filter-main')?.value || '').trim();
  const orgFilter = (document.getElementById('proj-reg-filter-org')?.value || '').trim();
  const clientKw = (document.getElementById('proj-reg-filter-client')?.value || '').trim().toLowerCase();
  const stF = (document.getElementById('proj-reg-filter-status')?.value || '').trim().toLowerCase();

  return rowsIn.filter((r) => {
    const st = _projRegNormStatus(r);
    if (mainMc && _projRegRowMainCode(r) !== mainMc) return false;
    if (orgFilter) {
      const { dept, hq } = _projRegOrgParts(r);
      const picked = _projRegNormalizeOrgFilter(orgFilter);
      // 사업부만 선택하면 해당 사업부 전체(본부 무관) 포함
      if (!picked.includes('/')) {
        if (!dept || dept !== picked) return false;
      } else {
        const rowOrg = _projRegNormalizeOrgFilter(dept && hq ? `${dept}/${hq}` : (dept || hq || ''));
        if (rowOrg !== picked) return false;
      }
    }
    if (clientKw) {
      const cb = [r.client_name, r.client_id].map((x) => String(x || '').toLowerCase()).join(' ');
      if (!cb.includes(clientKw)) return false;
    }
    if (stF) {
      if (stF === 'conditional') {
        if (!(st === 'approved' && r.conditional_approval === true)) return false;
      } else if (stF === 'approved') {
        if (!(st === 'approved' && r.conditional_approval !== true)) return false;
      } else if (st !== stF) {
        return false;
      }
    }
    return true;
  });
}

async function projRegLoadList() {
  const tbody = document.getElementById('proj-reg-list-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="table-empty"><i class="fas fa-spinner fa-spin"></i><p>불러오는 중…</p></td></tr>';
  const session = getSession();
  try {
    const allRows = await API.listAllPages('registered_projects', { limit: 500, maxPages: 10, sort: 'created_at' });
    _projRegRows = await _projRegScopeRowsForSession(allRows, session);
  } catch (e) {
    _projRegRows = [];
    Toast.error('목록 조회 실패: ' + (e.message || '') + ' — SQL 스키마를 적용했는지 확인하세요.');
  }
  _projRegPopulateListFilterDropdowns();
  projRegRenderList();
}

async function _projRegScopeRowsForSession(rows, session) {
  const src = Array.isArray(rows) ? rows : [];
  if (!session || !session.id) return [];
  if (Auth.isAdmin(session)) return src;

  // 프로젝트 등록건 출력조건
  // 1) 내가 등록한 건
  // 2) 내가 승인자로 지정된 건(reg_pa1/2/3)
  // 3) 내가 총괄 PM으로 지정된 건(cpm_user_id)
  const myIds = new Set([
    String(session.id || '').trim(),
    String(session.user_id || '').trim(),
  ].filter(Boolean));
  const myName = String(session.name || '').trim();
  const norm = (v) => String(v || '').toLowerCase().replace(/\s+/g, '').trim();
  const normLoose = (v) => {
    let s = String(v || '').toLowerCase();
    s = s.replace(/\([^)]*\)/g, ''); // 괄호 직급/비고 제거
    s = s.replace(/[^0-9a-z가-힣]/g, ''); // 특수문자 제거
    s = s.replace(/(staff|manager|director|topmgr|top_mgr|cpm)$/g, ''); // 영문 직책 꼬리 제거
    s = s.replace(/(사원|대리|과장|차장|부장|팀장|실장|본부장|사업부장|이사|상무|전무|부사장|사장)$/g, ''); // 한글 직책 꼬리 제거
    return s.trim();
  };
  const isLooseNameMatch = (a, b) => {
    const x = normLoose(a);
    const y = normLoose(b);
    if (!x || !y) return false;
    if (x === y) return true;
    // 부분 일치 허용(3글자 이상) — 과매칭 방지
    if (x.length >= 3 && y.includes(x)) return true;
    if (y.length >= 3 && x.includes(y)) return true;
    return false;
  };

  let users = _projRegUsers;
  if (!Array.isArray(users) || !users.length) {
    try {
      users = await Master.users();
      _projRegUsers = users;
    } catch (_) {
      users = [];
    }
  }
  const scopedUserNames = new Set(
    (users || [])
      .filter((u) => u && Auth.scopeMatch(session, u))
      .map((u) => normLoose(u.name || ''))
      .filter(Boolean)
  );
  const scopedUserNameList = [...scopedUserNames];

  return src.filter((r) => {
    if (!r) return false;
    const creatorId = String(r.created_by || '').trim();
    const cpmId = String(r.cpm_user_id || '').trim();
    const pa1 = String(r.reg_pa1_id || '').trim();
    const pa2 = String(r.reg_pa2_id || '').trim();
    const pa3 = String(r.reg_pa3_id || '').trim();
    if (creatorId && myIds.has(creatorId)) return true;
    if (cpmId && myIds.has(cpmId)) return true;
    if ((pa1 && myIds.has(pa1)) || (pa2 && myIds.has(pa2)) || (pa3 && myIds.has(pa3))) return true;
    // 과거 데이터에서 승인자 ID가 바뀐 경우를 위한 이름 폴백
    if (myName) {
      if (isLooseNameMatch(r.reg_pa1_name || '', myName)) return true;
      if (isLooseNameMatch(r.reg_pa2_name || '', myName)) return true;
      if (isLooseNameMatch(r.reg_pa3_name || '', myName)) return true;
    }
    // 4) 자기 소속직원이 투입된 프로젝트(프로젝트 상세 투입인력 기준)
    if (scopedUserNames.size > 0) {
      const contribRows = _projRegContribParse(String(r.order_contributors_text || ''));
      for (const c of contribRows) {
        const nm = normLoose(c && c.name);
        if (!nm) continue;
        if (scopedUserNames.has(nm)) return true;
        if (scopedUserNameList.some((s) => isLooseNameMatch(nm, s))) return true;
      }
    }
    return false;
  });
}

function projRegRenderList() {
  const tbody = document.getElementById('proj-reg-list-body');
  if (!tbody) return;
  let rows = _projRegApplyListFilters(_projRegRows.slice());
  // 정렬: 승인대기 -> 1차 -> 2차(각 과거 우선) -> 최종승인(최신 우선)
  rows.sort(_projRegListComparator);
  if (!rows.length) {
    const emptyMsg = !_projRegRows.length
      ? '등록된 프로젝트가 없습니다.'
      : '조건에 맞는 프로젝트가 없습니다.';
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty"><i class="fas fa-clipboard-list"></i><p>${Utils.escHtml(emptyMsg)}</p></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r, i) => {
    const cd = r.created_at ? Utils.formatDate(r.created_at) : '-';
    const st = _projRegNormStatus(r);
    const codeDisp = (r.project_code && String(r.project_code).trim()) ? String(r.project_code) : '';
    const orgLabel = _projRegOrgLabel(r);
    const registrant = String(r.created_by_name || r.created_by || '-');
    return `<tr class="proj-reg-clickable-row" onclick="projRegShowForm('${r.id}')" title="클릭하여 상세 보기">
      <td class="text-center">${i + 1}</td>
      <td class="text-center" title="${Utils.escHtml(registrant)}">${Utils.escHtml(registrant)}</td>
      <td class="text-center" style="font-size:12px">${Utils.escHtml(cd)}</td>
      <td title="${Utils.escHtml(orgLabel)}">${Utils.escHtml(orgLabel)}</td>
      <td class="proj-reg-client-cell" title="${Utils.escHtml(r.client_name || '')}">${Utils.escHtml(r.client_name || '')}</td>
      <td class="proj-reg-code-cell">${codeDisp ? `<strong>${Utils.escHtml(codeDisp)}</strong>` : '<span class="proj-reg-code-empty">코드생성전</span>'}</td>
      <td class="proj-reg-name-cell" title="${Utils.escHtml(r.project_name || '')}">${Utils.escHtml(r.project_name || '')}</td>
      <td class="text-center"><span class="${_projRegStatusBadgeClass(st, r)}">${Utils.escHtml(_projRegStatusLabel(st, r))}</span></td>
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
    ['proj-reg-bill-add-amt', 'proj-reg-bill-add-due'],
    ['proj-reg-bill-success-amt', 'proj-reg-bill-success-due', 'proj-reg-bill-success-note'],
  ];
  ids.forEach((row) => {
    row.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  });
  const tcEl = document.getElementById('proj-reg-timecharge-enabled-input');
  if (tcEl) tcEl.checked = false;
  projRegToggleTimeChargeRatePanel();
}

function _projRegFillBilling(bs) {
  _projRegClearBilling();
  let data = bs;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (_) {
      data = null;
    }
  }
  if (!data || typeof data !== 'object') return;
  const tcEl = document.getElementById('proj-reg-timecharge-enabled-input');
  if (tcEl) tcEl.checked = data.timecharge_enabled === true;
  projRegToggleTimeChargeRatePanel();
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
    ['additional', 'proj-reg-bill-add-amt', 'proj-reg-bill-add-due'],
    ['success', 'proj-reg-bill-success-amt', 'proj-reg-bill-success-due', 'proj-reg-bill-success-note'],
  ];
  map.forEach((row) => {
    const key = row[0];
    const aid = row[1];
    const did = row[2];
    const nid = row[3];
    const b = data[key];
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
    timecharge_enabled: _projRegIsTimeChargeEnabled(),
    down: { amount: _projRegAmtValue('proj-reg-bill-down-amt'), due_date: dte('proj-reg-bill-down-due') },
    interim: { amount: _projRegAmtValue('proj-reg-bill-interim-amt'), due_date: dte('proj-reg-bill-interim-due') },
    final: { amount: _projRegAmtValue('proj-reg-bill-final-amt'), due_date: dte('proj-reg-bill-final-due') },
    additional: {
      amount: _projRegAmtValue('proj-reg-bill-add-amt'),
      due_date: dte('proj-reg-bill-add-due'),
    },
    success: {
      amount: _projRegAmtValue('proj-reg-bill-success-amt'),
      due_date: dte('proj-reg-bill-success-due'),
      terms_note: _projRegNoteVal('proj-reg-bill-success-note'),
    },
  };
}

function _projRegBillingHasAnyAmount(billing) {
  if (!billing || typeof billing !== 'object') return false;
  const keys = ['down', 'interim', 'final', 'additional', 'success'];
  const hasPositiveAmount = keys.some((k) => {
    const n = Number(billing?.[k]?.amount || 0);
    return Number.isFinite(n) && n > 0;
  });
  if (hasPositiveAmount) return true;
  // 성공보수는 금액이 0이어도 조건 문구(예: "00금액의 0%")가 있으면 유효로 본다.
  const successTerms = String(billing?.success?.terms_note || '').trim();
  return successTerms.length > 0;
}

async function projRegShowForm(editId, opts) {
  _projRegOpenedFromApprovalDetail = !!(opts && opts.fromApproval);
  const session = getSession();
  _projRegContractView = 'form';
  _projRegWorkflowTab = 'contract';
  _projRegRenderWorkflowTab();

  document.getElementById('proj-reg-edit-id').value = editId || '';
  const rowStatusEl = document.getElementById('proj-reg-row-status');
  if (rowStatusEl) rowStatusEl.value = editId ? '' : 'draft';

  const titleEl = document.getElementById('proj-reg-form-title');
  if (titleEl) titleEl.textContent = editId ? '프로젝트 수정' : 'Create Project';
  _projRegDetailTab = 'ops';

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

  const nameInput = document.getElementById('proj-reg-name');
  if (nameInput) {
    nameInput.value = '';
    nameInput.readOnly = false;
  }
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

    if (nameInput) nameInput.value = row.project_name || '';
    document.getElementById('proj-reg-client').value = row.client_id || '';
    if (cSearch) cSearch.value = row.client_name || '';
    document.getElementById('proj-reg-order-owner').value = row.order_owner_text || '';
    projRegSetContributorsFromStored(row.order_contributors_text || '');
    projRegApplyRouteFromStored(row.acquisition_route || '', row.acquisition_route_detail || '');
    if (row.period_start) document.getElementById('proj-reg-period-start').value = String(row.period_start).slice(0, 10);
    if (row.period_end) document.getElementById('proj-reg-period-end').value = String(row.period_end).slice(0, 10);
    _projRegFillBilling(row.billing_schedule);
    projRegSyncContractExisting(row);
    projRegSyncEvidenceExisting(row);
    projRegSyncRouteEvidenceExisting(row);
    if (exReasonEl) exReasonEl.value = row.contract_exception_reason || '';

    if (st === 'draft' && yymmEl && !yymmEl.value) _projRegSetDefaultMonth();
    _projRegApplyTypeLockedName(typeSel?.value || row.project_code_type_id || '');
  } else {
    if (typeSel) typeSel.disabled = false;
    if (yymmEl) {
      yymmEl.disabled = false;
      _projRegSetDefaultMonth();
    }
    if (codeWrap) codeWrap.style.display = 'none';
    if (codeRo) codeRo.value = '';
    projRegSetContributorsFromStored('');
    _projRegApplyTypeLockedName(typeSel?.value || '');
  }

  projRegToggleTimeChargeRatePanel();
  await _projRegLoadContractRatePanel(row);

  projRegBindProgress();
  _projRegResetAsidePanel();
  projRegRefreshProgress();
  projRegUpdateFormFooter(session, editId || '', row);
  _projRegRenderDetailTab();
}

function _projRegReadFormCore(session) {
  const rawName = document.getElementById('proj-reg-name').value.trim();
  const clientId = document.getElementById('proj-reg-client').value.trim();
  const typeId = document.getElementById('proj-reg-code-type').value;
  const typeSel = document.getElementById('proj-reg-code-type');
  const lockedName = (() => {
    const opt = typeSel?.selectedOptions?.[0];
    return String(opt?.dataset?.nameEn || '').trim();
  })();
  const name = lockedName || rawName;
  if (lockedName && rawName !== lockedName) {
    const nameEl = document.getElementById('proj-reg-name');
    if (nameEl) nameEl.value = lockedName;
  }
  const monthVal = document.getElementById('proj-reg-yymm').value;
  const yymm = _projRegMonthToYymm(monthVal);
  const hit = _projRegClients.find((c) => String(c.id) === String(clientId));
  let clientName = hit ? String(hit.company_name || '') : '';
  if (!clientName) clientName = document.getElementById('proj-reg-client-search').value.trim();
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
    rawName,
    lockedTypeName: lockedName,
    clientId,
    clientName,
    typeId,
    monthVal,
    yymm,
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

async function projRegSaveDraft(opts = {}) {
  const silentSuccess = !!opts.silentSuccess;
  const skipRatePersist = !!opts.skipRatePersist;
  const session = getSession();
  if (!Auth.canManageProjectRegister(session)) {
    Toast.warning('권한이 없습니다.');
    return false;
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
        return false;
      }
      const st = _projRegNormStatus(prev);
      if (st === 'pending' && !canEditFromApproval) {
        Toast.warning('승인 대기 중에는 수정할 수 없습니다.');
        return false;
      }
      if (st === 'approved') {
        Toast.warning('승인 완료 건은 하단 「저장」으로 수정하세요.');
        return false;
      }
      await _projRegApplyContractToPayload(basePayload, f.file, f.removeContractMeta, prev);
      await _projRegApplyEvidenceToPayload(basePayload, f.evidenceFile, f.removeEvidenceMeta, prev);
      await _projRegApplyRouteEvidenceToPayload(basePayload, f.routeEvidenceFile, f.removeRouteEvidenceMeta, prev);
      basePayload.contract_exception_reason = f.contractExceptionReason || '';
      await API.patch('registered_projects', editId, basePayload);
      if (!skipRatePersist) {
        await _projRegPersistProjectContractRates(String((prev && prev.project_code) || ''), editId, session);
      }
      if (!silentSuccess) Toast.success('임시저장되었습니다.');
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
        if (!skipRatePersist) {
          await _projRegPersistProjectContractRates(String((row && row.project_code) || ''), row.id, session);
        }
      }
      if (!silentSuccess) Toast.success('임시저장되었습니다.');
    }
    await projRegLoadList();
    const eid = document.getElementById('proj-reg-edit-id').value;
    if (eid) projRegUpdateFormFooter(session, eid, _projRegRows.find((x) => x.id === eid));
    projRegRefreshProgress();
    return true;
  } catch (e) {
    Toast.error('임시저장 실패: ' + (e.message || e));
    return false;
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
  if (f.typeId && !f.lockedTypeName) {
    Toast.warning('선택한 코드유형에 프로젝트명이 설정되어 있지 않습니다. 프로젝트 코드 마스터에서 프로젝트명(EN)을 설정하세요.');
    return;
  }
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
  if (!_projRegBillingHasAnyAmount(f.billing)) {
    Toast.warning('보수조건 금액(착수금/중도금/잔금/Time Charge/성공보수) 또는 성공보수 조건 문구를 입력하세요.');
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
  const myRole = _projRegNormRole(session.role || '');
  const isStaffRegistrant = myRole === 'staff';
  const isManagerRegistrant = myRole === 'manager';
  const isDirectorRegistrant = myRole === 'director';
  // 요청 정책에 맞게 staff/manager/director 자동승인은 허용하지 않음
  const autoApprove = (!isStaffRegistrant && !isManagerRegistrant && !isDirectorRegistrant)
    && !has1 && !has2 && !has3;

  // 역할별 승인자 구성 검증
  if (isStaffRegistrant && (!has1 || !has2 || !has3)) {
    Toast.warning('승인 요청할 수 없습니다. 담당(전임/선임/책임)은 1차/2차 승인자와 사업부장 최종 승인자가 모두 지정되어야 합니다.');
    return;
  }
  if (isManagerRegistrant && (!has1 || !has3)) {
    Toast.warning('승인 요청할 수 없습니다. 팀장은 본부장 1차 승인자와 사업부장 최종 승인자가 모두 지정되어야 합니다.');
    return;
  }
  if (isDirectorRegistrant && _projRegIsCcbRegistrant(session, session) && ((!has1 && !has2) || !has3)) {
    Toast.warning('승인 요청할 수 없습니다. CCB 본부장은 사용자등록 승인자(1차/2차 중 1개 이상)와 사업부장 최종 승인자가 지정되어야 합니다.');
    return;
  }
  if (isDirectorRegistrant && !_projRegIsCcbRegistrant(session, session) && !has1) {
    Toast.warning('승인 요청할 수 없습니다. 본부장은 사업부장 최종 승인자가 지정되어야 합니다.');
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
    await _projRegPersistProposalFinalRates(projectCode);
    await _projRegPersistProjectContractRates(projectCode, savedId || editId || '', session);
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
  if (f.typeId && !f.lockedTypeName) {
    Toast.warning('선택한 코드유형에 프로젝트명이 설정되어 있지 않습니다. 프로젝트 코드 마스터에서 프로젝트명(EN)을 설정하세요.');
    return;
  }
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
    await _projRegPersistProjectContractRates(String(prev.project_code || ''), editId, session);
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
    // 승인자 ID가 과거 데이터와 불일치하는 경우(이름 일치 승인), 현재 세션 ID로 보정
    const myId = String(session?.id || session?.user_id || '').trim();
    const myName = String(session?.name || '').trim();
    if (myId && myName) {
      const heal = {};
      if (step === 1 && String(row.reg_pa1_name || '').trim() === myName && String(row.reg_pa1_id || '').trim() !== myId) {
        heal.reg_pa1_id = myId;
      }
      if (step === 2 && eff.count >= 3 && String(row.reg_pa2_name || '').trim() === myName && String(row.reg_pa2_id || '').trim() !== myId) {
        heal.reg_pa2_id = myId;
      }
      if ((step === 3 || (step === 2 && eff.count < 3)) && String(row.reg_pa3_name || '').trim() === myName && String(row.reg_pa3_id || '').trim() !== myId) {
        heal.reg_pa3_id = myId;
      }
      if (Object.keys(heal).length) {
        await API.patch('registered_projects', id, {
          ...heal,
          updated_by: String(session.id || ''),
          updated_by_name: session.name || '',
        });
        Object.assign(row, heal);
      }
    }
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
      await _projRegNotifyFinanceTeamOnFinalApproved({ row, fromSession: session });
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
      await _projRegNotifyFinanceTeamOnFinalApproved({ row, fromSession: session });
      Toast.success(isConditional ? '조건부 승인 완료되었습니다.' : '승인 완료되었습니다.');
    }
    await projRegLoadList();
    if (typeof window.loadApprovalProjectList === 'function') {
      try {
        await window.loadApprovalProjectList();
      } catch (_) {}
    }
    if (typeof updateApprovalBadge === 'function') {
      try {
        await updateApprovalBadge(session, true);
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
    if (typeof updateApprovalBadge === 'function') {
      try {
        await updateApprovalBadge(session, true);
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
window.projRegSwitchWorkflowTab = projRegSwitchWorkflowTab;
window.projRegSwitchDetailTab = projRegSwitchDetailTab;
window.projRegGenerateProposalTempCode = projRegGenerateProposalTempCode;
window.projRegResetProposalForm = projRegResetProposalForm;
window.projRegRunProposalSimulation = projRegRunProposalSimulation;
window.projRegApplyProposalToContract = projRegApplyProposalToContract;
window.projRegExportProposalData = projRegExportProposalData;
window.projRegLoadCodeSettingRates = projRegLoadCodeSettingRates;
window.projRegSaveContractRates = projRegSaveContractRates;
window.projRegOutUpload = projRegOutUpload;
window.projRegOutLoadList = projRegOutLoadList;

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
