import {describe, expect, it} from 'vitest';
import {quickInspectorPlacement, type QuickInspectorRect} from './quick-inspector-layout';

const mobileEditor: QuickInspectorRect = {left: 16, top: 173, right: 374, bottom: 1231};
const mobileSelected: QuickInspectorRect = {
  left: 110.739, top: 358.174, right: 169.661, bottom: 396.741,
};

// Captured 390 × 600 viewport CSS rectangles, also replayed against the shorter 360 × 520 viewport.
describe('quickInspectorPlacement', () => {
  it('keeps a deterministic finite geometry matrix contained without touching a visible node', () => {
    const viewports = [
      {width: 0, height: 0}, {width: 10, height: 12}, {width: 360, height: 520},
      {width: 390, height: 600}, {width: 1280, height: 900},
      {width: Number.MAX_VALUE, height: Number.MAX_VALUE},
    ];
    const editors = [
      mobileEditor, {left: -50, top: -300, right: 800, bottom: 450},
      {left: 700, top: 900, right: 1200, bottom: 1400},
      {left: 0, top: 0, right: 10, bottom: 12},
      {left: 800, top: 700, right: -100, bottom: -200},
      {left: -Number.MAX_VALUE, top: -Number.MAX_VALUE, right: Number.MAX_VALUE, bottom: Number.MAX_VALUE},
    ];
    const nodes = [null, mobileSelected, {left: -100, top: -300, right: 200, bottom: 300},
      {left: 100, top: 200, right: 1000, bottom: 1000}];
    for (const viewport of viewports) for (const editor of editors) for (const selected of nodes) {
      for (const menuBottom of [0, 204, 1000]) {
        const placed = quickInspectorPlacement(editor, selected, viewport, menuBottom);
        expect(quickInspectorPlacement(editor, selected, viewport, menuBottom)).toEqual(placed);
        expect(Object.values(placed).every(Number.isFinite)).toBe(true);
        expect(placed.width).toBeGreaterThanOrEqual(0);
        expect(placed.width).toBeLessThanOrEqual(320);
        expect(placed.maxHeight).toBeGreaterThanOrEqual(0);
        expect(placed.maxHeight).toBeLessThanOrEqual(520);
        expect(placed.left).toBeGreaterThanOrEqual(0);
        expect(placed.top).toBeGreaterThanOrEqual(0);
        expect(placed.left + placed.width).toBeLessThanOrEqual(viewport.width);
        expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(viewport.height);
        const left = Math.max(0, Math.min(editor.left, editor.right));
        const right = Math.min(viewport.width, Math.max(editor.left, editor.right));
        const top = Math.max(0, Math.min(editor.top, editor.bottom));
        const bottom = Math.min(viewport.height, Math.max(editor.top, editor.bottom));
        if (left <= right && top <= bottom) {
          expect(placed.left).toBeGreaterThanOrEqual(left);
          expect(placed.top).toBeGreaterThanOrEqual(top);
          expect(placed.left + placed.width).toBeLessThanOrEqual(right);
          expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(bottom);
        }
        if (placed.width > 0 && placed.maxHeight > 0) {
          expect(placed.left).toBeGreaterThanOrEqual(left + 8);
          expect(placed.top).toBeGreaterThanOrEqual(Math.max(top + 8, menuBottom + 4));
          expect(placed.left + placed.width).toBeLessThanOrEqual(right - 8);
          expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(bottom - 8);
          if (selected && selected.left < placed.left + placed.width && selected.right > placed.left
            && selected.top < bottom - 8 && selected.bottom > Math.max(top + 8, menuBottom + 4)) {
            expect(placed.top + placed.maxHeight <= selected.top - 8 || placed.top >= selected.bottom + 8).toBe(true);
          }
        }
      }
    }
  });

  it.each([
    {selected: {left: 1000, top: 300, right: 1180, bottom: 400},
      expected: {left: 912, top: 408, width: 320, maxHeight: 484}},
    {selected: {left: 1000, top: 650, right: 1180, bottom: 760},
      expected: {left: 912, top: 120, width: 320, maxHeight: 520}},
    {selected: {left: 800, top: 300, right: 912, bottom: 400},
      expected: {left: 912, top: 120, width: 320, maxHeight: 520}},
    {selected: {left: 1232, top: 300, right: 1300, bottom: 400},
      expected: {left: 912, top: 120, width: 320, maxHeight: 520}},
  ])('keeps the right x band and avoids a desktop node only when needed: %j', ({selected, expected}) => {
    expect(quickInspectorPlacement({left: 40, top: 80, right: 1240, bottom: 1000}, selected,
      {width: 1280, height: 900}, 116)).toEqual(expected);
  });

  it('compares uncapped available regions before applying the 520px height limit', () => {
    expect(quickInspectorPlacement({left: 0, top: 0, right: 1200, bottom: 1800},
      {left: 1000, top: 700, right: 1100, bottom: 800}, {width: 1200, height: 1600}, 116))
      .toEqual({left: 872, top: 808, width: 320, maxHeight: 520});
  });

  it('breaks equal-height region ties above the node deterministically', () => {
    expect(quickInspectorPlacement({left: 0, top: 0, right: 360, bottom: 400},
      {left: 100, top: 180, right: 200, bottom: 220}, {width: 360, height: 400}, 0))
      .toEqual({left: 32, top: 8, width: 320, maxHeight: 164});
  });

  it('uses viewport rectangles after nonzero horizontal and vertical page scroll', () => {
    const scroll = {x: 180, y: 700};
    const fromDocument = (rect: QuickInspectorRect): QuickInspectorRect => ({
      left: rect.left - scroll.x, right: rect.right - scroll.x,
      top: rect.top - scroll.y, bottom: rect.bottom - scroll.y,
    });
    const editor = fromDocument({left: 240, top: 120, right: 1100, bottom: 1400});
    const selected = fromDocument({left: 950, top: 850, right: 1050, bottom: 920});
    expect(quickInspectorPlacement(editor, selected, {width: 1200, height: 800}, 158 - scroll.y))
      .toEqual({left: 592, top: 228, width: 320, maxHeight: 464});
  });

  it('retains only two available pixels rather than forcing a minimum drawer height', () => {
    expect(quickInspectorPlacement({left: 0, top: 0, right: 360, bottom: 120},
      {left: 100, top: 24, right: 200, bottom: 102}, {width: 360, height: 120}, 20))
      .toEqual({left: 32, top: 110, width: 320, maxHeight: 2});
  });

  it('returns zero height when the selected node leaves no nonoverlapping vertical region', () => {
    expect(quickInspectorPlacement(mobileEditor, {left: 100, top: 200, right: 200, bottom: 600},
      {width: 390, height: 600}, 204)).toEqual({left: 46, top: 208, width: 320, maxHeight: 0});
  });

  it('uses the entire selected node when only part of it is visible', () => {
    expect(quickInspectorPlacement(mobileEditor, {left: 100, top: -200, right: 200, bottom: 300},
      {width: 390, height: 600}, 204)).toEqual({left: 46, top: 308, width: 320, maxHeight: 284});
  });

  it.each([
    {editor: {left: 20, top: 30, right: 38, bottom: 100},
      expected: {left: 28, top: 38, width: 2, maxHeight: 54}},
    {editor: {left: 20, top: 30, right: 200, bottom: 47},
      expected: {left: 28, top: 38, width: 164, maxHeight: 1}},
  ])('preserves a positive but tiny available region: %j', ({editor, expected}) => {
    expect(quickInspectorPlacement(editor, null, {width: 390, height: 600}, 0)).toEqual(expected);
  });

  it.each([
    {left: 100, top: 300, right: 100, bottom: 400},
    {left: 100, top: 300, right: 200, bottom: 300},
  ])('treats an empty selected rectangle as no node: %j', selected => {
    expect(quickInspectorPlacement(mobileEditor, selected, {width: 390, height: 600}, 204))
      .toEqual(quickInspectorPlacement(mobileEditor, null, {width: 390, height: 600}, 204));
  });

  it.each([NaN, Infinity, -Infinity])('returns safe zero for every nonfinite numeric input (%s)', bad => {
    const zero = {left: 0, top: 0, width: 0, maxHeight: 0};
    const viewport = {width: 390, height: 600};
    for (const field of ['left', 'top', 'right', 'bottom'] as const) {
      expect(quickInspectorPlacement({...mobileEditor, [field]: bad}, mobileSelected, viewport, 204)).toEqual(zero);
      expect(quickInspectorPlacement(mobileEditor, {...mobileSelected, [field]: bad}, viewport, 204)).toEqual(zero);
    }
    for (const field of ['width', 'height'] as const) {
      expect(quickInspectorPlacement(mobileEditor, mobileSelected, {...viewport, [field]: bad}, 204)).toEqual(zero);
    }
    expect(quickInspectorPlacement(mobileEditor, mobileSelected, viewport, bad)).toEqual(zero);
  });

  it.each([
    {editor: {left: 20, top: 30, right: 30, bottom: 40}, viewport: {width: 390, height: 600}, menu: 0,
      expected: {left: 28, top: 38, width: 0, maxHeight: 0}},
    {editor: {left: 20, top: 30, right: 20, bottom: 30}, viewport: {width: 390, height: 600}, menu: 0,
      expected: {left: 20, top: 30, width: 0, maxHeight: 0}},
    {editor: {left: 500, top: 30, right: 700, bottom: 200}, viewport: {width: 390, height: 600}, menu: 0,
      expected: {left: 390, top: 30, width: 0, maxHeight: 0}},
    {editor: {left: -700, top: 30, right: -500, bottom: 200}, viewport: {width: 390, height: 600}, menu: 0,
      expected: {left: 0, top: 30, width: 0, maxHeight: 0}},
    {editor: {left: 20, top: -1000, right: 200, bottom: -500}, viewport: {width: 390, height: 600}, menu: 0,
      expected: {left: 20, top: 0, width: 0, maxHeight: 0}},
    {editor: {left: 20, top: 700, right: 200, bottom: 900}, viewport: {width: 390, height: 600}, menu: 0,
      expected: {left: 20, top: 600, width: 0, maxHeight: 0}},
    {editor: {left: 0, top: 0, right: 100, bottom: 100}, viewport: {width: -10, height: -20}, menu: 0,
      expected: {left: 0, top: 0, width: 0, maxHeight: 0}},
    {editor: {left: 0, top: 0, right: 100, bottom: 100}, viewport: {width: 10, height: 12}, menu: 0,
      expected: {left: 8, top: 8, width: 0, maxHeight: 0}},
    {editor: {left: 20, top: 30, right: 200, bottom: 400}, viewport: {width: 390, height: 600}, menu: 1000,
      expected: {left: 28, top: 400, width: 0, maxHeight: 0}},
  ])('returns a bounded empty placement when no inset region exists: %j', ({editor, viewport, menu, expected}) => {
    expect(quickInspectorPlacement(editor, null, viewport, menu)).toEqual(expected);
  });

  it.each([[false, true], [true, false], [true, true]])(
    'normalizes reversed edges without mutating frozen inputs (editor=%s, node=%s)',
    (reverseEditor, reverseSelected) => {
      const reverse = (rect: QuickInspectorRect): QuickInspectorRect => ({
        left: rect.right, top: rect.bottom, right: rect.left, bottom: rect.top,
      });
      const editor = Object.freeze(reverseEditor ? reverse(mobileEditor) : {...mobileEditor});
      const selected = Object.freeze(reverseSelected ? reverse(mobileSelected) : {...mobileSelected});
      const viewport = Object.freeze({width: 390, height: 600});
      const before = JSON.stringify({editor, selected, viewport});
      const expected = quickInspectorPlacement(mobileEditor, mobileSelected, viewport, 204);
      for (let attempt = 0; attempt < 5; attempt++) {
        expect(quickInspectorPlacement(editor, selected, viewport, 204)).toEqual(expected);
      }
      expect(JSON.stringify({editor, selected, viewport})).toBe(before);
    },
  );

  it.each([
    {left: 100, top: 190, right: 200, bottom: 207},
    {left: 100, top: 593, right: 200, bottom: 620},
    {left: -100, top: 300, right: 23, bottom: 400},
    {left: 367, top: 300, right: 420, bottom: 400},
  ])('ignores a node outside visible placement bounds: %j', selected => {
    expect(quickInspectorPlacement(mobileEditor, selected, {width: 390, height: 600}, 204))
      .toEqual({left: 46, top: 208, width: 320, maxHeight: 384});
  });

  it('keeps the full right drawer when a desktop node is left of its x band', () => {
    const editor = {left: 40, top: 80, right: 1240, bottom: 1000};
    const selected = {left: 50, top: 300, right: 250, bottom: 400};
    const viewport = {width: 1280, height: 900};
    const expected = {left: 912, top: 120, width: 320, maxHeight: 520};
    expect(quickInspectorPlacement(editor, selected, viewport, 116)).toEqual(expected);
    expect(quickInspectorPlacement(editor, null, viewport, 116)).toEqual(expected);
  });

  it('uses the larger region above the same node at 360 × 520', () => {
    const placed = quickInspectorPlacement(mobileEditor, mobileSelected, {width: 360, height: 520}, 204);
    expect(placed).toEqual({
      left: 32, top: 208, width: 320, maxHeight: mobileSelected.top - 8 - 208,
    });
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(mobileSelected.top - 8);
  });

  it('keeps the clicked mobile node hittable at 390 × 600', () => {
    const placed = quickInspectorPlacement(mobileEditor, mobileSelected, {width: 390, height: 600}, 204);
    expect(placed).toEqual({
      left: 46, top: mobileSelected.bottom + 8, width: 320,
      maxHeight: 600 - 8 - (mobileSelected.bottom + 8),
    });
    expect(placed.top).toBeGreaterThanOrEqual(mobileSelected.bottom + 8);
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(592);
  });
});
