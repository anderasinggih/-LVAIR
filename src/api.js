export function getApiBaseUrl() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3001';
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://127.0.0.1:3001';
  }
  return `${protocol}//${hostname}:3001`;
}
