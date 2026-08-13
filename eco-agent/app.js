const BACKEND_URL = "https://eco-report-agent.onrender.com";

// ── State ──
let surveyId = null;
let reportId = null;
let draftText = "";
let species = [];

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

// ── Set max date to today ──
document.getElementById("date").max = new Date().toISOString().split("T")[0];

// ── Chip / species input ──
const speciesInput = document.getElementById("species-input");
const chipList = document.getElementById("chip-list");

speciesInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    const val = speciesInput.value.trim();
    if (val && !species.includes(val)) {
      species.push(val);
      renderChips();
    }
    speciesInput.value = "";
  }
});

document.getElementById("chip-input").addEventListener("click", () => {
  speciesInput.focus();
});

function renderChips() {
  chipList.innerHTML = "";
  species.forEach((s, i) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `${s} <span class="chip-remove" data-index="${i}">x</span>`;
    chipList.appendChild(chip);
  });
  chipList.querySelectorAll(".chip-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      species.splice(parseInt(btn.dataset.index), 1);
      renderChips();
    });
  });
}

// ── Progress bar ──
function setStep(stepNum) {
  document.querySelectorAll(".step").forEach(el => el.classList.add("hidden"));

  const current = document.getElementById(
    stepNum === "rejected" ? "step-rejected" : `step-${stepNum}`
  );
  if (current) current.classList.remove("hidden");

  for (let i = 1; i <= 4; i++) {
    const indicator = document.getElementById(`step-indicator-${i}`);
    indicator.classList.remove("active", "done");
    if (typeof stepNum === "number") {
      if (i < stepNum) indicator.classList.add("done");
      if (i === stepNum) indicator.classList.add("active");
    }
  }
}

// ── Step 1: Submit survey ──
async function submitSurvey() {
  const btn = document.getElementById("generate-btn");
  const spinner = document.getElementById("spinner");
  const messages = document.getElementById("validation-messages");
  messages.innerHTML = "";

  const payload = {
    site_name: document.getElementById("site_name").value.trim(),
    grid_reference: document.getElementById("grid_reference").value.trim(),
    date: document.getElementById("date").value,
    weather: document.getElementById("weather").value.trim(),
    surveyor_name: document.getElementById("surveyor_name").value.trim(),
    species_observed: species,
    habitat_description: document.getElementById("habitat_description").value.trim(),
    notes: document.getElementById("notes").value.trim(),
  };

  if (!payload.site_name || !payload.grid_reference || !payload.date ||
      !payload.weather || !payload.surveyor_name || species.length === 0) {
    messages.innerHTML = `<div class="validation-issue error">Please fill in all fields and add at least one species.</div>`;
    return;
  }

  btn.disabled = true;
  spinner.classList.remove("hidden");

  try {
    const surveyRes = await fetch(`${BACKEND_URL}/survey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const surveyData = await surveyRes.json();

    if (!surveyRes.ok) {
      const issues = surveyData.detail?.issues || ["Survey validation failed."];
      issues.forEach(issue => {
        messages.innerHTML += `<div class="validation-issue error">${issue}</div>`;
      });
      return;
    }

    surveyId = surveyData.survey_id;

    const warnings = surveyData.validation?.issues || [];
    warnings.forEach(w => {
      messages.innerHTML += `<div class="validation-issue warning">! ${w}</div>`;
    });

    const genRes = await fetch(`${BACKEND_URL}/survey/${surveyId}/generate`, {
      method: "POST",
    });

    const genData = await genRes.json();

    if (!genRes.ok) {
      messages.innerHTML += `<div class="validation-issue error">Generation failed. Please try again.</div>`;
      return;
    }

    reportId = genData.report_id;
    draftText = genData.draft_text;

    document.getElementById("generated-at").textContent =
      "Generated at: " + new Date(genData.generated_at).toLocaleString();
    document.getElementById("draft-rendered").innerHTML = renderDraft(draftText);
    document.getElementById("draft-edit").value = draftText;

    const summary = document.getElementById("validation-summary");
    const valIssues = genData.validation?.issues || [];
    if (valIssues.length === 0) {
      summary.className = "validation-summary clean";
      summary.textContent = "Survey data validated — no issues found.";
    } else {
      summary.className = "validation-summary warnings";
      summary.textContent = "Validated with warnings: " + valIssues.join(", ");
    }

    setStep(2);

  } catch (err) {
    messages.innerHTML = `<div class="validation-issue error">Network error — is the backend awake?</div>`;
  } finally {
    btn.disabled = false;
    spinner.classList.add("hidden");
  }
}

// ── Step 2: Submit for review ──
async function submitForReview() {
  draftText = document.getElementById("draft-edit").value;
  document.getElementById("review-draft-rendered").innerHTML = renderDraft(draftText);
  await fetch(`${BACKEND_URL}/report/${reportId}/submit`, { method: "POST" });
  setStep(3);
}

// ── Step 3: Review decision ──
async function submitReview(decision) {
  const reviewerName = document.getElementById("reviewer_name").value.trim() || "Reviewer";
  const comment = document.getElementById("reviewer_comment").value.trim();

  const res = await fetch(`${BACKEND_URL}/report/${reportId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, comment, reviewer_name: reviewerName }),
  });

  const data = await res.json();

  if (decision === "approved") {
    document.getElementById("approved-meta").textContent =
      `Approved by ${data.approved_by} at ${new Date(data.approved_at).toLocaleString()}`;
    document.getElementById("approved-report").innerHTML = renderDraft(draftText);
    await loadAuditLog();
    setStep(4);

  } else if (decision === "changes_requested") {
    const banner = document.getElementById("review-banner");
    banner.innerHTML = `
      <div class="changes-banner">
        <span>Changes requested — the surveyor would be notified in a production system.</span>
        <a href="#" onclick="goBackToEdit(event)">Back to edit</a>
      </div>`;

  } else if (decision === "rejected") {
    document.getElementById("rejected-comment").textContent =
      comment ? `Reason: ${comment}` : "No reason given.";
    setStep("rejected");
  }
}

// ── Back to edit ──
function goBackToEdit(e) {
  if (e) e.preventDefault();
  document.getElementById("review-banner").innerHTML = "";
  document.getElementById("draft-edit").value = draftText;
  document.getElementById("draft-rendered").innerHTML = renderDraft(draftText);
  setStep(2);
}

// ── Audit log ──
async function loadAuditLog() {
  const res = await fetch(`${BACKEND_URL}/report/${reportId}/audit`);
  const entries = await res.json();
  const log = document.getElementById("audit-log");
  const icons = {
    draft_generated: "[draft]",
    submitted_for_review: "[submitted]",
    approved: "[approved]",
    rejected: "[rejected]",
    changes_requested: "[changes]",
  };
  log.innerHTML = entries.map(e => `
    <div class="audit-entry">
      <span class="audit-icon">${icons[e.event] || "-"}</span>
      <div class="audit-body">
        <div class="audit-event">${e.event.replace(/_/g, " ")}</div>
        <div class="audit-time">${new Date(e.at).toLocaleString()}</div>
        ${e.detail ? `<div class="audit-detail">${e.detail}</div>` : ""}
      </div>
    </div>
  `).join("");
}

// ── Render draft as HTML ──
function renderDraft(text) {
  return text
    .split("\n")
    .map(line => {
      if (line.startsWith("## ")) return `<h3>${line.slice(3)}</h3>`;
      if (line.startsWith("# ")) return `<h3>${line.slice(2)}</h3>`;
      line = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      return line.trim() ? `<p>${line}</p>` : "";
    })
    .join("");
}

// ── Reset ──
function resetAll() {
  surveyId = null;
  reportId = null;
  draftText = "";
  species = [];
  renderChips();
  document.getElementById("validation-messages").innerHTML = "";
  document.getElementById("review-banner").innerHTML = "";
  document.querySelectorAll("input[type=text], textarea").forEach(el => el.value = "");
  document.getElementById("date").value = "";
  setStep(1);
}

// ── Init ──
setStep(1);
