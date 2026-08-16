export function getApiBaseUrl() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3001';
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://127.0.0.1:3001';
  }
  return '';
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
    const raw = await res.text().catch(() => '');
    let detail = '';
    try {
      const j = JSON.parse(raw);
      detail = j.error || j.message || '';
    } catch (e) {}
    if (detail) throw new Error(detail);
    throw new Error(`RPC ${path} failed (HTTP ${res.status}). ${raw.slice(0, 160) || 'Empty response'}`);
  }
  return res.json();
}
