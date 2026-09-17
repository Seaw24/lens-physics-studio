# Intended setup and teammate integration

> Superseded architecture (September 16, 2026): read [VISION-FIRST-DIRECTION.md](VISION-FIRST-DIRECTION.md) first. The custom action-training requirement and mandatory two-detector design are withdrawn. This document retains historical details; do not execute its old training plan or copy its detector schema as the new design.

This runbook describes commands/interfaces the implementation tickets must deliver. Commands referring to new scripts are **not implemented yet**. The implementation model must replace assumptions with verified commands and results before marking D12 complete.

## 1. Setup sequence

1. Install the repository's existing locked Node dependencies with `npm ci` and run `npm test` / `npm run build`.
2. Add only the specified dependencies when implementing their tickets; update the lockfile.
3. Create `.runtime/discovery/venv` using Python 3.11 and install `ml/requirements.txt` after that file is implemented.
4. Verify `ffmpeg` and `ffprobe` versions and an H.264 encode/probe operation. Configure executable paths if not on PATH.
5. Copy the project's `.env.example` to `.env` if `.env` does not exist. Preserve existing user credentials/configuration.
6. Add server-only discovery configuration and a generated controller access code. Do not display AWS secrets in logs or the browser.
7. Run local dependency checks, then explicitly run model invocation preflight when configured.
8. Start the built HTTPS app for phone tests; ordinary local development remains `npm run dev`.

Example venv commands, after scripts/requirements exist:

```sh
python3.11 -m venv .runtime/discovery/venv
.runtime/discovery/venv/bin/python -m pip install -r ml/requirements.txt
.runtime/discovery/venv/bin/python ml/manifest.py validate --manifest /absolute/path/to/manifest.jsonl
```

Do not run placeholder paths verbatim. Do not require the teammate to reproduce a private absolute path from the original developer's laptop.

## 2. Environment template

Keep these alongside the existing AWS credential settings in `.env.example`, with empty secrets:

```dotenv
DISCOVERY_ENABLED=true
DISCOVERY_EXPLORER_MODEL_ID=amazon.nova-lite-v1:0
DISCOVERY_REVIEWER_MODEL_ID=us.anthropic.claude-opus-4-6-v1
DISCOVERY_ACCESS_CODE=
DISCOVERY_BIND_HOST=127.0.0.1
DISCOVERY_PUBLIC_ORIGIN=
DISCOVERY_TLS_CERT=
DISCOVERY_TLS_KEY=
DISCOVERY_PYTHON=.runtime/discovery/venv/bin/python
DISCOVERY_ACTION_MODE=pretrained_baseline
DISCOVERY_MODEL_DIR=
FFMPEG_PATH=
FFPROBE_PATH=
```

`.env` uses the controller's actual secret, executable paths, allowed AWS model/profile IDs, and TLS values. Set `DISCOVERY_ACTION_MODE=custom_head` only after a validated model directory is available. Cloud model provenance identifies the configured model/profile and prompt version; a provider-internal weight hash is not known and must not be invented.

For LAN HTTPS, set `DISCOVERY_BIND_HOST=0.0.0.0`, a reachable HTTPS origin, and the matching trusted certificate/key. If only one of certificate/key is set, fail configuration validation. If public origin is HTTP on a LAN address, do not claim phone-camera support.

## 3. Scripts to add

| Script | Expected behavior |
| --- | --- |
| `npm run discovery:preflight` | Checks local dependencies/configuration without model calls by default |
| `npm run discovery:preflight -- --invoke` | Explicit, logged real explorer/reviewer image checks using the configured account |
| `npm run discovery:evaluate -- --manifest <path> --mode <mode>` | Runs a stated evaluation mode and writes a report with actual usage |
| `npm run build` | Existing TypeScript and Vite build, including new client/server/shared code |
| `npm start` | Existing Express entry, now honoring optional HTTPS and owning worker lifecycle |

No hidden manual Python server is required. If the worker cannot start, `npm start` exposes that degraded state while still allowing independent capabilities where safe.

## 4. First real session

1. Open Discovery and sign in with the local controller access code.
2. Run explicit model preflight. Resolve real invocation failures before calling it connected.
3. Upload a held-out video and choose Scan recording. Observe raw detector evidence, review states, and actual call counters.
4. Confirm an approved event has playable media, a grounded reason, limitations, and no generated question/annotation fields.
5. Export the event JSON and retrieve the same media through its authenticated asset URL.
6. Upload a still image and confirm action recognition is marked not applicable and a possible approval is scene context.
7. Repeat the video in Replay as live mode; model evidence must not cross its source watermark.

## 5. Phone test

1. Build/start the HTTPS app and open the laptop workspace at its canonical HTTPS origin.
2. Ensure the phone can reach that origin and trusts its certificate using the documented device setup. The user performs phone trust/permission steps.
3. Create a live-phone session and open the pairing QR on the phone.
4. Tap Start camera, grant permission, verify rear-camera preview, and perform an interaction.
5. Confirm the laptop displays incoming-frame status, eventually a real verdict, and a silent sampled event clip.
6. Background/lock the phone; verify the system reports interruption instead of silently pretending capture continued.
7. Stop from the phone and verify queued captured evidence drains while new frames are rejected.

Record phone/browser version, actual observed sampling, dropped frames, network conditions, and event-to-verdict latency. A desktop mobile-sized screenshot is not this test.

## 6. Teammate read-only consumption

Browser components on the authenticated same-origin workspace use the controller cookie. A local teammate service can use a controller bearer secret configured in its server environment. Do not put that secret into client code.

Illustrative server-side JavaScript after the API exists:

```js
export async function readTeachingEvent(eventId) {
  const base = process.env.LENS_DISCOVERY_ORIGIN;
  const token = process.env.LENS_DISCOVERY_TOKEN;
  if (!base || !token) throw new Error("Configure the Lens origin and server token");
  const headers = { Authorization: `Bearer ${token}` };

  const response = await fetch(
    `${base}/api/discovery/events/${encodeURIComponent(eventId)}`, { headers }
  );
  if (!response.ok) throw new Error(`Discovery lookup failed: ${response.status}`);
  const event = await response.json();
  if (event.schemaVersion !== "1.1") throw new Error("Unsupported contract");
  if (event.exampleOnly) throw new Error("Synthetic fixture is not live evidence");
  if (event.review.verdict !== "teachable") return null;

  // Validate event with the implemented shared schema before production use.
  // Resolve only the documented same-origin asset path, never an arbitrary URL.
  const mediaUrl = new URL(event.media.url, base);
  if (mediaUrl.origin !== new URL(base).origin) throw new Error("Unexpected asset origin");
  const mediaResponse = await fetch(mediaUrl, { headers });
  if (!mediaResponse.ok) throw new Error("Approved media is unavailable");
  return { event, mediaResponse };
}
```

Teammates must distinguish clip-relative evidence seconds from source-media seconds. For image events, all temporal values are null. Never infer a measured physical value from the presence of a model confidence score.

## 7. Delivery evidence

Final handoff includes the real model manifest and data provenance, invocation/model IDs, test/build results, actual phone check, held-out evaluation, current limitations, and the exact startup commands used. Keep secrets, TLS private keys, bulk data, and model files out of the public repository.

If training access or phone setup remains blocked, state that the corresponding capability is incomplete. Keep the rest runnable; do not fabricate a result to make the checklist green.
