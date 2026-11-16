# 架构

前端静态博客与本仓库独立部署，开发时由 Vite 代理 `/api`。生产前端通过 `VITE_API_BASE_URL` 指向本服务；后端 `ALLOWED_ORIGINS` 设置实际前端来源。

来源校验与 CORS 共用 `origins.ts`。development 模式允许精确的 localhost、IPv4/IPv6 回环主机使用任意 HTTP/HTTPS 端口，适应 Vite 自动换端口；production/test 仅匹配配置白名单。代理保留浏览器 Origin，不通过剥离或伪造 Origin 绕过后端校验。

所有聊天响应使用 AI SDK UI Message Stream（SSE、协议 v1），由 SDK 负责编码与客户端解析。文本采用 start/delta/end，工具采用 input/output，文章导读采用 data-progress/data-insight。工具结果是经过限定的数据，不能提供任意组件、HTML、模块导入或文件路径。

`AI_MODE=mock` 保留离线规则实现；`AI_MODE=live` 使用百炼兼容接口，由 `llm.ts` 通过 AI SDK 驱动真实文本、多轮上下文和服务端工具。配置名称、默认端点与 qwen-plus 模型沿用 askLOL-serve，关闭 thinking。四个工具只读取已校验的公开数据或返回固定 UI 数据，不执行客户端历史工具结果。检索仍为关键词匹配；Demo 是预设文件，联系表单不投递。

真实导读通过 JSON mode 生成 points/nodes，再进行字段与脑图树校验；文章路径、内容版本和来源只由服务端提供。聊天元数据、简历、推荐和导读的 simulated 标记区分真实/Mock；Demo 和联系表单始终标记为模拟。前端生成契约必须同步。

输入文本历史、检索结果和文章正文有字符预算；模型每步输出有 Token 上限，每次请求最多三步、一个总超时，不自动重试。app.ts 维护进程内并发模型流上限，stream.ts 在完成、出错或取消时释放；取消信号传给模型请求。模型故障返回脱敏 SSE 错误，不回退模拟内容。持久化请求限流、身份认证和全局费用控制仍由后续网关/存储层提供。

知识与公开简历在启动时读取并校验。知识版本由博客导出的内容哈希决定。文章状态在导出端过滤，服务端只接收发布文章快照。来源路由和章节锚点由静态正文提供。当前没有共享缓存或数据库；规模增长后优先为数据访问、限流和长任务增加接口，再决定持久化与工作队列。

流由消费者拉取，取消会关闭生产器；Node 适配器处理 HTTP 与 Web Response 的转换。端口绑定、进程信号和优雅关闭集中于 `server.ts`，便于后续添加部署适配。测试用内存应用、单字节流和真实 HTTP 分别检查业务边界与协议行为。
