# AGENTS.md

给接手的编码 agent 看的作业说明。**给人看的介绍在 `README.md`**，这里只写：仓库怎么摆、改动必须守住哪些不变量、改完怎么验、哪些事别做。

## 项目一句话

立直麻将「何切」训练器：一屏一道题，点牌作答，展开答案看原书解析，做题进度与重点题存后端、跨设备同步。前端纯静态（无构建、无框架、无外部请求），后端一个 `serve.py`（标准库 `ThreadingHTTPServer`）。

## 现状坐标（2026-11-10）

- 本目录是**快照副本**；线上实例跑在 `~/dsh-work/chat/mahjong300`（systemd 用户级 `mahjong300.service`，只绑 tailnet `:8480`）。改本仓库不影响线上，别把「本地改好了」当成「已上线」。
- Git：`main` 单分支、无远端（用户明确暂不推送）。
- 一次性交付快照（文件清单 sha256、来源记录、预览图、开发记录）曾在 `docs/`，按用户要求已删除；需要时从历史取：`git show 76d469c:docs/开发记录.md`、`git show 76d469c:docs/交付校验/来源记录.json`。

## 文件职责

| 路径 | 职责 | 改动风险 |
| --- | --- | --- |
| `dist/index.html` | 页面骨架、资源引用、`?v=` 版本号 | 中：改完必须提版本号 |
| `dist/reader/reader.js` | 切题、选牌、判对错、进度同步、题库页、侧栏 | **高**：全部业务逻辑 |
| `dist/reader/reader.css` | 样式，含手机断点 650px / 380px | 中 |
| `dist/reader/content.js` | 300 题数据 + 全书阅读资料（`window.HEQIE_BOOK`） | **只读**：是内容不是逻辑 |
| `dist/images/` | 1259 张题面/解析/图解/牌面 | **只读** |
| `dist/icons/` | 站点图标，`make-icons.py` 生成 | 生成物，别手改 |
| `serve.py` | 静态服务 + `GET/POST /api/progress` | **高** |
| `make-icons.py` | 由牌面生成图标（依赖 Pillow） | 低 |
| `test_progress.py` | 端到端自检（geckodriver + 无头 Firefox） | 改行为时同步扩测 |
| `mahjong300.service` | systemd 用户级 unit 模板（路径用 `%h`） | 低 |
| `README.md` | 面向人：功能、部署、接口 | — |
| `NOTICE.md` | 内容版权声明 | 不许放宽 |
| `progress.json` | 本机做题数据，已 `.gitignore` | **绝不入库** |

## 不变量（破坏即回归）

1. **300 是硬上限**：`serve.py` 的 `MAX_Q`、前端题号范围、`content.js` 里 `questions` 长度三处必须一致；选项下标范围 0—20 同理。
2. **进度写入是合并语义，不是覆盖**：`done`/`stars` 并集，`removed`/`unstared` 显式删除，`choices`/`current` 后写为准；保存成功后前端采用服务端返回的合并结果。曾经整份覆盖把手机端做的 1—49 题冲掉过——退回覆盖语义等于重演事故。
3. **落盘必须原子**：临时文件 + `fsync` + `os.replace`，进程内写锁串行化。
4. **改前端必须提 `?v=`**：`index.html` 里 `reader.js?v=`、`reader.css?v=`（图标另有 `?v=`）。服务端 html/css/js 走 `no-cache`、图片 7 天缓存，不提版本号浏览器会吃旧脚本。
5. **资源路径全相对**：站点要能放在子目录（`/mahjong/`），也要能 `file://` 双击打开。
6. **零外部请求**：不许引 CDN、字体、统计、看图服务；离线必须完整可用。
7. **不提供目录列表**：`list_directory` 必须返回 403。
8. **默认只绑 tailnet**：`--bind` 默认 `tailscale`，别为了"好调试"改成 `0.0.0.0`——没有鉴权，公开即裸奔。
9. **题库页定位**：图片懒加载会改行高，滚动对齐要复校（rAF + 120/320/700/1200 ms），牌条 `aspect-ratio:70/100` 别删。
10. **hash 路由**：`#q001`—`#q300`、`#bank`；刷新、复制链接、前进后退都要保留题号；目录打开时 ←/→ 不切题。

## 改完怎么验

```bash
# 冒烟：四类响应都要看
python3 serve.py --bind 127.0.0.1 --port 8491 --data /tmp/mj-smoke.json &
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8491/                    # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8491/images/a001.webp     # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8491/images/              # 403
curl -s http://127.0.0.1:8491/api/progress                                          # 空态 JSON
curl -s -X POST -H 'Content-Type: application/json' \
     -d '{"done":{"7":1},"current":8}' http://127.0.0.1:8491/api/progress           # 返回合并结果
kill %1

# 端到端：需要 geckodriver + 无头 Firefox，跑完打印 ALL CHECKS PASSED
python3 test_progress.py
```

`test_progress.py` 自带独立端口 8499 与独立数据文件 `/tmp/mj-test-progress.json`，不会动本机 `progress.json`。

**环境坑**：snap 版 geckodriver 在本机起不来（`cannot create XDG_RUNTIME_DIR folder "/run/user/1000/snap.firefox"`）。这是 snap 限制，不是仓库 bug——换发行版包或改用 Playwright 再跑。

改了 `dist/` 里的资源引用后，另跑一遍引用完整性检查：把 `index.html` 与 `reader/*.js|css` 中出现的 `images/…`、`icons/…` 路径全部抽出来（先去掉 `?v=` 查询串），逐个确认文件存在。

## 已知缺口（别自己补）

- `dist/images/tiles/` 只有 37 件 PNG，但交付快照的 `来源记录.json` 登记过 38 件：缺的 `0z.png`（未使用的占位牌面）从未打进仓库。别为了凑数造一张，也别据此改代码里的牌面引用。
- `dist/images/` 计数口径：`q###` / `a###` / `counts###` / `dora###` 各 300、`extra###` 22、`tiles/` 37，合计 1259。
- 原线上副本的前端版本号（`reader.js?v=11`、`reader.css?v=15`、图标 `?v=2`）与本仓库一致；改动后记得整组一起提。

## 别做

- 别改 `dist/images/`、`dist/reader/content.js` 的内容——题面是原书扫描、译文是原书口径；要改内容先向用户报批。
- 别把 `progress.json` 或任何做题记录提交进库。
- 别引入构建步骤、打包器、前端框架、后端框架：零构建、零第三方依赖是硬约束（`make-icons.py` 的 Pillow 是唯一例外，且只在本地生成图标时用）。
- 别 `git push`，也别加远端：推送时机由用户定。
- 别把个人部署信息（tailnet IP、主机名、家目录绝对路径）写进 README 或代码。
- 别自作主张重排目录、改文件命名——命名与位置是用户盯的重点。

## 要用户裁决的事

- **版权**：题面图与译文归原作者与出版方，`NOTICE.md` 的口径由用户定，不许自行放宽或删除。
- **许可证**：代码 MIT。新增任何依赖前先确认许可证与之兼容。
- **推送 / 开 Pages**：用户表示暂不推送。
