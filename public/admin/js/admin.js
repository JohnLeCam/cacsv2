// ============================================================
//  ADMIN.JS — Cac's GTA V Mods
//  Gère tout le panel admin : connexion, CRUD mods/promos/rôles, config
// ============================================================

let data = null; // Toutes les données du site (chargées depuis l'API)

// ─── CONNEXION ADMIN ─────────────────────────────────────────
async function doLogin() {
  const pwd = document.getElementById('pwdInput').value;
  const err = document.getElementById('loginError');

  if (!pwd) { err.textContent = 'Entre le mot de passe.'; return; }

  try {
    const res = await fetch('/api/admin/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password: pwd })
    });

    if (res.ok) {
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('adminApp').style.display    = 'flex';
      await loadAdminData();
    } else {
      err.textContent = '❌ Mot de passe incorrect.';
      document.getElementById('pwdInput').value = '';
    }
  } catch {
    err.textContent = 'Erreur de connexion au serveur.';
  }
}

async function adminLogout() {
  await fetch('/api/admin/logout', { method: 'POST' });
  location.reload();
}

// ─── CHARGEMENT DES DONNÉES ──────────────────────────────────
async function loadAdminData() {
  try {
    const res = await fetch('/api/admin/data');
    data = await res.json();

    renderDashboard();
    renderModsList();
    renderCategoriesList();
    renderPromosList();
    renderRolesList();
    loadConfigForm();
  } catch (e) {
    console.error('Erreur chargement admin:', e);
    showToast('Erreur lors du chargement des données', true);
  }
}

// ─── SAUVEGARDE GÉNÉRALE ─────────────────────────────────────
async function saveAll() {
  setSaveStatus('saving', 'Sauvegarde...');
  try {
    const res = await fetch('/api/admin/save', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data)
    });

    if (res.ok) {
      setSaveStatus('saved', '✓ Sauvegardé');
      setTimeout(() => setSaveStatus('', ''), 3000);
    } else {
      setSaveStatus('error', '✗ Erreur sauvegarde');
    }
  } catch {
    setSaveStatus('error', '✗ Erreur serveur');
  }
}

function setSaveStatus(cls, txt) {
  const el = document.getElementById('saveStatus');
  el.className = 'save-status ' + cls;
  el.textContent = txt;
}

// ─── NAVIGATION PAR ONGLETS ──────────────────────────────────
const tabTitles = {
  dashboard:  'Dashboard',
  mods:       'Gérer les mods',
  categories: 'Gérer les catégories',
  promos:     'Gérer les promotions',
  roles:      'Rôles Discord & Réductions',
  config:     'Configuration du site',
  settings:   'Paramètres'
};

function switchTab(tab) {
  // Désactiver tous les onglets
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Activer le bon onglet
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('tabTitle').textContent = tabTitles[tab] || tab;
}

// ─── DASHBOARD ───────────────────────────────────────────────
function renderDashboard() {
  if (!data) return;

  const mods     = data.mods || [];
  const promos   = (data.promotions || []).filter(p => p.active && new Date(p.endDate) > new Date());
  const roles    = data.roles || data.discordRoles || [];
  const visible  = mods.filter(m => m.visible).length;
  const featured = mods.filter(m => m.featured).length;

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${mods.length}</div>
      <div class="stat-label">Mods au total</div>
    </div>
    <div class="stat-card">
      <div class="stat-value green">${visible}</div>
      <div class="stat-label">Mods visibles</div>
    </div>
    <div class="stat-card">
      <div class="stat-value red">${promos.length}</div>
      <div class="stat-label">Promos actives</div>
    </div>
    <div class="stat-card">
      <div class="stat-value blue">${roles.length}</div>
      <div class="stat-label">Rôles Discord</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${featured}</div>
      <div class="stat-label">En vedette</div>
    </div>
  `;
}

// ─── MODS ────────────────────────────────────────────────────

function renderModsList() {
  const list = document.getElementById('modsList');
  if (!list || !data) return;

  // Trier par position avant d'afficher
  if (data.mods) {
    data.mods.forEach((m, i) => { if (m.position === undefined) m.position = i; });
    data.mods.sort((a, b) => a.position - b.position);
  }

  if (!data.mods || data.mods.length === 0) {
    list.innerHTML = '<p style="color:var(--grey-m);font-size:0.9rem">Aucun mod. Clique sur "+ Ajouter un mod" pour commencer.</p>';
    return;
  }

  // Trouver la couleur de catégorie
  function getCatColor(catId) {
    const cat = (data.categories || []).find(c => (c.id || c) === catId);
    return cat?.color || '#cc0000';
  }

  list.innerHTML = data.mods.map((mod, i) => `
    <div class="item-row" draggable="true" data-index="${i}"
         ondragstart="onDragStart(event,${i})"
         ondragover="onDragOver(event)"
         ondragleave="onDragLeave(event)"
         ondrop="onDrop(event,${i})"
         ondragend="onDragEnd(event)">
      <span class="drag-handle" title="Glisser pour réordonner">⠿</span>
      <div class="item-cat-dot" style="background:${getCatColor(mod.category)}"></div>
      <div class="item-info">
        <div class="item-name">${esc(mod.name)}</div>
        <div class="item-meta">${esc(mod.category)} · ${formatEUR(mod.basePrice)}</div>
      </div>
      ${mod.featured ? '<span class="item-badge" style="background:rgba(251,191,36,0.1);color:#fbbf24;border:1px solid rgba(251,191,36,0.3);font-family:var(--mono);font-size:0.7rem;padding:3px 10px;border-radius:20px;">⭐ Vedette</span>' : ''}
      <span class="item-badge ${mod.visible ? 'badge-visible' : 'badge-hidden'}">${mod.visible ? 'Visible' : 'Masqué'}</span>
      <div class="item-actions">
        <button class="btn-icon" onclick="openModModal(${i})" title="Modifier">✏️</button>
        <button class="btn-icon del" onclick="deleteMod(${i})" title="Supprimer">🗑️</button>
      </div>
    </div>
  `).join('');
}

// ─── DRAG & DROP ─────────────────────────────────────────────

let dragSrcIndex = null;

function onDragStart(e, index) {
  dragSrcIndex = index;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e, targetIndex) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

  // Réordonner le tableau
  const moved = data.mods.splice(dragSrcIndex, 1)[0];
  data.mods.splice(targetIndex, 0, moved);

  // Mettre à jour les positions
  data.mods.forEach((m, i) => { m.position = i; });

  saveAll();
  renderModsList();
  showToast('Ordre mis à jour !');
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.item-row').forEach(r => r.classList.remove('drag-over'));
  dragSrcIndex = null;
}

function openModModal(index = null) {
  // Remplir le select catégorie (compatible objets et chaînes)
  const catSelect = document.getElementById('modCategory');
  catSelect.innerHTML = (data.categories || []).map(c => {
    const id   = c.id   || c;
    const name = c.name || c;
    const icon = c.icon || '';
    return `<option value="${esc(id)}">${icon} ${esc(name)}</option>`;
  }).join('');

  if (index !== null && data.mods[index]) {
    const mod = data.mods[index];
    document.getElementById('modModalTitle').textContent = 'Modifier le mod';
    document.getElementById('modId').value          = index;
    document.getElementById('modName').value         = mod.name || '';
    document.getElementById('modCategory').value     = mod.category || '';
    document.getElementById('modPrice').value        = mod.basePrice || 0;
    document.getElementById('modDesc').innerHTML      = mod.description || '';
    loadImageManager(mod.images || (mod.image ? [mod.image] : []));
    setToggle('toggleFeatured', mod.featured);
    setToggle('toggleVisible',  mod.visible !== false);
  } else {
    document.getElementById('modModalTitle').textContent = 'Nouveau mod';
    document.getElementById('modId').value  = '';
    document.getElementById('modName').value = '';
    document.getElementById('modPrice').value = '';
    document.getElementById('modDesc').innerHTML = '';
    loadImageManager([]);
    setToggle('toggleFeatured', false);
    setToggle('toggleVisible',  true);
  }

  openModal('modModal');
}

async function saveMod() {
  const idx  = document.getElementById('modId').value;
  const name = document.getElementById('modName').value.trim();
  const cat  = document.getElementById('modCategory').value;
  const price = parseFloat(document.getElementById('modPrice').value) || 0;
  const desc  = document.getElementById('modDesc').innerHTML.trim();
  const images = getImageManagerUrls();
  const image  = images[0] || '';
  const featured = isToggleOn('toggleFeatured');
  const visible  = isToggleOn('toggleVisible');

  if (!name) { alert('Le nom est obligatoire.'); return; }

  const mod = {
    id:          idx !== '' ? data.mods[idx]?.id : 'mod-' + Date.now(),
    name, category: cat, description: desc, image, images,
    basePrice: price, featured, visible,
    position:  idx !== '' ? (data.mods[parseInt(idx)]?.position ?? parseInt(idx)) : (data.mods?.length || 0)
  };

  if (idx !== '') {
    data.mods[parseInt(idx)] = mod;
  } else {
    if (!data.mods) data.mods = [];
    data.mods.push(mod);
  }

  await saveAll();
  closeModModal();
  renderModsList();
  renderDashboard();
  showToast(idx !== '' ? 'Mod mis à jour !' : 'Mod ajouté !');
}

function deleteMod(index) {
  if (!confirm(`Supprimer "${data.mods[index]?.name}" ?`)) return;
  data.mods.splice(index, 1);
  saveAll();
  renderModsList();
  renderDashboard();
  showToast('Mod supprimé');
}

function closeModModal() { closeModal('modModal'); }

// ─── PROMOTIONS ──────────────────────────────────────────────

function renderPromosList() {
  const list = document.getElementById('promosList');
  if (!list || !data) return;

  const promos = data.promotions || [];

  if (promos.length === 0) {
    list.innerHTML = '<p style="color:var(--grey-m);font-size:0.9rem">Aucune promotion. Clique sur "+ Ajouter une promo".</p>';
    return;
  }

  list.innerHTML = promos.map((p, i) => {
    const end = new Date(p.endDate);
    const expired = end < new Date();
    const statusBadge = !p.active
      ? '<span class="item-badge badge-hidden">Inactive</span>'
      : expired
        ? '<span class="item-badge" style="background:rgba(249,115,22,0.1);color:#fb923c;border:1px solid rgba(249,115,22,0.3);font-family:var(--mono);font-size:0.7rem;padding:3px 10px;border-radius:20px">Expirée</span>'
        : '<span class="item-badge badge-active">Active</span>';

    return `
      <div class="item-row">
        <div class="item-cat-dot" style="background:var(--red)"></div>
        <div class="item-info">
          <div class="item-name">${esc(p.name)} — -${p.discountPercent}%</div>
          <div class="item-meta">Fin : ${end.toLocaleDateString('fr-FR')} · ${end.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}</div>
        </div>
        ${statusBadge}
        <div class="item-actions">
          <button class="btn-icon" onclick="openPromoModal(${i})" title="Modifier">✏️</button>
          <button class="btn-icon del" onclick="deletePromo(${i})" title="Supprimer">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function openPromoModal(index = null) {
  // Checkboxes catégories (compatibilité objets {id, name, color, icon} et chaînes)
  const wrap = document.getElementById('promoCatCheckboxes');
  wrap.innerHTML = (data.categories || []).map(c => {
    const id   = c.id   || c;
    const name = c.name || c;
    const icon = c.icon || '';
    const color = c.color || '';
    return `
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;background:var(--bg-2);border:1px solid var(--border-b);padding:6px 12px;border-radius:var(--r);font-size:0.82rem;color:${color || 'var(--grey-l)'};">
        <input type="checkbox" value="${esc(id)}" class="promo-cat-cb" style="width:auto;cursor:pointer"> ${icon} ${esc(name)}
      </label>
    `;
  }).join('');

  if (index !== null && data.promotions[index]) {
    const p = data.promotions[index];
    document.getElementById('promoModalTitle').textContent = 'Modifier la promotion';
    document.getElementById('promoId').value       = index;
    document.getElementById('promoName').value      = p.name || '';
    document.getElementById('promoDesc').value      = p.description || '';
    document.getElementById('promoDiscount').value  = p.discountPercent || 10;
    document.getElementById('promoEndDate').value   = toDatetimeLocal(p.endDate);
    setToggle('togglePromoActive', p.active !== false);

    // Cocher les catégories
    const cats = p.applyToCategories || [];
    document.querySelectorAll('.promo-cat-cb').forEach(cb => {
      cb.checked = cats.includes(cb.value) || cats.length === 0;
    });
  } else {
    document.getElementById('promoModalTitle').textContent = 'Nouvelle promotion';
    document.getElementById('promoId').value      = '';
    document.getElementById('promoName').value     = '';
    document.getElementById('promoDesc').value     = '';
    document.getElementById('promoDiscount').value = 10;
    // Date par défaut : dans 7 jours
    const nextWeek = new Date(Date.now() + 7 * 86400000);
    document.getElementById('promoEndDate').value  = toDatetimeLocal(nextWeek.toISOString());
    setToggle('togglePromoActive', true);
    document.querySelectorAll('.promo-cat-cb').forEach(cb => { cb.checked = true; });
  }

  openModal('promoModal');
}

async function savePromo() {
  const idx      = document.getElementById('promoId').value;
  const name     = document.getElementById('promoName').value.trim();
  const desc     = document.getElementById('promoDesc').value.trim();
  const discount = parseInt(document.getElementById('promoDiscount').value) || 10;
  const endDate  = document.getElementById('promoEndDate').value;
  const active   = isToggleOn('togglePromoActive');

  const cats = [];
  document.querySelectorAll('.promo-cat-cb:checked').forEach(cb => cats.push(cb.value));

  if (!name)    { alert('Le nom est obligatoire.'); return; }
  if (!endDate) { alert('La date de fin est obligatoire.'); return; }

  const promo = {
    id:                 idx !== '' ? data.promotions[idx]?.id : 'promo-' + Date.now(),
    name, description:  desc,
    discountPercent:    discount,
    endDate:            new Date(endDate).toISOString(),
    applyToCategories:  cats,
    active
  };

  if (idx !== '') {
    data.promotions[parseInt(idx)] = promo;
  } else {
    if (!data.promotions) data.promotions = [];
    data.promotions.push(promo);
  }

  await saveAll();
  closePromoModal();
  renderPromosList();
  renderDashboard();
  showToast(idx !== '' ? 'Promotion mise à jour !' : 'Promotion créée !');
}

function deletePromo(index) {
  if (!confirm(`Supprimer la promotion "${data.promotions[index]?.name}" ?`)) return;
  data.promotions.splice(index, 1);
  saveAll();
  renderPromosList();
  renderDashboard();
  showToast('Promotion supprimée');
}

function closePromoModal() { closeModal('promoModal'); }

// ─── RÔLES DISCORD ───────────────────────────────────────────

function renderRolesList() {
  const list = document.getElementById('rolesList');
  if (!list || !data) return;

  const roles = data.discordRoles || [];

  if (roles.length === 0) {
    list.innerHTML = '<p style="color:var(--grey-m);font-size:0.9rem">Aucun rôle configuré. Ajoute des rôles pour appliquer des réductions automatiques.</p>';
    return;
  }

  list.innerHTML = roles.map((r, i) => `
    <div class="item-row">
      <div class="item-cat-dot" style="background:${r.color || '#888'}"></div>
      <div class="item-info">
        <div class="item-name">${esc(r.roleName)} — -${r.discount}%</div>
        <div class="item-meta">ID: ${esc(r.roleId)}</div>
      </div>
      <span class="item-badge badge-role" style="color:${r.color||'#7db8f7'}">${esc(r.roleName)}</span>
      <div class="item-actions">
        <button class="btn-icon" onclick="openRoleModal(${i})" title="Modifier">✏️</button>
        <button class="btn-icon del" onclick="deleteRole(${i})" title="Supprimer">🗑️</button>
      </div>
    </div>
  `).join('');
}

function openRoleModal(index = null) {
  if (index !== null && data.discordRoles[index]) {
    const r = data.discordRoles[index];
    document.getElementById('roleModalTitle').textContent = 'Modifier le rôle';
    document.getElementById('roleIdx').value      = index;
    document.getElementById('roleId').value       = r.roleId || '';
    document.getElementById('roleName').value     = r.roleName || '';
    document.getElementById('roleDiscount').value = r.discount || 0;
    document.getElementById('roleColor').value    = r.color || '#888888';
    document.getElementById('roleColorPicker').value = r.color || '#888888';
  } else {
    document.getElementById('roleModalTitle').textContent = 'Nouveau rôle';
    document.getElementById('roleIdx').value      = '';
    document.getElementById('roleId').value       = '';
    document.getElementById('roleName').value     = '';
    document.getElementById('roleDiscount').value = 10;
    document.getElementById('roleColor').value    = '#ffd700';
    document.getElementById('roleColorPicker').value = '#ffd700';
  }
  openModal('roleModal');
}

async function saveRole() {
  const idx      = document.getElementById('roleIdx').value;
  const roleId   = document.getElementById('roleId').value.trim();
  const roleName = document.getElementById('roleName').value.trim();
  const discount = parseInt(document.getElementById('roleDiscount').value) || 0;
  const color    = document.getElementById('roleColor').value.trim() || '#888888';

  if (!roleId)   { alert("L'ID du rôle est obligatoire."); return; }
  if (!roleName) { alert('Le nom du rôle est obligatoire.'); return; }

  const role = { roleId, roleName, discount, color };

  if (!data.discordRoles) data.discordRoles = [];

  if (idx !== '') {
    data.discordRoles[parseInt(idx)] = role;
  } else {
    data.discordRoles.push(role);
  }

  await saveAll();
  closeRoleModal();
  renderRolesList();
  renderDashboard();
  showToast(idx !== '' ? 'Rôle mis à jour !' : 'Rôle ajouté !');
}

function deleteRole(index) {
  if (!confirm(`Supprimer le rôle "${data.discordRoles[index]?.roleName}" ?`)) return;
  data.discordRoles.splice(index, 1);
  saveAll();
  renderRolesList();
  renderDashboard();
  showToast('Rôle supprimé');
}

function closeRoleModal() { closeModal('roleModal'); }

// Swatch couleur en temps réel
function updateColorSwatch() {
  const val = document.getElementById('roleColor').value;
  document.getElementById('roleColorPicker').value = isValidColor(val) ? val : '#888888';
}

function syncColorFromPicker() {
  document.getElementById('roleColor').value = document.getElementById('roleColorPicker').value;
}

function isValidColor(str) {
  return /^#[0-9a-fA-F]{3,6}$/.test(str);
}

// ─── CONFIGURATION ───────────────────────────────────────────

function loadConfigForm() {
  if (!data?.site) return;
  document.getElementById('cfg-title').value        = data.site.title || '';
  document.getElementById('cfg-heroTagline').value  = data.site.heroTagline || '';
  document.getElementById('cfg-subtitle').value     = data.site.subtitle || '';
  document.getElementById('cfg-discordUrl').value   = data.site.discordUrl || '';
  document.getElementById('cfg-announcement').value = data.site.announcement || '';

  // cfg-categories supprimé — les catégories se gèrent dans l'onglet dédié
}

async function saveConfig() {
  data.site = {
    ...data.site,
    title:        document.getElementById('cfg-title').value.trim(),
    heroTagline:  document.getElementById('cfg-heroTagline').value.trim(),
    subtitle:     document.getElementById('cfg-subtitle').value.trim(),
    discordUrl:   document.getElementById('cfg-discordUrl').value.trim(),
    announcement: document.getElementById('cfg-announcement').value.trim()
  };

  // Les catégories ne sont PAS modifiées ici — elles se gèrent dans l'onglet Catégories

  await saveAll();
  showToast('Configuration sauvegardée !');
}

// ─── PARAMÈTRES ──────────────────────────────────────────────

async function changePassword() {
  const p1 = document.getElementById('newPwd1').value;
  const p2 = document.getElementById('newPwd2').value;

  if (!p1)     { showToast('Entre un nouveau mot de passe.', true); return; }
  if (p1 !== p2) { showToast('Les deux mots de passe ne correspondent pas.', true); return; }
  if (p1.length < 6) { showToast('Minimum 6 caractères.', true); return; }

  data.adminPassword = p1;
  await saveAll();

  document.getElementById('newPwd1').value = '';
  document.getElementById('newPwd2').value = '';

  showToast('Mot de passe changé ! Reconnecte-toi.');
  setTimeout(() => adminLogout(), 2000);
}


// ─── CATÉGORIES ──────────────────────────────────────────────

function renderCategoriesList() {
  const list = document.getElementById('categoriesList');
  if (!list || !data) return;

  const cats = data.categories || [];

  if (cats.length === 0) {
    list.innerHTML = '<p style="color:var(--grey-m);font-size:0.9rem">Aucune catégorie. Clique sur "+ Ajouter".</p>';
    return;
  }

  list.innerHTML = cats.map((cat, i) => `
    <div class="item-row" draggable="true" data-index="${i}"
         ondragstart="onDragStart(event,${i})"
         ondragover="onDragOver(event)"
         ondragleave="onDragLeave(event)"
         ondrop="onCatDrop(event,${i})"
         ondragend="onDragEnd(event)">
      <span class="drag-handle" title="Glisser pour réordonner">⠿</span>
      <div style="width:22px;height:22px;border-radius:50%;background:${cat.color || '#888'};flex-shrink:0;border:2px solid rgba(255,255,255,0.15)"></div>
      <span style="font-size:1.2rem;flex-shrink:0">${cat.icon || '📦'}</span>
      <div class="item-info">
        <div class="item-name">${esc(cat.name)}</div>
        <div class="item-meta">ID: ${esc(cat.id)} · ${cat.color || 'pas de couleur'}</div>
      </div>
      <div class="item-actions">
        <button class="btn-icon" onclick="openCatModal(${i})" title="Modifier">✏️</button>
        <button class="btn-icon del" onclick="deleteCat(${i})" title="Supprimer">🗑️</button>
      </div>
    </div>
  `).join('');
}

function openCatModal(index = null) {
  if (index !== null && data.categories[index]) {
    const cat = data.categories[index];
    document.getElementById('catModalTitle').textContent = 'Modifier la catégorie';
    document.getElementById('catIdx').value   = index;
    document.getElementById('catId').value    = cat.id    || '';
    document.getElementById('catName').value  = cat.name  || '';
    document.getElementById('catIcon').value  = cat.icon  || '';
    document.getElementById('catColor').value = cat.color || '#888888';
    document.getElementById('catColorPicker').value = cat.color || '#888888';
    // Bloquer l'édition de l'ID si la catégorie est déjà utilisée
    document.getElementById('catId').disabled = true;
  } else {
    document.getElementById('catModalTitle').textContent = 'Nouvelle catégorie';
    document.getElementById('catIdx').value   = '';
    document.getElementById('catId').value    = '';
    document.getElementById('catName').value  = '';
    document.getElementById('catIcon').value  = '📦';
    document.getElementById('catColor').value = '#888888';
    document.getElementById('catColorPicker').value = '#888888';
    document.getElementById('catId').disabled = false;
  }
  updateCatPreview();
  openModal('catModal');
}

function autoSlug() {
  const idx = document.getElementById('catIdx').value;
  // Seulement auto-générer si c'est une nouvelle catégorie
  if (idx !== '') return;
  const name = document.getElementById('catName').value;
  const slug = name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retirer accents
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-');
  document.getElementById('catId').value = slug;
  updateCatPreview();
}

function updateCatSwatch() {
  const val = document.getElementById('catColor').value;
  if (/^#[0-9a-fA-F]{3,6}$/.test(val)) {
    document.getElementById('catColorPicker').value = val;
  }
  updateCatPreview();
}

function syncCatColor() {
  document.getElementById('catColor').value = document.getElementById('catColorPicker').value;
  updateCatPreview();
}

function updateCatPreview() {
  const icon  = document.getElementById('catIcon').value  || '📦';
  const name  = document.getElementById('catName').value  || 'Nom catégorie';
  const color = document.getElementById('catColor').value || '#888888';

  const preview = document.getElementById('catPreview');
  const pIcon   = document.getElementById('catPreviewIcon');
  const pName   = document.getElementById('catPreviewName');

  if (preview) {
    preview.style.color       = color;
    preview.style.borderColor = color + '60';
    preview.style.background  = color + '18';
  }
  if (pIcon)  pIcon.textContent = icon;
  if (pName)  pName.textContent = name;
}

// Mettre à jour la prévisualisation en temps réel
document.addEventListener('input', e => {
  if (['catIcon','catName','catColor'].includes(e.target.id)) updateCatPreview();
});

async function saveCat() {
  const idx   = document.getElementById('catIdx').value;
  const id    = document.getElementById('catId').value.trim();
  const name  = document.getElementById('catName').value.trim();
  const icon  = document.getElementById('catIcon').value.trim() || '📦';
  const color = document.getElementById('catColor').value.trim() || '#888888';

  if (!id)   { alert("L'identifiant est obligatoire."); return; }
  if (!name) { alert('Le nom est obligatoire.'); return; }
  if (!/^[a-z0-9-]+$/.test(id)) { alert("L'identifiant ne peut contenir que des lettres minuscules, chiffres et tirets."); return; }

  // Vérifier doublon d'ID sur création
  if (idx === '') {
    const exists = (data.categories || []).some(c => c.id === id);
    if (exists) { alert(`L'identifiant "${id}" existe déjà.`); return; }
  }

  const cat = {
    id, name, icon, color,
    position: idx !== '' ? (data.categories[parseInt(idx)]?.position ?? parseInt(idx)) : (data.categories?.length || 0)
  };

  if (!data.categories) data.categories = [];

  if (idx !== '') {
    data.categories[parseInt(idx)] = cat;
  } else {
    data.categories.push(cat);
  }

  await saveAll();
  closeCatModal();
  renderCategoriesList();
  renderDashboard();
  showToast(idx !== '' ? 'Catégorie mise à jour !' : 'Catégorie ajoutée !');
}

function deleteCat(index) {
  const cat = data.categories[index];
  // Vérifier si des mods utilisent cette catégorie
  const modsUsing = (data.mods || []).filter(m => m.category === cat.id).length;
  if (modsUsing > 0) {
    if (!confirm(`⚠️ ${modsUsing} mod(s) utilisent cette catégorie. Les supprimer quand même ?`)) return;
  } else {
    if (!confirm(`Supprimer la catégorie "${cat.name}" ?`)) return;
  }
  data.categories.splice(index, 1);
  saveAll();
  renderCategoriesList();
  renderDashboard();
  showToast('Catégorie supprimée');
}

function closeCatModal() { closeModal('catModal'); }

// Drag & drop spécifique aux catégories
function onCatDrop(e, targetIndex) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

  const moved = data.categories.splice(dragSrcIndex, 1)[0];
  data.categories.splice(targetIndex, 0, moved);
  data.categories.forEach((c, i) => { c.position = i; });

  saveAll();
  renderCategoriesList();
  showToast('Ordre mis à jour !');
}

// ─── RICH TEXT EDITOR ────────────────────────────────────────

function rfmt(cmd, value = null) {
  document.getElementById('modDesc').focus();
  document.execCommand(cmd, false, value);
  updateRichToolbar();
}

function updateRichToolbar() {
  const cmds = ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'];
  document.querySelectorAll('.rich-btn').forEach(btn => {
    const cmd = btn.getAttribute('onclick')?.match(/rfmt\('([^']+)'/)?.[1];
    if (cmd && cmds.includes(cmd)) {
      btn.classList.toggle('active', document.queryCommandState(cmd));
    }
  });
}

// Mettre à jour la toolbar quand la sélection change
document.addEventListener('selectionchange', () => {
  if (document.activeElement?.id === 'modDesc') updateRichToolbar();
});



function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ─── HELPERS TOGGLES ─────────────────────────────────────────

function setToggle(id, on) {
  const el = document.getElementById(id);
  if (on) el.classList.add('on');
  else    el.classList.remove('on');
}

function isToggleOn(id) {
  return document.getElementById(id).classList.contains('on');
}

function toggleModFeatured() {
  document.getElementById('toggleFeatured').classList.toggle('on');
}

function toggleModVisible() {
  document.getElementById('toggleVisible').classList.toggle('on');
}

function togglePromoActive() {
  document.getElementById('togglePromoActive').classList.toggle('on');
}

// ─── TOAST ───────────────────────────────────────────────────

let toastTimer = null;

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className   = isError ? 'error show' : 'show';

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 3200);
}

// ─── HELPERS DIVERS ──────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatEUR(amount) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount || 0);
}

function toDatetimeLocal(isoStr) {
  // Convertit une date ISO en format compatible avec input datetime-local
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


// ─── GESTIONNAIRE MULTI-IMAGES ───────────────────────────────

let _imageList = []; // tableau d'URLs

function loadImageManager(images) {
  _imageList = [...(images || [])];
  renderImageManager();
}

function getImageManagerUrls() {
  return [..._imageList];
}

function renderImageManager() {
  const container = document.getElementById('imageManager');
  if (!container) return;

  if (_imageList.length === 0) {
    container.innerHTML = '<div class="img-mgr-empty">Aucune image — ajoute une URL ci-dessous</div>';
  } else {
    container.innerHTML = _imageList.map((url, i) => `
      <div class="img-mgr-item" draggable="true"
           ondragstart="imgDragStart(event,${i})"
           ondragover="imgDragOver(event)"
           ondragleave="imgDragLeave(event)"
           ondrop="imgDrop(event,${i})"
           ondragend="imgDragEnd(event)"
           data-idx="${i}">
        <span class="img-mgr-handle" title="Glisser pour réordonner">⠿</span>
        <img src="${esc(url)}" onerror="this.style.opacity=0.3" loading="lazy">
        <div class="img-mgr-info">
          <span class="img-mgr-label">${i === 0 ? '⭐ Photo principale' : `Photo ${i+1}`}</span>
          <span class="img-mgr-url">${esc(url.length > 45 ? url.substring(0,45)+'…' : url)}</span>
        </div>
        <div class="img-mgr-actions">
          ${i > 0 ? `<button class="img-mgr-btn" onclick="imgSetMain(${i})" title="Définir comme principale">★</button>` : ''}
          <button class="img-mgr-btn del" onclick="imgRemove(${i})" title="Supprimer">🗑️</button>
        </div>
      </div>
    `).join('');
  }
}

function imgAdd() {
  const input = document.getElementById('imgUrlInput');
  const url   = input.value.trim();
  if (!url) return;
  if (!url.startsWith('http')) { alert('URL invalide — doit commencer par http'); return; }
  _imageList.push(url);
  input.value = '';
  renderImageManager();
}

function imgRemove(index) {
  _imageList.splice(index, 1);
  renderImageManager();
}

function imgSetMain(index) {
  const [item] = _imageList.splice(index, 1);
  _imageList.unshift(item);
  renderImageManager();
}

// Drag & drop images
let _imgDragSrc = null;
function imgDragStart(e, i) { _imgDragSrc = i; e.currentTarget.style.opacity = '0.4'; }
function imgDragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function imgDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function imgDragEnd(e) { e.currentTarget.style.opacity = ''; document.querySelectorAll('.img-mgr-item').forEach(el => el.classList.remove('drag-over')); }
function imgDrop(e, targetIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (_imgDragSrc === null || _imgDragSrc === targetIdx) return;
  const [moved] = _imageList.splice(_imgDragSrc, 1);
  _imageList.splice(targetIdx, 0, moved);
  renderImageManager();
}

// ─── INIT ────────────────────────────────────────────────────
// Vérifier si déjà connecté (si la session admin est encore active)
(async () => {
  try {
    const res = await fetch('/api/admin/check');
    const result = await res.json();
    if (result.isAdmin) {
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('adminApp').style.display    = 'flex';
      await loadAdminData();
    }
  } catch { /* Pas connecté, on affiche la page de connexion */ }
})();