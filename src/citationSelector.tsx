import IMatchResult = StringExt.IMatchResult;
import { StringExt } from '@lumino/algorithm';
import * as React from 'react';
import { ICitationOption } from './types';
import { IOption, Selector } from './selector';
import { UUID } from '@lumino/coreutils';

interface IYearMatch {
  absoluteDifference: number;
}

interface ICitationOptionMatch {
  title: IMatchResult | null;
  year: IYearMatch | null;
  creators: (IMatchResult | null)[] | null;
}

function CitationOptionTitle(props: {
  title: string | undefined;
  match: IMatchResult | null;
}) {
  return (
    <span className={'cm-title'}>
      {props.title
        ? props.match
          ? StringExt.highlight(props.title, props.match.indices, match => {
              return <mark key={UUID.uuid4()}>{match}</mark>;
            })
          : props.title
        : ''}
    </span>
  );
}

export class CitationSelector extends Selector<
  ICitationOption,
  ICitationOptionMatch
> {
  constructor() {
    super();
    this.placeholder = 'Start typing title, author, or year';
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
              (creator.given + ' ' + creator.family).toLowerCase(),
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
    return (
      <div className={'cm-Option-content'}>
        <span className={`cm-source cm-source-${data.source}`}>
          {data.source[0]}
        </span>
        <CitationOptionTitle
          title={publication.title}
          match={match ? match.title : null}
        />
        <span className={'cm-citationCount'}>
          {data.citationsInDocument !== 0
            ? data.citationsInDocument + ' occurrence(s)'
            : ''}
        </span>
        <span className={'cm-year'}>{publication.date?.getFullYear()}</span>
        <span className={'cm-type'}>{publication.type}</span>
      </div>
    );
  }
}
