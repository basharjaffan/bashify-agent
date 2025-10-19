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
let currentVolume = 100; // Default 100%
// Music control functions
async function play(streamUrl) {
    try {
        await stop();
        const urlToPlay = streamUrl || currentStreamUrl;
        if (!urlToPlay) {
            logger.warn('No stream URL available');
            return;
        }
        currentStreamUrl = urlToPlay;
        // Set volume to 100% by default or use saved volume
        const minVol = -10239;
        const maxVol = 400;
        const volumeRaw = Math.round(minVol + (currentVolume / 100) * (maxVol - minVol));
        logger.info({ currentVolume, volumeRaw, minVol: -10239, maxVol: 400 }, '🔊 Calculated volume');
        await execAsync(`amixer set PCM -- ${volumeRaw}`);
        await execAsync(`mpv --no-video --audio-device=alsa --really-quiet "${urlToPlay}" &`);
        isPlaying = true;
        isPaused = false;
        await updateDeviceHeartbeat(firestore, DEVICE_ID, true, urlToPlay);
        logger.info({ streamUrl: urlToPlay, volume: currentVolume }, '▶️ Music started');
    }
    catch (error) {
        logger.error({ error }, 'Failed to start music');
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
            .update({ status: 'paused' });
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
        await execAsync('killall mpv');
        isPlaying = false;
        isPaused = false;
        await firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(DEVICE_ID)
            .update({ status: 'online' });
        logger.info('⏹️ Music stopped');
    }
    catch (error) {
        // Ignore if mpv not running
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
                        await play(commandData.streamUrl);
                        break;
                    case 'pause':
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
// Heartbeat every 10 seconds
setInterval(async () => {
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
}, 10000);
// Initialize with volume 100%
setTimeout(async () => {
    await setVolume(100);
    logger.info('✅ Initial volume set to 100%');
}, 5000);
logger.info('✅ Agent initialized');
process.on('SIGTERM', () => {
    logger.info('👋 Shutting down...');
    unsubscribe();
    stop();
    process.exit(0);
});
