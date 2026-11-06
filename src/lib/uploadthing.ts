import { generateReactHelpers } from "@uploadthing/react";

export const uploadthingEndpoint = process.env.NEXT_PUBLIC_UPLOADTHING_URL ||
  "https://aew-congress-uploadthing.ps-taguibo-uploadthing-worker.workers.dev/api/uploadthing";
export const uploadthingDownloadEndpoint = new URL("/api/download", uploadthingEndpoint).toString();

// The API contract is shared at runtime through the route slug; keeping the
// frontend generic avoids importing the server-only UploadThing package here.
export const { uploadFiles } = generateReactHelpers<any>({ url: uploadthingEndpoint });
