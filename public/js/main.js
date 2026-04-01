let siteData   = null;
let userData   = null;
let activeFilter = 'all';

document.addEventListener('DOMContentLoaded', async () => {
  setupNavbarScroll();
  setupScrollAnimations();
  await loadAll();
});

async function loadAll() {
  try {
    const [pub, user] = await Promise.all([
      fetch('/api/public').then(r => r.json()),
      fetch('/api/user').then(r => r.json())
    ]);

    siteData = pub;
    userData = user;

    applySiteConfig();
    renderNavAuth();
    renderPromos();
    renderCategoryFilters();
    renderMods();
    await checkMaintenanceBanner();

  } catch (err) {
    console.error('Erreur chargement données:', err);
  }
}

async function checkMaintenanceBanner() {
  try {
    const res  = await fetch('/api/maintenance-status');
    const data = await res.json();
    if (data.maintenance && data.isStaff) {
      showMaintenanceBanner();
    }
  } catch (e) {}

  setInterval(async () => {
    try {
      const res  = await fetch('/api/maintenance-status');
      const data = await res.json();

      if (data.maintenance && !data.isStaff) {
        window.location.href = '/maintenance';
      }

      if (data.maintenance && data.isStaff && !document.getElementById('maintBannerBottom')) {
        showMaintenanceBanner();
      }

      if (!data.maintenance && document.getElementById('maintBannerBottom')) {
        document.getElementById('maintBannerTop')?.remove();
        document.getElementById('maintBannerBottom')?.remove();
        document.body.style.paddingTop    = '';
        document.body.style.paddingBottom = '';
      }
    } catch (e) {}
  }, 5000);
}

function showMaintenanceBanner() {
  if (document.getElementById('maintBannerBottom')) return;

  if (!document.getElementById('maintBannerStyle')) {
    const style = document.createElement('style');
    style.id = 'maintBannerStyle';
    style.textContent = `@keyframes maintScroll {
      from { transform: translateX(0); }
      to   { transform: translateX(-50%); }
    }`;
    document.head.appendChild(style);
  }

  const text = '🔧 SITE EN MAINTENANCE — VISIBLE PAR LE STAFF UNIQUEMENT ';

  function createBanner(id) {
    const banner = document.createElement('div');
    banner.id = id;
    banner.style.cssText = `
      left: 0; right: 0;
      z-index: 9999;
      background: repeating-linear-gradient(
        -45deg,
        #c8102e 0px, #c8102e 20px,
        #a00c25 20px, #a00c25 40px
      );
      overflow: hidden;
      border: 3px solid rgba(255,255,255,0.25);
      box-shadow: 0 4px 30px rgba(200,16,46,0.5);
    `;

    const track = document.createElement('div');
    track.style.cssText = `
      display: flex;
      animation: maintScroll 14s linear infinite;
      white-space: nowrap;
    `;

    let html = '';
    for (let i = 0; i < 10; i++) {
      html += `<span style="
        display: inline-block;
        padding: 10px 40px;
        font-family: 'Bebas Neue', sans-serif;
        font-size: 1rem;
        letter-spacing: 0.25em;
        color: #fff;
        text-shadow: 0 1px 3px rgba(0,0,0,0.4);
      ">${text}</span>`;
    }
    track.innerHTML = html + html;
    banner.appendChild(track);
    return banner;
  }

  const top = createBanner('maintBannerTop');
  top.style.position = 'fixed';
  top.style.top = '64px';
  document.body.appendChild(top);

  const bottom = createBanner('maintBannerBottom');
  bottom.style.position = 'fixed';
  bottom.style.bottom = '0';
  document.body.appendChild(bottom);

  document.body.style.paddingTop    = '109px';
  document.body.style.paddingBottom = '45px';
}

// ─── Helpers YouTube ─────────────────────────────────────────
function isYoutube(url) {
  return /youtube\.com|youtu\.be/.test(url || '');
}

function getYoutubeId(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function buildMediaSlide(url, alt, cssClass) {
  if (isYoutube(url)) {
    const id = getYoutubeId(url);
    if (!id) return '';
    return `<div class="${cssClass}" style="position:relative;">
      <iframe
        src="https://www.youtube.com/embed/${id}?rel=0&modestbranding=1"
        frameborder="0"
        allowfullscreen
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        style="width:100%;height:100%;display:block;border:none;position:absolute;top:0;left:0">
      </iframe>
    </div>`;
  }
  return `<div class="${cssClass}">
    <img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">
  </div>`;
}

function buildYoutubeDot(url, index, activeClass, onclickFn) {
  if (isYoutube(url)) {
    return `<div class="${activeClass}" onclick="${onclickFn}" title="▶ Vidéo" style="background:#ff0000;width:8px;height:8px;border-radius:2px;">▶</div>`;
  }
  return `<div class="${activeClass}" onclick="${onclickFn}"></div>`;
}

// ─── Config du site ──────────────────────────────────────────
function applySiteConfig() {
  if (!siteData?.site) return;
  const s = siteData.site;

  document.title = s.title || "Cac's GTA V Mods";

  const badge = document.getElementById('heroBadge');
  if (badge && s.heroTagline) badge.textContent = s.heroTagline;

  const subtitle = document.getElementById('heroSubtitle');
  if (subtitle && s.subtitle) subtitle.textContent = s.subtitle;

  const links = document.querySelectorAll('[id="discordCta"], #heroDiscordBtn');
  links.forEach(el => { if (s.discordUrl) el.href = s.discordUrl; });

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

  if (promos.length === 0) { banner.style.display = 'none'; return; }

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

  const items = buildItems();
  track.innerHTML = items;

  requestAnimationFrame(() => {
    const trackW  = track.scrollWidth;
    const bannerW = banner.offsetWidth;

    if (trackW < bannerW) {
      const copies = Math.ceil((bannerW * 3) / trackW) + 1;
      let repeated = '';
      for (let i = 0; i < copies; i++) repeated += items;
      track.innerHTML = repeated;
    } else {
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
    const j   = Math.floor(diff / 86400000);
    const h   = Math.floor((diff % 86400000) / 3600000);
    const m   = Math.floor((diff % 3600000) / 60000);
    const s   = Math.floor((diff % 60000) / 1000);
    const pad = n => String(n).padStart(2, '0');
    const txt = j > 0 ? `${j}j ${pad(h)}h ${pad(m)}m` : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    els.forEach(el => el.textContent = txt);
  }
  update();
  setInterval(update, 1000);
}

// ─── Filtres Catégories ──────────────────────────────────────
function renderCategoryFilters() {
  const container = document.getElementById('categoryFilters');
  if (!container || !siteData?.categories) return;

  siteData.categories.forEach(cat => {
    const btn      = document.createElement('button');
    btn.className  = 'filter-btn';
    const catId    = cat.id   || cat;
    const catName  = cat.name || cat;
    const catIcon  = cat.icon || '';
    const catColor = cat.color || null;

    btn.dataset.cat = catId;
    btn.innerHTML   = `${catIcon} ${catName}`;

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
    btn.style.borderColor = '';
    btn.style.color = '';

    if (isActive && btn.dataset.color) {
      btn.style.borderColor = btn.dataset.color;
      btn.style.color       = btn.dataset.color;
      btn.style.boxShadow   = `0 0 12px ${btn.dataset.color}40`;
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

  let mods = siteData.mods;
  if (activeFilter !== 'all') mods = mods.filter(m => m.category === activeFilter);

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

function buildModCard(mod, index) {
  let price         = mod.basePrice;
  let originalPrice = null;
  let discountLabel = '';

  const roleDiscount = userData?.connected ? (userData.discount || 0) : 0;
  let promoDiscount  = 0;
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
    price         = price * (1 - totalDiscount / 100);
    discountLabel = `-${totalDiscount}%`;
  }

  const priceFormatted = formatPrice(price);
  const catInfo  = siteData?.categories?.find(c => (c.id || c) === mod.category);
  const catName  = catInfo?.name  || mod.category;
  const catColor = catInfo?.color || null;
  const catIcon  = catInfo?.icon  || getCategoryIcon(mod.category);
  const catStyle = catColor ? `style="color:${catColor};border-color:${catColor}40;background:${catColor}12"` : '';

  const allImages = Array.isArray(mod.images) && mod.images.length > 0
    ? mod.images : (mod.image ? [mod.image] : []);

  let imageHTML;
  if (allImages.length === 0) {
    imageHTML = `<div class="mod-placeholder">${catIcon}<span>Image bientôt</span></div>`;
  } else if (allImages.length === 1) {
    // Slide unique
    if (isYoutube(allImages[0])) {
      const id = getYoutubeId(allImages[0]);
      imageHTML = `<div style="position:relative;width:100%;height:100%;">
        <iframe src="https://www.youtube.com/embed/${id}?rel=0&modestbranding=1"
          frameborder="0" allowfullscreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;">
        </iframe>
      </div>`;
    } else {
      imageHTML = `<img src="${escapeHtml(allImages[0])}" alt="${escapeHtml(mod.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;">`;
    }
  } else {
    const cardId = 'carousel-' + mod.id;
    const slides = allImages.map(img => buildMediaSlide(img, mod.name, 'mod-carousel-slide')).join('');
    const dots   = allImages.map((url, i) => {
      const activeClass = `carousel-dot${i===0?' active':''}`;
      const onclick     = `setCarouselSlide('${cardId}',${i})`;
      if (isYoutube(url)) {
        return `<div class="${activeClass}" onclick="${onclick}" style="font-size:8px;line-height:6px;background:rgba(255,0,0,0.7);border-radius:2px;width:14px;height:6px;display:flex;align-items:center;justify-content:center;color:#fff;">▶</div>`;
      }
      return `<div class="${activeClass}" onclick="${onclick}"></div>`;
    }).join('');

    imageHTML = `
      <div class="mod-carousel" id="${cardId}" data-current="0" data-total="${allImages.length}">
        <div class="mod-carousel-track">${slides}</div>
        <button class="carousel-btn prev" onclick="carouselPrev('${cardId}')">‹</button>
        <button class="carousel-btn next" onclick="carouselNext('${cardId}')">›</button>
        <div class="carousel-dots">${dots}</div>
      </div>`;
  }

  const featuredBadge     = mod.featured ? `<div class="mod-featured-badge">⭐ En vedette</div>` : '';
  const priceOriginalHTML = originalPrice ? `<span class="mod-price-original">${originalPrice}</span>` : '';
  const discountHTML      = discountLabel ? `<span class="mod-discount-tag">${discountLabel}</span>` : '';

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
          <button class="btn-add-cart" id="cart-btn-${mod.id}" onclick="addToCart('${mod.id}')">
            🛒 Ajouter
          </button>
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

  let carouselHTML = '';
  if (allImages.length === 0) {
    carouselHTML = `<div class="detail-carousel" style="display:flex;align-items:center;justify-content:center;font-size:3rem">${catIcon}</div>`;
  } else {
    const slides = allImages.map(img => buildMediaSlide(img, mod.name, 'detail-carousel-slide')).join('');
    const dots   = allImages.length > 1 ? allImages.map((url, i) => {
      const activeClass = `detail-carousel-dot${i===0?' active':''}`;
      const onclick     = `setDetailSlide(${i})`;
      if (isYoutube(url)) {
        return `<div class="${activeClass}" onclick="${onclick}" style="font-size:8px;line-height:6px;background:rgba(255,0,0,0.7);border-radius:2px;width:14px;height:6px;display:flex;align-items:center;justify-content:center;color:#fff;">▶</div>`;
      }
      return `<div class="${activeClass}" onclick="${onclick}"></div>`;
    }).join('') : '';

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

  let price = mod.basePrice;
  let originalPrice = null;
  const roleDiscount = userData?.connected ? (userData.discount || 0) : 0;
  let promoDiscount  = 0;
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
    price         = price * (1 - totalDiscount / 100);
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

function loginDiscord()  { window.location.href = '/auth/discord'; }

async function logoutDiscord() {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.reload();
}

function setupNavbarScroll() {
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
  }, { passive: true });
}

function setupScrollAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
  window._fadeObserver = observer;
}

function triggerVisibleAnimations() {
  document.querySelectorAll('.fade-in:not(.visible)').forEach(el => {
    if (window._fadeObserver) window._fadeObserver.observe(el);
  });
}

function formatPrice(amount) {
  if (!amount || amount <= 0) return 'Gratuit';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2
  }).format(amount);
}

function getCategoryIcon(cat) {
  const icons = {
    'pompiers':          '🚒',
    'samu':              '🚑',
    'gendarmerie':       '⚜️',
    'police-nationale':  '👮',
    'police-municipale': '🚔',
    'autoroutier':       '🛣️',
    'protection-civile': '🟠',
    'civils':            '🚗',
    'props':             '📦',
    'scripts':           '📜',
    'Véhicules':            '🚔',
    'Scripts FiveM':        '⚙️',
    'Habillages / Livrées': '🎨',
    'Uniformes / EUP':      '👮'
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

// ═══════════════════════════════════════════════════════════
//  PANIER
// ═══════════════════════════════════════════════════════════

let cart = JSON.parse(localStorage.getItem('cacsCart') || '[]');

function saveCart() {
  localStorage.setItem('cacsCart', JSON.stringify(cart));
  updateCartUI();
}

function toggleOption(modId, option) {
  const item = cart.find(i => i.id === modId);
  if (!item) return;
  if (!item.options) item.options = { debadgage: false, retexture: false };
  item.options[option] = !item.options[option];
  saveCart();
}

function updateCartUI() {
  const count   = cart.reduce((sum, item) => sum + item.quantity, 0);
  const countEl = document.getElementById('cartCount');
  if (countEl) countEl.textContent = count;

  cart.forEach(item => {
    const btn = document.getElementById(`cart-btn-${item.id}`);
    if (btn) btn.classList.add('added');
  });

  renderCartItems();
}

function addToCart(modId) {
  const mod = _allMods.find(m => m.id === modId);
  if (!mod) return;

  let price = mod.basePrice;
  const roleDiscount = userData?.connected ? (userData.discount || 0) : 0;
  let promoDiscount  = 0;
  if (siteData?.promotions) {
    for (const p of siteData.promotions) {
      if (!p.applyToCategories?.length || p.applyToCategories.includes(mod.category)) {
        if (p.discountPercent > promoDiscount) promoDiscount = p.discountPercent;
      }
    }
  }
  const totalDiscount = Math.min(roleDiscount + promoDiscount, 100);
  const finalPrice    = price * (1 - totalDiscount / 100);

  const existing = cart.find(i => i.id === modId);
  if (existing) {
    showToast('Ce mod est déjà dans ton panier !');
    openCart();
    return;
  }

  cart.push({
    id:            mod.id,
    name:          mod.name,
    price:         finalPrice,
    originalPrice: totalDiscount > 0 ? price : null,
    image:         (mod.images?.[0] || mod.image || ''),
    quantity:      1,
    options:       { debadgage: false, retexture: false }
  });

  saveCart();

  const btn = document.getElementById(`cart-btn-${modId}`);
  if (btn) {
    btn.textContent = '✅ Ajouté !';
    btn.classList.add('added');
    setTimeout(() => { btn.textContent = '🛒 Ajouter'; }, 1500);
  }

  openCart();
}

function removeFromCart(modId) {
  cart = cart.filter(i => i.id !== modId);
  saveCart();
}

function changeQty(modId, delta) {
  const item = cart.find(i => i.id === modId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) removeFromCart(modId);
  else saveCart();
}

function renderCartItems() {
  const container = document.getElementById('cartItems');
  const footer    = document.getElementById('cartFooter');
  const totalEl   = document.getElementById('cartTotal');
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = '<div class="cart-empty">Ton panier est vide</div>';
    if (footer) footer.style.display = 'none';
    return;
  }

  if (footer) footer.style.display = 'block';

  const coreOption = document.getElementById('cartCoreOption')?.checked ? 10 : 0;
  const total = cart.reduce((sum, i) => {
    const opts  = i.options || {};
    const extra = (opts.debadgage ? 10 : 0) + (opts.retexture ? 5 : 0);
    return sum + (i.price + extra) * i.quantity;
  }, 0) + coreOption;
  if (totalEl) totalEl.textContent = formatPrice(total);

  container.innerHTML = cart.map(item => {
    const opts       = item.options || {};
    const extraPrice = (opts.debadgage ? 10 : 0) + (opts.retexture ? 5 : 0);
    const totalItem  = (item.price + extraPrice) * item.quantity;

    // Miniature panier : si YouTube, afficher thumbnail
    const imgHTML = isYoutube(item.image)
      ? `<img src="https://img.youtube.com/vi/${getYoutubeId(item.image)}/mqdefault.jpg" class="cart-item-img" onerror="this.style.display='none'">`
      : item.image
        ? `<img src="${escapeHtml(item.image)}" class="cart-item-img" onerror="this.style.display='none'">`
        : `<div class="cart-item-img" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem">📦</div>`;

    return `
    <div class="cart-item" id="cart-item-${item.id}">
      <div class="cart-item-top">
        ${imgHTML}
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.name)}</div>
          <div class="cart-item-price">${formatPrice(totalItem)}</div>
        </div>
        <button class="cart-item-remove" onclick="removeFromCart('${item.id}')">🗑️</button>
      </div>
      <div class="cart-item-options">
        <label class="cart-option">
          <input type="checkbox" ${opts.debadgage ? 'checked' : ''} onchange="toggleOption('${item.id}', 'debadgage')">
          <span>🔧 Debadgage <em>+10€</em></span>
        </label>
        <label class="cart-option">
          <input type="checkbox" ${opts.retexture ? 'checked' : ''} onchange="toggleOption('${item.id}', 'retexture')">
          <span>🎨 Retexture <em>+5€</em></span>
        </label>
      </div>
    </div>
  `}).join('');
}

function toggleCart() {
  const drawer  = document.getElementById('cartDrawer');
  const overlay = document.getElementById('cartOverlay');
  const isOpen  = drawer.classList.contains('open');
  drawer.classList.toggle('open', !isOpen);
  overlay.classList.toggle('open', !isOpen);
  document.body.style.overflow = isOpen ? '' : 'hidden';
}

function openCart() {
  const drawer  = document.getElementById('cartDrawer');
  const overlay = document.getElementById('cartOverlay');
  drawer.classList.add('open');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

// ═══════════════════════════════════════════════════════════
//  MODALE COMMANDE
// ═══════════════════════════════════════════════════════════

function openOrderModal() {
  const overlay = document.getElementById('orderModalOverlay');
  const body    = document.getElementById('orderModalBody');
  if (!overlay || !body) return;

  const coreChecked = document.getElementById('cartCoreOption')?.checked ? 10 : 0;
  const total = cart.reduce((sum, i) => {
    const opts  = i.options || {};
    const extra = (opts.debadgage ? 10 : 0) + (opts.retexture ? 5 : 0);
    return sum + (i.price + extra) * i.quantity;
  }, 0) + coreChecked;

  const itemLines = cart.map(item => `
    <div class="order-recap-item">
      <span>${escapeHtml(item.name)} × ${item.quantity}</span>
      <span>${formatPrice(item.price * item.quantity)}</span>
    </div>
  `).join('');

  const loginWarning = !userData?.connected
    ? `<div class="order-info-box">
        ⚠️ <strong>Tu n'es pas connecté via Discord.</strong><br>
        Le ticket sera créé mais tu ne seras pas ajouté automatiquement.<br>
        <button onclick="loginDiscord()" style="margin-top:8px;background:var(--blue);border:none;color:#fff;padding:6px 14px;border-radius:4px;cursor:pointer;font-weight:600">Se connecter avec Discord</button>
      </div>`
    : `<div class="order-info-box">
        ✅ Connecté en tant que <strong>${escapeHtml(userData.username)}</strong><br>
        Un ticket privé sera créé sur notre Discord avec toi et notre équipe.
      </div>`;

  body.innerHTML = `
    <div class="order-recap">
      ${itemLines}
      ${coreChecked ? `<div class="order-recap-item"><span>📦 Ressource [CORE]</span><span>${formatPrice(10)}</span></div>` : ''}
      <div class="order-recap-total">
        <span>Total</span>
        <span>${formatPrice(total)}</span>
      </div>
    </div>
    ${loginWarning}
    <div class="order-modal-actions">
      <button class="btn-ghost" onclick="closeOrderModal()">Annuler</button>
      <button class="btn-confirm" id="btnConfirmOrder" onclick="confirmOrder()">
        🎫 Créer le ticket Discord
      </button>
    </div>
  `;

  const drawer      = document.getElementById('cartDrawer');
  const cartOverlay = document.getElementById('cartOverlay');
  drawer.classList.remove('open');
  cartOverlay.classList.remove('open');
  document.body.style.overflow = 'hidden';
  overlay.classList.add('open');
}

function closeOrderModal() {
  const overlay = document.getElementById('orderModalOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

async function confirmOrder() {
  const btn = document.getElementById('btnConfirmOrder');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Création en cours...'; }

  const coreChecked = document.getElementById('cartCoreOption')?.checked ? 10 : 0;
  const total = cart.reduce((sum, i) => {
    const opts  = i.options || {};
    const extra = (opts.debadgage ? 10 : 0) + (opts.retexture ? 5 : 0);
    return sum + (i.price + extra) * i.quantity;
  }, 0) + coreChecked;

  try {
    const coreOption = document.getElementById('cartCoreOption')?.checked || false;

    const res = await fetch('/api/order', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        items:       cart,
        totalPrice:  total,
        coreOption,
        discordUser: userData?.connected ? { id: userData.id, username: userData.username } : null
      })
    });

    const result = await res.json();

    if (result.success) {
      cart = [];
      saveCart();

      const body = document.getElementById('orderModalBody');
      if (body) {
        body.innerHTML = `
          <div class="order-success">
            <div class="success-icon">🎫</div>
            <h4>Ticket créé avec succès !</h4>
            <p>Un ticket a été ouvert sur notre Discord.<br>
               Notre équipe va te contacter très rapidement.</p>
            <div class="ticket-link">#${escapeHtml(result.ticketChannel)}</div>
          </div>
          <div style="margin-top:18px">
            <button onclick="closeOrderModal()" style="width:100%;background:var(--blue);border:none;color:#fff;padding:11px;border-radius:4px;font-weight:700;font-size:0.9rem;cursor:pointer;letter-spacing:0.06em">
              Fermer
            </button>
          </div>
        `;
      }
    } else {
      alert('Erreur : ' + (result.error || 'Impossible de créer le ticket.'));
      if (btn) { btn.disabled = false; btn.textContent = '🎫 Créer le ticket Discord'; }
    }
  } catch (err) {
    console.error('Erreur commande:', err);
    alert('Erreur de connexion au serveur.');
    if (btn) { btn.disabled = false; btn.textContent = '🎫 Créer le ticket Discord'; }
  }
}

function showToast(msg) {
  let toast = document.getElementById('siteToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'siteToast';
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a2e;border:1px solid rgba(0,87,184,0.4);color:#fff;padding:10px 20px;border-radius:6px;font-size:0.85rem;z-index:9999;transition:opacity 0.3s;font-family:var(--font-ui)';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}