import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync('./service-account.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const deviceId = '05d0dda82ffb5c5d';

async function checkDevice() {
    const deviceDoc = await db.collection('devices').doc(deviceId).get();
    console.log('📱 Device data:');
    console.log(JSON.stringify(deviceDoc.data(), null, 2));
    
    const groupId = deviceDoc.data().groupId;
    
    if (groupId) {
        console.log('\n🔍 Checking group:', groupId);
        const groupDoc = await db.collection('groups').doc(groupId).get();
        
        if (groupDoc.exists) {
            console.log('\n✅ Group EXISTS:');
            console.log(JSON.stringify(groupDoc.data(), null, 2));
        } else {
            console.log('\n❌ Group DOES NOT EXIST (borttagen!)');
        }
    } else {
        console.log('\n⚠️ Device has NO groupId');
    }
    
    process.exit(0);
}

checkDevice().catch(console.error);
