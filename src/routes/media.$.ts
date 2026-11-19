import { createFileRoute } from "@tanstack/react-router";
import { contentTypeForKey, IMAGE_CACHE_CONTROL, isImageKey } from "@/domain/media";
import { getImages } from "@/server/env";

// A client may send several tags, weak ones (`W/`), or `*`; compare each against the object's ETag.
function notModified(ifNoneMatch: string | null, httpEtag: string): boolean {
  if (!ifNoneMatch) return false;
  const normalize = (tag: string) => tag.trim().replace(/^W\//, "");
  const expected = normalize(httpEtag);
  return ifNoneMatch.split(",").some((tag) => {
    const candidate = normalize(tag);
    return candidate === "*" || candidate === expected;
  });
}

function imageHeaders(contentType: string, httpEtag: string, size: number): Headers {
  return new Headers({
    "Content-Type": contentType,
    "Content-Length": String(size),
    "Cache-Control": IMAGE_CACHE_CONTROL,
    ETag: httpEtag,
    "X-Content-Type-Options": "nosniff",
  });
}

async function mediaResponse(key: string, ifNoneMatch: string | null, withBody: boolean) {
  const contentType = contentTypeForKey(key);
  if (!isImageKey(key) || !contentType) return new Response("Not found", { status: 404 });

  const object = await getImages().get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = imageHeaders(contentType, object.httpEtag, object.size);
  if (notModified(ifNoneMatch, object.httpEtag)) return new Response(null, { status: 304, headers });
  return new Response(withBody ? object.body : null, { headers });
}

// Streams a product image from R2. Used when IMAGE_BASE_URL is blank (local dev, or before the bucket's custom
// domain is connected). Only image keys the app writes are served; anything else is a 404, so the route cannot be
// used to read other objects that might share the bucket.
export const Route = createFileRoute("/media/$")({
  server: {
    handlers: {
      GET: ({ params, request }) => mediaResponse(params._splat ?? "", request.headers.get("If-None-Match"), true),
      HEAD: ({ params, request }) => mediaResponse(params._splat ?? "", request.headers.get("If-None-Match"), false),
    },
  },
});
