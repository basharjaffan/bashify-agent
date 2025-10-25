import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';
import { initializeFirebase, getFirestore } from './config/firebase.js';
import { getDeviceId, updateDeviceHeartbeat } from './config/loader.js';
const execAsync = promisify(exec);
const ORGANIZATION_ID = process.env.ORGANIZATION_ID || 'bashify';
let playerProcess = null;
let currentUrl = null;
let isPlayingLocked = false;
let hasStartedInitially = false;
let announcementTimer = null;
let currentGroupData = null;
let isPlayingAnnouncement = false;
let announcementProcess = null;
let wasPlayingBeforeAnnouncement = false;
let savedUrlBeforePause = null;
let currentVolume = 100;
let lastScheduledGroupId = null;
let isPaused = false;
const startTime = Date.now();
let firestore;
let deviceId;
async function playStream(url) {
    if (isPlayingLocked) {
        logger.warn('Play command ignored - already starting stream');
        return;
    }
    if (!url) {
        logger.warn('Cannot play - no URL provided');
        return;
    }
    if (playerProcess && currentUrl === url) {
        logger.info({ url }, '✅ Already playing this stream, no restart needed');
        return;
    }
    isPlayingLocked = true;
    if (playerProcess && currentUrl !== url) {
        try {
            logger.info({ oldUrl: currentUrl, newUrl: url }, '🔄 Switching to different stream...');
            playerProcess.kill('SIGKILL');
            playerProcess = null;
            try {
                await execAsync('pkill -9 mpv');
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            catch (e) { }
        }
        catch (e) {
            logger.error({ error: e }, 'Error killing existing process');
        }
    }
    currentUrl = url;
    logger.info({ url }, '🎵 Starting music...');
    playerProcess = spawn('mpv', [
        '--no-video',
        '--audio-device=alsa',
        '--really-quiet',
        url
    ]);
    playerProcess.on('error', (error) => {
        logger.error({ error }, '❌ Failed to start player');
        playerProcess = null;
        isPlayingLocked = false;
    });
    playerProcess.on('spawn', () => {
        logger.info({ pid: playerProcess.pid }, '✅ Music started successfully!');
        updateDeviceHeartbeat(firestore, deviceId, true, currentUrl).catch(err => logger.error({ err }, 'Failed immediate heartbeat'));
        isPlayingLocked = false;
        
        // Återaktivera announcements om vi har groupData
        if (isPaused && currentGroupData) {
            isPaused = false;
            logger.info('▶️ Resuming announcements');
            scheduleAnnouncements(currentGroupData);
        }
    });
    playerProcess.on('exit', (code) => {
        if (code === 0 && !isPaused && currentGroupData && currentGroupData.localFiles && currentGroupData.localFiles.length > 0) {
            const tracks = currentGroupData.localFiles;
            const getFilename = (url) => decodeURIComponent(url.split('/').pop().split('?')[0]);
            const currentFile = getFilename(currentUrl);
            const currentIndex = tracks.findIndex(t => getFilename(t.url) === currentFile);
            
            if (currentIndex >= 0) {
                const nextIndex = (currentIndex + 1) % tracks.length;
                const nextTrack = tracks[nextIndex];
                logger.info({ finished: currentIndex + 1, next: nextIndex + 1, total: tracks.length }, '⏭️ Next track');
                playerProcess = null;
                isPlayingLocked = false;
                setTimeout(() => { if (!isPaused) playStream(nextTrack.url); }, 500);
            } else {
                logger.warn('Track not found, looping same');
                playerProcess = null;
                isPlayingLocked = false;
                setTimeout(() => { if (!isPaused && currentUrl) playStream(currentUrl); }, 500);
            }
        } else if (code === 0 && !isPaused && currentUrl) {
            logger.info('Looping track');
            playerProcess = null;
            isPlayingLocked = false;
            setTimeout(() => { if (!isPaused) playStream(currentUrl); }, 500);
        } else {
            logger.warn({ code }, '⏹️ Player stopped');
            playerProcess = null;
            isPlayingLocked = false;
        }
    });
}

function resumeStream() {
    if (playerProcess && isPaused) {
        logger.info({ pid: playerProcess.pid }, '▶️ Resuming stream (SIGCONT)...');
        try {
            playerProcess.kill('SIGCONT');
            isPaused = false;
            savedUrlBeforePause = null;
        } catch (err) {
            logger.error('Could not resume with SIGCONT');
            playerProcess = null;
            if (savedUrlBeforePause) {
                playStream(savedUrlBeforePause);
            }
        }
    } else if (savedUrlBeforePause) {
        logger.info('No paused process, restarting from saved URL');
        isPaused = false;
        playStream(savedUrlBeforePause);
        savedUrlBeforePause = null;
    }
}

function stopStream() {
    isPaused = true;
    savedUrlBeforePause = currentUrl;
    logger.info({ savedUrl: savedUrlBeforePause }, '💾 Saving URL before pause');
    
    if (playerProcess) {
        logger.info({ pid: playerProcess.pid }, '⏸️ Pausing stream (SIGSTOP)...');
        try {
            playerProcess.kill('SIGSTOP');
        } catch (err) {
            logger.warn('Could not pause with SIGSTOP, killing instead');
            playerProcess.kill('SIGKILL');
            playerProcess = null;
        }
    }
    
    // Pausa announcements också
    if (announcementTimer) {
        clearInterval(announcementTimer);
        announcementTimer = null;
        logger.info('⏸️ Announcements paused');
    }
    
    // Stoppa pågående announcement
    if (announcementProcess) {
        announcementProcess.kill('SIGKILL');
        announcementProcess = null;
        isPlayingAnnouncement = false;
        logger.info('⏹️ Stopped current announcement');
    }
    
    logger.info('⏹️ Stream stop command sent');
    updateDeviceHeartbeat(firestore, deviceId, false, null).catch(err => logger.error({ err }, 'Failed immediate heartbeat'));
}
async function setVolume(percent) {
    const rawValue = Math.round((percent / 100) * 10639 - 10239);
    try {
        await execAsync('amixer set PCM -- ' + rawValue);
        currentVolume = percent;
        
        const deviceRef = firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(deviceId);
        await deviceRef.update({ volume: percent });
        
        logger.info({ percent, rawValue }, '🔊 Volume updated');
    } catch (error) {
        logger.error({ error }, 'Failed to set volume');
    }
}

async function playAnnouncement(announcementUrl, volumePercent = 100) {
    if (isPaused) {
        logger.debug('Skipping announcement - playback is paused');
        return;
    }
    if (isPlayingAnnouncement) {
        logger.warn('Already playing an announcement');
        return;
    }
    isPlayingAnnouncement = true;
    const streamWasPaused = playerProcess === null;
    const previousUrl = currentUrl;
    try {
        logger.info({ announcementUrl, volume: volumePercent }, '📢 Playing announcement...');
        if (playerProcess) {
            logger.info('⏸️ Pausing music for announcement (SIGSTOP)');
            wasPlayingBeforeAnnouncement = true;
            try {
                playerProcess.kill('SIGSTOP');
            } catch (err) {
                logger.warn('Could not pause with SIGSTOP, killing instead');
                playerProcess.kill('SIGKILL');
                playerProcess = null;
                wasPlayingBeforeAnnouncement = false;
            }
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        announcementProcess = spawn('mpv', [
            '--no-video',
            '--audio-device=alsa',
            '--really-quiet',
            '--volume=' + volumePercent,
            announcementUrl
        ]);
        announcementProcess.on('error', (error) => {
            logger.error({ error }, '❌ Announcement playback failed');
            isPlayingAnnouncement = false;
            announcementProcess = null;
            if (previousUrl && !streamWasPaused) {
                playStream(previousUrl);
            }
        });
        announcementProcess.on('exit', (code) => {
            logger.info({ code }, '✅ Announcement finished');
            isPlayingAnnouncement = false;
            announcementProcess = null;
            setTimeout(() => {
                if (wasPlayingBeforeAnnouncement && playerProcess) {
                    logger.info('▶️ Resuming music after announcement (SIGCONT)');
                    try {
                        playerProcess.kill('SIGCONT');
                        wasPlayingBeforeAnnouncement = false;
                    } catch (err) {
                        logger.warn('Could not resume with SIGCONT, restarting');
                        if (previousUrl && !streamWasPaused) {
                            playStream(previousUrl);
                        }
                    }
                } else if (previousUrl && !streamWasPaused) {
                    logger.info('▶️ Restarting music after announcement');
                    playStream(previousUrl);
                }
            }, 500);
        });
    } catch (error) {
        logger.error({ error }, 'Error playing announcement');
        isPlayingAnnouncement = false;
        announcementProcess = null;
        if (previousUrl && !streamWasPaused) {
            playStream(previousUrl);
        }
    }
}

function scheduleAnnouncements(groupData) {
    const groupId = groupData.id || JSON.stringify(groupData);
    if (announcementTimer && lastScheduledGroupId === groupId) {
        logger.debug('Announcements already scheduled for this group');
        return;
    }
    if (announcementTimer && currentGroupData && JSON.stringify(currentGroupData.announcements) === JSON.stringify(groupData.announcements)) {
        logger.debug('Announcements already scheduled for this group');
        return;
    }
    if (announcementTimer) {
        clearInterval(announcementTimer);
        announcementTimer = null;
    }
    if (!groupData.announcements || groupData.announcements.length === 0) {
        logger.debug('No announcements to schedule');
        return;
    }
    const intervalMinutes = groupData.announcementInterval || 10;
    const volumePercent = groupData.announcementVolume || 100;
    const intervalMs = intervalMinutes * 60 * 1000;
    logger.info({
        count: groupData.announcements.length,
        intervalMinutes,
        volumePercent
    }, '📢 Scheduling announcements');
    let currentIndex = 0;
    setTimeout(() => {
        if (groupData.announcements[currentIndex]) {
            playAnnouncement(groupData.announcements[currentIndex].url, volumePercent);
            currentIndex = (currentIndex + 1) % groupData.announcements.length;
        }
    }, 60000);
    announcementTimer = setInterval(() => {
        if (groupData.announcements[currentIndex]) {
            playAnnouncement(groupData.announcements[currentIndex].url, volumePercent);
            currentIndex = (currentIndex + 1) % groupData.announcements.length;
        }
    }, intervalMs);
    lastScheduledGroupId = groupId;
}
async function updateProgress(deviceId, action, progress, status, currentStep) {
    try {
        const progressRef = firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(deviceId)
            .collection('progress')
            .doc(action);
        await progressRef.set({
            action,
            progress,
            status,
            currentStep: currentStep || '',
            timestamp: new Date(),
            updatedAt: new Date()
        });
        logger.info({ action, progress, status, currentStep }, '📊 Progress updated');
    }
    catch (error) {
        logger.error({ error }, 'Failed to update progress');
    }
}
async function handleSystemUpdate(deviceId, commandId) {
    try {
        logger.info('🔄 Starting system update...');
        await updateProgress(deviceId, 'update_system', 0, 'starting', 'Initializing');
        await updateProgress(deviceId, 'update_system', 5, 'running', 'Starting system update');
        await updateProgress(deviceId, 'update_system', 25, 'running', 'Updating packages');
        await execAsync('sudo apt update');
        await updateProgress(deviceId, 'update_system', 35, 'running', 'Package lists updated');
        await updateProgress(deviceId, 'update_system', 40, 'running', 'Upgrading packages');
        await execAsync('sudo apt upgrade -y');
        await updateProgress(deviceId, 'update_system', 60, 'running', 'Packages upgraded');
        await updateProgress(deviceId, 'update_system', 65, 'running', 'Cleaning up');
        await execAsync('sudo apt autoremove -y && sudo apt clean');
        await updateProgress(deviceId, 'update_system', 70, 'running', 'Cleanup complete');
        await updateProgress(deviceId, 'update_system', 80, 'running', 'Updating code');
        try {
            await execAsync('cd /home/dietpi/radio-revive/rpi-agent && git pull');
        }
        catch (gitError) {
            logger.warn({ error: gitError }, 'Git pull failed');
        }
        await updateProgress(deviceId, 'update_system', 90, 'running', 'Code updated');
        await updateProgress(deviceId, 'update_system', 95, 'running', 'Preparing restart');
        const commandsRef = firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(deviceId)
            .collection('commands');
        await commandsRef.doc(commandId).update({ processed: true });
        await updateProgress(deviceId, 'update_system', 100, 'completed', 'Restarting');
        setTimeout(() => {
            execAsync('sudo reboot');
        }, 2000);
    }
    catch (error) {
        logger.error({ error }, '❌ System update failed');
        await updateProgress(deviceId, 'update_system', 0, 'failed', `Error: ${error}`);
    }
}
async function handleDeviceRestart(deviceId, commandId) {
    try {
        logger.info('🔄 Restarting device...');
        await updateProgress(deviceId, 'restart_device', 0, 'starting', 'Preparing');
        await updateProgress(deviceId, 'restart_device', 50, 'running', 'Saving state');
        const commandsRef = firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(deviceId)
            .collection('commands');
        await commandsRef.doc(commandId).update({ processed: true });
        await updateProgress(deviceId, 'restart_device', 100, 'completed', 'Restarting now');
        setTimeout(() => {
            execAsync('sudo reboot');
        }, 2000);
    }
    catch (error) {
        logger.error({ error }, '❌ Restart failed');
        await updateProgress(deviceId, 'restart_device', 0, 'failed', `Error: ${error}`);
    }
}
function listenForFirebaseCommands() {
    try {
        const commandsRef = firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(deviceId)
            .collection('commands');
        commandsRef
            .where('processed', '==', false)
            .onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const commandData = change.doc.data();
                    const commandId = change.doc.id;
                    logger.info({ commandData, commandId }, '📨 Received Firebase command');
                    try {
                        if (commandData.action === 'play' || commandData.action === 'resume') {
                        if (isPaused && (playerProcess || savedUrlBeforePause)) {
                            logger.info('Resuming paused playback');
                            resumeStream();
                        } else {
                            const urlToPlay = commandData.url || commandData.streamUrl || currentUrl;
                            if (playerProcess && currentUrl === urlToPlay) {
                                logger.info('Already playing this URL, ignoring duplicate');
                            }
                            else {
                                playStream(urlToPlay);
                            }
                        }
                    }
                    else if (commandData.action === 'stop' || commandData.action === 'pause') {
                            stopStream();
                        }
                        else if (commandData.action === 'update_system' || commandData.action === 'update' || commandData.action === 'full_update') {
                            logger.info('📦 Received system update command');
                            handleSystemUpdate(deviceId, commandId).catch((error) => {
                                logger.error({ error }, 'Update failed');
                            });
                        }
                        else if (commandData.action === 'restart_device' || commandData.action === 'restart' || commandData.action === 'reboot') {
                            logger.info('🔄 Received restart command');
                            handleDeviceRestart(deviceId, commandId).catch((error) => {
                                logger.error({ error }, 'Restart failed');
                            });
                        }
                        else if (commandData.action === 'volume' && commandData.volume !== undefined) {
                            await setVolume(commandData.volume);
                        }
                        await commandsRef.doc(commandId).update({ processed: true });
                        logger.info({ commandId }, '✅ Command processed');
                    }
                    catch (error) {
                        logger.error({ error, commandId }, 'Error processing command');
                    }
                }
            });
        });
        logger.info('👂 Listening for Firebase commands...');
    }
    catch (error) {
        logger.error({ error }, 'Error setting up Firebase command listener');
    }
}
function listenForDeviceChanges() {
    try {
        const deviceRef = firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(deviceId);
        deviceRef.onSnapshot(async (snapshot) => {
            if (snapshot.exists) {
                const deviceData = snapshot.data();
                
                // FIRST: Check if device has no group - stop everything
                if (!deviceData.groupId) {
                    if (playerProcess || currentGroupData) {
                        logger.info('⚠️ Device has no group, stopping playback');
                        stopStream();
                        currentGroupData = null;
                    }
                    return;
                }
                if (deviceData.volume !== undefined && deviceData.volume !== currentVolume) {
                    logger.info({ volume: deviceData.volume }, '📢 Applying volume from Firebase');
                    setVolume(deviceData.volume);
                }
                // Check if groupId was removed
                if (!deviceData.groupId && currentGroupData) {
                    logger.info('⚠️ Device removed from group, stopping playback');
                    stopStream();
                    currentGroupData = null;
                    lastScheduledGroupId = null;
                    return;
                }
                
                if (deviceData.groupId) {
                    try {
                        const groupRef = firestore
                            .collection('config')
                            .doc('groups')
                            .collection('list')
                            .doc(deviceData.groupId);
                        const groupSnapshot = await groupRef.get();
                        if (groupSnapshot.exists) {
                            const groupData = groupSnapshot.data();
                            currentGroupData = groupData;
                            scheduleAnnouncements(groupData);
                        } else {
                            // Group was deleted
                            logger.info({ groupId: deviceData.groupId }, '⚠️ Group no longer exists, stopping playback');
                            stopStream();
                            currentGroupData = null;
                            
                            // Clear groupId from device
                            await deviceRef.update({ 
                                groupId: null,
                                streamUrl: null 
                            });
                        }
                    } catch (error) {
                        logger.error({ error }, 'Failed to fetch group data');
                    }
                }
                if (!hasStartedInitially && deviceData.streamUrl) {
                    hasStartedInitially = true;
                    logger.info({ streamUrl: deviceData.streamUrl }, '🎵 Initial start with group stream');
                    playStream(deviceData.streamUrl);
                    return;
                }
                if (hasStartedInitially && deviceData.streamUrl && deviceData.streamUrl !== currentUrl) {
                    // Don't interrupt playlist mode
                    if (currentGroupData && currentGroupData.localFiles && currentGroupData.localFiles.length > 1) {
                        logger.debug('Ignoring streamUrl change - in playlist mode');
                    } else {
                        logger.info({
                            oldUrl: currentUrl,
                            newUrl: deviceData.streamUrl
                        }, '🔄 Stream URL changed, updating playback');
                        playStream(deviceData.streamUrl);
                    }
                }
            }
            else {
                logger.info('⏳ Waiting for device configuration from Firebase...');
            }
        });
        logger.info('👂 Listening for device changes...');
    }
    catch (error) {
        logger.error({ error }, 'Error setting up device listener');
    }
}
async function bootstrap() {
    try {
        logger.info('🚀 Radio Revive Agent starting...');
        await initializeFirebase();
        firestore = getFirestore();
        deviceId = await getDeviceId();
        logger.info({ deviceId }, '📱 Device ID generated');
        
        const deviceRefInit = firestore.collection('config').doc('devices').collection('list').doc(deviceId);
        const deviceDocInit = await deviceRefInit.get();
        if (deviceDocInit.exists && deviceDocInit.data().volume !== undefined) {
            currentVolume = deviceDocInit.data().volume;
            await setVolume(currentVolume);
            logger.info({ volume: currentVolume }, '🔊 Initial volume set from Firebase');
        }
        setInterval(async () => {
            try {
                const isPlaying = playerProcess !== null;
                await updateDeviceHeartbeat(firestore, deviceId, isPlaying, currentUrl);
            }
            catch (error) {
                logger.error({ error }, 'Failed to update heartbeat');
            }
        }, 10000);
        listenForFirebaseCommands();
        listenForDeviceChanges();
    }
    catch (error) {
        logger.error({ error }, 'Bootstrap failed');
        process.exit(1);
    }
}
bootstrap();
