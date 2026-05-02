# 腾讯云后端部署

这套配置用于把糖友 Node 后端部署到腾讯云 CVM。H5 仍然可以放在 GitHub Pages，后端提供真实 MiniMax 识图、MiniMax TTS 和登录注册。

## 服务器要求

- 腾讯云 CVM，Ubuntu 22.04/24.04 推荐
- 安全组打开 `22`、`80`、`443`
- 一个域名，例如 `api.example.com`，A 记录指向 CVM 公网 IP

如果 CVM 在中国大陆地域，域名走 `80/443` 对外服务通常需要完成备案。没备案时，用香港地域或已有可用域名会更省事。

## 首次部署

登录服务器：

```bash
ssh ubuntu@你的服务器公网IP
```

安装 Docker：

```bash
sudo mkdir -p /opt/tangyou
sudo chown "$USER:$USER" /opt/tangyou
git clone https://github.com/Viiiiic/tangyou.git /opt/tangyou
cd /opt/tangyou/deploy/tencent-cloud
./setup-ubuntu.sh
```

创建服务器环境变量文件：

```bash
cp .env.example .env
nano .env
```

至少填这几项：

```bash
DOMAIN=api.example.com
ALLOWED_ORIGINS=https://viiiiic.github.io,http://localhost:4173
MINIMAX_API_KEY=你的 MiniMax key
EXPERT_ADVISOR_MODE=minimax
MINIMAX_EXPERT_MODEL=MiniMax-M2.7-highspeed
AUTH_INVITE_CODE=只发给家人的邀请码
```

启动后端：

```bash
sudo docker compose up -d --build
```

验证：

```bash
curl https://你的后端域名/api/health
```

看到 `ok:true`、`vision.configured:true`、`expert.configured:true`、`tts.configured:true`、`auth.required:true` 才算生产后端接好了。

## H5 打开方式

后端可用后，外网 H5 用这个地址打开：

```text
https://viiiiic.github.io/tangyou/?api=https://你的后端域名
```

第一次使用需要邀请码注册。之后用称呼和密码登录。

## 更新部署

本地提交推送后，在服务器上执行：

```bash
cd /opt/tangyou
git pull
cd deploy/tencent-cloud
sudo docker compose up -d --build
```

也可以从本机执行：

```bash
SERVER=ubuntu@你的服务器公网IP ./deploy/tencent-cloud/deploy.sh
```

这个脚本不会上传 `.env`，MiniMax key 只保留在服务器。

## 常用排查

```bash
cd /opt/tangyou/deploy/tencent-cloud
sudo docker compose ps
sudo docker compose logs -f app
sudo docker compose logs -f caddy
curl http://127.0.0.1:4173/api/health
```

如果 HTTPS 证书没有下来，先确认域名 A 记录已经指向这台 CVM，并且腾讯云安全组放行了 `80` 和 `443`。
