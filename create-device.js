import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync('./service-account.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const deviceId = '05d0dda82ffb5c5d';

async function createDevice() {
    console.log('🔍 Checking device:', deviceId);
    
    const deviceRef = db.collection('devices').doc(deviceId);
    const deviceDoc = await deviceRef.get();
    
    if (!deviceDoc.exists) {
        console.log('❌ Device does not exist in Firebase!');
        console.log('📝 Creating device...');
        
        await deviceRef.set({
            id: deviceId,
            name: 'Radio Revive Device',
            ipAddress: '192.168.1.242',
            isOnline: false,
            lastSeen: admin.firestore.FieldValue.serverTimestamp(),
            volume: 85,
            groupId: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('✅ Device created!');
    } else {
        console.log('✅ Device exists:');
        console.log(JSON.stringify(deviceDoc.data(), null, 2));
    }
    
    // Lista alla grupper
    console.log('\n📋 Available groups:');
    const groupsSnapshot = await db.collection('groups').get();
    groupsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        console.log(`  - ${doc.id}: ${data.name || 'Unnamed'}`);
    });
    
    process.exit(0);
}

createDevice().catch(console.error);
