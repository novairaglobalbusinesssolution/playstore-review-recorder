const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { fetchPendingTasks } = require('./src/apiClient');
const { recordPlayStoreReviewVideo, processAllPendingTasks } = require('./src/cloudReviewRecorder');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static dashboard UI & recorded video files statically on Render
const path = require('path');
const fs = require('fs');
const tempVideosDir = path.join(__dirname, 'temp_videos');
if (!fs.existsSync(tempVideosDir)) fs.mkdirSync(tempVideosDir, { recursive: true });
app.use('/videos', express.static(tempVideosDir));
app.use(express.static(path.join(__dirname, 'public')));

// Job State Management
let currentJob = {
  status: 'idle', // 'idle' | 'running' | 'completed' | 'error'
  startTime: null,
  totalTasks: 0,
  completedCount: 0,
  currentTask: null,
  logs: [],
  lastResult: null
};

function addLog(msg) {
  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  const entry = `[${time} IST] ${msg}`;
  console.log(entry);
  currentJob.logs.push(entry);
  if (currentJob.logs.length > 200) currentJob.logs.shift();
}

// ----------------------------------------------------
// Health Checks (Render Requirement) & Dashboard Routes
// ----------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'playstore-review-recorder (Render Cloud Edition)',
    timestamp: new Date().toISOString(),
    ist_time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    job_status: currentJob.status
  });
});

app.get(['/', '/dashboard'], (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({
      status: 'online',
      service: 'playstore-review-recorder (Render Cloud Edition)',
      timestamp: new Date().toISOString(),
      ist_time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      job_status: currentJob.status
    });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ----------------------------------------------------
// Preview Pending Tasks
// ----------------------------------------------------
app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await fetchPendingTasks();
    res.json({
      status: 'success',
      total: tasks.length,
      tasks
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ----------------------------------------------------
// Live Queue & Execution Status
// ----------------------------------------------------
app.get('/api/status', (req, res) => {
  res.json({
    status: 'success',
    data: currentJob
  });
});

// ----------------------------------------------------
// Trigger Recording for ALL Today's Tasks
// ----------------------------------------------------
app.all('/api/record-all-today', async (req, res) => {
  const secret = req.headers['x-api-key'] || req.query.key || (req.body && req.body.key);
  const expectedSecret = process.env.API_SECRET_KEY || 'Novaira002@#';

  if (secret && secret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }

  if (currentJob.status === 'running') {
    return res.status(429).json({
      status: 'busy',
      message: 'A recording job is already active.',
      currentTask: currentJob.currentTask
    });
  }

  // Respond immediately so HTTP call never times out on Render
  res.json({
    status: 'started',
    message: 'Play Store review recording job started in background on Render.',
    status_url: '/api/status'
  });

  // Run in background
  (async () => {
    currentJob.status = 'running';
    currentJob.startTime = new Date().toISOString();
    currentJob.completedCount = 0;
    currentJob.logs = [];
    addLog('Starting batch review recording job...');

    try {
      const tasks = await fetchPendingTasks();
      currentJob.totalTasks = tasks.length;
      addLog(`Discovered ${tasks.length} task(s) to record.`);

      const results = [];
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        currentJob.currentTask = task;
        addLog(`[${i + 1}/${tasks.length}] Recording #${task.task_id} (${task.package_name})...`);

        try {
          const outcome = await recordPlayStoreReviewVideo({
            task_id: task.task_id,
            package_name: task.package_name,
            target_day: task.target_day,
            app_name: task.app_name || task.package_name
          });
          results.push(outcome);
          currentJob.completedCount++;
          addLog(`[✓] Completed Task #${task.task_id}. Drive Link: ${outcome.drive_link || 'N/A'}`);
        } catch (itemErr) {
          addLog(`[!] Failed Task #${task.task_id}: ${itemErr.message}`);
          results.push({ success: false, task_id: task.task_id, error: itemErr.message });
        }
      }

      currentJob.status = 'completed';
      currentJob.currentTask = null;
      currentJob.lastResult = results;
      addLog(`Job successfully finished! Processed ${results.length} tasks.`);
    } catch (jobErr) {
      currentJob.status = 'error';
      currentJob.currentTask = null;
      addLog(`Fatal job error: ${jobErr.message}`);
    }
  })();
});

// ----------------------------------------------------
// Record a Single Task on Demand
// ----------------------------------------------------
app.all('/api/record-task', async (req, res) => {
  const taskId = req.query.task_id || (req.body && req.body.task_id);
  const pkgName = req.query.package_name || (req.body && req.body.package_name);
  const targetDay = req.query.target_day || (req.body && req.body.target_day) || 'today';
  const appName = req.query.app_name || (req.body && req.body.app_name) || pkgName;

  if (!pkgName && !taskId) {
    return res.status(400).json({ error: 'Missing task_id or package_name parameter.' });
  }

  try {
    let task = {
      task_id: taskId || 'manual',
      package_name: pkgName,
      target_day: targetDay,
      app_name: appName
    };

    // If only taskId was passed, look it up from pending tasks
    if (taskId && !pkgName) {
      const allTasks = await fetchPendingTasks();
      const found = allTasks.find(t => String(t.task_id) === String(taskId));
      if (!found) {
        return res.status(404).json({ error: `Task #${taskId} not found in pending tasks.` });
      }
      task = found;
    }

    const result = await recordPlayStoreReviewVideo({
      task_id: task.task_id,
      package_name: task.package_name,
      target_day: task.target_day,
      app_name: task.app_name || task.package_name
    });

    res.json({
      status: 'success',
      data: result
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ----------------------------------------------------
// Daily Automated Cron Scheduler (7:30 PM IST / 19:30)
// ----------------------------------------------------
let lastCronExecutedDate = '';
setInterval(() => {
  const d = new Date();
  const istTimeStr = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  const istDateStr = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });

  // Trigger at 19:30 (7:30 PM IST) once per day
  if (istTimeStr.startsWith('19:30') && lastCronExecutedDate !== istDateStr) {
    lastCronExecutedDate = istDateStr;
    console.log(`[Scheduler] 19:30 IST reached on ${istDateStr}! Auto-triggering daily review recording...`);
    // Invoke batch recording
    processAllPendingTasks().catch(err => console.error('[Scheduler Error]:', err));
  }
}, 30000); // Check every 30 seconds

// Start Server
app.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🚀 Play Store Review Recorder Server Online!`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`💚 Health: http://localhost:${PORT}/health`);
  console.log(`🎬 Record All: http://localhost:${PORT}/api/record-all-today`);
  console.log(`⏰ Daily Auto Scheduler: Active (19:30 IST / 7:30 PM)`);
  console.log('====================================================');
});
