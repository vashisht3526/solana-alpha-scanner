/* ===================================================================
   MULTIBAGGER RADAR v2 — Pattern-Based Signal Detection
   Implements real findings: MCap sweet spot, buy/sell spike detection,
   momentum tracking, and pattern classification (Runner/Flip/Trap).
   Tracks every coin's buy/sell/hold changes in real time.
   =================================================================== */

const Radar = (() => {
    'use strict';

    const CONFIG = {
        SIGNAL_REFRESH: 8000,       // Refresh signals every 8s
        OUTCOME_SNAPSHOT: 300000,   // Snapshot outcomes every 5min
        MIN_SIGNAL_SCORE: 25,
        MAX_SIGNALS: 50,
    };

    // Pattern thresholds based on live analysis of 39 tokens
    const PATTERNS = {
        RUNNER:     { minScore: 55, minMcap: 10000, maxMcap: 80000,  liqRatio: 0.10, label: '🏃 Real Runner',     color: '#14F195' },
        QUICK_FLIP: { minScore: 30, minMcap: 5000,  maxMcap: 50000,  liqRatio: 0.05, label: '⚡ Quick Flip',      color: '#FF9500' },
        FALSE_PROMISE: { minScore: 45, minMcap: 80000, maxMcap: 500000, liqRatio: 0, label: '⚠️ False Promise', color: '#FF4D6A' },
    };

    const state = {
        signals: [],
        prevSignals: new Map(),     // Previous signal state for spike detection
        spikeAlerts: [],            // Real-time spike alerts
        outcomeStats: null,
        pastWinners: [],
        isRunning: false,
        refreshTimer: null,
        snapshotTimer: null,
        onUpdate: null,
    };

    // ——— Signal Generation ———

    function generateSignals() {
        if (typeof SniperEngine === 'undefined') return;
        const tokens = SniperEngine.getState().tokens || [];
        const signals = [];

        for (const token of tokens) {
            if (token.score.total < CONFIG.MIN_SIGNAL_SCORE) continue;

            const prev = state.prevSignals.get(token.address);
            const spikes = detectSpikes(token, prev);
            const pattern = classifyPattern(token);
            const reasons = buildReasons(token, spikes, pattern);
            const conviction = calculateConviction(token, reasons, pattern, spikes);

            // Lightweight holder pattern classification
            const hd = token.holderData;
            const holderPattern = hd ? getHolderPattern(hd) : 'unknown';

            signals.push({
                address: token.address,
                symbol: token.symbol,
                score: token.score.total,
                grade: token.score.grade,
                conviction,
                pattern,
                spikes,
                marketCap: token.marketCap,
                liquidity: token.liquidity,
                priceUsd: token.priceUsd,
                priceChange1h: token.priceChange1h || 0,
                priceChange24h: token.priceChange24h || 0,
                volume1h: token.volume1h || 0,
                volume24h: token.volume24h || 0,
                ageHours: token.ageHours || 0,
                createdAt: token.createdAt,
                dexId: token.dexId,
                url: token.url,
                reasons,
                timestamp: Date.now(),
                buys1h: token.txns1h?.buys || 0,
                sells1h: token.txns1h?.sells || 0,
                buyRatio: getBuyRatio(token),
                liqMcapRatio: token.marketCap > 0 ? (token.liquidity / token.marketCap) : 0,
                holderConcentration: hd?.concentration || 'unknown',
                holderPattern,
                topHolderPct: hd?.topHolderPct || 0,
                isBoosted: token.source === 'dexscreener_boosted',
            });

            // Store current state for next-cycle spike detection
            state.prevSignals.set(token.address, {
                buys1h: token.txns1h?.buys || 0,
                sells1h: token.txns1h?.sells || 0,
                volume1h: token.volume1h || 0,
                marketCap: token.marketCap,
                priceUsd: token.priceUsd,
                priceChange1h: token.priceChange1h || 0,
                topHolderPct: hd?.topHolderPct || 0,
                timestamp: Date.now(),
            });
        }

        signals.sort((a, b) => b.conviction - a.conviction);
        state.signals = signals.slice(0, CONFIG.MAX_SIGNALS);

        // Trim old spike alerts (keep last 20)
        if (state.spikeAlerts.length > 20) state.spikeAlerts = state.spikeAlerts.slice(-20);

        if (state.onUpdate) state.onUpdate();
    }

    // ——— Spike Detection — Real-time buy/sell/volume/MCap changes ———

    function detectSpikes(token, prev) {
        const spikes = [];
        if (!prev) return spikes;

        const elapsed = (Date.now() - prev.timestamp) / 1000; // seconds
        if (elapsed < 5 || elapsed > 120) return spikes; // Skip if too fast or stale

        const b = token.txns1h?.buys || 0;
        const s = token.txns1h?.sells || 0;
        const prevB = prev.buys1h || 0;
        const prevS = prev.sells1h || 0;

        // Buy spike: 20+ new buys in one refresh cycle
        const newBuys = b - prevB;
        if (newBuys > 20) {
            const alert = { icon: '🟢', text: `BUY SPIKE: +${newBuys} buys in ${Math.round(elapsed)}s`, type: 'bullish', ts: Date.now(), sym: token.symbol };
            spikes.push(alert);
            state.spikeAlerts.push(alert);
        }

        // Sell spike: 20+ new sells in one cycle
        const newSells = s - prevS;
        if (newSells > 20) {
            const alert = { icon: '🔴', text: `SELL SPIKE: +${newSells} sells in ${Math.round(elapsed)}s`, type: 'bearish', ts: Date.now(), sym: token.symbol };
            spikes.push(alert);
            state.spikeAlerts.push(alert);
        }

        // Volume spike: vol doubled since last check
        const vol = token.volume1h || 0;
        if (prev.volume1h > 0 && vol > prev.volume1h * 1.5) {
            spikes.push({ icon: '📊', text: `VOL SURGE: ${fmtK(prev.volume1h)} → ${fmtK(vol)} in ${Math.round(elapsed)}s`, type: 'bullish' });
        }

        // MCap spike: >15% change in one cycle
        if (prev.marketCap > 0) {
            const mcapDelta = ((token.marketCap - prev.marketCap) / prev.marketCap) * 100;
            if (mcapDelta > 15) {
                spikes.push({ icon: '🚀', text: `MCAP SURGE: +${mcapDelta.toFixed(0)}% (${fmtK(prev.marketCap)} → ${fmtK(token.marketCap)})`, type: 'bullish' });
            } else if (mcapDelta < -20) {
                spikes.push({ icon: '💥', text: `MCAP DUMP: ${mcapDelta.toFixed(0)}% (${fmtK(prev.marketCap)} → ${fmtK(token.marketCap)})`, type: 'bearish' });
            }
        }

        // Price reversal detection
        if (prev.priceChange1h < -10 && (token.priceChange1h || 0) > 5) {
            spikes.push({ icon: '🔄', text: `REVERSAL: Was ${prev.priceChange1h.toFixed(0)}% → now +${(token.priceChange1h || 0).toFixed(0)}%`, type: 'bullish' });
        }

        return spikes;
    }

    // ——— Pattern Classification ———

    function classifyPattern(token) {
        const mc = token.marketCap || 0;
        const sc = token.score?.total || 0;
        const lr = mc > 0 ? (token.liquidity / mc) : 0;

        // Runner: Score ≥55, MCap $10K-$80K, Liq/MCap ≥10%
        if (sc >= PATTERNS.RUNNER.minScore && mc >= PATTERNS.RUNNER.minMcap && mc <= PATTERNS.RUNNER.maxMcap && lr >= PATTERNS.RUNNER.liqRatio) {
            return { type: 'RUNNER', ...PATTERNS.RUNNER, potential: '3x-10x', action: 'HOLD — trail stop 30%' };
        }

        // Quick Flip: Score 30-54, MCap $5K-$50K
        if (sc >= PATTERNS.QUICK_FLIP.minScore && sc < 55 && mc >= PATTERNS.QUICK_FLIP.minMcap && mc <= PATTERNS.QUICK_FLIP.maxMcap) {
            return { type: 'QUICK_FLIP', ...PATTERNS.QUICK_FLIP, potential: '1.5x-2.5x', action: 'SCALP — take profit at 2x' };
        }

        // False Promise: Score 45+, MCap >$80K
        if (sc >= PATTERNS.FALSE_PROMISE.minScore && mc > PATTERNS.FALSE_PROMISE.minMcap) {
            return { type: 'FALSE_PROMISE', ...PATTERNS.FALSE_PROMISE, potential: '1.2x-1.9x ceiling', action: 'AVOID — MCap too high for multibagger' };
        }

        return { type: 'UNCLASSIFIED', label: '🔍 Monitoring', color: '#666', potential: 'Unknown', action: 'Watch' };
    }

    function getBuyRatio(token) {
        const b = token.txns1h?.buys || 0;
        const s = token.txns1h?.sells || 0;
        return (b + s) > 0 ? Math.round((b / (b + s)) * 100) : 50;
    }

    function calculateConviction(token, reasons, pattern, spikes) {
        let conv = token.score.total;

        // Pattern bonus
        if (pattern.type === 'RUNNER') conv += 15;
        else if (pattern.type === 'QUICK_FLIP') conv += 5;
        else if (pattern.type === 'FALSE_PROMISE') conv -= 10;

        // Reason count bonus
        const bullish = reasons.filter(r => r.type === 'bullish').length;
        const bearish = reasons.filter(r => r.type === 'bearish').length;
        conv += (bullish - bearish) * 3;

        // Spike bonus
        const bullSpikes = spikes.filter(s => s.type === 'bullish').length;
        const bearSpikes = spikes.filter(s => s.type === 'bearish').length;
        conv += (bullSpikes - bearSpikes) * 5;

        // Momentum signals
        if (token.priceChange1h > 50) conv += 5;
        if (getBuyRatio(token) > 75) conv += 5;
        if (token.ageHours && token.ageHours < 1) conv += 5;

        // Pattern match vs past winners
        const match = matchPastWinners(token);
        if (match.score > 0) conv += match.score;

        // Holder distribution bonus/penalty
        if (token.holderData) {
            const hp = getHolderPattern(token.holderData);
            if (hp === 'well_distributed') conv += 5;
            else if (hp === 'moderate') conv += 2;
            else if (hp === 'concentrated') conv -= 3;
            else if (hp === 'whale_dominated') conv -= 8;
        }

        return Math.max(0, Math.min(100, conv));
    }

    // ——— Past Winner Pattern Matching ———

    function matchPastWinners(token) {
        if (state.pastWinners.length === 0) return { score: 0, matches: [] };
        let bestScore = 0;
        const matches = [];

        for (const w of state.pastWinners) {
            let sim = 0;
            if (w.discoveredMCap > 0 && token.marketCap > 0) {
                const r = token.marketCap / w.discoveredMCap;
                if (r > 0.3 && r < 3) sim += 2;
            }
            if (w.discoveredLiq > 0 && token.liquidity > 0) {
                const wr = w.discoveredLiq / (w.discoveredMCap || 1);
                const tr = token.liquidity / (token.marketCap || 1);
                if (Math.abs(wr - tr) < 0.2) sim += 2;
            }
            if (Math.abs((w.discoveredScore || 0) - token.score.total) < 15) sim += 1;
            if (w.dexId === token.dexId) sim += 1;
            if (sim >= 3) {
                matches.push({ symbol: w.symbol, peakMult: w.peakMultiplier, sim });
                bestScore = Math.max(bestScore, sim * 2);
            }
        }
        return { score: Math.min(15, bestScore), matches };
    }

    // ——— Reason Builder ———

    function buildReasons(token, spikes, pattern) {
        const reasons = [];

        // Pattern classification — first and most important
        if (pattern.type !== 'UNCLASSIFIED') {
            reasons.push({ icon: pattern.label.split(' ')[0], text: `${pattern.label}: ${pattern.potential} — ${pattern.action}`, type: pattern.type === 'FALSE_PROMISE' ? 'bearish' : 'bullish' });
        }

        // Live spikes — most time-sensitive
        for (const spike of spikes) {
            reasons.push(spike);
        }

        // Volume
        if (token.volume1h > 50000) {
            reasons.push({ icon: '📊', text: `High volume: ${fmtK(token.volume1h)}/hr`, type: 'bullish' });
        }

        // Buy pressure
        const br = getBuyRatio(token);
        if (br >= 70) {
            reasons.push({ icon: '🟢', text: `Accumulation: ${br}% buys (${token.txns1h?.buys || 0}B / ${token.txns1h?.sells || 0}S)`, type: 'bullish' });
        } else if (br < 40) {
            reasons.push({ icon: '🔴', text: `Sell pressure: only ${br}% buys`, type: 'bearish' });
        }

        // Price momentum
        if (token.priceChange1h > 100) {
            reasons.push({ icon: '🚀', text: `Exploding: +${token.priceChange1h.toFixed(0)}% in 1h`, type: 'bullish' });
        } else if (token.priceChange1h > 20) {
            reasons.push({ icon: '📈', text: `Uptrend: +${token.priceChange1h.toFixed(0)}% in 1h`, type: 'bullish' });
        } else if (token.priceChange1h < -30) {
            reasons.push({ icon: '📉', text: `Dumping: ${token.priceChange1h.toFixed(0)}% in 1h`, type: 'bearish' });
        }

        // MCap sweet spot (based on analysis)
        if (token.marketCap >= 10000 && token.marketCap <= 80000) {
            reasons.push({ icon: '🎯', text: `MCap sweet spot: ${fmtK(token.marketCap)} — highest 2x-10x probability zone`, type: 'bullish' });
        } else if (token.marketCap > 100000) {
            reasons.push({ icon: '📏', text: `MCap ${fmtK(token.marketCap)} — data shows <2x ceiling above $100K`, type: 'bearish' });
        }

        // Age
        if (token.ageHours && token.ageHours < 1) {
            reasons.push({ icon: '🆕', text: `${Math.round(token.ageHours * 60)}min old — early window`, type: 'bullish' });
        }

        // Liquidity safety
        if (token.liquidity > 0 && token.marketCap > 0) {
            const lr = token.liquidity / token.marketCap;
            if (lr > 0.3) {
                reasons.push({ icon: '💧', text: `Strong LP: ${(lr * 100).toFixed(0)}% backed`, type: 'bullish' });
            } else if (lr < 0.05) {
                reasons.push({ icon: '⚠️', text: `Thin LP: ${(lr * 100).toFixed(1)}% — rug risk`, type: 'bearish' });
            }
        }

        // Holder distribution analysis
        if (token.holderData) {
            const hp = getHolderPattern(token.holderData);
            const topPct = token.holderData.topHolderPct || 0;
            if (hp === 'whale_dominated') {
                reasons.push({ icon: '🐋', text: `Whale-dominated: top wallet ${topPct.toFixed(0)}% — high dump risk`, type: 'bearish' });
            } else if (hp === 'concentrated') {
                reasons.push({ icon: '🦈', text: `Concentrated: top wallet ${topPct.toFixed(0)}% — watch for sells`, type: 'bearish' });
            } else if (hp === 'well_distributed') {
                reasons.push({ icon: '👥', text: `Well distributed: top wallet ${topPct.toFixed(0)}% — healthy`, type: 'bullish' });
            } else if (hp === 'moderate') {
                reasons.push({ icon: '📊', text: `Moderate distribution: top ${topPct.toFixed(0)}%`, type: 'neutral' });
            }
        }

        // Vol/MCap
        if (token.marketCap > 0 && token.volume24h > 0) {
            const vm = token.volume24h / token.marketCap;
            if (vm > 2) reasons.push({ icon: '🔥', text: `Vol ${vm.toFixed(1)}x MCap — extreme interest`, type: 'bullish' });
        }

        // Pump.fun
        if (token.dexId === 'pumpswap' || token.address?.endsWith('pump')) {
            reasons.push({ icon: '🎰', text: 'Pump.fun launch', type: 'neutral' });
        }

        // Past winner match
        const match = matchPastWinners(token);
        if (match.matches.length > 0) {
            const top = match.matches[0];
            reasons.push({ icon: '🏆', text: `Matches past ${top.peakMult.toFixed(0)}x winner ${top.symbol}`, type: 'bullish' });
        }

        return reasons;
    }

    // Lightweight holder pattern classifier (mirrors db.js classifyHolderPattern)
    function getHolderPattern(hd) {
        if (!hd) return 'unknown';
        const topPct = hd.topHolderPct || 0;
        const holders = hd.topHolders || [];
        const total = hd.totalFromTop || holders.reduce((s, h) => s + (h.uiAmount || 0), 0);
        // Quick HHI estimate from top holders
        let hhi = 0;
        if (total > 0) {
            for (const h of holders) {
                const share = (h.uiAmount || 0) / total * 100;
                hhi += share * share;
            }
        }
        if (topPct > 30 || hhi > 3000) return 'whale_dominated';
        if (topPct > 15 || hhi > 1500) return 'concentrated';
        if (topPct < 10 && hhi < 800) return 'well_distributed';
        return 'moderate';
    }

    function fmtK(n) {
        if (!n || isNaN(n)) return '$0';
        if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
        if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
        return `$${n.toFixed(0)}`;
    }

    // ——— Outcome Snapshots ———

    async function takeOutcomeSnapshots() {
        if (typeof SniperEngine === 'undefined' || typeof ScannerDB === 'undefined') return;
        const tokens = SniperEngine.getState().tokens || [];
        let saved = 0;
        for (const token of tokens) {
            try { await ScannerDB.saveOutcome(token); saved++; } catch (e) { /* skip */ }
        }
        try {
            state.outcomeStats = await ScannerDB.getOutcomeStats();
            state.pastWinners = await ScannerDB.getMultibaggers();
        } catch (e) { /* skip */ }
        if (saved > 0) console.log(`📡 [Radar] ${saved} outcomes saved`);
        if (state.onUpdate) state.onUpdate();
    }

    // ——— Engine Control ———

    async function start() {
        if (state.isRunning) return;
        state.isRunning = true;
        try {
            if (typeof ScannerDB !== 'undefined') {
                state.outcomeStats = await ScannerDB.getOutcomeStats();
                state.pastWinners = await ScannerDB.getMultibaggers();
            }
        } catch (e) { /* skip */ }
        generateSignals();
        state.refreshTimer = setInterval(() => generateSignals(), CONFIG.SIGNAL_REFRESH);
        state.snapshotTimer = setInterval(() => takeOutcomeSnapshots(), CONFIG.OUTCOME_SNAPSHOT);
        setTimeout(() => takeOutcomeSnapshots(), 30000);
        console.log('📡 [Radar v2] Pattern-based radar started');
    }

    function stop() {
        state.isRunning = false;
        if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
        if (state.snapshotTimer) { clearInterval(state.snapshotTimer); state.snapshotTimer = null; }
    }

    function getState() {
        return {
            signals: state.signals,
            spikeAlerts: state.spikeAlerts.slice(-10),
            outcomeStats: state.outcomeStats,
            pastWinners: state.pastWinners.slice(0, 10),
            isRunning: state.isRunning,
            signalCount: state.signals.length,
        };
    }

    return {
        start, stop, getState, generateSignals, takeOutcomeSnapshots,
        set onUpdate(fn) { state.onUpdate = fn; },
        get isRunning() { return state.isRunning; },
    };
})();
