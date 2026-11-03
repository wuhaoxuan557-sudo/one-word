# 一词 · M4

按 `SPEC.md` 和 `design/html/01–07` 实现的个人单词练习。默认 CET4，可多选 8 个内置词表；包含学习、词本、统计、设置及 JSON 备份。使用 Dexie / IndexedDB 保存学习数据，ts-fsrs 生成真实排期。关闭页面再打开会回到首页，点击“继续学习”恢复当前题、选项顺序、反馈或详情阶段。跟随系统深色模式，桌面内容最大宽度 480px。

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

打开终端显示的 Local 地址，通常为 `http://localhost:5173/one-word/`。保持终端运行；按 Ctrl+C 停止。端口被占用时以终端实际输出为准。

## 在手机上打开

手机和电脑连接同一 Wi-Fi，电脑上先运行 `pnpm dev`，然后在手机 Safari 输入 `http://电脑的局域网IP:5173/one-word/`；手机上的 localhost 指的是手机自己，不能用于访问电脑。局域网 HTTP 可检查界面；安装和离线验证使用下面的 HTTPS Pages 地址。

可以用以下命令查看电脑地址：

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -eq 'WLAN' } | Select-Object IPAddress
```

用查到的电脑局域网 IP 替换地址中的占位文字，地址可能随网络变化。若无法访问，检查是否同网、网络是否禁止设备互访，以及 Windows 是否允许该开发服务通过当前可信网络；项目不会自动修改防火墙设置。

## 下载 ECDICT 并构建词表

项目已提供 8 个生成好的 JSON，直接启动无需重新下载 CSV。要复现本次数据，在项目目录执行：

```powershell
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/skywind3000/ECDICT/39cfb9672c0906b63569e0453c2e6abfb9ab182a/ecdict.csv' -OutFile 'wordlists_src/ecdict.csv'
python scripts/build_wordlist.py
```

来源为 [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)，MIT 许可在 `public/ECDICT-LICENSE.txt`；版本、校验值和词数见 `wordlists_src/README.md`。完整 CSV 在 public 之外，并被 Git 忽略，不进入前端构建。

脚本按完整 tag 输出 `public/wordlists/<tag>.json`，支持 zk、gk、cet4、cet6、ky、ielts、toefl、gre。`translation` 保存前 3 个逻辑行；`translationFull` 保存完整中文释义；`definition` 保留完整英文释义。CSV 的字面 `\n` 会转换为换行。ID 为 `ecdict:<大小写归一化单词>`，跨词表稳定。缺失词频记为 0，按 frq 排序时放最后。

在 `wordlists_src/custom/` 放 UTF-8 `.txt`，每行一个单词，再运行脚本即可生成同名 JSON。空行和重复词被忽略，未找到的词打印到终端，不编造释义；可手动补充源 CSV 后重建。自定义文件不能使用考试标签名。M3 界面提供 8 个内置词表，自定义词表暂只支持构建脚本输出。

```powershell
python scripts/build_wordlist.py --csv 'path/to/ecdict.csv' --out 'public/wordlists' --custom-dir 'wordlists_src/custom'
```

## 学习行为

- 认词 → 正误反馈 → 完整详情。首次学习显示“新词”，之后为“复习 · 第 N 次”，初次复习计第 1 次。作答后锁定选项。评分用的 `elapsedMs` 记录本次显示到作答的时间，刷新或从首页继续时重新计时；估时用的 `studyMs` 另从最初出卡计至点击“下一个”，包含反馈、详情，恢复同一张卡时保留原出卡时间。
- 选项只取 translation 第一个逻辑行的前 3 个义项，保留词性前缀并用“；”连接，CSS 限制为最多 2 行并显示省略号。详情中文释义只统一义项分隔符，不删减逻辑行或义项。
- Again：答错或“不认识”；Hard：答对且超过 6 秒；Good：其余答对；Easy：2 秒以内答对且该词在持久化历史中从未答错。默认阈值来自 `src/core/rating.ts`，每次作答读取 settings 中的 grading。
- Good/Easy 主按钮为“下一个”，旁边可点“看详情”；Again/Hard 主按钮为“看详情”。反馈与详情显示真实评分和排期，例如“Again · 1 分钟后”；到期显示“现在”。点击“不认识”的结果文案为“没关系，记住它”，真正选错才显示“选错了”。
- ts-fsrs 固定为 5.4.2（FSRS-6，兼容本项目 Node.js 22.12+ 要求）；学习步骤为 1 分钟、10 分钟，重学步骤为 10 分钟，fuzz 关闭。长间隔由算法生成，不把示例的天数写死。
- “斩”立即保存并进入下一张卡，显示 3 秒“已斩 · 撤销”，不新增复习记录。提示条撤销恢复斩词前的卡片状态，保留当前题及已有排期。再次斩词时提示条对应最近一次操作。过期后仍可到词本的“已斩”标签页撤销：未学词回到新词队列，已学词改为现在到期，遵守每日额度与复习优先。
- 详情内容区滚动，顶部和底部操作区保持可见。详情按钮可加入/移出生词本，状态即时保存；未学收藏词优先进入所选词表的新词名额，已学收藏词保留原 FSRS 排期。详情的词表标签来自真实所属词表。
- 桌面 `1`–`4` 选项、`0` 不认识、`X` 斩、`R` 发音；反馈/详情中的空格或回车触发当前主动作。焦点位于按钮时保留按钮原生键盘行为。
- 首页按 01-home 实现：待复习、新词、词表进度、已斩、生词本数量均来自数据库。预计分钟数使用新词/复习各自的收缩估计 `(n × 历史均值 + 20 × 默认值) / (n + 20)`，默认分别为 25 秒/8 秒。只统计完整单卡时长 `studyMs`，尚未点击“下一个”或缺少此字段的旧记录不计入样本；两类预计时长相加后换成分钟向上取整。尚未到期的词不算当前待复习；若只剩可提前学习的步骤卡，开始按钮仍可使用，预计时间包含这些卡。
- 首页、词本、统计、设置四个导航全部可用；学习中和词表选择页隐藏导航。备份提示仅超过 14 天才出现，首次使用不会显示假提示，首页也可直接导出备份。
- 设置页的自动朗读、口音、每日上限及评分阈值即时保存并生效。每日新词每步增减 1、复习上限每步 10，两者范围 0–10000；评分阈值每步 0.5 秒，快速阈值始终小于慢速阈值，最高 600 秒。正在显示的题可继续完成，之后遵守新上限；降低上限不会删除已完成记录。

## 词本、词表与统计

启动只读取当前选中的词表；切换时按需加载新增选择，当前页面缓存已加载内容。选择页词数、去重数量和详情归属标签由约 314 KB 的本地 `wordlists/index.json` 提供，不用下载 8 份完整词表；构建脚本同步生成索引，自定义词表不可占用 `index` 名称。

收藏或斩词立即把单词和短释义快照保存到 cards，另保留完整中文用于搜索，词本不依赖任何已加载词表。旧数据库缺少快照时只补读对应来源并持久化补齐，后续重开不再为词本读取未选词表。若保留的旧题选项来自旧选择，点击继续学习时再补读。

词本显示全部已保存词条，切换学习词表不会隐藏旧收藏或已斩词。搜索支持英文单词及完整中文释义；生词本按加入时间、已斩按斩词时间排序。两个标签页分别提供“移出”和“撤销”。

点击首页右上角标签进入词表选择，至少选一个，可同时选择中考、高考、CET4、CET6、考研、IELTS、TOEFL、GRE。按去除首尾空格并忽略大小写的单词去重，卡片使用稳定 wordId 共用学习历史。CET4 与 CET6 合并去重后为 5,805 词。多选时首页显示如“CET4 等 2 个”。更改选择重排未开始的队列，已完成的当日额度保留。

统计从 reviewLogs 计算近 30 个本地自然日（含今天）的作答次数，包含首次学习和同日重现。首次正确率只取每词每天的第一次作答，汇总按首次作答次数加权，不是各日百分比的简单平均。累计已学按有作答记录的不同词计；已斩和生词本来自当前 cards 标记。无记录日留空，无数据正确率显示“—”。图表用 div 实现；如出现低于 60% 的正确率，纵轴自动从 0% 起，避免隐藏低值。

## JSON 备份

导入先完成结构校验，再根据备份的选择与引用按需加载词表，不预读全部 8 个词表。v1 备份仍兼容缺少快照的旧卡片，校验阶段补齐；这一步不会写数据库。所需词表加载失败时也不会覆盖数据。

在设置页点击“导出备份”，保存下载的 `one-word-YYYY-MM-DD.json`。文件包含 `format: "one-word-backup"`、`version: 1`、导出时间、三表数据及当前题。触发下载后记录上次导出时间；仍须确认文件已保存到自己的设备。

点击“导入备份”选取 JSON。程序先校验格式、版本、字段、日期、词条引用、设置和当前题状态；空文件、无效 JSON、版本不符或无效记录只显示错误，不写入数据库。校验通过后出现覆盖确认框，取消不会修改数据；确认后在单个事务中替换三张表，任何写入失败整体回滚。导入会恢复设置和词表选择，不能撤回，覆盖前可先导出现有数据。

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

数据属于**同一浏览器、同一站点地址**：localhost、局域网 IP、不同端口以及手机浏览器各有自己的存储，不会自动同步。关闭标签页不会清空数据；清除站点数据或隐私窗口关闭仍可能丢失。可以导出 JSON 后在另一个设备手动导入。

干扰项先查同词性、相近词频（范围 `max(1000, 当前排名 × 0.75)`），再放宽为同词性不限词频，最后不限词性。每一级都排除重复词，并按选项实际使用的缩短文本检查与正确项、其他干扰项的重叠；显示与检查共用格式化函数，不使用隐藏的后续释义。使用候选组合搜索避免贪心误判。该规则是文字启发式，不能保证识别所有语义近义词。若输入词表本身不足四个可区分释义，停留在原词并显示数据问题，不自动跳词、不伪造选项。

## 资源与发音

全部字体、脚本、样式、词表使用同源资源；字体从 `assets/fonts/` 复制到 `src/assets/fonts/` 并由 Vite 打包，没有 Google Fonts 或 CDN 请求。字体说明随文件保留。所有应用颜色由 `src/styles/tokens.css` 定义。

Web Speech API 优先选择本地英语声音，组内优先设置中选择的英音或美音；缺少本地英语声音时允许浏览器的远程英语声音。声音列表延迟加载时等待 `voiceschanged`；空列表超时后仍尝试浏览器默认英语朗读。远程语音可能需要网络。这是已批准的资源规则例外，页面不因缺少本地声音提示“不可用”。实际浏览器拒绝播放时允许手动重试。

安全区顶部使用 `max(16px, env(safe-area-inset-top))`，底部操作区使用 `max(20px, env(safe-area-inset-bottom))`。桌面浏览器模拟的 390×844 viewport 通常没有 iPhone 系统安全区，不能用它证明真实设备的系统栏表现。

## 验证

```powershell
pnpm test
pnpm test:wordlist
pnpm run build
pnpm preview
```

M4 验收记录见 `QA-M4.md`；M1–M3 历史记录见 `QA.md`、`QA-M2.md`、`QA-M3.md`。真实 IndexedDB 测试可在开发服务运行时打开 `/one-word/tests/browser/m3.html` 和 `/one-word/tests/browser/index.html`，分别使用独立数据库 `one-word-m3-browser-tests`、`one-word-m2-browser-tests`，不修改正式数据库。测试中通过参数传入时间检查跨日，不修改系统时钟。

使用 SPEC 列出的 Dexie 4.4.7、ts-fsrs 5.4.2 与 vite-plugin-pwa 2.0.0，没有增加状态管理、UI 或图表依赖。React Vite 插件固定为 6.1.2，测试间接依赖 tinybench 固定为 6.2.2，以满足本机 pnpm 的发布时间检查，未降低该检查策略。

## 部署与 iPhone 主屏幕

生产路径固定为 `/one-word/`。运行 `pnpm build`、`pnpm preview` 后打开 `http://localhost:4173/one-word/`（端口被占用时以终端为准）。开发服务不注册 SW，PWA 用生产 preview 或 HTTPS 站点验证。

仓库远程为 `https://github.com/wuhaoxuan557-sudo/one-word.git`，主分支为 main；本机仅配置仓库作者。本轮只提交，不推送。自行执行：

```powershell
git push -u origin main
```

在 GitHub 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。若首次推送时尚未启用 Pages，在 Actions 中打开 **Deploy GitHub Pages**，选择 **Re-run all jobs** 或 **Run workflow → main**。若仓库禁用了 Actions，先在 **Settings → Actions → General** 允许该 workflow 使用的 actions。部署使用 github-pages environment，仅允许 main 部署；若自行加了审批规则，需要在 Actions 批准部署。

Workflow 从 package.json 的 packageManager 读取 pnpm 版本，依次执行 frozen install、测试和构建，再用官方 Pages artifact/deploy actions 发布。成功后打开 `https://wuhaoxuan557-sudo.github.io/one-word/`。后续 push main 自动重复此流程。配置依据：[GitHub Pages 官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

iPhone 上用 Safari 打开上面的 HTTPS 地址，等待首页加载，选择要学习的词表并保存；点分享按钮 →“添加到主屏幕”→ 确认名称“一词”→“添加”。然后从主屏幕图标打开。支持的 iOS 版本中可保留“作为 Web App 打开”选项。安装后的安全区使用 black-translucent 状态栏及 viewport-fit=cover；真实 iPhone 的系统栏仍需实机检查。

应用外壳、字体、图标和 index.json 预缓存；选中词表在后台预取并用 CacheFirst 保存，之后可离线学习。完整词表不一次性预缓存 8 份。第一次使用或换词表时先保持联网，等待加载成功；离线选择未缓存词表会显示明确提示，原选择和学习数据保持完整。词表缓存名跟随构建时的数据指纹，数据更新后按新版本重新缓存。远程系统语音离线时可能不能播放。

有新版本时只在首页显示“有新版本 · 点击更新”，认词、反馈、详情中不会出现更新按钮或自动刷新。学完回首页，点击该行才激活新版本并重载；其他正在学习的标签页也不会被强制刷新。重新打开或恢复页面联网时会检查更新，保持页面打开时每小时再检查一次。浅/深色 manifest 共用应用 ID，主题色与背景色读取对应 tokens。

学习记录保存在设备浏览器中，PWA 缓存不能代替备份。建议每周到设置页导出 JSON，并保留到站点以外的位置；清理浏览器、换设备或重新安装前先导出。超过 14 天未备份时首页会提醒。开发地址、preview 地址和 Pages 是不同的源，迁移旧进度需从旧地址导出，再到新地址导入。

图标已生成并提交，日常构建无需图形工具或额外依赖。若需重做，启动开发服务并打开 `/one-word/scripts/icons.html`，使用现有 WOFF2 字体和浏览器 canvas 下载三张 PNG 放入 public/icons。验收见 `QA-M4.md`。
