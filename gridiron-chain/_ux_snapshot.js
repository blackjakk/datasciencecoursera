// _ux_snapshot.js — UX visual verification harness.
//
// Opens the game in headless Chromium and produces screenshots so UX edits
// can be visually verified (the audit harnesses produce text; this one
// produces images). Mirrors their conventions: read-only, terminal-friendly,
// no build step.
//
//   Usage:
//     node _ux_snapshot.js                  → take all default shots
//     node _ux_snapshot.js cold             → cold-start (no saves)
//     node _ux_snapshot.js returning        → with seeded slot data
//     node _ux_snapshot.js mobile           → narrow viewport
//     node _ux_snapshot.js dev              → testing-tools entry (?dev=1)
//
// Output: /tmp/ux/<shot>.png — readable via the Read tool.
//
// Prereq: an http-server running on :5173 from this directory.
//   nohup npx http-server -p 5173 -c-1 -s . > /tmp/dev-server.log 2>&1 &
const path = require("path");
const fs = require("fs");
const PW_LIB = "/opt/node22/lib/node_modules/playwright";
const { chromium } = require(PW_LIB);

const URL = "http://localhost:5173/play.html";
const OUT_DIR = "/tmp/ux";

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile:  { width:  390, height: 844 },
};

// Seed localStorage for "returning user" with one franchise slot.
// franchise data lives in IndexedDB (idb wrapper); the slot meta + active slot
// id are in localStorage (FRANCHISE_SLOTS_KEY = "gc_franchise_slots_v1").
// Faking a slot meta is enough to drive the UI into the has-saves state — IDB
// lookup just returns nothing on load click, which is fine for a screenshot of
// the slot-list state.
const RETURNING_LOCAL_STORAGE = {
  gc_franchise_slots_v1: JSON.stringify({
    activeSlotId: null,
    slots: [
      {
        id: 1, name: "Hawks Dynasty", lastSaved: Date.now() - 3 * 86400 * 1000,
        summary: { teamName: "Steelforge Hammers", season: 7, phase: "regular", week: 5, record: "4-1" },
      },
      {
        id: 2, name: "Rebuild Run",   lastSaved: Date.now() - 30 * 86400 * 1000,
        summary: { teamName: "Bayou Gators",     season: 2, phase: "offseason", record: "3-11" },
      },
    ],
  }),
};

const SHOTS = {
  cold: {
    desc: "Cold start — no saves, new visitor lands here",
    viewport: "desktop",
    setup: async (page) => { /* nothing */ },
    url: URL,
  },
  returning: {
    desc: "Returning user — slot list visible",
    viewport: "desktop",
    setup: async (page) => {
      await page.addInitScript((store) => {
        for (const k in store) localStorage.setItem(k, store[k]);
      }, RETURNING_LOCAL_STORAGE);
    },
    url: URL,
  },
  mobile: {
    desc: "Mobile narrow viewport — cold start",
    viewport: "mobile",
    setup: async (page) => { /* nothing */ },
    url: URL,
  },
  dev: {
    desc: "Dev tools entry via ?dev=1",
    viewport: "desktop",
    setup: async (page) => { /* nothing */ },
    url: URL + "?dev=1",
  },
  // Drive the delete flow — click ⋯ on the high-value (S7) slot, then click Delete,
  // capture the type-name-gated confirm modal.
  "delete-modal-high": {
    desc: "Delete confirm modal (high-value franchise, type-to-confirm gate)",
    viewport: "desktop",
    setup: async (page) => {
      await page.addInitScript((store) => {
        for (const k in store) localStorage.setItem(k, store[k]);
      }, RETURNING_LOCAL_STORAGE);
    },
    url: URL,
    after: async (page) => {
      // Open the first slot's ⋯ menu, then click the Delete item
      await page.click(".frn-slot .frn-slot-menu-btn", { timeout: 5000 });
      await page.waitForTimeout(150);
      await page.click(".frn-slot-menu.open .frn-slot-menu-item.danger", { timeout: 3000 });
      await page.waitForSelector(".frn-modal-backdrop", { timeout: 3000 });
      await page.waitForTimeout(200);
    },
  },
  // Same flow but on the low-value (S2) franchise — no type-name gate.
  "delete-modal-low": {
    desc: "Delete confirm modal (low-value franchise, no gate)",
    viewport: "desktop",
    setup: async (page) => {
      await page.addInitScript((store) => {
        for (const k in store) localStorage.setItem(k, store[k]);
      }, RETURNING_LOCAL_STORAGE);
    },
    url: URL,
    after: async (page) => {
      // 2nd slot = S2 rebuild
      const menus = await page.$$(".frn-slot .frn-slot-menu-btn");
      if (menus[1]) await menus[1].click();
      await page.waitForTimeout(150);
      await page.click(".frn-slot-menu.open .frn-slot-menu-item.danger", { timeout: 3000 });
      await page.waitForSelector(".frn-modal-backdrop", { timeout: 3000 });
      await page.waitForTimeout(200);
    },
  },
  // "Choose Your Story" archetype picker — the new-player onboarding path.
  "story-picker": {
    desc: "Choose Your Story (3-archetype path)",
    viewport: "desktop",
    setup: async (page) => { /* nothing */ },
    url: URL,
    after: async (page) => {
      await page.click("button.frn-start-alt:has-text('Choose Your Story')", { timeout: 5000 });
      await page.waitForSelector(".frn-story-grid", { timeout: 3000 });
      await page.waitForTimeout(200);
    },
  },
  "story-picker-mobile": {
    desc: "Choose Your Story (mobile viewport)",
    viewport: "mobile",
    setup: async (page) => { /* nothing */ },
    url: URL,
    after: async (page) => {
      await page.click("button.frn-start-alt:has-text('Choose Your Story')", { timeout: 5000 });
      await page.waitForSelector(".frn-story-grid", { timeout: 3000 });
      await page.waitForTimeout(200);
    },
  },
  // Just the ⋯ menu open, no modal — verifies the popover visually.
  "slot-menu": {
    desc: "Slot row ⋯ popover menu (Rename / Delete options)",
    viewport: "desktop",
    setup: async (page) => {
      await page.addInitScript((store) => {
        for (const k in store) localStorage.setItem(k, store[k]);
      }, RETURNING_LOCAL_STORAGE);
    },
    url: URL,
    after: async (page) => {
      await page.click(".frn-slot .frn-slot-menu-btn", { timeout: 5000 });
      await page.waitForTimeout(200);
    },
  },
};

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const which = process.argv[2] || null;
  const targets = which ? [which] : Object.keys(SHOTS);
  for (const name of targets) {
    const cfg = SHOTS[name];
    if (!cfg) { console.error(`unknown shot: ${name}`); continue; }
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: VIEWPORTS[cfg.viewport] });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error(`  [${name}] pageerror: ` + e.message.slice(0, 240)));
    await cfg.setup(page);
    try {
      await page.goto(cfg.url, { waitUntil: "networkidle", timeout: 15000 });
    } catch (e) {
      console.error(`  [${name}] navigation: ` + e.message.slice(0, 200));
    }
    // Tiny settling — the franchise render does async IDB reads on load.
    await page.waitForTimeout(800);
    // Interactive driver: optional `after(page)` that clicks/types to bring up
    // a specific UI state before the screenshot fires (modals, menus, etc).
    if (typeof cfg.after === "function") {
      try { await cfg.after(page); }
      catch (e) { console.error(`  [${name}] after(): ` + e.message.slice(0, 240)); }
    }
    const out = path.join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: out, fullPage: true });
    const size = fs.statSync(out).size;
    console.log(`✓ ${name.padEnd(10)} ${cfg.desc.padEnd(48)}  → ${out} (${(size / 1024).toFixed(0)} KB)`);
    await browser.close();
  }
})();
