const express     = require('express');
const session     = require('express-session');
const fetch       = require('node-fetch');
const path        = require('path');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const compression = require('compression');
const { createClient } = require('@supabase/supabase-js');
const { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  if (req.hostname === 'cacsgtavmods.fr') {
    return res.redirect(301, 'https://www.cacsgtavmods.fr' + req.originalUrl);
  }
  next();
});

let config;
try {
  config = require('./config/discord.config');
  console.log('📁 Config chargée depuis discord.config.js');
} catch (e) {
  console.log('⚙️  Config chargée depuis les variables d\'environnement');
  config = {
    CLIENT_ID:            process.env.DISCORD_CLIENT_ID,
    CLIENT_SECRET:        process.env.DISCORD_CLIENT_SECRET,
    REDIRECT_URI:         process.env.DISCORD_REDIRECT_URI,
    GUILD_ID:             process.env.DISCORD_GUILD_ID,
    SESSION_SECRET:       process.env.SESSION_SECRET,
    ADMIN_ROLE_IDS:       process.env.ADMIN_ROLE_IDS ? process.env.ADMIN_ROLE_IDS.split(',') : [],
    SUPABASE_URL:         process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    BOT_TOKEN:            process.env.BOT_TOKEN,
    TICKET_CAT_ID:        process.env.TICKET_CAT_ID,
    STAFF_ROLE_IDS:       process.env.STAFF_ROLE_IDS ? process.env.STAFF_ROLE_IDS.split(',') : [],
  };
}

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

const BOT_TOKEN      = config.BOT_TOKEN      || process.env.BOT_TOKEN;
const TICKET_CAT_ID  = config.TICKET_CAT_ID  || process.env.TICKET_CAT_ID  || '1488660670726799471';
const STAFF_ROLE_IDS = config.STAFF_ROLE_IDS || ['1412494453763211385','1412494594117206141','1439750620788822181'];

const STATUS_CONFIG = {
  pending:    { label: 'En attente', emoji: '🟡', color: 0xf59e0b },
  processing: { label: 'En cours',   emoji: '🔵', color: 0x3b82f6 },
  paid:       { label: 'Payé',       emoji: '💳', color: 0xa855f7 },
  delivered:  { label: 'Livré',      emoji: '🟢', color: 0x22c55e },
  cancelled:  { label: 'Annulé',     emoji: '🔴', color: 0xef4444 },
};

const discordBot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

discordBot.once('ready', () => {
  console.log(`🤖 Bot Discord connecté : ${discordBot.user.tag}`);
});

discordBot.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content === '!close' && message.channel.name?.startsWith('ticket-')) {
    const member  = message.member;
    const isStaff = STAFF_ROLE_IDS.some(roleId => member?.roles.cache.has(roleId));
    if (!isStaff) { await message.reply('❌ Seul un membre du staff peut fermer ce ticket.'); return; }
    await message.channel.send('🔒 Ticket fermé par le staff. Ce salon sera supprimé dans 5 secondes.');
    setTimeout(() => message.channel.delete().catch(() => {}), 5000);
  }
});

discordBot.login(BOT_TOKEN).catch(err => {
  console.error('❌ Erreur connexion bot Discord:', err.message);
});

// ── Helper : créer/éditer l'embed de statut ───────────────────
function buildStatusEmbed(order, status) {
  const s          = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const items      = Array.isArray(order.items) ? order.items : [];
  const itemLines  = items.map(item => {
    const opts  = item.options || {};
    const extra = (opts.debadgage ? 10 : 0) + (opts.retexture ? 5 : 0);
    const total = (parseFloat(item.price) + extra) * (item.quantity || 1);
    const optStr = [opts.debadgage ? 'Debadgage' : '', opts.retexture ? 'Retexture' : ''].filter(Boolean).join(', ');
    return `**${item.name}** — ${formatPrice(total)}${optStr ? ` *(${optStr})*` : ''}`;
  }).join('\n') || 'Aucun article';

  return new EmbedBuilder()
    .setColor(s.color)
    .setTitle(`${s.emoji} Commande — ${s.label}`)
    .addFields(
      { name: '👤 Client',   value: order.discord_username || 'Visiteur', inline: true },
      { name: '💶 Total',    value: formatPrice(order.total_price),         inline: true },
      { name: '📦 Articles', value: itemLines },
      { name: '🔖 Statut',   value: `**${s.emoji} ${s.label}**`,           inline: true },
      { name: '🕐 Créé le',  value: new Date(order.created_at).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }), inline: true }
    )
    .setFooter({ text: 'Cac\'s GTA V Mods · Mise à jour automatique du statut' })
    .setTimestamp();
}

async function updateDiscordEmbed(order, newStatus) {
  try {
    if (!order.channel_id || !order.status_message_id) return;
    const channel = await discordBot.channels.fetch(order.channel_id).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(order.status_message_id).catch(() => null);
    if (!message) return;
    const embed = buildStatusEmbed(order, newStatus);
    await message.edit({ embeds: [embed] });
    console.log(`✅ Embed mis à jour pour la commande ${order.id} → ${newStatus}`);
  } catch (err) {
    console.warn('Impossible de mettre à jour l\'embed Discord:', err.message);
  }
}

// ── 1. BASE ───────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);

// ── SÉCURITÉ ──────────────────────────────────────────────────

// Headers de sécurité (XSS, clickjacking, sniffing...)
app.use(helmet({
  contentSecurityPolicy: false, // désactivé car on charge des fonts Google + iframes YouTube
  crossOriginEmbedderPolicy: false
}));

// Compression gzip/brotli — réduit la taille des réponses de 60-70%
app.use(compression());

// Rate limiting global — 200 req/15min par IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessaie dans quelques minutes.' }
}));

// Rate limiting strict sur les routes sensibles
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives de connexion, réessaie dans 15 minutes.' }
});

const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de commandes envoyées, réessaie dans 10 minutes.' }
});

app.use('/auth/discord', authLimiter);
app.use('/api/order',    orderLimiter);

// ── 2. SESSION ────────────────────────────────────────────────
const SupabaseSessionStore = require('express-session').Store;

class SupabaseStore extends SupabaseSessionStore {
  async get(sid, cb) {
    try {
      const { data } = await supabase.from('sessions').select('sess, expire').eq('sid', sid).single();
      if (!data) return cb(null, null);
      if (new Date(data.expire) < new Date()) { await supabase.from('sessions').delete().eq('sid', sid); return cb(null, null); }
      cb(null, data.sess);
    } catch (e) { cb(null, null); }
  }
  async set(sid, session, cb) {
    try {
      const expire = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await supabase.from('sessions').upsert({ sid, sess: session, expire: expire.toISOString() }, { onConflict: 'sid' });
      cb(null);
    } catch (e) { cb(null); }
  }
  async destroy(sid, cb) {
    try { await supabase.from('sessions').delete().eq('sid', sid); cb(null); } catch (e) { cb(null); }
  }
}

app.use(session({
  store:             new SupabaseStore(),
  secret:            config.SESSION_SECRET || 'fallback-secret',
  resave:            false,
  saveUninitialized: false,
  rolling:           true,
  cookie: {
    secure:   true,
    sameSite: 'none',
    maxAge:   7 * 24 * 60 * 60 * 1000
  }
}));

// ── 3. MAINTENANCE ────────────────────────────────────────────
async function isMaintenanceMode() {
  try {
    const { data } = await supabase.from('site_config').select('value').eq('key', 'maintenance_mode').single();
    return data?.value === 'true';
  } catch (e) { return false; }
}

app.get('/maintenance', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'maintenance.html'));
});

app.use(async (req, res, next) => {
  const bypassPaths = ['/maintenance','/auth/discord','/auth/discord/callback','/auth/logout','/api/user','/api/maintenance-status','/sitemap.xml','/robots.txt'];
  const isAsset = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|webp|map)(\?.*)?$/.test(req.path);
  if (bypassPaths.some(p => req.path.startsWith(p)) || isAsset) return next();
  const maintenance = await isMaintenanceMode();
  if (!maintenance) return next();
  const user    = req.session.user;
  if (!user) return res.redirect('/maintenance');
  const isStaff = STAFF_ROLE_IDS.some(id => user.roles.includes(id));
  const isAdmin = config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id));
  if (isStaff || isAdmin) return next();
  return res.redirect('/maintenance');
});

// ── 4. STATIC ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── 5. MAINTENANCE STATUS ─────────────────────────────────────
app.get('/api/maintenance-status', async (req, res) => {
  const maintenance = await isMaintenanceMode();
  const user    = req.session.user;
  const isStaff = user && STAFF_ROLE_IDS.some(id => user.roles.includes(id));
  const isAdmin = user && config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id));
  res.json({ maintenance, isStaff: !!(isStaff || isAdmin) });
});

// ── 6. HELPERS SUPABASE ───────────────────────────────────────
async function getSiteConfig() {
  const { data, error } = await supabase.from('site_config').select('key, value');
  if (error) throw error;
  return Object.fromEntries(data.map(r => [r.key, r.value]));
}
async function getCategories() {
  const { data, error } = await supabase.from('categories').select('*').order('position', { ascending: true });
  if (error) throw error;
  return data;
}
async function getMods(visibleOnly = false) {
  let query = supabase.from('mods').select('*').order('position', { ascending: true });
  if (visibleOnly) query = query.eq('visible', true);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
async function getPromotions(activeOnly = false) {
  let query = supabase.from('promotions').select('*').order('created_at', { ascending: false });
  if (activeOnly) query = query.eq('active', true).gt('end_date', new Date().toISOString());
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
async function getDiscordRoles() {
  const { data, error } = await supabase.from('discord_roles').select('*');
  if (error) throw error;
  return data;
}

function formatPrice(amount) {
  if (!amount || parseFloat(amount) <= 0) return 'Gratuit';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount || 0);
}

function formatData(site, categories, mods, promotions, discordRoles) {
  return {
    site: {
      title:            site.title            || '',
      subtitle:         site.subtitle         || '',
      discordUrl:       site.discordUrl       || '',
      announcement:     site.announcement     || '',
      heroTagline:      site.heroTagline      || '',
      maintenance_mode: site.maintenance_mode || 'false',
      logo_url:         site.logo_url         || ''
    },
    categories,
    mods: mods.map(m => ({
      id:          m.id,
      name:        m.name,
      category:    m.category,
      description: m.description || '',
      image:       m.image       || '',
      images:      Array.isArray(m.images) ? m.images : (typeof m.images === 'string' ? JSON.parse(m.images || '[]') : []),
      basePrice:   parseFloat(m.base_price),
      featured:    m.featured,
      visible:     m.visible,
      position:    m.position,
      createdAt:   m.created_at || null
    })),
    promotions: promotions.map(p => ({
      id:                p.id,
      name:              p.name,
      description:       p.description    || '',
      discountPercent:   p.discount_percent,
      endDate:           p.end_date,
      applyToCategories: p.apply_to_categories || [],
      active:            p.active,
      color:             p.color
    })),
    discordRoles: discordRoles.map(r => ({
      roleId:   r.role_id,
      roleName: r.role_name,
      discount: r.discount,
      color:    r.color
    }))
  };
}

// ── 7. MIDDLEWARE ADMIN ───────────────────────────────────────
function requireAdmin(req, res, next) {
  const user = req.session.user;
  if (!user) return res.status(401).json({ error: 'Non connecté.' });
  const hasAdminRole = config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id));
  if (hasAdminRole) { req.session.isAdmin = true; return next(); }
  res.status(403).json({ error: "Accès refusé." });
}

// ── 8. DISCORD OAUTH2 ─────────────────────────────────────────
app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({ client_id: config.CLIENT_ID, redirect_uri: config.REDIRECT_URI, response_type: 'code', scope: 'identify guilds.members.read guilds.join' });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');
  try {
    const tokenRes  = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.CLIENT_ID, client_secret: config.CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: config.REDIRECT_URI }) });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect('/?error=token_failed');
    const userRes  = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const userData = await userRes.json();
    let memberRoles = [];
    try { await fetch(`https://discord.com/api/guilds/${config.GUILD_ID}/members/${userData.id}`, { method: 'PUT', headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: tokenData.access_token }) }); } catch (e) {}
    try { const memberRes = await fetch(`https://discord.com/api/users/@me/guilds/${config.GUILD_ID}/member`, { headers: { Authorization: `Bearer ${tokenData.access_token}` } }); const memberData = await memberRes.json(); memberRoles = memberData.roles || []; } catch (e) {}
    req.session.user = { id: userData.id, username: userData.username, avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png', roles: memberRoles };
    if (config.ADMIN_ROLE_IDS.some(id => memberRoles.includes(id))) req.session.isAdmin = true;
    res.redirect('/');
  } catch (err) { console.error('Erreur OAuth Discord:', err); res.redirect('/?error=oauth_failed'); }
});

app.post('/auth/logout', (req, res) => { req.session.user = null; req.session.isAdmin = false; res.json({ success: true }); });

// ── 9. PROTECTION /admin ──────────────────────────────────────
app.get('/admin',  (req, res, next) => { const user = req.session.user; if (user && config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id))) return next(); res.status(404).send('404 - Page non trouvée'); });
app.get('/admin/', (req, res, next) => { const user = req.session.user; if (user && config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id))) return next(); res.status(404).send('404 - Page non trouvée'); });

// ── 10. API PUBLIQUE ──────────────────────────────────────────

// Cache en mémoire — 60 secondes
let publicCache     = null;
let publicCacheTime = 0;
const CACHE_TTL     = 60 * 1000; // 60 secondes

function invalidatePublicCache() {
  publicCache     = null;
  publicCacheTime = 0;
}

app.get('/api/public', async (req, res) => {
  try {
    const now = Date.now();
    if (publicCache && (now - publicCacheTime) < CACHE_TTL) {
      return res.json(publicCache);
    }
    const [site, categories, mods, promotions, discordRoles] = await Promise.all([getSiteConfig(), getCategories(), getMods(true), getPromotions(true), getDiscordRoles()]);
    publicCache     = formatData(site, categories, mods, promotions, discordRoles);
    publicCacheTime = now;
    res.json(publicCache);
  } catch (err) { console.error('Erreur /api/public:', err); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/user', async (req, res) => {
  if (!req.session.user) return res.json({ connected: false });
  try {
    const user  = req.session.user;
    const roles = await getDiscordRoles();
    let bestDiscount = 0, appliedRole = null, roleColor = null;
    for (const role of roles) {
      if (user.roles.includes(role.role_id) && role.discount > bestDiscount) { bestDiscount = role.discount; appliedRole = role.role_name; roleColor = role.color; }
    }
    const isAdmin = config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id));
    res.json({ connected: true, id: user.id, username: user.username, avatar: user.avatar, discount: bestDiscount, roleName: appliedRole, roleColor, isAdmin });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── 11. API ADMIN ─────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ error: "Connectez-vous d'abord via Discord." });
  if (config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id))) { req.session.isAdmin = true; res.json({ success: true, username: user.username }); }
  else res.status(403).json({ error: "Vous n'avez pas le rôle requis." });
});
app.post('/api/admin/logout', (req, res) => { req.session.isAdmin = false; res.json({ success: true }); });
app.get('/api/admin/check', (req, res) => {
  const user = req.session.user;
  res.json({ isAdmin: !!req.session.isAdmin || (user && config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id))) });
});
app.get('/api/admin/data', requireAdmin, async (req, res) => {
  try {
    const [site, categories, mods, promotions, discordRoles] = await Promise.all([getSiteConfig(), getCategories(), getMods(), getPromotions(), getDiscordRoles()]);
    res.json(formatData(site, categories, mods, promotions, discordRoles));
  } catch (err) { res.status(500).json({ error: 'Erreur lecture base de données' }); }
});

// ── API COMMANDES ─────────────────────────────────────────────
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const { data: orders, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(orders);
  } catch (err) { res.status(500).json({ error: 'Erreur lecture commandes' }); }
});

app.patch('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const { id }     = req.params;
  const { status } = req.body;

  if (!STATUS_CONFIG[status]) return res.status(400).json({ error: 'Statut invalide' });

  try {
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', id).single();
    if (error || !order) return res.status(404).json({ error: 'Commande introuvable' });

    await supabase.from('orders').update({ status }).eq('id', id);

    await updateDiscordEmbed(order, status);

    res.json({ success: true, status });
  } catch (err) {
    console.error('Erreur mise à jour statut:', err);
    res.status(500).json({ error: 'Erreur mise à jour statut' });
  }
});

// ── API STATS ─────────────────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const { data: orders, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const totalOrders  = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0);
    const modCounts    = {};
    let totalDebadgage = 0, totalRetexture = 0, totalCore = 0, totalItems = 0;
    for (const order of orders) {
      if (order.core_option) totalCore++;
      const items = Array.isArray(order.items) ? order.items : [];
      for (const item of items) {
        totalItems++;
        if (item.options?.debadgage) totalDebadgage++;
        if (item.options?.retexture) totalRetexture++;
        if (!modCounts[item.name]) modCounts[item.name] = { count: 0, revenue: 0 };
        modCounts[item.name].count++;
        modCounts[item.name].revenue += (parseFloat(item.price) || 0) * (item.quantity || 1);
      }
    }
    const topMods      = Object.entries(modCounts).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.count - a.count).slice(0, 5);
    const pctDebadgage = totalItems  > 0 ? Math.round((totalDebadgage / totalItems)  * 100) : 0;
    const pctRetexture = totalItems  > 0 ? Math.round((totalRetexture / totalItems)  * 100) : 0;
    const pctCore      = totalOrders > 0 ? Math.round((totalCore      / totalOrders) * 100) : 0;
    const last7        = {};
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); last7[d.toISOString().slice(0, 10)] = 0; }
    for (const order of orders) { const day = order.created_at?.slice(0, 10); if (day && last7[day] !== undefined) last7[day]++; }
    res.json({ totalOrders, totalRevenue, topMods, pctDebadgage, pctRetexture, pctCore, last7Days: Object.entries(last7).map(([date, count]) => ({ date, count })), recentOrders: orders.slice(0, 10) });
  } catch (err) { res.status(500).json({ error: 'Erreur lecture stats' }); }
});

app.delete('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('orders').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Erreur suppression commande:', err);
    res.status(500).json({ error: 'Erreur suppression commande' });
  }
});

app.delete('/api/admin/stats/reset', requireAdmin, async (req, res) => {
  try { await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000'); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: 'Erreur reset stats' }); }
});

// ══════════════════════════════════════════════════════════════
//  TEMPS RÉEL — Server-Sent Events (SSE)
// ══════════════════════════════════════════════════════════════

const liveVisitors    = new Map();  // visitorId → { username, cart, cartTotal, lastSeen, connectedAt }
const adminSSEClients = new Set();  // connexions admin SSE actives
const VISITOR_TIMEOUT = 2 * 60 * 1000; // 2 min d'inactivité → supprimé

setInterval(() => {
  const now = Date.now(); let changed = false;
  for (const [id, v] of liveVisitors) {
    if (now - v.lastSeen > VISITOR_TIMEOUT) { liveVisitors.delete(id); changed = true; }
  }
  if (changed) broadcastLive({ type: 'visitor_update', visitors: getVisitorsList() });
}, 30000);

function getVisitorsList() {
  return Array.from(liveVisitors.values()).sort((a, b) => b.lastSeen - a.lastSeen);
}

function broadcastLive(payload) {
  const msg = `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of adminSSEClients) {
    try { client.write(msg); } catch (e) { adminSSEClients.delete(client); }
  }
}

// Connexion SSE admin
app.get('/api/admin/live-stream', requireAdmin, (req, res) => {
  res.setHeader('Content-Type',        'text/event-stream');
  res.setHeader('Cache-Control',       'no-cache');
  res.setHeader('Connection',          'keep-alive');
  res.setHeader('X-Accel-Buffering',   'no');
  res.flushHeaders();
  res.write(`event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', visitors: getVisitorsList() })}\n\n`);
  adminSSEClients.add(res);
  const keepAlive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => { clearInterval(keepAlive); adminSSEClients.delete(res); });
});

// Heartbeat visiteur
app.post('/api/visitor/ping', (req, res) => {
  const { visitorId, username, cart, cartTotal } = req.body;
  if (!visitorId) return res.json({ ok: false });
  const existing = liveVisitors.get(visitorId);
  const isNew    = !existing;
  liveVisitors.set(visitorId, {
    username:    username || null,
    cart:        Array.isArray(cart) ? cart : [],
    cartTotal:   cartTotal || 0,
    lastSeen:    Date.now(),
    connectedAt: existing?.connectedAt || Date.now()
  });
  let event = null;
  if (isNew) {
    const who = username || 'Visiteur anonyme';
    event = { type: 'join', label: `👤 ${who} a ouvert le site`, ts: Date.now() };
  } else if (cart?.length > 0 && existing.cart?.length !== cart.length) {
    const who  = username || 'Un visiteur';
    const last = cart[cart.length - 1];
    event = { type: 'cart', label: `🛒 ${who} a modifié son panier — ${last?.name || ''}`, ts: Date.now() };
  }
  broadcastLive({ type: 'visitor_update', visitors: getVisitorsList(), event });
  res.json({ ok: true });
});

// Départ visiteur
app.post('/api/visitor/leave', (req, res) => {
  const { visitorId } = req.body;
  if (visitorId && liveVisitors.has(visitorId)) {
    const v = liveVisitors.get(visitorId);
    liveVisitors.delete(visitorId);
    broadcastLive({ type: 'visitor_update', visitors: getVisitorsList(), event: { type: 'leave', label: `👋 ${v.username || 'Visiteur anonyme'} a quitté le site`, ts: Date.now() } });
  }
  res.json({ ok: true });
});

// ── 📢 API LOGO SITE — Supabase Storage ──────────────────────
app.post('/api/admin/upload-logo', requireAdmin, async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Aucune image fournie.' });
  if (!imageBase64.startsWith('data:image/')) return res.status(400).json({ error: 'Format invalide.' });

  try {
    // Extraire le type MIME et les données base64
    const matches  = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Format base64 invalide.' });
    const mimeType = matches[1];                          // ex: image/png
    const ext      = mimeType.split('/')[1];              // ex: png
    const buffer   = Buffer.from(matches[2], 'base64');
    const fileName = `logo.${ext}`;

    // Upload vers Supabase Storage (bucket "assets", fichier logo.png)
    const { error: uploadError } = await supabase.storage
      .from('assets')
      .upload(fileName, buffer, {
        contentType:  mimeType,
        upsert:       true,        // écrase si déjà existant
        cacheControl: '3600'
      });

    if (uploadError) throw new Error(uploadError.message);

    // Récupérer l'URL publique
    const { data: urlData } = supabase.storage
      .from('assets')
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    // Sauvegarder l'URL dans site_config
    await supabase.from('site_config').upsert(
      { key: 'logo_url', value: publicUrl },
      { onConflict: 'key' }
    );

    invalidatePublicCache();
    console.log('🖼️  Logo mis à jour :', publicUrl);
    res.json({ success: true, url: publicUrl });

  } catch (err) {
    console.error('❌ Erreur upload logo:', err.message);
    res.status(500).json({ error: err.message });
  }
});
// Constantes de l'annonce Discord
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID || '';
const ANNOUNCE_ROLE_ID    = '1489946990405095495';
const SHOP_URL            = 'https://cacsgtavmods.fr/';
const EMBED_BANNER_URL    = 'https://img.draftbot.fr/1773366849212-87a12e25b4502138.png';

app.post('/api/admin/discord-announce', requireAdmin, async (req, res) => {
  const { modName, modPrice, modLink } = req.body;

  // Validation
  if (!modName) return res.status(400).json({ error: 'Nom du mod manquant.' });
  if (!ANNOUNCE_CHANNEL_ID) {
    return res.status(500).json({
      error: 'Variable d\'environnement ANNOUNCE_CHANNEL_ID non configurée sur Railway.'
    });
  }

  try {
    // Récupération du salon Discord
    const channel = await discordBot.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
    if (!channel) {
      return res.status(500).json({
        error: `Salon Discord introuvable. Vérifiez ANNOUNCE_CHANNEL_ID (${ANNOUNCE_CHANNEL_ID}).`
      });
    }

    // Construction de la description de l'embed
    let description = `Un nouvel asset est disponible sur notre boutique :\n`;
    description    += `**${SHOP_URL}**\n\n`;
    if (modLink) {
      description += `🔗 **[Voir le mod directement](${modLink})**\n\n`;
    }
    description += `Utilisez le lien ci-dessous pour consulter le nouvel asset mis en vente !\n\n`;
    description += `N'oubliez pas de vous connecter avec Discord directement sur notre site `;
    description += `(connexion sécurisée), ajoutez ensuite les assets souhaités dans votre panier `;
    description += `et validez-le. Un ticket avec votre demande sera automatiquement créé sur notre Discord.\n\n`;
    description += `En cas de besoin, le salon **#🎫︱Creer-Ticket** reste à votre disposition. `;
    description += `Ce salon reste aussi utile pour toute demande de partenariat ou toute commande privée, `;
    description += `choisissez simplement le bouton qui correspond à votre demande.`;

    // Construction de l'embed Discord
    const announceEmbed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle('NOUVEL ASSET PUBLIÉ SUR NOTRE BOUTIQUE !')
      .setDescription(description)
      .setImage(EMBED_BANNER_URL)
      .setFooter({ text: "Cac's GTAV Mods" });

    // Envoi du message avec ping du rôle + embed
    await channel.send({
      content: `<@&${ANNOUNCE_ROLE_ID}>`,
      embeds:  [announceEmbed],
    });

    console.log(`📢 Annonce Discord envoyée pour le mod : "${modName}"`);
    res.json({ success: true });

  } catch (err) {
    console.error('❌ Erreur annonce Discord:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/save', requireAdmin, async (req, res) => {
  const d = req.body;
  try {
    if (d.site) { for (const [key, value] of Object.entries(d.site)) await supabase.from('site_config').upsert({ key, value: String(value) }, { onConflict: 'key' }); }
    if (d.categories?.length) {
      const { data: existingCats } = await supabase.from('categories').select('id');
      const toDeleteCats = (existingCats || []).map(c => c.id).filter(id => !d.categories.find(c => c.id === id));
      if (toDeleteCats.length > 0) await supabase.from('categories').delete().in('id', toDeleteCats);
      for (const cat of d.categories) await supabase.from('categories').upsert({ id: cat.id, name: cat.name, color: cat.color || '#ffffff', icon: cat.icon || '📦', position: cat.position ?? 0 }, { onConflict: 'id' });
    }
    if (d.mods) {
      const { data: existingMods } = await supabase.from('mods').select('id');
      const toDelete = (existingMods || []).map(m => m.id).filter(id => !d.mods.find(m => m.id === id));
      if (toDelete.length > 0) await supabase.from('mods').delete().in('id', toDelete);
      for (const mod of d.mods) {
        const { error: e } = await supabase.from('mods').upsert({ id: mod.id, name: mod.name, category: mod.category, description: mod.description || '', image: mod.image || '', base_price: mod.basePrice || 0, images: mod.images || [], featured: mod.featured || false, visible: mod.visible !== false, position: mod.position ?? 0 }, { onConflict: 'id' });
        if (e) console.error('❌ Erreur upsert mod:', e.message);
      }
    }
    if (d.promotions) {
      const { data: existingPromos } = await supabase.from('promotions').select('id');
      const toDeletePromos = (existingPromos || []).map(p => p.id).filter(id => !d.promotions.find(p => p.id === id));
      if (toDeletePromos.length > 0) await supabase.from('promotions').delete().in('id', toDeletePromos);
      for (const promo of d.promotions) await supabase.from('promotions').upsert({ id: promo.id, name: promo.name, description: promo.description || '', discount_percent: promo.discountPercent || 0, end_date: promo.endDate, apply_to_categories: promo.applyToCategories || [], active: promo.active !== false, color: promo.color || '#cc0000' }, { onConflict: 'id' });
    }
    if (d.discordRoles) {
      const { data: existingRoles } = await supabase.from('discord_roles').select('role_id');
      const toDeleteRoles = (existingRoles || []).map(r => r.role_id).filter(id => !d.discordRoles.find(r => r.roleId === id));
      if (toDeleteRoles.length > 0) await supabase.from('discord_roles').delete().in('role_id', toDeleteRoles);
      for (const role of d.discordRoles) await supabase.from('discord_roles').upsert({ role_id: role.roleId, role_name: role.roleName, discount: role.discount || 0, color: role.color || '#ffffff' }, { onConflict: 'role_id' });
    }
    res.json({ success: true });
    invalidatePublicCache(); // invalide le cache après chaque sauvegarde admin
  } catch (err) { res.status(500).json({ error: 'Erreur sauvegarde : ' + err.message }); }
});

// ── 12. API COMMANDE ──────────────────────────────────────────
app.post('/api/order', async (req, res) => {
  const { items, totalPrice, discordUser } = req.body;

  // 🔒 Connexion Discord obligatoire
  if (!discordUser?.id || !discordUser?.username) {
    return res.status(401).json({ error: 'Vous devez être connecté avec Discord pour passer commande.' });
  }

  // Validation des inputs
  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Panier vide.' });
  if (items.length > 20) return res.status(400).json({ error: 'Trop d\'articles dans le panier.' });
  if (typeof totalPrice !== 'number' || totalPrice < 0 || totalPrice > 10000) return res.status(400).json({ error: 'Prix invalide.' });
  for (const item of items) {
    if (!item.name || typeof item.name !== 'string' || item.name.length > 200) return res.status(400).json({ error: 'Article invalide.' });
    if (typeof item.price !== 'number' || item.price < 0) return res.status(400).json({ error: 'Prix article invalide.' });
  }
  try {
    const guild = discordBot.guilds.cache.first();
    if (!guild) return res.status(500).json({ error: 'Bot non connecté au serveur Discord.' });

    let member = null;
    if (discordUser?.id) { try { member = await guild.members.fetch(discordUser.id); } catch (e) {} }

    const timestamp  = Date.now().toString().slice(-5);
    const username   = discordUser?.username || 'visiteur';
    const ticketName = `ticket-${username.toLowerCase().replace(/[^a-z0-9]/g, '')}-${timestamp}`;

    const permissionOverwrites = [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }];
    if (member) permissionOverwrites.push({ id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    for (const roleId of STAFF_ROLE_IDS) permissionOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] });

    const channel = await guild.channels.create({ name: ticketName, type: ChannelType.GuildText, parent: TICKET_CAT_ID, permissionOverwrites, topic: `Commande de ${username} — ${new Date().toLocaleDateString('fr-FR')}` });

    const coreOption    = req.body.coreOption || false;
    const itemLines     = items.map(item => {
      const opts = item.options || {};
      const extra = (opts.debadgage ? 10 : 0) + (opts.retexture ? 5 : 0);
      const total = (item.price + extra) * item.quantity;
      const optStr = [opts.debadgage ? '🔧 Debadgage (+10€)' : '', opts.retexture ? '🎨 Retexture (+5€)' : ''].filter(Boolean).join(', ');
      return `> 🔹 **${item.name}** — **${formatPrice(total)}**${optStr ? `\n>    └ ${optStr}` : ''}`;
    }).join('\n');

    const coreLines     = coreOption ? `\n> 📦 **Ressource [CORE]** — **${formatPrice(10)}**` : '';
    const staffMentions = STAFF_ROLE_IDS.map(id => `<@&${id}>`).join(' ');
    const clientMention = member ? `<@${member.id}>` : `**${username}**`;

    await channel.send([
      `# 🛒 Nouvelle commande — ${new Date().toLocaleDateString('fr-FR')}`,
      ``, `**Client :** ${clientMention}`, `**Total :** **${formatPrice(totalPrice)}**`,
      ``, `## 📦 Articles commandés`, itemLines + coreLines,
      ``, `## 👷 Staff notifié`, staffMentions,
      ``, `---`, `*Pour fermer ce ticket : tapez* \`!close\``,
    ].join('\n'));

    // Embed de statut initial
    const orderData = { discord_username: username, discord_id: discordUser?.id || null, ticket_channel: ticketName, total_price: totalPrice, items, core_option: coreOption, created_at: new Date().toISOString() };
    const embed     = buildStatusEmbed(orderData, 'pending');
    const embedMsg  = await channel.send({ embeds: [embed] });

    // Sauvegarder la commande avec channel_id et status_message_id
    try {
      await supabase.from('orders').insert({
        ...orderData,
        channel_id:        channel.id,
        status_message_id: embedMsg.id,
        status:            'pending'
      });
    } catch (e) { console.warn('Impossible de sauvegarder la commande:', e.message); }

    console.log(`🎫 Ticket créé : #${ticketName} pour ${username}`);
    // Notifier le dashboard temps réel
    broadcastLive({ type: 'new_order', username, total: totalPrice });
    res.json({ success: true, ticketChannel: ticketName, channelId: channel.id });

  } catch (err) { console.error('Erreur création ticket:', err); res.status(500).json({ error: 'Impossible de créer le ticket : ' + err.message }); }
});

// ── 13. CGVU ─────────────────────────────────────────────────
app.get('/cgvu', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cgvu.html'));
});

// ── 14. SITEMAP DYNAMIQUE ─────────────────────────────────────
app.get('/sitemap.xml', async (req, res) => {
  try {
    const mods  = await getMods(true);
    const today = new Date().toISOString().slice(0, 10);
    const modUrls = mods.map(m => `\n  <url><loc>https://cacs-gtavmods.fr/#${encodeURIComponent(m.id)}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://cacs-gtavmods.fr/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>${modUrls}\n</urlset>`;
    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) { res.status(500).send('Erreur génération sitemap'); }
});

// ── DÉMARRAGE ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║           CAC\'S GTA V MODS               ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`🌐  Site vitrine  →  http://localhost:${PORT}`);
  console.log(`⚙️   Panel Admin  →  http://localhost:${PORT}/admin`);
  console.log(`🗄️   Base de données → Supabase\n`);

  // Nettoyage des sessions expirées — toutes les heures
  setInterval(async () => {
    try {
      const { error, count } = await supabase
        .from('sessions')
        .delete()
        .lt('expire', new Date().toISOString());
      if (!error) console.log(`🧹 Sessions expirées nettoyées`);
    } catch (e) {
      console.warn('Erreur nettoyage sessions:', e.message);
    }
  }, 60 * 60 * 1000);
});