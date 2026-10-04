const BACKEND_URL = "https://diagnostic-repair-ranking-agent.onrender.com";

// ── State ──
let selectedScenario: string = "cache_collapse";
let currentReport: RepairReportData | null = null;
let currentSeverity: string = "high";

interface RepairConflictData {
  conflict_detected: boolean;
  source_a_claim: string;
  source_b_claim: string;
  conflict_explanation: string;
}

interface RepairDiagnostic {
  summary: string;
  flagged_components: string[];
  confidence: number;
}

interface RepairStrategy {
  rank: number;
  justification: string;
  trade_off_acknowledged: string;
  strategy: {
    name: string;
    estimated_impact: string;
    estimated_cost: string;
    estimated_risk: string;
    execution_time_minutes: number;
    is_destructive: boolean;
  };
}

interface RepairReportData {
  conflict: RepairConflictData;
  diagnostic_a: RepairDiagnostic;
  diagnostic_b: RepairDiagnostic;
  strategies_evaluated: RepairStrategy[];
  reasoning_summary: string;
  recommended_action: string;
  generated_at: string;
  report_id: string;
}

// ── Cold-start ping ──
(function pingHealth(): void {
  const banner = document.getElementById("wake-banner") as HTMLElement;
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
document.querySelectorAll<HTMLElement>(".scenario-card").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll<HTMLElement>(".scenario-card")
      .forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    selectedScenario = (card as HTMLElement).dataset.scenario ?? "cache_collapse";
  });
});

// ── Submit fault ──
async function submitFault(): Promise<void> {
  const btn = document.getElementById("submit-btn") as HTMLButtonElement;
  const spinner = document.getElementById("spinner") as HTMLElement;
  const errorDiv = document.getElementById("fault-error") as HTMLElement;
  errorDiv.innerHTML = "";

  const description = (document.getElementById("description") as HTMLTextAreaElement).value.trim();
  const severity = (document.getElementById("severity") as HTMLSelectElement).value;
  const component = (document.getElementById("component") as HTMLSelectElement).value;

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

    const data: RepairReportData = await res.json();

    if (!res.ok) {
      const msg = (data as unknown as { detail?: string }).detail || "Something went wrong. Please try again.";
      errorDiv.innerHTML = `<div class="error-msg">${msg}</div>`;
      return;
    }

    currentReport = data;
    renderReport(data);

  } catch {
    errorDiv.innerHTML = `<div class="error-msg">Network error — is the backend awake?</div>`;
  } finally {
    btn.disabled = false;
    spinner.classList.add("hidden");
  }
}

// ── Render report ──
function renderReport(report: RepairReportData): void {

  const banner = document.getElementById("conflict-banner") as HTMLElement;
  if (report.conflict.conflict_detected) {
    banner.className = "conflict-banner detected";
    banner.textContent = "Conflict detected — diagnostic sources disagree on root cause. See analysis below.";
  } else {
    banner.className = "conflict-banner none";
    banner.textContent = "No conflict detected — both diagnostic sources are in agreement.";
  }

  document.getElementById("apm-summary")!.textContent = report.diagnostic_a.summary;
  document.getElementById("apm-flags")!.innerHTML =
    report.diagnostic_a.flagged_components
      .map(f => `<span class="flag-chip">${f}</span>`).join("");
  document.getElementById("apm-confidence")!.textContent =
    `Confidence: ${Math.round(report.diagnostic_a.confidence * 100)}%`;

  document.getElementById("infra-summary")!.textContent = report.diagnostic_b.summary;
  document.getElementById("infra-flags")!.innerHTML =
    report.diagnostic_b.flagged_components
      .map(f => `<span class="flag-chip">${f}</span>`).join("");
  document.getElementById("infra-confidence")!.textContent =
    `Confidence: ${Math.round(report.diagnostic_b.confidence * 100)}%`;

  document.getElementById("conflict-claim-a")!.textContent = report.conflict.source_a_claim;
  document.getElementById("conflict-claim-b")!.textContent = report.conflict.source_b_claim;
  document.getElementById("conflict-explanation")!.textContent = report.conflict.conflict_explanation;

  const list = document.getElementById("strategies-list") as HTMLElement;
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

  document.getElementById("reasoning-summary")!.textContent = report.reasoning_summary;
  document.getElementById("recommended-action")!.textContent = report.recommended_action;

  const auditIcons: Record<string, string> = {
    fault_received: "[fault]",
    report_generated: "[report]",
  };

  const auditLog = document.getElementById("audit-log") as HTMLElement;
  auditLog.innerHTML = [
    { event: "fault_received", at: report.generated_at, detail: `Severity: ${currentSeverity}` },
    { event: "report_generated", at: report.generated_at, detail: `Report ID: ${report.report_id}` },
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

  document.getElementById("panel-fault")!.classList.add("hidden");
  document.getElementById("panel-report")!.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Format strategy name ──
function formatName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Reset ──
function resetAll(): void {
  currentReport = null;
  currentSeverity = "high";
  (document.getElementById("description") as HTMLTextAreaElement).value = "";
  (document.getElementById("severity") as HTMLSelectElement).value = "high";
  (document.getElementById("component") as HTMLSelectElement).value = "unknown";
  document.getElementById("fault-error")!.innerHTML = "";
  document.getElementById("panel-report")!.classList.add("hidden");
  document.getElementById("panel-fault")!.classList.remove("hidden");
  document.querySelectorAll<HTMLElement>(".scenario-card")
    .forEach(c => c.classList.remove("active"));
  document.querySelector<HTMLElement>('[data-scenario="cache_collapse"]')!
    .classList.add("active");
  selectedScenario = "cache_collapse";
  window.scrollTo({ top: 0, behavior: "smooth" });
}
