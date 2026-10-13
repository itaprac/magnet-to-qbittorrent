/* content.js — intercepts magnet clicks and shows a quick-pick picker. */

const PICKER_ID = "mtq-picker-root";
const TOAST_ID = "mtq-toast";
const MAX_QUICK_PICKS = 3;
const TOAST_OK_MS = 1600;
const TOAST_ERROR_MS = 6000;

const runtime = (() => {
  try {
    return globalThis.browser?.runtime ?? globalThis.chrome?.runtime ?? null;
  } catch {
    return null;
  }
})();

function findMagnetLink(start) {
  const link = start?.closest?.("a[href]");
  if (!link) return null;
  const href = link.href || link.getAttribute("href") || "";
  return href.startsWith("magnet:") ? href : null;
}

function sendMessage(message) {
  if (!runtime?.sendMessage) {
    return Promise.resolve({ ok: false, error: "Extension runtime not available. Refresh this tab." });
  }

  try {
    if (globalThis.browser?.runtime) {
      return runtime.sendMessage(message).then((r) => r ?? { ok: false, error: "No response from background script." });
    }
    return new Promise((resolve) => {
      runtime.sendMessage(message, (response) => {
        const lastError = globalThis.chrome?.runtime?.lastError;
        if (lastError) {
          resolve({ ok: false, error: lastError.message });
          return;
        }
        resolve(response ?? { ok: false, error: "No response from background script." });
      });
    });
  } catch (error) {
    return Promise.resolve({ ok: false, error: error.message });
  }
}

function magnetName(magnetUrl) {
  try {
    const parsed = new URL(magnetUrl);
    return parsed.searchParams.get("dn") || "New torrent";
  } catch {
    return "New torrent";
  }
}

function pickQuickCategories({ recents, defaultCategory, categories }) {
  const out = [];
  const seen = new Set();
  const push = (value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };
  push(defaultCategory);
  for (const c of recents || []) push(c);
  for (const c of categories || []) push(c);
  if (!out.length) out.push("");
  return out.slice(0, MAX_QUICK_PICKS);
}

function buildPickerMarkup({ name, quickCategories, allCategories, defaultCategory, hasMore, categoryLoadError, addPaused }) {
  const chips = quickCategories
    .map(
      (cat, i) => `
        <button class="chip" data-category="${escapeHTML(cat)}" data-index="${i + 1}" data-default="${cat === defaultCategory}" type="button">
          <span class="chip-dot" aria-hidden="true"></span>
          <span class="chip-label">${escapeHTML(cat) || "No category"}</span>
          ${cat === defaultCategory ? '<span class="chip-tag">default</span>' : ""}
          <kbd>${i + 1}</kbd>
        </button>`
    )
    .join("");

  const allSelectOptions = allCategories
    .map(
      (cat) => `<option value="${escapeHTML(cat)}"${cat === defaultCategory ? " selected" : ""}>${escapeHTML(cat) || "No category"}</option>`
    )
    .join("");

  return `
    <div class="card" role="dialog" aria-modal="false" aria-labelledby="title">
      <div class="head">
        <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
          <rect class="mark-bg" width="24" height="24" rx="6"/>
          <path class="mark-bolt" d="M14 3 L7 13 h4.5 l-1.5 8 L17 11 h-4.5 L14 3 z"/>
        </svg>
        <div class="head-text">
          <p id="title" class="title">Add to qBittorrent</p>
          <p class="name" title="${escapeHTML(name)}">${escapeHTML(name)}</p>
        </div>
        <button class="close" type="button" aria-label="Cancel">
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2 L12 12 M12 2 L2 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>
      ${categoryLoadError ? `<p class="warning">Couldn't load categories: ${escapeHTML(categoryLoadError)}</p>` : ""}
      <p class="label">Add to</p>
      <div class="chips" role="group" aria-label="Quick category picks">
        ${chips}
        ${
          hasMore
            ? `<button class="chip chip-more" type="button" aria-expanded="false">
                 <span class="chip-label">More…</span>
               </button>`
            : ""
        }
      </div>
      <div class="more" hidden>
        <label class="more-label">
          <span>Category</span>
          <select class="select">${allSelectOptions}</select>
        </label>
        <button class="add" type="button">Add</button>
      </div>
      <div class="foot">
        <label class="paused">
          <input class="paused-input" type="checkbox"${addPaused ? " checked" : ""} />
          <span>Add paused</span>
          <kbd>P</kbd>
        </label>
        <span class="hint">esc to cancel · ↵ to add</span>
      </div>
    </div>
  `;
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The picker and toast live in a closed shadow root, so neither the page's
// styles nor its custom properties (`--bg`, `--text`, …) can reach them. The
// values mirror src/tokens.css.
const SHADOW_CSS = `
  :host {
    all: initial;
    --bg: oklch(13% 0.014 252);
    --surface: oklch(17% 0.016 252);
    --field: oklch(20% 0.018 252);
    --line: oklch(30% 0.022 252);
    --line-strong: oklch(42% 0.030 252);
    --text: oklch(95% 0.012 78);
    --muted: oklch(70% 0.018 80);
    --dim: oklch(55% 0.014 80);
    --accent: oklch(78% 0.16 72);
    --accent-strong: oklch(85% 0.18 72);
    --accent-ink: oklch(18% 0.04 75);
    --accent-soft: oklch(78% 0.16 72 / .14);
    --success: oklch(78% 0.14 152);
    --danger: oklch(70% 0.18 28);
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui, sans-serif;
    --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    --r-pill: 8px;
    --r-field: 10px;
    --r-card: 14px;
    --r-bar: 999px;
    --ease-out: cubic-bezier(.22, 1, .36, 1);
    --t-fast: 100ms;

    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 2147483647;
    color-scheme: dark;
    color: var(--text);
    font: 13px/1.45 var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }
  *, *::before, *::after { box-sizing: border-box; }
  p { margin: 0; }
  button, select, input { font: inherit; color: inherit; }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 4px;
    color: var(--muted);
    font: 10px/1 var(--font-mono);
  }
  @media (prefers-reduced-motion: reduce) {
    .card, .toast { animation: none !important; transition: none !important; }
  }
`;

const PICKER_CSS = `
  :host { width: min(380px, calc(100vw - 32px)); }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-card);
    box-shadow: 0 18px 60px oklch(6% 0.02 252 / .55), 0 1px 0 oklch(95% 0.01 78 / .04) inset;
    padding: 14px 14px 12px;
    animation: card-in 180ms var(--ease-out);
  }
  @keyframes card-in {
    from { opacity: 0; transform: translateY(-6px) scale(.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
  .mark { width: 22px; height: 22px; flex: 0 0 auto; margin-top: 1px; }
  .mark-bg { fill: var(--accent); }
  .mark-bolt { fill: var(--accent-ink); }
  .head-text { min-width: 0; flex: 1 1 auto; }
  .title, .label, .more-label span {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .name {
    margin-top: 3px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .close {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: var(--r-pill);
    color: var(--muted);
    cursor: pointer;
  }
  .close svg { width: 12px; height: 12px; }
  .close:hover { background: var(--field); color: var(--text); }
  .close:focus-visible, .chip:focus-visible, .add:focus-visible, .paused-input:focus-visible {
    outline: 3px solid var(--accent-soft);
    outline-offset: 2px;
  }

  .warning {
    margin-bottom: 10px;
    padding: 8px 10px;
    background: oklch(70% 0.18 28 / .12);
    border: 1px solid oklch(70% 0.18 28 / .32);
    border-radius: var(--r-field);
    color: oklch(82% 0.14 28);
    font-size: 12px;
  }
  .label { margin-bottom: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 5px 8px;
    background: var(--field);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    font-size: 12px;
    font-weight: 550;
    cursor: pointer;
    transition: background var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out);
  }
  .chip:hover { background: var(--accent-soft); border-color: var(--accent); }
  .chip[data-default="true"] { border-color: var(--accent); background: var(--accent-soft); }
  .chip-dot { width: 6px; height: 6px; border-radius: var(--r-bar); background: var(--accent); }
  .chip-tag {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .chip-more { padding-inline: 10px; }
  .chip-more .chip-label { color: var(--muted); }

  .more { display: flex; gap: 8px; align-items: end; margin-top: 10px; }
  .more[hidden] { display: none; }
  .more-label { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .select {
    width: 100%;
    min-height: 34px;
    padding: 6px 28px 6px 10px;
    background: var(--field) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' width='12' height='8'><path fill='none' stroke='%23B5B0A8' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round' d='M1.5 1.5 6 6 10.5 1.5'/></svg>") no-repeat right 10px center;
    border: 1px solid var(--line);
    border-radius: var(--r-field);
    font-size: 13px;
    outline: none;
    appearance: none;
  }
  .select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .add {
    min-height: 34px;
    padding: 0 14px;
    background: var(--accent);
    color: var(--accent-ink);
    border: 0;
    border-radius: var(--r-field);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .add:hover { background: var(--accent-strong); }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  .paused {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 28px;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
  }
  .paused:hover { color: var(--text); }
  .paused-input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); cursor: pointer; }
  .hint { color: var(--dim); font: 11px/1.2 var(--font-mono); white-space: nowrap; }
`;

const TOAST_CSS = `
  :host { max-width: min(420px, calc(100vw - 32px)); }
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: var(--r-field);
    box-shadow: 0 12px 40px oklch(6% 0.02 252 / .5);
    font: 550 12px/1.4 var(--font-sans);
    animation: toast-in 180ms var(--ease-out);
    transition: opacity 160ms var(--ease-out);
  }
  .toast[data-kind="err"] { border-color: var(--danger); }
  .toast[data-leaving] { opacity: 0; }
  .icon { width: 14px; height: 14px; margin-top: 1px; color: var(--accent); flex: 0 0 auto; }
  .toast[data-kind="err"] .icon { color: var(--danger); }
  .message { min-width: 0; overflow-wrap: anywhere; }
  .dismiss {
    width: 22px;
    height: 22px;
    margin: -3px -4px -3px 2px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: var(--muted);
    cursor: pointer;
  }
  .dismiss svg { width: 10px; height: 10px; }
  .dismiss:hover { background: var(--field); color: var(--text); }
  .dismiss:focus-visible { outline: 3px solid var(--accent-soft); outline-offset: 1px; }
  @keyframes toast-in {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;

function createShadowHost(id, css) {
  document.getElementById(id)?.remove();
  const host = document.createElement("div");
  host.id = id;
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = SHADOW_CSS + css;
  shadow.append(style);
  return { host, shadow };
}

function showPicker({ magnetUrl, categories, defaultCategory, recents, categoryLoadError, addPaused }) {
  return new Promise((resolve) => {
    const { host, shadow } = createShadowHost(PICKER_ID, PICKER_CSS);

    const quickCategories = pickQuickCategories({ recents, defaultCategory, categories });
    const allCategories = Array.from(new Set(["", defaultCategory, ...(categories || []), ...(recents || [])].filter((value) => value !== undefined && value !== null)));
    const hasMore = allCategories.length > quickCategories.length;

    const template = document.createElement("template");
    template.innerHTML = buildPickerMarkup({
      name: magnetName(magnetUrl),
      quickCategories,
      allCategories,
      defaultCategory: defaultCategory || "",
      hasMore,
      categoryLoadError,
      addPaused
    });
    shadow.append(template.content);
    document.documentElement.append(host);

    const root = shadow.querySelector(".card");
    const moreEl = shadow.querySelector(".more");
    const selectEl = shadow.querySelector(".select");
    const moreBtn = shadow.querySelector(".chip-more");
    const addBtn = shadow.querySelector(".add");
    const closeBtn = shadow.querySelector(".close");
    const pausedInput = shadow.querySelector(".paused-input");
    const firstChip = shadow.querySelector(".chip");
    const previouslyFocused = document.activeElement;

    firstChip?.focus();

    const close = (category) => {
      host.remove();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onDocMouseDown, true);
      previouslyFocused?.focus?.({ preventScroll: true });
      resolve(category === null ? null : { category, paused: pausedInput.checked });
    };

    function revealMore() {
      if (!moreEl || !selectEl) return;
      moreEl.hidden = false;
      if (moreBtn) moreBtn.hidden = true;
      moreBtn?.setAttribute("aria-expanded", "true");
      selectEl.focus();
    }

    function onKeyDown(event) {
      // Events from inside a shadow root are retargeted to the host.
      const target = event.composedPath()[0];
      const insidePicker = event.composedPath().includes(host);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(null);
        return;
      }
      if (event.key === "Tab") {
        const focusable = [...root.querySelectorAll("button, select, input")]
          .filter((element) => !element.disabled && !element.hidden && !element.closest("[hidden]"));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = shadow.activeElement;
        if (!active || (event.shiftKey && active === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "Enter" || event.key === "NumpadEnter") {
        event.preventDefault();
        event.stopPropagation();
        const targetChip = insidePicker ? target.closest?.(".chip") : null;
        if (targetChip?.classList.contains("chip-more")) {
          revealMore();
          return;
        }
        if (targetChip) {
          close(targetChip.dataset.category);
          return;
        }
        if (target === closeBtn) {
          close(null);
          return;
        }
        if (target === pausedInput) {
          pausedInput.checked = !pausedInput.checked;
          return;
        }
        close(moreEl && !moreEl.hidden ? selectEl.value : quickCategories[0] ?? "");
        return;
      }
      if (target === selectEl) return;
      if (event.key === "p" || event.key === "P") {
        event.preventDefault();
        event.stopPropagation();
        pausedInput.checked = !pausedInput.checked;
        return;
      }
      if (/^[1-9]$/.test(event.key)) {
        const chip = shadow.querySelector(`.chip[data-index="${event.key}"]`);
        if (chip) {
          event.preventDefault();
          event.stopPropagation();
          close(chip.dataset.category);
        }
      }
    }

    function onDocMouseDown(event) {
      if (!event.composedPath().includes(host)) close(null);
    }

    root.addEventListener("click", (event) => {
      const chip = event.target.closest(".chip");
      if (!chip) return;
      event.preventDefault();
      if (chip.classList.contains("chip-more")) revealMore();
      else close(chip.dataset.category);
    });

    addBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      close(selectEl.value);
    });

    closeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      close(null);
    });

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onDocMouseDown, true);
  });
}

// Success fades out quickly; an error stays long enough to read, pauses while
// hovered, and can be dismissed.
function showToast(message, kind = "ok") {
  const { host, shadow } = createShadowHost(TOAST_ID, TOAST_CSS);
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.dataset.kind = kind;
  toast.setAttribute("role", kind === "err" ? "alert" : "status");
  const icon = kind === "err"
    ? '<svg class="icon" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 4v3.5M7 9.5v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
    : '<svg class="icon" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7.5 L6 10.5 L11 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const dismiss = kind === "err"
    ? '<button class="dismiss" type="button" aria-label="Dismiss"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2 L12 12 M12 2 L2 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>'
    : "";
  toast.innerHTML = `${icon}<span class="message">${escapeHTML(message)}</span>${dismiss}`;
  shadow.append(toast);
  document.documentElement.append(host);

  let timer = null;
  const leave = () => {
    toast.dataset.leaving = "";
    setTimeout(() => host.remove(), 200);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(leave, kind === "err" ? TOAST_ERROR_MS : TOAST_OK_MS);
  };
  toast.addEventListener("mouseenter", () => clearTimeout(timer));
  toast.addEventListener("mouseleave", schedule);
  shadow.querySelector(".dismiss")?.addEventListener("click", () => {
    clearTimeout(timer);
    leave();
  });
  schedule();
}

async function addMagnetWithPicker(magnetUrl) {
  const pickerData = await sendMessage({ type: "GET_CATEGORY_PICKER_DATA" });
  if (!pickerData?.ok) {
    showToast(pickerData?.error || "Can't reach extension.", "err");
    return { ok: false, error: pickerData?.error };
  }

  let message = { type: "ADD_MAGNET", magnetUrl };
  if (pickerData.askCategoryOnAdd) {
    const choice = await showPicker({
      magnetUrl,
      categories: pickerData.categories || [],
      defaultCategory: pickerData.defaultCategory || "",
      recents: pickerData.recents || [],
      categoryLoadError: pickerData.categoryLoadError,
      addPaused: Boolean(pickerData.addPaused)
    });
    if (choice === null) return { ok: true, cancelled: true };
    message = { ...message, ...choice };
  }

  const response = await sendMessage(message);
  if (response?.ok) {
    const where = response.category ? ` → ${response.category}` : "";
    showToast(`Added${where}${message.paused ? " · paused" : ""}`);
  } else {
    showToast(response?.error || "Add failed.", "err");
  }
  return response;
}

// The context menu path runs entirely in the background script, so it asks this
// tab for the confirmation toast instead of raising a system notification.
// A click inside an iframe is handed to the top frame, which has room for the picker.
runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SHOW_TOAST" && message.message) {
    showToast(String(message.message), message.kind === "err" ? "err" : "ok");
    sendResponse({ ok: true });
  }
  if (message?.type === "PICK_FROM_FRAME" && window === window.top && String(message.magnetUrl).startsWith("magnet:")) {
    addMagnetWithPicker(message.magnetUrl);
    sendResponse({ ok: true });
  }
});

const isTopFrame = (() => {
  try {
    return window === window.top;
  } catch {
    return false;
  }
})();

document.addEventListener(
  "click",
  async (event) => {
    const magnetUrl = findMagnetLink(event.target);
    if (!magnetUrl) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (!isTopFrame) {
      const forwarded = await sendMessage({ type: "PICK_IN_TOP_FRAME", magnetUrl });
      if (forwarded?.ok) return;
    }
    await addMagnetWithPicker(magnetUrl);
  },
  true
);
