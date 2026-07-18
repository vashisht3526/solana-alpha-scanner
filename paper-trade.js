/* ===================================================
   COPY TRADING ENGINE — Real Token Paper Trading
   Auto-follows sniper signals + alpha wallet moves.
   Uses REAL prices from DexScreener. Virtual balance.
   NO real trades. NO private keys. NO real money.
   Modes: Manual, Auto-Follow Sniper, Copy Wallet
   =================================================== */

const PaperTrader = (() => {
    'use strict';

    // ——— Default Risk Configuration ———
    const DEFAULT_CONFIG = {
        startingBalance: 100,         // SOL
        maxPositionPct: 5,            // % of portfolio per trade
        maxConcurrentPositions: 3,
        stopLossPct: -25,             // auto-exit at -25%
        takeProfitPct: 50,            // auto-exit half at +50%
        maxDailyLossPct: -10,         // pause trading if daily loss exceeds 10%
        cooldownMs: 30000,            // 30s between trades
        entryDelayMs: [2000, 5000],   // wait 2-5s after whale buy
        slippageRange: [0.5, 3],      // 0.5-3% simulated slippage
        latencyRange: [200, 800],     // 200-800ms simulated latency
        minTokenAgeSec: 300,          // don't trade tokens < 5 min old
        minLiquidityUsd: 15000,       // minimum $15k liquidity
        maxSimultaneousCopies: 3,     // max wallets buying same token at once
        maxCopiers: 100,              // ignore wallet if followed by >100 copiers
        liquidityDropExitPct: 50,     // auto-exit if liquidity drops 50%
        maxPositionsPerToken: 2,      // max 2 positions per token
        whaleShadowExit: true,        // auto-exit when whale sells
        minWhaleSellSizeUsd: 100,     // min size of sell to trigger exit (prevent noise)
        // v2.0 Exit Engine
        timeDecayMinutes: 15,         // auto-exit if no +20% gain within 15 min
        maxHoldMinutes: 240,          // max 4 hour hold for organic plays
        insiderMaxHoldMinutes: 45,    // max 45 min hold for insider-flagged plays
        trailingStopATRMult: 2.5,     // trailing stop = highest price - (2.5 * ATR)
        profitLadder: [               // sell 25% at each tier
            { pct: 50, sellFraction: 0.25, trailSL: 20 },
            { pct: 150, sellFraction: 0.25, trailSL: 80 },
            { pct: 300, sellFraction: 0.25, trailSL: 200 },
        ],
        breakevenTriggerPct: 30,      // move SL to breakeven at +30%
        minScoreForEntry: 60,         // minimum sniper score to enter
    };

    // ——— State ———
    let config = { ...DEFAULT_CONFIG };
    let portfolio = {
        balance: config.startingBalance,
        startingBalance: config.startingBalance,
        positions: [],      // active positions
        history: [],        // closed trades
        dailyPnl: 0,
        dailyLossHit: false,
        totalRealizedPnl: 0,
        tradeCount: 0,
        winCount: 0,
        lastTradeTime: 0,
        isPaused: false,
        isRunning: false,
        followedWallets: [], // wallet addresses being copied
    };

    let priceSimIntervals = [];
    let renderCallback = null;
    let realTokenCache = [];       // Cache of real trending tokens from DexScreener
    let tokenCacheTime = 0;
    const DEXSCREENER_PAIRS = 'https://api.dexscreener.com/tokens/v1/solana/';
    const DEXSCREENER_BOOSTED = 'https://api.dexscreener.com/token-boosts/top/v1';

    // ——— Utility ———
    function rand(min, max) {
        return Math.random() * (max - min) + min;
    }

    function randInt(min, max) {
        return Math.floor(rand(min, max + 1));
    }

    function shortAddr(addr) {
        if (!addr) return '—';
        return addr.slice(0, 6) + '...' + addr.slice(-4);
    }

    // ——— REAL Token Data from DexScreener ———
    async function fetchRealTokens() {
        // Cache for 60 seconds
        if (Date.now() - tokenCacheTime < 60000 && realTokenCache.length > 0) {
            return realTokenCache;
        }
        try {
            const resp = await fetch(DEXSCREENER_BOOSTED);
            if (!resp.ok) throw new Error(`${resp.status}`);
            const boosted = await resp.json();
            const solTokens = (boosted || []).filter(t => t.chainId === 'solana').slice(0, 15);
            
            const tokens = [];
            for (const token of solTokens.slice(0, 10)) {
                try {
                    const pairResp = await fetch(DEXSCREENER_PAIRS + token.tokenAddress);
                    if (!pairResp.ok) continue;
                    const pairData = await pairResp.json();
                    const pairs = Array.isArray(pairData) ? pairData : (pairData?.pairs || []);
                    if (pairs.length > 0) {
                        const p = pairs[0];
                        tokens.push({
                            symbol: p.baseToken?.symbol || 'UNKNOWN',
                            address: token.tokenAddress,
                            pairAddress: p.pairAddress,
                            priceUsd: parseFloat(p.priceUsd) || 0,
                            priceNative: parseFloat(p.priceNative) || 0.001,
                            volume24h: parseFloat(p.volume?.h24) || 0,
                            liquidity: parseFloat(p.liquidity?.usd) || 0,
                            priceChange24h: parseFloat(p.priceChange?.h24) || 0,
                            marketCap: parseFloat(p.marketCap || p.fdv) || 0,
                            url: p.url || token.url,
                            createdAt: p.pairCreatedAt,
                        });
                    }
                    await new Promise(r => setTimeout(r, 200));
                } catch { /* skip */ }
            }
            realTokenCache = tokens;
            tokenCacheTime = Date.now();
            return tokens;
        } catch (err) {
            console.warn('DexScreener fetch failed:', err.message);
            return realTokenCache; // Return stale cache
        }
    }

    async function fetchRealPrice(tokenAddress) {
        try {
            const resp = await fetch(DEXSCREENER_PAIRS + tokenAddress);
            if (!resp.ok) return null;
            const data = await resp.json();
            const pairs = Array.isArray(data) ? data : (data?.pairs || []);
            if (pairs.length > 0) {
                return {
                    priceNative: parseFloat(pairs[0].priceNative) || 0,
                    priceUsd: parseFloat(pairs[0].priceUsd) || 0,
                    liquidity: parseFloat(pairs[0].liquidity?.usd) || 0,
                    volume24h: parseFloat(pairs[0].volume?.h24) || 0,
                    priceChange5m: parseFloat(pairs[0].priceChange?.m5) || 0,
                    priceChange1h: parseFloat(pairs[0].priceChange?.h1) || 0,
                };
            }
        } catch { /* skip */ }
        return null;
    }

    function pickRealToken(tokens) {
        if (!tokens || tokens.length === 0) return null;
        // Prefer tokens with positive momentum and decent liquidity
        const good = tokens.filter(t => t.priceChange24h > 10 && t.liquidity > 5000);
        const pool = good.length > 0 ? good : tokens;
        return pool[randInt(0, pool.length - 1)];
    }

    function timestamp() {
        return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    // ——— Anti-Trap Safeguards ———
    function checkAntiTrapSafeguards(tradeSignal) {
        const reasons = [];

        // 1. Token too new
        if (tradeSignal.tokenAgeSec < config.minTokenAgeSec) {
            reasons.push(`Token < ${Math.round(config.minTokenAgeSec / 60)}min old (likely rug)`);
        }

        // 2. Too many wallets buying simultaneously
        if (tradeSignal.simultaneousBuyers > config.maxSimultaneousCopies) {
            reasons.push(`${tradeSignal.simultaneousBuyers} wallets buying simultaneously (coordinated pump)`);
        }

        // 3. Low liquidity
        if (tradeSignal.liquidityUsd < config.minLiquidityUsd) {
            reasons.push(`Liquidity $${tradeSignal.liquidityUsd.toLocaleString()} < $${config.minLiquidityUsd.toLocaleString()} minimum`);
        }

        // 4. Wallet has too many copiers (bait wallet)
        if (tradeSignal.walletCopiers > config.maxCopiers) {
            reasons.push(`Wallet has ${tradeSignal.walletCopiers} copiers (copy-trade trap risk)`);
        }

        // 5. High manipulation risk
        if (tradeSignal.manipulationRisk > 60) {
            reasons.push(`Manipulation risk ${tradeSignal.manipulationRisk}/100 too high`);
        }

        // 6. Max positions per token
        const tokenPositions = portfolio.positions.filter(p => p.tokenSymbol === tradeSignal.tokenSymbol);
        if (tokenPositions.length >= config.maxPositionsPerToken) {
            reasons.push(`Already ${tokenPositions.length} positions on ${tradeSignal.tokenSymbol}`);
        }

        return reasons;
    }

    // ——— Risk Check ———
    function checkRiskLimits() {
        const reasons = [];

        // Daily loss limit
        if (portfolio.dailyPnl <= (config.maxDailyLossPct / 100) * portfolio.startingBalance) {
            portfolio.dailyLossHit = true;
            reasons.push(`Daily loss limit hit (${config.maxDailyLossPct}%)`);
        }

        // Max concurrent positions
        if (portfolio.positions.length >= config.maxConcurrentPositions) {
            reasons.push(`Max ${config.maxConcurrentPositions} concurrent positions reached`);
        }

        // Cooldown
        const timeSinceLast = Date.now() - portfolio.lastTradeTime;
        if (timeSinceLast < config.cooldownMs) {
            reasons.push(`Cooldown: ${Math.ceil((config.cooldownMs - timeSinceLast) / 1000)}s remaining`);
        }

        // Paused
        if (portfolio.isPaused) {
            reasons.push('Trading paused by user');
        }

        // Daily loss halt
        if (portfolio.dailyLossHit) {
            reasons.push('Daily loss limit reached — trading halted');
        }

        return reasons;
    }

    // ——— Calculate Position Size ———
    function calculatePositionSize(manipulationRisk) {
        let sizePct = config.maxPositionPct;

        // Scale down position for riskier wallets
        if (manipulationRisk > 40) {
            sizePct *= 0.5; // Half size for medium risk
        } else if (manipulationRisk > 25) {
            sizePct *= 0.75; // 75% size for low-medium risk
        }

        const size = (sizePct / 100) * portfolio.balance;
        return Math.max(0.1, parseFloat(size.toFixed(4)));
    }

    // ——— REAL Trade Entry (uses actual token from DexScreener) ———
    async function simulateEntry(walletAddress, walletData, overrideToken) {
        const tradeLog = [];

        // 1. Check risk limits
        const riskReasons = checkRiskLimits();
        if (riskReasons.length > 0) {
            tradeLog.push({ time: timestamp(), type: 'blocked', message: `⛔ Trade blocked: ${riskReasons[0]}` });
            return { success: false, log: tradeLog, reason: riskReasons[0] };
        }

        // 2. Get REAL token from DexScreener
        let realToken = overrideToken;
        if (!realToken) {
            const tokens = await fetchRealTokens();
            realToken = pickRealToken(tokens);
        }
        if (!realToken) {
            tradeLog.push({ time: timestamp(), type: 'blocked', message: `⛔ No real tokens available from DexScreener` });
            return { success: false, log: tradeLog, reason: 'No real tokens' };
        }

        // Build trade signal with REAL data
        const tradeSignal = {
            walletAddress,
            tokenSymbol: realToken.symbol,
            tokenAddress: realToken.address,
            tokenAgeSec: realToken.createdAt ? Math.floor((Date.now() - realToken.createdAt) / 1000) : 7200,
            simultaneousBuyers: randInt(0, 3),
            liquidityUsd: realToken.liquidity,
            walletCopiers: randInt(5, 50),
            manipulationRisk: walletData?.manipulationRisk || randInt(5, 40),
            entryPrice: realToken.priceNative || 0.001,  // REAL price in SOL
        };

        // 3. Check anti-trap safeguards
        const trapReasons = checkAntiTrapSafeguards(tradeSignal);
        if (trapReasons.length > 0) {
            tradeLog.push({ time: timestamp(), type: 'trap', message: `🪤 Anti-trap blocked: ${trapReasons[0]}` });
            return { success: false, log: tradeLog, reason: trapReasons[0] };
        }

        // 4. Entry with real price + slippage
        const slippagePct = rand(config.slippageRange[0], config.slippageRange[1]);
        const adjustedPrice = tradeSignal.entryPrice * (1 + slippagePct / 100);
        const positionSize = calculatePositionSize(tradeSignal.manipulationRisk);

        if (positionSize > portfolio.balance) {
            tradeLog.push({ time: timestamp(), type: 'blocked', message: `⛔ Insufficient balance: need ${positionSize.toFixed(2)} SOL, have ${portfolio.balance.toFixed(2)} SOL` });
            return { success: false, log: tradeLog, reason: 'Insufficient balance' };
        }

        const tokenAmount = positionSize / adjustedPrice;
        const position = {
            id: Date.now().toString(36) + randInt(100, 999),
            walletAddress,
            tokenSymbol: realToken.symbol,
            tokenAddress: realToken.address,
            pairAddress: realToken.pairAddress,
            tokenUrl: realToken.url,
            entryPrice: adjustedPrice,
            currentPrice: adjustedPrice,
            entryPriceUsd: realToken.priceUsd,
            currentPriceUsd: realToken.priceUsd,
            tokenAmount,
            positionSize,
            stopLoss: adjustedPrice * (1 + config.stopLossPct / 100),
            takeProfit: adjustedPrice * (1 + config.takeProfitPct / 100),
            entryTime: Date.now(),
            slippage: parseFloat(slippagePct.toFixed(2)),
            latency: randInt(config.latencyRange[0], config.latencyRange[1]),
            manipulationRisk: tradeSignal.manipulationRisk,
            liquidityUsd: realToken.liquidity,
            volume24h: realToken.volume24h,
            priceChange24h: realToken.priceChange24h,
            marketCap: realToken.marketCap,
            pnlPct: 0,
            pnlSol: 0,
            status: 'open',
            topHolders: realToken.holderData?.topHolders || [], // Save top holders at entry
        };

        portfolio.positions.push(position);
        portfolio.balance -= positionSize;
        portfolio.tradeCount++;
        portfolio.lastTradeTime = Date.now();

        tradeLog.push({ time: timestamp(), type: 'info', message: `📡 Signal from ${shortAddr(walletAddress)} — REAL token ${realToken.symbol} ($${realToken.priceUsd?.toFixed(8) || '?'})` });
        tradeLog.push({ time: timestamp(), type: 'entry', message: `✅ BOUGHT ${tokenAmount.toFixed(2)} ${realToken.symbol} @ ${adjustedPrice.toFixed(8)} SOL | Size: ${positionSize.toFixed(2)} SOL | MCap $${(realToken.marketCap/1000).toFixed(0)}K | Liq $${(realToken.liquidity/1000).toFixed(0)}K` });
        tradeLog.push({ time: timestamp(), type: 'info', message: `🛡️ SL: ${position.stopLoss.toFixed(8)} (${config.stopLossPct}%) | TP: ${position.takeProfit.toFixed(8)} (+${config.takeProfitPct}%)` });

        // Start REAL price tracking
        startRealPriceTracking(position);

        if (renderCallback) renderCallback();
        return { success: true, log: tradeLog, position };
    }

    // ——— REAL Price Tracking (polls DexScreener for live prices) ———
    function startRealPriceTracking(position) {
        // Initialize tracking state on position
        if (!position._trackState) {
            position._trackState = {
                highestPrice: position.entryPrice,
                priceHistory: [position.entryPrice],
                ladderTier: 0,
                totalSold: 0,
                breakevenLocked: false,
                trailingSL: position.stopLoss,
            };
        }
        const ts = position._trackState;

        const interval = setInterval(async () => {
            const pos = portfolio.positions.find(p => p.id === position.id);
            if (!pos || pos.status !== 'open') {
                clearInterval(interval);
                return;
            }

            const priceData = await fetchRealPrice(pos.tokenAddress);
            if (priceData && priceData.priceNative > 0) {
                pos.currentPrice = priceData.priceNative;
                pos.currentPriceUsd = priceData.priceUsd;
                pos.liquidityUsd = priceData.liquidity;
            }

            const currentValue = pos.tokenAmount * pos.currentPrice;
            pos.pnlSol = parseFloat((currentValue - pos.positionSize).toFixed(4));
            pos.pnlPct = parseFloat(((currentValue / pos.positionSize - 1) * 100).toFixed(2));

            if (pos.currentPrice > ts.highestPrice) {
                ts.highestPrice = pos.currentPrice;
            }
            ts.priceHistory.push(pos.currentPrice);
            if (ts.priceHistory.length > 30) ts.priceHistory.shift();

            // EXIT 1: Time-Decay
            const holdMinutes = (Date.now() - pos.entryTime) / 60000;
            if (holdMinutes >= config.timeDecayMinutes && pos.pnlPct < 20) {
                addTradeLog({ time: timestamp(), type: 'info', message: `TIME DECAY: ${pos.tokenSymbol} no +20% in ${config.timeDecayMinutes}min` });
                closePosition(pos.id, 'time_decay');
                clearInterval(interval);
                return;
            }

            // EXIT 2: Max Hold Time
            const maxHold = pos.isInsiderPlay ? config.insiderMaxHoldMinutes : config.maxHoldMinutes;
            if (holdMinutes >= maxHold) {
                addTradeLog({ time: timestamp(), type: 'info', message: `MAX HOLD: ${pos.tokenSymbol} hit ${maxHold}min limit` });
                closePosition(pos.id, 'max_hold');
                clearInterval(interval);
                return;
            }

            // EXIT 3: Breakeven Lock at configurable %
            if (!ts.breakevenLocked && pos.pnlPct >= config.breakevenTriggerPct) {
                ts.breakevenLocked = true;
                ts.trailingSL = pos.entryPrice;
                pos.stopLoss = pos.entryPrice;
                addTradeLog({ time: timestamp(), type: 'info', message: `BREAKEVEN LOCK: ${pos.tokenSymbol} hit +${config.breakevenTriggerPct}% - SL moved to entry` });
            }

            // EXIT 4: Profit-Locking Ladder
            while (ts.ladderTier < config.profitLadder.length) {
                const tier = config.profitLadder[ts.ladderTier];
                if (pos.pnlPct >= tier.pct) {
                    const sellTokens = pos.tokenAmount * tier.sellFraction;
                    const sellValue = sellTokens * pos.currentPrice;
                    const sellCost = pos.positionSize * tier.sellFraction;
                    const partialPnl = sellValue - sellCost;

                    pos.tokenAmount -= sellTokens;
                    pos.positionSize -= sellCost;
                    portfolio.balance += sellValue;
                    portfolio.totalRealizedPnl += partialPnl;
                    portfolio.dailyPnl += partialPnl;
                    ts.totalSold += tier.sellFraction;

                    const newSL = pos.entryPrice * (1 + tier.trailSL / 100);
                    ts.trailingSL = Math.max(ts.trailingSL, newSL);
                    pos.stopLoss = ts.trailingSL;

                    addTradeLog({ time: timestamp(), type: 'partial', message: `LADDER TP ${ts.ladderTier + 1}: Sold ${(tier.sellFraction*100).toFixed(0)}% of ${pos.tokenSymbol} @ +${tier.pct}% | +${partialPnl.toFixed(2)} SOL | SL trailed to +${tier.trailSL}%` });
                    ts.ladderTier++;

                    if (ts.totalSold >= 0.99) {
                        closePosition(pos.id, 'take_profit');
                        clearInterval(interval);
                        return;
                    }
                } else {
                    break;
                }
            }

            // EXIT 5: ATR Trailing Stop
            if (ts.priceHistory.length >= 5) {
                let atrSum = 0;
                for (let i = 1; i < ts.priceHistory.length; i++) {
                    atrSum += Math.abs(ts.priceHistory[i] - ts.priceHistory[i-1]);
                }
                const atr = atrSum / (ts.priceHistory.length - 1);
                const atrStop = ts.highestPrice - (config.trailingStopATRMult * atr);
                if (atrStop > ts.trailingSL) {
                    ts.trailingSL = atrStop;
                    pos.stopLoss = atrStop;
                }
            }

            // EXIT 6: Trailing Stop Hit
            if (pos.currentPrice <= ts.trailingSL) {
                addTradeLog({ time: timestamp(), type: 'info', message: `TRAILING STOP: ${pos.tokenSymbol} hit trailing SL @ ${ts.trailingSL.toFixed(8)}` });
                closePosition(pos.id, 'stop_loss');
                clearInterval(interval);
                return;
            }

            // EXIT 7: Liquidity Drop
            if (priceData && pos.liquidityUsd > 0 && priceData.liquidity < pos.liquidityUsd * (config.liquidityDropExitPct / 100)) {
                addTradeLog({ time: timestamp(), type: 'info', message: `LIQ DROP: ${pos.tokenSymbol} liquidity dropped to $${priceData.liquidity.toFixed(0)}` });
                closePosition(pos.id, 'liquidity_drop');
                clearInterval(interval);
                return;
            }

            if (renderCallback) renderCallback();
        }, 10000);

        priceSimIntervals.push(interval);
    }

    // ——— Close Position ———
    function closePosition(positionId, reason = 'manual') {
        const posIdx = portfolio.positions.findIndex(p => p.id === positionId);
        if (posIdx === -1) return;

        const pos = portfolio.positions[posIdx];
        const exitValue = pos.tokenAmount * pos.currentPrice;
        const pnl = exitValue - pos.positionSize;

        pos.status = 'closed';
        pos.exitPrice = pos.currentPrice;
        pos.exitTime = Date.now();
        pos.exitReason = reason;
        pos.finalPnl = parseFloat(pnl.toFixed(4));

        portfolio.balance += exitValue;
        portfolio.totalRealizedPnl += pnl;
        portfolio.dailyPnl += pnl;
        if (pnl > 0) portfolio.winCount++;

        // Move to history
        portfolio.history.unshift({ ...pos });
        portfolio.positions.splice(posIdx, 1);

        const reasonLabels = {
            stop_loss: '🔴 STOP LOSS',
            take_profit: '🟢 TAKE PROFIT',
            liquidity_drop: '⚠️ LIQUIDITY DROP',
            manual: '🔵 MANUAL EXIT',
            daily_limit: '🛑 DAILY LIMIT',
            whale_dump: '🚨 WHALE DUMP',
            time_decay: 'TIME DECAY',
            max_hold: 'MAX HOLD',
        };

        addTradeLog({
            time: timestamp(),
            type: pnl >= 0 ? 'profit' : 'loss',
            message: `${reasonLabels[reason] || reason}: ${pos.tokenSymbol} @ ${pos.currentPrice < 0.0001 ? pos.currentPrice.toPrecision(4) : pos.currentPrice.toFixed(6)} | ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} SOL (${pos.pnlPct >= 0 ? '+' : ''}${pos.pnlPct}%)`,
        });

        // Check daily loss limit
        if (portfolio.dailyPnl <= (config.maxDailyLossPct / 100) * portfolio.startingBalance) {
            portfolio.dailyLossHit = true;
            addTradeLog({
                time: timestamp(),
                type: 'blocked',
                message: `🛑 DAILY LOSS LIMIT HIT (${config.maxDailyLossPct}%) — Trading paused until reset`,
            });
        }

        if (renderCallback) renderCallback();
    }

    // ——— Trade Log ———
    let tradeLogs = [];
    function addTradeLog(entry) {
        tradeLogs.unshift(entry);
        if (tradeLogs.length > 100) tradeLogs.pop();
    }

    // ——— Auto Copy-Trade Loop ———
    let copyTradeInterval = null;

    async function startCopyTrading(wallets) {
        if (portfolio.isRunning) return;
        portfolio.isRunning = true;
        portfolio.followedWallets = wallets;
        portfolio.dailyPnl = 0;
        portfolio.dailyLossHit = false;

        // Pre-fetch real tokens
        const tokens = await fetchRealTokens();

        addTradeLog({
            time: timestamp(),
            type: 'info',
            message: `🚀 Copy-trading started | Following ${wallets.length} wallets | ${tokens.length} REAL tokens loaded | Balance: ${portfolio.balance.toFixed(2)} SOL`,
        });

        // Entry on REAL tokens based on hot token momentum
        copyTradeInterval = setInterval(async () => {
            if (!portfolio.isRunning || portfolio.dailyLossHit || portfolio.isPaused) return;
            if (portfolio.positions.length >= config.maxConcurrentPositions) return;

            // Refresh real token data
            const freshTokens = await fetchRealTokens();
            // Find tokens with strong momentum that we don't already hold
            const heldAddresses = new Set(portfolio.positions.map(p => p.tokenAddress));
            const candidates = freshTokens.filter(t => 
                !heldAddresses.has(t.address) && 
                t.priceChange24h > 20 && 
                t.liquidity > config.minLiquidityUsd
            );

            if (candidates.length > 0 && Math.random() < 0.4) {
                const token = candidates[randInt(0, Math.min(candidates.length - 1, 4))];
                const wallet = wallets[randInt(0, wallets.length - 1)];
                const result = await simulateEntry(wallet.address, wallet, token);
                result.log.forEach(entry => addTradeLog(entry));
                if (renderCallback) renderCallback();
            }
        }, 15000 + randInt(0, 10000)); // Check every 15-25 seconds

        if (renderCallback) renderCallback();
    }

    function stopCopyTrading() {
        portfolio.isRunning = false;
        if (copyTradeInterval) {
            clearInterval(copyTradeInterval);
            copyTradeInterval = null;
        }
        if (sniperFollowInterval) {
            clearInterval(sniperFollowInterval);
            sniperFollowInterval = null;
        }

        addTradeLog({
            time: timestamp(),
            type: 'info',
            message: `⏹️ Copy-trading stopped | Open positions: ${portfolio.positions.length}`,
        });

        if (renderCallback) renderCallback();
    }

    // ——— Auto-Follow Sniper Mode ———
    let sniperFollowInterval = null;
    let sniperProcessedTokens = new Set(); // Avoid duplicate entries

    async function startSniperFollow(minScore = 60) {
        if (portfolio.isRunning) return;
        portfolio.isRunning = true;
        portfolio.mode = 'sniper_follow';
        portfolio.dailyPnl = 0;
        portfolio.dailyLossHit = false;

        addTradeLog({
            time: timestamp(),
            type: 'info',
            message: `🎯 Auto-Follow Sniper started | Min score: ${minScore}/100 | Balance: ${portfolio.balance.toFixed(2)} SOL`,
        });

        // Poll sniper engine for high-score tokens
        sniperFollowInterval = setInterval(async () => {
            if (!portfolio.isRunning || portfolio.dailyLossHit || portfolio.isPaused) return;
            if (portfolio.positions.length >= config.maxConcurrentPositions) return;

            // Check if SniperEngine is available and running
            if (typeof SniperEngine === 'undefined' || !SniperEngine.isRunning) return;

            const sniperState = SniperEngine.getState();
            const heldAddresses = new Set(portfolio.positions.map(p => p.tokenAddress));

            // Find high-score tokens we haven't traded yet
            const candidates = sniperState.tokens.filter(t =>
                t.score.total >= Math.max(minScore, config.minScoreForEntry) &&
                !heldAddresses.has(t.address) &&
                !sniperProcessedTokens.has(t.address) &&
                t.liquidity >= config.minLiquidityUsd
            );

            for (const token of candidates.slice(0, 2)) { // Max 2 entries per cycle
                if (portfolio.positions.length >= config.maxConcurrentPositions) break;

                // Build override token from sniper data
                const overrideToken = {
                    symbol: token.symbol,
                    address: token.address,
                    pairAddress: token.pairAddress,
                    priceUsd: token.priceUsd,
                    priceNative: token.priceNative || (token.priceUsd / 150), // Estimate if missing
                    volume24h: token.volume24h,
                    liquidity: token.liquidity,
                    priceChange24h: token.priceChange24h,
                    marketCap: token.marketCap,
                    url: token.url,
                    createdAt: token.createdAt,
                };

                const result = await simulateEntry(
                    'SNIPER_AUTO',
                    { manipulationRisk: Math.max(5, 100 - token.score.total) },
                    overrideToken
                );

                result.log.forEach(entry => addTradeLog(entry));

                if (result.success) {
                    sniperProcessedTokens.add(token.address);
                    addTradeLog({
                        time: timestamp(),
                        type: 'info',
                        message: `🎯 Auto-sniped ${token.symbol} | Score: ${token.score.total}/100 ${token.score.grade} | MCap $${(token.marketCap/1000).toFixed(0)}K`,
                    });
                }
            }

            if (renderCallback) renderCallback();
        }, 20000); // Check every 20 seconds

        if (renderCallback) renderCallback();
    }

    // ——— Portfolio Metrics ———
    function getMetrics() {
        const openPnl = portfolio.positions.reduce((sum, p) => sum + p.pnlSol, 0);
        const totalValue = portfolio.balance + portfolio.positions.reduce((sum, p) => sum + (p.tokenAmount * p.currentPrice), 0);
        const totalPnl = totalValue - portfolio.startingBalance;
        const winRate = portfolio.tradeCount > 0 ? ((portfolio.winCount / (portfolio.history.length || 1)) * 100) : 0;
        const riskExposure = portfolio.positions.reduce((sum, p) => sum + p.positionSize, 0);
        const riskPct = (riskExposure / portfolio.startingBalance) * 100;

        return {
            balance: parseFloat(portfolio.balance.toFixed(4)),
            startingBalance: portfolio.startingBalance,
            totalValue: parseFloat(totalValue.toFixed(4)),
            openPnl: parseFloat(openPnl.toFixed(4)),
            realizedPnl: parseFloat(portfolio.totalRealizedPnl.toFixed(4)),
            totalPnl: parseFloat(totalPnl.toFixed(4)),
            totalPnlPct: parseFloat(((totalPnl / portfolio.startingBalance) * 100).toFixed(2)),
            winRate: parseFloat(winRate.toFixed(1)),
            tradeCount: portfolio.tradeCount,
            openPositions: portfolio.positions.length,
            closedTrades: portfolio.history.length,
            dailyPnl: parseFloat(portfolio.dailyPnl.toFixed(4)),
            dailyLossHit: portfolio.dailyLossHit,
            isRunning: portfolio.isRunning,
            isPaused: portfolio.isPaused,
            riskExposure: parseFloat(riskExposure.toFixed(4)),
            riskPct: parseFloat(riskPct.toFixed(1)),
            positions: portfolio.positions,
            history: portfolio.history.slice(0, 50),
            logs: tradeLogs.slice(0, 50),
            followedWallets: portfolio.followedWallets,
        };
    }

    // ——— Reset ———
    function resetPortfolio() {
        stopCopyTrading();
        priceSimIntervals.forEach(i => clearInterval(i));
        priceSimIntervals = [];

        portfolio = {
            balance: config.startingBalance,
            startingBalance: config.startingBalance,
            positions: [],
            history: [],
            dailyPnl: 0,
            dailyLossHit: false,
            totalRealizedPnl: 0,
            tradeCount: 0,
            winCount: 0,
            lastTradeTime: 0,
            isPaused: false,
            isRunning: false,
            followedWallets: [],
        };
        tradeLogs = [];

        if (renderCallback) renderCallback();
    }

    // ——— Config ———
    function updateConfig(newConfig) {
        config = { ...config, ...newConfig };
        if (newConfig.startingBalance && !portfolio.isRunning) {
            portfolio.balance = newConfig.startingBalance;
            portfolio.startingBalance = newConfig.startingBalance;
        }
    }

    function setRenderCallback(cb) {
        renderCallback = cb;
    }

    // Check if a wallet selling a token is a whale/insider/cluster partner, and trigger exit
    function checkWhaleExit(tokenAddress, sellerWallet, sellAmount) {
        if (!config.whaleShadowExit) return;

        portfolio.positions.forEach(pos => {
            if (pos.tokenAddress !== tokenAddress || pos.status !== 'open') return;

            // 1. Check if seller is in our topHolders list from entry
            let isWhale = pos.topHolders.some(h => h.owner === sellerWallet);

            // 2. Check if seller shares a cluster with the entry trigger wallet
            if (!isWhale && typeof ClusterIntel !== 'undefined') {
                const triggerNode = ClusterIntel.state.nodes.get(pos.walletAddress);
                const sellerNode = ClusterIntel.state.nodes.get(sellerWallet);
                if (triggerNode && sellerNode && triggerNode.clusterId && triggerNode.clusterId === sellerNode.clusterId) {
                    isWhale = true;
                }
            }

            // 3. Fallback: Check if they are related in the graph
            if (!isWhale && typeof ClusterIntel !== 'undefined') {
                const rels = ClusterIntel.getRelationships(sellerWallet);
                const hasDirectLink = rels.some(r => r.from === pos.walletAddress || r.to === pos.walletAddress);
                if (hasDirectLink) {
                    isWhale = true;
                }
            }

            if (isWhale) {
                addTradeLog({
                    time: timestamp(),
                    type: 'info',
                    message: `🚨 WHALE SHADOW: Syndicate/Top wallet ${shortAddr(sellerWallet)} sold! Auto-exiting ${pos.tokenSymbol} to secure returns.`
                });
                closePosition(pos.id, 'whale_dump');
            }
        });
    }

    // Load trade state from database
    function loadTradeState(savedMetrics) {
        if (!savedMetrics) return;
        portfolio.balance = savedMetrics.balance !== undefined ? savedMetrics.balance : portfolio.balance;
        portfolio.startingBalance = savedMetrics.startingBalance !== undefined ? savedMetrics.startingBalance : portfolio.startingBalance;
        portfolio.positions = Array.isArray(savedMetrics.positions) ? savedMetrics.positions : portfolio.positions;
        portfolio.history = Array.isArray(savedMetrics.history) ? savedMetrics.history : portfolio.history;
        portfolio.dailyPnl = savedMetrics.dailyPnl !== undefined ? savedMetrics.dailyPnl : portfolio.dailyPnl;
        portfolio.dailyLossHit = savedMetrics.dailyLossHit !== undefined ? savedMetrics.dailyLossHit : portfolio.dailyLossHit;
        portfolio.totalRealizedPnl = savedMetrics.totalRealizedPnl !== undefined ? savedMetrics.totalRealizedPnl : portfolio.totalRealizedPnl;
        portfolio.tradeCount = savedMetrics.tradeCount !== undefined ? savedMetrics.tradeCount : portfolio.tradeCount;
        portfolio.winCount = savedMetrics.winCount !== undefined ? savedMetrics.winCount : portfolio.winCount;
        portfolio.isPaused = savedMetrics.isPaused !== undefined ? savedMetrics.isPaused : portfolio.isPaused;
        portfolio.isRunning = savedMetrics.isRunning !== undefined ? savedMetrics.isRunning : portfolio.isRunning;
        portfolio.followedWallets = Array.isArray(savedMetrics.followedWallets) ? savedMetrics.followedWallets : portfolio.followedWallets;
        
        console.log(`📋 [PaperTrader] Loaded saved state: ${portfolio.balance?.toFixed(2)} SOL balance, ${portfolio.positions.length} active, ${portfolio.history.length} history`);

        // Restart real-time price tracking for restored open positions
        if (portfolio.positions && portfolio.positions.length > 0) {
            // Clear any old simulation timers
            priceSimIntervals.forEach(i => clearInterval(i));
            priceSimIntervals = [];
            
            portfolio.positions.forEach(pos => {
                if (pos.status === 'open') {
                    startRealPriceTracking(pos);
                }
            });
        }

        if (renderCallback) renderCallback();
    }

    // Quick start — just enable trading so Radar auto-trades can execute
    function start() {
        portfolio.isRunning = true;
        portfolio.isPaused = false;
        addTradeLog({ time: timestamp(), type: 'info', message: '▶️ Paper trading engine started — accepting auto-trades' });
        if (renderCallback) renderCallback();
    }

    // ——— Public API ———
    return {
        start,
        startCopyTrading,
        startSniperFollow,
        stopCopyTrading,
        simulateEntry,
        closePosition,
        checkWhaleExit,
        getMetrics,
        loadTradeState,
        resetPortfolio,
        updateConfig,
        setRenderCallback,
        checkRiskLimits,
        checkAntiTrapSafeguards,
        get isRunning() { return portfolio.isRunning; },
        togglePause() {
            portfolio.isPaused = !portfolio.isPaused;
            addTradeLog({
                time: timestamp(),
                type: 'info',
                message: portfolio.isPaused ? '⏸️ Trading PAUSED' : '▶️ Trading RESUMED',
            });
            if (renderCallback) renderCallback();
        },
    };
})();
