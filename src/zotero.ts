import {
  ICitableData,
  ICitationManager,
  IProgress,
  IReferenceProvider
} from './types';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { LabIcon } from '@jupyterlab/ui-components';
import zoteroSvg from '../style/icons/book-plus.svg';
import ISettings = ISettingRegistry.ISettings;
import {
  ITranslator,
  nullTranslator,
  TranslationBundle
} from '@jupyterlab/translation';
import { IStateDB } from '@jupyterlab/statedb';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { Signal } from '@lumino/signaling';
import { UpdateProgress } from './components/progressbar';
import { IStatusBar } from '@jupyterlab/statusbar';
import { getAccessKeyDialog } from './components/dialogs';

export const zoteroIcon = new LabIcon({
  name: 'citation:zotero',
  // TODO: add proper zotero icon? There are some trademark considerations, may need an email first...
  svgstr: zoteroSvg
});

const PLUGIN_ID = 'jupyterlab-citation-manager:zotero';

interface IUser {
  name: string;
  id: number;
}

interface ILink {
  rel: string;
  url: string;
}

type Rel = 'first' | 'prev' | 'next' | 'last' | 'alternate';

export function parseLinks(links: string): Map<Rel, ILink> {
  const result = new Map();
  for (const link_data of links.split(',')) {
    const link = link_data.split(';');
    const url = /<(.*?)>/.exec(link[0]);
    if (!url) {
      throw 'Could not parse URL of Zotero link';
    }
    const relMatch = / ?rel="(.*?)"/.exec(link[1]);
    if (!relMatch) {
      throw 'Could not parse rel of Zotero link';
    }
    const rel = relMatch[1];
    result.set(rel, { rel, url: url[1] });
  }

  return result;
}

interface IZoteroRequestHeaders {
  'Zotero-API-Key': string;
  'Zotero-API-Version'?: string;
  'If-Modified-Since-Version'?: string;
}

class ZoteroResponseHeaders {
  /**
   * Time that the server requests us to back off if under high load.
   */
  backoffSeconds: number | null;
  /**
   * Last modified version of library or item (depending on request).
   */
  lastModifiedVersion: string | null;
  /**
   * API version that the server uses (may be newer than ours).
   */
  apiVersion: string | null;

  private parseIntIfPresent(name: string): number | null {
    const backoff = this.headers.get(name);
    if (backoff) {
      try {
        return parseInt(backoff, 10);
      } catch (error) {
        console.warn(
          'Failed to parse backoff time from Zotero API response headers'
        );
        return null;
      }
    } else {
      return null;
    }
  }

  constructor(protected headers: Headers) {
    this.backoffSeconds = this.parseIntIfPresent('Backoff');
    this.lastModifiedVersion = this.headers.get('Last-Modified-Version');
    this.apiVersion = this.headers.get('Zotero-API-Version');
  }
}

interface IZoteroPersistentCacheState extends ReadonlyPartialJSONObject {
  lastModifiedLibraryVersion: string | null;
  persistentCacheVersion: string | null;
  apiVersion: string | null;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  citableItems: Record<string, ICitableData>;
}

/**
 * Zotero client implementing the Zotero Web API protocol in v3.
 */
export class ZoteroClient implements IReferenceProvider {
  id = 'zotero';
  name = 'Zotero';
  icon = zoteroIcon;

  private _serverURL: string | null = null;
  private _key: string | null = null;
  private _user: IUser | null = null;
  /**
   * Version number from API representing the library version,
   * as returned in `Last-Modified-Version` of response header
   * for multi-item requests.
   *
   * Note: responses for single-item requests will have item versions rather
   * than global library versions, please do not write those onto this variable.
   *
   * https://www.zotero.org/support/dev/web_api/v3/syncing#version_numbers
   */
  lastModifiedLibraryVersion: string | null = null;
  citableItems: Map<string, ICitableData>;
  isReady: Promise<any>;
  /**
   * If the API requests us to backoff we should wait given number of seconds before making a subsequent request.
   *
   * This promise will resolve once the backoff time passed.
   *
   * https://www.zotero.org/support/dev/web_api/v3/basics#rate_limiting
   */
  protected backoffPassed: Promise<void>;
  /**
   * The Zotero Web API version that we support
   *
   * https://www.zotero.org/support/dev/web_api/v3/basics#api_versioning
   */
  protected apiVersion = '3';

  /**
   * Bump this version if changing the structure/type of data stored
   * in the StateDB if the change would invalidate the existing data
   * (e.g. CSL version updates); this should make updates safe.
   *
   * Do not bump the version if extra information is stored; instead
   * prefer checking if it is present (conditional action).
   */
  private persistentCacheVersion = '0..';

  progress: Signal<ZoteroClient, IProgress>;

  constructor(
    protected settings: ISettings,
    protected trans: TranslationBundle,
    protected state: IStateDB | null
  ) {
    this.progress = new Signal(this);
    this.citableItems = new Map();
    settings.changed.connect(this.updateSettings, this);
    const initialPreparations: Promise<any>[] = [this.updateSettings(settings)];
    if (state) {
      initialPreparations.push(this.restoreStateFromCache(state));
    }
    this.isReady = Promise.all(initialPreparations);
    // no backoff to start with
    this.backoffPassed = new Promise(accept => {
      accept();
    });
  }

  private async restoreStateFromCache(state: IStateDB) {
    return new Promise<void>(accept => {
      state
        .fetch(PLUGIN_ID)
        .then(JSONResult => {
          if (!JSONResult) {
            console.log(
              'No previous state found for Zotero in the StateDB (it is normal on first run)'
            );
          } else {
            const result = JSONResult as IZoteroPersistentCacheState;
            if (result.apiVersion && result.apiVersion !== this.apiVersion) {
              // do not restore from cache if Zotero API version changed
              return;
            }
            if (
              result.persistentCacheVersion &&
              result.persistentCacheVersion !== this.persistentCacheVersion
            ) {
              // do not restore from cache if we changed the structure of cache
              return;
            }
            // restore from cache
            this.lastModifiedLibraryVersion = result.lastModifiedLibraryVersion;
            if (result.citableItems) {
              this.citableItems = new Map([
                ...Object.entries(result.citableItems)
              ]);
              console.log(
                `Restored ${this.citableItems.size} citable items from cache`
              );
            }
            this.updateCacheState();
          }
        })
        .catch(console.warn)
        // always resolve this one (if cache is not present or corrupted we can always fetch from the server)
        .finally(() => accept());
    });
  }

  private async fetch(
    endpoint: string,
    args: Record<string, string> = {},
    isMultiObjectRequest = false,
    forceUpdate = false
  ) {
    if (!this._key) {
      const userKey = await getAccessKeyDialog(this.trans);
      if (userKey.value) {
        this._key = userKey.value;
        this.settings.set('key', this._key).catch(console.warn);
      } else {
        return;
      }
    }

    const requestHeaders: IZoteroRequestHeaders = {
      'Zotero-API-Key': this._key,
      'Zotero-API-Version': this.apiVersion
    };

    if (
      !forceUpdate &&
      isMultiObjectRequest &&
      this.lastModifiedLibraryVersion
    ) {
      requestHeaders['If-Modified-Since-Version'] =
        this.lastModifiedLibraryVersion;
    }

    // wait until the backoff time passed;
    await this.backoffPassed;

    return fetch(
      this._serverURL + '/' + endpoint + '?' + new URLSearchParams(args),
      {
        method: 'GET',
        headers: requestHeaders as any
      }
    ).then(response => {
      this.processResponseHeaders(response.headers, isMultiObjectRequest);
      return response;
    });
  }

  protected processResponseHeaders(
    headers: Headers,
    fromMultiObjectRequest: boolean
  ): void {
    const zoteroHeaders = new ZoteroResponseHeaders(headers);
    this.handleBackoff(zoteroHeaders.backoffSeconds);
    if (fromMultiObjectRequest && zoteroHeaders.lastModifiedVersion) {
      // this is the library version only if we had multi-version request
      this.lastModifiedLibraryVersion = zoteroHeaders.lastModifiedVersion;
    }
    if (
      zoteroHeaders.apiVersion &&
      zoteroHeaders.apiVersion !== this.apiVersion
    ) {
      console.warn(
        `Zotero servers moved to a newer version API (${zoteroHeaders.apiVersion},` +
          ` but this client only supports ${this.apiVersion});` +
          ' please consider contributing a code to update this client to use the latest API'
      );
    }
  }

  protected handleBackoff(seconds: number | null): void {
    if (seconds) {
      this.backoffPassed = new Promise<void>(accept => {
        window.setTimeout(accept, seconds);
      });
    }
  }

  public async updatePublications(force = false): Promise<ICitableData[]> {
    const progressBase: Partial<IProgress> = {
      label: this.trans.__('Zotero sync.'),
      tooltip: this.trans.__(
        'Connector for Zotero is synchronizing references…'
      )
    };
    this.progress.emit({ ...progressBase, state: 'started' });
    const publications = await this.loadAll(
      'users/' + this._user?.id + '/items',
      // TODO: also fetch json to get the full tags and collections data and parse from <zapi:subcontent>?
      'csljson',
      'items',
      true,
      force,
      progress => {
        this.progress.emit({
          ...progressBase,
          state: 'ongoing',
          value: progress
        });
      }
    ).finally(() => {
      this.progress.emit({ ...progressBase, state: 'completed' });
    });
    if (publications) {
      console.log(`Fetched ${publications?.length} citable items from Zotero`);
      this.citableItems = new Map(
        (publications || []).map(item => {
          const data = item as ICitableData;
          return [data.id + '', data];
        })
      );
      this.updateCacheState().catch(console.warn);
    } else {
      console.log('No new items fetched from Zotero');
    }
    return [...this.citableItems.values()];
  }

  protected async updateCacheState(): Promise<any> {
    if (!this.state) {
      return;
    }
    const state: IZoteroPersistentCacheState = {
      persistentCacheVersion: this.persistentCacheVersion,
      apiVersion: this.apiVersion,
      lastModifiedLibraryVersion: this.lastModifiedLibraryVersion,
      citableItems: Object.fromEntries(this.citableItems)
    } as IZoteroPersistentCacheState;
    return this.state.save(PLUGIN_ID, state);
  }

  private async loadAll(
    endpoint: string,
    format = 'csljson',
    extract?: string,
    isMultiObjectRequest = true,
    forceUpdate = false,
    progress?: (progress: number) => void
  ) {
    let result = await this.fetch(
      endpoint,
      { format: format },
      isMultiObjectRequest,
      forceUpdate
    );
    if (result?.status === 304) {
      console.log(`Received 304 status (${result?.statusText}), skipping...`);
      return null;
    }
    const responses = [];
    // TODO
    const total =
      parseInt(result?.headers.get('Total-Results') as string, 10) || 10000;
    let i = 0;
    let done = false;
    while (!done && i <= total) {
      if (!result) {
        console.log('Could not retrieve all pages for ', endpoint);
        return;
      }
      responses.push(result);
      const links = parseLinks(result?.headers.get('Link') as string);
      const next = links.get('next')?.url;
      if (next) {
        const nextParams = Object.fromEntries(
          new URLSearchParams(new URL(next).search).entries()
        );
        if (nextParams.start) {
          i = parseInt(nextParams.start, 10);
          if (progress) {
            progress((100 * i) / total);
          }
        }
        result = await this.fetch(
          endpoint,
          {
            ...nextParams,
            format: format
          },
          isMultiObjectRequest,
          // do not add library version condition in follow up requests (we did not fetch entire library yet)
          true
        );
      } else {
        done = true;
        if (progress) {
          progress(100);
        }
      }
    }
    const results = [];
    for (const response of responses) {
      let responseItems = await response.json();
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
    if (!this._key) {
      console.warn('No access key to Zotero, cannot reload');
    }
    return this.fetch('keys/' + this._key).then(response => {
      if (!response) {
        console.error(response);
        return;
      }
      return response.json().then(result => {
        this._user = {
          name: result.username,
          id: result.userID
        };
        return this.updatePublications();
      });
    });
  }

  private updateSettings(settings: ISettings) {
    this._key = settings.composite.key as string;
    this._serverURL = settings.composite.server as string;
    return this.reloadKey();
  }
}

export const zoteroPlugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  requires: [ICitationManager, ISettingRegistry],
  optional: [ITranslator, IStateDB, IStatusBar],
  autoStart: true,
  activate: (
    app: JupyterFrontEnd,
    manager: ICitationManager,
    settingRegistry: ISettingRegistry,
    translator: ITranslator | null,
    state: IStateDB | null,
    statusBar: IStatusBar | null
  ) => {
    console.log('JupyterLab citation manager provider of Zotero is activated!');
    translator = translator || nullTranslator;
    const trans = translator.load('jupyterlab-citation-manager');

    settingRegistry
      .load(zoteroPlugin.id)
      .then(settings => {
        const client = new ZoteroClient(settings, trans, state);
        manager.registerReferenceProvider(client);

        console.log(
          'jupyterlab-citation-manager:zotero settings loaded:',
          settings.composite
        );

        if (statusBar) {
          statusBar.registerStatusItem(PLUGIN_ID, {
            item: new UpdateProgress(client.progress),
            rank: 900
          });
        }
      })
      .catch(reason => {
        console.error(
          'Failed to load settings for jupyterlab-citation-manager:zotero.',
          reason
        );
      });
  }
};
