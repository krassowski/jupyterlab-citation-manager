export interface ICreator {
  creatorType: string;
  firstName: string;
  lastName: string;
}

export interface ICollection {
  id: string;
  name: string;
}

/**
 * Publication contains full record of publication.
 */
export interface IPublication {
  id: string;
  creators: ICreator[];
  title: string;
  doi?: string;
  url?: string;
  abstract?: string;
  collection?: ICollection;
  year?: string;
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
  publication: Partial<IPublication>;
}

/**
 * Citation represents the data embedded <cite></cite>
 */
export interface ICitation extends Partial<IPublication> {
  id: string;
  /**
   * The reference provider id
   */
  source: string;
  text: string;
}



/**
 * A provider of references such as Zotero, EndNote, Mendeley, etc.
 */
export interface IReferenceProvider {
  /**
   * The name as shown in the user interface.
   */
  name: string;
  publications: IPublication[];
  updatePublications(): Promise<IPublication[]>;
  getCollections?(): Promise<ICollection[]>;
}
