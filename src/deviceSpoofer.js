const { execSync } = require('child_process');

/**
 * Execute an ADB command synchronously with error handling
 * @param {string} cmd 
 */
function runAdb(cmd) {
  try {
    const output = execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' });
    return output.trim();
  } catch (error) {
    console.warn(`[DeviceSpoofer] ADB command warning [${cmd}]: ${error.stderr || error.message}`);
    return null;
  }
}

/**
 * Spoofs the virtual Android device to appear as a physical smartphone in India:
 * - Sets battery level to a random realistic capacity between 38% and 86%
 * - Disconnects AC charging status
 * - Disables Wi-Fi and activates Mobile Data (displaying LTE/5G network)
 * - Changes system timezone to Asia/Kolkata
 * - Fixes GPS location to Kolkata, India (88.3639, 22.5726)
 */
function spoofIndianRealDevice() {
  console.log('[DeviceSpoofer] Configuring device spoofing to mimic real Indian smartphone...');

  // 1. Random battery capacity between 38% and 86%
  const randomCapacity = Math.floor(Math.random() * (86 - 38 + 1)) + 38;
  console.log(`[DeviceSpoofer] Setting battery capacity to ${randomCapacity}%...`);
  runAdb(`adb emu power capacity ${randomCapacity}`);

  // 2. Turn off AC charging state
  console.log('[DeviceSpoofer] Setting power AC status to off...');
  runAdb('adb emu power ac off');

  // 3. Disable Wi-Fi and enable Mobile Data
  console.log('[DeviceSpoofer] Disabling Wi-Fi and enabling Mobile Data...');
  runAdb('adb shell svc wifi disable');
  runAdb('adb shell svc data enable');

  // 4. Set timezone to Kolkata (India Standard Time)
  console.log('[DeviceSpoofer] Setting timezone to Asia/Kolkata...');
  runAdb('adb shell setprop persist.sys.timezone "Asia/Kolkata"');

  // 5. Set GPS coordinates to Kolkata, India (Longitude: 88.3639, Latitude: 22.5726)
  console.log('[DeviceSpoofer] Fixing GPS coordinates to Kolkata (88.3639, 22.5726)...');
  runAdb('adb emu geo fix 88.3639 22.5726');

  console.log('[DeviceSpoofer] Device spoofing completed successfully.');
}

module.exports = {
  spoofIndianRealDevice
};
