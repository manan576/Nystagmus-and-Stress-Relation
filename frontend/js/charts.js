/**
 * Charts Engine: Medical Light Mode Chart.js visualizer for Session Baseline vs. Verified True Positive (TP) RMSSD.
 */

let sessionChartInstance = null;

const ChartService = {
  /**
   * Renders the clean Session Baseline vs Verified True Positive (TP) RMSSD graph for a specific session.
   * Rules:
   *  1. Plots the session's calibrated resting baseline RMSSD as a steady baseline reference.
   *  2. ONLY plots Verified True Positive (TP) oscillation RMSSDs across the timeline.
   *  3. Pending validation events and False Positives (FP) are strictly EXCLUDED from the graph.
   *  4. No frequency bars, single clean RMSSD (ms) physiological axis.
   * 
   * @param {string} canvasId 
   * @param {Object} sessionObj 
   */
  renderSessionChart(canvasId, sessionObj) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !sessionObj) return;

    const baselineVal = Number(sessionObj.calibrated_baseline_rmssd || 44.5);
    
    // STRICT RULE: Only include Verified True Positive (TP) oscillations
    const tpOscillations = (sessionObj.oscillations || []).filter(
      osc => osc.verification_status === "VERIFIED_TRUE_POSITIVE"
    );

    // Build timeline labels
    const labels = ["00:00 (Calib Baseline)", ...tpOscillations.map(o => o.timestamp || "Event")];
    
    // Dataset 1: Session Baseline Reference Line
    const baselineData = new Array(labels.length).fill(baselineVal);

    // Dataset 2: Verified TP Oscillation RMSSD points
    // First point is the baseline itself at t=0, followed by verified oscillation RMSSDs
    const incidentData = [
      baselineVal, 
      ...tpOscillations.map(o => (typeof o.incident_rmssd === "number" && !isNaN(o.incident_rmssd)) ? o.incident_rmssd : null)
    ];

    // Point colors and styles
    const pointBgColors = [
      "#059669", // Baseline anchor point (Green)
      ...tpOscillations.map(() => "#e11d48") // Verified TP (Rose Red)
    ];

    const pointBorderColors = [
      "#059669",
      ...tpOscillations.map(() => "#be123c")
    ];

    const pointRadii = [
      4,
      ...tpOscillations.map(() => 6)
    ];

    if (sessionChartInstance) {
      sessionChartInstance.destroy();
    }

    sessionChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: `Session Resting Baseline (${baselineVal} ms)`,
            data: baselineData,
            borderColor: "#059669",
            backgroundColor: "rgba(5, 150, 105, 0.05)",
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
            tension: 0
          },
          {
            label: "Verified TP Oscillation RMSSD (During Nod)",
            data: incidentData,
            borderColor: "#e11d48",
            backgroundColor: "rgba(225, 29, 72, 0.06)",
            borderWidth: 2.5,
            tension: 0.25,
            fill: true,
            pointRadius: pointRadii,
            pointHoverRadius: 8,
            pointBackgroundColor: pointBgColors,
            pointBorderColor: pointBorderColors,
            pointBorderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            titleColor: "#ffffff",
            bodyColor: "#f1f5f9",
            borderColor: "#e2e8f0",
            borderWidth: 1,
            padding: 12,
            boxPadding: 6,
            usePointStyle: true,
            callbacks: {
              afterBody: (context) => {
                const idx = context[0].dataIndex;
                if (idx === 0) {
                  return `\nType: Initial 5-min Resting Baseline\nState: Calm / Relaxed Baseline`;
                }
                const osc = tpOscillations[idx - 1];
                if (!osc) return "";
                const drop = osc.stress_drop_pct ? `-${osc.stress_drop_pct}%` : "N/A";
                return `\nStatus: ✓ Verified True Positive (Head Nod)\nIncident RMSSD (60s): ${osc.incident_rmssd} ms\nVagal Stress Drop: ${drop}\nHeart Rate: ${osc.bpm || "—"} BPM`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: "rgba(0, 0, 0, 0.04)" },
            ticks: { color: "#475569", font: { family: "Inter", size: 11, weight: "500" } }
          },
          y: {
            type: "linear",
            position: "left",
            title: { display: true, text: "RMSSD (ms)", color: "#059669", font: { size: 12, weight: "600" } },
            grid: { color: "rgba(0, 0, 0, 0.05)" },
            ticks: { color: "#334155", font: { family: "JetBrains Mono", size: 11 } },
            min: 0,
            max: Math.max(70, Math.ceil(baselineVal * 1.35))
          }
        }
      }
    });
  }
};
