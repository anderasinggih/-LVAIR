export function getApiBaseUrl() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3001';
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://127.0.0.1:3001';
  }
  return `${protocol}//${hostname}:3001`;
}

export async function rpcPost(path, body) {
  let res;
  try {
    res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  } catch (err) {
    throw new Error('Full-node offline. Jalankan `npm run node` lalu muat ulang halaman.');
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `RPC ${path} rejected`);
  }
  return res.json();
}
