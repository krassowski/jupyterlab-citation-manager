import { ICitableData, ICitableWrapper, ICitation } from './types';
import marked from 'marked';
import { DateContentModel } from './_csl_citation';

interface IResponse {
  response: XMLHttpRequest;
  progress: ProgressEvent;
}

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

export class DefaultMap<K extends string | number | boolean, V extends any> {
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

export function extractCitations(markdown: string): ICitation[] {
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
