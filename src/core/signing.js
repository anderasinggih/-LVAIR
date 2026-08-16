const CHAIN_DOMAIN = 'LVAIR Protocol';

export function buildSignableMessage({ from, to, amount, token, type, nonce, timestamp }) {
  return [
    `${CHAIN_DOMAIN} — Transaction Authorization`,
    ``,
    `Chain: lvair-mainnet`,
    `From: ${from}`,
    `To: ${to}`,
    `Amount: ${amount} ${token}`,
    `Type: ${type}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
  ].join('\n');
}

export async function signWithEvmWallet(window, message) {
  const eth = window.ethereum;
  if (!eth) throw new Error('No EVM wallet provider found');
  const accounts = await eth.request({ method: 'eth_accounts' });
  if (!accounts || !accounts.length) throw new Error('EVM wallet not connected');
  const from = accounts[0];
  const signature = await eth.request({ method: 'personal_sign', params: [message, from] });
  return { signature, address: from, chainType: 'evm' };
}

export async function signWithPhantom(message) {
  const phantom = window.phantom?.solana || window.solana;
  if (!phantom) throw new Error('No Phantom wallet found');
  const encoded = new TextEncoder().encode(message);
  const signed = await phantom.signMessage(encoded, 'utf8');
  const pubkey = phantom.publicKey?.toString();
  const signature = Array.from(signed.signature);
  return { signature, address: pubkey, chainType: 'solana' };
}
