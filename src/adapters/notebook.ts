import {
  CitationQuerySubset,
  CommandIDs,
  ICitation,
  ICitationManager,
  IDocumentAdapter
} from '../types';
import { INotebookModel, NotebookPanel } from '@jupyterlab/notebook';
import bibliography from '../../style/icons/book-open-variant.svg';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { DisposableDelegate, IDisposable } from '@lumino/disposable';
import { CommandToolbarButton } from '@jupyterlab/apputils';
import { extractCitations } from '../utils';
import { JupyterFrontEnd } from '@jupyterlab/application';

export class NotebookAdapter implements IDocumentAdapter<NotebookPanel> {
  citations: ICitation[];
  // TODO
  // style: ICitationStyle;
  constructor(public document: NotebookPanel) {
    this.citations = [];
  }

  private insertAtCursor(text: string) {
    const activeCell = this.document.content.activeCell;
    if (activeCell) {
      const cursor = activeCell.editor.getCursorPosition();
      const offset = activeCell.editor.getOffsetAt(cursor);
      activeCell.model.value.insert(offset, text);
    }
  }

  insertBibliography(bibliography: string): void {
    this.insertAtCursor(
      `<!-- BIBLIOGRAPHY START -->${bibliography}<!-- BIBLIOGRAPHY END -->`
    );
  }

  insertCitation(citation: ICitation): void {
    const items =
      citation.items.length > 1
        ? JSON.stringify(citation.items)
        : citation.items[0];
    // TODO: item data needs to be stored in the notebook metadata as well to enable two persons with tow different Zotero collections to collaborate
    //   and this needs to happen transparently. In that case ultimately all metadata apart from citation id could be stored in notebook or cell metadata.
    //   using cell metadata has an advantage of not keeping leftovers when deleting cells and its easier to copy-paste everything from notebook to notebook.
    //   the metadata should include DOI and all elements used in the UI (title, date, authors)
    this.insertAtCursor(
      `<cite id="${citation.citationId}" data-source="${citation.source}" data-items="${items}">${citation.text}</cite>`
    );
  }

  updateCitation(citation: ICitation): void {
    const pattern = new RegExp(
      `<cite id=["']${citation.id}["'] [^>]+?>([\\s\\S]*?)<\\/cite>`
    );
    let matches = 0;
    this.markdownCells.forEach(cell => {
      const oldText = cell.model.value.text;
      if (oldText.search(/<cite /) !== -1 && oldText.search(pattern) !== -1) {
        cell.model.value.text = oldText.replace(pattern, bibliography);
        matches += 1;
      }
    });
    if (matches === 0) {
      console.warn('Failed to update citation', citation, '- no matches found');
    } else if (matches > 1) {
      console.warn(
        'Citation',
        citation,
        'appears in more than one cell with the same ID; please correct it manually'
      );
    }
  }

  updateBibliography(bibliography: string): void {
    const pattern =
      /(?<=<!-- BIBLIOGRAPHY START -->)([\s\S]*?)(?=<!-- BIBLIOGRAPHY END -->)/;
    this.markdownCells.forEach(cell => {
      const oldText = cell.model.value.text;
      if (oldText.match(/<!-- BIBLIOGRAPHY START -->/)) {
        cell.model.value.text = oldText.replace(pattern, bibliography);
        if (oldText.search(pattern) === -1) {
          console.warn(
            'Failed to update bibliography',
            bibliography,
            'in',
            oldText
          );
        }
      }
    });
  }

  private chooseCells(subset: CitationQuerySubset) {
    switch (subset) {
      case 'all':
        return this.markdownCells;
      case 'after-cursor':
        // TODO check for off by one
        return this.selectMarkdownCells(
          this.document.content.activeCellIndex,
          Infinity
        );
      case 'before-cursor':
        return this.selectMarkdownCells(
          0,
          this.document.content.activeCellIndex
        );
    }
  }

  findCitations(subset: CitationQuerySubset): ICitation[] {
    // TODO detect and convert cite2c citations
    const citations: ICitation[] = [];

    this.chooseCells(subset).forEach(cell => {
      citations.push(...extractCitations(cell.model.value.text));
    });
    // TODO: use cache of cells contents?
    return citations;
  }

  private get markdownCells() {
    return this.document.content.widgets.filter(
      cell => cell.model.type === 'markdown'
    );
  }

  private selectMarkdownCells(min: number, max: number) {
    return this.document.content.widgets
      .slice(min, max)
      .filter(cell => cell.model.type === 'markdown');
  }
}

/**
 * A notebook widget extension that adds a button to the toolbar.
 */
export class NotebookButtons
  implements DocumentRegistry.IWidgetExtension<NotebookPanel, INotebookModel>
{
  constructor(
    protected manager: ICitationManager,
    protected app: JupyterFrontEnd
  ) {}

  /**
   * Create a new extension object.
   */
  createNew(
    panel: NotebookPanel,
    context: DocumentRegistry.IContext<INotebookModel>
  ): IDisposable {
    const addCitationButton = new CommandToolbarButton({
      commands: this.app.commands,
      id: CommandIDs.insertCitation
    });
    addCitationButton.addClass('addCitationButton');

    const addBibliographyButton = new CommandToolbarButton({
      commands: this.app.commands,
      id: CommandIDs.insertBibliography
    });
    addBibliographyButton.addClass('addBibliographyButton');

    panel.toolbar.insertItem(10, 'addCitation', addCitationButton);
    panel.toolbar.insertItem(11, 'addBibliography', addBibliographyButton);
    return new DisposableDelegate(() => {
      addCitationButton.dispose();
      addBibliographyButton.dispose();
    });
  }
}
