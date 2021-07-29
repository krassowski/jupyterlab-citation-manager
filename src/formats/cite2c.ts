import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  IAlternativeFormat,
  ICitableItemRecords,
  ICitationManager,
  ICitationMap,
  IDetectionResult,
  IDocumentAdapter,
  IMigrationResult
} from '../types';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';
import { cellMetadataKey, NotebookAdapter } from '../adapters/notebook';
import { extractCitations } from '../utils';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { NotebookPanel } from '@jupyterlab/notebook';
import ICellMetadata = NotebookAdapter.ICellMetadata;

const PLUGIN_ID = 'jupyterlab-citation-manager:format:cite2c';

namespace Cite2C {
  export interface INotebookMetadata extends ReadonlyPartialJSONObject {
    citations: ICitableItemRecords;
  }
}

class Cite2CFormat implements IAlternativeFormat<NotebookPanel> {
  name = 'cite2c';
  private readonly bibliographyPattern =
    /<div class=["']cite2c-biblio["']><\/div>/;
  constructor(protected trans: TranslationBundle) {
    // no-op
  }

  private markdownCells(document: NotebookPanel) {
    return document.content.widgets.filter(
      cell => cell.model.type === 'markdown'
    );
  }

  detect(
    document: NotebookPanel,
    adapter: IDocumentAdapter<any>
  ): IDetectionResult {
    const metadata = this.metadata(document);
    if (!metadata) {
      return {
        citationsDetected: 0,
        bibliographiesDetected: 0
      };
    }
    const catchAllPattern = this.citationSearchPattern('.*?');
    const matchesInCells = this.markdownCells(document).map(cell => {
      const text = cell.model.value.text;
      const citationMatches = text.match(catchAllPattern);
      const bibliographyMatches = text.match(this.bibliographyPattern);
      return {
        citations: citationMatches ? citationMatches.length : 0,
        bibliography: bibliographyMatches ? bibliographyMatches.length : 0
      };
    });
    const citations = matchesInCells.reduce((a, b) => a + b.citations, 0);
    const bibliographies = matchesInCells.reduce(
      (a, b) => a + b.bibliography,
      0
    );
    return {
      citationsDetected: citations,
      bibliographiesDetected: bibliographies
    };
  }

  protected metadata(document: NotebookPanel): Cite2C.INotebookMetadata | null {
    if (!document.model) {
      return null;
    }
    return (
      (document.model.metadata.get('cite2c') as Cite2C.INotebookMetadata) ||
      null
    );
  }

  citationSearchPattern(id: string): RegExp {
    return new RegExp(`<cite data-cite=["']${id}["'](?:\\/>|><\\/cite>)`, 'g');
  }

  migrateFrom(
    document: NotebookPanel,
    adapter: NotebookAdapter
  ): IMigrationResult {
    const cite2c = this.metadata(document);
    const result: IMigrationResult = {
      migratedCitationsCount: 0,
      bibliographyMigrated: false,
      failures: [],
      aborted: false
    };
    if (!document.model) {
      return {
        ...result,
        aborted: true,
        message: this.trans.__('temporarily could not access notebook metadata')
      };
    }
    if (!cite2c) {
      return {
        ...result,
        aborted: true,
        message: this.trans.__('cite2c metadata absent')
      };
    }
    if (!cite2c.citations) {
      return {
        ...result,
        aborted: true,
        message: this.trans.__(
          'cite2c metadata detected, but no citations to convert'
        )
      };
    }
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

    this.markdownCells(document).forEach(cell => {
      const citationsInCell = extractCitations(
        cell.model.value.text,
        {
          host: cell.node
        },
        citationToItems
      )
        .filter(citation => {
          if (!citation?.data?.cite) {
            result.failures.push(
              this.trans.__(
                'Skipping potential cite2c citation: %1 - `data-cite` attribute missing.',
                JSON.stringify(citation)
              )
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
        // TODO: escape?
        const pattern = this.citationSearchPattern(
          citation?.data?.cite as string
        );
        const matchesCount = (text.match(pattern) || []).length;
        if (matchesCount === 0) {
          result.failures.push(
            this.trans.__(
              'Could not migrate cite2c citation: %1: %2 pattern has no matches',
              JSON.stringify(citation),
              JSON.stringify(pattern)
            )
          );
        }
        text = text.replace(pattern, adapter.formatCitation(citation));
        const matchesAfterCount = (text.match(pattern) || []).length;
        if (matchesAfterCount !== 0) {
          result.failures.push(
            this.trans.__(
              'Could not migrate cite2c citation: %1: %2 out of %3 matches migrated',
              JSON.stringify(citation),
              matchesCount - matchesAfterCount,
              matchesCount
            )
          );
        } else {
          result.migratedCitationsCount += matchesCount;
        }
      }
      text = text.replace(
        this.bibliographyPattern,
        adapter.formatBibliography('')
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

    const itemsBySource = adapter.notebookMetadata
      ? adapter.notebookMetadata.items
      : {};
    itemsBySource['cite2c'] = {
      ...(itemsBySource['cite2c'] || {}),
      ...cite2c.citations
    };

    adapter.setNotebookMetadata({
      items: itemsBySource
    });

    if (result.failures.length === 0) {
      document.model.metadata.delete('cite2c');
    } else {
      result.message = this.trans.__(
        'Migration could not be completed; the cite2c metadata were kept to allow manual migration'
      );
    }
    return result;
  }
}

export const cite2cPlugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  requires: [ICitationManager],
  optional: [ITranslator],
  autoStart: true,
  activate: (
    app: JupyterFrontEnd,
    manager: ICitationManager,
    translator: ITranslator | null
  ) => {
    console.log('JupyterLab cite2c format is activated!');
    translator = translator || nullTranslator;
    const trans = translator.load('jupyterlab-citation-manager');
    manager.registerFormat(new Cite2CFormat(trans));
  }
};
