export function toast(message, { error = false, timeout = 4000 } = {}) {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), timeout);
}
