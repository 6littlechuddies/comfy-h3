// Edit chat routing rules: which route each message takes, and how @names become each model's words.
//   npx tsx scripts/test-chat-routes.mts
import type { ChatPic } from "../src/lib/chatwords";
const { routeOf, wordsFor } = await import("../src/lib/chatwords");
const pin: ChatPic = { key: "pinterest", name: "pin.png", url: "", label: "pinterest" };
const faery: ChatPic = { key: "faery", name: "faery.png", url: "", label: "Faery333", charId: "c1" };
const sweater: ChatPic = { key: "sweater", name: "sw.png", url: "", label: "sweater" };
const cur: ChatPic = { key: "step1", name: "cur.png", url: "", label: "step 1" };
const cases: [string, ChatPic[], string][] = [
  ["@faery replaces the woman in @pinterest", [faery], "auto"],
  ["her right hand: open, palm up", [], "auto"],
  ["keep the clothes from @pinterest", [pin], "auto"],
  ["@sweater on her, keep the background", [sweater], "auto"],
  ["put the @sweater on her and make her sit on the bed", [sweater], "auto"],
  ["a realistic bedroom background, warm lamp light", [], "auto"],
  ["make her laugh", [], "auto"],
  ["make her laugh", [], "hybrid"],
  ["@sweater and @pinterest's shoes on her", [sweater, pin], "auto"],
  ["@sweater on her", [sweater], "auto"],
  ["@sweater on her", [sweater], "krea"],
  ["use @bedroom as the background", [{ key: "bedroom", name: "b.png", url: "", label: "bedroom" }], "auto"],
  ["don't change the background, make her smile", [], "auto"],
  ["her hand is wrong, open palm", [], "auto"],
];
for (const [t, refs, eng] of cases) { const r = routeOf(t, refs, eng as "auto", true); console.log(`${r.route.padEnd(10)} ${r.part ?? ""} | ${t}`); }
const all = [pin, faery, sweater, cur];
console.log("krea:", wordsFor("keep the clothes from @pinterest", all, [cur, pin], "krea"));
console.log("qwen:", wordsFor("@faery replaces the woman in @pinterest", all, [pin, faery], "qwen"));
console.log("qwen3:", wordsFor("@sweater on @faery", all, [cur, faery, sweater], "qwen"));
