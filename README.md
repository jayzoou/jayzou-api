# jayzou-api

Jay 数字会客厅的独立 Node.js 后端，与 `jayzou.me` 前端仓库分别维护和部署。

Node.js 22.22.2、npm 10.9.7、TypeScript strict、Hono、Zod、Vercel AI SDK 7。支持离线 Mock 和百炼真实模型两种模式，保持相同的 UI Message Stream 接口。

## 启动

```sh
nvm use
npm ci
npm run build
npm run import:knowledge -- ../jayzou.me/dist/ai/knowledge.json
npm run dev
```

知识文件由博客 `npm run build` 自动生成。未导入时服务仍可启动，但文章查询会提示知识库未配置。导入新版本后重启 API；服务启动时校验配置、公开简历和知识文件，损坏文件不会被静默忽略。

默认监听 `http://127.0.0.1:8787`，健康检查为 `/health`。可复制 `.env.example` 为 `.env` 调整端口、允许来源、文件路径和模拟分块间隔。`data/profile.json` 只填写愿意公开的信息，初始履历为空，不包含虚构工作或教育经历。

默认 `NODE_ENV=development`，允许 `localhost`、`127.0.0.1` 和 `[::1]` 的 HTTP/HTTPS 来源使用任意端口，以兼容 Vite 从 5000 自动切换到 5002 等端口。域名后缀、账号信息和路径不会被当成本机来源。`NODE_ENV=production` 或 `test` 时仅允许 `ALLOWED_ORIGINS` 中的精确来源；部署时须显式设置 `NODE_ENV=production` 和站点白名单。

前端默认通过 Vite 代理请求 `/api/chat`，浏览器显示 `http://localhost:5002/api/chat` 是正常的；该请求由 Vite 转发到 8787。若返回 `ORIGIN_DENIED`，检查来源策略和 `NODE_ENV`，无需为每次开发端口变化修改前端 API 地址。`.env not found` 仅表示使用默认配置，不影响服务启动。

生产运行：`npm run build` 后执行 `npm start`。会话由前端标签页保存；联系表单仍仅模拟提交，幂等记录仅在本进程保存 5 分钟。身份认证、跨进程限流、数据库和真实通知尚未接入。

## 真实模型

参考 `askLOL-serve` 的百炼接入，使用 `@ai-sdk/openai-compatible` 调用 Chat Completions，默认 `qwen-plus`，关闭 thinking。复制 `.env.example` 为 `.env` 后设置：

```dotenv
AI_MODE=live
BAILIAN_API_KEY=你的百炼密钥
BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
BAILIAN_MODEL=qwen-plus
```

这些变量名称与参考项目相同；密钥只存于服务端，`.env` 已忽略，不能使用 `VITE_*` 变量。live 模式缺少密钥会在启动时失败，不会静默回退 Mock。配置变更后重启服务，`/health` 的 `mode` 应为 `live`。

真实聊天支持多轮文本和四种服务端工具；简历与文章来自本地校验数据，客户端提交的历史工具结果会被丢弃。Demo 仍是预设防抖示例，联系表单仍不投递。文章检索保留关键词实现，文章导读由模型根据截断后的原文生成，经过 Zod 与脑图树校验后返回；路由、内容版本与来源由服务端填写。

聊天最多保留 16 条文本、总计 12000 字符，每条最多 2000 字符；检索上下文与原文输入有界。每次请求最多两轮工具步骤加一轮最终回答，每步最多 `MAX_OUTPUT_TOKENS`（默认 2000），总时限 `LLM_TIMEOUT_MS`（默认 60000 毫秒），不自动重试。每个进程最多 `MAX_CONCURRENT_STREAMS`（默认 10）个模型流，超限返回 429；停止、断开或超时会取消上游请求。这个并发上限不等同于持久化用户限流，公开部署前仍需在网关配置访问与费用限制。

`npm run check` 使用可重复的接口替身，不消耗模型额度。配置真实密钥并导入知识后，可运行 `npm run test:live` 验证真实推理、Function Calling 和文章导读，此命令会消耗模型额度，CI 不执行。

## 接口

| 接口 | 行为 |
| --- | --- |
| `GET /health` | 模式、协议版本、知识版本和文章数量 |
| `GET /api/articles?q=闭包` | 标题、摘要、章节与正文关键词检索 |
| `POST /api/chat` | AI SDK UI Message Stream SSE；支持简历、推荐文章、预设 Demo 和联系表单工具 |
| `POST /api/articles/insights` | 接收 `articlePath`，返回进度及经 Zod 校验的要点、脑图与原文来源 |
| `POST /api/contact` | 校验姓名、邮箱、留言及 `Idempotency-Key`，返回 202 模拟结果 |

聊天请求兼容 AI SDK `DefaultChatTransport`：

```json
{
  "id": "conversation-id",
  "contractVersion": "1",
  "messages": [{ "id": "user-1", "role": "user", "parts": [{ "type": "text", "text": "有哪些关于闭包的文章？" }] }]
}
```

```sh
curl -N http://127.0.0.1:8787/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"你好"}]}]}'
```

错误在流开始前返回统一 JSON（`error.code/message/requestId`），开始后返回 SSE 错误事件。允许来源通过配置限制；CORS 不是身份认证。客户端历史中的工具结果不会被当成可信简历或重新执行的指令。

## 契约与内容同步

`src/contracts.ts` 是 v1 DTO、Zod Schema 和前端消息类型的来源：

```sh
npm run export:contracts -- ../jayzou.me/src/lib/ai/contracts.ts
```

前端文件为生成副本，两个独立仓库不互相导入源码。当前两个项目固定同版本 `ai` 与 `zod`；变更契约需要同步生成副本并分别运行检查。v1 中真实简历、文章和导读结果的 `simulated` 为 `false`，Mock 为 `true`；Demo 与联系表单仍为 `true`。升级后端时必须同步前端契约，否则旧版前端会拒绝真实结果。

文章信息从博客的 `catalog.ts` 和静态 HTML 派生。后端不另行维护标题、路由或发布状态。知识文件是可部署数据快照，导入后运行时不依赖博客源码或博客目录。

## 检查与扩展

```sh
npm run check
```

包含环境、零警告 lint、类型检查、接口/协议测试和生产编译。测试覆盖非法请求、CORS、正文命中、UTF-8 单字节断包、工具状态、脑图结构、取消、联系幂等及 Node 真实 HTTP。`.github/workflows/check.yml` 在推送后执行相同检查。

`src/app.ts` 装配 HTTP 与模式选择；`src/llm.ts` 实现真实模型与工具；`src/mock.ts` 提供离线演示；`src/stream.ts` 处理流、取消及错误脱敏；`src/knowledge.ts` 查询知识快照；`src/contracts.ts` 定义边界。测试同时覆盖兼容接口请求、工具循环、输入预算、模型错误、取消与并发释放。
