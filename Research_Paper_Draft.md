# Investigating the Relationship Between Autonomic Stress and Compensatory Head Oscillations in Congenital Nystagmus: A Real-Time Multi-Modal Data Collection Pipeline

**Author:** Manan Bhateja

**Status:** Draft — Data Collection Phase (Results Pending)

---

## Abstract

Congenital nystagmus is a condition characterised by involuntary, rhythmic oscillations of the eyes, often accompanied by compensatory head movements. While clinical observation suggests that stress and fatigue may exacerbate these head oscillations, no conclusive study has quantified this relationship using objective physiological measurements. This paper presents the design and implementation of a novel real-time data collection pipeline that synchronises computer vision-based head oscillation detection with wearable Heart Rate Variability (HRV) monitoring to investigate whether head oscillations correlate with autonomic stress. The system combines MediaPipe facial landmark tracking, Polar H9 BLE chest strap integration, and a multi-threaded architecture to capture timestamped oscillation events alongside physiological stress markers. Data collection is ongoing, and statistical analysis and machine learning classification will follow.

---

## 1. Introduction

### 1.1 What Is Congenital Nystagmus?

Congenital nystagmus, now formally classified as **Infantile Nystagmus Syndrome (INS)**, is a condition in which the eyes make involuntary, repetitive, rhythmic oscillations. These oscillations typically manifest within the first six months of life and persist throughout adulthood (CEMAS, 2001). The condition affects approximately **1 in 1,000 people**, with incidence estimates ranging from 1 in 821 to 1 in 3,000 live births across different population studies.

### 1.2 Why Does Congenital Nystagmus Occur?

INS is not a single disease but rather a clinical sign arising from various underlying conditions. The etiology is diverse:

- **Idiopathic INS:** The most common form, occurring independently of other ocular or neurological disorders with no identifiable cause.
- **Sensory Defect Nystagmus:** Secondary to conditions that disrupt early visual development, including albinism (abnormal retinal and optic nerve development), achromatopsia (linked to *CNGB3* and *CNGA3* gene mutations), congenital cataracts, and foveal hypoplasia.
- **Genetic Origins:** Mutations in the *FRMD7* gene are one of the most well-characterised causes (X-linked inheritance). Other implicated genes include *PAX6*, *SLC38A8*, and *GPR143*. INS is genetically heterogeneous — mutations in many different genes with varying inheritance patterns (autosomal dominant, autosomal recessive, and X-linked) can produce the same clinical presentation.
- **Neurological Factors:** In some cases, dysfunction in the brainstem or cerebellar circuits that control eye movements contributes to the nystagmus waveform.

The unifying characteristic across all forms is the disruption of the oculomotor system's ability to maintain steady fixation, resulting in the characteristic back-and-forth eye movements.

### 1.3 The Null Zone and Head Positioning

A key concept in understanding INS is the **null zone** — a specific direction of gaze where the intensity (amplitude and frequency) of eye oscillations reaches its minimum. Visual acuity is typically best when the eyes are positioned in this zone. Consequently, many individuals with INS unconsciously adopt an **abnormal head position** (a turn, tilt, or chin-up/chin-down posture) to align their gaze with the null zone while looking straight ahead. This head positioning is a well-documented compensatory strategy (Dell'Osso & Daroff, 1975).

### 1.4 Head Oscillations: The Compensatory Mechanism

Beyond static head positioning, many INS patients exhibit **rhythmic head oscillations** — involuntary nodding or shaking movements. The relationship between these head movements and the underlying eye oscillations is complex:

- **Compensatory origin:** When the eyes involuntarily drift in one direction (e.g., leftward), the head moves in the opposite direction (rightward) to partially stabilise the retinal image. This counter-movement creates a brief window of stable vision (a "foveation period") during which the patient can perceive clear images.
- **Pathological origin:** In some individuals, the head oscillations are not a compensatory strategy but a direct manifestation of the same neurological dysfunction that causes the eye oscillations. The neural pathways controlling eye movements and head movements share common circuits (vestibulo-ocular reflex, tectocollic pathways), and dysfunction in these shared pathways can produce both ocular and cephalic oscillations simultaneously.
- **Combined:** In practice, most patients exhibit a combination of both mechanisms — the oscillations are partially compensatory and partially involuntary.

These head oscillations are clinically significant because they are often the most visible manifestation of the condition, can cause social embarrassment, and their frequency and amplitude appear to vary with the patient's internal state.

### 1.5 The Stress Question: An Unanswered Clinical Problem

Clinicians and patients have long observed that head oscillations in nystagmus appear to worsen during periods of **stress, fatigue, and intense concentration**. Research supports this observation: during heightened psychological arousal, individuals with INS exhibit increased nystagmus amplitude, shorter foveation periods, and — anecdotally — more pronounced head movements (Wiggins et al., 2007).

However, a critical gap exists in the literature:

> **While it is widely accepted that stress can exacerbate nystagmus eye movements, no conclusive study has established whether compensatory head oscillations are directly modulated by physiological stress, or whether they occur independently of autonomic state.**

The existing evidence is limited to:
- **Clinical observation** — doctors report that patients oscillate more during stressful consultations, but this is subjective and uncontrolled.
- **Self-report** — patients notice more head movement "when they are stressed or tired," but self-report is unreliable and subject to confirmation bias.
- **Eye-movement studies** — several studies have measured nystagmus waveform changes under stress (finding increased intensity), but these studies tracked *eye* movements, not *head* movements, and did not correlate findings with objective physiological stress markers like HRV.

The direct measurement of autonomic stress state (via HRV) at the precise moment of head oscillation onset has not been attempted.

### 1.6 Personal Motivation

The author of this study, Manan Bhateja, has congenital nystagmus with associated compensatory head oscillations. Having lived with the condition, the author has observed what appears to be a pattern: the oscillations are not constant — they seem to intensify during periods of stress, anxiety, or cognitive load, and diminish during calm, relaxed states.

This personal observation raised a fundamental question:

> **Are my head oscillations purely involuntary neurological events, or are they modulated — perhaps even triggered — by autonomic stress?**

If the latter is true, it would have profound implications: stress management interventions (breathing exercises, meditation, biofeedback) could potentially reduce oscillation frequency, and real-time monitoring systems could alert patients when they enter high-risk physiological states.

Rather than relying on subjective observation, this project seeks to answer this question with data — by building a system that objectively measures both the oscillations and the physiological stress state at the moment they occur.

---

## 2. Research Question and Objectives

### 2.1 Primary Research Question

**Is there a statistically significant correlation between autonomic nervous system stress (as measured by Heart Rate Variability) and the occurrence of compensatory head oscillations in congenital nystagmus?**

### 2.2 Specific Objectives

1. **Design and build** a real-time data collection pipeline that detects head oscillations using computer vision and simultaneously records physiological stress indicators from a wearable BLE chest strap.
2. **Collect a longitudinal dataset** of oscillation events paired with HRV snapshots, along with background baseline HRV samples during non-oscillation periods.
3. **Apply statistical analysis** to determine whether HRV metrics (specifically RMSSD) are significantly different during oscillation events compared to baseline periods.
4. **Train machine learning models** to evaluate whether physiological features can predict oscillation occurrence, and identify which features are most predictive.

### 2.3 Target Beneficiaries

- **Nystagmus patients** — particularly those with compensatory head oscillations who want to understand their triggers and explore stress management as an intervention.
- **Ophthalmologists and neuro-ophthalmologists** — who currently lack objective tools to quantify the stress-oscillation relationship in their patients.
- **Researchers in oculomotor disorders** — who need multi-modal datasets combining movement analysis with physiological markers.

---

## 3. Methodology

### 3.1 System Architecture Overview

The system consists of two concurrent data streams running in real-time, merged at the point of oscillation detection:

```
┌──────────────────────────────────────────────────────────────────────┐
│                    REAL-TIME DATA COLLECTION SYSTEM                   │
├────────────────────────────┬─────────────────────────────────────────┤
│  COMPUTER VISION MODULE    │  PHYSIOLOGICAL SENSOR MODULE            │
│  (Main Thread, synchronous)│  (Background Thread, asynchronous)      │
│                            │                                         │
│  720p Webcam @ 30fps       │  Polar H9 BLE Chest Strap               │
│  → MediaPipe Face Mesh     │  → GATT Heart Rate Service (0x2A37)     │
│  → 468 facial landmarks    │  → BPM + RR intervals (1/1024s units)   │
│  → Nose-tip (landmark #1)  │  → Rolling 60-second buffer             │
│  → EMA smoothing filter    │  → RMSSD, SDNN, Mean RR computation     │
│  → Velocity + direction    │                                         │
│    reversal detection      │  Thread-safe shared state               │
│  → Trigger: ≥5 reversals   │  (threading.Lock + dictionary)          │
│    within 2 seconds        │                                         │
├────────────────────────────┴─────────────────────────────────────────┤
│  ON OSCILLATION TRIGGER:                                             │
│    1. Sample HRV features from BLE thread (thread-safe read)         │
│    2. Save 10-second validation video (5s pre + 5s post trigger)     │
│    3. Log [timestamp, HRV features, event type] to CSV               │
│                                                                      │
│  EVERY 5 MINUTES (BACKGROUND SAMPLING):                              │
│    1. Sample HRV features regardless of oscillation state            │
│    2. Log as "BG" (background) row — provides negative examples      │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Head Oscillation Detection (Computer Vision Module)

#### 3.2.1 Facial Landmark Tracking

The system uses Google's **MediaPipe Face Mesh** model, which provides 468 three-dimensional facial landmarks per frame in real-time. From these 468 landmarks, the **nose tip (landmark index #1)** is extracted as a single-point proxy for overall head position, as it offers the largest displacement during lateral head oscillations.

The nose tip's horizontal pixel position (`nose_x`) is tracked across frames at the camera's native frame rate (30fps at 720p resolution, yielding 1280 pixels of horizontal range).

#### 3.2.2 Noise Reduction: Exponential Moving Average (EMA) Filter

A critical challenge in landmark-based tracking is **neural network prediction jitter**. Even when the head is perfectly stationary, MediaPipe produces ±1–3 pixels of frame-to-frame noise on landmark positions. Without filtering, this jitter would register as false direction changes.

To address this, an **Exponential Moving Average (EMA)** low-pass filter is applied to the raw nose position:

```
smoothed_x(t) = α × raw_x(t) + (1 - α) × smoothed_x(t-1)
```

Where **α = 0.4** (smoothing factor). This value was empirically selected to balance two competing requirements:
- Sufficient noise rejection to eliminate MediaPipe jitter (requires lower α)
- Sufficient responsiveness to preserve the subtle, rapid oscillations characteristic of nystagmus (requires higher α)

#### 3.2.3 Oscillation Detection Algorithm

The detection algorithm analyses the smoothed nose position to identify sustained, rhythmic oscillation patterns:

1. **Velocity computation:** For each frame, the horizontal velocity is calculated as `v(t) = smoothed_x(t) - smoothed_x(t-1)`.

2. **Movement thresholding:** Only velocities exceeding a minimum threshold (|v| ≥ 1 pixel) are considered meaningful movement. This threshold was deliberately set low (1 pixel) because congenital nystagmus oscillations are extremely subtle — typically 1–3 pixels of displacement at 720p.

3. **Direction reversal detection:** A direction reversal is counted when the velocity sign changes (i.e., `v(t) × v(t-1) < 0`), indicating the head has changed direction from leftward to rightward motion (or vice versa).

4. **Temporal constraint:** Each subsequent direction reversal must occur within **2 seconds** of the previous one. If no reversal is detected within this window, the reversal counter resets to zero. This ensures the algorithm only triggers on rapid, sustained oscillation patterns — not slow, deliberate head turns separated by seconds.

5. **Trigger condition:** An oscillation event is triggered when the reversal counter reaches **≥ 5 within the 2-second window**. Five reversals correspond to approximately 2.5 full oscillation cycles, providing strong confidence that the detected movement is rhythmic rather than a single head turn.

6. **Cooldown:** After a trigger, a 30-second cooldown prevents consecutive triggers from flooding the dataset with near-identical events.

#### 3.2.4 Validation Video Capture

Each trigger produces a **10-second validation video** (5 seconds before the trigger + 5 seconds after). The pre-trigger footage is captured using a rolling frame buffer (`collections.deque`), which continuously stores the most recent 150 frames (5 seconds at 30fps). Upon trigger, this buffer is frozen, and an additional 150 frames of post-trigger footage are captured, then both segments are stitched into a single MP4 file.

These videos serve as ground truth: the author manually reviews each clip and labels it as **True Positive (TP)** — a genuine oscillation event — or **False Positive (FP)** — a normal head movement incorrectly flagged. This human-in-the-loop validation is essential because the subtle nature of nystagmus oscillations makes purely automated verification unreliable.

### 3.3 Physiological Stress Measurement (HRV Module)

#### 3.3.1 Why Heart Rate Variability?

Heart Rate Variability (HRV) is the gold standard for non-invasive measurement of autonomic nervous system (ANS) activity. The ANS has two branches:

- **Sympathetic Nervous System ("fight or flight"):** Activates during stress, anxiety, and arousal. Increases heart rate and reduces beat-to-beat variability.
- **Parasympathetic Nervous System ("rest and digest"):** Dominates during calm, relaxed states via the vagus nerve. Slows heart rate and introduces healthy variability.

The balance between these two branches determines HRV. Under stress, sympathetic activation suppresses parasympathetic tone, resulting in **lower HRV** — the heart beats more rigidly, like a metronome. During relaxation, parasympathetic dominance introduces natural variability — the heart rate fluctuates healthily.

This makes HRV an objective, real-time biomarker of stress that does not rely on self-report.

#### 3.3.2 Hardware: Polar H9 Chest Strap

The **Polar H9** is a medical-grade ECG chest strap that detects R-peaks in the heart's electrical signal through skin-contact electrodes. It broadcasts heart rate and beat-to-beat **RR intervals** (the time between consecutive R-peaks) via Bluetooth Low Energy (BLE) using the standard GATT Heart Rate Measurement characteristic (UUID: 0x2A37).

The raw BLE payload is parsed at the byte level:
- **Byte 0:** Flags (HR format, RR interval presence)
- **Bytes 1–2:** Heart rate (uint8 or uint16)
- **Remaining bytes:** RR intervals in units of 1/1024 seconds, converted to milliseconds

#### 3.3.3 HRV Feature Computation

From the raw RR intervals, the following features are computed over a **rolling 60-second window** at the moment of each oscillation trigger:

| Feature | Formula | Physiological Meaning |
|---|---|---|
| **RMSSD** | √(mean(diff(RR)²)) | Parasympathetic (vagal) tone — primary stress indicator |
| **SDNN** | std(RR) | Total autonomic variability (sympathetic + parasympathetic) |
| **Mean RR** | mean(RR) | Average inter-beat interval |
| **BPM** | mean(heart_rate) | Average heart rate |
| **RR Count** | count of RR intervals | Data quality metric |

**RMSSD (Root Mean Square of Successive Differences)** is the primary metric. It is recommended by the European Society of Cardiology Task Force (1996) as the preferred time-domain measure for short-term recordings. It specifically captures parasympathetic activity — the component that responds most rapidly to acute stress.

The 60-second window size was chosen as a balance between statistical reliability (requiring ≥30 RR intervals, approximately 30 heartbeats) and temporal resolution (capturing stress state close to the moment of oscillation, not averaged over many minutes).

#### 3.3.4 Data Quality Assessment

Each logged event is assigned an HRV quality flag:

| Quality | Criteria | Usability |
|---|---|---|
| `good` | ≥30 RR intervals in 60s window | Usable for analysis |
| `low` | 10–29 RR intervals | Use with caution |
| `insufficient` | <10 RR intervals | Exclude from analysis |
| `no_connection` | Polar H9 not connected | Exclude from analysis |

### 3.4 Multi-Threaded Architecture

A significant engineering challenge arises from the incompatibility of the two data acquisition libraries:

- **OpenCV** (computer vision) requires a synchronous `while True` loop with blocking `cap.read()` calls.
- **bleak** (BLE communication) requires an asynchronous `asyncio` event loop.

These cannot coexist in a single thread. The solution is a **two-thread architecture**:

- **Main thread:** Runs the synchronous OpenCV frame processing loop, oscillation detection, and CSV logging.
- **Background thread:** Runs a dedicated `asyncio` event loop for BLE scanning, connection, and notification subscription.

The two threads communicate through a **shared dictionary** protected by a `threading.Lock`. The BLE thread writes new RR intervals and BPM readings on each notification (~1 per second). The main thread reads from this shared state only when an oscillation triggers — a brief, infrequent operation that minimises lock contention.

The BLE thread includes **auto-reconnection logic**: if the Polar H9 disconnects (e.g., due to loss of skin contact), the thread automatically re-scans and reconnects. The computer vision pipeline continues operating independently during BLE disconnections, and events during disconnection periods are flagged with `HRV_Quality = no_connection`.

### 3.5 Background Baseline Sampling

A methodological insight during the design phase led to the addition of **periodic background sampling**. Without negative examples, the dataset would only contain HRV readings from moments when oscillations occurred — making it impossible to determine whether those readings differ from the patient's normal baseline.

To address this, the system logs a background HRV sample every **5 minutes** regardless of oscillation state. These rows are marked with `Event_Type = BG` and require no video validation. They serve as the **negative class** for both statistical comparison and ML classification: "What does HRV look like when oscillations are NOT happening?"

### 3.6 Dataset Schema

Each row in the output CSV represents either an oscillation event or a background sample:

| Column | Description |
|---|---|
| `Timestamp` | Date and time of the event |
| `Video_File` | Filename of validation video (empty for BG samples) |
| `Validation_Status` | TP (true positive), FP (false positive), or BG (background) |
| `Event_Type` | OSC (oscillation trigger) or BG (background sample) |
| `BPM` | Mean heart rate over the last 60 seconds |
| `RMSSD_60s` | Root Mean Square of Successive Differences (ms) |
| `Mean_RR_60s` | Mean RR interval (ms) |
| `SDNN_60s` | Standard Deviation of NN intervals (ms) |
| `RR_Count_60s` | Number of RR intervals in the 60-second window |
| `HRV_Quality` | Data quality assessment (good/low/insufficient/no_connection) |

---

## 4. Challenges Encountered

### 4.1 BLE Connection Instability on Windows

The Windows operating system intercepts new BLE connections with a system-level pairing dialog, which disrupted the bleak library's connection management. The device would connect, enumerate GATT services, subscribe to notifications, and then immediately disconnect — before any data was received.

**Solution:** Pre-pairing the Polar H9 through Windows Bluetooth Settings before running the script eliminated the system dialog interference. Additionally, auto-reconnection logic was implemented to handle intermittent disconnections caused by loss of skin contact.

### 4.2 Sensitivity vs. Precision Trade-off in Oscillation Detection

Nystagmus oscillations are extremely subtle — typically 1–3 pixels of displacement at 720p resolution. Setting a high velocity threshold (e.g., 8 pixels) eliminated all real oscillations. Setting it to 1 pixel captured real oscillations but also triggered on normal breathing sway, minor posture adjustments, and MediaPipe landmark jitter.

**Solution:** A multi-layered approach was adopted:
- Low velocity threshold (1 pixel) to maintain sensitivity to subtle oscillations
- EMA smoothing to eliminate high-frequency jitter noise
- Strict temporal constraint (5 reversals within 2 seconds) to require sustained rhythmic patterns
- Human-in-the-loop video validation to filter remaining false positives post-hoc

The resulting detection precision across the collected dataset is approximately **65%** (43 TP out of 66 validated events).

### 4.3 Temporal Clustering of Data

During initial data collection, it was observed that the majority of data points were concentrated within a single extended session (July 17, 2026: 23 BG samples, 41 TP events). This raised concerns about **temporal autocorrelation** — if the patient's stress state was relatively stable during that session, the BG and OSC readings would share the same baseline, making any comparison artificially weak.

**Planned mitigation:** Data collection will be extended across multiple days, times of day, and stress conditions. During analysis, day-level averaging will be applied to prevent any single session from dominating the statistics.

### 4.4 bleak 3.x API Breaking Changes

The BLE library (bleak) underwent a major version change from 2.x to 3.x, deprecating the `set_disconnected_callback` method in favour of a constructor parameter. This caused runtime `AttributeError` exceptions that were initially difficult to diagnose.

**Solution:** Updated to use `disconnected_callback` as a parameter to the `BleakClient` constructor, which is the correct API for bleak ≥ 3.0.

---

## 5. Current Status and Preliminary Data Summary

### 5.1 Data Collected (as of July 2026)

| Metric | Count |
|---|---|
| Total recorded events | 110 |
| Oscillation events (OSC) | 69 |
| True Positives (confirmed oscillations) | 43 |
| False Positives | 23 |
| Unlabeled events | 3 |
| Background samples (BG) | 41 |
| TP events with good HRV data | 40 |
| BG samples with good HRV data | 41 |
| **Total usable for analysis** | **81** |
| Data collection days | 4 |
| Detection precision | 65% |

### 5.2 Observations (Descriptive Only — Not Conclusive)

The following observations are descriptive summaries of the raw data and do **not** constitute statistical findings. Formal analysis will follow once data collection across sufficient days is complete.

- **Oscillation events:** RMSSD values during confirmed oscillation events ranged from 15.3 ms to 60.8 ms, with a mean of 33.2 ms and median of 32.1 ms.
- **Background samples:** RMSSD values during non-oscillation periods ranged from 13.2 ms to 60.6 ms, with a mean of 31.4 ms and median of 29.9 ms.
- **Temporal patterns:** The majority of oscillation events occurred during a single extended morning session (10:00–11:40 on July 17), which limits the interpretability of any cross-day temporal patterns at this stage.

No statistical tests or model training have been performed on this data. Drawing conclusions from the current dataset would be premature given the temporal clustering issue described in Section 4.3.

---

## 6. Planned Analysis (Future Work)

### 6.1 Phase 1: Extended Data Collection

The immediate next step is to collect data across a minimum of **7–10 different days**, with sessions at varied times of day and under naturally varying stress conditions (e.g., work deadlines, relaxed weekends, morning vs. evening). This diversity is essential for:
- Ensuring background samples represent a genuine range of physiological states
- Reducing the dominance of any single session in the aggregate statistics
- Enabling time-of-day analysis as a fatigue/circadian proxy

**Target:** ≥50 validated TP oscillation events and ≥100 BG samples across ≥7 days.

### 6.2 Phase 2: Exploratory Data Analysis (EDA)

- **RMSSD distribution comparison:** Box plots and violin plots comparing RMSSD distributions between TP oscillation events and BG baseline samples.
- **Time-of-day analysis:** Scatter plots of oscillation occurrence times, examining whether events cluster at particular hours (suggesting a fatigue or circadian component).
- **Session-level trends:** RMSSD trajectory across each session, with oscillation events marked as overlay points.
- **Correlation analysis:** Heatmap of pairwise correlations between all HRV features.

### 6.3 Phase 3: Statistical Hypothesis Testing

**Primary test:** Mann-Whitney U test (non-parametric, does not assume normal distribution)

```
H₀: The distribution of RMSSD during oscillation events is equal to RMSSD during baseline.
H₁: The distributions are significantly different.
Significance level: α = 0.05
```

**Day-level balancing:** To address temporal clustering, the test will be run on day-level aggregated values (one mean RMSSD per day per group) in addition to the raw values.

**Effect size:** Cohen's d will be reported to quantify the practical magnitude of any significant difference.

### 6.4 Phase 4: Machine Learning Classification

**Task:** Binary classification — predict whether a given HRV reading corresponds to an oscillation event (OSC) or a baseline period (BG).

**Features:**
- Physiological: RMSSD_60s, BPM, SDNN_60s, Mean_RR_60s
- Temporal: hour_of_day, minutes_into_session
- Derived: RMSSD/SDNN ratio (parasympathetic vs. total variability)

**Models (in order of complexity):**
1. **Logistic Regression** — fully interpretable, provides coefficient weights
2. **Random Forest** — handles non-linear interactions, provides feature importance
3. **XGBoost** — gradient-boosted trees, strongest performance on small tabular datasets

**Validation:** Time-aware 5-fold cross-validation to prevent temporal data leakage.

**Key output:** Feature importance ranking — which physiological or temporal feature is most predictive of oscillation occurrence.

### 6.5 Phase 5: Interpretation and Clinical Implications

Depending on findings:
- **If RMSSD is significantly lower during oscillations:** Evidence that sympathetic activation (stress) is associated with head oscillation events. This would support clinical interest in stress management interventions for nystagmus patients.
- **If no significant difference is found:** Evidence that head oscillations occur independently of autonomic state — they are primarily neurological/involuntary. This would be equally valuable, as it would redirect clinical attention away from stress management toward neurological interventions.
- **If time-of-day is the strongest predictor:** Evidence for a fatigue or circadian component, suggesting that oscillation management should focus on rest and energy management rather than acute stress reduction.

---

## 7. What Problem Does This Solve, and For Whom?

### 7.1 The Problem

Millions of people with congenital nystagmus experience involuntary head oscillations that affect their social interactions, professional confidence, and daily comfort. Patients frequently ask their doctors: *"Why does my head shake more when I'm stressed?"* and *"Is there anything I can do to reduce it?"*

Today, doctors can only offer anecdotal guidance: *"Yes, stress seems to make it worse, but we don't have data to prove it, and we don't have specific interventions to recommend."*

The fundamental problem is the **absence of objective, quantitative evidence** linking physiological stress to head oscillation frequency. Without this evidence:
- Patients cannot know whether managing their stress would actually reduce their oscillations
- Clinicians cannot prescribe stress-based interventions with confidence
- Researchers cannot design targeted studies or clinical trials

### 7.2 The Solution

This project provides a **low-cost, non-invasive, real-time data collection pipeline** that any nystagmus patient can use with consumer-grade hardware (a standard webcam and a Polar chest strap, total cost under ₹10,000) to objectively measure whether their oscillations correlate with their physiological stress levels.

### 7.3 How It Improves Outcomes

- **For patients:** Objective data replacing subjective guesswork. If the correlation exists, patients gain a concrete, actionable insight: *"Managing my stress may reduce my oscillations."* If it does not exist, they can stop worrying about stress as a trigger and focus on other aspects of their condition.
- **For clinicians:** An evidence base for recommending (or not recommending) stress management interventions. A reusable data collection tool that can be deployed with multiple patients for larger studies.
- **For researchers:** A novel multi-modal dataset and open-source pipeline that combines movement analysis with physiological markers — applicable to studying other movement disorders beyond nystagmus.

---

## 8. Tools and Technologies

| Component | Technology | Purpose |
|---|---|---|
| Facial landmark tracking | MediaPipe Face Mesh | 468-point facial landmark detection at 30fps |
| Frame processing | OpenCV | Webcam capture, video recording, HUD overlay |
| Signal filtering | Custom EMA (NumPy) | Noise reduction on landmark positions |
| BLE communication | bleak (Python) | Bluetooth Low Energy interface with Polar H9 |
| Asynchronous I/O | asyncio | Event loop for BLE subscription in background thread |
| Concurrency | threading | Decoupling synchronous CV and asynchronous BLE loops |
| HRV computation | NumPy | RMSSD, SDNN, and statistical calculations |
| Data storage | CSV | Structured logging of events and features |
| Validation tool | Custom Python script | Sequential video review with keyboard-driven labeling |
| Language | Python 3.11 | End-to-end implementation |

---

## References

1. CEMAS Working Group. (2001). "A National Eye Institute Sponsored Workshop and Publication on the Classification of Eye Movement Abnormalities and Strabismus (CEMAS)." *National Eye Institute*.

2. Dell'Osso, L. F., & Daroff, R. B. (1975). "Congenital nystagmus waveforms and foveation strategy." *Documenta Ophthalmologica*, 39(1), 155–182.

3. Task Force of the European Society of Cardiology and the North American Society of Pacing and Electrophysiology. (1996). "Heart rate variability: Standards of measurement, physiological interpretation, and clinical use." *Circulation*, 93(5), 1043–1065.

4. Wiggins, D., Woodhouse, J. M., Margrain, T. H., Harris, C. M., & Erichsen, J. T. (2007). "Infantile nystagmus adapts to visual demand." *Investigative Ophthalmology & Visual Science*, 48(5), 2089–2094.

5. Shaffer, F., & Ginsberg, J. P. (2017). "An overview of heart rate variability metrics and norms." *Frontiers in Public Health*, 5, 258.

6. Kim, H. G., Cheon, E. J., Bai, D. S., Lee, Y. H., & Koo, B. H. (2018). "Stress and heart rate variability: A meta-analysis and review of the literature." *Psychiatry Investigation*, 15(3), 235–245.

7. Abadi, R. V., & Bjerre, A. (2002). "Motor and sensory characteristics of infantile nystagmus." *British Journal of Ophthalmology*, 86(10), 1152–1160.

8. Bluetooth SIG. "GATT Specification Supplement — Heart Rate Measurement Characteristic." UUID: 0x2A37.

---

*This document is a draft. Statistical results and ML findings will be added upon completion of data collection and analysis.*
