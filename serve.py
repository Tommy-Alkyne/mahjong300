#!/usr/bin/env python3
"""何切300问 · 单题网页版：静态站点 + 做题进度后端

- 静态文件：`dist/`
- 进度接口：`GET/POST /api/progress`，落盘 `progress.json`（单用户，无鉴权，靠 tailnet 兜底）
- 默认只监听 tailnet 地址（100.x / fd7a:），局域网与公网不可见

用法:
    python3 serve.py --bind tailscale --port 8480
    python3 serve.py --bind tailscale --bind 127.0.0.1 --port 8480
"""
from __future__ import annotations

import argparse
import functools
import json
import os
import socket
import subprocess
import sys
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# 图片/牌图量大且不变，长缓存；html/css/js 每次校验，避免升级后浏览器吃掉旧脚本。
CACHEABLE = (".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff2")

MAX_Q = 300
API_PATH = "/api/progress"
WRITE_LOCK = threading.Lock()
EMPTY = {"done": {}, "stars": {}, "choices": {}, "current": 1, "initialized": False}


def _intmap(value, accept) -> dict:
    out: dict = {}
    if isinstance(value, dict):
        for key, val in list(value.items())[: MAX_Q + 40]:
            try:
                n = int(key)
                iv = int(val)
            except (TypeError, ValueError):
                continue
            if 1 <= n <= MAX_Q and accept(iv):
                out[str(n)] = iv
    return out


def normalize(body) -> dict:
    if not isinstance(body, dict):
        raise ValueError("payload 必须是 JSON 对象")
    current = body.get("current", 1)
    try:
        current = int(current)
    except (TypeError, ValueError):
        current = 1
    removed = []
    if isinstance(body.get("removed"), list):
        for item in body["removed"][: MAX_Q + 40]:
            try:
                n = int(item)
            except (TypeError, ValueError):
                continue
            if 1 <= n <= MAX_Q:
                removed.append(n)
    unstared = []
    if isinstance(body.get("unstared"), list):
        for item in body["unstared"][: MAX_Q + 40]:
            try:
                n = int(item)
            except (TypeError, ValueError):
                continue
            if 1 <= n <= MAX_Q:
                unstared.append(n)
    return {
        "removed": removed,
        "unstared": unstared,
        "stars": _intmap(body.get("stars"), lambda v: True),
        "done": _intmap(body.get("done"), lambda v: True),
        "choices": _intmap(body.get("choices"), lambda v: 0 <= v <= 20),
        "current": current if 1 <= current <= MAX_Q else 1,
        "initialized": True,
    }


def read_progress(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        rec = normalize(data)
        rec["updated"] = data.get("updated")
        return rec
    except (OSError, ValueError):
        return dict(EMPTY)


def write_progress(path: str, rec: dict) -> dict:
    rec = dict(rec)
    rec["updated"] = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    tmp = f"{path}.tmp"
    with WRITE_LOCK:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    return rec


class Handler(SimpleHTTPRequestHandler):
    server_version = "Heqie300/1.1"
    data_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "progress.json")

    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0].split("#", 1)[0].lower()
        if path.endswith(CACHEABLE):
            self.send_header("Cache-Control", "public, max-age=604800")
        else:
            self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def list_directory(self, path):  # 不提供目录列表
        self.send_error(403, "Forbidden")
        return None

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ---- 进度接口 ----
    def _json(self, obj, status: int = 200) -> None:
        payload = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == API_PATH:
            return self._json(read_progress(self.data_path))
        return super().do_GET()

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != API_PATH:
            return self._json({"error": "not found"}, 404)
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > 200_000:
            return self._json({"error": "bad length"}, 400)
        try:
            incoming = normalize(json.loads(self.rfile.read(length).decode()))
        except (ValueError, UnicodeDecodeError) as exc:
            return self._json({"error": f"bad payload: {exc}"}, 400)
        # 合并而非覆盖：设备之间各写各的，谁也不会把别人的记录冲掉。
        # done 取并集，removed 明确删除（取消「已做」），choices 以本次写入为准，current 以本次为准。
        with WRITE_LOCK:
            cur = read_progress(self.data_path)
            merged = {
                "done": dict(cur["done"]),
                "stars": dict(cur.get("stars") or {}),
                "choices": dict(cur["choices"]),
                "current": incoming["current"] or cur["current"],
                "initialized": True,
            }
            for key, val in incoming["stars"].items():
                if val:
                    merged["stars"][key] = 1
            for n in (incoming.get("unstared") or []):
                merged["stars"].pop(str(int(n)), None)
            for key, val in incoming["done"].items():
                if val:
                    merged["done"][key] = 1
            for n in (incoming.get("removed") or []):
                merged["done"].pop(str(int(n)), None)
            merged["choices"].update(incoming["choices"])
        try:
            saved = write_progress(self.data_path, merged)
        except OSError as exc:
            return self._json({"error": f"write failed: {exc}"}, 500)
        return self._json({"ok": True, "updated": saved["updated"], "done": saved["done"],
                           "stars": saved["stars"], "choices": saved["choices"],
                           "current": saved["current"]})


def tailscale_addrs() -> list[str]:
    addrs: list[str] = []
    for flag in ("-4", "-6"):
        try:
            out = subprocess.run(
                ["tailscale", "ip", flag],
                capture_output=True, text=True, timeout=10, check=True,
            ).stdout
        except (OSError, subprocess.SubprocessError) as exc:
            print(f"tailscale ip {flag} 失败: {exc}", file=sys.stderr)
            continue
        addrs += [line.strip() for line in out.splitlines() if line.strip()]
    return addrs


def expand_binds(raw: list[str]) -> list[str]:
    out: list[str] = []
    for item in raw:
        for part in item.split(","):
            part = part.strip()
            if not part:
                continue
            if part.lower() == "tailscale":
                found = tailscale_addrs()
                if not found:
                    raise SystemExit("拿不到 tailscale 地址，退出（由 systemd 稍后重试）")
                out += found
            else:
                out.append(part)
    # 去重保序
    seen: set[str] = set()
    return [a for a in out if not (a in seen or seen.add(a))]


class DualStackServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, handler):
        self.address_family = socket.AF_INET6 if ":" in addr[0] else socket.AF_INET
        super().__init__(addr, handler)


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    default_root = os.path.join(here, "dist")

    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=default_root)
    ap.add_argument("--data", default=os.path.join(here, "progress.json"),
                    help="进度落盘文件")
    ap.add_argument("--bind", action="append", default=None,
                    help="监听地址，可重复；'tailscale' 表示自动取 tailnet 全部地址")
    ap.add_argument("--port", type=int, default=8480)
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.isfile(os.path.join(root, "index.html")):
        print(f"root 下找不到 index.html: {root}", file=sys.stderr)
        return 2

    Handler.data_path = os.path.abspath(args.data)
    binds = expand_binds(args.bind or ["tailscale"])
    handler = functools.partial(Handler, directory=root)

    servers: list[ThreadingHTTPServer] = []
    try:
        for addr in binds:
            srv = DualStackServer((addr, args.port), handler)
            servers.append(srv)
            print(f"listening http://[{addr}]:{args.port}/" if ":" in addr
                  else f"listening http://{addr}:{args.port}/", flush=True)
    except OSError as exc:
        for s in servers:
            s.server_close()
        print(f"绑定失败（{exc}），退出让 systemd 重试", file=sys.stderr)
        return 3

    print(f"root: {root}\nprogress: {Handler.data_path}", flush=True)
    threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in servers]
    for t in threads:
        t.start()
    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        for s in servers:
            s.shutdown()
            s.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
