import {
  heroBadge,
  heroHeadline,
  heroSubheadline,
  landingTotalSupply,
  landingPriceVal,
  landingReservesVal,
  landingHeightVal,
  dynamicValueProps,
  dynamicTokenomics,
  dynamicRoadmap,
  dynamicFaqs,
  btnLandingEnterApp,
  btnHeroTradeNow,
  btnHeroConnect,
  btnTerminalEnterApp,
  walletModal
} from '../dom.js';
import contentData from '../content.json';
import { AppState } from '../state.js';
import { navigateTo, ROUTES } from '../router.js';

export function renderLandingContent() {
  if (!contentData) return;

  if (heroBadge) heroBadge.innerText = contentData.project.badge;
  if (heroHeadline) heroHeadline.innerText = contentData.project.headline;
  if (heroSubheadline) heroSubheadline.innerText = contentData.project.subheadline;

  if (landingTotalSupply) landingTotalSupply.innerText = contentData.project.stats.totalSupply;
  if (landingPriceVal) landingPriceVal.innerText = contentData.project.stats.initialPrice;
  if (landingReservesVal) landingReservesVal.innerText = contentData.project.stats.initialLiquidity;
  if (landingHeightVal) landingHeightVal.innerText = contentData.project.stats.volume24h;

  if (dynamicValueProps) {
    dynamicValueProps.innerHTML = contentData.valueProps.map(item => `
      <div class="bento-card">
        <h3 class="bento-card-title">${item.title}</h3>
        <p class="bento-card-desc">${item.description}</p>
      </div>
    `).join('');
  }

  if (dynamicTokenomics) {
    dynamicTokenomics.innerHTML = contentData.tokenomics.map(item => `
      <div class="bento-card">
        <div style="font-size: 0.72rem; color: #60a5fa; text-transform: uppercase; font-weight: 700; margin-bottom: 6px;">${item.label}</div>
        <div style="font-size: 1.4rem; font-weight: 800; font-family: var(--font-mono); color: #ffffff; margin-bottom: 8px;">${item.value}</div>
        <p class="bento-card-desc">${item.description}</p>
      </div>
    `).join('');
  }

  if (dynamicRoadmap) {
    dynamicRoadmap.innerHTML = contentData.roadmap.map(item => `
      <div class="bento-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <span style="font-size: 0.72rem; color: var(--text-tertiary); font-weight: 700; text-transform: uppercase;">${item.phase}</span>
          <span class="badge ${item.status === 'completed' ? 'badge-success' : item.status === 'current' ? 'badge-neutral' : 'badge-neutral'}">
            ${item.status.toUpperCase()}
          </span>
        </div>
        <h3 class="bento-card-title">${item.title}</h3>
        <ul style="list-style: none; padding-left: 0; color: var(--text-secondary); font-size: 0.84rem; line-height: 1.8;">
          ${item.items.map(bullet => `<li>• ${bullet}</li>`).join('')}
        </ul>
      </div>
    `).join('');
  }

  if (dynamicFaqs) {
    dynamicFaqs.innerHTML = contentData.faqs.map(f => `
      <div class="panel">
        <h4 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 8px; color: #ffffff;">${f.question}</h4>
        <p style="color: var(--text-secondary); font-size: 0.85rem; line-height: 1.6;">${f.answer}</p>
      </div>
    `).join('');
  }
}

export function renderLandingStats() {
  const { ammPool } = AppState;
  if (!ammPool) return;
  if (landingPriceVal) landingPriceVal.innerText = `$${ammPool.getCurrentPrice().toFixed(4)}`;
  if (landingReservesVal) landingReservesVal.innerText = `${Math.round(ammPool.lvairReserve / 1000)}k / $${Math.round(ammPool.usdtReserve / 1000)}k`;
  if (landingHeightVal) landingHeightVal.innerText = `$${(ammPool.trades.length * 1420 + 25000).toLocaleString()}+`;
}

export function setupLandingPage() {
  renderLandingContent();

  if (btnLandingEnterApp) btnLandingEnterApp.addEventListener('click', () => navigateTo(ROUTES.SWAP));
  if (btnHeroTradeNow) btnHeroTradeNow.addEventListener('click', () => navigateTo(ROUTES.SWAP));
  if (btnTerminalEnterApp) btnTerminalEnterApp.addEventListener('click', () => navigateTo(ROUTES.SWAP));
  
  if (btnHeroConnect) {
    btnHeroConnect.addEventListener('click', () => {
      if (walletModal) walletModal.style.display = 'flex';
    });
  }
}
