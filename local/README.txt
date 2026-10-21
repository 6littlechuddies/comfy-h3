H3 STUDIO ON YOUR PC (AMD RX 7900 GRE, ComfyUI Desktop)
=======================================================

The same Studio as on your rentals, running on your own PC: Characters, Create, Edit, Batch (Plan it for me, Content plan,
saved scenes), Your site and the Grok tab writer. What needs the rental's big NVIDIA card stays on the rental and shows as
"Rental only": video (H3 / Eros), NVIDIA upscale, the Qwen angle tool / Edit chat helper, LoRA training.

ONCE
1. Unzip this folder somewhere that stays (e.g. Documents\H3-Studio-Local).
2. Optional: make a file here called hf_tokens.txt with one Hugging Face key on the first line (faster downloads).
3. Open the ComfyUI app and wait until it has loaded.
4. Double-click "1 - Setup (run once).bat". It adds the custom nodes the Studio needs and downloads the picture models
   (Krea 2, its uncensored text encoder, Krea 2 Edit, SAM 3 - tens of GB). You can close it and run it again: it carries on
   where it stopped.
5. Restart the ComfyUI app once (so it loads the new nodes).

EVERY TIME
1. Open the ComfyUI app.
2. Double-click "2 - Start Studio.bat" - the Studio opens in your browser (http://127.0.0.1:18190/studio/).
   Keep that black window open while you work; close it to stop.
3. Prompt writer: it starts on "Grok tab". Click "Connect Grok tab" in the Studio (Tampermonkey + the H3 helper, as on the
   rental). The Grok helper connects to your PC the same way it connects to a rental.

YOUR KEYS (same as your Vast template)
Make a file here called keys.txt, one setting per line, copied from your Vast template's environment variables:
  CIVITAI_TOKEN=...            (CivitAI collections, pictures, downloads)
  PROTON_USER=...              (Proton Drive: your characters and settings come back, results are backed up)
  PROTON_PASSWORD=...
  SITE_FACTORY_URL=...         (Your site)
  SITE_FACTORY_TOKEN=...
  NTFY_TOPIC=...               (phone alerts)
Then close and re-open "2 - Start Studio.bat". Keep keys.txt private - don't share or upload it.
(The CivitAI key can also be pasted in the Studio: ⋯ menu → CivitAI key.)

BACKUPS ON GOOGLE DRIVE INSTEAD OF PROTON (optional)
Double-click "3 - Connect Google Drive (optional).bat", sign in to Google in the browser that opens. It adds GDRIVE_TOKEN to
keys.txt and copies the same value: paste it into your Vast template as an environment variable named GDRIVE_TOKEN.
From then on every rental and this PC back up to Google Drive > "H3 Studio" (Google Drive wins if both are set).
The newest backup = the one with your most recent change (characters, settings, presets), not the most recent upload.

YOUR WORK
- With PROTON_USER / PROTON_PASSWORD in keys.txt your newest export comes back by itself, like on a rental.
  Or: on a rental, ⋯ menu → Export (.zip); here, Characters → Import.
- Pictures you make here land in ComfyUI Desktop's output folder.

SPEED
- Setup also downloads a compressed Krea 2 (Q5, ~9 GB) that fits a 16 GB card; the Studio uses it automatically instead of
  the full 12 GB one (which doesn't fit next to everything else, so ComfyUI swaps pieces in and out - minutes per step).
  To go back to the full model, add H3_USE_GGUF=0 to keys.txt.
- Krea 2 Turbo pictures run at most 8 steps here (it's made for 4-8). Change with H3_MAX_STEPS=12 in keys.txt (0 = no cap).
- Close other big programs (browsers with many tabs, games): when your PC's own memory runs low, everything slows down.
- Create → size Draft (~1 MP) is about twice as fast; upscale the keepers later. Fewer LoRAs at once also helps.

IF SOMETHING'S OFF
- "ComfyUI isn't running": open the ComfyUI app first, then reload the Studio page.
- A tab says models are missing: run "1 - Setup (run once).bat" again.
- A node shows as missing in ComfyUI: open ComfyUI's Manager → Install missing custom nodes, then restart ComfyUI.
