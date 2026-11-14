import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./router";
import { hydrateCatalogFromArchive } from "./stores/resultArchive";
import "./styles/app.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("找不到 #root 容器");
}

// 启动即回灌本地成绩归档：mock catalog 是纯内存的，
// 不回灌的话刷新后成绩列表会清空（原型是整份 store 落盘的）。
hydrateCatalogFromArchive();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
