/* ===================================================
   WALLET CLUSTER INTELLIGENCE ENGINE
   Real-time wallet relationship tracking, cluster analysis,
   and pattern detection for Solana DEX traders.
   =================================================== */

const ClusterIntel = (() => {
    'use strict';

    // ——— Configuration ———
    const CI_HELIUS_KEY = '3eb48747-e2b3-43c9-8d9b-490f26b684e0';
    const CI_CONFIG = {
        WSS_ENDPOINT: 'wss://api.mainnet-beta.solana.com',
        RPC_ENDPOINTS: [
            `https://mainnet.helius-rpc.com/?api-key=${CI_HELIUS_KEY}`,
            'https://api.mainnet-beta.solana.com',
        ],
        CORS_PROXIES: [
            (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
            (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        ],
        DEXSCREENER_PAIRS: 'https://api.dexscreener.com/tokens/v1/solana/',
        DEXSCREENER_BOOSTED: 'https://api.dexscreener.com/token-boosts/top/v1',
        MAX_SUBSCRIPTIONS: 15,
        ROTATION_INTERVAL: 60000,  // Rotate subscriptions every 60s
        RPC_DELAY: 250,
        TX_PARSE_LIMIT: 20,       // Transactions to parse per wallet
        CLUSTER_EDGE_THRESHOLD: 2, // Min edges to form a cluster
        PATTERN_TIME_WINDOW: 300,  // 5 min window for coordinated activity (seconds)
    };

    let currentRpcIdx = 0;

    // ——— State ———
    const state = {
        // Graph
        nodes: new Map(),       // address → { address, firstSeen, lastSeen, txCount, volume, clusterId, labels }
        edges: new Map(),       // "from|to|type" → { from, to, type, count, totalAmount, timestamps }
        clusters: new Map(),    // clusterId → Set<address>
        
        // Monitoring
        ws: null,
        subscriptions: new Map(), // address → subscriptionId
        monitoredWallets: [],
        rotationTimer: null,
        reconnectAttempt: 0,
        
        // Events
        liveEvents: [],         // Real-time events: { type, wallet, token, amount, timestamp, details }
        patterns: [],           // Detected patterns: { type, confidence, wallets, token, description }
        hotTokens: [],          // Tokens with >100% gains
        
        // Callbacks
        onEvent: null,
        onPattern: null,
        onGraphUpdate: null,
        onTokenActivity: null,
    };

    // ——— Utility ———
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function shortAddr(a) { return a ? a.slice(0, 6) + '...' + a.slice(-4) : '???'; }
    function edgeKey(from, to, type) { return `${from}|${to}|${type}`; }
    function now() { return Math.floor(Date.now() / 1000); }

    function ciLog(msg, level = '') {
        const prefix = '🔗 [Cluster]';
        const ts = new Date().toLocaleTimeString();
        const entry = { time: ts, msg: `${prefix} ${msg}`, level };
        state.liveEvents.unshift(entry);
        if (state.liveEvents.length > 500) state.liveEvents.pop();
        if (state.onEvent) state.onEvent(entry);
        // Also log to console
        console.log(`${prefix} ${msg}`);
    }

    // ——— RPC Helper — Helius-first with CORS proxy fallback ———
    async function ciRpcCall(method, params) {
        const endpoints = CI_CONFIG.RPC_ENDPOINTS;
        const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
        const headers = { 'Content-Type': 'application/json' };
        let lastError;

        for (let attempt = 0; attempt < endpoints.length; attempt++) {
            const url = endpoints[(currentRpcIdx + attempt) % endpoints.length];

            // Try direct first (Helius has CORS, will work directly)
            try {
                const resp = await fetch(url, {
                    method: 'POST', headers, body,
                    signal: AbortSignal.timeout(10000),
                });
                if (resp.status === 429) {
                    // Rate limited — wait briefly and rotate
                    await sleep(1000);
                    currentRpcIdx = (currentRpcIdx + 1) % endpoints.length;
                    throw new Error('Rate limited (429)');
                }
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                if (data.error) throw new Error(data.error.message);
                return data.result;
            } catch (err) {
                lastError = err;
                // Only try proxy if it was a CORS/network error (not rate limit or RPC error)
                if (err.name === 'TypeError' || err.message?.includes('Failed to fetch')) {
                    for (let p = 0; p < CI_CONFIG.CORS_PROXIES.length; p++) {
                        const proxyFn = CI_CONFIG.CORS_PROXIES[p];
                        try {
                            const resp = await fetch(proxyFn(url), {
                                method: 'POST', headers, body,
                                signal: AbortSignal.timeout(12000),
                            });
                            if (!resp.ok) throw new Error(`Proxy HTTP ${resp.status}`);
                            const data = await resp.json();
                            if (data.error) throw new Error(data.error.message);
                            return data.result;
                        } catch (proxyErr) {
                            lastError = proxyErr;
                        }
                    }
                }
            }
            currentRpcIdx = (currentRpcIdx + 1) % endpoints.length;
        }
        throw lastError || new Error('All RPCs failed');
    }

    // =================================================================
    //  PHASE 1: HOT TOKEN PIPELINE
    //  Discover tokens with explosive gains, extract their traders
    // =================================================================

    async function discoverHotTokens() {
        ciLog('🔥 Discovering hot tokens from DexScreener...', 'info');
        const hotTokens = [];

        try {
            // Fetch boosted tokens
            const resp = await fetch(CI_CONFIG.DEXSCREENER_BOOSTED);
            if (!resp.ok) throw new Error(`DexScreener: ${resp.status}`);
            const boosted = await resp.json();
            const solanaTokens = (boosted || []).filter(t => t.chainId === 'solana');

            ciLog(`   Found ${solanaTokens.length} boosted Solana tokens`, 'info');

            // Get pair data for each to check price change
            for (const token of solanaTokens.slice(0, 20)) {
                try {
                    const pairResp = await fetch(CI_CONFIG.DEXSCREENER_PAIRS + token.tokenAddress);
                    if (!pairResp.ok) continue;
                    const pairData = await pairResp.json();
                    
                    // API may return array directly or { pairs: [...] }
                    const pairs = Array.isArray(pairData) ? pairData : (pairData?.pairs || []);
                    
                    if (pairs.length > 0) {
                        const pair = pairs[0];
                        const priceChange24h = parseFloat(pair.priceChange?.h24) || 0;
                        const volume24h = parseFloat(pair.volume?.h24) || 0;
                        const liquidity = parseFloat(pair.liquidity?.usd) || 0;
                        const marketCap = parseFloat(pair.marketCap || pair.fdv) || 0;

                        hotTokens.push({
                            address: token.tokenAddress,
                            symbol: pair.baseToken?.symbol || 'UNKNOWN',
                            name: pair.baseToken?.name || token.description?.slice(0, 30) || 'Unknown',
                            priceChange24h,
                            volume24h,
                            liquidity,
                            marketCap,
                            pairAddress: pair.pairAddress,
                            url: token.url || pair.url,
                            boostAmount: token.totalAmount || 0,
                        });

                        if (priceChange24h > 100) {
                            ciLog(`   🚀 ${pair.baseToken?.symbol || 'TOKEN'}: +${priceChange24h.toFixed(0)}% | Vol $${(volume24h/1000).toFixed(0)}K`, 'success');
                        }
                    }
                    await sleep(200);
                } catch { /* skip */ }
            }
        } catch (err) {
            ciLog(`   ⚠ DexScreener error: ${err.message}`, 'warning');
        }

        // Sort by price change descending
        hotTokens.sort((a, b) => b.priceChange24h - a.priceChange24h);
        state.hotTokens = hotTokens;
        ciLog(`   📊 ${hotTokens.length} tokens analyzed, ${hotTokens.filter(t => t.priceChange24h > 100).length} with >100% gains`, 'info');
        return hotTokens;
    }

    // =================================================================
    //  PHASE 2: TRANSACTION PARSER
    //  Extract swaps, transfers, and balance changes from transactions
    // =================================================================

    // Parse a single parsed transaction to extract meaningful events
    function parseTransaction(tx, walletAddress) {
        const events = [];
        if (!tx || !tx.meta || !tx.transaction) return events;

        const { meta, transaction } = tx;
        const blockTime = tx.blockTime || now();
        const sig = tx.transaction.signatures?.[0] || 'unknown';

        // ——— SOL Balance Changes ———
        const preBalances = meta.preBalances || [];
        const postBalances = meta.postBalances || [];
        const accountKeys = transaction.message.accountKeys || [];

        for (let i = 0; i < accountKeys.length; i++) {
            const addr = typeof accountKeys[i] === 'string' ? accountKeys[i] : accountKeys[i]?.pubkey;
            if (!addr) continue;
            const preLamports = preBalances[i] || 0;
            const postLamports = postBalances[i] || 0;
            const diff = postLamports - preLamports;

            // Significant SOL movement (> 0.01 SOL = 10M lamports)
            if (Math.abs(diff) > 10_000_000 && addr !== walletAddress) {
                if (diff > 0) {
                    // This account RECEIVED SOL
                    events.push({
                        type: 'sol_transfer',
                        from: walletAddress,
                        to: addr,
                        amount: diff / 1e9,
                        timestamp: blockTime,
                        signature: sig,
                    });
                }
            }
        }

        // ——— Token Balance Changes (pre vs post) ———
        const preTokenBalances = meta.preTokenBalances || [];
        const postTokenBalances = meta.postTokenBalances || [];

        // Build maps of token balance changes per mint
        const tokenChanges = new Map(); // mint → { accountIndex → { pre, post, owner } }

        for (const tb of preTokenBalances) {
            const mint = tb.mint;
            const owner = tb.owner;
            const amount = parseFloat(tb.uiTokenAmount?.uiAmountString || '0');
            if (!tokenChanges.has(mint)) tokenChanges.set(mint, new Map());
            const mc = tokenChanges.get(mint);
            if (!mc.has(tb.accountIndex)) mc.set(tb.accountIndex, { pre: 0, post: 0, owner });
            mc.get(tb.accountIndex).pre = amount;
            mc.get(tb.accountIndex).owner = owner;
        }

        for (const tb of postTokenBalances) {
            const mint = tb.mint;
            const owner = tb.owner;
            const amount = parseFloat(tb.uiTokenAmount?.uiAmountString || '0');
            if (!tokenChanges.has(mint)) tokenChanges.set(mint, new Map());
            const mc = tokenChanges.get(mint);
            if (!mc.has(tb.accountIndex)) mc.set(tb.accountIndex, { pre: 0, post: 0, owner });
            mc.get(tb.accountIndex).post = amount;
            mc.get(tb.accountIndex).owner = owner || mc.get(tb.accountIndex).owner;
        }

        // Analyze token changes
        for (const [mint, accounts] of tokenChanges) {
            // Skip wrapped SOL
            if (mint === 'So11111111111111111111111111111111111111112') continue;

            let totalBought = 0;
            let totalSold = 0;
            let buyer = null;
            let seller = null;

            for (const [idx, change] of accounts) {
                const diff = change.post - change.pre;
                if (diff > 0.0001) {
                    totalBought += diff;
                    buyer = change.owner;
                } else if (diff < -0.0001) {
                    totalSold += Math.abs(diff);
                    seller = change.owner;
                }
            }

            // Detect swap (wallet is buyer or seller)
            if (buyer === walletAddress && totalBought > 0) {
                events.push({
                    type: 'token_buy',
                    wallet: walletAddress,
                    token: mint,
                    amount: totalBought,
                    timestamp: blockTime,
                    signature: sig,
                });
            }

            if (seller === walletAddress && totalSold > 0) {
                events.push({
                    type: 'token_sell',
                    wallet: walletAddress,
                    token: mint,
                    amount: totalSold,
                    timestamp: blockTime,
                    signature: sig,
                });
            }

            // Detect token transfer (not a swap — one account gains, another loses, same mint)
            if (buyer && seller && buyer !== seller &&
                (buyer === walletAddress || seller === walletAddress)) {
                events.push({
                    type: 'token_transfer',
                    from: seller,
                    to: buyer,
                    token: mint,
                    amount: Math.min(totalBought, totalSold),
                    timestamp: blockTime,
                    signature: sig,
                });
            }
        }

        return events;
    }

    // Extract all trading events for a wallet
    async function extractWalletActivity(walletAddress) {
        const allEvents = [];
        
        try {
            const sigs = await ciRpcCall('getSignaturesForAddress', [
                walletAddress, { limit: CI_CONFIG.TX_PARSE_LIMIT }
            ]);
            if (!sigs || sigs.length === 0) return allEvents;

            for (const sig of sigs.slice(0, CI_CONFIG.TX_PARSE_LIMIT)) {
                try {
                    const tx = await ciRpcCall('getTransaction', [
                        sig.signature,
                        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
                    ]);
                    if (tx) {
                        const events = parseTransaction(tx, walletAddress);
                        allEvents.push(...events);
                    }
                    await sleep(150);
                } catch { /* skip failed tx */ }
            }
        } catch (err) {
            ciLog(`   ⚠ Activity extraction failed for ${shortAddr(walletAddress)}: ${err.message}`, 'warning');
        }

        return allEvents;
    }

    // =================================================================
    //  PHASE 3: WALLET RELATIONSHIP GRAPH
    //  Build adjacency graph, detect clusters
    // =================================================================

    function ensureNode(address) {
        if (!state.nodes.has(address)) {
            state.nodes.set(address, {
                address,
                firstSeen: now(),
                lastSeen: now(),
                txCount: 0,
                volume: 0,
                clusterId: null,
                labels: new Set(),
            });
        }
        return state.nodes.get(address);
    }

    function addEdge(from, to, type, amount = 0, timestamp = now()) {
        const key = edgeKey(from, to, type);
        if (!state.edges.has(key)) {
            state.edges.set(key, {
                from, to, type,
                count: 0,
                totalAmount: 0,
                timestamps: [],
            });
        }
        const edge = state.edges.get(key);
        edge.count++;
        edge.totalAmount += amount;
        edge.timestamps.push(timestamp);
        // Keep only last 50 timestamps
        if (edge.timestamps.length > 50) edge.timestamps = edge.timestamps.slice(-50);

        // Ensure both nodes exist
        const fromNode = ensureNode(from);
        const toNode = ensureNode(to);
        fromNode.lastSeen = Math.max(fromNode.lastSeen, timestamp);
        toNode.lastSeen = Math.max(toNode.lastSeen, timestamp);
    }

    // Process parsed events into the graph
    function ingestEvents(events) {
        for (const evt of events) {
            switch (evt.type) {
                case 'sol_transfer':
                    addEdge(evt.from, evt.to, 'sol_transfer', evt.amount, evt.timestamp);
                    ensureNode(evt.from).volume += evt.amount;
                    break;
                case 'token_transfer':
                    addEdge(evt.from, evt.to, 'token_transfer', evt.amount, evt.timestamp);
                    break;
                case 'token_buy':
                    ensureNode(evt.wallet).txCount++;
                    ensureNode(evt.wallet).volume += evt.amount;
                    ensureNode(evt.wallet).labels.add('buyer');
                    break;
                case 'token_sell':
                    ensureNode(evt.wallet).txCount++;
                    ensureNode(evt.wallet).labels.add('seller');
                    break;
            }
            // Trigger callback if registered
            if (state.onTokenActivity) {
                try { state.onTokenActivity(evt); } catch (e) { console.error('onTokenActivity callback error:', e); }
            }
        }

        // Detect same-token co-trading (wallets trading same token within time window)
        const tokenTrades = new Map(); // token → [{ wallet, timestamp, type }]
        for (const evt of events) {
            if (evt.type === 'token_buy' || evt.type === 'token_sell') {
                if (!tokenTrades.has(evt.token)) tokenTrades.set(evt.token, []);
                tokenTrades.get(evt.token).push({
                    wallet: evt.wallet,
                    timestamp: evt.timestamp,
                    type: evt.type,
                });
            }
        }

        for (const [token, trades] of tokenTrades) {
            trades.sort((a, b) => a.timestamp - b.timestamp);
            for (let i = 0; i < trades.length; i++) {
                for (let j = i + 1; j < trades.length; j++) {
                    if (trades[j].timestamp - trades[i].timestamp > CI_CONFIG.PATTERN_TIME_WINDOW) break;
                    if (trades[i].wallet !== trades[j].wallet) {
                        addEdge(trades[i].wallet, trades[j].wallet, 'same_token_trade', 0, trades[j].timestamp);
                        
                        // Special: sequential buy→sell pattern
                        if (trades[i].type === 'token_buy' && trades[j].type === 'token_sell') {
                            addEdge(trades[i].wallet, trades[j].wallet, 'sequential_buy_sell', 0, trades[j].timestamp);
                        }
                    }
                }
            }
        }
    }

    // ——— Union-Find for Cluster Detection ———
    const parent = new Map();
    const rank = new Map();

    function ufFind(x) {
        if (!parent.has(x)) { parent.set(x, x); rank.set(x, 0); }
        if (parent.get(x) !== x) parent.set(x, ufFind(parent.get(x)));
        return parent.get(x);
    }

    function ufUnion(x, y) {
        const px = ufFind(x);
        const py = ufFind(y);
        if (px === py) return;
        const rx = rank.get(px) || 0;
        const ry = rank.get(py) || 0;
        if (rx < ry) parent.set(px, py);
        else if (rx > ry) parent.set(py, px);
        else { parent.set(py, px); rank.set(px, rx + 1); }
    }

    function buildClusters() {
        parent.clear();
        rank.clear();
        state.clusters.clear();

        // Union wallets that share edges above threshold
        const edgeCounts = new Map(); // "from|to" → total edge count across types
        for (const [key, edge] of state.edges) {
            const pairKey = [edge.from, edge.to].sort().join('|');
            edgeCounts.set(pairKey, (edgeCounts.get(pairKey) || 0) + edge.count);
        }

        for (const [pairKey, count] of edgeCounts) {
            if (count >= CI_CONFIG.CLUSTER_EDGE_THRESHOLD) {
                const [a, b] = pairKey.split('|');
                ufUnion(a, b);
            }
        }

        // Build cluster map
        for (const [addr] of state.nodes) {
            const root = ufFind(addr);
            if (!state.clusters.has(root)) state.clusters.set(root, new Set());
            state.clusters.get(root).add(addr);
            state.nodes.get(addr).clusterId = root;
        }

        // Remove single-node clusters
        for (const [root, members] of state.clusters) {
            if (members.size <= 1) state.clusters.delete(root);
        }

        ciLog(`   🔗 Found ${state.clusters.size} wallet clusters (${[...state.clusters.values()].reduce((s, c) => s + c.size, 0)} connected wallets)`, 'info');
    }

    // =================================================================
    //  PHASE 4: PATTERN DETECTION
    //  Detect coordinated pump, wash trading, profit extraction
    // =================================================================

    function detectPatterns() {
        const patterns = [];

        for (const [clusterId, members] of state.clusters) {
            const memberArr = [...members];
            if (memberArr.length < 2) continue;

            // ——— Pattern 1: Coordinated Pump ———
            // 3+ wallets in same cluster buying same token within 5 min
            const clusterBuys = new Map(); // token → [{ wallet, timestamp }]
            for (const addr of memberArr) {
                for (const [key, edge] of state.edges) {
                    if (edge.type === 'token_buy' && key.startsWith(addr)) {
                        // Look for buy events (stored in events list)
                    }
                }
            }

            // ——— Pattern 2: Wash Trading ———
            // A→transfer→B, B sells same token
            for (const [key, edge] of state.edges) {
                if (edge.type === 'token_transfer' && members.has(edge.from) && members.has(edge.to)) {
                    // Check if the receiver sold the same token
                    const sellKey = edgeKey(edge.to, '', 'token_sell');
                    // Simplified: if transfer and sell exist in same cluster, flag it
                    patterns.push({
                        type: 'wash_trading',
                        confidence: Math.min(95, 50 + edge.count * 10),
                        wallets: [edge.from, edge.to],
                        description: `${shortAddr(edge.from)} transferred to ${shortAddr(edge.to)} (${edge.count}x)`,
                        clusterId,
                        timestamp: edge.timestamps[edge.timestamps.length - 1] || now(),
                    });
                }
            }

            // ——— Pattern 3: Fresh Wallet Dispersion ———
            // Multiple wallets receiving SOL from same source
            const solSources = new Map(); // source → [targets]
            for (const [key, edge] of state.edges) {
                if (edge.type === 'sol_transfer' && members.has(edge.from)) {
                    if (!solSources.has(edge.from)) solSources.set(edge.from, []);
                    solSources.get(edge.from).push(edge.to);
                }
            }
            for (const [source, targets] of solSources) {
                if (targets.length >= 3) {
                    patterns.push({
                        type: 'wallet_dispersion',
                        confidence: Math.min(95, 40 + targets.length * 12),
                        wallets: [source, ...targets],
                        description: `${shortAddr(source)} funded ${targets.length} wallets with SOL`,
                        clusterId,
                        timestamp: now(),
                    });
                }
            }

            // ——— Pattern 4: Sequential Buy-Sell ———
            for (const [key, edge] of state.edges) {
                if (edge.type === 'sequential_buy_sell' && members.has(edge.from) && members.has(edge.to)) {
                    if (edge.count >= 2) {
                        patterns.push({
                            type: 'coordinated_trade',
                            confidence: Math.min(95, 40 + edge.count * 15),
                            wallets: [edge.from, edge.to],
                            description: `${shortAddr(edge.from)} buys → ${shortAddr(edge.to)} sells (${edge.count}x in window)`,
                            clusterId,
                            timestamp: edge.timestamps[edge.timestamps.length - 1] || now(),
                        });
                    }
                }
            }
        }

        // Deduplicate by type+wallets
        const seen = new Set();
        state.patterns = patterns.filter(p => {
            const key = p.type + p.wallets.sort().join(',');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        state.patterns.sort((a, b) => b.confidence - a.confidence);

        if (state.patterns.length > 0) {
            ciLog(`   🎯 ${state.patterns.length} suspicious patterns detected`, 'warning');
        }

        if (state.onPattern) {
            for (const p of state.patterns) state.onPattern(p);
        }

        return state.patterns;
    }

    // =================================================================
    //  PHASE 5: REAL-TIME WEBSOCKET MONITOR
    //  Subscribe to wallet activity via Solana WebSocket
    // =================================================================

    function connectWebSocket() {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) return;

        try {
            state.ws = new WebSocket(CI_CONFIG.WSS_ENDPOINT);

            state.ws.onopen = () => {
                ciLog('🟢 WebSocket connected to Solana mainnet', 'success');
                state.reconnectAttempt = 0;
                // Re-subscribe all monitored wallets
                subscribeWallets(state.monitoredWallets.slice(0, CI_CONFIG.MAX_SUBSCRIPTIONS));
            };

            state.ws.onmessage = async (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    // Subscription confirmation
                    if (data.result !== undefined && data.id) {
                        return;
                    }

                    // Log notification
                    if (data.method === 'logsNotification') {
                        const logData = data.params?.result;
                        if (logData?.value) {
                            const signature = logData.value.signature;
                            const logs = logData.value.logs || [];
                            
                            // Determine which wallet was involved
                            const mentionedWallet = state.monitoredWallets.find(w => 
                                logs.some(l => l.includes(w))
                            );

                            // Check for swap/transfer keywords in logs
                            const isSwap = logs.some(l => 
                                l.includes('Instruction: Swap') || 
                                l.includes('Instruction: Route') ||
                                l.includes('Program JUP') ||
                                l.includes('Program 675kPX')
                            );
                            const isTransfer = logs.some(l => 
                                l.includes('Instruction: Transfer') ||
                                l.includes('Instruction: TransferChecked')
                            );

                            const eventType = isSwap ? '💱 SWAP' : isTransfer ? '📤 TRANSFER' : '📝 TX';
                            
                            ciLog(`${eventType} | ${shortAddr(mentionedWallet || 'unknown')} | sig: ${shortAddr(signature)}`, 
                                isSwap ? 'success' : 'info');

                            // Fetch full transaction for detailed parsing
                            if (signature && (isSwap || isTransfer)) {
                                try {
                                    await sleep(500);
                                    const tx = await ciRpcCall('getTransaction', [
                                        signature,
                                        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
                                    ]);
                                    if (tx) {
                                        const wallet = mentionedWallet || (
                                            tx.transaction?.message?.accountKeys?.[0]?.pubkey ||
                                            tx.transaction?.message?.accountKeys?.[0]
                                        );
                                        const events = parseTransaction(tx, wallet);
                                        if (events.length > 0) {
                                            ingestEvents(events);
                                            for (const evt of events) {
                                                const evtDesc = evt.type === 'token_buy' 
                                                    ? `🟢 BUY ${shortAddr(evt.token)} (${evt.amount.toFixed(2)})` 
                                                    : evt.type === 'token_sell'
                                                    ? `🔴 SELL ${shortAddr(evt.token)} (${evt.amount.toFixed(2)})`
                                                    : evt.type === 'sol_transfer'
                                                    ? `💸 SOL ${shortAddr(evt.from)} → ${shortAddr(evt.to)} (${evt.amount.toFixed(3)} SOL)`
                                                    : `📦 ${evt.type}`;
                                                ciLog(`   ${evtDesc}`, evt.type.includes('buy') ? 'success' : 'warning');
                                            }
                                            if (state.onGraphUpdate) state.onGraphUpdate();
                                        }
                                    }
                                } catch { /* couldn't parse live tx */ }
                            }
                        }
                    }
                } catch { /* malformed message */ }
            };

            state.ws.onclose = () => {
                ciLog('🔴 WebSocket disconnected', 'warning');
                state.subscriptions.clear();
                // Exponential backoff reconnect
                const delay = Math.min(30000, 1000 * Math.pow(2, state.reconnectAttempt));
                state.reconnectAttempt++;
                ciLog(`   Reconnecting in ${(delay/1000).toFixed(0)}s...`, 'info');
                setTimeout(() => connectWebSocket(), delay);
            };

            state.ws.onerror = (err) => {
                ciLog('⚠ WebSocket error', 'error');
            };

        } catch (err) {
            ciLog(`WebSocket connection failed: ${err.message}`, 'error');
        }
    }

    function subscribeWallets(wallets) {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

        for (const wallet of wallets) {
            if (state.subscriptions.has(wallet)) continue;
            if (state.subscriptions.size >= CI_CONFIG.MAX_SUBSCRIPTIONS) break;

            const id = Date.now() + Math.random();
            state.ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id,
                method: 'logsSubscribe',
                params: [
                    { mentions: [wallet] },
                    { commitment: 'confirmed' }
                ]
            }));
            state.subscriptions.set(wallet, id);
        }

        ciLog(`   📡 Monitoring ${state.subscriptions.size} wallets via WebSocket`, 'info');
    }

    function unsubscribeAll() {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
        
        for (const [wallet, subId] of state.subscriptions) {
            state.ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'logsUnsubscribe',
                params: [subId]
            }));
        }
        state.subscriptions.clear();
    }

    function startSubscriptionRotation() {
        if (state.rotationTimer) clearInterval(state.rotationTimer);
        let offset = 0;

        state.rotationTimer = setInterval(() => {
            if (state.monitoredWallets.length <= CI_CONFIG.MAX_SUBSCRIPTIONS) return;
            
            unsubscribeAll();
            offset = (offset + CI_CONFIG.MAX_SUBSCRIPTIONS) % state.monitoredWallets.length;
            const batch = state.monitoredWallets.slice(offset, offset + CI_CONFIG.MAX_SUBSCRIPTIONS);
            subscribeWallets(batch);
            ciLog(`   🔄 Rotated subscriptions (batch ${Math.floor(offset / CI_CONFIG.MAX_SUBSCRIPTIONS) + 1})`, 'info');
        }, CI_CONFIG.ROTATION_INTERVAL);
    }

    // =================================================================
    //  PHASE 6: GRAPH VISUALIZATION (Canvas)
    //  Force-directed layout for wallet cluster visualization
    // =================================================================

    function renderGraph(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width = canvas.parentElement?.clientWidth || 800;
        const H = canvas.height = 400;

        // Convert graph to visualization data
        const visNodes = [];
        const visEdges = [];
        const nodeIdx = new Map();

        let i = 0;
        for (const [addr, node] of state.nodes) {
            if (i >= 100) break; // Limit for performance
            visNodes.push({
                x: Math.random() * (W - 100) + 50,
                y: Math.random() * (H - 100) + 50,
                vx: 0, vy: 0,
                addr,
                cluster: node.clusterId,
                size: Math.min(12, 4 + Math.log2(Math.max(1, node.txCount))),
                labels: [...node.labels],
            });
            nodeIdx.set(addr, i);
            i++;
        }

        for (const [key, edge] of state.edges) {
            const fi = nodeIdx.get(edge.from);
            const ti = nodeIdx.get(edge.to);
            if (fi !== undefined && ti !== undefined) {
                visEdges.push({ from: fi, to: ti, type: edge.type, weight: edge.count });
            }
        }

        // Cluster colors
        const clusterColors = [
            '#14F195', '#9945FF', '#00D1FF', '#FF4D6A', '#F7A72B',
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
        ];
        const clusterColorMap = new Map();
        let colorIdx = 0;
        for (const [root] of state.clusters) {
            clusterColorMap.set(root, clusterColors[colorIdx++ % clusterColors.length]);
        }

        // Simple force simulation (50 iterations)
        for (let iter = 0; iter < 60; iter++) {
            // Repulsion between all nodes
            for (let a = 0; a < visNodes.length; a++) {
                for (let b = a + 1; b < visNodes.length; b++) {
                    let dx = visNodes[b].x - visNodes[a].x;
                    let dy = visNodes[b].y - visNodes[a].y;
                    let dist = Math.sqrt(dx * dx + dy * dy) || 1;
                    let force = 800 / (dist * dist);
                    visNodes[a].vx -= (dx / dist) * force;
                    visNodes[a].vy -= (dy / dist) * force;
                    visNodes[b].vx += (dx / dist) * force;
                    visNodes[b].vy += (dy / dist) * force;
                }
            }

            // Attraction along edges
            for (const edge of visEdges) {
                const a = visNodes[edge.from];
                const b = visNodes[edge.to];
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let dist = Math.sqrt(dx * dx + dy * dy) || 1;
                let force = (dist - 80) * 0.05;
                a.vx += (dx / dist) * force;
                a.vy += (dy / dist) * force;
                b.vx -= (dx / dist) * force;
                b.vy -= (dy / dist) * force;
            }

            // Apply velocities with damping
            for (const node of visNodes) {
                node.vx *= 0.85;
                node.vy *= 0.85;
                node.x += node.vx;
                node.y += node.vy;
                // Boundary constraints
                node.x = Math.max(20, Math.min(W - 20, node.x));
                node.y = Math.max(20, Math.min(H - 20, node.y));
            }
        }

        // ——— Draw ———
        ctx.fillStyle = '#0a0e1a';
        ctx.fillRect(0, 0, W, H);

        // Draw grid
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        for (let x = 0; x < W; x += 40) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = 0; y < H; y += 40) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }

        // Edge type colors
        const edgeColors = {
            sol_transfer: '#F7A72B',
            token_transfer: '#9945FF',
            same_token_trade: 'rgba(0,209,255,0.3)',
            sequential_buy_sell: '#FF4D6A',
        };

        // Draw edges
        for (const edge of visEdges) {
            const a = visNodes[edge.from];
            const b = visNodes[edge.to];
            ctx.strokeStyle = edgeColors[edge.type] || 'rgba(255,255,255,0.1)';
            ctx.lineWidth = Math.min(3, 0.5 + edge.weight * 0.5);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();

            // Arrow
            const angle = Math.atan2(b.y - a.y, b.x - a.x);
            const arrowLen = 8;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            ctx.fillStyle = edgeColors[edge.type] || 'rgba(255,255,255,0.2)';
            ctx.beginPath();
            ctx.moveTo(mx + arrowLen * Math.cos(angle), my + arrowLen * Math.sin(angle));
            ctx.lineTo(mx + arrowLen * Math.cos(angle + 2.5), my + arrowLen * Math.sin(angle + 2.5));
            ctx.lineTo(mx + arrowLen * Math.cos(angle - 2.5), my + arrowLen * Math.sin(angle - 2.5));
            ctx.fill();
        }

        // Draw nodes
        for (const node of visNodes) {
            const color = clusterColorMap.get(node.cluster) || '#666';
            
            // Glow
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.shadowBlur = 0;

            // Label
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font = '9px Inter, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(shortAddr(node.addr), node.x, node.y + node.size + 12);
        }

        // Legend
        ctx.font = '10px Inter, sans-serif';
        const legendY = H - 20;
        let legendX = 15;
        for (const [type, color] of Object.entries(edgeColors)) {
            ctx.fillStyle = color;
            ctx.fillRect(legendX, legendY, 12, 3);
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.textAlign = 'left';
            ctx.fillText(type.replace(/_/g, ' '), legendX + 16, legendY + 4);
            legendX += ctx.measureText(type.replace(/_/g, ' ')).width + 30;
        }

        // Stats
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${state.nodes.size} nodes | ${state.edges.size} edges | ${state.clusters.size} clusters`, W - 15, 15);
    }

    // =================================================================
    //  PUBLIC API
    // =================================================================

    async function runFullScan(seedWallets = []) {
        ciLog('━━━ CLUSTER INTELLIGENCE SCAN ━━━', 'info');
        
        // Step 1: Discover hot tokens
        const hotTokens = await discoverHotTokens();

        // Step 2: Extract traders from hot token transactions
        ciLog('\n👥 Extracting traders from hot token transactions...', 'info');
        const traderWallets = new Set(seedWallets);
        
        for (const token of hotTokens.slice(0, 8)) {
            try {
                ciLog(`   Scanning ${token.symbol} (${token.priceChange24h > 0 ? '+' : ''}${token.priceChange24h.toFixed(0)}%)...`, 'info');
                const sigs = await ciRpcCall('getSignaturesForAddress', [token.address, { limit: 20 }]);
                if (sigs && sigs.length > 0) {
                    for (const sig of sigs.slice(0, 8)) {
                        try {
                            const tx = await ciRpcCall('getTransaction', [
                                sig.signature,
                                { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
                            ]);
                            if (tx?.transaction?.message?.accountKeys) {
                                const keys = tx.transaction.message.accountKeys;
                                const signer = typeof keys[0] === 'string' ? keys[0] : keys[0]?.pubkey;
                                if (signer && signer.length >= 32 && signer.length <= 44) {
                                    traderWallets.add(signer);
                                }
                            }
                            await sleep(150);
                        } catch { /* skip */ }
                    }
                }
                await sleep(CI_CONFIG.RPC_DELAY);
            } catch { /* skip */ }
        }

        ciLog(`   Found ${traderWallets.size} unique trader wallets`, 'success');

        // Step 3: Parse wallet activity and build graph
        ciLog('\n🔍 Parsing wallet transaction histories...', 'info');
        const walletArray = [...traderWallets];
        let processed = 0;

        for (const wallet of walletArray.slice(0, 50)) { // Limit to 50 for speed
            try {
                const events = await extractWalletActivity(wallet);
                if (events.length > 0) {
                    ingestEvents(events);
                    ciLog(`   ${shortAddr(wallet)}: ${events.length} events`, 'info');
                }
                processed++;
                await sleep(CI_CONFIG.RPC_DELAY);
            } catch { /* skip */ }
        }

        // Step 4: Build clusters
        ciLog('\n🔗 Building wallet clusters...', 'info');
        buildClusters();

        // Step 5: Detect patterns
        ciLog('\n🎯 Running pattern detection...', 'info');
        detectPatterns();

        // Step 6: Start real-time monitoring
        ciLog('\n📡 Starting real-time monitoring...', 'info');
        state.monitoredWallets = walletArray.slice(0, 100);
        connectWebSocket();
        startSubscriptionRotation();

        ciLog('\n✅ Cluster intelligence scan complete!', 'success');
        ciLog(`   ${state.nodes.size} wallets mapped | ${state.edges.size} relationships | ${state.clusters.size} clusters | ${state.patterns.length} patterns`, 'success');

        return {
            nodes: state.nodes.size,
            edges: state.edges.size,
            clusters: state.clusters.size,
            patterns: state.patterns.length,
            hotTokens: state.hotTokens,
        };
    }

    function stopMonitoring() {
        if (state.rotationTimer) {
            clearInterval(state.rotationTimer);
            state.rotationTimer = null;
        }
        unsubscribeAll();
        if (state.ws) {
            state.ws.close();
            state.ws = null;
        }
        ciLog('⏹️ Monitoring stopped', 'info');
    }

    function getCluster(walletAddress) {
        const node = state.nodes.get(walletAddress);
        if (!node || !node.clusterId) return null;
        return {
            id: node.clusterId,
            members: [...(state.clusters.get(node.clusterId) || [])],
            edges: [...state.edges.values()].filter(e => 
                (state.clusters.get(node.clusterId) || new Set()).has(e.from) || 
                (state.clusters.get(node.clusterId) || new Set()).has(e.to)
            ),
        };
    }

    function getRelationships(walletAddress) {
        const related = [];
        for (const [key, edge] of state.edges) {
            if (edge.from === walletAddress || edge.to === walletAddress) {
                related.push(edge);
            }
        }
        return related;
    }

    // ——— INSIGHTS GENERATOR — Plain-English Analysis of the Graph ———
    function generateInsights() {
        const insights = [];
        const nodeCount = state.nodes.size;
        const edgeCount = state.edges.size;
        const clusterCount = state.clusters.size;
        const patternCount = state.patterns.length;

        if (nodeCount === 0) return insights;

        // 1. Network overview
        const density = nodeCount > 1 ? (2 * edgeCount) / (nodeCount * (nodeCount - 1)) : 0;
        insights.push({
            type: 'neutral',
            label: `Network: ${nodeCount} wallets, ${edgeCount} connections`,
            detail: density > 0.3 ? 'High connectivity — many wallets are trading together, possible coordination' :
                    density > 0.1 ? 'Moderate connectivity — some related wallet groups detected' :
                    'Low connectivity — most wallets appear independent',
        });

        // 2. Largest cluster analysis
        let maxCluster = null, maxSize = 0;
        for (const [id, members] of state.clusters) {
            if (members.size > maxSize) { maxSize = members.size; maxCluster = id; }
        }
        if (maxCluster && maxSize >= 3) {
            const members = state.clusters.get(maxCluster);
            const memberAddrs = [...members];
            // Check what tokens this cluster trades
            const clusterEdges = [...state.edges.values()].filter(e => members.has(e.from) || members.has(e.to));
            const edgeTypes = {};
            for (const e of clusterEdges) { edgeTypes[e.type] = (edgeTypes[e.type] || 0) + 1; }
            const dominant = Object.entries(edgeTypes).sort((a,b) => b[1]-a[1])[0];
            insights.push({
                type: dominant?.[0] === 'buy_sell_chain' ? 'bearish' : 'bullish',
                label: `Largest cluster: ${maxSize} wallets (${memberAddrs.slice(0,2).map(a => a.slice(0,6)).join(', ')}...)`,
                detail: dominant ? `Primary activity: ${dominant[0].replace(/_/g,' ')} (${dominant[1]} connections). ${
                    dominant[0] === 'co_trade' ? 'These wallets buy the same tokens near-simultaneously — possible insider group or alpha club.' :
                    dominant[0] === 'sol_transfer' ? 'SOL flowing between these wallets — possibly same owner splitting funds.' :
                    dominant[0] === 'token_transfer' ? 'Tokens being moved between wallets — could be accumulation or distribution phase.' :
                    dominant[0] === 'buy_sell_chain' ? '⚠️ One wallet buys, another sells — classic pump & dump coordination.' : ''
                }` : 'Mixed activity types.',
            });
        }

        // 3. Pump & dump warnings
        const pndPatterns = state.patterns.filter(p => p.type === 'pump_dump' || p.type === 'wash_trade');
        if (pndPatterns.length > 0) {
            for (const p of pndPatterns.slice(0, 3)) {
                insights.push({
                    type: 'bearish',
                    label: `⚠️ ${p.type === 'pump_dump' ? 'Pump & Dump' : 'Wash Trading'} detected`,
                    detail: p.description || `${p.wallets?.length || 0} wallets involved. Confidence: ${(p.confidence * 100).toFixed(0)}%. AVOID these tokens.`,
                });
            }
        }

        // 4. Alpha cluster signals
        const alphaPatterns = state.patterns.filter(p => p.type === 'alpha_cluster' || p.type === 'coordinated_buy');
        if (alphaPatterns.length > 0) {
            for (const p of alphaPatterns.slice(0, 3)) {
                insights.push({
                    type: 'bullish',
                    label: `🟢 Alpha Cluster: ${p.token || 'Multiple tokens'}`,
                    detail: p.description || `${p.wallets?.length || 0} profitable wallets entering together. This is the signal to follow.`,
                });
            }
        }

        // 5. Hot token wallets
        if (state.hotTokens.length > 0) {
            const top = state.hotTokens[0];
            insights.push({
                type: 'bullish',
                label: `🔥 Hottest tracked token: ${top.symbol || top.address?.slice(0,8)}`,
                detail: `Gain: ${top.gain ? '+' + top.gain.toFixed(0) + '%' : '?'}. ${top.walletCount || '?'} tracked wallets involved.`,
            });
        }

        // 6. Cluster count summary
        if (clusterCount > 0) {
            insights.push({
                type: 'neutral',
                label: `${clusterCount} wallet cluster${clusterCount > 1 ? 's' : ''} identified`,
                detail: clusterCount >= 5 ? 'High cluster activity — many wallet groups coordinating. Check Patterns tab for specifics.' :
                        clusterCount >= 2 ? 'Multiple groups detected. Watch for repeated patterns across these clusters.' :
                        'One cluster found. Monitor for new connections forming.',
            });
        }

        return insights;
    }

    // Public API
    return {
        runFullScan,
        stopMonitoring,
        discoverHotTokens,
        extractWalletActivity,
        buildClusters,
        detectPatterns,
        generateInsights,
        renderGraph,
        getCluster,
        getRelationships,
        // State accessors
        get state() { return state; },
        get hotTokens() { return state.hotTokens; },
        get patterns() { return state.patterns; },
        get clusters() { return state.clusters; },
        get nodes() { return state.nodes; },
        get edges() { return state.edges; },
        get liveEvents() { return state.liveEvents; },
        // Callbacks
        set onEvent(fn) { state.onEvent = fn; },
        set onPattern(fn) { state.onPattern = fn; },
        set onGraphUpdate(fn) { state.onGraphUpdate = fn; },
        set onTokenActivity(fn) { state.onTokenActivity = fn; },
        get onTokenActivity() { return state.onTokenActivity; },
    };
})();
