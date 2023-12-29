import {
  ICitableData,
  ICitableWrapper,
  ICitation,
  ICitationContext,
  ICitationMap
} from './types';
import { marked } from 'marked';
import { DateContentModel } from './_csl_citation';
import { NotebookPanel } from '@jupyterlab/notebook';

export function InfinityIfMissing(value?: number): number {
  // eslint-disable-next-line eqeqeq
  if (value == null) {
    return Infinity;
  }
  return value;
}

interface IResponse {
  response: XMLHttpRequest;
  progress: ProgressEvent;
}

export function generateRandomID(existingIDs: Set<string>): string {
  let isUnique = false;
  let id = '';
  while (!isUnique) {
    id = Math.random().toString(36).slice(-5);
    isUnique = !existingIDs.has(id);
  }
  return id;
}

// TODO: ditch in favour of fetch API?
export async function simpleRequest(
  url: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET'
): Promise<IResponse> {
  const xhr = new XMLHttpRequest();
  return new Promise((accept, reject) => {
    xhr.open(method, url, true);
    xhr.onload = progress => accept({ response: xhr, progress: progress });
    xhr.onerror = reject;
    xhr.send(null);
  });
}

export class DefaultMap<K extends string | number | boolean, V> {
  private map: Map<K, V>;

  constructor(protected factory: (key: K) => V) {
    this.map = new Map();
  }

  get(key: K): V {
    return this.map.has(key) ? (this.map.get(key) as V) : this.factory(key);
  }

  set(key: K, value: V): void {
    this.map.set(key, value);
  }

  entries() {
    return this.map.entries();
  }

  keys() {
    return this.map.keys();
  }

  values() {
    return this.map.values();
  }
}

export function markdownCells(document: NotebookPanel) {
  return document.content.widgets.filter(
    cell => cell.model.type === 'markdown'
  );
}

function extractText(node?: ChildNode | null): string {
  return node ? node?.textContent || '' : '';
}

export function extractCitations(
  markdown: string,
  context: Partial<ICitationContext>,
  citationToItems: ICitationMap
): ICitation[] {
  const html: string = marked.parse(markdown);
  const div = document.createElement('div');
  div.innerHTML = html;
  return [...div.querySelectorAll('cite').values()].map(element => {
    const excerpt = {
      before: extractText(element.previousSibling),
      citation: element.innerHTML,
      after: extractText(element.nextSibling)
    };

    let itemsIdentifiers =
      citationToItems[
        // fallback for cite2c
        element.id ? element.id : (element.dataset.cite as string)
      ];

    // TODO delete this? standardize this?
    if (!itemsIdentifiers) {
      itemsIdentifiers = element.dataset.items
        ? element.dataset.items.startsWith('[')
          ? JSON.parse(element.dataset.items)
          : [
              {
                source: element.dataset.source as string,
                id: element.dataset.items
              }
            ]
        : [];
    }

    return {
      citationId: element.id,
      items: itemsIdentifiers,
      text: element.innerHTML,
      data: element.dataset,
      context: {
        ...context,
        excerpt: excerpt
      }
    } as ICitation;
  });
}

function parseEDTF(date: string): Date {
  return new Date(date);
}

function getDate(date: DateContentModel): Date {
  if (typeof date === 'string') {
    // TODO: perform proper EDTF parsing
    return parseEDTF(date);
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
      // best guess is middle of the year;
      // beware using single-argument constructor - it treats the number
      // as a timestamp rather than as a year.
      return new Date(parseInt(startDate[0] + '', 10), 6);
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

export function harmonizeData(publication: ICitableData): ICitableWrapper {
  let date: Date | undefined = undefined;
  if (publication.issued) {
    date = getDate(publication.issued);
  }
  return {
    ...publication,
    date: date
  };
}
