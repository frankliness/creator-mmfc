<template>
  <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f0f2f5">
    <a-card style="width: 400px" title="Creator MMFC 管理后台">
      <a-form :model="form" @finish="handleLogin" layout="vertical">
        <a-form-item label="用户名" name="username" :rules="[{ required: true, message: '请输入用户名' }]">
          <a-input v-model:value="form.username" placeholder="admin" size="large" />
        </a-form-item>
        <a-form-item label="密码" name="password" :rules="[{ required: true, message: '请输入密码' }]">
          <a-input-password v-model:value="form.password" placeholder="请输入密码" size="large" />
        </a-form-item>
        <a-form-item>
          <a-button type="primary" html-type="submit" :loading="loading" block size="large">登录</a-button>
        </a-form-item>
      </a-form>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useUserStore } from "@/store/user";
import { message } from "ant-design-vue";

const router = useRouter();
const userStore = useUserStore();
const loading = ref(false);
const form = reactive({ username: "", password: "" });

async function handleLogin() {
  loading.value = true;
  try {
    await userStore.login(form.username, form.password);
    message.success("登录成功");
    router.push("/dashboard");
  } catch {
    // error handled by interceptor
  } finally {
    loading.value = false;
  }
}
</script>
