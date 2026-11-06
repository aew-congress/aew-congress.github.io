# UploadThing Worker

This Worker hosts the UploadThing file route separately from Firebase. It validates each uploader's Firebase ID token with Firebase Authentication, then checks the user's approved status in Firestore. The UploadThing token stays encrypted in Cloudflare Worker secrets.

## Deploy

From the repository root, run:

```bash
npx wrangler secret put UPLOADTHING_TOKEN --config uploadthing-worker/wrangler.jsonc
npx wrangler deploy --config uploadthing-worker/wrangler.jsonc
```

Paste the UploadThing V7 token at Wrangler's hidden prompt. The endpoint is:

```text
https://aew-congress-uploadthing.ps-taguibo-uploadthing-worker.workers.dev/api/uploadthing
```

The GitHub Pages workflow sets `NEXT_PUBLIC_UPLOADTHING_URL` to this endpoint at build time. If you deploy under another URL, update that workflow value and the local default in `src/lib/uploadthing.ts`.

The same Worker exposes `/api/download` for uploaded files. It accepts only HTTPS UploadThing file URLs (`ufs.sh` or `utfs.io`) and streams them with an attachment filename so the browser downloads them directly. The schedule download is generated in the browser as a CSV file.
