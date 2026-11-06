import { createFileRoute } from "@tanstack/react-router";
import { contentTypeForKey, IMAGE_CACHE_CONTROL, isImageKey } from "@/domain/media";
import { getImages } from "@/server/env";

// Streams a product image from R2. Used when IMAGE_BASE_URL is blank (local dev, or before the bucket's custom
// domain is connected). Only image keys the app writes are served; anything else is a 404, so the route cannot be
// used to read other objects that might share the bucket.
export const Route = createFileRoute("/media/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const key = params._splat ?? "";
        const contentType = contentTypeForKey(key);
        if (!isImageKey(key) || !contentType) return new Response("Not found", { status: 404 });

        const object = await getImages().get(key);
        if (!object) return new Response("Not found", { status: 404 });

        const headers = new Headers({
          "Content-Type": contentType,
          "Cache-Control": IMAGE_CACHE_CONTROL,
          ETag: object.httpEtag,
          "X-Content-Type-Options": "nosniff",
        });
        if (request.headers.get("If-None-Match") === object.httpEtag)
          return new Response(null, { status: 304, headers });
        return new Response(object.body, { headers });
      },
    },
  },
});
