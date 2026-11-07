// The Backrooms - Scène 3D Three.js : Level 0 (moquette, sur deux étages), Level 1 (entrepôt), ascenseurs, joueurs et entité
// L'éclairage des néons est « cuit » dans une petite texture par étage (une valeur par case) lue en coordonnées monde par
// tous les matériaux : des centaines de néons pour le prix d'aucune lumière. Seuls la lampe torche, les cassettes et
// les ascenseurs sont de vraies lumières. Les étages sont empilés (le second FLOOR_DY plus bas) : on voit l'étage du
// dessous par les trous et les cages d'escalier. L'image finale passe par le filtre de vieille caméra (vhs.js).
import * as THREE from '../../shared/vendor/three/three.module.min.js';
import { classicEntity } from './entity.js';
import { GLTFLoader } from '../../shared/vendor/three/GLTFLoader.js';
import { CELL_SIZE, WALL_HEIGHT, T, PIT_HALF, NICHE_Y, FLOOR_DY } from '../engine/map.js';
import { FUSES, feetY, stairAt, PIPES_LEVEL } from '../engine/sim.js';
import { createBackroomsTextures } from './textures.js';
import { createVhsFilter } from './vhs.js';
import { buildWarehouse } from './warehouse.js';
import { createPlayerAvatars } from './players.js';
import { createBeast } from './beast.js';
import { buildWater } from './water.js';
import { createGoatHerd } from './goats.js';
import { createPipesTextures } from './textures2.js';
import { buildPipes, L2_PROC } from './pipes.js';
import { hasLineOfSight } from '../engine/nav.js';
import { Z } from '../engine/level2.js';

const MODELS = new URL('../models/', import.meta.url).href; // modèles Poly Haven (CC0), voir models/LICENSE.txt
const VIP_IMG = new URL('../img/entite.png?v=2', import.meta.url).href; // ?v : image plus nette, ne pas garder l'ancienne en cache
// L'entité du Level 1 : une vidéo détourée, découpée en planche d'images (12 par seconde, 16 par rangée) jouée en boucle
const VIP_ANIM = { url: new URL('../monster/david.webp?v=2', import.meta.url).href, frames: 119, cols: 16, rows: 8, fps: 12, aspect: 246 / 400, tint: '#463e37', vip: true };
// mode normal : l'entité classique dessinée dans le code ; mode VIP : les monstres d'origine (réservés, choisis par l'hôte)
export let ENTITY_IMG = classicEntity().img;
export let ENTITY_ANIM = classicEntity().anim;
export let ENTITY_VIP = false;
export function setMonsterMode(vip) {
  ENTITY_VIP = !!vip;
  ENTITY_IMG = vip ? VIP_IMG : classicEntity().img;
  ENTITY_ANIM = vip ? VIP_ANIM : classicEntity().anim;
}

const LIGHT_R = 1.55; // portée d'un néon, en cases : une flaque de lumière nette, le noir juste à côté
const AMBIENT = 0.003; // lumière minimale dans les zones mortes (presque le noir complet)
const RB = 4; // finesse de l'éclairage cuit : texels par case (des flaques de lumière rondes, des ombres nettes au coin des murs)
const AO_R = 0.8; // portée de l'ombre de contact au pied des murs, en mètres
const SLAB = FLOOR_DY - WALL_HEIGHT; // épaisseur de la dalle entre deux étages

// Projecteur de chantier éteint : trépied noir, mât, barre et deux phares halogènes jaunes qui regardent +z
function makeWorklight() {
  const root = new THREE.Group();
  const black = new THREE.MeshLambertMaterial({ color: '#1d1c1a' });
  const yellow = new THREE.MeshLambertMaterial({ color: '#d29a12' });
  const glass = new THREE.MeshLambertMaterial({ color: '#4a4636' });
  const leg = new THREE.CylinderGeometry(0.014, 0.014, 1, 6);
  const hubY = 0.75;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const foot = new THREE.Vector3(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
    const top = new THREE.Vector3(0, hubY, 0);
    const m = new THREE.Mesh(leg, black);
    m.position.copy(foot).add(top).multiplyScalar(0.5);
    m.scale.y = foot.distanceTo(top);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
    root.add(m);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.85, 8), black);
  mast.position.y = hubY + 0.42;
  root.add(mast);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.03), black);
  bar.position.y = 1.6;
  root.add(bar);
  for (const x of [-0.2, 0.2]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.11), yellow);
    head.position.set(x, 1.66, 0.04);
    head.rotation.x = 0.25;
    root.add(head);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.15, 0.01), glass);
    lens.position.set(0, 0, 0.058);
    head.add(lens);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.02), black);
    handle.position.set(0, 0.12, 0);
    head.add(handle);
  }
  return root;
}

// Cône de chantier orange à bande blanche, sur son socle noir
function makeCone() {
  const root = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.36), new THREE.MeshLambertMaterial({ color: '#1b1a18' }));
  base.position.y = 0.015;
  root.add(base);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.15, 0.47, 14), new THREE.MeshLambertMaterial({ color: '#d4510f' }));
  cone.position.y = 0.265;
  root.add(cone);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.09, 0.08, 14), new THREE.MeshLambertMaterial({ color: '#d8d6cc' }));
  band.position.y = 0.3;
  root.add(band);
  return root;
}

// Montre ou cache un groupe sans retirer ses lumières de la scène : une lumière cachée change le nombre de lumières,
// et three.js recompile alors tous les matériaux (le jeu se fige une à deux secondes chez tout le monde). Ici, ses
// lumières s'éteignent (puissance 0) et le reste se cache.
function showGroup(g, on) {
  for (const o of g.children) {
    if (o.isLight) {
      if (o.userData.on === undefined) o.userData.on = o.intensity;
      o.intensity = on ? o.userData.on : 0;
    } else o.visible = on;
  }
}

// Un seul moteur de rendu (un seul contexte WebGL) pour toute la session : chaque nouvel étage le réutilise. Avant,
// chaque étage en créait un, et le navigateur finissait par perdre les plus anciens (écran noir au 4e niveau).
let sharedRenderer = null;
function getRenderer() {
  if (!sharedRenderer) {
    sharedRenderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    sharedRenderer.setPixelRatio(1);
  }
  return sharedRenderer;
}

// Réglages d'image du joueur (view/../app.js) : champ de vision, mouvements de caméra, luminosité, flashs, qualité
const OPTS = { fov: 72, motion: 1, brightness: 1, reduceFlashes: false, quality: 'auto' };
let liveScene = null;
export function setSceneOptions(o = {}) {
  Object.assign(OPTS, o);
  if (liveScene) liveScene.applyOptions();
}

// floors : les étages du niveau (une carte chacun)
export function createBackroomsScene(container, floors) {
  if (!Array.isArray(floors)) floors = [floors];
  const map0 = floors[0];
  const L1 = map0.level === 1;
  const L2 = map0.level === 2; // Level 37, les Poolrooms : clair, laiteux, carrelé, inondé
  const PIPES = map0.level === PIPES_LEVEL; // le Level 2, les Tuyauteries
  const L0 = !L1 && !L2 && !PIPES; // le Level 0 : la moquette, le papier peint jaune, les néons
  const CEIL = map0.ceil || WALL_HEIGHT;
  const scene = new THREE.Scene();
  // Level 1 : un froid bleuté, un brouillard plus épais ; Level 2 : une moiteur brune, chaude
  scene.background = new THREE.Color(L2 ? '#d3e4e2' : L1 ? '#06080a' : PIPES ? '#080604' : '#0d0b06');
  scene.fog = new THREE.FogExp2(L2 ? '#d3e4e2' : L1 ? '#050608' : PIPES ? '#0a0705' : '#080604', L2 ? 0.022 : L1 ? 0.058 : PIPES ? 0.033 : 0.05);

  const camera = new THREE.PerspectiveCamera(OPTS.fov, window.innerWidth / window.innerHeight, 0.08, 90);
  camera.position.set(map0.spawn.x, 1.6, map0.spawn.z);

  const renderer = getRenderer();
  renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
  container.appendChild(renderer.domElement);
  const vhs = createVhsFilter(renderer);
  vhs.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

  const textures = createBackroomsTextures(PIPES ? 0 : map0.level || 0);
  const tx2 = PIPES ? createPipesTextures() : null;
  const AMB = L2 ? 0.045 : 0.012;
  const ambient = new THREE.AmbientLight(L2 ? '#eaf7f6' : L1 ? '#c9d8ff' : PIPES ? '#ffd9a8' : '#fff3c4', AMB);
  scene.add(ambient);
  const dummy = new THREE.Object3D();
  const loader = new GLTFLoader();

  // masque de transparence d'un plan couché (sol ou plafond) : des trous rectangulaires (demi-côtés hx, hz). 16 texels par case (16 cm : de quoi
  // garder les arêtes de 50 cm entre les trous). flip : la ligne 0 du masque est au bord z max (sol) ou z 0 (plafond)
  const holeMask = (W, H, holes, flip) => {
    const R = 16;
    const mw = W * R;
    const mh = H * R;
    const mask = new Uint8Array(mw * mh * 4).fill(255);
    const tx = (v) => Math.round((v / CELL_SIZE) * R);
    for (const h of holes) {
      const x0 = tx(h.x - h.hx);
      const x1 = tx(h.x + h.hx);
      for (let zi = tx(h.z - h.hz); zi < tx(h.z + h.hz); zi++) {
        const row = flip ? mh - 1 - zi : zi;
        mask.fill(0, (row * mw + x0) * 4, (row * mw + x1) * 4);
      }
    }
    const t = new THREE.DataTexture(mask, mw, mh, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  };
  // les trous d'un étage (ceux du sol, par où l'on tombe) et ses cages d'escalier
  const holesOf = (m) => [
    ...(m.pits || []).map((p) => ({ x: p.x, z: p.z, hx: PIT_HALF, hz: PIT_HALF })),
    // la trémie de l'escalier : une seule ouverture sur ses deux cases (pas de poutre au milieu)
    ...(m.stairs || []).map((st) => ({ x: st.cx, z: st.cz, hx: (st.dx ? 1.5 : 1) * CELL_SIZE - 0.02, hz: (st.dz ? 1.5 : 1) * CELL_SIZE - 0.02 })),
  ];

  // Un étage entier : sol, plafond, murs, néons, meubles, cassettes, objets, ascenseur… dans un groupe à sa hauteur
  function buildFloor(map, fi) {
    const group = new THREE.Group();
    group.position.y = -fi * FLOOR_DY;
    scene.add(group);
    const W = map.W;
    const H = map.H;

    // --- Éclairage cuit des néons ---
    // RB texels par case. Rouge : la lumière des néons, arrêtée par les murs (un rayon par texel) ; vert : l'ombre de
    // contact au pied des murs. Un néon qui grésille garde sa propre empreinte, ajoutée selon son éclat du moment.
    const BW = W * RB;
    const BH = H * RB;
    const TX = CELL_SIZE / RB;
    // la cage d'escalier est fermée de murs : la lumière des néons n'y entre pas, elle éclaire ses murs du dehors
    const stairSet = new Set((map.stairs || []).flatMap((st) => st.cells.map((k) => k.gz * W + k.gx)));
    const isWall = (x, z) => x < 0 || z < 0 || x >= W || z >= H || map.grid[z * W + x] === T.WALL || stairSet.has(z * W + x);
    const shaftViews = []; // les appliques des cages d'escalier (étage du bas), éteintes pendant les coupures
    // Level 2 : deux lumières de couleurs différentes, les ampoules chaudes des galeries (rouge) et les tubes froids
    // des réserves (bleu)
    const base = new Float32Array(BW * BH);
    const live = new Float32Array(BW * BH);
    const baseB = new Float32Array(BW * BH);
    const liveB = new Float32Array(BW * BH);
    const bakeData = new Uint8Array(BW * BH * 4);
    const bakeTex = new THREE.DataTexture(bakeData, BW, BH, THREE.RGBAFormat);
    bakeTex.magFilter = THREE.LinearFilter;
    bakeTex.minFilter = THREE.LinearFilter;
    const bakeUniforms = {
      uBake: { value: bakeTex },
      uBakeScale: { value: new THREE.Vector2(1 / (W * CELL_SIZE), 1 / (H * CELL_SIZE)) },
      uBakeTint: { value: L2 ? new THREE.Color(1.0, 1.05, 1.07) : L1 ? new THREE.Color(0.86, 0.98, 1.12) : PIPES ? new THREE.Color(1.25, 0.98, 0.7) : new THREE.Color(1.12, 1.04, 0.8) },
      uBakeTint2: { value: PIPES ? new THREE.Color(0.78, 0.95, 1.08) : new THREE.Color(0, 0, 0) },
      uBakeY: { value: -fi * FLOOR_DY },
      uCeil: { value: CEIL },
      uDamp: { value: L2 ? 0 : L1 ? 0.6 : PIPES ? 0.5 : 1 },
      // Poolrooms : sous la surface, le carrelage prend la teinte de l'eau et les caustiques dansent dessus
      uPool: { value: L2 ? 1 : 0 },
      uTime: { value: 0 },
      uWaterY: { value: -0.03 },
      uWallLamps: { value: PIPES ? 1 : 0 },
      uHaze: { value: PIPES ? 0.16 : 0 },
      // Level 0 : les néons éclairent le mur presque jusqu'au sol, et les auréoles du plafond restent discrètes
      uSideLo: { value: L0 ? 0.8 : 0.5 },
      uStain: { value: L0 ? 0.5 : 1 },
    };
    // reflets des lampes (Level 2) : les plus proches que la caméra voit, choisies à chaque image
    const NLAMP = 12;
    const lampU = {
      uLampPos: { value: Array.from({ length: NLAMP }, () => new THREE.Vector3(0, -100, 0)) },
      uLampCol: { value: Array.from({ length: NLAMP }, () => new THREE.Vector3()) },
    };
    // un texel est-il éclairé par ce néon ? Le rayon ne doit traverser aucun mur, sauf, pour un texel de mur,
    // les 70 premiers centimètres de son propre mur (la face tournée vers le néon)
    const seen = (lx, lz, px, pz) => {
      const gx = Math.floor(px / CELL_SIZE);
      const gz = Math.floor(pz / CELL_SIZE);
      const own = isWall(gx, gz);
      const d = Math.hypot(px - lx, pz - lz);
      const n = Math.ceil(d / 0.2);
      let inOwn = 0;
      for (let i = 1; i < n; i++) {
        const x = lx + ((px - lx) * i) / n;
        const z = lz + ((pz - lz) * i) / n;
        const cx = Math.floor(x / CELL_SIZE);
        const cz = Math.floor(z / CELL_SIZE);
        if (!isWall(cx, cz)) continue;
        if (!own || cx !== gx || cz !== gz) return false;
        inOwn += d / n;
      }
      // Poolrooms : la lumière ne traverse pas les cloisons minces entre deux salles
      return inOwn < 0.7 && !(map.lightBlocked && map.lightBlocked(lx, lz, px, pz));
    };
    // les néons des zones claires éclairent plus fort et plus loin
    const footprint = (l) => {
      const out = [];
      // Level 0 : les zones claires baignent dans la lumière des néons (comme dans les vidéos), sans flaque ni trou noir
      const LB = L0 && l.bright;
      const LR = LB ? LIGHT_R * CELL_SIZE * 2.3 : l.bright ? LIGHT_R * CELL_SIZE * 1.55 : l.kind === 'bulb' ? 2.2 * CELL_SIZE : l.kind === 'tube' ? 2.3 * CELL_SIZE : LIGHT_R * CELL_SIZE * (L0 ? 1.15 : 1);
      const gain = LB ? 1.42 : l.bright ? 1.3 : l.kind === 'bulb' ? 1.05 : l.kind === 'tube' ? 1.45 : L0 ? 0.97 : 1; // Level 0 : l'image environ 10 % moins lumineuse qu'au réglage du 7 novembre (la courbe du caméscope compresse : il faut baisser plus les néons)
      const fall = LB ? 1.5 : 2.4;
      const r = Math.ceil(LR / TX);
      const tx0 = Math.floor(l.x / TX);
      const tz0 = Math.floor(l.z / TX);
      for (let tz = tz0 - r; tz <= tz0 + r; tz++) {
        for (let tx = tx0 - r; tx <= tx0 + r; tx++) {
          if (tx < 0 || tz < 0 || tx >= BW || tz >= BH) continue;
          const px = (tx + 0.5) * TX;
          const pz = (tz + 0.5) * TX;
          const d = Math.hypot(px - l.x, pz - l.z);
          if (d > LR || !seen(l.x, l.z, px, pz)) continue;
          out.push(tz * BW + tx, Math.pow(1 - d / LR, fall) * 1.05 * gain);
        }
      }
      return out;
    };
    const addPrint = (arr, fp, k) => {
      for (let i = 0; i < fp.length; i += 2) arr[fp[i]] += fp[i + 1] * k;
    };
    const chan = (l) => (l.kind === 'tube' && PIPES ? 1 : 0); // 1 : le canal bleu (lumière froide)
    // l'empreinte de chaque lampe est gardée : au Level 2, un secteur qui saute ou se rallume refait la somme
    const fpOf = (l) => l.bakeFp || (l.bakeFp = footprint(l));
    let flickers = [];
    const sumLights = () => {
      base.fill(0);
      baseB.fill(0);
      for (const l of map.lights) if (l.state === 'on') addPrint(chan(l) ? baseB : base, fpOf(l), 1);
      flickers = map.lights.filter((l) => l.state === 'flicker').map((l) => ({ l, k: 1, fp: fpOf(l), ch: chan(l), calm: Math.random() * 4, burst: 0 }));
    };
    sumLights();
    let lightGen = map.lightGen || 0;
    // ombre de contact : plus sombre à moins de AO_R d'un mur
    for (let tz = 0; tz < BH; tz++) {
      for (let tx = 0; tx < BW; tx++) {
        const px = (tx + 0.5) * TX;
        const pz = (tz + 0.5) * TX;
        const gx = Math.floor(px / CELL_SIZE);
        const gz = Math.floor(pz / CELL_SIZE);
        let d = AO_R;
        if (!isWall(gx, gz)) {
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!(dx || dz) || !isWall(gx + dx, gz + dz)) continue;
              const x0 = (gx + dx) * CELL_SIZE;
              const z0 = (gz + dz) * CELL_SIZE;
              const ex = Math.max(x0 - px, 0, px - (x0 + CELL_SIZE));
              const ez = Math.max(z0 - pz, 0, pz - (z0 + CELL_SIZE));
              d = Math.min(d, Math.hypot(ex, ez));
            }
          }
        }
        const t = d / AO_R;
        bakeData[(tz * BW + tx) * 4 + 1] = Math.round((0.42 + 0.58 * t * t * (3 - 2 * t)) * 255);
      }
    }
    // power : 1 néons allumés, 0 coupure de courant (seule reste une lueur à peine visible)
    let power = 1;
    const writeBake = () => {
      live.set(base);
      liveB.set(baseB);
      for (const f of flickers) if (f.k > 0) addPrint(f.ch ? liveB : live, f.fp, f.k);
      for (let i = 0; i < BW * BH; i++) {
        const v = Math.min(1, (L2 || PIPES ? 0.03 : AMBIENT) * (power ? 1 : 0.25) + live[i] * 0.3 * power); // stocké à moitié : jusqu'à 2 de lumière
        bakeData[i * 4] = Math.round(v * 255);
        if (PIPES) bakeData[i * 4 + 2] = Math.round(Math.min(1, liveB[i] * 0.3 * power) * 255);
      }
      bakeTex.needsUpdate = true;
    };
    writeBake();
    // lumière reçue en un point (pour l'exposition automatique du caméscope)
    const lightAt = (x, z) => {
      const tx = Math.floor(x / TX);
      const tz = Math.floor(z / TX);
      if (tx < 0 || tz < 0 || tx >= BW || tz >= BH) return 0;
      return power ? live[tz * BW + tx] + liveB[tz * BW + tx] : 0;
    };

    // ajoute la lumière cuite de cet étage à un matériau Lambert (ou Phong). Au Level 2, opts.spec ajoute les reflets
    // des lampes voisines (carrelage émaillé, béton ciré, métal) : spec leur force, gloss leur netteté ; sur un
    // matériau à relief, seules les parties hautes du relief brillent (les carreaux, pas les joints)
    // Au Level 2, opts.grime salit les murs (coulures de rouille, crasse en plaques, pied du mur), opts.tile (la
    // hauteur d'une rangée de carreaux) fait tomber ou remplacer quelques carreaux ; tous les matériaux du niveau
    // baignent dans une brume que les lampes éclairent
    const baked = (mat, opts = null) => {
      const spec = PIPES && opts && opts.spec > 0;
      const grime = PIPES && opts && opts.grime;
      const tile = PIPES && opts && opts.tile;
      const specU = spec ? { uSpecK: { value: opts.spec }, uGloss: { value: opts.gloss || 40 }, uSpecMask: { value: opts.mask ?? (mat.bumpMap ? 1 : 0) } } : null;
      const tileU = tile ? { uTileRow: { value: opts.tile } } : null;
      const base = opts && opts.base; // une plinthe au pied du mur
      if (spec || PIPES || base) mat.customProgramCacheKey = () => 'bk' + (spec ? '-spec' : '') + (grime ? '-grime' : '') + (tile ? '-tile' : '') + (PIPES ? '-pipes' : '') + (base ? '-base' : '');
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, bakeUniforms);
        if (spec) {
          Object.assign(sh.uniforms, lampU, specU);
          sh.defines = { ...(sh.defines || {}), BK_SPEC: 1 };
        }
        if (grime) sh.defines = { ...(sh.defines || {}), BK_GRIME: 1 };
        if (tile) {
          Object.assign(sh.uniforms, tileU);
          sh.defines = { ...(sh.defines || {}), BK_TILE: 1 };
        }
        if (PIPES) sh.defines = { ...(sh.defines || {}), BK_PIPES: 1 };
        if (base) sh.defines = { ...(sh.defines || {}), BK_BASE: 1 };
        sh.vertexShader = 'varying vec3 vBakeP;\nvarying vec3 vBakeN;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 bakeWP = vec4(transformed, 1.0);
          vec3 bakeN = objectNormal;
          #ifdef USE_INSTANCING
            bakeWP = instanceMatrix * bakeWP;
            bakeN = mat3(instanceMatrix) * bakeN;
          #endif
          vBakeP = (modelMatrix * bakeWP).xyz;
          vBakeN = normalize(mat3(modelMatrix) * bakeN);`);
        sh.fragmentShader = `uniform sampler2D uBake;
uniform vec2 uBakeScale;
uniform vec3 uBakeTint;
uniform vec3 uBakeTint2;
#ifdef BK_SPEC
uniform vec3 uLampPos[${NLAMP}];
uniform vec3 uLampCol[${NLAMP}];
uniform float uSpecK;
uniform float uGloss;
uniform float uSpecMask;
#endif
uniform float uBakeY;
uniform float uCeil;
uniform float uDamp;
uniform float uPool;
uniform float uTime;
uniform float uWaterY;
uniform float uHaze;
uniform float uSideLo;
uniform float uStain;
#ifdef BK_TILE
uniform float uTileRow;
#endif
varying vec3 vBakeP;
varying vec3 vBakeN;
float bkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bkNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bkHash(i), bkHash(i + vec2(1.0, 0.0)), f.x), mix(bkHash(i + vec2(0.0, 1.0)), bkHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float bkFbm(vec2 p) { return bkNoise(p) * 0.55 + bkNoise(p * 2.13 + 7.1) * 0.3 + bkNoise(p * 4.7 + 3.3) * 0.15; }
// caustiques : le réseau lumineux que l'eau projette sur le fond
float bkCaust(vec2 uv, float t) {
  vec2 p = mod(uv * 6.2831, 6.2831) - 250.0;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.005), p.y / (cos(i.y + tt) / 0.005)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
` +
          sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // les néons sont au plafond : un mur s'assombrit vers le bas, et plus encore au ras du sol et sous le plafond ;
          // le sol et le plafond s'assombrissent au pied des murs
          vec4 bk = texture2D(uBake, vBakeP.xz * uBakeScale);
          float by = vBakeP.y - uBakeY;
          float ny = vBakeN.y;
          float side = mix(uSideLo, 1.12, smoothstep(0.0, uCeil, by)) * mix(uSideLo * 0.85, 1.0, smoothstep(0.0, 0.4, by)) * mix(0.72, 1.0, smoothstep(0.0, 0.3, uCeil - by));
          float flat2 = ny > 0.0 ? bk.g : mix(0.7, 1.0, bk.g) * 0.85;
          float shape = mix(side, flat2, smoothstep(0.5, 0.8, abs(ny)));
          #ifdef BK_PIPES
          // le fond des caissons de la dalle, loin des lampes, reste plus sombre que le dessous des poutres
          if (ny < -0.5) shape *= mix(0.62, 1.15, smoothstep(0.0, 0.26, uCeil - by));
          #endif
          // humidité : la moquette détrempée par plaques, l'eau qui remonte au pied des murs
          float wet = smoothstep(0.52, 0.72, bkFbm(vBakeP.xz * 0.17 + 11.0)) * uDamp;
          float rise = (1.0 - smoothstep(0.05, 0.45 + bkFbm(vBakeP.xz * 0.9 + vBakeP.y) * 0.5, by)) * smoothstep(0.3, 0.7, bkFbm(vBakeP.xz * 0.3 + 5.0)) * uDamp;
          // auréoles d'eau, au plafond (des dalles entières) et sur les murs : un cerne plus foncé autour d'une tache pâle
          float n2 = bkFbm(vec2(vBakeP.x + vBakeP.z * 0.37, vBakeP.y * (abs(ny) < 0.5 ? 1.0 : 0.0) + vBakeP.z) * 0.45 + 31.0);
          float ring = smoothstep(0.6, 0.66, n2) * (1.0 - smoothstep(0.68, 0.75, n2)) * 0.8 + smoothstep(0.66, 0.75, n2) * 0.3;
          float stain = ny < -0.5 ? ring : (abs(ny) < 0.5 ? ring * 0.6 : 0.0);
          diffuseColor.rgb *= mix(1.0, 0.62, ny > 0.5 ? wet : (abs(ny) < 0.5 ? rise : 0.0));
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.78, 0.66, 0.45), stain * uDamp * uStain);
          #ifdef BK_BASE
          // la plinthe : une bande de bois peint brun-jaune, un peu plus claire sur son arête du haut
          if (abs(ny) < 0.5 && by < 0.105) {
            float bWu = vBakeP.x + vBakeP.z;
            diffuseColor.rgb = vec3(0.44, 0.35, 0.2) * (0.9 + 0.1 * bkNoise(vec2(bWu * 2.0, 3.0))) * mix(1.0, 1.25, smoothstep(0.09, 0.1, by)) * mix(0.75, 1.0, smoothstep(0.0, 0.05, by));
          }
          #endif
          float bkGloss = 1.0; // ce qui ternit le reflet (crasse, carreau tombé)
          #ifdef BK_TILE
          {
            // quelques carreaux tombés (la colle grise striée reste) ou remplacés par un carreau d'une autre teinte ;
            // le calepinage : 16 carreaux par case de 2,5 m, des rangées de uTileRow depuis le haut de la plinthe
            float tu = (vBakeP.x + vBakeP.z) / 0.15625;
            float tv = (by - 0.16) / uTileRow;
            vec2 cell = floor(vec2(tu, tv));
            vec2 fr = fract(vec2(tu, tv));
            float h = bkHash(cell + vec2(abs(vBakeN.x) * 31.0, 7.0));
            float inside = step(0.04, fr.x) * step(fr.x, 0.96) * step(0.06, fr.y) * step(fr.y, 0.94);
            if (by > 0.2 && by < 2.3 && abs(ny) < 0.5) {
              if (h < 0.003) {
                float comb = 0.8 + 0.2 * step(0.5, fract(fr.x * 7.0 + fr.y * 0.6));
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.34, 0.3) * comb, inside);
                bkGloss *= 1.0 - inside;
              } else if (h < 0.012) {
                diffuseColor.rgb *= mix(vec3(1.0), vec3(1.12, 1.05, 0.86), inside);
              } else if (h < 0.02) {
                diffuseColor.rgb *= mix(vec3(1.0), vec3(0.86, 0.84, 0.8), inside);
              }
            }
          }
          #endif
          #ifdef BK_GRIME
          if (abs(ny) < 0.5) {
            // coulures de rouille depuis les colliers et les fuites du plafond, crasse en plaques, pied du mur noirci
            float wu = vBakeP.x + vBakeP.z;
            float col = bkNoise(vec2(wu * 7.0, 3.7));
            float reach = 0.4 + bkNoise(vec2(wu * 1.9, 8.1)) * 2.0;
            float streak = smoothstep(0.62, 0.9, col) * (1.0 - smoothstep(0.0, reach, uCeil - by)) * (0.55 + 0.6 * bkNoise(vec2(wu * 45.0, by * 1.2)));
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.66, 0.5, 0.34), clamp(streak, 0.0, 1.0) * 0.7);
            float blot = smoothstep(0.5, 0.82, bkFbm(vec2(wu * 0.4, by * 0.55) + 17.0));
            diffuseColor.rgb *= mix(1.0, 0.8, blot);
            float foot = 1.0 - smoothstep(0.03, 0.35 + bkNoise(vec2(wu * 1.3, 1.0)) * 0.4, by);
            diffuseColor.rgb *= mix(1.0, 0.72, foot);
            bkGloss *= 1.0 - clamp(streak, 0.0, 1.0) * 0.5 - blot * 0.3;
          }
          #endif
          // sous l'eau (Poolrooms) : teinte cyan qui fonce avec la profondeur, et les caustiques
          float sub = uPool * smoothstep(0.0, 0.06, uWaterY - by);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.9, 0.96) * mix(1.0, 0.6, clamp((uWaterY - by) / 1.2, 0.0, 1.0)), sub);
          totalEmissiveRadiance += diffuseColor.rgb * (uBakeTint * bk.r + uBakeTint2 * bk.b) * 2.0 * shape;
          totalEmissiveRadiance += vec3(0.8, 1.0, 1.0) * bkCaust(vBakeP.xz * 0.32, uTime * 0.45) * 0.55 * sub * (0.35 + bk.r * 1.6);
          #ifdef BK_SPEC
          {
            // reflets des lampes : Blinn-Phong en repère caméra, avec la normale du relief
            vec3 sV = normalize(vViewPosition);
            float sm = uSpecK * bkGloss;
            #ifdef USE_BUMPMAP
              sm *= mix(1.0, smoothstep(0.76, 0.83, texture2D(bumpMap, vBumpMapUv).r), uSpecMask);
            #endif
            // le sol : plus luisant là où il est humide, mat là où la poussière s'est déposée
            if (ny > 0.5) sm *= 0.45 + wet * 1.3 + bkFbm(vBakeP.xz * 0.6 + 3.0) * 0.5;
            // pas de reflet là où aucune lampe n'éclaire (un mur caché derrière un angle)
            sm *= mix(0.25, 1.0, smoothstep(0.0, 0.12, bk.r + bk.b));
            vec3 sAcc = vec3(0.0);
            for (int i = 0; i < ${NLAMP}; i++) {
              vec3 sLd = (viewMatrix * vec4(uLampPos[i], 1.0)).xyz + vViewPosition;
              float sD2 = dot(sLd, sLd);
              vec3 sL = sLd * inversesqrt(sD2);
              float sNl = max(dot(normal, sL), 0.0);
              float sH = max(dot(normal, normalize(sL + sV)), 0.0);
              sAcc += uLampCol[i] * (pow(sH, uGloss) + 0.05 * pow(sH, uGloss * 0.1)) * sNl / (1.0 + sD2 * 0.05); // un reflet net, et son halo
            }
            totalEmissiveRadiance += sAcc * sm * (uGloss + 8.0) * 0.04;
          }
          #endif`);
        // la brume (Level 2) : le brouillard prend la couleur de la lumière de l'endroit, les lampes au loin baignent
        // dans un halo chaud au lieu de se noyer dans le noir
        if (PIPES)
          sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
            #ifdef FOG_EXP2
              float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
            #else
              float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
            #endif
            gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor + (uBakeTint * bk.r + uBakeTint2 * bk.b) * uHaze, fogFactor );
          #endif`);
      };
      return mat;
    };

    // 1. Sol en moquette humide (une répétition de texture par case), percé des trous et des cages d'escalier
    // (Level 2 : béton ciré, luisant d'humidité, qui reflète les lampes)
    const carpet = (PIPES ? tx2.floor : textures.carpet).clone();
    carpet.needsUpdate = true;
    carpet.repeat.set(W, H);
    (PIPES ? tx2.ready : textures.ready).then(() => {
      carpet.needsUpdate = true;
    });
    const floorMat = PIPES
      ? baked(new THREE.MeshPhongMaterial({ map: carpet, specular: '#3a342a', shininess: 70 }), { spec: 1.05, gloss: 1100 })
      : baked(new THREE.MeshLambertMaterial({ map: carpet }));
    const holes = holesOf(map);
    if (holes.length) {
      floorMat.alphaMap = holeMask(W, H, holes, true);
      floorMat.alphaTest = 0.5;
      // les bords des trous : l'épaisseur de la dalle
      const edgeMat = baked(new THREE.MeshLambertMaterial({ color: '#5e5434' }));
      const edges = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, SLAB), edgeMat, holes.length * 4);
      holes.forEach((h, i) => {
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dz], k) => {
          dummy.position.set(h.x + dx * h.hx, -SLAB / 2, h.z + dz * h.hz);
          dummy.rotation.set(0, Math.atan2(-dx, -dz), 0); // la paroi regarde l'intérieur du trou
          dummy.scale.set((dx ? h.hz : h.hx) * 2, 1, 1);
          dummy.updateMatrix();
          edges.setMatrixAt(i * 4 + k, dummy.matrix);
        });
      });
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      group.add(edges);
    }
    let water = null;
    if (L2) {
      // Poolrooms : sols, bassins, parois des bassins, margelles et la surface de l'eau (view/water.js)
      water = buildWater({ map, group, baked, textures, bake: bakeUniforms, fog: scene.fog });
    } else {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * CELL_SIZE, H * CELL_SIZE), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set((W * CELL_SIZE) / 2, 0, (H * CELL_SIZE) / 2);
      group.add(floor);
    }

    // 2. Faux plafond à dalles (percé là où l'étage du dessus a ses trous et ses escaliers)
    const ceilTex = (PIPES ? tx2.ceiling : textures.ceiling).clone();
    ceilTex.needsUpdate = true;
    ceilTex.repeat.set(W, H);
    (PIPES ? tx2.ready : textures.ready).then(() => {
      ceilTex.needsUpdate = true;
    });
    // (Level 2 : la dalle de béton, sombre, au-dessus des tuyaux)
    const ceilMat = baked(new THREE.MeshLambertMaterial({ map: ceilTex, color: PIPES ? '#9a958a' : '#ffffff' }));
    const above = fi > 0 ? floors[fi - 1] : null;
    if (above && holesOf(above).length) {
      ceilMat.alphaMap = holeMask(W, H, holesOf(above), false);
      ceilMat.alphaTest = 0.5;
    }
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W * CELL_SIZE, H * CELL_SIZE), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set((W * CELL_SIZE) / 2, CEIL, (H * CELL_SIZE) / 2);
    if (!L2) group.add(ceiling); // Poolrooms : chaque salle a son propre plafond (voir water.js)

    // 3. Murs au papier peint jaune
    let wallCount = 0;
    for (let i = 0; i < W * H; i++) if (map.grid[i] === T.WALL) wallCount++;
    const SUNK = L2 ? 1.3 : 0; // les murs des Poolrooms descendent sous l'eau
    let wallMat;
    let hallMat = null; // Level 2 : les parpaings peints des halles (murs et piliers)
    if (PIPES) {
      // Level 2 : une face par côté de mur visible, revêtue selon l'endroit (carrelage ocre ou brun des galeries,
      // brique des réserves, brique peinte des chaufferies) ; le carrelage émaillé brille, ses joints non
      const wallMats = {
        [Z.TILE]: baked(new THREE.MeshPhongMaterial({ map: tx2.tileA.map, bumpMap: tx2.tileA.bump, bumpScale: 1.0, specular: '#3d3628', shininess: 55 }), { spec: 1.3, gloss: 110, grime: true, tile: tx2.tileA.rowH }),
        [Z.TILE_DARK]: baked(new THREE.MeshPhongMaterial({ map: tx2.tileB.map, bumpMap: tx2.tileB.bump, bumpScale: 1.0, specular: '#3a3024', shininess: 55 }), { spec: 1.4, gloss: 110, grime: true, tile: tx2.tileB.rowH }),
        [Z.BRICK]: baked(new THREE.MeshPhongMaterial({ map: tx2.brick.map, bumpMap: tx2.brick.bump, bumpScale: 3, specular: '#111111', shininess: 10 }), { spec: 0.08, gloss: 12, mask: 0, grime: true }),
        [Z.BOILER]: baked(new THREE.MeshPhongMaterial({ map: tx2.boiler.map, bumpMap: tx2.boiler.bump, bumpScale: 2.5, specular: '#1c1a16', shininess: 25 }), { spec: 0.25, gloss: 30, mask: 0.6, grime: true }),
        [Z.HALL]: baked(new THREE.MeshPhongMaterial({ map: tx2.hall.map, bumpMap: tx2.hall.bump, bumpScale: 2, specular: '#1c1c1a', shininess: 20 }), { spec: 0.2, gloss: 25, mask: 0.4, grime: true }),
      };
      wallMat = wallMats[Z.TILE];
      hallMat = wallMats[Z.HALL];
      const faces = new Map();
      const open = (x, z) => x >= 0 && z >= 0 && x < W && z < H && map.grid[z * W + x] !== T.WALL;
      const zoneOf = (x, z) => {
        const zn = map.zone[z * W + x];
        if (zn) return zn;
        // une grille, une chaudière, l'ascenseur : le revêtement d'une case voisine
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (open(x + dx, z + dz) && map.zone[(z + dz) * W + x + dx]) return map.zone[(z + dz) * W + x + dx];
        return Z.TILE;
      };
      for (let z = 0; z < H; z++) {
        for (let x = 0; x < W; x++) {
          if (!open(x, z) || map.grid[z * W + x] === T.EXIT) continue;
          const zn = zoneOf(x, z);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (open(x + dx, z + dz)) continue;
            if (!faces.has(zn)) faces.set(zn, []);
            faces.get(zn).push({ x: (x + 0.5) * CELL_SIZE + dx * (CELL_SIZE / 2), z: (z + 0.5) * CELL_SIZE + dz * (CELL_SIZE / 2), ry: Math.atan2(-dx, -dz) });
          }
        }
      }
      const faceGeo = new THREE.PlaneGeometry(CELL_SIZE, CEIL);
      for (const [zn, list] of faces) {
        const inst = new THREE.InstancedMesh(faceGeo, wallMats[zn] || wallMat, list.length);
        list.forEach((f, i) => {
          dummy.position.set(f.x, CEIL / 2, f.z);
          dummy.rotation.set(0, f.ry, 0);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        });
        dummy.rotation.set(0, 0, 0);
        inst.instanceMatrix.needsUpdate = true;
        group.add(inst);
      }
    } else {
      wallMat = baked(new THREE.MeshLambertMaterial({ map: textures.wall }), L0 ? { base: true } : null);
      const wallsMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL_SIZE, CEIL + SUNK, CELL_SIZE), wallMat, wallCount);
      let idx = 0;
      for (let z = 0; z < H; z++) {
        for (let x = 0; x < W; x++) {
          if (map.grid[z * W + x] !== T.WALL) continue;
          if (map.arrival && map.arrival.gx === x && map.arrival.gz === z) continue; // la gaine de l'ascenseur d'arrivée
          dummy.position.set((x + 0.5) * CELL_SIZE, (CEIL - SUNK) / 2, (z + 0.5) * CELL_SIZE);
          dummy.updateMatrix();
          wallsMesh.setMatrixAt(idx++, dummy.matrix);
        }
      }
      wallsMesh.count = idx;
      wallsMesh.instanceMatrix.needsUpdate = true;
      group.add(wallsMesh);
    }

    // 3b. Piliers plus fins que la case : carrés ou ronds, de tailles variées, au même papier peint (motif à l'échelle)
    if (map.pillarAt) {
      const kinds = new Map();
      for (let z = 0; z < H; z++) {
        for (let x = 0; x < W; x++) {
          const p = map.pillarAt(x, z);
          if (!p) continue;
          const key = (p.round ? 'r' : 's') + p.h + (p.hall ? 'h' : '');
          if (!kinds.has(key)) kinds.set(key, { p, list: [] });
          kinds.get(key).list.push(p);
        }
      }
      for (const { p, list } of kinds.values()) {
        const geo = p.round ? new THREE.CylinderGeometry(p.h, p.h, CEIL + SUNK, 20, 1, true) : new THREE.BoxGeometry(p.h * 2, CEIL + SUNK, p.h * 2);
        // le papier peint garde la largeur de ses lés : la texture couvre 2,5 m de large sur un mur
        const span = p.round ? 2 * Math.PI * p.h : p.h * 2;
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (span / CELL_SIZE));
        const inst = new THREE.InstancedMesh(geo, (p.hall && hallMat) || wallMat, list.length);
        list.forEach((q, i) => {
          dummy.position.set(q.x, (CEIL - SUNK) / 2, q.z);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        group.add(inst);
      }
    }

    // 4. Néons au plafond (les morts sont gris, ceux qui grésillent clignotent)
    const ON = new THREE.Color(L2 ? '#f2fbff' : L1 ? '#eef6ff' : '#fffbe2').multiplyScalar(L2 ? 2.2 : 3.2); // plus fort que le blanc : le caméscope sature et ils bavent
    const OFF = new THREE.Color(L2 ? '#7d8b8d' : '#4a473c'); // aux Poolrooms, un diffuseur éteint reste gris-bleu
    // Level 2 : des globes de verre dépoli au mur (ampoules chaudes) et des tubes nus dans les réserves
    const ON_BULB = new THREE.Color('#ffc27a').multiplyScalar(3.4);
    const ON_TUBE = new THREE.Color('#e4f0ff').multiplyScalar(3.2);
    const OFF_BULB = new THREE.Color('#3d3328');
    const fixSets = [];
    const fixSet = (geo, mat, list, pose) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((l, i) => {
        pose(l);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        l.fix = { mesh, i };
      });
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      group.add(mesh);
      fixSets.push(mesh);
    };
    const onCol = (l) => (l.kind === 'bulb' ? ON_BULB : l.kind === 'tube' ? ON_TUBE : ON);
    const offCol = (l) => (l.kind === 'bulb' ? OFF_BULB : OFF);
    const fixColor = (l, on) => l.fix && l.fix.mesh.setColorAt(l.fix.i, on ? onCol(l) : offCol(l));
    const fixDirty = () => {
      for (const m of fixSets) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    if (PIPES) {
      const bulbs = map.lights.filter((l) => l.kind === 'bulb');
      // l'ampoule, dans le hublot de verre de la lampe (pipes.js)
      fixSet(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshBasicMaterial({ color: '#ffffff' }), bulbs, (l) => {
        dummy.position.set(l.x + l.wall[0] * 0.13, l.y, l.z + l.wall[1] * 0.13);
        dummy.scale.set(1, 1.3, 1);
      });
      const tubes = map.lights.filter((l) => l.kind === 'tube');
      fixSet(new THREE.CylinderGeometry(0.01, 0.01, 1.4, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }), tubes, (l) => {
        dummy.position.set(l.x, l.y, l.z);
        dummy.rotation.set(l.alongX ? 0 : Math.PI / 2, 0, l.alongX ? Math.PI / 2 : 0);
      });
    } else {
      fixSet(L2 ? new THREE.BoxGeometry(1.3, 0.03, 1.3) : L1 ? new THREE.BoxGeometry(1.55, 0.05, 0.12) : new THREE.BoxGeometry(1.22, 0.04, 0.62), new THREE.MeshBasicMaterial({ color: '#ffffff', map: L1 || L2 ? null : textures.lamp }), map.lights, (l) => {
        dummy.position.set(l.x, l.fy !== undefined ? l.fy : CEIL - (L1 ? 0.45 : 0.025), l.z); // au Level 1, les tubes pendent sous le plafond
        // Poolrooms : la lampe d'un couloir voûté est cachée dans la voûte ; sous une verrière, tout le plafond éclaire
        dummy.scale.setScalar(l.hidden ? 0.0001 : l.fs || 1);
      });
    }
    for (const l of map.lights) fixColor(l, l.state !== 'off');

    // 5. Objets abandonnés (modèles Poly Haven CC0), un InstancedMesh par morceau ; leur photo de couleur est gardée
    const propMats = new Map();
    const propMat = (src) => {
      const key = src.uuid;
      if (!propMats.has(key)) {
        const c = src.color ? src.color.clone().multiplyScalar(0.8) : new THREE.Color('#888');
        if (src.map) src.map.colorSpace = THREE.SRGBColorSpace;
        propMats.set(key, baked(new THREE.MeshLambertMaterial({ color: c, map: src.map || null, side: src.side })));
      }
      return propMats.get(key);
    };
    // un modèle à plusieurs pièces (deux poubelles, quatre sacs…) : p.node choisit la pièce
    const propKey = (p) => p.m + (p.node ? '#' + p.node : '');
    const kinds = new Map(map.props.map((p) => [propKey(p), { m: p.m, node: p.node, h: p.h, proc: p.proc }]));
    for (const [key, kind] of kinds) {
      const list = map.props.filter((p) => propKey(p) === key);
      if (!list.length) continue;
      const place = (root) => {
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        const c = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(c);
        const k = kind.h / (size.y || 1);
        const fix = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
        const place = list.map((p) => {
          const m = new THREE.Matrix4().makeTranslation(p.x, p.tipped ? (size.x * k) / 2 : 0, p.z).multiply(new THREE.Matrix4().makeRotationY(p.rot));
          if (p.tipped) m.multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
          return m.multiply(fix);
        });
        root.traverse((o) => {
          if (!o.isMesh) return;
          const src = Array.isArray(o.material) ? o.material[0] : o.material;
          const inst = new THREE.InstancedMesh(o.geometry, propMat(src), list.length);
          place.forEach((m, i) => inst.setMatrixAt(i, m.clone().multiply(o.matrixWorld)));
          inst.instanceMatrix.needsUpdate = true;
          inst.frustumCulled = false;
          group.add(inst);
        });
      };
      if (kind.proc) {
        const made = L2_PROC[kind.m] ? L2_PROC[kind.m]() : kind.m === 'cone' ? makeCone() : makeWorklight();
        if (made.then) made.then(place); // un objet fait de pièces de modèles : il se charge d'abord
        else place(made);
      }
      else
        loader.load(MODELS + kind.m + '.glb', (g) => {
          let root = g.scene;
          const piece = kind.node && root.getObjectByName(kind.node);
          if (piece) {
            piece.position.set(0, 0, 0);
            root = new THREE.Group();
            root.add(piece);
          }
          place(root);
        }, undefined, () => {});
    }

    // 5a. La rubalise des chantiers : arrachée, elle traîne à plat sur la moquette en ondulant (on marche dessus)
    if (map.tapes && map.tapes.length) {
      const pos = [];
      const uv = [];
      const W2 = 0.075; // largeur du ruban
      for (const t of map.tapes) {
        const L = Math.hypot(t.x2 - t.x1, t.z2 - t.z1);
        const ux = (t.x2 - t.x1) / L;
        const uz = (t.z2 - t.z1) / L;
        const w = t.wave || { amp: 0.2, freq: 2, ph: 0 };
        const N = 28;
        const pts = [];
        let u = 0;
        for (let i = 0; i <= N; i++) {
          const f = i / N;
          // le ruban serpente de part et d'autre de la ligne droite, plus librement vers le bout arraché
          const off = Math.sin(f * w.freq * Math.PI + w.ph) * w.amp * (0.4 + f * 0.6);
          const x = t.x1 + ux * f * L - uz * off;
          const z = t.z1 + uz * f * L + ux * off;
          if (i) u += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][2]) / 0.9;
          pts.push([x, 0.006 + (i % 3) * 0.0015, z, u]);
        }
        for (let i = 0; i < N; i++) {
          const [ax, ay, az, au] = pts[i];
          const [bx, by, bz, bu] = pts[i + 1];
          // à plat : la largeur du ruban est perpendiculaire à son trajet, sur le sol
          const dx = bx - ax;
          const dz = bz - az;
          const d = Math.hypot(dx, dz) || 1;
          const px = (-dz / d) * (W2 / 2);
          const pz = (dx / d) * (W2 / 2);
          pos.push(ax - px, ay, az - pz, bx - px, by, bz - pz, bx + px, by, bz + pz, ax - px, ay, az - pz, bx + px, by, bz + pz, ax + px, ay, az + pz);
          uv.push(au, 0, bu, 0, bu, 1, au, 0, bu, 1, au, 1);
        }
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      tg.computeVertexNormals();
      const tapeMat = baked(new THREE.MeshLambertMaterial({ map: textures.tape, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      group.add(new THREE.Mesh(tg, tapeMat));
    }

    // 5b. Ce qui est fixé aux murs et au plafond : prises électriques, détecteurs incendie, boîtiers électriques,
    // horloges arrêtées, grilles d'aération. Tirés d'une graine propre à l'étage (même décor chez tout le monde).
    let ds = 1234567 + fi * 7919 + (map.level || 0) * 104729 + (map.spawn ? Math.round(map.spawn.x * 13 + map.spawn.z * 7) : 0);
    const drnd = () => ((ds = (ds * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pitCells = new Set((map.pits || []).map((p) => Math.floor(p.z / CELL_SIZE) * W + Math.floor(p.x / CELL_SIZE)));
    const stairCells = new Set((map.stairs || []).flatMap((st) => st.cells.map((k) => k.gz * W + k.gx)));
    const wallSpots = { outlet: [], fire_alarm: [], power_box_01: [], wall_clock: [], drawing: [] };
    const ceilSpots = [];
    // le plafond est percé sous les trous et les trémies de l'étage du dessus : rien n'y est fixé
    const aboveHoles = fi > 0 ? holesOf(floors[fi - 1]) : [];
    const holeAbove = (x, z) => aboveHoles.some((h) => Math.abs((x + 0.5) * CELL_SIZE - h.x) < h.hx + 0.6 && Math.abs((z + 0.5) * CELL_SIZE - h.z) < h.hz + 0.6);
    const rates = L2
      ? { outlet: 0, fire_alarm: 0, power_box_01: 0, wall_clock: 0, drawing: 0 }
      : L1
      ? { outlet: 0.02, fire_alarm: 0.01, power_box_01: 0.012, wall_clock: 0, drawing: 0 }
      : PIPES
        ? { outlet: 0.012, fire_alarm: 0.006, power_box_01: 0.008, wall_clock: 0, drawing: 0 }
        : { outlet: 0.05, fire_alarm: 0.008, power_box_01: 0.003, wall_clock: 0.004, drawing: 0.016 };
    const heights = { outlet: 0.32, fire_alarm: 2.15, power_box_01: 1.35, wall_clock: 2.25, drawing: 1.3 };
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const i = z * W + x;
        if (map.grid[i] === T.WALL || pitCells.has(i) || stairCells.has(i)) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= W || nz >= H || map.grid[nz * W + nx] !== T.WALL) continue;
          for (const k in rates) {
            if (drnd() >= rates[k]) continue;
            const along = (drnd() - 0.5) * (CELL_SIZE - 0.8);
            wallSpots[k].push({
              x: (x + 0.5) * CELL_SIZE + dx * (CELL_SIZE / 2 - 0.004) + (dz ? along : 0),
              z: (z + 0.5) * CELL_SIZE + dz * (CELL_SIZE / 2 - 0.004) + (dx ? along : 0),
              rot: Math.atan2(-dx, -dz), // l'objet regarde la pièce
            });
            break;
          }
        }
        if (!L1 && !L2 && !PIPES && drnd() < 0.045 && !holeAbove(x, z)) ceilSpots.push({ x: (x + 0.5) * CELL_SIZE + (drnd() - 0.5) * 1.2, z: (z + 0.5) * CELL_SIZE + (drnd() - 0.5) * 1.2, rot: drnd() < 0.5 ? 0 : Math.PI / 2 });
      }
    }
    // prises : une petite plaque blanche jaunie à deux trous
    if (wallSpots.outlet.length) {
      const om = baked(new THREE.MeshLambertMaterial({ map: textures.outlet }));
      const outlets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, 0.115, 0.012), om, wallSpots.outlet.length);
      wallSpots.outlet.forEach((s, i) => {
        dummy.position.set(s.x, heights.outlet, s.z);
        dummy.rotation.set(0, s.rot, 0);
        dummy.updateMatrix();
        outlets.setMatrixAt(i, dummy.matrix);
      });
      dummy.rotation.set(0, 0, 0);
      outlets.instanceMatrix.needsUpdate = true;
      group.add(outlets);
    }
    // dessins sur les murs : un des 8 de la planche, de taille et de hauteur variables, un peu de travers
    if (wallSpots.drawing.length) {
      const dm = baked(new THREE.MeshLambertMaterial({ map: textures.drawings, transparent: true, alphaTest: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      for (let d = 0; d < 8; d++) {
        const spots = wallSpots.drawing.filter((_, i) => i % 8 === (d + fi * 3) % 8);
        if (!spots.length) continue;
        const pg = new THREE.PlaneGeometry(1, 1);
        const u0 = (d % 4) / 4;
        const v0 = 1 - (Math.floor(d / 4) + 1) / 2;
        const uvs = pg.attributes.uv;
        for (let i = 0; i < uvs.count; i++) uvs.setXY(i, u0 + uvs.getX(i) / 4, v0 + uvs.getY(i) / 2);
        const inst = new THREE.InstancedMesh(pg, dm, spots.length);
        spots.forEach((s, i) => {
          const sz = 0.7 + ((i * 37 + d * 11) % 10) * 0.06;
          dummy.position.set(s.x, heights.drawing + (((i * 53 + d) % 7) - 3) * 0.1, s.z);
          dummy.rotation.set(0, s.rot, (((i * 29 + d) % 5) - 2) * 0.05);
          dummy.scale.set(sz, sz, 1);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        });
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        inst.instanceMatrix.needsUpdate = true;
        inst.frustumCulled = false;
        group.add(inst);
      }
    }
    // grilles d'aération du faux plafond
    if (ceilSpots.length) {
      const vm = baked(new THREE.MeshLambertMaterial({ map: textures.vent }));
      const vents = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.6, 0.6), vm, ceilSpots.length);
      ceilSpots.forEach((s, i) => {
        dummy.position.set(s.x, CEIL - 0.006, s.z);
        dummy.rotation.set(Math.PI / 2, 0, s.rot);
        dummy.updateMatrix();
        vents.setMatrixAt(i, dummy.matrix);
      });
      dummy.rotation.set(0, 0, 0);
      vents.instanceMatrix.needsUpdate = true;
      group.add(vents);
    }
    // modèles collés au mur (leur dos est à z = 0 et ils regardent +z)
    for (const name of ['fire_alarm', 'power_box_01', 'wall_clock']) {
      const spots = wallSpots[name];
      if (!spots.length) continue;
      loader.load(MODELS + name + '.glb', (g) => {
        const root = g.scene;
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const fix = new THREE.Matrix4().makeTranslation(0, 0, -box.min.z);
        root.traverse((o) => {
          if (!o.isMesh) return;
          const src = Array.isArray(o.material) ? o.material[0] : o.material;
          const inst = new THREE.InstancedMesh(o.geometry, propMat(src), spots.length);
          spots.forEach((s, i) => {
            const m = new THREE.Matrix4().makeTranslation(s.x, heights[name], s.z).multiply(new THREE.Matrix4().makeRotationY(s.rot)).multiply(fix);
            inst.setMatrixAt(i, m.multiply(o.matrixWorld));
          });
          inst.instanceMatrix.needsUpdate = true;
          inst.frustumCulled = false;
          group.add(inst);
        });
      }, undefined, () => {});
    }

    // 6. Les cassettes VHS de cet étage
    const cassetteGeo = new THREE.BoxGeometry(0.38, 0.22, 0.06);
    const cassetteMat = new THREE.MeshLambertMaterial({ map: textures.vhs, emissive: '#d97706', emissiveIntensity: 0.16 });
    const cassetteMeshes = [];
    for (const cas of map.cassettes || []) {
      const cg = new THREE.Group();
      cg.add(new THREE.Mesh(cassetteGeo, cassetteMat));
      cg.add(new THREE.PointLight('#f5a524', 1.1, 3.5, 1.8));
      cg.position.set(cas.x, cas.high ? NICHE_Y : 0.85, cas.z);
      group.add(cg);
      cassetteMeshes.push({ id: cas.id, cas, group: cg });
    }

    // 6a. Les casiers métalliques où l'on peut se cacher (Level 1, Tuyauteries)
    if ((map.hides || []).length) {
      const lockMat = baked(new THREE.MeshLambertMaterial({ color: PIPES ? '#6b6253' : '#55615a' }));
      const slitMat = new THREE.MeshBasicMaterial({ color: '#070707' });
      const body = new THREE.BoxGeometry(0.78, 1.95, 0.56);
      const slit = new THREE.BoxGeometry(0.42, 0.025, 0.01);
      const seam = new THREE.BoxGeometry(0.012, 1.85, 0.01);
      for (const h of map.hides) {
        const lg = new THREE.Group();
        const b = new THREE.Mesh(body, lockMat);
        b.position.y = 0.975;
        lg.add(b);
        // les fentes d'aération de la porte (on regarde dehors par là) et la jointure de la porte
        for (let i = 0; i < 5; i++) {
          const sl = new THREE.Mesh(slit, slitMat);
          sl.position.set(0, 1.42 + i * 0.065, 0.285);
          lg.add(sl);
        }
        const sm = new THREE.Mesh(seam, slitMat);
        sm.position.set(0.36, 0.975, 0.285);
        lg.add(sm);
        lg.position.set(h.x, 0, h.z);
        lg.rotation.y = h.ry;
        group.add(lg);
      }
    }

    // 6b. Le renfoncement dans le mur, la cassette posée dedans, et l'échelle une fois posée
    const N = map.niche;
    let placedLadder = null;
    const railMat = baked(new THREE.MeshLambertMaterial({ color: '#8a8f94' }));
    const makeLadder = (h) => {
      const g = new THREE.Group();
      for (const sx of [-0.22, 0.22]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), railMat);
        rail.position.set(sx, h / 2, 0);
        g.add(rail);
      }
      for (let y = 0.3; y < h - 0.1; y += 0.3) {
        const rung = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.035, 0.035), railMat);
        rung.position.set(0, y, 0);
        g.add(rung);
      }
      return g;
    };
    if (N) {
      const wx = (N.gx + 0.5) * CELL_SIZE + N.dx * (CELL_SIZE / 2 - 0.012);
      const wz = (N.gz + 0.5) * CELL_SIZE + N.dz * (CELL_SIZE / 2 - 0.012);
      const face = Math.atan2(-N.dx, -N.dz); // regarde la pièce
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.62), new THREE.MeshBasicMaterial({ color: '#0d0b07' }));
      hole.position.set(wx, NICHE_Y + 0.12, wz);
      hole.rotation.y = face;
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.28), wallMat);
      ledge.position.set(wx - N.dx * 0.12, NICHE_Y - 0.2, wz - N.dz * 0.12);
      ledge.rotation.y = face;
      group.add(hole, ledge);
      // l'échelle posée : appuyée au mur, sous le renfoncement
      placedLadder = makeLadder(2.3);
      placedLadder.position.set(N.baseX + N.dx * 0.25, 0, N.baseZ + N.dz * 0.25);
      placedLadder.rotation.set(0, face, 0);
      placedLadder.rotateX(-0.22);
      placedLadder.visible = false;
      group.add(placedLadder);
    }

    // 7. Objets au sol : eau d'amande, piles, échelle (un maillage par objet, créé à la demande)
    const itemMeshes = [];
    const glassMat = baked(new THREE.MeshLambertMaterial({ color: '#eef3f6', transparent: true, opacity: 0.6 }));
    const capMat = baked(new THREE.MeshLambertMaterial({ color: '#f2f2ee' })); // bouchon blanc, comme sur la photo
    const labelMat = baked(new THREE.MeshLambertMaterial({ map: textures.label }));
    const makeBottle = () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 12), glassMat);
      body.position.y = 0.13;
      const label = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.1, 12, 1, true), labelMat);
      label.position.y = 0.12;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.06, 10), glassMat);
      neck.position.y = 0.29;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.035, 10), capMat);
      cap.position.y = 0.335;
      g.add(body, label, neck, cap);
      return g;
    };
    const cellMat = baked(new THREE.MeshLambertMaterial({ color: '#1d1d1d' }));
    const capCopper = baked(new THREE.MeshLambertMaterial({ color: '#c98a2b', emissive: '#5a3a08', emissiveIntensity: 0.3 }));
    const makeBattery = () => {
      const g = new THREE.Group();
      for (let i = 0; i < 2; i++) {
        const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 10), cellMat);
        cell.rotation.z = Math.PI / 2;
        cell.position.set(0, 0.045, i * 0.1 - 0.05);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.07, 10), capCopper);
        top.rotation.z = Math.PI / 2;
        top.position.set(0.07, 0.045, i * 0.1 - 0.05);
        g.add(cell, top);
      }
      return g;
    };
    // l'échelle au sol : couchée
    const makeFloorLadder = () => {
      const g = new THREE.Group();
      const l = makeLadder(2.2);
      l.rotation.x = -Math.PI / 2;
      l.position.set(0, 0.04, 1.1);
      g.add(l);
      return g;
    };
    const addItemMesh = (it) => {
      const g = it.kind === 'bottle' ? makeBottle() : it.kind === 'battery' ? makeBattery() : makeFloorLadder();
      g.position.set(it.x, 0, it.z);
      g.rotation.y = it.id * 1.7;
      group.add(g);
      itemMeshes.push({ it, g });
    };
    for (const it of map.items || []) addItemMesh(it);
    // la clé de l'escalier : un trousseau sur un carton, au fond du noir ; un reflet de laiton quand la lampe passe dessus
    let keyGroup = null;
    let keyGlint = null;
    if (map.key) {
      keyGroup = new THREE.Group();
      const card = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.36), baked(new THREE.MeshLambertMaterial({ color: '#8a6a3e' })));
      card.position.y = 0.17;
      const kb = new THREE.MeshLambertMaterial({ color: '#c9a03a', emissive: '#4a3508', emissiveIntensity: 0.5 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 16), kb);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(-0.05, 0.345, 0);
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.008, 0.014), kb);
      shaft.position.set(0.035, 0.345, 0);
      const bit = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.03), kb);
      bit.position.set(0.08, 0.345, 0.012);
      const tag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.004, 0.035), new THREE.MeshLambertMaterial({ color: '#b3261e', emissive: '#300', emissiveIntensity: 0.4 }));
      tag.position.set(-0.11, 0.343, 0.02);
      tag.rotation.y = 0.4;
      const gcv = document.createElement('canvas');
      gcv.width = gcv.height = 32;
      const gg = gcv.getContext('2d');
      const ggr = gg.createRadialGradient(16, 16, 0, 16, 16, 16);
      ggr.addColorStop(0, 'rgba(255,255,255,1)');
      ggr.addColorStop(0.25, 'rgba(255,230,160,0.5)');
      ggr.addColorStop(1, 'rgba(255,200,100,0)');
      gg.fillStyle = ggr;
      gg.fillRect(0, 0, 32, 32);
      keyGlint = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gcv), color: '#ffe7a0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      keyGlint.scale.setScalar(0.22);
      keyGlint.position.set(0.02, 0.37, 0);
      keyGroup.add(card, ring, shaft, bit, tag, keyGlint);
      keyGroup.position.set(map.key.x, 0, map.key.z);
      keyGroup.rotation.y = (map.key.gx * 7 + map.key.gz) % 6;
      group.add(keyGroup);
    }

    // 8. Cages d'escalier : un puits fermé de murs, du sol de l'étage du bas au plafond de celui du haut, ouvert par une
    // baie en bas de la première volée (étage du bas) et une en haut de la seconde (étage du haut). Dehors, le papier
    // peint et la lumière cuite de l'étage ; dedans, une peinture jaunie éclairée par trois appliques (de vraies
    // lumières pour le prix d'aucune : un calcul dans le matériau). Deux volées de 16 marches de 20 cm reliées par un
    // palier à mi-hauteur, mains courantes au mur, garde-corps du côté du vide.
    const C = CELL_SIZE;
    const HALF = FLOOR_DY / 2;
    const TOP = FLOOR_DY + WALL_HEIGHT; // hauteur du puits depuis le sol du bas
    const DOOR_H = 2.4;
    const JAMB = 0.16; // le mur de part et d'autre de la baie
    const zAxis = new THREE.Vector3(0, 0, 1);
    const lowerHere = fi > 0 || floors.length === 1;
    let innerMat = null;
    const stairDoors = [];
    for (const st of map.stairs || []) {
      // repère de la cage : u le long des volées, v en travers ; y depuis le sol de cet étage
      const wx = (u, v) => st.ox + st.dx * u + st.px * v;
      const wz = (u, v) => st.oz + st.dz * u + st.pz * v;
      const box = (u, v, y, su, sy, sv, mat) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(st.dx ? su : sv, sy, st.dx ? sv : su), mat);
        m.position.set(wx(u, v), y, wz(u, v));
        group.add(m);
        return m;
      };
      // un pan de mur plat, de a à b (u, v), de y0 à y1, tourné vers n (u, v) ; le motif garde l'échelle du papier peint
      const pane = (a, b, y0, y1, n, mat) => {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.01 || y1 - y0 < 0.01) return;
        const geo = new THREE.PlaneGeometry(len, y1 - y0);
        const uv = geo.attributes.uv;
        // dedans, la peinture sur un enduit : les lés verticaux du papier, sans ses bordures haut et bas
        const flat = mat === innerMat;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / C), flat ? 0.42 + uv.getY(i) * 0.16 : y0 / WALL_HEIGHT + uv.getY(i) * ((y1 - y0) / WALL_HEIGHT));
        const m = new THREE.Mesh(geo, mat);
        m.position.set(wx((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), (y0 + y1) / 2, wz((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
        const nx = st.dx * n[0] + st.px * n[1];
        const nz = st.dz * n[0] + st.pz * n[1];
        m.rotation.y = Math.atan2(nx, nz);
        group.add(m);
      };
      // les 4 côtés du puits, à l'intérieur de la cage : [a, b, normale vers l'intérieur]
      const sides = [
        [[0, 0], [3 * C, 0], [0, 1]],
        [[3 * C, 2 * C], [0, 2 * C], [0, -1]],
        [[3 * C, 0], [3 * C, 2 * C], [-1, 0]],
        [[0, 2 * C], [0, 0], [1, 0]],
      ];
      const inset = (p, n, d) => [p[0] + n[0] * d, p[1] + n[1] * d];
      // un côté, percé d'une baie (v de b0 à b1, y de 0 à DOOR_H depuis yDoor) sur le côté u = 0
      const wallSide = (s, d, y0, y1, n, mat, door) => {
        const [a, b] = [inset(s[0], s[2], d), inset(s[1], s[2], d)];
        if (!door) return pane(a, b, y0, y1, n, mat);
        // le côté u = 0 va de v = 2C à v = 0
        const at = (v) => [a[0], v];
        const [d0, d1, dy] = door;
        pane(at(2 * C), at(d1), y0, y1, n, mat);
        pane(at(d0), at(0), y0, y1, n, mat);
        pane(at(d1), at(d0), y0, Math.max(y0, dy), n, mat);
        pane(at(d1), at(d0), Math.min(y1, dy + DOOR_H), y1, n, mat);
      };
      // les baies : en bas de la première volée (v de 0 à C), en haut de la seconde (v de C à 2C)
      const doorLow = [JAMB, C - JAMB, 0];
      const doorUp = [C + JAMB, 2 * C - JAMB, FLOOR_DY];
      // dehors : le mur au papier peint de cet étage, juste à l'intérieur de la limite des cases
      sides.forEach((s, k) => {
        const out = [-s[2][0], -s[2][1]];
        const door = k === 3 ? (lowerHere ? [doorLow[0], doorLow[1], 0] : [doorUp[0], doorUp[1], 0]) : null;
        wallSide(s, 0.012, 0, CEIL, out, wallMat, door);
      });
      // l'encadrement de la baie de cet étage : chambranle de bois peint
      const casing = baked(new THREE.MeshLambertMaterial({ color: '#7a6640' }));
      {
        const [d0, d1] = lowerHere ? doorLow : doorUp;
        box(0.0, d0 - 0.04, DOOR_H / 2, 0.06, DOOR_H, 0.08, casing);
        box(0.0, d1 + 0.04, DOOR_H / 2, 0.06, DOOR_H, 0.08, casing);
        box(0.0, (d0 + d1) / 2, DOOR_H + 0.04, 0.06, 0.08, d1 - d0 + 0.16, casing);
        // l'épaisseur du mur dans la baie (le tableau)
        box(0.05, d0 - 0.005, DOOR_H / 2, 0.1, DOOR_H, 0.01, casing);
        box(0.05, d1 + 0.005, DOOR_H / 2, 0.1, DOOR_H, 0.01, casing);
        box(0.05, (d0 + d1) / 2, DOOR_H + 0.005, 0.1, 0.01, d1 - d0, casing);
      }
      // Level 0, étage du haut : une porte coupe-feu dans la baie, fermée par une chaîne et un cadenas tant que
      // personne n'a trouvé la clé ; ensuite elle reste grande ouverte, rabattue contre le mur du couloir
      if (!lowerHere && map.key) {
        const [d0, d1] = doorUp;
        const w = d1 - d0;
        const pivot = new THREE.Group();
        pivot.position.set(wx(-0.02, d1), 0, wz(-0.02, d1));
        const base = Math.atan2(st.pz, -st.px); // le long de la porte : de la charnière (v = d1) vers v = d0
        const zs = st.pz * -st.dx + -st.px * -st.dz > 0 ? 1 : -1; // le côté du couloir, dans le repère de la porte
        const sgn = -zs; // elle s'ouvre vers le couloir
        pivot.rotation.y = base;
        const steel = baked(new THREE.MeshLambertMaterial({ color: '#6e7366' }));
        const dark = baked(new THREE.MeshLambertMaterial({ color: '#2b2c28' }));
        const brass = new THREE.MeshLambertMaterial({ color: '#b8902e', emissive: '#3a2a08', emissiveIntensity: 0.4 });
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, DOOR_H - 0.02, 0.05), steel);
        leaf.position.set(w / 2, DOOR_H / 2, 0);
        // un hublot de verre armé, la barre anti-panique côté cage, une poignée côté couloir
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.42), new THREE.MeshBasicMaterial({ color: '#2a2d26' }));
        glass.position.set(w * 0.62, 1.55, -0.027);
        glass.rotation.y = Math.PI;
        const glass2 = glass.clone();
        glass2.position.z = 0.027;
        glass2.rotation.y = 0;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.06, 0.06), dark);
        bar.position.set(w * 0.55, 1.0, -zs * 0.06);
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.05), dark);
        handle.position.set(w - 0.12, 1.0, zs * 0.05);
        // la chaîne en X sur la poignée et le chambranle, et le cadenas qui pend
        const lock = new THREE.Group();
        const chainMat = new THREE.MeshLambertMaterial({ color: '#8d8a80', emissive: '#1a1a18' });
        for (const a of [0.5, -0.5]) {
          const ch = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.025), chainMat);
          ch.position.set(w - 0.02, 1.0, zs * 0.075);
          ch.rotation.z = a;
          lock.add(ch);
        }
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.03), brass);
        body.position.set(w - 0.02, 0.86, zs * 0.085);
        const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.007, 6, 12, Math.PI), chainMat);
        shackle.position.set(w - 0.02, 0.905, zs * 0.085);
        lock.add(body, shackle);
        pivot.add(leaf, glass, glass2, bar, handle, lock);
        group.add(pivot);
        stairDoors.push({ pivot, lock, base, sgn, open: 0, map });
      }
      if (!lowerHere) continue;

      // dedans : les matériaux éclairés par les appliques du puits
      const G = group.position.y;
      const lampsUV = [
        [0.45, 0.1, 2.6], // en bas, au-dessus du départ de la première volée
        [3 * C - 0.1, C, HALF + 2.3], // au-dessus du palier
        [C * 1.0, 2 * C - 0.1, FLOOR_DY + 2.35], // en haut, près de la sortie
      ];
      const shaftU = {
        uShaftL: { value: lampsUV.map(([u, v, y]) => new THREE.Vector3(wx(u, v), G + y, wz(u, v))) },
        uShaftK: { value: 1 },
      };
      const shaftLit = (mat) => {
        mat.customProgramCacheKey = () => 'shaft';
        mat.onBeforeCompile = (sh) => {
          Object.assign(sh.uniforms, shaftU);
          sh.vertexShader = 'varying vec3 vShP;\nvarying vec3 vShN;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            vShP = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vShN = normalize(mat3(modelMatrix) * objectNormal);`);
          sh.fragmentShader = 'uniform vec3 uShaftL[3];\nuniform float uShaftK;\nvarying vec3 vShP;\nvarying vec3 vShN;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            {
              vec3 shN = normalize(vShN) * (gl_FrontFacing ? 1.0 : -1.0);
              vec3 shAcc = vec3(0.0);
              for (int i = 0; i < 3; i++) {
                vec3 d = uShaftL[i] - vShP;
                float d2 = dot(d, d);
                float ndl = max(dot(shN, d * inversesqrt(d2)), 0.0);
                shAcc += vec3(1.0, 0.9, 0.68) * (0.3 + 0.7 * ndl) / (1.0 + d2 * 0.16);
              }
              // l'ombre de contact au pied des murs et dans les coins
              totalEmissiveRadiance += diffuseColor.rgb * shAcc * uShaftK * 1.25;
            }`);
        };
        return mat;
      };
      const paint = textures.wall.clone();
      paint.needsUpdate = true;
      textures.ready.then(() => {
        paint.needsUpdate = true;
      });
      innerMat = shaftLit(new THREE.MeshLambertMaterial({ map: paint, color: '#c8bf9c' }));
      sides.slice(0, 3).forEach((s) => wallSide(s, 0.07, 0, TOP, s[2], innerMat, null));
      // le côté des baies, dedans : deux baies l'une au-dessus de l'autre (en haut à gauche, en bas à droite)
      {
        const s = sides[3];
        const a = inset(s[0], s[2], 0.07);
        const at = (v) => [a[0], v];
        const n = s[2];
        pane(at(2 * C), at(doorUp[1]), 0, TOP, n, innerMat);
        pane(at(doorUp[1]), at(doorUp[0]), 0, FLOOR_DY, n, innerMat);
        pane(at(doorUp[1]), at(doorUp[0]), FLOOR_DY + DOOR_H, TOP, n, innerMat);
        pane(at(doorUp[0]), at(doorLow[1]), 0, TOP, n, innerMat);
        pane(at(doorLow[1]), at(doorLow[0]), DOOR_H, TOP, n, innerMat);
        pane(at(doorLow[0]), at(0), 0, TOP, n, innerMat);
      }
      // le plafond du puits
      const ceilShaft = new THREE.Mesh(new THREE.PlaneGeometry(st.dx ? 3 * C : 2 * C, st.dx ? 2 * C : 3 * C), shaftLit(new THREE.MeshLambertMaterial({ color: '#a59d86' })));
      ceilShaft.rotation.x = Math.PI / 2;
      ceilShaft.position.set(wx(1.5 * C, C), TOP - 0.03, wz(1.5 * C, C));
      group.add(ceilShaft);

      // les marches : giron de béton peint, contremarche plus claire, nez de marche antidérapant
      const tread = shaftLit(new THREE.MeshLambertMaterial({ color: '#7d725a' }));
      const riser = shaftLit(new THREE.MeshLambertMaterial({ color: '#9a8f72' }));
      const nose = shaftLit(new THREE.MeshLambertMaterial({ color: '#3d3a32' }));
      const metal = shaftLit(new THREE.MeshLambertMaterial({ color: '#4a4740' }));
      const stepMats = [riser, riser, tread, riser, riser, riser];
      const n = 16;
      const run = (2 * C) / n;
      const WL = C - 0.14; // largeur d'une volée, entre le mur et le garde-corps
      for (let i = 0; i < n; i++) {
        const hA = ((i + 1) * HALF) / n;
        box((i + 0.5) * run, C / 2, hA / 2, run, hA, WL, stepMats);
        box((i + 0.05) * run, C / 2, hA + 0.004, run * 0.1, 0.012, WL, nose);
        const hB = HALF + hA;
        box(2 * C - (i + 0.5) * run, 1.5 * C, hB / 2, run, hB, WL, stepMats);
        box(2 * C - (i + 0.05) * run, 1.5 * C, hB + 0.004, run * 0.1, 0.012, WL, nose);
      }
      // le palier, à mi-hauteur, et le muret qui sépare les deux volées sous la seconde
      box(2.5 * C - 0.035, C, HALF / 2, C - 0.07, HALF, 2 * C - 0.14, stepMats);
      box(C, C, HALF / 2, 2 * C, HALF, 0.14, riser);

      // une barre entre deux points (u, v, y)
      const bar = (a, b, th, mat) => {
        const A = new THREE.Vector3(wx(a[0], a[1]), a[2], wz(a[0], a[1]));
        const B = new THREE.Vector3(wx(b[0], b[1]), b[2], wz(b[0], b[1]));
        const d = B.clone().sub(A);
        const m = new THREE.Mesh(new THREE.BoxGeometry(th, th, d.length()), mat);
        m.position.copy(A).add(B).multiplyScalar(0.5);
        m.quaternion.setFromUnitVectors(zAxis, d.normalize());
        group.add(m);
      };
      // main courante fixée au mur, à 8 cm de lui (w : vers le mur, en u, v), consoles tous les ~1,2 m
      const wallRail = (a, b, w) => {
        bar([a[0], a[1], a[2] + 0.9], [b[0], b[1], b[2] + 0.9], 0.045, metal);
        const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 1.2));
        for (let j = 0; j <= k; j++) {
          const f = j / k;
          const u = a[0] + (b[0] - a[0]) * f;
          const v = a[1] + (b[1] - a[1]) * f;
          const y = a[2] + (b[2] - a[2]) * f + 0.88;
          bar([u, v, y], [u + w[0] * 0.08, v + w[1] * 0.08, y], 0.025, metal);
        }
      };
      // garde-corps du côté du vide : main courante, lisse et barreaux
      const guard = (a, b) => {
        bar([a[0], a[1], a[2] + 1.0], [b[0], b[1], b[2] + 1.0], 0.05, metal);
        bar([a[0], a[1], a[2] + 0.12], [b[0], b[1], b[2] + 0.12], 0.04, metal);
        const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.13));
        for (let j = 0; j <= k; j++) {
          const f = j / k;
          const y = a[2] + (b[2] - a[2]) * f;
          box(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, y + 0.56, 0.018, 0.88, 0.018, metal);
        }
      };
      const wv = 0.07 + 0.08; // à 8 cm du mur intérieur
      wallRail([0.3, wv, 0.3 * HALF / (2 * C)], [2 * C, wv, HALF], [0, -1]);
      wallRail([2 * C, 2 * C - wv, HALF], [0.3, 2 * C - wv, FLOOR_DY - 0.3 * HALF / (2 * C)], [0, 1]);
      wallRail([2 * C + 0.1, wv, HALF], [3 * C - wv, wv, HALF], [0, -1]);
      wallRail([3 * C - wv, wv + 0.1, HALF], [3 * C - wv, 2 * C - wv - 0.1, HALF], [1, 0]);
      wallRail([3 * C - wv - 0.1, 2 * C - wv, HALF], [2 * C, 2 * C - wv, HALF], [0, 1]);
      // la seconde volée surplombe la première : un garde-corps sur son bord, du palier à l'étage du haut
      guard([2 * C, C + 0.04, HALF], [0, C + 0.04, FLOOR_DY]);

      // les appliques : un hublot de verre dépoli dans une cage, sur une platine
      const glassOn = new THREE.Color('#fff2cc').multiplyScalar(2.6);
      const glassMat = new THREE.MeshBasicMaterial({ color: glassOn });
      const plateMat = shaftLit(new THREE.MeshLambertMaterial({ color: '#2f2d29' }));
      const shaftLamps = [];
      for (const [u, v, y] of lampsUV) {
        // vers l'intérieur du puits depuis le mur où elle est fixée
        const inU = u > 2.5 * C ? -1 : 0;
        const inV = v < 0.5 ? 1 : v > 2 * C - 0.5 ? -1 : 0;
        const g = new THREE.Group();
        g.position.set(wx(u + inU * -0.03, v + inV * -0.03), y, wz(u + inU * -0.03, v + inV * -0.03));
        g.rotation.y = Math.atan2(st.dx * inU + st.px * inV, st.dz * inU + st.pz * inV);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.03), plateMat);
        const glass = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), glassMat);
        glass.scale.set(0.85, 1.15, 0.55);
        glass.position.z = 0.06;
        g.add(plate, glass);
        for (const yy of [-0.06, 0, 0.06]) {
          const cage = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.006, 4, 16, Math.PI), plateMat);
          cage.position.set(0, yy, 0.02);
          cage.rotation.set(Math.PI / 2, 0, 0);
          cage.scale.set(0.95, 1, 1 - Math.abs(yy) * 3);
          g.add(cage);
        }
        group.add(g);
        shaftLamps.push(glass);
      }
      shaftViews.push({ u: shaftU, glassMat, glassOn });
    }

    // 9. Level 1 : l'habillage de l'entrepôt (rayonnages à palettes, marchandises, tuyaux, lignes au sol, piliers, panneaux)
    if (L1) buildWarehouse({ map, group, baked, CEIL });
    // 9b. Level 2 : tuyauteries, lampes grillagées, grilles, chaudières, vannes et vapeur
    const pipesView = PIPES ? buildPipes({ map, group, baked, CEIL, tx: tx2, camera }) : null;
    if (pipesView) pipesView.setFog(scene.fog);

    // 10. Fusibles (Level 1) : un gros fusible céramique aux bouts de cuivre, lueur ambrée
    const fuseMeshes = [];
    const fuseBody = new THREE.MeshLambertMaterial({ color: '#efe9dc', emissive: '#4a3a20', emissiveIntensity: 0.22 });
    const fuseCap = new THREE.MeshLambertMaterial({ color: '#c98a2b', emissive: '#7a4a10', emissiveIntensity: 0.32 });
    const valveMat = new THREE.MeshLambertMaterial({ color: '#c0261d', emissive: '#4a0c08', emissiveIntensity: 0.3 });
    for (const f of map.fuses || []) {
      if (L2) {
        // un volant de vanne rouge : la jante, quatre rayons, le moyeu
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 24), valveMat));
        for (let k = 0; k < 2; k++) {
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.025), valveMat);
          spoke.rotation.z = (k * Math.PI) / 2;
          g.add(spoke);
        }
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12).rotateX(Math.PI / 2), valveMat));
        g.add(new THREE.PointLight('#ff5a3c', 0.9, 3, 1.8));
        g.position.set(f.x, 0.9, f.z);
        group.add(g);
        fuseMeshes.push({ f, g });
        continue;
      }
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 12), fuseBody);
      body.rotation.z = Math.PI / 2;
      const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 12), fuseCap);
      c1.rotation.z = Math.PI / 2;
      c1.position.x = 0.15;
      const c2 = c1.clone();
      c2.position.x = -0.15;
      g.add(body, c1, c2, new THREE.PointLight('#ffb347', 1.1, 3.2, 1.8));
      g.position.set(f.x, 0.9, f.z);
      group.add(g);
      fuseMeshes.push({ f, g });
    }

    // 11. Brouillard froid au ras du sol (Level 1) : deux nappes qui glissent lentement et suivent la caméra
    const fogLayers = [];
    if (L1 || L2) {
      for (const [y, o, rep, sp] of L2 ? [[0.06, 0.32, 8, 0.01], [0.32, 0.16, 5, -0.006]] : [[0.15, 0.55, 9, 0.012], [0.5, 0.3, 6, -0.008]]) {
        const t = textures.fog.clone();
        t.needsUpdate = true;
        t.repeat.set(rep, rep);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshBasicMaterial({ map: t, color: L2 ? '#f3fbfa' : '#3e4850', transparent: true, opacity: o, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.y = y;
        m.renderOrder = 2;
        group.add(m);
        fogLayers.push({ m, t, o, sp, rep });
      }
    }

    // 12. L'ascenseur (monte-charge au Level 1) : cabine creusée dans le mur, portes coulissantes, voyant rouge ou vert.
    // Au Level 0, le faux ascenseur se referme en mur jaune une fois les cassettes trouvées.
    const E = map.elevator;
    const signMat = new THREE.MeshBasicMaterial({ color: '#ff3030' });
    const callMat = new THREE.MeshBasicMaterial({ color: '#ffb347' }); // les boutons d'appel
    const fuseLamps = [];
    // un ascenseur : celui de la sortie, ou (Level 1) celui d'où l'on vient d'arriver, le même modèle
    const buildLift = (E, arrival) => {
      const exitGroup = new THREE.Group();
      const doors = [];
      const sMat = arrival ? new THREE.MeshBasicMaterial({ color: '#ffb020' }) : signMat;
      const cMat = arrival ? new THREE.MeshBasicMaterial({ color: '#c2701c' }) : callMat;
      // repère local : -z regarde le couloir, la cabine est vers +z ; la façade est au ras des murs voisins (z = 0)
      const at = new THREE.Group();
      at.position.set(E.x - E.dx * (CELL_SIZE / 2), 0, E.z - E.dz * (CELL_SIZE / 2));
      at.rotation.y = Math.atan2(E.dx, E.dz);
      at.add(exitGroup);
      group.add(at);
      const DW = 1.2; // largeur de la baie
      const DH = 2.25;
      const FW = 0.11; // largeur du cadre d'inox
      const ZD = 0.17; // les portes, en retrait derrière le cadre
      // la façade : des pans plats au papier peint, à la même échelle que les murs voisins (pas de pan écrasé)
      const facade = (x0, x1, y0, y1) => {
        const geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (x0 + CELL_SIZE / 2 + uv.getX(i) * (x1 - x0)) / CELL_SIZE, (y0 + uv.getY(i) * (y1 - y0)) / CEIL);
        const m = new THREE.Mesh(geo, wallMat);
        m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
        m.rotation.y = Math.PI; // tournée vers le couloir (-z)
        exitGroup.add(m);
      };
      const XF = DW / 2 + FW - 0.01; // la façade s'arrête sous le cadre (aucune face confondue avec lui)
      facade(-CELL_SIZE / 2, -XF, 0, CEIL);
      facade(XF, CELL_SIZE / 2, 0, CEIL);
      facade(-XF, XF, DH + FW - 0.01, CEIL);
      // le cadre d'inox brossé, en saillie de 3,5 cm sur la façade, jusqu'aux portes
      const inox = baked(new THREE.MeshPhongMaterial({ color: '#8f959b', specular: '#4a4d50', shininess: 38 }));
      const frameBox = (w, h, x, y) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, ZD + 0.035), inox);
        m.position.set(x, y, (ZD - 0.035) / 2);
        exitGroup.add(m);
      };
      frameBox(FW, DH + FW, -DW / 2 - FW / 2, (DH + FW) / 2);
      frameBox(FW, DH + FW, DW / 2 + FW / 2, (DH + FW) / 2);
      frameBox(DW, FW, 0, DH + FW / 2);
      // le seuil d'aluminium strié
      const sill = new THREE.Mesh(new THREE.BoxGeometry(DW + 2 * FW, 0.012, ZD + 0.06), baked(new THREE.MeshLambertMaterial({ color: '#7d7f80' })));
      sill.position.set(0, 0.006, (ZD - 0.06) / 2 + 0.005);
      exitGroup.add(sill);
      // les deux vantaux d'inox brossé, un joint sombre entre eux ; ils s'effacent derrière la façade
      const steel = textures.steel.clone();
      steel.needsUpdate = true;
      textures.ready.then(() => {
        steel.needsUpdate = true;
      });
      const leafMat = baked(new THREE.MeshPhongMaterial({ map: steel, color: '#c9ced3', specular: '#5a5d60', shininess: 30 }));
      for (const sgn of [-1, 1]) {
        const d = new THREE.Mesh(new THREE.BoxGeometry(DW / 2 - 0.004, DH, 0.035), leafMat);
        d.position.set(sgn * (DW / 4), DH / 2, ZD + 0.02);
        exitGroup.add(d);
        doors.push({ d, sgn });
      }
      // la cabine, vue de l'intérieur : parois d'inox, sol de caoutchouc, plafonnier, main courante
      const CW = CELL_SIZE - 0.12;
      const CD = CELL_SIZE - ZD - 0.12;
      const CZ = ZD + 0.04 + CD / 2;
      const cabMat = new THREE.MeshLambertMaterial({ map: steel, color: '#b3b8bc', emissive: '#2e3134', emissiveIntensity: 0.6 });
      const cabPane = (w, h, x, y, z, ry, mat) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
        m.position.set(x, y, z);
        m.rotation.y = ry;
        exitGroup.add(m);
        return m;
      };
      cabPane(CW, 2.6, 0, 1.3, CZ + CD / 2, Math.PI, cabMat);
      cabPane(CD, 2.6, -CW / 2, 1.3, CZ, Math.PI / 2, cabMat);
      cabPane(CD, 2.6, CW / 2, 1.3, CZ, -Math.PI / 2, cabMat);
      // le mur au-dessus de la baie, vu de la cabine
      cabPane(CW, 2.6 - DH, 0, DH + (2.6 - DH) / 2, ZD + 0.04, 0, cabMat);
      const cabFloor = new THREE.Mesh(new THREE.PlaneGeometry(CW, CD), new THREE.MeshLambertMaterial({ color: '#2b2a28' }));
      cabFloor.rotation.x = -Math.PI / 2;
      cabFloor.position.set(0, 0.004, CZ);
      const cabCeil = new THREE.Mesh(new THREE.PlaneGeometry(CW, CD), new THREE.MeshLambertMaterial({ color: '#6c6e70' }));
      cabCeil.rotation.x = Math.PI / 2;
      cabCeil.position.set(0, 2.6, CZ);
      const cabLamp = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff6dc').multiplyScalar(2.2) }));
      cabLamp.rotation.x = Math.PI / 2;
      cabLamp.position.set(0, 2.595, CZ);
      const handrail = new THREE.Mesh(new THREE.BoxGeometry(CW - 0.3, 0.04, 0.04), inox);
      handrail.position.set(0, 0.92, CZ + CD / 2 - 0.06);
      exitGroup.add(cabFloor, cabCeil, cabLamp, handrail);
      if (!arrival) {
        const cabinLight = new THREE.PointLight('#f4f1e0', 2.5, 4, 1.5);
        cabinLight.position.set(0, 2.4, CZ);
        exitGroup.add(cabinLight);
      }
      // l'indicateur au-dessus des portes : un boîtier d'inox et sa vitre dépolie (flèches rouges, vertes une fois ouvert)
      const ind = document.createElement('canvas');
      ind.width = 128;
      ind.height = 48;
      const g = ind.getContext('2d');
      g.fillStyle = '#000';
      g.fillRect(0, 0, 128, 48);
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(34, 10);
      g.lineTo(50, 36);
      g.lineTo(18, 36);
      g.fill();
      g.beginPath();
      g.moveTo(94, 38);
      g.lineTo(110, 12);
      g.lineTo(78, 12);
      g.fill();
      const indTex = new THREE.CanvasTexture(ind);
      indTex.colorSpace = THREE.SRGBColorSpace;
      sMat.map = indTex;
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.17, 0.05), inox);
      housing.position.set(0, DH + FW + 0.2, -0.025);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.12), sMat);
      sign.position.set(0, DH + FW + 0.2, -0.051);
      sign.rotation.y = Math.PI;
      exitGroup.add(housing, sign);
      // la boîte à boutons (au Level 1 : le panneau aux 3 fusibles)
      if ((L1 || L2) && !arrival) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.6, 0.08), baked(new THREE.MeshLambertMaterial({ color: '#3b4a2f' })));
        panel.position.set(DW / 2 + FW + 0.3, 1.3, -0.04);
        exitGroup.add(panel);
        for (let i = 0; i < FUSES; i++) {
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.03), new THREE.MeshBasicMaterial({ color: '#331010' }));
          lamp.position.set(DW / 2 + FW + 0.3, 1.45 - i * 0.15, -0.09);
          exitGroup.add(lamp);
          fuseLamps.push(lamp);
        }
      } else {
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.26, 0.012), inox);
        plate.position.set(DW / 2 + FW + 0.22, 1.12, -0.006);
        exitGroup.add(plate);
        for (const [y, i] of [[1.17, 0], [1.07, 1]]) {
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 16), cMat);
          b.rotation.x = Math.PI / 2;
          b.position.set(DW / 2 + FW + 0.22, y, -0.018);
          exitGroup.add(b);
        }
      }
      // le mur qui prend sa place s'il est faux
      if (arrival) return { exitGroup, doors, fakeWall: null, open: 1 };
      const fakeWall = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE, CEIL, 0.14), wallMat);
      fakeWall.position.set(0, CEIL / 2, 0.07);
      fakeWall.visible = false;
      at.add(fakeWall);
      return { exitGroup, doors, fakeWall };
    };
    const lift = E ? buildLift(E, false) : null;
    const exitGroup = lift ? lift.exitGroup : new THREE.Group();
    const doors = lift ? lift.doors : [];
    const fakeWall = lift ? lift.fakeWall : null;
    // Level 1 : l'ascenseur d'arrivée, portes ouvertes, qui se referment derrière les joueurs
    const arrivalLift = map.arrival ? buildLift(map.arrival, true) : null;
    let arrivalT = 0;
    // la lueur du voyant sur le couloir : discrète (elle ne teint plus tout le couloir en rouge)
    const exitLight = new THREE.PointLight('#ff2020', 1, 5, 1.8);
    exitLight.position.set(map.exit.x - (E ? E.dx : 0) * 1.6, 2.5, map.exit.z - (E ? E.dz : 0) * 1.6);
    group.add(exitLight);
    let doorOpen = 0;

    let lit = true;
    let powerFlick = 0;
    let flickT = 0;
    const setPower = (v) => {
      if (v === power) return;
      power = v;
      ambient.intensity = v ? AMB : 0;
      for (const l of map.lights) {
        fixColor(l, power && l.state !== 'off');
        l.k = power && l.state !== 'off' ? 1 : 0;
      }
      fixDirty();
      writeBake();
      for (const sv of shaftViews) {
        sv.u.uShaftK.value = v ? 1 : 0.04;
        sv.glassMat.color.copy(v ? sv.glassOn : new THREE.Color('#3a3528'));
      }
    };

    // --- Recoins calmes (Level 0) : une lampe de salon chaude, un vieux fauteuil, une radio. Rien d'éclairé pour de vrai
    // (pas de lumière en plus : tous les matériaux se recompileraient) ; la chaleur est dans les matériaux et un halo.
    // Quand le recoin s'use, la lampe grésille puis s'éteint
    const nooks = [];
    if (L0 && map.calm && map.calm.length) {
      const glowTex = (() => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 64;
        const g = cv.getContext('2d');
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,214,150,1)');
        gr.addColorStop(0.35, 'rgba(255,170,90,0.45)');
        gr.addColorStop(1, 'rgba(255,140,60,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      const warm = new THREE.Color('#ffb36b');
      for (const n of map.calm) {
        const g = new THREE.Group();
        // le fond du cul-de-sac : (dx, dz) pointe vers le mur du fond ; (sx, sz) sur le côté
        const sx = -n.dz;
        const sz = n.dx;
        const mats = [];
        const mat = (color, k = 0.3) => {
          const m = new THREE.MeshLambertMaterial({ color, emissive: warm.clone().multiplyScalar(k) });
          m.userData.k = k;
          mats.push(m);
          return m;
        };
        // la lampe, dans un coin du fond
        const lx = n.x + n.dx * 0.85 + sx * 0.75;
        const lz = n.z + n.dz * 0.85 + sz * 0.75;
        const metal = mat('#2b2620', 0.08);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 16), metal);
        base.position.set(lx, 0.015, lz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.45, 8), metal);
        pole.position.set(lx, 0.74, lz);
        const shadeMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', side: THREE.DoubleSide });
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.26, 0.3, 20, 1, true), shadeMat);
        shade.position.set(lx, 1.52, lz);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.32 }));
        glow.position.set(lx, 1.5, lz);
        glow.scale.set(1.5, 1.5, 1);
        // la flaque de lumière chaude au sol
        const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.22 });
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), poolMat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(lx - n.dx * 0.6, 0.012, lz - n.dz * 0.6);
        // le fauteuil, tourné vers l'entrée, à côté de la lampe
        const cx = n.x + n.dx * 0.55 - sx * 0.45;
        const cz = n.z + n.dz * 0.55 - sz * 0.45;
        const chair = new THREE.Group();
        const fabric = mat('#4a1f18', 0.14);
        const wood = mat('#2a1a0e', 0.1);
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.2, 0.7), fabric);
        seat.position.y = 0.42;
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.7, 0.16), fabric);
        back.position.set(0, 0.8, 0.29);
        back.rotation.x = -0.12;
        const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.24, 0.68), fabric);
        armL.position.set(0.39, 0.6, 0.02);
        const armR = armL.clone();
        armR.position.x = -0.39;
        chair.add(seat, back, armL, armR);
        for (const [ax, az] of [[0.33, 0.28], [-0.33, 0.28], [0.33, -0.28], [-0.33, -0.28]]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.06), wood);
          leg.position.set(ax, 0.16, az);
          chair.add(leg);
        }
        chair.position.set(cx, 0, cz);
        chair.rotation.y = Math.atan2(n.dx, n.dz) + 0.35; // le dos au mur du fond, un peu de biais
        // la radio, par terre au pied de la lampe : son cadran luit
        const radio = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.16), wood);
        box.position.y = 0.12;
        const dialMat = new THREE.MeshBasicMaterial({ color: '#ffcc66' });
        const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.05), dialMat);
        dial.position.set(0.08, 0.16, -0.081);
        dial.rotation.y = Math.PI;
        radio.add(box, dial);
        radio.position.set(lx - sx * 0.45 - n.dx * 0.1, 0, lz - sz * 0.45 - n.dz * 0.1);
        radio.rotation.y = Math.atan2(n.dx, n.dz);
        g.add(base, pole, shade, glow, pool, chair, radio);
        group.add(g);
        nooks.push({ n, shadeMat, glow, poolMat, dialMat, mats, on: 1 });
      }
    }
    const updateNooks = (time) => {
      for (const v of nooks) {
        const w = v.n.wear || 0;
        // usé : la lampe grésille de plus en plus, puis s'éteint presque tout à fait
        let on = 1;
        if (w >= 1) on = Math.random() < 0.04 ? 0.6 : 0.05;
        else if (w > 0.75) on = Math.random() < (w - 0.75) * 0.5 ? 0.25 : 1;
        v.on += (on - v.on) * 0.5;
        v.shadeMat.color.setRGB(1 * v.on + 0.12, 0.85 * v.on + 0.1, 0.63 * v.on + 0.08);
        v.glow.material.opacity = 0.32 * v.on;
        v.poolMat.opacity = 0.22 * v.on;
        v.dialMat.color.setRGB(1 * Math.max(0.2, v.on), 0.8 * Math.max(0.2, v.on), 0.4 * Math.max(0.2, v.on));
        for (const m of v.mats) m.emissive.setRGB(1, 0.7, 0.42).multiplyScalar(m.userData.k * v.on);
      }
    };

    return {
      lightAt,
      // une image : objets, cassettes, ascenseur, néons de cet étage
      nooks,
      update(sim, P, time, dt) {
        bakeUniforms.uTime.value = time;
        if (nooks.length) updateNooks(time);
        if (water) {
          water.update(sim, P, time, dt, camera);
          bakeUniforms.uWaterY.value = water.level;
        }

        // Coupure de courant : les néons meurent d'un coup, puis reviennent en grésillant
        const want = !(sim.blackout > 0);
        if (want !== lit) {
          lit = want;
          powerFlick = want ? 0.9 : 0;
          setPower(want ? 1 : 0);
        }
        if (powerFlick > 0) {
          powerFlick -= dt;
          setPower(powerFlick <= 0 || Math.random() < 0.55 ? 1 : 0);
        }

        // Level 2 : un secteur dont les néons ont sauté (ou que son disjoncteur a rallumé)
        if ((map.lightGen || 0) !== lightGen) {
          lightGen = map.lightGen || 0;
          sumLights();
          for (const l of map.lights) {
            l.k = l.state !== 'off' ? 1 : 0;
            fixColor(l, power && l.state !== 'off');
          }
          fixDirty();
          writeBake();
        }

        // Cassettes et objets
        for (const cm of cassetteMeshes) {
          const here = !cm.cas.collected;
          showGroup(cm.group, here);
          if (here && cm.cas.high) {
            // dans le renfoncement : elle ne tourne pas, elle regarde la pièce
            cm.group.rotation.y = Math.atan2(-N.dx, -N.dz);
          } else if (here) {
            cm.group.rotation.y = time * 1.6;
            cm.group.position.y = 0.85 + Math.sin(time * 2.5 + cm.id) * 0.08;
          }
        }
        // objets au sol (ceux qu'un échange a posés apparaissent)
        const items = map.items || [];
        for (let i = itemMeshes.length; i < items.length; i++) addItemMesh(items[i]);
        for (const im of itemMeshes) im.g.visible = !im.it.taken;
        // la clé, puis la porte de l'escalier qui s'ouvre (vite, d'un coup de pied) une fois la clé trouvée
        if (keyGroup) {
          keyGroup.visible = !map.key.taken;
          if (keyGlint && keyGroup.visible) {
            const dx = map.key.x - P.x;
            const dz = map.key.z - P.z;
            const d = Math.hypot(dx, dz);
            let off = Math.atan2(-dx, -dz) - P.yaw;
            off = Math.atan2(Math.sin(off), Math.cos(off));
            const inBeam = P.flashlight && (P.floor || 0) === fi && d < 16 && Math.abs(off) < 0.3;
            keyGlint.material.opacity = inBeam ? 0.55 + 0.35 * Math.sin(time * 9) * Math.sin(time * 3.7) : 0.06;
          }
        }
        for (const D of stairDoors) {
          const want = D.map.key && !D.map.key.taken ? 0 : 1;
          D.open += Math.sign(want - D.open) * Math.min(Math.abs(want - D.open), dt / 0.7);
          D.lock.visible = D.open < 0.05;
          D.pivot.rotation.y = D.base + D.sgn * (1 - Math.pow(1 - D.open, 3)) * 1.75;
        }
        if (placedLadder) placedLadder.visible = !!(N && N.ladder);

        // Ascenseur : rouge verrouillé, vert ouvert ; le faux devient un mur
        const fake = !!(E && E.fake);
        const open = sim.open && !fake;
        showGroup(exitGroup, !fake);
        if (fakeWall) fakeWall.visible = fake;
        exitLight.color.set(open ? '#22c55e' : '#ef4444');
        exitLight.intensity = fake || !E ? 0 : open ? 3 : 1; // aux Poolrooms, pas d'ascenseur : les toboggans
        signMat.color.set(open ? '#4ade80' : '#ff3030');
        callMat.color.set(open ? '#f4f1e0' : '#c2701c');
        // les portes s'ouvrent quand l'ascenseur est alimenté, se referment au départ
        const doorWant = open && !(sim.departT > 0) ? 1 : 0;
        doorOpen += Math.sign(doorWant - doorOpen) * Math.min(Math.abs(doorWant - doorOpen), dt / 1.2);
        for (const { d, sgn } of doors) d.position.x = sgn * (0.3 + doorOpen * 0.6);
        if (arrivalLift) {
          // ouvertes à l'arrivée ; elles se referment pour de bon une fois qu'on a fait quelques pas dehors
          arrivalT += dt;
          const A = map.arrival;
          if (arrivalT > 1.5 && Math.hypot(P.x - A.x, P.z - A.z) > 3.4) arrivalLift.done = true;
          const want = arrivalLift.done ? 0 : 1;
          arrivalLift.open += Math.sign(want - arrivalLift.open) * Math.min(Math.abs(want - arrivalLift.open), dt / 1.4);
          for (const { d, sgn } of arrivalLift.doors) d.position.x = sgn * (0.3 + arrivalLift.open * 0.6);
        }
        fuseLamps.forEach((l, i) => l.material.color.set(sim.powered ? '#22c55e' : i < sim.fuses ? '#ffb020' : '#331010'));
        for (const fm of fuseMeshes) {
          showGroup(fm.g, !fm.f.taken);
          if (!fm.f.taken) {
            fm.g.rotation.y = time * 1.4;
            fm.g.position.y = 0.9 + Math.sin(time * 2.2 + fm.f.id) * 0.07;
          }
        }
        // nappes de brouillard : elles suivent la caméra et pâlissent dans le noir
        for (const L of fogLayers) {
          L.m.position.x = P.x;
          L.m.position.z = P.z;
          L.t.offset.set((P.x / 70) * L.rep + time * L.sp, (-P.z / 70) * L.rep + time * L.sp * 0.6);
          L.m.material.opacity = L.o * (power ? 1 : 0.1);
        }

        // Level 2 : les lampes qui se reflètent dans le carrelage et le sol ciré (les plus proches que l'on voit)
        if (PIPES) {
          const cand = [];
          for (const l of map.lights) {
            const k = power && l.state !== 'off' ? (l.k ?? 1) : 0;
            if (k <= 0) continue;
            const d = Math.abs(l.x - P.x) + Math.abs(l.z - P.z);
            if (d < 32) cand.push([d, l, k]);
          }
          cand.sort((a, b) => a[0] - b[0]);
          let n = 0;
          for (const [d, l, k] of cand) {
            if (n >= NLAMP) break;
            if (d > 4 && !hasLineOfSight(map, P.x, P.z, l.x, l.z)) continue;
            lampU.uLampPos.value[n].set(l.x, l.y + group.position.y, l.z);
            if (l.kind === 'tube') lampU.uLampCol.value[n].set(0.75, 0.88, 1.0).multiplyScalar(k);
            else lampU.uLampCol.value[n].set(1.0, 0.7, 0.4).multiplyScalar(1.5 * k);
            n++;
          }
          for (; n < NLAMP; n++) lampU.uLampCol.value[n].set(0, 0, 0);
        }
        if (pipesView) pipesView.update(sim, P, time, dt, lightAt, P.flashlight && P.status === 'alive');

        // Néons qui grésillent (une quinzaine de fois par seconde)
        flickT -= dt;
        if (flickT <= 0 && flickers.length && power && powerFlick <= 0) {
          flickT = 1 / 15;
          let changed = false;
          for (const f of flickers) {
            // un tube fatigué : allumé longtemps, puis une rafale de claquements (0,2 à 0,9 s), parfois éteint un moment
            let k = f.k;
            if (f.burst > 0) {
              f.burst -= 1 / 15;
              k = Math.random() < 0.5 ? 0 : 0.55 + Math.random() * 0.45;
              if (f.burst <= 0) {
                f.calm = 1.2 + Math.random() * 5;
                k = Math.random() < 0.18 ? 0 : 1; // parfois il reste éteint jusqu'à la prochaine rafale
              }
            } else {
              f.calm -= 1 / 15;
              if (f.calm <= 0) f.burst = 0.2 + Math.random() * 0.7;
            }
            if (k !== f.k) {
              f.k = k;
              f.l.k = k;
              fixColor(f.l, k > 0);
              changed = true;
            }
          }
          if (changed) {
            fixDirty();
            writeBake();
          }
        }
      },
    };
  }
  const floorViews = floors.map((m, fi) => buildFloor(m, fi));

  // Lampe torche du joueur (attachée à la caméra)
  // un faisceau serré au bord très doux, et un halo large et faible autour (comme une vraie torche) : pas de disque net
  const flashLight = new THREE.SpotLight('#fff1d0', 17, 24, Math.PI / 8, 0.85, 1.5);
  flashLight.position.set(0.15, -0.12, 0);
  camera.add(flashLight);
  const flashSpill = new THREE.SpotLight('#ffe9c4', 4, 14, Math.PI / 4.2, 1, 1.8);
  flashSpill.position.set(0.15, -0.12, 0);
  camera.add(flashSpill);
  const flashTarget = new THREE.Object3D();
  flashTarget.position.set(0, -0.2, -5);
  camera.add(flashTarget);
  flashLight.target = flashTarget;
  flashSpill.target = flashTarget;
  scene.add(camera);

  // Ce que l'on tient devant soi : la lampe torche dans la main droite, et dans la main gauche l'objet de la case
  // choisie (eau d'amande ou piles ; l'échelle, trop grande, reste dans le sac). Ils suivent la caméra et prennent
  // la lumière d'où l'on est (néons autour, lampe allumée).
  const held = new THREE.Group();
  camera.add(held);
  const heldMats = [];
  const hmat = (opts) => {
    const m = new THREE.MeshBasicMaterial(opts);
    m.userData.base = m.color.clone();
    heldMats.push(m);
    return m;
  };
  const along = (geo) => geo.rotateX(Math.PI / 2); // un cylindre couché dans l'axe du regard
  // la lampe : corps noir strié, tête chromée, verre qui s'allume
  const heldLamp = new THREE.Group();
  const lampBody = hmat({ color: '#2a2b2e' });
  const lampRing = hmat({ color: '#5d6066' });
  heldLamp.add(new THREE.Mesh(along(new THREE.CylinderGeometry(0.021, 0.021, 0.19, 14)), lampBody));
  for (const z of [-0.03, 0, 0.03]) {
    const grip = new THREE.Mesh(along(new THREE.CylinderGeometry(0.0225, 0.0225, 0.012, 14)), lampRing);
    grip.position.z = z + 0.02;
    heldLamp.add(grip);
  }
  const lampHead = new THREE.Mesh(along(new THREE.CylinderGeometry(0.034, 0.024, 0.055, 16)), lampRing);
  lampHead.position.z = -0.12;
  heldLamp.add(lampHead);
  const lensMat = new THREE.MeshBasicMaterial({ color: '#2c2b26' });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.031, 16), lensMat);
  lens.position.z = -0.148;
  heldLamp.add(lens);
  heldLamp.position.set(0.21, -0.2, -0.5);
  heldLamp.rotation.set(0.08, 0.18, 0);
  heldLamp.scale.setScalar(0.85);
  held.add(heldLamp);
  // l'eau d'amande : la même bouteille qu'au sol, avec son étiquette
  const heldBottle = new THREE.Group();
  const hGlass = hmat({ color: '#e6eef2', transparent: true, opacity: 0.7 });
  const hBody = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 16), hGlass);
  hBody.position.y = 0.13;
  const hLabel = new THREE.Mesh(new THREE.CylinderGeometry(0.0715, 0.0715, 0.1, 16, 1, true), hmat({ map: textures.label }));
  hLabel.position.y = 0.12;
  hLabel.rotation.y = Math.PI * 0.85; // le logo vers soi
  const hNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.06, 12), hGlass);
  hNeck.position.y = 0.29;
  const hCap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.035, 12), hmat({ color: '#f2f2ee' }));
  hCap.position.y = 0.335;
  heldBottle.add(hBody, hLabel, hNeck, hCap);
  heldBottle.scale.setScalar(0.62);
  heldBottle.position.set(-0.22, -0.33, -0.5);
  heldBottle.rotation.set(0.12, 0, 0.18);
  held.add(heldBottle);
  // les piles : deux grosses piles noires à bout cuivré, dans la paume
  const heldBattery = new THREE.Group();
  const hCell = hmat({ color: '#1e1e1e' });
  const hCopper = hmat({ color: '#c98a2b' });
  for (let i = 0; i < 2; i++) {
    const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.06, 12), hCell);
    cell.rotation.z = Math.PI / 2;
    cell.position.set(0, 0, i * 0.036 - 0.018);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.0172, 0.0172, 0.022, 12), hCopper);
    top.rotation.z = Math.PI / 2;
    top.position.set(0.026, 0, i * 0.036 - 0.018);
    heldBattery.add(cell, top);
  }
  heldBattery.position.set(-0.2, -0.22, -0.45);
  heldBattery.rotation.set(0.5, 0.35, 0.1);
  held.add(heldBattery);

  // Les autres joueurs : des explorateurs en combinaison jaune (view/players.js)
  const avatars = createPlayerAvatars(scene);

  // L'entité : une image plate qui fait toujours face au joueur. Tant qu'elle n'est pas chargée (ou s'il n'y a
  // pas d'image), une silhouette noire aux yeux rouges la remplace.
  const monsterGroup = new THREE.Group();
  const shadow = new THREE.Group();
  const blackMat = new THREE.MeshBasicMaterial({ color: '#000000' });
  const mBody = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 2.3, 12), blackMat);
  mBody.position.y = 1.15;
  const mHead = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), blackMat);
  mHead.position.y = 2.4;
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#ff0033' });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), eyeMat);
  eyeL.position.set(0.1, 2.43, 0.27);
  const eyeR = eyeL.clone();
  eyeR.position.x = -0.1;
  shadow.add(mBody, mHead, eyeL, eyeR);
  monsterGroup.add(shadow);

  const face = new THREE.Group();
  const faceGlitch = { value: 1 };
  const faceTime = { value: 0 };
  // au Level 1, l'image de la planche affichée : décalage et taille dans la texture (xy, zw)
  const faceFrame = { value: new THREE.Vector4(0, 0, 1, 1) };
  const anim = L1 || PIPES ? ENTITY_ANIM : null;
  face.visible = false;
  monsterGroup.add(face);
  // l'entité en 3D, animée (view/beast.js) ; au Level 1 en mode VIP : la vidéo d'origine
  // mode VIP au Level 0 : le même corps, avec le visage de la photo de l'entité d'origine
  const beast = !ENTITY_VIP ? createBeast() : !L1 ? createBeast({ photo: { url: VIP_IMG, crop: [490, 20, 300, 375] } }) : null;
  if (beast) {
    monsterGroup.add(beast.group);
    shadow.visible = false;
  }
  if (!beast) new THREE.TextureLoader().load(anim ? anim.url : ENTITY_IMG, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const h = anim ? 2.8 : 2.15; // au Level 1, il est immense (le plafond de l'entrepôt est à 4,2 m)
    const w = anim ? h * anim.aspect : Math.min(2.3, (h * t.image.width) / t.image.height);
    if (anim) faceFrame.value.set(0, 0, 1 / anim.cols, 1 / anim.rows);
    const mat = new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, color: anim ? anim.tint : (ENTITY_VIP ? '#e6dccb' : '#ffffff') }); // au Level 1, une silhouette sombre
    // brouillage de l'image : bandes décalées, couleurs qui bavent, neige et lignes manquantes (uGlitch de 0 à 1)
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uGlitch = faceGlitch;
      sh.uniforms.uGTime = faceTime;
      sh.uniforms.uFrame = faceFrame;
      sh.fragmentShader = `uniform float uGlitch;
uniform float uGTime;
uniform vec4 uFrame;
float ghash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
` + sh.fragmentShader.replace('#include <map_fragment>', `
  vec2 guv = vMapUv;
  vec2 gpad = 0.5 / (vec2(textureSize(map, 0)) * uFrame.zw); // sans déborder sur l'image voisine de la planche
  float gt = floor(uGTime * 15.0);
  float gb = floor(guv.y * 30.0);
  guv.x += step(1.0 - uGlitch * 0.6, ghash(vec2(gb, gt))) * (ghash(vec2(gb, gt + 7.0)) - 0.5) * 0.4 * uGlitch;
  guv.x += (ghash(vec2(floor(guv.y * 220.0), gt)) - 0.5) * 0.025 * uGlitch;
  float gca = 0.03 * uGlitch;
  #define GUV(u) (uFrame.xy + clamp(u, gpad, 1.0 - gpad) * uFrame.zw)
  vec4 gc = texture2D(map, GUV(guv));
  gc.r = texture2D(map, GUV(guv + vec2(gca, 0.0))).r;
  gc.b = texture2D(map, GUV(guv - vec2(gca, 0.0))).b;
  gc.rgb = mix(gc.rgb, vec3(ghash(guv * 420.0 + uGTime)), uGlitch * 0.4);
  if (ghash(vec2(gb * 3.1, floor(uGTime * 20.0))) < uGlitch * 0.2) gc.a = 0.0;
  diffuseColor *= gc;
`);
    };
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    plane.position.y = h / 2 + 0.25; // elle flotte au-dessus de la moquette
    plane.position.x = anim || !ENTITY_VIP ? 0 : (0.5 - 0.6) * w; // la tête (à 60 % de la largeur de la photo) dans l'axe de l'entité
    if (anim) plane.position.y = h / 2 + 0.02; // lui marche par terre
    face.add(plane);
    face.visible = true;
    shadow.visible = false;
  });

  monsterGroup.position.set(map0.monsterSpawn.x, 0, map0.monsterSpawn.z);
  scene.add(monsterGroup);
  // l'événement rare : une silhouette immobile au bout du couloir, qui n'est plus là quand on s'approche
  const figure = new THREE.Group();
  const figMat = new THREE.MeshBasicMaterial({ color: '#030303', fog: true });
  const fb = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.75, 10), figMat);
  fb.position.y = 0.95;
  const fh = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 10), figMat);
  fh.position.y = 1.95;
  figure.add(fb, fh);
  figure.visible = false;
  scene.add(figure);
  let figT = 0;
  // Level 2 : pas d'entité, le troupeau de chèvres (view/goats.js)
  const goatHerd = PIPES ? createGoatHerd(scene) : null;

  const onResize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    vhs.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  let lastTime = 0;
  let bob = 0;
  let crouchY = 0;
  let grabYaw = 0;
  let eyeY = 1.6; // hauteur des yeux : elle suit les chutes, les escaliers et l'échelle
  let fallV = 0; // vitesse de chute de la caméra
  let landShake = 0; // le choc à l'arrivée d'une chute (1 : tout juste tombé)
  let exposure = 1.2; // exposition du caméscope : elle rattrape la lumière en une seconde environ
  let lightNow = 0.5; // lumière des néons là où l'on est (pour le grésillement)

  // effets de bande en cours (secondes restantes), jumpscare, résolution dynamique, mise au point
  const fx = { splice: 0, loss: 0, bars: 0, grab: 0 };
  let scareT = 0;
  const SCARE_T = 1.6; // durée du jumpscare : 0,2 s de noir et de silence, puis elle
  const SCARE_CUT = 0.2;
  let scareJ = 0; // prochaine saccade de sa tête (image par image)
  const scareOff = new THREE.Vector3();
  const scareV = new THREE.Vector3();
  // le rejeu de la mort : les dernières secondes, vues de sa tête (frames : [{ t, mx, mz, myaw, mf, px, pz, pyaw, pf, mv, rn, fl }])
  let replayFrames = null;
  let replayT = 0;
  const replayQ = { id: '__replay', x: 0, z: 0, yaw: 0, pitch: 0, moving: false, running: false, flashlight: false, tilt: 0, floor: 0 };
  const replayP = { x: 0, z: 0, yaw: 0, pitch: 0, floor: 0, status: 'dead', moving: false, crouch: false, hidden: -1, grabT: 0, tilt: 0 };
  let frameAvg = 16;
  let lines = 720;
  let focusT = 0;
  let focusPulse = 0; // temps restant de la « chasse » de mise au point en cours
  let focusWait = 3 + Math.random() * 4; // secondes de course avant la prochaine
  let lastExp = 1.2;
  const api = {
    level: map0.level || 0,
    map: map0,
    floors,
    scene,
    camera,
    renderer,
    monsterGroup,
    vhs,
    get lightHere() {
      return lightNow;
    },
    // Level 2 : percuté par une chèvre
    goatScare() {
      if (goatHerd) goatHerd.scare();
    },

    dispose() {
      window.removeEventListener('resize', onResize);
      if (liveScene === api) liveScene = null;
      const seen = new Set();
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) {
          seen.add(o.geometry);
          o.geometry.dispose();
        }
        for (const m of [].concat(o.material || [])) {
          if (seen.has(m)) continue;
          seen.add(m);
          for (const k in m) if (m[k] && m[k].isTexture && !seen.has(m[k])) {
            seen.add(m[k]);
            m[k].dispose();
          }
          m.dispose();
        }
      });
      vhs.dispose?.();
      renderer.renderLists.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },

    // les réglages d'image du joueur
    applyOptions() {
      camera.fov = OPTS.fov;
      camera.updateProjectionMatrix();
      vhs.setFx?.({ brightness: OPTS.brightness, reduceFlashes: OPTS.reduceFlashes });
      if (OPTS.quality !== 'auto') vhs.setQuality?.(OPTS.quality);
    },

    // un effet de bande passager : 'splice' (raccord), 'loss' (perte du signal), 'bars' (mire), 'grab' (la prise)
    tape(kind, len = 1) {
      fx[kind] = Math.max(fx[kind] || 0, len);
    },

    // le rejeu : on revoit ses dernières secondes depuis la tête de l'entité, sur une bande abîmée
    replay(frames) {
      replayFrames = frames && frames.length > 4 ? frames : null;
      replayT = 0;
    },
    get replaying() {
      return !!replayFrames;
    },

    // L'entité surgit devant l'objectif (en 3D, dans la scène) pendant un instant
    jumpscare() {
      scareT = SCARE_T;
      scareJ = 0;
    },

    // la silhouette au bout du couloir (quelques secondes, ou jusqu'à ce qu'on s'en approche)
    figure(x, z) {
      figure.position.set(x, 0, z);
      figure.visible = true;
      figT = 7;
    },

    // pause : l'image se fige (sur la dernière trame)
    freeze(on) {
      vhs.setFx?.({ freeze: !!on });
    },

    // Rendu d'une frame
    render(sim, time) {
      const dt = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;
      // la caméra suit le joueur de cet écran, ou celui qu'il regarde quand il est spectateur ; pendant le rejeu, elle
      // est dans la tête de l'entité
      let RF = null;
      if (replayFrames) {
        replayT += dt;
        const t0 = replayFrames[0].t;
        const span = replayFrames[replayFrames.length - 1].t - t0;
        if (replayT > span + 0.35) {
          replayFrames = null;
          avatars.update(replayQ, false, 0, 0.3, dt, time);
        } else {
          const want = t0 + Math.min(span, replayT);
          let i = 1;
          while (i < replayFrames.length - 1 && replayFrames[i].t < want) i++;
          const a = replayFrames[i - 1];
          const b = replayFrames[i];
          const u = THREE.MathUtils.clamp((want - a.t) / Math.max(1e-3, b.t - a.t), 0, 1);
          const L = (k) => a[k] + (b[k] - a[k]) * u;
          RF = { mx: L('mx'), mz: L('mz'), px: L('px'), pz: L('pz'), pyaw: b.pyaw, mf: b.mf, pf: b.pf, mv: b.mv, rn: b.rn, fl: b.fl };
          replayP.x = RF.mx;
          replayP.z = RF.mz;
          replayP.floor = RF.mf;
          replayP.yaw = Math.atan2(-(RF.px - RF.mx), -(RF.pz - RF.mz));
        }
      }
      const P = RF ? replayP : sim.viewPlayer(sim.spectate || 0);
      for (const fv of floorViews) fv.update(sim, P, time, dt);

      // 1. Caméra : balancement lent de la marche, plus marqué en courant ; une chute la fait plonger d'un étage
      if (P.moving) bob += dt * (P.running ? 9 : 5.5);
      const pm = sim.fm(P.floor || 0);
      const want = 1.6 + feetY(sim.stairs, P.x, P.z, P.floor) + (P.onLadder ? 1.0 : 0) - (pm.depthAt ? pm.depthAt(P.x, P.z) : 0);
      // une chute : on tombe vraiment (gravité), puis le choc secoue la caméra
      if (want < eyeY - 0.5 || fallV > 0) {
        fallV += 9.8 * dt;
        eyeY -= fallV * dt;
        if (eyeY <= want) {
          eyeY = want;
          landShake = Math.min(1, fallV / 10);
          fallV = 0;
        }
      } else eyeY += (want - eyeY) * Math.min(1, dt * 10);
      landShake = Math.max(0, landShake - dt * 0.9);
      const mo = OPTS.motion; // 0 : caméra stable (réglage), 1 : caméra à l'épaule
      const shake = landShake * landShake * Math.max(0.3, mo);
      // accroupi, la caméra descend ; dans un casier, elle est fixe
      crouchY += ((P.crouch ? -0.55 : 0) - crouchY) * Math.min(1, dt * 8);
      const still = P.hidden >= 0;
      camera.position.set(P.x, eyeY + crouchY + (P.moving && !still ? Math.sin(bob * 2) * (P.running ? 0.05 : 0.025) * mo : 0), P.z);
      camera.rotation.order = 'YXZ';
      // agrippé : le regard est tiré vers l'entité
      let yaw = P.yaw;
      let pitch = P.pitch;
      if (P.grabT > 0 && sim.monster) {
        const M = sim.monster;
        const a = Math.atan2(-(M.x - P.x), -(M.z - P.z));
        let d = a - yaw;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        grabYaw += (d - grabYaw) * Math.min(1, dt * 10);
        yaw += grabYaw;
        pitch = 0.12;
      } else grabYaw *= Math.max(0, 1 - dt * 6);
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      camera.rotation.z = (P.moving ? Math.sin(bob) * 0.006 * mo : 0) - (P.tilt || 0) * 0.5 + shake * 0.35; // on tangue sur l'arête ; sonné après une chute
      camera.rotation.x += shake * (Math.sin(time * 31) * 0.05 - 0.35);
      camera.position.y -= shake * 0.9;
      // caméra tenue à la main : elle ne reste jamais tout à fait immobile, et tremble davantage en courant
      const hand = (P.moving ? (P.running ? 2.4 : 1.4) : 1) * 0.0035 * mo * (P.grabT > 0 ? 4 : 1);
      camera.rotation.x += (Math.sin(time * 0.83) * 0.6 + Math.sin(time * 2.17 + 1.3) * 0.3 + Math.sin(time * 5.3) * 0.1) * hand;
      camera.rotation.y += (Math.sin(time * 0.61 + 2.1) * 0.6 + Math.sin(time * 1.73) * 0.3 + Math.sin(time * 4.7 + 0.4) * 0.1) * hand;
      camera.rotation.z += Math.sin(time * 0.47 + 0.7) * hand * 0.8;

      // tremblement quand l'entité est tout près
      const danger = sim.hasMonster ? sim.monster.danger : 0;
      // tout près, le tremblement se calme un peu (on ne voit plus rien sinon) ; le filtre, lui, continue de monter
      const calm = 1 - THREE.MathUtils.smoothstep(danger, 0.72, 0.92) * 0.6;
      if (danger > 0.3) {
        const sh = (danger - 0.3) * 0.035 * calm * mo;
        camera.rotation.z += (Math.random() - 0.5) * sh;
        camera.position.y += (Math.random() - 0.5) * sh;
      }

      if (RF) {
        // sa tête : haute, penchée vers lui, avec ce léger balancement de bête qui marche
        const d = Math.hypot(RF.px - RF.mx, RF.pz - RF.mz);
        camera.position.set(RF.mx, 2.55 + feetY(sim.stairs, RF.mx, RF.mz, RF.mf || 0) + Math.sin(time * 7) * 0.03, RF.mz);
        camera.rotation.set(-Math.atan2(1.4, Math.max(0.6, d)) * 0.8 + Math.sin(time * 3.1) * 0.02, replayP.yaw + Math.sin(time * 2.3) * 0.03, Math.sin(time * 1.7) * 0.04, 'YXZ');
      }

      // allumer ou éteindre la lampe ne change pas le nombre de lumières (sinon tous les matériaux se recompilent)
      const lampOn = P.flashlight && P.status === 'alive';
      // pile faible : la lampe faiblit et clignote
      const bat = P.battery ?? 100;
      flashLight.intensity = !lampOn ? 0 : 17 * (bat < 15 ? 0.45 + (Math.random() < 0.12 ? -0.4 : 0.15) : bat < 35 ? 0.75 : 1);
      flashSpill.intensity = flashLight.intensity * 0.24;

      // les objets en main : la lampe dès qu'on l'a, l'objet de la case choisie s'il y en a un (pas l'échelle)
      const alive = P.status === 'alive' && !P.onLadder && !(P.hidden >= 0);
      const inHand = alive ? P.inv && P.inv[(P.sel || 1) - 1] : null;
      heldLamp.visible = alive && !!P.hasLamp;
      heldBottle.visible = inHand === 'bottle';
      heldBattery.visible = inHand === 'battery';
      // éclairés par la lumière d'où l'on est, un peu plus quand la lampe est allumée
      const k = THREE.MathUtils.clamp(0.07 + lightNow * 1.1 + (lampOn ? 0.4 : 0), 0.06, 1.05);
      for (const m of heldMats) m.color.copy(m.userData.base).multiplyScalar(k);
      lensMat.color.set(lampOn ? '#fff6d8' : '#2c2b26');
      // ils suivent le pas, un peu en retard sur la tête
      const sway = P.moving ? (P.running ? 1.6 : 1) : 0.25;
      held.position.set(Math.cos(bob) * 0.007 * sway, Math.sin(bob * 2) * 0.006 * sway - (P.running ? 0.02 : 0), 0);
      held.visible = !RF && !(scareT > 0); // rien dans les mains pendant le jumpscare : elle seule à l'image
      held.rotation.set(Math.sin(bob * 2) * 0.01 * sway, Math.cos(bob) * 0.015 * sway, 0);

      // 2. L'entité fait face au joueur et tressaute quand elle le traque (Level 2 : le troupeau)
      if (goatHerd && sim.goats) {
        monsterGroup.visible = false;
        const gv = floorViews[0];
        goatHerd.update(sim, P, camera, gv ? gv.lightAt : () => 0.3, lampOn, dt, time);
      } else if (sim.hasMonster) {
        const M = sim.monster;
        monsterGroup.visible = true;
        const chase = M.mode === 'chase';
        // plus elle est proche, moins elle est brouillée : nette à moins de 2,5 m
        const g = THREE.MathUtils.clamp((Math.hypot(P.x - M.x, P.z - M.z) - 2.5) / 14, 0, 1);
        faceGlitch.value = anim ? g * 0.3 : g; // au Level 1, sombre mais net : à peine brouillé
        faceTime.value = time;
        if (anim) {
          const f = Math.floor(time * anim.fps) % anim.frames;
          // la planche se lit de haut en bas, la texture de bas en haut
          faceFrame.value.x = (f % anim.cols) / anim.cols;
          faceFrame.value.y = 1 - (Math.floor(f / anim.cols) + 1) / anim.rows;
        }
        const j = (chase ? 0.12 : 0.04) * faceGlitch.value;
        const my = -(M.floor || 0) * FLOOR_DY;
        if (beast) {
          // en 3D : elle regarde où elle va (ou le joueur qu'elle observe), et marche vraiment
          monsterGroup.position.set(M.x + (Math.random() - 0.5) * j * 0.3, my, M.z + (Math.random() - 0.5) * j * 0.3);
          monsterGroup.rotation.y = M.yaw || 0;
          const mv = floorViews[M.floor || 0];
          beast.update(M, chase, mv ? mv.lightAt(M.x, M.z) : 0.3, dt, time);
        } else {
          monsterGroup.position.set(M.x + (Math.random() - 0.5) * j, my + (chase ? Math.abs(Math.sin(time * 9)) * 0.08 : Math.sin(time * 2) * 0.03), M.z + (Math.random() - 0.5) * j);
          monsterGroup.rotation.y = Math.atan2(P.x - M.x, P.z - M.z);
          face.scale.set(1 + (Math.random() - 0.5) * 0.08 * faceGlitch.value, 1 + Math.sin(time * 18) * 0.04 * faceGlitch.value, 1);
        }
      } else {
        monsterGroup.visible = false;
      }
      if (figT > 0) {
        figT -= dt;
        const d = Math.hypot(figure.position.x - P.x, figure.position.z - P.z);
        // elle disparaît quand on s'approche… ou dès que la lampe la touche
        const lit = lampOn && d < 22 && Math.abs(Math.atan2(-(figure.position.x - P.x), -(figure.position.z - P.z)) - P.yaw) % (2 * Math.PI) < 0.12;
        if (figT <= 0 || d < 9 || lit) {
          figT = 0;
          figure.visible = false;
        }
      }
      // le jumpscare : un noir d'un cinquième de seconde (le son coupe aussi), puis son visage fonce sur l'objectif à
      // hauteur des yeux (elle se plie : elle est bien plus grande que toi), s'y colle et tressaute image par image
      if (scareT > 0 && !goatHerd) {
        scareT -= dt;
        const e = SCARE_T - scareT - SCARE_CUT;
        if (e < 0) monsterGroup.visible = false;
        else {
          const fx0 = -Math.sin(camera.rotation.y);
          const fz0 = -Math.cos(camera.rotation.y);
          const lunge = Math.min(1, e / 0.09);
          scareJ -= dt;
          if (scareJ <= 0) {
            scareJ = 0.04 + Math.random() * 0.08;
            scareOff.set((Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.5);
          }
          const near = 1.9 - 1.62 * lunge * lunge + Math.max(0, e - 1.0) * 0.5 + scareOff.y;
          monsterGroup.visible = true;
          monsterGroup.position.set(camera.position.x + fx0 * near, 0, camera.position.z + fz0 * near);
          monsterGroup.rotation.set(0, Math.atan2(fx0, fz0) + Math.PI, 0);
          const faceObj = beast && beast.scareFace();
          if (faceObj) {
            // le visage pile dans l'axe de l'objectif, à `near` mètres
            monsterGroup.updateMatrixWorld(true);
            faceObj.getWorldPosition(scareV);
            monsterGroup.position.x += camera.position.x + fx0 * near - scareV.x + scareOff.x * fz0;
            monsterGroup.position.y += camera.position.y - scareV.y;
            monsterGroup.position.z += camera.position.z + fz0 * near - scareV.z - scareOff.x * fx0;
          } else monsterGroup.position.y = camera.position.y - 2.05;
          monsterGroup.rotation.z = scareOff.z * 0.3;
          // le choc, puis un tremblement qui ne se calme qu'à peine
          const amp = (lunge < 1 ? 0.03 : 0.09 * Math.max(0.25, 1 - e / 1.2)) * Math.max(0.3, mo);
          camera.rotation.z += (Math.random() - 0.5) * amp * 1.6 + scareOff.z * 0.15;
          camera.rotation.x += (Math.random() - 0.5) * amp;
          camera.rotation.y += (Math.random() - 0.5) * amp * 0.6;
        }
      }

      // pendant le rejeu : elle n'est pas dans l'image (on est elle) ; lui, si
      if (RF) {
        monsterGroup.visible = false;
        replayQ.x = RF.px;
        replayQ.z = RF.pz;
        replayQ.yaw = RF.pyaw;
        replayQ.moving = !!RF.mv;
        replayQ.running = !!RF.rn;
        replayQ.flashlight = !!RF.fl;
        replayQ.floor = RF.pf;
        const rv = floorViews[RF.pf || 0];
        avatars.update(replayQ, true, feetY(sim.stairs, RF.px, RF.pz, RF.pf || 0), rv ? rv.lightAt(RF.px, RF.pz) : 0.3, dt, time);
      }

      // 3. Les autres joueurs encore dehors
      for (const Q of sim.players) {
        const show = Q !== P && Q.status === 'alive' && !(Q.hidden >= 0); // un coéquipier caché dans un casier ne se voit pas
        if (!show && !avatars.has(Q.id)) continue;
        const qv = floorViews[Q.floor || 0];
        const qm = sim.fm(Q.floor || 0);
        const y = feetY(sim.stairs, Q.x, Q.z, Q.floor) + (Q.onLadder ? 1.0 : 0) - (qm.depthAt ? qm.depthAt(Q.x, Q.z) : 0);
        avatars.update(Q, show, y, qv ? qv.lightAt(Q.x, Q.z) : 0.3, dt, time);
      }

      // exposition automatique : le caméscope s'ouvre dans le noir (image plus claire et plus granuleuse) et se
      // referme sous les néons, avec un temps de retard
      const fv = floorViews[P.floor || 0];
      lightNow = fv ? fv.lightAt(P.x, P.z) : 0.5;
      if (stairAt(sim.stairs, P.x, P.z)) lightNow = Math.max(lightNow, sim.blackout > 0 ? 0 : 0.55); // dans la cage : ses appliques
      const lightHere = lightNow + (lampOn ? 0.3 : 0);
      const wantExp = THREE.MathUtils.clamp(0.45 / (0.15 + lightHere), 0.9, 1.4);
      // il s'ouvre lentement dans le noir, se referme vite sous la lumière (comme un vrai caméscope)
      exposure += (wantExp - exposure) * Math.min(1, dt * (wantExp > exposure ? 0.65 : 2.4));
      // la mise au point ne décroche qu'en courant (la caméra secouée), et seulement par à-coups : de temps en temps
      // l'autofocus « chasse » une demi-seconde puis se raccroche ; au pas ou à l'arrêt, l'image reste nette
      lastExp = exposure;
      const runs = P.running && P.moving && P.status === 'alive';
      if (focusPulse > 0) focusPulse = Math.max(0, focusPulse - dt);
      else if (runs && (focusWait -= dt) <= 0) {
        focusPulse = 0.45 + Math.random() * 0.4;
        focusWait = 4 + Math.random() * 7;
      }
      if (focusPulse > 0 && runs) focusT = Math.min(0.42, focusT + dt * 2.4);
      else focusT = Math.max(0, focusT - dt * 1.4);
      // balance des blancs automatique : un peu bleue dans le noir, chaude sous les néons
      const wb = THREE.MathUtils.clamp(lightHere, 0, 1);
      const white = L2 ? [1, 1, 1] : [0.96 + wb * 0.06, 1, 1.07 - wb * 0.1];

      // les effets de bande du moment : raccord, perte de signal (mort), mire, la prise de l'entité
      for (const k in fx) fx[k] = Math.max(0, fx[k] - dt);
      const grabbed = P.grabT > 0 && P.status === 'alive';
      const dark = sim.blackout > 0;
      vhs.setFx?.({
        tracking: Math.min(1, (dark ? 0.25 : 0) + (grabbed ? 0.75 : 0) + Math.min(1, fx.grab) * 0.6 + (scareT > 0 ? 0.45 : 0) + (RF ? 0.45 : 0)),
        splice: Math.min(1, fx.splice * 1.5),
        signalLoss: Math.min(1, fx.loss * 0.8),
        bars: Math.min(1, fx.bars),
        chroma: scareT > 0 ? 0.7 : grabbed ? 0.6 : RF ? 0.45 : 0,
        focus: Math.min(1, focusT + (grabbed ? 0.35 : 0)),
        white,
      });

      // résolution dynamique : moins de lignes quand l'image peine, plus quand elle est à l'aise
      frameAvg += (dt * 1000 - frameAvg) * 0.05;
      if (OPTS.quality === 'auto' && vhs.setLines) {
        if (frameAvg > 24 && lines > 360) lines -= 8;
        else if (frameAvg < 15 && lines < 720) lines += 4;
        vhs.setLines(lines);
      }
      vhs.render(scene, camera, time, danger, exposure);
    },
  };
  liveScene = api;
  api.applyOptions();
  // les matériaux se compilent en arrière-plan avant la première image (sinon le jeu se fige au premier regard)
  try {
    renderer.compileAsync?.(scene, camera)?.catch?.(() => {});
  } catch (e) {}
  return api;
}
