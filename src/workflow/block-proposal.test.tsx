import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkflowEditor} from './WorkflowEditor';

it('makes unavailable AI proposal controls explicitly disabled with selected-model guidance',()=>{
 const html=renderToStaticMarkup(createElement(WorkflowEditor));
 expect(html.includes('Ask AI for a block')).toBe(true);
 expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Ask AI for a block<\/button>/);
 expect(html.includes('Select a configured model connection')).toBe(true);
 expect(html.includes('Custom block')).toBe(true);
});
