import { galata, test } from '@jupyterlab/galata';
import { expect } from '@playwright/test';

const fileName = 'notebook.ipynb';

const STYLES_SELECTOR = '.cm-StyleSelector';
const CHANGE_STYLE_BUTTON = '[title="Change citation style"]';
const CITATION_MANAGER_PANEL_ID =
  'jupyterlab-citation-manager:reference-browser';

test.use({
  mockSettings: {
    ...galata.DEFAULT_SETTINGS,
    'jupyterlab-citation-manager:zotero': {
      // prevent the pop-up asking for Zotero key from showing up
      key: 'undefined'
    }
  }
});

// prevent flake from blinking cursor
const hideBlinkingCursorStyle = `
input.cm-SearchField {
  caret-color: transparent;
}
`;

test.describe('Citation styles support', () => {
  test.beforeEach(async ({ page }) => {
    await page.notebook.createNew(fileName);
    await page.sidebar.openTab(CITATION_MANAGER_PANEL_ID);
  });

  test('show some styles after opening', async ({ page }) => {
    await page.click(CHANGE_STYLE_BUTTON);

    const stylesSelector = page.locator(STYLES_SELECTOR);
    await stylesSelector.waitFor();

    const imageName = 'styles-selector:shows-styles-on-open.png';
    expect(await stylesSelector.screenshot()).toMatchSnapshot(imageName);
  });

  test('find relevant styles by long title', async ({ page }) => {
    await page.click(CHANGE_STYLE_BUTTON);

    const stylesSelector = page.locator(STYLES_SELECTOR);
    await stylesSelector.waitFor();

    await page.addStyleTag({ content: hideBlinkingCursorStyle });

    const input = stylesSelector.locator('input.cm-SearchField');
    await input.type('Nature', { delay: 0 });

    await stylesSelector
      .locator('.cm-Option:nth-child(1):has-text("Nature")')
      .waitFor();

    const imageNature = 'styles-selector:search-for-nature.png';
    expect(await stylesSelector.screenshot()).toMatchSnapshot(imageNature);
  });

  test('find relevant styles by short title', async ({ page }) => {
    await page.click(CHANGE_STYLE_BUTTON);

    const stylesSelector = page.locator(STYLES_SELECTOR);
    await stylesSelector.waitFor();

    await page.addStyleTag({ content: hideBlinkingCursorStyle });

    const input = stylesSelector.locator('input.cm-SearchField');
    await input.type('APA', { delay: 0 });
    await stylesSelector
      .locator('.cm-Option:nth-child(1):has-text("APA")')
      .waitFor();

    const imageApa = 'styles-selector:search-for-apa.png';
    expect(await stylesSelector.screenshot()).toMatchSnapshot(imageApa);
  });
});
