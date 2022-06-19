import {
  CitationInsertData,
  ICitation,
  ICitationFormattingOptions,
  ICitationContext,
  ICitationMap
} from './types';
import marked from 'marked';
import { itemIdToPrimitive } from './index';


interface ICitationUpdate {
  newText: string | null;
  matchesCount: number;
}

interface IOutputFormatter {
  formatCitation(citation: CitationInsertData): string;
  updateCitation(oldText: string, citation: ICitation): ICitationUpdate;
  extractCitations(text: string, context: Partial<ICitationContext>, citationToItems: ICitationMap): ICitation[];
  formatBibliography(bibliography: string): string;
  updateBibliography(oldText: string, bibliography: string): string | null;
}

abstract class BaseFormatter implements IOutputFormatter {
  constructor(protected options: ICitationFormattingOptions) {
    // no-op
  }

  abstract formatCitation(citation: CitationInsertData): string;
  abstract formatBibliography(bibliography: string): string;
  abstract extractCitations(
    text: string,
    context: Partial<ICitationContext>,
    citationToItems: ICitationMap
  ): ICitation[]

  abstract citationPattern(citation: ICitation): RegExp;
  abstract readonly bibliographyPattern: RegExp;
  abstract readonly bibliographyStartPattern: RegExp;

  updateCitation(oldText: string, citation: ICitation): ICitationUpdate {
    let newText: string | null = null;
    const pattern = this.citationPattern(citation);
    const matchesCount = oldText.match(pattern)?.length || 0;
    if (matchesCount != 0) {
      const matchIndex = oldText.search(pattern);
      if (matchIndex === -1) {
        console.warn('Internal logic inconsistency - matches count does not agree.')
      }
      const newCitation = this.formatCitation(citation);
      const old = oldText.slice(matchIndex, matchIndex + newCitation.length);
      console.log(old, newCitation);
      if (newCitation !== old) {
        newText = oldText.replace(
          pattern,
          newCitation.trim()
        );
      }
    }
    return { newText, matchesCount }
  }

  updateBibliography(oldText: string, bibliography: string): string | null {
    if (oldText.search(this.bibliographyStartPattern) === -1) {
      return null;
    }
    const matchIndex = oldText.search(this.bibliographyPattern);
    if (matchIndex === -1) {
      console.warn(
        'Failed to update bibliography',
        bibliography,
        'in',
        oldText
      );
    }
    const newBibliography = this.formatBibliography(bibliography);
    const old = oldText.slice(matchIndex, matchIndex + newBibliography.length);
    if (old.trim() !== newBibliography.trim()) {
      return oldText.replace(
        this.bibliographyPattern,
        newBibliography.trim()
      );
    } else {
      return null;
    }
  }
}


export class TexFormatter extends BaseFormatter {
  bibliographyPattern =
  /(\\begin{thebibliography}[\s\S]*?\\end{thebibliography})/;
  bibliographyStartPattern = /\\begin{thebibliography}/; 

  formatCitation(citation: CitationInsertData): string {
    // this does not work well with MathJax - we need to figure out something else!
    // but it might still be useful (without $) for text editor adapter
    const citationIDs = citation.items.map(itemIdToPrimitive).join(',');
    return `\\cite{${citationIDs}}`;
  }

  citationPattern(citation: ICitation): RegExp {
    const id = citation.citationId.replace(/(\||\/|\\)/g, '\\$1');
    return new RegExp(`(\\cite{${id}})`, 'g');
  }

  formatBibliography(bibliography: string): string {
    return bibliography;
  }

  extractCitations(
    text: string,
    context: Partial<ICitationContext>,
    citationToItems: ICitationMap
  ): ICitation[] {
    return ([...text.matchAll(/(?<before>.*)(?<citation>\\cite{(?<id>.*))}(?<after>.*)/g)] || []).map(match => {
      const groups = match.groups!;
      const excerpt = {
        before: groups['before'],
        citation: groups['citation'],
        after: groups['after']
      };

      let itemsIdentifiers = groups['id'].split(',').map(primitive => {
        const parts = primitive.split('|');
        return {
          source: parts[0],
          id: parts[1]
        }
      });

      return {
        citationId: groups['id'],
        items: itemsIdentifiers,
        text: groups['id'],
        data: undefined,
        context: {
          ...context,
          excerpt: excerpt
        }
      } as ICitation;
    });
  }
}


function extractText(node?: ChildNode | null): string {
  return node ? node?.textContent || '' : '';
}


export class HTMLFormatter extends BaseFormatter {
  bibliographyPattern =
  /(<!-- BIBLIOGRAPHY START -->[\s\S]*?<!-- BIBLIOGRAPHY END -->)/;
  bibliographyStartPattern = /<!-- BIBLIOGRAPHY START -->/;

  formatCitation(citation: CitationInsertData): string {
    // note: not using `wrapCitationEntry` as that was causing more problems
    // (itemID undefined).
    let text = citation.text;
    if (this.options.linkToBibliography) {
      // link to the first mentioned element
      const first = citation.items[0];
      const firstID = itemIdToPrimitive(first);
      // encode the link as pipe symbol was causing issues with markdown tables,
      // see https://github.com/krassowski/jupyterlab-citation-manager/issues/50
      const encodedfirstID = encodeURIComponent(firstID);
      text = `<a href="#${encodedfirstID}">${text}</a>`;
    }
    return `<cite id="${citation.citationId}">${text}</cite>`;
  }

  citationPattern(citation: ICitation): RegExp {
    return new RegExp(`<cite id=["']${citation.citationId}["'][^>]*?>([\\s\\S]*?)<\\/cite>`, 'g');
  }

  formatBibliography(bibliography: string): string {
    return `<!-- BIBLIOGRAPHY START -->${bibliography}<!-- BIBLIOGRAPHY END -->`;
  }

  extractCitations(
    text: string,
    context: Partial<ICitationContext>,
    citationToItems: ICitationMap
  ): ICitation[] {
    const html: string = marked(text);
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
}

/**
 * HTML formatter for citations (to be placed in markdown cells),
 * Tex formatter for bibliography (to be placed in raw cell for LaTeX export).
 */
export class HybridFormatter implements IOutputFormatter {
  htmlFormatter: HTMLFormatter;
  texFormatter: TexFormatter;

  constructor(protected options: ICitationFormattingOptions) {
    this.htmlFormatter = new HTMLFormatter(options);
    this.texFormatter = new TexFormatter(options);
  }

  formatCitation(citation: CitationInsertData): string {
    return this.htmlFormatter.formatCitation(citation);
  }

  updateCitation(oldText: string, citation: ICitation): ICitationUpdate {
    return this.htmlFormatter.updateCitation(oldText, citation);
  }

  extractCitations(
    text: string,
    context: Partial<ICitationContext>,
    citationToItems: ICitationMap
  ): ICitation[] {
    return this.htmlFormatter.extractCitations(text, context, citationToItems);
  }

  formatBibliography(bibliography: string): string {
    return this.texFormatter.formatBibliography(bibliography);
  }

  updateBibliography(oldText: string, bibliography: string): string | null {
    return this.texFormatter.updateBibliography(oldText, bibliography);
  }
}
