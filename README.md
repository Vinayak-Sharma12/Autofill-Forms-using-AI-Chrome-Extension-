# Job Application Auto-Fill AI Agent

A Chrome extension that auto-fills job application forms using your predefined profile and AI-generated answers from your resume.

---

## How It Works (End-to-End)

1. **You set up once**: In the extension Options, you add:
   - **Profile** (First Name, Last Name, Email, Phone, Years of Experience, LinkedIn, etc.)
   - **Resume** (paste text or upload PDF text)
   - **API key** for OpenAI (GPT-4.1) — get one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

2. **On a job form page**: You open the job application link, then click the extension icon.

3. **Extension fills the form**:
   - **Instant fields**: Labels like "First Name", "Last Name", "Email" are filled from your profile.
   - **AI fields**: Questions like "Tell me about a project" or "Describe your experience" are sent to the AI with your resume + question; the AI returns a short answer and the extension fills that field.

4. **You review and submit**: You scroll through the form, edit if needed, and click the site’s Submit button yourself.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Chrome Extension                                                │
├─────────────────────────────────────────────────────────────────┤
│  Options Page     →  Saves: profile, resume text, API key        │
│  Popup            →  "Fill form" button → sends message         │
│  Content Script   →  Runs on job pages, finds inputs, fills them│
│  Background       →  Calls AI API with question + resume         │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  OpenAI API (GPT-4.1)                                             │
│  Input: question + your resume   →   Output: suggested answer   │
└─────────────────────────────────────────────────────────────────┘
```

- **Options**: Where you store profile, resume, and API key (in `chrome.storage.sync` or `local`).
- **Popup**: Single action “Fill form” that tells the content script to start.
- **Content script**: Injected only on pages you choose (e.g. job boards). It:
  - Finds all form fields (input, textarea, select).
  - For each field, gets label/placeholder/name/id.
  - **Direct match**: If it maps to a profile key (e.g. “first name”), fill from profile.
  - **AI match**: If it looks like an open-ended question, ask background to call AI with (question + resume), then fill with the response.
- **Background (service worker)**: Receives “generate answer” requests, calls OpenAI API (GPT-4.1) with resume + question, returns text to content script.

---

## Project Structure

```
AutoFill Job Applicaton AI Agent/
├── manifest.json          # Extension manifest (Manifest V3)
├── README.md              # This file
├── options.html           # Options page UI
├── options.js             # Options logic + save to storage
├── popup.html             # Popup when you click the icon
├── popup.js               # "Fill form" button → message to tab
├── content.js             # Injected in pages; finds & fills fields
├── background.js          # Service worker; AI API calls
├── field-mapping.js       # Profile keys ↔ label patterns
└── icons/                 # Extension icons (16, 48, 128)
```

---

## How to Build It (Step by Step)

### 1. Prerequisites

- **Chrome** (latest)
- **OpenAI API**: Get an API key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). You’ll paste it in the extension Options.
- **Resume**: Plain text version of your resume (copy-paste or export from PDF).

### 2. Install Locally (Developer Mode)

1. Open Chrome → `chrome://extensions/`
2. Turn **Developer mode** ON (top right).
3. Click **Load unpacked** and select this folder (`AutoFill Job Applicaton AI Agent`).
4. Pin the extension so you can click “Fill form” easily.

### 3. Configure the Extension

1. Right-click the extension icon → **Options** (or open from `chrome://extensions` → your extension → Options).
2. Fill in:
   - **Profile**: First name, last name, email, phone, years of experience, LinkedIn, etc.
   - **Resume**: Paste your resume text.
   - **API key**: Your OpenAI API key (from [platform.openai.com](https://platform.openai.com/api-keys)).
3. Click **Save**. Data is stored in Chrome storage.

### 4. Use on a Job Form

1. Go to a job application page (e.g. Greenhouse, Lever, company career page).
2. Click the extension icon → **Fill form**.
3. Wait while direct fields fill and AI fields are generated (you may see a short “Filling…” state).
4. Review every field, edit if needed, then submit with the site’s button.

---

## Making the Extension Available for All Users (Chrome Web Store)

### Requirements

1. **Developer account**
   - One-time fee: **$5 USD** (Chrome Web Store Developer Registration).
   - Sign up: [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

2. **Assets you need**
   - **Icons**: 16×16, 48×48, 128×128 PNG.
   - **Screenshots**: 1280×800 or 640×400 (e.g. options page, popup, form filled).
   - **Promotional tile**: Small (440×280) and marquee (1400×560) for the store listing.
   - **Privacy policy**: Public URL explaining what data the extension stores (profile, resume, API key) and that API key + resume are sent to OpenAI. No account needed if you host a simple static page (e.g. GitHub Pages).

3. **Listing**
   - Short description (max 132 chars).
   - Detailed description (how it works, that users must add their own API key and profile/resume).
   - Category: e.g. **Productivity**.

4. **Packaging**
   - Zip the extension folder (no `node_modules` or `.git` if you add them later).
   - In Developer Dashboard: **New item** → upload zip.

5. **Review**
   - Google reviews the extension (can take a few days). They may ask for a demo video or clarification.
   - After approval, you choose **Published** so it’s available to everyone.

6. **Updates**
   - Bump version in `manifest.json`, zip again, upload as a new version in the same item.

**Important for “all users”**:
- Each user must add **their own** API key and profile/resume. The extension does not ship with or collect API keys; it only stores what the user enters in Options.
- In the store description, state clearly: “Requires your own OpenAI API key and your resume.”

---

## Customization Ideas

- **More profile fields**: Add keys in Options and in `field-mapping.js` (e.g. “Current company”, “Portfolio URL”).
- **Sites**: Restrict `content_scripts` in `manifest.json` to specific job sites, or use a “Run on this site” toggle in the popup.
- **AI provider**: The extension uses OpenAI (GPT-4.1) by default. To switch providers, change `background.js` and the options for “API key” / “API URL”.
- **Safety**: Optional “Confirm before filling” per field for AI-generated answers.

---

## Privacy & Security

- **Stored locally**: Profile, resume, and API key are stored in Chrome storage (sync or local) and are not sent to any server except the AI provider when generating answers.
- **API key**: Stored in your browser only; you are responsible for your API usage and key security.
- **Resume**: Only sent to OpenAI’s API when answering open-ended questions; not shared with third parties except OpenAI.

---

## License

Use and modify as you like. When publishing on the Chrome Web Store, comply with Google’s Developer Program Policies and provide a privacy policy.
# Autofill-Forms-using-AI-Chrome-Extension-
