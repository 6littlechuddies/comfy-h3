// The writer's JSON answers, read leniently: models often put a plain " inside a string ("the "Thousand Sunny" deck"),
// leave a trailing comma, forget a comma between two items, wrap it in ``` fences or stop before the last bracket.

/** the first {...} object in the text (balanced, strings respected) — or everything from the first { if it never closes */
function firstObject(text: string): string | null {
  const s = text.indexOf("{");
  if (s < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = s; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) return text.slice(s, i + 1); }
  }
  return text.slice(s);
}

/** a " inside a string that isn't followed by , } ] or : is part of the text: escape it; raw newlines in strings too */
function escapeInnerQuotes(t: string): string {
  let out = "", inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (!inStr) { if (c === '"') inStr = true; out += c; continue; }
    if (esc) { esc = false; out += c; continue; }
    if (c === "\\") { esc = true; out += c; continue; }
    if (c === "\n") { out += "\\n"; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < t.length && /\s/.test(t[j])) j++;
      const nx = t[j];
      if (nx === undefined || nx === "," || nx === "}" || nx === "]" || nx === ":") { inStr = false; out += c; }
      else out += '\\"';
      continue;
    }
    out += c;
  }
  return out;
}

/** close whatever was left open (an answer cut off at the token limit): the open string, then the brackets */
function closeOpen(t: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const c of t) {
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") stack.pop();
  }
  let out = t + (inStr ? '"' : "");
  out = out.replace(/,\s*$/, "").replace(/:\s*$/, ': ""');
  return out + stack.reverse().join("");
}

const tidy = (t: string) => t
  .replace(/,\s*([}\]])/g, "$1")                       // trailing commas
  .replace(/([}\]"])\s*\n\s*(["{[])/g, "$1,\n$2")       // a missing comma between items on separate lines
  .replace(/}\s*{/g, "},{");                            // two objects side by side

/** JSON.parse that survives the usual writer slips; throws a plain message when there's nothing to read */
export function looseJson<T = Record<string, unknown>>(raw: string): T {
  const text = raw.replace(/```(?:json)?/gi, "");
  const obj = firstObject(text);
  if (!obj) throw new Error("The writer didn't answer in the expected format — try again");
  const tries = [obj, tidy(obj), tidy(escapeInnerQuotes(obj)), closeOpen(tidy(escapeInnerQuotes(obj))), tidy(closeOpen(escapeInnerQuotes(obj)))];
  let err: Error | null = null;
  for (const t of tries) {
    try { return JSON.parse(t) as T; } catch (e) { err ??= e as Error; }
  }
  throw new Error(`The writer's answer wasn't readable (${err?.message ?? "bad JSON"}) — Research again`);
}
