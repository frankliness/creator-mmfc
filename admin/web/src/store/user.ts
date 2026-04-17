import { defineStore } from "pinia";
import { ref } from "vue";
import { login as loginApi, getProfile } from "@/api/auth";

interface AdminInfo {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

export const useUserStore = defineStore("user", () => {
  const token = ref(localStorage.getItem("admin_token") || "");
  const admin = ref<AdminInfo | null>(null);

  async function login(username: string, password: string) {
    const res: any = await loginApi({ username, password });
    token.value = res.accessToken;
    localStorage.setItem("admin_token", res.accessToken);
    localStorage.setItem("admin_refresh_token", res.refreshToken);
    admin.value = res.admin;
  }

  async function fetchProfile() {
    if (!token.value) return;
    try {
      const res: any = await getProfile();
      admin.value = res;
    } catch {
      logout();
    }
  }

  function logout() {
    token.value = "";
    admin.value = null;
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_refresh_token");
  }

  const isLoggedIn = () => !!token.value;
  const isSuper = () => admin.value?.role === "SUPER_ADMIN";

  return { token, admin, login, fetchProfile, logout, isLoggedIn, isSuper };
});
