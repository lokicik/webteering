# 🌲 Webteering — Multiplayer Voxel Orienteering Game

Webteering is a high-fidelity, real-time multiplayer voxel orienteering simulator built with modern WebGL (**Three.js**), Web Audio API, and **Socket.io**. Navigate through procedurally generated voxel wilderness biomes, analyze topographic contours, align your magnetic compass, manage stamina, and punch checkpoints in a race against other runners or against the clock.

---

## 🎮 Game Modes

*   **Classic Sequential Race:** Stamp checkpoints in precise numerical order. Speed, precision, and route choice are key.
*   **Rogaine Free-Order Run:** Collect as many checkpoint points as possible in any order within a strict time limit. Exceeding the limit incurs a score penalty!
*   **Relaxed Blind Search:** A pure navigation challenge where the GPS locator dot is disabled. Use only contours and your compass.
*   **Interactive Training Tutorial:** An offline mode designed to teach new runners the basics of map reading, contour slopes, and compass alignment.

---

## ✨ Key Features

### 1. Advanced Terrain & Environment
*   **Infinite Voxel Chunk Loading:** Generates and disposes terrain mesh chunks on-the-fly, centered around the player's position.
*   **Procedural Biomes:** Explore diverse landscapes including **Alpine Spruce Forests**, **Coastal Sand Dunes**, **Rocky Ravines**, and **Scandinavian Sprint Parks**.
*   **Contour Lines & Hypsometric Shading:** Renders authentic brown topographic contour lines at 4m height intervals with valley-to-peak color shading.
*   **Dynamic Glassmorphic Water:** Translucent water surfaces featuring multi-frequency ripple physics and a depth-fading shoreline foam shader.
*   **Voxel Wildlife & Foliage:** Forest fauna (birds, rabbits, deer) and scattered vegetation (trees, logs, mushrooms) populate the wilderness.

### 2. Immersive Realism Physics (`Controls.ts`)
*   **Stamina & Exhaustion:** Sprinting drains stamina based on terrain difficulty (fastest drain in thickets/swamps). Exhaustion reduces speeds to a slow jog and induces screen shake and heavy breathing.
*   **Terrain Slopes:** Uphill running incurs a speed penalty, while running downhill provides a speed boost.
*   **Steep Slides & Slipping:** Run too fast down a steep cliff, and you will enter a physics-controlled slide. Rainstorms increase the chance of stumbling.
*   **Tactical Movements:** Vault dynamically over low obstacles (hedges, rocks, walls) at speed for a short boost.
*   **Fall Stun:** Landing from extreme heights triggers a brief stun recovery window.
*   **Micro-Animations:** Fluid first-person camera head-bobbing, low-stamina chest sways, and visual rotation rolls when banking turns.

### 3. Navigation Instruments
*   **Silva Bezel Compass:** Features spring-mass-damper physics causing magnetic needle wobble during fast movement or jumps. Stand still to stabilize the needle.
*   **Interactive Alignment:** Rotate the compass bezel to align it with the magnetic needle. Doing so plays a lock chime, confirming your bearing.
*   **Topographic Map Panel:** Can be viewed as a 2D overlay or a 3D handheld model.
    *   *Map Speed Penalty:* Keeping the map open reduces running speed by **15%** due to divided focus.
    *   *Rotation Modes:* **North-Up** (static), **Heading-Up** (auto-rotates to match camera), and **Manual** (rotate map sheet with `Q`/`R`).
*   **Minimap Radar:** A heading-up mini HUD displaying player surroundings and checkpoint pulses.

### 4. Custom Web Audio Synthesizer (`Sound.ts`)
Synthesizes all audio in real-time using the **Web Audio API** (no static audio files required):
*   **SportIdent Punch Beeps:** High-pitched double beep upon successfully stamping.
*   **Atmospheric Ambience:** Sweeping wind gusts, dynamic rain rumble, and low-frequency rolling thunder cracks.
*   **Procedural Footsteps:** Modulated based on speed and terrain type (crunchy gravel on paths, wet sloshes in water, snapping twigs in thickets, grass swishes in fields).
*   **Low-Pass Master Filter Sweeps:** Immersive muffled effects when submerged underwater or when experiencing low-stamina physical exhaustion.
*   **Soundtrack Radio:** Analog-style sine chord pad loops (Ambient, Chill, Upbeat).

### 5. Multiplayer Lobby Command Center
*   **Fortnite-Style tabs:** Seamless transitions between PLAY tab, Customizer Locker, Global Leaderboard, and Rules Guide.
*   **Runner Customizer Locker:** Customize your runner name, team jersey color, hair style, jersey print pattern, and navigation accessories (visor, headphones).
*   **Squad Pedestals:** Dynamic 3D platform pedestals showing party member statuses and colors in the lobby.
*   **Party Chat Room:** Connect and coordinate with room players via built-in WebSockets chat.
*   **Post-Race Analysis:** Renders neon path lines representing every runner's route on a shared topographic map for post-mortem analysis.

---

## ⌨️ Controls Layout

| Action | Control Key |
| :--- | :--- |
| **Movement** | `W`, `A`, `S`, `D` / Arrow Keys |
| **Jump / Hurdles Vault** | `Space` |
| **Walk (Stamina Recovery)** | `Left Shift` |
| **Camera View** | `Mouse Move` (Click screen to lock cursor) |
| **Punch Checkpoint** | `E` (When close to a flag) |
| **Toggle Map Sheet** | `M` |
| **Manual Map Rotation** | `Q` (Rotate Counter-Clockwise) / `R` (Rotate Clockwise) |
| **Lobby Radio Soundtrack** | Options inside the Locker tab |
| **Developer Flight Mode** | `Ctrl` + `Shift` + `F` |
| **Lobby Chat Submit** | `Enter` |

---

## 📁 Repository Structure

```text
├── client/                     # Frontend client workspace
│   ├── index.html              # Core landing screen, Fortnite lobby UI & HUD layout
│   ├── package.json            # Client configuration (Three.js, Socket.io-client, Vite)
│   ├── tsconfig.json           # Client TypeScript setup
│   ├── vite.config.ts          # Vite asset server, compiles built bundles directly to server static directory
│   └── src/
│       ├── main.ts             # Primary orchestrator coordinating UI inputs, Socket events & render loops
│       ├── sharedTypes.ts      # Shared typing interfaces (PlayerState, RoomState, Checkpoints)
│       ├── style.css           # Modern dark-mode styling, glassmorphism layouts, and HUD interfaces
│       ├── game/
│       │   ├── Controls.ts     # Physics, stamina, vaulting, head-bobbing, slide states
│       │   ├── Elements.ts     # 3D geometries (checkpoint flags, pedestals, other runners)
│       │   ├── Engine.ts       # WebGL renderer, cameras, and shadow lights
│       │   ├── Foliage.ts      # Voxel vegetation scatter
│       │   ├── MapImporter.ts  # Dem digital maps import handler
│       │   ├── Terrain.ts      # Infinite chunk system, procedural Perlin biomes & water ripples
│       │   └── Wildlife.ts     # Wildlife simulator (birds, rabbits, deer)
│       ├── net/
│       │   └── Network.ts      # WebSocket event listener
│       └── ui/
│           ├── HUD.ts          # Contours map pre-renderer, Silva spring needle & Minimap radar
│           └── Sound.ts        # Dynamic Web Audio procedural synthesizer & soundtracks
│
├── server/                     # Backend server workspace
│   ├── package.json            # Server package configs (Express, Socket.io, nodemon, ts-node)
│   ├── tsconfig.json           # Server TypeScript setup
│   └── src/
│       ├── server.ts           # WebServer entry, 20Hz loop positions broadcast & NTP sync
│       ├── RoomManager.ts      # Room state, player registers, course seeds & score computations
│       └── sharedTypes.ts      # Synced client typings
│
├── package.json                # Project root workspace script hub
└── README.md                   # Project documentation
```

---

## 🛠️ Installation & Setup

### Prerequisites
Make sure you have **Node.js** (v18 or higher) and **npm** installed on your machine.

### 1. Install Dependencies
Run the install command from the root workspace directory. This will automatically install dependencies for the root, the client, and the server directories:
```bash
npm run install:all
```

### 2. Run in Development Mode
To start both the client dev server (Vite, port 3000) and the backend server (ts-node, port 3001) concurrently, run:
```bash
npm run dev
```
Open your browser and navigate to `http://localhost:3000`.

### 3. Build for Production
To compile and bundle both the client and server code for production:
```bash
npm run build
```
This builds the client static bundle into `server/dist/public` and compiles the server TypeScript into `server/dist/server.js`.

### 4. Start Production Server
To start the production server:
```bash
npm run start
```
The application will serve both the backend and client on the port specified by the environment variable `PORT` (defaults to `3001`). Navigate to `http://localhost:3001`.

---

## 🛡️ License

This project is private and proprietary. All rights reserved.
