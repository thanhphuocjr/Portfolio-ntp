import gsap from 'gsap';

let noiseTile: HTMLCanvasElement | null = null;

function getNoiseTile() {
  if (noiseTile) return noiseTile;
  noiseTile = document.createElement('canvas');
  noiseTile.width = noiseTile.height = 128;
  const ctx = noiseTile.getContext('2d')!;
  const data = ctx.createImageData(128, 128);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = Math.random() * 255;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return noiseTile;
}

/** Resolves a photo from coarse blocks and static into the sharp image, like a sampler finishing. */
export function denoiseImage(img: HTMLImageElement) {
  const box = img.parentElement!;
  const w = Math.min(box.clientWidth, 720);
  const h = Math.round((w * box.clientHeight) / box.clientWidth);
  if (!w || !h || !img.naturalWidth) return;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  box.append(canvas);
  const ctx = canvas.getContext('2d')!;
  const small = document.createElement('canvas');
  const sctx = small.getContext('2d')!;

  // Same framing as the image's object-fit, as a destination rectangle. A source rectangle would be
  // wrong here: with srcset, naturalWidth is density-corrected and differs from the real pixels.
  const fit = getComputedStyle(img).objectFit === 'contain' ? Math.min : Math.max;
  const scale = fit(w / img.naturalWidth, h / img.naturalHeight);
  const coverW = img.naturalWidth * scale;
  const coverH = img.naturalHeight * scale;
  const coverX = (w - coverW) / 2;
  const coverY = (h - coverH) / 2;

  const pattern = ctx.createPattern(getNoiseTile(), 'repeat')!;
  const state = { t: 1 };
  const draw = () => {
    const t = state.t;
    const block = Math.max(1, Math.round(1 + 44 * t * t));
    small.width = Math.max(1, Math.ceil(w / block));
    small.height = Math.max(1, Math.ceil(h / block));
    const fx = small.width / w;
    const fy = small.height / h;
    sctx.drawImage(img, coverX * fx, coverY * fy, coverW * fx, coverH * fy);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, w, h);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(1, t * 1.3);
    ctx.fillStyle = pattern;
    ctx.fillRect(coverX, coverY, coverW, coverH);
  };
  draw();

  gsap.to(state, {
    t: 0,
    duration: 1.5,
    ease: 'power2.out',
    onUpdate: draw,
    onComplete: () => {
      gsap.to(canvas, { autoAlpha: 0, duration: 0.2, onComplete: () => canvas.remove() });
    },
  });
}
