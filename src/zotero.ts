import { ICitableData, ICitationManager, IReferenceProvider } from './types';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { LabIcon } from '@jupyterlab/ui-components';
import zoteroSvg from '../style/icons/book-plus.svg';
import ISettings = ISettingRegistry.ISettings;
import { InputDialog } from '@jupyterlab/apputils';
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';

export const zoteroIcon = new LabIcon({
  name: 'citation:zotero',
  // TODO: add proper zotero icon? There are some trademark considerations, may need an email first...
  svgstr: zoteroSvg
});

interface IUser {
  name: string;
  id: number;
}

interface ILink {
  rel: string;
  url: string;
}

type Rel = 'next' | 'last' | 'alternate';

function parseLinks(links: string): Map<Rel, ILink> {
  const result = new Map();
  for (const link_data of links.split(',')) {
    const link = link_data.split(';');
    const url = link[0].slice(1, -1);
    const relMatch = / ?rel="(.*?)"/.exec(link[1]);
    if (!relMatch) {
      throw 'Could not parse rel of Zotero link';
    }
    const rel = relMatch[1];
    result.set(rel, { rel, url });
  }

  return result;
}

export class ZoteroClient implements IReferenceProvider {
  id = 'zotero';
  name = 'Zotero';
  icon = zoteroIcon;
  private serverURL: string | null = null;
  private key: string | null = null;
  private user: IUser | null = null;
  publications: Map<string, ICitableData>;
  isReady: Promise<any>;

  constructor(
    protected settings: ISettings,
    protected trans: TranslationBundle
  ) {
    settings.changed.connect(this.updateSettings, this);
    this.isReady = this.updateSettings(settings);
    this.publications = new Map();
  }

  private async fetch(endpoint: string, args: Record<string, string> = {}) {
    if (!this.key) {
      const userKey = await InputDialog.getPassword({
        title: this.trans.__('Configure Zotero API Access key'),
        label: this.trans.__(
          `In order to access your Zotero collection you need to configure Zotero API key.
          You can generate the API key after logging to www.zotero.org.
          The key looks like this: P9NiFoyLeZu2bZNvvuQPDWsd.`
        )
      });
      if (userKey.value) {
        this.key = userKey.value;
        this.settings.set('key', this.key).catch(console.warn);
      } else {
        return;
      }
    }

    return fetch(
      this.serverURL + '/' + endpoint + '?' + new URLSearchParams(args),
      {
        method: 'GET',
        headers: {
          // 'Content-Type': 'application/json',
          'Zotero-API-Key': this.key
        }
      }
    );
  }

  // TODO add this as a button in the sidebar
  public async updatePublications(): Promise<ICitableData[]> {
    // TODO implement caching 503 and rate-limiting/debouncing
    const publications = await this.loadAll(
      'users/' + this.user?.id + '/items',
      'csljson',
      'items'
    );
    console.log(publications);
    this.publications = new Map(
      (publications || []).map(item => {
        console.log(item);
        const data = item as ICitableData;
        return [data.id + '', data];
      })
    );
    return [...this.publications.values()];
  }

  private async loadAll(
    endpoint: string,
    format = 'csljson',
    extract?: string,
    progress?: (progress: number) => void
  ) {
    let result = await this.fetch(endpoint, { format: format });
    const responses = [];
    // TODO
    const total =
      parseInt(result?.headers.get('Total-Results') as string, 10) || 10000;
    let i = 0;
    let done = false;
    while (!done && i <= total) {
      i += 1;
      if (!result) {
        console.log('Could not retrieve all pages for ', endpoint);
        return;
      }
      console.log(result);
      responses.push(result);
      const links = parseLinks(result?.headers.get('Link') as string);
      console.log('links', links);
      const next = links.get('next')?.url;
      if (next) {
        console.log(
          'params for next',
          Object.fromEntries(
            new URLSearchParams(new URL(next).search).entries()
          )
        );
        result = await this.fetch(endpoint, {
          ...Object.fromEntries(
            new URLSearchParams(new URL(next).search).entries()
          ),
          format: format
        });
        // TODO: remove short circuit in future it is just here to iterate fast:
        done = true;
      } else {
        done = true;
      }
    }
    const results = [];
    for (const response of responses) {
      let responseItems = await response.json();
      console.log(responseItems);
      if (extract) {
        responseItems = responseItems[extract];
      }
      for (const item of responseItems) {
        results.push(item);
      }
    }
    return results;
  }

  private reloadKey() {
    return this.fetch('keys/' + this.key).then(response => {
      if (!response) {
        console.error(response);
        return;
      }
      return response.json().then(result => {
        console.log(result);
        this.user = {
          name: result.username,
          id: result.userID
        };
        return this.updatePublications();
      });
    });
  }

  private updateSettings(settings: ISettings) {
    this.key = settings.composite.key as string;
    this.serverURL = settings.composite.server as string;
    return this.reloadKey();
  }
}

export const zoteroPlugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-citation-manager:zotero',
  requires: [ICitationManager, ISettingRegistry],
  optional: [ITranslator],
  autoStart: true,
  activate: (
    app: JupyterFrontEnd,
    manager: ICitationManager,
    settingRegistry: ISettingRegistry,
    translator: ITranslator | null
  ) => {
    console.log('JupyterLab citation manager provider of Zotero is activated!');
    translator = translator || nullTranslator;
    const trans = translator.load('jupyterlab-citation-manager');

    settingRegistry
      .load(zoteroPlugin.id)
      .then(settings => {
        const client = new ZoteroClient(settings, trans);
        manager.registerReferenceProvider(client);

        console.log(
          'jupyterlab-citation-manager:zotero settings loaded:',
          settings.composite
        );
      })
      .catch(reason => {
        console.error(
          'Failed to load settings for jupyterlab-citation-manager:zotero.',
          reason
        );
      });
  }
};
