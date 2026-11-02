# 一词 · M1

按 [SPEC.md](./SPEC.md) 实现个人背单词 App 的第一个里程碑。

已实现：ECDICT 构建脚本、一个 CET4 词表、认词 → 反馈 → 详情、答题计时、发音、快速答对跳过详情、会话内斩词、键盘操作、移动端布局和系统深色模式。学习状态只放在 React 内存中，刷新或关闭页面即重置；斩词不生成作答记录。

**M2–M5 尚未实现。** 本版没有 Dexie、FSRS、每日额度/复习队列、已斩列表/撤销、生词本、设置页、备份、统计页、PWA 或部署 workflow。界面上的自动发音开关只影响当前页面；默认口音 en-GB。6 秒内答对时可以跳过详情，这个阈值是 M1 的界面常量，不进行 FSRS 评分。

## 下载 ECDICT 并构建词表

需要 Python 3.10+。脚本仅使用标准库。项目已经附带本次生成的 8 个考试词表，直接运行前端无需再次下载 CSV。

在项目目录的 PowerShell 执行以下命令，可重建本次使用的数据：

```powershell
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/skywind3000/ECDICT/39cfb9672c0906b63569e0453c2e6abfb9ab182a/ecdict.csv' -OutFile 'wordlists_src/ecdict.csv'
python scripts/build_wordlist.py
```

数据来源是 [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)，MIT 许可；许可保存在 `public/ECDICT-LICENSE.txt` 并随构建输出。版本和校验值见 [wordlists_src/README.md](./wordlists_src/README.md)。若自行升级源文件，也请保留上游许可。

脚本一次读取一行 CSV，以空白分隔的完整 tag 筛选，输出 `public/wordlists/{zk,gk,cet4,cet6,ky,ielts,toefl,gre}.json`。`translation` 保留前 3 个逻辑行，`translationFull` 保留完整中文释义，`definition` 保留完整英文释义；CSV 中的字面 `\n` 会转换成换行，JSON 正常转义它。所有数字字段转为非负整数，缺失词频为 0。ID 为 `ecdict:<大小写归一化单词>`，跨词表稳定并按单词去重。输出按 frq 升序排列，0 排最后。

自定义词表：在 `wordlists_src/custom/` 放入 UTF-8 `.txt`，每行一个单词，然后重新运行脚本。比如 `my-words.txt` 生成 `public/wordlists/my-words.json`。查询忽略大小写，空行和重复词被忽略；未找到的词打印到标准错误，不会编造释义。可手动补充源 CSV 后再构建。自定义词表不能使用考试标签名，以免覆盖考试词表。M1 界面固定加载 CET4，自定义词表的选择界面留待后续里程碑。

可指定其他路径：

```powershell
python scripts/build_wordlist.py --csv 'path/to/ecdict.csv' --out 'public/wordlists' --custom-dir 'wordlists_src/custom'
```

完整 CSV 被 `.gitignore` 排除，并放在 `public/` 外；Vite 不会将它打包进前端。

## 在本地运行

需要 Node.js 22.12+（或较新 LTS）和 pnpm 10.28.2。可以通过 Corepack 启用 pnpm，也可以用 `npm install --global pnpm@10.28.2` 安装。

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

打开终端显示的地址（通常是 `http://localhost:5173`）。移动端调试可在同一局域网内通过电脑 IP 访问；该页面需要电脑的开发服务持续运行。

操作：选择四个释义之一或“不认识” → 查看正误及用时 → “查看详情” → “下一个”。答错不能跳过详情；6 秒内答对可直接进入下一个词。“斩”立即跳过该词，当前页面内重练也不再出题。重新加载页面会清除所有作答、斩词和开关状态。

桌面快捷键：`1`–`4` 选项，`0` 不认识，`X` 斩，`R` 重播，空格继续（答错/慢答的反馈阶段先进入详情，详情阶段进入下一个词）。

干扰项只从 CET4 中抽取，使用 `pos` 最大权重的词性；无 `pos` 时采用首条中文释义的词性前缀。按词频距离筛选相同主要词性的候选，范围为 `max(1000, 当前排名 × 0.75)`，从最近的 24 个候选中随机取 3 个。未知词频只与未知词频配对。排除重复词、共享义项、包含关系及明显文字重叠的释义，也检查干扰项之间的重复。这个文字启发式不能保证识别所有语义近义词。若凑不齐 4 个合规选项，就跳过该词并在页面说明数量，不放宽约束或凑数。

发音使用 Web Speech API。优先 en-GB，缺失时尝试其他英语声音。浏览器可能限制自动朗读；点击喇叭可手动重播。此项目未在真实 iPhone Safari 验证语音。

## 验证与构建

```powershell
pnpm test
pnpm test:wordlist
pnpm build
pnpm preview
```

`src/core/` 的纯函数测试覆盖干扰项与重叠判定、词形解析、词表校验与排序、计时与首次作答锁定。Python 测试覆盖 tag、自定义词表、缺失词、去重、释义截断和完整内容保留。浏览器验收记录见 [QA.md](./QA.md)。

项目结构：`scripts/` 构建与脚本测试，`src/core/` 纯逻辑与 Vitest，`src/speech.ts` 发音适配层，`src/App.tsx` 界面，`public/wordlists/` 生成的静态词表。没有新增状态管理库或 UI 组件库。

## 部署（M4 待实现）

`pnpm build` 生成纯静态 `dist/`。本次仅验证本地构建，没有发布站点，也没有生成 GitHub Actions。M4 再配置 GitHub Pages 的发布路径、workflow 和 PWA 缓存；不要把本版当作已有离线支持。

## iPhone 添加到主屏幕（M4 待验证）

未来站点部署后，可在 Safari 打开站点，通过分享菜单选择“添加到主屏幕”。本版尚无 PWA manifest/service worker，不承诺安装体验或离线使用。真实 iPhone 上的布局、发音和主屏幕行为需要届时验收。
