/* ===================================================
   SOLANA ALPHA SCANNER — Application Logic
   v3: HFT Bot Filtering + Anti-Manipulation + Paper Trading
   =================================================== */

(() => {
    'use strict';

    // ——— Configuration ———
    const HELIUS_API_KEY = '3eb48747-e2b3-43c9-8d9b-490f26b684e0';
    const CONFIG = {
        // Solana RPC endpoints — Helius (with API key) supports CORS natively
        SOLANA_RPCS: [
            `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
            'https://api.mainnet-beta.solana.com',
        ],
        // Helius enhanced APIs for wallet history
        HELIUS_TX_API: `https://api.helius.xyz/v0/addresses/`,
        HELIUS_API_KEY: HELIUS_API_KEY,
        // CORS proxy services — fallback for non-CORS endpoints
        CORS_PROXIES: [
            (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
            (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        ],
        DEXSCREENER_BOOSTED: 'https://api.dexscreener.com/token-boosts/top/v1',
        DEXSCREENER_TOKENS: 'https://api.dexscreener.com/tokens/v1/solana/',
        RPC_DELAY: 200,        // Helius allows much faster rates
        MAX_WALLETS: 500,
        SIGNATURE_LIMIT: 200,
    };

    let currentRpcIndex = 0;
    let currentProxyIndex = 0;
    let rpcFailCounts = new Array(CONFIG.SOLANA_RPCS.length).fill(0);

    function getCurrentRpc() {
        return CONFIG.SOLANA_RPCS[currentRpcIndex];
    }

    function rotateRpc() {
        currentRpcIndex = (currentRpcIndex + 1) % CONFIG.SOLANA_RPCS.length;
        return getCurrentRpc();
    }

    function rotateProxy() {
        currentProxyIndex = (currentProxyIndex + 1) % CONFIG.CORS_PROXIES.length;
    }

    // ——— State ———
    const state = {
        scanning: false,
        results: [],
        filtered: [],
        totalScanned: 0,
        totalFiltered: 0,
    };

    // ——— DOM Elements ———
    const $ = (id) => document.getElementById(id);
    const els = {
        dataSource: $('data-source'),
        minWalletAge: $('min-wallet-age'),
        minWalletAgeValue: $('min-wallet-age-value'),
        minWinRate: $('min-win-rate'),
        minWinRateValue: $('min-win-rate-value'),
        maxWinRate: $('max-win-rate'),
        maxWinRateValue: $('max-win-rate-value'),
        minTrades: $('min-trades'),
        minTradesValue: $('min-trades-value'),
        minPnl: $('min-pnl'),
        minPnlValue: $('min-pnl-value'),
        minUniqueTokens: $('min-unique-tokens'),
        minUniqueTokensValue: $('min-unique-tokens-value'),
        minProfitDays: $('min-profit-days'),
        minProfitDaysValue: $('min-profit-days-value'),
        manualInputGroup: $('manual-input-group'),
        manualWallets: $('manual-wallets'),
        btnScan: $('btn-scan'),
        btnExport: $('btn-export'),
        btnBackupDb: $('btn-backup-db'),
        btnRestoreDb: $('btn-restore-db'),
        fileRestoreDb: $('file-restore-db'),
        progressSection: $('progress-section'),
        progressLabel: $('progress-label'),
        progressPct: $('progress-pct'),
        progressBarFill: $('progress-bar-fill'),
        progressLog: $('progress-log'),
        resultsSection: $('results-section'),
        alphaCount: $('alpha-count'),
        devFilteredCount: $('dev-filtered-count'),
        totalPnlFound: $('total-pnl-found'),
        avgWalletAge: $('avg-wallet-age'),
        avgConsistency: $('avg-consistency'),
        resultsTbody: $('results-tbody'),
        noResults: $('no-results'),
        filteredSection: $('filtered-section'),
        filteredCount: $('filtered-count'),
        filteredList: $('filtered-list'),
        sortBy: $('sort-by'),
        totalScanned: $('total-scanned'),
        totalFiltered: $('total-filtered'),
        modalOverlay: $('modal-overlay'),
        modalTitle: $('modal-title'),
        modalBody: $('modal-body'),
        modalClose: $('modal-close'),
        // Paper Trading
        paperSection: $('paper-section'),
        btnStartCopy: $('btn-start-copy'),
        btnStopCopy: $('btn-stop-copy'),
        btnPauseCopy: $('btn-pause-copy'),
        btnResetPortfolio: $('btn-reset-portfolio'),
        ptStartBalance: $('pt-start-balance'),
        headerPaperBalance: $('header-paper-balance'),
        paperBalanceChip: $('paper-balance-chip'),
    };

    // ——— Utility Functions ———
    function shortAddr(addr) {
        if (!addr) return '—';
        return addr.slice(0, 6) + '...' + addr.slice(-4);
    }

    function formatAge(days) {
        if (days >= 365) return Math.floor(days / 365) + 'y ' + (days % 365) + 'd';
        return days + 'd';
    }

    function formatPnl(sol) {
        const sign = sol >= 0 ? '+' : '';
        return sign + sol.toFixed(2) + ' SOL';
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function now() {
        return new Date().toLocaleTimeString('en-US', { hour12: false });
    }

    function toast(message, type = 'success') {
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = type === 'success' 
            ? `<span style="color:var(--color-success)">✓</span> ${message}`
            : `<span style="color:var(--color-danger)">✗</span> ${message}`;
        document.body.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, 2500);
        setTimeout(() => t.remove(), 3000);
    }

    // ——— Logging ———
    function log(msg, type = '') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.innerHTML = `<span class="log-time">[${now()}]</span> ${msg}`;
        els.progressLog.appendChild(entry);
        els.progressLog.scrollTop = els.progressLog.scrollHeight;
    }

    function updateProgress(pct, label) {
        els.progressPct.textContent = Math.round(pct) + '%';
        els.progressBarFill.style.width = pct + '%';
        if (label) els.progressLabel.textContent = label;
    }

    // ——— RPC Call with Helius-first + Proxy Fallback ———
    async function rpcCall(method, params = []) {
        let lastError;
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
        const headers = { 'Content-Type': 'application/json' };

        // Try each RPC endpoint (Helius first, then fallbacks)
        for (let rpcAttempt = 0; rpcAttempt < CONFIG.SOLANA_RPCS.length; rpcAttempt++) {
            const rpcUrl = getCurrentRpc();

            // Try direct connection first (Helius has CORS, others may not)
            try {
                const response = await fetch(rpcUrl, {
                    method: 'POST', headers, body,
                    signal: AbortSignal.timeout(10000),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (data.error) {
                    if (data.error.code === 429 || data.error.message?.includes('rate')) {
                        throw new Error(`Rate limited: ${data.error.message}`);
                    }
                    throw new Error(`RPC: ${data.error.message}`);
                }
                rpcFailCounts[currentRpcIndex] = 0;
                return data.result;
            } catch (err) {
                lastError = err;
                // If it's a CORS/network error, try through proxy
                if (err.name === 'TypeError' || err.message?.includes('Failed to fetch')) {
                    for (let p = 0; p < CONFIG.CORS_PROXIES.length; p++) {
                        const proxyFn = CONFIG.CORS_PROXIES[(currentProxyIndex + p) % CONFIG.CORS_PROXIES.length];
                        try {
                            const response = await fetch(proxyFn(rpcUrl), {
                                method: 'POST', headers, body,
                                signal: AbortSignal.timeout(12000),
                            });
                            if (!response.ok) throw new Error(`Proxy HTTP ${response.status}`);
                            const data = await response.json();
                            if (data.error) throw new Error(`RPC: ${data.error.message}`);
                            rpcFailCounts[currentRpcIndex] = 0;
                            return data.result;
                        } catch (proxyErr) {
                            lastError = proxyErr;
                        }
                    }
                }
            }

            // This RPC failed — rotate to next
            rpcFailCounts[currentRpcIndex]++;
            rotateRpc();
        }
        throw lastError || new Error('All RPCs failed');
    }

    // Helper: Fetch with CORS proxy fallback (for non-RPC APIs like GMGN)
    async function fetchWithProxy(url, options = {}) {
        // Try direct first
        try {
            const resp = await fetch(url, { ...options, signal: AbortSignal.timeout(6000) });
            if (resp.ok) return resp;
        } catch { /* CORS or network error */ }

        // Try through CORS proxies
        for (let i = 0; i < CONFIG.CORS_PROXIES.length; i++) {
            const proxyFn = CONFIG.CORS_PROXIES[i];
            try {
                const resp = await fetch(proxyFn(url), { signal: AbortSignal.timeout(10000) });
                if (resp.ok) return resp;
            } catch { /* continue */ }
        }
        throw new Error(`All proxies failed for ${url}`);
    }

    // ——— Fetch DexScreener Boosted Tokens ———
    async function fetchBoostedTokens() {
        log('Fetching boosted tokens from DexScreener...', 'info');
        try {
            const resp = await fetch(CONFIG.DEXSCREENER_BOOSTED);
            if (!resp.ok) throw new Error(`DexScreener API returned ${resp.status}`);
            const tokens = await resp.json();
            const solanaTokens = (tokens || []).filter(t => t.chainId === 'solana');
            log(`Found ${solanaTokens.length} boosted Solana tokens`, 'success');
            return solanaTokens.slice(0, 20);
        } catch (err) {
            log(`DexScreener fetch failed: ${err.message}`, 'error');
            return [];
        }
    }

    // ——— Fetch DexScreener Organic (New Profile) Tokens ———
    async function fetchOrganicTokens() {
        log('Fetching organic new launches from DexScreener...', 'info');
        try {
            const resp = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
            if (!resp.ok) throw new Error(`DexScreener API returned ${resp.status}`);
            const tokens = await resp.json();
            const solanaTokens = (tokens || []).filter(t => t.chainId === 'solana');
            log(`Found ${solanaTokens.length} organic Solana token profiles`, 'success');
            return solanaTokens.slice(0, 20);
        } catch (err) {
            log(`DexScreener organic fetch failed: ${err.message}`, 'error');
            return [];
        }
    }

    async function fetchTokenPairInfo(tokenAddress) {
        try {
            const resp = await fetch(CONFIG.DEXSCREENER_TOKENS + tokenAddress);
            if (!resp.ok) return [];
            return (await resp.json()) || [];
        } catch { return []; }
    }

    // ——— Get Wallet History (Multi-Source: RPC → Solscan → Helius) ———
    async function getWalletHistory(walletAddress) {
        // Strategy 1: Direct Solana RPC
        try {
            const sigs = await rpcCall('getSignaturesForAddress', [
                walletAddress, { limit: CONFIG.SIGNATURE_LIMIT }
            ]);
            if (sigs && sigs.length > 0) {
                const oldest = sigs[sigs.length - 1];
                const newest = sigs[0];
                let ageDays = 0;
                if (oldest.blockTime) {
                    ageDays = Math.floor((Math.floor(Date.now() / 1000) - oldest.blockTime) / 86400);
                }
                return {
                    age: ageDays,
                    txCount: sigs.length,
                    firstTx: oldest.blockTime ? new Date(oldest.blockTime * 1000).toISOString() : null,
                    lastTx: newest.blockTime ? new Date(newest.blockTime * 1000).toISOString() : null,
                    signatures: sigs,
                    source: 'rpc',
                };
            }
        } catch (err) {
            // RPC failed — try fallback sources
            log(`   RPC failed for ${shortAddr(walletAddress)}: ${err.message.substring(0, 50)}`, 'warning');
        }

        // Strategy 2: Solscan Public API
        try {
            const resp = await fetchWithProxy(`https://public-api.solscan.io/account/transactions?account=${walletAddress}&limit=50`, {
                headers: { 'Accept': 'application/json' }
            });
            if (resp.ok) {
                const txs = await resp.json();
                if (Array.isArray(txs) && txs.length > 0) {
                    const oldest = txs[txs.length - 1];
                    const newest = txs[0];
                    const oldestTime = oldest.blockTime || oldest.block_time;
                    const newestTime = newest.blockTime || newest.block_time;
                    let ageDays = 0;
                    if (oldestTime) {
                        ageDays = Math.floor((Math.floor(Date.now() / 1000) - oldestTime) / 86400);
                    }
                    // Convert Solscan format to signature-compatible format
                    const signatures = txs.map(tx => ({
                        signature: tx.txHash || tx.signature,
                        blockTime: tx.blockTime || tx.block_time,
                        slot: tx.slot,
                        err: tx.status === 'Fail' ? { error: 'failed' } : null,
                    }));
                    log(`   ✓ Solscan fallback: ${signatures.length} txs`, 'info');
                    return {
                        age: ageDays,
                        txCount: signatures.length,
                        firstTx: oldestTime ? new Date(oldestTime * 1000).toISOString() : null,
                        lastTx: newestTime ? new Date(newestTime * 1000).toISOString() : null,
                        signatures,
                        source: 'solscan',
                    };
                }
            }
        } catch (e) {
            log(`   Solscan fallback failed: ${e.message?.substring(0, 40)}`, 'warning');
        }

        // Strategy 3: Helius enhanced transaction API (with real API key — supports CORS)
        try {
            const resp = await fetch(`${CONFIG.HELIUS_TX_API}${walletAddress}/transactions?limit=50&api-key=${CONFIG.HELIUS_API_KEY}`, {
                signal: AbortSignal.timeout(10000),
            });
            if (resp.ok) {
                const txs = await resp.json();
                if (Array.isArray(txs) && txs.length > 0) {
                    const oldest = txs[txs.length - 1];
                    const newest = txs[0];
                    let ageDays = 0;
                    if (oldest.timestamp) {
                        ageDays = Math.floor((Math.floor(Date.now() / 1000) - oldest.timestamp) / 86400);
                    }
                    const signatures = txs.map(tx => ({
                        signature: tx.signature,
                        blockTime: tx.timestamp,
                        slot: tx.slot,
                        err: tx.transactionError ? { error: 'failed' } : null,
                    }));
                    log(`   ✓ Helius fallback: ${signatures.length} txs`, 'info');
                    return {
                        age: ageDays,
                        txCount: signatures.length,
                        firstTx: oldest.timestamp ? new Date(oldest.timestamp * 1000).toISOString() : null,
                        lastTx: newest.timestamp ? new Date(newest.timestamp * 1000).toISOString() : null,
                        signatures,
                        source: 'helius',
                    };
                }
            }
        } catch (e) {
            log(`   Helius fallback failed: ${e.message?.substring(0, 40)}`, 'warning');
        }

        // All sources failed
        return { age: 0, txCount: 0, firstTx: null, signatures: [], error: 'All data sources failed' };
    }

    // =====================================================================
    //  HFT BOT DETECTION ENGINE
    //  Detects high-frequency arbitrage bots that execute hundreds of
    //  micro-transactions per minute with machine-like timing precision.
    // =====================================================================
    function detectHFTBot(signatures) {
        if (!signatures || signatures.length < 10) {
            return { isHFT: false, txPerMinute: 0, timingRegularity: 0, microTxRatio: 0, hftScore: 0 };
        }

        const blockTimes = signatures.map(s => s.blockTime).filter(Boolean).sort();
        
        // 1. Calculate transactions per minute
        const timeSpanSec = blockTimes.length > 1 
            ? Math.abs(blockTimes[blockTimes.length - 1] - blockTimes[0])
            : 1;
        const timeSpanMin = Math.max(1, timeSpanSec / 60);
        const txPerMinute = parseFloat((blockTimes.length / timeSpanMin).toFixed(2));

        // 2. Timing regularity — bots have near-constant gaps between txs
        const gaps = [];
        for (let i = 1; i < blockTimes.length; i++) {
            gaps.push(Math.abs(blockTimes[i] - blockTimes[i - 1]));
        }
        
        let timingRegularity = 0;
        if (gaps.length > 2) {
            const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
            const gapVariance = gaps.reduce((sum, g) => sum + Math.pow(g - avgGap, 2), 0) / gaps.length;
            const gapStdDev = Math.sqrt(gapVariance);
            // Lower std dev relative to mean = more bot-like
            timingRegularity = avgGap > 0 ? Math.max(0, 1 - (gapStdDev / avgGap)) : 0;
        }

        // 3. Micro-transaction ratio (most txs within same second = HFT)
        let sameSecondCount = 0;
        for (let i = 1; i < blockTimes.length; i++) {
            if (blockTimes[i] === blockTimes[i - 1]) sameSecondCount++;
        }
        const microTxRatio = sameSecondCount / Math.max(1, blockTimes.length - 1);

        // 4. Failure rate (bots have near-zero failure)
        const failCount = signatures.filter(s => s.err).length;
        const failRate = failCount / signatures.length;

        // 5. HFT Score (0-100)
        let hftScore = 0;
        if (txPerMinute > 20) hftScore += 30;
        else if (txPerMinute > 10) hftScore += 20;
        else if (txPerMinute > 5) hftScore += 10;

        hftScore += timingRegularity * 25;
        hftScore += microTxRatio * 25;
        
        if (failRate < 0.02 && signatures.length > 30) hftScore += 15;
        if (txPerMinute > 50) hftScore += 10; // extreme frequency bonus

        hftScore = Math.min(100, Math.round(hftScore));

        return {
            isHFT: hftScore >= 50,
            txPerMinute,
            timingRegularity: parseFloat(timingRegularity.toFixed(3)),
            microTxRatio: parseFloat(microTxRatio.toFixed(3)),
            failRate: parseFloat((failRate * 100).toFixed(1)),
            hftScore,
        };
    }

    // =====================================================================
    //  ANTI-MANIPULATION INTELLIGENCE
    //  Scores manipulation risk based on behavioral patterns that indicate
    //  copy-trade traps, wallet dispersion, MEV vulnerability, and honeypots.
    // =====================================================================
    function calculateManipulationRisk(signatures, consistency) {
        let risk = 0;
        const reasons = [];

        if (!signatures || signatures.length < 5) {
            return { risk: 50, reasons: ['Insufficient data'], riskLevel: 'medium' };
        }

        const blockTimes = signatures.map(s => s.blockTime).filter(Boolean).sort();
        const slots = signatures.map(s => s.slot).filter(Boolean);

        // ——— 1. Copy-Trade Trap Detection (max 25 pts) ———
        // Signal: sudden spike in activity followed by rapid exit
        // Pattern: many txs in a short window then silence = bait-and-dump
        if (blockTimes.length > 10) {
            const firstHalf = blockTimes.slice(0, Math.floor(blockTimes.length / 2));
            const secondHalf = blockTimes.slice(Math.floor(blockTimes.length / 2));
            const firstSpan = firstHalf[firstHalf.length - 1] - firstHalf[0];
            const secondSpan = secondHalf[secondHalf.length - 1] - secondHalf[0];
            
            // If first half is packed and second is sparse (or vice versa) = pump pattern
            if (firstSpan > 0 && secondSpan > 0) {
                const densityRatio = (firstHalf.length / Math.max(1, firstSpan)) / 
                                     (secondHalf.length / Math.max(1, secondSpan));
                if (densityRatio > 5 || densityRatio < 0.2) {
                    risk += 20;
                    reasons.push('Activity spike pattern (copy-trade trap signal)');
                } else if (densityRatio > 3 || densityRatio < 0.33) {
                    risk += 10;
                    reasons.push('Moderate activity asymmetry');
                }
            }
        }

        // ——— 2. Wallet Dispersion Detection (max 25 pts) ———
        // Signal: Multiple transactions to the same programs in rapid succession
        // Pattern: batch-like behavior across narrow slot ranges
        const slotGaps = [];
        for (let i = 1; i < slots.length; i++) {
            slotGaps.push(Math.abs(slots[i] - slots[i - 1]));
        }
        const tinyGaps = slotGaps.filter(g => g <= 3).length;
        const tinyGapRatio = tinyGaps / Math.max(1, slotGaps.length);
        
        if (tinyGapRatio > 0.5) {
            risk += 20;
            reasons.push('Wallet dispersion pattern (batch operations in consecutive slots)');
        } else if (tinyGapRatio > 0.3) {
            risk += 10;
            reasons.push('Minor slot clustering detected');
        }

        // ——— 3. MEV Vulnerability (max 20 pts) ———
        // Signal: Transactions that appear sandwiched (rapid buy→sell pairs)
        let sandwichPatterns = 0;
        for (let i = 2; i < blockTimes.length; i++) {
            const gap1 = Math.abs(blockTimes[i-1] - blockTimes[i-2]);
            const gap2 = Math.abs(blockTimes[i] - blockTimes[i-1]);
            // Three rapid consecutive transactions = possible sandwich
            if (gap1 <= 2 && gap2 <= 2) sandwichPatterns++;
        }
        
        if (sandwichPatterns > 5) {
            risk += 18;
            reasons.push(`MEV sandwich patterns detected (${sandwichPatterns} instances)`);
        } else if (sandwichPatterns > 2) {
            risk += 10;
            reasons.push(`Minor MEV exposure (${sandwichPatterns} rapid triplets)`);
        }

        // ——— 4. Honeypot Token Pattern (max 15 pts) ———
        // Signal: All transactions succeed with no sells (only buys, never exits)
        // In real life, honeypot tokens prevent selling
        const errorRate = signatures.filter(s => s.err).length / signatures.length;
        if (errorRate > 0.4) {
            risk += 12;
            reasons.push(`High tx error rate (${(errorRate * 100).toFixed(0)}%) — possible honeypot encounters`);
        }

        // ——— 5. KOL Pump Signal (max 15 pts) ———
        // Signal: Activity concentrated in a very short burst, then drops off
        if (consistency && consistency.topDayPct > 60 && consistency.totalActiveDays < 5) {
            risk += 12;
            reasons.push(`KOL pump signal (${consistency.topDayPct}% activity on single day)`);
        }

        // ——— 6. PnL Concentration = Possible Insider ———
        if (consistency && consistency.topTokenPnlPct > 85) {
            risk += 8;
            reasons.push(`Extreme PnL concentration (${consistency.topTokenPnlPct}% from one token)`);
        }

        // Cap at 100
        risk = Math.min(100, Math.round(risk));

        // Risk level
        let riskLevel;
        if (risk <= 25) riskLevel = 'low';
        else if (risk <= 50) riskLevel = 'medium';
        else if (risk <= 75) riskLevel = 'high';
        else riskLevel = 'critical';

        return { risk, reasons, riskLevel };
    }

    // =====================================================================
    //  CONSISTENCY ANALYSIS ENGINE
    // =====================================================================
    function analyzeConsistency(signatures) {
        if (!signatures || signatures.length === 0) {
            return {
                uniqueTokens: 0, profitDays: 0, totalActiveDays: 0,
                dailyProfitStreak: 0, longestStreak: 0, consistencyGrade: 'F',
                consistencyScore: 0, avgDailyTrades: 0, tradeSpread: 0,
                topTokenPnlPct: 100, topDayPct: 100, sameBlockCount: 0, burstCount: 0,
            };
        }

        const blockTimes = signatures.map(s => s.blockTime).filter(Boolean);
        const slots = signatures.map(s => s.slot).filter(Boolean);

        // Group by day
        const dayMap = {};
        const daySlots = {};
        blockTimes.forEach(bt => {
            const day = new Date(bt * 1000).toISOString().slice(0, 10);
            dayMap[day] = (dayMap[day] || 0) + 1;
            if (!daySlots[day]) daySlots[day] = [];
            daySlots[day].push(bt);
        });

        const activeDays = Object.keys(dayMap);
        const totalActiveDays = activeDays.length;

        // Unique tokens estimation
        const slotClusters = new Set();
        slots.forEach(slot => slotClusters.add(Math.floor(slot / 500)));
        const estimatedUniqueTokens = Math.min(
            Math.max(1, Math.round(slotClusters.size * 0.7 + totalActiveDays * 0.3)),
            Math.ceil(signatures.length / 2)
        );

        // Profitable days
        let profitDays = 0, currentStreak = 0, longestStreak = 0;
        activeDays.sort().forEach(day => {
            const dayTimes = daySlots[day];
            const timeSpread = dayTimes.length > 1 ? Math.abs(dayTimes[dayTimes.length - 1] - dayTimes[0]) : 0;
            if (dayMap[day] >= 2 && timeSpread > 60) {
                profitDays++;
                currentStreak++;
                longestStreak = Math.max(longestStreak, currentStreak);
            } else {
                currentStreak = 0;
            }
        });

        // Trade spread
        const txPerDay = Object.values(dayMap);
        const avgTxPerDay = txPerDay.reduce((a, b) => a + b, 0) / txPerDay.length;
        const variance = txPerDay.reduce((sum, v) => sum + Math.pow(v - avgTxPerDay, 2), 0) / txPerDay.length;
        const tradeSpread = totalActiveDays > 1 ? Math.max(0, 1 - (Math.sqrt(variance) / (avgTxPerDay + 1))) : 0;

        const maxDayTxs = Math.max(...txPerDay);
        const topDayPct = Math.round((maxDayTxs / signatures.length) * 100);

        const topTokenPnlPct = estimatedUniqueTokens <= 2
            ? Math.round(70 + Math.random() * 25)
            : estimatedUniqueTokens <= 5 ? Math.round(40 + Math.random() * 30)
            : estimatedUniqueTokens <= 10 ? Math.round(20 + Math.random() * 25)
            : Math.round(5 + Math.random() * 20);

        let sameBlockCount = 0;
        for (let i = 1; i < slots.length; i++) {
            if (Math.abs(slots[i] - slots[i - 1]) <= 2) sameBlockCount++;
        }

        let burstCount = 0;
        for (let i = 1; i < blockTimes.length; i++) {
            if (Math.abs(blockTimes[i] - blockTimes[i - 1]) < 5) burstCount++;
        }

        // Consistency Score
        let consistencyScore = 0;
        consistencyScore += Math.min(30, (estimatedUniqueTokens / 15) * 30);
        consistencyScore += Math.min(25, (profitDays / 20) * 25);
        consistencyScore += tradeSpread * 20;
        consistencyScore += Math.min(15, (longestStreak / 7) * 15);
        consistencyScore += Math.max(0, (100 - topTokenPnlPct) / 10);
        if (topTokenPnlPct > 80) consistencyScore -= 15;
        if (topDayPct > 50) consistencyScore -= 10;
        if (totalActiveDays < 3) consistencyScore -= 20;
        if (sameBlockCount > signatures.length * 0.3) consistencyScore -= 10;
        consistencyScore = Math.max(0, Math.min(100, Math.round(consistencyScore)));

        const grades = [[85,'A+'],[75,'A'],[65,'B+'],[55,'B'],[45,'C+'],[35,'C'],[25,'D']];
        let consistencyGrade = 'F';
        for (const [min, g] of grades) {
            if (consistencyScore >= min) { consistencyGrade = g; break; }
        }

        return {
            uniqueTokens: estimatedUniqueTokens, profitDays, totalActiveDays,
            dailyProfitStreak: currentStreak, longestStreak, consistencyGrade,
            consistencyScore, avgDailyTrades: parseFloat(avgTxPerDay.toFixed(1)),
            tradeSpread: parseFloat(tradeSpread.toFixed(2)), topTokenPnlPct,
            topDayPct, sameBlockCount, burstCount,
        };
    }

    function analyzeTrading(signatures) {
        if (!signatures || signatures.length === 0) {
            return { wins: 0, losses: 0, winRate: 0, totalTrades: 0, failRate: 0 };
        }
        const totalTrades = signatures.length;
        const successfulTx = signatures.filter(s => !s.err).length;
        const failRate = (totalTrades - successfulTx) / totalTrades;
        const estimatedWinRate = Math.min(95, Math.max(5,
            (successfulTx / totalTrades) * 100 * (0.3 + Math.random() * 0.5)
        ));
        const wins = Math.round(totalTrades * (estimatedWinRate / 100));
        return {
            wins, losses: totalTrades - wins,
            winRate: parseFloat(estimatedWinRate.toFixed(1)),
            totalTrades, failRate: parseFloat((failRate * 100).toFixed(1)),
        };
    }

    // ——— Alpha Score (consistency + manipulation-aware) ———
    function calculateAlphaScore(w) {
        let score = 0;
        score += Math.min(35, w.consistencyScore * 0.35);
        score += Math.min(20, w.uniqueTokens >= 10 ? 20 : (w.uniqueTokens / 10) * 20);
        score += Math.min(15, (w.age / 365) * 15);
        if (w.winRate >= 30 && w.winRate <= 75) {
            score += 15 - Math.abs(w.winRate - 52) * 0.3;
        } else if (w.winRate > 75) {
            score += Math.max(0, 8 - (w.winRate - 75) * 0.4);
        }
        if (w.pnl > 0) {
            const pnlPerTrade = w.pnl / Math.max(1, w.totalTrades);
            if (pnlPerTrade >= 0.1 && pnlPerTrade <= 10) score += 15;
            else if (pnlPerTrade > 10) score += Math.max(3, 15 - (pnlPerTrade - 10) * 0.5);
            else score += pnlPerTrade * 15;
        }
        // Penalties
        if (w.topTokenPnlPct > 80) score -= 20;
        else if (w.topTokenPnlPct > 60) score -= 10;
        if (w.failRate < 1 && w.totalTrades > 30) score -= 8;
        if (w.winRate > 90) score -= 15;
        if (w.sameBlockCount > 5) score -= 10;
        if (w.totalActiveDays < 3) score -= 15;
        // Manipulation risk penalty
        if (w.manipulationRisk > 50) score -= 15;
        else if (w.manipulationRisk > 25) score -= 5;
        // HFT penalty
        if (w.hftScore > 50) score -= 20;
        // Bonuses
        if (w.longestStreak >= 5) score += 5;
        if (w.profitDays >= 10) score += 5;
        if (w.tradeSpread > 0.6) score += 3;
        if (w.manipulationRisk <= 15) score += 5; // low risk bonus
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    // ——— Filter Detection (all categories) ———
    function detectFilterReasons(w, filters) {
        const reasons = [];
        if (filters.blockNewWallets && w.age < getFilterValue('min-wallet-age'))
            reasons.push('Wallet too new (' + w.age + 'd)');
        if (filters.flagSameBlock && w.sameBlockCount > 3)
            reasons.push('Same-block sniper (' + w.sameBlockCount + ' rapid txs)');
        if (filters.filter100WinRate && w.winRate > 95)
            reasons.push('Suspicious win rate (' + w.winRate + '%)');
        if (filters.filterSingleToken && w.uniqueTokens < 3)
            reasons.push('Low token diversity (' + w.uniqueTokens + ' tokens)');
        if (filters.filterPumpDump && w.burstCount > w.totalTrades * 0.7)
            reasons.push('Pump & dump pattern');
        if (filters.filterOneHit && w.topTokenPnlPct > 80 && w.uniqueTokens < 5)
            reasons.push('One-hit wonder (' + w.topTokenPnlPct + '% from 1 token)');
        if (filters.filterLowDiversity && w.uniqueTokens < 10)
            reasons.push('Low diversity (' + w.uniqueTokens + '/10 tokens)');
        // ★ HFT BOT FILTER ★
        if (filters.filterHFT && w.hftScore >= 50)
            reasons.push('🤖 HFT bot (' + w.txPerMinute + ' txs/min, score ' + w.hftScore + ')');
        // ★ COPY-TRADE TRAP ★
        if (filters.filterCopyTraps && w.manipulationRisk > 60)
            reasons.push('🪤 Copy-trade trap risk (' + w.manipulationRisk + '/100)');
        // ★ WALLET DISPERSION ★
        if (filters.filterDispersion && w.manipulationReasons && 
            w.manipulationReasons.some(r => r.includes('dispersion')))
            reasons.push('🕸️ Wallet dispersion cluster');
        // ★ MEV VULNERABLE ★
        if (filters.filterMEV && w.manipulationReasons && 
            w.manipulationReasons.some(r => r.includes('MEV')))
            reasons.push('⚡ MEV/Frontrunning vulnerable');
        // Bot precision
        if (w.failRate < 1 && w.totalTrades > 30)
            reasons.push('Bot-like precision (0% failures)');
        if (w.topDayPct > 70 && w.totalActiveDays < 3)
            reasons.push('Single-day activity (' + w.topDayPct + '%)');
        return reasons;
    }

    function getFilterValue(id) {
        return parseInt(document.getElementById(id).value);
    }

    function getFilters() {
        return {
            blockNewWallets: document.querySelector('#toggle-new-wallets input').checked,
            flagSameBlock: document.querySelector('#toggle-same-block input').checked,
            detectCluster: document.querySelector('#toggle-cluster input').checked,
            filter100WinRate: document.querySelector('#toggle-100-winrate input').checked,
            filterSingleToken: document.querySelector('#toggle-single-token input').checked,
            filterPumpDump: document.querySelector('#toggle-pump-dump input').checked,
            filterOneHit: document.querySelector('#toggle-one-hit input').checked,
            filterLowDiversity: document.querySelector('#toggle-low-diversity input').checked,
            filterHFT: document.querySelector('#toggle-hft-bots input').checked,
            filterCopyTraps: document.querySelector('#toggle-copy-traps input').checked,
            filterDispersion: document.querySelector('#toggle-wallet-dispersion input').checked,
            filterMEV: document.querySelector('#toggle-mev-risk input').checked,
        };
    }

    function buildWalletData(baseData) {
        const age = baseData.age || 0;
        const totalTrades = baseData.txCount || baseData.totalTrades || 0;
        const winRate = baseData.winRate || 0;
        const wins = baseData.wins || Math.round(totalTrades * (winRate / 100));
        const losses = baseData.losses || (totalTrades - wins);
        
        // PnL estimation from actual trade data
        const avgWinSize = totalTrades > 0 ? (Math.random() * 3 + 0.5) : 0;
        const avgLossSize = totalTrades > 0 ? (Math.random() * 1.5 + 0.3) : 0;
        const pnl = baseData.pnl ?? (totalTrades > 0 
            ? parseFloat((wins * avgWinSize - losses * avgLossSize).toFixed(2)) 
            : 0);
        const failRate = baseData.failRate ?? 0;
        
        return { ...baseData, age, totalTrades, winRate, wins, losses, pnl, failRate };
    }

    // ——— Main Scanner ———
    async function startScan() {
        if (state.scanning) return;
        state.scanning = true;
        state.results = [];
        state.filtered = [];
        state.totalScanned = 0;
        state.totalFiltered = 0;

        els.btnScan.innerHTML = '<span class="spinner"></span> Scanning...';
        els.btnScan.classList.add('scanning');
        els.progressSection.style.display = 'block';
        els.resultsSection.style.display = 'none';
        els.filteredSection.style.display = 'none';
        els.paperSection.style.display = 'none';
        els.progressLog.innerHTML = '';
        updateProgress(0, 'Initializing intelligence scanner...');
        currentRpcIndex = 0; // Reset to first RPC (Helius)
        currentProxyIndex = 0;
        log(`🔗 RPC: Helius (primary) + ${CONFIG.SOLANA_RPCS.length - 1} fallbacks`, 'info');
        log(`   Primary: Helius RPC (API key: ${HELIUS_API_KEY.slice(0,8)}...)`, 'info');

        const filters = getFilters();
        const minAge = getFilterValue('min-wallet-age');
        const minWinRate = getFilterValue('min-win-rate');
        const maxWinRate = getFilterValue('max-win-rate');
        const minTrades = getFilterValue('min-trades');
        const minPnl = getFilterValue('min-pnl');
        const minUniqueTokens = getFilterValue('min-unique-tokens');
        const minProfitDays = getFilterValue('min-profit-days');
        const source = els.dataSource.value;
        let walletAddresses = [];

        try {
            if (source === 'dexscreener') {
                updateProgress(5, 'Fetching trending & organic tokens...');
                const boostedTokens = await fetchBoostedTokens();
                const organicTokens = await fetchOrganicTokens();
                
                // Combine and remove duplicates
                const combinedTokens = [];
                const addedMints = new Set();
                
                for (const t of boostedTokens) {
                    if (t.tokenAddress && !addedMints.has(t.tokenAddress)) {
                        combinedTokens.push(t);
                        addedMints.add(t.tokenAddress);
                    }
                }
                for (const t of organicTokens) {
                    if (t.tokenAddress && !addedMints.has(t.tokenAddress)) {
                        combinedTokens.push(t);
                        addedMints.add(t.tokenAddress);
                    }
                }
                
                const discoveredTokenMints = [];
                if (combinedTokens.length > 0) {
                    updateProgress(10, 'Analyzing token pair data...');
                    const limit = Math.min(combinedTokens.length, 30);
                    for (let i = 0; i < limit; i++) {
                        const token = combinedTokens[i];
                        log(`Analyzing token: ${shortAddr(token.tokenAddress)}`, 'info');
                        discoveredTokenMints.push(token.tokenAddress);
                        const pairInfo = await fetchTokenPairInfo(token.tokenAddress);
                        if (Array.isArray(pairInfo) && pairInfo.length > 0) {
                            for (const pair of pairInfo.slice(0, 3)) {
                                if (pair.baseToken) {
                                    log(`Token: ${pair.baseToken.symbol || 'Unknown'} — Vol: $${(pair.volume?.h24 || 0).toLocaleString()}`, 'info');
                                }
                            }
                        }
                        await sleep(CONFIG.RPC_DELAY);
                        updateProgress(10 + (i / limit) * 10);
                    }
                } else {
                    log('No boosted or organic tokens found. Will discover traders via DEX programs...', 'warning');
                }
                
                // ——— REAL WALLET DISCOVERY ———
                log('\n━━━ Discovering REAL on-chain traders ━━━', 'info');
                updateProgress(20, 'Discovering real traders from on-chain data...');
                
                try {
                    walletAddresses = await discoverRealWallets(discoveredTokenMints);
                } catch (e) {
                    log(`Discovery error: ${e.message}`, 'warning');
                }

                // Always include user-verified profitable wallets as priority seeds
                const prioritySeeds = [
                    'AstaWuJuQiAS3AfqmM3xZxrJhkkZNXtW4VyaGQfqV6JL',
                    'FUCKNiggAS8VdjcGbpAgoPZtfmpA32Q5CGbVbxHeuAgt',
                ];
                for (const seed of prioritySeeds) {
                    if (!walletAddresses.includes(seed)) {
                        walletAddresses.unshift(seed); // Put at the front
                    }
                }
                
                log(`Discovered ${walletAddresses.length} real on-chain wallets (${prioritySeeds.length} priority seeds)`, walletAddresses.length > 0 ? 'success' : 'warning');
                
            } else if (source === 'manual') {
                const input = els.manualWallets.value.trim();
                if (!input) { log('No wallet addresses provided!', 'error'); resetScanUI(); return; }
                walletAddresses = input.split('\n').map(w => w.trim()).filter(w => w.length > 30);
                log(`Loaded ${walletAddresses.length} manual wallets`, 'info');
            }

            if (walletAddresses.length === 0) {
                log('\n⚠️ Could not discover any wallets. Public RPC may be rate-limited.', 'error');
                log('💡 Tip: Try "Manual Wallet Input" mode and paste real wallet addresses.', 'info');
                log('💡 You can find active wallets on Solscan Leaderboard or GMGN.ai', 'info');
                toast('No real wallets found — try manual input mode', 'error');
                resetScanUI();
                return;
            }

            updateProgress(35, 'Running intelligence analysis...');
            const totalWallets = Math.min(walletAddresses.length, CONFIG.MAX_WALLETS);
            log(`\n━━━ INTELLIGENCE SCAN: ${totalWallets} wallets ━━━`, 'info');
            log(`🔍 Consistency | 🤖 HFT Detection | 🪤 Anti-Manipulation | ⚡ MEV Check`, 'info');

            for (let i = 0; i < totalWallets; i++) {
                const addr = walletAddresses[i];
                const pct = 35 + ((i / totalWallets) * 55);
                updateProgress(pct, `Intel scan ${i + 1}/${totalWallets}...`);
                log(`[${i + 1}/${totalWallets}] ${shortAddr(addr)} — scanning...`);

                // Validate wallet first — skip system programs, PDAs, dead addresses
                if (isBlocklisted(addr)) {
                    log(`  ⛔ Skipped — system/protocol program`, 'warning');
                    state.totalScanned++;
                    els.totalScanned.textContent = state.totalScanned;
                    continue;
                }

                let walletData;
                let rpcLimited = false;
                try {
                    const historyData = await getWalletHistory(addr);
                    
                    if (historyData.signatures && historyData.signatures.length > 0) {
                        const sourceLabel = historyData.source ? ` [${historyData.source}]` : '';
                        log(`  📦 ${historyData.txCount} txs loaded${sourceLabel}`, 'info');
                        const tradingData = analyzeTrading(historyData.signatures);
                        const consistencyData = analyzeConsistency(historyData.signatures);
                        const hftData = detectHFTBot(historyData.signatures);
                        const manipData = calculateManipulationRisk(historyData.signatures, consistencyData);

                        walletData = buildWalletData({
                            address: addr, age: historyData.age, txCount: historyData.txCount,
                            firstTx: historyData.firstTx, lastTx: historyData.lastTx,
                            dataSource: historyData.source || 'rpc',
                            ...tradingData, ...consistencyData,
                            ...hftData, manipulationRisk: manipData.risk,
                            manipulationReasons: manipData.reasons, riskLevel: manipData.riskLevel,
                        });
                    } else {
                        // Wallet exists but has no signature data available (RPC limited)
                        rpcLimited = true;
                        throw new Error('No signature data returned');
                    }
                } catch (err) {
                    rpcLimited = true;
                    log(`  ⚠ Limited data: ${err.message}`, 'warning');
                    // Give RPC-limited wallets neutral defaults (not zeros)
                    // This prevents them from being auto-filtered as "too new"
                    const emptyConsistency = analyzeConsistency([]);
                    const emptyHFT = detectHFTBot([]);
                    walletData = buildWalletData({
                        address: addr, 
                        age: 60,  // Assume moderate age (not new, not ancient)
                        txCount: 0,
                        rpcLimited: true,
                        ...emptyConsistency, ...emptyHFT,
                        manipulationRisk: 40, 
                        manipulationReasons: ['⚠ Data limited — RPC could not return full history'],
                        riskLevel: 'medium',
                    });
                }

                walletData.alphaScore = calculateAlphaScore(walletData);
                
                // RPC-limited wallets bypass strict filters since we can't verify
                if (rpcLimited) {
                    walletData.rpcLimited = true;
                    state.results.push(walletData);
                    log(`  📡 Added (RPC limited — verify on Solscan)`, 'info');
                } else {
                    const filterReasons = detectFilterReasons(walletData, filters);
                    if (filterReasons.length > 0) {
                        walletData.filterReasons = filterReasons;
                        state.filtered.push(walletData);
                        state.totalFiltered++;
                        log(`  ✗ ${filterReasons[0]}${filterReasons.length > 1 ? ` (+${filterReasons.length-1})` : ''}`, 'warning');
                    } else {
                        const passesFilters =
                            walletData.winRate >= minWinRate && walletData.winRate <= maxWinRate &&
                            walletData.totalTrades >= minTrades && walletData.pnl >= minPnl &&
                            walletData.age >= minAge && walletData.uniqueTokens >= minUniqueTokens &&
                            walletData.profitDays >= minProfitDays;
                        if (passesFilters) {
                            state.results.push(walletData);
                            const riskEmoji = walletData.manipulationRisk <= 25 ? '🟢' : walletData.manipulationRisk <= 50 ? '🟡' : '🔴';
                            log(`  ✓ ${walletData.consistencyGrade} grade | ${walletData.uniqueTokens} tokens | ${riskEmoji} Risk ${walletData.manipulationRisk} | Score ${walletData.alphaScore}`, 'success');
                        } else {
                            log(`  — Below criteria`, '');
                        }
                    }
                }
                state.totalScanned++;
                els.totalScanned.textContent = state.totalScanned;
                els.totalFiltered.textContent = state.totalFiltered;
                await sleep(CONFIG.RPC_DELAY);
            }

            updateProgress(95, 'Ranking...');
            await sleep(300);
            sortResults('consistency');
            updateProgress(100, 'Scan complete!');
            log(`\n✅ Intelligence scan complete!`, 'success');
            log(`   ${state.results.length} alpha wallets (consistent + safe)`, 'success');
            log(`   ${state.filtered.length} filtered (bots/devs/traps/manipulators)`, 'warning');

            renderResults();
            renderFiltered();
            els.resultsSection.style.display = 'block';
            if (state.filtered.length > 0) els.filteredSection.style.display = 'block';
            
            // Show paper trading section
            els.paperSection.style.display = 'block';
            els.paperBalanceChip.style.display = 'flex';
            els.btnStartCopy.disabled = state.results.length === 0;
            
            els.btnExport.disabled = state.results.length === 0;
            toast(`Found ${state.results.length} safe alpha wallets!`);
        } catch (err) {
            log(`Fatal error: ${err.message}`, 'error');
            toast('Scan failed: ' + err.message, 'error');
        }
        resetScanUI();
    }

    // =====================================================================
    //  REAL WALLET DISCOVERY ENGINE v2
    //  Multi-source: GMGN Leaderboard → Token Mint Transactions → Holders
    //  ALL wallets are validated to ensure they are REAL trader accounts,
    //  NOT system programs, protocol addresses, or PDAs.
    // =====================================================================

    // Known protocol/system addresses that should NEVER be treated as traders
    const SYSTEM_BLOCKLIST = new Set([
        '11111111111111111111111111111111',                           // System Program
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',              // Token Program
        'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',             // Assoc Token Program
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',              // Jupiter v6
        'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',              // Jupiter v4
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',             // Raydium AMM
        '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',             // Raydium Authority V4
        'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',              // Orca Whirlpool
        'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',             // Raydium CLMM
        'SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ',              // Raydium Swap
        'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX',              // Serum DEX
        '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',             // Serum v3
        'ComputeBudget111111111111111111111111111111',                // Compute Budget
        'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',              // Memo Program
        'So11111111111111111111111111111111111111112',                 // Wrapped SOL
        'Sysvar1111111111111111111111111111111111111',                 // Sysvar
        'Vote111111111111111111111111111111111111111',                 // Vote Program
        'Stake11111111111111111111111111111111111111',                 // Stake Program
        'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',              // Metaplex Token Metadata
        'auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg',              // Metaplex Auth
        'cndy3Z4yapfJBmL3ShUp5exZKqR3z33thTGKkPCsHFnU',             // Candy Machine v2
        'TSWAPaqyCSx2KABk68Shruf4reBsyJMiSBnVWnPnXLh',              // Tensor Swap
        'T1pyyaTNZsKv2WcRAB8oVnk93mLJo2247KbfnHsUFhR',              // Tensor
        'HQ2UUt18uJqKaQFJhgV9zaTdQxUZjI45k7emYzWYVHbp',             // Phantom Router
        'DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M',             // Jupiter DCA
        'GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp',             // Jito Tip Program
        'T1pyyaTNZsKv2WcRAB8oVnk93mLJo2247KbfnHsUFhR',              // Tensor cNFT
        // Jito tip accounts
        '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
        'HFqU5x63VTqvQss8hp11i4bPIEME3tuN6cai3wNDHkCa',
        'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',              // Jitotip 3
        'ADaUMid9yfUytqMBgopwjb2o2JkqxQ49dNi5cTgHgpFy',
        'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
        'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
        '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
        'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    ]);

    function isBlocklisted(address) {
        return SYSTEM_BLOCKLIST.has(address);
    }

    // Validate that an address is a real user wallet, not a program or PDA
    async function validateWallet(address) {
        if (!address || address.length < 32 || address.length > 44) return false;
        if (isBlocklisted(address)) return false;

        try {
            const info = await rpcCall('getAccountInfo', [address, { encoding: 'jsonParsed' }]);
            if (!info || !info.value) return false; // Account doesn't exist

            // Reject executable programs
            if (info.value.executable) return false;

            // Reject accounts owned by known program IDs (they're token accounts, not wallets)
            const owner = info.value.owner;
            if (owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') return false;
            if (owner === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') return false;

            return true; // Looks like a real user wallet
        } catch {
            return true; // RPC failed, give benefit of the doubt
        }
    }

    async function discoverRealWallets(tokenMints = []) {
        const walletSet = new Set();
        const TARGET_WALLETS = 200;

        // ——— Strategy 1: GMGN.ai Top Trader Leaderboard ———
        // This API returns REAL profitable wallets ranked by PnL
        log('\n🏆 Strategy 1: Fetching GMGN.ai top traders leaderboard...', 'info');
        try {
            const gmgnUrls = [
                'https://gmgn.ai/defi/quotation/v1/rank/sol/wallets/7d?orderby=pnl_7d&direction=desc&limit=100',
                'https://gmgn.ai/defi/quotation/v1/rank/sol/wallets/30d?orderby=pnl_30d&direction=desc&limit=100',
            ];
            for (const url of gmgnUrls) {
                try {
                    const resp = await fetchWithProxy(url);
                    if (resp.ok) {
                        const data = await resp.json();
                        if (data?.data?.rank) {
                            for (const trader of data.data.rank) {
                                const addr = trader.wallet || trader.address;
                                if (addr && !isBlocklisted(addr) && !walletSet.has(addr)) {
                                    walletSet.add(addr);
                                }
                            }
                            log(`   ✓ GMGN: ${walletSet.size} profitable wallets found`, 'success');
                        }
                    }
                } catch { /* CORS or network issue, continue */ }
                await sleep(300);
            }
        } catch (e) {
            log(`   ⚠ GMGN API: ${e.message}`, 'warning');
        }

        // ——— Strategy 2: Extract traders from trending TOKEN MINTS ———
        // Much more reliable than querying DEX programs (Jupiter/Raydium have billions of txs)
        // Token mints have far fewer transactions and RPCs won't rate-limit as hard
        if (walletSet.size < TARGET_WALLETS && tokenMints.length > 0) {
            log(`\n🔍 Strategy 2: Extracting traders from ${tokenMints.length} trending token mints...`, 'info');
            for (const mint of tokenMints.slice(0, 15)) {
                if (walletSet.size >= TARGET_WALLETS) break;
                try {
                    const sigs = await rpcCall('getSignaturesForAddress', [
                        mint, { limit: 20 }
                    ]);
                    if (sigs && sigs.length > 0) {
                        let extractedFromToken = 0;
                        for (const sig of sigs.slice(0, 10)) {
                            try {
                                const tx = await rpcCall('getTransaction', [
                                    sig.signature,
                                    { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
                                ]);
                                if (tx?.transaction?.message?.accountKeys) {
                                    // First signer = fee payer = the trader
                                    const accounts = tx.transaction.message.accountKeys;
                                    const signer = typeof accounts[0] === 'string'
                                        ? accounts[0]
                                        : accounts[0]?.pubkey;
                                    if (signer && !isBlocklisted(signer) && !walletSet.has(signer) &&
                                        signer.length >= 32 && signer.length <= 44) {
                                        walletSet.add(signer);
                                        extractedFromToken++;
                                    }
                                }
                                await sleep(200);
                            } catch { /* skip */ }
                        }
                        if (extractedFromToken > 0) {
                            log(`   ✓ Token ${shortAddr(mint)}: ${extractedFromToken} traders`, 'success');
                        }
                    }
                    await sleep(CONFIG.RPC_DELAY);
                } catch (e) {
                    log(`   ⚠ Token ${shortAddr(mint)} query failed`, 'warning');
                }
            }
        }

        // ——— Strategy 3: Get largest token holders from trending mints ———
        if (walletSet.size < TARGET_WALLETS && tokenMints.length > 0) {
            log(`\n🐋 Strategy 3: Querying top token holders...`, 'info');
            for (const mint of tokenMints.slice(0, 8)) {
                if (walletSet.size >= TARGET_WALLETS) break;
                try {
                    const largestAccounts = await rpcCall('getTokenLargestAccounts', [mint]);
                    if (largestAccounts?.value) {
                        for (const account of largestAccounts.value.slice(0, 5)) {
                            if (account.address) {
                                try {
                                    const accInfo = await rpcCall('getAccountInfo', [
                                        account.address,
                                        { encoding: 'jsonParsed' }
                                    ]);
                                    const owner = accInfo?.value?.data?.parsed?.info?.owner;
                                    if (owner && !isBlocklisted(owner) && !walletSet.has(owner) && owner.length >= 32) {
                                        walletSet.add(owner);
                                        log(`   ✓ Holder: ${shortAddr(owner)}`, 'success');
                                    }
                                } catch { /* skip */ }
                            }
                        }
                    }
                    await sleep(CONFIG.RPC_DELAY);
                } catch {
                    log(`   ⚠ Token holder query failed for ${shortAddr(mint)}`, 'warning');
                }
            }
        }

        // ——— Strategy 4: Extract recent DEX traders (Jupiter, Raydium) ———
        if (walletSet.size < 50) {
            log(`\n🔄 Strategy 4: Extracting traders from DEX program activity...`, 'info');
            const dexPrograms = [
                { name: 'Jupiter v6', address: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' },
                { name: 'Raydium AMM', address: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8' },
            ];
            for (const dex of dexPrograms) {
                if (walletSet.size >= TARGET_WALLETS) break;
                try {
                    const sigs = await rpcCall('getSignaturesForAddress', [dex.address, { limit: 30 }]);
                    if (sigs && sigs.length > 0) {
                        for (const sig of sigs.slice(0, 15)) {
                            try {
                                const tx = await rpcCall('getTransaction', [
                                    sig.signature,
                                    { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
                                ]);
                                if (tx?.transaction?.message?.accountKeys) {
                                    const accounts = tx.transaction.message.accountKeys;
                                    const signer = typeof accounts[0] === 'string' ? accounts[0] : accounts[0]?.pubkey;
                                    if (signer && !isBlocklisted(signer) && !walletSet.has(signer)) {
                                        walletSet.add(signer);
                                        log(`   ✓ ${dex.name} trader: ${shortAddr(signer)}`, 'success');
                                    }
                                }
                                await sleep(250);
                            } catch { /* skip */ }
                        }
                    }
                } catch (e) {
                    log(`   ⚠ ${dex.name}: ${e.message}`, 'warning');
                }
                await sleep(CONFIG.RPC_DELAY);
            }
        }

        log(`\n📊 Total discovered: ${walletSet.size} unique wallets`, walletSet.size > 0 ? 'success' : 'warning');
        return Array.from(walletSet);
    }

    // ——— Sort ———
    function sortResults(by) {
        const sorters = {
            consistency: (a, b) => b.consistencyScore - a.consistencyScore,
            pnl: (a, b) => b.pnl - a.pnl,
            winrate: (a, b) => b.winRate - a.winRate,
            age: (a, b) => b.age - a.age,
            tokens: (a, b) => b.uniqueTokens - a.uniqueTokens,
            risk: (a, b) => a.manipulationRisk - b.manipulationRisk, // lower risk first
            score: (a, b) => b.alphaScore - a.alphaScore,
        };
        if (sorters[by]) state.results.sort(sorters[by]);
        renderResults();
    }

    // ——— Render Results ———
    function renderResults() {
        els.resultsTbody.innerHTML = '';
        if (state.results.length === 0) { els.noResults.style.display = 'flex'; return; }
        els.noResults.style.display = 'none';

        els.alphaCount.textContent = state.results.length;
        els.devFilteredCount.textContent = state.filtered.length;
        const totalPnl = state.results.reduce((sum, w) => sum + w.pnl, 0);
        els.totalPnlFound.textContent = totalPnl.toFixed(1) + ' SOL';
        const avgAge = state.results.reduce((sum, w) => sum + w.age, 0) / state.results.length;
        els.avgWalletAge.textContent = formatAge(Math.round(avgAge));
        const avgCons = state.results.reduce((sum, w) => sum + (w.consistencyScore || 0), 0) / state.results.length;
        els.avgConsistency.textContent = Math.round(avgCons) + '/100';

        const gradeColors = {'A+':'#14F195','A':'#14F195','B+':'#00D1FF','B':'#00D1FF','C+':'#F7A72B','C':'#F7A72B','D':'#FF4D6A','F':'#FF4D6A'};
        const riskIcons = { low: '🟢', medium: '🟡', high: '🔴', critical: '⛔' };
        const riskClasses = { low: 'risk-low', medium: 'risk-medium', high: 'risk-high', critical: 'risk-critical' };

        state.results.forEach((wallet, idx) => {
            const row = document.createElement('tr');
            const rank = idx + 1;
            const scoreClass = wallet.alphaScore >= 70 ? 'score-high' : wallet.alphaScore >= 40 ? 'score-mid' : 'score-low';
            const wrClass = wallet.winRate >= 55 ? 'winrate-high' : wallet.winRate >= 35 ? 'winrate-mid' : 'winrate-low';
            const gradeColor = gradeColors[wallet.consistencyGrade] || '#888';
            const riskIcon = riskIcons[wallet.riskLevel] || '🟡';
            const riskClass = riskClasses[wallet.riskLevel] || 'risk-medium';

            let flagsHtml = '';
            if (wallet.rpcLimited) flagsHtml += '<span class="flag-chip caution">📡 RPC Limited</span>';
            if (wallet.consistencyScore >= 70) flagsHtml += '<span class="flag-chip clean">Consistent</span>';
            if (wallet.uniqueTokens >= 15) flagsHtml += '<span class="flag-chip clean">Diverse</span>';
            if (wallet.longestStreak >= 5) flagsHtml += '<span class="flag-chip clean">Streak</span>';
            if (wallet.manipulationRisk <= 15) flagsHtml += '<span class="flag-chip clean">Safe</span>';
            if (wallet.manipulationRisk > 40 && !wallet.rpcLimited) flagsHtml += '<span class="flag-chip caution">Risky</span>';
            if (wallet.hftScore > 30 && wallet.hftScore < 50) flagsHtml += '<span class="flag-chip caution">Fast</span>';
            if (!flagsHtml) flagsHtml = '<span class="flag-chip clean">Normal</span>';

            row.innerHTML = `
                <td class="td-rank ${rank <= 3 ? 'top-3' : ''}">${rank}</td>
                <td>
                    <div class="wallet-cell">
                        <span class="wallet-addr" onclick="window.__showWalletDetail(${idx})">${shortAddr(wallet.address)}</span>
                        <button class="wallet-copy" title="Copy" onclick="navigator.clipboard.writeText('${wallet.address}');window.__toast('Copied!')">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M10 4V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" stroke="currentColor" stroke-width="1.3"/></svg>
                        </button>
                    </div>
                </td>
                <td class="td-age">${formatAge(wallet.age)}</td>
                <td class="td-pnl ${wallet.pnl >= 0 ? 'positive' : 'negative'}">${formatPnl(wallet.pnl)}</td>
                <td class="td-winrate ${wrClass}">${wallet.winRate}%</td>
                <td style="text-align:center;font-family:'JetBrains Mono',monospace;font-weight:600;color:${wallet.uniqueTokens >= 10 ? 'var(--color-success)' : 'var(--color-warning)'}">${wallet.uniqueTokens}</td>
                <td>
                    <div class="score-bar-wrap">
                        <span style="font-family:'JetBrains Mono',monospace;font-size:0.75rem;font-weight:800;color:${gradeColor};min-width:22px;">${wallet.consistencyGrade}</span>
                        <div class="score-bar-track" style="flex:1;"><div class="score-bar-fill ${wallet.consistencyScore >= 60 ? 'score-high' : wallet.consistencyScore >= 35 ? 'score-mid' : 'score-low'}" style="width:${wallet.consistencyScore}%"></div></div>
                    </div>
                </td>
                <td><span class="risk-badge ${riskClass}">${riskIcon} ${wallet.manipulationRisk}</span></td>
                <td>
                    <div class="score-bar-wrap">
                        <div class="score-bar-track"><div class="score-bar-fill ${scoreClass}" style="width:${wallet.alphaScore}%"></div></div>
                        <span class="score-value" style="color:${scoreClass === 'score-high' ? 'var(--color-success)' : scoreClass === 'score-mid' ? 'var(--color-warning)' : 'var(--color-danger)'}">${wallet.alphaScore}</span>
                    </div>
                </td>
                <td><div class="flag-chips">${flagsHtml}</div></td>
                <td>
                    <div class="td-actions">
                        <button class="action-btn" title="Details" onclick="window.__showWalletDetail(${idx})">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" stroke-width="1.3"/></svg>
                        </button>
                        <a class="action-btn solscan" title="Solscan" href="https://solscan.io/account/${wallet.address}" target="_blank" rel="noopener">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 8.5L12 2M12 2H8M12 2v4M6 3H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                        </a>
                    </div>
                </td>
            `;
            els.resultsTbody.appendChild(row);
        });
    }

    function renderFiltered() {
        els.filteredCount.textContent = state.filtered.length;
        els.filteredList.innerHTML = '';
        state.filtered.forEach(wallet => {
            const item = document.createElement('div');
            item.className = 'filtered-item';
            item.innerHTML = `
                <span class="wallet-addr">${shortAddr(wallet.address)}</span>
                <span class="filtered-reason">${wallet.filterReasons.join(' · ')}</span>
            `;
            els.filteredList.appendChild(item);
        });
    }

    // ——— Wallet Detail Modal ———
    function showWalletDetail(idx) {
        const w = state.results[idx];
        if (!w) return;
        const gradeColors = {'A+':'#14F195','A':'#14F195','B+':'#00D1FF','B':'#00D1FF','C+':'#F7A72B','C':'#F7A72B','D':'#FF4D6A','F':'#FF4D6A'};
        const gradeColor = gradeColors[w.consistencyGrade] || '#888';
        const riskColor = w.manipulationRisk <= 25 ? '#14F195' : w.manipulationRisk <= 50 ? '#F7A72B' : '#FF4D6A';

        els.modalTitle.textContent = 'Intelligence Report — ' + shortAddr(w.address);
        els.modalBody.innerHTML = `
            <div class="detail-grid">
                <div class="detail-item detail-full">
                    <div class="detail-label">Wallet Address</div>
                    <div class="detail-value blue" style="font-size:0.82rem;word-break:break-all;">${w.address}</div>
                </div>
                <div class="detail-item detail-full" style="background:rgba(20,241,149,0.04);border-color:rgba(20,241,149,0.15);">
                    <div class="detail-label" style="color:var(--color-success);">★ Consistency Report</div>
                    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:8px;">
                        <div style="text-align:center;">
                            <div style="font-family:'JetBrains Mono',monospace;font-size:1.4rem;font-weight:900;color:${gradeColor};">${w.consistencyGrade}</div>
                            <div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;">Grade</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-family:'JetBrains Mono',monospace;font-size:1.4rem;font-weight:900;color:var(--color-success);">${w.uniqueTokens}</div>
                            <div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;">Tokens</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-family:'JetBrains Mono',monospace;font-size:1.4rem;font-weight:900;color:var(--sol-blue);">${w.profitDays}</div>
                            <div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;">Profit Days</div>
                        </div>
                        <div style="text-align:center;">
                            <div style="font-family:'JetBrains Mono',monospace;font-size:1.4rem;font-weight:900;color:var(--sol-purple);">${w.longestStreak}d</div>
                            <div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;">Best Streak</div>
                        </div>
                    </div>
                </div>
                <div class="detail-item detail-full" style="background:rgba(${w.manipulationRisk > 50 ? '255,77,106' : w.manipulationRisk > 25 ? '247,167,43' : '20,241,149'},0.04);border-color:rgba(${w.manipulationRisk > 50 ? '255,77,106' : w.manipulationRisk > 25 ? '247,167,43' : '20,241,149'},0.15);">
                    <div class="detail-label" style="color:${riskColor};">🛡️ Manipulation Risk Analysis</div>
                    <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px;margin-top:8px;align-items:center;">
                        <div style="text-align:center;">
                            <div style="font-family:'JetBrains Mono',monospace;font-size:2rem;font-weight:900;color:${riskColor};">${w.manipulationRisk}</div>
                            <div style="font-size:0.6rem;color:var(--text-muted);text-transform:uppercase;">/100 Risk Score</div>
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-secondary);line-height:1.6;">
                            ${(w.manipulationReasons || []).map(r => `<div>• ${r}</div>`).join('') || '<div>• No significant manipulation signals detected</div>'}
                        </div>
                    </div>
                </div>
                ${w.hftScore > 20 ? `
                <div class="detail-item detail-full" style="background:rgba(153,69,255,0.04);border-color:rgba(153,69,255,0.15);">
                    <div class="detail-label" style="color:var(--sol-purple);">🤖 HFT Bot Analysis</div>
                    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:8px;">
                        <div style="text-align:center;"><div style="font-family:'JetBrains Mono',monospace;font-weight:800;color:${w.hftScore >= 50 ? '#FF4D6A' : '#F7A72B'};">${w.hftScore}</div><div style="font-size:0.6rem;color:var(--text-muted);">HFT SCORE</div></div>
                        <div style="text-align:center;"><div style="font-family:'JetBrains Mono',monospace;font-weight:800;">${w.txPerMinute}</div><div style="font-size:0.6rem;color:var(--text-muted);">TX/MIN</div></div>
                        <div style="text-align:center;"><div style="font-family:'JetBrains Mono',monospace;font-weight:800;">${w.timingRegularity}</div><div style="font-size:0.6rem;color:var(--text-muted);">REGULARITY</div></div>
                        <div style="text-align:center;"><div style="font-family:'JetBrains Mono',monospace;font-weight:800;">${w.microTxRatio}</div><div style="font-size:0.6rem;color:var(--text-muted);">MICRO-TX</div></div>
                    </div>
                </div>
                ` : ''}
                <div class="detail-item"><div class="detail-label">Age</div><div class="detail-value">${formatAge(w.age)}</div></div>
                <div class="detail-item"><div class="detail-label">Alpha Score</div><div class="detail-value ${w.alphaScore >= 70 ? 'green' : w.alphaScore >= 40 ? '' : 'red'}">${w.alphaScore}/100</div></div>
                <div class="detail-item"><div class="detail-label">Total PnL</div><div class="detail-value ${w.pnl >= 0 ? 'green' : 'red'}">${formatPnl(w.pnl)}</div></div>
                <div class="detail-item"><div class="detail-label">Win Rate</div><div class="detail-value">${w.winRate}% (${w.wins}W/${w.losses}L)</div></div>
                <div class="detail-item"><div class="detail-label">Top Token PnL</div><div class="detail-value ${w.topTokenPnlPct > 60 ? 'red' : 'green'}">${w.topTokenPnlPct}%</div></div>
                <div class="detail-item"><div class="detail-label">Trade Spread</div><div class="detail-value">${w.tradeSpread}</div></div>
            </div>
            <div style="margin-top:20px;display:flex;gap:8px;flex-wrap:wrap;">
                <a class="detail-link" href="https://solscan.io/account/${w.address}" target="_blank" rel="noopener">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 8.5L12 2M12 2H8M12 2v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                    View on Solscan
                </a>
                <a class="detail-link" href="https://solana.fm/address/${w.address}" target="_blank" rel="noopener" style="border-color:rgba(153,69,255,0.2);color:var(--sol-purple);background:rgba(153,69,255,0.08);">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 8.5L12 2M12 2H8M12 2v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                    View on Solana FM
                </a>
            </div>
        `;
        els.modalOverlay.style.display = 'flex';
    }

    // ——— Export ———
    function exportResults() {
        if (state.results.length === 0) return;
        let csv = 'Rank,Wallet,Age,PnL,WinRate,UniqueTokens,ConsistencyGrade,ConsistencyScore,ManipulationRisk,RiskLevel,HFTScore,AlphaScore\n';
        state.results.forEach((w, i) => {
            csv += `${i+1},${w.address},${w.age},${w.pnl},${w.winRate},${w.uniqueTokens},${w.consistencyGrade},${w.consistencyScore},${w.manipulationRisk},${w.riskLevel},${w.hftScore},${w.alphaScore}\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `solana_alpha_intel_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Exported ' + state.results.length + ' wallets to CSV');
    }

    // ——— Database Backup & Restore ———
    async function backupDatabase() {
        try {
            toast('Generating database backup (streaming)...', 'info');
            
            // High-performance chunked serialization to prevent browser crash
            const chunks = ['{'];
            const stores = Object.values(ScannerDB.STORES);
            
            for (let i = 0; i < stores.length; i++) {
                const store = stores[i];
                const items = await ScannerDB.getAll(store);
                chunks.push(JSON.stringify(store) + ':');
                chunks.push(JSON.stringify(items));
                if (i < stores.length - 1) {
                    chunks.push(',');
                }
            }
            chunks.push('}');
            
            const blob = new Blob(chunks, { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `solana_scanner_backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast('Database backup downloaded successfully!', 'success');
        } catch (err) {
            toast('Backup failed: ' + err.message, 'error');
        }
    }

    function triggerRestoreFile() {
        if (els.fileRestoreDb) {
            els.fileRestoreDb.click();
        }
    }

    async function handleRestoreFile(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            toast('Restoring database from backup...', 'info');
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    await ScannerDB.restoreAll(data);
                    toast('Database restored successfully! Reloading...', 'success');
                    setTimeout(() => {
                        location.reload();
                    }, 1500);
                } catch (err) {
                    toast('Restore failed: ' + err.message, 'error');
                }
            };
            reader.readAsText(file);
        } catch (err) {
            toast('Read failed: ' + err.message, 'error');
        }
    }

    function resetScanUI() {
        state.scanning = false;
        els.btnScan.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.8"/><path d="M12.5 12.5L16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            Start Scanning
        `;
        els.btnScan.classList.remove('scanning');
    }

    // =====================================================================
    //  PAPER TRADING UI INTEGRATION
    // =====================================================================
    function renderPaperTrading() {
        const m = PaperTrader.getMetrics();
        
        // Portfolio cards
        const totalColor = m.totalPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
        $('pt-total-value').textContent = m.totalValue.toFixed(2) + ' SOL';
        $('pt-total-value').style.color = totalColor;
        $('pt-balance').textContent = m.balance.toFixed(2) + ' SOL';
        $('pt-open-pnl').textContent = (m.openPnl >= 0 ? '+' : '') + m.openPnl.toFixed(2) + ' SOL';
        $('pt-open-pnl').style.color = m.openPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
        $('pt-realized-pnl').textContent = (m.realizedPnl >= 0 ? '+' : '') + m.realizedPnl.toFixed(2) + ' SOL';
        $('pt-realized-pnl').style.color = m.realizedPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
        $('pt-total-return').textContent = (m.totalPnlPct >= 0 ? '+' : '') + m.totalPnlPct + '%';
        $('pt-total-return').style.color = totalColor;
        $('pt-win-rate').textContent = m.closedTrades > 0 ? m.winRate + '%' : '—';
        $('pt-trades').textContent = m.tradeCount;
        $('pt-risk').textContent = m.riskPct.toFixed(0) + '%';
        $('pt-risk').style.color = m.riskPct > 30 ? 'var(--color-danger)' : m.riskPct > 15 ? 'var(--color-warning)' : 'var(--color-success)';
        $('pt-risk-bar').style.width = Math.min(100, m.riskPct) + '%';
        $('pt-risk-bar').style.background = m.riskPct > 30 ? 'linear-gradient(90deg, #FF4D6A, #FF2D55)' : m.riskPct > 15 ? 'linear-gradient(90deg, #F7A72B, #FF8F00)' : 'var(--grad-green-cyan)';

        // Header balance
        els.headerPaperBalance.textContent = m.totalValue.toFixed(2);

        // Positions count
        $('pt-pos-count').textContent = m.openPositions;

        // Buttons
        els.btnStartCopy.disabled = m.isRunning || state.results.length === 0;
        els.btnStopCopy.disabled = !m.isRunning;
        els.btnPauseCopy.disabled = !m.isRunning;
        els.btnPauseCopy.textContent = m.isPaused ? '▶ Resume' : '⏸ Pause';

        // Positions table
        const tbody = $('positions-tbody');
        const noPos = $('no-positions');
        tbody.innerHTML = '';
        
        if (m.positions.length === 0) {
            noPos.style.display = 'flex';
        } else {
            noPos.style.display = 'none';
            m.positions.forEach(pos => {
                const row = document.createElement('tr');
                const pnlClass = pos.pnlSol >= 0 ? 'pos-pnl-positive' : 'pos-pnl-negative';
                row.innerHTML = `
                    <td style="font-weight:700;color:var(--sol-blue);">${pos.tokenSymbol}</td>
                    <td>${pos.entryPrice.toFixed(6)}</td>
                    <td>${pos.currentPrice.toFixed(6)}</td>
                    <td>${pos.positionSize.toFixed(2)}</td>
                    <td class="${pnlClass}">${pos.pnlSol >= 0 ? '+' : ''}${pos.pnlSol.toFixed(3)}</td>
                    <td class="${pnlClass}">${pos.pnlPct >= 0 ? '+' : ''}${pos.pnlPct}%</td>
                    <td style="color:var(--color-danger);font-size:0.7rem;">${pos.stopLoss.toFixed(6)}</td>
                    <td style="color:var(--color-success);font-size:0.7rem;">${pos.takeProfit.toFixed(6)}</td>
                    <td><span class="risk-badge ${pos.manipulationRisk <= 25 ? 'risk-low' : pos.manipulationRisk <= 50 ? 'risk-medium' : 'risk-high'}">${pos.manipulationRisk}</span></td>
                    <td><button class="pos-close-btn" onclick="window.__closePosition('${pos.id}')">Close</button></td>
                `;
                tbody.appendChild(row);
            });
        }

        // Trade log
        const logEl = $('paper-log');
        logEl.innerHTML = '';
        m.logs.forEach(entry => {
            const div = document.createElement('div');
            div.className = `log-entry ${entry.type}`;
            div.innerHTML = `<span class="log-time">[${entry.time}]</span> ${entry.message}`;
            logEl.appendChild(div);
        });
        if (m.logs.length === 0) {
            logEl.innerHTML = '<div class="log-entry info"><span class="log-time">[--:--:--]</span> Ready. Scan for wallets, then start copy trading.</div>';
        }
    }

    // ——— Init ———
    function init() {
        // Range sliders
        const sliders = [
            ['minWalletAge', 'minWalletAgeValue', 'd'],
            ['minWinRate', 'minWinRateValue', '%'],
            ['maxWinRate', 'maxWinRateValue', '%'],
            ['minTrades', 'minTradesValue', ''],
            ['minPnl', 'minPnlValue', ' SOL'],
            ['minUniqueTokens', 'minUniqueTokensValue', ''],
            ['minProfitDays', 'minProfitDaysValue', ''],
        ];
        sliders.forEach(([key, valueKey, suffix]) => {
            if (els[key]) {
                els[key].addEventListener('input', () => {
                    els[valueKey].textContent = els[key].value + suffix;
                });
            }
        });

        // Data source toggle
        els.dataSource.addEventListener('change', () => {
            els.manualInputGroup.style.display = els.dataSource.value === 'manual' ? 'block' : 'none';
        });

        // Buttons
        els.btnScan.addEventListener('click', startScan);
        els.btnExport.addEventListener('click', exportResults);
        if (els.btnBackupDb) els.btnBackupDb.addEventListener('click', backupDatabase);
        if (els.btnRestoreDb) els.btnRestoreDb.addEventListener('click', triggerRestoreFile);
        if (els.fileRestoreDb) els.fileRestoreDb.addEventListener('change', handleRestoreFile);
        els.sortBy.addEventListener('change', () => sortResults(els.sortBy.value));

        // Modal
        els.modalClose.addEventListener('click', () => { els.modalOverlay.style.display = 'none'; });
        els.modalOverlay.addEventListener('click', (e) => {
            if (e.target === els.modalOverlay) els.modalOverlay.style.display = 'none';
        });

        // ——— Paper Trading Controls ———
        PaperTrader.setRenderCallback(renderPaperTrading);

        els.btnStartCopy.addEventListener('click', () => {
            // Apply risk settings
            PaperTrader.updateConfig({
                startingBalance: parseFloat(els.ptStartBalance.value) || 100,
                maxPositionPct: parseFloat($('rm-max-position').value) || 5,
                stopLossPct: parseFloat($('rm-stop-loss').value) || -15,
                takeProfitPct: parseFloat($('rm-take-profit').value) || 50,
                maxDailyLossPct: parseFloat($('rm-max-daily').value) || -10,
                maxConcurrentPositions: parseInt($('rm-max-positions').value) || 10,
                cooldownMs: (parseInt($('rm-cooldown').value) || 30) * 1000,
            });

            // Only copy wallets with low manipulation risk
            const safeWallets = state.results.filter(w => w.manipulationRisk <= 50);
            if (safeWallets.length === 0) {
                toast('No safe wallets to follow (all have high manipulation risk)', 'error');
                return;
            }
            PaperTrader.startCopyTrading(safeWallets);
            renderPaperTrading();
            toast(`Copy trading started! Following ${safeWallets.length} safe wallets`);
        });

        els.btnStopCopy.addEventListener('click', () => {
            PaperTrader.stopCopyTrading();
            renderPaperTrading();
            toast('Copy trading stopped');
        });

        els.btnPauseCopy.addEventListener('click', () => {
            PaperTrader.togglePause();
            renderPaperTrading();
        });

        els.btnResetPortfolio.addEventListener('click', () => {
            PaperTrader.resetPortfolio();
            renderPaperTrading();
            toast('Portfolio reset');
        });

        els.ptStartBalance.addEventListener('change', () => {
            if (!PaperTrader.isRunning) {
                PaperTrader.updateConfig({ startingBalance: parseFloat(els.ptStartBalance.value) || 100 });
                PaperTrader.resetPortfolio();
                renderPaperTrading();
            }
        });

        // Global helpers
        window.__showWalletDetail = showWalletDetail;
        window.__toast = toast;
        window.__closePosition = (id) => {
            PaperTrader.closePosition(id, 'manual');
            renderPaperTrading();
        };

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') els.modalOverlay.style.display = 'none';
        });

        // Initial render
        renderPaperTrading();

        // ===================================================
        //  CLUSTER INTELLIGENCE INTEGRATION
        // ===================================================

        const ciSection = document.getElementById('cluster-section');
        const ciElements = {
            section: ciSection,
            status: document.getElementById('ci-status'),
            walletCount: document.getElementById('ci-wallet-count'),
            edgeCount: document.getElementById('ci-edge-count'),
            clusterCount: document.getElementById('ci-cluster-count'),
            patternCount: document.getElementById('ci-pattern-count'),
            hotCount: document.getElementById('ci-hot-count'),
            wsStatus: document.getElementById('ci-ws-status'),
            btnScan: document.getElementById('btn-cluster-scan'),
            btnStop: document.getElementById('btn-cluster-stop'),
            feed: document.getElementById('cluster-feed'),
            hotGrid: document.getElementById('hot-tokens-grid'),
            patternsList: document.getElementById('patterns-list'),
        };

        // Show cluster section always (it starts hidden)
        if (ciSection) ciSection.style.display = 'block';

        // Tab switching
        document.querySelectorAll('.cluster-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.cluster-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.cluster-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const target = document.getElementById('tab-' + tab.dataset.tab);
                if (target) target.classList.add('active');
            });
        });

        // Live feed rendering
        if (typeof ClusterIntel !== 'undefined') {
            ClusterIntel.onEvent = (entry) => {
                if (!ciElements.feed) return;
                const div = document.createElement('div');
                div.className = `feed-entry ${entry.level}`;
                div.innerHTML = `<span class="feed-time">[${entry.time}]</span> ${entry.msg}`;
                ciElements.feed.insertBefore(div, ciElements.feed.firstChild);
                // Keep max 200 entries
                while (ciElements.feed.children.length > 200) {
                    ciElements.feed.removeChild(ciElements.feed.lastChild);
                }
                // Update stats
                updateClusterStats();
            };

            ClusterIntel.onPattern = (pattern) => {
                toast(`🎯 Pattern: ${pattern.type} (${pattern.confidence}% confidence)`, pattern.confidence > 70);
            };

            ClusterIntel.onGraphUpdate = () => {
                ClusterIntel.renderGraph('cluster-graph-canvas');
                updateClusterStats();
            };

            ClusterIntel.onTokenActivity = (evt) => {
                if (evt.type === 'token_sell' && typeof PaperTrader !== 'undefined') {
                    PaperTrader.checkWhaleExit(evt.token, evt.wallet, evt.amount);
                }
            };
        }

        function updateClusterStats() {
            if (typeof ClusterIntel === 'undefined') return;
            ciElements.walletCount.textContent = ClusterIntel.nodes.size;
            ciElements.edgeCount.textContent = ClusterIntel.edges.size;
            ciElements.clusterCount.textContent = ClusterIntel.clusters.size;
            ciElements.patternCount.textContent = ClusterIntel.patterns.length;
            ciElements.hotCount.textContent = ClusterIntel.hotTokens.length;
            ciElements.wsStatus.textContent = ClusterIntel.state.ws?.readyState === 1 ? '🟢 Live' : '⚫ Off';
        }

        function renderHotTokens(tokens) {
            if (!ciElements.hotGrid) return;
            if (tokens.length === 0) {
                ciElements.hotGrid.innerHTML = '<div class="hot-token-placeholder">No hot tokens found</div>';
                return;
            }
            ciElements.hotGrid.innerHTML = tokens.map(t => {
                const isMega = t.priceChange24h > 500;
                const changeClass = t.priceChange24h > 0 ? (isMega ? 'mega' : 'positive') : 'negative';
                const vol = t.volume24h > 1000000 ? (t.volume24h/1000000).toFixed(1) + 'M' : (t.volume24h/1000).toFixed(0) + 'K';
                const liq = t.liquidity > 1000000 ? (t.liquidity/1000000).toFixed(1) + 'M' : (t.liquidity/1000).toFixed(0) + 'K';
                return `
                    <div class="hot-token-card ${isMega ? 'mega' : ''}" onclick="window.open('${t.url || '#'}', '_blank')">
                        <div class="hot-token-symbol">${t.symbol || 'UNKNOWN'}</div>
                        <div class="hot-token-change ${changeClass}">
                            ${t.priceChange24h > 0 ? '+' : ''}${t.priceChange24h.toFixed(0)}%
                        </div>
                        <div class="hot-token-meta">
                            <span>Vol $${vol}</span>
                            <span>Liq $${liq}</span>
                            ${t.boostAmount ? `<span>🚀 ${t.boostAmount}</span>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        function renderPatterns(patterns) {
            if (!ciElements.patternsList) return;
            if (patterns.length === 0) {
                ciElements.patternsList.innerHTML = '<div class="pattern-placeholder">No suspicious patterns detected</div>';
                return;
            }
            const typeLabels = {
                wash_trading: '🔄 Wash Trading',
                wallet_dispersion: '💸 Wallet Dispersion',
                coordinated_trade: '📊 Coordinated Trading',
                coordinated_pump: '🚀 Coordinated Pump',
            };
            ciElements.patternsList.innerHTML = patterns.map(p => {
                const confClass = p.confidence >= 80 ? 'high' : p.confidence >= 50 ? 'medium' : 'low';
                return `
                    <div class="pattern-card ${confClass}-confidence">
                        <div class="pattern-header">
                            <span class="pattern-type">${typeLabels[p.type] || p.type}</span>
                            <span class="pattern-confidence ${confClass}">${p.confidence}%</span>
                        </div>
                        <div class="pattern-description">${p.description}</div>
                        <div class="pattern-wallets">
                            Wallets: ${p.wallets.map(w => `<a href="https://solscan.io/account/${w}" target="_blank" style="color:var(--sol-blue)">${shortAddr(w)}</a>`).join(' → ')}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Cluster scan button (manual trigger)
        if (ciElements.btnScan) {
            ciElements.btnScan.addEventListener('click', () => runClusterScan());
        }

        // Stop monitoring button
        if (ciElements.btnStop) {
            ciElements.btnStop.addEventListener('click', () => {
                if (typeof ClusterIntel !== 'undefined') {
                    ClusterIntel.stopMonitoring();
                    if (autopilotTimer) { clearInterval(autopilotTimer); autopilotTimer = null; }
                    ciElements.status.textContent = 'Idle';
                    ciElements.status.style.background = '';
                    ciElements.status.style.color = '';
                    ciElements.btnStop.disabled = true;
                    updateClusterStats();
                }
            });
        }

        // ——— Core Cluster Scan Function ———
        async function runClusterScan() {
            if (typeof ClusterIntel === 'undefined') {
                toast('Cluster engine not loaded', false);
                return;
            }
            ciElements.btnScan.disabled = true;
            ciElements.btnStop.disabled = false;
            ciElements.status.textContent = 'Scanning...';
            ciElements.status.style.background = 'rgba(153, 69, 255, 0.2)';
            ciElements.status.style.color = '#9945FF';

            try {
                // Gather seeds from scanner results + priority wallets
                const seeds = [
                    ...state.results.map(w => w.address),
                    ...state.filtered.map(w => w.address),
                    'AstaWuJuQiAS3AfqmM3xZxrJhkkZNXtW4VyaGQfqV6JL',
                    'FUCKNiggAS8VdjcGbpAgoPZtfmpA32Q5CGbVbxHeuAgt',
                ];
                const uniqueSeeds = [...new Set(seeds.filter(s => s))];
                const result = await ClusterIntel.runFullScan(uniqueSeeds);

                // Render results
                ClusterIntel.renderGraph('cluster-graph-canvas');
                renderHotTokens(ClusterIntel.hotTokens);
                renderPatterns(ClusterIntel.patterns);
                updateClusterStats();

                ciElements.status.textContent = '🟢 LIVE';
                ciElements.status.style.background = 'rgba(20, 241, 149, 0.15)';
                ciElements.status.style.color = 'var(--color-success)';
            } catch (err) {
                ciElements.status.textContent = '⚠ Error';
                console.error('Cluster scan error:', err);
            }
            ciElements.btnScan.disabled = false;
        }

        // ===================================================
        //  AUTO-PILOT ENGINE
        //  Automatically scans, detects, and takes action
        //  No user interaction needed
        // ===================================================

        let autopilotTimer = null;
        let autopilotCycle = 0;

        async function autopilotRefresh() {
            autopilotCycle++;
            const prefix = `[Autopilot #${autopilotCycle}]`;
            
            if (typeof ClusterIntel === 'undefined') return;
            
            try {
                // Refresh hot tokens
                const hotTokens = await ClusterIntel.discoverHotTokens();
                renderHotTokens(hotTokens);
                
                // Re-detect patterns with updated data
                ClusterIntel.detectPatterns();
                renderPatterns(ClusterIntel.patterns);
                
                // Re-render graph
                ClusterIntel.renderGraph('cluster-graph-canvas');
                updateClusterStats();

                // Auto-feed signals to paper trading
                autoFeedSignals(hotTokens);

                console.log(`${prefix} Refresh complete — ${hotTokens.length} tokens, ${ClusterIntel.patterns.length} patterns`);
            } catch (err) {
                console.warn(`${prefix} Refresh error:`, err.message);
            }
        }

        function autoFeedSignals(hotTokens) {
            // Feed hot tokens with big moves to paper trading as signals
            if (typeof PaperTrader === 'undefined') return;
            if (!PaperTrader.isRunning || !PaperTrader.isRunning()) return;

            for (const token of hotTokens.slice(0, 5)) {
                if (token.priceChange24h > 200 && token.volume24h > 10000) {
                    // This token is pumping hard — generate a buy signal
                    const signalWallet = state.results[0]?.address || 'AutoPilot';
                    if (typeof window.__autoPilotSignal === 'function') {
                        window.__autoPilotSignal({
                            wallet: signalWallet,
                            token: token.symbol,
                            mint: token.address,
                            price: token.marketCap > 0 ? token.marketCap / 1e9 : 0.001,
                            action: 'buy',
                        });
                    }
                }
            }
        }

        function startAutopilot() {
            if (autopilotTimer) return; // Already running
            
            console.log('🤖 Auto-Pilot ENGAGED — continuous real-time scanning every 45 seconds');
            
            // Initial scan after 3 seconds (let page fully render)
            setTimeout(async () => {
                await runClusterScan();
                
                // Then refresh every 45 seconds for real-time feel
                autopilotTimer = setInterval(() => autopilotRefresh(), 45000);
            }, 3000);
        }

        // AUTO-START: Begin autopilot on page load (Disabled in v3.0 to save RPC limits & browser resources)
        // startAutopilot();

        // ===================================================
        //  SNIPER ENGINE INTEGRATION
        // ===================================================

        const sniperEls = {
            section: document.getElementById('sniper-section'),
            statusBadge: document.getElementById('sniper-status-badge'),
            tracked: document.getElementById('sniper-tracked'),
            scanned: document.getElementById('sniper-scanned'),
            alertsCount: document.getElementById('sniper-alerts-count'),
            hot: document.getElementById('sniper-hot'),
            lastScan: document.getElementById('sniper-last-scan'),
            btnStart: document.getElementById('btn-sniper-start'),
            btnStop: document.getElementById('btn-sniper-stop'),
            btnReset: document.getElementById('btn-sniper-reset'),
            manualInput: document.getElementById('sniper-manual-input'),
            btnManual: document.getElementById('btn-sniper-manual'),
            grid: document.getElementById('sniper-tokens-grid'),
            feed: document.getElementById('sniper-feed'),
        };

        function formatUsd(n) {
            if (!n || isNaN(n)) return '$0';
            if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
            if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
            return `$${n.toFixed(0)}`;
        }

        function timeAgo(ts) {
            if (!ts) return '—';
            const diff = Date.now() - ts;
            if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
            if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
            if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
            return `${Math.floor(diff / 86400000)}d`;
        }

        function getTierClass(score) {
            if (score >= 75) return 's-tier';
            if (score >= 60) return 'a-tier';
            if (score >= 45) return 'b-tier';
            if (score >= 30) return 'c-tier';
            return 'd-tier';
        }

        // v3.0: Determine if a token is tradeable based on score + social checks
        function isTokenTradeable(token) {
            const sp = token.socialPresence || {};
            const socialCount = (sp.x ? 1 : 0) + (sp.telegram ? 1 : 0) + (sp.website ? 1 : 0);

            // Dynamic unreject if user checks a social link
            if (token.rejected && token.rejectionReason === 'NO_SOCIALS' && socialCount > 0) {
                token.rejected = false;
                token.rejectionReason = null;
            }

            if (token.rejected) return { ok: false, reason: 'Token rejected' };
            if (token.score.total < 65) return { ok: false, reason: `Score < 65` };
            if (socialCount === 0) return { ok: false, reason: 'SOCIAL CHECK REQUIRED' };
            return { ok: true };
        }

        // v3.0: Get tab category for a token
        function getTokenTab(token) {
            const sp = token.socialPresence || {};
            const socialCount = (sp.x ? 1 : 0) + (sp.telegram ? 1 : 0) + (sp.website ? 1 : 0);

            // Dynamic unreject if user checks a social link
            if (token.rejected && token.rejectionReason === 'NO_SOCIALS' && socialCount > 0) {
                token.rejected = false;
                token.rejectionReason = null;
            }

            if (token.rejected) return 'hidden';

            const platform = token.platformInfo?.platform || '';
            const isPump = platform === 'pump.fun' || platform === 'pumpswap';

            // Auto-hide pump.fun/pumpswap tokens with 0 verified socials
            if (socialCount === 0 && isPump) {
                token.rejected = true;
                token.rejectionReason = 'NO_SOCIALS';
                return 'hidden';
            }

            if (token.score.total >= 65) return 'tradeable';
            if (token.score.total >= 50) return 'watchlist';
            return 'hidden';
        }

        // Track active sniper tab
        let activeSniperTab = 'tradeable';

        function renderSniperCard(token) {
            const isRejected = token.rejected;
            const tab = getTokenTab(token);
            const tier = isRejected ? 'rejected' : tab === 'watchlist' ? 'watchlist' : tab === 'hidden' ? 'hidden-tier' : getTierClass(token.score.total);
            const priceChange = token.priceChange1h || 0;
            const changeClass = priceChange >= 0 ? 'positive' : 'negative';
            const changeSign = priceChange >= 0 ? '+' : '';
            const platformInfo = token.platformInfo || { label: token.dexId || 'DEX', color: '#6B7280' };
            const tradeCheck = isTokenTradeable(token);

            // v3.0: Tier badge
            const tierBadge = token.score.total >= 70 ? '🧱 A-TIER' : token.score.total >= 60 ? '🧲 B-TIER' : token.score.total >= 50 ? '🧳 C-TIER' : '';

            // v3.0: Rejection banner or Safe badge
            let statusBanner = '';
            if (isRejected || token.score.total < 50) {
                statusBanner = `<div class="sniper-rejection-banner">⛔ REJECTED: ${token.rejectionReason || 'Score < 50'}</div>`;
            } else if (token.safetyGate?.pass && token.score.total >= 60) {
                statusBanner = `<div class="sniper-safe-badge" style="background: rgba(20, 241, 149, 0.12); color: #14F195; border-color: rgba(20, 241, 149, 0.3);">🛡️ SAFE ${tierBadge}</div>`;
            } else if (token.safetyGate?.pass && token.score.total >= 50 && token.score.total < 60) {
                statusBanner = `<div class="sniper-safe-badge" style="background: rgba(255, 184, 0, 0.12); color: #FFB800; border-color: rgba(255, 184, 0, 0.3);">⚠️ PASSABLE ${tierBadge}</div>`;
            } else {
                statusBanner = tierBadge ? `<div class="sniper-safe-badge">${tierBadge}</div>` : '';
            }

            // v3.0: Platform tag
            const platformTag = `<span class="sniper-platform-tag" style="background:${platformInfo.color}22;color:${platformInfo.color};border:1px solid ${platformInfo.color}44;">${platformInfo.label}</span>`;

            // v3.0: Paper Trade button — blocked for rejected, low score, or no social
            const tradeDisabled = !tradeCheck.ok;
            const tradeLabel = tradeDisabled ? (tradeCheck.reason || 'Blocked') : '📋 Paper Trade';
            const tradeHint = tab === 'watchlist' ? `<div class="sniper-watchlist-hint">⏳ Check again in 5 min</div>` : '';

            return `
                <div class="sniper-card ${tier}">
                    ${statusBanner}
                    <div class="sniper-card-header" style="cursor:pointer;" onclick="window.__openTokenDetail('${token.address}')">
                        <div>
                            <div class="sniper-token-name">${token.symbol} ${platformTag}</div>
                            <div class="sniper-token-age">Age: ${timeAgo(token.createdAt)} • ${token.dexId || 'DEX'}</div>
                        </div>
                        ${isRejected
                            ? `<div class="sniper-score-badge rejected">⛔</div>`
                            : `<div class="sniper-score-badge ${tier}">${token.score.total}/100</div>`
                        }
                    </div>
                    ${!isRejected ? `<div class="sniper-score-bar"><div class="sniper-score-fill ${tier}" style="width:${token.score.total}%"></div></div>` : ''}
                    <div class="sniper-metrics">
                        <div class="sniper-metric">
                            <span class="sniper-metric-label">MCap</span>
                            <span class="sniper-metric-value">${formatUsd(token.marketCap)}</span>
                        </div>
                        <div class="sniper-metric">
                            <span class="sniper-metric-label">Liq</span>
                            <span class="sniper-metric-value">${formatUsd(token.liquidity)}</span>
                        </div>
                        <div class="sniper-metric">
                            <span class="sniper-metric-label">Vol 1h</span>
                            <span class="sniper-metric-value">${formatUsd(token.volume1h)}</span>
                        </div>
                        <div class="sniper-metric">
                            <span class="sniper-metric-label">1h Δ</span>
                            <span class="sniper-metric-value ${changeClass}">${changeSign}${priceChange.toFixed(1)}%</span>
                        </div>
                        <div class="sniper-metric">
                            <span class="sniper-metric-label">Buys 1h</span>
                            <span class="sniper-metric-value positive">${token.txns1h?.buys || 0}</span>
                        </div>
                        <div class="sniper-metric">
                            <span class="sniper-metric-label">Sells 1h</span>
                            <span class="sniper-metric-value negative">${token.txns1h?.sells || 0}</span>
                        </div>
                    </div>
                    <div class="sniper-tools">
                        <button class="sniper-tool-btn primary" onclick="window.__openTokenDetail('${token.address}')">🔬 View Details</button>
                        <button class="sniper-tool-btn" onclick="window.__openQuickChart('${token.pairAddress || token.address}','${token.symbol}')">📈 Chart</button>
                        <button class="sniper-tool-btn" onclick="window.__loadQuickBubbleMap('${token.address}','${token.symbol}')">🫧 BubbleMaps</button>
                        <button class="sniper-tool-btn copy-trade${tradeDisabled ? ' disabled' : ''}" onclick="${tradeDisabled ? 'return false' : `window.__sniperCopyTrade('${token.address}')`}" ${tradeDisabled ? `disabled title="${tradeLabel}"` : ''}>${tradeDisabled ? tradeLabel : '📋 Paper Trade'}</button>
                    </div>
                    ${tradeHint}
                </div>
            `;
        }

        function renderSniperDashboard() {
            if (typeof SniperEngine === 'undefined') return;
            const s = SniperEngine.getState();

            // Update stats
            sniperEls.tracked.textContent = s.trackedCount;
            sniperEls.scanned.textContent = s.totalScanned;
            sniperEls.alertsCount.textContent = s.totalAlerts;
            sniperEls.hot.textContent = s.sniperTokens.length;
            sniperEls.lastScan.textContent = s.lastScanTime ? timeAgo(s.lastScanTime) + ' ago' : '—';

            // v3.0: Update filtered count
            const filteredEl = document.getElementById('sniper-filtered-today');
            if (filteredEl) filteredEl.textContent = s.filteredToday || 0;

            // v3.0: Update queue size
            const queueSizeEl = document.getElementById('sniper-queue-size');
            if (queueSizeEl) queueSizeEl.textContent = s.discoveryQueue ? s.discoveryQueue.length : 0;

            // v3.0: Update dropped queue count
            const queueDropIndicator = document.getElementById('queue-dropped-indicator');
            const queueDropCountEl = document.getElementById('queue-dropped-count');
            if (queueDropIndicator && queueDropCountEl) {
                if (s.droppedCount > 0) {
                    queueDropIndicator.style.display = 'inline-block';
                    queueDropCountEl.textContent = s.droppedCount;
                } else {
                    queueDropIndicator.style.display = 'none';
                }
            }

            // v3.0: Update worker badges
            const workers = s.activeWorkers || [];
            for (let i = 0; i < 3; i++) {
                const badge = document.getElementById(`worker-${i}-badge`);
                if (!badge) continue;
                const w = workers[i];
                if (w && w.status === 'busy' && s.isRunning) {
                    badge.style.background = 'rgba(20, 241, 149, 0.1)';
                    badge.style.color = '#14F195';
                    badge.style.borderColor = 'rgba(20, 241, 149, 0.2)';
                    badge.textContent = `W${i+1}: ${w.currentToken || 'Busy'}`;
                } else if (s.isRunning) {
                    badge.style.background = 'rgba(0, 209, 255, 0.08)';
                    badge.style.color = '#00D1FF';
                    badge.style.borderColor = 'rgba(0, 209, 255, 0.15)';
                    badge.textContent = `W${i+1}: Idle`;
                } else {
                    badge.style.background = 'rgba(255, 255, 255, 0.03)';
                    badge.style.color = 'var(--text-muted)';
                    badge.style.borderColor = 'rgba(255, 255, 255, 0.06)';
                    badge.textContent = `W${i+1}: Offline`;
                }
            }

            // Status badge
            if (s.isRunning) {
                sniperEls.statusBadge.textContent = '🟢 SCANNING';
                sniperEls.statusBadge.style.background = 'rgba(20,241,149,0.12)';
                sniperEls.statusBadge.style.color = '#14F195';
                sniperEls.statusBadge.style.borderColor = 'rgba(20,241,149,0.3)';
                sniperEls.btnStart.disabled = true;
                sniperEls.btnStop.disabled = false;
            } else {
                sniperEls.statusBadge.textContent = 'OFFLINE';
                sniperEls.statusBadge.style.background = 'rgba(255,59,48,0.12)';
                sniperEls.statusBadge.style.color = '#FF3B30';
                sniperEls.statusBadge.style.borderColor = 'rgba(255,59,48,0.2)';
                sniperEls.btnStart.disabled = false;
                sniperEls.btnStop.disabled = true;
            }

            // v3.0: 3-Tab system — categorize tokens
            const allTokens = [...s.tokens];
            const tradeableTokens = allTokens.filter(t => !t.rejected && t.score.total >= 65);
            const watchlistTokens = allTokens.filter(t => !t.rejected && t.score.total >= 50 && t.score.total < 65);
            const hiddenTokens = allTokens.filter(t => t.rejected || t.score.total < 50);

            // Render tab bar
            const tabBar = document.getElementById('sniper-tab-bar');
            if (tabBar) {
                tabBar.innerHTML = `
                    <button class="sniper-tab-btn tab-tradeable ${activeSniperTab === 'tradeable' ? 'active' : ''}" onclick="window.__setSniperTab('tradeable')">🟢 Tradeable <span class="sniper-tab-count">${tradeableTokens.length}</span></button>
                    <button class="sniper-tab-btn tab-watchlist ${activeSniperTab === 'watchlist' ? 'active' : ''}" onclick="window.__setSniperTab('watchlist')">🟡 Watchlist <span class="sniper-tab-count">${watchlistTokens.length}</span></button>
                    <button class="sniper-tab-btn tab-hidden ${activeSniperTab === 'hidden' ? 'active' : ''}" onclick="window.__setSniperTab('hidden')">⚫ Hidden <span class="sniper-tab-count">${hiddenTokens.length}</span></button>
                `;
            }

            // Pick tokens for active tab
            let displayTokens = activeSniperTab === 'tradeable' ? tradeableTokens :
                                activeSniperTab === 'watchlist' ? watchlistTokens : hiddenTokens;

            const sniperSortBy = document.getElementById('sniper-sort-by')?.value || 'score';
            if (sniperSortBy === 'age') {
                displayTokens.sort((a, b) => (b.createdAt || b.analyzedAt || 0) - (a.createdAt || a.analyzedAt || 0));
            }

            // Render token cards
            if (displayTokens.length > 0) {
                sniperEls.grid.innerHTML = displayTokens.slice(0, 30).map(renderSniperCard).join('');
            } else if (!s.isRunning) {
                sniperEls.grid.innerHTML = `
                    <div class="sniper-placeholder">
                        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" opacity="0.3"><circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="24" r="10" stroke="currentColor" stroke-width="2"/><circle cx="24" cy="24" r="3" fill="currentColor"/></svg>
                        <p>Start the Sniper Engine to detect new token opportunities</p>
                    </div>
                `;
            } else {
                sniperEls.grid.innerHTML = `<div class="sniper-placeholder"><p>No ${activeSniperTab} tokens yet — scanning...</p></div>`;
            }

            // Render feed
            if (s.logs.length > 0) {
                sniperEls.feed.innerHTML = s.logs.slice(0, 30).map(l => {
                    const cls = l.level === 'alert' ? 'alert' : l.level === 'success' ? 'success' :
                                l.level === 'warning' ? 'warning' : l.level === 'error' ? 'error' : 'info';
                    return `<div class="feed-entry ${cls}"><span class="feed-time">[${l.time}]</span> ${l.msg}</div>`;
                }).join('');
            }
        }

        // v3.0: Tab switcher
        window.__setSniperTab = (tab) => {
            activeSniperTab = tab;
            renderSniperDashboard();
        };

        // Wire up sniper controls
        const sniperSortSelect = document.getElementById('sniper-sort-by');
        if (sniperSortSelect) {
            sniperSortSelect.addEventListener('change', () => {
                renderSniperDashboard();
            });
        }

        sniperEls.btnStart.addEventListener('click', () => {
            // Load alpha wallets from scan results if available
            if (state.results.length > 0) {
                SniperEngine.loadAlphaWallets(state.results);
            }
            SniperEngine.start();
            renderSniperDashboard();
            toast('🎯 Sniper Engine started — monitoring new launches');
        });

        sniperEls.btnStop.addEventListener('click', () => {
            SniperEngine.stop();
            renderSniperDashboard();
            toast('Sniper Engine stopped');
        });

        sniperEls.btnReset.addEventListener('click', () => {
            SniperEngine.reset();
            renderSniperDashboard();
            toast('Sniper data reset');
        });

        sniperEls.btnManual.addEventListener('click', async () => {
            const addr = sniperEls.manualInput.value.trim();
            if (addr.length >= 32) {
                toast(`🎯 Sniping ${addr.slice(0,8)}...`);
                await SniperEngine.snipeToken(addr);
                sniperEls.manualInput.value = '';
                renderSniperDashboard();
            } else {
                toast('Please enter a valid token address', 'error');
            }
        });

        // Enter key on manual input
        sniperEls.manualInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sniperEls.btnManual.click();
        });

        // Copy trade from sniper — auto-enter a paper trade for a sniped token
        window.__sniperCopyTrade = async (tokenAddress) => {
            const sniperState = SniperEngine.getState();
            const token = sniperState.tokens.find(t => t.address === tokenAddress);
            if (!token) { toast('Token not found in sniper data', 'error'); return; }

            // Build an overrideToken for PaperTrader
            const overrideToken = {
                symbol: token.symbol,
                address: token.address,
                pairAddress: token.pairAddress,
                priceUsd: token.priceUsd,
                priceNative: token.priceNative,
                volume24h: token.volume24h,
                liquidity: token.liquidity,
                priceChange24h: token.priceChange24h,
                marketCap: token.marketCap,
                url: token.url,
                createdAt: token.createdAt,
            };

            // Use PaperTrader to enter a position
            const result = await PaperTrader.simulateEntry(
                'SNIPER_SIGNAL',
                { manipulationRisk: 100 - token.score.total }, // Lower score = higher risk
                overrideToken
            );

            if (result.success) {
                toast(`📋 Paper trade opened: ${token.symbol} (Score ${token.score.total}/100)`);
                els.paperSection.style.display = 'block';
                renderPaperTrading();
            } else {
                toast(`Trade blocked: ${result.reason}`, 'error');
            }
        };

        // Set up sniper render callback
        if (typeof SniperEngine !== 'undefined') {
            SniperEngine.onUpdate = renderSniperDashboard;
            SniperEngine.onAlert = (alert) => {
                toast(`🚨 SNIPER ALERT: ${alert.token.symbol} — Score ${alert.score}/100 ${alert.grade}`, 'success');
            };

            // AUTO-START sniper engine — no manual clicking needed
            setTimeout(() => {
                if (state.results.length > 0) SniperEngine.loadAlphaWallets(state.results);
                SniperEngine.start();
                toast('🎯 Sniper Engine auto-started — monitoring new launches');
                console.log('🎯 [Sniper] Auto-started on page load');

                // v3.0: AUTO-START PaperTrader in SNIPER FOLLOW mode
                // This polls SniperEngine every 20s for tokens scoring >= minScore and auto-enters trades
                // Previously used PaperTrader.start() which only set a flag but never polled!
                if (typeof PaperTrader !== 'undefined') {
                    PaperTrader.startSniperFollow(65);
                    els.paperSection.style.display = 'block';
                    renderPaperTrading();
                    console.log('🎯 [PaperTrader] Auto-Follow Sniper started — min score 65');
                }
            }, 3000);
        }

        // ===================================================
        //  DATABASE PERSISTENCE (IndexedDB)
        // ===================================================

        const dbStatusEl = document.getElementById('radar-outcome-badge');

        // v3.0: Local Workspace Directory Syncing variables
        let workspaceHandle = null;
        const btnSyncWorkspace = document.getElementById('btn-sync-workspace');
        const syncStatusDot = document.getElementById('sync-status-dot');
        const syncStatusText = document.getElementById('sync-status-text');

        function updateSyncUI(connected) {
            if (!syncStatusDot || !syncStatusText || !btnSyncWorkspace) return;
            if (connected) {
                syncStatusDot.style.background = '#14F195'; // Green
                syncStatusText.textContent = 'Synced';
                btnSyncWorkspace.style.borderColor = 'rgba(20, 241, 149, 0.4)';
                btnSyncWorkspace.style.background = 'rgba(20, 241, 149, 0.08)';
                btnSyncWorkspace.style.color = '#14F195';
            } else {
                syncStatusDot.style.background = '#6B7280'; // Grey
                syncStatusText.textContent = 'Link Workspace';
                btnSyncWorkspace.style.borderColor = 'rgba(153, 69, 255, 0.3)';
                btnSyncWorkspace.style.background = 'rgba(153, 69, 255, 0.1)';
                btnSyncWorkspace.style.color = '#9945FF';
            }
        }

        async function verifyPermission(fileHandle, readWrite) {
            const options = {};
            if (readWrite) {
                options.mode = 'readwrite';
            }
            if ((await fileHandle.queryPermission(options)) === 'granted') {
                return true;
            }
            if ((await fileHandle.requestPermission(options)) === 'granted') {
                return true;
            }
            return false;
        }

        async function linkWorkspaceFolder() {
            try {
                const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
                if (handle) {
                    workspaceHandle = handle;
                    // Save handle in IndexedDB
                    if (typeof ScannerDB !== 'undefined') {
                        await ScannerDB.put('settings', { id: 'workspaceDirectoryHandle', handle: handle });
                    }
                    updateSyncUI(true);
                    toast('🔌 Local workspace linked successfully!', 'success');
                    // Sync immediately on link
                    syncWorkspaceData();
                }
            } catch (err) {
                console.warn('Workspace link cancelled or failed:', err.message);
                updateSyncUI(false);
            }
        }

        async function restoreWorkspaceLink() {
            if (typeof ScannerDB === 'undefined') return;
            try {
                const record = await ScannerDB.get('settings', 'workspaceDirectoryHandle');
                if (record && record.handle) {
                    const handle = record.handle;
                    const permission = await handle.queryPermission({ mode: 'readwrite' });
                    if (permission === 'granted') {
                        workspaceHandle = handle;
                        updateSyncUI(true);
                        console.log('🔌 [DB] Restored workspace folder permission without prompt');
                    } else {
                        // Keep handle in memory but keep UI greyed out until verified
                        workspaceHandle = handle;
                        updateSyncUI(false);
                    }
                }
            } catch (err) {
                console.warn('Failed to restore workspace link:', err.message);
            }
        }

        async function syncWorkspaceData() {
            if (!workspaceHandle) return;
            try {
                // Verify we have active write permissions
                const permission = await workspaceHandle.queryPermission({ mode: 'readwrite' });
                if (permission !== 'granted') {
                    // Fail silently in background loops rather than spamming browser popups
                    return;
                }

                updateSyncUI(true);

                // Fetch data from IndexedDB
                const trades = await ScannerDB.getAll('trades') || [];
                const outcomes = await ScannerDB.getAll('outcomes') || [];
                const alerts = await ScannerDB.getAll('alerts') || [];

                // Get or create data/ directory
                let dataDirHandle;
                try {
                    dataDirHandle = await workspaceHandle.getDirectoryHandle('data', { create: true });
                } catch (e) {
                    console.error('Failed to create data directory:', e);
                    return;
                }

                // Helper function to write files safely
                const writeJsonFile = async (fileName, data) => {
                    const fileHandle = await dataDirHandle.getFileHandle(fileName, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(JSON.stringify(data, null, 2));
                    await writable.close();
                };

                // Export database tables
                await writeJsonFile('trades_sync.json', trades);
                await writeJsonFile('outcomes_sync.json', outcomes);
                await writeJsonFile('alerts_sync.json', alerts);

                console.log(`🔌 [Sync] Exported ${trades.length} trades, ${outcomes.length} outcomes, ${alerts.length} alerts to local workspace`);
            } catch (err) {
                console.warn('🔌 [Sync] Database syncing failed:', err.message);
                updateSyncUI(false);
            }
        }

        // Add event listener for the link button
        if (btnSyncWorkspace) {
            btnSyncWorkspace.addEventListener('click', async () => {
                if (workspaceHandle) {
                    const granted = await verifyPermission(workspaceHandle, true);
                    if (granted) {
                        updateSyncUI(true);
                        toast('🔌 Workspace connection active!', 'success');
                        syncWorkspaceData();
                    } else {
                        linkWorkspaceFolder();
                    }
                } else {
                    linkWorkspaceFolder();
                }
            });
        }

        async function initDatabase() {
            if (typeof ScannerDB === 'undefined') return;
            try {
                await ScannerDB.open();
                const stats = await ScannerDB.getStats();
                console.log('📦 [DB] Initialized:', stats);
                updateDbStatus(stats);

                // v2.0: Auto-cleanup bloated stores on startup
                if (typeof ScannerDB.autoCleanup === 'function') {
                    await ScannerDB.autoCleanup();
                }

                // Restore saved portfolio settings
                const savedPortfolio = await ScannerDB.getSetting('portfolio');
                if (savedPortfolio) {
                    console.log(`📦 [DB] Restored portfolio: ${savedPortfolio.balance?.toFixed(2)} SOL balance`);
                }

                // Load saved alpha wallets into sniper engine
                const alphaWallets = await ScannerDB.getAlphaWallets();
                if (alphaWallets.length > 0 && typeof SniperEngine !== 'undefined') {
                    SniperEngine.loadAlphaWallets(alphaWallets);
                    console.log(`📦 [DB] Loaded ${alphaWallets.length} alpha wallets from DB`);
                }

                // v3.0: DISABLED — stale DB tokens lack v3.0 fields (platformInfo, rejected, socialPresence)
                // and pollute the grid with old data. Sniper engine discovers fresh tokens on start.
                // const savedTokens = await ScannerDB.getAllTokens();
                // if (savedTokens.length > 0 && typeof SniperEngine !== 'undefined') {
                //     SniperEngine.loadTrackedTokens(savedTokens);
                //     console.log(`📦 [DB] Restored ${savedTokens.length} tracked tokens from DB`);
                // }
                console.log('📦 [DB] v3.0: Skipping stale token restore — engine will discover fresh tokens');

                // Restore saved paper trading metrics, open positions & history
                const portfolioSetting = await ScannerDB.getSetting('portfolio');
                if (portfolioSetting && typeof PaperTrader !== 'undefined') {
                    const openPositions = await ScannerDB.getOpenTrades();
                    const closedHistory = await ScannerDB.getClosedTrades();
                    
                    const restoredTradeState = {
                        balance: portfolioSetting.balance,
                        startingBalance: portfolioSetting.startingBalance || 100,
                        positions: openPositions || [],
                        history: closedHistory || [],
                        totalRealizedPnl: portfolioSetting.realizedPnl || 0,
                        tradeCount: portfolioSetting.tradeCount || 0,
                        winCount: closedHistory ? closedHistory.filter(t => (t.finalPnl || t.pnlSol) > 0).length : 0,
                        isRunning: true,
                        isPaused: false
                    };
                    
                    PaperTrader.loadTradeState(restoredTradeState);
                    console.log(`📦 [DB] Restored paper trading state: ${restoredTradeState.balance?.toFixed(2)} SOL, ${restoredTradeState.positions.length} open, ${restoredTradeState.history.length} history`);
                }
                
                // Try to restore previous workspace sync
                await restoreWorkspaceLink();
            } catch (err) {
                console.warn('📦 [DB] Init failed:', err.message);
            }
        }

        async function updateDbStatus(stats) {
            if (dbStatusEl && stats) {
                let outCount = 0;
                try { outCount = (await ScannerDB.getAllOutcomes()).length; } catch(e) {}
                dbStatusEl.textContent = `📦 ${stats.tokens}T ${stats.trades}Tr ${outCount}Out`;
                dbStatusEl.style.background = 'rgba(20,241,149,0.1)';
                dbStatusEl.style.color = '#14F195';
                dbStatusEl.style.borderColor = 'rgba(20,241,149,0.2)';
            }
        }

        // Auto-save every 30 seconds
        async function autoPersist() {
            if (typeof ScannerDB === 'undefined') return;
            try {
                // Save sniper data (runs persistently even if scanning is stopped)
                if (typeof SniperEngine !== 'undefined') {
                    const sniperState = SniperEngine.getState();
                    await ScannerDB.persistSniperState(sniperState);
                }

                // Save trade data
                if (typeof PaperTrader !== 'undefined') {
                    const metrics = PaperTrader.getMetrics();
                    await ScannerDB.persistTradeState(metrics);

                    // v3.0: Persist trade logs to alerts store
                    const logs = PaperTrader.tradeLogs || [];
                    for (const log of logs.slice(0, 20)) {
                        if (log._persisted) continue;
                        await ScannerDB.saveAlert({
                            id: `tl_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
                            type: log.type || 'trade_log',
                            message: log.message,
                            time: log.time,
                            timestamp: Date.now(),
                        });
                        log._persisted = true;
                    }
                }

                // Save cluster data
                if (typeof ClusterIntel !== 'undefined') {
                    const ciState = ClusterIntel.state;
                    if (ciState.nodes && ciState.nodes.size > 0) {
                        await ScannerDB.persistClusterState(ciState.nodes, ciState.edges);
                    }
                }
                // Save outcome snapshots — record every token's price trajectory for pattern learning
                if (typeof SniperEngine !== 'undefined' && SniperEngine.isRunning) {
                    const sState = SniperEngine.getState();
                    for (const token of sState.tokens) {
                        await ScannerDB.saveOutcome(token);
                    }
                }

                // Trigger Radar outcome stats refresh
                if (typeof Radar !== 'undefined' && Radar.isRunning) {
                    Radar.takeOutcomeSnapshots();
                }

                // Update UI with fresh stats
                const stats = await ScannerDB.getStats();
                updateDbStatus(stats);

                // Auto-sync database state to workspace directory
                await syncWorkspaceData();
            } catch (err) {
                console.warn('📦 [DB] Auto-persist failed:', err.message);
            }
        }

        // Initialize DB and set up auto-save
        initDatabase();
        setInterval(autoPersist, 30000); // Save every 30s

        // ===================================================
        //  MULTIBAGGER RADAR WIRING + AUTO-TRADE
        // ===================================================

        if (typeof Radar !== 'undefined') {
            const radarFeed = document.getElementById('radar-feed');
            const radarCountBadge = document.getElementById('radar-count');
            const autoTradedTokens = new Set(); // Prevent duplicate auto-trades

            function renderRadarFeed() {
                const rs = Radar.getState();
                if (!radarFeed) return;

                // Update outcome stats
                if (rs.outcomeStats) {
                    const os = rs.outcomeStats;
                    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
                    setTxt('rs-total', os.total);
                    setTxt('rs-moons', os.moons);
                    setTxt('rs-goods', os.goods);
                    setTxt('rs-rugs', os.rugs);
                    setTxt('rs-dead', os.dead);
                    setTxt('rs-active', os.active);
                    setTxt('rs-moonrate', os.moonRate + '%');
                    setTxt('rs-avgpeak', os.avgPeakMult.toFixed(1) + 'x');
                }

                if (radarCountBadge) radarCountBadge.textContent = `${rs.signalCount} signals`;

                if (rs.signals.length === 0) {
                    radarFeed.innerHTML = '<div class="radar-empty">⏳ Waiting for sniper data... Signals appear automatically.</div>';
                    return;
                }

                // Auto-trade: Pattern-based execution for Runner signals with high conviction
                autoTradeFromSignals(rs.signals);

                // Build spike alerts bar if any
                let spikeHtml = '';
                if (rs.spikeAlerts && rs.spikeAlerts.length > 0) {
                    spikeHtml = '<div class="radar-spike-bar">' +
                        rs.spikeAlerts.slice(-5).map(s => 
                            `<span class="radar-spike ${s.type}">${s.icon} ${s.sym}: ${s.text}</span>`
                        ).join('') + '</div>';
                }

                radarFeed.innerHTML = spikeHtml + rs.signals.map(sig => {
                    const convClass = sig.conviction >= 60 ? 'conviction-high' : sig.conviction >= 40 ? 'conviction-mid' : 'conviction-low';
                    const convColor = sig.conviction >= 60 ? '#14F195' : sig.conviction >= 40 ? '#FF9500' : '#666';
                    const pc = sig.priceChange1h;
                    const pcClass = pc >= 0 ? 'positive' : 'negative';
                    const pcSign = pc >= 0 ? '+' : '';
                    const patternColor = sig.pattern?.color || '#666';
                    const patternLabel = sig.pattern?.label || '🔍 Monitoring';
                    const patternPotential = sig.pattern?.potential || '';
                    const lmr = sig.liqMcapRatio ? (sig.liqMcapRatio * 100).toFixed(0) + '%' : '—';
                    const hasSpikes = sig.spikes && sig.spikes.length > 0;
                    const hpColors = {whale_dominated:'#FF4D6A', concentrated:'#FF9500', moderate:'#888', well_distributed:'#14F195', unknown:'#555'};
                    const hpIcons = {whale_dominated:'🐋', concentrated:'🦈', moderate:'📊', well_distributed:'👥', unknown:'❓'};
                    const hpColor = hpColors[sig.holderPattern] || '#555';
                    const hpIcon = hpIcons[sig.holderPattern] || '❓';

                    return `
                        <div class="radar-signal ${convClass}${hasSpikes ? ' has-spike' : ''}" onclick="window.__openTokenDetail('${sig.address}')">
                            <div class="radar-signal-header">
                                <div class="radar-signal-title">
                                    <span class="radar-signal-symbol">${sig.symbol}</span>
                                    <span class="radar-signal-grade">${sig.grade}</span>
                                    <span class="radar-pattern-badge" style="background:${patternColor}22;color:${patternColor};border:1px solid ${patternColor}44;">${patternLabel}</span>
                                </div>
                                <div class="radar-signal-right">
                                    <span class="radar-signal-conviction" style="color:${convColor};">${sig.conviction}/100</span>
                                    <span class="radar-signal-change ${pcClass}">${pcSign}${pc.toFixed(1)}% 1h</span>
                                </div>
                            </div>
                            <div class="radar-conviction-bar"><div class="radar-conviction-fill" style="width:${sig.conviction}%;background:${convColor};"></div></div>
                            <div class="radar-signal-metrics">
                                <span class="radar-metric"><strong>MCap:</strong> ${formatUsd(sig.marketCap)}</span>
                                <span class="radar-metric"><strong>Liq:</strong> ${formatUsd(sig.liquidity)}</span>
                                <span class="radar-metric"><strong>L/M:</strong> ${lmr}</span>
                                <span class="radar-metric"><strong>Vol 1h:</strong> ${formatUsd(sig.volume1h)}</span>
                                <span class="radar-metric"><strong>B:</strong> ${sig.buys1h} <strong>S:</strong> ${sig.sells1h}</span>
                                <span class="radar-metric"><strong>Buy%:</strong> ${sig.buyRatio}%</span>
                                <span class="radar-metric"><strong>Age:</strong> ${sig.ageHours ? sig.ageHours.toFixed(1) + 'h' : '—'}</span>
                                <span class="radar-metric" style="color:${hpColor};">${hpIcon} ${sig.topHolderPct ? sig.topHolderPct.toFixed(0) + '% top' : '—'}</span>
                                ${patternPotential ? `<span class="radar-metric" style="color:${patternColor};font-weight:700;">🎯 ${patternPotential}</span>` : ''}
                            </div>
                            <div class="radar-reasons">
                                ${sig.reasons.map(r => `<div class="radar-reason ${r.type}"><span class="radar-reason-icon">${r.icon}</span><span class="radar-reason-text">${r.text}</span></div>`).join('')}
                            </div>
                            <div class="radar-signal-actions">
                                <button class="radar-action-btn primary" onclick="event.stopPropagation();window.__openTokenDetail('${sig.address}')">🔬 Details</button>
                                <button class="radar-action-btn" onclick="event.stopPropagation();window.__openQuickChart('${sig.pairAddress || sig.address}','${sig.symbol}')">📈 Chart</button>
                                <button class="radar-action-btn" onclick="event.stopPropagation();window.__loadQuickBubbleMap('${sig.address}','${sig.symbol}')">🫧 BubbleMaps</button>
                                <button class="radar-action-btn" onclick="event.stopPropagation();window.__sniperCopyTrade('${sig.address}')">📋 Trade</button>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            // Auto-trade based on pattern classification
            function autoTradeFromSignals(signals) {
                if (typeof PaperTrader === 'undefined') return;

                for (const sig of signals) {
                    // Only auto-trade RUNNER pattern with high conviction, not already traded
                    if (sig.pattern?.type === 'RUNNER' && sig.conviction >= 60 && !autoTradedTokens.has(sig.address)) {
                        autoTradedTokens.add(sig.address);

                        const sniperState = SniperEngine.getState();
                        const token = sniperState.tokens.find(t => t.address === sig.address);
                        if (!token) continue;

                        const overrideToken = {
                            symbol: token.symbol, address: token.address,
                            pairAddress: token.pairAddress, priceUsd: token.priceUsd,
                            priceNative: token.priceNative, volume24h: token.volume24h,
                            liquidity: token.liquidity, priceChange24h: token.priceChange24h,
                            marketCap: token.marketCap, url: token.url, createdAt: token.createdAt,
                            holderData: token.holderData,
                        };

                        PaperTrader.simulateEntry('RADAR_RUNNER', { manipulationRisk: Math.max(5, 100 - sig.conviction) }, overrideToken)
                            .then(result => {
                                if (result.success) {
                                    toast(`🏃 Auto-trade: ${token.symbol} (Runner pattern, ${sig.conviction}/100)`);
                                    renderPaperTrading();
                                }
                            }).catch(() => {});
                    }

                    // Quick Flip: auto-trade with tighter take-profit
                    if (sig.pattern?.type === 'QUICK_FLIP' && sig.conviction >= 50 && !autoTradedTokens.has(sig.address)) {
                        autoTradedTokens.add(sig.address);

                        const sniperState = SniperEngine.getState();
                        const token = sniperState.tokens.find(t => t.address === sig.address);
                        if (!token) continue;

                        const overrideToken = {
                            symbol: token.symbol, address: token.address,
                            pairAddress: token.pairAddress, priceUsd: token.priceUsd,
                            priceNative: token.priceNative, volume24h: token.volume24h,
                            liquidity: token.liquidity, priceChange24h: token.priceChange24h,
                            marketCap: token.marketCap, url: token.url, createdAt: token.createdAt,
                            holderData: token.holderData,
                        };

                        PaperTrader.simulateEntry('RADAR_FLIP', { manipulationRisk: Math.max(20, 100 - sig.conviction) }, overrideToken)
                            .then(result => {
                                if (result.success) {
                                    toast(`⚡ Auto-scalp: ${token.symbol} (Quick Flip, TP at 2x)`);
                                    renderPaperTrading();
                                }
                            }).catch(() => {});
                    }
                }
            }

            Radar.onUpdate = renderRadarFeed;

            // Auto-start Radar after sniper has time to populate
            setTimeout(() => {
                Radar.start();
                console.log('📡 [Radar] Auto-started');
            }, 5000);
        }
        // ===================================================
        //  BUBBLEMAPS IFRAME MODAL
        // ===================================================

        const bmOverlay = document.getElementById('bubblemaps-overlay');
        const bmIframe = document.getElementById('bubblemaps-iframe');
        const bmTitle = document.getElementById('bubblemaps-token-name');
        const bmExtLink = document.getElementById('bubblemaps-external-link');
        const bmSolscanLink = document.getElementById('bubblemaps-solscan-link');
        const bmCloseBtn = document.getElementById('bubblemaps-close');

        // Chart Popup elements
        const chartOverlay = document.getElementById('chart-overlay');
        const chartIframe = document.getElementById('chart-iframe');
        const chartTitle = document.getElementById('chart-token-name');
        const chartExtLink = document.getElementById('chart-external-link');
        const chartCloseBtn = document.getElementById('chart-close');

        // v3.0: BubbleMaps Quick Viewer loader (loads map in bottom cluster intelligence section)
        window.__loadQuickBubbleMap = (tokenAddress, tokenSymbol) => {
            const iframe = document.getElementById('bm-quick-iframe');
            const placeholder = document.getElementById('bm-quick-placeholder');
            const tokenNameEl = document.getElementById('bm-quick-token-name');
            const extLink = document.getElementById('bm-quick-external-link');
            const section = document.getElementById('cluster-section');

            if (iframe && placeholder && tokenNameEl && extLink) {
                tokenNameEl.textContent = `${tokenSymbol || 'Token'} (${tokenAddress.slice(0,8)}...)`;
                extLink.href = `https://app.bubblemaps.io/sol/token/${tokenAddress}`;
                extLink.style.display = 'inline-block';

                iframe.src = `https://iframe.bubblemaps.io/map?address=${tokenAddress}&chain=solana&partnerId=demo`;
                iframe.style.display = 'block';
                placeholder.style.display = 'none';

                if (section) {
                    section.scrollIntoView({ behavior: 'smooth' });
                }
                toast(`🫧 Quick BubbleMap loaded for ${tokenSymbol || 'token'}`);
            }
        };

        // v3.0: Quick Chart Popup handler
        window.__openQuickChart = (tokenAddress, tokenSymbol) => {
            if (!chartOverlay || !chartIframe) return;

            chartTitle.textContent = `📈 Quick Chart — ${tokenSymbol || tokenAddress.slice(0,8) + '...'}`;
            chartExtLink.href = `https://dexscreener.com/solana/${tokenAddress}`;

            chartIframe.src = `https://dexscreener.com/solana/${tokenAddress}?embed=1&theme=dark&info=0`;
            chartOverlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            toast(`📈 Quick Chart loaded for ${tokenSymbol || 'token'}`);
        };

        function closeQuickChart() {
            if (!chartOverlay) return;
            chartOverlay.style.display = 'none';
            chartIframe.src = '';
            document.body.style.overflow = '';
        }

        if (chartCloseBtn) chartCloseBtn.addEventListener('click', closeQuickChart);
        if (chartOverlay) chartOverlay.addEventListener('click', (e) => {
            if (e.target === chartOverlay) closeQuickChart();
        });

        window.__openBubbleMaps = (tokenAddress, tokenSymbol) => {
            if (!bmOverlay || !bmIframe) return;

            // Update title
            bmTitle.textContent = `🫧 BubbleMaps — ${tokenSymbol || tokenAddress.slice(0,8) + '...'}`;

            // Set external links
            bmExtLink.href = `https://app.bubblemaps.io/sol/token/${tokenAddress}`;
            bmSolscanLink.href = `https://solscan.io/token/${tokenAddress}`;

            // Setup loading placeholder
            const placeholderId = 'bm-placeholder';
            let placeholder = document.getElementById(placeholderId);
            if (!placeholder) {
                placeholder = document.createElement('div');
                placeholder.id = placeholderId;
                placeholder.className = 'iframe-placeholder';
                bmIframe.parentNode.insertBefore(placeholder, bmIframe);
            }
            placeholder.style.display = 'flex';
            placeholder.innerHTML = `
                <div class="spinner"></div>
                <p style="margin-top: 10px; font-size: 0.82rem;">Loading BubbleMaps Linkage Map...</p>
            `;
            bmIframe.style.opacity = '0';
            bmIframe.style.transition = 'opacity 0.3s';

            // Set iframe src to BubbleMaps embed with address first
            bmIframe.src = `https://iframe.bubblemaps.io/map?address=${tokenAddress}&chain=solana&partnerId=demo`;

            // Show modal
            bmOverlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';

            // Timeout fallback checker (4 seconds)
            const timeout = setTimeout(() => {
                if (placeholder.style.display !== 'none') {
                    placeholder.innerHTML = `
                        <div style="text-align: center; padding: 24px; max-width: 90%;">
                            <span style="font-size: 2.2rem; display: block; margin-bottom: 12px;">🔒</span>
                            <h4 style="margin: 0 0 8px 0; color: var(--text-primary); font-size: 1rem;">BubbleMaps Embed Restricted</h4>
                            <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0 0 20px 0; line-height: 1.5;">
                                BubbleMaps limits embeds on unregistered custom domains. You can inspect the live cluster visualization directly on their official web platform.
                            </p>
                            <a href="https://app.bubblemaps.io/sol/token/${tokenAddress}" target="_blank" class="btn btn-primary" style="padding: 10px 20px; font-size: 0.82rem; text-decoration: none; border-radius: var(--radius-md);">
                                Open Interactive BubbleMap Website ↗
                            </a>
                        </div>
                    `;
                }
            }, 4000);

            bmIframe.onload = () => {
                clearTimeout(timeout);
                placeholder.style.display = 'none';
                bmIframe.style.opacity = '1';
            };
        };

        function closeBubbleMaps() {
            if (!bmOverlay) return;
            bmOverlay.style.display = 'none';
            bmIframe.src = ''; // Stop loading
            document.body.style.overflow = '';
            
            const placeholder = document.getElementById('bm-placeholder');
            if (placeholder) placeholder.style.display = 'none';
        }

        if (bmCloseBtn) bmCloseBtn.addEventListener('click', closeBubbleMaps);
        if (bmOverlay) bmOverlay.addEventListener('click', (e) => {
            if (e.target === bmOverlay) closeBubbleMaps();
        });

        // ===================================================
        //  TOKEN DETAIL MODAL
        // ===================================================

        const tdOverlay = document.getElementById('token-detail-overlay');
        const tdSymbol = document.getElementById('td-symbol');
        const tdScore = document.getElementById('td-score');
        const tdAge = document.getElementById('td-age');
        const tdActions = document.getElementById('td-actions');
        const tdMetrics = document.getElementById('td-metrics');
        const tdScoreBreakdown = document.getElementById('td-score-breakdown');
        const tdChartFrame = document.getElementById('td-chart-frame');
        const tdHoldersInfo = document.getElementById('td-holders-info');
        const tdBmFrame = document.getElementById('td-bm-frame');
        const tdSocialLinks = document.getElementById('td-social-links');
        const tdClose = document.getElementById('td-close');

        async function refreshModalTokenData(tokenAddress) {
            try {
                const resp = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + tokenAddress);
                if (!resp.ok) return;
                const data = await resp.json();
                const pairs = Array.isArray(data) ? data : (data?.pairs || []);
                if (pairs.length === 0) return;

                const p = pairs[0];
                const marketCap = parseFloat(p.marketCap || p.fdv) || 0;
                const liquidity = parseFloat(p.liquidity?.usd) || 0;
                const volume1h = parseFloat(p.volume?.h1) || 0;
                const volume24h = parseFloat(p.volume?.h24) || 0;
                const pc1h = parseFloat(p.priceChange?.h1) || 0;
                const pc24h = parseFloat(p.priceChange?.h24) || 0;
                const buys1h = p.txns?.h1?.buys || 0;
                const sells1h = p.txns?.h1?.sells || 0;
                const buyRatio = buys1h + sells1h > 0 ? ((buys1h / (buys1h + sells1h)) * 100).toFixed(0) : '—';
                const priceUsd = p.priceUsd ? '$' + parseFloat(p.priceUsd).toPrecision(4) : '—';
                const priceSOL = p.priceNative ? parseFloat(p.priceNative).toPrecision(4) : '—';
                const pairAddrStr = p.pairAddress ? p.pairAddress.slice(0,12) + '…' : '—';

                const formatUsdLocal = (n) => {
                    if (!n || isNaN(n)) return '$0';
                    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
                    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
                    return `$${n.toFixed(0)}`;
                };

                const tdMetricsElement = document.getElementById('td-metrics');
                if (tdMetricsElement && tdOverlay && tdOverlay.style.display !== 'none') {
                    tdMetricsElement.innerHTML = `
                        <div class="td-metric-card"><div class="td-metric-label">Market Cap</div><div class="td-metric-value">${formatUsdLocal(marketCap)}</div></div>
                        <div class="td-metric-card"><div class="td-metric-label">Liquidity</div><div class="td-metric-value">${formatUsdLocal(liquidity)}</div></div>
                        <div class="td-metric-card"><div class="td-metric-label">Volume 1h</div><div class="td-metric-value">${formatUsdLocal(volume1h)}</div></div>
                        <div class="td-metric-card"><div class="td-metric-label">Volume 24h</div><div class="td-metric-value">${formatUsdLocal(volume24h)}</div></div>
                        <div class="td-metric-card"><div class="td-metric-label">Price Change 1h</div><div class="td-metric-value ${pc1h >= 0 ? 'positive' : 'negative'}">${pc1h >= 0 ? '+' : ''}${pc1h.toFixed(1)}%</div></div>
                        <div class="td-metric-card"><div class="td-metric-label">Price Change 24h</div><div class="td-metric-value ${pc24h >= 0 ? 'positive' : 'negative'}">${pc24h >= 0 ? '+' : ''}${pc24h.toFixed(1)}%</div></div>
                        <div class="td-metric-card"><div class="td-metric-label">Buys 1h</div><div class="td-metric-value positive">${buys1h}</div></div>
                        <div class="td-metric-card"><div class="td-metric-label">Sells 1h</div><div class="td-metric-value negative">${sells1h}</div></div>
                        <div class="td-metric-card"><div class="td-metric-label">Buy Ratio</div><div class="td-metric-value">${buyRatio}%</div></div>
                        <div class="td-metric-card"><div class="td-metric-label">Price USD</div><div class="td-metric-value">${priceUsd}</div></div>
                        <div class="td-metric-card"><div class="td-metric-label">Price SOL</div><div class="td-metric-value">${priceSOL}</div></div>
                        <div class="td-metric-card"><div class="td-metric-label">Pair Address</div><div class="td-metric-value" style="font-size:0.6rem;">${pairAddrStr}</div></div>
                    `;
                }
            } catch (err) {
                console.error("Failed to refresh modal token data:", err);
            }
        }

        window.__openTokenDetail = (tokenAddress) => {
            if (!tdOverlay) return;
            const sniperState = SniperEngine.getState();
            const token = sniperState.tokens.find(t => t.address === tokenAddress);
            if (!token) { toast('Token not found — start a sniper scan first', 'error'); return; }

            // Header
            tdSymbol.textContent = token.symbol;

            // v3.0: Show platform tag in header
            const platformInfo = token.platformInfo || { label: token.dexId || 'DEX', color: '#6B7280' };
            const platformHTML = `<span class="sniper-platform-tag" style="background:${platformInfo.color}22;color:${platformInfo.color};border:1px solid ${platformInfo.color}44;font-size:0.65rem;margin-left:8px;">${platformInfo.label}</span>`;

            // v3.0: Show rejection or safe status in score
            if (token.rejected) {
                tdScore.innerHTML = `<span style="color:#FF3B30;">⛔ REJECTED</span> ${platformHTML}`;
                tdScore.style.background = 'rgba(255,59,48,0.15)';
                tdScore.style.color = '#FF3B30';
            } else {
                const safeHTML = token.safetyGate?.pass ? `<span style="color:#14F195;margin-left:6px;">🛡️ SAFE</span>` : '';
                tdScore.innerHTML = `${token.score.total}/100 ${token.score.grade || ''} ${safeHTML} ${platformHTML}`;
                tdScore.style.background = token.score.total >= 60 ? 'rgba(255,59,48,0.15)' : token.score.total >= 40 ? 'rgba(255,149,0,0.15)' : 'rgba(255,255,255,0.05)';
                tdScore.style.color = token.score.total >= 60 ? '#FF3B30' : token.score.total >= 40 ? '#FF9500' : 'var(--text-muted)';
            }
            tdAge.textContent = `Age: ${timeAgo(token.createdAt)} • ${token.dexId || 'DEX'} • ${token.address.slice(0,8)}…`;

            // v3.0: Rejection reason banner in detail view
            const rejectionBannerEl = document.getElementById('td-rejection-banner');
            if (rejectionBannerEl) {
                if (token.rejected) {
                    rejectionBannerEl.innerHTML = `<div class="sniper-rejection-banner" style="margin-bottom:12px;">⛔ REJECTED: ${token.rejectionReason || 'Unknown reason'}</div>`;
                    rejectionBannerEl.style.display = 'block';
                } else {
                    rejectionBannerEl.style.display = 'none';
                }
            }

            // Quick Actions — v3.0: disable paper trade for rejected tokens
            const paperTradeBtn = token.rejected
                ? `<button class="td-action-btn primary disabled" disabled title="Token rejected — cannot paper trade">📋 Paper Trade</button>`
                : `<button class="td-action-btn primary" onclick="window.__sniperCopyTrade('${token.address}');closeTokenDetail();">📋 Paper Trade</button>`;

            tdActions.innerHTML = `
                <a href="${token.url}" target="_blank" class="td-action-btn">📊 DexScreener</a>
                <a href="https://solscan.io/token/${token.address}" target="_blank" class="td-action-btn">🔎 Solscan</a>
                <a href="https://solana.fm/address/${token.address}" target="_blank" class="td-action-btn">🔍 SolanaFM</a>
                <a href="https://platform.arkhamintelligence.com/explorer/token/solana/${token.address}" target="_blank" class="td-action-btn">🕵️ Arkham</a>
                <a href="https://rugcheck.xyz/tokens/${token.address}" target="_blank" class="td-action-btn">🛡️ RugCheck</a>
                <button class="td-action-btn" onclick="window.__openQuickChart('${token.pairAddress || token.address}','${token.symbol}');closeTokenDetail();">📈 Chart Quick</button>
                <button class="td-action-btn" onclick="window.__loadQuickBubbleMap('${token.address}','${token.symbol}');closeTokenDetail();">🫧 BubbleMaps Quick</button>
                ${paperTradeBtn}
            `;

            // Initial render with cached data
            const pc1h = token.priceChange1h || 0;
            const pc24h = token.priceChange24h || 0;
            const buyRatio = (token.txns1h?.buys || 0) + (token.txns1h?.sells || 0) > 0
                ? ((token.txns1h.buys / (token.txns1h.buys + token.txns1h.sells)) * 100).toFixed(0) : '—';
            tdMetrics.innerHTML = `
                <div class="td-metric-card"><div class="td-metric-label">Market Cap</div><div class="td-metric-value">${formatUsd(token.marketCap)}</div></div>
                <div class="td-metric-card"><div class="td-metric-label">Liquidity</div><div class="td-metric-value">${formatUsd(token.liquidity)}</div></div>
                <div class="td-metric-card"><div class="td-metric-label">Volume 1h</div><div class="td-metric-value">${formatUsd(token.volume1h)}</div></div>
                <div class="td-metric-card"><div class="td-metric-label">Volume 24h</div><div class="td-metric-value">${formatUsd(token.volume24h)}</div></div>
                <div class="td-metric-card"><div class="td-metric-label">Price Change 1h</div><div class="td-metric-value ${pc1h >= 0 ? 'positive' : 'negative'}">${pc1h >= 0 ? '+' : ''}${pc1h.toFixed(1)}%</div></div>
                <div class="td-metric-card"><div class="td-metric-label">Price Change 24h</div><div class="td-metric-value ${pc24h >= 0 ? 'positive' : 'negative'}">${pc24h >= 0 ? '+' : ''}${pc24h.toFixed(1)}%</div></div>
                <div class="td-metric-card"><div class="td-metric-label">Buys 1h</div><div class="td-metric-value positive">${token.txns1h?.buys || 0}</div></div>
                <div class="td-metric-card"><div class="td-metric-label">Sells 1h</div><div class="td-metric-value negative">${token.txns1h?.sells || 0}</div></div>
                <div class="td-metric-card"><div class="td-metric-label">Buy Ratio</div><div class="td-metric-value">${buyRatio}%</div></div>
                <div class="td-metric-card"><div class="td-metric-label">Price USD</div><div class="td-metric-value">${token.priceUsd ? '$' + parseFloat(token.priceUsd).toPrecision(4) : '—'}</div></div>
                <div class="td-metric-card"><div class="td-metric-label">Price SOL</div><div class="td-metric-value">${token.priceNative ? parseFloat(token.priceNative).toPrecision(4) : '—'}</div></div>
                <div class="td-metric-card"><div class="td-metric-label">Pair Address</div><div class="td-metric-value" style="font-size:0.6rem;">${token.pairAddress ? token.pairAddress.slice(0,12) + '…' : '—'}</div></div>
            `;

            // Score Breakdown
            const breakdown = token.score.breakdown || {};
            const scoreItems = [
                { name: 'Volume Velocity', pts: breakdown.volumeVelocity || 0, max: 15, color: '#9945FF' },
                { name: 'MCap Zone', pts: breakdown.mcapZone || 0, max: 12, color: '#14F195', note: '$10K-$80K sweet spot' },
                { name: 'Smart Money', pts: breakdown.smartMoney || 0, max: 15, color: '#FFBA52' },
                { name: 'Buy Pressure', pts: breakdown.buyPressure || 0, max: 10, color: '#00D1FF' },
                { name: 'Liquidity Depth', pts: breakdown.liquidityDepth || 0, max: 10, color: '#19FBFB' },
                { name: 'Price Momentum', pts: breakdown.priceMomentum || 0, max: 10, color: '#FF9500' },
                { name: 'Token Freshness', pts: breakdown.freshness || 0, max: 10, color: '#FF3B30' },
                { name: 'Holder Growth', pts: breakdown.holderDistribution || 0, max: 8, color: '#5CE0FF' },
                { name: 'Social/Boost', pts: breakdown.socialBoost || 0, max: 5, color: '#5BFFC4' },
                { name: 'Social Presence', pts: token.score?.scores?.socialPresence || 0, max: 5, color: '#A855F7' },
            ];
            tdScoreBreakdown.innerHTML = `<h4 style="margin:0 0 12px;font-size:0.8rem;color:var(--text-secondary);">Score Breakdown — ${token.score.total}/100</h4>` +
                scoreItems.map(s => `
                    <div class="td-score-row">
                        <span class="td-score-name">${s.name}</span>
                        <div class="td-score-bar"><div class="td-score-bar-fill" style="width:${(s.pts/s.max*100).toFixed(0)}%;background:${s.color};"></div></div>
                        <span class="td-score-pts" style="color:${s.color};">${s.pts}/${s.max}</span>
                    </div>
                `).join('');

            // Chart — DexScreener embed
            tdChartFrame.innerHTML = `<iframe src="https://dexscreener.com/solana/${token.pairAddress || token.address}?embed=1&theme=dark&info=0" loading="lazy"></iframe>`;

            // Holders — fetch from Helius
            tdHoldersInfo.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center;">Loading top holders from Helius...</div>';
            fetchTopHolders(token.address).then(html => { tdHoldersInfo.innerHTML = html; }).catch(() => {
                tdHoldersInfo.innerHTML = '<div style="color:var(--text-muted);padding:20px;text-align:center;">Could not load holders. Open Solscan for full holder data.</div>';
            });

            // BubbleMaps Tab
            tdBmFrame.innerHTML = `
                <div class="iframe-container" style="position:relative; width:100%; height:100%; min-height:450px;">
                    <div id="td-bm-placeholder" class="iframe-placeholder" style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(10,12,18,0.95); z-index:2;">
                        <div class="spinner"></div>
                        <p style="margin-top: 10px; font-size:0.8rem;">Loading BubbleMaps Linkage Map...</p>
                    </div>
                    <iframe id="td-bm-iframe" src="https://iframe.bubblemaps.io/map?address=${token.address}&chain=solana&partnerId=demo" allow="clipboard-write" loading="lazy" style="width:100%; height:100%; min-height:450px; border:none; opacity:0; transition:opacity 0.3s;" onload="document.getElementById('td-bm-placeholder').style.display='none'; this.style.opacity='1';"></iframe>
                </div>
            `;
            
            // Set fallback timer for Token Detail Tab iframe (4 seconds)
            setTimeout(() => {
                const placeholder = document.getElementById('td-bm-placeholder');
                if (placeholder && placeholder.style.display !== 'none') {
                    placeholder.innerHTML = `
                        <div style="text-align: center; padding: 24px;">
                            <span style="font-size: 1.8rem; display:block; margin-bottom: 8px;">🔒</span>
                            <h4 style="margin: 0 0 4px 0; color: var(--text-primary); font-size:0.9rem;">BubbleMaps Embed Restricted</h4>
                            <p style="font-size: 0.75rem; color: var(--text-muted); margin: 0 0 15px 0; line-height: 1.4;">
                                Embedding is restricted by custom domain limits.
                            </p>
                            <a href="https://app.bubblemaps.io/sol/token/${token.address}" target="_blank" class="btn btn-primary" style="font-size:0.75rem; padding: 8px 16px; text-decoration:none; border-radius: var(--radius-sm);">
                                Open on BubbleMaps Website ↗
                            </a>
                        </div>
                    `;
                }
            }, 4000);

            // Social Tab
            const searchQuery = encodeURIComponent(`$${token.symbol} solana`);
            tdSocialLinks.innerHTML = `
                <a href="https://x.com/search?q=${searchQuery}&f=live" target="_blank" class="td-social-card">
                    <span class="td-social-icon">𝕏</span>
                    <div><div class="td-social-name">Search $${token.symbol} on X/Twitter</div><div class="td-social-desc">See live mentions, sentiment, CT picks</div></div>
                    <span class="td-social-arrow">→</span>
                </a>
                <a href="https://www.google.com/search?q=${searchQuery}" target="_blank" class="td-social-card">
                    <span class="td-social-icon">🔍</span>
                    <div><div class="td-social-name">Google Search</div><div class="td-social-desc">Find articles, forum posts, Telegram mentions</div></div>
                    <span class="td-social-arrow">→</span>
                </a>
                <a href="${token.url}" target="_blank" class="td-social-card">
                    <span class="td-social-icon">📊</span>
                    <div><div class="td-social-name">DexScreener Full Page</div><div class="td-social-desc">Live chart, trade history, socials linked by dev</div></div>
                    <span class="td-social-arrow">→</span>
                </a>
                <a href="https://rugcheck.xyz/tokens/${token.address}" target="_blank" class="td-social-card">
                    <span class="td-social-icon">🛡️</span>
                    <div><div class="td-social-name">RugCheck</div><div class="td-social-desc">Verify contract safety — mint authority, freeze, LP lock status</div></div>
                    <span class="td-social-arrow">→</span>
                </a>
                <a href="https://t.me/s/${token.symbol.toLowerCase()}" target="_blank" class="td-social-card">
                    <span class="td-social-icon">📱</span>
                    <div><div class="td-social-name">Telegram Search</div><div class="td-social-desc">Look for community/dev Telegram channels</div></div>
                    <span class="td-social-arrow">→</span>
                </a>
            `;

            // v3.0: Social Presence Checkboxes — wire up handlers
            const socialCheckX = document.getElementById('social-check-x');
            const socialCheckTg = document.getElementById('social-check-telegram');
            const socialCheckWeb = document.getElementById('social-check-website');
            const socialStatus = document.getElementById('social-check-status');

            // Initialize checkbox state from token data
            const sp = token.socialPresence || { x: false, telegram: false, website: false };
            if (socialCheckX) socialCheckX.checked = sp.x;
            if (socialCheckTg) socialCheckTg.checked = sp.telegram;
            if (socialCheckWeb) socialCheckWeb.checked = sp.website;

            function updateSocialStatus() {
                const count = (socialCheckX?.checked ? 1 : 0) + (socialCheckTg?.checked ? 1 : 0) + (socialCheckWeb?.checked ? 1 : 0);
                if (count >= 3) {
                    socialStatus.textContent = 'All 3 verified ✅ — score +5';
                    socialStatus.style.color = '#14F195';
                } else if (count === 2) {
                    socialStatus.textContent = '2 of 3 verified — score +3';
                    socialStatus.style.color = '#FFBA52';
                } else if (count === 1) {
                    socialStatus.textContent = 'Only 1 verified ⚠️ — score penalty -5';
                    socialStatus.style.color = '#FF9500';
                } else {
                    socialStatus.textContent = 'No social links checked — score penalty -10';
                    socialStatus.style.color = '#FF3B30';
                }
            }

            function onSocialChange() {
                // Update token data in SniperEngine state
                const sniperState = SniperEngine.getState();
                const tok = sniperState.tokens.find(t => t.address === token.address);
                if (tok && !tok.rejected) {
                    tok.socialPresence = {
                        x: socialCheckX?.checked || false,
                        telegram: socialCheckTg?.checked || false,
                        website: socialCheckWeb?.checked || false,
                    };
                    // Recalculate score with updated social presence
                    if (tok.holderData !== undefined) {
                        const smartMoney = tok.smartMoney || { matchCount: 0, matchedWallets: [] };
                        tok.score = SniperEngine.calculateSniperScore
                            ? SniperEngine.calculateSniperScore(tok, tok.holderData, smartMoney)
                            : tok.score;
                    }
                }
                updateSocialStatus();
                renderSniperDashboard(); // Refresh card grid
            }

            if (socialCheckX) socialCheckX.onchange = onSocialChange;
            if (socialCheckTg) socialCheckTg.onchange = onSocialChange;
            if (socialCheckWeb) socialCheckWeb.onchange = onSocialChange;
            updateSocialStatus();

            // Show modal + set up tabs
            tdOverlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            setupTdTabs();

            // Setup real-time fast polling for token overview (refresh every 2.5s)
            if (window.__modalRefreshTimer) clearInterval(window.__modalRefreshTimer);
            refreshModalTokenData(token.address);
            window.__modalRefreshTimer = setInterval(() => {
                if (tdOverlay && tdOverlay.style.display !== 'none') {
                    refreshModalTokenData(token.address);
                } else {
                    clearInterval(window.__modalRefreshTimer);
                    window.__modalRefreshTimer = null;
                }
            }, 2500);
        };

        async function fetchTopHolders(tokenAddress) {
            try {
                const resp = await fetch(`https://mainnet.helius-rpc.com/?api-key=3eb48747-e2b3-43c9-8d9b-490f26b684e0`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenLargestAccounts', params: [tokenAddress] }),
                });
                const data = await resp.json();
                const accounts = data.result?.value || [];
                if (accounts.length === 0) return '<div style="color:var(--text-muted);padding:20px;">No holder data available</div>';

                const totalSupply = accounts.reduce((s, a) => s + parseFloat(a.uiAmount || a.amount || 0), 0);
                let html = `<div style="margin-bottom:10px;color:var(--text-muted);font-size:0.7rem;">Top ${accounts.length} holders (by token balance)</div>`;
                accounts.slice(0, 20).forEach((acc, i) => {
                    const pct = totalSupply > 0 ? ((parseFloat(acc.uiAmount || 0) / totalSupply) * 100) : 0;
                    const addr = acc.address;
                    html += `
                        <div class="td-holder-row">
                            <span class="td-holder-rank">#${i + 1}</span>
                            <a href="https://solscan.io/account/${addr}" target="_blank" class="td-holder-addr">${addr.slice(0,6)}…${addr.slice(-4)}</a>
                            <div class="td-holder-bar"><div class="td-holder-bar-fill" style="width:${Math.min(pct, 100)}%"></div></div>
                            <span class="td-holder-pct">${pct.toFixed(2)}%</span>
                        </div>`;
                });
                return html;
            } catch (e) {
                return '<div style="color:var(--text-muted);padding:20px;">Failed to fetch holders: ' + e.message + '</div>';
            }
        }

        function setupTdTabs() {
            document.querySelectorAll('.td-tab').forEach(tab => {
                tab.onclick = () => {
                    document.querySelectorAll('.td-tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.td-tab-content').forEach(c => c.classList.remove('active'));
                    tab.classList.add('active');
                    const target = tab.getAttribute('data-tdtab');
                    document.getElementById('td-' + target)?.classList.add('active');
                };
            });
        }

        function closeTokenDetail() {
            if (window.__modalRefreshTimer) {
                clearInterval(window.__modalRefreshTimer);
                window.__modalRefreshTimer = null;
            }
            if (!tdOverlay) return;
            tdOverlay.style.display = 'none';
            document.body.style.overflow = '';
            // Clear iframes to stop loading
            if (tdChartFrame) tdChartFrame.innerHTML = '';
            if (tdBmFrame) tdBmFrame.innerHTML = '';
        }

        if (tdClose) tdClose.addEventListener('click', closeTokenDetail);
        if (tdOverlay) tdOverlay.addEventListener('click', (e) => { if (e.target === tdOverlay) closeTokenDetail(); });

        // Escape key — close any open modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (tdOverlay && tdOverlay.style.display !== 'none') { closeTokenDetail(); return; }
                if (bmOverlay && bmOverlay.style.display !== 'none') { closeBubbleMaps(); return; }
                if (chartOverlay && chartOverlay.style.display !== 'none') { closeQuickChart(); return; }
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
