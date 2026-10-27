import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {WorkflowEditor,createWorkflowTemplate} from './WorkflowEditor';
describe('workflow editor surface',()=>{
 it('renders an actionable standalone authoring surface without deployment claims',()=>{
  const html=renderToStaticMarkup(createElement(WorkflowEditor));
  for(const text of ['Block palette','Workflow canvas','Node inspector','Import JSON','Export JSON','Undo','Redo','Run locally','Human approval','New workflow','Custom block'])expect(html).toContain(text);
  expect(html).toContain('Draft · not deployed');expect(html).toContain('No blocks yet');
 });
 it('supplies actual connected editable templates including human review and condition ports',()=>{
  const review=createWorkflowTemplate('approval');expect(review.nodes.map(n=>n.type)).toEqual(['manual','approval','output']);expect(review.edges).toHaveLength(2);
  const branch=createWorkflowTemplate('branch');expect(branch.edges.map(e=>e.sourcePort)).toContain('true');expect(branch.edges.map(e=>e.sourcePort)).toContain('false');
  expect(renderToStaticMarkup(createElement(WorkflowEditor,{initialGraph:review}))).toContain('Review request');
 });
});
