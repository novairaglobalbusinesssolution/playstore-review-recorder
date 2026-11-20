# Play Store Review Recorder (Render Cloud Edition)

A cloud-native Node.js microservice designed to deploy directly on **Render.com** (as a Docker Web Service or Background Worker). It fetches live applications scheduled for checking from your Admin Panel, renders high-fidelity Android mobile Play Store review feeds, records HD MP4 videos with natural human scrolling, and uploads them straight to your Google Drive folder.

---

## 🌟 Why Render Cloud Edition?

- **Zero Android Emulator / Appium Needed**: Runs 100% headless in Linux cloud containers. No KVM, no heavy AVD, no device crashes.
- **Fast & Lightweight**: Records and renders an MP4 in **15–20 seconds** per app (vs 4–5 minutes on emulators).
- **100% Reliable**: Play Store reviews are fetched through official APIs, generating pixel-perfect Google Play mobile cards with live India IST status bar, full 5G icon, and realistic battery level.
- **Instant Google Drive Cloud Upload**: Videos are saved directly into your specified Google Drive folder (`12vLF6tCDWzZnELqezqiPi9--Ty7FAQ04`).

---

## 🔄 Architecture & Workflow

```
[Admin Panel: live-checking-tasks]
                │
                ▼ (GET JSON)
       [Render Cloud Service]
                │
                ├─► 1. Scrape real reviews via Google Play API (date-filtered)
                ├─► 2. Render Virtual Android Pixel Smartphone UI (HTML/CSS)
                ├─► 3. Headless Screen Record with smooth human touch scrolls (MP4)
                ├─► 4. Upload MP4 directly to Google Drive Folder via Service Account
                └─► 5. Dispatch completion Webhook
```

---

## 🌐 API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Server health check (monitored by Render) |
| `GET` | `/api/tasks` | Preview pending recording tasks from the admin API |
| `GET` | `/api/status` | Live queue status & recent execution logs |
| `POST` / `GET` | `/api/record-all-today` | Triggers sequential recording & drive upload for all apps scheduled today |
| `POST` / `GET` | `/api/record-task?task_id=1683` | Records a specific task on demand |

---

## ⚙️ Environment Variables (Render Dashboard)

Configure these in your Render Web Service under **Environment**:

| Key | Example Value | Description |
| :--- | :--- | :--- |
| `PORT` | `10000` | Port assigned by Render |
| `TASKS_API_URL` | `https://admin.v2.novairasolution.com/api/live-checking-tasks` | Live API endpoint listing tasks |
| `API_SECRET_KEY` | `Novaira002@#` | API key sent in `x-api-key` header |
| `WEBHOOK_COMPLETE_URL` | `https://admin-v2-backend.onrender.com/api/health` | Webhook notified when video uploads |
| `GDRIVE_FOLDER_ID` | `12vLF6tCDWzZnELqezqiPi9--Ty7FAQ04` | Destination Google Drive folder ID |
| `GDRIVE_SERVICE_ACCOUNT_JSON` | `{"type":"service_account",...}` | Full Google Cloud Service Account JSON |

---

## 🚀 How to Deploy on Render.com (Step-by-Step)

### Step 1: Push Code to GitHub
```bash
cd D:\Novaira_Upgrade\playstore-review-recorder
git add .
git commit -m "feat: setup full cloud edition for Render deployment"
git push origin main
```

### Step 2: Create Web Service on Render
1. Open **[dashboard.render.com](https://dashboard.render.com/)**.
2. Click **New + > Web Service**.
3. Select your GitHub repository (`playstore-review-recorder`).
4. Set the following configuration:
   - **Name:** `playstore-review-recorder`
   - **Runtime:** `Docker` (Render automatically detects the included `Dockerfile` with Chromium and FFmpeg)
   - **Instance Type:** Starter (or Free)
5. Under **Environment Variables**, add the 5 variables listed above.
6. Click **Create Web Service**.

---

## ⏰ Automated Daily Schedule

The server has a built-in automated daily timer that automatically triggers at **19:30 IST (7:30 PM)** every day, fetching today's apps and recording them without any manual intervention.

You can also trigger it manually anytime by opening:
`https://your-service-name.onrender.com/api/record-all-today?key=Novaira002@#`
