import IMatchResult = StringExt.IMatchResult;
import { IStyle } from './types';
import { anonymousMark, IOption, Selector } from './selector';
import { TranslationBundle } from '@jupyterlab/translation';
import { StringExt } from '@lumino/algorithm';
import * as React from 'react';

interface IStyleOption {
  style: IStyle;
}

interface IStyleOptionMatch {
  title: IMatchResult | null;
  shortTitle: IMatchResult | null;
}

export class StyleSelector extends Selector<IStyleOption, IStyleOptionMatch> {
  /**
   * Fields that will be used to filter down the initial list of citation styles.
   *
   * More styles will become available once you start typing.
   * TODO: make this user-customizable in settings?
   */
  preferredFields: string[] = ['generic-base'];

  constructor(protected trans: TranslationBundle) {
    super();
    this.addClass('cm-StyleSelector');
  }

  protected getInitialOptions(): IStyleOption[] {
    return this.options.filter(style =>
      this.preferredFields.some(field =>
        style.style.info.fields.includes(field)
      )
    );
  }

  filterOption(option: IOption<IStyleOption, IStyleOptionMatch>): boolean {
    return !!option.match?.title || !!option.match?.shortTitle;
  }

  matchOption(option: IStyleOption, query: string): IStyleOptionMatch {
    query = query.toLowerCase();
    const style = option.style;
    // TODO: edit distance
    const titleMatch = StringExt.matchSumOfSquares(
      (style.info.title || '').toLowerCase(),
      query
    );
    const shortTitleMatch = StringExt.matchSumOfSquares(
      (style.info.shortTitle || '').toLowerCase(),
      query
    );
    return {
      title: titleMatch,
      shortTitle: shortTitleMatch
    };
  }

  sortOptions(
    a: IOption<IStyleOption, IStyleOptionMatch>,
    b: IOption<IStyleOption, IStyleOptionMatch>
  ): number {
    // TODO show generic-base (and maybe others) higher
    return (
      (a.match?.title?.score || Infinity) - (b.match?.title?.score || Infinity)
    );
  }

  protected renderOption(props: {
    option: IOption<IStyleOption, IStyleOptionMatch>;
  }): JSX.Element {
    const data = props.option.data;
    const info = data.style.info;
    const match = props.option.match;
    // TODO: show license, authors, short title and fields tags
    // TODO: also show the preview for the active item (maybe render in a promise to avoid delays?)
    return (
      <div className={'cm-Option-content'}>
        <span className={'cm-short-title'}>
          {info.shortTitle
            ? (match && match.shortTitle
                ? StringExt.highlight(
                    info.shortTitle,
                    match.shortTitle.indices,
                    anonymousMark
                  )
                : info.shortTitle) + ': '
            : ''}
        </span>
        <span className={'cm-title'}>
          {match && match.title
            ? StringExt.highlight(
                info.title,
                match.title.indices,
                anonymousMark
              )
            : info.title}
        </span>
      </div>
    );
  }
}
