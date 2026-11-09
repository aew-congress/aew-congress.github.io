import { createRouteHandler, createUploadthing, UploadThingError } from "uploadthing/server";

const allowedOrigins = new Set([
  "https://aew-congress.github.io",
  "https://aew-caraga.web.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const uploadThingFileDomains = ["ufs.sh", "utfs.io"];

function parseUploadThingFileUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const allowedHost = uploadThingFileDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  return url.protocol === "https:" && allowedHost && url.pathname.startsWith("/f/") ? url : null;
}

function downloadFilename(requestedName, contentType, sourceUrl) {
  let name = String(requestedName || "program-material")
    .split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "-")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
  if (!name) name = "program-material";
  if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
    const sourceExtension = sourceUrl.pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1];
    const mimeExtensions = {
      "application/pdf": "pdf",
      "application/zip": "zip",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.ms-powerpoint": "ppt",
      "application/msword": "doc",
      "text/csv": "csv",
      "text/plain": "txt",
    };
    const mime = (contentType || "").split(";")[0].trim().toLowerCase();
    const extension = sourceExtension || mimeExtensions[mime];
    if (extension) name = `${name}.${extension}`;
  }
  return name;
}

function contentDisposition(filename) {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function downloadUploadThingFile(request) {
  const requestUrl = new URL(request.url);
  const rawSource = requestUrl.searchParams.get("url") || "";
  let currentUrl = parseUploadThingFileUrl(rawSource);
  if (!currentUrl) return new Response("Invalid UploadThing file URL", { status: 400 });

  let upstream;
  for (let redirects = 0; redirects <= 4; redirects++) {
    upstream = await fetch(currentUrl, { method: "GET", redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
    const location = upstream.headers.get("location");
    await upstream.body?.cancel();
    if (!location || redirects === 4) return new Response("The file could not be downloaded", { status: 502 });
    currentUrl = parseUploadThingFileUrl(new URL(location, currentUrl).toString());
    if (!currentUrl) return new Response("Invalid file redirect", { status: 502 });
  }

  if (!upstream?.ok || !upstream.body) return new Response("The UploadThing file is unavailable", { status: 502 });
  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const contentLength = Number(upstream.headers.get("content-length") || 0);
  if (contentLength > 20 * 1024 * 1024) {
    await upstream.body.cancel();
    return new Response("The file is larger than the download limit", { status: 413 });
  }

  const filename = downloadFilename(requestUrl.searchParams.get("name"), contentType, currentUrl);
  const headers = new Headers({
    "content-type": contentType,
    "content-disposition": contentDisposition(filename),
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  if (upstream.headers.has("content-length")) headers.set("content-length", upstream.headers.get("content-length"));
  return new Response(upstream.body, { status: 200, headers });
}

function makeUploadRouter(env) {
  const f = createUploadthing();
  return {
    materialUploader: f({
      pdf: { maxFileSize: "16MB", maxFileCount: 10 },
      blob: { maxFileSize: "16MB", maxFileCount: 10 },
      image: { maxFileSize: "16MB", maxFileCount: 10 },
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
    speakerImageUploader: f({
      image: { maxFileSize: "8MB", maxFileCount: 1 },
    })
      .middleware(async ({ req }) => {
        const authorization = req.headers.get("authorization") || "";
        const idToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        if (!idToken) throw new UploadThingError("Sign in with an admin account to upload speaker photos.");

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

        let isAdmin = String(account.email || "").toLowerCase() === "rjamescute2@gmail.com";
        if (!isAdmin) {
          let profileResponse;
          try {
            const profileUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/userProfiles/${encodeURIComponent(account.localId)}`;
            profileResponse = await fetch(profileUrl, { headers: { authorization: `Bearer ${idToken}` } });
          } catch {
            throw new UploadThingError("We could not verify admin access. Please try again.");
          }
          if (!profileResponse.ok) throw new UploadThingError("Only admins can upload speaker photos.");
          const profile = await profileResponse.json();
          isAdmin = ["admin", "superadmin"].includes(profile.fields?.role?.stringValue);
        }
        if (!isAdmin) throw new UploadThingError("Only admins can upload speaker photos.");
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
    headers.set("access-control-expose-headers", "content-disposition");
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
    if (url.pathname === "/api/download") {
      if (request.method === "OPTIONS") return addCors(request, new Response(null, { status: 204 }));
      if (request.method !== "GET") return addCors(request, new Response("Method not allowed", { status: 405 }));
      try {
        return addCors(request, await downloadUploadThingFile(request));
      } catch {
        return addCors(request, new Response("File download failed", { status: 502 }));
      }
    }
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
