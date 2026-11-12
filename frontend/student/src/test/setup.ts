import "@testing-library/jest-dom/vitest";
// jsdom 不实现 IndexedDB，用 fake-indexeddb 覆盖真实 Dexie 路径。
import "fake-indexeddb/auto";
