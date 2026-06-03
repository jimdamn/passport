/**
 * Asset server — serves files from the site-image-assets R2 bucket.
 *
 * Any file uploaded to the bucket is available at:
 *   https://exchange.lakeandlocals.com/site-assets/<key>
 *
 * Examples:
 *   /site-assets/favicon.png          → favicon.png in bucket root
 *   /site-assets/favicon.ico          → favicon.ico in bucket root
 *   /site-assets/badges/bd-member.png → badges/bd-member.png in bucket
 *
 * Cache strategy:
 *   - 1 hour browser cache, 1 day CDN cache for all assets.
 *   - Upload a new filename or add a query-string version param to bust cache.
 */

import type { Env } from '../../src/types';

const CONTENT_TYPES: Record<string, string> = {
  ico:  'image/x-icon',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg:  'image/svg+xml',
  gif:  'image/gif',
  avif: 'image/avif',
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  // Strip the leading /site-assets/ prefix to get the R2 key
  const key = url.pathname.replace(/^\/site-assets\//, '');

  if (!key) {
    return new Response('Not found', { status: 404 });
  }

  const obj = await context.env.SITE_ASSETS.get(key);

  if (!obj) {
    return new Response('Asset not found', { status: 404 });
  }

  const ext         = key.split('.').pop()?.toLowerCase() ?? '';
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

  return new Response(obj.body, {
    headers: {
      'Content-Type':  contentType,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'ETag':          obj.httpEtag,
    },
  });
};
