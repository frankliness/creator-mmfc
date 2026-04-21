# MMFC Studio Canvas Docker 部署指南

## 快速开始

### 本地构建并启动

```bash
# 1. 构建 Docker 镜像
docker build -t mmfc-studio-canvas .

# 2. 运行容器
docker run -d -p 8080:80 --name mmfc-studio-canvas mmfc-studio-canvas
```

访问：[http://localhost:8080](http://localhost:8080)

## 常用命令

```bash
# 停止容器
docker stop mmfc-studio-canvas

# 启动容器
docker start mmfc-studio-canvas

# 删除容器
docker rm mmfc-studio-canvas

# 查看日志
docker logs mmfc-studio-canvas

# 进入容器
docker exec -it mmfc-studio-canvas sh
```

## 配置说明

### 端口映射

默认映射 `8080:80`，可修改宿主机端口：

```bash
docker run -d -p 3000:80 --name mmfc-studio-canvas mmfc-studio-canvas
```

### Nginx 配置

- 静态文件路径：`/usr/share/nginx/html`
- 路由模式：根路径 `/` 下的 SPA history fallback
- API 调用方式：浏览器直接请求 Google 官方 Gemini API，不经过 Nginx 代理
- Gzip 压缩：已启用
- 构建方式：Docker 多阶段构建，容器内自动执行 `pnpm build`

## 注意事项

1. 公开部署时不建议把 Google API Key 长期暴露在前端，生产环境更推荐加自建后端代理。
2. 默认访问根路径 `/`，不再使用旧版 `/huobao-canvas` 子路径。
3. 避免使用浏览器屏蔽的端口，例如 `6666`、`6667`、`6668`。
