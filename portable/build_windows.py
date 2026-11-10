"""Build the Windows 10/11 x64 portable app; Python stdlib only.

Usage: python portable/build_windows.py --output /absolute/output/directory
The evaluated browser app is preserved. CPython is obtained from python.org
and checked against the official published SHA-256 recorded in provenance.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import urllib.request
import zipfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--runtime-archive', type=Path, help='Optional cached official Python ZIP; checksum is always verified.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    source = root / 'portable'
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    meta = json.loads((source / 'python-runtime-provenance.json').read_text())
    if args.runtime_archive:
        runtime_bytes = args.runtime_archive.read_bytes()
    else:
        with urllib.request.urlopen(meta['source_url'], timeout=60) as response:
            runtime_bytes = response.read()
    if hashlib.sha256(runtime_bytes).hexdigest() != meta['published_sha256']:
        raise RuntimeError('Official Python archive checksum mismatch.')
    with tempfile.TemporaryDirectory(prefix='thyrolab-portable-', dir=output) as temporary:
        stage = Path(temporary) / 'ThyroVision_LAB_Windows'
        stage.mkdir()
        for folder in ('dist', 'research', 'data', 'results'):
            shutil.copytree(root / folder, stage / folder,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'test_*.cjs', 'test_*.py', 'tests'))
        for name in ('README.md', 'docs'):
            item = root / name
            if item.is_dir():
                shutil.copytree(item, stage / name)
            elif item.is_file():
                shutil.copy2(item, stage / name)
        runtime = stage / 'runtime'
        runtime.mkdir()
        with zipfile.ZipFile(io.BytesIO(runtime_bytes)) as archive:
            for member in archive.infolist():
                name = PurePosixPath(member.filename)
                if name.is_absolute() or '..' in name.parts or '\\' in member.filename:
                    raise RuntimeError('Unsafe path in Python runtime archive.')
            if archive.testzip() is not None:
                raise RuntimeError('Corrupt Python runtime archive.')
            archive.extractall(runtime)
        shutil.copy2(source / 'python-runtime-provenance.json', runtime / 'PROVENANCE.json')
        for name in ('START.bat', 'START_HERE_RU.txt'):
            shutil.copy2(source / name, stage / name)
        examples = stage / 'examples'
        examples.mkdir()
        for name in ('lab-demo.pdf', 'lab-demo.jpg', 'lab-template.csv'):
            shutil.copy2(root / 'dist/assets/examples' / name, examples / name)
        destination = output / 'ThyroVision_LAB_Windows.zip'
        with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for file in sorted(stage.rglob('*')):
                if file.is_file():
                    archive.write(file, file.relative_to(stage.parent))
        with zipfile.ZipFile(destination) as archive:
            if archive.testzip() is not None:
                raise RuntimeError('Final ZIP CRC verification failed.')
        print(destination)


if __name__ == '__main__':
    main()
