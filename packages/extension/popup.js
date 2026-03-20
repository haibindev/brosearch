const i = k => chrome.i18n.getMessage(k) || k;
document.getElementById('label').textContent = i('statusConnecting');

(async () => {
  const cfg = await chrome.storage.sync.get({ daemonUrl: 'http://localhost:19824' })
  const url = cfg.daemonUrl.replace(/\/$/, '')
  const dot = document.getElementById('dot')
  const label = document.getElementById('label')
  const hint = document.getElementById('hint')
  try {
    const res = await fetch(url + '/health')
    const data = await res.json()
    if (data.ok && data.extension_connected) {
      dot.className = 'dot ok'
      label.textContent = i('statusReady')
      hint.textContent = i('statusReadyHint')
    } else if (data.ok) {
      dot.className = 'dot warn'
      label.textContent = i('statusReconnecting')
      hint.textContent = i('statusReconnectingHint')
    }
  } catch {
    dot.className = 'dot err'
    label.textContent = i('statusDaemonOff')
    hint.textContent = i('statusDaemonOffHint')
  }
})()
