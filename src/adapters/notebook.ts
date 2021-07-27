import {
  CitationInsertData,
  CitationQuerySubset,
  CommandIDs,
  ICitableItemRecords,
  ICitableItemRecordsBySource,
  ICitation,
  ICitationManager,
  ICitationMap,
  IDocumentAdapter
} from '../types';
import { INotebookModel, NotebookPanel } from '@jupyterlab/notebook';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { DisposableDelegate, IDisposable } from '@lumino/disposable';
import { CommandToolbarButton } from '@jupyterlab/apputils';
import { extractCitations } from '../utils';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import ICellMetadata = NotebookAdapter.ICellMetadata;

namespace Cite2C {
  export interface INotebookMetadata extends ReadonlyPartialJSONObject {
    citations: ICitableItemRecords;
  }
}

namespace NotebookAdapter {
  export interface INotebookMetadata extends ReadonlyPartialJSONObject {
    /**
     * The identifier (path with .csl extension) of a CSL citation style.
     */
    style: string;
    /**
     * Mapping of citable items used in this document, grouped by the source.
     */
    items: ICitableItemRecordsBySource;
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

  constructor(public document: NotebookPanel) {
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
    if (activeCell) {
      const cursor = activeCell.editor.getCursorPosition();
      const offset = activeCell.editor.getOffsetAt(cursor);
      activeCell.model.value.insert(offset, text);
    }
  }

  protected get notebookMetadata():
    | NotebookAdapter.INotebookMetadata
    | undefined {
    if (!this.document.model) {
      return;
    }
    return this.document.model.metadata.get(
      'citation-manager'
    ) as NotebookAdapter.INotebookMetadata;
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
    this.document.model.metadata.set(notebookMetadataKey, merged);
  }

  getCitationStyle(): string | undefined {
    const metadata = this.notebookMetadata;
    if (!metadata) {
      return;
    }
    return metadata.style;
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

  protected formatBibliography(bibliography: string): string {
    return `<!-- BIBLIOGRAPHY START -->${bibliography}<!-- BIBLIOGRAPHY END -->`;
  }

  protected formatCitation(citation: CitationInsertData): string {
    return `<cite id="${citation.citationId}">${citation.text}</cite>`;
  }

  insertCitation(citation: CitationInsertData): void {
    this.insertAtCursor(this.formatCitation(citation));
    const activeCell = this.document.content.activeCell;
    if (!activeCell) {
      return;
    }
    const old =
      (activeCell.model.metadata.get(cellMetadataKey) as ICellMetadata) || {};
    activeCell.model.metadata.set(cellMetadataKey, {
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
    this.markdownCells.forEach(cell => {
      const oldText = cell.model.value.text;
      const matchIndex = oldText.search(pattern);
      if (matchIndex !== -1) {
        const newCitation = this.formatCitation(citation);
        const old = oldText.slice(matchIndex, matchIndex + newCitation.length);
        if (newCitation !== old) {
          cell.model.value.text = oldText.replace(
            pattern,
            this.formatCitation(citation)
          );
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

  async migrateFormat(): Promise<boolean> {
    if (!this.document.model) {
      return false;
    }
    const cite2c = this.document.model.metadata.get(
      'cite2c'
    ) as Cite2C.INotebookMetadata;
    if (!cite2c) {
      return false;
    }
    if (!cite2c.citations) {
      console.log('cite2c metadata detected, but no citations to convert');
      return false;
    }
    let allGood = true;
    console.log('Converting cite2c citations');

    const citationToItems: ICitationMap = Object.fromEntries(
      Object.keys(cite2c.citations).map(
        // TODO: if a matching item exists in zotero -> re-conciliate
        citationID => {
          return [
            citationID,
            [
              {
                id: citationID,
                source: 'cite2c'
              }
            ]
          ];
        }
      )
    );

    this.chooseCells('all').forEach(cell => {
      const citationsInCell = extractCitations(
        cell.model.value.text,
        {
          host: cell.node
        },
        citationToItems
      )
        .filter(citation => {
          if (!citation?.data?.cite) {
            allGood = false;
            console.log(
              'Skipping potential cite2c citation:',
              citation,
              '- no data-cite detected.'
            );
            return false;
          }
          return true;
        })
        .map(cite2cCitation => {
          cite2cCitation.citationId = 'cite2c-' + cite2cCitation?.data?.cite;
          return cite2cCitation;
        });
      let text = cell.model.value.text;
      for (const citation of citationsInCell) {
        const pattern = new RegExp(
          `<cite data-cite=["']${citation?.data?.cite}["'](?:\\/>|><\\/cite>)`,
          'g'
        );
        const matchesCount = (text.match(pattern) || []).length;
        if (matchesCount === 0) {
          allGood = false;
          console.error(
            `Could not migrate cite2c citation: ${citation}: ${pattern} has no matches`
          );
        }
        text = text.replace(pattern, this.formatCitation(citation));
        const matchesAfterCount = (text.match(pattern) || []).length;
        if (matchesAfterCount !== 0) {
          allGood = false;
          console.error(
            `Could not migrate cite2c citation: ${citation}: ${pattern} some matches remained`
          );
        }
      }
      text = text.replace(
        /<div class=["']cite2c-biblio["']><\/div>/,
        this.formatBibliography('')
      );
      cell.model.value.text = text;
      let metadata: ICellMetadata = cell.model.metadata.get(
        cellMetadataKey
      ) as ICellMetadata;
      if (!metadata) {
        metadata = { citations: {} };
      }
      for (const citation of citationsInCell) {
        metadata['citations'][citation.citationId] = citation.items;
      }
      cell.model.metadata.set(cellMetadataKey, metadata);
    });

    const itemsBySource = this.notebookMetadata
      ? this.notebookMetadata.items
      : {};
    itemsBySource['cite2c'] = {
      ...(itemsBySource['cite2c'] || {}),
      ...cite2c.citations
    };

    this.setNotebookMetadata({
      items: itemsBySource
    });

    if (allGood) {
      this.document.model.metadata.delete('cite2c');
    } else {
      console.warn('Could not fully migrate from cite2c');
    }
    return true;
  }

  private *iterateCitationsByCell(subset: CitationQuerySubset) {
    // TODO only convert once at open

    for (const cell of this.chooseCells(subset)) {
      // TODO: subset >within< cell! (also always include the current cell in chooseCells)
      const cellMetadata = cell.model.metadata.get(cellMetadataKey) as
        | NotebookAdapter.ICellMetadata
        | undefined;
      const cellCitations = extractCitations(
        cell.model.value.text,
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

  protected updateCellMetadata() {
    for (const { cell, cellCitations } of this.iterateCitationsByCell('all')) {
      if (cellCitations.length === 0) {
        cell.model.metadata.delete(cellMetadataKey);
      } else {
        cell.model.metadata.set(cellMetadataKey, {
          citations: Object.fromEntries(
            cellCitations.map(citation => [citation.citationId, citation.items])
          )
        } as ICellMetadata);
      }
    }
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
