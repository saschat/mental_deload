import { ref } from "vue";
import { defineStore } from "pinia";
import type { Reminder } from "@/core/reminders";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

export interface DialogButton {
  value: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface DialogRequest {
  title: string;
  message: string;
  buttons: DialogButton[];
  resolve: (value: string | null) => void;
}

let toastId = 0;

export const useUiStore = defineStore("ui", () => {
  const toasts = ref<Toast[]>([]);
  const dialog = ref<DialogRequest | null>(null);
  const newReminders = ref<Reminder[]>([]);

  function toast(text: string, kind: Toast["kind"] = "info", ms = 3500) {
    const id = ++toastId;
    toasts.value.push({ id, text, kind });
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, ms);
  }

  function error(e: unknown) {
    console.error(e);
    toast(e instanceof Error ? e.message : String(e), "error", 6000);
  }

  /** Show a modal with custom buttons; resolves to the chosen value or null. */
  function ask(title: string, message: string, buttons: DialogButton[]): Promise<string | null> {
    return new Promise((resolve) => {
      dialog.value = {
        title,
        message,
        buttons,
        resolve: (v) => {
          dialog.value = null;
          resolve(v);
        },
      };
    });
  }

  async function confirm(title: string, message: string, okLabel = "OK", danger = false): Promise<boolean> {
    const v = await ask(title, message, [
      { value: "cancel", label: "Cancel" },
      { value: "ok", label: okLabel, primary: !danger, danger },
    ]);
    return v === "ok";
  }

  /** Run an async action and surface errors as a toast. */
  async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      error(e);
      return undefined;
    }
  }

  return { toasts, dialog, newReminders, toast, error, ask, confirm, run };
});
