(() => {
  const keyPattern = /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{32,64}$/;
  const storageKey = 'timer-remote-credentials';
  const labels = {
    ready: ['等待开始', '开始'],
    running: ['运行中', '暂停'],
    paused: ['已暂停', '继续'],
    finished: ['时间到', '重新开始']
  };
  const $ = id => document.getElementById(id);
  const buttons = { add: $('add'), subtract: $('subtract'), toggle: $('toggle') };
  let credentials;
  let connection;
  let state;
  let deadline;
  let online = false;
  let pending;
  let pendingTimer;
  let error;
  let clock;

  function save(value) {
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // The current tab can still connect when storage is unavailable.
    }
  }

  function readCredentials() {
    const pair = new URLSearchParams(location.hash.slice(1)).get('pair');
    if (pair !== null) {
      history.replaceState(null, '', location.pathname + location.search);
      if (!keyPattern.test(pair)) return null;
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)),
        byte => byte.toString(16).padStart(2, '0')).join('');
      const value = { pair, key: pair.split('.')[0] + '.' + secret };
      save(value);
      return value;
    }
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey));
      if (keyPattern.test(value?.key ?? '') && (!value.pair || keyPattern.test(value.pair))) return value;
    } catch {
      // A fresh QR code can start a session without stored credentials.
    }
    return null;
  }

  function remainingMs() {
    return deadline === undefined ? state?.remainingMs ?? 0 : Math.max(0, deadline - performance.now());
  }

  function render() {
    const remaining = remainingMs();
    if (state) {
      const seconds = Math.ceil(remaining / 1000);
      const hours = Math.floor(seconds / 3600);
      const pad = value => String(value).padStart(2, '0');
      const shown = (hours ? pad(hours) + ':' : '') + pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60);
      if ($('time').value !== shown) $('time').value = shown;
      $('time').dataset.hours = String(hours > 0);
      const progress = state.durationMs ? Math.min(1, remaining / state.durationMs) : 0;
      $('dial').style.setProperty('--progress', progress * 100 + '%');
      const [status, action] = labels[state.phase];
      if ($('phase').textContent !== status) $('phase').textContent = status;
      $('action-label').textContent = action;
      $('action-icon').textContent = state.phase === 'running' ? 'Ⅱ' : '▷';
    }
    const disabled = !online || Boolean(pending);
    buttons.add.disabled = disabled;
    buttons.subtract.disabled = disabled || !state?.canSubtract;
    buttons.toggle.disabled = disabled || (!state?.durationMs && !remaining);
    if (deadline !== undefined && remaining > 0 && clock === undefined) clock = setInterval(render, 200);
    if ((deadline === undefined || !remaining) && clock !== undefined) {
      clearInterval(clock);
      clock = undefined;
    }
  }

  function clearPending() {
    clearTimeout(pendingTimer);
    pending = undefined;
  }

  function showConnection(label, detail = '') {
    const connected = $('connection');
    connected.dataset.online = String(online);
    if (connected.textContent !== label) connected.textContent = label;
    $('notice').hidden = !detail;
    $('notice').textContent = detail;
  }

  function waitForComputer(label, detail) {
    if (state) state.remainingMs = remainingMs();
    deadline = undefined;
    online = false;
    clearPending();
    showConnection(label, detail);
    render();
  }

  function sendCommand(action) {
    if (!online || pending) return;
    const id = crypto.randomUUID();
    if (!connection.send({ type: 'command', action, id })) {
      waitForComputer('连接中断', '正在重新连接电脑…');
      return;
    }
    pending = id;
    pendingTimer = setTimeout(() => {
      waitForComputer('正在同步', '正在重新读取电脑上的时间…');
      connection.reconnect();
    }, 4000);
    render();
  }

  buttons.add.addEventListener('click', () => sendCommand('add'));
  buttons.subtract.addEventListener('click', () => sendCommand('subtract'));
  buttons.toggle.addEventListener('click', () => sendCommand(state?.phase === 'running' ? 'pause' : 'start'));

  if (!window.isSecureContext || !window.connectTimerRemote) {
    waitForComputer('连接不可用', '请联网后重新打开遥控页面。');
    return;
  }
  credentials = readCredentials();
  if (!credentials) {
    waitForComputer('等待扫码', '请在电脑打开「手机遥控」，用手机相机扫描二维码。');
    return;
  }

  connection = window.connectTimerRemote({
    hello: () => credentials.pair
      ? { type: 'pair', key: credentials.pair, phoneKey: credentials.key }
      : { type: 'phone', key: credentials.key },
    receive(message) {
      if (message.type === 'error') {
        error = message.code;
      } else if (message.type === 'ready') {
        credentials = { key: credentials.key };
        save(credentials);
        waitForComputer(message.host ? '正在同步' : '电脑已断开',
          message.host ? '' : '等待电脑重新连接…');
      } else if (message.type === 'peer') {
        waitForComputer(message.connected ? '正在同步' : '电脑已断开',
          message.connected ? '' : '等待电脑重新连接…');
      } else if (message.type === 'state') {
        state = message.state;
        deadline = state.phase === 'running' ? performance.now() + state.remainingMs : undefined;
        if (message.ack === pending) clearPending();
        online = true;
        showConnection('电脑已连接');
        render();
      }
    },
    disconnected(terminal, code) {
      if (terminal) {
        save(null);
        const label = error === 'expired' ? '二维码已失效' : code === 4001 ? '连接已替换' : '遥控已结束';
        waitForComputer(label, '请在电脑重新生成二维码。');
      } else {
        waitForComputer('连接中断', '正在重新连接电脑…');
      }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && online) {
      waitForComputer('正在同步');
      connection.reconnect();
    }
  });
})();
