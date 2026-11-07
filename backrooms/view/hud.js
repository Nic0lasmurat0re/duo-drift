// The Backrooms - Interface façon caméscope (REC, signal, bande), jumpscare et écran de fin
import { ENTITY_IMG, ENTITY_ANIM } from './scene.js';
import { DEPART_T, PIPES_LEVEL } from '../engine/sim.js';

const GOAT_DEATH_IMG = new URL('../img/bouc.jpg', import.meta.url).href;
const GOAT_DEATH_FADE = 8; // secondes de montée de l'image

// nom affiché d'un niveau : le troisième, ce sont les Poolrooms (Level 37) ; le quatrième, les Tuyauteries (Level 2)
export const levelName = (lv) => (lv === 2 ? 37 : lv === PIPES_LEVEL ? 2 : lv);
// Poolrooms : le toboggan pris par l'équipe (ou null)
const slideOf = (sim) => (sim.map.slides && sim.slide >= 0 ? sim.map.slides[sim.slide] : null);
export const levelSub = (lv) => (lv === PIPES_LEVEL ? 'Pipe Dreams · the service tunnels' : lv === 2 ? 'The Poolrooms' : lv === 1 ? 'The industrial basement' : 'The Lobby');

// Les cassettes du Level 0 racontent une histoire : dix enregistrements, cinq par partie (toujours d'autres, selon la
// graine). Ceux qu'on a déjà écoutés restent dans la collection (sur cet appareil).
export const LORE = [
  'Day three. The hum never stops. I counted the lights in this hallway: forty-one. Then forty. Nobody turned one off.',
  "If you hear it, don't run. Running is the loudest thing you can do down here. Crouch. Wait. Let it pass.",
  'The elevators lie. One of them is a wall. You only find out once every tape is in your bag.',
  'There are lockers further down. I sat in one for an hour. It stood right outside the door. Breathing with me.',
  'Kevin went to check the noise behind the shelves. The noise was Kevin. Kevin was standing next to me.',
  "Almond water. Drink it slowly. It doesn't fix you. It just buys you a minute.",
  "Something whistled my name tonight. In my voice. Don't answer a whistle you didn't hear coming.",
  "The goats hate the light. The big one, with the bell… the big one stopped caring.",
  'The pool rooms have three slides. Red, blue, yellow. Two of them take you home. Home is wrong now.',
  'If anyone finds this: the yellow one. Take the yellow one. It is the only way out that stays out.',
];
export const loreOf = (seed, id) => {
  // cinq enregistrements différents pour cette graine
  const order = LORE.map((_, i) => i).sort((a, b) => ((a * 7919 + seed * 104729) % 1009) - ((b * 7919 + seed * 104729) % 1009));
  return order[id % order.length];
};
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  },
};
export const tapesHeard = () => store.get('backrooms_lore', []);
export function hearTape(i) {
  const h = tapesHeard();
  if (!h.includes(i)) store.set('backrooms_lore', [...h, i]);
}
export { store };

export class BackroomsHUD {
  constructor(container, actions = {}) {
    this.el = container;
    this.actions = actions;
    this.el.innerHTML = `
      <div class="jumpscare-overlay" id="jumpscareOverlay" hidden><img id="scareImg" alt=""><div class="scare-anim" id="scareAnim" hidden></div></div>
      <div class="goat-death" id="goatDeath" hidden>
        <div class="gd-pic" id="gdImg">
          <img class="gd-img" src="${GOAT_DEATH_IMG}" alt="">
          <img class="gd-img gd-red" src="${GOAT_DEATH_IMG}" alt="">
          <img class="gd-img gd-cyan" src="${GOAT_DEATH_IMG}" alt="">
          <div class="gd-grain" id="gdGrain"></div>
        </div>
        <div class="gd-vignette"></div>
      </div>

      <!-- Incrustations du caméscope -->
      <div class="cam cam-tl">
        <div class="vhs-rec"><span class="rec-dot">●</span> REC</div>
        <div class="vhs-play">PLAY ▶ SP</div>
        <div class="vhs-level" id="levelTag">LEVEL 0</div>
        <div class="blackout-tag" id="blackoutTag" hidden>⚠ POWER OUTAGE</div>
      </div>
      <div class="cam cam-tr">
        <div class="battery" id="battery"><i></i></div>
        <div id="vhsTimer">00:00:00</div>
      </div>
      <div class="cam cam-bl">
        <div class="tape-date" id="tapeDate"></div>
        <div class="stamina" id="stamina"><span>STAMINA</span><div class="stamina-track"><div class="stamina-bar" id="staminaBar"></div></div></div>
        <div class="crouch-tag" id="crouchTag" hidden>▼ CROUCHED</div>
        <!-- les touches utiles, en petit, comme une ligne de plus de l'écran du caméscope -->
        <div class="keys-tag" id="keysTag"></div>
      </div>
      <div class="cam cam-br">
        <div class="tapes"><span id="cassetteIcons"></span> <b id="cassetteText">0/5</b></div>
        <div class="carry" id="carryTag" hidden></div>
        <div class="signal" id="signal"><span id="signalLabel">SIGNAL</span> <span id="signalBars">${'<i></i>'.repeat(5)}</span></div>
      </div>

      <!-- Dans un casier : les fentes de la porte, et le souffle retenu -->
      <div class="locker" id="locker" hidden><div class="locker-slits"></div><div class="locker-ui"><span id="lockerText">HOLD SHIFT TO HOLD YOUR BREATH · PRESS F TO GET OUT</span><div class="breath"><i id="breathBar"></i></div></div></div>
      <!-- Agrippé : se débattre -->
      <div class="grab" id="grab" hidden><b>BREAK FREE!</b><span id="grabText">MASH ANY KEY</span><div class="grab-bar"><i id="grabBar"></i></div></div>
      <div class="hurt" id="hurt"></div>
      <!-- Sous-titres (réglages) et enregistrements des cassettes -->
      <div class="captions" id="captions"></div>
      <div class="calib" id="calib" hidden><i></i><i></i><i></i><span>The left square should be barely visible</span></div>
      <div class="lore" id="lore" hidden><small id="loreTag"></small><p id="loreText"></p></div>

      <!-- Inventaire : la case 1 est réservée à la lampe torche, les cases 2 et 3 aux piles et à l'eau d'amande -->
      <div class="inv" id="inv">${[0, 1, 2].map((i) => `<button class="slot" data-slot="${i}"><b>${i + 1}</b><span></span></button>`).join('')}</div>

      <div class="corner c1"></div><div class="corner c2"></div><div class="corner c3"></div><div class="corner c4"></div>
      <div class="crosshair"></div>

      <div class="objective-banner" id="objBanner"></div>
      <!-- Spectateur : à l'abri dans l'ascenseur, ou attrapé -->
      <div class="spectate" id="spectate" hidden><b id="specTitle"></b><span id="specSub"></span><small id="specHaunt"></small></div>
      <!-- Le rejeu de la mort, vu de sa tête -->
      <div class="voice-tag" id="voiceTag" hidden><span id="voiceOut"></span><i id="voiceBar"><b></b></i><span id="voiceIn"></span></div>
      <div class="replay-tag" id="replayTag" hidden><b>▶ PLAY</b> CAM 02 · <span>00:00:0<i id="replayClock">0</i></span></div>
      <!-- Fondu : l'ascenseur descend, carte de l'étage -->
      <div class="fade" id="fade"><div><b id="fadeTitle"></b><span id="fadeSub"></span><div class="fade-bar" id="fadeBarBox" hidden><i id="fadeBar"></i></div></div></div>
      <div class="toast" id="toast" hidden></div>
      <!-- Ce que tu peux faire ici : ramasser, échanger, poser l'échelle ; la jauge d'équilibre sur une arête -->
      <div class="prompt" id="prompt" hidden><span id="promptText"></span><div class="beam" id="beamBar" hidden><b></b><i></i></div></div>

      <!-- Pause : prendre le contrôle et choisir ses commandes -->
      <div class="click-prompt" id="clickPrompt">
        <div class="title-card" id="titleCard" hidden>
          <div class="tc-label"><b>THE BACKROOMS</b><span>FOUND FOOTAGE · TAPE 1 OF ?</span></div>
          <button class="tc-continue" id="btnContinue" hidden></button>
          <p class="tc-phones">🎧 BEST WITH HEADPHONES, LIGHTS OFF</p>
          <div class="tc-calib" id="tcCalib"><i></i><i></i><i></i><span>Brightness ⚙: the left square should be barely visible</span></div>
          <p class="tc-warn" id="tcWarn">This tape contains flashing lights, loud sounds and screen distortion. Settings ⚙ can reduce flashes and camera motion.</p>
        </div>
        <div class="pause-title" id="pauseTitle">II PAUSE</div>
        <div class="pause-go" id="pauseGo"></div>
        <div class="ctrl-choice">
          <span>CONTROLS</span>
          <button data-kb="0">MOUSE</button>
          <button data-kb="1">NO MOUSE</button>
        </div>
        <small id="pauseKeys"></small>
      </div>

      <!-- Écran de Fin (Mort ou Victoire) -->
      <div class="end-screen" id="endScreen" hidden>
        <div class="end-card">
          <div class="end-label"><small id="endTape">TAPE 1996 · DO NOT ERASE</small><h1 id="endTitle">YOU DIED</h1></div>
          <p id="endSubtitle">The entity caught you...</p>
          <div class="end-stats" id="endStats"></div>
          <div class="end-run" id="endRun"></div>
          <div class="end-lore" id="endLore"></div>
          <button class="btn-restart" id="btnRestart">PLAY AGAIN</button>
        </div>
      </div>
    `;

    this.$ = (s) => this.el.querySelector(s);
    // les éléments mis à jour à chaque image (on ne les recherche pas à chaque fois)
    this.E = {};
    for (const id of ['vhsTimer', 'battery', 'levelTag', 'cassetteIcons', 'cassetteText', 'objBanner', 'blackoutTag', 'fadeBar', 'spectate', 'specTitle', 'specSub', 'signal', 'signalBars', 'signalLabel', 'stamina', 'staminaBar', 'crouchTag', 'carryTag', 'inv', 'toast', 'locker', 'lockerText', 'breathBar', 'grab', 'grabBar', 'grabText', 'hurt', 'captions', 'lore', 'loreText', 'loreTag', 'prompt', 'promptText', 'beamBar']) this.E[id] = this.$('#' + id);
    this.barEls = [...this.E.signalBars.children];
    this.barEls.forEach((b, i) => (b.style.height = `${6 + i * 3}px`));
    this.sigShown = -1;
    this.sigT = 0;
    this.cache = {};
    this.invIdle = 0;
    this.$('#btnContinue').addEventListener('click', (e) => {
      e.stopPropagation();
      this.actions.resume?.();
    });
    // sauter l'écran de mort au bout de 3 s (clic ou touche)
    const skip = () => {
      if (this.endPending && performance.now() - this.endAt > 3000) this.endPending();
    };
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    this.invKey = '';
    this.$('#inv').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.slot');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      this.actions.use?.(+b.dataset.slot);
    });
    this.$('#clickPrompt').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-kb]');
      if (b) this.actions.setKbMode?.(b.dataset.kb === '1');
      else this.actions.play?.();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && !this.$('#endScreen').hidden && !e.repeat) this.$('#btnRestart').click();
    });
    this.applyMonsters();

    // date du caméscope, figée en 1996 comme une vieille cassette retrouvée
    const d = new Date();
    this.$('#tapeDate').textContent = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.1996`;
    this.bannerT = 9;
    this.lastCount = -1;
    this.toastT = 0;
  }

  // le texte d'un élément, seulement s'il change
  text(id, v) {
    if (this.cache[id] === v) return;
    this.cache[id] = v;
    this.E[id].textContent = v;
  }

  // une classe d'un élément, seulement si elle change
  flag(id, cls, on) {
    const k = id + '.' + cls;
    if (this.cache[k] === on) return;
    this.cache[k] = on;
    this.E[id].classList.toggle(cls, on);
  }

  show(id, on) {
    const k = id + '!';
    if (this.cache[k] === on) return;
    this.cache[k] = on;
    this.E[id].hidden = !on;
  }

  update(sim, time, dt = 1 / 60) {
    const P = sim.player;
    const E = this.E;

    // 1. Compteur de bande, pile de la lampe (la batterie du caméscope)
    const totalSec = Math.floor(time);
    this.text('vhsTimer', `${String(Math.floor(totalSec / 3600)).padStart(2, '0')}:${String(Math.floor(totalSec / 60) % 60).padStart(2, '0')}:${String(totalSec % 60).padStart(2, '0')}`);
    const bat = Math.round(P.battery ?? 100);
    if (this.cache.bat !== bat) {
      this.cache.bat = bat;
      E.battery.style.setProperty('--b', Math.max(0.04, bat / 100).toFixed(3));
    }
    this.flag('battery', 'low', bat < 20);

    // 2. Objectif de l'étage : 5 cassettes (Level 0), 3 fusibles à rapporter au monte-charge (Level 1), 3 volants
    // (Level 37), 4 vannes (Level 2)
    const L1 = sim.level === 1 || sim.level === 2;
    const L37 = sim.level === 2;
    const PIPES = sim.level === PIPES_LEVEL;
    const got = PIPES ? sim.valves : L1 ? sim.fuses : sim.cassettes;
    const total = PIPES ? 4 : L1 ? 3 : 5;
    const delivered = sim.delivered || 0;
    const objKey = `${sim.level}:${got}:${delivered}:${sim.open}:${sim.slide}`;
    if (objKey !== this.lastCount) {
      this.lastCount = objKey;
      this.text('levelTag', `LEVEL ${levelName(sim.level)}`);
      this.floorShown = -1;
      E.cassetteIcons.innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < (sim.level === 1 ? delivered : got) ? 'on' : i < got ? 'half' : ''}${L1 ? ' fuse' : ''}"></i>`).join('');
      this.text('cassetteText', `${sim.level === 1 ? delivered : got}/${total}`);
      this.bannerT = 6;
      const banner = E.objBanner;
      banner.classList.toggle('unlocked', sim.open);
      let b;
      if (sim.open && L37) b = slideOf(sim) ? `EVERYONE INTO THE ${slideOf(sim).name} SLIDE · THE OTHERS ARE SHUT` : 'THE PUMPS STOPPED · THE SLIDES ARE OPEN: RED, YELLOW OR BLUE, EACH ONE LEADS SOMEWHERE ELSE';
      else if (sim.open) b = PIPES ? 'THE STEAM IS OFF: THE SERVICE ELEVATOR IS OPEN · EVERYONE GET IN' : L1 ? 'THE FREIGHT ELEVATOR HAS POWER: EVERYONE GET IN' : 'ONLY ONE OF THE TWO ELEVATORS OPENED… THE OTHER ONE IS JUST A WALL NOW';
      else if (L37) b = got === 0 ? 'LEVEL 37 · FIND THE 3 VALVE WHEELS IN THE PUMP ROOMS' : `VALVE WHEEL ${got}/3 RECOVERED`;
      else if (PIPES) {
        const dark = (sim.map.breakers || []).some((x) => !x.done && (sim.map.valves[x.sector] || {}).power === 2);
        b = got === 0 ? 'LEVEL 2 · CLOSE THE 4 STEAM VALVES IN THE BOILER ROOMS · STAY IN THE LIGHT' : `VALVE ${got}/4 CLOSED` + (dark ? ' · A SECTOR WENT DARK: RESET ITS BREAKER (ELECTRICAL)' : '');
      } else if (L1 && delivered >= total) b = 'ALL FUSES IN · STAY AT THE PANEL TO RESTART THE FREIGHT ELEVATOR · IT WILL BE LOUD';
      else if (L1 && got > delivered) b = `FUSE IN YOUR POCKET · BRING IT TO THE FREIGHT ELEVATOR PANEL (${delivered}/3 IN)`;
      else if (L1) b = got === 0 ? 'LEVEL 1 · FIND THE 3 FUSES IN THE AISLES' : `FUSE ${got}/3 RECOVERED`;
      else b = got === 0 ? 'FIND THE 5 VHS TAPES · THE SIGNAL GETS STRONGER AS YOU GET CLOSER' : `TAPE ${got}/5 RECOVERED`;
      banner.textContent = b;
    }
    this.bannerT -= dt;
    this.flag('objBanner', 'hide', this.bannerT <= 0);
    this.show('blackoutTag', sim.blackout > 0);

    // 2a. Trajet en ascenseur : barre de chargement ; à l'arrivée, la carte de l'étage (même si l'annonce s'est perdue)
    if (this.fadeRide) {
      const k = sim.departT > 0 ? 1 - sim.departT / DEPART_T : 1;
      E.fadeBar.style.width = `${Math.round(k * 100)}%`;
      if (!(sim.departT > 0)) {
        this.fadeRide = false;
        if (sim.state === 'playing') this.fade(`LEVEL ${levelName(sim.level)}`, levelSub(sim.level), 2.2);
        else this.$('#fade').classList.remove('on');
      }
    }

    // 2b. Spectateur : dans l'ascenseur ou attrapé, on regarde ceux qui sont encore dehors
    const spec = P.status !== 'alive' && sim.state === 'playing';
    this.show('spectate', spec);
    if (spec) {
      const view = sim.viewPlayer(sim.spectate || 0);
      const inside = sim.players.filter((p) => p.status === 'elevator').length;
      const sl = slideOf(sim);
      this.text('specTitle', sim.departT > 0 ? (sl ? 'DOWN THE SLIDE…' : 'THE DOORS ARE CLOSING…') : P.status === 'elevator' ? (sl ? `YOU'RE IN THE ${sl.name} SLIDE` : "YOU'RE IN THE ELEVATOR") : sim.goats ? 'THE HERD GOT YOU' : 'THE ENTITY GOT YOU');
      this.text('specSub', sim.departT > 0 ? '' : `${inside}/${sim.players.length} safe · watching ${view.name}${view !== P ? ' · click or Space: switch' : ''}`);
      // on peut encore aider (ou piéger) ceux qui sont dehors
      const canHaunt = view !== P && sim.departT <= 0 && sim.hasMonster && !sim.goats;
      const wait = Math.ceil(this.hauntWait || 0);
      this.text('specHaunt', !canHaunt ? '' : wait > 0 ? `The other side needs ${wait}s…` : `E: make their light flicker · T: knock further on (it will come)`);
    }

    // 3. Signal de l'objectif le plus proche (25 m) : il tremble quatre fois par seconde, pas à chaque image ; rien
    // pendant une coupure
    this.sigT -= dt;
    if (this.sigT <= 0) {
      this.sigT = 0.25;
      const bars = Math.round((P.signal || 0) * 5);
      const shown = bars > 0 && Math.random() < 0.25 ? Math.max(0, bars - 1 + (Math.random() < 0.3 ? 2 : 0)) : bars;
      const n = Math.min(5, shown);
      if (n !== this.sigShown) {
        this.sigShown = n;
        this.barEls.forEach((b, i) => b.classList.toggle('on', i < n));
      }
    }
    const noSig = !(P.signal > 0);
    this.text('signalLabel', noSig ? (sim.blackout > 0 ? 'NO SIGNAL' : 'NO SIGNAL') : P.sigTo === 'stairs' ? 'STAIRS' : P.sigTo === 'key' ? 'KEY' : L37 && sim.open ? 'SLIDE' : sim.open || (sim.level === 1 && delivered >= total) || (sim.level === 1 && !(sim.map.fuses || []).some((f) => !f.taken)) ? (sim.level === 1 ? 'FREIGHT ELEVATOR' : 'ELEVATOR') : 'SIGNAL');
    this.flag('signal', 'none', noSig);
    if (sim.floors.length > 1 && this.floorShown !== P.floor) {
      this.floorShown = P.floor;
      this.text('levelTag', `LEVEL ${levelName(sim.level)} · ${P.floor ? 'LOWER' : 'UPPER'} FLOOR`);
    }

    // 4. Souffle : la jauge n'apparaît que quand elle sert (HUD minimal)
    const st = Math.round(P.stamina);
    if (this.cache.st !== st) {
      this.cache.st = st;
      E.staminaBar.style.width = `${st}%`;
    }
    this.flag('staminaBar', 'low', st < 25);
    this.flag('stamina', 'idle', st >= 99 && !P.running);
    this.show('crouchTag', !!P.crouch && P.status === 'alive');
    // Level 1 : les fusibles en poche
    const carry = P.carry ? P.carry.length : P.carryN || 0;
    this.show('carryTag', carry > 0);
    if (carry > 0) this.text('carryTag', `${'▮'.repeat(carry)} FUSE${carry > 1 ? 'S' : ''} IN POCKET`);

    // 4b. Inventaire (il s'efface quand on ne s'en sert pas)
    const inv = P.inv || [];
    const slotsKey = `${inv.join(',')}|${P.hasLamp ? 1 : 0}${P.flashlight ? 1 : 0}|${P.sel}`;
    if (slotsKey !== this.invKey) {
      this.invKey = slotsKey;
      this.invIdle = 0;
      E.inv.querySelectorAll('.slot').forEach((b, i) => {
        if (i === 0) {
          b.classList.toggle('full', !!P.hasLamp);
          b.classList.toggle('lamp-on', !!P.flashlight);
          b.classList.add('lamp-slot');
          b.querySelector('span').innerHTML = P.hasLamp ? `<i class="ico-lamp"></i>${P.flashlight ? 'ON' : 'OFF'}` : 'LAMP';
          return;
        }
        const k = inv[i - 1];
        b.classList.toggle('full', !!k);
        b.classList.toggle('sel', P.sel === i);
        b.querySelector('span').innerHTML = k === 'battery' ? '<i class="ico-bat"></i>BATTERY' : k === 'bottle' ? '<i class="ico-bot"></i>WATER' : k === 'ladder' ? '<i class="ico-ladder"></i>LADDER' : '';
      });
    }
    this.invIdle += dt;
    this.flag('inv', 'idle', this.invIdle > 5 && !document.body.classList.contains('touch'));

    // 4c. Casier, prise, coup de chèvre
    const hidden = P.hidden >= 0 && P.status === 'alive';
    this.show('locker', hidden);
    if (hidden) {
      const br = Math.round(P.breath ?? 100);
      if (this.cache.br !== br) {
        this.cache.br = br;
        E.breathBar.style.width = `${br}%`;
      }
      this.flag('locker', 'holding', !!P.holding);
      this.text('lockerText', P.holding ? (br < 30 ? "YOU CAN'T HOLD IT MUCH LONGER…" : 'HOLDING YOUR BREATH…') : 'HOLD SHIFT TO HOLD YOUR BREATH · PRESS F TO GET OUT');
    }
    const grabbed = P.grabT > 0 && P.status === 'alive';
    this.show('grab', grabbed);
    if (grabbed) {
      const need = 8 + (sim.difficulty === 'hard' ? 3 : 0);
      E.grabBar.style.width = `${Math.min(100, ((P.struggle || 0) / need) * 100)}%`;
      this.text('grabText', document.body.classList.contains('touch') ? 'TAP THE SCREEN AS FAST AS YOU CAN' : 'MASH ANY KEY');
    }
    const hurt = (P.hurt || 0) > 0 && P.status === 'alive';
    this.flag('hurt', 'on', hurt);

    // 4d. Invite : ce que la touche fait ici
    this.prompt(sim, P);

    // 5. Messages passagers, sous-titres, enregistrement
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) E.toast.hidden = true;
    }
    if (this.loreT > 0) {
      this.loreT -= dt;
      if (this.loreT <= 0) E.lore.hidden = true;
    }
    for (const c of [...E.captions.children]) {
      c.t -= dt;
      if (c.t <= 0) c.remove();
    }
  }

  // un sous-titre (réglage) : dir : 'left' | 'right' | 'behind' | 'ahead' | null
  caption(text, dir = null) {
    const box = this.E.captions;
    for (const c of box.children) if (c.dataset.text === text) {
      c.t = 2.6;
      return;
    }
    const el = document.createElement('div');
    el.dataset.text = text;
    const arrow = { left: '◀ ', right: '', behind: '▼ ', ahead: '▲ ' }[dir] || '';
    el.textContent = `${arrow}[${text}]${dir === 'right' ? ' ▶' : ''}`;
    el.t = 2.6;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
  }

  // l'enregistrement d'une cassette, en sous-titre de bande
  showLore(n, text, isNew) {
    this.E.loreTag.textContent = `TAPE #${String(n + 1).padStart(2, '0')}${isNew ? ' · NEW' : ''}`;
    this.E.loreText.textContent = `“${text}”`;
    this.E.lore.hidden = false;
    this.loreT = 3 + text.length / 16;
  }

  // le bandeau du rejeu (on = false : caché)
  // la voix : ce qu'on émet (VOICE à côté de soi, RADIO dans le talkie) et qui parle dans le talkie
  voice(v, sim, multi, dead = false) {
    this.keysLine(sim, multi);
    const el = this.$('#voiceTag');
    if (!el) return;
    const mode = v.mode;
    if (dead) {
      // coupure : on appuie sur le talkie, il ne se passe rien
      el.hidden = false;
      el.classList.add('radio');
      this.$('#voiceOut').textContent = 'RADIO · NO SIGNAL';
      this.$('#voiceBar').hidden = true;
      this.$('#voiceIn').textContent = '';
      return;
    }
    const names = v.talking().map((id) => {
      const Q = sim.players.find((q) => q.id === id);
      return Q ? Q.name : null;
    }).filter(Boolean);
    const show = mode > 0 || names.length > 0;
    el.hidden = !show;
    if (!show) return;
    el.classList.toggle('radio', mode === 2);
    this.$('#voiceOut').textContent = mode === 2 ? '● RADIO' : mode === 1 ? '● VOICE' : '';
    const bar = this.$('#voiceBar');
    bar.hidden = mode === 0;
    bar.firstChild.style.width = `${Math.round(Math.min(1, v.level) * 100)}%`;
    bar.classList.toggle('loud', v.level > 0.75);
    this.$('#voiceIn').textContent = names.length ? `RADIO · ${names.join(', ').toUpperCase()}` : '';
  }

  // le rappel des touches : interagir, utiliser, et le talkie à plusieurs (la voix de proximité n'a pas de touche)
  keysLine(sim, multi) {
    const el = this.$('#keysTag');
    if (!el) return;
    const P = sim.player;
    const on = !!P && P.status === 'alive' && P.hidden < 0 && !document.body.classList.contains('touch');
    const k = on ? `${multi ? 1 : 0}` : '';
    if (k === this.keysK) return;
    this.keysK = k;
    el.hidden = !on;
    if (!on) return;
    const keys = [['F', 'INTERACT'], ['E', 'USE']];
    if (multi) keys.push(['R', 'RADIO']);
    el.innerHTML = keys.map(([key, what]) => `<span><kbd>${key}</kbd>${what}</span>`).join('');
  }

  replayTag(on) {
    this.$('#replayTag').hidden = !on;
    clearInterval(this.replayI);
    if (!on) return;
    let k = 0;
    this.replayI = setInterval(() => {
      k = (k + 1) % 4;
      this.$('#replayClock').textContent = String(k);
    }, 1000);
  }

  // calibrage de la luminosité : trois carrés presque noirs, éclaircis comme l'image du jeu
  calibrate(v, quiet = false) {
    const el = this.$('#calib');
    const lv = [4, 12, 26];
    for (const box of [el, this.$('#tcCalib')]) {
      box.querySelectorAll('i').forEach((sq, i) => {
        const c = Math.round(255 * Math.pow(lv[i] / 255, 1 / v));
        sq.style.background = `rgb(${c},${c},${c})`;
      });
    }
    if (quiet) return;
    el.hidden = false;
    clearTimeout(this.calibT);
    this.calibT = setTimeout(() => (el.hidden = true), 2500);
  }

  // touche choisie par le joueur : ZQSD (AZERTY) ou WASD (QWERTY)
  keyNames(qwerty) {
    return qwerty ? { move: 'WASD', l: 'A', r: 'D', f: 'W' } : { move: 'ZQSD', l: 'Q', r: 'D', f: 'Z' };
  }

  prompt(sim, P) {
    const NAME = { bottle: 'ALMOND WATER', battery: 'BATTERIES', ladder: 'THE LADDER' };
    let text = '';
    let beam = null;
    if (P.status === 'alive' && sim.state === 'playing' && !(sim.departT > 0)) {
      const N = sim.fm(P.floor).niche;
      const nicheCas = N && sim.allCassettes.find((c) => c.id === N.cas);
      {
        if (P.onBeam) {
          // barre d'équilibre : le repère penche avec toi, Q et D le ramènent au milieu
          text = 'BALANCE · Z TO MOVE FORWARD, Q / D TO STEADY YOURSELF';
          beam = P.tilt || 0;
        }
        const it = sim.nearItem(P);
        const sel = P.inv[P.sel - 1];
        const h = P.hidden < 0 && sim.nearHide ? sim.nearHide(P) : null;
        const E1 = sim.level === 1 && sim.map.exit;
        const atPanel = E1 && !sim.powered && (sim.delivered || 0) >= 3 && Math.hypot(E1.x - P.x, E1.z - P.z) < 2.6;
        if (P.grabT > 0 || P.hidden >= 0) {
          // la prise et le casier ont leur propre affichage
        } else if (beam !== null) {
          // rien d'autre sur l'arête
        } else if (N && !N.ladder && sel === 'ladder' && Math.hypot(N.baseX - P.x, N.baseZ - P.z) < 2.2) text = 'PRESS E · PLACE THE LADDER UNDER THE TAPE';
        else if (it) text = P.inv.includes(null) ? `PRESS F · PICK UP ${NAME[it.kind]}` : `PRESS F · SWAP ${NAME[sel || 'bottle']} (SLOT ${P.sel + 1}) FOR ${NAME[it.kind]}`;
        else if (h) text = 'PRESS F · HIDE IN THE LOCKER';
        else if (sim.nearKey && sim.nearKey(P)) text = 'PRESS F · TAKE THE STAIRWELL KEY';
        else if (sim.lockedDoorNear && sim.lockedDoorNear(P)) text = 'LOCKED · FIND THE STAIRWELL KEY';
        else if (atPanel) text = `RESTARTING THE FREIGHT ELEVATOR… ${Math.round((sim.panel || 0) * 100)}% · STAY HERE`;
        else if (N && !N.ladder && nicheCas && !nicheCas.collected && Math.hypot(N.baseX - P.x, N.baseZ - P.z) < 2.6) text = 'THE TAPE IS TOO HIGH: YOU NEED A LADDER';
        // ce qu'on tient servirait maintenant : à bout de souffle avec de l'eau d'amande, la lampe presque vide avec des piles
        else if (sel === 'bottle' && P.stamina < 45) text = 'PRESS E · DRINK THE ALMOND WATER';
        else if (sel === 'battery' && P.hasLamp && P.battery < 35) text = 'PRESS E · CHANGE THE BATTERIES';
      }
    }
    if (this.qwerty) text = text.replace('Z TO MOVE FORWARD, Q / D', 'W TO MOVE FORWARD, A / D');
    this.show('prompt', !!text);
    if (text) this.text('promptText', text);
    this.show('beamBar', beam !== null);
    if (beam !== null) {
      const mark = this.E.beamBar.querySelector('i');
      mark.style.left = `${50 + beam * 50}%`;
      mark.classList.toggle('danger', Math.abs(beam) > 0.6);
    }
  }

  toast(text) {
    const t = this.$('#toast');
    t.textContent = text;
    t.hidden = false;
    this.toastT = 2.5;
  }

  // images du screamer selon le mode (normal / VIP) : à rappeler quand l'hôte lance une partie
  applyMonsters() {
    const img = this.$('#scareImg');
    if (img) { img.onerror = () => (img.hidden = true); img.hidden = false; img.src = ENTITY_IMG; }
    // celle du Level 1 : sa vidéo, qui continue de gesticuler en plein écran
    const A = ENTITY_ANIM;
    const anim = this.$('#scareAnim');
    anim.style.backgroundImage = `url("${A.url}")`;
    anim.style.backgroundSize = `${A.cols * 100}% ${A.rows * 100}%`;
    anim.style.aspectRatio = String(A.aspect);
  }

  // level : le screamer est celui de l'entité du level en cours
  // goat : percuté par une chèvre (Level 2) : pas de visage, l'éclair seul (la chèvre est dans la scène)
  showJumpscare(level = 0, goat = false, flat = false) {
    const j = this.$('#jumpscareOverlay');
    // l'entité surgit dans la scène (3D) : ici, seulement l'éclair rouge (sans éclair si on l'a demandé)
    j.classList.toggle('soft', !!this.reduceFlashes);
    j.classList.toggle('three', !flat && !goat);
    if (!flat && !goat) {
      const img = this.$('#scareImg');
      if (img) img.hidden = true;
      this.$('#scareAnim').hidden = true;
      // un cinquième de seconde de noir complet (le son coupe en même temps), puis l'éclair et elle
      j.hidden = false;
      j.classList.remove('flash');
      j.classList.add('pre');
      clearTimeout(this.scarePreT);
      this.scarePreT = setTimeout(() => {
        j.classList.remove('pre');
        void j.offsetWidth;
        j.classList.add('flash');
      }, 200);
      clearTimeout(this.scareHideT);
      this.scareHideT = setTimeout(() => (j.hidden = true), 1600);
      return;
    }
    const A = ENTITY_ANIM;
    const anim = this.$('#scareAnim');
    const img = this.$('#scareImg');
    anim.hidden = level !== 1 || goat;
    j.classList.toggle('goat', goat); // percuté : un éclair rouge par-dessus la scène, sans fond noir
    if (img) img.hidden = level === 1 || goat;
    clearInterval(this.scareTimer);
    if (level === 1) {
      let f = 0;
      const show = () => {
        anim.style.backgroundPosition = `${((f % A.cols) / (A.cols - 1)) * 100}% ${(Math.floor(f / A.cols) / (A.rows - 1)) * 100}%`;
        f = (f + 1) % A.frames;
      };
      show();
      this.scareTimer = setInterval(show, 1000 / A.fps);
      setTimeout(() => clearInterval(this.scareTimer), 1500);
    }
    j.hidden = false;
    j.classList.remove('flash');
    void j.offsetWidth;
    j.classList.add('flash');
    clearTimeout(this.scareHideT);
    this.scareHideT = setTimeout(() => {
      j.hidden = true;
    }, 1400);
  }

  // Level 2, attrapé par le troupeau : après le choc, l'image du bouc monte très lentement du noir, fixe, sombre et
  // rien d'autre à l'écran. Elle reste en fin de partie (gdHold) ; sinon elle s'efface et l'on devient spectateur.
  // delay : le temps du choc avant le noir
  showGoatDeath(delay = 0) {
    const el = this.$('#goatDeath');
    const img = this.$('#gdImg');
    const grain = this.$('#gdGrain');
    if (!grain.style.backgroundImage) {
      // un grain de bande, fixe (il ne bouge pas)
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      const d = g.createImageData(256, 256);
      for (let i = 0; i < d.data.length; i += 4) {
        const v = 128 + (Math.random() - 0.5) * 255;
        d.data[i] = v;
        d.data[i + 1] = v * 0.95;
        d.data[i + 2] = v * 0.9;
        d.data[i + 3] = 255;
      }
      g.putImageData(d, 0, 0);
      grain.style.backgroundImage = `url(${c.toDataURL()})`;
    }
    for (const k of ['gdT1', 'gdT3', 'gdOutT']) clearTimeout(this[k]);
    this.gdHold = false;
    this.gdActive = true;
    el.classList.remove('out');
    img.style.transition = 'none';
    img.style.opacity = '0';
    el.hidden = true;
    this.gdT1 = setTimeout(() => {
      el.hidden = false;
      void img.offsetWidth;
      img.style.transition = `opacity ${GOAT_DEATH_FADE}s cubic-bezier(0.6, 0, 0.8, 1)`;
      img.style.opacity = '1';
    }, delay * 1000);
    this.gdT3 = setTimeout(() => {
      if (this.gdHold) return;
      el.classList.add('out');
      this.gdOutT = setTimeout(() => this.hideGoatDeath(), 1600);
    }, (delay + 14) * 1000);
  }

  hideGoatDeath() {
    for (const k of ['gdT1', 'gdT3', 'gdOutT']) clearTimeout(this[k]);
    this.gdActive = false;
    this.gdHold = false;
    const el = this.$('#goatDeath');
    if (el) el.hidden = true;
  }

  // extra : { stats: { seen, rushes, escapes, closest, haunts }, daily: 'Nov 7' | null, best: secondes | null, replay: bool }
  showEnd(sim, onRestart, extra = {}) {
    const end = this.$('#endScreen');
    const title = this.$('#endTitle');
    const sub = this.$('#endSubtitle');
    const stats = this.$('#endStats');

    // laisser le jumpscare à l'écran avant la carte de fin
    // au Level 2, l'image du bouc reste derrière la carte de fin
    const goat = sim.state === 'dead' && this.gdActive;
    if (goat) this.gdHold = true;
    end.classList.toggle('over-goat', goat);
    // la carte de fin arrive après le choc ; au bout de 3 s, un clic ou une touche la fait venir tout de suite
    clearTimeout(this.endT);
    const reveal = () => {
      clearTimeout(this.endT);
      this.endPending = null;
      end.hidden = false;
    };
    this.endAt = performance.now();
    this.endPending = reveal;
    this.endT = setTimeout(reveal, goat ? 12500 : sim.state === 'dead' ? (extra.replay ? 5600 : 1300) : 300);
    // le bilan de la bande : ce qu'elle a vu de toi
    const S = extra.stats;
    const lines = [];
    if (S && sim.hasMonster && !sim.goats) {
      const times = (n, one) => (n === 1 ? one : `${n} times`);
      const seen = S.seen ? `IT SAW YOU ${times(S.seen, 'ONCE')}` : sim.state === 'dead' ? 'YOU NEVER SAW IT COMING' : 'IT NEVER SAW YOU';
      lines.push(`${seen} · CHASES ESCAPED ${S.escapes}${S.closest < 50 ? ` · CLOSEST CALL ${S.closest.toFixed(1)} M` : ''}`.toUpperCase());
      if (S.haunts) lines.push(`FROM THE OTHER SIDE: ${S.haunts} SIGN${S.haunts > 1 ? 'S' : ''} TO THE LIVING`);
    }
    if (extra.daily) lines.push(`DAILY MAP · ${extra.daily.toUpperCase()}${extra.best ? ` · YOUR BEST ${formatTime(extra.best)}` : ''}`);
    this.$('#endRun').textContent = lines.join('\n');

    const solo = sim.players.length === 1;
    const heard = tapesHeard().length;
    this.$('#endLore').textContent = `TAPES ARCHIVED · ${heard}/${LORE.length}`;
    const d = this.$('#tapeDate').textContent;
    if (sim.state === 'won') {
      const sl = slideOf(sim);
      if (sim.level === PIPES_LEVEL) {
        // la vraie fin : par le toboggan jaune et les tuyauteries
        title.textContent = solo ? 'YOU ESCAPED' : 'YOU ALL ESCAPED';
        title.style.color = '#22c55e';
        sub.textContent = 'The service elevator climbed for a long time. Then daylight, real daylight, through a crack in a door. Nobody is humming.';
        stats.textContent = `TRUE ENDING · ${formatTime(sim.time)} · Level 0, 1, 37 and 2 cleared`;
        this.$('#endTape').textContent = `${d} · FINAL TAPE · DO NOT ERASE`;
      } else {
        // la fausse sortie : rouge ou bleu… on se réveille sur la moquette du Level 0
        title.textContent = 'YOU WOKE UP';
        title.style.color = '#ffcf3a';
        sub.textContent = `The ${sl ? sl.name.toLowerCase() : ''} slide spat you out onto wet carpet. The lights hum. The wallpaper is yellow. Level 0, again. Maybe the yellow slide…`.replace('The  slide', 'The slide');
        stats.textContent = `LOOP ENDING · ${formatTime(sim.time)} · Level 0, 1 and 37 cleared`;
        this.$('#endTape').textContent = `${d} · TAPE ENDS · REWIND?`;
      }
    } else {
      title.textContent = solo ? 'YOU DIED' : 'NOBODY MADE IT OUT';
      title.style.color = '#ef4444';
      const PIPES = sim.level === PIPES_LEVEL;
      sub.textContent = PIPES ? 'The herd found you in the dark…' : sim.level === 1 ? 'The entity was waiting at the end of the shelves…' : 'The entity caught you in the endless hallways…';
      stats.textContent = `Level ${levelName(sim.level)} · ${PIPES ? `valves ${sim.valves}/4` : sim.level === 2 ? `valves ${sim.fuses}/3` : sim.level === 1 ? `fuses ${sim.delivered || 0}/3` : `tapes ${sim.cassettes}/5`} · Survived for ${formatTime(sim.time)}`;
      this.$('#endTape').textContent = `${d} · RECORDING STOPPED`;
    }

    // un invité attend que l'hôte relance une partie
    const btn = this.$('#btnRestart');
    btn.disabled = !onRestart;
    btn.textContent = onRestart ? 'PLAY AGAIN' : 'WAITING FOR THE HOST…';
    this.$('#btnRestart').onclick = () => {
      if (!onRestart) return;
      this.endPending = null;
      clearTimeout(this.endT);
      end.hidden = true;
      this.hideGoatDeath();
      this.lastCount = -1;
      if (onRestart) onRestart();
    };
  }

  // Fondu au noir : l'ascenseur descend, puis la carte de l'étage
  fade(title, sub = '', hold = 0, ride = false) {
    const f = this.$('#fade');
    this.fadeRide = ride;
    this.$('#fadeBarBox').hidden = !ride;
    if (ride) this.$('#fadeBar').style.width = '0%';
    this.$('#fadeTitle').textContent = title;
    this.$('#fadeSub').textContent = sub;
    f.classList.add('on');
    clearTimeout(this.fadeTimer);
    if (hold > 0) this.fadeTimer = setTimeout(() => f.classList.remove('on'), hold * 1000);
  }

  // pause ; avant la toute première prise en main, c'est l'écran titre (et « Continuer » si une partie s'est arrêtée
  // plus loin, en solo)
  showPause(visible, kb, title = false, resume = null) {
    this.$('#clickPrompt').style.display = visible ? 'block' : 'none';
    this.$('#clickPrompt').classList.toggle('title', !!title);
    this.$('#titleCard').hidden = !title;
    this.$('#pauseTitle').hidden = !!title;
    const btn = this.$('#btnContinue');
    btn.hidden = !(title && resume);
    if (resume) btn.textContent = `▶▶ CONTINUE FROM LEVEL ${levelName(resume)}`;
    const tactile = document.body.classList.contains('touch') || matchMedia('(pointer: coarse)').matches;
    this.$('#pauseGo').textContent = tactile ? 'TAP THE SCREEN TO PLAY' : kb ? 'PRESS ENTER TO PLAY' : title ? 'CLICK TO PRESS PLAY' : 'CLICK TO TAKE CONTROL';
    const mv = this.qwerty ? 'WASD' : 'ZQSD';
    this.$('#pauseKeys').textContent = kb
      ? `${mv} move · Arrows look · Shift run · C crouch · 1 flashlight · 2 3 select · E use · F pick up / hide · T whistle · Esc pause`
      : `${mv} move · Mouse look · Shift run · C crouch · 1 flashlight · 2 3 select · E use · F pick up / hide · T whistle · Esc pause`;
    for (const b of this.el.querySelectorAll('button[data-kb]')) b.classList.toggle('on', (b.dataset.kb === '1') === kb);
  }
}

function formatTime(t) {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
