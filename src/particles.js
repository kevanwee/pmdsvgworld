// Simple particle system for visual effects (ZZZ sleep, sparkle battle, etc.)

export class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  // ── Emitters ───────────────────────────────────────────────────────────────

  emitZZZ(x, y) {
    if (Math.random() > 0.05) return;  // throttle
    this.particles.push({
      type: 'zzz', x, y,
      vx: (Math.random() - 0.3) * 0.4,
      vy: -0.6 - Math.random() * 0.4,
      alpha: 1,
      life: 1400,
      maxLife: 1400,
      size: 10 + Math.random() * 6,
      letter: 'Z',
    });
  }

  emitSpark(x, y) {
    const count = 4 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i / count) + Math.random() * 0.5;
      const speed = 1.5 + Math.random() * 2;
      this.particles.push({
        type: 'spark', x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 1,
        life: 500 + Math.random() * 300,
        maxLife: 800,
        size: 3 + Math.random() * 3,
        color: `hsl(${30 + Math.random() * 40},100%,70%)`,
      });
    }
  }

  emitHeart(x, y) {
    if (Math.random() > 0.06) return;
    this.particles.push({
      type: 'heart', x, y,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -0.8 - Math.random() * 0.3,
      alpha: 1,
      life: 1200,
      maxLife: 1200,
      size: 12,
    });
  }

  emitWork(x, y, color = '#fff') {
    if (Math.random() > 0.12) return;
    this.particles.push({
      type: 'work', x, y,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -1.2 - Math.random() * 0.8,
      alpha: 1,
      life: 600,
      maxLife: 600,
      size: 4,
      color,
    });
  }

  // ── Update & render ────────────────────────────────────────────────────────

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }

      p.x     += p.vx;
      p.y     += p.vy;
      p.alpha  = Math.max(0, p.life / p.maxLife);

      if (p.type === 'spark') {
        p.vy += 0.04;  // gravity
      }
    }
  }

  render(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;

      switch (p.type) {
        case 'zzz': {
          ctx.font      = `bold ${p.size}px "Press Start 2P", monospace`;
          ctx.fillStyle = '#aaccff';
          ctx.strokeStyle = '#224466';
          ctx.lineWidth = 2;
          ctx.strokeText(p.letter, p.x, p.y);
          ctx.fillText(p.letter, p.x, p.y);
          break;
        }
        case 'spark': {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'heart': {
          ctx.font      = `${p.size}px serif`;
          ctx.fillStyle = '#ff4499';
          ctx.fillText('♥', p.x, p.y);
          break;
        }
        case 'work': {
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          break;
        }
      }
      ctx.restore();
    }
  }
}
