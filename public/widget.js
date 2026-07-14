/**
 * HockeyWiz TTS Widget (v2)
 * Drop-in embeddable audio narration player.
 *
 * Basic usage (single flowing article):
 *   <script src="/widget.js" data-api="http://localhost:3001" data-selector="article" defer></script>
 *
 * Compact usage (repeated cards, e.g. a scouting "Big Board"):
 *   <script
 *     src="/widget.js"
 *     data-api="http://localhost:3001"
 *     data-selector=".player-card"
 *     data-content-selector=".report-text"
 *     data-mount-in=".card-head"
 *     data-mount-before=".expand-btn"
 *     data-compact="true"
 *     defer
 *   ></script>
 *
 * Config (all read from the <script> tag's data-* attributes):
 *   data-api               Base URL of the backend TTS server. Required.
 *   data-selector           CSS selector for each narratable unit. One player is
 *                            created per match. Defaults to "article".
 *   data-content-selector    Optional selector, relative to each matched unit,
 *                            narrowing which subtree's text gets narrated
 *                            (e.g. ".report-text"). Defaults to the whole unit.
 *   data-mount-in            Optional selector, relative to each matched unit,
 *                            for where to insert the player. Defaults to the
 *                            unit itself.
 *   data-mount-before        Optional selector, relative to the mount point,
 *                            to insert the player before. Defaults to prepending.
 *   data-compact             "true" for a small icon button that expands into a
 *                            mini control strip on click. Good for dense card
 *                            layouts. Defaults to a full inline pill.
 */
(function () {
  "use strict";

  // ---- 1. Read config -------------------------------------------------------
  const scriptEl = document.currentScript;
  const cfg = scriptEl ? scriptEl.dataset : {};
  const API_BASE = (cfg.api || "").replace(/\/$/, "");
  const UNIT_SELECTOR = cfg.selector || "article";
  const CONTENT_SELECTOR = cfg.contentSelector || null;
  const MOUNT_IN_SELECTOR = cfg.mountIn || null;
  const MOUNT_BEFORE_SELECTOR = cfg.mountBefore || null;
  const COMPACT = cfg.compact === "true";

  if (!API_BASE) {
    console.error("[HockeyWiz TTS] Missing data-api attribute on the widget <script> tag.");
    return;
  }

  // ---- 2. Styles --------------------------------------------------------
  // Every color/font reads from the HOST PAGE's own CSS variables first
  // (--acc, --bg3, --text, etc — the exact tokens a HockeyWiz-style page
  // already defines on :root), falling back to sane defaults if the host
  // page doesn't define them. This is what makes the widget look native
  // instead of like a foreign embed.
  const STYLE_ID = "hwtts-styles-v2";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .hwtts-root {
        --hwtts-bg: var(--bg3, #171d2b);
        --hwtts-border: var(--bord, #2a3247);
        --hwtts-text: var(--text, #eef1f7);
        --hwtts-muted: var(--muted, #8791a8);
        --hwtts-accent: var(--acc, #ff4d4f);
        --hwtts-accent-2: var(--cyan, #38bdf8);
        --hwtts-mono: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        --hwtts-sans: var(--sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        font-family: var(--hwtts-sans);
        color: var(--hwtts-text);
      }

      /* ---------- full pill mode ---------- */
      .hwtts-pill {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        background: var(--hwtts-bg);
        border: 1px solid var(--hwtts-border);
        border-radius: 999px;
        padding: 6px 14px 6px 6px;
        margin: 0 0 20px 0;
        max-width: 420px;
        box-sizing: border-box;
      }
      .hwtts-pill.hwtts-active { border-radius: 14px; flex-wrap: wrap; padding-bottom: 10px; }

      /* ---------- shared icon button ---------- */
      .hwtts-icon-btn {
        flex: 0 0 auto;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: none;
        background: color-mix(in srgb, var(--hwtts-accent) 14%, transparent);
        color: var(--hwtts-accent);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s ease, transform 0.1s ease;
      }
      .hwtts-icon-btn:hover { background: color-mix(in srgb, var(--hwtts-accent) 22%, transparent); }
      .hwtts-icon-btn:active { transform: scale(0.94); }
      .hwtts-icon-btn:disabled { opacity: 0.5; cursor: wait; }
      .hwtts-icon-btn svg { width: 13px; height: 13px; }

      .hwtts-pill-meta {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 0.78rem;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .hwtts-pill-sub {
        font-size: 0.68rem;
        color: var(--hwtts-muted);
        font-weight: 400;
      }

      .hwtts-controls-row {
        display: none;
        flex: 1 1 100%;
        align-items: center;
        gap: 8px;
        margin-top: 6px;
      }
      .hwtts-pill.hwtts-active .hwtts-controls-row { display: flex; }

      .hwtts-scrub {
        flex: 1 1 auto;
        accent-color: var(--hwtts-accent-2);
        height: 3px;
      }
      .hwtts-time {
        font-family: var(--hwtts-mono);
        font-size: 0.64rem;
        color: var(--hwtts-muted);
        white-space: nowrap;
      }
      .hwtts-speed {
        flex: 0 0 auto;
        background: transparent;
        border: 1px solid var(--hwtts-border);
        color: var(--hwtts-text);
        border-radius: 5px;
        font-size: 0.64rem;
        font-family: var(--hwtts-mono);
        padding: 2px 6px;
        cursor: pointer;
      }

      /* ---------- compact icon mode ---------- */
      .hwtts-compact {
        display: inline-flex;
        align-items: center;
        vertical-align: middle;
      }
      .hwtts-compact .hwtts-mini-panel {
        display: flex;
        align-items: center;
        gap: 6px;
        max-width: 0;
        opacity: 0;
        overflow: hidden;
        transition: max-width 0.25s ease, opacity 0.2s ease, margin 0.25s ease;
        white-space: nowrap;
      }
      .hwtts-compact.hwtts-active .hwtts-mini-panel {
        max-width: 200px;
        opacity: 1;
        margin-left: 8px;
      }
      .hwtts-compact .hwtts-scrub-mini {
        width: 70px;
        accent-color: var(--hwtts-accent-2);
        height: 3px;
      }

      /* on-air dot / waveform, shared between modes */
      .hwtts-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--hwtts-accent);
        animation: hwtts-pulse 1.8s ease-in-out infinite;
      }
      @keyframes hwtts-pulse {
        0%, 100% { opacity: 0.4; transform: scale(0.85); }
        50% { opacity: 1; transform: scale(1); }
      }
      .hwtts-wave { display: none; align-items: flex-end; gap: 2px; height: 10px; }
      .hwtts-active .hwtts-wave { display: flex; }
      .hwtts-active .hwtts-dot { display: none; }
      .hwtts-wave span {
        width: 2.5px;
        background: var(--hwtts-accent-2);
        border-radius: 2px;
        animation: hwtts-bar 0.9s ease-in-out infinite;
      }
      .hwtts-wave span:nth-child(1) { height: 40%; animation-delay: 0s; }
      .hwtts-wave span:nth-child(2) { height: 100%; animation-delay: 0.15s; }
      .hwtts-wave span:nth-child(3) { height: 60%; animation-delay: 0.3s; }
      .hwtts-wave span:nth-child(4) { height: 80%; animation-delay: 0.45s; }
      @keyframes hwtts-bar {
        0%, 100% { transform: scaleY(0.4); }
        50% { transform: scaleY(1); }
      }

      @media (prefers-reduced-motion: reduce) {
        .hwtts-dot, .hwtts-wave span { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  // ---- 3. Text extraction ---------------------------------------------------
  // Elements that are never narration, regardless of page: scripts/styles,
  // nav/aside chrome, share/ad blocks, and — critically — the widget's own
  // markup, so the player never reads its own labels or timestamps back to
  // itself.
  const STRIP_SELECTORS = [
    "script", "style", "nav", "aside", "figure", "figcaption",
    ".related", ".share", ".ad", ".advertisement", ".social-share",
    ".hwtts-root", "[data-hwtts-ignore]",
  ];

  function textFromScope(scopeEl) {
    const clone = scopeEl.cloneNode(true);
    clone.querySelectorAll(STRIP_SELECTORS.join(",")).forEach((el) => el.remove());

    // Prefer real prose: <p> tags hold the actual narration in virtually every
    // publisher layout, while rank numbers, badges, and buttons never do.
    // This is what keeps a widget from reading "1 Scout Report ▾" out loud.
    const paragraphs = clone.querySelectorAll("p");
    if (paragraphs.length > 0) {
      return Array.from(paragraphs).map((p) => p.innerText || p.textContent || "").join("\n\n");
    }
    return clone.innerText || clone.textContent || "";
  }

  function extractNarrationText(unitEl) {
    const scope = CONTENT_SELECTOR ? unitEl.querySelector(CONTENT_SELECTOR) : unitEl;
    return textFromScope(scope || unitEl);
  }

  function estimateDuration(text) {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.round(words / 150));
    return `${minutes} min`;
  }

  function formatTime(seconds) {
    if (!isFinite(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  const ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;
  const ICON_SPINNER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="9" stroke-opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>`;
  const SPEEDS = [1, 1.25, 1.5, 2];

  // ---- 4. Build + wire a single player --------------------------------------
  function initUnit(unitEl) {
    // Extract narration text BEFORE inserting anything into the DOM — this is
    // the fix for the widget reading its own controls back to the listener.
    const rawText = extractNarrationText(unitEl);
    if (!rawText.trim()) return;

    const root = document.createElement("span");
    root.className = "hwtts-root " + (COMPACT ? "hwtts-compact" : "hwtts-pill");
    root.innerHTML = COMPACT
      ? `
        <button class="hwtts-icon-btn hwtts-playbtn" type="button" aria-label="Listen to this section" title="Listen">
          ${ICON_PLAY}
        </button>
        <div class="hwtts-mini-panel">
          <span class="hwtts-dot"></span>
          <span class="hwtts-wave"><span></span><span></span><span></span><span></span></span>
          <input type="range" class="hwtts-scrub hwtts-scrub-mini" min="0" max="100" value="0" step="0.1" />
          <span class="hwtts-time hwtts-elapsed">0:00</span>
          <button class="hwtts-speed" type="button">1×</button>
        </div>
      `
      : `
        <button class="hwtts-icon-btn hwtts-playbtn" type="button" aria-label="Listen to this article">
          ${ICON_PLAY}
        </button>
        <div class="hwtts-pill-meta">
          Listen to this article
          <div class="hwtts-pill-sub">
            <span class="hwtts-dot"></span>
            <span class="hwtts-wave"><span></span><span></span><span></span><span></span></span>
            <span class="hwtts-status">${estimateDuration(rawText)}</span>
          </div>
        </div>
        <button class="hwtts-speed" type="button">1×</button>
        <div class="hwtts-controls-row">
          <span class="hwtts-time hwtts-elapsed">0:00</span>
          <input type="range" class="hwtts-scrub" min="0" max="100" value="0" step="0.1" />
          <span class="hwtts-time hwtts-remaining">0:00</span>
        </div>
      `;

    // Prevent clicks on the player from bubbling into host page handlers
    // (e.g. a card's own onclick="toggle(this)" expand/collapse behavior).
    root.addEventListener("click", (e) => e.stopPropagation());

    // ---- Mount ----
    let mountPoint = unitEl;
    if (MOUNT_IN_SELECTOR) {
      mountPoint = unitEl.querySelector(MOUNT_IN_SELECTOR) || unitEl;
    }
    const beforeEl = MOUNT_BEFORE_SELECTOR ? mountPoint.querySelector(MOUNT_BEFORE_SELECTOR) : null;
    if (beforeEl) {
      mountPoint.insertBefore(root, beforeEl);
    } else {
      mountPoint.insertBefore(root, mountPoint.firstChild);
    }

    // ---- Elements ----
    const playBtn = root.querySelector(".hwtts-playbtn");
    const speedBtn = root.querySelector(".hwtts-speed");
    const scrub = root.querySelector(".hwtts-scrub");
    const elapsedEl = root.querySelector(".hwtts-elapsed");
    const remainingEl = root.querySelector(".hwtts-remaining");
    const statusEl = root.querySelector(".hwtts-status");

    let audio = null;
    let speedIndex = 0;
    let isLoading = false;
    let isScrubbing = false;

    speedBtn.addEventListener("click", () => {
      speedIndex = (speedIndex + 1) % SPEEDS.length;
      const rate = SPEEDS[speedIndex];
      speedBtn.textContent = `${rate}×`;
      if (audio) audio.playbackRate = rate;
    });

    scrub.addEventListener("input", () => {
      isScrubbing = true;
      if (audio) elapsedEl.textContent = formatTime((scrub.value / 100) * audio.duration);
    });
    scrub.addEventListener("change", () => {
      if (audio) audio.currentTime = (scrub.value / 100) * audio.duration;
      isScrubbing = false;
    });

    async function fetchAudio() {
      const res = await fetch(`${API_BASE}/api/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawText }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    }

    function setActive(active) {
      root.classList.toggle("hwtts-active", active);
      playBtn.innerHTML = active ? ICON_PAUSE : ICON_PLAY;
    }

    playBtn.addEventListener("click", async () => {
      if (isLoading) return;

      if (audio && !audio.paused) {
        audio.pause();
        setActive(false);
        return;
      }
      if (audio && audio.paused) {
        audio.play();
        setActive(true);
        return;
      }

      isLoading = true;
      playBtn.disabled = true;
      playBtn.innerHTML = ICON_SPINNER;
      if (statusEl) statusEl.textContent = "Generating…";

      try {
        const url = await fetchAudio();
        audio = new Audio(url);
        audio.playbackRate = SPEEDS[speedIndex];

        audio.addEventListener("timeupdate", () => {
          if (isScrubbing) return;
          scrub.value = (audio.currentTime / audio.duration) * 100 || 0;
          elapsedEl.textContent = formatTime(audio.currentTime);
          if (remainingEl) remainingEl.textContent = "-" + formatTime(audio.duration - audio.currentTime);
        });
        audio.addEventListener("ended", () => {
          setActive(false);
          if (statusEl) statusEl.textContent = estimateDuration(rawText);
          scrub.value = 0;
        });

        await audio.play();
        setActive(true);
      } catch (err) {
        if (statusEl) statusEl.textContent = "Error";
        playBtn.title = err.message;
        playBtn.innerHTML = ICON_PLAY;
        console.error("[HockeyWiz TTS]", err);
      } finally {
        isLoading = false;
        playBtn.disabled = false;
      }
    });
  }

  // ---- 5. Boot ---------------------------------------------------------------
  function boot() {
    const units = document.querySelectorAll(UNIT_SELECTOR);
    if (units.length === 0) {
      console.warn(`[HockeyWiz TTS] No element found matching "${UNIT_SELECTOR}".`);
      return;
    }
    units.forEach(initUnit);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
