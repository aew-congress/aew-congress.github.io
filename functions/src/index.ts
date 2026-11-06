import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import cors from "cors";
import express from "express";
import { createRouteHandler } from "uploadthing/express";
import { uploadRouter } from "./uploadthing";

initializeApp();

const uploadthingToken = defineSecret("UPLOADTHING_TOKEN");

const uploadApp = express();
uploadApp.use(cors({ origin: true }));
uploadApp.use("/api/uploadthing", (request, response, next) => {
  const handler = createRouteHandler({
    router: uploadRouter,
    config: {
      token: uploadthingToken.value(),
    },
  });
  return handler(request, response, next);
});

export const uploadthing = onRequest(
  { region: "us-central1", cors: true, secrets: [uploadthingToken] },
  uploadApp,
);

/** Sends a generated Firebase verification link after a superadmin approves a member. */
export const sendApprovalVerification = onDocumentUpdated("userProfiles/{uid}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  const uid = event.params.uid;
  if (!before || !after || before.status === "Approved" || after.status !== "Approved") return;

  const authUser = await getAuth().getUser(uid);
  if (!authUser.email) return;
  const verificationLink = await getAuth().generateEmailVerificationLink(authUser.email, {
    url: "https://aew-caraga.github.io/",
  });
  const safeName = String(after.firstName || "there").replace(/[<>"']/g, "");

  // Firebase's Trigger Email extension sends documents written to the `mail` collection.
  await getFirestore().collection("mail").add({
    to: authUser.email,
    message: {
      subject: "Your AEW Congress account is approved",
      text: `Hello ${safeName}, your AEW Congress account is approved. Verify your email address to sign in: ${verificationLink}`,
      html: `<p>Hello ${safeName},</p><p>Your AEW Congress account has been approved. Verify your email address to sign in.</p><p><a href="${verificationLink}">Verify my email address</a></p>`,
    },
    createdAt: FieldValue.serverTimestamp(),
  });
});

/** Moves verified registrations into the superadmin approval queue without requiring another sign-in. */
export const syncVerifiedRegistrations = onSchedule("every 1 minutes", async () => {
  const firestore = getFirestore();
  const unverifiedProfiles = await firestore.collection("userProfiles")
    .where("status", "==", "Unverified")
    .get();

  for (let offset = 0; offset < unverifiedProfiles.docs.length; offset += 100) {
    const profileBatch = unverifiedProfiles.docs.slice(offset, offset + 100);
    const { users } = await getAuth().getUsers(profileBatch.map(({ id }) => ({ uid: id })));
    const authUsersByUid = new Map(users.map((user) => [user.uid, user]));

    await Promise.all(profileBatch.map(async (profileDocument) => {
      const authUser = authUsersByUid.get(profileDocument.id);
      const profileEmail = String(profileDocument.get("email") ?? "").trim().toLowerCase();
      if (!authUser?.emailVerified || !authUser.email || profileEmail !== authUser.email.trim().toLowerCase()) return;

      await firestore.runTransaction(async (transaction) => {
        const latestProfile = await transaction.get(profileDocument.ref);
        const latestData = latestProfile.data();
        if (!latestProfile.exists || latestData?.status !== "Unverified") return;
        if (String(latestData.email ?? "").trim().toLowerCase() !== authUser.email?.trim().toLowerCase()) return;

        transaction.update(profileDocument.ref, { emailVerified: true, status: "Pending" });
      });
    }));
  }
});
