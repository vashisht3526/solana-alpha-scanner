# Solana Alpha Scanner — Agent Rules

## Project Overview
- **Type**: Client-side Solana memecoin scanner (HTML/CSS/JS)
- **Hosting**: Azure Static Web Apps (free tier) — auto-deploys from GitHub `main` branch
- **Repo**: github.com/vashisht3526/solana-alpha-scanner
- **Local Dev**: `npx -y http-server -p 8888 --cors -c-1` from `c:\Users\admin\Desktop\Solana`

## Architecture Constraints
- **NO paid backend/VPS** — everything runs in browser
- **NO paid APIs** — only free APIs (DexScreener, RugCheck, PumpPortal WebSocket, Helius free tier)
- **IndexedDB** for persistence (db.js) — keep total size under 50MB
- **Static files only** — no Node.js server, no build step

## Key Files
| File | Role | Size |
|------|------|------|
| `app.js` | Main UI logic, rendering, event handlers | ~157KB |
| `sniper-engine.js` | Token discovery, scoring (10 metrics, 100pts), RugCheck safety gate | ~38KB |
| `paper-trade.js` | Paper trading engine with 7-layer exit system | ~38KB |
| `db.js` | IndexedDB wrapper (ScannerDB), auto-cleanup on startup | ~31KB |
| `cluster-intel.js` | Wallet clustering and syndicate detection | ~52KB |
| `index.html` | UI layout and structure | ~48KB |
| `index.css` | Styling | ~74KB |
| `radar.js` | Radar/trending token display | ~19KB |
| `bubble-map.js` | Bubble map visualization | ~24KB |

## Current System State (v2.0 — July 2026)
- **Score Weights** (data-driven): Age=15, Momentum=15, MCap=14, Holders=10, Volume=10, SmartMoney=10, Liquidity=8, BuySell=8, DexBoost=5, AntiRug=5
- **Safety Gate**: RugCheck API auto-rejects tokens with active mint/freeze authority
- **MCap Sweet Spot**: $50K-$100K gets full score (38.9% multibagger rate in data)
- **Exit Engine**: Time-decay (15min), breakeven lock (+30%), profit ladder (25% at +50/+150/+300%), ATR trailing stop (2.5x), max hold (4h organic / 45min insider)
- **Position Limits**: Max 3 open, min score 60, min liquidity $15K
- **DB Cleanup**: Auto-prunes clusters >50K, alerts >5K, scans >200 on startup

## Data Sources (All Free)
- DexScreener API (pairs, boosted, search, trending)
- PumpPortal WebSocket (real-time new token mints)
- Helius RPC (holder data, token accounts) — free tier
- RugCheck API (mint/freeze authority, LP status)

## Token Budget Rules
- Read specific line ranges, not entire files
- Use targeted grep searches before reading files
- Don't propose backend/VPS solutions
- Don't suggest paid APIs (Birdeye, Twitter API v2)
- Don't paste large code blocks into chat — save to file instead
- Max 2 subagents at a time
