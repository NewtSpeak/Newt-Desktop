// KeyboardEvent.code / 鼠标侧键 → 中文友好标签

const CODE_LABELS: Record<string, string> = {
  Space: "空格",
  Enter: "Enter",
  Escape: "Esc",
  Backspace: "退格",
  Tab: "Tab",
  ShiftLeft: "左 Shift",
  ShiftRight: "右 Shift",
  ControlLeft: "左 Ctrl",
  ControlRight: "右 Ctrl",
  AltLeft: "左 Alt",
  AltRight: "右 Alt",
  MetaLeft: "⌘",
  MetaRight: "⌘",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Mouse4: "鼠标侧键 4",
  Mouse5: "鼠标侧键 5",
}

/** KeyboardEvent.code → 展示文案（KeyV → V） */
export function formatKeyCode(code: string): string {
  if (!code) return "未绑定"
  if (CODE_LABELS[code]) return CODE_LABELS[code]
  if (code.startsWith("Key") && code.length === 4) return code.slice(3)
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5)
  if (code.startsWith("Numpad")) return "小键盘 " + code.slice(6)
  if (code.startsWith("F") && /^F\d{1,2}$/.test(code)) return code
  return code
}
