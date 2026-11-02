# 一词 · M2

按 `SPEC.md` 和 `design/html/01–04` 实现的个人单词练习。固定使用 CET4，使用 Dexie / IndexedDB 保存学习数据，ts-fsrs 生成真实排期。关闭页面再打开会回到首页，点击“继续学习”恢复当前题、选项顺序、反馈或详情阶段。跟随系统深色模式，桌面内容最大宽度 480px。

## 包管理器与本机环境

统一使用 **pnpm 11.25.0**，保留 `pnpm-lock.yaml`。需要 Node.js 22.12+、构建词表时需要 Python 3.10+。本次环境中 PATH 可用的是 Codex 运行时提供的 pnpm，没有直接可用的 npm。

如果普通 PowerShell 提示找不到 pnpm/node，先在该窗口执行以下两行；只影响当前终端，不修改系统 PATH：

```powershell
$vocabRuntime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$env:Path = "$vocabRuntime\bin\fallback;$vocabRuntime\node\bin;$env:Path"
```

## 在电脑上启动

```powershell
Set-Location 'D:\01_学习与规划\学习工具'
pnpm install --frozen-lockfile
pnpm dev
```

打开终端显示的 Local 地址，通常为 `http://localhost:5173/`。保持终端运行；按 Ctrl+C 停止。端口被占用时以终端实际输出为准。

## 在手机上打开

手机和电脑连接同一 Wi-Fi，电脑上先运行 `pnpm dev`。它监听 `0.0.0.0`，然后在手机 Safari 输入 `http://电脑的局域网IPv4:5173/`；手机上的 localhost 指的是手机自己，不能用于访问电脑。

可以用以下命令查看电脑地址：

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -eq 'WLAN' } | Select-Object IPAddress
```

本次检查的 WLAN 地址是 `172.19.98.56`，对应 `http://172.19.98.56:5173/`。地址可能随网络变化。若无法访问，检查是否同网、网络是否禁止设备互访，以及 Windows 是否允许该开发服务通过当前可信网络；项目不会自动修改防火墙设置。

## 下载 ECDICT 并构建词表

项目已提供 8 个生成好的 JSON，直接启动无需重新下载 CSV。要复现本次数据，在项目目录执行：

```powershell
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/skywind3000/ECDICT/39cfb9672c0906b63569e0453c2e6abfb9ab182a/ecdict.csv' -OutFile 'wordlists_src/ecdict.csv'
python scripts/build_wordlist.py
```

来源为 [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)，MIT 许可在 `public/ECDICT-LICENSE.txt`；版本、校验值和词数见 `wordlists_src/README.md`。完整 CSV 在 public 之外，并被 Git 忽略，不进入前端构建。

脚本按完整 tag 输出 `public/wordlists/<tag>.json`，支持 zk、gk、cet4、cet6、ky、ielts、toefl、gre。`translation` 保存前 3 个逻辑行；`translationFull` 保存完整中文释义；`definition` 保留完整英文释义。CSV 的字面 `\n` 会转换为换行。ID 为 `ecdict:<大小写归一化单词>`，跨词表稳定。缺失词频记为 0，按 frq 排序时放最后。

在 `wordlists_src/custom/` 放 UTF-8 `.txt`，每行一个单词，再运行脚本即可生成同名 JSON。空行和重复词被忽略，未找到的词打印到终端，不编造释义；可手动补充源 CSV 后重建。自定义文件不能使用考试标签名。M2 界面仍只加载 CET4，多词表选择留待 M3。

```powershell
python scripts/build_wordlist.py --csv 'path/to/ecdict.csv' --out 'public/wordlists' --custom-dir 'wordlists_src/custom'
```

## M2 行为

- 认词 → 正误反馈 → 完整详情。首次学习显示“新词”，之后为“复习 · 第 N 次”，初次复习计第 1 次。作答后锁定选项。评分用的 `elapsedMs` 记录本次显示到作答的时间，刷新或从首页继续时重新计时；估时用的 `studyMs` 另从最初出卡计至点击“下一个”，包含反馈、详情，恢复同一张卡时保留原出卡时间。
- 选项只取 translation 第一个逻辑行的前 3 个义项，保留词性前缀并用“；”连接，CSS 限制为最多 2 行并显示省略号。详情中文释义只统一义项分隔符，不删减逻辑行或义项。
- Again：答错或“不认识”；Hard：答对且超过 6 秒；Good：其余答对；Easy：2 秒以内答对且该词在持久化历史中从未答错。默认阈值来自 `src/core/rating.ts`，每次作答读取 settings 中的 grading。
- Good/Easy 主按钮为“下一个”，旁边可点“看详情”；Again/Hard 主按钮为“看详情”。反馈与详情显示真实评分和排期，例如“Again · 1 分钟后”；到期显示“现在”。点击“不认识”的结果文案为“没关系，记住它”，真正选错才显示“选错了”。
- ts-fsrs 固定为 5.4.2（FSRS-6，兼容本项目 Node.js 22.12+ 要求）；学习步骤为 1 分钟、10 分钟，重学步骤为 10 分钟，fuzz 关闭。长间隔由算法生成，不把示例的天数写死。
- “斩”立即保存并进入下一张卡，显示 3 秒“已斩 · 撤销”，不新增复习记录。撤销恢复斩词前的卡片状态，保留当前题；恢复的新词可接在当前题之后，已有排期的词继续遵守原到期时间。再次斩词时提示条对应最近一次操作。过期后已斩状态一直保留，完整已斩列表留待 M3。
- 详情内容区滚动，顶部和底部操作区保持可见。生词本按钮保留位置但禁用，标注“生词本（稍后推出）”。详情的词表标签来自当前 CET4，不复制原型的其他考试标签。
- 桌面 `1`–`4` 选项、`0` 不认识、`X` 斩、`R` 发音；反馈/详情中的空格或回车触发当前主动作。焦点位于按钮时保留按钮原生键盘行为。
- 首页按 01-home 实现：待复习、新词、词表进度、已斩、生词本数量均来自数据库。预计分钟数使用新词/复习各自的收缩估计 `(n × 历史均值 + 20 × 默认值) / (n + 20)`，默认分别为 25 秒/8 秒。只统计完整单卡时长 `studyMs`，尚未点击“下一个”或缺少此字段的旧记录不计入样本；两类预计时长相加后换成分钟向上取整。尚未到期的词不算当前待复习；若只剩可提前学习的步骤卡，开始按钮仍可使用，预计时间包含这些卡。
- 首页主导航只有首页可用，其他三项禁用；词本入口和导出按钮同样暂不可用。备份提示仅超过 14 天才出现，首次使用不会显示假提示。
- 自动朗读、口音、每日上限及评分阈值已存入 settings；M3 再提供完整设置界面。

## 每日队列与保存

按设备本地日期分日。默认每天纳入最多 20 个新词、200 个不同的到期复习词；复习按到期先后，之后是按 frq 排序的新词（0 放最后）。同一天关闭/重开不会重新补满已完成或已斩名额。次日重新选取到期卡和未学词，历史及排期不清零。

先完成正常到期复习和新词；当前可学队列为空时，按到期顺序提前学习未来 20 分钟内（含边界）的 Learning / Relearning 步骤卡，不提前普通 Review 卡，也不重复占每日名额。窗口阈值在 `src/core/config.ts` 的 `STUDY_CONFIG.learnAheadMinutes` 中。20 分钟内也没有时，显示“还有 N 个词将在 X 分钟后到期”并提供“返回首页”，其中 X 是最近一张的等待分钟数，向上取整。

进度按今天已经完成的学习次数加当前/剩余队列计算，所以当学习步骤增加重现时，总数会增加。已经显示的题不会被突然换掉；到期复习在切换下一题时优先。提前作答使用真实作答时间调度，不把时钟改成未来到期时间。

只有 SPEC 要求的三张 IndexedDB 表：

| 表 | 内容 |
|---|---|
| cards | wordId、完整 FSRS Card、是否已斩/在生词本、是否曾答错、首次学习时间 |
| reviewLogs | 每次作答的词、时间、评分、作答用时、完整单卡时长（点击下一个时补记）、正误、初学/复习类别、实际到期时间及 FSRS log |
| settings | 阈值、每日上限、发音设置、创建/备份时间，以及当天名额、当前题、选项、阶段与撤销窗口 |

一次作答在同一 Dexie 事务中写入卡片、日志和恢复状态；提交成功后才显示反馈。写入失败会回滚并提示重试，重复点击或其他标签页的旧作答不会多记一次。启动时尝试 `navigator.storage.persist()`，浏览器是否批准由其决定。

数据属于**同一浏览器、同一站点地址**：localhost、局域网 IP、不同端口以及手机浏览器各有自己的存储，不会自动同步。关闭标签页不会清空数据；清除站点数据或隐私窗口关闭仍可能丢失。导入导出和跨设备手动迁移留待 M3。

干扰项先查同词性、相近词频（范围 `max(1000, 当前排名 × 0.75)`），再放宽为同词性不限词频，最后不限词性。每一级都排除重复词，并按选项实际使用的缩短文本检查与正确项、其他干扰项的重叠；显示与检查共用格式化函数，不使用隐藏的后续释义。使用候选组合搜索避免贪心误判。该规则是文字启发式，不能保证识别所有语义近义词。若输入词表本身不足四个可区分释义，停留在原词并显示数据问题，不自动跳词、不伪造选项。

## 资源与发音

全部字体、脚本、样式、词表使用同源资源；字体从 `assets/fonts/` 复制到 `src/assets/fonts/` 并由 Vite 打包，没有 Google Fonts 或 CDN 请求。字体说明随文件保留。所有应用颜色由 `src/styles/tokens.css` 定义。

Web Speech API 优先选择本地英语声音，组内优先英音；缺少本地英语声音时允许浏览器的远程英语声音。声音列表延迟加载时等待 `voiceschanged`；空列表超时后仍尝试浏览器默认英语朗读。远程语音可能需要网络。这是已批准的资源规则例外，页面不因缺少本地声音提示“不可用”。实际浏览器拒绝播放时允许手动重试。

安全区顶部使用 `max(16px, env(safe-area-inset-top))`，底部操作区使用 `max(20px, env(safe-area-inset-bottom))`。桌面浏览器模拟的 390×844 viewport 通常没有 iPhone 系统安全区，不能用它证明真实设备的系统栏表现。

## 验证

```powershell
pnpm test
pnpm test:wordlist
pnpm run build
pnpm preview
```

M2 验收记录见 `QA-M2.md`，M1 历史记录见 `QA.md`。真实 IndexedDB 测试可在开发服务运行时打开 `/tests/browser/index.html`，使用独立数据库 `one-word-m2-browser-tests`，不修改正式数据库。测试中通过参数传入时间检查跨日，不修改系统时钟。

只新增 SPEC 列出的 Dexie 4.4.7 与 ts-fsrs 5.4.2，没有增加状态管理、UI 或测试辅助依赖。React Vite 插件固定为 6.1.2，测试间接依赖 tinybench 固定为 6.2.2，以满足本机 pnpm 的发布时间检查，未降低该检查策略。

## 部署与 iPhone 主屏幕

本次完成 M2；多词表选择、设置/词本/统计/导入导出留待 M3，PWA 和部署留待 M4。`pnpm run build` 会产生静态 `dist/`，`pnpm preview` 可在本地检查它。

M4 再配置 GitHub Pages、仓库 base 路径、GitHub Actions、manifest 和离线缓存。未来部署后用 iPhone Safari 打开站点，通过分享菜单选择“添加到主屏幕”。当前不承诺离线打开或安装体验，真实 iPhone Safari 的发音和安全区仍需设备验收。
