"""
Solana Alpha Scanner — Deep Data Analysis
==========================================
Analyzes the 112MB backup JSON for actionable trading patterns.
Outputs a comprehensive report to analyze_results.md
"""

import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP = os.path.join(PROJECT_ROOT, "data", "solana_scanner_backup_2026-07-18.json")
OUTPUT = os.path.join(PROJECT_ROOT, "docs", "analyze_results.md")

print("Loading 112MB backup file...")
with open(BACKUP, "r", encoding="utf-8") as f:
    db = json.load(f)

outcomes = db.get("outcomes", [])
alerts = db.get("alerts", [])
trades = db.get("trades", [])
wallets = db.get("wallets", [])
tokens = db.get("tokens", [])
scans = db.get("scans", [])
clusters = db.get("clusters", [])
settings = db.get("settings", [])

print(f"Loaded: {len(outcomes)} outcomes, {len(alerts)} alerts, {len(trades)} trades, {len(wallets)} wallets, {len(clusters)} clusters")

lines = []
def w(s=""):
    lines.append(s)

def fmt(n):
    if n is None: return "N/A"
    if isinstance(n, float):
        if abs(n) >= 1_000_000: return f"${n/1_000_000:.2f}M"
        if abs(n) >= 1_000: return f"${n/1_000:.1f}K"
        return f"${n:.2f}"
    return str(n)

def pct(n):
    if n is None: return "N/A"
    return f"{n:.1f}%"

def safe_float(v, default=0):
    try: return float(v) if v is not None else default
    except: return default

# ============================================================
# SECTION 1: OUTCOME ANALYSIS — What predicts multibaggers?
# ============================================================
w("# 🔬 Solana Alpha Scanner — Deep Data Analysis Report")
w(f"\n**Generated**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
w(f"\n**Data Source**: `solana_scanner_backup_2026-07-18.json` (112MB)")
w()
w("---")
w()
w("## 1. OUTCOME ANALYSIS — What Predicts Multibaggers?")
w()
w(f"**Total tracked outcomes**: {len(outcomes)}")

multibaggers = [o for o in outcomes if o.get("wasMultibagger")]
non_multi = [o for o in outcomes if not o.get("wasMultibagger")]

w(f"- **Multibaggers (≥2x)**: {len(multibaggers)} ({len(multibaggers)/max(len(outcomes),1)*100:.1f}%)")
w(f"- **Non-multibaggers**: {len(non_multi)} ({len(non_multi)/max(len(outcomes),1)*100:.1f}%)")
w()

# Peak multiplier distribution
peak_mults = [safe_float(o.get("peakMultiplier", 0)) for o in outcomes]
peak_mults_sorted = sorted(peak_mults, reverse=True)

w("### 1.1 Peak Multiplier Distribution")
w()
w("| Range | Count | % |")
w("|-------|-------|---|")
ranges = [
    ("10x+", lambda x: x >= 10),
    ("5x-10x", lambda x: 5 <= x < 10),
    ("3x-5x", lambda x: 3 <= x < 5),
    ("2x-3x", lambda x: 2 <= x < 3),
    ("1.5x-2x", lambda x: 1.5 <= x < 2),
    ("1x-1.5x", lambda x: 1 <= x < 1.5),
    ("< 1x (loss)", lambda x: x < 1),
]
for label, fn in ranges:
    cnt = sum(1 for x in peak_mults if fn(x))
    w(f"| {label} | {cnt} | {cnt/max(len(peak_mults),1)*100:.1f}% |")

w()
w(f"**Top 10 highest peak multipliers:**")
w()
top_outcomes = sorted(outcomes, key=lambda o: safe_float(o.get("peakMultiplier", 0)), reverse=True)[:10]
w("| Token | Score | Grade | Discovery MCap | Discovery Liq | Peak MCap | Peak Mult | Holders |")
w("|-------|-------|-------|----------------|---------------|-----------|-----------|---------|")
for o in top_outcomes:
    w(f"| {o.get('symbol','?')} | {o.get('discoveredScore','?')} | {o.get('discoveredGrade','?')} | {fmt(safe_float(o.get('discoveredMCap')))} | {fmt(safe_float(o.get('discoveredLiq')))} | {fmt(safe_float(o.get('peakMCap')))} | {safe_float(o.get('peakMultiplier',0)):.1f}x | {o.get('discoveredHolder','?')} |")

# ---- Score vs Peak Multiplier correlation ----
w()
w("### 1.2 Discovery Score vs Peak Multiplier")
w()
w("*Does a higher discovery score predict bigger gains?*")
w()

score_buckets = defaultdict(list)
for o in outcomes:
    s = safe_float(o.get("discoveredScore", 0))
    pm = safe_float(o.get("peakMultiplier", 0))
    if s >= 80: score_buckets["80-100"].append(pm)
    elif s >= 60: score_buckets["60-79"].append(pm)
    elif s >= 40: score_buckets["40-59"].append(pm)
    elif s >= 20: score_buckets["20-39"].append(pm)
    else: score_buckets["0-19"].append(pm)

w("| Score Range | Count | Avg Peak Mult | Median Peak Mult | % Multibagger | Max Peak |")
w("|------------|-------|---------------|------------------|---------------|----------|")
for bucket in ["80-100", "60-79", "40-59", "20-39", "0-19"]:
    vals = score_buckets.get(bucket, [])
    if vals:
        avg = sum(vals)/len(vals)
        sorted_v = sorted(vals)
        med = sorted_v[len(sorted_v)//2]
        mb_pct = sum(1 for v in vals if v >= 2) / len(vals) * 100
        mx = max(vals)
        w(f"| {bucket} | {len(vals)} | {avg:.2f}x | {med:.2f}x | {mb_pct:.1f}% | {mx:.1f}x |")
    else:
        w(f"| {bucket} | 0 | - | - | - | - |")

# ---- Grade vs Peak Multiplier ----
w()
w("### 1.3 Discovery Grade vs Peak Multiplier")
w()

grade_buckets = defaultdict(list)
for o in outcomes:
    g = o.get("discoveredGrade", "?")
    pm = safe_float(o.get("peakMultiplier", 0))
    grade_buckets[g].append(pm)

w("| Grade | Count | Avg Peak Mult | % Multibagger | Best Token | Best Mult |")
w("|-------|-------|---------------|---------------|------------|-----------|")
for grade in ["A+", "A", "B+", "B", "C+", "C", "D", "F"]:
    vals = grade_buckets.get(grade, [])
    if vals:
        avg = sum(vals)/len(vals)
        mb_pct = sum(1 for v in vals if v >= 2) / len(vals) * 100
        # find best token in this grade
        best = max([o for o in outcomes if o.get("discoveredGrade") == grade], key=lambda o: safe_float(o.get("peakMultiplier",0)), default=None)
        best_sym = best.get("symbol","?") if best else "?"
        best_mult = safe_float(best.get("peakMultiplier",0)) if best else 0
        w(f"| {grade} | {len(vals)} | {avg:.2f}x | {mb_pct:.1f}% | {best_sym} | {best_mult:.1f}x |")

# ---- MCap at discovery vs outcome ----
w()
w("### 1.4 Market Cap at Discovery vs Outcome")
w()
w("*What MCap range at discovery produces the best multipliers?*")
w()

mcap_buckets = defaultdict(list)
for o in outcomes:
    mc = safe_float(o.get("discoveredMCap", 0))
    pm = safe_float(o.get("peakMultiplier", 0))
    if mc <= 0: mcap_buckets["Unknown"].append(pm)
    elif mc < 10_000: mcap_buckets["< $10K"].append(pm)
    elif mc < 50_000: mcap_buckets["$10K-$50K"].append(pm)
    elif mc < 100_000: mcap_buckets["$50K-$100K"].append(pm)
    elif mc < 500_000: mcap_buckets["$100K-$500K"].append(pm)
    elif mc < 1_000_000: mcap_buckets["$500K-$1M"].append(pm)
    else: mcap_buckets["> $1M"].append(pm)

w("| MCap at Discovery | Count | Avg Peak Mult | Median | % Multibagger | Max |")
w("|-------------------|-------|---------------|--------|---------------|-----|")
for bucket in ["< $10K", "$10K-$50K", "$50K-$100K", "$100K-$500K", "$500K-$1M", "> $1M", "Unknown"]:
    vals = mcap_buckets.get(bucket, [])
    if vals:
        avg = sum(vals)/len(vals)
        sorted_v = sorted(vals)
        med = sorted_v[len(sorted_v)//2]
        mb_pct = sum(1 for v in vals if v >= 2)/len(vals)*100
        mx = max(vals)
        w(f"| {bucket} | {len(vals)} | {avg:.2f}x | {med:.2f}x | {mb_pct:.1f}% | {mx:.1f}x |")

# ---- Liquidity at discovery vs outcome ----
w()
w("### 1.5 Liquidity at Discovery vs Outcome")
w()

liq_buckets = defaultdict(list)
for o in outcomes:
    lq = safe_float(o.get("discoveredLiq", 0))
    pm = safe_float(o.get("peakMultiplier", 0))
    if lq <= 0: liq_buckets["Unknown"].append(pm)
    elif lq < 5_000: liq_buckets["< $5K"].append(pm)
    elif lq < 20_000: liq_buckets["$5K-$20K"].append(pm)
    elif lq < 50_000: liq_buckets["$20K-$50K"].append(pm)
    elif lq < 100_000: liq_buckets["$50K-$100K"].append(pm)
    else: liq_buckets["> $100K"].append(pm)

w("| Liquidity at Discovery | Count | Avg Peak Mult | % Multibagger | Max |")
w("|------------------------|-------|---------------|---------------|-----|")
for bucket in ["< $5K", "$5K-$20K", "$20K-$50K", "$50K-$100K", "> $100K", "Unknown"]:
    vals = liq_buckets.get(bucket, [])
    if vals:
        avg = sum(vals)/len(vals)
        mb_pct = sum(1 for v in vals if v >= 2)/len(vals)*100
        mx = max(vals)
        w(f"| {bucket} | {len(vals)} | {avg:.2f}x | {mb_pct:.1f}% | {mx:.1f}x |")

# ---- Holder count at discovery ----
w()
w("### 1.6 Holder Count at Discovery vs Outcome")
w()

holder_buckets = defaultdict(list)
for o in outcomes:
    h = safe_float(o.get("discoveredHolder", 0))
    pm = safe_float(o.get("peakMultiplier", 0))
    if h <= 0: holder_buckets["Unknown"].append(pm)
    elif h < 50: holder_buckets["< 50"].append(pm)
    elif h < 100: holder_buckets["50-100"].append(pm)
    elif h < 300: holder_buckets["100-300"].append(pm)
    elif h < 500: holder_buckets["300-500"].append(pm)
    elif h < 1000: holder_buckets["500-1000"].append(pm)
    else: holder_buckets["1000+"].append(pm)

w("| Holders at Discovery | Count | Avg Peak Mult | % Multibagger | Max |")
w("|----------------------|-------|---------------|---------------|-----|")
for bucket in ["< 50", "50-100", "100-300", "300-500", "500-1000", "1000+", "Unknown"]:
    vals = holder_buckets.get(bucket, [])
    if vals:
        avg = sum(vals)/len(vals)
        mb_pct = sum(1 for v in vals if v >= 2)/len(vals)*100
        mx = max(vals)
        w(f"| {bucket} | {len(vals)} | {avg:.2f}x | {mb_pct:.1f}% | {mx:.1f}x |")

# ---- Score breakdown analysis for multibaggers vs non-multibaggers ----
w()
w("### 1.7 Score Component Breakdown — Multibaggers vs Non-Multibaggers")
w()
w("*Which scoring sub-components best separate winners from losers?*")
w()

# Collect score breakdowns
mb_components = defaultdict(list)
non_mb_components = defaultdict(list)

for o in outcomes:
    bd = o.get("scoreBreakdown", {})
    is_mb = o.get("wasMultibagger", False)
    if isinstance(bd, dict):
        for key, val in bd.items():
            v = safe_float(val)
            if is_mb:
                mb_components[key].append(v)
            else:
                non_mb_components[key].append(v)

if mb_components:
    all_keys = sorted(set(list(mb_components.keys()) + list(non_mb_components.keys())))
    w("| Component | Multibagger Avg | Non-Multi Avg | Δ (Difference) | Predictive? |")
    w("|-----------|-----------------|---------------|----------------|-------------|")
    for key in all_keys:
        mb_vals = mb_components.get(key, [])
        non_vals = non_mb_components.get(key, [])
        mb_avg = sum(mb_vals)/len(mb_vals) if mb_vals else 0
        non_avg = sum(non_vals)/len(non_vals) if non_vals else 0
        delta = mb_avg - non_avg
        predictive = "✅ Strong" if abs(delta) > 3 else ("⚠️ Moderate" if abs(delta) > 1 else "❌ Weak")
        w(f"| {key} | {mb_avg:.1f} | {non_avg:.1f} | {delta:+.1f} | {predictive} |")

# ---- Holder pattern analysis ----
w()
w("### 1.8 Holder Growth Patterns")
w()

holder_patterns = Counter()
for o in outcomes:
    pat = o.get("holderPattern", "unknown")
    holder_patterns[pat] += 1

pattern_mults = defaultdict(list)
for o in outcomes:
    pat = o.get("holderPattern", "unknown")
    pm = safe_float(o.get("peakMultiplier", 0))
    pattern_mults[pat].append(pm)

w("| Holder Pattern | Count | Avg Peak Mult | % Multibagger |")
w("|----------------|-------|---------------|---------------|")
for pat, cnt in holder_patterns.most_common():
    vals = pattern_mults[pat]
    avg = sum(vals)/len(vals) if vals else 0
    mb_pct = sum(1 for v in vals if v >= 2)/max(len(vals),1)*100
    w(f"| {pat} | {cnt} | {avg:.2f}x | {mb_pct:.1f}% |")


# ============================================================
# SECTION 2: ALERT ANALYSIS
# ============================================================
w()
w("---")
w()
w("## 2. ALERT ANALYSIS — Score & Grade Distributions")
w()
w(f"**Total alerts**: {len(alerts)}")

# Grade distribution
alert_grades = Counter()
for a in alerts:
    alert_grades[a.get("grade", "?")] += 1

w()
w("### 2.1 Alert Grade Distribution")
w()
w("| Grade | Count | % |")
w("|-------|-------|---|")
for grade in ["A+", "A", "B+", "B", "C+", "C", "D", "F", "?"]:
    cnt = alert_grades.get(grade, 0)
    if cnt > 0:
        w(f"| {grade} | {cnt} | {cnt/max(len(alerts),1)*100:.1f}% |")

# Score distribution
alert_scores = [safe_float(a.get("score", 0)) for a in alerts]
w()
w("### 2.2 Alert Score Distribution")
w()
w(f"- **Mean score**: {sum(alert_scores)/max(len(alert_scores),1):.1f}")
w(f"- **Min**: {min(alert_scores) if alert_scores else 'N/A'}")
w(f"- **Max**: {max(alert_scores) if alert_scores else 'N/A'}")
w()

score_hist = defaultdict(int)
for s in alert_scores:
    if s >= 90: score_hist["90-100"] += 1
    elif s >= 80: score_hist["80-89"] += 1
    elif s >= 70: score_hist["70-79"] += 1
    elif s >= 60: score_hist["60-69"] += 1
    elif s >= 50: score_hist["50-59"] += 1
    elif s >= 40: score_hist["40-49"] += 1
    else: score_hist["< 40"] += 1

w("| Score Range | Count | % |")
w("|------------|-------|---|")
for bucket in ["90-100", "80-89", "70-79", "60-69", "50-59", "40-49", "< 40"]:
    cnt = score_hist.get(bucket, 0)
    w(f"| {bucket} | {cnt} | {cnt/max(len(alerts),1)*100:.1f}% |")

# Alert frequency over time
w()
w("### 2.3 Alert Volume Over Time")
w()
alert_by_hour = defaultdict(int)
for a in alerts:
    ts = a.get("timestamp") or a.get("time")
    if ts:
        try:
            if isinstance(ts, (int, float)):
                dt = datetime.fromtimestamp(ts/1000 if ts > 1e12 else ts, tz=timezone.utc)
            else:
                dt = datetime.fromisoformat(str(ts).replace("Z","+00:00"))
            key = dt.strftime("%Y-%m-%d %H:00")
            alert_by_hour[key] += 1
        except:
            pass

if alert_by_hour:
    sorted_hours = sorted(alert_by_hour.items())
    w(f"- **First alert**: {sorted_hours[0][0]}")
    w(f"- **Last alert**: {sorted_hours[-1][0]}")
    w(f"- **Total unique hours with alerts**: {len(sorted_hours)}")
    hourly_counts = list(alert_by_hour.values())
    w(f"- **Avg alerts/hour**: {sum(hourly_counts)/max(len(hourly_counts),1):.1f}")
    w(f"- **Peak hour**: {max(alert_by_hour.items(), key=lambda x: x[1])}")

# Most alerted tokens
w()
w("### 2.4 Most Frequently Alerted Tokens")
w()
token_alert_count = Counter()
token_best_score = defaultdict(float)
for a in alerts:
    sym = a.get("tokenSymbol", "?")
    token_alert_count[sym] += 1
    s = safe_float(a.get("score", 0))
    if s > token_best_score[sym]:
        token_best_score[sym] = s

w("| Token | Alert Count | Best Score | In Outcomes? | Peak Mult |")
w("|-------|-------------|------------|--------------|-----------|")
outcome_map = {o.get("symbol",""): o for o in outcomes}
for sym, cnt in token_alert_count.most_common(20):
    best = token_best_score.get(sym, 0)
    in_out = "✅" if sym in outcome_map else "❌"
    pm = safe_float(outcome_map[sym].get("peakMultiplier", 0)) if sym in outcome_map else 0
    pm_str = f"{pm:.1f}x" if pm > 0 else "-"
    w(f"| {sym} | {cnt} | {best:.0f} | {in_out} | {pm_str} |")


# ============================================================
# SECTION 3: TRADE ANALYSIS
# ============================================================
w()
w("---")
w()
w("## 3. PAPER TRADE ANALYSIS")
w()
w(f"**Total trades**: {len(trades)}")

# Separate open vs closed
open_trades = [t for t in trades if t.get("status") == "open" or not t.get("closeTime")]
closed_trades = [t for t in trades if t.get("status") == "closed" or t.get("closeTime")]

# If no clear status, try to infer
if not closed_trades and not open_trades:
    open_trades = trades  # all are open if no status field

w(f"- **Open positions**: {len(open_trades)}")
w(f"- **Closed positions**: {len(closed_trades)}")
w()

# Analyze all trades
w("### 3.1 Trade Details")
w()
w("| Token | Entry Price | Current Price | Position (SOL) | SL | TP | PnL % | Status |")
w("|-------|-------------|---------------|----------------|----|----|-------|--------|")

total_pnl_pct = []
for t in trades[:30]:  # limit display to 30
    ep = safe_float(t.get("entryPrice", 0))
    cp = safe_float(t.get("currentPrice", 0))
    ps = safe_float(t.get("positionSize", 0))
    sl = safe_float(t.get("stopLoss", 0))
    tp = safe_float(t.get("takeProfit", 0))
    pnl = ((cp - ep) / ep * 100) if ep > 0 else 0
    total_pnl_pct.append(pnl)
    status = t.get("status", "open")
    sym = t.get("tokenSymbol", "?")
    w(f"| {sym} | {ep:.8f} | {cp:.8f} | {ps:.2f} | {sl*100:.0f}% | {tp*100:.0f}% | {pnl:+.1f}% | {status} |")

if total_pnl_pct:
    w()
    w(f"**Average PnL across all trades**: {sum(total_pnl_pct)/len(total_pnl_pct):+.1f}%")
    winners = [p for p in total_pnl_pct if p > 0]
    losers = [p for p in total_pnl_pct if p < 0]
    w(f"**Win rate**: {len(winners)/max(len(total_pnl_pct),1)*100:.1f}% ({len(winners)}/{len(total_pnl_pct)})")
    if winners: w(f"**Avg winner**: +{sum(winners)/len(winners):.1f}%")
    if losers: w(f"**Avg loser**: {sum(losers)/len(losers):.1f}%")

# Entry parameters
w()
w("### 3.2 Trade Entry Parameters")
w()
slippage_vals = [safe_float(t.get("slippage",0))*100 for t in trades if t.get("slippage")]
latency_vals = [safe_float(t.get("latency",0)) for t in trades if t.get("latency")]
liq_vals = [safe_float(t.get("liquidityUsd",0)) for t in trades if t.get("liquidityUsd")]

if slippage_vals:
    w(f"- **Slippage**: min={min(slippage_vals):.1f}%, max={max(slippage_vals):.1f}%, avg={sum(slippage_vals)/len(slippage_vals):.1f}%")
if latency_vals:
    w(f"- **Latency**: min={min(latency_vals):.0f}ms, max={max(latency_vals):.0f}ms, avg={sum(latency_vals)/len(latency_vals):.0f}ms")
if liq_vals:
    w(f"- **Entry Liquidity**: min={fmt(min(liq_vals))}, max={fmt(max(liq_vals))}, avg={fmt(sum(liq_vals)/len(liq_vals))}")


# ============================================================
# SECTION 4: WALLET ANALYSIS
# ============================================================
w()
w("---")
w()
w("## 4. WALLET INTELLIGENCE")
w()
w(f"**Total tracked wallets**: {len(wallets)}")

alpha_wallets = [wl for wl in wallets if wl.get("isAlpha")]
w(f"- **Alpha wallets**: {len(alpha_wallets)} ({len(alpha_wallets)/max(len(wallets),1)*100:.1f}%)")
w()

# Win rate distribution
w("### 4.1 Wallet Win Rate Distribution")
w()
wr_buckets = defaultdict(int)
for wl in wallets:
    wr = safe_float(wl.get("winRate", 0)) * 100
    if wr >= 80: wr_buckets["80-100%"] += 1
    elif wr >= 60: wr_buckets["60-79%"] += 1
    elif wr >= 40: wr_buckets["40-59%"] += 1
    elif wr >= 20: wr_buckets["20-39%"] += 1
    else: wr_buckets["0-19%"] += 1

w("| Win Rate | Count | % |")
w("|----------|-------|---|")
for bucket in ["80-100%", "60-79%", "40-59%", "20-39%", "0-19%"]:
    cnt = wr_buckets.get(bucket, 0)
    w(f"| {bucket} | {cnt} | {cnt/max(len(wallets),1)*100:.1f}% |")

# PnL score distribution
w()
w("### 4.2 Wallet PnL Score Distribution")
w()
pnl_scores = [safe_float(wl.get("pnlScore", 0)) for wl in wallets]
if pnl_scores:
    w(f"- **Mean PnL Score**: {sum(pnl_scores)/len(pnl_scores):.2f}")
    w(f"- **Max PnL Score**: {max(pnl_scores):.2f}")
    w(f"- **Min PnL Score**: {min(pnl_scores):.2f}")

# Transaction count distribution
w()
w("### 4.3 Wallet Activity Levels")
w()
tx_counts = [safe_float(wl.get("txCount", 0)) for wl in wallets]
volumes = [safe_float(wl.get("volume", 0)) for wl in wallets]
if tx_counts:
    w(f"- **Avg transactions per wallet**: {sum(tx_counts)/len(tx_counts):.1f}")
    w(f"- **Max transactions**: {max(tx_counts):.0f}")
    w(f"- **Total volume tracked**: {fmt(sum(volumes))}")

# Top alpha wallets
w()
w("### 4.4 Top 15 Alpha Wallets")
w()
sorted_wallets = sorted(alpha_wallets, key=lambda x: safe_float(x.get("pnlScore",0)), reverse=True)[:15]
w("| # | Address (short) | Win Rate | PnL Score | Tx Count | Volume | Labels |")
w("|---|-----------------|----------|-----------|----------|--------|--------|")
for i, wl in enumerate(sorted_wallets, 1):
    addr = wl.get("address", "?")
    short_addr = addr[:6] + "..." + addr[-4:] if len(addr) > 10 else addr
    wr = safe_float(wl.get("winRate", 0)) * 100
    pnl = safe_float(wl.get("pnlScore", 0))
    txc = safe_float(wl.get("txCount", 0))
    vol = safe_float(wl.get("volume", 0))
    labels = ", ".join(wl.get("labels", [])) if isinstance(wl.get("labels"), list) else str(wl.get("labels", ""))
    w(f"| {i} | `{short_addr}` | {wr:.0f}% | {pnl:.2f} | {txc:.0f} | {fmt(vol)} | {labels} |")

# Wallet label analysis
w()
w("### 4.5 Wallet Label Distribution")
w()
label_counter = Counter()
for wl in wallets:
    labels = wl.get("labels", [])
    if isinstance(labels, list):
        for l in labels:
            label_counter[l] += 1

if label_counter:
    w("| Label | Count |")
    w("|-------|-------|")
    for label, cnt in label_counter.most_common(15):
        w(f"| {label} | {cnt} |")


# ============================================================
# SECTION 5: CLUSTER ANALYSIS
# ============================================================
w()
w("---")
w()
w("## 5. CLUSTER / SYNDICATE ANALYSIS")
w()
w(f"**Total cluster relationships**: {len(clusters)}")

# Cluster type distribution
cluster_types = Counter()
for c in clusters:
    cluster_types[c.get("type", "?")] += 1

w()
w("### 5.1 Cluster Relationship Types")
w()
w("| Type | Count | % |")
w("|------|-------|---|")
for ct, cnt in cluster_types.most_common():
    w(f"| {ct} | {cnt:,} | {cnt/max(len(clusters),1)*100:.1f}% |")

# Cluster size distribution
w()
w("### 5.2 Most Connected Wallets (Cluster Hubs)")
w()
wallet_connections = Counter()
for c in clusters:
    wallet_connections[c.get("walletA", "?")] += 1
    wallet_connections[c.get("walletB", "?")] += 1

w("| # | Wallet (short) | Connections | Is Alpha? |")
w("|---|----------------|-------------|-----------|")
alpha_set = set(wl.get("address","") for wl in wallets if wl.get("isAlpha"))
for i, (addr, cnt) in enumerate(wallet_connections.most_common(15), 1):
    short = addr[:6] + "..." + addr[-4:] if len(addr) > 10 else addr
    is_a = "✅" if addr in alpha_set else "❌"
    w(f"| {i} | `{short}` | {cnt:,} | {is_a} |")

# Cluster total amounts
w()
w("### 5.3 Largest Cluster Relationships by Total Amount")
w()
sorted_clusters = sorted(clusters, key=lambda c: safe_float(c.get("totalAmount", 0)), reverse=True)[:15]
w("| Wallet A | Wallet B | Type | Count | Total Amount |")
w("|----------|----------|------|-------|-------------|")
for c in sorted_clusters:
    wa = c.get("walletA","?")
    wb = c.get("walletB","?")
    wa_s = wa[:6]+"..."+wa[-4:] if len(wa)>10 else wa
    wb_s = wb[:6]+"..."+wb[-4:] if len(wb)>10 else wb
    w(f"| `{wa_s}` | `{wb_s}` | {c.get('type','?')} | {c.get('count',0)} | {safe_float(c.get('totalAmount',0)):.2f} |")


# ============================================================
# SECTION 6: TOKEN SNAPSHOT ANALYSIS
# ============================================================
w()
w("---")
w()
w("## 6. CURRENT TOKEN SNAPSHOTS")
w()
w(f"**Tokens tracked at backup time**: {len(tokens)}")
w()

# Sort by market cap
sorted_tokens = sorted(tokens, key=lambda t: safe_float(t.get("marketCap", 0)), reverse=True)[:20]
w("### 6.1 Top 20 Tokens by Market Cap")
w()
w("| Token | MCap | Liquidity | Vol 24h | Vol/MCap | Liq/MCap | Price Δ 1h | Price Δ 24h | Age |")
w("|-------|------|-----------|---------|----------|----------|------------|-------------|-----|")
for t in sorted_tokens:
    mc = safe_float(t.get("marketCap", 0))
    liq = safe_float(t.get("liquidity", 0))
    v24 = safe_float(t.get("volume24h", 0))
    vm = v24/mc if mc > 0 else 0
    lm = liq/mc if mc > 0 else 0
    p1h = safe_float(t.get("priceChange1h", 0))
    p24h = safe_float(t.get("priceChange24h", 0))
    created = t.get("createdAt", "?")
    if isinstance(created, (int, float)):
        try:
            age_hrs = (datetime.now(tz=timezone.utc) - datetime.fromtimestamp(created/1000 if created > 1e12 else created, tz=timezone.utc)).total_seconds() / 3600
            age_str = f"{age_hrs:.0f}h"
        except:
            age_str = "?"
    else:
        age_str = "?"
    
    w(f"| {t.get('symbol','?')} | {fmt(mc)} | {fmt(liq)} | {fmt(v24)} | {vm:.2f} | {lm:.2f} | {p1h:+.1f}% | {p24h:+.1f}% | {age_str} |")

# Volume/MCap analysis
w()
w("### 6.2 Volume-to-MCap Ratio Analysis")
w()
vm_ratios = []
for t in tokens:
    mc = safe_float(t.get("marketCap", 0))
    v24 = safe_float(t.get("volume24h", 0))
    if mc > 0:
        vm_ratios.append(v24/mc)

if vm_ratios:
    vm_sorted = sorted(vm_ratios)
    w(f"- **Mean Vol/MCap**: {sum(vm_ratios)/len(vm_ratios):.2f}")
    w(f"- **Median Vol/MCap**: {vm_sorted[len(vm_sorted)//2]:.2f}")
    w(f"- **Min**: {min(vm_ratios):.4f}")
    w(f"- **Max**: {max(vm_ratios):.2f}")

# Liquidity/MCap ratio  
lm_ratios = []
for t in tokens:
    mc = safe_float(t.get("marketCap", 0))
    liq = safe_float(t.get("liquidity", 0))
    if mc > 0:
        lm_ratios.append(liq/mc)

if lm_ratios:
    lm_sorted = sorted(lm_ratios)
    w()
    w("### 6.3 Liquidity-to-MCap Ratio Analysis")
    w()
    w(f"- **Mean Liq/MCap**: {sum(lm_ratios)/len(lm_ratios):.4f}")
    w(f"- **Median Liq/MCap**: {lm_sorted[len(lm_sorted)//2]:.4f}")


# ============================================================
# SECTION 7: SCAN HISTORY
# ============================================================
w()
w("---")
w()
w("## 7. SCAN HISTORY")
w()
w(f"**Total scans**: {len(scans)}")

scan_types = Counter()
for s in scans:
    scan_types[s.get("type", "?")] += 1

w()
w("### 7.1 Scan Types")
w()
w("| Type | Count |")
w("|------|-------|")
for st, cnt in scan_types.most_common():
    w(f"| {st} | {cnt} |")

total_scanned = sum(safe_float(s.get("tokensScanned", 0)) for s in scans)
total_alerts_gen = sum(safe_float(s.get("alertsGenerated", 0)) for s in scans)
w()
w(f"- **Total tokens scanned across all scans**: {int(total_scanned):,}")
w(f"- **Total alerts generated**: {int(total_alerts_gen):,}")
w(f"- **Alert rate**: {total_alerts_gen/max(total_scanned,1)*100:.2f}% of scanned tokens trigger alerts")


# ============================================================
# SECTION 8: KEY INSIGHTS & RECOMMENDATIONS
# ============================================================
w()
w("---")
w()
w("## 8. 🎯 KEY INSIGHTS & TUNING RECOMMENDATIONS")
w()

# Derive insights from the data
w("### 8.1 Multibagger Predictors (from Outcome Data)")
w()

# Best score bucket
best_score_bucket = max(score_buckets.items(), key=lambda x: (sum(1 for v in x[1] if v>=2)/max(len(x[1]),1)) if x[1] else 0)
w(f"1. **Best score range for multibaggers**: {best_score_bucket[0]} (multibagger rate: {sum(1 for v in best_score_bucket[1] if v>=2)/max(len(best_score_bucket[1]),1)*100:.0f}%)")

# Best MCap bucket
best_mcap_bucket = None
best_mcap_rate = 0
for bucket, vals in mcap_buckets.items():
    if vals and bucket != "Unknown":
        rate = sum(1 for v in vals if v >= 2)/len(vals)
        if rate > best_mcap_rate:
            best_mcap_rate = rate
            best_mcap_bucket = bucket
if best_mcap_bucket:
    w(f"2. **Best MCap range at discovery**: {best_mcap_bucket} (multibagger rate: {best_mcap_rate*100:.0f}%)")

# Best Liquidity bucket
best_liq_bucket = None
best_liq_rate = 0
for bucket, vals in liq_buckets.items():
    if vals and bucket != "Unknown":
        rate = sum(1 for v in vals if v >= 2)/len(vals)
        if rate > best_liq_rate:
            best_liq_rate = rate
            best_liq_bucket = bucket
if best_liq_bucket:
    w(f"3. **Best liquidity range at discovery**: {best_liq_bucket} (multibagger rate: {best_liq_rate*100:.0f}%)")

# Best holder range
best_hold_bucket = None
best_hold_rate = 0
for bucket, vals in holder_buckets.items():
    if vals and bucket != "Unknown":
        rate = sum(1 for v in vals if v >= 2)/len(vals)
        if rate > best_hold_rate:
            best_hold_rate = rate
            best_hold_bucket = bucket
if best_hold_bucket:
    w(f"4. **Best holder count at discovery**: {best_hold_bucket} (multibagger rate: {best_hold_rate*100:.0f}%)")

w()
w("### 8.2 System Tuning Suggestions")
w()
w("Based on the above analysis, here are concrete parameter adjustments to consider:")
w()

# Calculate overall multibagger rate
overall_mb_rate = len(multibaggers)/max(len(outcomes),1)*100
w(f"- **Current multibagger discovery rate**: {overall_mb_rate:.1f}% ({len(multibaggers)}/{len(outcomes)})")
w()

# Score threshold
high_score_vals = score_buckets.get("80-100", []) + score_buckets.get("60-79", [])
low_score_vals = score_buckets.get("0-19", []) + score_buckets.get("20-39", [])
if high_score_vals and low_score_vals:
    high_mb = sum(1 for v in high_score_vals if v>=2)/len(high_score_vals)*100
    low_mb = sum(1 for v in low_score_vals if v>=2)/len(low_score_vals)*100
    w(f"- **Score ≥60 multibagger rate**: {high_mb:.1f}% vs Score <40: {low_mb:.1f}% → {'Raise minimum trade threshold' if high_mb > low_mb else 'Score is not strongly predictive'}")

# Score component insights
if mb_components:
    w()
    w("### 8.3 Strongest Predictive Score Components")
    w()
    component_deltas = []
    for key in set(list(mb_components.keys()) + list(non_mb_components.keys())):
        mb_vals = mb_components.get(key, [])
        non_vals = non_mb_components.get(key, [])
        mb_avg = sum(mb_vals)/len(mb_vals) if mb_vals else 0
        non_avg = sum(non_vals)/len(non_vals) if non_vals else 0
        component_deltas.append((key, mb_avg - non_avg, mb_avg, non_avg))
    
    component_deltas.sort(key=lambda x: abs(x[1]), reverse=True)
    w("**Components ranked by predictive power (biggest delta between multibagger vs non-multibagger):**")
    w()
    for i, (key, delta, mb_avg, non_avg) in enumerate(component_deltas, 1):
        direction = "INCREASE weight" if delta > 0 else "DECREASE weight"
        w(f"{i}. **{key}**: Δ={delta:+.2f} (MB avg={mb_avg:.1f}, non-MB avg={non_avg:.1f}) → {direction}")

w()
w("---")
w()
w("*Report generated by Solana Alpha Scanner Data Analyzer*")

# Write the report
report = "\n".join(lines)
with open(OUTPUT, "w", encoding="utf-8") as f:
    f.write(report)

print(f"\n✅ Analysis complete! Report saved to: {OUTPUT}")
print(f"   Report size: {len(report):,} characters, {len(lines)} lines")
print(f"\nQuick Summary:")
print(f"  - Outcomes analyzed: {len(outcomes)}")
print(f"  - Multibagger rate: {len(multibaggers)/max(len(outcomes),1)*100:.1f}%")
print(f"  - Best peak multiplier: {max(peak_mults) if peak_mults else 0:.1f}x")
print(f"  - Alerts analyzed: {len(alerts):,}")
print(f"  - Wallets analyzed: {len(wallets):,}")
print(f"  - Cluster relationships: {len(clusters):,}")
