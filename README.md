# Case Companion – Acquia Support Chrome Extension

A Chrome extension for Acquia support engineers. Opens as a popup on any Salesforce case and shows:

- **Case overview** – Account, Priority, Status, Assigned To, Case Number
- **Instance highlight** – Which application the ticket was raised for
- **Subscriptions & Hosting** – Subscription Title, Product, and Hosting Name (app slugs)
- **AHT Panic Commands** – Click-to-copy `aht @<env>.prod -l` for each hosting environment
- **Private Notes** – Locally-stored (never synced) notes per case for passwords, sensitive context, etc.

---

## Installation (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `salesforce-ext` folder (this folder)
5. The **CC** icon will appear in your Chrome toolbar

---

## Usage

1. Navigate to a Salesforce case: `https://acquia.lightning.force.com/lightning/r/Case/<ID>/view`
2. Wait for the page to fully load
3. Click the **CC** icon in your toolbar
4. The popup shows all case details, subscriptions, and panic commands
5. Click any **Copy** button (or click the row) to copy the AHT command to clipboard
6. Use the **Private Notes** area for sensitive info — saved per case, local only
7. Press **Ctrl+S** inside the notes box to quick-save

---

## How It Works

- `content.js` — Injected into Salesforce pages, scrapes the Lightning DOM for case fields and subscription data
- `popup.js` — Sends a message to the content script and renders the extracted data
- `popup.html` — The UI shell
- Notes are stored in `chrome.storage.local` keyed by case number — private to your browser

---

## Tips

- If data doesn't appear, try **↺ Refresh** in the popup (the page may still be loading)
- The extension attempts to auto-detect `*.prod` slugs from the Instance and Hosting Name fields to build panic commands
- Notes are stored per case number — they persist across sessions but only in your local browser

---

# Acquia-Support-Case-Companion
