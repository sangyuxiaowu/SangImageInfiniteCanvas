# Sang Image 创意画板

基于 React、Vite 和 Express 的无限画布式 AI 图像工作台。通过节点、连线和画布布局组织文本生图、参考图生图与局部重绘流程，并将项目与图片资产保存在浏览器本地。

## 功能

- 多项目画布：创建、切换、删除项目，自动保存节点、连线与视图位置。
- 文本生图：支持提示词、尺寸、模型、质量和一次生成多张图片。
- 参考图生图：上传图片或粘贴剪贴板图片，将图片节点连接至生图节点。
- 局部编辑：在编辑节点中基于原图和蒙版调用图像编辑接口。
- 节点工作流：可添加文本、图片、生图与编辑节点，通过连线组织输入和输出关系。
- 接入点管理：可为不同 OpenAI 兼容服务配置名称、Base URL、API Key 与模型列表，并指定默认接入点。
- 本地资产管理：生成图、上传图和蒙版保存至 IndexedDB；项目配置与画布状态保存至 LocalStorage。

## 技术栈

- React 19 + TypeScript
- Vite + Tailwind CSS
- Express
- OpenAI 兼容 Images API

## 环境要求

- Node.js 18 或更高版本（需要内置 `fetch`、`Blob` 与 `FormData`）。
- 一个支持 `/images/generations` 和 `/images/edits` 的 OpenAI 兼容图像服务。

## 快速开始

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

服务默认监听 `http://localhost:3000`。开发环境下 Express 会挂载 Vite 中间件，前端和 API 由同一个地址提供。

## 配置图像服务

应用从以下位置按优先级获取 API 配置：

1. 当前节点选中接入点的浏览器设置。
2. 服务端环境变量。
3. 默认 Base URL：`https://api.openai.com/v1`。

### 方式一：在界面中配置

进入首页的“设置”，添加或编辑接入点：

- 接入点名称：用于画布和节点中的识别。
- Base URL：例如 `https://api.openai.com/v1`，末尾斜杠会被自动处理。
- API Key：调用上游服务所需的密钥。
- 模型列表：用英文逗号分隔，例如 `gpt-image-2, gpt-image-1`。

界面配置仅保存在当前浏览器的 LocalStorage，并会在请求时以 `x-api-key` 和 `x-base-url` 传给本地服务端。

### 方式二：使用环境变量

在项目根目录创建 `.env`：

```dotenv
GPT_IMAGE_API_KEY=your_api_key
GPT_IMAGE_BASE_URL=https://api.openai.com/v1
```

环境变量适合本地开发和部署环境。不要将包含真实密钥的 `.env` 提交到版本控制系统。

## 画布使用

1. 在首页新建或打开一个项目。
2. 使用底部工具栏添加生图、修改、文本或参考图节点；也可以在空白画布双击添加生图节点。
3. 从文本或独立图片节点的连接控制点拖到生图或编辑节点，建立输入关系。
4. 在节点内选择接入点、模型、尺寸和数量，填写提示词后提交生成或编辑任务。
5. 生成结果会以图片节点形式出现在源节点右侧，并自动建立连线。

常用操作：

| 操作 | 快捷方式 |
| --- | --- |
| 选择工具 | `V` |
| 抓手工具 | `H` |
| 临时平移 | 按住 `Space` 并拖拽 |
| 缩放画布 | 鼠标滚轮或触控板缩放手势 |
| 重置视角 | `R` |
| 新建生图节点 | 双击空白画布 |

## 数据与隐私

- 项目、节点、连线和接入点配置保存在 LocalStorage。
- 图片与蒙版二进制数据保存在 IndexedDB；资产管理页面可查看和删除图片资产。
- 清除浏览器站点数据会删除本地项目、配置与资产。
- 在界面中填写的 API Key 会保存在该浏览器的 LocalStorage。多人共用设备时，建议改用服务端环境变量并避免在界面保存密钥。

## API 路由

本地 Express 服务提供以下路由：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/generate` | 文本生图或带参考图的图像生成 |
| `POST` | `/api/edit` | 基于原图与可选蒙版的局部编辑 |
| `GET` | `/api/proxy-image?url=...` | 代理远程图片，供画布与蒙版处理使用 |

请求最大负载为 50 MB，图像生成与编辑的上游超时时间为 10 分钟。服务端会对日志中的图片数据与 URL 做截断处理，但仍会输出请求参数和上游响应状态；生产环境应妥善管理日志访问权限。

## 构建与部署

执行生产构建：

```bash
npm run build
```

该命令将 Vite 前端输出到 `dist/`，并将 Express 服务端打包为 `dist/server.cjs`。使用以下命令启动：

```bash
npm start
```

生产环境同样固定监听 3000 端口，并由 Express 托管 `dist/` 中的单页应用静态文件。

## 开发命令

```bash
npm run dev    # 启动本地开发服务
npm run lint   # 执行 TypeScript 类型检查
npm run build  # 构建前端与服务端
npm start      # 启动生产构建产物
```


## 参考资料

- [Azure OpenAI Image Generations / Edits API](https://learn.microsoft.com/en-us/azure/foundry/openai/reference-preview#image-generations---edit)
- [Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/azure-openai/)