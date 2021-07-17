import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { DocumentWidget } from '@jupyterlab/docregistry';
import { Debouncer } from '@lumino/polling';
import {
  CiteProcBibliography,
  CommandIDs,
  ICitableData,
  ICitation,
  ICitationItemData,
  ICitationManager,
  ICitationOption,
  ICiteProcEngine,
  IDocumentAdapter,
  IReferenceProvider,
  IStyle,
  IStyleManagerResponse
} from './types';
import { zoteroPlugin } from './zotero';
import { DefaultMap, harmonizeData, simpleRequest } from './utils';

import { LabIcon } from '@jupyterlab/ui-components';
import addCitation from '../style/icons/book-plus.svg';
import bibliography from '../style/icons/book-open-variant.svg';
import * as CSL from 'citeproc';
import { CitationSelector } from './citationSelector';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';
import { NotebookAdapter, NotebookButtons } from './adapters/notebook';
import { ICommandPalette } from '@jupyterlab/apputils';
import { requestAPI } from './handler';
import { StyleSelector } from './styleSelector';

export const addCitationIcon = new LabIcon({
  name: 'citation:add',
  svgstr: addCitation
});

export const BibliographyIcon = new LabIcon({
  name: 'citation:bibliography',
  svgstr: bibliography
});

const PLUGIN_ID = 'jupyterlab-citation-manager:plugin';

class StylesManager {
  public ready: Promise<any>;
  styles: IStyle[];
  private selector: StyleSelector;

  constructor(protected trans: TranslationBundle) {
    this.selector = new StyleSelector(trans);
    this.styles = [];
    // read the list of languages from the external extension
    this.ready = this.fetchStylesList();
  }

  async selectStyle() {
    await this.ready;
    return await this.selector.getItem(
      this.styles.map(style => {
        return {
          style: style
        };
      })
    );
  }

  updateStyles() {
    this.ready = this.fetchStylesList();
  }

  protected fetchStylesList() {
    return requestAPI<any>('styles').then((values: IStyleManagerResponse) => {
      console.debug('Styles are ready');
      this.styles = values.styles;
    });
  }
}

class UnifiedCitationManager implements ICitationManager {
  private providers: Map<string, IReferenceProvider>;
  private adapters: WeakMap<DocumentWidget, IDocumentAdapter<DocumentWidget>>;
  private selector: CitationSelector;
  private styles: StylesManager;
  private processors: WeakMap<DocumentWidget, Promise<ICiteProcEngine>>;
  protected defaultStyleID = 'apa';

  constructor(
    notebookTracker: INotebookTracker,
    settingsRegistry: ISettingRegistry | null,
    protected trans: TranslationBundle
  ) {
    this.styles = new StylesManager(trans);
    this.selector = new CitationSelector(trans);
    this.selector.hide();
    this.adapters = new WeakMap();
    this.processors = new WeakMap();
    // TODO generalize to allow use in Markdown Editor too
    notebookTracker.widgetAdded.connect((tracker, panel) => {
      const debouncedUpdate = new Debouncer(async () => {
        await Promise.all(
          [...this.providers.values()].map(provider => provider.isReady)
        );
        this.processFromScratch(panel).catch(console.warn);
        // TODO: hoist debounce rate to settings
      }, 2000);

      panel.content.modelContentChanged.connect(() => {
        debouncedUpdate.invoke().catch(console.warn);
      });
    });
    this.providers = new Map();
    if (settingsRegistry) {
      settingsRegistry.load(PLUGIN_ID).then(settings => {
        settings.changed.connect(this.updateSettings);
        this.updateSettings(settings);
      });
    }
  }

  protected async processFromScratch(
    panel: NotebookPanel,
    styleId: string | undefined = undefined
  ) {
    const adapter = this.getAdapter(panel);
    if (!styleId) {
      styleId = adapter.getCitationStyle();
    }
    const processor = this.createProcessor(styleId);
    this.processors.set(panel, processor);
    adapter.citations = adapter.findCitations('all');

    let i = 0;
    const readyProcessor = await processor;
    for (const citation of adapter.citations) {
      // TODO: this could be rewritten to use `processCitationCluster` directly
      //  which should avoid an extra loop in `appendCitationCluster` driving complexity up
      const [result] = readyProcessor.appendCitationCluster({
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
      console.log(result);
      adapter.updateCitation({ ...citation, text: result[1] });
      i++;
    }
    const bibliography = (await processor).makeBibliography();
    adapter.updateBibliography(this.processBibliography(bibliography));
  }

  protected updateSettings(settings: ISettingRegistry.ISettings) {
    this.defaultStyleID = settings.get('defaultStyle').composite as string;
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
      for (const publication of provider.citableItems.values()) {
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
      const initialStyle = adapter.getCitationStyle();
      this.processors.set(content, this.createProcessor(initialStyle));
    }
    if (!adapter) {
      throw Error('This should not happen');
    }
    return adapter;
  }

  embedBibliographyEntry(itemID: string) {
    if (itemID) {
      // TODO add a setting to switch it on/off
      // TODO why itemID is undefined???
      return `<a href="#${itemID}">↑</a>`;
    }
    return '';
  }

  addCitation(content: NotebookPanel) {
    const adapter = this.getAdapter(content);
    // TODO: remove
    adapter.citations = adapter.findCitations('all');

    // do not search document for citations, but if any are already cached prioritize those
    const citationsAlreadyInDocument = adapter.citations;
    // TODO replace selection list with a neat modal selector with search option

    const options = this.collectOptions(citationsAlreadyInDocument);

    this.selector.getItem(options).then(async chosenOption => {
      const processor = await this.processors.get(content);
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

  async createProcessor(styleID?: string): Promise<ICiteProcEngine> {
    if (!styleID) {
      styleID = this.defaultStyleID;
    }
    // try the offline copy first, in case those are use-defined (local) styles,
    // and because it should be generally faster and nicer for GitHub:
    // TODO: should it use style object? What should be stored as the default? Are filename identifiers stable?

    // fallback to online copy (in case of server not being available):
    return simpleRequest(
      `https://raw.githubusercontent.com/citation-style-language/styles/master/${styleID}.csl`
    ).then(result => {
      const styleAsText = result.response.responseText;
      return new CSL.Engine(this, styleAsText);
    });
  }

  async addBibliography(content: NotebookPanel) {
    console.log('adding bibliography');
    const adapter = this.getAdapter(content);
    const processor = await this.processors.get(content);
    if (!processor) {
      console.warn('Could not find a processor for ', content);
      return;
    }
    const bibliography = processor.makeBibliography();
    console.log(bibliography);
    adapter.insertBibliography(this.processBibliography(bibliography));
  }

  changeStyle(content: NotebookPanel) {
    this.styles.selectStyle().then(style => {
      console.log('selected style', style);
      this.getAdapter(content).setCitationStyle(style.style.shortId);
      this.processFromScratch(content, style.style.shortId).then(console.warn);
    });
  }

  retrieveItem(id: string): ICitableData {
    const splitPos = id.indexOf('|');
    const provider = id.slice(0, splitPos);
    const key = id.slice(splitPos + 1);
    const item = this.providers.get(provider)?.citableItems.get(key);
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
      'https://raw.githubusercontent.com/citation-style-language/locales/master/locales-' +
        lang +
        '.xml',
      false
    );
    xhr.send(null);
    return xhr.responseText;
  }
}

function addCommands(
  app: JupyterFrontEnd,
  notebookTracker: INotebookTracker,
  manager: UnifiedCitationManager,
  trans: TranslationBundle,
  commandPalette: ICommandPalette | null
) {
  console.log('adding commands');
  app.commands.addCommand(CommandIDs.insertCitation, {
    label: trans.__('Insert citation'),
    caption: trans.__(
      'Insert citation at the current cursor position in the active document.'
    ),
    execute: () => {
      const panel = notebookTracker.currentWidget;
      if (!panel) {
        console.warn('Panel not found for command');
        return;
      }
      manager.addCitation(panel);
    },
    isEnabled: () => {
      const panel = notebookTracker.currentWidget;
      return !!panel;
    },
    icon: addCitationIcon
  });

  app.commands.addCommand(CommandIDs.insertBibliography, {
    label: trans.__('Insert bibliography'),
    caption: trans.__(
      'Insert bibliography at the current cursor position in the active document.'
    ),
    execute: () => {
      const panel = notebookTracker.currentWidget;
      if (!panel) {
        console.warn('Panel not found for command');
        return;
      }
      manager.addBibliography(panel).catch(console.warn);
    },
    isEnabled: () => {
      const panel = notebookTracker.currentWidget;
      return !!panel;
    },
    icon: BibliographyIcon
  });

  app.commands.addCommand(CommandIDs.changeBibliographyStyle, {
    label: trans.__('Change bibliography style'),
    caption: trans.__('Change bibliography style for the active document.'),
    execute: () => {
      const panel = notebookTracker.currentWidget;
      if (!panel) {
        console.warn('Panel not found for command');
        return;
      }
      manager.changeStyle(panel);
    },
    isEnabled: () => {
      const panel = notebookTracker.currentWidget;
      return !!panel;
    }
  });

  if (commandPalette) {
    const category = trans.__('Citation Manager');
    commandPalette.addItem({
      command: CommandIDs.insertCitation,
      category: category
    });
    commandPalette.addItem({
      command: CommandIDs.insertBibliography,
      category: category
    });
    commandPalette.addItem({
      command: CommandIDs.changeBibliographyStyle,
      category: category
    });
  }
}

/**
 * Initialization data for the jupyterlab-citation-manager extension.
 */
const managerPlugin: JupyterFrontEndPlugin<ICitationManager> = {
  id: PLUGIN_ID,
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ISettingRegistry, ITranslator, ICommandPalette],
  provides: ICitationManager,
  activate: (
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker,
    settingRegistry: ISettingRegistry | null,
    translator: ITranslator | null,
    commandPalette: ICommandPalette | null
  ) => {
    console.log('JupyterLab Citation Manager extension is activated!');

    translator = translator || nullTranslator;
    const trans = translator.load('jupyterlab-citation-manager');

    const manager = new UnifiedCitationManager(
      notebookTracker,
      settingRegistry,
      trans
    );

    addCommands(app, notebookTracker, manager, trans, commandPalette);

    app.docRegistry.addWidgetExtension(
      'Notebook',
      new NotebookButtons(manager, app)
    );
    return manager;
  }
};

const plugins: JupyterFrontEndPlugin<any>[] = [managerPlugin, zoteroPlugin];

export default plugins;
