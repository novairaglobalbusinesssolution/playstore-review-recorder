const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

/**
 * Upload an MP4 video file to Google Drive using a Service Account
 * @param {string} filePath Absolute or relative path to the local .mp4 video file
 * @returns {Promise<string>} The Google Drive webViewLink of the uploaded file
 */
async function uploadVideoToDrive(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[Uploader] File not found at path: ${filePath}`);
  }

  const serviceAccountJson = process.env.GDRIVE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error('[Uploader] GDRIVE_SERVICE_ACCOUNT_JSON environment variable is not defined.');
  }

  let credentials;
  try {
    credentials = typeof serviceAccountJson === 'string'
      ? JSON.parse(serviceAccountJson)
      : serviceAccountJson;
  } catch (err) {
    throw new Error(`[Uploader] Failed to parse GDRIVE_SERVICE_ACCOUNT_JSON: ${err.message}`);
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });

  const drive = google.drive({ version: 'v3', auth });

  const fileName = path.basename(filePath);
  const folderId = process.env.GDRIVE_FOLDER_ID;

  const fileMetadata = {
    name: fileName,
    parents: folderId ? [folderId] : []
  };

  const media = {
    mimeType: 'video/mp4',
    body: fs.createReadStream(filePath)
  };

  console.log(`[Uploader] Uploading ${fileName} to Google Drive folder: ${folderId || 'root'}...`);

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, name, webViewLink, webContentLink'
  });

  const link = response.data.webViewLink || response.data.webContentLink || `https://drive.google.com/file/d/${response.data.id}/view`;
  console.log(`[Uploader] Upload complete! File ID: ${response.data.id}, Link: ${link}`);
  return link;
}

module.exports = {
  uploadVideoToDrive
};
