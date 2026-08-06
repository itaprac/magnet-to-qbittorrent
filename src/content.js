/* content.js — intercepts magnet clicks and shows a quick-pick picker. */

const PICKER_ID = "mtq-picker-root";
const TOAST_ID = "mtq-toast";
const STYLE_ID = "mtq-extension-styles";
const MAX_QUICK_PICKS = 3;

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

function buildPickerMarkup({ name, quickCategories, allCategories, defaultCategory, hasMore, categoryLoadError }) {
  const chips = quickCategories
    .map(
      (cat, i) => `
        <button class="mtq-chip" data-category="${escapeAttr(cat)}" data-index="${i + 1}" data-default="${cat === defaultCategory}" type="button">
          <span class="mtq-chip-dot" aria-hidden="true"></span>
          <span class="mtq-chip-label">${escapeHTML(cat) || "No category"}</span>
          ${cat === defaultCategory ? '<span class="mtq-chip-tag">default</span>' : ""}
          <kbd class="mtq-kbd">${i + 1}</kbd>
        </button>`
    )
    .join("");

  const allSelectOptions = allCategories
    .map(
      (cat) => `<option value="${escapeAttr(cat)}"${cat === defaultCategory ? " selected" : ""}>${escapeHTML(cat) || "No category"}</option>`
    )
    .join("");

  return `
    <div class="mtq-card" role="dialog" aria-modal="false" aria-labelledby="mtq-title">
      <div class="mtq-head">
        <svg class="mtq-mark" viewBox="0 0 24 24" aria-hidden="true">
          <rect class="mtq-mark-bg" width="24" height="24" rx="6"/>
          <path class="mtq-mark-bolt" d="M14 3 L7 13 h4.5 l-1.5 8 L17 11 h-4.5 L14 3 z"/>
        </svg>
        <div class="mtq-head-text">
          <p id="mtq-title" class="mtq-title">Add to qBittorrent</p>
          <p class="mtq-name" title="${escapeAttr(name)}">${escapeHTML(name)}</p>
        </div>
        <button class="mtq-close" type="button" aria-label="Cancel">
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2 L12 12 M12 2 L2 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>
      ${categoryLoadError ? `<p class="mtq-warning">Couldn't load categories: ${escapeHTML(categoryLoadError)}</p>` : ""}
      <p class="mtq-label">Add to</p>
      <div class="mtq-chips" role="group" aria-label="Quick category picks">
        ${chips}
        ${
          hasMore
            ? `<button class="mtq-chip mtq-chip-more" type="button" aria-expanded="false">
                 <span class="mtq-chip-label">More…</span>
               </button>`
            : ""
        }
      </div>
      <div class="mtq-more" hidden>
        <label class="mtq-more-label">
          <span>Category</span>
          <select class="mtq-select">${allSelectOptions}</select>
        </label>
        <button class="mtq-add" type="button">Add</button>
      </div>
      <p class="mtq-foot">esc to cancel · ↵ to add</p>
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
function escapeAttr(value) {
  return escapeHTML(value);
}

function buildPickerCSS() {
  return `
    #${PICKER_ID}, #${TOAST_ID} {
      --mtq-bg: var(--bg, oklch(13% 0.014 252));
      --mtq-surface: var(--surface, oklch(17% 0.016 252));
      --mtq-field: var(--field, oklch(20% 0.018 252));
      --mtq-line: var(--line, oklch(30% 0.022 252));
      --mtq-line-strong: var(--line-strong, oklch(42% 0.030 252));
      --mtq-text: var(--text, oklch(95% 0.012 78));
      --mtq-muted: var(--muted, oklch(70% 0.018 80));
      --mtq-dim: var(--dim, oklch(55% 0.014 80));
      --mtq-accent: var(--accent, oklch(78% 0.16 72));
      --mtq-accent-strong: var(--accent-strong, oklch(85% 0.18 72));
      --mtq-accent-ink: var(--accent-ink, oklch(18% 0.04 75));
      --mtq-accent-soft: var(--accent-soft, oklch(78% 0.16 72 / .14));
      --mtq-success: var(--success, oklch(78% 0.14 152));
      --mtq-danger: var(--danger, oklch(70% 0.18 28));
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      --r-pill: 8px;
      --r-field: 10px;
      --r-card: 14px;
      --r-bar: 999px;
      --ease-out: cubic-bezier(.22, 1, .36, 1);
      --t-fast: 100ms;

      box-sizing: border-box;
      font: 13px/1.45 var(--font-sans);
      color: var(--mtq-text);
    }

    #${PICKER_ID} {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      width: min(380px, calc(100vw - 32px));
      animation: mtq-in 180ms var(--ease-out, cubic-bezier(.22, 1, .36, 1));
    }
    @keyframes mtq-in {
      from { opacity: 0; transform: translateY(-6px) scale(.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      #${PICKER_ID} { animation: none; }
      #${TOAST_ID} { animation: none; transition: none !important; }
    }
    #${PICKER_ID} *, #${PICKER_ID} *::before, #${PICKER_ID} *::after { box-sizing: border-box; }

    .mtq-card {
      background: var(--mtq-surface);
      border: 1px solid var(--mtq-line);
      border-radius: var(--r-card);
      box-shadow: 0 18px 60px oklch(6% 0.02 252 / .55), 0 1px 0 oklch(95% 0.01 78 / .04) inset;
      padding: 14px 14px 12px;
    }
    .mtq-head {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 12px;
    }
    .mtq-mark { width: 22px; height: 22px; flex: 0 0 auto; margin-top: 1px; }
    .mtq-mark-bg { fill: var(--mtq-accent); }
    .mtq-mark-bolt { fill: var(--mtq-accent-ink); }
    .mtq-head-text { min-width: 0; flex: 1 1 auto; }
    .mtq-title {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--mtq-muted);
    }
    .mtq-name {
      margin: 3px 0 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--mtq-text);
      letter-spacing: -0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mtq-close {
      width: 24px;
      height: 24px;
      background: transparent;
      border: 0;
      border-radius: var(--r-pill);
      color: var(--mtq-muted);
      cursor: pointer;
      padding: 0;
      display: grid;
      place-items: center;
      flex: 0 0 auto;
    }
    .mtq-close svg { width: 12px; height: 12px; }
    .mtq-close:hover { background: var(--mtq-field); color: var(--mtq-text); }
    .mtq-close:focus-visible { outline: 3px solid var(--mtq-accent-soft); outline-offset: 2px; }

    .mtq-warning {
      margin: 0 0 10px;
      padding: 8px 10px;
      background: oklch(70% 0.18 28 / .12);
      border: 1px solid oklch(70% 0.18 28 / .32);
      border-radius: var(--r-field);
      color: oklch(82% 0.14 28);
      font-size: 12px;
    }

    .mtq-label {
      margin: 0 0 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--mtq-muted);
    }
    .mtq-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .mtq-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 30px;
      padding: 5px 10px 5px 8px;
      background: var(--mtq-field);
      border: 1px solid var(--mtq-line);
      border-radius: var(--r-pill);
      color: var(--mtq-text);
      font: inherit;
      font-size: 12px;
      font-weight: 550;
      cursor: pointer;
      transition:
        background var(--t-fast) var(--ease-out),
        border-color var(--t-fast) var(--ease-out),
        color var(--t-fast) var(--ease-out);
    }
    .mtq-chip:hover {
      background: var(--mtq-accent-soft);
      border-color: var(--mtq-accent);
      color: var(--mtq-text);
    }
    .mtq-chip:focus-visible {
      outline: 3px solid var(--mtq-accent-soft);
      outline-offset: 2px;
    }
    .mtq-chip[data-default="true"] {
      border-color: var(--mtq-accent);
      background: var(--mtq-accent-soft);
    }
    .mtq-chip-dot {
      width: 6px;
      height: 6px;
      border-radius: var(--r-bar);
      background: var(--mtq-accent);
    }
    .mtq-chip-tag {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--mtq-accent);
      padding-left: 2px;
    }
    .mtq-kbd {
      display: inline-grid;
      place-items: center;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      background: var(--mtq-bg);
      border: 1px solid var(--mtq-line);
      border-radius: 4px;
      color: var(--mtq-muted);
      font: 10px/1 var(--font-mono);
      margin-left: 2px;
    }
    .mtq-chip-more .mtq-chip-label { color: var(--mtq-muted); }

    .mtq-more {
      display: flex;
      gap: 8px;
      align-items: end;
      margin-top: 10px;
    }
    .mtq-more[hidden] { display: none; }
    .mtq-more-label {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .mtq-more-label span {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--mtq-muted);
    }
    .mtq-select {
      width: 100%;
      min-height: 34px;
      padding: 6px 10px;
      background: var(--mtq-field);
      border: 1px solid var(--mtq-line);
      border-radius: var(--r-field);
      color: var(--mtq-text);
      font: inherit;
      font-size: 13px;
      outline: none;
      appearance: none;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' width='12' height='8'><path fill='none' stroke='%23B5B0A8' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round' d='M1.5 1.5 6 6 10.5 1.5'/></svg>");
      background-repeat: no-repeat;
      background-position: right 10px center;
      padding-right: 28px;
    }
    .mtq-select:focus { border-color: var(--mtq-accent); box-shadow: 0 0 0 3px var(--mtq-accent-soft); }

    .mtq-add {
      min-height: 34px;
      padding: 0 14px;
      background: var(--mtq-accent);
      color: var(--mtq-accent-ink);
      border: 0;
      border-radius: var(--r-field);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background var(--t-fast) var(--ease-out);
    }
    .mtq-add:hover { background: var(--mtq-accent-strong); }
    .mtq-add:focus-visible { outline: 3px solid var(--mtq-accent-soft); outline-offset: 2px; }

    .mtq-foot {
      margin: 10px 0 0;
      font-size: 11px;
      color: var(--mtq-dim);
      font-family: var(--font-mono);
    }

    /* Toast */
    #${TOAST_ID} {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px 10px 12px;
      background: var(--mtq-surface);
      border: 1px solid var(--mtq-accent);
      border-radius: var(--r-pill);
      color: var(--mtq-text);
      font: 12px/1 var(--font-sans);
      font-weight: 550;
      box-shadow: 0 12px 40px oklch(6% 0.02 252 / .5);
      animation: mtq-toast-in 180ms var(--ease-out);
    }
    #${TOAST_ID}[data-kind="err"] { border-color: var(--mtq-danger); }
    #${TOAST_ID} svg { width: 14px; height: 14px; color: var(--mtq-accent); flex: 0 0 auto; }
    #${TOAST_ID}[data-kind="err"] svg { color: var(--mtq-danger); }
    @keyframes mtq-toast-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = buildPickerCSS();
  document.documentElement.append(style);
}

function showPicker({ magnetUrl, categories, defaultCategory, recents, categoryLoadError }) {
  return new Promise((resolve) => {
    document.getElementById(PICKER_ID)?.remove();
    ensureStyles();

    const quickCategories = pickQuickCategories({ recents, defaultCategory, categories });
    const allCategories = Array.from(new Set(["", defaultCategory, ...(categories || []), ...(recents || [])].filter((value) => value !== undefined && value !== null)));
    const hasMore = allCategories.length > quickCategories.length;

    const root = document.createElement("div");
    root.id = PICKER_ID;

    const card = document.createElement("div");
    card.innerHTML = buildPickerMarkup({
      name: magnetName(magnetUrl),
      quickCategories,
      allCategories,
      defaultCategory: defaultCategory || "",
      hasMore,
      categoryLoadError
    });
    root.append(card.firstElementChild);

    document.documentElement.append(root);

    const moreEl = root.querySelector(".mtq-more");
    const selectEl = root.querySelector(".mtq-select");
    const moreBtn = root.querySelector(".mtq-chip-more");
    const addBtn = root.querySelector(".mtq-add");
    const closeBtn = root.querySelector(".mtq-close");
    const firstChip = root.querySelector(".mtq-chip");
    const previouslyFocused = document.activeElement;

    if (firstChip) firstChip.focus();

    const close = (value) => {
      root.remove();
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onDocMouseDown, true);
      previouslyFocused?.focus?.({ preventScroll: true });
      resolve(value);
    };

    function revealMore() {
      if (!moreEl || !selectEl) return;
      moreEl.hidden = false;
      if (moreBtn) moreBtn.hidden = true;
      moreBtn?.setAttribute("aria-expanded", "true");
      selectEl.focus();
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(null);
        return;
      }
      if (event.key === "Tab") {
        const focusable = [...root.querySelectorAll("button:not([disabled]), select:not([disabled])")]
          .filter((element) => !element.hidden && !element.closest("[hidden]"));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "Enter" || event.key === "NumpadEnter") {
        event.preventDefault();
        event.stopPropagation();
        const targetChip = event.target.closest?.(".mtq-chip");
        if (targetChip?.classList.contains("mtq-chip-more")) {
          revealMore();
          return;
        }
        if (targetChip) {
          close(targetChip.dataset.category);
          return;
        }
        if (event.target === closeBtn) {
          close(null);
          return;
        }
        if (moreEl && !moreEl.hidden) {
          close(selectEl.value);
        } else {
          close(quickCategories[0] ?? "");
        }
        return;
      }
      if (/^[1-9]$/.test(event.key)) {
        const idx = Number(event.key) - 1;
        const chip = root.querySelector(`.mtq-chip[data-index="${event.key}"]`);
        if (chip) {
          event.preventDefault();
          event.stopPropagation();
          close(chip.dataset.category);
        }
      }
    }

    function onDocMouseDown(event) {
      if (!root.contains(event.target)) close(null);
    }

    root.addEventListener("click", (event) => {
      const chip = event.target.closest(".mtq-chip");
      if (chip && !chip.classList.contains("mtq-chip-more")) {
        event.preventDefault();
        close(chip.dataset.category);
        return;
      }
      if (chip && chip.classList.contains("mtq-chip-more")) {
        event.preventDefault();
        revealMore();
        return;
      }
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

function showToast(message, kind = "ok") {
  ensureStyles();
  document.getElementById(TOAST_ID)?.remove();
  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.dataset.kind = kind;
  toast.setAttribute("role", kind === "err" ? "alert" : "status");
  const icon = kind === "err"
    ? '<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 4v3.5M7 9.5v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7.5 L6 10.5 L11 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  toast.innerHTML = `${icon}<span>${escapeHTML(message)}</span>`;
  document.documentElement.append(toast);
  setTimeout(() => {
    toast.style.transition = "opacity 160ms var(--ease-out)";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 200);
  }, 1500);
}

async function addMagnetWithPicker(magnetUrl) {
  const pickerData = await sendMessage({ type: "GET_CATEGORY_PICKER_DATA" });
  if (!pickerData?.ok) {
    showToast(pickerData?.error || "Can't reach extension.", "err");
    return { ok: false, error: pickerData?.error };
  }

  if (!pickerData.askCategoryOnAdd) {
    const response = await sendMessage({ type: "ADD_MAGNET", magnetUrl });
    if (response?.ok) {
      const where = pickerData.defaultCategory ? ` → ${pickerData.defaultCategory}` : "";
      showToast(`Added${where}`);
    } else {
      showToast(response?.error || "Add failed.", "err");
    }
    return response;
  }

  const category = await showPicker({
    magnetUrl,
    categories: pickerData.categories || [],
    defaultCategory: pickerData.defaultCategory || "",
    recents: pickerData.recents || [],
    categoryLoadError: pickerData.categoryLoadError
  });

  if (category === null) return { ok: true, cancelled: true };

  const response = await sendMessage({ type: "ADD_MAGNET", magnetUrl, category });
  if (response?.ok) {
    const where = category ? ` → ${category}` : "";
    showToast(`Added${where}`);
  } else {
    showToast(response?.error || "Add failed.", "err");
  }
  return response;
}

// The context menu path runs entirely in the background script, so it asks this
// tab for the confirmation toast instead of raising a system notification.
runtime?.onMessage?.addListener((message) => {
  if (message?.type !== "SHOW_TOAST" || !message.message) return;
  showToast(String(message.message), message.kind === "err" ? "err" : "ok");
});

document.addEventListener(
  "click",
  async (event) => {
    const magnetUrl = findMagnetLink(event.target);
    if (!magnetUrl) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    await addMagnetWithPicker(magnetUrl);
  },
  true
);
