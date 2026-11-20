const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Uploads video to Google Drive with automatic fallback:
 * 1. Attempts direct Drive API upload via Service Account (with supportsAllDrives: true).
 * 2. If Service Account has 0 quota on personal drive, uploads via Google Apps Script (runs as User, zero quota limits).
 * 3. Fallback: serves video directly from Render public cloud URL (/videos/<fileName>).
 * 
 * @param {string} filePath Absolute or relative path to the local .mp4 video file
 * @returns {Promise<string>} Shareable link (Drive webViewLink or Render cloud video URL)
 */
async function uploadVideoToDrive(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[Uploader] File not found at path: ${filePath}`);
  }

  const fileName = path.basename(filePath);
  const folderId = process.env.GDRIVE_FOLDER_ID || '12vLF6tCDWzZnELqezqiPi9--Ty7FAQ04';
  const renderHost = process.env.RENDER_EXTERNAL_URL || 'https://playstore-review-recorder.onrender.com';
  const publicRenderVideoUrl = `${renderHost}/videos/${fileName}`;

  // ----------------------------------------------------
  // Strategy 1: Google Drive API (Service Account)
  // ----------------------------------------------------
  const serviceAccountJson = process.env.GDRIVE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    try {
      let credentials;
      try {
        credentials = typeof serviceAccountJson === 'string'
          ? JSON.parse(serviceAccountJson)
          : serviceAccountJson;
      } catch (err) {
        console.warn(`[Uploader] Failed to parse GDRIVE_SERVICE_ACCOUNT_JSON: ${err.message}`);
      }

      if (credentials && credentials.client_email) {
        console.log(`[Uploader] Attempting Drive API upload with service account: ${credentials.client_email}...`);
        const auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive']
        });

        const drive = google.drive({ version: 'v3', auth });
        const fileMetadata = {
          name: fileName,
          parents: folderId ? [folderId] : []
        };
        const media = {
          mimeType: 'video/mp4',
          body: fs.createReadStream(filePath)
        };

        const response = await drive.files.create({
          requestBody: fileMetadata,
          media: media,
          fields: 'id, name, webViewLink, webContentLink',
          supportsAllDrives: true
        });

        const link = response.data.webViewLink || response.data.webContentLink || `https://drive.google.com/file/d/${response.data.id}/view`;
        console.log(`[Uploader] Drive API upload successful! Link: ${link}`);
        return link;
      }
    } catch (driveErr) {
      console.warn(`[Uploader] Drive API returned error: ${driveErr.message}`);
    }
  }

  // ----------------------------------------------------
  // Strategy 2: Google Apps Script Web App (Personal Drive)
  // ----------------------------------------------------
  const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbw4QlgShmtFDJCcxYDAJ_h2UcNDJlcXZ2BRPPoo0mG8pRZwrHkij2WvIQ7nDQuXd7E0uA/exec';
  if (appsScriptUrl) {
    try {
      console.log(`[Uploader] Uploading video via Google Apps Script to folder: ${folderId}...`);
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');

      const scriptRes = await axios.post(appsScriptUrl, {
        action: 'upload_video',
        folder_id: folderId,
        file_name: fileName,
        base64_data: base64Data
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      });

      if (scriptRes.data && scriptRes.data.file_url) {
        console.log(`[Uploader] Google Apps Script uploaded successfully! Link: ${scriptRes.data.file_url}`);
        return scriptRes.data.file_url;
      }
    } catch (scriptErr) {
      console.warn(`[Uploader] Google Apps Script upload warning: ${scriptErr.message}`);
    }
  }

  // ----------------------------------------------------
  // Strategy 3: Render Cloud Video Host URL (Always Works)
  // ----------------------------------------------------
  console.log(`[Uploader] Providing direct Render Cloud video stream URL: ${publicRenderVideoUrl}`);
  return publicRenderVideoUrl;
}

module.exports = {
  uploadVideoToDrive
};
