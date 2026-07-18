/* ===================================================================
   SNIPER ENGINE — Token Creation → 1000x Pattern Detection
   Monitors newly created Solana tokens, analyzes early trading
   patterns, and scores them for explosive gain potential.
   
   Scoring Algorithm: 10 weighted signals, 100 points max.
   External Tools: BubbleMaps, SolanaFM, Arkham Intelligence.
   =================================================================== */

const SniperEngine = (() => {
    'use strict';

    // ——— Configuration ———
    const HELIUS_KEY = '3eb48747-e2b3-43c9-8d9b-490f26b684e0';
    const SNIPER_CONFIG = {
        HELIUS_RPC: `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`,
        HELIUS_API: `https://api.helius.xyz/v0`,
        DEXSCREENER_NEW: 'https://api.dexscreener.com/token-profiles/latest/v1',
        DEXSCREENER_BOOSTED: 'https://api.dexscreener.com/token-boosts/top/v1',
        DEXSCREENER_PAIRS: 'https://api.dexscreener.com/tokens/v1/solana/',
        DEXSCREENER_SEARCH: 'https://api.dexscreener.com/latest/dex/search?q=',
        DEXSCREENER_TRENDING: 'https://api.dexscreener.com/latest/dex/pairs/solana',
        // External analysis tools
        BUBBLEMAPS_URL: 'https://app.bubblemaps.io/sol/token/',
        SOLANAFM_URL: 'https://solana.fm/address/',
        SOLSCAN_URL: 'https://solscan.io/token/',
        ARKHAM_URL: 'https://platform.arkhamintelligence.com/explorer/address/',
        // Engine settings
        SCAN_INTERVAL: 8000,        // Scan for new tokens every 8s (was 20s)
        PRICE_REFRESH: 12000,       // Refresh tracked token prices every 12s
        MAX_TRACKED: 500,           // Max tokens to track simultaneously (was 100)
        MAX_AGE_HOURS: 72,          // Track tokens up to 72h old (was 48h)
        MIN_LIQUIDITY: 100,         // Min $100 liquidity (was $1000 — capture early pump.fun/organic launches)
        HELIUS_DELAY: 150,          // Delay between Helius calls
    };

    // ——— Sniper Score Weights (tuned by pattern analysis) ———
    const SCORE_WEIGHTS = {
        AGE_SWEET_SPOT: 15,         // INCREASED — strongest predictor
        VOLUME_MCAP_RATIO: 10,      // DECREASED — weak predictor, was overweighted
        LIQUIDITY_HEALTH: 8,        // DECREASED — near-zero correlation
        PRICE_MOMENTUM: 15,         // INCREASED — 2nd strongest predictor
        HOLDER_GROWTH: 10,          // INCREASED — moderate predictor
        BUY_SELL_RATIO: 8,          // DECREASED — weak predictor
        SMART_WALLET_MATCH: 10,     // DECREASED — currently broken (0/110 matches)
        MCAP_ZONE: 14,              // INCREASED — moderate predictor with sweet spot
        DEX_BOOST: 5,               // KEPT — negative correlation
        ANTI_RUG: 5,                // KEPT same
    };

    let ws = null;

    // ——— State ———
    const state = {
        trackedTokens: new Map(),   // tokenAddress → TokenData
        sniperAlerts: [],           // High-score alerts
        scanHistory: [],            // Recent scan results
        knownAlphaWallets: new Set(), // Loaded from scanner results
        boostedTokens: new Set(),   // DexScreener boosted tokens
        isRunning: false,
        scanTimer: null,
        priceTimer: null,
        lastScanTime: 0,
        totalScanned: 0,
        totalAlerts: 0,
        onUpdate: null,             // UI callback
        onAlert: null,              // Alert callback
    };

    // ——— Utility ———
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function shortAddr(a) { return a ? a.slice(0, 6) + '...' + a.slice(-4) : '???'; }
    function now() { return Date.now(); }
    function timeAgo(ts) {
        const diff = now() - ts;
        if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
        return `${Math.floor(diff / 86400000)}d`;
    }
    function formatUsd(n) {
        if (!n || isNaN(n)) return '$0';
        if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
        if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
        return `$${n.toFixed(0)}`;
    }

    function sniperLog(msg, level = 'info') {
        const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
        console.log(`🎯 [Sniper] ${msg}`);
        const entry = { time: ts, msg, level };
        state.scanHistory.unshift(entry);
        if (state.scanHistory.length > 200) state.scanHistory.pop();
        if (state.onUpdate) state.onUpdate();
    }

    // ——— Helius RPC Helper ———
    async function heliusRpc(method, params) {
        try {
            const resp = await fetch(SNIPER_CONFIG.HELIUS_RPC, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            if (data.error) throw new Error(data.error.message);
            return data.result;
        } catch (err) {
            // Don't throw — return null so callers can degrade gracefully
            return null;
        }
    }

    // ——— Helius Enhanced API ———
    async function heliusApi(path) {
        try {
            const resp = await fetch(`${SNIPER_CONFIG.HELIUS_API}${path}?api-key=${HELIUS_KEY}`, {
                signal: AbortSignal.timeout(10000),
            });
            if (!resp.ok) return null;
            return await resp.json();
        } catch { return null; }
    }

    // ======================================================================
    //  RUGCHECK SAFETY GATE — Binary pass/fail before scoring
    // ======================================================================

    const rugCheckCache = new Map();

    async function checkRugSafety(tokenAddress) {
        const cached = rugCheckCache.get(tokenAddress);
        if (cached && (Date.now() - cached.timestamp < 600000)) {
            return cached.result;
        }

        try {
            const resp = await fetch(`https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report`, {
                signal: AbortSignal.timeout(5000),
            });
            if (!resp.ok) {
                return { pass: true, reason: 'API unavailable', details: {} };
            }
            const data = await resp.json();

            const mintAuth = !data.mintAuthority || data.mintAuthority === null;
            const freezeAuth = !data.freezeAuthority || data.freezeAuthority === null;
            const markets = data.markets || [];
            const hasLockedLP = markets.some(m => m.lp?.lpLockedPct > 50 || m.lp?.lpBurnedPct > 50);
            const topHolders = data.topHolders || [];
            const top10Pct = topHolders.slice(0, 10).reduce((sum, h) => sum + (h.pct || 0), 0);

            const details = {
                mintAuthorityRevoked: mintAuth,
                freezeAuthorityRevoked: freezeAuth,
                lpSecured: hasLockedLP,
                top10HolderPct: top10Pct,
                riskLevel: data.riskLevel || 'unknown',
                score: data.score || 0,
            };

            const rejectReasons = [];
            if (!mintAuth) rejectReasons.push('Mint authority active');
            if (!freezeAuth) rejectReasons.push('Freeze authority active');

            const pass = rejectReasons.length === 0;
            const result = { pass, reason: pass ? 'Safety checks passed' : rejectReasons.join('; '), details };

            rugCheckCache.set(tokenAddress, { result, timestamp: Date.now() });
            if (rugCheckCache.size > 500) {
                const oldest = [...rugCheckCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
                for (let i = 0; i < 100; i++) rugCheckCache.delete(oldest[i][0]);
            }

            return result;
        } catch (err) {
            return { pass: true, reason: 'RugCheck timeout', details: {} };
        }
    }

    // ======================================================================
    //  TOKEN DISCOVERY — Find newly created Solana tokens
    // ======================================================================

    async function discoverNewTokens() {
        const newTokens = [];

        // Strategy 1: DexScreener boosted tokens (highest visibility)
        try {
            const resp = await fetch(SNIPER_CONFIG.DEXSCREENER_BOOSTED, {
                signal: AbortSignal.timeout(8000),
            });
            if (resp.ok) {
                const data = await resp.json();
                const solTokens = (data || []).filter(t => t.chainId === 'solana');
                for (const t of solTokens.slice(0, 40)) {
                    if (t.tokenAddress && !state.trackedTokens.has(t.tokenAddress)) {
                        newTokens.push({
                            address: t.tokenAddress,
                            source: 'dexscreener_boosted',
                            boosted: true,
                        });
                        state.boostedTokens.add(t.tokenAddress);
                    }
                }
                sniperLog(`📡 DexScreener boosted: ${solTokens.length} Solana tokens`, 'info');
            }
        } catch (e) {
            sniperLog(`DexScreener boosted fetch failed: ${e.message}`, 'warning');
        }

        // Strategy 2: DexScreener latest profiles (new token launches)
        try {
            const resp = await fetch(SNIPER_CONFIG.DEXSCREENER_NEW, {
                signal: AbortSignal.timeout(8000),
            });
            if (resp.ok) {
                const data = await resp.json();
                const solProfiles = (data || []).filter(t => t.chainId === 'solana');
                for (const t of solProfiles.slice(0, 40)) {
                    if (t.tokenAddress && !state.trackedTokens.has(t.tokenAddress)) {
                        newTokens.push({
                            address: t.tokenAddress,
                            source: 'dexscreener_new',
                            boosted: state.boostedTokens.has(t.tokenAddress),
                        });
                    }
                }
                sniperLog(`📡 DexScreener profiles: ${solProfiles.length} new Solana tokens`, 'info');
            }
        } catch (e) {
            sniperLog(`DexScreener profiles fetch failed: ${e.message}`, 'warning');
        }

        // Strategy 3: DexScreener trending search — catch viral tokens by multiple keywords
        const trendingKeywords = ['pump', 'cat', 'dog', 'baby', 'pepe', 'wukong', 'believe', 'mog', 'wif', 'sol', 'ai', 'trump', 'chill', 'pnut', 'goat'];
        // Shuffle and pick top 4 keywords to scan
        const shuffled = [...trendingKeywords].sort(() => 0.5 - Math.random());
        const selectedKeywords = shuffled.slice(0, 4);
        
        for (const kw of selectedKeywords) {
            try {
                const resp = await fetch(SNIPER_CONFIG.DEXSCREENER_SEARCH + kw, {
                    signal: AbortSignal.timeout(8000),
                });
                if (resp.ok) {
                    const data = await resp.json();
                    const pairs = (data?.pairs || []).filter(p => p.chainId === 'solana' && p.baseToken?.address);
                    for (const p of pairs.slice(0, 20)) {
                        const addr = p.baseToken.address;
                        if (!state.trackedTokens.has(addr)) {
                            const ageH = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3600000 : 999;
                            const vol1h = parseFloat(p.volume?.h1) || 0;
                            if (ageH <= 72 && vol1h >= 100) {
                                newTokens.push({ address: addr, source: 'dexscreener_trending', boosted: false });
                            }
                        }
                    }
                    sniperLog(`📡 DexScreener trending "${kw}": found ${pairs.length} pairs`, 'info');
                }
            } catch (e) {
                sniperLog(`DexScreener trending fetch for "${kw}" failed: ${e.message}`, 'warning');
            }
            await sleep(200); // Small pause to avoid rate limits
        }

        return newTokens;
    }

    // ======================================================================
    //  TOKEN DATA ENRICHMENT — Get full pair data from DexScreener
    // ======================================================================

    async function enrichTokenData(tokenAddress) {
        try {
            const resp = await fetch(SNIPER_CONFIG.DEXSCREENER_PAIRS + tokenAddress, {
                signal: AbortSignal.timeout(8000),
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            const pairs = Array.isArray(data) ? data : (data?.pairs || []);
            if (pairs.length === 0) return null;

            const p = pairs[0];
            const ageMs = p.pairCreatedAt ? (now() - p.pairCreatedAt) : null;

            return {
                address: tokenAddress,
                symbol: p.baseToken?.symbol || 'UNKNOWN',
                name: p.baseToken?.name || 'Unknown Token',
                pairAddress: p.pairAddress,
                priceUsd: parseFloat(p.priceUsd) || 0,
                priceNative: parseFloat(p.priceNative) || 0,
                marketCap: parseFloat(p.marketCap || p.fdv) || 0,
                liquidity: parseFloat(p.liquidity?.usd) || 0,
                volume24h: parseFloat(p.volume?.h24) || 0,
                volume6h: parseFloat(p.volume?.h6) || 0,
                volume1h: parseFloat(p.volume?.h1) || 0,
                priceChange5m: parseFloat(p.priceChange?.m5) || 0,
                priceChange1h: parseFloat(p.priceChange?.h1) || 0,
                priceChange6h: parseFloat(p.priceChange?.h6) || 0,
                priceChange24h: parseFloat(p.priceChange?.h24) || 0,
                txns24h: p.txns?.h24 || { buys: 0, sells: 0 },
                txns6h: p.txns?.h6 || { buys: 0, sells: 0 },
                txns1h: p.txns?.h1 || { buys: 0, sells: 0 },
                txns5m: p.txns?.m5 || { buys: 0, sells: 0 },
                createdAt: p.pairCreatedAt || null,
                ageMs: ageMs,
                ageHours: ageMs ? ageMs / 3600000 : null,
                url: p.url || `https://dexscreener.com/solana/${tokenAddress}`,
                dexId: p.dexId,
                // External analysis links
                bubbleMapsUrl: SNIPER_CONFIG.BUBBLEMAPS_URL + tokenAddress,
                solanaFmUrl: SNIPER_CONFIG.SOLANAFM_URL + tokenAddress,
                solscanUrl: SNIPER_CONFIG.SOLSCAN_URL + tokenAddress,
                arkhamUrl: SNIPER_CONFIG.ARKHAM_URL + tokenAddress,
            };
        } catch {
            return null;
        }
    }

    // ======================================================================
    //  ON-CHAIN ANALYSIS — Get holder data, top holders, dev wallet behavior
    // ======================================================================

    async function getTokenHolders(tokenAddress) {
        // Use Helius getTokenLargestAccounts for top holder distribution
        const result = await heliusRpc('getTokenLargestAccounts', [tokenAddress]);
        if (!result || !result.value) return null;

        const holders = result.value;
        const totalFromTop = holders.reduce((sum, h) => sum + (h.uiAmount || 0), 0);

        // Check top holder concentration (rug signal if top holder has >15%)
        const topHolder = holders[0];
        const topHolderPct = totalFromTop > 0 ? ((topHolder?.uiAmount || 0) / totalFromTop) * 100 : 0;

        // Count how many unique holders in top accounts
        const uniqueHolders = holders.filter(h => (h.uiAmount || 0) > 0).length;

        return {
            topHolders: holders.slice(0, 10),
            topHolderPct: topHolderPct,
            uniqueTopHolders: uniqueHolders,
            concentration: topHolderPct > 20 ? 'high' : topHolderPct > 10 ? 'medium' : 'low',
            totalFromTop,
        };
    }

    async function getRecentBuyers(tokenAddress) {
        // Get recent signatures for the token mint
        const sigs = await heliusRpc('getSignaturesForAddress', [
            tokenAddress,
            { limit: 30 }
        ]);
        if (!sigs || sigs.length === 0) return { buyers: new Set(), count: 0 };

        const buyers = new Set();
        // Extract unique signers — these are the wallets interacting with the token
        for (const sig of sigs) {
            // We can't fully parse without getTransaction, but memo contains hints
            // For now, count unique activity as a proxy for unique buyers
            buyers.add(sig.signature);
        }

        return {
            recentTxCount: sigs.length,
            estimatedActivity: sigs.length,
            hasErrors: sigs.some(s => s.err !== null),
        };
    }

    // ======================================================================
    //  SMART MONEY DETECTION — Check if known alpha wallets are buying
    // ======================================================================

    function checkSmartMoney(tokenAddress) {
        let matchCount = 0;
        let matchedWallets = [];

        // Check window-level alpha wallets
        if (typeof window !== 'undefined' && window.__alphaWallets) {
            for (const wallet of window.__alphaWallets) {
                if (wallet.tokens && wallet.tokens.includes(tokenAddress)) {
                    matchCount++;
                    matchedWallets.push(wallet.address);
                }
            }
        }

        return { matchCount, matchedWallets, alphaWalletsLoaded: state.knownAlphaWallets.size };
    }

    // ======================================================================
    //  SNIPER SCORE CALCULATOR — 10 signals, 100 points max
    // ======================================================================

    function calculateSniperScore(tokenData, holderData, smartMoney) {
        const scores = {};
        let total = 0;

        // 1. AGE SWEET SPOT (10 pts) — 5min to 6hrs is ideal
        const ageHours = tokenData.ageHours || 999;
        if (ageHours >= 0.08 && ageHours <= 1) {
            scores.age = SCORE_WEIGHTS.AGE_SWEET_SPOT;          // Peak: 5min-1hr
        } else if (ageHours > 1 && ageHours <= 6) {
            scores.age = SCORE_WEIGHTS.AGE_SWEET_SPOT * 0.7;    // Good: 1-6hr
        } else if (ageHours > 6 && ageHours <= 24) {
            scores.age = SCORE_WEIGHTS.AGE_SWEET_SPOT * 0.3;    // Okay: 6-24hr
        } else {
            scores.age = 0;                                       // Too old or too young
        }

        // 2. VOLUME/MCAP RATIO (15 pts) — High ratio = explosive interest
        const volMcapRatio = tokenData.marketCap > 0
            ? tokenData.volume24h / tokenData.marketCap : 0;
        if (volMcapRatio >= 2) {
            scores.volumeRatio = SCORE_WEIGHTS.VOLUME_MCAP_RATIO;       // Insane volume
        } else if (volMcapRatio >= 0.5) {
            scores.volumeRatio = SCORE_WEIGHTS.VOLUME_MCAP_RATIO * 0.7;
        } else if (volMcapRatio >= 0.1) {
            scores.volumeRatio = SCORE_WEIGHTS.VOLUME_MCAP_RATIO * 0.3;
        } else {
            scores.volumeRatio = 0;
        }

        // 3. LIQUIDITY HEALTH (10 pts) — Loosened to reward even small liquidity
        if (tokenData.liquidity >= 50000) {
            scores.liquidity = SCORE_WEIGHTS.LIQUIDITY_HEALTH;
        } else if (tokenData.liquidity >= 10000) {
            scores.liquidity = SCORE_WEIGHTS.LIQUIDITY_HEALTH * 0.7;
        } else if (tokenData.liquidity >= 3000) {
            scores.liquidity = SCORE_WEIGHTS.LIQUIDITY_HEALTH * 0.5;
        } else if (tokenData.liquidity >= SNIPER_CONFIG.MIN_LIQUIDITY) {
            scores.liquidity = SCORE_WEIGHTS.LIQUIDITY_HEALTH * 0.3;
        } else {
            scores.liquidity = 0;
        }

        // 4. PRICE MOMENTUM (10 pts)
        const m5 = tokenData.priceChange5m;
        const h1 = tokenData.priceChange1h;
        if (m5 > 5 && h1 > 20) {
            scores.momentum = SCORE_WEIGHTS.PRICE_MOMENTUM;             // Strong uptrend
        } else if (m5 > 0 && h1 > 0) {
            scores.momentum = SCORE_WEIGHTS.PRICE_MOMENTUM * 0.6;      // Mild positive
        } else if (m5 > -5 && h1 > -10) {
            scores.momentum = SCORE_WEIGHTS.PRICE_MOMENTUM * 0.2;      // Consolidating
        } else {
            scores.momentum = 0;                                         // Dumping
        }

        // 5. HOLDER GROWTH (10 pts) — Proxy: recent transaction count
        const txns1h = tokenData.txns1h;
        const totalTxns1h = (txns1h.buys || 0) + (txns1h.sells || 0);
        if (totalTxns1h >= 100) {
            scores.holders = SCORE_WEIGHTS.HOLDER_GROWTH;
        } else if (totalTxns1h >= 30) {
            scores.holders = SCORE_WEIGHTS.HOLDER_GROWTH * 0.7;
        } else if (totalTxns1h >= 10) {
            scores.holders = SCORE_WEIGHTS.HOLDER_GROWTH * 0.4;
        } else {
            scores.holders = SCORE_WEIGHTS.HOLDER_GROWTH * 0.1;
        }

        // 6. BUY/SELL RATIO (10 pts) — Strong buy pressure
        const buys1h = txns1h.buys || 0;
        const sells1h = txns1h.sells || 0;
        const buySellRatio = sells1h > 0 ? buys1h / sells1h : (buys1h > 0 ? 5 : 0);
        if (buySellRatio >= 3) {
            scores.buySell = SCORE_WEIGHTS.BUY_SELL_RATIO;              // Heavy accumulation
        } else if (buySellRatio >= 1.5) {
            scores.buySell = SCORE_WEIGHTS.BUY_SELL_RATIO * 0.6;
        } else if (buySellRatio >= 1) {
            scores.buySell = SCORE_WEIGHTS.BUY_SELL_RATIO * 0.3;
        } else {
            scores.buySell = 0;                                          // More selling
        }

        // 7. SMART WALLET MATCH (20 pts) — Highest weight!
        if (smartMoney.matchCount >= 3) {
            scores.smartMoney = SCORE_WEIGHTS.SMART_WALLET_MATCH;
        } else if (smartMoney.matchCount >= 1) {
            scores.smartMoney = SCORE_WEIGHTS.SMART_WALLET_MATCH * 0.5;
        } else {
            scores.smartMoney = 0;
        }

        // 8. MARKET CAP ZONE (14 pts) — Data-driven: $50K-$100K = 38.9% multibagger rate
        const mcap = tokenData.marketCap;
        if (mcap >= 50000 && mcap <= 100000) {
            scores.mcapZone = SCORE_WEIGHTS.MCAP_ZONE;                  // SWEET SPOT: highest multibagger rate
        } else if (mcap >= 10000 && mcap < 50000) {
            scores.mcapZone = SCORE_WEIGHTS.MCAP_ZONE * 0.75;           // Good early zone
        } else if (mcap > 100000 && mcap <= 300000) {
            scores.mcapZone = SCORE_WEIGHTS.MCAP_ZONE * 0.65;           // Extended zone
        } else if (mcap >= 3000 && mcap < 10000) {
            scores.mcapZone = SCORE_WEIGHTS.MCAP_ZONE * 0.4;            // Very early — risky
        } else if (mcap > 300000 && mcap <= 1000000) {
            scores.mcapZone = SCORE_WEIGHTS.MCAP_ZONE * 0.2;            // Late stage
        } else {
            scores.mcapZone = 0;
        }

        // 9. DEXSCREENER BOOST (5 pts)
        scores.dexBoost = state.boostedTokens.has(tokenData.address)
            ? SCORE_WEIGHTS.DEX_BOOST : 0;

        // 10. ANTI-RUG (5 pts)
        let antiRug = SCORE_WEIGHTS.ANTI_RUG;
        if (holderData) {
            if (holderData.topHolderPct > 20) antiRug -= 3;     // Top holder too large
            if (holderData.uniqueTopHolders < 3) antiRug -= 2;  // Too few holders
        }
        // Honeypot check: if there are 0 sells, suspicious
        const sells24 = tokenData.txns24h.sells || 0;
        if (sells24 === 0 && (tokenData.txns24h.buys || 0) > 10) {
            antiRug = 0; // Likely honeypot
        }
        scores.antiRug = Math.max(0, antiRug);

        // Calculate total
        total = Object.values(scores).reduce((sum, v) => sum + v, 0);

        return {
            total: Math.round(total),
            scores,
            grade: total >= 75 ? '🔥 S-TIER' :
                   total >= 60 ? '⚡ A-TIER' :
                   total >= 45 ? '✅ B-TIER' :
                   total >= 30 ? '🟡 C-TIER' : '⚪ D-TIER',
            isSniper: total >= 40,
            isAlert: total >= 50,
        };
    }

    // ======================================================================
    //  FULL TOKEN ANALYSIS — Combines all data sources
    // ======================================================================

    async function analyzeToken(tokenAddress, source = 'manual') {
        // Step 1: Get pair data from DexScreener
        const tokenData = await enrichTokenData(tokenAddress);
        if (!tokenData) return null;

        // Filter: skip if too old or too low liquidity
        if (tokenData.ageHours && tokenData.ageHours > SNIPER_CONFIG.MAX_AGE_HOURS) return null;
        if (tokenData.liquidity < SNIPER_CONFIG.MIN_LIQUIDITY) return null;

        // Step 1b: RugCheck Safety Gate (binary pass/fail)
        const safety = await checkRugSafety(tokenAddress);
        if (!safety.pass) {
            sniperLog(`REJECTED ${tokenData.symbol}: ${safety.reason}`, 'warning');
            return null;
        }
        tokenData.safetyGate = safety;
        await sleep(100);

        // Step 2: Get holder distribution (async, may fail)
        const holderData = await getTokenHolders(tokenAddress);
        await sleep(SNIPER_CONFIG.HELIUS_DELAY);

        // Step 3: Check smart money matches
        const smartMoney = checkSmartMoney(tokenAddress);

        // Step 4: Calculate sniper score
        const score = calculateSniperScore(tokenData, holderData, smartMoney);

        const analysis = {
            ...tokenData,
            holderData,
            smartMoney,
            score,
            source,
            analyzedAt: now(),
            lastPriceUpdate: now(),
        };

        // Store in tracked tokens
        state.trackedTokens.set(tokenAddress, analysis);

        // Fire alert if high score
        if (score.isAlert) {
            const alert = {
                time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                token: analysis,
                score: score.total,
                grade: score.grade,
            };
            state.sniperAlerts.unshift(alert);
            if (state.sniperAlerts.length > 50) state.sniperAlerts.pop();
            state.totalAlerts++;
            sniperLog(`🚨 SNIPER ALERT: ${tokenData.symbol} — Score ${score.total}/100 ${score.grade} | MCap ${formatUsd(tokenData.marketCap)} | Age ${timeAgo(tokenData.createdAt)}`, 'alert');
            if (state.onAlert) state.onAlert(alert);
        } else if (score.isSniper) {
            sniperLog(`⚡ High potential: ${tokenData.symbol} — Score ${score.total}/100 | MCap ${formatUsd(tokenData.marketCap)}`, 'success');
        }

        return analysis;
    }

    // ======================================================================
    //  SCAN LOOP — Continuously discover and analyze new tokens
    // ======================================================================

    async function runScan() {
        if (!state.isRunning) return;

        sniperLog('🔍 Scanning for new token opportunities...', 'info');
        state.lastScanTime = now();

        try {
            // Discover new tokens
            const newTokens = await discoverNewTokens();

            // Analyze each new token
            let analyzed = 0;
            for (const token of newTokens) {
                if (!state.isRunning) break;
                if (state.trackedTokens.size >= SNIPER_CONFIG.MAX_TRACKED) {
                    // Remove oldest/lowest-scored tokens
                    pruneTrackedTokens();
                }

                const result = await analyzeToken(token.address, token.source);
                if (result) {
                    analyzed++;
                    state.totalScanned++;
                }
                await sleep(300); // Don't hammer DexScreener
            }

            sniperLog(`✅ Scan complete: ${analyzed} tokens analyzed, ${state.sniperAlerts.length} alerts active`, 'success');
        } catch (err) {
            sniperLog(`❌ Scan error: ${err.message}`, 'error');
        }

        if (state.onUpdate) state.onUpdate();
    }

    async function refreshPrices() {
        const tokenAddrs = [...state.trackedTokens.keys()];
        if (tokenAddrs.length === 0) return;
        const CHUNK_SIZE = 30;

        for (let i = 0; i < tokenAddrs.length; i += CHUNK_SIZE) {
            const chunk = tokenAddrs.slice(i, i + CHUNK_SIZE);
            const chunkStr = chunk.join(',');

            try {
                const resp = await fetch(SNIPER_CONFIG.DEXSCREENER_PAIRS + chunkStr, {
                    signal: AbortSignal.timeout(8000),
                });
                if (!resp.ok) continue;
                const data = await resp.json();
                const pairs = Array.isArray(data) ? data : (data?.pairs || []);

                // Group pairs by base token address
                const pairMap = new Map();
                for (const p of pairs) {
                    const addr = p.baseToken?.address;
                    if (addr && !pairMap.has(addr)) {
                        pairMap.set(addr, p);
                    }
                }

                // Update tracked tokens in this chunk
                for (const addr of chunk) {
                    const token = state.trackedTokens.get(addr);
                    const p = pairMap.get(addr);
                    if (token && p) {
                        const marketCap = parseFloat(p.marketCap || p.fdv) || 0;
                        const liquidity = parseFloat(p.liquidity?.usd) || 0;
                        const priceChange24h = parseFloat(p.priceChange?.h24) || 0;

                        // Immediate pruning of dumped/rugged tokens!
                        // If market cap falls below $2.5K, liquidity falls below $1K, or it drops >80% in 24h
                        if (marketCap > 0 && (marketCap < 2500 || priceChange24h < -80 || liquidity < 1000)) {
                            state.trackedTokens.delete(addr);
                            continue;
                        }

                        token.priceUsd = parseFloat(p.priceUsd) || token.priceUsd;
                        token.marketCap = marketCap;
                        token.liquidity = liquidity;
                        token.volume1h = parseFloat(p.volume?.h1) || 0;
                        token.volume24h = parseFloat(p.volume?.h24) || token.volume24h;
                        token.priceChange5m = parseFloat(p.priceChange?.m5) || 0;
                        token.priceChange1h = parseFloat(p.priceChange?.h1) || 0;
                        token.priceChange24h = priceChange24h;
                        token.txns1h = p.txns?.h1 || token.txns1h;
                        token.txns5m = p.txns?.m5 || token.txns5m;
                        token.lastPriceUpdate = now();

                        // Recalculate score with fresh data
                        token.score = calculateSniperScore(token, token.holderData, token.smartMoney);
                    }
                }
            } catch { /* skip */ }
            await sleep(200);
        }

        if (state.onUpdate) state.onUpdate();
    }

    function pruneTrackedTokens() {
        // Remove tokens that are too old or scored too low
        const sorted = [...state.trackedTokens.entries()]
            .sort((a, b) => a[1].score.total - b[1].score.total);
        // Remove bottom 25%
        const removeCount = Math.ceil(sorted.length * 0.25);
        for (let i = 0; i < removeCount; i++) {
            state.trackedTokens.delete(sorted[i][0]);
        }
    }

    // ======================================================================
    //  ENGINE CONTROL
    // ======================================================================

    // Initialize PumpPortal real-time WebSocket stream
    function initWebSocket() {
        if (ws) {
            try { ws.close(); } catch(e) {}
        }
        
        try {
            ws = new WebSocket('wss://pumpportal.fun/api/data');
            
            ws.onopen = () => {
                sniperLog('🔌 PumpPortal WebSocket active — streaming real-time launches', 'success');
                ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
            };
            
            ws.onmessage = async (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data && data.mint) {
                        const mint = data.mint;
                        if (!state.trackedTokens.has(mint)) {
                            sniperLog(`✨ WebSocket mint: ${data.tokenSymbol || 'UNKNOWN'} | ${data.tokenName || 'Untitled'} | Mint: ${shortAddr(mint)}`, 'success');
                            // Instantly analyze the token
                            await analyzeToken(mint, 'pumpportal_ws');
                        }
                    }
                } catch(e) {
                    // Ignore parsing errors
                }
            };
            
            ws.onerror = (err) => {
                console.warn('PumpPortal WebSocket error:', err);
            };
            
            ws.onclose = () => {
                if (state.isRunning) {
                    sniperLog('🔌 PumpPortal WebSocket closed — reconnecting in 8s', 'warning');
                    setTimeout(() => {
                        if (state.isRunning) {
                            initWebSocket();
                        }
                    }, 8000);
                }
            };
        } catch (err) {
            console.error('Failed to init PumpPortal WS:', err);
        }
    }

    async function start() {
        if (state.isRunning) return;
        state.isRunning = true;
        sniperLog('🚀 Sniper Engine started — monitoring new token launches...', 'info');

        // Connect real-time WebSocket feed
        initWebSocket();

        // Run initial scan immediately
        await runScan();

        // Set up periodic scanning
        state.scanTimer = setInterval(() => runScan(), SNIPER_CONFIG.SCAN_INTERVAL);

        if (state.onUpdate) state.onUpdate();
    }

    function stop() {
        state.isRunning = false;
        if (state.scanTimer) { clearInterval(state.scanTimer); state.scanTimer = null; }
        
        // Close WebSocket connection
        if (ws) {
            try { ws.close(); } catch(e) {}
            ws = null;
        }
        
        sniperLog('⏹️ Sniper Engine stopped', 'info');
        if (state.onUpdate) state.onUpdate();
    }

    function reset() {
        stop();
        state.trackedTokens.clear();
        state.sniperAlerts = [];
        state.scanHistory = [];
        state.totalScanned = 0;
        state.totalAlerts = 0;
        if (state.onUpdate) state.onUpdate();
    }

    // Load alpha wallets from scanner results
    function loadAlphaWallets(wallets) {
        state.knownAlphaWallets = new Set(wallets.map(w => w.address || w));
        sniperLog(`📋 Loaded ${state.knownAlphaWallets.size} alpha wallets for smart money detection`, 'info');
    }

    // Load tracked tokens from database
    function loadTrackedTokens(tokensList) {
        if (!Array.isArray(tokensList)) return;
        for (const token of tokensList) {
            if (token.address) {
                token.ageHours = token.createdAt ? (now() - token.createdAt) / 3600000 : null;
                state.trackedTokens.set(token.address, token);
            }
        }
        sniperLog(`📋 Restored ${state.trackedTokens.size} tracked tokens from database`, 'info');
        if (state.onUpdate) state.onUpdate();
    }

    // Manual snipe — analyze a specific token address
    async function snipeToken(tokenAddress) {
        sniperLog(`🎯 Manual snipe: analyzing ${shortAddr(tokenAddress)}...`, 'info');
        return await analyzeToken(tokenAddress, 'manual');
    }

    // ======================================================================
    //  PUBLIC API
    // ======================================================================

    function getState() {
        const tokens = [...state.trackedTokens.values()]
            .sort((a, b) => b.score.total - a.score.total);

        return {
            isRunning: state.isRunning,
            tokens,
            alerts: state.sniperAlerts,
            logs: state.scanHistory.slice(0, 50),
            totalScanned: state.totalScanned,
            totalAlerts: state.totalAlerts,
            trackedCount: state.trackedTokens.size,
            lastScanTime: state.lastScanTime,
            sniperTokens: tokens.filter(t => t.score.isSniper),
            alertTokens: tokens.filter(t => t.score.isAlert),
        };
    }

    // Start background price refresher immediately and keep it running forever!
    setInterval(() => {
        if (state.trackedTokens.size > 0) {
            refreshPrices().catch(err => console.error("Error in background price refresh:", err));
        }
    }, SNIPER_CONFIG.PRICE_REFRESH);

    return {
        start,
        stop,
        reset,
        snipeToken,
        loadAlphaWallets,
        loadTrackedTokens,
        getState,
        checkRugSafety,
        get isRunning() { return state.isRunning; },
        set onUpdate(cb) { state.onUpdate = cb; },
        set onAlert(cb) { state.onAlert = cb; },
        SCORE_WEIGHTS,
        // Expose external tool URL builders
        getBubbleMapsUrl: (addr) => SNIPER_CONFIG.BUBBLEMAPS_URL + addr,
        getSolanaFmUrl: (addr) => SNIPER_CONFIG.SOLANAFM_URL + addr,
        getSolscanUrl: (addr) => SNIPER_CONFIG.SOLSCAN_URL + addr,
        getArkhamUrl: (addr) => SNIPER_CONFIG.ARKHAM_URL + addr,
        getDexScreenerUrl: (addr) => `https://dexscreener.com/solana/${addr}`,
    };
})();
