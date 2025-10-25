import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(readFileSync('./service-account.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkDevices() {
    const devicesSnapshot = await db.collection('devices').get();
    
    console.log(`📱 Total devices: ${devicesSnapshot.size}\n`);
    
    devicesSnapshot.docs.forEach(doc => {
        const data = doc.data();
        console.log(`Device: ${doc.id}`);
        console.log(`  Name: ${data.name || 'N/A'}`);
        console.log(`  GroupId: ${data.groupId || 'none'}`);
        console.log(`  Online: ${data.isOnline}`);
        console.log(`  IP: ${data.ipAddress || 'N/A'}`);
        console.log('');
    });
    
    process.exit(0);
}

checkDevices().catch(console.error);
