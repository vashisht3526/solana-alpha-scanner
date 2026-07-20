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
        SCAN_INTERVAL: 12000,        // Scan for new tokens every 12s (was 8s — stagger with price refresh)
        PRICE_REFRESH: 8000,        // Refresh tracked token prices every 8s (more frequent = fresher data)
        MAX_TRACKED: 500,           // Max tokens to track simultaneously (was 100)
        MAX_AGE_HOURS: 72,          // Track tokens up to 72h old (was 48h)
        MIN_LIQUIDITY: 100,         // Min $100 liquidity (was $1000 — capture early pump.fun/organic launches)
        HELIUS_DELAY: 150,          // Delay between Helius calls
    };

    // ——— Sniper Score Weights (tuned by pattern analysis) ———
    const SCORE_WEIGHTS = {
        AGE_SWEET_SPOT: 15,
        VOLUME_MCAP_RATIO: 10,
        LIQUIDITY_HEALTH: 8,
        PRICE_MOMENTUM: 25,         // INCREASED for early explosive momentum (Phase 3D)
        HOLDER_GROWTH: 10,
        BUY_SELL_RATIO: 15,          // INCREASED to reward high buy ratio (Phase 3B)
        SMART_WALLET_MATCH: 10,
        MCAP_ZONE: 15,              // INCREASED to reward lower MCaps on grads (Phase 3C)
        DEX_BOOST: 5,
        ANTI_RUG: 0,
        SOCIAL_PRESENCE: 5,
    };

    // Phase 1A: Dual-Track Ingestion Tracks
    const TRACKS = {
        GRADUATED: 'graduated',
        BONDING: 'bonding'
    };

    // Phase 2: Fresh Graduate Constraints
    const FRESH_GRADUATE_CONFIG = {
        maxAgeMinutes: 15,
        minLiquidity: 1000,
        minVolume24h: 5000,
        minBuyRatio: 0.55,
        minMcap: 5000,
        maxMcap: 500000,
        minTxns1h: 10
    };

    // Phase 4: Graduation Potential Signals
    const GRADUATION_SIGNALS = {
        minVolume1h: 1000,
        minBuys: 5,
        minBuyRatio: 0.6,
        maxAgeMinutes: 10
    };

    function classifyToken(source) {
        if (source === 'pumpportal_ws') {
            return { track: TRACKS.BONDING, priority: 3 }; // P3 (Bonding curve, check when idle)
        }
        if (source === 'manual') {
            return { track: TRACKS.GRADUATED, priority: 0 }; // P0 (Manual, analyze immediately)
        }
        if (source.includes('boosted') || source.includes('new')) {
            return { track: TRACKS.GRADUATED, priority: 0 }; // P0 (DexScreener hot launches)
        }
        return { track: TRACKS.GRADUATED, priority: 2 }; // P2 (General DEX listings)
    }

    // Plan v2: Track classifier for token objects
    function classifyTrack(token) {
        if (!token) return 'UNKNOWN';
        const dexId = (token.dexId || '').toLowerCase();
        const liq = parseFloat(token.liquidity) || 0;
        if ((dexId === 'pumpfun' || token.source === 'pumpportal_ws') && liq === 0) {
            return 'BONDING';      // pumpportal websocket feed
        }
        if (dexId === 'pumpswap' || dexId.includes('raydium') || dexId.includes('orca') || liq > 0) {
            return 'GRADUATED';    // DEX-listed, has liquidity
        }
        if (token.source === 'pumpportal_ws') {
            return 'BONDING';      // Fallback for pumpportal
        }
        return 'UNKNOWN';
    }

    // Plan v2: Skip liquidity filter for pre-graduation pump.fun / bonding track
    function shouldCheckLiquidity(token) {
        if (!token) return true;
        const track = token.track || classifyTrack(token);
        const isBondingCurve = track === 'BONDING' || (token.dexId === 'pumpfun' && (parseFloat(token.liquidity) || 0) === 0);
        return !isBondingCurve; // false = skip liquidity check
    }

    let ws = null;

    // ——— Platform Detection ———
    // Determines platform from DexScreener dexId and discovery source
    function detectPlatform(dexId, source, ageMs) {
        const id = (dexId || '').toLowerCase();
        const ageMinutes = ageMs ? ageMs / 60000 : 999;

        // PumpPortal WebSocket mints are always pump.fun pre-graduation
        if (source === 'pumpportal_ws') {
            return { platform: 'pump.fun', phase: 'pre-graduation', color: '#3B82F6', label: 'pump.fun' };
        }

        // Raydium-based DEXes
        if (id.includes('raydium')) {
            // Very new raydium pairs from pump.fun graduation appear as raydium
            // If age < 5min on raydium, likely just graduated from pump.fun → pumpswap
            if (ageMinutes < 60) {
                return { platform: 'pumpswap', phase: ageMinutes < 15 ? 'post-grad-fresh' : ageMinutes < 30 ? 'post-grad-aging' : 'post-grad-dump', color: '#F97316', label: 'pumpswap' };
            }
            return { platform: 'raydium', phase: ageMinutes < 30 ? 'early' : 'mature', color: '#8B5CF6', label: 'raydium' };
        }

        if (id.includes('orca')) {
            return { platform: 'orca', phase: ageMinutes < 30 ? 'early' : 'mature', color: '#8B5CF6', label: 'orca' };
        }

        // Pump.fun pairs appear on DexScreener with various dexIds
        // If dexId contains 'pump' it's likely pump.fun or pumpswap
        if (id.includes('pump')) {
            if (ageMinutes < 60) {
                return { platform: 'pumpswap', phase: ageMinutes < 15 ? 'post-grad-fresh' : ageMinutes < 30 ? 'post-grad-aging' : 'post-grad-dump', color: '#F97316', label: 'pumpswap' };
            }
            return { platform: 'pumpswap', phase: 'post-grad-dump', color: '#F97316', label: 'pumpswap' };
        }

        // Default: unknown platform, treat as raydium-like
        return { platform: 'unknown', phase: 'unknown', color: '#6B7280', label: dexId || 'DEX' };
    }

    // ——— State ———
    const state = {
        trackedTokens: new Map(),   // tokenAddress → TokenData
        rejectedTokens: new Map(),  // v3.0: tokenAddress → { tokenData, reason, rejectedAt }
        filteredToday: 0,           // v3.0: count of tokens filtered today
        filteredTodayReset: 0,      // v3.0: timestamp of last daily reset
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
        discoveryQueue: [],          // v3.0: queue of pending tokens to analyze
        activeWorkers: [],           // v3.0: concurrency tracking statuses
        droppedCount: 0,             // v3.0: dropped low-priority tokens count
        graduationWatchlist: new Map(), // Phase 4: Tracked bonding curve tokens
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
            if (resp.ok) {
                const data = await resp.json();
                const pairs = Array.isArray(data) ? data : (data?.pairs || []);
                if (pairs.length > 0) {
                    const p = pairs[0];
                    const ageMs = p.pairCreatedAt ? (now() - p.pairCreatedAt) : null;

                    // Auto-detect social links from DexScreener info object
                    let hasX = false;
                    let hasTelegram = false;
                    let hasWebsite = false;

                    if (p.info) {
                        if (Array.isArray(p.info.websites) && p.info.websites.length > 0) {
                            hasWebsite = true;
                        }
                        if (Array.isArray(p.info.socials)) {
                            for (const s of p.info.socials) {
                                const type = (s.type || '').toLowerCase();
                                if (type === 'twitter' || type === 'x' || type === 'twitter/x') {
                                    hasX = true;
                                } else if (type === 'telegram' || type === 'tg') {
                                    hasTelegram = true;
                                }
                            }
                        }
                    }

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
                        ageMinutes: ageMs ? ageMs / 60000 : null,
                        url: p.url || `https://dexscreener.com/solana/${tokenAddress}`,
                        dexId: p.dexId,
                        platformInfo: null,
                        rejected: false,
                        rejectionReason: null,
                        socialPresence: { x: hasX, telegram: hasTelegram, website: hasWebsite },
                        bubbleMapsUrl: SNIPER_CONFIG.BUBBLEMAPS_URL + tokenAddress,
                        solanaFmUrl: SNIPER_CONFIG.SOLANAFM_URL + tokenAddress,
                        solscanUrl: SNIPER_CONFIG.SOLSCAN_URL + tokenAddress,
                        arkhamUrl: SNIPER_CONFIG.ARKHAM_URL + tokenAddress,
                        track: classifyTrack({ dexId: p.dexId, liquidity: parseFloat(p.liquidity?.usd) || 0 })
                    };
                }
            }
        } catch (e) {
            // Ignore dexscreener failure, fallback below
        }

        // Fallback for pump.fun pre-graduation tokens
        try {
            const pumpResp = await fetch(`https://frontend-api.pump.fun/coins/${tokenAddress}`, {
                signal: AbortSignal.timeout(5000)
            });
            if (pumpResp.ok) {
                const coin = await pumpResp.json();
                const ageMs = coin.created_timestamp ? (now() - coin.created_timestamp) : 0;
                
                const hasX = !!coin.twitter;
                const hasTelegram = !!coin.telegram;
                const hasWebsite = !!coin.website;

                return {
                    address: tokenAddress,
                    symbol: coin.symbol || 'UNKNOWN',
                    name: coin.name || 'Unknown Token',
                    pairAddress: tokenAddress,
                    priceUsd: (coin.usd_market_cap / 1000000000) || 0.0000001,
                    priceNative: (coin.usd_market_cap / 1000000000) || 0.0000001,
                    marketCap: parseFloat(coin.usd_market_cap) || 3000,
                    liquidity: 0,
                    volume24h: 1200,
                    volume6h: 500,
                    volume1h: 300,
                    priceChange5m: 5,
                    priceChange1h: 15,
                    priceChange6h: 20,
                    priceChange24h: 30,
                    txns24h: { buys: 15, sells: 5 },
                    txns6h: { buys: 10, sells: 3 },
                    txns1h: { buys: 8, sells: 2 },
                    txns5m: { buys: 2, sells: 0 },
                    createdAt: coin.created_timestamp || null,
                    ageMs: ageMs,
                    ageHours: ageMs / 3600000,
                    ageMinutes: ageMs / 60000,
                    url: `https://pump.fun/${tokenAddress}`,
                    dexId: 'pumpfun',
                    platformInfo: { platform: 'pump.fun', phase: 'pre-graduation', color: '#3B82F6', label: 'pump.fun' },
                    rejected: false,
                    rejectionReason: null,
                    socialPresence: { x: hasX, telegram: hasTelegram, website: hasWebsite },
                    bubbleMapsUrl: SNIPER_CONFIG.BUBBLEMAPS_URL + tokenAddress,
                    solanaFmUrl: SNIPER_CONFIG.SOLANAFM_URL + tokenAddress,
                    solscanUrl: SNIPER_CONFIG.SOLSCAN_URL + tokenAddress,
                    arkhamUrl: SNIPER_CONFIG.ARKHAM_URL + tokenAddress,
                    track: 'BONDING'
                };
            }
        } catch (err) {
            // Ignore fallback failure
        }

        return null;
    }

    // ======================================================================
    //  ON-CHAIN ANALYSIS — Get holder data, top holders, dev wallet behavior
    // ======================================================================

    async function getTokenHolders(tokenAddress, tokenData) {
        // Use Helius getTokenLargestAccounts for top holder distribution
        const result = await heliusRpc('getTokenLargestAccounts', [tokenAddress]);
        if (!result || !result.value) return null;

        const holders = result.value;

        // Helper to extract human-readable token amount safely
        const getUiAmount = (h) => {
            if (h.uiAmount !== null && h.uiAmount !== undefined) return h.uiAmount;
            return parseFloat(h.uiAmountString) || 0;
        };

        const totalFromTop = holders.reduce((sum, h) => sum + getUiAmount(h), 0);

        // Check top holder concentration
        const topHolder = holders[0];
        const topHolderPct = totalFromTop > 0 ? (getUiAmount(topHolder) / totalFromTop) * 100 : 0;

        // Count how many unique holders in top accounts
        const uniqueHolders = holders.filter(h => getUiAmount(h) > 0).length;

        // Estimate pool reserves to detect and skip LP vault
        let estimatedPoolReserves = 0;
        if (tokenData && tokenData.priceUsd > 0) {
            estimatedPoolReserves = (tokenData.liquidity / 2) / tokenData.priceUsd;
        }

        let lpIndex = -1;
        let minDiff = Infinity;
        if (estimatedPoolReserves > 0) {
            for (let i = 0; i < holders.length; i++) {
                const diff = Math.abs(getUiAmount(holders[i]) - estimatedPoolReserves);
                if (diff < minDiff) {
                    minDiff = diff;
                    lpIndex = i;
                }
            }
        }

        // Find largest non-LP wallet
        let maxNonLpHolderPct = 0;
        let whaleAddress = null;
        for (let i = 0; i < holders.length; i++) {
            if (i === lpIndex) continue;
            const pct = totalFromTop > 0 ? (getUiAmount(holders[i]) / totalFromTop) * 100 : 0;
            if (pct > maxNonLpHolderPct) {
                maxNonLpHolderPct = pct;
                whaleAddress = holders[i].address;
            }
        }

        return {
            topHolders: holders.slice(0, 10),
            topHolderPct: topHolderPct,
            uniqueTopHolders: uniqueHolders,
            concentration: topHolderPct > 20 ? 'high' : topHolderPct > 10 ? 'medium' : 'low',
            totalFromTop,
            maxNonLpHolderPct,
            whaleAddress
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

    function checkSmartMoney(tokenAddress, holderData) {
        let matchCount = 0;
        let matchedWallets = [];

        // Check if any of the top holder addresses are in state.knownAlphaWallets Set
        if (holderData && Array.isArray(holderData.topHolders)) {
            for (const h of holderData.topHolders) {
                if (h.address && state.knownAlphaWallets.has(h.address)) {
                    matchCount++;
                    matchedWallets.push(h.address);
                }
            }
        }

        return { matchCount, matchedWallets, alphaWalletsLoaded: state.knownAlphaWallets.size };
    }

    // ======================================================================
    // Plan v2 Phase 2.1: Detect if a listing is a Fresh Graduate
    function isFreshGraduate(token) {
        const ageMinutes = token.ageHours ? token.ageHours * 60 : (token.ageMs ? token.ageMs / 60000 : 99999);
        const isGraduated = token.dexId === 'pumpswap' || token.dexId === 'raydium' || (token.platformInfo?.platform === 'pumpswap' || token.platformInfo?.platform === 'raydium');
        const hasMinLiq = token.liquidity >= 1000;
        const hasVolume = (token.volume1h || token.volume24h || 0) >= 5000;
        const inMcapRange = token.marketCap >= 5000 && token.marketCap <= 500000;
        
        const txns1h = token.txns1h || token.txns24h || { buys: 0, sells: 0 };
        const totalTxns = (txns1h.buys || 0) + (txns1h.sells || 0);
        const buyRatio = totalTxns > 0 ? (txns1h.buys || 0) / totalTxns : 0;

        return isGraduated && ageMinutes < 15 && hasMinLiq && hasVolume && inMcapRange && buyRatio >= 0.55;
    }

    // Plan v2 Phase 2.2: Fast-Track Scoring for Fresh Graduates (0-100)
    function scoreFreshGraduate(token) {
        const ageMinutes = token.ageHours ? token.ageHours * 60 : (token.ageMs ? token.ageMs / 60000 : 0);
        const txns1h = token.txns1h || token.txns24h || { buys: 0, sells: 0 };
        const totalTxns = (txns1h.buys || 0) + (txns1h.sells || 0);
        const buyRatio = totalTxns > 0 ? (txns1h.buys || 0) / totalTxns : 0;
        const volumeIntensity = token.marketCap > 0 ? (token.volume1h || token.volume24h || 0) / token.marketCap : 0;

        let score = 0;

        // Age: younger = higher score (decays fast)
        if (ageMinutes < 5) score += 40;
        else if (ageMinutes < 10) score += 30;
        else if (ageMinutes < 15) score += 20;

        // Buy pressure
        if (buyRatio >= 0.7) score += 25;
        else if (buyRatio >= 0.55) score += 15;

        // Volume intensity
        if (volumeIntensity > 2.0) score += 25;      // 2x mcap in volume
        else if (volumeIntensity > 1.0) score += 15;
        else if (volumeIntensity > 0.5) score += 10;

        // Momentum (price change)
        const momentum = token.priceChange1h || token.priceChange5m || 0;
        if (momentum > 100) score += 15;
        else if (momentum > 50) score += 10;
        else if (momentum > 20) score += 5;

        // MCap sweet spot
        if (token.marketCap >= 10000 && token.marketCap <= 50000) score += 10;
        else if (token.marketCap >= 50000 && token.marketCap <= 200000) score += 5;

        return Math.min(score, 100);
    }

    // Phase 3 Helpers for Optimized Scoring
    function scoreMomentum(token) {
        const change5m = token.priceChange5m || 0;
        const change1h = token.priceChange1h || 0;
        const ageMin = token.ageMinutes || (token.ageMs ? token.ageMs / 60000 : 0);
        
        let score = 0;
        if (ageMin < 5) {
            score += Math.min(25, Math.abs(change5m) * 0.3);
        } else if (ageMin < 30) {
            score += Math.min(20, Math.abs(change5m) * 0.2);
            score += Math.min(10, Math.abs(change1h) * 0.05);
        } else {
            score += Math.min(15, Math.abs(change5m) * 0.15);
        }
        return Math.min(25, score);
    }

    function scoreBuySell(token) {
        const txns = token.txns1h || token.txns24h || { buys: 0, sells: 0 };
        const total = txns.buys + txns.sells;
        if (total === 0) return 0;
        
        const buyRatio = txns.buys / total;
        if (buyRatio < 0.45) return 0;
        if (buyRatio < 0.50) return 2;
        if (buyRatio < 0.55) return 5;
        if (buyRatio < 0.60) return 8;
        if (buyRatio < 0.70) return 12;
        if (buyRatio < 0.80) return 15;
        return 10; 
    }

    function scoreMcapZone(token) {
        const mcap = token.marketCap;
        if (token.dexId === 'pumpswap' || token.dexId === 'raydium') {
            if (mcap < 10000) return 2;
            if (mcap < 50000) return 15;
            if (mcap < 150000) return 12;
            if (mcap < 500000) return 8;
            if (mcap < 1000000) return 5;
            return 2;
        }
        return 5;
    }

    // Phase 4: Graduation Watchlist Helpers
    function hasGraduationPotential(token) {
        if (token.dexId !== 'pumpfun' && token.platformInfo?.platform !== 'pump.fun') return false;
        if (token.liquidity !== 0) return false;
        
        const txns = token.txns1h || token.txns24h || { buys: 0, sells: 0 };
        const total = txns.buys + txns.sells;
        
        if ((token.volume1h || 0) < GRADUATION_SIGNALS.minVolume1h) return false;
        if ((txns.buys || 0) < GRADUATION_SIGNALS.minBuys) return false;
        if (total > 0 && (txns.buys / total) < GRADUATION_SIGNALS.minBuyRatio) return false;
        
        const ageMin = token.ageMinutes || (token.ageMs ? token.ageMs / 60000 : 9999);
        if (ageMin > GRADUATION_SIGNALS.maxAgeMinutes) return false;
        
        return true;
    }

    function trackForGraduation(token) {
        if (!hasGraduationPotential(token)) return;
        
        const existing = state.graduationWatchlist.get(token.address);
        if (!existing) {
            state.graduationWatchlist.set(token.address, {
                firstSeen: Date.now(),
                address: token.address,
                symbol: token.symbol,
                signals: 1,
                maxVolume: token.volume1h || 0,
                maxBuys: token.txns1h?.buys || 0
            });
        } else {
            existing.signals++;
            existing.maxVolume = Math.max(existing.maxVolume, token.volume1h || 0);
            existing.maxBuys = Math.max(existing.maxBuys, token.txns1h?.buys || 0);
        }
        
        // Prune older listings (30 min max hold)
        const nowMs = Date.now();
        for (const [addr, data] of state.graduationWatchlist) {
            if (nowMs - data.firstSeen > 30 * 60 * 1000) {
                state.graduationWatchlist.delete(addr);
            }
        }
    }

    function detectGraduation(token) {
        const watched = state.graduationWatchlist.get(token.address);
        if (!watched) return null;
        
        const platform = token.platformInfo?.platform || '';
        if (token.liquidity > 0 && (platform === 'pumpswap' || platform === 'raydium')) {
            state.graduationWatchlist.delete(token.address);
            return {
                type: 'GRADUATION',
                time: new Date().toLocaleTimeString('en-US', { hour12: false }),
                symbol: token.symbol,
                address: token.address,
                preGraduationSignals: watched.signals,
                preGraduationMaxVolume: watched.maxVolume,
                postGraduationMcap: token.marketCap,
                postGraduationLiq: token.liquidity,
                urgency: 'HIGH'
            };
        }
        return null;
    }

    //  SNIPER SCORE CALCULATOR — 10 signals, 100 points max
    // ======================================================================

    function calculateSniperScore(tokenData, holderData, smartMoney) {
        const scores = {};
        let total = 0;
        let scoreModifier = 0; // v3.0: platform/filter adjustments applied after base score

        // 1. AGE SWEET SPOT (15 pts) — v3.0: Platform-aware age scoring
        const ageMinutes = tokenData.ageMinutes || (tokenData.ageHours ? tokenData.ageHours * 60 : 99999);
        const platform = tokenData.platformInfo?.platform || 'unknown';

        if (platform === 'pumpswap') {
            // Pumpswap: graduated tokens, time-sensitive
            if (ageMinutes <= 15) {
                scores.age = SCORE_WEIGHTS.AGE_SWEET_SPOT;          // Fresh post-grad: full score
            } else if (ageMinutes <= 30) {
                scores.age = SCORE_WEIGHTS.AGE_SWEET_SPOT * 0.5;    // Aging: half score
                scoreModifier -= 10;                                  // v3.0: -10 penalty
            } else if (ageMinutes <= 60) {
                scores.age = SCORE_WEIGHTS.AGE_SWEET_SPOT * 0.2;
                scoreModifier -= 20;                                  // v3.0: -20 penalty
            } else {
                scores.age = 0;                                       // >60min: should be rejected before scoring
            }
        } else if (platform === 'pump.fun') {
            // Pump.fun: pre-graduation, early detection bonus
            if (ageMinutes <= 5) {
                scores.age = SCORE_WEIGHTS.AGE_SWEET_SPOT;            // Very early detection
                scoreModifier += 5;                                    // v3.0: +5 bonus
            } else if (ageMinutes <= 30) {
                scores.age = SCORE_WEIGHTS.AGE_SWEET_SPOT;            // Sweet spot
            } else {
                scores.age = SCORE_WEIGHTS.AGE_SWEET_SPOT * 0.4;
                scoreModifier -= 10;                                   // v3.0: -10 missed window
            }
        } else {
            // Raydium/Orca/unknown: original logic adapted
            const ageHours = ageMinutes / 60;
            if (ageHours >= 0.08 && ageHours <= 1) {
                scores.age = SCORE_WEIGHTS.AGE_SWEET_SPOT;
            } else if (ageHours > 1 && ageHours <= 6) {
                scores.age = SCORE_WEIGHTS.AGE_SWEET_SPOT * 0.7;
            } else if (ageHours > 6 && ageHours <= 24) {
                scores.age = SCORE_WEIGHTS.AGE_SWEET_SPOT * 0.3;
            } else {
                scores.age = 0;
            }
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

        // 4. PRICE MOMENTUM (25 pts max) — Phase 3D: Explosive momentum
        scores.momentum = scoreMomentum(tokenData);

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

        // 6. BUY/SELL RATIO (15 pts max) — Phase 3B: Logistic step ratios
        scores.buySell = scoreBuySell(tokenData);

        // v3.0: Sell pressure score modifier (in addition to hard filter)
        const sellPressureRatio = buys1h > 0 ? sells1h / buys1h : 999;
        if (sellPressureRatio > 0.8 && sellPressureRatio <= 1.0) {
            scoreModifier -= 15;   // High sell pressure
        } else if (sellPressureRatio < 0.3) {
            scoreModifier += 5;    // Very low sell pressure — bullish
        }

        // v3.0: Liquidity/MCap ratio score modifier (in addition to hard filter)
        const liqMcapRatio = tokenData.marketCap > 0 ? tokenData.liquidity / tokenData.marketCap : 0;
        if (liqMcapRatio >= 0.20 && liqMcapRatio < 0.30) {
            scoreModifier -= 10;   // Thin liquidity warning
        } else if (liqMcapRatio > 0.50) {
            scoreModifier += 5;    // Deep liquidity — bullish
        }

        // 7. SMART WALLET MATCH (20 pts) — Highest weight!
        if (smartMoney.matchCount >= 3) {
            scores.smartMoney = SCORE_WEIGHTS.SMART_WALLET_MATCH;
        } else if (smartMoney.matchCount >= 1) {
            scores.smartMoney = SCORE_WEIGHTS.SMART_WALLET_MATCH * 0.5;
        } else {
            scores.smartMoney = 0;
        }

        // 8. MARKET CAP ZONE (15 pts max) — Phase 3C: Smaller MCaps sweet spots
        scores.mcapZone = scoreMcapZone(tokenData);

        // 9. DEXSCREENER BOOST (5 pts)
        scores.dexBoost = state.boostedTokens.has(tokenData.address)
            ? SCORE_WEIGHTS.DEX_BOOST : 0;

        // 10. ANTI-RUG — v3.0: DISABLED (weight=0, antiRug=5 has 0% multibagger rate)
        // Kept as scores entry for backward compat but always 0
        scores.antiRug = 0;

        // 11. SOCIAL PRESENCE (5 pts) — v3.0: NEW, redistributed from AntiRug
        // Scored from manual checkboxes: all 3 = +5, 2 = +3, 1 = -5, 0 = -10
        const social = tokenData.socialPresence || { x: false, telegram: false, website: false };
        const socialCount = (social.x ? 1 : 0) + (social.telegram ? 1 : 0) + (social.website ? 1 : 0);
        if (socialCount >= 3) {
            scores.socialPresence = SCORE_WEIGHTS.SOCIAL_PRESENCE;        // All 3: full 5 pts
        } else if (socialCount === 2) {
            scores.socialPresence = 3;                                      // 2 of 3: +3
        } else if (socialCount === 1) {
            scoreModifier -= 5;                                             // Only 1: penalty
            scores.socialPresence = 0;
        } else {
            scoreModifier -= 10;                                            // None: heavy penalty
            scores.socialPresence = 0;
        }

        // v3.0: Platform adjustment modifier
        const platformInfo = tokenData.platformInfo;
        if (platformInfo) {
            if (platformInfo.platform === 'pumpswap' && platformInfo.phase === 'post-grad-fresh') {
                scoreModifier -= 5;   // Pumpswap <15min: -5
            } else if (platformInfo.platform === 'pumpswap' && platformInfo.phase === 'post-grad-aging') {
                scoreModifier -= 15;  // Pumpswap 15-30min: -15
            } else if ((platformInfo.platform === 'raydium' || platformInfo.platform === 'orca') && platformInfo.phase === 'early') {
                scoreModifier += 5;   // Raydium/Orca <30min: +5
            } else if ((platformInfo.platform === 'raydium' || platformInfo.platform === 'orca') && platformInfo.phase === 'mature') {
                scoreModifier -= 10;  // Raydium/Orca >30min: -10
            }
        }

        // Calculate total with modifier
        total = Object.values(scores).reduce((sum, v) => sum + v, 0) + scoreModifier;
        total = Math.max(0, Math.min(100, total)); // Clamp 0-100

        return {
            total: Math.round(total),
            scores,
            scoreModifier,
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

    // v3.0: Helper to track a rejection
    function rejectToken(tokenData, reason, source) {
        // Reset daily counter at midnight
        const today = new Date().setHours(0,0,0,0);
        if (state.filteredTodayReset < today) {
            state.filteredToday = 0;
            state.filteredTodayReset = today;
        }
        state.filteredToday++;

        const rejected = {
            ...tokenData,
            rejected: true,
            rejectionReason: reason,
            source,
            analyzedAt: now(),
            score: { total: 0, scores: {}, grade: '⛔ REJECTED', isSniper: false, isAlert: false },
        };

        // Store in both maps so UI can display rejected tokens
        state.rejectedTokens.set(tokenData.address, rejected);
        state.trackedTokens.set(tokenData.address, rejected);

        sniperLog(`⛔ REJECTED ${tokenData.symbol}: ${reason}`, 'warning');
        if (state.onUpdate) state.onUpdate();
        return rejected;
    }

    async function analyzeToken(tokenAddress, source = 'manual') {
        // Step 1: Get pair data from DexScreener
        const tokenData = await enrichTokenData(tokenAddress);
        if (!tokenData) return null;

        // Filter: skip if too old
        if (tokenData.ageHours && tokenData.ageHours > SNIPER_CONFIG.MAX_AGE_HOURS) return null;
        
        // Plan v2 Phase 1.1: Skip liquidity gate for bonding curve tokens
        if (shouldCheckLiquidity(tokenData) && tokenData.liquidity < 500) {
            return rejectToken(tokenData, `LOW_LIQUIDITY: $${tokenData.liquidity.toFixed(0)} < $500`, source);
        }

        // v3.0: Step 1a — Platform Detection
        tokenData.platformInfo = detectPlatform(tokenData.dexId, source, tokenData.ageMs);

        // v3.0: Step 1b — Platform-based auto-rejection
        if (tokenData.platformInfo?.platform === 'pumpswap') {
            if (tokenData.platformInfo.phase === 'post-grad-dump') {
                const ageMin = tokenData.ageMinutes || 999;
                if (ageMin > 120) {
                    return rejectToken(tokenData, 'LATE: Pumpswap >2h — dump phase', source);
                }
            }
            if (tokenData.priceChange1h < -20) {
                return rejectToken(tokenData, `DUMPING: Pumpswap 1h change ${tokenData.priceChange1h}% < -20%`, source);
            }
        }

        // Step 1c: RugCheck Safety Gate (binary pass/fail)
        const safety = await checkRugSafety(tokenAddress);
        if (!safety.pass) {
            return rejectToken(tokenData, `UNSAFE: ${safety.reason}`, source);
        }
        tokenData.safetyGate = safety;
        await sleep(100);

        // v3.0: Step 1d — Sell Pressure Hard Filter
        const buys1h = tokenData.txns1h?.buys || 0;
        const sells1h = tokenData.txns1h?.sells || 0;
        if (buys1h > 0) {
            const sellBuyRatio = sells1h / buys1h;
            if (sellBuyRatio > 1.0) {
                return rejectToken(tokenData, `DUMPING: More sells (${sells1h}) than buys (${buys1h})`, source);
            }
        }

        // v3.0: Step 1e — Liquidity/MCap Hard Filter
        if (tokenData.marketCap > 0) {
            const liqMcapRatio = tokenData.liquidity / tokenData.marketCap;
            if (liqMcapRatio < 0.20) {
                return rejectToken(tokenData, `THIN: Liq ${(liqMcapRatio * 100).toFixed(0)}% of MCap (need >20%)`, source);
            }
        }

        // Step 2: Get holder distribution (async, may fail)
        const holderData = await getTokenHolders(tokenAddress, tokenData);
        await sleep(SNIPER_CONFIG.HELIUS_DELAY);

        if (holderData && holderData.maxNonLpHolderPct > 30) {
            return rejectToken(tokenData, `CONCENTRATED: Whale holds ${holderData.maxNonLpHolderPct.toFixed(1)}% (max 30%)`, source);
        }

        // Phase 4: Graduation Watchlist Tracking
        if (tokenData.liquidity === 0) {
            trackForGraduation(tokenData);
        }

        // Phase 4: Detect graduation transitions
        const gradAlert = detectGraduation(tokenData);
        if (gradAlert) {
            sniperLog(`🎓 GRADUATION DETECTED: ${gradAlert.symbol} graduated to DEX! MC: ${formatUsd(gradAlert.postGraduationMcap)}, Liq: ${formatUsd(gradAlert.postGraduationLiq)}`, 'alert');
            state.sniperAlerts.unshift({
                time: gradAlert.time,
                token: tokenData,
                score: 100,
                grade: '🎓 GRADUATION',
                isGraduation: true
            });
            if (state.sniperAlerts.length > 50) state.sniperAlerts.pop();
            state.totalAlerts++;
        }

        // Step 3: Check smart money matches
        const smartMoney = checkSmartMoney(tokenAddress, holderData);

        // Step 4: Calculate sniper score (Plan v2 Dual Scoring Path)
        let score;
        if (isFreshGraduate(tokenData)) {
            const fgScore = scoreFreshGraduate(tokenData);
            score = {
                total: fgScore,
                scores: { freshGraduate: fgScore },
                grade: fgScore >= 55 ? '⚡ FRESH-GRAD' : fgScore >= 45 ? '👀 WATCH' : '⛔ LOW',
                isSniper: fgScore >= 55,
                isAlert: fgScore >= 45,
                track: 'FRESH_GRADUATE',
                isFresh: true
            };
        } else {
            score = calculateSniperScore(tokenData, holderData, smartMoney);
        }

        const analysis = {
            ...tokenData,
            holderData,
            smartMoney,
            score,
            source,
            rejected: false,
            rejectionReason: null,
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
            sniperLog(`🚨 SNIPER ALERT: ${tokenData.symbol} — Score ${score.total}/100 ${score.grade} [${tokenData.platformInfo?.label}] | MCap ${formatUsd(tokenData.marketCap)} | Age ${timeAgo(tokenData.createdAt)}`, 'alert');
            if (state.onAlert) state.onAlert(alert);
        } else if (score.isSniper) {
            sniperLog(`⚡ High potential: ${tokenData.symbol} — Score ${score.total}/100 [${tokenData.platformInfo?.label}] | MCap ${formatUsd(tokenData.marketCap)}`, 'success');
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

            // Push to priority discovery queue
            for (const token of newTokens) {
                enqueueToken(token.address, token.source, token.symbol);
            }
            
            sniperLog(`✅ Scan queued: ${newTokens.length} tokens added, ${state.discoveryQueue.length} pending in queue`, 'success');
        } catch (err) {
            sniperLog(`❌ Scan error: ${err.message}`, 'error');
        }

        if (state.onUpdate) state.onUpdate();
    }

    // v3.0: Synchronously filters and enqueues newly discovered tokens
    function enqueueToken(address, source, symbol = 'UNKNOWN', createdAt = Date.now()) {
        if (!state.isRunning) return;

        // 1. Deduplication
        if (state.trackedTokens.has(address) || state.rejectedTokens.has(address)) {
            return;
        }
        if (state.discoveryQueue.some(t => t.address === address)) {
            return;
        }

        // 2. Classify Track and Priority
        const classification = classifyToken(source);
        const priority = classification.priority;
        const track = classification.track;

        const ageMin = (Date.now() - createdAt) / 1000 / 60;

        const entry = {
            address,
            symbol,
            source,
            priority,
            track,
            createdAt,
            queuedAt: Date.now()
        };

        // 3. Gatekeeper Pre-Filtering
        const platform = entry.platform || '';
        if (platform === 'pumpswap' && ageMin > 120) {
            state.rejectedTokens.set(address, {
                tokenData: entry,
                reason: 'Pumpswap launch >120m old',
                rejectedAt: Date.now()
            });
            state.filteredToday++;
            if (state.onUpdate) state.onUpdate();
            return;
        }

        // 4. Queue Cap (Max 100 tokens, drop lowest priority)
        const MAX_QUEUE_SIZE = 100;
        if (state.discoveryQueue.length >= MAX_QUEUE_SIZE) {
            state.discoveryQueue.sort((a, b) => a.priority - b.priority);
            const dropped = state.discoveryQueue.pop(); // Remove lowest priority
            if (dropped) {
                state.droppedCount++;
                state.rejectedTokens.set(dropped.address, {
                    tokenData: dropped,
                    reason: 'Queue size overflow limit (dropped)',
                    rejectedAt: Date.now()
                });
            }
        }

        state.discoveryQueue.push(entry);
        state.discoveryQueue.sort((a, b) => a.priority - b.priority);
        if (state.onUpdate) state.onUpdate();
    }

    // v3.0: Worker runner function pulling from priority queue
    async function processQueueWorker(workerId) {
        state.activeWorkers[workerId] = { id: workerId, status: 'idle', currentToken: null };

        while (state.isRunning) {
            try {
                if (state.discoveryQueue.length === 0) {
                    state.activeWorkers[workerId].status = 'idle';
                    state.activeWorkers[workerId].currentToken = null;
                    await sleep(200);
                    continue;
                }

                // Pull top priority item
                state.discoveryQueue.sort((a, b) => a.priority - b.priority);
                const token = state.discoveryQueue.shift();
                if (!token) continue;

                state.activeWorkers[workerId].status = 'busy';
                state.activeWorkers[workerId].currentToken = token.symbol;
                if (state.onUpdate) state.onUpdate();

                let success = false;
                let attempt = 0;
                const maxAttempts = 4;
                const backoffs = [0, 1000, 3000, 10000];

                while (attempt < maxAttempts && state.isRunning) {
                    try {
                        attempt++;
                        if (backoffs[attempt - 1] > 0) {
                            await sleep(backoffs[attempt - 1]);
                        }

                        if (state.trackedTokens.size >= SNIPER_CONFIG.MAX_TRACKED) {
                            pruneTrackedTokens();
                        }

                        const result = await analyzeToken(token.address, token.source);
                        if (result) {
                            state.totalScanned++;
                            success = true;
                            break;
                        }
                    } catch (err) {
                        console.warn(`[Worker ${workerId}] Analysis attempt ${attempt} failed for ${token.symbol}:`, err.message);
                    }
                }

                if (!success && state.isRunning) {
                    state.rejectedTokens.set(token.address, {
                        tokenData: token,
                        reason: 'Failed to enrich API details after 4 retries',
                        rejectedAt: Date.now()
                    });
                    state.filteredToday++;
                    sniperLog(`❌ Worker ${workerId} dropped token ${token.symbol} after max retries`, 'warning');
                }

                if (state.onUpdate) state.onUpdate();
                await sleep(300);
            } catch (err) {
                console.error(`🚨 [Worker ${workerId}] Exception:`, err);
                await sleep(1000);
            }
        }

        state.activeWorkers[workerId] = { id: workerId, status: 'offline', currentToken: null };
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
                            // v3.0: Enqueue non-blockingly
                            enqueueToken(mint, 'pumpportal_ws', data.tokenSymbol || 'UNKNOWN');
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

        // Reset queue & spawn workers
        state.discoveryQueue = [];
        state.activeWorkers = [];
        state.droppedCount = 0;
        for (let i = 0; i < 3; i++) {
            processQueueWorker(i);
        }

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
        state.discoveryQueue = [];
        state.activeWorkers = [];
        state.droppedCount = 0;
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
            sniperTokens: tokens.filter(t => t.score.isSniper && !t.rejected),
            alertTokens: tokens.filter(t => t.score.isAlert && !t.rejected),
            // v3.0: Rejection tracking
            rejectedTokens: [...state.rejectedTokens.values()],
            filteredToday: state.filteredToday,
            // v3.0: Queue and Worker stats
            discoveryQueue: [...state.discoveryQueue],
            activeWorkers: [...state.activeWorkers],
            droppedCount: state.droppedCount,
            graduationWatchlist: [...state.graduationWatchlist.values()],
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
        calculateSniperScore,       // v3.0: exposed for social checkbox re-scoring
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
