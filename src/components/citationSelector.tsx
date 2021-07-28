import IMatchResult = StringExt.IMatchResult;
import { StringExt } from '@lumino/algorithm';
import * as React from 'react';
import { ICitableData, ICitationContext, ICitationOption } from '../types';
import { anonymousMark, IOption, ModalSelector } from './selector';
import { TranslationBundle } from '@jupyterlab/translation';
import { NameVariable } from '../_csl_data';
import { InfinityIfMissing } from '../utils';
import { UUID } from '@lumino/coreutils';

export const CITATION_SELECTOR_CLASS = 'cm-CitationSelector';

interface IYearMatch {
  absoluteDifference: number;
}

export interface ICitationOptionMatch {
  title: IMatchResult | null;
  year: IYearMatch | null;
  creators: (IMatchResult | null)[] | null;
}

export function CitationOptionTitle(props: {
  title: string | undefined;
  match: IMatchResult | null;
}): JSX.Element {
  return (
    <span className={'cm-title'}>
      {props.title
        ? props.match
          ? StringExt.highlight(props.title, props.match.indices, anonymousMark)
          : props.title
        : ''}
    </span>
  );
}

function formatAuthor(author: NameVariable): string {
  return (author.given ? author.given[0] + '. ' : '') + author.family;
}

export function CitationOptionAuthors(props: {
  authors: NameVariable[] | undefined;
  matches: (IMatchResult | null)[] | null | undefined;
}): JSX.Element | null {
  const matches = props.matches;
  if (!matches || !props.authors) {
    return null;
  }
  return (
    <ul className={'cm-authors'}>
      {props.authors?.map((author, i) => {
        const match = matches[i];
        const authorLabel = formatAuthor(author);
        return (
          <span className={'cm-author'} key={UUID.uuid4()}>
            {match
              ? StringExt.highlight(authorLabel, match.indices, anonymousMark)
              : authorLabel}
          </span>
        );
      })}
    </ul>
  );
}

export function CitationSource(props: { source: string }): JSX.Element {
  return (
    <span className={`cm-source cm-source-${props.source}`}>
      {props.source[0]}
    </span>
  );
}

export function citationCountsLabel(
  citations: ICitationContext[],
  trans: TranslationBundle
): string {
  return citations.length !== 0
    ? trans._n('%1 occurrence', '%1 occurrences', citations.length)
    : '';
}

export function translateTypeLabels(
  trans: TranslationBundle
): Record<ICitableData['type'], string> {
  return {
    article: trans.__('Article'),
    'article-journal': trans.__('Journal Article'),
    'article-magazine': trans.__('Magazine Article'),
    'article-newspaper': trans.__('Newspaper Article'),
    bill: trans.__('Bill'),
    book: trans.__('Book'),
    broadcast: trans.__('Broadcast'),
    chapter: trans.__('Chapter'),
    classic: trans.__('Classic'),
    collection: trans.__('Collection'),
    dataset: trans.__('Dataset'),
    document: trans.__('Document'),
    entry: trans.__('Entry'),
    'entry-dictionary': trans.__('Dictionary Entry'),
    'entry-encyclopedia': trans.__('Encyclopedia Entry'),
    event: trans.__('Event'),
    figure: trans.__('Figure'),
    graphic: trans.__('Graphic'),
    hearing: trans.__('Hearing'),
    interview: trans.__('Interview'),
    legal_case: trans.__('Legal Case'),
    legislation: trans.__('Legislation'),
    manuscript: trans.__('Manuscript'),
    map: trans.__('Map'),
    motion_picture: trans.__('Motion Picture'),
    musical_score: trans.__('Musical Score'),
    pamphlet: trans.__('Pamphlet'),
    'paper-conference': trans.__('Conference Paper'),
    patent: trans.__('Patent'),
    performance: trans.__('Performance'),
    periodical: trans.__('Periodical'),
    personal_communication: trans.__('Personal Communication'),
    post: trans.__('Post'),
    'post-weblog': trans.__('Weblog Post'),
    regulation: trans.__('Regulation'),
    report: trans.__('Report'),
    review: trans.__('Review'),
    'review-book': trans.__('Book review'),
    software: trans.__('Software'),
    song: trans.__('Song'),
    speech: trans.__('Speech'),
    standard: trans.__('Standard'),
    thesis: trans.__('Thesis'),
    treaty: trans.__('Treaty'),
    webpage: trans.__('Webpage')
  };
}

export const citationOptionModel = {
  filter(option: IOption<ICitationOption, ICitationOptionMatch>): boolean {
    return (
      option.match !== null &&
      [option.match.title, option.match.year, option.match.creators].filter(
        v => v !== null
      ).length !== 0
    );
  },
  sort(
    a: IOption<ICitationOption, ICitationOptionMatch>,
    b: IOption<ICitationOption, ICitationOptionMatch>
  ): number {
    if (a.match === null || b.match === null) {
      return 0;
    }
    const titleResult =
      InfinityIfMissing(a.match.title?.score) -
      InfinityIfMissing(b.match.title?.score);
    const creatorsResult =
      (a.match.creators
        ? Math.min(...a.match.creators.map(c => InfinityIfMissing(c?.score)))
        : Infinity) -
      (b.match.creators
        ? Math.min(...b.match.creators.map(c => InfinityIfMissing(c?.score)))
        : Infinity);
    const yearResult =
      InfinityIfMissing(a.match.year?.absoluteDifference) -
      InfinityIfMissing(b.match.year?.absoluteDifference);
    const citationsResult =
      InfinityIfMissing(b.data.citationsInDocument.length) -
      InfinityIfMissing(a.data.citationsInDocument.length);
    return creatorsResult || titleResult || yearResult || citationsResult;
  },
  match(option: ICitationOption, query: string): ICitationOptionMatch {
    query = query.toLowerCase();
    const publication = option.publication;
    const titleMatch = StringExt.matchSumOfSquares(
      (publication.title || '').toLowerCase(),
      query
    );
    const regex = /\b((?:19|20)\d{2})\b/g;
    const queryYear = query.match(regex);
    let yearMatch: IYearMatch | null = null;
    if (queryYear) {
      yearMatch = {
        absoluteDifference: Math.abs(
          (publication.date?.getFullYear
            ? publication.date?.getFullYear()
            : 0) - parseInt(queryYear[0], 10)
        )
      };
    }
    return {
      title: titleMatch,
      year: yearMatch,
      creators: publication.author
        ? publication.author.map(creator => {
            return StringExt.matchSumOfSquares(
              formatAuthor(creator).toLowerCase(),
              query
            );
          })
        : null
    };
  },
  initialOptions(options: ICitationOption[]): ICitationOption[] {
    const optionsCitedInDocument = options.filter(
      option => option.citationsInDocument.length > 0
    );
    if (!optionsCitedInDocument.length) {
      return options;
    }
    return optionsCitedInDocument.sort(
      (a, b) => b.citationsInDocument.length - a.citationsInDocument.length
    );
  }
};

export function citationOptionID(option: ICitationOption): string {
  return (
    '' +
    (option.publication.id ||
      option.publication.DOI ||
      option.publication.title)
  );
}

export class CitationSelector extends ModalSelector<
  ICitationOption,
  ICitationOptionMatch
> {
  typeNames: Record<ICitableData['type'], string>;

  constructor(protected trans: TranslationBundle) {
    super({ model: citationOptionModel });
    this.placeholder = trans.__('Start typing title, author, or year');
    this.typeNames = translateTypeLabels(trans);
    this.addClass(CITATION_SELECTOR_CLASS);
  }

  createID(option: ICitationOption): string {
    return 'c-' + (citationOptionID(option) || super.createID(option));
  }

  protected dynamicClassForList(
    options: IOption<ICitationOption, ICitationOptionMatch>[]
  ): string {
    const sources = new Set([...options.map(option => option.data.source)]);
    return sources.size > 1 ? 'cm-multiple-sources' : 'cm-single-source';
  }

  renderOption(props: {
    option: IOption<ICitationOption, ICitationOptionMatch>;
  }): JSX.Element {
    const data = props.option.data;
    const match = props.option.match;
    const publication = data.publication;
    const type =
      publication.type && publication.type in this.typeNames
        ? this.typeNames[publication.type]
        : publication.type;
    const citationCounts = citationCountsLabel(
      data.citationsInDocument,
      this.trans
    );
    const contentClasses = ['cm-Option-content'];
    if (data.isFallback) {
      contentClasses.push('cm-mod-fallback');
    }
    return (
      <div className={contentClasses.join(' ')}>
        <div className={'cm-Option-main'}>
          <CitationSource source={data.source} />
          <CitationOptionTitle
            title={publication.title}
            match={match ? match.title : null}
          />
          <span className={'cm-citationCount'}>{citationCounts}</span>
          <span className={'cm-year'}>{publication.date?.getFullYear()}</span>
          <span className={'cm-type'}>{type}</span>
        </div>
        <div className={'cm-Option-details'}>
          <CitationOptionAuthors
            authors={publication.author}
            matches={match?.creators}
          />
        </div>
      </div>
    );
  }
}
