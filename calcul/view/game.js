// Vue de Tête de Calcul : salle d'avant-partie, pupitre de question, révélation et podium final.
// La vue n'invente rien : elle affiche l'état reçu de l'hôte et envoie la saisie du joueur.
import { CATS, TIER_LABEL, DIFFS, MODULES, chartierTier, fmt } from '../engine/questions.js';
import { staging } from './staging.js';
import { MODES, POWERS, STEAL_MS, FOG_MS, describeAnswer, JOKERS, LIVES, TIER_SHOW_MS, INTER_MS, ANNOUNCE_MS, DUEL_SHOW_MS } from '../engine/rules.js';
import { runMarket, parseQuotes, MM_MAX_SPREAD, MM_LOT } from '../engine/cases.js';
import { buildProgram } from '../engine/code-data.js';
import { runPython, preloadPython } from './py.js';
import { highlightPy, highlightCode } from './pyhl.js';
import { EMOTES, PHRASES, emoteOf } from './emotes.js';
import { figureSvg } from './figure.js';
import { sfx } from './sfx.js';
import { wallStreetMusic } from './music.js';
import { esc, el, prefersReducedMotion } from './util.js';

const DIFF_LABEL = { facile: 'Facile', normal: 'Moyen', expert: 'Difficile' };
const THEME_LABEL = {
  mix: 'Mélangé',
  chartier: 'The Candidate',
  base: 'Les 4 opérations',
  malin: 'Astuces & nombres',
  frac: 'Fractions & décimaux',
  logique: 'Suites & logique',
  vite: 'Vitesse & estimations',
  flash: 'Vrai/faux & comparaisons',
  algebre: 'Équations & devinettes',
  geo: 'Géométrie & mesures',
  compte: 'Compte est bon'
};
const LEVEL_WORDS = { facile: ['facile', 'faciles'], normal: ['moyen', 'moyens'], expert: ['difficile', 'difficiles'] };
const qText = (t) => esc(t).replace(/\^(\d+)/g, '<sup>$1</sup>');
const secs = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' s';
const TAGS = { eclair: '⚡ Le plus rapide', serie: '🔥 Série', peril: '💀 Pénalité', power: '🎁 Pouvoir', trap: '🪤 Piège', cut: '✂️ Coupé', life: '♥ +1 vie', relance: '↻ Relance' };
const hearts = (n, max = LIVES) => `${'♥'.repeat(Math.max(0, n))}<s>${'♥'.repeat(Math.max(0, max - n))}</s>`;
// valeurs des tests (JSON) écrites comme en Python
const pyRepr = (v) => (v === true ? 'True' : v === false ? 'False' : v == null ? 'None' : Array.isArray(v) ? `[${v.map(pyRepr).join(', ')}]` : typeof v === 'string' ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  : typeof v === 'object' ? `{${Object.entries(v).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ')}}` : String(v));
const motion = () => !prefersReducedMotion();

// Les verdicts de Pierre Chartier, selon la réponse et la vitesse
const CHARTIER_QUOTES = {
  fast: [
    "Réflexe de trader. C'est exactement ce que je veux voir.",
    "Tu as répondu avant que je finisse de lire. Continue comme ça.",
    "Rapide et juste. Le desk aime les gens comme toi.",
    "Là, tu viens de gagner ma considération. Pour l'instant.",
    "Exécution parfaite. Pas une milliseconde de perdue.",
  ],
  ok: [
    "Juste. Mais sur un desk, cette hésitation coûte de l'argent.",
    "Correct. Maintenant, fais-le deux fois plus vite.",
    "Bonne réponse. Ne prends pas la confiance, la suite va trier.",
    "C'est validé. Mais je t'ai vu douter.",
    "Exact. Le marché, lui, n'aurait pas attendu.",
  ],
  ko: [
    "Non. Avec une erreur pareille, l'entretien s'arrête là chez nous.",
    "Faux. Tu viens de perdre l'argent du fonds en une seconde.",
    "Non non non. Révise tes bases avant de revenir me voir.",
    "Raté. On ne trade pas au doigt mouillé.",
    "Erreur de débutant. Le prochain candidat attend dans le couloir.",
  ],
  trap: [
    "Tu as foncé tête baissée dans le piège. C'est exactement ce que je teste.",
    "La réponse évidente était la mauvaise. Deux vies, c'est le prix de la naïveté.",
    "Classique. Tout le monde tombe là-dedans, et c'est pour ça que tout le monde ne passe pas.",
  ],
  partial: [
    "Ton code tourne à moitié. En production, à moitié, c'est un incident.",
    "Quelques tests passent. Je garde, mais je veux du propre.",
  ],
  out: [
    "Merci d'être venu. On vous rappellera… ou pas.",
    "C'est terminé pour toi. Tu peux rendre ton badge visiteur à l'accueil.",
  ],
  timeout: [
    "Temps écoulé. Le marché n'attend personne.",
    "Rien ? Le silence, en entretien, c'est éliminatoire.",
    "Trop lent. Quelqu'un d'autre a déjà pris le deal.",
    "Paralysé par la pression ? Mauvais signe pour la suite.",
  ],
  finalOk: ["Quitte ou double, et tu doubles. Respect.", "Sang-froid total sur la finale. Ça, ça ne s'apprend pas."],
  finalKo: ["Tout se jouait là. Et tu as craqué.", "La finale, c'est là qu'on voit les vrais. Pas aujourd'hui."],
};

// Ce que dit Pierre Chartier en ouvrant chaque tour
const TIER_QUOTES = {
  2: [
    "Le premier tour, c'était l'échauffement. Bienvenue au desk.",
    "Ici, une erreur coûte de l'argent. Le vôtre.",
    "Vous avez survécu aux questions faciles. Voyons maintenant qui sait trader.",
  ],
  3: [
    "Le comité vous attend. Il ne laisse rien passer.",
    "Ceux qui sont encore là m'intéressent. Prouvez-le.",
    "Dernière ligne droite. Un seul poste, et je n'ai pas de temps à perdre.",
  ],
};

// Ce que dit Pierre Chartier pendant la question (texte seul, sans rien révéler de la réponse)
const PC_LIVE = {
  start: {
    1: ['Commençons doucement.', 'Une question simple. Ne la ratez pas.', 'Échauffement. Montrez-moi vos réflexes.'],
    2: ['Bienvenue au desk. Ici, on va vite.', 'Je vous écoute.', 'Pas de calculatrice sur un desk.'],
    3: ['Le comité vous regarde.', 'Chaque réponse compte, maintenant.', 'C\'est ici qu\'on sépare les bons des meilleurs.'],
  },
  code: ['Montrez-moi votre code.', 'Deux minutes. Pas une de plus.'], sql: ['La base est à vous.', 'Une requête propre, s\'il vous plaît.'],
  bug: ['Quelqu\'un a cassé ce code. Réparez-le.'], chart: ['Lisez bien le graphique.', 'Tout est sur le schéma.'], read: ['Lisez ce code ligne par ligne.'],
  duel: ['Mort subite. Le premier qui se trompe sort.'], final: ['Quitte ou double. Pas de deuxième chance.'],
  casep: ['Un dossier complet. Prenez des notes.', 'Trois questions, un seul dossier.'], caseNext: ['On continue le dossier.', 'Étape suivante. Gardez vos chiffres en tête.'],
  relance: ['Et si on change un paramètre ?', 'Je relance.', 'Pas si vite. Et si…'], mm: ['Faites-moi un marché. Achat, vente.', 'Je veux un prix. Tout de suite.'],
  half: ['Alors ?', 'Je n\'ai pas toute la journée.', 'Le marché bouge pendant que vous réfléchissez.', 'Hmm…'],
  late: ['Cinq secondes.', 'Il faut trancher.', 'Tic-tac.'],
  fast: ['Déjà ? Voyons ça.', 'Rapide. Espérons que ce soit juste.'], mine: ['Noté.', 'Hmm. Intéressant.', 'Très bien. On verra.'],
};

// Le bandeau de cotations (indices fictifs qui bougent, puis les joueurs cotés comme des actions)
const TICKER_IDX = [['CAC 40', 7984.3], ['S&P 500', 5864.7], ['NASDAQ', 18392.1], ['EUR/USD', 1.0842], ['DAX', 19210.5], ['OR', 2720.5], ['BRENT', 74.2], ['US 10A', 4.22], ['VIX', 16.4]];
// Portrait de Pierre Chartier (ses initiales restent dessous si l'image ne charge pas)
const PC_IMG = 'img/chartier.jpg';
const pcFace = (cls) => `<div class="${cls}" aria-hidden="true"><span>PC</span><img src="${PC_IMG}" alt="" onerror="this.remove()"></div>`;
const symbolOf = (nm) => (String(nm).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z]/g, '').toUpperCase() + 'XXXX').slice(0, 4);

export function mountGame(root, { me, answer, emote, sabotage = () => {}, joker = () => {}, start, exit }) {
  root.className = 'game';
  root.innerHTML = `
    <div class="deco" aria-hidden="true"><span>+</span><span>÷</span><span>×</span><span>−</span><span>√</span><span>%</span><span>π</span><span>=</span></div>
    <header class="topbar">
      <div class="info"><b id="ibrand">Tête de Calcul</b><span id="round"></span></div>
      <div class="ticker" id="ticker" aria-hidden="true"><div class="ticker-track" id="ttrack"></div></div>
      <div class="tools">
        <button class="tool" id="tshow" title="Mise en scène : scène d'ouverture et réactions de Pierre Chartier" hidden>🎬</button>
        <button class="tool" id="tmus" title="Musique de salle de marché" hidden>🎵</button>
        <button class="tool" id="tsnd" title="Bruitages">🔊</button>
        <button class="tool quit" id="tquit">Quitter</button>
      </div>
    </header>
    <aside class="roster" id="roster" aria-label="Joueurs"></aside>
    <main class="stage" id="stage"></main>
    <div class="dock">
      <button class="btn ghost emobtn" id="bEmote" title="Réagir" aria-expanded="false">😀</button>
      <div class="powers" id="powers" aria-label="Tes pouvoirs"></div>
      <div class="emopanel" id="emopanel" hidden>
        <div class="emogrid">${EMOTES.map((e) => `<button data-emo="${e.id}" aria-label="${e.id}">${e.glyph}</button>`).join('')}</div>
        <div class="phrases">${PHRASES.map((p) => `<button data-emo="${p.id}">${esc(p.text)}</button>`).join('')}</div>
      </div>
      <div class="sabpick" id="sabpick" hidden></div>
    </div>
    <div class="toast" id="toast" hidden role="status"></div>
    <div class="curtain" id="curtain" aria-hidden="true">
      <div class="cu-spot"></div>
      <div class="cu-end" id="cuend"></div>
      <div class="cu-ppl" id="cuppl"></div>
      <div class="cu-pc">${pcFace('pc-face big')}<p id="cuquote"></p></div>
      <div class="cu-title"><small id="custars"></small><b id="cutitle"></b><span id="cusub"></span></div>
      <div class="cu-flash"></div>
    </div>
    <div class="announce" id="announce" role="status"><div class="an-card"><i id="anicon"></i><b id="antitle"></b><span id="ansub"></span></div></div>
    <div class="inter" id="inter" aria-hidden="true"><div class="inter-band"><small id="ikick"></small><b id="ititle"></b><span id="isub"></span></div></div>`;
  const $ = (s) => root.querySelector(s);
  const stage = $('#stage');

  // La carte s'adapte à l'écran : réduite si elle déborde (jamais besoin de faire défiler, sauf écran minuscule),
  // agrandie sur les grands écrans pour occuper la place (jusqu'à ×1,5)
  let fitCard = null;
  function fit() {
    const c = stage.querySelector(':scope > .card'); if (!c) return;
    c.style.zoom = '';
    const availH = stage.clientHeight - 14, availW = stage.clientWidth - 14, h = c.offsetHeight, w = c.offsetWidth;
    if (!h || !w) return;
    const min = innerWidth < 820 ? 0.72 : 0.5, max = innerWidth < 820 ? 1 : 1.5;
    const k = Math.max(min, Math.min(max, availH / h, availW / w));
    c.style.zoom = Math.abs(k - 1) < 0.02 ? '' : String(Math.floor(k * 1000) / 1000);
  }
  const fitRO = typeof ResizeObserver === 'function' ? new ResizeObserver(() => requestAnimationFrame(fit)) : null;
  if (fitRO) fitRO.observe(stage);
  new MutationObserver(() => {
    const c = stage.querySelector(':scope > .card');
    if (c !== fitCard && fitRO) { if (fitCard) fitRO.unobserve(fitCard); fitCard = c; if (c) fitRO.observe(c); }
    requestAnimationFrame(fit);
  }).observe(stage, { childList: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fit());
  addEventListener('resize', () => requestAnimationFrame(fit));

  let S = null, offset = 0, key = '', myAns = null, shown = {}, lastTick = -1, setupS = null, sabSeen = -1, picking = null;
  let jokInfo = null, draft = { idx: -1, code: '' }, pyAsked = false, interFor = -2, interT = 0, annT = [];
  const meP = () => S && S.players.find((p) => p.id === me.id);
  const iAmOut = () => !!(meP() && meP().out);
  // face-à-face en cours : les deux finalistes jouent, les autres regardent
  const duelOn = () => !!(S && S.duel && S.duel.winner == null);
  const iWatch = () => iAmOut() || (duelOn() && !S.duel.ids.includes(me.id));
  const name = (id) => { const p = S && S.players.find((q) => q.id === id); return p ? p.name : '?'; };
  const now = () => Date.now() + offset;
  const myCurses = () => (S && S.active && S.active[me.id]) || [];
  const myDeadline = () => S.endsAt - (myCurses().some((c) => c.power === 'time') ? STEAL_MS : 0);

  /* ---------------------------------------------------------- outils */
  const syncTools = () => {
    $('#tsnd').textContent = sfx.on ? '🔊' : '🔇';
    $('#tsnd').classList.toggle('off', !sfx.on);
    const tm = $('#tmus');
    if (tm) {
      tm.textContent = wallStreetMusic.on ? '🎵' : '🔇';
      tm.classList.toggle('off', !wallStreetMusic.on);
    }
    $('#tshow').classList.toggle('off', !staging.on);
  };
  syncTools();
  $('#tsnd').onclick = () => { sfx.toggle(); syncTools(); };
  const tm = $('#tmus');
  if (tm) tm.onclick = () => { wallStreetMusic.toggle(); syncTools(); };
  $('#tshow').onclick = () => { const on = staging.toggle(); syncTools(); toast(on ? '🎬 Mise en scène : ouverture et réactions de Pierre' : '🎬 Animations réduites : sans ouverture ni réactions de Pierre'); if (!on) { const l = $('#pclive'); if (l) l.remove(); } };
  $('#tquit').onclick = () => { wallStreetMusic.stop(); exit(); };
  let toastT = 0;
  function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop'); clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }

  /* ---------------------------------------------------------- réactions */
  const toggleEmo = (v) => { const p = $('#emopanel'); p.hidden = v == null ? !p.hidden : !v; $('#bEmote').setAttribute('aria-expanded', String(!p.hidden)); if (!p.hidden) closePick(); };
  $('#bEmote').onclick = () => toggleEmo();
  for (const b of root.querySelectorAll('[data-emo]')) b.onclick = () => { emote(b.dataset.emo); toggleEmo(false); };
  const cardOf = (id) => root.querySelector(`.pcard[data-id="${id}"]`);
  function showEmote(from, id) {
    const em = emoteOf(id); if (!em) return;
    const card = cardOf(from);
    const b = el('div', 'bubble' + (em.glyph ? ' big' : ''), esc(em.glyph || em.text));
    if (card) { card.appendChild(b); } else { b.classList.add('free'); b.textContent = `${name(from)} : ${em.glyph || em.text}`; root.appendChild(b); }
    sfx.play('pop');
    setTimeout(() => b.remove(), 2600);
  }

  /* ---------------------------------------------------------- sabotage */
  const canSabotage = () => S && S.cfg.sabotage && S.phase === 'reveal' && S.idx + 1 < S.cfg.len;
  function renderPowers() {
    const box = $('#powers');
    const meP = S && S.players.find((p) => p.id === me.id);
    if (!S || !S.cfg.sabotage || !meP || S.phase === 'over') { box.innerHTML = ''; return; }
    const open = canSabotage();
    box.innerHTML = meP.powers.length
      ? meP.powers.map((pw, k) => pw === 'shield'
        ? `<span class="power shield" title="${esc(POWERS.shield.desc)}">${POWERS.shield.icon}<small>Bouclier</small></span>`
        : `<button class="power${open ? ' ready' : ''}" data-pw="${pw}" data-k="${k}" ${open ? '' : 'disabled'} title="${esc(POWERS[pw].label + ' : ' + POWERS[pw].desc)}">${POWERS[pw].icon}<small>${esc(POWERS[pw].label)}</small></button>`).join('')
      : '<span class="power empty" title="3 bonnes réponses d\'affilée = un pouvoir">🎁<small>3 d\'affilée</small></span>';
    for (const b of box.querySelectorAll('[data-pw]')) b.onclick = () => openPick(b.dataset.pw);
    if (picking && !open) closePick();
  }
  function openPick(pw) {
    if (!canSabotage()) return;
    toggleEmo(false);
    picking = pw;
    const box = $('#sabpick');
    const others = S.players.filter((p) => p.id !== me.id);
    box.innerHTML = `<b>${POWERS[pw].icon} ${esc(POWERS[pw].label)}</b><small>${esc(POWERS[pw].desc)} · sur qui ?</small>
      <div class="targets">${others.map((p) => `<button data-t="${p.id}"><i class="dot" style="background:${esc(p.color)}"></i>${esc(p.name)}<span>${fmt(p.score)}</span></button>`).join('')}</div>
      <button class="linkbtn" id="sabCancel">Annuler</button>`;
    box.hidden = false;
    for (const b of box.querySelectorAll('[data-t]')) b.onclick = () => { sabotage(pw, Number(b.dataset.t)); closePick(); };
    $('#sabCancel').onclick = closePick;
  }
  function closePick() { picking = null; $('#sabpick').hidden = true; }

  // un pouvoir qui vole d'un joueur à l'autre
  function playSabotage(e) {
    const from = cardOf(e.from), to = cardOf(e.to), P = POWERS[e.power];
    toast(e.blocked ? `🛡️ ${name(e.to)} bloque ${P.label.toLowerCase()} de ${name(e.from)} !` : `${P.icon} ${name(e.from)} envoie « ${P.label} » à ${name(e.to)} !`, 3000);
    sfx.play(e.blocked ? 'lock' : 'sab');
    if (!from || !to || !motion()) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const f = el('div', 'fly', P.icon);
    f.style.left = a.left + a.width / 2 + 'px'; f.style.top = a.top + a.height / 2 + 'px';
    root.appendChild(f);
    const dx = b.left - a.left, dy = b.top - a.top;
    const anim = f.animate([
      { transform: 'translate(-50%,-50%) scale(.6)' },
      { transform: `translate(calc(-50% + ${dx / 2 + 60}px), calc(-50% + ${dy / 2 - 40}px)) scale(1.6) rotate(200deg)`, offset: 0.5 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(360deg)` },
    ], { duration: 900, easing: 'cubic-bezier(.4,.1,.3,1)' });
    anim.onfinish = () => {
      f.remove();
      to.classList.remove('hit', 'blocked'); void to.offsetWidth; to.classList.add(e.blocked ? 'blocked' : 'hit');
      if (e.blocked) { const s = el('div', 'shieldpop', '🛡️'); to.appendChild(s); setTimeout(() => s.remove(), 1200); }
    };
  }

  /* ---------------------------------------------------------- joueurs */
  function renderRoster() {
    if (!S) { $('#roster').innerHTML = ''; return; }
    // The Candidate : les éliminés descendent en bas, grisés
    const order = [...S.players].sort((a, b) => (a.out ? 1 : 0) - (b.out ? 1 : 0) || b.score - a.score);
    const box = $('#roster');
    // à 7 ou 8 autour de la table, cartes plus compactes pour que tout le monde tienne
    box.classList.toggle('many', S.players.length > 6);
    for (const c of [...box.children]) if (!S.players.some((p) => String(p.id) === c.dataset.id)) c.remove();
    // animation FLIP : on note la place de chaque carte avant de les réordonner
    const before = new Map([...box.children].map((c) => [c.dataset.id, c.getBoundingClientRect()]));
    order.forEach((p, k) => {
      let c = cardOf(p.id);
      if (!c) { c = el('div', 'pcard'); c.dataset.id = p.id; c.innerHTML = '<i class="band"></i><span class="rank"></span><span class="nm"></span><b class="sc"></b><span class="st"></span>'; box.appendChild(c); shown[p.id] = p.score; }
      c.style.setProperty('--pc', p.color); c.style.order = k;
      c.classList.toggle('me', p.id === me.id);
      c.classList.toggle('lead', k === 0 && p.score > 0 && !p.out);
      // éliminé à l'instant : la carte vacille et tombe avant de passer en gris
      if (p.out && !c.classList.contains('out') && motion()) { c.classList.remove('falling'); void c.offsetWidth; c.classList.add('falling'); }
      c.classList.toggle('out', !!p.out);
      c.querySelector('.rank').textContent = k === 0 && p.score > 0 ? '👑' : k + 1;
      c.querySelector('.nm').textContent = p.name + (p.bot ? ' 🤖' : '') + (p.id === me.id ? ' (toi)' : '');
      const a = S.answers && S.answers[p.id];
      let st = '';
      if (p.out) st = `<em class="outtag">${p.outWhy === 'palier' ? '✂️ coupé' : '🚪 éliminé'}</em>`;
      else if (S.phase === 'question') st = a ? (a.locked ? '<em class="locked">🔒 bloqué</em>' : a.grading ? '<em class="done">⚙️ code en test…</em>' : '<em class="done">✔ a répondu</em>') : '<em class="think">réfléchit…</em>';
      else if (S.phase === 'reveal' && S.last) { const r = S.last.results.find((x) => x.id === p.id); st = r ? (r.ok ? '<em class="good">juste</em>' : r.raw != null ? '<em class="bad">raté</em>' : '<em class="think">pas de réponse</em>') : ''; }
      if (p.streak >= 2 && S.phase !== 'over' && !p.out) st += `<em class="flame">🔥 ${p.streak}</em>`;
      const regained = S.phase === 'reveal' && S.last && S.last.results.some((x) => x.id === p.id && x.tags.includes('life'));
      if (S.cfg.lives && !p.out) st = `<em class="lives${regained ? ' up' : ''}" title="${p.lives} vie${p.lives > 1 ? 's' : ''}">${hearts(p.lives, S.cfg.lives)}</em>` + st;
      const curses = S.phase === 'question' ? (S.active && S.active[p.id]) || [] : (S.curses && S.curses[p.id]) || [];
      if (curses.length) st += `<em class="curse" title="Saboté">${curses.map((c) => POWERS[c.power].icon).join('')}</em>`;
      if (S.cfg.sabotage && p.powers && p.powers.length && p.id !== me.id) st += `<em class="pw" title="Pouvoirs en réserve">${p.powers.map((pw) => POWERS[pw].icon).join('')}</em>`;
      c.querySelector('.st').innerHTML = st;
      animateScore(c.querySelector('.sc'), p.id, p.score);
    });
    if (motion()) for (const c of box.children) {
      const b0 = before.get(c.dataset.id); if (!b0) continue;
      const b1 = c.getBoundingClientRect(), dx = b0.left - b1.left, dy = b0.top - b1.top;
      if (dx || dy) c.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.3,.7,.25,1)' });
    }
    renderPowers();
  }
  function animateScore(node, id, to) {
    const from = shown[id] ?? to;
    shown[id] = to;
    if (from === to || !motion()) { node.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 900;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); node.textContent = fmt(Math.round(from + (to - from) * (1 - (1 - k) ** 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    const pop = el('span', 'delta ' + (to > from ? 'up' : 'down'), (to > from ? '+' : '−') + fmt(Math.abs(to - from)));
    node.parentNode.appendChild(pop); setTimeout(() => pop.remove(), 1600);
  }

  /* ---------------------------------------------------------- The Candidate : bandeau de cotations */
  const isCh = () => !!(S ? S.cfg.mode === 'chartier' : setupS && setupS.cfg.mode === 'chartier');
  let tickKey = '';
  function renderTicker() {
    const on = isCh();
    root.classList.toggle('mode-chartier', on);
    if (!on) { tickKey = ''; return; }
    // reconstruit seulement quand les scores changent (sinon le défilement repartirait à zéro)
    const players = S ? S.players : (setupS ? setupS.players : []);
    const last = S && S.last && S.phase !== 'question' ? S.last.results : [];
    const k = players.map((p) => p.id + ':' + (p.score || 0)).join(',') + '|' + (S ? S.phase === 'over' : '');
    if (k === tickKey) return;
    tickKey = k;
    const seed = players.reduce((a, p) => a + (p.score || 0), 7);
    const idx = TICKER_IDX.map(([n, v], i) => {
      const ch = Math.sin(seed * 0.37 + i * 1.7) * 1.4;
      const val = v * (1 + ch / 100);
      const txt = v < 10 ? val.toFixed(4).replace('.', ',') : v < 100 ? val.toFixed(2).replace('.', ',') : fmt(Math.round(val * 10) / 10);
      return `<span class="${ch >= 0 ? 'up' : 'down'}">${esc(n)} <b>${txt}</b> ${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(2).replace('.', ',')} %</span>`;
    });
    const ppl = [...players].sort((a, b) => (b.score || 0) - (a.score || 0)).map((p) => {
      const r = last.find((x) => x.id === p.id), d = r ? r.pts : 0;
      return `<span class="pl ${d > 0 ? 'up' : d < 0 ? 'down' : ''}"><i style="background:${esc(p.color)}"></i>${esc(symbolOf(p.name))} <b>${fmt(p.score || 0)}</b> ${d > 0 ? '▲ +' + fmt(d) : d < 0 ? '▼ ' + fmt(d) : '■'}</span>`;
    });
    const one = `<span class="badge">THE CANDIDATE</span>${ppl.join('')}<span class="sep">◆</span>${idx.join('')}<span class="sep">◆</span>`;
    $('#ttrack').innerHTML = one + one;
  }

  /* ---------------------------------------------------------- avant-partie */
  function renderSetup(s) {
    setupS = s;
    root.classList.add('noroster');
    const isHost = s.hostId === me.id, c = s.cfg, ready = s.players.filter((p) => p.ready);
    const isChartier = c.mode === 'chartier';
    root.classList.toggle('mode-chartier', isChartier);
    $('#tmus').hidden = !isChartier; $('#tshow').hidden = !isChartier;
    $('#ibrand').textContent = isChartier ? 'The Candidate' : 'Tête de Calcul';
    const w = LEVEL_WORDS[s.level] || LEVEL_WORDS.normal;
    if (isChartier) { wallStreetMusic.setMode('lobby'); wallStreetMusic.start(); renderTicker(); }

    const briefingHtml = isChartier
      ? `<p class="mdesc">Un entretien façon salle de marché. Finance, calcul mental, probabilités et brainteasers : ça commence gentiment, ça finit en comité.</p>
         <div class="rules tiers">
           ${[1, 2, 3].map((t, i) => `<div class="rule" style="--k:${i}"><i>${'★'.repeat(t)}</i><b>${TIER_LABEL[t]}</b><small>${t * 100} pts</small></div>`).join('')}
           ${c.finale ? '<div class="rule" style="--k:3"><i>×2</i><b>Finale</b><small>quitte ou double</small></div>' : ''}
         </div>
         <ul class="howto">
           <li>QCM (<b>1 2 3 4</b> ou <b>A B C D</b>), calculs et estimations à taper, suites logiques, figures à compter${(c.code || c.sql) && c.len >= 8 ? `, et ${c.len >= 15 ? 'deux <b>épreuves de code</b>' : 'une <b>épreuve de code</b>'} de 2 minutes (${c.code && c.sql ? 'Python ou SQL' : c.sql ? 'SQL' : 'Python'})` : ''}.</li>
           <li><b>${hearts(c.lives, c.lives)}</b> ${['', 'une vie', 'deux vies', 'trois vies', 'quatre vies', 'cinq vies'][c.lives]} : une erreur ou un silence en coûte une. <b>Le piège</b> 🪤 coûte de plus en plus cher : 1 vie au premier tour, 2 au desk, 2 et des points au comité. Une estimation presque juste ne coûte rien, et trois bonnes réponses d'affilée rendent une vie.</li>
           ${c.cut ? '<li>À la fin de chaque tour, le dernier du classement est <b>coupé</b> ✂️ (tant qu\'il reste trois candidats).</li>' : ''}
           ${c.jokers ? '<li>Deux jokers, une fois chacun : <b>✂️ 50/50</b> et <b>📞 Appel à un ami</b> (qui a souvent raison…).</li>' : ''}
           ${c.duel ? '<li>À la fin, les deux meilleurs encore en lice s\'affrontent en <b>face-à-face</b> ⚔️ : la première bonne réponse gagne, la première erreur perd.</li>' : ''}
           <li>🎬 en haut à droite : coupe la scène d'ouverture et les réactions de Pierre.</li>
           ${c.sabotage ? '<li>Sabotage activé : trois bonnes réponses d\'affilée donnent un pouvoir à lancer sur un adversaire.</li>' : ''}
           <li>Le dernier debout décroche le poste ; sinon, le meilleur score.</li>
         </ul>`
      : `<p class="mdesc">${esc(MODES[c.mode].desc)}</p>
         <div class="rules">
           ${Object.entries(CATS).filter(([k]) => k !== 'chartier').map(([k, v], i) => `<div class="rule" style="--cc:${v.color};--k:${i}"><i>${v.icon}</i><b>${esc(v.label)}</b><small>${v.pts * 100} pts</small></div>`).join('')}
         </div>
         <ul class="howto">
           <li>Une seule réponse par question : <b>Entrée</b> pour valider (ou <b>1</b> / <b>2</b> pour les choix).</li>
           <li>Plus tu réponds vite, plus tu marques. Le premier juste gagne <b>+50</b>.</li>
           <li>Trois bonnes réponses d'affilée : bonus de <b>série</b> 🔥${c.sabotage ? ' et un <b>pouvoir de sabotage</b> à lancer sur un adversaire entre deux questions' : ''}.</li>
         </ul>`;

    stage.innerHTML = `
      <div class="card setup deal">
        <div class="setup-head">
          ${isChartier ? pcFace('pc-face big') : ''}<div class="logo-c"><span>${isChartier ? 'Pierre Chartier présente' : 'Tête de'}</span><b>${isChartier ? 'The Candidate' : 'Calcul'}</b></div>
          <div class="chips">
            <span class="chip strong">${esc(MODES[c.mode].label)}</span><span class="chip">${c.len} questions</span>
            <span class="chip">${esc(DIFF_LABEL[c.diff])}</span>
            ${!isChartier ? `<span class="chip">${esc(THEME_LABEL[c.theme] || c.theme)}</span>` : `<span class="chip gold">Poste : ${esc((MODULES[c.module] || MODULES.gen).job)}</span>`}
            ${c.finale ? '<span class="chip gold">Finale quitte ou double</span>' : ''}
            ${c.sabotage ? '<span class="chip sab">Sabotage 🌫️⏱️🙃</span>' : ''}
            ${s.bots ? `<span class="chip">${s.bots} bot${s.bots > 1 ? 's' : ''} ${s.bots > 1 ? w[1] : w[0]}</span>` : ''}
          </div>
        </div>
        ${briefingHtml}
        <div class="who">${s.players.map((p) => `<span class="pp${p.ready ? '' : ' off'}"><i style="background:${esc(p.color)}"></i>${esc(p.name)}${p.ready ? '' : ' · charge…'}</span>`).join('')}</div>
        ${isHost ? `<button class="btn big block primary" id="bStart" ${ready.length ? '' : 'disabled'}>${isChartier ? 'Entrer dans la salle' : 'Lancer la partie'}</button>`
          : '<div class="waithost"><i></i>L\'hôte va lancer la partie…</div>'}
      </div>`;
    const b = $('#bStart');
    if (b) b.onclick = () => { sfx.play('go'); if (isChartier) wallStreetMusic.start(); start(); };
  }

  /* ---------------------------------------------------------- question */
  function questionBody(q) {
    if (q.input === 'code' && q.lang === 'sql') {
      // les tables de la base d'exemple, et ce que la requête doit renvoyer dessus
      const [[tables], exp] = q.examples[0];
      const table = (cols, rows, title) => `<table class="sqltab"><caption>${esc(title)}</caption><tr>${cols.map((c) => `<th>${esc(c.split(' ')[0])}</th>`).join('')}</tr>${rows.slice(0, 8).map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}${rows.length > 8 ? `<tr><td colspan="${cols.length}">… ${rows.length - 8} de plus</td></tr>` : ''}</table>`;
      return `<div class="qtext cand code-title">🗄 ${qText(q.text)}</div><p class="code-brief">${qText(q.prompt || '')}</p>
        <div class="sqlbox">${tables.map((t) => table(t.cols, t.rows, t.name)).join('')}${table(exp[0] ? exp[0].map((_, k) => `col${k + 1}`) : ['—'], exp, 'résultat attendu')}</div>
        <div class="code-ex"><small>+ 2 bases cachées${q.ordered ? ', l\'ordre des lignes compte' : ''}</small></div>`;
    }
    if (q.input === 'code') {
      const ex = (q.examples || []).map(([args, exp]) => `<code>${esc(q.fn)}(${esc(args.map(pyRepr).join(', '))}) → ${esc(pyRepr(exp))}</code>`).join('');
      return `<div class="qtext cand code-title">${q.bug ? '🐞' : '⌨'} ${qText(q.text)}</div><p class="code-brief">${qText(q.prompt || '')}</p>
        <div class="code-ex"><b>Exemples</b>${ex}<small>+ ${Math.max(0, (q.ntests || 0) - (q.examples || []).length)} tests cachés</small></div>`;
    }
    if (q.input === 'expr') return `<div class="target"><small>Cible</small><b>${q.target}</b></div>
      <div class="tiles">${q.nums.map((n, k) => `<button class="tile" data-n="${n}" data-k="${k}" style="--k:${k}">${n}</button>`).join('')}</div>`;
    const cls = q.isChartier ? 'cand' + (q.text.length > 140 ? ' dense' : '') : q.cat === 'devinette' ? 'riddle' : q.fig ? 'geo' : q.text.length > 16 ? 'long' : '';
    return `${q.fig ? figureSvg(q.fig) : ''}<div class="qtext ${cls}">${qText(q.text)}${q.eq !== false ? '<span class="eq"> = ?</span>' : ''}</div>${q.snippet ? `<pre class="code-snip">${highlightCode(q.snippet, q.lang)}</pre>` : ''}${q.copy ? `<div class="copybox${q.kind === 'phone' ? ' phone' : ''}" aria-label="À lire">${esc(q.copy)}</div>` : ''}`;
  }

  const LETTERS = ['A', 'B', 'C', 'D'];
  function answerZone(q) {
    if (duelOn() && !S.duel.ids.includes(me.id) && !iAmOut()) return `<div class="spect">⚔️ Face-à-face : tu regardes ${esc(name(S.duel.ids[0]))} contre ${esc(name(S.duel.ids[1]))}.</div>`;
    if (iAmOut()) return '<div class="spect">👀 Tu es éliminé : tu regardes la suite de l\'entretien.</div>';
    if (q.input === 'code') {
      const code = draft.idx === S.idx && draft.code ? draft.code : q.starter || '';
      return `<div class="code-zone">
          <div class="code-wrap"><pre class="code-gut" id="cgut" aria-hidden="true"></pre><div class="code-box">
            <pre class="code-hl" aria-hidden="true"><code id="chl"></code></pre>
            <textarea id="code" class="code-ed" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Ton code Python">${esc(code)}</textarea>
          </div></div>
          <div class="code-bar"><button type="button" class="btn ghost" id="ctest">▶ Tester les exemples</button><small>Tab : indenter · Ctrl+Entrée : envoyer</small><button type="button" class="btn yellow" id="csend">Envoyer mon code</button></div>
          <pre class="code-out" id="cout" hidden></pre>
        </div>`;
    }
    if (q.input === 'mm') {
      return `<div class="mm" id="mm">
          <div class="mm-dice">${[0, 1, 2].map((k) => `<span class="die" data-d="${k}">?</span>`).join('<i>+</i>')}<i>=</i><span class="die sum">?</span></div>
          <form class="mm-quote" id="mmform" autocomplete="off">
            <label>J'achète à<input id="mmbid" inputmode="decimal" maxlength="6" aria-label="Prix d'achat"></label>
            <label>Je vends à<input id="mmask" inputmode="decimal" maxlength="6" aria-label="Prix de vente"></label>
            <button class="btn yellow" id="mmgo">Coter</button>
          </form>
          <p class="mm-ctx" id="mmctx"></p>
          <p class="tolhint" id="mmrule"></p>
          <ol class="mm-log" id="mmlog"></ol>
          <details class="mm-help"${S.history.some((h) => h.input === 'mm') ? '' : ' open'}><summary>Comment ça marche ?</summary><ol>
            <li>Tu ne devines pas la somme : tu donnes <b>deux prix</b>, un pour acheter, un pour vendre, un peu plus haut.</li>
            <li>Le client choisit : si ton prix de vente lui paraît bas, il t'achète ${MM_LOT} lots (tu es <b>vendeur</b>) ; si ton prix d'achat lui paraît haut, il te vend ${MM_LOT} lots (tu es <b>acheteur</b>).</li>
            <li>À la fin, tout est soldé à la vraie somme. Vendeur, tu gagnes si elle finit sous ton prix ; acheteur, si elle finit au-dessus.</li>
            <li>Le bon centre : les dés déjà vus, plus <b>3,5</b> par dé restant. Avant tout dé : 3 × 3,5 = 10,5, donc par exemple 8,5 / 12,5.</li>
          </ol></details>
        </div>`;
    }
    if (q.input === 'multi') {
      return `<div class="multi-choices">${q.choices.map((c, k) => `<button type="button" class="mchoice" data-m="${k}" aria-pressed="false" style="--k:${k}"><span class="mbox"></span><span class="ct">${qText(c)}</span></button>`).join('')}</div>
        <div class="multi-bar"><small>Coche toutes les bonnes réponses, puis valide</small><button type="button" class="btn yellow" id="msend">Valider</button></div>`;
    }
    if (q.input === 'text') {
      return `<form class="answer fat" id="aform" autocomplete="off">
          <input id="ain" inputmode="text" placeholder="Recopie ici" maxlength="64" aria-label="Recopie le texte affiché" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off">
          <button class="btn yellow" id="asend">Valider</button>
        </form><p class="tolhint">Tout compte : chaque caractère, les espaces et les majuscules. Copier-coller interdit.</p>`;
    }
    if (q.isChartier && q.input === 'choice') {
      return `<div class="cand-choices">${q.choices.map((c, k) => `<button type="button" class="cchoice" data-c="${k}" style="--k:${k}">
          <span class="cl">${LETTERS[k]}</span><span class="ct">${qText(c)}</span><kbd>${k + 1}</kbd></button>`).join('')}</div>`;
    }
    if (q.input === 'choice') {
      const vf = q.choices.length === 2 && q.choices[0] === 'Vrai';
      return `<div class="choices ${vf ? 'vf' : 'cmp'}">${q.choices.map((c, k) => `<button class="choice c${k}" data-c="${k}"><kbd>${vf ? (k ? 'F' : 'V') : k + 1}</kbd>${qText(c)}</button>`).join('')}</div>`;
    }
    const expr = q.input === 'expr';
    return `<form class="answer" id="aform" autocomplete="off">
        <input id="ain" ${expr ? 'inputmode="text" placeholder="ex. (8 + 4) × 5"' : 'inputmode="decimal" placeholder="Ta réponse"'} maxlength="${expr ? 40 : 14}" aria-label="Ta réponse" spellcheck="false">
        ${q.unit ? `<span class="unit">${esc(q.unit)}</span>` : ''}
        <button class="btn yellow" id="asend">Valider</button>
      </form>
      ${q.isChartier && q.tol ? `<p class="tolhint">${q.tolMode === 'factor' ? `Ordre de grandeur : juste à ×${fmt(q.tol)} près` : `Accepté à ±${fmt(Math.round(q.tol * 1000) / 10)} % près`}</p>` : ''}
      ${expr ? `<div class="ops">${['+', '−', '×', '÷', '(', ')'].map((o) => `<button type="button" data-op="${o}">${o}</button>`).join('')}<button type="button" data-op="back" aria-label="Effacer">⌫</button><button type="button" data-op="clear">C</button></div>` : ''}`;
  }

  function renderQuestion() {
    const q = S.q, cat = CATS[q.cat];
    const ch = !!q.isChartier;
    // la musique monte d'un cran à chaque tour : premier tour, desk, comité final, et le face-à-face au sommet
    if (ch) { wallStreetMusic.setMode(duelOn() ? 'duel' : q.final || q.tier === 3 ? 'final' : q.tier === 2 ? 'desk' : 'question'); wallStreetMusic.start(); }
    myAns = null; lastTick = -1;
    const curses = myCurses();
    const head = ch
      ? `<span class="cat"><i>${cat.icon}</i>${esc(q.rubric || cat.label)}</span>
         <span class="tierb t${q.tier}">${'★'.repeat(q.tier)} ${esc(TIER_LABEL[q.tier])}</span>
         <span class="pts">${q.pts * 100} pts</span>
         ${q.final ? '<span class="final">Quitte ou double</span>' : ''}
         ${q.kind === 'case' || q.kind === 'mm' || q.bonus ? `<span class="final special">${q.kind === 'case' ? '📁' : q.kind === 'mm' ? '⇅' : '↻'} ${esc(q.sub)}</span>` : ''}
         ${duelOn() ? `<span class="final duelb">⚔️ ${esc(name(S.duel.ids[0]))} contre ${esc(name(S.duel.ids[1]))} · mort subite</span>` : ''}
         <span class="live"><i></i>EN DIRECT</span>
         ${S.cfg.lives && meP() && !meP().out ? `<span class="mylives" title="Tes vies">${hearts(meP().lives, S.cfg.lives)}</span>` : ''}
         <span class="qnum">${q.n} / ${S.cfg.len}</span>`
      : `<span class="cat"><i>${cat.icon}</i>${esc(cat.label)}</span>
         <span class="pts">${q.pts * 100} pts</span>
         ${q.final ? '<span class="final">Quitte ou double</span>' : ''}
         <span class="qnum">${q.n} / ${S.cfg.len}</span>`;
    stage.innerHTML = `
      <div class="card pupitre in-${q.input}${ch ? ' cand' : ''}${q.final ? ' isfinal' : ''} deal" style="--cc:${cat.color}">
        ${curses.map((c) => `<div class="cursed c-${c.power}">${POWERS[c.power].icon} <b>${esc(name(c.from))}</b> t'a envoyé « ${esc(POWERS[c.power].label)} »${c.power === 'time' ? ' : −5 s' : ''}</div>`).join('')}
        <div class="qhead">${head}</div>
        <div class="timer" id="timer"><i id="tbar"></i><b id="tsec"></b></div>
        ${ch && staging.on && !iAmOut() ? `<div class="pc-live" id="pclive">${pcFace('pc-face')}<span class="pc-bubble" id="pcsay"></span></div>` : ''}
        <div class="qzone ${q.input !== 'code' && curses.some((c) => c.power === 'fog') ? 'fog' : ''} ${q.input !== 'code' && curses.some((c) => c.power === 'flip') ? 'flip' : ''}" id="qzone">
          ${questionBody(q)}
          ${ch ? '' : `<p class="qsub">${esc(q.sub)}</p>`}
        </div>
        <div class="jokers" id="jokers"></div>
        ${answerZone(q)}
        <div class="sent" id="sent" hidden></div>
      </div>`;
    jokInfo = null;
    renderJokers();
    if (ch && staging.on) pierreLive(q);
    const fog = $('#qzone.fog'); if (fog) fog.style.setProperty('--fog', FOG_MS + 'ms');

    if (q.input === 'code') wireCode(q);
    else if (q.input === 'mm') wireMarket(q);
    else if (q.input === 'multi') {
      for (const b of root.querySelectorAll('[data-m]')) b.onclick = () => { if (myAns != null) return; const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); sfx.play('pop'); };
      $('#msend').onclick = () => {
        const picked = [...root.querySelectorAll('[data-m].on')].map((b) => b.dataset.m);
        if (!picked.length || myAns != null) return toast('Coche au moins une réponse');
        myAns = picked.join(','); answer(myAns); sfx.play('lock'); pcAnswered();
        for (const b of root.querySelectorAll('[data-m], #msend')) b.disabled = true;
        const s2 = $('#sent'); s2.hidden = false; s2.className = 'sent'; s2.innerHTML = `Réponse verrouillée : <b>${picked.map((k) => 'ABCDEFGHIJ'[k]).join(', ')}</b> · on attend les autres…`;
      };
    }
    else if (q.input === 'choice') {
      for (const b of root.querySelectorAll('[data-c]')) b.onclick = () => choose(Number(b.dataset.c));
    } else {
      const inp = $('#ain');
      // fat finger : pas de copier-coller ni de glisser-déposer
      if (inp && q.input === 'text') for (const ev of ['paste', 'drop']) inp.addEventListener(ev, (e) => { e.preventDefault(); toast('Copier-coller interdit : recopie à la main'); });
      if (inp) {
        setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch (e) {} }, 60);
        $('#aform').onsubmit = (e) => {
          e.preventDefault();
          const v = inp.value.trim();
          if (!v || myAns != null) return;
          myAns = v; answer(v); sfx.play('lock'); lockInput(v, false); pcAnswered();
        };
      }
      if (q.input === 'expr') {
        const insert = (t) => { if (myAns != null) return; inp.value += t; markTiles(); inp.focus({ preventScroll: true }); };
        for (const b of root.querySelectorAll('.tile')) b.onclick = () => { if (!b.classList.contains('used')) insert((/\d$/.test(inp.value) ? ' + ' : '') + b.dataset.n); };
        for (const b of root.querySelectorAll('[data-op]')) b.onclick = () => {
          if (myAns != null) return;
          const o = b.dataset.op;
          if (o === 'back') inp.value = inp.value.replace(/\s*\S\s*$/, ''); else if (o === 'clear') inp.value = ''; else inp.value += ` ${o} `.replace(/^ \(/, '(').replace(/\) $/, ')');
          markTiles(); inp.focus({ preventScroll: true });
        };
        inp.addEventListener('input', markTiles);
      }
    }
    sfx.play(curses.length ? 'sab' : 'question');
  }

  /* ---------------------------------------------------------- The Candidate : jokers */
  function renderJokers() {
    const box = $('#jokers'); if (!box) return;
    const p = meP();
    // les jokers ne servent que sur les QCM : ailleurs, on ne les affiche pas
    if (!S || !S.cfg.lives || !p || p.out || S.phase !== 'question' || !S.q || S.q.input !== 'choice' || duelOn()) { box.innerHTML = ''; return; }
    const usable = myAns == null && !(S.answers && S.answers[me.id]);
    box.innerHTML = Object.entries(JOKERS).map(([k, j]) => {
      const has = p.jokers.includes(k);
      return `<button type="button" class="joker${has ? '' : ' used'}" data-jok="${k}" ${has && usable ? '' : 'disabled'} title="${esc(j.desc || j.label)}">${j.icon} ${esc(j.label)}</button>`;
    }).join('') + (jokInfo && jokInfo.kind === 'friend' && S.q.choices ? `<span class="friendsays">📞 Ton ami : « Je dirais <b>${LETTERS[jokInfo.suggest]}</b>, ${esc(S.q.choices[jokInfo.suggest])}… je crois. »</span>` : '');
    for (const b of box.querySelectorAll('[data-jok]')) b.onclick = () => { b.disabled = true; joker(b.dataset.jok); };
  }
  function applyJoker(m) {
    if (!S || S.phase !== 'question' || m.idx !== S.idx) return;
    jokInfo = m;
    // 50/50 : les deux réponses retirées s'effacent, les deux restantes se rapprochent
    if (m.kind === 'half') for (const k of m.removed) {
      const b = root.querySelector(`[data-c="${k}"]`); if (!b) continue;
      b.disabled = true; b.classList.add('going');
      setTimeout(() => { b.classList.add('gone'); requestAnimationFrame(fit); }, motion() ? 700 : 0);
    }
    sfx.play(m.kind === 'half' ? 'snip' : 'ring');
    renderJokers();
  }

  /* ---------------------------------------------------------- The Candidate : épreuve de code */
  function wireCode(q) {
    const ed = $('#code'), out = $('#cout');
    if (!ed) return;
    setTimeout(() => { try { ed.focus({ preventScroll: true }); ed.setSelectionRange(ed.value.length, ed.value.length); } catch (e) {} }, 60);
    // couleurs et numéros de ligne : une couche dessinée sous la zone de saisie (transparente), qui suit le défilement
    const hl = $('#chl'), gut = $('#cgut');
    const paint = () => {
      hl.innerHTML = highlightCode(ed.value, q.lang) + '\n';
      gut.textContent = Array.from({ length: ed.value.split('\n').length }, (_, k) => k + 1).join('\n');
      draft = { idx: S.idx, code: ed.value };
    };
    const follow = () => { hl.parentNode.scrollTop = ed.scrollTop; hl.parentNode.scrollLeft = ed.scrollLeft; gut.scrollTop = ed.scrollTop; };
    paint();
    ed.addEventListener('input', () => { paint(); follow(); });
    ed.addEventListener('scroll', follow);
    ed.addEventListener('keydown', (e) => {
      // Tab indente (4 espaces), Entrée garde l'indentation, Ctrl/Cmd+Entrée envoie
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); ed.setRangeText('    ', ed.selectionStart, ed.selectionEnd, 'end'); paint(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
      else if (e.key === 'Enter') {
        const line = ed.value.slice(0, ed.selectionStart).split('\n').pop();
        const ind = (line.match(/^\s*/) || [''])[0] + (/:\s*$/.test(line) ? '    ' : '');
        if (ind) { e.preventDefault(); ed.setRangeText('\n' + ind, ed.selectionStart, ed.selectionEnd, 'end'); paint(); follow(); }
      }
    });
    const show = (html, cls = '') => { out.hidden = false; out.className = 'code-out ' + cls; out.innerHTML = html; requestAnimationFrame(fit); };
    $('#ctest').onclick = async () => {
      const b = $('#ctest'); b.disabled = true; b.textContent = '⏳ Python…';
      show('Exécution des exemples…');
      const ex = q.examples || [];
      const r = await runPython(buildProgram(ed.value, q.fn, ex, { lang: q.lang, ordered: q.ordered }));
      b.disabled = myAns != null; b.textContent = '▶ Tester les exemples';
      if (!S || S.phase !== 'question' || !out.isConnected) return;
      const lines = r.error ? [`<span class="ko">✗ ${esc(r.error)}</span>`]
        : q.lang === 'sql' ? r.tests.map((t) => `<span class="${t.ok ? 'ok' : 'ko'}">${t.ok ? '✓ Résultat conforme sur la base d\'exemple' : '✗ ' + esc(t.err || 'Résultat obtenu : ' + t.got)}</span>`)
        : r.tests.map((t, k) => `<span class="${t.ok ? 'ok' : 'ko'}">${t.ok ? '✓' : '✗'} ${esc(q.fn)}(${esc(ex[k][0].map(pyRepr).join(', '))}) → ${esc(t.err || t.got || '')}${t.ok ? '' : ` (attendu ${esc(pyRepr(ex[k][1]))})`}</span>`);
      show(lines.join('\n') + (r.stdout ? `\n<span class="pr">${esc(r.stdout)}</span>` : ''), r.error || r.tests.some((t) => !t.ok) ? 'bad' : 'good');
    };
    $('#csend').onclick = send;
    function send() {
      if (myAns != null || !S || S.phase !== 'question') return;
      const v = ed.value;
      if (!v.trim()) return;
      myAns = v; answer(v); sfx.play('lock'); pcAnswered();
      ed.readOnly = true; $('#csend').disabled = true; $('#ctest').disabled = true;
      const st = $('#sent'); st.hidden = false; st.className = 'sent'; st.innerHTML = '⚙️ Code envoyé : l\'hôte le passe aux tests cachés…';
    }
  }
  function codeGraded(m) {
    if (!S || m.i !== S.idx) return;
    const st = $('#sent'); if (!st) return;
    st.hidden = false; st.className = 'sent' + (m.passed === m.total ? '' : ' locked');
    st.innerHTML = m.offline ? `⚠️ ${esc(m.error)}`
      : `${m.passed === m.total ? '✅' : m.passed ? '🟡' : '❌'} <b>${m.passed} / ${m.total}</b> tests réussis${m.error ? ` · ${esc(m.error)}` : ''} <span class="dots">${(m.tests || []).map((ok) => `<i class="${ok ? 'ok' : 'ko'}"></i>`).join('')}</span>`;
    sfx.play(m.passed === m.total ? 'ok' : 'ko');
  }

  // Pierre Chartier pendant la question : une phrase d'entrée, une relance à mi-temps, une autre à 5 secondes
  let pcT = [];
  const pcPick = (l, salt = 0) => l[(S.seed + S.idx * 7 + salt) % l.length];
  // Market making : trois cotations ; chaque deal s'affiche tout de suite, puis le dé suivant se dévoile.
  // La réponse envoyée est la liste des cotations (l'hôte rejoue le marché pour noter)
  function wireMarket(q) {
    const quotes = [], idx = S.idx;
    const n = (v) => Number(String(v).trim().replace(',', '.'));
    const rule = () => {
      const k = quotes.length, seen = q.mm.dice.slice(0, k);
      $('#mmrule').innerHTML = k < 3 ? `Cotation <b>${k + 1}/3</b> · écart de ${fmt(MM_MAX_SPREAD[k])} au plus entre tes deux prix` : 'Trois cotations envoyées. Le dernier dé se dévoile à la correction.';
      $('#mmctx').innerHTML = k < 3 ? `${seen.length ? `Dés vus : <b>${seen.join(' + ')}</b>.` : 'Aucun dé vu.'} Il en reste ${3 - k}, qui valent 3,5 en moyenne chacun.` : '';
    };
    const send = () => { if (myAns != null || !quotes.length) return; myAns = quotes.map((x) => x.join('/')).join(';'); answer(myAns); sfx.play('lock'); pcAnswered(); for (const e of root.querySelectorAll('#mmform input, #mmgo')) e.disabled = true; };
    rule();
    setTimeout(() => { try { $('#mmbid').focus({ preventScroll: true }); } catch (e) {} }, 60);
    // le temps file : on envoie ce qui a été coté (les cotations manquantes comptent comme trop larges)
    const left = q.time * 1000 - (now() - S.qAt) - 1800;
    const auto = setTimeout(() => { if (S && S.phase === 'question' && S.idx === idx) send(); }, Math.max(0, left));
    $('#mmform').onsubmit = (e) => {
      e.preventDefault();
      if (myAns != null || quotes.length >= 3) return;
      const k = quotes.length, bid = n($('#mmbid').value), ask = n($('#mmask').value);
      if (!Number.isFinite(bid) || !Number.isFinite(ask)) return toast('Deux prix : achat et vente');
      if (!(ask > bid)) return toast('Ton prix de vente doit être au-dessus de ton prix d\'achat');
      if (ask - bid > MM_MAX_SPREAD[k] + 1e-9) return toast(`Trop large : ${fmt(MM_MAX_SPREAD[k])} d'écart au plus à ce tour`);
      quotes.push([bid, ask]);
      const run = runMarket(q.mm, quotes), d = run.log[k];
      const what = d.kind === 'buy' ? `Le client t'achète ${MM_LOT} lots à ${fmt(ask)} : tu gagnes si la somme finit sous ${fmt(ask)}`
        : d.kind === 'sell' ? `Le client te vend ${MM_LOT} lots à ${fmt(bid)} : tu gagnes si la somme finit au-dessus de ${fmt(bid)}` : 'Le client trouve ton prix juste : pas de deal';
      const pos = run.log.slice(0, k + 1).reduce((t, x) => t + (x.kind === 'buy' ? -MM_LOT : x.kind === 'sell' ? MM_LOT : 0), 0);
      $('#mmlog').insertAdjacentHTML('beforeend', `<li class="${d.kind}"><b>${fmt(bid)} / ${fmt(ask)}</b><span>${what}</span><em>position ${pos > 0 ? '+' : ''}${pos}</em></li>`);
      sfx.play(d.kind === 'pass' ? 'pop' : 'lock');
      if (k < 2) { const die = root.querySelector(`.die[data-d="${k}"]`); die.textContent = q.mm.dice[k]; die.classList.add('shown'); }
      $('#mmbid').value = ''; $('#mmask').value = '';
      rule();
      if (quotes.length === 3) { clearTimeout(auto); send(); } else $('#mmbid').focus({ preventScroll: true });
    };
  }

  // Correction du market making : chacun de mes deals, ce qu'il rapporte une fois soldé à la somme finale
  function mmDetail(L, mine) {
    if (!mine || mine.raw == null) return '';
    const run = runMarket(L.mm, parseQuotes(mine.raw)), V = run.V, sg = (x) => (x > 0 ? '+' : '') + fmt(x);
    const rows = run.log.map((d) => d.kind === 'buy' ? `<li>Vendu ${MM_LOT} à ${fmt(d.ask)} → ${MM_LOT} × (${fmt(d.ask)} − ${V}) = <b>${sg(MM_LOT * (d.ask - V))}</b></li>`
      : d.kind === 'sell' ? `<li>Acheté ${MM_LOT} à ${fmt(d.bid)} → ${MM_LOT} × (${V} − ${fmt(d.bid)}) = <b>${sg(MM_LOT * (V - d.bid))}</b></li>`
      : d.kind === 'pass' ? `<li>${fmt(d.bid)} / ${fmt(d.ask)} : pas de deal</li>` : `<li>Cotation ${d.k + 1} manquante ou trop large : <b>−2</b></li>`).join('');
    return `<ol class="mm-sum">${rows}<li class="tot">Ton P&L : <b>${sg(run.pnl)}</b></li></ol>`;
  }

  function pcSay(text, mood = '', ms = 2600) {
    const box = $('#pclive'), b = $('#pcsay'); if (!box || !b || !staging.on) return;
    b.textContent = text; box.className = 'pc-live talk ' + mood;
    clearTimeout(box._t); box._t = setTimeout(() => { if (box.isConnected) box.className = 'pc-live'; }, ms);
  }
  function pierreLive(q) {
    for (const t of pcT.splice(0)) clearTimeout(t);
    const L = PC_LIVE, line = S.duel && S.duel.winner == null ? pcPick(L.duel) : q.final ? pcPick(L.final) : q.input === 'code' ? pcPick(q.lang === 'sql' ? L.sql : q.bug ? L.bug : L.code)
      : q.kind === 'mm' ? pcPick(L.mm) : q.bonus ? pcPick(L.relance) : q.kind === 'case' ? pcPick(q.caseStep ? L.caseNext : L.casep)
      : q.kind === 'chart' ? pcPick(L.chart) : q.snippet ? pcPick(L.read) : pcPick(L.start[q.tier] || L.start[2]);
    pcT.push(setTimeout(() => pcSay(line, 'nod', 3200), 500));
    const T = q.time * 1000;
    pcT.push(setTimeout(() => { if (myAns == null && S.phase === 'question') pcSay(pcPick(L.half, 1), 'tap'); }, T / 2));
    pcT.push(setTimeout(() => { if (myAns == null && S.phase === 'question') pcSay(pcPick(L.late, 2), 'frown', 3000); }, T - 5000));
  }
  // après ma réponse : un mot neutre (rien sur la justesse)
  const pcAnswered = () => pcSay(now() - S.qAt < (S.q.time * 1000) / 4 ? pcPick(PC_LIVE.fast, 3) : pcPick(PC_LIVE.mine, 4), 'nod', 2200);

  function choose(k) {
    if (!S || S.phase !== 'question' || myAns != null || !S.q.choices || k < 0 || k >= S.q.choices.length) return;
    if (iAmOut()) return;
    myAns = String(k); answer(myAns); sfx.play('lock'); pcAnswered();
    for (const b of root.querySelectorAll('[data-c]')) { b.disabled = true; b.classList.toggle('picked', Number(b.dataset.c) === k); }
    renderJokers();
    const s = $('#sent'); s.hidden = false; s.className = 'sent'; s.innerHTML = `Réponse verrouillée : <b>${S.q.isChartier ? LETTERS[k] + ' · ' : ''}${qText(S.q.choices[k])}</b> · on attend les autres…`;
  }

  // tuiles déjà employées dans l'expression
  function markTiles() {
    const left = ($('#ain').value.match(/\d+/g) || []).map(Number);
    for (const b of root.querySelectorAll('.tile')) {
      const i = left.indexOf(Number(b.dataset.n));
      b.classList.toggle('used', i >= 0); if (i >= 0) left.splice(i, 1);
    }
  }

  function lockInput(v, locked) {
    const s = $('#sent'); if (!s) return;
    const inp = $('#ain');
    if (inp) { inp.disabled = true; $('#asend').disabled = true; $('#aform').classList.add('locked'); }
    for (const b of root.querySelectorAll('[data-c]')) b.disabled = true;
    s.hidden = false;
    s.className = 'sent' + (locked ? ' locked' : '');
    s.innerHTML = locked ? `🔒 Raté ! Tu es bloqué pour cette question.` : `Réponse verrouillée : <b>${esc(S && S.q && S.q.choices ? S.q.choices[Number(v)] ?? v : v)}</b> · on attend les autres…`;
    if (locked) shake();
  }

  function shake() { const c = root.querySelector('.card'); if (!c || !motion()) return; c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
  function burst(node) {
    if (!node || !motion()) return;
    const r = node.getBoundingClientRect();
    const glyphs = isCh() ? ['€', '$', '▲', '%', '★'] : ['★', '✦', '+', '×', '÷'];
    const colors = isCh() ? ['#ffd27a', '#2fbf71', '#e5a93c', '#ffffff', '#7dd3a8'] : ['#ffc531', '#ff4b2b', '#2fbf71', '#2b8cff', '#ff5fa2'];
    for (let k = 0; k < 14; k++) {
      const s = el('i', 'spark', pick(glyphs));
      s.style.left = r.left + r.width / 2 + 'px'; s.style.top = r.top + r.height / 2 + 'px';
      const a = (k / 14) * Math.PI * 2, d = 70 + Math.random() * 60;
      s.style.color = colors[k % 5];
      root.appendChild(s);
      s.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(1.2) rotate(180deg)`, opacity: 0 }],
        { duration: 800 + Math.random() * 300, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => s.remove();
    }
  }
  const pick = (l) => l[Math.floor(Math.random() * l.length)];

  /* ---------------------------------------------------------- révélation */
  function chartierQuote(mine, L, limitMs) {
    let type = !mine || mine.raw == null ? 'timeout' : mine.ok ? (mine.at < limitMs * 0.35 ? 'fast' : 'ok') : mine.tags.includes('trap') ? 'trap' : mine.pts > 0 ? 'partial' : 'ko';
    if (L.final && mine && mine.raw != null && type !== 'trap') type = mine.ok ? 'finalOk' : 'finalKo';
    if (mine && L.eliminated && L.eliminated.some((e) => e.id === me.id)) type = 'out';
    const list = CHARTIER_QUOTES[type], text = list[(S.seed + L.idx * 7) % list.length];
    const label = { fast: 'IMPRESSIONNÉ', ok: 'VALIDÉ', ko: 'RATÉ', trap: 'PIÉGÉ', partial: 'À MOITIÉ', out: 'ÉLIMINÉ', timeout: 'TROP LENT', finalOk: 'OFFRE EN VUE', finalKo: 'RECALÉ' }[type]
      + (mine && mine.pts ? ` · ${mine.pts > 0 ? '+' : ''}${fmt(mine.pts)}` : '') + (mine && mine.lost ? ` · −${'♥'.repeat(mine.lost)}` : '');
    const tone = { fast: 'ok', ok: 'ok', finalOk: 'ok', partial: 'timeout', ko: 'ko', trap: 'ko', out: 'ko', finalKo: 'ko', timeout: 'timeout' }[type];
    return `<div class="chartier-quote quote-${tone}" id="verdict">
        ${pcFace('quote-avatar')}
        <div class="quote-body"><div class="quote-meta"><b>Pierre Chartier</b><span class="quote-status">${label}</span></div>
        <p class="quote-text">« ${esc(text)} »</p></div>
      </div>`;
  }

  // les 4 réponses, la bonne en vert, et qui a choisi quoi
  function candGrid(L) {
    const who = (k) => L.results.filter((r) => r.raw != null && Number(r.raw) === k).map((r) => { const p = S.players.find((x) => x.id === r.id); return p ? `<i class="dot" title="${esc(p.name)}" style="background:${esc(p.color)}"></i>` : ''; }).join('');
    const mine = L.results.find((r) => r.id === me.id), mk = mine && mine.raw != null ? Number(mine.raw) : -1;
    return `<div class="cand-choices rev">${L.choices.map((c, k) => `<div class="cchoice ${k === L.answer ? 'good' : k === mk ? 'bad' : 'dim'}${k === L.trap ? ' trap' : ''}" style="--k:${k}">
        <span class="cl">${k === L.answer ? '✓' : k === mk ? '✗' : LETTERS[k]}</span><span class="ct">${qText(c)}${k === L.trap ? '<em class="trapmark">🪤 le piège</em>' : ''}</span><span class="who">${who(k)}</span></div>`).join('')}</div>`;
  }

  // ce que j'avais coché (question à réponses multiples)
  const myPick = (k) => { const r = S.last && S.last.results.find((x) => x.id === me.id); return !!(r && r.raw != null && String(r.raw).split(',').map(Number).includes(k)); };
  function renderReveal() {
    const L = S.last, cat = CATS[L.cat], mine = L.results.find((r) => r.id === me.id);
    const h = S.history[S.history.length - 1], q = S.q || h;
    const ch = !!L.isChartier;
    if (ch) wallStreetMusic.setMode('reveal');
    const res = L.results.filter((r) => !r.out).sort((a, b) => b.pts - a.pts || (a.at ?? 1e9) - (b.at ?? 1e9));
    const elim = (L.eliminated || []).map((e) => `<div class="elim"><b>${esc(name(e.id))}</b> ${e.why === 'palier' ? `est coupé : dernier à la fin du ${esc((TIER_LABEL[L.tierEnd] || 'tour').toLowerCase())}` : 'n\'a plus de vies'} ${e.why === 'palier' ? '✂️' : '🚪'}</div>`).join('')
      + (L.tierEnd && !(L.eliminated || []).some((e) => e.why === 'palier') && !L.endEarly && L.idx + 1 < S.cfg.len ? `<div class="elim soft">Fin du ${esc((TIER_LABEL[L.tierEnd] || 'tour').toLowerCase())} : tout le monde passe</div>` : '');
    const answerHtml = L.input === 'code' ? `<div class="code-ref"><small>Une solution</small><pre>${highlightCode(L.show, L.lang)}</pre></div>`
      : ch && L.input === 'choice' ? candGrid(L)
      : L.input === 'multi' ? `<div class="multi-choices rev">${L.choices.map((c, k) => { const good = L.answer.includes(k), mine = myPick(k); return `<div class="mchoice ${good ? 'good' : mine ? 'bad' : 'dim'}"><span class="mbox">${good ? '✓' : mine ? '✗' : ''}</span><span class="ct">${qText(c)}</span></div>`; }).join('')}</div>`
      : L.input === 'text' ? `<div class="copybox">${esc(L.show)}</div>`
      : L.input === 'mm' ? `<div class="mm-dice rev">${L.mm.dice.map((d) => `<span class="die shown">${d}</span>`).join('<i>+</i>')}<i>=</i><span class="die sum shown">${L.mm.dice.reduce((a, b) => a + b, 0)}</span></div>${mmDetail(L, mine)}`
      : `<div class="bigans">${qText(L.show)}</div>`;
    const fast = L.results.find((r) => r.tags.includes('eclair') || (S.cfg.mode === 'eclair' && r.pts > 0));
    const recall = q.input === 'expr' ? `${qText(h.text)} 🎯` : q.input === 'choice' ? qText(h.text) : qText(h.eq === false ? h.text.replace(/\?$/, '…').replace(/ \? /, ' … ') : h.text) + (h.eq === false ? '' : ' =');
    const verdict = mine ? `<div class="verdict ${mine.ok ? 'ok' : mine.raw != null ? 'ko' : 'none'}" id="verdict">${mine.ok ? `Bravo ! +${fmt(mine.pts)}` : mine.raw != null ? (mine.pts < 0 ? `Raté… ${fmt(mine.pts)}` : 'Raté…') : 'Pas de réponse'}</div>` : '';

    stage.innerHTML = `
      <div class="card reveal${ch ? ' cand' : ''} flipin" style="--cc:${cat.color}">
        ${fast ? `<div class="buzz">⚡ <b>${esc(name(fast.id))}</b> a dégainé le premier !</div>` : ''}
        ${elim}
        <div class="qhead"><span class="cat"><i>${cat.icon}</i>${esc(ch ? h.rubric || cat.label : cat.label)}</span>${L.final ? '<span class="final">Quitte ou double</span>' : ''}<span class="qnum">${L.idx + 1} / ${S.cfg.len}</span></div>
        ${ch ? '<div class="rv-cols"><div class="rv-l">' : ''}
        ${h.fig ? `<div class="figmini">${figureSvg(h.fig)}</div>` : ''}
        <div class="qrecall">${recall}</div>${L.snippet ? `<pre class="code-snip mini">${highlightCode(L.snippet, L.lang)}</pre>` : ''}
        ${answerHtml}
        ${ch ? '</div><div class="rv-r">' : verdict}
        ${mine && mine.gained ? '<div class="gotlife"><b>♥</b> Trois d\'affilée : tu récupères une vie !</div>' : ''}
        ${mine && mine.power ? `<div class="gotpower">🎁 Nouveau pouvoir : ${POWERS[mine.power].icon} <b>${esc(POWERS[mine.power].label)}</b>${mine.power === 'shield' ? ' (il te protège tout seul)' : ' : lance-le en bas à gauche !'}</div>` : ''}
        ${ch && mine && !mine.out ? chartierQuote(mine, L, (q.time || 20) * 1000) : ''}
        <div class="tip"><b>${ch ? '📊 Le décryptage' : '💡 L\'astuce'}</b>${L.schema ? `<div class="tipfig">${figureSvg(L.schema)}</div>` : ''}${qText(L.tip)}
          ${ch && L.input === 'choice' && L.trap >= 0 && L.trap !== L.answer && L.choices ? `<p class="trapline">🪤 Le piège : « ${qText(L.choices[L.trap])} »</p>` : ''}</div>
        <ol class="results">${res.map((r, k) => {
          const p = S.players.find((x) => x.id === r.id); if (!p) return '';
          const tags = r.tags.map((t) => `<span class="tag t-${t}">${TAGS[t]}${t === 'serie' ? ' ×' + r.streak : ''}${t === 'power' ? ' ' + POWERS[r.power].icon : ''}</span>`).join('')
            + (r.lost ? `<span class="tag t-lost">−${'♥'.repeat(r.lost)}</span>` : '');
          const raw = r.raw == null ? '—' : ch && L.input === 'choice' ? LETTERS[Number(r.raw)] || '?' : qText(describeAnswer({ ...q, input: L.input }, r.raw));
          return `<li class="${r.ok ? 'ok' : r.raw != null ? 'ko' : 'none'}" style="--k:${k}"><i class="dot" style="background:${esc(p.color)}"></i><span class="nm">${esc(p.name)}</span>
            <span class="raw">${raw}</span><span class="tm">${r.at != null ? secs(r.at) : ''}</span>${tags}<b class="gain">${r.pts > 0 ? '+' : ''}${r.pts ? fmt(r.pts) : '0'}</b></li>`;
        }).join('')}</ol>
        ${ch ? '</div></div>' : ''}
        ${S.cfg.sabotage && S.idx + 1 < S.cfg.len ? '<p class="sabhint">⚔️ C\'est le moment de saboter !</p>' : ''}
        <div class="nextbar"><i id="nbar"></i></div>
      </div>`;
    if (mine && !mine.out) {
      sfx.play(mine.ok ? (mine.tags.includes('serie') ? 'streak' : 'ok') : mine.tags.includes('trap') ? 'trap' : mine.raw != null ? 'ko' : 'lock');
      if (mine.ok) setTimeout(() => burst($('#verdict')), 250); else if (mine.raw != null) setTimeout(shake, 200);
      if (mine.power) setTimeout(() => sfx.play('streak'), 700);
    }
  }

  /* ---------------------------------------------------------- compte à rebours */
  // Scène d'ouverture de The Candidate (12 s) : l'ascenseur monte au 40e, les portes s'ouvrent, Pierre Chartier
  // accueille le joueur de sa propre voix (photo en grand pendant qu'il parle), puis les candidats et le compte à rebours
  const PC_VOICE = 'audio/pierre-intro.m4a';
  let opT = [], opVoice = null;
  function renderOpening() {
    const c = S.cfg, M = MODULES[c.module] || MODULES.gen, humans = S.players.filter((p) => !p.bot).length, n = S.players.length;
    // la réplique d'accueil de Pierre Chartier, au nom de chaque joueur
    const meName = (S.players.find((p) => p.id === me.id) || me).name;
    const speech = `Salut ${meName}, Pierre Chartier, X2007, Head of Trading Vol & Hybride, voyons si t'es solide...`;
    stage.innerHTML = `
      <div class="opening">
        <div class="op-lift"><div class="op-panel"><small>Étage</small><b id="opfloor">0</b></div><i class="op-door l"></i><i class="op-door r"></i></div>
        <div class="op-pierre">${pcFace('pc-face huge')}<p class="op-say">${esc(speech)}</p></div>
        <div class="op-cands"><small>${esc(M.label === 'Généraliste' ? 'Poste d\'analyste' : 'Poste : ' + M.job)} · ${n > 1 ? 'les candidats' : 'le candidat'}</small>
          <div class="op-list">${S.players.map((p, k) => `<span class="cu-p" style="--k:${k};--pc:${esc(p.color)}"><i></i>${esc(p.name)}</span>`).join('')}</div>
          <div class="op-rules"><span>${hearts(c.lives, c.lives)} ${c.lives} vies</span>${c.jokers ? '<span>✂️ 📞 2 jokers</span>' : ''}${c.cut ? '<span>✂️ coupe à chaque tour</span>' : ''}${c.duel ? '<span>⚔️ face-à-face final</span>' : ''}</div>
        </div>
        <div class="count" id="count"></div>
      </div>`;
    for (const t of opT.splice(0)) clearTimeout(t);
    const fl = $('#opfloor'); let f = 0;
    const tick = setInterval(() => { f = Math.min(40, f + 1); if (fl) fl.textContent = f; if (f >= 40) clearInterval(tick); }, 58);
    // la voix de Pierre : préchargée tout de suite, lancée quand il apparaît (si le son est activé)
    const voice = new Audio(PC_VOICE); voice.preload = 'auto';
    const face = stage.querySelector('.op-pierre .pc-face');
    opT.push(setTimeout(() => clearInterval(tick), 3000), setTimeout(() => sfx.play('ding'), 2500), setTimeout(() => {
      if (!sfx.on || !stage.querySelector('.opening')) return;
      voice.onplaying = () => { if (face) face.classList.add('speaking'); wallStreetMusic.duck(Math.round((voice.duration || 4.7) * 1000) + 300); };
      voice.onended = () => { if (face) face.classList.remove('speaking'); };
      voice.play().catch(() => {}); // lecture refusée par le navigateur : le texte reste affiché
    }, 3500));
    opVoice = voice;
  }
  function renderIntro() {
    const c = S.cfg;
    const ch = c.mode === 'chartier';
    if (ch) { wallStreetMusic.start(); wallStreetMusic.setMode('intro'); }
    if (ch && staging.on && motion()) return renderOpening();
    if (opVoice) { opVoice.pause(); opVoice = null; }
    stage.innerHTML = `
      <div class="card intro deal">${ch ? pcFace('pc-face big') : ''}<div class="logo-c"><span>${ch ? 'Pierre Chartier présente' : 'Tête de'}</span><b>${ch ? 'The Candidate' : 'Calcul'}</b></div>
      <p>${ch ? 'Ouverture des marchés' : esc(MODES[c.mode].label)} · ${c.len} questions · ${esc(DIFF_LABEL[c.diff])}${c.sabotage ? ' · Sabotage' : ''}</p><div class="count" id="count">3</div></div>`;
  }

  /* ---------------------------------------------------------- podium et récapitulatif */
  function recapHtml() {
    const miss = S.history.map((h) => ({ h, r: h.results.find((x) => x.id === me.id) })).filter(({ r }) => r && !r.ok && !r.out);
    if (!S.players.some((p) => p.id === me.id)) return '';
    if (!miss.length) return '<div class="recap perfect"><b>🌟 Sans faute !</b> Aucune erreur sur toute la partie.</div>';
    return `<details class="recap" open><summary><b>📒 Tes erreurs à revoir</b><span>${miss.length} question${miss.length > 1 ? 's' : ''}</span></summary>
      <ol>${miss.map(({ h, r }) => {
        const c = CATS[h.cat];
        return `<li style="--cc:${c.color}">${h.fig ? `<div class="figmini">${figureSvg(h.fig)}</div>` : ''}<div class="rq"><span class="cat sm"><i>${c.icon}</i>${esc(h.isChartier ? h.rubric || c.label : c.label)}</span><b>${qText(h.text)}</b>${h.sub && h.input !== 'choice' ? `<small>${esc(h.sub)}</small>` : ''}</div>
          <div class="ra"><span class="mine">${r.raw != null ? 'Ta réponse : <s>' + qText(describeAnswer(h, r.raw)) + '</s>' : 'Pas de réponse'}</span><span class="good">${h.input === 'code' ? `Une solution : <pre>${highlightCode(h.show, h.lang)}</pre>` : `Bonne réponse : <b>${qText(h.show)}</b>`}</span></div>
          <div class="rt">${h.schema ? `<div class="tipfig sm">${figureSvg(h.schema)}</div>` : ''}💡 ${qText(h.tip)}</div></li>`;
      }).join('')}</ol></details>`;
  }

  // Le bilan d'entretien : ce que Pierre Chartier retient, rubrique par rubrique, et les notions à revoir
  function bilanHtml() {
    const by = {}, miss = [];
    for (const h of S.history) {
      const r = h.results.find((x) => x.id === me.id);
      if (!r || r.out || h.duel) continue;
      const k = h.rubric || CATS[h.cat].label, b = (by[k] = by[k] || { n: 0, ok: 0 });
      b.n++; if (r.ok) b.ok++; else if (h.tip) miss.push(h);
    }
    const rows = Object.entries(by).filter(([, b]) => b.n >= 1).map(([k, b]) => ({ k, ...b, rate: b.ok / b.n }));
    if (!rows.length) return '';
    const sure = rows.filter((x) => x.n >= 2), pool = sure.length >= 2 ? sure : rows;
    const best = [...pool].sort((a, b) => b.rate - a.rate || b.n - a.n)[0], worst = [...pool].sort((a, b) => a.rate - b.rate || b.n - a.n)[0];
    const lc = (t) => t.charAt(0).toLowerCase() + t.slice(1);
    const say = best.rate === 1 && worst.rate === 1 ? 'Rien à redire : vous avez tout bon, sur tous les sujets.'
      : best === worst || best.rate === worst.rate ? `Un entretien régulier, autour de ${Math.round(best.rate * 100)} % partout. Il faut maintenant creuser l'écart.`
      : `Solide en ${lc(best.k)}${best.rate < 1 ? '' : ' (sans faute)'}, fragile en ${lc(worst.k)}. ${worst.rate === 0 ? 'C\'est là qu\'il faut travailler en priorité.' : 'Révisez ça avant notre prochain entretien.'}`;
    // une notion par question ratée, cinq au plus, une seule fois par rubrique tant que possible
    const seen = new Set(), notes = [];
    for (const h of [...miss.filter((h) => !seen.has(h.rubric) && seen.add(h.rubric)), ...miss]) {
      if (notes.length >= 5 || notes.includes(h)) continue;
      notes.push(h);
    }
    const first = (t) => { const x = String(t).split(/(?<=[.!?])\s/)[0]; return x.length > 140 ? x.slice(0, 137) + '…' : x; };
    return `<div class="bilan"><div class="bilan-say">${pcFace('pc-face sm')}<p>« ${esc(say)} »</p></div>
      <div class="bilan-bars">${rows.sort((a, b) => b.n - a.n).map((x) => `<div class="bb"><span>${esc(x.k)}</span><i><b style="width:${Math.round(x.rate * 100)}%"></b></i><em>${x.ok}/${x.n}</em></div>`).join('')}</div>
      ${notes.length ? `<div class="bilan-notes"><b>📌 À revoir</b><ol>${notes.map((h) => `<li><span>${esc(h.rubric || CATS[h.cat].label)}</span> ${qText(first(h.tip))}</li>`).join('')}</ol></div>` : ''}</div>`;
  }

  // Le verdict final du mode The Candidate, d'après la justesse et la vitesse (indépendant de la longueur de la partie)
  function offerHtml(meP, n) {
    const acc = meP.right / n, avg = meP.right ? meP.totalMs / meP.right / 1000 : 99;
    const alone = S.players.length > 1 && !meP.out && S.players.filter((p) => !p.out).length === 1;
    const O = meP.out ? ['rejected', meP.outWhy === 'palier' ? 'COUPÉ AU PALIER' : 'PLUS DE VIES', `Éliminé à la question ${meP.outIdx + 1}`,
        meP.outWhy === 'palier' ? 'Dernier du classement à la fin du tour : Pierre Chartier ne garde que les meilleurs.' : `Trop d'erreurs${meP.traps ? ` (dont ${meP.traps} piège${meP.traps > 1 ? 's' : ''})` : ''}. Le prochain candidat attend dans le couloir.`]
      : alone ? ['top', 'EMBAUCHÉ', 'Dernier candidat debout', 'Tous les autres sont sortis. Le poste est à toi, Pierre Chartier te tend la main.']
      : acc >= 0.85 && avg < 9 ? ['top', 'OFFRE IMMÉDIATE', 'Managing Director, desk dérivés', 'Rapide, juste, imperturbable. Pierre Chartier signe ton contrat avant la fin de l\'émission.']
      : acc >= 0.7 ? ['mid', 'OFFRE VALIDÉE', 'Associate, trading quantitatif', 'Solide sous la pression. Encore un peu de vitesse et tu passes au niveau supérieur.']
      : acc >= 0.5 ? ['low', 'PÉRIODE D\'ESSAI', 'Analyste M&A junior', 'Le potentiel est là, mais trop d\'hésitations. Six mois pour faire tes preuves.']
      : ['rejected', 'CANDIDATURE REJETÉE', 'Éliminé au premier tour', 'Pas cette fois. Révise tes gammes et reviens tenter ta chance.'];
    return `<div class="verdict-banner offer-${O[0]}">${pcFace('pc-face')}<span class="offer-stamp">${O[1]}</span><h3>${O[2]}</h3>
      <p>${O[3]}</p><p class="offer-stats">${S.cfg.lives && !meP.out ? hearts(meP.lives, S.cfg.lives) + ' · ' : ''}${meP.right}/${n} justes · ${fmt(meP.score)} pts${meP.right ? ' · ' + secs(meP.totalMs / meP.right) + ' par bonne réponse' : ''}</p></div>`;
  }

  function renderOver() {
    closePick();
    const ch = S.cfg.mode === 'chartier';
    // musique des scores : version gagnante pour le premier (et pour les spectateurs), doux-amère sinon
    if (ch) { wallStreetMusic.setMode('over', { win: S.ranking[0] === me.id || !S.players.some((p) => p.id === me.id) }); wallStreetMusic.start(); }

    const rank = S.ranking.map((id) => S.players.find((p) => p.id === id)).filter(Boolean);
    const podium = [rank[1], rank[0], rank[2]];
    const meP = S.players.find((p) => p.id === me.id);
    const myPlace = S.ranking.indexOf(me.id);
    const isHost = !setupS || setupS.hostId === me.id;
    const n = S.history.length || 1;
    // questions jouées par chacun (un éliminé s'arrête avant la fin)
    const played = (p) => S.history.filter((h) => { const r = h.results.find((x) => x.id === p.id); return r && !r.out; }).length || 1;
    const catStats = meP ? Object.entries(meP.byCat).map(([k, v]) => `<span class="chip" style="--cc:${CATS[k].color}"><i>${CATS[k].icon}</i> ${esc(CATS[k].label)} : ${v.ok}/${v.n}</span>`).join('') : '';
    const sab = S.cfg.sabotage;

    // deux colonnes : les scores à gauche, les erreurs à revoir à droite (l'une sous l'autre sur téléphone)
    const recap = recapHtml();
    stage.innerHTML = `
      <div class="card over${ch ? ' cand' : ''}${recap ? ' two' : ''} deal">
        <h1>${ch ? (myPlace === 0 ? (S.players.length > 1 && S.players.filter((p) => !p.out).length === 1 ? '🏆 Dernier candidat debout' : '🏆 Meilleur candidat de la session') : 'Le verdict de Pierre Chartier') : (myPlace === 0 ? '🏆 Champion du calcul !' : myPlace > 0 ? `Tu finis ${myPlace + 1}<sup>e</sup>` : 'Fin de partie')}</h1>
        <div class="over-cols"><div class="over-main">
        ${ch && meP ? offerHtml(meP, played(meP)) + bilanHtml() : ''}
        <div class="podium">${podium.map((p, k) => p ? `<div class="step s${[2, 1, 3][k]}" style="--pc:${esc(p.color)}">
          <div class="who"><i></i><b>${esc(p.name)}</b><span>${fmt(p.score)} pts</span></div><div class="block">${[2, 1, 3][k]}</div></div>` : '<div class="step empty"></div>').join('')}</div>
        <table class="stats"><thead><tr><th>#</th><th>Joueur</th><th>Score</th><th>Justes</th><th>Série max</th><th>Plus rapide</th><th>Temps moyen</th><th>⚡ Premier</th>${sab ? '<th>Sabotages</th>' : ''}${S.cfg.lives ? '<th>Vies</th>' : ''}</tr></thead>
          <tbody>${rank.map((p, k) => `<tr class="${p.id === me.id ? 'me' : ''}"><td>${k + 1}</td><td><i class="dot" style="background:${esc(p.color)}"></i>${esc(p.name)}</td>
            <td><b>${fmt(p.score)}</b></td><td>${p.right}/${played(p)}</td><td>${p.bestStreak}</td><td>${p.fastest != null ? secs(p.fastest) : '—'}</td>
            <td>${p.right ? secs(p.totalMs / p.right) : '—'}</td><td>${p.firsts}</td>${sab ? `<td>${p.sabSent || 0} envoyé${(p.sabSent || 0) > 1 ? 's' : ''} · ${p.sabTaken || 0} reçu${(p.sabTaken || 0) > 1 ? 's' : ''}</td>` : ''}${S.cfg.lives ? `<td class="lives">${p.out ? `${p.outWhy === 'palier' ? '✂️' : '🚪'} Q${p.outIdx + 1}` : hearts(p.lives)}</td>` : ''}</tr>`).join('')}</tbody></table>
        ${catStats && !ch ? `<div class="mycats"><b>Tes catégories</b>${catStats}</div>` : ''}
        ${meP ? `<div class="strip" aria-label="Tes réponses">${S.history.map((h, k) => { const r = h.results.find((x) => x.id === me.id); if (r && r.out) return ''; return `<i class="${r && r.ok ? 'ok' : 'ko'}" style="--k:${k}" title="${esc(h.text)} → ${esc(h.show)}"></i>`; }).join('')}</div>` : ''}
        </div>${recap ? `<aside class="over-side">${recap}</aside>` : ''}</div>
        <div class="row end">${isHost ? '<button class="btn yellow big" id="bAgain">Rejouer</button>' : '<span class="waithost"><i></i>L\'hôte peut relancer une partie</span>'}<button class="btn ghost big" id="bBack">Retour au salon</button></div>
      </div>`;
    const a = $('#bAgain'); if (a) a.onclick = () => start();
    $('#bBack').onclick = () => { wallStreetMusic.stop(); exit(); };
    if (ch && motion()) verdictShow(); else { sfx.play('win'); confetti(); }
  }

  // Le verdict mis en scène : classement dévoilé de la dernière à la première place, puis « Le poste est pour… »,
  // le nom, « EMBAUCHÉ » et la lettre d'offre. Un clic (ou « Passer ») montre tout de suite l'écran des scores.
  function verdictShow() {
    const M = MODULES[S.cfg.module] || MODULES.gen;
    const rank = S.ranking.map((id) => S.players.find((p) => p.id === id)).filter(Boolean);
    const top = rank[0], hired = top && (!top.out || (S.duel && S.duel.winner === top.id)) ? top : null;
    const rows = [...rank].reverse();
    const step = Math.max(600, Math.min(1100, 5200 / Math.max(1, rows.length)));
    const salary = hired ? Math.round((55 + Math.min(45, hired.score / 120) + (S.cfg.module === 'quant' ? 15 : S.cfg.module === 'trading' ? 10 : 0)) / 5) * 5 : 0;
    const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const o = el('div', 'verdict-show');
    const hireAt = 0.9 + rows.length * step / 1000 + 0.4;
    o.innerHTML = `<div class="vs-in" style="--hide:${hireAt - 0.5}s">
        <div class="vs-top"><h2 class="vs-title">Le verdict</h2>
        <ol class="vs-rank">${rows.map((p, k) => { const place = rank.length - k; return `<li style="--d:${0.9 + k * step / 1000}s" class="${p.id === me.id ? 'me' : ''}${p.out ? ' out' : ''}"><b>${place}<sup>${place === 1 ? 'er' : 'e'}</sup></b><i style="background:${esc(p.color)}"></i><span>${esc(p.name)}</span><em>${p.out ? (p.outWhy === 'palier' ? '✂️ coupé' : '🚪 éliminé') : fmt(p.score) + ' pts'}</em></li>`; }).join('')}</ol></div>
        <div class="vs-hire" style="--d:${hireAt}s">
          ${pcFace('pc-face big')}
          <p class="vs-for">${hired ? 'Le poste est pour…' : 'Personne ne décroche le poste aujourd\'hui.'}</p>
          ${hired ? `<b class="vs-name" style="--pc:${esc(hired.color)}">${esc(hired.name)}</b><span class="vs-stamp">EMBAUCHÉ</span>
          <div class="vs-letter"><small>Paris, le ${esc(date)}</small><p>${esc(hired.name)}, nous avons le plaisir de vous proposer le poste de <b>${esc(M.job)}</b>.</p>
            <p>Rémunération fixe : <b>${salary} k€</b> par an, bonus selon performance. Prise de poste : lundi, 7 h 30.</p><p class="sig">Pierre Chartier</p></div>` : ''}
        </div>
        <button class="btn ghost vs-skip">Passer</button>
      </div>`;
    root.appendChild(o);
    const T0 = hireAt * 1000;
    const timers = [setTimeout(() => sfx.play('drum'), Math.max(0, T0 - 2900))];
    rows.forEach((_, k) => timers.push(setTimeout(() => sfx.play('pop'), 900 + k * step)));
    timers.push(setTimeout(() => { sfx.play(hired ? 'win' : 'ko'); if (hired) { sfx.play('gong'); confetti(); } }, T0 + 1300));
    const close = () => { for (const t of timers) clearTimeout(t); o.classList.add('gone'); setTimeout(() => o.remove(), 400); };
    o.querySelector('.vs-skip').onclick = (e) => { e.stopPropagation(); close(); };
    o.onclick = close;
    timers.push(setTimeout(close, T0 + 7500));
  }

  function confetti() {
    if (!motion()) return;
    const box = el('div', 'confetti');
    const colors = ['#ff4b2b', '#ffc531', '#2b8cff', '#2fbf71', '#ff5fa2', '#fff8ea'];
    for (let k = 0; k < 90; k++) {
      const c = el('i'); c.style.left = Math.random() * 100 + '%'; c.style.background = colors[k % colors.length];
      c.style.animationDelay = Math.random() * 0.8 + 's'; c.style.animationDuration = 2 + Math.random() * 2 + 's';
      c.style.transform = `rotate(${Math.random() * 360}deg)`; box.appendChild(c);
    }
    root.appendChild(box); setTimeout(() => box.remove(), 5000);
  }

  /* ---------------------------------------------------------- transitions entre deux étapes */
  // Jouées pendant la dernière seconde de la correction : la question suivante démarre à l'heure, sans temps perdu
  // une fois son animation finie, l'élément redevient invisible (sinon son flou d'arrière-plan resterait à l'écran)
  const endAfter = (o, cls, ms) => { clearTimeout(o._end); o._end = setTimeout(() => o.classList.remove(cls), ms + 100); };
  function showInter(kick, title, sub, tone) {
    const o = $('#inter'); if (!o || !motion()) return;
    $('#ikick').textContent = kick; $('#ititle').textContent = title; $('#isub').textContent = sub || '';
    o.className = 'inter ' + (tone || ''); void o.offsetWidth; o.classList.add('show'); endAfter(o, 'show', INTER_MS);
    sfx.play(tone === 'tier' || tone === 'final' ? 'sab' : 'pop');
  }
  // The Candidate, entre deux tours : lumières qui baissent, projecteur, les survivants, Pierre Chartier, puis le nom du tour
  function tierScene() {
    const o = $('#curtain'), L = S.last;
    if (!o || !motion() || !L) return nextInter();
    const d = Math.max(0, DIFFS.indexOf(S.cfg.diff)), tier = chartierTier(d, S.idx + 1, S.cfg.len);
    const gone = new Set((L.eliminated || []).map((e) => e.id));
    const ppl = S.players.filter((p) => !p.out || gone.has(p.id)).sort((a, b) => (gone.has(a.id) - gone.has(b.id)) || b.score - a.score);
    $('#cuend').textContent = `Fin du ${(TIER_LABEL[L.tierEnd] || 'tour').toLowerCase()}`;
    $('#cuppl').innerHTML = ppl.map((p, k) => `<span class="cu-p${gone.has(p.id) ? ' gone' : ''}${p.id === me.id ? ' me' : ''}" style="--k:${k};--pc:${esc(p.color)}"><i></i>${esc(p.name)}<b>${gone.has(p.id) ? '✂️' : fmt(p.score)}</b></span>`).join('');
    const quotes = TIER_QUOTES[tier] || TIER_QUOTES[3];
    $('#cuquote').textContent = `« ${quotes[(S.seed + S.idx) % quotes.length]} »`;
    $('#custars').textContent = '★'.repeat(tier);
    $('#cutitle').textContent = TIER_LABEL[tier];
    const alive = S.players.filter((p) => !p.out).length;
    $('#cusub').textContent = `${alive} candidat${alive > 1 ? 's' : ''} encore en lice · ${tier * 100} pts la question`;
    o.classList.remove('play'); void o.offsetWidth; o.classList.add('play'); endAfter(o, 'play', TIER_SHOW_MS);
    // le roulement monte pendant que Pierre Chartier parle, le gong tombe avec le nom du tour
    setTimeout(() => sfx.play('drum'), 4000);
    setTimeout(() => { sfx.play('gong'); wallStreetMusic.sting(); }, 6900);
  }
  // Annonces au centre de l'écran, chacune son tour : les éliminations, puis la vie regagnée (le temps est prévu par l'hôte)
  function announce(icon, title, sub, tone, sound) {
    const o = $('#announce'); if (!o) return;
    $('#anicon').textContent = icon; $('#antitle').textContent = title; $('#ansub').textContent = sub;
    o.className = 'announce ' + tone; void o.offsetWidth; o.classList.add('show'); endAfter(o, 'show', ANNOUNCE_MS);
    if (sound) sfx.play(sound);
  }
  function planAnnounces(state) {
    for (const t of annT.splice(0)) clearTimeout(t);
    const L = state.last; if (!L) return;
    const list = (L.eliminated || []).map((e) => e.id === me.id
      ? [e.why === 'palier' ? '✂️' : '🚪', 'Ton entretien s\'arrête là', e.why === 'palier' ? `Dernier du classement à la fin du ${(TIER_LABEL[L.tierEnd] || 'tour').toLowerCase()}` : 'Plus aucune vie', 'bad', 'elim']
      : [e.why === 'palier' ? '✂️' : '🚪', `${name(e.id)} quitte l'entretien`, e.why === 'palier' ? `Dernier du classement à la fin du ${(TIER_LABEL[L.tierEnd] || 'tour').toLowerCase()}` : 'Plus aucune vie', 'out', e.why === 'palier' ? 'cut' : 'elim']);
    if (L.duel) {
      const d = L.duel;
      if (d.winner != null) list.push(['⚔️', `${name(d.winner)} remporte le face-à-face`, d.why === 'juste' ? 'La première bonne réponse' : d.why === 'faux' ? `Première mauvaise réponse : ${name(d.by)}` : 'Le meilleur score départage', d.winner === me.id ? 'life' : 'out', d.winner === me.id ? 'life' : 'cut']);
      else list.push(['⚔️', 'Personne ne tranche', 'On continue, toujours en mort subite', 'out', 'pop']);
    }
    const mine = L.results.find((r) => r.id === me.id);
    if (mine && mine.gained) list.push(['♥', 'Une vie de plus !', 'Trois bonnes réponses d\'affilée', 'life', 'life']);
    // la correction s'affiche d'abord, puis les annonces défilent, une par une
    list.forEach((a, k) => annT.push(setTimeout(() => { if (S && S.phase === 'reveal') announce(...a); }, 1600 + k * ANNOUNCE_MS)));
  }
  // annonce du face-à-face : même mise en scène qu'un changement de tour
  function duelScene(ids) {
    const o = $('#curtain'); if (!o || !motion()) return showInter('Fin de l\'entretien', '⚔️ Face-à-face', `${name(ids[0])} contre ${name(ids[1])}`, 'final');
    const [a, b] = ids.map((id) => S.players.find((p) => p.id === id));
    $('#cuend').textContent = 'Fin de l\'entretien';
    $('#cuppl').innerHTML = `<span class="cu-p" style="--k:0;--pc:${esc(a.color)}"><i></i>${esc(a.name)}<b>${fmt(a.score)}</b></span><span class="cu-vs">⚔️</span><span class="cu-p" style="--k:2;--pc:${esc(b.color)}"><i></i>${esc(b.name)}<b>${fmt(b.score)}</b></span>`;
    const rule = 'Mort subite : la première bonne réponse gagne, la première erreur perd. Le vainqueur aura le poste.';
    $('#cuquote').textContent = `« ${rule} »`;
    $('#custars').textContent = '⚔️'; $('#cutitle').textContent = 'Face-à-face'; $('#cusub').textContent = `${a.name} contre ${b.name}`;
    o.classList.remove('play'); void o.offsetWidth; o.classList.add('play'); endAfter(o, 'play', DUEL_SHOW_MS);
    setTimeout(() => sfx.play('drum'), 4000);
    setTimeout(() => { sfx.play('gong'); wallStreetMusic.sting(); }, 6900);
  }
  function nextInter() {
    const n = S.idx + 1, ch = S.cfg.mode === 'chartier';
    if (duelOn()) return showInter('⚔️ Face-à-face', 'Mort subite', `Question ${S.duel.k + 1} sur 5 au plus`, 'final');
    if (n >= S.cfg.len || (S.last && S.last.endEarly)) return showInter(ch ? 'Fin de l\'entretien' : 'Fin de la partie', ch ? 'Le verdict' : 'Les résultats', '', 'end');
    const cat = CATS[S.cats && S.cats[n]] || null, final = S.cfg.finale && n === S.cfg.len - 1;
    const d = Math.max(0, DIFFS.indexOf(S.cfg.diff)), tier = ch ? chartierTier(d, n, S.cfg.len) : 0;
    const newTier = ch && n > 0 && tier !== chartierTier(d, n - 1, S.cfg.len);
    if (final) return showInter(`Question ${n + 1} / ${S.cfg.len}`, 'Quitte ou double', 'Les points comptent double', 'final');
    if (newTier) return showInter(`${'★'.repeat(tier)} Nouveau tour`, TIER_LABEL[tier], `Question ${n + 1} / ${S.cfg.len}`, 'tier');
    // The Candidate : on annonce le tour (ou l'épreuve de code, le cas pratique, la relance, le market making) ; ailleurs, la catégorie
    const special = ch && { case: S.cats[n - 1] === 'case' ? null : ['📁 Cas pratique', 'Trois questions sur un même dossier'], relance: S.cats[n - 1] === 'relance' ? ['↻ Pierre relance', 'Et si… ? Bonus, sans vie en jeu'] : null, mm: ['⇅ Market making', 'Fais un prix sur la somme de trois dés'] }[S.cats[n]];
    if (special) return showInter(`Question ${n + 1} / ${S.cfg.len}`, special[0], special[1], 'tier');
    if (ch) return showInter(`Question ${n + 1} / ${S.cfg.len}`, S.cats[n] === 'code' ? '⌨ Épreuve de code' : TIER_LABEL[tier], S.cats[n] === 'code' ? `2 minutes, en ${S.cfg.code !== false && S.cfg.sql !== false ? 'Python ou en SQL' : S.cfg.sql !== false ? 'SQL' : 'Python'}` : '★'.repeat(tier), S.cats[n] === 'code' ? 'tier' : '');
    showInter(`Question ${n + 1} / ${S.cfg.len}`, cat ? `${cat.icon} ${cat.label}` : 'Question suivante', '', '');
  }

  /* ---------------------------------------------------------- horloge : barre de temps, compte à rebours */
  function frame() {
    requestAnimationFrame(frame);
    if (!S) return;
    if (S.phase === 'question' && S.q) {
      const bar = $('#tbar'), sec = $('#tsec'); if (!bar) return;
      const left = myDeadline() - now();
      const k = Math.max(0, Math.min(1, left / (S.q.time * 1000)));
      bar.style.transform = `scaleX(${k})`;
      const hurry = left < 5000 && myAns == null;
      $('#timer').classList.toggle('hurry', hurry);
      const qt = root.querySelector('.qtext'); if (qt) qt.classList.toggle('hurry', left < 3000 && myAns == null);
      const s = Math.max(0, Math.ceil(left / 1000));
      sec.textContent = s + ' s';
      if (myAns == null && s <= 3 && s > 0 && s !== lastTick) { lastTick = s; sfx.play('tick'); }
      if (S.q.isChartier) wallStreetMusic.setTension(1 - k);
      if (left <= 0 && myAns == null && !root.querySelector('.sent:not([hidden])')) {
        const st = $('#sent'); if (st) { st.hidden = false; st.className = 'sent locked'; st.textContent = '⏰ Temps écoulé !'; }
        for (const b of root.querySelectorAll('[data-c], #ain, #asend, #csend, #ctest, [data-jok]')) b.disabled = true;
        const ed = $('#code'); if (ed) ed.readOnly = true;
      }
    } else if (S.phase === 'intro') {
      const c = $('#count'); if (!c) return;
      // le compte à rebours ne démarre qu'aux trois dernières secondes (The Candidate a une ouverture plus longue)
      const s = Math.ceil((S.endsAt - now()) / 1000), txt = s > 3 ? '' : s > 0 ? String(s) : 'Go !';
      if (!txt) return;
      if (c.textContent !== txt) { c.textContent = txt; c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse'); sfx.play(s > 0 ? 'count' : 'go'); }
    } else if (S.phase === 'reveal') {
      const b = $('#nbar'); if (b) b.style.transform = `scaleX(${Math.max(0, Math.min(1, (S.endsAt - now()) / (S.revealMs || 5200)))})`;
    }
  }
  requestAnimationFrame(frame);

  // raccourcis : 1 / 2 (ou V / F) pour les choix, 1-4 ou A-D pour The Candidate, R pour réagir, Échap pour fermer
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { toggleEmo(false); closePick(); }
    const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (typing) return;
    if (S && S.phase === 'question' && S.q && S.q.input === 'choice') {
      if (S.q.isChartier) {
        const k = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(e.key.toLowerCase());
        if (e.key.length === 1 && k >= 0) { choose(k); return; }
      } else {
        const vf = S.q.choices[0] === 'Vrai';
        const k = e.key === '1' || (vf && /^v$/i.test(e.key)) ? 0 : e.key === '2' || (vf && /^f$/i.test(e.key)) ? 1 : -1;
        if (k >= 0) { choose(k); return; }
      }
    }
    if (e.key === 'r' || e.key === 'R') toggleEmo();
  });

  return {
    setup(s) {
      if (S && S.phase !== 'over') return;
      if (!S) renderSetup(s);
      else setupS = s;
    },
    update(state, off) {
      offset = off || 0;
      const prev = S; S = state;
      root.classList.remove('noroster');
      const isChartier = state.cfg.mode === 'chartier';
      root.classList.toggle('mode-chartier', isChartier);
      // décor du tour : open space, salle de marché, salle du conseil (il change pendant la scène de passage)
      const tierNow = state.phase === 'question' && state.q ? state.q.tier : state.phase === 'reveal' && state.last ? state.last.tier : state.phase === 'over' ? 3 : 1;
      for (const k of [1, 2, 3]) root.classList.toggle('scene-' + k, isChartier && tierNow === k);
      $('#tmus').hidden = !isChartier; $('#tshow').hidden = !isChartier;
      $('#ibrand').textContent = isChartier ? 'The Candidate' : 'Tête de Calcul';
      if (!isChartier) wallStreetMusic.stop();
      // quelqu'un d'autre vient de répondre : Pierre le fait remarquer (une fois par question)
      if (state.phase === 'question' && prev && prev.phase === 'question' && prev.idx === state.idx) {
        const before = Object.keys(prev.answers || {}).length, other = Object.keys(state.answers || {}).find((id) => +id !== me.id && !(prev.answers || {})[id]);
        if (other != null && before === 0 && myAns == null) pcSay(`${name(+other)} a déjà répondu.`, 'tap', 2200);
      }
      // l'épreuve de code arrive : Python se télécharge en arrière-plan dès le début de la partie
      if (!pyAsked && state.cats && state.cats.includes('code') && state.phase !== 'over') { pyAsked = true; setTimeout(preloadPython, 1500); }
      const k = state.phase + ':' + state.idx;
      const modeLabel = MODES[state.cfg.mode] ? MODES[state.cfg.mode].label : state.cfg.mode;
      const round = state.phase === 'over' ? 'Terminé' : state.idx >= 0 ? `Question ${state.idx + 1} / ${state.cfg.len}${isChartier ? '' : ' · ' + modeLabel}` : isChartier ? 'Entretien' : modeLabel;
      $('#round').textContent = round;
      if (k !== key) {
        key = k;
        if (state.phase === 'intro') { shown = {}; sabSeen = -1; interFor = -2; $('#roster').innerHTML = ''; renderIntro(); }
        else if (state.phase === 'question') renderQuestion();
        else if (state.phase === 'reveal') {
          renderReveal();
          // la transition démarre une seconde avant la question suivante (minuteur : elle part même onglet en arrière-plan)
          clearTimeout(interT);
          // fin d'un tour de The Candidate : la grande mise en scène, sinon le bandeau habituel
          const L = state.last, duelNext = !!(L && L.duelNext);
          const scene = state.cfg.mode === 'chartier' && L && !duelNext && L.tierEnd && !L.endEarly && state.idx + 1 < state.cfg.len;
          interT = setTimeout(() => { if (S && S.phase === 'reveal' && interFor !== S.idx) { interFor = S.idx; if (duelNext) duelScene(L.duelNext); else if (scene) tierScene(); else nextInter(); } },
            Math.max(0, state.endsAt - now() - (duelNext ? DUEL_SHOW_MS : scene ? TIER_SHOW_MS : INTER_MS)));
          planAnnounces(state);
        }
        else if (state.phase === 'over') renderOver();
      } else if (state.phase === 'question' && prev && prev.qAt !== state.qAt) renderQuestion(); // question relancée (nouvel hôte)
      renderRoster();
      renderTicker();
      renderJokers();
      // sabotages lancés depuis la dernière mise à jour (pas ceux d'avant notre arrivée)
      const sabs = state.sabs || [];
      if (sabSeen < 0) sabSeen = state.phase === 'intro' ? 0 : sabs.length;
      for (const e of sabs.slice(sabSeen)) playSabotage(e);
      sabSeen = sabs.length;
    },
    ack(m) { if (S && m.i === S.idx && m.locked) { lockInput(myAns, true); sfx.play('ko'); } },
    // réponses privées de l'hôte : joker, correction de mon code
    note(m) { if (m.t === 'jok') applyJoker(m); else if (m.t === 'graded') codeGraded(m); },
    error(msg, soft) {
      // saisie illisible : le joueur peut corriger
      if (soft && S && S.phase === 'question') {
        myAns = null;
        const i = $('#ain'); if (i) { i.disabled = false; $('#asend').disabled = false; $('#aform').classList.remove('locked'); $('#sent').hidden = true; i.focus(); }
        for (const b of root.querySelectorAll('[data-c]:not(.gone), .btn-choice')) { b.disabled = false; b.classList.remove('picked', 'selected'); }
        const ed = $('#code'); if (ed) { ed.readOnly = false; $('#csend').disabled = false; $('#ctest').disabled = false; $('#sent').hidden = true; }
        renderJokers();
      }
      toast(msg);
    },
    toast,
    emote: showEmote,
  };
}
