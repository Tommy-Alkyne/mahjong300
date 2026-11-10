#!/usr/bin/env python3
"""geckodriver 端到端：进度存后端（跨浏览器会话）、题库页、目录分区。"""
import base64
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

import os
import shutil

# 测试跑在独立的 serve.py 实例上（独立端口 + 独立数据文件），不动线上那份 progress.json
SERVE_PORT = 8499
DATA = "/tmp/mj-test-progress.json"
BASE = f"http://127.0.0.1:{SERVE_PORT}/"
API = BASE + "api/progress"
PORT = 4444
HERE = os.path.dirname(os.path.abspath(__file__))


def http(url, data=None, method=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
        method=method or ("POST" if data is not None else "GET"),
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode()
    return json.loads(raw) if raw.strip().startswith(("{", "[")) else raw


def wd(path, data=None, method=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}", data=body,
        headers={"Content-Type": "application/json"},
        method=method or ("POST" if data is not None else "GET"),
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        print("HTTP", exc.code, exc.read().decode()[:800], file=sys.stderr)
        raise


class Browser:
    def __init__(self):
        self.sid = wd("/session", {
            "capabilities": {"alwaysMatch": {
                "browserName": "firefox",
                "moz:firefoxOptions": {"args": ["-headless"]},
            }},
        })["value"]["sessionId"]

    def js(self, code):
        return wd(f"/session/{self.sid}/execute/sync", {"script": code, "args": []})["value"]

    def goto(self, url, pause=1.0):
        wd(f"/session/{self.sid}/url", {"url": url})
        time.sleep(pause)

    def size(self, w, h):
        wd(f"/session/{self.sid}/window/rect", {"width": w, "height": h, "x": 0, "y": 0})

    def shot(self, path):
        data = wd(f"/session/{self.sid}/screenshot")["value"]
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(data))
        print(f"截图 {path}")

    def state(self, tag):
        s = self.js("""
          const bank = document.querySelector('#bank-host');
          return {
            question: document.querySelector('#current-number').textContent,
            star: document.querySelector('#toggle-star') ? document.querySelector('#toggle-star').textContent : null,
            starred: document.querySelector('#toggle-star') ? document.querySelector('#toggle-star').classList.contains('is-starred') : null,
            done: document.querySelector('#done-count').textContent,
            hash: location.hash,
            bankOpen: bank ? !bank.hidden : null,
            single: !document.querySelector('#question-host').hidden,
            legacy: [localStorage.getItem('heqie-done-v1'), localStorage.getItem('heqie-current-v1')]
          };""")
        print(f"{tag:<22} 题={s['question']} hash={s['hash']} {s['done']} "
              f"单题={s['single']} 题库={s['bankOpen']} 本地残留={s['legacy']}")
        return s

    def close(self):
        try:
            wd(f"/session/{self.sid}", {}, method="DELETE")
        except Exception:
            pass


def server_state():
    rec = http(API)
    return {"done": sorted(int(k) for k in rec.get("done", {})), "current": rec.get("current"),
            "initialized": rec.get("initialized"), "choices": rec.get("choices"),
            "stars": sorted(int(k) for k in rec.get("stars", {}))}


def main():
    if os.path.exists(DATA):
        os.remove(DATA)
    server = subprocess.Popen(
        ["/usr/bin/python3", os.path.join(HERE, "serve.py"),
         "--bind", "127.0.0.1", "--port", str(SERVE_PORT),
         "--root", os.path.join(HERE, "dist"),
         "--data", DATA],
        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    proc = subprocess.Popen(["geckodriver", "--port", str(PORT), "--log", "error"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    browsers = []
    try:
        for _ in range(40):
            try:
                if http(API).get("done") is not None:
                    break
            except OSError:
                time.sleep(0.25)
        else:
            raise SystemExit("测试用 serve.py 没起来")
        for _ in range(60):
            try:
                wd("/status")
                break
            except OSError:
                time.sleep(0.5)
        else:
            raise SystemExit("geckodriver 未启动")

        print("测试数据文件:", DATA, "初始:", server_state())

        a = Browser(); browsers.append(a)
        a.goto(BASE + "?run=a")
        s0 = a.state("A1 首次打开")
        assert s0["question"] == "001" and "0/300" in s0["done"], s0
        assert s0["legacy"] == [None, None], "前端不应有 localStorage 进度"

        a.js("document.querySelectorAll('.tilebtn')[3].click();")
        time.sleep(0.6)   # 选择即写后端，不再等切题
        s1 = a.state("A2 第1题选牌")
        assert "1/300" in s1["done"], s1
        # 第1题推荐 2s，测试点的是 8p → 目录应标「错」
        toc1 = a.js("const el=document.querySelector('#toc a[href=\"#q001\"]'); return el ? el.className : null;")
        print("    TOC 001:", toc1)
        assert "is-wrong" in (toc1 or ""), toc1
        st = server_state()
        print("    后端:", st)
        assert st["done"] == [1] and st["choices"] == {"1": 3}, st

        # 星标：点一下应立刻变黄并写后端
        a.js("document.querySelector('#toggle-star').click();")
        time.sleep(0.6)
        st1 = a.state("A2b 点星标")
        assert st1["star"] == "★" and st1["starred"] is True, st1
        assert server_state()["stars"] == [1], server_state()
        tocstar = a.js("const el=document.querySelector('#toc a[href=\"#q001\"]'); return el ? el.className : null;")
        print("    TOC 001:", tocstar)
        assert "is-starred" in (tocstar or ""), tocstar

        a.goto(BASE + "?run=a2")     # 重开：无 hash，应落到第一道未做（002）
        s2 = a.state("A3 重开落 002")
        assert s2["question"] == "002", s2
        a.js("const el=document.querySelector('.answer'); el.open=true; el.dispatchEvent(new Event('toggle'));")
        time.sleep(1.2)
        # 第2题推荐 5s：点中推荐牌 → 应标「对」
        a.js("const q=window.HEQIE_BOOK.questions[1]; const t=[...q.hand,q.draw];"
             "const i=t.findIndex(x=>x===q.discard||('0'+x[1])===q.discard);"
             "document.querySelectorAll('.tilebtn')[i].click();")
        time.sleep(0.6)
        toc2 = a.js("const el=document.querySelector('#toc a[href=\"#q002\"]'); return el ? el.className : null;")
        print("    TOC 002:", toc2)
        assert "is-right" in (toc2 or ""), toc2
        s2b = a.state("A4 第2题展开答案")
        assert "2/300" in s2b["done"], s2b
        assert server_state()["done"] == [1, 2], server_state()

        a.js("document.querySelector('#bank').click();")
        time.sleep(1.0)
        s3 = a.state("A5 点「题库」")
        assert s3["bankOpen"] and s3["hash"] == "#bank", s3
        info = a.js("""
          const items=[...document.querySelectorAll('#bank-host .bank-item')];
          return {n: items.length, first: items[0].id, last: items[items.length-1].id,
                  prevHidden: getComputedStyle(document.querySelector('#previous')).display==='none',
                  label: document.querySelector('#bank').textContent};""")
        print("    题库:", info)
        assert info["n"] == 300 and info["first"] == "bank-q001" and info["last"] == "bank-q300", info
        assert info["prevHidden"] and info["label"].strip() == "返回单题", info
        marks = a.js("""
          const b1=document.querySelector('#bank-q001 .bank-done'), b2=document.querySelector('#bank-q002 .bank-done');
          return {t1:b1.textContent, t2:b2.textContent, h1:b1.hidden, h2:b2.hidden};""")
        print("    题库角标:", marks)
        assert marks["t1"] == "错" and marks["t2"] == "对" and not marks["h1"] and not marks["h2"], marks
        star_badge = a.js("const el=document.querySelector('#bank-q001 .bank-star'); return el ? !el.hidden : null;")
        print("    题库 001 星标可见:", star_badge)
        assert star_badge is True, star_badge
        top = a.js("const el=document.querySelector('#bank-q002'); return el ? Math.round(el.getBoundingClientRect().top) : null;")
        print("    自动滚动到当前题 002，距顶 px:", top)
        assert top is not None and 0 <= top <= 220, top

        a.js("const d=document.querySelector('#bank-q005 .answer'); d.open=true; d.dispatchEvent(new Event('toggle'));")
        time.sleep(1.2)
        s4 = a.state("A6 题库展开第5题")
        assert "3/300" in s4["done"], s4
        st = server_state()
        print("    后端:", st)
        assert st["done"] == [1, 2, 5], st
        assert a.js("const b=document.querySelector('#bank-q005 .bank-done'); return !!b && !b.hidden;")

        a.js("document.querySelector('#bank-q005 .bank-head a').click();")
        time.sleep(1.0)
        s5 = a.state("A7 点题号回单题")
        assert s5["question"] == "005" and s5["single"] and not s5["bankOpen"], s5

        assert a.js("return !!document.querySelector('#frontier');"), "缺少「跳到最新」按钮"
        a.js("document.querySelector('#frontier').click();")
        time.sleep(0.8)
        sf = a.state("A8 点「跳到最新」")
        assert sf["question"] == "006", f"已做 1/2/5，最新应为 006，实际 {sf['question']}"

        # 冷启动直接开 #bank（当前题 006）也要滚到 006
        a.goto(BASE + "?fresh=1#bank")
        time.sleep(1.6)
        top6 = a.js("const el=document.querySelector('#bank-q006'); return el ? Math.round(el.getBoundingClientRect().top) : null;")
        print("    冷启动 #bank 滚到 006，距顶 px:", top6)
        assert top6 is not None and 0 <= top6 <= 220, top6
        a.goto(BASE + "?back=1#q006")

        labels = a.js("return [...document.querySelectorAll('#group option')].map(o=>o.textContent);")
        assert [l.strip() for l in labels] == ["001—090题", "091—180题", "181—240题", "241—300题"], labels
        print("    目录分区:", labels)

        a.size(1280, 900); a.goto(BASE + "?s=1#q001", 0.8); a.shot("/tmp/mj-single-desktop.png")
        a.size(1280, 1000); a.goto(BASE + "?s=2#bank", 0.8); a.shot("/tmp/mj-bank-desktop.png")
        a.size(390, 844); a.goto(BASE + "?s=3#q005", 0.8); a.shot("/tmp/mj-single-mobile.png")
        a.close(); browsers.remove(a)

        # B：全新浏览器（等同另一台设备），进度只可能来自后端
        b = Browser(); browsers.append(b)
        b.goto(BASE + "?run=b")
        s6 = b.state("B1 新浏览器打开")
        assert "3/300" in s6["done"], s6
        assert s6["legacy"] == [None, None], s6
        assert s6["question"] == "003", f"应落在第一道未做 003，实际 {s6['question']}"

        b.js("const el=document.querySelector('.answer'); el.open=true; el.dispatchEvent(new Event('toggle'));")
        time.sleep(1.2)
        s7 = b.state("B2 第3题展开答案")
        assert "4/300" in s7["done"], s7
        assert server_state()["done"] == [1, 2, 3, 5], server_state()

        b.close(); browsers.remove(b)

        # C：再开一个浏览器，撤销第 2 题已做
        c = Browser(); browsers.append(c)
        c.goto(BASE + "?run=c#q002")
        s8 = c.state("C1 打开第2题")
        assert "4/300" in s8["done"] and s8["question"] == "002", s8
        c.js("document.querySelector('#toggle-done').click();")
        time.sleep(1.2)
        s9 = c.state("C2 取消第2题已做")
        assert "3/300" in s9["done"], s9
        assert server_state()["done"] == [1, 3, 5], server_state()
        # 取消星标
        c.goto(BASE + "?run=c2#q001")
        s10 = c.state("C3 打开第1题（应已星标）")
        assert s10["star"] == "★", s10
        c.js("document.querySelector('#toggle-star').click();")
        time.sleep(0.6)
        s11 = c.state("C4 取消星标")
        assert s11["star"] == "☆", s11
        assert server_state()["stars"] == [], server_state()
        c.close(); browsers.remove(c)

        # D：模拟另一台设备拿着旧状态整体提交 —— 合并语义下不能冲掉别人的记录
        http(API, {"done": {"1": 1}, "choices": {"1": 3}, "current": 1})
        merged = server_state()
        print("    旧状态设备再提交后:", merged)
        assert merged["done"] == [1, 3, 5], merged

        print("ALL CHECKS PASSED")
    finally:
        for br in browsers:
            br.close()
        proc.terminate()
        proc.wait(timeout=10)


if __name__ == "__main__":
    sys.exit(main())
