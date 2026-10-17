import {describe, expect, it} from 'vitest';
import {createEmptyGraph, graphSchema, type Graph, type GraphNode} from '../../packages/workflow/graph';
import {stackedWorkflowLayout} from './stacked-layout';
import {WorkflowEditorStore} from './store';

function node(id: string, type = 'set'): GraphNode {
  return {id, type, label: id, position: {x: 9999, y: 37}, config: {}};
}
function graph(nodes: GraphNode[], edges: Graph['edges'] = []): Graph {
  return graphSchema.parse({...createEmptyGraph(), nodes, edges});
}

function assertGeometry(input: Graph, layout: ReturnType<typeof stackedWorkflowLayout>, compact = false) {
  expect(layout.nodes.map(n => n.id).sort()).toEqual(input.nodes.map(n => n.id).sort());
  expect(layout.edges.map(e => e.id).sort()).toEqual(input.edges.map(e => e.id).sort());
  expect(new Set(layout.nodes.map(n => n.id)).size).toBe(input.nodes.length);
  expect(new Set(layout.edges.map(e => e.id)).size).toBe(input.edges.length);
  expect(Number.isFinite(layout.width) && layout.width >= 348 && layout.width < 1_000_000).toBe(true);
  expect(Number.isFinite(layout.height) && layout.height >= 48 && layout.height < 26_000).toBe(true);
  const byId = new Map(layout.nodes.map(n => [n.id, n]));
  for (const placed of layout.nodes) {
    expect([placed.x, placed.y, placed.width, placed.height, placed.layer].every(Number.isFinite)).toBe(true);
    expect(placed.width).toBe(300);
    expect(placed.height).toBe(compact ? 104 : 156);
    expect(placed.layer).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(placed.layer)).toBe(true);
    expect(placed.y).toBe(24 + placed.layer * (placed.height + 100));
    expect(placed.x).toBeGreaterThanOrEqual(24);
    expect(placed.x + placed.width + 24).toBeLessThanOrEqual(layout.width);
    expect(placed.y + placed.height + 24).toBeLessThanOrEqual(layout.height);
    for (const other of layout.nodes.filter(n => n.layer === placed.layer && n.x > placed.x)) {
      expect(other.x - placed.x).toBeGreaterThanOrEqual(348);
    }
    expect(layout.nodes.filter(n => n.layer === placed.layer && n.x === placed.x)).toHaveLength(1);
  }
  for (const edge of layout.edges) {
    const actual = input.edges.find(e => e.id === edge.id)!;
    expect({id: edge.id, source: edge.source, target: edge.target, sourcePort: edge.sourcePort})
      .toEqual({...actual, sourcePort: actual.sourcePort ?? 'default'});
    const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
    expect(target.y - source.y - source.height).toBeGreaterThanOrEqual(100);
    const coords = edge.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
    const sx = source.x + (edge.sourcePort === 'true' ? 75 : edge.sourcePort === 'false' ? 225 : 150);
    const sy = source.y + source.height, tx = target.x + 150, ty = target.y;
    if(coords.length===8){
      expect(coords).toEqual([sx, sy, sx, (sy + ty) / 2, tx, (sy + ty) / 2, tx, ty]);
      expect(edge.labelX).toBe((sx + tx) / 2);
      expect(edge.labelY).toBe((sy + ty) / 2);
    }else{
      // New explicit skip-edge visibility contract: same endpoints/ports, but
      // external control points instead of a cubic hidden behind another card.
      expect(coords).toHaveLength(16);
      const gutter=coords[6]!;
      expect(gutter).toBeGreaterThan(Math.max(...layout.nodes.map(n=>n.x+n.width))+16);
      expect(coords).toEqual([sx,sy,sx,sy+24,gutter,sy+24,gutter,sy+48,gutter,ty-48,gutter,ty-24,tx,ty-24,tx,ty]);
      expect(edge.labelX).toBe((sx+gutter)/2);expect(edge.labelY).toBe(sy+24);
    }
    expect(coords.every((value, i) => Number.isFinite(value) && value >= 0 && value <= (i % 2 ? layout.height : layout.width))).toBe(true);
    expect(edge.label).toBe(edge.sourcePort === 'true' ? 'True' : edge.sourcePort === 'false' ? 'False' : '');
    // Fixed True/False labels have ample horizontal/vertical room, not just an in-bounds anchor.
    expect(edge.labelX - 24).toBeGreaterThanOrEqual(0);
    expect(edge.labelX + 24).toBeLessThanOrEqual(layout.width);
    expect(edge.labelY - 10).toBeGreaterThanOrEqual(0);
    expect(edge.labelY + 10).toBeLessThanOrEqual(layout.height);
  }
}

describe('stackedWorkflowLayout', () => {
  it('centers a real chain vertically with bottom-to-top cubic edges', () => {
    const input = graph([node('end', 'output'), node('start', 'manual'), node('middle')], [
      {id: 'last', source: 'middle', target: 'end'},
      {id: 'first', source: 'start', target: 'middle', sourcePort: 'default'},
    ]);
    const layout = stackedWorkflowLayout(input);
    expect(layout.nodes.map(n => n.id)).toEqual(['start', 'middle', 'end']);
    expect(layout.nodes.map(n => n.layer)).toEqual([0, 1, 2]);
    expect(layout.nodes.map(n => n.y)).toEqual([24, 280, 536]);
    expect(layout.nodes.every(n => n.width === 300 && n.height === 156)).toBe(true);
    expect(layout.nodes.every(n => n.x + n.width / 2 === layout.width / 2)).toBe(true);
    expect(layout.width).toBe(348);
    expect(layout.height).toBe(716);
    expect(layout.edges).toEqual([
      {id: 'first', source: 'start', target: 'middle', sourcePort: 'default',
        path: 'M174,180 C174,230 174,230 174,280', label: '', labelX: 174, labelY: 230},
      {id: 'last', source: 'middle', target: 'end', sourcePort: 'default',
        path: 'M174,436 C174,486 174,486 174,536', label: '', labelX: 174, labelY: 486},
    ]);
  });

  it.each([false,true])('routes a skip connection around an intermediate review card (compact=%s)', compact => {
    const input=graph([node('start','manual'),node('gate','approval'),node('end','output')],[
      {id:'first',source:'start',target:'gate'},{id:'last',source:'gate',target:'end'},
      {id:'skip',source:'start',target:'end'},
    ]),before=JSON.stringify(input),layout=stackedWorkflowLayout(input,compact);
    const gate=layout.nodes.find(n=>n.id==='gate')!,edge=layout.edges.find(e=>e.id==='skip')!;
    // The cubic's entire x-control hull must visibly clear the intermediate gate
    // through an outside routing channel, not disappear behind its opaque card.
    const xs=edge.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number).filter((_v,i)=>i%2===0);
    expect(Math.max(...xs)).toBeGreaterThan(gate.x+gate.width+16);
    expect(layout.width).toBeGreaterThanOrEqual(Math.max(...xs)+24);
    expect(edge.path.startsWith(`M${layout.nodes[0]!.x+150},${layout.nodes[0]!.y+layout.nodes[0]!.height} C`)).toBe(true);
    expect(edge.path.endsWith(` ${layout.nodes.at(-1)!.x+150},${layout.nodes.at(-1)!.y}`)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('splits True left and False right with stable branch lanes despite shuffled arrays', () => {
    const input = graph([
      node('aFalse'), node('zTrueNext'), node('route', 'branch'), node('zTrue'), node('aFalseNext'),
    ], [
      {id: 'false', source: 'route', target: 'aFalse', sourcePort: 'false'},
      {id: 'true-next', source: 'zTrue', target: 'zTrueNext'},
      {id: 'true', source: 'route', target: 'zTrue', sourcePort: 'true'},
      {id: 'false-next', source: 'aFalse', target: 'aFalseNext'},
    ]);
    const layout = stackedWorkflowLayout(input);
    const get = (id: string) => layout.nodes.find(n => n.id === id)!;
    expect(get('zTrue').x).toBeLessThan(get('route').x);
    expect(get('aFalse').x).toBeGreaterThan(get('route').x);
    expect(get('zTrue').x + 348).toBeLessThanOrEqual(get('aFalse').x);
    expect(get('zTrueNext').x).toBe(get('zTrue').x);
    expect(get('aFalseNext').x).toBe(get('aFalse').x);
    for (const edge of layout.edges) {
      const source = get(edge.source), target = get(edge.target);
      const anchor = edge.sourcePort === 'true' ? 75 : edge.sourcePort === 'false' ? 225 : 150;
      expect(edge.path).toMatch(new RegExp(`^M${source.x + anchor},${source.y + source.height} C`));
      expect(edge.path.endsWith(` ${target.x + 150},${target.y}`)).toBe(true);
      expect(edge.label).toBe(edge.sourcePort === 'true' ? 'True' : edge.sourcePort === 'false' ? 'False' : '');
    }
    expect(stackedWorkflowLayout({...input, nodes: input.nodes.slice().reverse(), edges: input.edges.slice().reverse()})).toEqual(layout);
  });

  it('reserves nested branch space before placing joins beneath unequal-length parents', () => {
    const input = graph([
      node('route', 'branch'), node('inner', 'branch'), node('other'), node('otherNext'),
      node('left'), node('leftNext'), node('right'), node('innerJoin'), node('join'), node('end', 'output'),
    ], [
      {id: 'outer-true', source: 'route', target: 'inner', sourcePort: 'true'},
      {id: 'outer-false', source: 'route', target: 'other', sourcePort: 'false'},
      {id: 'other-next', source: 'other', target: 'otherNext'},
      {id: 'inner-true', source: 'inner', target: 'left', sourcePort: 'true'},
      {id: 'inner-false', source: 'inner', target: 'right', sourcePort: 'false'},
      {id: 'left-next', source: 'left', target: 'leftNext'},
      {id: 'left-join', source: 'leftNext', target: 'innerJoin'},
      {id: 'right-join', source: 'right', target: 'innerJoin'},
      {id: 'inner-join', source: 'innerJoin', target: 'join'},
      {id: 'other-join', source: 'otherNext', target: 'join'},
      {id: 'end', source: 'join', target: 'end'},
    ]);
    const layout = stackedWorkflowLayout(input);
    assertGeometry(input, layout);
    const get = (id: string) => layout.nodes.find(n => n.id === id)!;
    expect(get('left').x).toBeLessThan(get('inner').x);
    expect(get('right').x).toBeGreaterThan(get('inner').x);
    expect(get('inner').x).toBeLessThan(get('route').x);
    expect(get('other').x).toBeGreaterThan(get('route').x);
    expect(get('leftNext').x).toBe(get('left').x);
    expect(get('otherNext').x).toBe(get('other').x);
    expect(get('innerJoin').layer).toBe(4);
    expect(get('join').layer).toBe(5);
    expect(get('end').x).toBe(get('join').x);
    expect(stackedWorkflowLayout({...input, nodes: input.nodes.slice().reverse(), edges: input.edges.slice().reverse()})).toEqual(layout);
  });

  it('keeps disconnected chains and isolated nodes without inferring connecting edges', () => {
    const input = graph([node('loose'), node('tail'), node('start', 'manual'), node('another')], [
      {id: 'only', source: 'start', target: 'tail'},
    ]);
    const layout = stackedWorkflowLayout(input);
    assertGeometry(input, layout);
    expect(layout.edges).toHaveLength(1);
    expect(layout.nodes.filter(n => n.layer === 0)).toHaveLength(3);
    expect(layout.nodes.find(n => n.id === 'tail')!.x).toBe(layout.nodes.find(n => n.id === 'start')!.x);
    expect(stackedWorkflowLayout({...input, nodes: input.nodes.slice().reverse()})).toEqual(layout);
  });

  it('packs the maximum 100-node 300-edge DAG with convergent same-layer joins', () => {
    const nodes = Array.from({length: 100}, (_, i) => node(`n${i}`));
    const edges: Graph['edges'] = [];
    for (let target = 50; target < 56; target++) {
      for (let source = 0; source < 50; source++) edges.push({id: `e${edges.length}`, source: `n${source}`, target: `n${target}`});
    }
    const input = graph(nodes, edges);
    const layout = stackedWorkflowLayout(input);
    assertGeometry(input, layout);
    expect(layout.nodes).toHaveLength(100);
    expect(layout.edges).toHaveLength(300);
    expect(layout.nodes.filter(n => n.layer === 1)).toHaveLength(6);
    expect(stackedWorkflowLayout({...input, nodes: nodes.slice().reverse(), edges: edges.slice().reverse()})).toEqual(layout);
  });

  it('does not bend an ordinary chain to recenter an asymmetric downstream branch', () => {
    const input = graph([node('start', 'manual'), node('step'), node('route', 'branch'), node('yes')], [
      {id: 'a', source: 'start', target: 'step'},
      {id: 'b', source: 'step', target: 'route'},
      {id: 'c', source: 'route', target: 'yes', sourcePort: 'true'},
    ]);
    const layout = stackedWorkflowLayout(input);
    assertGeometry(input, layout);
    const get = (id: string) => layout.nodes.find(n => n.id === id)!;
    expect(get('step').x).toBe(get('start').x);
    expect(get('route').x).toBe(get('step').x);
    expect(get('yes').x).toBeLessThan(get('route').x);
  });

  it.each([
    ['dangling target', (g: Graph) => ({...g, edges: [{id: 'missing', source: 'a', target: 'notThere'}]})],
    ['dangling source', (g: Graph) => ({...g, edges: [{id: 'missing', source: 'notThere', target: 'a'}]})],
    ['self cycle', (g: Graph) => ({...g, edges: [{id: 'loop', source: 'a', target: 'a'}]})],
    ['cycle after valid prefix', (g: Graph) => ({...g, nodes: [...g.nodes, node('c')], edges: [
      {id: 'ab', source: 'a', target: 'b'}, {id: 'bc', source: 'b', target: 'c'}, {id: 'cb', source: 'c', target: 'b'},
    ]})],
    ['disconnected cycle', (g: Graph) => ({...g, nodes: [...g.nodes, node('c'), node('d')], edges: [
      ...g.edges, {id: 'cd', source: 'c', target: 'd'}, {id: 'dc', source: 'd', target: 'c'},
    ]})],
    ['duplicate node id', (g: Graph) => ({...g, nodes: [...g.nodes, node('a')]})],
    ['duplicate edge id', (g: Graph) => ({...g, edges: [...g.edges, ...g.edges]})],
    ['invalid port', (g: Graph) => ({...g, edges: [{id: 'ab', source: 'a', target: 'b', sourcePort: 'sideways'}]} as unknown as Graph)],
    ['branch port on a nonbranch', (g: Graph) => ({...g, edges: [{id: 'ab', source: 'a', target: 'b', sourcePort: 'true'}]} as Graph)],
    ['missing branch port', (g: Graph) => ({...g, nodes: [node('a', 'branch'), node('b')]})],
    ['too many nodes', (g: Graph) => ({...g, nodes: Array.from({length: 101}, (_, i) => node(`n${i}`)), edges: []})],
    ['too many edges', (g: Graph) => ({...g, edges: Array.from({length: 301}, (_, i) => ({id: `e${i}`, source: 'a', target: 'b'}))})],
    ['malformed id', (g: Graph) => ({...g, nodes: [node('bad id')], edges: []})],
    ['null input', () => null as unknown as Graph],
    ['malformed nodes', (g: Graph) => ({...g, nodes: null} as unknown as Graph)],
  ] as const)('refuses %s with one fixed safe error instead of a partial layout', (_name, invalid) => {
    const input = graph([node('a'), node('b')], [{id: 'ab', source: 'a', target: 'b'}]);
    expect(() => stackedWorkflowLayout(invalid(input))).toThrow(new Error('Invalid workflow graph for stacked layout'));
  });

  it('uses compact card heights and corresponding edge anchors without changing horizontal lanes', () => {
    const input = graph([node('start', 'manual'), node('route', 'branch'), node('yes'), node('no')], [
      {id: 'a', source: 'start', target: 'route'},
      {id: 'b', source: 'route', target: 'yes', sourcePort: 'true'},
      {id: 'c', source: 'route', target: 'no', sourcePort: 'false'},
    ]);
    const expanded = stackedWorkflowLayout(input), compact = stackedWorkflowLayout(input, true);
    assertGeometry(input, compact, true);
    expect(compact.nodes.map(n => [n.id, n.x, n.layer])).toEqual(expanded.nodes.map(n => [n.id, n.x, n.layer]));
    expect(compact.height).toBeLessThan(expanded.height);
    expect(compact.edges.map(e => e.path)).not.toEqual(expanded.edges.map(e => e.path));
    expect(stackedWorkflowLayout(createEmptyGraph(), true)).toEqual(stackedWorkflowLayout(createEmptyGraph()));
  });

  it('returns a finite padded empty surface without inventing blocks or connections', () => {
    const layout = stackedWorkflowLayout(createEmptyGraph());
    expect(layout).toEqual({nodes: [], edges: [], width: 348, height: 48});
  });

  it('supports multiple actual edges per branch port without collapsing targets or duplicate endpoint pairs', () => {
    const input = graph([node('route', 'branch'), node('aFalse'), node('bFalse'), node('yTrue'), node('zTrue'), node('join')], [
      {id: 't1', source: 'route', target: 'zTrue', sourcePort: 'true'},
      {id: 't2', source: 'route', target: 'yTrue', sourcePort: 'true'},
      {id: 't3', source: 'route', target: 'yTrue', sourcePort: 'true'},
      {id: 'f1', source: 'route', target: 'aFalse', sourcePort: 'false'},
      {id: 'f2', source: 'route', target: 'bFalse', sourcePort: 'false'},
      ...['aFalse', 'bFalse', 'yTrue', 'zTrue'].map((source, i) => ({id: `j${i}`, source, target: 'join'})),
    ]);
    const layout = stackedWorkflowLayout(input);
    assertGeometry(input, layout);
    const get = (id: string) => layout.nodes.find(n => n.id === id)!;
    for (const id of ['yTrue', 'zTrue']) expect(get(id).x).toBeLessThan(get('route').x);
    for (const id of ['aFalse', 'bFalse']) expect(get(id).x).toBeGreaterThan(get('route').x);
    expect(layout.edges.filter(e => e.sourcePort === 'true')).toHaveLength(3);
    expect(stackedWorkflowLayout({...input, nodes: input.nodes.slice().reverse(), edges: input.edges.slice().reverse()})).toEqual(layout);
  });

  it('renders a shared True/False target once rather than fabricating two copies of the join', () => {
    const input = graph([node('route', 'branch'), node('shared'), node('tail')], [
      {id: 't', source: 'route', target: 'shared', sourcePort: 'true'},
      {id: 'f', source: 'route', target: 'shared', sourcePort: 'false'},
      {id: 'next', source: 'shared', target: 'tail'},
    ]);
    const layout = stackedWorkflowLayout(input);
    assertGeometry(input, layout);
    expect(new Set(layout.nodes.map(n => n.x)).size).toBe(1);
    expect(layout.edges.map(e => e.label).sort()).toEqual(['', 'False', 'True']);
  });

  it('keeps reviewed wrapper branches and wrapper data blocks as ordinary actual graph nodes', () => {
    const input = graphSchema.parse({...createEmptyGraph(), nodes: [
      node('route', 'myCondition'), node('aFalse', 'mySet'), node('zTrue'),
    ], edges: [
      {id: 'f', source: 'route', target: 'aFalse', sourcePort: 'false'},
      {id: 't', source: 'route', target: 'zTrue', sourcePort: 'true'},
    ], customBlocks: [
      {id: 'myCondition', label: 'Reviewed condition', baseType: 'branch', defaults: {operator: 'exists', field: 'ready'}, description: 'Declarative wrapper'},
      {id: 'mySet', label: 'Reviewed set', baseType: 'set', defaults: {fields: {ready: true}}, description: 'Declarative wrapper'},
    ]});
    const layout = stackedWorkflowLayout(input);
    assertGeometry(input, layout);
    expect(layout.nodes.find(n => n.id === 'zTrue')!.x).toBeLessThan(layout.nodes.find(n => n.id === 'route')!.x);
    expect(layout.nodes.find(n => n.id === 'aFalse')!.x).toBeGreaterThan(layout.nodes.find(n => n.id === 'route')!.x);
    expect(stackedWorkflowLayout({...input, customBlocks: input.customBlocks.slice().reverse()})).toEqual(layout);
  });

  it('never mutates a deeply frozen graph, positions, mappings or configuration and returns detached geometry', () => {
    const input = graph([node('start', 'manual'), {...node('step'), config: {fields: {nested: ['original']}},
      inputMappings: [{target: 'payload', source: {kind: 'input', path: []}}]}], [{id: 'edge', source: 'start', target: 'step'}]);
    const freeze = (value: unknown) => {
      if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}
    };
    const before = JSON.stringify(input);
    freeze(input);
    const layout = stackedWorkflowLayout(input), originalLayout = JSON.stringify(layout);
    assertGeometry(input, layout);
    expect(layout.nodes[0]).not.toBe(input.nodes[0]);
    expect(layout.edges[0]).not.toBe(input.edges[0]);
    layout.nodes[0]!.x = -1000;
    layout.edges[0]!.path = 'changed';
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(stackedWorkflowLayout(input))).toBe(originalLayout);
    assertGeometry(input, stackedWorkflowLayout(input, true), true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('leaves the real editor export, snapshot identity, subscriptions and undo/redo history untouched', () => {
    const input = graph([node('start', 'manual'), node('step')], [{id: 'edge', source: 'start', target: 'step'}]);
    const store = new WorkflowEditorStore(input);
    store.rename('Second'); store.rename('Third'); store.undo();
    const before = store.getSnapshot(), exported = store.exportJson();
    let changes = 0;
    const unsubscribe = store.subscribe(() => changes++);
    stackedWorkflowLayout(before.graph);
    stackedWorkflowLayout(before.graph, true);
    expect(store.getSnapshot()).toBe(before);
    expect(store.exportJson()).toBe(exported);
    expect(changes).toBe(0);
    expect(before.canUndo && before.canRedo).toBe(true);
    unsubscribe();
    store.undo(); expect(store.getSnapshot().graph.name).toBe(input.name);
    store.redo(); expect(store.getSnapshot().graph.name).toBe('Second');
    store.redo(); expect(store.getSnapshot().graph.name).toBe('Third');
  });

  it('bounds a 100-layer chain with 300 actual including long-skipping edges', () => {
    const nodes = Array.from({length: 100}, (_, i) => node(`n${i}`));
    const edges: Graph['edges'] = nodes.slice(1).map((n, i) => ({id: `chain${i}`, source: nodes[i]!.id, target: n.id}));
    for (let target = 2; target < 100 && edges.length < 300; target++) {
      for (let source = 0; source < target - 1 && edges.length < 300; source++) edges.push({id: `skip${edges.length}`, source: `n${source}`, target: `n${target}`});
    }
    const input = graph(nodes, edges), layout = stackedWorkflowLayout(input);
    assertGeometry(input, layout);
    expect(layout.nodes.map(n => n.layer)).toEqual(Array.from({length: 100}, (_, i) => i));
    expect(layout.edges).toHaveLength(300);
    // Long skips use bounded outside lanes instead of hiding behind chain cards.
    expect(layout.width).toBeGreaterThan(348);expect(layout.width).toBeLessThan(5000);
    expect(stackedWorkflowLayout({...input, nodes: nodes.slice().reverse(), edges: edges.slice().reverse()})).toEqual(layout);
  });

  it.each(Array.from({length: 20}, (_, i) => i + 1))('preserves deterministic complete geometry for seeded arbitrary DAG %s', seed => {
    let state = seed;
    const random = () => {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32;};
    const nodes = Array.from({length: 30}, (_, i) => node(`n${i}`, i % 5 === 0 ? 'branch' : 'set'));
    const edges: Graph['edges'] = [];
    for (let source = 0; source < nodes.length; source++) for (let target = source + 1; target < nodes.length; target++) {
      if (random() < .12) edges.push({id: `e${edges.length}`, source: `n${source}`, target: `n${target}`,
        sourcePort: nodes[source]!.type === 'branch' ? (random() < .5 ? 'true' : 'false') : 'default'});
    }
    const input = graph(nodes, edges), layout = stackedWorkflowLayout(input);
    assertGeometry(input, layout);
    const shuffled = <T,>(items: T[]) => {
      const result = items.slice();
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j]!, result[i]!];
      }
      return result;
    };
    for (let i = 0; i < 3; i++) expect(stackedWorkflowLayout({...input, nodes: shuffled(input.nodes), edges: shuffled(input.edges)})).toEqual(layout);
    assertGeometry(input, stackedWorkflowLayout(input, true), true);
  });
});
