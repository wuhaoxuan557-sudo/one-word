# AGENTS.md

这是一个只给我一个人用的背单词 PWA。

## 先读这些

- `SPEC.md`：完整需求和里程碑。
- `design/html/`：视觉设计的权威来源（静态 HTML，数值写在 inline style 里）。
- `design/screens/`：对应截图。
- `assets/fonts/`：要用的字体文件。

## 工作规则

- 一次只做我指定的里程碑。做完后停下，汇报改了什么、怎么验证，以及有哪些偏离 SPEC 的地方和原因。
- 不引入 SPEC.md 没有列出的依赖。确实需要时先问我。
- 运行时的字体、脚本、样式和词表都使用本地资源：不用 Google Fonts，不用 CDN。发音优先使用本地英语声音；没有本地英语声音时，允许使用浏览器提供的非本地声音。
- 颜色只能用 `src/styles/tokens.css` 里的变量。
- 界面按 `design/html/` 还原：间距、字号、圆角、颜色都照抄数值，不要自行"优化"设计。
- 统一使用 pnpm；`pnpm test` 和 `pnpm run build` 都通过才算完成。
- 和我沟通用中文；代码、注释、commit message 用英文。
