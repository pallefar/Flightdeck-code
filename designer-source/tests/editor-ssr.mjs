import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AppDesigner} from '../../src/studio/designer/AppDesigner.js';
export const renderEditor=embedded=>renderToStaticMarkup(createElement(AppDesigner,{embedded}));
