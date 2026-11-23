/* Reflections — kinetic lyric visualizer
 * Scenes are inspired by two reference clips in this folder:
 *   - "constellation": words become stars joined by thin lines (purple-glow laptop clip)
 *   - "kinetic": word-by-word build, inverted colour flashes, huge condensed words, 4-point star wipes (Money Talks clip)
 *   - "reflection": an extra scene for the 2nd verse — words mirrored on water
 * Lyrics are NOT bundled. They are loaded at runtime from (in order):
 *   localStorage cache -> ./lyrics.lrc (if you put one here) -> LRCLIB public API -> drag&drop / paste.
 */
'use strict';

const AUDIO_SRC = 'The Neighbourhood - Reflections (Lyrics).mp3';
const TRACK = { artist: 'The Neighbourhood', title: 'Reflections', duration: 244 };
const CACHE_KEY = 'reflections.lrc.v1';
const OFFSET_KEY = 'reflections.offset.v1';

// ---------------------------------------------------------------- sections
// Boundaries found from the song's loudness curve (seconds); snapped to the nearest lyric line once lyrics load.
const SECTIONS = [
  { start: 0,   name: 'Intro',        scene: 'const', pal: 'intro' },
  { start: 19,  name: 'Verse I',      scene: 'const', pal: 'rose' },
  { start: 39,  name: 'Chorus I',     scene: 'kin',   pal: 'c1', wipe: 'star' },
  { start: 74,  name: 'Verse II',     scene: 'refl',  pal: 'refl' },
  { start: 99,  name: 'Chorus II',    scene: 'kin',   pal: 'c2', wipe: 'heart' },
  { start: 140, name: 'Bridge',       scene: 'const', pal: 'gold', heart: true },
  { start: 177, name: 'Final Chorus', scene: 'kin',   pal: 'final', wipe: 'mix', cycle: true },
  { start: 224, name: 'Outro',        scene: 'const', pal: 'outro', heart: true },
];
const BASE_STARTS = SECTIONS.map(s => s.start);

const PAL = {
  intro: { bg: '#04030b', glow: '#8b5cf6', text: '#ffffff', dim: '#b5a8e6', line: 'rgba(214,204,255,0.55)', star: '#ffffff' },
  rose:  { bg: '#0a030c', glow: '#ff4f9a', text: '#fff5fa', dim: '#f0a9c9', line: 'rgba(255,190,220,0.55)', star: '#ffe3ef' },
  gold:  { bg: '#03060f', glow: '#ffb35c', text: '#fff8ec', dim: '#f3cf9f', line: 'rgba(255,215,160,0.5)', star: '#fff1d6' },
  outro: { bg: '#030209', glow: '#c4b5fd', text: '#f6f2ff', dim: '#bdb2e8', line: 'rgba(220,210,255,0.45)', star: '#ffffff' },
  c1:    [{ A: '#3a0820', B: '#ffd8e4' }],
  c2:    [{ A: '#c3112f', B: '#fff1e6' }],
  final: [{ A: '#0a1240', B: '#dde4ff' }, { A: '#3a0820', B: '#ffd8e4' }, { A: '#c3112f', B: '#fff1e6' }, { A: '#2a0f5c', B: '#eadcff' }],
  refl:  { top: '#07051a', mid: '#1c0f3d', water: '#060414', text: '#efe6ff', accent: '#ff8fbd', moon: '#ffe9f2' },
};

// ---------------------------------------------------------------- dom / canvas
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const audio = $('audio');
audio.src = encodeURI(AUDIO_SRC);
let W = 0, H = 0, U = 0, DPR = 1, vertical = false;
let layoutCache = new Map();

const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2);
  let w = innerWidth, h = innerHeight;
  if (vertical) { if (w / h > 9 / 16) w = Math.round(h * 9 / 16); else h = Math.round(w * 16 / 9); }
  W = w; H = h; U = Math.min(W, H);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  layoutCache.clear();
  makeStars();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- utils
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
const easeBack = k => { k = clamp(k); const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
const fmt = s => { s = Math.max(0, s | 0); return `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`; };

function star4Path(c, x, y, r, rot = 0) {
  c.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = rot + i * Math.PI / 2, b = a + Math.PI / 2;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    const qx = x + Math.cos(b) * r, qy = y + Math.sin(b) * r;
    const mx = x + Math.cos(a + Math.PI / 4) * r * 0.16, my = y + Math.sin(a + Math.PI / 4) * r * 0.16;
    if (i === 0) c.moveTo(px, py);
    c.quadraticCurveTo(mx, my, qx, qy);
  }
  c.closePath();
}
function heartPoint(k) { // k in [0,1) -> unit heart, roughly in [-1,1]
  const t = k * Math.PI * 2;
  const x = 16 * Math.pow(Math.sin(t), 3);
  const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
  return { x: x / 17, y: (y + 2.5) / 17 };
}
function heartPath(c, x, y, r) {
  c.beginPath();
  for (let i = 0; i <= 64; i++) { const p = heartPoint(i / 64); i ? c.lineTo(x + p.x * r, y + p.y * r) : c.moveTo(x + p.x * r, y + p.y * r); }
  c.closePath();
}

// ---------------------------------------------------------------- lyrics
let LINES = [];          // [{i, t, end, text, words:[{w,t}]}]
let lyricSource = '';
let offset = 0;
try { offset = parseFloat(localStorage.getItem(OFFSET_KEY)) || 0; } catch {}

function parseLRC(txt) {
  const out = [];
  for (const raw of String(txt).split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!tags.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
    for (const m of tags) out.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')), text });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function buildLines(entries) {
  const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : TRACK.duration;
  const lines = [];
  entries.forEach((e, idx) => {
    if (!e.text) return;
    const next = entries[idx + 1];
    const words = e.text.split(/\s+/).filter(Boolean);
    let end = next ? next.t : dur;
    end = Math.min(end, e.t + Math.max(6, words.length * 1.1));
    const span = clamp(Math.min(end - e.t - 0.12, words.length * 0.5 + 0.5), 0.25, 30);
    const weights = words.map(w => w.length + 2);
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    const ws = words.map((w, k) => { const wt = e.t + span * acc / total; acc += weights[k]; return { w, t: wt }; });
    lines.push({ i: lines.length, t: e.t, end, text: e.text, words: ws });
  });
  return lines;
}

function setLyrics(txt, source) {
  const entries = parseLRC(txt);
  const lines = buildLines(entries);
  if (lines.length < 3) return false;
  LINES = lines; lyricSource = source; layoutCache.clear();
  snapSections();
  try { localStorage.setItem(CACHE_KEY, txt); } catch {}
  setStatus(`Matn tayyor: <b>${lines.length}</b> qator (${source}).`);
  return true;
}

function snapSections() {
  SECTIONS.forEach((s, k) => {
    if (k === 0) return;
    const base = BASE_STARTS[k];
    let best = null;
    for (const L of LINES) { const d = Math.abs(L.t - base); if (d <= 3.5 && (!best || d < Math.abs(best.t - base))) best = L; }
    s.start = best ? Math.max(0, best.t - 0.25) : base;
  });
}

async function loadLyrics() {
  // 1) local override file
  try {
    const r = await fetch('lyrics.lrc', { cache: 'no-store' });
    if (r.ok && setLyrics(await r.text(), 'lyrics.lrc')) return;
  } catch {}
  // 2) cache
  try { const c = localStorage.getItem(CACHE_KEY); if (c && setLyrics(c, 'kesh')) return; } catch {}
  // 3) LRCLIB via local server proxy, then directly from the browser
  setStatus('Matn LRCLIB dan yuklanmoqda…');
  const to = ms => (window.AbortSignal && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined;
  try {
    const r = await fetch(`api/lyrics?artist=${encodeURIComponent(TRACK.artist)}&track=${encodeURIComponent(TRACK.title)}&duration=${TRACK.duration}`, { signal: to(25000) });
    if (r.ok) { const j = await r.json(); if (j.syncedLyrics && setLyrics(j.syncedLyrics, 'LRCLIB')) return; }
  } catch {}
  const q = `artist_name=${encodeURIComponent(TRACK.artist)}&track_name=${encodeURIComponent(TRACK.title)}`;
  try {
    const r = await fetch(`https://lrclib.net/api/get?${q}&duration=${TRACK.duration}`, { signal: to(8000) });
    if (r.ok) { const j = await r.json(); if (j.syncedLyrics && setLyrics(j.syncedLyrics, 'LRCLIB')) return; }
  } catch {}
  try {
    const r = await fetch(`https://lrclib.net/api/search?${q}`, { signal: to(8000) });
    if (r.ok) {
      const arr = (await r.json()).filter(x => x.syncedLyrics);
      arr.sort((a, b) => Math.abs(a.duration - TRACK.duration) - Math.abs(b.duration - TRACK.duration));
      if (arr[0] && setLyrics(arr[0].syncedLyrics, 'LRCLIB')) return;
    }
  } catch {}
  setStatus('Matn topilmadi (internet yo\'qmi?). <b>.lrc</b> faylni tashlang yoki LRC matnini qo\'ying. Vizual baribir ishlaydi.');
}

function setStatus(html) { $('status').innerHTML = html; }

// Title card shown before the first sung line
function introLine() {
  const first = LINES.length ? LINES[0].t : 9;
  return { i: -1, t: 0.6, end: Math.max(2, first - 0.4), text: 'the neighbourhood reflections',
    words: [{ w: 'the', t: 0.6 }, { w: 'neighbourhood', t: 1.6 }, { w: 'reflections', t: 3.4 }] };
}

function lineAt(t) {
  const intro = introLine();
  if (t >= intro.t && t < intro.end) return intro;
  let lo = 0, hi = LINES.length - 1, idx = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (LINES[m].t <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
  if (idx >= 0 && t < LINES[idx].end) return LINES[idx];
  return null;
}
function prevLineAt(t, cur) {
  // the most recent line that has ended (for exit animations)
  let best = null;
  const cand = cur && cur.i > 0 ? [LINES[cur.i - 1]] : LINES;
  for (const L of cand) if (L && L.end <= t + 0.001 && (!best || L.end > best.end)) best = L;
  if (!best) { const intro = introLine(); if (intro.end <= t) best = intro; }
  return best;
}
function activeWord(L, t) { let k = -1; for (let i = 0; i < L.words.length; i++) if (L.words[i].t <= t) k = i; return k; }
function sectionAt(t) { let k = 0; for (let i = 0; i < SECTIONS.length; i++) if (t >= SECTIONS[i].start) k = i; return k; }

// ---------------------------------------------------------------- audio analysis
let actx = null, analyser = null, fbuf = null;
let beat = 0, energy = 0, slow = 0;
function initAudioGraph() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser); analyser.connect(actx.destination);
    fbuf = new Uint8Array(analyser.frequencyBinCount);
  } catch (e) { console.warn('Audio analysis unavailable', e); analyser = null; }
}
function updateAudio() {
  if (!analyser || audio.paused) { beat *= 0.92; energy *= 0.98; return; }
  analyser.getByteFrequencyData(fbuf);
  let low = 0; for (let i = 1; i < 7; i++) low += fbuf[i]; low /= 6 * 255;
  let all = 0; for (let i = 0; i < 200; i++) all += fbuf[i]; all /= 200 * 255;
  slow = lerp(slow, low, 0.04);
  const hit = clamp((low - slow) * 4.5);
  beat = Math.max(beat * 0.88, hit);
  energy = lerp(energy, all, 0.1);
}

// ---------------------------------------------------------------- shared visuals
let stars = [];
function makeStars() {
  const r = rng(42); stars = [];
  const n = Math.min(260, Math.round((W * H) / 9000));
  for (let i = 0; i < n; i++) stars.push({ x: r() * W, y: r() * H, s: r() * 1.3 + 0.2, p: r() * 6.28, v: r() * 0.6 + 0.2 });
}
function drawStarfield(t, color, alpha = 1) {
  ctx.fillStyle = color;
  for (const s of stars) {
    const a = (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * s.v * 2 + s.p))) * alpha;
    ctx.globalAlpha = a * 0.7;
    const y = (s.y - t * s.v * 4) % H; ctx.fillRect(s.x, y < 0 ? y + H : y, s.s, s.s);
  }
  ctx.globalAlpha = 1;
}
function drawGlowFrame(color, k) {
  const m = U * 0.035, r = U * 0.03;
  ctx.save();
  ctx.strokeStyle = hexA(color, 0.55 + 0.45 * k);
  ctx.lineWidth = U * 0.004;
  ctx.shadowColor = color; ctx.shadowBlur = U * (0.03 + 0.05 * k);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(m, m, W - 2 * m, H - 2 * m, r); else ctx.rect(m, m, W - 2 * m, H - 2 * m);
  ctx.stroke(); ctx.stroke();
  ctx.restore();
}
const grain = (() => {
  const g = document.createElement('canvas'); g.width = g.height = 256;
  const gx = g.getContext('2d'), img = gx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  gx.putImageData(img, 0, 0); return g;
})();
let grainPat = null;
function drawGrain(a) {
  if (!grainPat) grainPat = ctx.createPattern(grain, 'repeat');
  ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = 'overlay';
  ctx.translate((Math.random() * 256) | 0, (Math.random() * 256) | 0);
  ctx.fillStyle = grainPat; ctx.fillRect(-256, -256, W + 512, H + 512);
  ctx.restore();
}

// ================================================================= SCENE 1: CONSTELLATION
function constLayout(L, sec, secIdx) {
  const key = `${secIdx}:${L.i}:${W}x${H}`;
  if (layoutCache.has(key)) return layoutCache.get(key);
  const r = rng((L.i + 7) * 7919 + secIdx * 131);
  const n = L.words.length;
  const cx = W / 2, cy = H / 2;
  const portrait = H > W;
  const nodes = [];
  if (sec.heart) {
    const R = Math.min(W * (portrait ? 0.4 : 0.3), H * 0.3);
    const total = Math.max(16, n + 8);
    const slots = new Set();
    for (let k = 0; k < n; k++) slots.add(Math.round(k * total / n + total * 0.02) % total);
    let wk = 0;
    for (let s = 0; s < total; s++) {
      const p = heartPoint((s / total + 0.5) % 1);
      const jx = (r() - 0.5) * R * 0.06, jy = (r() - 0.5) * R * 0.06;
      const isWord = slots.has(s) && wk < n;
      nodes.push({ x: cx + p.x * R + jx, y: cy + p.y * R + jy - R * 0.05, word: isWord ? wk++ : -1, ring: s });
    }
    while (wk < n) nodes.push({ x: cx + (r() - 0.5) * R, y: cy + (r() - 0.5) * R * 0.6, word: wk++, ring: -1 });
  } else {
    const bw = portrait ? W * 0.8 : Math.min(W * 0.72, H * 1.35);
    const bh = portrait ? H * 0.2 : H * 0.36;
    for (let k = 0; k < n; k++) {
      const x = cx - bw / 2 + bw * (k + 0.5) / n + (r() - 0.5) * bw / n * 0.6;
      const y = cy + (r() - 0.5) * bh * (k % 2 ? 1 : -1) * 0.9 + (r() - 0.5) * bh * 0.3;
      nodes.push({ x, y, word: k });
    }
    const extra = 3 + Math.floor(r() * 4);
    for (let d = 0; d < extra; d++) nodes.push({ x: cx + (r() - 0.5) * bw * 1.05, y: cy + (r() - 0.5) * bh * 1.6, word: -1 });
  }
  const wordNodes = []; nodes.forEach((nd, i) => { if (nd.word >= 0) wordNodes[nd.word] = i; });
  // edges with reveal times
  const edges = [];
  for (let k = 1; k < n; k++) edges.push({ a: wordNodes[k - 1], b: wordNodes[k], t: L.words[k].t });
  if (sec.heart) {
    const ring = nodes.map((nd, i) => ({ nd, i })).filter(o => o.nd.ring >= 0);
    const lastT = L.words[n - 1].t;
    ring.forEach((o, j) => {
      const nx = ring[(j + 1) % ring.length];
      const t0 = L.t + (lastT - L.t + 0.6) * (j / ring.length);
      edges.push({ a: o.i, b: nx.i, t: t0, soft: true });
    });
  } else {
    nodes.forEach((nd, i) => {
      if (nd.word >= 0) return;
      let best = 0, bd = 1e9;
      wordNodes.forEach((wi, k) => { const d = Math.hypot(nodes[wi].x - nd.x, nodes[wi].y - nd.y); if (d < bd) { bd = d; best = k; } });
      nd.t = L.words[best].t + 0.25;
      edges.push({ a: wordNodes[best], b: i, t: nd.t, soft: true });
    });
    if (n >= 4) edges.push({ a: wordNodes[0], b: wordNodes[n - 2], t: L.words[n - 1].t + 0.3, soft: true });
  }
  const lay = { nodes, edges, wordNodes };
  layoutCache.set(key, lay);
  return lay;
}

function drawConstLine(L, t, sec, secIdx, pal, alpha, drift) {
  const lay = constLayout(L, sec, secIdx);
  const aw = activeWord(L, t);
  const n = L.words.length;
  ctx.save();
  if (drift) { ctx.translate(W / 2, H / 2); ctx.scale(1 + drift * 0.08, 1 + drift * 0.08); ctx.translate(-W / 2, -H / 2 - drift * U * 0.04); }
  ctx.globalAlpha = alpha;
  // edges
  ctx.lineWidth = Math.max(1, U * 0.0016);
  for (const e of lay.edges) {
    const p = clamp((t - e.t) / 0.45);
    if (p <= 0) continue;
    const A = lay.nodes[e.a], B = lay.nodes[e.b];
    ctx.strokeStyle = e.soft ? pal.line.replace(/[\d.]+\)$/, '0.3)') : pal.line;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(lerp(A.x, B.x, easeOut(p)), lerp(A.y, B.y, easeOut(p))); ctx.stroke();
  }
  // nodes
  lay.nodes.forEach((nd, i) => {
    let rt;
    if (nd.word >= 0) rt = L.words[nd.word].t;
    else if (nd.t !== undefined) rt = nd.t + 0.35;
    else { const e = lay.edges.find(e => e.b === i || e.a === i); rt = e ? e.t + 0.2 : L.t; }
    const dt = t - rt; if (dt < 0) return;
    const pop = Math.exp(-dt * 5);
    const isWord = nd.word >= 0;
    const r0 = U * (isWord ? 0.009 : 0.005) * (1 + pop * 1.4 + (isWord && nd.word === aw ? beat * 0.6 : 0));
    ctx.fillStyle = pal.star;
    ctx.shadowColor = pal.glow; ctx.shadowBlur = U * 0.02;
    star4Path(ctx, nd.x, nd.y, r0, t * 0.3 + i);
    ctx.fill();
    ctx.shadowBlur = 0;
  });
  // labels
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  for (let k = 0; k <= aw && k < n; k++) {
    const nd = lay.nodes[lay.wordNodes[k]];
    const sinceOn = t - L.words[k].t;
    const nextT = k + 1 < n ? L.words[k + 1].t : L.end - 0.15;
    const activeK = k === aw ? clamp(sinceOn / 0.15) * (1 - clamp((t - nextT) / 0.3)) : 1 - clamp((t - nextT) / 0.3);
    const big = k === aw ? easeOut(clamp(sinceOn / 0.2)) : clamp(1 - (t - nextT) / 0.3);
    const size = lerp(Math.max(U * 0.022, 11), Math.max(U * 0.052, 22), big);
    ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = big > 0.5 ? pal.text : pal.dim;
    ctx.globalAlpha = alpha * lerp(0.55, 1, big) * clamp(sinceOn / 0.12);
    if (big > 0.3) { ctx.shadowColor = pal.glow; ctx.shadowBlur = U * 0.03 * big; }
    const yoff = sec.heart ? -U * 0.025 : (nd.y > H / 2 ? U * 0.045 : -U * 0.025);
    ctx.fillText(L.words[k].w, nd.x, nd.y + yoff - (big * U * 0.01));
    ctx.shadowBlur = 0;
    // sparkle next to the singing word (like "✦ stars")
    if (k === aw && activeK > 0.2) {
      const tw = ctx.measureText(L.words[k].w).width;
      ctx.fillStyle = pal.star; ctx.globalAlpha = alpha * activeK;
      star4Path(ctx, nd.x - tw / 2 - size * 0.25, nd.y + yoff - size * 0.95, size * 0.28 * (1 + beat * 0.4), t);
      ctx.fill();
    }
  }
  ctx.restore();
}

function sceneConstellation(t, sec, secIdx) {
  const pal = PAL[sec.pal];
  ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, hexA(pal.glow, 0.10 + energy * 0.15)); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  drawStarfield(t, pal.star, 0.9);
  drawGlowFrame(pal.glow, 0.3 + beat * 0.7);

  const L = lineAt(t);
  const P = prevLineAt(t, L);
  if (P) { const k = clamp((t - P.end) / 0.7); if (k < 1) drawConstLine(P, t, sec, secIdx, pal, 1 - k, easeOut(k)); }
  if (L) {
    const inA = clamp((t - L.t) / 0.25);
    drawConstLine(L, t, sec, secIdx, pal, inA, 0);
  } else if (!P || t - P.end > 0.7) {
    // ambient: one slow pulsing star
    ctx.save(); ctx.globalAlpha = 0.6 + beat * 0.4; ctx.fillStyle = pal.star; ctx.shadowColor = pal.glow; ctx.shadowBlur = U * 0.05;
    if (sec.heart) { heartPath(ctx, W / 2, H / 2, U * (0.05 + beat * 0.015)); ctx.globalAlpha *= 0.5; }
    else star4Path(ctx, W / 2, H / 2, U * (0.03 + beat * 0.02), t * 0.4);
    ctx.fill(); ctx.restore();
  }
}

// ================================================================= SCENE 2: KINETIC (Money Talks style)
function wrapWords(words, font, maxW) {
  ctx.font = font;
  const space = ctx.measureText(' ').width;
  const rows = [[]]; let rw = 0;
  for (const w of words) {
    const ww = ctx.measureText(w).width;
    const row = rows[rows.length - 1];
    if (row.length && rw + space + ww > maxW) { rows.push([w]); rw = ww; }
    else { row.push(w); rw += (row.length > 1 ? space : 0) + ww; }
  }
  return { rows, space };
}

function sceneKinetic(t, sec, secIdx) {
  const L = lineAt(t);
  const pals = PAL[sec.pal];
  const palIdx = (L ? L.i : 0) + (sec.cycle && L ? Math.max(0, activeWord(L, t)) : 0);
  const pal = pals[(palIdx % pals.length + pals.length) % pals.length];
  const shake = sec.cycle ? beat * U * 0.006 : 0;
  ctx.save();
  if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  if (!L) {
    ctx.fillStyle = pal.A; ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.fillStyle = pal.B; ctx.globalAlpha = 0.9;
    if (sec.wipe === 'heart') heartPath(ctx, W / 2, H / 2, U * (0.12 + beat * 0.04));
    else star4Path(ctx, W / 2, H / 2, U * (0.12 + beat * 0.05), t * 0.6);
    ctx.fill(); ctx.restore(); return;
  }

  const n = L.words.length;
  const aw = Math.max(0, activeWord(L, t));
  const punch = n <= 3 || (sec.cycle ? L.i % 3 !== 0 : L.i % 2 === 1);
  let inv;
  if (punch) inv = (L.i + aw) % 2;
  else inv = (L.i + (aw >= 1 ? 1 : 0) + (n > 2 && aw >= n - 1 ? 1 : 0)) % 2;
  const bg = inv ? pal.B : pal.A, fg = inv ? pal.A : pal.B;
  ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, H + 40);

  const dtw = t - L.words[aw].t;
  if (punch) {
    const word = L.words[aw].w.toUpperCase();
    let size = Math.min(H * 0.32, U * 0.36);
    ctx.font = `${size}px Anton, Impact, sans-serif`;
    const mw = ctx.measureText(word).width;
    if (mw > W * 0.86) size *= W * 0.86 / mw;
    const sc = (1 + 0.22 * Math.exp(-dtw * 16)) * (1 + beat * 0.035);
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(sc, sc * (1 + 0.06 * Math.exp(-dtw * 10)));
    ctx.font = `${size}px Anton, Impact, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = fg; ctx.globalAlpha = clamp(dtw / 0.05 + 0.3);
    ctx.fillText(word, 0, size * 0.04);
    ctx.restore();
  } else {
    const visible = L.words.slice(0, aw + 1).map(o => o.w);
    let size = U * 0.075;
    let font = `800 ${size}px "Bricolage Grotesque", Inter, sans-serif`;
    let lay = wrapWords(visible, font, W * 0.84);
    while (lay.rows.length > 3 && size > U * 0.035) { size *= 0.88; font = `800 ${size}px "Bricolage Grotesque", Inter, sans-serif`; lay = wrapWords(visible, font, W * 0.84); }
    ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = fg;
    const lh = size * 1.18;
    let y = H / 2 - (lay.rows.length - 1) * lh / 2;
    let wi = 0;
    for (const row of lay.rows) {
      const rw = row.reduce((a, w) => a + ctx.measureText(w).width, 0) + lay.space * (row.length - 1);
      let x = W / 2 - rw / 2;
      for (const w of row) {
        const ww = ctx.measureText(w).width;
        const d = t - L.words[wi].t;
        const pop = wi === aw ? easeBack(clamp(d / 0.18)) : 1;
        ctx.save();
        ctx.globalAlpha = clamp(d / 0.06);
        ctx.translate(x + ww / 2, y + (1 - pop) * size * 0.35);
        ctx.scale(lerp(0.7, 1, pop), lerp(0.7, 1, pop));
        ctx.fillText(w, -ww / 2, 0);
        ctx.restore();
        x += ww + lay.space; wi++;
      }
      y += lh;
    }
  }

  // shape wipe on line change (star / heart burst like the reference)
  const p = (t - L.t) / 0.42;
  if (p >= 0 && p < 1 && L.i > 0) {
    const shape = sec.wipe === 'mix' ? (L.i % 2 ? 'heart' : 'star') : sec.wipe;
    const R = Math.hypot(W, H) * 0.55 * Math.sin(p * Math.PI);
    ctx.fillStyle = fg;
    if (shape === 'heart') heartPath(ctx, W / 2, H / 2, R); else star4Path(ctx, W / 2, H / 2, R, p * 0.6);
    ctx.fill();
  }
  ctx.restore();
}

// ================================================================= SCENE 3: REFLECTION (verse II)
const off = document.createElement('canvas'), octx = off.getContext('2d');
let hearts = [];
function sceneReflection(t, sec) {
  const pal = PAL.refl;
  const hz = H * 0.58;
  let g = ctx.createLinearGradient(0, 0, 0, hz);
  g.addColorStop(0, pal.top); g.addColorStop(1, pal.mid);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, hz);
  g = ctx.createLinearGradient(0, hz, 0, H);
  g.addColorStop(0, '#120a2a'); g.addColorStop(1, pal.water);
  ctx.fillStyle = g; ctx.fillRect(0, hz, W, H - hz);
  drawStarfield(t, '#ffffff', 0.5);
  ctx.fillStyle = pal.top; ctx.globalAlpha = 0.6; ctx.fillRect(0, hz, W, H - hz); ctx.globalAlpha = 1;

  // moon + its shimmering path
  const mx = W * 0.5, my = hz - Math.min(H * 0.36, U * 0.42), mr = U * 0.07;
  const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 4);
  mg.addColorStop(0, hexA(pal.moon, 0.9)); mg.addColorStop(0.25, hexA(pal.accent, 0.25)); mg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mg; ctx.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
  ctx.fillStyle = pal.moon; ctx.beginPath(); ctx.arc(mx, my, mr * (1 + beat * 0.05), 0, Math.PI * 2); ctx.fill();
  for (let y = hz + 4; y < H; y += 5) {
    const k = (y - hz) / (H - hz);
    const w = mr * (1.2 + k * 3) * (0.5 + 0.5 * Math.sin(y * 0.15 + t * 3));
    ctx.fillStyle = hexA(pal.moon, 0.22 * (1 - k));
    ctx.fillRect(mx - w / 2 + Math.sin(y * 0.05 + t) * 6, y, w, 1.5);
  }
  ctx.fillStyle = hexA(pal.accent, 0.5); ctx.fillRect(0, hz, W, 1);

  // floating hearts (bokeh)
  if (hearts.length < 26 && Math.random() < 0.15) hearts.push({ x: Math.random() * W, y: H + 20, s: U * (0.01 + Math.random() * 0.025), v: 0.3 + Math.random() * 0.6, p: Math.random() * 6 });
  hearts = hearts.filter(h => h.y > -40);
  for (const h of hearts) {
    h.y -= h.v * (1 + energy * 2); const x = h.x + Math.sin(t + h.p) * 12;
    ctx.globalAlpha = 0.18 + 0.12 * Math.sin(t * 2 + h.p);
    ctx.fillStyle = pal.accent; heartPath(ctx, x, h.y, h.s); ctx.fill();
  }
  ctx.globalAlpha = 1;

  const L = lineAt(t);
  const P = prevLineAt(t, L);
  if (P && P.i >= 0) { const k = clamp((t - P.end) / 0.6); if (k < 1) drawReflLine(P, t, hz, 1 - k, k); }
  if (L) drawReflLine(L, t, hz, clamp((t - L.t) / 0.2), 0);
}

function drawReflLine(L, t, hz, alpha, exitK) {
  const pal = PAL.refl;
  const aw = activeWord(L, t);
  let size = U * 0.085;
  const maxW = W * 0.84;
  const fontOf = s => `italic 700 ${s}px "Playfair Display", Georgia, serif`;
  let lay = wrapWords(L.words.map(o => o.w), fontOf(size), maxW);
  while (lay.rows.length > 2 && size > U * 0.04) { size *= 0.9; lay = wrapWords(L.words.map(o => o.w), fontOf(size), maxW); }
  const lh = size * 1.2;
  const th = Math.ceil(lh * lay.rows.length + size * 0.35);
  if (off.width !== Math.round(W * DPR) || off.height !== Math.round(th * DPR)) { off.width = Math.round(W * DPR); off.height = Math.round(th * DPR); }
  octx.setTransform(DPR, 0, 0, DPR, 0, 0);
  octx.clearRect(0, 0, W, th);
  octx.font = fontOf(size); octx.textBaseline = 'alphabetic';
  let wi = 0, y = size * 1.0;
  for (const row of lay.rows) {
    const rw = row.reduce((a, w) => a + octx.measureText(w).width, 0) + lay.space * (row.length - 1);
    let x = W / 2 - rw / 2;
    for (const w of row) {
      const ww = octx.measureText(w).width;
      const d = t - L.words[wi].t;
      const a = clamp(d / 0.35);
      if (a > 0) {
        octx.globalAlpha = a;
        octx.fillStyle = wi === aw ? pal.accent : pal.text;
        octx.shadowColor = wi === aw ? pal.accent : 'transparent'; octx.shadowBlur = wi === aw ? size * 0.4 : 0;
        octx.fillText(w, x, y + (1 - easeOut(a)) * size * 0.4);
      }
      x += ww + lay.space; wi++;
    }
    y += lh;
  }
  octx.globalAlpha = 1; octx.shadowBlur = 0;

  const top = hz - th - U * 0.01 - exitK * U * 0.05;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.drawImage(off, 0, 0, off.width, off.height, 0, top, W, th);
  // mirrored, rippling reflection
  const step = 2;
  for (let yy = 0; yy < th; yy += step) {
    const k = yy / th;
    const src = (th - yy - step);
    if (src < 0) continue;
    const dx = Math.sin(yy * 0.18 + t * 3.2) * U * 0.006 * (0.4 + k * 2);
    ctx.globalAlpha = alpha * 0.38 * (1 - k * 0.85);
    ctx.drawImage(off, 0, src * DPR, off.width, step * DPR, dx, hz + U * 0.01 + yy * 1.05, W, step * 1.05);
  }
  ctx.restore();
}

// ================================================================= main loop
const SCENES = { const: sceneConstellation, kin: sceneKinetic, refl: sceneReflection };
let started = false, lastMove = 0;

function sectionTransition(t, secIdx) {
  const s = SECTIONS[secIdx];
  if (secIdx === 0) return;
  const p = (t - s.start) / 0.8;
  if (p < 0 || p >= 1) return;
  ctx.save();
  ctx.globalAlpha = Math.pow(1 - p, 1.6);
  ctx.fillStyle = '#ffffff';
  const R = Math.hypot(W, H) * 0.9 * easeOut(p);
  if (secIdx % 2) heartPath(ctx, W / 2, H / 2, R); else star4Path(ctx, W / 2, H / 2, R, p);
  ctx.fill();
  ctx.restore();
}

function frame() {
  requestAnimationFrame(frame);
  if (!started) return;
  updateAudio();
  const t = audio.currentTime + offset;
  const si = sectionAt(t);
  const sec = SECTIONS[si];
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'source-over';
  try { SCENES[sec.scene](t, sec, si); } catch (e) { console.error(e); }
  sectionTransition(t, si);
  if (!IS_TOUCH) drawGrain(sec.scene === 'kin' ? 0.07 : 0.045); // grain is expensive on phones
  // fade in / out
  const dur = isFinite(audio.duration) ? audio.duration : TRACK.duration;
  const fade = Math.max(clamp(1 - t / 1.2), clamp((t - (dur - 6)) / 6));
  if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${fade})`; ctx.fillRect(0, 0, W, H); }
  // hud
  $('fill').style.width = (100 * audio.currentTime / dur) + '%';
  $('time').textContent = `${fmt(audio.currentTime)} / ${fmt(dur)}`;
  $('sec').textContent = sec.name;
  $('hud').classList.toggle('hide', performance.now() - lastMove > 2500 && !audio.paused);
}

// ---------------------------------------------------------------- controls
function setOffset(v) { offset = Math.round(v * 10) / 10; $('off').textContent = `sync ${offset >= 0 ? '+' : ''}${offset.toFixed(1)}s`; try { localStorage.setItem(OFFSET_KEY, offset); } catch {} }
function safePlay() {
  const p = audio.play();
  if (p && p.catch) p.catch(e => { console.warn(e); $('pp').textContent = '▶'; });
}
function togglePlay() { if (audio.paused) { if (actx && actx.state === 'suspended') actx.resume().catch(() => {}); safePlay(); } else audio.pause(); }
function toggleVertical() { vertical = !vertical; resize(); }
const fsEl = document.documentElement;
const canFS = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
function toggleFS() {
  try {
    const cur = document.fullscreenElement || document.webkitFullscreenElement;
    if (cur) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else { const r = (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl); if (r && r.catch) r.catch(() => {}); }
  } catch (e) { console.warn(e); }
}
// keep the phone screen awake while playing
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !audio.paused) keepAwake(true); });
audio.addEventListener('play', () => keepAwake(true));
audio.addEventListener('pause', () => keepAwake(false));
audio.addEventListener('play', () => $('pp').textContent = '❚❚');
audio.addEventListener('pause', () => $('pp').textContent = '▶');
audio.addEventListener('loadedmetadata', () => { if (LINES.length) { /* rebuild with real duration */ try { const c = localStorage.getItem(CACHE_KEY); if (c) { LINES = buildLines(parseLRC(c)); snapSections(); } } catch {} } });
audio.addEventListener('error', () => setStatus('<b>MP3 fayl topilmadi.</b> "' + AUDIO_SRC + '" shu papkada bo\'lishi kerak.'));

$('play').onclick = () => {
  // Everything here runs synchronously inside the tap, which iOS/Android require to unlock audio.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {} // iOS: play even with the silent switch on
  initAudioGraph();
  if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
  try { audio.currentTime = 0; } catch {}
  safePlay();
  $('start').style.display = 'none';
  started = true; lastMove = performance.now();
};
$('pp').onclick = togglePlay;
$('fs').onclick = toggleFS;
if (!canFS) $('fs').style.display = 'none';
$('vert').onclick = toggleVertical;
$('offMinus').onclick = () => setOffset(offset - 0.1);
$('offPlus').onclick = () => setOffset(offset + 0.1);
$('bar').onclick = e => { const r = $('bar').getBoundingClientRect(); const d = isFinite(audio.duration) ? audio.duration : TRACK.duration; try { audio.currentTime = clamp((e.clientX - r.left) / r.width) * d; } catch {} };
addEventListener('mousemove', () => lastMove = performance.now());
// touch: tapping the visual shows/hides the control bar
cv.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;
  const hidden = $('hud').classList.contains('hide');
  lastMove = hidden ? performance.now() : 0;
  $('hud').classList.toggle('hide', !hidden);
});
$('hud').addEventListener('pointerdown', () => lastMove = performance.now());
if (IS_TOUCH && $('keys')) $('keys').innerHTML ='Ekranga tegsangiz boshqaruv paneli chiqadi. Matn kechiksa yoki shoshsa, paneldagi <b>− / +</b> bilan to\'g\'rilang.';
addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA') return;
  lastMove = performance.now();
  if (e.code === 'Space') { e.preventDefault(); if (started) togglePlay(); else $('play').click(); }
  else if (e.code === 'ArrowRight') { try { audio.currentTime = Math.min(audio.currentTime + 5, audio.duration || 1e9); } catch {} }
  else if (e.code === 'ArrowLeft') { try { audio.currentTime = Math.max(audio.currentTime - 5, 0); } catch {} }
  else if (e.key === '[') setOffset(offset - 0.1);
  else if (e.key === ']') setOffset(offset + 0.1);
  else if (e.key === 'f' || e.key === 'F') toggleFS();
  else if (e.key === 'v' || e.key === 'V') toggleVertical();
  else if (e.key === 'h' || e.key === 'H') $('hud').classList.toggle('hide');
});

// drag & drop / paste LRC
addEventListener('dragover', e => { e.preventDefault(); $('drop').style.display = 'flex'; });
addEventListener('dragleave', e => { if (e.relatedTarget === null) $('drop').style.display = 'none'; });
addEventListener('drop', async e => {
  e.preventDefault(); $('drop').style.display = 'none';
  const f = e.dataTransfer.files[0]; if (!f) return;
  if (!setLyrics(await f.text(), f.name)) setStatus('Bu fayl LRC formatida emas (masalan: <b>[00:12.34] matn</b>).');
});
if ($('pasteBtn')) $('pasteBtn').onclick = () => { $('pasteWrap').style.display = 'flex'; };
if ($('pasteOk')) $('pasteOk').onclick =() => { if (!setLyrics($('pasteArea').value, 'qo\'yilgan matn')) setStatus('LRC formatini tekshiring: <b>[mm:ss.xx] matn</b>'); else $('pasteWrap').style.display = 'none'; };

// ---------------------------------------------------------------- boot
resize();
setOffset(offset);
requestAnimationFrame(frame);
loadLyrics().finally(() => { $('play').disabled = false; });
// test hook: ?t=SECONDS starts directly at a timestamp (muted autoplay friendly)
const qp = new URLSearchParams(location.search);
if (qp.has('t')) {
  addEventListener('load', () => {
    $('start').style.display = 'none'; started = true;
    audio.muted = qp.has('mute');
    const go = () => { audio.currentTime = parseFloat(qp.get('t')) || 0; if (!qp.has('still')) audio.play().catch(() => {}); };
    if (audio.readyState >= 1) go(); else audio.addEventListener('loadedmetadata', go, { once: true });
  });
}
