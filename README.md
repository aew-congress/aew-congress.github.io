# AEW Congress

A responsive program calendar and resource library for the AEW Congress community. The frontend is a Next.js static export for GitHub Pages. Firebase provides authentication and Firestore data; a Cloudflare Worker exposes the protected UploadThing endpoint without requiring Firebase Blaze.

## Run locally

```bash
npm install
npm run dev
```

Firebase web settings are in `src/lib/firebase.ts` and can be overridden with `.env.local` using the names in `.env.example`. The Firebase web API key and app identifiers are public client configuration. Firestore rules and verified email checks protect the data.

The program page shows an example event until the first real program is published. The example is only a preview and is not written to Firebase.

## Firebase setup

1. In Firebase Authentication, enable the Email/Password provider and add the deployed website's hostname to the authorized domains (`aew-caraga.github.io` for the default GitHub Pages deployment). Email verification links return to the app, so the active hostname must be authorized as a continue URL.
2. Create the Firestore database, then deploy `firestore.rules` with `firebase deploy --only firestore:rules`.
3. Create the superadmin in Firebase Authentication using `rjamescute2@gmail.com`, set a fresh password in Firebase Console, and verify that email address. Superadmin access is granted only to that verified identity. Do not reuse a password shared in chat.
4. Member registration sends a Firebase email verification link that returns to the app. After verification, the app syncs the profile into the Pending queue automatically while the registration session is active; no scheduled Cloud Function or Blaze plan is required. If the link is opened in another browser or device, return to the app in the browser where registration began.
5. Deploy the UploadThing route on the Cloudflare Workers Free plan. From the repository root, run:

   ```bash
   npx wrangler secret put UPLOADTHING_TOKEN --config uploadthing-worker/wrangler.jsonc
   npx wrangler deploy --config uploadthing-worker/wrangler.jsonc
   ```

   Enter the UploadThing V7 token at Wrangler's hidden prompt. It is stored as an encrypted Worker secret and never reaches the static frontend or Git history. GitHub Pages builds are configured with the deployed Worker endpoint in `.github/workflows/deploy-pages.yml`.

6. Deploy Firestore rules after any changes with `firebase deploy --only firestore:rules`. Uploads use the Cloudflare Worker, so Firebase Functions are not needed for the file upload endpoint.

## GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`. Create `aew-caraga/aew-caraga.github.io`, push this repository to its `main` branch, then choose **Settings → Pages → Build and deployment → GitHub Actions**. Each push to `main` builds the Next.js static export and publishes `out/` to `https://aew-caraga.github.io`.

```bash
git init
git add .
git commit -m "Build AEW Congress programs site"
git branch -M main
git remote add origin https://github.com/aew-caraga/aew-caraga.github.io.git
git push -u origin main
```

## Features

- Public program listing with date, venue, daily session flow, and search.
- Public materials shelf grouped by Guidelines, Presentation, References, and Worksheet.
- Account registration with the requested member details, Philippine mobile format, email verification, and admin approval flow.
- Superadmin approval queue with Pending, Approved, and Disapproved states.
- Admins can manage programs, contests, and materials without access to user approval controls.
- Unverified accounts stay out of the approval queue; members cannot access signed-in views until approved and email-verified.
- Admin program and resource editors; file uploads pass through a Cloudflare Worker that validates the Firebase ID token and approved account before contacting UploadThing.
