const puppeteer = require('puppeteer');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');
const path = require('path');
const fs = require('fs');
const gplayModule = require('google-play-scraper');
const gplay = gplayModule.default || gplayModule;

const { fetchPendingTasks, calculateSurroundingDates, markTaskCompleted } = require('./apiClient');
const { uploadVideoToDrive } = require('./uploader');

/**
 * Normalizes input date to standard DD/MM/YYYY
 */
function normalizeDateStr(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[3].padStart(2, '0')}/${isoMatch[2].padStart(2, '0')}/${isoMatch[1]}`;
  }
  const slashMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slashMatch) {
    return `${slashMatch[1].padStart(2, '0')}/${slashMatch[2].padStart(2, '0')}/${slashMatch[3]}`;
  }
  return str;
}

/**
 * Returns formatted time in Asia/Kolkata (e.g. "11:42")
 */
function getKolkataTime() {
  const d = new Date();
  return d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/**
 * Generates an authentic Android smartphone Play Store UI template in HTML
 */
function generatePlayStoreHtml({ appInfo, reviews, targetDay }) {
  const currentTime = getKolkataTime();
  const batteryLevel = Math.floor(Math.random() * (85 - 65 + 1)) + 65;

  const reviewCardsHtml = (reviews && reviews.length > 0 ? reviews : [
    {
      userName: 'Verified User',
      rating: 5,
      date: targetDay,
      content: 'Smooth interface, fast and very reliable application. Works perfectly!'
    }
  ]).map((rev, index) => {
    const avatarLetter = (rev.userName && rev.userName.length > 0) ? rev.userName[0].toUpperCase() : 'U';
    const bgColors = ['#1a73e8', '#e91e63', '#9c27b0', '#009688', '#ff5722', '#3f51b5', '#00bcd4'];
    const avatarBg = bgColors[index % bgColors.length];
    const starsHtml = '★'.repeat(rev.rating || 5) + '☆'.repeat(5 - (rev.rating || 5));

    return `
      <div class="review-card">
        <div class="review-header">
          <div class="user-avatar" style="background-color: ${avatarBg};">
            ${rev.userImage ? `<img src="${rev.userImage}" alt="${avatarLetter}" onerror="this.style.display='none';">` : ''}
            <span>${avatarLetter}</span>
          </div>
          <div class="user-meta">
            <div class="user-name">${rev.userName || 'Android User'}</div>
            <div class="rating-row">
              <span class="stars-green">${starsHtml}</span>
              <span class="review-date">${rev.date || targetDay}</span>
            </div>
          </div>
          <div class="review-menu">⋮</div>
        </div>
        <div class="review-body">
          ${rev.content || 'Great app, very intuitive and helpful.'}
        </div>
        <div class="review-footer">
          <span class="helpful-text">Was this review helpful?</span>
          <span class="helpful-btn">Yes</span>
          <span class="helpful-btn">No</span>
        </div>
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${appInfo.title || 'Google Play'}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Roboto', 'Google Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    body {
      background-color: #ffffff;
      color: #202124;
      width: 412px;
      margin: 0 auto;
      overflow-x: hidden;
    }

    /* Android Status Bar */
    .status-bar {
      height: 38px;
      background: #ffffff;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 16px;
      font-size: 13px;
      font-weight: 600;
      color: #3c4043;
      position: sticky;
      top: 0;
      z-index: 1000;
      border-bottom: 1px solid rgba(0,0,0,0.04);
    }
    .status-icons {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
    }
    .badge-5g {
      font-weight: 800;
      font-size: 10px;
      letter-spacing: -0.5px;
    }
    .battery-icon {
      border: 1.5px solid #3c4043;
      border-radius: 3px;
      padding: 1px 2px;
      font-size: 9px;
      font-weight: 700;
    }

    /* Google Play App Bar */
    .app-bar {
      height: 54px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      background: #ffffff;
    }
    .app-bar-left {
      display: flex;
      align-items: center;
      gap: 20px;
      font-size: 18px;
      font-weight: 500;
    }
    .icon-btn {
      cursor: pointer;
      font-size: 19px;
      color: #5f6368;
    }

    /* App Details Header */
    .app-hero {
      display: flex;
      padding: 16px;
      gap: 16px;
      align-items: flex-start;
    }
    .app-icon {
      width: 72px;
      height: 72px;
      border-radius: 18px;
      object-fit: cover;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12);
    }
    .app-titles {
      flex: 1;
    }
    .app-name {
      font-size: 20px;
      font-weight: 600;
      line-height: 1.25;
      color: #202124;
    }
    .app-developer {
      color: #01875f;
      font-size: 13px;
      font-weight: 600;
      margin-top: 4px;
    }
    .app-tag {
      font-size: 11px;
      color: #5f6368;
      margin-top: 2px;
    }

    /* Stat Pills */
    .app-stats-row {
      display: flex;
      justify-content: space-around;
      padding: 12px 16px;
      border-bottom: 1px solid #f1f3f4;
      text-align: center;
    }
    .stat-box {
      flex: 1;
      border-right: 1px solid #e8eaed;
    }
    .stat-box:last-child {
      border-right: none;
    }
    .stat-val {
      font-size: 14px;
      font-weight: 700;
      color: #202124;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;
    }
    .stat-label {
      font-size: 11px;
      color: #5f6368;
      margin-top: 2px;
    }

    /* Ratings & Reviews Section */
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 16px 8px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #202124;
    }

    /* Rating Summary Box */
    .ratings-summary {
      display: flex;
      padding: 8px 16px 14px;
      align-items: center;
      gap: 24px;
    }
    .rating-big-score {
      font-size: 48px;
      font-weight: 700;
      line-height: 1;
      color: #202124;
    }
    .rating-big-stars {
      color: #01875f;
      font-size: 14px;
      margin-top: 4px;
    }
    .rating-count-sub {
      font-size: 11px;
      color: #5f6368;
      margin-top: 4px;
    }
    .bars-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .bar-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: #5f6368;
    }
    .bar-track {
      flex: 1;
      height: 8px;
      background: #e8eaed;
      border-radius: 4px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: #01875f;
      border-radius: 4px;
    }

    /* Filter Chips */
    .chips-bar {
      display: flex;
      gap: 8px;
      padding: 8px 16px 16px;
      overflow-x: auto;
    }
    .chip {
      padding: 6px 12px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      border: 1px solid #dadce0;
      color: #3c4043;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .chip.active {
      background: #e6f4ea;
      border-color: #ceead6;
      color: #0d652d;
      font-weight: 700;
    }

    /* Review Cards */
    .reviews-list {
      padding: 0 16px 32px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .review-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .review-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .user-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      font-weight: 700;
      font-size: 15px;
      overflow: hidden;
      position: relative;
    }
    .user-avatar img {
      position: absolute;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .user-meta {
      flex: 1;
    }
    .user-name {
      font-size: 13px;
      font-weight: 600;
      color: #202124;
    }
    .rating-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 2px;
    }
    .stars-green {
      color: #01875f;
      font-size: 11px;
      letter-spacing: 1px;
    }
    .review-date {
      font-size: 11px;
      color: #5f6368;
    }
    .review-menu {
      color: #5f6368;
      font-size: 16px;
    }
    .review-body {
      font-size: 13px;
      line-height: 1.45;
      color: #3c4043;
    }
    .review-footer {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 11px;
      color: #5f6368;
      margin-top: 4px;
    }
    .helpful-btn {
      color: #5f6368;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <!-- Real Android Status Bar -->
  <div class="status-bar">
    <span>${currentTime}</span>
    <div class="status-icons">
      <span class="badge-5g">5G</span>
      <span>📶</span>
      <span class="battery-icon">${batteryLevel}%</span>
    </div>
  </div>

  <!-- Play Store App Bar -->
  <div class="app-bar">
    <div class="app-bar-left">
      <span class="icon-btn">←</span>
      <span>Ratings and reviews</span>
    </div>
    <span class="icon-btn">🔍</span>
  </div>

  <!-- App Hero Summary -->
  <div class="app-hero">
    <img class="app-icon" src="${appInfo.icon || 'https://via.placeholder.com/72'}" alt="Icon">
    <div class="app-titles">
      <h1 class="app-name">${appInfo.title || 'App Details'}</h1>
      <div class="app-developer">${appInfo.developer || 'Google Commerce Ltd'}</div>
      <div class="app-tag">In-app purchases • Verified</div>
    </div>
  </div>

  <!-- Stats Grid -->
  <div class="app-stats-row">
    <div class="stat-box">
      <div class="stat-val">${appInfo.scoreText || '4.8'} ★</div>
      <div class="stat-label">${appInfo.reviews ? appInfo.reviews.toLocaleString() : '10K+'} reviews</div>
    </div>
    <div class="stat-box">
      <div class="stat-val">10M+</div>
      <div class="stat-label">Downloads</div>
    </div>
    <div class="stat-box">
      <div class="stat-val">Rated 3+</div>
      <div class="stat-label">Everyone</div>
    </div>
  </div>

  <!-- Summary Chart -->
  <div class="ratings-summary">
    <div>
      <div class="rating-big-score">${appInfo.scoreText || '4.8'}</div>
      <div class="rating-big-stars">★★★★★</div>
      <div class="rating-count-sub">${appInfo.ratings ? appInfo.ratings.toLocaleString() : '25,480'} ratings</div>
    </div>
    <div class="bars-container">
      <div class="bar-row"><span>5</span><div class="bar-track"><div class="bar-fill" style="width: 82%;"></div></div></div>
      <div class="bar-row"><span>4</span><div class="bar-track"><div class="bar-fill" style="width: 11%;"></div></div></div>
      <div class="bar-row"><span>3</span><div class="bar-track"><div class="bar-fill" style="width: 4%;"></div></div></div>
      <div class="bar-row"><span>2</span><div class="bar-track"><div class="bar-fill" style="width: 2%;"></div></div></div>
      <div class="bar-row"><span>1</span><div class="bar-track"><div class="bar-fill" style="width: 1%;"></div></div></div>
    </div>
  </div>

  <!-- Filter Chips with "Most recent" Checked -->
  <div class="chips-bar">
    <div class="chip active">✓ Most recent</div>
    <div class="chip">5★</div>
    <div class="chip">Positive</div>
    <div class="chip">Critical</div>
  </div>

  <!-- Live Review Feed -->
  <div class="reviews-list">
    ${reviewCardsHtml}
  </div>
</body>
</html>
  `;
}

/**
 * Cloud Native Play Store Review Video Recorder
 * Runs 100% inside Render without an Android emulator
 */
async function recordPlayStoreReviewVideo({ task_id, package_name, target_day, app_name }) {
  console.log(`\n======================================================`);
  console.log(`[CloudRecorder] Starting video record for Task #${task_id}`);
  console.log(`[CloudRecorder] Package: ${package_name} | Target: ${target_day}`);
  console.log(`======================================================`);

  const formattedTargetDay = normalizeDateStr(target_day);

  // Step 1: Scrape App details and real reviews via Google Play API
  let appInfo = {
    title: app_name || package_name,
    developer: 'Developer',
    scoreText: '4.8',
    icon: ''
  };

  try {
    const fetchedApp = await gplay.app({ appId: package_name, country: 'in', lang: 'en' });
    if (fetchedApp) appInfo = fetchedApp;
  } catch (err) {
    console.warn(`[CloudRecorder] Could not fetch remote app metadata: ${err.message}`);
  }

  let scrapedReviews = [];
  try {
    console.log(`[CloudRecorder] Fetching Play Store reviews for ${package_name}...`);
    const revRes = await gplay.reviews({
      appId: package_name,
      sort: gplay.sort ? gplay.sort.NEWEST : 2,
      num: 80,
      country: 'in',
      lang: 'en'
    });
    scrapedReviews = (revRes && revRes.data) || [];
    console.log(`[CloudRecorder] Retrieved ${scrapedReviews.length} real reviews from Play Store.`);
  } catch (err) {
    console.warn(`[CloudRecorder] Reviews fetch warning: ${err.message}`);
  }

  // Format scraped reviews
  const formattedReviews = scrapedReviews.map((r) => {
    let revDateStr = formattedTargetDay;
    if (r.date) {
      const d = new Date(r.date);
      revDateStr = d.toLocaleDateString('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    }
    return {
      userName: r.userName || 'Verified User',
      userImage: r.userImage || '',
      rating: r.score || 5,
      date: revDateStr,
      content: r.text || 'Good application, works smoothly.'
    };
  });

  // Step 2: Build HTML content
  const htmlContent = generatePlayStoreHtml({
    appInfo,
    reviews: formattedReviews.length > 0 ? formattedReviews : null,
    targetDay: formattedTargetDay
  });

  // Step 3: Setup video paths
  const tempDir = path.resolve(process.cwd(), 'temp_videos');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const safeDateStr = formattedTargetDay.replace(/[/-]/g, '-');
  const videoFileName = `Review_${package_name}_${safeDateStr}.mp4`;
  const outputVideoPath = path.join(tempDir, videoFileName);

  // Step 4: Launch Puppeteer in headless mobile mode
  console.log('[CloudRecorder] Launching headless browser for screen recording...');
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process'
    ]
  });

  const page = await browser.newPage();
  // Exact smartphone viewport (Pixel / Galaxy aspect ratio)
  await page.setViewport({
    width: 412,
    height: 915,
    deviceScaleFactor: 2
  });

  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  // Step 5: Start screen recorder
  const recorder = new PuppeteerScreenRecorder(page, {
    fps: 30,
    videoFrame: { width: 412, height: 915 }
  });

  console.log(`[CloudRecorder] Recording video to ${videoFileName}...`);
  await recorder.start(outputVideoPath);

  // Initial reading pause on header
  await new Promise(r => setTimeout(r, 2200));

  // Perform natural scrolling down the review cards
  const totalScrollSteps = Math.min(18, Math.max(8, formattedReviews.length));
  for (let s = 1; s <= totalScrollSteps; s++) {
    await page.evaluate(() => {
      window.scrollBy({ top: 220, behavior: 'smooth' });
    });
    // Natural human reading pause between scrolls (1.5s to 2.2s)
    const pauseTime = Math.floor(Math.random() * (2200 - 1500 + 1)) + 1500;
    await new Promise(r => setTimeout(r, pauseTime));
  }

  // Final hold
  await new Promise(r => setTimeout(r, 1800));

  // Stop recording and finalize MP4
  console.log('[CloudRecorder] Finalizing MP4 container...');
  await recorder.stop();
  await browser.close();

  if (!fs.existsSync(outputVideoPath)) {
    throw new Error(`Video file failed to generate at ${outputVideoPath}`);
  }

  const fileSizeMB = (fs.statSync(outputVideoPath).size / (1024 * 1024)).toFixed(2);
  console.log(`[CloudRecorder] Video rendered successfully! File: ${videoFileName} (${fileSizeMB} MB)`);

  // Step 6: Upload to Google Drive / Apps Script or serve via Render Host
  let driveLink = '';
  try {
    driveLink = await uploadVideoToDrive(outputVideoPath);
    console.log(`[CloudRecorder] Video shareable link: ${driveLink}`);
  } catch (uploadErr) {
    console.warn(`[CloudRecorder] Upload warning: ${uploadErr.message}`);
    const renderHost = process.env.RENDER_EXTERNAL_URL || 'https://playstore-review-recorder.onrender.com';
    driveLink = `${renderHost}/videos/${videoFileName}`;
  }

  // Step 7: Only delete local temp file if it was uploaded to an external cloud (Google Drive)
  // If it's being served directly from Render's /videos, keep it so it's streamable and downloadable!
  if (driveLink && !driveLink.includes('/videos/') && fs.existsSync(outputVideoPath)) {
    fs.unlinkSync(outputVideoPath);
    console.log(`[CloudRecorder] Temporary video cleaned up.`);
  }

  // Step 8: Notify completion webhook
  await markTaskCompleted(task_id, driveLink);

  return {
    success: true,
    task_id,
    package_name,
    target_day: formattedTargetDay,
    drive_link: driveLink
  };
}

/**
 * Batch processes all pending tasks fetched from TASKS_API_URL
 */
async function processAllPendingTasks() {
  console.log('\n======================================================');
  console.log(' Starting Batch Review Recording for All Pending Tasks');
  console.log('======================================================');

  const tasks = await fetchPendingTasks();
  if (!tasks || tasks.length === 0) {
    console.log('[Batch] No pending recording tasks discovered.');
    return { success: true, count: 0, results: [] };
  }

  console.log(`[Batch] Found ${tasks.length} pending task(s) to process.`);
  const results = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    console.log(`\n>>> Processing Task [${i + 1}/${tasks.length}] ID #${task.task_id} (${task.package_name})...`);
    try {
      const res = await recordPlayStoreReviewVideo({
        task_id: task.task_id,
        package_name: task.package_name,
        target_day: task.target_day,
        app_name: task.app_name || task.package_name
      });
      results.push(res);
    } catch (err) {
      console.error(`[Batch] Error processing Task #${task.task_id}: ${err.message}`);
      results.push({ success: false, task_id: task.task_id, error: err.message });
    }
  }

  console.log('\n======================================================');
  console.log(`[Batch] Completed all ${tasks.length} tasks!`);
  console.log('======================================================');
  return { success: true, count: results.length, results };
}

module.exports = {
  recordPlayStoreReviewVideo,
  processAllPendingTasks,
  generatePlayStoreHtml,
  normalizeDateStr
};

// Direct CLI execution
if (require.main === module) {
  require('dotenv').config();
  processAllPendingTasks().catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}
