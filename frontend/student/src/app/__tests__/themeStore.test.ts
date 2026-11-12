import { describe, expect, it, beforeEach } from "vitest";
import { THEME_STORAGE_KEY, useThemeStore } from "../themeStore";

describe("themeStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useThemeStore.setState({ theme: "light" });
  });

  it("切换主题时写入 localStorage（键 exam.theme）", () => {
    useThemeStore.getState().setTheme("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("toggleTheme 在浅色与深色之间切换", () => {
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("dark");
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("light");
  });
});
