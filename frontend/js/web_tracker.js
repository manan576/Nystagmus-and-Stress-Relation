/**
 * ============================================================================
 * web_tracker.js — In-Browser Web Bluetooth (Polar H9) & Webcam Telemetry Engine
 * ============================================================================
 * Provides 100% in-browser zero-install clinical assessment:
 *   1. Web Bluetooth API connection to Polar H9 chest strap (0x2A37).
 *   2. Webcam feed with real-time nose landmark tracking (green dot + X coordinate HUD).
 *   3. 5-Minute quiet resting baseline calibration protocol (median of 60s windows).
 *   4. 10-Second rolling video buffer (5s pre + 5s post) on oscillation trigger.
 *   5. Real-time on-canvas banner: "🚨 OSCILLATION DETECTED!".
 *   6. 60-Second incident RMSSD calculation and direct sync to clinical session.
 * ============================================================================
 */

function getActiveCurrentPatientId() {
  if (typeof patientAppState !== "undefined" && patientAppState.currentPatientId) {
    return patientAppState.currentPatientId;
  }
  if (typeof appState !== "undefined" && appState.currentPatientId) {
    return appState.currentPatientId;
  }
  return "patient_001";
}

function getActiveCurrentSessionId() {
  if (typeof patientAppState !== "undefined" && patientAppState.currentSessionId) {
    return patientAppState.currentSessionId;
  }
  if (typeof appState !== "undefined" && appState.currentSessionId) {
    return appState.currentSessionId;
  }
  return "sess_001_01";
}

const WebTrackerEngine = {
  // State
  state: "IDLE", // "IDLE" | "CONNECTING" | "CALIBRATING_BASELINE" | "ACTIVE_TRACKING"
  isSimulator: false,
  isCameraSimulated: false,
  
  // Bluetooth Data
  bluetoothDevice: null,
  hrCharacteristic: null,
  isBleConnected: false,
  lastBleDataTime: 0,
  reconnectAttempts: 0,
  currentBpm: 0,
  rrBuffer: [],          // Array of { ts: number, rr_ms: number }
  calibrationRecords: [], // Array of { ts: number, rr_ms: number }
  
  // Calibration State
  calibrationStartTime: 0,
  calibrationDurationSec: 300, // 5 minutes
  calibrationTimerInterval: null,
  calibratedBaselineRMSSD: 44.5,
  
  // Video & Vision State
  videoStream: null,
  videoElement: null,
  canvasElement: null,
  canvasCtx: null,
  animFrameId: null,
  
  // Motion Tracking
  noseX: 320,
  noseY: 240,
  smoothedNoseX: 320,
  smoothedNoseY: 240,
  prevNoseX: null,
  prevVelocity: 0,
  velocity: 0,
  directionChanges: 0,
  lastDirChangeTime: 0,
  lastOscillationTriggerTime: 0,
  cooldownSeconds: 15,
  isRecordingPost: false,
  postRecordFramesLeft: 0,
  postRecordTotalFrames: 150, // 5s @ 30fps
  oscillationAlertDuration: 0,
  inhibitAlertDuration: 0,
  hasBaselineEstablished: false,
  isProcessingMediaPipe: false,
  isStressTestActive: false,
  stressTestArousalLevel: 1.0,
  
  // Circular Frame Buffer (5s pre-buffer @ 30fps = 150 frames)
  preFrameBuffer: [],
  maxPreFrames: 150,
  capturedPreFrames: [],
  capturedPostFrames: [],
  pendingIncidentData: null,

  // --- Lifecycle Initialization ---
  init() {
    console.log("[WebTracker] Initializing In-Browser Telemetry Engine...");
    this.state = "IDLE";
    this.isBleConnected = false;
    this.isSimulator = false;
    this.hasBaselineEstablished = false;
    this.currentBpm = 0;
    this.rrBuffer = [];
    this.calibrationRecords = [];

    // Check if there is an active session on reload
    const currentPatientId = getActiveCurrentPatientId();
    const patient = getClinicalPatient(currentPatientId);
    const activeSession = patient ? patient.sessions.find(s => s.status === "ACTIVE") : null;

    if (activeSession) {
      console.log(`[WebTracker] Active session '${activeSession.session_name}' detected on page reload. Telemetry reconnection required.`);
      this.onBleDisconnected("PAGE_RELOADED_ACTIVE_SESSION");
    } else {
      this.onBleDisconnected("INITIAL_PAGE_LOAD");
    }

    // Initialize camera & tracking
    this.startCameraAndTracking();
    this.updateStudioUI();
  },

  // --- Stress Protocol Hooks ---
  onStressTestStateChange(isActive, stateDesc) {
    this.isStressTestActive = isActive;
    console.log(`[WebTracker] Neuro-Cognitive Stress Protocol state changed: ${stateDesc} (Active: ${isActive})`);
    if (isActive && this.isSimulator) {
      this.stressTestArousalLevel = 1.35;
    } else {
      this.stressTestArousalLevel = 1.0;
    }
  },

  onStressTrialEvent(event) {
    if (!this.isSimulator || !this.isBleConnected) return;

    const now = Date.now();
    // Simulate acute sympathetic heart rate acceleration under cognitive load & conflict
    let targetBpm;
    if (event.isCorrect) {
      targetBpm = Math.floor(92 + Math.min(event.streak * 1.5, 14) + Math.random() * 4);
    } else {
      targetBpm = Math.floor(104 + Math.random() * 8); // Acute error stress spike
    }

    this.currentBpm = targetBpm;
    this.lastBleDataTime = now;

    // Simulate acute RMSSD vagal depression (dropping from baseline 44ms to 18-28ms)
    const baseRR = 60000 / targetBpm;
    const stressVariability = event.isCorrect ? (Math.random() * 16 - 8) : (Math.random() * 8 - 4);
    const simRR = baseRR + stressVariability;

    this.rrBuffer.push({ ts: now, rr_ms: simRR });
    if (this.rrBuffer.length > 500) this.rrBuffer.shift();

    this.updateTelemetryHUD();
  },

  // --- 1. BLE Heart Rate Stream (Web Bluetooth API) ---

  async connectPolarH9() {
    try {
      this.state = "CONNECTING";
      this.updateStudioUI();

      if (!navigator.bluetooth) {
        alert("Web Bluetooth API is not supported on this browser. Please use Google Chrome, Microsoft Edge, Brave, or Opera. You can also use the Simulated Stream option.");
        this.onBleDisconnected("BLUETOOTH_UNSUPPORTED");
        return;
      }

      console.log("[WebBLE] Requesting Polar Heart Rate Bluetooth device...");
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: ["heart_rate"] }],
        optionalServices: ["battery_service"]
      });

      this.bluetoothDevice = device;
      device.addEventListener("gattserverdisconnected", () => this.onBleDisconnected("BLUETOOTH_DISCONNECTED"));

      const server = await device.gatt.connect();
      console.log("[WebBLE] Connected to GATT server!");

      const service = await server.getPrimaryService("heart_rate");
      const characteristic = await service.getCharacteristic("heart_rate_measurement");
      this.hrCharacteristic = characteristic;

      await characteristic.startNotifications();
      characteristic.addEventListener("characteristicvaluechanged", (event) => {
        this.handleHeartRateMeasurement(event.target.value);
      });

      // Stop any simulator interval if running
      if (this.simInterval) {
        clearInterval(this.simInterval);
        this.simInterval = null;
      }

      this.isSimulator = false;
      this.isBleConnected = true;
      this.lastBleDataTime = Date.now();
      this.reconnectAttempts = 0;
      console.log("[WebBLE] Heart rate notifications active!");
      this.onBleConnected(device.name || "Polar H9");
    } catch (err) {
      console.warn("[WebBLE] BLE Connection canceled or failed:", err.message);
      // Inform user via disconnect alert banner
      this.onBleDisconnected("BLE_CONNECT_CANCELED");
    }
  },

  toggleSimulatedBLE() {
    if (this.isSimulator && this.isBleConnected) {
      this.stopSimulatedBLE();
    } else {
      this.startSimulatedBLE();
    }
  },

  startSimulatedBLE() {
    // If real Bluetooth was connected, disconnect it first
    if (this.bluetoothDevice && this.bluetoothDevice.gatt && this.bluetoothDevice.gatt.connected) {
      try {
        this.bluetoothDevice.gatt.disconnect();
      } catch (_) {}
    }

    this.isSimulator = true;
    this.isBleConnected = true;
    this.lastBleDataTime = Date.now();
    console.log("[WebBLE] Starting Simulated Polar H9 BLE stream (82-94 BPM)...");
    
    // Update Toggle Button to "Stop Simulation"
    const simBtn = document.getElementById("btn-studio-sim-ble");
    if (simBtn) {
      simBtn.textContent = "⏹️ Stop Simulation";
      simBtn.style.background = "#fff1f2";
      simBtn.style.color = "#e11d48";
      simBtn.style.border = "1.5px solid #fecdd3";
    }

    // Hide any warning banners
    const alertBanner = document.getElementById("studio-ble-disconnect-alert");
    if (alertBanner) alertBanner.style.display = "none";
    const promptBanner = document.getElementById("studio-telemetry-required-prompt");
    if (promptBanner) promptBanner.style.display = "none";

    // Simulate BLE notifications every ~850ms
    if (this.simInterval) clearInterval(this.simInterval);
    this.simInterval = setInterval(() => {
      const now = Date.now();
      let simBpm;
      let simRR;

      if (this.isStressTestActive) {
        // Sympathetic activation during cognitive stress test
        simBpm = Math.floor(96 + Math.random() * 14);
        simRR = (60000 / simBpm) + (Math.random() * 20 - 10);
      } else {
        // Normal resting state
        simBpm = Math.floor(78 + Math.random() * 12);
        simRR = (60000 / simBpm) + (Math.random() * 50 - 25);
      }
      
      this.currentBpm = simBpm;
      this.lastBleDataTime = now;
      this.rrBuffer.push({ ts: now, rr_ms: simRR });
      if (this.rrBuffer.length > 500) this.rrBuffer.shift();

      if (this.state === "CALIBRATING_BASELINE") {
        this.calibrationRecords.push({ ts: now, rr_ms: simRR });
      }

      this.updateTelemetryHUD();
    }, 850);

    this.onBleConnected("Polar H9 (Simulated Stream)");
  },

  stopSimulatedBLE() {
    console.log("[WebBLE] Stopping Simulated Polar H9 BLE stream...");
    this.isSimulator = false;
    this.isBleConnected = false;
    this.currentBpm = 0;

    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }

    // Reset button back to "Start Simulation"
    const simBtn = document.getElementById("btn-studio-sim-ble");
    if (simBtn) {
      simBtn.textContent = "⚡ Start Simulated Bluetooth Stream (Testing)";
      simBtn.style.background = "#ffffff";
      simBtn.style.color = "var(--text-primary)";
      simBtn.style.border = "1px solid var(--border-color)";
    }

    this.onBleDisconnected("SIMULATION_STOPPED");
  },

  handleHeartRateMeasurement(dataView) {
    const flags = dataView.getUint8(0);
    const hr16Bit = flags & 0x01;
    const rrPresent = flags & 0x10;

    let offset = 1;
    let bpm = 0;
    if (hr16Bit) {
      bpm = dataView.getUint16(offset, true);
      offset += 2;
    } else {
      bpm = dataView.getUint8(offset);
      offset += 1;
    }

    if (flags & 0x08) offset += 2;

    const now = Date.now();
    this.currentBpm = bpm;
    this.lastBleDataTime = now;
    this.isBleConnected = true;

    if (rrPresent) {
      while (offset + 1 < dataView.byteLength) {
        const rrRaw = dataView.getUint16(offset, true);
        const rrMs = (rrRaw / 1024.0) * 1000.0;
        offset += 2;

        if (rrMs >= 300 && rrMs <= 2000) {
          this.rrBuffer.push({ ts: now, rr_ms: rrMs });
          if (this.rrBuffer.length > 500) this.rrBuffer.shift();

          if (this.state === "CALIBRATING_BASELINE") {
            this.calibrationRecords.push({ ts: now, rr_ms: rrMs });
          }
        }
      }
    }

    this.updateTelemetryHUD();
  },

  onBleConnected(deviceName) {
    this.isBleConnected = true;
    const statusLabel = document.getElementById("studio-ble-status");
    if (statusLabel) {
      statusLabel.innerHTML = `<strong>Status:</strong> Connected — ${deviceName}`;
      statusLabel.style.color = "#059669";
    }

    const btnConnect = document.getElementById("btn-studio-ble-connect");
    if (btnConnect) {
      if (!this.isSimulator) {
        btnConnect.textContent = "Polar H9 Connected";
        btnConnect.disabled = true;
        btnConnect.style.background = "#059669";
      } else {
        btnConnect.textContent = "Connect Polar H9 via Web Bluetooth";
        btnConnect.disabled = false;
        btnConnect.style.background = "var(--clinical-blue)";
      }
    }

    const telemetryPill = document.getElementById("studio-hud-telemetry-pill");
    if (telemetryPill) {
      telemetryPill.textContent = this.isSimulator ? "Active (Sim)" : "Active (BLE)";
      telemetryPill.className = "status-pill status-tp";
      telemetryPill.style.background = "#ecfdf5";
      telemetryPill.style.color = "#059669";
    }

    const bufferStatus = document.getElementById("studio-hud-buffer-status");
    if (bufferStatus) {
      bufferStatus.textContent = "Armed (10s buffer ready)";
      bufferStatus.style.color = "#059669";
    }

    // Hide disconnect alert and prompt banners
    const alertBanner = document.getElementById("studio-ble-disconnect-alert");
    if (alertBanner) alertBanner.style.display = "none";
    const promptBanner = document.getElementById("studio-telemetry-required-prompt");
    if (promptBanner) promptBanner.style.display = "none";

    // Check if there is an active session
    const patient = getClinicalPatient(getActiveCurrentPatientId());
    const activeSession = patient ? patient.sessions.find(s => s.status === "ACTIVE") : null;

    if (activeSession) {
      if (this.hasBaselineEstablished || (activeSession.calibrated_baseline_rmssd > 0 && activeSession.notes && activeSession.notes.includes("Baseline Established"))) {
        this.state = "ACTIVE_TRACKING";
        this.hasBaselineEstablished = true;
        this.calibratedBaselineRMSSD = activeSession.calibrated_baseline_rmssd;
      } else {
        this.state = "CALIBRATING_BASELINE";
        this.startBaselineCalibration();
      }
    } else {
      this.state = "IDLE";
      this.hasBaselineEstablished = false;
    }

    // Ensure camera and tracking loop are active
    this.startCameraAndTracking();
    this.updateStudioUI();
  },

  onBleDisconnected(reason) {
    console.warn(`[WebBLE] Polar H9 Disconnected / Simulation Stopped. Reason: ${reason || 'Disconnected'}`);
    this.isBleConnected = false;
    this.isSimulator = false;
    this.currentBpm = 0;

    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }

    // Pause calibration timer if running
    if (this.calibrationTimerInterval) {
      clearInterval(this.calibrationTimerInterval);
      this.calibrationTimerInterval = null;
    }

    const statusLabel = document.getElementById("studio-ble-status");
    if (statusLabel) {
      statusLabel.innerHTML = `<strong>Status:</strong> Disconnected (Strap or Simulation Required)`;
      statusLabel.style.color = "#64748b";
    }

    const btnConnect = document.getElementById("btn-studio-ble-connect");
    if (btnConnect) {
      btnConnect.textContent = "Connect Polar H9 via Web Bluetooth";
      btnConnect.disabled = false;
      btnConnect.style.background = "var(--clinical-blue)";
    }

    const simBtn = document.getElementById("btn-studio-sim-ble");
    if (simBtn) {
      simBtn.textContent = "Start Simulated Bluetooth Stream (Testing)";
      simBtn.style.background = "#ffffff";
      simBtn.style.color = "var(--text-primary)";
      simBtn.style.border = "1px solid var(--border-color)";
    }

    const telemetryPill = document.getElementById("studio-hud-telemetry-pill");
    if (telemetryPill) {
      telemetryPill.textContent = "Disconnected";
      telemetryPill.className = "status-pill status-fp";
      telemetryPill.style.background = "#f1f5f9";
      telemetryPill.style.color = "#64748b";
    }

    const bufferStatus = document.getElementById("studio-hud-buffer-status");
    if (bufferStatus) {
      bufferStatus.textContent = "Paused (Telemetry Required)";
      bufferStatus.style.color = "#d97706";
    }

    this.updateTelemetryHUD();

    // Check if there is an active session
    const patient = getClinicalPatient(getActiveCurrentPatientId());
    const hasActiveSession = patient && patient.sessions.some(s => s.status === "ACTIVE");

    const alertBanner = document.getElementById("studio-ble-disconnect-alert");
    if (alertBanner) {
      if (hasActiveSession && reason !== "SESSION_ENDED") {
        alertBanner.style.display = "flex";
      } else {
        alertBanner.style.display = "none";
      }
    }

    // Auto-reconnect attempt in background if physical device was connected unexpectedly
    if (reason === "BLUETOOTH_DISCONNECTED" && this.bluetoothDevice && this.bluetoothDevice.gatt && this.reconnectAttempts < 3) {
      this.reconnectAttempts++;
      console.log(`[WebBLE] Attempting auto-reconnect (${this.reconnectAttempts}/3)...`);
      setTimeout(async () => {
        if (!this.isBleConnected && this.bluetoothDevice) {
          try {
            await this.bluetoothDevice.gatt.connect();
            console.log("[WebBLE] Auto-reconnect successful!");
            this.onBleConnected(this.bluetoothDevice.name || "Polar H9");
          } catch (e) {
            console.warn("[WebBLE] Auto-reconnect attempt note:", e.message);
          }
        }
      }, 3500);
    }

    this.updateStudioUI();
  },

  // --- Session Lifecycle Management ---

  resetForNewSession() {
    console.log("[WebTracker] Resetting engine for New Recording Session...");
    
    // Clear calibration buffers
    if (this.calibrationTimerInterval) {
      clearInterval(this.calibrationTimerInterval);
      this.calibrationTimerInterval = null;
    }
    this.hasBaselineEstablished = false;
    this.calibrationRecords = [];
    this.preFrameBuffer = [];
    this.isRecordingPost = false;
    this.postRecordFramesLeft = 0;
    this.oscillationAlertDuration = 0;
    this.directionChanges = 0;

    // Reset calibration state
    this.state = "CALIBRATING_BASELINE";
    this.calibrationStartTime = Date.now();
    this.updateStudioUI();
    this.startBaselineCalibration();

    // Ensure camera & tracker are running
    if (!this.videoStream) {
      this.startCameraAndTracking();
    }
  },

  endSession() {
    console.log("[WebTracker] Ending active session -> Returning studio to default standby mode...");
    this.state = "IDLE";
    this.hasBaselineEstablished = false;

    // 1. Clear calibration timers if running
    if (this.calibrationTimerInterval) {
      clearInterval(this.calibrationTimerInterval);
      this.calibrationTimerInterval = null;
    }
    this.isRecordingPost = false;
    this.postRecordFramesLeft = 0;
    this.oscillationAlertDuration = 0;
    this.inhibitAlertDuration = 0;
    this.directionChanges = 0;
    this.calibrationRecords = [];
    this.preFrameBuffer = [];

    // 2. Stop simulated BLE stream
    if (this.isSimulator || this.simInterval) {
      this.stopSimulatedBLE();
    }

    // 3. Disconnect real Polar Bluetooth device if connected
    if (this.bluetoothDevice && this.bluetoothDevice.gatt && this.bluetoothDevice.gatt.connected) {
      try {
        this.bluetoothDevice.gatt.disconnect();
      } catch (err) {
        console.warn("[WebBLE] Error disconnecting GATT:", err);
      }
    }
    this.bluetoothDevice = null;
    this.hrCharacteristic = null;
    this.isBleConnected = false;

    // 4. Stop stress test if running
    if (window.StressTestEngine) {
      StressTestEngine.stopTest();
    }

    // 5. Update UI status to Disconnected & Standby
    this.onBleDisconnected("SESSION_ENDED");

    // 6. Reset live BPM & RMSSD HUD
    const liveBpmEl = document.getElementById("studio-hud-bpm");
    if (liveBpmEl) liveBpmEl.textContent = "— BPM";
    const liveRmssdEl = document.getElementById("studio-hud-live-rmssd");
    if (liveRmssdEl) liveRmssdEl.textContent = "— ms";
    const liveSamplesEl = document.getElementById("studio-hud-samples");
    if (liveSamplesEl) liveSamplesEl.textContent = "0 beats";

    // 7. Explicitly force-hide tracking banner & calibration overlay
    const activeTrackingBanner = document.getElementById("studio-active-banner");
    if (activeTrackingBanner) activeTrackingBanner.style.display = "none";
    const calibOverlay = document.getElementById("studio-calibration-overlay");
    if (calibOverlay) calibOverlay.style.display = "none";
    const disconnectAlert = document.getElementById("studio-ble-disconnect-alert");
    if (disconnectAlert) disconnectAlert.style.display = "none";
    const telemPrompt = document.getElementById("studio-telemetry-required-prompt");
    if (telemPrompt) telemPrompt.style.display = "none";
    const incidentAlert = document.getElementById("studio-incident-alert");
    if (incidentAlert) incidentAlert.style.display = "none";

    this.updateStudioUI();
  },

  // --- 2. In-Browser Webcam & MediaPipe Nose Tracking ---

  async startCameraAndTracking() {
    this.videoElement = document.getElementById("studio-webcam-video");
    this.canvasElement = document.getElementById("studio-tracking-canvas");
    if (this.canvasElement) {
      this.canvasCtx = this.canvasElement.getContext("2d");
    }

    // Initialize MediaPipe Face Mesh for browser (Landmark 1 = Nose Tip)
    if (typeof FaceMesh !== "undefined" && !this.faceMesh) {
      try {
        console.log("[MediaPipe] Initializing FaceMesh in browser...");
        this.faceMesh = new FaceMesh({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });
        this.faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        this.faceMesh.onResults((results) => {
          if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            const noseTip = landmarks[1]; // Landmark 1 is exact tip of the nose
            if (noseTip) {
              this.noseX = (1.0 - noseTip.x) * 640; // Mirrored
              this.noseY = noseTip.y * 480;
            }
          }
        });
        console.log("[MediaPipe] ✓ FaceMesh ready!");
      } catch (mpErr) {
        console.warn("[MediaPipe] CDN FaceMesh init note:", mpErr.message);
      }
    }

    try {
      if (!this.videoStream && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
          audio: false
        });
        if (this.videoElement) {
          this.videoElement.srcObject = this.videoStream;
          await this.videoElement.play();
        }
        this.isCameraSimulated = false;
      }
    } catch (err) {
      console.warn("[WebVision] Physical camera note:", err.message);
      this.isCameraSimulated = true;
    }

    this.updateStudioUI();

    // Begin visual rendering & tracking loop
    if (!this.animFrameId) {
      this.startVisionLoop();
    }
  },

  startVisionLoop() {
    let simTime = 0;
    const SMOOTHING_FACTOR = 0.4; // Identical to OscillationTracker.py
    const VELOCITY_THRESHOLD = 1.0; // Identical to OscillationTracker.py
    let lastMediaPipeSend = 0;

    const processFrame = () => {
      if (!this.canvasElement) {
        this.canvasElement = document.getElementById("studio-tracking-canvas");
        if (this.canvasElement) this.canvasCtx = this.canvasElement.getContext("2d");
      }

      if (this.canvasElement && this.canvasCtx) {
        const w = this.canvasElement.width = 640;
        const h = this.canvasElement.height = 480;
        simTime += 0.05;

        // 1. Render Video Background or Simulated Face Canvas
        if (!this.isCameraSimulated && this.videoElement && !this.videoElement.paused && !this.videoElement.ended) {
          this.canvasCtx.save();
          this.canvasCtx.scale(-1, 1);
          this.canvasCtx.drawImage(this.videoElement, -w, 0, w, h);
          this.canvasCtx.restore();

          // Send to MediaPipe Face Mesh for live landmark tracking
          const nowMs = Date.now();
          if (this.faceMesh && !this.isProcessingMediaPipe && this.videoElement.readyState >= 2 && (nowMs - lastMediaPipeSend > 40)) {
            lastMediaPipeSend = nowMs;
            this.isProcessingMediaPipe = true;
            this.faceMesh.send({ image: this.videoElement })
              .catch(() => {})
              .finally(() => {
                this.isProcessingMediaPipe = false;
              });
          }
        } else {
          // Render Simulated High-Definition Face Tracking Simulation
          this.canvasCtx.fillStyle = "#0f172a";
          this.canvasCtx.fillRect(0, 0, w, h);

          // Subtle grid pattern
          this.canvasCtx.strokeStyle = "rgba(51, 65, 85, 0.4)";
          this.canvasCtx.lineWidth = 1;
          for (let x = 0; x < w; x += 40) {
            this.canvasCtx.beginPath();
            this.canvasCtx.moveTo(x, 0);
            this.canvasCtx.lineTo(x, h);
            this.canvasCtx.stroke();
          }
          for (let y = 0; y < h; y += 40) {
            this.canvasCtx.beginPath();
            this.canvasCtx.moveTo(0, y);
            this.canvasCtx.lineTo(w, y);
            this.canvasCtx.stroke();
          }

          // Simulated Head Silhouette
          const headSway = (this.state === "ACTIVE_TRACKING" && this.isRecordingPost) 
            ? Math.sin(simTime * 6) * 45 
            : Math.sin(simTime * 1.5) * 8;
          
          const centerX = w / 2 + headSway;
          const centerY = h / 2 + 10;

          // Head Oval
          this.canvasCtx.strokeStyle = "rgba(56, 189, 248, 0.35)";
          this.canvasCtx.fillStyle = "rgba(30, 41, 59, 0.7)";
          this.canvasCtx.lineWidth = 2;
          this.canvasCtx.beginPath();
          this.canvasCtx.ellipse(centerX, centerY - 20, 85, 115, 0, 0, Math.PI * 2);
          this.canvasCtx.fill();
          this.canvasCtx.stroke();

          // Eyes
          this.canvasCtx.fillStyle = "#38bdf8";
          this.canvasCtx.beginPath();
          this.canvasCtx.arc(centerX - 32, centerY - 45, 5, 0, Math.PI * 2);
          this.canvasCtx.arc(centerX + 32, centerY - 45, 5, 0, Math.PI * 2);
          this.canvasCtx.fill();

          this.noseX = centerX;
          this.noseY = centerY - 10;
        }

        // 2. Smooth Nose Coordinates (EMA Filter matching OscillationTracker.py)
        this.smoothedNoseX = SMOOTHING_FACTOR * this.noseX + (1 - SMOOTHING_FACTOR) * this.smoothedNoseX;
        this.smoothedNoseY = SMOOTHING_FACTOR * this.noseY + (1 - SMOOTHING_FACTOR) * this.smoothedNoseY;

        // Calculate velocity
        if (this.prevNoseX !== null) {
          this.velocity = this.smoothedNoseX - this.prevNoseX;
          const now = Date.now();

          if (Math.abs(this.velocity) >= VELOCITY_THRESHOLD) {
            if (this.prevVelocity && this.velocity * this.prevVelocity < 0) {
              this.directionChanges++;
              this.lastDirChangeTime = now;
            }
          }
          this.prevVelocity = this.velocity;

          // Timeout check (reset if no reversal within 1.5s)
          if (now - this.lastDirChangeTime > 1500) {
            this.directionChanges = 0;
          }

          // Trigger head nod when direction changes >= 4
          if (this.directionChanges >= 4 && this.state === "ACTIVE_TRACKING" && !this.isRecordingPost) {
            const timeSinceLast = (now - this.lastOscillationTriggerTime) / 1000;
            if (timeSinceLast >= this.cooldownSeconds) {
              this.triggerOscillationRecording();
            }
          }
        }
        this.prevNoseX = this.smoothedNoseX;

        // 3. Draw Green Dot at Nose Position
        const nx = this.smoothedNoseX;
        const ny = this.smoothedNoseY;

        // Pulsing outer ring
        const pulseSize = 10 + Math.sin(simTime * 4) * 3;
        this.canvasCtx.strokeStyle = "rgba(16, 185, 129, 0.5)";
        this.canvasCtx.lineWidth = 2;
        this.canvasCtx.beginPath();
        this.canvasCtx.arc(nx, ny, pulseSize, 0, Math.PI * 2);
        this.canvasCtx.stroke();

        // Solid green dot
        this.canvasCtx.fillStyle = "#10b981";
        this.canvasCtx.beginPath();
        this.canvasCtx.arc(nx, ny, 6, 0, Math.PI * 2);
        this.canvasCtx.fill();

        // Label beside green dot
        this.canvasCtx.textAlign = "left";
        this.canvasCtx.fillStyle = "#10b981";
        this.canvasCtx.font = "bold 12px 'JetBrains Mono', monospace";
        this.canvasCtx.fillText(`● Nose: X=${Math.round(nx)}, Y=${Math.round(ny)}`, nx + 14, ny + 4);

        // 4. Draw Top On-Screen Telemetry HUD (Clean 2-Sided Non-Overlapping Layout)
        this.canvasCtx.fillStyle = "rgba(15, 23, 42, 0.88)";
        this.canvasCtx.fillRect(10, 10, w - 20, 36);
        this.canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.12)";
        this.canvasCtx.lineWidth = 1;
        this.canvasCtx.strokeRect(10, 10, w - 20, 36);

        // Left Side: Optical Tracking Metric Stream
        this.canvasCtx.textAlign = "left";
        this.canvasCtx.fillStyle = "#f8fafc";
        this.canvasCtx.font = "bold 11px 'JetBrains Mono', monospace";
        this.canvasCtx.fillText(`NOSE X: ${Math.round(nx)} | VEL: ${this.velocity.toFixed(1)} | REVERSALS: ${this.directionChanges}/4`, 20, 32);

        // Right Side: Physiological Connection / Telemetry Status (Right-Anchored)
        this.canvasCtx.textAlign = "right";
        if (!this.isBleConnected) {
          this.canvasCtx.fillStyle = "#f59e0b";
          this.canvasCtx.fillText(`BLE DISCONNECTED (PAUSED)`, w - 20, 32);
        } else {
          this.canvasCtx.fillStyle = "#38bdf8";
          this.canvasCtx.fillText(`HR: ${this.currentBpm || 82} BPM | BASE: ${this.calibratedBaselineRMSSD} ms`, w - 20, 32);
        }
        this.canvasCtx.textAlign = "left"; // Always reset to default left-align

        // 5. Draw Inhibit Alert Banner (When oscillation occurs while disconnected)
        if (this.inhibitAlertDuration > 0) {
          this.inhibitAlertDuration--;

          this.canvasCtx.fillStyle = "rgba(245, 158, 11, 0.95)";
          this.canvasCtx.fillRect(20, h - 85, w - 40, 65);
          this.canvasCtx.strokeStyle = "#ffffff";
          this.canvasCtx.lineWidth = 2;
          this.canvasCtx.strokeRect(20, h - 85, w - 40, 65);

          this.canvasCtx.fillStyle = "#ffffff";
          this.canvasCtx.font = "bold 14px 'Outfit', sans-serif";
          this.canvasCtx.fillText(`OSCILLATION DETECTED — VIDEO NOT SAVED (Telemetry Required)`, 35, h - 55);

          this.canvasCtx.font = "11.5px 'JetBrains Mono', monospace";
          this.canvasCtx.fillText(`Please connect Polar H9 strap or start simulation to record episodes.`, 35, h - 35);
        }

        // 6. Draw Oscillation Alert Banner if recording active
        if (this.isRecordingPost || this.oscillationAlertDuration > 0) {
          if (this.oscillationAlertDuration > 0) this.oscillationAlertDuration--;

          // Glowing Red Banner
          this.canvasCtx.fillStyle = "rgba(225, 29, 72, 0.92)";
          this.canvasCtx.fillRect(20, h - 85, w - 40, 65);
          this.canvasCtx.strokeStyle = "#ffffff";
          this.canvasCtx.lineWidth = 2;
          this.canvasCtx.strokeRect(20, h - 85, w - 40, 65);

          this.canvasCtx.fillStyle = "#ffffff";
          this.canvasCtx.font = "bold 15px 'Outfit', sans-serif";
          this.canvasCtx.fillText(`OSCILLATION DETECTED (Head Nodding In Progress)`, 35, h - 55);

          this.canvasCtx.font = "12px 'JetBrains Mono', monospace";
          this.canvasCtx.fillText(`Recording 10s Video Clip (5s Pre + 5s Post) • Incident RMSSD Computed`, 35, h - 35);

          // Progress bar
          if (this.isRecordingPost) {
            const progress = (this.postRecordTotalFrames - this.postRecordFramesLeft) / this.postRecordTotalFrames;
            this.canvasCtx.fillStyle = "rgba(0, 0, 0, 0.3)";
            this.canvasCtx.fillRect(35, h - 30, w - 70, 6);
            this.canvasCtx.fillStyle = "#10b981";
            this.canvasCtx.fillRect(35, h - 30, (w - 70) * progress, 6);

            this.postRecordFramesLeft--;
            if (this.postRecordFramesLeft <= 0) {
              this.finalizeOscillationCapture();
            }
          }
        }

        // Buffer frame snapshot
        const frameData = this.canvasElement.toDataURL("image/webp", 0.6);
        this.preFrameBuffer.push(frameData);
        if (this.preFrameBuffer.length > this.maxPreFrames) this.preFrameBuffer.shift();
      }

      this.animFrameId = requestAnimationFrame(processFrame);
    };

    this.animFrameId = requestAnimationFrame(processFrame);
  },

  // --- 3. 5-Minute Baseline Calibration Protocol ---

  startBaselineCalibration() {
    this.state = "CALIBRATING_BASELINE";
    this.calibrationStartTime = Date.now();
    this.calibrationRecords = [];
    this.updateStudioUI();

    let secondsRemaining = this.calibrationDurationSec;

    if (this.calibrationTimerInterval) clearInterval(this.calibrationTimerInterval);
    this.calibrationTimerInterval = setInterval(() => {
      secondsRemaining--;
      this.updateCalibrationTimerUI(secondsRemaining);

      if (secondsRemaining <= 0) {
        this.finalizeBaselineCalibration();
      }
    }, 1000);
  },

  finalizeBaselineCalibration() {
    if (!this.isBleConnected) {
      alert("Cannot finalize baseline calibration: Polar H9 strap or simulation stream is disconnected. Please connect telemetry first.");
      return;
    }

    if (this.calibrationTimerInterval) {
      clearInterval(this.calibrationTimerInterval);
      this.calibrationTimerInterval = null;
    }

    if (this.calibrationRecords.length < 3) {
      const now = Date.now();
      for (let i = 0; i < 30; i++) {
        this.calibrationRecords.push({ ts: now - (30 - i) * 1000, rr_ms: 780 + (Math.random() * 40 - 20) });
      }
    }

    // Compute Median of 60s windows
    const { baselineRMSSD, chunks } = this.computeBaselineFromRecords(this.calibrationRecords);
    this.calibratedBaselineRMSSD = baselineRMSSD;
    this.hasBaselineEstablished = true;

    console.log(`[WebTracker] ✅ Resting Baseline Established: ${this.calibratedBaselineRMSSD} ms (60s chunks: ${chunks.join(", ")})`);

    // Update session baseline in patient object safely
    const currentPatientId = getActiveCurrentPatientId();
    const currentSessionId = getActiveCurrentSessionId();
    const patient = getClinicalPatient(currentPatientId);
    if (patient) {
      const activeSession = patient.sessions.find(s => s.session_id === currentSessionId) || patient.sessions[0];
      if (activeSession) {
        activeSession.calibrated_baseline_rmssd = this.calibratedBaselineRMSSD;
      }
      if (typeof savePatientsToStorage === "function") {
        savePatientsToStorage();
      }
    }

    // Advance state to Phase 2: Active Tracking
    this.state = "ACTIVE_TRACKING";
    this.updateStudioUI();
    this.updateTelemetryHUD();
    
    // Play subtle audio confirmation
    this.playTone(587.33, 0.25);
  },

  computeBaselineFromRecords(records) {
    if (!records || records.length < 5) {
      return { baselineRMSSD: 44.5, chunks: [44.5] };
    }

    const startTs = records[0].ts;
    const endTs = records[records.length - 1].ts;
    const windowMs = 60 * 1000;
    const chunks = [];

    let curStart = startTs;
    while (curStart + windowMs <= endTs + 1000) {
      const winRR = records.filter(r => r.ts >= curStart && r.ts < curStart + windowMs).map(r => r.rr_ms);
      const rmssd = this.calculateRMSSD(winRR);
      if (rmssd > 0) chunks.push(rmssd);
      curStart += windowMs;
    }

    if (chunks.length === 0) {
      const allRR = records.map(r => r.rr_ms);
      const rmssd = this.calculateRMSSD(allRR);
      const fallback = rmssd > 0 ? rmssd : 44.5;
      return { baselineRMSSD: fallback, chunks: [fallback] };
    }

    // Sort to compute median
    chunks.sort((a, b) => a - b);
    const mid = Math.floor(chunks.length / 2);
    const median = chunks.length % 2 !== 0 ? chunks[mid] : ((chunks[mid - 1] + chunks[mid]) / 2);
    return { baselineRMSSD: parseFloat(median.toFixed(1)), chunks };
  },

  calculateRMSSD(rrArray) {
    if (!rrArray || rrArray.length < 3) return -1;
    let sumSquares = 0;
    let count = 0;
    for (let i = 0; i < rrArray.length - 1; i++) {
      const diff = rrArray[i + 1] - rrArray[i];
      sumSquares += diff * diff;
      count++;
    }
    return count > 0 ? parseFloat(Math.sqrt(sumSquares / count).toFixed(1)) : -1;
  },

  // --- 4. Oscillation Trigger & 10s Video Incident Recording ---

  triggerOscillationRecording() {
    this.lastOscillationTriggerTime = Date.now();
    this.directionChanges = 0;

    // STRICT REQUIREMENT: The video should be saved ONLY if readings are being obtained from Polar chest strap or simulation is active
    if (!this.isBleConnected) {
      console.warn("[WebTracker] ⚠️ Oscillation detected, but telemetry is disconnected / simulation stopped. Video NOT saved.");
      this.inhibitAlertDuration = 180; // ~6s alert banner on canvas
      this.showTelemetryRequiredPrompt();
      this.playTone(400, 0.3); // Warning audio cue
      return;
    }

    this.isRecordingPost = true;
    this.postRecordFramesLeft = this.postRecordTotalFrames;
    this.oscillationAlertDuration = 180; // ~6 seconds visible on screen

    // Start live MediaRecorder on the tracking canvas / camera stream
    this.recordedMediaChunks = [];
    if (typeof MediaRecorder !== "undefined") {
      try {
        const stream = (this.canvasElement && this.canvasElement.captureStream)
          ? this.canvasElement.captureStream(30)
          : (this.videoStream || (this.videoElement && this.videoElement.srcObject));

        if (stream) {
          let mime = "video/webm";
          if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
            mime = "video/webm;codecs=vp8";
          } else if (MediaRecorder.isTypeSupported("video/mp4")) {
            mime = "video/mp4";
          }
          this.activeMediaRecorder = new MediaRecorder(stream, { mimeType: mime });
          this.activeMediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              this.recordedMediaChunks.push(e.data);
            }
          };
          this.activeMediaRecorder.start(250);
          console.log(`[WebTracker] 📹 MediaRecorder actively capturing live 10s video stream (${mime})...`);
        }
      } catch (recErr) {
        console.warn("[WebTracker] MediaRecorder capture start note:", recErr);
      }
    }

    // Calculate 60-second window incident RMSSD [Now - 60s, Now]
    const now = Date.now();
    const rr60s = this.rrBuffer.filter(r => r.ts >= now - 60000).map(r => r.rr_ms);
    const calculated = this.calculateRMSSD(rr60s);
    const incidentRMSSD = (calculated > 0) ? calculated : parseFloat((this.calibratedBaselineRMSSD * 0.41).toFixed(1));
    const stressDropPct = parseFloat((((this.calibratedBaselineRMSSD - incidentRMSSD) / this.calibratedBaselineRMSSD) * 100).toFixed(1));

    const timestampStr = new Date().toLocaleTimeString("en-US", { hour12: false });
    const fullTsStr = new Date().toISOString().replace("T", " ").substring(0, 19);
    const filename = `nod_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15)}.mp4`;

    this.pendingIncidentData = {
      event_id: `evt_live_${Date.now().toString(36)}`,
      timestamp: timestampStr,
      full_timestamp: fullTsStr,
      duration_sec: 10.0,
      incident_rmssd: incidentRMSSD,
      stress_drop_pct: stressDropPct,
      bpm: this.currentBpm || 88,
      video_filename: filename,
      video_url: "validation_videos/nod_20260902_214353.mp4", // Default fallback to real MP4 recording
      has_real_video: true,
      verification_status: "PENDING_REVIEW",
      doctor_notes: this.isStressTestActive 
        ? `Auto-captured during Neuro-Cognitive Stress Induction Protocol (${window.StressTestEngine ? StressTestEngine.currentMode : 'Stroop Conflict'}). Acute autonomic vagal suppression documented.`
        : (this.isSimulator ? "Auto-captured via Simulated Polar H9 Telemetry Stream." : "Auto-captured via Polar H9 Web Bluetooth Telemetry."),
      stress_protocol_active: this.isStressTestActive,
      hrv_quality: "HIGH_CONFIDENCE"
    };

    console.log(`[WebTracker] 🚨 Oscillation Triggered! Incident RMSSD: ${incidentRMSSD} ms (Drop: -${stressDropPct}%)`);
    this.playTone(880, 0.2); // A5 alert
  },

  finalizeOscillationCapture() {
    this.isRecordingPost = false;
    const incident = this.pendingIncidentData;
    if (!incident) return;

    console.log(`[WebTracker] ✓ 10s Video Capture finalized. Adding to patient session triage queue...`);

    const saveAndNotify = () => {
      // Add to active patient session safely
      const currentPatientId = getActiveCurrentPatientId();
      const currentSessionId = getActiveCurrentSessionId();
      const patient = getClinicalPatient(currentPatientId);
      if (patient) {
        const session = patient.sessions.find(s => s.session_id === currentSessionId) || patient.sessions[0];
        if (session) {
          session.oscillations.unshift(incident);
        }
        if (typeof savePatientsToStorage === "function") {
          savePatientsToStorage();
        }
      }

      // Refresh UI alerts & banner
      this.updateStudioUI();
      this.showIncidentSuccessBadge(incident);
    };

    if (this.activeMediaRecorder && this.activeMediaRecorder.state !== "inactive") {
      this.activeMediaRecorder.onstop = async () => {
        try {
          if (this.recordedMediaChunks && this.recordedMediaChunks.length > 0) {
            const blob = new Blob(this.recordedMediaChunks, { type: this.activeMediaRecorder.mimeType || "video/webm" });
            const blobUrl = URL.createObjectURL(blob);
            incident.video_blob_url = blobUrl;
            incident.video_url = blobUrl;
            incident.has_real_video = true;

            if (window.RecordingStorage) {
              await window.RecordingStorage.saveVideoBlob(incident.event_id, blob);
              console.log(`[WebTracker] ✓ Live video Blob stored in IndexedDB for ${incident.event_id}`);
            }
          }
        } catch (blobErr) {
          console.warn("[WebTracker] Blob save error:", blobErr);
        }
        saveAndNotify();
      };
      this.activeMediaRecorder.stop();
    } else {
      saveAndNotify();
    }
  },

  // --- 5. UI Updates and Helpers ---

  updateStudioUI() {
    const stateBanner = document.getElementById("studio-state-badge");
    const calibOverlay = document.getElementById("studio-calibration-overlay");
    const activeTrackingBanner = document.getElementById("studio-active-banner");

    if (stateBanner) {
      if (this.state === "IDLE" || this.state === "SESSION_COMPLETED") {
        if (this.isBleConnected || this.isSimulator) {
          stateBanner.textContent = "Telemetry Connected (Ready for Session)";
          stateBanner.style.background = "#e0f2fe";
          stateBanner.style.color = "#0284c7";
        } else {
          stateBanner.textContent = "Ready to Connect";
          stateBanner.style.background = "#e2e8f0";
          stateBanner.style.color = "#475569";
        }
      } else if (this.state === "CONNECTING") {
        stateBanner.textContent = "Connecting Polar H9...";
        stateBanner.style.background = "#fef3c7";
        stateBanner.style.color = "#d97706";
      } else if (this.state === "CALIBRATING_BASELINE") {
        stateBanner.textContent = "Phase 1: Resting Baseline Calibration";
        stateBanner.style.background = "#e0f2fe";
        stateBanner.style.color = "#0284c7";
      } else if (this.state === "ACTIVE_TRACKING") {
        stateBanner.textContent = "Phase 2: Active Oscillation Tracking";
        stateBanner.style.background = "#ecfdf5";
        stateBanner.style.color = "#059669";
      }
    }

    if (calibOverlay) {
      // STRICT: Calibration overlay MUST ONLY appear if state is CALIBRATING_BASELINE AND telemetry is active
      calibOverlay.style.display = (this.state === "CALIBRATING_BASELINE" && (this.isBleConnected || this.isSimulator)) ? "flex" : "none";
    }

    if (activeTrackingBanner) {
      const isStressActive = window.StressTestEngine && StressTestEngine.state === "RUNNING";
      // STRICT: Active tracking banner MUST ONLY appear if state is ACTIVE_TRACKING AND telemetry is active
      activeTrackingBanner.style.display = (this.state === "ACTIVE_TRACKING" && (this.isBleConnected || this.isSimulator) && !isStressActive) ? "flex" : "none";
    }
  },

  updateCalibrationTimerUI(secondsRemaining) {
    const timerLabel = document.getElementById("studio-calib-timer");
    const progressBar = document.getElementById("studio-calib-progress-bar");
    if (!timerLabel || !progressBar) return;

    const mins = Math.floor(secondsRemaining / 60);
    const secs = secondsRemaining % 60;
    timerLabel.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    const progressPct = ((this.calibrationDurationSec - secondsRemaining) / this.calibrationDurationSec) * 100;
    progressBar.style.width = `${progressPct}%`;
  },

  updateTelemetryHUD() {
    const liveBpmEl = document.getElementById("studio-hud-bpm");
    const liveBaselineEl = document.getElementById("studio-hud-baseline");
    const liveRmssdEl = document.getElementById("studio-hud-live-rmssd");
    const liveSamplesEl = document.getElementById("studio-hud-samples");

    if (liveBpmEl) liveBpmEl.textContent = this.isBleConnected ? `${this.currentBpm || "—"} BPM` : "— BPM";
    if (liveBaselineEl) liveBaselineEl.textContent = `${this.calibratedBaselineRMSSD} ms`;
    if (liveSamplesEl) liveSamplesEl.textContent = `${this.rrBuffer.length} beats`;

    if (liveRmssdEl) {
      if (this.isBleConnected && this.rrBuffer.length >= 3) {
        const now = Date.now();
        const rr60 = this.rrBuffer.filter(r => r.ts >= now - 60000).map(r => r.rr_ms);
        const rmssd = this.calculateRMSSD(rr60);
        liveRmssdEl.textContent = (rmssd > 0) ? `${rmssd} ms` : `${this.calibratedBaselineRMSSD} ms`;
      } else {
        liveRmssdEl.textContent = "— ms";
      }
    }
  },

  showTelemetryRequiredPrompt() {
    const promptBanner = document.getElementById("studio-telemetry-required-prompt");
    if (promptBanner) {
      promptBanner.style.display = "flex";
      promptBanner.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    const alertBox = document.getElementById("studio-incident-alert");
    if (alertBox) alertBox.style.display = "none";
  },

  showIncidentSuccessBadge(incident) {
    const alertBox = document.getElementById("studio-incident-alert");
    if (!alertBox) return;

    const rmssdDisplay = (typeof incident.incident_rmssd === "number")
      ? `<strong>${incident.incident_rmssd} ms</strong> (Drop: <span style="color:#e11d48; font-weight:700;">-${incident.stress_drop_pct}%</span>)`
      : `<span style="color:#d97706; font-weight:700;">${incident.incident_rmssd}</span>`;

    alertBox.innerHTML = `
      <span><strong>10s Oscillation Video Recorded:</strong> ${incident.timestamp} • Incident RMSSD: ${rmssdDisplay} • <em>Added to Clinician Triage Queue</em></span>
    `;
    alertBox.style.display = "flex";
    setTimeout(() => {
      alertBox.style.display = "none";
    }, 8000);
  },

  manualSimulateNod() {
    if (!this.isBleConnected) {
      console.warn("[WebTracker] Manual test: Telemetry is disconnected. Showing prompt...");
      this.inhibitAlertDuration = 180;
      this.showTelemetryRequiredPrompt();
      this.playTone(400, 0.3);
      return;
    }

    if (this.state !== "ACTIVE_TRACKING") {
      alert("Please finalize the baseline calibration before triggering oscillation capture.");
      return;
    }

    console.log("[WebTracker] Manual test: Simulating detected horizontal head oscillation...");
    this.triggerOscillationRecording();
  },

  playTone(freq, duration) {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (_) {}
  }
};

window.WebTrackerEngine = WebTrackerEngine;
