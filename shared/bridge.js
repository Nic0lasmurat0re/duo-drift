/* Pont entre un jeu (dans une iframe) et le Hub qui détient le salon et la connexion.
   Le jeu reste jouable seul : HubBridge.embedded vaut false quand la page n'est pas ouverte par le Hub.

   API :
     HubBridge.embedded                 lancé depuis le Hub ?
     HubBridge.info                     { role: 'host'|'guest'|'solo', myId, hostId, code, game, settings }
     HubBridge.players / readyMap       joueurs du salon / { id: jeu prêt }
     HubBridge.on('init'|'roster'|'msg', fn)
     HubBridge.signalReady()            ce jeu écoute : les autres peuvent lui parler
     HubBridge.send(to, m, opts)        to = id de joueur, 'host' ou 'all' ; opts.volatile : instantané d'état continu
                                        (sauté si la connexion sature, seul le plus récent est livré)
     HubBridge.exit()                   retour au salon
     HubBridge.outdated(v, files)       ce jeu n'a pas la même carte que l'hôte : le Hub reprend ses fichiers (et ceux
                                        du jeu, files) à la version v ou à la sienne, recharge et revient dans le salon
     HubBridge.patchNet(Net)            remplace un objet Net façon Duo Drift par le canal du Hub */
(function () {
  // navigation des menus à la manette (même dossier que ce fichier)
  try {
    const me = document.currentScript && document.currentScript.src;
    if (me && !window.ArcadiaPad) { const sc = document.createElement('script'); sc.src = me.replace(/bridge\.js(\?.*)?$/, 'padnav.js$1'); sc.async = true; (document.head || document.documentElement).appendChild(sc);
      const sp = document.createElement('script'); sp.src = me.replace(/bridge\.js(\?.*)?$/, 'padplay.js$1'); sp.async = true; (document.head || document.documentElement).appendChild(sp); }
  } catch (e) {}
  const qs = new URLSearchParams(location.search);
  const embedded = qs.get('hub') === '1' && window.parent !== window;
  const target = location.origin === 'null' ? '*' : location.origin;
  const H = {
    embedded,
    info: { role: qs.get('role') || 'solo', code: qs.get('code') || null, game: qs.get('game') || null, myId: 0, hostId: 0, settings: {} },
    players: [], readyMap: {}, pings: {}, initDone: false, handlers: {},
  };
  const emit = (k, ...a) => (H.handlers[k] || []).forEach((f) => {
    try { f(...a); } catch (e) {
      console.error(e);
      if (window.DDLogger) window.DDLogger.logCrash('CRASH_JS_ERROR', `Erreur dans HubBridge.on('${k}') : ${e && e.message ? e.message : e}`, { stack: e && e.stack });
    }
  });
  const post = (o) => { if (embedded) parent.postMessage({ dd: 'hub', ...o }, target); };

  /* Onglet en arrière-plan : le navigateur arrête requestAnimationFrame. Or la plupart des jeux font avancer la
     partie dans cette boucle : l'hôte qui change d'onglet ou de fenêtre figeait la partie de tout le salon, et un
     invité caché ne répondait plus. Tant que la page est cachée, les rappels d'animation passent par une minuterie
     de Worker (~30 par seconde, non bridée par le navigateur), puis reviennent à l'affichage normal au retour. */
  if (embedded && typeof Worker !== 'undefined' && window.requestAnimationFrame) (function keepAlive() {
    const nRAF = window.requestAnimationFrame.bind(window), nCAF = window.cancelAnimationFrame.bind(window);
    const pend = new Map(); let seq = 0, worker = null;
    const runQueue = () => {
      const now = performance.now(), list = [...pend.entries()].filter(([, p]) => p.bg);
      for (const [id] of list) pend.delete(id);
      for (const [, p] of list) { try { p.cb(now); } catch (e) { console.error(e); } }
    };
    const startW = () => {
      if (worker) return;
      try {
        const url = URL.createObjectURL(new Blob(['let t=setInterval(()=>postMessage(0),33);onmessage=()=>{clearInterval(t);close()}'], { type: 'text/javascript' }));
        worker = new Worker(url); worker.onmessage = runQueue;
      } catch (e) { worker = null; }
    };
    const stopW = () => { if (worker) { try { worker.postMessage(0); worker.terminate(); } catch (e) {} worker = null; } };
    window.requestAnimationFrame = (cb) => {
      const id = ++seq, p = { cb, bg: false, nid: 0 };
      pend.set(id, p);
      if (document.hidden) { p.bg = true; startW(); }
      else p.nid = nRAF((t) => { if (pend.get(id) === p) { pend.delete(id); cb(t); } });
      return id;
    };
    window.cancelAnimationFrame = (id) => { const p = pend.get(id); if (!p) return; pend.delete(id); if (p.nid) nCAF(p.nid); };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        for (const p of pend.values()) if (!p.bg) { nCAF(p.nid); p.nid = 0; p.bg = true; }
        if (pend.size) startW();
      } else {
        stopW();
        for (const [id, p] of pend) if (p.bg) { p.bg = false; p.nid = nRAF((t) => { if (pend.get(id) === p) { pend.delete(id); p.cb(t); } }); }
      }
    });
    // tant que c'est caché et qu'aucun rappel n'attend, la minuterie peut s'arrêter ; elle repart au prochain rappel
  })();

  // Chargement automatique du capteur de crashs et d'expulsions (shared/logger.js) dans chaque jeu du Hub
  if (!window.DDLogger && typeof document !== 'undefined') {
    try {
      const cur = document.currentScript && document.currentScript.src;
      const src = cur ? cur.replace(/bridge\.js(?:\?.*)?$/, 'logger.js') : '../shared/logger.js';
      const s = document.createElement('script');
      s.src = src;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }

  H.logCrash = (code, msg, extra) => {
    if (window.DDLogger) return window.DDLogger.logCrash(code, msg, extra);
    post({ k: 'log', entry: { id: 'log-' + Date.now(), ts: Date.now(), iso: new Date().toISOString(), code: code || 'CRASH_JS_ERROR', category: 'CRASH', severity: 'critical', message: String(msg), game: H.info.game, roomCode: H.info.code, role: H.info.role, ...extra } });
  };
  H.logExpulsion = (code, msg, extra) => {
    if (window.DDLogger) return window.DDLogger.logExpulsion(code, msg, extra);
    post({ k: 'log', entry: { id: 'log-' + Date.now(), ts: Date.now(), iso: new Date().toISOString(), code: code || 'EXP_PEER_LEFT_MIDGAME', category: 'EXPULSION', severity: 'warn', message: String(msg), game: H.info.game, roomCode: H.info.code, role: H.info.role, ...extra } });
  };

  H.on = (k, fn) => {
    (H.handlers[k] = H.handlers[k] || []).push(fn);
    if (k === 'init' && H.initDone) setTimeout(() => fn(H.info), 0);
  };
  // « shown » : le jeu est vraiment à l'écran (son propre écran de chargement a disparu). Le Hub retire alors
  // l'écran de chargement commun d'Arcadia. Un jeu peut l'annoncer lui-même avec HubBridge.shown() ; sinon on le
  // devine : prêt (signalReady) et plus aucun écran de chargement du jeu visible (#loading, #app.loading, #load).
  let shownSent = false, readyAt = 0;
  H.shown = () => { if (shownSent) return; shownSent = true; post({ k: 'shown' }); };
  const loaderVisible = () => {
    for (const el of document.querySelectorAll('#loading, #app.loading, #load')) {
      if (!el.isConnected || el.classList.contains('hidden')) continue;
      const r = el.getClientRects(); if (!r.length) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
      return true;
    }
    return false;
  };
  function watchShown() {
    let clear = 0;
    const iv = setInterval(() => {
      if (shownSent) return clearInterval(iv);
      if (performance.now() - readyAt > 30000) { clearInterval(iv); H.shown(); return; }
      clear = loaderVisible() ? 0 : clear + 1;
      if (clear >= 3) { clearInterval(iv); requestAnimationFrame(() => requestAnimationFrame(H.shown)); }
    }, 150);
  }
  H.signalReady = () => { post({ k: 'ready' }); if (!readyAt && embedded) { readyAt = performance.now(); watchShown(); } };
  H.send = (to, m, opts) => post(opts && opts.volatile ? { k: 'send', to, m, v: 1 } : { k: 'send', to, m });
  H.exit = () => post({ k: 'exit' });
  H.outdated = (v, files) => post({ k: 'outdated', v: String(v || ''), files: Array.isArray(files) ? files : [] });
  // Fin de partie : le jeu de l'hôte transmet le classement au Hub (historique et classement entre potes)
  H.report = (r) => post({ k: 'result', r });
  H.playerName = (id) => { const p = H.players.find((q) => q.id === id); return p ? p.name : '?'; };

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const d = e.data; if (!d || d.dd !== 'hub') return;
    if (d.k === 'init') {
      Object.assign(H.info, d.info); H.players = d.info.players || []; H.readyMap = d.info.ready || {}; H.pings = d.info.pings || {};
      H.initDone = true; emit('init', H.info); emit('roster', H.players, H.readyMap);
    } else if (d.k === 'roster') {
      H.players = d.players || []; H.readyMap = d.ready || {}; H.info.hostId = d.hostId;
      if (d.pings) Object.assign(H.pings, d.pings);
      if (d.role) H.info.role = d.role;
      if (d.code) H.info.code = d.code;
      emit('roster', H.players, H.readyMap);
    } else if (d.k === 'pings') {
      if (d.pings) Object.assign(H.pings, d.pings);
      emit('pings', H.pings);
    } else if (d.k === 'msg') emit('msg', d.from, d.m);
  });
  if (embedded) { keepAwake(H); post({ k: 'hello' }); }

  // Duo Drift parle à un objet Net (host/join/to/bcast…) : on le branche sur le salon du Hub.
  // Côté hôte, chaque joueur dont le jeu est prêt devient un « lien » 'p<id>'.
  H.patchNet = (Net) => {
    let cb = null, role = null, opened = false, openedHost = null;
    const joined = new Set();
    const isReady = (id) => H.readyMap[id] === H.info.game;
    function sync() {
      if (!cb) return;
      if (role === 'host') {
        const ids = H.players.map((p) => p.id).filter((id) => id !== H.info.myId && isReady(id));
        for (const id of ids) if (!joined.has(id)) { joined.add(id); cb.join('p' + id); }
        for (const id of [...joined]) if (!ids.includes(id)) { joined.delete(id); if (cb.leave) cb.leave('p' + id); }
      } else if (role === 'guest') {
        const hostReady = isReady(H.info.hostId);
        // une course ne survit pas à un changement d'hôte : retour propre au salon
        const hostChanged = opened && openedHost !== H.info.hostId;
        if (hostReady && !opened) { opened = true; openedHost = H.info.hostId; Net.hostLink = { hub: true }; cb.open(); }
        else if ((!hostReady || hostChanged) && opened) {
          opened = false; Net.hostLink = null;
          if (hostChanged) H.logExpulsion('EXP_HOST_MIGRATION_RESET', `Partie interrompue dans ${H.info.game || 'le jeu'} : changement d'hôte (${openedHost} → ${H.info.hostId}).`);
          else H.logExpulsion('EXP_HOST_NOT_READY_DESYNC', `Joueur renvoyé au salon depuis ${H.info.game || 'le jeu'} : l'hôte n'est plus dans la partie (!hostReady).`);
          if (cb.close) cb.close();
        }
      }
    }
    H.on('roster', sync);
    H.on('msg', (from, m) => {
      if (!cb) return;
      if (role === 'host') { if (joined.has(from)) cb.msg('p' + from, m); }
      else if (opened && from === H.info.hostId) cb.msg(m);
    });
    Object.assign(Net, {
      host(c) {
        role = 'host'; cb = c; Net.cb = c; Net.role = 'host';
        H.signalReady();
        H.on('init', () => { c.ready(H.info.code || 'SOLO'); sync(); });
      },
      join(code, c) {
        role = 'guest'; cb = c; Net.cb = c; Net.role = 'guest';
        H.signalReady();
        H.on('init', sync);
      },
      toHost(m, vol) { H.send('host', m, { volatile: !!vol }); },
      to(cid, m, vol) { H.send(Number(String(cid).slice(1)), m, { volatile: !!vol }); },
      bcast(m, except, vol) { for (const id of joined) if ('p' + id !== except) H.send(id, m, { volatile: !!vol }); },
      drop(cid, reason) {
        const id = Number(String(cid).slice(1));
        const pName = H.playerName(id);
        H.logExpulsion('EXP_HOST_KICK', `Joueur ${pName} (#${id}) expulsé de la partie (${reason || 'canal fermé par l\'hôte'}).`, { targetPlayer: pName });
        H.send(id, { t: 'bye', reason });
        Net._drop(cid);
      },
      _drop(cid) { const id = Number(String(cid).slice(1)); if (joined.delete(id) && cb && cb.leave) cb.leave(cid); },
      close() { cb = null; Net.cb = null; Net.hostLink = null; Net.role = null; joined.clear(); opened = false; },
    });
    Net.links = { get size() { return joined.size; } };
    return Net;
  };

  window.HubBridge = H;

  /* Onglet caché : les navigateurs brident les minuteries d'une page cachée (un déclenchement par seconde, puis
     par minute au bout de 5 minutes sous Chrome) et coupent requestAnimationFrame. Chez l'hôte, la partie se figeait
     alors pour tout le monde dès qu'il changeait d'onglet. Dans une partie lancée par le Hub :
     - setTimeout et setInterval passent par un Worker, que les navigateurs ne brident pas ;
     - chez l'hôte d'une partie à plusieurs, requestAnimationFrame est relayé par ce Worker (30 images par seconde)
       tant que l'onglet est caché. Un jeu qui fait déjà tourner sa simulation à part (Duo Drift, Bastion Clash)
       s'en passe avec HubBridge.ownBackgroundLoop = true. window.__forceHidden simule l'onglet caché (tests). */
  function keepAwake(H) {
    let w;
    try {
      const src = 'const t=new Map();onmessage=(e)=>{const[k,id,ms]=e.data;'
        + 'if(k==="c"){clearTimeout(t.get(id));clearInterval(t.get(id));t.delete(id);}'
        + 'else if(k==="t"){t.set(id,setTimeout(()=>{t.delete(id);postMessage(id);},ms));}'
        + 'else{t.set(id,setInterval(()=>postMessage(id),ms));}};';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      w = new Worker(url);
      URL.revokeObjectURL(url);
    } catch (e) { return; } // pas de Worker possible : on garde les minuteries du navigateur
    const nST = window.setTimeout.bind(window), nSI = window.setInterval.bind(window), nCT = window.clearTimeout.bind(window), nCI = window.clearInterval.bind(window);
    const jobs = new Map();
    let seq = 1e7; // loin des numéros du navigateur (minuteries posées avant ce script)
    w.onmessage = (e) => {
      const j = jobs.get(e.data); if (!j) return;
      if (!j.repeat) jobs.delete(e.data);
      try { j.fn(...j.args); } catch (err) { console.error(err); }
    };
    const add = (repeat) => function (fn, ms, ...args) {
      if (typeof fn !== 'function') return (repeat ? nSI : nST)(fn, ms, ...args);
      const id = ++seq;
      jobs.set(id, { fn, args, repeat });
      w.postMessage([repeat ? 'i' : 't', id, Math.max(repeat ? 4 : 0, Number(ms) || 0)]);
      return id;
    };
    const clear = (id) => { if (jobs.has(id)) { jobs.delete(id); w.postMessage(['c', id]); } else { nCT(id); nCI(id); } };
    window.setTimeout = add(false); window.setInterval = add(true);
    window.clearTimeout = clear; window.clearInterval = clear;

    // Images : celles du navigateur quand l'onglet est visible ; chez l'hôte, des images de 33 ms quand il est caché
    const nRAF = window.requestAnimationFrame.bind(window);
    const cbs = new Map();
    let fseq = 0, nativeId = 0, relayId = 0;
    const hidden = () => document.hidden || !!window.__forceHidden;
    const relay = () => hidden() && !H.ownBackgroundLoop && H.info.role === 'host' && H.players.length > 1;
    const run = (t) => { const list = [...cbs.values()]; cbs.clear(); for (const cb of list) { try { cb(t); } catch (err) { console.error(err); } } };
    const arm = () => {
      if (!cbs.size) return;
      if (relay()) { if (!relayId) relayId = window.setTimeout(() => { relayId = 0; run(performance.now()); }, 33); }
      else if (!nativeId) nativeId = nRAF((t) => { nativeId = 0; run(t); });
    };
    window.requestAnimationFrame = (cb) => { const id = ++fseq; cbs.set(id, cb); arm(); return id; };
    window.cancelAnimationFrame = (id) => { cbs.delete(id); };
    document.addEventListener('visibilitychange', arm);
  }
})();
