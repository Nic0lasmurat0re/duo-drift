/* Salon commun du Hub, construit sur DDNet. L'hôte fait autorité sur la liste des joueurs,
   le jeu choisi et l'état « prêt » de chaque joueur dans ce jeu ; il relaie les messages des jeux.

   Protocole (champ t) :
     invité → hôte : hello {name,color,lvl,uid,fid,sid,prevId,ver} · me {name,lvl,fid} · chat {txt} · ready {game} · g {to,m} · ping · bye
     hôte → invité : welcome {id} · lobby {players,game,ready,code,host} · chat {...} · g {from,m} · pong · full · bye
   `g` transporte les messages d'un jeu ; le Hub ne les lit pas. `to` vaut un id de joueur, 'host' ou 'all'.
   `v` (volatil) : instantané d'état continu ; sauté si la connexion sature, et à l'arrivée seul le plus récent
   de chaque expéditeur est transmis au jeu (un ordinateur lent ne prend pas de retard en rattrapant une file).

   Coupures : DDNet reprend d'abord la place sur le serveur sans que rien ne se voie ; le joueur coupé est marqué
   `away` le temps de revenir. Si la place est perdue, l'invité renvoie hello avec son numéro (prevId) et l'identifiant
   de sa page (sid) : l'hôte lui rend sa place, sans doublon, même si l'ancienne connexion n'a pas encore été fermée. */
(function () {
  // relances après une coupure ou une migration : les minuteries de DDNet, pas bridées quand l'onglet est caché
  const { setTimeout } = window.DDNet.timers || window;
  const MAX_PLAYERS = 6;
  const PREFIX = 'ddhub-v1-';
  const PALETTE = ['#ff4b2b', '#2b8cff', '#ffc531', '#2fbf71', '#b45cff', '#ff5fa2', '#1fc7c1', '#ff8a1f'];
  const clean = (s, n) => String(s || '').replace(/[<>&"]/g, '').trim().slice(0, n);
  const cleanVer = (v) => (/^\d{1,3}\.\d{1,4}$/.test(String(v || '')) ? String(v) : '');
  const cleanName = (s) => clean(s, 12) || 'Joueur';
  const cleanUid = (s) => (/^[a-z0-9]{6,16}$/.test(String(s)) ? String(s) : null);
  const cleanFid = (s) => (/^[A-Z2-9]{8}$/.test(String(s)) ? String(s) : undefined); // code ami (hub/friends.js)
  const SID = Math.random().toString(36).slice(2, 12); // identifiant de cette page : retrouver sa place après une coupure
  const LOST_MS = 20000; // joueur coupé sans partie en cours : retiré du salon après ce délai
  const RES = () => window.DDResults;

  // Charge de l'ordinateur : retard moyen de la boucle d'événements (un PC qui rame répond tard à tout, ping compris)
  let loopLag = 0;
  (function () { let last = performance.now(); setInterval(() => { const now = performance.now(); loopLag = loopLag * 0.75 + Math.max(0, now - last - 250) * 0.25; last = now; }, 250); })();
  const myDiag = (net) => ({ lag: Math.round(loopLag), net: net.rtt || 0, hid: document.hidden ? 1 : 0 });

  function createRoom(handlers) {
    const net = DDNet.create({ prefix: PREFIX, maxPeers: MAX_PLAYERS - 1 });
    const R = {
      mode: null,               // 'host' | 'guest' | 'solo'
      code: null, myId: 0, hostId: 0,
      players: [],              // [{ id, name, color, lvl, cid? }]
      game: null,               // { id, settings } ou null
      ready: {},                // { playerId: gameId }
      chat: [],
      pings: {}, lastRecv: 0, lastRecvC: {},
      diag: {},                 // { playerId: { lag, net, hid } } : d'où vient un gros ping (ordinateur, onglet caché, réseau)
      hostAway: false,          // invité : l'hôte a une coupure, le serveur garde sa place
      netUp: true,              // notre propre connexion au serveur
      get isHost() { return this.mode === 'host' || this.mode === 'solo'; },
      get me() { return this.players.find((p) => p.id === this.myId); },
    };
    const emit = (k, ...a) => { if (handlers[k]) handlers[k](...a); };
    const sids = {}, lostAt = {}; // hôte : page de chaque joueur, et depuis quand il est coupé (privé, pas diffusé)
    const pub = () => ({ players: R.players.map(({ cid, ...p }) => p), game: R.game, ready: R.ready, code: R.code, host: R.hostId });
    const changed = () => { if (R.mode === 'host') net.bcast({ t: 'lobby', ...pub() }); emit('update', R); };
    const pushChat = (c) => { R.chat.push(c); R.chat = R.chat.slice(-40); emit('chat', c); };
    const sys = (txt) => { const c = { id: -1, txt, sys: true }; pushChat(c); if (R.mode === 'host') net.bcast({ t: 'chat', ...c }); };

    // Messages volatils reçus : on ne garde que le dernier de chaque expéditeur et de chaque sorte, transmis au jeu
    // au prochain tour de boucle ; un message normal fait d'abord passer ceux en attente (l'ordre est respecté).
    // (« prochain tour » par un MessageChannel : un setTimeout(…, 0) attend jusqu'à une seconde, voire une minute,
    // quand l'onglet de l'hôte est caché, et les commandes des invités arrivaient en retard dans le jeu)
    const pendingVol = new Map(); let volT = 0;
    const flushVol = () => { volT = 0; const list = [...pendingVol.values()]; pendingVol.clear(); for (const [f, x] of list) emit('game', f, x); };
    function gameIn(from, m, v) {
      if (v && m && typeof m === 'object') {
        pendingVol.set(from + ':' + m.t, [from, m]);
        if (!volT) { volT = 1; soon(flushVol); }
        return;
      }
      if (pendingVol.size) flushVol();
      emit('game', from, m);
    }

    function deliverGame(from, to, m, v) {
      // côté hôte : un message de jeu venant de `from` (id) vers `to`
      v = v ? 1 : undefined;
      if (to === 'host' || Number(to) === Number(R.myId)) { gameIn(from, m, v); return; }
      if (to === 'all') {
        gameIn(from, m, v);
        // un seul envoi pour tout le salon (le relais le distribue), sans renvoyer à l'expéditeur
        const src = R.players.find((q) => Number(q.id) === Number(from));
        net.bcast({ t: 'g', from, m, v }, src && src.cid ? src.cid : undefined, v);
        return;
      }
      const p = R.players.find((q) => Number(q.id) === Number(to));
      if (p && p.cid) net.to(p.cid, { t: 'g', from, m, v }, v);
    }

    /* ---------- hôte ---------- */
    function onHostMsg(cid, m) {
      if (!m || typeof m !== 'object') return;
      R.lastRecvC[cid] = performance.now();
      let p = R.players.find((q) => q.cid === cid);
      if (!p && Number.isInteger(m.fromId) && m.fromId !== R.hostId) {
        const byId = R.players.find((q) => q.id === m.fromId);
        if (byId) { byId.cid = cid; p = byId; }
      }
      switch (m.t) {
        case 'hello': {
          const uid = cleanUid(m.uid), sid = typeof m.sid === 'string' ? m.sid.slice(0, 16) : null;
          // même page (reconnexion, même si l'ancienne connexion traîne encore), sinon même joueur dont la place est libre
          const existing = p || (sid && R.players.find((q) => q.id !== R.hostId && sids[q.id] === sid))
            || (uid && R.players.find((q) => q.uid === uid && q.id !== R.hostId && !q.cid))
            || (Number.isInteger(m.prevId) && m.prevId > 0 && R.players.find((q) => q.id === m.prevId && !q.cid));
          if (existing) {
            existing.cid = cid; delete existing.away; delete lostAt[existing.id];
            if (sid) sids[existing.id] = sid;
            existing.name = cleanName(m.name);
            if (cleanFid(m.fid)) existing.fid = cleanFid(m.fid);
            if (cleanVer(m.ver)) existing.ver = cleanVer(m.ver);
            if (m.ready) R.ready[existing.id] = m.ready;
            net.to(cid, { t: 'welcome', id: existing.id, chat: R.chat.slice(-20) });
            changed();
            return;
          }
          if (R.players.length >= MAX_PLAYERS) {
            if (window.DDLogger) {
              window.DDLogger.logExpulsion('EXP_ROOM_FULL', `Joueur "${cleanName(m.name)}" refusé : salon ${R.code} complet (${MAX_PLAYERS}/${MAX_PLAYERS}).`, {
                game: R.game ? R.game.id : 'hub', roomCode: R.code, targetPlayer: cleanName(m.name),
              });
            }
            net.to(cid, { t: 'full' }); net.drop(cid); return;
          }
          const used = new Set(R.players.map((q) => q.id)); let id = 0; while (used.has(id)) id++;
          // après une migration d'hôte, chacun garde son numéro (le jeu en cours en dépend)
          const prev = Number.isInteger(m.prevId) ? m.prevId : -1;
          if (prev >= 0 && !used.has(prev)) id = prev;
          const usedC = new Set(R.players.map((q) => q.color));
          const color = PALETTE.includes(m.color) && !usedC.has(m.color) ? m.color : PALETTE.find((c) => !usedC.has(c));
          const np = { id, cid, name: cleanName(m.name), color, lvl: Math.max(1, Math.min(99, m.lvl | 0)), uid: uid || 'g' + Math.random().toString(36).slice(2, 10) };
          if (cleanFid(m.fid)) np.fid = cleanFid(m.fid);
          if (cleanVer(m.ver)) np.ver = cleanVer(m.ver); // la version de son Hub : le salon voit qui est en retard
          if (sid) sids[id] = sid;
          R.players.push(np);
          if (m.ready) R.ready[id] = m.ready;
          net.to(cid, { t: 'welcome', id, chat: R.chat.slice(-20) });
          sys(np.name + (prev >= 0 ? ' est reconnecté' : ' a rejoint le salon')); changed();
          break;
        }
        case 'me': if (p) { p.name = cleanName(m.name); p.lvl = Math.max(1, Math.min(99, m.lvl | 0)); if (cleanFid(m.fid)) p.fid = cleanFid(m.fid); changed(); } break;
        case 'res': if (p && Array.isArray(m.list) && RES()) { const added = RES().merge(m.list.slice(0, 150)); if (added) { net.bcast({ t: 'res', list: RES().all().slice(0, 150) }); emit('results'); } } break;
        case 'chat': if (p) { const txt = clean(m.txt, 140); if (txt) { const c = { id: p.id, name: p.name, color: p.color, txt }; pushChat(c); net.bcast({ t: 'chat', ...c }); } } break;
        case 'ready': if (p) { if (m.game) R.ready[p.id] = m.game; else delete R.ready[p.id]; changed(); } break;
        case 'g': if (p) deliverGame(p.id, m.to, m.m, m.v); break;
        case 'ping':
          if (p && Number.isFinite(m.myPing)) R.pings[p.id] = Math.round(m.myPing);
          if (p && m.d && typeof m.d === 'object') R.diag[p.id] = { lag: m.d.lag | 0, net: m.d.net | 0, hid: m.d.hid ? 1 : 0 };
          if (net.rtt) R.pings[R.hostId] = net.rtt;
          R.diag[R.hostId] = myDiag(net);
          net.to(cid, { t: 'pong', ts: m.ts, pings: R.pings, diag: R.diag });
          break;
        case 'pong':
          if (p) R.pings[p.id] = Math.max(1, Math.round(performance.now() - m.ts));
          if (net.rtt) R.pings[R.hostId] = net.rtt;
          break;
        case 'bye': net._drop(cid); break;
      }
    }
    function onHostLeave(cid) {
      const i = R.players.findIndex((q) => q.cid === cid); delete R.lastRecvC[cid];
      if (i < 0) return;
      const p = R.players[i];
      const ping = R.pings[p.id], diag = R.diag[p.id];
      if (window.DDLogger) {
        const d = window.DDLogger.diagnoseDisconnect(ping, diag, !!R.game);
        window.DDLogger.logExpulsion(d.code, `${p.name} déconnecté ${R.game ? `en pleine partie (${R.game.id})` : 'du salon'} — ${d.detail}`, {
          game: R.game ? R.game.id : 'hub',
          roomCode: R.code,
          targetPlayer: p.name,
          diagnostics: { ping: ping || null, diag: diag || null, inGame: !!R.game, cid },
        });
      }
      // Si une partie est en cours, on conserve le joueur dans R.players (cid = null) pour qu'il puisse se reconnecter sans perdre ses troupes !
      if (R.game) {
        const q = R.players[i]; q.cid = null; q.away = true; lostAt[q.id] = Date.now();
        changed();
        return;
      }
removePlayer(R.players[i]);
    }
    function removePlayer(p) {
      const i = R.players.indexOf(p); if (i < 0) return;
      R.players.splice(i, 1); delete R.ready[p.id]; delete R.pings[p.id]; delete sids[p.id]; delete lostAt[p.id];
      sys(p.name + ' a quitté le salon'); emit('left', p); changed();
    }
    // Coupure d'un invité : le serveur garde sa place, les autres le voient « en reconnexion »
    function onHostAway(cid, away) {
      const p = R.players.find((q) => q.cid === cid); if (!p) return;
      if (away) p.away = true; else delete p.away;
      changed();
    }
    // Notre place d'hôte a été perdue puis rouverte sous le même code : chacun revient avec son numéro
    function onHostReset() {
      const now = Date.now(); R.lastRecvC = {};
      for (const q of R.players) if (q.id !== R.myId) { q.cid = null; q.away = true; lostAt[q.id] = now; }
      changed();
    }
    // Notre place d'hôte a expiré (coupure trop longue) : les autres ont déjà migré vers un nouvel hôte, on les y rejoint
    function onHostLost(reason) {
      const others = R.players.filter((q) => q.id !== R.myId).map((q) => q.id).sort((a, b) => a - b);
      if (reason !== 'expired' || !others.length) return false;
      // Si une partie est en cours, ne pas abandonner le rôle d'hôte immédiatement sur un hoquet réseau
      if (R.game && R.isHost && (!R.lostHostAt || Date.now() - R.lostHostAt < 20000)) {
        if (!R.lostHostAt) R.lostHostAt = Date.now();
        return false;
      }
      R.lostHostAt = 0;
      const succ = others[0], succName = (R.players.find((q) => q.id === succ) || {}).name || '?';
      const me = R.me || { name: 'Joueur', color: PALETTE[0], lvl: 1 };
      migrating = true;
      emit('migrating', { to: succ, name: succName, me: false });
      const code2 = deriveCode(R.code, succ);
      setTimeout(() => { net.close(); R.hostId = succ; rejoin(code2, me, Date.now() + 30000); }, 0);
      return true;
    }
    const netStatus = (st) => { R.netUp = st === 'up'; emit('net', st); };
    const hostCallbacks = (ready, error) => ({
      ready, error, join(cid) { R.lastRecvC[cid] = performance.now(); },
      msg: onHostMsg, leave: onHostLeave, away: onHostAway, reset: onHostReset, lost: onHostLost, status: netStatus,
    });
    const hello = (me, extra) => net.toHost({ t: 'hello', name: me.name, color: me.color, lvl: me.lvl, uid: me.uid, fid: me.fid, ver: me.ver, sid: SID,
      prevId: R.myId >= 0 ? R.myId : undefined, ready: myReady || undefined, ...extra });

    /* ---------- invité ---------- */
    function onGuestMsg(m) {
      if (!m || typeof m !== 'object') return;
      R.lastRecv = performance.now();
      switch (m.t) {
        case 'welcome': R.myId = m.id | 0; R.chat = Array.isArray(m.chat) ? m.chat : []; emit('joined', R);
          if (RES()) net.toHost({ t: 'res', list: RES().all().slice(0, 150) });
          break;
        case 'res': if (Array.isArray(m.list) && RES() && RES().merge(m.list.slice(0, 150))) emit('results'); break;
        case 'lobby': {
          const before = R.players;
          const beforeGame = R.game;
          R.players = Array.isArray(m.players) ? m.players : []; R.game = m.game || null; R.ready = m.ready || {}; R.hostId = m.host | 0;
          if (m.pings) Object.assign(R.pings, m.pings);
          if (beforeGame && !R.game && !R.isHost && window.DDLogger) {
            window.DDLogger.logExpulsion('EXP_HOST_STOPPED_GAME', `Partie de "${beforeGame.id}" arrêtée par l'hôte (retour de tous les joueurs au salon).`, {
              game: beforeGame.id, roomCode: R.code,
            });
          }
          for (const q of before) if (!R.players.some((x) => x.id === q.id)) emit('left', q);
          emit('update', R); break;
        }
        case 'chat': pushChat(m); break;
        case 'g': gameIn(m.from, m.m, m.v); break;
        case 'ping':
          if (m.pings) Object.assign(R.pings, m.pings);
          if (m.diag) Object.assign(R.diag, m.diag);
          net.toHost({ t: 'pong', ts: m.ts, fromId: R.myId });
          break;
        case 'pong':
          if (m.pings) Object.assign(R.pings, m.pings);
          if (m.diag) Object.assign(R.diag, m.diag);
          R.pings[R.myId] = Math.max(1, Math.round(performance.now() - m.ts));
          break;
        case 'kicked': {
          const reasonTxt = m.reason || 'Expulsé par l\'hôte du salon';
          const byTxt = m.by || 'l\'hôte';
          if (window.DDLogger) {
            window.DDLogger.logExpulsion('EXP_HOST_KICK', `Expulsé du salon ${R.code || ''} par ${byTxt} : ${reasonTxt}`, {
              game: R.game ? R.game.id : 'hub', roomCode: R.code, by: byTxt,
            });
          }
          migrating = true; net.close(); R.mode = null;
          emit('closed', `Tu as été expulsé de la partie par ${byTxt} (${reasonTxt}).`);
          break;
        }
        case 'full':
          if (window.DDLogger) window.DDLogger.logExpulsion('EXP_ROOM_FULL', `Accès refusé au salon ${R.code || ''} : complet (6 joueurs max).`, { roomCode: R.code });
          emit('error', 'Le salon est complet (6 joueurs max).');
          break;
        case 'bye': migrate("L'hôte a quitté le salon."); break;
      }
    }

    /* ---------- migration d'hôte ----------
       Si l'hôte disparaît, le joueur restant au plus petit numéro devient hôte, sous un nouveau code
       que tout le monde peut calculer ; les autres s'y reconnectent en gardant leur numéro. */
    let myReady = null, migrating = false;
    const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    function deriveCode(code, id) {
      let h = 2166136261;
      for (const ch of String(code) + ':' + id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
      let out = ''; for (let k = 0; k < 4; k++) { out += CODE_ALPHA[h % CODE_ALPHA.length]; h = Math.floor(h / CODE_ALPHA.length) + 7919 * (k + 1); }
      return out;
    }
    function migrate(reason) {
      if (R.mode !== 'guest' || migrating) return;
      const oldHost = R.hostId;
      const cands = R.players.filter((p) => p.id !== oldHost).map((p) => p.id).sort((a, b) => a - b);
      if (window.DDLogger) {
        window.DDLogger.logExpulsion('EXP_HOST_MIGRATION_RESET', `Départ de l'hôte (#${oldHost}) dans le salon ${R.code || ''} : ${reason}`, {
          game: R.game ? R.game.id : 'hub', roomCode: R.code,
        });
      }
      if (!cands.length || R.myId < 0) { emit('closed', reason); return; }
      migrating = true;
      const succ = cands[0], succName = (R.players.find((p) => p.id === succ) || {}).name || '?';
      const code2 = deriveCode(R.code, succ);
      const me = R.me || { name: 'Joueur', color: PALETTE[0], lvl: 1 };
      emit('migrating', { to: succ, name: succName, me: succ === R.myId });
      net.close();
      setTimeout(() => {
        if (succ === R.myId) becomeHost(code2, me);
        else rejoin(code2, me, Date.now() + 20000);
      }, 400);
    }
    function becomeHost(code, me) {
      R.mode = 'host'; R.hostId = R.myId; R.lastRecvC = {}; R.pings = {}; R.hostAway = false; // l'hôte, c'est nous désormais
      for (const k in sids) delete sids[k];
      for (const k in lostAt) delete lostAt[k];
      R.players = [{ id: R.myId, name: cleanName(me.name), color: me.color, lvl: me.lvl | 0 || 1, uid: me.uid, fid: cleanFid(me.fid), ver: cleanVer(me.ver) || undefined }];
      R.ready = myReady ? { [R.myId]: myReady } : {};
      let tries = 0;
      const go = () => net.host(hostCallbacks(
        (c) => { migrating = false; R.code = c; sys('Tu es maintenant l\'hôte du salon.'); emit('migrated', R); changed(); },
        (msg) => { if (R.code === code && !migrating) emit('closed', msg); else if (++tries < 6) setTimeout(go, 1500); else { migrating = false; emit('closed', msg); } },
      ), code);
      go();
    }
    function rejoin(code, me, deadline) {
      R.mode = 'guest'; R.code = code; R.hostAway = false;
      net.join(code, {
        open() { migrating = false; R.lastRecv = performance.now(); hello(me); },
        msg: (m) => { onGuestMsg(m); if (m && m.t === 'welcome') emit('migrated', R); },
        close() { if (R.mode === 'guest') migrate("Connexion perdue avec l'hôte."); },
        hostAway(a) { R.hostAway = a; emit('update', R); },
        status: netStatus,
        error(msg) {
          if (Date.now() < deadline) { R.mode = 'guest'; setTimeout(() => rejoin(code, me, deadline), 1500); }
          else { migrating = false; R.mode = null; emit('closed', 'Impossible de joindre le nouvel hôte.'); }
        },
      }, 4000);
    }

    /* ---------- API ---------- */
    Object.assign(R, {
      host(me) {
        R.mode = 'host'; R.myId = 0; R.hostId = 0; R.hostAway = false; R.players = [{ id: 0, name: cleanName(me.name), color: me.color, lvl: me.lvl | 0 || 1, uid: me.uid, fid: cleanFid(me.fid), ver: cleanVer(me.ver) || undefined }];
        R.chat = []; R.ready = {}; R.game = null; R.code = null;
        net.host(hostCallbacks(
          (code) => { R.code = code; emit('joined', R); changed(); },
          // une fois le salon ouvert, une erreur réseau le ferme (serveur injoignable trop longtemps)
          (msg) => { if (R.code) emit('closed', msg); else emit('error', msg); },
        ));
      },
      join(code, me) {
        R.mode = 'guest'; R.players = []; R.chat = []; R.myId = -1; R.code = code; R.hostAway = false;
        net.join(code, {
open() { R.lastRecv = performance.now(); R.hostAway = false; hello(me); },
          msg: onGuestMsg,
          close() { if (R.mode === 'guest') migrate("Connexion perdue avec l'hôte."); },
          error(msg) { R.mode = null; emit('error', msg); },
          hostAway(a) { R.hostAway = a; emit('update', R); },
          status: netStatus,
        });
      },
      solo(me) {
        R.mode = 'solo'; R.myId = 0; R.hostId = 0; R.code = null; R.chat = []; R.ready = {}; R.game = null;
        R.players = [{ id: 0, name: cleanName(me.name), color: me.color, lvl: me.lvl | 0 || 1, uid: me.uid, fid: cleanFid(me.fid), ver: cleanVer(me.ver) || undefined }];
        setTimeout(() => { emit('joined', R); emit('update', R); }, 0);
      },
      // le code que le salon aura quand je le quitte : le mien si je suis invité ; si je suis l'hôte, celui sous lequel
      // le joueur au plus petit numéro le reprendra (migration) ; null si je suis seul (le salon disparaît avec moi)
      successorCode() {
        if (!R.code || R.mode === 'solo') return null;
        if (!R.isHost) return R.code;
        const ids = R.players.filter((p) => p.id !== R.myId).map((p) => p.id).sort((a, b) => a - b);
        return ids.length ? deriveCode(R.code, ids[0]) : null;
      },
      leave() { migrating = false; myReady = null; net.close(); R.mode = null; R.players = []; R.game = null; R.ready = {}; R.code = null; },
      updateMe(me) {
        if (R.isHost) { const p = R.me; if (p) { p.name = cleanName(me.name); p.lvl = me.lvl | 0 || 1; if (cleanFid(me.fid)) p.fid = me.fid; changed(); } }
        else if (R.mode === 'guest') net.toHost({ t: 'me', name: me.name, lvl: me.lvl, fid: me.fid });
      },
      sendChat(txt) {
        txt = clean(txt, 140); if (!txt) return;
        if (R.isHost) { const p = R.me; const c = { id: p.id, name: p.name, color: p.color, txt }; pushChat(c); if (R.mode === 'host') net.bcast({ t: 'chat', ...c }); }
        else net.toHost({ t: 'chat', txt });
      },
      // L'hôte choisit le jeu (ou null pour revenir au salon). Tous les Hub suivent.
      setGame(id, settings) {
        if (!R.isHost) return;
        R.game = id ? { id, settings: settings || {}, n: Date.now() } : null;
        if (!id) R.ready = {};
        changed();
      },
      // Le jeu de ce joueur est prêt (ou fermé si game = null).
      setReady(game) {
        myReady = game || null;
        if (R.isHost) { if (game) R.ready[R.myId] = game; else delete R.ready[R.myId]; changed(); }
        else net.toHost({ t: 'ready', game });
      },
      // Résultat d'une partie (envoyé par le jeu de l'hôte) : enregistré et partagé avec tout le salon
      addResult(rec) {
        if (!RES() || !RES().merge([rec])) return;
        if (R.mode === 'host') net.bcast({ t: 'res', list: [rec] });
        else if (R.mode === 'guest') net.toHost({ t: 'res', list: [rec] });
        emit('results');
      },
      sendGame(to, m, vol) {
        if (R.isHost) deliverGame(R.myId, to, m, vol);
        else net.toHost({ t: 'g', fromId: R.myId, to, m, v: vol ? 1 : undefined }, vol);
      },
      netStats() { return { ...net.stats, buffered: net.buffered, proto: net.proto }; },
      kick(id, reason) {
        if (R.mode !== 'host' || id === R.myId) return false;
        const i = R.players.findIndex((q) => q.id === id);
        if (i < 0) return false;
        const p = R.players[i];
        const reasonTxt = clean(reason || 'Expulsé par l\'hôte du salon', 100);
        const hostName = (R.me && R.me.name) || 'Hôte';
        if (window.DDLogger) {
          window.DDLogger.logExpulsion('EXP_HOST_KICK', `Joueur "${p.name}" (#${p.id}) expulsé par ${hostName} — Raison : ${reasonTxt}`, {
            game: R.game ? R.game.id : 'hub',
            roomCode: R.code,
            targetPlayer: p.name,
            by: hostName,
            diagnostics: { ping: R.pings[p.id] || null, diag: R.diag[p.id] || null, inGame: !!R.game },
          });
        }
        if (p.cid) {
          try { net.to(p.cid, { t: 'kicked', by: hostName, reason: reasonTxt }); } catch (e) {}
          net.drop(p.cid);
          delete R.lastRecvC[p.cid];
        }
        R.players.splice(i, 1);
        delete R.ready[p.id];
        delete R.pings[p.id];
        delete R.diag[p.id];
        sys(`${p.name} a été expulsé du salon (${reasonTxt})`);
        emit('left', p);
        changed();
        return true;
      },
      // à appeler régulièrement : pings temps réel sans déconnecter les joueurs en arrière-plan
      tick(now) {
        if (R.mode === 'host') {
          // joueurs coupés qui ne sont pas revenus, alors qu'aucune partie ne les attend
          if (!R.game) for (const q of [...R.players]) if (!q.cid && q.id !== R.myId && lostAt[q.id] && Date.now() - lostAt[q.id] > LOST_MS) removePlayer(q);
          if (net.rtt) R.pings[R.hostId] = net.rtt;
          R.diag[R.hostId] = myDiag(net);
          net.bcast({ t: 'ping', ts: now, pings: R.pings, diag: R.diag });
        } else if (R.mode === 'guest' && net.hostLink) {
          R.diag[R.myId] = myDiag(net);
          net.toHost({ t: 'ping', ts: now, fromId: R.myId, myPing: R.pings[R.myId], d: R.diag[R.myId] });
        }
      },
    });
    return R;
  }

  // Au prochain tour de boucle, sans subir le bridage des minuteries d'un onglet caché
  function soon(fn) {
    if (typeof MessageChannel !== 'function') { setTimeout(fn, 0); return; }
    if (!soon.ch) { soon.q = []; soon.ch = new MessageChannel(); soon.ch.port1.onmessage = () => { const f = soon.q.shift(); if (f) f(); }; }
    soon.q.push(fn); soon.ch.port2.postMessage(0);
  }

  window.DDRoom = { create: createRoom, MAX_PLAYERS, PALETTE, cleanName };
})();
