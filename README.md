# Play Store Review Recorder (`playstore-review-recorder`)

A complete, production-ready Node.js automation pipeline that fetches pending review recording tasks from an external JSON API, launches an Android virtual device spoofed as a genuine Indian smartphone, records Google Play Store user reviews with natural human scrolling, uploads the MP4 screen recording to Google Drive, and notifies a completion webhook.

---

## 📋 Features

- **Device Spoofing**: Configures the Android virtual device via ADB to mimic a real Indian smartphone (Asia/Kolkata timezone, Kolkata GPS coordinates, randomized battery capacity between 38%–86%, AC power disconnected, Wi-Fi disabled with LTE/5G Mobile Data active).
- **Intelligent Date Matching & Developer Reply Filtering**: Detects review dates (`DD/MM/YYYY` and `D MMM YYYY`), filtering strictly by star rating bar alignment (within 35px center-to-center Y-axis) to completely ignore developer reply timestamps.
- **Three-Phase Human Recording**:
  - **Phase 1 (Frame Lock)**: Scrolls until both `prevDay` (newer date) and `targetDay` (exact date) appear in view (max safety loop: 35 scrolls).
  - **Phase 2 (Record Start)**: Pulls down notification shade, toggles the system Screen Record tile, taps Start, and waits through the 3.5s countdown.
  - **Phase 3 (Human Scroll & Stop Trigger)**: Simulates natural human reading pauses (1800ms–2800ms) with curved Bezier touch gestures until `nextDay` (older date) appears, waits 1500ms, and stops recording.
- **Automated Cloud Upload & Webhook**: Pulls the video directly from `/sdcard/Movies/`, uploads to Google Drive with service account authentication, cleans up local files, and triggers the completion webhook.
- **Automated CI/CD**: Daily GitHub Actions cron schedule (`0 14 * * *` = 7:30 PM IST) using KVM-accelerated Android emulator.

---

## 🔐 Required GitHub Secrets

Configure the following 5 secrets in your repository settings under **Settings > Secrets and variables > Actions**:

| Secret Name | Description | Example Value |
| :--- | :--- | :--- |
| `TASKS_API_URL` | Endpoint to fetch pending recording tasks | `https://api.example.com/api/tasks/pending` |
| `API_SECRET_KEY` | Secret key sent in `x-api-key` request header | `sk_live_9f83b2819a...` |
| `WEBHOOK_COMPLETE_URL` | Webhook notified when video upload completes | `https://api.example.com/api/tasks/completed` |
| `GDRIVE_FOLDER_ID` | Google Drive folder ID to store MP4 recordings | `1B2M3N4O5P6Q7R8S9T0...` |
| `GDRIVE_SERVICE_ACCOUNT_JSON` | Full JSON string of Google Cloud Service Account credentials with Drive API access | `{"type": "service_account", "project_id": "...", ...}` |

---

## 📡 Expected API Formats

### 1. Pending Tasks API (`GET process.env.TASKS_API_URL`)

#### Headers
```http
x-api-key: <API_SECRET_KEY>
```

#### Response Format (200 OK)
```json
{
  "tasks": [
    {
      "task_id": "101",
      "package_name": "com.example.app",
      "target_day": "15/11/2026"
    }
  ]
}
```

*Note: Dates are formatted as `DD/MM/YYYY`.*

---

### 2. Completion Webhook (`POST process.env.WEBHOOK_COMPLETE_URL`)

#### Headers
```http
Content-Type: application/json
x-api-key: <API_SECRET_KEY>
```

#### Request Payload
```json
{
  "task_id": "101",
  "status": "completed",
  "drive_link": "https://drive.google.com/file/d/1XyZ.../view"
}
```

---

## 📁 Project Structure

```
playstore-review-recorder/
├── .github/
│   └── workflows/
│       └── daily-record.yml       # Daily GitHub Actions workflow (7:30 PM IST)
├── src/
│   ├── apiClient.js               # External API & webhook client, date math
│   ├── deviceSpoofer.js           # ADB device spoofing (battery, network, GPS, timezone)
│   ├── scraper.js                 # Appium UIAutomator2 scraper & recording orchestrator
│   └── uploader.js                # Google Drive v3 Service Account uploader
├── .env.example                   # Environment variable template
├── .gitignore
├── package.json
└── README.md
```

---

## ⚙️ Local Development Setup

### 1. Prerequisites
- Node.js `20.x` or later
- Android SDK with platform-tools (`adb`) installed and in `PATH`
- Running Android Emulator or physical device (`emulator-5554`)
- Appium 2 (`npm install -g appium` and `appium driver install uiautomator2`)

### 2. Installation
```bash
git clone <your-repo-url>
cd playstore-review-recorder
npm install
```

### 3. Environment Variables
Copy `.env.example` to `.env` and fill in the values:
```bash
cp .env.example .env
```

### 4. Run Appium Server
```bash
appium --port 4723
```

### 5. Start Automation
```bash
npm start
```

---

## 🔄 How the Automation Works

```
                 +---------------------------+
                 | Fetch Pending Tasks (GET) |
                 +-------------+-------------+
                               |
                               v
                 +---------------------------+
                 |  Spoof Device Attributes  |
                 | (Battery, GPS, TZ, Data)  |
                 +-------------+-------------+
                               |
                               v
                 +---------------------------+
                 | Open Play Store Details   |
                 | market://details?id=...   |
                 +-------------+-------------+
                               |
                               v
                 +---------------------------+
                 |  Sort by "Most recent"    |
                 +-------------+-------------+
                               |
                               v
                 +---------------------------+
                 | Phase 1: Frame Lock       |
                 | (Wait for prevDay &       |
                 |  targetDay on screen)     |
                 +-------------+-------------+
                               |
                               v
                 +---------------------------+
                 | Phase 2: Start Recording  |
                 | (Quick Settings screenrec)|
                 +-------------+-------------+
                               |
                               v
                 +---------------------------+
                 | Phase 3: Human Scroll     |
                 | (1.8s-2.8s pauses until   |
                 |  nextDay appears)         |
                 +-------------+-------------+
                               |
                               v
                 +---------------------------+
                 | Stop Recording & Pull MP4 |
                 +-------------+-------------+
                               |
                               v
                 +---------------------------+
                 | Upload MP4 to GDrive      |
                 +-------------+-------------+
                               |
                               v
                 +---------------------------+
                 | Webhook Notification POST |
                 +---------------------------+
```

1. **Date Math**:
   - `prevDay`: 1 day after `targetDay` (e.g. `16/11/2026`). In Play Store "Most recent" sort, newer reviews appear higher in the feed.
   - `targetDay`: Exact target date (e.g. `15/11/2026`).
   - `nextDay`: 1 day before `targetDay` (e.g. `14/11/2026`), signaling the end boundary of the target date's reviews.
2. **Review Date Verification**:
   - Compares the Y-coordinate of detected dates with star rating bars.
   - Ignores developer reply timestamps because they do not have a corresponding 5-star rating bar within 35 pixels.
3. **Graceful Handling**:
   - Webhook calls are wrapped in robust error handling so intermittent network glitches never disrupt subsequent task execution.
   - Temporary recording files on both the Android device and local disk are purged immediately after Google Drive confirmation.
