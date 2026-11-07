/* Hub : profil, salon commun et lancement des jeux dans une iframe.
   Le salon (DDRoom) vit ici pendant toute la session : changer de jeu ne coupe pas la connexion. */
(function () {
  const VERSION = '4.62';
  const $ = (s) => document.querySelector(s);
  const ORIGIN = location.origin === 'null' ? '*' : location.origin;
  const GAMES = window.HUB_GAMES;
  // jeux visibles par ce joueur (les jeux VIP en sont retirés pour les autres : hub/vip.js) ; un VIP peut quand même en lancer un dans son salon
  const gameDef = (id) => GAMES.find((g) => g.id === id) || (window.HUB_GAMES_ALL || []).find((g) => g.id === id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const QS = new URLSearchParams(location.search);
  const FR = window.HubFriends;
  // N'écrit que si le contenu change : un clic n'est jamais perdu parce que la liste a été reconstruite sous la souris
  const shown = new WeakMap();
  const setHTML = (el, html) => { if (shown.get(el) !== html) { shown.set(el, html); el.innerHTML = html; } };

  let me = DDProfile.load();
  let room = null;
  let frame = null;        // { game, n, el, loaded }
  let leftGame = null;     // partie quittée volontairement (pas de rechargement automatique)
  let launchAnyway = 0;    // lancer malgré une version différente : second clic dans les 8 s
  const pick = { game: GAMES[0].id, settings: {} };
  for (const g of GAMES) {
    pick.settings[g.id] = {};
    // un réglage retenu qui n'existe plus pour ce joueur (option VIP, option retirée) revient à sa valeur par défaut
    for (const s of g.settings || []) { const v = DDProfile.get('hub_set_' + g.id + '_' + s.key, s.def); pick.settings[g.id][s.key] = (s.options || []).some(([o]) => String(o) === String(v)) ? v : s.def; }
  }

  function showScreen(id) { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id); document.dispatchEvent(new CustomEvent('hub:screen', { detail: id })); }
  let toastT = 0;
  function toast(msg, ms = 2800) {
    let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
  }

  /* ------------------------------------------------------------ mises à jour */
  // Un onglet ouvert avant une mise en ligne garde l'ancienne version tant qu'on ne le recharge pas : ses jeux n'ont
  // plus les mêmes fichiers que ceux des autres joueurs (au Backrooms, une autre carte). Le Hub compare sa version à
  // celle en ligne (au démarrage, puis toutes les 3 minutes hors partie) et à celle de chaque joueur du salon : en
  // retard, il se met à jour tout seul et revient dans le même salon.
  const verNum = (v) => { const m = /^(\d+)\.(\d+)$/.exec(String(v || '')); return m ? +m[1] * 10000 + +m[2] : 0; };
  async function onlineVersion() {
    try {
      const r = await fetch('hub/hub.js?t=' + Date.now(), { cache: 'no-store' });
      const m = /const VERSION = '([\d.]+)'/.exec(await r.text());
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }
  let updating = false;
  async function updateTo(target, extra = []) {
    if (updating) return;
    // on vient déjà de recharger pour cette version (elle n'est pas encore servie partout) : pas de boucle
    let last = null;
    try { last = JSON.parse(sessionStorage.getItem('hub_update') || 'null'); } catch (e) {}
    if (last && last.v === target && Date.now() - last.t < 120000) { toast(`La version ${target} arrive : recharge la page dans une minute (Ctrl+Maj+R)`, 6000); return; }
    updating = true;
    try { sessionStorage.setItem('hub_update', JSON.stringify({ v: target, t: Date.now() })); } catch (e) {}
    toast(`Mise à jour vers la version ${target}…`, 8000);
    // les fichiers du Hub gardés par le navigateur sont repris pour de bon, puis la page (on revient dans le salon)
    // (et ceux du jeu, quand c'est lui qui a vu que sa carte n'était pas celle de l'hôte)
    const urls = [...document.querySelectorAll('script[src], link[rel=stylesheet][href]')].map((e) => e.src || e.href).concat(extra).filter((u) => u.startsWith(location.origin + '/'));
    await Promise.all(urls.map((u) => fetch(u, { cache: 'reload' }).catch(() => {})));
    const q = new URLSearchParams();
    for (const k of ['local', 'ws', 'as', 'debug', 'mute']) if (QS.has(k)) q.set(k, QS.get(k));
    // l'hôte qui part laisse le salon au suivant, sous un autre code : c'est celui-là qu'on rejoint en revenant
    const code = room && room.successorCode();
    if (code) q.set('join', code);
    location.replace(location.pathname + (q.toString() ? '?' + q.toString().replace(/=(&|$)/g, '$1') : ''));
  }
  async function checkOnline() {
    if (frame || updating) return; // jamais au milieu d'une partie
    const v = await onlineVersion();
    if (verNum(v) > verNum(VERSION) && !frame) updateTo(v);
  }
  // les joueurs du salon qui n'ont pas notre version (sans version : un Hub d'avant cette vérification, donc ancien)
  const otherVersion = (p) => p.id !== (room && room.myId) && (p.ver || '') !== VERSION;
  let peerWarned = '';
  function checkPeers() {
    if (!room || room.mode === 'solo') return;
    const newer = room.players.filter((p) => p.id !== room.myId && verNum(p.ver) > verNum(VERSION)).sort((a, b) => verNum(b.ver) - verNum(a.ver))[0];
    if (!newer) return;
    if (!frame) { updateTo(newer.ver); return; }
    if (peerWarned !== newer.ver) { peerWarned = newer.ver; toast(`${newer.name} a la version ${newer.ver} : tu seras mis à jour à la fin de la partie`, 6000); }
  }
  setTimeout(checkOnline, 4000);
  setInterval(checkOnline, 180000);

  /* ------------------------------------------------------------ accueil */
  $('#ver').textContent = 'v' + VERSION;
  // Vignette d'un jeu, la même à l'accueil et dans le salon : l'affiche porte le titre et le sous-titre
  function gameCard(g, { el = 'div', cls = '', attrs = '', extra = '' } = {}) {
    const bots = g.bots || (g.settings || []).some((s) => s.key === 'bots');
    return `<${el} class="game${cls}" ${attrs}>
      <span class="cv" style="--acc:${esc(g.accent || '#2b8cff')}"><b class="ph">${esc(g.title)}</b><img src="${esc(g.cover)}" alt="${esc(g.title)}" width="960" height="540" loading="lazy" decoding="async" onload="this.classList.add('in')" onerror="this.remove()"></span>
      <span class="tx"><span class="ds">${esc(g.desc)}</span>
        <span class="meta"><span class="chip">👥 ${g.minPlayers} à ${g.maxPlayers} joueurs</span>${bots ? '<span class="chip">🤖 Bots</span>' : ''}</span>${extra}</span></${el}>`;
  }
  $('#shelf').innerHTML = GAMES.map((g) => gameCard(g, { attrs: `data-g="${g.id}"` })).join('');
  $('#shelfCount').textContent = GAMES.length + ' jeux';
  $('#name').value = me.name;
  $('#name').addEventListener('input', (e) => { me.name = e.target.value.slice(0, 12); DDProfile.save(me); FR.setMe(profile()); renderAccount(); if (room) room.updateMe(me); });
  function renderSwatches() {
    const box = $('#swatches'); box.innerHTML = '';
    for (const c of DDProfile.PALETTE) {
      const b = document.createElement('button'); b.className = 'sw' + (c === me.color ? ' sel' : ''); b.style.background = c;
      b.setAttribute('aria-label', 'Couleur ' + c); b.onclick = () => { me.color = c; DDProfile.save(me); FR.setMe(profile()); renderSwatches(); renderAccount(); scheduleSync(); };
      box.appendChild(b);
    }
  }
  renderSwatches();
  const joinParam = new URLSearchParams(location.search).get('join');
  if (joinParam) { $('#joinCode').value = joinParam.toUpperCase().slice(0, 4); }
  $('#joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  $('#joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoin').click(); });
  const homeErr = (m) => { $('#homeErr').textContent = m || ''; };

  /* ------------------------------------------------------------ compte */
  // Le compte vit dans ce navigateur : pseudo, couleur, identifiant du classement et clé du code ami. Un code de
  // transfert l'emporte sur un autre appareil (le serveur relais ne garde rien).
  const ACCT_K = FR.storeKey('hub_account');
  let registered = !!DDProfile.get(ACCT_K, null), editing = false;
  if (!registered && me.name.trim()) { registered = true; DDProfile.set(ACCT_K, Date.now()); } // joueurs d'avant les comptes
  function renderAccount() {
    $('#acct').hidden = !registered; $('#regHead').hidden = registered; $('#regActions').hidden = registered; $('#playActions').hidden = !registered;
    $('#profileEdit').hidden = registered && !editing; $('#acctTools').hidden = !registered;
    const sess = HubAccount.session();
    $('#pwBox').hidden = registered; $('#btnCloud').hidden = !!sess;
    $('#acctSub').textContent = sess ? `Compte en ligne · ${sess.user}${window.HubVIP && window.HubVIP.is() ? ' · ⭐ VIP' : ''}` : 'Compte enregistré sur ce navigateur';
    $('#acctName').textContent = DDRoom.cleanName(me.name); $('#acctDot').style.background = me.color;
    $('#btnProfile').textContent = editing ? 'OK' : 'Modifier'; $('#btnProfile').setAttribute('aria-expanded', String(editing));
  }
  // profil emporté par le compte en ligne (chiffré avant de partir) : pseudo, couleur, classement, code ami et amis
  const snapshot = () => ({ v: 1, n: me.name, c: me.color, u: me.uid, fr: FR.backup() });
  function applySnapshot(d) {
    if (!d || !d.fr || !FR.restore(d.fr)) return false;
    DDProfile.set('dd_name', String(d.n || '').slice(0, 12));
    if (DDProfile.PALETTE.includes(d.c)) DDProfile.set('dd_color', d.c);
    if (/^[a-z0-9]{6,16}$/.test(String(d.u))) DDProfile.set('dd_uid', d.u);
    DDProfile.set(ACCT_K, Date.now());
    return true;
  }
  let syncTimer = null, lastSync = '';
  function scheduleSync() {
    if (!HubAccount.session()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const d = snapshot(), k = JSON.stringify(d);
      if (k === lastSync) return;
      HubAccount.save(d).then(() => { lastSync = k; }, () => {});
    }, 3000);
  }
  FR.on('change', scheduleSync);
  const ACCT_ERR = { taken: 'Ce pseudo est déjà pris en ligne : choisis-en un autre, ou connecte-toi.', auth: 'Identifiant ou mot de passe incorrect.',
    wait: 'Trop d\'essais : réessaie dans quelques minutes.', user: 'Identifiant : 3 à 20 lettres ou chiffres.', decrypt: 'Impossible de déchiffrer ce compte.',
    off: 'Les comptes en ligne ne sont pas encore disponibles sur le serveur.', net: 'Serveur injoignable : vérifie ta connexion et réessaie.' };
  const acctErr = (e) => ACCT_ERR[e && e.code] || 'Le serveur n\'a pas répondu, réessaie.';
  async function register() {
    const n = me.name.trim(), pass = $('#pass').value;
    if (n.length < 2) { $('#regErr').textContent = 'Choisis un pseudo (2 caractères au moins).'; $('#name').focus(); return; }
    const user = HubAccount.normUser(n);
    if (!user) { $('#regErr').textContent = 'Pour le compte en ligne, ton pseudo doit avoir 3 lettres ou chiffres au moins.'; $('#name').focus(); return; }
    if (pass.length < 6) { $('#regErr').textContent = 'Choisis un mot de passe de 6 caractères au moins.'; $('#pass').focus(); return; }
    $('#btnRegister').disabled = true; $('#regErr').textContent = 'Création du compte… (le serveur peut mettre 30 s à se réveiller)';
    DDProfile.save(me);
    try { await HubAccount.create(user, pass, snapshot()); lastSync = JSON.stringify(snapshot()); }
    catch (e) {
      $('#btnRegister').disabled = false;
      if (!['off', 'net'].includes(e.code) || !confirm(acctErr(e) + "\n\nCréer le compte seulement sur ce navigateur pour l'instant ? (tu pourras le protéger par mot de passe plus tard)")) { $('#regErr').textContent = acctErr(e); return; }
    }
    $('#btnRegister').disabled = false; $('#regErr').textContent = ''; $('#pass').value = '';
    registered = true; DDProfile.set(ACCT_K, Date.now()); DDProfile.save(me);
    renderAccount(); FR.start(profile()); renderFriends();
    toast(HubAccount.session() ? `Bienvenue ${DDRoom.cleanName(n)} ! Ton compte est sauvegardé en ligne : identifiant « ${HubAccount.session().user} ».` : `Bienvenue ${DDRoom.cleanName(n)} ! Ton compte est enregistré dans ce navigateur.`, 4500);
    if ($('#joinCode').value.length === 4) $('#btnJoin').click(); // arrivé par un lien d'invitation
  }
  $('#btnRegister').onclick = register;
  $('#name').addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; if (!registered) $('#pass').focus(); else if (editing) $('#btnProfile').click(); });
  $('#pass').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !registered) register(); });
  $('#name').addEventListener('change', scheduleSync);
  $('#btnProfile').onclick = () => { editing = !editing; renderAccount(); if (editing) $('#name').focus(); };
  const b64 = {
    enc: (t) => btoa(String.fromCharCode(...new TextEncoder().encode(t))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: (t) => new TextDecoder().decode(Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
  };
  function dialog(title, html) {
    const ov = document.createElement('div'); ov.className = 'ntov';
    ov.innerHTML = `<div class="nt card" role="dialog" aria-label="${esc(title)}"><button class="ntx" aria-label="Fermer">×</button><h2>${esc(title)}</h2>${html}</div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector('.ntx').onclick = close;
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    return ov;
  }
  $('#btnTransfer').onclick = () => {
    const code = 'GH1.' + b64.enc(JSON.stringify({ ...FR.backup(), u: me.uid, n: me.name, c: me.color }));
    const ov = dialog('Ton compte sur un autre appareil', `<p class="nthint">Copie ce code, puis sur l'autre appareil : « J'ai déjà un compte sur un autre appareil ». Tu y retrouves ton pseudo, ton code ami et tes amis. Garde-le pour toi : il ouvre ton compte.</p>
      <textarea class="xfer" readonly rows="4" aria-label="Code de transfert">${esc(code)}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn yellow" id="xCopy">Copier le code</button></div>`);
    ov.querySelector('textarea').onfocus = (e) => e.target.select();
    ov.querySelector('#xCopy').onclick = () => (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject())
      .then(() => toast('Code de transfert copié'), () => { ov.querySelector('textarea').select(); toast('Sélectionne le code et copie-le'); });
  };
  $('#btnRestore').onclick = () => {
    const ov = dialog('Me connecter', `<p class="nthint">Ton identifiant (ton pseudo à la création du compte) et ton mot de passe : tu retrouves ton pseudo, ta couleur, ton code ami, tes amis et tes sauvegardes.</p>
      <label class="lbl" for="lgUser">Identifiant</label><input type="text" id="lgUser" maxlength="20" autocomplete="username" spellcheck="false">
      <label class="lbl" for="lgPass">Mot de passe</label><input type="password" id="lgPass" maxlength="64" autocomplete="current-password">
      <div class="err" id="lgErr"></div>
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:10px"><button class="linkbtn" id="lgCode" type="button">J'ai un code de transfert</button><button class="btn" id="lgGo">Me connecter</button></div>`);
    const u = ov.querySelector('#lgUser'), pw = ov.querySelector('#lgPass'), err = ov.querySelector('#lgErr'), go = ov.querySelector('#lgGo');
    u.focus();
    const doLogin = async () => {
      if (!HubAccount.normUser(u.value)) { err.textContent = ACCT_ERR.user; return; }
      go.disabled = true; err.textContent = 'Connexion… (le serveur peut mettre 30 s à se réveiller)';
      try { const d = await HubAccount.login(u.value, pw.value); if (!applySnapshot(d)) throw Object.assign(new Error('decrypt'), { code: 'decrypt' }); location.reload(); }
      catch (e) { go.disabled = false; err.textContent = acctErr(e); }
    };
    go.onclick = doLogin;
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    ov.querySelector('#lgCode').onclick = () => { ov.remove(); openTransferRestore(); };
  };
  function openTransferRestore() {
    const ov = dialog("J'ai déjà un compte", `<p class="nthint">Sur ton autre appareil, ouvre « Modifier », puis « 📲 Mon compte sur un autre appareil », copie le code et colle-le ici.</p>
      <textarea class="xfer" rows="4" aria-label="Code de transfert" placeholder="GH1.…"></textarea><div class="err" id="xErr"></div>
      <div class="row" style="justify-content:flex-end"><button class="btn" id="xGo">Récupérer mon compte</button></div>`);
    const ta = ov.querySelector('textarea'); ta.focus();
    ov.querySelector('#xGo').onclick = () => {
      let d = null;
      try { const t = ta.value.trim(); if (t.startsWith('GH1.')) d = JSON.parse(b64.dec(t.slice(4))); } catch (e) {}
      if (!d || !FR.restore(d)) { ov.querySelector('#xErr').textContent = "Ce code n'est pas valide : copie-le en entier."; return; }
      DDProfile.set('dd_name', String(d.n || '').slice(0, 12));
      if (DDProfile.PALETTE.includes(d.c)) DDProfile.set('dd_color', d.c);
      if (/^[a-z0-9]{6,16}$/.test(String(d.u))) DDProfile.set('dd_uid', d.u);
      DDProfile.set(ACCT_K, Date.now());
      location.reload();
    };
  }
  // compte de ce navigateur seulement : le protéger par un mot de passe (il part en ligne, chiffré)
  $('#btnCloud').onclick = () => {
    const ov = dialog('Protéger mon compte', `<p class="nthint">Ton compte sera sauvegardé en ligne, chiffré avec ton mot de passe. Tu pourras t'y connecter sur n'importe quel appareil. Attention : un mot de passe oublié ne peut pas être récupéré.</p>
      <label class="lbl" for="cuUser">Identifiant</label><input type="text" id="cuUser" maxlength="20" spellcheck="false" autocomplete="username" value="${esc(HubAccount.normUser(me.name))}">
      <label class="lbl" for="cuPass">Mot de passe</label><input type="password" id="cuPass" maxlength="64" autocomplete="new-password" placeholder="6 caractères au moins">
      <label class="lbl" for="cuPass2">Encore une fois</label><input type="password" id="cuPass2" maxlength="64" autocomplete="new-password">
      <div class="err" id="cuErr"></div>
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="cuGo">Protéger mon compte</button></div>`);
    const err = ov.querySelector('#cuErr'), go = ov.querySelector('#cuGo');
    go.onclick = async () => {
      const user = ov.querySelector('#cuUser').value, p1 = ov.querySelector('#cuPass').value, p2 = ov.querySelector('#cuPass2').value;
      if (!HubAccount.normUser(user)) { err.textContent = ACCT_ERR.user; return; }
      if (p1.length < 6) { err.textContent = 'Choisis un mot de passe de 6 caractères au moins.'; return; }
      if (p1 !== p2) { err.textContent = 'Les deux mots de passe ne sont pas pareils.'; return; }
      go.disabled = true; err.textContent = 'Envoi… (le serveur peut mettre 30 s à se réveiller)';
      try { await HubAccount.create(user, p1, snapshot()); lastSync = JSON.stringify(snapshot()); ov.remove(); renderAccount(); toast(`Compte protégé : identifiant « ${HubAccount.session().user} »`, 4000); }
      catch (e) { go.disabled = false; err.textContent = acctErr(e); }
    };
  };
  $('#btnLogout').onclick = () => {
    const online = HubAccount.session();
    if (!confirm(online ? `Se déconnecter de ce navigateur ?\n\nTu pourras te reconnecter avec ton identifiant « ${online.user} » et ton mot de passe.` : "Se déconnecter de ce navigateur ?\n\nSans ton code de transfert (📲), ce compte et ta liste d'amis seront perdus ici.")) return;
    HubAccount.logout();
    if (room) room.leave();
    FR.forget(); DDProfile.set(ACCT_K, null); DDProfile.set('dd_name', ''); DDProfile.set('dd_uid', null);
    location.reload();
  };
  renderAccount();

  /* ------------------------------------------------------------ test de connexion */
  function openNetTest() {
    const ov = document.createElement('div'); ov.className = 'ntov';
    ov.innerHTML = `<div class="nt card" role="dialog" aria-label="Test de connexion"><button class="ntx" aria-label="Fermer">×</button>
      <h2>Test de connexion</h2><p class="nthint">Une vingtaine de secondes. Lance-le sur le réseau où le multijoueur ne marche pas.</p>
      <ul class="ntlist"></ul><div class="ntverdict" hidden></div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn small ghost" id="ntCopy" hidden>Copier le résultat</button><button class="btn small" id="ntAgain" hidden>Recommencer</button></div></div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector('.ntx').onclick = close;
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    const list = ov.querySelector('.ntlist');
    let lines = [];
    const go = async () => {
      list.innerHTML = ''; lines = [];
      ov.querySelector('.ntverdict').hidden = true; ov.querySelector('#ntCopy').hidden = true; ov.querySelector('#ntAgain').hidden = true;
      const R = await DDNetTest.run((key, label, v) => {
        let li = list.querySelector(`[data-k="${key}"]`);
        if (!li) { li = document.createElement('li'); li.dataset.k = key; list.appendChild(li); }
        const ms = v && typeof v === 'object' ? v : null;   // le ping : un résultat chiffré
        const txt = v === null ? 'test…' : ms ? `${ms.med} ms` : v ? 'OK' : 'bloqué';
        li.className = v === null ? 'wait' : ms ? (ms.med < 120 ? 'ok' : ms.med < 200 ? 'wait' : 'ko') : v ? 'ok' : 'ko';
        li.innerHTML = `<i></i><span></span><b>${txt}</b>`;
        li.querySelector('span').textContent = label;
        if (ms) { const sm = document.createElement('small'); sm.style.cssText = 'display:block;opacity:.7;font-size:12px'; sm.textContent = `de ${ms.min} à ${ms.max} ms · variation ${ms.jit} ms`; li.querySelector('span').appendChild(sm); }
        if (v !== null) lines.push(`${label} : ${ms ? `${ms.med} ms (de ${ms.min} à ${ms.max}, variation ${ms.jit})` : v ? 'OK' : 'bloqué'}`);
      });
      const vd = DDNetTest.verdict(R), box = ov.querySelector('.ntverdict');
      box.hidden = false; box.className = 'ntverdict ' + (vd.ok ? 'ok' : 'ko'); box.textContent = vd.text;
      lines.push('', vd.text, '', navigator.userAgent);
      ov.querySelector('#ntCopy').hidden = false; ov.querySelector('#ntAgain').hidden = false;
    };
    ov.querySelector('#ntAgain').onclick = go;
    ov.querySelector('#ntCopy').onclick = () => {
      const txt = 'Test de connexion Game Hub\n' + lines.join('\n');
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Résultat copié'), () => toast('Copie impossible : fais une capture d\'écran'));
    };
    go();
  }
  $('#btnNetTest').onclick = openNetTest;

  /* ------------------------------------------------------------ nouveautés (journal des versions) */
  // Le journal est lu dans CHANGELOG.md : une seule source, toujours à jour.
  function mdInline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  }
  function parseChangelog(md) {
    const out = []; let cur = null, item = null;
    for (const line of md.split('\n')) {
      const h = /^## (.+)$/.exec(line);
      if (h) { cur = { title: h[1], items: [] }; out.push(cur); item = null; continue; }
      if (!cur) continue;
      const li = /^(\s*)- (.+)$/.exec(line);
      if (li) { item = { text: li[2], sub: li[1].length >= 2 }; cur.items.push(item); continue; }
      if (item && /^\s+\S/.test(line)) item.text += ' ' + line.trim();
    }
    return out;
  }
  async function openNews() {
    const ov = document.createElement('div'); ov.className = 'ntov';
    ov.innerHTML = '<div class="nt card news" role="dialog" aria-label="Nouveautés"><button class="ntx" aria-label="Fermer">×</button><h2>✨ Nouveautés</h2><div class="newsbody"><p class="nthint">Chargement…</p></div>'
      + '<div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="newsOk">Compris !</button></div></div>';
    document.body.appendChild(ov);
    const close = () => { ov.remove(); DDProfile.set('hub_seen_ver', VERSION); };
    ov.querySelector('.ntx').onclick = close; ov.querySelector('#newsOk').onclick = close;
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    let vers = [];
    try { vers = parseChangelog(await (await fetch('CHANGELOG.md', { cache: 'no-cache' })).text()); } catch (e) {}
    const body = ov.querySelector('.newsbody');
    if (!vers.length) { body.innerHTML = '<p class="nthint">Journal indisponible pour le moment.</p>'; return; }
    const block = (v, open) => `<details class="ver" ${open ? 'open' : ''}><summary>${mdInline(v.title)}${v.title.startsWith(VERSION + ' ') ? ' <span class="pill">actuelle</span>' : ''}</summary>
      <ul>${v.items.map((it) => `<li class="${it.sub ? 'sub' : ''}">${mdInline(it.text)}</li>`).join('')}</ul></details>`;
    body.innerHTML = vers.map((v, k) => block(v, k < 2)).join('');
  }
  $('#btnNews').onclick = openNews;
  $('#ver').onclick = openNews;
  // à la première visite après une mise à jour (pas pour un tout nouveau joueur)
  {
    const seen = DDProfile.get('hub_seen_ver', null), veteran = seen || DDProfile.get('dd_seen_ver', null) || DDProfile.get('dd_name', null);
    if (!seen && !veteran) DDProfile.set('hub_seen_ver', VERSION);
    else if (seen !== VERSION && !new URLSearchParams(location.search).has('join')) setTimeout(openNews, 600);
  }

  /* ------------------------------------------------------------ classement entre potes */
  // Le jeu de l'hôte (ou du joueur solo) signale la fin d'une partie ; on relie ses joueurs aux identifiants du salon.
  function recordResult(game, r) {
    if (!room || !r || !Array.isArray(r.players) || !(room.isHost || room.mode === 'solo')) return;
    const byId = new Map(room.players.map((p) => [p.id, p])), byName = new Map(room.players.map((p) => [p.name, p]));
    const players = r.players.map((p) => {
      const hp = p.bot ? null : (Number.isInteger(p.id) && byId.get(p.id)) || byName.get(p.name);
      return { key: p.bot ? 'bot:' + p.name : hp && hp.uid ? hp.uid : 'nom:' + p.name, name: hp ? hp.name : p.name, color: p.color || (hp && hp.color), bot: !!p.bot, rank: p.rank, score: p.score };
    });
    room.addResult({ id: String(r.id || game + '-' + Date.now()), game, mode: r.mode || '', at: Date.now(), players });
  }
  let lbOpen = false, lbGame = 'all', lbOnly = false, lbBots = true;
  const GNAME = { all: 'Tous les jeux', ...Object.fromEntries(GAMES.map((g) => [g.id, g.title])) };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); };
  function renderBoard() {
    const ov = document.querySelector('.lbov'); if (!ov) return;
    const inRoom = room && room.mode !== 'solo' && room.players.length > 1;
    const only = lbOnly && inRoom ? room.players.map((p) => p.uid) : null;
    const rows = DDResults.table({ game: lbGame, only, bots: lbBots });
    const myUid = me.uid;
    const recent = DDResults.recent(40).filter((r) => lbGame === 'all' || r.game === lbGame).slice(0, 8);
    const lbDef = gameDef(lbGame), scoreLabel = (lbDef && lbDef.score) || '', scoreUnit = (lbDef && lbDef.scoreUnit) || '';
    ov.querySelector('.lbbody').innerHTML = `
      <div class="lbfilters"><div class="seg">${Object.entries(GNAME).map(([k, l]) => `<button data-g="${k}" class="${lbGame === k ? 'sel' : ''}">${l}</button>`).join('')}</div>
        ${inRoom ? `<label class="ck"><input type="checkbox" id="lbOnly" ${lbOnly ? 'checked' : ''}> Joueurs du salon</label>` : ''}
        <label class="ck"><input type="checkbox" id="lbBots" ${lbBots ? 'checked' : ''}> Bots</label></div>
      ${rows.length ? `<table class="lbt"><thead><tr><th>#</th><th>Joueur</th><th>Victoires</th><th>Parties</th><th>% victoires</th><th>Podiums</th>${scoreLabel ? `<th>${scoreLabel}</th>` : ''}</tr></thead><tbody>
        ${rows.map((x, k) => `<tr class="${x.key === myUid ? 'me' : ''}"><td>${k < 3 ? ['🥇', '🥈', '🥉'][k] : k + 1}</td><td><i class="dot" style="background:${esc(x.color)}"></i>${esc(x.name)}${x.bot ? ' <small>🤖</small>' : ''}${x.key === myUid ? ' <small>(toi)</small>' : ''}</td>
          <td><b>${x.wins}</b></td><td>${x.games}</td><td>${Math.round((x.wins / x.games) * 100)} %</td><td>${x.podiums}</td>${scoreLabel ? `<td>${x.best.toLocaleString('fr-FR') + esc(scoreUnit)}</td>` : ''}</tr>`).join('')}</tbody></table>`
      : '<p class="lbempty">Pas encore de partie terminée. Le classement se remplit tout seul à la fin de chaque partie.</p>'}
      ${recent.length ? `<h3>Dernières parties</h3><ul class="lbrecent">${recent.map((r) => { const w = r.players.find((p) => p.rank === 1);
        return `<li><span class="g">${(gameDef(r.game) || {}).icon || '🎮'}</span><span>${esc(GNAME[r.game] || r.game)}${r.mode ? ' · ' + esc(r.mode) : ''}</span><b>${w ? '🏆 ' + esc(w.name) : ''}</b><small>${r.players.length} joueurs · ${ago(r.at)}</small></li>`; }).join('')}</ul>` : ''}
      <p class="nthint">Historique partagé : quand vous vous retrouvez dans un salon, les parties de chacun sont mises en commun.</p>`;
    for (const b of ov.querySelectorAll('[data-g]')) b.onclick = () => { lbGame = b.dataset.g; renderBoard(); };
    const o = ov.querySelector('#lbOnly'); if (o) o.onchange = () => { lbOnly = o.checked; renderBoard(); };
    ov.querySelector('#lbBots').onchange = (e) => { lbBots = e.target.checked; renderBoard(); };
  }
  function openBoard() {
    const ov = document.createElement('div'); ov.className = 'ntov lbov';
    ov.innerHTML = '<div class="nt card lb" role="dialog" aria-label="Classement"><button class="ntx" aria-label="Fermer">×</button><h2>🏆 Classement entre potes</h2><div class="lbbody"></div></div>';
    document.body.appendChild(ov); lbOpen = true;
    const close = () => { ov.remove(); lbOpen = false; };
    ov.querySelector('.ntx').onclick = close;
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
    renderBoard();
  }
  for (const id of ['#btnBoard', '#btnBoardRoom']) { const b = $(id); if (b) b.onclick = openBoard; }
  if (new URLSearchParams(location.search).has('nettest')) setTimeout(openNetTest, 300);
  // page des logs : outil de développement, visible seulement avec ?debug
  if (QS.has('debug')) for (const id of ['#btnLogs', '#btnLogsRoom']) $(id).hidden = false;
  const busy = (b) => { for (const id of ['#btnHost', '#btnJoin', '#btnSolo']) $(id).disabled = b; };
  const profile = () => ({ name: DDRoom.cleanName(me.name), color: me.color, lvl: me.lvl, uid: me.uid, fid: me.fid || undefined, ver: VERSION });

  $('#btnHost').onclick = () => { homeErr(''); busy(true); $('#btnHost').textContent = 'Création…'; newRoom(); room.host(profile()); };
  $('#btnJoin').onclick = () => {
    const code = $('#joinCode').value.trim().toUpperCase();
    if (code.length !== 4) { homeErr('Le code fait 4 caractères.'); return; }
    homeErr(''); busy(true); $('#btnJoin').textContent = 'Connexion…'; newRoom(); room.join(code, profile());
  };
  $('#btnSolo').onclick = () => { homeErr(''); newRoom(); room.solo(profile()); };

  function goHome(msg) {
    if (room) room.leave();
    room = null; closeFrame(false); leftGame = null;
    busy(false); $('#btnHost').textContent = 'Créer un salon'; $('#btnJoin').textContent = 'Rejoindre';
    showScreen('home'); homeErr(msg || '');
    const keep = new URLSearchParams(); for (const k of ['local', 'ws', 'as', 'debug', 'mute']) if (QS.has(k)) keep.set(k, QS.get(k));
    history.replaceState(null, '', location.pathname + (keep.toString() ? '?' + keep.toString().replace(/=(&|$)/g, '$1') : ''));
    renderNet(); pubState(); renderFriends();
  }
  // Rejoindre un salon par son code, depuis la liste d'amis ou une invitation
// Pour l'accueil (hub/home.js) : lancer un jeu en un clic, depuis la vitrine ou une carte
  window.HubUI = {
    gameCard,
    isRegistered: () => registered,
    play(id, solo) {
      if (!registered) { $('#name').focus(); $('#name').scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Crée d\'abord ton compte : un pseudo, une couleur et un mot de passe.'); return; }
      if (gameDef(id)) pick.game = id;
      (solo ? $('#btnSolo') : $('#btnHost')).click();
    },
  };
    function joinCode(code) {
    if (room && room.code === code) { showScreen(frame ? 'play' : 'room'); return; }
    goHome();
    $('#joinCode').value = code;
    $('#btnJoin').click();
  }

  /* ------------------------------------------------------------ salon */
  function newRoom() {
    if (room) room.leave();
    $('#chatLog').innerHTML = '';
    room = DDRoom.create({
      joined() { busy(false); $('#btnHost').textContent = 'Créer un salon'; $('#btnJoin').textContent = 'Rejoindre'; showScreen(frame ? 'play' : 'room'); renderRoom(); },
      update() { renderRoom(); syncFrame(); postRoster(); checkPeers(); if (window.HubInGame) window.HubInGame.refresh(); },
      chat(c) { appendChat(c); },
      game(from, m) { if (frame && frame.loaded) frame.el.contentWindow.postMessage({ dd: 'hub', k: 'msg', from, m }, ORIGIN); },
      error(msg) { if ($('#home').classList.contains('on')) goHome(msg); else toast(msg, 4000); },
      closed(msg) { goHome(msg); },
      results() { if (lbOpen) renderBoard(); },
      migrating(info) { toast(info.me ? "L'hôte est parti : tu deviens l'hôte…" : `L'hôte est parti : ${info.name} reprend le salon…`, 5000); },
      migrated() { toast('Salon rétabli, la partie continue', 3000); renderRoom(); syncFrame(); postRoster(); },
      net(st) { renderNet(); if (st === 'up') toast('Connexion rétablie', 2200); },
    });
    if (new URLSearchParams(location.search).has('debug')) window.__room = room; // tests
  }
  setInterval(() => { if (room) { room.tick(performance.now()); renderPings(); } }, 2000);

  // Bandeau de connexion : notre réseau coupé, ou l'hôte en reconnexion (le serveur garde les places quelques secondes)
  function renderNet() {
    let b = $('#netbar');
    const txt = !room || room.mode === 'solo' ? '' : !room.netUp ? 'Connexion perdue · reconnexion…' : room.mode === 'guest' && room.hostAway ? "Coupure chez l'hôte · on l'attend…" : '';
    if (!txt) { if (b) b.hidden = true; return; }
    if (!b) { b = document.createElement('div'); b.id = 'netbar'; b.className = 'netbar'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
    b.innerHTML = '<i></i>' + esc(txt); b.hidden = false;
  }

  function appendChat(c) {
    const p = document.createElement('p');
    if (c.sys) { p.className = 'sys'; p.textContent = c.txt; }
    else p.innerHTML = `<b style="color:${esc(c.color || '#16181d')}">${esc(c.name)}</b> ${esc(c.txt)}`;
    const log = $('#chatLog'); log.appendChild(p); log.scrollTop = log.scrollHeight;
  }
  $('#chatForm').onsubmit = (e) => { e.preventDefault(); const v = $('#chatIn').value; if (v.trim() && room) room.sendChat(v); $('#chatIn').value = ''; };
  $('#btnLeave').onclick = () => goHome();
  $('#btnCopy').onclick = () => {
    const url = location.origin + location.pathname + '?join=' + room.code + (DDNet.LOCAL_TEST ? '&local' : '');
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
      () => toast('Lien copié : envoie-le à tes potes'), () => toast('Code du salon : ' + room.code));
  };
  $('#btnRejoin').onclick = () => { leftGame = null; syncFrame(); };

  // Pourquoi un joueur a un gros ping : son ordinateur rame, son onglet est en arrière-plan, ou sa connexion
  function pingCause(v, d) {
    if (v == null || v < 250 || !d) return null;
    if (d.hid) return { short: 'onglet caché', long: "Le jeu n'est pas au premier plan chez ce joueur : le navigateur le ralentit volontairement." };
    if (d.lag > 60) return { short: 'PC saturé', long: `L'ordinateur de ce joueur n'arrive pas à suivre (${d.lag} ms de retard à chaque image) : fermer d'autres onglets ou applications, brancher le portable sur secteur, ou passer en plateau classique quand le jeu le propose.` };
    return { short: 'réseau', long: `La connexion de ce joueur au serveur est lente (${d.net || '?'} ms aller-retour) : wifi chargé ou éloigné, partage de connexion…` };
  }
  function renderPings() {
    if (!room) return;
    for (const el of document.querySelectorAll('[data-ping]')) {
      const id = el.dataset.ping, v = room.pings[id], c = pingCause(v, room.diag[id]);
      el.textContent = v != null ? Math.round(v) + ' ms' + (c ? ' · ' + c.short : '') : '';
      el.title = c ? c.long : '';
      el.classList.toggle('slow', !!c);
    }
    if (frame && frame.loaded) {
      frame.el.contentWindow.postMessage({ dd: 'hub', k: 'pings', pings: room.pings, diag: room.diag }, ORIGIN);
    }
  }

  function renderRoom() {
    if (!room) return;
    const solo = room.mode === 'solo';
    $('#codeBox').hidden = solo; $('#chatBox').hidden = solo;
    $('#code').textContent = room.code || '----';
    const host = room.isHost;
renderPlayers(); renderNet(); pubState(); renderFriends(); renderPings();
    // partie en cours que l'on a quittée
    const running = room.game && !frame;
    $('#runBanner').hidden = !running;
    if (running) $('#runText').textContent = 'Partie de ' + gameDef(room.game.id).title + ' en cours';
    // jeux
    const n = room.players.length;
    setHTML($('#games'), GAMES.map((g) => {
      const tooMany = n > g.maxPlayers;
      const sel = (room.game ? room.game.id : pick.game) === g.id && (host || room.game);
      return gameCard(g, { el: 'button', cls: (sel ? ' sel' : '') + (tooMany ? ' off' : ''),
        attrs: `data-game="${g.id}" ${host && !tooMany ? '' : 'tabindex="-1"'} aria-pressed="${sel}"`,
        extra: tooMany ? `<span class="why">${g.maxPlayers} joueurs maximum</span>` : '' });
    }).join(''));
    renderLaunch();
  }

  $('#games').addEventListener('click', (e) => {
    const b = e.target.closest('.game');
    if (!b || !room || !room.isHost || room.game) return;
    const g = gameDef(b.dataset.game); if (room.players.length > g.maxPlayers) return;
    pick.game = g.id; renderRoom();
  });
  $('#players').addEventListener('click', (e) => {
    const b = e.target.closest('[data-addf]');
    if (b && FR.request(b.dataset.addf) === 'ok') renderPlayers();
  });
  function renderPlayers() {
    if (!room) return;
    const rows = room.players.map((p) => {
      const tags = [];
      if (p.id === room.hostId) tags.push('<span class="pill">Hôte</span>');
      if (p.away) tags.push('<span class="pill away" title="Sa connexion a sauté : le serveur lui garde sa place">reconnexion…</span>');
      else if (room.ready[p.id]) tags.push('<span class="pill in">En jeu</span>');
      const other = p.id !== room.myId;
      if (otherVersion(p)) tags.push(`<span class="pill away" title="Il doit recharger la page (Ctrl+Maj+R) : sinon vos parties ne seront pas les mêmes">${p.ver ? 'v' + esc(p.ver) : 'ancienne version'}</span>`);
      if (other && p.fid && FR.isFriend(p.fid)) tags.push('<span class="pill fr" title="Ton ami">Ami</span>');
      else if (other && p.fid && FR.status === 'on' && p.fid !== FR.fid) tags.push(FR.sent.has(p.fid)
        ? '<span class="addf" aria-disabled="true">Demandé</span>'
        : `<button class="addf" data-addf="${esc(p.fid)}" title="Envoyer une demande d'ami à ${esc(p.name)}">＋ Ami</button>`);
      return `<div class="pl"><span class="dot" style="background:${esc(p.color)}"></span><span class="nm">${esc(p.name)}${p.id === room.myId ? ' <small>(toi)</small>' : ''}</span>${tags.join('')}${other ? `<small data-ping="${p.id}"></small>` : ''}</div>`;
    });
    if (room.mode !== 'solo') for (let k = room.players.length; k < DDRoom.MAX_PLAYERS; k++) rows.push('<div class="pl empty">Place libre</div>');
    setHTML($('#players'), rows.join(''));
    renderPings();
  }

  /* ------------------------------------------------------------ amis */
  me.fid = FR.fid;
  // ce que voient nos amis : sur l'accueil, en solo, ou dans un salon qu'ils peuvent rejoindre
  function pubState() {
    if (!room || !room.mode) { FR.setState({ w: 'menu' }); return; }
    if (room.mode === 'solo') { FR.setState({ w: 'solo', game: frame ? frame.game : undefined }); return; }
    const g = room.game && gameDef(room.game.id);
    FR.setState({ w: 'room', code: room.code || undefined, game: g ? g.id : room.isHost ? pick.game : undefined, n: room.players.length,
      max: g ? Math.min(DDRoom.MAX_PLAYERS, g.maxPlayers) : DDRoom.MAX_PLAYERS, play: !!room.game });
  }
  function friendWhere(st) {
    if (!st) return 'Hors ligne';
    const g = st.game && gameDef(st.game);
    if (st.w === 'solo') return 'Joue seul' + (g ? ' · ' + g.title : '');
    if (st.w === 'room') return (st.play ? 'En partie' : 'Dans un salon') + (g ? ' · ' + g.title : '') + ` · ${st.n}/${st.max}`;
    return "Sur l'accueil";
  }
  const joinable = (st) => !!(st && st.w === 'room' && st.code && st.n < st.max && !(room && room.code === st.code));
  function friendList() {
    const rank = (x) => (!x.l ? 3 : joinable(x.l.st) ? 0 : x.l.st && x.l.st.w === 'room' ? 1 : 2);
    return FR.friends.map((f) => ({ f, l: FR.live.get(f.fid) })).sort((a, b) => rank(a) - rank(b) || a.f.name.localeCompare(b.f.name));
  }
  const fdot = (f, l) => `<span class="dot${l ? ' on' : ''}" style="background:${esc(f.color || '#c9c0ad')}"></span>`;
  const invitedAt = new Map();
  function buildFriendsHome() {
    $('#friendsHome').innerHTML = `<div class="fhead"><h2>Amis</h2><span class="fon" id="fOn"></span></div>
      <div class="fcode" id="fCode"></div><div id="fReqs"></div><ul class="flist" id="fList"></ul>
      <form class="fadd" id="fAdd"><input type="text" id="fAddIn" maxlength="9" placeholder="Code ami d'un pote" autocomplete="off" spellcheck="false" aria-label="Code ami d'un pote"><button class="btn small">Ajouter</button></form>`;
    $('#fAddIn').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''); });
    $('#fAdd').onsubmit = (e) => {
      e.preventDefault();
      const r = FR.request($('#fAddIn').value);
      if (r === 'ok') { $('#fAddIn').value = ''; return; }
      toast({ invalid: 'Un code ami fait 8 caractères, par exemple K7QM-2XPA.', self: "C'est ton propre code ami.", already: 'Vous êtes déjà amis.', offline: 'Connexion aux amis en cours, réessaie dans un instant.' }[r], 3500);
    };
    $('#friendsHome').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'fCopy') {
        const txt = FR.format(FR.fid);
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Code ami copié : envoie-le à tes potes'), () => toast('Ton code ami : ' + txt));
      } else if (b.dataset.join) joinCode(b.dataset.join);
      else if (b.dataset.acc) FR.accept(b.dataset.acc);
      else if (b.dataset.dec) FR.decline(b.dataset.dec);
      else if (b.dataset.rm) { const f = FR.friends.find((x) => x.fid === b.dataset.rm); if (f && confirm(`Retirer ${f.name} de tes amis ?`)) FR.remove(f.fid); }
    });
  }
  function renderFriends() {
    const list = friendList(), on = list.filter((x) => x.l).length;
    $('#fOn').textContent = list.length ? `${on} en ligne` : '';
    $('#fAdd').hidden = $('#fList').hidden = $('#fReqs').hidden = !registered;
    setHTML($('#fCode'), !registered ? '<span>Crée ton compte pour ajouter tes potes en ami.</span>' : FR.status === 'on' ? `<span>Ton code ami</span><b>${esc(FR.format(FR.fid))}</b><button class="btn small ghost" id="fCopy" type="button">Copier</button>`
      : FR.status === 'local' ? '<span>Amis indisponibles en mode test entre onglets.</span>'
      : FR.status === 'unsupported' ? '<span>Les amis seront disponibles après la mise à jour du serveur.</span>'
      : '<span class="wait"><i></i>Connexion aux amis…</span>');
    setHTML($('#fReqs'), FR.requests.map((r) => `<div class="freq"><span class="nm"><b style="color:${esc(r.color)}">${esc(r.name)}</b> veut être ton ami</span>
      <button class="btn small yellow" data-acc="${esc(r.fid)}">Accepter</button><button class="linkbtn" data-dec="${esc(r.fid)}">Refuser</button></div>`).join(''));
    setHTML($('#fList'), list.length ? list.map(({ f, l }) => `<li class="${l ? '' : 'off'}">${fdot(f, l)}<span class="fn">${esc(f.name)}<small>${esc(friendWhere(l && l.st))}</small></span>
      ${l && joinable(l.st) ? `<button class="btn small yellow" data-join="${esc(l.st.code)}">Rejoindre</button>` : ''}
      <button class="fx" data-rm="${esc(f.fid)}" aria-label="Retirer ${esc(f.name)} de tes amis" title="Retirer de tes amis">×</button></li>`).join('')
      : `<li class="fempty">Pas encore d'amis. Donne ton code ami à tes potes, ou ajoute-les d'un clic sur <b>＋ Ami</b> à côté de leur nom dans un salon.</li>`);
    // salon : inviter les amis en ligne qui n'y sont pas
    const box = $('#friendsRoom');
    if (!room || room.mode === 'solo' || !room.code || FR.status !== 'on') { setHTML(box, ''); return; }
    const here = new Set(room.players.map((p) => p.fid).filter(Boolean));
    const cands = list.filter((x) => x.l && !here.has(x.f.fid));
    const now = Date.now();
    setHTML(box, `<div class="lbl">Inviter des amis</div>` + (cands.length
      ? `<ul class="flist">${cands.map(({ f, l }) => { const sent = now - (invitedAt.get(f.fid) || 0) < 20000;
        return `<li>${fdot(f, l)}<span class="fn">${esc(f.name)}<small>${esc(friendWhere(l.st))}</small></span><button class="btn small ${sent ? 'ghost' : 'yellow'}" data-inv="${esc(f.fid)}" ${sent ? 'disabled' : ''}>${sent ? 'Invité ✓' : 'Inviter'}</button></li>`; }).join('')}</ul>`
      : `<p class="sethint">${FR.friends.length ? 'Aucun autre ami en ligne pour le moment.' : 'Ajoute tes potes en ami (＋ Ami à côté de leur nom) : la prochaine fois, tu les inviteras d\'un clic.'}</p>`));
  }
  $('#friendsRoom').addEventListener('click', (e) => {
    const b = e.target.closest('[data-inv]');
    if (!b || b.disabled || !room || !room.code) return;
    FR.invite(b.dataset.inv, room.code, room.game ? room.game.id : pick.game);
    invitedAt.set(b.dataset.inv, Date.now()); renderFriends(); setTimeout(renderFriends, 20500);
  });
  // Petites cartes en haut à droite : demandes d'ami et invitations
  function notify(html, actions, ttl, id) {
    let box = $('#notifs');
    if (!box) { box = document.createElement('div'); box.id = 'notifs'; box.className = 'notifs'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    if (id) for (const o of box.querySelectorAll('.notif')) if (o.dataset.id === id) o.remove();
    const n = document.createElement('div'); n.className = 'notif'; if (id) n.dataset.id = id;
    n.innerHTML = `<div>${html}</div><div class="row">${actions.map(([l, c], k) => `<button class="btn small ${c}" data-k="${k}">${esc(l)}</button>`).join('')}</div>`;
    const t = setTimeout(() => n.remove(), ttl);
    for (const b of n.querySelectorAll('button')) b.onclick = () => { clearTimeout(t); n.remove(); const fn = actions[b.dataset.k][2]; if (fn) fn(); };
    box.appendChild(n);
  }
  buildFriendsHome();
  FR.on('change', () => { renderFriends(); if (room && $('#room').classList.contains('on')) renderPlayers(); });
  FR.on('me', (fid) => { me.fid = fid; if (room && room.mode !== 'solo') room.updateMe(me); });
  FR.on('request', (r) => notify(`<b style="color:${esc(r.color)}">${esc(r.name)}</b> veut t'ajouter en ami.`,
    [['Accepter', 'yellow', () => { FR.accept(r.fid); toast(`${r.name} est maintenant ton ami`); }], ['Refuser', 'ghost', () => FR.decline(r.fid)]], 60000, 'req' + r.fid));
  FR.on('added', (f) => toast(`${f.name} a accepté : vous êtes amis !`, 3000));
  FR.on('sent', () => toast("Demande d'ami envoyée"));
  FR.on('err', (e) => toast(e.reason === 'self' ? "C'est ton propre code ami." : "Ce joueur n'est pas en ligne : il doit être connecté pour accepter ta demande.", 4000));
  FR.on('invite', (m) => {
    if (room && room.code === m.code) return;
    const g = m.game && gameDef(m.game);
    notify(`<b style="color:${esc(m.color)}">${esc(m.name)}</b> t'invite dans son salon${g ? ` pour jouer à <b>${esc(g.title)}</b>` : ''}.`,
      [['Rejoindre', 'yellow', () => joinCode(m.code)], ['Plus tard', 'ghost', null]], 45000, 'inv' + m.from);
  });
  if (registered) FR.start(profile());
  renderFriends();

  function renderLaunch() {
    const box = $('#launchBox'), host = room.isHost;
    if (room.game) {
      box.innerHTML = host
        ? `<div class="row" style="align-items:center;justify-content:space-between"><span class="wait"><i></i>Partie de ${esc(gameDef(room.game.id).title)} en cours</span><button class="btn small ghost" id="btnStop">Arrêter pour tout le monde</button></div>`
        : `<span class="wait"><i></i>Partie de ${esc(gameDef(room.game.id).title)} en cours</span>`;
      const st = $('#btnStop'); if (st) st.onclick = () => room.setGame(null);
      return;
    }
    if (!host) { box.innerHTML = '<span class="wait"><i></i>L\'hôte choisit le jeu…</span>'; return; }
    const g = gameDef(pick.game), set = pick.settings[g.id], n = room.players.length;
    const segs = (g.settings || []).map((s) => {
      if (g.id === 'calcul' && set.mode === 'chartier' && s.key === 'theme') return '';
      // réglages propres à un mode (ou masqués dans un mode)
      if ((s.onlyMode && set.mode !== s.onlyMode) || (s.notMode && set.mode === s.notMode)) return '';
      if (g.id === 'david' && set.teams === '2v2' && s.key === 'bots') return `<div class="setitem"><div class="lbl">Bots</div><div class="sethint">${n < 4 ? `${4 - n} bot${4 - n > 1 ? 's' : ''} complète${4 - n > 1 ? 'nt' : ''} les équipes` : 'Équipes complètes'}</div></div>`;
      const opts = s.options.filter(([v]) => s.key !== 'bots' || n + Number(v) <= (g.maxWithBots || g.maxPlayers));
      return `${s.group ? `<div class="setgroup">${esc(s.group)}</div>` : ''}<div class="setitem"><div class="lbl">${esc(s.label)}</div><div class="seg" role="group" aria-label="${esc(s.label)}">${opts.map(([v, l]) =>
        `<button data-k="${s.key}" data-v="${v}" class="${String(set[s.key]) === String(v) ? 'sel' : ''}">${esc(l)}</button>`).join('')}</div></div>`;
    }).join('');
    const max = g.id === 'david' && set.teams === '2v2' ? 4 : g.maxPlayers;
    const ok = n <= max;
    box.innerHTML = `<h2>${esc(g.title)}</h2>${segs ? `<div class="setrow">${segs}</div>` : ''}
      ${ok ? '' : `<p class="sethint">Ce mode se joue à ${max} au plus.</p>`}
      <button class="btn big block ${g.id === 'david' ? 'blue' : ''}" id="btnLaunch" ${ok ? '' : 'disabled'}>Lancer ${esc(g.title)}</button>`;
    for (const b of box.querySelectorAll('.seg button')) b.onclick = () => {
      const v = isNaN(Number(b.dataset.v)) ? b.dataset.v : Number(b.dataset.v);
      set[b.dataset.k] = v; DDProfile.set('hub_set_' + g.id + '_' + b.dataset.k, v); renderLaunch();
    };
    $('#btnLaunch').onclick = () => {
      // quelqu'un n'a pas la même version : ses fichiers de jeu diffèrent (une autre carte) ; on prévient d'abord
      const off = room.players.filter(otherVersion);
      if (off.length && !(launchAnyway > performance.now())) {
        launchAnyway = performance.now() + 8000;
        toast(`${off.map((p) => p.name).join(', ')} n'${off.length > 1 ? 'ont' : 'a'} pas la même version que toi : il faut recharger la page (Ctrl+Maj+R). Clique encore pour lancer quand même.`, 7000);
        return;
      }
      leftGame = null; room.setGame(g.id, { ...set });
    };
  }

  /* ------------------------------------------------------------ jeu dans l'iframe */
  function syncFrame() {
    if (!room) return;
    const g = room.game;
    if (!g) { if (frame) closeFrame(true); leftGame = null; return; }
    if (frame && (frame.n !== g.n || (frame.role === 'host' && !room.isHost))) closeFrame(false);
    if (!frame && leftGame !== g.n) openFrame(g);
  }

  function openFrame(g) {
    const def = gameDef(g.id);
    DDProfile.save(me);
    const role = room.mode === 'solo' ? 'solo' : room.isHost ? 'host' : 'guest';
    const q = new URLSearchParams({ hub: '1', role, game: g.id });
    if (room.code) q.set('code', room.code);
    q.set('v', VERSION); // les fichiers du jeu sont chargés à cette version : tout le salon a les mêmes
    const pass = new URLSearchParams(location.search);
    for (const k of ['debug', 'ws', 'mute']) if (pass.has(k)) q.set(k, pass.get(k));
    let src = def.url + '?' + q.toString() + (DDNet.LOCAL_TEST ? '&local' : '');
    const el = document.createElement('iframe');
    el.title = def.title; el.src = src; el.allow = 'autoplay; fullscreen; gamepad; microphone'; // micro : la voix de proximité des Backrooms
    $('#play').innerHTML = ''; $('#play').appendChild(el);
const watchdog = setTimeout(() => {
      if (frame && frame.el === el && !frame.loaded && window.DDLogger) {
        window.DDLogger.logCrash('CRASH_IFRAME_LOAD_FAIL', `Le jeu "${def.title}" (${g.id}) n'a pas envoyé le signal d'initialisation "hello" après 15 s.`, {
          game: g.id, roomCode: room && room.code, file: src,
        });
      }
    }, 15000);
    frame = { game: g.id, n: g.n, el, loaded: false, role, watchdog };
    // écran de chargement commun (avec « Démarrer ») et menu Arcadia à droite : plein écran, son, quitter
    // « C'est parti ! » seulement quand tous les joueurs du salon ont chargé le jeu (pas de départ désynchronisé)
    const loading = () => { if (!room || !frame) return null; const ps = room.players; const ok = ps.filter((p) => room.ready[p.id] === frame.game);
      return { done: ok.length, total: ps.length, waiting: ps.filter((p) => room.ready[p.id] !== frame.game).map((p) => DDRoom.cleanName(p.name)) }; };
    if (window.HubInGame) window.HubInGame.open(def, { players: room.players.length, loading, exit: leaveGame, vol: () => el.contentWindow.DDVolume, focus: () => { try { el.contentWindow.focus(); } catch (e) {} } });
    el.addEventListener('load', () => { try { el.contentWindow.focus(); } catch (e) {} });
    showScreen('play');
    renderRoom(); pubState();
  }

  function closeFrame(toRoom) {
    if (!frame) return;
    clearTimeout(frame.watchdog);
    frame.el.remove(); frame = null; $('#play').innerHTML = '';
    if (window.HubInGame) window.HubInGame.close();
    if (room) room.setReady(null);
    if (toRoom && room) { showScreen('room'); renderRoom(); }
    setTimeout(() => { checkPeers(); checkOnline(); }, 800); // une mise à jour attendait la fin de la partie
  }

  function postRoster() {
    if (!frame || !frame.loaded || !room) return;
    frame.el.contentWindow.postMessage({ dd: 'hub', k: 'roster', players: room.players.map(({ cid, ...p }) => p), ready: room.ready, pings: room.pings, hostId: room.hostId,
      role: room.mode === 'solo' ? 'solo' : room.isHost ? 'host' : 'guest', code: room.code }, ORIGIN);
  }

  window.addEventListener('message', (e) => {
    if (!frame || e.source !== frame.el.contentWindow) return;
    const d = e.data; if (!d || d.dd !== 'hub' || !room) return;
    switch (d.k) {
      case 'hello':
        frame.loaded = true;
        clearTimeout(frame.watchdog);
        frame.el.contentWindow.postMessage({ dd: 'hub', k: 'init', info: {
          role: room.mode === 'solo' ? 'solo' : room.isHost ? 'host' : 'guest',
          myId: room.myId, hostId: room.hostId, code: room.code, game: frame.game,
          settings: room.game ? room.game.settings : {}, vip: !!(window.HubVIP && window.HubVIP.is()),
          players: room.players.map(({ cid, ...p }) => p), ready: room.ready, pings: room.pings,
        } }, ORIGIN);
        break;
      case 'ready': room.setReady(frame.game); break;
      case 'send': room.sendGame(d.to, d.m, !!d.v); break;
      case 'result': recordResult(frame.game, d.r); break;
      case 'log': if (window.DDLogger && d.entry) window.DDLogger.receiveFromChild(d.entry); break;
      case 'shown': if (window.HubInGame) window.HubInGame.shown(); break;
      case 'exit': leaveGame(); break;
      case 'outdated': {
        // en pleine partie, le jeu a vu que sa carte n'est pas celle de l'hôte (une autre version, ou des fichiers
        // abîmés dans le cache) : la partie est injouable ainsi. On reprend tout à la version la plus récente des deux
        // et on revient dans le salon, puis dans la partie
        const v = verNum(d.v) > verNum(VERSION) ? String(d.v) : VERSION;
        const files = (Array.isArray(d.files) ? d.files : []).filter((u) => typeof u === 'string').slice(0, 100);
        updateTo(v, files);
        break;
      }
    }
  });
  // Quitter le jeu : l'hôte ferme la partie pour tout le salon, un invité revient seul au salon
  function leaveGame() {
    if (!frame || !room) return;
    if (room.isHost) {
      if (window.DDLogger && room.players.length > 1) {
        window.DDLogger.logExpulsion('EXP_HOST_STOPPED_GAME', `L'hôte a quitté "${frame.game}" : fermeture de la partie pour les ${room.players.length} joueurs du salon.`, {
          game: frame.game, roomCode: room.code,
        });
      }
      room.setGame(null);
    } else { leftGame = frame.n; closeFrame(true); }
  }

  addEventListener('pagehide', () => { try { if (room) room.leave(); } catch (e) {} });
  if (joinParam) $('#name').focus();
  // juste après une mise à jour automatique : on revient tout seul dans le salon qu'on a quitté pour elle. Si on était
  // l'hôte, le salon est repris sous un nouveau code par un autre joueur, qui met un instant à le rouvrir : on réessaie
  // pendant 25 s
  try {
    const upd = JSON.parse(sessionStorage.getItem('hub_update') || 'null');
    if (joinParam && upd && Date.now() - upd.t < 60000 && !upd.back) {
      upd.back = true;
      sessionStorage.setItem('hub_update', JSON.stringify(upd));
      const code = joinParam.toUpperCase().slice(0, 4);
      const t0 = Date.now();
      let lastTry = 0;
      const tryJoin = () => {
        if (room && room.mode && room.myId >= 0) return; // de retour dans le salon
        if (Date.now() - t0 > 25000 || code.length !== 4) return;
        // pas encore de salon, refusé (pas encore rouvert), ou sans réponse depuis 5 s : on retente
        if (!room || !room.mode || Date.now() - lastTry > 5000) {
          lastTry = Date.now();
          if (room) goHome();
          $('#joinCode').value = code;
          $('#btnJoin').click();
        }
        setTimeout(tryJoin, 1000);
      };
      setTimeout(tryJoin, 300);
    }
  } catch (e) {}
})();
