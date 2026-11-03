# M4 verification

验收日期：2026-11-03。完成 PWA、离线缓存和 GitHub Pages workflow；没有推送，也没有修改 GitHub 网页设置。以下区分已实测与受工具限制未执行的部分。

## Git

- 只用仓库本地配置设置 `wuhaoxuan557-sudo <298067527+wuhaoxuan557-sudo@users.noreply.github.com>`，未设置 global。
- 改写前逐一读取 5 个原始 commit 对象，仅替换 author 身份和必要的 parent 引用；作者时间、committer 元数据保留。每条旧/新提交的 tree 和完整提交信息逐字节比较一致。
- 改写后按由旧到新排序：`fb540f0`、`f4a99d7`、`ae3c3cc`、`ad8b3af`、`bd246ad`。git log 确认五条作者全部为指定身份。
- 主分支 main；origin 为 `https://github.com/wuhaoxuan557-sudo/one-word.git`。没有执行 push，不需要 force push。
- README 中具体局域网地址已改为通用说法。扫描仓库 Markdown（不含依赖/构建/临时目录），没有 RFC1918 局域网 IP。

## 自动检查

- `pnpm install --frozen-lockfile` 通过，packageManager 为 pnpm@11.25.0。
- `pnpm test`：21 个文件，147 项通过。新增覆盖离线缓存命中、不发网络请求、选中词表预取与 BASE_URL、缓存配额错误、未缓存离线错误、404 不入缓存、首次安装不刷新、只在主动更新时发 SKIP_WAITING，以及首页更新按钮。
- `pnpm build`：TypeScript strict 与 Vite 成功。vite-plugin-pwa 2.0.0 生成 sw.js 和本地 Workbox；预缓存 19 条声明，对应去重后的 15 个 URL，完整词表只有运行时缓存，不在预缓存中。
- `actionlint 1.7.12` 检查 `.github/workflows/deploy.yml` 成功，无诊断。官方 release 的临时工具位于忽略的 .qa 中，不添加项目依赖。
- Workflow 使用 main push / workflow_dispatch、packageManager 自动选 pnpm、Node 24、frozen install/test/build、configure-pages@v5、upload-pages-artifact@v4、deploy-pages@v4。deploy 依赖 build，具备 pages:write / id-token:write，使用 github-pages environment；没有把部署凭据写入仓库。
- PNG 为 192×192、512×512、180×180，使用现有 WOFF2 和浏览器 canvas 生成；目视检查白字斩印、深色底色及倾斜，无新增生成依赖。构建不再生成图标。

## 生产预览实测

运行 `pnpm preview --port 4180 --strictPort`，所有检查都在 `http://localhost:4180/one-word/`；这是独立源，未在日常开发地址的数据库里作答。

1. 首页正常显示，CET4 为 3,849 词。应用、两个 manifest、词表 index/CET4、三张图标及六个字体的生产 URL 均实际请求返回 200；HTML 的脚本、样式、图标、manifest 都使用 /one-word/ 前缀。
2. 通过测试辅助页实际读取已激活 worker：scope 为 /one-word/。预缓存包含外壳、六字体、三图标、两个 manifest 及 index.json；运行时缓存只含 CET4。证据 `artifacts/m4/cache-inventory.json`。
3. 先打开构建 A，再生成不同 worker 的构建 B；首页实际出现“有新版本 · 点击更新”，没有自动重载。另一个标签页进入 state 的认词页；在首页点击更新后，首页重载，另一个标签页仍停在 state 和同一组四个选项，没有更新按钮。没有用假状态或 URL 参数模拟提示。截图 `artifacts/m4/update-prompt.png`。
4. **完全停止 preview 服务器**，再刷新应用：首页仍可打开，点击继续学习恢复 state。离线点击“不认识”得到 Again 和实际排期，打开完整详情，点下一个进入 might，返回首页显示已学 1 / 3,849、新词 19。截图 `artifacts/m4/offline-detail.png`，进度证据 `artifacts/m4/offline-progress.txt`。
5. 同一无服务器状态下进入词表选择，index 的真实数量可见。尝试添加尚未缓存的 GRE，显示“GRE 词表尚未缓存或网络不可用，请联网后重试。”；选择页保持可用，返回首页仍为原 CET4 数量及进度，未保存失败的新选择。截图 `artifacts/m4/uncached-wordlist.png`。

## 限制与复验方法

- **未操作 DevTools 的 Offline 开关。** Windows 浏览器控制因工具无法可靠确认当前地址被阻止；停止该控制方式后，使用内置浏览器及“停止生产服务器”完成资源不可达时的冷页面重载和完整单卡流程。这证明本地应用资源无服务器仍可用，但没有证明 navigator.onLine=false 时浏览器/系统语音的行为。
- 用户可复验：联网打开 preview，等首次缓存完成；DevTools → Network → Offline；刷新 /one-word/，完成认词、反馈、详情、下一个，再恢复 No throttling。若使用“Disable cache”，SW Cache Storage 仍需保留；不要勾选 Application → Service Workers 的 Bypass for network。
- 实际 iPhone Safari 添加到主屏幕、系统栏、安全区、系统语音和安装后切换深色模式未在实机验证；相关 meta、两个主题 manifest 及共享 id 已静态核对。主题颜色取现有 tokens，无新增界面颜色。
- 尚未 push，因此 GitHub Actions 的线上部署和最终 HTTPS 地址未实跑。README 写有 Pages 的 GitHub Actions 来源设置及首次启用后重新运行 workflow 的步骤。
- 测试辅助页 `tests/browser/pwa.html` 只手动复制到临时 dist/tests，未加入 public，不随常规构建或部署发布。图标生成页仅在开发服务中使用。

配置依据：[Vite PWA prompt](https://vite-pwa-org.netlify.app/guide/prompt-for-update)、[Service worker registration](https://vite-pwa-org.netlify.app/guide/register-service-worker)、[官方 Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[pnpm setup 版本来源](https://github.com/pnpm/action-setup)。
