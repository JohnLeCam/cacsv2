const express     = require('express');
const session     = require('express-session');
const fetch       = require('node-fetch');
const path        = require('path');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const compression = require('compression');
const { createClient } = require('@supabase/supabase-js');
const { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  if (req.hostname === 'cacsgtavmods.fr') {
    return res.redirect(301, 'https://www.cacsgtavmods.fr' + req.originalUrl);
  }
  next();
});

// Transforme "id1, id2,id3" (ou un tableau) en ['id1','id2','id3'] propre (sans espaces ni vides)
function normalizeIds(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return list.map(id => String(id).trim()).filter(Boolean);
}

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
    ADMIN_ROLE_IDS:       process.env.ADMIN_ROLE_IDS,
    SUPABASE_URL:         process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    BOT_TOKEN:            process.env.BOT_TOKEN,
    TICKET_CAT_ID:        process.env.TICKET_CAT_ID,
    STAFF_ROLE_IDS:       process.env.STAFF_ROLE_IDS,
  };
}

// Nettoyage des listes de rôles (évite qu'un espace dans Railway bloque un admin)
config.ADMIN_ROLE_IDS = normalizeIds(config.ADMIN_ROLE_IDS);
config.STAFF_ROLE_IDS = normalizeIds(config.STAFF_ROLE_IDS);
if (!config.ADMIN_ROLE_IDS.length) console.warn('⚠️  ADMIN_ROLE_IDS est vide : personne ne pourra accéder au panel admin !');

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

const BOT_TOKEN      = config.BOT_TOKEN      || process.env.BOT_TOKEN;
const TICKET_CAT_ID  = config.TICKET_CAT_ID  || process.env.TICKET_CAT_ID  || '1488660670726799471';
const STAFF_ROLE_IDS = config.STAFF_ROLE_IDS.length ? config.STAFF_ROLE_IDS : ['1412494453763211385','1412494594117206141','1439750620788822181'];

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

// ══════════════════════════════════════════════════════════════
//  !SITECHECK — COMMANDE DE DIAGNOSTIC COMPLÈTE
// ══════════════════════════════════════════════════════════════

const SITE_BASE_URL = 'https://www.cacsgtavmods.fr';

// Helper : faire une requête HTTP avec timeout et mesure du temps
async function httpCheck(url, opts = {}) {
  const t = Date.now();
  try {
    const res = await fetch(url, {
      method:  opts.method  || 'GET',
      headers: opts.headers || {},
      body:    opts.body    || undefined,
      signal:  AbortSignal.timeout(6000),
    });
    return { ok: res.ok, status: res.status, ms: Date.now() - t, headers: res.headers };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t, error: e.message };
  }
}

// Helper : formater une ligne de résultat avec explication
function line(emoji, label, ok, detail, explication) {
  const icon   = ok === true ? '✅' : ok === false ? '❌' : '⚠️';
  const status = `${icon} **${label}**`;
  const det    = detail    ? ` — \`${detail}\`` : '';
  const exp    = explication ? `\n┗ *${explication}*` : '';
  return `${status}${det}${exp}`;
}

async function handleSiteCheck(message, mode) {
  const globalStart = Date.now();
  const sections    = [];
  let passed = 0, failed = 0, warned = 0, total = 0;

  // Embed "en cours"
  const sent = await message.channel.send({
    embeds: [{
      color:       0xf59e0b,
      title:       '🔍 Vérification en cours...',
      description: `Mode : **${mode}** — Analyse du système, merci de patienter.`,
      footer:      { text: 'Cac\'s GTAV Mods · !sitecheck' },
      timestamp:   new Date().toISOString(),
    }]
  });

  function check(ok, label, detail, explication) {
    total++;
    if (ok === true)  passed++;
    if (ok === false) failed++;
    if (ok === null)  warned++;
    return line(ok === true ? '✅' : ok === false ? '❌' : '⚠️', label, ok, detail, explication);
  }

  // ────────────────────────────────────────────────────────────
  //  BLOC 1 — DISPONIBILITÉ SITE
  // ────────────────────────────────────────────────────────────
  if (['full', 'rapide'].includes(mode)) {
    const lines = ['**🌐  DISPONIBILITÉ DU SITE**\n'];

    // 1.1 Site public
    const site = await httpCheck(SITE_BASE_URL);
    lines.push(check(
      site.ok,
      'Site public accessible',
      site.ok ? `HTTP ${site.status} · ${site.ms}ms` : `HTTP ${site.status || 'TIMEOUT'} · ${site.error || ''}`,
      'Vérifie que cacsgtavmods.fr répond correctement aux visiteurs. Si ❌, le site est hors ligne.'
    ));

    // 1.2 Panel admin — on vérifie un asset statique du panel (le CSS)
    // car /admin retourne 404 sans session, ce qui est normal et voulu
    const admin = await httpCheck(`${SITE_BASE_URL}/admin/js/admin.js`);
    lines.push(check(
      admin.ok,
      'Panel admin accessible',
      `HTTP ${admin.status} · ${admin.ms}ms`,
      'Vérifie que les fichiers du panel admin sont bien servis par le serveur. Si ❌, le panel est inaccessible même pour les admins connectés.'
    ));

    // 1.3 Redirection www
    const redir = await httpCheck('https://cacsgtavmods.fr/');
    const redirOk = redir.status === 301 || redir.status === 302 || redir.ok;
    lines.push(check(
      redirOk,
      'Redirection sans-www → www',
      `HTTP ${redir.status}`,
      'cacsgtavmods.fr (sans www) doit rediriger vers www.cacsgtavmods.fr pour le SEO et éviter les doublons.'
    ));

    // 1.4 Temps de réponse moyen (mode full seulement)
    if (mode === 'full') {
      const times = [];
      for (let i = 0; i < 3; i++) { const r = await httpCheck(`${SITE_BASE_URL}/api/public`); times.push(r.ms); }
      const avg    = Math.round(times.reduce((a, b) => a + b, 0) / 3);
      const perfOk = avg < 800 ? true : avg < 1500 ? null : false;
      lines.push(check(
        perfOk,
        'Temps de réponse API',
        `${avg}ms (moyenne sur 3 appels)`,
        'Mesure la vitesse de l\'API principale. Moins de 800ms = 🟢, 800-1500ms = 🟡 lent, +1500ms = 🔴 problème.'
      ));
    }

    sections.push(lines.join('\n'));
  }

  // ────────────────────────────────────────────────────────────
  //  BLOC 2 — BASE DE DONNÉES
  // ────────────────────────────────────────────────────────────
  if (['full', 'rapide', 'db'].includes(mode)) {
    const lines = ['**🗄️  BASE DE DONNÉES (SUPABASE)**\n'];

    // 2.1 Connexion Supabase
    try {
      const t = Date.now();
      const { error } = await supabase.from('site_config').select('key').limit(1);
      const ms = Date.now() - t;
      lines.push(check(
        !error,
        'Connexion Supabase',
        !error ? `OK · ${ms}ms` : error.message,
        'Supabase est la base de données du site. Si ❌, aucune donnée ne peut être lue ou écrite (mods, commandes...).'
      ));
    } catch (e) {
      lines.push(check(false, 'Connexion Supabase', e.message,
        'Supabase est la base de données du site. Si ❌, aucune donnée ne peut être lue ou écrite.'));
    }

    // 2.2 Table mods
    try {
      const { data, error } = await supabase.from('mods').select('id').eq('visible', true);
      const count = data?.length || 0;
      lines.push(check(
        !error && count > 0,
        'Table mods',
        !error ? `${count} mod(s) visible(s)` : error.message,
        'Vérifie que les mods sont bien en base et visibles. Si 0, la boutique apparaîtra vide pour les visiteurs.'
      ));
    } catch (e) {
      lines.push(check(false, 'Table mods', e.message, 'Impossible de lire les mods en base de données.'));
    }

    // 2.3 Table orders
    try {
      const { count, error } = await supabase.from('orders').select('*', { count: 'exact', head: true });
      lines.push(check(
        !error,
        'Table commandes',
        !error ? `${count ?? 0} commande(s) au total` : error.message,
        'Vérifie que la table des commandes est accessible. Nécessaire pour créer et consulter les tickets.'
      ));
    } catch (e) {
      lines.push(check(false, 'Table commandes', e.message, 'Impossible de lire les commandes.'));
    }

    // 2.4 Promos expirées encore actives (mode full et db)
    if (['full', 'db'].includes(mode)) {
      try {
        const { data, error } = await supabase.from('promotions').select('id, name').eq('active', true).lt('end_date', new Date().toISOString());
        const zombies = data?.length || 0;
        lines.push(check(
          !error && zombies === 0,
          'Promos expirées',
          !error ? (zombies === 0 ? 'Aucune promo zombie' : `${zombies} promo(s) expirée(s) encore actives !`) : error.message,
          'Une promo "zombie" est une promotion dont la date est dépassée mais qui est toujours marquée active. Ça peut fausser les prix.'
        ));
      } catch (e) {
        lines.push(check(false, 'Promos expirées', e.message, 'Impossible de vérifier les promotions.'));
      }

      // 2.5 Commandes pending depuis +48h
      try {
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase.from('orders').select('id').eq('status', 'pending').lt('created_at', cutoff);
        const stuck = data?.length || 0;
        lines.push(check(
          !error && stuck === 0,
          'Commandes bloquées',
          !error ? (stuck === 0 ? 'Aucune commande bloquée' : `${stuck} commande(s) en "pending" depuis +48h !`) : error.message,
          'Une commande en "pending" depuis plus de 48h signifie qu\'un client attend. À traiter manuellement dans le panel.'
        ));
      } catch (e) {
        lines.push(check(null, 'Commandes bloquées', e.message, 'Impossible de vérifier les commandes anciennes.'));
      }

      // 2.6 Clés site_config obligatoires
      try {
        const requiredKeys = ['title', 'maintenance_mode'];
        const { data, error } = await supabase.from('site_config').select('key').in('key', requiredKeys);
        const foundKeys  = data?.map(r => r.key) || [];
        const missingKeys = requiredKeys.filter(k => !foundKeys.includes(k));
        lines.push(check(
          !error && missingKeys.length === 0,
          'Config site complète',
          missingKeys.length === 0 ? 'Toutes les clés présentes' : `Clés manquantes : ${missingKeys.join(', ')}`,
          'La table site_config stocke le titre du site, le mode maintenance, etc. Des clés manquantes peuvent provoquer des bugs d\'affichage.'
        ));
      } catch (e) {
        lines.push(check(false, 'Config site complète', e.message, 'Impossible de vérifier site_config.'));
      }
    }

    sections.push(lines.join('\n'));
  }

  // ────────────────────────────────────────────────────────────
  //  BLOC 3 — BOT DISCORD
  // ────────────────────────────────────────────────────────────
  if (['full', 'rapide', 'bot'].includes(mode)) {
    const lines = ['**🤖  BOT DISCORD**\n'];

    // 3.1 Bot connecté
    const botOk = discordBot.isReady();
    lines.push(check(
      botOk,
      'Bot connecté à Discord',
      botOk ? `Latence WS : ${discordBot.ws.ping}ms` : 'Bot non prêt',
      'Le bot doit être connecté en permanence pour créer les tickets de commande. Si ❌, aucune commande ne peut aboutir.'
    ));

    // 3.2 Serveur Discord trouvé
    const guild = discordBot.guilds.cache.get(config.GUILD_ID) || discordBot.guilds.cache.first();
    lines.push(check(
      !!guild,
      'Serveur Discord trouvé',
      guild ? `${guild.name} · ${guild.memberCount} membres` : `Guild ID ${config.GUILD_ID} introuvable`,
      'Le bot doit être membre de ton serveur Discord pour créer des salons de tickets. Si ❌, il a été kické.'
    ));

    // 3.3 Catégorie tickets
    const cat = discordBot.channels.cache.get(TICKET_CAT_ID);
    lines.push(check(
      !!cat,
      'Catégorie tickets',
      cat ? `#${cat.name}` : `ID ${TICKET_CAT_ID} introuvable`,
      'C\'est la catégorie Discord dans laquelle les tickets de commande sont créés. Si ❌, les commandes échoueront.'
    ));

    // 3.4 Permissions du bot sur la catégorie tickets
    if (guild && cat) {
      const botMember = guild.members.cache.get(discordBot.user.id);
      const perms     = cat.permissionsFor(botMember);
      const hasPerms  = perms?.has(PermissionFlagsBits.ManageChannels) && perms?.has(PermissionFlagsBits.SendMessages);
      lines.push(check(
        hasPerms,
        'Permissions bot (tickets)',
        hasPerms ? 'Gérer salons + Envoyer messages ✓' : 'Permissions insuffisantes !',
        'Le bot a besoin de "Gérer les salons" et "Envoyer des messages" pour créer et écrire dans les tickets de commande.'
      ));
    }

    // 3.5 Salon d'annonce (mode full et bot)
    if (['full', 'bot'].includes(mode)) {
      const announceId = process.env.ANNOUNCE_CHANNEL_ID || '';
      if (!announceId) {
        lines.push(check(null, 'Salon annonces', 'ANNOUNCE_CHANNEL_ID non configuré sur Railway',
          'Ce salon est utilisé pour envoyer les annonces de nouveaux mods. Configure la variable ANNOUNCE_CHANNEL_ID sur Railway.'));
      } else {
        const ch = discordBot.channels.cache.get(announceId);
        lines.push(check(
          !!ch,
          'Salon annonces',
          ch ? `#${ch.name}` : `ID ${announceId} introuvable`,
          'Salon Discord utilisé pour annoncer les nouveaux mods avec l\'embed. Si ❌, les annonces ne peuvent pas être envoyées.'
        ));
      }

      // 3.6 Uptime du process Node.js
      const uptimeSec = Math.floor(process.uptime());
      const h = Math.floor(uptimeSec / 3600), m = Math.floor((uptimeSec % 3600) / 60), s = uptimeSec % 60;
      const uptimeStr = `${h}h ${m}m ${s}s`;
      lines.push(check(
        true,
        'Uptime serveur',
        uptimeStr,
        'Depuis combien de temps le serveur Node.js tourne sans redémarrage. Un uptime court peut indiquer un crash récent.'
      ));
    }

    sections.push(lines.join('\n'));
  }

  // ────────────────────────────────────────────────────────────
  //  BLOC 4 — SÉCURITÉ
  // ────────────────────────────────────────────────────────────
  if (['full', 'secu'].includes(mode)) {
    const lines = ['**🔐  SÉCURITÉ**\n'];

    // 4.1 Route admin bloquée sans auth
    const authCheck = await httpCheck(`${SITE_BASE_URL}/api/admin/data`);
    const authOk    = authCheck.status === 401 || authCheck.status === 403;
    lines.push(check(
      authOk,
      'Route admin protégée',
      `HTTP ${authCheck.status}`,
      'Vérifie qu\'un inconnu ne peut pas accéder aux données admin sans être connecté. 401 ou 403 = ✅ normal. 200 = 🚨 DANGER.'
    ));

    // 4.2 Headers Helmet (sécurité HTTP)
    const helmetCheck = await httpCheck(SITE_BASE_URL);
    const hasXCTO     = helmetCheck.headers?.get('x-content-type-options') === 'nosniff';
    const hasXFrame   = !!helmetCheck.headers?.get('x-frame-options');
    const helmetOk    = hasXCTO && hasXFrame;
    lines.push(check(
      helmetOk,
      'Headers de sécurité (Helmet)',
      helmetOk ? 'X-Content-Type-Options + X-Frame-Options présents' : 'Headers manquants',
      'Helmet est un module qui ajoute des en-têtes HTTP de sécurité. Ils protègent contre le clickjacking (iframe malveillante), le sniffing de type MIME, et d\'autres attaques courantes.'
    ));

    // 4.3 HTTPS
    const httpsCheck = await httpCheck(SITE_BASE_URL);
    lines.push(check(
      httpsCheck.ok,
      'HTTPS (certificat SSL)',
      httpsCheck.ok ? 'Certificat valide et actif' : 'Problème SSL ou site inaccessible',
      'HTTPS chiffre les communications entre le visiteur et le serveur. Sans HTTPS valide, les données (comme les sessions Discord) transitent en clair.'
    ));

    // 4.4 Route admin/save bloquée
    const saveCheck = await httpCheck(`${SITE_BASE_URL}/api/admin/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    lines.push(check(
      saveCheck.status === 401 || saveCheck.status === 403,
      'Sauvegarde admin protégée',
      `HTTP ${saveCheck.status}`,
      'Vérifie que la route qui sauvegarde les mods/config est bien bloquée sans connexion admin. Si 200, n\'importe qui pourrait modifier le site.'
    ));

    // 4.5 Test anti-DoS visitor/ping (visitorId trop long)
    const dosCheck = await httpCheck(`${SITE_BASE_URL}/api/visitor/ping`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ visitorId: 'a'.repeat(200) })
    });
    lines.push(check(
      !dosCheck.ok || dosCheck.status === 400,
      'Protection anti-DoS visitor/ping',
      `HTTP ${dosCheck.status} pour un visitorId de 200 chars`,
      'Vérifie que le serveur rejette les requêtes avec un identifiant trop long. Sans cette protection, un attaquant pourrait saturer la mémoire du serveur.'
    ));

    sections.push(lines.join('\n'));
  }

  // ────────────────────────────────────────────────────────────
  //  BLOC 5 — PERFORMANCES
  // ────────────────────────────────────────────────────────────
  if (['full', 'perf'].includes(mode)) {
    const lines = ['**⚡  PERFORMANCES**\n'];

    // 5.1 Cache API
    await httpCheck(`${SITE_BASE_URL}/api/public`); // 1er appel remplit le cache
    const hit = await httpCheck(`${SITE_BASE_URL}/api/public`); // 2ème doit être rapide
    const cacheOk = hit.ms < 150 ? true : hit.ms < 400 ? null : false;
    lines.push(check(
      cacheOk,
      'Cache API actif',
      `${hit.ms}ms (2ème appel)`,
      'L\'API met en cache les données 60 secondes pour éviter de requêter Supabase à chaque visiteur. Moins de 150ms = cache actif. Plus de 400ms = cache inactif ou Supabase lent.'
    ));

    // 5.2 Compression gzip
    const gzip = await httpCheck(`${SITE_BASE_URL}/api/public`, {
      headers: { 'Accept-Encoding': 'gzip, deflate, br' }
    });
    const encoding = gzip.headers?.get('content-encoding');
    const gzipOk   = !!(encoding?.includes('gzip') || encoding?.includes('br'));
    lines.push(check(
      gzipOk,
      'Compression gzip/brotli',
      gzipOk ? `Actif (${encoding})` : 'Aucune compression détectée',
      'La compression réduit la taille des réponses de 60 à 70%, ce qui accélère le chargement du site pour les visiteurs avec une connexion lente.'
    ));

    // 5.3 RAM utilisée
    const mem       = process.memoryUsage();
    const heapMB    = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotMB = Math.round(mem.heapTotal / 1024 / 1024);
    const ramOk     = heapMB < 400 ? true : heapMB < 600 ? null : false;
    lines.push(check(
      ramOk,
      'Mémoire RAM Node.js',
      `${heapMB}MB utilisés / ${heapTotMB}MB alloués`,
      'Indique la mémoire consommée par le serveur. Une RAM trop élevée (+400MB) peut indiquer une fuite mémoire. Railway coupe le process si ça dépasse la limite.'
    ));

    // 5.4 Visiteurs actifs et paniers
    const visitors    = liveVisitors.size;
    const nonEmpty    = Array.from(liveVisitors.values()).filter(v => v.cart?.length > 0).length;
    const totalCart   = Array.from(liveVisitors.values()).reduce((s, v) => s + (v.cartTotal || 0), 0);
    lines.push(check(
      true,
      'Visiteurs actifs en ce moment',
      `${visitors} visiteur(s) · ${nonEmpty} panier(s) non vide(s) · ${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(totalCart)} en cours`,
      'Données en temps réel depuis le système de tracking SSE. Visiteurs = onglets ouverts sur le site actuellement.'
    ));

    // 5.5 Mode maintenance
    try {
      const { data } = await supabase.from('site_config').select('value').eq('key', 'maintenance_mode').single();
      const isMaint = data?.value === 'true';
      lines.push(check(
        !isMaint,
        'Mode maintenance',
        isMaint ? '⚠️ Site en maintenance !' : 'Désactivé — site accessible au public',
        'Quand la maintenance est activée, les visiteurs sont redirigés vers la page de maintenance. Seuls les admins et le staff peuvent accéder au site.'
      ));
    } catch (e) {
      lines.push(check(null, 'Mode maintenance', 'Impossible de vérifier', 'Erreur lecture site_config.'));
    }

    sections.push(lines.join('\n'));
  }

  // ────────────────────────────────────────────────────────────
  //  RÉSULTAT FINAL
  // ────────────────────────────────────────────────────────────
  const duration = Date.now() - globalStart;
  const color    = failed > 0 ? 0xe74c3c : warned > 0 ? 0xf59e0b : 0x22c55e;
  const statusLine = failed > 0
    ? `🔴 **${failed} vérification(s) échouée(s) — action requise**`
    : warned > 0
    ? `🟡 **Tout fonctionne mais ${warned} point(s) à surveiller**`
    : `🟢 **TOUT EST OPÉRATIONNEL**`;

  // Discord limite les embeds à 4096 chars — on découpe par section si nécessaire
  const footer    = `\n━━━━━━━━━━━━━━━━━━━━\n${statusLine}\n✅ ${passed}  ❌ ${failed}  ⚠️ ${warned} — ${total} checks en ${duration}ms`;
  const modeNames = { full: 'Rapport complet', rapide: 'Rapport rapide', secu: 'Sécurité', db: 'Base de données', bot: 'Bot Discord', perf: 'Performances' };

  // Envoyer un embed par section pour éviter la limite
  const allSections = [...sections];
  for (let i = 0; i < allSections.length; i++) {
    const isLast = i === allSections.length - 1;
    const desc   = allSections[i] + (isLast ? footer : '');
    await (i === 0 ? sent.edit({ embeds: [{ color, title: `🔍 ${modeNames[mode] || 'Rapport'} — Cac's GTAV Mods`, description: desc, footer: { text: `!sitecheck ${mode} · Cac\'s GTAV Mods` }, timestamp: new Date().toISOString() }] })
                   : message.channel.send({ embeds: [{ color, description: desc }] }));
  }
}

// ── Messages Discord ──────────────────────────────────────────
discordBot.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // !close  (ou « !close force » pour supprimer même si le transcript échoue)
  const closeCmd = message.content.trim().toLowerCase();
  if ((closeCmd === '!close' || closeCmd === '!close force') && message.channel.name?.startsWith('ticket-')) {
    const member  = message.member;
    const isStaff = STAFF_ROLE_IDS.some(roleId => member?.roles.cache.has(roleId));
    if (!isStaff) { await message.reply('❌ Seul un membre du staff peut fermer ce ticket.'); return; }
    const channel = message.channel;
    if (closingTickets.has(channel.id)) return; // fermeture déjà en cours
    closingTickets.add(channel.id);
    const force = closeCmd === '!close force';

    try {
      const cfg = await getTranscriptConfig();
      if (cfg.transcript_enabled !== 'false') {
        await channel.send('🔒 Fermeture du ticket… 📜 Création du transcript en cours, merci de patienter.');
        try {
          const r = await archiveTicket(channel, message.author);
          const done = [r.saved ? 'panel admin' : null, r.sentToLog ? 'salon des transcripts' : null, r.sentToClient ? 'MP du client' : null].filter(Boolean).join(', ');
          await channel.send(`✅ Transcript enregistré (${r.messageCount} messages → ${done}).${r.warnings.length ? `\n⚠️ ${r.warnings.join(' · ')}` : ''}`);
          console.log(`📜 Transcript #${channel.name} : ${r.messageCount} messages → ${done}`);
        } catch (err) {
          console.error(`❌ Transcript #${channel.name} :`, err.message);
          if (!force) {
            await channel.send(`⚠️ **Le transcript n'a pas pu être créé** : ${err.message}\nLe salon n'est **pas** supprimé pour ne rien perdre. Tape \`!close force\` pour le supprimer quand même.`);
            closingTickets.delete(channel.id);
            return;
          }
          await channel.send('⚠️ Transcript impossible, suppression forcée demandée.');
        }
      }
      await channel.send('🔒 Ticket fermé par le staff. Ce salon sera supprimé dans 5 secondes.');
      setTimeout(() => channel.delete().catch(() => {}).finally(() => closingTickets.delete(channel.id)), 5000);
    } catch (err) {
      closingTickets.delete(channel.id);
      console.error('❌ Erreur !close :', err.message);
      await channel.send('❌ Erreur pendant la fermeture : ' + err.message).catch(() => {});
    }
    return;
  }

  // !sitecheck [rapide|secu|db|bot|perf]
  if (message.content.startsWith('!sitecheck')) {
    const member  = message.member;
    const isAdmin = config.ADMIN_ROLE_IDS.some(id => member?.roles?.cache?.has(id));
    if (!isAdmin) { await message.reply('❌ Tu n\'as pas la permission d\'utiliser cette commande.'); return; }
    const arg  = message.content.split(' ')[1]?.toLowerCase() || 'full';
    const mode = ['rapide','secu','db','bot','perf'].includes(arg) ? arg : 'full';
    try {
      await handleSiteCheck(message, mode);
    } catch (err) {
      console.error('❌ Erreur !sitecheck:', err.message);
      await message.channel.send({ embeds: [{ color: 0xe74c3c, title: '❌ Erreur inattendue', description: `Le diagnostic a planté : \`${err.message}\`\nConsulte les logs Railway pour plus de détails.` }] }).catch(() => {});
    }
    return;
  }

  // !help (commandes bot)
  if (message.content === '!help') {
    const member  = message.member;
    const isAdmin = config.ADMIN_ROLE_IDS.some(id => member?.roles?.cache?.has(id));
    if (!isAdmin) return;
    await message.reply({
      embeds: [{
        color: 0x0057b8,
        title: '📋 Commandes disponibles',
        description: [
          '`!sitecheck` — Rapport complet (tous les checks)',
          '`!sitecheck rapide` — Site + DB + Bot uniquement',
          '`!sitecheck secu` — Vérifications de sécurité',
          '`!sitecheck db` — Base de données Supabase',
          '`!sitecheck bot` — Bot Discord et permissions',
          '`!sitecheck perf` — Performances et métriques',
          '',
          '`!close` — Fermer un ticket (dans un salon ticket uniquement)',
          '`!help` — Afficher cette aide',
        ].join('\n'),
        footer: { text: 'Cac\'s GTAV Mods · Commandes Staff/Admin uniquement' }
      }]
    });
    return;
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

// ══════════════════════════════════════════════════════════════
//  📜 TRANSCRIPTS DES TICKETS DE COMMANDE
//  À la fermeture (!close), toute la conversation est sauvegardée
//  en page HTML : table Supabase "transcripts" + salon Discord de logs
//  (+ copie en MP au client si l'option est activée dans le panel).
// ══════════════════════════════════════════════════════════════
const TRANSCRIPT_TZ            = 'Europe/Paris';        // Railway tourne en UTC → on force l'heure française
const TRANSCRIPT_MAX_MESSAGES  = 5000;                  // sécurité anti-boucle infinie
const TRANSCRIPT_IMG_MAX       = 2 * 1024 * 1024;       // image jointe intégrée si ≤ 2 Mo...
const TRANSCRIPT_IMG_TOTAL     = 5 * 1024 * 1024;       // ...et tant que le total reste ≤ 5 Mo
const TRANSCRIPT_DISCORD_MAX   = 8 * 1024 * 1024;       // au-delà, le fichier n'est pas joint sur Discord (limite 10 Mo)
const TRANSCRIPT_DEFAULTS = {
  transcript_enabled:    'true',
  transcript_channel_id: process.env.TRANSCRIPT_CHANNEL_ID || '1558878319523532820', // salon #transcripts
  transcript_dm_client:  'false',
};
const closingTickets = new Set(); // évite 2 fermetures en même temps sur le même salon

async function getTranscriptConfig() {
  const cfg = { ...TRANSCRIPT_DEFAULTS };
  try {
    const { data, error } = await supabase.from('site_config').select('key, value').in('key', Object.keys(TRANSCRIPT_DEFAULTS));
    if (error) throw error;
    for (const row of data || []) cfg[row.key] = row.value == null ? '' : String(row.value);
  } catch (e) { console.warn('⚠️  Lecture config transcripts impossible :', e.message); }
  return cfg;
}

function tEsc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function tDate(date, withSeconds = false) {
  return new Date(date).toLocaleString('fr-FR', {
    timeZone: TRANSCRIPT_TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {})
  });
}

// Récupère TOUS les messages du salon (Discord en donne 100 max par appel)
async function fetchAllTicketMessages(channel) {
  const all = [];
  let before;
  while (all.length < TRANSCRIPT_MAX_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp); // du plus ancien au plus récent
}

// Mini-rendu Markdown Discord → HTML (tout est échappé d'abord : aucun HTML du client ne passe)
function discordMdToHtml(text, ctx) {
  if (!text) return '';
  const blocks = [];
  // 1. Blocs de code ```...``` mis de côté (pas de mise en forme dedans)
  let src = String(text).replace(/```(?:[\w-]+\n)?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre>${tEsc(code.replace(/^\n+|\n+$/g, ''))}</pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const inline = [];
  src = src.replace(/`([^`\n]+)`/g, (_, code) => { inline.push(`<code>${tEsc(code)}</code>`); return `\u0001${inline.length - 1}\u0001`; });

  let html = tEsc(src);
  // Mentions, salons, rôles, emojis, dates
  html = html.replace(/&lt;@!?(\d{15,21})&gt;/g, (_, id) => `<span class="mention">@${tEsc(ctx.userName(id))}</span>`);
  html = html.replace(/&lt;@&amp;(\d{15,21})&gt;/g, (_, id) => `<span class="mention">@${tEsc(ctx.roleName(id))}</span>`);
  html = html.replace(/&lt;#(\d{15,21})&gt;/g, (_, id) => `<span class="mention">#${tEsc(ctx.channelName(id))}</span>`);
  html = html.replace(/&lt;(a?):(\w{2,32}):(\d{15,21})&gt;/g, (_, a, name, id) => `<img class="emoji" alt=":${name}:" title=":${name}:" src="https://cdn.discordapp.com/emojis/${id}.${a ? 'gif' : 'png'}?size=48">`);
  html = html.replace(/&lt;t:(\d{1,13})(?::[tTdDfFR])?&gt;/g, (_, ts) => `<span class="ts">${tEsc(tDate(Number(ts) * 1000))}</span>`);
  // Liens [texte](url) puis URL brutes
  html = html.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  // Mise en forme
  html = html.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n]+)__/g, '<u>$1</u>');
  html = html.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  html = html.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  html = html.replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler">$1</span>');
  // Lignes spéciales : titres, citations, listes
  html = html.split('\n').map(line => {
    let m;
    if ((m = line.match(/^(#{1,3}) (.+)$/))) return `<div class="h${m[1].length}">${m[2]}</div>`;
    if ((m = line.match(/^-# (.+)$/)))        return `<div class="subtext">${m[1]}</div>`;
    if ((m = line.match(/^&gt; ?(.*)$/)))     return `<div class="quote">${m[1]}</div>`;
    if ((m = line.match(/^\s*[-*] (.+)$/)))  return `<div class="li">• ${m[1]}</div>`;
    return line + '<br>';
  }).join('');
  html = html.replace(/(<br>)+$/, '');
  html = html.replace(/\u0001(\d+)\u0001/g, (_, i) => inline[i]);
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}

function renderTranscriptEmbed(embed, ctx) {
  const color  = embed.color != null ? '#' + embed.color.toString(16).padStart(6, '0') : '#1e1f22';
  const author = embed.author?.name ? `<div class="e-author">${tEsc(embed.author.name)}</div>` : '';
  const title  = embed.title
    ? (embed.url ? `<a class="e-title" href="${tEsc(embed.url)}" target="_blank" rel="noopener noreferrer">${discordMdToHtml(embed.title, ctx)}</a>` : `<div class="e-title">${discordMdToHtml(embed.title, ctx)}</div>`)
    : '';
  const desc   = embed.description ? `<div class="e-desc">${discordMdToHtml(embed.description, ctx)}</div>` : '';
  const fields = (embed.fields || []).length
    ? `<div class="e-fields">${embed.fields.map(f => `<div class="e-field${f.inline ? ' inline' : ''}"><div class="e-fname">${discordMdToHtml(f.name, ctx)}</div><div class="e-fvalue">${discordMdToHtml(f.value, ctx)}</div></div>`).join('')}</div>`
    : '';
  const thumb  = embed.thumbnail?.url ? `<img class="e-thumb" src="${tEsc(embed.thumbnail.url)}" alt="">` : '';
  const image  = embed.image?.url ? `<img class="e-image" src="${tEsc(embed.image.url)}" alt="" loading="lazy">` : '';
  const footerParts = [embed.footer?.text ? tEsc(embed.footer.text) : '', embed.timestamp ? tEsc(tDate(embed.timestamp)) : ''].filter(Boolean);
  const footer = footerParts.length ? `<div class="e-footer">${footerParts.join(' • ')}</div>` : '';
  return `<div class="embed" style="border-left-color:${color}"><div class="e-main"><div class="e-body">${author}${title}${desc}${fields}</div>${thumb}</div>${image}${footer}</div>`;
}

// Télécharge une image jointe pour l'intégrer dans le fichier (les liens Discord expirent après la suppression du salon)
async function inlineAttachment(att, budget) {
  const isImage = (att.contentType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(att.name || '');
  if (!isImage || !att.size || att.size > TRANSCRIPT_IMG_MAX || budget.used + att.size > TRANSCRIPT_IMG_TOTAL) return null;
  try {
    const res = await fetch(att.url);
    if (!res.ok) return null;
    const buffer = await res.buffer();
    budget.used += buffer.length;
    const type = att.contentType || res.headers.get('content-type') || 'image/png';
    return `data:${type};base64,${buffer.toString('base64')}`;
  } catch { return null; }
}

async function buildTranscriptHTML({ channel, messages, orders, client, closedBy }) {
  const guild = channel.guild;
  const ctx = {
    userName:    id => guild.members.cache.get(id)?.displayName || discordBot.users.cache.get(id)?.username || 'utilisateur',
    roleName:    id => guild.roles.cache.get(id)?.name || 'rôle',
    channelName: id => guild.channels.cache.get(id)?.name || 'salon',
  };
  const budget = { used: 0 };
  const participants = new Map();
  let prevAuthor = null, prevTime = 0;
  const rows = [];

  for (const msg of messages) {
    const name   = msg.member?.displayName || msg.author.globalName || msg.author.username;
    const color  = msg.member?.displayHexColor && msg.member.displayHexColor !== '#000000' ? msg.member.displayHexColor : '#f2f3f5';
    const avatar = msg.author.displayAvatarURL({ extension: 'png', size: 64 });
    participants.set(msg.author.id, { name, count: (participants.get(msg.author.id)?.count || 0) + 1 });

    // Messages système (épinglé, etc.)
    if (msg.system) { rows.push(`<div class="sys">ℹ️ ${tEsc(name)} — message système (${tEsc(tDate(msg.createdAt))})</div>`); prevAuthor = null; continue; }

    const grouped = prevAuthor === msg.author.id && msg.createdTimestamp - prevTime < 7 * 60 * 1000 && !msg.reference;
    prevAuthor = msg.author.id; prevTime = msg.createdTimestamp;

    let reply = '';
    if (msg.reference?.messageId) {
      const ref = messages.find(m => m.id === msg.reference.messageId);
      const refName = ref ? (ref.member?.displayName || ref.author.username) : 'message supprimé';
      const refText = ref ? (ref.content || (ref.embeds.length ? '[embed]' : '[pièce jointe]')).slice(0, 90) : '';
      reply = `<div class="reply">↪ <strong>${tEsc(refName)}</strong> ${tEsc(refText)}</div>`;
    }

    const content = msg.content ? `<div class="content">${discordMdToHtml(msg.content, ctx)}${msg.editedTimestamp ? ' <span class="edited">(modifié)</span>' : ''}</div>` : '';
    const embeds  = msg.embeds.map(e => renderTranscriptEmbed(e, ctx)).join('');

    const atts = [];
    for (const att of msg.attachments.values()) {
      const dataUri = await inlineAttachment(att, budget);
      if (dataUri) atts.push(`<a href="${tEsc(att.url)}" target="_blank" rel="noopener noreferrer"><img class="att-img" src="${dataUri}" alt="${tEsc(att.name)}"></a>`);
      else atts.push(`<a class="att-file" href="${tEsc(att.url)}" target="_blank" rel="noopener noreferrer">📎 ${tEsc(att.name)} <span>(${(att.size / 1024).toFixed(0)} Ko — lien Discord, peut expirer)</span></a>`);
    }
    const stickers = [...(msg.stickers?.values() || [])].map(s => `<div class="att-file">🏷️ Sticker : ${tEsc(s.name)}</div>`).join('');
    const reactions = [...(msg.reactions?.cache.values() || [])].map(r => `<span class="reaction">${tEsc(r.emoji.id ? ':' + r.emoji.name + ':' : r.emoji.name)} ${r.count}</span>`).join('');

    const body = `${reply}${content}${embeds}${atts.join('')}${stickers}${reactions ? `<div class="reactions">${reactions}</div>` : ''}`;
    if (grouped) {
      rows.push(`<div class="msg grouped"><div class="gutter"><span class="hover-time">${tEsc(new Date(msg.createdAt).toLocaleTimeString('fr-FR', { timeZone: TRANSCRIPT_TZ, hour: '2-digit', minute: '2-digit' }))}</span></div><div class="body">${body}</div></div>`);
    } else {
      rows.push(`<div class="msg"><img class="avatar" src="${tEsc(avatar)}" alt=""><div class="body"><div class="meta"><span class="author" style="color:${tEsc(color)}">${tEsc(name)}</span>${msg.author.bot ? '<span class="bot">APP</span>' : ''}<span class="time">${tEsc(tDate(msg.createdAt))}</span></div>${body}</div></div>`);
    }
  }

  const ordersHtml = orders.length ? `
    <div class="card"><div class="card-title">🛒 Commande${orders.length > 1 ? 's' : ''} liée${orders.length > 1 ? 's' : ''} à ce ticket</div>
    <table><thead><tr><th>Date</th><th>Articles</th><th>Total</th><th>Statut</th></tr></thead><tbody>
    ${orders.map(o => {
      const items = (Array.isArray(o.items) ? o.items : []).map(i => `${tEsc(i.name)}${i.quantity > 1 ? ' ×' + i.quantity : ''}`).join(', ') || '—';
      const st = STATUS_CONFIG[o.status] || STATUS_CONFIG.pending;
      return `<tr><td>${tEsc(tDate(o.created_at))}</td><td>${items}</td><td class="num">${tEsc(formatPrice(o.total_price))}${o.promo_code ? `<br><span class="promo">🏷️ ${tEsc(o.promo_code)}</span>` : ''}</td><td>${st.emoji} ${tEsc(st.label)}</td></tr>`;
    }).join('')}
    </tbody></table></div>` : '';

  const participantsHtml = [...participants.values()].map(p => `<span class="chip">${tEsc(p.name)} · ${p.count}</span>`).join('');
  const guildIcon = guild.iconURL({ extension: 'png', size: 64 });

  // En-tête lisible directement dans l'aperçu du fichier sur Discord
  const safe = str => String(str ?? '').replace(/--/g, '—');
  const headerComment = [
    '<!--',
    `Serveur : ${safe(guild.name)} (${guild.id})`,
    `Salon : ${safe(channel.name)} (${channel.id})`,
    `Messages : ${messages.length}`,
    '',
    'Utilisateurs :',
    ...[...participants.entries()].map(([uid, p]) => `  ${String(p.count).padStart(4)} - ${safe(p.name)} (${uid})`),
    '-->',
  ].join('\n');

  return `${headerComment}
<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Transcript — #${tEsc(channel.name)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#313338;color:#dbdee1;font-family:"gg sans","Noto Sans","Segoe UI",Arial,sans-serif;font-size:15px;line-height:1.375}
a{color:#00a8fc;text-decoration:none}a:hover{text-decoration:underline}
header{background:#2b2d31;border-bottom:1px solid #1e1f22;padding:20px 24px;display:flex;gap:16px;align-items:center}
header img{width:56px;height:56px;border-radius:50%}
header h1{font-size:1.25rem;color:#fff}header p{color:#b5bac1;font-size:0.85rem;margin-top:2px}
.wrap{max-width:1100px;margin:0 auto;padding:20px 16px 60px}
.card{background:#2b2d31;border:1px solid #1e1f22;border-radius:8px;padding:16px 18px;margin-bottom:16px}
.card-title{font-weight:700;color:#fff;margin-bottom:10px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 20px}
.grid div span{display:block;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:#949ba4;font-weight:700}
.grid div strong{color:#fff;font-weight:600}
.chip{display:inline-block;background:#1e1f22;border-radius:12px;padding:2px 10px;margin:4px 6px 0 0;font-size:0.8rem}
table{width:100%;border-collapse:collapse;font-size:0.88rem}th{text-align:left;color:#949ba4;font-size:0.72rem;text-transform:uppercase;padding:6px 8px;border-bottom:1px solid #3f4147}
td{padding:8px;border-bottom:1px solid #3f4147;vertical-align:top}td.num{white-space:nowrap;color:#fff;font-weight:600}.promo{color:#4ade80;font-size:0.78rem;font-weight:400}
.messages{padding-top:8px}
.msg{display:flex;gap:16px;padding:6px 8px 2px;margin-top:12px;border-radius:4px}.msg:hover{background:#2e3035}
.msg.grouped{margin-top:0;padding-top:1px}
.avatar{width:40px;height:40px;border-radius:50%;flex-shrink:0;margin-top:2px}
.gutter{width:40px;flex-shrink:0;text-align:right}.hover-time{visibility:hidden;font-size:0.68rem;color:#949ba4}.msg.grouped:hover .hover-time{visibility:visible}
.body{min-width:0;flex:1}
.meta{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.author{font-weight:600}
.bot{background:#5865f2;color:#fff;font-size:0.62rem;font-weight:700;padding:1px 5px;border-radius:3px}
.time{font-size:0.75rem;color:#949ba4}
.content{word-wrap:break-word;white-space:normal}
.edited{font-size:0.7rem;color:#949ba4}
.h1{font-size:1.5rem;font-weight:700;color:#fff;margin:8px 0 4px}.h2{font-size:1.25rem;font-weight:700;color:#fff;margin:8px 0 4px}.h3{font-size:1.05rem;font-weight:700;color:#fff;margin:6px 0 2px}
.subtext{font-size:0.8rem;color:#949ba4}.quote{border-left:4px solid #4e5058;padding-left:10px}.li{padding-left:8px}
.mention{background:rgba(88,101,242,0.3);color:#c9cdfb;border-radius:3px;padding:0 2px;font-weight:500}
.ts{background:#1e1f22;border-radius:3px;padding:0 3px}
code{background:#1e1f22;border-radius:3px;padding:1px 4px;font-family:Consolas,monospace;font-size:0.85em}
pre{background:#1e1f22;border:1px solid #232428;border-radius:4px;padding:8px;margin:4px 0;white-space:pre-wrap;font-family:Consolas,monospace;font-size:0.85em}
.spoiler{background:#1e1f22;color:transparent;border-radius:3px;cursor:pointer}.spoiler:hover{color:inherit}
.emoji{width:22px;height:22px;vertical-align:-5px}
.reply{font-size:0.8rem;color:#b5bac1;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.embed{background:#2b2d31;border-left:4px solid #1e1f22;border-radius:4px;padding:10px 14px 12px 12px;margin-top:6px;max-width:520px}
.e-main{display:flex;gap:12px}.e-body{flex:1;min-width:0}.e-thumb{width:80px;height:80px;object-fit:cover;border-radius:4px}
.e-author{font-size:0.85rem;font-weight:600;color:#fff;margin-bottom:4px}
.e-title{display:block;font-weight:700;color:#fff;margin-bottom:6px}a.e-title{color:#00a8fc}
.e-desc{font-size:0.88rem}
.e-fields{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:8px}.e-field{flex:1 1 100%}.e-field.inline{flex:1 1 30%;min-width:140px}
.e-fname{font-size:0.85rem;font-weight:700;color:#fff}.e-fvalue{font-size:0.85rem}
.e-image{max-width:100%;border-radius:4px;margin-top:10px;display:block}
.e-footer{font-size:0.75rem;color:#b5bac1;margin-top:8px}
.att-img{max-width:min(400px,100%);max-height:350px;border-radius:6px;margin-top:6px;display:block}
.att-file{display:inline-block;background:#2b2d31;border:1px solid #1e1f22;border-radius:6px;padding:8px 12px;margin-top:6px;font-size:0.88rem}.att-file span{color:#949ba4;font-size:0.75rem}
.reactions{margin-top:4px}.reaction{display:inline-block;background:#2b2d31;border:1px solid #3f4147;border-radius:8px;padding:1px 7px;margin-right:4px;font-size:0.8rem}
.sys{color:#949ba4;font-size:0.85rem;padding:6px 8px 6px 64px}
footer{text-align:center;color:#949ba4;font-size:0.78rem;margin-top:30px}
@media (max-width:600px){.msg{gap:10px}.avatar,.gutter{width:32px;height:32px}}
</style></head><body>
<header>${guildIcon ? `<img src="${tEsc(guildIcon)}" alt="">` : ''}<div><h1>📜 Transcript — #${tEsc(channel.name)}</h1><p>${tEsc(guild.name)} · Cac's GTAV Mods</p></div></header>
<div class="wrap">
  <div class="card"><div class="grid">
    <div><span>Client</span><strong>${tEsc(client.username || 'Inconnu')}</strong>${client.id ? `<br><code>${tEsc(client.id)}</code>` : ''}</div>
    <div><span>Ticket ouvert le</span><strong>${tEsc(tDate(channel.createdAt))}</strong></div>
    <div><span>Fermé le</span><strong>${tEsc(tDate(new Date()))}</strong></div>
    <div><span>Fermé par</span><strong>${tEsc(closedBy.name)}</strong></div>
    <div><span>Messages</span><strong>${messages.length}</strong></div>
  </div>
  ${participantsHtml ? `<div style="margin-top:12px"><span style="font-size:0.72rem;text-transform:uppercase;color:#949ba4;font-weight:700">Participants</span><br>${participantsHtml}</div>` : ''}
  </div>
  ${ordersHtml}
  <div class="messages">${rows.join('\n') || '<p style="color:#949ba4">Aucun message.</p>'}</div>
  <footer>Transcript généré automatiquement le ${tEsc(tDate(new Date(), true))} (heure de Paris)</footer>
</div></body></html>`;
}

// Archive complète d'un ticket. Renvoie { saved, id, sentToLog, sentToClient, messageCount, warnings }
// Lève une erreur si le transcript n'a pu être gardé NULLE PART (le salon ne doit alors pas être supprimé).
async function archiveTicket(channel, closedByUser) {
  const cfg      = await getTranscriptConfig();
  const warnings = [];

  const botPerms = channel.permissionsFor(discordBot.user);
  if (!botPerms?.has(PermissionFlagsBits.ReadMessageHistory)) throw new Error('le bot n\'a pas la permission « Voir les anciens messages » dans ce salon');

  const messages = await fetchAllTicketMessages(channel);

  // Commandes liées à ce ticket (pour le résumé + identifier le client)
  let orders = [];
  const { data: orderRows, error: ordersError } = await supabase.from('orders').select('*').eq('channel_id', channel.id).order('created_at', { ascending: true });
  if (ordersError) warnings.push('commandes non lues : ' + ordersError.message); else orders = orderRows || [];

  let client = { id: orders[0]?.discord_id || null, username: orders[0]?.discord_username || null };
  if (!client.id) { // secours : le membre qui a une permission personnelle sur le salon
    const ow = channel.permissionOverwrites.cache.find(o => o.type === 1 && o.id !== discordBot.user.id);
    if (ow) { client.id = ow.id; client.username = channel.guild.members.cache.get(ow.id)?.displayName || null; }
  }

  const closedBy = { id: closedByUser.id, name: closedByUser.globalName || closedByUser.username };
  const html     = await buildTranscriptHTML({ channel, messages, orders, client, closedBy });
  const buffer   = Buffer.from(html, 'utf8');

  // 1. Sauvegarde Supabase (consultable depuis le panel admin)
  let id = null, number = null;
  const { data: saved, error: saveError } = await supabase.from('transcripts').insert({
    channel_id: channel.id, channel_name: channel.name,
    client_discord_id: client.id, client_username: client.username,
    closed_by: closedBy.name, message_count: messages.length, html,
  }).select('id').single();
  if (saveError) warnings.push('sauvegarde base de données impossible : ' + saveError.message);
  else {
    id = saved.id;
    // Numéro de ticket (colonne "number" facultative : si elle n'existe pas, on continue sans)
    const { data: numRow, error: numError } = await supabase.from('transcripts').select('number').eq('id', id).maybeSingle();
    if (!numError && numRow?.number != null) number = numRow.number;
  }
  const identifier = number != null ? String(number) : (channel.name.match(/(\d+)$/)?.[1] || channel.name);
  const fileName   = `transcript-${number != null ? number : channel.name}.html`;

  // Embed façon « Ticket Fermé »
  const guild      = channel.guild;
  const openedUnix = Math.floor(channel.createdTimestamp / 1000);
  const ordersTotal = orders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0);
  const panneau    = orders.length
    ? `Commande${orders.length > 1 ? 's' : ''} (${orders.length}) · ${formatPrice(ordersTotal)}`
    : 'Commande';
  const summary = new EmbedBuilder()
    .setColor(0x57f287)
    .setAuthor({ name: guild.name, iconURL: guild.iconURL({ extension: 'png', size: 64 }) || undefined })
    .setTitle('🔒 Ticket Fermé')
    .addFields(
      { name: '🆔 Identifiant',       value: identifier.slice(0, 1024),                                           inline: true },
      { name: '✅ Ouvert par',        value: client.id ? `<@${client.id}>` : (client.username || 'Inconnu'),      inline: true },
      { name: '❌ Fermé par',         value: `<@${closedBy.id}>`,                                                 inline: true },
      { name: '📅 Date d\'ouverture', value: `<t:${openedUnix}:f>`,                                              inline: true },
      { name: '🛒 Panneau',           value: panneau.slice(0, 1024),                                              inline: true },
      { name: '💬 Messages',          value: String(messages.length),                                             inline: true },
      { name: '#️⃣ Nom du ticket',     value: channel.name,                                                        inline: false },
    )
    .setTimestamp();

  const canAttach = buffer.length <= TRANSCRIPT_DISCORD_MAX;
  if (!canAttach) summary.setDescription('⚠️ Transcript trop lourd pour être joint ici : ouvre-le avec le bouton ci-dessous.');
  const files = canAttach ? [new AttachmentBuilder(buffer, { name: fileName })] : [];

  // Bouton « Voir la transcription » (page du panel admin, réservée aux admins connectés)
  const panelUrl   = id ? `${SITE_BASE_URL}/api/admin/transcripts/${id}` : null;
  const components = panelUrl
    ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Voir la transcription').setURL(panelUrl))]
    : [];

  // 2. Salon Discord de logs
  let sentToLog = false;
  if (cfg.transcript_channel_id) {
    try {
      const logChannel = await discordBot.channels.fetch(cfg.transcript_channel_id);
      await logChannel.send({ embeds: [summary], files, components, allowedMentions: { parse: [] } });
      sentToLog = true;
    } catch (e) { warnings.push('envoi dans le salon des transcripts impossible : ' + e.message); }
  }

  // 3. Copie au client (option)
  let sentToClient = false;
  if (cfg.transcript_dm_client === 'true' && client.id && canAttach) {
    try {
      const user = await discordBot.users.fetch(client.id);
      // Le client reçoit le même embed + le fichier (sans le bouton : la page du panel est réservée aux admins)
      await user.send({ content: `📜 Voici l'historique de ton ticket **#${channel.name}** sur Cac's GTAV Mods. Merci pour ta commande !`, embeds: [summary], files: [new AttachmentBuilder(buffer, { name: fileName })], allowedMentions: { parse: [] } });
      sentToClient = true;
    } catch (e) { warnings.push('MP au client impossible (MP fermés ?)'); }
  }

  if (!id && !sentToLog) throw new Error(warnings.join(' · ') || 'aucune destination configurée');
  return { saved: !!id, id, sentToLog, sentToClient, messageCount: messages.length, warnings };
}

// ── 1. BASE ───────────────────────────────────────────────────
// Les routes d'upload d'image reçoivent l'image en base64 (≈ +37 % de poids) :
// elles ont droit à une limite plus haute, toutes les autres restent à 2 Mo.
const jsonSmall = express.json({ limit: '2mb' });
const jsonLarge = express.json({ limit: '12mb' });
const LARGE_BODY_ROUTES = new Set(['/api/admin/upload-logo', '/api/admin/upload-embed-banner']);
app.use((req, res, next) => (LARGE_BODY_ROUTES.has(req.path) ? jsonLarge : jsonSmall)(req, res, next));
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
// Compression gzip — exclut la route SSE qui ne supporte pas le buffering
app.use(compression({
  filter: (req, res) => {
    if (req.path === '/api/admin/live-stream') return false;
    return compression.filter(req, res);
  }
}));
// Fichiers statiques (images, css, js...) : ne doivent jamais compter dans la limite
const ASSET_REGEX = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|webp|map)$/i;
// Routes appelées automatiquement en boucle par les pages : exclues de la limite globale
const RATE_LIMIT_SKIP = ['/api/maintenance-status', '/api/visitor', '/api/admin/live-stream'];
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessaie dans quelques minutes.' },
  skip: (req) => ASSET_REGEX.test(req.path) || RATE_LIMIT_SKIP.some(p => req.path.startsWith(p))
}));

const authLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 20,  message: { error: 'Trop de tentatives de connexion, réessaie dans 15 minutes.' } });
const orderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10,  message: { error: 'Trop de commandes envoyées, réessaie dans 10 minutes.' } });
app.use('/auth/discord', authLimiter);
app.use('/api/order',    orderLimiter);

// ── 2. SESSION ────────────────────────────────────────────────
const SupabaseSessionStore = require('express-session').Store;
class SupabaseStore extends SupabaseSessionStore {
  async get(sid, cb) { try { const { data } = await supabase.from('sessions').select('sess, expire').eq('sid', sid).single(); if (!data) return cb(null, null); if (new Date(data.expire) < new Date()) { await supabase.from('sessions').delete().eq('sid', sid); return cb(null, null); } cb(null, data.sess); } catch (e) { cb(null, null); } }
  async set(sid, session, cb) { try { const expire = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); await supabase.from('sessions').upsert({ sid, sess: session, expire: expire.toISOString() }, { onConflict: 'sid' }); cb(null); } catch (e) { cb(null); } }
  async destroy(sid, cb) { try { await supabase.from('sessions').delete().eq('sid', sid); cb(null); } catch (e) { cb(null); } }
}
app.use(session({ store: new SupabaseStore(), secret: config.SESSION_SECRET || 'fallback-secret', resave: false, saveUninitialized: false, rolling: true, cookie: { secure: true, sameSite: 'none', maxAge: 7 * 24 * 60 * 60 * 1000 } }));
// Sécurité : une ancienne session sans liste de rôles faisait planter les vérifications (page qui charge à l'infini)
app.use((req, res, next) => {
  if (req.session?.user && !Array.isArray(req.session.user.roles)) req.session.user.roles = [];
  next();
});

// ── 3. MAINTENANCE ────────────────────────────────────────────
// Petit cache de 3 secondes pour ne pas interroger Supabase à chaque requête
let maintenanceCache = { value: false, time: 0 };
const MAINTENANCE_CACHE_TTL = 3000;
function invalidateMaintenanceCache() { maintenanceCache.time = 0; }

async function isMaintenanceMode() {
  if (Date.now() - maintenanceCache.time < MAINTENANCE_CACHE_TTL) return maintenanceCache.value;
  try {
    const { data, error } = await supabase.from('site_config').select('value').eq('key', 'maintenance_mode').maybeSingle();
    if (error) throw error;
    const value = String(data?.value ?? '').trim().toLowerCase() === 'true';
    maintenanceCache = { value, time: Date.now() };
    return value;
  } catch (e) {
    console.warn('⚠️  Lecture maintenance_mode impossible :', e.message);
    return maintenanceCache.value; // on garde le dernier état connu
  }
}

// Vérifie si un utilisateur possède au moins un des rôles (ne plante jamais)
function hasAnyRole(user, roleIds) {
  return Array.isArray(user?.roles) && roleIds.some(id => user.roles.includes(id));
}

// Récupère les rôles à jour d'un membre via le bot Discord (plus fiable que l'OAuth)
async function fetchRolesFromBot(userId) {
  try {
    if (!discordBot.isReady() || !config.GUILD_ID || !userId) return null;
    const guild  = discordBot.guilds.cache.get(config.GUILD_ID) || await discordBot.guilds.fetch(config.GUILD_ID);
    const member = await guild.members.fetch({ user: userId, force: true });
    return [...member.roles.cache.keys()];
  } catch (e) {
    console.warn(`⚠️  Rôles introuvables via le bot pour ${userId} :`, e.message);
    return null;
  }
}

// Dit si la personne connectée est staff/admin. Si ses rôles en session semblent
// incomplets, on les rafraîchit via le bot (au maximum 1 fois par minute).
const ROLE_REFRESH_INTERVAL = 60 * 1000;
async function getStaffAccess(req) {
  const user = req.session?.user;
  if (!user) return { connected: false, isStaff: false, isAdmin: false };
  let isAdmin = hasAnyRole(user, config.ADMIN_ROLE_IDS);
  let isStaff = hasAnyRole(user, STAFF_ROLE_IDS);
  if (!isAdmin && !isStaff && Date.now() - (req.session.rolesCheckedAt || 0) > ROLE_REFRESH_INTERVAL) {
    req.session.rolesCheckedAt = Date.now();
    const freshRoles = await fetchRolesFromBot(user.id);
    if (freshRoles) {
      user.roles = freshRoles;
      req.session.user = user;
      isAdmin = hasAnyRole(user, config.ADMIN_ROLE_IDS);
      isStaff = hasAnyRole(user, STAFF_ROLE_IDS);
      if (isAdmin) req.session.isAdmin = true;
    }
  }
  return { connected: true, isStaff: isStaff || isAdmin, isAdmin };
}

app.get('/maintenance', (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(__dirname, 'public', 'maintenance.html')); });
app.use(async (req, res, next) => {
  try {
    const bypassPaths = ['/maintenance','/auth/discord','/auth/discord/callback','/auth/logout','/api/user','/api/maintenance-status','/sitemap.xml','/robots.txt','/api/visitor','/cgvu','/legal'];
    if (bypassPaths.some(p => req.path.startsWith(p)) || ASSET_REGEX.test(req.path)) return next();
    const maintenance = await isMaintenanceMode();
    if (!maintenance) return next();
    const access = await getStaffAccess(req);
    if (access.isStaff) return next();
    // Pour les appels API : réponse JSON claire au lieu d'une redirection HTML
    if (req.path.startsWith('/api/')) return res.status(503).json({ error: 'Site en maintenance.', maintenance: true });
    return res.redirect('/maintenance');
  } catch (err) {
    // Une erreur ici ne doit JAMAIS bloquer tout le site
    console.error('❌ Erreur middleware maintenance :', err);
    return next();
  }
});

// ── 4. STATIC ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── 5. MAINTENANCE STATUS ─────────────────────────────────────
app.get('/api/maintenance-status', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const maintenance = await isMaintenanceMode();
    const access = await getStaffAccess(req);
    res.json({ maintenance, connected: access.connected, isStaff: access.isStaff });
  } catch (err) {
    console.error('Erreur /api/maintenance-status :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── 6. HELPERS SUPABASE ───────────────────────────────────────
async function getSiteConfig() { const { data, error } = await supabase.from('site_config').select('key, value'); if (error) throw error; return Object.fromEntries(data.map(r => [r.key, r.value])); }
async function getCategories() { const { data, error } = await supabase.from('categories').select('*').order('position', { ascending: true }); if (error) throw error; return data; }
async function getMods(visibleOnly = false) { let query = supabase.from('mods').select('*').order('position', { ascending: true }); if (visibleOnly) query = query.eq('visible', true); const { data, error } = await query; if (error) throw error; return data; }
async function getPromotions(activeOnly = false) { let query = supabase.from('promotions').select('*').order('created_at', { ascending: false }); if (activeOnly) query = query.eq('active', true).gt('end_date', new Date().toISOString()); const { data, error } = await query; if (error) throw error; return data; }
async function getDiscordRoles() { const { data, error } = await supabase.from('discord_roles').select('*'); if (error) throw error; return data; }

function formatPrice(amount) { if (!amount || parseFloat(amount) <= 0) return 'Gratuit'; return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount || 0); }

function formatData(site, categories, mods, promotions, discordRoles) {
  return {
    site: { title: site.title || '', subtitle: site.subtitle || '', discordUrl: site.discordUrl || '', announcement: site.announcement || '', heroTagline: site.heroTagline || '', maintenance_mode: site.maintenance_mode || 'false', logo_url: site.logo_url || '', merge_orders: site.merge_orders ?? 'true' },
    categories,
    mods: mods.map(m => ({ id: m.id, name: m.name, category: m.category, description: m.description || '', image: m.image || '', images: Array.isArray(m.images) ? m.images : (typeof m.images === 'string' ? JSON.parse(m.images || '[]') : []), basePrice: parseFloat(m.base_price), featured: m.featured, visible: m.visible, position: m.position, createdAt: m.created_at || null })),
    promotions: promotions.map(p => ({ id: p.id, name: p.name, description: p.description || '', discountPercent: p.discount_percent, endDate: p.end_date, applyToCategories: p.apply_to_categories || [], active: p.active, color: p.color })),
    discordRoles: discordRoles.map(r => ({ roleId: r.role_id, roleName: r.role_name, discount: r.discount, color: r.color }))
  };
}

// ── 7. MIDDLEWARE ADMIN ───────────────────────────────────────
function requireAdmin(req, res, next) {
  const user = req.session.user;
  if (!user) return res.status(401).json({ error: 'Non connecté.' });
  const hasAdminRole = hasAnyRole(user, config.ADMIN_ROLE_IDS);
  if (hasAdminRole) { req.session.isAdmin = true; return next(); }
  res.status(403).json({ error: "Accès refusé." });
}

// ── 8. DISCORD OAUTH2 ─────────────────────────────────────────
app.get('/auth/discord', (req, res) => { const params = new URLSearchParams({ client_id: config.CLIENT_ID, redirect_uri: config.REDIRECT_URI, response_type: 'code', scope: 'identify guilds.members.read guilds.join' }); res.redirect(`https://discord.com/api/oauth2/authorize?${params}`); });
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
    // Secours : si Discord n'a pas renvoyé les rôles (limite de requêtes...), on les demande au bot
    if (!memberRoles.length) { const botRoles = await fetchRolesFromBot(userData.id); if (botRoles) memberRoles = botRoles; }
    req.session.rolesCheckedAt = Date.now();
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
let publicCache = null, publicCacheTime = 0;
const CACHE_TTL = 60 * 1000;
function invalidatePublicCache() { publicCache = null; publicCacheTime = 0; }

app.get('/api/public', async (req, res) => {
  try {
    const now = Date.now();
    if (publicCache && (now - publicCacheTime) < CACHE_TTL) return res.json(publicCache);
    const [site, categories, mods, promotions, discordRoles] = await Promise.all([getSiteConfig(), getCategories(), getMods(true), getPromotions(true), getDiscordRoles()]);
    publicCache = formatData(site, categories, mods, promotions, discordRoles);
    publicCacheTime = now;
    res.json(publicCache);
  } catch (err) { console.error('Erreur /api/public:', err); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/user', async (req, res) => {
  if (!req.session.user) return res.json({ connected: false });
  try {
    const user = req.session.user;
    const roles = await getDiscordRoles();
    let bestDiscount = 0, appliedRole = null, roleColor = null;
    for (const role of roles) { if (user.roles.includes(role.role_id) && role.discount > bestDiscount) { bestDiscount = role.discount; appliedRole = role.role_name; roleColor = role.color; } }
    const isAdmin = config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id));
    res.json({ connected: true, id: user.id, username: user.username, avatar: user.avatar, discount: bestDiscount, roleName: appliedRole, roleColor, isAdmin });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── 11. API ADMIN ─────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => { const user = req.session.user; if (!user) return res.status(401).json({ error: "Connectez-vous d'abord via Discord." }); if (config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id))) { req.session.isAdmin = true; res.json({ success: true, username: user.username }); } else res.status(403).json({ error: "Vous n'avez pas le rôle requis." }); });
app.post('/api/admin/logout', (req, res) => { req.session.isAdmin = false; res.json({ success: true }); });
app.get('/api/admin/check', (req, res) => { const user = req.session.user; res.json({ isAdmin: !!req.session.isAdmin || (user && config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id))) }); });
app.get('/api/admin/data', requireAdmin, async (req, res) => { try { const [site, categories, mods, promotions, discordRoles] = await Promise.all([getSiteConfig(), getCategories(), getMods(), getPromotions(), getDiscordRoles()]); res.json(formatData(site, categories, mods, promotions, discordRoles)); } catch (err) { res.status(500).json({ error: 'Erreur lecture base de données' }); } });

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const { data: orders, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    // Ajoute l'ID du transcript du ticket (si le ticket a été fermé avec !close)
    const channelIds = [...new Set(orders.map(o => o.channel_id).filter(Boolean))];
    if (channelIds.length) {
      const { data: trs, error: trError } = await supabase.from('transcripts').select('id, channel_id, created_at').in('channel_id', channelIds).order('created_at', { ascending: false });
      if (!trError) {
        const byChannel = {};
        for (const t of trs || []) if (!byChannel[t.channel_id]) byChannel[t.channel_id] = t.id; // le plus récent
        for (const o of orders) o.transcript_id = byChannel[o.channel_id] || null;
      } // table absente → on ignore, la liste des commandes reste utilisable
    }
    res.json(orders);
  } catch (err) { res.status(500).json({ error: 'Erreur lecture commandes' }); }
});

app.patch('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const { id } = req.params, { status } = req.body;
  if (!STATUS_CONFIG[status]) return res.status(400).json({ error: 'Statut invalide' });
  try {
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', id).single();
    if (error || !order) return res.status(404).json({ error: 'Commande introuvable' });
    await supabase.from('orders').update({ status }).eq('id', id);
    await updateDiscordEmbed(order, status);
    res.json({ success: true, status });
  } catch (err) { console.error('Erreur mise à jour statut:', err); res.status(500).json({ error: 'Erreur mise à jour statut' }); }
});

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const { data: orders, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const totalOrders = orders.length, totalRevenue = orders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0);
    const modCounts = {}; let totalDebadgage = 0, totalRetexture = 0, totalCore = 0, totalItems = 0;
    for (const order of orders) { if (order.core_option) totalCore++; const items = Array.isArray(order.items) ? order.items : []; for (const item of items) { totalItems++; if (item.options?.debadgage) totalDebadgage++; if (item.options?.retexture) totalRetexture++; if (!modCounts[item.name]) modCounts[item.name] = { count: 0, revenue: 0 }; modCounts[item.name].count++; modCounts[item.name].revenue += (parseFloat(item.price) || 0) * (item.quantity || 1); } }
    const topMods = Object.entries(modCounts).map(([name, data]) => ({ name, ...data })).sort((a, b) => b.count - a.count).slice(0, 5);
    const pctDebadgage = totalItems > 0 ? Math.round((totalDebadgage / totalItems) * 100) : 0, pctRetexture = totalItems > 0 ? Math.round((totalRetexture / totalItems) * 100) : 0, pctCore = totalOrders > 0 ? Math.round((totalCore / totalOrders) * 100) : 0;
    const last7 = {}; for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); last7[d.toISOString().slice(0, 10)] = 0; } for (const order of orders) { const day = order.created_at?.slice(0, 10); if (day && last7[day] !== undefined) last7[day]++; }
    res.json({ totalOrders, totalRevenue, topMods, pctDebadgage, pctRetexture, pctCore, last7Days: Object.entries(last7).map(([date, count]) => ({ date, count })), recentOrders: orders.slice(0, 10) });
  } catch (err) { res.status(500).json({ error: 'Erreur lecture stats' }); }
});

app.delete('/api/admin/orders/:id', requireAdmin, async (req, res) => { try { await supabase.from('orders').delete().eq('id', req.params.id); res.json({ success: true }); } catch (err) { res.status(500).json({ error: 'Erreur suppression commande' }); } });
app.delete('/api/admin/stats/reset', requireAdmin, async (req, res) => { try { await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000'); res.json({ success: true }); } catch (err) { res.status(500).json({ error: 'Erreur reset stats' }); } });

// ══════════════════════════════════════════════════════════════
//  TEMPS RÉEL — SSE
// ══════════════════════════════════════════════════════════════
const liveVisitors = new Map(), adminSSEClients = new Set();
const VISITOR_TIMEOUT = 2 * 60 * 1000;
setInterval(() => { const now = Date.now(); let changed = false; for (const [id, v] of liveVisitors) { if (now - v.lastSeen > VISITOR_TIMEOUT) { liveVisitors.delete(id); changed = true; } } if (changed) broadcastLive({ type: 'visitor_update', visitors: getVisitorsList() }); }, 30000);
function getVisitorsList() { return Array.from(liveVisitors.values()).sort((a, b) => b.lastSeen - a.lastSeen); }
function broadcastLive(payload) { const msg = `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`; for (const client of adminSSEClients) { try { client.write(msg); } catch (e) { adminSSEClients.delete(client); } } }

app.get('/api/admin/live-stream', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
  res.write(`event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', visitors: getVisitorsList() })}\n\n`);
  adminSSEClients.add(res);
  const keepAlive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => { clearInterval(keepAlive); adminSSEClients.delete(res); });
});

app.post('/api/visitor/ping', (req, res) => {
  const { visitorId, username, cart, cartTotal } = req.body;
  if (!visitorId || typeof visitorId !== 'string' || visitorId.length > 64) return res.json({ ok: false });
  if (!liveVisitors.has(visitorId) && liveVisitors.size >= 500) return res.json({ ok: false });
  const safeUsername = username && typeof username === 'string' ? username.slice(0, 100) : null;
  const safeCart     = Array.isArray(cart) ? cart.slice(0, 20).map(i => ({ name: String(i.name || '').slice(0, 150), price: parseFloat(i.price) || 0 })) : [];
  const safeCartTotal = Math.min(parseFloat(cartTotal) || 0, 99999);
  const existing = liveVisitors.get(visitorId), isNew = !existing;
  liveVisitors.set(visitorId, { username: safeUsername, cart: safeCart, cartTotal: safeCartTotal, lastSeen: Date.now(), connectedAt: existing?.connectedAt || Date.now() });
  let event = null;
  if (isNew) event = { type: 'join', label: `👤 ${safeUsername || 'Visiteur anonyme'} a ouvert le site`, ts: Date.now() };
  else if (safeCart.length > 0 && existing.cart?.length !== safeCart.length) { const last = safeCart[safeCart.length - 1]; event = { type: 'cart', label: `🛒 ${safeUsername || 'Un visiteur'} a modifié son panier — ${last?.name || ''}`, ts: Date.now() }; }
  broadcastLive({ type: 'visitor_update', visitors: getVisitorsList(), event });
  res.json({ ok: true });
});

app.post('/api/visitor/leave', (req, res) => {
  const { visitorId } = req.body;
  if (visitorId && liveVisitors.has(visitorId)) { const v = liveVisitors.get(visitorId); liveVisitors.delete(visitorId); broadcastLive({ type: 'visitor_update', visitors: getVisitorsList(), event: { type: 'leave', label: `👋 ${v.username || 'Visiteur anonyme'} a quitté le site`, ts: Date.now() } }); }
  res.json({ ok: true });
});

// ── Logo Supabase Storage ─────────────────────────────────────
app.post('/api/admin/upload-logo', requireAdmin, async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Aucune image fournie.' });
  if (!imageBase64.startsWith('data:image/')) return res.status(400).json({ error: 'Format invalide.' });
  try {
    const matches = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Format base64 invalide.' });
    const mimeType = matches[1], ext = mimeType.split('/')[1], buffer = Buffer.from(matches[2], 'base64'), fileName = `logo.${ext}`;
    const { error: uploadError } = await supabase.storage.from('assets').upload(fileName, buffer, { contentType: mimeType, upsert: true, cacheControl: '3600' });
    if (uploadError) throw new Error(uploadError.message);
    const { data: urlData } = supabase.storage.from('assets').getPublicUrl(fileName);
    await supabase.from('site_config').upsert({ key: 'logo_url', value: urlData.publicUrl }, { onConflict: 'key' });
    invalidatePublicCache();
    res.json({ success: true, url: urlData.publicUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Annonce Discord (embed personnalisable depuis le panel) ──
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID || '';
const SHOP_URL            = `${SITE_BASE_URL}/`;

// Valeurs utilisées tant que rien n'a été enregistré depuis le panel (table site_config)
const EMBED_DEFAULTS = {
  embed_title:       'NOUVEL ASSET PUBLIÉ SUR NOTRE BOUTIQUE !',
  embed_description: "Un nouvel asset est disponible sur notre boutique :\n**{boutique}**\n\n🆕 **{mod}** — {prix}\n\nN'oubliez pas de vous connecter avec Discord directement sur notre site (connexion sécurisée), ajoutez ensuite les assets souhaités dans votre panier et validez-le. Un ticket avec votre demande sera automatiquement créé sur notre Discord.\n\nEn cas de besoin, le salon **#🎫︱Creer-Ticket** reste à votre disposition.",
  embed_color:       '#1abc9c',
  embed_footer:      "Cac's GTAV Mods",
  embed_banner_url:  'https://img.draftbot.fr/1773366849212-87a12e25b4502138.png',
  embed_role_id:     '1489946990405095495',
};
const EMBED_KEYS        = Object.keys(EMBED_DEFAULTS);
const EMBED_ALLOW_EMPTY = new Set(['embed_footer', 'embed_role_id']); // vide = pas de footer / pas de ping
const EMBED_MAX_IMAGE   = 8 * 1024 * 1024; // 8 Mo

async function getEmbedConfig() {
  const { data, error } = await supabase.from('site_config').select('key, value').in('key', EMBED_KEYS);
  if (error) throw error;
  const cfg = { ...EMBED_DEFAULTS };
  for (const row of data || []) {
    const value = row.value == null ? '' : String(row.value);
    if (value !== '' || EMBED_ALLOW_EMPTY.has(row.key)) cfg[row.key] = value;
  }
  return cfg;
}

// Vérifie les champs texte envoyés par le panel → { values } ou { error }
function validateEmbedInput(body) {
  const title       = String(body.title ?? '').trim();
  const description = String(body.description ?? '').trim();
  const color       = String(body.color ?? '').trim();
  const footer      = String(body.footer ?? '').trim();
  const roleId      = String(body.roleId ?? '').trim();
  if (!title)                                 return { error: 'Le titre est obligatoire.' };
  if (title.length > 256)                     return { error: 'Titre trop long (256 caractères max).' };
  if (!description)                           return { error: 'Le message est obligatoire.' };
  if (description.length > 4000)              return { error: 'Message trop long (4000 caractères max).' };
  if (!/^#[0-9a-fA-F]{6}$/.test(color))       return { error: 'Couleur invalide (format attendu : #1abc9c).' };
  if (footer.length > 2048)                   return { error: 'Pied de page trop long (2048 caractères max).' };
  if (roleId && !/^\d{17,20}$/.test(roleId))  return { error: "ID du rôle invalide (17 à 20 chiffres, ou vide pour ne pinger personne)." };
  return { values: { embed_title: title, embed_description: description, embed_color: color.toLowerCase(), embed_footer: footer, embed_role_id: roleId } };
}

// Remplace {mod}, {prix} et {boutique} dans un texte
function fillEmbedPlaceholders(text, vars) {
  return String(text || '').replace(/\{(mod|prix|boutique)\}/gi, (_, k) => vars[k.toLowerCase()] ?? '');
}

// Construit l'embed d'annonce à partir de la config (même rendu pour l'annonce et pour le test)
function buildAnnounceEmbed(cfg, { modName = '', modPrice = 0, modLink = '' } = {}) {
  const vars  = { mod: modName, prix: formatPrice(modPrice), boutique: SHOP_URL };
  const color = /^#[0-9a-fA-F]{6}$/.test(cfg.embed_color) ? cfg.embed_color : EMBED_DEFAULTS.embed_color;
  const embed = new EmbedBuilder().setColor(parseInt(color.slice(1), 16));

  const title = fillEmbedPlaceholders(cfg.embed_title, vars).slice(0, 256);
  if (title) embed.setTitle(title).setURL(modLink || SHOP_URL);

  const description = fillEmbedPlaceholders(cfg.embed_description, vars).slice(0, 4096);
  if (description) embed.setDescription(description);

  if (cfg.embed_banner_url) embed.setImage(cfg.embed_banner_url);

  const footer = fillEmbedPlaceholders(cfg.embed_footer, vars).slice(0, 2048);
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

// Lire la config de l'embed (panel admin)
app.get('/api/admin/embed-config', requireAdmin, async (req, res) => {
  try {
    res.json({ config: await getEmbedConfig(), defaults: EMBED_DEFAULTS, shopUrl: SHOP_URL, channelConfigured: !!ANNOUNCE_CHANNEL_ID });
  } catch (err) { res.status(500).json({ error: 'Erreur lecture config embed : ' + err.message }); }
});

// Enregistrer les textes / couleur / rôle de l'embed
app.post('/api/admin/embed-config', requireAdmin, async (req, res) => {
  const check = validateEmbedInput(req.body || {});
  if (check.error) return res.status(400).json({ error: check.error });
  try {
    const rows = Object.entries(check.values).map(([key, value]) => ({ key, value }));
    const { error } = await supabase.from('site_config').upsert(rows, { onConflict: 'key' });
    if (error) throw error;
    res.json({ success: true, config: await getEmbedConfig() });
  } catch (err) { res.status(500).json({ error: 'Erreur sauvegarde embed : ' + err.message }); }
});

// Uploader une nouvelle bannière (même principe que le logo : bucket Supabase "assets")
app.post('/api/admin/upload-embed-banner', requireAdmin, async (req, res) => {
  const { imageBase64 } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'Aucune image fournie.' });
  const matches = String(imageBase64).match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: 'Format invalide (PNG, JPG, GIF ou WEBP uniquement).' });
  try {
    const mimeType = matches[1];
    const ext      = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1];
    const buffer   = Buffer.from(matches[2], 'base64');
    if (buffer.length > EMBED_MAX_IMAGE) return res.status(400).json({ error: 'Image trop lourde (8 Mo max).' });
    const fileName = `embed-banner.${ext}`;
    const { error: uploadError } = await supabase.storage.from('assets').upload(fileName, buffer, { contentType: mimeType, upsert: true, cacheControl: '3600' });
    if (uploadError) throw new Error(uploadError.message);
    const { data: urlData } = supabase.storage.from('assets').getPublicUrl(fileName);
    // ?v=... force Discord (et les navigateurs) à recharger l'image au lieu de garder l'ancienne en cache
    const url = `${urlData.publicUrl}?v=${Date.now()}`;
    const { error: cfgError } = await supabase.from('site_config').upsert({ key: 'embed_banner_url', value: url }, { onConflict: 'key' });
    if (cfgError) throw cfgError;
    res.json({ success: true, url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Remettre la bannière d'origine
app.post('/api/admin/embed-banner/reset', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('site_config').upsert({ key: 'embed_banner_url', value: EMBED_DEFAULTS.embed_banner_url }, { onConflict: 'key' });
    if (error) throw error;
    res.json({ success: true, url: EMBED_DEFAULTS.embed_banner_url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Envoyer l'embed en message privé à l'admin connecté (test sans pinger personne)
app.post('/api/admin/embed-test', requireAdmin, async (req, res) => {
  if (!discordBot.isReady()) return res.status(503).json({ error: "Le bot Discord n'est pas encore connecté, réessaie dans quelques secondes." });
  const check = validateEmbedInput(req.body || {});
  if (check.error) return res.status(400).json({ error: check.error });
  try {
    const saved = await getEmbedConfig();
    const cfg   = { ...saved, ...check.values }; // textes du formulaire (même non enregistrés) + bannière enregistrée
    const user  = await discordBot.users.fetch(req.session.user.id);
    await user.send({
      content: '🧪 **Test d\'annonce** — voici le rendu de ton embed (aucun rôle n\'est pingé en test).',
      embeds:  [buildAnnounceEmbed(cfg, { modName: 'Mod de démonstration', modPrice: 14.99 })],
      allowedMentions: { parse: [] },
    });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 50007) return res.status(400).json({ error: "Impossible de t'envoyer un MP : autorise les messages privés des membres du serveur dans tes paramètres Discord." });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/discord-announce', requireAdmin, async (req, res) => {
  const { modName, modPrice, modLink } = req.body || {};
  if (!modName) return res.status(400).json({ error: 'Nom du mod manquant.' });
  if (!ANNOUNCE_CHANNEL_ID) return res.status(500).json({ error: 'ANNOUNCE_CHANNEL_ID non configuré.' });
  try {
    const channel = await discordBot.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
    if (!channel) return res.status(500).json({ error: `Salon introuvable (${ANNOUNCE_CHANNEL_ID}).` });
    const cfg     = await getEmbedConfig();
    const payload = { embeds: [buildAnnounceEmbed(cfg, { modName, modPrice, modLink })] };
    if (cfg.embed_role_id) {
      payload.content         = `<@&${cfg.embed_role_id}>`;
      payload.allowedMentions = { roles: [cfg.embed_role_id] };
    }
    await channel.send(payload);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 📜 Transcripts (panel admin) ─────────────────────────────
async function isTranscriptTableReady() {
  const { error } = await supabase.from('transcripts').select('id').limit(1);
  return !error;
}

app.get('/api/admin/transcript-config', requireAdmin, async (req, res) => {
  try {
    const cfg = await getTranscriptConfig();
    res.json({ config: cfg, tableReady: await isTranscriptTableReady() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/transcript-config', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const channelId = String(b.channelId ?? '').trim();
  if (channelId && !/^\d{17,20}$/.test(channelId)) return res.status(400).json({ error: 'ID de salon invalide (17 à 20 chiffres, ou vide).' });
  try {
    const rows = [
      { key: 'transcript_enabled',    value: b.enabled  === false ? 'false' : 'true' },
      { key: 'transcript_channel_id', value: channelId },
      { key: 'transcript_dm_client',  value: b.dmClient === true  ? 'true'  : 'false' },
    ];
    const { error } = await supabase.from('site_config').upsert(rows, { onConflict: 'key' });
    if (error) throw error;
    res.json({ success: true, config: await getTranscriptConfig() });
  } catch (err) { res.status(500).json({ error: 'Erreur sauvegarde : ' + err.message }); }
});

// Vérifie que le bot peut écrire dans le salon choisi (message de test)
app.post('/api/admin/transcript-config/test', requireAdmin, async (req, res) => {
  const channelId = String(req.body?.channelId ?? '').trim();
  if (!/^\d{17,20}$/.test(channelId)) return res.status(400).json({ error: 'Renseigne d\'abord un ID de salon valide.' });
  if (!discordBot.isReady()) return res.status(503).json({ error: "Le bot Discord n'est pas encore connecté." });
  try {
    const channel = await discordBot.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.() || !channel.guild) return res.status(400).json({ error: 'Salon introuvable (vérifie l\'ID, et que le bot est bien sur ce serveur).' });
    const perms   = channel.permissionsFor(discordBot.user);
    const needed  = [['ViewChannel', 'Voir le salon'], ['SendMessages', 'Envoyer des messages'], ['EmbedLinks', 'Intégrer des liens'], ['AttachFiles', 'Joindre des fichiers']];
    const missing = needed.filter(([flag]) => !perms?.has(PermissionFlagsBits[flag])).map(([, label]) => label);
    if (missing.length) return res.status(400).json({ error: `Il manque au bot ces permissions dans #${channel.name} : ${missing.join(', ')}.` });
    await channel.send({ content: `🧪 Test depuis le panel admin : les transcripts des tickets arriveront ici. (demandé par ${req.session.user.username})`, allowedMentions: { parse: [] } });
    res.json({ success: true, channelName: channel.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Liste des derniers transcripts (sans le HTML, trop lourd)
app.get('/api/admin/transcripts', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('transcripts').select('id, channel_name, client_username, client_discord_id, closed_by, message_count, created_at').order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Afficher (ou télécharger avec ?download=1) un transcript
app.get('/api/admin/transcripts/:id', requireAdmin, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).send('ID invalide');
  try {
    const { data, error } = await supabase.from('transcripts').select('channel_name, html').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).send('Transcript introuvable');
    // Sécurité : aucun script ne peut s'exécuter dans la page du transcript
    res.set('Content-Security-Policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline'");
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.query.download === '1') res.set('Content-Disposition', `attachment; filename="transcript-${String(data.channel_name || 'ticket').replace(/[^\w-]/g, '')}.html"`);
    res.type('html').send(data.html);
  } catch (err) { res.status(500).send('Erreur : ' + err.message); }
});

app.delete('/api/admin/transcripts/:id', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('transcripts').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sauvegarde admin ──────────────────────────────────────────
app.post('/api/admin/save', requireAdmin, async (req, res) => {
  const d = req.body;
  try {
    if (d.site) {
      const results = await Promise.all(Object.entries(d.site).map(([key, value]) => supabase.from('site_config').upsert({ key, value: String(value) }, { onConflict: 'key' })));
      const failed = results.find(r => r.error);
      if (failed) throw failed.error;
      if ('maintenance_mode' in d.site) invalidateMaintenanceCache();
    }
    if (d.categories?.length) { const { data: existingCats } = await supabase.from('categories').select('id'); const toDeleteCats = (existingCats || []).map(c => c.id).filter(id => !d.categories.find(c => c.id === id)); if (toDeleteCats.length > 0) await supabase.from('categories').delete().in('id', toDeleteCats); for (const cat of d.categories) await supabase.from('categories').upsert({ id: cat.id, name: cat.name, color: cat.color || '#ffffff', icon: cat.icon || '📦', position: cat.position ?? 0 }, { onConflict: 'id' }); }
    if (d.mods) { const { data: existingMods } = await supabase.from('mods').select('id'); const toDelete = (existingMods || []).map(m => m.id).filter(id => !d.mods.find(m => m.id === id)); if (toDelete.length > 0) await supabase.from('mods').delete().in('id', toDelete); for (const mod of d.mods) { const { error: e } = await supabase.from('mods').upsert({ id: mod.id, name: mod.name, category: mod.category, description: mod.description || '', image: mod.image || '', base_price: mod.basePrice || 0, images: mod.images || [], featured: mod.featured || false, visible: mod.visible !== false, position: mod.position ?? 0 }, { onConflict: 'id' }); if (e) console.error('❌ Erreur upsert mod:', e.message); } }
    if (d.promotions) { const { data: existingPromos } = await supabase.from('promotions').select('id'); const toDeletePromos = (existingPromos || []).map(p => p.id).filter(id => !d.promotions.find(p => p.id === id)); if (toDeletePromos.length > 0) await supabase.from('promotions').delete().in('id', toDeletePromos); for (const promo of d.promotions) await supabase.from('promotions').upsert({ id: promo.id, name: promo.name, description: promo.description || '', discount_percent: promo.discountPercent || 0, end_date: promo.endDate, apply_to_categories: promo.applyToCategories || [], active: promo.active !== false, color: promo.color || '#cc0000' }, { onConflict: 'id' }); }
    if (d.discordRoles) { const { data: existingRoles } = await supabase.from('discord_roles').select('role_id'); const toDeleteRoles = (existingRoles || []).map(r => r.role_id).filter(id => !d.discordRoles.find(r => r.roleId === id)); if (toDeleteRoles.length > 0) await supabase.from('discord_roles').delete().in('role_id', toDeleteRoles); for (const role of d.discordRoles) await supabase.from('discord_roles').upsert({ role_id: role.roleId, role_name: role.roleName, discount: role.discount || 0, color: role.color || '#ffffff' }, { onConflict: 'role_id' }); }
    res.json({ success: true });
    invalidatePublicCache();
  } catch (err) { res.status(500).json({ error: 'Erreur sauvegarde : ' + err.message }); }
});

// Bouton maintenance du panel : enregistre ET vérifie que la base a bien pris le changement
app.post('/api/admin/maintenance', requireAdmin, async (req, res) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Valeur invalide : "enabled" doit être true ou false.' });
  try {
    const { error } = await supabase.from('site_config').upsert({ key: 'maintenance_mode', value: enabled ? 'true' : 'false' }, { onConflict: 'key' });
    if (error) throw error;
    invalidateMaintenanceCache();
    invalidatePublicCache();
    const actual = await isMaintenanceMode();
    if (actual !== enabled) return res.status(500).json({ error: "La base de données n'a pas enregistré le changement.", maintenance: actual });
    console.log(`🔧 Maintenance ${enabled ? 'ACTIVÉE' : 'DÉSACTIVÉE'} par ${req.session.user.username}`);
    res.json({ success: true, maintenance: actual });
  } catch (err) {
    console.error('❌ Erreur /api/admin/maintenance :', err);
    res.status(500).json({ error: 'Erreur sauvegarde maintenance : ' + err.message });
  }
});

// ── 12. API COMMANDE ──────────────────────────────────────────
// ── CODES PROMO & CALCUL DU PANIER ────────────────────────────
// Tous les prix sont recalculés ici, côté serveur : le navigateur ne décide jamais du prix.
const round2 = (n) => Math.round(n * 100) / 100;
function normalizePromoCode(code) { return String(code || '').trim().toUpperCase().replace(/\s+/g, ''); }
const PROMO_CODE_REGEX = /^[A-Z0-9_-]{3,30}$/;

// Meilleure réduction de rôle Discord du client (même règle que /api/user)
async function getUserRoleDiscount(user) {
  if (!Array.isArray(user?.roles) || !user.roles.length) return 0;
  const roles = await getDiscordRoles();
  let best = 0;
  for (const r of roles) { const d = Number(r.discount) || 0; if (user.roles.includes(r.role_id) && d > best) best = d; }
  return best;
}

// Vérifie le panier et calcule le sous-total (promos de catégorie + réduction de rôle + options)
async function computeCart(items, coreOption, user) {
  const [dbMods, activePromos, roleDiscount] = await Promise.all([getMods(true), getPromotions(true), getUserRoleDiscount(user)]);
  let subtotal = 0; const validatedItems = [];
  for (const item of items) {
    const dbMod = dbMods.find(m => m.id === item.id);
    if (!dbMod) { const e = new Error(`Mod introuvable : ${item.id}`); e.status = 400; throw e; }
    let promoDiscount = 0;
    for (const p of activePromos) { if (!p.apply_to_categories?.length || p.apply_to_categories.includes(dbMod.category)) { if (p.discount_percent > promoDiscount) promoDiscount = p.discount_percent; } }
    const totalDiscount = Math.min(roleDiscount + promoDiscount, 100);
    const serverPrice = parseFloat(dbMod.base_price) * (1 - totalDiscount / 100);
    const opts = item.options || {}, extra = (opts.debadgage ? 10 : 0) + (opts.retexture ? 5 : 0), qty = Math.max(1, Math.min(10, parseInt(item.quantity) || 1));
    subtotal += (serverPrice + extra) * qty;
    validatedItems.push({ id: dbMod.id, name: dbMod.name, price: serverPrice, quantity: qty, options: { debadgage: !!opts.debadgage, retexture: !!opts.retexture } });
  }
  if (coreOption) subtotal += 10;
  return { validatedItems, subtotal: round2(subtotal), roleDiscount };
}

// Vérifie un code promo pour un client et un sous-total donnés (ne consomme PAS le code)
async function checkPromoCode(rawCode, subtotal, discordId) {
  const code = normalizePromoCode(rawCode);
  if (!PROMO_CODE_REGEX.test(code)) return { ok: false, error: 'Code promo invalide.' };
  const { data: promo, error } = await supabase.from('promo_codes').select('*').eq('code', code).maybeSingle();
  if (error) throw error;
  if (!promo || !promo.active) return { ok: false, error: 'Code promo invalide.' };
  if (promo.expires_at && new Date(promo.expires_at) <= new Date()) return { ok: false, error: 'Ce code promo a expiré.' };
  if (promo.max_uses !== null && promo.uses >= promo.max_uses) return { ok: false, error: "Ce code promo a atteint sa limite d'utilisations." };
  const minOrder = Number(promo.min_order) || 0;
  if (subtotal < minOrder) return { ok: false, error: `Ce code nécessite une commande d'au moins ${formatPrice(minOrder)}.` };
  if (promo.one_per_user && discordId) {
    const { count, error: countError } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('discord_id', String(discordId)).eq('promo_code', code).neq('status', 'cancelled');
    if (countError) throw countError;
    if (count > 0) return { ok: false, error: 'Tu as déjà utilisé ce code promo.' };
  }
  const value = Number(promo.discount_value) || 0;
  const discount = round2(Math.min(promo.discount_type === 'fixed' ? value : subtotal * value / 100, subtotal));
  return { ok: true, code, discount, total: round2(subtotal - discount), discountType: promo.discount_type, discountValue: value, minOrder };
}

// Limite anti-devinette : 15 essais de code par tranche de 10 minutes
const promoCheckLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de tentatives de code promo, réessaie dans quelques minutes.' } });

// Le panier demande "ce code est-il valable ?"
app.post('/api/promo/check', promoCheckLimiter, async (req, res) => {
  const user = req.session?.user;
  if (!user?.id) return res.status(401).json({ error: 'Connecte-toi avec Discord pour utiliser un code promo.' });
  const { items, code } = req.body || {};
  if (!Array.isArray(items) || !items.length || items.length > 20) return res.status(400).json({ error: 'Panier vide ou invalide.' });
  try {
    const { subtotal } = await computeCart(items, req.body.coreOption === true, user);
    const result = await checkPromoCode(code, subtotal, user.id);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ valid: true, ...result, subtotal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Erreur /api/promo/check :', err);
    res.status(500).json({ error: 'Erreur lors de la vérification du code.' });
  }
});

// ── ADMIN : gestion des codes promo ──
app.get('/api/admin/promo-codes', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('promo_codes').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) { console.error('Erreur lecture codes promo :', err); res.status(500).json({ error: 'Erreur lecture des codes promo : ' + err.message }); }
});

app.post('/api/admin/promo-codes', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const code = normalizePromoCode(b.code);
  if (!PROMO_CODE_REGEX.test(code)) return res.status(400).json({ error: 'Le code doit faire 3 à 30 caractères : lettres, chiffres, - ou _ (sans espace ni accent).' });
  const discountType = b.discountType === 'fixed' ? 'fixed' : 'percent';
  const discountValue = Number(b.discountValue);
  if (!(discountValue > 0)) return res.status(400).json({ error: 'La réduction doit être supérieure à 0.' });
  if (discountType === 'percent' && discountValue > 100) return res.status(400).json({ error: 'Une réduction en % ne peut pas dépasser 100.' });
  const maxUses = b.maxUses === '' || b.maxUses === null || b.maxUses === undefined ? null : parseInt(b.maxUses);
  if (maxUses !== null && !(maxUses >= 1)) return res.status(400).json({ error: "Le nombre d'utilisations doit être au moins 1 (ou vide = illimité)." });
  const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
  if (expiresAt && isNaN(expiresAt)) return res.status(400).json({ error: "Date d'expiration invalide." });
  const row = { code, discount_type: discountType, discount_value: discountValue, min_order: Math.max(0, Number(b.minOrder) || 0), max_uses: maxUses, one_per_user: b.onePerUser !== false, expires_at: expiresAt ? expiresAt.toISOString() : null, active: b.active !== false, description: String(b.description || '').slice(0, 200) };
  try {
    const query = b.id ? supabase.from('promo_codes').update(row).eq('id', b.id).select().single() : supabase.from('promo_codes').insert(row).select().single();
    const { data, error } = await query;
    if (error) { if (error.code === '23505') return res.status(400).json({ error: `Le code ${code} existe déjà.` }); throw error; }
    res.json({ success: true, promoCode: data });
  } catch (err) { console.error('Erreur sauvegarde code promo :', err); res.status(500).json({ error: 'Erreur sauvegarde : ' + err.message }); }
});

app.delete('/api/admin/promo-codes/:id', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('promo_codes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) { console.error('Erreur suppression code promo :', err); res.status(500).json({ error: 'Erreur suppression : ' + err.message }); }
});

// ── Regroupement des commandes dans un ticket déjà ouvert ─────
// Option activable dans le panel admin (clé site_config "merge_orders", activée par défaut)
async function isMergeOrdersEnabled() {
  try {
    const { data, error } = await supabase.from('site_config').select('value').eq('key', 'merge_orders').maybeSingle();
    if (error) throw error;
    if (!data) return true; // jamais réglée → activée par défaut
    return String(data.value).trim().toLowerCase() !== 'false';
  } catch (e) {
    console.warn('⚠️  Lecture merge_orders impossible :', e.message);
    return true;
  }
}

// Cherche un ticket encore ouvert pour ce client : un salon "ticket-..." de la catégorie
// des tickets où le client a une permission personnelle. Un ticket fermé avec !close
// est supprimé, donc il ne sera jamais retrouvé.
function findOpenTicketChannel(guild, discordId) {
  const tickets = guild.channels.cache.filter(ch =>
    ch.parentId === TICKET_CAT_ID &&
    ch.name?.startsWith('ticket-') &&
    ch.isTextBased?.() &&
    ch.permissionOverwrites?.cache.get(discordId)?.type === 1 // 1 = permission d'un membre (pas d'un rôle)
  );
  if (!tickets.size) return null;
  return [...tickets.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0]; // le plus récent
}

// Verrou par client : si le client clique 2 fois très vite, les commandes sont traitées
// l'une après l'autre (sinon les 2 créeraient chacune un ticket en même temps)
const orderLocks = new Map();
function withUserLock(userId, task) {
  const previous = orderLocks.get(userId) || Promise.resolve();
  const current  = previous.catch(() => {}).then(task);
  orderLocks.set(userId, current);
  current.finally(() => { if (orderLocks.get(userId) === current) orderLocks.delete(userId); }).catch(() => {});
  return current;
}

// Anti-doublon : même panier renvoyé par le même client en moins de 2 minutes = ignoré
const lastOrders = new Map(); // discordId → { signature, time, result }
const DUPLICATE_WINDOW = 2 * 60 * 1000;
function orderSignature(items, coreOption) {
  return JSON.stringify({
    core: coreOption,
    items: items.map(i => [i.id, i.quantity, !!i.options?.debadgage, !!i.options?.retexture]).sort()
  });
}

app.post('/api/order', async (req, res) => {
  const { items } = req.body;
  // Sécurité : l'identité vient de la session Discord (côté serveur), jamais du navigateur
  const sessionUser = req.session?.user;
  if (!sessionUser?.id || !sessionUser?.username) return res.status(401).json({ error: 'Vous devez être connecté avec Discord pour passer commande.' });
  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Panier vide.' });
  if (items.length > 20) return res.status(400).json({ error: 'Trop d\'articles dans le panier.' });
  for (const item of items) { if (!item.id || typeof item.id !== 'string') return res.status(400).json({ error: 'Article invalide (id manquant).' }); if (!item.name || typeof item.name !== 'string' || item.name.length > 200) return res.status(400).json({ error: 'Article invalide.' }); }
  const coreOption = req.body.coreOption === true;
  const promoCodeInput = req.body.promoCode ? normalizePromoCode(req.body.promoCode) : '';
  let validatedItems, subtotal;
  try { ({ validatedItems, subtotal } = await computeCart(items, coreOption, sessionUser)); }
  catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); return res.status(500).json({ error: 'Erreur lecture base de données.' }); }

  const discordId = String(sessionUser.id);
  const username  = sessionUser.username;

  try {
    const result = await withUserLock(discordId, async () => {
      // 1. Doublon exact envoyé juste avant → on ne recrée rien
      const signature = orderSignature(validatedItems, coreOption) + '|' + promoCodeInput;
      const last = lastOrders.get(discordId);
      if (last && last.signature === signature && Date.now() - last.time < DUPLICATE_WINDOW) {
        console.log(`♻️  Commande en double ignorée pour ${username}`);
        return { ...last.result, duplicate: true };
      }

      // Code promo : vérifié puis "réservé" (compteur +1) AVANT de créer le ticket
      let serverTotal = subtotal, promo = null, promoReserved = false;
      if (promoCodeInput) {
        const check = await checkPromoCode(promoCodeInput, subtotal, discordId);
        if (!check.ok) { const e = new Error(check.error); e.status = 400; e.promoError = true; throw e; }
        const { data: reserved, error: rpcError } = await supabase.rpc('use_promo_code', { p_code: check.code });
        if (rpcError) throw rpcError;
        if (!reserved) { const e = new Error("Ce code promo n'est plus disponible."); e.status = 409; e.promoError = true; throw e; }
        promoReserved = true;
        promo = check;
        serverTotal = check.total;
      }
      try {

      const guild = discordBot.guilds.cache.get(config.GUILD_ID) || discordBot.guilds.cache.first();
      if (!guild) { const e = new Error('Bot non connecté au serveur Discord.'); e.status = 500; throw e; }
      let member = null;
      try { member = await guild.members.fetch(discordId); } catch (e) {}

      const itemLines = validatedItems.map(item => { const opts = item.options || {}, extra = (opts.debadgage ? 10 : 0) + (opts.retexture ? 5 : 0), total = (item.price + extra) * item.quantity, optStr = [opts.debadgage ? '🔧 Debadgage (+10€)' : '', opts.retexture ? '🎨 Retexture (+5€)' : ''].filter(Boolean).join(', '); return `> 🔹 **${item.name}**${item.quantity > 1 ? ` ×${item.quantity}` : ''} — **${formatPrice(total)}**${optStr ? `\n>    └ ${optStr}` : ''}`; }).join('\n');
      const coreLines     = coreOption ? `\n> 📦 **Ressource [CORE]** — **${formatPrice(10)}**` : '';
      const staffMentions = STAFF_ROLE_IDS.map(id => `<@&${id}>`).join(' ');
      const clientMention = member ? `<@${member.id}>` : `**${username}**`;
      const today         = new Date().toLocaleDateString('fr-FR');
      const totalLines    = promo
        ? [`**Sous-total :** ${formatPrice(subtotal)}`, `**🏷️ Code promo \`${promo.code}\` :** -${formatPrice(promo.discount)}`, `**Total :** **${formatPrice(serverTotal)}**`]
        : [`**Total :** **${formatPrice(serverTotal)}**`];

      // 2. Ticket déjà ouvert ? (seulement si l'option est activée)
      let channel = null, merged = false;
      if (await isMergeOrdersEnabled()) channel = findOpenTicketChannel(guild, discordId);

      if (channel) {
        merged = true;
        await channel.send([`# ➕ Commande supplémentaire — ${today}`, ``, `**Client :** ${clientMention}`, ...totalLines, ``, `## 📦 Articles ajoutés`, itemLines + coreLines, ``, `## 👷 Staff notifié`, staffMentions].join('\n'));
      } else {
        // 3. Sinon : nouveau ticket (comportement d'origine)
        const timestamp  = Date.now().toString().slice(-5);
        const ticketName = `ticket-${username.toLowerCase().replace(/[^a-z0-9]/g, '') || 'client'}-${timestamp}`;
        const permissionOverwrites = [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }];
        if (member) permissionOverwrites.push({ id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        for (const roleId of STAFF_ROLE_IDS) permissionOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] });
        channel = await guild.channels.create({ name: ticketName, type: ChannelType.GuildText, parent: TICKET_CAT_ID, permissionOverwrites, topic: `Commande de ${username} — ${today}` });
        await channel.send([`# 🛒 Nouvelle commande — ${today}`, ``, `**Client :** ${clientMention}`, ...totalLines, ``, `## 📦 Articles commandés`, itemLines + coreLines, ``, `## 👷 Staff notifié`, staffMentions, ``, `---`, `*Pour fermer ce ticket : tapez* \`!close\``].join('\n'));
      }

      // 4. Embed de statut + enregistrement (une ligne par commande, même si le ticket est partagé)
      const orderData = { discord_username: username, discord_id: discordId, ticket_channel: channel.name, total_price: serverTotal, items: validatedItems, core_option: coreOption, created_at: new Date().toISOString() };
      const embedMsg  = await channel.send({ embeds: [buildStatusEmbed(orderData, 'pending')] });
      const orderRow = { ...orderData, channel_id: channel.id, status_message_id: embedMsg.id, status: 'pending' };
      let { error: insertError } = await supabase.from('orders').insert(promo ? { ...orderRow, promo_code: promo.code, promo_discount: promo.discount } : orderRow);
      if (insertError && promo) {
        console.warn('⚠️  Colonnes promo absentes de "orders" ? Enregistrement sans le code :', insertError.message);
        ({ error: insertError } = await supabase.from('orders').insert(orderRow));
      }
      if (insertError) console.warn('Impossible de sauvegarder la commande:', insertError.message);

      console.log(merged ? `➕ Commande ajoutée au ticket #${channel.name} (${username})` : `🎫 Ticket créé : #${channel.name} pour ${username}`);
      broadcastLive({ type: 'new_order', username, total: serverTotal });

      const response = { success: true, ticketChannel: channel.name, channelId: channel.id, merged, total: serverTotal };
      lastOrders.set(discordId, { signature, time: Date.now(), result: response });
      return response;
      } catch (innerErr) {
        // Échec après avoir réservé le code : on rend l'utilisation (compteur -1)
        if (promoReserved) { try { await supabase.rpc('release_promo_code', { p_code: promo.code }); } catch (e) { console.warn('Impossible de libérer le code promo :', e.message); } }
        throw innerErr;
      }
    });
    res.json(result);
  } catch (err) {
    console.error('Erreur création ticket:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Impossible de créer le ticket : ' + err.message, promoError: !!err.promoError });
  }
});

// ── 13. CGVU & LÉGAL ─────────────────────────────────────────
app.get('/cgvu',  (req, res) => { res.sendFile(path.join(__dirname, 'public', 'cgvu.html')); });
app.get('/legal', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'legal.html')); });

// ── 14. SITEMAP ───────────────────────────────────────────────
// Liste des vraies pages du site, avec la bonne adresse (www.cacsgtavmods.fr).
// Les mods ne sont pas listés un par un : leurs liens en "#id" pointent tous vers la
// même page pour Google (il ignore tout ce qui suit le #), ce qui créait des doublons.
app.get('/sitemap.xml', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const pages = [
      { loc: `${SITE_BASE_URL}/`,      changefreq: 'daily',   priority: '1.0' },
      { loc: `${SITE_BASE_URL}/cgvu`,  changefreq: 'monthly', priority: '0.3' },
      { loc: `${SITE_BASE_URL}/legal`, changefreq: 'monthly', priority: '0.3' }
    ];
    const urls = pages.map(p => `  <url><loc>${p.loc}</loc><lastmod>${today}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`).join('\n');
    res.header('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
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
  setInterval(async () => { try { await supabase.from('sessions').delete().lt('expire', new Date().toISOString()); console.log('🧹 Sessions expirées nettoyées'); } catch (e) { console.warn('Erreur nettoyage sessions:', e.message); } }, 60 * 60 * 1000);
});