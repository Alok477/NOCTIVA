# NOCTIVA — GitHub + Vercel deployment

## 1. Put the project on GitHub

Extract this ZIP, create a GitHub repository, then commit/push the project root.

Do **not** create or commit a `.env` file. The repository contains `.env.example` only.

## 2. Import the repository into Vercel

In Vercel, choose **Add New → Project**, select the GitHub repository, and keep the detected Vite settings:

- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

The included `vercel.json` handles SPA deep-link routing.

## 3. Add Vercel environment variables

Add these under **Project → Settings → Environment Variables**:

- `VITE_TMDB_API`
- `VITE_BASE_URL` = `https://api.themoviedb.org/3`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_SITE_URL` = your final Vercel/custom-domain URL

Then redeploy.

## 4. Firebase setup

The frontend uses Firebase Authentication and Firestore. Make sure the Firebase project enables the providers/features used by the app and that your deployed domain is allowed in Firebase Authentication → Settings → Authorized domains.

The optional callable function is in `/functions`. Vercel does not deploy Firebase Functions from this directory. If the admin-only `ensureConfiguredAdmin` function is needed, deploy it separately with the Firebase CLI from the project root:

```bash
firebase login
firebase use noctiva-58434
cd functions
npm install
cd ..
firebase deploy --only functions
```

Before deploying that function, create `functions/.env` locally or configure the required function environment according to your Firebase Functions setup:

```env
ADMIN_UID=your_firebase_admin_uid
```

Never commit that value.

## 5. Important security note

The original uploaded project contained a live TMDB API key. This deployment package intentionally removes it. Create/rotate the TMDB key if the original key was ever used outside your private environment, then put the replacement in Vercel Environment Variables.

Firebase web configuration values are designed to be present in browser applications, but Firestore/Storage/Auth security rules must still be configured correctly.
