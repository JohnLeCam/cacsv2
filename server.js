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

  // !close
  if (message.content === '!close' && message.channel.name?.startsWith('ticket-')) {
    const member  = message.member;
    const isStaff = STAFF_ROLE_IDS.some(roleId => member?.roles.cache.has(roleId));
    if (!isStaff) { await message.reply('❌ Seul un membre du staff peut fermer ce ticket.'); return; }
    await message.channel.send('🔒 Ticket fermé par le staff. Ce salon sera supprimé dans 5 secondes.');
    setTimeout(() => message.channel.delete().catch(() => {}), 5000);
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

// ── 1. BASE ───────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Trop de requêtes, réessaie dans quelques minutes.' } }));

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

// ── 3. MAINTENANCE ────────────────────────────────────────────
async function isMaintenanceMode() { try { const { data } = await supabase.from('site_config').select('value').eq('key', 'maintenance_mode').single(); return data?.value === 'true'; } catch (e) { return false; } }
app.get('/maintenance', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'maintenance.html')); });
app.use(async (req, res, next) => {
  const bypassPaths = ['/maintenance','/auth/discord','/auth/discord/callback','/auth/logout','/api/user','/api/maintenance-status','/sitemap.xml','/robots.txt','/api/visitor','/cgvu','/legal'];
  const isAsset = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|webp|map)(\?.*)?$/.test(req.path);
  if (bypassPaths.some(p => req.path.startsWith(p)) || isAsset) return next();
  const maintenance = await isMaintenanceMode();
  if (!maintenance) return next();
  const user = req.session.user;
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
  const user = req.session.user;
  const isStaff = user && STAFF_ROLE_IDS.some(id => user.roles.includes(id));
  const isAdmin = user && config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id));
  res.json({ maintenance, isStaff: !!(isStaff || isAdmin) });
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
    site: { title: site.title || '', subtitle: site.subtitle || '', discordUrl: site.discordUrl || '', announcement: site.announcement || '', heroTagline: site.heroTagline || '', maintenance_mode: site.maintenance_mode || 'false', logo_url: site.logo_url || '' },
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
  const hasAdminRole = config.ADMIN_ROLE_IDS.some(id => user.roles.includes(id));
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

app.get('/api/admin/orders', requireAdmin, async (req, res) => { try { const { data: orders, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false }); if (error) throw error; res.json(orders); } catch (err) { res.status(500).json({ error: 'Erreur lecture commandes' }); } });

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

// ── Annonce Discord ───────────────────────────────────────────
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID || '';
const ANNOUNCE_ROLE_ID    = '1489946990405095495';
const SHOP_URL            = 'https://cacsgtavmods.fr/';
const EMBED_BANNER_URL    = 'https://img.draftbot.fr/1773366849212-87a12e25b4502138.png';

app.post('/api/admin/discord-announce', requireAdmin, async (req, res) => {
  const { modName, modLink } = req.body;
  if (!modName) return res.status(400).json({ error: 'Nom du mod manquant.' });
  if (!ANNOUNCE_CHANNEL_ID) return res.status(500).json({ error: 'ANNOUNCE_CHANNEL_ID non configuré.' });
  try {
    const channel = await discordBot.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
    if (!channel) return res.status(500).json({ error: `Salon introuvable (${ANNOUNCE_CHANNEL_ID}).` });
    let description = `Un nouvel asset est disponible sur notre boutique :\n**${SHOP_URL}**\n\n`;
    if (modLink) description += `🔗 **[Voir le mod directement](${modLink})**\n\n`;
    description += `Utilisez le lien ci-dessous pour consulter le nouvel asset mis en vente !\n\nN'oubliez pas de vous connecter avec Discord directement sur notre site (connexion sécurisée), ajoutez ensuite les assets souhaités dans votre panier et validez-le. Un ticket avec votre demande sera automatiquement créé sur notre Discord.\n\nEn cas de besoin, le salon **#🎫︱Creer-Ticket** reste à votre disposition.`;
    await channel.send({ content: `<@&${ANNOUNCE_ROLE_ID}>`, embeds: [new EmbedBuilder().setColor(0x1abc9c).setTitle('NOUVEL ASSET PUBLIÉ SUR NOTRE BOUTIQUE !').setDescription(description).setImage(EMBED_BANNER_URL).setFooter({ text: "Cac's GTAV Mods" })] });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sauvegarde admin ──────────────────────────────────────────
app.post('/api/admin/save', requireAdmin, async (req, res) => {
  const d = req.body;
  try {
    if (d.site) { await Promise.all(Object.entries(d.site).map(([key, value]) => supabase.from('site_config').upsert({ key, value: String(value) }, { onConflict: 'key' }))); }
    if (d.categories?.length) { const { data: existingCats } = await supabase.from('categories').select('id'); const toDeleteCats = (existingCats || []).map(c => c.id).filter(id => !d.categories.find(c => c.id === id)); if (toDeleteCats.length > 0) await supabase.from('categories').delete().in('id', toDeleteCats); for (const cat of d.categories) await supabase.from('categories').upsert({ id: cat.id, name: cat.name, color: cat.color || '#ffffff', icon: cat.icon || '📦', position: cat.position ?? 0 }, { onConflict: 'id' }); }
    if (d.mods) { const { data: existingMods } = await supabase.from('mods').select('id'); const toDelete = (existingMods || []).map(m => m.id).filter(id => !d.mods.find(m => m.id === id)); if (toDelete.length > 0) await supabase.from('mods').delete().in('id', toDelete); for (const mod of d.mods) { const { error: e } = await supabase.from('mods').upsert({ id: mod.id, name: mod.name, category: mod.category, description: mod.description || '', image: mod.image || '', base_price: mod.basePrice || 0, images: mod.images || [], featured: mod.featured || false, visible: mod.visible !== false, position: mod.position ?? 0 }, { onConflict: 'id' }); if (e) console.error('❌ Erreur upsert mod:', e.message); } }
    if (d.promotions) { const { data: existingPromos } = await supabase.from('promotions').select('id'); const toDeletePromos = (existingPromos || []).map(p => p.id).filter(id => !d.promotions.find(p => p.id === id)); if (toDeletePromos.length > 0) await supabase.from('promotions').delete().in('id', toDeletePromos); for (const promo of d.promotions) await supabase.from('promotions').upsert({ id: promo.id, name: promo.name, description: promo.description || '', discount_percent: promo.discountPercent || 0, end_date: promo.endDate, apply_to_categories: promo.applyToCategories || [], active: promo.active !== false, color: promo.color || '#cc0000' }, { onConflict: 'id' }); }
    if (d.discordRoles) { const { data: existingRoles } = await supabase.from('discord_roles').select('role_id'); const toDeleteRoles = (existingRoles || []).map(r => r.role_id).filter(id => !d.discordRoles.find(r => r.roleId === id)); if (toDeleteRoles.length > 0) await supabase.from('discord_roles').delete().in('role_id', toDeleteRoles); for (const role of d.discordRoles) await supabase.from('discord_roles').upsert({ role_id: role.roleId, role_name: role.roleName, discount: role.discount || 0, color: role.color || '#ffffff' }, { onConflict: 'role_id' }); }
    res.json({ success: true });
    invalidatePublicCache();
  } catch (err) { res.status(500).json({ error: 'Erreur sauvegarde : ' + err.message }); }
});

// ── 12. API COMMANDE ──────────────────────────────────────────
app.post('/api/order', async (req, res) => {
  const { items, discordUser } = req.body;
  if (!discordUser?.id || !discordUser?.username) return res.status(401).json({ error: 'Vous devez être connecté avec Discord pour passer commande.' });
  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Panier vide.' });
  if (items.length > 20) return res.status(400).json({ error: 'Trop d\'articles dans le panier.' });
  for (const item of items) { if (!item.id || typeof item.id !== 'string') return res.status(400).json({ error: 'Article invalide (id manquant).' }); if (!item.name || typeof item.name !== 'string' || item.name.length > 200) return res.status(400).json({ error: 'Article invalide.' }); }
  let dbMods, activePromos;
  try { [dbMods, activePromos] = await Promise.all([getMods(true), getPromotions(true)]); } catch (e) { return res.status(500).json({ error: 'Erreur lecture base de données.' }); }
  let serverTotal = 0; const validatedItems = [];
  for (const item of items) {
    const dbMod = dbMods.find(m => m.id === item.id);
    if (!dbMod) return res.status(400).json({ error: `Mod introuvable : ${item.id}` });
    let promoDiscount = 0;
    for (const p of activePromos) { if (!p.apply_to_categories?.length || p.apply_to_categories.includes(dbMod.category)) { if (p.discount_percent > promoDiscount) promoDiscount = p.discount_percent; } }
    const serverPrice = parseFloat(dbMod.base_price) * (1 - promoDiscount / 100);
    const opts = item.options || {}, extra = (opts.debadgage ? 10 : 0) + (opts.retexture ? 5 : 0), qty = Math.max(1, Math.min(10, parseInt(item.quantity) || 1));
    serverTotal += (serverPrice + extra) * qty;
    validatedItems.push({ ...item, price: serverPrice, quantity: qty });
  }
  const coreOption = req.body.coreOption === true;
  if (coreOption) serverTotal += 10;
  serverTotal = Math.round(serverTotal * 100) / 100;
  try {
    const guild = discordBot.guilds.cache.first();
    if (!guild) return res.status(500).json({ error: 'Bot non connecté au serveur Discord.' });
    let member = null;
    if (discordUser?.id) { try { member = await guild.members.fetch(discordUser.id); } catch (e) {} }
    const timestamp = Date.now().toString().slice(-5), username = discordUser?.username || 'visiteur', ticketName = `ticket-${username.toLowerCase().replace(/[^a-z0-9]/g, '')}-${timestamp}`;
    const permissionOverwrites = [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }];
    if (member) permissionOverwrites.push({ id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    for (const roleId of STAFF_ROLE_IDS) permissionOverwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] });
    const channel = await guild.channels.create({ name: ticketName, type: ChannelType.GuildText, parent: TICKET_CAT_ID, permissionOverwrites, topic: `Commande de ${username} — ${new Date().toLocaleDateString('fr-FR')}` });
    const itemLines = validatedItems.map(item => { const opts = item.options || {}, extra = (opts.debadgage ? 10 : 0) + (opts.retexture ? 5 : 0), total = (item.price + extra) * item.quantity, optStr = [opts.debadgage ? '🔧 Debadgage (+10€)' : '', opts.retexture ? '🎨 Retexture (+5€)' : ''].filter(Boolean).join(', '); return `> 🔹 **${item.name}** — **${formatPrice(total)}**${optStr ? `\n>    └ ${optStr}` : ''}`; }).join('\n');
    const coreLines = coreOption ? `\n> 📦 **Ressource [CORE]** — **${formatPrice(10)}**` : '';
    const staffMentions = STAFF_ROLE_IDS.map(id => `<@&${id}>`).join(' ');
    const clientMention = member ? `<@${member.id}>` : `**${username}**`;
    await channel.send([`# 🛒 Nouvelle commande — ${new Date().toLocaleDateString('fr-FR')}`, ``, `**Client :** ${clientMention}`, `**Total :** **${formatPrice(serverTotal)}**`, ``, `## 📦 Articles commandés`, itemLines + coreLines, ``, `## 👷 Staff notifié`, staffMentions, ``, `---`, `*Pour fermer ce ticket : tapez* \`!close\``].join('\n'));
    const orderData = { discord_username: username, discord_id: discordUser?.id || null, ticket_channel: ticketName, total_price: serverTotal, items: validatedItems, core_option: coreOption, created_at: new Date().toISOString() };
    const embed = buildStatusEmbed(orderData, 'pending'), embedMsg = await channel.send({ embeds: [embed] });
    try { await supabase.from('orders').insert({ ...orderData, channel_id: channel.id, status_message_id: embedMsg.id, status: 'pending' }); } catch (e) { console.warn('Impossible de sauvegarder la commande:', e.message); }
    console.log(`🎫 Ticket créé : #${ticketName} pour ${username}`);
    broadcastLive({ type: 'new_order', username, total: serverTotal });
    res.json({ success: true, ticketChannel: ticketName, channelId: channel.id });
  } catch (err) { console.error('Erreur création ticket:', err); res.status(500).json({ error: 'Impossible de créer le ticket : ' + err.message }); }
});

// ── 13. CGVU & LÉGAL ─────────────────────────────────────────
app.get('/cgvu',  (req, res) => { res.sendFile(path.join(__dirname, 'public', 'cgvu.html')); });
app.get('/legal', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'legal.html')); });

// ── 14. SITEMAP ───────────────────────────────────────────────
app.get('/sitemap.xml', async (req, res) => {
  try {
    const mods = await getMods(true), today = new Date().toISOString().slice(0, 10);
    const modUrls = mods.map(m => `\n  <url><loc>https://cacs-gtavmods.fr/#${encodeURIComponent(m.id)}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`).join('');
    res.header('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://cacs-gtavmods.fr/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>${modUrls}\n</urlset>`);
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