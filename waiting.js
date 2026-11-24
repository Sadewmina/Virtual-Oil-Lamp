const copy = document.querySelector('#waitingCopy');
async function check() {
  try {
    const response = await fetch('/api/session');
    if (!response.ok) {
      location.assign('/login.html');
      return;
    }
    const user = await response.json();
    if (user.role === 'admin' || user.assignedPage) {
      location.assign(user.redirect);
      return;
    }
    copy.textContent = `Signed in as ${user.username}. The administrator will assign a page shortly.`;
  } catch {
    copy.textContent = 'Waiting for the Virtual Oil Lamp server to reconnect…';
  }
}
document.querySelector('#waitingLogout').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.assign('/login.html');
};
check();
setInterval(check, 2500);
