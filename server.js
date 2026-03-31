// ============================================================
//  SERVER.JS - Cac's GTA V Mods
//  Serveur Express avec OAuth2 Discord et API admin
// ============================================================

const express  = require('express');
const session  = require('express-session');
const fetch    = require('node-fetch');
const fs       = require('fs');
const path     = require('path');
const config   = require('./config/discord.config');

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================================
//  MIDDLEWARE
// ============================================================

// Permet au serveur de lire le JSON dans les requêtes POST
app.use(express.json());

// Sert les fichiers statiques du dossier "public" (HTML, CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));

// Gestion des sessions (pour retenir qui est connecté)
app.use(session({
  secret:            config.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure: false,                   // Mettre à true si HTTPS en production
    maxAge: 24 * 60 * 60 * 1000     // Session expire après 24h
  }
}));

// ============================================================
//  FONCTIONS UTILITAIRES
// ============================================================

const DATA_FILE = path.join(__dirname, 'data', 'site-data.json');

// Lire les données depuis le fichier JSON
function readData() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

// Sauvegarder les données dans le fichier JSON
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Middleware admin : vérifie que l'admin est connecté
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) {
    return next();
  }
  res.status(401).json({ error: 'Non autorisé. Connectez-vous au panel admin.' });
}

// ============================================================
//  ROUTES DISCORD OAUTH2
// ============================================================

// ÉTAPE 1 : L'utilisateur clique "Connexion Discord"
// → On le redirige vers la page d'autorisation Discord
app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id:     config.CLIENT_ID,
    redirect_uri:  config.REDIRECT_URI,
    response_type: 'code',
    scope:         'identify guilds.members.read'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// ÉTAPE 2 : Discord nous renvoie avec un "code" dans l'URL
// → On échange ce code contre un token d'accès, puis on récupère les infos
app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect('/?error=no_code');
  }

  try {
    // --- Échanger le code contre un token ---
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     config.CLIENT_ID,
        client_secret: config.CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  config.REDIRECT_URI
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error('Erreur token Discord:', tokenData);
      return res.redirect('/?error=token_failed');
    }

    // --- Récupérer les infos de l'utilisateur ---
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userRes.json();

    // --- Récupérer les rôles du membre dans le serveur ---
    let memberRoles = [];
    if (config.GUILD_ID && config.GUILD_ID !== 'REMPLACE_PAR_TON_GUILD_ID') {
      try {
        const memberRes = await fetch(
          `https://discord.com/api/users/@me/guilds/${config.GUILD_ID}/member`,
          { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
        );
        const memberData = await memberRes.json();
        memberRoles = memberData.roles || [];
      } catch (e) {
        console.warn('Impossible de récupérer les rôles (le membre est peut-être pas dans le serveur)');
      }
    }

    // --- Sauvegarder en session ---
    req.session.user = {
      id:       userData.id,
      username: userData.username,
      avatar:   userData.avatar
        ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/0.png`,
      roles: memberRoles
    };

    res.redirect('/');

  } catch (error) {
    console.error('Erreur OAuth Discord:', error);
    res.redirect('/?error=oauth_failed');
  }
});

// Déconnexion Discord
app.post('/auth/logout', (req, res) => {
  req.session.user = null;
  res.json({ success: true });
});

// ============================================================
//  API PUBLIQUE (accessible par tout le monde)
// ============================================================

// Données publiques : mods visibles + promos actives
app.get('/api/public', (req, res) => {
  const data = readData();
  const now  = new Date();

  res.json({
    site:       data.site,
    categories: data.categories,
    mods:       data.mods.filter(m => m.visible),
    promotions: data.promotions.filter(p => p.active && new Date(p.endDate) > now),
    discordRoles: data.discordRoles.map(r => ({
      roleId:   r.roleId,
      roleName: r.roleName,
      discount: r.discount,
      color:    r.color
    }))
  });
});

// Infos de l'utilisateur connecté + sa réduction applicable
app.get('/api/user', (req, res) => {
  if (!req.session.user) {
    return res.json({ connected: false });
  }

  const data = readData();
  const user = req.session.user;

  // Chercher la meilleure réduction parmi les rôles du membre
  let bestDiscount = 0;
  let appliedRole  = null;
  let roleColor    = null;

  for (const role of data.discordRoles) {
    if (user.roles.includes(role.roleId) && role.discount > bestDiscount) {
      bestDiscount = role.discount;
      appliedRole  = role.roleName;
      roleColor    = role.color;
    }
  }

  res.json({
    connected: true,
    username:  user.username,
    avatar:    user.avatar,
    discount:  bestDiscount,
    roleName:  appliedRole,
    roleColor: roleColor
  });
});

// ============================================================
//  API ADMIN (protégée par mot de passe)
// ============================================================

// Connexion admin
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const data = readData();

  if (password === data.adminPassword) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Mot de passe incorrect' });
  }
});

// Déconnexion admin
app.post('/api/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.json({ success: true });
});

// Vérifier si admin connecté
app.get('/api/admin/check', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

// Récupérer TOUTES les données (pour l'admin)
app.get('/api/admin/data', requireAdmin, (req, res) => {
  res.json(readData());
});

// Sauvegarder toutes les données (depuis le panel admin)
app.post('/api/admin/save', requireAdmin, (req, res) => {
  try {
    writeData(req.body);
    res.json({ success: true, message: 'Données sauvegardées !' });
  } catch (e) {
    console.error('Erreur sauvegarde:', e);
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ============================================================
//  DÉMARRAGE DU SERVEUR
// ============================================================

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║           CAC\'S GTA V MODS               ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`🌐  Site vitrine  →  http://localhost:${PORT}`);
  console.log(`⚙️   Panel Admin  →  http://localhost:${PORT}/admin`);
  console.log('\n💡  Configure config/discord.config.js pour activer la connexion Discord');
  console.log('📁  Données du site dans data/site-data.json\n');
});