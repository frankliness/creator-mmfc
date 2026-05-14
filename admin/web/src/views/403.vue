<template>
  <a-result status="403" title="无访问权限" :sub-title="subTitle">
    <template #extra>
      <a-space>
        <a-button type="primary" @click="goHome">返回首页</a-button>
        <a-button @click="logout">切换账号</a-button>
      </a-space>
    </template>
  </a-result>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useUserStore } from "@/store/user";

const router = useRouter();
const userStore = useUserStore();

const subTitle = computed(() => {
  if (userStore.isLoggedIn() && !userStore.hasAnyAccess) {
    return "当前账号暂无后台访问权限，请联系超级管理员开通。";
  }
  return "当前账号没有访问该分栏的权限，请联系超级管理员。";
});

function goHome() {
  const first = userStore.firstReadableRoutePath();
  router.replace(first ?? "/login");
}

function logout() {
  userStore.logout();
  router.replace("/login");
}
</script>
