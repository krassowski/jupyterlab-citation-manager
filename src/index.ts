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
import { Debouncer } from '@lumino/polling';
import marked from 'marked';
import {
  CitationQuerySubset,
  CiteProcBibliography,
  ICitableData,
  ICitableWrapper,
  ICitation,
  ICitationItemData,
  ICitationManager,
  ICitationOption,
  ICiteProcEngine,
  IDocumentAdapter,
  IReferenceProvider
} from './types';
import { zoteroPlugin } from './zotero';
import { DefaultMap } from './utils';

import { LabIcon } from '@jupyterlab/ui-components';
import addCitation from '../style/icons/book-plus.svg';
import bibliography from '../style/icons/book-open-variant.svg';
import * as CSL from 'citeproc';
import { DateContentModel } from './_csl_citation';
import { CitationSelector } from './citationSelector';
import { ITranslator } from '@jupyterlab/translation';

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
      items: element.dataset.items
        ? element.dataset.items.startsWith('[')
          ? JSON.parse(element.dataset.items)
          : [element.dataset.items]
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

  updateBibliography(bibliography: string) {
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

class UnifiedCitationManager implements ICitationManager {
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

      const debouncedUpdate = new Debouncer(async () => {
        await Promise.all(
          [...this.providers.values()].map(provider => provider.isReady)
        );
        const adapter = this.getAdapter(panel);
        const processor = this.createProcessor();
        this.processors.set(panel, processor);
        adapter.citations = adapter.findCitations('all');
        console.log('found citations', adapter.citations);
        let i = 0;
        for (const citation of adapter.citations) {
          processor.appendCitationCluster({
            properties: {
              noteIndex: i
            },
            citationID: citation.citationId,
            citationItems: citation.items.map(itemID => {
              return {
                id: citation.source + '|' + itemID
              } as ICitationItemData;
            })
          });
          i++;
        }
        const bibliography = processor.makeBibliography();
        adapter.updateBibliography(this.processBibliography(bibliography));
      }, 2000);

      panel.content.modelContentChanged.connect(() => {
        debouncedUpdate.invoke().catch(console.warn);
      });
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
    for (const citation of existingCitations) {
      for (const item of citation.items) {
        const itemID = citation.source + '|' + item;
        const previous: number = citationCount.get(itemID);
        citationCount.set(itemID, previous + 1);
      }
    }
    // collect from providers
    const addedFromProviders = new Set<string>();

    for (const provider of this.providers.values()) {
      for (const publication of provider.publications.values()) {
        const id = provider.id + '|' + publication.id;
        addedFromProviders.add(id);
        options.push({
          source: provider.id,
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
      adapter = new NotebookAdapter(content);
      this.adapters.set(content, adapter);
      this.processors.set(content, this.createProcessor());
    }
    if (!adapter) {
      throw Error('This should not happen');
    }
    return adapter;
  }

  embedBibliographyEntry(itemID: string) {
    // TODO add a setting to switch it on/off
    // TODO why itemID is undefined???
    return `<a href="#${itemID}">↑</a>`;
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
      const citationsAfter = adapter.findCitations('after-cursor');

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
      console.log('before', citationsBefore);
      console.log('after', citationsAfter);

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
        citationsBefore.map((existingCitation, i) => [
          existingCitation.citationId,
          i
        ]),
        citationsAfter.map((existingCitation, i) => [
          existingCitation.citationId,
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
            items: [chosenOption.publication.id as string],
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
      adapter.updateBibliography(this.processBibliography(bibliography));
    });
  }

  protected processBibliography(bibliography: CiteProcBibliography): string {
    return (
      '\n' +
      (bibliography[0].bibstart || '') +
      bibliography[1].join('') +
      (bibliography[0].bibend || '') +
      '\n'
    );
  }

  createProcessor(styleID?: string): ICiteProcEngine {
    if (!styleID) {
      //styleID = 'chicago-fullnote-bibliography';
      styleID = 'apa';
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
    adapter.insertBibliography(this.processBibliography(bibliography));
  }

  retrieveItem(id: string): ICitableData {
    console.log(id);
    const splitPos = id.indexOf('|');
    const provider = id.slice(0, splitPos);
    const key = id.slice(splitPos + 1);
    console.log(key, provider);
    const item = this.providers.get(provider)?.publications.get(key);
    if (!item) {
      throw Error(`Provider did not provide item for ${key}`);
    }
    return {
      ...item,
      id: id
    };
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
 * Initialization data for the jupyterlab-citation-manager extension.
 */
const managerPlugin: JupyterFrontEndPlugin<ICitationManager> = {
  id: 'jupyterlab-citation-manager:ICitationManager',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ISettingRegistry, ITranslator],
  provides: ICitationManager,
  activate: (
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker,
    settingRegistry: ISettingRegistry | null,
    translator: ITranslator | null
  ) => {
    console.log('JupyterLab Citation Manager extension is activated!');

    const manager = new UnifiedCitationManager(notebookTracker);

    app.docRegistry.addWidgetExtension(
      'Notebook',
      new NotebookButtons(manager)
    );
    return manager;
  }
};

const plugins: JupyterFrontEndPlugin<any>[] = [managerPlugin, zoteroPlugin];

export default plugins;