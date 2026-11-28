// Curated, identity-free Krea 2 photography, camera-geometry, selfie, mirror, sexy-cosplay, lingerie, and explicit
// pose blueprints distilled from 1,622 top-collected photorealistic CivitAI prompts across 60 creators (areyouokay,
// llikswonskcalb, prompt_bit_sorcerer, MrTeez, simonishere, KaosEngine, just_a_prompt_guy, nerdoo, etc.).
// Every blueprint describes camera placement, body geometry, hand placement, and light/mood ONLY — zero person
// identity, zero room lock — so it transfers cleanly onto ANY adult character without repeating samey poses.

export type BlueprintBankId =
  | "camera_glamour"
  | "mirror_choreo"
  | "raw_selfie"
  | "sexy_cosplay"
  | "lingerie_boudoir"
  | "explicit_positions";

export interface ShotBlueprint {
  id: string;
  bank: BlueprintBankId;
  name: string;
  /** adult intensity level: 0 clothed/flirty, 1 suggestive/lingerie, 2 bold/explicit solo, 3 explicit partner/extreme angle */
  level: 0 | 1 | 2 | 3;
  /** concise camera + pose + lighting blueprint (positive-only wording) */
  words: string;
}

export interface BlueprintBank {
  id: BlueprintBankId;
  label: string;
  short: string;
  hint: string;
}

export const BLUEPRINT_BANKS: BlueprintBank[] = [
  { id: "camera_glamour", label: "Camera Geometry & Glamour", short: "Glamour", hint: "Explicit shot height, 3/4 angles, men's-mag warmth, and flattering figure framing" },
  { id: "mirror_choreo", label: "Mirror & Micro-Choreography", short: "Mirror", hint: "Hip shift, waist twist, rear mirror glances, and over-the-shoulder choreography" },
  { id: "raw_selfie", label: "Raw Smartphone & Digicam Selfies", short: "Selfies", hint: "Arm's-length phone snaps, low-hip angles, and late-night on-camera flash" },
  { id: "sexy_cosplay", label: "Sexy Cosplay & Character Tease", short: "Cosplay", hint: "Flirty low/high angles, strap/zipper tease, and candid costume framing" },
  { id: "lingerie_boudoir", label: "Lingerie, Boudoir & Thighs", short: "Lingerie", hint: "Bralette, stockings, cleavage lean-in, bedside arches, and warm lamp light" },
  { id: "explicit_positions", label: "Explicit Solo & Partner POV", short: "Explicit", hint: "High-demand solo explicit poses, ass-up doggy invites, and clean partner POV angles" },
];

export const SHOT_BLUEPRINTS: ShotBlueprint[] = [
  // ── 1. Camera Geometry & Glamour (20) — areyouokay + KaosEngine style ─────────────────────────────
  { id: "cg01", bank: "camera_glamour", level: 0, name: "Waist-high 3/4 turn", words: "waist-up medium shot from a front three-quarter angle with the camera placed at waist height looking slightly upward, shoulders angled diagonally, one hand resting along her hip, chin dipped slightly with heavy-lidded eye contact into the lens" },
  { id: "cg02", bank: "camera_glamour", level: 0, name: "Low-angle knee-up hero", words: "low-angle knee-up shot taken from hip level looking up to elongate her silhouette, weight shifted onto one hip with the opposite knee softly bent forward, one hand sweeping hair behind her ear, warm golden practical rim light" },
  { id: "cg03", bank: "camera_glamour", level: 0, name: "Early-2000s glamour lean", words: "early-2000s men's-magazine glamour medium shot, leaning forward over a low ledge so her collarbone and waist curve toward the lens, warm tungsten highlight across her skin, glossy lips slightly parted in a slow knowing smirk" },
  { id: "cg04", bank: "camera_glamour", level: 0, name: "High-angle seated gaze", words: "high-angle shot from above eye level looking down as she sits on the edge of a chair with knees angled to one side, torso leaning slightly forward toward the camera, eyes looking straight up through her lashes" },
  { id: "cg05", bank: "camera_glamour", level: 0, name: "Side-profile curve check", words: "tight three-quarter side profile framed from mid-thigh up, chest lifted and lower back gently arched to accentuate her waist-to-hip curve, head turned sharply over her near shoulder to lock eyes with the lens" },
  { id: "cg06", bank: "camera_glamour", level: 0, name: "Doorframe silhouette lean", words: "full-body candid shot framed through a doorway, one forearm raised against the upper frame while her hip pops out toward the opposite side, opposite ankle crossed, warm side-window light tracing her curves" },
  { id: "cg07", bank: "camera_glamour", level: 0, name: "Table-edge seated lean-in", words: "chest-up seated shot from slightly across a table, leaning forward on both forearms with fingers loosely laced under her chin, shoulders rounded softly forward, intimate shallow-focus eye contact" },
  { id: "cg08", bank: "camera_glamour", level: 0, name: "Rear 3/4 walking glance", words: "rear three-quarter tracking shot caught mid-step as she walks away and glances back over her shoulder with a playful crooked smile, hair trailing in motion, camera placed at waist height" },
  { id: "cg09", bank: "camera_glamour", level: 1, name: "Low side close-up foreground", words: "low side-angle close shot with her face close in the foreground and her arched torso receding diagonally into depth, heavy-lidded eyes cut sideways into the camera, soft directional bedroom lamp glow" },
  { id: "cg10", bank: "camera_glamour", level: 1, name: "Staircase upward gaze", words: "low-angle shot from two steps below looking up as she pauses on a staircase, one hand trailing on the handrail and one hip cocked outward, looking down over her shoulder with a teasing half-smile" },
  { id: "cg11", bank: "camera_glamour", level: 1, name: "Countertop perched lean", words: "three-quarter medium-wide shot with her perched up on the edge of a counter, heels hooked below, hands planted beside her thighs pushing her chest forward, chin tilted down with playful eyes locked on the lens" },
  { id: "cg12", bank: "camera_glamour", level: 1, name: "Armchair draped legs", words: "angled editorial shot of her draped diagonally across an armchair, one leg slung casually over the padded armrest, torso reclined back with one arm overhead and head tipped toward the camera" },
  { id: "cg13", bank: "camera_glamour", level: 1, name: "Dutch-tilt bold stride", words: "subtle dutch-angle thigh-up shot leaning dynamically into the frame, thumbs hooked lightly along her waistband, shoulders twisted slightly so light catches her collarbone and waist" },
  { id: "cg14", bank: "camera_glamour", level: 1, name: "Window-sill backlight curve", words: "three-quarter shot seated sideways on a deep window sill, knees drawn up slightly toward her chest, warm late-afternoon backlight skimming her hair and shoulder while her face turns clearly toward the camera" },
  { id: "cg15", bank: "camera_glamour", level: 1, name: "Floor-level reclined diagonal", words: "camera resting near floor height shooting lengthwise along her body as she reclines on her side propped up on one elbow, top leg bent cleanly over the lower leg, free hand resting along her waist" },
  { id: "cg16", bank: "camera_glamour", level: 1, name: "Tight chin-to-waist glamour", words: "tight medium close-up framed from upper thighs to crown of head, back arched slightly, one hand lightly brushing her collarbone while her lips part softly in direct camera contact" },
  { id: "cg17", bank: "camera_glamour", level: 1, name: "Balcony twilight rail lean", words: "three-quarter rear-side shot leaning her torso forward over a railing at dusk, hips pushed gently back, head turned fully toward the lens with wind-blown hair strands and warm city glow behind" },
  { id: "cg18", bank: "camera_glamour", level: 0, name: "Car-door candid exit", words: "candid eye-level street snap as she steps out of a car doorway, one leg planted first, hand steadying the door edge, turning toward the camera mid-laugh in crisp natural daylight" },
  { id: "cg19", bank: "camera_glamour", level: 1, name: "Overhead couch lounge", words: "elevated 45-degree shot looking down as she stretches lengthwise along a sofa, one arm curved behind her head, opposite knee bent upward, gaze lifted directly into the lens with a soft smirk" },
  { id: "cg20", bank: "camera_glamour", level: 0, name: "Tight 85mm warm portrait", words: "intimate head-and-shoulders close-up with natural unretouched skin pores and subtle nose highlight, head tilted fifteen degrees, lower lip caught lightly between her teeth, warm practical side key light" },

  // ── 2. Mirror & Micro-Choreography (20) — prompt_bit_sorcerer + simonishere style ──────────────────
  { id: "mc01", bank: "mirror_choreo", level: 1, name: "Back-to-mirror hip twist", words: "standing with her back angled toward a tall bedroom mirror, weight shifted onto one leg with that hip pushed high, twisting smoothly at the waist so both her curved back and front glance read clearly, one hand resting on her hip" },
  { id: "mc02", bank: "mirror_choreo", level: 0, name: "Full-length knee-inward check", words: "casual full-length candid standing pose with one knee bent slightly inward and heel lifted, shoulders relaxed and dropped slightly forward, chin tucked with a shy sultry smirk toward the camera" },
  { id: "mc03", bank: "mirror_choreo", level: 1, name: "Over-shoulder rear hip pop", words: "three-quarter rear view from behind with her weight loaded onto her right leg popping her hip cleanly to the side, lower back arched, left hand lifting her hair off her neck as she glances back over her shoulder" },
  { id: "mc04", bank: "mirror_choreo", level: 1, name: "Sink-edge forward lean", words: "leaning both palms firmly on the front edge of a bathroom vanity counter, arms straight, shoulders slightly raised framing her collarbone, hips pushed back behind her, looking straight forward with parted lips" },
  { id: "mc05", bank: "mirror_choreo", level: 0, name: "Hair-tie arms-up arch", words: "candid waist-up angle caught gathering her hair up at the back of her crown with both raised hands, elbows flared outward lifting her ribcage and arching her torso, playful sideways glance at the camera" },
  { id: "mc06", bank: "mirror_choreo", level: 1, name: "Towel-tuck shoulder drop", words: "fresh out of the shower wrapped loosely in a bath towel tucked high across her chest, one hand holding the folded edge lightly as one bare shoulder dips forward, damp stray hair strands clinging to her neck" },
  { id: "mc07", bank: "mirror_choreo", level: 1, name: "Hem-lift waist check", words: "medium thigh-up shot standing slightly angled to the side, fingers of one hand pinching and lifting the lower hem of her top slightly to flash her flat toned midriff and narrow waist, teasing smirk" },
  { id: "mc08", bank: "mirror_choreo", level: 1, name: "Bedside kneeling torso twist", words: "kneeling upright on the mattress with knees slightly parted, torso twisted forty degrees toward the camera, one palm braced back on her heel and the other hand resting lightly on her opposite thigh" },
  { id: "mc09", bank: "mirror_choreo", level: 0, name: "Strap-adjust candid glance", words: "candid mid-motion medium shot adjusting one shoulder strap with her opposite hand, head tilted toward that shoulder, eyebrows raised playfully as if caught getting ready" },
  { id: "mc10", bank: "mirror_choreo", level: 1, name: "Deep crouch heels-up tease", words: "crouching low on the balls of her feet with knees angled apart, forearms resting across her upper thighs, shoulders leaned slightly forward toward the lens, looking upward with dark sultry eyes" },
  { id: "mc11", bank: "mirror_choreo", level: 1, name: "Wall-brace back arch", words: "facing a wall at a steep three-quarter angle with both palms pressed flat against the wall at shoulder height, hips angled back toward the camera, head turned back over her shoulder with heavy-lidded gaze" },
  { id: "mc12", bank: "mirror_choreo", level: 1, name: "Waistband thumb-hook rear", words: "close rear three-quarter shot from behind, both thumbs hooked inside the back waistband of her shorts or panties tugging them down an inch, spine curved cleanly, glancing back with a wicked smile" },
  { id: "mc13", bank: "mirror_choreo", level: 0, name: "Seated ankle-cross lean back", words: "sitting sideways on a bed edge with ankles crossed neatly, leaning back on both straight arms planted behind her hips, chest lifted and head tipped slightly back toward the lens" },
  { id: "mc14", bank: "mirror_choreo", level: 1, name: "Stocking-pull seated bend", words: "seated on the edge of the bed leaning far forward to pull a thigh-high stocking smoothly up her leg with both hands, framing her thighs, waist curve, and upward glance straight into the camera" },
  { id: "mc15", bank: "mirror_choreo", level: 1, name: "Prone heel-kick bed lounge", words: "lying on her stomach diagonally across rumpled sheets propped up on both elbows, ankles lifted and lazily crossed in the air behind her, chin resting lightly on one hand looking into the lens" },
  { id: "mc16", bank: "mirror_choreo", level: 0, name: "Necklace-finger close tease", words: "tight chest-up shot with two fingers hooked lightly through her necklace or choker, shoulders rotated slightly diagonally, lower lip bitten softly, warm indoor evening lamp glow" },
  { id: "mc17", bank: "mirror_choreo", level: 1, name: "Side-sit knee-up hip line", words: "sitting on the floor with one leg tucked under her and the other knee raised high toward the camera, leaning sideways onto one straight palm, free hand draped casually over her raised knee" },
  { id: "mc18", bank: "mirror_choreo", level: 1, name: "Back-glance hair sweep", words: "standing rear view from mid-thigh up, sweeping all of her long hair over one shoulder to expose her bare nape and upper spine, turning her chin cleanly back to meet the camera" },
  { id: "mc19", bank: "mirror_choreo", level: 1, name: "Hip-cock pocket lean", words: "relaxed standing three-quarter shot leaning her shoulder against a dresser or wall, one hip jutted out, fingers tucked into her front waistband, slow teasing eye contact" },
  { id: "mc20", bank: "mirror_choreo", level: 1, name: "Low-chair wide-knee lean", words: "seated low on a stool or ottoman with knees angled open, elbows resting on her inner thighs leaning forward toward the lens, hands lightly clasped, playful direct gaze" },

  // ── 3. Raw Smartphone & Digicam Selfies (20) — MrTeez + simonishere + llikswonskcalb style ─────────
  { id: "rs01", bank: "raw_selfie", level: 0, name: "High-angle arm's-length kiss", words: "candid unposed smartphone front-camera selfie held slightly above eye level at arm's length, looking up through her lashes with kissy puckered lips, natural warm bedroom lamp light, subtle phone grain" },
  { id: "rs02", bank: "raw_selfie", level: 1, name: "Low-hip Snapchat upward", words: "grainy candid smartphone photo taken from below with the front camera held low near her hip looking sharply upward along her waist and chest toward her face, warm lamp light, cheeky smirk looking down at the lens" },
  { id: "rs03", bank: "raw_selfie", level: 1, name: "2000s harsh flash bedroom", words: "raw late-night early-2000s compact digicam snapshot with direct on-camera flash creating crisp specular skin highlights and soft drop shadows behind her in a dim bedroom, candid unposed stance" },
  { id: "rs04", bank: "raw_selfie", level: 0, name: "Pillow-rest morning selfie", words: "intimate overhead arm's-length phone selfie lying on her back on messy white pillows, hair fanned across the bedding, sleepy half-smile and crinkled eyes, soft diffused morning window light" },
  { id: "rs05", bank: "raw_selfie", level: 1, name: "Down-chest cleavage selfie", words: "steep high-angle arm's-length front-camera selfie angled sharply downward from above her forehead across her face, collarbone, and deep cleavage, biting her lower lip with playful eyes looking straight up" },
  { id: "rs06", bank: "raw_selfie", level: 0, name: "Tongue-out messy-bed snap", words: "tilted casual smartphone selfie sitting cross-legged on rumpled bedsheets with her tongue playfully peeking out the corner of her smirk and one eyebrow quirked, warm ambient lamp glow" },
  { id: "rs07", bank: "raw_selfie", level: 1, name: "Overhead stretched-arms bed", words: "arm's-length phone angle lying on her stomach on the bed looking straight up at the camera with one arm stretched overhead and chin lifted, soft golden bedside light" },
  { id: "rs08", bank: "raw_selfie", level: 0, name: "Car passenger golden-hour", words: "candid smartphone selfie from the passenger seat of a car at late golden hour, warm low sun streaking diagonally across her cheekbones and hair, relaxed flirty half-smile" },
  { id: "rs09", bank: "raw_selfie", level: 1, name: "Post-shower damp-hair snap", words: "close vertical smartphone snap right out of the shower with damp wavy hair, flushed warm natural skin, wrapped loosely in a bath towel, slight lens fog softness and overhead vanity light" },
  { id: "rs10", bank: "raw_selfie", level: 1, name: "Midnight dim-screen glow", words: "low-light candid vertical smartphone photo shot at night at high ISO with slight warm digital grain, soft warm lamp and monitor glow illuminating her face and collarbone as she leans toward the lens" },
  { id: "rs11", bank: "raw_selfie", level: 1, name: "Oversized-tee knees-up snap", words: "casual arm's-length phone photo curled up on a couch in an oversized t-shirt with knees pulled toward her chest revealing bare thighs, playful winking smirk, natural afternoon room light" },
  { id: "rs12", bank: "raw_selfie", level: 1, name: "Rear-camera flash hallway", words: "candid handheld digicam flash shot caught mid-turn in a dim apartment hallway or hotel corridor, glancing back over her shoulder with surprised amused eyes and bright flash reflection" },
  { id: "rs13", bank: "raw_selfie", level: 1, name: "Couch-edge lean-in selfie", words: "tilted smartphone front-camera shot leaning far forward toward the lens from a low sofa, one arm braced behind her, eyes wide and teasing, warm indoor ambient lighting" },
  { id: "rs14", bank: "raw_selfie", level: 0, name: "Peace-free wink close-up", words: "authentic 24mm wide-angle smartphone close-up selfie, head tilted sharply to one side, playful wink with a crooked smile, free hand brushing stray hair off her cheek" },
  { id: "rs15", bank: "raw_selfie", level: 1, name: "Side-lying stomach-curve snap", words: "intimate handheld phone photo lying on her side on dark sheets, camera positioned close near mattress height capturing her face, bare shoulder, and narrow waist curve in soft lamp light" },
  { id: "rs16", bank: "raw_selfie", level: 1, name: "Bathroom-tile crouch snap", words: "raw candid smartphone photo crouched low on a bathroom floor leaning back against the tub edge, knees bent, warm overhead bulb light, unfiltered skin texture and cheeky upward grin" },
  { id: "rs17", bank: "raw_selfie", level: 0, name: "Kitchen-counter night snack", words: "unposed handheld smartphone photo at midnight in a dimly lit kitchen under warm range-hood light, leaning her hip back against the counter looking amusedly at the camera" },
  { id: "rs18", bank: "raw_selfie", level: 1, name: "Flash-lit stairs upward look", words: "raw 2000s point-and-shoot flash photo taken from a low angle as she sits on carpeted stairs with knees open slightly, elbows propped behind her, bold direct eye contact" },
  { id: "rs19", bank: "raw_selfie", level: 1, name: "Bed-edge barefoot stretch", words: "casual vertical phone snapshot sitting barefoot on the edge of an unmade bed stretching both arms behind her head, arching her back in warm morning blinds light" },
  { id: "rs20", bank: "raw_selfie", level: 2, name: "Under-sheet morning tease", words: "intimate close-up phone angle from bed height with a rumpled duvet pulled low across her bare chest and shoulders, tangled morning hair, biting her lip with sleepy seductive eyes" },

  // ── 4. Sexy Cosplay & Character Tease (20) — fixing stiff convention photos! ───────────────────────
  { id: "sc01", bank: "sexy_cosplay", level: 1, name: "Low-angle power crouch", words: "dramatic low-angle shot crouching low with knees apart and one hand planted on the floor for balance, torso angled forward showing off her costume silhouette and thighs, looking up with a fierce teasing smirk" },
  { id: "sc02", bank: "sexy_cosplay", level: 1, name: "Bedroom cosplay candid", words: "intimate candid handheld bedroom photo in full cosplay under warm tungsten lamp light, seated sideways on the edge of the bed leaning forward toward the lens with a playful knowing smile" },
  { id: "sc03", bank: "sexy_cosplay", level: 1, name: "Jacket-slip shoulder tease", words: "waist-up three-quarter shot shrugging one side of her costume jacket or cape off her bare shoulder, fingers hooked on the lapel, glancing sideways into the lens with heavy-lidded eyes" },
  { id: "sc04", bank: "sexy_cosplay", level: 1, name: "Rear costume-curve glance", words: "three-quarter rear shot from slightly below highlighting the back silhouette, waist cinch, and legwear of her costume as she pops one hip out and looks back over her shoulder with parted lips" },
  { id: "sc05", bank: "sexy_cosplay", level: 1, name: "Kneeling upward devotion", words: "high-angle shot looking down as she kneels upright on cushions or a rug in full cosplay, hands resting lightly on her thighs, chest lifted and head tipped up with intense captivating eye contact" },
  { id: "sc06", bank: "sexy_cosplay", level: 1, name: "Candlelit gothic recline", words: "candid moody room photo in warm flickering candlelight, reclining gracefully against plush cushions in costume with one knee raised and head propped on her hand, seductive half-smile" },
  { id: "sc07", bank: "sexy_cosplay", level: 1, name: "Zipper-tug neckline tease", words: "tight chest-up close shot with her fingers gripping the front zipper or neckline tie of her costume tugging it slightly open, chin tilted down looking up through her lashes" },
  { id: "sc08", bank: "sexy_cosplay", level: 1, name: "High-slit seated cross-leg", words: "angled medium-full shot seated on the corner of a table or plush chair with one leg crossed high over the other showcasing her stockings or boots, leaning slightly forward on one arm" },
  { id: "sc09", bank: "sexy_cosplay", level: 1, name: "Worm's-eye dominant stance", words: "bold low-angle shot from near knee height looking up as she stands in a wide confident stance with hands on her hips, looking down her nose into the camera with a smug playful smirk" },
  { id: "sc10", bank: "sexy_cosplay", level: 1, name: "Glove-bite close tease", words: "intimate medium close-up with her teeth lightly tugging at the fingertip of her costume glove (or collar edge), eyes locked intently on the camera with a wicked glint" },
  { id: "sc11", bank: "sexy_cosplay", level: 1, name: "Prone bed cosplay lounge", words: "candid overhead-angle shot lying on her stomach on a bed in full cosplay, propped up on her elbows with heels kicked playfully upward behind her, smiling straight up into the camera" },
  { id: "sc12", bank: "sexy_cosplay", level: 1, name: "Skirt-hem / thigh-strap tug", words: "thigh-up three-quarter candid shot with one hand resting along her thigh-strap or lifting the side hem of her costume slightly, hips angled toward the camera, teasing glance" },
  { id: "sc13", bank: "sexy_cosplay", level: 1, name: "Digicam flash after-hours", words: "raw candid late-night compact-camera flash photo in full cosplay in a hotel room or hallway, leaning back against the wall with one heel braced up behind her, natural unretouched skin" },
  { id: "sc14", bank: "sexy_cosplay", level: 1, name: "Over-table seductive lean", words: "medium shot from across a dimly lit table or bar counter as she leans far forward on both elbows in costume, accentuating her neckline and playful upward stare" },
  { id: "sc15", bank: "sexy_cosplay", level: 1, name: "Back-arched sofa drape", words: "three-quarter full-body shot lounging back across a dark velvet or leather couch in costume, lower back arched subtly, one leg extended and the other bent up, fingers trailing along her collarbone" },
  { id: "sc16", bank: "sexy_cosplay", level: 1, name: "Arm's-length cosplay selfie", words: "high-angle arm's-length front-camera smartphone selfie in full cosplay, tilted slightly, blowing a playful kiss or sticking the tip of her tongue out with bright candid lighting" },
  { id: "sc17", bank: "sexy_cosplay", level: 1, name: "Rain-soaked / mist drama", words: "cinematic damp evening candid shot with glistening rain-misted skin and stray wet hair strands clinging to her cheeks, costume fabric showing real creases, intense direct gaze under warm streetlights" },
  { id: "sc18", bank: "sexy_cosplay", level: 1, name: "All-fours playful cat arch", words: "playful bedside shot on hands and knees on the mattress in full cosplay, back arched softly and head tilted sideways looking straight into the lens with a mischievous smile" },
  { id: "sc19", bank: "sexy_cosplay", level: 1, name: "Doorway peeking over shoulder", words: "candid medium-wide shot pausing at a half-open bedroom doorway in costume, gripping the doorframe edge and glancing back invitingly over her bare or costumed shoulder" },
  { id: "sc20", bank: "sexy_cosplay", level: 1, name: "Choker-and-eyes tight crop", words: "ultra-close 50mm candid crop from collarbone to forehead capturing her colored contacts, makeup detail, costume choker or collar, and parted glossy lips in warm directional lamp light" },

  // ── 5. Lingerie, Boudoir & Thighs (20) — llikswonskcalb + nerdoo style ─────────────────────────────
  { id: "lb01", bank: "lingerie_boudoir", level: 1, name: "Raised-legs fishnet bed", words: "candid bedroom angle lying on her back on rumpled sheets with her legs raised and slightly parted toward the ceiling showcasing thigh-high stockings and lace lingerie, head turned toward the camera with a sultry smile" },
  { id: "lb02", bank: "lingerie_boudoir", level: 1, name: "Lace bralette & thigh-highs", words: "full-body coquettish standing pose highlighting her shapely toned thighs wearing solely a sheer lace bralette resting directly against her bare shoulders and bare midriff, matching lace panties, and thigh-high stockings" },
  { id: "lb03", bank: "lingerie_boudoir", level: 1, name: "Cleavage neckline pull-down", words: "intimate medium close-up leaning forward toward the camera pulling down the low neckline of her fitted lace camisole or bralette worn directly against bare skin, teasing deep cleavage with a wicked smirk" },
  { id: "lb04", bank: "lingerie_boudoir", level: 1, name: "Garter & couch waist frame", words: "seated three-quarter shot on a couch wearing solely a delicate lace bralette, garter belt, and sheer thigh-high stockings directly against bare skin, leaning back on one arm framing her narrow waist and thighs" },
  { id: "lb05", bank: "lingerie_boudoir", level: 1, name: "Rear thong arched-spine", words: "rear three-quarter shot glancing back over her bare shoulder wearing solely a sheer lace bralette strap across her bare back and a tiny cheeky lace thong with thigh-high socks, arched spine framing her curvy ass" },
  { id: "lb06", bank: "lingerie_boudoir", level: 1, name: "Sheer robe parting open", words: "soft lamp-lit bedroom shot standing by the bed edge wearing an unfastened sheer silk robe slipping off both shoulders to reveal delicate lace lingerie underneath, hands lightly holding the robe edges open" },
  { id: "lb07", bank: "lingerie_boudoir", level: 1, name: "Kneeling bed-edge panty tug", words: "kneeling upright on the mattress in matching lace lingerie, thumbs hooked gently into the thin side straps of her panties tugging them slightly down over her hips, biting her lower lip" },
  { id: "lb08", bank: "lingerie_boudoir", level: 1, name: "Side-lying silhouette curve", words: "low bed-level shot lying on her side in sheer black lace lingerie, top leg bent cleanly forward, waist cinching naturally against the mattress, warm bedside lamp tracing her hip and breast curve" },
  { id: "lb09", bank: "lingerie_boudoir", level: 1, name: "Corset-lace hotel window", words: "moody twilight hotel-room three-quarter shot standing near sheer curtains in a fitted lace bustier and thigh-high stockings directly against bare skin, warm interior lamp against cool dusk window light" },
  { id: "lb10", bank: "lingerie_boudoir", level: 1, name: "Prone pillows cheek-peek", words: "rear three-quarter angle lying face-down across soft pillows in a tiny string thong, lower back deeply arched and one leg bent slightly to the side, looking back toward the camera with sleepy seductive eyes" },
  { id: "lb11", bank: "lingerie_boudoir", level: 1, name: "Strappy-harness low angle", words: "low-angle thigh-up shot in delicate strappy lingerie directly on bare skin, hands resting behind her head lifting her bust and narrowing her waist, looking down into the camera with parted lips" },
  { id: "lb12", bank: "lingerie_boudoir", level: 1, name: "Overhead bed-spread lace", words: "top-down overhead shot lying flat on her back across dark sheets in sheer lace lingerie, knees gently bent apart, one hand resting on her flat stomach and the other tangled in her hair" },
  { id: "lb13", bank: "lingerie_boudoir", level: 1, name: "Bathroom counter lingerie sit", words: "perched up on a tiled bathroom counter in a lace bralette and cheeky panties, thighs parted slightly around the edge, leaning forward on her palms with direct flirty eye contact" },
  { id: "lb14", bank: "lingerie_boudoir", level: 1, name: "Bralette unclasp rear tease", words: "candid rear medium shot standing in warm bedroom light reaching both hands behind her back to unclasp her sheer lace bra strap, glancing sideways over her shoulder with a playful smirk" },
  { id: "lb15", bank: "lingerie_boudoir", level: 1, name: "Micro-bikini poolside wet", words: "sunlit candid outdoor shot with glistening damp skin wearing a tiny string micro-bikini resting directly on bare skin, leaning back on both hands on a lounger edge with hips angled toward the lens" },
  { id: "lb16", bank: "lingerie_boudoir", level: 1, name: "Button-up unbuttoned lounge", words: "morning bedroom candid wearing only an oversized unbuttoned dress shirt worn open directly against bare skin with matching lacy panties, seated on the bed edge with one knee tucked up" },
  { id: "lb17", bank: "lingerie_boudoir", level: 1, name: "Thigh-crop garter focus", words: "low tight crop from mid-thigh to chin wearing solely a sheer lace set and garter straps on bare skin, hips rotated slightly toward camera, fingers grazing her garter clip" },
  { id: "lb18", bank: "lingerie_boudoir", level: 1, name: "Floor-cushion kneel arch", words: "kneeling low on a bedroom rug in sheer lace lingerie, leaning back slightly with palms braced on her calves so her chest lifts and spine arches cleanly, eyes locked on the lens" },
  { id: "lb19", bank: "lingerie_boudoir", level: 1, name: "Velvet-chair straddle backward", words: "seated backwards straddling an armless chair in lace lingerie and thigh-highs, forearms folded across the chair back with her chin resting lightly on her wrists, sultry upward gaze" },
  { id: "lb20", bank: "lingerie_boudoir", level: 1, name: "Warm-lamp sheer-mesh tease", words: "dimly lit bedroom close three-quarter shot wearing a sheer mesh bodysuit directly on bare skin, warm golden side-lamp highlighting her contours and natural unretouched skin texture" },

  // ── 6. Explicit Solo & Partner POV Positions (20) — just_a_prompt_guy + TheEllieXXX + lewd_animator ─
  { id: "ep01", bank: "explicit_positions", level: 2, name: "Topless crop-top lift selfie", words: "arm's-length candid phone shot lifting her crop top high above her bare natural breasts with one hand, nipples clearly visible, biting her lower lip looking straight into the lens" },
  { id: "ep02", bank: "explicit_positions", level: 2, name: "Naked rear over-shoulder", words: "full-body naked rear view standing in her room glancing back over her shoulder with a seductive smile, framing her bare spine, narrow waist, and round ass cleanly (rear anatomy only)" },
  { id: "ep03", bank: "explicit_positions", level: 2, name: "Solo doggy ass-up invite", words: "completely naked face-down ass-up on all fours on the bed inviting the viewer from behind, chest pressed low to the sheets, back deeply arched, looking back over her shoulder with needy heavy-lidded eyes" },
  { id: "ep04", bank: "explicit_positions", level: 2, name: "Kneeling topless breast press", words: "kneeling topless on the mattress pressing her bare breasts gently together with her forearms and hands resting on her ribcage, chin dipped slightly looking up into the camera with parted lips" },
  { id: "ep05", bank: "explicit_positions", level: 2, name: "Reclining naked wide spread", words: "lying completely naked on her back across rumpled bedsheets with knees pulled up and thighs spread wide open toward the camera showing her bare wet pussy cleanly, one arm resting behind her head" },
  { id: "ep06", bank: "explicit_positions", level: 2, name: "Solo touching / fingering", words: "reclining completely naked on her bed, one hand gently parting her glistening wet pussy with her fingers while her other hand cups her bare breast, eyes half-closed and mouth parted in pleasure" },
  { id: "ep07", bank: "explicit_positions", level: 2, name: "Bed-edge seated spread POV", words: "intimate seated POV perched on the edge of the bed completely naked, leaning back on one straight arm with thighs parted wide open toward the lens, sultry eye contact" },
  { id: "ep08", bank: "explicit_positions", level: 2, name: "Shower naked glistening wet", words: "completely naked standing under warm running shower spray with wet hair slicked back over her shoulders and water droplets glistening across her bare breasts and waist, glancing sideways at the camera" },
  { id: "ep09", bank: "explicit_positions", level: 2, name: "Stockings-only low upward", words: "grainy candid phone photo taken from low near her knees looking upward as she stands completely naked except black thigh-high stockings, highlighting her narrow waist, wide hips, and bare breasts" },
  { id: "ep10", bank: "explicit_positions", level: 2, name: "Overhead naked flat arch", words: "top-down overhead shot lying completely naked on her back on dark sheets with legs open and both arms stretched overhead, back softly arched, gazing straight up into the camera" },
  { id: "ep11", bank: "explicit_positions", level: 2, name: "Naked squat heels-up POV", words: "low-angle front POV crouching completely naked with knees spread wide apart, fingertips resting on the mattress between her feet, bare breasts and pussy clearly framed, looking up through her lashes" },
  { id: "ep12", bank: "explicit_positions", level: 2, name: "Solo toy / dildo oral tease", words: "kneeling completely naked on the mattress holding a realistic translucent dildo up to her parted glossy lips licking the tip while looking straight up into the lens with heavy-lidded eyes" },
  { id: "ep13", bank: "explicit_positions", level: 2, name: "Prone face-down rear curve", words: "low rear-quarter bed-level shot lying completely naked face-down with hips propped up on a pillow, legs slightly parted, glancing back over her shoulder with a soft wicked smirk" },
  { id: "ep14", bank: "explicit_positions", level: 2, name: "Between-legs extreme low", words: "extreme low angle from the foot of the bed looking upward between her parted bare thighs as she reclines completely naked propped on her elbows, looking straight down the lens" },
  { id: "ep15", bank: "explicit_positions", level: 3, name: "POV oral looking up", words: "first-person male POV looking downward as she kneels naked between his spread thighs (his lower abdomen and thighs visible at bottom edge), wrapping her lips around his thick erect penis with one hand gripping the base while staring straight up through her lashes" },
  { id: "ep16", bank: "explicit_positions", level: 3, name: "POV missionary eye contact", words: "first-person male missionary POV looking down from above as she lies completely naked on her back on the bed with knees bent wide around his waist (his torso and hips aligned between her thighs), explicit vaginal penetration as she grips his forearms with parted lips and heavy-lidded eyes" },
  { id: "ep17", bank: "explicit_positions", level: 3, name: "POV cowgirl riding front", words: "low first-person male POV lying back on the bed looking up as she sits completely naked straddling his hips (his bare chest, stomach, and thighs visible in lower frame), leaning slightly forward with palms braced on his chest as she rides his erect penis deep inside her" },
  { id: "ep18", bank: "explicit_positions", level: 3, name: "POV rear doggy over-shoulder", words: "first-person male POV kneeling directly behind her hips on the bed (his hands gripping her waist and bare hips in lower foreground), she is completely naked on all fours with back deeply arched as his erect penis thrusts deep inside her from behind while she looks back over her shoulder mid-moan" },
  { id: "ep19", bank: "explicit_positions", level: 3, name: "POV reverse cowgirl rear", words: "low first-person male POV looking down his torso as she straddles his hips facing away from him, back deeply arched showcasing her bare spine and round buttocks bouncing on his erect penis while she glances back over her shoulder" },
  { id: "ep20", bank: "explicit_positions", level: 3, name: "Side-profile prone bone", words: "candid handheld three-quarter side view on the mattress: she lies completely naked face-down with hips lifted slightly while a separate adult male partner lies behind her gripping her hip (his torso, hips, and thighs clearly aligned, face cropped at upper edge) with explicit penetration as she turns her face toward the camera" },
];

// ── Persistent non-repeating used-shot tracker ──────────────────────────────────────────────────────
const USED_KEY = "h3.blueprints.used.v1";

function loadUsed(): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(USED_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveUsed(map: Record<string, string[]>) {
  try {
    localStorage.setItem(USED_KEY, JSON.stringify(map));
  } catch { /* private mode */ }
}

/** Pick `count` fresh, non-repeating blueprints from `banks` (filtered optionally by maxLevel).
 *  Tracks recently used IDs per `scope` in localStorage so consecutive batches/characters never recycle the same shot. */
export function pickFreshBlueprints(
  banks: BlueprintBankId[],
  count: number,
  scope = "global",
  maxLevel: 0 | 1 | 2 | 3 = 3,
): ShotBlueprint[] {
  const pool = SHOT_BLUEPRINTS.filter((b) => banks.includes(b.bank) && b.level <= maxLevel);
  if (!pool.length) return [];
  const usedMap = loadUsed();
  const usedSet = new Set(usedMap[scope] ?? []);
  const fresh = pool.filter((b) => !usedSet.has(b.id));
  const shuffle = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  let picked = shuffle(fresh).slice(0, count);
  if (picked.length < count) {
    // Exhausted fresh pool — reset scope history and top up without duplicating current picks
    const pickedIds = new Set(picked.map((x) => x.id));
    const rest = shuffle(pool.filter((b) => !pickedIds.has(b.id))).slice(0, count - picked.length);
    picked = [...picked, ...rest];
    usedMap[scope] = picked.map((x) => x.id);
  } else {
    usedMap[scope] = [...(usedMap[scope] ?? []), ...picked.map((x) => x.id)].slice(-pool.length);
  }
  saveUsed(usedMap);
  return picked;
}

/** Clear used-shot history for a scope (or all scopes) */
export function resetUsedBlueprints(scope?: string) {
  if (!scope) { saveUsed({}); return; }
  const m = loadUsed();
  delete m[scope];
  saveUsed(m);
}
