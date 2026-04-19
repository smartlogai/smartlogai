/* ============================================
   daily-module.js — Daily 전용 분리 모듈(개발 골격)
   Hourly 모듈과 물리적으로 분리하여 점진 개발한다.
   ============================================ */

(function () {
  'use strict';

  // Daily 전용 라우트는 통합 엔진(entry.js)으로 위임한다.
  window.init_entry_new_daily = async function init_entry_new_daily() {
    if (typeof window.init_entry_new === 'function') return window.init_entry_new();
  };

  window.init_my_entries_daily = async function init_my_entries_daily() {
    if (typeof window.init_my_entries === 'function') return window.init_my_entries();
  };
})();
