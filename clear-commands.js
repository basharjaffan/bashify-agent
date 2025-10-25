import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
  readFileSync('./service-account.json', 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function clearOldCommands() {
    const snapshot = await db.collection('commands')
        .where('processed', '==', false)
        .get();
    
    console.log(`Found ${snapshot.size} unprocessed commands`);
    
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
        console.log(`Deleting: ${doc.id} (${doc.data().action})`);
        batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log('✅ All old commands deleted!');
    process.exit(0);
}

clearOldCommands().catch(console.error);
