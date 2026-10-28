import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {StudioApp} from './StudioApp';
describe('Common Pages entry with honest unavailable composition',()=>{
 it('exposes Pages and a plainly named Create page entry without claiming a page exists',()=>{
  const html=renderToStaticMarkup(<StudioApp/>);
  expect(html).toContain('>Pages</button>');
  expect(html).toContain('>Create page</button>');
  expect(html).toContain('Page designer is not connected');
  expect(html).not.toContain('Page created');
 });
});
