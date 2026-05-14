import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { login as loginApi, getProfile } from "@/api/auth";
import {
  ADMIN_SECTIONS,
  normalizePermissions,
  type PermissionMatrix,
  type SectionKey,
} from "@/config/admin-sections";

interface AdminInfo {
  id: string;
  username: string;
  displayName: string;
  role: string;
  isActive?: boolean;
}

export const useUserStore = defineStore("user", () => {
  const token = ref(localStorage.getItem("admin_token") || "");
  const admin = ref<AdminInfo | null>(null);
  const permissions = ref<PermissionMatrix>({});
  // 标记 profile 是否已加载过，避免路由守卫重复请求
  const profileLoaded = ref(false);

  function applyAdminFromApi(payload: {
    id: string;
    username: string;
    displayName: string;
    role: string;
    isActive?: boolean;
    permissions?: PermissionMatrix | null;
  }) {
    admin.value = {
      id: payload.id,
      username: payload.username,
      displayName: payload.displayName,
      role: payload.role,
      isActive: payload.isActive,
    };
    permissions.value = normalizePermissions(payload.permissions ?? {});
  }

  async function login(username: string, password: string) {
    const res: any = await loginApi({ username, password });
    token.value = res.accessToken;
    localStorage.setItem("admin_token", res.accessToken);
    localStorage.setItem("admin_refresh_token", res.refreshToken);
    applyAdminFromApi(res.admin);
    profileLoaded.value = true;
  }

  async function fetchProfile() {
    if (!token.value) return;
    try {
      const res: any = await getProfile();
      if (res) applyAdminFromApi(res);
      profileLoaded.value = true;
    } catch {
      logout();
    }
  }

  // 确保有 profile 才放行路由守卫；同一次首屏只拉一次
  async function ensureProfile() {
    if (!token.value) return;
    if (profileLoaded.value) return;
    await fetchProfile();
  }

  function logout() {
    token.value = "";
    admin.value = null;
    permissions.value = {};
    profileLoaded.value = false;
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_refresh_token");
  }

  const isLoggedIn = () => !!token.value;
  const isSuper = () => admin.value?.role === "SUPER_ADMIN";

  function canRead(section: SectionKey): boolean {
    if (isSuper()) return true;
    return !!permissions.value[section]?.read;
  }

  function canWrite(section: SectionKey): boolean {
    if (isSuper()) return true;
    return !!permissions.value[section]?.write;
  }

  // 首页跳转用：返回第一个有 read 权限的分栏路径，没有则返回 null
  function firstReadableRoutePath(): string | null {
    if (isSuper()) return ADMIN_SECTIONS[0]?.routePath ?? null;
    for (const s of ADMIN_SECTIONS) {
      if (permissions.value[s.key]?.read) return s.routePath;
    }
    return null;
  }

  const hasAnyAccess = computed(() => {
    if (isSuper()) return true;
    return ADMIN_SECTIONS.some((s) => permissions.value[s.key]?.read);
  });

  return {
    token,
    admin,
    permissions,
    profileLoaded,
    login,
    fetchProfile,
    ensureProfile,
    logout,
    isLoggedIn,
    isSuper,
    canRead,
    canWrite,
    firstReadableRoutePath,
    hasAnyAccess,
  };
});
