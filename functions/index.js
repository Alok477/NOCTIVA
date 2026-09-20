const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'asia-southeast3' });

exports.ensureConfiguredAdmin = onCall(async (request) => {
  const configuredAdminUid = process.env.ADMIN_UID;
  const callerUid = request.auth?.uid;

  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }

  if (!configuredAdminUid || callerUid !== configuredAdminUid) {
    throw new HttpsError('permission-denied', 'This account is not configured as an administrator.');
  }

  const user = await admin.auth().getUser(callerUid);
  await admin.auth().setCustomUserClaims(callerUid, {
    ...user.customClaims,
    admin: true,
  });

  return { admin: true };
});
