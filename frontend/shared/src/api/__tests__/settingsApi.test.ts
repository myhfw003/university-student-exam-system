/* ==========================================================================
   系统级设置的 DTO 适配
   --------------------------------------------------------------------------
   这一层要对的两件事：
   1. 读设置走 `GET /settings`，改设置走 `PUT /settings`；
   2. **取值原样带过来**——后端存什么，前端就按什么显示中文名。
      认不出来的取值退回缺省档（前端不能显示成空标签）。
   ========================================================================== */

import { describe, expect, it, vi } from "vitest";
import {
  clearOriginalPassword,
  loadSystemSettings,
  setOriginalPassword,
  toSystemSettings,
  updateSystemSettings,
  type SettingsClient,
} from "../settingsApi";

describe("settingsApi · 系统级设置", () => {
  it("读设置走 GET /settings", async () => {
    const get = vi.fn(async (_path: string) => ({
      mistakeResolutionPolicy: "keep_mastered",
      updatedAt: "2026-11-21T02:00:00Z",
      updatedBy: "7",
    }));
    const client = { get } as unknown as SettingsClient;

    const settings = await loadSystemSettings(client);

    expect(get.mock.calls[0]![0]).toBe("/settings");
    expect(settings.mistakeResolutionPolicy).toBe("keep_mastered");
    expect(settings.updatedAt).toBe("2026-11-21T02:00:00Z");
    expect(settings.updatedBy).toBe("7");
  });

  it("改设置走 PUT /settings，请求体就是选中的取值", async () => {
    const put = vi.fn(async (_path: string, _body?: unknown) => ({
      mistakeResolutionPolicy: "remove",
      updatedAt: null,
      updatedBy: null,
    }));
    const client = { get: vi.fn(), put } as unknown as SettingsClient;

    const settings = await updateSystemSettings("remove", client);

    expect(put.mock.calls[0]![0]).toBe("/settings");
    expect(put.mock.calls[0]![1]).toEqual({ mistakeResolutionPolicy: "remove" });
    expect(settings.mistakeResolutionPolicy).toBe("remove");
  });

  it("没改过的设置没有最后修改时间与修改人", () => {
    const settings = toSystemSettings({ mistakeResolutionPolicy: "remove" });

    expect(settings.updatedAt).toBeNull();
    expect(settings.updatedBy).toBeNull();
  });

  it("认不出来的取值退回缺省档，不显示成空", () => {
    const settings = toSystemSettings({ mistakeResolutionPolicy: "后端新加的档" });

    expect(settings.mistakeResolutionPolicy).toBe("remove");
  });

  it("读设置时带回「有没有配原始密码」", async () => {
    const get = vi.fn(async (_path: string) => ({
      mistakeResolutionPolicy: "remove",
      originalPasswordConfigured: true,
    }));
    const client = { get } as unknown as SettingsClient;

    const settings = await loadSystemSettings(client);

    expect(settings.originalPasswordConfigured).toBe(true);
  });

  it("后端没给这一位时按「没配」算", () => {
    expect(toSystemSettings({ mistakeResolutionPolicy: "remove" }).originalPasswordConfigured).toBe(
      false,
    );
  });

  it("设置原始密码走 PUT /settings/original-password", async () => {
    const put = vi.fn(async (_path: string, _body?: unknown) => ({
      mistakeResolutionPolicy: "remove",
      originalPasswordConfigured: true,
    }));
    const client = { get: vi.fn(), put } as unknown as SettingsClient;

    const settings = await setOriginalPassword("OrigPass123", client);

    expect(put.mock.calls[0]![0]).toBe("/settings/original-password");
    expect(put.mock.calls[0]![1]).toEqual({ password: "OrigPass123" });
    expect(settings.originalPasswordConfigured).toBe(true);
  });

  it("清除原始密码走 DELETE /settings/original-password", async () => {
    const del = vi.fn(async (_path: string) => ({
      mistakeResolutionPolicy: "remove",
      originalPasswordConfigured: false,
    }));
    const client = { get: vi.fn(), put: vi.fn(), delete: del } as unknown as SettingsClient;

    const settings = await clearOriginalPassword(client);

    expect(del.mock.calls[0]![0]).toBe("/settings/original-password");
    expect(settings.originalPasswordConfigured).toBe(false);
  });
});
