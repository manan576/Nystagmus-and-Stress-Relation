// ============================================================================
// NeuroStress Clinical Telemetry — Multi-Patient & Session Data Store
// ============================================================================

const INITIAL_PATIENTS_DATA = [
  {
    id: "patient_001",
    name: "Manan B.",
    age: 22,
    gender: "Male",
    diagnosis: "Infantile Nystagmus Syndrome (INS)",
    avatar: "M",
    sessions: [
      {
        session_id: "sess_001_01",
        session_name: "Session 1 — Baseline & Workday Stress",
        status: "COMPLETED",
        date_str: "Sept 8, 2026 • 10:00 AM",
        calibrated_baseline_rmssd: 44.5,
        calibration_duration_sec: 300,
        notes: "Subject completed 5-min quiet calibration. Resting baseline established at 44.5 ms.",
        oscillations: [
          {
            event_id: "evt_p1_s1_01",
            timestamp: "10:14:22",
            full_timestamp: "2026-09-08 10:14:22",
            duration_sec: 10.0,
            incident_rmssd: 18.2,
            stress_drop_pct: 59.1,
            bpm: 91.4,
            video_filename: "nod_20260908_101422.mp4",
            video_url: "validation_videos/nod_20260902_214353.mp4",
            verification_status: "VERIFIED_TRUE_POSITIVE",
            doctor_notes: "Confirmed horizontal nystagmus nod on video review."
          },
          {
            event_id: "evt_p1_s1_02",
            timestamp: "10:28:45",
            full_timestamp: "2026-09-08 10:28:45",
            duration_sec: 10.0,
            incident_rmssd: 16.8,
            stress_drop_pct: 62.2,
            bpm: 94.0,
            video_filename: "nod_20260908_102845.mp4",
            video_url: "validation_videos/nod_20260902_214442.mp4",
            verification_status: "VERIFIED_TRUE_POSITIVE",
            doctor_notes: "Acute stress peak during multitasking task."
          },
          {
            event_id: "evt_p1_s1_03",
            timestamp: "10:45:10",
            full_timestamp: "2026-09-08 10:45:10",
            duration_sec: 10.0,
            incident_rmssd: 41.2,
            stress_drop_pct: 7.4,
            bpm: 78.5,
            video_filename: "nod_20260908_104510.mp4",
            video_url: "validation_videos/nod_20260807_121518.mp4",
            verification_status: "DISMISSED_FALSE_POSITIVE",
            doctor_notes: "Subject adjusted laptop screen. Voluntary head movement."
          },
          {
            event_id: "evt_p1_s1_04",
            timestamp: "11:02:30",
            full_timestamp: "2026-09-08 11:02:30",
            duration_sec: 10.0,
            incident_rmssd: 19.4,
            stress_drop_pct: 56.4,
            bpm: 89.2,
            video_filename: "nod_20260908_110230.mp4",
            video_url: "validation_videos/nod_20260902_214353.mp4",
            verification_status: "PENDING_REVIEW",
            doctor_notes: ""
          },
          {
            event_id: "evt_p1_s1_05",
            timestamp: "11:21:18",
            full_timestamp: "2026-09-08 11:21:18",
            duration_sec: 10.0,
            incident_rmssd: 15.6,
            stress_drop_pct: 64.9,
            bpm: 96.5,
            video_filename: "nod_20260908_112118.mp4",
            video_url: "validation_videos/nod_20260902_214442.mp4",
            verification_status: "VERIFIED_TRUE_POSITIVE",
            doctor_notes: "Pronounced cervical tremor with sharp vagal withdrawal."
          },
          {
            event_id: "evt_p1_s1_06",
            timestamp: "11:38:04",
            full_timestamp: "2026-09-08 11:38:04",
            duration_sec: 10.0,
            incident_rmssd: 20.1,
            stress_drop_pct: 54.8,
            bpm: 87.0,
            video_filename: "nod_20260908_113804.mp4",
            video_url: "validation_videos/nod_20260807_121518.mp4",
            verification_status: "PENDING_REVIEW",
            doctor_notes: ""
          }
        ]
      },
      {
        session_id: "sess_001_02",
        session_name: "Session 2 — Afternoon Cognitive Fatigue",
        status: "COMPLETED",
        date_str: "Sept 9, 2026 • 2:30 PM",
        calibrated_baseline_rmssd: 41.8,
        calibration_duration_sec: 300,
        notes: "Post-lunch afternoon recording session. Calibrated baseline: 41.8 ms.",
        oscillations: [
          {
            event_id: "evt_p1_s2_01",
            timestamp: "14:42:15",
            full_timestamp: "2026-09-09 14:42:15",
            duration_sec: 10.0,
            incident_rmssd: 16.2,
            stress_drop_pct: 61.2,
            bpm: 93.1,
            video_filename: "nod_20260909_144215.mp4",
            video_url: "validation_videos/nod_20260902_214353.mp4",
            verification_status: "VERIFIED_TRUE_POSITIVE",
            doctor_notes: "Afternoon fatigue flare-up."
          },
          {
            event_id: "evt_p1_s2_02",
            timestamp: "15:05:40",
            full_timestamp: "2026-09-09 15:05:40",
            duration_sec: 10.0,
            incident_rmssd: 14.8,
            stress_drop_pct: 64.6,
            bpm: 97.4,
            video_filename: "nod_20260909_150540.mp4",
            video_url: "validation_videos/nod_20260902_214442.mp4",
            verification_status: "VERIFIED_TRUE_POSITIVE",
            doctor_notes: "High tremor sustained >2s."
          },
          {
            event_id: "evt_p1_s2_03",
            timestamp: "15:22:11",
            full_timestamp: "2026-09-09 15:22:11",
            duration_sec: 10.0,
            incident_rmssd: 18.0,
            stress_drop_pct: 56.9,
            bpm: 88.6,
            video_filename: "nod_20260909_152211.mp4",
            video_url: "validation_videos/nod_20260807_121518.mp4",
            verification_status: "PENDING_REVIEW",
            doctor_notes: ""
          },
          {
            event_id: "evt_p1_s2_04",
            timestamp: "15:40:02",
            full_timestamp: "2026-09-09 15:40:02",
            duration_sec: 10.0,
            incident_rmssd: 39.5,
            stress_drop_pct: 5.5,
            bpm: 76.0,
            video_filename: "nod_20260909_154002.mp4",
            video_url: "validation_videos/nod_20260902_214353.mp4",
            verification_status: "DISMISSED_FALSE_POSITIVE",
            doctor_notes: "Drinking water artifact."
          }
        ]
      },
      {
        session_id: "sess_001_03",
        session_name: "Session 3 — Visual Display Strain",
        status: "COMPLETED",
        date_str: "Sept 10, 2026 • 4:00 PM",
        calibrated_baseline_rmssd: 43.6,
        calibration_duration_sec: 300,
        notes: "Prolonged screen exposure testing. Calibrated baseline: 43.6 ms.",
        oscillations: [
          {
            event_id: "evt_p1_s3_01",
            timestamp: "16:15:30",
            full_timestamp: "2026-09-10 16:15:30",
            duration_sec: 10.0,
            incident_rmssd: 17.5,
            stress_drop_pct: 59.9,
            bpm: 92.0,
            video_filename: "nod_20260910_161530.mp4",
            video_url: "validation_videos/nod_20260902_214353.mp4",
            verification_status: "VERIFIED_TRUE_POSITIVE",
            doctor_notes: "Verified nystagmus nod."
          },
          {
            event_id: "evt_p1_s3_02",
            timestamp: "16:35:12",
            full_timestamp: "2026-09-10 16:35:12",
            duration_sec: 10.0,
            incident_rmssd: 15.2,
            stress_drop_pct: 65.1,
            bpm: 95.8,
            video_filename: "nod_20260910_163512.mp4",
            video_url: "validation_videos/nod_20260902_214442.mp4",
            verification_status: "PENDING_REVIEW",
            doctor_notes: ""
          }
        ]
      }
    ]
  },
  {
    id: "patient_002",
    name: "Sarah K.",
    age: 38,
    gender: "Female",
    diagnosis: "Acquired Oscillopsia (Vestibular)",
    avatar: "S",
    sessions: [
      {
        session_id: "sess_002_01",
        session_name: "Session 1 — Morning Diagnostic Trial",
        status: "COMPLETED",
        date_str: "Sept 7, 2026 • 9:30 AM",
        calibrated_baseline_rmssd: 52.4,
        calibration_duration_sec: 300,
        notes: "Calibrated resting baseline: 52.4 ms.",
        oscillations: [
          {
            event_id: "evt_p2_s1_01",
            timestamp: "09:48:10",
            full_timestamp: "2026-09-07 09:48:10",
            duration_sec: 10.0,
            incident_rmssd: 22.1,
            stress_drop_pct: 57.8,
            bpm: 86.4,
            video_filename: "nod_20260907_094810.mp4",
            video_url: "validation_videos/nod_20260807_121518.mp4",
            verification_status: "VERIFIED_TRUE_POSITIVE",
            doctor_notes: "Confirmed oscillatory tremor."
          },
          {
            event_id: "evt_p2_s1_02",
            timestamp: "10:12:44",
            full_timestamp: "2026-09-07 10:12:44",
            duration_sec: 10.0,
            incident_rmssd: 20.8,
            stress_drop_pct: 60.3,
            bpm: 89.0,
            video_filename: "nod_20260907_101244.mp4",
            video_url: "validation_videos/nod_20260902_214353.mp4",
            verification_status: "PENDING_REVIEW",
            doctor_notes: ""
          },
          {
            event_id: "evt_p2_s1_03",
            timestamp: "10:30:19",
            full_timestamp: "2026-09-07 10:30:19",
            duration_sec: 10.0,
            incident_rmssd: 49.0,
            stress_drop_pct: 6.5,
            bpm: 74.2,
            video_filename: "nod_20260907_103019.mp4",
            video_url: "validation_videos/nod_20260807_121518.mp4",
            verification_status: "DISMISSED_FALSE_POSITIVE",
            doctor_notes: "Yawning motion."
          }
        ]
      }
    ]
  },
  {
    id: "patient_003",
    name: "Rajesh M.",
    age: 16,
    gender: "Male",
    diagnosis: "Pediatric Jerk Nystagmus",
    avatar: "R",
    sessions: [
      {
        session_id: "sess_003_01",
        session_name: "Session 1 — Exam Study Environment",
        status: "COMPLETED",
        date_str: "Sept 6, 2026 • 5:00 PM",
        calibrated_baseline_rmssd: 38.6,
        calibration_duration_sec: 300,
        notes: "Calibrated resting baseline: 38.6 ms.",
        oscillations: [
          {
            event_id: "evt_p3_s1_01",
            timestamp: "17:18:22",
            full_timestamp: "2026-09-06 17:18:22",
            duration_sec: 10.0,
            incident_rmssd: 15.0,
            stress_drop_pct: 61.1,
            bpm: 98.2,
            video_filename: "nod_20260906_171822.mp4",
            video_url: "validation_videos/nod_20260902_214442.mp4",
            verification_status: "VERIFIED_TRUE_POSITIVE",
            doctor_notes: "High jerk oscillation during timed test."
          },
          {
            event_id: "evt_p3_s1_02",
            timestamp: "17:40:05",
            full_timestamp: "2026-09-06 17:40:05",
            duration_sec: 10.0,
            incident_rmssd: 16.4,
            stress_drop_pct: 57.5,
            bpm: 94.6,
            video_filename: "nod_20260906_174005.mp4",
            video_url: "validation_videos/nod_20260902_214353.mp4",
            verification_status: "PENDING_REVIEW",
            doctor_notes: ""
          }
        ]
      }
    ]
  }
];

// Available real validation video clips for fallbacks and rotation
const REAL_VALIDATION_VIDEOS = [
  "validation_videos/nod_20260902_214353.mp4",
  "validation_videos/nod_20260902_214442.mp4",
  "validation_videos/nod_20260807_121518.mp4"
];

// ============================================================================
// IndexedDB Video Blob Storage for Live Web Recordings
// ============================================================================
const RecordingStorage = {
  dbPromise: null,
  getDB() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open("NeuroStressRecordingsDB", 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains("recordings")) {
            db.createObjectStore("recordings", { keyPath: "eventId" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  },

  async saveVideoBlob(eventId, blob) {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("recordings", "readwrite");
        const store = tx.objectStore("recordings");
        store.put({ eventId, blob, createdAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn("[RecordingStorage] save error:", e);
      return false;
    }
  },

  async getVideoBlob(eventId) {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("recordings", "readonly");
        const store = tx.objectStore("recordings");
        const req = store.get(eventId);
        req.onsuccess = () => {
          if (req.result && req.result.blob) {
            resolve(req.result.blob);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn("[RecordingStorage] get error:", e);
      return null;
    }
  }
};

window.RecordingStorage = RecordingStorage;
window.REAL_VALIDATION_VIDEOS = REAL_VALIDATION_VIDEOS;

// Load from localStorage or use default
let CLINICAL_PATIENTS = [];

function loadPatientsFromStorage() {
  try {
    const raw = localStorage.getItem("NEUROSTRESS_PATIENTS_DATA");
    if (raw) {
      CLINICAL_PATIENTS = JSON.parse(raw);
      // Ensure all episodes have valid real video URLs & sessions have explicit status
      let videoIdx = 0;
      CLINICAL_PATIENTS.forEach(patient => {
        if (patient.sessions) {
          patient.sessions.forEach(sess => {
            if (!sess.status) {
              sess.status = "COMPLETED";
            }
            if (sess.oscillations) {
              sess.oscillations.forEach(osc => {
                if (!osc.video_url || osc.video_url.includes("commondatastorage")) {
                  osc.video_url = REAL_VALIDATION_VIDEOS[videoIdx % REAL_VALIDATION_VIDEOS.length];
                  videoIdx++;
                }
              });
            }
          });
        }
      });
      savePatientsToStorage();
    } else {
      CLINICAL_PATIENTS = JSON.parse(JSON.stringify(INITIAL_PATIENTS_DATA));
      savePatientsToStorage();
    }
  } catch (err) {
    CLINICAL_PATIENTS = JSON.parse(JSON.stringify(INITIAL_PATIENTS_DATA));
  }
}

function savePatientsToStorage() {
  try {
    localStorage.setItem("NEUROSTRESS_PATIENTS_DATA", JSON.stringify(CLINICAL_PATIENTS));
  } catch (err) {
    console.warn("Could not save to localStorage:", err);
  }
}

// Helper to access patient data
function getClinicalPatient(patientId = "patient_001") {
  return CLINICAL_PATIENTS.find(p => p.id === patientId) || CLINICAL_PATIENTS[0];
}

// Flat list helper for queries
function getAllOscillationsForPatient(patientId = "patient_001") {
  const patient = getClinicalPatient(patientId);
  if (!patient) return [];
  const list = [];
  patient.sessions.forEach(sess => {
    sess.oscillations.forEach(osc => {
      list.push({
        ...osc,
        patient_id: patient.id,
        session_id: sess.session_id,
        session_name: sess.session_name,
        session_baseline_rmssd: sess.calibrated_baseline_rmssd,
        baseline_rmssd: sess.calibrated_baseline_rmssd
      });
    });
  });
  return list;
}

window.CLINICAL_PATIENTS = CLINICAL_PATIENTS;
window.savePatientsToStorage = savePatientsToStorage;
window.loadPatientsFromStorage = loadPatientsFromStorage;
loadPatientsFromStorage();

