# Discovery v2 setup and operation

Discovery is an isolated workspace inside the existing Lens application. It accepts one active ingest session at a time and retains completed sessions under ignored `.runtime/discovery/`. Opening the page, polling, playing media, or downloading an export does not invoke a model. `Start` is the explicit inference boundary.

## Install, check, and run on the laptop

Use Node 20 or later and the checked-in lockfile:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run discovery:contract
npm run discovery:preflight
npm start
```

The default preflight is local only and makes no model call. It reports configuration, credential presence, FFmpeg, and FFprobe. A counted chronological-image check of the configured proposer and reviewer requires an explicit command:

```sh
DISCOVERY_ACCESS_CODE='<the configured 32-byte-or-longer code>' \
DISCOVERY_CREDENTIALS_FILE=.runtime/vision-evaluation/workshop-credentials.json \
npm run discovery:preflight -- --invoke
```

The two attempts are admitted to `.runtime/discovery/build-evaluation-ledger.jsonl`; the persistent implementation ceiling is 80 calls. There are no automatic model retries or format-repair calls.

The development smoke runner reserves its maximum two calls before it creates a session:

```sh
DISCOVERY_ACCESS_CODE='<the configured code>' \
npm run discovery:smoke -- --kind video --file public/demo/basketball-event.mp4
```

For localhost development, open `http://127.0.0.1:5173`, choose **Discovery**, enter the server access code, prepare one source, then press **Start**. A generated access code is printed by `npm start` when `DISCOVERY_ACCESS_CODE` is not configured. Do not publish or put that code in client code.

## Same-Wi-Fi phone capture

Phone camera APIs require a secure context. Build first, then serve the built UI and API from one trusted HTTPS LAN origin. Do not use a public tunnel or bypass certificate warnings.

On macOS, find the active Wi-Fi address:

```sh
ipconfig getifaddr en0
```

Create a locally trusted certificate containing the actual address. With `mkcert` installed, replace `192.168.1.20` below with the reported address:

```sh
mkdir -p .runtime/discovery/tls
mkcert -install
mkcert \
  -cert-file .runtime/discovery/tls/lens.pem \
  -key-file .runtime/discovery/tls/lens-key.pem \
  localhost 127.0.0.1 ::1 192.168.1.20
mkcert -CAROOT
```

Install the `rootCA.pem` from the printed CA directory on the phone through a private local transfer. On iOS/iPadOS, install the downloaded profile, then enable full trust under **Settings → General → About → Certificate Trust Settings**. On Android, use the device's **Install a CA certificate** control (the exact Settings path varies by vendor). The phone must trust the CA before opening the Lens origin.

Start the laptop server with an exact public origin and both TLS files:

```sh
DISCOVERY_ACCESS_CODE='<at least 32 random bytes>' \
DISCOVERY_BIND_HOST=0.0.0.0 \
DISCOVERY_PUBLIC_ORIGIN=https://192.168.1.20:8787 \
DISCOVERY_TLS_CERT=.runtime/discovery/tls/lens.pem \
DISCOVERY_TLS_KEY=.runtime/discovery/tls/lens-key.pem \
npm start
```

Then:

1. On the laptop, open the HTTPS origin, sign into Discovery, choose **Phone**, prepare the session, and press **Start**.
2. Scan the two-minute one-time QR link. The secret remains in the URL fragment and `/capture` removes it before redemption.
3. Tap **Start camera** on the phone and grant rear-camera permission. Keep the phone unlocked and the page foregrounded. Audio is never requested.
4. Tap **Stop and drain** on the phone or **Stop & drain** on the laptop. Canceling or deleting the session revokes its phone credentials.

The pilot limit is five minutes. Upload backpressure allows one upload in flight and two pending batches; older unsent work is dropped and counted. Capture gaps over 500 ms make an observed-action opportunity locally insufficient. Event video is an 8 fps held-frame reconstruction and is labeled `sampled_camera_frames`; it never interpolates motion.

## Bounded evaluation

Dry-run planning is the default and never invokes a model:

```sh
npm run discovery:evaluate -- \
  --manifest .runtime/vision-evaluation/manifest.json \
  --split holdout \
  --mode cascade_gated
```

Available modes are `direct_uniform`, `cascade_uniform`, and `cascade_gated`. Invocation requires `--invoke`, a new `--run` directory, and an explicit per-command `--max-calls`. It uses only the privacy-reviewed masked manifest and does not load reference labels. Never point it at unreviewed originals.

```sh
DISCOVERY_CREDENTIALS_FILE=.runtime/vision-evaluation/workshop-credentials.json \
npm run discovery:evaluate -- \
  --manifest .runtime/vision-evaluation/manifest.json \
  --split holdout \
  --mode cascade_gated \
  --run .runtime/discovery/evaluations/cascade-gated-v2 \
  --max-calls 24 \
  --invoke
```

## Operational behavior

- Model IDs, usage, latency, unknown outcomes, and safe failure categories are written to the private JSONL ledger.
- Credentials, raw image bytes, client filenames, and local source paths are never returned in events.
- Controller cookies are HttpOnly and SameSite=Strict. Phone cookies are Secure and scoped in application logic to one session/generation.
- Session cancel increments the generation and discards late publishing. Restart marks active work `interrupted` and unfinished cached work `unknown`; it does not replay paid calls.
- Approved assets support authenticated `GET`, `HEAD`, and one byte range. API misses remain JSON and do not fall through to the SPA.
- Completed public events validate against `shared/discovery.ts` schema version `2.0`. Rejected, uncertain, failed, expired, and suppressed candidates remain diagnostics rather than public events.

## Source handoff archive

Create the sanitized source archive with:

```sh
npm run discovery:archive
```

It writes under ignored `.runtime/discovery/exports/` and excludes credentials, runtime results, build output, media extensions, and private/raw pilot directories. The command prints the file count, size, and SHA-256 and saves the same values in a companion manifest.
