import { defaultChecklists, uid } from '../../lib/store';
import { h, section } from '../dom';
import { state } from '../state';

let editing = false;

export function renderChecklists(el: HTMLElement): void {
  const save = () => state.saveChecklists();
  el.append(
    h(
      'div',
      { class: 'row wrap card' },
      h('button', { class: editing ? 'toggle on' : 'toggle', onclick: () => ((editing = !editing), save()) }, editing ? 'Ferdig' : '✎ Rediger'),
      h(
        'button',
        {
          onclick: () => {
            state.checklists.forEach((c) => c.items.forEach((i) => (i.done = false)));
            save();
          },
        },
        'Nullstill alle',
      ),
      editing
        ? h(
            'button',
            {
              onclick: () => {
                state.checklists.push({ id: uid(), name: 'Ny sjekkliste', items: [] });
                save();
              },
            },
            '+ Ny liste',
          )
        : null,
      editing
        ? h(
            'button',
            {
              class: 'link',
              onclick: () => {
                if (!confirm('Erstatte alle sjekklister med standardlistene?')) return;
                state.checklists = defaultChecklists();
                save();
              },
            },
            'Standardlister',
          )
        : null,
    ),
    ...state.checklists.map((c, ci) => {
      const done = c.items.filter((i) => i.done).length;
      return section(
        editing ? '' : `${c.name} (${done}/${c.items.length})`,
        editing
          ? h(
              'div',
              { class: 'row' },
              h('input', { type: 'text', class: 'grow', value: c.name, onchange: (e: Event) => ((c.name = (e.target as HTMLInputElement).value), save()) }),
              h('button', { onclick: () => confirm(`Slette «${c.name}»?`) && (state.checklists.splice(ci, 1), save()) }, 'Slett liste'),
            )
          : null,
        h(
          'ul',
          { class: 'checklist' },
          c.items.map((it, ii) =>
            editing
              ? h(
                  'li',
                  { class: 'row' },
                  h('input', { type: 'text', class: 'grow', value: it.text, onchange: (e: Event) => ((it.text = (e.target as HTMLInputElement).value), save()) }),
                  h('button', { onclick: () => (c.items.splice(ii, 1), save()) }, '✕'),
                )
              : h(
                  'li',
                  { class: it.done ? 'done' : '', onclick: () => ((it.done = !it.done), save()) },
                  h('span', { class: 'box' }, it.done ? '✓' : ''),
                  it.text,
                ),
          ),
        ),
        editing ? h('button', { onclick: () => (c.items.push({ text: 'Nytt punkt', done: false }), save()) }, '+ Punkt') : null,
      );
    }),
  );
}
