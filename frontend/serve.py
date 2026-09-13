"""
Lightweight Local HTTP Development Server for NeuroStress AI Web Dashboard
Usage:
  python frontend/serve.py
"""

import http.server
import os
import socketserver
import webbrowser

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable CORS for local testing
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()


def main():
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print("=" * 70)
        print("  NeuroStress AI Web Dashboard Server Running")
        print(f"  Local URL:   http://localhost:{PORT}")
        print(f"  Serving Dir: {DIRECTORY}")
        print("  Press Ctrl+C to stop.")
        print("=" * 70)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")


if __name__ == "__main__":
    main()
