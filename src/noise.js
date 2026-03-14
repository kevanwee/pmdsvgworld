// Simple value noise – deterministic pseudo-random 2D noise.
// Returns values in [0, 1].

function hash(x, y, seed) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.3) * 43758.5453123;
  return n - Math.floor(n);
}

function lerp(a, b, t) { return a + t * (b - a); }
function smoothstep(t) { return t * t * (3 - 2 * t); }

// Single-octave value noise
function noise(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u  = smoothstep(xf);
  const v  = smoothstep(yf);

  const a = hash(xi,     yi,     seed);
  const b = hash(xi + 1, yi,     seed);
  const c = hash(xi,     yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);

  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

// Fractional Brownian Motion – layered noise for richer terrain
export function fbm(x, y, seed = 0, octaves = 4, persistence = 0.5, lacunarity = 2.0) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue  = 0;

  for (let i = 0; i < octaves; i++) {
    value    += noise(x * frequency, y * frequency, seed + i * 131) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return value / maxValue;
}
