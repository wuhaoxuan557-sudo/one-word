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
- 运行时不得请求任何外部网络资源（我在中国大陆）：不用 Google Fonts，不用 CDN。
- 颜色只能用 `src/styles/tokens.css` 里的变量。
- 界面按 `design/html/` 还原：间距、字号、圆角、颜色都照抄数值，不要自行"优化"设计。
- `npm test` 和 `npm run build` 都通过才算完成。
- 和我沟通用中文；代码、注释、commit message 用英文。
