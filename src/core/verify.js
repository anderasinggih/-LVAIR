import { ethers } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';

export function buildSignableMessage({ from, to, amount, token, type, nonce, timestamp }) {
  return [
    `LVAIR Protocol — Transaction Authorization`,
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

export function verifyEvmSignature(message, signature, expectedAddress) {
  try {
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === expectedAddress.toLowerCase();
  } catch {
    return false;
  }
}

export function verifySolanaSignature(message, signatureBytes, expectedAddress) {
  try {
    const pubkey = new PublicKey(expectedAddress);
    const msgBytes = new TextEncoder().encode(message);
    const sigUint8 = Uint8Array.from(signatureBytes);
    return nacl.sign.detached.verify(msgBytes, sigUint8, pubkey.toBytes());
  } catch {
    return false;
  }
}

export function verifySignature(message, signature, expectedAddress, chainType) {
  if (chainType === 'evm') {
    return verifyEvmSignature(message, signature, expectedAddress);
  }
  if (chainType === 'solana') {
    return verifySolanaSignature(message, signature, expectedAddress);
  }
  return false;
}
