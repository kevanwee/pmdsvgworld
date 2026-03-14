// ─── Training Dummy ───────────────────────────────────────────────────────────
// The practice target that agents (Pokemon) attack when doing work.
// Visually: a wooden post + stuffed sandbag body with HP bar.

export class Dummy {
  constructor(x, y) {
    this.x       = x;
    this.y       = y;
    this.hp      = 1;          // 0-1 normalised
    this.maxHp   = 1;
    this.wobble  = 0;          // screen-shake offset
    this._hitCooldown = 0;
  }

  hit(dt) {
    this._hitCooldown -= dt;
    if (this._hitCooldown > 0) return;

    this.hp = Math.max(0, this.hp - 0.004);
    if (this.hp <= 0) this.hp = 1;   // respawn at full HP

    this.wobble          = 6;
    this._hitCooldown    = 80;
  }

  update(dt) {
    // Decay wobble
    this.wobble *= 0.85;
    if (Math.abs(this.wobble) < 0.1) this.wobble = 0;
  }

  render(ctx) {
    const x = this.x + this.wobble;
    const y = this.y;

    ctx.save();

    // Shadow
    ctx.fillStyle   = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 30, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Post (wooden pole)
    ctx.fillStyle = '#8b5e3c';
    ctx.fillRect(x - 3, y - 10, 6, 42);

    // Cross-brace
    ctx.fillRect(x - 10, y + 2, 20, 4);

    // Body (sandbag) – squash/stretch with wobble
    const squash = 1 + Math.abs(this.wobble) * 0.03;
    ctx.fillStyle = '#d4904a';
    ctx.save();
    ctx.translate(x, y + 6);
    ctx.scale(squash, 1 / squash);
    ctx.beginPath();
    ctx.roundRect(-12, -18, 24, 32, 6);
    ctx.fill();
    ctx.strokeStyle = '#a06030';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Stitching lines
    ctx.strokeStyle = '#8b4a20';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(-8, -12); ctx.lineTo(-8, 8);
    ctx.moveTo(0,  -16); ctx.lineTo(0, 10);
    ctx.moveTo(8,  -12); ctx.lineTo(8, 8);
    ctx.stroke();
    ctx.restore();

    // Head (ball)
    ctx.fillStyle = '#e8b878';
    ctx.beginPath();
    ctx.arc(x, y - 22, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c09050';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Face markings (X eyes when damaged)
    if (this.hp < 0.3) {
      ctx.strokeStyle = '#332211';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 5, y - 26); ctx.lineTo(x - 2, y - 23);
      ctx.moveTo(x - 2, y - 26); ctx.lineTo(x - 5, y - 23);
      ctx.moveTo(x + 5, y - 26); ctx.lineTo(x + 2, y - 23);
      ctx.moveTo(x + 2, y - 26); ctx.lineTo(x + 5, y - 23);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#332211';
      ctx.fillRect(x - 5, y - 24, 3, 2);
      ctx.fillRect(x + 2, y - 24, 3, 2);
    }

    // HP bar
    const barW = 40;
    const barH = 5;
    const bx   = x - barW / 2;
    const by   = y - 40;

    ctx.fillStyle = '#300';
    ctx.fillRect(bx, by, barW, barH);

    const hpColor = this.hp > 0.5 ? '#44dd44' : this.hp > 0.25 ? '#dddd22' : '#dd2222';
    ctx.fillStyle = hpColor;
    ctx.fillRect(bx, by, barW * this.hp, barH);

    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 0.5;
    ctx.strokeRect(bx, by, barW, barH);

    ctx.restore();
  }
}
