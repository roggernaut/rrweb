import type { eventWithTime } from '@rrweb/types';
import type { CheckContext, CheckDefinition } from '../harness.ts';

/** The Input events (source 5) recorded for one node id, in order. */
function inputEventsFor(events: eventWithTime[], id: number) {
  return events.flatMap((e) =>
    e.type === 3 /* IncrementalSnapshot */ &&
    e.data.source === 5 /* Input */ &&
    e.data.id === id
      ? [e.data]
      : [],
  );
}

function idOf(ctx: CheckContext, node: Node): number {
  return ctx.rrweb.record.mirror.getId(node);
}

/** A valid value for each input type under test. */
const inputTypeValues: Array<[type: string, value: string]> = [
  ['text', 'hello'],
  ['email', 'person@example.com'],
  ['tel', '555-0100'],
  ['url', 'https://example.com/path'],
  ['search', 'query'],
  ['number', '42'],
  ['range', '7'],
  ['date', '2024-02-29'],
  ['time', '13:45'],
  ['datetime-local', '2024-02-29T13:45'],
  ['month', '2024-02'],
  ['week', '2024-W09'],
  ['color', '#ff8800'],
];

const inputTypes: CheckDefinition = {
  id: 'input-types',
  kind: 'functional',
  tier: 'focused',
  async run(ctx) {
    document.body.innerHTML = '';
    const inputs = inputTypeValues.map(([type]) => {
      const input = document.createElement('input');
      input.type = type;
      document.body.appendChild(input);
      return input;
    });
    const recording = ctx.record();
    await ctx.nextFrame();
    inputs.forEach((input, i) => {
      input.value = inputTypeValues[i][1];
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const events = await recording.stop();

    const problems: string[] = [];
    inputs.forEach((input, i) => {
      // A type the browser does not support falls back to text; its live
      // value is what counts.
      const label = `${inputTypeValues[i][0]} (live type ${input.type})`;
      const recorded = inputEventsFor(events, idOf(ctx, input));
      if (!recorded.length) {
        problems.push(`${label}: no Input event`);
        return;
      }
      const text = recorded[recorded.length - 1].text;
      if (text !== input.value) {
        problems.push(
          `${label}: recorded ${JSON.stringify(text)}, live ${JSON.stringify(
            input.value,
          )}`,
        );
      }
    });
    return problems.length
      ? { ok: false, message: problems.join('; '), events }
      : { ok: true, events };
  },
};

const checkboxRadio: CheckDefinition = {
  id: 'checkbox-radio',
  kind: 'functional',
  tier: 'full',
  async run(ctx) {
    document.body.innerHTML =
      '<input type="checkbox" id="cb"><input type="radio" name="r" id="r1"><input type="radio" name="r" id="r2">';
    const targets = ['cb', 'r2'].map(
      (id) => document.getElementById(id) as HTMLInputElement,
    );
    const recording = ctx.record();
    await ctx.nextFrame();
    for (const target of targets) target.click();
    const events = await recording.stop();

    const problems: string[] = [];
    for (const target of targets) {
      const recorded = inputEventsFor(events, idOf(ctx, target));
      if (!target.checked) problems.push(`${target.id}: live is not checked`);
      else if (!recorded.some((data) => data.isChecked === true)) {
        problems.push(`${target.id}: no Input event with isChecked true`);
      }
    }
    return problems.length
      ? { ok: false, message: problems.join('; '), events }
      : { ok: true, events };
  },
};

const selectCheck: CheckDefinition = {
  id: 'select',
  kind: 'functional',
  tier: 'full',
  async run(ctx) {
    document.body.innerHTML =
      '<select id="s"><option value="first">One</option><option value="second">Two</option></select>';
    const select = document.getElementById('s') as HTMLSelectElement;
    const recording = ctx.record();
    await ctx.nextFrame();
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const events = await recording.stop();

    if (select.value !== 'second') {
      return { ok: false, message: 'live select did not change', events };
    }
    const recorded = inputEventsFor(events, idOf(ctx, select));
    if (!recorded.some((data) => data.text === select.value)) {
      return {
        ok: false,
        message: `no Input event with text ${JSON.stringify(select.value)}`,
        events,
      };
    }
    return { ok: true, events };
  },
};

const contenteditable: CheckDefinition = {
  id: 'contenteditable',
  kind: 'functional',
  tier: 'full',
  async run(ctx) {
    document.body.innerHTML =
      '<div id="ce" contenteditable="true">before</div>';
    const text = document.getElementById('ce')!.firstChild as Text;
    const recording = ctx.record();
    await ctx.nextFrame();
    text.data = 'after the edit';
    const events = await recording.stop();

    const id = idOf(ctx, text);
    const changed = events.some(
      (e) =>
        e.type === 3 /* IncrementalSnapshot */ &&
        e.data.source === 0 /* Mutation */ &&
        e.data.texts.some((t) => t.id === id && t.value === text.data),
    );
    if (!changed) {
      return {
        ok: false,
        message: 'no Mutation event with the new text for the edited node',
        events,
      };
    }
    return { ok: true, events };
  },
};

const selection: CheckDefinition = {
  id: 'selection',
  kind: 'functional',
  tier: 'full',
  async run(ctx) {
    document.body.innerHTML =
      '<p id="a">first paragraph</p><p id="b">second paragraph</p>';
    const first = document.getElementById('a')!.firstChild!;
    const second = document.getElementById('b')!.firstChild!;
    const recording = ctx.record();
    await ctx.nextFrame();
    const range = document.createRange();
    range.setStart(first, 2);
    range.setEnd(second, 5);
    const live = window.getSelection()!;
    live.removeAllRanges();
    live.addRange(range);
    const events = await recording.stop();

    const startId = idOf(ctx, first);
    const endId = idOf(ctx, second);
    const recorded = events.some(
      (e) =>
        e.type === 3 /* IncrementalSnapshot */ &&
        e.data.source === 14 /* Selection */ &&
        e.data.ranges.some(
          (r) =>
            r.start === startId &&
            r.startOffset === 2 &&
            r.end === endId &&
            r.endOffset === 5,
        ),
    );
    if (!recorded) {
      return {
        ok: false,
        message: 'no Selection event spanning both paragraphs',
        events,
      };
    }
    return { ok: true, events };
  },
};

export const inputChecks: CheckDefinition[] = [
  inputTypes,
  checkboxRadio,
  selectCheck,
  contenteditable,
  selection,
];
