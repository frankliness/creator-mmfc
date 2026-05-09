<template>
  <div>
    <a-result
      status="info"
      title="此页已迁移"
      sub-title="v1.3.0 起，原「Provider 配置」拆分为「凭据池」和「默认模型」两个独立模块。"
    >
      <template #extra>
        <a-space direction="vertical" size="middle" style="width: 100%; max-width: 480px; text-align: left">
          <a-alert
            type="info"
            show-icon
            message="新流程：先建凭据 → 再选默认模型"
            description="原本一个用途绑死一个 provider 的限制已解除：现在每个 provider 类型可有多条凭据（生产/测试/区域），同一用途下不同模型自动按各自 providers 偏好选凭据。"
          />
          <a-space>
            <a-button type="primary" @click="$router.push('/system/credentials')">
              进入「凭据池」
            </a-button>
            <a-button @click="$router.push('/system/defaults')">
              进入「默认模型」
            </a-button>
          </a-space>
        </a-space>
      </template>
    </a-result>
  </div>
</template>

<script setup lang="ts">
// v1.3.0 起此页面降级为跳转提示。原页面（per-purpose Provider 配置）已被
// 「凭据池 + 默认模型」组合取代。完整迁移后可删除此文件。
</script>
