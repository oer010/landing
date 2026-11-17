type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

/** Liten hyperscript-hjelper. Attributter som starter med "on" blir event-lyttere. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
      else if (k === 'checked' && 'checked' in el) (el as HTMLInputElement).checked = Boolean(v);
      else if (k === 'html') el.innerHTML = String(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, children);
}

export function toast(msg: string, kind: 'info' | 'warn' | 'error' = 'info', ms = 3500): void {
  const host = document.getElementById('toasts')!;
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  host.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Talls-input med etikett. */
export function numField(
  label: string,
  value: number | null | undefined,
  onChange: (v: number) => void,
  opts: { step?: number; min?: number; max?: number; unit?: string; id?: string } = {},
): HTMLLabelElement {
  return h(
    'label',
    { class: 'field' },
    h('span', null, label),
    h(
      'span',
      { class: 'inputwrap' },
      h('input', {
        type: 'number',
        inputmode: 'decimal',
        step: opts.step ?? 'any',
        min: opts.min,
        max: opts.max,
        id: opts.id,
        value: value ?? '',
        onchange: (e: Event) => {
          const v = parseFloat((e.target as HTMLInputElement).value);
          if (Number.isFinite(v)) onChange(v);
        },
      }),
      opts.unit ? h('span', { class: 'unit' }, opts.unit) : null,
    ),
  );
}

export function textField(label: string, value: string, onChange: (v: string) => void, attrs: Attrs = {}): HTMLLabelElement {
  return h(
    'label',
    { class: 'field' },
    h('span', null, label),
    h('input', {
      type: 'text',
      value,
      ...attrs,
      onchange: (e: Event) => onChange((e.target as HTMLInputElement).value),
    }),
  );
}

export const fmt = {
  n: (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d)),
  time: (d: Date | null | undefined) =>
    d ? d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : '—',
  utc: (d: Date | null | undefined) => (d ? `${d.toISOString().slice(11, 16)}Z` : '—'),
  date: (d: Date) => d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' }),
};

export function section(title: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'card' }, h('h3', null, title), ...children);
}

export function badge(text: string, color: string): HTMLSpanElement {
  return h('span', { class: 'badge', style: { background: color } }, text);
}
