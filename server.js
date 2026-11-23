// Mini static server (no dependencies). Run: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.mp3': 'audio/mpeg', '.lrc': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.mp4': 'video/mp4'
};

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (rel === '/api/lyrics') return proxyLyrics(req, res);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (m && !m[1] && m[2]) { start = st.size - parseInt(m[2], 10); end = st.size - 1; }
      if (start >= st.size || end >= st.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache',
        'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1
      });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    }
  });
});

// Fetches synced lyrics from the public LRCLIB API on the user's machine (browser CORS/network-safe fallback).
let lyricsMem = null;
async function proxyLyrics(req, res) {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  if (lyricsMem) return send(200, lyricsMem);
  if (typeof fetch !== 'function') return send(501, { error: 'Node 18+ required for proxy' }); // browser falls back to direct fetch
  const q = new URL(req.url, 'http://x').searchParams;
  const artist = q.get('artist') || 'The Neighbourhood', track = q.get('track') || 'Reflections', dur = q.get('duration') || '244';
  const base = 'https://lrclib.net/api';
  const qs = `artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(track)}`;
  const get = async (url) => {
    const opts = { headers: { 'User-Agent': 'reflections-lyric-visualizer/1.0' } };
    if (AbortSignal.timeout) opts.signal = AbortSignal.timeout(10000);
    const r = await fetch(url, opts);
    return r.ok ? r.json() : null;
  };
  try {
    let j = await get(`${base}/get?${qs}&duration=${dur}`);
    if (!j || !j.syncedLyrics) {
      const arr = ((await get(`${base}/search?${qs}`)) || []).filter(x => x.syncedLyrics);
      arr.sort((a, b) => Math.abs(a.duration - dur) - Math.abs(b.duration - dur));
      j = arr[0] || null;
    }
    if (!j || !j.syncedLyrics) return send(404, { error: 'not found' });
    lyricsMem = { syncedLyrics: j.syncedLyrics, source: 'LRCLIB' };
    send(200, lyricsMem);
  } catch (e) { send(502, { error: String(e.message || e) }); }
}

const HOSTED = !!process.env.PORT;          // hosting platforms (Render, Railway, VPS + pm2 …) set PORT
let port = Number(process.env.PORT) || 5173;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && !HOSTED && port < 5200) { port++; server.listen(port, '0.0.0.0'); }
  else { console.error(e); process.exit(1); }
});
server.on('listening', () => {
  const url = `http://localhost:${port}/`;
  console.log(`\n  Reflections lyric visualizer is running:  ${url}\n  (Close this window to stop.)\n`);
  if (!HOSTED && !process.env.NO_OPEN) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd);
  }
});
server.listen(port, "0.0.0.0");
