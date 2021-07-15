import IMatchResult = StringExt.IMatchResult;
import { StringExt } from '@lumino/algorithm';
import * as React from 'react';
import { ICitableData, ICitationOption } from './types';
import { IOption, Selector } from './selector';
import { UUID } from '@lumino/coreutils';
import { TranslationBundle } from '@jupyterlab/translation';
import { NameVariable } from './_csl_data';

interface IYearMatch {
  absoluteDifference: number;
}

interface ICitationOptionMatch {
  title: IMatchResult | null;
  year: IYearMatch | null;
  creators: (IMatchResult | null)[] | null;
}

function anonymousMark(match: string) {
  return <mark key={UUID.uuid4()}>{match}</mark>;
}

function CitationOptionTitle(props: {
  title: string | undefined;
  match: IMatchResult | null;
}) {
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

function CitationOptionAuthors(props: {
  authors: NameVariable[] | undefined;
  matches: (IMatchResult | null)[] | null | undefined;
}) {
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
          <span className={'cm-author'}>
            {match
              ? StringExt.highlight(authorLabel, match.indices, anonymousMark)
              : authorLabel}
          </span>
        );
      })}
    </ul>
  );
}

function translateTypeLabels(
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

export class CitationSelector extends Selector<
  ICitationOption,
  ICitationOptionMatch
> {
  typeNames: Record<ICitableData['type'], string>;

  constructor(protected trans: TranslationBundle) {
    super();
    this.placeholder = trans.__('Start typing title, author, or year');
    this.typeNames = translateTypeLabels(trans);
  }

  createID(option: ICitationOption): string {
    return (
      'c-' +
      (option.publication.id ||
        option.publication.DOI ||
        option.publication.title ||
        super.createID(option))
    );
  }

  filterOption(
    option: IOption<ICitationOption, ICitationOptionMatch>
  ): boolean {
    return (
      option.match !== null &&
      [option.match.title, option.match.year, option.match.creators].filter(
        v => v !== null
      ).length !== 0
    );
  }

  sortOptions(
    a: IOption<ICitationOption, ICitationOptionMatch>,
    b: IOption<ICitationOption, ICitationOptionMatch>
  ): number {
    if (a.match === null || b.match === null) {
      return 0;
    }
    return (
      (a.match.title?.score || Infinity) - (b.match.title?.score || Infinity)
    );
  }

  matchOption(option: ICitationOption, query: string): ICitationOptionMatch {
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
          publication.date?.getFullYear
            ? publication.date?.getFullYear()
            : 0 - parseInt(queryYear[0], 10)
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
  }

  protected getInitialOptions(): ICitationOption[] {
    return this.options
      .filter(option => option.citationsInDocument > 0)
      .sort((a, b) => a.citationsInDocument - b.citationsInDocument);
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
    return (
      <div className={'cm-Option-content'}>
        <div className={'cm-Option-main'}>
          <span className={`cm-source cm-source-${data.source}`}>
            {data.source[0]}
          </span>
          <CitationOptionTitle
            title={publication.title}
            match={match ? match.title : null}
          />
          <span className={'cm-citationCount'}>
            {data.citationsInDocument !== 0
              ? this.trans._n(
                  '%1 occurrence',
                  '%1 occurrences',
                  data.citationsInDocument
                )
              : ''}
          </span>
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
