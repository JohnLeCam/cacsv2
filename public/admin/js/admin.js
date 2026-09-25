let data = null;

async function doLogin() {
  const pwd = document.getElementById('pwdInput').value;
  const err = document.getElementById('loginError');
  if (!pwd) { err.textContent = 'Entre le mot de passe.'; return; }
  try {
    const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwd }) });
    if (res.ok) {
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('adminApp').style.display    = 'flex';
      await loadAdminData();
    } else { err.textContent = '❌ Mot de passe incorrect.'; document.getElementById('pwdInput').value = ''; }
  } catch { err.textContent = 'Erreur de connexion au serveur.'; }
}

async function adminLogout() { await fetch('/api/admin/logout', { method: 'POST' }); location.reload(); }

async function loadAdminData() {
  try {
    const res = await fetch('/api/admin/data');
    data = await res.json();
    renderDashboard(); renderModsList(); renderCategoriesList(); renderPromosList(); renderRolesList(); loadConfigForm();
  } catch (e) { console.error('Erreur chargement admin:', e); showToast('Erreur lors du chargement des données', true); }
}

async function saveAll() {
  setSaveStatus('saving', 'Sauvegarde...');
  try {
    const res = await fetch('/api/admin/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { setSaveStatus('saved', '✓ Sauvegardé'); setTimeout(() => setSaveStatus('', ''), 3000); }
    else setSaveStatus('error', '✗ Erreur sauvegarde');
  } catch { setSaveStatus('error', '✗ Erreur serveur'); }
}

function setSaveStatus(cls, txt) { const el = document.getElementById('saveStatus'); el.className = 'save-status ' + cls; el.textContent = txt; }

const tabTitles = { dashboard:'Dashboard', live:'Temps réel', orders:'Commandes', stats:'Statistiques', mods:'Gérer les mods', categories:'Gérer les catégories', promos:'Gérer les promotions', roles:'Rôles Discord & Réductions', config:'Configuration du site', settings:'Paramètres' };

function switchTab(tab) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('tabTitle').textContent = tabTitles[tab] || tab;
  if (tab === 'stats')  loadStats();
  if (tab === 'orders') loadOrders();
  if (tab === 'live')   initLive();
}

// ─── DASHBOARD ───────────────────────────────────────────────
function renderDashboard() {
  if (!data) return;
  const mods = data.mods || [], promos = (data.promotions || []).filter(p => p.active && new Date(p.endDate) > new Date()), roles = data.discordRoles || [];
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-value">${mods.length}</div><div class="stat-label">Mods au total</div></div>
    <div class="stat-card"><div class="stat-value green">${mods.filter(m => m.visible).length}</div><div class="stat-label">Mods visibles</div></div>
    <div class="stat-card"><div class="stat-value red">${promos.length}</div><div class="stat-label">Promos actives</div></div>
    <div class="stat-card"><div class="stat-value blue">${roles.length}</div><div class="stat-label">Rôles Discord</div></div>
    <div class="stat-card"><div class="stat-value">${mods.filter(m => m.featured).length}</div><div class="stat-label">En vedette</div></div>`;
}

// ─── COMMANDES ───────────────────────────────────────────────
const STATUS_LABELS = { pending:'🟡 En attente', processing:'🔵 En cours', paid:'💳 Payé', delivered:'🟢 Livré', cancelled:'🔴 Annulé' };
const STATUS_COLORS = { pending:'#f59e0b', processing:'#3b82f6', paid:'#a855f7', delivered:'#22c55e', cancelled:'#ef4444' };

async function loadOrders() {
  const container = document.getElementById('ordersContent');
  if (!container) return;
  container.innerHTML = `<div style="color:var(--grey-m);font-size:0.9rem;padding:20px 0">Chargement des commandes...</div>`;
  try {
    const res    = await fetch('/api/admin/orders');
    const orders = await res.json();

    if (orders.length === 0) {
      container.innerHTML = `<div class="card"><div class="card-body"><p style="color:var(--grey-m)">Aucune commande enregistrée.</p></div></div>`;
      return;
    }

    // Filtres statut
    const filterBtns = ['all','pending','processing','delivered','cancelled'].map(s => {
      const count = s === 'all' ? orders.length : orders.filter(o => o.status === s).length;
      const label = s === 'all' ? 'Toutes' : STATUS_LABELS[s];
      return `<button class="btn ${s === 'all' ? 'btn-red' : 'btn-ghost'} btn-sm order-filter-btn" data-status="${s}" onclick="filterOrders('${s}',this)">${label} <span style="font-family:var(--mono);font-size:0.7rem">(${count})</span></button>`;
    }).join('');

    const ordersHTML = orders.map(order => {
      const date      = new Date(order.created_at).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const items     = Array.isArray(order.items) ? order.items : [];
      const status    = order.status || 'pending';
      const color     = STATUS_COLORS[status] || '#666';
      const label     = STATUS_LABELS[status]  || '🟡 En attente';
      const itemNames = items.map(i => i.name).join(', ');

      return `
        <div class="order-row" data-status="${status}" style="display:grid;grid-template-columns:12px 1fr 100px 120px 160px;gap:16px;align-items:center;padding:14px 18px;background:var(--bg-2);border:1px solid var(--border-b);border-radius:var(--r);transition:border-color 0.2s">
          <div style="width:10px;height:10px;border-radius:50%;background:${color}"></div>
          <div style="min-width:0">
            <div style="font-size:0.92rem;font-weight:700;color:var(--white)">${esc(order.discord_username || 'Visiteur')}</div>
            <div style="font-size:0.72rem;color:var(--grey-m);font-family:var(--mono);margin-top:2px">${date}</div>
            <div style="font-size:0.75rem;color:var(--grey-l);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(itemNames)}</div>
            <div style="font-size:0.7rem;color:var(--grey-m);font-family:var(--mono);margin-top:2px">#${esc(order.ticket_channel || '')}</div>
          </div>
          <div style="font-family:var(--mono);font-size:0.9rem;font-weight:700;color:var(--white);text-align:right">${formatEUR(order.total_price)}</div>
          <span style="display:inline-flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:0.68rem;padding:4px 10px;border-radius:20px;color:${color};border:1px solid ${color}40;background:${color}12;white-space:nowrap">${label}</span>
          <select class="order-status-select" data-id="${order.id}" onchange="changeOrderStatus('${order.id}', this)">
            <option value="pending"    ${status==='pending'    ? 'selected' : ''}>🟡 En attente</option>
            <option value="processing" ${status==='processing' ? 'selected' : ''}>🔵 En cours</option>
            <option value="paid"       ${status==='paid'       ? 'selected' : ''}>💳 Payé</option>
            <option value="delivered"  ${status==='delivered'  ? 'selected' : ''}>🟢 Livré</option>
            <option value="cancelled"  ${status==='cancelled'  ? 'selected' : ''}>🔴 Annulé</option>
          </select>
          <button onclick="deleteOrder('${order.id}', this)" title="Supprimer" style="background:transparent;border:1px solid rgba(217,0,0,0.3);color:var(--red);width:32px;height:32px;border-radius:var(--r);cursor:pointer;font-size:0.85rem;flex-shrink:0;transition:all 0.2s" onmouseover="this.style.background='rgba(217,0,0,0.15)'" onmouseout="this.style.background='transparent'">🗑️</button>
        </div>`;
    }).join('');

    container.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">${filterBtns}</div>
      <div class="card">
        <div class="card-body" style="padding:12px">
          <div class="items-list" id="ordersList">${ordersHTML}</div>
        </div>
      </div>`;
  } catch (err) {
    container.innerHTML = `<div style="color:var(--red);font-size:0.9rem">Erreur chargement des commandes.</div>`;
    console.error(err);
  }
}

function filterOrders(status, btn) {
  document.querySelectorAll('.order-filter-btn').forEach(b => { b.classList.remove('btn-red'); b.classList.add('btn-ghost'); });
  btn.classList.add('btn-red'); btn.classList.remove('btn-ghost');
  document.querySelectorAll('.order-row').forEach(row => {
    row.style.display = (status === 'all' || row.dataset.status === status) ? 'grid' : 'none';
  });
}

async function changeOrderStatus(orderId, selectEl) {
  const newStatus = selectEl.value;
  const row       = selectEl.closest('.order-row');
  try {
    selectEl.disabled = true;
    const res = await fetch(`/api/admin/orders/${orderId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) });
    if (res.ok) {
      row.dataset.status = newStatus;
      const dot   = row.querySelector('div[style*="border-radius:50%"]');
      const badge = row.querySelector('.item-badge');
      const color = STATUS_COLORS[newStatus];
      const label = STATUS_LABELS[newStatus];
      if (dot)   dot.style.background = color;
      if (badge) { badge.style.color = color; badge.style.borderColor = color + '40'; badge.style.background = color + '12'; badge.textContent = label; }
      showToast(`Statut mis à jour → ${label}`);
    } else { showToast('Erreur mise à jour statut', true); selectEl.value = row.dataset.status; }
  } catch (e) { showToast('Erreur serveur', true); }
  finally { selectEl.disabled = false; }
}

async function deleteOrder(orderId, btn) {
  if (!confirm('Supprimer définitivement cette commande ?')) return;
  try {
    btn.disabled = true;
    const res = await fetch(`/api/admin/orders/${orderId}`, { method: 'DELETE' });
    if (res.ok) {
      btn.closest('.order-row').remove();
      showToast('Commande supprimée');
    } else { showToast('Erreur suppression', true); btn.disabled = false; }
  } catch (e) { showToast('Erreur serveur', true); btn.disabled = false; }
}

// ─── STATS ───────────────────────────────────────────────────
function buildOptionBar(label, pct, color) {
  return `<div style="display:flex;flex-direction:column;gap:8px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:0.85rem;font-weight:600;color:var(--white)">${label}</span>
      <span style="font-family:var(--mono);font-size:0.9rem;color:${color};font-weight:700">${pct}%</span>
    </div>
    <div style="height:8px;background:var(--bg-2);border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.5s ease"></div>
    </div>
  </div>`;
}

async function loadStats() {
  const container = document.getElementById('statsContent');
  if (!container) return;
  container.innerHTML = `<div style="color:var(--grey-m);font-size:0.9rem;padding:20px 0">Chargement des statistiques...</div>`;
  try {
    const res   = await fetch('/api/admin/stats');
    const stats = await res.json();
    const topModsHTML = stats.topMods.length === 0
      ? '<p style="color:var(--grey-m);font-size:0.85rem">Aucune commande.</p>'
      : stats.topMods.map((mod, i) => `<div class="item-row" style="padding:10px 16px"><div style="font-family:var(--mono);font-size:1.1rem;color:var(--red);width:24px;flex-shrink:0">#${i+1}</div><div class="item-info"><div class="item-name">${esc(mod.name)}</div><div class="item-meta">${mod.count} commande${mod.count>1?'s':''} · ${formatEUR(mod.revenue)}</div></div></div>`).join('');
    const recentHTML = stats.recentOrders.length === 0
      ? '<p style="color:var(--grey-m);font-size:0.85rem">Aucune commande.</p>'
      : stats.recentOrders.map(order => {
          const date = new Date(order.created_at).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
          const nb   = Array.isArray(order.items) ? order.items.length : 0;
          const s    = order.status || 'pending';
          return `<div class="item-row" style="padding:10px 16px"><div class="item-info"><div class="item-name">${esc(order.discord_username||'Visiteur')}</div><div class="item-meta">${date} · ${nb} article${nb>1?'s':''} · #${esc(order.ticket_channel)}</div></div><span class="item-badge" style="color:${STATUS_COLORS[s]};border-color:${STATUS_COLORS[s]}40;background:${STATUS_COLORS[s]}12;font-family:var(--mono);font-size:0.65rem">${STATUS_LABELS[s]}</span><span style="font-family:var(--mono);font-size:0.85rem;color:var(--white)">${formatEUR(order.total_price)}</span></div>`;
        }).join('');
    const last7HTML = stats.last7Days.map(d => {
      const label = new Date(d.date).toLocaleDateString('fr-FR', { weekday:'short', day:'numeric' });
      const max   = Math.max(...stats.last7Days.map(x => x.count), 1);
      const pct   = Math.round((d.count / max) * 100);
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1"><div style="font-family:var(--mono);font-size:0.8rem;color:var(--white)">${d.count}</div><div style="width:100%;background:var(--bg-2);border-radius:3px;height:60px;display:flex;align-items:flex-end;overflow:hidden"><div style="width:100%;height:${pct}%;background:var(--red);border-radius:3px 3px 0 0;min-height:${d.count>0?'4px':'0'}"></div></div><div style="font-size:0.68rem;color:var(--grey-m);text-align:center;font-family:var(--mono)">${label}</div></div>`;
    }).join('');

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:24px">
        <div class="stat-card"><div class="stat-value red">${stats.totalOrders}</div><div class="stat-label">Commandes totales</div></div>
        <div class="stat-card"><div class="stat-value green" style="font-size:1.6rem">${formatEUR(stats.totalRevenue)}</div><div class="stat-label">Chiffre d'affaires</div></div>
      </div>
      <div class="card" style="margin-bottom:24px"><div class="card-header"><span class="card-title">📅 Commandes — 7 derniers jours</span></div><div class="card-body"><div style="display:flex;gap:8px;align-items:flex-end;height:100px">${last7HTML}</div></div></div>
      <div class="card" style="margin-bottom:24px"><div class="card-header"><span class="card-title">🔧 Options les plus demandées</span></div><div class="card-body"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px">${buildOptionBar('🔧 Debadgage',stats.pctDebadgage,'#3b82f6')}${buildOptionBar('🎨 Retexture',stats.pctRetexture,'#a855f7')}${buildOptionBar('📦 Core [CORE]',stats.pctCore,'#f97316')}</div><p style="color:var(--grey-m);font-size:0.75rem;margin-top:14px;font-family:var(--mono)">Debadgage & Retexture : % par article · Core : % par commande</p></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
        <div class="card"><div class="card-header"><span class="card-title">🏆 Top 5 mods commandés</span></div><div class="card-body" style="padding:12px"><div class="items-list">${topModsHTML}</div></div></div>
        <div class="card"><div class="card-header"><span class="card-title">🕐 10 dernières commandes</span></div><div class="card-body" style="padding:12px"><div class="items-list">${recentHTML}</div></div></div>
      </div>
      <div class="card" style="margin-top:24px;border-color:rgba(217,0,0,0.2)">
        <div class="card-header"><span class="card-title" style="color:var(--red)">⚠️ Zone dangereuse</span></div>
        <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap">
          <div><div style="font-size:0.9rem;font-weight:600;color:var(--white);margin-bottom:4px">Réinitialiser les statistiques</div><div style="font-size:0.82rem;color:var(--grey-m)">Supprime toutes les commandes enregistrées. Action irréversible.</div></div>
          <button class="btn btn-danger" onclick="resetStats()">🗑️ Reset les stats</button>
        </div>
      </div>`;
  } catch (err) { container.innerHTML = `<div style="color:var(--red);font-size:0.9rem">Erreur chargement des statistiques.</div>`; console.error(err); }
}

async function resetStats() {
  if (!confirm('⚠️ Supprimer TOUTES les commandes ? Cette action est irréversible.')) return;
  try {
    const res = await fetch('/api/admin/stats/reset', { method: 'DELETE' });
    if (res.ok) { showToast('Statistiques réinitialisées !'); loadStats(); }
    else showToast('Erreur lors du reset.', true);
  } catch (e) { showToast('Erreur serveur.', true); }
}

// ─── MODS ────────────────────────────────────────────────────
function renderModsList() {
  const list = document.getElementById('modsList');
  if (!list || !data) return;
  if (data.mods) { data.mods.forEach((m, i) => { if (m.position === undefined) m.position = i; }); data.mods.sort((a, b) => a.position - b.position); }
  if (!data.mods || data.mods.length === 0) { list.innerHTML = '<p style="color:var(--grey-m);font-size:0.9rem">Aucun mod.</p>'; return; }
  function getCatColor(catId) { const cat = (data.categories || []).find(c => (c.id||c) === catId); return cat?.color || '#cc0000'; }
  list.innerHTML = data.mods.map((mod, i) => `
    <div class="item-row" draggable="true" data-index="${i}" ondragstart="onDragStart(event,${i})" ondragover="onDragOver(event)" ondragleave="onDragLeave(event)" ondrop="onDrop(event,${i})" ondragend="onDragEnd(event)">
      <span class="drag-handle">⠿</span>
      <div class="item-cat-dot" style="background:${getCatColor(mod.category)}"></div>
      <div class="item-info"><div class="item-name">${esc(mod.name)}</div><div class="item-meta">${esc(mod.category)} · ${formatEUR(mod.basePrice)}</div></div>
      ${mod.featured ? '<span class="item-badge" style="background:rgba(251,191,36,0.1);color:#fbbf24;border:1px solid rgba(251,191,36,0.3);font-family:var(--mono);font-size:0.7rem;padding:3px 10px;border-radius:20px">⭐ Vedette</span>' : ''}
      <span class="item-badge ${mod.visible ? 'badge-visible' : 'badge-hidden'}">${mod.visible ? 'Visible' : 'Masqué'}</span>
      <div class="item-actions">
        <button class="btn-icon" onclick="openDiscordModal(data.mods[${i}])" title="Annoncer sur Discord" style="color:#5865F2;border-color:rgba(88,101,242,0.35)">📢</button>
        <button class="btn-icon" onclick="duplicateMod(${i})" title="Dupliquer">📋</button>
        <button class="btn-icon" onclick="openModModal(${i})" title="Modifier">✏️</button>
        <button class="btn-icon del" onclick="deleteMod(${i})" title="Supprimer">🗑️</button>
      </div>
    </div>`).join('');
}

let dragSrcIndex = null;
function onDragStart(e, i) { dragSrcIndex = i; e.currentTarget.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; }
function onDragOver(e)  { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('drag-over'); }
function onDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
function onDrop(e, targetIndex) {
  e.preventDefault(); e.currentTarget.classList.remove('drag-over');
  if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;
  const moved = data.mods.splice(dragSrcIndex, 1)[0];
  data.mods.splice(targetIndex, 0, moved);
  data.mods.forEach((m, i) => { m.position = i; });
  saveAll(); renderModsList(); showToast('Ordre mis à jour !');
}
function onDragEnd(e) { e.currentTarget.classList.remove('dragging'); document.querySelectorAll('.item-row').forEach(r => r.classList.remove('drag-over')); dragSrcIndex = null; }

function duplicateMod(index) {
  const original = data.mods[index];
  if (!original) return;
  const copy = { ...JSON.parse(JSON.stringify(original)), id: 'mod-' + Date.now(), name: original.name + ' (copie)', position: data.mods.length };
  data.mods.push(copy); saveAll(); renderModsList(); showToast('Mod dupliqué !');
}

function openModModal(index = null) {
  const catSelect = document.getElementById('modCategory');
  catSelect.innerHTML = (data.categories || []).map(c => `<option value="${esc(c.id||c)}">${c.icon||''} ${esc(c.name||c)}</option>`).join('');
  if (index !== null && data.mods[index]) {
    const mod = data.mods[index];
    document.getElementById('modModalTitle').textContent = 'Modifier le mod';
    document.getElementById('modId').value       = index;
    document.getElementById('modName').value      = mod.name || '';
    document.getElementById('modCategory').value  = mod.category || '';
    document.getElementById('modPrice').value     = mod.basePrice || 0;
    document.getElementById('modDesc').innerHTML  = mod.description || '';
    loadImageManager(mod.images || (mod.image ? [mod.image] : []));
    setToggle('toggleFeatured', mod.featured);
    setToggle('toggleVisible',  mod.visible !== false);
  } else {
    document.getElementById('modModalTitle').textContent = 'Nouveau mod';
    document.getElementById('modId').value = document.getElementById('modName').value = document.getElementById('modPrice').value = '';
    document.getElementById('modDesc').innerHTML = '';
    loadImageManager([]); setToggle('toggleFeatured', false); setToggle('toggleVisible', true);
  }
  openModal('modModal');
}

async function saveMod() {
  const idx = document.getElementById('modId').value, name = document.getElementById('modName').value.trim();
  const cat = document.getElementById('modCategory').value, price = parseFloat(document.getElementById('modPrice').value) || 0;
  const desc = document.getElementById('modDesc').innerHTML.trim(), images = getImageManagerUrls(), image = images[0] || '';
  if (!name) { alert('Le nom est obligatoire.'); return; }

  const isNew = (idx === ''); // true = nouveau mod, false = modification
  const mod   = {
    id:       idx !== '' ? data.mods[idx]?.id : 'mod-' + Date.now(),
    name, category: cat, description: desc, image, images,
    basePrice: price,
    featured:  isToggleOn('toggleFeatured'),
    visible:   isToggleOn('toggleVisible'),
    position:  idx !== '' ? (data.mods[parseInt(idx)]?.position ?? parseInt(idx)) : (data.mods?.length || 0)
  };

  if (idx !== '') data.mods[parseInt(idx)] = mod;
  else { if (!data.mods) data.mods = []; data.mods.push(mod); }

  await saveAll();
  closeModModal();
  renderModsList();
  renderDashboard();

  if (isNew) {
    // 📢 Nouveau mod : proposer l'annonce Discord
    openDiscordModal({ ...mod, _isNew: true });
  } else {
    showToast('Mod mis à jour !');
  }
}

// ─── 📢 ANNONCE DISCORD ──────────────────────────────────────
let _pendingAnnounceMod = null;

function openDiscordModal(mod) {
  _pendingAnnounceMod = mod;
  // Remplir l'aperçu dans la modale
  document.getElementById('discordPreviewModName').textContent = mod.name;
  const priceEl = document.getElementById('discordPreviewPrice');
  priceEl.textContent = mod.basePrice > 0 ? formatEUR(mod.basePrice) : 'Gratuit';
  // Réinitialiser le bouton d'envoi
  const btn = document.getElementById('btnSendDiscord');
  btn.disabled    = false;
  btn.textContent = '🚀 Envoyer sur Discord';
  openModal('discordModal');
}

function closeDiscordModal(skipped = true) {
  const wasNew = _pendingAnnounceMod?._isNew || false;
  _pendingAnnounceMod = null;
  closeModal('discordModal');
  if (skipped && wasNew) showToast('Mod ajouté ! (annonce Discord ignorée)');
}

async function sendDiscordAnnounce() {
  if (!_pendingAnnounceMod) return;
  const btn = document.getElementById('btnSendDiscord');
  btn.disabled    = true;
  btn.textContent = '⏳ Envoi en cours...';

  try {
    const res = await fetch('/api/admin/discord-announce', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        modName:  _pendingAnnounceMod.name,
        modPrice: _pendingAnnounceMod.basePrice,
        modLink:  '', // lien direct optionnel (vide = lien boutique principal)
      })
    });
    const result = await res.json();
    if (result.success) {
      closeDiscordModal(false);
      showToast('✅ Annonce Discord envoyée avec succès !');
    } else {
      btn.disabled    = false;
      btn.textContent = '🚀 Envoyer sur Discord';
      showToast('❌ Erreur Discord : ' + (result.error || 'Inconnue'), true);
    }
  } catch (e) {
    btn.disabled    = false;
    btn.textContent = '🚀 Envoyer sur Discord';
    showToast('❌ Erreur serveur', true);
  }
}

function deleteMod(index) {
  if (!confirm(`Supprimer "${data.mods[index]?.name}" ?`)) return;
  data.mods.splice(index, 1); saveAll(); renderModsList(); renderDashboard(); showToast('Mod supprimé');
}
function closeModModal() { closeModal('modModal'); }

// ─── PROMOTIONS ──────────────────────────────────────────────
function renderPromosList() {
  const list = document.getElementById('promosList');
  if (!list || !data) return;
  const promos = data.promotions || [];
  if (promos.length === 0) { list.innerHTML = '<p style="color:var(--grey-m);font-size:0.9rem">Aucune promotion.</p>'; return; }
  list.innerHTML = promos.map((p, i) => {
    const end = new Date(p.endDate), expired = end < new Date();
    const statusBadge = !p.active ? '<span class="item-badge badge-hidden">Inactive</span>' : expired ? '<span class="item-badge" style="background:rgba(249,115,22,0.1);color:#fb923c;border:1px solid rgba(249,115,22,0.3);font-family:var(--mono);font-size:0.7rem;padding:3px 10px;border-radius:20px">Expirée</span>' : '<span class="item-badge badge-active">Active</span>';
    return `<div class="item-row"><div class="item-cat-dot" style="background:var(--red)"></div><div class="item-info"><div class="item-name">${esc(p.name)} — -${p.discountPercent}%</div><div class="item-meta">Fin : ${end.toLocaleDateString('fr-FR')} · ${end.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div></div>${statusBadge}<div class="item-actions"><button class="btn-icon" onclick="openPromoModal(${i})">✏️</button><button class="btn-icon del" onclick="deletePromo(${i})">🗑️</button></div></div>`;
  }).join('');
}

function openPromoModal(index = null) {
  const wrap = document.getElementById('promoCatCheckboxes');
  wrap.innerHTML = (data.categories || []).map(c => { const id=c.id||c,name=c.name||c,icon=c.icon||'',color=c.color||''; return `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;background:var(--bg-2);border:1px solid var(--border-b);padding:6px 12px;border-radius:var(--r);font-size:0.82rem;color:${color||'var(--grey-l)'}"><input type="checkbox" value="${esc(id)}" class="promo-cat-cb" style="width:auto;cursor:pointer"> ${icon} ${esc(name)}</label>`; }).join('');
  if (index !== null && data.promotions[index]) {
    const p = data.promotions[index];
    document.getElementById('promoModalTitle').textContent = 'Modifier la promotion';
    document.getElementById('promoId').value = index; document.getElementById('promoName').value = p.name||''; document.getElementById('promoDesc').value = p.description||''; document.getElementById('promoDiscount').value = p.discountPercent||10; document.getElementById('promoEndDate').value = toDatetimeLocal(p.endDate);
    setToggle('togglePromoActive', p.active !== false);
    const cats = p.applyToCategories || [];
    document.querySelectorAll('.promo-cat-cb').forEach(cb => { cb.checked = cats.includes(cb.value) || cats.length === 0; });
  } else {
    document.getElementById('promoModalTitle').textContent = 'Nouvelle promotion';
    document.getElementById('promoId').value = document.getElementById('promoName').value = document.getElementById('promoDesc').value = '';
    document.getElementById('promoDiscount').value = 10;
    document.getElementById('promoEndDate').value = toDatetimeLocal(new Date(Date.now()+7*86400000).toISOString());
    setToggle('togglePromoActive', true);
    document.querySelectorAll('.promo-cat-cb').forEach(cb => { cb.checked = true; });
  }
  openModal('promoModal');
}

async function savePromo() {
  const idx = document.getElementById('promoId').value, name = document.getElementById('promoName').value.trim();
  const desc = document.getElementById('promoDesc').value.trim(), discount = parseInt(document.getElementById('promoDiscount').value)||10;
  const endDate = document.getElementById('promoEndDate').value, active = isToggleOn('togglePromoActive');
  const cats = []; document.querySelectorAll('.promo-cat-cb:checked').forEach(cb => cats.push(cb.value));
  if (!name) { alert('Le nom est obligatoire.'); return; }
  if (!endDate) { alert('La date de fin est obligatoire.'); return; }
  const promo = { id: idx !== '' ? data.promotions[idx]?.id : 'promo-'+Date.now(), name, description: desc, discountPercent: discount, endDate: new Date(endDate).toISOString(), applyToCategories: cats, active };
  if (idx !== '') data.promotions[parseInt(idx)] = promo; else { if (!data.promotions) data.promotions = []; data.promotions.push(promo); }
  await saveAll(); closePromoModal(); renderPromosList(); renderDashboard();
  showToast(idx !== '' ? 'Promotion mise à jour !' : 'Promotion créée !');
}
function deletePromo(index) { if (!confirm(`Supprimer "${data.promotions[index]?.name}" ?`)) return; data.promotions.splice(index, 1); saveAll(); renderPromosList(); renderDashboard(); showToast('Promotion supprimée'); }
function closePromoModal() { closeModal('promoModal'); }

// ─── RÔLES ───────────────────────────────────────────────────
function renderRolesList() {
  const list = document.getElementById('rolesList');
  if (!list || !data) return;
  const roles = data.discordRoles || [];
  if (roles.length === 0) { list.innerHTML = '<p style="color:var(--grey-m);font-size:0.9rem">Aucun rôle configuré.</p>'; return; }
  list.innerHTML = roles.map((r, i) => `<div class="item-row"><div class="item-cat-dot" style="background:${r.color||'#888'}"></div><div class="item-info"><div class="item-name">${esc(r.roleName)} — -${r.discount}%</div><div class="item-meta">ID: ${esc(r.roleId)}</div></div><span class="item-badge badge-role" style="color:${r.color||'#7db8f7'}">${esc(r.roleName)}</span><div class="item-actions"><button class="btn-icon" onclick="openRoleModal(${i})">✏️</button><button class="btn-icon del" onclick="deleteRole(${i})">🗑️</button></div></div>`).join('');
}

function openRoleModal(index = null) {
  if (index !== null && data.discordRoles[index]) {
    const r = data.discordRoles[index];
    document.getElementById('roleModalTitle').textContent = 'Modifier le rôle';
    document.getElementById('roleIdx').value = index; document.getElementById('roleId').value = r.roleId||''; document.getElementById('roleName').value = r.roleName||''; document.getElementById('roleDiscount').value = r.discount||0; document.getElementById('roleColor').value = r.color||'#888888'; document.getElementById('roleColorPicker').value = r.color||'#888888';
  } else {
    document.getElementById('roleModalTitle').textContent = 'Nouveau rôle';
    document.getElementById('roleIdx').value = document.getElementById('roleId').value = document.getElementById('roleName').value = '';
    document.getElementById('roleDiscount').value = 10; document.getElementById('roleColor').value = '#ffd700'; document.getElementById('roleColorPicker').value = '#ffd700';
  }
  openModal('roleModal');
}

async function saveRole() {
  const idx = document.getElementById('roleIdx').value, roleId = document.getElementById('roleId').value.trim(), roleName = document.getElementById('roleName').value.trim();
  const discount = parseInt(document.getElementById('roleDiscount').value)||0, color = document.getElementById('roleColor').value.trim()||'#888888';
  if (!roleId) { alert("L'ID du rôle est obligatoire."); return; }
  if (!roleName) { alert('Le nom du rôle est obligatoire.'); return; }
  const role = { roleId, roleName, discount, color };
  if (!data.discordRoles) data.discordRoles = [];
  if (idx !== '') data.discordRoles[parseInt(idx)] = role; else data.discordRoles.push(role);
  await saveAll(); closeRoleModal(); renderRolesList(); renderDashboard();
  showToast(idx !== '' ? 'Rôle mis à jour !' : 'Rôle ajouté !');
}
function deleteRole(index) { if (!confirm(`Supprimer "${data.discordRoles[index]?.roleName}" ?`)) return; data.discordRoles.splice(index, 1); saveAll(); renderRolesList(); renderDashboard(); showToast('Rôle supprimé'); }
function closeRoleModal() { closeModal('roleModal'); }
function updateColorSwatch() { const val = document.getElementById('roleColor').value; document.getElementById('roleColorPicker').value = isValidColor(val) ? val : '#888888'; }
function syncColorFromPicker() { document.getElementById('roleColor').value = document.getElementById('roleColorPicker').value; }
function isValidColor(str) { return /^#[0-9a-fA-F]{3,6}$/.test(str); }

// ─── CONFIG ───────────────────────────────────────────────────
function loadConfigForm() {
  if (!data?.site) return;
  document.getElementById('cfg-title').value        = data.site.title        || '';
  document.getElementById('cfg-heroTagline').value  = data.site.heroTagline  || '';
  document.getElementById('cfg-subtitle').value     = data.site.subtitle     || '';
  document.getElementById('cfg-discordUrl').value   = data.site.discordUrl   || '';
  document.getElementById('cfg-announcement').value = data.site.announcement || '';
  const isOn = data.site.maintenance_mode === 'true';
  setToggle('toggleMaintenance', isOn);
  updateMaintenanceStatus(isOn);
  const mergeOn = data.site.merge_orders !== 'false'; // activé par défaut
  setToggle('toggleMergeOrders', mergeOn);
  updateMergeOrdersStatus(mergeOn);
}

async function saveConfig() {
  const isOn = isToggleOn('toggleMaintenance');
  data.site = { ...data.site, title: document.getElementById('cfg-title').value.trim(), heroTagline: document.getElementById('cfg-heroTagline').value.trim(), subtitle: document.getElementById('cfg-subtitle').value.trim(), discordUrl: document.getElementById('cfg-discordUrl').value.trim(), announcement: document.getElementById('cfg-announcement').value.trim(), maintenance_mode: isOn ? 'true' : 'false' };
  await saveAll(); updateMaintenanceStatus(isOn); showToast('Configuration sauvegardée !');
}

let _maintenanceBusy = false;
async function toggleMaintenance() {
  if (_maintenanceBusy) return; // évite les doubles clics pendant l'enregistrement
  const toggle = document.getElementById('toggleMaintenance');
  const wasOn  = isToggleOn('toggleMaintenance');
  const wantOn = !wasOn;

  if (wantOn && !confirm("Activer le mode maintenance ?\n\nLes visiteurs seront redirigés vers la page de maintenance.\nToi et le staff (connectés avec Discord) garderez l'accès au site.")) return;

  _maintenanceBusy = true;
  if (toggle) { toggle.disabled = true; toggle.style.opacity = '0.5'; }
  setSaveStatus('saving', 'Sauvegarde...');

  try {
    const res = await fetch('/api/admin/maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ enabled: wantOn })
    });
    let body = {};
    try { body = await res.json(); } catch { /* réponse non JSON */ }
    if (!res.ok) throw new Error(body.error || `Erreur HTTP ${res.status}`);

    // On affiche l'état RÉEL renvoyé par le serveur (pas une supposition)
    const serverState = body.maintenance === true;
    setToggle('toggleMaintenance', serverState);
    updateMaintenanceStatus(serverState);
    if (data?.site) data.site.maintenance_mode = serverState ? 'true' : 'false';
    setSaveStatus('saved', '✓ Sauvegardé');
    setTimeout(() => setSaveStatus('', ''), 2000);
    showToast(serverState ? '🔴 Maintenance activée' : '🟢 Maintenance désactivée — site accessible');
  } catch (e) {
    // Échec : on remet le bouton dans son état d'origine
    setToggle('toggleMaintenance', wasOn);
    updateMaintenanceStatus(wasOn);
    setSaveStatus('error', '✗ Erreur');
    showToast('Maintenance non modifiée : ' + e.message, true);
    console.error('Erreur toggle maintenance :', e);
  } finally {
    _maintenanceBusy = false;
    if (toggle) { toggle.disabled = false; toggle.style.opacity = ''; }
  }
}

// ─── Option : regrouper les commandes dans le ticket ouvert ───
let _mergeBusy = false;
async function toggleMergeOrders() {
  if (_mergeBusy) return;
  const toggle = document.getElementById('toggleMergeOrders');
  const wasOn  = isToggleOn('toggleMergeOrders');
  const wantOn = !wasOn;
  _mergeBusy = true;
  if (toggle) { toggle.disabled = true; toggle.style.opacity = '0.5'; }
  setToggle('toggleMergeOrders', wantOn);
  updateMergeOrdersStatus(wantOn);
  setSaveStatus('saving', 'Sauvegarde...');
  try {
    const res = await fetch('/api/admin/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ site: { merge_orders: wantOn ? 'true' : 'false' } })
    });
    let body = {};
    try { body = await res.json(); } catch { /* réponse non JSON */ }
    if (!res.ok) throw new Error(body.error || `Erreur HTTP ${res.status}`);
    if (data?.site) data.site.merge_orders = wantOn ? 'true' : 'false';
    setSaveStatus('saved', '✓ Sauvegardé');
    setTimeout(() => setSaveStatus('', ''), 2000);
    showToast(wantOn ? '🎫 Regroupement des commandes activé' : '🎫 Un ticket par commande');
  } catch (e) {
    setToggle('toggleMergeOrders', wasOn);
    updateMergeOrdersStatus(wasOn);
    setSaveStatus('error', '✗ Erreur');
    showToast('Option non modifiée : ' + e.message, true);
    console.error('Erreur toggle regroupement :', e);
  } finally {
    _mergeBusy = false;
    if (toggle) { toggle.disabled = false; toggle.style.opacity = ''; }
  }
}

function updateMergeOrdersStatus(isOn) {
  const el = document.getElementById('mergeOrdersStatus');
  if (!el) return;
  el.textContent = isOn ? '🟢 REGROUPEMENT ACTIF' : '⚪ UN TICKET PAR COMMANDE';
  el.style.color = isOn ? '#4ade80' : '#a8aab8';
}

function updateMaintenanceStatus(isOn) {
  const el      = document.getElementById('maintenanceStatus');
  const banner  = document.getElementById('adminMaintenanceBanner');
  const content = document.querySelector('.main-content');
  if (el) {
    el.textContent = isOn ? '🔴 MAINTENANCE ACTIVE' : '🟢 Site accessible';
    el.style.color = isOn ? '#c8102e' : '#4ade80';
  }
  if (banner) banner.style.display = isOn ? 'block' : 'none';
  if (content) content.style.paddingTop = isOn ? '38px' : '';
}

// ─── PARAMÈTRES ──────────────────────────────────────────────
async function changePassword() {
  const p1 = document.getElementById('newPwd1').value, p2 = document.getElementById('newPwd2').value;
  if (!p1) { showToast('Entre un nouveau mot de passe.', true); return; }
  if (p1 !== p2) { showToast('Les deux mots de passe ne correspondent pas.', true); return; }
  if (p1.length < 6) { showToast('Minimum 6 caractères.', true); return; }
  data.adminPassword = p1; await saveAll();
  document.getElementById('newPwd1').value = document.getElementById('newPwd2').value = '';
  showToast('Mot de passe changé ! Reconnecte-toi.'); setTimeout(() => adminLogout(), 2000);
}

// ─── CATÉGORIES ──────────────────────────────────────────────
function renderCategoriesList() {
  const list = document.getElementById('categoriesList');
  if (!list || !data) return;
  const cats = data.categories || [];
  if (cats.length === 0) { list.innerHTML = '<p style="color:var(--grey-m);font-size:0.9rem">Aucune catégorie.</p>'; return; }
  list.innerHTML = cats.map((cat, i) => `
    <div class="item-row" draggable="true" data-index="${i}" ondragstart="onDragStart(event,${i})" ondragover="onDragOver(event)" ondragleave="onDragLeave(event)" ondrop="onCatDrop(event,${i})" ondragend="onDragEnd(event)">
      <span class="drag-handle">⠿</span>
      <div style="width:22px;height:22px;border-radius:50%;background:${cat.color||'#888'};flex-shrink:0;border:2px solid rgba(255,255,255,0.15)"></div>
      <span style="font-size:1.2rem;flex-shrink:0">${cat.icon||'📦'}</span>
      <div class="item-info"><div class="item-name">${esc(cat.name)}</div><div class="item-meta">ID: ${esc(cat.id)} · ${cat.color||'pas de couleur'}</div></div>
      <div class="item-actions"><button class="btn-icon" onclick="openCatModal(${i})">✏️</button><button class="btn-icon del" onclick="deleteCat(${i})">🗑️</button></div>
    </div>`).join('');
}

function openCatModal(index = null) {
  if (index !== null && data.categories[index]) {
    const cat = data.categories[index];
    document.getElementById('catModalTitle').textContent = 'Modifier la catégorie';
    document.getElementById('catIdx').value = index; document.getElementById('catId').value = cat.id||''; document.getElementById('catName').value = cat.name||''; document.getElementById('catIcon').value = cat.icon||''; document.getElementById('catColor').value = cat.color||'#888888'; document.getElementById('catColorPicker').value = cat.color||'#888888';
    document.getElementById('catId').disabled = true;
  } else {
    document.getElementById('catModalTitle').textContent = 'Nouvelle catégorie';
    document.getElementById('catIdx').value = document.getElementById('catId').value = document.getElementById('catName').value = ''; document.getElementById('catIcon').value = '📦'; document.getElementById('catColor').value = '#888888'; document.getElementById('catColorPicker').value = '#888888';
    document.getElementById('catId').disabled = false;
  }
  updateCatPreview(); openModal('catModal');
}

function autoSlug() {
  if (document.getElementById('catIdx').value !== '') return;
  const slug = document.getElementById('catName').value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-');
  document.getElementById('catId').value = slug; updateCatPreview();
}
function updateCatSwatch() { const val = document.getElementById('catColor').value; if (/^#[0-9a-fA-F]{3,6}$/.test(val)) document.getElementById('catColorPicker').value = val; updateCatPreview(); }
function syncCatColor() { document.getElementById('catColor').value = document.getElementById('catColorPicker').value; updateCatPreview(); }
function updateCatPreview() {
  const icon = document.getElementById('catIcon').value||'📦', name = document.getElementById('catName').value||'Nom catégorie', color = document.getElementById('catColor').value||'#888888';
  const preview = document.getElementById('catPreview');
  if (preview) { preview.style.color = color; preview.style.borderColor = color+'60'; preview.style.background = color+'18'; }
  const pi = document.getElementById('catPreviewIcon'), pn = document.getElementById('catPreviewName');
  if (pi) pi.textContent = icon; if (pn) pn.textContent = name;
}
document.addEventListener('input', e => { if (['catIcon','catName','catColor'].includes(e.target.id)) updateCatPreview(); });

async function saveCat() {
  const idx = document.getElementById('catIdx').value, id = document.getElementById('catId').value.trim(), name = document.getElementById('catName').value.trim();
  const icon = document.getElementById('catIcon').value.trim()||'📦', color = document.getElementById('catColor').value.trim()||'#888888';
  if (!id) { alert("L'identifiant est obligatoire."); return; } if (!name) { alert('Le nom est obligatoire.'); return; }
  if (!/^[a-z0-9-]+$/.test(id)) { alert("L'identifiant ne peut contenir que des lettres minuscules, chiffres et tirets."); return; }
  if (idx === '' && (data.categories||[]).some(c => c.id === id)) { alert(`L'identifiant "${id}" existe déjà.`); return; }
  const cat = { id, name, icon, color, position: idx !== '' ? (data.categories[parseInt(idx)]?.position ?? parseInt(idx)) : (data.categories?.length||0) };
  if (!data.categories) data.categories = [];
  if (idx !== '') data.categories[parseInt(idx)] = cat; else data.categories.push(cat);
  await saveAll(); closeCatModal(); renderCategoriesList(); renderDashboard();
  showToast(idx !== '' ? 'Catégorie mise à jour !' : 'Catégorie ajoutée !');
}
function deleteCat(index) {
  const cat = data.categories[index], modsUsing = (data.mods||[]).filter(m => m.category === cat.id).length;
  if (modsUsing > 0) { if (!confirm(`⚠️ ${modsUsing} mod(s) utilisent cette catégorie. Supprimer quand même ?`)) return; }
  else if (!confirm(`Supprimer "${cat.name}" ?`)) return;
  data.categories.splice(index, 1); saveAll(); renderCategoriesList(); renderDashboard(); showToast('Catégorie supprimée');
}
function closeCatModal() { closeModal('catModal'); }
function onCatDrop(e, targetIndex) {
  e.preventDefault(); e.currentTarget.classList.remove('drag-over');
  if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;
  const moved = data.categories.splice(dragSrcIndex, 1)[0];
  data.categories.splice(targetIndex, 0, moved);
  data.categories.forEach((c, i) => { c.position = i; });
  saveAll(); renderCategoriesList(); showToast('Ordre mis à jour !');
}

// ─── RICH TEXT ───────────────────────────────────────────────
function rfmt(cmd, value = null) { document.getElementById('modDesc').focus(); document.execCommand(cmd, false, value); updateRichToolbar(); }
function updateRichToolbar() {
  const cmds = ['bold','italic','underline','insertUnorderedList','insertOrderedList'];
  document.querySelectorAll('.rich-btn').forEach(btn => { const cmd = btn.getAttribute('onclick')?.match(/rfmt\('([^']+)'/)?.[1]; if (cmd && cmds.includes(cmd)) btn.classList.toggle('active', document.queryCommandState(cmd)); });
}
document.addEventListener('selectionchange', () => { if (document.activeElement?.id === 'modDesc') updateRichToolbar(); });

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function setToggle(id, on) { const el = document.getElementById(id); if (!el) return; if (on) el.classList.add('on'); else el.classList.remove('on'); }
function isToggleOn(id) { return document.getElementById(id)?.classList.contains('on') || false; }
function toggleModFeatured()  { document.getElementById('toggleFeatured').classList.toggle('on'); }
function toggleModVisible()   { document.getElementById('toggleVisible').classList.toggle('on'); }
function togglePromoActive()  { document.getElementById('togglePromoActive').classList.toggle('on'); }

let toastTimer = null;
function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg; toast.className = isError ? 'error show' : 'show';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 3200);
}

function esc(str) { if (!str) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatEUR(amount) { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount || 0); }
function toDatetimeLocal(isoStr) { const d = new Date(isoStr), pad = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// ─── LOGO SERVEUR DISCORD ────────────────────────────────────
let _serverIconBase64 = null;

function previewServerIcon(input) {
  const file = input.files[0];
  if (!file) return;

  // Vérif taille max 10 Mo
  if (file.size > 10 * 1024 * 1024) {
    showToast('Image trop lourde (max 10 Mo)', true);
    input.value = '';
    return;
  }

  document.getElementById('iconFileName').textContent = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    _serverIconBase64 = e.target.result; // data:image/png;base64,....

    // Affichage aperçu
    const img         = document.getElementById('iconPreviewImg');
    const placeholder = document.getElementById('iconPreviewPlaceholder');
    const wrap        = document.getElementById('iconPreviewWrap');
    img.src           = _serverIconBase64;
    img.style.display = 'block';
    placeholder.style.display = 'none';
    wrap.style.borderColor    = '#5865F2';
    wrap.style.borderStyle    = 'solid';

    // Activer le bouton
    const btn          = document.getElementById('btnUploadIcon');
    btn.style.opacity  = '1';
    btn.style.pointerEvents = 'auto';

    // Reset status
    const status = document.getElementById('iconUploadStatus');
    status.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

async function uploadServerIcon() {
  if (!_serverIconBase64) return;
  const btn    = document.getElementById('btnUploadIcon');
  const status = document.getElementById('iconUploadStatus');

  btn.disabled    = true;
  btn.textContent = '⏳ Envoi en cours...';
  status.style.display = 'none';

  try {
    const res    = await fetch('/api/admin/upload-logo', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ imageBase64: _serverIconBase64 })
    });
    const result = await res.json();

    if (result.success) {
      status.style.display = 'block';
      status.style.color   = 'var(--green)';
      status.textContent   = '✅ Logo mis à jour sur le site !';
      showToast('Logo du site mis à jour !');
      _serverIconBase64 = null;
      document.getElementById('iconFileInput').value = '';
    } else {
      status.style.display = 'block';
      status.style.color   = 'var(--red)';
      status.textContent   = '❌ ' + (result.error || 'Erreur inconnue');
      showToast('Erreur : ' + (result.error || 'Inconnue'), true);
    }
  } catch (e) {
    status.style.display = 'block';
    status.style.color   = 'var(--red)';
    status.textContent   = '❌ Erreur de connexion au serveur';
    showToast('Erreur serveur', true);
  } finally {
    btn.disabled    = false;
    btn.textContent = '🚀 Mettre à jour le logo';
    btn.style.opacity     = '1';
    btn.style.pointerEvents = 'auto';
  }
}

let _imageList = [];
function loadImageManager(images) { _imageList = [...(images||[])]; renderImageManager(); }
function getImageManagerUrls() { return [..._imageList]; }
function renderImageManager() {
  const container = document.getElementById('imageManager');
  if (!container) return;
  if (_imageList.length === 0) { container.innerHTML = '<div class="img-mgr-empty">Aucune image/vidéo — ajoute une URL ci-dessous</div>'; return; }
  container.innerHTML = _imageList.map((url, i) => {
    const isYT = /youtube\.com|youtu\.be/.test(url), label = isYT ? '▶ Vidéo YouTube' : (i === 0 ? '⭐ Photo principale' : `Photo ${i+1}`);
    const preview = isYT ? `<div style="width:52px;height:36px;background:#ff0000;border-radius:3px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.1rem;flex-shrink:0">▶</div>` : `<img src="${esc(url)}" onerror="this.style.opacity=0.3" loading="lazy" style="width:52px;height:36px;object-fit:cover;border-radius:3px;flex-shrink:0;background:var(--bg-2)">`;
    return `<div class="img-mgr-item" draggable="true" ondragstart="imgDragStart(event,${i})" ondragover="imgDragOver(event)" ondragleave="imgDragLeave(event)" ondrop="imgDrop(event,${i})" ondragend="imgDragEnd(event)" data-idx="${i}">
      <span class="img-mgr-handle">⠿</span>${preview}
      <div class="img-mgr-info"><span class="img-mgr-label">${label}</span><span class="img-mgr-url">${esc(url.length>45?url.substring(0,45)+'…':url)}</span></div>
      <div class="img-mgr-actions">${i>0?`<button class="img-mgr-btn" onclick="imgSetMain(${i})" title="Définir comme principal">★</button>`:''}<button class="img-mgr-btn del" onclick="imgRemove(${i})" title="Supprimer">🗑️</button></div>
    </div>`;
  }).join('');
}
function imgAdd() {
  const input = document.getElementById('imgUrlInput'), url = input.value.trim();
  if (!url) return;
  const isYT = /youtube\.com|youtu\.be/.test(url);
  if (!isYT && !url.startsWith('http')) { alert('URL invalide'); return; }
  _imageList.push(url); input.value = ''; renderImageManager();
}
function imgRemove(i) { _imageList.splice(i,1); renderImageManager(); }
function imgSetMain(i) { const [item] = _imageList.splice(i,1); _imageList.unshift(item); renderImageManager(); }
let _imgDragSrc = null;
function imgDragStart(e,i) { _imgDragSrc=i; e.currentTarget.style.opacity='0.4'; }
function imgDragOver(e)    { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
function imgDragLeave(e)   { e.currentTarget.classList.remove('drag-over'); }
function imgDragEnd(e)     { e.currentTarget.style.opacity=''; document.querySelectorAll('.img-mgr-item').forEach(el=>el.classList.remove('drag-over')); }
function imgDrop(e,targetIdx) { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); if (_imgDragSrc===null||_imgDragSrc===targetIdx) return; const [moved]=_imageList.splice(_imgDragSrc,1); _imageList.splice(targetIdx,0,moved); renderImageManager(); }

// ═══════════════ TEMPS RÉEL (SSE) ═══════════════
let _liveESS        = null;   // EventSource
let _liveInit       = false;  // déjà initialisé ?
let _activityLog    = [];     // historique activité

function initLive() {
  if (_liveInit) return;
  _liveInit = true;
  connectSSE();
}

function connectSSE() {
  if (_liveESS) { _liveESS.close(); }

  setLiveStatus('connecting');
  _liveESS = new EventSource('/api/admin/live-stream');

  _liveESS.addEventListener('snapshot', e => {
    const d = JSON.parse(e.data);
    renderVisitors(d.visitors);
    updateLiveCounters(d.visitors);
  });

  _liveESS.addEventListener('visitor_update', e => {
    const d = JSON.parse(e.data);
    renderVisitors(d.visitors);
    updateLiveCounters(d.visitors);
    if (d.event) pushActivity(d.event);
  });

  _liveESS.addEventListener('new_order', e => {
    const d = JSON.parse(e.data);
    pushActivity({ type: 'order', label: `🎫 Nouveau ticket — ${esc(d.username)} — ${formatEUR(d.total)}`, ts: Date.now() });
    showToast(`🎫 Nouvelle commande de ${d.username} !`);
  });

  _liveESS.onopen = () => setLiveStatus('connected');

  _liveESS.onerror = () => {
    setLiveStatus('disconnected');
    // Reconnexion auto dans 5s
    setTimeout(connectSSE, 5000);
  };
}

function setLiveStatus(state) {
  const dot = document.getElementById('liveDot');
  const txt = document.getElementById('liveStatusTxt');
  if (!dot || !txt) return;
  const map = {
    connecting:   { color: '#f97316', text: 'Connexion en cours...' },
    connected:    { color: '#22c55e', text: '🟢 Connecté — flux en direct actif' },
    disconnected: { color: '#ef4444', text: '🔴 Déconnecté — reconnexion dans 5s...' }
  };
  const s = map[state] || map.disconnected;
  dot.style.background = s.color;
  txt.textContent      = s.text;
  txt.style.color      = s.color;
}

function updateLiveCounters(visitors) {
  const nonEmpty = visitors.filter(v => v.cart && v.cart.length > 0);
  const total    = nonEmpty.reduce((sum, v) => sum + v.cartTotal, 0);
  const vcEl = document.getElementById('liveVisitorCount');
  const ccEl = document.getElementById('liveCartCount');
  const cvEl = document.getElementById('liveCartValue');
  if (vcEl) vcEl.textContent = visitors.length;
  if (ccEl) ccEl.textContent = nonEmpty.length;
  if (cvEl) cvEl.textContent = formatEUR(total);
}

function renderVisitors(visitors) {
  const list = document.getElementById('liveVisitorsList');
  if (!list) return;
  if (!visitors || visitors.length === 0) {
    list.innerHTML = '<p style="color:var(--grey-m);font-size:0.85rem;padding:8px 6px">Aucun visiteur pour le moment.</p>';
    return;
  }
  list.innerHTML = visitors.map(v => {
    const ago      = timeAgo(v.lastSeen);
    const isDiscord = !!v.username;
    const nameHTML  = isDiscord
      ? `<strong style="color:#c9cdfb">${esc(v.username)}</strong> <span style="font-size:0.65rem;background:#5865f2;color:#fff;padding:1px 5px;border-radius:3px;font-family:var(--mono)">Discord</span>`
      : `<span style="color:var(--grey-l)">Visiteur anonyme</span>`;

    const cartHTML = (!v.cart || v.cart.length === 0)
      ? `<div style="font-size:0.75rem;color:var(--grey-m);margin-top:6px;padding-left:2px">🛒 Panier vide</div>`
      : `<div style="margin-top:8px;display:flex;flex-direction:column;gap:3px">
           <div style="font-size:0.72rem;font-weight:700;color:var(--white);margin-bottom:2px">
             🛒 ${v.cart.length} article${v.cart.length > 1 ? 's' : ''} — <span style="color:var(--green);font-family:var(--mono)">${formatEUR(v.cartTotal)}</span>
           </div>
           ${v.cart.map(item => `
             <div style="font-size:0.72rem;color:var(--grey-l);padding-left:10px;display:flex;justify-content:space-between">
               <span>└ ${esc(item.name)}</span>
               <span style="font-family:var(--mono);color:var(--grey-m)">${formatEUR(item.price)}</span>
             </div>`).join('')}
         </div>`;

    return `<div style="background:var(--bg-2);border:1px solid var(--border-b);border-radius:var(--r);padding:12px 14px;transition:border-color 0.2s">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
        <div style="font-size:0.85rem">${nameHTML}</div>
        <div style="font-size:0.68rem;color:var(--grey-m);font-family:var(--mono)">${ago}</div>
      </div>
      ${cartHTML}
    </div>`;
  }).join('');
}

function pushActivity(event) {
  _activityLog.unshift({ ...event, ts: event.ts || Date.now() });
  if (_activityLog.length > 50) _activityLog.pop();
  renderActivityFeed();
}

function renderActivityFeed() {
  const feed = document.getElementById('liveActivityFeed');
  if (!feed) return;
  if (_activityLog.length === 0) {
    feed.innerHTML = '<p style="color:var(--grey-m);font-size:0.82rem;padding:8px">Aucune activité récente.</p>';
    return;
  }
  feed.innerHTML = _activityLog.map(e => {
    const ago   = timeAgo(e.ts);
    const color = e.type === 'order' ? '#22c55e' : e.type === 'leave' ? '#ef4444' : 'var(--grey-m)';
    return `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 6px;border-bottom:1px solid var(--border);font-size:0.78rem">
      <span style="color:${color};flex:1;line-height:1.4">${e.label}</span>
      <span style="color:var(--grey-m);font-family:var(--mono);white-space:nowrap;flex-shrink:0;font-size:0.68rem">${ago}</span>
    </div>`;
  }).join('');
}

function clearActivityFeed() {
  _activityLog = [];
  renderActivityFeed();
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5)  return 'À l\'instant';
  if (diff < 60) return `il y a ${diff}s`;
  const m = Math.floor(diff / 60);
  if (m < 60)    return `il y a ${m}m`;
  return `il y a ${Math.floor(m / 60)}h`;
}

(async () => {
  try {
    const res = await fetch('/api/admin/check'), result = await res.json();
    if (result.isAdmin) { document.getElementById('loginScreen').style.display='none'; document.getElementById('adminApp').style.display='flex'; await loadAdminData(); }
  } catch {}
})();