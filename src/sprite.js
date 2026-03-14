// ─── SpriteSheet ─────────────────────────────────────────────────────────────
// Handles loading + frame-cycling for a single PMD sprite animation.
//
// PMD sprite sheets: each ROW = one direction (0=South .. 7=SouthWest),
// each COLUMN = one animation frame.
// We infer frame count from image width / frameSize once the image loads.
//
// When a sprite fails to load (CORS / missing), we fall back to a coloured
// shape so the world still runs.

export class SpriteSheet {
  /**
   * @param {string}  url
   * @param {number}  frameSize   – pixel width/height of one frame
   * @param {number}  fps         – target animation speed
   * @param {string}  fallbackColor – CSS colour for placeholder
   * @param {string|null} shinyTint – optional CSS colour overlay for shiny tinting
   */
  constructor(url, frameSize = 24, fps = 8, fallbackColor = '#ff69b4', shinyTint = null) {
    this.shinyTint = shinyTint;
    this.frameSize     = frameSize;
    this.fps           = fps;
    this.fallbackColor = fallbackColor;
    this.loaded        = false;
    this.failed        = false;
    this.frameCount    = 4;       // updated after image loads
    this.dirCount      = 8;       // updated after image loads

    this._elapsed      = 0;
    this._frame        = 0;

    this.image = new Image();
    if (location.protocol !== 'file:') this.image.crossOrigin = 'anonymous';
    this.image.onload = () => {
      this.loaded     = true;
      this.frameCount = Math.max(1, Math.round(this.image.naturalWidth  / this.frameSize));
      this.dirCount   = Math.max(1, Math.round(this.image.naturalHeight / this.frameSize));
    };
    this.image.onerror = () => { this.failed = true; };
    this.image.src = url;
  }

  update(dt) {
    this._elapsed += dt;
    if (this._elapsed >= 1000 / this.fps) {
      this._elapsed = 0;
      this._frame   = (this._frame + 1) % this.frameCount;
    }
  }

  resetFrame() { this._frame = 0; this._elapsed = 0; }

  /**
   * Draw the current frame onto the canvas.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x         – screen x (top-left of sprite)
   * @param {number} y         – screen y (top-left of sprite)
   * @param {number} dirRow    – direction row (0-7)
   * @param {number} scale     – render scale multiplier
   * @param {number} alpha     – global alpha
   */
  draw(ctx, x, y, dirRow = 0, scale = 2, alpha = 1) {
    const fs     = this.frameSize;
    const drawW  = fs * scale;
    const drawH  = fs * scale;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (this.loaded) {
      const row = Math.min(dirRow, this.dirCount - 1);
      ctx.drawImage(
        this.image,
        this._frame * fs, row * fs, fs, fs,
        x, y, drawW, drawH,
      );
    } else {
      // Placeholder: coloured diamond/circle
      ctx.fillStyle   = this.fallbackColor;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth   = 1;
      const cx = x + drawW / 2;
      const cy = y + drawH / 2;
      const r  = drawW * 0.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }
}

// ─── SpriteSet ────────────────────────────────────────────────────────────────
// Groups all animations for one Pokemon.

export class SpriteSet {
  constructor(pokeDef) {
    const fs    = pokeDef.frameSize;
    const color = pokeDef.color;

    this.walk   = new SpriteSheet(pokeDef.animations.walk,   fs, 8,  color);
    this.idle   = new SpriteSheet(pokeDef.animations.idle,   fs, 4,  color);
    this.sleep  = new SpriteSheet(pokeDef.animations.sleep,  fs, 3,  color);
    this.attack = new SpriteSheet(pokeDef.animations.attack, fs, 10, color);
    this.hurt   = new SpriteSheet(pokeDef.animations.hurt,   fs, 10, color);
  }

  update(animKey, dt) {
    this[animKey]?.update(dt);
  }

  draw(animKey, ctx, x, y, dirRow, scale = 2, alpha = 1) {
    this[animKey]?.draw(ctx, x, y, dirRow, scale, alpha);
  }

  get(animKey) { return this[animKey]; }
}
