// Tests unitaires du moteur des Backrooms : node tools/test-backrooms.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBackroomsMap, CELL_SIZE, T } from '../backrooms/engine/map.js';
import { findPath, hasLineOfSight } from '../backrooms/engine/nav.js';
import { BackroomsSim, CALM_HOLD, HAUNT_COOLDOWN, DT, DEPART_T, BOARD_T, FUSES, WHISTLE_CD, GRAB_T, MONSTER_STUN_T, NOISE, PANEL_T, stairAt, stairLocal, feetY, mapPrint } from '../backrooms/engine/sim.js';
import { hideFront } from '../backrooms/engine/hides.js';
import { PIT_HALF, bfs, createLevel0, FLOOR_DY } from '../backrooms/engine/map.js';

// distance en marche (en cases) entre deux cases
// les tests du comportement de l'entité la veulent présente dès le départ : le prélude a son propre test
BackroomsSim.PRELUDE = false;
const bfsDist = (m, ax, az, bx, bz) => bfs(m.grid, m.W, m.H, ax, az)[bz * m.W + bx];

// amène un joueur sur une cassette, à son étage (celle du renfoncement : échelle posée, au pied de l'échelle)
const putOn = (sim, P, cas) => {
  P.floor = Math.max(0, sim.floors.findIndex((f) => (f.cassettes || []).includes(cas)));
  if (cas.high) {
    sim.fm(P.floor).niche.ladder = true;
    P.x = sim.fm(P.floor).niche.baseX;
    P.z = sim.fm(P.floor).niche.baseZ;
  } else {
    P.x = cas.x;
    P.z = cas.z;
  }
};
import { createWarehouseMap } from '../backrooms/engine/level1.js';
import { createPoolMap } from '../backrooms/engine/poolrooms.js';

// avance la partie de n secondes
const run = (sim, sec, input = {}, others = null) => {
  for (let i = 0; i < Math.round(sec / DT); i++) sim.step(input, others);
};

let count = 0;
function test(name, fn) {
  try {
    fn();
    count++;
    console.log('✓', name);
  } catch (err) {
    console.error('✗', name);
    throw err;
  }
}

const map = createBackroomsMap(42);

test('génération de la carte : dimensions, sols, murs et pièces', () => {
  assert.equal(map.W, 64);
  assert.equal(map.H, 64);
  assert.ok(map.walkable.length > 1500, 'au moins 1500 cases praticables');
  assert.equal(map.isWall(map.spawn.gx, map.spawn.gz), false, 'le spawn est sur du sol');
  assert.equal(map.isWall(map.exit.gx, map.exit.gz), false, 'la sortie est sur du sol');
});

test('cassettes VHS : 7 cassettes placées et atteignables', () => {
  assert.equal(map.cassettes.length, 7, 'exactement 7 cassettes');
  for (const cas of map.cassettes) {
    assert.equal(map.isWall(cas.gx, cas.gz), false, `la cassette ${cas.id} n'est pas dans un mur`);
    const path = findPath(map, map.spawn.x, map.spawn.z, cas.x, cas.z);
    assert.ok(path, `un chemin existe du spawn vers la cassette ${cas.id}`);
  }
});

test('sortie : atteignable depuis le spawn', () => {
  const pathToExit = findPath(map, map.spawn.x, map.spawn.z, map.exit.x, map.exit.z);
  assert.ok(pathToExit, 'un chemin existe jusqu\'à la sortie');
  assert.ok(pathToExit.length > 5, 'la sortie n\'est pas collée au spawn');
});

test('champ de vision et raymarching : détection d\'obstacles', () => {
  // Même position : visible
  assert.ok(hasLineOfSight(map, 10, 10, 10, 10));
  // À travers le spawn dans la même pièce : visible
  assert.ok(hasLineOfSight(map, map.spawn.x, map.spawn.z, map.spawn.x + 0.5, map.spawn.z + 0.5));
});

test('simulation : déplacement du joueur et collisions murales', () => {
  const sim = new BackroomsSim({ map, difficulty: 'peaceful' });
  const startX = sim.player.x;
  const startZ = sim.player.z;

  // Avancer pendant 30 ticks
  for (let i = 0; i < 30; i++) {
    sim.step({ my: 1, yaw: 0 }); // avancer droit
  }
  assert.notEqual(sim.player.z, startZ, 'le joueur a avancé');
});

test('endurance : courir consomme la stamina, l\'arrêt la recharge', () => {
  const sim = new BackroomsSim({ map, difficulty: 'peaceful' });
  assert.equal(sim.player.stamina, 100);

  // Courir
  for (let i = 0; i < 30; i++) {
    sim.step({ my: 1, run: true });
  }
  assert.ok(sim.player.stamina < 100, 'la stamina a diminué en courant');
  assert.equal(sim.player.running, true);

  // S'arrêter
  const staminaAfterRun = sim.player.stamina;
  for (let i = 0; i < 30; i++) {
    sim.step({ my: 0, run: false });
  }
  assert.ok(sim.player.stamina > staminaAfterRun, 'la stamina s\'est régénérée au repos');
});

test("ramassage des 7 cassettes, l'ascenseur s'ouvre et descend au Level 1", () => {
  const map = createBackroomsMap(42);
  const sim = new BackroomsSim({ map, difficulty: 'peaceful' });
  assert.equal(sim.cassettes, 0);
  assert.ok(map.elevator, "l'ascenseur est creusé dans un mur");
  assert.equal(map.grid[map.elevator.gz * map.W + map.elevator.gx], T.EXIT);
  // fermé : la cabine est un mur
  assert.ok(sim.isColliding(map.elevator.x, map.elevator.z, 0.3));

  // Téléporter sur chaque cassette pour la ramasser
  for (const cas of map.cassettes) {
    putOn(sim, sim.player, cas);
    sim.step();
    assert.ok(cas.collected, `la cassette ${cas.id} a été ramassée`);
  }

  assert.equal(sim.cassettes, 7);
  const events = sim.drainEvents();
  assert.ok(events.some((e) => e.type === 'exitUnlocked'), 'événement exitUnlocked émis');
  assert.ok(!sim.isColliding(map.elevator.x, map.elevator.z, 0.3), "ouvert : on peut entrer dans la cabine");

  // de l'entrée, on marche dans la cabine
  sim.player.x = map.exit.x;
  sim.player.z = map.exit.z;
  sim.player.yaw = Math.atan2(-map.elevator.dx, -map.elevator.dz);
  for (let i = 0; i < 120 && sim.player.status === 'alive'; i++) sim.step({ my: 1, yaw: sim.player.yaw });
  assert.equal(sim.player.status, 'elevator', 'le joueur est dans la cabine');
  assert.ok(sim.drainEvents().some((e) => e.type === 'depart'), "seul, l'ascenseur part tout de suite");
  run(sim, DEPART_T + 0.2);
  assert.equal(sim.state, 'playing');
  assert.equal(sim.level, 1, 'arrivée au Level 1');
  assert.equal(sim.map.level, 1);
  assert.equal(sim.player.status, 'alive');
  assert.ok(sim.drainEvents().some((e) => e.type === 'level'));
});

test('l\'entité : calcul du danger sonore selon la distance et course-poursuite', () => {
  const sim = new BackroomsSim({ map, difficulty: 'normal' });
  assert.ok(sim.hasMonster);

  // Loin : danger à 0
  sim.monster.x = map.spawn.x + 50;
  sim.monster.z = map.spawn.z + 50;
  sim.step();
  assert.equal(sim.monster.danger, 0, 'aucun bruit de monstre à plus de 35 m');

  // Rapproché à 10 m : danger monte
  sim.monster.x = sim.player.x + 10;
  sim.monster.z = sim.player.z;
  sim.step();
  assert.ok(sim.monster.danger > 0.2, 'le son s\'amplifie à 10 m');

  // Très proche à 2 m : danger très élevé (> 0.8)
  sim.monster.x = sim.player.x + 2;
  sim.monster.z = sim.player.z;
  sim.step();
  assert.ok(sim.monster.danger > 0.7, 'le son devient assourdissant à 2 m');

  // Contact : elle l'agrippe d'abord ; sans se débattre, c'est la fin
  sim.monster.x = sim.player.x + 0.5;
  sim.monster.z = sim.player.z + 0.5;
  sim.step();
  assert.ok(sim.player.grabT > 0, 'le contact est une prise, pas une mort immédiate');
  assert.equal(sim.monster.mode, 'grab');
  assert.ok(sim.drainEvents().some((e) => e.type === 'grab'));
  run(sim, GRAB_T + 0.2);
  assert.equal(sim.state, 'dead', 'le joueur meurt s\'il ne se débat pas');
  assert.equal(sim.player.status, 'dead');
  const events = sim.drainEvents();
  assert.ok(events.some((e) => e.type === 'jumpscare'), 'jumpscare déclenché à la mort');
});

test('la prise : se débattre libère, la seconde prise est mortelle', () => {
  const sim = new BackroomsSim({ map, difficulty: 'normal' });
  const P = sim.player;
  sim.monster.x = P.x + 0.5;
  sim.monster.z = P.z;
  sim.step();
  assert.ok(P.grabT > 0);
  for (let i = 0; i < 12 && P.grabT > 0; i++) sim.step({ struggle: 1 });
  assert.equal(P.grabT, 0, 'on se dégage en se débattant');
  assert.equal(P.status, 'alive');
  assert.equal(sim.monster.mode, 'stun', 'elle est sonnée');
  assert.ok(sim.drainEvents().some((e) => e.type === 'release' && e.escaped));
  run(sim, MONSTER_STUN_T + 0.5);
  assert.notEqual(sim.monster.mode, 'stun');
  sim.monster.mode = 'chase';
  sim.monster.x = P.x + 0.5;
  sim.monster.z = P.z;
  sim.step();
  assert.equal(P.status, 'dead', 'la seconde prise ne pardonne pas');
});

test('perception : accroupi derrière elle, on passe ; en courant, elle entend', () => {
  const sim = new BackroomsSim({ map, difficulty: 'normal' });
  const P = sim.player;
  const M = sim.monster;
  M.dormantT = 0;
  sim.map.brightCells = new Uint8Array(sim.map.W * sim.map.H); // hors de la lumière franche du départ
  M.warpT = 999;
  // elle regarde ailleurs (dos au joueur), à 6 m
  M.x = P.x + 6;
  M.z = P.z;
  M.yaw = Math.PI / 2; // regarde vers +x : le joueur est derrière elle
  M.mode = 'patrol';
  M.stalkT = 99;
  M.ambushT = 99;
  P.flashlight = false;
  for (let i = 0; i < 20; i++) {
    sim.step({ crouch: true });
    M.x = P.x + 6;
    M.z = P.z;
    M.yaw = Math.PI / 2;
  }
  assert.notEqual(M.mode, 'chase', 'accroupi, immobile, dans son dos : rien');
  P.noise = 0;
  P.running = true;
  P.bumpV = NOISE.run;
  P.bumpT = 1;
  sim.step();
  assert.equal(M.mode, 'chase', 'un bruit de course tout près : elle se retourne');
  sim.map.brightCells = null;
});

test('nez à nez : découverte en face, de près, elle hurle et fonce (même au repos)', () => {
  const sim = new BackroomsSim({ map, difficulty: 'normal' });
  const P = sim.player;
  const M = sim.monster;
  sim.map.brightCells = new Uint8Array(sim.map.W * sim.map.H); // hors de la lumière franche du départ
  M.warpT = 999;
  // une direction dégagée sur 6,5 m depuis le départ (plus près, elle chargerait d'elle-même)
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const [dx, dz] = dirs.find(([x, z]) => hasLineOfSight(sim.map, P.x, P.z, P.x + x * 6.5, P.z + z * 6.5));
  const place = () => {
    M.x = P.x + dx * 6.5;
    M.z = P.z + dz * 6.5;
  };
  place();
  M.mode = 'watch';
  M.waitT = 99;
  M.dormantT = 99;
  M.yaw = Math.atan2(-dx, -dz);
  P.flashlight = true;
  // le joueur regarde ailleurs : elle reste plantée là
  P.yaw = Math.atan2(dx, dz);
  for (let i = 0; i < 60; i++) {
    sim.step({ yaw: P.yaw, pitch: 0 });
    place();
  }
  assert.equal(M.mode, 'watch', 'pas vue : elle observe');
  // il se retourne et la voit en plein dans sa lampe
  const yaw = Math.atan2(-dx, -dz);
  sim.events.length = 0;
  for (let i = 0; i < 20; i++) {
    sim.step({ yaw, pitch: 0 });
    place();
  }
  assert.notEqual(M.mode, 'chase', 'un regard fugace ne suffit pas');
  for (let i = 0; i < 25; i++) sim.step({ yaw, pitch: 0 });
  assert.equal(M.mode, 'chase', 'découverte : elle charge');
  assert.ok(M.rushT > 0, 'en hurlant (charge rapide)');
  assert.ok(sim.events.some((e) => e.type === 'rush'), 'le cri est annoncé');
  assert.ok(M.speed > sim.monsterChaseSpeed, 'plus vite qu\'une poursuite ordinaire');
  sim.map.brightCells = null;
});

test('la fixer de loin la provoque ; s\'en approcher aussi ; la lampe ne la fait plus fuir', () => {
  let stared = 0;
  let approached = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const make = () => {
      const sim = new BackroomsSim({ seed, difficulty: 'normal' });
      sim.map.brightCells = new Uint8Array(sim.map.W * sim.map.H);
      sim.glimpseAt = Infinity;
      sim.director.huntT = 1e9;
      sim.director.fakeT = 1e9;
      return sim;
    };
    const sim = make();
    const P = sim.player;
    const M = sim.monster;
    const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([x, z]) => hasLineOfSight(sim.map, P.x, P.z, P.x + x * 12, P.z + z * 12));
    if (!dir) continue;
    const [dx, dz] = dir;
    const put = (d) => {
      M.x = P.x + dx * d;
      M.z = P.z + dz * d;
    };
    // elle observe à 12 m ; il la fixe, lampe allumée
    put(12);
    Object.assign(M, { mode: 'watch', waitT: 99, dormantT: 0, warpT: 1e9, flees: 0 });
    P.flashlight = true;
    const yaw = Math.atan2(-dx, -dz);
    sim.events.length = 0;
    for (let i = 0; i < 30; i++) {
      sim.step({ yaw, pitch: 0 });
      put(12);
    }
    assert.notEqual(M.mode, 'flee', 'la lampe ne la fait plus fuir');
    assert.notEqual(M.mode, 'chase', 'une demi-seconde de loin ne suffit pas');
    for (let i = 0; i < 60 && M.mode !== 'chase'; i++) sim.step({ yaw, pitch: 0 });
    assert.equal(M.mode, 'chase', 'fixée une seconde à 12 m : elle charge');
    assert.ok(M.rushT > 0 && sim.events.some((e) => e.type === 'rush'), 'en hurlant');
    stared++;
    // une autre : elle observe à 5 m, il regarde ailleurs mais elle le voit
    const s2 = make();
    const Q = s2.player;
    const N = s2.monster;
    N.x = Q.x + dx * 5;
    N.z = Q.z + dz * 5;
    Object.assign(N, { mode: 'watch', waitT: 99, dormantT: 0, warpT: 1e9 });
    Q.flashlight = false;
    for (let i = 0; i < 10; i++) s2.step({ yaw: Math.atan2(dx, dz), pitch: 0 });
    assert.equal(N.mode, 'chase', 'trop près d\'elle : elle charge');
    approached++;
  }
  assert.ok(stared >= 4 && approached >= 4, `cas testés (${stared}, ${approached})`);
});

test('zone très éclairée : à l\'abri, elle ne s\'y lance pas et s\'arrête au bord de l\'ombre', () => {
  const sim = new BackroomsSim({ map, difficulty: 'normal' });
  const P = sim.player;
  const M = sim.monster;
  sim.map.brightCells = null; // (un autre test l'a éteinte)
  assert.ok(sim.brightCell(sim.map, P.x, P.z), 'le départ est dans une zone claire');
  M.dormantT = 0;
  M.warpT = 999;
  const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([x, z]) => hasLineOfSight(sim.map, P.x, P.z, P.x + x * 6, P.z + z * 6));
  const put = () => {
    M.x = P.x + dx * 6;
    M.z = P.z + dz * 6;
  };
  put();
  M.mode = 'patrol';
  M.stalkT = 99;
  M.ambushT = 99;
  P.flashlight = false;
  P.yaw = Math.atan2(dx, dz); // il regarde ailleurs
  P.running = true;
  P.bumpV = NOISE.run;
  P.bumpT = 1;
  sim.step({ yaw: P.yaw });
  assert.notEqual(M.mode, 'chase', 'dans la lumière, un bruit de course à 6 m ne la lance pas');
  // déjà lancée : elle renonce au bord de la lumière et l'observe
  M.mode = 'chase';
  M.unseenT = 0;
  for (let i = 0; i < 60 * 3 && M.mode === 'chase'; i++) {
    sim.step({ yaw: P.yaw });
    put();
  }
  assert.equal(M.mode, 'watch', 'elle s\'arrête et regarde');
  // pendant une coupure, plus d'abri
  sim.blackout = 10;
  assert.ok(!(sim.level === 0 && !(sim.blackout > 0) && sim.brightCell(sim.map, P.x, P.z)), 'la coupure retire l\'abri');
});

test('triche : invisible de tous, elle réapparaît juste derrière un angle devant sa proie, ou disparaît', () => {
  let corner = 0;
  let behind = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const sim = new BackroomsSim({ map: createBackroomsMap(seed), difficulty: 'normal' });
    const P = sim.player;
    const M = sim.monster;
    M.dormantT = 0;
    if (sim.director) sim.director.phase = 'build';
    // elle est loin, hors de vue ; le joueur, hors de la lumière franche, regarde le long d'un couloir
    sim.map.brightCells = new Uint8Array(sim.map.W * sim.map.H);
    const far = sim.map.walkable.find((c) => Math.hypot((c.x + 0.5) * CELL_SIZE - P.x, (c.z + 0.5) * CELL_SIZE - P.z) > 50);
    M.x = (far.x + 0.5) * CELL_SIZE;
    M.z = (far.z + 0.5) * CELL_SIZE;
    M.floor = 0;
    M.mode = 'patrol';
    M.warpT = 0;
    M.stalkT = 99;
    M.ambushT = 99;
    M.unseenAllT = 5;
    const evs = [];
    let tell = null;
    let tellStep = -1;
    for (let i = 0; i < 150 && !evs.length; i++) {
      sim.events.length = 0;
      sim.step({ yaw: P.yaw });
      const t = sim.events.find((e) => e.type === 'tell');
      if (t && !tell) {
        tell = t;
        tellStep = i;
        assert.ok(Math.hypot(t.x - P.x, t.z - P.z) > 5, 'le signe vient de là où elle va surgir');
      }
      evs.push(...sim.events.filter((e) => e.type === 'warp'));
    }
    const w = evs[0];
    if (!w) continue;
    // jamais sans prévenir : un craquement ou un souffle, plus d'une seconde avant, de l'endroit même
    assert.ok(tell, 'un signe avant chaque apparition');
    assert.ok(tellStep >= 0 && Math.hypot(tell.x - M.x, tell.z - M.z) < 0.3, 'elle surgit là où on l\'a entendue');
    assert.ok(!sim.inSomeView(0, M.x, M.z), 'elle n\'apparaît jamais sous les yeux d\'un joueur');
    assert.ok(Math.hypot(M.x - P.x, M.z - P.z) > 6, 'pas collée au joueur, hors de portée de charge');
    if (w.kind === 'corner') {
      corner++;
      assert.equal(M.mode, 'watch', 'postée, elle attend');
    } else behind++;
  }
  assert.ok(corner + behind >= 8, `elle trouve où apparaître (${corner} devant, ${behind} derrière sur 12)`);
  // la disparition : elle finit d'observer, personne ne la regarde, elle est partie loin
  const sim = new BackroomsSim({ map, difficulty: 'normal' });
  const P = sim.player;
  const M = sim.monster;
  M.dormantT = 0;
  sim.map.brightCells = new Uint8Array(sim.map.W * sim.map.H);
  const spot = sim.warpSpot(P, 'behind') || sim.warpSpot(P, 'corner');
  M.x = spot.x;
  M.z = spot.z;
  M.mode = 'watch';
  M.waitT = 0.01;
  M.warpT = 999;
  M.unseenAllT = 5;
  P.yaw = Math.atan2(M.x - P.x, M.z - P.z); // il lui tourne le dos
  for (let i = 0; i < 5; i++) sim.step({ yaw: P.yaw });
  assert.ok(sim.players.every((Q) => Math.hypot(Q.x - M.x, Q.z - M.z) >= 30), 'on se retourne : elle a disparu');
  sim.map.brightCells = null;
});

test('première rencontre : au bout du couloir, elle est là ; regardée, le néon claque et elle a disparu', () => {
  let shown = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const sim = new BackroomsSim({ seed, difficulty: 'normal' });
    const P = sim.player;
    const M = sim.monster;
    assert.ok(M.dormantT > 0 && sim.glimpseAt < M.dormantT, 'elle se montre pendant la minute de calme du début');
    sim.glimpseAt = 0;
    let show = null;
    // le joueur tourne lentement sur lui-même jusqu'à ce qu'elle se montre devant lui
    for (let i = 0; i < 60 * 30 && !show; i++) {
      sim.events.length = 0;
      sim.step({ yaw: P.yaw + 0.01 });
      show = sim.events.find((e) => e.type === 'glimpse' && e.phase === 'show');
    }
    if (!show) continue;
    shown++;
    const d = Math.hypot(M.x - P.x, M.z - P.z);
    assert.ok(d > 10 && d < 26, `au bout du couloir (${d.toFixed(1)} m)`);
    assert.ok(hasLineOfSight(sim.map, P.x, P.z, M.x, M.z), 'droit devant, bien en vue');
    assert.equal(M.mode, 'watch', 'immobile, elle regarde');
    // on la fixe : moins d'une seconde plus tard, le néon claque et elle n'est plus là
    let gone = null;
    for (let i = 0; i < 90 && !gone; i++) {
      sim.events.length = 0;
      sim.step({ yaw: Math.atan2(-(M.x - P.x), -(M.z - P.z)) });
      gone = sim.events.find((e) => e.type === 'glimpse' && e.phase === 'gone');
    }
    assert.ok(gone && gone.seen, 'regardée, elle disparaît');
    assert.ok(Math.hypot(M.x - P.x, M.z - P.z) >= 30, 'loin, très loin');
    assert.equal(M.mode, 'patrol');
    assert.equal(sim.glimpseAt, Infinity, 'une seule fois par partie');
  }
  assert.ok(shown >= 7, `elle se montre (${shown}/10)`);
});

test("à plusieurs : après un gel de l'hôte, la position de l'invité est reprise (pas de retour en arrière) ; les ambiances viennent de l'hôte", () => {
  const players = [{ id: 1, name: 'H' }, { id: 2, name: 'G' }];
  const host = new BackroomsSim({ seed: 12, players, localId: 1 });
  const G = host.players[1];
  const at = { x: G.x, z: G.z };
  // un point accessible à une dizaine de mètres
  const far = host.map.walkable.map((c) => ({ x: (c.x + 0.5) * CELL_SIZE, z: (c.z + 0.5) * CELL_SIZE })).find((c) => Math.hypot(c.x - at.x, c.z - at.z) > 9 && Math.hypot(c.x - at.x, c.z - at.z) < 12);
  assert.ok(far, 'un point à une dizaine de mètres');
  host.step({}, { 2: { remote: true, seq: 100, pos: { x: at.x, z: at.z } } });
  // 2 s plus tard chez l'invité (l'hôte était figé) : 120 pas, à la course, ça passe
  host.step({}, { 2: { remote: true, seq: 220, pos: far } });
  assert.ok(Math.hypot(G.x - far.x, G.z - far.z) < 0.5, "l'hôte reprend la position de l'invité");
  // mais pas un bond impossible
  const back = { x: at.x, z: at.z };
  host.step({}, { 2: { remote: true, seq: 223, pos: back } });
  assert.ok(Math.hypot(G.x - far.x, G.z - far.z) < 0.5, 'un bond de 10 m en 3 pas est refusé');
  // les ambiances : tirées par l'hôte, avec un endroit et des tirages que tout le monde rejoue pareil
  const amb = [];
  for (let i = 0; i < 60 * 70; i++) {
    host.events.length = 0;
    host.step({}, {});
    amb.push(...host.events.filter((e) => e.type === 'amb'));
  }
  assert.ok(amb.length >= 1, `des ambiances (${amb.length})`);
  for (const e of amb) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.a) && e.u >= 0 && e.u <= 1 && ['rec', 'a', 'b', 'c'].includes(e.s));
});

test("même version, même carte : tous les fichiers du jeu sont versionnés, et l'empreinte voit une cassette déplacée", () => {
  const html = fs.readFileSync(new URL('../backrooms/index.html', import.meta.url), 'utf8');
  const listed = new Set([...html.matchAll(/'((?:engine|view)\/[\w-]+\.js|app\.js)'/g)].map((m) => m[1]));
  for (const dir of ['', 'engine/', 'view/']) {
    for (const f of fs.readdirSync(new URL('../backrooms/' + dir, import.meta.url))) {
      if (f.endsWith('.js')) assert.ok(listed.has(dir + f), `backrooms/index.html doit charger ${dir + f} à la version du Hub`);
    }
  }
  const players = [{ id: 1, name: 'H' }, { id: 2, name: 'G' }];
  const a = new BackroomsSim({ seed: 77, players, localId: 1 });
  const b = new BackroomsSim({ seed: 77, players, localId: 2 });
  assert.equal(a.fp, b.fp, 'même graine, même empreinte');
  const cas = b.floors[1].cassettes[0];
  cas.x += 5;
  assert.notEqual(mapPrint(b.floors), a.fp, 'une cassette ailleurs : empreinte différente');
});

test('prélude : avant la première cassette, rien que la première apparition ; l\'entité n\'est pas là', () => {
  BackroomsSim.PRELUDE = true;
  try {
    for (let seed = 1; seed <= 4; seed++) {
      const sim = new BackroomsSim({ seed, difficulty: 'hard', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], localId: 'a' });
      const M = sim.monster;
      assert.ok(sim.prelude, 'Level 0, aucune cassette : le prélude');
      const types = new Set();
      let glimpses = 0;
      // trois minutes à parler fort et à courir partout
      for (let i = 0; i < 60 * 180; i++) {
        sim.events.length = 0;
        const t = i / 60;
        sim.step({ my: 1, mx: Math.sin(t * 0.7), run: true, voice: 0.9, radio: (i % 600) < 200 }, { b: { my: 1, mx: Math.cos(t * 0.5), voice: 0.9 } });
        for (const e of sim.events) types.add(e.type);
        if (sim.events.some((e) => e.type === 'glimpse' && e.phase === 'show')) glimpses++;
        if (!M.glimpse) assert.ok(M.away, 'hors de l\'apparition, elle n\'est pas là');
        assert.ok(M.mode !== 'chase' && M.mode !== 'grab', 'jamais de poursuite');
        assert.ok(sim.players.every((P) => !(P.danger > 0) || M.glimpse), 'pas de bourdonnement');
      }
      assert.ok(glimpses <= 1, 'une seule apparition');
      for (const t of ['spotted', 'phantom', 'din', 'tell', 'warp', 'blackout']) assert.ok(!types.has(t), `rien d'autre : ${t}`);
      assert.ok(!sim.lightsOut, 'pas de néons qui meurent');
      assert.ok(sim.players.every((P) => P.status === 'alive'), 'personne ne meurt');
      // la première cassette : elle arrive, une vingtaine de secondes plus tard, et de loin
      sim.cassettes = 1;
      run(sim, 1);
      assert.ok(!sim.prelude);
      let back = 0;
      for (let i = 0; i < 60 * 30 && !back; i++) {
        sim.step({});
        if (!M.away) back = i / 60;
      }
      assert.ok(back > 0, 'elle est revenue');
    }
  } finally {
    BackroomsSim.PRELUDE = false;
  }
});

test('traque annoncée : les néons meurent un à un jusqu\'au joueur, puis elle est lâchée du fond', () => {
  let hunts = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const sim = new BackroomsSim({ seed, difficulty: 'normal' });
    const P = sim.player;
    const M = sim.monster;
    M.dormantT = 0;
    M.warpT = 1e9;
    sim.glimpseAt = Infinity;
    // elle rôde loin
    const far = sim.map.walkable.find((c) => Math.hypot((c.x + 0.5) * CELL_SIZE - P.x, (c.z + 0.5) * CELL_SIZE - P.z) > 60);
    M.x = (far.x + 0.5) * CELL_SIZE;
    M.z = (far.z + 0.5) * CELL_SIZE;
    M.stalkT = 99;
    M.ambushT = 99;
    sim.director.huntT = 0.01;
    sim.director.fakeT = 999;
    const offAt = [];
    let hunt = null;
    for (let i = 0; i < 60 * 8 && !hunt; i++) {
      sim.events.length = 0;
      sim.step({ yaw: P.yaw });
      for (const e of sim.events) if (e.type === 'phantom' && e.kind === 'neon') offAt.push(Math.hypot(e.x - P.x, e.z - P.z));
      hunt = sim.events.find((e) => e.type === 'hunt');
      if (sim.events.some((e) => e.type === 'rare' && e.kind === 'lightsOut')) assert.ok(sim.lightsOut && sim.lightsOut.hunt, 'c\'est une traque');
    }
    if (!hunt) continue;
    hunts++;
    assert.ok(offAt.length >= 3, 'plusieurs néons s\'éteignent');
    assert.ok(offAt[offAt.length - 1] < offAt[0], 'du plus loin jusqu\'à lui');
    assert.ok(!sim.inSomeView(0, M.x, M.z, 0.1) || Math.hypot(M.x - P.x, M.z - P.z) > 10, 'lâchée hors de vue, au fond');
    assert.ok(Math.hypot(M.x - P.x, M.z - P.z) < 30, 'tout près maintenant');
    assert.equal(M.mode, 'search', 'elle vient le chercher');
    assert.ok(Math.hypot(M.lastSeenX - P.x, M.lastSeenZ - P.z) < 0.5, 'droit sur lui');
  }
  assert.ok(hunts >= 6, `traques lancées (${hunts}/8)`);
});

test('recoin calme : elle n\'y voit ni n\'y entre ; au bout de 45 s, sa lampe grésille et plus rien n\'y protège', () => {
  let tested = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const sim = new BackroomsSim({ seed, difficulty: 'normal' });
    const nooks = sim.floors[0].calm;
    assert.ok(nooks.length >= 1, `des recoins calmes (graine ${seed})`);
    for (const n of nooks) {
      assert.ok(n.cells.length === 2 && !sim.map.isWall(n.gx, n.gz), 'un cul-de-sac libre');
      assert.ok(Math.hypot(n.x - sim.map.spawn.x, n.z - sim.map.spawn.z) >= 18, 'loin du départ');
    }
    const n = nooks[0];
    const P = sim.player;
    const M = sim.monster;
    M.dormantT = 0;
    M.warpT = 1e9;
    sim.glimpseAt = Infinity;
    sim.director.huntT = 1e9;
    P.x = n.x;
    P.z = n.z;
    P.flashlight = false;
    // elle le poursuit, juste devant l'entrée du recoin
    const ox = (n.cells[1].x + 0.5) * CELL_SIZE - n.dx * CELL_SIZE * 1.6;
    const oz = (n.cells[1].z + 0.5) * CELL_SIZE - n.dz * CELL_SIZE * 1.6;
    if (sim.map.isWall(Math.floor(ox / CELL_SIZE), Math.floor(oz / CELL_SIZE))) continue;
    tested++;
    M.x = ox;
    M.z = oz;
    M.mode = 'chase';
    M.lastSeenX = P.x;
    M.lastSeenZ = P.z;
    assert.ok(sim.calmAt(P), 'à l\'abri');
    let grabbed = false;
    for (let i = 0; i < 60 * 20; i++) {
      sim.step({ yaw: P.yaw });
      if (P.grabT > 0 || P.status !== 'alive') grabbed = true;
    }
    assert.ok(!grabbed, 'elle ne franchit pas le seuil');
    assert.notEqual(M.mode, 'chase', 'elle a cessé la poursuite');
    // il s'y éternise : la protection s'use
    sim.events.length = 0;
    for (let i = 0; i < 60 * (CALM_HOLD - 18); i++) sim.step({ yaw: P.yaw });
    assert.ok(!sim.calmAt(P), 'usé : plus d\'abri');
    assert.ok(n.wear >= 1);
    // dehors, il se recharge peu à peu
    P.x = sim.map.spawn.x;
    P.z = sim.map.spawn.z;
    for (let i = 0; i < 60 * CALM_HOLD * 3; i++) sim.updateCalm();
    assert.ok(n.wear < 0.05, 'reposé, il protège à nouveau');
  }
  assert.ok(tested >= 5, `recoins testés (${tested})`);
});

test('spectateurs : un mort fait grésiller le néon près d\'un vivant, ou frappe plus loin pour attirer l\'entité', () => {
  const sim = new BackroomsSim({ seed: 4, difficulty: 'normal', players: [{ id: 0, name: 'A' }, { id: 1, name: 'B' }] });
  const [A, B] = sim.players;
  A.status = 'dead';
  sim.glimpseAt = Infinity;
  sim.monster.dormantT = 0;
  // E : le néon le plus proche de B grésille
  const lit = sim.map.lights.filter((l) => l.state === 'on').sort((a, b) => Math.hypot(a.x - B.x, a.z - B.z) - Math.hypot(b.x - B.x, b.z - B.z))[0];
  B.x = lit.x + 1;
  B.z = lit.z;
  sim.events.length = 0;
  sim.step({ useSel: true, view: 1 }, { 1: {} });
  const f = sim.events.find((e) => e.type === 'haunt');
  assert.ok(f && f.kind === 'flicker' && f.id === 1, 'le néon de B grésille');
  assert.equal(lit.state, 'flicker');
  // pas deux de suite
  sim.events.length = 0;
  sim.step({ whistle: true, view: 1 }, { 1: {} });
  assert.ok(!sim.events.some((e) => e.type === 'haunt'), 'il faut attendre');
  // après le délai : des coups devant B, qui attirent l'entité
  A.hauntAt = 0;
  sim.events.length = 0;
  sim.step({ whistle: true, view: 1 }, { 1: {} });
  const k = sim.events.find((e) => e.type === 'haunt');
  assert.ok(k && k.kind === 'knock', 'des coups');
  const dk = Math.hypot(k.x - B.x, k.z - B.z);
  assert.ok(dk > 4 && dk < 18, `un peu plus loin (${dk.toFixed(1)} m)`);
  assert.ok(A.hauntAt - sim.time > HAUNT_COOLDOWN - 1);
  // un vivant ne hante pas
  const before = sim.events.length;
  sim.step({ useSel: true }, { 1: { whistle: true } });
  assert.ok(!sim.events.slice(before).some((e) => e.type === 'haunt'));
});

test('elle préfère celui qui s\'isole ; plus on joue bien, plus elle triche (et inversement)', () => {
  const sim = new BackroomsSim({ seed: 9, difficulty: 'normal', players: [{ id: 0, name: 'A' }, { id: 1, name: 'B' }, { id: 2, name: 'C' }] });
  const [A, B, C] = sim.players;
  const M = sim.monster;
  const cells = sim.map.walkable.map((c) => ({ x: (c.x + 0.5) * CELL_SIZE, z: (c.z + 0.5) * CELL_SIZE }));
  // A et B ensemble, C seul à 40 m d'eux ; l'entité un peu plus près du groupe
  const g = cells.find((c) => Math.hypot(c.x - M.x, c.z - M.z) > 25 && Math.hypot(c.x - M.x, c.z - M.z) < 30);
  const lone = cells.find((c) => Math.hypot(c.x - M.x, c.z - M.z) > 31 && Math.hypot(c.x - M.x, c.z - M.z) < 36 && Math.hypot(c.x - g.x, c.z - g.z) > 40);
  A.x = B.x = g.x;
  A.z = g.z;
  B.z = g.z + 0.5;
  C.x = lone.x;
  C.z = lone.z;
  for (const P of sim.players) P.seen = false;
  assert.equal(sim.senseMonster().id, 2, 'le joueur seul');
  const easy = new BackroomsSim({ seed: 9, skill: 0 });
  const pro = new BackroomsSim({ seed: 9, skill: 1 });
  assert.ok(easy.monster.dormantT > pro.monster.dormantT + 20, 'plus de répit au début pour qui débute');
  assert.equal(new BackroomsSim({ seed: 9, skill: 'x' }).skill, 0.5);
});

test('invités : ils voient les néons mourir et les recoins s\'user (seuls les néons changés voyagent)', () => {
  const host = new BackroomsSim({ seed: 3 });
  const guest = new BackroomsSim({ seed: 3 });
  const a = host.map.lights.find((l) => l.state === 'on');
  const b = host.floors[1].lights.find((l) => l.state === 'on');
  a.state = 'off';
  b.state = 'flicker';
  host.floors[0].calm[0].wear = 0.6;
  const snap = JSON.parse(JSON.stringify(host.snapshot()));
  assert.ok(JSON.stringify(snap).length < 900, 'un instantané léger');
  guest.applySnapshot(snap);
  assert.equal(guest.map.lights[host.map.lights.indexOf(a)].state, 'off');
  assert.equal(guest.floors[1].lights[host.floors[1].lights.indexOf(b)].state, 'flicker');
  assert.equal(guest.floors[0].calm[0].wear, 0.6);
  a.state = 'on';
  b.state = 'on';
  guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
  assert.equal(guest.map.lights[host.map.lights.indexOf(a)].state, 'on', 'rallumé chez l\'invité aussi');
  assert.equal(guest.floors[1].lights[host.floors[1].lights.indexOf(b)].state, 'on');
});

test('casier : caché, l\'entité ne le voit pas ; vu en entrant, elle vient le chercher', () => {
  const sim = new BackroomsSim({ difficulty: 'normal', seed: 5, level: 1 });
  const hides = sim.map.hides;
  assert.ok(hides && hides.length >= 3, 'des casiers à l\'entrepôt');
  const P = sim.player;
  const h = hides[0];
  const f = hideFront(h);
  P.x = f.x;
  P.z = f.z;
  // l'entité loin, dos tourné
  sim.monster.x = P.x + 40;
  sim.monster.z = P.z;
  sim.step({ pick: true });
  assert.equal(P.hidden, h.id, 'F devant le casier : on s\'y enferme');
  assert.equal(P.flashlight, false);
  // elle arrive tout près sans l'avoir vu : elle ne le trouve pas tant qu'il retient son souffle
  sim.monster.x = h.x + h.dx * 2.5;
  sim.monster.z = h.z + h.dz * 2.5;
  sim.monster.mode = 'search';
  for (let i = 0; i < 60; i++) sim.step({ run: true });
  assert.equal(P.status, 'alive');
  assert.ok(!(P.grabT > 0), 'souffle retenu : elle passe');
  sim.step({ pick: true });
  assert.equal(P.hidden, -1, 'F pour ressortir');
});

test('Level 1 : les fusibles se portent jusqu\'au panneau et tombent avec celui qui meurt', () => {
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 3, level: 1 });
  const P = sim.player;
  const f0 = sim.map.fuses[0];
  P.x = f0.x;
  P.z = f0.z;
  sim.step();
  assert.equal(P.carry.length, 1, 'le fusible est en poche');
  sim.killPlayer(P);
  assert.equal(P.carry.length, 0);
  assert.equal(f0.taken, false, 'il est tombé par terre');
  assert.equal(sim.fuses, 0);
});

test('grande carte : générée sans erreur pour 200 graines, sortie loin du départ', () => {
  for (let sd = 0; sd < 200; sd++) {
    const m = createBackroomsMap(sd);
    const exitD = m.dist[m.exit.gz * m.W + m.exit.gx];
    assert.ok(exitD > 40, `graine ${sd} : la sortie est à ${exitD} cases du départ`);
    for (const c of m.cassettes) assert.ok(m.dist[c.gz * m.W + c.gx] > 0, `graine ${sd} : cassette ${c.id} atteignable`);
    assert.ok(m.lights.some((l) => l.state === 'off'), `graine ${sd} : il y a des zones sombres`);
  }
});

test("eau d'amande : rend la moitié de l'endurance et agrandit la jauge pour de bon", () => {
  const m = createBackroomsMap(7);
  const sim = new BackroomsSim({ map: m, difficulty: 'peaceful' });
  sim.player.stamina = 10;
  const b = m.bottles[0];
  sim.player.x = b.x;
  sim.player.z = b.z;
  sim.step();
  assert.equal(b.taken, false, 'on ne ramasse plus en passant');
  sim.step({ pick: true });
  assert.equal(b.taken, true);
  assert.deepEqual(sim.player.inv, ['bottle', null], "F : la bouteille va dans l'inventaire");
  assert.ok(sim.player.stamina < 100, "elle ne se boit pas toute seule");
  const before = sim.player.stamina;
  sim.step({ useSel: true });
  assert.ok(Math.abs(sim.player.stamina - (before + 50 + ALMOND_GROW)) < 0.5, 'E : on boit la case choisie (+50, plus la jauge agrandie)');
  assert.deepEqual(sim.player.inv, [null, null]);
  assert.ok(sim.drainEvents().some((e) => e.type === 'bottle'));
  assert.equal(staminaMax(sim.player), 100 + ALMOND_GROW, 'la jauge a grandi');
  // au repos, on remplit la nouvelle jauge, au-delà de 100
  run(sim, 30);
  assert.ok(sim.player.stamina > 100 + ALMOND_GROW - 1, `souffle ${sim.player.stamina.toFixed(0)}`);
  // elle reste agrandie à l'étage suivant
  sim.loadLevel(1);
  assert.equal(staminaMax(sim.player), 100 + ALMOND_GROW);
  assert.ok(sim.player.stamina > 100, 'on y arrive avec tout son souffle');
});

test("inventaire : deux cases d'objets ; plein, F échange l'objet de la case choisie contre celui du sol", () => {
  const m = createBackroomsMap(9);
  const sim = new BackroomsSim({ map: m, difficulty: 'peaceful' });
  const P = sim.player;
  const ladder = m.items.find((i) => i.kind === 'ladder');
  for (const o of [m.bottles[0], m.batteries[0]]) {
    P.x = o.x;
    P.z = o.z;
    sim.step({ pick: true });
  }
  assert.deepEqual(P.inv, ['bottle', 'battery']);
  // plein : la case choisie (2, l'eau d'amande) part au sol à la place de l'échelle
  P.x = ladder.x;
  P.z = ladder.z;
  sim.step({ pick: true, sel: 1 });
  assert.deepEqual(P.inv, ['ladder', 'battery']);
  assert.equal(ladder.taken, true);
  const dropped = m.items[m.items.length - 1];
  assert.equal(dropped.kind, 'bottle');
  assert.equal(dropped.taken, false);
  assert.ok(Math.hypot(dropped.x - ladder.x, dropped.z - ladder.z) < 0.01, "l'eau d'amande est posée là où était l'échelle");
  // une case vide : F y range l'objet sans rien poser
  P.x = m.spawn.x;
  P.z = m.spawn.z;
  P.battery = 10;
  sim.step({ sel: 2 });
  sim.step({ useSel: true });
  assert.ok(P.battery > 60, 'E : la pile de la case 3 recharge la lampe');
  assert.deepEqual(P.inv, ['ladder', null]);
  P.x = dropped.x;
  P.z = dropped.z;
  const before = m.items.length;
  sim.step({ pick: true });
  assert.deepEqual(P.inv, ['ladder', 'bottle']);
  assert.equal(m.items.length, before, 'rien de posé : il restait une case');
  // E sur une eau d'amande, souffle plein : elle sert quand même (la jauge grandit)
  P.stamina = 100;
  sim.step({ useSel: true });
  assert.deepEqual(P.inv, ['ladder', null]);
  assert.equal(staminaMax(P), 100 + ALMOND_GROW);
});

test("renfoncement : la cassette en hauteur s'attrape seulement depuis l'échelle, qu'il faut aller chercher", () => {
  for (const sd of [2, 9, 31]) {
    const sim = new BackroomsSim({ difficulty: 'peaceful', seed: sd });
    const m = sim.map;
    const N = m.niche;
    assert.ok(N, `graine ${sd} : un renfoncement`);
    const cas = m.cassettes.find((c) => c.id === N.cas);
    assert.ok(cas.high);
    const ladder = m.items.find((i) => i.kind === 'ladder');
    assert.ok(ladder, "une échelle sur la carte");
    const d = bfsDist(m, N.gx, N.gz, ladder.gx, ladder.gz);
    assert.ok(d >= 12 && d <= 70, `graine ${sd} : échelle à ${d} cases du renfoncement`);
    const P = sim.player;
    // sans échelle, même juste dessous : trop haut
    P.x = N.baseX;
    P.z = N.baseZ;
    sim.step();
    assert.equal(cas.collected, false, 'trop haut sans échelle');
    // on va chercher l'échelle, on la pose dessous (E), on grimpe
    P.x = ladder.x;
    P.z = ladder.z;
    sim.step({ pick: true });
    assert.deepEqual(P.inv, ['ladder', null], "l'échelle va dans l'inventaire");
    P.x = N.baseX + 1.5;
    P.z = N.baseZ;
    if (sim.isColliding(P.x, P.z, 0.3)) {
      P.x = N.baseX;
      P.z = N.baseZ;
    }
    sim.step({ useSel: true });
    assert.ok(N.ladder, 'échelle posée');
    assert.deepEqual(P.inv, [null, null]);
    P.x = N.baseX;
    P.z = N.baseZ;
    sim.step();
    assert.ok(P.onLadder, "en haut de l'échelle");
    assert.ok(cas.collected, 'cassette récupérée');
  }
});

test("couloir piégé : une cassette n'est accessible qu'en traversant les trous", () => {
  for (const sd of [1, 4, 8, 15, 23, 42, 77]) {
    const m = createBackroomsMap(sd);
    const v = m.cassettes.find((c) => c.vault);
    assert.ok(v, `graine ${sd} : une cassette gardée`);
    assert.ok(m.pits.length >= 6);
    const g = m.grid.map((val, i) => (m.pitAt(i % m.W, Math.floor(i / m.W)) >= 0 ? T.WALL : val));
    const d = bfs(g, m.W, m.H, m.spawn.gx, m.spawn.gz);
    assert.ok(d[v.gz * m.W + v.gx] < 0, `graine ${sd} : impossible de contourner les trous`);
    assert.ok(m.dist[v.gz * m.W + v.gx] > 0, 'mais accessible en les traversant');
    for (const c of m.cassettes) if (!c.vault) assert.ok(d[c.gz * m.W + c.gx] >= 0, 'les autres cassettes sans trou');
    assert.ok(d[m.exit.gz * m.W + m.exit.gx] >= 0, "l'ascenseur sans trou");
  }
});

test("sifflet (T) : les autres l'entendent ; trop de coups rapprochés attirent l'entité", () => {
  const sim = new BackroomsSim({ difficulty: 'normal', seed: 40 });
  const P = sim.player;
  const M = sim.monster;
  // l'entité rôde à 30 m, sans voir le joueur
  M.x = P.x + 30;
  M.z = P.z;
  M.mode = 'patrol';
  const origRandom = Math.random;
  Math.random = () => 0.99; // pas de coup de chance : il faut insister
  try {
    sim.step({ whistle: true });
    sim.step({ whistle: true });
    const ev = sim.drainEvents().filter((e) => e.type === 'whistle');
    assert.equal(ev.length, 1, 'un coup de sifflet à la fois');
    assert.notEqual(M.mode, 'search', 'un coup : elle ne vient pas encore');
    run(sim, WHISTLE_CD + 0.05);
    sim.step({ whistle: true });
    run(sim, WHISTLE_CD + 0.05);
    sim.step({ whistle: true });
    assert.equal(M.mode, 'search', "au 3e coup rapproché, elle vient voir");
    assert.ok(Math.hypot(M.lastSeenX - P.x, M.lastSeenZ - P.z) < 0.01);
  } finally {
    Math.random = origRandom;
  }
});

test('murs : chaque graine donne un dédale différent', () => {
  const a = createBackroomsMap(1);
  const b = createBackroomsMap(2);
  let diff = 0;
  for (let i = 0; i < a.grid.length; i++) if (a.grid[i] !== b.grid[i]) diff++;
  assert.ok(diff > a.grid.length * 0.1, `${diff} cases différentes`);
});

test("l'entité perd le joueur quand elle ne le voit plus pendant quelques secondes", () => {
  const m = createBackroomsMap(11);
  const sim = new BackroomsSim({ map: m });
  sim.monster.mode = 'chase';
  for (let i = 0; i < 60 * 6 && sim.monster.mode === 'chase'; i++) {
    // on la garde loin, hors de vue, pour tester la perte de vue seule
    sim.monster.x = m.monsterSpawn.x;
    sim.monster.z = m.monsterSpawn.z;
    sim.step({ my: 0 });
  }
  assert.notEqual(sim.monster.mode, 'chase');
});

test("lampe torche : la pile se vide, la lampe s'éteint, une pile la recharge", () => {
  const m = createBackroomsMap(5);
  const sim = new BackroomsSim({ map: m, difficulty: 'peaceful' });
  assert.ok(m.batteries.length >= 6, 'des piles dans le dédale');
  sim.player.hasLamp = true;
  sim.player.flashlight = true;
  for (let i = 0; i < 60 * 300; i++) sim.step({});
  assert.equal(sim.player.battery, 0);
  assert.equal(sim.player.flashlight, false, "la lampe s'éteint à plat");
  sim.step({ toggleFlashlight: true });
  assert.equal(sim.player.flashlight, false, 'impossible de la rallumer sans pile');
  const b = m.batteries[0];
  sim.player.x = b.x;
  sim.player.z = b.z;
  sim.step({ pick: true });
  sim.step({ useSel: true });
  assert.ok(sim.player.battery > 50, 'la pile recharge la lampe');
  sim.step({ toggleFlashlight: true });
  assert.equal(sim.player.flashlight, true);
});

test("Level 1 : l'entrepôt, ses étagères, ses 3 fusibles et le monte-charge", () => {
  for (const sd of [1, 2, 3, 50, 99]) {
    const m = createWarehouseMap(sd);
    assert.equal(m.level, 1);
    assert.ok(m.shelves.length > 60, `graine ${sd} : des rangées d'étagères`);
    assert.ok(m.elevator, `graine ${sd} : un monte-charge`);
    assert.equal(m.fuses.length, FUSES);
    for (const f of m.fuses) assert.ok(m.dist[f.gz * m.W + f.gx] > 0, `graine ${sd} : fusible ${f.id} atteignable`);
    assert.ok(m.dist[m.exit.gz * m.W + m.exit.gx] > 30, `graine ${sd} : le monte-charge est loin`);
    let shelf = 0;
    for (const v of m.grid) if (v === T.SHELF) shelf++;
    assert.ok(shelf > 100);
    // une étagère bloque le passage et la vue
    const sh = m.shelves[0];
    assert.ok(m.isWall(sh.gx, sh.gz));
  }
});

test('Level 1 : les fusibles rapportés au panneau ouvrent le monte-charge, qui descend aux Poolrooms (Level 37)', () => {
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 4, level: 1 });
  assert.equal(sim.open, false);
  for (const f of sim.map.fuses) {
    sim.player.x = f.x;
    sim.player.z = f.z;
    sim.step();
  }
  assert.equal(sim.fuses, FUSES);
  assert.equal(sim.open, false, 'il faut encore les brancher au panneau');
  sim.player.x = sim.map.exit.x;
  sim.player.z = sim.map.exit.z;
  sim.step();
  assert.equal(sim.delivered, FUSES, 'les fusibles sont au panneau');
  assert.equal(sim.powered, false, 'il faut encore relancer le monte-charge');
  run(sim, PANEL_T + 0.2);
  assert.equal(sim.powered, true);
  assert.ok(sim.drainEvents().some((e) => e.type === 'powered'));
  const E = sim.map.elevator;
  sim.player.x = E.x;
  sim.player.z = E.z;
  sim.step();
  run(sim, DEPART_T + 0.2);
  assert.equal(sim.state, 'playing');
  assert.equal(sim.level, 2, 'on arrive aux Poolrooms');
  assert.ok(sim.drainEvents().some((e) => e.type === 'level' && e.level === 2));
  // les 3 volants de vanne ouvrent les toboggans ; on se glisse dans l'un d'eux : la partie est gagnée
  const sl = sim.map.slides[0];
  sim.player.x = sl.x - sl.dx * 0.6;
  sim.player.z = sl.z - sl.dz * 0.6;
  sim.step();
  assert.equal(sim.player.status, 'alive', 'toboggan fermé tant que les vannes manquent');
  for (const f of sim.map.fuses) {
    sim.player.x = f.x;
    sim.player.z = f.z;
    sim.step();
  }
  assert.equal(sim.fuses, FUSES, 'les 3 vannes');
  assert.equal(sim.open, true, "les toboggans s'ouvrent dès la troisième vanne");
  sim.player.x = sl.x - sl.dx * 0.6;
  sim.player.z = sl.z - sl.dz * 0.6;
  sim.step();
  assert.equal(sim.player.status, 'elevator');
  assert.equal(sim.slide, 0, 'le toboggan rouge est pris');
  run(sim, DEPART_T + 0.2);
  assert.equal(sim.state, 'won', 'le toboggan rouge sort des Poolrooms : partie gagnée');
});

test('Level 1 : coupures de courant de 15 à 20 s', () => {
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 8, level: 1 });
  let start = -1;
  let len = 0;
  for (let i = 0; i < 60 * 120; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type === 'blackout' && start < 0) start = sim.time;
      if (e.type === 'power' && start >= 0 && !len) len = sim.time - start;
    }
  }
  assert.ok(start > 0, 'une coupure arrive dans les deux premières minutes');
  assert.ok(len >= 14.9 && len <= 20.1, `elle dure ${len.toFixed(1)} s`);
});

test("Level 1 : l'entité se cache au bout des étagères pour tendre une embuscade", () => {
  let ambushes = 0;
  for (const sd of [3, 5, 9, 12]) {
    const sim = new BackroomsSim({ difficulty: 'normal', seed: sd, level: 1 });
    const P = sim.player;
    const M = sim.monster;
    // le joueur marche dans une grande allée ; l'entité est à 25 m, hors de vue
    M.x = P.x + 25;
    M.z = P.z;
    M.ambushT = 0;
    P.yaw = -Math.PI / 2;
    sim.step({});
    if (M.mode === 'ambush') {
      ambushes++;
      assert.ok(M.silent, "elle se tait en embuscade");
      assert.ok(!hasLineOfSight(sim.map, P.x, P.z, M.ambush.x, M.ambush.z), 'cachée de la vue du joueur');
      assert.ok(sim.map.isShelfSide(M.ambush.gx, M.ambush.gz), 'contre une étagère');
    }
  }
  assert.ok(ambushes >= 2, `${ambushes} embuscades sur 4`);
});

test("à plusieurs : qui entre dans l'ascenseur devient spectateur, il part quand tout le monde est dedans", () => {
  const players = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];
  const sim = new BackroomsSim({ difficulty: 'normal', seed: 21, players, localId: 1 });
  for (const c of sim.allCassettes) {
    putOn(sim, sim.player, c);
    sim.step();
  }
  assert.equal(sim.cassettes, 7, "les cassettes comptent pour toute l'équipe");
  const E = sim.fm(sim.realFloor).elevator;
  for (const P of sim.players) P.floor = sim.realFloor;
  const [a, b, c] = sim.players;
  sim.monster.x = sim.monster.z = -999; // loin de tout le monde
  a.x = E.x; a.z = E.z;
  sim.step();
  assert.equal(a.status, 'elevator');
  assert.equal(sim.departT, 0, "il attend les autres");
  assert.notEqual(sim.viewPlayer(0).id, a.id, 'le spectateur suit un joueur encore dehors');
  assert.ok(Math.abs(sim.rage - 1 / 2) < 1e-9, "l'entité s'énerve");
  b.x = E.x; b.z = E.z;
  sim.step();
  assert.ok(Math.abs(sim.rage - 1) < 1e-9, 'le dernier dehors : colère au maximum');
  assert.equal(sim.departT, 0);
  c.x = E.x; c.z = E.z;
  sim.step();
  assert.ok(sim.departT > 0, 'tout le monde est dedans : départ');
  run(sim, DEPART_T + 0.2);
  assert.equal(sim.level, 1);
  assert.ok(sim.players.every((p) => p.status === 'alive'));
});

test("à plusieurs : plus il y a de monde à l'abri, plus l'entité est rapide et voit loin", () => {
  const players = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];
  const speed = (inside) => {
    const sim = new BackroomsSim({ difficulty: 'normal', seed: 5, players, localId: 1 });
    sim.cassettes = 7;
    for (let i = 0; i < inside; i++) sim.players[i].status = 'elevator';
    const P = sim.players[2];
    sim.monster.mode = 'chase';
    sim.monster.x = P.x + 5;
    sim.monster.z = P.z;
    sim.updateMonster();
    return sim.monster.speed;
  };
  assert.ok(speed(2) > speed(1) && speed(1) > speed(0));
});

test("à plusieurs : un joueur attrapé devient spectateur, la partie continue ; il revient à l'étage suivant", () => {
  const players = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
  const sim = new BackroomsSim({ difficulty: 'normal', seed: 33, players, localId: 1 });
  const [a, b] = sim.players;
  sim.monster.x = a.x + 0.4;
  sim.monster.z = a.z;
  b.x = a.x + 30; // loin
  a.grabs = 1; // déjà agrippé une fois : cette prise-ci est mortelle
  sim.step();
  assert.equal(a.status, 'dead');
  assert.equal(sim.state, 'playing', 'B joue encore');
  assert.equal(sim.viewPlayer(0).id, b.id, 'A regarde B');
  sim.cassettes = 7;
  sim.realFloor = 0;
  b.x = sim.map.elevator.x;
  b.z = sim.map.elevator.z;
  sim.monster.x = sim.monster.z = -999;
  sim.step();
  assert.ok(sim.departT > 0, "B seul dehors entre : l'ascenseur part");
  run(sim, DEPART_T + 0.2);
  assert.equal(sim.level, 1);
  assert.equal(sim.players[0].status, 'alive', 'A revient au Level 1');
});

test("réseau : l'invité reçoit l'état de l'hôte, se déplace chez lui et suit le changement d'étage", () => {
  const players = [{ id: 1, name: 'Hôte' }, { id: 2, name: 'Invité' }];
  const host = new BackroomsSim({ difficulty: 'normal', seed: 77, players, localId: 1 });
  const guest = new BackroomsSim({ difficulty: 'normal', seed: 77, players, localId: 2 });
  const wire = () => guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
  assert.deepEqual(Array.from(guest.map.grid), Array.from(host.map.grid), 'même graine : même carte');
  host.monster.x = host.monster.z = -999;
  // l'invité avance chez lui et annonce sa position ; l'hôte la reprend
  const g = guest.player;
  for (let i = 0; i < 60; i++) guest.predict({ my: 1, yaw: g.yaw });
  const hg = host.players.find((p) => p.id === 2);
  host.step({}, { 2: { pos: { x: g.x, z: g.z }, yaw: g.yaw } });
  assert.ok(Math.hypot(hg.x - g.x, hg.z - g.z) < 0.01, "l'hôte a repris la position de l'invité");
  // une position impossible (téléportation) est refusée
  host.step({}, { 2: { pos: { x: hg.x + 20, z: hg.z } } });
  assert.ok(Math.hypot(hg.x - g.x, hg.z - g.z) < 3, 'téléportation refusée');
  // l'hôte ramasse une cassette : l'invité la voit disparaître et le compteur monte
  const c = host.map.cassettes.find((q) => !q.high);
  host.player.x = c.x;
  host.player.z = c.z;
  host.step();
  wire();
  assert.equal(guest.cassettes, 1);
  assert.equal(guest.allCassettes.find((q) => q.id === c.id).collected, true);
  // tout le monde dans l'ascenseur : l'invité passe au Level 1 avec la même carte
  host.cassettes = 7;
  host.realFloor = 0;
  for (const P of host.players) {
    P.x = host.map.elevator.x;
    P.z = host.map.elevator.z;
  }
  host.step();
  run(host, DEPART_T + 0.2);
  wire();
  assert.equal(guest.level, 1);
  assert.deepEqual(Array.from(guest.map.grid), Array.from(host.map.grid), 'même entrepôt');
  assert.equal(guest.player.status, 'alive');
  // coupure de courant et entité : l'invité les reçoit
  host.blackout = 12;
  host.monster.x = host.players[1].x + 6;
  host.monster.z = host.players[1].z;
  wire();
  assert.ok(guest.blackout > 0);
  assert.ok(guest.monster.danger > 0.3, "l'invité entend l'entité approcher");
  // un joueur quitte la partie : il disparaît chez l'invité
  host.removePlayer(1);
  wire();
  assert.equal(guest.players.length, 1);
});

test('départ : pas de table, chacun a déjà sa lampe allumée dans la case 1', () => {
  const players = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];
  for (const sd of [3, 14, 15, 92, 653]) {
    const sim = new BackroomsSim({ difficulty: 'peaceful', seed: sd, players, localId: 1 });
    assert.ok(!sim.table, `graine ${sd} : pas de table au départ`);
    assert.ok(sim.players.every((p) => p.hasLamp && p.flashlight), 'tout le monde part équipé, lampe allumée');
    // la touche 1 éteint et rallume sa lampe
    sim.step({ toggleFlashlight: true });
    assert.equal(sim.player.flashlight, false);
    assert.ok(!sim.drainEvents().some((e) => e.type === 'noLamp'));
    sim.step({ toggleFlashlight: true });
    assert.equal(sim.player.flashlight, true);
  }
});

test("à bout de souffle : une seconde sans pouvoir courir, chez l'hôte comme chez l'invité", () => {
  for (const guest of [false, true]) {
    const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 3 });
    const P = sim.player;
    const go = () => (guest ? sim.predict({ my: 1, run: true, yaw: P.yaw }) : sim.step({ my: 1, run: true, yaw: P.yaw }));
    let t = 0;
    while (P.stamina > 0 && t < 20) {
      go();
      t += DT;
    }
    assert.equal(P.stamina, 0, 'endurance épuisée');
    let stopped = 0;
    for (let i = 0; i < Math.round(1.5 / DT); i++) {
      go();
      if (P.running) break;
      stopped += DT;
    }
    assert.ok(stopped > 0.9 && stopped < 1.1, `${guest ? 'invité' : 'hôte'} : environ une seconde sans courir (${stopped.toFixed(2)} s)`);
  }
});

test('départ à plusieurs : chacun dans son coin, à portée de sifflet, et pareil chez tout le monde', () => {
  const players = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: 'P' + id }));
  for (const sd of [3, 14, 42, 92, 653]) {
    const sim = new BackroomsSim({ difficulty: 'peaceful', seed: sd, players, localId: 1 });
    const guest = new BackroomsSim({ difficulty: 'peaceful', seed: sd, players, localId: 4 });
    const ps = sim.players;
    assert.equal(new Set(ps.map((p) => `${p.x},${p.z}`)).size, ps.length, `graine ${sd} : personne au même endroit`);
    for (const [i, p] of ps.entries()) {
      assert.equal(p.x, guest.players[i].x, 'même départ chez un invité');
      assert.equal(p.z, guest.players[i].z);
      assert.ok(!sim.isColliding(p.x, p.z, 0.3, 0), `graine ${sd} : ${p.name} pas dans un mur ni un meuble`);
      for (const q of ps) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) < 45, 'assez près pour entendre siffler');
    }
  }
  // seul : au départ habituel
  const solo = new BackroomsSim({ difficulty: 'peaceful', seed: 3 });
  assert.equal(solo.player.x, solo.map.spawn.x);
});

test("un joueur tombé au Level 0 repart au Level 1 avec une lampe", () => {
  const players = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 8, players, localId: 1 });
  const [a, b] = sim.players;
  a.status = 'dead'; // attrapé avant d'avoir pris sa lampe
  sim.cassettes = 7;
  sim.realFloor = 0;
  b.x = sim.map.elevator.x;
  b.z = sim.map.elevator.z;
  sim.step();
  run(sim, DEPART_T + 0.2);
  assert.equal(sim.level, 1);
  const a1 = sim.players.find((p) => p.id === 1);
  assert.equal(a1.status, 'alive');
  assert.ok(a1.hasLamp && a1.flashlight);
  assert.ok(!sim.table, "plus de table à l'étage suivant");
});

// hasard reproductible pour les tests d'équilibre
const withSeed = (seed, fn) => {
  const orig = Math.random;
  let s = seed;
  Math.random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  try {
    return fn();
  } finally {
    Math.random = orig;
  }
};
// un joueur posé sur l'arête entre les deux premiers trous du couloir, face à la suite
const onBeam = (sd) => {
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: sd });
  const [p0, p1] = sim.map.pits;
  const P = sim.player;
  // deux trous voisins : l'arête est sur leur bord commun
  P.x = p0.gx === p1.gx ? Math.round(p0.x / CELL_SIZE) * CELL_SIZE : (p0.x + p1.x) / 2;
  P.z = p0.gz === p1.gz ? Math.round(p0.z / CELL_SIZE) * CELL_SIZE : (p0.z + p1.z) / 2;
  return { sim, P };
};

test("couloir piégé : il tourne, impossible de le traverser tout droit", () => {
  for (const sd of [1, 4, 8, 15, 23, 42, 77]) {
    const m = createBackroomsMap(sd);
    const xs = new Set(m.pits.map((p) => p.gx));
    const zs = new Set(m.pits.map((p) => p.gz));
    assert.ok(xs.size > 2 && zs.size > 2, `graine ${sd} : au moins un virage`);
  }
});

test("barre d'équilibre : sans rien faire on bascule dans le trou du côté où l'on penche ; avec Q / D on tient", () => {
  for (const sd of [1, 4, 8]) {
    const { sim, P } = onBeam(sd);
    sim.step();
    assert.ok(P.onBeam, `graine ${sd} : sur l'arête`);
    assert.equal(P.floor, 0);
    // sans rien faire : on tombe en quelques secondes
    let t = 0;
    withSeed(sd, () => {
      while (P.floor === 0 && t < 20) {
        sim.step();
        t += DT;
      }
    });
    assert.ok(P.floor === 1 && t > 0.5 && t < 15, `graine ${sd} : tombé à l'étage du dessous au bout de ${t.toFixed(1)} s`);
    assert.ok(sim.drainEvents().some((e) => e.type === 'fall' && e.balance));
    // en corrigeant : on tient
    const b = onBeam(sd);
    withSeed(sd + 7, () => {
      for (let i = 0; i < 60 * 20; i++) b.sim.step({ mx: Math.abs(b.P.tilt) > 0.12 ? -Math.sign(b.P.tilt) : 0 });
    });
    assert.equal(b.P.floor, 0, `graine ${sd} : tenu 20 s en corrigeant`);
  }
});

test("barre d'équilibre : on n'y avance que tout droit et lentement, Q / D ne font pas de pas de côté", () => {
  const { sim, P } = onBeam(4);
  sim.step();
  const x0 = P.x;
  const z0 = P.z;
  P.tilt = 0;
  withSeed(3, () => sim.step({ mx: 1 }));
  assert.ok(Math.hypot(P.x - x0, P.z - z0) < 1e-6, 'Q / D : pas de déplacement');
  assert.ok(P.tiltV > 0, 'D penche à droite');
  // pas de course sur l'arête
  P.tilt = 0;
  P.tiltV = 0;
  withSeed(5, () => sim.step({ my: 1, run: true }));
  assert.equal(P.running, false);
});

test("réseau : un invité qui perd l'équilibre chez lui tombe chez l'hôte, et l'inclinaison se voit", () => {
  const players = [{ id: 1, name: 'Hôte' }, { id: 2, name: 'Invité' }];
  const host = new BackroomsSim({ difficulty: 'peaceful', seed: 8, players, localId: 1 });
  const [p0, p1] = host.map.pits;
  const g = host.players[1];
  g.x = p0.gx === p1.gx ? Math.round(p0.x / CELL_SIZE) * CELL_SIZE : (p0.x + p1.x) / 2;
  g.z = p0.gz === p1.gz ? Math.round(p0.z / CELL_SIZE) * CELL_SIZE : (p0.z + p1.z) / 2;
  host.step({}, { 2: { remote: true, pos: { x: g.x, z: g.z }, tilt: 0.7 } });
  assert.equal(g.tilt, 0.7);
  assert.ok(g.onBeam);
  host.step({}, { 2: { remote: true, beamFall: 1 } });
  assert.equal(g.floor, 1, "l'invité est tombé à l'étage du dessous");
});

test("Level 0 : aucune cassette du bas sous un trou du haut (on la verrait au fond du puits sans pouvoir la prendre)", () => {
  for (let sd = 1; sd <= 60; sd++) {
    const [up, down] = createLevel0(sd).floors;
    for (const c of down.cassettes) assert.ok(up.pits.every((p) => Math.hypot(p.x - c.x, p.z - c.z) >= 6), `graine ${sd} : cassette ${c.id} sous un trou`);
  }
});

test("Level 0 sur deux étages : les trous mènent en bas, deux escaliers loin des trous, les cassettes réparties", () => {
  for (const sd of [1, 7, 19, 33, 64]) {
    const L = createLevel0(sd);
    const [up, down] = L.floors;
    assert.equal(L.stairs.length, 2, `graine ${sd} : deux escaliers`);
    for (const st of L.stairs) {
      assert.ok(up.pits.every((p) => Math.abs(p.gx - st.gx) + Math.abs(p.gz - st.gz) >= 6), 'loin des trous');
      assert.ok(up.dist[st.gz * up.W + st.gx] >= 0 && down.dist[st.gz * down.W + st.gx] >= 0, 'accessible aux deux étages');
    }
    for (const p of up.pits) assert.ok(down.dist[p.gz * down.W + p.gx] >= 0, 'on atterrit sur du sol accessible');
    assert.ok(down.cassettes.length >= 1 && up.cassettes.length >= 1, 'des cassettes aux deux étages');
    assert.deepEqual([...up.cassettes, ...down.cassettes].map((c) => c.id).sort(), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(up.cassettes.length, 4, "4 cassettes en haut");
    assert.equal(down.cassettes.length, 3, "3 cassettes en bas");
    assert.ok(up.elevator && down.elevator, 'un ascenseur à chaque étage');
  }
});

test("chute : par un trou, on atterrit à l'étage du dessous, juste en dessous ; l'escalier fait remonter", () => {
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 7 });
  const P = sim.player;
  const pit = sim.map.pits[0];
  P.x = pit.x + 0.2;
  P.z = pit.z;
  sim.step();
  assert.equal(P.floor, 1, "en bas");
  assert.ok(Math.hypot(P.x - pit.x, P.z - pit.z) < 0.01, 'juste sous le trou');
  assert.ok(sim.drainEvents().some((e) => e.type === 'fall'));
  // sonné un instant : pas de pas tout de suite
  const x0 = P.x;
  sim.step({ my: 1 });
  assert.equal(P.x, x0);
  // l'escalier coudé : de l'étage du bas on remonte en marchant, marche après marche, demi-tour sur le palier,
  // sans être téléporté
  const st = sim.stairs[0];
  const C = CELL_SIZE;
  const W = (u, v) => ({ x: st.ox + st.dx * u + st.px * v, z: st.oz + st.dz * u + st.pz * v });
  const walk = (pts, check) => {
    for (const w of pts) {
      for (let i = 0; i < 400 && Math.hypot(P.x - w.x, P.z - w.z) > 0.25; i++) {
        P.yaw = Math.atan2(-(w.x - P.x), -(w.z - P.z));
        const before = { x: P.x, z: P.z, y: feetY(sim.stairs, P.x, P.z, P.floor) };
        sim.step({ my: 1, yaw: P.yaw });
        check(before);
      }
      assert.ok(Math.hypot(P.x - w.x, P.z - w.z) <= 0.25, `atteint ${w.x.toFixed(1)}, ${w.z.toFixed(1)}`);
    }
  };
  run(sim, 2.5);
  P.x = st.down.x;
  P.z = st.down.z;
  let climbed = false;
  let top = -Infinity;
  walk([W(0.3, C / 2), W(2.5 * C, C / 2), W(2.5 * C, 1.5 * C), W(0.3, 1.5 * C), st.up], (b) => {
    const y = feetY(sim.stairs, P.x, P.z, P.floor);
    assert.ok(Math.hypot(P.x - b.x, P.z - b.z) < 0.2, 'pas de téléportation');
    assert.ok(y >= b.y - 1e-9 && y - b.y < 0.2, 'les pieds montent peu à peu');
    if (Math.abs(y + FLOOR_DY / 2) < 0.01) climbed = true;
    top = Math.max(top, y);
  });
  assert.ok(climbed, 'on est passé par le palier, à mi-hauteur');
  assert.equal(P.floor, 0, "remonté par l'escalier");
  assert.ok(FLOOR_DY > 6, 'les étages sont loin l\'un de l\'autre');
  // et on redescend par le même chemin (la porte du haut s'ouvre avec la clé)
  sim.floors[0].key.taken = true;
  walk([W(0.3, 1.5 * C), W(2.5 * C, 1.5 * C), W(2.5 * C, C / 2), W(0.3, C / 2), st.down], () => {});
  assert.equal(P.floor, 1, 'redescendu');
  // pas de raccourci d'une volée à l'autre par-dessus la rampe du milieu
  P.x = W(1.0 * C, C / 2).x;
  P.z = W(1.0 * C, C / 2).z;
  P.floor = 1;
  const goal = W(1.0 * C, 1.5 * C);
  for (let i = 0; i < 120; i++) sim.step({ my: 1, yaw: Math.atan2(-(goal.x - P.x), -(goal.z - P.z)) });
  assert.equal(stairAt(sim.stairs, P.x, P.z).lane, 'A', 'resté sur la première volée');
  // on ne monte pas sur les marches par le côté, et on ne tombe pas dans la trémie depuis l'étage du haut
  for (const side of [W(1.5 * C, -0.5 * C), W(1.5 * C, 2.5 * C), W(3.5 * C, C), W(-0.5 * C, 1.5 * C), W(-0.5 * C, 0.5 * C)]) {
    for (const floor of [0, 1]) {
      if (sim.isColliding(side.x, side.z, 0.38, floor)) continue;
      P.floor = floor;
      P.x = side.x;
      P.z = side.z;
      // les deux entrées permises : en bas de la première volée (étage du bas), en haut de la seconde (étage du haut)
      const lA = stairLocal(st, side.x, side.z);
      if ((lA.u < 0 && lA.v < C && floor === 1) || (lA.u < 0 && lA.v > C && floor === 0)) continue;
      for (let i = 0; i < 180; i++) sim.step({ my: 1, yaw: Math.atan2(-(st.cx - P.x), -(st.cz - P.z)) });
      assert.ok(!stairAt(sim.stairs, P.x, P.z), `étage ${floor} : bloqué au bord de l'escalier`);
      assert.equal(P.floor, floor);
    }
  }
});

test("Level 0 : la cage d'escalier ne coupe aucun étage, et le couloir piégé a son point de départ", () => {
  for (const sd of [1, 7, 19, 33, 64, 101]) {
    const L = createLevel0(sd);
    const [up, down] = L.floors;
    for (const st of L.stairs) assert.equal(st.cells.length, 6, 'deux volées et un palier');
    for (const [m, entry] of [[up, 'up'], [down, 'down']]) {
      const blocked = new Set(L.stairs.flatMap((st) => st.cells.map((c) => c.gz * m.W + c.gx)));
      const g = m.grid.map((v, i) => (blocked.has(i) ? 2 : v));
      const st = L.stairs[0];
      const d = bfs(g, m.W, m.H, Math.floor(st[entry].x / CELL_SIZE), Math.floor(st[entry].z / CELL_SIZE));
      for (let i = 0; i < g.length; i++) if (m.dist[i] >= 0 && !blocked.has(i)) assert.ok(d[i] >= 0, `graine ${sd} : tout l'étage reste accessible`);
    }
    if (up.trap) assert.ok(!up.isWall(Math.floor(up.trap.x / CELL_SIZE), Math.floor(up.trap.z / CELL_SIZE)), 'départ du parcours sur le sol');
  }
});

test("ascenseurs : un en haut, un en bas ; les 7 cassettes trouvées, le faux devient un mur et seul le vrai emmène", () => {
  for (const real of [0, 1]) {
    const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 11 });
    sim.realFloor = real;
    const fake = 1 - real;
    // fermés tous les deux, impossibles à distinguer
    for (const f of sim.floors) assert.ok(sim.isColliding(f.elevator.x, f.elevator.z, 0.3, sim.floors.indexOf(f)));
    for (const c of sim.allCassettes) {
      putOn(sim, sim.player, c);
      sim.step();
    }
    assert.equal(sim.cassettes, 7);
    assert.ok(sim.fm(fake).elevator.fake, 'le faux est démasqué');
    assert.ok(!sim.fm(real).elevator.fake);
    assert.ok(sim.isColliding(sim.fm(fake).elevator.x, sim.fm(fake).elevator.z, 0.3, fake), "le faux n'est plus qu'un mur");
    assert.ok(!sim.isColliding(sim.fm(real).elevator.x, sim.fm(real).elevator.z, 0.3, real), 'le vrai est ouvert');
    // le signal de chaque étage pointe vers son propre ascenseur (le doute reste)
    const P = sim.player;
    P.floor = fake;
    P.x = sim.fm(fake).exit.x;
    P.z = sim.fm(fake).exit.z;
    sim.step();
    assert.equal(P.sigTo, 'exit');
    assert.ok(P.signal > 0.9);
    assert.equal(P.status, 'alive', 'devant le faux, rien ne se passe');
    P.floor = real;
    P.x = sim.fm(real).elevator.x;
    P.z = sim.fm(real).elevator.z;
    sim.step();
    assert.equal(P.status, 'elevator', 'le vrai emmène');
  }
});

test("clé : la porte du haut de l'escalier est cadenassée ; la clé, au fond d'une zone morte, l'ouvre pour tous", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const players = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
    const sim = new BackroomsSim({ difficulty: 'peaceful', seed, players, localId: 1 });
    const K = sim.floors[0].key;
    assert.ok(K, `graine ${seed} : une clé`);
    const top = sim.floors[0];
    assert.ok(!top.isWall(K.gx, K.gz) && !(top.pitAt && top.pitAt(K.gx, K.gz) >= 0), 'posée par terre, pas dans un trou');
    assert.ok(Math.hypot(K.x - top.spawn.x, K.z - top.spawn.z) >= 30, 'loin du départ');
    assert.ok(sim.stairs.every((st) => Math.hypot(st.x - K.x, st.z - K.z) >= 18), "loin de l'escalier");
    assert.ok(!sim.litCell(top, K.x, K.z), 'dans le noir');
    // les invités la posent au même endroit
    const g = new BackroomsSim({ difficulty: 'peaceful', seed, players, localId: 2 });
    assert.deepEqual([g.floors[0].key.x, g.floors[0].key.z], [K.x, K.z]);
    // fermée : on bute contre la porte, en entendant le cadenas
    const P = sim.player;
    const st = sim.stairs[0];
    const C = CELL_SIZE;
    const W = (u, v) => ({ x: st.ox + st.dx * u + st.px * v, z: st.oz + st.dz * u + st.pz * v });
    const go = () => {
      const a = W(-0.6, 1.5 * C);
      P.x = a.x;
      P.z = a.z;
      P.floor = 0;
      const b = W(1.0, 1.5 * C);
      const evs = [];
      for (let i = 0; i < 90; i++) {
        sim.step({ my: 1, yaw: Math.atan2(-(b.x - P.x), -(b.z - P.z)) });
        evs.push(...sim.drainEvents());
      }
      return evs;
    };
    assert.ok(sim.stairsLocked);
    assert.ok(sim.lockedDoorNear(P, 99), 'la porte est repérée');
    const evs = go();
    assert.ok(!stairAt(sim.stairs, P.x, P.z), 'la porte ne cède pas');
    assert.ok(evs.some((e) => e.type === 'locked' && e.id === P.id), 'le cadenas claque');
    // F à côté de la clé : elle est à nous, la porte s'ouvre pour tout le monde
    P.x = K.x + 0.5;
    P.z = K.z;
    sim.step({ pick: true });
    const got = sim.drainEvents().find((e) => e.type === 'key');
    assert.ok(got && got.by === P.id && K.taken, 'la clé ramassée');
    assert.ok(!sim.stairsLocked);
    g.applySnapshot(JSON.parse(JSON.stringify(sim.snapshot())));
    assert.ok(g.floors[0].key.taken && !g.stairsLocked, "l'invité le sait aussi");
    go();
    assert.ok(stairAt(sim.stairs, P.x, P.z), "on entre dans l'escalier");
  }
});

test("voix : parler fait du bruit, le talkie grésille chez les autres, et le vacarme la rend agressive", () => {
  const players = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 5, players, localId: 1 });
  const [A, B, C] = sim.players;
  // un murmure de rien ne compte pas ; une voix normale fait plus de bruit que marcher ; un cri, plus que courir
  sim.step({ voice: 0.08 });
  assert.ok(!(A.noise > NOISE.walk), 'le souffle du micro ne compte pas');
  sim.step({ voice: 0.6 });
  assert.ok(A.noise > NOISE.walk && A.noise < NOISE.run, `une voix normale (${A.noise.toFixed(2)})`);
  sim.step({ voice: 1 });
  assert.ok(A.noise > NOISE.run, 'un cri');
  for (let i = 0; i < 40; i++) sim.step({});
  // au talkie : chez les autres aussi (leur haut-parleur), même loin
  sim.step({ voice: 0.6, radio: true });
  assert.ok(A.radio);
  assert.ok(B.noise > NOISE.walk && C.noise > NOISE.walk, 'le talkie grésille chez chacun');
  // coupure (les néons qui meurent) : le talkie ne passe plus, ni chez les autres, ni chez l'invité (instantané)
  for (let i = 0; i < 40; i++) sim.step({});
  sim.lightsOut = { list: [], t: 0, n: 0, id: 1, floor: 0 };
  assert.ok(sim.radioDead);
  sim.step({ voice: 0.6, radio: true });
  assert.ok(!A.radio && !(B.noise > NOISE.walk), 'en coupure, le talkie est mort');
  const g = new BackroomsSim({ difficulty: 'peaceful', seed: 5, players, localId: 2 });
  sim.lightsOut = { list: [], t: 0, n: 0, id: 1, floor: 0 }; // (la séquence vide s'est déjà terminée au pas précédent)
  g.applySnapshot(JSON.parse(JSON.stringify(sim.snapshot())));
  assert.ok(g.radioDead, "l'invité le sait");
  sim.lightsOut = null;
  g.applySnapshot(JSON.parse(JSON.stringify(sim.snapshot())));
  assert.ok(!sim.radioDead && !g.radioDead, 'le courant revient, le talkie aussi');
  // un invité : son niveau arrive avec ses commandes
  for (let i = 0; i < 40; i++) sim.step({});
  sim.step({}, { 2: { remote: true, voice: 0.7 } });
  assert.ok(B.noise > NOISE.walk && !(C.noise > NOISE.walk), "la voix de l'invité, de vive voix : chez lui seulement");
  // les morts ne font plus de bruit
  C.status = 'dead';
  sim.step({}, { 3: { remote: true, voice: 1 } });
  assert.equal(C.voice, 0);
  // le vacarme : à force de parler, elle devient plus agressive, et on est prévenu ; puis il retombe
  const a0 = sim.aggro;
  const evs = [];
  for (let i = 0; i < 60 * 40; i++) {
    sim.step({ voice: 0.7 });
    evs.push(...sim.drainEvents().filter((e) => e.type === 'din'));
  }
  assert.ok(sim.din > 0.8, `le vacarme monte (${sim.din.toFixed(2)})`);
  assert.ok(sim.aggro > a0 + 0.3, 'elle est plus agressive');
  assert.deepEqual(evs.map((e) => e.level), [1, 2], 'deux paliers, chacun une fois');
  for (let i = 0; i < 60 * 100; i++) sim.step({});
  assert.ok(sim.din < 0.5, `il retombe dans le silence (${sim.din.toFixed(2)})`);
});

test("signal : sans cassette à son étage, le caméscope guide vers l'escalier", () => {
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 19 });
  const P = sim.player;
  for (const c of sim.map.cassettes) c.collected = true;
  sim.step();
  assert.equal(P.sigTo, 'key', "d'abord la clé de la porte du haut");
  sim.floors[0].key.taken = true;
  sim.step();
  assert.equal(P.sigTo, 'stairs');
  P.floor = 1;
  P.x = sim.fm(1).cassettes[0].x + 3;
  P.z = sim.fm(1).cassettes[0].z;
  sim.step();
  assert.equal(P.sigTo, 'goal');
});

test("l'entité prend l'escalier pour suivre un joueur à l'autre étage, et on l'entend étouffée à travers le plancher", () => {
  const sim = new BackroomsSim({ difficulty: 'normal', seed: 7 });
  const P = sim.player;
  const M = sim.monster;
  const st = sim.stairs[0];
  P.floor = 1;
  P.x = st.down.x;
  P.z = st.down.z;
  M.floor = 0;
  M.x = st.x + 0.8;
  M.z = st.z;
  sim.senseMonster();
  const muffled = P.danger;
  assert.ok(muffled < 0.3, "à l'autre étage, son bourdonnement est étouffé");
  M.mode = 'search';
  let t = 0;
  while (M.floor === 0 && t < 20) {
    sim.step();
    t += DT;
  }
  assert.equal(M.floor, 1, "elle est descendue");
  assert.ok(sim.drainEvents().some((e) => e.type === 'monsterStairs'));
});

test("réseau : l'étage, la chute et le faux ascenseur arrivent chez l'invité", () => {
  const players = [{ id: 1, name: 'Hôte' }, { id: 2, name: 'Invité' }];
  const host = new BackroomsSim({ difficulty: 'peaceful', seed: 12, players, localId: 1 });
  const guest = new BackroomsSim({ difficulty: 'peaceful', seed: 12, players, localId: 2 });
  const wire = () => guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
  assert.deepEqual(Array.from(guest.fm(1).grid), Array.from(host.fm(1).grid), "même étage du bas");
  const g = host.players[1];
  const pit = host.map.pits[0];
  g.x = pit.x;
  g.z = pit.z;
  host.step();
  wire();
  assert.equal(guest.player.floor, 1, "l'invité est en bas chez lui aussi");
  assert.ok(Math.hypot(guest.player.x - pit.x, guest.player.z - pit.z) < 0.01);
  // le vrai ascenseur ne se dévoile qu'une fois les cassettes trouvées
  assert.equal(host.snapshot().rf, -1);
  for (const c of host.allCassettes) {
    putOn(host, host.player, c);
    host.step();
  }
  wire();
  assert.equal(guest.realFloor, host.realFloor);
  assert.ok(guest.fm(1 - host.realFloor).elevator.fake);
  // objets posés aux deux étages
  const h = host.player;
  h.floor = 1;
  const [b0, b1, b2] = host.fm(1).items.filter((i) => i.kind !== 'ladder');
  for (const b of [b0, b1, b2]) {
    h.x = b.x;
    h.z = b.z;
    host.step({ pick: true });
  }
  wire();
  assert.equal(guest.fm(1).items.length, host.fm(1).items.length, "l'objet posé en bas apparaît chez l'invité");
  assert.equal(guest.fm(1).items[1].taken, host.fm(1).items[1].taken);
});

test("l'entité qui perd sa proie de vue va là où elle l'a vue, fouille autour, puis reprend sa ronde", () => {
  const sim = new BackroomsSim({ difficulty: 'normal', seed: 5 });
  const P = sim.player;
  const M = sim.monster;
  const cells = sim.map.walkable;
  const at = (c) => ({ x: (c.x + 0.5) * CELL_SIZE, z: (c.z + 0.5) * CELL_SIZE });
  // le joueur loin, hors de vue et à l'arrêt ; l'entité en chasse vient de le perdre
  const far = cells.reduce((b, c) => (Math.hypot(at(c).x - M.x, at(c).z - M.z) > Math.hypot(at(b).x - M.x, at(b).z - M.z) ? c : b));
  P.x = at(far).x;
  P.z = at(far).z;
  const last = cells.find((c) => {
    const d = Math.hypot(at(c).x - M.x, at(c).z - M.z);
    return d > 6 && d < 10;
  });
  M.mode = 'chase';
  M.unseenT = 0.1;
  M.lastSeenX = at(last).x;
  M.lastSeenZ = at(last).z;
  M.repathT = 0;
  sim.step();
  assert.ok(Math.hypot(M.goal.x - M.lastSeenX, M.goal.z - M.lastSeenZ) < 0.01, 'elle vise le dernier endroit vu, pas le joueur');
  const modes = new Set();
  for (let i = 0; i < 60 * 40 && M.mode !== 'patrol'; i++) {
    sim.step();
    modes.add(M.mode);
  }
  assert.ok(modes.has('search'), 'elle fouille');
  assert.equal(M.mode, 'patrol', 'puis reprend sa ronde');
});

test("réseau : l'eau d'amande bue par un invité lui rend son souffle, et l'escalier ne le ramène pas en arrière", () => {
  const players = [{ id: 1, name: 'Hôte' }, { id: 2, name: 'Invité' }];
  const host = new BackroomsSim({ difficulty: 'peaceful', seed: 7, players, localId: 1 });
  const guest = new BackroomsSim({ difficulty: 'peaceful', seed: 7, players, localId: 2 });
  const G = guest.player;
  const HG = host.players[1];
  HG.inv = ['bottle', null];
  HG.stamina = 100; // l'hôte croit l'invité reposé
  G.stamina = 12; // chez lui, il est à bout de souffle
  host.step({}, { 2: { remote: true, stamina: 12, useSel: true, sel: 1 } });
  assert.deepEqual(HG.inv, [null, null], 'la bouteille est bue');
  guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
  assert.equal(G.stamina, 100 + ALMOND_GROW, "l'endurance de l'invité est pleine (jauge agrandie)");
  // l'invité monte l'escalier chez lui ; l'hôte a un quart de seconde de retard dans chaque sens
  const st = host.stairs[0];
  const C = CELL_SIZE;
  const Wp = (u, v) => ({ x: st.ox + st.dx * u + st.px * v, z: st.oz + st.dz * u + st.pz * v });
  for (const P of [G, HG]) {
    P.x = st.down.x;
    P.z = st.down.z;
    P.floor = 1;
  }
  const path = [Wp(0.3, C / 2), Wp(2.5 * C, C / 2), Wp(2.5 * C, 1.5 * C), Wp(0.3, 1.5 * C), st.up];
  const toHost = [];
  const toGuest = [];
  let wi = 0;
  let last = null;
  for (let t = 0; t < 60 * 40 && wi < path.length; t++) {
    const w = path[wi];
    if (Math.hypot(G.x - w.x, G.z - w.z) < 0.25) {
      wi++;
      continue;
    }
    G.yaw = Math.atan2(-(w.x - G.x), -(w.z - G.z));
    guest.predict({ my: 1, yaw: G.yaw });
    toHost.push({ at: t + 15, i: { my: 1, yaw: G.yaw, pos: { x: G.x, z: G.z } } });
    let inp = null;
    while (toHost.length && toHost[0].at <= t) inp = toHost.shift().i;
    if (inp) last = inp;
    host.step({}, { 2: { remote: true, ...(last || {}), pos: inp ? inp.pos : null } });
    if (t % 3 === 0) toGuest.push({ at: t + 15, s: JSON.parse(JSON.stringify(host.snapshot())) });
    while (toGuest.length && toGuest[0].at <= t) {
      const bx = G.x;
      const bz = G.z;
      guest.applySnapshot(toGuest.shift().s);
      assert.ok(Math.hypot(G.x - bx, G.z - bz) < 0.05, 'pas ramené en arrière');
    }
  }
  assert.equal(wi, path.length, "l'invité arrive en haut");
  for (let t = 0; t < 40; t++) host.step({}, { 2: { remote: true, pos: { x: G.x, z: G.z } } });
  guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
  assert.equal(G.floor, 0);
  assert.equal(HG.floor, 0, "l'hôte le voit en haut lui aussi");
  assert.ok(Math.hypot(HG.x - G.x, HG.z - G.z) < 0.3, 'au même endroit');
});

test("l'entité se tapit dans le noir pour observer, sursaute une fois devant la lampe (de loin), et s'énerve à chaque cassette", () => {
  let watched = 0;
  let fled = 0;
  let darker = 0;
  for (const sd of [2, 6, 11, 19]) {
    withSeed(sd, () => {
      const sim = new BackroomsSim({ difficulty: 'normal', seed: sd });
      const P = sim.player;
      const M = sim.monster;
      P.flashlight = false;
      // l'entité à une vingtaine de mètres, hors de vue
      const c = sim.map.walkable.find((q) => {
        const d = Math.hypot((q.x + 0.5) * CELL_SIZE - P.x, (q.z + 0.5) * CELL_SIZE - P.z);
        return d > 18 && d < 24 && !hasLineOfSight(sim.map, (q.x + 0.5) * CELL_SIZE, (q.z + 0.5) * CELL_SIZE, P.x, P.z);
      });
      M.x = (c.x + 0.5) * CELL_SIZE;
      M.z = (c.z + 0.5) * CELL_SIZE;
      M.stalkT = 0;
      M.dormantT = 0; // passé la première minute de calme
      M.warpT = 1e9; // ici, elle ne triche pas : on regarde comment elle se tapit
      for (let i = 0; i < 60 * 40 && M.mode !== 'watch'; i++) {
        sim.step();
        if (M.mode === 'chase') return;
      }
      if (M.mode !== 'watch') return;
      watched++;
      sim.darkCellsOf(sim.map);
      const darkAt = (x, z) => sim.map.darkCells[Math.floor(z / CELL_SIZE) * sim.map.W + Math.floor(x / CELL_SIZE)];
      if (darkAt(M.x, M.z) < darkAt(P.x, P.z)) darker++;
      const d = Math.hypot(M.x - P.x, M.z - P.z);
      assert.ok(d > 6 && d < 22, `à distance (${d.toFixed(1)} m)`);
      // elle reste là à regarder sans charger
      for (let i = 0; i < 60; i++) sim.step();
      assert.notEqual(M.mode, 'chase', "elle observe sans charger");
      // la lampe braquée sur elle, de loin et tout au début : un seul sursaut, elle s'enfuit (de près, elle chargerait)
      P.flashlight = true;
      P.yaw = Math.atan2(-(M.x - P.x), -(M.z - P.z));
      if (M.mode === 'watch' && hasLineOfSight(sim.map, P.x, P.z, M.x, M.z)) {
        sim.step({ yaw: P.yaw });
        if (M.mode === 'flee') fled++;
      }
    });
  }
  assert.ok(watched >= 2, `${watched} fois tapie sur 4`);
  assert.ok(fled >= 1, 'elle sursaute devant la lampe');
  assert.ok(darker >= 2, `${darker} fois dans un coin plus sombre que le joueur`);
  // plus agressive à chaque cassette : vitesse de charge
  const sim = new BackroomsSim({ difficulty: 'normal', seed: 4 });
  const speedAt = (n) => {
    sim.cassettes = n;
    sim.monster.mode = 'chase';
    sim.monster.x = sim.player.x + 5;
    sim.monster.z = sim.player.z;
    sim.updateMonster();
    return sim.monster.speed;
  };
  assert.equal(sim.aggro, 0);
  const s0 = speedAt(0);
  const s3 = speedAt(3);
  const s5 = speedAt(7);
  assert.ok(s0 < s3 && s3 < s5, `la charge s'accélère : ${s0.toFixed(2)} < ${s3.toFixed(2)} < ${s5.toFixed(2)}`);
  assert.equal(sim.aggro, 1);
});

test("Level 37 (Poolrooms) : salles et bassins reliés, 3 vannes et 3 toboggans accessibles, l'eau ralentit", () => {
  for (const sd of [1, 2, 3, 37, 99, 123, 500, 777]) {
    const m = createPoolMap(sd);
    assert.equal(m.level, 2);
    assert.equal(m.fuses.length, 3, `graine ${sd} : 3 vannes`);
    for (const f of m.fuses) assert.ok(m.dist[f.gz * m.W + f.gx] > 0, `graine ${sd} : vanne accessible`);
    // 3 toboggans de couleurs différentes, dans un mur, devant une case accessible, au sec ou presque
    assert.deepEqual(m.slides.map((x) => x.color), ['red', 'yellow', 'blue'], `graine ${sd} : 3 toboggans`);
    for (const x of m.slides) {
      assert.ok(m.dist[x.gz * m.W + x.gx] > 10, `graine ${sd} : toboggan accessible, loin du départ`);
      assert.ok(m.isWall(x.nx, x.nz), "le toboggan sort d'un mur");
      assert.ok(m.depthAt(x.x - x.dx * 0.6, x.z - x.dz * 0.6) <= 0.21, 'on y entre au sec ou presque');
      assert.ok(!m.collide(x.x - x.dx * 0.6, x.z - x.dz * 0.6, 0.38), 'rien devant la bouche');
    }
    // objectifs et toboggans bien écartés les uns des autres
    const pts = [...m.fuses, ...m.slides];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) > 7, `graine ${sd} : deux objectifs trop proches`);
    assert.ok(m.walkable.some((c) => m.depth[c.z * m.W + c.x] >= 0.5), `graine ${sd} : des bassins`);
    for (const it of m.items) assert.equal(m.depthAt(it.x, it.z), 0, 'les objets sont au sec');
    // des salles préfabriquées : lagon, voûtes, couloirs… séparées par des cloisons percées de portes
    assert.ok(m.rooms.length >= 12, `graine ${sd} : ${m.rooms.length} salles`);
    assert.equal(m.rooms.filter((r) => r.type === 'tech').length >= 3, true, `graine ${sd} : 3 locaux techniques`);
    for (const sg of m.segs) assert.ok(m.collide((sg.x0 + sg.x1) / 2, (sg.z0 + sg.z1) / 2, 0.38), 'une cloison arrête le joueur');
    for (const d of m.doors) assert.ok(!m.collide(d.px, d.pz, 0.38), 'on passe par une porte');
  }
  // dans l'eau, on avance moins vite
  const sim = new BackroomsSim({ difficulty: 'normal', seed: 5, level: 2 });
  const P = sim.player;
  const dry = sim.map.walkable.find((c) => sim.map.depth[c.z * sim.map.W + c.x] === 0);
  const deep = sim.map.walkable.find((c) => sim.map.depth[c.z * sim.map.W + c.x] >= 0.5);
  const walk = (c) => {
    P.x = (c.x + 0.5) * CELL_SIZE;
    P.z = (c.z + 0.5) * CELL_SIZE;
    const x0 = P.x;
    const z0 = P.z;
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      P.x = x0;
      P.z = z0;
      sim.step({ my: 1, yaw });
      const d = Math.hypot(P.x - x0, P.z - z0);
      if (d > 0.001) return d;
    }
    return 0;
  };
  const a = walk(dry);
  const b = walk(deep);
  assert.ok(b < a * 0.8, `plus lent dans l'eau (${b.toFixed(4)} contre ${a.toFixed(4)})`);
  // l'entité ne sort pas de l'eau : personne n'est poursuivi aux Poolrooms
  run(sim, 5);
  assert.equal(P.status, 'alive');
  assert.equal(sim.monster.mode, 'patrol');
});

test('Level 37 : le premier qui prend un toboggan choisit la couleur, les autres se referment', () => {
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 12, level: 2, players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], localId: 'a' });
  for (const f of sim.map.fuses) {
    sim.players[0].x = f.x;
    sim.players[0].z = f.z;
    sim.step();
  }
  assert.equal(sim.open, true);
  const [red, , blue] = sim.map.slides;
  const [A, B] = sim.players;
  A.x = red.x - red.dx * 0.6;
  A.z = red.z - red.dz * 0.6;
  sim.step();
  assert.equal(A.status, 'elevator');
  assert.equal(sim.slide, 0);
  B.x = blue.x - blue.dx * 0.6;
  B.z = blue.z - blue.dz * 0.6;
  sim.step();
  assert.equal(B.status, 'alive', 'le toboggan bleu est fermé');
  // l'invité reçoit le toboggan choisi
  const guest = new BackroomsSim({ difficulty: 'peaceful', seed: 12, level: 2, players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], localId: 'b' });
  guest.applySnapshot(sim.snapshot());
  assert.equal(guest.slide, 0);
  B.x = red.x - red.dx * 0.6;
  B.z = red.z - red.dz * 0.6;
  sim.step();
  assert.equal(B.status, 'elevator');
  run(sim, DEPART_T + 0.2);
  assert.equal(sim.state, 'won');
});

test('Level 37 : le toboggan jaune descend aux Tuyauteries (Level 2), le dernier niveau', () => {
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 12, level: 2 });
  for (const f of sim.map.fuses) {
    sim.player.x = f.x;
    sim.player.z = f.z;
    sim.step();
  }
  const yellow = sim.map.slides.find((x) => x.color === 'yellow');
  assert.equal(yellow.to, PIPES_LEVEL);
  sim.player.x = yellow.x - yellow.dx * 0.6;
  sim.player.z = yellow.z - yellow.dz * 0.6;
  sim.step();
  assert.equal(sim.player.status, 'elevator');
  sim.drainEvents();
  run(sim, DEPART_T + 0.2);
  assert.equal(sim.state, 'playing', 'pas encore gagné : il reste les Tuyauteries');
  assert.equal(sim.level, PIPES_LEVEL);
  assert.ok(sim.drainEvents().some((e) => e.type === 'level' && e.level === PIPES_LEVEL));
  assert.equal(sim.map.valves.length, 4, 'les 4 vannes des galeries');
  assert.equal(sim.slide, -1, "plus de toboggan : l'ascenseur de service est la sortie");
});

test('objectifs écartés : cassettes et fusibles loin les uns des autres (en marche)', () => {
  const minPath = (m, pts) => {
    let mn = Infinity;
    for (const a of pts) {
      const d = bfs(m.grid, m.W, m.H, a.gx, a.gz);
      for (const b of pts) if (b !== a && d[b.gz * m.W + b.gx] >= 0) mn = Math.min(mn, d[b.gz * m.W + b.gx]);
    }
    return mn;
  };
  for (const sd of [1, 5, 9, 42, 77]) {
    const up = createLevel0(sd).floors[0];
    assert.ok(minPath(up, up.cassettes) >= 12, `graine ${sd} : cassettes trop proches (${minPath(up, up.cassettes)} cases)`);
    const w = createWarehouseMap(sd * 7 + 13);
    assert.ok(minPath(w, w.fuses) >= 12, `graine ${sd} : fusibles trop proches (${minPath(w, w.fuses)} cases)`);
  }
});

test('Level 37 : on traverse chaque porte en marchant, les cloisons arrêtent le joueur', () => {
  let crossed = 0;
  for (const sd of [1, 2, 3, 4, 5, 6]) {
    const sim = new BackroomsSim({ difficulty: 'peaceful', seed: sd, level: 2 });
    for (const d of sim.map.doors) {
      const nx = d.along === 'z' ? 1 : 0;
      const nz = d.along === 'x' ? 1 : 0;
      let x = d.px - nx * 1.2;
      let z = d.pz - nz * 1.2;
      if (sim.isColliding(x, z, 0.38, 0)) {
        x = d.px + nx * 1.2;
        z = d.pz + nz * 1.2;
      }
      const dir = Math.sign(d.px - x + (d.pz - z));
      for (let i = 0; i < 80; i++) {
        const p = sim.moveWithCollisions(x, z, nx * dir * 0.05, nz * dir * 0.05, 0.38, 0);
        x = p.x;
        z = p.z;
      }
      assert.ok((x - d.px) * nx * dir + (z - d.pz) * nz * dir > 1, `graine ${sd} : porte franchie`);
      crossed++;
    }
  }
  assert.ok(crossed > 60);
});

// --- Level 2 : les galeries, les halles et le troupeau ---
import { createPipesMap, Z as Z2, PIPES_LEVEL } from '../backrooms/engine/level2.js';
import { GOAT_MODES, ALPHA_RAGE, ALPHA_TAME, isLit as isLitL2 } from '../backrooms/engine/goats.js';
import { BREAKER_T, BLOW_DELAY, VALVE_T, ALMOND_GROW, staminaMax, WALK_SPEED, CHASE_MIN, DOOR_GAP } from '../backrooms/engine/sim.js';

// un bout de galerie droite de n cases, sans grille, jet, renfoncement ni objet : { x0, z } (le long de x) ou null
const straightRun = (m, n) => {
  const free = (x, z) => m.grid[z * m.W + x] === T.FLOOR && m.zone[z * m.W + x] !== Z2.HALL && !(m.jetAt && m.jetAt(x, z)) && !m.props.some((p) => !p.walk && Math.hypot(p.x - (x + 0.5) * CELL_SIZE, p.z - (z + 0.5) * CELL_SIZE) < 1.6);
  for (let z = 2; z < m.H - 2; z++) {
    for (let x = 2; x + n < m.W - 2; x++) {
      let ok = true;
      for (let k = 0; k < n && ok; k++) ok = free(x + k, z) && m.isWall(x + k, z - 1) && m.isWall(x + k, z + 1);
      if (ok && m.isWall(x - 1, z) === false) return { x0: x, z };
    }
  }
  return null;
};
const level2 = (opts = {}) => {
  const sim = new BackroomsSim({ difficulty: 'normal', seed: 31, level: PIPES_LEVEL, ...opts });
  sim.map.goatLit = new Uint8Array(sim.map.W * sim.map.H); // tout dans le noir (les tests allument ce qu'il faut)
  return sim;
};
const cellC = (v) => (v + 0.5) * CELL_SIZE;

test('Level 2 : grandes halles à piliers, cuves, bergerie, renfoncements ; tout est relié', () => {
  for (const seed of [13603, 106, 491, 5, 77, 1000, 31337, 2024]) {
    const m = createPipesMap(seed);
    assert.ok(m.halls.length >= 1, 'au moins une grande halle');
    const big = m.halls.reduce((b, h) => ((h.x1 - h.x0 + 1) * (h.z1 - h.z0 + 1) > (b.x1 - b.x0 + 1) * (b.z1 - b.z0 + 1) ? h : b));
    assert.ok((big.x1 - big.x0 + 1) * (big.z1 - big.z0 + 1) >= 60, `une halle d'au moins 60 cases (${seed})`);
    assert.ok(m.den, 'une bergerie');
    let pillars = 0;
    for (let z = 0; z < m.H; z++) for (let x = 0; x < m.W; x++) if (m.pillarAt(x, z)) pillars++;
    assert.ok(pillars >= 4, 'des piliers de béton');
    for (const t of m.tanks) assert.equal(m.grid[t.gz * m.W + t.gx], T.MACHINE, 'une cuve occupe ses cases');
    assert.ok(m.niches.length >= 8, 'des renfoncements le long des galeries');
    for (const n of m.niches) assert.equal([[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => !m.isWall(n.gx + dx, n.gz + dz)).length, 1, 'un renfoncement est un cul-de-sac');
    const d = bfs(m.grid, m.W, m.H, m.spawn.gx, m.spawn.gz);
    for (const c of m.walkable) assert.ok(d[c.z * m.W + c.x] >= 0, `case (${c.x}, ${c.z}) isolée (${seed})`);
    for (const v of m.valves) assert.ok(d[v.gz * m.W + v.gx] >= 0, 'vanne atteignable');
    assert.ok(m.goatSpawn.every((g) => g.gx >= m.den.x0 && g.gx <= m.den.x1 && g.gz >= m.den.z0 && g.gz <= m.den.z1), 'le troupeau part de la bergerie');
  }
});

test('Level 2 : le troupeau remplace l\'entité (pas de chèvres en mode paisible)', () => {
  const sim = level2({ players: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] });
  assert.equal(sim.goats.length, 4, '2 de plus que de joueurs');
  assert.equal(new BackroomsSim({ difficulty: 'hard', seed: 31, level: PIPES_LEVEL }).goats.length, 4, 'au moins 3, une de plus en difficile');
  assert.equal(new BackroomsSim({ difficulty: 'peaceful', seed: 31, level: PIPES_LEVEL }).goats, null);
  assert.equal(new BackroomsSim({ difficulty: 'normal', seed: 31, level: 1 }).goats, null, "l'entrepôt garde son entité");
});

test('Level 2 : une chèvre repère un joueur dans le noir, gratte le sol, fonce et le percute', () => {
  const sim = level2();
  const r = straightRun(sim.map, 9);
  assert.ok(r, 'une galerie droite');
  const P = sim.player;
  P.x = cellC(r.x0);
  P.z = cellC(r.z);
  P.flashlight = false;
  const g = sim.goats[0];
  sim.goats = [g];
  g.x = cellC(r.x0 + 4);
  g.z = cellC(r.z);
  g.cool = 0;
  const acts = [];
  for (let i = 0; i < 60 * 5 && P.status === 'alive' && !(P.hurt > 0); i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === 'goat' || e.type === 'jumpscare' || e.type === 'hurt') acts.push(e.act || e.type);
  }
  assert.ok(acts.includes('windup') && acts.includes('charge'), `elle prévient avant de charger (${acts.join(', ')})`);
  assert.ok(acts.indexOf('windup') < acts.indexOf('charge'));
  assert.equal(P.status, 'alive', 'la première charge renverse');
  assert.equal(P.hurt, 1);
  assert.ok(acts.includes('hurt'));
  // la seconde tue
  P.hurtT = 0;
  P.lockT = 0;
  P.x = cellC(r.x0);
  P.z = cellC(r.z);
  g.x = cellC(r.x0 + 4);
  g.z = cellC(r.z);
  g.mode = 'roam';
  g.cool = 0;
  for (let i = 0; i < 60 * 8 && P.status === 'alive'; i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === 'jumpscare') acts.push(e.type);
    P.x = cellC(r.x0);
    P.z = cellC(r.z);
  }
  assert.equal(P.status, 'dead', 'la seconde charge tue');
  assert.ok(acts.includes('jumpscare'));
});

test('Level 2 : la lampe braquée sur une chèvre la fait détaler, même en pleine charge', () => {
  for (const charging of [false, true]) {
    const sim = level2();
    const r = straightRun(sim.map, 9);
    const P = sim.player;
    P.x = cellC(r.x0);
    P.z = cellC(r.z);
    const g = sim.goats[0];
    sim.goats = [g];
    g.x = cellC(r.x0 + 5);
    g.z = cellC(r.z);
    P.yaw = Math.atan2(-(g.x - P.x), -(g.z - P.z)); // on la regarde
    P.flashlight = true;
    if (charging) {
      g.mode = 'charge';
      g.dirX = -1;
      g.dirZ = 0;
      g.speed = 6;
      g.maxRun = 20;
    }
    const d0 = Math.hypot(g.x - P.x, g.z - P.z);
    let fled = false;
    for (let i = 0; i < 60 * 2; i++) {
      sim.step();
      if (sim.drainEvents().some((e) => e.type === 'goat' && e.act === 'flee')) fled = true;
    }
    assert.ok(fled, 'elle fuit la lumière');
    assert.equal(P.status, 'alive');
    assert.ok(Math.hypot(g.x - P.x, g.z - P.z) > d0, 'elle s\'éloigne');
  }
});

test("Level 2 : sous une lampe allumée, on est à l'abri ; une charge manquée finit contre un mur", () => {
  const sim = level2();
  const r = straightRun(sim.map, 9);
  const P = sim.player;
  P.flashlight = false;
  P.x = cellC(r.x0);
  P.z = cellC(r.z);
  // la case du joueur est éclairée : la chèvre s'arrête au bord de l'ombre et attend
  const W = sim.map.W;
  sim.map.goatLit[r.z * W + r.x0] = 1;
  sim.map.goatLit[r.z * W + r.x0 + 1] = 1;
  const g = sim.goats[0];
  sim.goats = [g];
  g.x = cellC(r.x0 + 6);
  g.z = cellC(r.z);
  g.cool = 0;
  run(sim, 6);
  assert.equal(P.status, 'alive', 'à l\'abri sous la lampe');
  assert.ok(g.x > (r.x0 + 2) * CELL_SIZE - 0.01, 'elle n\'entre pas dans la lumière');
  assert.ok(['lurk', 'stalk'].includes(g.mode), `elle attend au bord de l'ombre (${g.mode})`);
  // lancée droit sur un mur : elle s'assomme
  sim.map.goatLit.fill(0);
  P.x = P.z = -50;
  g.mode = 'charge';
  g.x = cellC(r.x0 + 4);
  g.dirX = 0;
  g.dirZ = 1; // en travers de la galerie : le mur est à un mètre
  g.speed = 6;
  g.maxRun = 30;
  g.target = null;
  let crash = false;
  for (let i = 0; i < 60 && !crash; i++) {
    sim.step();
    crash = sim.drainEvents().some((e) => e.type === 'goat' && e.act === 'crash');
  }
  assert.ok(crash, 'contre le mur');
  assert.equal(g.mode, 'stun');
});

test('Level 2 : un disjoncteur par secteur, atteignable ; le départ et l\'ascenseur sur leur propre circuit', () => {
  for (const seed of [13603, 106, 491, 5, 77, 1000, 31337, 2024]) {
    const m = createPipesMap(seed);
    assert.equal(m.breakers.length, 4, `4 disjoncteurs (${seed})`);
    assert.deepEqual(m.breakers.map((b) => b.sector).sort(), [0, 1, 2, 3], 'un par secteur');
    const d = bfs(m.grid, m.W, m.H, m.spawn.gx, m.spawn.gz);
    for (const b of m.breakers) {
      assert.ok(d[b.gz * m.W + b.gx] >= 0, 'disjoncteur atteignable');
      assert.ok(m.isWall(b.gx + b.dx, b.gz + b.dz), 'fixé à un mur');
    }
    for (const l of m.lights) {
      assert.ok(l.sector >= -1 && l.sector < 4);
      if (Math.abs(l.gx - m.spawn.gx) + Math.abs(l.gz - m.spawn.gz) <= 2) assert.equal(l.sector, -1, 'le départ ne s\'éteint jamais');
    }
    for (let i = 0; i < 4; i++) assert.ok(m.lights.some((l) => l.sector === i && l.state === 'on'), `des néons allumés dans le secteur ${i}`);
  }
});

test('Level 2 : une vanne fermée fait sauter les néons de son secteur ; le disjoncteur les rallume', () => {
  const players = [{ id: 1, name: 'Hôte' }, { id: 2, name: 'Invité' }];
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 31, players, localId: 1, level: PIPES_LEVEL });
  const guest = new BackroomsSim({ difficulty: 'peaceful', seed: 31, players, localId: 2, level: PIPES_LEVEL });
  const P = sim.player;
  const v = sim.map.valves[1];
  const mine = sim.map.lights.filter((l) => l.sector === 1 && l.base === 'on');
  const others = sim.map.lights.filter((l) => l.sector !== 1);
  const before = others.map((l) => l.state);
  assert.ok(mine.length > 2);
  P.x = v.sx;
  P.z = v.sz;
  const ev = [];
  const go = (sec) => {
    for (let i = 0; i < sec * 60; i++) {
      sim.step();
      ev.push(...sim.drainEvents().map((e) => e.type));
    }
  };
  go(VALVE_T + 0.2);
  assert.ok(v.closed && sim.valves === 1, 'vanne fermée');
  assert.ok(mine.every((l) => l.state === 'flicker'), 'les néons grésillent');
  const gen = sim.map.lightGen;
  go(BLOW_DELAY + 0.1);
  assert.ok(ev.includes('blowout'));
  assert.ok(mine.every((l) => l.state === 'off'), 'puis sautent');
  assert.ok(sim.map.lightGen > gen, "l'image relit l'éclairage");
  assert.deepEqual(others.map((l) => l.state), before, 'les autres secteurs ne bougent pas');
  guest.applySnapshot(JSON.parse(JSON.stringify(sim.snapshot())));
  assert.ok(guest.map.lights.filter((l) => l.sector === 1 && l.base === 'on').every((l) => l.state === 'off'), "chez l'invité aussi");
  // le disjoncteur d'un autre secteur ne sert à rien
  const b0 = sim.map.breakers.find((b) => b.sector === 0);
  P.x = b0.sx;
  P.z = b0.sz;
  go(BREAKER_T + 0.5);
  assert.ok(!b0.done, 'rien à réarmer');
  const b = sim.map.breakers.find((q) => q.sector === 1);
  P.x = b.sx;
  P.z = b.sz;
  go(BREAKER_T + 0.2);
  assert.ok(b.done && ev.includes('breaker'), 'réarmé');
  assert.ok(mine.every((l) => l.state === 'on'), 'le secteur se rallume');
  guest.applySnapshot(JSON.parse(JSON.stringify(sim.snapshot())));
  assert.ok(guest.map.lights.filter((l) => l.sector === 1 && l.base === 'on').every((l) => l.state === 'on'));
  assert.ok(guest.map.breakers.find((q) => q.sector === 1).done);
});

test('Level 2 : le bouc alpha ignore la lumière en fin de partie ; ébouillanté, il file à la bergerie', () => {
  const sim = level2();
  const r = straightRun(sim.map, 9);
  const P = sim.player;
  const g = sim.goats[0];
  assert.ok(g.alpha && !sim.goats[1].alpha, 'un seul bouc');
  sim.goats = [g];
  P.flashlight = false;
  P.x = cellC(r.x0);
  P.z = cellC(r.z);
  const W = sim.map.W;
  sim.map.goatLit[r.z * W + r.x0] = 1;
  sim.map.goatLit[r.z * W + r.x0 + 1] = 1;
  sim.valves = ALPHA_RAGE;
  P.hurt = 1; // déjà renversé une fois : ce coup-ci est mortel
  g.x = cellC(r.x0 + 6);
  g.z = cellC(r.z);
  g.cool = 0;
  const acts = [];
  for (let i = 0; i < 60 * 6 && P.status === 'alive'; i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === 'goat') acts.push(e.act);
  }
  assert.ok(acts.includes('rage'), 'il se fâche');
  assert.equal(P.status, 'dead', 'la lumière ne le retient plus');
  // ébouillanté par un jet qui crache, en pleine charge (le joueur revient, loin)
  P.status = 'alive';
  sim.state = 'playing';
  P.x = P.z = -50;
  const j = sim.map.jets[0];
  sim.jetOn = (q) => (q === j ? 2 : 0);
  const [ax, az] = j.axis === 'x' ? [1, 0] : [0, 1];
  g.mode = 'charge';
  g.x = j.x - ax * 2.2;
  g.z = j.z - az * 2.2;
  g.dirX = ax;
  g.dirZ = az;
  g.speed = 6;
  g.maxRun = 30;
  g.target = null;
  let scald = false;
  for (let i = 0; i < 60 && !scald; i++) {
    sim.step();
    scald = sim.drainEvents().some((e) => e.type === 'goat' && e.act === 'scald');
  }
  assert.ok(scald, 'ébouillanté');
  assert.equal(g.mode, 'flee');
  assert.ok(g.tameT > ALPHA_TAME - 1 && !g.rage, 'il craint de nouveau la lumière');
  const den = sim.map.goatSpawn[0];
  assert.ok(Math.hypot(g.goal.x - den.x, g.goal.z - den.z) < 0.1, 'il file à la bergerie');
});

test('Level 2 : tout le courant saute de temps en temps ; plus rien ne protège, le troupeau attaque', () => {
  const sim = new BackroomsSim({ difficulty: 'normal', seed: 31, level: PIPES_LEVEL });
  assert.ok(sim.nextBlackout > 40 && sim.nextBlackout < 200, 'une coupure viendra');
  assert.equal(new BackroomsSim({ difficulty: 'peaceful', seed: 31, level: PIPES_LEVEL }).nextBlackout, Infinity, 'pas en mode paisible');
  const P = sim.player;
  const lamp = sim.map.lights.find((l) => l.state === 'on' && l.sector === -1);
  P.x = (lamp.gx + 0.5) * CELL_SIZE;
  P.z = (lamp.gz + 0.5) * CELL_SIZE;
  P.flashlight = false;
  const g = sim.goats[1];
  sim.goats = [g];
  g.x = sim.map.goatSpawn[0].x;
  g.z = sim.map.goatSpawn[0].z;
  run(sim, 1);
  assert.ok(isLitL2(sim.map, P.x, P.z), 'sous la lampe');
  sim.director.calmT = 99; // un vrai moment de calme : la coupure peut tomber
  sim.nextBlackout = 0;
  sim.step();
  assert.ok(sim.blackout > 0 && sim.map.dark, 'le noir total');
  assert.ok(!isLitL2(sim.map, P.x, P.z), 'plus aucune lampe ne protège');
  run(sim, 0.5);
  assert.equal(g.mode, 'stalk');
  assert.equal(g.target, P.id, 'elle vient droit sur le joueur, même sans le voir');
  const guest = new BackroomsSim({ difficulty: 'normal', seed: 31, level: PIPES_LEVEL, players: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }], localId: 2 });
  guest.applySnapshot(JSON.parse(JSON.stringify(sim.snapshot())));
  assert.ok(guest.blackout > 0 && guest.map.dark, "chez l'invité aussi");
  sim.blackout = DT / 2;
  sim.step();
  assert.ok(!sim.map.dark && isLitL2(sim.map, P.x, P.z), 'le courant revient');
});

test("réseau : l'invité voit le troupeau et l'entend approcher", () => {
  const players = [{ id: 1, name: 'Hôte' }, { id: 2, name: 'Invité' }];
  const host = new BackroomsSim({ difficulty: 'normal', seed: 31, players, localId: 1, level: PIPES_LEVEL });
  const guest = new BackroomsSim({ difficulty: 'normal', seed: 31, players, localId: 2, level: PIPES_LEVEL });
  run(host, 2);
  const g = host.goats[1];
  const me = host.players.find((p) => p.id === 2);
  g.x = me.x + 3;
  g.z = me.z;
  g.mode = 'windup';
  guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
  assert.equal(guest.goats.length, host.goats.length);
  assert.deepEqual(guest.goats.map((q) => [q.x, q.z]), host.goats.map((q) => [Math.round(q.x * 100) / 100, Math.round(q.z * 100) / 100]));
  assert.equal(guest.goats[1].mode, 'windup');
  assert.ok(GOAT_MODES.includes(guest.goats[0].mode));
  assert.ok(guest.monster.danger > 0.5, "l'invité l'entend tout près");
  assert.equal(guest.monster.mode, 'chase', 'la musique de poursuite');
});

test("saut : un petit bond qui coûte du souffle, s'entend à la réception et ne franchit pas un trou", () => {
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 8, players: [{ id: 1, name: 'A' }], localId: 1 });
  const P = sim.player;
  const st = P.stamina;
  sim.step({ jump: true });
  assert.ok(P.jy > 0, 'en l\'air');
  assert.ok(P.stamina < st - 5, 'le saut coûte du souffle');
  let air = 0;
  let top = 0;
  let landNoise = 0;
  for (let i = 0; i < 120; i++) {
    sim.step({});
    if (P.jy > 0) air++;
    top = Math.max(top, P.jy);
    landNoise = Math.max(landNoise, P.noise);
    sim.monster.x = sim.monster.z = -999;
  }
  assert.equal(P.jy, 0, 'retombé');
  assert.ok(top > 0.25 && top < 0.5, `hauteur ${top.toFixed(2)} m`);
  assert.ok(landNoise >= NOISE.land, 'la réception fait du bruit');
  // au mieux, en courant : moins de 2 m parcourus en l'air (un trou en fait 2)
  assert.ok(((air + 1) / 60) * 4.4 < 2 * PIT_HALF, `${(((air + 1) / 60) * 4.4).toFixed(2)} m en l'air`);
  // accroupi au sol, on ne saute pas sur une arête
  P.onBeam = true;
  sim.step({ jump: true });
  assert.equal(P.jy, 0, 'pas de saut sur une arête');
});

test("réseau : le caméscope (V) tire sur la pile, et l'on voit qui filme et qui saute", () => {
  const players = [{ id: 1, name: 'Hôte' }, { id: 2, name: 'Invité' }];
  const host = new BackroomsSim({ difficulty: 'peaceful', seed: 8, players, localId: 1 });
  const guest = new BackroomsSim({ difficulty: 'peaceful', seed: 8, players, localId: 2 });
  const b0 = host.players[1].battery;
  for (let i = 0; i < 60; i++) host.step({ jump: i === 0 }, { 2: { remote: true, cam: true } });
  assert.ok(host.players[1].cam, "l'hôte sait que l'invité filme");
  assert.ok(host.players[1].battery < b0, 'le caméscope tire sur la pile');
  host.step({ jump: true }, { 2: { remote: true, cam: true } });
  host.step({}, { 2: { remote: true, cam: true } });
  guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
  assert.ok(guest.players[0].jy > 0, "l'invité voit l'hôte sauter");
  guest.player.cam = false;
  guest.predict({ cam: true });
  assert.ok(guest.player.cam, "l'invité sort son caméscope sans attendre l'hôte");
  guest.applySnapshot(JSON.parse(JSON.stringify({ ...host.snapshot() })));
  assert.ok(guest.player.cam, "l'instantané ne le lui range pas");
});


test("fin d'équipe : l'ascenseur attend les autres BOARD_T secondes, puis se ferme sur les retardataires", () => {
  const players = [{ id: 1, name: 'Hôte' }, { id: 2, name: 'Invité' }];
  const host = new BackroomsSim({ difficulty: 'peaceful', seed: 11, players, localId: 1 });
  const guest = new BackroomsSim({ difficulty: 'peaceful', seed: 11, players, localId: 2 });
  host.players[0].status = 'elevator';
  host.step({}, { 2: { remote: true } });
  assert.ok(host.boardT > BOARD_T - 0.1, 'le compte à rebours démarre');
  assert.ok(host.drainEvents().some((e) => e.type === 'boardCount' && e.start), 'il est annoncé');
  guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())));
  assert.ok(Math.abs(guest.boardT - host.boardT) < 0.05, "l'invité voit le même compte à rebours");
  // le retardataire arrive à temps : le compte à rebours s'arrête et l'ascenseur part
  const h2 = new BackroomsSim({ difficulty: 'peaceful', seed: 11, players, localId: 1 });
  h2.players[0].status = 'elevator';
  run(h2, 10, {}, { 2: { remote: true } });
  h2.players[1].status = 'elevator';
  h2.step({}, { 2: { remote: true } });
  assert.equal(h2.boardT, 0);
  assert.ok(h2.departT > 0, "tout le monde est dedans : l'ascenseur part");
  // personne ne vient : les portes se ferment, l'autre est perdu, l'ascenseur part quand même
  host.monster.x = host.monster.z = -999;
  for (let i = 0; i < Math.ceil((BOARD_T + 0.5) / DT) && host.departT <= 0; i++) host.step({}, { 2: { remote: true } });
  assert.equal(host.players[1].status, 'dead', 'le retardataire est resté dehors');
  const ev = host.drainEvents();
  assert.ok(ev.some((e) => e.type === 'leftBehind' && e.id === 2), 'on le sait');
  assert.ok(ev.some((e) => e.type === 'depart'), "l'ascenseur part avec ceux qui sont dedans");
});


test("poursuite : plus rapide qu'un joueur qui marche, droit sur lui, sans tourner sur place", () => {
  const map = createBackroomsMap(3);
  const sim = new BackroomsSim({ map, difficulty: 'normal' });
  const P = sim.player;
  const M = sim.monster;
  // un couloir droit et sombre de 12 cases
  const start = map.walkable.find((c) => {
    for (let i = 0; i < 12; i++) if (sim.blocked(c.x + i, c.z, 0) || sim.brightCell(map, (c.x + i + 0.5) * CELL_SIZE, (c.z + 0.5) * CELL_SIZE)) return false;
    return true;
  });
  assert.ok(start, 'un couloir droit');
  M.dormantT = 0;
  M.floor = 0;
  if (sim.director) sim.director.phase = 'build';
  M.x = (start.x + 0.5) * CELL_SIZE;
  M.z = (start.z + 0.5) * CELL_SIZE + 0.3; // pas pile au milieu de la case
  P.x = M.x + 7;
  P.z = (start.z + 0.5) * CELL_SIZE;
  P.yaw = -Math.PI / 2;
  P.flashlight = false;
  M.mode = 'chase';
  M.unseenT = 0;
  M.path = [];
  M.repathT = 0;
  M.yaw = Math.PI / 2;
  let reversals = 0;
  let last = 0;
  const d0 = Math.hypot(P.x - M.x, P.z - M.z);
  for (let i = 0; i < 60 * 5; i++) {
    const y0 = M.yaw;
    sim.step({ my: 1, yaw: P.yaw });
    const d = Math.atan2(Math.sin(M.yaw - y0), Math.cos(M.yaw - y0));
    if (Math.abs(d) > 0.01) {
      if (last && Math.sign(d) !== Math.sign(last)) reversals++;
      last = d;
    }
  }
  const d1 = Math.hypot(P.x - M.x, P.z - M.z);
  assert.equal(M.mode, 'chase');
  assert.ok(M.speed >= WALK_SPEED * CHASE_MIN - 1e-6, `vitesse ${M.speed.toFixed(2)} m/s`);
  assert.ok(d0 - d1 > 3.5, `elle gagne du terrain sur un joueur qui marche (${d0.toFixed(1)} → ${d1.toFixed(1)} m)`);
  assert.ok(reversals <= 1, `elle ne zigzague pas (${reversals} changements de sens)`);
});


test("cage d'escalier : on bute à DOOR_GAP de la porte cadenassée et de ses murs (plus de vue à travers)", () => {
  const sim = new BackroomsSim({ difficulty: 'peaceful', seed: 5 });
  const P = sim.player;
  assert.ok(sim.stairsLocked, 'la porte est cadenassée');
  const st = sim.stairs[0];
  const C = CELL_SIZE;
  const W = (u, v) => ({ x: st.ox + st.dx * u + st.px * v, z: st.oz + st.dz * u + st.pz * v });
  const p = W(-1.5, 1.5 * C);
  P.x = p.x;
  P.z = p.z;
  P.floor = 0;
  sim.drainEvents();
  const door = W(0, 1.5 * C);
  P.yaw = Math.atan2(-(door.x - P.x), -(door.z - P.z));
  run(sim, 2, { my: 1, yaw: P.yaw });
  const u = stairLocal(st, P.x, P.z).u;
  assert.ok(u <= -DOOR_GAP + 1e-6, `arrêté à ${(-u).toFixed(2)} m du battant`);
  assert.ok(sim.drainEvents().some((e) => e.type === 'locked'), 'la chaîne cogne');
  // pareil pour les autres murs de la cage, à chaque étage, en arrivant de biais : on glisse le long, sans s'y coller
  const box = (q) => Math.hypot(q.u - Math.max(0, Math.min(3 * C, q.u)), q.v - Math.max(0, Math.min(2 * C, q.v)));
  let tried = 0;
  for (const [fl, u0, v0, tu, tv] of [[0, 1.5 * C, -1.2, 2 * C, 0], [1, 1.5 * C, -1.2, 2 * C, 0], [0, 1.5 * C, 2 * C + 1.2, C, 2 * C], [1, 3 * C + 1.2, C, 3 * C, 0.5 * C]]) {
    const a = W(u0, v0);
    if (sim.isColliding(a.x, a.z, 0.3, fl)) continue;
    tried++;
    P.x = a.x;
    P.z = a.z;
    P.floor = fl;
    const t = W(tu, tv);
    let closest = Infinity;
    for (let i = 0; i < 120; i++) {
      P.yaw = Math.atan2(-(t.x - P.x), -(t.z - P.z));
      sim.step({ my: 1, yaw: P.yaw });
      if (!stairAt(sim.stairs, P.x, P.z)) closest = Math.min(closest, box(stairLocal(st, P.x, P.z)));
    }
    assert.equal(stairAt(sim.stairs, P.x, P.z), null, `étage ${fl} : on n'est pas entré par le mur`);
    assert.ok(closest >= DOOR_GAP - 1e-6, `étage ${fl} : au plus près ${closest.toFixed(2)} m du mur`);
  }
  assert.ok(tried > 0, 'au moins un mur de cage essayé');
});

test("réseau : chez l'invité, les autres et l'entité avancent à vitesse régulière malgré des paquets irréguliers ; un saut reste net", () => {
  const players = [{ id: 1, name: 'Hôte' }, { id: 2, name: 'Invité' }];
  const host = new BackroomsSim({ difficulty: 'normal', seed: 5, players, localId: 1 });
  const guest = new BackroomsSim({ difficulty: 'normal', seed: 5, players, localId: 2 });
  const H = host.player;
  const M = host.monster;
  M.away = false;
  let rnd = 12345;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  const x0 = H.x;
  const mx0 = M.x;
  const inbox = [];
  let tick = 0;
  let frames = [];
  const V = 4; // m/s
  for (let f = 0; f < 144 * 4; f++) {
    const now = f / 144;
    // l'hôte : 60 pas par seconde, un instantané tous les 3 pas, qui met de 40 à 90 ms à arriver
    while (tick * DT <= now) {
      host.time = tick * DT;
      H.x = x0 + V * tick * DT;
      H.yaw = 3 * tick * DT; // il tourne la tête de 3 radians par seconde
      M.x = mx0 + V * 1.5 * tick * DT;
      if (tick % 3 === 0) inbox.push({ at: tick * DT + 0.04 + rand() * 0.05, s: JSON.parse(JSON.stringify(host.snapshot())) });
      tick++;
    }
    inbox.sort((a, b) => a.at - b.at);
    while (inbox.length && inbox[0].at <= now) guest.applySnapshot(inbox.shift().s, now);
    guest.interpolate(now);
    const Q = guest.players.find((q) => q.id === 1);
    frames.push({ x: Q.x, yaw: Q.yaw, mx: guest.monster.x });
  }
  frames = frames.slice(144); // une seconde pour s'installer
  for (let i = 1; i < frames.length; i++) {
    const v = (frames[i].x - frames[i - 1].x) * 144;
    const mv = (frames[i].mx - frames[i - 1].mx) * 144;
    const w = (frames[i].yaw - frames[i - 1].yaw) * 144;
    assert.ok(Math.abs(v - V) < V * 0.15, `vitesse affichée régulière (${v.toFixed(2)} m/s au lieu de ${V})`);
    assert.ok(Math.abs(mv - V * 1.5) < V * 1.5 * 0.15, `l'entité aussi (${mv.toFixed(2)} m/s)`);
    assert.ok(Math.abs(w - 3) < 0.45, `le regard tourne sans à-coups (${w.toFixed(2)} rad/s)`);
  }
  // affiché un peu dans le passé, pas trop : moins de 0,2 s de retard sur la position réelle
  const lag = (x0 + V * (tick - 1) * DT - frames[frames.length - 1].x) / V;
  assert.ok(lag > 0 && lag < 0.2, `retard d'affichage ${lag.toFixed(3)} s`);
  // un saut (chute, téléportation) : affiché tel quel dès son instantané, sans glisser
  H.x += 20;
  host.time = tick * DT;
  guest.applySnapshot(JSON.parse(JSON.stringify(host.snapshot())), 4.1);
  guest.interpolate(4.1);
  assert.ok(Math.abs(guest.players.find((q) => q.id === 1).x - H.x) < 0.006, 'le saut est net');
});

console.log(`\n${count} tests réussis pour The Backrooms !`);
