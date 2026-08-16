import {
  statPrice,
  statPoolReserves,
  statAirBal,
  statUsdtBal,
  statBlockHeight,
  btnConnectWallet,
  btnExecuteSwap,
  airdropStatusText
} from './dom.js';

export const CONNECTED_WALLET_KEY = 'LVAIR_CONNECTED_WALLET_ADDR';
export const CONNECTED_PROVIDER_KEY = 'LVAIR_CONNECTED_WALLET_PROV';
export const ADMIN_AUTH_TOKEN_KEY = 'LVAIR_ADMIN_AUTH_TOKEN_V1';

// Protocol Owner Whitelist (Can be updated or signed via EIP-712 / Signature)
export const PROTOCOL_OWNER_CONFIG = {
  // First wallet that claims protocol ownership or configured admin address
  ownerAddress: localStorage.getItem('LVAIR_PROTOCOL_OWNER_ADDR') || null,
  isAdminAuthorized: false
};

export const AppState = {
  blockchain: null,
  ammPool: null,
  botEngine: null,
  currentConnectedAddress: null,
  currentConnectedProvider: null,
  currentInputToken: 'LVAIR'
};

export function updateUI() {
  const { blockchain, ammPool, currentConnectedAddress, currentConnectedProvider } = AppState;
  if (!ammPool || !blockchain) return;

  if (currentConnectedAddress) {
    if (btnConnectWallet) {
      btnConnectWallet.innerText = `${currentConnectedAddress.substring(0, 6)}...${currentConnectedAddress.substring(currentConnectedAddress.length - 4)}`;
      btnConnectWallet.title = `Connected via ${currentConnectedProvider} (Click to disconnect)`;
      btnConnectWallet.className = 'btn-secondary';
    }
    if (btnExecuteSwap) {
      btnExecuteSwap.innerText = 'Execute Swap';
    }
    if (airdropStatusText) {
      const hasClaimed = blockchain.claimedAddresses.has(currentConnectedAddress);
      airdropStatusText.innerText = hasClaimed ? 'Claimed (250 $LVAIR Allocated)' : 'Eligible for 250 $LVAIR Claim';
      airdropStatusText.style.color = hasClaimed ? 'var(--text-tertiary)' : 'var(--accent-success)';
    }
  } else {
    if (btnConnectWallet) {
      btnConnectWallet.innerText = 'Connect Wallet';
      btnConnectWallet.title = 'Click to connect your Web3 wallet';
      btnConnectWallet.className = 'btn-primary';
    }
    if (btnExecuteSwap) {
      btnExecuteSwap.innerText = 'Connect Wallet to Swap';
    }
    if (airdropStatusText) {
      airdropStatusText.innerText = 'Connect Wallet to Check Eligibility';
      airdropStatusText.style.color = 'var(--text-secondary)';
    }
  }

  const airPrice = ammPool.getCurrentPrice();
  if (statPrice) statPrice.innerText = `$${airPrice.toFixed(4)}`;
  if (statPoolReserves) statPoolReserves.innerText = `${Math.round(ammPool.lvairReserve).toLocaleString()} / $${Math.round(ammPool.usdtReserve).toLocaleString()}`;
  if (statBlockHeight) statBlockHeight.innerText = `#${blockchain.chain.length}`;

  const userAir = currentConnectedAddress ? blockchain.getBalanceOfAddress(currentConnectedAddress, 'LVAIR') : 0;
  const userUsdt = currentConnectedAddress ? blockchain.getBalanceOfAddress(currentConnectedAddress, 'USDT') : 0;

  if (statAirBal) statAirBal.innerText = `${userAir.toLocaleString()} LVAIR`;
  if (statUsdtBal) statUsdtBal.innerText = `$${userUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
