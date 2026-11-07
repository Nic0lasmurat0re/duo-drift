// The Backrooms (Level 0) - Génération de la carte du dédale
// Grande grille de cases (64 × 64, soit 160 m de côté) : un quadrillage de cloisons percées de passages, des piliers,
// quelques grandes salles vides, des zones aux néons morts, 7 cassettes VHS, de l'eau d'amande et 1 ascenseur.
// Le Level 1 (entrepôt) est dans level1.js et partage les types de cases, l'ascenseur et le parcours en largeur.
// Pièges du Level 0, posés une fois le dédale construit :
//  - une cassette enfermée dans une petite pièce, qu'on n'atteint que par un couloir étroit au sol creusé de trous
//    carrés (on marche sur l'arête du milieu ; qui tombe attend qu'un collègue lui lance une corde) ;
//  - une cassette posée dans un renfoncement en hauteur, qu'on n'atteint qu'avec l'échelle cachée ailleurs.

export const PIT_HALF = 1.0; // un trou fait 2 m de côté dans une case de 2,5 m : il reste des arêtes de 50 cm
export const FLOOR_DY = 6.4; // l'étage du bas est 6,40 m plus bas (3 m sous plafond et 3,40 m de dalle : les trous sont des puits)
export const PIT_DEPTH = FLOOR_DY; // on tombe d'un étage, de très haut
export const CASSETTES = 7; // cassettes VHS à trouver au Level 0 (4 en haut, 3 en bas)
export const NICHE_Y = 2.25; // hauteur de la cassette dans son renfoncement

// tous les objets qu'on ramasse avec F : 'bottle', 'battery', 'ladder' (id unique, position, pris ou non)
// Les objectifs d'un niveau, le plus loin possible les uns des autres : à chaque tour, la case candidate dont le
// point déjà posé le plus proche (fixed, puis les choisis) est le plus loin ; on tire au hasard parmi celles qui
// font au moins 90 % du meilleur score. distFrom(p) renvoie la distance (de marche) de p à une case c : (c) => nombre.
export function spreadOut(cands, fixed, n, distFrom, rnd) {
  const pool = [...cands];
  const near = pool.map(() => Infinity);
  const add = (p) => {
    const d = distFrom(p);
    pool.forEach((c, i) => {
      const v = d(c);
      near[i] = Math.min(near[i], v < 0 ? Infinity : v);
    });
  };
  fixed.forEach(add);
  const out = [];
  for (let k = 0; k < n && pool.length; k++) {
    let best = -1;
    for (const v of near) if (v > best) best = v;
    const top = pool.map((c, i) => i).filter((i) => near[i] >= best * 0.9);
    const i = top[Math.floor(rnd() * top.length)];
    const c = pool[i];
    pool.splice(i, 1);
    near.splice(i, 1);
    out.push(c);
    add(c);
  }
  return out;
}
// distance de marche sur une grille (parcours en largeur depuis p)
export const gridDist = (grid, W, H) => (p) => {
  const d = bfs(grid, W, H, p.x, p.z);
  return (c) => d[c.z * W + c.x];
};

export function itemList(...lists) {
  const items = [];
  for (const [kind, list] of lists) for (const o of list) items.push(Object.assign(o, { kind, iid: items.length }));
  items.forEach((o, i) => {
    o.id = i;
  });
  return items;
}

export const CELL_SIZE = 2.5; // chaque case fait 2.5m x 2.5m
export const WALL_HEIGHT = 3.2; // hauteur sous plafond (3,20 m : un peu plus haut que l'ordinaire, on s'y sent petit)
export const MAP_SIZE = 64;

export const T = {
  EMPTY: 0,
  FLOOR: 1,
  WALL: 2,
  EXIT: 3, // cabine de l'ascenseur : un mur tant qu'il est fermé
  SHELF: 4, // étagère métallique (Level 1) : bloque le passage et la vue comme un mur
  PILLAR: 5, // pilier plus petit que la case (Level 0) : l'entité le contourne, les joueurs passent à côté
  GATE: 6, // grille à barreaux fermée (Level 2) : bloque le passage, pas la vue (voir seeThrough)
  MACHINE: 7, // chaudière (Level 2) : bloque le passage et la vue, mais ce n'est pas un mur
};

// cases qui bloquent le passage (et la vue) : murs, étagères, cabine d'ascenseur ; un pilier fin seulement pour les
// chemins de l'entité (les collisions et la vue suivent sa vraie forme, voir outsidePillar) ; une grille, le passage seul
export const blocks = (v) => v === T.WALL || v === T.SHELF || v === T.EXIT || v === T.PILLAR || v === T.GATE || v === T.MACHINE;

// le point (x, z) est-il hors du pilier ? (p : { x, z, h, round }, h : demi-côté ou rayon)
export function outsidePillar(p, x, z, margin = 0) {
  if (p.round) return Math.hypot(x - p.x, z - p.z) > p.h + margin;
  return Math.abs(x - p.x) > p.h + margin || Math.abs(z - p.z) > p.h + margin;
}

// Creuse la cabine de l'ascenseur dans un mur voisin de la case d'entrée : la cabine est fermée sur trois côtés,
// on y entre par l'entrée. Renvoie { gx, gz, x, z, dx, dz } (dx, dz : de l'entrée vers la cabine) ou null.
export function carveElevator(grid, W, H, entrance, spawn, rnd, avoid = null) {
  const at = (x, z) => (x < 0 || x >= W || z < 0 || z >= H ? T.WALL : grid[z * W + x]);
  let lastD = null;
  const reach = () => {
    const d = bfs(grid, W, H, spawn.x, spawn.z);
    lastD = d;
    let n = 0;
    for (let i = 0; i < W * H; i++) if (d[i] >= 0) n++;
    return n;
  };
  const before = reach();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => rnd() - 0.5);
  for (const [dx, dz] of dirs) {
    const cx = entrance.x + dx;
    const cz = entrance.z + dz;
    if (cx < 1 || cx > W - 2 || cz < 1 || cz > H - 2) continue;
    if (at(cx, cz) === T.FLOOR || at(cx, cz) === T.PILLAR) continue; // la cabine se creuse dans un mur (pas dans un pilier fin)
    const around = [[cx + dx, cz + dz], [cx + dz, cz + dx], [cx - dz, cz - dx]];
    if (avoid && [[cx, cz], ...around].some(([x, z]) => avoid.has(z * W + x))) continue;
    const saved = around.map(([x, z]) => at(x, z));
    const orig = at(cx, cz);
    around.forEach(([x, z]) => {
      if (x > 0 && x < W - 1 && z > 0 && z < H - 1) grid[z * W + x] = T.WALL;
    });
    grid[cz * W + cx] = T.EXIT;
    // fermer la cabine ne doit couper aucun passage, ni isoler sa propre entrée
    if (reach() >= before - 3 && lastD[entrance.z * W + entrance.x] >= 0) {
      return { gx: cx, gz: cz, x: (cx + 0.5) * CELL_SIZE, z: (cz + 0.5) * CELL_SIZE, dx, dz };
    }
    grid[cz * W + cx] = orig;
    around.forEach(([x, z], i) => {
      if (x > 0 && x < W - 1 && z > 0 && z < H - 1) grid[z * W + x] = saved[i];
    });
  }
  return null;
}

// meubles abandonnés (modèles Kenney du manoir) : nom, hauteur en m, rayon de collision
// Objets abandonnés du Level 0 (modèles Poly Haven, CC0, dans backrooms/models/) ; chair : posée de travers, parfois renversée
export const PROP_KINDS = [
  { m: 'cardboard_box_01', h: 0.42, r: 0.32 },
  { m: 'SchoolChair_01', h: 0.86, r: 0.3, chair: true },
  { m: 'plastic_monobloc_chair_01', h: 0.8, r: 0.3, chair: true },
  { m: 'metal_office_desk', h: 0.76, r: 0.6 },
  { m: 'Television_01', h: 0.45, r: 0.3 },
  { m: 'trashbag', h: 0.5, r: 0.3 },
  { m: 'WetFloorSign_01', h: 0.62, r: 0.22 },
  { m: 'Sofa_01', h: 0.9, r: 0.62 },
  { m: 'modern_arm_chair_01', h: 0.86, r: 0.38, turn: true },
  { m: 'SchoolDesk_01', h: 0.75, r: 0.4, turn: true },
  { m: 'standing_chalkboard_01', h: 1.2, r: 0.32 },
  { m: 'worn_metal_rack', h: 1.6, r: 0.45 },
  { m: 'tool_cart', h: 0.9, r: 0.45, turn: true },
  { m: 'projector_screen', h: 1.8, r: 0.35 },
  { m: 'wooden_ladder', h: 1.5, r: 0.35 },
];
// Le matériel des chantiers abandonnés (dessiné dans le code) : projecteurs éteints sur trépied et cônes
export const WORKLIGHT = { m: 'worklight', h: 1.75, r: 0.32, proc: true };
export const CONE = { m: 'cone', h: 0.5, r: 0.18, proc: true };

// opts.lower : étage du bas (pas de couloir piégé, de renfoncement ni d'échelle) ; opts.forced : cases qui doivent
// rester du sol accessible (sous les trous de l'étage du dessus)
export function createBackroomsMap(seed = 42, opts = {}) {
  const lower = !!opts.lower;
  const W = MAP_SIZE;
  const H = MAP_SIZE;
  const grid = new Uint8Array(W * H);

  // Générateur pseudo-aléatoire (mulberry32) pour une carte reproductible à partir de la graine
  let s = (seed >>> 0) || 1;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const inside = (x, z) => x > 0 && x < W - 1 && z > 0 && z < H - 1;
  const get = (x, z) => (x < 0 || x >= W || z < 0 || z >= H ? T.WALL : grid[z * W + x]);
  const set = (x, z, val) => {
    if (inside(x, z)) grid[z * W + x] = val;
  };

  // 1. Tout est sol, entouré d'un mur d'enceinte
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      grid[z * W + x] = inside(x, z) ? T.FLOOR : T.WALL;
    }
  }

  // 2. Grandes salles vides : on n'y pose aucune cloison (les « halls » du Level 0)
  const halls = [];
  for (let i = 0; i < 4; i++) {
    const w = 6 + Math.floor(rnd() * 7);
    const h = 6 + Math.floor(rnd() * 7);
    halls.push({ x: 2 + Math.floor(rnd() * (W - w - 4)), z: 2 + Math.floor(rnd() * (H - h - 4)), w, h });
  }
  const inHall = (x, z) => halls.some((r) => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.h);

  // 3. Quadrillage irrégulier de cloisons : les lignes tombent tous les 3 à 6 cases, à des places tirées au hasard,
  // et chaque pan de mur existe ou non, avec souvent une ouverture. D'une partie à l'autre, rien n'est au même endroit.
  const lines = (n) => {
    const out = [];
    for (let v = Math.floor(rnd() * 3); v < n; v += 3 + Math.floor(rnd() * 4)) out.push(v);
    if (out[out.length - 1] !== n - 1) out.push(n - 1);
    return out;
  };
  const xs = lines(W);
  const zs = lines(H);
  const density = 0.62 + rnd() * 0.16; // certaines parties plus ouvertes, d'autres plus labyrinthiques
  for (let j = 0; j < zs.length; j++) {
    for (let i = 0; i < xs.length; i++) {
      const gx = xs[i];
      const gz = zs[j];
      // pilier au croisement
      if (rnd() < 0.55 && !inHall(gx, gz)) set(gx, gz, T.WALL);
      // pan vers l'est (jusqu'à la ligne suivante), puis pan vers le sud
      for (const [dx, dz, len] of [[1, 0, (xs[i + 1] ?? W) - gx], [0, 1, (zs[j + 1] ?? H) - gz]]) {
        if (rnd() > density) continue;
        const gaps = new Set();
        if (rnd() < 0.65) gaps.add(1 + Math.floor(rnd() * Math.max(1, len - 1))); // case laissée ouverte
        if (len > 4 && rnd() < 0.4) gaps.add(1 + Math.floor(rnd() * (len - 1)));
        for (let k = 0; k <= len; k++) {
          const x = gx + dx * k;
          const z = gz + dz * k;
          if (gaps.has(k) || inHall(x, z)) continue;
          set(x, z, T.WALL);
        }
      }
    }
  }
  const onLine = (x, z) => xs.includes(x) || zs.includes(z);

  // 4. Cloisons libres en L, hors du quadrillage, et piliers isolés pour casser les lignes de vue
  for (let i = 0; i < 26; i++) {
    let x = 2 + Math.floor(rnd() * (W - 4));
    let z = 2 + Math.floor(rnd() * (H - 4));
    let [dx, dz] = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    const len = 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < len * 2; k++) {
      if (k === len) {
        if (rnd() < 0.5) break;
        [dx, dz] = [dz, -dx]; // le pan tourne d'un quart
      }
      if (!inside(x, z) || inHall(x, z) || onLine(x, z)) break;
      set(x, z, T.WALL);
      x += dx;
      z += dz;
    }
  }
  for (let i = 0; i < 90; i++) {
    const x = 2 + Math.floor(rnd() * (W - 4));
    const z = 2 + Math.floor(rnd() * (H - 4));
    if (!onLine(x, z) && !inHall(x, z)) set(x, z, T.WALL);
  }

  // 4b. Dans les grandes salles, de gros piliers carrés (2 × 2 cases) çà et là
  for (const r of halls) {
    for (let z = r.z + 2; z + 1 < r.z + r.h - 2; z += 4 + Math.floor(rnd() * 2)) {
      for (let x = r.x + 2; x + 1 < r.x + r.w - 2; x += 4 + Math.floor(rnd() * 2)) {
        if (rnd() < 0.45) continue;
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) set(x + dx, z + dz, T.WALL);
      }
    }
  }

  // 4c. Moins de culs-de-sac : au fond d'une impasse, on perce le mur s'il y a du sol derrière (on en garde environ un sur trois)
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const isF = (x, z) => get(x, z) === T.FLOOR;
  for (let pass = 0; pass < 2; pass++) {
    for (let z = 1; z < H - 1; z++) {
      for (let x = 1; x < W - 1; x++) {
        if (!isF(x, z)) continue;
        const open = DIRS.filter(([dx, dz]) => isF(x + dx, z + dz));
        if (open.length !== 1 || rnd() < 0.35) continue;
        const [ox, oz] = open[0];
        // en face d'abord, sinon sur les côtés ; un mur d'une case, ou de deux
        for (const [dx, dz] of [[-ox, -oz], ...(rnd() < 0.5 ? [[oz, ox], [-oz, -ox]] : [[-oz, -ox], [oz, ox]])]) {
          if (!inside(x + dx, z + dz) || get(x + dx, z + dz) !== T.WALL) continue;
          if (isF(x + 2 * dx, z + 2 * dz)) {
            set(x + dx, z + dz, T.FLOOR);
            break;
          }
          if (inside(x + 2 * dx, z + 2 * dz) && isF(x + 3 * dx, z + 3 * dz)) {
            set(x + dx, z + dz, T.FLOOR);
            set(x + 2 * dx, z + 2 * dz, T.FLOOR);
            break;
          }
        }
      }
    }
  }

  // 5. Point de départ près du centre, sur une case libre reliée à la plus grande partie du dédale
  let floorCount = 0;
  for (let i = 0; i < W * H; i++) if (grid[i] === T.FLOOR) floorCount++;
  let sx = W >> 1;
  let sz = H >> 1;
  let dist = null;
  for (let r = 0; r < 400; r++) {
    if (get(sx, sz) === T.FLOOR) {
      dist = bfs(grid, W, H, sx, sz);
      let reach = 0;
      for (let i = 0; i < W * H; i++) if (dist[i] >= 0) reach++;
      if (reach > floorCount * 0.5) break;
    }
    const spread = 4 + (r >> 4);
    sx = Math.min(W - 2, Math.max(1, (W >> 1) + Math.floor(rnd() * (spread * 2 + 1)) - spread));
    sz = Math.min(H - 2, Math.max(1, (H >> 1) + Math.floor(rnd() * (spread * 2 + 1)) - spread));
  }

  // 5b. Cases imposées (sous les trous du dessus) : du sol, relié au reste par un passage creusé s'il le faut
  if (opts.forced && opts.forced.length) {
    for (const [x, z] of opts.forced) set(x, z, T.FLOOR);
    dist = bfs(grid, W, H, sx, sz);
    for (const [fx, fz] of opts.forced) {
      if (dist[fz * W + fx] >= 0) continue;
      // parcours en largeur à travers les murs jusqu'à une case accessible, puis on creuse le chemin
      const prev = new Int32Array(W * H).fill(-1);
      const q = [fz * W + fx];
      prev[q[0]] = q[0];
      let hit = -1;
      for (let h = 0; h < q.length && hit < 0; h++) {
        const k = q[h];
        const x = k % W;
        const z = (k - x) / W;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const nz = z + dz;
          if (!inside(nx, nz)) continue;
          const nk = nz * W + nx;
          if (prev[nk] >= 0) continue;
          prev[nk] = k;
          if (dist[nk] >= 0) {
            hit = nk;
            break;
          }
          q.push(nk);
        }
      }
      for (let k = hit; k >= 0 && k !== prev[k]; k = prev[k]) grid[k] = grid[k] === T.EXIT ? T.EXIT : T.FLOOR;
      grid[fz * W + fx] = T.FLOOR;
      dist = bfs(grid, W, H, sx, sz);
    }
  }

  // 6. Parcours en largeur depuis le départ : les poches inaccessibles deviennent des murs, on garde les distances
  for (let i = 0; i < W * H; i++) {
    if (grid[i] === T.FLOOR && dist[i] < 0) grid[i] = T.WALL;
  }

  const walkable = [];
  for (let z = 1; z < H - 1; z++) {
    for (let x = 1; x < W - 1; x++) {
      if (grid[z * W + x] === T.FLOOR) walkable.push({ x, z });
    }
  }
  const D = (c) => dist[c.z * W + c.x];
  const cellPos = (c) => ({ x: (c.x + 0.5) * CELL_SIZE, z: (c.z + 0.5) * CELL_SIZE, gx: c.x, gz: c.z });

  // 6b. Piliers de toutes les tailles : un mur isolé (du sol tout autour) devient souvent un pilier plus petit que la
  // case, carré (60 cm à 1,5 m) ou rond (colonne de 60 cm à 1,1 m), un peu décentré ; les autres restent pleins
  const pillars = {};
  for (let z = 2; z < H - 2; z++) {
    for (let x = 2; x < W - 2; x++) {
      const k = z * W + x;
      if (grid[k] !== T.WALL || DIRS.some(([dx, dz]) => get(x + dx, z + dz) !== T.FLOOR)) continue;
      if (rnd() < 0.3) continue;
      const round = rnd() < 0.4;
      const h = round ? [0.3, 0.42, 0.55][Math.floor(rnd() * 3)] : [0.3, 0.48, 0.75][Math.floor(rnd() * 3)];
      const slack = CELL_SIZE / 2 - h - 0.05;
      grid[k] = T.PILLAR;
      pillars[k] = {
        x: (x + 0.5) * CELL_SIZE + (rnd() - 0.5) * slack * 0.6,
        z: (z + 0.5) * CELL_SIZE + (rnd() - 0.5) * slack * 0.6,
        h,
        round,
      };
    }
  }

  const spawn = cellPos({ x: sx, z: sz });

  // 7. La sortie : un ascenseur creusé dans un mur, devant l'une des cases les plus éloignées (en marche) du départ
  const far = walkable.filter((c) => D(c) > 0).sort((a, b) => D(b) - D(a));
  let exitCell = null;
  let elevator = null;
  for (let i = 0; i < 60 && !elevator; i++) {
    exitCell = far[Math.floor(rnd() * Math.min(20 + i * 4, far.length))];
    elevator = carveElevator(grid, W, H, exitCell, { x: sx, z: sz }, rnd, opts.forced ? new Set(opts.forced.map(([x, z]) => z * W + x)) : null);
  }
  const exit = cellPos(exitCell);
  // la cabine et les murs qui la ferment ont pu retirer des cases du sol
  for (let i = walkable.length - 1; i >= 0; i--) if (grid[walkable[i].z * W + walkable[i].x] !== T.FLOOR) walkable.splice(i, 1);

  // 7b. Les trous : posés plus bas, une fois les cassettes en place (le couloir piégé qui garde l'une d'elles)
  const pitGrid = new Int16Array(W * H).fill(-1);
  const pits = [];
  let trap = null;

  const maxD = D(far[0]) || 1;
  // 8. Les cassettes : le plus loin possible (en marche) du départ, de la sortie et les unes des autres
  const reach = bfs(grid, W, H, sx, sz); // la cabine a pu couper un recoin ; pas collée au bord (place pour le couloir piégé)
  const cassettes = spreadOut(walkable.filter((c) => D(c) > 6 && reach[c.z * W + c.x] >= 0 && c.x > 3 && c.z > 3 && c.x < W - 4 && c.z < H - 4), [{ x: sx, z: sz }, exitCell], CASSETTES, gridDist(grid, W, H), rnd).map((c, i) => ({
    id: i,
    ...cellPos(c),
    name: `Cassette VHS #${i + 1}`,
    collected: false,
  }));

  // 8a. Le couloir piégé : autour d'une cassette, une pièce de 3 × 3 cases fermée de murs, et un seul accès, un
  // couloir de trous qui tourne. Il avance par blocs de 2 × 2 trous : on le traverse sur les arêtes (entre deux
  // trous), qui suivent ses virages. On vérifie qu'on ne peut pas le contourner et que tout le reste du dédale reste
  // accessible ; sinon on essaie un autre tracé, un autre côté ou une autre cassette.
  const reachAll = (blockPits) => {
    const g = blockPits ? grid.map((v, i) => (pitGrid[i] >= 0 ? T.WALL : v)) : grid;
    return bfs(g, W, H, sx, sz);
  };
  // tracés possibles (en blocs de 2 cases) : d = tout droit depuis la pièce, t = de côté ; toujours au moins un virage
  const SHAPES = [['d', 't', 't', 'd'], ['d', 't', 't', 'd', 'd'], ['d', 'd', 't', 't', 'd'], ['d', 't', 'd', 't'], ['d', 't', 't', 't', 'd'], ['d', 't', 'd', 'd', 't']];
  const vaultTry = (cas, [dx, dz], shape, side) => {
    const cx = cas.gx;
    const cz = cas.gz;
    const tx = -dz * side;
    const tz = dx * side; // de côté
    const writes = new Map(); // case -> nouvelle valeur
    const put = (x, z, v) => writes.set(z * W + x, v);
    const room = new Set();
    for (let a = -2; a <= 2; a++) {
      for (let b = -2; b <= 2; b++) {
        const ring = Math.max(Math.abs(a), Math.abs(b)) === 2;
        put(cx + a, cz + b, ring ? T.WALL : T.FLOOR);
        room.add((cz + b) * W + cx + a);
      }
    }
    // premier bloc : collé à la pièce, il remplace deux cases de son mur
    let bx = dx > 0 ? cx + 2 : dx < 0 ? cx - 3 : cx;
    let bz = dz > 0 ? cz + 2 : dz < 0 ? cz - 3 : cz;
    const corridor = new Set();
    let last = [dx, dz];
    shape.forEach((step, i) => {
      const [sx2, sz2] = step === 'd' ? [dx, dz] : [tx, tz];
      if (i > 0) {
        bx += sx2 * 2;
        bz += sz2 * 2;
      }
      last = [sx2, sz2];
      for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) corridor.add((bz + oz) * W + bx + ox);
    });
    // la sortie : les deux cases au-delà du dernier bloc
    const [lx, lz] = last;
    const exits = lx > 0 ? [[bx + 2, bz], [bx + 2, bz + 1]] : lx < 0 ? [[bx - 1, bz], [bx - 1, bz + 1]] : lz > 0 ? [[bx, bz + 2], [bx + 1, bz + 2]] : [[bx, bz - 1], [bx + 1, bz - 1]];
    const exitSet = new Set(exits.map(([x, z]) => z * W + x));
    // le couloir ne passe pas dans la pièce (sauf par son mur d'entrée)
    for (const k of corridor) {
      const x = k % W;
      const z = (k - x) / W;
      if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) < 2) return false;
    }
    for (const k of corridor) writes.set(k, T.FLOOR);
    for (const k of exitSet) writes.set(k, T.FLOOR);
    // des murs tout autour du couloir : on n'y entre que par ses deux bouts
    for (const k of corridor) {
      const x = k % W;
      const z = (k - x) / W;
      for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          const n = (z + oz) * W + x + ox;
          if (!corridor.has(n) && !exitSet.has(n) && !(room.has(n) && writes.get(n) === T.FLOOR)) writes.set(n, T.WALL);
        }
      }
    }
    // rien d'important ne doit être écrasé
    const keep = new Set([sz * W + sx, exitCell.z * W + exitCell.x, ...cassettes.filter((c) => c !== cas).map((c) => c.gz * W + c.gx)]);
    if (elevator) keep.add(elevator.gz * W + elevator.gx);
    for (const [k] of writes) {
      const x = k % W;
      const z = (k - x) / W;
      if (x < 1 || x > W - 2 || z < 1 || z > H - 2) return false;
      if (keep.has(k) || grid[k] === T.EXIT) return false;
      if (Math.hypot(x - sx, z - sz) < 4) return false;
    }
    const saved = new Map([...writes.keys()].map((k) => [k, grid[k]]));
    for (const [k, v] of writes) grid[k] = v;
    for (const k of corridor) pitGrid[k] = 0;
    const open = reachAll(false);
    const shut = reachAll(true);
    const others = [exitCell, ...cassettes.filter((c) => c !== cas).map((c) => ({ x: c.gx, z: c.gz }))];
    const ok = open[cas.gz * W + cas.gx] >= 0 && shut[cas.gz * W + cas.gx] < 0 && others.every((c) => shut[c.z * W + c.x] >= 0);
    for (const k of corridor) pitGrid[k] = -1;
    if (!ok) {
      for (const [k, v] of saved) grid[k] = v;
      return false;
    }
    for (const k of corridor) {
      const x = k % W;
      const z = (k - x) / W;
      pitGrid[k] = pits.length;
      pits.push({ id: pits.length, gx: x, gz: z, x: (x + 0.5) * CELL_SIZE, z: (z + 0.5) * CELL_SIZE });
    }
    cas.vault = true;
    // devant l'entrée du couloir piégé, tourné vers les trous (pour ?parkour)
    trap = { x: ((exits[0][0] + exits[1][0]) / 2 + 0.5 + lx * 0.2) * CELL_SIZE, z: ((exits[0][1] + exits[1][1]) / 2 + 0.5 + lz * 0.2) * CELL_SIZE, yaw: Math.atan2(lx, lz) };
    return true;
  };
  const byFar = lower ? [] : [...cassettes].sort((a, b) => D({ x: b.gx, z: b.gz }) - D({ x: a.gx, z: a.gz }));
  vaultLoop: for (const cas of byFar) {
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => rnd() - 0.5)) {
      for (const shape of [...SHAPES].sort(() => rnd() - 0.5)) {
        for (const side of rnd() < 0.5 ? [1, -1] : [-1, 1]) if (vaultTry(cas, d, shape, side)) break vaultLoop;
      }
    }
  }
  // le dédale a changé : distances, cases libres (sans les trous) et cassette au centre de sa pièce
  dist = bfs(grid, W, H, sx, sz);
  for (let i = 0; i < W * H; i++) if (grid[i] === T.FLOOR && dist[i] < 0) grid[i] = T.WALL;
  walkable.length = 0;
  for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) if (grid[z * W + x] === T.FLOOR && pitGrid[z * W + x] < 0) walkable.push({ x, z });

  // 8b. Une cassette dans un renfoncement en hauteur, au-dessus d'une case contre un mur
  const wallSide = (c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => get(c.x + dx, c.z + dz) === T.WALL);
  let niche = null;
  for (const cas of lower ? [] : [...cassettes].filter((c) => !c.vault).sort(() => rnd() - 0.5)) {
    const c = { x: cas.gx, z: cas.gz };
    let sides = wallSide(c);
    let cell = c;
    if (!sides.length) {
      // pas de mur ici : on la déplace dans une case voisine adossée à un mur
      cell = walkable.filter((w) => Math.abs(w.x - c.x) + Math.abs(w.z - c.z) <= 4 && wallSide(w).length).sort((a, b) => Math.abs(a.x - c.x) + Math.abs(a.z - c.z) - (Math.abs(b.x - c.x) + Math.abs(b.z - c.z)))[0];
      if (!cell) continue;
      sides = wallSide(cell);
    }
    const [dx, dz] = pick(sides);
    const off = CELL_SIZE / 2 - 0.2; // la cassette dépasse un peu du mur
    Object.assign(cas, cellPos(cell), { high: true });
    cas.x = (cell.x + 0.5) * CELL_SIZE + dx * off;
    cas.z = (cell.z + 0.5) * CELL_SIZE + dz * off;
    niche = { cas: cas.id, gx: cell.x, gz: cell.z, dx, dz, x: cas.x, z: cas.z, baseX: (cell.x + 0.5) * CELL_SIZE + dx * 0.55, baseZ: (cell.z + 0.5) * CELL_SIZE + dz * 0.55, ladder: false };
    break;
  }

  // 9. Éclairage : un néon par case paire. Un bruit à basse fréquence découpe des zones où les néons sont morts
  // ou grésillent. Le départ et ses alentours restent éclairés.
  const ZONE = 8;
  const zw = Math.ceil(W / ZONE) + 1;
  const zoneVal = Array.from({ length: zw * zw }, () => rnd());
  const zone = (x, z) => {
    // interpolation bilinéaire du bruit de zone
    const fx = x / ZONE;
    const fz = z / ZONE;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const v = (a, b) => zoneVal[Math.min(zw - 1, b) * zw + Math.min(zw - 1, a)];
    return (v(ix, iz) * (1 - tx) + v(ix + 1, iz) * tx) * (1 - tz) + (v(ix, iz + 1) * (1 - tx) + v(ix + 1, iz + 1) * tx) * tz;
  };
  const lights = [];
  for (let z = 1; z < H - 1; z += 2) {
    for (let x = 1; x < W - 1; x += 2) {
      if (grid[z * W + x] !== T.FLOOR) continue;
      const nearSpawn = Math.hypot(x - sx, z - sz) < 7;
      const v = zone(x, z);
      let state = 'on';
      // des zones claires (tous les néons marchent, ils éclairent plus fort et plus loin), des zones mortes, et entre
      // les deux des néons grillés çà et là : des îlots de lumière séparés par le noir
      const bright = nearSpawn || v > 0.66;
      if (!bright && (v < 0.46 || rnd() < 0.15)) state = 'off';
      else if (!bright && (v < 0.56 || rnd() < 0.1)) state = 'flicker';
      lights.push({
        x: (x + 0.5) * CELL_SIZE,
        y: WALL_HEIGHT - 0.02,
        z: (z + 0.5) * CELL_SIZE,
        gx: x,
        gz: z,
        state,
        flicker: state === 'flicker',
        bright,
      });
    }
  }

  // 10. Meubles abandonnés le long des murs et bouteilles d'eau d'amande (elles rendent l'endurance)
  const props = [];
  const nearWall = (c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => get(c.x + dx, c.z + dz) === T.WALL);
  const busy = new Set([sz * W + sx, exitCell.z * W + exitCell.x, ...cassettes.map((c) => c.gz * W + c.gx)]);
  for (let i = 0; i < 160; i++) {
    const c = pick(walkable);
    const k = c.z * W + c.x;
    const wall = nearWall(c);
    if (busy.has(k) || !wall || Math.hypot(c.x - sx, c.z - sz) < 3) continue;
    busy.add(k);
    const kind = pick(PROP_KINDS);
    // collé au mur, dos au mur (les modèles ont le dos vers -z)
    const off = CELL_SIZE / 2 - kind.r - 0.12;
    const rot = Math.atan2(-wall[0], -wall[1]);
    props.push({
      m: kind.m,
      h: kind.h,
      r: kind.r,
      x: (c.x + 0.5) * CELL_SIZE + wall[0] * off + (rnd() - 0.5) * 0.3,
      z: (c.z + 0.5) * CELL_SIZE + wall[1] * off + (rnd() - 0.5) * 0.3,
      rot: rot + (kind.chair ? (rnd() - 0.5) * 2 : kind.turn ? (rnd() - 0.5) * 1.2 : (rnd() - 0.5) * 0.25),
      tipped: !!kind.chair && rnd() < 0.3,
    });
  }
  // 10a. Chantiers abandonnés : de la rubalise jaune et noire arrachée qui traîne par terre en travers du couloir
  // (elle ne bloque rien), des cônes au pied des murs et un projecteur éteint sur son trépied juste avant
  const tapes = [];
  const prop = (kind, x, z, rot) => props.push({ m: kind.m, h: kind.h, r: kind.r, proc: true, x, z, rot, tipped: false });
  const nearPit = (c) => pits.some((p) => Math.abs(p.gx - c.x) <= 1 && Math.abs(p.gz - c.z) <= 1);
  for (let i = 0; i < 400 && tapes.length < 14; i++) {
    const c = pick(walkable);
    if (busy.has(c.z * W + c.x) || nearPit(c) || Math.hypot(c.x - sx, c.z - sz) < 4) continue;
    // couloir : des murs des deux côtés sur un axe, du sol des deux côtés sur l'autre
    const alongZ = get(c.x - 1, c.z) === T.WALL && get(c.x + 1, c.z) === T.WALL && get(c.x, c.z - 1) !== T.WALL && get(c.x, c.z + 1) !== T.WALL;
    const alongX = get(c.x, c.z - 1) === T.WALL && get(c.x, c.z + 1) === T.WALL && get(c.x - 1, c.z) !== T.WALL && get(c.x + 1, c.z) !== T.WALL;
    if (!alongZ && !alongX) continue;
    busy.add(c.z * W + c.x);
    const cx = (c.x + 0.5) * CELL_SIZE;
    const cz = (c.z + 0.5) * CELL_SIZE;
    const h = CELL_SIZE / 2;
    // un ou deux morceaux couchés au sol, d'un pied de mur vers l'autre, en biais ; wave : ses ondulations
    for (let k = rnd() < 0.4 ? 2 : 1; k > 0; k--) {
      const a = (rnd() - 0.5) * 1.6;
      const b = (rnd() - 0.5) * 1.6;
      const s1 = h - 0.15 - rnd() * 0.5;
      const s2 = h - 0.15 - rnd() * 0.9;
      const wave = { amp: 0.12 + rnd() * 0.25, freq: 1.5 + rnd() * 2.5, ph: rnd() * 6.28 };
      if (alongZ) tapes.push({ x1: cx - s1, z1: cz + a, x2: cx + s2, z2: cz + b, wave });
      else tapes.push({ x1: cx + a, z1: cz - s1, x2: cx + b, z2: cz + s2, wave });
    }
    // cônes au pied des murs (1 ou 2), dont un parfois renversé
    const side = alongZ ? [1, 0] : [0, 1];
    for (const s of rnd() < 0.5 ? [-1, 1] : [rnd() < 0.5 ? -1 : 1]) {
      const px = cx + side[0] * s * (h - 0.35);
      const pz = cz + side[1] * s * (h - 0.35);
      props.push({ m: CONE.m, h: CONE.h, r: CONE.r, proc: true, x: px, z: pz, rot: rnd() * 6.28, tipped: rnd() < 0.25 });
    }
    // le projecteur, dans la case d'avant ou d'après, tourné vers la rubalise
    const dir = rnd() < 0.5 ? -1 : 1;
    const nx = c.x + (alongZ ? 0 : dir);
    const nz = c.z + (alongZ ? dir : 0);
    if (rnd() < 0.8 && !busy.has(nz * W + nx) && get(nx, nz) !== T.WALL) {
      busy.add(nz * W + nx);
      const s = rnd() < 0.5 ? -1 : 1;
      const px = (nx + 0.5) * CELL_SIZE + side[0] * s * (h - 0.45);
      const pz = (nz + 0.5) * CELL_SIZE + side[1] * s * (h - 0.45);
      prop(WORKLIGHT, px, pz, Math.atan2(cx - px, cz - pz));
    }
  }
  // et quelques projecteurs oubliés ailleurs, contre un mur
  for (let i = 0; i < 200 && props.filter((p) => p.m === WORKLIGHT.m).length < 18; i++) {
    const c = pick(walkable);
    const wall = nearWall(c);
    if (busy.has(c.z * W + c.x) || !wall || nearPit(c) || Math.hypot(c.x - sx, c.z - sz) < 3) continue;
    busy.add(c.z * W + c.x);
    const off = CELL_SIZE / 2 - 0.5;
    prop(WORKLIGHT, (c.x + 0.5) * CELL_SIZE + wall[0] * off, (c.z + 0.5) * CELL_SIZE + wall[1] * off, Math.atan2(-wall[0], -wall[1]) + (rnd() - 0.5) * 1.5);
  }
  const bottles = [];
  for (let i = 0; i < 40 && bottles.length < 9; i++) {
    const c = pick(walkable);
    const k = c.z * W + c.x;
    if (busy.has(k) || D(c) < 8) continue;
    busy.add(k);
    bottles.push({ id: bottles.length, ...cellPos(c), taken: false });
  }
  // piles pour la lampe torche, de préférence dans les zones sombres
  const batteries = [];
  const darkCell = (c) => !lights.some((l) => l.state === 'on' && Math.abs(l.gx - c.x) <= 2 && Math.abs(l.gz - c.z) <= 2);
  for (let i = 0; i < 400 && batteries.length < 8; i++) {
    const c = pick(walkable);
    const k = c.z * W + c.x;
    if (busy.has(k) || D(c) < 10 || (i < 300 && !darkCell(c))) continue;
    busy.add(k);
    batteries.push({ id: batteries.length, ...cellPos(c), taken: false });
  }

  // 10b. L'échelle : loin du renfoncement, mais pas trop (25 à 45 cases de marche)
  const ladders = [];
  if (niche) {
    const dn = bfs(grid, W, H, niche.gx, niche.gz);
    const ok = (lo, hi) => walkable.filter((c) => !busy.has(c.z * W + c.x) && dn[c.z * W + c.x] >= lo && dn[c.z * W + c.x] <= hi);
    const cand = ok(25, 45).length ? ok(25, 45) : ok(12, 70);
    const c = cand.length ? pick(cand) : null;
    if (c) {
      busy.add(c.z * W + c.x);
      ladders.push({ id: 0, ...cellPos(c), taken: false });
    }
  }
  const items = itemList(['bottle', bottles], ['battery', batteries], ['ladder', ladders]);

  // 11. Point de départ de l'entité : loin du joueur, mais pas forcément au bout de la carte
  const monsterCell = pick(walkable.filter((c) => D(c) > maxD * 0.55)) || far[0];

  return {
    level: 0,
    floor: lower ? 1 : 0,
    ceil: WALL_HEIGHT,
    stairs: [],
    W,
    H,
    grid,
    walkable,
    spawn,
    exit,
    elevator,
    cassettes,
    lights,
    props,
    tapes,
    bottles,
    batteries,
    items,
    pits,
    trap,
    niche,
    dist,
    // numéro du trou sous une case (-1 : pas de trou)
    pitAt(gx, gz) {
      if (gx < 0 || gx >= W || gz < 0 || gz >= H) return -1;
      return pitGrid[gz * W + gx];
    },
    monsterSpawn: cellPos(monsterCell),
    pillars,
    isWall(gx, gz) {
      if (gx < 0 || gx >= W || gz < 0 || gz >= H) return true;
      return blocks(grid[gz * W + gx]);
    },
    // le pilier de la case (gx, gz), s'il y en a un (et que la case n'a pas été reprise depuis)
    pillarAt(gx, gz) {
      if (gx < 0 || gx >= W || gz < 0 || gz >= H) return null;
      const k = gz * W + gx;
      return grid[k] === T.PILLAR ? pillars[k] || null : null;
    },
    isWalkableWorld(wx, wz) {
      const gx = Math.floor(wx / CELL_SIZE);
      const gz = Math.floor(wz / CELL_SIZE);
      const p = this.pillarAt(gx, gz);
      if (p) return outsidePillar(p, wx, wz);
      return !this.isWall(gx, gz);
    },
  };
}

// distances en cases depuis (sx, sz), -1 si inaccessible
export function bfs(grid, W, H, sx, sz) {
  const dist = new Int32Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  dist[sz * W + sx] = 0;
  queue[tail++] = sz * W + sx;
  while (head < tail) {
    const k = queue[head++];
    const x = k % W;
    const z = (k - x) / W;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nx >= W || nz < 0 || nz >= H) continue;
      const nk = nz * W + nx;
      if (dist[nk] >= 0 || blocks(grid[nk])) continue;
      dist[nk] = dist[k] + 1;
      queue[tail++] = nk;
    }
  }
  return dist;
}

// Le Level 0 sur deux étages : on tombe par les trous du haut, on remonte par les escaliers (2, loin des trous).
// Les cassettes sont réparties entre les étages (celle du couloir piégé et celle du renfoncement en haut).
// Chaque étage a son ascenseur ; le moteur décide lequel est le vrai.
export function createLevel0(seed = 42) {
  const up = createBackroomsMap(seed);
  const W = up.W;
  const forced = up.pits.map((p) => [p.gx, p.gz]);
  const down = createBackroomsMap(seed + 7919, { lower: true, forced });

  // les escaliers coudés : deux volées côte à côte reliées par un palier (6 cases libres aux deux étages, loin des
  // trous). On entre en bas par la case d'avant la première volée (étage du bas), on monte, on fait demi-tour sur le
  // palier, on remonte par la seconde volée et on arrive en haut sur la case d'à côté (étage du haut).
  let s = (seed * 31 + 7) >>> 0 || 1;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const free = (m, x, z) => x > 0 && z > 0 && x < W - 1 && z < W - 1 && m.grid[z * W + x] === T.FLOOR && m.dist[z * W + x] >= 0 && m.pitAt(x, z) < 0;
  const busyCell = (m, x, z) =>
    m.cassettes.some((c) => c.gx === x && c.gz === z) || m.items.some((i) => i.gx === x && i.gz === z) || (m.exit.gx === x && m.exit.gz === z) || (m.spawn.gx === x && m.spawn.gz === z);
  const farFromPits = (x, z, d) => up.pits.every((p) => Math.abs(p.gx - x) + Math.abs(p.gz - z) >= d);
  const ok = (x, z) => free(up, x, z) && free(down, x, z) && !busyCell(up, x, z) && !busyCell(down, x, z);
  // la cage d'escalier ne doit couper aucun des deux étages en morceaux
  const stillLinked = (m, cells, enter) => {
    const blocked = new Set(cells.map(([x, z]) => z * W + x));
    const g = m.grid.map((v, i) => (blocked.has(i) ? T.WALL : v));
    const d = bfs(g, W, m.H, enter[0], enter[1]);
    for (let i = 0; i < W * m.H; i++) if (m.dist[i] >= 0 && !blocked.has(i) && d[i] < 0) return false;
    return true;
  };
  const stairs = [];
  const C = CELL_SIZE;
  for (const minPit of [10, 6, 4]) {
    const cand = up.walkable.filter((c) => farFromPits(c.x, c.z, minPit) && Math.hypot(c.x - up.spawn.gx, c.z - up.spawn.gz) > 6).sort(() => rnd() - 0.5);
    for (const c of cand) {
      if (stairs.length >= 2) break;
      if (stairs.some((st) => Math.abs(st.gx - c.x) + Math.abs(st.gz - c.z) < 24)) continue;
      // c : la case d'en bas (étage du bas) ; on monte vers (dx, dz) ; la seconde volée est du côté (px, pz)
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => rnd() - 0.5);
      let found = null;
      for (const [dx, dz] of dirs) {
        for (const side of rnd() < 0.5 ? [1, -1] : [-1, 1]) {
          const px = -dz * side;
          const pz = dx * side;
          const cells = [];
          for (let k = 1; k <= 3; k++) for (const l of [0, 1]) cells.push([c.x + dx * k + px * l, c.z + dz * k + pz * l]);
          if (!cells.every(([x, z]) => ok(x, z) && farFromPits(x, z, minPit))) continue;
          if (!free(down, c.x, c.z) || !free(up, c.x + px, c.z + pz)) continue;
          if (!stillLinked(down, cells, [c.x, c.z]) || !stillLinked(up, cells, [c.x + px, c.z + pz])) continue;
          found = { dx, dz, px, pz, cells };
          break;
        }
        if (found) break;
      }
      if (!found) continue;
      const { dx, dz, px, pz, cells } = found;
      const at = (x, z) => ({ x: (x + 0.5) * C, z: (z + 0.5) * C });
      // repère de la cage : o, le coin d'en bas de la première volée ; u le long des volées (0 à 3 cases), v en travers
      // (0 à 1 case : première volée, 1 à 2 cases : seconde volée) ; le palier occupe u de 2 à 3 cases
      const ox = (c.x + 0.5 + dx * 0.5 - px * 0.5) * C;
      const oz = (c.z + 0.5 + dz * 0.5 - pz * 0.5) * C;
      stairs.push({
        id: stairs.length,
        gx: c.x + dx,
        gz: c.z + dz,
        cells: cells.map(([x, z]) => ({ gx: x, gz: z })),
        ox,
        oz,
        dx,
        dz,
        px,
        pz,
        // x, z : le milieu du palier
        x: ox + dx * 2.5 * C + px * C,
        z: oz + dz * 2.5 * C + pz * C,
        // le milieu de toute la cage
        cx: ox + dx * 1.5 * C + px * C,
        cz: oz + dz * 1.5 * C + pz * C,
        up: at(c.x + px, c.z + pz),
        down: at(c.x, c.z),
      });
    }
    if (stairs.length >= 2) break;
  }
  up.stairs = stairs;
  down.stairs = stairs;
  // pas de néon dans la cage d'escalier de l'étage du bas (son plafond est ouvert sur l'étage du haut)
  // ni sous les trous de l'étage du haut (le néon flotterait au milieu du puits)
  const inWell = (l) => stairs.some((st) => st.cells.some((k) => k.gx === l.gx && k.gz === l.gz)) || up.pits.some((p) => p.gx === l.gx && p.gz === l.gz);
  down.lights = down.lights.filter((l) => !inWell(l));
  // la cage est fermée jusqu'au plafond du haut : pas de néon au-dessus d'elle non plus (ses appliques l'éclairent)
  up.lights = up.lights.filter((l) => !stairs.some((st) => st.cells.some((k) => k.gx === l.gx && k.gz === l.gz)));
  // pas d'objet ni de meuble sur les marches ni autour de la cage
  const nearWell = (x, z, d) => stairs.some((st) => st.cells.some((k) => Math.hypot(x - (k.gx + 0.5) * C, z - (k.gz + 0.5) * C) < d));
  for (const m of [up, down]) {
    m.props = m.props.filter((p) => !nearWell(p.x, p.z, 2.2 + (p.r || 0)));
    m.tapes = m.tapes.filter((t) => !nearWell((t.x1 + t.x2) / 2, (t.z1 + t.z2) / 2, 2.6));
  }

  // les cassettes : 4 en haut (dont celle du couloir piégé et celle du renfoncement), 3 en bas
  const special = up.cassettes.filter((c) => c.vault || c.high);
  const others = up.cassettes.filter((c) => !c.vault && !c.high);
  // en haut, les autres le plus loin des deux spéciales ; en bas, le plus loin des escaliers et l'une de l'autre
  const cellOf = (c) => ({ x: c.gx, z: c.gz, c });
  const upDist = gridDist(up.grid, W, up.H);
  const fixedUp = [...special, up.spawn, up.exit].map(cellOf);
  const keepUp = [...special, ...spreadOut(others.map(cellOf), fixedUp, Math.max(0, CASSETTES - 3 - special.length), upDist, rnd).map((o) => o.c)];
  const freeIds = up.cassettes.filter((c) => !keepUp.includes(c)).map((c) => c.id);
  up.cassettes = keepUp;
  const downDist = gridDist(down.grid, W, down.H);
  const fixedDown = [...stairs.map((st) => ({ x: st.gx, z: st.gz })), cellOf(down.spawn)];
  // jamais sous un trou du haut (ni tout près) : vue d'en haut au fond du puits, elle brillait sans qu'on puisse la
  // prendre, et le signal (celui de l'étage où l'on est) ne la comptait pas
  const downCands = down.cassettes.map(cellOf);
  const clear = downCands.filter((o) => !up.pits.some((p) => Math.hypot(p.x - o.c.x, p.z - o.c.z) < 6));
  down.cassettes = spreadOut(clear.length >= freeIds.length ? clear : downCands, fixedDown, freeIds.length, downDist, rnd).map((o) => o.c);
  down.cassettes.forEach((c, i) => {
    c.id = freeIds[i];
  });
  return { level: 0, floors: [up, down], stairs };
}
