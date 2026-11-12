/* ==========================================================================
   知行测评 · 图标（管理端）
   路径取自原型 docs/ui-design/shared/js/app.js 的 ICON_BODY。
   ========================================================================== */

import type { CSSProperties } from "react";

const ICON_BODY: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  book: '<path d="M4 19.2A2.2 2.2 0 0 1 6.2 17H20"/><path d="M6.4 3H20v14H6.4A2.4 2.4 0 0 0 4 19.4V5.4A2.4 2.4 0 0 1 6.4 3z"/>',
  clipboard:
    '<rect x="8" y="3" width="8" height="4" rx="1.2"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
  chart: '<path d="M4 20V11"/><path d="M10 20V4"/><path d="M16 20v-6"/><path d="M21 20H3"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.6v5.2"/><path d="M12 16.2h.01"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
  users:
    '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M16.2 5.2a3.4 3.4 0 0 1 0 6.5"/><path d="M17.6 14.6A6.2 6.2 0 0 1 21.5 20"/>',
  library:
    '<rect x="3.5" y="4" width="4" height="16" rx="1"/><rect x="9.5" y="4" width="4" height="16" rx="1"/><path d="M16.8 5.4l3.4 13.2"/>',
  shuffle:
    '<path d="M16 3.5h4.5V8"/><path d="M20.5 3.5L14 10"/><path d="M3.5 20.5L10 14"/><path d="M14 10h3.2a4 4 0 0 1 3.3 1.8L22 14"/><path d="M3.5 3.5h3.7c1.6 0 3 .9 3.8 2.3L13 10"/><path d="M14 14l1.6 2.7c.8 1.4 2.2 2.3 3.8 2.3h4.1"/>',
  edit: '<path d="M12.5 20.5H20"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7.6 18.4l-4 1 1-4z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.4 2"/>',
  moon: '<path d="M20 14.4A8.4 8.4 0 1 1 9.6 4a6.6 6.6 0 0 0 10.4 10.4z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  logout:
    '<path d="M15 4.5h2.5A2.5 2.5 0 0 1 20 7v10a2.5 2.5 0 0 1-2.5 2.5H15"/><path d="M10.5 16.5L15 12l-4.5-4.5"/><path d="M15 12H4"/>',
  check: '<path d="M20 6.5L9.2 17.3 4 12.1"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>',
  eye: '<path d="M2.6 12S6 5.6 12 5.6 21.4 12 21.4 12 18 18.4 12 18.4 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3"/>',
  flag: '<path d="M5.5 21V3.6"/><path d="M5.5 4.6h11l-1.6 4.2 1.6 4.2h-11"/>',
  search: '<circle cx="11" cy="11" r="6.8"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l.9 12.1A1.2 1.2 0 0 0 8.6 20h6.8a1.2 1.2 0 0 0 1.2-1.1L17.5 7"/>',
  chevronLeft: '<path d="M15 18.5l-6.5-6.5L15 5.5"/>',
  chevronRight: '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  filter: '<path d="M4 5.5h16l-6 7v6.2l-4 1.8V12.5z"/>',
  arrowRight: '<path d="M4.5 12h15"/><path d="M13.5 6l6 6-6 6"/>',
  refresh: '<path d="M20 11.5A8 8 0 1 0 18.4 17"/><path d="M20 5.5v6h-6"/>',
  layers: '<path d="M12 3.2l8.5 4.6L12 12.4 3.5 7.8z"/><path d="M3.5 12.6L12 17.2l8.5-4.6"/>',
  award: '<circle cx="12" cy="9" r="5.2"/><path d="M8.8 13.4L7 21l5-2.4L17 21l-1.8-7.6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.4"/><path d="M12 7.9h.01"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7.2a4 4 0 0 1 8 0V10"/>',
  save: '<path d="M5 4.5h11l3 3V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z"/><path d="M8 4.5v5h6v-5"/><rect x="7.5" y="13" width="9" height="7"/>',
  play: '<path d="M8 5.5l10 6.5-10 6.5z"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.8 6.8L12 13l8.2-6.2"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01"/>',
  document:
    '<path d="M6.5 3.5h7L18.5 8.5V20.5h-12z"/><path d="M13.5 3.5v5h5"/><path d="M9 13h6M9 16.5h6"/>',
};

export interface IconProps {
  name: string;
  size?: number;
  className?: string;
}

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
