import { generateReactHelpers } from "@uploadthing/react";

const endpoint = process.env.NEXT_PUBLIC_UPLOADTHING_URL ||
  "https://us-central1-aew-caraga.cloudfunctions.net/uploadthing/api/uploadthing";

// The API contract is shared at runtime through the route slug; keeping the
// frontend generic avoids importing the server-only UploadThing package here.
export const { uploadFiles } = generateReactHelpers<any>({ url: endpoint });
