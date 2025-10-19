import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger.js';
const MUSIC_DIR = '/home/dietpi/music';
const PLAYLIST_DIR = '/home/dietpi/playlists';
export class MusicSync {
    firestore;
    deviceId;
    constructor(firestore, deviceId) {
        this.firestore = firestore;
        this.deviceId = deviceId;
        if (!fs.existsSync(MUSIC_DIR)) {
            fs.mkdirSync(MUSIC_DIR, { recursive: true });
        }
        if (!fs.existsSync(PLAYLIST_DIR)) {
            fs.mkdirSync(PLAYLIST_DIR, { recursive: true });
        }
    }
    async syncGroupMusic(groupId) {
        try {
            logger.info({ groupId }, 'Syncing music for group');
            const groupDoc = await this.firestore
                .collection('config')
                .doc('groups')
                .collection('list')
                .doc(groupId)
                .get();
            if (!groupDoc.exists) {
                return null;
            }
            const groupData = groupDoc.data();
            const musicFiles = groupData?.musicFiles || [];
            if (musicFiles.length === 0) {
                return groupData?.streamUrl || null;
            }
            const localFiles = [];
            for (const fileUrl of musicFiles) {
                const fileName = path.basename(new URL(fileUrl).pathname);
                const localPath = path.join(MUSIC_DIR, fileName);
                if (!fs.existsSync(localPath)) {
                    try {
                        execSync(`wget -q -O "${localPath}" "${fileUrl}"`, { timeout: 60000 });
                        logger.info({ localPath }, 'Downloaded');
                    }
                    catch (error) {
                        logger.error({ error }, 'Download failed');
                        continue;
                    }
                }
                localFiles.push(localPath);
            }
            if (localFiles.length === 0) {
                return groupData?.streamUrl || null;
            }
            const playlistPath = path.join(PLAYLIST_DIR, `${groupId}.m3u`);
            fs.writeFileSync(playlistPath, localFiles.join('\n'));
            return playlistPath;
        }
        catch (error) {
            logger.error({ error }, 'Sync failed');
            return null;
        }
    }
}
