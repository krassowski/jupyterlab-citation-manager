import {
  CitationInsertData,
  CitationQuerySubset,
  CiteProc,
  CommandIDs,
  ICitableItemRecords,
  ICitableItemRecordsBySource,
  ICitation,
  ICitationFormattingOptions,
  ICitationManager,
  ICitationMap,
  IDocumentAdapter
} from '../types';
import type { INotebookModel, NotebookPanel } from '@jupyterlab/notebook';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { DisposableDelegate, IDisposable } from '@lumino/disposable';
import { CommandToolbarButton } from '@jupyterlab/apputils';
import { extractCitations } from '../utils';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import ICellMetadata = NotebookAdapter.ICellMetadata;
import type { Cell } from '@jupyterlab/cells';
import OutputMode = CiteProc.OutputMode;
import { itemIdToPrimitive } from '../index';

export namespace NotebookAdapter {
  export interface INotebookMetadata extends ReadonlyPartialJSONObject {
    /**
     * The identifier (path with .csl extension) of a CSL citation style.
     */
    style: string;
    /**
     * Mapping of citable items used in this document, grouped by the source.
     */
    items: ICitableItemRecordsBySource;
    /**
     * The output format (default `html`).
     */
    format?: OutputMode;
  }

  export interface ICellMetadata extends ReadonlyPartialJSONObject {
    /**
     * A mapping between citation identifiers and arrays of citable items.
     */
    citations: ICitationMap;
  }
}

export const notebookMetadataKey = 'citation-manager';
export const cellMetadataKey = 'citation-manager';

export class NotebookAdapter implements IDocumentAdapter<NotebookPanel> {
  citations: ICitation[];

  constructor(
    public document: NotebookPanel,
    public options: ICitationFormattingOptions
  ) {
    this.citations = [];
  }

  getCitableItemsFallbackData(): ICitableItemRecordsBySource | null {
    return this.notebookMetadata ? this.notebookMetadata.items : null;
  }

  setCitableItemsFallbackData(data: ICitableItemRecordsBySource): void {
    this.setNotebookMetadata({
      items: data
    });
    this.updateCellMetadata();
  }

  private insertAtCursor(text: string) {
    const activeCell = this.document.content.activeCell;
    if (activeCell && activeCell.editor) {
      const cursor = activeCell.editor.getCursorPosition();
      const offset = activeCell.editor.getOffsetAt(cursor);
      const editor = activeCell.editor;
      activeCell.model.sharedModel.updateSource(offset, offset, text);
      const updatedPosition = editor.getPositionAt(offset + text.length);
      if (updatedPosition) {
        editor.setCursorPosition(updatedPosition);
      }
    }
  }

  protected get notebookMetadata():
    | NotebookAdapter.INotebookMetadata
    | undefined {
    if (!this.document.model) {
      return;
    }
    return this.document.model.getMetadata(
      'citation-manager'
    ) as NotebookAdapter.INotebookMetadata;
  }

  addFallbackDataFor(source: string, records: ICitableItemRecords): void {
    const itemsBySource = this.notebookMetadata
      ? this.notebookMetadata.items
      : {};
    itemsBySource[source] = {
      ...(itemsBySource[source] || {}),
      ...records
    };

    this.setNotebookMetadata({
      items: itemsBySource
    });
  }

  protected setNotebookMetadata(
    update: Partial<NotebookAdapter.INotebookMetadata>
  ): void {
    if (!this.document.model) {
      console.warn(
        'Cannot update notebook metadata of',
        this.document,
        ' - no model'
      );
      return;
    }
    const merged: Partial<NotebookAdapter.INotebookMetadata> =
      this.notebookMetadata || {};
    for (const [key, value] of Object.entries(update)) {
      merged[key] = value;
    }
    this.document.model.setMetadata(notebookMetadataKey, merged);
  }

  getCitationStyle(): string | undefined {
    const metadata = this.notebookMetadata;
    if (!metadata) {
      return;
    }
    return metadata.style;
  }

  get outputFormat(): OutputMode {
    const metadata = this.notebookMetadata;
    if (!metadata) {
      return this.options.defaultFormat;
    }
    return metadata.format || this.options.defaultFormat;
  }

  setCitationStyle(newStyle: string): void {
    if (!this.document.model) {
      console.warn('Cannot set style on', this.document, ' - no model');
      return;
    }
    this.setNotebookMetadata({
      style: newStyle
    });
  }

  insertBibliography(bibliography: string): void {
    this.insertAtCursor(this.formatBibliography(bibliography));
  }

  formatBibliography(bibliography: string): string {
    console.debug('format', this.outputFormat);
    if (this.outputFormat === 'latex') {
      return bibliography;
    }
    return `<!-- BIBLIOGRAPHY START -->${bibliography}<!-- BIBLIOGRAPHY END -->`;
  }

  formatCitation(citation: CitationInsertData): string {
    // note: not using `wrapCitationEntry` as that was causing more problems
    // (itemID undefined).
    let text = citation.text;
    if (this.outputFormat === 'html' && this.options.linkToBibliography) {
      // link to the first mentioned element
      const first = citation.items[0];
      const firstID = itemIdToPrimitive(first);
      // encode the link as pipe symbol was causing issues with markdown tables,
      // see https://github.com/krassowski/jupyterlab-citation-manager/issues/50
      const encodedfirstID = encodeURIComponent(firstID);
      text = `<a href="#${encodedfirstID}">${text}</a>`;
    } else if (this.outputFormat === 'latex') {
      // this does not work well with MathJax - we need to figure out something else!
      // but it might still be useful (without $) for text editor adapter
      // const citationIDs = citation.items.map(itemIdToPrimitive).join(',');
      // text = `$$\\cite{${citationIDs}}$$`;
    }
    return `<cite id="${citation.citationId}">${text}</cite>`;
  }

  insertCitation(citation: CitationInsertData): void {
    this.insertAtCursor(this.formatCitation(citation));
    const activeCell = this.document.content.activeCell;
    if (!activeCell) {
      return;
    }
    const old =
      (activeCell.model.getMetadata(cellMetadataKey) as ICellMetadata) || {};
    activeCell.model.setMetadata(cellMetadataKey, {
      citations: {
        ...old.citations,
        ...{ [citation.citationId]: citation.items }
      }
    } as ICellMetadata);
  }

  updateCitation(citation: ICitation): void {
    const pattern = new RegExp(
      `<cite id=["']${citation.citationId}["'][^>]*?>([\\s\\S]*?)<\\/cite>`
    );
    let matches = 0;
    this.nonCodeCells.forEach(cell => {
      const oldText = cell.model.sharedModel.getSource();
      const matchIndex = oldText.search(pattern);
      if (matchIndex !== -1) {
        const newCitation = this.formatCitation(citation);
        const old = oldText.slice(matchIndex, matchIndex + newCitation.length);
        if (newCitation !== old) {
          const newValue = oldText.replace(
            pattern,
            this.formatCitation(citation)
          );
          cell.model.sharedModel.setSource(newValue);
        }
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
    const htmlPattern =
      /(?<=<!-- BIBLIOGRAPHY START -->)([\s\S]*?)(?=<!-- BIBLIOGRAPHY END -->)/;
    const htmlFullyCapturingPattern =
      /(<!-- BIBLIOGRAPHY START -->[\s\S]*?<!-- BIBLIOGRAPHY END -->)/;
    const latexPattern =
      /(\\begin{thebibliography}[\s\S]*?\\end{thebibliography})/;

    this.nonCodeCells.forEach(cell => {
      const oldText = cell.model.sharedModel.getSource();
      if (oldText.match(/<!-- BIBLIOGRAPHY START -->/)) {
        const newValue = oldText.replace(
          this.outputFormat === 'latex'
            ? htmlFullyCapturingPattern
            : htmlPattern,
          this.outputFormat === 'latex' ? bibliography.trim() : bibliography
        );
        cell.model.sharedModel.setSource(newValue);
        if (oldText.search(htmlPattern) === -1) {
          console.warn(
            'Failed to update bibliography',
            bibliography,
            'in',
            oldText
          );
        }
      } else if (oldText.match(/\\begin{thebibliography}/)) {
        const newValue = oldText.replace(
          latexPattern,
          this.outputFormat !== 'latex'
            ? this.formatBibliography(bibliography)
            : bibliography.trim()
        );
        cell.model.sharedModel.setSource(newValue);
        if (oldText.search(latexPattern) === -1) {
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
        return this.nonCodeCells;
      case 'after-cursor':
        // TODO check for off by one
        return this.selectNonCodeCells(
          this.document.content.activeCellIndex,
          Infinity
        );
      case 'before-cursor':
        return this.selectNonCodeCells(
          0,
          this.document.content.activeCellIndex
        );
    }
  }

  private *iterateCitationsByCell(subset: CitationQuerySubset) {
    // TODO only convert once at open

    for (const cell of this.chooseCells(subset)) {
      // TODO: subset >within< cell! (also always include the current cell in chooseCells)
      const cellMetadata = cell.model.getMetadata(cellMetadataKey) as
        | NotebookAdapter.ICellMetadata
        | undefined;
      const cellCitations = extractCitations(
        cell.model.sharedModel.getSource(),
        {
          host: cell.node
        },
        cellMetadata ? cellMetadata.citations : {}
      );
      yield { cell, cellCitations };
    }
  }

  findCitations(subset: CitationQuerySubset): ICitation[] {
    const citations: ICitation[] = [];
    for (const { cellCitations } of this.iterateCitationsByCell(subset)) {
      citations.push(...cellCitations);
    }

    // TODO: use cache of cells contents?
    return citations;
  }

  protected updateCellMetadata(): void {
    for (const { cell, cellCitations } of this.iterateCitationsByCell('all')) {
      if (cellCitations.length === 0) {
        cell.model.deleteMetadata(cellMetadataKey);
      } else {
        cell.model.setMetadata(cellMetadataKey, {
          citations: Object.fromEntries(
            cellCitations.map(citation => [citation.citationId, citation.items])
          )
        } as ICellMetadata);
      }
    }
  }

  /**
   * We want to insert citation/bibliography in Markdown and Raw cells
   * (raw cells so that LaTeX can be exported as-is).
   */
  private get nonCodeCells() {
    return this.document.content.widgets.filter(
      cell => cell.model.type !== 'code'
    );
  }

  private selectNonCodeCells(min: number, max: number) {
    return this.document.content.widgets
      .slice(min, max)
      .filter(cell => cell.model.type !== 'code');
  }

  addCitationMetadata(cell: Cell, citationsInCell: ICitation[]): void {
    let metadata: ICellMetadata = cell.model.getMetadata(
      cellMetadataKey
    ) as ICellMetadata;
    if (!metadata) {
      metadata = { citations: {} };
    }
    for (const citation of citationsInCell) {
      metadata['citations'][citation.citationId] = citation.items;
    }
    cell.model.setMetadata(cellMetadataKey, metadata);
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
