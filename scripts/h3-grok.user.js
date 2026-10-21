// ==UserScript==
// @name         H3 Studio → Grok
// @namespace    h3-studio
// @version      1.1
// @description  Lets the H3 Studio write prompts with your own Grok tab: picks up the Studio's requests, types them into Grok, sends Grok's reply back.
// @match        https://grok.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  "use strict";
  const POLL_MS = 3000;
  const REPLY_TIMEOUT_MS = 8 * 60 * 1000;
  const QUIET_MS = 4000; // the reply counts as finished when it hasn't changed for this long and Grok shows no Stop button

  // ---- connection: the Studio opens this tab as https://grok.com/#h3=<link + token>
  const m = location.hash.match(/[#&]h3=([^&]+)/);
  if (m) {
    try {
      const c = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")))));
      if (c.url && c.token) { GM_setValue("conn", c); }
    } catch (e) { console.warn("[H3] bad connect link", e); }
    history.replaceState(null, "", location.pathname + location.search);
  }
  const conn = () => GM_getValue("conn", null);

  // ---- little status badge, bottom left
  const badge = document.createElement("div");
  badge.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;font:12px/1.3 system-ui,sans-serif;padding:6px 10px;border-radius:8px;background:#1d1d22;color:#ddd;border:1px solid #444;box-shadow:0 2px 10px #0006;max-width:340px;cursor:default";
  const say = (t, tone) => { badge.textContent = "H3 Studio · " + t; badge.style.borderColor = tone === "bad" ? "#c0392b" : tone === "busy" ? "#d4a017" : tone === "good" ? "#27ae60" : "#444"; };
  (document.body || document.documentElement).appendChild(badge);
  say(conn() ? "waiting for prompts" : "not connected — open Grok from the Studio's panel (Connect Grok tab)", conn() ? "" : "bad");

  const req = (method, path, body) => new Promise((resolve, reject) => {
    const c = conn();
    if (!c) return reject(new Error("not connected"));
    GM_xmlhttpRequest({
      method, url: c.url.replace(/\/$/, "") + path, headers: { "X-H3-Token": c.token, "Content-Type": "application/json" },
      data: body ? JSON.stringify(body) : undefined, timeout: 20000,
      onload: (r) => r.status >= 200 && r.status < 300 ? resolve(r.responseText ? JSON.parse(r.responseText) : {}) : reject(new Error(r.status === 403 ? "the rental changed — open Grok again from the Studio" : "HTTP " + r.status)),
      onerror: () => reject(new Error("can't reach the rental")), ontimeout: () => reject(new Error("the rental didn't answer")),
    });
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

  // ---- Grok's page (found by shape, not by exact class names, so small site changes don't break it)
  function findInput() {
    const cands = [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(visible);
    // the chat box: the biggest visible one near the bottom
    cands.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    return cands[0] || null;
  }
  function findSend(input) {
    const btns = [...document.querySelectorAll("button")].filter(visible);
    const byLabel = btns.find((b) => /^(submit|send)\b/i.test((b.getAttribute("aria-label") || "").trim()) || b.type === "submit");
    if (byLabel) return byLabel;
    // otherwise the last button inside the same form/box as the input
    const box = input && (input.closest("form") || input.parentElement?.parentElement?.parentElement);
    const inBox = box ? [...box.querySelectorAll("button")].filter(visible) : [];
    return inBox[inBox.length - 1] || null;
  }
  const stopShown = () => [...document.querySelectorAll("button")].some((b) => visible(b) && /stop/i.test(b.getAttribute("aria-label") || b.textContent || ""));

  async function typeInto(input, text) {
    input.focus();
    if (input.tagName === "TEXTAREA") {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      // rich editor: paste it (keeps line breaks), else insert it as typed text
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      await sleep(300);
      if ((input.innerText || "").trim().length < Math.min(40, text.length / 2)) document.execCommand("insertText", false, text);
    }
    await sleep(500);
    const got = input.tagName === "TEXTAREA" ? input.value : input.innerText;
    if ((got || "").trim().length < Math.min(40, text.length / 2)) throw new Error("couldn't type into Grok's chat box");
  }

  // the newest block of text on the page that holds the reply (Grok is told to start with "ANSWER 1")
  function replyText(prompt) {
    const head = prompt.slice(0, 80);
    let best = "";
    for (const el of document.querySelectorAll(".message-bubble, [class*='message'], [class*='response'], article, .prose, [data-testid*='message']")) {
      const t = (el.innerText || "").trim();
      if (!/answer\s*1\b/i.test(t) || t.includes(head) || t.includes("### REQUEST 1")) continue;
      // prefer the smallest element that still has the whole reply (no page chrome)
      if (!best || t.length < best.length || !/answer\s*1\b/i.test(best)) best = t;
    }
    return best;
  }

  // ---- pictures: fetched from the rental (token-checked) and put into Grok's own upload box, as if you'd picked them
  const fetchPic = (pic) => new Promise((resolve, reject) => {
    const c = conn();
    GM_xmlhttpRequest({
      method: "GET", url: c.url.replace(/\/$/, "") + pic.url, headers: { "X-H3-Token": c.token }, responseType: "blob", timeout: 60000,
      onload: (r) => r.status === 200 ? resolve(new File([r.response], pic.name || "picture.png", { type: (r.response && r.response.type) || "image/png" })) : reject(new Error("couldn't fetch a picture (" + r.status + ")")),
      onerror: () => reject(new Error("couldn't fetch a picture")), ontimeout: () => reject(new Error("fetching a picture took too long")),
    });
  });
  const thumbs = () => document.querySelectorAll("form img, [class*='attachment'] img, [class*='upload'] img, [data-testid*='attachment'] img").length;
  async function attach(files, input) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    const before = thumbs();
    const box = [...document.querySelectorAll('input[type="file"]')].find((i) => !i.accept || /image|\*/.test(i.accept));
    if (box) {
      box.files = dt.files;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // no upload box found: paste them into the chat box instead
      input.focus();
      input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }
    // wait until the thumbnails are in (uploads finished) — at most ~40 s
    for (let i = 0; i < 80; i++) { await sleep(500); if (thumbs() >= before + files.length) break; }
    await sleep(1500);
    if (thumbs() < before + files.length) throw new Error("Grok didn't take the pictures");
  }

  async function run(job) {
    say("writing a prompt…", "busy");
    // a fresh chat for every request, so old prompts don't leak into new ones
    if (/\/c\//.test(location.pathname) || /\/chat\//.test(location.pathname)) {
      GM_setValue("job", job);
      location.href = "https://grok.com/";
      return;
    }
    let input = null;
    for (let i = 0; i < 30 && !input; i++) { input = findInput(); if (!input) await sleep(500); }
    if (!input) throw new Error("couldn't find Grok's chat box — are you logged in?");
    if (job.images && job.images.length) {
      say("attaching " + job.images.length + " picture" + (job.images.length > 1 ? "s" : "") + "…", "busy");
      const files = [];
      for (const pic of job.images) files.push(await fetchPic(pic));
      await attach(files, input);
      input = findInput() || input;
    }
    await typeInto(input, job.text);
    let send = null;
    for (let i = 0; i < 20; i++) { send = findSend(input); if (send && !send.disabled) break; await sleep(300); }
    if (send && !send.disabled) send.click();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));

    const t0 = Date.now();
    let last = "", since = Date.now();
    while (Date.now() - t0 < REPLY_TIMEOUT_MS) {
      await sleep(1000);
      const t = replyText(job.text);
      if (t !== last) { last = t; since = Date.now(); continue; }
      if (t && !stopShown() && Date.now() - since > QUIET_MS) return t;
    }
    if (last) return last;
    throw new Error("Grok didn't reply within 8 minutes");
  }

  let busy = false;
  async function tick() {
    if (busy || !conn()) return;
    busy = true;
    let job = GM_getValue("job", null);
    try {
      if (job) GM_deleteValue("job");
      else job = await req("GET", "/grok-relay/next");
    } catch (e) { say(e.message, "bad"); busy = false; return; }
    if (!job || !job.id) { say("connected · waiting for prompts", "good"); busy = false; return; }
    try {
      const text = await run(job);
      if (text === undefined) return; // going to a fresh chat; picks up again after the page loads
      await req("POST", "/grok-relay/answer", { id: job.id, text });
      say("sent the reply back ✓", "good");
    } catch (e) {
      say(e.message, "bad");
      try { await req("POST", "/grok-relay/answer", { id: job.id, error: "Grok tab: " + e.message }); } catch (_) { /* rental gone */ }
    }
    busy = false;
  }
  setInterval(tick, POLL_MS);
  setTimeout(tick, 1500);
})();
