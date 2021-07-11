import { IPublication, IReferenceProvider } from './types';
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
  name = 'Zotero';
  private serverURL: string | null = null;
  private key: string | null = null;
  private user: IUser | null = null;
  publications: IPublication[];

  constructor(app: JupyterFrontEnd, settings: ISettings) {
    settings.changed.connect(this.updateSettings, this);
    this.updateSettings(settings);
    this.publications = [];
  }

  private async fetch(endpoint: string, args: any = {}) {
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
  public async updatePublications(): Promise<IPublication[]> {
    // TODO implement caching 503 and rate-limiting/debouncing
    const publications = await this.loadAll(
      'users/' + this.user?.id + '/items/top'
    );
    console.log(publications);
    this.publications = (publications || []).map(item => {
      console.log(item);
      const data = item['data'];
      const publication: IPublication = {
        creators: data['creators'],
        id: data['key'],
        title: data['title'],
        doi: data['DOI'],
        url: data['url']
      };
      return publication;
    });
    return this.publications;
  }

  private async loadAll(
    endpoint: string,
    progress?: (progress: number) => void
  ) {
    let result = await this.fetch(endpoint);
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
        result = await this.fetch(endpoint, new URLSearchParams(next));
        // TODO: remove short circuit in future it is just here to iterate fast:
        done = true;
      } else {
        done = true;
      }
    }
    const results = [];
    for (const response of responses) {
      const responseItems = await response.json();
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
