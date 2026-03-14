// ─── SpriteCollab URL builder ────────────────────────────────────────────────
// Prefers locally-downloaded sprites (assets/sprites/…) when served from a
// local dev server; falls back to the SpriteCollab GitHub raw URL for remote.
const SPRITE_BASE_LOCAL  = './assets/sprites';
const SPRITE_BASE_REMOTE = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite';

function spriteUrl(id, animation, shiny = false, form = null) {
  const formPath  = form  ? `/${form}`  : '';
  const shinyPath = shiny ? '/Shiny'    : '';
  const suffix    = `${formPath}${shinyPath}/${animation}-Anim.png`;
  // Local path used when served via npm start; remote fallback otherwise.
  return `${SPRITE_BASE_LOCAL}/${id}${suffix}`;
}

// Remote fallback (used by SVG generator which runs outside the server)
export function remoteSpriteUrl(id, animation, shiny = false, form = null) {
  const formPath  = form  ? `/${form}`  : '';
  const shinyPath = shiny ? '/Shiny'    : '';
  return `${SPRITE_BASE_REMOTE}/${id}${formPath}${shinyPath}/${animation}-Anim.png`;
}

export const PORTRAIT_BASE_LOCAL  = './assets/sprites';
export const PORTRAIT_BASE_REMOTE = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/portrait';

// ─── Pokemon definitions ──────────────────────────────────────────────────────
// form '0001' = first alternate form (Mega for Diancie)
// Shiny variants sit in a /Shiny/ subdirectory in SpriteCollab

export const POKEMON_DEFS = {
  MEGA_DIANCIE: {
    key: 'MEGA_DIANCIE',
    id: '0719',
    name: 'Mega Diancie',
    form: '0001',
    shiny: false,
    color: '#FF85C8',
    secondaryColor: '#FFE0F0',
    glowColor: 'rgba(255,133,200,0.6)',
    frameSize: 32,
    shadowScale: 0.7,
    animations: {
      walk:   spriteUrl('0719', 'Walk',   false, '0001'),
      idle:   spriteUrl('0719', 'Idle',   false, '0001'),
      sleep:  spriteUrl('0719', 'Sleep',  false, '0001'),
      attack: spriteUrl('0719', 'Attack', false, '0001'),
      hurt:   spriteUrl('0719', 'Hurt',   false, '0001'),
    },
  },
  SHINY_CERULEDGE: {
    key: 'SHINY_CERULEDGE',
    id: '0937',
    name: 'Shiny Ceruledge',
    form: null,
    shiny: true,
    color: '#3A7BFF',
    secondaryColor: '#A0C8FF',
    glowColor: 'rgba(58,123,255,0.6)',
    frameSize: 32,
    shadowScale: 0.8,
    animations: {
      walk:   spriteUrl('0937', 'Walk',   true),
      idle:   spriteUrl('0937', 'Idle',   true),
      sleep:  spriteUrl('0937', 'Sleep',  true),
      attack: spriteUrl('0937', 'Attack', true),
      hurt:   spriteUrl('0937', 'Hurt',   true),
    },
  },
  SHINY_IRON_VALIANT: {
    key: 'SHINY_IRON_VALIANT',
    id: '1006',
    name: 'Shiny Iron Valiant',
    form: null,
    shiny: true,
    color: '#00FFB2',
    secondaryColor: '#B2FFE8',
    glowColor: 'rgba(0,255,178,0.6)',
    frameSize: 32,
    shadowScale: 0.8,
    animations: {
      walk:   spriteUrl('1006', 'Walk',   true),
      idle:   spriteUrl('1006', 'Idle',   true),
      sleep:  spriteUrl('1006', 'Sleep',  true),
      attack: spriteUrl('1006', 'Attack', true),
      hurt:   spriteUrl('1006', 'Hurt',   true),
    },
  },
  SHINY_GRENINJA: {
    key: 'SHINY_GRENINJA',
    id: '0658',
    name: 'Shiny Greninja',
    form: null,
    shiny: true,
    color: '#FF6600',
    secondaryColor: '#FFD0A0',
    glowColor: 'rgba(255,102,0,0.6)',
    frameSize: 24,
    shadowScale: 0.65,
    animations: {
      walk:   spriteUrl('0658', 'Walk',   true),
      idle:   spriteUrl('0658', 'Idle',   true),
      sleep:  spriteUrl('0658', 'Sleep',  true),
      attack: spriteUrl('0658', 'Attack', true),
      hurt:   spriteUrl('0658', 'Hurt',   true),
    },
  },
  SHINY_ARMAROUGE: {
    key: 'SHINY_ARMAROUGE',
    id: '0936',
    name: 'Shiny Armarouge',
    form: null,
    shiny: true,
    color: '#FFD700',
    secondaryColor: '#FFF0A0',
    glowColor: 'rgba(255,215,0,0.6)',
    frameSize: 32,
    shadowScale: 0.75,
    animations: {
      walk:   spriteUrl('0936', 'Walk',   true),
      idle:   spriteUrl('0936', 'Idle',   true),
      sleep:  spriteUrl('0936', 'Sleep',  true),
      attack: spriteUrl('0936', 'Attack', true),
      hurt:   spriteUrl('0936', 'Hurt',   true),
    },
  },
  SHINY_YVELTAL: {
    key: 'SHINY_YVELTAL',
    id: '0717',
    name: 'Shiny Yveltal',
    form: null,
    shiny: true,
    color: '#CC44FF',
    secondaryColor: '#EEB0FF',
    glowColor: 'rgba(204,68,255,0.6)',
    frameSize: 40,
    shadowScale: 0.9,
    animations: {
      walk:   spriteUrl('0717', 'Walk',   true),
      idle:   spriteUrl('0717', 'Idle',   true),
      sleep:  spriteUrl('0717', 'Sleep',  true),
      attack: spriteUrl('0717', 'Attack', true),
      hurt:   spriteUrl('0717', 'Hurt',   true),
    },
  },
};

// ─── NPC Pokemon roster for Feature 1 ────────────────────────────────────────
export const WORLD_POKEMON = Object.values(POKEMON_DEFS);

// ─── Tile types ───────────────────────────────────────────────────────────────
export const TILE = {
  DEEP_WATER:   0,
  WATER:        1,
  SAND:         2,
  GRASS:        3,
  TALL_GRASS:   4,
  TREE:         5,
  PATH:         6,
  FLOWER_R:     7,
  FLOWER_Y:     8,
  STONE_CIRCLE: 9,
};

export const TILE_COLOR = {
  [TILE.DEEP_WATER]:   '#1565a0',
  [TILE.WATER]:        '#2196d4',
  [TILE.SAND]:         '#e8d09a',
  [TILE.GRASS]:        '#4caf50',
  [TILE.TALL_GRASS]:   '#2e7d32',
  [TILE.TREE]:         '#1b5e20',
  [TILE.PATH]:         '#c8a870',
  [TILE.FLOWER_R]:     '#4caf50',
  [TILE.FLOWER_Y]:     '#4caf50',
  [TILE.STONE_CIRCLE]: '#9890a0',
};

export const TILE_WALKABLE = {
  [TILE.DEEP_WATER]:   false,
  [TILE.WATER]:        false,
  [TILE.SAND]:         true,
  [TILE.GRASS]:        true,
  [TILE.TALL_GRASS]:   true,
  [TILE.TREE]:         false,
  [TILE.PATH]:         true,
  [TILE.FLOWER_R]:     true,
  [TILE.FLOWER_Y]:     true,
  [TILE.STONE_CIRCLE]: true,
};

// ─── PMD direction order (0=South, going clockwise) ──────────────────────────
// Row index in sprite sheet: S, SE, E, NE, N, NW, W, SW
export const DIRECTIONS = 8;
export const DIR_S  = 0;
export const DIR_SE = 1;
export const DIR_E  = 2;
export const DIR_NE = 3;
export const DIR_N  = 4;
export const DIR_NW = 5;
export const DIR_W  = 6;
export const DIR_SW = 7;

// ─── World constants ──────────────────────────────────────────────────────────
export const TILE_SIZE   = 24;                 // PMD GBA tile size
export const MAP_W       = 48;
export const MAP_H       = 32;
export const CANVAS_W    = 960;
export const CANVAS_H    = 600;
export const SCALE       = 2;                  // render sprites at 2x
export const FPS_TARGET  = 60;

// ─── NPC behaviour timing (ms) ───────────────────────────────────────────────
export const IDLE_MIN     = 1500;
export const IDLE_MAX     = 4000;
export const WALK_MIN     = 2000;
export const WALK_MAX     = 5000;
export const SLEEP_MIN    = 3000;
export const SLEEP_MAX    = 8000;
export const BATTLE_DUR   = 2200;
export const HURT_DUR     = 600;
export const BATTLE_RANGE = 64;   // px – proximity that triggers a battle check
export const INTERACT_CHANCE = 0.003; // per-frame probability when close enough
