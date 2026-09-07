#!/usr/bin/env python3
"""開発用ローカルサーバ。no-cache ヘッダ付き http.server。

Web MIDI API は secure context を要求するため、file:// では動かない。
このサーバ（http://localhost:8000）経由でブラウザから開くこと。

使い方:
    conda activate myenv311
    cd D:\\claude_code\\self_osc_synth
    python serve.py            # 既定ポート 8000
    python serve.py 8080       # ポート指定
"""

import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    """全レスポンスに no-cache ヘッダを付与するハンドラ。

    開発中の再読込でブラウザキャッシュが古い JS/HTML を返すのを防ぐ。
    """

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    port = 8000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])

    server = HTTPServer(("localhost", port), NoCacheHandler)
    print(f"http://localhost:{port}/ で待機中（Ctrl+C で終了）")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n終了します")
        server.server_close()


if __name__ == "__main__":
    main()
