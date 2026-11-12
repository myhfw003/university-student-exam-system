/* ==========================================================================
   知行测评 · 提示条宿主
   --------------------------------------------------------------------------
   把 toastStore 的队列渲染出来；挂在应用外壳根部即可。
   ========================================================================== */

import { Toast, ToastHost } from "./Toast";
import { useToastStore } from "./toastStore";

/** 提示条宿主。 */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <ToastHost>
      {toasts.map((item) => (
        <Toast key={item.id} tone={item.tone}>
          {item.message}
        </Toast>
      ))}
    </ToastHost>
  );
}
