"""Serve ThyroVision LAB on loopback using Python's standard library only."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import errno
import os
import socket
import threading
import webbrowser


class LabHandler(SimpleHTTPRequestHandler):
    # Explicit mappings avoid depending on Windows registry/file associations.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.wasm': 'application/wasm',
        '.json': 'application/json',
        '.gz': 'application/gzip',
    }


class LabServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR can silently bind a second server to an occupied
    # address. Exclusive binding makes the automatic port fallback reliable.
    allow_reuse_address = os.name != 'nt'
    allow_reuse_port = False

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def make_server(directory, requested_port):
    handler = partial(LabHandler, directory=str(directory))
    preferred_port = 8765 if requested_port is None else requested_port
    try:
        return LabServer(('127.0.0.1', preferred_port), handler)
    except OSError as error:
        in_use = error.errno in (errno.EADDRINUSE, 10048, 10013) or getattr(error, 'winerror', None) in (10048, 10013)
        if in_use and requested_port is None:
            # Keep startup usable when another application already owns 8765.
            # An explicitly requested port stays strict for Colab/proxy scripts.
            try:
                server = LabServer(('127.0.0.1', 0), handler)
            except OSError as fallback_error:
                raise SystemExit(f'Cannot start the local server: {fallback_error}') from None
            print('Port 8765 is unavailable. Using another available local port.', flush=True)
            return server
        if in_use:
            raise SystemExit(f'Port {preferred_port} is already in use. Try --port {preferred_port + 1 if preferred_port < 65535 else 8766}.') from None
        raise SystemExit(f'Cannot start the local server: {error}') from None


def main():
    parser = argparse.ArgumentParser(description='ThyroVision LAB: local browser demo')
    parser.add_argument('--port', type=int, default=None, help='Local port; default 8765, or a free port if busy. Use 0 to request a free port.')
    parser.add_argument('--no-open', action='store_true', help='Print the address without opening a browser.')
    args = parser.parse_args()
    if args.port is not None and not 0 <= args.port <= 65535:
        parser.error('--port must be between 0 and 65535')
    directory = Path(__file__).resolve().parents[1] / 'dist'
    if not (directory / 'index.html').exists():
        raise SystemExit('The dist directory is missing. Extract the complete project archive first.')
    with make_server(directory, args.port) as server:
        actual_port = server.server_address[1]
        url = f'http://127.0.0.1:{actual_port}/'
        print(f'ThyroVision LAB: {url}\nKeep this window open. Press Ctrl+C to stop. No files are uploaded.', flush=True)
        timer = None
        if not args.no_open:
            timer = threading.Timer(0.7, lambda: webbrowser.open(url))
            timer.daemon = True
            timer.start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            if timer is not None:
                timer.cancel()


if __name__ == '__main__':
    main()
