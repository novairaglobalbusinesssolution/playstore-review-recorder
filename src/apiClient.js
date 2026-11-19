const axios = require('axios');

/**
 * Fetch pending review recording tasks from external JSON API
 * @returns {Promise<Array<{task_id: string|number, package_name: string, target_day: string}>>}
 */
async function fetchPendingTasks() {
  const apiUrl = process.env.TASKS_API_URL;
  const apiKey = process.env.API_SECRET_KEY;

  if (!apiUrl) {
    console.warn('[ApiClient] TASKS_API_URL environment variable is not defined.');
    return [];
  }

  try {
    console.log(`[ApiClient] Fetching pending tasks from ${apiUrl}...`);
    const response = await axios.get(apiUrl, {
      headers: {
        'x-api-key': apiKey || ''
      },
      timeout: 15000
    });

    if (response.data && Array.isArray(response.data.tasks)) {
      console.log(`[ApiClient] Retrieved ${response.data.tasks.length} task(s).`);
      return response.data.tasks;
    }

    console.warn('[ApiClient] Response did not contain a valid tasks array:', response.data);
    return [];
  } catch (error) {
    console.error(`[ApiClient] Error fetching tasks: ${error.message}`);
    return [];
  }
}

/**
 * Calculates surrounding dates for Play Store review sorting (newest first).
 * In reverse chronological order:
 * - prevDay: 1 day after targetDay (seen earlier in scroll)
 * - targetDay: exact target date
 * - nextDay: 1 day before targetDay (seen later in scroll)
 * 
 * @param {string} targetDayStr Date in DD/MM/YYYY format
 * @returns {{prevDay: string, targetDay: string, nextDay: string}}
 */
function calculateSurroundingDates(targetDayStr) {
  if (!targetDayStr || typeof targetDayStr !== 'string') {
    throw new Error(`Invalid targetDayStr: ${targetDayStr}`);
  }

  const parts = targetDayStr.trim().split('/');
  if (parts.length !== 3) {
    throw new Error(`Date format must be DD/MM/YYYY, received: ${targetDayStr}`);
  }

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);

  const targetDate = new Date(Date.UTC(year, month, day));
  if (isNaN(targetDate.getTime())) {
    throw new Error(`Invalid date parsed from: ${targetDayStr}`);
  }

  // 1 day after targetDay
  const prevDate = new Date(targetDate);
  prevDate.setUTCDate(prevDate.getUTCDate() + 1);

  // 1 day before targetDay
  const nextDate = new Date(targetDate);
  nextDate.setUTCDate(nextDate.getUTCDate() - 1);

  const formatDate = (date) => {
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  return {
    prevDay: formatDate(prevDate),
    targetDay: formatDate(targetDate),
    nextDay: formatDate(nextDate)
  };
}

/**
 * Notify the completion webhook that a task has finished recording and uploading
 * @param {string|number} taskId 
 * @param {string} driveLink 
 * @returns {Promise<boolean>}
 */
async function markTaskCompleted(taskId, driveLink) {
  const webhookUrl = process.env.WEBHOOK_COMPLETE_URL;
  const apiKey = process.env.API_SECRET_KEY;

  if (!webhookUrl) {
    console.warn('[ApiClient] WEBHOOK_COMPLETE_URL not configured. Skipping webhook call.');
    return false;
  }

  const payload = {
    task_id: taskId,
    status: 'completed',
    drive_link: driveLink
  };

  try {
    console.log(`[ApiClient] Sending completion notification for task ${taskId}...`);
    const response = await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey || ''
      },
      timeout: 15000
    });
    console.log(`[ApiClient] Webhook response status: ${response.status}`);
    return true;
  } catch (error) {
    console.error(`[ApiClient] Webhook delivery failed for task ${taskId}: ${error.message}`);
    // Wrap in try/catch so webhook errors do not crash the loop
    return false;
  }
}

module.exports = {
  fetchPendingTasks,
  calculateSurroundingDates,
  markTaskCompleted
};
