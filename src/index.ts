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
import { InputDialog, ToolbarButton } from '@jupyterlab/apputils';
import marked from 'marked';
import {
  ICitation,
  ICitationOption,
  IPublication,
  IReferenceProvider
} from './types';
import { ZoteroClient } from './zotero';
import { DefaultMap } from './utils';

interface IModelAdapter<T extends DocumentWidget> {
  /**
   * Insert citation at current position.
   */
  citations: ICitation[];
  document: T;
  insertCitation(citation: ICitation): void;
  updateBibliography(bibliography: Map<ICitation, IPublication>): void;
  findCitations(): ICitation[];
}

function extractCitations(markdown: string): ICitation[] {
  const html: string = marked(markdown);
  const div = document.createElement('div');
  div.innerHTML = html;
  return [...div.querySelectorAll('cite').values()].map(element => {
    return {
      id: element.dataset.id,
      source: element.dataset.source,
      text: element.innerHTML
    } as ICitation;
  });
}

class NotebookAdapter implements IModelAdapter<NotebookPanel> {
  citations: ICitation[];
  // TODO
  // style: ICitationStyle;
  constructor(public document: NotebookPanel) {
    this.citations = [];
  }

  insertCitation(citation: ICitation): void {
    const activeCell = this.document.content.activeCell;
    if (activeCell) {
      const cursor = activeCell.editor.getCursorPosition();
      const offset = activeCell.editor.getOffsetAt(cursor);
      activeCell.model.value.insert(
        offset,
        `<cite data-source="${citation.source}" data-id="${citation.id}">${citation.text}</cite>`
      );
    }
  }

  updateBibliography(bibliography: Map<ICitation, IPublication>) {
    this.document;
  }

  findCitations(): ICitation[] {
    this.document.content.widgets
      .filter(cell => cell.model.type === 'markdown')
      .forEach(cell => {
        extractCitations(cell.model.value.text);
      });
    // TODO: use cache of cells contents?
    return [];
  }
}

class UnifiedCitationManager {
  private providers: IReferenceProvider[];
  private adapters: WeakMap<DocumentWidget, IModelAdapter<DocumentWidget>>;

  constructor(notebookTracker: INotebookTracker) {
    this.adapters = new WeakMap();
    // TODO generalize to allow use in Markdown Editor too
    notebookTracker.currentChanged.connect((tracker, panel) => {
      if (panel && !this.adapters.has(panel)) {
        const adapter = new NotebookAdapter(panel);
        this.adapters.set(panel, adapter);
      }
    });
    this.providers = [];
  }

  registerReferenceProvider(provider: IReferenceProvider): void {
    this.providers.push(provider);
  }

  collectOptions(existingCitations: ICitation[]): ICitationOption[] {
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
    for (const provider of this.providers) {
      for (const publication of provider.publications) {
        const id = provider.name + '|' + publication.id;
        addedFromProviders.add(id);
        options.push({
          source: provider.name,
          publication: publication,
          citationsInDocument: citationCount.get(id)
        } as ICitationOption);
      }
    }
    // add citations that already are in document but do not match the providers
    for (const [id, citation] of citationLookup.entries()) {
      if (!addedFromProviders.has(id)) {
        options.push({
          source: citation.source,
          publication: citation as Partial<IPublication>,
          citationsInDocument: citationCount.get(id)
        });
      }
    }
    return options;
  }

  addCitation(content: NotebookPanel) {
    console.log('adding citation');
    let adapter = this.adapters.get(content);
    if (!adapter) {
      // todo getOrCreate
      adapter = new NotebookAdapter(content);
      this.adapters.set(content, adapter);
    }
    // do not search document for citations, but if any are already cached prioritize those
    const citationsAlreadyInDocument = adapter.citations;
    // TODO replace selection list with a neat modal selector with search option

    const options = this.collectOptions(citationsAlreadyInDocument);

    const renderOption = (option: ICitationOption) => {
      return (
        option.source +
        ' ' +
        option.citationsInDocument +
        ' ' +
        option.publication.title
      );
    };

    const renderedOptions = options.map(renderOption);

    InputDialog.getItem({
      items: renderedOptions,
      title: 'Choose citation to insert'
    }).then(result => {
      if (result.value) {
        const chosenIndex = renderedOptions.indexOf(result.value);
        if (chosenIndex === -1) {
          return;
        }
        const chosenOption = options[chosenIndex];
        (adapter as NotebookAdapter).insertCitation({
          source: chosenOption.source,
          // TODO: use citeproc, citation.js or other to format the citation
          text:
            chosenOption.publication.title ||
            (chosenOption.publication.id as string),
          id: chosenOption.publication.id as string
        });
      }
    });
    // TODO show react dialog? Jupyter dialog with custom body?
  }
}

/**
 * A notebook widget extension that adds a button to the toolbar.
 */
export class AddCitationButton
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
    const button = new ToolbarButton({
      className: 'addCitation',
      iconClass: 'fa fa-fast-forward',
      onClick: () => {
        this.manager.addCitation(panel);
      },
      tooltip: 'Add citation'
    });

    panel.toolbar.insertItem(0, 'addCitation', button);
    return new DisposableDelegate(() => {
      button.dispose();
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
      new AddCitationButton(manager)
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
