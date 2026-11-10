# 版权与来源声明

本仓库把两部分内容打包在一起，许可各不相同。

## 1. 程序代码 —— MIT

由本项目编写的代码以 MIT 许可发布，全文见 `LICENSE`：

- `serve.py`、`make-icons.py`、`test_progress.py`
- `dist/index.html`、`dist/reader/reader.js`、`dist/reader/reader.css`

## 2. 题目内容 —— 归原作者与出版方所有，不在 MIT 范围内

下列内容来自纸书，著作权归原作者与出版方所有：

- `dist/images/` 下的题面、解析、图解（原书 231 页扫描转 webp，共 1259 张）
- `dist/reader/content.js` 中的 300 道题译文、原书对照、讲解专栏、术语表等阅读资料

来源：

- 《麻雀 傑作「何切る」300選》，G・ウザク 著，福地诚 编

收录目的是把纸质练习题做成可交互的单题网页，供**个人学习、技术研究与本地自测**使用，不提供任何商业用途授权。若你是权利人且不认可这种用法，请提 issue 或联系仓库所有者，相关内容会立即移除。

## 3. 牌面素材

`dist/images/tiles/` 下的电子牌面 PNG（38 件）取自
<https://github.com/riichimahjongtrainer/riichimahjongtrainer>
（commit `ed5a80b9a79a97d4e77aa7e679acaf16cc06c9b9`）。上游仓库未声明独立许可，如需再分发请自行核实。

## 4. 取证锚点

以下信息用于确认内容来源与完整性，可直接对照核验：

- 原书 PDF：`sha256 cb8e6ab80eacd53715e5f485f1f54e29064420afd0dc69c6a878cc9038443b3e`，共 231 页
- 书页图（`dist/images/`，共 1222 张）：`q###.webp` 题面 300、`a###.webp` 解析 300、`counts###.webp` 场况 300、`dora###.webp` 宝牌指示 300、`extra###.webp` 专栏图解 22
- 每题与原书页码的对应关系写在 `dist/reader/content.js` 每道题的 `question_pdf` / `answer_pdf` / `question_printed` / `answer_printed` 字段里
- 电子牌面：`dist/images/tiles/` 共 37 件 PNG（详见第 3 节）
