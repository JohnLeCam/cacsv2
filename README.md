# 🎮 Cac's GTA V Mods — Site Vitrine
**par C&M Modding**

---

## 📋 Ce que fait ce site

- **Page vitrine** attrayante avec catalogue de mods (véhicules, scripts, livrées, EUP)
- **Promotions** avec compte à rebours en temps réel
- **Connexion Discord** qui détecte les rôles et affiche des prix réduits automatiquement
- **Panel Admin** pour tout gérer sans toucher au code

---

## 🚀 Installation en 5 étapes

### Étape 1 : Installer Node.js
Si tu n'as pas Node.js, télécharge-le ici : https://nodejs.org/
→ Prends la version **LTS** (la recommandée)

### Étape 2 : Installer les dépendances
Ouvre un terminal dans le dossier du projet et tape :
```
npm install
```

### Étape 3 : Configurer Discord
Ouvre le fichier `config/discord.config.js` et remplis :

```javascript
CLIENT_ID:     'Ton Client ID (Discord Developer Portal > OAuth2)',
CLIENT_SECRET: 'Ton Client Secret',
REDIRECT_URI:  'http://localhost:3000/auth/discord/callback',
GUILD_ID:      'L\'ID de ton serveur Discord',
SESSION_SECRET: 'changez-cette-valeur-par-nimporte-quoi-de-long'
```

**Où trouver ces infos :**
1. Va sur https://discord.com/developers/applications
2. Crée une nouvelle application
3. Dans "OAuth2" > copie le Client ID et le Client Secret
4. Dans "OAuth2" > "Redirects" > Ajoute : `http://localhost:3000/auth/discord/callback`
5. L'ID du serveur : Discord > Mode développeur activé > Clic droit sur le serveur > Copier l'ID

### Étape 4 : Lancer le serveur
```
npm start
```
Ou en mode développement (redémarre automatiquement si tu modifies le code) :
```
npm run dev
```

### Étape 5 : Ouvrir le site
- **Site vitrine** : http://localhost:3000
- **Panel Admin** : http://localhost:3000/admin
  - Mot de passe par défaut : `admin123` ← **CHANGE-LE EN PREMIER !**

---

## ⚙️ Panel Admin — Ce que tu peux faire

| Onglet | Ce que tu gères |
|--------|-----------------|
| 📊 Dashboard | Vue d'ensemble, statistiques |
| 🎮 Mods | Ajouter / modifier / supprimer des mods, prix, images |
| 🔥 Promotions | Créer des promos avec compte à rebours |
| 🎖️ Rôles Discord | Configurer les réductions par rôle |
| ⚙️ Configuration | Titre, liens Discord, annonce, catégories |
| 🔒 Paramètres | Changer le mot de passe admin |

---

## 🎖️ Comment fonctionnent les réductions Discord

1. L'utilisateur clique "Connexion Discord"
2. Discord lui demande d'autoriser l'accès
3. Le site récupère ses rôles dans **ton** serveur Discord
4. Si un de ses rôles correspond à la liste dans le panel admin → réduction affichée
5. Si plusieurs rôles matchent → la **plus grande** réduction est appliquée
6. Promos et réductions de rôle se **cumulent**

**Exemple :**
- Rôle "VIP" = -15%
- Promo "Lancement" = -20%
- Utilisateur VIP pendant la promo = -35% 

---

## 📁 Structure des fichiers

```
cacs-mods/
├── server.js              ← Serveur principal (à ne pas modifier)
├── package.json           ← Dépendances
├── config/
│   └── discord.config.js  ← ⚠️ À CONFIGURER
├── data/
│   └── site-data.json     ← Données du site (mods, promos, etc.)
└── public/
    ├── index.html         ← Page principale du site
    ├── css/style.css      ← Design
    ├── js/main.js         ← JavaScript du site
    └── admin/
        ├── index.html     ← Panel admin
        └── js/admin.js    ← JavaScript admin
```

---

## 🌐 Mettre le site en ligne

Pour mettre le site en production (en ligne avec un vrai domaine) :

1. Change `REDIRECT_URI` dans `discord.config.js` pour ton domaine :
   ```
   REDIRECT_URI: 'https://tondomaine.com/auth/discord/callback'
   ```
2. N'oublie pas d'ajouter cette URL dans le Discord Developer Portal aussi
3. Mets `cookie: { secure: true }` dans server.js si tu as HTTPS
4. Change `SESSION_SECRET` pour quelque chose de très long et aléatoire

Hébergeurs compatibles : **Railway**, **Render**, **VPS** (OVH, etc.)

---

## ❓ FAQ

**Q : Le bouton Discord ne marche pas ?**
R : Vérifie que tu as bien configuré `config/discord.config.js` et que l'URL de callback est ajoutée dans Discord Developer Portal.

**Q : Les rôles ne sont pas détectés ?**
R : Vérifie que le GUILD_ID est correct et que l'utilisateur est bien membre du serveur.

**Q : Je veux changer les couleurs ?**
R : Ouvre `public/css/style.css`, les couleurs sont dans les variables CSS tout en haut (`:root`).

**Q : Comment ajouter des images aux mods ?**
R : Dans le panel admin, dans la fiche du mod, colle l'URL d'une image. Tu peux héberger tes images sur Imgur, Cloudinary, etc.

---

*Site développé pour C&M Modding — AMRP-John*
