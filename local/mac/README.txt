H3 Hugging Face key helper for macOS

Install (Terminal):
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/6littlechuddies/comfy-h3/main/local/mac/install.sh)"

What it does: when you press "Get a fresh key from my PC" on a rental's start page, the rental leaves
H3 Studio/hf_key_request.txt on your Google Drive. This Mac checks once a minute (in the background, no window),
signs in to Hugging Face in a hidden browser, makes the keys and adds them to H3 Studio/hf_tokens.txt.

- Passwords live in the Mac's Keychain (service "h3-hf-key-helper"), never in a file or the repo.
- Shortcuts are in your home folder, "H3 Key Helper": Make a key now, Log in (show window), Status,
  Add a Hugging Face account, Uninstall.
- If Hugging Face wants a code or the password changed, you'll get a notification: open "Log in (show window)" once.
- Files: ~/Library/Application Support/H3KeyHelper (helper.log is the log; keys are shown only as hf_ab…yz).
