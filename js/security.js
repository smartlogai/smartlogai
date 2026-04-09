/* ============================================================
   Smart Log AI — 보안 모듈 (security.js)
   정보유출 방지를 위한 클라이언트 보안 대책 전체 적용
   ============================================================

   [적용 대책 목록]
   1. 우클릭 컨텍스트 메뉴 차단
   2. 텍스트 드래그 선택 제한 (허용 영역 제외)
   3. 클립보드 복사/잘라내기/붙여넣기 이벤트 감시 & 로그
   4. 키보드 단축키 차단 (F12, Ctrl+S, Ctrl+A, Ctrl+P, Ctrl+U, PrintScreen 등)
   5. 개발자 도구(DevTools) 단축키 차단 (F12 / Ctrl+Shift+I·J·C) — 크기감지·debugger 오탐 제거
   6. 사용자별 동적 워터마크 (이름 + 날짜 + 접속 IP 오버레이)
   7. 화면 캡처 방지 힌트 (CSS -webkit-user-select + meta referrer)
   8. 비활성 자동 로그아웃 (30분 무활동)
   9. 탭/창 가시성 변경 감지 (비활성 전환 로그)
  10. 세션 무결성 검사 (주기적 재확인)
  11. 페이지 소스보기 단축키 차단
  12. 인쇄 차단 (Ctrl+P / window.print 재정의)
  ============================================================ */

(function () {
  'use strict';

  // ── 설정값 ──
  const CFG = {
    IDLE_TIMEOUT_MS:   30 * 60 * 1000,  // 30분 무활동 → 자동 로그아웃
    WATERMARK_OPACITY: 0.028,            // 워터마크 투명도 (낮을수록 연하게)
    SESSION_KEY:       'wt_session',
    ALLOW_COPY_SELECTORS: [              // 복사 허용 CSS 셀렉터 (업무상 필요한 영역)
      '.arch-text-box',
      '.arch-summary-text',
      '#arch-body-text',
      '.arch-desc-view',                // 자료실/승인모달 수행내용(조회 박스)
      '#approval-desc-view',            // 승인모달 수행내용(조회 박스) 명시
      '.ql-editor',                     // Quill 에디터 본문(수정 화면)
      '.rich-edit-surface',             // 표 포함 contenteditable 편집 영역(수정 화면)
      '[data-allow-copy="true"]',
    ],
  };

  /* ──────────────────────────────────────────
     0. 초기화: 세션 확인
  ────────────────────────────────────────── */
  function _getSession() {
    try {
      const raw = localStorage.getItem(CFG.SESSION_KEY) || sessionStorage.getItem(CFG.SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function _forceLogout(reason) {
    console.warn('[Security] 강제 로그아웃:', reason);
    localStorage.removeItem(CFG.SESSION_KEY);
    sessionStorage.removeItem(CFG.SESSION_KEY);
    // 보안 경고 후 로그인 페이지 이동
    try {
      _showSecurityAlert(reason, () => { window.location.replace('index.html'); });
    } catch {
      window.location.replace('index.html');
    }
  }

  /* ──────────────────────────────────────────
     1. 우클릭 컨텍스트 메뉴 차단
  ────────────────────────────────────────── */
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    e.stopPropagation();
    _secLog('우클릭 시도 차단', { x: e.clientX, y: e.clientY });
    return false;
  }, true);

  /* ──────────────────────────────────────────
     2. 텍스트 선택 제한 (허용 영역 제외)
  ────────────────────────────────────────── */
  document.addEventListener('selectstart', function (e) {
    if (_isAllowedCopyTarget(e.target)) return true;
    // 입력 필드는 허용
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return true;
    e.preventDefault();
    return false;
  }, true);

  // 드래그 방지
  document.addEventListener('dragstart', function (e) {
    if (e.target.tagName === 'IMG' || e.target.tagName === 'A') {
      e.preventDefault();
      _secLog('드래그 시도 차단');
    }
  }, true);

  /* ──────────────────────────────────────────
     3. 클립보드 이벤트 감시 & 허용 영역 외 차단
  ────────────────────────────────────────── */
  document.addEventListener('copy', function (e) {
    if (_isAllowedCopyTarget(document.activeElement) ||
        _isAllowedCopyTarget(e.target)) {
      _secLog('복사 허용 영역에서 복사', { target: e.target?.className });
      return true; // 허용
    }
    const sel = window.getSelection()?.toString() || '';
    if (sel.length > 0) {
      _secLog('비허용 영역 복사 시도', { length: sel.length });
      e.preventDefault();
      _showSecurityToast('이 영역의 내용은 복사할 수 없습니다.');
      return false;
    }
  }, true);

  document.addEventListener('cut', function (e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    e.preventDefault();
    _secLog('잘라내기 시도 차단');
    return false;
  }, true);

  /* ──────────────────────────────────────────
     4. 키보드 단축키 차단
  ────────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const key  = e.key?.toLowerCase();

    // F5 / Ctrl+R (새로고침) — 명시적으로 허용 (차단하지 않음)
    if (e.key === 'F5' || (ctrl && key === 'r')) {
      return true;
    }

    // F12 (개발자 도구)
    if (e.key === 'F12') {
      e.preventDefault();
      _secLog('F12 차단');
      return false;
    }

    // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C (개발자 도구)
    if (ctrl && e.shiftKey && ['i', 'j', 'c'].includes(key)) {
      e.preventDefault();
      _secLog('DevTools 단축키 차단', { key: e.key });
      return false;
    }

    // Ctrl+U (소스 보기)
    if (ctrl && key === 'u') {
      e.preventDefault();
      _secLog('소스 보기 차단');
      return false;
    }

    // Ctrl+S (다른 이름으로 저장)
    if (ctrl && key === 's') {
      e.preventDefault();
      _secLog('저장 단축키 차단');
      return false;
    }

    // Ctrl+P (인쇄)
    if (ctrl && key === 'p') {
      e.preventDefault();
      _secLog('인쇄 단축키 차단');
      _showSecurityToast('인쇄 기능은 비활성화되어 있습니다.');
      return false;
    }

    // PrintScreen
    if (e.key === 'PrintScreen') {
      // 클립보드 덮어쓰기 (내용 무효화)
      navigator.clipboard?.writeText('').catch(() => {});
      _secLog('PrintScreen 시도 감지');
      _showSecurityToast('화면 캡처가 감지되었습니다.');
      return false;
    }

    // Ctrl+A (전체 선택) — 허용 영역 외 차단
    if (ctrl && key === 'a') {
      const active = document.activeElement;
      if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return true;
      if (_isAllowedCopyTarget(active)) return true;
      e.preventDefault();
      return false;
    }

  }, true);

  /* ──────────────────────────────────────────
     5. 개발자 도구(DevTools) 감지
     ※ window 크기 차이 감지 및 debugger 지연 감지 방식은
       브라우저 확장 프로그램·고DPI·CPU 부하 등 환경에 따라
       오탐(false positive)이 빈번하여 완전히 제거하였습니다.
       F12 / Ctrl+Shift+I·J·C 단축키 차단(4번 항목)은 유지됩니다.
  ────────────────────────────────────────── */
  // (DevTools 오탐 방지를 위해 크기 비교 및 debugger 트릭 감지 비활성화)

  /* ──────────────────────────────────────────
     6. 동적 워터마크 (사용자 이름 + 날짜 + 시간)
  ────────────────────────────────────────── */
  function _applyWatermark() {
    const existing = document.getElementById('_security_watermark_');
    if (existing) existing.remove();

    const session = _getSession();
    const name    = session?.name || '미인증';
    const role    = session?.role || '';
    const now     = new Date();
    const dateStr = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')}`;
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const label   = `${name}  ${dateStr} ${timeStr}`;

    // Canvas로 반복 타일 패턴 생성 (타일 크기 키워 밀도 낮춤)
    const canvas  = document.createElement('canvas');
    canvas.width  = 480;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-25 * Math.PI / 180);
    ctx.font        = '500 13px "Noto Sans KR", sans-serif';
    ctx.fillStyle   = `rgba(30, 60, 120, ${CFG.WATERMARK_OPACITY})`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
    ctx.font        = '400 10px "Noto Sans KR", sans-serif';
    ctx.fillStyle   = `rgba(30, 60, 120, ${CFG.WATERMARK_OPACITY * 0.7})`;
    ctx.fillText('CONFIDENTIAL · SMART LOG AI', 0, 18);
    ctx.restore();

    const dataUrl = canvas.toDataURL('image/png');

    const wm = document.createElement('div');
    wm.id = '_security_watermark_';
    wm.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      /* 본문·뱃지 위에 올라가 글자가 겹쳐 보이는 문제 방지: UI는 .main-content 등이 더 위 스택 */
      'z-index:0',
      `background-image:url(${dataUrl})`,
      'background-repeat:repeat',
      'background-size:480px 240px',
      'user-select:none',
      '-webkit-user-select:none',
      'opacity:1',
    ].join(';');
    document.body.appendChild(wm);
  }

  // DOM 준비 후 워터마크 적용
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _applyWatermark);
  } else {
    _applyWatermark();
  }
  // 매 분 갱신 (시간 업데이트)
  setInterval(_applyWatermark, 60 * 1000);

  /* ──────────────────────────────────────────
     7. 인쇄 차단
  ────────────────────────────────────────── */
  const _origPrint = window.print;
  window.print = function () {
    _secLog('window.print() 호출 차단');
    _showSecurityToast('인쇄 기능은 비활성화되어 있습니다.');
  };

  window.addEventListener('beforeprint', function (e) {
    _secLog('인쇄 시도 차단 (beforeprint)');
    // 인쇄 내용을 빈 것으로 교체하는 CSS 추가
    let style = document.getElementById('_no_print_style_');
    if (!style) {
      style = document.createElement('style');
      style.id = '_no_print_style_';
      style.textContent = `@media print { body { display:none !important; } }`;
      document.head.appendChild(style);
    }
  });

  /* ──────────────────────────────────────────
     8. 비활성 자동 로그아웃 (30분)
  ────────────────────────────────────────── */
  let _idleTimer = null;
  let _idleWarningShown = false;

  function _resetIdleTimer() {
    clearTimeout(_idleTimer);
    _idleWarningShown = false;
    const warningAt = document.getElementById('_idle_warning_overlay_');
    if (warningAt) warningAt.remove();

    _idleTimer = setTimeout(() => {
      // 25분 시점: 경고 표시
      _showIdleWarning();
      _idleTimer = setTimeout(() => {
        _forceLogout('30분간 활동이 없어 자동 로그아웃 처리되었습니다.');
      }, 5 * 60 * 1000); // 경고 후 5분 뒤 로그아웃
    }, CFG.IDLE_TIMEOUT_MS - 5 * 60 * 1000);
  }

  function _showIdleWarning() {
    if (_idleWarningShown) return;
    _idleWarningShown = true;

    const ov = document.createElement('div');
    ov.id = '_idle_warning_overlay_';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center';
    ov.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:32px 36px;text-align:center;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.4)">
        <div style="font-size:48px;margin-bottom:12px">⏰</div>
        <h3 style="margin:0 0 10px;color:#1a2b45;font-size:18px">자동 로그아웃 안내</h3>
        <p style="color:#64748b;font-size:14px;margin:0 0 20px;line-height:1.6">
          5분간 추가 활동이 없으면<br>보안상 자동 로그아웃됩니다.
        </p>
        <button onclick="document.getElementById('_idle_warning_overlay_').remove(); _SecurityModule.resetIdle();"
          style="background:#1a2b45;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:14px;cursor:pointer;font-weight:600">
          계속 사용하기
        </button>
      </div>`;
    document.body.appendChild(ov);
  }

  // 활동 감지 이벤트
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(evt => {
    document.addEventListener(evt, _resetIdleTimer, { passive: true });
  });
  _resetIdleTimer(); // 초기화

  /* ──────────────────────────────────────────
     9. 탭/창 가시성 변경 감지
  ────────────────────────────────────────── */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      _secLog('탭 비활성화 (백그라운드 전환)');
    } else {
      // 탭 복귀 시 세션 재확인
      const session = _getSession();
      if (!session && !window.location.pathname.includes('index')) {
        window.location.replace('index.html');
      }
    }
  });

  /* ──────────────────────────────────────────
    10. 세션 무결성 주기 검사 (5분마다)
  ────────────────────────────────────────── */
  setInterval(function () {
    if (window.location.pathname.includes('index')) return;
    const session = _getSession();
    if (!session) {
      _forceLogout('세션이 만료되었습니다.');
      return;
    }
    // 세션 TTL 재확인 (8시간)
    const TTL = 8 * 60 * 60 * 1000;
    if (session.loggedInAt && Date.now() - session.loggedInAt > TTL) {
      _forceLogout('세션 유효 시간이 만료되었습니다. 다시 로그인하세요.');
    }
  }, 5 * 60 * 1000);

  /* ──────────────────────────────────────────
    11. CSS 보안 강화 (동적 주입)
  ────────────────────────────────────────── */
  const secStyle = document.createElement('style');
  secStyle.id = '_security_styles_';
  secStyle.textContent = `
    /* 기본 텍스트 선택 방지 */
    body {
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
    }
    /* 허용 영역: 입력 필드, 텍스트 박스 */
    input, textarea, [contenteditable="true"],
    .arch-text-box,
    .arch-summary-text,
    .arch-desc-view,
    #approval-desc-view,
    [data-allow-copy="true"] {
      -webkit-user-select: text !important;
      -moz-user-select: text !important;
      user-select: text !important;
    }
    /* 이미지 드래그 방지 */
    img {
      -webkit-user-drag: none;
      user-drag: none;
      pointer-events: none;
    }
    /* 링크 드래그 방지 */
    a {
      -webkit-user-drag: none;
    }
    /* 인쇄 시 전체 숨김 */
    @media print {
      body { display: none !important; }
    }
  `;
  document.head.appendChild(secStyle);

  /* ──────────────────────────────────────────
     헬퍼 함수들
  ────────────────────────────────────────── */

  // 복사 허용 영역인지 확인
  function _isAllowedCopyTarget(el) {
    if (!el) return false;
    for (const sel of CFG.ALLOW_COPY_SELECTORS) {
      if (el.matches?.(sel) || el.closest?.(sel)) return true;
    }
    return false;
  }

  // 보안 이벤트 로그 (sessionStorage 저장 + API 비동기 전송)
  function _secLog(action, detail = {}) {
    const session = _getSession();
    const entry = {
      ts:       new Date().toISOString(),
      user_id:  session?.id   || 'unknown',
      user:     session?.name || 'unknown',
      role:     session?.role || 'unknown',
      action,
      page:     window.location.pathname.split('/').pop() || 'unknown',
      ua:       navigator.userAgent.slice(0, 120),
      ...detail,
    };
    // 콘솔에는 출력하지 않음 (보안)
    try {
      const logs = JSON.parse(sessionStorage.getItem('_sec_logs_') || '[]');
      logs.push(entry);
      if (logs.length > 100) logs.shift(); // 최대 100개 유지
      sessionStorage.setItem('_sec_logs_', JSON.stringify(logs));
    } catch { /* ignore */ }
    // 실제 보안 위반 행위만 API로 서버 전송 (비동기)
    const HIGH_RISK_ACTIONS = ['DevTools 감지', 'PrintScreen 시도', '비허용 영역 복사 시도', '강제 로그아웃'];
    if (HIGH_RISK_ACTIONS.some(h => action.includes(h))) {
      _sendSecLogToServer(entry);
    }
  }

  // 보안 로그 서버 전송 (fire-and-forget) — Supabase REST API 직접 호출
  function _sendSecLogToServer(entry) {
    try {
      const SUPA_URL = window.__SMARTLOG_SB_URL__ || '';
      const SUPA_KEY = window.__SMARTLOG_SB_KEY__ || '';
      if (!SUPA_URL || !SUPA_KEY) return;
      const payload = { ...entry, created_at: Date.now(), updated_at: Date.now() };
      fetch(`${SUPA_URL}/rest/v1/security_logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => { /* 전송 실패 무시 */ });
    } catch { /* ignore */ }
  }

  // 보안 토스트 메시지
  function _showSecurityToast(msg) {
    const existing = document.getElementById('_sec_toast_');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.id = '_sec_toast_';
    t.style.cssText = [
      'position:fixed',
      'bottom:80px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:#1e293b',
      'color:#f8fafc',
      'padding:10px 20px',
      'border-radius:8px',
      'font-size:13px',
      'font-weight:500',
      'z-index:99998',
      'box-shadow:0 4px 20px rgba(0,0,0,.4)',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'pointer-events:none',
    ].join(';');
    t.innerHTML = `<span style="font-size:15px">🔒</span> ${msg}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // 강제 로그아웃 알림 모달
  function _showSecurityAlert(msg, callback) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:999999;display:flex;align-items:center;justify-content:center';
    ov.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:36px 40px;text-align:center;max-width:400px;box-shadow:0 24px 80px rgba(0,0,0,.5)">
        <div style="font-size:52px;margin-bottom:16px">🔐</div>
        <h3 style="margin:0 0 12px;color:#dc2626;font-size:18px;font-weight:700">보안 알림</h3>
        <p style="color:#475569;font-size:14px;margin:0 0 24px;line-height:1.7">${msg}</p>
        <button onclick="(${callback.toString()})()"
          style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:11px 32px;font-size:14px;cursor:pointer;font-weight:700">
          확인
        </button>
      </div>`;
    document.body.appendChild(ov);
  }

  /* ──────────────────────────────────────────
     외부 공개 인터페이스
  ────────────────────────────────────────── */
  window._SecurityModule = {
    resetIdle: _resetIdleTimer,
    getSecLogs: () => {
      try { return JSON.parse(sessionStorage.getItem('_sec_logs_') || '[]'); } catch { return []; }
    },
    applyWatermark: _applyWatermark,
  };

})();
