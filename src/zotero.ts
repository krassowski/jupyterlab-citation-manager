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
  publications: Map<string, ICitableData>;
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

  constructor(
    protected settings: ISettings,
    protected trans: TranslationBundle
  ) {
    settings.changed.connect(this.updateSettings, this);
    this.isReady = this.updateSettings(settings);
    // no backoff to start with
    this.backoffPassed = new Promise(accept => {
      accept();
    });
    this.publications = new Map();
  }

  private async fetch(
    endpoint: string,
    args: Record<string, string> = {},
    isMultiObjectRequest = false,
    forceUpdate = false
  ) {
    if (!this._key) {
      const userKey = await InputDialog.getPassword({
        title: this.trans.__('Configure Zotero API Access _key'),
        label: this.trans.__(
          `In order to access your Zotero collection you need to configure Zotero API key.
          You can generate the API key after logging to www.zotero.org.
          The key looks like this: P9NiFoyLeZu2bZNvvuQPDWsd.`
        )
      });
      if (userKey.value) {
        this._key = userKey.value;
        this.settings.set('_key', this._key).catch(console.warn);
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

  // TODO add this as a button in the sidebar
  public async updatePublications(): Promise<ICitableData[]> {
    // TODO implement caching 503 and rate-limiting/debouncing
    const publications = await this.loadAll(
      'users/' + this._user?.id + '/items',
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
    return this.fetch('keys/' + this._key).then(response => {
      if (!response) {
        console.error(response);
        return;
      }
      return response.json().then(result => {
        console.log(result);
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
