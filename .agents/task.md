# Task List: Scanner Engine Phase 1-4 Optimizations

- `[x]` Add classification constants and classifyToken function in sniper-engine.js
- `[x]` Update enqueueToken with dual-track queue priority logic in sniper-engine.js
- `[x]` Modify analyzeToken filter gates to skip low liquidity checks for bonding curve tokens in sniper-engine.js
- `[x]` Implement isFreshGraduate and scoreFreshGraduate routines in sniper-engine.js
- `[x]` Optimize scoreBuySell, scoreMcapZone, and scoreMomentum metrics in sniper-engine.js
- `[x]` Implement Graduation Watchlist tracking and graduation alerts detection in sniper-engine.js
- `[x]` Update app.js thresholds and tab category mappings (Tradeable >= 55, Watchlist 45-54, Hidden < 45)
- `[x]` Add UI tabs and rendering logic for "Fresh" and "Graduating" tabs in index.html and app.js
- `[x]` Verify changes using node -c, run a syntax check, and push updates to Git
