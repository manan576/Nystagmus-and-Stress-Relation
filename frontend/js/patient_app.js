/**
 * ============================================================================
 * patient_app.js — Controller for Dedicated Patient Assessment Studio (patient.html)
 * ============================================================================
 */

let patientAppState = {
  currentPatientId: "patient_001",
  currentSessionId: "sess_001_01"
};
window.patientAppState = patientAppState;

document.addEventListener("DOMContentLoaded", () => {
  initPatientApp();
});

function initPatientApp() {
  if (window.AuthManager) {
    AuthManager.init("PATIENT");
    patientAppState.currentPatientId = AuthManager.getCurrentPatientId();
  }
  loadPatientsFromStorage();
  setupPatientStudioEventListeners();
  if (window.WebTrackerEngine && typeof WebTrackerEngine.init === "function") {
    WebTrackerEngine.init();
  }
  loadPatientStudioData(patientAppState.currentPatientId);
  enforcePatientPickerScoping();
}

function enforcePatientPickerScoping() {
  const patientSelect = document.getElementById("patient-select");
  if (patientSelect && window.AuthManager) {
    const isPatient = AuthManager.getRole() === "PATIENT";
    if (isPatient) {
      patientSelect.value = AuthManager.getCurrentPatientId();
      patientSelect.disabled = true;
      patientSelect.title = `Locked to your authenticated trial identity (${AuthManager.getCurrentPatientId()})`;
    } else {
      patientSelect.disabled = false;
    }
  }
}

function setupPatientStudioEventListeners() {
  // Patient Selector
  const patientSelect = document.getElementById("patient-select");
  if (patientSelect) {
    patientSelect.addEventListener("change", (e) => {
      patientAppState.currentPatientId = e.target.value;
      const patient = getClinicalPatient(patientAppState.currentPatientId);
      if (patient && patient.sessions.length > 0) {
        patientAppState.currentSessionId = patient.sessions[0].session_id;
      }
      loadPatientStudioData(patientAppState.currentPatientId);
    });
  }

  // Registration Modal
  const openRegBtn = document.getElementById("btn-open-register-modal");
  if (openRegBtn) {
    openRegBtn.addEventListener("click", openRegisterPatientModal);
  }

  const closeRegBtn = document.getElementById("btn-close-register-modal");
  if (closeRegBtn) {
    closeRegBtn.addEventListener("click", closeRegisterPatientModal);
  }

  const cancelRegBtn = document.getElementById("btn-cancel-register");
  if (cancelRegBtn) {
    cancelRegBtn.addEventListener("click", closeRegisterPatientModal);
  }

  const regForm = document.getElementById("register-patient-form");
  if (regForm) {
    regForm.addEventListener("submit", handleRegisterPatientSubmit);
  }

  // Start New Session Modal Listeners
  const openSessBtn = document.getElementById("btn-open-start-session-modal");
  if (openSessBtn) {
    openSessBtn.addEventListener("click", openStartSessionModal);
  }

  const closeSessBtn = document.getElementById("btn-close-start-session-modal");
  if (closeSessBtn) {
    closeSessBtn.addEventListener("click", closeStartSessionModal);
  }

  const cancelSessBtn = document.getElementById("btn-cancel-start-session");
  if (cancelSessBtn) {
    cancelSessBtn.addEventListener("click", closeStartSessionModal);
  }

  const sessForm = document.getElementById("start-session-form");
  if (sessForm) {
    sessForm.addEventListener("submit", handleStartSessionSubmit);
  }

  // End Active Session Modal Listeners
  const endActiveSessBtn = document.getElementById("btn-end-active-session");
  if (endActiveSessBtn) {
    endActiveSessBtn.addEventListener("click", openEndSessionModal);
  }

  const endBannerBtn = document.getElementById("btn-studio-end-banner");
  if (endBannerBtn) {
    endBannerBtn.addEventListener("click", openEndSessionModal);
  }

  const closeEndSessBtn = document.getElementById("btn-close-end-session-modal");
  if (closeEndSessBtn) {
    closeEndSessBtn.addEventListener("click", closeEndSessionModal);
  }

  // Page Guide / Instructions Button Click Toggle
  const btnPageGuide = document.getElementById("btn-page-guide");
  const navGuidePopover = document.getElementById("nav-guide-popover");
  if (btnPageGuide && navGuidePopover) {
    btnPageGuide.addEventListener("click", (e) => {
      e.stopPropagation();
      navGuidePopover.classList.toggle("active");
      btnPageGuide.classList.toggle("active");
    });
    
    document.addEventListener("click", (e) => {
      if (!navGuidePopover.contains(e.target) && !btnPageGuide.contains(e.target)) {
        navGuidePopover.classList.remove("active");
        btnPageGuide.classList.remove("active");
      }
    });
  }

  // Modal Backdrop Click-to-Dismiss on all backdrops
  document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        closeAllModals();
      }
    });
  });

  // Global Escape key dismisses active modal & guide popovers
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Esc") {
      closeAllModals();
      if (navGuidePopover) navGuidePopover.classList.remove("active");
      if (btnPageGuide) btnPageGuide.classList.remove("active");
    }
  });

  // BLE Disconnect Recovery Banner Listeners
  const btnReconnectAlert = document.getElementById("btn-reconnect-ble-alert");
  if (btnReconnectAlert) {
    btnReconnectAlert.addEventListener("click", () => WebTrackerEngine.connectPolarH9());
  }

  const btnSwitchSimAlert = document.getElementById("btn-switch-sim-ble-alert");
  if (btnSwitchSimAlert) {
    btnSwitchSimAlert.addEventListener("click", () => WebTrackerEngine.startSimulatedBLE());
  }

  // Telemetry Required Prompt Banner Listeners
  const btnPromptConnect = document.getElementById("btn-prompt-connect-ble");
  if (btnPromptConnect) {
    btnPromptConnect.addEventListener("click", () => WebTrackerEngine.connectPolarH9());
  }

  const btnPromptStartSim = document.getElementById("btn-prompt-start-sim");
  if (btnPromptStartSim) {
    btnPromptStartSim.addEventListener("click", () => WebTrackerEngine.startSimulatedBLE());
  }

  // Studio Telemetry Actions
  const btnBleConnect = document.getElementById("btn-studio-ble-connect");
  if (btnBleConnect) {
    btnBleConnect.addEventListener("click", () => WebTrackerEngine.connectPolarH9());
  }

  const btnBleSim = document.getElementById("btn-studio-sim-ble");
  if (btnBleSim) {
    btnBleSim.addEventListener("click", () => WebTrackerEngine.toggleSimulatedBLE());
  }

  const btnFinalizeCalib = document.getElementById("btn-studio-finalize-calib");
  if (btnFinalizeCalib) {
    btnFinalizeCalib.addEventListener("click", () => {
      WebTrackerEngine.finalizeBaselineCalibration();
      savePatientsToStorage();
    });
  }

  const btnTestNod = document.getElementById("btn-studio-test-nod");
  if (btnTestNod) {
    btnTestNod.addEventListener("click", () => {
      WebTrackerEngine.manualSimulateNod();
      setTimeout(savePatientsToStorage, 500);
    });
  }

  // Telemetry Required Modal Listeners
  const btnCloseTelem = document.getElementById("btn-close-telemetry-required-modal");
  if (btnCloseTelem) {
    btnCloseTelem.addEventListener("click", closeTelemetryRequiredModal);
  }

  const btnModalConnBle = document.getElementById("btn-modal-connect-ble");
  if (btnModalConnBle) {
    btnModalConnBle.addEventListener("click", handleTelemetryPromptConnectBle);
  }

  const btnModalStartSim = document.getElementById("btn-modal-start-sim");
  if (btnModalStartSim) {
    btnModalStartSim.addEventListener("click", handleTelemetryPromptStartSim);
  }

  // --- Stress Test Engine Controls (Stroop Conflict Test) ---
  const btnStartStress = document.getElementById("btn-start-stress-test");
  if (btnStartStress) {
    btnStartStress.addEventListener("click", () => {
      StressTestEngine.startTest("STROOP_CONFLICT", 60);
    });
  }

  const btnStopStress = document.getElementById("btn-stop-stress-test");
  if (btnStopStress) {
    btnStopStress.addEventListener("click", () => {
      StressTestEngine.stopTest();
    });
  }

  const btnRestartStress = document.getElementById("btn-restart-stress-test");
  if (btnRestartStress) {
    btnRestartStress.addEventListener("click", () => {
      StressTestEngine.startTest("STROOP_CONFLICT", 60);
    });
  }

  if (window.StressTestEngine) {
    StressTestEngine.init();
  }
}

function loadPatientStudioData(patientId) {
  const patient = getClinicalPatient(patientId);
  if (!patient) return;

  // Profile
  document.getElementById("nav-avatar").textContent = patient.avatar;
  document.getElementById("profile-avatar").textContent = patient.avatar;
  document.getElementById("patient-name-display").textContent = patient.name;
  document.getElementById("patient-diagnosis-display").textContent = patient.diagnosis;
  document.getElementById("patient-demographics-display").textContent = `${patient.age} yrs • ${patient.gender}`;
  document.getElementById("patient-sessions-count-display").textContent = `${patient.sessions.length} Clinical Sessions`;

  // Check if there is an active session
  const activeSession = patient.sessions.find(s => s.status === "ACTIVE");
  const centerInfoEl = document.getElementById("patient-session-center-info");
  const headerLabel = document.getElementById("session-header-label");
  const statusBadge = document.getElementById("session-status-badge");
  const statusDot = document.getElementById("session-status-dot");
  const startBtn = document.getElementById("btn-open-start-session-modal");
  const endBtn = document.getElementById("btn-end-active-session");
  const titleEl = document.getElementById("active-session-title");

  if (activeSession) {
    patientAppState.currentSessionId = activeSession.session_id;
    if (centerInfoEl) centerInfoEl.style.display = "flex";
    
    if (titleEl) {
      titleEl.textContent = activeSession.session_name;
      titleEl.style.color = "#0284c7";
    }
    if (headerLabel) {
      headerLabel.textContent = "Active Recording Session";
    }
    if (statusBadge) {
      statusBadge.style.display = "inline-flex";
      statusBadge.textContent = "Active";
      statusBadge.className = "status-pill status-tp";
      statusBadge.style.background = "#ecfdf5";
      statusBadge.style.color = "#059669";
    }
    if (statusDot) statusDot.style.background = "#0284c7";

    document.getElementById("studio-hud-baseline").textContent = `${activeSession.calibrated_baseline_rmssd} ms`;
    WebTrackerEngine.calibratedBaselineRMSSD = activeSession.calibrated_baseline_rmssd;

    if (startBtn) startBtn.style.display = "none";
    if (endBtn) {
      endBtn.style.display = "flex";
      endBtn.textContent = "End Active Session";
      endBtn.disabled = false;
      endBtn.style.opacity = "1.0";
      endBtn.style.background = "#fff1f2";
      endBtn.style.color = "#e11d48";
      endBtn.style.borderColor = "#fecdd3";
    }
  } else {
    // No Active Session (Standby / Idle / After Ending Session):
    // Do NOT show last recorded session in center — hide center info completely!
    if (centerInfoEl) centerInfoEl.style.display = "none";
    WebTrackerEngine.hasBaselineEstablished = false;

    // Use most recent session for calibrated baseline HUD if available
    const lastSession = patient.sessions[0];
    if (lastSession) {
      patientAppState.currentSessionId = lastSession.session_id;
      document.getElementById("studio-hud-baseline").textContent = `${lastSession.calibrated_baseline_rmssd} ms`;
      WebTrackerEngine.calibratedBaselineRMSSD = lastSession.calibrated_baseline_rmssd;
    }

    if (startBtn) {
      startBtn.style.display = "flex";
      startBtn.disabled = false;
    }
    if (endBtn) {
      endBtn.style.display = "none";
    }
  }

  // Populate Dropdown
  const select = document.getElementById("patient-select");
  if (select) {
    select.innerHTML = "";
    CLINICAL_PATIENTS.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.diagnosis.split(" ")[0]})`;
      if (p.id === patientId) opt.selected = true;
      select.appendChild(opt);
    });
  }
}

function openRegisterPatientModal() {
  const modal = document.getElementById("register-patient-modal-backdrop");
  if (modal) {
    modal.style.display = "flex";
    modal.classList.add("active");
  }
  const nameInput = document.getElementById("new-patient-name");
  if (nameInput) nameInput.focus();
}

function closeRegisterPatientModal() {
  const modal = document.getElementById("register-patient-modal-backdrop");
  if (modal) {
    modal.classList.remove("active");
    modal.style.display = "none";
  }
  const form = document.getElementById("register-patient-form");
  if (form) form.reset();
}

function handleRegisterPatientSubmit(e) {
  e.preventDefault();

  const name = document.getElementById("new-patient-name").value.trim();
  const age = parseInt(document.getElementById("new-patient-age").value, 10);
  const gender = document.getElementById("new-patient-gender").value;
  const diagnosis = document.getElementById("new-patient-diagnosis").value;
  const sessionName = document.getElementById("new-session-name").value.trim() || "Session 1 — Initial Baseline Calibration";

  if (!name) return;

  const newPatientId = `patient_${String(CLINICAL_PATIENTS.length + 1).padStart(3, "0")}`;
  const newSessionId = `sess_${newPatientId.split("_")[1]}_01`;
  const avatarLetter = name.charAt(0).toUpperCase();

  const newPatient = {
    id: newPatientId,
    name: name,
    age: age,
    gender: gender,
    diagnosis: diagnosis,
    avatar: avatarLetter,
    sessions: [
      {
        session_id: newSessionId,
        session_name: sessionName,
        status: "ACTIVE",
        date_str: `${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} • Just Now`,
        calibrated_baseline_rmssd: 45.0,
        calibration_duration_sec: 300,
        notes: "New patient account created. Ready for Polar H9 BLE connection and 5-min resting baseline calibration.",
        oscillations: []
      }
    ]
  };

  CLINICAL_PATIENTS.push(newPatient);
  savePatientsToStorage();

  patientAppState.currentPatientId = newPatient.id;
  patientAppState.currentSessionId = newSessionId;

  loadPatientStudioData(newPatient.id);
  closeRegisterPatientModal();

  // Reset engine and auto-prompt BLE calibration
  WebTrackerEngine.resetForNewSession();
  WebTrackerEngine.connectPolarH9();
}

/**
 * End Active Session Modal
 */
function openEndSessionModal() {
  const patient = getClinicalPatient(patientAppState.currentPatientId);
  if (!patient) return;

  const activeSession = patient.sessions.find(s => s.status === "ACTIVE") || 
                        patient.sessions.find(s => s.session_id === patientAppState.currentSessionId) || 
                        patient.sessions[0];
  if (!activeSession) return;

  // Finalize session status
  activeSession.status = "COMPLETED";
  activeSession.ended_at = new Date().toISOString();
  savePatientsToStorage();

  // Populate summary fields
  const nameEl = document.getElementById("end-session-name-val");
  if (nameEl) nameEl.textContent = activeSession.session_name;

  const baseEl = document.getElementById("end-session-baseline-val");
  if (baseEl) baseEl.textContent = `${activeSession.calibrated_baseline_rmssd} ms`;

  const eventsEl = document.getElementById("end-session-events-val");
  if (eventsEl) eventsEl.textContent = `${activeSession.oscillations ? activeSession.oscillations.length : 0} episodes`;

  const modal = document.getElementById("end-session-modal-backdrop");
  if (modal) {
    modal.style.display = "flex";
    modal.classList.add("active");
  }

  // Inform WebTrackerEngine that session ended -> stops BLE/sim, clears buffers, force hides active banners
  WebTrackerEngine.endSession();
  loadPatientStudioData(patient.id);
}

function closeEndSessionModal() {
  const modal = document.getElementById("end-session-modal-backdrop");
  if (modal) {
    modal.classList.remove("active");
    modal.style.display = "none";
  }
}

/**
 * Telemetry Required Modal Handlers
 */
function openTelemetryRequiredModal() {
  const modal = document.getElementById("telemetry-required-session-modal-backdrop");
  if (modal) {
    modal.style.display = "flex";
    modal.classList.add("active");
  }
}

function closeTelemetryRequiredModal() {
  const modal = document.getElementById("telemetry-required-session-modal-backdrop");
  if (modal) {
    modal.classList.remove("active");
    modal.style.display = "none";
  }
}

function handleTelemetryPromptConnectBle() {
  closeTelemetryRequiredModal();
  if (window.WebTrackerEngine) {
    WebTrackerEngine.connectPolarH9().then(() => {
      openStartSessionModal();
    }).catch(err => {
      console.warn("Polar BLE connect prompt cancelled/failed:", err);
    });
  }
}

function handleTelemetryPromptStartSim() {
  closeTelemetryRequiredModal();
  if (window.WebTrackerEngine) {
    WebTrackerEngine.startSimulatedBLE();
    setTimeout(() => {
      openStartSessionModal();
    }, 250);
  }
}

/**
 * Handler for "Start Next Session" button inside End Session Modal
 */
function handleModalStartNextSession() {
  closeEndSessionModal();
  setTimeout(() => {
    openStartSessionModal();
  }, 100);
}

/**
 * Start New Session Modal for existing patient
 * RULE 1: Cannot start a new session while an active session is currently running!
 * RULE 2: Only allowed when Polar strap is connected or simulation stream is active!
 */
function openStartSessionModal() {
  const patient = getClinicalPatient(patientAppState.currentPatientId);
  if (!patient) return;

  // RULE 1: Block starting a new session if ANY active session is currently open
  const hasActiveSession = patient.sessions.some(s => s.status === "ACTIVE");
  if (hasActiveSession) {
    alert("A recording session is currently in progress. You cannot start a new session without ending the existing active session. Please click 'End Active Session' first.");
    return;
  }

  // RULE 2: Telemetry Required Pre-requisite
  const isTelemetryActive = window.WebTrackerEngine && (WebTrackerEngine.isBleConnected === true || WebTrackerEngine.isSimulator === true);
  if (!isTelemetryActive) {
    openTelemetryRequiredModal();
    return;
  }

  const previewInput = document.getElementById("session-patient-name-preview");
  if (previewInput) {
    previewInput.value = `${patient.name} • ${patient.diagnosis} (${patient.age} yrs, ${patient.gender})`;
  }

  const nextNum = patient.sessions.length + 1;
  const nameInput = document.getElementById("new-recording-session-name");
  if (nameInput) {
    nameInput.value = `Session ${nextNum} — Home Telemetry Recording`;
  }

  const modal = document.getElementById("start-session-modal-backdrop");
  if (modal) {
    modal.style.display = "flex";
    modal.classList.add("active");
  }
  if (nameInput) {
    setTimeout(() => nameInput.focus(), 80);
  }
}

function closeStartSessionModal() {
  const modal = document.getElementById("start-session-modal-backdrop");
  if (modal) {
    modal.classList.remove("active");
    modal.style.display = "none";
  }
  const form = document.getElementById("start-session-form");
  if (form) form.reset();
}

function handleStartSessionSubmit(e) {
  e.preventDefault();

  const patient = getClinicalPatient(patientAppState.currentPatientId);
  if (!patient) return;

  const nameInput = document.getElementById("new-recording-session-name");
  const sessionName = nameInput ? nameInput.value.trim() : "";
  if (!sessionName) return;

  // Ensure all previous sessions are finalized
  patient.sessions.forEach(s => {
    s.status = "COMPLETED";
  });

  const nextNum = patient.sessions.length + 1;
  const patientSuffix = patient.id.replace("patient_", "");
  const newSessionId = `sess_${patientSuffix}_${String(nextNum).padStart(2, "0")}`;

  const newSession = {
    session_id: newSessionId,
    session_name: sessionName,
    status: "ACTIVE",
    date_str: `${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} • Just Now`,
    calibrated_baseline_rmssd: 44.0,
    calibration_duration_sec: 300,
    notes: `New session started by patient on ${new Date().toLocaleDateString()}. Initial 5-minute quiet resting baseline calibration active.`,
    oscillations: []
  };

  patient.sessions.unshift(newSession); // New active session placed first
  savePatientsToStorage();

  patientAppState.currentSessionId = newSessionId;
  closeStartSessionModal();
  loadPatientStudioData(patient.id);

  // Reset engine and start fresh 5-min resting calibration for this new session
  WebTrackerEngine.resetForNewSession();
}

/**
 * Close all modal backdrops helper
 */
function closeAllModals() {
  closeEndSessionModal();
  closeStartSessionModal();
  closeRegisterPatientModal();
  closeTelemetryRequiredModal();
  if (window.AuthManager && window.AuthManager.closeAuthModal) {
    window.AuthManager.closeAuthModal();
  }
}

// Global Window Exports for 100% fail-safe click handlers
window.openTelemetryRequiredModal = openTelemetryRequiredModal;
window.closeTelemetryRequiredModal = closeTelemetryRequiredModal;
window.handleTelemetryPromptConnectBle = handleTelemetryPromptConnectBle;
window.handleTelemetryPromptStartSim = handleTelemetryPromptStartSim;
window.openStartSessionModal = openStartSessionModal;
window.closeStartSessionModal = closeStartSessionModal;
window.openEndSessionModal = openEndSessionModal;
window.closeEndSessionModal = closeEndSessionModal;
window.handleModalStartNextSession = handleModalStartNextSession;
window.openRegisterPatientModal = openRegisterPatientModal;
window.closeRegisterPatientModal = closeRegisterPatientModal;
window.closeAllModals = closeAllModals;


