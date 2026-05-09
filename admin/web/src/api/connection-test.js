import request from "./request";
export const testConnection = (purpose) => request.post("/connection-test", { purpose });
