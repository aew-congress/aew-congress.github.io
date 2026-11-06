import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
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
