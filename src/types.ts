import { CslData } from './_csl_data';
import { Token } from '@lumino/coreutils';
import { DocumentWidget } from '@jupyterlab/docregistry';
import { LabIcon } from '@jupyterlab/ui-components';
import IIcon = LabIcon.IIcon;

export type ICitableData = CslData[0];

export interface ICollection {
  id: string;
  name: string;
}

/**
 * Citeproc Sys
 */
export interface ICitationSystem {
  retrieveLocale: (lang: string) => string;
  retrieveItem: (id: string) => ICitableData;
  /**
   * Generate string that will be appended to the bibliography entry to jump to the (first) citation in the document.
   */
  embedBibliographyEntry?: (itemID: string) => string;
  /**
   * Pos-process citation entry.
   */
  wrapCitationEntry?: (
    entry: string,
    itemID: string,
    locatorText: string,
    suffixText: string
  ) => string;
}

interface IData {
  bibchange: boolean;
}
type CitationID = string;
export type CitationLocation = [CitationID, number];
export type CitationUpdate = [number, string];
export interface ICitationItemData {
  id: string;
  item?: ICitableData;
}

export type CitationToInsert = {
  properties: {
    noteIndex: number;
  };
  citationID: CitationID;
  citationItems: ICitationItemData[];
};

export type CiteProcBibliography = [
  {
    maxoffset: number;
    entryspacing: number;
    linespacing: number;
    hangingindent: boolean;
    'second-field-align': boolean;
    bibstart: string;
    bibend: string;
    bibliography_errors: any[];
    entry_ids: string[];
  },
  string[]
];

/**
 * https://citeproc-js.readthedocs.io/en/latest/running.html
 */
export interface ICiteProcEngine {
  updateItems(idList: string[]): void;
  updateUncitedItems(idList: string[]): void;
  processCitationCluster(
    citation: CitationToInsert,
    citationsPre: CitationLocation[],
    citationsPost: CitationLocation[]
  ): [IData, CitationUpdate[]];
  appendCitationCluster(citation: CitationToInsert): [IData, CitationUpdate];
  makeBibliography(): CiteProcBibliography;
}

export interface ICitableWrapper extends Partial<ICitableData> {
  date?: Date;
}

/**
 * A known publication or citation item that can be chosen by the user
 * to create a new citation
 */
export interface ICitationOption {
  source: string;
  /**
   * How many citations of this piece are there already in this document?
   *
   * Useful to prioritize frequently used options at the top.
   */
  citationsInDocument: number;
  /**
   * Associated publication if known; it may be partial
   * if user created their own <cite> entry, or if reference
   * provider is not available (or it was removed from
   * reference provider database).
   */
  publication: ICitableWrapper;
}

/**
 * Citation represents the data embedded <cite></cite>
 */
export interface ICitation extends Partial<ICitableData> {
  /**
   * Randomly generated unique ID of the citation.
   * Also used as HTML ID to locate the <cite> element.
   */
  citationId: string;
  /**
   * The IDs of the citable objects (cited works); a single citation
   * may cite several works (e.g. of the same person).
   *
   * The array gets serialized for storage in HTML attributes.
   */
  items: string[];
  /**
   * The reference provider id (e.g. "zotero")
   */
  source: string;
  text: string;
}

/**
 * A provider of references such as Zotero, EndNote, Mendeley, etc.
 */
export interface IReferenceProvider {
  /**
   * Identifier; cannot contain pipe (`|`) character.
   */
  id: string;
  /**
   * The name as shown in the user interface.
   */
  name: string;
  icon: IIcon;
  publications: Map<string | number, ICitableData>;
  updatePublications(): Promise<ICitableData[]>;
  isReady: Promise<any>;
  // getCollections?(): Promise<Map<string, ICitableData[]>>;
}

export type CitationQuerySubset = 'all' | 'before-cursor' | 'after-cursor';

export interface IDocumentAdapter<T extends DocumentWidget> {
  /**
   * Insert citation at current position.
   */
  citations: ICitation[];
  document: T;

  insertCitation(citation: ICitation): void;
  updateCitation(citation: ICitation): void;

  insertBibliography(bibliography: string): void;
  updateBibliography(bibliography: string): void;

  findCitations(subset: CitationQuerySubset): ICitation[];
}

export interface ICitationManager extends ICitationSystem {
  registerReferenceProvider(provider: IReferenceProvider): void;
}

export const ICitationManager = new Token<ICitationManager>(
  '@krassowski/citation-manager:ICitationManager'
);
