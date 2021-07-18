import { LabIcon } from '@jupyterlab/ui-components';
import addCitation from '../style/icons/book-plus.svg';
import bibliography from '../style/icons/book-open-variant.svg';
import bookshelf from '../style/icons/bookshelf.svg';
import palette from '../style/icons/palette.svg';

export const addCitationIcon = new LabIcon({
  name: 'citation:add',
  svgstr: addCitation
});

export const bibliographyIcon = new LabIcon({
  name: 'citation:bibliography',
  svgstr: bibliography
});

export const bookshelfIcon = new LabIcon({
  name: 'citation:bookshelf',
  svgstr: bookshelf
});

export const paletteIcon = new LabIcon({
  name: 'citation:palette',
  svgstr: palette
});
