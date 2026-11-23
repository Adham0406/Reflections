# Reflections — Lyric Visualizer

Kinetic lyric visualizer for *The Neighbourhood — Reflections*. Each part of the song has its own scene:

| Time | Section | Scene |
|---|---|---|
| 0:00 | Intro | Constellation (words become stars), purple glow |
| 0:19 | Verse I | Constellation, rose |
| 0:39 | Chorus I | Kinetic typography, wine / blush, star wipes |
| 1:14 | Verse II | Moon + words reflected on water, floating hearts |
| 1:39 | Chorus II | Kinetic typography, red / cream, heart wipes |
| 2:20 | Bridge | Constellation shaped as a heart, gold |
| 2:57 | Final Chorus | Kinetic, colours change every word, beat shake |
| 3:44 | Outro | Lilac heart constellation, fade out |

Visuals react to the music's bass in real time. Works on desktop and mobile.

## Run locally

```
node server.js
```
or double-click `start.bat` (Windows). Opens http://localhost:5173.

## Deploy

- **Node hosting** (Render, Railway, VPS): `node server.js` — uses the `PORT` env variable.
- **Static hosting** (GitHub Pages, Netlify, Vercel): serve `index.html`, `app.js` and the mp3.

## Lyrics

Lyrics are not stored in this repo. They are loaded at runtime from the public [LRCLIB](https://lrclib.net) API
(through `server.js` when available, otherwise directly from the browser). You can also put your own `lyrics.lrc`
next to `index.html` or drag an `.lrc` file onto the page.

## Controls

`Space` play/pause · `← →` seek 5s · `[ ]` lyric sync ±0.1s · `V` vertical 9:16 · `F` fullscreen · `H` hide bar.
On phones: tap the screen to show the control bar.
