import type { CSSProperties } from "react";

/* ==========================================================================
   知行测评 · 图标
   路径取自原型 docs/ui-design/shared/js/app.js 的 ICON_BODY。
   所有图标 aria-hidden，语义由按钮的 aria-label 提供。
   ========================================================================== */

const ICON_BODY: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  book: '<path d="M4 19.2A2.2 2.2 0 0 1 6.2 17H20"/><path d="M6.4 3H20v14H6.4A2.4 2.4 0 0 0 4 19.4V5.4A2.4 2.4 0 0 1 6.4 3z"/>',
  clipboard:
    '<rect x="8" y="3" width="8" height="4" rx="1.2"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
  chart: '<path d="M4 20V11"/><path d="M10 20V4"/><path d="M16 20v-6"/><path d="M21 20H3"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.6v5.2"/><path d="M12 16.2h.01"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.4 2"/>',
  moon: '<path d="M20 14.4A8.4 8.4 0 1 1 9.6 4a6.6 6.6 0 0 0 10.4 10.4z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  logout:
    '<path d="M15 4.5h2.5A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5H15"/><path d="M10.5 16.5L15 12l-4.5-4.5"/><path d="M15 12H4"/>',
  check: '<path d="M20 6.5L9.2 17.3 4 12.1"/>',
};

export interface IconProps {
  name: string;
  /** 像素尺寸。 */
  size?: number;
  className?: string;
}

/** 内联 SVG 图标。 */
export function Icon({ name, size = 17, className }: IconProps) {
  const body = ICON_BODY[name];
  if (!body) return null;
  return (
    <svg
      className={className ? `od-icon ${className}` : "od-icon"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ "--od-icon-size": `${size}px` } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
