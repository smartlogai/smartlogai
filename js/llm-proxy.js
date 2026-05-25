/* Legacy placeholder: llm proxy shim */
(function () {
  if (typeof window === 'undefined') return;
  if (!window.LLMProxy) {
    window.LLMProxy = {
      async invoke() {
        return { ok: false, reason: 'LLM proxy is not configured.' };
      },
    };
  }
})();
