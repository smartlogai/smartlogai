/* ============================================
   daily-module.js — Daily 전용 분리 모듈(개발 골격)
   Hourly 모듈과 물리적으로 분리하여 점진 개발한다.
   ============================================ */

(function () {
  'use strict';

  function _renderDailyModuleInfo(kind) {
    const isEntry = kind === 'entry';
    const rootId = isEntry ? 'daily-entry-module-root' : 'daily-my-entries-module-root';
    const root = document.getElementById(rootId);
    if (!root) return;

    const title = isEntry ? 'Daily 업무 등록 모듈' : 'Daily Time Sheet 조회 모듈';
    const desc = isEntry
      ? 'Hourly 화면과 분리된 Daily 전용 등록 UI를 이 영역에서 개발합니다.'
      : 'Hourly 목록과 분리된 Daily 전용 조회/필터 UI를 이 영역에서 개발합니다.';
    root.innerHTML = `
      <div class="card" style="max-width:860px;margin:0 auto">
        <div class="card-header">
          <h2><i class="fas fa-layer-group" style="color:var(--primary)"></i> ${title}</h2>
        </div>
        <div class="card-body" style="padding:24px">
          <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 14px;color:#1e40af">
            <i class="fas fa-info-circle" style="margin-top:2px"></i>
            <div style="font-size:13px;line-height:1.6">${desc}</div>
          </div>
          <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;color:#334155">
            <i class="fas fa-sitemap" style="margin-top:2px;color:#64748b"></i>
            <div style="font-size:12px;line-height:1.6">
              소속 자동분기 정책: CCB 사업부는 Daily, CRB/COB 사업부는 Hourly로 자동 분기됩니다.
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-muted);line-height:1.7">
            현재 단계: 분리 라우팅/화면 골격 적용 완료<br>
            다음 단계: Daily 전용 필터/테이블/입력 폼 구현
          </div>
        </div>
      </div>
    `;
  }

  window.init_entry_new_daily = async function init_entry_new_daily() {
    _renderDailyModuleInfo('entry');
  };

  window.init_my_entries_daily = async function init_my_entries_daily() {
    _renderDailyModuleInfo('list');
  };
})();
