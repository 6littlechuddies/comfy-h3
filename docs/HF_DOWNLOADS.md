# Hugging Face downloads: the "key slows to a crawl" problem

Read this before changing anything in `scripts/downloader.py` that touches Hugging Face keys, connections or links.

## What the owner sees (don't forget this)
- A fresh Hugging Face key downloads fast (hundreds of MB/s) for roughly one rental, then the same key drops to a
  crawl (a few MB/s, sometimes KB/s per connection).
- That is why the owner keeps 100+ keys (in `hf_tokens.txt` on Proton Drive, copied to the rental at startup) and why
  the downloader switches keys when Hugging Face gets slow. **Switching keys is wanted — don't remove it.**
- On 2026-10-17 all 106 keys were on one account (6littlechuddies). After a day of rentals every download link
  crawled (2–8 KB/s per connection on a 1.5 Gbps machine), and later the network got a Hugging Face 403:
  "Due to suspicious activity originating from your network, access is temporarily blocked. Try again in ~30 minutes."

## The most likely cause (found 2026-10-17)
Hugging Face limits **requests**, not bytes: every URL containing `/resolve/` counts against the account's
"resolver" limit — 5,000 per 5 minutes on a free account (3,000 per IP anonymous, 12,000 on PRO;
huggingface.co/docs/hub/rate-limits). Over the limit it answers 429 and the client waits/retries, which looks
like a crawl.

The downloader was burning that limit by itself:
- aria2 was given the `huggingface.co/…/resolve/…` link and asked it again for every 16 MB piece, on 16
  connections per file, 8 files at once. 180 GB in 16 MB pieces ≈ 11,500 resolver requests — far over 5,000 per 5
  minutes on a fast machine.
- Every connection slower than 8 KB/s was dropped and reopened 3 seconds later — hundreds more requests a minute
  once things got slow, which is what got the network flagged.
- The download links Hugging Face hands out carry the account's user id, so all keys on one account share the slowdown.

## What the downloader does now
- It resolves each Hugging Face file once (one request with the key), then gives aria2 the **file-server link** Hugging
  Face redirects to (signed, valid about an hour). The pieces are fetched from there and don't count as resolver requests.
  Links are refreshed every 30 minutes and after a key switch.
- 64 MB pieces, 8 connections per file, slow connections are not dropped, 15 s between retries.
- Key switching on slowness is still there.

## Seen on 2026-10-17 after that fix (new account, 5 keys)
Resolving once didn't stop it: a fresh key started at 100–124 MB/s and dropped to ~20 MB/s after about 2 minutes
(~4 GB), with **no 429s**. So Hugging Face also slows a key down by how much it has downloaded — exactly what the owner
described. The answer is the key switching: it now reacts within about a minute (a key counts as slow once it falls
under half of its own best speed on that machine, for 30 s), re-resolves every link with the new key, and when every
key has been tried it goes round again from the one slowed longest ago (keys recover) instead of stopping.

## If it still crawls
- Check the debug report for `status=429` / "Too Many Requests" and for "suspicious activity" 403s.
- Switching to a fresh key brings the speed back (keys are slowed one by one), so keep a modest set of keys (10–20) and
  let the downloader rotate; don't bulk-create hundreds, and keep the downloader calm (no reconnect storms) — that's what
  got the network a "suspicious activity" 403.
- Last resorts: HF PRO (12,000 resolver requests / 5 min), or mirroring the models to the owner's own bucket
  (B2 / R2) — not done because it isn't faster than a healthy Hugging Face, only steadier.
