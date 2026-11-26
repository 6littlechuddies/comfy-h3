/**
 * Exact browser-safe mirror of UrGF's production Studio Pack Trigger Router,
 * Photo Delivery Mode, Haggling Engine, and Simulated Credit Wallet
 * (`UrGFOrg/UrGF`: packTrigger.ts + haggle.ts + photo.ts + chatSimulator.ts),
 * mapped directly onto H3 Studio's local `Character.site.sets`.
 */
import { viewUrl, type FileRef } from "./api";
import type { Character, SiteSet } from "./characters";

export type ContentRating = "sfw" | "suggestive" | "explicit";

export const PACK_KEYS = [
  "v9-selfies",
  "v9-lingerie_thighs",
  "v9-boobs_ass_doggy",
  "v9-explicit_solo",
  "v9-cuckold",
] as const;

export type PackKey = (typeof PACK_KEYS)[number];

export const PACK_KEY_ALIASES: Record<PackKey, readonly string[]> = {
  "v9-selfies": ["v9-selfies", "off-duty", "casual", "selfies", "sfw"],
  "v9-lingerie_thighs": ["v9-lingerie_thighs", "lingerie_thighs", "lingerie", "thighs"],
  "v9-boobs_ass_doggy": ["v9-boobs_ass_doggy", "boobs_ass_doggy", "boobs_ass", "topless"],
  "v9-explicit_solo": ["v9-explicit_solo", "explicit_solo", "solo", "nude", "explicit"],
  "v9-cuckold": ["v9-cuckold", "cuckold", "bbc", "interracial", "voyeur"],
};

export const PACK_MIN_RATING: Record<PackKey, ContentRating> = {
  "v9-selfies": "sfw",
  "v9-lingerie_thighs": "suggestive",
  "v9-boobs_ass_doggy": "explicit",
  "v9-explicit_solo": "explicit",
  "v9-cuckold": "explicit",
};

const RATING_RANK: Record<ContentRating, number> = { sfw: 0, suggestive: 1, explicit: 2 };
const ratingWithinCap = (rating: ContentRating, maxRating: ContentRating) => RATING_RANK[rating] <= RATING_RANK[maxRating];

export function normalizePackKey(raw: string | undefined | null): PackKey | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  for (const canonical of PACK_KEYS) {
    if (PACK_KEY_ALIASES[canonical].includes(key)) return canonical;
  }
  return null;
}

/** Handles both clean keys (`v9-lingerie_thighs`) and Studio prefixed keys (`premium-v9-lingerie_thighs-1795690494`) */
export function packKeyOfSet(setKey: string): PackKey | null {
  const direct = normalizePackKey(setKey);
  if (direct !== null) return direct;
  const core = setKey
    .trim()
    .toLowerCase()
    .replace(/^(free|premium)-/, "")
    .replace(/-\d+$/, "");
  return normalizePackKey(core);
}

export function normalizeTriggerText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[áàâä]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[íìîï]/g, "i")
    .replace(/[óòôö]/g, "o")
    .replace(/[úùûü]/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}

const HYPER_CUSTOM_PATTERN = new RegExp(
  [
    String.raw`\b(?:on mars|en marte|on the moon|en la luna|outer space|spaceship|astronaut\w*|alien\w*|extraterrestre\w*|dragon\w*|unicorn\w*|zombie\w*|vampire\w*|vampir[oa]|wizard|hechicero|medieval|knight|caballero|pirate|pirata|samurai|ninja|cowboy|vaquer[oa]|superhero\w*|superheroe|cosplay\w*|costume|disfraz\w*|clown|payas[oa]|robot\w*|cyborg|mermaid|sirena|elf|fairy|hada|witch|bruja)\b`,
    String.raw`\b(?:skateboard\w*|patineta|surfboard|tabla de surf|snowboard\w*|motorcycle|motocicleta|helicopter\w*|airplane|avion|submarine|submarino|jet\s*ski|skydiv\w*|paracaidas|sword|espada|lightsaber|sable de luz|guitar\w*|piano|violin|fishing|pescando|bowling|soccer|futbol|basketball|baloncesto|tennis|tenis|hockey|boxing|boxeando|horseback|caballo)\b`,
    String.raw`\b(?:holding a sign|with a sign|con un cartel|sosteniendo un cartel|written on|escrito en|says ["']|que diga|happy birthday|feliz cumple\w*|my name on|mi nombre en)\b`,
    String.raw`\b(?:eiffel tower|torre eiffel|pyramids?|piramides?|underwater|bajo el agua|volcano|volcan|jungle|selva|antarctica|antartida|desert|desierto|supermarket|supermercado|airport|aeropuerto|hospital|subway|metro station|courtroom|prison|carcel)\b`,
  ].join("|"),
  "i",
);

export const isHyperCustomPrompt = (raw: string) => {
  const text = normalizeTriggerText(raw);
  return text !== "" && HYPER_CUSTOM_PATTERN.test(text);
};

const SPANISH_BLACK_COLOR_CLOTHING =
  /\b(?:brasier|sosten|sujetador|vestido|top|bikini|corset|corse|body|conjunto|hilo|encaje|short|pantalon|cuarto|cabello|pelo|lipstick|labial|esmalte|zapato|tacon|abrigo|sueter|sweater|camiseta|collar|choker|lazo|cinturon|color)\s+negro\b/i;

const CUCKOLD_PATTERN = new RegExp(
  [
    String.raw`\b(?:cuckold\w*|cuck(?:ing|ed)?|bbc|hotwife|interracial|voyeur\w*|mandingo|bull)\b`,
    String.raw`\b(?:black\s+(?:guy|man|dude|lover|bull|cock|dick)|another\s+(?:guy|man|dude)|other\s+(?:guy|man))\b`,
    String.raw`\b(?:cheating(?:\s+on)?|watching\s+(?:you|her)\s+(?:with|get|fuck|ride)|watch\s+(?:you|me\s+watch)|share\s+you|sharing\s+you)\b`,
    String.raw`\b(?:cornud[oa]s?|otro\s+(?:hombre|tipo|chico|vato|macho)|enga[nñ]a(?:ndo|me|r)?|infiel|mirando(?:\s+como)?|ver\s+como\s+te|compartirte|esposa\s+caliente)\b`,
    String.raw`\b(?:un\s+negro|chico\s+negro|hombre\s+negro|tipo\s+negro|con\s+(?:un\s+)?negro|verga\s+negra|polla\s+negra|pene\s+negro)\b`,
  ].join("|"),
  "i",
);

const STANDALONE_NEGRO = /\bnegro\b/i;

const EXPLICIT_SOLO_PRIMARY = new RegExp(
  [
    String.raw`\b(?:pussy|vagina|clit(?:oris)?|masturbat\w*|finger(?:ing|ed)?|dildo\w*|vibrator\w*|sex\s+toy)\b`,
    String.raw`\b(?:spread(?:ing)?(?:\s+(?:your|her|those|my))?(?:\s+(?:legs|pussy|lips|wide|open))?|open\s+(?:your|her)\s+legs)\b`,
    String.raw`\b(?:touch(?:ing)?\s+(?:yourself|herself)|play(?:ing)?\s+with\s+(?:yourself|herself|your\s+pussy)|rub(?:bing)?\s+(?:yourself|herself|your\s+clit|your\s+pussy))\b`,
    String.raw`\b(?:cum(?:ming)?|orgasm\w*|squirt\w*)\b`,
    String.raw`\b(?:so\s+wet|how\s+wet|wet\s+pussy|get(?:ting)?\s+wet|all\s+wet)\b`,
    String.raw`\b(?:panocha|co[nñ]o|concha|cuca|chocho|clitoris|masturb\w*|tocandote|tocarte|tocandose|dede\w*|consolador|vibrador|juguete\s+sexual)\b`,
    String.raw`\b(?:metiendote\s+(?:los\s+)?dedos|con\s+(?:los\s+)?dedos|tus\s+dedos|\bdedos\b|abriendo\s+(?:las\s+)?piernas|bien\s+abierta|mojada|humeda)\b`,
  ].join("|"),
  "i",
);

const STANDALONE_WET = /\bwet\b/i;
const NON_EXPLICIT_WET = /\bwet\s+(?:hair|t-?shirt|shirt|dress|bikini|swimsuit|skin\s+after)\b/i;

const BOOBS_ASS_DOGGY_PATTERN = new RegExp(
  [
    String.raw`\b(?:boobs?|tits?|titties|breasts?|nipples?|topless|braless|no\s+bra|without\s+(?:a\s+)?bra|bare\s+chest)\b`,
    String.raw`\b(?:ass|booty|butt|bum|doggy(?:\s*style)?|bent\s+over|bend\s+over|on\s+all\s+fours|from\s+behind|rear\s+view|back\s+view|arch(?:ed|ing)?\s+(?:your|her)\s+back)\b`,
    String.raw`\b(?:tetas?|chichis?|pechos?|bubis?|senos?|pezon(?:es)?|sin\s+(?:brasier|sosten|bra|camisa|blusa))\b`,
    String.raw`\b(?:culo|nalgas?|pompas?|trasero|perrito|en\s+cuatro|en\s+4|de\s+espaldas|agachada|inclinada|desde\s+atras|por\s+detras)\b`,
  ].join("|"),
  "i",
);

const EXPLICIT_SOLO_NUDE = new RegExp(
  [
    String.raw`\b(?:nude\w*|naked|completely\s+naked|fully\s+nude|explicit|solo|show\s+(?:me\s+)?everything|all\s+of\s+you)\b`,
    String.raw`\b(?:desnud[ao]s?|encuerad[ao]s?|sin\s+ropa|sin\s+nada|ense[nñ]ame\s+todo|muestrame\s+todo)\b`,
  ].join("|"),
  "i",
);

const LINGERIE_THIGHS_PATTERN = new RegExp(
  [
    String.raw`\b(?:lingerie|panties|underwear|undies|thong|g-string|thighs?|legs|stockings?|thigh\s*highs?|garter(?:\s*belt)?|fishnets?)\b`,
    String.raw`\b(?:bras?|bralette|corset|bodysuit|teddy|lace|slip\s+dress|sheer|see-?through|bikini|swimsuit)\b`,
    String.raw`\b(?:skirt\s*lift|lift(?:ing)?\s+(?:your|her)\s+skirt|mini\s*skirt|upskirt|cleavage|tease)\b`,
    String.raw`\b(?:(?:sexy|hot|spicy|naughty)\s+(?:pic|pics|photo|photos|picture|selfie|outfit))\b`,
    String.raw`\b(?:lenceria|bragas?|tangas?|calzones?|ropa\s+interior|muslos?|piernas?|medias?|liguero|brasier|sosten|sujetador|corse|encaje)\b`,
    String.raw`\b(?:falda|minifalda|levantando\s+la\s+falda|escote|traje\s+de\s+bano)\b`,
    String.raw`\b(?:foto\s+(?:sexy|rica|atrevida|picante|caliente))\b`,
  ].join("|"),
  "i",
);

const SELFIES_PATTERN = new RegExp(
  [
    String.raw`\b(?:selfie\w*|mirror\s+selfie|casual|off-?duty|outfit|fit\s+check|face|smile)\b`,
    String.raw`\b(?:cute|pretty|normal|sweet)\s+(?:pic|pics|photo|photos|picture|selfie)\b`,
    String.raw`\b(?:what\s+(?:are\s+you|r\s+u|u)\s+wearing|how\s+(?:do\s+)?you\s+look)\b`,
    String.raw`\b(?:send\s+(?:me\s+)?(?:a\s+|another\s+)?(?:pic|pics|photo|photos|picture|snap)|show\s+(?:me\s+)?(?:yourself|your\s+face|what\s+you\s+look\s+like)|(?:pic|photo|picture)\s+of\s+you|let\s+me\s+see\s+you|wanna\s+see\s+you|want\s+to\s+see\s+you|surprise\s+me)\b`,
    String.raw`\b(?:a\s+selfie\s+of\s+her|oversized\s+t-?shirt|sundress)\b`,
    String.raw`\b(?:foto\s+(?:normal|linda|bonita|casual|tuya)|una\s+foto)\b`,
    String.raw`\b(?:manda(?:me)?\s+(?:una\s+|otra\s+)?foto|envia(?:me)?\s+(?:una\s+|otra\s+)?foto|pasame\s+(?:una\s+|otra\s+)?foto)\b`,
    String.raw`\b(?:como\s+te\s+ves|como\s+eres|tu\s+cara|tu\s+rostro|tu\s+sonrisa|que\s+(?:traes|llevas|tienes)\s+puesto|quiero\s+verte|dejame\s+verte|sorprendeme|sorpresa)\b`,
  ].join("|"),
  "i",
);

export function matchPackTrigger(
  prompt: string,
  options?: { maxRating?: ContentRating },
): { setKey: PackKey; minRating: ContentRating } | null {
  const text = normalizeTriggerText(prompt);
  if (!text || isHyperCustomPrompt(text)) return null;

  let setKey: PackKey | null = null;
  if (CUCKOLD_PATTERN.test(text) || (STANDALONE_NEGRO.test(text) && !SPANISH_BLACK_COLOR_CLOTHING.test(text))) {
    setKey = "v9-cuckold";
  } else if (EXPLICIT_SOLO_PRIMARY.test(text) || (STANDALONE_WET.test(text) && !NON_EXPLICIT_WET.test(text))) {
    setKey = "v9-explicit_solo";
  } else if (BOOBS_ASS_DOGGY_PATTERN.test(text)) {
    setKey = "v9-boobs_ass_doggy";
  } else if (EXPLICIT_SOLO_NUDE.test(text)) {
    setKey = "v9-explicit_solo";
  } else if (LINGERIE_THIGHS_PATTERN.test(text)) {
    setKey = "v9-lingerie_thighs";
  } else if (SELFIES_PATTERN.test(text)) {
    setKey = "v9-selfies";
  }

  if (setKey === null) return null;
  const minRating = PACK_MIN_RATING[setKey];
  if (options?.maxRating && !ratingWithinCap(minRating, options.maxRating)) return null;
  return { setKey, minRating };
}

// --- Photo extraction & SFW vs Locked detection ---

export const FALLBACK_DESCRIPTION = "a selfie of her, the way she looks right now";
const SPICY_PHOTO =
  /\b(?:sex|sexy|fuck\w*|cock|dick|pussy|clit\w*|cum\w*|naked|nude\w*|tits?|boobs?|nipples?|horny|moan\w*|orgasm\w*|suck\w*|lick\w*|ride me|thrust\w*|strip(?:ping|ped|s|per|tease)?|panties|lingerie|spank\w*|explicit|grind\w*|topless|bottomless|braless|no bra|without a bra|bra|bras|bralette|underwear|undies|thong|g-string|bikini|swimsuit|corset|stockings|garter|fishnet|see-?through|sheer|translucent|unbuttoned|undressed|undressing|unclothed|breasts?|cleavage|ass|booty|bent over|spread(?:ing)?\s+(?:her\s+)?legs|in the shower|nothing underneath|nothing under|covered only)\b|\blace\s+(?:set|teddy|bodysuit|bra|briefs|knickers|undies)\b|\bbare\s+(?:chest|breasts?|skin|ass|butt|body)\b|\btowel\s+(?:wrapped|dropped|falling)\b/i;

export const isSfwPhotoDescription = (description: string) => !SPICY_PHOTO.test(description);

export function extractPhotoFromBubbles(bubbles: readonly string[]): {
  photoDescription: string | null;
  textBubbles: string[];
} {
  let photoDescription: string | null = null;
  const textBubbles: string[] = [];
  for (const raw of bubbles) {
    const match = /\[\s*(?:photo|pic|picture|selfie)\s*(?::|-)\s*([^\]]+)\]/i.exec(raw);
    if (match) {
      if (photoDescription === null) photoDescription = match[1].trim() || FALLBACK_DESCRIPTION;
      const rest = raw.replace(match[0], "").trim();
      if (rest) textBubbles.push(rest);
    } else if (/^\[\s*(?:photo|pic|picture|selfie)\s*\]$/i.test(raw.trim())) {
      if (photoDescription === null) photoDescription = FALLBACK_DESCRIPTION;
    } else {
      textBubbles.push(raw);
    }
  }
  return { photoDescription, textBubbles };
}

// --- Haggling Engine (exact mirror of UrGF convex/model/haggle.ts) ---

export type HaggleDecision = {
  verdict: "agree" | "accept" | "counter" | "lowest";
  ask: number;
  offered: number | null;
  rounds: number;
};

export function floorPrice(priceCredits: number, maxDiscountPct: number): number {
  return Math.max(1, Math.ceil((priceCredits * (100 - maxDiscountPct)) / 100));
}

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
const NUMBER_WORD = new RegExp(`\\b(?:${Object.keys(NUMBER_WORDS).join("|")})\\b`, "g");
const UNIT = String.raw`(?:credits?|tokens?|tks?|coins?)\b`;
const NOT_A_PRICE = /^\s*(?:min|mins|minutes?|hrs?|hours?|secs?|seconds?|am\b|pm\b|a\.m|p\.m|o'?clock|inch|inches|in\b|"|cm|mm|ft|feet|foot|kg|kgs|lbs?|pounds?|years?|yrs?|yo\b|y\/o|days?|weeks?|months?|times?|x\b|th\b|st\b|nd\b|rd\b|k\b|m\b|miles?|km|degrees?|\/)/;
const PRICE_PHRASE = /\b(?:for|do|make it|how about|what about|would you take|will you take|you take|take|i'?ll pay|pay|i'?ll give you|give you|offer|deal at|deal for|only|just|ok|okay|fine|counter)\s+(\d{1,4})\b/g;
const PERCENT_OFF = /\b(\d{1,2})\s*(?:%|percent)\s*(?:off|discount)|\bdiscount\s+of\s+(\d{1,2})\s*(?:%|percent)/;
const HALF = /\bhalf\s+(?:price|off)\b|\bhalf\s+(?:of\s+)?(?:that|it)\b|\bfor\s+half\b|\bhalf\s*\?/;
const FREE = /\b(?:for|it|be)\s+free\b|\bfor\s+nothing\b|^\s*free\s*\?*\s*$/;
const BARE = /^\s*\$?\s*(\d{1,4})(?:\s*(?:\?|!|\.|pls|plz|please))*\s*$/;
const CHEAPER = /\b(?:cheaper|discount|lower\s+(?:it|that|the\s+price|your\s+price|the\s+cost)|lower\s+price|go\s+lower|any\s+lower|come\s+down|too\s+(?:expensive|pricey|steep|high)|(?:so|that'?s|thats|its|it'?s|kinda|bit|way)\s+(?:too\s+)?expensive|(?:that'?s|thats|its|it'?s|way|bit|kinda|little)\s+too\s+much|too\s+much(?=\s*\?)|too\s+much\s+for|best\s+price|lowest\s+price|bargain|negotiate|haggle|knock\s+(?:some|a\s+few|a\s+bit|it)\s+(?:off|down))\b/;

export type Offer = { kind: "offer"; credits: number } | { kind: "cheaper" };

export function readOffer(message: string, ask: number): Offer | null {
  const text = message
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(NUMBER_WORD, (word) => String(NUMBER_WORDS[word]));
  if (FREE.test(text)) return { kind: "offer", credits: 0 };
  const percent = PERCENT_OFF.exec(text);
  if (percent) {
    const off = Number(percent[1] ?? percent[2]);
    return { kind: "offer", credits: Math.ceil((ask * (100 - off)) / 100) };
  }
  if (HALF.test(text)) return { kind: "offer", credits: Math.ceil(ask / 2) };
  const unit = new RegExp(String.raw`(\d{1,4})\s*${UNIT}`).exec(text);
  if (unit) return { kind: "offer", credits: Number(unit[1]) };
  const dollars = /\$\s*(\d{1,4})\b/.exec(text);
  if (dollars) return { kind: "offer", credits: Number(dollars[1]) };
  for (const match of text.matchAll(PRICE_PHRASE)) {
    const after = text.slice((match.index ?? 0) + match[0].length);
    if (!NOT_A_PRICE.test(after)) return { kind: "offer", credits: Number(match[1]) };
  }
  const bare = BARE.exec(text);
  if (bare) return { kind: "offer", credits: Number(bare[1]) };
  return CHEAPER.test(text) ? { kind: "cheaper" } : null;
}

export function haggle(
  state: { list: number; floor: number; ask: number; rounds: number },
  offer: Offer,
): HaggleDecision {
  const { floor, ask, rounds } = state;
  if (offer.kind === "cheaper") {
    if (ask <= floor) return { verdict: "lowest", ask: floor, offered: null, rounds };
    const next = Math.max(floor, ask - Math.ceil((ask - floor) / 2));
    return { verdict: next === floor ? "lowest" : "counter", ask: next, offered: null, rounds: rounds + 1 };
  }
  const offered = offer.credits;
  if (offered >= ask) return { verdict: "agree", ask, offered, rounds };
  if (ask <= floor) return { verdict: "lowest", ask: floor, offered, rounds };
  const middle = Math.ceil((offered + ask) / 2);
  if (offered >= floor) {
    if (rounds >= 1 || middle >= ask) return { verdict: "accept", ask: offered, offered, rounds: rounds + 1 };
    return { verdict: "counter", ask: middle, offered, rounds: rounds + 1 };
  }
  const next = Math.max(floor, middle);
  return { verdict: next === floor ? "lowest" : "counter", ask: next, offered, rounds: rounds + 1 };
}

const PRICE_IN_TEXT = new RegExp(String.raw`\b(\d{1,4})(\s*)(credits?|tokens?|tks?|coins?)\b`, "gi");
export function withPrice(text: string, price: number): string {
  return text.replace(PRICE_IN_TEXT, (match, value, space, word) => {
    if (Number(value) === price) return match;
    const singular = word.toLowerCase().replace(/s$/, "");
    const unit = price === 1 || singular === "tk" ? singular : `${singular}s`;
    return `${price}${space}${unit}`;
  });
}

export function hagglePhotoNote(locked: {
  description: string;
  ask: number;
  decision: HaggleDecision | null;
}): string {
  const decisionLine = (d: HaggleDecision) => {
    const asked = d.offered === null ? "They want it cheaper." : `They offered ${d.offered}.`;
    if (d.verdict === "agree") return `${asked} Your price is ${d.ask}, so it is theirs for ${d.ask}.`;
    if (d.verdict === "accept") return `${asked} You take it: it is theirs for ${d.ask} now.`;
    if (d.verdict === "counter") return `${asked} Too low, but you come down to ${d.ask}.`;
    return `${asked} ${d.ask} is the lowest you go, and you say so.`;
  };
  return [
    `(note: locked photo: "${locked.description}", current price ${locked.ask}.`,
    "do not send another until they open it. haggling over it is fine.",
    ...(locked.decision ? [decisionLine(locked.decision)] : []),
    `if you name the price, say just "${locked.ask}" once — never say credits or tokens, never name another number, never give it away free.)`,
  ].join(" ");
}

// --- Local H3 Studio Sets + Simulated Credit Wallet ---

export type SimPlan = "trial" | "guest" | "regular" | "resident" | "keyholder";
export const SIM_PLAN_IMAGES: Record<SimPlan, number> = {
  trial: 0, guest: 0, regular: 100, resident: 400, keyholder: 1500,
};

export type SimViewer = {
  plan: SimPlan;
  credits: number;
  planImagesLeft: number;
};

export type LocalSimItem = {
  id: string;
  file: FileRef;
  url: string;
  kind: "image" | "video";
  rating: ContentRating;
};

export type LocalSimSet = {
  id: string;
  setKey: string;
  packKey: PackKey | null;
  title: string;
  tier: "free" | "premium";
  priceCredits: number;
  items: LocalSimItem[];
};

const isVideoName = (name: string) => /\.(mp4|webm|mov|gif)$/i.test(name);

/** Converts H3 Studio's `Character.site.sets` into routable local sets */
export function localSetsFor(c: Character): LocalSimSet[] {
  const raw: SiteSet[] = c.site?.sets ?? [];
  return raw.map((set, idx) => {
    const packKey = packKeyOfSet(set.set_key);
    const defaultPrice = set.tier === "free" ? 0 : Math.max(10, Math.round((set.price ?? 4.99) * 10));
    return {
      id: `${idx}:${set.set_key}`,
      setKey: set.set_key,
      packKey,
      title: set.title || set.set_key,
      tier: set.tier,
      priceCredits: defaultPrice,
      items: (set.items ?? [])
        .filter((it) => !!it.filename)
        .map((it, itemIdx) => ({
          id: `${set.set_key}:${itemIdx}:${it.subfolder ?? ""}/${it.filename}`,
          file: it,
          url: viewUrl(it),
          kind: isVideoName(it.filename) ? "video" : "image",
          rating: it.rating ?? set.rating ?? (packKey ? PACK_MIN_RATING[packKey] : "sfw"),
        })),
    };
  });
}

export function simChargePhoto(
  viewer: SimViewer,
  price: number,
): { ok: true; paidFrom: "plan" | "credits"; credits: number; nextViewer: SimViewer } | { ok: false; reason: string } {
  if (viewer.plan === "trial") return { ok: false, reason: "Create a free account to see her photo." };
  if (price <= 0) return { ok: true, paidFrom: "credits", credits: 0, nextViewer: viewer };
  if (viewer.planImagesLeft > 0) {
    return { ok: true, paidFrom: "plan", credits: 0, nextViewer: { ...viewer, planImagesLeft: viewer.planImagesLeft - 1 } };
  }
  if (viewer.credits >= price) {
    return { ok: true, paidFrom: "credits", credits: price, nextViewer: { ...viewer, credits: viewer.credits - price } };
  }
  return { ok: false, reason: `That photo is ${price} credits and you have ${viewer.credits}.` };
}

export type LocalPhotoResolution =
  | {
      source: "studio_pack";
      packKey: PackKey;
      setId: string;
      setTitle: string;
      setKey: string;
      item: LocalSimItem;
      reason: string;
    }
  | {
      source: "wiro_fallback";
      matchedPackKey: PackKey | null;
      hyperCustom: boolean;
      maxRating: ContentRating;
      reason: string;
    };

function pickItem(
  sets: readonly LocalSimSet[],
  packKey: PackKey,
  shownIds: ReadonlySet<string>,
  maxRating: ContentRating,
  fallbackFreeSfw = false,
): LocalPhotoResolution | null {
  const aliases = PACK_KEY_ALIASES[packKey];
  const exact: LocalSimSet[] = [];
  const aliased: LocalSimSet[] = [];
  const freeFallback: LocalSimSet[] = [];
  for (const s of sets) {
    const key = s.setKey.trim().toLowerCase();
    if (key === packKey || s.packKey === packKey) exact.push(s);
    else if (aliases.includes(key)) aliased.push(s);
    else if (fallbackFreeSfw && packKey === "v9-selfies" && s.tier === "free") freeFallback.push(s);
  }
  for (const set of [...exact, ...aliased, ...freeFallback]) {
    const item = set.items.find(
      (entry) => entry.kind === "image" && !shownIds.has(entry.id) && ratingWithinCap(entry.rating, maxRating),
    );
    if (item) {
      return {
        source: "studio_pack",
        packKey,
        setId: set.id,
        setTitle: set.title,
        setKey: set.setKey,
        item,
        reason: `Matched ${packKey} -> local set "${set.title}" (${set.setKey})`,
      };
    }
  }
  return null;
}

export function resolveLocalFreeSfw(
  sets: readonly LocalSimSet[],
  shownIds: ReadonlySet<string>,
  description: string,
): LocalPhotoResolution {
  if (isHyperCustomPrompt(description)) {
    return { source: "wiro_fallback", matchedPackKey: null, hyperCustom: true, maxRating: "sfw", reason: "Hyper-custom scene -> Wiro fallback" };
  }
  return (
    pickItem(sets, "v9-selfies", shownIds, "sfw", true) ?? {
      source: "wiro_fallback",
      matchedPackKey: "v9-selfies",
      hyperCustom: false,
      maxRating: "sfw",
      reason: "No unshown SFW image in local v9-selfies/free sets -> Wiro fallback",
    }
  );
}

const SURPRISE_ORDER: readonly PackKey[] = [
  "v9-lingerie_thighs",
  "v9-selfies",
  "v9-boobs_ass_doggy",
  "v9-explicit_solo",
  "v9-cuckold",
];

export function resolveLocalPhotoTrigger(args: {
  sets: readonly LocalSimSet[];
  viewer: SimViewer;
  prompt: string;
  fallbackUserPrompt?: string;
  shownIds: ReadonlySet<string>;
  surprise?: boolean;
}): LocalPhotoResolution {
  const maxRating: ContentRating = args.viewer.plan === "trial" ? "suggestive" : "explicit";
  if (args.surprise) {
    const matched = matchPackTrigger(args.prompt, { maxRating });
    const order = [...(matched ? [matched.setKey] : []), ...SURPRISE_ORDER.filter((k) => k !== matched?.setKey)];
    for (const key of order) {
      if (!ratingWithinCap(PACK_MIN_RATING[key], maxRating)) continue;
      const hit = pickItem(args.sets, key, args.shownIds, maxRating);
      if (hit) return hit;
    }
    return { source: "wiro_fallback", matchedPackKey: null, hyperCustom: false, maxRating, reason: "No unshown local set items for Surprise -> Wiro fallback" };
  }

  let effective = args.prompt.trim();
  if ((!effective || effective.toLowerCase() === FALLBACK_DESCRIPTION.toLowerCase()) && args.fallbackUserPrompt?.trim()) {
    effective = args.fallbackUserPrompt.trim();
  }
  if (isHyperCustomPrompt(effective)) {
    return { source: "wiro_fallback", matchedPackKey: null, hyperCustom: true, maxRating, reason: "Hyper-custom scene/prop -> skips local sets, routes to Wiro" };
  }
  const uncapped = matchPackTrigger(effective);
  const capped = matchPackTrigger(effective, { maxRating });
  if (!uncapped) {
    return { source: "wiro_fallback", matchedPackKey: null, hyperCustom: false, maxRating, reason: "No pack trigger matched -> Wiro fallback" };
  }
  if (!capped) {
    return { source: "wiro_fallback", matchedPackKey: uncapped.setKey, hyperCustom: false, maxRating, reason: `Matched ${uncapped.setKey} but viewer cap is ${maxRating}` };
  }
  return (
    pickItem(args.sets, capped.setKey, args.shownIds, maxRating) ?? {
      source: "wiro_fallback",
      matchedPackKey: capped.setKey,
      hyperCustom: false,
      maxRating,
      reason: `Matched ${capped.setKey} but no unshown item in local sets -> Wiro fallback`,
    }
  );
}

export function findLocalPackUpsell(args: {
  unlocks: ReadonlyArray<{ packKey: PackKey; setId?: string; createdAt: number }>;
  sets: readonly LocalSimSet[];
  ownedSetIds: ReadonlySet<string>;
}): { set: LocalSimSet; packKey: PackKey; singleUnlocksInCategory: number } | null {
  if (!args.unlocks.length) return null;
  const byCat = new Map<PackKey, { count: number; latestAt: number; preferredSetId?: string }>();
  for (const u of args.unlocks) {
    const prev = byCat.get(u.packKey);
    if (!prev) byCat.set(u.packKey, { count: 1, latestAt: u.createdAt, preferredSetId: u.setId });
    else {
      prev.count += 1;
      if (u.createdAt >= prev.latestAt) {
        prev.latestAt = u.createdAt;
        if (u.setId) prev.preferredSetId = u.setId;
      }
    }
  }
  const ranked = [...byCat.entries()].sort((a, b) => b[1].latestAt - a[1].latestAt);
  const candidates = args.sets.filter((s) => s.tier === "premium" && !args.ownedSetIds.has(s.id) && s.items.length >= 2);
  for (const [packKey, stats] of ranked) {
    const hit =
      (stats.preferredSetId ? candidates.find((s) => s.id === stats.preferredSetId) : undefined) ??
      candidates.find((s) => s.packKey === packKey);
    if (hit) return { set: hit, packKey, singleUnlocksInCategory: stats.count };
  }
  return null;
}
