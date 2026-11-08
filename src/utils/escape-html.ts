// src/utils/escape-html.ts
const MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapa texto de origem não confiável antes de interpolar em HTML (e-mail, etc.). */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => MAP[ch]);
}
