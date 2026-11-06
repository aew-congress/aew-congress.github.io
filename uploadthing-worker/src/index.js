import { createRouteHandler, createUploadthing, UploadThingError } from "uploadthing/server";

const allowedOrigins = new Set([
  "https://aew-congress.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function makeUploadRouter(env) {
  const f = createUploadthing();
  return {
    materialUploader: f({
      pdf: { maxFileSize: "16MB", maxFileCount: 1 },
      blob: { maxFileSize: "16MB", maxFileCount: 1 },
    })
      .middleware(async ({ req }) => {
        const authorization = req.headers.get("authorization") || "";
        const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        if (!idToken) throw new UploadThingError("Sign in with an approved account to upload materials.");

        let authResponse;
        try {
          authResponse = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(env.FIREBASE_API_KEY), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ idToken }),
          });
        } catch {
          throw new UploadThingError("We could not verify your account. Please try again.");
        }

        if (!authResponse.ok) throw new UploadThingError("Your session has expired. Sign in again and retry.");
        const authPayload = await authResponse.json();
        const account = authPayload.users?.[0];
        if (!account || account.disabled || !account.emailVerified) {
          throw new UploadThingError("Verify your email address before uploading.");
        }

        const email = String(account.email || "").toLowerCase();
        const isSuperadmin = email === "rjamescute2@gmail.com";
        if (!isSuperadmin) {
          let profileResponse;
          try {
            const profileUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/userProfiles/${encodeURIComponent(account.localId)}`;
            profileResponse = await fetch(profileUrl, {
              headers: { authorization: `Bearer ${idToken}` },
            });
          } catch {
            throw new UploadThingError("We could not confirm your account approval. Please try again.");
          }

          if (!profileResponse.ok) throw new UploadThingError("Only approved members can upload materials.");
          const profile = await profileResponse.json();
          const role = profile.fields?.role?.stringValue;
          const status = profile.fields?.status?.stringValue;
          if (role !== "superadmin" && status !== "Approved") {
            throw new UploadThingError("Only approved members can upload materials.");
          }
        }

        return { uid: account.localId };
      })
      .onUploadComplete(({ file, metadata }) => ({
        url: file.ufsUrl,
        name: file.name,
        key: file.key,
        uploadedBy: metadata.uid,
      })),
  };
}

function addCors(request, response) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
    headers.set("access-control-allow-headers", "authorization, b3, content-type, traceparent, uploadthing-hook, x-uploadthing-package, x-uploadthing-version");
    headers.set("access-control-max-age", "86400");
    headers.append("vary", "Origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/uploadthing") return new Response("Not found", { status: 404 });

    if (request.method === "OPTIONS") {
      return addCors(request, new Response(null, { status: 204 }));
    }
    if (request.method !== "GET" && request.method !== "POST") {
      return addCors(request, new Response("Method not allowed", { status: 405 }));
    }

    const handlers = createRouteHandler({
      router: makeUploadRouter(env),
      config: {
        token: env.UPLOADTHING_TOKEN,
        isDev: false,
        fetch: (input, init) => {
          if (init && "cache" in init) delete init.cache;
          return fetch(input, init);
        },
        handleDaemonPromise: (promise) => ctx.waitUntil(promise),
      },
    });

    try {
      return addCors(request, await handlers(request));
    } catch {
      return addCors(request, new Response("Upload service error", { status: 500 }));
    }
  },
};
