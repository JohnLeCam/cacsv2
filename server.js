// ============================================================
//  SERVER.JS - Cac's GTA V Mods
//  Express + Discord OAuth2 + Supabase
// ============================================================

const express  = require('express');
const session  = require('express-session');
const fetch    = require('node-fetch');
const path     = require('path');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CONFIG — fichier local en dev, variables d'env en prod ───
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
  };
}

// ── SUPABASE ──────────────────────────────────────────────────
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret:            config.SESSION_SECRET || 'fallback-secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// ── HELPERS SUPABASE ──────────────────────────────────────────

async function getSiteConfig() {
  const { data, error } = await supabase.from('site_config').select('key, value');
  if (error) throw error;
  return Object.fromEntries(data.map(r => [r.key, r.value]));
}

async function getCategories() {
  const { data, error } = await supabase
    .from('categories').select('*').order('position', { ascending: true });
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

function formatData(site, categories, mods, promotions, discordRoles) {
  return {
    site: {
      title:        site.title        || '',
      subtitle:     site.subtitle     || '',
      discordUrl:   site.discordUrl   || '',
      announcement: site.announcement || '',
      heroTagline:  site.heroTagline  || ''
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
      position:    m.position
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

// ── MIDDLEWARE ADMIN ──────────────────────────────────────────
function requireAdmin(req, res, next) {
  const user = req.session.user;
  if (!user) return res.status(401).json({ error: 'Non connecté. Connectez-vous via Discord.' });
  const hasAdminRole = config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id));
  if (hasAdminRole) { req.session.isAdmin = true; return next(); }
  res.status(403).json({ error: "Accès refusé. Vous n'avez pas les droits admin." });
}

// ── DISCORD OAUTH2 ────────────────────────────────────────────

app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id:     config.CLIENT_ID,
    redirect_uri:  config.REDIRECT_URI,
    response_type: 'code',
    scope:         'identify guilds.members.read'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        client_id:     config.CLIENT_ID,
        client_secret: config.CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  config.REDIRECT_URI
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect('/?error=token_failed');

    const userRes  = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();

    let memberRoles = [];
    try {
      const memberRes  = await fetch(
        `https://discord.com/api/users/@me/guilds/${config.GUILD_ID}/member`,
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      );
      const memberData = await memberRes.json();
      memberRoles = memberData.roles || [];
    } catch (e) {
      console.warn('Impossible de récupérer les rôles Discord');
    }

    req.session.user = {
      id:       userData.id,
      username: userData.username,
      avatar:   userData.avatar
        ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
        : 'https://cdn.discordapp.com/embed/avatars/0.png',
      roles: memberRoles
    };

    const isAdmin = config.ADMIN_ROLE_IDS.some(id => memberRoles.includes(id));
    if (isAdmin) {
      req.session.isAdmin = true;
      return res.redirect('/admin');
    }
    res.redirect('/');
  } catch (err) {
    console.error('Erreur OAuth Discord:', err);
    res.redirect('/?error=oauth_failed');
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.user = null;
  req.session.isAdmin = false;
  res.json({ success: true });
});

// ── API PUBLIQUE ──────────────────────────────────────────────

app.get('/api/public', async (req, res) => {
  try {
    const [site, categories, mods, promotions, discordRoles] = await Promise.all([
      getSiteConfig(), getCategories(), getMods(true), getPromotions(true), getDiscordRoles()
    ]);
    res.json(formatData(site, categories, mods, promotions, discordRoles));
  } catch (err) {
    console.error('Erreur /api/public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/user', async (req, res) => {
  if (!req.session.user) return res.json({ connected: false });
  try {
    const user  = req.session.user;
    const roles = await getDiscordRoles();
    let bestDiscount = 0, appliedRole = null, roleColor = null;
    for (const role of roles) {
      if (user.roles.includes(role.role_id) && role.discount > bestDiscount) {
        bestDiscount = role.discount;
        appliedRole  = role.role_name;
        roleColor    = role.color;
      }
    }
    const isAdmin = config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id));
    res.json({ connected: true, username: user.username, avatar: user.avatar, discount: bestDiscount, roleName: appliedRole, roleColor, isAdmin });
  } catch (err) {
    console.error('Erreur /api/user:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── API ADMIN ─────────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ error: "Connectez-vous d'abord via Discord." });
  const hasAdminRole = config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id));
  if (hasAdminRole) { req.session.isAdmin = true; res.json({ success: true, username: user.username }); }
  else res.status(403).json({ error: 'Vous n\'avez pas le rôle requis.' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
  const user    = req.session.user;
  const isAdmin = !!req.session.isAdmin || (user && config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id)));
  res.json({ isAdmin });
});

app.get('/api/admin/data', requireAdmin, async (req, res) => {
  try {
    const [site, categories, mods, promotions, discordRoles] = await Promise.all([
      getSiteConfig(), getCategories(), getMods(), getPromotions(), getDiscordRoles()
    ]);
    res.json(formatData(site, categories, mods, promotions, discordRoles));
  } catch (err) {
    console.error('Erreur /api/admin/data:', err);
    res.status(500).json({ error: 'Erreur lecture base de données' });
  }
});

app.post('/api/admin/save', requireAdmin, async (req, res) => {
  const d = req.body;
  try {
    if (d.site) {
      for (const [key, value] of Object.entries(d.site)) {
        await supabase.from('site_config').upsert({ key, value: String(value) }, { onConflict: 'key' });
      }
    }
    if (d.categories?.length) {
      const ids = d.categories.map(c => c.id);
      await supabase.from('categories').delete().not('id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`);
      for (const cat of d.categories) {
        await supabase.from('categories').upsert({ id: cat.id, name: cat.name, color: cat.color || '#ffffff', icon: cat.icon || '📦', position: cat.position ?? 0 }, { onConflict: 'id' });
      }
    }
    if (d.mods) {
      const ids = d.mods.map(m => m.id);
      if (ids.length > 0) await supabase.from('mods').delete().not('id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`);
      else await supabase.from('mods').delete().neq('id', '');
      for (const mod of d.mods) {
        await supabase.from('mods').upsert({
          id: mod.id, name: mod.name, category: mod.category,
          description: mod.description || '', image: mod.image || '',
          base_price: mod.basePrice || 0, images: mod.images || [],
          featured: mod.featured || false, visible: mod.visible !== false, position: mod.position ?? 0
        }, { onConflict: 'id' });
      }
    }
    if (d.promotions) {
      const ids = d.promotions.map(p => p.id);
      if (ids.length > 0) await supabase.from('promotions').delete().not('id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`);
      else await supabase.from('promotions').delete().neq('id', '');
      for (const promo of d.promotions) {
        await supabase.from('promotions').upsert({
          id: promo.id, name: promo.name, description: promo.description || '',
          discount_percent: promo.discountPercent || 0, end_date: promo.endDate,
          apply_to_categories: promo.applyToCategories || [],
          active: promo.active !== false, color: promo.color || '#cc0000'
        }, { onConflict: 'id' });
      }
    }
    if (d.discordRoles) {
      const ids = d.discordRoles.map(r => r.roleId);
      if (ids.length > 0) await supabase.from('discord_roles').delete().not('role_id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`);
      else await supabase.from('discord_roles').delete().neq('role_id', '');
      for (const role of d.discordRoles) {
        await supabase.from('discord_roles').upsert({ role_id: role.roleId, role_name: role.roleName, discount: role.discount || 0, color: role.color || '#ffffff' }, { onConflict: 'role_id' });
      }
    }
    res.json({ success: true, message: 'Données sauvegardées dans Supabase !' });
  } catch (err) {
    console.error('Erreur /api/admin/save:', err);
    res.status(500).json({ error: 'Erreur sauvegarde : ' + err.message });
  }
});

// ── DÉMARRAGE ─────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║           CAC\'S GTA V MODS               ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`🌐  Site vitrine  →  http://localhost:${PORT}`);
  console.log(`⚙️   Panel Admin  →  http://localhost:${PORT}/admin`);
  console.log(`🗄️   Base de données → Supabase\n`);
});