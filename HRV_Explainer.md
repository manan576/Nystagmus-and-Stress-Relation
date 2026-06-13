# Understanding HRV: Medical Terms, Calculations & What They Mean

## For the Nystagmus Stress-Oscillation Project

This document explains every physiological metric we're collecting from the Polar H9 chest strap,
how each is calculated, and what it tells us about stress — written for a researcher who wants to
understand the science behind the numbers.

---

## 1. Heart Rate (HR) — Beats Per Minute (BPM)

### What is it?
The number of times your heart beats in one minute. The Polar H9 computes this on-device
from the electrical signal (ECG) it reads through the chest electrodes.

### Your data
```
HR range: 82 – 92 bpm
Mean HR:  87.3 bpm
```

### What does it tell us?
| Range | State |
|---|---|
| 60–80 bpm | Resting, relaxed |
| 80–100 bpm | Normal, mildly elevated (sitting, alert) |
| 100+ bpm | Elevated — exercise, anxiety, acute stress |

**For stress detection:** HR is a *lagging* indicator. When you get stressed, your heart rate
takes 30–60 seconds to noticeably rise because it's controlled by a complex feedback loop
(baroreceptor reflex, hormonal signals). By the time HR rises, the stress event may have passed.
That's why we use HRV instead.

---

## 2. RR Intervals — The Time Between Heartbeats

### What is it?
An RR interval is the time (in milliseconds) between two consecutive R-peaks in your heart's
electrical signal (ECG). The "R-peak" is the tallest spike in each heartbeat's waveform:

```
ECG Signal:

    R           R           R           R
    │\          │\          │\          │\
    │ \    T    │ \    T    │ \    T    │ \
───P┤  \──/\───P┤  \──/\───P┤  \──/\───P┤  \──
    │   \/     │   \/     │   \/     │
    QS         QS         QS         QS

    |←- RR -→|  |←- RR -→|  |←- RR -→|
       693ms       724ms       737ms
```

### How the Polar H9 sends it
The H9 broadcasts RR intervals in units of 1/1024 seconds via Bluetooth. Our script converts
this to milliseconds:

```python
rr_ms = (rr_raw / 1024.0) * 1000.0
```

### Your data
```
Mean RR interval: 688.5 ms
```

This means on average, there were 688.5 milliseconds between consecutive heartbeats.
You can verify: 60,000 ms ÷ 688.5 ms = **87.1 bpm** ✓ (matches your Mean HR)

### Why RR intervals matter more than BPM
BPM is an average — it smooths out the beat-to-beat variation. But that variation IS the signal.
A healthy heart doesn't beat like a metronome. It constantly speeds up and slows down in response
to breathing, posture, thoughts, and autonomic nervous system activity. This natural variation
is called **Heart Rate Variability (HRV)**.

```
Metronome (no variability):    700  700  700  700  700  700  → Low HRV (bad)
Healthy heart (variable):      693  724  737  671  679  749  → High HRV (good)
```

---

## 3. The Autonomic Nervous System (ANS) — Why HRV Reflects Stress

Your heart rate is controlled by two competing branches of the autonomic nervous system:

```
                    ┌─────────────────────────────┐
                    │  AUTONOMIC NERVOUS SYSTEM    │
                    │  (involuntary, automatic)    │
                    └──────────┬──────────────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
    ┌───────────▼───────────┐    ┌────────────▼───────────┐
    │   SYMPATHETIC         │    │   PARASYMPATHETIC       │
    │   "Fight or Flight"   │    │   "Rest and Digest"     │
    │                       │    │                         │
    │   • Speeds up heart   │    │   • Slows down heart    │
    │   • Stress response   │    │   • Relaxation response │
    │   • Cortisol, adrena- │    │   • Via the Vagus Nerve │
    │     line release       │    │   • Promotes recovery   │
    │                       │    │                         │
    │   Result: ↓ HRV       │    │   Result: ↑ HRV         │
    │   (less variation)    │    │   (more variation)      │
    └───────────────────────┘    └─────────────────────────┘
```

**Key insight:** When you're stressed, the sympathetic branch dominates. It overrides the
parasympathetic branch, making your heart beat more rigidly (less variation = lower HRV).
When you're calm, the parasympathetic branch (via the vagus nerve) introduces healthy
variation in the heartbeat timing.

**This is why low HRV = stress, and high HRV = calm.**

---

## 4. RMSSD — Our Primary Stress Indicator

### What does it stand for?
**Root Mean Square of Successive Differences** of RR intervals.

### How is it calculated?

Let's use a real example from your data:

```
Step 1: Take consecutive RR intervals
   RR intervals: [693, 724, 737, 671, 679, 749, 738, 735]

Step 2: Compute successive differences (each RR minus the previous one)
   724 - 693 =  31
   737 - 724 =  13
   671 - 737 = -66
   679 - 671 =   8
   749 - 679 =  70
   738 - 749 = -11
   735 - 738 =  -3
   
   Differences: [31, 13, -66, 8, 70, -11, -3]

Step 3: Square each difference (removes negative signs)
   31² = 961
   13² = 169
   (-66)² = 4356
   8² = 64
   70² = 4900
   (-11)² = 121
   (-3)² = 9
   
   Squared: [961, 169, 4356, 64, 4900, 121, 9]

Step 4: Take the mean (average) of the squares
   Mean = (961 + 169 + 4356 + 64 + 4900 + 121 + 9) / 7
   Mean = 10580 / 7
   Mean = 1511.4

Step 5: Take the square root
   RMSSD = √1511.4 = 38.9 ms
```

In Python:
```python
import numpy as np

rr = np.array([693, 724, 737, 671, 679, 749, 738, 735])
successive_diffs = np.diff(rr)           # Step 2
squared_diffs = successive_diffs ** 2     # Step 3
mean_squared = np.mean(squared_diffs)     # Step 4
rmssd = np.sqrt(mean_squared)             # Step 5
# Result: 38.9 ms
```

### What does the number mean?

| RMSSD Value | Interpretation | ANS State |
|---|---|---|
| **> 40 ms** | High HRV | Strong parasympathetic tone → **relaxed, calm** |
| **20–40 ms** | Moderate HRV | Balance between sympathetic/parasympathetic → **neutral** |
| **< 20 ms** | Low HRV | Sympathetic dominance → **stressed, anxious, fatigued** |

> **Note:** These ranges are general guidelines. Individual baselines vary significantly
> based on age, fitness, genetics, and health conditions. What matters most for our ML model
> is the *relative change* in YOUR RMSSD over time, not the absolute value.

### Your data
```
Full-session RMSSD: 25.00 ms → Moderate HRV
```

This suggests you were in a neutral-to-mildly-elevated state during the test. This is expected —
you were actively setting up hardware, troubleshooting, and concentrating. A deeply relaxed state
would likely show RMSSD > 35ms for you.

### Why RMSSD specifically?
RMSSD is recommended by the **European Society of Cardiology** and the **North American Society
of Pacing and Electrophysiology** (1996 Task Force guidelines) as the preferred time-domain
measure for **short-term recordings (1–5 minutes)**. It specifically captures:

- **Beat-to-beat variability** (not long-term trends)
- **Parasympathetic (vagal) activity** — the component that responds fastest to stress
- **High-frequency oscillations** in heart rate driven by breathing (respiratory sinus arrhythmia)

Other HRV metrics like SDNN capture total variability (both branches), but RMSSD isolates
the parasympathetic component — which is the first thing to change when stress begins.

---

## 5. SDNN — Total Heart Rate Variability

### What does it stand for?
**Standard Deviation of NN intervals** (NN = "normal-to-normal", meaning RR intervals
between normal heartbeats, excluding arrhythmias).

### How is it calculated?
It's simply the standard deviation of all RR intervals in the window:

```python
import numpy as np

rr = np.array([693, 724, 737, 671, 679, 749, 738, 735])
sdnn = np.std(rr, ddof=1)  # ddof=1 for sample standard deviation
# Result: 28.9 ms
```

### What does it tell us?

SDNN reflects **total variability** — both sympathetic AND parasympathetic influences combined.
It's a broader measure than RMSSD.

| SDNN Value (short-term) | Interpretation |
|---|---|
| **> 50 ms** | High total variability (good autonomic health) |
| **30–50 ms** | Moderate variability |
| **< 30 ms** | Low variability (autonomic dysfunction or high stress) |

### Your data
```
Full-session SDNN: 38.05 ms → Moderate variability
```

### RMSSD vs. SDNN — What's the Difference?

| | RMSSD | SDNN |
|---|---|---|
| **Measures** | Beat-to-beat changes (successive differences) | Overall spread of all intervals |
| **Reflects** | Parasympathetic (vagal) activity only | Both sympathetic + parasympathetic |
| **Responds to stress** | Within seconds (fast) | Over minutes (slower) |
| **Best for** | Short-term stress detection | Long-term autonomic health assessment |
| **Our use case** | **Primary feature** for ML | Secondary feature |

---

## 6. The 60-Second Rolling Window

### Why 60 seconds?
We don't compute RMSSD from the entire session — we use a **rolling 60-second window**.
This means at any given moment, we only use the last 60 seconds of RR data:

```
Timeline:    |----60s window----|
             [RR, RR, RR, ... RR]  ← ~85 beats
                                    ← compute RMSSD from these

One second later:
              |----60s window----|
              [RR, RR, RR, ... RR]  ← oldest beat drops off, newest added
                                     ← recompute RMSSD
```

### Why not shorter or longer?
| Window | Problem |
|---|---|
| **< 30 seconds** | Too few RR intervals (< 40 beats). RMSSD becomes statistically unstable. |
| **60 seconds** | ✅ ~85 beats. Statistically robust. Responds to stress within 1 minute. |
| **> 5 minutes** | Too much averaging. Short stress spikes get smoothed away. |

The 60-second window is the sweet spot: enough data for a reliable RMSSD, but short enough
to capture stress that coincides with an oscillation event.

---

## 7. How This All Connects to Your Nystagmus Project

### The Hypothesis
```
Stress (↑ sympathetic) → ↓ RMSSD → ↑ head oscillations?
     OR
Head oscillations occur independently of stress → no RMSSD correlation
```

### What the ML Model Will Look For
When an oscillation event triggers, we capture the RMSSD at that moment. Over many events,
we build a dataset:

```
| Oscillation Event | RMSSD at trigger | Was it stress-related? |
|---|---|---|
| Event 1 | 18 ms (low — stressed) | ? |
| Event 2 | 42 ms (high — calm) | ? |
| Event 3 | 15 ms (low — stressed) | ? |
| Event 4 | 38 ms (high — calm) | ? |
| ... | ... | ... |
```

If oscillations cluster around **low RMSSD values**, that's evidence for a stress-oscillation
relationship. If they're evenly distributed across all RMSSD values, stress and oscillations
are likely independent.

### The Features We'll Extract Per Event

| Feature | What it measures | Source |
|---|---|---|
| `rmssd_60s` | Parasympathetic tone (primary stress indicator) | RR intervals |
| `mean_hr_60s` | Average heart rate | BPM readings |
| `mean_rr_60s` | Average beat-to-beat interval | RR intervals |
| `sdnn_60s` | Total autonomic variability | RR intervals |
| `rr_count_60s` | Data quality (how many beats we measured) | RR intervals |

---

## 8. Your Session Data — Interpreted

```
Session Duration:     ~120 seconds (2 minutes)
Total Notifications:  120 (1 per second — perfect)
Total RR Intervals:   176 (1.47 per notification — some have 2 RR values per packet, normal)
```

### Heart Rate Trend
Your HR ranged from 82 to 92 bpm. This is a normal resting-to-alert range. The slight
elevation above typical resting (60-80) is expected because you were actively monitoring
the screen and concentrating on the test.

### RMSSD Trend
Your RMSSD stayed between 23–28 ms throughout the session. This is moderate — not deeply
relaxed, but not acutely stressed either. The stability of this value means your autonomic
state was consistent during the test, which is exactly what we'd expect from sitting still
and watching data scroll.

### Validation Check
Mean RR = 688.5 ms → 60000 ÷ 688.5 = **87.1 bpm** ✓ (matches Mean HR of 87.3 bpm)
This cross-validation confirms the data is internally consistent and the parsing is correct.

---

## 9. CSV Columns Explained — What We Store and Why

When an oscillation event triggers, our script samples the Polar H9 data and writes one row
to `oscillation_log.csv`. Here's exactly what each column is, who computes it, and why it's
there:

### Data Flow: From Chest Strap to CSV

```
POLAR H9 HARDWARE                    OUR SCRIPT (Python)
─────────────────────                 ─────────────────────────────────────
ECG electrodes on skin                
  → detects R-peaks                   
  → computes BPM (on-chip)            
  → measures RR intervals (on-chip)   
  → broadcasts via Bluetooth ──────►  Receives raw BPM + RR intervals
                                        │
                                        ├─ Stores BPM in bpm_buffer
                                        ├─ Stores RR intervals in rr_buffer
                                        │
                                      On oscillation trigger:
                                        ├─ Filters last 60 seconds of data
                                        ├─ Computes RMSSD from RR intervals
                                        ├─ Computes SDNN from RR intervals
                                        ├─ Computes means
                                        ├─ Assesses data quality
                                        └─ Writes row to CSV
```

**The Polar H9 gives us two raw values: BPM and RR intervals.**
**Everything else is computed by our Python script.**

### Column-by-Column Breakdown

#### `BPM` — Heart Rate (Beats Per Minute)

| | |
|---|---|
| **Computed by** | Polar H9 hardware (on-chip), averaged over last 60s by our script |
| **Value in your data** | `86.7`, `89.1` |
| **Why we store it** | Secondary stress indicator. While RMSSD is our primary feature, BPM provides a complementary signal. The ML model can use BPM to cross-validate RMSSD findings — if oscillations happen at both high BPM AND low RMSSD, that's stronger evidence of stress. |
| **What the Polar sends** | A single BPM number every ~1 second |
| **What our script does** | Averages all BPM values received in the last 60 seconds |

#### `RMSSD_60s` — Root Mean Square of Successive Differences (60-second window)

| | |
|---|---|
| **Computed by** | Our Python script (from raw RR intervals sent by the Polar) |
| **Value in your data** | `33.75`, `29.8` |
| **Why we store it** | **PRIMARY stress indicator.** This is the single most important column. Low RMSSD = high stress (sympathetic dominance). High RMSSD = calm (parasympathetic dominance). This is what the ML model will focus on most. See Section 4 above for the full calculation. |
| **What the Polar sends** | Raw RR intervals (beat-to-beat timing in milliseconds) |
| **What our script does** | Takes the last 60 seconds of RR intervals, computes successive differences, squares them, takes the mean, then the square root |

#### `Mean_RR_60s` — Average RR Interval (60-second window)

| | |
|---|---|
| **Computed by** | Our Python script |
| **Value in your data** | `698.2`, `674.4` |
| **Why we store it** | Provides context for RMSSD. Mean RR is the inverse of heart rate (60000 ÷ Mean_RR = BPM), but at beat-level resolution. It helps the ML model understand the baseline around which variability is occurring. Two people can have the same RMSSD but very different mean RR — that context matters. |
| **What the Polar sends** | Individual RR intervals |
| **What our script does** | Simple average of all RR intervals in the 60-second window |

#### `SDNN_60s` — Standard Deviation of NN Intervals (60-second window)

| | |
|---|---|
| **Computed by** | Our Python script |
| **Value in your data** | `36.95`, `51.3` |
| **Why we store it** | Captures **total** heart rate variability (both sympathetic + parasympathetic), while RMSSD only captures parasympathetic. Together they give the ML model a more complete picture of autonomic state. If RMSSD is low but SDNN is high, it might mean sympathetic activation without full parasympathetic withdrawal — a different stress profile. |
| **What the Polar sends** | Individual RR intervals |
| **What our script does** | Standard deviation of all RR intervals in the 60-second window |

#### `RR_Count_60s` — Number of RR Intervals in the Window

| | |
|---|---|
| **Computed by** | Our Python script (just a count) |
| **Value in your data** | `85`, `90` |
| **Why we store it** | **Data quality indicator.** RMSSD computed from 85 beats is statistically reliable. RMSSD computed from 10 beats is not. The ML model (and you, during analysis) can use this to filter out low-quality data points. Rule of thumb: ≥30 beats = usable, ≥60 beats = solid. |
| **What the Polar sends** | Individual RR intervals |
| **What our script does** | Counts how many RR intervals fall within the 60-second window |

#### `HRV_Quality` — Data Quality Assessment

| | |
|---|---|
| **Computed by** | Our Python script (rule-based) |
| **Value in your data** | `good` |
| **Why we store it** | Tells you at a glance whether the HRV data for this event is trustworthy. The ML pipeline should filter out `insufficient` and `no_connection` rows. |
| **Possible values** | |

| Quality Value | Meaning | Action |
|---|---|---|
| `good` | ≥30 RR intervals in 60s window | ✅ Use for ML |
| `low` | 10–29 RR intervals | ⚠️ Use with caution |
| `insufficient` | <10 RR intervals | ❌ Exclude from ML |
| `no_connection` | Polar H9 was not connected | ❌ Exclude from ML |

### Summary: What the Polar Sends vs. What We Compute

```
┌─────────────────────────────────────────────────────────────┐
│                    POLAR H9 SENDS:                          │
│                                                             │
│    BPM (heart rate)          ← computed on the H9 chip      │
│    RR intervals (ms)         ← measured on the H9 chip      │
│                                                             │
│    That's it. Just two values every ~1 second.              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               OUR SCRIPT COMPUTES:                          │
│                                                             │
│    BPM (60s average)         ← from raw BPM values          │
│    RMSSD_60s                 ← from RR intervals            │
│    Mean_RR_60s               ← from RR intervals            │
│    SDNN_60s                  ← from RR intervals            │
│    RR_Count_60s              ← count of RR intervals        │
│    HRV_Quality               ← rule-based on RR_Count      │
│                                                             │
│    All derived from those two raw values the Polar sends.   │
└─────────────────────────────────────────────────────────────┘
```

---

## References

1. Task Force of the European Society of Cardiology and the North American Society of Pacing
   and Electrophysiology. (1996). "Heart rate variability: Standards of measurement,
   physiological interpretation, and clinical use." *Circulation*, 93(5), 1043-1065.

2. Shaffer, F., & Ginsberg, J. P. (2017). "An overview of heart rate variability metrics
   and norms." *Frontiers in Public Health*, 5, 258.

3. Kim, H. G., et al. (2018). "Stress and heart rate variability: A meta-analysis and review
   of the literature." *Psychiatry Investigation*, 15(3), 235.

4. Bluetooth SIG. "Heart Rate Service Specification."
   GATT Characteristic UUID: 0x2A37 (Heart Rate Measurement).
