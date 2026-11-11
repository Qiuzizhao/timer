(() => {
  const endpoint = new URL('ws', document.currentScript.src);
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';

  window.connectTimerRemote = function ({ hello, receive, disconnected }) {
    let socket;
    let retry;
    let stopped = false;
    let delay = 300;

    function send(message) {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    }

    function open() {
      if (stopped) return;
      socket = new WebSocket(endpoint);
      const current = socket;
      current.addEventListener('open', () => send(hello()));
      current.addEventListener('message', event => {
        if (stopped || socket !== current) return;
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === 'ready') delay = 300;
        receive(message);
      });
      current.addEventListener('close', event => {
        if (stopped || socket !== current) return;
        const terminal = [4001, 4002, 4003].includes(event.code);
        if (terminal) stop();
        disconnected(terminal, event.code);
        if (terminal || stopped) return;
        retry = setTimeout(open, delay);
        delay = Math.min(5000, delay * 2);
      });
    }

    function reconnect() {
      if (stopped) return;
      if (socket?.readyState < WebSocket.CLOSING) {
        socket.close(4000);
      } else if (socket?.readyState === WebSocket.CLOSED) {
        clearTimeout(retry);
        open();
      }
    }

    function offline() {
      if (socket?.readyState < WebSocket.CLOSING) socket.close(4000);
    }

    function stop() {
      stopped = true;
      clearTimeout(retry);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', offline);
      socket?.close();
    }

    window.addEventListener('online', reconnect);
    window.addEventListener('offline', offline);
    open();
    return { send, reconnect, close: stop };
  };
})();
