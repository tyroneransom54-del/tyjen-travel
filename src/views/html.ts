// Tiny tagged-template HTML helper with automatic escaping, so route/view
// code can write `html\`<p>${userInput}</p>\`` without a manual escape call
// at every interpolation, while still being able to opt in to raw markup via
// `raw()` for pre-built fragments (e.g. joining an array of already-escaped
// component strings).

export class SafeHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
}

export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

function escape(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Array.isArray(v)) {
      out += v.map((x) => escape(x)).join("");
    } else {
      out += escape(v);
    }
    out += strings[i + 1] ?? "";
  }
  return new SafeHtml(out);
}

export function joinHtml(parts: SafeHtml[], separator = ""): SafeHtml {
  return raw(parts.map((p) => p.value).join(separator));
}

export function renderPage(fragment: SafeHtml): string {
  return `<!doctype html>\n${fragment.value}`;
}
