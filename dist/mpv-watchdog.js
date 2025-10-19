const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Check every 30 seconds
setInterval(async () => {
    try {
        const { stdout } = await execAsync('ps aux | grep mpv | grep -v grep | wc -l');
        const count = parseInt(stdout.trim());
        
        if (count > 1) {
            console.log(`⚠️ WARNING: ${count} MPV processes found! Killing extras...`);
            await execAsync('pkill -9 mpv');
            console.log('✅ Cleaned up duplicate MPV processes');
        }
    } catch (error) {
        // Ignore errors
    }
}, 30000);

console.log('🐕 MPV Watchdog started - will ensure only 1 MPV runs');
