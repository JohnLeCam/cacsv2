// ============================================================
//  MAIN.JS — Cac's GTA V Mods
//  Gère : chargement catalogue, promos, compte à rebours, auth Discord
// ============================================================

// Données chargées depuis le serveur
let siteData   = null;  // données publiques (mods, promos, config)
let userData   = null;  // données utilisateur connecté (discount, rôle)
let activeFilter = 'all';

// ─── Initialisation ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupNavbarScroll();
  setupScrollAnimations();
  await loadAll();
});

// Charger toutes les données en parallèle
async function loadAll() {
  try {
    const [pub, user] = await Promise.all([
      fetch('/api/public').then(r => r.json()),
      fetch('/api/user').then(r => r.json())
    ]);

    siteData = pub;
    userData = user;

    // Appliquer les données
    applySiteConfig();
    renderNavAuth();
    renderPromos();
    renderCategoryFilters();
    renderMods();

  } catch (err) {
    console.error('Erreur chargement données:', err);
  }
}

// ─── Config du site ──────────────────────────────────────────
function applySiteConfig() {
  if (!siteData?.site) return;
  const s = siteData.site;

  // Titre de la page
  document.title = s.title || "Cac's GTA V Mods";

  // Hero
  const badge = document.getElementById('heroBadge');
  if (badge && s.heroTagline) badge.textContent = s.heroTagline;

  const subtitle = document.getElementById('heroSubtitle');
  if (subtitle && s.subtitle) subtitle.textContent = s.subtitle;

  // Bouton Discord
  const links = document.querySelectorAll('[id="discordCta"], #heroDiscordBtn');
  links.forEach(el => {
    if (s.discordUrl) el.href = s.discordUrl;
  });

  // Annonce
  if (s.announcement && s.announcement.trim() !== '') {
    const banner = document.getElementById('announcement');
    const text   = document.getElementById('announceText');
    if (banner && text) {
      text.textContent = s.announcement;
      banner.style.display = 'flex';
    }
  }
}

// ─── Navbar Auth ─────────────────────────────────────────────
function renderNavAuth() {
  const navAuth = document.getElementById('navAuth');
  if (!navAuth) return;

  if (userData?.connected) {
    // Utilisateur connecté → afficher profil + badge rôle
    const roleHTML = userData.roleName
      ? `<span class="user-role-tag" style="${userData.roleColor ? `color:${userData.roleColor};border-color:${userData.roleColor}60` : ''}">
           ${userData.roleName} -${userData.discount}%
         </span>`
      : '';

    navAuth.innerHTML = `
      <div class="user-badge">
        <img class="user-avatar" src="${userData.avatar}" alt="Avatar" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
        <span class="user-name">${escapeHtml(userData.username)}</span>
        ${roleHTML}
        <button class="btn-logout" onclick="logoutDiscord()">Déco.</button>
      </div>
    `;
  } else {
    // Non connecté → bouton connexion Discord
    navAuth.innerHTML = `
      <button class="btn-discord-nav" onclick="loginDiscord()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.082.112 18.105.131 18.12a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
        </svg>
        Connexion Discord
      </button>
    `;
  }
}

// ─── Promotions ───────────────────────────────────────────────
function renderPromos() {
  const banner = document.getElementById('promoBanner');
  const track  = document.getElementById('promoBannerTrack');
  if (!banner || !track) return;

  const promos = siteData?.promotions || [];

  if (promos.length === 0) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'block';

  function buildItems() {
    return promos.map(promo => {
      const cdId = 'bcd-' + promo.id;
      return `
        <div class="promo-banner-item">
          <span class="promo-banner-tag">-${promo.discountPercent}%</span>
          <span>${escapeHtml(promo.name)}</span>
          <span class="promo-banner-countdown" id="${cdId}">...</span>
        </div>
        <span class="promo-banner-sep">✦</span>`;
    }).join('');
  }

  // Répéter suffisamment pour remplir n'importe quelle largeur d'écran
  const items = buildItems();

  // Calculer combien d'exemplaires on a besoin pour remplir l'écran
  // On met d'abord une copie pour mesurer, puis on duplique suffisamment
  track.innerHTML = items;

  // Attendre que le DOM soit rendu pour mesurer
  requestAnimationFrame(() => {
    const trackW   = track.scrollWidth;
    const bannerW  = banner.offsetWidth;

    if (trackW < bannerW) {
      // Contenu plus court que l'écran : on répète assez de fois pour couvrir
      const copies = Math.ceil((bannerW * 3) / trackW) + 1;
      let repeated = '';
      for (let i = 0; i < copies; i++) repeated += items;
      track.innerHTML = repeated;
    } else {
      // Contenu assez large : doubler pour le défilement infini sans saut
      track.innerHTML = items + items;
    }
  });

  promos.forEach(promo => startBannerCountdown(promo.id, promo.endDate));
}

function startBannerCountdown(promoId, endDateStr) {
  const endDate = new Date(endDateStr);
  const elId    = 'bcd-' + promoId;
  function update() {
    const els  = document.querySelectorAll(`[id="${elId}"]`);
    const diff = endDate - new Date();
    if (diff <= 0) { els.forEach(el => el.textContent = 'Expirée'); return; }
    const j = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const pad = n => String(n).padStart(2, '0');
    const txt = j > 0 ? `${j}j ${pad(h)}h ${pad(m)}m` : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    els.forEach(el => el.textContent = txt);
  }
  update();
  setInterval(update, 1000);
}

// (startCountdown remplacé par startBannerCountdown)

// ─── Filtres Catégories ──────────────────────────────────────
function renderCategoryFilters() {
  const container = document.getElementById('categoryFilters');
  if (!container || !siteData?.categories) return;

  siteData.categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'filter-btn';
    // Compatibilité : cat peut être un objet {id, name, color, icon} ou une simple chaîne
    const catId   = cat.id   || cat;
    const catName = cat.name || cat;
    const catIcon = cat.icon || '';
    const catColor = cat.color || null;

    btn.dataset.cat = catId;
    btn.innerHTML = `${catIcon} ${catName}`;

    // Coloriser le bouton actif avec la couleur de la catégorie
    if (catColor) {
      btn.dataset.color = catColor;
      btn.addEventListener('mouseenter', () => {
        if (!btn.classList.contains('active')) {
          btn.style.borderColor = catColor + '80';
          btn.style.color = catColor;
        }
      });
      btn.addEventListener('mouseleave', () => {
        if (!btn.classList.contains('active')) {
          btn.style.borderColor = '';
          btn.style.color = '';
        }
      });
    }

    btn.addEventListener('click', () => setFilter(catId, catColor));
    container.appendChild(btn);
  });
}

function setFilter(cat, color) {
  activeFilter = cat;

  document.querySelectorAll('.filter-btn').forEach(btn => {
    const isActive = btn.dataset.cat === cat || (cat === 'all' && btn.dataset.cat === 'all');
    btn.classList.toggle('active', isActive);

    // Remettre les styles hover à zéro
    btn.style.borderColor = '';
    btn.style.color = '';

    // Appliquer la couleur sur le bouton actif
    if (isActive && btn.dataset.color) {
      btn.style.borderColor = btn.dataset.color;
      btn.style.color = btn.dataset.color;
      btn.style.boxShadow = `0 0 12px ${btn.dataset.color}40`;
    } else if (isActive) {
      btn.style.boxShadow = '';
    }
  });

  renderMods();
}

// ─── Grille des mods ─────────────────────────────────────────
function renderMods() {
  const grid = document.getElementById('modsGrid');
  if (!grid || !siteData?.mods) return;

  // Filtrer par catégorie
  let mods = siteData.mods;
  if (activeFilter !== 'all') {
    mods = mods.filter(m => m.category === activeFilter);
  }

  if (mods.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <span class="empty-icon">🔍</span>
        <p>Aucun mod dans cette catégorie pour le moment.</p>
      </div>
    `;
    return;
  }

  _allMods = mods;
  grid.innerHTML = mods.map((mod, i) => buildModCard(mod, i)).join('');

  setTimeout(triggerVisibleAnimations, 50);
}

// Construire le HTML d'une carte mod
function buildModCard(mod, index) {
  // Calculer le prix avec réduction
  let price        = mod.basePrice;
  let originalPrice = null;
  let discountLabel = '';

  // Réduction de rôle Discord
  const roleDiscount = userData?.connected ? (userData.discount || 0) : 0;

  // Réduction de promo active sur cette catégorie
  let promoDiscount = 0;
  if (siteData?.promotions) {
    for (const p of siteData.promotions) {
      if (!p.applyToCategories?.length || p.applyToCategories.includes(mod.category)) {
        if (p.discountPercent > promoDiscount) promoDiscount = p.discountPercent;
      }
    }
  }

  // Prendre la meilleure réduction (on cumule ou on prend la plus grande selon la logique choisie)
  const totalDiscount = Math.min(roleDiscount + promoDiscount, 100);

  if (totalDiscount > 0) {
    originalPrice = formatPrice(price);
    price = price * (1 - totalDiscount / 100);
    discountLabel = `-${totalDiscount}%`;
  }

  const priceFormatted = formatPrice(price);

  // Trouver les infos de la catégorie (nom, couleur, icône)
  const catInfo = siteData?.categories?.find(c => (c.id || c) === mod.category);
  const catName  = catInfo?.name  || mod.category;
  const catColor = catInfo?.color || null;
  const catIcon  = catInfo?.icon  || getCategoryIcon(mod.category);

  const catStyle = catColor ? `style="color:${catColor};border-color:${catColor}40;background:${catColor}12"` : '';
  // Carousel d'images
  const allImages = Array.isArray(mod.images) && mod.images.length > 0
    ? mod.images
    : (mod.image ? [mod.image] : []);

  let imageHTML;
  if (allImages.length === 0) {
    imageHTML = `<div class="mod-placeholder">${catIcon}<span>Image bientôt</span></div>`;
  } else if (allImages.length === 1) {
    imageHTML = `<img src="${escapeHtml(allImages[0])}" alt="${escapeHtml(mod.name)}" loading="lazy">`;
  } else {
    const cardId = 'carousel-' + mod.id;
    const slides = allImages.map(img =>
      `<div class="mod-carousel-slide"><img src="${escapeHtml(img)}" alt="${escapeHtml(mod.name)}" loading="lazy"></div>`
    ).join('');
    const dots = allImages.map((_, i) =>
      `<div class="carousel-dot${i===0?' active':''}" onclick="setCarouselSlide('${cardId}',${i})"></div>`
    ).join('');
    imageHTML = `
      <div class="mod-carousel" id="${cardId}" data-current="0" data-total="${allImages.length}">
        <div class="mod-carousel-track">${slides}</div>
        <button class="carousel-btn prev" onclick="carouselPrev('${cardId}')">‹</button>
        <button class="carousel-btn next" onclick="carouselNext('${cardId}')">›</button>
        <div class="carousel-dots">${dots}</div>
      </div>`;
  }

  const featuredBadge = mod.featured ? `<div class="mod-featured-badge">⭐ En vedette</div>` : '';
  const priceOriginalHTML = originalPrice ? `<span class="mod-price-original">${originalPrice}</span>` : '';
  const discountHTML = discountLabel ? `<span class="mod-discount-tag">${discountLabel}</span>` : '';
  const discordUrl = siteData?.site?.discordUrl || '#';
  const modJson = encodeURIComponent(JSON.stringify({
    id: mod.id, name: mod.name, category: mod.category,
    description: mod.description || '', images: allImages,
    basePrice: mod.basePrice, featured: mod.featured
  }));

  return `
    <div class="mod-card fade-in" style="animation-delay:${index * 0.06}s">
      <div class="mod-card-image" style="padding:0;height:180px">
        ${imageHTML}
        ${featuredBadge}
      </div>
      <div class="mod-card-body">
        <div class="mod-category" ${catStyle}>${catIcon} ${escapeHtml(catName)}</div>
        <div class="mod-name">${escapeHtml(mod.name)}</div>
        <div class="mod-desc mod-desc-rich" id="desc-${mod.id}">${mod.description || ''}</div>
        <button class="btn-see-more" onclick="openModDetail('${mod.id}')">VOIR PLUS →</button>
        <div class="mod-footer">
          <div class="mod-price-block">
            ${priceOriginalHTML}
            <span class="mod-price ${totalDiscount > 0 ? 'discounted' : ''}">${priceFormatted}</span>
            ${discountHTML}
          </div>
          <a href="${discordUrl}" target="_blank" class="btn-buy">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.082.112 18.105.131 18.12a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
            </svg>
            Acheter
          </a>
        </div>
      </div>
    </div>
  `;
}

// ─── Carousel ────────────────────────────────────────────────
function carouselGo(id, dir) {
  const el = document.getElementById(id);
  if (!el) return;
  const total   = parseInt(el.dataset.total);
  let   current = parseInt(el.dataset.current);
  current = (current + dir + total) % total;
  setCarouselSlide(id, current);
}
function carouselPrev(id) { carouselGo(id, -1); }
function carouselNext(id) { carouselGo(id, +1); }

function setCarouselSlide(id, index) {
  const el = document.getElementById(id);
  if (!el) return;
  el.dataset.current = index;
  el.querySelector('.mod-carousel-track').style.transform = `translateX(-${index * 100}%)`;
  el.querySelectorAll('.carousel-dot').forEach((d, i) => d.classList.toggle('active', i === index));
}

// ─── Modal détail mod ────────────────────────────────────────
let _allMods = [];

function openModDetail(modId) {
  const mod = _allMods.find(m => m.id === modId);
  if (!mod) return;

  const catInfo  = siteData?.categories?.find(c => (c.id || c) === mod.category);
  const catName  = catInfo?.name  || mod.category;
  const catColor = catInfo?.color || null;
  const catIcon  = catInfo?.icon  || '';
  const catStyle = catColor ? `color:${catColor}` : '';

  const allImages = Array.isArray(mod.images) && mod.images.length > 0
    ? mod.images : (mod.image ? [mod.image] : []);

  // Carousel détail
  let carouselHTML = '';
  if (allImages.length === 0) {
    carouselHTML = `<div class="detail-carousel" style="display:flex;align-items:center;justify-content:center;font-size:3rem">${catIcon}</div>`;
  } else {
    const slides = allImages.map(img =>
      `<div class="detail-carousel-slide"><img src="${escapeHtml(img)}" alt="${escapeHtml(mod.name)}"></div>`
    ).join('');
    const dots = allImages.length > 1 ? allImages.map((_, i) =>
      `<div class="detail-carousel-dot${i===0?' active':''}" onclick="setDetailSlide(${i})"></div>`
    ).join('') : '';
    const btns = allImages.length > 1 ? `
      <button class="detail-carousel-btn prev" onclick="detailCarouselGo(-1)">‹</button>
      <button class="detail-carousel-btn next" onclick="detailCarouselGo(+1)">›</button>
      <div class="detail-carousel-dots">${dots}</div>` : '';
    carouselHTML = `
      <div class="detail-carousel" id="detailCarousel" data-current="0" data-total="${allImages.length}">
        <div class="detail-carousel-track">${slides}</div>
        ${btns}
        <button class="detail-close" onclick="closeModDetail()">✕</button>
      </div>`;
  }

  // Calcul prix
  let price = mod.basePrice;
  let originalPrice = null;
  const roleDiscount = userData?.connected ? (userData.discount || 0) : 0;
  let promoDiscount = 0;
  if (siteData?.promotions) {
    for (const p of siteData.promotions) {
      if (!p.applyToCategories?.length || p.applyToCategories.includes(mod.category)) {
        if (p.discountPercent > promoDiscount) promoDiscount = p.discountPercent;
      }
    }
  }
  const totalDiscount = Math.min(roleDiscount + promoDiscount, 100);
  if (totalDiscount > 0) {
    originalPrice = formatPrice(price);
    price = price * (1 - totalDiscount / 100);
  }

  const discordUrl = siteData?.site?.discordUrl || '#';

  document.getElementById('modDetailModal').innerHTML = `
    ${carouselHTML}
    <div class="detail-body">
      <div class="detail-category" style="${catStyle}">${catIcon} ${escapeHtml(catName)}</div>
      <div class="detail-name">${escapeHtml(mod.name)}</div>
      <div class="detail-desc">${mod.description || ''}</div>
      <div class="detail-footer">
        <div class="mod-price-block">
          ${originalPrice ? `<span class="mod-price-original">${originalPrice}</span>` : ''}
          <span class="mod-price ${totalDiscount > 0 ? 'discounted' : ''}">${formatPrice(price)}</span>
          ${totalDiscount > 0 ? `<span class="mod-discount-tag">-${totalDiscount}%</span>` : ''}
        </div>
        <a href="${discordUrl}" target="_blank" class="btn-buy" style="padding:12px 24px;font-size:0.85rem">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.082.112 18.105.131 18.12a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
          </svg>
          ACHETER SUR DISCORD
        </a>
      </div>
    </div>
  `;

  document.getElementById('modDetailOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModDetail() {
  document.getElementById('modDetailOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function detailCarouselGo(dir) {
  const el = document.getElementById('detailCarousel');
  if (!el) return;
  const total   = parseInt(el.dataset.total);
  let   current = parseInt(el.dataset.current);
  current = (current + dir + total) % total;
  setDetailSlide(current);
}

function setDetailSlide(index) {
  const el = document.getElementById('detailCarousel');
  if (!el) return;
  el.dataset.current = index;
  el.querySelector('.detail-carousel-track').style.transform = `translateX(-${index * 100}%)`;
  el.querySelectorAll('.detail-carousel-dot').forEach((d, i) => d.classList.toggle('active', i === index));
}

// ─── Discord ─────────────────────────────────────────────────
function loginDiscord() {
  window.location.href = '/auth/discord';
}

async function logoutDiscord() {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.reload();
}

// ─── Navbar scroll ───────────────────────────────────────────
function setupNavbarScroll() {
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
  }, { passive: true });
}

// ─── Animations à la vue ─────────────────────────────────────
function setupScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });

  // Observer les éléments existants
  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

  // Ré-observer quand du contenu est ajouté dynamiquement
  window._fadeObserver = observer;
}

function triggerVisibleAnimations() {
  document.querySelectorAll('.fade-in:not(.visible)').forEach(el => {
    if (window._fadeObserver) window._fadeObserver.observe(el);
  });
}

// ─── Helpers ─────────────────────────────────────────────────

function formatPrice(amount) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2
  }).format(amount);
}

function getCategoryIcon(cat) {
  const icons = {
    // Nouveaux IDs
    'pompiers':         '🚒',
    'samu':             '🚑',
    'gendarmerie':      '⚜️',
    'police-nationale': '👮',
    'police-municipale':'🚔',
    'autoroutier':      '🛣️',
    'protection-civile':'🟠',
    'civils':           '🚗',
    'props':            '📦',
    'scripts':          '📜',
    // Anciennes chaînes (compatibilité)
    'Véhicules':           '🚔',
    'Scripts FiveM':       '⚙️',
    'Habillages / Livrées':'🎨',
    'Uniformes / EUP':     '👮'
  };
  return icons[cat] || '📦';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}