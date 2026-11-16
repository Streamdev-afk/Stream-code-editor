# ION Qoders roadmap (owner's plans, in priority order)

Context: ION (Flutter chat app) and ION Qoders (web editor) share one Supabase project (nhiqbargpexlcmbchmtn).
Owner plans to invest roughly 4-5 million naira (about $5,000) at the end of 2026.

## 1. Models + bring-your-own-key (editor first, most important)
- Model picker in the editor with plan gating (free: small model, Plus: bigger Groq models, Pro: frontier via OpenRouter).
- BYOK: OpenRouter + generic "OpenAI-compatible" (base URL, key, model) + an Anthropic adapter.
  Keys stay on the user's device and are sent per request, never logged. BYOK use does not count against limits.
- Credit/token budgets for expensive models. NOT needed for ION character chat (it is just chatting).
- Maybe later: let ION users pick a big model for quick debugging via the ION -> Qoders session link.

## 2. Multiple GitHub repos in the editor
- One account, many repos. Push / Pull / Import each ask "which repo?" with a picker (list via GitHub API),
  plus "create new repo". A project can be linked to more than one repo. Google AI Studio cannot do this.

## 3. GitHub Actions inside the editor
- List workflows, run them (workflow_dispatch), show run status and logs. Needs the `workflow` token scope.

## 4. Build + publish inside the editor
- Build in a sandbox, then publish static sites through a hosting API (Cloudflare Pages / Vercel / Netlify).

## 5. Desktop app (offline editor)
- Wrap the existing React editor with Tauri (small) or Electron. Edit and save files locally offline,
  queue pushes and AI calls until the internet returns. Build Windows / macOS / Linux with GitHub Actions
  (matrix of windows-latest, macos-latest, ubuntu-latest), release via GitHub Releases, auto-update.
- Note: unsigned Windows installers show SmartScreen warnings; macOS needs an Apple developer account to notarize.

## 6. Run-your-code servers (part of paid plans)
- Per-user sandboxed containers with CPU/RAM/time limits, network limits and quotas (untrusted code, mining abuse).
- Start metered (sandbox provider or one VPS with Docker), not a big dedicated server up front.
