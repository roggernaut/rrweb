/**
 * Helper module to test getSetVisitorId in isolation
 */

export function getSetVisitorId() {
  const nameEQ = 'rrweb-cloud-visitor-id=';
  let value: string | null = null;
  if (document.cookie) {
    document.cookie.split(';').forEach((cp) => {
      if (cp.trim().startsWith(nameEQ)) {
        value = cp.trim().substring(nameEQ.length);
      }
    });
  }
  if (!value) {
    value = self.crypto.randomUUID();
    const date = new Date();
    date.setTime(date.getTime() + 366 * 86400000); // 1 year
    const expires = 'expires=' + date.toUTCString();

    // SameSite=Lax to cross subdomains
    const secure = window.location.protocol === 'https:' ? ';Secure' : '';
    // In jsdom/test environment, host might be localhost which doesn't support domain cookies
    const host = document.location?.host || 'localhost';
    const domain =
      host === 'localhost' ? '' : `;domain=${host.replace(/^www\./, '')}`;
    document.cookie = `${nameEQ}${value};${expires}${domain};path=/;SameSite=Lax${secure}`;
  }
  return value;
}
