import { ICitableData, IReferenceProvider } from './types';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import ISettings = ISettingRegistry.ISettings;

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
  private serverURL: string | null = null;
  private key: string | null = null;
  private user: IUser | null = null;
  publications: Map<string, ICitableData>;

  constructor(app: JupyterFrontEnd, settings: ISettings) {
    settings.changed.connect(this.updateSettings, this);
    this.updateSettings(settings);
    this.publications = new Map();
  }

  private async fetch(endpoint: string, args: Record<string, string> = {}) {
    if (!this.key || !this.serverURL) {
      window.alert('Missing key please configure your API access key');
      return;
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
    this.fetch('keys/' + this.key).then(response => {
      if (!response) {
        console.error(response);
        return;
      }
      response.json().then(result => {
        console.log(result);
        this.user = {
          name: result.username,
          id: result.userID
        };
        this.updatePublications().catch(console.warn);
      });
    });
  }

  private updateSettings(settings: ISettings) {
    this.key = settings.composite.key as string;
    this.serverURL = settings.composite.server as string;
    this.reloadKey();
  }
}
