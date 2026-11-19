const { remote } = require('webdriverio');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { fetchPendingTasks, calculateSurroundingDates, markTaskCompleted } = require('./apiClient');
const { spoofIndianRealDevice } = require('./deviceSpoofer');
const { uploadVideoToDrive } = require('./uploader');

// Month name map for parsing textual review dates (e.g. "15 Nov 2026" or "5 November 2026")
const MONTH_MAP = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

/**
 * Normalizes a raw date string into standard DD/MM/YYYY format
 * Supports:
 * - DD/MM/YYYY or D/M/YYYY (e.g. "15/11/2026", "5/1/2026")
 * - D MMM YYYY or D MMMM YYYY (e.g. "15 Nov 2026", "5 October 2026")
 * @param {string} rawText 
 * @returns {string|null} DD/MM/YYYY or null if not a matching date
 */
function normalizeDateStr(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.trim();

  // Pattern 1: DD/MM/YYYY
  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const dd = String(parseInt(slashMatch[1], 10)).padStart(2, '0');
    const mm = String(parseInt(slashMatch[2], 10)).padStart(2, '0');
    const yyyy = slashMatch[3];
    return `${dd}/${mm}/${yyyy}`;
  }

  // Pattern 2: D MMM YYYY / D MMMM YYYY
  const nameMatch = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (nameMatch) {
    const day = parseInt(nameMatch[1], 10);
    const monthKey = nameMatch[2].toLowerCase();
    const month = MONTH_MAP[monthKey];
    const yyyy = nameMatch[3];
    if (month) {
      const dd = String(day).padStart(2, '0');
      const mm = String(month).padStart(2, '0');
      return `${dd}/${mm}/${yyyy}`;
    }
  }

  return null;
}

/**
 * Simulates a natural human scroll using W3C pointer touch actions
 * with slight horizontal variance (Bezier feel) and randomized duration.
 * 
 * @param {WebdriverIO.Browser} driver 
 * @param {number} distanceRatio Fraction of screen height to scroll (e.g. 0.35)
 * @param {number} durationMin Minimum scroll duration in ms
 * @param {number} durationMax Maximum scroll duration in ms
 */
async function humanScroll(driver, distanceRatio = 0.35, durationMin = 400, durationMax = 700) {
  const { width, height } = await driver.getWindowRect();

  // Start in lower-middle region with slight organic jitter
  const startX = width * 0.5 + (Math.random() * 30 - 15);
  const startY = height * 0.72 + (Math.random() * 40 - 20);

  // Calculate scroll distance and end coordinates
  const distance = height * distanceRatio;
  const endY = Math.max(50, startY - distance);
  const endX = startX + (Math.random() * 40 - 20);

  // Mid-point curve control to produce human-like Bezier arc
  const midX = (startX + endX) / 2 + (Math.random() * 20 - 10);
  const midY = (startY + endY) / 2;

  const duration = Math.floor(Math.random() * (durationMax - durationMin + 1)) + durationMin;

  await driver.action('pointer', { parameters: { pointerType: 'touch' } })
    .move({ duration: 0, x: Math.round(startX), y: Math.round(startY) })
    .down({ button: 0 })
    .pause(Math.floor(Math.random() * 40) + 40)
    .move({ duration: Math.round(duration * 0.45), x: Math.round(midX), y: Math.round(midY) })
    .move({ duration: Math.round(duration * 0.55), x: Math.round(endX), y: Math.round(endY) })
    .up({ button: 0 })
    .perform();

  // Natural post-scroll settle pause
  await driver.pause(Math.floor(Math.random() * 150) + 200);
}

/**
 * Finds all visible user review dates.
 * Matches star rating bars and TextViews with date patterns.
 * Returns only dates whose center Y is within 35px of a star bar's center Y,
 * strictly filtering out developer reply dates.
 * 
 * @param {WebdriverIO.Browser} driver 
 * @returns {Promise<Array<{date: string, rawText: string, centerY: number}>>}
 */
async function getVisibleUserReviewDates(driver) {
  // 1. Find all star rating bars
  const starBars = await driver.$$(
    '//*[contains(@content-desc, "stars out of five stars") or contains(@content-desc, "star out of five stars")]'
  );

  const starYCoords = [];
  for (const bar of starBars) {
    try {
      const loc = await bar.getLocation();
      const size = await bar.getSize();
      starYCoords.push(loc.y + size.height / 2);
    } catch (_) {}
  }

  // 2. Find all visible TextViews matching date patterns
  const textViews = await driver.$$('//android.widget.TextView');
  const dateCandidates = [];

  for (const tv of textViews) {
    try {
      const text = await tv.getText();
      const normalized = normalizeDateStr(text);
      if (normalized) {
        const loc = await tv.getLocation();
        const size = await tv.getSize();
        const centerY = loc.y + size.height / 2;
        dateCandidates.push({
          date: normalized,
          rawText: text,
          centerY
        });
      }
    } catch (_) {}
  }

  // 3. Keep ONLY dates within 35px of a star rating bar's center Y
  const userReviewDates = [];
  for (const candidate of dateCandidates) {
    const isAdjacentToStars = starYCoords.some(
      (starY) => Math.abs(candidate.centerY - starY) <= 35
    );
    if (isAdjacentToStars) {
      userReviewDates.push(candidate);
    }
  }

  // Sort top-to-bottom by Y-coordinate
  userReviewDates.sort((a, b) => a.centerY - b.centerY);
  return userReviewDates;
}

/**
 * Toggles the native Android screen recorder via Quick Settings / Notification Shade
 * @param {WebdriverIO.Browser} driver 
 * @param {'START' | 'STOP'} action 
 */
async function toggleSystemRecorder(driver, action) {
  console.log(`[Recorder] Toggling system screen recorder: ${action}...`);

  if (action === 'START') {
    // 1. Pull down notification shade
    await driver.openNotifications();
    await driver.pause(1000);

    // 2. Swipe down further to expand Quick Settings tiles
    const { width, height } = await driver.getWindowRect();
    await driver.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ duration: 0, x: Math.round(width * 0.5), y: Math.round(height * 0.2) })
      .down({ button: 0 })
      .move({ duration: 350, x: Math.round(width * 0.5), y: Math.round(height * 0.8) })
      .up({ button: 0 })
      .perform();
    await driver.pause(1000);

    // 3. Look for "Screen record" tile
    const recordTileSelector = '//*[@text="Screen record" or @text="Screen Record" or contains(@content-desc, "Screen record") or contains(@content-desc, "Screen Record")]';
    let recordTile = await driver.$(recordTileSelector);

    if (!(await recordTile.isDisplayed())) {
      // Horizontal swipe to find tile on secondary page if needed
      await driver.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ duration: 0, x: Math.round(width * 0.85), y: Math.round(height * 0.3) })
        .down({ button: 0 })
        .move({ duration: 300, x: Math.round(width * 0.15), y: Math.round(height * 0.3) })
        .up({ button: 0 })
        .perform();
      await driver.pause(800);
      recordTile = await driver.$(recordTileSelector);
    }

    if (await recordTile.isDisplayed()) {
      await recordTile.click();
      await driver.pause(1000);

      // 4. Click the confirmation "Start" button
      const startButton = await driver.$('//*[@text="Start" or @text="START" or @resource-id="android:id/button1"]');
      if (await startButton.isDisplayed()) {
        await startButton.click();
      }
    } else {
      console.warn('[Recorder] Quick Settings tile not found directly; attempting fallback adb start...');
      // Fallback: trigger system dialog or background capture
      try {
        execSync('adb shell am start-activity -a android.intent.action.MAIN -c com.android.systemui/.screenrecord.ScreenRecordDialog', { stdio: 'ignore' });
        await driver.pause(800);
        const startBtn = await driver.$('//*[@text="Start" or @text="START" or @resource-id="android:id/button1"]');
        if (await startBtn.isDisplayed()) await startBtn.click();
      } catch (_) {}
    }

    // Wait 3.5s for the 3-2-1 screen record countdown
    console.log('[Recorder] Waiting 3.5s for 3-2-1 recording countdown...');
    await driver.pause(3500);

  } else if (action === 'STOP') {
    // 1. Pull down notifications
    await driver.openNotifications();
    await driver.pause(1000);

    // 2. Click "Stop" notification action button
    const stopButtonSelector = '//*[@text="Stop" or @text="STOP" or contains(@content-desc, "Stop") or @resource-id="com.android.systemui:id/stop_button" or @resource-id="android:id/action0"]';
    const stopButton = await driver.$(stopButtonSelector);

    if (await stopButton.isDisplayed()) {
      await stopButton.click();
      console.log('[Recorder] Stop recording button tapped.');
    } else {
      console.warn('[Recorder] Screen record Stop button not found in notifications; attempting adb signal...');
      try {
        execSync('adb shell pkill -INT screenrecord', { stdio: 'ignore' });
      } catch (_) {}
    }

    // Allow time for Android MediaRecorder to finalize and write the MP4 container
    await driver.pause(2500);
    // Dismiss notifications shade back to app
    try {
      await driver.back();
    } catch (_) {}
  }
}

/**
 * Searches /sdcard/Movies/ for the most recently created .mp4 recording
 * @returns {string|null} Remote file path on Android device
 */
function findLatestRecordedVideoPath() {
  try {
    const cmd = 'adb shell "ls -t /sdcard/Movies/*.mp4 /sdcard/Movies/*/*.mp4 /sdcard/DCIM/Screenrecords/*.mp4 2>/dev/null"';
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const files = output.split(/\r?\n/).map(f => f.trim()).filter(Boolean);
    if (files.length > 0) {
      return files[0];
    }
  } catch (_) {}
  return null;
}

/**
 * Main scraper orchestration function
 */
async function run() {
  console.log('====================================================');
  console.log(' Play Store Review Recorder - Starting Execution    ');
  console.log('====================================================');

  // Step 1: Fetch pending tasks
  const tasks = await fetchPendingTasks();
  if (!tasks || tasks.length === 0) {
    console.log('No pending tasks found.');
    process.exit(0);
  }

  console.log(`[Main] Discovered ${tasks.length} task(s) to process.`);

  // Step 2: Connect to Appium
  const appiumPort = parseInt(process.env.APPIUM_PORT || '4723', 10);
  const appiumHost = process.env.APPIUM_HOST || '127.0.0.1';

  console.log(`[Main] Connecting to Appium at ${appiumHost}:${appiumPort}...`);
  const driver = await remote({
    protocol: 'http',
    hostname: appiumHost,
    port: appiumPort,
    path: '/',
    capabilities: {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'emulator-5554',
      'appium:noReset': true,
      'appium:newCommandTimeout': 240
    }
  });

  try {
    // Process each task sequentially
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      console.log(`\n----------------------------------------------------`);
      console.log(`[Task ${i + 1}/${tasks.length}] ID: ${task.task_id} | Package: ${task.package_name} | Target: ${task.target_day}`);
      console.log(`----------------------------------------------------`);

      // 1. Spoof device as an Indian smartphone
      spoofIndianRealDevice();

      // 2. Calculate surrounding dates
      const { prevDay, targetDay, nextDay } = calculateSurroundingDates(task.target_day);
      console.log(`[Dates] prevDay (newer): ${prevDay} | targetDay: ${targetDay} | nextDay (older): ${nextDay}`);

      // 3. Open Play Store app details via deepLink
      const deepLinkUrl = `market://details?id=${task.package_name}`;
      console.log(`[Navigation] Launching Play Store details for ${task.package_name}...`);
      await driver.execute('mobile: deepLink', {
        url: deepLinkUrl,
        package: 'com.android.vending'
      });
      await driver.pause(3500);

      // 4. Scroll slightly and click "See all reviews"
      console.log('[Navigation] Navigating to reviews page...');
      let seeAllReviewsFound = false;
      for (let s = 0; s < 4; s++) {
        const seeAllBtn = await driver.$(
          '//*[contains(@text, "See all reviews") or contains(@content-desc, "See all reviews")]'
        );
        if (await seeAllBtn.isDisplayed()) {
          console.log('[Navigation] Found "See all reviews" button. Clicking...');
          await seeAllBtn.click();
          seeAllReviewsFound = true;
          break;
        }
        await humanScroll(driver, 0.35, 450, 650);
        await driver.pause(600);
      }

      if (!seeAllReviewsFound) {
        console.warn('[Navigation] "See all reviews" button not found directly. Continuing from current view...');
      }
      await driver.pause(2000);

      // 5. Select "Most recent" sorting
      console.log('[Sorting] Selecting "Most recent" sort chip...');
      try {
        const sortChip = await driver.$(
          '//*[contains(@text, "Most relevant") or contains(@content-desc, "Most relevant")]'
        );
        if (await sortChip.isDisplayed()) {
          await sortChip.click();
          await driver.pause(1000);

          const mostRecentOption = await driver.$(
            '//*[@text="Most recent" or contains(@text, "Most recent")]'
          );
          if (await mostRecentOption.isDisplayed()) {
            await mostRecentOption.click();
            console.log('[Sorting] Applied "Most recent" sort filter.');
          }
        }
      } catch (err) {
        console.warn(`[Sorting] Could not toggle sort filter: ${err.message}`);
      }
      await driver.pause(2000);

      // Phase 1 (Frame Lock):
      // Scroll until both prevDay and targetDay are visible on screen (max 35 scrolls)
      console.log(`[Phase 1] Frame Lock: Searching for both prevDay (${prevDay}) and targetDay (${targetDay})...`);
      let frameLocked = false;
      for (let scrollCount = 1; scrollCount <= 35; scrollCount++) {
        const visibleDates = await getVisibleUserReviewDates(driver);
        const dateStrings = visibleDates.map(d => d.date);
        console.log(`[Phase 1][Scroll ${scrollCount}/35] Visible dates on screen:`, dateStrings);

        const hasPrevDay = dateStrings.includes(prevDay);
        const hasTargetDay = dateStrings.includes(targetDay);

        if (hasPrevDay && hasTargetDay) {
          console.log(`[Phase 1] SUCCESS: Frame locked! Found both ${prevDay} and ${targetDay}.`);
          frameLocked = true;
          break;
        }

        await humanScroll(driver, 0.28, 450, 650);
        await driver.pause(800);
      }

      if (!frameLocked) {
        console.warn(`[Phase 1] Safety limit reached (35 scrolls) without locking both dates. Proceeding to record...`);
      }

      // Phase 2 (Record Start):
      console.log('[Phase 2] Starting system screen recording...');
      await toggleSystemRecorder(driver, 'START');

      // Phase 3 (Human Scroll & Stop Trigger):
      // Loop with natural reading pauses (1800ms–2800ms) and humanScroll()
      // until nextDay's first user review date appears on screen (max 45 scrolls)
      console.log(`[Phase 3] Human scrolling until nextDay (${nextDay}) appears...`);
      let nextDayDetected = false;

      for (let scrollCount = 1; scrollCount <= 45; scrollCount++) {
        // Natural reading pause
        const readingPause = Math.floor(Math.random() * (2800 - 1800 + 1)) + 1800;
        console.log(`[Phase 3][Scroll ${scrollCount}/45] Reading pause: ${readingPause}ms...`);
        await driver.pause(readingPause);

        // Perform smooth human-like scroll
        await humanScroll(driver, 0.32, 500, 750);

        // Check visible dates
        const visibleDates = await getVisibleUserReviewDates(driver);
        const dateStrings = visibleDates.map(d => d.date);
        console.log(`[Phase 3][Scroll ${scrollCount}/45] Visible review dates:`, dateStrings);

        if (dateStrings.includes(nextDay)) {
          console.log(`[Phase 3] DETECTED nextDay (${nextDay})! Stopping recording trigger.`);
          nextDayDetected = true;
          break;
        }
      }

      if (!nextDayDetected) {
        console.warn(`[Phase 3] Max scrolls (45) reached without detecting nextDay (${nextDay}). Concluding recording.`);
      }

      // Wait 1500ms before stopping recorder as required
      await driver.pause(1500);
      await toggleSystemRecorder(driver, 'STOP');

      // Step 6: Pull the recorded MP4 file
      const formattedDateForFile = targetDay.replace(/\//g, '-');
      const localFileName = `Review_${task.package_name}_${formattedDateForFile}.mp4`;
      const localFilePath = path.resolve(process.cwd(), localFileName);

      const remoteVideo = findLatestRecordedVideoPath();
      if (!remoteVideo) {
        throw new Error('[Video] Could not locate recorded .mp4 file in /sdcard/Movies/ on device.');
      }

      console.log(`[Video] Pulling recorded video from ${remoteVideo} to ${localFilePath}...`);
      execSync(`adb pull "${remoteVideo}" "${localFilePath}"`, { stdio: 'inherit' });

      // Clean up remote video to prevent storage leak and duplicate detection
      try {
        execSync(`adb shell rm -f "${remoteVideo}"`, { stdio: 'ignore' });
      } catch (_) {}

      // Step 7: Upload to Google Drive
      console.log(`[Drive] Uploading ${localFileName} to Google Drive...`);
      const driveLink = await uploadVideoToDrive(localFilePath);
      console.log(`[Drive] Upload successful: ${driveLink}`);

      // Delete local MP4 file
      if (fs.existsSync(localFilePath)) {
        fs.unlinkSync(localFilePath);
        console.log(`[Cleanup] Deleted local temporary video file: ${localFilePath}`);
      }

      // Step 8: Mark task completed via webhook
      await markTaskCompleted(task.task_id, driveLink);
      console.log(`[Task ${task.task_id}] Processed and finalized successfully.`);
    }

  } catch (err) {
    console.error(`[Main] Fatal error occurred during execution: ${err.message}`, err);
    process.exitCode = 1;
  } finally {
    console.log('[Main] Cleaning up Appium session...');
    try {
      await driver.deleteSession();
    } catch (_) {}
    console.log('[Main] Execution cycle finished.');
  }
}

module.exports = {
  run,
  humanScroll,
  getVisibleUserReviewDates,
  toggleSystemRecorder,
  normalizeDateStr,
  findLatestRecordedVideoPath
};

// Execute runner if invoked directly from CLI
if (require.main === module) {
  run().catch((err) => {
    console.error('[Main] Unhandled rejection:', err);
    process.exit(1);
  });
}

