import { defineStore } from "pinia";
import { ref } from "vue";
import { login as loginApi, getProfile } from "@/api/auth";
export const useUserStore = defineStore("user", () => {
    const token = ref(localStorage.getItem("admin_token") || "");
    const admin = ref(null);
    async function login(username, password) {
        const res = await loginApi({ username, password });
        token.value = res.accessToken;
        localStorage.setItem("admin_token", res.accessToken);
        localStorage.setItem("admin_refresh_token", res.refreshToken);
        admin.value = res.admin;
    }
    async function fetchProfile() {
        if (!token.value)
            return;
        try {
            const res = await getProfile();
            admin.value = res;
        }
        catch {
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
