import { CslData } from './_csl_data';
import { ReadonlyPartialJSONObject, Token } from '@lumino/coreutils';
import { DocumentWidget } from '@jupyterlab/docregistry';
import { LabIcon } from '@jupyterlab/ui-components';
import IIcon = LabIcon.IIcon;
import { ISignal } from '@lumino/signaling';

export type ICitableData = CslData[0];

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

/**
 * Unambiguous identifier of a citable item.
 *
 * The `id` property alone is not unambiguous as there is no guarantee
 * that there will never be  a conflict between identifiers from different
 * sources, hence the source needs to be included as well.
 *
 * Use `itemIdToPrimitive` to get the two values merged into unique primitive id.
 */
export interface IUnambiguousItemIdentifier extends ReadonlyPartialJSONObject {
  /**
   * The reference provider id (e.g. "zotero")
   */
  source: string;
  id: string;
}

/**
 * A mapping between citation identifiers and arrays of citable items.
 *
 * Note: a citation may refer to more than one item, in which case it
 * is referred to as a "citation cluster".
 */
export interface ICitationMap extends ReadonlyPartialJSONObject {
  [k: string]: IUnambiguousItemIdentifier[];
}

export namespace CiteProc {
  export type Bibliography = [
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
  export interface IEngine {
    updateItems(idList: string[]): void;

    updateUncitedItems(idList: string[]): void;

    processCitationCluster(
      citation: CitationToInsert,
      citationsPre: CitationLocation[],
      citationsPost: CitationLocation[]
    ): [IData, CitationUpdate[]];

    appendCitationCluster(
      citation: CitationToInsert
    ): [number, string, CitationID][];

    makeBibliography(): Bibliography;
  }

  /**
   * Citeproc Sys
   */
  export interface ISystem {
    retrieveLocale(lang: string): string;
    retrieveItem(id: string): ICitableData;
    /**
     * Generate string that will be appended to the bibliography entry to jump to the (first) citation in the document.
     */
    embedBibliographyEntry?(itemID: string): string;
    /**
     * Pos-process citation entry.
     */
    wrapCitationEntry?(
      entry: string,
      itemID: string,
      locatorText: string,
      suffixText: string
    ): string;
  }
}

export interface ICitableWrapper extends Partial<ICitableData> {
  date?: Date;
}

/**
 * Where is this citation located?
 */
export interface ICitationContext {
  /**
   * The element in the document where citation is located,
   * allowing to scroll to this citation.
   */
  host: HTMLElement;
  /**
   * An excerpt of the immediate surrounding of the citation.
   *
   * TODO: how to handle RTL languages?
   */
  excerpt: {
    before: string;
    citation: string;
    after: string;
  };
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
  citationsInDocument: ICitationContext[];
  /**
   * Associated publication if known; it may be partial
   * if user created their own <cite> entry, or if reference
   * provider is not available (or it was removed from
   * reference provider database).
   */
  publication: ICitableWrapper;
  /**
   * Was the citation data retrieved from the notebook metadata
   * rather than from a connected citation provider?
   *
   * If we have a fallback it might indicate the item could have been deleted
   * in the users collection, or comes from a collection of another co-author.
   */
  isFallback: boolean;
}

export interface ICitableItemRecords extends ReadonlyPartialJSONObject {
  // ignoring custom CSL entries here as typescript cannot
  // process their types which is effectively `any`
  [id: string]: Omit<ICitableData, 'custom'>;
}

export interface ICitableItemRecordsBySource extends ReadonlyPartialJSONObject {
  [source: string]: ICitableItemRecords;
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
   * This array gets serialized for storage in cell attributes.
   */
  items: IUnambiguousItemIdentifier[];
  data?: DOMStringMap;
  text: string;
  context: ICitationContext;
}

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

export type CitationInsertData = Optional<ICitation, 'context'>;

export interface IProgress {
  state: 'started' | 'ongoing' | 'completed';
  label?: string;
  tooltip?: string;
  value?: number;
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
  citableItems: Map<string | number, ICitableData>;

  /**
   * @param force - whether to update even if recently updated
   */
  updatePublications(force?: boolean): Promise<ICitableData[]>;
  isReady: Promise<any>;
  progress?: ISignal<any, IProgress>;
  // getCollections?(): Promise<Map<string, ICitableData[]>>;
}

export type CitationQuerySubset = 'all' | 'before-cursor' | 'after-cursor';

export interface IDocumentAdapter<T extends DocumentWidget> {
  /**
   * Insert citation at current position.
   */
  citations: ICitation[];
  document: T;

  /**
   * Perform migration from legacy format.
   */
  migrateFormat(): Promise<boolean>;

  /**
   * Use getter to read it from metadata, and setter to set it to metadata.
   */
  getCitationStyle(): string | undefined;
  setCitationStyle(value: string): void;

  insertCitation(citation: CitationInsertData): void;
  updateCitation(citation: CitationInsertData): void;

  insertBibliography(bibliography: string): void;
  updateBibliography(bibliography: string): void;

  findCitations(subset: CitationQuerySubset): ICitation[];

  /**
   * Document adapter is not a provider of citable items,
   * but it can store the items for citations contained
   * within, which is a useful fallback for collaborative
   * editing (as the citation will not get lost when edited
   * by a co-author).
   */
  getCitableItemsFallbackData(): ICitableItemRecordsBySource | null;
  setCitableItemsFallbackData(data: ICitableItemRecordsBySource): void;
}

export interface IStylePreview {
  bibliography: string;
  citations: ICitation[];
  style: IStyle;
}

export interface IPreviewNotAvailable {
  reason: string;
}

export interface IStylePreviewProvider {
  previewStyle(style: IStyle, maxCitations: number): Promise<IStylePreview>;
}

export interface ICitationManager
  extends CiteProc.ISystem,
    IStylePreviewProvider {
  registerReferenceProvider(provider: IReferenceProvider): void;
  addCitation(documentWidget: DocumentWidget): void;
  addBibliography(documentWidget: DocumentWidget): void;
  changeStyle(documentWidget: DocumentWidget): void;
  updateReferences(): Promise<any>;
}

export const ICitationManager = new Token<ICitationManager>(
  '@krassowski/citation-manager:ICitationManager'
);

export enum CommandIDs {
  open = 'cm:open-reference',
  insertCitation = 'cm:insert-citation',
  insertBibliography = 'cm:insert-bibliography',
  changeBibliographyStyle = 'cm:change-bibliography-style',
  updateReferences = 'cm:update-references'
}

interface IStyleInfo {
  id: string;
  title: string;
  shortTitle?: string;
  rights?: string;
  license?: string;
  // may be empty
  fields: string[];
  // may be empty
  authors: string[];
  // may be empty
  contributors: string[];
}

/**
 * CSL data corresponding to a .csl file.
 */
export interface IStyle {
  /**
   * Identifier of the style on server
   */
  id: string;
  /**
   * Information extracted from the XML inside .csl file
   */
  info: IStyleInfo;
}

export interface IStyleManagerResponse {
  version: string;
  styles: IStyle[];
}
