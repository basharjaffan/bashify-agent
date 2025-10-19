import { createHash } from 'crypto';
import * as os from 'os';
import { execSync } from 'child_process';
import admin from 'firebase-admin';
import { logger } from '../logger.js';
export function getDeviceId() {
    const networkInterfaces = os.networkInterfaces();
    const mac = Object.values(networkInterfaces)
        .flat()
        .find(i => i && !i.internal && i.mac !== '00:00:00:00:00:00')?.mac || 'unknown';
    return createHash('sha256').update(mac).digest('hex').substring(0, 16);
}
function getLocalIP() {
    const nets = os.networkInterfaces();
    const priority = ['wlan0', 'eth0'];
    for (const interfaceName of priority) {
        const iface = nets[interfaceName];
        if (iface) {
            for (const net of iface) {
                if (net.family === 'IPv4' && !net.internal) {
                    return net.address;
                }
            }
        }
    }
    for (const name of Object.keys(nets)) {
        const iface = nets[name];
        if (iface) {
            for (const net of iface) {
                if (net.family === 'IPv4' && !net.internal) {
                    return net.address;
                }
            }
        }
    }
    return 'unknown';
}
function getNetworkType() {
    const nets = os.networkInterfaces();
    const hasWifi = nets['wlan0']?.some(net => net.family === 'IPv4' && !net.internal) || false;
    const hasEthernet = nets['eth0']?.some(net => net.family === 'IPv4' && !net.internal) || false;
    return { wifi: hasWifi, ethernet: hasEthernet };
}
function getSystemMetrics() {
    try {
        const cpuUsage = os.loadavg()[0] * 100 / os.cpus().length;
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const memoryUsage = ((totalMem - freeMem) / totalMem) * 100;
        const diskOutput = execSync('df -h / | tail -1', { encoding: 'utf8' });
        const diskParts = diskOutput.trim().split(/\s+/);
        const diskUsage = parseInt(diskParts[4]?.replace('%', '') || '0');
        const diskTotal = diskParts[1] || 'Unknown';
        const diskUsed = diskParts[2] || 'Unknown';
        return {
            cpu: Math.round(cpuUsage * 10) / 10,
            memory: Math.round(memoryUsage * 10) / 10,
            disk: { usage: diskUsage, total: diskTotal, used: diskUsed }
        };
    }
    catch (error) {
        logger.error({ error }, 'Failed to get system metrics');
        return {
            cpu: 0,
            memory: 0,
            disk: { usage: 0, total: 'Unknown', used: 'Unknown' }
        };
    }
}
function getUptime() {
    return os.uptime();
}
function getFirmwareVersion() {
    try {
        const version = execSync('git -C /home/dietpi/radio-revive rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        return version || 'unknown';
    }
    catch (error) {
        return 'unknown';
    }
}
export async function getGroupStreamUrl(firestore, deviceId) {
    try {
        const deviceDoc = await firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(deviceId)
            .get();
        if (!deviceDoc.exists) {
            logger.warn({ deviceId }, 'Device not found in Firebase');
            return null;
        }
        const deviceData = deviceDoc.data();
        const groupId = deviceData?.group;
        if (!groupId) {
            logger.warn({ deviceId }, 'Device is not assigned to any group');
            return null;
        }
        const groupDoc = await firestore
            .collection('config')
            .doc('groups')
            .collection('list')
            .doc(groupId)
            .get();
        if (!groupDoc.exists) {
            logger.warn({ groupId }, 'Group not found');
            return null;
        }
        const groupData = groupDoc.data();
        const streamUrl = groupData?.streamUrl;
        if (!streamUrl) {
            logger.warn({ groupId }, 'Group has no stream URL configured');
            return null;
        }
        logger.info({ groupId, streamUrl }, 'Got stream URL from group');
        return streamUrl;
    }
    catch (error) {
        logger.error({ error, deviceId }, 'Failed to get group stream URL');
        return null;
    }
}
export async function updateDeviceHeartbeat(firestore, deviceId, isPlaying = false, currentUrl = '') {
    try {
        const deviceRef = firestore
            .collection('config')
            .doc('devices')
            .collection('list')
            .doc(deviceId);
        const ipAddress = getLocalIP();
        const uptime = getUptime();
        const firmwareVersion = getFirmwareVersion();
        const networkType = getNetworkType();
        const metrics = getSystemMetrics();
        const deviceSnap = await deviceRef.get();
        const existingData = deviceSnap.exists ? deviceSnap.data() : {};
        const updateData = {
            lastSeen: admin.firestore.FieldValue.serverTimestamp(),
            ipAddress: ipAddress,
            status: isPlaying ? 'playing' : 'online',
            deviceId: deviceId,
            uptime: uptime,
            firmwareVersion: firmwareVersion,
            wifiConnected: networkType.wifi,
            ethernetConnected: networkType.ethernet,
            cpuUsage: metrics.cpu,
            memoryUsage: metrics.memory,
            diskUsage: metrics.disk.usage,
            diskTotal: metrics.disk.total,
            diskUsed: metrics.disk.used,
        };
        if (!existingData?.name) {
            updateData.name = `Device ${deviceId.substring(0, 8)}`;
        }
        if (currentUrl) {
            updateData.currentUrl = currentUrl;
        }
        await deviceRef.set(updateData, { merge: true });
        logger.info({ metrics: { cpu: metrics.cpu, memory: metrics.memory, disk: metrics.disk } }, "Metrics collected");
        logger.debug({ deviceId, ipAddress, uptime, firmwareVersion }, 'Heartbeat sent');
    }
    catch (error) {
        logger.error({ error: String(error), deviceId }, 'Failed to send heartbeat');
    }
}
