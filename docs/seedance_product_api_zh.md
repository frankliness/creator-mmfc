# 产品文档 + API 文档（中文整理版）

---

# 产品文档

## 【填写客户名称用于权限申请】视频模型定向白名单邀请测试

本文是面向相关客户的一份视频模型定向白名单邀请测试邀请函，介绍了模型、提交流程、模型能力、定价，以及 API 文档等内容。

文档权限受限。请仅分发给相关客户，客户名单以 Muxi Li 的通知为准。

【！！！】本文件仅用于客户权限申请。只有已回传签署版服务协议的客户才有资格申请。

我们非常荣幸邀请您测试我们最新的视频生成模型。本邀请中提供 API 白名单的模型为：**Seedance 2.0** 和 **Seedance 2.0 fast**。

- Seedance 2.0：白名单开通后可立即使用
- Seedance 2.0 fast：白名单开通后可立即使用

所有受邀客户需注意以下事项：

1. 法律条款
2. 最低保底协议
3. 调研问卷
4. API 文档（见下）
5. 模型定价（见下）

### 提交流程：

1. 客户信息提交：申请客户提报
2. 请客户签字并盖章客户调研问卷、服务协议和最低保底协议（见：Client Agreement Collection）
3. 盖章后回传电子版，并发起白名单 OA：https://applink.larkoffice.com/T93UvXRAgCQH
4. 协议审批通过并收到预付款后，Ark 将处理白名单。

# 1. Seedance 2.0 基础能力介绍

## 1.1 模型能力

Seedance-2.0 是由 Seed Model Team 开发的新一代专业级多模态视频生成模型。它支持包括图像、视频和音频在内的多模态素材引用，并具备智能视频编辑和续写能力，将视频生成工具带入一个**精准生成、可复用迭代**的全新产业阶段。

该模型对物理规律有更深的理解，并且更贴近现实世界。其意图理解能力已显著提升，并严格遵循细粒度指令约束，以确保专业级叙事的可靠性。

### 详细文档介绍：

英文版：

- 【WIP】Dreamina-Seedance-2.0 Enterprise Use Case Guide
- 【External】20260305 Seedance 2.0 Brochure.pdf

Chinese Volcengine Version for reference：

- 【对客】Doubao-Seedance-2.0：企业级业务场景指南
- 【对客】豆包视频生成模型 Doubao-Seedance-2.0.pdf

# 3. API Documentation

This document is currently **for whitelisted clients only**. Please confirm with the Sales Administration whether the client is on the whitelist before sending.

【！！！】Access to this document is restricted. **Only clients who have submitted the signed service agreement are eligible to apply.**

- 【Customer name required in application form】Seedance 2.0 & 2.0 fast API Documentation (for invited users only)

# 4. How to customize the virtual portrait library.

- 【⚠Confidential】【Customer name required】Assets API reference (Invited users only)
- 【⚠Confidential】【Customer name required】Private digital asset library (Invited users only)

---

# API 文档

## 【申请表中需填写客户名称】Dreamina Seedance 2.0 & 2.0 fast API 文档（仅供受邀用户）

本文档提供 Dreamina Seedance 2.0 & 2.0 fast API 文档，包括模型能力、API 细节、代码示例，以及使用数字人的教程等。

本文件当前仅对白名单客户开放。发送前，请先与销售管理团队确认客户是否在白名单内。

【注意】在客户提交签署版服务协议之前，不允许客户申请访问本文档。

本文档聚焦于 Dreamina Seedance 2.0 & 2.0 fast 模型中**新增加**或**与现有模型配置不同**的 API 参数。现有 API 参数的完整说明，请参见 Video Generation API。

⚠️ 本文档仅供预览和受邀测试用户使用：

- 我们**不保证**其在正式 API 上线时与当前版本 100% 一致。
- 仅供受邀测试用户使用。**请勿截图或与他人分享。**
- 请确保你上传的内容为原创，或你已获得使用授权。

# 01 模型能力

Dreamina Seedance 2.0 和 Dreamina Seedance 2.0 fast 提供相同的模型能力。若追求最高生成质量，推荐使用 Dreamina Seedance 2.0。若你更看重成本和生成速度而非极致质量，推荐使用 Dreamina Seedance 2.0 fast。

Dreamina Seedance 2.0 & 2.0 fast（有声视频 / 静音视频）

- **多模态参考生成视频**：输入 0–9 张参考图、0–3 个参考视频、0–3 个参考音频，以及可选文本提示词，生成 1 个目标视频。支持生成新视频、编辑视频和续写视频。

⚠️ 你不能只输入音频。至少必须包含 1 个参考视频或图像。

- **图生视频（首帧 + 尾帧）**：输入首帧图、尾帧图，以及可选文本提示词，生成 1 个目标视频。
- **图生视频（首帧）**：输入首帧图，以及可选文本提示词，生成 1 个目标视频。
- **文生视频**：输入文本提示词，生成 1 个目标视频。

## 模型能力对比

| 模型名称 | Dreamina Seedance 2.0 | Dreamina Seedance 2.0 fast | Seedance 1.5 pro | Seedance 1.0 pro | Seedance 1.0 pro fast | Seedance 1.0 lite i2v | Seedance-1.0 lite t2v |
|---|---|---|---|---|---|---|---|
| 模型 ID | dreamina-seedance-2-0-260128 | dreamina-seedance-2-0-fast-260128 | seedance-1-5-pro-251215 | seedance-1-0-pro-250528 | seedance-1-0-pro-fast-251015 | seedance-1-0-lite-i2v-250428 | seedance-1-0-lite-t2v-250428 |
| 文生视频 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 图生视频（首帧） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 图生视频（首帧 + 尾帧） | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| 多模态参考 - 图像参考 | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| 多模态参考 - 视频参考 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 多模态参考 - 组合参考（图像+音频 / 图像+视频 / 视频+音频 / 图像+视频+音频） | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 编辑视频 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 续写视频 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 生成有声音频视频 | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Sample mode | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 返回最后一帧 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 输出视频规格 - 分辨率 | 480p, 720p | 480p, 720p | 480p, 720p, 1080p | 480p, 720p, 1080p | 480p, 720p, 1080p | 480p, 720p, 1080p | 480p, 720p, 1080p |
| 输出视频规格 - 宽高比 | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 |
| 输出视频规格 - 时长（秒） | 4–15 | 4–12 | 4–12 | 2–12 | 2–12 | 2–12 | 2–12 |
| 输出视频规格 - 格式 | mp4 | mp4 | mp4 | mp4 | mp4 | mp4 | mp4 |
| 离线推理 | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 在线推理速率限制 - RPM | 600 | 600 | 600 | 600 | 600 | 300 | 300 |
| 在线推理速率限制 - 并发 | 10 | 10 | 10 | 10 | 10 | 5 | 5 |
| 离线推理速率限制 - TPD | - | - | 500 billion | 500 billion | 500 billion | 250 billion | 250 billion |

# 02 API

## 2.1 创建

### 创建一个视频生成任务

`POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks`

### 请求参数

#### `content` `object[]` 必填

用于向模型提供视频生成信息。支持的媒体包括文本、图像和 sample video。支持的组合如下：

- 仅文本
- 文本（可选）+ 图像
- 文本（可选）+ 视频
- 文本（可选）+ 图像 + 音频
- 文本（可选）+ 图像 + 视频
- 文本（可选）+ 视频 + 音频
- 文本（可选）+ 图像 + 视频 + 音频

#### 信息类型：

##### 文本信息 `object`

向模型输入的文本信息。

- `content.type` `string` 必填  
  输入内容的类型。在此场景下，将值设为 `text`。
- `content.text` `string` 必填  
  输入给模型的文本提示词，用于描述期望生成的视频。  
  建议将提示词控制在 1000 词以内。过长的文本会导致信息发散，模型可能忽略细节，仅聚焦关键点，从而造成生成视频元素缺失。关于提示词的更多技巧，参见 Seedance prompt guide。

##### 图像信息 `object`

向模型输入的图像信息。

- `content.type` `string` 必填  
  输入内容的类型。在此场景下，将值设为 `image_url`。
- `content.image_url` `object` 必填  
  输入给模型的图像对象。
- `content.image_url.url` `string` 必填  
  图像 URL、图像 Base64 字符串或资产 ID。
  - 图像 URL：输入图像的公网 URL。
  - Base64 字符串：将本地文件转换为 Base64 编码字符串并传给大模型。格式为：`data:image/<image format>;base64,<Base64 string>`。注意 `<image format>` 必须为小写，例如 `data:image/png;base64,{base64_image}`。
  - 资产 ID：用于视频生成的预配置资产和数字角色 ID，格式为：`asset://<ASSET_ID>`。可从 Elements & Digital Characters Library 获取。详细用法参见 Digital characters library。

**单张上传图像要求**

- 格式：jpeg, png, webp, bmp, tiff, gif
- 宽高比（宽/高）：(0.4, 2.5)
- 宽和高（像素）：(300, 6000)
- 大小：单张图像必须小于 30 MB。请求体大小不得超过 64 MB。大文件不要使用 Base64 编码。
- 图像数量：
  - 图生视频（首帧）：1 张图
  - 图生视频（首帧 + 尾帧）：2 张图
  - Dreamina Seedance 2.0 & 2.0 fast 多模态参考视频生成：1–9 张图

- `content.role` `string` 在特定条件下必填  
  图像的位置或用途。

⚠️ 图生视频（首帧）、图生视频（首帧 + 尾帧）以及多模态参考视频生成（包括参考图、参考视频、参考音频）这三种场景互斥，不能同时使用。

- 对于多模态参考视频生成，你可以通过提示词将参考图指定为首帧/尾帧，从而间接实现“首尾帧 + 多模态参考”。如果你需要严格确保首帧和尾帧与指定图像一致，请始终使用图生视频首/尾帧功能（将 `role` 参数配置为 `first_frame` / `last_frame`）。

###### 图生视频（首帧）

需要传入 1 个 `image_url` 对象。

`role` 参数可取值：

- `first_frame`，或留空

###### 图生视频（首帧 + 尾帧）

需要传入 2 个 `image_url` 对象。

`role` 参数可取值：

- 首帧图像的 `role` 参数为 `first_frame`（必填）
- 尾帧图像的 `role` 参数为 `last_frame`（必填）

###### 图生视频（参考图）

可以传入 1–9 个 `image_url` 对象。

`role` 参数可取值：

- 每个参考图的 `role` 参数为 `reference_image`（必填）

##### 视频信息 `object`

向模型输入的视频信息。**只有 Dreamina Seedance 2.0 & 2.0 fast 支持视频输入。**

- `content.type` `string` 必填  
  输入内容的类型。在此场景下，将值设为 `video_url`。
- `content.video_url` `object` 必填  
  输入给模型的视频对象。
- `content.video_url.url` `string` 必填  
  视频 URL 或资产 ID。
  - 视频 URL：输入视频的公网 URL。
  - 资产 ID：用于视频生成的预配置资产和数字角色 ID，格式为：`asset://<ASSET_ID>`。可从 Elements & Digital Characters Library 获取。

**单个上传视频要求**

- 视频格式：mp4, mov
- 分辨率：480p, 720p
- 时长：单个视频时长为 2 到 15 秒。最多可上传 3 个参考视频，且所有视频总时长不得超过 15 秒。
- 尺寸：
  - 宽高比（宽/高）：[0.4, 2.5]
  - 宽和高（像素）：[300, 6000]
  - 帧像素（宽 × 高）：[409600, 927408]，例如：
    - 帧大小 640×640=409600，满足最小要求；
    - 帧大小 834×1112=927408，满足最大要求。
- 大小：单个视频必须小于 50 MB。
- 帧率（FPS）：[24, 60]

- `content.role` `string` 在特定条件下必填  
  视频的位置或用途。目前仅支持 `reference_video`。

##### 音频信息 `object`

向模型输入的音频信息。**只有 Dreamina Seedance 2.0 & 2.0 fast 支持音频输入。**

⚠️ 你不能只输入音频。至少必须包含 1 个参考视频或图像。

- `content.type` `string` 必填  
  输入内容的类型。在此场景下，将值设为 `audio_url`。
- `content.audio_url` `object` 必填  
  输入给模型的音频对象。
- `content.audio_url.url` `string` 必填  
  音频 URL、音频 Base64 字符串或资产 ID。
  - 音频 URL：输入音频的公网 URL。
  - Base64 字符串：将本地文件转换为 Base64 编码字符串并传给大模型。格式为：`data:audio/<audio format>;base64,<Base64 string>`。注意 `<audio format>` 必须为小写，例如 `data:audio/wav;base64,{base64_audio}`。
  - 资产 ID：用于视频生成的音频资产和数字角色的音频资产 ID，格式为：`asset://<ASSET_ID>`。可从 Elements & Digital Characters Library 获取。

**单个上传音频要求**

- 格式：wav, mp3
- 时长：单个音频时长为 2 到 15 秒。最多可上传 3 个参考音频，且所有音频总时长不得超过 15 秒。
- 大小：单个音频必须小于 15 MB。请求体大小不得超过 64 MB。大文件不要使用 Base64 编码。

- `content.role` `string` 在特定条件下必填  
  音频的位置或用途。目前仅支持 `reference_audio`。

#### `service_tier` `string`

目前 Dreamina Seedance 2.0 & 2.0 fast 不支持。

#### `generate_audio` `boolean`

Dreamina Seedance 2.0 & 2.0 fast 默认值：`true`

用于控制生成的视频是否包含与画面同步的声音。

- `true`：模型输出的视频包含同步音频。模型会根据文本提示词和视觉内容自动生成匹配的人声、音效和背景音乐。建议将对白内容放入双引号中，以优化音频生成效果。例如：The man stopped the woman and said: "Remember, you can't point at the moon with your finger in the future."

> 所有带音频的生成视频均为单声道，无论输入音频的声道数是多少。

- `false`：模型输出的视频为静音视频。

#### `draft` `boolean`

目前 Dreamina Seedance 2.0 & 2.0 fast 不支持。

#### `resolution` `string`

Dreamina Seedance 2.0 & 2.0 fast 默认值：`720p`

视频分辨率，可选值：

- `480p`
- `720p`

#### `ratio` `string`

Dreamina Seedance 2.0 & 2.0 fast 默认值：`adaptive`

生成视频的宽高比。不同宽高比对应的宽高像素值如下表所示。

可选值：

- `16:9`
- `4:3`
- `1:1`
- `3:4`
- `9:16`
- `21:9`
- `adaptive`：根据输入自动选择最合适的宽高比

**自适应规则**

当 `ratio` 设为 `adaptive` 时，模型会根据生成场景自动适配宽高比。实际生成视频的宽高比可以从 Retrieve a video generation task API 返回的 `ratio` 参数中获得。

- 文生视频：根据输入提示词智能选择最合适的宽高比。
- 首帧 / 首尾帧图生视频：根据上传首帧图像的比例自动选择最接近的宽高比。
- 多模态参考视频生成：根据用户提示词的意图判断。如果是首帧视频生成 / 视频编辑 / 视频续写，则根据对应图像 / 视频选择最接近的宽高比；否则，根据首个上传媒体文件选择最接近的宽高比（优先级：视频 > 图像）。

**不同宽高比对应的宽高像素值**

| 分辨率 | 宽高比 | 尺寸（宽 × 高） |
|---|---|---|
| 480p | 16:9 | 864×496 |
| 480p | 4:3 | 752×560 |
| 480p | 1:1 | 640×640 |
| 480p | 3:4 | 560×752 |
| 480p | 9:16 | 496×864 |
| 480p | 21:9 | 992×432 |
| 720p | 16:9 | 1280×720 |
| 720p | 4:3 | 1112×834 |
| 720p | 1:1 | 960×960 |
| 720p | 3:4 | 834×1112 |
| 720p | 9:16 | 720×1280 |
| 720p | 21:9 | 1470×630 |

#### `duration` `integer`

Dreamina Seedance 2.0 & 2.0 fast 默认值：`5`

生成视频时长，仅支持整数，单位：秒。

取值范围：

- `[4,15]` 或 `-1`

**配置方式**

- 指定具体时长：支持有效范围内的任意整数。
- 智能指定：设为 `-1`，表示模型在有效范围内独立选择合适的视频长度（整数秒）。实际生成视频的时长可从 Retrieve a video generation task API 返回的 `duration` 参数中获得。**注意：视频时长与计费相关，请谨慎设置。**

#### `frames` `integer`

目前 Dreamina Seedance 2.0 & 2.0 fast 不支持。

#### `camera_fixed` `boolean`

目前 Dreamina Seedance 2.0 & 2.0 fast 不支持。

## 2.2 查询

- 查询一个视频生成任务  
  `GET https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/{id}`
- 列出视频生成任务  
  `GET https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks?page_num={page_num}&page_size={page_size}&filter.status={filter.status}&filter.task_ids={filter.task_ids}&filter.model={filter.model}`

### 响应参数

#### `usage` `object`

本次请求的 token 用量。

- `usage.completion_tokens` `integer`  
  模型输出视频所消耗的 token 数量。
- `usage.total_tokens` `integer`  
  本次请求消耗的 token 总数。

# 03 带代码示例的说明

视频生成任务接口是一个异步接口。视频生成流程如下：

1. 通过 Creation API 创建一个视频生成任务
2. 使用 Retrieval API 定期查询视频生成任务状态
   - 如果任务是 `running`，请稍后再次查询任务状态。
   - 如果任务是 `completed`，会返回视频链接。**请务必在 24 小时内下载生成的视频文件。**

## 3.1 创建一个视频生成任务

以下示例仅展示 Dreamina Seedance 2.0 & 2.0 fast 的新能力。更多视频生成示例，请参见 Create a video generation task。

### 从多模态参考创建视频

```bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "dreamina-seedance-2-0-260128",
    "content": [
      {
        "type": "text",
        "text": "Fashion outfit-change short video. Overall pacing, editing rhythm, and transitions follow [Video1], with strong beat sync, fast cuts, and smooth match cuts. The same cat from the images appears sequentially across four scenes: [Image1], [Image2], [Image3], [Image4], changing outfits in each scene. Every shot must have continuous motion, no static frames allowed. The cat performs natural and cute dynamic actions in each scene, such as walking forward, jumping and landing, spinning, raising a paw to pose, wagging its tail, shaking fur, or lightly running. Movements should feel smooth, lively, and seamlessly connected."
      },
      {
        "type": "video_url",
        "video_url": {
          "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_multimodal_video.mp4"
        },
        "role": "reference_video"
      },
      {
        "type": "image_url",
        "image_url": {
          "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_multimodal_image_1.png"
        },
        "role": "reference_image"
      },
      {
        "type": "image_url",
        "image_url": {
          "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_multimodal_image_2.png"
        },
        "role": "reference_image"
      },
      {
        "type": "image_url",
        "image_url": {
          "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_multimodal_image_3.png"
        },
        "role": "reference_image"
      },
      {
        "type": "image_url",
        "image_url": {
          "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_multimodal_image_4.png"
        },
        "role": "reference_image"
      }
    ],
    "generate_audio": true,
    "ratio": "16:9",
    "duration": 11,
    "watermark": false
  }'
```

### 编辑视频

```bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "dreamina-seedance-2-0-260128",
    "content": [
      {
        "type": "text",
        "text": "Replace the perfume featured in [Video1] with the face cream from [Image1], with all original motions and camera work preserved."
      },
      {
        "type": "video_url",
        "video_url": {
          "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/video_edit_replace_ref_video.mp4"
        },
        "role": "reference_video"
      },
      {
        "type": "image_url",
        "image_url": {
          "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/video_edit_replace_ref_image.png"
        },
        "role": "reference_image"
      }
    ],
    "generate_audio": true,
    "ratio": "16:9",
    "duration": 5,
    "watermark": true
  }'
```

### 续写视频

```bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "dreamina-seedance-2-0-260128",
    "content": [
      {
        "type": "text",
        "text": "Generate the content after [Video1]: the two men who are late run towards them, the five people finally meet and have a friendly chat."
      },
      {
        "type": "video_url",
        "video_url": {
          "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/video_edit_prolong_ref_video.mp4"
        },
        "role": "reference_video"
      }
    ],
    "generate_audio": true,
    "ratio": "16:9",
    "duration": 8,
    "watermark": true
  }'
```

## 3.2 查询视频生成任务

将 `cgt-2026****hzc2z` 替换为创建视频生成任务时获得的实际任务 ID。

```bash
curl -X GET https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/cgt-2026****hzc2z \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY"
```

# 04 教程：使用数字角色生成视频

ModelArk 提供数字角色的资产库。目前，你可以使用其中的图像资产来创建一致且完整的视频主角。这有助于你更好地控制主角，并确保其形象在多个视频片段中保持一致，从而**避免因真实人脸限制而导致的人物不一致问题**。

目前这些资产仅为带 profile 的图像。每个资产都有唯一的 asset ID。你可以在 Playground 中使用这些数字角色生成视频。

1. 在浏览器中打开 Playground，并点击输入框下方的 **Digital characters** 标签。
2. 使用自然语言搜索你需要的角色。

### 示例 1：美妆博主

**输入 1：文本**

一段竖版高清美妆博主近景视频（图 1）。她拥有大胆、华丽的妆容，没有面部油光和高光，带着甜美微笑。她手持一罐面霜（图 2），将其直接展示给镜头。背景清新简约。风格活泼甜美。英文旁白：“I found my holy grail face cream! It has a cloud-like creamy texture that absorbs instantly. Perfect for post-all-nighter rescue, deep hydration and moisturization—my skin glows naturally even without makeup!”

**输入 2：数字角色、图像**

- 来自素材库的数字角色
- 产品图像

使用资产 URI 在 `content.<modality>_url.url` 参数中调用 Create a video generation task API 生成视频。

⚠️ 输入参考内容（包括数字角色）必须符合视频生成限制。详情请见上方 API 文档。

ℹ️ 在 API 中首次使用数字角色的 Asset URI 之前，你必须先在 ModelArk Playground 中创建一个视频生成任务，并阅读且同意 **Digital Characters Service Agreement**。

- Playground 中已可试用视频生成。默认每次请求生成 4 个视频片段。**为了节省成本，建议设为每次请求仅生成 1 个视频。**

### 代码示例：使用数字角色生成视频（Python）

```python
import os
import time
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplusdsarkruntime import Ark
client = Ark(
    # The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3",
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)
if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="dreamina-seedance-2-0-260128",  # Replace with Model ID
        content=[
            {
                "type": "text",
                "text": "Vertical HD close-up video of a beauty blogger (Image 1). She has bold, glamorous makeup with no facial shine or glare and a sweet smile. She holds a face cream jar (Image 2), presents it directly to the camera. The background is fresh and minimalist. Energetic and sweet style. English voiceover: 'I found my holy grail face cream! It has a cloud-like creamy texture that absorbs instantly. Perfect for post-all-nighter rescue, deep hydration and moisturization—my skin glows naturally even without makeup!'"
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "asset://asset-20260225023032-gnzwk"
                },
                "role": "reference_image"
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_ref_image.png"
                },
                "role": "reference_image"
            }
        ],
        generate_audio=True,
        ratio="16:9",
        duration=11,
        watermark=True,
    )
    print(create_result)
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```

## 最佳实践 - 上传私有资产示例

⚠️ 上传资产时，将目标人脸参考、全身参考和细节参考合并到一张图中，可能会使每个参考区域过小。这会增加模型识别难度，并可能导致生成角色与上传资产之间出现不匹配。在某些情况下，还可能导致非名人脸被误识别为类似名人的面孔，从而触发风控拦截。

我们建议将关键参考（例如**面部特写**和**服装/细节镜头**）拆分为独立图片并分别上传。

请参见以下规则和示例作为指导：

### 对于传统中国古风打斗场景：

左侧输入内容包括：背景参考图、**角色造型三视图**、**角色中性表情的面部特写图**以及提示词；中间输入内容包括：背景参考图、角色造型三视图和提示词；右侧输入内容包括：背景参考图、角色正视图和提示词。

左侧输出视频能更好地保留角色面部特征；右侧角色面部特征的一致性较差。

**应当（Should）**：

提供背景参考图、角色造型三视图、角色中性表情的面部特写图，以及提示词。

示例提示词：

1. 借助 **Background Reference Image 1**，淡白色残影掠过画面。年轻公子（造型参考：**Image 2**；角色外貌必须严格遵循 **Image 3**）旋身甩开折扇。一枚鎏金扇刃弹出；墨竹扇叶掠过空中。一声沉重缓慢的鼓点落下。
2. **Close-up**：扇刃挡住反派的长剑。扇骨与钢铁相击。年轻公子嘴角勾起轻佻笑意，但眼神依旧冷冽。拇指轻轻拨动扇柄。
3. **Slow motion**：他俯身贴地滑行。扇刃擦过反派腿侧，留下一道浅浅伤痕。织锦长袍下摆掠过地面；玉簪轻颤。
4. **Fast cut**：他转身抬手——扇刃射出，擦着反派颈侧飞过，钉入身后木柱。反派僵住，不敢再动。
5. **Reversal**：身后忽然一记掌风袭来。年轻公子回身迎上。指尖触碰间，他借力向后疾退。扇刃自木柱飞回掌中，眼神骤然锐利警觉。
6. **Slow-motion highlight**：扇半开，扇刃停在唇边。他抬眼望向身后的袭击者。碎发在风中轻扬；眉梢带着一丝不羁傲气。
7. **Pull-back**：他立于庭院石台之上，折扇轻晃。镜头拉远——庭院四角出现戴面具的人影（手持弯刃），逐渐逼近。
8. **Freeze-frame**：他将折扇半阖，露出一线鎏金刃光，迈步向前。画面骤暗，只留下侧影与刃光。声音戛然而止。
9. **Sound design**：清脆扇响 + 刀锋破风声 + 缓慢鼓点击打（稳定、厚重）。

**不应当（Shouldn't）**：

提供背景参考图、角色造型三视图，以及提示词。

示例提示词：

1. 借助 **Background Reference Image 1**，淡白色残影掠过画面。年轻公子（**Reference Image 2**）旋身甩开折扇。一枚鎏金扇刃自扇缘弹出；墨竹扇叶掠过空中。一声沉重缓慢的鼓点落下。
2. **Close-up**：扇刃挡住反派的长剑。扇骨撞击钢铁。年轻公子嘴角勾起轻佻笑意，但眼神依旧冰冷。指尖轻轻滚动扇柄。
3. **Slow motion**：他身体侧斜，贴地滑行。扇刃擦过反派腿侧，划出浅浅伤痕。织锦长袍拂过地面；玉簪颤动。
4. **Fast cut**：他转身抬手。扇刃射出，擦过反派颈侧并钉入身后木柱。反派僵住，吓得不敢动。
5. **Reversal**：身后突然一记掌风袭来。年轻公子转身相迎。就在指尖相触之际，他借力向后弹退。扇刃自木柱飞回掌中，眼神骤然变得警觉。
6. **Slow-motion highlight**：扇半开，扇刃停在唇边。他抬眼看向身后的袭击者。散乱发丝在风中扬起；眉梢带着一丝桀骜。
7. **Pull-back**：他站在庭院石台上，折扇轻晃。镜头拉远——庭院四角出现戴面具的剪影（手持弯刃），逐渐围拢。
8. **Freeze-frame**：他将折扇半阖，露出一道金色刃光，向前迈步。画面转暗，只剩下侧身剪影与刃光。声音突兀中断。
9. **Sound design**：清脆扇响 + 刀刃破风声 + 缓慢鼓点（稳定、厚重）。

### 对于温暖的亲子故事线：

两者都是温馨的亲子故事线：

左侧输入内容包括：背景参考图、**角色妆造三视图**、**角色无表情面部特写图**以及提示词；中间输入内容包括：背景参考图、角色妆造三视图和提示词；右侧输入内容包括：背景参考图、角色妆造正视图和提示词。

左侧输出视频能更准确地还原角色面部特征；中间输出视频中角色面部特征一致性较差；右侧输出视频中角色妆容和面部特征的一致性较差。
