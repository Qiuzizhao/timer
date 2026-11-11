(() => {
  window.setupTimerRemote = function ({ readTimer, applyCommand }) {
    if (!window.isSecureContext || !window.connectTimerRemote || !/^https?:$/.test(location.protocol)) return;
    const button = document.getElementById('remoteToggle');
    const dialog = document.getElementById('remoteDialog');
    const status = document.getElementById('remoteStatus');
    const expiry = document.getElementById('remoteExpiry');
    const qr = document.getElementById('remoteQr');
    const renew = document.getElementById('remoteRenew');
    const endButton = document.getElementById('remoteEnd');
    const processed = new Set();
    let connection;
    let key;
    let paired = false;
    let phoneOnline = false;
    let codeTimer;
    let lastState;
    let error;

    function show(text, canRenew = false) {
      status.textContent = text;
      qr.hidden = true;
      qr.removeAttribute('src');
      expiry.hidden = true;
      renew.hidden = !canRenew;
      clearInterval(codeTimer);
    }

    function sync(ack, force = false) {
      if (!phoneOnline) return;
      const { deadline, ...state } = readTimer();
      const identity = JSON.stringify([
        state.phase, deadline ?? state.remainingMs, state.durationMs, state.canSubtract
      ]);
      if (!ack && !force && identity === lastState) return;
      if (connection.send({ type: 'state', state, ack })) lastState = identity;
    }

    function showCode(message) {
      show('请用手机相机扫描二维码。', true);
      if (!message.qr || !message.expiresIn) {
        show('二维码已过期，请重新生成。', true);
        return;
      }
      qr.src = 'data:image/svg+xml;base64,' + message.qr;
      qr.hidden = false;
      expiry.hidden = false;
      const expires = Date.now() + message.expiresIn * 1000;
      function update() {
        const seconds = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
        if (!seconds) show('二维码已过期，请重新生成。', true);
        else expiry.textContent = `二维码 ${seconds} 秒后失效`;
      }
      codeTimer = setInterval(update, 1000);
      update();
    }

    function setPeer(connected) {
      phoneOnline = connected;
      button.dataset.connected = String(connected);
      if (connected) paired = true;
      if (paired) show(connected ? '手机已连接，可以操作这台电脑上的计时器。' : '手机连接中断，正在等待重连。');
      if (connected) sync(undefined, true);
    }

    function stop(text) {
      connection?.close();
      connection = null;
      key = null;
      paired = false;
      phoneOnline = false;
      lastState = null;
      error = null;
      processed.clear();
      button.dataset.connected = 'false';
      endButton.hidden = true;
      show(text, true);
    }

    function connect() {
      show('正在连接遥控服务…');
      endButton.hidden = false;
      connection = window.connectTimerRemote({
        hello: () => key ? { type: 'host', key } : { type: 'create' },
        receive(message) {
          if (message.type === 'error') {
            error = message.code;
          } else if (message.type === 'ready') {
            key = message.key;
            paired = message.phone !== 'waiting';
            setPeer(message.phone === 'connected');
          } else if (message.type === 'code') {
            showCode(message);
          } else if (message.type === 'peer') {
            setPeer(message.connected);
          } else if (message.type === 'command') {
            if (!processed.has(message.id)) {
              processed.add(message.id);
              if (processed.size > 128) processed.delete(processed.values().next().value);
              applyCommand(message.action);
            }
            sync(message.id, true);
          }
        },
        disconnected(terminal) {
          if (terminal) {
            stop(error === 'busy' ? '遥控服务繁忙，请稍后重新生成。' : '遥控已结束，请重新生成二维码。');
            return;
          }
          phoneOnline = false;
          button.dataset.connected = 'false';
          show('连接中断，正在重新连接…');
        }
      });
    }

    button.hidden = false;
    button.addEventListener('click', () => {
      dialog.showModal();
      if (!connection) connect();
    });
    renew.addEventListener('click', () => {
      if (connection) connection.send({ type: 'renew' });
      else connect();
    });
    endButton.addEventListener('click', () => {
      connection?.send({ type: 'end' });
      stop('遥控已结束。');
      dialog.close();
    });
    window.addEventListener('pagehide', event => {
      if (!event.persisted) {
        connection?.send({ type: 'end' });
        connection?.close();
      }
    });
    return { sync };
  };
})();
