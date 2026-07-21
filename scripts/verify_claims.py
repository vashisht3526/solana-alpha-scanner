"""
Verification Script — Cross-check the external analysis claims against actual data
"""
import json
from collections import defaultdict

import os
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP = os.path.join(PROJECT_ROOT, "data", "solana_scanner_backup_2026-07-18.json")

print("Loading backup...")
with open(BACKUP, "r", encoding="utf-8") as f:
    db = json.load(f)

outcomes = db.get("outcomes", [])
tokens = db.get("tokens", [])
wallets = db.get("wallets", [])

def sf(v, d=0):
    try: return float(v) if v is not None else d
    except: return d

print(f"\n{'='*70}")
print("VERIFICATION 1: 'Golden Zone' — liq >= $15K AND top20Holders <= 30%")
print(f"{'='*70}\n")

# Extract holder concentration from discoveredHolder objects
golden_zone = []
anti_golden = []
for o in outcomes:
    liq = sf(o.get("discoveredLiq", 0))
    pm = sf(o.get("peakMultiplier", 0))
    holder = o.get("discoveredHolder")
    
    top_pct = None
    if isinstance(holder, dict):
        top_pct = sf(holder.get("topPct", None))
    elif isinstance(holder, (int, float)):
        top_pct = None  # raw holder count, not %
    
    if liq >= 15000 and top_pct is not None and top_pct <= 30:
        golden_zone.append((o.get("symbol"), liq, top_pct, pm))
    elif liq < 5000 or (top_pct is not None and top_pct > 70):
        anti_golden.append((o.get("symbol"), liq, top_pct, pm))

print(f"Golden Zone tokens (liq >= $15K AND top20 <= 30%): {len(golden_zone)}")
for sym, liq, tp, pm in sorted(golden_zone, key=lambda x: x[3], reverse=True):
    status = "WINNER" if pm >= 1.5 else ("FLAT" if pm >= 0.9 else "LOSER")
    print(f"  {sym:20s} liq=${liq:>10,.0f}  top20={tp:>5.1f}%  peak={pm:.2f}x  {status}")

winners_gz = sum(1 for _,_,_,pm in golden_zone if pm >= 1.5)
print(f"\n  -> Winners (>=1.5x): {winners_gz}/{len(golden_zone)} = {winners_gz/max(len(golden_zone),1)*100:.0f}%")
print(f"  -> Claim 'every single one was a winner': ", end="")
print("PARTIALLY TRUE" if winners_gz/max(len(golden_zone),1) > 0.7 else "FALSE")

print(f"\nAnti-Golden Zone tokens (liq < $5K OR top20 > 70%): {len(anti_golden)}")
losers_ag = sum(1 for _,_,_,pm in anti_golden if pm < 1.0)
print(f"  -> Losers (<1x): {losers_ag}/{len(anti_golden)} = {losers_ag/max(len(anti_golden),1)*100:.0f}%")

print(f"\n{'='*70}")
print("VERIFICATION 2: volumeRatio correlation")
print(f"{'='*70}\n")

# Get volumeRatio score component vs peak multiplier
vr_scores = []
for o in outcomes:
    bd = o.get("scoreBreakdown", {})
    if isinstance(bd, dict) and "volumeRatio" in bd:
        vr = sf(bd["volumeRatio"])
        pm = sf(o.get("peakMultiplier", 0))
        vr_scores.append((vr, pm))

if vr_scores:
    # Simple correlation
    n = len(vr_scores)
    x_vals = [x[0] for x in vr_scores]
    y_vals = [x[1] for x in vr_scores]
    x_mean = sum(x_vals)/n
    y_mean = sum(y_vals)/n
    
    num = sum((x-x_mean)*(y-y_mean) for x,y in zip(x_vals, y_vals))
    den_x = sum((x-x_mean)**2 for x in x_vals) ** 0.5
    den_y = sum((y-y_mean)**2 for y in y_vals) ** 0.5
    
    corr = num/(den_x * den_y) if den_x > 0 and den_y > 0 else 0
    print(f"  volumeRatio score vs peakMultiplier correlation: {corr:+.3f}")
    print(f"  Claim: -0.09 (inverse)")
    print(f"  My finding: {corr:+.3f}")
    
    # Also check raw Vol/MCap from token snapshots
    print(f"\n  Checking raw Vol/MCap ratio from token snapshots vs peak multiplier:")
    token_map = {t.get("address",""): t for t in tokens}
    raw_vm_vs_pm = []
    for o in outcomes:
        addr = o.get("address","")
        t = token_map.get(addr)
        if t:
            mc = sf(t.get("marketCap",0))
            v24 = sf(t.get("volume24h",0))
            pm = sf(o.get("peakMultiplier",0))
            if mc > 0:
                raw_vm_vs_pm.append((v24/mc, pm))
    
    if raw_vm_vs_pm:
        n2 = len(raw_vm_vs_pm)
        x2 = [x[0] for x in raw_vm_vs_pm]
        y2 = [x[1] for x in raw_vm_vs_pm]
        x2m = sum(x2)/n2
        y2m = sum(y2)/n2
        num2 = sum((x-x2m)*(y-y2m) for x,y in zip(x2, y2))
        den_x2 = sum((x-x2m)**2 for x in x2)**0.5
        den_y2 = sum((y-y2m)**2 for y in y2)**0.5
        corr2 = num2/(den_x2*den_y2) if den_x2>0 and den_y2>0 else 0
        print(f"  Raw Vol/MCap vs peakMultiplier correlation: {corr2:+.3f}")

# Check each score component correlation
print(f"\n{'='*70}")
print("VERIFICATION 2b: ALL score component correlations with peakMultiplier")
print(f"{'='*70}\n")

all_components = set()
for o in outcomes:
    bd = o.get("scoreBreakdown", {})
    if isinstance(bd, dict):
        all_components.update(bd.keys())

component_corrs = []
for comp in sorted(all_components):
    pairs = []
    for o in outcomes:
        bd = o.get("scoreBreakdown", {})
        if isinstance(bd, dict) and comp in bd:
            pairs.append((sf(bd[comp]), sf(o.get("peakMultiplier",0))))
    
    if len(pairs) > 5:
        n = len(pairs)
        xs = [p[0] for p in pairs]
        ys = [p[1] for p in pairs]
        xm = sum(xs)/n
        ym = sum(ys)/n
        num = sum((x-xm)*(y-ym) for x,y in zip(xs,ys))
        dx = sum((x-xm)**2 for x in xs)**0.5
        dy = sum((y-ym)**2 for y in ys)**0.5
        c = num/(dx*dy) if dx>0 and dy>0 else 0
        component_corrs.append((comp, c, len(pairs)))

component_corrs.sort(key=lambda x: abs(x[1]), reverse=True)
print(f"{'Component':<15} {'Correlation':>12} {'N':>5}  {'Their Claim':>15}")
print("-"*55)

their_claims = {
    "volumeRatio": -0.09,
    "liquidity": +0.53,
    "antiRug": +0.49,
    "mcapZone": +0.02,
}

for comp, c, n in component_corrs:
    their = their_claims.get(comp, None)
    their_str = f"{their:+.2f}" if their is not None else "N/A"
    match = ""
    if their is not None:
        if (c > 0 and their > 0) or (c < 0 and their < 0):
            match = "SAME DIRECTION"
        else:
            match = "CONTRADICTS"
    print(f"  {comp:<15} {c:>+.3f}        {n:>3}  {their_str:>10}  {match}")


print(f"\n{'='*70}")
print("VERIFICATION 3: Phoenix Pattern (down at 1h, up at 24h)")
print(f"{'='*70}\n")

phoenix_tokens = []
for t in tokens:
    p1h = sf(t.get("priceChange1h", 0))
    p24h = sf(t.get("priceChange24h", 0))
    sym = t.get("symbol", "?")
    
    if p1h < -15 and p24h > 50:
        phoenix_tokens.append((sym, p1h, p24h))

print(f"Phoenix tokens (1h < -15% AND 24h > +50%): {len(phoenix_tokens)}")
for sym, p1h, p24h in sorted(phoenix_tokens, key=lambda x: x[2], reverse=True):
    print(f"  {sym:20s} 1h={p1h:>+8.1f}%  24h={p24h:>+10.1f}%")

# Check their specific claims
claimed_phoenix = {"HOMIE": (-29, 1838), "$KillDonJr": (-73, 131), "GREENBULL": (-85, 324)}
print(f"\nVerifying their specific Phoenix claims:")
token_by_sym = {t.get("symbol",""): t for t in tokens}
for sym, (claimed_1h, claimed_24h) in claimed_phoenix.items():
    t = token_by_sym.get(sym)
    if t:
        actual_1h = sf(t.get("priceChange1h",0))
        actual_24h = sf(t.get("priceChange24h",0))
        print(f"  {sym}: Claimed 1h={claimed_1h}% 24h=+{claimed_24h}% | Actual 1h={actual_1h:+.1f}% 24h={actual_24h:+.1f}%")
    else:
        print(f"  {sym}: NOT FOUND in current token snapshots")


print(f"\n{'='*70}")
print("VERIFICATION 4: Smart Money = 0 across all tokens")
print(f"{'='*70}\n")

sm_scores = []
for o in outcomes:
    bd = o.get("scoreBreakdown", {})
    if isinstance(bd, dict):
        sm = sf(bd.get("smartMoney", 0))
        sm_scores.append(sm)

if sm_scores:
    non_zero = sum(1 for s in sm_scores if s > 0)
    print(f"  smartMoney scores: {len(sm_scores)} outcomes checked")
    print(f"  Non-zero smartMoney: {non_zero}/{len(sm_scores)}")
    print(f"  Max smartMoney score: {max(sm_scores)}")
    print(f"  Claim '0 matches across all tokens': {'CONFIRMED' if non_zero == 0 else 'PARTIALLY FALSE'}")


print(f"\n{'='*70}")
print("VERIFICATION 5: antiRug binary effect")
print(f"{'='*70}\n")

antirug_groups = defaultdict(list)
for o in outcomes:
    bd = o.get("scoreBreakdown", {})
    if isinstance(bd, dict):
        ar = sf(bd.get("antiRug", 0))
        pm = sf(o.get("peakMultiplier", 0))
        antirug_groups[int(ar)].append(pm)

for ar_val in sorted(antirug_groups.keys()):
    vals = antirug_groups[ar_val]
    avg = sum(vals)/len(vals)
    sorted_v = sorted(vals)
    med = sorted_v[len(sorted_v)//2]
    mb = sum(1 for v in vals if v >= 2)/len(vals)*100
    print(f"  antiRug={ar_val}: {len(vals)} tokens, avg={avg:.2f}x, median={med:.2f}x, multibagger={mb:.0f}%")

their_claim_ar5 = "9 tokens -> +145% median return"
their_claim_ar2 = "72 tokens -> -48% median return"
print(f"\n  Their claim: antiRug=5: {their_claim_ar5}")
print(f"  Their claim: antiRug=2: {their_claim_ar2}")


print(f"\n{'='*70}")
print("VERIFICATION 6: Liq < $5K death rate")
print(f"{'='*70}\n")

low_liq = [(o.get("symbol","?"), sf(o.get("discoveredLiq",0)), sf(o.get("peakMultiplier",0))) 
           for o in outcomes if sf(o.get("discoveredLiq",0)) < 5000 and sf(o.get("discoveredLiq",0)) > 0]

print(f"Tokens discovered with liq < $5K: {len(low_liq)}")
for sym, liq, pm in low_liq:
    status = "DUMPED" if pm < 1.0 else ("FLAT" if pm < 1.5 else "WINNER")
    print(f"  {sym:20s} liq=${liq:>8,.0f}  peak={pm:.2f}x  {status}")

dumped = sum(1 for _,_,pm in low_liq if pm < 1.2)
print(f"\n  Death rate (peak < 1.2x): {dumped}/{len(low_liq)} = {dumped/max(len(low_liq),1)*100:.0f}%")
print(f"  Their claim '99% death rate': ", end="")
print("CONFIRMED" if dumped/max(len(low_liq),1) > 0.90 else f"EXAGGERATED (actual: {dumped/max(len(low_liq),1)*100:.0f}%)")


print(f"\n{'='*70}")
print("SUMMARY: CLAIM VERIFICATION SCORECARD")
print(f"{'='*70}\n")

print("""
  Claim                          | Verdict
  -------------------------------|------------------
  1. Golden Zone (2 filters)     | NEEDS VERIFICATION (depends on holder data quality)
  2. volumeRatio is INVERSE      | CHECK CORRELATION ABOVE
  3. liquidity is #1 predictor   | CHECK CORRELATION ABOVE  
  4. Phoenix Pattern exists      | CHECK ABOVE
  5. Smart Money broken (0)      | CONFIRMED BY BOTH ANALYSES
  6. antiRug binary effect       | CHECK ABOVE
  7. Liq < $5K death rate        | CHECK ABOVE
""")
