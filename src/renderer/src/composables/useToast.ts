import { h } from "vue";
import { ElNotification } from "element-plus";

type ToastTone = "success" | "warning" | "info" | "error";

export function useToast() {
  const mapType = (color: string): ToastTone =>
    color === "success" ||
    color === "warning" ||
    color === "info" ||
    color === "error"
      ? color
      : "info";

  const showToast = (options: {
    color: string;
    icon?: string;
    message: string;
    duration?: number;
  }) => {
    const tone = mapType(options.color);
    ElNotification.closeAll();

    ElNotification({
      message: h("div", { class: "client-toast__content", role: "alert" }, [
        h(
          "span",
          { class: ["client-toast__icon", options.icon ? "has-icon" : ""] },
          options.icon
            ? [h("i", { class: ["mdi", options.icon], "aria-hidden": "true" })]
            : [
                h("span", {
                  class: "client-toast__dot",
                  "aria-hidden": "true",
                }),
              ],
        ),
        h("p", { class: "client-toast__message" }, options.message),
      ]),
      duration: options.duration ?? 3000,
      position: "top-right",
      showClose: false,
      customClass: `client-toast client-toast--${tone}`,
    });
  };

  return { showToast };
}
