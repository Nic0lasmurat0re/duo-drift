// The Backrooms - Voix de proximité et talkie-walkie
//
// Chaque paire de joueurs ouvre une liaison WebRTC audio (pair à pair) ; la signalisation passe par le salon (messages
// 'rtc'). Le plus petit identifiant fait l'offre ; l'autre répond. La piste du micro se remplit (ou se vide) sans
// renégocier : replaceTrack sur l'émetteur.
//
// Ce qu'on émet (mode) : 0 rien, 1 la voix (on t'entend autour de toi), 2 le talkie (tous les vivants, n'importe où).
// À l'arrivée : la voix est placée dans le monde (panoramique 3D), s'éteint avec la distance (VOICE_R), passe mal les
// murs et très mal les planchers ; le talkie sort du haut-parleur de ta ceinture, en bande étroite, saturé, avec le
// grésillement et le « kshh » au début et à la fin. Les morts ne se font plus entendre des vivants (eux entendent tout).
//
// Le niveau du micro (0 à 1) part chez l'hôte : parler fait du bruit, et l'entité écoute.

import { hasLineOfSight } from '../engine/nav.js';

export const VOICE_R = 22; // m : au-delà, on ne s'entend plus de vive voix
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const RETRY = 8; // s : une liaison qui ne s'établit pas est refaite

export function createVoice({ send, myId, sfx }) {
  const peers = new Map(); // id -> liaison
  let stream = null;
  let track = null;
  let analyser = null;
  let buf = null;
  let bus = null; // sortie des voix (réglée par le curseur « Voix »)
  let micState = 'off'; // 'off' | 'asking' | 'on' | 'denied'
  let mode = 0; // ce que j'émets
  let level = 0; // niveau du micro (lissé)
  let hang = 0; // micro ouvert : on garde la voix ouverte un instant après la dernière syllabe
  let volume = 1;
  let losT = 0;
  const ctxOf = () => sfx && sfx.ctx;

  // la sortie des voix : directement vers les haut-parleurs (pas de coupure de jumpscare ni d'effets d'ambiance)
  function out() {
    const c = ctxOf();
    if (!c) return null;
    // le son du jeu a été recréé : tout se rebranche sur le nouveau
    if (bus && bus.context !== c) {
      bus = null;
      verb = verbIr = verbIn = verbOut = null;
      hiss = null;
      analyser = null;
      for (const p of peers.values()) if (p.chain) { p.pending = p.stream; p.chain = null; }
    }
    if (!bus) {
      bus = c.createGain();
      bus.gain.value = volume;
      bus.connect(c.destination);
      // l'écho des couloirs pour les voix de vive voix : la même réponse de salle que les bruits du niveau
      verbIn = c.createGain();
      verbOut = c.createBiquadFilter();
      verbOut.type = 'lowpass';
      verbOut.frequency.value = 3800;
      const wet = c.createGain();
      wet.gain.value = 0.4; // comme l'écho des bruits du Level 0
      verbOut.connect(wet).connect(bus);
    }
    // la salle change avec le niveau : un nouveau convoluteur quand la réponse de sfx change
    const ir = sfx.verb && sfx.verb.buffer;
    if (ir && ir !== verbIr) {
      if (verb) { try { verbIn.disconnect(verb); verb.disconnect(); } catch (e) {} }
      verb = c.createConvolver();
      verb.buffer = ir;
      verbIr = ir;
      verbIn.connect(verb).connect(verbOut);
    }
    return bus;
  }
  let verbIn = null;
  let verbOut = null;
  let verb = null;
  let verbIr = null;

  async function enableMic() {
    if (stream || micState === 'asking') return micState === 'on';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      micState = 'denied';
      return false;
    }
    micState = 'asking';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      micState = 'denied';
      return false;
    }
    track = stream.getAudioTracks()[0];
    track.enabled = false;
    micState = 'on';
    for (const p of peers.values()) if (p.tr) p.tr.sender.replaceTrack(track).catch(() => {});
    return true;
  }

  function meter() {
    const c = ctxOf();
    if (!c || !stream) return 0;
    if (!analyser) {
      analyser = c.createAnalyser();
      analyser.fftSize = 1024;
      buf = new Float32Array(analyser.fftSize);
      c.createMediaStreamSource(stream).connect(analyser);
    }
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / buf.length);
    // ~0,01 : un murmure ; ~0,1 : une voix normale ; 0,3 et plus : on crie
    return Math.max(0, Math.min(1, (Math.log10(rms + 1e-5) + 2.2) / 1.8));
  }

  function closePeer(p) {
    try { p.pc.close(); } catch (e) {}
    if (p.el) { p.el.srcObject = null; p.el = null; }
    if (p.chain) { try { p.chain.src.disconnect(); p.chain.wob.stop(); } catch (e) {} p.chain = null; }
  }

  function makePc(p) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    p.pc = pc;
    p.queue = [];
    p.born = performance.now() / 1000;
    pc.onicecandidate = ({ candidate }) => { if (candidate) send(p.id, { t: 'rtc', n: p.n, c: candidate.toJSON() }); };
    pc.ontrack = (e) => wire(p, e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]));
    return pc;
  }

  // le plus petit identifiant appelle
  async function call(p) {
    if (p.pc) closePeer(p);
    p.n = (Math.random() * 1e9) | 0;
    const pc = makePc(p);
    p.tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
    if (track) p.tr.sender.replaceTrack(track).catch(() => {});
    try {
      await pc.setLocalDescription(await pc.createOffer());
      send(p.id, { t: 'rtc', n: p.n, d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
    } catch (e) {}
  }

  // signalisation reçue d'un autre joueur
  async function onSignal(from, m) {
    if (!window.RTCPeerConnection || from === myId) return;
    let p = peers.get(from);
    if (!p) {
      p = { id: from, mode: 0, pc: null };
      peers.set(from, p);
    }
    try {
      if (m.d && m.d.type === 'offer') {
        // une nouvelle offre remplace toujours l'ancienne liaison
        if (p.pc) closePeer(p);
        p.n = m.n;
        const pc = makePc(p);
        await pc.setRemoteDescription(m.d);
        p.tr = pc.getTransceivers()[0];
        if (p.tr) {
          p.tr.direction = 'sendrecv';
          if (track) p.tr.sender.replaceTrack(track).catch(() => {});
        }
        await pc.setLocalDescription(await pc.createAnswer());
        send(from, { t: 'rtc', n: p.n, d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        for (const c of p.queue.splice(0)) pc.addIceCandidate(c).catch(() => {});
      } else if (m.d && m.d.type === 'answer') {
        if (!p.pc || m.n !== p.n || p.pc.signalingState !== 'have-local-offer') return;
        await p.pc.setRemoteDescription(m.d);
        for (const c of p.queue.splice(0)) p.pc.addIceCandidate(c).catch(() => {});
      } else if (m.c) {
        if (!p.pc || m.n !== p.n) return;
        if (p.pc.remoteDescription) p.pc.addIceCandidate(m.c).catch(() => {});
        else p.queue.push(m.c);
      }
    } catch (e) {}
  }

  // la voix d'un joueur arrive : deux chemins, de vive voix (placée dans le monde) et par le talkie
  function wire(p, ms) {
    const c = ctxOf();
    const o = out();
    if (!c || !o) {
      p.pending = ms;
      return;
    }
    p.pending = null;
    p.stream = ms;
    if (p.chain) { try { p.chain.src.disconnect(); p.chain.wob.stop(); } catch (e) {} }
    // Chrome ne fait couler une piste distante dans Web Audio que si un élément audio la lit (muet)
    p.el = new Audio();
    p.el.srcObject = ms;
    p.el.muted = true;
    p.el.play().catch(() => {});
    const src = c.createMediaStreamSource(ms);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 18000;
    const pg = c.createGain();
    pg.gain.value = 0;
    const pan = c.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'linear';
    pan.rolloffFactor = 0; // la distance, on la règle nous-mêmes (murs, étages)
    src.connect(lp).connect(pg).connect(pan).connect(o);
    // la réverbération : une part de la voix part dans l'écho des couloirs, d'autant plus qu'elle vient de loin
    const vs = c.createGain();
    vs.gain.value = 0;
    pg.connect(vs).connect(verbIn);
    // le talkie : bande étroite (pas de graves, pas d'aigus), un médium nasillard poussé, saturé et un peu
    // « en escalier » (le petit convertisseur), qui flotte (la modulation de la porteuse) ; le grésillement et les
    // coupures, eux, dépendent de la distance (dans update)
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 520;
    hp.Q.value = 0.9;
    const peak = c.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 1650;
    peak.Q.value = 1.3;
    peak.gain.value = 9;
    const bp = c.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 2600;
    bp.Q.value = 1.1;
    const sh = c.createWaveShaper();
    const k = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const v = Math.tanh(((i / 1023) * 2 - 1) * 5) / Math.tanh(5);
      k[i] = Math.round(v * 18) / 18;
    }
    sh.curve = k;
    sh.oversample = 'none';
    const am = c.createGain();
    am.gain.value = 0.85;
    const wob = c.createOscillator();
    wob.frequency.value = 6.3;
    const wobG = c.createGain();
    wobG.gain.value = 0.12;
    wob.connect(wobG).connect(am.gain);
    wob.start();
    const rg = c.createGain();
    rg.gain.value = 0;
    src.connect(hp).connect(peak).connect(bp).connect(sh).connect(am).connect(rg).connect(o);
    p.chain = { src, lp, pg, pan, rg, hp, vs, wob, drop: 0 };
  }

  // le grésillement du talkie quand quelqu'un parle dedans (un seul, partagé)
  let hiss = null;
  function hissOn(on) {
    const c = ctxOf();
    const o = out();
    if (!c || !o) return;
    if (!hiss) {
      const n = c.createBufferSource();
      const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      n.buffer = b;
      n.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2200;
      f.Q.value = 0.6;
      const g = c.createGain();
      g.gain.value = 0;
      n.connect(f).connect(g).connect(o);
      n.start();
      hiss = g;
    }
    hiss.gain.setTargetAtTime(on ? 0.016 + on * 0.032 : 0, c.currentTime, 0.04);
  }

  // Le haut-parleur du talkie pour les sons qui ne viennent de personne (les parasites) : la même bande étroite, le
  // même médium nasillard, la même saturation que les voix
  let fx = null;
  function fxIn() {
    const c = ctxOf();
    const o = out();
    if (!c || !o) return null;
    if (fx && fx.context === c) return fx;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 520;
    const pk = c.createBiquadFilter();
    pk.type = 'peaking';
    pk.frequency.value = 1650;
    pk.Q.value = 1.3;
    pk.gain.value = 9;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const sh = c.createWaveShaper();
    const k = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) k[i] = Math.round((Math.tanh(((i / 1023) * 2 - 1) * 5) / Math.tanh(5)) * 18) / 18;
    sh.curve = k;
    const g = c.createGain();
    g.gain.value = 0.45; // les parasites restent sous les voix : ils inquiètent, ils ne vrillent pas les oreilles
    hp.connect(pk).connect(lp).connect(sh).connect(g).connect(o);
    fx = hp;
    return fx;
  }
  let nbuf = null;
  function noiseSrc(c) {
    if (!nbuf || nbuf.sampleRate !== c.sampleRate) {
      nbuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = nbuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const n = c.createBufferSource();
    n.buffer = nbuf;
    n.loop = true;
    return n;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  // des craquements hachés : la porteuse qui accroche et décroche
  function crackle(t, dur, vol) {
    const c = ctxOf();
    const i = fxIn();
    if (!i) return;
    const n = noiseSrc(c);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    for (let k = t; k < t + dur; k += rnd(0.012, 0.05)) g.gain.setValueAtTime(Math.random() < 0.55 ? vol * rnd(0.3, 1) : 0, k);
    g.gain.setValueAtTime(0, t + dur);
    n.connect(g).connect(i);
    n.start(t, Math.random());
    n.stop(t + dur + 0.05);
  }

  // une respiration lente, collée au micro de quelqu'un… qui n'est pas de l'équipe
  function breathing(t) {
    const c = ctxOf();
    const i = fxIn();
    if (!i) return 0;
    for (const [k, f0, f1, d, v] of [[0, 360, 230, 1.5, 0.5], [1.7, 520, 290, 1.2, 0.3], [3.3, 340, 220, 1.6, 0.55], [5.1, 500, 280, 1.3, 0.35]]) {
      const n = noiseSrc(c);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(f0 * 2.4, t + k);
      bp.frequency.linearRampToValueAtTime(f1 * 2.4, t + k + d);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t + k);
      g.gain.linearRampToValueAtTime(v, t + k + d * 0.35);
      g.gain.linearRampToValueAtTime(0.0001, t + k + d);
      n.connect(bp).connect(g).connect(i);
      n.start(t + k, Math.random());
      n.stop(t + k + d + 0.05);
    }
    crackle(t + 6.2, 0.35, 0.6);
    return 6.6;
  }

  // une voix grave et hachée, des syllabes qui ne veulent rien dire, et qui ralentit à la fin
  function garbled(t) {
    const c = ctxOf();
    const i = fxIn();
    if (!i) return 0;
    const D = rnd(1.8, 2.8);
    const vo = c.createOscillator();
    vo.type = 'sawtooth';
    vo.frequency.setValueAtTime(rnd(82, 104), t);
    vo.frequency.setValueAtTime(rnd(82, 104), t + D * 0.6);
    vo.frequency.exponentialRampToValueAtTime(52, t + D);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    const f1 = c.createBiquadFilter();
    const f2 = c.createBiquadFilter();
    f1.type = f2.type = 'bandpass';
    f1.Q.value = 7;
    f2.Q.value = 9;
    const vowels = [[700, 1150], [320, 2300], [480, 900], [420, 1750], [600, 1000]];
    for (let k = t; k < t + D; k += rnd(0.11, 0.24)) {
      const [a, b] = vowels[(Math.random() * vowels.length) | 0];
      f1.frequency.setValueAtTime(a, k);
      f2.frequency.setValueAtTime(b, k);
      env.gain.setValueAtTime(Math.random() < 0.8 ? rnd(0.5, 1) : 0, k);
      env.gain.setTargetAtTime(0.05, k + 0.06, 0.05);
    }
    env.gain.setValueAtTime(0, t + D);
    const g2 = c.createGain();
    g2.gain.value = 0.7;
    vo.connect(f1).connect(env);
    vo.connect(f2).connect(g2).connect(env);
    env.connect(i);
    vo.start(t);
    vo.stop(t + D + 0.05);
    crackle(t - 0.1, D + 0.3, 0.25);
    return D + 0.3;
  }

  // trois bips qui descendent, comme un appel, puis rien que du souffle
  function beeps(t) {
    const c = ctxOf();
    const i = fxIn();
    if (!i) return 0;
    [1040, 880, 620].forEach((f, k) => {
      const o = c.createOscillator();
      o.frequency.value = f;
      const g = c.createGain();
      const t0 = t + k * 0.42;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.25, t0 + 0.01);
      g.gain.setValueAtTime(0.25, t0 + 0.2);
      g.gain.linearRampToValueAtTime(0, t0 + 0.22);
      o.connect(g).connect(i);
      o.start(t0);
      o.stop(t0 + 0.25);
    });
    crackle(t + 1.4, 1.6, 0.2);
    return 3.1;
  }

  // un parasite dans le talkie : rien ne l'explique ; plus elle est près, plus c'est elle qu'on entend
  let parT = rnd(25, 60);
  let parBusy = 0;
  function parasite(danger) {
    const c = ctxOf();
    if (!c || !fxIn()) return;
    const t = c.currentTime + 0.05;
    const r = Math.random();
    const close = danger > 0.35;
    let dur;
    let cap;
    if (close ? r < 0.4 : r < 0.12) {
      dur = breathing(t + 0.12);
      cap = '[slow breathing on the radio]';
    } else if (close ? r < 0.75 : r < 0.35) {
      dur = garbled(t + 0.12);
      cap = '[a garbled voice on the radio]';
    } else if (r < 0.55) {
      dur = beeps(t + 0.12);
      cap = '[the radio beeps]';
    } else {
      dur = rnd(0.5, 1.6);
      crackle(t + 0.05, dur, 0.4);
      cap = '[radio static]';
    }
    squelch(true, 0.055);
    parBusy = dur + 0.3;
    setTimeout(() => squelch(false, 0.055), (dur + 0.15) * 1000);
    if (sfx.caption) sfx.caption(cap, null);
  }

  // la coupure : un dernier râle de la porteuse, puis plus rien
  function radioDies() {
    const c = ctxOf();
    if (!c || !fxIn()) return;
    const t = c.currentTime + 0.02;
    crackle(t, 0.7, 0.7);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(fxIn());
    o.start(t);
    o.stop(t + 0.65);
  }
  let radioWas = true;

  // « kshh » : le bouton du talkie, l'ouverture (ou la fin) de la transmission
  function squelch(open, vol = 0.12) {
    const c = ctxOf();
    const o = out();
    if (!c || !o) return;
    const t = c.currentTime;
    const n = c.createBufferSource();
    const len = (open ? 0.09 : 0.16) * c.sampleRate;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    n.buffer = b;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = open ? 1800 : 2600;
    const g = c.createGain();
    g.gain.value = vol;
    n.connect(f).connect(g).connect(o);
    n.start(t);
    const bl = c.createOscillator();
    bl.frequency.value = open ? 1250 : 900;
    const bg = c.createGain();
    bg.gain.setValueAtTime(vol * 0.25, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    bl.connect(bg).connect(o);
    bl.start(t);
    bl.stop(t + 0.07);
  }

  return {
    get micState() { return micState; },
    get mode() { return mode; },
    get level() { return mode ? level : 0; },
    enableMic,
    setVolume(v) {
      volume = v;
      if (bus) bus.gain.value = v;
    },

    // les joueurs de la partie (identifiants) : on appelle ceux qui ont un identifiant plus grand
    sync(ids) {
      if (!window.RTCPeerConnection) return;
      const want = new Set(ids.filter((id) => id !== myId));
      for (const [id, p] of peers) if (!want.has(id)) { closePeer(p); peers.delete(id); }
      for (const id of want) {
        let p = peers.get(id);
        if (!p) {
          p = { id, mode: 0, pc: null };
          peers.set(id, p);
          if (myId < id) call(p);
        }
      }
    },

    onMessage(from, m) {
      if (m.t === 'rtc') onSignal(from, m);
      else if (m.t === 'vx') {
        const p = peers.get(from);
        if (!p) return;
        const was = p.mode;
        p.mode = m.m === 2 ? 2 : m.m === 1 ? 1 : 0;
        if (was !== p.mode && (was === 2 || p.mode === 2)) p.radioEdge = p.mode === 2 ? 'open' : 'close';
      }
    },

    // à chaque image. want : 0 ou 2 (talkie, R maintenu) ; open : la voix de proximité, toujours ouverte (sans touche)
    // sim, V : la partie et le joueur dont on écoute (soi, ou celui qu'on regarde une fois mort) ; alive : soi vivant
    // radio : { ok (le talkie marche), danger (l'entité près de soi, 0 à 1), live (partie en cours, pas en pause) }
    update(sim, V, dt, want, open, alive, radio = { ok: true, danger: 0, live: true }) {
      const now = performance.now() / 1000;
      const radioOk = radio.ok !== false;
      if (want === 2 && !radioOk) want = 0; // coupure : on appuie, rien ne part
      // le micro : niveau et ce qu'on émet
      const raw = micState === 'on' ? meter() : 0;
      level += (raw - level) * Math.min(1, dt * (raw > level ? 25 : 6));
      if (want === 0 && open && micState === 'on') {
        if (level > 0.3) hang = 0.6;
        else hang = Math.max(0, hang - dt);
        want = hang > 0 ? 1 : 0;
      }
      if (micState !== 'on') want = 0;
      if (want !== mode) {
        if (want === 2 || mode === 2) squelch(want === 2, 0.08);
        mode = want;
        for (const id of peers.keys()) send(id, { t: 'vx', m: mode });
      }
      if (track) track.enabled = mode > 0 || (open && micState === 'on');

      // les voix des autres
      const c = ctxOf();
      if (!c) return;
      losT -= dt;
      const checkLos = losT <= 0;
      if (checkLos) losT = 0.2;
      let rx = 0;
      // la coupure, puis le retour du courant
      if (radioOk !== radioWas) {
        radioWas = radioOk;
        if (!radioOk && alive) radioDies();
        else if (radioOk && alive) squelch(false, 0.06);
      }
      // les parasites : de temps en temps, plus souvent quand elle rôde ; jamais en coupure, jamais mort
      parBusy = Math.max(0, parBusy - dt);
      if (alive && radioOk && radio.live && parBusy <= 0) {
        parT -= dt * (1 + (radio.danger || 0) * 2.5);
        if (parT <= 0) {
          parT = rnd(35, 110);
          parasite(radio.danger || 0);
        }
      }
      for (const p of peers.values()) {
        if (p.pending) wire(p, p.pending);
        // une liaison qui ne s'établit pas : on la refait
        if (p.pc && myId < p.id && p.pc.connectionState !== 'connected' && now - p.born > RETRY) call(p);
        if (!p.chain) continue;
        const Q = sim && sim.players.find((q) => q.id === p.id);
        const t = c.currentTime;
        let near = 0;
        let rad = 0;
        if (Q && V) {
          const ghost = Q.status === 'dead' && alive; // les morts ne parlent plus aux vivants
          if (!ghost) {
            if (p.mode === 2 && !radioOk) {
              // coupure : la voix du talkie ne passe plus
            } else if (p.mode === 2) {
              // de loin (et d'un étage à l'autre), la liaison est mauvaise : plus de souffle, des trous dans la voix
              const d = Math.hypot(Q.x - V.x, Q.z - V.z) + ((Q.floor || 0) !== (V.floor || 0) ? 40 : 0);
              const bad = Math.min(1, d / 120);
              p.bad = bad;
              p.chain.drop -= dt;
              if (p.chain.drop < -0.25 && Math.random() < dt * (0.3 + bad * 4)) p.chain.drop = 0.04 + Math.random() * 0.1 * (0.5 + bad);
              rad = p.chain.drop > 0 ? 0.08 : 1.15 - bad * 0.25;
            } else {
              const d = Math.hypot(Q.x - V.x, Q.z - V.z);
              const floors = (Q.floor || 0) !== (V.floor || 0);
              near = Math.pow(Math.max(0, 1 - d / VOICE_R), 1.3) * (floors ? 0.3 : 1);
              if (checkLos) {
                const map = sim.fm ? sim.fm(V.floor || 0) : sim.map;
                const los = !floors && d < VOICE_R && hasLineOfSight(map, V.x, V.z, Q.x, Q.z);
                p.chain.lp.frequency.setTargetAtTime(floors ? 450 : los ? 18000 : 1100, t, 0.08);
                p.los = los;
              }
              if (!floors && !p.los) near *= 0.65;
              sfx.moveTo(p.chain.pan, Q.x, Q.z, 0.05);
            }
          }
        }
        if (p.radioEdge) {
          squelch(p.radioEdge === 'open');
          p.radioEdge = null;
        }
        if (rad) rx = Math.max(rx, 0.2 + (p.bad || 0));
        p.chain.pg.gain.setTargetAtTime(near * 1.4, t, 0.05);
        // plus elle vient de loin, plus on entend l'écho autour d'elle (au loin, presque que lui)
        if (Q && V) {
          const d = Math.hypot(Q.x - V.x, Q.z - V.z);
          p.chain.vs.gain.setTargetAtTime(near > 0 ? 0.35 + Math.min(1, d / VOICE_R) * 0.65 : 0, t, 0.1);
        }
        p.chain.rg.gain.setTargetAtTime(rad, t, 0.03);
      }
      // tout près d'elle, le talkie capte des interférences, même quand personne ne parle
      const near = alive && radioOk ? Math.max(0, ((radio.danger || 0) - 0.45) / 0.55) : 0;
      if (near > 0 && Math.random() < dt * near * 6) crackle(c.currentTime + 0.01, rnd(0.05, 0.25), 0.15 + near * 0.2);
      hissOn(Math.max(rx, near * 0.5, parBusy > 0 ? 0.2 : 0));
    },

    // (tests) l'état des liaisons
    links() {
      return [...peers.values()].map((p) => ({ id: p.id, state: p.pc ? p.pc.connectionState : 'none', audio: !!p.chain, mode: p.mode }));
    },

    // (tests) un parasite tout de suite
    parasite(danger = 0) {
      parasite(danger);
    },

    // qui parle au talkie en ce moment (identifiants)
    talking() {
      return [...peers.values()].filter((p) => p.mode === 2).map((p) => p.id);
    },

    dispose() {
      for (const p of peers.values()) closePeer(p);
      peers.clear();
      if (stream) for (const tr of stream.getTracks()) tr.stop();
      stream = null;
      track = null;
      micState = 'off';
    },
  };
}
