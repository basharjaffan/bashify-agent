import { spawn } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import mqtt from 'mqtt';
import { logger } from './logger.js';
import { initializeFirebase, getFirestore } from './config/firebase.js';
import { getDeviceId, getGroupStreamUrl, updateDeviceHeartbeat } from './config/loader.js';

const execAsync = promisify(exec);

const DEFAULT_STREAM = 'https://ice1.somafm.com/groovesalad-256-mp3';
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const ORGANIZATION_ID = 'LdpwUPcwIFUZjIwYph8Z';

let playerProcess: any = null;
let currentUrl: string = '';
let deviceId: string;
let mqttClient: mqtt.MqttClient;
let firestore: any;
let isPlayingLocked: boolean = false;
let hasStartedInitially: boolean = false;
let startTime: number = Date.now();

function playStream(url: string) {
  if (isPlayingLocked) {
    logger.warn('Play command ignored - already starting stream');
    return;
  }

  if (!url) {
    logger.warn('Cannot play - no URL provided');
    return;
  }

  isPlayingLocked = true;

  if (playerProcess) {
    try { 
      logger.info('Killing existing player before starting new one');
      playerProcess.kill('SIGKILL');
      playerProcess = null;
    } catch (e) {
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

  playerProcess.on('error', (error: Error) => {
    logger.error({ error }, '❌ Failed to start player');
    playerProcess = null;
    isPlayingLocked = false;
  });

  playerProcess.on('spawn', () => {
    logger.info({ pid: playerProcess.pid }, '✅ Music started successfully!');
    isPlayingLocked = false;
    setTimeout(() => {
      publishStatus();
      updateFirestoreStatus();
    }, 100);
  });

  playerProcess.on('exit', (code: number) => {
    logger.warn({ code }, '⏹️ Player stopped');
    playerProcess = null;
    isPlayingLocked = false;
    setTimeout(() => {
      publishStatus();
      updateFirestoreStatus();
    }, 100);
  });
}

function stopStream() {
  if (playerProcess) {
    try {
      logger.info({ pid: playerProcess.pid }, '⏹️ Stopping stream...');
      playerProcess.kill('SIGTERM');
      
      setTimeout(() => {
        if (playerProcess) {
          logger.warn('Force killing player process');
          try {
            playerProcess.kill('SIGKILL');
          } catch (e) {}
          playerProcess = null;
        }
      }, 1000);
      
      logger.info('⏹️ Stream stop command sent');
    } catch (e) {
      logger.error({ error: e }, 'Failed to stop stream');
    }
    setTimeout(() => {
      publishStatus();
      updateFirestoreStatus();
    }, 1200);
  } else {
    logger.info('No stream to stop - player already stopped');
  }
}

function percentToVolume(percent: number): number {
  percent = Math.max(0, Math.min(100, percent));
  
  const min = -10239;
  const max = 400;
  const range = max - min;
  
  const normalized = percent / 100;
  const exponential = Math.pow(normalized, 0.5);
  const rawValue = Math.round(min + (exponential * range));
  
  return rawValue;
}

async function setVolume(volume: number) {
  try {
    const rawValue = percentToVolume(volume);
    // Use -- to separate options from the value, especially for negative numbers
    await execAsync(`amixer set PCM -- ${rawValue}`);
    logger.info({ percent: volume, rawValue }, '🔊 Volume updated');
  } catch (error) {
    logger.error({ error }, 'Failed to set volume');
  }
}

function publishStatus() {
  if (!mqttClient || !mqttClient.connected) {
    return;
  }

  try {
    const status = {
      device_id: deviceId,
      playing: playerProcess !== null,
      current_url: currentUrl,
      timestamp: new Date().toISOString()
    };

    const topic = `radio-revive/${ORGANIZATION_ID}/device/${deviceId}/status`;
    mqttClient.publish(topic, JSON.stringify(status), { qos: 0, retain: false });
  } catch (error) {
    logger.error({ error }, 'Error in publishStatus');
  }
}

async function updateFirestoreStatus() {
  try {
    const isPlaying = playerProcess !== null;
    await updateDeviceHeartbeat(firestore, deviceId, isPlaying, currentUrl);
  } catch (error) {
    logger.error({ error }, 'Failed to update Firestore status');
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
      .onSnapshot((snapshot: any) => {
        snapshot.docChanges().forEach(async (change: any) => {
          if (change.type === 'added') {
            const commandData = change.doc.data();
            const commandId = change.doc.id;
            const commandTimestamp = commandData.timestamp?._seconds || 0;
            
            if (commandTimestamp * 1000 < startTime - 5000) {
              logger.debug({ commandId, age: Date.now() - (commandTimestamp * 1000) }, 'Ignoring old command');
              await commandsRef.doc(commandId).update({ processed: true });
              return;
            }
            
            logger.info({ commandData, commandId }, '📨 Received Firebase command');

            try {
              if (commandData.action === 'play') {
                const urlToPlay = commandData.url || currentUrl;
                
                if (playerProcess && currentUrl === urlToPlay) {
                  logger.info('Already playing this URL, ignoring duplicate');
                } else {
                  playStream(urlToPlay);
                }
              } else if (commandData.action === 'stop' || commandData.action === 'pause') {
                stopStream();
              } else if (commandData.action === 'volume' && commandData.volume !== undefined) {
                await setVolume(commandData.volume);
              }

              await commandsRef.doc(commandId).update({ processed: true });
              logger.info({ commandId }, '✅ Command processed');
            } catch (error) {
              logger.error({ error, commandId }, 'Failed to process command');
            }
          }
        });
      }, (error: any) => {
        logger.error({ error }, 'Error listening for Firebase commands');
      });

    logger.info('👂 Listening for Firebase commands...');
  } catch (error) {
    logger.error({ error }, 'Failed to set up Firebase command listener');
  }
}

function listenForDeviceChanges() {
  try {
    const deviceRef = firestore
      .collection('config')
      .doc('devices')
      .collection('list')
      .doc(deviceId);

    deviceRef.onSnapshot(async (snapshot: any) => {
      if (snapshot.exists) {
        const deviceData = snapshot.data();
        
        if (!hasStartedInitially && deviceData.streamUrl) {
          hasStartedInitially = true;
          logger.info({ streamUrl: deviceData.streamUrl }, '🎵 Initial start with group stream');
          playStream(deviceData.streamUrl);
          return;
        }
        
        if (hasStartedInitially && deviceData.streamUrl && deviceData.streamUrl !== currentUrl) {
          logger.info({ 
            oldUrl: currentUrl, 
            newUrl: deviceData.streamUrl 
          }, '🔄 Stream URL changed, updating playback');
          
          playStream(deviceData.streamUrl);
        }
      }
    }, (error: any) => {
      logger.error({ error }, 'Error listening for device changes');
    });

    logger.info('👂 Listening for device changes...');
  } catch (error) {
    logger.error({ error }, 'Failed to set up device listener');
  }
}

async function bootstrap() {
  try {
    logger.info('🚀 Radio Revive Agent starting...');

    await initializeFirebase();
    firestore = getFirestore();

    deviceId = await getDeviceId();
    logger.info({ deviceId }, '📱 Device ID generated');

    await updateFirestoreStatus();

    listenForFirebaseCommands();
    listenForDeviceChanges();

    const uniqueClientId = `radio-revive-${deviceId}-${Date.now()}`;
    
    mqttClient = mqtt.connect(MQTT_URL, {
      clientId: uniqueClientId,
      clean: true,
      keepalive: 60,
      connectTimeout: 30000,
      reconnectPeriod: 0
    });

    mqttClient.on('connect', () => {
      logger.info({ clientId: uniqueClientId }, '✅ MQTT connected');
      
      const controlTopic = `radio-revive/${ORGANIZATION_ID}/device/${deviceId}/control`;
      mqttClient.subscribe(controlTopic, { qos: 1 }, (err) => {
        if (err) {
          logger.error({ err }, 'Failed to subscribe to control topic');
        } else {
          logger.info({ topic: controlTopic }, '📡 Subscribed to control topic');
        }
      });

      setTimeout(() => publishStatus(), 100);
    });

    mqttClient.on('message', (topic: string, message: Buffer) => {
      try {
        const payload = JSON.parse(message.toString());
        logger.info({ topic, payload }, '📨 Received MQTT message');

        if (payload.command === 'play' && payload.url) {
          playStream(payload.url);
        } else if (payload.command === 'stop') {
          stopStream();
        } else if (payload.command === 'restart') {
          playStream(currentUrl);
        }
      } catch (error) {
        logger.error({ error }, 'Failed to parse MQTT message');
      }
    });

    mqttClient.on('error', (error: Error) => {
      logger.error({ error }, 'MQTT error');
    });

    mqttClient.on('close', () => {
      logger.warn('MQTT connection closed');
      setTimeout(() => {
        if (!mqttClient.connected) {
          mqttClient.reconnect();
        }
      }, 5000);
    });

    logger.info('⏳ Waiting for device configuration from Firebase...');

    setInterval(() => {
      publishStatus();
      updateFirestoreStatus();
    }, 20000);

  } catch (error) {
    logger.error({ error }, '❌ Failed to start agent');
    process.exit(1);
  }
}

bootstrap();

// Add system update handler (if not already added)
// This should be added in the command listener section
