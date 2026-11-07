import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createUploadthing, type FileRouter } from "uploadthing/express";
import { UploadThingError } from "uploadthing/server";
import { SUPERADMIN_EMAIL } from "./values";

const f = createUploadthing();

export const uploadRouter = {
  materialUploader: f({
    pdf: { maxFileSize: "16MB", maxFileCount: 1 },
    blob: { maxFileSize: "16MB", maxFileCount: 1 },
  })
    .middleware(async ({ req }) => {
      const authorization = req.headers.authorization;
      const idToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!idToken) throw new UploadThingError("You must sign in to upload materials.");

      let decoded;
      try {
        decoded = await getAuth().verifyIdToken(idToken);
      } catch {
        throw new UploadThingError("Your session has expired. Sign in and try again.");
      }

      if (!decoded.email_verified) throw new UploadThingError("Verify your email address before uploading.");
      const profile = await getFirestore().doc(`userProfiles/${decoded.uid}`).get();
      const isAdmin = decoded.email?.toLowerCase() === SUPERADMIN_EMAIL
        || (profile.exists && ["admin", "superadmin"].includes(String(profile.data()?.role)));
      if (!isAdmin && (!profile.exists || profile.data()?.status !== "Approved")) {
        throw new UploadThingError("Only approved members can upload materials.");
      }

      return { uid: decoded.uid };
    })
    .onUploadComplete(({ file, metadata }) => ({
      url: file.ufsUrl,
      name: file.name,
      key: file.key,
      uploadedBy: metadata.uid,
    })),
} satisfies FileRouter;

export type OurFileRouter = typeof uploadRouter;
