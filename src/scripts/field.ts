/**
 * The particle field behind the page: one WebGL2 draw call, no 3D library.
 * Particles travel between target shapes as the visitor scrolls. Each move
 * re-noises then denoises the point on the way, the same idea as a diffusion model.
 */

export type ShapeName = 'noise' | 'portrait' | 'clusters' | 'network' | 'landscape' | 'monogram';

interface Layout {
  x: number;
  y: number;
  scale: number;
  alpha: number;
  spin: number;
  size: number;
}

/** Must match --lo, --mid and --hi in global.css. */
const RAMP = [
  [0.294, 0.122, 0.82],
  [0.561, 0.373, 1.0],
  [0.965, 0.949, 1.0],
];

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec4 aFrom;
layout(location=1) in vec4 aTo;
layout(location=2) in float aSeed;
uniform float uMix,uTime,uSize,uAspect,uScale,uAlpha;
uniform vec2 uOffset,uPointer;
uniform mat3 uRot;
out float vHeat;
out float vAlpha;
const float DIST=3.2;

vec3 flow(vec3 p,float t){
  return vec3(
    sin(p.y*2.1+t)+sin(p.z*1.7-t*.7),
    sin(p.z*1.9+t*.8)+sin(p.x*2.3+t*.6),
    sin(p.x*1.8-t*.9)+sin(p.y*2.5+t*.5))*.5;
}

void main(){
  float m=smoothstep(aSeed*.42,.58+aSeed*.42,uMix);
  vec3 p=mix(aFrom.xyz,aTo.xyz,m);
  float ph=aSeed*6.2831;
  p+=flow(p*1.3+ph,uTime*.3+ph)*(.008+.34*sin(3.14159*m));
  p=uRot*p*uScale;
  p.xy+=uOffset;
  vec2 d=p.xy-uPointer;
  float r=length(d)+1e-4;
  float push=smoothstep(.42,0.,r);
  p.xy+=d/r*push*.13;
  p.z+=push*.2;
  float z=max(.5,DIST-p.z);
  gl_Position=vec4(p.x*DIST/(z*uAspect),p.y*DIST/z,0.,1.);
  // A few points become large and very faint: together they read as mist around the shape.
  float mist=step(.965,aSeed);
  gl_PointSize=uSize*(.6+aSeed*.8)*DIST/z*mix(1.,8.,mist);
  vHeat=mix(aFrom.w,aTo.w,m)+push*.45;
  vAlpha=uAlpha*(.78+.22*sin(uTime*1.1+ph*3.))*mix(.3,1.,smoothstep(-.85,.6,p.z))*mix(1.,.055,mist);
}`;

const FRAG = `#version 300 es
precision mediump float;
in float vHeat;
in float vAlpha;
out vec4 color;
uniform vec3 uC0,uC1,uC2;
void main(){
  vec2 c=gl_PointCoord-.5;
  float d=dot(c,c);
  if(d>.25)discard;
  float a=smoothstep(.25,.0,d)*vAlpha;
  float h=clamp(vHeat,0.,1.);
  vec3 ramp=h<.5?mix(uC0,uC1,h*2.):mix(uC1,uC2,(h-.5)*2.);
  color=vec4(ramp*a,a);
}`;

/** Small seeded generator so the shapes are identical on every visit. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (r: () => number) =>
  Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function noiseShape(n: number): Float32Array {
  const r = rng(11);
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = (r() - 0.5) * 6;
    out[i * 4 + 1] = (r() - 0.5) * 3.2;
    out[i * 4 + 2] = (r() - 0.5) * 2.4;
    out[i * 4 + 3] = r();
  }
  return out;
}

/** An organic folded surface, shown in the hero until a portrait is added. */
function blobShape(n: number): Float32Array {
  const r = rng(23);
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const u = r() * Math.PI * 2;
    const v = Math.acos(2 * r() - 1);
    const fold =
      Math.sin(u * 3 + v * 5) * 0.075 +
      Math.sin(v * 9 - u * 4) * 0.055 +
      Math.sin(u * 11 + v * 13) * 0.024 +
      Math.sin(u * 7 - v * 17) * 0.016;
    const radius = 0.84 + fold;
    out[i * 4] = radius * Math.sin(v) * Math.cos(u);
    out[i * 4 + 1] = radius * Math.cos(v);
    out[i * 4 + 2] = radius * Math.sin(v) * Math.sin(u);
    out[i * 4 + 3] = clamp01(0.5 + fold * 4.2 + gauss(r) * 0.05);
  }
  return out;
}

/** Looks like a 2D embedding projection: tight groups, each with its own colour band. */
function clustersShape(n: number): Float32Array {
  const r = rng(37);
  const K = 9;
  const centers = Array.from({ length: K }, (_, k) => {
    const angle = k * 2.399963;
    const dist = 0.45 + 1.15 * Math.sqrt((k + 0.5) / K);
    return {
      x: Math.cos(angle) * dist * 1.25,
      y: Math.sin(angle) * dist * 0.72,
      z: gauss(r) * 0.35,
      s: 0.09 + r() * 0.12,
      heat: k / (K - 1),
    };
  });
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = centers[Math.floor(r() * K)];
    const spread = r() < 0.1 ? 3.2 : 1;
    out[i * 4] = c.x + gauss(r) * c.s * spread;
    out[i * 4 + 1] = c.y + gauss(r) * c.s * spread;
    out[i * 4 + 2] = c.z + gauss(r) * c.s;
    out[i * 4 + 3] = clamp01(c.heat + gauss(r) * 0.05);
  }
  return out;
}

/** A layered feed-forward network: dense points at the nodes, a thin scatter along the edges. */
function networkShape(n: number): Float32Array {
  const r = rng(53);
  const layers = [4, 7, 9, 7, 4].map((count, li, all) =>
    Array.from({ length: count }, (_, k) => ({
      x: (li / (all.length - 1) - 0.5) * 3.1,
      y: ((k + 0.5) / count - 0.5) * (0.65 + count * 0.16),
    })),
  );
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    let x: number;
    let y: number;
    if (r() < 0.32) {
      const layer = layers[Math.floor(r() * layers.length)];
      const node = layer[Math.floor(r() * layer.length)];
      x = node.x + gauss(r) * 0.022;
      y = node.y + gauss(r) * 0.022;
    } else {
      const li = Math.floor(r() * (layers.length - 1));
      const a = layers[li][Math.floor(r() * layers[li].length)];
      const b = layers[li + 1][Math.floor(r() * layers[li + 1].length)];
      const t = r();
      x = a.x + (b.x - a.x) * t;
      y = a.y + (b.y - a.y) * t;
    }
    out[i * 4] = x;
    out[i * 4 + 1] = y;
    out[i * 4 + 2] = gauss(r) * 0.05;
    out[i * 4 + 3] = clamp01(x / 3.1 + 0.5 + gauss(r) * 0.04);
  }
  return out;
}

/** A loss surface seen from above: bright in the valleys, where a model wants to end up. */
function landscapeShape(n: number): Float32Array {
  const r = rng(71);
  const bowls = [
    [-0.9, -0.2, 0.75, 0.7],
    [0.85, 0.4, 0.95, 0.85],
    [0.1, -0.9, 0.5, 0.45],
    [-0.3, 0.95, 0.6, 0.4],
  ];
  const height = (x: number, z: number) => {
    let h = 0.55 + 0.05 * Math.sin(x * 7) * Math.cos(z * 6);
    for (const [cx, cz, s, depth] of bowls) {
      h -= depth * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));
    }
    return h;
  };
  const tilt = 1.02;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * 5.2;
    const z = (r() - 0.5) * 4;
    const h = height(x, z);
    const y = h * 0.8;
    out[i * 4] = x;
    out[i * 4 + 1] = y * cos - z * sin * 0.72 - 0.05;
    out[i * 4 + 2] = y * sin + z * cos * 0.72;
    out[i * 4 + 3] = clamp01(0.92 - h * 0.85);
  }
  return out;
}

/** Fills n points with weighted samples from an image. */
function sampleWeights(
  n: number,
  size: number,
  weights: Float32Array,
  luminance: Float32Array,
  scale: number,
  depth: number,
): Float32Array {
  const r = rng(97);
  const cdf = new Float32Array(weights.length);
  let total = 0;
  for (let i = 0; i < weights.length; i++) {
    total += weights[i];
    cdf[i] = total;
  }
  const out = new Float32Array(n * 4);
  if (total <= 0) return out;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const target = r() * total;
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const px = lo % size;
    const py = (lo / size) | 0;
    const lum = luminance[lo];
    out[i * 4] = ((px + r()) / size - 0.5) * 2 * scale;
    out[i * 4 + 1] = -((py + r()) / size - 0.5) * 2 * scale;
    out[i * 4 + 2] = (lum - 0.5) * depth + gauss(r) * 0.006;
    out[i * 4 + 3] = clamp01(lum * 1.05 + gauss(r) * 0.025);
    cx += out[i * 4];
    cy += out[i * 4 + 1];
  }
  // Centre on where the points actually landed, so an off-centre subject still sits in its spot.
  cx /= n;
  cy /= n;
  for (let i = 0; i < n; i++) {
    out[i * 4] -= cx;
    out[i * 4 + 1] -= cy;
  }
  return out;
}

async function portraitShape(url: string, n: number): Promise<Float32Array> {
  const img = new Image();
  img.src = url;
  await img.decode();

  const S = 320;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  // Cover-crop, biased upward so the face stays in frame on tall photos.
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) * 0.25;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, S, S);
  const { data } = ctx.getImageData(0, 0, S, S);

  // Estimate the backdrop from the top and side edges, so any photo background drops out.
  let br = 0;
  let bg = 0;
  let bb = 0;
  let edge = 0;
  let transparent = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (y > 3 && x > 3 && x < S - 4) continue;
      const i = (y * S + x) * 4;
      if (data[i + 3] < 32) transparent++;
      br += data[i];
      bg += data[i + 1];
      bb += data[i + 2];
      edge++;
    }
  }
  const hasAlpha = transparent / edge > 0.2;
  br /= edge;
  bg /= edge;
  bb /= edge;

  // What differs most from the backdrop glows: a dark figure against a bright sky lights up
  // and the sky falls away, while a lit face on a dark backdrop stays a normal portrait.
  // A transparent cut-out has no backdrop to compare with, so it uses plain brightness.
  const bgLum = (0.299 * br + 0.587 * bg + 0.114 * bb) / 255;
  const glow = new Float32Array(S * S);
  let maxGlow = 0.05;
  let minLum = 1;
  let maxLum = 0;
  for (let i = 0; i < S * S; i++) {
    if (data[i * 4 + 3] <= 40) continue;
    const lum = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
    glow[i] = hasAlpha ? lum : Math.abs(lum - bgLum);
    if (glow[i] > maxGlow) maxGlow = glow[i];
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }
  // A cut-out is normalised over its own range, so a dark photo still spans the full ramp.
  const low = hasAlpha ? minLum : 0;
  const high = hasAlpha ? Math.max(low + 0.05, maxLum) : maxGlow;

  const weights = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const a = data[i * 4 + 3] / 255;
      const strength = clamp01((glow[i] - low) / (high - low));
      // White at the head and shoulders, sinking through violet into the black below.
      const sink = clamp01((y / S - 0.3) / 0.62);
      glow[i] = strength * (1 - 0.7 * sink * sink * (3 - 2 * sink));
      const dx = (x / S - 0.5) * 2;
      const dy = (y / S - 0.5) * 2;
      const vignette =
        clamp01((1.18 - Math.hypot(dx, dy * 0.92)) / 0.3) * clamp01((1 - y / S) / 0.22);
      let subject = 1;
      if (!hasAlpha) {
        const dist =
          Math.hypot(data[i * 4] - br, data[i * 4 + 1] - bg, data[i * 4 + 2] - bb) / 441;
        subject = clamp01((dist - 0.1) * 3);
      }
      weights[i] = a * vignette * subject * (0.04 + Math.pow(strength, 1.6));
    }
  }
  return sampleWeights(n, S, weights, glow, 1, 0.34);
}

async function monogramShape(text: string, n: number): Promise<Float32Array> {
  const S = 420;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const family = '"Bricolage Grotesque Variable", system-ui, sans-serif';
  await document.fonts.load(`700 120px ${family}`, text).catch(() => undefined);
  let size = 300;
  ctx.font = `700 ${size}px ${family}`;
  const width = ctx.measureText(text).width;
  size = Math.min(size, (size * S * 0.92) / Math.max(width, 1));
  ctx.font = `700 ${size}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, S / 2, S / 2);
  const { data } = ctx.getImageData(0, 0, S, S);

  const weights = new Float32Array(S * S);
  const heat = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      weights[i] = data[i * 4 + 3] / 255;
      heat[i] = 0.1 + 0.9 * (x / S);
    }
  }
  return sampleWeights(n, S, weights, heat, 1.15, 0.04);
}

/** World units: y spans -1 to 1 and x spans -aspect to aspect at the screen plane. */
function layoutFor(shape: ShapeName, aspect: number, wide: boolean): Layout {
  switch (shape) {
    case 'noise':
      return { x: 0, y: 0, scale: 1, alpha: 0.5, spin: 0, size: 2.1 };
    case 'portrait':
      return wide
        ? { x: aspect * 0.5, y: 0.08, scale: 0.78, alpha: 1, spin: 0, size: 2.5 }
        : { x: 0, y: 0.5, scale: aspect * 0.86, alpha: 0.9, spin: 0, size: 2 };
    case 'clusters':
      return wide
        ? { x: aspect * 0.1, y: 0, scale: 1.02, alpha: 0.46, spin: 0.35, size: 2.1 }
        : { x: 0, y: 0, scale: aspect * 0.72, alpha: 0.36, spin: 0.35, size: 1.8 };
    case 'network':
      return wide
        ? { x: aspect * 0.28, y: 0, scale: 0.86, alpha: 0.32, spin: 0.14, size: 1.7 }
        : { x: 0, y: 0, scale: aspect * 0.62, alpha: 0.26, spin: 0.14, size: 1.5 };
    case 'landscape':
      return wide
        ? { x: 0, y: -0.15, scale: 1.05, alpha: 0.22, spin: 0.1, size: 1.8 }
        : { x: 0, y: -0.1, scale: 0.62, alpha: 0.22, spin: 0.1, size: 1.6 };
    case 'monogram':
      return wide
        ? { x: aspect * 0.66, y: -0.3, scale: aspect * 0.26, alpha: 0.9, spin: 0, size: 1.7 }
        : { x: 0, y: -0.62, scale: aspect * 0.72, alpha: 0.26, spin: 0, size: 1.5 };
  }
}

export interface Field {
  /** Promise for the async shapes, so the intro never starts on an unfinished image. */
  ready: Promise<void>;
  /** Position along the shape sequence, for example 1.4 sits between shape 1 and 2. */
  setProgress(p: number): void;
  renderOnce(): void;
  tick(deltaSeconds: number): void;
}

export function createField(
  canvas: HTMLCanvasElement,
  sequence: ShapeName[],
  opts: { still: boolean },
): Field | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    canvas.remove();
    return null;
  }

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  gl.useProgram(program);
  const U = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    mix: U('uMix'),
    time: U('uTime'),
    size: U('uSize'),
    aspect: U('uAspect'),
    scale: U('uScale'),
    alpha: U('uAlpha'),
    offset: U('uOffset'),
    pointer: U('uPointer'),
    rot: U('uRot'),
  };
  gl.uniform3fv(U('uC0'), RAMP[0]);
  gl.uniform3fv(U('uC1'), RAMP[1]);
  gl.uniform3fv(U('uC2'), RAMP[2]);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  const small = innerWidth < 900 || (navigator.hardwareConcurrency ?? 8) <= 4;
  const N = small ? 16000 : 38000;

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const seeds = new Float32Array(N);
  const seedRandom = rng(5);
  for (let i = 0; i < N; i++) seeds[i] = seedRandom();
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);

  const buffers = new Map<ShapeName, WebGLBuffer>();
  const upload = (name: ShapeName, data: Float32Array) => {
    let buffer = buffers.get(name);
    if (!buffer) {
      buffer = gl.createBuffer()!;
      buffers.set(name, buffer);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    boundIndex = -1;
  };

  let boundIndex = -1;
  const bind = (index: number) => {
    if (index === boundIndex) return;
    boundIndex = index;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.get(sequence[index])!);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.get(sequence[index + 1])!);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  };

  const wanted = new Set(sequence);
  if (wanted.has('noise')) upload('noise', noiseShape(N));
  if (wanted.has('portrait')) upload('portrait', blobShape(N));
  if (wanted.has('clusters')) upload('clusters', clustersShape(N));
  if (wanted.has('network')) upload('network', networkShape(N));
  if (wanted.has('landscape')) upload('landscape', landscapeShape(N));
  if (wanted.has('monogram')) upload('monogram', blobShape(N));

  let aspect = 1;
  let wide = true;
  let dpr = 1;
  let layouts: Layout[] = [];
  const resize = () => {
    const width = canvas.clientWidth || innerWidth;
    const height = canvas.clientHeight || innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    aspect = width / height;
    wide = width >= 900;
    layouts = sequence.map((s) => layoutFor(s, aspect, wide));
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (opts.still) draw();
  };

  // State, smoothed every frame.
  let target = 0;
  let progress = 0;
  let time = 0;
  const pointer = { x: 99, y: 99, tx: 99, ty: 99 };
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };

  addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      const nx = (e.clientX / innerWidth) * 2 - 1;
      const ny = -((e.clientY / innerHeight) * 2 - 1);
      pointer.tx = nx * aspect;
      pointer.ty = ny;
      tilt.tx = ny * 0.09;
      tilt.ty = nx * 0.14;
    },
    { passive: true },
  );

  function draw() {
    const last = sequence.length - 2;
    const index = Math.min(last, Math.max(0, Math.floor(progress)));
    const mix = clamp01(progress - index);
    bind(index);

    const a = layouts[index];
    const b = layouts[index + 1];
    const e = mix * mix * (3 - 2 * mix);
    const L = (k: keyof Layout) => a[k] + (b[k] - a[k]) * e;

    const yaw = L('spin') * Math.sin(time * 0.16) * 1.6 + tilt.y;
    const pitch = tilt.x;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cx = Math.cos(pitch);
    const sx = Math.sin(pitch);

    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.uniformMatrix3fv(u.rot, false, [cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]);
    gl!.uniform1f(u.mix, mix);
    gl!.uniform1f(u.time, time);
    gl!.uniform1f(u.size, L('size') * dpr);
    gl!.uniform1f(u.aspect, aspect);
    gl!.uniform1f(u.scale, L('scale'));
    gl!.uniform1f(u.alpha, L('alpha'));
    gl!.uniform2f(u.offset, L('x'), L('y'));
    gl!.uniform2f(u.pointer, pointer.x, pointer.y);
    gl!.drawArrays(gl!.POINTS, 0, N);
  }

  resize();
  addEventListener('resize', resize, { passive: true });

  const work: Promise<unknown>[] = [];
  const avatar = canvas.dataset.avatar;
  if (avatar && wanted.has('portrait')) {
    work.push(
      portraitShape(avatar, N)
        .then((data) => upload('portrait', data))
        .catch(() => undefined),
    );
  }
  const monogram = canvas.dataset.monogram;
  if (monogram && wanted.has('monogram')) {
    work.push(
      monogramShape(monogram, N)
        .then((data) => upload('monogram', data))
        .catch(() => undefined),
    );
  }

  return {
    ready: Promise.all(work).then(() => undefined),
    setProgress(p) {
      target = p;
      if (opts.still) progress = p;
    },
    renderOnce: draw,
    tick(dt) {
      time += dt;
      // Low on purpose: shapes should drift into each other, not snap.
      const k = 1 - Math.exp(-dt * 3.6);
      progress += (target - progress) * k;
      pointer.x += (pointer.tx - pointer.x) * (1 - Math.exp(-dt * 9));
      pointer.y += (pointer.ty - pointer.y) * (1 - Math.exp(-dt * 9));
      tilt.x += (tilt.tx - tilt.x) * (1 - Math.exp(-dt * 3));
      tilt.y += (tilt.ty - tilt.y) * (1 - Math.exp(-dt * 3));
      draw();
    },
  };
}
