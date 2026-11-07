// Check for worker updates on every visit. Never reload an active countdown.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .catch(() => { /* The timer still works when local caching is unavailable. */ });
  });
}
