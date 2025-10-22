import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import { logger } from './logger.js';
import { getDeviceId, updateDeviceHeartbeat } from './config/loader.js';
const execAsync = promisify(exec);
// Read service account JSON
const serviceAccount = JSON.parse(readFileSync('/home/dietpi/radio-revive/rpi-agent/service-account.json', 'utf8'));
initializeApp({
    credential: cert(serviceAccount),
});
const firestore = getFirestore();
const DEVICE_ID = getDeviceId();
logger.info({ deviceId: DEVICE_ID }, '🚀 Radio Revive Agent starting...');
let currentStreamUrl = null;
let isPlaying = false;
let isPaused = false;
let currentVolume = 100;
let isPlayLocked = false; // Default 100%
// Music control functions
async function play(streamUrl) {
    try {
        // Prevent concurrent play() calls
        if (isPlayLocked) {
            logger.warn('Play already in progress, ignoring');
            return;
        }
        isPlayLocked = true;
        
        // CRITICAL: Check PID lock file
        const pidFile = '/tmp/bashify-mpv.lock';
        try {
            const existingPid = await execAsync('cat ' + pidFile).then(r => r.stdout.trim()).catch(() => null);
            if (existingPid) {
                logger.warn({ existingPid }, 'MPV lock file exists, killing old process');
                await execAsync('kill -9 ' + existingPid).catch(() => {});
            }
        } catch (e) {}
        
        // Kill ALL existing MPV
        await execAsync('pkill -9 mpv').catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Verify MPV is dead
        const { stdout: checkMpv } = await execAsync('ps aux | grep mpv | grep -v grep | wc -l').catch(() => ({ stdout: '0' }));
        if (parseInt(checkMpv.trim()) > 0) {
            logger.warn('MPV still running after kill, forcing again');
            await execAsync('pkill -9 mpv').catch(() => {});
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // CRITICAL: Double-check no MPV before starting
        const { stdout: finalCheck } = await execAsync('ps aux | grep mpv | grep -v grep | wc -l').catch(() => ({ stdout: '0' }));
        if (parseInt(finalCheck.trim()) > 0) {
            logger.error('Failed to kill all MPV, aborting play');
            isPlayLocked = false;
            return;
        }
        
        const urlToPlay = streamUrl || currentStreamUrl;
        if (!urlToPlay) {
            logger.warn('No stream URL available');
            isPlayLocked = false;
            return;
        }
        
        currentStreamUrl = urlToPlay;
        
        // Set volume
        const minVol = -10239;
        const maxVol = 400;
        const volumeRaw = Math.round(minVol + (currentVolume / 100) * (maxVol - minVol));
        await execAsync(`amixer set PCM -- ${volumeRaw}`);
        
        // Start MPV and capture PID
        // Start MPV with IPC socket for volume control
        const mpvCmd = `mpv --no-video --audio-device=alsa --really-quiet --input-ipc-server=/tmp/mpv-socket "${urlToPlay}"` >/dev/null 2>&1 & echo $!`;
        const { stdout: pidOutput } = await execAsync(mpvCmd);
        const mpvPid = pidOutput.trim();
        
        // Save PID to lock file
        await execAsync(`echo ${mpvPid} > ${pidFile}`);
        logger.info({ mpvPid }, 'MPV started with PID');
        
        // Wait to verify MPV started
        await new Promise(resolve => setTimeout(resolve, 2000));
        const { stdout } = await execAsync('ps aux | grep mpv | grep -v grep | wc -l');
        const mpvCount = parseInt(stdout.trim());
        
        if (mpvCount === 0) {
            throw new Error('MPV failed to start');
        }
        
        if (mpvCount > 1) {
            logger.error({ mpvCount }, 'WARNING: Multiple MPV detected after start!');
        }
        
        logger.info({ mpvProcesses: mpvCount }, 'MPV verified running');
        
        isPlaying = true;
        isPaused = false;
        
        await firestore.collection('config').doc('devices').collection('list').doc(DEVICE_ID)
            .update({ status: 'playing', isPlaying: true, currentUrl: urlToPlay });
        await updateDeviceHeartbeat(firestore, DEVICE_ID, true, urlToPlay);
        
        logger.info({ streamUrl: urlToPlay, volume: currentVolume }, '▶️ Music started');
        isPlayLocked = false;
    } catch (error) {
        logger.error({ error: error.message || error, stack: error.stack }, 'Failed to start music');
        isPlayLocked = false;
        throw error;
    }
}

// Announcement system with fade
let announcementTimer = null;
let currentGroup = null;

async function fadeVolume(targetPercent, durationMs = 2000) {
    const steps = 20;
    const stepDelay = durationMs / steps;
    const startVol = 100; // MPV always starts at 100%
    const diff = targetPercent - startVol;
    
    for (let i = 1; i <= steps; i++) {
        const newVol = Math.round(startVol + (diff * i / steps));
        // Control MPV volume via echo to IPC socket
        await execAsync(`echo '{ "command": ["set_property", "volume", ${newVol}] }' | socat - /tmp/mpv-socket`).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, stepDelay));
    }
}

async function playAnnouncement(announcementUrl) {
    try {
        logger.info({ url: announcementUrl }, '📢 Playing announcement with fade');
        
        const originalVolume = currentVolume;
        
        // Fade music down to 20%
        await fadeVolume(50, 1500);
        
        // Play announcement at full volume in separate process
        await execAsync(`mpv --no-video --audio-device=alsa --volume=100 "${announcementUrl}"`);
        
        // Fade music back up
        await fadeVolume(originalVolume, 1500);
        
        logger.info('✅ Announcement completed');
    } catch (error) {
        logger.error({ error }, 'Failed to play announcement');
        // Restore volume even if announcement fails
        await setVolume(currentVolume);
    }
}

function startAnnouncementScheduler(group) {
    // Clear existing timer
    if (announcementTimer) {
        clearInterval(announcementTimer);
    }
    
    currentGroup = group;
    
    // Check if group has announcements
    if (!group.announcements || group.announcements.length === 0) {
        logger.info('No announcements configured for this group');
        return;
    }
    
    const intervalMinutes = group.announcementInterval || 15;
    const intervalMs = intervalMinutes * 60 * 1000;
    
    logger.info({ 
        count: group.announcements.length, 
        interval: intervalMinutes 
    }, '🔔 Starting announcement scheduler');
    
    let announcementIndex = 0;
    
    // Play announcement immediately on group change (optional)
    // playAnnouncement(group.announcements[0].url);
    
    // Schedule periodic announcements
    announcementTimer = setInterval(async () => {
        if (isPlaying && !isPaused && group.announcements) {
            const announcement = group.announcements[announcementIndex];
            await playAnnouncement(announcement.url);
            
            // Move to next announcement (round-robin)
            announcementIndex = (announcementIndex + 1) % group.announcements.length;
        }
    }, intervalMs);
}

function stopAnnouncementScheduler() {
    if (announcementTimer) {
        clearInterval(announcementTimer);
        announcementTimer = null;
        logger.info('🔕 Announcement scheduler stopped');
    }
}

async function pause() {
    try {
        await execAsync('killall -STOP mpv');
        isPaused = true;
        isPlaying = false;
        await firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(DEVICE_ID)
            .update({ status: 'paused', isPlaying: false });
        logger.info('⏸️ Music paused');
    }
    catch (error) {
        logger.error({ error }, 'Failed to pause');
    }
}
async function resume() {
    try {
        await execAsync('killall -CONT mpv');
        isPaused = false;
        isPlaying = true;
        await updateDeviceHeartbeat(firestore, DEVICE_ID, true, currentStreamUrl || '');
        logger.info('▶️ Music resumed');
    }
    catch (error) {
        logger.error({ error }, 'Failed to resume');
    }
}
async function stop() {
    try {
        // Kill MPV immediately and forcefully
        await execAsync('pkill -9 mpv').catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Verify all MPV are dead
        const { stdout } = await execAsync('ps aux | grep mpv | grep -v grep | wc -l').catch(() => ({ stdout: '0' }));
        const mpvCount = parseInt(stdout.trim());
        
        if (mpvCount > 0) {
            logger.warn({ mpvCount }, 'MPV still running after stop, forcing again');
            await execAsync('pkill -9 mpv').catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        isPlaying = false;
        isPaused = false;
        currentStreamUrl = '';
        
        await firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(DEVICE_ID)
            .update({ status: 'stopped', isPlaying: false });
        
        stopAnnouncementScheduler();
        logger.info('⏹️ Music stopped');
    }
    catch (error) {
        logger.error({ error }, 'Failed to stop');
    }
}
async function setVolume(volumePercent) {
    try {
        logger.info({ volumePercent }, '🔊 setVolume called with value');
        currentVolume = Math.max(0, Math.min(100, volumePercent));
        const minVol = -10239;
        const maxVol = 400;
        const volumeRaw = Math.round(minVol + (currentVolume / 100) * (maxVol - minVol));
        await execAsync(`amixer set PCM -- ${volumeRaw}`);
        await firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(DEVICE_ID)
            .update({ volume: currentVolume });
        logger.info({ volume: currentVolume }, '🔊 Volume updated');
    }
    catch (error) {
        logger.error({ error }, 'Failed to set volume');
    }
}
// Listen for commands
const commandsRef = firestore
    .collection('config')
    .doc('commands')
    .collection('list');
const unsubscribe = commandsRef.where('deviceId', '==', DEVICE_ID).onSnapshot(async (snapshot) => {
    for (const change of snapshot.docChanges()) {
        if (change.type === 'added') {
            const commandData = change.doc.data();
            if (commandData.processed)
                continue;
            logger.info({ command: commandData }, '📨 Command received');
            try {
                switch (commandData.action) {
                    case 'play':
                        // If paused, resume instead of starting new MPV
                        if (isPaused) {
                            await resume();
                        } else {
                            await play(commandData.streamUrl);
                        }
                        break;
                    case 'pause':
                        if (!isPaused) {
                            await pause();
                        }
                        break;
                        if (isPaused) {
                            await resume();
                        }
                        else {
                            await pause();
                        }
                        break;
                    case 'stop':
                        await stop();
                        break;
                    case 'volume':
                        await setVolume(commandData.volume || 100);
                        break;
                    case 'system_update':
                        logger.info('🔄 System update requested');
                        exec('bash /home/dietpi/radio-revive/rpi-agent/scripts/system-update.sh');
                        break;
                    case 'configure_wifi':
                    case 'network_config':
                        logger.info({ ip: commandData.ipAddress, gateway: commandData.gateway }, '🌐 Network config requested');
                        exec(`sudo bash /home/dietpi/radio-revive/rpi-agent/scripts/configure-network.sh "${commandData.ipAddress}" "${commandData.gateway}" "${commandData.dns1}" "${commandData.dns2}" "${commandData.interface || 'eth0'}"`);
                        break;
                        logger.info({ ssid: commandData.ssid }, '📶 WiFi config requested');
                        exec(`bash /home/dietpi/radio-revive/rpi-agent/scripts/configure-wifi.sh "${commandData.ssid}" "${commandData.password}"`);
                        break;
                }
                await commandsRef.doc(change.doc.id).update({ processed: true });
            }
            catch (error) {
                logger.error({ error }, 'Command execution failed');
            }
        }
    }
}, (error) => {
    logger.error({ error }, 'Commands listener error');
});
// Heartbeat every 5 seconds
setInterval(async () => { // 5 seconds
    try {
        const status = isPaused ? 'paused' : isPlaying ? 'playing' : 'online';
        await updateDeviceHeartbeat(firestore, DEVICE_ID, isPlaying, currentStreamUrl || '');
        // Update with current status and volume
        await firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(DEVICE_ID)
            .update({
            status,
            volume: currentVolume
        });
    }
    catch (error) {
        logger.error({ error }, 'Heartbeat failed');
    }
}, 5000);
// Initialize with volume 100%
setTimeout(async () => {
    await setVolume(100);
    logger.info('✅ Initial volume set to 100%');
}, 5000);
logger.info('✅ Agent initialized');
    
    
    // Robust auto-play with retry mechanism
    let autoPlayAttempts = 0;
    const maxAutoPlayAttempts = 10;
    
    const tryAutoPlay = async () => {
        try {
            autoPlayAttempts++;
            logger.info({ attempt: autoPlayAttempts }, 'Attempting auto-play...');
            
            // Wait for audio device to be ready
            await execAsync('amixer get PCM').catch(() => {
                throw new Error('Audio device not ready');
            });
            
            // Get device to find its group
            const deviceDoc = await firestore
                .collection('config')
                .doc('devices')
                .collection('list')
                .doc(DEVICE_ID)
                .get();
            
            if (!deviceDoc.exists) {
                throw new Error('Device not found');
            }
            
            const deviceData = deviceDoc.data();
            const groupId = deviceData.groupId;
            
            if (!groupId) {
                logger.warn('Device has no group assigned');
                return;
            }
            
            // Get group streamUrl
            const groupDoc = await firestore
                .collection('config')
                .doc('groups')
                .collection('list')
                .doc(groupId)
                .get();
            
            if (groupDoc.exists) {
                const groupData = groupDoc.data();
                if (groupData.streamUrl && !isPlaying) {
                    logger.info({ url: groupData.streamUrl, groupId }, '🎵 Auto-starting music from group');
                    await play(groupData.streamUrl);
                    logger.info('✅ Auto-play successful!');
                    // Start announcement scheduler for this group
                    startAnnouncementScheduler(groupData);
                } else {
                    logger.warn({ groupId }, 'Group has no streamUrl');
                }
            } else {
                logger.warn({ groupId }, 'Group not found');
            }
        } catch (error) {
            logger.error({ 
                error: error.message || error, 
                attempt: autoPlayAttempts,
                maxAttempts: maxAutoPlayAttempts 
            }, 'Auto-play failed');
            
            if (autoPlayAttempts < maxAutoPlayAttempts) {
                const delay = Math.min(5000 * autoPlayAttempts, 30000);
                logger.info({ delay, nextAttempt: autoPlayAttempts + 1 }, 'Retrying auto-play...');
                setTimeout(tryAutoPlay, delay);
            } else {
                logger.error('❌ Auto-play failed after max attempts');
            }
        }
    };
    
    setTimeout(tryAutoPlay, 10000);



process.on('SIGTERM', () => {
    logger.info('👋 Shutting down...');
    unsubscribe();
    stop();
    process.exit(0);
});
