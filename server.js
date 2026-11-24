const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = __dirname,
  SETTINGS = path.join(ROOT, 'data.json'),
  ACCOUNTS = path.join(ROOT, 'accounts.json');
const PORT = Number(process.env.PORT || 4173);
const sessions = new Map(),
  clients = new Set(),
  devices = new Map(),
  loginFailures = new Map();
const defaults = {
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
  updatedAt: Date.now(),
};
function getWifiNetworkName() {
  try {
    const output = execFileSync('netsh', ['wlan', 'show', 'interfaces'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return (
      [...output.matchAll(/^\s*SSID\s*:\s*(.*?)\s*$/gim)]
        .map((match) => match[1].trim())
        .find((name) => name && !/^n\/?a$/i.test(name)) || ''
    );
  } catch {
    return '';
  }
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
let state = { ...defaults, ...readJson(SETTINGS, {}) };
state.instanceId = crypto.randomUUID();
let accounts = readJson(ACCOUNTS, {});
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function verifyPassword(password, account) {
  try {
    const candidate = Buffer.from(
        crypto.scryptSync(password, account.salt, 64).toString('hex'),
        'hex',
      ),
      expected = Buffer.from(account.hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}
function saveAccounts() {
  fs.writeFileSync(ACCOUNTS, JSON.stringify(accounts, null, 2));
}
function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 32);
}
function safeColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
function pageName(page) {
  return (
    { config: 'Configuration', lighting: 'Lighting', display: 'Display' }[page] ||
    'Waiting for assignment'
  );
}
function pagePath(page) {
  return (
    { config: '/config.html', lighting: '/lighting.html', display: '/display.html' }[page] ||
    '/waiting.html'
  );
}
if (!Object.keys(accounts).length) {
  const seeded = hashPassword(process.env.OIL_LAMP_ADMIN_PASSWORD || 'LampAdmin123!');
  accounts.admin = {
    username: 'admin',
    role: 'admin',
    assignedPage: null,
    salt: seeded.salt,
    hash: seeded.hash,
    mustChangePassword: !process.env.OIL_LAMP_ADMIN_PASSWORD,
  };
  saveAccounts();
}
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
};
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req, done) {
  let raw = '';
  req.on('data', (d) => {
    raw += d;
    if (raw.length > 12000000) req.destroy();
  });
  req.on('end', () => {
    try {
      done(JSON.parse(raw || '{}'));
    } catch {
      done(null);
    }
  });
}
function cookie(req) {
  return (req.headers.cookie || '')
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('lamp_session='))
    ?.slice(13);
}
function accountFor(req) {
  const session = sessionFor(req);
  return session ? accounts[session.username] || null : null;
}
function sessionFor(req) {
  const session = sessions.get(cookie(req));
  if (!session || !accounts[session.username]) return null;
  const device = session.deviceId && devices.get(session.deviceId);
  return device?.blocked ? null : session;
}
function isAdmin(req) {
  return accountFor(req)?.role === 'admin';
}
function isLoopback(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function saveState() {
  state.updatedAt = Date.now();
  fs.writeFileSync(SETTINGS, JSON.stringify(state, null, 2));
  broadcast();
}
function broadcast() {
  const packet = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) {
    if (accessPage(client.req, client.page)) client.res.write(packet);
    else {
      client.res.end();
      clients.delete(client);
    }
  }
}
function ipAddress(req) {
  const ip = req.socket.remoteAddress || 'Unknown';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
function accessPage(req, page) {
  if (page === 'display' && isLoopback(req)) return true;
  const acct = accountFor(req);
  return (
    !!acct &&
    (acct.role === 'admin' ||
      acct.assignedPage === page ||
      page === 'connection' ||
      (acct.assignedPage === 'config' && ['lighting', 'display'].includes(page)))
  );
}
function loginRedirect(req) {
  const acct = accountFor(req);
  return acct
    ? acct.role === 'admin'
      ? '/live.html'
      : pagePath(acct.assignedPage)
    : '/login.html';
}
function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  send(res, 403, { error: 'Administrator sign-in required' });
  return false;
}
function deviceList() {
  const now = Date.now();
  return [...devices.values()]
    .map((d) => ({
      ...d,
      accountUsername: d.username,
      assignedPage:
        accounts[d.username]?.role === 'admin'
          ? 'All pages'
          : accounts[d.username]?.assignedPage || null,
      online: !d.blocked && now - d.lastSeen < 15000,
    }))
    .sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
}
function attachDevice(req, acct, data) {
  const id = String(data.deviceId || '').slice(0, 120);
  if (id.length < 8) return null;
  const old = devices.get(id);
  if (old?.blocked) return null;
  const device = {
    id,
    username: acct.username,
    name:
      String(old?.username === acct.username ? old.name : data.deviceName || '')
        .trim()
        .slice(0, 48) || acct.username,
    ipAddress: ipAddress(req),
    lastSeen: Date.now(),
    blocked: false,
  };
  devices.set(id, device);
  return device;
}
function updateDevicePing(req) {
  const session = sessionFor(req);
  if (!session?.deviceId) return;
  const d = devices.get(session.deviceId);
  if (d) {
    d.lastSeen = Date.now();
    d.ipAddress = ipAddress(req);
  }
}
function setSession(req, res, username, deviceId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, deviceId });
  res.setHeader('Set-Cookie', `lamp_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (url.pathname === '/api/boot' && req.method === 'GET') {
    const wifiName = getWifiNetworkName();
    const serverAddresses = Object.entries(os.networkInterfaces()).flatMap(
      ([interfaceName, infos]) =>
        (infos || [])
          .filter(
            (info) =>
              info &&
              !info.internal &&
              (info.family === 'IPv4' || info.family === 4) &&
              !info.address.startsWith('169.254.'),
          )
          .map((info) => ({
            interfaceName,
            networkName: /wi-?fi|wlan/i.test(interfaceName) && wifiName ? wifiName : interfaceName,
            ssid: /wi-?fi|wlan/i.test(interfaceName) ? wifiName : '',
            url: 'http://' + info.address + ':' + PORT,
          })),
    );
    return send(res, 200, {
      instanceId: state.instanceId,
      showDefaultLogin: !!accounts.admin?.mustChangePassword,
      siteName: 'Virtual Oil Lamp v1.0 by Dewlabs',
      brandLogo: state.brandLogo || '',
      brandLogoSize: state.brandLogoSize || 100,
      serverPort: PORT,
      serverAddresses,
    });
  }
  if (url.pathname === '/api/signup' && req.method === 'POST')
    return readBody(req, (data) => {
      if (!data) return send(res, 400, { error: 'Invalid sign-up details' });
      const username = normalizeUsername(data.username),
        password = String(data.password || '');
      if (username.length < 3)
        return send(res, 400, { error: 'Username must be at least 3 characters' });
      if (password.length < 8)
        return send(res, 400, { error: 'Password must be at least 8 characters' });
      if (accounts[username]) return send(res, 409, { error: 'That username is already in use' });
      const hash = hashPassword(password);
      accounts[username] = {
        username,
        role: 'user',
        assignedPage: null,
        salt: hash.salt,
        hash: hash.hash,
      };
      saveAccounts();
      const device = attachDevice(req, accounts[username], data);
      if (!device) {
        delete accounts[username];
        saveAccounts();
        return send(res, 403, {
          error:
            'This device was terminated. Ask the administrator to restore it or use another device.',
        });
      }
      setSession(req, res, username, device.id);
      return send(res, 200, { ok: true, redirect: '/waiting.html' });
    });
  if (url.pathname === '/api/login' && req.method === 'POST')
    return readBody(req, (data) => {
      if (!data) return send(res, 400, { error: 'Invalid sign-in details' });
      const username = normalizeUsername(data.username),
        acct = accounts[username];
      const ip = ipAddress(req),
        now = Date.now(),
        attempts = loginFailures.get(ip) || { count: 0, until: 0 };
      if (attempts.until > now)
        return send(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
      if (!acct || !verifyPassword(String(data.password || ''), acct)) {
        attempts.count++;
        if (attempts.count >= 8) {
          attempts.count = 0;
          attempts.until = now + 60000;
        }
        loginFailures.set(ip, attempts);
        return send(res, 401, { error: 'Username or password is incorrect' });
      }
      loginFailures.delete(ip);
      const device = attachDevice(req, acct, data);
      if (!device)
        return send(res, 403, {
          error:
            'This device was terminated. Ask the administrator to restore it or use another device.',
        });
      setSession(req, res, username, device.id);
      return send(res, 200, {
        ok: true,
        redirect: acct.role === 'admin' ? '/live.html' : pagePath(acct.assignedPage),
      });
    });
  if (url.pathname === '/api/session' && req.method === 'GET') {
    const acct = accountFor(req);
    if (!acct) return send(res, 401, { authenticated: false });
    updateDevicePing(req);
    return send(res, 200, {
      authenticated: true,
      username: acct.username,
      role: acct.role,
      assignedPage: acct.assignedPage,
      redirect: acct.role === 'admin' ? '/live.html' : pagePath(acct.assignedPage),
    });
  }
  if (url.pathname === '/api/device/ping' && req.method === 'POST') {
    const acct = accountFor(req);
    if (!acct) return send(res, 401, { error: 'Sign in first' });
    updateDevicePing(req);
    return send(res, 200, { assignedPage: acct.assignedPage, role: acct.role });
  }
  if (url.pathname === '/api/device/terminate' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (data) => {
      const d = devices.get(String(data?.id || ''));
      if (!d) return send(res, 404, { error: 'Device not found' });
      d.blocked = true;
      d.lastSeen = 0;
      return send(res, 200, { ok: true });
    });
  }
  if (url.pathname === '/api/device/restore' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (data) => {
      const d = devices.get(String(data?.id || ''));
      if (!d) return send(res, 404, { error: 'Device not found' });
      d.blocked = false;
      d.lastSeen = 0;
      return send(res, 200, { ok: true });
    });
  }
  if (url.pathname === '/api/logout') {
    sessions.delete(cookie(req));
    return send(res, 200, { ok: true }, 'application/json; charset=utf-8', {
      'Set-Cookie': 'lamp_session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/',
    });
  }
  if (url.pathname === '/api/state' && req.method === 'GET') {
    if (!accessPage(req, 'config') && !accessPage(req, 'lighting') && !accessPage(req, 'display'))
      return send(res, 401, { error: 'Sign in and use your assigned page' });
    updateDevicePing(req);
    return send(res, 200, state);
  }
  if (url.pathname === '/api/state' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (next) => {
      if (!next) return send(res, 400, { error: 'Invalid settings' });
      const count = Math.max(1, Math.min(120, Number(next.count) || state.count));
      state = {
        ...state,
        ...next,
        count,
        brandLogo: typeof next.brandLogo === 'string' ? next.brandLogo.slice(0, 2000) : state.brandLogo,
        brandLogoSize: Math.max(50, Math.min(200, Number(next.brandLogoSize) || state.brandLogoSize || 100)),
        logoSize: Math.max(25, Math.min(500, Number(next.logoSize) || state.logoSize)),
        lampSize: Math.max(25, Math.min(300, Number(next.lampSize) || state.lampSize)),
        litArtworkScale: Math.max(
          50,
          Math.min(300, Number(next.litArtworkScale) || state.litArtworkScale),
        ),
        unlitArtworkScale: Math.max(
          50,
          Math.min(300, Number(next.unlitArtworkScale) || state.unlitArtworkScale),
        ),
        matchLampArtwork: next.matchLampArtwork !== false,
        lampArtworkScale: Math.max(
          50,
          Math.min(300, Number(next.lampArtworkScale) || state.lampArtworkScale),
        ),
        animateLamps: next.animateLamps === true,
        animationTime: Math.max(
          2,
          Math.min(300, Number(next.animationTime) || state.animationTime),
        ),
        orbitRadius: Math.max(10, Math.min(49, Number(next.orbitRadius) || state.orbitRadius)),
        buttonLogoSize: Math.max(
          25,
          Math.min(500, Number(next.buttonLogoSize) || state.buttonLogoSize),
        ),
        accentColor: safeColor(next.accentColor, state.accentColor),
        eventBackground: safeColor(next.eventBackground, state.eventBackground),
        flameColor: safeColor(next.flameColor, state.flameColor),
        googleFontFamily:
          String(next.googleFontFamily || state.googleFontFamily || 'Inter')
            .replace(/[^a-zA-Z0-9 -]/g, '')
            .trim()
            .slice(0, 80) || 'Inter',
        titleFont: ['tech', 'elegant', 'classic', 'mono'].includes(next.titleFont)
          ? next.titleFont
          : state.titleFont,
        lit: Array.isArray(next.lit)
          ? next.lit.filter((n) => Number.isInteger(n) && n >= 0 && n < count)
          : state.lit.filter((n) => n < count),
      };
      saveState();
      return send(res, 200, state);
    });
  }
  if (url.pathname === '/api/events' && req.method === 'GET') {
    const eventPage = url.searchParams.get('page');
    if (!['config', 'lighting', 'display'].includes(eventPage) || !accessPage(req, eventPage))
      return send(res, 401, { error: 'Sign in to view your assigned page' });
    updateDevicePing(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    const client = { res, req, page: eventPage };
    clients.add(client);
    req.on('close', () => clients.delete(client));
    return;
  }
  if (url.pathname === '/api/light' && req.method === 'POST') {
    const acct = accountFor(req);
    if (!acct || !(acct.role === 'admin' || acct.assignedPage === 'lighting'))
      return send(res, 403, { error: 'This account is not assigned to the Lighting page' });
    updateDevicePing(req);
    let lamp = 0;
    while (lamp < state.count && state.lit.includes(lamp)) lamp++;
    if (lamp >= state.count) return send(res, 409, { error: 'Every lamp is already lit' });
    state.lit = [...state.lit, lamp];
    saveState();
    return send(res, 200, { lamp: lamp + 1, state });
  }
  if (url.pathname === '/api/devices' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return send(res, 200, deviceList());
  }
  if (url.pathname === '/api/upload' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (data) => {
      if (!data || typeof data.base64 !== 'string')
        return send(res, 400, { error: 'Choose an image to upload' });
      const types = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/avif': '.avif',
        'image/svg+xml': '.svg',
      };
      const extension = types[String(data.mime || '').toLowerCase()];
      if (!extension)
        return send(res, 415, { error: 'Use PNG, JPG, WebP, GIF, AVIF, or SVG images' });
      let bytes = Buffer.from(data.base64, 'base64');
      if (!bytes.length || bytes.length > 8 * 1024 * 1024)
        return send(res, 413, { error: 'Image must be smaller than 8 MB' });
      if (extension === '.svg') {
        let svg = bytes.toString('utf8');
        if (!/<svg(?:\s|>)/i.test(svg))
          return send(res, 400, { error: 'That SVG file is invalid' });
        svg = svg
          .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
          .replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, '')
          .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
          .replace(
            /(?:href|xlink:href)\s*=\s*(["'])\s*(?:javascript:|https?:|data:text\/html)[\s\S]*?\1/gi,
            '',
          );
        bytes = Buffer.from(svg, 'utf8');
      }
      const folder = path.join(ROOT, 'assets', 'uploads');
      fs.mkdirSync(folder, { recursive: true });
      const filename = crypto.randomUUID() + extension;
      fs.writeFileSync(path.join(folder, filename), bytes);
      return send(res, 200, {
        url: '/assets/uploads/' + filename,
        name: String(data.name || filename).slice(0, 120),
      });
    });
  }
  if (url.pathname === '/api/accounts' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return send(
      res,
      200,
      Object.values(accounts)
        .map((a) => ({ username: a.username, role: a.role, assignedPage: a.assignedPage }))
        .sort((a, b) => a.username.localeCompare(b.username)),
    );
  }
  if (url.pathname === '/api/accounts/create' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (data) => {
      const username = normalizeUsername(data?.username),
        password = String(data?.password || '');
      if (username.length < 3 || password.length < 8)
        return send(res, 400, {
          error: 'Use a username with 3+ characters and password with 8+ characters',
        });
      if (accounts[username]) return send(res, 409, { error: 'That username is already in use' });
      const hash = hashPassword(password);
      accounts[username] = {
        username,
        role: 'user',
        assignedPage: null,
        salt: hash.salt,
        hash: hash.hash,
      };
      saveAccounts();
      return send(res, 200, { ok: true });
    });
  }
  if (url.pathname === '/api/accounts/assign' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (data) => {
      const username = normalizeUsername(data?.username),
        acct = accounts[username],
        page = data?.assignedPage ?? null;
      if (!acct || acct.role === 'admin')
        return send(res, 404, { error: 'User account not found' });
      if (page !== null && !['config', 'lighting', 'display'].includes(page))
        return send(res, 400, { error: 'Choose a valid page' });
      acct.assignedPage = page;
      saveAccounts();
      return send(res, 200, { ok: true });
    });
  }
  if (url.pathname === '/api/accounts/remove' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (data) => {
      const username = normalizeUsername(data?.username),
        acct = accounts[username];
      if (!acct || acct.role === 'admin')
        return send(res, 404, { error: 'User account not found' });
      delete accounts[username];
      saveAccounts();
      for (const [token, session] of sessions)
        if (session.username === username) sessions.delete(token);
      for (const [id, d] of devices) if (d.username === username) devices.delete(id);
      return send(res, 200, { ok: true });
    });
  }
  if (url.pathname === '/api/accounts/rename' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (data) => {
      const oldName = normalizeUsername(data?.username),
        newName = normalizeUsername(data?.newUsername),
        acct = accounts[oldName];
      if (!acct || acct.role === 'admin')
        return send(res, 404, { error: 'User account not found' });
      if (newName.length < 3)
        return send(res, 400, { error: 'Username must be at least 3 characters' });
      if (accounts[newName]) return send(res, 409, { error: 'That username is already in use' });
      delete accounts[oldName];
      acct.username = newName;
      accounts[newName] = acct;
      for (const s of sessions.values()) if (s.username === oldName) s.username = newName;
      for (const d of devices.values()) if (d.username === oldName) d.username = newName;
      saveAccounts();
      return send(res, 200, { ok: true });
    });
  }
  if (url.pathname === '/api/accounts/password' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (data) => {
      const username = normalizeUsername(data?.username),
        acct = accounts[username],
        password = String(data?.password || '');
      if (!acct) return send(res, 404, { error: 'Account not found' });
      if (password.length < 8)
        return send(res, 400, { error: 'Password must be at least 8 characters' });
      const hash = hashPassword(password);
      acct.salt = hash.salt;
      acct.hash = hash.hash;
      acct.mustChangePassword = false;
      saveAccounts();
      return send(res, 200, { ok: true });
    });
  }
  if (url.pathname === '/api/password' && req.method === 'POST') {
    const acct = accountFor(req);
    if (!acct) return send(res, 401, { error: 'Sign in first' });
    return readBody(req, (data) => {
      if (!verifyPassword(String(data?.current || ''), acct))
        return send(res, 401, { error: 'Current password is incorrect' });
      const password = String(data?.password || '');
      if (password.length < 8)
        return send(res, 400, { error: 'New password must be at least 8 characters' });
      const hash = hashPassword(password);
      acct.salt = hash.salt;
      acct.hash = hash.hash;
      acct.mustChangePassword = false;
      saveAccounts();
      return send(res, 200, { ok: true });
    });
  }
  if (url.pathname === '/api/device/rename' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    return readBody(req, (data) => {
      const device = devices.get(String(data?.id || ''));
      if (!device) return send(res, 404, { error: 'Device not found' });
      device.name =
        String(data.name || '')
          .trim()
          .slice(0, 48) || device.username;
      return send(res, 200, { ok: true });
    });
  }

  const requestedPage = {
    '/config.html': 'config',
    '/lighting.html': 'lighting',
    '/display.html': 'display',
    '/live.html': 'admin',
    '/connection.html': 'connection',
    '/network.html': 'admin',
  }[url.pathname];
  if (requestedPage && !accessPage(req, requestedPage)) {
    const acct = accountFor(req),
      previewAccess =
        url.searchParams.get('preview') === '1' &&
        acct?.assignedPage === 'config' &&
        ['lighting', 'display'].includes(requestedPage);
    if (previewAccess) {
    } else if (!acct)
      return send(res, 302, '', 'text/plain; charset=utf-8', {
        Location: `/login.html?next=${encodeURIComponent(url.pathname)}`,
      });
    else
      return send(res, 302, '', 'text/plain; charset=utf-8', {
        Location: acct.role === 'admin' ? '/live.html' : pagePath(acct.assignedPage),
      });
  }
  if (url.pathname === '/index.html') {
    const acct = accountFor(req);
    return send(res, 302, '', 'text/plain; charset=utf-8', {
      Location: !acct
        ? '/login.html'
        : acct.role === 'admin'
          ? '/live.html'
          : pagePath(acct.assignedPage),
    });
  }
  if (url.pathname === '/waiting.html') {
    const acct = accountFor(req);
    if (!acct) return send(res, 302, '', 'text/plain; charset=utf-8', { Location: '/login.html' });
    if (acct.role === 'admin')
      return send(res, 302, '', 'text/plain; charset=utf-8', { Location: '/config.html' });
    if (acct.assignedPage)
      return send(res, 302, '', 'text/plain; charset=utf-8', {
        Location: pagePath(acct.assignedPage),
      });
  }
  if (url.pathname === '/') {
    const acct = accountFor(req);
    if (!acct) return send(res, 302, '', 'text/plain; charset=utf-8', { Location: '/login.html' });
    return send(res, 302, '', 'text/plain; charset=utf-8', {
      Location: acct.role === 'admin' ? '/live.html' : pagePath(acct.assignedPage),
    });
  }
  let file;
  try {
    file = path.resolve(
      ROOT,
      url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)),
    );
  } catch {
    return send(res, 400, 'Bad path', 'text/plain');
  }
  const relative = path.relative(ROOT, file);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    return send(res, 403, 'Forbidden', 'text/plain');
  if (
    ['accounts.json', 'data.json', 'server.js', 'devices.json'].includes(
      path.basename(file).toLowerCase(),
    )
  )
    return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const ext = path.extname(file).toLowerCase(),
      headers = {
        'Content-Type': mime[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      };
    if (ext === '.svg')
      headers['Content-Security-Policy'] =
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";
    res.writeHead(200, headers);
    res.end(buf);
  });
});
server.listen(PORT, '0.0.0.0', () =>
  console.log(
    `Virtual Oil Lamp v1.0 by Dewlabs at http://localhost:${PORT}. Administrator username: ${accounts.admin?.username || 'admin'}.`,
  ),
);
