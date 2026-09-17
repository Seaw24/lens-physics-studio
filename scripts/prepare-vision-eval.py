"""Prepare local-only evaluation frames. Review privacy masks before enabling cloud use.

The input config supplies sourceId, split, path, durationSeconds, and privacyFilter
for each recording. Keep that config and all output under ignored .runtime/.
This script does not load reference labels and makes no network requests.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    root = Path(args.output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if (root / 'manifest.json').exists():
        raise SystemExit('Output manifest already exists; choose a new output directory.')
    manifest = {'version': 'vision-intake-v1', 'samplingFps': 2,
                'cloudFramesPrivacyReviewed': False, 'audioSent': False, 'sources': []}
    for entry in config['sources']:
        source_id = entry['sourceId']
        if not source_id or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in source_id):
            raise ValueError('Source IDs must be anonymous lowercase letters/numbers/hyphens.')
        if entry['split'] not in ['development', 'holdout']:
            raise ValueError('Invalid split')
        source = Path(entry['path']).resolve()
        if not source.is_file() or not 0 < entry['durationSeconds'] <= 600:
            raise ValueError('Missing source or invalid duration')
        folder = root / 'frames' / source_id
        folder.mkdir(parents=True, exist_ok=False)
        cmd = [args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', str(source),
               '-vf', f"fps=2,{entry['privacyFilter']},scale=540:960", '-q:v', '3',
               '-start_number', '0', str(folder / '%05d.jpg')]
        subprocess.run(cmd, check=True, capture_output=True, timeout=180)
        frames = [{'frameId': f'{source_id}-f{i:05d}', 'sourceTimeSeconds': i / 2,
                   'path': str(f.relative_to(root)),
                   'sha256': hashlib.sha256(f.read_bytes()).hexdigest()}
                  for i, f in enumerate(sorted(folder.glob('*.jpg')))]
        if not frames:
            raise ValueError('Decoder produced no frames')
        # This pilot uses portrait 720x1280 media starting at zero. Do not
        # silently apply its fixed masks/geometry to arbitrary new recordings.
        manifest['sources'].append({
            'sourceId': source_id, 'split': entry['split'],
            'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'durationSeconds': entry['durationSeconds'], 'sourceDimensions': [720, 1280],
            'sourceFps': 30, 'frameTimeSemantics': 'FFmpeg fps output grid; nearest-source-frame sampling, not precise event boundaries',
            'privacyFilter': entry['privacyFilter'], 'outputDimensions': [540, 960],
            'frames': frames,
        })
        for offset in range(0, len(frames), 40):
            subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error',
                            '-framerate', '2', '-start_number', str(offset), '-i',
                            str(folder / '%05d.jpg'), '-vf', 'scale=108:192,tile=8x5',
                            '-frames:v', '1', str(root / f'{source_id}-privacy-{offset:03d}.jpg')],
                           check=True, capture_output=True, timeout=45)
        print(f'{source_id}: {len(frames)} local frames; cloud access remains disabled.')
    (root / 'manifest.json').write_text(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
