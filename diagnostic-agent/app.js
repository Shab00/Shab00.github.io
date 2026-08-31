const BACKEND_URL = "https://diagnostic-repair-ranking-agent.onrender.com";

// ── State ──
let selectedScenario = "cache_collapse";
let currentReport = null;
let currentSeverity = "high";

// ── Cold-start ping ──
(function pingHealth() {
  const banner = document.getElementById("wake-banner");
  const timer = setTimeout(() => banner.classList.remove("hidden"), 3000);
  fetch(`${BACKEND_URL}/health`)
    .then(() => {
      clearTimeout(timer);
      banner.classList.add("hidden");
    })
    .catch(() => {
      clearTimeout(timer);
      banner.classList.remove("hidden");
    });
})();

// ── Scenario selection ──
document.querySelectorAll(".scenario-card").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".scenario-card")
      .forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    selectedScenario = card.dataset.scenario;
  });
});

// ── Submit fault ──
async function submitFault() {
  const btn = document.getElementById("submit-btn");
  const spinner = document.getElementById("spinner");
  const errorDiv = document.getElementById("fault-error");
  errorDiv.innerHTML = "";

  const description = document.getElementById("description").value.trim();
  const severity = document.getElementById("severity").value;
  const component = document.getElementById("component").value;

  if (!description) {
    errorDiv.innerHTML = `<div class="error-msg">Please enter a fault description.</div>`;
    return;
  }

  currentSeverity = severity;

  btn.disabled = true;
  spinner.classList.remove("hidden");

  try {
    const res = await fetch(`${BACKEND_URL}/fault`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        severity,
        component,
        scenario: selectedScenario,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data.detail || "Something went wrong. Please try again.";
      errorDiv.innerHTML = `<div class="error-msg">${msg}</div>`;
      return;
    }

    currentReport = data;
    renderReport(data);

  } catch (err) {
    errorDiv.innerHTML = `<div class="error-msg">Network error — is the backend awake?</div>`;
  } finally {
    btn.disabled = false;
    spinner.classList.add("hidden");
  }
}

// ── Render report ──
function renderReport(report) {

  // Conflict banner
  const banner = document.getElementById("conflict-banner");
  if (report.conflict.conflict_detected) {
    banner.className = "conflict-banner detected";
    banner.textContent = "Conflict detected — diagnostic sources disagree on root cause. See analysis below.";
  } else {
    banner.className = "conflict-banner none";
    banner.textContent = "No conflict detected — both diagnostic sources are in agreement.";
  }

  // APM diagnostics
  document.getElementById("apm-summary").textContent =
    report.diagnostic_a.summary;
  document.getElementById("apm-flags").innerHTML =
    report.diagnostic_a.flagged_components
      .map(f => `<span class="flag-chip">${f}</span>`).join("");
  document.getElementById("apm-confidence").textContent =
    `Confidence: ${Math.round(report.diagnostic_a.confidence * 100)}%`;

  // Infra diagnostics
  document.getElementById("infra-summary").textContent =
    report.diagnostic_b.summary;
  document.getElementById("infra-flags").innerHTML =
    report.diagnostic_b.flagged_components
      .map(f => `<span class="flag-chip">${f}</span>`).join("");
  document.getElementById("infra-confidence").textContent =
    `Confidence: ${Math.round(report.diagnostic_b.confidence * 100)}%`;

  // Conflict detail
  document.getElementById("conflict-claim-a").textContent =
    report.conflict.source_a_claim;
  document.getElementById("conflict-claim-b").textContent =
    report.conflict.source_b_claim;
  document.getElementById("conflict-explanation").textContent =
    report.conflict.conflict_explanation;

  // Strategies
  const list = document.getElementById("strategies-list");
  list.innerHTML = report.strategies_evaluated.map(s => `
    <div class="strategy-card ${s.rank === 1 ? "rank-1" : ""}">
      <div class="strategy-rank">${s.rank}</div>
      <div class="strategy-name">${formatName(s.strategy.name)}</div>
      <div class="strategy-badges">
        <span class="badge badge-impact-${s.strategy.estimated_impact}">
          Impact: ${s.strategy.estimated_impact}
        </span>
        <span class="badge badge-cost-${s.strategy.estimated_cost}">
          Cost: ${s.strategy.estimated_cost}
        </span>
        <span class="badge badge-risk-${s.strategy.estimated_risk}">
          Risk: ${s.strategy.estimated_risk}
        </span>
        <span class="badge badge-time">
          ${s.strategy.execution_time_minutes} min
        </span>
        ${s.strategy.is_destructive
          ? `<span class="badge badge-destructive">Destructive</span>`
          : ""}
      </div>
      <div class="strategy-justification">${s.justification}</div>
      <div class="strategy-tradeoff">Trade-off: ${s.trade_off_acknowledged}</div>
    </div>
  `).join("");

  // Reasoning
  document.getElementById("reasoning-summary").textContent =
    report.reasoning_summary;
  document.getElementById("recommended-action").textContent =
    report.recommended_action;

  // Audit
  const auditIcons = {
    fault_received: "[fault]",
    report_generated: "[report]",
  };
  const auditLog = document.getElementById("audit-log");
  auditLog.innerHTML = [
    { event: "fault_received", at: report.generated_at,
      detail: `Severity: ${currentSeverity}` },
    { event: "report_generated", at: report.generated_at,
      detail: `Report ID: ${report.report_id}` },
  ].map(e => `
    <div class="audit-entry">
      <span class="audit-icon">${auditIcons[e.event] || "-"}</span>
      <div class="audit-body">
        <div class="audit-event">${e.event.replace(/_/g, " ")}</div>
        <div class="audit-time">${new Date(e.at).toLocaleString()}</div>
        ${e.detail ? `<div class="audit-detail">${e.detail}</div>` : ""}
      </div>
    </div>
  `).join("");

  // Show report panel
  document.getElementById("panel-fault").classList.add("hidden");
  document.getElementById("panel-report").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Format strategy name ──
function formatName(name) {
  return name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Reset ──
function resetAll() {
  currentReport = null;
  currentSeverity = "high";
  document.getElementById("description").value = "";
  document.getElementById("severity").value = "high";
  document.getElementById("component").value = "unknown";
  document.getElementById("fault-error").innerHTML = "";
  document.getElementById("panel-report").classList.add("hidden");
  document.getElementById("panel-fault").classList.remove("hidden");
  document.querySelectorAll(".scenario-card")
    .forEach(c => c.classList.remove("active"));
  document.querySelector('[data-scenario="cache_collapse"]')
    .classList.add("active");
  selectedScenario = "cache_collapse";
  window.scrollTo({ top: 0, behavior: "smooth" });
}
