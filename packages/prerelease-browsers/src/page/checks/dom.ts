import type { CheckDefinition } from '../harness.ts';

const snapshotBasic: CheckDefinition = {
  id: 'snapshot-basic',
  kind: 'functional',
  tier: 'focused',
  async run(ctx) {
    document.body.innerHTML = '<main><h1>hello</h1><ul><li>1</li></ul></main>';
    const recording = ctx.record();
    await ctx.nextFrame();
    // An empty li, so the mutation carries exactly one added node.
    document.querySelector('ul')!.appendChild(document.createElement('li'));
    const events = await recording.stop();

    if (!events.some((e) => e.type === 2)) {
      return { ok: false, message: 'no FullSnapshot event', events };
    }
    const addedLi = events.some(
      (e) =>
        e.type === 3 &&
        e.data.source === 0 &&
        e.data.adds.length === 1 &&
        e.data.adds[0].node.type === 2 &&
        e.data.adds[0].node.tagName === 'li',
    );
    if (!addedLi) {
      return {
        ok: false,
        message: 'no Mutation event adding exactly one li',
        events,
      };
    }
    const replayed = (await ctx.replay(events)).querySelectorAll('li').length;
    if (replayed !== 2) {
      return {
        ok: false,
        message: `replay has ${replayed} li elements, expected 2`,
        events,
      };
    }
    return { ok: true, events };
  },
};

export const domChecks: CheckDefinition[] = [snapshotBasic];
