import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { DocumentWidget } from '@jupyterlab/docregistry';
import { Debouncer } from '@lumino/polling';
import {
  CommandIDs,
  ICitableData,
  ICitation,
  ICitationContext,
  ICitationItemData,
  ICitationManager,
  ICitationOption,
  IDocumentAdapter,
  IStylePreviewProvider,
  IReferenceProvider,
  IStyle,
  IStyleManagerResponse,
  IPreviewNotAvailable,
  IStylePreview,
  IProgress,
  CiteProc,
  IUnambiguousItemIdentifier,
  ICitableItemRecordsBySource
} from './types';
import { zoteroPlugin } from './zotero';
import { DefaultMap, harmonizeData, simpleRequest } from './utils';

import * as CSL from 'citeproc';
import { CitationSelector } from './components/citationSelector';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';
import { NotebookAdapter, NotebookButtons } from './adapters/notebook';
import { ICommandPalette } from '@jupyterlab/apputils';
import { fetchAPI, requestAPI } from './handler';
import { StyleSelector } from './components/styleSelector';
import {
  addCitationIcon,
  bibliographyIcon,
  bookshelfIcon,
  paletteIcon
} from './icons';
import { ReferenceBrowser } from './components/referenceBrowser';
import { openerPlugin } from './opener';
import { IStatusBar } from '@jupyterlab/statusbar';
import { UpdateProgress } from './components/progressbar';
import { Signal } from '@lumino/signaling';
import { URLExt } from '@jupyterlab/coreutils';
import { refreshIcon } from '@jupyterlab/ui-components';

const PLUGIN_ID = 'jupyterlab-citation-manager:plugin';

class StylesManager {
  public isReady: Promise<any>;
  styles: IStyle[];
  private selector: StyleSelector;

  constructor(
    protected trans: TranslationBundle,
    previewProvider: IStylePreviewProvider
  ) {
    this.selector = new StyleSelector(trans, previewProvider);
    this.styles = [];
    // read the list of languages from the external extension
    this.isReady = this.fetchStylesList();
  }

  async selectStyle() {
    await this.isReady;
    return await this.selector.getItem(
      this.styles.map(style => {
        return {
          style: style
        };
      })
    );
  }

  updateStyles() {
    this.isReady = this.fetchStylesList();
  }

  protected fetchStylesList() {
    return requestAPI<IStyleManagerResponse>('styles').then(values => {
      console.debug('Styles are ready');
      this.styles = values.styles;
    });
  }
}

interface ICancellablePromise<T> {
  promise: Promise<T>;
  cancel: () => void;
  done: boolean;
}

/**
 * Transform the unambiguous identifier of a citable item
 * to a primitive JavaScript value (e.g. a string) so that
 * it can be used in associative arrays/maps/records.
 */
export function itemIdToPrimitive(item: IUnambiguousItemIdentifier): string {
  return item.source + '|' + item.id;
}

class UnifiedCitationManager implements ICitationManager {
  private providers: Map<string, IReferenceProvider>;
  private adapters: WeakMap<DocumentWidget, IDocumentAdapter<DocumentWidget>>;
  private selector: CitationSelector;
  private styles: StylesManager;
  private processors: WeakMap<DocumentWidget, Promise<CiteProc.IEngine>>;
  private localeCache: Map<string, string>;
  protected defaultStyleID = 'apa.csl';
  protected allReady: ICancellablePromise<any>;

  progress: Signal<UnifiedCitationManager, IProgress>;
  private currentAdapter: IDocumentAdapter<any> | null = null;

  protected createAllReadyPromiseWrapper(): ICancellablePromise<any> {
    const REASON_CANCELLED = 'cancelled';
    let cancel: () => void = () => 0;
    let resolveCanceller: () => void = () => 0;
    const cancellerPromise = new Promise<void>((resolve, reject) => {
      resolveCanceller = resolve;
      cancel = () => reject(REASON_CANCELLED);
    });
    const promise = {
      promise: Promise.race([
        Promise.all(
          [this.styles, ...this.providers.values()].map(
            provider => provider.isReady
          )
        ),
        cancellerPromise
      ])
        .catch(reason => {
          if (reason !== REASON_CANCELLED) {
            throw reason;
          }
        })
        .then(() => {
          promise.done = true;
          resolveCanceller();
        }),
      cancel: cancel,
      done: false
    };
    return promise;
  }

  constructor(
    protected notebookTracker: INotebookTracker,
    settingsRegistry: ISettingRegistry | null,
    protected trans: TranslationBundle,
    protected referenceBrowser: ReferenceBrowser
  ) {
    this.progress = new Signal(this);
    this.styles = new StylesManager(trans, this);
    this.selector = new CitationSelector(trans);
    this.selector.hide();
    this.adapters = new WeakMap();
    this.processors = new WeakMap();
    this.localeCache = new Map();
    // TODO generalize to allow use in Markdown Editor too
    notebookTracker.widgetAdded.connect((tracker, panel) => {
      const debouncedUpdate = new Debouncer(async () => {
        await this.createAllReadyPromiseWrapper().promise;
        this.processFromScratch(panel).catch(console.warn);
        // TODO: hoist debounce rate to settings
      }, 2000);

      panel.content.modelContentChanged.connect(() => {
        debouncedUpdate.invoke().catch(console.warn);
      });

      panel.context.ready.then(() => {
        const adapter = this.getAdapter(panel);
        adapter.migrateFormat().then(async migrated => {
          if (migrated) {
            console.log('Migrated citations, will refresh now...');
            await this.processFromScratch(panel);
          }
        });
      });

      panel.context.saveState.connect((sender, state) => {
        if (state === 'started') {
          this.beforeSave(panel);
        }
      });
    });
    notebookTracker.currentChanged.connect((tracker, panel) => {
      if (!panel) {
        return;
      }
      this.currentAdapter = this.getAdapter(panel);
      this.updateReferenceBrowser(this.currentAdapter);
    });
    this.providers = new Map();
    if (settingsRegistry) {
      settingsRegistry.load(PLUGIN_ID).then(settings => {
        settings.changed.connect(this.updateSettings);
        this.updateSettings(settings);
      });
    }
    // at this point this promise is not very useful as it has not
    // providers registered; more happens during provider registration
    this.allReady = this.createAllReadyPromiseWrapper();
  }

  async previewStyle(
    style: IStyle,
    maxCitations: number
  ): Promise<IStylePreview> {
    if (!this.notebookTracker.currentWidget) {
      throw {
        reason:
          'Please switch to a document that supports citations to generate a preview'
      } as IPreviewNotAvailable;
    }
    const panel = this.notebookTracker.currentWidget;
    const citations = this.getAdapter(panel).citations.slice(0, maxCitations);
    if (citations.length === 0) {
      throw {
        reason: 'No citations in the document to generate the preview from.'
      } as IPreviewNotAvailable;
    }
    const processor = await this.createProcessor(style.id);
    const renderedCitations: ICitation[] = [];
    for (const citation of this.processCitations(processor, citations)) {
      renderedCitations.push(citation);
    }
    return {
      citations: renderedCitations,
      bibliography: this.processBibliography(processor.makeBibliography()),
      style: style
    };
  }

  protected *processCitations(
    processor: CiteProc.IEngine,
    citations: ICitation[]
  ): Generator<ICitation> {
    let i = 0;
    for (const citation of citations) {
      // TODO: this could be rewritten to use `processCitationCluster` directly
      //  which should avoid an extra loop in `appendCitationCluster` driving complexity up
      // console.log('processing', citation);
      const [result] = processor.appendCitationCluster({
        properties: {
          noteIndex: i
        },
        citationID: citation.citationId,
        citationItems: citation.items.map(item => {
          return {
            id: itemIdToPrimitive(item)
          } as ICitationItemData;
        })
      });
      yield { ...citation, text: result[1] };
      i++;
    }
  }

  protected async processFromScratch(
    panel: NotebookPanel,
    styleId: string | undefined = undefined
  ) {
    const progressBase: Partial<IProgress> = {
      label: this.trans.__('Updating citations'),
      tooltip: this.trans.__(
        'Citation manager is updating citations and bibliography...'
      )
    };
    this.progress.emit({ ...progressBase, state: 'started' });
    const adapter = this.getAdapter(panel);
    if (!styleId) {
      styleId = adapter.getCitationStyle();
    }
    const processor = this.createProcessor(styleId);
    this.processors.set(panel, processor);
    adapter.citations = adapter.findCitations('all');

    const readyProcessor = await processor;
    let progress = 0;
    for (const citationInsertData of this.processCitations(
      readyProcessor,
      adapter.citations
    )) {
      progress += 1;
      adapter.updateCitation(citationInsertData);
      this.progress.emit({
        ...progressBase,
        state: 'ongoing',
        value: progress / adapter.citations.length
      });
    }
    const bibliography = readyProcessor.makeBibliography();
    adapter.updateBibliography(this.processBibliography(bibliography));
    this.progress.emit({ ...progressBase, state: 'completed' });

    this.updateReferenceBrowser(adapter);
  }

  protected updateReferenceBrowser(adapter?: IDocumentAdapter<any>) {
    if (!adapter) {
      const panel = this.notebookTracker.currentWidget;
      if (panel) {
        adapter = this.getAdapter(panel);
      }
    }
    const existingCitations = adapter ? adapter.citations : [];
    const fallbackData = adapter ? adapter.getCitableItemsFallbackData() : null;
    this.referenceBrowser
      .getItem(this.collectOptions(existingCitations, fallbackData))
      .catch(console.warn);
  }

  protected updateSettings(settings: ISettingRegistry.ISettings) {
    this.defaultStyleID = settings.get('defaultStyle').composite as string;
  }

  public registerReferenceProvider(provider: IReferenceProvider): void {
    console.debug('Adding reference provider', provider);
    this.providers.set(provider.id, provider);
    // cancel existing promise (if not complete) so that we won't get
    // multiple initial updates to the reference browser just
    // because multiple providers get added separately
    if (!this.allReady.done) {
      this.allReady.cancel();
    }
    this.createAllReadyPromiseWrapper().promise.then(() => {
      console.debug('All providers ready, updating reference browser...');
      this.updateReferenceBrowser();
    });
  }

  public async updateReferences() {
    return Promise.all(
      [...this.providers.values()].map(provider =>
        provider.updatePublications(true)
      )
    ).then(() => {
      this.updateReferenceBrowser();
    });
  }

  private collectOptions(
    existingCitations: ICitation[],
    fallbackItemData: ICitableItemRecordsBySource | null
  ): ICitationOption[] {
    const options = [];
    const citationLookup = new Map<string, IUnambiguousItemIdentifier>();
    const citationCount = new DefaultMap<string, ICitationContext[]>(() => []);
    for (const citation of existingCitations) {
      for (const itemID of citation.items) {
        const primitiveID = itemIdToPrimitive(itemID);
        const previous: ICitationContext[] = citationCount.get(primitiveID);
        previous.push(citation.context);
        citationCount.set(primitiveID, previous);
        citationLookup.set(primitiveID, itemID);
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
    const failedToGetFallbackFor = [];
    // add citable items that already are in document but do not match the providers
    for (const [primitiveID, itemID] of citationLookup.entries()) {
      if (!addedFromProviders.has(primitiveID)) {
        if (!fallbackItemData) {
          failedToGetFallbackFor.push({
            item: itemID,
            reason: 'fallback missing'
          });
          continue;
        }
        if (!(itemID.source in fallbackItemData)) {
          failedToGetFallbackFor.push({
            item: itemID,
            reason: 'fallback for this source missing'
          });
          continue;
        }
        const sourceFallback = fallbackItemData[itemID.source];
        if (!(itemID.id in sourceFallback)) {
          failedToGetFallbackFor.push({
            item: itemID,
            reason: 'fallback for this item missing'
          });
          continue;
        }
        options.push({
          source: itemID.source,
          publication: sourceFallback[itemID.id],
          isFallback: true,
          citationsInDocument: citationCount.get(primitiveID)
        });
      }
    }
    if (failedToGetFallbackFor.length) {
      console.warn(
        'Failed to get fallback metadata for some items and those cannot be displayed',
        failedToGetFallbackFor
      );
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

  beforeSave(content: NotebookPanel) {
    const adapter = this.getAdapter(content);
    const citations = adapter.findCitations('all');
    const citableItems = new DefaultMap<string, Set<string>>(() => new Set());
    for (const citation of citations) {
      for (const item of citation.items) {
        const itemsSet = citableItems.get(item.source);
        citableItems.set(item.source, itemsSet.add(item.id));
      }
    }
    console.log(citableItems);
    adapter.setCitableItemsFallbackData(
      Object.fromEntries(
        [...citableItems.entries()].map(([source, items]) => {
          return [
            source,
            Object.fromEntries(
              [...items.values()].sort().map(id => {
                const item = this.retrieveItem(
                  itemIdToPrimitive({ source, id: id })
                );
                item.id = id;
                return [id, item];
              })
            )
          ];
        })
      )
    );
  }

  addCitation(content: NotebookPanel) {
    const originallyFocusedElement = document.activeElement;
    const adapter = this.getAdapter(content);
    // TODO: remove
    adapter.citations = adapter.findCitations('all');
    const fallbackData = adapter ? adapter.getCitableItemsFallbackData() : null;

    // do not search document for citations, but if any are already cached prioritize those
    const citationsAlreadyInDocument = adapter.citations;
    // TODO replace selection list with a neat modal selector with search option

    const options = this.collectOptions(
      citationsAlreadyInDocument,
      fallbackData
    );

    this.selector
      .getItem(options)
      .then(async chosenOption => {
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

        const citationsBeforeMap: Record<number, ICitation> =
          Object.fromEntries(citationsBefore.map((c, index) => [index, c]));
        const citationsAfterMap: Record<number, ICitation> = Object.fromEntries(
          citationsAfter.map((c, index) => [index + 1, c])
        );
        // console.log('before', citationsBefore);
        // console.log('after', citationsAfter);

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
            const itemID: IUnambiguousItemIdentifier = {
              id: chosenOption.publication.id as string,
              source: chosenOption.source
            };
            (adapter as NotebookAdapter).insertCitation({
              text: newText,
              items: [itemID],
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
        adapter.citations = adapter.findCitations('all');
        this.updateReferenceBrowser(adapter);
      })
      .finally(() => {
        this.refocusWidget(content, originallyFocusedElement);
      });
  }

  private refocusWidget(
    content: NotebookPanel,
    originallyFocusedElement: Element | null
  ) {
    setTimeout(() => {
      if (originallyFocusedElement) {
        // TODO test
        (originallyFocusedElement as HTMLElement)?.focus();
      } else {
        // if nothing was focused, focus the active cell
        content.content.widgets[content.content.activeCellIndex].editor.focus();
      }
    }, 0);
  }

  protected processBibliography(bibliography: CiteProc.Bibliography): string {
    return (
      '\n' +
      (bibliography[0].bibstart || '') +
      bibliography[1].join('') +
      (bibliography[0].bibend || '') +
      '\n'
    );
  }

  async createProcessor(styleID?: string): Promise<CiteProc.IEngine> {
    if (!styleID) {
      styleID = this.defaultStyleID;
    }
    // try the offline copy first, in case those are use-defined (local) styles,
    // and because it should be generally faster and nicer for GitHub:
    // TODO: should it use style object? What should be stored as the default? Are filename identifiers stable?
    return fetchAPI(URLExt.join('styles', styleID))
      .then(response => {
        console.log(`Success fetching style ${styleID} from server extension`);
        return new CSL.Engine(this, response);
      })
      .catch(() => {
        console.warn(
          `Could not get the style ${styleID} from server extension;` +
            ' falling back to the fetching directly from GitHub.'
        );

        // fallback to online copy (in case of server not being available):
        return simpleRequest(
          `https://raw.githubusercontent.com/citation-style-language/styles/master/${styleID}`
        ).then(result => {
          const styleAsText = result.response.responseText;
          return new CSL.Engine(this, styleAsText);
        });
      });
  }

  async addBibliography(content: NotebookPanel) {
    console.debug('Adding bibliography');
    const adapter = this.getAdapter(content);
    const processor = await this.processors.get(content);
    if (!processor) {
      console.warn('Could not find a processor for ', content);
      return;
    }
    const bibliography = processor.makeBibliography();
    adapter.insertBibliography(this.processBibliography(bibliography));
  }

  changeStyle(content: NotebookPanel) {
    const originallyFocusedElement = document.activeElement;
    this.styles
      .selectStyle()
      .then(style => {
        console.log('selected style', style);
        this.getAdapter(content).setCitationStyle(style.style.id);
        this.processFromScratch(content, style.style.id).then(console.warn);
      })
      .finally(() => {
        this.refocusWidget(content, originallyFocusedElement);
      });
  }

  retrieveItem(id: string): ICitableData {
    const splitPos = id.indexOf('|');
    const provider = id.slice(0, splitPos);
    const key = id.slice(splitPos + 1);
    let item = this.providers.get(provider)?.citableItems.get(key);
    // fallback
    if (!item && this.currentAdapter) {
      const fallbackData = this.currentAdapter.getCitableItemsFallbackData();
      if (!fallbackData) {
        console.log(`No fallback data to resolve ${key}`);
      } else {
        if (provider in fallbackData) {
          if (!(key in fallbackData[provider])) {
            console.log(`${key} not in fallback for ${provider}`);
          }
          item = fallbackData[provider][key];
        } else {
          console.log(`${provider} not in fallback data`);
        }
      }
    }
    if (!item) {
      throw Error(`Provider did not provide item for ${key}`);
    }
    return {
      ...item,
      id: id
    };
  }

  retrieveLocale(lang: string): string {
    let locale = this.localeCache.get(lang);
    if (locale) {
      return locale;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(
      'GET',
      'https://raw.githubusercontent.com/citation-style-language/locales/master/locales-' +
        lang +
        '.xml',
      false
    );
    xhr.send(null);
    locale = xhr.responseText;
    this.localeCache.set(lang, locale);
    return locale;
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

  const hasPanel = () => {
    const panel = notebookTracker.currentWidget;
    return !!panel;
  };
  const executeOnCurrent = (callback: (panel: NotebookPanel) => void) => {
    return () => {
      const panel = notebookTracker.currentWidget;
      if (!panel) {
        console.warn('Panel not found for command');
        return;
      }
      callback(panel);
    };
  };

  app.commands.addCommand(CommandIDs.insertCitation, {
    label: trans.__('Insert citation'),
    caption: trans.__(
      'Insert citation at the current cursor position in the active document.'
    ),
    execute: executeOnCurrent(manager.addCitation.bind(manager)),
    isEnabled: hasPanel,
    icon: addCitationIcon
  });

  app.commands.addCommand(CommandIDs.insertBibliography, {
    label: trans.__('Insert bibliography'),
    caption: trans.__(
      'Insert bibliography at the current cursor position in the active document.'
    ),
    execute: executeOnCurrent(manager.addBibliography.bind(manager)),
    isEnabled: hasPanel,
    icon: bibliographyIcon
  });

  app.commands.addCommand(CommandIDs.changeBibliographyStyle, {
    label: trans.__('Change bibliography style'),
    caption: trans.__('Change bibliography style for the active document.'),
    execute: executeOnCurrent(manager.changeStyle.bind(manager)),
    isEnabled: hasPanel,
    icon: paletteIcon
  });

  app.commands.addCommand(CommandIDs.updateReferences, {
    label: trans.__('Update references'),
    caption: trans.__('Synchronise the references from all providers.'),
    execute: manager.updateReferences.bind(manager),
    icon: refreshIcon
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
    commandPalette.addItem({
      command: CommandIDs.updateReferences,
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
  optional: [
    ISettingRegistry,
    ITranslator,
    ICommandPalette,
    IStatusBar,
    ILayoutRestorer
  ],
  provides: ICitationManager,
  activate: (
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker,
    settingRegistry: ISettingRegistry | null,
    translator: ITranslator | null,
    commandPalette: ICommandPalette | null,
    statusBar: IStatusBar | null,
    restorer: ILayoutRestorer | null
  ) => {
    console.log('JupyterLab Citation Manager extension is activated!');

    translator = translator || nullTranslator;
    const trans = translator.load('jupyterlab-citation-manager');

    const referenceBrowser = new ReferenceBrowser(trans, app.commands);

    const manager = new UnifiedCitationManager(
      notebookTracker,
      settingRegistry,
      trans,
      referenceBrowser
    );

    addCommands(app, notebookTracker, manager, trans, commandPalette);

    if (statusBar) {
      statusBar.registerStatusItem(PLUGIN_ID, {
        item: new UpdateProgress(manager.progress),
        rank: 900
      });
    }

    try {
      referenceBrowser.id = 'jupyterlab-citation-manager:reference-browser';
      referenceBrowser.title.icon = bookshelfIcon;
      referenceBrowser.title.caption = 'Reference Browser';
      referenceBrowser.show();
      // below the git extension but not at the very end
      app.shell.add(referenceBrowser, 'left', { rank: 850 });
      if (restorer) {
        restorer.add(referenceBrowser, referenceBrowser.id);
      }
    } catch (error) {
      console.warn(
        'Could not attach the reference browser to the sidebar',
        error
      );
    }

    app.docRegistry.addWidgetExtension(
      'Notebook',
      new NotebookButtons(manager, app)
    );
    return manager;
  }
};

const plugins: JupyterFrontEndPlugin<any>[] = [
  managerPlugin,
  zoteroPlugin,
  openerPlugin
];

export default plugins;
