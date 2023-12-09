import {
  IAlternativeFormat,
  ICitableData,
  ICitableItemRecords,
  ICitableItemResolver,
  ICitation,
  ICitationContext,
  ICitationManager,
  IDetectionResult,
  IDocumentAdapter,
  IMigrationResult,
  IUnambiguousItemIdentifier
} from '../types';
import { NotebookPanel } from '@jupyterlab/notebook';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';
import { generateRandomID, markdownCells } from '../utils';
import { NotebookAdapter } from '../adapters/notebook';

const PLUGIN_ID = 'jupyterlab-citation-manager:format:markdownDOI';

function extractDOI(url: string): string {
  const match = /https?:\/\/(?:dx\\.)?doi\.org\/(?<doi>.*)/.exec(url);
  if (!match?.groups) {
    return url;
  }
  return match.groups.doi;
}

const SOURCE_ID = 'DOI';

/**
 * Citations in form of `[(Krassowski et al., 2021)](https://doi.org/10.3389/fcell.2021.626821)`.
 * There are two requirements:
 *   - the first part contains parentheses (to prevent matching any link to the DOI URL)
 *   - the second part is a DOI URL (either `https://doi.org` or `http://dx.doi.org`)
 */
class MarkdownDOIFormat implements IAlternativeFormat<NotebookPanel> {
  name: string;
  private readonly catchAllPattern: RegExp;
  constructor(protected trans: TranslationBundle) {
    this.name = this.trans.__('Markdown DOI');
    this.catchAllPattern = this.citationSearchPattern('.*?');
  }

  citationSearchPattern(id = '.*?'): RegExp {
    return new RegExp(
      `\\[(?<text>\\([^)\\]]+?\\))]\\((?<url>https?:\\/\\/(?:dx\\.)?doi\\.org\\/${id})\\)`,
      'g'
    );
  }

  detect(
    document: NotebookPanel,
    adapter: IDocumentAdapter<NotebookPanel>
  ): IDetectionResult {
    const result = {
      citationsDetected: 0,
      bibliographiesDetected: 0
    };
    markdownCells(document).map(cell => {
      const text = cell.model.sharedModel.getSource();
      const citationMatches = text.match(this.catchAllPattern);
      result.citationsDetected += citationMatches ? citationMatches.length : 0;
    });
    return result;
  }

  async migrateFrom(
    document: NotebookPanel,
    adapter: NotebookAdapter,
    itemResolver: ICitableItemResolver
  ): Promise<IMigrationResult> {
    const result: IMigrationResult = {
      migratedCitationsCount: 0,
      bibliographyMigrated: false,
      failures: [],
      aborted: false
    };
    const dataFromDOI: ICitableItemRecords = {};

    // remove 'g' flag to get capture groups
    const localPattern = new RegExp(this.catchAllPattern.source, '');
    const existingCitationIDs = new Set(
      ...adapter.citations.map(citation => citation.citationId)
    );
    for (const cell of markdownCells(document)) {
      let text = cell.model.sharedModel.getSource();
      // TODO: use marked.js to extract URLs instead? This would be more robust
      const matchesInCell = text.match(this.catchAllPattern);
      const matchesCount = matchesInCell ? matchesInCell.length : 0;
      if (!matchesInCell) {
        continue;
      }
      const citationsInCell: ICitation[] = [];
      for (const match of matchesInCell) {
        const localMatch = localPattern.exec(match);
        if (!localMatch?.groups) {
          result.failures.push(
            'Internal error: could not get match groups for DOI'
          );
          continue;
        }
        try {
          const url = localMatch.groups.url;
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              Accept: 'application/vnd.citationstyles.csl+json'
            }
          });
          const deducedDOI = extractDOI(url);
          const content =
            deducedDOI in dataFromDOI
              ? dataFromDOI[deducedDOI]
              : ((await response.json()) as ICitableData);
          const itemID = content.DOI || deducedDOI;
          dataFromDOI[itemID] = content;

          const resolvedItemID: IUnambiguousItemIdentifier =
            (await itemResolver.matchItem(content, this.name)) || {
              source: SOURCE_ID,
              id: itemID
            };

          const citation: ICitation = {
            ...content,
            // note DOIs are unique, but there may be multiple citations for given DOI in this document(!)
            citationId: generateRandomID(existingCitationIDs),
            text: localMatch.groups.text,
            context: {} as ICitationContext,
            items: [resolvedItemID]
          };
          citationsInCell.push(citation);
          existingCitationIDs.add(citation.citationId);
          text = text.replace(match, adapter.formatCitation(citation));
        } catch (e) {
          result.failures.push(
            this.trans.__(
              'Could not convert citation %1: %2',
              match,
              JSON.stringify(e)
            )
          );
        }
      }
      cell.model.sharedModel.setSource(text);
      const matchesAfterCount = (text.match(this.catchAllPattern) || []).length;
      if (matchesAfterCount !== 0) {
        result.failures.push(
          this.trans.__(
            'Could not migrate markdown DOI citations: %1: %2 out of %3 matches migrated',
            JSON.stringify(matchesInCell),
            matchesCount - matchesAfterCount,
            matchesCount
          )
        );
      }
      adapter.addCitationMetadata(cell, citationsInCell);
      result.migratedCitationsCount += matchesCount - matchesAfterCount;
    }
    adapter.addFallbackDataFor(SOURCE_ID, dataFromDOI);
    return result;
  }
}

export const markdownDOIPlugin: JupyterFrontEndPlugin<void> = {
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
    manager.registerFormat(new MarkdownDOIFormat(trans));
  }
};
