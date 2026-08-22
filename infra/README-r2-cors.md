# R2 bucket CORS

Uploads go **straight from the browser to R2** on a presigned URL — they never pass through
the API. That makes the transfer cross-origin, so the bucket itself has to permit it. The
API cannot grant this on R2's behalf.

Without a policy on the bucket, every upload fails like this:

```
$ curl -i -X OPTIONS "https://<account>.eu.r2.cloudflarestorage.com/<bucket>/<key>" \
    -H "Origin: https://www.testroutify.com" \
    -H "Access-Control-Request-Method: PUT"

HTTP/1.1 403 Forbidden
<Error><Code>Unauthorized</Code><Message>CORS not configured for this bucket</Message></Error>
```

The same URL succeeds from `curl -X PUT` (200), because curl sends no `Origin` and therefore
triggers no preflight. **A working curl upload does not prove the browser can upload.**

## Applying it

Cloudflare dashboard → **R2** → your bucket (`testroutify`) → **Settings** tab → scroll to
**CORS Policy** → **Edit CORS policy** → paste [`r2-cors.json`](r2-cors.json) → **Save**.

It takes effect within a few seconds; no redeploy is needed on our side.

## Why each field is there

* **`AllowedMethods` must include `PUT`.** `PUT` is never a "simple" method, so the browser
  preflights *every* upload — including multipart part uploads, which send no custom
  headers at all. `GET`/`HEAD` are for the player: hls.js reads playlists and segments from
  R2 with XHR, and cannot touch a response that carries no CORS header.

* **`AllowedHeaders` includes `content-type`** because the uploader sets it, and a video
  MIME type is not on the CORS-safelist, so it appears in
  `Access-Control-Request-Headers`.

* **`ExposeHeaders` must include `ETag`.** Multipart assembly sends each part's ETag back
  to the API, and R2 verifies them. Without this line the PUT succeeds but JavaScript
  cannot read the response header, and the upload fails at the last step with
  *"Storage did not return an ETag for this part"* — see
  [`directUpload.ts`](../apps/web/src/upload/directUpload.ts).

* **`AllowedOrigins` lists both apex and `www`.** Whichever one the site is actually served
  from must appear here exactly, scheme included. Add `http://localhost:5174` temporarily if
  you ever point a local API at the real bucket — local development normally uses MinIO,
  which does not enforce CORS, which is precisely why this problem only ever appears in
  production.
