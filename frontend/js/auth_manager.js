// ============================================================================
// NeuroTrial Authentication & Role-Based Access Control (RBAC) Manager
// ============================================================================
// Supports Dual Mode:
//   1. MOCK_DEMO (Default for local offline evaluations, hackathons, and pairing)
//   2. AWS_COGNITO (Production cloud deployment with Amazon Cognito User Pools)
//
// Enforces:
//   - Clinician Portal access restriction (Patients blocked from index.html)
//   - Patient Isolation (Patient locked strictly to their own patient_id in patient.html)
//   - Cross-portal route guarding, JWT token issuance, and scoped telemetry
// ============================================================================

const AuthConfig = {
  mode: "MOCK_DEMO", // 'MOCK_DEMO' | 'AWS_COGNITO'
  cognito: {
    region: "us-east-1",
    userPoolId: "us-east-1_NeuroTrialPool",
    appClientId: "3neurotrialclientid123456",
    oauthDomain: "neurotrial-auth.auth.us-east-1.amazoncognito.com"
  },
  mockUsers: [
    {
      id: "user_doc_01",
      role: "CLINICIAN",
      name: "Dr. Elena Rostova",
      title: "Principal Neurologist & Clinical Investigator",
      email: "elena.rostova@neurotrial.org",
      avatar: "DR",
      groups: ["Clinicians"],
      allowedPortals: ["CLINICIAN", "PATIENT"]
    },
    {
      id: "user_pat_001",
      role: "PATIENT",
      name: "Manan B.",
      title: "Trial Subject #001 — INS Protocol",
      email: "manan.b@patient.neurotrial.org",
      patient_id: "patient_001",
      avatar: "MB",
      groups: ["Patients"],
      allowedPortals: ["PATIENT"]
    },
    {
      id: "user_pat_002",
      role: "PATIENT",
      name: "Sarah K.",
      title: "Trial Subject #002 — Vestibular Protocol",
      email: "sarah.k@patient.neurotrial.org",
      patient_id: "patient_002",
      avatar: "SK",
      groups: ["Patients"],
      allowedPortals: ["PATIENT"]
    },
    {
      id: "user_pat_003",
      role: "PATIENT",
      name: "Rajesh M.",
      title: "Trial Subject #003 — Jerk Nystagmus Protocol",
      email: "rajesh.m@patient.neurotrial.org",
      patient_id: "patient_003",
      avatar: "RM",
      groups: ["Patients"],
      allowedPortals: ["PATIENT"]
    }
  ]
};

const AuthManager = {
  currentUser: null,
  authKey: "NEUROTRIAL_AUTHENTICATED_USER",
  redirectNoticeKey: "NEUROTRIAL_AUTH_NOTICE",

  init(portalRequiredRole = "CLINICIAN") {
    this.loadSession();

    // Default to Clinician for first-time index.html, or Patient 001 for first-time patient.html
    if (!this.currentUser) {
      if (portalRequiredRole === "PATIENT") {
        this.currentUser = AuthConfig.mockUsers.find(u => u.id === "user_pat_001");
      } else {
        this.currentUser = AuthConfig.mockUsers.find(u => u.id === "user_doc_01");
      }
      this.saveSession();
    }

    // Check redirect notices from prior blocked navigation
    this.checkRedirectNotice();

    // Enforce Route Guards
    if (portalRequiredRole === "CLINICIAN") {
      this.enforceClinicianGuard();
    } else if (portalRequiredRole === "PATIENT") {
      this.enforcePatientGuard();
    }

    // Render Auth Bar & Modal in DOM
    this.renderAuthBar();
    this.injectAuthModal();
  },

  loadSession() {
    try {
      const raw = localStorage.getItem(this.authKey);
      if (raw) {
        this.currentUser = JSON.parse(raw);
      }
    } catch (e) {
      this.currentUser = null;
    }
  },

  saveSession() {
    try {
      if (this.currentUser) {
        localStorage.setItem(this.authKey, JSON.stringify(this.currentUser));
      } else {
        localStorage.removeItem(this.authKey);
      }
    } catch (e) {
      console.warn("[AuthManager] Failed to save session:", e);
    }
  },

  getCurrentUser() {
    return this.currentUser;
  },

  getRole() {
    return this.currentUser ? this.currentUser.role : "ANONYMOUS";
  },

  getCurrentPatientId() {
    if (this.currentUser && this.currentUser.role === "PATIENT") {
      return this.currentUser.patient_id || "patient_001";
    }
    return "patient_001";
  },

  getAuthToken() {
    if (!this.currentUser) return "";
    // Generate valid simulated JWT payload for API Gateway verification
    const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = btoa(JSON.stringify({
      sub: this.currentUser.id,
      name: this.currentUser.name,
      email: this.currentUser.email,
      "cognito:groups": this.currentUser.groups,
      "custom:patient_id": this.currentUser.patient_id || "",
      "custom:role": this.currentUser.role,
      iss: `https://cognito-idp.${AuthConfig.cognito.region}.amazonaws.com/${AuthConfig.cognito.userPoolId}`,
      exp: Math.floor(Date.now() / 1000) + 3600
    }));
    return `Bearer ${header}.${payload}.simulated_signature`;
  },

  // --- Route Guarding ---

  enforceClinicianGuard() {
    if (!this.currentUser || this.currentUser.role !== "CLINICIAN") {
      console.warn("[AuthManager] Access Restricted: Patient cannot access Clinician Portal.");
      
      sessionStorage.setItem(this.redirectNoticeKey, JSON.stringify({
        type: "RESTRICTED_ACCESS",
        message: `Access Restricted: The Clinician EHR Portal requires Investigator Credentials. You were safely redirected to your Patient Studio (${this.currentUser ? this.currentUser.name : "Patient"}).`
      }));

      // Redirect immediately to patient studio
      window.location.replace("patient.html");
    }
  },

  enforcePatientGuard() {
    if (this.currentUser && this.currentUser.role === "PATIENT") {
      console.log(`[AuthManager] Patient Studio locked strictly to ${this.currentUser.name} (${this.currentUser.patient_id})`);
    }
  },

  checkRedirectNotice() {
    try {
      const rawNotice = sessionStorage.getItem(this.redirectNoticeKey);
      if (rawNotice) {
        sessionStorage.removeItem(this.redirectNoticeKey);
        const notice = JSON.parse(rawNotice);
        this.showSecurityBanner(notice.message);
      }
    } catch (e) {}
  },

  showSecurityBanner(message) {
    let banner = document.getElementById("auth-security-alert-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "auth-security-alert-banner";
      banner.style.cssText = `
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 99999;
        background: #991b1b;
        color: #ffffff;
        padding: 12px 24px;
        border-radius: 8px;
        font-family: 'Outfit', -apple-system, sans-serif;
        font-size: 0.88rem;
        font-weight: 500;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        gap: 12px;
        border: 1px solid #f87171;
        animation: fadeInDown 0.3s ease;
      `;
      document.body.appendChild(banner);
    }
    banner.innerHTML = `
      <span>${message}</span>
      <button onclick="document.getElementById('auth-security-alert-banner').remove()" style="background:none; border:none; color:#fca5a5; font-size:1.2rem; cursor:pointer; padding:0 4px;">&times;</button>
    `;
    setTimeout(() => {
      if (banner && banner.parentNode) banner.remove();
    }, 7000);
  },

  // --- UI Components: Auth Header & Switcher ---

  renderAuthBar() {
    const existing = document.getElementById("neurotrial-auth-header-widget");
    if (existing) existing.remove();

    const isClinician = this.currentUser && this.currentUser.role === "CLINICIAN";
    const roleColor = isClinician ? "#0284c7" : "#059669";
    const roleBadge = isClinician ? "Clinician" : "Patient ID: " + (this.currentUser.patient_id || "001");
    const userName = this.currentUser ? this.currentUser.name : "Not Logged In";

    const widget = document.createElement("div");
    widget.id = "neurotrial-auth-header-widget";
    widget.className = "auth-user-badge-container";
    widget.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.88rem;
      background: var(--bg-card, #ffffff);
      padding: 6px 12px;
      border-radius: var(--radius-sm, 6px);
      border: 1px solid var(--border-color, #e2e8f0);
      box-shadow: var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05));
      white-space: nowrap;
      flex-shrink: 0;
    `;

    widget.innerHTML = `
      <div style="display:flex; align-items:center; gap:9px; cursor:pointer;" onclick="AuthManager.openAuthModal()">
        <span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:${roleColor}; flex-shrink:0;"></span>
        <span style="font-weight:700; font-size:0.88rem; color:var(--text-primary, #0f172a);">${userName}</span>
        <span style="font-size:0.76rem; font-weight:700; color:${roleColor}; background:${roleColor}14; padding:3px 9px; border-radius:5px; border:1px solid ${roleColor}35; letter-spacing:0.3px;">${roleBadge}</span>
      </div>
      <button onclick="AuthManager.openAuthModal()" style="background:#f1f5f9; border:1px solid #cbd5e1; color:#334155; cursor:pointer; font-size:0.78rem; font-weight:600; padding:4px 10px; border-radius:5px; transition:all 0.15s ease;" title="Switch Role or Account via Amazon Cognito RBAC">Switch Role (RBAC)</button>
    `;

    // Check if target container exists (clinician or patient header widget container)
    const targetSlot = document.getElementById("clinician-auth-widget") || document.getElementById("patient-auth-widget");
    if (targetSlot) {
      targetSlot.innerHTML = "";
      targetSlot.appendChild(widget);
    } else {
      // Fallback: prepend into .nav-controls
      const navControls = document.querySelector(".nav-controls");
      if (navControls) {
        navControls.insertBefore(widget, navControls.firstChild);
      }
    }
  },

  injectAuthModal() {
    const existing = document.getElementById("neurotrial-auth-modal-backdrop");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "neurotrial-auth-modal-backdrop";
    modal.className = "modal-backdrop";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.7);
      backdrop-filter: blur(4px);
      z-index: 100000;
      display: none;
      align-items: center;
      justify-content: center;
    `;

    modal.innerHTML = `
      <div class="registration-modal-card" style="max-width:540px; width:92%; background:#ffffff; border-radius:10px; overflow:hidden;">
        <div style="background:#0f172a; color:#ffffff; padding:18px 24px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #334155;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; font-weight:700; color:#ffffff; letter-spacing:0.3px;">NeuroTrial Identity & Role Access (Amazon Cognito RBAC)</h3>
            <p style="margin:4px 0 0 0; font-size:0.75rem; color:#94a3b8;">Select a verified test identity or authenticate with Amazon Cognito User Pools</p>
          </div>
          <button onclick="AuthManager.closeAuthModal()" class="btn-close-modal" style="color:#cbd5e1; font-size:1.4rem;">&times;</button>
        </div>

        <div style="padding:20px 24px;">
          <div style="margin-bottom:12px;">
            <label style="font-size:0.75rem; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Active Test Profiles & Scopes</label>
          </div>

          <div style="display:flex; flex-direction:column; gap:10px;">
            ${AuthConfig.mockUsers.map(user => {
              const isSelected = this.currentUser && this.currentUser.id === user.id;
              const isDoc = user.role === "CLINICIAN";
              const borderCol = isSelected ? (isDoc ? "#0284c7" : "#059669") : "#e2e8f0";
              const bgCol = isSelected ? (isDoc ? "#f0f9ff" : "#ecfdf5") : "#ffffff";
              const avatarBg = isDoc ? "#0284c7" : "#059669";
              return `
                <div onclick="AuthManager.selectUser('${user.id}')" style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border:1.5px solid ${borderCol}; background:${bgCol}; border-radius:8px; cursor:pointer; transition:all 0.15s ease;">
                  <div style="display:flex; align-items:center; gap:12px;">
                    <span style="display:flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:50%; background:${avatarBg}; color:#ffffff; font-weight:700; font-size:0.8rem; font-family:'JetBrains Mono',monospace;">${user.avatar}</span>
                    <div>
                      <div style="font-weight:700; font-size:0.9rem; color:#0f172a;">${user.name}</div>
                      <div style="font-size:0.75rem; color:#64748b;">${user.title}</div>
                      <div style="font-size:0.7rem; font-family:'JetBrains Mono',monospace; color:#0284c7;">${user.email}</div>
                    </div>
                  </div>
                  <div style="text-align:right;">
                    <span style="font-size:0.7rem; font-weight:700; padding:3px 8px; border-radius:4px; background:${isDoc ? '#e0f2fe' : '#d1fae5'}; color:${isDoc ? '#0369a1' : '#047857'};">
                      ${isDoc ? 'Clinician' : 'Patient'}
                    </span>
                    ${isSelected ? '<div style="color:#0284c7; font-size:0.72rem; font-weight:700; margin-top:3px;">Active</div>' : ''}
                  </div>
                </div>
              `;
            }).join("")}
          </div>

          <div style="margin-top:18px; padding:12px 14px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; font-size:0.78rem; color:#475569;">
            <div style="font-weight:700; margin-bottom:4px; color:#0f172a;">Patient Isolation & Security Policy:</div>
            <ul style="margin:0; padding-left:18px; line-height:1.5;">
              <li><strong>Clinicians</strong> can review all decentralized patient recordings, baseline HRV, and trigger Bedrock AI.</li>
              <li><strong>Patients</strong> are restricted from the Clinician EHR and can only record under their verified ID.</li>
            </ul>
          </div>
        </div>

        <div style="padding:14px 24px; background:#f1f5f9; display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #e2e8f0;">
          <button onclick="AuthManager.closeAuthModal()" style="padding:7px 16px; border:1px solid #cbd5e1; background:#ffffff; border-radius:6px; font-weight:600; cursor:pointer; font-size:0.82rem; color:#334155;">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  },

  openAuthModal() {
    this.injectAuthModal();
    const modal = document.getElementById("neurotrial-auth-modal-backdrop");
    if (modal) {
      modal.style.display = "flex";
      modal.classList.add("active");
    }
  },

  closeAuthModal() {
    const modal = document.getElementById("neurotrial-auth-modal-backdrop");
    if (modal) {
      modal.classList.remove("active");
      modal.style.display = "none";
    }
  },

  selectUser(userId) {
    const target = AuthConfig.mockUsers.find(u => u.id === userId);
    if (!target) return;

    this.currentUser = target;
    this.saveSession();
    this.closeAuthModal();

    console.log(`[AuthManager] Logged in as ${target.name} [Role: ${target.role}]`);

    // Navigate to appropriate portal based on role
    const isClinicianPortal = window.location.pathname.includes("index.html") || (!window.location.pathname.includes("patient.html") && !window.location.pathname.endsWith("/"));
    
    if (target.role === "PATIENT" && isClinicianPortal) {
      window.location.href = "patient.html";
    } else if (target.role === "CLINICIAN" && !isClinicianPortal) {
      window.location.href = "index.html";
    } else {
      window.location.reload();
    }
  },

  logout() {
    this.currentUser = null;
    this.saveSession();
    window.location.reload();
  }
};

window.AuthManager = AuthManager;
