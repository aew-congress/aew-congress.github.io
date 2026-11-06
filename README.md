# AEW Caraga

A responsive program calendar and resource library for the AEW Caraga community. The frontend is a Next.js static export for GitHub Pages. Firebase provides authentication, Firestore data, and approval email delivery; a Firebase Function exposes the protected UploadThing endpoint.

## Run locally

```bash
npm install
npm run dev
```

Firebase web settings are in `src/lib/firebase.ts` and can be overridden with `.env.local` using the names in `.env.example`. The Firebase web API key and app identifiers are public client configuration. Firestore rules and verified email checks protect the data.

The program page shows an example event until the first real program is published. The example is only a preview and is not written to Firebase.

## Firebase setup

1. In Firebase Authentication, enable the Email/Password provider and add `aew-caraga.github.io` to the authorized domains.
2. Create the Firestore database, then deploy `firestore.rules` with `firebase deploy --only firestore:rules`.
3. Create the superadmin in Firebase Authentication using `rjamescute2@gmail.com`, set a fresh password in Firebase Console, and verify that email address. Superadmin access is granted only to that verified identity. Do not reuse a password shared in chat.
4. Install Firebase's **Trigger Email** extension and configure its SMTP sender. It watches the `mail` collection. When a superadmin approves a member, the `sendApprovalVerification` function generates a Firebase verification link and writes the email to that collection.
5. Rotate the UploadThing key that was shared in the original setup message before using uploads. Create a current UploadThing V7 token in its dashboard, then save the replacement directly into Firebase Secret Manager; never add it to `.env.local`, GitHub, or source files:

   ```bash
   firebase functions:secrets:set UPLOADTHING_TOKEN
   firebase deploy --only functions
   ```

   The token is bound only to the server function and never reaches the static frontend. The default frontend endpoint is `https://us-central1-aew-caraga.cloudfunctions.net/uploadthing/api/uploadthing`; override it with `NEXT_PUBLIC_UPLOADTHING_URL` if the function URL differs.

6. Run `firebase deploy --only firestore:rules,functions` after setup. The first command deploys the database rules; the Functions deploy also builds the TypeScript backend.

The Firebase Trigger Email extension needs a working SMTP provider. Firebase generates the verification URL; the extension delivers the message.

## GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`. Create `aew-caraga/aew-caraga.github.io`, push this repository to its `main` branch, then choose **Settings → Pages → Build and deployment → GitHub Actions**. Each push to `main` builds the Next.js static export and publishes `out/` to `https://aew-caraga.github.io`.

```bash
git init
git add .
git commit -m "Build AEW Caraga programs site"
git branch -M main
git remote add origin https://github.com/aew-caraga/aew-caraga.github.io.git
git push -u origin main
```

## Features

- Public program listing with date, venue, daily session flow, search, and track filters.
- Public materials shelf grouped by Guidelines, Presentation, References, and Worksheet.
- Account registration with the requested member details, Philippine mobile format, password strength meter, and login/create-account flip transition.
- Superadmin approval queue with Pending, Approved, and Disapproved states.
- Approval-triggered verification email; members cannot access signed-in views until approved and email-verified.
- Admin program and resource editors; file uploads pass through a Firebase Function that validates a Firebase ID token before contacting UploadThing.
