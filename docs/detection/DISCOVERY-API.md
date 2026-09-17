# Discovery v2 API

Base path: `/api/discovery`. JSON errors use `{ "error": { "code": "...", "message": "...", "retryable": false } }`. Browser controller access uses the HttpOnly cookie returned by `POST /auth`. A backend may use `Authorization: Bearer <DISCOVERY_CONTROLLER_BEARER_TOKEN>`. Cookie-authenticated mutations require the configured exact Origin.

## Controller example

```sh
curl -i -c /tmp/lens-controller.cookies \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://127.0.0.1:8787' \
  --data '{"code":"<server access code>"}' \
  http://127.0.0.1:8787/api/discovery/auth

curl -b /tmp/lens-controller.cookies \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://127.0.0.1:8787' \
  -H 'Idempotency-Key: upload_demo_001' \
  --data '{"sourceKind":"video","mode":"scan"}' \
  http://127.0.0.1:8787/api/discovery/sessions

curl -b /tmp/lens-controller.cookies \
  -H 'Origin: http://127.0.0.1:8787' \
  -F 'source=@/absolute/path/to/recording.mp4;type=video/mp4' \
  http://127.0.0.1:8787/api/discovery/sessions/SESSION_ID/source

curl -b /tmp/lens-controller.cookies \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://127.0.0.1:8787' \
  --data '{"generation":1}' \
  http://127.0.0.1:8787/api/discovery/sessions/SESSION_ID/start
```

Starting is idempotent for the same active generation. Rerunning analysis means creating a new session; playback, seeking, polling, event export, and asset download never invoke inference.

## Routes

| Method and path | Scope | Behavior |
| --- | --- | --- |
| `POST /auth`, `DELETE /auth` | public/controller | Exchange the configured code for a controller cookie; revoke it. |
| `GET /config`, `POST /preflight` | controller | Safe settings; local preflight by default, counted calls only with `{ "invoke": true }`. |
| `POST /sessions`, `GET /sessions` | controller | Create with `Idempotency-Key`; list stored summaries. |
| `POST /sessions/:id/source` | controller | One bounded streaming image/video multipart upload before Start. |
| `POST /sessions/:id/start|pause|resume|stop|cancel` | controller | Generation-checked idempotent lifecycle transitions. |
| `GET /sessions/:id?afterRevision=N` | controller | Consistent state, events, diagnostics, budgets, and coverage; never inference. |
| `DELETE /sessions/:id` | controller | Cancel, revoke, then remove that generated session directory. |
| `POST /sessions/:id/pair` | controller | Two-minute one-time fragment link and QR for a live session. |
| `POST /pair/redeem` | pairing token | One use; returns a scoped Secure phone cookie. |
| `POST /sessions/:id/frames` | phone | One to eight JPEG multipart parts plus strict metadata; exact retries are idempotent. |
| `POST /sessions/:id/heartbeat|capture-stop` | phone | Update connection or end that phone's source. |
| `GET /sessions/:id/capture-status` | phone | Acknowledged sequence/gaps only; no events or controller data. |
| `GET /events/:id` | controller | One approved schema-version `2.0` event. |
| `GET|HEAD /assets/:id` | controller | Authenticated image/MP4; supports one `Range: bytes=...` interval. |

The runnable teammate example is `docs/detection/teammate-consumer.ts`. It validates `EventSchema`, rejects `exampleOnly`, permits only the authenticated same-origin media route, and never treats `scene_context` as an observed action.
