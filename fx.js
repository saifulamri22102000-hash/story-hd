'use strict';
// Clarity / colour effects. One set of numbers drives three renderers:
// the live preview (CSS + SVG filter), photos (canvas pixels) and video (ffmpeg).

const FX = [
  { id: 'asli', label: 'Asli', sharp: 0, c: 1, s: 1, b: 1, warm: 0 },
  { id: 'jernih', label: 'Jernih HD', sharp: 0.9, c: 1.08, s: 1.12, b: 1.02, warm: 0 },
  { id: 'vivid', label: 'Vivid', sharp: 0.7, c: 1.12, s: 1.38, b: 1.02, warm: 0 },
  { id: 'hangat', label: 'Hangat', sharp: 0.6, c: 1.06, s: 1.15, b: 1.02, warm: 1 },
  { id: 'sejuk', label: 'Sejuk', sharp: 0.6, c: 1.06, s: 1.08, b: 1.01, warm: -1 },
  { id: 'sinema', label: 'Sinema', sharp: 0.5, c: 1.2, s: 0.88, b: 0.97, warm: 0.4 },
  { id: 'lembut', label: 'Lembut', sharp: 0.25, c: 0.95, s: 1.06, b: 1.05, warm: 0.3 },
  { id: 'mono', label: 'Mono', sharp: 0.7, c: 1.15, s: 0, b: 1, warm: 0 },
];
const SHARP_KERNEL = 0.3; // neighbour weight per unit of sharpness
const TINT = 0.08;        // red/blue gain per unit of warmth

state.fx = 'jernih';
let fxThumbUrl = '';
let fxComparing = false;

function fxParams(id) {
  const preset = FX.find((f) => f.id === (id || state.fx)) || FX[0];
  const k = id ? 1 : num('fxAmount', 100) / 100;
  const mix = (v) => 1 + (v - 1) * k;
  return { sharp: preset.sharp * k, c: mix(preset.c), s: mix(preset.s), b: mix(preset.b), warm: preset.warm * k };
}

function fxIsIdentity(p) {
  const near = (a, b) => Math.abs(a - b) < 0.005;
  return p.sharp < 0.01 && near(p.c, 1) && near(p.s, 1) && near(p.b, 1) && near(p.warm, 0);
}

/* ---- live preview ---- */

function applyFxPreview() {
  const p = fxParams();
  const off = fxComparing || fxIsIdentity(p);
  const a = p.sharp * SHARP_KERNEL;
  $('fxSharp').setAttribute('kernelMatrix', `0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0`);
  $('fxTint').setAttribute('values',
    `${1 + TINT * p.warm} 0 0 0 0  0 1 0 0 0  0 0 ${1 - TINT * p.warm} 0 0  0 0 0 1 0`);
  const css = off ? 'none'
    : `url(#fxSvg) contrast(${p.c.toFixed(3)}) brightness(${p.b.toFixed(3)}) saturate(${p.s.toFixed(3)})`;
  $('imgPreview').style.filter = css;
  $('vidPreview').style.filter = css;
}

function fxThumbCss(id) {
  const p = fxParams(id);
  let css = `contrast(${p.c}) brightness(${p.b}) saturate(${p.s})`;
  if (p.warm > 0) css += ` sepia(${0.3 * p.warm})`;
  if (p.warm < 0) css += ` hue-rotate(${-14 * p.warm}deg)`;
  return css;
}

function renderFxStrip() {
  const strip = $('fxStrip');
  strip.textContent = '';
  FX.forEach((f) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fx';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(f.id === state.fx));
    const th = document.createElement('span');
    th.className = 'th';
    const pic = document.createElement('i');
    if (fxThumbUrl) pic.style.backgroundImage = `url("${fxThumbUrl}")`;
    pic.style.filter = fxThumbCss(f.id);
    th.appendChild(pic);
    btn.appendChild(th);
    btn.appendChild(document.createTextNode(f.label));
    btn.addEventListener('click', () => {
      state.fx = f.id;
      strip.querySelectorAll('.fx').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
      applyFxPreview();
    });
    strip.appendChild(btn);
  });
}

function setFxThumb(source, sw, sh) {
  if (!sw || !sh) return;
  const canvas = document.createElement('canvas');
  const s = 160 / Math.max(sw, sh);
  canvas.width = Math.max(1, Math.round(sw * s));
  canvas.height = Math.max(1, Math.round(sh * s));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  try {
    fxThumbUrl = canvas.toDataURL('image/jpeg', 0.7);
  } catch (_) {
    fxThumbUrl = '';
  }
  renderFxStrip();
}

// Called by setMedia() whenever a new photo or video is chosen.
function refreshFx() {
  fxThumbUrl = '';
  renderFxStrip();
  applyFxPreview();
  if (state.kind === 'image') {
    const img = $('imgPreview');
    const done = () => setFxThumb(img, img.naturalWidth, img.naturalHeight);
    if (img.complete && img.naturalWidth) done();
    else img.addEventListener('load', done, { once: true });
  }
}

$('vidPreview').addEventListener('loadeddata', () => {
  const v = $('vidPreview');
  if (state.kind !== 'video') return;
  // Seek a little in: the very first frame is often black.
  const grab = () => setFxThumb(v, v.videoWidth, v.videoHeight);
  if (v.duration > 1) {
    v.addEventListener('seeked', () => { grab(); v.currentTime = 0; }, { once: true });
    v.currentTime = Math.min(1, v.duration / 3);
  } else {
    grab();
  }
});

/* ---- photo: canvas pixels ---- */

function applyFxToCanvas(ctx, w, h) {
  const p = fxParams();
  if (fxIsIdentity(p)) return;
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  const rGain = 1 + TINT * p.warm, bGain = 1 - TINT * p.warm;
  const { c, s, b: br } = p;
  for (let i = 0; i < d.length; i += 4) {
    let r = ((d[i] * rGain - 128) * c + 128) * br;
    let g = ((d[i + 1] - 128) * c + 128) * br;
    let b = ((d[i + 2] * bGain - 128) * c + 128) * br;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = gray + (r - gray) * s;
    d[i + 1] = gray + (g - gray) * s;
    d[i + 2] = gray + (b - gray) * s;
  }
  if (p.sharp >= 0.01) {
    const a = p.sharp * SHARP_KERNEL;
    const centre = 1 + 4 * a;
    const src = new Uint8ClampedArray(d);
    const row = w * 4;
    for (let y = 1; y < h - 1; y++) {
      let i = y * row + 4;
      for (let x = 1; x < w - 1; x++, i += 4) {
        d[i] = src[i] * centre - a * (src[i - 4] + src[i + 4] + src[i - row] + src[i + row]);
        d[i + 1] = src[i + 1] * centre - a * (src[i - 3] + src[i + 5] + src[i + 1 - row] + src[i + 1 + row]);
        d[i + 2] = src[i + 2] * centre - a * (src[i - 2] + src[i + 6] + src[i + 2 - row] + src[i + 2 + row]);
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

/* ---- video: ffmpeg filter chain (leading comma included) ---- */

function fxFilters() {
  const p = fxParams();
  if (fxIsIdentity(p)) return '';
  let f = '';
  if (Math.abs(p.warm) >= 0.005) {
    f += `,colorbalance=rm=${(0.1 * p.warm).toFixed(3)}:bm=${(-0.1 * p.warm).toFixed(3)}`;
  }
  // Measured against a simulated WhatsApp re-encode: removing sensor noise
  // first keeps more real detail, while strong sharpening amplifies noise and
  // WhatsApp then turns it into blocks. So denoise, then sharpen only lightly.
  if (p.sharp >= 0.01) {
    const dn = Math.min(1.5, p.sharp);
    f = `,hqdn3d=${(3 * dn).toFixed(1)}:${(2 * dn).toFixed(1)}:${(4 * dn).toFixed(1)}:${(3 * dn).toFixed(1)}` + f;
  }
  f += `,eq=contrast=${p.c.toFixed(3)}:saturation=${p.s.toFixed(3)}:brightness=${((p.b - 1) * 0.5).toFixed(3)}`;
  if (p.sharp >= 0.01) f += `,unsharp=5:5:${Math.min(0.6, p.sharp * 0.35).toFixed(2)}:5:5:0`;
  return f + ',format=yuv420p';
}

/* ---- wiring ---- */

bindRange('fxAmount');
$('fxAmount').addEventListener('input', applyFxPreview);

const fxCompareBtn = $('fxCompare');
const setComparing = (on) => {
  fxComparing = on;
  fxCompareBtn.classList.toggle('on', on);
  applyFxPreview();
};
fxCompareBtn.addEventListener('pointerdown', () => setComparing(true));
['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((t) =>
  fxCompareBtn.addEventListener(t, () => setComparing(false)));
fxCompareBtn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') setComparing(true); });
fxCompareBtn.addEventListener('keyup', () => setComparing(false));

renderFxStrip();
