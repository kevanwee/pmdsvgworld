import { NPC, STATE } from './npc.js';
import { TILE_SIZE, SCALE, BATTLE_DUR } from './config.js';

const rand = (min, max) => min + Math.random() * (max - min);

// ─── Agent states (extends NPC states) ───────────────────────────────────────
export const AGENT_STATE = {
  ...STATE,
  WORK:     'work',   // walking to dummy then attacking it
  COMPLETE: 'complete',
};

// ─── Agent ────────────────────────────────────────────────────────────────────
// Extends NPC with agent-specific behaviour:
//   • WORK state: moves toward the dummy target and attacks it
//   • When two idle agents collide they battle each other
//   • Displays a task label / status badge
export class Agent extends NPC {
  /**
   * @param {object}  pokeDef   – from POKEMON_DEFS
   * @param {number}  x
   * @param {number}  y
   * @param {TileMap} tileMap
   * @param {object}  agentMeta – { name, task }
   */
  constructor(pokeDef, x, y, tileMap, agentMeta = {}) {
    super(pokeDef, x, y, tileMap);
    this.agentName = agentMeta.name ?? pokeDef.name;
    this.task      = agentMeta.task ?? null;
    this.agentState = AGENT_STATE.IDLE;

    // Reference to the world's dummy target (set by AgentWorld)
    this.dummy    = null;
    this.workTimer = 0;
    this.workDuration = rand(2000, 5000);

    // Work queue – array of task strings
    this.workQueue = [];
    this.currentWork = null;
  }

  // ── Public API (called by AgentWorld) ─────────────────────────────────────
  assignWork(taskLabel) {
    this.workQueue.push(taskLabel);
  }

  // ── Update override ───────────────────────────────────────────────────────
  update(dt, allNPCs, particles) {
    // WORK and COMPLETE are handled here; rest delegated to parent
    if (this.state === AGENT_STATE.WORK) {
      this._updateWork(dt, particles);
      this.sprites.update('attack', dt);
      this.timer += dt;
      this.interactCooldown -= dt;
      return;
    }

    super.update(dt, allNPCs, particles);

    // After parent update, check if we should pull from work queue
    if ((this.state === STATE.IDLE) && this.workQueue.length > 0 && Math.random() < 0.005) {
      this.currentWork = this.workQueue.shift();
      this._startWork();
    }
  }

  _startWork() {
    if (!this.dummy) return;
    this.state    = AGENT_STATE.WORK;
    this.timer    = 0;
    this.workTimer = 0;
    this.workDuration = rand(2500, 6000);
    this.sprites.get('attack')?.resetFrame();
  }

  _updateWork(dt, particles) {
    this.workTimer += dt;

    if (!this.dummy) {
      this.state = STATE.IDLE;
      return;
    }

    const dx   = this.dummy.x - this.x;
    const dy   = this.dummy.y - this.y;
    const dist = Math.hypot(dx, dy);

    // Approach dummy
    const closeEnough = this.def.frameSize * SCALE * 1.2;
    if (dist > closeEnough) {
      const step = (this.speed * 1.2 * dt) / 1000;
      const nx   = this.x + (dx / dist) * step;
      const ny   = this.y + (dy / dist) * step;
      if (this.tileMap.isWalkablePx(nx, ny)) {
        this.x = nx;
        this.y = ny;
      }
      // Walking anim while approaching
      this.sprites.update('walk', dt);
    } else {
      // Attacking dummy
      this.dummy.hit(dt);
      particles.emitSpark(
        this.dummy.x + (Math.random() - 0.5) * 20,
        this.dummy.y + (Math.random() - 0.5) * 20,
      );
      particles.emitWork(
        this.x + (Math.random() - 0.5) * 30,
        this.y - 20,
        this.def.color,
      );
    }

    if (this.workTimer >= this.workDuration) {
      this.currentWork = null;
      this.state       = STATE.IDLE;
      this.timer       = 0;
      this.duration    = rand(1500, 3000);
    }
  }

  // ── Render override ───────────────────────────────────────────────────────
  render(ctx) {
    super.render(ctx);

    // Agent task badge
    if (this.state === AGENT_STATE.WORK && this.currentWork) {
      const fs    = this.def.frameSize;
      const size  = fs * SCALE;
      const sx    = this.x - size / 2;
      const sy    = this.y - size / 2;

      ctx.save();
      ctx.font      = '7px "Press Start 2P", monospace';
      ctx.textAlign = 'center';

      const label = this.currentWork.length > 16
        ? this.currentWork.slice(0, 14) + '…'
        : this.currentWork;

      const tw = ctx.measureText(label).width;
      const bx = this.x - tw / 2 - 4;
      const by = sy - 32;
      const bw = tw + 8;
      const bh = 13;

      ctx.fillStyle   = 'rgba(0,0,0,0.7)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = this.def.color;
      ctx.lineWidth   = 1;
      ctx.strokeRect(bx, by, bw, bh);

      ctx.fillStyle = this.def.color;
      ctx.fillText(label, this.x, by + 9);
      ctx.restore();
    }

    // Agent name badge (bottom)
    if (this.agentName !== this.def.name) {
      const fs   = this.def.frameSize;
      const size = fs * SCALE;
      const sy   = this.y + size / 2 + 2;
      ctx.save();
      ctx.font      = '7px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffdd44';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeText(`[${this.agentName}]`, this.x, sy + 9);
      ctx.fillText(`[${this.agentName}]`,   this.x, sy + 9);
      ctx.restore();
    }
  }
}
