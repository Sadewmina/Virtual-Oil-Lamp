// Set these paths directly in code to customize the site logo and browser tab icon.
const SITE_LOGO = 'assets/branding/Oil Lamp.png';
const SITE_FAVICON = '/assets/branding/Oil%20Lamp.ico?v=2';
const SITE_LOGO_SIZE = 100;

(function applySiteBrand() {
  if (SITE_LOGO) {
    document.querySelectorAll('.brand-mark').forEach((mark) => {
      const fallback = mark.textContent,
        image = document.createElement('img');
      image.className = 'brand-image';
      image.alt = '';
      image.onerror = () => mark.replaceChildren(document.createTextNode(fallback));
      mark.replaceChildren(image);
      image.src = SITE_LOGO;
    });
    document.querySelectorAll('.brand-image, .login-mark-image').forEach((image) => {
      image.src = SITE_LOGO;
      image.hidden = false;
      image.style.width = image.classList.contains('brand-image') ? 30 * SITE_LOGO_SIZE / 100 + 'px' : '48px';
      image.style.height = image.classList.contains('brand-image') ? 30 * SITE_LOGO_SIZE / 100 + 'px' : '48px';
    });
    document.querySelectorAll('.brand-mark-fallback, .login-mark-fallback').forEach((mark) => {
      mark.hidden = true;
    });
  }
  if (SITE_FAVICON) {
    let icon = document.querySelector('link[data-site-favicon]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      icon.dataset.siteFavicon = 'true';
      document.head.append(icon);
    }
    const cleanUrl = SITE_FAVICON.split('?')[0].toLowerCase();
    icon.type = cleanUrl.endsWith('.ico')
      ? 'image/x-icon'
      : cleanUrl.endsWith('.webp')
        ? 'image/webp'
        : cleanUrl.endsWith('.svg')
          ? 'image/svg+xml'
          : '';
    icon.href = SITE_FAVICON;
  }
})();
