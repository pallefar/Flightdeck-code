export interface QuickInspectorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function ordered(rect: QuickInspectorRect): QuickInspectorRect {
  return {
    left: Math.min(rect.left, rect.right), top: Math.min(rect.top, rect.bottom),
    right: Math.max(rect.left, rect.right), bottom: Math.max(rect.top, rect.bottom),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Viewport CSS pixels only; never reads or changes canvas/DOM geometry.
 * Nonfinite numeric inputs return the origin with zero size. Reversed edges are
 * normalized on copies; negative viewport dimensions are clamped to zero.
 * An empty inset/menu region returns zero size, anchored inside the raw visible
 * intersection when one exists (otherwise at the viewport-clamped editor origin).
 * Node avoidance may return zero maxHeight: callers must not impose a minimum.
 */
export function quickInspectorPlacement(
  editor: QuickInspectorRect,
  selected: QuickInspectorRect | null,
  viewport: {width: number; height: number},
  menuBottom: number,
): {left: number; top: number; width: number; maxHeight: number} {
  if (![editor.left, editor.top, editor.right, editor.bottom,
    viewport.width, viewport.height, menuBottom,
    ...(selected ? [selected.left, selected.top, selected.right, selected.bottom] : []),
  ].every(Number.isFinite)) {
    return {left: 0, top: 0, width: 0, maxHeight: 0};
  }
  editor = ordered(editor);
  selected = selected ? ordered(selected) : null;
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);
  const visibleLeft = Math.max(0, editor.left);
  const visibleRight = Math.min(viewportWidth, editor.right);
  const visibleTop = Math.max(0, editor.top);
  const visibleBottom = Math.min(viewportHeight, editor.bottom);
  if (visibleLeft > visibleRight || visibleTop > visibleBottom) {
    return {
      left: clamp(editor.left, 0, viewportWidth), top: clamp(editor.top, 0, viewportHeight),
      width: 0, maxHeight: 0,
    };
  }
  const leftBound = visibleLeft + 8;
  const rightBound = visibleRight - 8;
  const topBound = Math.max(visibleTop + 8, menuBottom + 4);
  const bottomBound = visibleBottom - 8;
  if (rightBound <= leftBound || bottomBound <= topBound) {
    return {
      left: clamp(leftBound, visibleLeft, visibleRight),
      top: clamp(topBound, visibleTop, visibleBottom), width: 0, maxHeight: 0,
    };
  }
  const width = Math.min(320, rightBound - leftBound);
  let top = topBound;
  let availableHeight = bottomBound - topBound;
  if (selected && selected.left < selected.right && selected.top < selected.bottom
    && selected.left < rightBound && selected.right > rightBound - width
    && selected.top < bottomBound && selected.bottom > topBound) {
    // Preserve the chosen right x band; keep the entire node plus its 8px gap
    // clear, compare uncapped space, and prefer above on an exact tie.
    const above = Math.max(0, Math.min(bottomBound, selected.top - 8) - topBound);
    const belowTop = Math.max(topBound, Math.min(bottomBound, selected.bottom + 8));
    const below = Math.max(0, bottomBound - belowTop);
    if (below > above) {
      top = belowTop;
      availableHeight = below;
    } else {
      availableHeight = above;
    }
  }
  return {left: rightBound - width, top, width, maxHeight: Math.min(520, availableHeight)};
}
