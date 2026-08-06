import test from "node:test";
import assert from "node:assert/strict";

test("saving form settings preserves recent categories", async () => {
  const storage = {
    recentCategories: ["linux", "movies"]
  };
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, ...storage };
        },
        async set(values) {
          Object.assign(storage, values);
        }
      }
    }
  };

  const { saveSettings } = await import("../src/shared.js?storage-test");
  const saved = await saveSettings({
    baseUrl: "http://localhost:8080/",
    username: "admin",
    password: "secret",
    defaultCategory: "linux",
    askCategoryOnAdd: true,
    addPaused: false,
    tags: "browser",
    showNotifications: true,
    notifyOnComplete: true,
    shortcuts: [
      { enabled: true, label: " Plex ", url: "  http://nas.local:32400/web/index.html#!/  " },
      { enabled: false, label: "", url: "" }
    ]
  });

  assert.deepEqual(saved.recentCategories, ["linux", "movies"]);
  assert.deepEqual(storage.recentCategories, ["linux", "movies"]);
  assert.equal(storage.baseUrl, "http://localhost:8080");
  assert.deepEqual(saved.shortcuts, [
    { enabled: true, label: "Plex", url: "http://nas.local:32400/web/index.html#!/" }
  ]);
});

test("stored shortcuts cap at the maximum", async () => {
  const { MAX_SHORTCUTS, normalizeShortcuts } = await import("../src/shared.js?cap-test");
  const many = Array.from({ length: MAX_SHORTCUTS + 3 }, (_, index) => ({
    label: `App ${index}`,
    url: `http://app-${index}.local`
  }));

  assert.equal(normalizeShortcuts(many).length, MAX_SHORTCUTS);
  assert.equal(normalizeShortcuts(many)[0].enabled, true);
  assert.deepEqual(normalizeShortcuts(null), []);
});

test("shortcut links keep only what a tab can open", async () => {
  const { shortcutLink, shortcutLinks } = await import("../src/shared.js?link-test");

  assert.deepEqual(shortcutLink({ label: "Jellyfin", url: "http://nas.local:8096/web/" }), {
    url: "http://nas.local:8096/web/",
    label: "Jellyfin"
  });
  assert.equal(shortcutLink({ url: "https://plex.example.com/web" }).label, "plex.example.com");
  assert.equal(shortcutLink({ url: "" }), null);
  assert.equal(shortcutLink({ url: "nas.local:8096" }), null);
  assert.equal(shortcutLink({ url: "javascript:alert(1)" }), null);

  const links = shortcutLinks({
    shortcuts: [
      { enabled: true, label: "Plex", url: "http://plex.local:32400/web" },
      { enabled: false, label: "Hidden", url: "http://hidden.local" },
      { enabled: true, label: "Broken", url: "not a url" },
      { enabled: true, label: "Files", url: "http://nas.local:5000" }
    ]
  });

  assert.deepEqual(
    links.map((link) => link.label),
    ["Plex", "Files"]
  );
  assert.deepEqual(shortcutLinks({}), []);
});

test("a legacy media app setting becomes the first shortcut", async () => {
  const storage = {
    mediaAppEnabled: true,
    mediaAppUrl: "http://plex.local:32400/web",
    mediaAppLabel: "Plex"
  };
  globalThis.chrome = {
    storage: {
      local: {
        async get(defaults) {
          return { ...defaults, ...storage };
        },
        async set(values) {
          Object.assign(storage, values);
        }
      }
    }
  };

  const { getSettings } = await import("../src/shared.js?legacy-test");
  const settings = await getSettings();

  assert.deepEqual(settings.shortcuts, [
    { enabled: true, label: "Plex", url: "http://plex.local:32400/web" }
  ]);
  assert.equal("mediaAppUrl" in settings, false);
});
