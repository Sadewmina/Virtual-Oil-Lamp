const $ = (selector) => document.querySelector(selector);
const page = location.pathname.split('/').pop() || 'index.html';
const defaultState = {
  instanceId: '',
  title: 'The Lighting Ceremony',
  subtitle: 'A moment of light, shared together',
  count: 24,
  logo: '',
  logoSize: 100,
  lampSize: 100,
  litArtworkScale: 100,
  unlitArtworkScale: 100,
  matchLampArtwork: true,
  lampArtworkScale: 100,
  animateLamps: false,
  animationTime: 30,
  orbitRadius: 45,
  background: '',
  accentColor: '#37d7c0',
  eventBackground: '#0b1118',
  flameColor: '#ffbd59',
  titleFont: 'tech',
  googleFontFamily: 'Inter',
  buttonLabel: 'LIGHT A LAMP',
  buttonImage: '',
  buttonMode: 'logo_text',
  buttonLogoSize: 100,
  litImage: '',
  unlitImage: '',
  lit: [],
  hideFullscreenControls: false,
};
let state = { ...defaultState },
  toastTimer,
  orbitRaf = 0,
  orbitStartedAt = 0,
  previewRaf = 0,
  previewOrbitStartedAt = 0,
  previewWasAnimating = false;

async function load() {
  try {
    state = { ...defaultState, ...(await (await fetch('/api/state')).json()) };
  } catch {}
  render();
}
async function update(part) {
  const response = await fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...state, ...part }),
  });
  if (!response.ok) {
    const error = await response.json();
    showToast(error.error || 'Could not save changes');
    return;
  }
  state = { ...defaultState, ...(await response.json()) };
  render();
}
function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function isLit(i) {
  return (state.lit || []).includes(i);
}
function lampSvg(on) {
  const flame = on
    ? '<path d="M24 7c0 7-7 10-5 17 2 7 11 5 12 0 2-5-2-8-1-12 3 4 7 7 6 13-1 7-6 11-13 11-8 0-13-5-12-12 1-7 7-10 13-17Z" fill="var(--flame-color)"/><path d="M25 18c0 4-4 6-3 10 1 3 5 3 6 0 1-3-2-5-3-10Z" fill="#fff4b1"/>'
    : '';
  return `<svg viewBox="0 0 48 72" xmlns="http://www.w3.org/2000/svg"><ellipse cx="24" cy="63" rx="21" ry="5" fill="#9b5a26"/><path d="M8 59c-1-8 3-15 8-19 3-2 5-4 5-8h6c0 4 2 6 5 8 5 4 9 11 8 19Z" fill="#b87333" stroke="#f2c176" stroke-width="2"/><path d="M16 47h16" stroke="#f7d69b" stroke-width="2"/><path d="M24 32v-7" stroke="#5b3924" stroke-width="2"/>${flame}</svg>`;
}
async function refreshServerAddresses() {
  const root = $('#serverAddressList');
  if (!root) return;
  try {
    const response = await fetch('/api/boot');
    if (!response.ok) throw new Error();
    const data = await response.json(),
      addresses = data.serverAddresses || [];
    const status = $('#serverStatusText');
    if (status) status.textContent = 'Online · listening on port ' + data.serverPort;
    root.innerHTML =
      (addresses.length ? addresses : [{ networkName: 'Current address', url: location.origin }])
        .map((item) => {
          const address = typeof item === 'string' ? item : item.url,
            name =
              typeof item === 'string'
                ? addresses.length > 1
                  ? 'Network ' + (addresses.indexOf(item) + 1)
                  : 'Network address'
                : item.networkName || item.interfaceName || 'Network';
          return (
            '<div class="server-address-row"><span>' +
            esc(name) +
            '</span><code>' +
            esc(address) +
            '</code></div>'
          );
        })
        .join('') + '<small>Open the address for your connected network on other devices.</small>';
  } catch {
    root.innerHTML =
      '<code>' +
      esc(location.origin) +
      '</code><small>Server address could not be detected.</small>';
  }
}
function applyGoogleFont() {
  const family =
    String(state.googleFontFamily || 'Inter')
      .replace(/[^a-zA-Z0-9 -]/g, '')
      .trim() || 'Inter';
  let link = $('#googleFonts');
  const fontUrl =
    'https://fonts.googleapis.com/css2?family=' +
    encodeURIComponent(family).replace(/%20/g, '+') +
    '&display=swap';
  if (!link) {
    link = document.createElement('link');
    link.id = 'googleFonts';
    link.rel = 'stylesheet';
    link.media = 'print';
    link.onload = () => (link.media = 'all');
    link.onerror = () => (link.media = 'all');
    link.href = fontUrl;
    document.head.append(link);
  } else if (link.href !== fontUrl) {
    link.media = 'print';
    link.href = fontUrl;
  }
  document.documentElement.style.setProperty('--event-title-font', '"' + family + '", sans-serif');
}
async function uploadImageFile(file) {
  if (!file) return null;
  if (file.size > 8 * 1024 * 1024) {
    showToast('Image must be smaller than 8 MB');
    return null;
  }
  if (
    !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'].includes(
      file.type,
    )
  ) {
    showToast('Use PNG, JPG, WebP, GIF, AVIF, or SVG images');
    return null;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: file.name,
      mime: file.type,
      base64: String(dataUrl).split(',')[1],
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    showToast(result.error || 'Image upload failed');
    return null;
  }
  return result.url;
}
function syncImagePreview(key) {
  const input = $('#' + key),
    preview = $('#' + key + 'Preview');
  if (!input || !preview) return;
  preview.src = input.value || '';
  preview.hidden = !input.value;
}
function bindImageUpload(inputId, key) {
  const input = $('#' + inputId);
  if (!input) return;
  input.onchange = async () => {
    const url = await uploadImageFile(input.files?.[0]);
    if (!url) return;
    $('#' + key).value = url;
    syncImagePreview(key);
  };
}
function selectedPreviewSize() {
  let value =
    $('#previewResolution')?.value ||
    localStorage.getItem('virtualOilLampPreviewSize') ||
    '1920x1080';
  if (value === 'custom') {
    const width = Math.max(320, Math.min(7680, Number($('#previewWidth')?.value) || 1920)),
      height = Math.max(320, Math.min(4320, Number($('#previewHeight')?.value) || 1080));
    return { width, height };
  }
  const [width, height] = value.split('x').map(Number);
  return { width: width || 1920, height: height || 1080 };
}
function fitPreviewCanvases(width, height) {
  document.querySelectorAll('.preview-viewport').forEach((viewport) => {
    const slot = viewport.parentElement,
      frame = viewport.querySelector('iframe');
    if (!slot || !frame) return;
    const scale = Math.min(slot.clientWidth / width, slot.clientHeight / height);
    viewport.style.width = width * scale + 'px';
    viewport.style.height = height * scale + 'px';
    frame.style.width = width + 'px';
    frame.style.height = height + 'px';
    frame.style.transform = 'scale(' + scale + ')';
  });
}
function renderPreviews() {
  const { width, height } = selectedPreviewSize();
  fitPreviewCanvases(width, height);
}
function setupPreviewResolution() {
  const select = $('#previewResolution');
  if (!select) return;
  const saved = localStorage.getItem('virtualOilLampPreviewSize') || '1920x1080',
    known = [...select.options].some((option) => option.value === saved);
  select.value = known ? saved : 'custom';
  const size = saved.split('x').map(Number);
  $('#previewWidth').value = size[0] || 1920;
  $('#previewHeight').value = size[1] || 1080;
  const custom = $('#customPreviewSize');
  custom.hidden = select.value !== 'custom';
  const apply = () => {
    custom.hidden = select.value !== 'custom';
    const value =
      select.value === 'custom'
        ? $('#previewWidth').value + 'x' + $('#previewHeight').value
        : select.value;
    localStorage.setItem('virtualOilLampPreviewSize', value);
    renderPreviews();
  };
  select.onchange = apply;
  $('#previewWidth').oninput = apply;
  $('#previewHeight').oninput = apply;
  window.addEventListener('resize', renderPreviews);
}
function render() {
  document.body.classList.toggle('hide-fullscreen-controls', !!state.hideFullscreenControls);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--event-accent', state.accentColor || '#37d7c0');
  rootStyle.setProperty('--ceremony-bg', state.eventBackground || '#0b1118');
  rootStyle.setProperty('--flame-color', state.flameColor || '#ffbd59');
  applyGoogleFont();
  rootStyle.setProperty('--gold', state.accentColor || '#37d7c0');
  if ($('#title')) {
    $('#title').value = state.title;
    $('#subtitle').value = state.subtitle;
    $('#count').value = state.count;
    $('#logo').value = state.logo;
    $('#logoSize').value = state.logoSize || 100;
    $('#logoSizeValue').textContent = `${state.logoSize || 100}%`;
    $('#lampSize').value = state.lampSize || 100;
    $('#lampSizeValue').textContent = `${state.lampSize || 100}%`;
    $('#background').value = state.background;
    $('#accentColor').value = state.accentColor || '#37d7c0';
    $('#eventBackground').value = state.eventBackground || '#0b1118';
    $('#flameColor').value = state.flameColor || '#ffbd59';
    $('#buttonLabel').value = state.buttonLabel;
    $('#buttonImage').value = state.buttonImage;
    $('#buttonMode').value = state.buttonMode || 'logo_text';
    $('#buttonLogoSize').value = state.buttonLogoSize || 100;
    $('#buttonLogoSizeValue').textContent = `${state.buttonLogoSize || 100}%`;
    $('#litImage').value = state.litImage;
    $('#unlitImage').value = state.unlitImage;
    ['logo', 'background', 'litImage', 'unlitImage', 'buttonImage'].forEach(syncImagePreview);
    $('#litArtworkScale').value = state.litArtworkScale || 100;
    $('#litArtworkScaleValue').textContent = `${state.litArtworkScale || 100}%`;
    $('#unlitArtworkScale').value = state.unlitArtworkScale || 100;
    $('#unlitArtworkScaleValue').textContent = `${state.unlitArtworkScale || 100}%`;
    $('#matchLampArtwork').checked = state.matchLampArtwork !== false;
    $('#lampArtworkScale').value = state.lampArtworkScale || 100;
    $('#lampArtworkScaleValue').textContent = `${state.lampArtworkScale || 100}%`;
    toggleArtworkScaleControls();
    $('#animateLamps').checked = !!state.animateLamps;
    $('#animationTime').value = state.animationTime || 30;
    $('#animationTimeValue').textContent = `${state.animationTime || 30}s`;
    $('#orbitRadius').value = state.orbitRadius || 45;
    $('#orbitRadiusValue').textContent = `${state.orbitRadius || 45}%`;
    $('#hideFullscreenControls').checked = !!state.hideFullscreenControls;
    drawStatus();
  }
  drawStatus();
  renderPreviews();
  if ($('#eventTitle')) {
    $('#eventTitle').textContent = state.title;
    $('#eventSubtitle').textContent = state.subtitle;
    $('#litProgress').textContent = state.lit.length;
    $('#totalProgress').textContent = state.count;
    $('.event-bg').style.backgroundImage = state.background
      ? `url("${state.background.replaceAll('"', '%22')}")`
      : '';
    $('#buttonText').textContent = state.buttonLabel || 'LIGHT A LAMP';
    $('#buttonArt').innerHTML = state.buttonImage
      ? `<img src="${esc(state.buttonImage)}" alt="">`
      : '✦';
    const mode = state.buttonMode || 'logo_text';
    $('#buttonArt').hidden = mode === 'text_only';
    $('#buttonText').hidden = mode === 'logo_only';
    $('#lightButton').classList.toggle('logo-only', mode === 'logo_only');
    $('#lightButton').setAttribute('aria-label', state.buttonLabel || 'Light a lamp');
    const logo = $('#buttonArt img');
    if (logo) {
      const size = ((mode === 'logo_only' ? 180 : 42) * (state.buttonLogoSize || 100)) / 100;
      logo.style.width = `${size}px`;
      logo.style.height = `${size}px`;
    }
  }
  if ($('#displayStage')) {
    drawLamps();
    const logo = $('#eventLogo');
    if (state.logo) {
      logo.src = state.logo;
      logo.style.transform = `scale(${(state.logoSize || 100) / 100})`;
      logo.hidden = false;
    } else logo.hidden = true;
  }
}
function drawStatus() {
  const root = $('#statusGrid');
  if (!root) return;
  root.innerHTML = '';
  for (let i = 0; i < state.count; i++) {
    const button = document.createElement('button');
    button.className = 'status-lamp ' + (isLit(i) ? 'lit' : '');
    button.textContent = '♨';
    button.title = `Lamp ${i + 1}: ${isLit(i) ? 'lit' : 'unlit'}`;
    button.onclick = async () => {
      const lit = new Set(state.lit);
      lit.has(i) ? lit.delete(i) : lit.add(i);
      await update({ lit: [...lit] });
    };
    root.append(button);
  }
  $('#statusCount').textContent = `${state.lit.length} / ${state.count} lit`;
}
function toggleArtworkScaleControls() {
  const matched = $('#matchLampArtwork').checked;
  $('#commonArtworkScaleControl').hidden = !matched;
  $('#litScaleControl').hidden = matched;
  $('#unlitScaleControl').hidden = matched;
}
function paintLamp(el, index) {
  const on = isLit(index);
  el.classList.toggle('lit', on);
  if ((on && state.litImage) || (!on && state.unlitImage)) {
    let img = el.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      el.replaceChildren(img);
    }
    const src = on ? state.litImage : state.unlitImage;
    if (img.getAttribute('src') !== src) img.src = src;
    const common = (Number(state.lampArtworkScale) || 100) / 100,
      scale =
        state.matchLampArtwork !== false
          ? common
          : (Number(on ? state.litArtworkScale : state.unlitArtworkScale) || 100) / 100;
    img.alt = '';
    img.style.transform = 'scale(' + scale + ')';
    img.style.transformOrigin = 'center';
  } else el.innerHTML = lampSvg(on);
  el.dataset.lit = on ? '1' : '0';
}
function syncDisplayOverlay() {
  document.body.classList.toggle('hide-fullscreen-controls', !!state.hideFullscreenControls);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--event-accent', state.accentColor || '#37d7c0');
  rootStyle.setProperty('--ceremony-bg', state.eventBackground || '#0b1118');
  rootStyle.setProperty('--flame-color', state.flameColor || '#ffbd59');
  rootStyle.setProperty('--gold', state.accentColor || '#37d7c0');
  const logo = $('#eventLogo');
  if (logo) {
    if (state.logo) {
      if (logo.getAttribute('src') !== state.logo) logo.src = state.logo;
      logo.style.transform = 'scale(' + (Number(state.logoSize) || 100) / 100 + ')';
      logo.hidden = false;
    } else logo.hidden = true;
  }
}
function updateLampAppearances(previous, next) {
  const before = new Set(previous || []),
    after = new Set(next || []);
  for (const index of new Set([...before, ...after]))
    if (before.has(index) !== after.has(index)) {
      const el = $('#lampRing [data-lamp-index="' + index + '"]');
      if (el) paintLamp(el, index);
    }
}
function drawLamps() {
  const root = $('#lampRing');
  if (!root) return;
  if (orbitRaf) cancelAnimationFrame(orbitRaf);
  root.innerHTML = '';
  const count = Math.max(1, Number(state.count) || 1),
    densityScale = Math.max(0.55, Math.min(2.6, Math.sqrt(24 / count))),
    userScale = (Number(state.lampSize) || 100) / 100,
    radius = Math.max(10, Math.min(49, Number(state.orbitRadius) || 45));
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div'),
      w = Math.min(63, Math.max(27, innerWidth * 0.05)) * densityScale * userScale,
      h = Math.min(84, Math.max(41, innerHeight * 0.07)) * densityScale * userScale;
    el.className = 'lamp';
    el.dataset.lampIndex = i;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    root.append(el);
    paintLamp(el, i);
  }
  const place = (elapsed) => {
    const rotation = state.animateLamps
      ? (elapsed / Math.max(2, Number(state.animationTime) || 30)) * Math.PI * 2
      : 0;
    root.querySelectorAll('.lamp').forEach((el, i) => {
      const angle = (Math.PI * 2 * i) / count - Math.PI / 2 + rotation;
      el.style.left = 50 + radius * Math.cos(angle) + '%';
      el.style.top = 50 + radius * Math.sin(angle) + '%';
    });
  };
  place(0);
  if (state.animateLamps) {
    orbitStartedAt = performance.now();
    const tick = (now) => {
      if (!state.animateLamps) return;
      place((now - orbitStartedAt) / 1000);
      orbitRaf = requestAnimationFrame(tick);
    };
    orbitRaf = requestAnimationFrame(tick);
  }
}
function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}
function pageName(page) {
  return (
    {
      config: 'Configuration page',
      lighting: 'Lighting page',
      display: 'Display page',
      'All pages': 'All pages',
    }[page] || 'Waiting for assignment'
  );
}
async function postLogin() {
  const response = await fetch('/api/session');
  if (response.ok) return true;
  location.assign('/login.html');
  return false;
}
function pageOptions(selected, admin = false) {
  return `<option value="" ${!selected ? 'selected' : ''}>${admin ? 'All pages' : 'Waiting for assignment'}</option><option value="config" ${selected === 'config' ? 'selected' : ''}>Configuration</option><option value="lighting" ${selected === 'lighting' ? 'selected' : ''}>Lighting</option><option value="display" ${selected === 'display' ? 'selected' : ''}>Display</option>`;
}
async function refreshAccounts() {
  const root = $('#accountList');
  if (!root) return;
  try {
    const response = await fetch('/api/accounts');
    if (!response.ok) {
      root.innerHTML = '<p class="hint">Administrator sign-in required.</p>';
      return;
    }
    const list = await response.json();
    root.innerHTML = '';
    for (const account of list) {
      const admin = account.role === 'admin',
        row = document.createElement('div');
      row.className = 'account-row';
      row.innerHTML = `<div class="account-identity"><strong>${esc(account.username)}</strong><small>${admin ? 'Administrator' : 'User account'}${!admin && !account.assignedPage ? ' · Waiting for page assignment' : ''}</small></div><select aria-label="Page access for ${esc(account.username)}" ${admin ? 'disabled' : ''}>${pageOptions(account.assignedPage, admin)}</select><div class="account-actions">${admin ? '' : `<button class="device-rename" data-action="rename">Rename</button><button class="device-rename" data-action="password">Set password</button><button class="device-terminate" data-action="remove">Remove</button>`}</div>`;
      const select = row.querySelector('select');
      select.onchange = async () => {
        const result = await fetch('/api/accounts/assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: account.username, assignedPage: select.value || null }),
        });
        if (!result.ok) {
          const err = await result.json();
          showToast(err.error || 'Could not assign page');
        }
        await refreshAccounts();
      };
      row.querySelector('[data-action="rename"]')?.addEventListener('click', async () => {
        const newUsername = prompt('New account name:', account.username);
        if (newUsername === null) return;
        const result = await fetch('/api/accounts/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: account.username, newUsername }),
        });
        if (!result.ok) {
          const err = await result.json();
          showToast(err.error || 'Could not rename account');
        }
        await refreshAccounts();
      });
      row.querySelector('[data-action="password"]')?.addEventListener('click', async () => {
        const password = prompt(`Set a new password for ${account.username} (8+ characters):`);
        if (password === null) return;
        const result = await fetch('/api/accounts/password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: account.username, password }),
        });
        if (!result.ok) {
          const err = await result.json();
          showToast(err.error || 'Could not set password');
        } else showToast('Account password updated');
      });
      row.querySelector('[data-action="remove"]')?.addEventListener('click', async () => {
        if (
          !confirm(
            `Remove account ${account.username}? They will need to create a new account to reconnect.`,
          )
        )
          return;
        const result = await fetch('/api/accounts/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: account.username }),
        });
        if (!result.ok) {
          const err = await result.json();
          showToast(err.error || 'Could not remove account');
        }
        await refreshAccounts();
        await refreshDevices();
      });
      root.append(row);
    }
  } catch {
    root.innerHTML = '<p class="hint">Could not load accounts.</p>';
  }
}
async function refreshDevices() {
  const root = $('#deviceList');
  if (!root) return;
  try {
    const response = await fetch('/api/devices');
    if (!response.ok) {
      root.innerHTML = '<p class="hint">Administrator sign-in required.</p>';
      return;
    }
    const list = await response.json();
    if (!list.length) {
      root.innerHTML =
        '<p class="hint">No devices are currently connected. Signed-in devices will appear here.</p>';
      return;
    }
    root.innerHTML = '';
    for (const d of list) {
      const row = document.createElement('div');
      row.className = 'device-row';
      row.innerHTML = `<div class="device-info"><span class="device-dot ${d.online ? 'online' : ''} ${d.blocked ? 'blocked' : ''}"></span><div class="device-meta"><div class="device-name-line"><strong>${esc(d.name)}</strong><button class="device-rename" type="button">Rename</button></div><small>${esc(d.ipAddress || 'IP unavailable')} · ${esc(d.accountUsername)} · ${d.blocked ? 'Terminated' : d.online ? 'Online' : 'Offline'} · ${esc(pageName(d.assignedPage))}</small></div></div><button class="device-terminate ${d.blocked ? 'restore' : ''}" type="button">${d.blocked ? 'Restore' : 'Terminate access'}</button>`;
      row.querySelector('.device-rename').onclick = async () => {
        const name = prompt('Device name:', d.name);
        if (name === null) return;
        const r = await fetch('/api/device/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: d.id, name }),
        });
        if (!r.ok) {
          const e = await r.json();
          showToast(e.error || 'Could not rename device');
        }
        await refreshDevices();
      };
      row.querySelector('.device-terminate').onclick = async () => {
        if (d.blocked) {
          await fetch('/api/device/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: d.id }),
          });
        } else {
          if (!confirm(`Terminate access for ${d.name}?`)) return;
          await fetch('/api/device/terminate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: d.id }),
          });
        }
        await refreshDevices();
      };
      root.append(row);
    }
  } catch {
    root.innerHTML = '<p class="hint">Could not load devices.</p>';
  }
}
async function adminSaveSettings() {
  const fields = {
    title: $('#title').value,
    subtitle: $('#subtitle').value,
    count: Math.max(1, Math.min(120, Number($('#count').value) || 24)),
    logo: $('#logo').value,
    logoSize: Number($('#logoSize').value) || 100,
    lampSize: Number($('#lampSize').value) || 100,
    background: $('#background').value,
    accentColor: $('#accentColor').value,
    eventBackground: $('#eventBackground').value,
    flameColor: $('#flameColor').value,
    googleFontFamily: $('#googleFontFamily').value,
    buttonLabel: $('#buttonLabel').value,
    buttonImage: $('#buttonImage').value,
    buttonMode: $('#buttonMode').value,
    buttonLogoSize: Number($('#buttonLogoSize').value) || 100,
    litImage: $('#litImage').value,
    unlitImage: $('#unlitImage').value,
    litArtworkScale: Number($('#litArtworkScale').value) || 100,
    unlitArtworkScale: Number($('#unlitArtworkScale').value) || 100,
    matchLampArtwork: $('#matchLampArtwork').checked,
    lampArtworkScale: Number($('#lampArtworkScale').value) || 100,
    animateLamps: $('#animateLamps').checked,
    animationTime: Number($('#animationTime').value) || 30,
    orbitRadius: Number($('#orbitRadius').value) || 45,
    hideFullscreenControls: $('#hideFullscreenControls').checked,
  };
  await update(fields);
  showToast('Settings saved');
}
function setupTheme() {
  const key = 'virtualOilLampConfigTheme';
  let theme = localStorage.getItem(key) || 'dark';
  function apply() {
    document.body.dataset.theme = theme;
    $('#themeToggle').textContent = theme === 'dark' ? '☼ Light' : '◐ Dark';
  }
  $('#themeToggle').onclick = () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(key, theme);
    apply();
  };
  apply();
}
async function applySessionNavigation() {
  const response = await fetch('/api/session');
  if (!response.ok) {
    if ($('#displayLogout')) {
      $('#displayLogout').hidden = true;
      return null;
    }
    location.assign('/login.html');
    return null;
  }
  const user = await response.json();
  document
    .querySelectorAll(
      'nav a[href="live.html"],nav a[href="config.html"],nav a[href="lighting.html"],nav a[href="display.html"],nav a[href="connection.html"],nav a[href="network.html"]',
    )
    .forEach((link) => {
      const key = link.getAttribute('href').replace('.html', '');
      link.hidden = user.role !== 'admin' && key !== user.assignedPage && key !== 'connection';
    });
  const logout = $('#logout') || $('#displayLogout') || $('#lightingLogout');
  if (logout) {
    logout.hidden = false;
    logout.onclick = async () => {
      await fetch('/api/logout', { method: 'POST' });
      location.assign('/login.html');
    };
  }
  setInterval(async () => {
    const check = await fetch('/api/session');
    if (!check.ok) {
      location.assign('/login.html');
      return;
    }
    const current = await check.json();
    if (
      current.role !== 'admin' &&
      current.assignedPage !== page.replace('.html', '') &&
      page !== 'connection.html' &&
      !new URLSearchParams(location.search).has('preview')
    )
      location.assign(current.redirect);
  }, 5000);
  if (page === 'config.html' && user.role !== 'admin') {
    const save = $('#save');
    if (save) save.hidden = true;
    document.querySelectorAll('.page input,.page select').forEach((el) => (el.disabled = true));
    const h = document.querySelector('.page-head p');
    if (h) h.textContent = `Read-only view for ${user.username} · assigned Configuration page`;
    return user;
  }
  return user;
}
async function changeOwnPassword() {
  const current = $('#currentPassword').value,
    next = $('#nextPassword').value;
  const response = await fetch('/api/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current, password: next }),
  });
  if (!response.ok) {
    const err = await response.json();
    showToast(err.error || 'Could not change password');
    return;
  }
  $('#currentPassword').value = '';
  $('#nextPassword').value = '';
  showToast('Password changed');
}
async function checkConfigAssignment() {
  const response = await fetch('/api/session');
  if (!response.ok) return null;
  return response.json();
}

if (page === 'config.html') {
  setupTheme();
  setupPreviewResolution();
  $('#save').onclick = adminSaveSettings;
  $('#googleFontFamily').oninput = () => {
    state.googleFontFamily = $('#googleFontFamily').value;
    applyGoogleFont();
  };
  for (const key of ['logo', 'background', 'litImage', 'unlitImage', 'buttonImage']) {
    bindImageUpload(key + 'Upload', key);
    $('#' + key).oninput = () => syncImagePreview(key);
  }
  $('#logoSize').oninput = (e) => ($('#logoSizeValue').textContent = e.target.value + '%');
  $('#lampSize').oninput = (e) => ($('#lampSizeValue').textContent = e.target.value + '%');
  $('#litArtworkScale').oninput = (e) =>
    ($('#litArtworkScaleValue').textContent = e.target.value + '%');
  $('#unlitArtworkScale').oninput = (e) =>
    ($('#unlitArtworkScaleValue').textContent = e.target.value + '%');
  $('#matchLampArtwork').onchange = toggleArtworkScaleControls;
  $('#lampArtworkScale').oninput = (e) =>
    ($('#lampArtworkScaleValue').textContent = e.target.value + '%');
  $('#animationTime').oninput = (e) =>
    ($('#animationTimeValue').textContent = e.target.value + 's');
  $('#orbitRadius').oninput = (e) => ($('#orbitRadiusValue').textContent = e.target.value + '%');
  $('#resetOrbitRadius').onclick = async () => {
    $('#orbitRadius').value = 45;
    $('#orbitRadiusValue').textContent = '45%';
    await update({ orbitRadius: 45 });
    showToast('Orbit radius reset to default');
  };
  $('#buttonLogoSize').oninput = (e) =>
    ($('#buttonLogoSizeValue').textContent = e.target.value + '%');
  applySessionNavigation();
}
if (page === 'connection.html') {
  setupTheme();
  $('#createAccount').onclick = async () => {
    const username = $('#newAccountName').value,
      password = $('#newAccountPassword').value;
    const response = await fetch('/api/accounts/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      const err = await response.json();
      showToast(err.error || 'Could not create account');
      return;
    }
    $('#newAccountName').value = '';
    $('#newAccountPassword').value = '';
    showToast('Account created · waiting for page assignment');
    refreshAccounts();
  };
  $('#changePassword').onclick = changeOwnPassword;
  applySessionNavigation().then((user) => {
    if (user?.role === 'admin') refreshAccounts();
    else {
      $('#accountPanel').hidden = true;
      const title = document.querySelector('.page-head h1'),
        subtitle = document.querySelector('.page-head p');
      if (title) title.textContent = 'My connection';
      if (subtitle) subtitle.textContent = 'Change your password.';
    }
  });
}
if (page === 'live.html') {
  setupTheme();
  $('#reset').onclick = async () => {
    await update({ lit: [] });
    showToast('All lamps extinguished');
  };
  $('#refreshDevices')?.addEventListener('click', refreshDevices);
  refreshDevices();
  setInterval(refreshDevices, 5000);
  applySessionNavigation();
}
if (page === 'network.html') {
  setupTheme();
  refreshServerAddresses();
  $('#refreshDevices')?.addEventListener('click', refreshDevices);
  refreshDevices();
  setInterval(refreshDevices, 5000);
  applySessionNavigation();
}
if (page === 'lighting.html') {
  $('#lightButton').disabled = true;
  $('#lightButton').onclick = async () => {
    const button = $('#lightButton');
    button.classList.remove('lamp-click');
    void button.offsetWidth;
    button.classList.add('lamp-click');
    setTimeout(() => button.classList.remove('lamp-click'), 440);
    const response = await fetch('/api/light', { method: 'POST' }),
      result = await response.json();
    if (!response.ok) {
      $('#participantMessage').textContent = result.error || 'Could not light a lamp';
      return;
    }
    $('#participantMessage').textContent = `Thank you — lamp ${result.lamp} is now glowing.`;
  };
  const button = $('#lightingFullscreen'),
    text = $('#lightingFullscreenText');
  function fullscreenState() {
    const active = !!document.fullscreenElement;
    document.body.classList.toggle('fullscreen-mode', active);
    text.textContent = active ? 'Exit full screen' : 'Full screen';
  }
  button.onclick = async () => {
    try {
      document.fullscreenElement
        ? await document.exitFullscreen()
        : await document.documentElement.requestFullscreen();
    } catch {}
  };
  document.addEventListener('fullscreenchange', fullscreenState);
  fullscreenState();
  applySessionNavigation().then((user) => {
    if (!user) return;
    $('#lightButton').disabled = !(user.role === 'admin' || user.assignedPage === 'lighting');
    if (user.role !== 'admin' && user.assignedPage === 'lighting')
      $('#participantMessage').textContent = `Signed in as ${user.username}`;
  });
}
if (page === 'display.html') {
  function fullscreenState() {
    document.body.classList.toggle('fullscreen-mode', !!document.fullscreenElement);
  }
  $('#fullscreen').onclick = async () => {
    try {
      document.fullscreenElement
        ? await document.exitFullscreen()
        : await document.documentElement.requestFullscreen();
    } catch {}
  };
  document.addEventListener('fullscreenchange', fullscreenState);
  document.addEventListener('dblclick', () => $('#fullscreen').click());
  $('#displayLogout').onclick = async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.assign('/login.html');
  };
  fullscreenState();
  applySessionNavigation();
}

load();
const eventPage =
  page === 'config.html' ? 'config' : page === 'lighting.html' ? 'lighting' : 'display';
const events = new EventSource(`/api/events?page=${eventPage}`);
events.onmessage = (e) => {
  try {
    const next = { ...defaultState, ...JSON.parse(e.data) };
    if ($('#displayStage')) {
      const layoutKeys = [
        'count',
        'lampSize',
        'orbitRadius',
        'animateLamps',
        'animationTime',
        'litImage',
        'unlitImage',
        'litArtworkScale',
        'unlitArtworkScale',
        'matchLampArtwork',
      ];
      const stableLayout = layoutKeys.every(
        (key) => JSON.stringify(state[key]) === JSON.stringify(next[key]),
      );
      if (stableLayout) {
        const previousLit = state.lit || [];
        state = next;
        updateLampAppearances(previousLit, state.lit || []);
        syncDisplayOverlay();
        return;
      }
    }
    state = next;
    render();
  } catch {}
};
