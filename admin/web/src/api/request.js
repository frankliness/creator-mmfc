import axios from "axios";
import { message } from "ant-design-vue";
import router from "@/router";
const instance = axios.create({ baseURL: "/api/admin", timeout: 30000 });
instance.interceptors.request.use((config) => {
    const token = localStorage.getItem("admin_token");
    if (token)
        config.headers.Authorization = `Bearer ${token}`;
    return config;
});
instance.interceptors.response.use((res) => res.data, async (error) => {
    const status = error.response?.status;
    if (status === 401) {
        localStorage.removeItem("admin_token");
        router.push("/login");
        message.error("登录已过期，请重新登录");
    }
    else if (status === 403) {
        message.error("权限不足");
    }
    else {
        const msg = error.response?.data?.error || "请求失败";
        message.error(msg);
    }
    return Promise.reject(error);
});
const request = instance;
export default request;
