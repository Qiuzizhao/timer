(() => {
  const button = document.getElementById('desktopInstallBtn');
  const help = document.getElementById('desktopInstallHelp');
  const standalone = window.matchMedia('(display-mode: standalone)');
  let installPrompt = null;
  let installedThisSession = false;

  const refresh = () => {
    button.hidden = installedThisSession || standalone.matches || navigator.standalone === true;
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installedThisSession = true;
    if (help.open) help.close();
    refresh();
  });
  standalone.addEventListener('change', refresh);

  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  if (/mac/i.test(platform) && /safari/i.test(navigator.userAgent) && !/chrome|chromium|edg/i.test(navigator.userAgent)) {
    document.getElementById('desktopInstallInstructions').textContent =
      '在 Safari 的“文件”菜单中选择“添加到程序坞”。添加后可从程序坞打开静坐计时器。';
  }

  button.addEventListener('click', async () => {
    if (!installPrompt) {
      help.showModal();
      return;
    }
    const prompt = installPrompt;
    installPrompt = null; // Each browser install event can only be used once.
    button.disabled = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') installedThisSession = true;
    } catch {
      help.showModal();
    } finally {
      button.disabled = false;
      refresh();
    }
  });
  refresh();
})();
