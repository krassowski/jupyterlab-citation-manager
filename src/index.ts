import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';
import {
  INotebookModel,
  INotebookTracker,
  NotebookPanel
} from '@jupyterlab/notebook';
import { DocumentRegistry, DocumentWidget } from '@jupyterlab/docregistry';
import { DisposableDelegate, IDisposable } from '@lumino/disposable';
import { ToolbarButton } from '@jupyterlab/apputils';
import marked from 'marked';
import {
  CitationQuerySubset,
  ICitableData,
  ICitableWrapper,
  ICitation,
  ICitationOption,
  ICitationSystem,
  ICiteProcEngine,
  IDocumentAdapter,
  IReferenceProvider
} from './types';
import { ZoteroClient } from './zotero';
import { DefaultMap } from './utils';

import { LabIcon } from '@jupyterlab/ui-components';
import addCitation from '../style/icons/book-plus.svg';
import bibliography from '../style/icons/book-open-variant.svg';
import { CitationSelector } from './selector';
import * as CSL from 'citeproc';
import { DateContentModel } from './_csl_citation';

export const addCitationIcon = new LabIcon({
  name: 'citation:add',
  svgstr: addCitation
});

export const BibliographyIcon = new LabIcon({
  name: 'citation:bibliography',
  svgstr: bibliography
});

function extractCitations(markdown: string): ICitation[] {
  const html: string = marked(markdown);
  const div = document.createElement('div');
  div.innerHTML = html;
  return [...div.querySelectorAll('cite').values()].map(element => {
    return {
      citationId: element.id,
      itemIds: element.dataset.itemIds
        ? JSON.parse(element.dataset.itemIds)
        : [],
      source: element.dataset.source,
      text: element.innerHTML
    } as ICitation;
  });
}

class NotebookAdapter implements IDocumentAdapter<NotebookPanel> {
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
    this.insertAtCursor(
      `<cite id="${citation.id}" data-source="${
        citation.source
      }" data-item-ids="${JSON.stringify(citation.itemIds)}">${
        citation.text
      }</cite>`
    );
  }

  updateCitation(citation: ICitation): void {
    this.markdownCells.forEach(cell => {
      if (cell.model.value.text.match(/<cite /)) {
        cell.model.value.text = cell.model.value.text.replace(
          new RegExp(`<cite id=["']${citation.id}["'] [^>]+?>(.*?)<\\/cite>`),
          bibliography
        );
      }
    });
  }

  updateBibliography(bibliography: string) {
    this.markdownCells.forEach(cell => {
      if (cell.model.value.text.match(/<!-- BIBLIOGRAPHY START -->/)) {
        cell.model.value.text = cell.model.value.text.replace(
          /(?<=<!-- BIBLIOGRAPHY START -->)([\s\S].*?)(?=<!-- BIBLIOGRAPHY END -->)/,
          bibliography
        );
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

function parseEDTF(date: string): Date {
  return new Date(date);
}

function getDate(date: DateContentModel): Date {
  if (typeof date === 'string') {
    // TODO: perform proper EDTF parsing
    return parseEDTF(date);
  }
  if (date.edtf) {
    // TODO: perform proper EDTF parsing
    return parseEDTF(date.edtf);
  }
  if (date.raw) {
    return new Date(date.raw);
  }
  if (date.literal) {
    return new Date(date.literal);
  }
  if (date['date-parts']) {
    const startDate = date['date-parts'][0];
    if (startDate.length === 1) {
      return new Date(
        ...(startDate.map(value => parseInt(value + '', 10)) as [number])
      );
    }
    if (startDate.length === 2) {
      return new Date(
        ...(startDate.map(value => parseInt(value + '', 10)) as [
          number,
          number
        ])
      );
    }
    if (startDate.length === 3) {
      return new Date(
        ...(startDate.map(value => parseInt(value + '', 10)) as [
          number,
          number,
          number
        ])
      );
    }
    console.warn(`Don't know how to parse date-parts: ${startDate}`);
  }
  // default to today, todo replace with something better?
  return new Date();
}

function harmonizeData(publication: ICitableData): ICitableWrapper {
  let date: Date | undefined = undefined;
  if (publication.issued) {
    date = getDate(publication.issued);
  }
  return {
    ...publication,
    date: date
  };
}

class UnifiedCitationManager implements ICitationSystem {
  private providers: Map<string, IReferenceProvider>;
  private adapters: WeakMap<DocumentWidget, IDocumentAdapter<DocumentWidget>>;
  private selector: CitationSelector;
  private processors: WeakMap<DocumentWidget, ICiteProcEngine>;

  constructor(notebookTracker: INotebookTracker) {
    this.selector = new CitationSelector();
    this.selector.hide();
    this.adapters = new WeakMap();
    this.processors = new WeakMap();
    // TODO generalize to allow use in Markdown Editor too
    notebookTracker.widgetAdded.connect((tracker, panel) => {
      // TODO: refresh on changes?
      // panel.content.modelChanged.connect()
      // const adapter = this.getAdapter(panel);
    });
    this.providers = new Map();
  }

  public registerReferenceProvider(provider: IReferenceProvider): void {
    this.providers.set(provider.id, provider);
  }

  private collectOptions(existingCitations: ICitation[]): ICitationOption[] {
    const options = [];
    const citationLookup = new Map<string, ICitation>();
    const citationCount = new DefaultMap<string, number>(() => 0);
    for (const citationId of existingCitations.map(
      citation => citation.source + '|' + citation.id
    )) {
      const previous: number = citationCount.get(citationId);
      citationCount.set(citationId, previous + 1);
    }
    // collect from providers
    const addedFromProviders = new Set<string>();

    for (const provider of this.providers.values()) {
      for (const publication of provider.publications.values()) {
        const id = provider.name + '|' + publication.id;
        addedFromProviders.add(id);
        options.push({
          source: provider.name,
          publication: harmonizeData(publication),
          citationsInDocument: citationCount.get(id)
        } as ICitationOption);
      }
    }
    // add citations that already are in document but do not match the providers
    for (const [id, citation] of citationLookup.entries()) {
      if (!addedFromProviders.has(id)) {
        options.push({
          source: citation.source,
          publication: citation as Partial<ICitableData>,
          citationsInDocument: citationCount.get(id)
        });
      }
    }
    return options;
  }

  private _generateRandomID(existingIDs: Set<string>): string {
    let isUnique = false;
    let id = '';
    while (!isUnique) {
      id = Math.random().toString(36).slice(-5);
      isUnique = !existingIDs.has(id);
    }
    return id;
  }

  private getAdapter(content: NotebookPanel): IDocumentAdapter<any> {
    let adapter = this.adapters.get(content);
    if (!adapter) {
      // todo getOrCreate
      adapter = new NotebookAdapter(content);
      this.adapters.set(content, adapter);
      this.processors.set(content, this.createProcessor());
    }
    if (!adapter) {
      throw Error('This should not happen');
    }
    return adapter;
  }

  addCitation(content: NotebookPanel) {
    console.log('adding citation');
    const adapter = this.getAdapter(content);
    // TODO: remove
    adapter.citations = adapter.findCitations('all');

    // do not search document for citations, but if any are already cached prioritize those
    const citationsAlreadyInDocument = adapter.citations;
    // TODO replace selection list with a neat modal selector with search option

    const options = this.collectOptions(citationsAlreadyInDocument);

    this.selector.getItem(options).then(chosenOption => {
      const processor = this.processors.get(content);
      if (!processor) {
        console.warn('Could not find a processor for ', content);
        return;
      }

      // TODO add a lock to prevent folks using RTC from breaking their bibliography
      const citationsBefore = adapter.findCitations('before-cursor');
      const citationsAfter = adapter.findCitations('before-cursor');

      const existingCitationIDs = new Set([
        ...citationsBefore.map(c => c.citationId),
        ...citationsAfter.map(c => c.citationId)
      ]);

      const newCitationID = this._generateRandomID(existingCitationIDs);

      const citationsBeforeMap: Record<number, ICitation> = Object.fromEntries(
        citationsBefore.map((c, index) => [index, c])
      );
      const citationsAfterMap: Record<number, ICitation> = Object.fromEntries(
        citationsAfter.map((c, index) => [index + 1, c])
      );

      const result = processor.processCitationCluster(
        {
          properties: {
            noteIndex: citationsBefore.length
          },
          citationItems: [
            {
              id: chosenOption.source + '|' + chosenOption.publication.id
            }
          ],
          citationID: newCitationID
        },
        citationsBefore.map((item, i) => [
          item.source + '|' + item.itemIds[0] + '',
          i
        ]),
        citationsAfter.map((item, i) => [
          item.source + '|' + item.itemIds[0] + '',
          i + 1
        ])
      );
      const citationsToUpdate = result[1];
      console.log('citations to update', citationsToUpdate);

      for (const [indexToUpdate, newText] of citationsToUpdate) {
        if (indexToUpdate === citationsBefore.length) {
          (adapter as NotebookAdapter).insertCitation({
            source: chosenOption.source,
            text: newText,
            itemIds: [chosenOption.publication.id as string],
            citationId: newCitationID
          });
        } else {
          let citation: ICitation;
          if (indexToUpdate in citationsAfterMap) {
            citation = citationsAfterMap[indexToUpdate];
          } else if (indexToUpdate in citationsBeforeMap) {
            citation = citationsBeforeMap[indexToUpdate];
          } else {
            console.warn(
              'Could not locate citation with index',
              indexToUpdate,
              'in',
              citationsBeforeMap,
              'nor',
              citationsAfterMap
            );
            continue;
          }
          adapter.updateCitation({ ...citation, text: newText });
        }
      }

      const bibliography = processor.makeBibliography();
      console.log(bibliography);
      adapter.updateBibliography(bibliography[1].join('\n'));
    });
  }

  createProcessor(styleID?: string): ICiteProcEngine {
    if (!styleID) {
      styleID = 'chicago-fullnote-bibliography';
    }
    // Get the CSL style as a serialized string of XML
    const xhr = new XMLHttpRequest();
    xhr.open(
      'GET',
      'https://raw.githubusercontent.com/citation-style-language/styles/master/' +
        styleID +
        '.csl',
      false
    );
    xhr.send(null);
    const styleAsText = xhr.responseText;
    return new CSL.Engine(this, styleAsText);
  }

  addBibliography(content: NotebookPanel) {
    console.log('adding bibliography');
    const adapter = this.getAdapter(content);
    const processor = this.processors.get(content);
    if (!processor) {
      console.warn('Could not find a processor for ', content);
      return;
    }
    const bibliography = processor.makeBibliography();
    console.log(bibliography);
    adapter.updateBibliography(bibliography[1].join('\n'));
  }

  retrieveItem(id: string): ICitableData {
    console.log(id);
    const [provider, key] = id.split('|', 1);
    const item = this.providers.get(provider)?.publications.get(key);
    if (!item) {
      throw Error(`Provider did not provide item for ${key}`);
    }
    return item;
  }

  retrieveLocale(lang: string): string {
    const xhr = new XMLHttpRequest();
    xhr.open(
      'GET',
      'https://raw.githubusercontent.com/Juris-M/citeproc-js-docs/master/locales-' +
        lang +
        '.xml',
      false
    );
    xhr.send(null);
    return xhr.responseText;
  }
}

/**
 * A notebook widget extension that adds a button to the toolbar.
 */
export class NotebookButtons
  implements DocumentRegistry.IWidgetExtension<NotebookPanel, INotebookModel>
{
  constructor(protected manager: UnifiedCitationManager) {}

  /**
   * Create a new extension object.
   */
  createNew(
    panel: NotebookPanel,
    context: DocumentRegistry.IContext<INotebookModel>
  ): IDisposable {
    const addCitationButton = new ToolbarButton({
      className: 'addCitation',
      icon: addCitationIcon,
      onClick: () => {
        this.manager.addCitation(panel);
      },
      tooltip: 'Add citation'
    });

    const addBibliographyButton = new ToolbarButton({
      className: 'addBibliography',
      icon: BibliographyIcon,
      onClick: () => {
        this.manager.addBibliography(panel);
        return false;
      },
      tooltip: 'Add bibliography'
    });

    panel.toolbar.insertItem(10, 'addCitation', addCitationButton);
    panel.toolbar.insertItem(11, 'addBibliography', addBibliographyButton);
    return new DisposableDelegate(() => {
      addCitationButton.dispose();
      addBibliographyButton.dispose();
    });
  }
}

/**
 * Initialization data for the jupyterlab-zotero extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-zotero:plugin',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker,
    settingRegistry: ISettingRegistry | null
  ) => {
    console.log('JupyterLab extension jupyterlab-zotero is activated!');

    const manager = new UnifiedCitationManager(notebookTracker);

    app.docRegistry.addWidgetExtension(
      'Notebook',
      new NotebookButtons(manager)
    );

    if (settingRegistry) {
      settingRegistry
        .load(plugin.id)
        .then(settings => {
          const client = new ZoteroClient(app, settings);
          manager.registerReferenceProvider(client);

          console.log('jupyterlab-zotero settings loaded:', settings.composite);
        })
        .catch(reason => {
          console.error(
            'Failed to load settings for jupyterlab-zotero.',
            reason
          );
        });
    }
  }
};

export default plugin;
