import { buildSignableMessage, signWithEvmWallet, signWithPhantom } from './core/signing.js';
import { AppState } from './state.js';

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
    throw new Error('Node offline. Start the full node and reload the page.');
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

export async function rpcGet(path) {
  let res;
  try {
    res = await fetch(`${getApiBaseUrl()}${path}`);
  } catch (err) {
    throw new Error('Node offline.');
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    let detail = '';
    try {
      const j = JSON.parse(raw);
      detail = j.error || j.message || '';
    } catch (e) {}
    if (detail) throw new Error(detail);
    throw new Error(`RPC ${path} failed (HTTP ${res.status})`);
  }
  return res.json();
}

async function signTransaction(txData) {
  const provider = AppState.currentConnectedProvider;
  const address = AppState.currentConnectedAddress;
  if (!provider || !address) return null;

  try {
    const nonceRes = await rpcGet(`/api/balance/${address}`);
    const nonce = nonceRes.nonce || 0;
    const message = buildSignableMessage({ ...txData, nonce });
    if (provider === 'Phantom') {
      return { ...(await signWithPhantom(message)), nonce };
    }
    return { ...(await signWithEvmWallet(window, message)), nonce };
  } catch (err) {
    console.warn('Signing failed:', err.message);
    return null;
  }
}

export async function rpcPostSigned(path, body) {
  const { from, to, amount, token, type } = body;
  let signatureData = null;

  if (from && AppState.currentConnectedAddress) {
    signatureData = await signTransaction({
      from, to, amount, token, type,
      timestamp: Date.now()
    });
  }

  return rpcPost(path, { ...body, signature: signatureData });
}

export function getAdminToken() {
  return localStorage.getItem('LVAIR_ADMIN_AUTH_TOKEN_V1') || '';
}

export async function rpcAdminPost(path, body) {
  const token = getAdminToken();
  let res;
  try {
    res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(body || {})
    });
  } catch (err) {
    throw new Error('Node offline.');
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    let detail = '';
    try {
      const j = JSON.parse(raw);
      detail = j.error || j.message || '';
    } catch (e) {}
    if (detail) throw new Error(detail);
    throw new Error(`RPC ${path} failed (HTTP ${res.status})`);
  }
  return res.json();
}
