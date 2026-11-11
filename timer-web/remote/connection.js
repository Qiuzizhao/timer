(() => {
  const endpoint = new URL('ws', document.currentScript.src);
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
  const version = 2;
  const heartbeatMs = 10000;
  const responseTimeoutMs = 5000;
  const clockSampleMaxAgeMs = 120000;

  window.connectTimerRemote = function ({ hello, receive, disconnected }) {
    let socket;
    let retry;
    let watchdog;
    let heartbeat;
    let sample;
    let stopped = false;
    let delay = 300;

    function send(message) {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    }

    function clockBounds() {
      if (!sample) return null;
      const now = performance.now();
      const age = now - sample.receivedAt;
      const wallAge = Date.now() - sample.wallTime;
      if (Math.max(age, wallAge) > clockSampleMaxAgeMs ||
          Math.abs(wallAge - age) > 1000) return null;
      // The relay sampled its clock between the request and receipt of the reply.
      const drift = Math.ceil(age / 1000);
      return {
        earliest: Math.floor(sample.clockMs + Math.min(age, wallAge) - drift),
        latest: Math.ceil(sample.clockMs + Math.max(age, wallAge) + sample.receivedAt - sample.sentAt + drift + 1),
      };
    }

    function retire() {
      clearTimeout(retry);
      clearTimeout(watchdog);
      clearTimeout(heartbeat);
      sample = undefined;
      const previous = socket;
      socket = undefined;
      if (previous?.readyState < WebSocket.CLOSING) previous.close(4000);
    }

    function loseConnection(terminal, code, retryNow = false) {
      if (terminal) stop();
      else retire();
      disconnected(terminal, code);
      if (stopped || !navigator.onLine) return;
      if (retryNow) open();
      else {
        retry = setTimeout(open, delay);
        delay = Math.min(5000, delay * 2);
      }
    }

    function open() {
      if (stopped || !navigator.onLine) return;
      socket = new WebSocket(endpoint);
      const current = socket;
      let sentAt;
      function timeout(ms) {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          if (current === socket) loseConnection(false, 4000);
        }, ms);
      }
      timeout(8000);
      current.addEventListener('open', () => {
        if (current !== socket) return;
        sentAt = performance.now();
        send({ ...hello(), version });
      });
      current.addEventListener('message', event => {
        if (stopped || socket !== current) return;
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === 'ready' || message.type === 'pong') {
          if (!Number.isSafeInteger(message.clockMs) || sentAt === undefined) {
            receive({ type: 'error', code: 'upgrade' });
            loseConnection(true, 4003);
            return;
          }
          sample = { clockMs: message.clockMs, sentAt, receivedAt: performance.now(), wallTime: Date.now() };
          clearTimeout(watchdog);
          clearTimeout(heartbeat);
          heartbeat = setTimeout(() => {
            if (current !== socket) return;
            sentAt = performance.now();
            send({ type: 'ping' });
            timeout(responseTimeoutMs);
          }, heartbeatMs);
          delay = 300;
          if (message.type === 'pong') return;
        }
        receive(message);
      });
      current.addEventListener('close', event => {
        if (stopped || socket !== current) return;
        const terminal = [4001, 4002, 4003].includes(event.code);
        loseConnection(terminal, event.code);
      });
    }

    function reconnect() {
      if (!stopped) loseConnection(false, 4000, true);
    }

    function offline() {
      retire();
      disconnected(false, 4000);
    }

    function stop() {
      stopped = true;
      retire();
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', offline);
    }

    window.addEventListener('online', reconnect);
    window.addEventListener('offline', offline);
    if (navigator.onLine) open();
    else offline();
    return { send, reconnect, clockBounds, close: stop };
  };
})();
