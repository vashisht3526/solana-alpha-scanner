/* ===================================================================
   SOLANA SCANNER DATABASE — IndexedDB Persistence Layer
   Stores all trading data, token discoveries, sniper scores,
   alpha wallets, and scan history across browser sessions.
   =================================================================== */

const ScannerDB = (() => {
    'use strict';

    const DB_NAME = 'SolanaAlphaScanner';
    const DB_VERSION = 3;
    let db = null;

    // ——— Store Definitions ———
    const STORES = {
        TOKENS:       'tokens',        // Discovered tokens + sniper scores
        TRADES:       'trades',        // Paper/copy trade positions & history
        WALLETS:      'wallets',       // Alpha wallets database
        SCANS:        'scans',         // Scan sessions & results
        ALERTS:       'alerts',        // Sniper alerts
        CLUSTERS:     'clusters',      // Wallet relationship clusters
        SETTINGS:     'settings',      // User configuration
        OUTCOMES:     'outcomes',      // Token outcome tracking (price snapshots + final result)
    };

    // ——— Initialize Database ———
    function open() {
        return new Promise((resolve, reject) => {
            if (db) { resolve(db); return; }

            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = (e) => {
                const database = e.target.result;

                // Tokens store — keyed by token address
                if (!database.objectStoreNames.contains(STORES.TOKENS)) {
                    const tokenStore = database.createObjectStore(STORES.TOKENS, { keyPath: 'address' });
                    tokenStore.createIndex('symbol', 'symbol', { unique: false });
                    tokenStore.createIndex('score', 'score.total', { unique: false });
                    tokenStore.createIndex('discoveredAt', 'discoveredAt', { unique: false });
                    tokenStore.createIndex('marketCap', 'marketCap', { unique: false });
                }

                // Trades store — keyed by trade ID
                if (!database.objectStoreNames.contains(STORES.TRADES)) {
                    const tradeStore = database.createObjectStore(STORES.TRADES, { keyPath: 'id' });
                    tradeStore.createIndex('tokenSymbol', 'tokenSymbol', { unique: false });
                    tradeStore.createIndex('status', 'status', { unique: false });
                    tradeStore.createIndex('entryTime', 'entryTime', { unique: false });
                    tradeStore.createIndex('tokenAddress', 'tokenAddress', { unique: false });
                }

                // Wallets store — keyed by wallet address
                if (!database.objectStoreNames.contains(STORES.WALLETS)) {
                    const walletStore = database.createObjectStore(STORES.WALLETS, { keyPath: 'address' });
                    walletStore.createIndex('pnlScore', 'pnlScore', { unique: false });
                    walletStore.createIndex('winRate', 'winRate', { unique: false });
                    walletStore.createIndex('lastSeen', 'lastSeen', { unique: false });
                    walletStore.createIndex('isAlpha', 'isAlpha', { unique: false });
                }

                // Scans store — keyed by timestamp
                if (!database.objectStoreNames.contains(STORES.SCANS)) {
                    const scanStore = database.createObjectStore(STORES.SCANS, { keyPath: 'id', autoIncrement: true });
                    scanStore.createIndex('timestamp', 'timestamp', { unique: false });
                    scanStore.createIndex('type', 'type', { unique: false });
                }

                // Alerts store
                if (!database.objectStoreNames.contains(STORES.ALERTS)) {
                    const alertStore = database.createObjectStore(STORES.ALERTS, { keyPath: 'id', autoIncrement: true });
                    alertStore.createIndex('tokenAddress', 'tokenAddress', { unique: false });
                    alertStore.createIndex('timestamp', 'timestamp', { unique: false });
                    alertStore.createIndex('score', 'score', { unique: false });
                }

                // Clusters store — wallet relationship data
                if (!database.objectStoreNames.contains(STORES.CLUSTERS)) {
                    const clusterStore = database.createObjectStore(STORES.CLUSTERS, { keyPath: 'id', autoIncrement: true });
                    clusterStore.createIndex('walletA', 'walletA', { unique: false });
                    clusterStore.createIndex('walletB', 'walletB', { unique: false });
                    clusterStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // Settings store — key/value
                if (!database.objectStoreNames.contains(STORES.SETTINGS)) {
                    database.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
                }

                // Outcomes store — tracks token price history + final outcome
                if (!database.objectStoreNames.contains(STORES.OUTCOMES)) {
                    const outcomeStore = database.createObjectStore(STORES.OUTCOMES, { keyPath: 'address' });
                    outcomeStore.createIndex('discoveredAt', 'discoveredAt', { unique: false });
                    outcomeStore.createIndex('outcome', 'outcome', { unique: false });
                    outcomeStore.createIndex('peakMultiplier', 'peakMultiplier', { unique: false });
                    outcomeStore.createIndex('wasMultibagger', 'wasMultibagger', { unique: false });
                }

                console.log('📦 [DB] Database schema created/upgraded');
            };

            req.onsuccess = (e) => {
                db = e.target.result;
                console.log(`📦 [DB] Database opened — v${DB_VERSION}`);
                resolve(db);
            };

            req.onerror = (e) => {
                console.error('📦 [DB] Failed to open database:', e.target.error);
                reject(e.target.error);
            };
        });
    }

    // ——— Generic CRUD Operations ———

    async function put(storeName, data) {
        const database = await open();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(data);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function putMany(storeName, items) {
        const database = await open();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            let count = 0;
            for (const item of items) {
                store.put(item);
                count++;
            }
            tx.oncomplete = () => resolve(count);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function get(storeName, key) {
        const database = await open();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async function getAll(storeName) {
        const database = await open();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async function getAllByIndex(storeName, indexName, value) {
        const database = await open();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const req = index.getAll(value);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async function remove(storeName, key) {
        const database = await open();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async function count(storeName) {
        const database = await open();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function clear(storeName) {
        const database = await open();
        return new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // ——— Token-Specific Operations ———

    async function saveToken(tokenData) {
        const record = {
            ...tokenData,
            discoveredAt: tokenData.discoveredAt || Date.now(),
            updatedAt: Date.now(),
        };
        return put(STORES.TOKENS, record);
    }

    async function saveTokens(tokens) {
        const records = tokens.map(t => ({
            ...t,
            discoveredAt: t.discoveredAt || Date.now(),
            updatedAt: Date.now(),
        }));
        return putMany(STORES.TOKENS, records);
    }

    async function getToken(address) {
        return get(STORES.TOKENS, address);
    }

    async function getAllTokens() {
        return getAll(STORES.TOKENS);
    }

    async function getTopTokens(limit = 50) {
        const all = await getAll(STORES.TOKENS);
        return all
            .filter(t => t.score && t.score.total > 0)
            .sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0))
            .slice(0, limit);
    }

    // ——— Trade-Specific Operations ———

    async function saveTrade(trade) {
        return put(STORES.TRADES, {
            ...trade,
            savedAt: Date.now(),
        });
    }

    async function saveTrades(trades) {
        return putMany(STORES.TRADES, trades.map(t => ({ ...t, savedAt: Date.now() })));
    }

    async function getOpenTrades() {
        return getAllByIndex(STORES.TRADES, 'status', 'open');
    }

    async function getClosedTrades() {
        return getAllByIndex(STORES.TRADES, 'status', 'closed');
    }

    async function getAllTrades() {
        return getAll(STORES.TRADES);
    }

    // ——— Wallet-Specific Operations ———

    async function saveWallet(wallet) {
        return put(STORES.WALLETS, {
            ...wallet,
            lastSeen: Date.now(),
        });
    }

    async function saveWallets(wallets) {
        return putMany(STORES.WALLETS, wallets.map(w => ({
            ...w,
            lastSeen: w.lastSeen || Date.now(),
        })));
    }

    async function getAlphaWallets() {
        return getAllByIndex(STORES.WALLETS, 'isAlpha', 1);
    }

    async function getAllWallets() {
        return getAll(STORES.WALLETS);
    }

    // ——— Alert Operations ———

    async function saveAlert(alert) {
        return put(STORES.ALERTS, {
            ...alert,
            timestamp: alert.timestamp || Date.now(),
        });
    }

    async function getRecentAlerts(limit = 100) {
        const all = await getAll(STORES.ALERTS);
        return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
    }

    // ——— Scan History ———

    async function saveScan(scanData) {
        return put(STORES.SCANS, {
            ...scanData,
            timestamp: Date.now(),
        });
    }

    async function getRecentScans(limit = 20) {
        const all = await getAll(STORES.SCANS);
        return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
    }

    // ——— Cluster Operations ———

    async function saveCluster(clusterData) {
        return put(STORES.CLUSTERS, {
            ...clusterData,
            timestamp: Date.now(),
        });
    }

    async function getClusters() {
        return getAll(STORES.CLUSTERS);
    }

    // ——— Settings ———

    async function setSetting(key, value) {
        return put(STORES.SETTINGS, { key, value, updatedAt: Date.now() });
    }

    async function getSetting(key, defaultValue = null) {
        const record = await get(STORES.SETTINGS, key);
        return record ? record.value : defaultValue;
    }

    // ——— Statistics ———

    async function getStats() {
        const [tokenCount, tradeCount, walletCount, alertCount, scanCount] = await Promise.all([
            count(STORES.TOKENS),
            count(STORES.TRADES),
            count(STORES.WALLETS),
            count(STORES.ALERTS),
            count(STORES.SCANS),
        ]);

        return {
            tokens: tokenCount,
            trades: tradeCount,
            wallets: walletCount,
            alerts: alertCount,
            scans: scanCount,
            dbVersion: DB_VERSION,
        };
    }

    // ——— Batch persistence for sniper engine ———

    async function persistSniperState(sniperState) {
        try {
            // Save all tracked tokens
            if (sniperState.tokens && sniperState.tokens.length > 0) {
                const tokenRecords = sniperState.tokens.map(t => ({
                    ...t,
                    discoveredAt: t.analyzedAt || Date.now(),
                    // Flatten non-serializable data
                    holderData: t.holderData || null,
                    smartMoney: t.smartMoney || null,
                    score: t.score || { total: 0 },
                }));
                await saveTokens(tokenRecords);
            }

            // Save alerts
            if (sniperState.alerts && sniperState.alerts.length > 0) {
                for (const alert of sniperState.alerts.slice(0, 20)) {
                    await saveAlert({
                        tokenAddress: alert.token?.address,
                        tokenSymbol: alert.token?.symbol,
                        score: alert.score,
                        grade: alert.grade,
                        time: alert.time,
                    });
                }
            }

            // Save scan session
            await saveScan({
                type: 'sniper',
                tokensScanned: sniperState.totalScanned,
                alertsGenerated: sniperState.totalAlerts,
                topTokens: sniperState.tokens.slice(0, 5).map(t => ({
                    symbol: t.symbol,
                    address: t.address,
                    score: t.score?.total,
                })),
            });

            console.log(`📦 [DB] Persisted ${sniperState.tokens.length} tokens, ${sniperState.alerts?.length || 0} alerts`);
        } catch (err) {
            console.warn('📦 [DB] Persist sniper state failed:', err.message);
        }
    }

    // ——— Batch persistence for trade engine ———

    async function persistTradeState(tradeMetrics) {
        try {
            // Save open positions
            if (tradeMetrics.positions) {
                await saveTrades(tradeMetrics.positions);
            }

            // Save trade history
            if (tradeMetrics.history) {
                await saveTrades(tradeMetrics.history);
            }

            // Save portfolio stats
            await setSetting('portfolio', {
                balance: tradeMetrics.balance,
                startingBalance: tradeMetrics.startingBalance,
                totalValue: tradeMetrics.totalValue,
                realizedPnl: tradeMetrics.realizedPnl,
                totalPnl: tradeMetrics.totalPnl,
                winRate: tradeMetrics.winRate,
                tradeCount: tradeMetrics.tradeCount,
                lastSaved: Date.now(),
            });

            console.log(`📦 [DB] Persisted ${tradeMetrics.openPositions} positions, ${tradeMetrics.closedTrades} history`);
        } catch (err) {
            console.warn('📦 [DB] Persist trade state failed:', err.message);
        }
    }

    // ——— Persist cluster intel data ———

    async function persistClusterState(nodes, edges) {
        try {
            const walletRecords = [];
            for (const [addr, node] of nodes) {
                walletRecords.push({
                    address: addr,
                    firstSeen: node.firstSeen,
                    lastSeen: node.lastSeen,
                    txCount: node.txCount,
                    volume: node.volume,
                    clusterId: node.clusterId,
                    labels: node.labels instanceof Set ? [...node.labels] : (node.labels || []),
                    isAlpha: (node.labels instanceof Set ? node.labels.has('alpha') : (Array.isArray(node.labels) && node.labels.includes('alpha'))) ? 1 : 0,
                    pnlScore: node.pnlScore || 0,
                    winRate: node.winRate || 0,
                });
            }
            if (walletRecords.length > 0) {
                await saveWallets(walletRecords);
            }

            // Save edges as clusters
            for (const [key, edge] of edges) {
                await saveCluster({
                    walletA: edge.from,
                    walletB: edge.to,
                    type: edge.type,
                    count: edge.count,
                    totalAmount: edge.totalAmount,
                });
            }

            console.log(`📦 [DB] Persisted ${walletRecords.length} wallets, ${edges.size} relationships`);
        } catch (err) {
            console.warn('📦 [DB] Persist cluster state failed:', err.message);
        }
    }

    // ——— Auto-Cleanup (v2.0) — Prevent IndexedDB bloat ———

    async function autoCleanup() {
        try {
            const MAX_CLUSTERS = 50000;
            const MAX_ALERTS = 5000;
            const MAX_SCANS = 200;
            const CLUSTER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

            const clusterCount = await count(STORES.CLUSTERS);
            if (clusterCount > MAX_CLUSTERS) {
                const allClusters = await getAll(STORES.CLUSTERS);
                const cutoff = Date.now() - CLUSTER_MAX_AGE_MS;
                const fresh = allClusters
                    .filter(c => c.timestamp && c.timestamp > cutoff)
                    .sort((a, b) => (b.count || 0) - (a.count || 0))
                    .slice(0, MAX_CLUSTERS);
                await clear(STORES.CLUSTERS);
                if (fresh.length > 0) await putMany(STORES.CLUSTERS, fresh);
                console.log('[DB] Cleaned clusters: ' + clusterCount + ' -> ' + fresh.length);
            }

            const alertCount = await count(STORES.ALERTS);
            if (alertCount > MAX_ALERTS) {
                const allAlerts = await getAll(STORES.ALERTS);
                const sorted = allAlerts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                const kept = sorted.slice(0, MAX_ALERTS);
                await clear(STORES.ALERTS);
                if (kept.length > 0) await putMany(STORES.ALERTS, kept);
                console.log('[DB] Cleaned alerts: ' + alertCount + ' -> ' + kept.length);
            }

            const scanCount = await count(STORES.SCANS);
            if (scanCount > MAX_SCANS) {
                const allScans = await getAll(STORES.SCANS);
                const sorted = allScans.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                const kept = sorted.slice(0, MAX_SCANS);
                await clear(STORES.SCANS);
                if (kept.length > 0) await putMany(STORES.SCANS, kept);
                console.log('[DB] Cleaned scans: ' + scanCount + ' -> ' + kept.length);
            }

            console.log('[DB] Auto-cleanup complete');
        } catch (err) {
            console.warn('[DB] Auto-cleanup failed:', err.message);
        }
    }

    // ——— Export/Import for backup ———

    async function exportAll() {
        const data = {};
        for (const store of Object.values(STORES)) {
            data[store] = await getAll(store);
        }
        return data;
    }

    async function restoreAll(data) {
        if (!data || typeof data !== 'object') throw new Error('Invalid backup data');
        for (const store of Object.values(STORES)) {
            if (data[store] && Array.isArray(data[store])) {
                await clear(store);
                await putMany(store, data[store]);
            }
        }
        console.log('📦 [DB] Database restored successfully');
    }

    async function getFullDump() {
        const stats = await getStats();
        const topTokens = await getTopTokens(10);
        const recentAlerts = await getRecentAlerts(10);
        const openTrades = await getOpenTrades();
        return { stats, topTokens, recentAlerts, openTrades };
    }

    // ——— Outcome Tracking — Feedback Loop ———

    async function saveOutcome(tokenData) {
        const existing = await get(STORES.OUTCOMES, tokenData.address);
        // Build holder snapshot if available
        const holderSnap = tokenData.holderData ? {
            topPct: tokenData.holderData.topHolderPct || 0,
            concentration: tokenData.holderData.concentration || 'unknown',
            uniqueTop: tokenData.holderData.uniqueTopHolders || 0,
            hhi: calcHHI(tokenData.holderData.topHolders),
            top5pcts: (tokenData.holderData.topHolders || []).slice(0, 5).map(h => {
                const total = tokenData.holderData.totalFromTop || 1;
                return total > 0 ? parseFloat(((h.uiAmount || 0) / total * 100).toFixed(2)) : 0;
            }),
        } : null;

        if (existing) {
            const snap = { t: Date.now(), p: tokenData.priceUsd || 0, mc: tokenData.marketCap || 0, liq: tokenData.liquidity || 0, v1h: tokenData.volume1h || 0 };
            existing.snapshots.push(snap);
            if (existing.snapshots.length > 200) existing.snapshots = existing.snapshots.slice(-200);
            if (tokenData.marketCap > (existing.peakMCap || 0)) {
                existing.peakMCap = tokenData.marketCap;
                existing.peakMultiplier = existing.discoveredMCap > 0 ? tokenData.marketCap / existing.discoveredMCap : 0;
            }
            existing.currentMCap = tokenData.marketCap || 0;
            existing.currentMultiplier = existing.discoveredMCap > 0 ? (tokenData.marketCap || 0) / existing.discoveredMCap : 0;
            existing.lastUpdated = Date.now();
            existing.wasMultibagger = existing.peakMultiplier >= 10;
            existing.outcome = classifyOutcome(existing);
            // Update holder snapshots (keep last 20)
            if (holderSnap) {
                if (!existing.holderSnapshots) existing.holderSnapshots = [];
                existing.holderSnapshots.push({ t: Date.now(), ...holderSnap });
                if (existing.holderSnapshots.length > 20) existing.holderSnapshots = existing.holderSnapshots.slice(-20);
                existing.currentHolder = holderSnap;
            }
            return put(STORES.OUTCOMES, existing);
        } else {
            const record = {
                address: tokenData.address,
                symbol: tokenData.symbol,
                discoveredAt: tokenData.discoveredAt || tokenData.analyzedAt || Date.now(),
                discoveredScore: tokenData.score?.total || 0,
                discoveredGrade: tokenData.score?.grade || '',
                discoveredMCap: tokenData.marketCap || 0,
                discoveredLiq: tokenData.liquidity || 0,
                discoveredPrice: tokenData.priceUsd || 0,
                scoreBreakdown: tokenData.score?.scores || {},
                dexId: tokenData.dexId || '',
                // Holder data at discovery
                discoveredHolder: holderSnap,
                holderSnapshots: holderSnap ? [{ t: Date.now(), ...holderSnap }] : [],
                currentHolder: holderSnap,
                holderPattern: holderSnap ? classifyHolderPattern(holderSnap) : 'unknown',
                snapshots: [{ t: Date.now(), p: tokenData.priceUsd || 0, mc: tokenData.marketCap || 0, liq: tokenData.liquidity || 0, v1h: tokenData.volume1h || 0 }],
                peakMCap: tokenData.marketCap || 0,
                peakMultiplier: 1,
                currentMCap: tokenData.marketCap || 0,
                currentMultiplier: 1,
                wasMultibagger: false,
                outcome: 'active',
                lastUpdated: Date.now(),
            };
            return put(STORES.OUTCOMES, record);
        }
    }

    // Herfindahl-Hirschman Index: measures holder concentration (0-10000)
    // High HHI = whale-dominated, Low HHI = well-distributed
    function calcHHI(holders) {
        if (!holders || holders.length === 0) return 0;
        const total = holders.reduce((s, h) => s + (h.uiAmount || 0), 0);
        if (total === 0) return 0;
        return Math.round(holders.reduce((s, h) => {
            const share = (h.uiAmount || 0) / total * 100;
            return s + share * share;
        }, 0));
    }

    // Classify holder distribution pattern
    function classifyHolderPattern(holderSnap) {
        if (!holderSnap) return 'unknown';
        const hhi = holderSnap.hhi || 0;
        const topPct = holderSnap.topPct || 0;
        // whale_dominated: single wallet >30% or HHI > 3000
        if (topPct > 30 || hhi > 3000) return 'whale_dominated';
        // concentrated: top wallet 15-30% or HHI 1500-3000
        if (topPct > 15 || hhi > 1500) return 'concentrated';
        // distributed: top wallet <10% and HHI < 800
        if (topPct < 10 && hhi < 800) return 'well_distributed';
        // moderate: everything else
        return 'moderate';
    }

    function classifyOutcome(record) {
        const age = Date.now() - record.discoveredAt;
        const hoursSince = age / 3600000;
        if (record.peakMultiplier >= 10) return 'moon';        // 10x+ = moon
        if (record.peakMultiplier >= 3) return 'good';         // 3-10x = good
        if (record.currentMultiplier < 0.1 && hoursSince > 6) return 'rug'; // 90%+ drop after 6h
        if (record.currentMCap < 500 && hoursSince > 12) return 'dead';     // MCap near zero
        return 'active';
    }

    async function getAllOutcomes() { return getAll(STORES.OUTCOMES); }

    async function getMultibaggers() {
        const all = await getAll(STORES.OUTCOMES);
        return all.filter(o => o.wasMultibagger).sort((a, b) => b.peakMultiplier - a.peakMultiplier);
    }

    async function getOutcomeStats() {
        const all = await getAll(STORES.OUTCOMES);
        const total = all.length;
        const moons = all.filter(o => o.outcome === 'moon').length;
        const goods = all.filter(o => o.outcome === 'good').length;
        const rugs = all.filter(o => o.outcome === 'rug').length;
        const dead = all.filter(o => o.outcome === 'dead').length;
        const active = all.filter(o => o.outcome === 'active').length;
        const avgPeakMult = total > 0 ? all.reduce((s, o) => s + (o.peakMultiplier || 1), 0) / total : 0;
        return { total, moons, goods, rugs, dead, active, avgPeakMult, moonRate: total > 0 ? (moons / total * 100).toFixed(1) : '0' };
    }

    // Analyze outcomes grouped by holder distribution pattern
    async function getHolderPatternAnalysis() {
        const all = await getAll(STORES.OUTCOMES);
        const patterns = {};
        for (const o of all) {
            const pat = o.holderPattern || o.discoveredHolder?.concentration || 'unknown';
            if (!patterns[pat]) patterns[pat] = { total: 0, peaks: [], outcomes: [], twoX: 0, threeX: 0, rugs: 0, tokens: [] };
            const p = patterns[pat];
            p.total++;
            p.peaks.push(o.peakMultiplier || 1);
            p.outcomes.push(o.outcome);
            if (o.peakMultiplier >= 2) p.twoX++;
            if (o.peakMultiplier >= 3) p.threeX++;
            if (o.outcome === 'rug' || o.outcome === 'dead') p.rugs++;
            p.tokens.push({ sym: o.symbol, peak: (o.peakMultiplier || 1).toFixed(2), cur: (o.currentMultiplier || 0).toFixed(2), outcome: o.outcome, topPct: o.discoveredHolder?.topPct || '?' });
        }
        const result = {};
        for (const [pat, data] of Object.entries(patterns)) {
            const avgPeak = data.peaks.length > 0 ? data.peaks.reduce((a, b) => a + b, 0) / data.peaks.length : 0;
            result[pat] = {
                total: data.total,
                avgPeakX: avgPeak.toFixed(2),
                twoXRate: data.total > 0 ? (data.twoX / data.total * 100).toFixed(1) + '%' : '0%',
                threeXRate: data.total > 0 ? (data.threeX / data.total * 100).toFixed(1) + '%' : '0%',
                rugRate: data.total > 0 ? (data.rugs / data.total * 100).toFixed(1) + '%' : '0%',
                best: data.tokens.sort((a, b) => parseFloat(b.peak) - parseFloat(a.peak))[0] || null,
                tokens: data.tokens,
            };
        }
        return result;
    }

    // ——— Public API ———
    return {
        open,
        STORES,
        // Generic
        put, get, getAll, remove, count, clear, putMany,
        // Tokens
        saveToken, saveTokens, getToken, getAllTokens, getTopTokens,
        // Trades
        saveTrade, saveTrades, getOpenTrades, getClosedTrades, getAllTrades,
        // Wallets
        saveWallet, saveWallets, getAlphaWallets, getAllWallets,
        // Alerts
        saveAlert, getRecentAlerts,
        // Scans
        saveScan, getRecentScans,
        // Clusters
        saveCluster, getClusters,
        // Settings
        setSetting, getSetting,
        // Stats
        getStats, getFullDump,
        // Outcomes — feedback loop
        saveOutcome, getAllOutcomes, getMultibaggers, getOutcomeStats,
        getHolderPatternAnalysis,
        // Batch persist
        persistSniperState, persistTradeState, persistClusterState,
        // Export / Restore / Cleanup
        exportAll, restoreAll, autoCleanup,
    };
})();
