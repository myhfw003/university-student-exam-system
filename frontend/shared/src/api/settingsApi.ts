/* ==========================================================================
   知行测评 · 系统级设置的后端读写
   --------------------------------------------------------------------------
   `GET /settings` / `PUT /settings`：全局生效的开关。
   读与写都要权限点 `system:configure`——按需求文档 §1 的矩阵，
   这个权限只给系统管理员。

   值一律是**原始取值**（`remove` / `keep_mastered`），中文名由前端词表
   （`shared/src/domain/settings.ts`）给。两边的取值词表由
   `scripts/check-system-setting-values.py` 守着。
   ========================================================================== */

import { httpClient } from "./httpClient";
import { ENDPOINTS } from "./endpoints";
import {
  toMistakeResolutionPolicy,
  type MistakeResolutionPolicy,
  type SystemSettings,
} from "../domain/settings";

/** 系统级设置接口所需的最小客户端接口。 */
export type SettingsClient = Pick<typeof httpClient, "get" | "put" | "delete">;

/** 后端 DTO（宽松声明；字段以 OpenAPI 契约为准）。 */
type Dto = Record<string, unknown>;

function str(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

/** 映射后端返回的设置。 */
export function toSystemSettings(dto: Dto): SystemSettings {
  return {
    mistakeResolutionPolicy: toMistakeResolutionPolicy(str(dto.mistakeResolutionPolicy)),
    originalPasswordConfigured: dto.originalPasswordConfigured === true,
    updatedAt: strOrNull(dto.updatedAt),
    updatedBy: strOrNull(dto.updatedBy),
  };
}

/**
 * 读取当前的系统级设置。
 *
 * 没配置过的项按默认值返回（后端给的是**生效值**，不是空）。
 */
export async function loadSystemSettings(
  client: SettingsClient = httpClient,
): Promise<SystemSettings> {
  const dto = await client.get<Dto>(ENDPOINTS.admin.settings);
  return toSystemSettings(dto);
}

/**
 * 修改系统级设置。
 *
 * 改完立即生效，不用重启。
 */
export async function updateSystemSettings(
  mistakeResolutionPolicy: MistakeResolutionPolicy,
  client: SettingsClient = httpClient,
): Promise<SystemSettings> {
  const dto = await client.put<Dto>(ENDPOINTS.admin.settings, { mistakeResolutionPolicy });
  return toSystemSettings(dto);
}

/**
 * 设置系统的原始密码（管理员重置密码时置成它）。
 *
 * **只写不回显**：请求里给的是明文，响应里只有「有没有配」——
 * 原始密码由管理员自己另行告知用户。
 */
export async function setOriginalPassword(
  password: string,
  client: SettingsClient = httpClient,
): Promise<SystemSettings> {
  const dto = await client.put<Dto>(ENDPOINTS.admin.settingsOriginalPassword, { password });
  return toSystemSettings(dto);
}

/**
 * 清除系统的原始密码。
 *
 * 清除后重置密码会被拒绝（没有可置成的目标），直到重新配置。
 */
export async function clearOriginalPassword(
  client: SettingsClient = httpClient,
): Promise<SystemSettings> {
  const dto = await client.delete<Dto>(ENDPOINTS.admin.settingsOriginalPassword);
  return toSystemSettings(dto);
}
