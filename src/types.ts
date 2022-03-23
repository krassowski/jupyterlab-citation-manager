import { CslData } from './_csl_data';
import { ReadonlyPartialJSONObject, Token } from '@lumino/coreutils';
import { IDocumentWidget } from '@jupyterlab/docregistry';
import { LabIcon } from '@jupyterlab/ui-components';
import IIcon = LabIcon.IIcon;
import { ISignal } from '@lumino/signaling';
import OutputMode = CiteProc.OutputMode;

export type ICitableData = CslData[0];

interface IData {
  bibchange: boolean;
}
type CitationID = string;
export type CitationLocation = [CitationID, number];
export type CitationUpdate = [number, string];

export type CitProcCitableData = ICitableData & {
  // required by to make LaTeX citations (and citation IDs) work, see
  // https://github.com/Juris-M/citeproc-js/issues/122#issuecomment-981076349
  system_id?: string;
};

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

export interface ICitationFormattingOptions {
  defaultFormat: OutputMode;
  /**
   * Whether citations should link to bibliography (if output mode supports it)
   */
  linkToBibliography: boolean;
  /**
   * Whether links and DOIs in bibliography should be clickable (if the output mode supports it)
   */
  hyperlinksInBibliography: boolean;
}

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
   * https://github.com/Juris-M/citeproc-js/blob/master/src/formats.js
   */
  export type OutputMode =
    | 'html'
    | 'text'
    | 'rtf'
    | 'asciidoc'
    | 'fo'
    | 'latex';

  /**
   * https://citeproc-js.readthedocs.io/en/latest/running.html
   */
  export interface IEngine {
    opt: any;

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

    setOutputFormat(mode: OutputMode): void;
  }

  /**
   * Citeproc Sys
   */
  export interface ISystem {
    retrieveLocale(lang: string): string;
    retrieveItem(id: string): CitProcCitableData;
    /**
     * Generate string that will be appended to the bibliography entry to jump to the (first) citation in the document.
     *
     * Requires `system_id` in `CitProcCitableData`.
     */
    embedBibliographyEntry?(itemID: string): string;
    /**
     * Pos-process citation entry.
     *
     * Requires `development_extensions.apply_citation_wrapper` to be enabled and `system_id` in `CitProcCitableData`.
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

export interface IDetectionResult {
  citationsDetected: number;
  bibliographiesDetected: number;
}

export interface IMigrationResult {
  aborted: boolean;
  failures: string[];
  message?: string;
  migratedCitationsCount: number;
  bibliographyMigrated: boolean;
}

export interface IAlternativeFormat<T extends IDocumentWidget> {
  /**
   * Format name that will be shown to the user.
   */
  name: string;

  /***
   * Migrate all citations and bibliographies found in `document`,
   * by reformatting to the current format as returned by `adapter`
   * and storing the relevant metadata in appropriate locations.
   */
  migrateFrom(
    document: T,
    adapter: IDocumentAdapter<T>,
    itemResolver: ICitableItemResolver
  ): Promise<IMigrationResult>;

  /**
   * Detection should use heuristics if possible to return results quickly.
   */
  detect(document: T, adapter: IDocumentAdapter<T>): IDetectionResult;
  // TODO: allow saving notebooks using alternative formats
  // migrateTo?(): Promise<IMigrationResult>;
}

export interface IDocumentAdapter<T extends IDocumentWidget> {
  /**
   * Insert citation at current position.
   */
  citations: ICitation[];
  document: T;

  /**
   * Use getter to read it from metadata, and setter to set it to metadata.
   */
  getCitationStyle(): string | undefined;
  setCitationStyle(value: string): void;

  outputFormat: OutputMode;

  insertCitation(citation: CitationInsertData): void;
  updateCitation(citation: CitationInsertData): void;

  insertBibliography(bibliography: string): void;
  updateBibliography(bibliography: string): void;

  findCitations(subset: CitationQuerySubset): ICitation[];

  formatCitation(citation: CitationInsertData): string;
  formatBibliography(bibliography: string): string;

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

export interface ICitableItemResolver {
  matchItem(
    data: Partial<ICitableData>,
    context: string
  ): Promise<IUnambiguousItemIdentifier | null>;
}

export interface ICitationManager
  extends CiteProc.ISystem,
    IStylePreviewProvider,
    ICitableItemResolver {
  registerReferenceProvider(provider: IReferenceProvider): void;
  addCitation(documentWidget: IDocumentWidget): void;
  addBibliography(documentWidget: IDocumentWidget): void;
  changeStyle(documentWidget: IDocumentWidget): void;
  updateReferences(): Promise<any>;

  registerFormat(format: IAlternativeFormat<any>): void;
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
  /**
   * URL to the license
   */
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
