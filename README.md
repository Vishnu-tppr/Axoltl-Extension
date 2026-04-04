<p align="center">
  <img src="./assets/axoltl-animated.svg" alt="Axoltl Mascot" width="200">
</p>

<h1 align="center">🦎 Axoltl</h1>

<p align="center">
    <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://flutter.dev/"><img src="https://img.shields.io/badge/Flutter-Ready-02569B?logo=flutter" alt="Flutter"></a>
  <a href="https://github.com/Vishnu-tppr"><img src="https://img.shields.io/badge/Maintainer-%40Vishnu--tppr-01696f.svg" alt="Made by Vishnu"></a>
</p>

**When you hit Claude's free usage limit, you shouldn't have to start over.**
Axoltl transfers your full conversation context to ChatGPT, Gemini, or Perplexity
in one click — encrypted end-to-end, no account required, no re-explaining.

Axoltl is your quietly magical AI session companion. It seamlessly carries your ChatGPT, Claude, and overall AI contexts across your devices without dropping a single token. Just like the axolotl regenerates and never loses anything, your sessions are always preserved exactly as you left them.

<p align="center">
    <a href="./README_zh.md">Read in Chinese (中文)</a>
</p>

# Axoltl - Chrome extension for session capture

> The extension watches supported AI web apps, captures the active conversation state, and turns a quota hit into a clean handoff.

---

## what-it-does

This extension is the capture side of Axoltl. It runs on supported provider pages, reads the conversation state that is already visible in the DOM, and turns that state into a handoff bundle. When a quota wall appears, it can switch providers on the same device or send the bundle to the mobile app through the encrypted relay.

That keeps the user on the web clients they already use. The extension does not host the conversation; it preserves it and moves it.

---

## how-it-fits-in

The extension sits closest to the source of truth: the provider web page. It observes the active chat, compresses the captured context, and either injects it into a new provider tab on the same device or encrypts it for delivery to the phone. The popup gives the user a deliberate control surface, while the service worker handles notifications and background orchestration.

```text
claude.ai DOM
     │
     ▼ MutationObserver (claude_scraper.js)
session captured
     │
     ▼ TF-IDF 3-pass compression → LZ4
compressed bundle (~3000 tokens)
     │
     ├─── Switch on same device ──► chatgpt.com?q=[context]
     │
     └─── Send to phone ──► X25519+AES-256-GCM encrypt
                                │
                                ▼ Cloudflare Worker /push
                              relay (opaque ciphertext, 5-min TTL)
                                │
                                ▼ FCM push notification
                           Flutter app receives
```

---

## quick-start

```bash
git clone https://github.com/Vishnu-tppr/Axoltl.git
cd Axoltl/extension
```

Load the folder as an unpacked extension in Chrome, then visit `claude.ai`, `chatgpt.com`, or `gemini.google.com` in a tab that the extension can observe.

---


<div align="center">

```text
┌─────────────────────────────────────────────────────────┐
│                    THE HANDOFF MATRIX                   │
├──────────┬──────────────────────────────────────────────┤
│    A     │ claude.ai → quota wall → chatgpt.com         │
│          │ Same device · One click · Full context       │
├──────────┼──────────────────────────────────────────────┤
│    B     │ Extension → Encrypt → Relay → Push → Phone   │
│          │ Laptop to phone · Encrypted · Any network    │
├──────────┼──────────────────────────────────────────────┤
│    C     │ Phone → QR Code → Chrome → Full Context      │
│          │ Phone to laptop · Scan · Two seconds         │
├──────────┼──────────────────────────────────────────────┤
│    D     │ Account A → Limit → Account B → Intact       │
│          │ Same AI · Fresh quota · Context preserved    │
├──────────┼──────────────────────────────────────────────┤
│    E     │ BLE Beacon → Noise XX → GATT → Offline       │
│          │ Phone to phone · No internet · Encrypted     │
└─────────────────────────────────────────────────────────┘
```

</div>

## ✨ Handoff Matrix & Features

Our core philosophy is absolute context continuity across different hardware and software conditions. Here is how Axoltl handles your data transfers behind the scenes:

### 1. Same Device: App-to-App (Zero BLE)

<table><tr>
<td width="60%">

Transfer context instantly between desktop AI clients natively over local paths.

</td>
<td width="40%">

<img src="./assets/axoltl-handoff-scenario-a.svg" alt="Scenario A" width="100%">

</td>
</tr></table>

### 2. Laptop to Phone (Encrypted Relay + Mobile Browser)

<table><tr>
<td width="60%">

Push your exact session state from your computer to your phone through encrypted relay delivery. On mobile, Axoltl opens ChatGPT or Claude in the browser with a pre-filled `?q=` handoff prompt so the user can tap Send once to continue.

</td>
<td width="40%">

<img src="./assets/axoltl-handoff-scenario-b.svg" alt="Scenario B" width="100%">

</td>
</tr></table>

### 3. Phone to Laptop (Relay + Optional QR)

<table><tr>
<td width="60%">

Move mobile context back to desktop using relay pull, then continue via desktop tab prefill (`?q=`) with extension-assisted injection. Optional QR remains available for explicit user-driven continuation.

</td>
<td width="40%">

<img src="./assets/axoltl-handoff-scenario-c.svg" alt="Scenario C" width="100%">

</td>
</tr></table>


### 4. Same Device: Context Carry (Account Swap)

<table><tr>
<td width="60%">

Working across multiple accounts? Axoltl carries context to the new tab, then you sign in manually to complete the account switch.

</td>
<td width="40%">

<img src="./assets/axoltl-handoff-scenario-d.svg" alt="Scenario D" width="100%">

</td>
</tr></table>

### ☁️ The Cloud Pack & Unpack Protocol
<table><tr>
<td width="60%">

Under the hood, Axoltl securely packages your session and bridges it via short-lived encrypted relay blobs.

</td>
<td width="40%">

<img src="./assets/axoltl-handoff-explain-animated.svg" alt="Handoff Explain" width="100%">

</td>
</tr></table>

## 🏗 Project Architecture

```
axoltl/
├── extension/                  # Chrome Manifest V3 sender
│   ├── manifest.json           # V3 declaration
│   ├── content/
│   │   ├── claude_scraper.js   # claude.ai DOM watcher
│   │   ├── openai_scraper.js   # ChatGPT DOM watcher
│   │   └── quota_detector.js   # Limit detection
│   ├── background/
│   │   └── service_worker.js   # Orchestrator
│   ├── popup/
│   │   ├── popup.html          # UI shell
│   │   ├── popup.js            # State machine
│   │   └── popup.css           # Styling
│   ├── crypto/
│   │   ├── noise.js            # Noise Protocol XX
│   │   └── qrcode.js           # QR encoder
│   ├── assets/
│   │   ├── axoltl-thinking-animated.svg
│   │   └── axoltl-icon-48.svg
|   └── README.md               # This file
└──[Axoltl App](https://github.com/Vishnu-tppr/Axoltl-App.git).
 # App Source file
```

## security

- Content scripts run only on the provider domains listed in `manifest.json`.
- Captured context is compressed locally before any transfer happens.
- X25519 and AES-256-GCM keep same-device and relay transfers encrypted.
- The relay receives only opaque ciphertext; it never needs the plaintext transcript.
- Host permissions are limited to the supported providers and the relay endpoint.
- Quota detection happens in-page, so the extension reacts to the UI state the user can already see.

---

## contributing

Changes that improve provider detection, popup clarity, or bundle correctness are welcome. Keep the capture logic explicit, keep the transfer path short, and do not expand the extension into a chat client.

## 🌟 Star History

<p align="center">
 <a href="https://www.star-history.com/?repos=Vishnu-tppr%2FAxoltl-Extension.git%2CVishnu-tppr%2FAxoltl-App.git&type=date&legend=top-left">
     <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Vishnu-tppr/Axoltl-Extension.git%2CVishnu-tppr/Axoltl-App.git&type=date&theme=dark&legend=top-left" />
          <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Vishnu-tppr/Axoltl-Extension.git%2CVishnu-tppr/Axoltl-App.git&type=date&legend=top-left" />
          <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Vishnu-tppr/Axoltl-Extension.git%2CVishnu-tppr/Axoltl-App.git&type=date&legend=top-left" />
     </picture>
 </a>
</p>

## license

MIT - this repository is released under the MIT License.

Built with ❤️ by [@Vishnu-tppr](https://github.com/Vishnu-tppr).
