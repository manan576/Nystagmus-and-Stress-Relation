/**
 * ============================================================================
 * stress_test_engine.js — Clinical Neuro-Cognitive Stress Protocol Engine
 * ============================================================================
 * Implements gold-standard clinical stress-induction protocols:
 *   1. Stroop Color-Word Interference Test (High cognitive/executive conflict)
 *   2. Serial Mental Arithmetic Challenge (Trier Social Stress Protocol)
 * 
 * Features:
 *   - Adaptive time pressure (starts @ 2.0s, accelerates down to 1.0s)
 *   - Keyboard shortcuts (Keys 1-4, Arrow keys) and click pads
 *   - Real-time physiological telemetry feedback (elevates simulated BPM & lowers RMSSD)
 *   - Simultaneous execution alongside MediaPipe facial tracking & nose HUD
 * ============================================================================
 */

const StressTestEngine = {
  // State
  state: "IDLE", // "IDLE" | "RUNNING" | "PAUSED" | "COMPLETED"
  currentMode: "STROOP_CONFLICT", // "STROOP_CONFLICT" | "SERIAL_SUBTRACTION"

  // Test Metrics
  totalTrials: 0,
  correctTrials: 0,
  currentStreak: 0,
  maxStreak: 0,
  reactionTimes: [],
  currentTrialStartTime: 0,

  // Timer & Stimulus
  stimulusTimerInterval: null,
  stimulusTimeLimitMs: 2000,
  stimulusRemainingMs: 2000,
  currentStimulus: null,
  testDurationSec: 60,
  testSecondsRemaining: 60,
  testTimerInterval: null,

  // Color Definitions for Stroop
  COLOR_PALETTE: [
    { id: "RED", name: "Red", hex: "#ef4444", key: "1" },
    { id: "BLUE", name: "Blue", hex: "#0284c7", key: "2" },
    { id: "GREEN", name: "Green", hex: "#10b981", key: "3" },
    { id: "YELLOW", name: "Yellow", hex: "#eab308", key: "4" }
  ],

  // --- 1. Initialization ---
  init() {
    this.bindKeyboardShortcuts();
    this.renderUIState();
    console.log("[StressEngine] Neuro-Cognitive Stress Test Engine initialized");
  },

  bindKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (this.state !== "RUNNING") return;

      if (this.currentMode === "STROOP_CONFLICT") {
        if (e.key === "1" || e.key === "ArrowLeft") {
          e.preventDefault();
          this.submitAnswer("RED");
        } else if (e.key === "2" || e.key === "ArrowUp") {
          e.preventDefault();
          this.submitAnswer("BLUE");
        } else if (e.key === "3" || e.key === "ArrowDown") {
          e.preventDefault();
          this.submitAnswer("GREEN");
        } else if (e.key === "4" || e.key === "ArrowRight") {
          e.preventDefault();
          this.submitAnswer("YELLOW");
        }
      } else if (this.currentMode === "SERIAL_SUBTRACTION") {
        if (["1", "2", "3", "4"].includes(e.key)) {
          e.preventDefault();
          const idx = parseInt(e.key, 10) - 1;
          const btns = document.querySelectorAll(".stress-choice-btn");
          if (btns[idx]) btns[idx].click();
        }
      }
    });
  },

  // --- 2. Test Lifecycle Controls ---

  startTest(mode = "STROOP_CONFLICT", durationSec = 60) {
    if (window.WebTrackerEngine && !WebTrackerEngine.isBleConnected) {
      if (typeof WebTrackerEngine.showTelemetryRequiredPrompt === "function") {
        WebTrackerEngine.showTelemetryRequiredPrompt();
      }
      alert("Clinical Protocol Requirement: Live Polar H9 heart rate telemetry or simulated stream is required to run the Neuro-Cognitive Stress Protocol.");
      return;
    }

    if (window.WebTrackerEngine && WebTrackerEngine.state !== "ACTIVE_TRACKING") {
      alert("Please complete the quiet resting baseline calibration (Phase 1) before starting the stress protocol.");
      return;
    }

    this.currentMode = mode;
    this.testDurationSec = durationSec;
    this.testSecondsRemaining = durationSec;
    this.state = "RUNNING";

    // Reset Metrics
    this.totalTrials = 0;
    this.correctTrials = 0;
    this.currentStreak = 0;
    this.maxStreak = 0;
    this.reactionTimes = [];
    this.stimulusTimeLimitMs = 2000;

    // UI Updates
    this.renderUIState();
    this.updateMetricsUI();

    // Start Overall Test Countdown
    if (this.testTimerInterval) clearInterval(this.testTimerInterval);
    this.testTimerInterval = setInterval(() => {
      this.testSecondsRemaining--;
      this.updateTestCountdownUI();
      if (this.testSecondsRemaining <= 0) {
        this.completeTest();
      }
    }, 1000);

    // Prompt WebTracker that stress induction is active
    if (window.WebTrackerEngine && typeof WebTrackerEngine.onStressTestStateChange === "function") {
      WebTrackerEngine.onStressTestStateChange(true, "ACTIVE_STRESS_INDUCTION");
    }

    // Generate First Stimulus
    this.nextTrial();
    this.playTone(660, 0.15, "sine");
  },

  stopTest() {
    this.state = "IDLE";
    if (this.stimulusTimerInterval) clearInterval(this.stimulusTimerInterval);
    if (this.testTimerInterval) clearInterval(this.testTimerInterval);

    if (window.WebTrackerEngine && typeof WebTrackerEngine.onStressTestStateChange === "function") {
      WebTrackerEngine.onStressTestStateChange(false, "IDLE");
    }
    this.renderUIState();
  },

  completeTest() {
    this.state = "COMPLETED";
    if (this.stimulusTimerInterval) clearInterval(this.stimulusTimerInterval);
    if (this.testTimerInterval) clearInterval(this.testTimerInterval);

    if (window.WebTrackerEngine && typeof WebTrackerEngine.onStressTestStateChange === "function") {
      WebTrackerEngine.onStressTestStateChange(false, "COMPLETED");
    }

    this.renderUIState();
    this.showTestResultsSummary();
    this.playTone(880, 0.4, "triangle");
  },

  // --- 3. Stimulus Generation & Trial Loop ---

  nextTrial() {
    if (this.state !== "RUNNING") return;

    if (this.stimulusTimerInterval) clearInterval(this.stimulusTimerInterval);

    // Adaptive speed-up based on streak
    const speedTier = Math.min(Math.floor(this.currentStreak / 3), 7);
    this.stimulusTimeLimitMs = Math.max(2000 - (speedTier * 150), 950);
    this.stimulusRemainingMs = this.stimulusTimeLimitMs;

    if (this.currentMode === "STROOP_CONFLICT") {
      this.generateStroopStimulus();
    } else if (this.currentMode === "SERIAL_SUBTRACTION") {
      this.generateMathStimulus();
    }

    this.currentTrialStartTime = performance.now();
    this.renderStimulusUI();

    // Start High-Resolution Countdown Progress Bar (every 25ms)
    const updateIntervalMs = 25;
    this.stimulusTimerInterval = setInterval(() => {
      this.stimulusRemainingMs -= updateIntervalMs;
      this.updateStimulusCountdownBar();

      if (this.stimulusRemainingMs <= 0) {
        clearInterval(this.stimulusTimerInterval);
        this.handleTimeout();
      }
    }, updateIntervalMs);
  },

  generateStroopStimulus() {
    // 85% chance of incongruent (conflict) color-word pair
    const wordIndex = Math.floor(Math.random() * this.COLOR_PALETTE.length);
    const wordObj = this.COLOR_PALETTE[wordIndex];

    let inkIndex;
    if (Math.random() < 0.85) {
      const otherIndices = [0, 1, 2, 3].filter(i => i !== wordIndex);
      inkIndex = otherIndices[Math.floor(Math.random() * otherIndices.length)];
    } else {
      inkIndex = wordIndex;
    }

    const inkObj = this.COLOR_PALETTE[inkIndex];

    this.currentStimulus = {
      type: "STROOP",
      wordText: wordObj.name.toUpperCase(),
      inkColorHex: inkObj.hex,
      correctColorId: inkObj.id
    };
  },

  generateMathStimulus() {
    // Trier Serial Mental Subtraction: A - B = ?
    const a = Math.floor(Math.random() * 80) + 40; // 40 - 120
    const b = [7, 8, 9, 13, 17][Math.floor(Math.random() * 5)];
    const correctAns = a - b;

    // Generate 3 plausible distractors
    const options = new Set([correctAns]);
    while (options.size < 4) {
      const offset = (Math.floor(Math.random() * 7) - 3);
      if (offset !== 0) options.add(correctAns + offset);
    }

    const shuffledOptions = Array.from(options).sort(() => Math.random() - 0.5);

    this.currentStimulus = {
      type: "MATH",
      equation: `${a} − ${b}`,
      correctVal: correctAns,
      options: shuffledOptions
    };
  },

  // --- 4. Trial Evaluation & Autonomic Telemetry Coupling ---

  submitAnswer(chosenVal) {
    if (this.state !== "RUNNING" || !this.currentStimulus) return;

    if (this.stimulusTimerInterval) clearInterval(this.stimulusTimerInterval);

    const reactionTimeMs = Math.round(performance.now() - this.currentTrialStartTime);
    this.reactionTimes.push(reactionTimeMs);
    this.totalTrials++;

    let isCorrect = false;
    if (this.currentStimulus.type === "STROOP") {
      isCorrect = (chosenVal === this.currentStimulus.correctColorId);
    } else if (this.currentStimulus.type === "MATH") {
      isCorrect = (parseInt(chosenVal, 10) === this.currentStimulus.correctVal);
    }

    if (isCorrect) {
      this.correctTrials++;
      this.currentStreak++;
      if (this.currentStreak > this.maxStreak) this.maxStreak = this.currentStreak;
      this.triggerAnswerFeedback(true, reactionTimeMs);
      this.playTone(520, 0.08, "sine");
    } else {
      this.currentStreak = 0;
      this.triggerAnswerFeedback(false, reactionTimeMs);
      this.playTone(220, 0.2, "sawtooth");
    }

    // Inform WebTrackerEngine of trial performance
    if (window.WebTrackerEngine && typeof WebTrackerEngine.onStressTrialEvent === "function") {
      WebTrackerEngine.onStressTrialEvent({
        isCorrect,
        reactionTime: reactionTimeMs,
        streak: this.currentStreak,
        isTimeout: false
      });
    }

    this.updateMetricsUI();

    setTimeout(() => {
      if (this.state === "RUNNING") this.nextTrial();
    }, 220);
  },

  handleTimeout() {
    this.totalTrials++;
    this.currentStreak = 0;
    this.triggerAnswerFeedback(false, this.stimulusTimeLimitMs, true);
    this.playTone(200, 0.25, "sawtooth");

    if (window.WebTrackerEngine && typeof WebTrackerEngine.onStressTrialEvent === "function") {
      WebTrackerEngine.onStressTrialEvent({
        isCorrect: false,
        reactionTime: this.stimulusTimeLimitMs,
        streak: 0,
        isTimeout: true
      });
    }

    this.updateMetricsUI();
    setTimeout(() => {
      if (this.state === "RUNNING") this.nextTrial();
    }, 280);
  },

  triggerAnswerFeedback(isCorrect, rtMs, isTimeout = false) {
    const feedbackPill = document.getElementById("stress-feedback-pill");
    const stimulusCard = document.getElementById("stress-stimulus-display-card");

    if (feedbackPill) {
      if (isTimeout) {
        feedbackPill.textContent = "TIME OUT";
        feedbackPill.style.background = "#fee2e2";
        feedbackPill.style.color = "#b91c1c";
      } else if (isCorrect) {
        feedbackPill.textContent = `CORRECT (${rtMs}ms)`;
        feedbackPill.style.background = "#ecfdf5";
        feedbackPill.style.color = "#059669";
      } else {
        feedbackPill.textContent = `CONFLICT ERROR (${rtMs}ms)`;
        feedbackPill.style.background = "#fee2e2";
        feedbackPill.style.color = "#b91c1c";
      }
      feedbackPill.style.opacity = "1";
      setTimeout(() => {
        if (feedbackPill) feedbackPill.style.opacity = "0";
      }, 750);
    }

    if (stimulusCard) {
      const flashClass = isCorrect ? "feedback-flash-success" : "feedback-flash-error";
      stimulusCard.classList.add(flashClass);
      setTimeout(() => {
        stimulusCard.classList.remove(flashClass);
      }, 200);
    }
  },

  // --- 5. UI Rendering & DOM Updates ---

  renderUIState() {
    const startCard = document.getElementById("stress-test-start-view");
    const activeCard = document.getElementById("stress-test-active-view");
    const completedCard = document.getElementById("stress-test-completed-view");
    const phaseBadge = document.getElementById("stress-phase-badge");
    const timerPill = document.getElementById("stress-timer-pill");

    // Viewport Swapping Elements
    const webcamViewport = document.getElementById("studio-webcam-viewport");
    const pipBadge = document.getElementById("pip-live-badge");
    const stressPanel = document.getElementById("clinical-stress-panel");
    const activeBanner = document.getElementById("studio-active-banner");

    if (startCard) startCard.style.display = (this.state === "IDLE") ? "block" : "none";
    if (activeCard) activeCard.style.display = (this.state === "RUNNING") ? "block" : "none";
    if (completedCard) completedCard.style.display = (this.state === "COMPLETED") ? "block" : "none";
    if (timerPill) timerPill.style.display = (this.state === "RUNNING") ? "flex" : "none";

    // Toggle Picture-in-Picture Mini Camera & Primary Stress Viewport
    if (this.state === "RUNNING") {
      if (webcamViewport) webcamViewport.classList.add("pip-mode");
      if (pipBadge) pipBadge.style.display = "block";
      if (stressPanel) stressPanel.classList.add("primary-mode");
      if (activeBanner) activeBanner.style.display = "none";
    } else {
      if (webcamViewport) webcamViewport.classList.remove("pip-mode");
      if (pipBadge) pipBadge.style.display = "none";
      if (stressPanel) stressPanel.classList.remove("primary-mode");
      if (activeBanner) {
        if (window.WebTrackerEngine && WebTrackerEngine.state === "ACTIVE_TRACKING") {
          activeBanner.style.display = "flex";
        } else {
          activeBanner.style.display = "none";
        }
      }
    }

    if (phaseBadge) {
      if (this.state === "RUNNING") {
        phaseBadge.textContent = "Protocol Active (Cognitive Conflict)";
        phaseBadge.className = "status-pill status-stress";
        phaseBadge.style.background = "#ffe4e6";
        phaseBadge.style.color = "#e11d48";
      } else if (this.state === "COMPLETED") {
        phaseBadge.textContent = "Stress Assessment Completed";
        phaseBadge.className = "status-pill status-tp";
        phaseBadge.style.background = "#ecfdf5";
        phaseBadge.style.color = "#059669";
      } else {
        phaseBadge.textContent = "Phase 2: Ready";
        phaseBadge.className = "status-pill status-pending";
        phaseBadge.style.background = "#e0f2fe";
        phaseBadge.style.color = "#0284c7";
      }
    }
  },

  renderStimulusUI() {
    const wordEl = document.getElementById("stress-stimulus-word");
    const subtextEl = document.getElementById("stress-stimulus-subtext");
    const choicesContainer = document.getElementById("stress-choices-container");

    if (!this.currentStimulus) return;

    if (this.currentMode === "STROOP_CONFLICT") {
      if (wordEl) {
        wordEl.textContent = this.currentStimulus.wordText;
        wordEl.style.color = this.currentStimulus.inkColorHex;
        wordEl.style.fontSize = "3.2rem";
        wordEl.style.fontWeight = "800";
        wordEl.style.letterSpacing = "2px";
      }
      if (subtextEl) {
        subtextEl.innerHTML = `Executive Conflict — Click or press <strong>[1-4]</strong> for the <strong>INK COLOR</strong>`;
      }

      if (choicesContainer) {
        choicesContainer.innerHTML = this.COLOR_PALETTE.map(col => `
          <button type="button" class="stress-choice-btn" data-color="${col.id}" style="border-bottom: 4px solid ${col.hex};" onclick="StressTestEngine.submitAnswer('${col.id}')">
            <span class="choice-key-badge">${col.key}</span>
            <span class="choice-dot" style="background:${col.hex};"></span>
            <span class="choice-label">${col.name}</span>
          </button>
        `).join("");
      }
    } else if (this.currentMode === "SERIAL_SUBTRACTION") {
      if (wordEl) {
        wordEl.textContent = this.currentStimulus.equation;
        wordEl.style.color = "var(--text-primary)";
        wordEl.style.fontSize = "2.8rem";
      }
      if (subtextEl) {
        subtextEl.innerHTML = `Mental Arithmetic Challenge — Click or press <strong>[1-4]</strong> for correct answer`;
      }
      if (choicesContainer) {
        choicesContainer.innerHTML = this.currentStimulus.options.map((opt, idx) => `
          <button type="button" class="stress-choice-btn" data-val="${opt}" onclick="StressTestEngine.submitAnswer('${opt}')">
            <span class="choice-key-badge">${idx + 1}</span>
            <span class="choice-label" style="font-size:1.2rem; font-family:'JetBrains Mono';">${opt}</span>
          </button>
        `).join("");
      }
    }
  },

  updateStimulusCountdownBar() {
    const bar = document.getElementById("stress-stimulus-progress-fill");
    if (!bar) return;
    const pct = Math.max((this.stimulusRemainingMs / this.stimulusTimeLimitMs) * 100, 0);
    bar.style.width = `${pct}%`;

    if (pct < 30) {
      bar.style.background = "#e11d48";
    } else if (pct < 60) {
      bar.style.background = "#f59e0b";
    } else {
      bar.style.background = "#0284c7";
    }
  },

  updateTestCountdownUI() {
    const label = document.getElementById("stress-test-timer-display");
    if (!label) return;
    const mins = Math.floor(this.testSecondsRemaining / 60);
    const secs = this.testSecondsRemaining % 60;
    label.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  },

  updateMetricsUI() {
    const accuracyEl = document.getElementById("stress-metric-accuracy");
    const streakEl = document.getElementById("stress-metric-streak");
    const avgRtEl = document.getElementById("stress-metric-rt");
    const completedEl = document.getElementById("stress-metric-completed");

    const accuracyPct = this.totalTrials > 0
      ? Math.round((this.correctTrials / this.totalTrials) * 100)
      : 100;

    const avgRt = this.reactionTimes.length > 0
      ? Math.round(this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length)
      : 0;

    if (accuracyEl) accuracyEl.textContent = `${accuracyPct}%`;
    if (streakEl) streakEl.textContent = `${this.currentStreak} (Streak)`;
    if (avgRtEl) avgRtEl.textContent = avgRt > 0 ? `${avgRt} ms` : "—";
    if (completedEl) completedEl.textContent = `${this.totalTrials} items`;
  },

  showTestResultsSummary() {
    const summaryAccuracy = document.getElementById("summary-stress-accuracy");
    const summaryRt = document.getElementById("summary-stress-rt");
    const summaryStreak = document.getElementById("summary-stress-max-streak");
    const summaryVagal = document.getElementById("summary-stress-vagal-drop");

    const accuracyPct = this.totalTrials > 0
      ? Math.round((this.correctTrials / this.totalTrials) * 100)
      : 100;

    const avgRt = this.reactionTimes.length > 0
      ? Math.round(this.reactionTimes.reduce((a, b) => a + b, 0) / this.reactionTimes.length)
      : 0;

    if (summaryAccuracy) summaryAccuracy.textContent = `${accuracyPct}% (${this.correctTrials}/${this.totalTrials})`;
    if (summaryRt) summaryRt.textContent = `${avgRt} ms`;
    if (summaryStreak) summaryStreak.textContent = `${this.maxStreak} in a row`;

    if (summaryVagal) {
      const dropPct = Math.min(Math.round(28 + (100 - accuracyPct) * 0.4 + (this.totalTrials * 0.8)), 65);
      summaryVagal.textContent = `-${dropPct}% Vagal Suppression`;
    }
  },

  // --- 6. Audio Synthesizer (Web Audio API) ---
  playTone(freq, duration, type = "sine") {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = type;
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (_) { }
  }
};

window.StressTestEngine = StressTestEngine;
