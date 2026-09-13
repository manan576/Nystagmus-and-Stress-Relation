"""
Analysis & Statistical Verification Script
===========================================
Runs hypothesis testing and generates summary metrics comparing
physiological state (HRV / RMSSD) during oscillation events vs baseline.
"""

import pandas as pd
import numpy as np
from scipy import stats

LOG_FILE = "oscillation_log.csv"

def main():
    df = pd.read_csv(LOG_FILE)

    # Filter groups
    tp = df[df["Validation_Status"] == "TP"]
    fp = df[df["Validation_Status"] == "FP"]
    bg = df[df["Validation_Status"] == "BG"]

    total_events = len(tp) + len(fp)
    precision = (len(tp) / total_events) * 100 if total_events > 0 else 0

    print("\n" + "=" * 65)
    print("      NYSTAGMUS STRESS CORRELATION — DATASET SUMMARY")
    print("=" * 65)
    print(f" Total Logged Records:       {len(df)}")
    print(f" Longitudinal Tracking Span: {df['Timestamp'].str[:10].nunique()} recording days")
    print(f" Total Oscillation Triggers: {total_events}")
    print(f"   |-- True Positives (TP):  {len(tp)} ({precision:.1f}% precision)")
    print(f"   \\-- False Positives (FP): {len(fp)} (filtered via video validator)")
    print(f" Background Baseline Samples:{len(bg)} (unbiased 5-min intervals)")

    print("\n" + "-" * 65)
    print("      PHYSIOLOGICAL STRESS COMPARISON (HRV / RMSSD)")
    print("-" * 65)

    windows = ["RMSSD_15s", "RMSSD_30s", "RMSSD_60s", "BPM"]
    print(f"Feature        | {'Oscillation (TP)':<18} | {'Baseline (BG)':<18} | Delta (%)")
    print("-" * 65)

    for w in windows:
        tp_mean = tp[w].mean()
        bg_mean = bg[w].mean()
        delta = ((tp_mean - bg_mean) / bg_mean) * 100
        unit = "bpm" if w == "BPM" else "ms"
        print(f"{w:<14} | {tp_mean:>6.2f} +/- {tp[w].std():<5.2f} {unit} | {bg_mean:>6.2f} +/- {bg[w].std():<5.2f} {unit} | {delta:>+6.1f}%")

    # Hypothesis Testing (Mann-Whitney U)
    u_stat, p_val = stats.mannwhitneyu(tp["RMSSD_60s"], bg["RMSSD_60s"], alternative="less")

    print("\n" + "-" * 65)
    print("      STATISTICAL HYPOTHESIS TESTING (Mann-Whitney U)")
    print("-" * 65)
    print(" H0: RMSSD during oscillations >= RMSSD during baseline (No stress difference)")
    print(" H1: RMSSD during oscillations <  RMSSD during baseline (Significant stress modulation)")
    print(f" Mann-Whitney U Statistic: {u_stat}")
    print(f" P-Value:                 {p_val:.2e}")
    if p_val < 0.001:
        print(" Verdict:                 REJECT H0 (p < 0.001) *** HIGHLY SIGNIFICANT ***")
        print(" Interpretation:          True oscillations coincide with significant parasympathetic")
        print("                          vagal withdrawal (acute autonomic stress).")
    print("=" * 65 + "\n")

if __name__ == "__main__":
    main()
