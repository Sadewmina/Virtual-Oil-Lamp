const $ = (selector) => document.querySelector(selector),
  form = $('#loginForm'),
  error = $('#loginError');
let createMode = false;
function makeId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
async function init() {
  try {
    const info = await (await fetch('/api/boot')).json(),
      old = localStorage.getItem('virtualOilLampServerInstance');
    if (old && info.instanceId && old !== info.instanceId) {
      localStorage.removeItem('virtualOilLampDeviceId');
      localStorage.removeItem('virtualOilLampDeviceName');
    }
    localStorage.setItem('virtualOilLampServerInstance', info.instanceId);
    if (!localStorage.getItem('virtualOilLampDeviceId'))
      localStorage.setItem('virtualOilLampDeviceId', makeId());
    $('#deviceName').value = localStorage.getItem('virtualOilLampDeviceName') || 'Event device';
    $('#defaultLogin').hidden = !info.showDefaultLogin;
    document.title = `${info.siteName} — Sign in`;
    const session = await fetch('/api/session');
    if (session.ok) location.assign((await session.json()).redirect);
  } catch {
    $('#deviceName').value = 'Event device';
  }
}
$('#modeSwitch').onclick = () => {
  createMode = !createMode;
  $('#formTitle').textContent = createMode ? 'Create account' : 'Sign in';
  $('#formIntro').textContent = createMode
    ? 'Your account will wait until the administrator assigns a page.'
    : 'Sign in to open the page assigned to your account.';
  $('#submitButton').textContent = createMode ? 'Create account' : 'Sign in';
  $('#modeSwitch').textContent = createMode ? 'Back to sign in' : 'Create a new account';
  $('#defaultLogin').hidden = createMode || $('#defaultLogin').dataset.initiallyHidden === 'true';
  $('#password').autocomplete = createMode ? 'new-password' : 'current-password';
  error.textContent = '';
};
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = 'Signing in…';
  const deviceName = $('#deviceName').value.trim().slice(0, 48) || 'Event device';
  localStorage.setItem('virtualOilLampDeviceName', deviceName);
  const body = {
    username: $('#username').value,
    password: $('#password').value,
    deviceName,
    deviceId: localStorage.getItem('virtualOilLampDeviceId'),
  };
  try {
    const response = await fetch(createMode ? '/api/signup' : '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      result = await response.json();
    if (!response.ok) {
      error.textContent = result.error || 'Could not sign in';
      return;
    }
    location.assign(result.redirect || '/waiting.html');
  } catch {
    error.textContent = 'Could not reach the lamp server. Check that it is running.';
  }
});
init().then(() => {
  if ($('#defaultLogin').hidden) $('#defaultLogin').dataset.initiallyHidden = 'true';
});
