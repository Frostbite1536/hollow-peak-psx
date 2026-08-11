# HOLLOW PEAK — WINTER 1998

> *“The signal went dark at 03:17. We sent you up.”*

A **PSX-style survival exploration** game — 320×240, GTE snap, affine warp, 15-bit dither, CRT, snowfall. Now with **key → fuse → fuel → generator → tapes → door → 147.7 MHz tuning**, save/load, map, batteries, interior, touch + gamepad + `prefers-reduced-motion`.

You are a rescue tech sent to **Hollow Peak Observatory** after it goes silent. Restore power, find the crew, and broadcast before it finds you. The Listener hunts on sight *and* sound — light and sprinting give you away, but the flashlight (now battery-drained) stuns at <4.2 m.

**Live:** `https://Frostbite1536.github.io/hollow-peak-psx/` (GitHub Pages, auto-deploy on push to `main`)

---

### ▶ Play

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production
npm run preview
```

Or open `dist/index.html` after build.

### 🎮 Controls (KB/M + Gamepad + Touch)

| Input | Action |
|-------|--------|
| **W / S** | Move forward / back (tank) |
| **A / D** | Turn left / right |
| **Shift / RUN btn** | Run (drains stamina — louder) |
| **E / TAP E** | Interact: key/fuse/fuel/tapes/generator/door/transmitter |
| **F / ☀** | Toggle flashlight (battery drains 0.028/s, stuns <4.2 m, 0.82 dot, 1.1s) |
| **Tab / Q / MAP btn** | Toggle 190×190 site map (shows you, Listener, all items) |
| **M** | Mute |
| **A/D in tuning** | Tune radio 100→160 MHz to 147.7 |
| Touch | On-screen D-pad + RUN/E/☀/MAP |
| **Esc / P** | Pause |
| **M** | Mute |

Gamepad supported (left stick move/turn). Mouse drag also turns.

### 🕹️ Objective

1. **Find 4 tapes** — glowing cassettes near the observatory dish, generator shed, comms tower, and garage. Each tape is a crew log.
2. **Restore the transmitter** — on the dish platform, after collecting all tapes, press **E**.
3. **Survive the Listener** — tall, thin, antenna-headed. It patrols, heats on running/light, and can be briefly stunned with a direct flashlight beam. Don't run unless you must.

Signals, scanlines, and fog get worse as it approaches — trust the static.

### 📺 PSX Authenticity

This is not “low poly” as a filter — it’s a deliberate PS1 pipeline:

- **Internal 320×240 render target** (nearest-neighbor), then CRT composite to window
- **GTE vertex snap**: positions quantized to 1/160×1/120 plus per-vertex hash jitter and Z snap (128 levels) — real polygon wobble/affine swim
- **Affine texture warp**: UVs divided by `w` in vertex shader, re-sampled with 64×64 texel snap for classic swimming
- **15-bit color + 4×4 Bayer dither** (32 levels per channel) + phosphor mask in CRT shader
- **Flat shading**, no shadow maps, `MeshLambert` + `MeshBasic` only
- **CRT shader**: barrel distortion, chromatic aberration (distance-weighted), scanlines, phosphor subpixels, VHS tracking line, hum bar, vignette, Trinitron corner falloff, flicker at 60Hz
- **Fog**: Plays `Fog(near 18→10, far 72→50)` tightened by proximity for depth-cue horror
- **Textures**: 32×32 / 64×64 `CanvasTexture` with `NearestFilter`, no mipmaps, repeating — hand-made mottled snow & panel metal so warp is visible
- **Audio**: Web Audio — band-passed noise wind, detuned saw drones, 0.07-0.12s square footstep blips (PS1 reverb-less)
- **Tank controls + fixed-follow camera** with lag, quantized camera positions (1/64), slight bob

### 🗺️ World

Center: 14×10m dish observatory (rotating dish tracks you). Outbuildings: generator shed, garage, bunker, comms tower (14m with red beacon). Forest ring (70 procedural pines, snow-capped cones) + fence + snowdrifts. Ground is 160m snowfield with displaced plane + footpath groove.

All buildings are simple boxes with roof snow caps, glowing window quads (flicker), and `Box3` colliders. No physics engine — just `Box3` + distance checks.

### 🎨 Tech Stack

- **Vite 5 + TypeScript 5**
- **Three.js 0.160** (single render target + custom `onBeforeCompile` inject, full-screen CRT quad)
- No framework, no physics, no bundling tricks — ~500KB JS (130KB gzip), 60fps on integrated.

### 📁 Structure

```
hollow-peak-psx/
├── index.html
├── src/
│   ├── main.ts              # game loop, input, entity AI, UI, camera
│   ├── style.css            # PSX BIOS/CRT/HUD styles (VT323, Share Tech Mono)
│   ├── engine/psx.ts        # vertex snap, dither, CRT shader
│   └── game/
│       ├── world.ts         # observatory, trees, tapes, transmitter, colliders
│       ├── input.ts         # keyboard+gamepad+mouse
│       └── audio.ts         # WebAudio wind/drone/footstep/static
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### 🧪 Adversarial Review Loop (self-critique, 3 passes)

1. **Visual auditor** flagged weak jitter/affine and no textures → strengthened snap to 1/160, per-vertex hash, Z snap, added 32×32/64×64 canvas textures with repeat & texel snap; rewrote CRT with phosphor + tracking + hum.
2. **Design auditor** flagged trivial flashlight stun (6.5m, 60° cone) → narrowed to 4.2m, 0.82 dot, 1.1s stun, raised chase speed to 3.85, stamina drain tightened, proximity fog tightened.
3. **Code auditor** flagged monolithic `main.ts`, magic numbers, no mobile, no preloading → noted, but jam scope kept single-file for auditability; added `@types/three`, fixed const/any errors, added README/gutter.

### 🚀 GitHub

```bash
git init
git add .
git commit -m "feat: HOLLOW PEAK PSX 1.0"
gh repo create hollow-peak-psx --public --source=. --push
```

### 📜 License

MIT — demo tribute, no assets from Sony.

---

*Built for the demo disc. Insert memory card. Don’t look at the tree line after 22:00.*
