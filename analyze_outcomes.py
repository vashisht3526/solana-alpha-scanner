#!/usr/bin/env python3
import os
import json
import math
from datetime import datetime

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
TRADES_FILE = os.path.join(DATA_DIR, 'trades_sync.json')
OUTCOMES_FILE = os.path.join(DATA_DIR, 'outcomes_sync.json')
ALERTS_FILE = os.path.join(DATA_DIR, 'alerts_sync.json')
REPORT_FILE = os.path.join(DATA_DIR, 'analysis_report.md')

def load_json(filepath):
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading {filepath}: {e}")
        return []

def format_usd(val):
    if val is None:
        return "$0"
    if val >= 1e6:
        return f"${val/1e6:.2f}M"
    if val >= 1e3:
        return f"${val/1e3:.1f}K"
    return f"${val:.2f}"

def run_analysis():
    print("=" * 60)
    print("  SOLANA ALPHA SCANNER - LOCAL DATABASE ANALYTICS ENGINE ")
    print("=" * 60)

    trades = load_json(TRADES_FILE)
    outcomes = load_json(OUTCOMES_FILE)
    alerts = load_json(ALERTS_FILE)

    if not trades and not outcomes:
        print("[!] No synced database files found in the 'data/' folder.")
        print("   Please open the scanner dashboard, connect your workspace folder,")
        print("   and wait 30 seconds for the auto-sync to populate the local directory.")
        return

    # --- 1. TRADE PERFORMANCE METRICS ---
    total_trades = len(trades)
    closed_trades = [t for t in trades if t.get('status') == 'closed']
    open_trades = [t for t in trades if t.get('status') == 'open']
    
    wins = [t for t in closed_trades if (t.get('finalPnl') or t.get('pnlSol') or 0) > 0]
    losses = [t for t in closed_trades if (t.get('finalPnl') or t.get('pnlSol') or 0) <= 0]
    
    win_rate = (len(wins) / len(closed_trades) * 100) if closed_trades else 0
    total_pnl = sum((t.get('finalPnl') or t.get('pnlSol') or 0) for t in closed_trades)
    
    avg_win = (sum((t.get('finalPnl') or t.get('pnlSol') or 0) for t in wins) / len(wins)) if wins else 0
    avg_loss = (sum((t.get('finalPnl') or t.get('pnlSol') or 0) for t in losses) / len(losses)) if losses else 0
    profit_factor = (sum((t.get('finalPnl') or t.get('pnlSol') or 0) for t in wins) / abs(sum((t.get('finalPnl') or t.get('pnlSol') or 0) for t in losses))) if losses and sum((t.get('finalPnl') or t.get('pnlSol') or 0) for t in losses) != 0 else float('inf')

    # Hold time analysis
    def get_hold_duration(t):
        entry = t.get('entryTime', 0)
        exit = t.get('exitTime', 0) or t.get('lastPriceUpdate', 0) or entry
        return max(0, (exit - entry) / 1000 / 60) # minutes

    avg_hold_win = (sum(get_hold_duration(t) for t in wins) / len(wins)) if wins else 0
    avg_hold_loss = (sum(get_hold_duration(t) for t in losses) / len(losses)) if losses else 0

    print("\n[Paper Trading Metrics]")
    print(f"  - Total Executed:    {total_trades} (Open: {len(open_trades)} | Closed: {len(closed_trades)})")
    print(f"  - Net Realized PnL:  {total_pnl:+.4f} SOL")
    print(f"  - Win Rate:          {win_rate:.1f}% ({len(wins)} W | {len(losses)} L)")
    print(f"  - Profit Factor:     {profit_factor:.2f}")
    print(f"  - Avg Win Size:      {avg_win:+.4f} SOL (Avg Hold: {avg_hold_win:.1f}m)")
    print(f"  - Avg Loss Size:     {avg_loss:+.4f} SOL (Avg Hold: {avg_hold_loss:.1f}m)")

    # --- 2. OUTCOME MULTI-BAGGER METRICS ---
    print("\n[Token Outcome Analytics]")
    
    total_outcomes = len(outcomes)
    multibagger_3x = 0
    multibagger_5x = 0
    multibagger_10x = 0
    rugs = 0
    
    # Bucket scores to evaluate accuracy
    score_buckets = {
        '50-59': {'count': 0, 'peak_gains': []},
        '60-69': {'count': 0, 'peak_gains': []},
        '70-79': {'count': 0, 'peak_gains': []},
        '80-89': {'count': 0, 'peak_gains': []},
        '90+':   {'count': 0, 'peak_gains': []}
    }

    for token in outcomes:
        # Calculate peak gain reached
        entry_price = token.get('priceUsd', 0)
        history = token.get('history', [])
        peak_price = entry_price
        
        for h in history:
            price = h.get('priceUsd', 0)
            if price > peak_price:
                peak_price = price
                
        multiplier = (peak_price / entry_price) if entry_price > 0 else 1
        
        # Check if rugged (current price falls below 95% of entry or liquidity drops to zero)
        current_price = token.get('currentPriceUsd', 0)
        price_drop = ((entry_price - current_price) / entry_price * 100) if entry_price > 0 else 0
        if price_drop > 90 or token.get('liquidity', 0) < 500:
            rugs += 1
            
        if multiplier >= 10:
            multibagger_10x += 1
            multibagger_5x += 1
            multibagger_3x += 1
        elif multiplier >= 5:
            multibagger_5x += 1
            multibagger_3x += 1
        elif multiplier >= 3:
            multibagger_3x += 1

        # Classify by score
        score = token.get('discoveredScore')
        if score is None:
            score = token.get('score', {}).get('total', 0)
        bucket = None
        if score >= 90: bucket = '90+'
        elif score >= 80: bucket = '80-89'
        elif score >= 70: bucket = '70-79'
        elif score >= 60: bucket = '60-69'
        elif score >= 50: bucket = '50-59'
        
        if bucket:
            score_buckets[bucket]['count'] += 1
            score_buckets[bucket]['peak_gains'].append(multiplier)

    rug_rate = (rugs / total_outcomes * 100) if total_outcomes else 0
    print(f"  - Total Tracked Tokens: {total_outcomes}")
    print(f"  - Rug/Abandon Rate:     {rug_rate:.1f}% ({rugs} tokens dumped >90% or zero liquidity)")
    print(f"  - Multibagger Rate (>=3x): {(multibagger_3x/total_outcomes*100) if total_outcomes else 0:.1f}% ({multibagger_3x} tokens)")
    print(f"  - Multibagger Rate (>=5x): {(multibagger_5x/total_outcomes*100) if total_outcomes else 0:.1f}% ({multibagger_5x} tokens)")
    print(f"  - Multibagger Rate (>=10x): {(multibagger_10x/total_outcomes*100) if total_outcomes else 0:.1f}% ({multibagger_10x} tokens)")

    # --- 3. EVALUATE SNIPER SCORE CORRELATION ---
    print("\n[Sniper Score vs. Multiplier Correlation]")
    print(f"  {'Score Range':<15} | {'Token Count':<12} | {'Avg Peak Multiplier':<20} | {'Multibagger % (>=3x)':<20}")
    print("  " + "-" * 75)
    
    markdown_table = []
    
    for bucket in sorted(score_buckets.keys()):
        data = score_buckets[bucket]
        count = data['count']
        avg_mult = (sum(data['peak_gains']) / count) if count else 1.0
        pct_3x = (len([g for g in data['peak_gains'] if g >= 3]) / count * 100) if count else 0.0
        
        print(f"  {bucket:<15} | {count:<12} | {avg_mult:.2f}x {'':<16} | {pct_3x:.1f}%")
        markdown_table.append(f"| {bucket} | {count} | {avg_mult:.2f}x | {pct_3x:.1f}% |")

    # Generate Markdown Report
    report_content = f"""# Solana Alpha Scanner — Analysis Report
Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## Paper Trading Summary
* **Total Trades:** {total_trades} (Open: {len(open_trades)} | Closed: {len(closed_trades)})
* **Net Realized PnL:** {total_pnl:+.4f} SOL
* **Win Rate:** {win_rate:.1f}% ({len(wins)} Wins | {len(losses)} Losses)
* **Profit Factor:** {profit_factor:.2f}
* **Average Win Size:** {avg_win:+.4f} SOL (Avg Hold: {avg_hold_win:.1f} minutes)
* **Average Loss Size:** {avg_loss:+.4f} SOL (Avg Hold: {avg_hold_loss:.1f} minutes)

## Token Outcome Analytics
* **Total Tracked Tokens:** {total_outcomes}
* **Rug/Abandon Rate:** {rug_rate:.1f}% ({rugs} tokens dumped >90%)
* **3x+ Multibaggers:** {multibagger_3x} ({(multibagger_3x/total_outcomes*100) if total_outcomes else 0:.1f}%)
* **5x+ Multibaggers:** {multibagger_5x} ({(multibagger_5x/total_outcomes*100) if total_outcomes else 0:.1f}%)
* **10x+ Multibaggers:** {multibagger_10x} ({(multibagger_10x/total_outcomes*100) if total_outcomes else 0:.1f}%)

## Sniper Score Correlation Table
| Score Range | Token Count | Avg Peak Multiplier | Multibagger % (>=3x) |
|-------------|-------------|---------------------|----------------------|
""" + "\n".join(markdown_table) + "\n"

    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(REPORT_FILE, 'w', encoding='utf-8') as f:
            f.write(report_content)
        print(f"\n[report] Detailed report generated at: {REPORT_FILE}")
    except Exception as e:
        print(f"Failed to write report: {e}")

    print("=" * 60)

if __name__ == '__main__':
    run_analysis()
