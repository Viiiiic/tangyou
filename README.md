# 糖友原型

这是一个可运行原型，用来验证“老人饭前自己拍一下，得到一句能执行的话”的最小流程。

## 打开方式

启动本地后端：

```bash
npm start
```

然后打开：

`http://localhost:4173`

如果直接打开 `/Users/vic/older/index.html`，页面不会走后端接口，也不会伪造饭菜识别结果。

## H5 发布到 GitHub Pages

这个项目可以发布成 GitHub Pages H5 页面。GitHub Pages 只能托管静态前端，不能保存 MiniMax key，也不能运行 `server.js`。

首次发布：

```bash
gh auth login
gh repo create tangyou --public --source=. --remote=origin --push
gh api -X POST repos/{owner}/{repo}/pages -f build_type=workflow
```

推送后，`.github/workflows/pages.yml` 会把 `index.html`、`app.js`、`styles.css` 和 `assets/` 发布为 H5 页面。

真实识别需要把 Node 后端单独部署到一个 HTTPS 地址，然后用下面的方式让 H5 连接后端：

`https://你的用户名.github.io/你的仓库名/?api=https://你的后端域名`

后端部署时至少需要这些环境变量：

```bash
VISION_PROVIDER=minimax
MINIMAX_REGION=cn
MINIMAX_API_KEY="你的 MiniMax Token Plan key"
EXPERT_ADVISOR_MODE=minimax
MINIMAX_EXPERT_MODEL=MiniMax-M2.7-highspeed
TTS_MODE=minimax
MINIMAX_VOICE_ID="Chinese (Mandarin)_Kind-hearted_Antie"
MINIMAX_TTS_SPEED="1.15"
ALLOWED_ORIGINS="https://你的用户名.github.io"
AUTH_REQUIRED=1
AUTH_INVITE_CODE="给家人或内部用户的邀请码"
AUTH_TOKEN_TTL_DAYS=30
```

如果使用腾讯云 CVM，项目里已经放好 Docker + Caddy 部署模板：

```bash
deploy/tencent-cloud/README.md
```

后端上线并通过健康检查后，外网 H5 用这个格式打开：

`https://viiiiic.github.io/tangyou/?api=https://你的后端域名`

如果只打开 GitHub Pages H5 而没有配置后端，页面会保守提示“识别没连上”，不会假装识别成功。

## 已覆盖流程

- 打开后直接进入拍照页
- 拍照页使用 AI 生成的取景示意图，点击示意图或“饭前拍一下”打开系统相机/相册
- 选好照片后上传到本地后端，创建 scan job 并轮询结果
- 结果页先显示识别到的食物，再显示糖尿病饮食风险判断
- 普通上传在没有真实视觉模型时会保守返回 `识别未接入`，不会伪造黄绿红判断
- 显式 demo 模式支持四种测试场景：yellow、gray、green、red
- 配置 MiniMax CLI 和 `MINIMAX_API_KEY` 后，后端会调用 MiniMax 视觉能力解析饭菜，再由本地规则和糖尿病饮食专家模型共同判断四态结果
- 可选简单鉴权：设置 `AUTH_REQUIRED=1` 和 `AUTH_INVITE_CODE` 后，用户需要邀请码注册并登录，才能调用识图接口
- 后端确定性规则输出四态结果：按平时量、米饭少半碗、先别吃、照片没拍清
- 配置 `MINIMAX_API_KEY` 后默认使用 MiniMax TTS；没有 key 时才退回浏览器朗读
- 四态大字结果：按平时量、米饭少半碗、先别吃、照片没拍清
- 本地 PNG 取景图，离线打开也能看到首屏引导

## TTS 配置

没有 MiniMax key 时的浏览器兜底模式：

```bash
export TTS_MODE=browser
npm start
```

可选好听声音模式：

```bash
npm install
export TTS_MODE=minimax
export MINIMAX_API_KEY="你的 key"
export MINIMAX_VOICE_ID="Chinese (Mandarin)_Kind-hearted_Antie"
export MINIMAX_TTS_MODEL="speech-2.8-hd"
export MINIMAX_TTS_SPEED="1.15"
npm start
```

MiniMax 模式会使用项目内 `mmx-cli` 的 `speech synthesize` 生成音频；如果 CLI 不可用，再退回 HTTP TTS。生成的音频会缓存在 `storage/tts/`。如果设置了 `MINIMAX_API_KEY` 且没有显式设置 `TTS_MODE=browser`，默认会走 MiniMax。

## 真实饭菜识别配置（MiniMax）

```bash
npm install
export VISION_PROVIDER=minimax
export MINIMAX_API_KEY="你的 MiniMax Token Plan key"
npm start
```

项目内已经依赖 `mmx-cli`。如果你想指定自己的 `mmx`，可以额外设置：

```bash
export MINIMAX_CLI_BIN="/path/to/mmx"
```

没有 MiniMax key 或没有安装 `mmx` 时，普通上传会显示“识别未接入”，不会伪造识别结果。

## 糖尿病饮食专家模型配置

后端先让视觉模型只输出结构化食材和份量，再由本地确定性规则做保守判断，最后调用 MiniMax 文本模型做糖尿病饮食专家复核。专家模型可以把判断变得更严格，但不能把本地红色/黄色判断降级成绿色。

默认模型为 `MiniMax-M2.7-highspeed`：

```bash
export EXPERT_ADVISOR_MODE=minimax
export MINIMAX_EXPERT_MODEL="MiniMax-M2.7-highspeed"
export MINIMAX_API_KEY="你的 MiniMax Token Plan key"
npm start
```

如果专家模型超时或接口失败，后端会自动退回本地规则。话术会尽量使用老人能执行的份量，例如“主食吃三分之一碗”“主食最多一拳头”“糯米点心尝两三口”，不再使用“少量吃”这种模糊表述。

## 音色复刻准备（MiniMax Voice Clone）

MiniMax 音色快速复刻流程：

1. 上传待复刻音频到 `POST https://api.minimaxi.com/v1/files/upload`，`purpose=voice_clone`，音频格式 `mp3/m4a/wav`，时长 10 秒到 5 分钟，大小不超过 20MB。
2. 可选上传示例音频到同一个上传接口，`purpose=prompt_audio`，示例音频小于 8 秒，用来增强相似度和稳定性。
3. 调用 `POST https://api.minimaxi.com/v1/voice_clone`，传入 `file_id`、自定义 `voice_id`、可选 `clone_prompt`、试听文本 `text` 和模型 `speech-2.8-hd`。
4. 复刻成功后，把得到的 `voice_id` 配到 `MINIMAX_VOICE_ID`，后续 TTS 就会使用你的声音。

项目内有一个本地脚本可执行以上流程。它会把声音样本上传到 MiniMax，必须先确认声音本人同意：

```bash
MINIMAX_API_KEY="你的 key" npm run voice:clone -- \
  --consent \
  --audio /path/to/your-voice.wav \
  --voice-id TangyouDadVoice001
```

如果要加一个 8 秒以内的示例音频来稳定语气：

```bash
MINIMAX_API_KEY="你的 key" npm run voice:clone -- \
  --consent \
  --audio /path/to/your-voice.wav \
  --prompt-audio /path/to/prompt.wav \
  --prompt-text "爸妈，先吃菜肉，主食就吃三分之一碗。" \
  --voice-id TangyouDadVoice001
```

脚本成功后会输出 `MINIMAX_VOICE_ID=...`，把这个值放进后端环境变量后重启即可。

注意：

- 复刻声音属于敏感生物特征数据，只有在本人同意且明确用途时才上传。
- 复刻得到的音色如果 7 天内没有正式调用语音合成接口，MiniMax 会删除该音色。
- `voice_id` 必须 8-256 位，首字符是英文字母，只能包含数字、字母、`-`、`_`，末尾不能是 `-` 或 `_`。

## 简单登录配置

外网部署后建议打开鉴权，避免陌生人调用你的 MiniMax 后端：

```bash
export AUTH_REQUIRED=1
export AUTH_INVITE_CODE="只发给家人的邀请码"
export AUTH_TOKEN_TTL_DAYS=30
npm start
```

用户第一次用邀请码注册，之后用称呼和密码登录。账号和会话保存在 `storage/users.json`、`storage/sessions.json`。

可选备用 provider：

```bash
export VISION_PROVIDER=openai
export OPENAI_API_KEY="你的 OpenAI API key"
export OPENAI_VISION_MODEL="gpt-4.1-mini"
npm start
```

## 验收方式

- 普通流程：打开 `http://localhost:4173`，选择任意图片。配置 MiniMax 后会走真实识图；未配置时会保守返回“识别未接入”。
- UI 演示态只在后端设置 `ALLOW_DEMO_SCENARIOS=1` 后可用；普通 H5 上传不再传 demo 场景参数。
- 健康检查：`curl http://localhost:4173/api/health`
- 规则测试：`npm test`

## 已删掉

- 家人设置页
- 最近记录页
- 饭菜纠错页
- “我看到了 / 为什么这样说”
- 等待页手动选择
- 首页中转页

## 下一步

1. 找 3-5 位老人或老人代理用户试用原型。
2. 记录是否能独立完成：打开、拍照、听结果、再拍一张。
3. 再决定是否迁到微信小程序 WXML/WXSS/JS。
