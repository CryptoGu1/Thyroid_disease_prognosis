"""ThyroVision LAB Colab bootstrap (Python standard library only).

The notebook supplies a compact, checksum-pinned ZIP. Third-party browser
assets are restored from the five pinned official npm archives listed in its
provenance manifest. No document uploads, tunnels or keep-alive tasks exist.
"""
from __future__ import annotations

import base64
import binascii
from concurrent.futures import ThreadPoolExecutor, as_completed
import functools
import hashlib
import hmac
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import re
import stat
import tarfile
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
import zipfile

_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
_MAX_EXPANDED_BYTES = 256 * 1024 * 1024
_ALLOWED_ROOT_DIRS = {"dist", "research", "data", "results"}
_ALLOWED_ROOT_FILES = {"README.md", "START_HERE_RU.txt", "START_WINDOWS.bat", "start.sh"}
_EXPECTED_PACKAGES = {
    "tesseract.js": "6.0.1",
    "tesseract.js-core": "6.0.0",
    "pdfjs-dist": "6.5.438",
    "@tesseract.js-data/eng": "1.0.0",
    "@tesseract.js-data/rus": "1.0.0",
}
_RETRY_HELP = (
    "Проверьте подключение к интернету и повторно запустите эту ячейку. "
    "Уже проверенные файлы будут использованы повторно. "
    "Если npm недоступен, запустите комплект ThyroVision_LAB.zip локально."
)


def _relative_parts(name: str) -> tuple[str, ...]:
    if not isinstance(name, str) or not name or len(name) > 1024:
        raise ValueError("Некорректный путь внутри комплекта.")
    if "\\" in name or ":" in name or "\x00" in name or name.startswith("/"):
        raise ValueError("Небезопасный путь внутри комплекта.")
    parts = tuple(name.rstrip("/").split("/"))
    if not parts or any(p in ("", ".", "..") for p in parts):
        raise ValueError("Путь внутри комплекта выходит за разрешённую папку.")
    return parts


def _safe_target(root: Path, relative: str) -> Path:
    parts = _relative_parts(relative)
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Символические ссылки в папке приложения не разрешены.")
    if os.path.commonpath((str(root), str(current.resolve()))) != str(root):
        raise ValueError("Путь выходит за папку приложения.")
    return current


def _atomic_write(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".thyrolab-", delete=False) as f:
            temporary = Path(f.name)
            f.write(data)
        os.replace(temporary, target)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def _unpack_payload(payload: bytes, root: Path) -> int:
    seen = set()
    with zipfile.ZipFile(io.BytesIO(payload)) as bundle:
        members = bundle.infolist()
        if len(members) > 2000 or sum(m.file_size for m in members) > _MAX_EXPANDED_BYTES:
            raise ValueError("Встроенный комплект превышает допустимый размер.")
        # Validate the whole directory before writing any file.
        for member in members:
            parts = _relative_parts(member.filename)
            allowed = (parts[0] in _ALLOWED_ROOT_DIRS or
                       (len(parts) == 1 and parts[0] in _ALLOWED_ROOT_FILES))
            if not allowed:
                raise ValueError("Во встроенном комплекте обнаружен путь вне списка файлов приложения.")
            key = "/".join(parts)
            if key in seen:
                raise ValueError("Во встроенном комплекте обнаружен повторный путь.")
            seen.add(key)
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise ValueError("Встроенный комплект содержит запрещённый тип файла.")
            if member.flag_bits & 1:
                raise ValueError("Зашифрованные встроенные архивы не поддерживаются.")
            _safe_target(root, member.filename)
        for member in members:
            target = _safe_target(root, member.filename)
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                _atomic_write(target, bundle.read(member))
    return len(members)


def _matches_asset(path: Path, asset: dict) -> bool:
    if path.is_symlink() or not path.is_file() or path.stat().st_size != asset["bytes"]:
        return False
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)
    return hmac.compare_digest(digest.hexdigest(), asset["sha256"])


def _verify_bytes(data: bytes, asset: dict) -> None:
    if len(data) != asset["bytes"] or not hmac.compare_digest(hashlib.sha256(data).hexdigest(), asset["sha256"]):
        raise ValueError("Контрольная сумма ресурса не совпала: " + asset["path"])


def _check_npm_url(url: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != "registry.npmjs.org" or parsed.username or parsed.password:
        raise ValueError("Разрешены только HTTPS-архивы официального registry.npmjs.org.")


class _RegistryRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        _check_npm_url(newurl)
        return super().redirect_request(request, fp, code, message, headers, newurl)


def _download_and_restore(package: dict, assets: list[dict], vendor_root: Path) -> tuple[str, int]:
    url = package["tarball"]
    _check_npm_url(url)
    integrity = package["tarball_integrity"]
    if not isinstance(integrity, str) or not integrity.startswith("sha512-"):
        raise ValueError("В манифесте отсутствует SHA-512 архива npm.")
    try:
        expected = base64.b64decode(integrity[7:], validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Некорректная контрольная сумма архива npm.") from error
    if len(expected) != 64:
        raise ValueError("Некорректная длина SHA-512 архива npm.")
    opener = urllib.request.build_opener(_RegistryRedirect())
    request = urllib.request.Request(url, headers={"User-Agent": "ThyroVision-LAB-Notebook/1.0"})
    with opener.open(request, timeout=45) as response:
        _check_npm_url(response.url)
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > _MAX_ARCHIVE_BYTES:
            raise ValueError("Архив npm превышает допустимый размер.")
        archive = response.read(_MAX_ARCHIVE_BYTES + 1)
    if len(archive) > _MAX_ARCHIVE_BYTES:
        raise ValueError("Архив npm превышает допустимый размер.")
    if not hmac.compare_digest(hashlib.sha512(archive).digest(), expected):
        raise ValueError("SHA-512 архива npm не совпала: " + package["name"])

    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
        members = bundle.getmembers()
        if len(members) > 20000 or sum(m.size for m in members if m.isfile()) > _MAX_EXPANDED_BYTES:
            raise ValueError("Распакованный архив npm превышает допустимый размер.")
        by_name = {}
        for member in members:
            if member.name in by_name:
                raise ValueError("Архив npm содержит повторное имя файла.")
            by_name[member.name] = member
        count = 0
        for asset in assets:
            _relative_parts(asset["source_member"])
            member_name = "package/" + asset["source_member"]
            member = by_name.get(member_name)
            if member is None or not member.isfile() or member.size != asset["bytes"]:
                raise ValueError("Ресурс отсутствует в проверенном архиве npm: " + member_name)
            source = bundle.extractfile(member)
            if source is None:
                raise ValueError("Не удалось прочитать ресурс npm: " + member_name)
            with source:
                data = source.read()
            _verify_bytes(data, asset)
            _atomic_write(_safe_target(vendor_root, asset["path"]), data)
            count += 1
    return package["name"], count


def prepare_app(payload_b64: str, payload_sha256: str, destination, progress=print) -> dict:
    """Restore pinned application assets and return paths and verification counts.

    A retry reuses already verified browser assets. Errors never trigger an
    alternate download source or checksum bypass.
    """
    try:
        if not re.fullmatch(r"[0-9a-f]{64}", str(payload_sha256)):
            raise ValueError("Некорректная SHA-256 встроенного приложения.")
        payload = base64.b64decode(''.join(payload_b64.split()), validate=True)
        if len(payload) > _MAX_ARCHIVE_BYTES:
            raise ValueError("Встроенный архив слишком большой.")
        if not hmac.compare_digest(hashlib.sha256(payload).hexdigest(), payload_sha256):
            raise ValueError("Встроенный комплект повреждён: SHA-256 не совпала.")
        requested_root = Path(destination).expanduser()
        if requested_root.is_symlink():
            raise ValueError("Папка приложения не должна быть символической ссылкой.")
        root = requested_root.resolve()
        root.mkdir(parents=True, exist_ok=True)
        _unpack_payload(payload, root)
        dist = _safe_target(root, "dist")
        vendor = _safe_target(root, "dist/assets/vendor")
        manifest = json.loads(_safe_target(vendor, "provenance.json").read_text(encoding="utf-8"))
        packages = manifest["packages"]
        assets = manifest["assets"]
        if len(packages) != 5 or {p["name"]: p["version"] for p in packages} != _EXPECTED_PACKAGES:
            raise ValueError("Набор версий npm отличается от проверенного комплекта.")
        if len(assets) != 218:
            raise ValueError("Число ресурсов отличается от проверенного манифеста.")
        names = set()
        pending = {p["name"]: [] for p in packages}
        reused = 0
        for asset in assets:
            name = asset["path"]
            target = _safe_target(vendor, name)
            if name in names:
                raise ValueError("Манифест содержит повторный путь ресурса.")
            names.add(name)
            if not isinstance(asset.get("bytes"), int) or not 0 <= asset["bytes"] <= _MAX_ARCHIVE_BYTES:
                raise ValueError("Некорректный размер ресурса в манифесте.")
            if not re.fullmatch(r"[0-9a-f]{64}", str(asset.get("sha256", ""))):
                raise ValueError("Некорректная SHA-256 ресурса в манифесте.")
            if _matches_asset(target, asset):
                reused += 1
                continue
            package_name = asset.get("package")
            if package_name not in _EXPECTED_PACKAGES:
                raise ValueError("Встроенный справочный файл повреждён или отсутствует: " + name)
            if asset.get("version") != _EXPECTED_PACKAGES[package_name]:
                raise ValueError("Версия ресурса не совпала с версией пакета.")
            _relative_parts(asset["source_member"])
            pending[package_name].append(asset)

        jobs = [(p, pending[p["name"]]) for p in packages if pending[p["name"]]]
        progress(f"Проверено ранее загруженных ресурсов: {reused}/{len(assets)}.")
        if jobs:
            progress(f"Загружаем {len(jobs)} проверенных пакетов распознавания. Это нужно один раз на сессию.")
            with ThreadPoolExecutor(max_workers=3) as executor:
                futures = [executor.submit(_download_and_restore, p, items, vendor) for p, items in jobs]
                for future in as_completed(futures):
                    package_name, count = future.result()
                    progress(f"Готово: {package_name} — {count} ресурсов проверено.")

        verified = sum(_matches_asset(_safe_target(vendor, a["path"]), a) for a in assets)
        if verified != len(assets) or not _safe_target(dist, "index.html").is_file():
            raise ValueError("Итоговая проверка приложения не пройдена.")
        progress(f"Приложение готово. Контрольные суммы: {verified}/{len(assets)}.")
        return {"root": str(root), "dist": str(dist), "verified_assets": verified,
                "reused_assets": reused, "downloaded_packages": len(jobs)}
    except Exception as error:
        raise RuntimeError(f"Не удалось подготовить ThyroVision LAB: {error}\n{_RETRY_HELP}") from error


def start_server(dist_path):
    """Serve an existing app on a dynamic loopback port; return the server.

    Only GET and HEAD are implemented. Caller may stop its own server with
    server.shutdown(); server.server_close(). No public tunnel is created.
    """
    root = Path(dist_path).resolve()
    if not (root / "index.html").is_file():
        raise FileNotFoundError("index.html не найден. Сначала выполните подготовку приложения.")

    class StaticHandler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                          ".mjs": "application/javascript", ".js": "application/javascript",
                          ".wasm": "application/wasm", ".gz": "application/gzip"}

        def log_message(self, _format, *args):
            pass

        def list_directory(self, path):
            self.send_error(404, "Directory listing is disabled")
            return None

        def translate_path(self, path):
            translated = Path(super().translate_path(path))
            try:
                # Prevent serving symlinked or outside files even if added later.
                relative = translated.relative_to(root)
                if relative == Path("."):
                    return str(root)
                safe = _safe_target(root, relative.as_posix())
            except (ValueError, OSError):
                return str(root / "__thyrolab_not_found__")
            return str(safe)

        def end_headers(self):
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

    handler = functools.partial(StaticHandler, directory=str(root))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, name="thyrolab-static", daemon=True)
    thread.start()
    return server
