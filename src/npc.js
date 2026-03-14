import {
  TILE_SIZE, MAP_W, MAP_H, SCALE,
  DIR_S, DIR_SE, DIR_E, DIR_NE, DIR_N, DIR_NW, DIR_W, DIR_SW,
  IDLE_MIN, IDLE_MAX, WALK_MIN, WALK_MAX, SLEEP_MIN, SLEEP_MAX,
  BATTLE_DUR, HURT_DUR, BATTLE_RANGE, INTERACT_CHANCE,
} from './config.js';
import { SpriteSet } from './sprite.js';

// ─── States ───────────────────────────────────────────────────────────────────
export const STATE = {
  IDLE:   'idle',
  WALK:   'walk',
  SLEEP:  'sleep',
  BATTLE: 'battle',
  HURT:   'hurt',
};

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max));

// ─── Direction helpers ────────────────────────────────────────────────────────
const DIR_VECTORS = [
  [0,  1], [ 1,  1], [ 1,  0], [ 1, -1],
  [0, -1], [-1, -1], [-1,  0], [-1,  1],
];

function angleToDirRow(dx, dy) {
  if (dx === 0 && dy === 0) return DIR_S;
  const angle = Math.atan2(dy, dx);       // atan2(dy, dx) in [-π, π]
  const deg   = ((angle * 180 / Math.PI) + 360) % 360;
  // Map to PMD direction rows: E=2, then clockwise
  // PMD row order: S(down)=0, SE=1, E=2, NE=3, N=4, NW=5, W=6, SW=7
  // Angle 0=East → row 2
  const idx = Math.round(deg / 45) % 8;
  // Convert angle-based index (0=E) to PMD row (0=S)
  const PMD_MAP = [DIR_E, DIR_NE, DIR_N, DIR_NW, DIR_W, DIR_SW, DIR_S, DIR_SE];
  return PMD_MAP[idx];
}

// ─── NPC class ────────────────────────────────────────────────────────────────
export class NPC {
  /**
   * @param {object}   pokeDef  – entry from POKEMON_DEFS
   * @param {number}   x        – initial pixel x
   * @param {number}   y        – initial pixel y
   * @param {TileMap}  tileMap
   */
  constructor(pokeDef, x, y, tileMap) {
    this.def      = pokeDef;
    this.x        = x;
    this.y        = y;
    this.tileMap  = tileMap;
    this.sprites  = new SpriteSet(pokeDef);

    this.state    = STATE.IDLE;
    this.dirRow   = DIR_S;
    this.timer    = 0;
    this.duration = rand(IDLE_MIN, IDLE_MAX);

    // Walk target
    this.targetX  = x;
    this.targetY  = y;
    this.speed    = 32 + Math.random() * 16;   // px / s

    // Battle partner reference
    this.opponent = null;
    this.hurtAlpha = 0;

    // Interaction cooldown (ms) – prevents instant re-battle
    this.interactCooldown = 0;
  }

  // ── Main update ────────────────────────────────────────────────────────────
  update(dt, allNPCs, particles) {
    this.timer            += dt;
    this.interactCooldown -= dt;

    this.sprites.update(this._animKey(), dt);

    switch (this.state) {
      case STATE.IDLE:   this._updateIdle(dt, allNPCs, particles);   break;
      case STATE.WALK:   this._updateWalk(dt, allNPCs, particles);   break;
      case STATE.SLEEP:  this._updateSleep(dt, particles);           break;
      case STATE.BATTLE: this._updateBattle(dt, allNPCs, particles); break;
      case STATE.HURT:   this._updateHurt(dt);                       break;
    }
  }

  // ── Idle ──────────────────────────────────────────────────────────────────
  _updateIdle(dt, allNPCs, particles) {
    if (this.timer >= this.duration) {
      const roll = Math.random();
      if (roll < 0.50)      this._startWalk();
      else if (roll < 0.75) this._startSleep();
      else                  this._setState(STATE.IDLE, rand(IDLE_MIN, IDLE_MAX));
    }

    // Check for nearby Pokemon to interact with
    if (this.interactCooldown <= 0) {
      for (const other of allNPCs) {
        if (other === this || other.state === STATE.BATTLE || other.state === STATE.HURT) continue;
        const dist = Math.hypot(this.x - other.x, this.y - other.y);
        if (dist < BATTLE_RANGE && Math.random() < INTERACT_CHANCE) {
          this._startBattle(other, particles);
          break;
        }
      }
    }
  }

  // ── Walk ──────────────────────────────────────────────────────────────────
  _updateWalk(dt, allNPCs, particles) {
    if (this.timer >= this.duration) {
      this._setState(STATE.IDLE, rand(IDLE_MIN, IDLE_MAX));
      return;
    }

    const dx   = this.targetX - this.x;
    const dy   = this.targetY - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 2) {
      // Arrived – pick next waypoint or go idle
      if (Math.random() < 0.4) {
        this._setState(STATE.IDLE, rand(IDLE_MIN, IDLE_MAX));
      } else {
        this._pickTarget();
      }
      return;
    }

    const step = (this.speed * dt) / 1000;
    const nx   = this.x + (dx / dist) * step;
    const ny   = this.y + (dy / dist) * step;

    if (this.tileMap.isWalkablePx(nx, ny)) {
      this.x = nx;
      this.y = ny;
    } else {
      // Hit obstacle – pick a new target
      this._pickTarget();
    }

    this.dirRow = angleToDirRow(dx, dy);

    // Opportunistic battle trigger while walking
    if (this.interactCooldown <= 0) {
      for (const other of allNPCs) {
        if (other === this || other.state === STATE.BATTLE || other.state === STATE.HURT) continue;
        const d = Math.hypot(this.x - other.x, this.y - other.y);
        if (d < BATTLE_RANGE * 0.6 && Math.random() < INTERACT_CHANCE * 1.5) {
          this._startBattle(other, particles);
          break;
        }
      }
    }
  }

  // ── Sleep ─────────────────────────────────────────────────────────────────
  _updateSleep(dt, particles) {
    particles.emitZZZ(
      this.x + this.def.frameSize * SCALE * 0.5 + 8,
      this.y - 4,
    );
    if (this.timer >= this.duration) {
      this._setState(STATE.IDLE, rand(IDLE_MIN, IDLE_MAX));
    }
  }

  // ── Battle ────────────────────────────────────────────────────────────────
  _updateBattle(dt, allNPCs, particles) {
    if (!this.opponent) {
      this._setState(STATE.IDLE, rand(IDLE_MIN, IDLE_MAX));
      return;
    }

    const dx   = this.opponent.x - this.x;
    const dy   = this.opponent.y - this.y;
    const dist = Math.hypot(dx, dy);

    // Face opponent
    if (dist > 0.1) this.dirRow = angleToDirRow(dx, dy);

    // Approach if far
    const closeEnough = this.def.frameSize * SCALE;
    if (dist > closeEnough) {
      const step = (this.speed * 1.5 * dt) / 1000;
      const nx = this.x + (dx / dist) * step;
      const ny = this.y + (dy / dist) * step;
      if (this.tileMap.isWalkablePx(nx, ny)) {
        this.x = nx;
        this.y = ny;
      }
    } else {
      // In range – emit sparks
      const midX = (this.x + this.opponent.x) / 2;
      const midY = (this.y + this.opponent.y) / 2;
      particles.emitSpark(midX, midY);
    }

    if (this.timer >= BATTLE_DUR) {
      this._endBattle();
    }
  }

  // ── Hurt ──────────────────────────────────────────────────────────────────
  _updateHurt(dt) {
    this.hurtAlpha = Math.max(0, 1 - this.timer / HURT_DUR);
    if (this.timer >= HURT_DUR) {
      this.hurtAlpha = 0;
      this._setState(STATE.IDLE, rand(IDLE_MIN, IDLE_MAX));
    }
  }

  // ── State transitions ─────────────────────────────────────────────────────
  _setState(newState, duration) {
    this.state    = newState;
    this.timer    = 0;
    this.duration = duration;
    this.sprites.get(this._animKey())?.resetFrame();
  }

  _startWalk() {
    this._pickTarget();
    this._setState(STATE.WALK, rand(WALK_MIN, WALK_MAX));
  }

  _startSleep() {
    this.dirRow = DIR_S;
    this._setState(STATE.SLEEP, rand(SLEEP_MIN, SLEEP_MAX));
  }

  _startBattle(other, particles) {
    if (other.state === STATE.BATTLE || other.state === STATE.HURT) return;
    this.opponent = other;
    this._setState(STATE.BATTLE, BATTLE_DUR);

    // Opponent reacts – goes into HURT state briefly then battles back
    other.opponent = this;
    other.state    = STATE.HURT;
    other.timer    = 0;
    other.duration = HURT_DUR;
    other.hurtAlpha = 1;

    const midX = (this.x + other.x) / 2 + this.def.frameSize * SCALE * 0.5;
    const midY = (this.y + other.y) / 2;
    particles.emitSpark(midX, midY);

    this.interactCooldown = 5000;
    other.interactCooldown = 5000;
  }

  _endBattle() {
    this.opponent = null;
    this.interactCooldown = 5000;
    // Retreat slightly
    const angle  = Math.random() * Math.PI * 2;
    const dist   = 40 + Math.random() * 30;
    const rx     = this.x + Math.cos(angle) * dist;
    const ry     = this.y + Math.sin(angle) * dist;
    this.targetX = Math.max(0, Math.min(rx, MAP_W * TILE_SIZE - 10));
    this.targetY = Math.max(0, Math.min(ry, MAP_H * TILE_SIZE - 10));
    this._setState(STATE.WALK, WALK_MIN);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  _animKey() {
    switch (this.state) {
      case STATE.WALK:   return 'walk';
      case STATE.SLEEP:  return 'sleep';
      case STATE.BATTLE: return 'attack';
      case STATE.HURT:   return 'hurt';
      default:           return 'idle';
    }
  }

  _pickTarget() {
    // Pick a random walkable tile within a reasonable radius
    const radius  = 6;  // tiles
    const tileX   = Math.floor(this.x / TILE_SIZE);
    const tileY   = Math.floor(this.y / TILE_SIZE);
    let attempts  = 0;

    while (attempts++ < 30) {
      const tx = tileX + randInt(-radius, radius);
      const ty = tileY + randInt(-radius, radius);
      if (this.tileMap.isWalkable(tx, ty)) {
        this.targetX = (tx + 0.5) * TILE_SIZE;
        this.targetY = (ty + 0.5) * TILE_SIZE;
        return;
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  render(ctx) {
    const fs   = this.def.frameSize;
    const size = fs * SCALE;
    const sx   = this.x - size / 2;
    const sy   = this.y - size / 2;

    // Glow when battling
    if (this.state === STATE.BATTLE) {
      ctx.save();
      ctx.shadowBlur  = 16;
      ctx.shadowColor = this.def.glowColor;
      this.sprites.draw(this._animKey(), ctx, sx, sy, this.dirRow, SCALE);
      ctx.restore();
    } else {
      this.sprites.draw(this._animKey(), ctx, sx, sy, this.dirRow, SCALE,
        this.state === STATE.HURT ? 0.4 + 0.6 * (1 - this.hurtAlpha) : 1);
    }

    // Name tag
    if (this.state !== STATE.SLEEP) {
      ctx.save();
      ctx.font      = '8px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      const label = this.def.name;
      ctx.strokeText(label, this.x, sy - 4);
      ctx.fillText(label,   this.x, sy - 4);
      ctx.restore();
    }

    // State icon
    this._renderIcon(ctx, this.x, sy - 18);
  }

  _renderIcon(ctx, x, y) {
    let icon = '';
    if (this.state === STATE.SLEEP)  icon = '💤';
    if (this.state === STATE.BATTLE) icon = '⚔️';
    if (this.state === STATE.HURT)   icon = '💥';
    if (!icon) return;
    ctx.save();
    ctx.font      = '14px serif';
    ctx.textAlign = 'center';
    ctx.fillText(icon, x, y);
    ctx.restore();
  }
}
