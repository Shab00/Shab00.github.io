const API = "https://diagnostic-agent-langgraph.onrender.com";

let scenario: string = "cache_collapse";
let lastReport: ReportData | null = null;

interface ConflictData {
  conflict_detected: boolean;
  conflicting_components: string[];
  source_a_claim: string;
  source_b_claim: string;
  conflict_explanation: string;
}

interface Diagnostic {
  summary: string;
  flagged_components: string[];
}

interface Strategy {
  rank: number;
  strategy: { name: string };
  justification: string;
  trade_off_acknowledged: string;
}

interface ReportData {
  conflict: ConflictData;
  diagnostic_a: Diagnostic;
  diagnostic_b: Diagnostic;
  strategies_evaluated: Strategy[];
  reasoning_summary: string;
  recommended_action: string;
}

/* ---- Backend status ---- */
async function checkStatus(): Promise<void> {
  const pill = document.getElementById("status") as HTMLElement;
  pill.className = "status-pill waking";
  pill.textContent = "waking…";
  const t0 = performance.now();
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) throw new Error();
    const ms = Math.round(performance.now() - t0);
    pill.className = "status-pill live";
    pill.textContent = ms < 500 ? "live" : `live (${ms}ms)`;
  } catch {
    pill.className = "status-pill unknown";
    pill.textContent = "offline";
  }
}
checkStatus();

/* ---- Scenario buttons ---- */
document.querySelectorAll<HTMLButtonElement>(".scenario").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll<HTMLButtonElement>(".scenario")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    scenario = btn.dataset.scenario ?? "cache_collapse";
  });
});

/* ---- Sample descriptions ---- */
document.querySelectorAll<HTMLButtonElement>(".sample").forEach((btn) => {
  btn.addEventListener("click", () => {
    (document.getElementById("description") as HTMLTextAreaElement).value =
      btn.dataset.fill ?? "";
  });
});

/* ---- Submit ---- */
document.getElementById("submit")!.addEventListener("click", submit);

async function submit(): Promise<void> {
  const btn = document.getElementById("submit") as HTMLButtonElement;
  const err = document.getElementById("error") as HTMLElement;

  err.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "Running…";

  const body = {
    description: (document.getElementById("description") as HTMLTextAreaElement).value || "Fault reported",
    severity: (document.getElementById("severity") as HTMLSelectElement).value,
    component: (document.getElementById("component") as HTMLSelectElement).value,
    scenario,
  };

  const t0 = performance.now();
  try {
    const res = await fetch(`${API}/fault`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: ReportData = await res.json();
    const ms = Math.round(performance.now() - t0);
    lastReport = data;
    render(data, ms);
  } catch (e) {
    err.textContent = `Request failed: ${(e as Error).message}. If this is the first request in a while, the free tier may be waking up — try again in a moment.`;
    err.classList.remove("hidden");
    checkStatus();
  } finally {
    btn.disabled = false;
    btn.textContent = "Run Diagnostic Agent →";
  }
}

/* ---- Render ---- */
function render(data: ReportData, ms: number): void {
  document.getElementById("panel-form")!.classList.add("hidden");
  document.getElementById("panel-results")!.classList.remove("hidden");
  document.getElementById("timing")!.textContent = `${ms}ms`;

  const conflict = data.conflict.conflict_detected;

  renderGraph(conflict);

  const hdr = document.getElementById("conflict-header") as HTMLElement;
  hdr.className = "conflict-header " + (conflict ? "yes" : "no");
  hdr.textContent = conflict
    ? `Conflict detected — sources disagree on ${data.conflict.conflicting_components.join(", ")}`
    : "No conflict — both sources agree on flagged components";

  document.getElementById("apm-summary")!.textContent = data.diagnostic_a.summary;
  document.getElementById("infra-summary")!.textContent = data.diagnostic_b.summary;
  document.getElementById("apm-flags")!.innerHTML = flags(data.diagnostic_a.flagged_components);
  document.getElementById("infra-flags")!.innerHTML = flags(data.diagnostic_b.flagged_components);

  const cc = document.getElementById("conflict-card") as HTMLElement;
  if (conflict) {
    cc.classList.remove("hidden");
    document.getElementById("claim-a")!.textContent = data.conflict.source_a_claim;
    document.getElementById("claim-b")!.textContent = data.conflict.source_b_claim;
    document.getElementById("explanation")!.textContent = data.conflict.conflict_explanation;
  } else {
    cc.classList.add("hidden");
  }

  const list = document.getElementById("strategies") as HTMLElement;
  list.innerHTML = "";
  data.strategies_evaluated.forEach((s) => {
    const el = document.createElement("div");
    el.className = "strategy";
    el.innerHTML = `
      <div class="strategy-header">
        <span class="strategy-rank">${s.rank}</span>
        <span class="strategy-name">${s.strategy.name}</span>
      </div>
      <p>${s.justification}</p>
      <div class="trade-off">Trade-off: ${s.trade_off_acknowledged}</div>
    `;
    list.appendChild(el);
  });

  document.getElementById("reasoning")!.textContent = data.reasoning_summary;
  document.getElementById("recommended")!.textContent = data.recommended_action;

  const pill = document.getElementById("status") as HTMLElement;
  pill.className = "status-pill live";
  pill.textContent = `live (${ms}ms)`;
}

/* ---- Graph rendering ---- */
function renderGraph(conflict: boolean): void {
  const g = document.getElementById("graph") as HTMLElement;
  const branch = conflict ? "conflict" : "agreement";

  g.innerHTML = `
    <div class="graph-row">
      <span class="graph-row-label">Start</span>
      <span class="graph-node ran">fetch_system_state</span>
    </div>
    <div class="graph-row">
      <span class="graph-row-label">Parallel</span>
      <span class="graph-node ran">compute_apm_diagnostics</span>
      <span class="graph-node ran">compute_infra_diagnostics</span>
      <span class="graph-node ran">compute_severity_ranking</span>
    </div>
    <div class="graph-row">
      <span class="graph-row-label">Detect</span>
      <span class="graph-node ran">detect_conflict</span>
      <span class="graph-arrow">→</span>
      <span class="graph-node branch-${branch}">
        ${conflict ? "conflict" : "agreement"}
      </span>
    </div>
    <div class="graph-row">
      <span class="graph-row-label">Rank</span>
      <span class="graph-node ran llm branch-${branch}">
        rank_repairs_${branch}
      </span>
      <span class="graph-arrow">→</span>
      <span class="graph-node ran llm">write_reasoning</span>
    </div>
    <div class="graph-row">
      <span class="graph-row-label">Finish</span>
      <span class="graph-node ran">finalize_report</span>
    </div>
  `;

  const trace: { n: string; node: string; tag: string }[] = [
    { n: "1", node: "fetch_system_state", tag: "" },
    { n: "2", node: "compute_apm_diagnostics", tag: "" },
    { n: "3", node: "compute_infra_diagnostics", tag: "" },
    { n: "4", node: "compute_severity_ranking", tag: "" },
    { n: "5", node: "detect_conflict", tag: "" },
    { n: "6", node: `rank_repairs_${branch}`, tag: "LLM (fallback)" },
    { n: "7", node: "write_reasoning", tag: "LLM (fallback)" },
    { n: "8", node: "finalize_report", tag: "" },
  ];

  document.getElementById("trace")!.innerHTML = trace
    .map(
      (t) => `
      <div class="trace-line ${t.tag ? "llm-tag" : ""}">
        <span class="t-num">${t.n}</span>
        <span class="t-node">${t.node}</span>
        <span class="t-tag">${t.tag}</span>
      </div>`
    )
    .join("");
}

function flags(items: string[]): string {
  return items.map((f) => `<span class="flag">${f}</span>`).join("");
}

/* ---- Copy JSON ---- */
document.getElementById("copy-json")!.addEventListener("click", async () => {
  const btn = document.getElementById("copy-json") as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastReport, null, 2));
    btn.textContent = "Copied ✓";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "Copy JSON";
      btn.classList.remove("copied");
    }, 1500);
  } catch {
    btn.textContent = "Copy failed";
  }
});

/* ---- Reset ---- */
function reset(): void {
  document.getElementById("panel-results")!.classList.add("hidden");
  document.getElementById("panel-form")!.classList.remove("hidden");
  document.getElementById("error")!.classList.add("hidden");
}
