import type {Graph} from '../../packages/workflow/graph';

export interface StackedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
}
export interface StackedEdge {
  id: string;
  source: string;
  target: string;
  sourcePort: 'default' | 'true' | 'false';
  path: string;
  label: string;
  labelX: number;
  labelY: number;
}
export interface StackedLayout {
  nodes: StackedNode[];
  edges: StackedEdge[];
  width: number;
  height: number;
}

const CARD_WIDTH = 300;
const PADDING = 24;
const LAYER_GAP = 100;
const HORIZONTAL_GAP = 48;
const compareId = (a: {id: string}, b: {id: string}) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function invalid(): never {
  throw new Error('Invalid workflow graph for stacked layout');
}

/** Bounded topology admission only; editor graph/config validation remains authoritative. */
function assertTopology(graph: Graph) {
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length > 100 ||
    !Array.isArray(graph.edges) || graph.edges.length > 300 ||
    !Array.isArray(graph.customBlocks) || graph.customBlocks.length > 50) invalid();
  const validId = (id: unknown) => typeof id === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id);
  const wrappers = new Map<string, string>();
  for (const block of graph.customBlocks) {
    if (!block || !validId(block.id) || typeof block.baseType !== 'string' || wrappers.has(block.id)) invalid();
    wrappers.set(block.id, block.baseType);
  }
  const types = new Map<string, string>();
  for (const node of graph.nodes) {
    if (!node || !validId(node.id) || !validId(node.type) || types.has(node.id)) invalid();
    types.set(node.id, wrappers.get(node.type) ?? node.type);
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!edge || !validId(edge.id) || edgeIds.has(edge.id) || !types.has(edge.source) || !types.has(edge.target)) invalid();
    if (types.get(edge.source) === 'branch'
      ? edge.sourcePort !== 'true' && edge.sourcePort !== 'false'
      : edge.sourcePort !== undefined && edge.sourcePort !== 'default') invalid();
    edgeIds.add(edge.id);
  }
}

/** Nearest nonoverlapping ordered row (isotonic regression on x minus card pitch). */
function separateLayer(row: StackedNode[]) {
  row.sort((a, b) => a.x - b.x || compareId(a, b));
  const pitch = CARD_WIDTH + HORIZONTAL_GAP;
  const blocks: Array<{start: number; count: number; sum: number}> = [];
  for (let i = 0; i < row.length; i++) {
    blocks.push({start: i, count: 1, sum: row[i]!.x - i * pitch});
    while (blocks.length > 1) {
      const right = blocks[blocks.length - 1]!, left = blocks[blocks.length - 2]!;
      if (left.sum / left.count <= right.sum / right.count) break;
      left.sum += right.sum;
      left.count += right.count;
      blocks.pop();
    }
  }
  for (const block of blocks) {
    for (let i = block.start; i < block.start + block.count; i++) row[i]!.x = Math.round(block.sum / block.count) + i * pitch;
  }
}

/** Derived presentation geometry only; never writes authored positions. */
export function stackedWorkflowLayout(graph: Graph, compact = false): StackedLayout {
  assertTopology(graph);
  const cardHeight = compact ? 104 : 156;
  const incoming = new Map(graph.nodes.map(n => [n.id, graph.edges.filter(e => e.target === n.id)]));
  const outgoing = new Map(graph.nodes.map(n => [n.id, graph.edges.filter(e => e.source === n.id)]));
  const remaining = new Map(graph.nodes.map(n => [n.id, incoming.get(n.id)!.length]));
  const layers = new Map(graph.nodes.map(n => [n.id, 0]));
  const ready = graph.nodes.filter(n => remaining.get(n.id) === 0).slice().sort(compareId);
  const nodes: StackedNode[] = [];
  const byId = new Map<string, StackedNode>();
  while (ready.length) {
    const current = ready.shift()!;
    const layer = layers.get(current.id)!;
    const placed = {id: current.id, x: 0, y: PADDING + layer * (cardHeight + LAYER_GAP),
      width: CARD_WIDTH, height: cardHeight, layer};
    nodes.push(placed);
    byId.set(current.id, placed);
    for (const edge of outgoing.get(current.id)!) {
      layers.set(edge.target, Math.max(layers.get(edge.target)!, layer + 1));
      remaining.set(edge.target, remaining.get(edge.target)! - 1);
      if (remaining.get(edge.target) === 0) ready.push(graph.nodes.find(n => n.id === edge.target)!);
    }
    ready.sort(compareId);
  }
  if (nodes.length !== graph.nodes.length) invalid();
  nodes.sort((a, b) => a.layer - b.layer || compareId(a, b));
  const parents = new Map(nodes.map(n => [n.id, [...new Set(incoming.get(n.id)!.map(e => e.source))].sort()]));
  const offsets = new Map<string, number>();
  const extents = new Map<string, {min: number; max: number}>();
  // Reserve the single-parent descendants' space before positioning their ancestor.
  // A shared join is not duplicated into either branch's reservation.
  for (const node of nodes.slice().reverse()) {
    const children = nodes.filter(n => parents.get(n.id)!.length === 1 && parents.get(n.id)![0] === node.id).sort(compareId);
    const port = (child: StackedNode) => {
      const ports = new Set(incoming.get(child.id)!.map(e => e.sourcePort ?? 'default'));
      return ports.size === 1 ? [...ports][0]! : 'default';
    };
    const centered = children.filter(n => port(n) === 'default');
    const centerWidth = centered.reduce((sum, n) => sum + extents.get(n.id)!.max - extents.get(n.id)!.min, 0) +
      Math.max(0, centered.length - 1) * HORIZONTAL_GAP;
    let cursor = -centerWidth / 2;
    for (const child of centered) {
      const extent = extents.get(child.id)!;
      offsets.set(child.id, centered.length === 1 ? 0 : cursor - extent.min);
      cursor += extent.max - extent.min + HORIZONTAL_GAP;
    }
    const centerMin = centered.length ? Math.min(...centered.map(n => offsets.get(n.id)! + extents.get(n.id)!.min)) : 0;
    const centerMax = centered.length ? Math.max(...centered.map(n => offsets.get(n.id)! + extents.get(n.id)!.max)) : 0;
    cursor = centerMin - (centered.length ? HORIZONTAL_GAP : HORIZONTAL_GAP / 2);
    for (const child of children.filter(n => port(n) === 'true').reverse()) {
      const extent = extents.get(child.id)!;
      const offset = cursor - extent.max;
      offsets.set(child.id, offset);
      cursor = offset + extent.min - HORIZONTAL_GAP;
    }
    cursor = centerMax + (centered.length ? HORIZONTAL_GAP : HORIZONTAL_GAP / 2);
    for (const child of children.filter(n => port(n) === 'false')) {
      const extent = extents.get(child.id)!;
      const offset = cursor - extent.min;
      offsets.set(child.id, offset);
      cursor = offset + extent.max + HORIZONTAL_GAP;
    }
    extents.set(node.id, {
      min: Math.min(-CARD_WIDTH / 2, ...children.map(n => offsets.get(n.id)! + extents.get(n.id)!.min)),
      max: Math.max(CARD_WIDTH / 2, ...children.map(n => offsets.get(n.id)! + extents.get(n.id)!.max)),
    });
  }
  let rootCursor = 0;
  for (let layer = 0; layer <= (nodes.at(-1)?.layer ?? -1); layer++) {
    const row = nodes.filter(n => n.layer === layer);
    for (const node of row) {
      const sources = parents.get(node.id)!;
      if (sources.length) {
        node.x = Math.round(sources.reduce((sum, id) => sum + byId.get(id)!.x, 0) / sources.length) +
          (sources.length === 1 ? offsets.get(node.id)! : 0);
      } else {
        const extent = extents.get(node.id)!;
        node.x = rootCursor - extent.min;
        rootCursor += extent.max - extent.min + HORIZONTAL_GAP;
      }
    }
    separateLayer(row);
  }
  const left = nodes.length ? Math.min(...nodes.map(n => n.x)) : 0;
  for (const node of nodes) node.x += PADDING - left;
  const nodeRight=nodes.length?Math.max(...nodes.map(n=>n.x+n.width)):CARD_WIDTH+PADDING;
  let routedEdges=0;
  const edges = graph.edges.slice().sort(compareId).map(edge => {
    const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
    const port = edge.sourcePort ?? 'default';
    const sx = source.x + CARD_WIDTH * (port === 'true' ? .25 : port === 'false' ? .75 : .5), sy = source.y + cardHeight;
    const tx = target.x + CARD_WIDTH / 2, ty = target.y;
    const midY = (sy + ty) / 2;
    // A covered bypass must not look like a connection through the intervening
    // block (especially a human gate). Reserve a visible external routing lane.
    const obscured=nodes.some(n=>n.layer>source.layer&&n.layer<target.layer&&n.x<=Math.max(sx,tx)&&n.x+n.width>=Math.min(sx,tx));
    const gutter=obscured?nodeRight+48+12*routedEdges++:null;
    return {...edge, sourcePort: edge.sourcePort ?? 'default',
      path: gutter===null?`M${sx},${sy} C${sx},${midY} ${tx},${midY} ${tx},${ty}`:
        `M${sx},${sy} C${sx},${sy+24} ${gutter},${sy+24} ${gutter},${sy+48} L${gutter},${ty-48} C${gutter},${ty-24} ${tx},${ty-24} ${tx},${ty}`,
      label: port === 'true' ? 'True' : port === 'false' ? 'False' : '', labelX: (sx + (gutter??tx)) / 2, labelY: gutter===null?midY:sy+24};
  });
  return {nodes, edges, width: nodeRight+(routedEdges?48+12*(routedEdges-1):0)+PADDING,
    height: nodes.length ? Math.max(...nodes.map(n => n.y + n.height)) + PADDING : 2 * PADDING};
}
