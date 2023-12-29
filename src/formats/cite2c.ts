import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  IAlternativeFormat,
  ICitableItemRecords,
  ICitableItemResolver,
  ICitationManager,
  ICitationMap,
  IDetectionResult,
  IDocumentAdapter,
  IMigrationResult,
  IUnambiguousItemIdentifier
} from '../types';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';
import { NotebookAdapter } from '../adapters/notebook';
import { extractCitations, markdownCells } from '../utils';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { NotebookPanel } from '@jupyterlab/notebook';

const PLUGIN_ID = 'jupyterlab-citation-manager:format:cite2c';

namespace Cite2C {
  export interface INotebookMetadata extends ReadonlyPartialJSONObject {
    citations: ICitableItemRecords;
  }
}

class Cite2CFormat implements IAlternativeFormat<NotebookPanel> {
  name: string;
  private readonly bibliographyPattern =
    /<div class=["']cite2c-biblio["']><\/div>/;
  private readonly catchAllPattern: RegExp;
  constructor(protected trans: TranslationBundle) {
    this.name = trans.__('cite2c');
    this.catchAllPattern = this.citationSearchPattern('.*?');
  }

  detect(
    document: NotebookPanel,
    adapter: IDocumentAdapter<any>
  ): IDetectionResult {
    const metadata = this.metadata(document);
    const result = {
      citationsDetected: 0,
      bibliographiesDetected: 0
    };
    if (!metadata) {
      return result;
    }
    markdownCells(document).map(cell => {
      const text = cell.model.sharedModel.getSource();
      const citationMatches = text.match(this.catchAllPattern);
      const bibliographyMatches = text.match(this.bibliographyPattern);
      result.citationsDetected += citationMatches ? citationMatches.length : 0;
      result.bibliographiesDetected += bibliographyMatches
        ? bibliographyMatches.length
        : 0;
    });
    return result;
  }

  protected metadata(document: NotebookPanel): Cite2C.INotebookMetadata | null {
    if (!document.model) {
      return null;
    }
    return (
      (document.model.getMetadata('cite2c') as Cite2C.INotebookMetadata) || null
    );
  }

  citationSearchPattern(id: string): RegExp {
    return new RegExp(`<cite data-cite=["']${id}["'](?:\\/>|><\\/cite>)`, 'g');
  }

  async migrateFrom(
    document: NotebookPanel,
    adapter: NotebookAdapter,
    itemResolver: ICitableItemResolver
  ): Promise<IMigrationResult> {
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
      await Promise.all(
        Object.entries(cite2c.citations).map(
          // TODO: if a matching item exists in zotero -> re-conciliate
          async ([citationID, item]) => {
            const resolvedItemID: IUnambiguousItemIdentifier =
              (await itemResolver.matchItem(item, this.name)) || {
                source: 'cite2c',
                id: citationID
              };
            return [citationID, [resolvedItemID]];
          }
        )
      )
    );

    markdownCells(document).forEach(cell => {
      const citationsInCell = extractCitations(
        cell.model.sharedModel.getSource(),
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
      let text = cell.model.sharedModel.getSource();
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
              JSON.stringify(citationsInCell),
              matchesCount - matchesAfterCount,
              matchesCount
            )
          );
        }
        result.migratedCitationsCount += matchesCount - matchesAfterCount;
      }
      text = text.replace(
        this.bibliographyPattern,
        adapter.formatBibliography('')
      );
      cell.model.sharedModel.setSource(text);

      adapter.addCitationMetadata(cell, citationsInCell);
    });

    adapter.addFallbackDataFor('cite2c', cite2c.citations);

    if (result.failures.length === 0) {
      document.model.deleteMetadata('cite2c');
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
