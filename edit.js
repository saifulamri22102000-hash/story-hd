'use strict';
// Editing helpers: manual adjustments, trim from the playhead, live preview of
// rotation / speed, and previewing the song together with the video.

/* ---- manual adjustments ---- */

const ADJ = ['adjBright', 'adjContrast', 'adjSat', 'adjWarm', 'adjSharp'];

function syncAdj() {
  ADJ.forEach((id) => {
    const v = +$(id).value;
    $(id + 'Out').textContent = (v > 0 ? '+' : '') + v;
  });
  applyFxPreview();
}
ADJ.forEach((id) => $(id).addEventListener('input', syncAdj));
$('adjReset').addEventListener('click', () => {
  ADJ.forEach((id) => { $(id).value = 0; });
  syncAdj();
});
syncAdj();

/* ---- trim from the playhead ---- */

function flash(btn, text) {
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old;
  btn.textContent = text;
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = old; }, 1400);
}

$('markStart').addEventListener('click', () => {
  const v = $('vidPreview');
  const t = Math.round(v.currentTime * 10) / 10;
  const end = num('start', 0) + num('dur', 30);
  $('start').value = t;
  // Keep the end point where it was when it is still after the new start.
  if (end > t + 0.5) $('dur').value = Math.round((end - t) * 10) / 10;
  flash($('markStart'), `✓ Mulai ${t.toFixed(1)} dtk`);
});

$('markEnd').addEventListener('click', () => {
  const v = $('vidPreview');
  const start = num('start', 0);
  const d = Math.round((v.currentTime - start) * 10) / 10;
  if (d < 0.5) {
    flash($('markEnd'), 'Putar lewat titik mulai dulu');
    return;
  }
  $('dur').value = d;
  flash($('markEnd'), `✓ Durasi ${d.toFixed(1)} dtk`);
});

$('markMusic').addEventListener('click', () => {
  const t = Math.round($('musicPreview').currentTime * 10) / 10;
  $('musicStart').value = t;
  flash($('markMusic'), `✓ Lagu mulai ${t.toFixed(1)} dtk`);
});

/* ---- live preview of geometry and speed ---- */

function syncGeometryPreview() {
  const r = editRotation();
  const flip = $('vFlip').checked ? ' scaleX(-1)' : '';
  // Quarter turns swap width and height; shrink so the frame stays inside.
  const shrink = r === 90 || r === 270 ? ' scale(0.5625)' : '';
  $('vidPreview').style.transform = r || flip ? `rotate(${r}deg)${shrink}${flip}` : '';
  $('vidPreview').playbackRate = editSpeed();
  $('vidPreview').preservesPitch = true;
}
['vRotate', 'vFlip', 'vSpeed'].forEach((id) => $(id).addEventListener('change', syncGeometryPreview));
$('vidPreview').addEventListener('loadedmetadata', syncGeometryPreview);

/* ---- song + video preview, no export needed ---- */

let mixTimer = 0;

function stopMix() {
  clearInterval(mixTimer);
  mixTimer = 0;
  $('vidPreview').pause();
  $('musicPreview').pause();
  $('mixPreview').textContent = '▶ Pratinjau lagu bersama video';
}

async function startMix() {
  if (!state.music) return;
  stopTrendPreview();
  const isVideo = state.kind === 'video';
  const v = $('vidPreview'), a = $('musicPreview');
  const sp = isVideo ? editSpeed() : 1;
  const start = isVideo ? num('start', 0) : 0;
  const length = isVideo ? num('dur', 30) : num('photoDur', 30);
  a.currentTime = Math.max(0, num('musicStart', 0));
  a.volume = Math.min(1, num('musicVol', 100) / 100);
  if (isVideo) {
    v.currentTime = start;
    v.playbackRate = sp;
    v.volume = Math.min(1, num('origVol', 0) / 100);
    v.muted = v.volume === 0;
  }
  try {
    await Promise.all([a.play(), isVideo ? v.play() : Promise.resolve()]);
  } catch (_) {
    stopMix();
    return;
  }
  $('mixPreview').textContent = '⏸ Hentikan pratinjau';
  const began = performance.now();
  mixTimer = setInterval(() => {
    const elapsed = isVideo ? v.currentTime - start : (performance.now() - began) / 1000;
    if (elapsed >= length || (isVideo && v.ended)) stopMix();
  }, 120);
}

$('mixPreview').addEventListener('click', () => (mixTimer ? stopMix() : startMix()));
new MutationObserver(() => { if ($('musicOpts').hidden) stopMix(); })
  .observe($('musicOpts'), { attributes: true, attributeFilter: ['hidden'] });
