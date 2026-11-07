// The Backrooms - Logique applicative principale, entrées clavier/souris et boucle de jeu
import { BackroomsSim, DT, DEPART_T, PIPES_LEVEL, staminaMax } from './engine/sim.js';
import { hasLineOfSight } from './engine/nav.js';
import { createBackroomsScene, setMonsterMode, setSceneOptions } from './view/scene.js';
import { BackroomsSfx } from './view/sfx.js';
import { createVoice } from './view/voice.js';
import { BackroomsHUD, levelName, levelSub, LORE, loreOf, hearTape, tapesHeard, store } from './view/hud.js';

const H = window.HubBridge;
const stageEl = document.getElementById('stage');
const hudEl = document.getElementById('hud');

let sim = null;
let scene = null;
let sfx = null;
let hud = null;
let stepDist = 0;
let monsterStepT = 0;
const goatHoofT = []; // Level 2 : le prochain coup de sabot de chaque chèvre
let goatBellT = 0; // la cloche du bouc alpha
let goatHint = false; // le conseil « elles craignent la lumière », une fois par partie
const goatHoofN = [];
let deathNear = false; // le son de la mort a été joué (il revient quand l'entité s'est éloignée)
// le bilan de la bande (ce qu'elle a vu de toi), tenu sur cet écran ; les dernières secondes pour le rejeu de la mort
let runStats = { seen: 0, rushes: 0, escapes: 0, closest: Infinity, haunts: 0 };
let tapeFrames = [];
let replayed = false;
let echoT = 0; // fausse alerte : quelqu'un marche derrière toi, à ton rythme
let hauntAt = 0; // spectateur : quand on pourra de nouveau faire un signe (sur cet écran)
// Carte du jour : la même graine pour tout le monde, ce jour-là
const dailyOf = (d = new Date()) => {
  const k = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return { seed: (Math.imul(k, 2654435761) >>> 0) % 100000, key: String(k), label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) };
};
let dailyLabel = null;
// difficulté adaptative (hôte ou seul) : 0 à 1, 0,5 au départ
const SKILL_KEY = 'backrooms_skill';
const nudgeSkill = (d) => store.set(SKILL_KEY, Math.max(0, Math.min(1, (+store.get(SKILL_KEY, 0.5) || 0.5) + d)));
const otherStepT = new Map(); // prochain pas de chaque autre joueur
let heartShown = 0; // battements par minute du cœur (0 : on ne l'entend pas)
let valveSound = false; // une vanne grince sous nos mains
let crouchShown = false;

// Réseau : l'hôte fait tourner la partie et envoie un instantané ~20 fois par seconde ; un invité se déplace chez lui
// (pour que ça réponde tout de suite), envoie ses commandes et reçoit tout le reste de l'hôte.
const NET = {
  role: 'solo', // 'solo' | 'host' | 'guest'
  myId: 0,
  run: 0,
  tick: 0,
  inputs: {}, // hôte : dernières commandes de chaque invité
  actions: {}, // hôte : lampe et objets demandés par chaque invité, en attente du prochain pas
  events: [], // hôte : événements à envoyer aux invités
  lastHost: 0, // invité : dernier message de l'hôte
};
const multi = () => NET.role !== 'solo' && sim && sim.players.length > 1;
const send = (to, m, vol) => H && H.embedded && H.send(to, m, vol ? { volatile: true } : undefined);

// Gestion des touches du clavier
// Mode sans souris (comme Mystère Mystère) : ZQSD pour marcher, les flèches tournent la vue, Échap ou P met en pause.
const TURN = 2.2; // vitesse de la vue aux flèches (rad/s)
const TILT = 1.4;
const keys = {};
let mouseDx = 0;
let mouseDy = 0;
let isPointerLocked = false;
// la page n'a pas droit au verrouillage de la souris (aperçu intégré, iframe sans permission) : on regarde autour de soi
// en glissant, bouton enfoncé
let noLock = false;
let toggleFlashlightRequested = false; // touche 1 : la lampe
let useRequested = null; // (tests) une case d'objet précise à utiliser
// actions du prochain pas : E utilise la case choisie, F ramasse, T siffle
const act = { use: false, pick: false, whistle: false, jump: false, struggle: 0 };
let crouchOn = false; // C : s'accroupir / se relever (bascule)
let camOn = false; // V : sortir / ranger le caméscope
let airborne = false; // en plein saut (pour le bruit de la réception)
let selRequested = 0; // touches 2 et 3 : choisir la case d'objet (1 ou 2)
let kbMode = false;
let paused = true; // la partie attend qu'on prenne le contrôle
let started = false; // la première prise en main (avant : l'écran titre)
let padCrouch = false; // accroupi à la manette (stick droit enfoncé : bascule)

// Réglages du joueur (sur cet appareil) : souris, image, accessibilité
const OPT_DEFAULT = { sens: 1, invertY: false, fov: 72, motion: 1, bright: 1, reduceFlashes: false, subs: false, layout: 'auto', quality: 'auto', mic: 'on', voiceVol: 1 };
const OPTS = { ...OPT_DEFAULT, ...store.get('backrooms_opts', {}) };
// anciens réglages : « appuyer pour parler » et « micro ouvert » ne font plus qu'un (la voix de proximité est toujours ouverte)
if (OPTS.mic !== 'off') OPTS.mic = 'on';
let detectedQwerty = false;
const qwerty = () => OPTS.layout === 'qwerty' || (OPTS.layout === 'auto' && detectedQwerty);
function applyOpts() {
  setSceneOptions({ fov: OPTS.fov, motion: OPTS.motion, brightness: OPTS.bright, reduceFlashes: OPTS.reduceFlashes, quality: OPTS.quality });
  if (hud) {
    hud.qwerty = qwerty();
    hud.reduceFlashes = OPTS.reduceFlashes;
    hud.calibrate(OPTS.bright, true);
    if (paused) hud.showPause(true, kbMode, !started, resumeLevel());
  }
  if (sfx) sfx.onCaption = OPTS.subs ? (text, dir) => hud && hud.caption(text, dir) : null;
  if (voice) voice.setVolume(OPTS.voiceVol);
}

// Voix de proximité (toujours ouverte, sans touche) et talkie-walkie (R maintenu) : WebRTC entre joueurs, signalisation par le salon (view/voice.js)
let voice = null;
let micWarned = false;
const sfxRef = { get ctx() { return sfx && sfx.ctx; }, get verb() { return sfx && sfx.verb; }, get level() { return sfx ? sfx.roomLevel || 0 : 0; }, moveTo: (...a) => sfx && sfx.moveTo(...a), caption: (...a) => sfx && sfx.caption(...a) };
function ensureVoice() {
  if (!voice) {
    voice = createVoice({ send: (to, m) => send(to, m), myId: NET.myId, sfx: sfxRef });
    voice.setVolume(OPTS.voiceVol);
  }
  return voice;
}
// le micro : demandé au lancement à plusieurs (seul, il n'y a personne à qui parler), sinon à la première touche R
function askMic(force = false) {
  if (OPTS.mic === 'off') return;
  if (!force && !multi()) return;
  const v = ensureVoice();
  if (v.micState === 'on' || v.micState === 'asking') return;
  v.enableMic().then((ok) => {
    if (!ok && !micWarned && hud) {
      micWarned = true;
      hud.toast('Microphone blocked · no voice chat, no radio');
    }
  });
}
function setOpt(k, v) {
  OPTS[k] = v;
  store.set('backrooms_opts', OPTS);
  applyOpts();
  if (k === 'bright' && hud && hud.calibrate) hud.calibrate(v);
}
// la disposition du clavier, quand le navigateur la donne (pour afficher ZQSD ou WASD)
try {
  navigator.keyboard?.getLayoutMap?.().then((m) => {
    detectedQwerty = m.get('KeyQ') === 'q';
    applyOpts();
  }).catch(() => {});
} catch (e) {}
// seul, on peut reprendre au dernier niveau atteint
const resumeLevel = () => (NET.role === 'solo' && sim && sim.level === 0 && !started ? store.get('backrooms_resume', 0) || null : null);
try {
  kbMode = localStorage.getItem('backrooms_kb') === '1';
} catch (e) {}

function setPaused(on) {
  paused = on;
  if (!on) started = true;
  if (on) for (const k in keys) keys[k] = false;
  if (hud) hud.showPause(on, kbMode, !started, resumeLevel());
  // seul, la pause fige l'image comme un magnétoscope
  if (scene && scene.freeze) scene.freeze(on && started && !multi() && sim && sim.state === 'playing');
  if (sfx && started && on && !multi() && sim && sim.state === 'playing') sfx.tapeStop();
}

function play() {
  if (sfx) sfx.unlock();
  askMic();
  const tactile = document.body.classList.contains('touch') || matchMedia('(pointer: coarse)').matches;
  if (tactile) document.body.classList.add('touch');
  if (kbMode || tactile) setPaused(false);
  else {
    // en mode « glisser », on retente quand même de verrouiller la souris à chaque clic : si ça passe, on en sort
    if (noLock) setPaused(false);
    try {
      const p = stageEl.requestPointerLock?.();
      if (p && p.catch) p.catch(lockRefused);
    } catch (e) {
      lockRefused();
    }
  }
}

// Le navigateur refuse de reverrouiller la souris pendant ~1 s après Échap : ce refus-là est passager (on reste en
// pause, un nouveau clic suffit). On ne passe à « cliquer-glisser pour regarder » que si le verrou est vraiment
// impossible (refusé deux fois hors de ce délai).
let lockExitAt = 0;
let lockFails = 0;
function lockRefused() {
  if (noLock) return;
  if (performance.now() - lockExitAt < 1800) {
    if (hud) hud.toast('Click again to look around');
    return;
  }
  if (++lockFails < 2) {
    if (hud) hud.toast('Click again to look around');
    return;
  }
  noLock = true;
  setPaused(false);
  if (hud) hud.toast('Mouse look: hold the click and drag · Esc to pause');
}
document.addEventListener('pointerlockerror', lockRefused);

function setKbMode(on) {
  kbMode = on;
  for (const k in keys) keys[k] = false;
  try {
    localStorage.setItem('backrooms_kb', on ? '1' : '0');
  } catch (e) {}
  if (on && document.pointerLockElement) document.exitPointerLock();
  if (hud) hud.showPause(paused, kbMode);
}

// V : sortir ou ranger le caméscope (image 4:3, signal des objectifs, mode nuit)
function toggleCam() {
  if (!sim || sim.player.status !== 'alive') return;
  camOn = !camOn;
  if (sfx) sfx.camcorder(camOn);
  // on ressort le caméscope au zoom de base
  camZoom = CAM_ZOOM_MIN;
  if (scene && scene.setCamZoom) scene.setCamZoom(camZoom);
}

// molette, caméscope sorti : le zoom de l'objectif (de ×1,5 à ×4), avec son petit moteur
const CAM_ZOOM_MIN = 1.5;
const CAM_ZOOM_MAX = 4;
let camZoom = CAM_ZOOM_MIN;
window.addEventListener(
  'wheel',
  (e) => {
    if (!camOn || paused || !sim || sim.player.status !== 'alive') return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const z = Math.min(CAM_ZOOM_MAX, Math.max(CAM_ZOOM_MIN, camZoom * (dir > 0 ? 1.12 : 1 / 1.12)));
    if (Math.abs(z - camZoom) < 1e-3) return;
    camZoom = z;
    if (scene && scene.setCamZoom) scene.setCamZoom(camZoom);
    if (sfx) sfx.camZoom(dir);
  },
  { passive: false }
);

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (sfx) sfx.unlock();
  // spectateur : Espace ou les flèches changent le joueur regardé
  if (!paused && sim && sim.player.status !== 'alive' && ['Space', 'ArrowLeft', 'ArrowRight'].includes(e.code) && !e.repeat) {
    sim.spectate = (sim.spectate || 0) + (e.code === 'ArrowLeft' ? -1 : 1);
  }
  if (paused) {
    if (kbMode && (e.code === 'Enter' || e.code === 'Space')) play();
    return;
  }
  keys[e.code] = true;
  // agrippé : n'importe quelle touche sert à se débattre
  if (sim && sim.player.grabT > 0 && !e.repeat) {
    act.struggle++;
    return;
  }
  // 1 : allumer / éteindre la lampe ; 2, 3 : choisir une case d'objet ; E : l'utiliser ; F : ramasser, ou se cacher
  // dans un casier ; T : siffler ; C : s'accroupir (bascule) ; Espace : sauter (accroupi : se relever)
  const slot = ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code);
  if (slot >= 0 && !e.repeat) useSlot(slot % 3);
  if (!e.repeat) {
    if (e.code === 'KeyE') act.use = true;
    else if (e.code === 'KeyF') act.pick = true;
    else if (e.code === 'KeyT') act.whistle = true;
    else if (e.code === 'KeyC' && sim && sim.player.status === 'alive') crouchOn = !crouchOn;
    else if (e.code === 'KeyV') toggleCam();
    else if (e.code === 'Space' && sim && sim.player.status === 'alive') {
      if (crouchOn) crouchOn = false;
      else act.jump = true;
    }
    else if (e.code === 'KeyR') {
      askMic(true);
      if (!multi() && hud) hud.toast('The radio only hisses · no one else is out there');
    }
  }
  if ((kbMode || noLock) && (e.code === 'Escape' || e.code === 'KeyP')) setPaused(true);
});

window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
});

// Tactile : glisser à gauche pour marcher (joystick), à droite pour regarder ; boutons Courir et Lampe
const touch = { move: null, look: null, run: false, crouch: false };
const touchBtns = document.createElement('div');
touchBtns.className = 'touch-btns';
touchBtns.innerHTML = '<button data-t="run">🏃<small>Run</small></button><button data-t="crouch">⤓<small>Crouch</small></button><button data-t="pick">✋<small>Pick up</small></button><button data-t="use">⚙<small>Use</small></button><button data-t="whistle">📣<small>Whistle</small></button><button data-t="jump">⤒<small>Jump</small></button><button data-t="cam">📹<small>Camera</small></button>';
document.body.appendChild(touchBtns);
const stick = document.createElement('div');
stick.className = 'touch-stick';
stick.hidden = true;
stick.innerHTML = '<i></i>';
document.body.appendChild(stick);
for (const b of touchBtns.querySelectorAll('button')) {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (sim && sim.player.grabT > 0) act.struggle++;
    else if (b.dataset.t === 'run') touch.run = true;
    else if (b.dataset.t === 'crouch') touch.crouch = !touch.crouch;
    else if (b.dataset.t === 'cam') toggleCam();
    else act[b.dataset.t] = true;
    b.classList.add('on');
  });
  const up = () => {
    if (b.dataset.t === 'run') touch.run = false;
    if (b.dataset.t !== 'crouch' || !touch.crouch) b.classList.remove('on');
  };
  b.addEventListener('pointerup', up);
  b.addEventListener('pointerleave', up);
  b.addEventListener('pointercancel', up);
}
stageEl.addEventListener('pointerdown', (e) => {
  if (sim && sim.player.grabT > 0 && !paused) act.struggle++;
  if (e.pointerType !== 'touch') return;
  document.body.classList.add('touch');
  if (sfx) sfx.unlock();
  if (paused) setPaused(false);
  if (e.clientX < innerWidth * 0.45 && !touch.move) {
    touch.move = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    stick.hidden = false;
    stick.style.left = e.clientX + 'px';
    stick.style.top = e.clientY + 'px';
  } else if (!touch.look) touch.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  try { stageEl.setPointerCapture(e.pointerId); } catch (err) {}
});
stageEl.addEventListener('pointermove', (e) => {
  const m = touch.move;
  const l = touch.look;
  if (m && m.id === e.pointerId) {
    m.x = e.clientX;
    m.y = e.clientY;
    const dx = m.x - m.ox;
    const dy = m.y - m.oy;
    const d = Math.min(1, Math.hypot(dx, dy) / 60) * 60;
    const a = Math.atan2(dy, dx);
    stick.firstChild.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px)`;
  }
  if (l && l.id === e.pointerId) {
    mouseDx += (e.clientX - l.x) * 2.2;
    mouseDy += (e.clientY - l.y) * 2.2;
    l.x = e.clientX;
    l.y = e.clientY;
  }
});
const touchEnd = (e) => {
  if (touch.move && touch.move.id === e.pointerId) {
    touch.move = null;
    stick.hidden = true;
    stick.firstChild.style.transform = '';
  }
  if (touch.look && touch.look.id === e.pointerId) touch.look = null;
};
window.addEventListener('pointerup', touchEnd);
window.addEventListener('pointercancel', touchEnd);

// Pointer Lock pour la visée à la souris
stageEl.addEventListener('click', () => {
  if (sim && !paused && sim.player.status !== 'alive') sim.spectate = (sim.spectate || 0) + 1;
  if (!document.body.classList.contains('touch')) play();
});

document.addEventListener('pointerlockchange', () => {
  isPointerLocked = document.pointerLockElement === stageEl;
  if (isPointerLocked) {
    // le verrou a fini par passer : plus besoin de garder le clic enfoncé
    noLock = false;
    lockFails = 0;
  } else lockExitAt = performance.now();
  if (!kbMode && !noLock) setPaused(!isPointerLocked);
});

document.addEventListener('mousemove', (e) => {
  if ((isPointerLocked || (noLock && !paused && e.buttons & 1)) && !kbMode && !touch.look) {
    mouseDx += e.movementX || 0;
    mouseDy += e.movementY || 0;
  }
});

// Une case de l'inventaire : la 1re allume ou éteint la lampe, les deux autres utilisent un objet
// Une case de l'inventaire : la 1re allume ou éteint la lampe ; les deux autres se choisissent (au doigt, toucher
// la case déjà choisie l'utilise)
function useSlot(i, tap = false) {
  if (i === 0) {
    toggleFlashlightRequested = true;
    // le clic de l'interrupteur, tout de suite (même sans pile : on l'entend cliquer dans le vide)
    if (sfx && sim && sim.player.status === 'alive' && sim.player.hasLamp) sfx.lampClick(!sim.player.flashlight);
    return;
  }
  if (tap && sim && sim.player.sel === i) act.use = true;
  selRequested = i;
  if (sim) sim.player.sel = i; // tout de suite à l'écran, l'hôte suit
}

// le bruit d'un pas selon le sol : béton et carrelage (Level 1, Level 37 au sec), eau (Level 37), moquette (Level 0)
function stepKind(P) {
  if (!sim || !P) return false;
  if (sim.level === 2) {
    const m = sim.fm(P.floor || 0);
    return m.depthAt && m.depthAt(P.x, P.z) > 0 ? 'water' : true;
  }
  return sim.level === 1;
}

let lastSettings = {};
// Nouvelle partie (solo ou hôte) : l'hôte l'annonce aux invités, qui construisent la même carte avec la même graine
function initGame(settings = lastSettings, forceLevel = null) {
  lastSettings = settings;
  if (NET.role === 'guest') return; // l'invité attend le « go » de l'hôte
  // ?seed=1234 (seul) : toujours la même carte, pour comparer deux réglages
  const sm = NET.role === 'solo' && location.search.match(/[?&]seed=(\d+)/);
  const daily = settings.map === 'daily' && !sm ? dailyOf() : null;
  dailyLabel = daily ? daily.label : null;
  const seed = sm ? +sm[1] : daily ? daily.seed : Math.floor(Math.random() * 100000);
  const difficulty = settings.difficulty || 'normal';
  const players = NET.role === 'host' ? H.players.map((p) => ({ id: p.id, name: p.name || 'Player' })) : [{ id: 0, name: 'Player' }];
  NET.run = Date.now();
  // ?level1, ?level37 ou ?level2 (seul) : on commence directement au Level 1, aux Poolrooms ou aux Tuyauteries
  const lvm = NET.role === 'solo' && location.search.match(/[?&]level(1|2|37)(&|=|$)/);
  const lv = forceLevel != null ? forceLevel : lvm ? { 1: 1, 37: 2, 2: PIPES_LEVEL }[lvm[1]] : 0;
  startRun({ seed, difficulty, players, run: NET.run, level: lv, vip: settings.monsters === 'vip' });
  // ?parkour (seul) : on commence devant le couloir piégé, tourné vers les trous
  const trap = sim.map.trap;
  if (NET.role === 'solo' && trap && /[?&]parkour(&|=|$)/.test(location.search)) {
    const P = sim.player;
    P.x = trap.x;
    P.z = trap.z;
    P.yaw = trap.yaw;
    P.pitch = -0.3;
  }
  if (NET.role === 'host') send('all', goMessage());
}

// Invité : la carte de l'hôte a-t-elle la même empreinte que la nôtre ? Sinon, les murs, les escaliers et les cassettes
// ne sont pas aux mêmes endroits chez nous : la partie est injouable. Celui qui a tort se répare tout seul : le Hub
// reprend ses fichiers (et ceux du jeu) à la version la plus récente des deux, recharge, revient dans le salon puis
// dans la partie. Un invité plus ancien (ou à la même version, fichiers abîmés en cache) se répare chez lui ; si
// l'hôte est le plus ancien, ou si l'invité s'est déjà réparé sans succès, c'est l'hôte (la partie continue chez les
// autres : l'un d'eux prend le relais).
const GAME_V = new URLSearchParams(location.search).get('v') || ''; // la version du Hub qui a lancé le jeu
let hostV = '';
let printWarnT = -Infinity;
let printBad = 0;
const verLabel = (v) => (v ? `V${v}` : 'AN OLD VERSION');
// 4.100 vient après 4.99 (on ne compare pas des nombres à virgule)
const verNum = (v) => {
  const m = /^(\d+)\.(\d+)$/.exec(String(v || ''));
  return m ? +m[1] * 10000 + +m[2] : 0;
};
// les fichiers du jeu, tels que chargés (à la version du Hub)
const gameFiles = () => (window.BACKROOMS_FILES || []).concat('backrooms.css').map((f) => new URL(f, location.href).href + (GAME_V ? '?v=' + encodeURIComponent(GAME_V) : ''));
// on vient déjà de recharger pour cette version (sans succès) ?
function triedUpdate(v) {
  try {
    const last = JSON.parse(sessionStorage.getItem('hub_update') || 'null');
    return !!(last && last.v === v && Date.now() - last.t < 120000);
  } catch (e) {
    return false;
  }
}
function selfUpdate(v) {
  if (!H.embedded || !H.outdated || triedUpdate(v)) return false;
  if (hud) hud.toast(`MAPS DON'T MATCH · UPDATING YOUR GAME TO ${verLabel(v)}…`, 8);
  H.outdated(v, gameFiles());
  return true;
}
function checkPrint(fp) {
  if (typeof fp !== 'string' || !sim) return;
  if (fp === sim.fp) {
    printBad = 0;
    return;
  }
  // trois instantanés de suite (un changement d'étage peut croiser un instantané de l'étage d'avant)
  if (++printBad < 3) return;
  const hv = verNum(hostV);
  const gv = verNum(GAME_V);
  if (!(hv && gv && hv < gv)) {
    if (selfUpdate(hv > gv ? hostV : GAME_V)) return;
  }
  const now = performance.now();
  if (now - printWarnT < 40000) return;
  printWarnT = now;
  const older = hv && gv && hv !== gv ? (hv > gv ? 'you' : 'host') : '';
  const msg = older === 'host'
    ? `MAPS DON'T MATCH · THE HOST HAS ${verLabel(hostV)}, YOU HAVE ${verLabel(GAME_V)} · THE HOST IS UPDATING`
    : older === 'you'
      ? `MAPS DON'T MATCH · YOU HAVE ${verLabel(GAME_V)}, THE HOST HAS ${verLabel(hostV)} · RELOAD THE PAGE (CTRL+SHIFT+R)`
      : "MAPS DON'T MATCH · THE HOST IS UPDATING";
  if (hud) hud.toast(msg, 14);
  send(H.info.hostId, { t: 'fp', v: GAME_V, tried: triedUpdate(GAME_V) ? 1 : 0 });
}

const goMessage = () => ({ t: 'go', v: GAME_V, run: NET.run, seed: sim.seed, diff: sim.difficulty, players: sim.roster, lv: sim.level, vip: monstersVip, dy: dailyLabel });

let monstersVip = false;
function startRun({ seed, difficulty, players, run, level, vip = false }) {
  NET.run = run;
  camPrev.ok = false;
  trackSeq.clear();
  monstersVip = !!vip;
  setMonsterMode(monstersVip); // les monstres VIP pour toute la partie si l'hôte les a choisis
  if (hud) hud.applyMonsters();
  if (sfx) sfx.setVoiceMode(monstersVip);
  NET.inputs = {};
  NET.actions = {};
  NET.events = [];
  if (!players.some((p) => p.id === NET.myId)) players = [...players, { id: NET.myId, name: 'Player' }];
  // la difficulté adaptative ne compte que chez l'hôte (c'est lui qui fait tourner l'entité)
  const skill = NET.role === 'guest' ? 0.5 : +store.get(SKILL_KEY, 0.5);
  sim = new BackroomsSim({ difficulty, seed, players, localId: NET.myId, level, skill }); // les étages sortent de la graine
  if (NET.role !== 'solo') {
    ensureVoice().sync(players.map((p) => p.id));
  }
  runStats = { seen: 0, rushes: 0, escapes: 0, closest: Infinity, haunts: 0 };
  tapeFrames = [];
  replayed = false;
  echoT = 0;
  hauntAt = 0;
  if (level && sim.level !== level) sim.loadLevel(level);
  // un invité qui arrive en cours de partie regarde les autres jusqu'au prochain étage (l'hôte le dira)
  if (scene) {
    scene.dispose();
    stageEl.innerHTML = '';
  }
  scene = createBackroomsScene(stageEl, sim.floors);
  scene.onDrip = (pos) => sfx && sfx.drip(pos);
  if (hud) {
    hud.$('#endScreen').hidden = true;
    hud.lastCount = -1;
    hud.endPending = null;
    hud.replayTag(false);
  }

  if (!sfx) {
    sfx = new BackroomsSfx();
  }
  sfx.stopDeath();
  deathNear = false;
  if (!hud) {
    hud = new BackroomsHUD(hudEl, hudActions);
  }
  sfx.setVoiceMode(monstersVip);
  applyOpts();

  stepDist = 0;
  setPaused(kbMode ? paused : !isPointerLocked);
}

// l'écran titre : reprendre au dernier niveau atteint (seul)
function resumeRun() {
  const lv = store.get('backrooms_resume', 0);
  if (!lv) return;
  initGame(lastSettings, lv);
  play();
}
const hudActions = { play, setKbMode, use: (i) => useSlot(i, true), resume: resumeRun };

// Hôte : les commandes des invités pour ce pas (la lampe et les objets ne servent qu'une fois)
function guestInputs() {
  const out = {};
  for (const id in NET.inputs) {
    const i = NET.inputs[id];
    const q = NET.actions[id] || (NET.actions[id] = []);
    // une action par pas, dans l'ordre où l'invité les a faites (avec la case qu'il avait choisie)
    const a = q.shift() || {};
    out[id] = { remote: true, mx: i.mx, my: i.my, run: i.run, crouch: i.c, cam: !!i.cm, yaw: i.yaw, pitch: i.pitch, pos: i.pos, tilt: i.tilt, stamina: i.st, sel: a.sel || i.sel, toggleFlashlight: a.k === 'f', useSel: a.k === 'e', pick: a.k === 'p', whistle: a.k === 't', jump: a.k === 'j', beamFall: a.k === 'b' ? a.side : 0, burn: a.k === 'h', struggle: a.k === 'g' ? a.n : 0, view: i.v, voice: i.vo, radio: i.ra, seq: i.seq };
    i.pos = null; // une position annoncée ne sert qu'une fois
  }
  return out;
}

const num = (v, a, b) => (Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : 0);

// Messages du réseau (from : l'identifiant donné par le salon, la seule identité fiable)
function onMsg(from, m) {
  if (!m || typeof m !== 'object') return;
  // la voix : d'un joueur à l'autre, sans passer par l'hôte
  if (m.t === 'rtc' || m.t === 'vx') {
    ensureVoice().onMessage(from, m);
    return;
  }
  if (NET.role === 'host') {
    if (m.t === 'hi' && sim) {
      // arrivée en cours de partie : spectateur jusqu'au prochain étage
      const p = H.players.find((q) => q.id === from);
      sim.addPlayer(from, (p && p.name) || 'Player');
      send(from, goMessage());
    } else if (m.t === 'i' && m.run === NET.run) {
      NET.inputs[from] = { seq: Number.isFinite(+m.n) ? +m.n : undefined, vo: num(m.vo, 0, 1), ra: !!m.ra, mx: num(m.mx, -1, 1), my: num(m.my, -1, 1), run: !!m.r, c: !!m.c, cm: !!m.cm, yaw: num(m.yaw, -1e4, 1e4), pitch: num(m.pitch, -1.4, 1.4), sel: m.s === 2 ? 2 : 1, tilt: num(m.tl, -1, 1), st: num(m.st, 0, 200), pos: { x: num(m.x, 0, 1e3), z: num(m.z, 0, 1e3) }, v: m.v };
    } else if (m.t === 'fp' && hud) {
      // un invité n'a pas la même carte que nous : s'il a une version plus récente, ou la même et qu'il s'est déjà
      // réparé sans succès, c'est nous qui avons tort (la partie continue chez les autres pendant qu'on se répare)
      const p = H.players.find((q) => q.id === from);
      const who = ((p && p.name) || 'A player').toUpperCase();
      const gv = typeof m.v === 'string' ? m.v.slice(0, 8) : '';
      const a = verNum(gv);
      const b = verNum(GAME_V);
      if ((a > b || (a && a === b && m.tried)) && selfUpdate(a > b ? gv : GAME_V)) return;
      if (performance.now() - printWarnT > 20000) {
        printWarnT = performance.now();
        hud.toast(a > b
          ? `MAPS DON'T MATCH · ${who} HAS ${verLabel(gv)}, YOU HAVE ${verLabel(GAME_V)} · RELOAD THE PAGE (CTRL+SHIFT+R)`
          : `MAPS DON'T MATCH · ${who} HAS ${verLabel(gv)} · ${who} IS UPDATING`, 14);
      }
    } else if (m.t === 'a' && m.run === NET.run && ['f', 'e', 'p', 't', 'b', 'h', 'g'].includes(m.k)) {
      const q = NET.actions[from] || (NET.actions[from] = []);
      if (q.length < 8) q.push({ k: m.k, sel: m.s === 2 ? 2 : 1, side: m.side > 0 ? 1 : -1, n: Math.max(1, Math.min(4, m.n | 0)) });
    }
    return;
  }
  if (NET.role !== 'guest' || from !== H.info.hostId) return; // invité : seul l'hôte fait foi
  NET.lastHost = performance.now();
  if (m.t === 'go') {
    hostV = typeof m.v === 'string' ? m.v.slice(0, 8) : '';
    if (m.run !== NET.run || !sim) {
      dailyLabel = typeof m.dy === 'string' ? m.dy.slice(0, 12) : null;
      startRun({ seed: m.seed, difficulty: m.diff, players: m.players || [], run: m.run, level: m.lv || 0, vip: !!m.vip });
    }
  } else if (m.t === 's' && m.run !== NET.run) {
    // une partie que l'on n'a pas (le « go » de l'hôte s'est perdu, une nouvelle partie a commencé sans nous) : on la
    // redemande, au plus toutes les 1,5 s, au lieu de rester sur l'ancienne carte
    const t = performance.now();
    if (!(t - (NET.askT || -1e9) < 1500)) {
      NET.askT = t;
      send('host', { t: 'hi' });
    }
  } else if (m.t === 's' && sim && m.run === NET.run) {
    const lv = sim.level;
    sim.applySnapshot(m.s, performance.now() / 1000);
    if (sim.level !== lv) handleEvent({ type: 'level', level: sim.level, rebuild: true }, NET.myId);
    checkPrint(m.s.mp);
  } else if (m.t === 'e' && sim && m.run === NET.run) {
    for (const ev of m.e) {
      // l'étage a déjà été chargé par l'instantané : on refait seulement la scène si besoin
      if (ev.type === 'level' && sim.level === ev.level && scene && scene.level === ev.level) continue;
      if (ev.type === 'level' && sim.level !== ev.level) sim.loadLevel(ev.level);
      handleEvent(ev, NET.myId);
    }
  }
}

// Le salon a changé : un joueur part (il quitte la partie), ou l'hôte est parti et c'est moi qui prends le relais
function onRoster() {
  if (!sim) return;
  if (NET.role === 'guest' && H.info.role === 'host') {
    NET.role = 'host';
    NET.inputs = {};
    NET.actions = {};
    if (hud) hud.toast("You're the host now: the game goes on");
  }
  if (voice && NET.role !== 'solo') voice.sync(H.players.map((p) => p.id));
  if (NET.role !== 'host') return;
  const ids = new Set(H.players.map((p) => p.id));
  for (const P of [...sim.players]) if (!ids.has(P.id)) sim.removePlayer(P.id);
}

const ITEM_NAME = { bottle: 'Almond water', battery: 'Batteries', ladder: 'Ladder' };

// Événements de la partie : sons, messages, changement d'étage, fin
function handleEvent(ev, me) {
  const mine = ev.by !== undefined ? ev.by === me : ev.id === undefined || ev.id === me;
  const who = (id) => (sim.players.find((p) => p.id === id) || {}).name || 'Someone';
  switch (ev.type) {
    case 'cassette': {
      if (sfx) sfx.cassette('tape');
      if (hud && ev.by !== me) hud.toast(`${who(ev.by)} found a tape (${ev.count}/${ev.total})`);
      // la cassette se lit dans le caméscope : un enregistrement de l'histoire (gardé dans la collection)
      const n = loreOf(sim.seed, ev.id);
      const isNew = !tapesHeard().includes(n);
      hearTape(n);
      if (hud) setTimeout(() => hud && hud.showLore(n, LORE[n], isNew), 900);
      if (sfx) setTimeout(() => sfx && sfx.loreTape(4 + LORE[n].length / 16), 700);
      if (scene) scene.tape('splice', 0.5);
      break;
    }
    case 'fuse': {
      if (sfx) sfx.cassette(sim.level === 2 ? 'valve' : 'fuse');
      if (sim.level === 2) {
        if (hud) hud.toast(ev.by === me ? `Valve wheel ${ev.count}/${ev.total}` : `${who(ev.by)} found a valve wheel (${ev.count}/${ev.total})`);
      } else if (hud) hud.toast(ev.by === me ? 'Fuse in your pocket · bring it to the freight elevator panel' : `${who(ev.by)} picked up a fuse`);
      break;
    }
    case 'fuseIn':
      if (sfx) sfx.cassette('fuse');
      if (hud) hud.toast(ev.count >= ev.total ? 'All 3 fuses are in · now restart the freight elevator: stay at the panel' : `${ev.id === me ? 'Fuse' : `${who(ev.id)}'s fuse`} in the panel · ${ev.count}/${ev.total}`);
      break;
    case 'fuseDrop':
      if (hud) hud.toast(`${ev.name} dropped ${ev.n > 1 ? `${ev.n} fuses` : 'a fuse'} where they fell…`);
      break;
    case 'panelStart':
      if (hud) hud.toast('The motor coughs and screams… it can hear that. Hold on');
      break;
    case 'panelNoise':
      if (sfx) sfx.distant('hammer', { x: ev.x, z: ev.z }, 0.6 + ev.p * 0.6);
      break;
    case 'grab':
      if (ev.id === me) {
        if (sfx) sfx.grab();
        if (scene) scene.tape('grab', 1.2);
      } else {
        if (sfx) sfx.caption(`${ev.name} screaming`, { x: ev.x, z: ev.z });
        if (hud) hud.toast(`It has ${ev.name}! Shine your flashlight on it`);
      }
      break;
    case 'release':
      if (ev.id === me) {
        if (sfx) sfx.release(true);
        if (hud) hud.toast(ev.blinded ? 'The light blinded it · RUN' : 'You broke free · RUN · it will not let go twice');
      } else if (hud) hud.toast(ev.blinded ? 'Your light blinded it!' : `${who(ev.id)} broke free`);
      break;
    case 'hurt':
      if (ev.id === me) {
        if (sfx) sfx.fall(true);
        if (scene) scene.tape('grab', 0.6);
        if (hud) hud.toast('Knocked down! Another hit will be fatal');
      } else if (hud) hud.toast(`${ev.name} got rammed`);
      break;
    case 'hide':
      if (sfx) sfx.hide(ev.id === me ? null : { x: ev.x, z: ev.z });
      if (ev.id === me && ev.on && hud) hud.toast('Hidden · hold [Shift] to hold your breath when it comes close');
      break;
    case 'breath':
      if (ev.id === me && sfx) sfx.holdBreath(ev.on);
      break;
    case 'gasp':
      if (sfx) {
        sfx.holdBreath(false);
        if (ev.id !== me) sfx.caption('gasping', { x: ev.x, z: ev.z });
      }
      if (ev.id === me && hud) hud.toast("You couldn't hold it…");
      break;
    case 'flashlight': {
      // le clic de la lampe d'un coéquipier, entendu de près (le sien sonne déjà à l'appui)
      if (mine || !sfx) break;
      const Q = sim.players.find((p) => p.id === ev.id);
      if (Q && (Q.floor || 0) === (sim.player.floor || 0) && Math.hypot(Q.x - sim.player.x, Q.z - sim.player.z) < 14) sfx.lampClick(ev.on, { x: Q.x, z: Q.z });
      break;
    }
    case 'phantom':
      // une fausse alerte : un son sans rien derrière (ou un néon qui claque vraiment)
      if (!sfx) break;
      if (ev.kind === 'neon') sfx.neonClick({ x: ev.x, z: ev.z }, ev.quiet ? 0.7 : 1);
      else if (ev.kind === 'row') {
        if ((ev.floor || 0) === (sim.player.floor || 0)) sfx.neonRow({ x: ev.x, z: ev.z }, ev.n);
      } else if (ev.kind === 'surge') {
        if ((ev.floor || 0) === (sim.player.floor || 0)) sfx.neonSurge({ x: ev.x, z: ev.z });
      }
      else if (ev.kind === 'whistle') {
        // l'entité imite le sifflet d'un coéquipier… qui est ailleurs ; seul celui qui est visé l'entend
        if (ev.id !== me) break;
        sfx.whistle({ x: ev.x, z: ev.z, muffled: true });
        if (hud) hud.toast(`${ev.name} whistles`);
      } else if (ev.kind === 'echo') {
        // des pas derrière toi, qui suivent les tiens
        if (ev.id === me) echoT = ev.len || 8;
      } else sfx.distant(ev.kind, { x: ev.x, z: ev.z }, 0.9);
      break;
    case 'rare':
      if (ev.kind === 'ding' && sfx) sfx.distant('ding', { x: ev.x, z: ev.z }, 1);
      else if (ev.kind === 'figure' && ev.id === me && scene && scene.figure) scene.figure(ev.x, ev.z);
      else if (ev.kind === 'lightsOut' && sfx) sfx.silence(3);
      break;
    case 'relief':
      if (sfx) sfx.silence(4);
      break;
    case 'powered':
      if (hud) hud.toast(sim.level === 2 ? 'Valves closed: the pumps stop, the three slides open' : 'Fuses in place: the freight elevator is starting up');
      if (sfx && sim.level === 2) sfx.setPool(false); // le silence d'un coup : les pompes s'arrêtent
      break;
    case 'exitUnlocked': {
      const X = sim.map.exit;
      const pos = X ? { x: X.x, z: X.z } : null;
      if (sfx) { sfx.exitUnlocked(pos); setTimeout(() => sfx && sfx.ding(pos), 900); }
      break;
    }
    case 'pickup':
      if (!mine) break;
      if (sfx) sfx.battery();
      if (hud) hud.toast(`${ITEM_NAME[ev.kind]} in your inventory${ev.dropped ? ` · ${ITEM_NAME[ev.dropped].toLowerCase()} dropped on the floor` : ''}`);
      break;
    case 'nothing':
      if (mine && hud) hud.toast('Nothing to pick up here');
      break;
    case 'din':
      // le vacarme des voix : elle a entendu
      if (hud) hud.toast(ev.level >= 2 ? 'Too loud. It knows exactly where you are' : 'Something in the walls is listening to your voices…');
      if (sfx && sfx.ear) sfx.tell('corner', { x: sfx.ear.x + Math.sin(sfx.ear.yaw) * 9, z: sfx.ear.z + Math.cos(sfx.ear.yaw) * 9 }); // un grattement, quelque part derrière
      break;
    case 'locked':
      // la porte du haut de l'escalier, cadenassée
      if (sfx) sfx.lockedDoor(mine ? null : { x: ev.x, z: ev.z, muffled: (ev.floor || 0) !== (sim.viewPlayer(sim.spectate || 0).floor || 0) });
      if (mine && hud) hud.toast("Locked. A chain and a padlock hold the door shut · find the stairwell key");
      break;
    case 'key':
      if (ev.by === me) {
        if (sfx) sfx.keyJingle();
        if (hud) hud.toast('Stairwell key · the doors to the floor below are open');
      } else {
        if (sfx) sfx.unlockFar();
        if (hud) hud.toast(`${ev.name} found the stairwell key · the doors to the floor below are open`);
      }
      break;
    case 'emptySlot':
      if (mine && hud) hud.toast('Empty slot: pick an item with 2 or 3');
      break;
    case 'ladderFar':
      if (mine && hud) hud.toast('Place the ladder right under the alcove with the tape');
      break;
    case 'ladderPlaced':
      if (sfx) sfx.battery();
      if (hud) hud.toast(mine ? 'Ladder placed: get closer to climb' : 'The ladder is under the tape');
      break;
    case 'fall':
      if (sfx) sfx.fall(ev.id === me, ev.x !== undefined ? { x: ev.x, z: ev.z } : null);
      if (hud) hud.toast(ev.id === me ? 'You fell to the floor below! Find a staircase to get back up' : `${ev.name} fell to the floor below`);
      break;
    case 'stairs':
      if (ev.id !== me) break;
      if (sfx) sfx.step(stepKind(sim.player));
      break;
    case 'whistle':
      {
        // placé là où siffle le joueur ; d'un autre étage, étouffé à travers le plancher
        const V = sim.viewPlayer(sim.spectate || 0);
        if (sfx) sfx.whistle(ev.id === me ? null : { x: ev.x, z: ev.z, muffled: (ev.floor || 0) !== (V.floor || 0) });
      }
      if (hud && ev.id !== me) hud.toast(`${ev.name} whistles`);
      break;
    case 'heard':
      if (mine && hud) hud.toast('Shh… the entity heard the whistle');
      break;
    case 'useless':
      if (mine && hud) hud.toast(ev.kind === 'bottle' ? 'Your stamina is already full' : 'The flashlight is already charged');
      break;
    case 'bottle':
      if (!mine) break;
      if (sfx) sfx.bottle();
      if (hud) hud.toast('Almond water: you catch your breath, and your stamina grows for good');
      break;
    case 'battery':
      if (!mine) break;
      if (sfx) sfx.battery();
      if (hud) hud.toast('Battery replaced: flashlight recharged');
      break;
    case 'batteryEmpty':
      if (!mine) break;
      if (sfx) sfx.battery(true);
      if (hud) hud.toast('Out of battery… find some in the dark');
      break;
    case 'blackout':
      if (sfx) sfx.blackout();
      if (ev.level === PIPES_LEVEL) {
        // le noir total : un silence, puis tout le troupeau répond, de partout à la fois
        if (hud) hud.toast("Everything went dark… they're coming. Keep your flashlight on them");
        if (sfx && sim.goats) {
          sim.goats.forEach((g, i) => setTimeout(() => sfx.goatBleat({ x: g.x, z: g.z }, g.alpha ? 'bellow' : 'spot'), 1400 + i * 260 + Math.random() * 300));
        }
      } else if (hud) hud.toast('Power outage…');
      break;
    case 'power':
      if (sfx) sfx.power();
      break;
    case 'spotted':
      if (sfx) sfx.spotted();
      if (ev.id === me) runStats.seen++;
      break;
    case 'tell': {
      // le signe avant qu'elle surgisse : seulement à cet étage
      const V = sim.viewPlayer(sim.spectate || 0);
      if (sfx && (ev.floor || 0) === (V.floor || 0)) sfx.tell(ev.kind, { x: ev.x, z: ev.z });
      break;
    }
    case 'amb': {
      // un bruit d'ambiance tiré par l'hôte : tout le monde l'entend en même temps, au même endroit
      if (!sfx || paused || !sim) break;
      const V = sim.viewPlayer(sim.spectate || 0);
      if (ev.s !== 'rec' && (ev.floor || 0) !== (V.floor || 0)) break; // à un autre étage : la dalle l'étouffe
      sfx.ambCue(ev.s, { x: ev.x, z: ev.z }, ev.a, ev.u, ev.v, ev.w);
      break;
    }
    case 'glimpse':
      // la première rencontre : rien… puis le néon au-dessus d'elle qui claque
      if (ev.phase === 'show' && sfx && ev.id === me) sfx.silence(2.5);
      if (ev.phase === 'gone' && sfx) sfx.neonClick({ x: ev.x, z: ev.z }, 1.2);
      if (ev.phase === 'gone' && ev.seen && ev.id === me) runStats.seen++;
      break;
    case 'hunt':
      // les néons sont revenus… elle est lâchée, là-bas au fond
      if (sfx && (ev.floor || 0) === (sim.viewPlayer(sim.spectate || 0).floor || 0)) sfx.distant('drag', { x: ev.x, z: ev.z }, 1.1);
      break;
    case 'haunt':
      if (sfx) {
        if (ev.kind === 'flicker') sfx.neonClick({ x: ev.x, z: ev.z }, 0.9);
        else sfx.distant('knock', { x: ev.x, z: ev.z }, 1.1);
      }
      if (hud && ev.by === me) hud.toast(ev.kind === 'flicker' ? `The light above ${who(ev.id)} flickers` : `Something knocks ahead of ${who(ev.id)}… it heard`);
      break;
    case 'calmWorn':
      if (sfx) sfx.neonClick({ x: ev.x, z: ev.z }, 0.8);
      break;
    case 'rush':
      // découverte nez à nez : elle hurle et fonce
      if (sfx && (ev.floor === undefined || ev.floor === (sim.player.floor || 0))) sfx.rush({ x: ev.x, z: ev.z });
      if (scene && ev.id === me) scene.tape('grab', 0.5);
      if (ev.id === me) {
        runStats.rushes++;
        runStats.seen++;
      }
      break;
    case 'lost':
      if (sfx) sfx.heartbeat(0);
      if (ev.id === me) runStats.escapes++;
      break;
    case 'board': {
      const sl = ev.slide !== undefined && sim.map.slides ? sim.map.slides[ev.slide] : null;
      if (sfx) sl ? sfx.splashDown() : sfx.ding();
      if (hud && ev.id !== me) hud.toast(sl ? `${ev.name} slid into the ${sl.name.toLowerCase()} slide` : `${ev.name} is in the elevator`);
      break;
    }
    case 'boardCount':
      // les portes vont se fermer : la cabine sonne, et à 10 s un second coup plus pressant
      if (sfx && ev.t <= 10) sfx.ding();
      if (hud && ev.start && sim.player.status === 'alive') hud.toast(`The doors close in ${ev.t}s… get in, it's coming`);
      break;
    case 'leftBehind':
      if (hud) hud.toast(ev.id === me ? 'The doors closed without you' : `${ev.name} was left behind`);
      break;
    case 'depart':
      if (sfx && ev.level === 2) sfx.splashDown();
      else if (sfx) { sfx.ding(); setTimeout(() => sfx && sfx.elevator(DEPART_T + 1.5), 400); }
      if (hud) setTimeout(() => hud && sim.departT > 0 && hud.fade(ev.level === 0 ? 'THE ELEVATOR IS GOING DOWN…' : ev.level === 1 ? 'THE FREIGHT ELEVATOR IS GOING DOWN… THE AIR SMELLS OF CHLORINE' : 'YOU SLIDE DOWN INTO THE DARK, FASTER AND FASTER…', '', 0, true), 700);
      break;
    case 'level':
      // un étage de plus : elle s'enhardit un peu pour la prochaine partie
      if (NET.role !== 'guest' && ev.level && !ev.rebuild) nudgeSkill(0.05);
      // nouvel étage : nouvelle scène
      if (scene && scene.level === ev.level && scene.map === sim.map) break;
      if (scene) scene.dispose();
      stageEl.innerHTML = '';
      scene = createBackroomsScene(stageEl, sim.floors);
      scene.onDrip = (pos) => sfx && sfx.drip(pos);
      sim.spectate = 0;
      stepDist = 0;
      scene.tape('bars', 0.8);
      scene.tape('splice', 1.2);
      if (sfx) sfx.tapeSplice();
      if (hud) hud.fade(`LEVEL ${levelName(ev.level)}`, levelSub(ev.level), 2.2);
      // seul, on pourra reprendre à ce niveau-ci
      if (NET.role === 'solo') store.set('backrooms_resume', ev.level);
      break;
    case 'jumpscare':
      if (ev.id !== me) break;
      if (ev.goat) {
        // Level 2 : une chèvre t'a percuté
        if (sfx) sfx.goatJumpscare();
        if (hud) hud.showJumpscare(sim.level, true);
        if (scene && scene.goatScare) scene.goatScare();
        // puis l'image du bouc qui monte du noir, et le son qui va avec
        if (hud) hud.showGoatDeath(0.85);
        if (sfx) setTimeout(() => sfx.goatDeath(), 850);
        break;
      }
      // elle surgit devant l'objectif (dans la scène), puis la bande saute… et rejoue tes dernières secondes, vues de sa
      // tête (sur une autre caméra) ; puis l'image se perd
      if (sfx) sfx.jumpscare(sim.level);
      if (scene) scene.jumpscare();
      if (hud) hud.showJumpscare(sim.level);
      {
        const now = performance.now() / 1000;
        const frames = tapeFrames.filter((f) => f.t > now - 3.6);
        const span = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
        const sc = scene;
        replayed = span > 1.5 && !sim.goats;
        const lose = () => {
          if (scene !== sc) return;
          if (hud) hud.replayTag(false);
          if (scene) scene.tape('loss', 2.6);
          if (sfx) sfx.noSignal(true);
          setTimeout(() => sfx && sfx.noSignal(false), 2400);
        };
        if (replayed) {
          setTimeout(() => {
            if (scene !== sc) return;
            scene.tape('splice', 0.7);
            if (sfx) sfx.tapeSplice();
            scene.replay(frames);
            if (hud) hud.replayTag(true);
            setTimeout(lose, span * 1000 + 350);
          }, 1700);
        } else setTimeout(lose, 1400);
      }
      break;
    case 'valve':
      if (sfx) sfx.cassette('valve');
      if (hud) hud.toast(ev.by === me ? `Valve closed · ${ev.count}/${ev.total}` : `A valve slammed shut somewhere · ${ev.count}/${ev.total}`);
      break;
    case 'valveStart':
      if (ev.by === me && hud) hud.toast('Turning the valve… stay in front of it');
      break;
    case 'blowout':
      // la vanne fermée a fait sauter les néons de son secteur
      if (sfx) sfx.blowout({ x: ev.x, z: ev.z });
      if (hud) hud.toast('The lights blew out around that valve… a breaker panel can bring them back');
      break;
    case 'breakerStart':
      if (ev.by === me && hud) hud.toast('Resetting the breaker… stay in front of it');
      break;
    case 'breaker':
      if (sfx) sfx.breakerClunk({ x: ev.x, z: ev.z });
      if (hud) hud.toast(ev.by === me ? 'Breaker reset: the lights are back on' : `${who(ev.by)} reset a breaker: lights back on`);
      break;
    case 'burn':
      if (sfx) sfx.steamBurn({ x: ev.x, z: ev.z });
      if (ev.id === me && hud) hud.toast('Burned by the steam!');
      break;
    case 'goat': {
      // le troupeau : chaque bruit vient de la chèvre qui l'a fait ; la première fois, un conseil
      if (ev.act === 'spot' && !goatHint && hud) {
        goatHint = true;
        hud.toast('Something bleats in the dark… they fear the light');
      }
      if (ev.act === 'rage' && hud) hud.toast('A bell rings in the pipes… the billy goat no longer fears the light. Lure it into the steam');
      if (ev.act === 'scald' && hud) hud.toast('The billy goat got scalded! It runs back to its pen');
      if (!sfx) break;
      const pos = { x: ev.x, z: ev.z };
      if (ev.act === 'bleat') sfx.goatBleat(pos, 'bleat');
      else if (ev.act === 'spot') sfx.goatBleat(pos, 'spot');
      else if (ev.act === 'windup') sfx.goatSnort(pos);
      else if (ev.act === 'flee') sfx.goatBleat(pos, 'flee');
      else if (ev.act === 'crash') sfx.goatCrash(pos);
      else if (ev.act === 'vent') sfx.goatVent(pos);
      else if (ev.act === 'rage') {
        sfx.goatBleat(pos, 'bellow');
        sfx.goatBell(pos, 2);
      } else if (ev.act === 'scald') {
        sfx.goatBleat(pos, 'scream');
        sfx.steamBurn(pos);
      }
      break;
    }
    case 'dead':
      if (ev.id !== me && hud) hud.toast(`${ev.name} got caught…`);
      break;
    case 'gameover':
    case 'win':
      // rendre le curseur pour le bouton Rejouer (Entrée marche aussi)
      if (document.pointerLockElement) document.exitPointerLock();
      if (ev.type === 'win' && sfx) sfx.win();
      if (ev.type === 'gameover' && sfx) sfx.tapeStop();
      // une sortie (vraie ou fausse) efface la reprise : on recommence au Level 0
      if (ev.type === 'win' && NET.role === 'solo') store.set('backrooms_resume', 0);
      // difficulté adaptative : mort vite au Level 0, elle triche moins la prochaine fois ; une sortie l'enhardit
      if (NET.role !== 'guest') nudgeSkill(ev.type === 'win' ? 0.12 : sim.level === 0 ? (sim.time < 180 ? -0.15 : -0.05) : -0.03);
      // Carte du jour : ton meilleur temps de survie, ce jour-là
      let best = null;
      if (dailyLabel) {
        const key = dailyOf().key;
        const rec = store.get('backrooms_daily', {});
        best = Math.max(rec.key === key ? rec.best || 0 : 0, sim.time);
        store.set('backrooms_daily', { key, best });
      }
      if (hud) hud.showEnd(sim, NET.role === 'guest' ? null : () => initGame(), { stats: runStats, daily: dailyLabel, best, replay: replayed && ev.type === 'gameover' });
      if (H && H.embedded && NET.role !== 'guest') {
        const won = ev.type === 'win';
        // la vraie fin vaut bien plus qu'une fausse sortie, qui vaut plus que de mourir loin (Level 2 compris)
        const trueEnd = won && sim.level === PIPES_LEVEL;
        const depth = { 0: 0, 1: 1, 2: 2, [PIPES_LEVEL]: 3 }[sim.level] || 0;
        H.report({
          id: `backrooms-${Date.now()}`,
          mode: dailyLabel ? 'Carte du jour' : 'Survie',
          players: sim.players.map((p) => ({ id: p.id, name: p.name, score: p.found + (won ? (trueEnd ? 40 : 20) : depth * 4), rank: won ? 1 : 2 })),
        });
      }
      break;
  }
}

// Boucle principale d'animation et de simulation
let lastTime = performance.now();
let accumulator = 0;
const trackSeq = new Map(); // hôte : dernière position d'invité entrée dans sa piste d'affichage
const camPrev = { x: 0, z: 0, f: 0, ok: false }; // sa position avant le dernier pas (la caméra interpole jusqu'à la suivante)
const lookIn = { yaw: NaN, pitch: NaN }; // le dernier regard donné à la simulation

// Manette (disposition standard) : A ramasser, X utiliser l'objet, Y lampe, RB changer d'objet, B siffler,
// LB / LT / stick gauche enfoncé courir, Menu pause ; A relance la partie en pause
let padPrev = [];
function readPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const p = [...pads].find((x) => x && x.connected);
  if (!p) { padPrev = []; return null; }
  const b = (i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
  const edge = (i) => b(i) && !padPrev[i];
  let hubMenu = false;
  try { hubMenu = window.parent !== window && !!window.parent.document.querySelector('.amenu, .gload.on'); } catch (e) {}
  const endShown = hud && !hud.$('#endScreen').hidden;
  if (!hubMenu && !endShown) {
    if (paused) {
      if (edge(0) || edge(9)) { if (sfx) sfx.unlock(); setPaused(false); }
    } else if (sim && sim.player.grabT > 0) {
      // agrippé : tous les boutons servent à se débattre
      for (let i = 0; i < p.buttons.length; i++) if (i !== 9 && edge(i)) act.struggle++;
    } else {
      if (edge(11)) padCrouch = !padCrouch;
      if (edge(10)) toggleCam();
      if (edge(12)) act.jump = true;
      if (sim && sim.player.status !== 'alive' && (edge(0) || edge(15))) sim.spectate = (sim.spectate || 0) + 1;
      else if (edge(0)) act.pick = true;
      if (edge(2)) act.use = true;
      if (edge(3)) useSlot(0);
      if (edge(5)) useSlot(sim && sim.player.sel === 1 ? 2 : 1);
      if (edge(1)) act.whistle = true;
      if (edge(9)) setPaused(true);
    }
  }
  padPrev = p.buttons.map((_, i) => b(i));
  if (hubMenu || paused) return null;
  return { lx: p.axes[0] || 0, ly: p.axes[1] || 0, rx: p.axes[2] || 0, ry: p.axes[3] || 0, run: b(4) || b(6) || b(10) };
}

// (onglet en arrière-plan : shared/bridge.js fait passer requestAnimationFrame par une minuterie, la partie continue)
function loop(currentTime) {
  requestAnimationFrame(loop);
  frame(currentTime);
}

function frame(currentTime) {

  const delta = Math.max(0, Math.min(0.1, (currentTime - lastTime) / 1000));
  lastTime = currentTime;
  accumulator += delta;

  if (!sim) return;
  // en pause, le monde est figé (seul) ; à plusieurs, il continue sans toi. Le trajet en ascenseur, lui, va
  // toujours jusqu'au bout : sinon une pause pendant la descente laissait l'écran noir pour toujours
  if (paused && !multi() && !(sim.departT > 0)) accumulator = 0;

  // Lecture des entrées utilisateur (en mode sans souris, les flèches tournent la vue)
  const arrows = !kbMode;
  let mx = 0;
  let my = 0;
  if (keys['KeyW'] || keys['KeyZ'] || (arrows && keys['ArrowUp'])) my += 1;
  if (keys['KeyS'] || (arrows && keys['ArrowDown'])) my -= 1;
  if (keys['KeyA'] || keys['KeyQ'] || (arrows && keys['ArrowLeft'])) mx -= 1;
  if (keys['KeyD'] || (arrows && keys['ArrowRight'])) mx += 1;

  if (touch.move && !paused) {
    const dx = touch.move.x - touch.move.ox;
    const dy = touch.move.y - touch.move.oy;
    const d = Math.hypot(dx, dy);
    if (d > 10) {
      const k = Math.min(1, d / 60);
      mx = (dx / d) * k;
      my = (-dy / d) * k;
    }
  }
  // manette : stick gauche pour marcher, stick droit pour regarder
  const gp = readPad();
  if (gp) {
    if (Math.hypot(gp.lx, gp.ly) > 0.15) { mx = gp.lx; my = -gp.ly; }
  }
  const run = !!keys['ShiftLeft'] || !!keys['ShiftRight'] || touch.run || !!(gp && gp.run);
  // courir relève (on ne court pas accroupi)
  if (crouchOn && run && (mx || my)) crouchOn = false;
  if (camOn && sim.player.status !== 'alive') camOn = false;
  const crouch = crouchOn || touch.crouch || padCrouch;

  // Sensibilité de rotation de la souris (réglage), axe vertical inversé au choix
  const sens = 0.0022 * OPTS.sens;
  const inv = OPTS.invertY ? -1 : 1;
  let newYaw = sim.player.yaw - mouseDx * sens;
  let newPitch = Math.max(-1.3, Math.min(1.3, sim.player.pitch - mouseDy * sens * inv));
  if (kbMode && !paused) {
    newYaw -= ((keys['ArrowRight'] ? 1 : 0) - (keys['ArrowLeft'] ? 1 : 0)) * TURN * delta * OPTS.sens;
    newPitch = Math.max(-1.3, Math.min(1.3, newPitch + ((keys['ArrowUp'] ? 1 : 0) - (keys['ArrowDown'] ? 1 : 0)) * TILT * delta * inv));
  }
  if (gp && !paused) {
    const k = (v) => (Math.abs(v) < 0.12 ? 0 : Math.sign(v) * v * v);
    newYaw -= k(gp.rx) * TURN * 1.3 * delta * OPTS.sens;
    newPitch = Math.max(-1.3, Math.min(1.3, newPitch - k(gp.ry) * TILT * delta * inv));
  }
  mouseDx = 0;
  mouseDy = 0;

  // Simulation à pas fixe 60 Hz
  while (accumulator >= DT) {
    const oldX = sim.player.x;
    const oldZ = sim.player.z;
    camPrev.x = oldX;
    camPrev.z = oldZ;
    camPrev.f = sim.player.floor || 0;
    camPrev.ok = true;

    const live = !paused;
    const input = {
      mx: live ? mx : 0,
      my: live ? my : 0,
      yaw: newYaw,
      pitch: newPitch,
      run: live && run,
      crouch: live && crouch,
      jump: live && act.jump,
      cam: camOn && sim.player.status === 'alive',
      struggle: act.struggle,
      toggleFlashlight: toggleFlashlightRequested,
      use: useRequested,
      sel: selRequested || undefined,
      useSel: act.use,
      pick: act.pick,
      whistle: act.whistle,
      view: sim.player.status !== 'alive' ? sim.viewPlayer(sim.spectate || 0).id : undefined,
      voice: voice ? voice.level : 0,
      radio: !!voice && voice.mode === 2,
    };
    // spectateur : un signe aux vivants (E ou T), puis il faut attendre
    if (sim.player.status !== 'alive' && (act.use || act.whistle)) {
      if (performance.now() < hauntAt) {
        input.useSel = false;
        input.whistle = false;
        act.use = act.whistle = false;
      } else if (sim.state === 'playing' && sim.hasMonster && !sim.goats && sim.players.some((p) => p.status === 'alive')) {
        hauntAt = performance.now() + 12000;
        runStats.haunts++;
      }
    }
    if (NET.role === 'guest') {
      // l'invité se déplace chez lui ; lampe et objets partent tout de suite à l'hôte
      // l'invité tient son équilibre chez lui ; s'il le perd, l'hôte le fait tomber
      const fell = sim.predict(input);
      if (fell) send('host', { t: 'a', k: 'b', side: fell, run: NET.run });
      // brûlé par un jet de vapeur chez lui : l'hôte fait crier (et prévient l'entité)
      if (sim.burned) {
        sim.burned = false;
        send('host', { t: 'a', k: 'h', run: NET.run });
      }
      const sel = sim.player.sel;
      if (toggleFlashlightRequested) send('host', { t: 'a', k: 'f', s: sel, run: NET.run });
      for (const [k, on] of [['e', act.use], ['p', act.pick], ['t', act.whistle], ['j', input.jump]]) if (on) send('host', { t: 'a', k, s: sel, run: NET.run });
      if (act.struggle) send('host', { t: 'a', k: 'g', n: act.struggle, run: NET.run });
      if (NET.tick % 3 === 0) {
        const P = sim.player;
        send('host', { t: 'i', run: NET.run, n: NET.tick, s: P.sel, mx: input.mx, my: input.my, r: input.run ? 1 : 0, c: input.crouch ? 1 : 0, cm: input.cam ? 1 : 0, yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3), x: +P.x.toFixed(2), z: +P.z.toFixed(2), tl: +P.tilt.toFixed(2), st: Math.round(P.stamina), v: P.status !== 'alive' ? sim.viewPlayer(sim.spectate || 0).id : undefined, vo: input.voice ? +input.voice.toFixed(2) : undefined, ra: input.radio ? 1 : undefined }, true);
      }
    } else {
      sim.step(input, NET.role === 'host' ? guestInputs() : null);
      // hôte : chaque position annoncée par un invité (et acceptée) entre dans sa piste d'affichage, à l'heure de
      // l'invité : son avatar est interpolé à l'écran au lieu d'avancer par sauts de 50 ms
      if (NET.role === 'host') {
        const now = performance.now() / 1000;
        for (const Q of sim.players) {
          if (Q === sim.player || !Number.isFinite(Q.posSeq) || trackSeq.get(Q.id) === Q.posSeq) continue;
          trackSeq.set(Q.id, Q.posSeq);
          sim.netPush(Q.id, Q.posSeq * DT, now, Q.x, Q.z, Q.yaw, Q.floor || 0, Q.status === 'alive');
        }
      }
    }
    NET.tick++;
    lookIn.yaw = newYaw;
    lookIn.pitch = newPitch;
    toggleFlashlightRequested = false;
    useRequested = null;
    selRequested = 0;
    if (act.struggle && sfx) sfx.struggle();
    act.use = act.pick = act.whistle = act.jump = false;
    act.struggle = 0;

    // Détection de pas pour le son de marche sur moquette
    if (sim.state === 'playing') {
      const moved = Math.hypot(sim.player.x - oldX, sim.player.z - oldZ);
      // un saut : pas de pas en l'air, un choc sourd à la réception
      const up = (sim.player.jy || 0) > 0;
      if (airborne && !up && sfx) {
        sfx.step(stepKind(sim.player));
        setTimeout(() => sfx && sfx.step(stepKind(sim.player)), 45);
        stepDist = 0;
      }
      airborne = up;
      if (!up) stepDist += moved;
      const stepInterval = sim.player.running ? 1.25 : 0.85;
      if (stepDist >= stepInterval) {
        stepDist = 0;
        if (sfx) sfx.step(stepKind(sim.player));
        // l'écho : un pas derrière toi, une fraction de seconde après le tien (il s'arrête quand tu t'arrêtes)
        if (sfx && echoT > 0) {
          const P = sim.player;
          const d = 9 + Math.random() * 3;
          const pos = { x: P.x + Math.sin(P.yaw) * d, z: P.z + Math.cos(P.yaw) * d };
          setTimeout(() => sfx && sfx.step(stepKind(P), pos, 0.55), 180 + Math.random() * 60);
        }
      }
    }

    // Gestion des événements de la simulation (l'hôte les fait suivre aux invités)
    const me = sim.localId;
    for (const ev of sim.drainEvents()) {
      if (NET.role === 'host') NET.events.push(ev);
      handleEvent(ev, me);
    }
    if (NET.role === 'host' && NET.tick % 3 === 0 && H.players.length > 1) {
      // d'abord l'état, ensuite les événements : un événement ne précède jamais ce qu'il annonce
      send('all', { t: 's', run: NET.run, s: sim.snapshot() }, true);
      if (NET.events.length) {
        send('all', { t: 'e', run: NET.run, e: NET.events });
        NET.events = [];
      }
    }

    accumulator -= DT;
  }
  // invité : les autres joueurs et l'entité à leur position interpolée, pour cette image
  if (NET.role === 'guest') sim.interpolate(performance.now() / 1000);
  // une image sans pas de simulation (écran à plus de 60 images par seconde) : le regard suit quand même la souris
  // (avant, ce mouvement-là était perdu), sauf si le jeu tient le regard (prise, casier)
  const Pl = sim.player;
  if (Pl.yaw === lookIn.yaw && Pl.pitch === lookIn.pitch) {
    Pl.yaw = lookIn.yaw = newYaw;
    Pl.pitch = lookIn.pitch = newPitch;
  }

  // Mise à jour du son continu de l'entité ; quand elle te traque : ses cris et, par-dessus, ses pas lourds, de plus en
  // plus forts et rapprochés ; tout près : le son de la mort ; le reste du temps, des ambiances au hasard
  if (sfx && sim.hasMonster && sim.state === 'playing') {
    const M = sim.monster;
    const V0 = sim.viewPlayer(sim.spectate || 0);
    const chasing = !paused && (M.mode === 'chase' || M.mode === 'grab') && M.danger > 0.05;
    // un mur (ou un plancher) entre elle et nous : on l'entend étouffée
    const occl = (M.floor || 0) !== (V0.floor || 0) || !hasLineOfSight(sim.fm(M.floor || 0), V0.x, V0.z, M.x, M.z);
    // Level 2 : pas de bourdonnement d'entité, les sabots du troupeau
    sfx.updateMonsterSound(sim.goats || M.away ? 0 : M.danger, M, sim.level === 1, occl);
    sfx.updateChase(chasing, M.danger, M, occl);
    // la musique de tension suit le directeur (la peur de l'équipe) et ce que fait l'entité
    const D = sim.director;
    const charging = sim.goats ? sim.goats.some((g) => g.mode === 'charge' || g.mode === 'windup') : false;
    const mode = D && D.phase === 'relax' ? 'relief' : chasing || charging ? 'chase' : M.mode === 'search' ? 'search' : M.mode === 'stalk' || M.mode === 'watch' || M.mode === 'ambush' ? 'stalk' : 'calm';
    sfx.setTension(paused ? 0 : Math.max(M.danger, D ? D.stress : 0), mode);
    if (sim.goats) sfx.setChase(charging && !paused);
    // le cœur : la peur, la prise, et l'entité qui passe devant le casier
    const me = sim.player;
    const near = me.status === 'alive' ? Math.max(M.danger, me.grabT > 0 ? 1 : 0) : 0;
    const bpm = paused || near < 0.4 ? 0 : Math.round((70 + near * 75 + (me.hidden >= 0 ? 15 : 0)) / 5) * 5;
    if (bpm !== heartShown) {
      heartShown = bpm;
      sfx.heartbeat(bpm);
    }
    if (sim.goats) {
      const L = sim.viewPlayer(sim.spectate || 0);
      sim.goats.forEach((g, i) => {
        const every = { charge: 0.12, flee: 0.17, stalk: 0.3 }[g.mode];
        const d = Math.hypot(g.x - L.x, g.z - L.z);
        if (!every || d > 28 || paused) return;
        goatHoofT[i] = (goatHoofT[i] || 0) - delta;
        if (goatHoofT[i] > 0) return;
        // le galop : trois coups rapprochés, puis un temps
        goatHoofN[i] = ((goatHoofN[i] || 0) + 1) % 4;
        goatHoofT[i] = g.mode === 'charge' && goatHoofN[i] === 0 ? every * 2 : every;
        if (g.mode !== 'charge' || goatHoofN[i] !== 0) sfx.goatHoof({ x: g.x, z: g.z }, g.mode === 'charge' ? 1 : 0.5, !hasLineOfSight(sim.map, L.x, L.z, g.x, g.z));
      });
      // la cloche du bouc : on l'entend de loin, plus vite quand il trotte ou charge
      const A = sim.goats.find((g) => g.alpha);
      if (A && !paused) {
        goatBellT -= delta;
        if (goatBellT <= 0 && Math.hypot(A.x - L.x, A.z - L.z) < 48) {
          const gap = { charge: 0.18, flee: 0.28, stalk: 0.55, roam: 1.1, stun: 0.12 }[A.mode] || 2.4;
          goatBellT = gap * (0.8 + Math.random() * 0.5);
          sfx.goatBell({ x: A.x, z: A.z }, A.mode === 'charge' ? 1.3 : 1);
        }
      }
    } else if (chasing) {
      monsterStepT -= delta;
      if (monsterStepT <= 0) {
        monsterStepT = 0.5 - Math.min(1, M.danger) * 0.18;
        sfx.monsterStep(M.danger, M, occl);
      }
    }
    if (M.danger > 0.85 && !deathNear) {
      deathNear = true;
      sfx.death();
    } else if (M.danger < 0.5) deathNear = false;
    if (M.danger < 0.25 && sim.player.status === 'alive') sfx.stopDeath(); // échappé : la mort s'éloigne
    sfx.ambience(delta, !paused && !chasing && M.danger < 0.4);
    sfx.drips(paused ? 0 : delta);
  } else if (sfx) {
    sfx.updateMonsterSound(0, 0); // partie finie : l'entité se tait
    sfx.updateChase(false, 0, null);
    sfx.setTension(0, 'calm');
    if (heartShown) {
      heartShown = 0;
      sfx.heartbeat(0);
    }
    sfx.ambience(delta, !paused && sim.state === 'playing');
  }
  if (sfx && sim.state === 'playing') {
    // la vanne qu'on tourne grince de plus en plus
    const me = sim.player;
    const v = sim.level === PIPES_LEVEL && me.status === 'alive' ? (sim.map.valves || []).find((x) => !x.closed && x.turn > 0 && Math.hypot(x.sx - me.x, x.sz - me.z) < 1.6) : null;
    if (v) {
      sfx.valveTurn(v.turn, { x: v.x, z: v.z });
      valveSound = true;
    } else if (valveSound) {
      sfx.valveTurn(-1);
      valveSound = false;
    }
    if (!!me.crouch !== crouchShown) {
      crouchShown = !!me.crouch;
      sfx.crouch(crouchShown);
    }
  }

  // la bande : les dernières secondes (pour le rejeu de la mort), l'appel le plus serré, l'air des recoins calmes
  if (sim.hasMonster && !sim.goats && sim.state === 'playing') {
    const P = sim.player;
    const M = sim.monster;
    if (P.status === 'alive' && !(P.grabT > 0)) {
      const t = performance.now() / 1000;
      tapeFrames.push({ t, mx: M.x, mz: M.z, myaw: M.yaw || 0, mf: M.floor || 0, px: P.x, pz: P.z, pyaw: P.yaw, pf: P.floor || 0, mv: P.moving ? 1 : 0, rn: P.running ? 1 : 0, fl: P.flashlight ? 1 : 0 });
      while (tapeFrames.length && tapeFrames[0].t < t - 4) tapeFrames.shift();
      if (M.mode === 'chase' && (M.floor || 0) === (P.floor || 0)) runStats.closest = Math.min(runStats.closest, Math.hypot(M.x - P.x, M.z - P.z));
    }
  }
  echoT = Math.max(0, echoT - delta);
  if (hud) hud.hauntWait = Math.max(0, (hauntAt - performance.now()) / 1000);
  if (sfx && sim.level === 0) {
    const V = sim.viewPlayer(sim.spectate || 0);
    let calm = 0;
    let wear = 0;
    for (const n of sim.fm(V.floor || 0).calm || []) {
      const v = Math.max(0, 1 - Math.hypot(n.x - V.x, n.z - V.z) / 11) * (n.wear >= 1 ? 0.15 : 1);
      if (v > calm) {
        calm = v;
        wear = n.wear || 0;
      }
    }
    sfx.setCalm(paused || sim.state !== 'playing' ? 0 : calm, wear);
  } else if (sfx && sfx.calmBus) sfx.setCalm(0);

  // Rendu graphique et HUD
  if (scene) {
    if (!document.hidden) {
      // entre deux pas de simulation (60 par seconde), la caméra prend la position intermédiaire : le déplacement est
      // fluide quelle que soit la fréquence de l'écran (un vrai saut, lui, reste net)
      const a = Math.min(1, accumulator / DT);
      const Pl = sim.player;
      const cx = Pl.x;
      const cz = Pl.z;
      const lerp = camPrev.ok && Pl.status === 'alive' && (Pl.floor || 0) === camPrev.f && Math.hypot(cx - camPrev.x, cz - camPrev.z) < 1;
      if (lerp) {
        Pl.x = camPrev.x + (cx - camPrev.x) * a;
        Pl.z = camPrev.z + (cz - camPrev.z) * a;
      }
      try {
        scene.render(sim, currentTime / 1000); // en arrière-plan : la partie tourne, sans image
      } finally {
        if (lerp) {
          Pl.x = cx;
          Pl.z = cz;
        }
      }
    }
    if (sfx) sfx.setHum(scene.lightHere); // le grésillement des néons autour de soi
    if (sfx) {
      // l'oreille suit la caméra (le joueur, ou celui qu'on regarde) ; l'écho change avec le niveau
      const V = sim.viewPlayer(sim.spectate || 0);
      sfx.setListener(V.x, V.z, V.yaw);
      sfx.setRoom(sim.level);
      // les pas des autres joueurs, là où ils marchent (plus rapprochés quand ils courent)
      for (const O of sim.players) {
        if (O === V || O.status !== 'alive' || !O.moving || paused) {
          otherStepT.delete(O.id);
          continue;
        }
        const left = (otherStepT.get(O.id) ?? Math.random() * 0.3) - delta;
        if (left <= 0) sfx.step(stepKind(O), { x: O.x, z: O.z, muffled: (O.floor || 0) !== (V.floor || 0) }, O.running ? 1 : 0.7);
        otherStepT.set(O.id, left <= 0 ? (O.running ? 0.32 : 0.5) : left);
      }
    }
    if (sfx) {
      // le souffle : sprint, puis halètement le temps de récupérer, et la peur quand l'entité est là
      const P = sim.player;
      const tired = 1 - P.stamina / staminaMax(P);
      // discret : on l'entend surtout en courant ; à l'arrêt, juste un reste de halètement quand on est vraiment à bout
      const run = P.running && P.moving ? 0.3 + tired * 0.4 : 0;
      const pant = tired > 0.55 ? ((tired - 0.55) / 0.45) * 0.3 : 0;
      const fear = sim.hasMonster && sim.monster.danger > 0.6 ? (sim.monster.danger - 0.6) * 0.3 : 0;
      const grab = P.grabT > 0 ? 1 : 0;
      sfx.setBreath(P.status === 'alive' && sim.state === 'playing' && !paused && !P.holding ? Math.max(run, pant, fear, grab) : 0);
    }
  }
  if (voice) {
    // V : parler autour de soi ; R : dans le talkie (à plusieurs) ; micro ouvert : la voix passe sans touche
    const me = sim.player;
    // la voix part toute seule dès qu'on parle (proximité) ; le talkie, seulement en maintenant R
    const want = OPTS.mic !== 'off' && keys['KeyR'] && multi() ? 2 : 0;
    // le talkie grésille tout seul de temps en temps (plus souvent quand elle rôde) ; en coupure, il est mort
    const radioOk = !sim.radioDead;
    voice.update(sim, sim.viewPlayer(sim.spectate || 0), delta, want, OPTS.mic !== 'off' && !paused, me.status === 'alive', { ok: radioOk, danger: me.danger || 0, live: !paused && sim.state === 'playing' && !sim.prelude });
    if (hud) hud.voice(voice, sim, multi(), !!keys['KeyR'] && !radioOk && multi());
  }
  if (hud) {
    hud.update(sim, sim.time, delta);
    if (scene && scene.cam) hud.camera(scene.cam, sim, delta);
  }
}

// ?debug : accès à la partie depuis la console (tests)
if (/[?&]debug(&|=|$)/.test(location.search)) {
  window.__br = { get voice() { return voice; }, get sim() { return sim; }, get scene() { return scene; }, get sfx() { return sfx; }, get hud() { return hud; }, keys, act, OPTS, frame: (t) => frame(t) };
}

// Réglages (bouton ⚙ commun aux jeux) : son, et choix Souris / Sans souris
const btnSet = document.getElementById('btnSet');
if (window.DDVolume && btnSet) {
  btnSet.innerHTML = window.DDVolume.ICON || '⚙️';
  btnSet.addEventListener('click', () => {
    // ouvrir les réglages met la partie en pause et rend la souris
    if (document.pointerLockElement) document.exitPointerLock();
    if (!paused) setPaused(true);
  });
  window.DDVolume.panel(btnSet, {
    accent: '#ffcf3a',
    kinds: ['fx'],
    test: () => sfx && sfx.bottle(),
    sections: [
      { title: 'Jeu', items: [
        { label: 'Commandes', get: () => (kbMode ? 'kb' : 'mouse'), set: (v) => setKbMode(v === 'kb'), options: [['mouse', 'Souris'], ['kb', 'Sans souris']] },
        { label: 'Sensibilité', get: () => OPTS.sens, set: (v) => setOpt('sens', +v), range: [0.3, 3, 0.1], format: (v) => `${(+v).toFixed(1)}×` },
        { label: 'Axe vertical', get: () => OPTS.invertY, set: (v) => setOpt('invertY', v), options: [[false, 'Normal'], [true, 'Inversé']] },
        { label: 'Clavier', get: () => OPTS.layout, set: (v) => setOpt('layout', v), options: [['auto', 'Auto'], ['azerty', 'ZQSD'], ['qwerty', 'WASD']] },
      ] },
      { title: 'Image', items: [
        { label: 'Champ de vision', get: () => OPTS.fov, set: (v) => setOpt('fov', +v), range: [60, 100, 2], format: (v) => `${v}°` },
        { label: 'Luminosité', get: () => OPTS.bright, set: (v) => setOpt('bright', +v), range: [0.6, 1.6, 0.05], format: (v) => `${Math.round(v * 100)} %` },
        { label: 'Caméra à l\'épaule', get: () => OPTS.motion, set: (v) => setOpt('motion', +v), range: [0, 1, 0.1], format: (v) => (+v === 0 ? 'stable' : `${Math.round(v * 100)} %`) },
        { label: 'Qualité', get: () => OPTS.quality, set: (v) => setOpt('quality', v), options: [['auto', 'Auto'], ['low', 'Basse'], ['medium', 'Moyenne'], ['high', 'Haute']] },
      ], hint: 'Luminosité : réglez-la pour que le carré de gauche soit à peine visible.' },
      { title: 'Voix', items: [
        { label: 'Micro', get: () => OPTS.mic, set: (v) => { setOpt('mic', v); if (v !== 'off' && started) askMic(true); }, options: [['on', 'Activé'], ['off', 'Coupé']] },
        { label: 'Volume des voix', get: () => OPTS.voiceVol, set: (v) => setOpt('voiceVol', +v), range: [0, 2, 0.1], format: (v) => `${Math.round(v * 100)} %` },
      ], hint: "Votre voix porte toute seule jusqu'aux joueurs proches (on vous entend à travers les murs, mal). R maintenu : parler dans le talkie, à toute l'équipe. Attention : l'entité entend aussi, et plus vous parlez, plus elle devient agressive. Le talkie grésille aussi chez ceux qui le reçoivent." },
      { title: 'Accessibilité', items: [
        { label: 'Réduire les flashs', get: () => OPTS.reduceFlashes, set: (v) => setOpt('reduceFlashes', v), options: [[false, 'Non'], [true, 'Oui']] },
        { label: 'Sous-titres', get: () => OPTS.subs, set: (v) => setOpt('subs', v), options: [[false, 'Non'], [true, 'Oui']] },
      ], hint: 'Le jeu contient des lumières qui clignotent, des sons forts et des images brouillées. « Réduire les flashs » adoucit les éclairs et les parasites ; « Caméra à l\'épaule » à 0 rend la caméra stable.' },
      { title: 'Commandes', items: [{ keys: [
        ['Se déplacer', '<kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> ou flèches'],
        ['Regarder', 'souris'],
        ['Courir', '<kbd>Maj</kbd>'],
        ['S\'accroupir (lent, silencieux)', '<kbd>C</kbd>'],
        ['Se cacher dans un casier · en sortir', '<kbd>F</kbd>'],
        ['Retenir son souffle (dans un casier)', '<kbd>Maj</kbd>'],
        ['Se débattre (agrippé)', 'toutes les touches'],
        ['Lampe torche (case 1)', '<kbd>1</kbd>'],
        ['Choisir une case · utiliser', '<kbd>2</kbd> <kbd>3</kbd> · <kbd>E</kbd>'],
        ['Ramasser (échange si plein)', '<kbd>F</kbd>'],
        ['Siffler (attention à l\'entité)', '<kbd>T</kbd>'],
        ['Parler aux joueurs proches', 'micro ouvert'],
        ['Talkie-walkie (toute l\'équipe)', '<kbd>R</kbd> (maintenir)'],
        ['Pause', '<kbd>Échap</kbd>'],
      ] }] },
      { title: 'Sans souris', items: [{ keys: [
        ['Se déplacer', '<kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd>'],
        ['Tourner la vue', '<kbd>←</kbd><kbd>→</kbd>'],
        ['Lever, baisser les yeux', '<kbd>↑</kbd><kbd>↓</kbd>'],
        ['Courir · lampe · accroupi', '<kbd>Maj</kbd> · <kbd>1</kbd> · <kbd>C</kbd>'],
        ['Choisir · utiliser · ramasser', '<kbd>2</kbd> <kbd>3</kbd> · <kbd>E</kbd> · <kbd>F</kbd>'],
        ['Siffler', '<kbd>T</kbd>'],
        ['Jouer · pause', '<kbd>Entrée</kbd> · <kbd>Échap</kbd> ou <kbd>P</kbd>'],
      ] }] },
    ],
  });
}

// Initialisation HubBridge ou Solo
function boot(info) {
  if (!sfx) sfx = new BackroomsSfx();
  if (!hud) hud = new BackroomsHUD(hudEl, hudActions);
  applyOpts();
  if (H && H.embedded) {
    NET.role = info.role === 'host' ? 'host' : info.role === 'guest' ? 'guest' : 'solo';
    NET.myId = info.myId;
    H.on('msg', onMsg);
    H.on('roster', onRoster);
    H.signalReady(); // après on('msg') : sinon les premiers messages de l'hôte se perdent
  }
  ensureVoice(); // le talkie grésille même seul ; la voix, elle, attend le micro
  initGame(info.settings || {});
  if (NET.role === 'guest') {
    // demander la partie en cours à l'hôte (et la redemander tant qu'elle n'arrive pas)
    const ask = () => {
      if (!sim) {
        send('host', { t: 'hi' });
        setTimeout(ask, 1500);
      }
    };
    ask();
  }
  requestAnimationFrame(loop);
}

if (H && H.embedded) {
  H.on('init', boot);
} else {
  boot({ role: 'solo', settings: {} });
}
