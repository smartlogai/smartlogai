/**
 * Supabase URL/anon 키 결정
 * - localhost / 127.0.0.1 : js/supabase.dev.js 의 SMARTLOG_SUPABASE 만 사용 (운영 DB 자동 연결 안 함)
 * - 그 외(Netlify 등) : Netlify 빌드 시 환경변수로 주입된 값 사용
 *
 * 반드시 supabase.dev.js → supabase-env.js → security.js → app.js 순으로 로드할 것.
 */
(function () {
  'use strict';

  // Netlify 빌드 시 scripts/netlify-inject-supabase-env.cjs 가 아래 플레이스홀더를 치환합니다.
  // (레포에 운영 키를 커밋하지 않기 위함)
  var PROD_URL = '__SUPABASE_URL__';
  var PROD_KEY = '__SUPABASE_ANON_KEY__';
  var ENV_LABEL = '__SMARTLOG_ENV_LABEL__'; // PROD | STG | LOCAL (기본)

  function isLocalDevHost() {
    var h = location.hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '[::1]';
  }

  function looksInjected(v) {
    return typeof v === 'string' && v.length > 20 && v.indexOf('__') === -1;
  }

  if (isLocalDevHost()) {
    var d = window.SMARTLOG_SUPABASE;
    var ok =
      d &&
      typeof d.url === 'string' &&
      d.url.indexOf('supabase.co') !== -1 &&
      typeof d.anonKey === 'string' &&
      d.anonKey.length > 30;
    if (ok) {
      window.__SMARTLOG_SB_URL__ = d.url.replace(/\/$/, '');
      window.__SMARTLOG_SB_KEY__ = d.anonKey;
      window.__SMARTLOG_USING_DEV_DB__ = true;
      window.__SMARTLOG_ENV_LABEL__ = 'LOCAL';
    } else {
      window.__SMARTLOG_SB_URL__ = '';
      window.__SMARTLOG_SB_KEY__ = '';
      window.__SMARTLOG_USING_DEV_DB__ = false;
      window.__SMARTLOG_DEV_CONFIG_MISSING__ = true;
      window.__SMARTLOG_ENV_LABEL__ = 'LOCAL';
    }
  } else {
    // Netlify/원격: 빌드 주입이 안 되었으면 안전하게 빈 값으로 두고 동작을 멈추게 한다.
    var ok2 = looksInjected(PROD_URL) && looksInjected(PROD_KEY) && PROD_URL.indexOf('supabase.co') !== -1;
    window.__SMARTLOG_SB_URL__ = ok2 ? String(PROD_URL).replace(/\/$/, '') : '';
    window.__SMARTLOG_SB_KEY__ = ok2 ? String(PROD_KEY) : '';
    window.__SMARTLOG_USING_DEV_DB__ = false;
    window.__SMARTLOG_REMOTE_CONFIG_MISSING__ = !ok2;
    window.__SMARTLOG_ENV_LABEL__ = looksInjected(ENV_LABEL) ? ENV_LABEL : 'PROD';
  }
})();
