import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "C:/Users/dalla/wildlight/.review/vintage-wall";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet",  width: 820,  height: 1180 },
  { name: "mobile",  width: 390,  height: 844 },
];
const PAGES = [
  { name: "home",   url: "/" },
  { name: "events", url: "/services/events" },
];
const MOODS = ["bone", "ink"];
console.log("hi");

async function setMood(page, mood) {
  await page.evaluate((m) => {
    document.documentElement.setAttribute("data-mood", m);
    try { localStorage.setItem("wl-mood", m); } catch(e) {}
  }, mood);
  await page.waitForTimeout(150);
}

(async () => {
  const browser = await chromium.launch();
  const findings = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => findings.push("[PAGE ERR " + vp.name + "] " + e.message));
    page.on("console", (m) => {
      if (m.type() === "error") findings.push("[CONSOLE " + vp.name + "] " + m.text());
    });

    for (const mood of MOODS) {
      for (const p of PAGES) {
        await page.goto("http://localhost:3000" + p.url, { waitUntil: "networkidle", timeout: 60000 });
        await setMood(page, mood);
        await page.waitForTimeout(500);
        const fname = p.name + "-" + vp.name + "-" + mood + ".png";
        await page.screenshot({ path: path.join(OUT, fname), fullPage: true });
        console.log("[OK]", fname);
      }
    }

    for (const mood of MOODS) {
      await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
      await setMood(page, mood);
      await page.waitForTimeout(400);
      const availSel = ".wl-wall-item:has(.wl-wall-dot)";
      const anyTile = ".wl-wall-item";
      const target = (await page.locator(availSel).count()) > 0 ? availSel : anyTile;
      await page.locator(target).first().click();
      await page.waitForSelector(".wl-lightbox", { timeout: 5000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, "lightbox-open-" + vp.name + "-" + mood + ".png"), fullPage: false });
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, "lightbox-next-" + vp.name + "-" + mood + ".png"), fullPage: false });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const stillOpen = await page.locator(".wl-lightbox").count();
      findings.push("[esc-closes " + vp.name + " " + mood + "] " + (stillOpen === 0 ? "OK closed" : "FAIL still open"));
      const ov = await page.evaluate(() => document.body.style.overflow);
      findings.push("[scroll-restored " + vp.name + " " + mood + "] body.overflow=" + ov);
      const active = await page.evaluate(() => {
        const a = document.activeElement;
        return a ? { tag: a.tagName, cls: (a.className || "").toString().slice(0,80) } : null;
      });
      findings.push("[focus-after-close " + vp.name + " " + mood + "] " + JSON.stringify(active));
    }

    await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
    await setMood(page, "bone");
    await page.waitForTimeout(300);
    let tabs = 0; let landed = false;
    while (tabs < 40) {
      await page.keyboard.press("Tab");
      tabs++;
      const onWall = await page.evaluate(() => document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("wl-wall-item"));
      if (onWall) { landed = true; break; }
    }
    findings.push("[kbd-tab-to-wall " + vp.name + "] tabs=" + (landed ? tabs : "never"));
    if (landed) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(400);
      const opened = await page.locator(".wl-lightbox").count();
      findings.push("[kbd-enter-opens " + vp.name + "] " + (opened ? "OK" : "FAIL"));
      if (opened) {
        const focusInLb = await page.evaluate(() => {
          const lb = document.querySelector(".wl-lightbox");
          return lb ? lb.contains(document.activeElement) : false;
        });
        findings.push("[focus-inside-lightbox " + vp.name + "] " + focusInLb);
        const focusedTag = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
        findings.push("[focus-elem " + vp.name + "] " + focusedTag);
        await page.keyboard.press("Tab");
        await page.waitForTimeout(120);
        const focusStillInLb = await page.evaluate(() => {
          const lb = document.querySelector(".wl-lightbox");
          return lb ? lb.contains(document.activeElement) : false;
        });
        findings.push("[focus-trap-after-tab " + vp.name + "] " + focusStillInLb);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
    }
