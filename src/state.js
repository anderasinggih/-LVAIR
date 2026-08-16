import {
  statPrice,
  statPoolReserves,
  statAirBal,
  statUsdtBal,
  statBlockHeight,
  btnExecuteSwap,
  airdropStatusText
} from './dom.js';

export const CONNECTED_WALLET_KEY = 'LVAIR_CONNECTED_WALLET_ADDR';
export const CONNECTED_PROVIDER_KEY = 'LVAIR_CONNECTED_WALLET_PROV';
export const ADMIN_AUTH_TOKEN_KEY = 'LVAIR_ADMIN_AUTH_TOKEN_V1';

export const PROTOCOL_OWNER_CONFIG = {
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
  
  const connectButtons = document.querySelectorAll('#btn-connect-wallet, #btn-hero-connect');
  connectButtons.forEach(btn => {
    if (currentConnectedAddress) {
      btn.innerText = `${currentConnectedAddress.substring(0, 6)}...${currentConnectedAddress.substring(currentConnectedAddress.length - 4)}`;
      btn.title = `Connected via ${currentConnectedProvider} (Click to disconnect)`;
      btn.className = 'btn-secondary';
    } else {
      btn.innerText = 'Connect Wallet';
      btn.title = 'Click to connect your Web3 wallet';
      btn.className = 'btn-primary';
    }
  });

  if (!ammPool || !blockchain) return;

  if (currentConnectedAddress) {
    if (btnExecuteSwap) btnExecuteSwap.innerText = 'Execute Swap';
    if (airdropStatusText) {
      const hasClaimed = blockchain.claimedAddresses.has(currentConnectedAddress);
      const quota = blockchain.airdropClaimAmount || 250;
      airdropStatusText.innerText = hasClaimed ? `Claimed (${quota} $LVAIR Allocated)` : `Eligible for ${quota} $LVAIR Claim`;
      airdropStatusText.style.color = hasClaimed ? 'var(--text-tertiary)' : 'var(--accent-success)';
    }
  } else {
    if (btnExecuteSwap) btnExecuteSwap.innerText = 'Connect Wallet to Swap';
    if (airdropStatusText) {
      airdropStatusText.innerText = 'Connect Wallet to Check Eligibility';
      airdropStatusText.style.color = 'var(--text-secondary)';
    }
  }

  const btnClaimAirdrop = document.getElementById('btn-claim-airdrop');
  const airdropHeaderBadge = document.getElementById('airdrop-header-badge');
  const airdropHeaderDesc = document.getElementById('airdrop-header-desc');
  const quota = blockchain.airdropClaimAmount || 250;

  if (btnClaimAirdrop && !btnClaimAirdrop.disabled) {
    btnClaimAirdrop.innerText = `Claim ${quota} $LVAIR Airdrop`;
  }
  if (airdropHeaderBadge) airdropHeaderBadge.innerText = `${quota} $LVAIR Free`;
  if (airdropHeaderDesc) airdropHeaderDesc.innerText = `Claim the initial token allocation for your connected wallet. Each unique address is eligible for ${quota} $LVAIR.`;

  const airPrice = ammPool.getCurrentPrice();
  if (statPrice) statPrice.innerText = `$${airPrice.toFixed(4)}`;
  if (statPoolReserves) statPoolReserves.innerText = `${Math.round(ammPool.lvairReserve).toLocaleString()} / $${Math.round(ammPool.usdtReserve).toLocaleString()}`;
  if (statBlockHeight) statBlockHeight.innerText = `#${blockchain.chain.length}`;

  const userAir = currentConnectedAddress ? blockchain.getBalanceOfAddress(currentConnectedAddress, 'LVAIR') : 0;
  const userUsdt = currentConnectedAddress ? blockchain.getBalanceOfAddress(currentConnectedAddress, 'USDT') : 0;

  if (statAirBal) statAirBal.innerText = `${userAir.toLocaleString()} LVAIR`;
  if (statUsdtBal) statUsdtBal.innerText = `$${userUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
