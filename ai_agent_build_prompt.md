
# SOLANA MEMECOIN ALPHA SCANNER v3.0 — AI AGENT BUILD PROMPT
## Zero Code Snippets — Strategy & Architecture Only

---

## 1. WHAT TO BUILD (Priority Order)

### P0: CRITICAL — Build First, Everything Else Depends On These

#### 1.1 Platform-Specific Filtering Engine
**Why:** Current system shows pumpswap post-graduation tokens as if they were pump.fun pre-graduation opportunities. This is the #1 reason the grid is full of garbage.

**Rules:**
- **pump.fun** (pre-graduation): Check mint authority revoked, freeze authority revoked, social presence (X/Telegram/Website). Score threshold: 65+. Max hold: wait for graduation signal, then 20 min.
- **pumpswap** (post-graduation <15 min): Check sell pressure <0.5 (2x more buys than sells), liquidity/mcap >20%, social presence. Score threshold: 70+. Max hold: 20 min.
- **pumpswap** (post-graduation 15-30 min): Score threshold: 75+. Max hold: 15 min. Position size: 0.5 SOL max.
- **pumpswap** (post-graduation >30 min): **AUTO-REJECT.** Dump phase. Don't trade.
- **raydium/orca** (<30 min): Check liquidity >$20K, social presence. Score threshold: 65+. Max hold: 45 min.
- **raydium/orca** (>30 min): Score threshold: 75+. Max hold: 30 min.

**UI:** Show platform tag on every token card. Color-code: pump.fun = blue, pumpswap = orange, raydium/orca = purple. Rejected tokens show rejection reason instead of score.

#### 1.2 Sell Pressure Hard Filter
**Why:** Multiple tokens in current grid show more sells than buys (Debt: 1.05x, baby: 1.66x, Himothy: 1.20x). Net selling = insiders distributing.

**Rule:** If sells_1h / buys_1h > 1.0 → **AUTO-REJECT.** Reason: "DUMPING: More sells than buys."
If ratio > 0.8 → score -15. If ratio < 0.3 → score +5.

#### 1.3 Liquidity/MCap Hard Filter
**Why:** Agamemnon has $323K mcap with $43K liquidity (13% ratio). PHG has $189K mcap with $24K liquidity (13%). Thin liquidity = whale can crash price with small sell.

**Rule:** If liquidity / mcap < 0.20 → **AUTO-REJECT.** Reason: "THIN: Liq < 20% of mcap."
If ratio < 0.30 → score -10. If ratio > 0.50 → score +5.

#### 1.4 Age Penalty for Post-Graduation Tokens
**Why:** Pumpswap tokens >30 min old are in dump phase. A 5-day-old token (baby) is dead.

**Rules:**
- pumpswap 0-15 min: no penalty
- pumpswap 15-30 min: -10 score
- pumpswap 30-60 min: -20 score
- pumpswap >60 min: **AUTO-REJECT.** Reason: "LATE: Post-grad dump phase."
- pump.fun 0-5 min: +5 score (early detection)
- pump.fun 5-30 min: no penalty
- pump.fun >30 min: -10 score (missed the window)

#### 1.5 Social Presence Manual Check UI
**Why:** ArXiv paper shows tokens with NO social channels have 99.89% fail rate. This is the #1 predictor.

**UI:** Add 3 checkboxes to token detail view:
- [ ] X account exists and active (posts in last hour)
- [ ] Telegram group exists and active (messages in last 10 min)
- [ ] Website exists

**Scoring:**
- All 3 checked → score +15
- 2 checked → score +5
- 1 checked → score -10
- 0 checked → **AUTO-REJECT.** Reason: "NO SOCIAL: 99.89% fail rate."

**Block Paper Trade button until all 3 are checked or explicitly marked "N/A."**

#### 1.6 AntiRug Paradox Fix
**Why:** Current antiRug=5 paradoxically performs worse. Either inverted or capturing wrong signal.

**Action:** Investigate antiRug calculation. If higher antiRug score correlates with higher rug rate → **invert the metric** (5 becomes best, 0 becomes worst). If no clear correlation → **remove antiRug component entirely** and redistribute 5 points to age or social velocity.

#### 1.7 UI Rejection Display
**Why:** User cannot see if safety gate is working. Tokens show scores but no rejection reasons.

**UI:** On every token card:
- If rejected → show red banner with rejection reason: "REJECTED: [reason]"
- If passed → show green "🛡️ SAFE" badge
- Disable Paper Trade button for rejected tokens
- Add "Watchlist" tab for tokens scoring 50-64 (not tradeable, just monitoring)
- Add "Hidden" count showing how many tokens were filtered out today

---

### P1: HIGH — Build Immediately After P0

#### 1.8 Time-Decay Exit Engine (Primary Exit)
**Why:** Memecoin lifecycle is 45 minutes. A token that hasn't moved in 10 minutes is dead, not consolidating.

**Rules:**
- T+5 min: If no +10% gain → exit 50% of position
- T+10 min: If no +20% gain → exit remaining 50% (100% exit)
- T+15 min: If no +30% gain → exit 100% (hard limit for weak tokens)
- T+20 min: Exit 25% of position (insider plays — distribution starts)
- T+30 min: Exit 50% of position (organic plays — peak usually passed)
- **T+45 min: Exit 100% of ALL positions (hard ceiling, no exceptions)**

**UI:** Countdown timer on every open position showing time remaining until next exit trigger. Color changes: green (>20 min), yellow (10-20 min), red (<10 min).

#### 1.9 Profit-Locking Tier System (Secondary Exit)
**Why:** Memecoins can go 10-50X. Selling 100% at +50% misses the moonshot. Holding 100% to 10X gives back everything on the dump.

**Rules:**
- +30% → Move stop loss to breakeven (entry price). **Never let a winner turn into a loser.**
- +50% → Sell 25% of position. Stop remains at breakeven.
- +100% → Sell 25% of position. Move stop to +30% (lock minimum 30% profit).
- +200% → Sell 25% of position. Move stop to +80%.
- +300% → Sell final 25% OR let run with stop at +150%.

**The "runner" rule:** After selling 75%, the final 25% runs with a hard stop at +150%. If it hits 10X, you capture 2.5X equivalent on that 25%. If it dumps, you still made +150% on that portion.

**UI:** Progress bar showing tier status: "Tier 1/4 ✅ | Tier 2/4 ⏳ | Tier 3/4 🔒 | Tier 4/4 🔒". Show current stop level and next sell trigger.

#### 1.10 Event-Based Emergency Exits (Tertiary Exit)
**Why:** Memecoin dumps are triggered by specific events (whale sell, rug, social silence), not gradual trends.

**Rules:**
- Top holder sells >10% of position → exit 50% immediately
- Top holder sells >20% → exit 100% immediately
- 3+ tracked wallets sell ANY amount → exit 100% immediately
- Liquidity drops >40% from entry → exit 100% immediately
- Mint authority re-enabled → exit 100% immediately
- Price drops >25% from local high → exit 100% immediately
- Social mentions drop to zero (manual check at T+15) → exit 50%

**UI:** Flashing red "EMERGENCY EXIT TRIGGERED" banner with event reason. Auto-execute after 3-second countdown (user can cancel if they want to override — but log the override for post-trade review).

#### 1.11 Wallet Tracking System (Browser-Only)
**Why:** Track insider distribution and exit before retail dump.

**At Entry:**
- Record top 10 wallet addresses from DexScreener in position object
- Record dev wallet address
- Count fresh wallets (<7 days old) in top 10
- If 3+ fresh wallets → flag as "insider play" → 20-min max hold
- If 0 fresh wallets → flag as "organic" → 45-min max hold

**Continuous Monitoring (Every 60 Seconds):**
- Query Solscan API for recent sells from tracked wallets
- Calculate sellPressure = totalSOLsold / position.entryValue
- If sellPressure >10% → exit 50%
- If sellPressure >20% → exit 100%
- If dev wallet sells ANY amount → exit 100%

**Limitations:** Can only track top 10 wallets (API rate limits). Can't trace funding sources (requires backend). But captures 80% of the value.

**UI:** Show tracked wallet list in position detail. Show sell pressure % with color coding: green (<5%), yellow (5-10%), red (>10%).

#### 1.12 Risk Management Enforcer
**Why:** Memecoin trading is emotionally intense. System must protect user from themselves.

**Rules (Hard-Coded, Non-Overrideable):**
- Daily loss limit -10% → trading paused 4 hours
- Daily loss limit -20% → trading paused 24 hours
- 3 consecutive losses → position size reduced 50% for next 3 trades
- 5 consecutive losses → trading stopped for the day
- +5X win → position size reduced 50% for next 2 trades (winner's curse)
- +10X win → trading stopped for the day
- Max 15% portfolio in open positions
- Max 3 open positions total
- Max 2 HIGH confidence (75+) positions
- Trading >4 hours continuously → mandatory 30-min break
- Past midnight local time → no new positions

**UI:** Risk dashboard showing: daily PnL, open exposure %, consecutive loss count, daily loss limit status, break timer. Red banner when limits hit. Block ALL trade buttons during pause.

---

### P2: MEDIUM — Build After P0+P1 Stable

#### 1.13 Market State Adapter
**Why:** Rules must adapt to market conditions. What works in frenzy doesn't work in dead markets.

**Manual Toggle in UI:**
- **FRENZY:** Solana 24h volume >$2B, avg memecoin volatility >50%
  - Score threshold: 70+ (instead of 65+)
  - Position size: 0.5 SOL max (50% reduction)
  - Hold time: 10 min max for insider, 20 min for organic
  - Profit tiers: Sell 25% at +30% (instead of +50%)
- **NORMAL:** Solana 24h volume $500M-$2B, volatility 15-50%
  - Standard rules (as defined above)
- **DEAD:** Solana 24h volume <$500M, volatility <15%
  - Score threshold: 75+
  - Position size: 0.25 SOL max
  - Hold time: 60 min max for organic (patience pays in dead markets)

**UI:** Toggle switch at top of scanner: [FRENZY 🔥] [NORMAL ⚡] [DEAD 💤]. Auto-suggest based on DexScreener Solana overview, but user can override.

#### 1.14 Backtesting Framework
**Why:** Validate weight changes before deploying. Prevents optimizing into worse performance.

**Functionality:**
- Load last 30 days of paper-trade history from IndexedDB
- Replay each trade with NEW weights and rules
- Compare: win rate, avg PnL, max drawdown, profit factor
- Show side-by-side: old strategy vs new strategy
- Only allow deployment if new strategy improves ALL metrics

**UI:** "Backtest" button in settings. Results page with equity curves, drawdown charts, metric comparison table.

#### 1.15 Wallet Performance Tracker
**Why:** Poor man's copy-trade signal. Track which wallets consistently profit and boost score when they enter new tokens.

**IndexedDB Schema:**
- wallet_address (primary key)
- tokens_traded (array of {token, entry, exit, pnl, date})
- win_count, loss_count, total_pnl, win_rate
- last_updated

**Population:**
- Manual: User tags which alpha wallets they copied after each trade
- Automated: For each token traded, query top 10 wallets that bought before entry. Track their subsequent sells. If they sold at profit → mark as "winning wallet."

**Usage:** If 2+ "winning wallets" from database enter a new token → boost score +10.

**Maintenance:** Purge wallets with <3 tracked trades after 30 days. Cap database at 1,000 wallets.

#### 1.16 Lightweight Cluster Detection
**Why:** Flag insider plays at entry for tighter holds and earlier exits.

**At Entry Only (Not Continuous):**
- Query Helius for last 50 transactions on token mint
- Extract unique wallets from buy transactions (last 10 minutes)
- For each wallet, check creation date (Solscan API) and prior token history
- Flag if: 3+ wallets are <7 days old AND have <3 prior tokens AND bought within 60 seconds of each other
- If flagged: "clusterDetected = true", auto-set 20-min max hold, boost score +5

**Limitations:** Only catches obvious clusters. Misses sophisticated insiders using aged wallets. But catches 50% of low-hanging fruit.

#### 1.17 Live Trading Gates
**Why:** Prevent premature live trading. Clear thresholds for unlocking real money.

**Gates:**
- **Paper Trade Mode:** Default. All signals logged, no real transactions.
- **Unlock Live (0.1 SOL):** Requires 500 paper trades, >40% win rate, positive avg PnL, max drawdown <20%
- **Scale to 0.5 SOL:** Requires 100 live trades, >35% win rate, positive cumulative PnL
- **Scale to 1.0 SOL:** Requires 500 live trades, >40% win rate, positive cumulative PnL
- **Max 5 SOL per trade:** Hard ceiling, never exceeded

**UI:** Gate status dashboard. Progress bars for each threshold. "Live Mode" toggle locked until gates met. Jito MEV integration required before first live trade.

---

### P3: NICE-TO-HAVE — Build After System is Profitable

#### 1.18 Jito MEV Protection
**Why:** 92% of Solana validators run Jito. Standard transactions are MEV food.
**When:** Before first live trade. Not needed for paper trading.

#### 1.19 Pre-Trade Psychology Checklist
**Why:** Emotional control is the final edge.
**UI:** Modal before every live trade:
- [ ] Did I sleep >6 hours?
- [ ] Am I chasing losses? (daily PnL negative?)
- [ ] Is this FOMO or signal? (score >=65 + all checks passed?)
- [ ] Am I within position limits? (<3 open, <15% exposure)
- [ ] Is my 45-min timer ready? (for insider plays)

All must be checked to proceed. Log responses for post-trade analysis.

#### 1.20 Performance Analytics Dashboard
**Why:** Data-driven strategy refinement.
**Metrics:** Win rate by platform, by market state, by score tier, by hold time. Avg PnL by exit type. Max drawdown periods. Equity curve.

---

## 2. SCORING ENGINE (Memecoin-Optimized)

### 2.1 Components & Weights

| Component | Weight | What It Measures | Threshold |
|-----------|--------|-----------------|-----------|
| **Social Velocity** | 20 | X + Telegram activity + mentions | Manual check, 30 sec |
| **Age** | 15 | Minutes since creation | Sweet spot: 5-30 min |
| **Momentum** | 15 | 5-min price change rate | Must be >+20% |
| **Buy Pressure** | 12 | Buys 1h / Sells 1h | Must be >2.0 |
| **Market Cap** | 10 | $25K-$100K sweet spot | Too low = rug, too high = missed |
| **Holder Growth** | 8 | New unique wallets/min | >10/min = viral |
| **Liquidity Depth** | 7 | Liq/MCap ratio | Must be >20% |
| **Wallet Health** | 8 | Fresh wallet % in top 10 | <30% fresh = organic |
| **Safety Gate** | 5 | Mint/freeze authority, top holders | Hard filters |

**Total: 100. Entry threshold: 65+ (MEDIUM), 75+ (HIGH).**

### 2.2 Platform Adjustments

| Platform | Modifier | Max Hold |
|----------|----------|----------|
| pump.fun (pre-grad) | +0 | Wait for grad, then 20 min |
| pumpswap (<15 min) | -5 | 20 min |
| pumpswap (15-30 min) | -15 | 15 min |
| pumpswap (>30 min) | **REJECT** | N/A |
| raydium/orca (<30 min) | +5 | 45 min |
| raydium/orca (>30 min) | -10 | 30 min |

### 2.3 Market State Adjustments

| State | Score Modifier | Size Modifier | Hold Modifier |
|-------|---------------|--------------|---------------|
| FRENZY | +0 (need 70+) | -50% | -50% |
| NORMAL | +0 | +0 | +0 |
| DEAD | -10 (need 75+) | -75% | +50% |

---

## 3. WHAT NOT TO BUILD

| Feature | Why Not |
|---------|---------|
| Traditional trailing stop loss | Memecoins have step-function moves, not gradual trends. Time-event exits work better. |
| Fixed percentage SL/TP | -15% SL gets hit by normal volatility. +50% TP sells too early on 10X. |
| ML/neural networks | Insufficient data, overfits on chaos. Rule-based is robust and interpretable. |
| Social media scraping from browser | CORS, rate limits, anti-bot, fragile. Manual 30-sec check captures 80% of value. |
| Funding-source tracing | Requires graph DB + backend. Browser can't do this. Add later with profits. |
| Real-time cluster monitoring (50+ wallets) | Requires backend. Browser limited to top 10 wallets every 60 sec. |
| Backend infrastructure | Build browser-only first. Prove profitability. Fund backend with profits. |

---

## 4. SUCCESS METRICS

| Metric | Target |
|--------|--------|
| Paper-trade win rate | >40% (500+ trades) |
| Profit factor | >2:1 |
| Avg winner / avg loser | >3:1 |
| Max drawdown | <20% |
| Avg hold time | <30 min |
| Safety gate rejection rate | >80% |
| Tradeable tokens per day | 0-3 |
| Daily loss limit hits | <2 per week |
| Live win rate (first 100) | >35% |
| Live cumulative PnL (first 100) | Positive |

---

## 5. DELIVERABLES

### Backend Logic (JavaScript)
1. Platform-specific filtering engine
2. Sell pressure + liquidity/mcap hard filters
3. Age penalty system
4. Social presence scoring integration
5. AntiRug fix
6. Time-decay exit engine
7. Profit-locking tier system
8. Event-based emergency exits
9. Wallet tracking (snapshot + 60-sec poll)
10. Risk management enforcer (daily limits, consecutive losses, winner's curse, portfolio heat, sleep rule)
11. Market state adapter
12. Backtesting framework
13. Wallet performance tracker
14. Lightweight cluster detection
15. Live trading gates

### UI (HTML/CSS)
1. Platform tags on token cards (color-coded)
2. Rejection reason display (red banner)
3. Safety status badge (green 🛡️ / red ⚠️)
4. Social presence checkboxes (X, Telegram, Website)
5. Watchlist tab (50-64 score tokens)
6. Hidden count (filtered tokens today)
7. Countdown timer on open positions
8. Profit tier progress bar
9. Sell pressure % indicator
10. Risk dashboard (daily PnL, exposure, consecutive losses, break timer)
11. Market state toggle (Frenzy/Normal/Dead)
12. Backtest results page
13. Live trading gate dashboard
14. Performance analytics (win rate by platform, state, tier, hold time)

---

END OF SPECIFICATION
