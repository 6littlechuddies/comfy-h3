// Curated MiniMax H3 Video Motion & Soundscape Blueprints distilled from Deooeo's 96 H3 video prompts & 32 workflows.
// Every blueprint follows the exact official H3 I2V schema:
//   - Anchors <Picture 1> at 0.00s WITHOUT re-describing static appearance or room (so H3 never fights the input frame)
//   - Second-by-second beat choreography (0.00–4.00s, 4.00–8.00s, 8.00–12.00s) for crisp kinetic timing
//   - Synchronized concrete `overall_soundscape` + `non_diegetic_music: N/A`
//   - Zero ban lists / zero "Avoid:" or "no X" negative nouns

export type H3MotionCat = "tease" | "mirror" | "undress" | "cosplay" | "solo" | "partner";

export interface H3Blueprint {
  id: string;
  cat: H3MotionCat;
  label: string;
  seconds: number;
  hint: string;
  prompt: string;
}

export const H3_MOTION_CATS: { id: H3MotionCat; label: string }[] = [
  { id: "tease", label: "Tease & Flirt" },
  { id: "mirror", label: "Mirror & Selfie" },
  { id: "undress", label: "Undress & Reveal" },
  { id: "cosplay", label: "Cosplay Motion" },
  { id: "solo", label: "Explicit Solo" },
  { id: "partner", label: "Explicit Partner POV" },
];

const wrap = (shot: string, sound: string) =>
  `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\n` +
  `integrated_multimodal_description:\n[Shot 1] ${shot}\n\n` +
  `overall_soundscape:\n${sound}\n\n` +
  `non_diegetic_music:\nN/A`;

export const H3_BLUEPRINTS: H3Blueprint[] = [
  // ── 1. Tease & Flirt (6) ───────────────────────────────────────────────────────────────────────────
  {
    id: "t1", cat: "tease", label: "Hair flip & lip bite", seconds: 8, hint: "Slow playful hair sweep, eye lock, soft lip bite",
    prompt: wrap(
      "Continuous locked handheld shot opening directly on <Picture 1>. From 0.00 to 3.00 seconds, the woman slowly tilts her head, lifts one hand to sweep loose strands of hair smoothly over her shoulder, and relaxes into a soft knowing smirk. From 3.00 to 6.00 seconds, she leans slightly closer toward the lens, dips her chin while holding steady heavy-lidded eye contact, and softly catches her lower lip between her teeth. From 6.00 to 8.00 seconds, she releases her lip with a quiet breathy laugh and subtle shoulder roll as the camera holds steady.",
      "Quiet room ambience, soft rustle of hair and fabric, a gentle breathy exhale and quiet playful giggle.",
    ),
  },
  {
    id: "t2", cat: "tease", label: "Lean in & blow a kiss", seconds: 8, hint: "Intimate lean toward lens, wink, blown kiss",
    prompt: wrap(
      "Single unbroken handheld close-medium shot beginning from <Picture 1>. From 0.00 to 3.00 seconds, she shifts her weight forward toward the camera with a warm mischievous smile, blinking slowly. From 3.00 to 5.50 seconds, she raises her fingers lightly to her lips, puckers softly, and blows a playful kiss straight at the lens accompanied by a quick wink. From 5.50 to 8.00 seconds, she lowers her hand and eases back slightly with a lingering amused smirk.",
      "Soft indoor room tone, delicate sound of a light kiss and quiet breathy chuckle.",
    ),
  },
  {
    id: "t3", cat: "tease", label: "Slow spin & over-shoulder wink", seconds: 10, hint: "Full-body slow turn, hip shift, glance back over shoulder",
    prompt: wrap(
      "One continuous steady handheld shot starting from <Picture 1>. From 0.00 to 3.50 seconds, she shifts her weight onto one foot and begins a smooth, unhurried half-turn so her profile and waist curve catch the room light. From 3.50 to 7.00 seconds, she completes the turn facing away, shifts her hip cleanly to one side, and pauses. From 7.00 to 10.00 seconds, she turns her head back over her near shoulder to lock eyes with the camera, flashing a playful wink and parted-lip smile.",
      "Subtle footsteps on the floor, light swish of clothing moving with her turn, quiet ambient room tone.",
    ),
  },
  {
    id: "t4", cat: "tease", label: "Morning bed stretch", seconds: 10, hint: "Arms overhead stretch, arched back, sleepy smile",
    prompt: wrap(
      "Continuous intimate handheld take opening on <Picture 1>. From 0.00 to 4.00 seconds, she slowly raises both arms overhead in a languid stretch, arching her back subtly as her chest lifts and the bedding shifts lightly around her. From 4.00 to 7.50 seconds, she lowers her arms lazily, rolls slightly onto one side toward the lens, and rests her cheek near her shoulder. From 7.50 to 10.00 seconds, her eyes flutter open into a warm sleepy smile straight at the camera.",
      "Soft rustling of cotton bedsheets, a slow satisfied morning stretch sigh, gentle quiet bedroom air.",
    ),
  },
  {
    id: "t5", cat: "tease", label: "Chin-down lash gaze", seconds: 8, hint: "Subtle natural breathing, slow eye shift, parted lips",
    prompt: wrap(
      "Unbroken close handheld take from <Picture 1>. From 0.00 to 3.00 seconds, her chest rises and falls with calm unhurried breathing as she slowly angles her chin downward while keeping her eyes fixed directly upward through her lashes. From 3.00 to 6.00 seconds, her lips part slightly and the tip of her tongue briefly brushes her lower lip in a teasing beat. From 6.00 to 8.00 seconds, she tilts her head softly to the opposite side with a warm sultry smile.",
      "Intimate quiet room atmosphere and soft natural breathing close to the microphone.",
    ),
  },
  {
    id: "t6", cat: "tease", label: "Playful tongue-out smirk", seconds: 8, hint: "Candid cheeky expression shift, shoulder shrug, laugh",
    prompt: wrap(
      "Continuous casual handheld take starting exactly on <Picture 1>. From 0.00 to 2.50 seconds, she holds a sly grin with her eyes twinkling at the lens. From 2.50 to 5.00 seconds, she tilts her head cheekily, pops the tip of her tongue playfully out the corner of her mouth, and gives a quick flirtatious shoulder shrug. From 5.00 to 8.00 seconds, she pulls her tongue back in and breaks into a genuine natural smile as her hair shifts lightly.",
      "Natural casual room tone and a light playful breathy laugh.",
    ),
  },

  // ── 2. Mirror & Selfie Motion (6) ──────────────────────────────────────────────────────────────────
  {
    id: "m1", cat: "mirror", label: "Mirror hip-sway & check", seconds: 10, hint: "Phone selfie sway, hip pop left-to-right, smirk",
    prompt: wrap(
      "Continuous candid handheld smartphone take opening directly on <Picture 1>. From 0.00 to 3.50 seconds, she subtly shifts her weight from her left hip to her right hip, letting her waist curve smoothly while holding steady eye contact with the camera. From 3.50 to 7.00 seconds, she angles her torso into a flattering three-quarter turn, adjusting her posture with a small confident bounce. From 7.00 to 10.00 seconds, she turns back toward the lens, dips her chin slightly, and flashes a slow self-assured smirk.",
      "Subtle rustling of clothing, quiet natural bedroom ambience, faint handheld movement.",
    ),
  },
  {
    id: "m2", cat: "mirror", label: "Side-to-back outfit check", seconds: 10, hint: "Turns 90° to side then rear glance checking fit",
    prompt: wrap(
      "Unbroken handheld phone take beginning on <Picture 1>. From 0.00 to 3.50 seconds, she pivots smoothly ninety degrees into side profile, running one hand lightly down her waist and hip to smooth the fabric. From 3.50 to 7.00 seconds, she rotates further into a rear three-quarter angle, arching her lower back subtly while glancing back toward the camera. From 7.00 to 10.00 seconds, she smiles over her shoulder and gently sways her hips once before settling.",
      "Soft fabric brush against skin, faint floor creak as she pivots, quiet indoor ambience.",
    ),
  },
  {
    id: "m3", cat: "mirror", label: "Hem-lift waist flash", seconds: 8, hint: "Pinches top hem up briefly to flash midriff, cheeky grin",
    prompt: wrap(
      "Single unbroken candid phone shot from <Picture 1>. From 0.00 to 2.50 seconds, she stands relaxed looking straight at the lens with a mischievous glint. From 2.50 to 5.50 seconds, she pinches the lower edge of her top with her fingers and lifts it slowly a few inches to flash her toned flat stomach and narrow waist while arching slightly. From 5.50 to 8.00 seconds, she lets the hem drop smoothly back into place with a cheeky bite of her lower lip.",
      "Light rustle of soft fabric lifting and settling, quiet breathy giggle, room tone.",
    ),
  },
  {
    id: "m4", cat: "mirror", label: "Hair-tie arms-up candid", seconds: 10, hint: "Gathers hair up into high ponytail, stretches torso, eye contact",
    prompt: wrap(
      "Continuous natural handheld phone clip opening on <Picture 1>. From 0.00 to 4.00 seconds, she raises both hands smoothly behind her head to gather her hair high at her crown, her elbows flaring outward and lifting her posture naturally. From 4.00 to 7.50 seconds, she twists and holds the hair bundle briefly while tilting her head sideways to hold steady eye contact with the lens. From 7.50 to 10.00 seconds, she lets her hair cascade softly back down over her shoulders with a small shake.",
      "Soft brushing sound of fingers running through hair, subtle clothing rustle, calm room air.",
    ),
  },
  {
    id: "m5", cat: "mirror", label: "Post-shower towel tug", seconds: 8, hint: "Adjusts towel edge, damp shoulder drop, flirty eye lock",
    prompt: wrap(
      "Single continuous candid bathroom phone take from <Picture 1>. From 0.00 to 3.00 seconds, she leans slightly toward the camera, fingers resting on the tucked upper edge of her towel as subtle steam lingers in the air. From 3.00 to 5.50 seconds, she playfully tugs the edge half an inch lower while dipping one bare shoulder forward and raising an eyebrow teasingly. From 5.50 to 8.00 seconds, she catches the towel back securely with a knowing laugh.",
      "Soft bathroom ambience, faint sound of a distant water drip, gentle rustle of terry cloth and quiet giggle.",
    ),
  },
  {
    id: "m6", cat: "mirror", label: "Low-angle phone pan up", seconds: 10, hint: "Camera slowly tilts up from thighs to smirking face",
    prompt: wrap(
      "One unbroken handheld smartphone shot beginning exactly on <Picture 1>. From 0.00 to 4.00 seconds, the handheld camera glides smoothly in a slow subtle upward tilt along her posture as she shifts her hip and lets one hand trace lightly along her side. From 4.00 to 7.50 seconds, the framing settles cleanly on her upper torso and face as she dips her chin toward the lens. From 7.50 to 10.00 seconds, she blinks slowly and parts her lips in an inviting smile.",
      "Quiet indoor ambient tone, soft brush of hand over fabric, gentle breathing.",
    ),
  },

  // ── 3. Undress & Reveal (6) ────────────────────────────────────────────────────────────────────────
  {
    id: "u1", cat: "undress", label: "Slow strap slide off shoulder", seconds: 10, hint: "Teasingly slides shoulder strap down arm with eye contact",
    prompt: wrap(
      "Continuous unbroken handheld take starting directly on <Picture 1>. From 0.00 to 3.50 seconds, she hooks two fingers cleanly beneath one shoulder strap while keeping unbroken sultry eye contact with the lens. From 3.50 to 7.00 seconds, she slides the strap slowly off her bare shoulder down her upper arm, letting the neckline dip slightly as she tilts her head. From 7.00 to 10.00 seconds, she repeats the slow teasing pull on the opposite shoulder with a soft breathy smile.",
      "Delicate elastic and fabric slide against skin, soft slow breathing, quiet bedroom ambience.",
    ),
  },
  {
    id: "u2", cat: "undress", label: "Crop-top lift & flash", seconds: 10, hint: "Slowly lifts top up over bare breasts, playful bounce & smile",
    prompt: wrap(
      "Single continuous candid handheld take opening on <Picture 1>. From 0.00 to 3.00 seconds, she grips the bottom hem of her top with both hands, biting her lower lip with a playful glint in her eyes. From 3.00 to 6.50 seconds, she pulls the top smoothly upward above her chest to reveal her bare breasts cleanly, rolling her shoulders back slightly so they sway naturally. From 6.50 to 10.00 seconds, she holds the lifted hem briefly with a wicked grin and soft exhale.",
      "Soft rustle of cotton lifting upward, quiet breathy exhale and playful soft giggle, natural room ambience.",
    ),
  },
  {
    id: "u3", cat: "undress", label: "Shorts / skirt slip down hips", seconds: 10, hint: "Hands on waistband sliding shorts/skirt smoothly past hips",
    prompt: wrap(
      "One continuous handheld bedroom shot starting from <Picture 1>. From 0.00 to 3.50 seconds, she hooks both thumbs into her waistband while maintaining direct teasing eye contact and swaying her hips lightly. From 3.50 to 7.50 seconds, she pushes the waistband smoothly downward over the curve of her hips and upper thighs, bending her knees slightly as the garment slips lower. From 7.50 to 10.00 seconds, she rises smoothly back upright with a confident sultry smirk.",
      "Crisp sound of waistband fabric sliding over skin, subtle footsteps, quiet breathy exhale.",
    ),
  },
  {
    id: "u4", cat: "undress", label: "Robe / jacket parting open", seconds: 10, hint: "Unfastens tie and lets robe/jacket fall cleanly off shoulders",
    prompt: wrap(
      "Unbroken steady handheld take beginning directly on <Picture 1>. From 0.00 to 3.50 seconds, her fingers slowly untie the front closure and hold the open edges lightly against her ribs while holding heavy-lidded eye contact. From 3.50 to 7.00 seconds, she rolls both shoulders smoothly back so the robe glides cleanly off her arms and pools softly behind her. From 7.00 to 10.00 seconds, she places one hand lightly on her bare hip and breathes slowly into a warm smirk.",
      "Smooth whisper of silk or fabric sliding off bare skin and rustling softly downward, calm room tone.",
    ),
  },
  {
    id: "u5", cat: "undress", label: "Rear bra unclasp & drop", seconds: 10, hint: "Over-shoulder rear shot unclasping bra and letting straps slip",
    prompt: wrap(
      "Single unbroken rear three-quarter shot starting on <Picture 1>. From 0.00 to 3.50 seconds, she glances back over her shoulder with a teasing smile as both hands reach cleanly behind her back to the clasp. From 3.50 to 7.00 seconds, she unhooks the clasp smoothly and lets the straps slide freely down her bare shoulders and arms. From 7.00 to 10.00 seconds, she arches her bare back softly, turns her chin further toward the lens, and lets out a quiet amused breath.",
      "Tiny metallic click of the clasp opening, soft slide of straps over skin, quiet indoor ambience.",
    ),
  },
  {
    id: "u6", cat: "undress", label: "Stocking roll-up bed edge", seconds: 10, hint: "Seated slow smoothing of thigh-high stocking up leg with upward glance",
    prompt: wrap(
      "Continuous intimate handheld shot opening on <Picture 1>. From 0.00 to 4.00 seconds, seated on the bed edge she leans forward with both hands smoothing the top band of her thigh-high stocking slowly higher up her bare thigh. From 4.00 to 7.50 seconds, she pauses to adjust the lace band carefully while keeping her knee bent cleanly toward the camera. From 7.50 to 10.00 seconds, she lifts her eyes smoothly up through her lashes into a slow seductive smile.",
      "Soft brush of fingers over sheer nylon and bare skin, gentle creak of mattress, quiet room tone.",
    ),
  },

  // ── 4. Cosplay Motion (6) ──────────────────────────────────────────────────────────────────────────
  {
    id: "c1", cat: "cosplay", label: "Heroic stance to cheeky smirk", seconds: 8, hint: "Holds dramatic character pose, then breaks into flirty smile",
    prompt: wrap(
      "Single unbroken handheld shot opening on <Picture 1>. From 0.00 to 3.00 seconds, she holds her dramatic character posture taut while subtle breeze or ambient air moves stray strands of hair and costume trim. From 3.00 to 5.50 seconds, she relaxes her shoulders, shifts her hip outward, and lets the serious character facade melt into a teasing crooked smirk. From 5.50 to 8.00 seconds, she tilts her head playfully and gives a slow knowing wink at the lens.",
      "Light rustle of layered costume fabric and accessories, natural location ambience, soft amused breath.",
    ),
  },
  {
    id: "c2", cat: "cosplay", label: "Zipper / collar tease in costume", seconds: 10, hint: "Fingers trace costume collar or zipper down slowly, intense eye lock",
    prompt: wrap(
      "Continuous intimate medium shot starting from <Picture 1>. From 0.00 to 3.50 seconds, she lifts one hand gracefully to the front collar or zipper pull of her costume, locking eyes straight into the lens. From 3.50 to 7.00 seconds, she draws the pull smoothly downward a couple inches while leaning slightly closer into the warm practical light. From 7.00 to 10.00 seconds, she rests her fingertips gently at her collarbone with parted glossy lips.",
      "Crisp subtle metallic zip sound, rustle of costume fabric, soft close breathing.",
    ),
  },
  {
    id: "c3", cat: "cosplay", label: "Glove-tug close tease", seconds: 8, hint: "Playfully tugs glove fingertip with teeth or fingers, fierce gaze",
    prompt: wrap(
      "Unbroken close handheld take beginning on <Picture 1>. From 0.00 to 3.00 seconds, she raises her gloved hand slowly toward her lips while keeping unwavering sultry eye contact. From 3.00 to 5.50 seconds, she lightly catches the fingertip between her teeth and tugs playfully, tilting her chin downward. From 5.50 to 8.00 seconds, she releases the glove with a wicked half-smile and drops her hand smoothly.",
      "Subtle leather or fabric creak of the glove, quiet indoor room tone, soft breath.",
    ),
  },
  {
    id: "c4", cat: "cosplay", label: "Candlelit lean-in allure", seconds: 10, hint: "Slow forward lean in warm practical light, drifting hair, parted lips",
    prompt: wrap(
      "One continuous atmospheric handheld take starting from <Picture 1>. From 0.00 to 4.00 seconds, warm flickering ambient light shifts gently across her costume textures and skin as she leans slowly closer toward the camera. From 4.00 to 7.50 seconds, she lifts one hand to brush hair away from her neck, tilting her face slightly to catch the warm side glow. From 7.50 to 10.00 seconds, she holds close intimate eye contact with softly parted lips.",
      "Warm quiet room atmosphere, faint rustle of costume fabric, calm soft breathing.",
    ),
  },
  {
    id: "c5", cat: "cosplay", label: "Low-angle crouch rise", seconds: 10, hint: "Rises smoothly from low crouch into confident curve, camera tilts up",
    prompt: wrap(
      "Single continuous dynamic handheld shot opening on <Picture 1>. From 0.00 to 4.00 seconds, she shifts her balance smoothly from her low crouch and begins rising upward with controlled grace as the camera follows slightly upward. From 4.00 to 7.50 seconds, she straightens into a confident three-quarter stance with one hip popped and hands settling at her waist. From 7.50 to 10.00 seconds, she flips her hair lightly and locks eyes down at the lens with a smug grin.",
      "Subtle creak of boots or flooring, swish of costume hems and straps, natural room ambience.",
    ),
  },
  {
    id: "c6", cat: "cosplay", label: "Kneeling upward devotion", seconds: 8, hint: "Subtle torso sway while kneeling in costume, soft upward breath",
    prompt: wrap(
      "Continuous intimate high-angle take starting directly on <Picture 1>. From 0.00 to 3.00 seconds, kneeling upright she sways subtly forward, resting her palms warmly on her thighs while gazing steadily upward at the lens. From 3.00 to 6.00 seconds, she arches her lower back slightly, lifting her chest and parting her lips with a needy heavy-lidded look. From 6.00 to 8.00 seconds, she tilts her head softly with a faint playful smile.",
      "Soft fabric shift against cushions, quiet breathy sigh, calm indoor room tone.",
    ),
  },

  // ── 5. Explicit Solo (6) ───────────────────────────────────────────────────────────────────────────
  {
    id: "s1", cat: "solo", label: "All-fours arched hip sway & bounce", seconds: 10, hint: "Deooeo-style kinetic ass sway & jiggle on bed, glancing back",
    prompt: wrap(
      "Continuous candid handheld rear-quarter shot opening directly on <Picture 1>. From 0.00 to 3.50 seconds, positioned on all fours on the mattress she deepens the arch in her lower back and begins a smooth teasing side-to-side hip sway while looking back over her shoulder at the lens. From 3.50 to 7.50 seconds, she picks up a rhythmic playful upward-and-back bounce of her hips so her bare buttocks jiggle naturally with each beat, biting her lip. From 7.50 to 10.00 seconds, she slows into a lingering arched hold with a breathless needy smile back at the camera.",
      "Soft rhythmic creak of the mattress and rustle of sheets, quiet breathy giggles and escalating soft exhales.",
    ),
  },
  {
    id: "s2", cat: "solo", label: "Topless chest squeeze & bounce", seconds: 10, hint: "Hands cupping and lifting bare breasts gently with sultry gaze",
    prompt: wrap(
      "Single unbroken intimate handheld take starting on <Picture 1>. From 0.00 to 3.50 seconds, she slides both hands smoothly up along her ribcage to cup and gently lift her bare breasts while holding direct heavy-lidded eye contact. From 3.50 to 7.00 seconds, she squeezes them softly together and releases with a subtle playful torso bounce so they move naturally under the room light. From 7.00 to 10.00 seconds, her fingers trail lightly across her skin as her lips part in a warm breathy sigh.",
      "Quiet bedroom ambience, soft skin-on-skin brush, gentle breathless sighing.",
    ),
  },
  {
    id: "s3", cat: "solo", label: "Reclining arch & teasing touch", seconds: 10, hint: "Naked on sheets arching hips, slow sensual solo touch, soft moans",
    prompt: wrap(
      "Continuous unbroken handheld shot beginning directly on <Picture 1>. From 0.00 to 3.50 seconds, reclining bare on the sheets she slowly slides one hand down across her flat stomach toward her parted thighs while her breathing deepens visibly. From 3.50 to 7.50 seconds, her fingers move in a slow, gentle rhythmic motion between her legs as she arches her lower back off the mattress, eyes fluttering half-closed and lips parting. From 7.50 to 10.00 seconds, her head tips back slightly into the pillows with a soft breathless gasp before glancing back toward the lens.",
      "Soft rustling of bedsheets, intimate wet rhythmic fingertip sounds, quiet escalating female breaths and soft breathless moans.",
    ),
  },
  {
    id: "s4", cat: "solo", label: "Seated bed-edge slow spread", seconds: 10, hint: "Leans back on palms, slowly parts knees wide with eye lock",
    prompt: wrap(
      "One continuous candid handheld shot starting from <Picture 1>. From 0.00 to 3.50 seconds, seated on the mattress edge she leans smoothly back onto her palms, arching her torso slightly while locking eyes with the camera. From 3.50 to 7.00 seconds, she slowly parts her knees wider apart in an unhurried inviting reveal, toes curling lightly on the floor. From 7.00 to 10.00 seconds, she shifts one hand gently onto her inner thigh and flashes a slow wicked smirk.",
      "Subtle mattress spring creak, soft skin and sheet movement, quiet steady breathing.",
    ),
  },
  {
    id: "s5", cat: "solo", label: "Wet shower turn & water glide", seconds: 10, hint: "Running shower water over bare skin, hair slick back, glance",
    prompt: wrap(
      "Continuous atmospheric handheld shot opening on <Picture 1>. From 0.00 to 4.00 seconds, warm water streams steadily across her bare shoulders and chest as she runs both hands smoothly back through her wet hair, tilting her face briefly into the spray. From 4.00 to 7.50 seconds, she pivots gracefully through a three-quarter turn letting water droplets trace cleanly down her waist and hips. From 7.50 to 10.00 seconds, she turns her eyes sideways toward the camera with glistening wet lips and a soft smile.",
      "Steady warm shower spray pattering against tile and skin, soft water splashes, calm breathing.",
    ),
  },
  {
    id: "s6", cat: "solo", label: "Oral tease tongue & lip close-up", seconds: 8, hint: "Close-up wet lip lick, heavy-lidded upward stare, playful nod",
    prompt: wrap(
      "Unbroken intimate close-up starting directly on <Picture 1>. From 0.00 to 3.00 seconds, holding steady upward eye contact through her lashes she parts her glossy lips slowly and runs the tip of her tongue smoothly across her lower lip. From 3.00 to 6.00 seconds, she opens her mouth slightly wider with a playful teasing lean forward toward the lens, eyes glistening in the warm light. From 6.00 to 8.00 seconds, she eases back with a soft breathless smirk.",
      "Close quiet room tone, delicate wet lip sound, soft warm breath.",
    ),
  },

  // ── 6. Explicit Partner POV (6) — Deooeo beat-choreographed style ──────────────────────────────────
  {
    id: "p1", cat: "partner", label: "Deooeo rear-quarter doggy rhythm", seconds: 12, hint: "Beat-timed 0–4s / 4–7s / 7–12s kinetic thrust escalation + glance back",
    prompt: wrap(
      "One continuous candid handheld rear-quarter shot opening directly on <Picture 1>, preserving both adults and the room lighting cleanly. From 0.00 to 4.00 seconds, the partner behind her drives a steady, rhythmic horizontal hip motion against her bare buttocks, causing natural skin compression and kinetic jiggle with every impact while the sheets shift beneath her hands. At 4.00 seconds, he shifts both hands firmly onto her hips for leverage as she glances back over her shoulder with flushed cheeks and a breathless parted-lip smile. From 4.00 to 8.00 seconds, the tempo accelerates into deeper, heavier rhythmic thrusts that rock her torso forward smoothly on each beat. From 8.00 to 12.00 seconds, she arches her back deeper, tossing her hair slightly as the heavy driving pace holds steady to the end of the take.",
      "Continuous rhythmic skin-on-skin slapping impacts, creaking mattress springs, her escalating breathless female moans and sharp gasps synchronized tightly with the deeper thrusts.",
    ),
  },
  {
    id: "p2", cat: "partner", label: "First-person missionary POV", seconds: 12, hint: "High diagonal POV eye contact, rhythmic thrusting, hands gripping",
    prompt: wrap(
      "One unbroken first-person missionary POV from the partner's eye level above her face, opening directly on <Picture 1>. From 0.00 to 4.00 seconds, the camera rides a subtle natural handheld rhythm as her torso and bare breasts bounce softly with steady mid-pace thrusting while she locks intense heavy-lidded eyes straight up into the lens. From 4.00 to 8.00 seconds, her hands reach up to grip his forearms tightly as the rhythm deepens, her mouth falling open in breathless rhythmic gasps and stray hair clinging to her damp cheeks. From 8.00 to 12.00 seconds, she arches her neck back briefly against the pillows before pulling her gaze back straight into the lens with a trembling smile.",
      "Intimate rhythmic bedsheet friction and soft skin impacts, close breathless panting, soft rhythmic female moans rising in intensity.",
    ),
  },
  {
    id: "p3", cat: "partner", label: "First-person cowgirl hip-grind", seconds: 12, hint: "Low POV looking up as she rolls hips then bounces faster",
    prompt: wrap(
      "Single unbroken low first-person POV looking upward from the bed, starting directly on <Picture 1>. From 0.00 to 4.00 seconds, straddling his hips with palms braced on his chest she moves in a slow, deep circular hip grind, maintaining unbroken sultry eye contact downward while her hair swings gently around her shoulders. From 4.00 to 8.50 seconds, she lifts her torso slightly and shifts into a brisk, rhythmic vertical bounce, her bare breasts bouncing naturally with each downward drop as her breathing quickens. From 8.50 to 12.00 seconds, she leans lower toward the camera with flushed skin and parted glossy lips as the pace builds smoothly.",
      "Rhythmic mattress creaks, wet skin-on-skin contact sounds, her quickening breathy moans and soft gasps.",
    ),
  },
  {
    id: "p4", cat: "partner", label: "First-person kneeling oral POV", seconds: 10, hint: "Downward POV rhythmic head bob, wet sheen, upward eye lock",
    prompt: wrap(
      "One continuous first-person downward POV opening directly on <Picture 1>. From 0.00 to 3.50 seconds, kneeling between his thighs she maintains a smooth, unhurried up-and-down bobbing motion with one hand stroking steadily in sync at the base while staring straight up through her lashes. From 3.50 to 7.50 seconds, her pace quickens into a deeper rhythmic motion with glistening saliva sheen along her lips and cheeks as her hair sways forward. From 7.50 to 10.00 seconds, she pulls back slightly to the tip with a breathless wet smirk, keeping unbroken upward eye contact.",
      "Authentic wet rhythmic oral suction sounds, soft muffled hums, quiet steady breathing in a calm bedroom.",
    ),
  },
  {
    id: "p5", cat: "partner", label: "Reverse cowgirl rear bounce", seconds: 10, hint: "Low POV down torso, arched bare back bouncing + over-shoulder look",
    prompt: wrap(
      "Single unbroken low first-person POV opening cleanly on <Picture 1>. From 0.00 to 3.50 seconds, facing away with her back deeply arched she rolls her hips smoothly downward in an unhurried grind, hands resting lightly on her thighs. From 3.50 to 7.50 seconds, she picks up a crisp rhythmic vertical bounce so her round buttocks compress and rebound kinetically with every drop while his hands grip her waist steadily. From 7.50 to 10.00 seconds, she turns her head back over her shoulder flashing a flushed breathless smirk straight at the camera.",
      "Rhythmic skin slapping impacts, soft mattress bounce, her breathless female moans and quiet panting.",
    ),
  },
  {
    id: "p6", cat: "partner", label: "Prone-bone side-profile escalation", seconds: 12, hint: "Three-quarter side view pressing down into mattress, intense beat shift",
    prompt: wrap(
      "One unbroken candid handheld three-quarter side shot starting directly on <Picture 1>. From 0.00 to 4.00 seconds, lying face-down across the mattress she grips the pillow edge as the partner behind her drives steady rhythmic thrusts pressing her hips smoothly into the bedding. From 4.00 to 8.00 seconds, he shifts his weight forward placing one hand along her waist as the pace intensifies into faster, sharper strokes causing her shoulders and hair to jolt subtly on each beat. From 8.00 to 12.00 seconds, she turns her face sideways toward the camera with eyes half-closed and mouth parted in a sustained breathless moan.",
      "Heavy rhythmic skin-on-skin impacts, rustling pillows and bedframe creaks, intense breathless female moans synchronized to the tempo.",
    ),
  },
];
