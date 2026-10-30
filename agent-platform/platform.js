/* =========================================================
   Three-Agent Platform — live demo controller
   =========================================================
   Step 1: POST transcript to meeting-chat /chat
   Step 2: POST extracted action items to meeting-followup /workflows

   Endpoints, schemas, and cold-start budgets are declared at the
   top. Nothing below depends on page markup beyond the element IDs
   listed in the DOM section.
   ========================================================= */

(function () {
  "use strict";

  // ---------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------
  const CHAT_ENDPOINT     = "https://meeting-chat-dxde.onrender.com/chat";
  const FOLLOWUP_ENDPOINT = "https://meeting-followup-3d4e.onrender.com/workflows";

  // meeting-followup's StartWorkflowRequest declares meeting_id: UUID.
  // A placeholder string fails validation; we post against the meeting
  // created during setup, which is persisted in Supabase.
  const DEMO_MEETING_ID   = "e2fbca63-3e81-4dc5-bc65-da22fa1b7821";

  // Cold-start budgets. The chat chain touches three services; the
  // followup request touches one. Both may be asleep on the free tier.
  const CHAT_TIMEOUT_MS     = 120000;
  const FOLLOWUP_TIMEOUT_MS =  60000;
  const WAKE_HINT_AFTER_MS  =   3000;

  // ---------------------------------------------------------
  // DOM
  // ---------------------------------------------------------
  const input      = document.getElementById("demo-input");
  const btnAnalyse = document.getElementById("demo-analyse");
  const btnDraft   = document.getElementById("demo-draft");
  const status     = document.getElementById("demo-status");
  const analysisEl = document.getElementById("demo-analysis");
  const draftsEl   = document.getElementById("demo-followups");

  if (!input || !btnAnalyse || !btnDraft || !status || !analysisEl || !draftsEl) {
    console.warn("platform.js: expected DOM elements not found");
    return;
  }

  // ---------------------------------------------------------
  // State
  // ---------------------------------------------------------
  const sessionId = "portfolio-" + Math.random().toString(36).slice(2, 10);
  let lastActionItems = null;   // parsed from the analysis response
  let pendingTimer = null;

  // ---------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------
  function setStatus(text, isError) {
    status.textContent = text || "";
    status.classList.toggle("error", !!isError);
  }

  function clearPendingHint() {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function scheduleWakeHint() {
    clearPendingHint();
    pendingTimer = setTimeout(() => {
      setStatus("Waking backend (free tier) — first request can take ~60s…");
    }, WAKE_HINT_AFTER_MS);
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ---------------------------------------------------------
  // Parsers
  // ---------------------------------------------------------

  // Extract action items from the chat agent's response.
  // The LLM produces markdown-ish text with one block per item,
  // each containing Owner/Task/Due Date/Source Quote fields.
  //
  // ActionItem.source_quote is REQUIRED (str, not Optional) on the
  // followup service, so items without a quote are dropped rather
  // than posted and rejected with a 422.
  function parseActionItems(text) {
    if (!text) return [];

    const blocks = text.split(/\n\s*\n/);
    const items = [];

    for (const block of blocks) {
      const owner = matchField(block, /Owner\s*:?\s*(.+)/i);
      const task  = matchField(block, /Task\s*:?\s*(.+)/i);
      if (!owner || !task) continue;

      const due   = matchField(block, /Due\s*Date\s*:?\s*(.+)/i);
      const quote = matchField(block, /Source\s*Quote\s*:?\s*(.+)/i);

      const cleanQuote = quote ? cleanLine(quote) : "";
      if (!cleanQuote) continue;   // required field on followup's ActionItem

      items.push({
        owner:        cleanLine(owner),
        task:         cleanLine(task),
        due_date:     due ? cleanLine(due) : null,
        source_quote: cleanQuote,
      });
    }

    return items;
  }

  function matchField(block, re) {
    const m = block.match(re);
    if (!m) return null;
    // Keep only the first line of the captured group
    return m[1].split("\n")[0];
  }

  function cleanLine(s) {
    return String(s)
      .replace(/^[\s\-\*•]+/, "")   // leading bullets
      .replace(/\*\*/g, "")          // markdown bold
      .replace(/[""„"']/g, "")       // straight + curly quotes
      .replace(/[.,;]+$/, "")        // trailing punctuation
      .trim();
  }

  // Split the response into the four standard sections.
  //
  // Recognises these header forms, case-insensitively:
  //   ### Summary          (markdown h3)
  //   ## Action Items      (markdown h2)
  //   **Summary**          (bold)
  //   **Summary:**         (bold with colon)
  //   1. **Summary**       (numbered list with bold)
  //   Summary:             (plain with colon)
  //
  // Anything outside a recognised section is dropped from the
  // sectioned output; the fallback in renderAnalysis shows the
  // full raw text if no sections were found.
  function splitSections(text) {
    const sections = {};
    const lines = text.split(/\r?\n/);
    let current = null;
    let buffer = [];

    const headerRe = /^(?:(?:#{1,4}|\d+\.)\s*)?\**\s*(summary|action items|decisions|risks)\s*\**\s*:?\s*$/i;

    function flush() {
      if (current) sections[current] = buffer.join("\n");
      buffer = [];
    }

    for (const line of lines) {
      const stripped = line.trim();
      const m = stripped.match(headerRe);
      if (m) {
        flush();
        current = m[1].toLowerCase();
      } else if (current) {
        buffer.push(line);
      }
    }
    flush();

    return sections;
  }

  // ---------------------------------------------------------
  // Renderers
  // ---------------------------------------------------------
  function renderAnalysis(responseText) {
    analysisEl.innerHTML = "";

    const sections = splitSections(responseText);
    const order = ["Summary", "Action Items", "Decisions", "Risks"];

    for (const label of order) {
      const body = sections[label.toLowerCase()];
      if (!body) continue;
      const card = document.createElement("article");
      card.className = "demo-section";
      card.innerHTML =
        "<h4>" + label + "</h4>" +
        "<pre>" + escapeHtml(body.trim()) + "</pre>";
      analysisEl.appendChild(card);
    }

    if (!analysisEl.children.length) {
      const card = document.createElement("article");
      card.className = "demo-section";
      card.innerHTML =
        "<h4>Response</h4>" +
        "<pre>" + escapeHtml(responseText) + "</pre>";
      analysisEl.appendChild(card);
    }

    analysisEl.hidden = false;
  }

  function renderDrafts(drafts) {
    draftsEl.innerHTML = "";

    if (!drafts || drafts.length === 0) {
      const card = document.createElement("article");
      card.className = "demo-section";
      card.innerHTML = "<h4>Drafts</h4><pre>No drafts returned.</pre>";
      draftsEl.appendChild(card);
      draftsEl.hidden = false;
      return;
    }

    for (const d of drafts) {
      const card = document.createElement("article");
      card.className = "demo-section";
      const owner = d.owner ? escapeHtml(d.owner) : "";
      card.innerHTML =
        "<h4>Draft" +
        (owner ? ' <span class="draft-owner">' + owner + "</span>" : "") +
        "</h4>" +
        "<pre>" + escapeHtml(d.message || d.draft || "") + "</pre>";
      draftsEl.appendChild(card);
    }

    draftsEl.hidden = false;
  }

  // ---------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------
  async function onAnalyse() {
    const message = input.value.trim();
    if (!message) {
      setStatus("Enter a transcript first.", true);
      return;
    }

    btnAnalyse.disabled = true;
    btnDraft.hidden = true;
    analysisEl.hidden = true;
    draftsEl.hidden = true;
    setStatus("Sending to meeting-chat…");
    scheduleWakeHint();

    const started = performance.now();
    try {
      const res = await fetchWithTimeout(
        CHAT_ENDPOINT,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, message }),
          credentials: "include",     // response sets Allow-Credentials: true
        },
        CHAT_TIMEOUT_MS
      );

      clearPendingHint();

      if (!res.ok) {
        setStatus("Analysis failed (" + res.status + ")", true);
        const body = await res.text().catch(() => "");
        console.error("chat error", res.status, body);
        return;
      }

      const data = await res.json();
      const text = data.response || "";
      renderAnalysis(text);

      lastActionItems = parseActionItems(text);
      const elapsed = ((performance.now() - started) / 1000).toFixed(1);
      setStatus(
        "Analysis done in " + elapsed + "s · " +
        lastActionItems.length + " action item(s) detected"
      );

      if (lastActionItems.length > 0) {
        btnDraft.hidden = false;
      }
    } catch (err) {
      clearPendingHint();
      if (err.name === "AbortError") {
        setStatus(
          "Timed out after 120s. Try again — the backend may still be waking.",
          true
        );
      } else {
        setStatus("Network error. Check the console.", true);
        console.error(err);
      }
    } finally {
      btnAnalyse.disabled = false;
    }
  }

  async function onDraft() {
    if (!lastActionItems || !lastActionItems.length) {
      setStatus("Run the analysis first.", true);
      return;
    }

    btnDraft.disabled = true;
    draftsEl.hidden = true;
    setStatus("Sending action items to meeting-followup…");
    scheduleWakeHint();

    const started = performance.now();
    try {
      const res = await fetchWithTimeout(
        FOLLOWUP_ENDPOINT,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meeting_id:   DEMO_MEETING_ID,
            action_items: lastActionItems,
          }),
          credentials: "include",     // response sets Allow-Credentials: true
        },
        FOLLOWUP_TIMEOUT_MS
      );

      clearPendingHint();

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("followup error", res.status, body);
        setStatus("Followup failed (" + res.status + ")", true);
        return;
      }

      const data = await res.json();
      renderDrafts(data.drafts);

      const elapsed = ((performance.now() - started) / 1000).toFixed(1);
      setStatus(
        "Drafts ready in " + elapsed + "s · status: " +
        (data.status || "unknown")
      );
    } catch (err) {
      clearPendingHint();
      if (err.name === "AbortError") {
        setStatus("Followup timed out after 60s.", true);
      } else {
        setStatus("Network error on followup. Check the console.", true);
        console.error(err);
      }
    } finally {
      btnDraft.disabled = false;
    }
  }

  // ---------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------
  btnAnalyse.addEventListener("click", onAnalyse);
  btnDraft.addEventListener("click", onDraft);
})();
