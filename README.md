# jayzou-api

Jay 数字会客厅的独立 Node.js 后端，与 `jayzou.me` 前端仓库分别维护和部署。

Node.js 22.22.2、npm 10.9.7、TypeScript strict、Hono、Zod、Vercel AI SDK 7。当前只支持 Mock 模式，不需要模型密钥，不调用模型或 Webhook。

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

生产运行：`npm run build` 后执行 `npm start`。数据库、真实模型、身份认证、持久化限流和通知投递尚未接入，不能把当前 Mock 服务作为真实 AI 服务交付。会话由前端标签页保存；联系表单仅模拟提交，幂等记录仅在本进程保存 5 分钟。

## 接口

| 接口 | 行为 |
| --- | --- |
| `GET /health` | 模式、协议版本、知识版本和文章数量 |
| `GET /api/articles?q=闭包` | 标题、摘要、章节与正文关键词检索 |
| `POST /api/chat` | AI SDK UI Message Stream SSE；支持简历、推荐文章、预设 Demo 和联系表单工具 |
| `POST /api/articles/insights` | 接收 `articlePath`，返回进度及经 Zod 校验的原文摘录和章节树 |
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

前端文件为生成副本，两个独立仓库不互相导入源码。当前两个项目固定同版本 `ai` 与 `zod`；变更契约需要同步生成副本并分别运行检查。

文章信息从博客的 `catalog.ts` 和静态 HTML 派生。后端不另行维护标题、路由或发布状态。知识文件是可部署数据快照，导入后运行时不依赖博客源码或博客目录。

## 检查与扩展

```sh
npm run check
```

包含环境、零警告 lint、类型检查、接口/协议测试和生产编译。测试覆盖非法请求、CORS、正文命中、UTF-8 单字节断包、工具状态、脑图结构、取消、联系幂等及 Node 真实 HTTP。`.github/workflows/check.yml` 在推送后执行相同检查。

`src/app.ts` 只装配 HTTP；`src/mock.ts` 产生协议事件；`src/knowledge.ts` 查询知识快照；`src/contracts.ts` 定义边界。真实模型接入时保留 HTTP 契约，将规则分支替换为模型与工具执行服务，并补充 Token 预算、持久化限流、费用控制和评估。API 密钥仅保存在服务端环境变量中。
